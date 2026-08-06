import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { FraudService } from '../../wallet/fraud/fraud.service';
import { FairPlayAuditService } from './fair-play-audit.service';

export type FairPlaySeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * The Fair Play detection engine.
 *
 * Everything in this service is deliberately NON-punitive: every detector
 * writes an audited `fraud_signals` row (the same admin review queue every
 * other signal on the platform already flows through) so a human reviewer
 * makes the final call. Detections come in two flavors:
 *
 *  - LIVE (hooked into the game gateway): concurrent real-money sessions
 *    and rapid disconnect/reconnect abuse, tracked through Redis because
 *    they're inherently in-the-moment signals.
 *  - POST-GAME (hooked into GameService.finishGame, fire-and-forget):
 *    impossible move speed, abandonment patterns, abnormal win streaks,
 *    repeated suspicious patterns, and collusion indicators — computed from
 *    the move/clock history the engine already persists.
 *
 * Every threshold is read from the `fairplay` config section (env-overridable
 * via FINGER_CHESS_FP_*) rather than hardcoded, and every signal carries an
 * explicit severity + evidence payload so the risk-score engine and admin
 * review screens can explain WHY a player is flagged.
 */
@Injectable()
export class FairPlayDetectorService {
  private readonly logger = new Logger(FairPlayDetectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly fraud: FraudService,
    private readonly audit: FairPlayAuditService,
  ) {}

  private get cfg() {
    return this.config.get('fairplay');
  }

  // ---------------------------------------------------------------------
  // LIVE DETECTION (gateway hooks)
  // ---------------------------------------------------------------------

  /**
   * Called from the gateway when a player joins a game room. Maintains a
   * Redis SET of the games the player is currently seated in; if they were
   * already in >= threshold games before this join, that's simultaneous
   * play — impossible to do honestly in a real-money game and a classic
   * multi-account/collusion tell. A second browser tab in the SAME game
   * re-adds the same gameId (idempotent SET add), so it never false-positives.
   */
  async onPlayerJoinedGame(userId: string, gameId: string) {
    try {
      const activeKey = `fairplay:active-games:${userId}`;
      const alreadyActive = await this.redis.scard(activeKey);
      const threshold = Number(this.cfg.concurrentGamesThreshold);

      if (alreadyActive >= threshold) {
        await this.raiseSignal(userId, 'fairplay_concurrent_sessions', 'high', {
          gameId,
          alreadyActive,
        }, `concurrent:${userId}:${new Date().toISOString().slice(0, 10)}`);
      }

      await this.redis.sadd(activeKey, gameId);
      await this.redis.expire(activeKey, 6 * 3600);
    } catch (err) {
      this.logger.error(`Concurrent-session detection failed for ${userId}: ${(err as Error).message}`);
    }
  }

  /**
   * Called from the gateway when a player's LAST socket in a game closes
   * (the same point a forfeit grace period is scheduled). Two signals:
   *   1. Removes the game from the player's active-game SET.
   *   2. Counts disconnects within a short window. A player who repeatedly
   *      drops their connection is either on pathological wifi or exploiting
   *      the reconnect grace period to stall clocks / buy thinking time —
   *      the count crossing the threshold is the signal, not any single drop.
   */
  async onPlayerDisconnected(userId: string, gameId: string) {
    try {
      await this.redis.srem(`fairplay:active-games:${userId}`, gameId);

      const windowSec = Number(this.cfg.rapidReconnectWindowSec);
      const threshold = Number(this.cfg.rapidReconnectThreshold);
      const counterKey = `fairplay:reconnect:${userId}`;

      const count = await this.redis.incr(counterKey);
      if (count === 1) await this.redis.expire(counterKey, windowSec);

      if (count >= threshold) {
        await this.raiseSignal(userId, 'fairplay_rapid_reconnect', 'medium', {
          gameId,
          disconnectCount: count,
          windowSec,
        }, `reconnect:${userId}:${Math.floor(Date.now() / (windowSec * 1000))}`);
      }
    } catch (err) {
      this.logger.error(`Reconnect-abuse detection failed for ${userId}: ${(err as Error).message}`);
    }
  }

