import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { MatchIntegrityService } from './integrity/match-integrity.service';
import { EntryFeeTier, isValidEntryFee, requiresKyc, roomKey } from './config/entry-fees';
import { ColorPreference, resolveColors } from './config/color-preference';
import { getTimeControl } from '../game/config/time-controls';
import { AgeService } from '../compliance/age.service';
import { RulesService } from '../compliance/rules.service';

const INITIAL_RATING_BAND = 100;
const BAND_GROWTH_PER_SEC = 20;
const MAX_RATING_BAND = 600;
const QUEUE_JOIN_ATTEMPT_LIMIT = 10; // per rolling minute — throttles queue-flooding bot behavior
const ACTIVE_QUEUE_ENTRY_TTL_SEC = 180; // hard ceiling a player can sit "in queue" server-side before it self-clears
const PRESENCE_TTL_SEC = 15; // heartbeat window — a candidate without a fresh presence key is treated as disconnected
const WAIT_SAMPLES_TO_KEEP = 30; // rolling window per room — recent enough to reflect current queue depth, large enough not to be thrown off by one outlier
const WAIT_SAMPLE_TTL_SEC = 3600; // samples older than an hour shouldn't weight "how long will I wait right now"
const DEFAULT_WAIT_ESTIMATE_SEC = 45; // shown before any real samples exist for a room — an honest "we don't know yet" starting point, not a fabricated precise number

export interface MatchResult {
  matched: boolean;
  gameId?: string;
  opponentId?: string;
  room?: string;
  currentRatingBand?: number;
  estimatedWaitSeconds?: number;
}

@Injectable()
export class MatchmakingService {
  private readonly logger = new Logger(MatchmakingService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly integrity: MatchIntegrityService,
    private readonly age: AgeService,
    private readonly rules: RulesService,
  ) {}

  // ==========================================================================
  // QUEUE JOIN
  // ==========================================================================

  async joinQueue(
    userId: string,
    rating: number,
    timeControlId: string,
    entryFee: number,
    meta: { waitedSeconds?: number; rated?: boolean; colorPreference?: ColorPreference } = {},
  ): Promise<MatchResult> {
    if (!isValidEntryFee(entryFee)) {
      throw new BadRequestException(`Invalid entry fee — must be one of the platform's fixed tiers`);
    }
    getTimeControl(timeControlId); // throws if unknown — fail fast before touching Redis/DB

    const rated = meta.rated ?? true;
    const colorPreference = meta.colorPreference ?? 'random';

    await this.assertRateLimitNotExceeded(userId);
    await this.assertNoDuplicateSession(userId);
    await this.assertEligible(userId, entryFee as EntryFeeTier);
    await this.assertNoActiveGame(userId);
    await this.assertSufficientBalance(userId, entryFee);

    const room = roomKey(timeControlId, entryFee as EntryFeeTier, rated);

    await this.markActive(userId, room);
    await this.markPresent(userId);
    // The candidate's own settings (color preference, rated) ride along in a
    // sibling key so a later tryMatch() from another player can honor them
    // when this user is claimed as the opponent. TTL matches the queue entry
    // itself, so they always expire together.
    await this.markPrefs(userId, { colorPreference, rated });
    await this.redis.enqueuePlayer(this.queueKey(room), userId, rating);

    const matchResult = await this.tryMatch(room, userId, rating, timeControlId, entryFee as EntryFeeTier, meta.waitedSeconds ?? 0, rated);

    if (!matchResult.matched) {
      return {
        matched: false,
        room,
        currentRatingBand: this.computeBand(meta.waitedSeconds ?? 0),
        estimatedWaitSeconds: await this.getEstimatedWaitSeconds(room),
      };
    }

    // Record the ACTUAL time this player waited, now that we know it —
    // real data feeding a real rolling average, not a fixed guess. Only
    // the joining side's wait is recorded here (the matched candidate's
    // own wait was already recorded when THEY joined and got matched by
    // someone else, or will be the next time they're the one joining) —
    // over many matches this still produces a representative sample set,
    // since which side "does the matching" alternates freely.
    await this.recordWaitSample(room, meta.waitedSeconds ?? 0);

    return matchResult;
  }

  private computeBand(waitedSeconds: number): number {
    return Math.min(INITIAL_RATING_BAND + waitedSeconds * BAND_GROWTH_PER_SEC, MAX_RATING_BAND);
  }

  /** Called on every heartbeat from a queued client — the band and wait estimate are recomputed from the ACTUAL elapsed time since joining, not frozen at the moment they first queued, so the UI can show real-time widening. */
  async getQueueStatus(userId: string): Promise<{ currentRatingBand: number; estimatedWaitSeconds: number; waitedSeconds: number } | null> {
    const entry = await this.getActiveQueueEntry(userId);
    if (!entry) return null;
    const waitedSeconds = Math.floor((Date.now() - entry.joinedAt) / 1000);
    return {
      currentRatingBand: this.computeBand(waitedSeconds),
      estimatedWaitSeconds: await this.getEstimatedWaitSeconds(entry.room),
      waitedSeconds,
    };
  }

  private waitSamplesKey(room: string) {
    return `matchmaking:wait-samples:${room}`;
  }

  private async recordWaitSample(room: string, waitedSeconds: number) {
    const key = this.waitSamplesKey(room);
    await this.redis.lpush(key, String(waitedSeconds));
    await this.redis.ltrim(key, 0, WAIT_SAMPLES_TO_KEEP - 1);
    await this.redis.expire(key, WAIT_SAMPLE_TTL_SEC);
  }

  /** A real rolling average of how long recent players in this exact room actually waited — not a fabricated estimate. */
  async getEstimatedWaitSeconds(room: string): Promise<number> {
    const samples = await this.redis.lrange(this.waitSamplesKey(room), 0, WAIT_SAMPLES_TO_KEEP - 1);
    if (samples.length === 0) return DEFAULT_WAIT_ESTIMATE_SEC;
    const numeric = samples.map(Number).filter((n) => !Number.isNaN(n));
    if (numeric.length === 0) return DEFAULT_WAIT_ESTIMATE_SEC;
    return Math.round(numeric.reduce((a, b) => a + b, 0) / numeric.length);
  }

  // ==========================================================================
  // QUEUE LEAVE / CANCEL / TIMEOUT
  // ==========================================================================

  async leaveQueue(userId: string, room: string) {
    await this.redis.dequeuePlayer(this.queueKey(room), userId);
    await this.clearActive(userId);
    await this.clearPresence(userId);
    await this.clearPrefs(userId);
  }

  /** Called by the gateway's queue-timeout timer — functionally identical to a cancellation, kept as a distinct method for clearer logging/metrics. */
  async expireQueueEntry(userId: string, room: string) {
    await this.leaveQueue(userId, room);
    this.logger.log(`Queue entry expired for user ${userId} in room ${room}`);
  }

  // ==========================================================================
  // PRESENCE (used for reconnect handling and to filter stale candidates)
  // ==========================================================================

  async refreshPresence(userId: string) {
    await this.redis.set(this.presenceKey(userId), '1', 'EX', PRESENCE_TTL_SEC);
  }

  async isPresent(userId: string): Promise<boolean> {
    const val = await this.redis.get(this.presenceKey(userId));
    return val !== null;
  }

  async getActiveQueueEntry(userId: string): Promise<{ room: string; joinedAt: number } | null> {
    const raw = await this.redis.get(this.activeKey(userId));
    return raw ? JSON.parse(raw) : null;
  }

  // ==========================================================================
  // MATCHING
  // ==========================================================================