  /** Called from GameService.finishGame so a settled game no longer counts as "active". */
  async onGameEnded(userId: string, gameId: string) {
    try {
      await this.redis.srem(`fairplay:active-games:${userId}`, gameId);
    } catch {
      // best-effort bookkeeping — never worth blocking a settlement
    }
  }

  // ---------------------------------------------------------------------
  // POST-GAME DETECTION (fire-and-forget from GameService.finishGame)
  // ---------------------------------------------------------------------

  /**
   * Fire-and-forget orchestrator. Never awaited by the settlement path.
   * `endReason`/`loserId` are passed through from finishGame's own
   * computation (the end reason is not otherwise persisted on the Game row).
   */
  analyzeGameAsync(gameId: string, endReason?: string, loserId?: string) {
    this.runAnalysis(gameId, endReason, loserId).catch((err) => {
      this.logger.error(`Fair-play analysis failed for game ${gameId}: ${(err as Error).message}`);
    });
  }

  private async runAnalysis(gameId: string, endReason?: string, loserId?: string) {
    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    const moves = await this.prisma.gameMove.findMany({
      where: { gameId },
      orderBy: [{ moveNumber: 'asc' }, { color: 'asc' }],
    });
    if (moves.length < 2) return;

    const byColor: Record<'white' | 'black', typeof moves> = { white: [], black: [] };
    for (const m of moves) byColor[m.color].push(m);

    const players: Array<'white' | 'black'> = ['white', 'black'];
    for (const color of players) {
      const userId = color === 'white' ? game.playerWhiteId : game.playerBlackId;

      const speed = this.detectImpossibleMoveSpeed(byColor[color]);
      if (speed.flagged) {
        await this.raiseSignal(userId, 'fairplay_impossible_move_speed', 'medium', { gameId, ...speed }, gameId, gameId);
      }

      // Player-wide pattern checks — deduped per day, so repeated games
      // reinforce but never spam the review queue.
      await this.detectWinStreak(userId, gameId);
      await this.detectRepeatedPatterns(userId, gameId);
    }

    // Abandonment / timeout losses: repeatedly walking away from games you're
    // about to lose (or flagging) is the money-damage version of cheating.
    if (loserId && (endReason === 'abandonment' || endReason === 'timeout')) {
      await this.recordAbandonment(loserId, gameId);
    }

    await this.detectCollusion(gameId, game.playerWhiteId, game.playerBlackId);
  }

  /** Fast-move analysis from the persisted clock sequence. */
  private detectImpossibleMoveSpeed(
    moves: { moveSan: string; clockRemainingMs: number }[],
  ): { flagged: boolean; fastMoves: number; analyzedMoves: number; forcedFastMoves: number; fraction: number } {
    const cfg = this.cfg;
    const speedThresholdMs = Number(cfg.impossibleMoveSpeedMs); // 150ms
    const minCount = Number(cfg.impossibleMoveSpeedMinCount); // 10
    const fractionThreshold = Number(cfg.impossibleMoveSpeedFraction); // 0.3
    const fractionThresholdFast = Number(cfg.impossibleMoveSpeedFractionFast); // 0.5
    const fastBaseSec = Number(cfg.impossibleMoveSpeedFastBaseSec); // 300

    let analyzed = 0;
    let fast = 0;
    let forcedFast = 0;
    let lastClock = moves[0].clockRemainingMs;

    for (let i = 1; i < moves.length; i++) {
      const delta = lastClock - moves[i].clockRemainingMs;
      if (delta > 0) {
        analyzed++;
        if (delta < speedThresholdMs) {
          fast++;
          // Captures (SAN contains 'x') are the one class of move a human
          // can legitimately play instantly — a recapture. Everything else
          // takes a human at least a few hundred ms to even read.
          if (moves[i].moveSan.includes('x')) forcedFast++;
        }
      }
      lastClock = moves[i].clockRemainingMs;
    }

    // Fast time controls (bullet-ish, game under `fastBaseSec`) naturally
    // contain more quick moves, so they need a higher fraction to flag.
    const totalDurationSec = (moves[moves.length - 1].clockRemainingMs - moves[0].clockRemainingMs) / 1000;
    const threshold = totalDurationSec < fastBaseSec ? fractionThresholdFast : fractionThreshold;

    const nonForcedFast = fast - forcedFast;
    const fraction = analyzed > 0 ? nonForcedFast / analyzed : 0;
    const flagged = nonForcedFast >= minCount && fraction >= threshold;

    return { flagged, fastMoves: nonForcedFast, analyzedMoves: analyzed, forcedFastMoves: forcedFast, fraction: Number(fraction.toFixed(3)) };
  }