  /**
   * Widens the acceptable rating band the longer a player waits — classic
   * ranked-matchmaking backoff so popular rooms match fast and quiet rooms
   * still eventually match instead of queueing forever. Skips any candidate
   * that fails a presence check (likely disconnected), a balance check
   * (can no longer afford this room), or an integrity check (linked
   * accounts / collusion pattern) rather than failing the whole attempt —
   * the current player just keeps waiting for the next viable candidate.
   */
  private async tryMatch(
    room: string,
    userId: string,
    rating: number,
    timeControlId: string,
    entryFee: EntryFeeTier,
    waitedSeconds: number,
    rated: boolean,
  ): Promise<MatchResult> {
    const band = this.computeBand(waitedSeconds);
    const candidates = await this.redis.findOpponentsInRange(this.queueKey(room), rating - band, rating + band);

    for (const candidateId of candidates) {
      if (candidateId === userId) continue;

      if (!(await this.isPresent(candidateId))) {
        continue; // likely disconnected — leave them queued, they'll be swept by their own timeout if truly gone
      }

      const integrityResult = await this.integrity.shouldBlockPairing(userId, candidateId);
      if (integrityResult.blocked) {
        continue; // never dequeue on a blocked pairing — just don't match these two to each other
      }

      const candidateBalance = await this.wallet.getBalance(candidateId).catch(() => null);
      if (!candidateBalance || Number(candidateBalance.available) < entryFee) {
        continue; // candidate can no longer afford this room — leave for their own re-check/timeout to handle
      }

      // Atomic claim: ZREM is the actual mutex here. If a concurrent
      // tryMatch() from a third player claims this same candidate first,
      // our ZREM returns false and we move on to the next candidate rather
      // than creating a second game for someone who's already been matched.
      const claimedCandidate = await this.redis.claimQueueMember(this.queueKey(room), candidateId);
      if (!claimedCandidate) continue;

      const claimedSelf = await this.redis.claimQueueMember(this.queueKey(room), userId);
      if (!claimedSelf) {
        // We ourselves got claimed by someone else's concurrent tryMatch()
        // between our own enqueue and this point — put the candidate back
        // since we can't complete this pairing, and stop; the other match
        // that claimed us is the one that proceeds.
        await this.redis.enqueuePlayer(this.queueKey(room), candidateId, rating);
        return { matched: false };
      }

      return this.finalizeMatch(room, userId, candidateId, timeControlId, entryFee, rated);
    }

    return { matched: false };
  }

  private async finalizeMatch(
    room: string,
    userId: string,
    opponentId: string,
    timeControlId: string,
    entryFee: EntryFeeTier,
    rated: boolean,
  ): Promise<MatchResult> {
    // Both players are already atomically claimed (removed from the queue)
    // by tryMatch's ZREM calls before this is reached — no further queue
    // mutation needed here, just the bookkeeping cleanup and game creation.
    await this.clearActive(userId);
    await this.clearActive(opponentId);

    // Honor each player's color preference from their own queue join (they
    // were matched in the SAME room, so both wanted the same rated setting).
    const [selfPrefs, oppPrefs] = await Promise.all([this.getPrefs(userId), this.getPrefs(opponentId)]);
    const colors = resolveColors(selfPrefs?.colorPreference ?? 'random', oppPrefs?.colorPreference ?? 'random');
    const playerWhiteId = colors.playerA === 'white' ? userId : opponentId;
    const playerBlackId = colors.playerA === 'white' ? opponentId : userId;

    await this.clearPrefs(userId);
    await this.clearPrefs(opponentId);

    const game = await this.prisma.game.create({
      data: {
        playerWhiteId,
        playerBlackId,
        entryFee,
        timeControl: timeControlId, // overwritten with the human-readable label by GameService.startGame
        rated,
        status: 'waiting',
      },
    });

    this.logger.log(`Matched ${userId} vs ${opponentId} in room ${room} -> game ${game.id}`);
    return { matched: true, gameId: game.id, opponentId, room };
  }

  // ==========================================================================
  // GUARDS
  // ==========================================================================

  private async assertRateLimitNotExceeded(userId: string) {
    const key = `matchmaking:join_attempts:${userId}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    if (count > QUEUE_JOIN_ATTEMPT_LIMIT) {
      throw new ForbiddenException('Too many matchmaking attempts — please slow down');
    }
  }

  private async assertNoDuplicateSession(userId: string) {
    const existing = await this.getActiveQueueEntry(userId);
    if (existing) {
      throw new ConflictException(`Already queued in room ${existing.room} — cancel that first`);
    }
  }

  private async assertEligible(userId: string, entryFee: EntryFeeTier) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (!user.emailVerifiedAt) {
      throw new ForbiddenException('Verify your email before playing for real money');
    }
    if (user.status !== 'active') {
      throw new ForbiddenException('Account is not active');
    }

    // Free play ($0) deliberately bypasses every check below — age, KYC,
    // and rules acceptance all gate REAL-MONEY participation specifically,
    // not the platform in general. An account that hasn't cleared any of
    // these still has somewhere to play.
    if (entryFee === 0) return;

    if (requiresKyc(entryFee) && user.kycStatus !== 'verified') {
      throw new ForbiddenException(`KYC verification is required for the $${entryFee} room`);
    }
    await this.age.assertRealMoneyEligible(userId);
    await this.rules.assertAccepted(userId);
  }

  private async assertNoActiveGame(userId: string) {
    const activeGame = await this.prisma.game.findFirst({
      where: {
        status: { in: ['waiting', 'ongoing'] },
        OR: [{ playerWhiteId: userId }, { playerBlackId: userId }],
      },
    });
    if (activeGame) {
      throw new ConflictException('You already have a game in progress — finish it before queueing again');
    }
  }

  private async assertSufficientBalance(userId: string, entryFee: number) {
    const balance = await this.wallet.getBalance(userId);
    if (Number(balance.available) < entryFee) {
      throw new BadRequestException(`Insufficient balance — this room requires $${entryFee} available`);
    }
  }

  // ==========================================================================
  // REDIS KEY HELPERS
  // ==========================================================================

  private queueKey(room: string) {
    return `matchmaking:queue:${room}`;
  }

  private activeKey(userId: string) {
    return `matchmaking:active:${userId}`;
  }

  private presenceKey(userId: string) {
    return `matchmaking:presence:${userId}`;
  }

  private async markActive(userId: string, room: string) {
    await this.redis.set(this.activeKey(userId), JSON.stringify({ room, joinedAt: Date.now() }), 'EX', ACTIVE_QUEUE_ENTRY_TTL_SEC);
  }

  private async clearActive(userId: string) {
    await this.redis.del(this.activeKey(userId));
  }

  private async markPresent(userId: string) {
    await this.redis.set(this.presenceKey(userId), '1', 'EX', PRESENCE_TTL_SEC);
  }

  private async clearPresence(userId: string) {
    await this.redis.del(this.presenceKey(userId));
  }

  // ==========================================================================
  // COLOR / RATED PREFERENCES (per-player queue-side settings)
  // ==========================================================================

  private prefsKey(userId: string) {
    return `matchmaking:prefs:${userId}`;
  }

  private async markPrefs(userId: string, prefs: { colorPreference: ColorPreference; rated: boolean }) {
    await this.redis.set(this.prefsKey(userId), JSON.stringify(prefs), 'EX', ACTIVE_QUEUE_ENTRY_TTL_SEC);
  }

  private async clearPrefs(userId: string) {
    await this.redis.del(this.prefsKey(userId));
  }

  private async getPrefs(userId: string): Promise<{ colorPreference: ColorPreference; rated: boolean } | null> {
    const raw = await this.redis.get(this.prefsKey(userId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        colorPreference: parsed?.colorPreference ?? 'random',
        rated: parsed?.rated ?? true,
      };
    } catch {
      return null;
    }
  }
}