  private async detectWinStreak(userId: string, gameId: string) {
    const threshold = Number(this.cfg.winStreakThreshold); // 12
    const recent = await this.prisma.game.findMany({
      where: { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }], status: 'completed' },
      orderBy: { endedAt: 'desc' },
      take: 30,
      select: { result: true, playerWhiteId: true },
    });

    let streak = 0;
    for (const g of recent) {
      if (g.result === 'draw') break;
      const won =
        (g.playerWhiteId === userId && g.result === 'white_win') ||
        (g.playerWhiteId !== userId && g.result === 'black_win');
      if (won) streak++;
      else break;
    }

    if (streak >= threshold) {
      await this.raiseSignal(userId, 'fairplay_win_streak', 'low', { gameId, streak }, `winstreak:${userId}:${new Date().toISOString().slice(0, 10)}`);
    }
  }

  private async detectRepeatedPatterns(userId: string, gameId: string) {
    const windowDays = Number(this.cfg.repeatedPatternWindowDays); // 30
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const scope = `repeated:${userId}:${new Date().toISOString().slice(0, 10)}`;

    const openFairPlaySignals = await this.prisma.fraudSignal.count({
      where: { userId, signalType: { startsWith: 'fairplay_' }, createdAt: { gte: since }, status: 'open' },
    });
    if (openFairPlaySignals >= Number(this.cfg.repeatedPatternSignalThreshold)) {
      await this.raiseSignal(userId, 'fairplay_repeated_suspicious', 'medium', { gameId, signalCount: openFairPlaySignals, windowDays }, scope);
    }

    const flaggedEngineReports = await this.prisma.anticheatReport.count({
      where: { userId, flagged: true, createdAt: { gte: since } },
    });
    if (flaggedEngineReports >= Number(this.cfg.repeatedPatternFlaggedReports)) {
      await this.raiseSignal(userId, 'fairplay_repeated_engine_use', 'high', { gameId, flaggedReportCount: flaggedEngineReports, windowDays }, scope);
    }
  }

  /**
   * Persists an abandonment/timeout loss and checks whether the player is
   * making a habit of it. History is kept in a Redis ZSET (timestamp-scored)
   * because the end reason isn't stored on the Game row — each loss is
   * appended here as it completes, and the durable fraud_signal only appears
   * when the pattern crosses the threshold. A Redis flush losing the rolling
   * count is an acceptable gap for a flag-for-review signal.
   */
  private async recordAbandonment(userId: string, gameId: string) {
    const zsetKey = `fairplay:abandonments:${userId}`;
    const windowDays = Number(this.cfg.abandonmentWindowDays); // 14
    const threshold = Number(this.cfg.abandonmentThreshold); // 3
    const lossRatio = Number(this.cfg.abandonmentLossRatio); // 0.4
    const sinceMs = Date.now() - windowDays * 86_400_000;

    await this.redis.zadd(zsetKey, Date.now().toString(), gameId);
    await this.redis.zremrangebyscore(zsetKey, 0, sinceMs);
    await this.redis.expire(zsetKey, windowDays * 86_400);

    const abandonmentCount = await this.redis.zcard(zsetKey);
    const completedCount = await this.prisma.game.count({
      where: { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }], status: 'completed', endedAt: { gte: new Date(sinceMs) } },
    });

    if (abandonmentCount >= threshold && completedCount > 0 && abandonmentCount / completedCount >= lossRatio) {
      await this.raiseSignal(
        userId,
        'fairplay_abandonment_pattern',
        'medium',
        { gameId, abandonmentCount, completedCount, windowDays },
        `abandon:${userId}:${new Date().toISOString().slice(0, 7)}`,
      );
    }
  }

  /**
   * Collusion heuristic: two players who face each other repeatedly, with an
   * extreme result skew, AND who share a device fingerprint or IP range.
   * Individually each leg is explainable (old friends play often; one is
   * better). All three together is what flags for human review.
   */
  private async detectCollusion(gameId: string, whiteId: string, blackId: string) {
    const windowDays = Number(this.cfg.evidenceWindowDays); // 30
    const since = new Date(Date.now() - windowDays * 86_400_000);
    const minSharedGames = 3;

    const pairWhere: Prisma.GameWhereInput = {
      OR: [
        { playerWhiteId: whiteId, playerBlackId: blackId },
        { playerWhiteId: blackId, playerBlackId: whiteId },
      ],
      status: 'completed',
      endedAt: { gte: since },
    };

    const headToHead = await this.prisma.game.count({ where: pairWhere });
    if (headToHead < minSharedGames) return;

    const whiteWins = await this.prisma.game.count({
      where: { playerWhiteId: whiteId, playerBlackId: blackId, status: 'completed', result: 'white_win', endedAt: { gte: since } },
    });
    const skew = Math.max(whiteWins / headToHead, 1 - whiteWins / headToHead);
    if (skew < 0.8) return;

    const linked = await this.prisma.deviceFingerprint.findMany({
      where: { userId: { in: [whiteId, blackId] }, createdAt: { gte: since } },
      select: { userId: true, fingerprintHash: true, ipAddress: true },
    });
    if (linked.length === 0) return;

    const byUser = { [whiteId]: new Set<string>(), [blackId]: new Set<string>() };
    const ips = { [whiteId]: new Set<string>(), [blackId]: new Set<string>() };
    for (const row of linked) {
      byUser[row.userId].add(row.fingerprintHash);
      ips[row.userId].add(row.ipAddress);
    }

    const sharedFingerprint = [...byUser[whiteId]].some((h) => byUser[blackId].has(h));
    const sharedIp = [...ips[whiteId]].some((ip) => ips[blackId].has(ip));

    if (sharedFingerprint || sharedIp) {
      await this.raiseSignal(
        whiteId,
        'fairplay_collusion',
        'critical',
        { gameId, opponentId: blackId, headToHead, resultSkew: Number(skew.toFixed(2)), sharedFingerprint, sharedIp, windowDays },
        gameId,
        gameId,
      );
      await this.raiseSignal(
        blackId,
        'fairplay_collusion',
        'critical',
        { gameId, opponentId: whiteId, headToHead, resultSkew: Number(skew.toFixed(2)), sharedFingerprint, sharedIp, windowDays },
        gameId,
        gameId,
      );
    }
  }

  // ---------------------------------------------------------------------
  // SHARED SIGNAL WRITE PATH
  // ---------------------------------------------------------------------

  /**
   * The single gate through which every detector produces a flag. Writes the
   * signal to the shared fraud_signals queue (so it lands in the SAME admin
   * review UI as every other platform signal), records an audited security
   * event, and logs loudly. Deduped per scope (usually the game or the day)
   * so a burst of identical events collapses to one row without losing the
   * evidence payload.
   */
  private async raiseSignal(
    userId: string,
    signalType: string,
    severity: FairPlaySeverity,
    details: Record<string, unknown>,
    dedupScope: string,
    referenceId?: string,
  ) {
    const dedupKey = `fairplay:signal:${signalType}:${userId}:${dedupScope}`;
    const already = await this.redis.get(dedupKey);
    if (already) return;

    await this.fraud.recordSignal(userId, signalType, severity, { ...details, detectedBy: 'fair_play' }, referenceId ? 'game' : undefined, referenceId);
    await this.redis.set(dedupKey, '1', 'EX', 86_400); // once per scope per day
    await this.audit.recordEvent({
      userId,
      eventType: `fairplay:${signalType}`,
      metadata: { ...details, severity },
    });
    this.logger.warn(`Fair-play signal ${signalType} (${severity}) for user ${userId} — ${JSON.stringify(details)}`);
  }
}
