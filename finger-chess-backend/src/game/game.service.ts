import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ChessEngineService, MoveResult } from './engine/chess-engine.service';
import { WalletService } from '../wallet/wallet.service';
import { AnticheatService } from './anticheat/anticheat.service';
import { AchievementsService } from '../social/achievements/achievements.service';
import { RiskScoreService } from '../security/risk-score.service';
import { FairPlayDetectorService } from '../security/fairplay/fair-play-detector.service';
import { RatingService } from './rating.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getTimeControl } from './config/time-controls';
import { buildPgn, PgnMove } from './utils/pgn-builder';

interface ActiveGameState {
  fen: string;
  turn: 'w' | 'b';
  whiteClockMs: number;
  blackClockMs: number;
  incrementMs: number;
  lastMoveAt: number;
  moveCount: number;
  drawOfferBy: 'w' | 'b' | null;
  /**
   * Position-hash -> occurrence count across the WHOLE game. chess.js's own
   * `isThreefoldRepetition()` only counts positions seen by the single
   * throwaway Chess instance it evaluates a move on, and the position hash
   * (not the FEN) must be the key because the FEN embeds the fullmove number.
   * See ChessEngineService.positionKey.
   */
  positionCounts: Record<string, number>;
}

export type ApplyMoveOutcome = {
  state: ActiveGameState;
  result: MoveResult & { timeout?: boolean; winnerColor?: 'white' | 'black' };
};

const DEFAULT_COMMISSION_PERCENT = 10;

@Injectable()
export class GameService {
  private readonly logger = new Logger(GameService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly engine: ChessEngineService,
    private readonly wallet: WalletService,
    private readonly anticheat: AnticheatService,
    private readonly achievements: AchievementsService,
    private readonly riskScore: RiskScoreService,
    private readonly ratingService: RatingService,
    private readonly fairPlay: FairPlayDetectorService,
    private readonly notifications: NotificationsService,
  ) {}

  // Runtime extension hooks — registered by feature modules (tournaments) that
  // need to react to game lifecycle events but must NOT create a circular
  // module dependency (the tournament module imports GameModule). Registration
  // is idempotent at boot, and every hook is invoked fire-and-forget so a
  // handler's failure can never break settlement.
  private readonly gameSettledHandlers: Array<(gameId: string) => void | Promise<void>> = [];
  private readonly staleWaitingExemptions: Array<(gameId: string) => boolean | Promise<boolean>> = [];

  onGameSettled(handler: (gameId: string) => void | Promise<void>) {
    this.gameSettledHandlers.push(handler);
  }

  /** Games matching any registered exemption predicate are skipped by the stale-waiting abort sweep. */
  addStaleWaitingExemption(predicate: (gameId: string) => boolean | Promise<boolean>) {
    this.staleWaitingExemptions.push(predicate);
  }

  /** Which participants are physically inside the game room — used by tournament no-show resolution. */
  async getJoinedPlayers(gameId: string): Promise<string[]> {
    return this.redis.smembers(this.joinedKey(gameId));
  }

  private stateKey(gameId: string) {
    return `game:${gameId}:state`;
  }

  private playersKey(gameId: string) {
    return `game:${gameId}:players`;
  }

  /** Which users have their socket inside the game room — used to avoid starting the clock before BOTH players are connected. */
  private joinedKey(gameId: string) {
    return `game:${gameId}:joined`;
  }

  private readonly STATE_TTL_SEC = 60 * 60 * 8; // 8h — comfortably covers even Classical games

  // ==========================================================================
  // LIFECYCLE
  // ==========================================================================

  async startGame(gameId: string, whiteUserId: string, blackUserId: string, entryFee: number, timeControlId: string) {
    const tc = getTimeControl(timeControlId);
    const fen = this.engine.createNewGame();

    // Hold both players' entry fees BEFORE any game state is persisted. A
    // balance is re-checked here (not just at matchmaking time): a player can
    // spend the fee in the seconds between matchFound and both sockets
    // joining, and the previous code would then half-start the game with one
    // hold taken and no compensation — or worse, leave a state/players key on
    // a game row that is still 'waiting'.
    if (entryFee > 0) {
      const [whiteBalance, blackBalance] = await Promise.all([
        this.wallet.getBalance(whiteUserId),
        this.wallet.getBalance(blackUserId),
      ]);
      if (Number(whiteBalance.available) < entryFee || Number(blackBalance.available) < entryFee) {
        throw new BadRequestException('Insufficient balance to start the match — please top up and re-match');
      }

      await this.wallet.holdEntryFee(whiteUserId, entryFee, gameId, `hold:${gameId}:${whiteUserId}`);
      try {
        await this.wallet.holdEntryFee(blackUserId, entryFee, gameId, `hold:${gameId}:${blackUserId}`);
      } catch (err) {
        // A half-started match must never strand one player's entry fee with
        // no game to show for it — release the side that was already held
        // and rethrow so the game stays 'waiting' for a clean retry.
        await this.wallet
          .releaseEntryFeeHold(whiteUserId, entryFee, gameId, `release:${gameId}:${whiteUserId}`)
          .catch(() => {});
        throw err;
      }
    }

    const state: ActiveGameState = {
      fen,
      turn: 'w',
      whiteClockMs: tc.baseMs,
      blackClockMs: tc.baseMs,
      incrementMs: tc.incrementMs,
      lastMoveAt: Date.now(),
      moveCount: 0,
      drawOfferBy: null,
      positionCounts: { [this.engine.positionKey(fen)]: 1 },
    };

    try {
      await this.redis.set(this.stateKey(gameId), JSON.stringify(state), 'EX', this.STATE_TTL_SEC);
      await this.redis.set(
        this.playersKey(gameId),
        JSON.stringify({ whiteUserId, blackUserId, category: tc.category, timeControlId }),
        'EX',
        this.STATE_TTL_SEC,
      );

      await this.prisma.game.update({
        where: { id: gameId },
        data: { status: 'ongoing', timeControl: tc.label, startedAt: new Date() },
      });
    } catch (err) {
      // A start that dies AFTER both holds committed (Redis write or DB
      // status update fails) would otherwise leave BOTH players' entry fees
      // permanently locked on a game that is still 'waiting' with no
      // automated recovery — release the holds so a retry (or the
      // stale-waiting sweep) can pick up cleanly. releaseEntryFeeHold is a
      // no-op when nothing was held, so this is safe on every failure path.
      if (entryFee > 0) {
        await this.wallet
          .releaseEntryFeeHold(whiteUserId, entryFee, gameId, `release:${gameId}:${whiteUserId}`)
          .catch(() => {});
        await this.wallet
          .releaseEntryFeeHold(blackUserId, entryFee, gameId, `release:${gameId}:${blackUserId}`)
          .catch(() => {});
      }
      await this.redis.del(this.stateKey(gameId));
      await this.redis.del(this.playersKey(gameId));
      throw err;
    }

    // Match started — one notification per player so the notification center
    // and badge stay live even if the player never sees the game screen.
    const matchUrl = `/play/${gameId}`;
    void this.notifications
      .send(whiteUserId, 'in_app', 'match_started', 'Match started', 'Your match has started — you are playing White', { gameId }, { groupKey: `match_started:${gameId}`, actionUrl: matchUrl })
      .catch((err) => this.logger.warn(`match_started notify failed for ${whiteUserId}: ${(err as Error).message}`));
    void this.notifications
      .send(blackUserId, 'in_app', 'match_started', 'Match started', 'Your match has started — you are playing Black', { gameId }, { groupKey: `match_started:${gameId}`, actionUrl: matchUrl })
      .catch((err) => this.logger.warn(`match_started notify failed for ${blackUserId}: ${(err as Error).message}`));

    return state;
  }

  /**
   * Called by the gateway once a player's socket joins the game room.
   * Idempotent — safe to call from both join events without risk of
   * double-starting (the DB status check + Redis SETNX-style existence
   * check both guard against a race between two near-simultaneous joins).
   *
   * IMPORTANT (match-start sync bug fix): the game does NOT start until BOTH
   * players are physically inside the room (their userId is in the Redis
   * `joined` set). Previously the first joiner triggered startGame directly,
   * which handed them a running clock and created both entry-fee holds while
   * their opponent was still navigating to the game page — and, because the
   * gateway only ever emitted `gameState` to the socket that just joined,
   * the FIRST player then sat on the "waiting for opponent" screen forever.
   */
  async startGameIfWaiting(gameId: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId } });
    if (!game || game.status !== 'waiting') return null;

    const joined = await this.redis.smembers(this.joinedKey(gameId));
    if (!joined.includes(game.playerWhiteId) || !joined.includes(game.playerBlackId)) return null;

    const alreadyStarting = await this.redis.set(`game:${gameId}:starting`, '1', 'EX', 30, 'NX');
    if (!alreadyStarting) return null; // another concurrent join is already starting it

    // `timeControl` currently holds the TIME_CONTROLS id written by
    // MatchmakingService at game creation — startGame below overwrites it
    // with the human-readable label once the time control is resolved.
    return this.startGame(gameId, game.playerWhiteId, game.playerBlackId, Number(game.entryFee), game.timeControl);
  }

  /** Marks a player as physically inside the game room — multi-instance safe via shared Redis. */
  async markJoined(gameId: string, userId: string) {
    await this.redis.sadd(this.joinedKey(gameId), userId);
    await this.redis.expire(this.joinedKey(gameId), this.STATE_TTL_SEC);
  }

  /** DB-backed participant check — used at join time, before Redis state necessarily exists yet (game may still be 'waiting' for the second player). */
  async isParticipant(gameId: string, userId: string): Promise<'w' | 'b' | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { playerWhiteId: true, playerBlackId: true },
    });
    if (!game) return null;
    if (game.playerWhiteId === userId) return 'w';
    if (game.playerBlackId === userId) return 'b';
    return null;
  }

  /** Read-only helper for presence cleanup: the two participant ids of a game ([] if the row is gone). */
  async getPlayerIds(gameId: string): Promise<string[]> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { playerWhiteId: true, playerBlackId: true },
    });
    if (!game) return [];
    return [game.playerWhiteId, game.playerBlackId].filter(Boolean);
  }

  /** Looked up by the gateway on every move/reconnect — avoids a DB round-trip per event. */
  async getPlayerColor(gameId: string, userId: string): Promise<'w' | 'b'> {
    const raw = await this.redis.get(this.playersKey(gameId));
    if (!raw) throw new NotFoundException('Game not found or already finished');
    const { whiteUserId, blackUserId } = JSON.parse(raw);
    if (userId === whiteUserId) return 'w';
    if (userId === blackUserId) return 'b';
    throw new BadRequestException('User is not a participant in this game');
  }

  /** Used by the gateway to size disconnect-forfeit grace periods to the game's actual time control. */
  async getGameCategory(gameId: string): Promise<string | null> {
    const raw = await this.redis.get(this.playersKey(gameId));
    if (!raw) return null;
    const { category } = JSON.parse(raw);
    return category ?? null;
  }

  /** Whether a game has money on the line — gates live spectating, since a spectator of a paid match is a move-relay/ghosting vector. */
  async isRealMoneyGame(gameId: string): Promise<boolean> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { entryFee: true } });
    return !!game && Number(game.entryFee) > 0;
  }

  async getActiveState(gameId: string): Promise<ActiveGameState | null> {
    const raw = await this.redis.get(this.stateKey(gameId));
    return raw ? JSON.parse(raw) : null;
  }

  /** Full snapshot for a spectator (or a reconnecting player) joining mid-game. */
  async getSpectatorSnapshot(gameId: string) {
    const state = await this.getActiveState(gameId);
    if (!state) throw new NotFoundException('Game is not currently active');

    const [game, moves] = await Promise.all([
      this.prisma.game.findUniqueOrThrow({ where: { id: gameId } }),
      this.prisma.gameMove.findMany({ where: { gameId }, orderBy: { moveNumber: 'asc' } }),
    ]);

    return {
      fen: state.fen,
      turn: state.turn,
      whiteClockMs: state.whiteClockMs,
      blackClockMs: state.blackClockMs,
      incrementMs: state.incrementMs,
      lastMoveAt: state.lastMoveAt,
      drawOfferBy: state.drawOfferBy,
      whitePlayerId: game.playerWhiteId,
      blackPlayerId: game.playerBlackId,
      moves: moves.map((m) => ({ moveNumber: m.moveNumber, color: m.color, san: m.moveSan })),
    };
  }

  /**
   * Rejoin path for a player whose game has ALREADY finished. Previously a
   * reconnecting player got `waitingForOpponent` (the snapshot fails once
   * the Redis state is deleted by settlement), which left them staring at
   * an infinite "waiting for your opponent to connect…" spinner with no way
   * to see the result. This hands the frontend a gameOver payload instead.
   * The stored result doesn't record HOW the game ended, so the reason is
   * the honest fallback label; winnerColor is what actually matters for the
   * dialog.
   */
  async getGameOutcomeForReconnect(gameId: string): Promise<{ reason: string; winnerColor?: 'white' | 'black' } | null> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { status: true, result: true },
    });
    if (!game || game.status !== 'completed' || !game.result) return null;
    return {
      reason: 'completed',
      winnerColor: game.result === 'white_win' ? 'white' : game.result === 'black_win' ? 'black' : undefined,
    };
  }

  async isGameWaiting(gameId: string): Promise<boolean> {
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { status: true } });
    return game?.status === 'waiting';
  }

  // ==========================================================================
  // MOVES
  // ==========================================================================

  /**
   * Validates and applies a move server-side. Nothing here trusts
   * client-reported clocks — elapsed time is computed from the server's own
   * `lastMoveAt` timestamp, and Fischer increment is added back to the
   * mover's own clock only after a legal move is confirmed.
   *
   * The whole read-modify-write (state fetch -> validation -> persist ->
   * DB move row -> possible settlement) runs under a Redis lock so two
   * near-simultaneous events can't both read the same `lastMoveAt`, apply
   * the same turn, or race two settlement paths. Without it, a duplicate
   * `move` packet or a move racing a resign/draw-accept would corrupt the
   * game.
   */
  async applyMove(gameId: string, playerColor: 'w' | 'b', san: string, expectedMoveCount?: number): Promise<ApplyMoveOutcome> {
    return this.redis.withLock(gameId, async () => {
      const state = await this.requireActiveState(gameId);

      if (expectedMoveCount !== undefined && state.moveCount !== expectedMoveCount) {
        throw new BadRequestException('Your board is out of sync — please refresh');
      }

      if (state.turn !== playerColor) {
        throw new BadRequestException('Not your turn');
      }

      const elapsed = Date.now() - state.lastMoveAt;
      if (playerColor === 'w') state.whiteClockMs -= elapsed;
      else state.blackClockMs -= elapsed;

      if (state.whiteClockMs <= 0 || state.blackClockMs <= 0) {
        const result = await this.endGameOnTimeout(gameId, state);
        return { state, result };
      }

      const engineResult = this.engine.applyMove(state.fen, san);
      if (!engineResult.legal) {
        // Illegal-move detection: reject without mutating any persisted state.
        throw new BadRequestException(engineResult.error ?? 'Illegal move');
      }

      // Fischer increment credited to the mover after a legal move.
      if (playerColor === 'w') state.whiteClockMs += state.incrementMs;
      else state.blackClockMs += state.incrementMs;

      state.fen = engineResult.fenAfter!;
      state.turn = engineResult.turn!;
      state.lastMoveAt = Date.now();
      state.moveCount += 1;
      state.drawOfferBy = null; // any move implicitly declines a pending draw offer

      // Threefold repetition is a whole-game property, so it must be tracked
      // here, not trusted to the engine's per-move Chess instance.
      const positionKey = this.engine.positionKey(state.fen);
      const positionCount = (state.positionCounts[positionKey] ?? 0) + 1;
      state.positionCounts[positionKey] = positionCount;
      const isThreefold = positionCount >= 3;

      const result: MoveResult & { winnerColor?: 'white' | 'black' } = {
        ...engineResult,
        isThreefoldRepetition: isThreefold,
        isDraw: engineResult.isDraw || isThreefold,
        isGameOver: engineResult.isGameOver || isThreefold,
      };

      await this.persistState(gameId, state);

      await this.prisma.gameMove.create({
        data: {
          gameId,
          moveNumber: state.moveCount,
          color: playerColor === 'w' ? 'white' : 'black',
          moveSan: result.san!,
          fenAfter: state.fen,
          clockRemainingMs: playerColor === 'w' ? state.whiteClockMs : state.blackClockMs,
        },
      });

      if (result.isGameOver) {
        // state.turn has already flipped to the side who is now "to move" but
        // cannot — on checkmate, the side NOT to move just delivered it and wins.
        const winnerColor: 'white' | 'black' | undefined = result.isCheckmate
          ? state.turn === 'w'
            ? 'black'
            : 'white'
          : undefined; // stalemate / threefold / 50-move / insufficient material -> draw

        await this.finishGame(gameId, { reason: this.gameOverReason(result), forcedWinnerColor: winnerColor });
        return { state, result: { ...result, winnerColor } };
      }

      return { state, result };
    });
  }

  // ==========================================================================
  // DRAW OFFERS
  // ==========================================================================

  async offerDraw(gameId: string, playerColor: 'w' | 'b') {
    return this.redis.withLock(gameId, async () => {
      const state = await this.requireActiveState(gameId);
      state.drawOfferBy = playerColor;
      await this.persistState(gameId, state);
      return state;
    });
  }

  async respondToDraw(gameId: string, respondingColor: 'w' | 'b', accept: boolean) {
    return this.redis.withLock(gameId, async () => {
      const state = await this.requireActiveState(gameId);

      if (!state.drawOfferBy || state.drawOfferBy === respondingColor) {
        throw new BadRequestException('No pending draw offer from your opponent');
      }

      if (!accept) {
        state.drawOfferBy = null;
        await this.persistState(gameId, state);
        return { accepted: false, state };
      }

      await this.finishGame(gameId, { reason: 'draw_agreement' });
      return { accepted: true };
    });
  }

  // ==========================================================================
  // RESIGN / TIMEOUT / DISCONNECT FORFEIT
  // ==========================================================================

  async resign(gameId: string, resigningColor: 'w' | 'b') {
    return this.redis.withLock(gameId, async () => {
      await this.requireActiveState(gameId); // throws if game already over
      const winnerColor = resigningColor === 'w' ? 'black' : 'white';
      await this.finishGame(gameId, { reason: 'resignation', forcedWinnerColor: winnerColor });
      return { winnerColor };
    });
  }

  private async endGameOnTimeout(gameId: string, state: ActiveGameState) {
    const flaggedColor: 'white' | 'black' = state.whiteClockMs <= 0 ? 'white' : 'black';
    const opponentColor: 'white' | 'black' = flaggedColor === 'white' ? 'black' : 'white';

    // FIDE rule: no draw-by-timeout if the flagged player's opponent could
    // still deliver checkmate; only a genuinely unwinnable position draws.
    const isDraw = this.engine.hasInsufficientMatingMaterial(state.fen);

    await this.finishGame(gameId, {
      reason: 'timeout',
      forcedWinnerColor: isDraw ? undefined : opponentColor,
    });

    return {
      legal: false,
      isGameOver: true,
      timeout: true,
      draw: isDraw,
      isDraw,
      winnerColor: isDraw ? undefined : opponentColor,
    };
  }

  /**
   * Server-side clock enforcement. The inline timeout check in applyMove
   * only ran when a move was submitted, so a CONNECTED player who simply
   * stopped moving could stall a real-money match forever. This recomputes
   * elapsed time from the server's own lastMoveAt and settles the game if
   * the side to move has truly flagged.
   *
   * Safe to invoke from any instance or a recovery sweep: the Redis lock
   * serializes against a racing move, the live (never-mutated-unless-
   * flagging) clocks mean an alive game is never persisted stale, and
   * finishGame is idempotent.
   */
  async enforceClockTimeout(gameId: string): Promise<{ gameOver: boolean; winnerColor?: 'white' | 'black' }> {
    return this.redis.withLock(gameId, async () => {
      const state = await this.getActiveState(gameId);
      if (!state) return { gameOver: false };

      const elapsed = Date.now() - state.lastMoveAt;
      const whiteRemaining = state.whiteClockMs - (state.turn === 'w' ? elapsed : 0);
      const blackRemaining = state.blackClockMs - (state.turn === 'b' ? elapsed : 0);

      if (whiteRemaining > 0 && blackRemaining > 0) return { gameOver: false };

      // Flagged — correct only the flagged clock, persist, and settle.
      if (state.turn === 'w') state.whiteClockMs = Math.max(0, whiteRemaining);
      else state.blackClockMs = Math.max(0, blackRemaining);
      await this.persistState(gameId, state);

      const result = await this.endGameOnTimeout(gameId, state);
      return { gameOver: true, winnerColor: result.winnerColor };
    });
  }

  /** Called by the gateway after a disconnect grace period expires with no reconnect. */
  async forfeitOnDisconnect(gameId: string, disconnectedUserId: string) {
    try {
      await this.redis.withLock(gameId, async () => {
        const state = await this.getActiveState(gameId);
        if (!state) return; // game already ended by other means — nothing to do

        const disconnectedColor = await this.getPlayerColor(gameId, disconnectedUserId);
        const winnerColor = disconnectedColor === 'w' ? 'black' : 'white';
        await this.finishGame(gameId, { reason: 'abandonment', forcedWinnerColor: winnerColor });
      });
    } catch (err) {
      // A forfeit is best-effort: the game is already being settled by
      // another path (e.g. a checkmate raced the disconnect) — never let
      // a lock contention or a lost state read crash the gateway timer.
      this.logger.warn(`Forfeit skipped for game ${gameId}: ${(err as Error).message}`);
    }
  }

  // ==========================================================================
  // SETTLEMENT
  // ==========================================================================

  private async finishGame(gameId: string, opts: { reason: string; forcedWinnerColor?: 'white' | 'black' }) {
    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    if (game.status === 'completed') return; // idempotent — already settled by a concurrent path

    const winnerColor: 'white' | 'black' | null = opts.forcedWinnerColor ?? null;
    let gameResult: 'white_win' | 'black_win' | 'draw' = 'draw';

    if (winnerColor) {
      gameResult = winnerColor === 'white' ? 'white_win' : 'black_win';
    }

    const winnerId = winnerColor === 'white' ? game.playerWhiteId : winnerColor === 'black' ? game.playerBlackId : null;
    const loserId = winnerId === game.playerWhiteId ? game.playerBlackId : game.playerWhiteId;

    // Money settles BEFORE the game is marked completed: if settlement fails
    // the game stays 'ongoing', so a retry (or the recovery sweep) can attempt
    // it again. Marking completed first used to strand real-money games — the
    // `status === 'completed'` idempotency guard above would then skip all
    // settlement on every retry. settleMatch/refundDrawEntryFees are
    // themselves idempotency-keyed, so a settle-then-update retry is safe.
    if (winnerId && loserId && Number(game.entryFee) > 0) {
      await this.wallet.settleMatch({
        gameId,
        winnerUserId: winnerId,
        loserUserId: loserId,
        entryFee: Number(game.entryFee),
        commissionPercent: DEFAULT_COMMISSION_PERCENT, // in production, resolved from commission_configs
      });
    } else if (gameResult === 'draw' && Number(game.entryFee) > 0) {
      await this.wallet.refundDrawEntryFees(gameId, game.playerWhiteId, game.playerBlackId, Number(game.entryFee));
    }

    await this.prisma.game.update({
      where: { id: gameId },
      data: { status: 'completed', result: gameResult, winnerId, endedAt: new Date() },
    });

    // Ratings need the time-control CATEGORY. Note: `game.timeControl` holds
    // the display label ("10+0") because startGame overwrote the id — it can't
    // be passed to getTimeControl. The category was stored in Redis alongside
    // the players at startGame time; read it while the players key still exists.
    // Casual games (rated = false) never move Elo — that's the whole point of
    // a casual mode — so the rating write is skipped entirely for them.
    const category = game.rated ? ((await this.getGameCategory(gameId)) ?? null) : null;
    if (category) {
      await this.ratingService.updateRatingsForGame(gameId, category, game.playerWhiteId, game.playerBlackId, gameResult);
    }

    await this.redis.del(this.stateKey(gameId));
    await this.redis.del(this.playersKey(gameId));
    await this.redis.del(this.joinedKey(gameId));

    this.logger.log(`Game ${gameId} settled — ${gameResult}${winnerColor ? ` (winner ${winnerColor})` : ''} via ${opts.reason}`);

    // Anti-cheat analysis is fire-and-forget and only worth running on
    // real-money games with enough moves to be statistically meaningful.
    if (Number(game.entryFee) > 0) {
      this.anticheat.analyzeGameAsync(gameId);
    }

    // Behavior (move-timing) analysis runs on every completed game
    // regardless of stakes — unlike the Stockfish pass above, this is
    // cheap arithmetic on clock data already fetched, not a CPU-heavy
    // engine analysis, so there's no cost reason to gate it to paid games
    // only. Bot/scripted play is worth catching in free mode too — not
    // least because it's exactly where someone would test a script before
    // risking it in a real-money game.
    this.riskScore.runPostGameBehaviorCheck(gameId, game.playerWhiteId, game.playerBlackId);

    // Fair Play detection — the same fire-and-forget pattern as the engine
    // pass above. Runs the live-signal post-game detectors (impossible move
    // speed, win streaks, repeated patterns, collusion) and clears the
    // concurrent-session tracking so a settled game no longer counts as
    // "active" for either player.
    this.fairPlay.onGameEnded(game.playerWhiteId, gameId);
    this.fairPlay.onGameEnded(game.playerBlackId, gameId);
    this.fairPlay.analyzeGameAsync(gameId, opts.reason, loserId ?? undefined);

    // Achievement unlocking runs for every completed game, not just
    // real-money ones — "first win" and "hundred games" are milestones
    // regardless of stakes. Fire-and-forget: AchievementsService itself
    // swallows errors internally rather than ever risking the settlement
    // path above (which is what actually matters to the player).
    this.achievements.checkAndUnlockForUser(game.playerWhiteId);
    this.achievements.checkAndUnlockForUser(game.playerBlackId);

    // Feature-module hooks (e.g. tournament round advancement) — fired last
    // and fire-and-forget so settlement is never delayed or broken by them.
    for (const handler of this.gameSettledHandlers) {
      Promise.resolve(handler(gameId)).catch((err) => {
        this.logger.error(`Game-settled handler failed for game ${gameId}: ${(err as Error).message}`);
      });
    }
  }

  private gameOverReason(result: { isCheckmate?: boolean; isStalemate?: boolean; isDraw?: boolean }): string {
    if (result.isCheckmate) return 'checkmate';
    if (result.isStalemate) return 'stalemate';
    if (result.isDraw) return 'draw_rule'; // threefold / 50-move / insufficient material
    return 'unknown';
  }

  // ==========================================================================
  // REPLAY / PGN EXPORT
  // ==========================================================================

  async getUserHistory(userId: string, take = 20) {
    return this.prisma.game.findMany({
      where: { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      include: {
        playerWhite: { select: { id: true, email: true, fullName: true } },
        playerBlack: { select: { id: true, email: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  async getGameForReplay(gameId: string) {
    const [game, moves] = await Promise.all([
      this.prisma.game.findUnique({
        where: { id: gameId },
        include: { playerWhite: { select: { id: true, fullName: true } }, playerBlack: { select: { id: true, fullName: true } } },
      }),
      this.prisma.gameMove.findMany({ where: { gameId }, orderBy: { moveNumber: 'asc' } }),
    ]);

    if (!game) throw new NotFoundException('Game not found');

    return {
      id: game.id,
      white: game.playerWhite,
      black: game.playerBlack,
      result: game.result,
      timeControl: game.timeControl,
      startedAt: game.startedAt,
      endedAt: game.endedAt,
      moves: moves.map((m) => ({
        moveNumber: m.moveNumber,
        color: m.color,
        san: m.moveSan,
        fen: m.fenAfter,
        clockRemainingMs: m.clockRemainingMs,
      })),
    };
  }

  async exportPgn(gameId: string): Promise<string> {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: { playerWhite: { select: { fullName: true, email: true } }, playerBlack: { select: { fullName: true, email: true } } },
    });
    if (!game) throw new NotFoundException('Game not found');

    const moveRows = await this.prisma.gameMove.findMany({ where: { gameId }, orderBy: { moveNumber: 'asc' } });
    const pgnMoves: PgnMove[] = moveRows.map((m) => ({ moveNumber: m.moveNumber, color: m.color, san: m.moveSan }));

    return buildPgn(
      {
        gameId: game.id,
        whiteName: game.playerWhite.fullName ?? game.playerWhite.email,
        blackName: game.playerBlack.fullName ?? game.playerBlack.email,
        result: game.result,
        timeControlLabel: game.timeControl,
        startedAt: game.startedAt,
        rated: game.rated,
      },
      pgnMoves,
    );
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async requireActiveState(gameId: string): Promise<ActiveGameState> {
    let state = await this.getActiveState(gameId);
    if (!state) {
      // Redis state can vanish on a flush/restart while a game is mid-flight.
      // The DB game_moves rows are the durable source of truth — rebuild the
      // state rather than bricking the match (which previously left a
      // real-money game stuck in 'ongoing' forever with no recovery path).
      state = await this.recoverActiveState(gameId);
    }
    if (!state) throw new NotFoundException('No active game state found — the game may have already ended');

    // Authoritative guard against a stale Redis state: never let a move,
    // draw offer, or resign mutate a game the DB no longer considers
    // 'ongoing'. This closes every path where leftover keys (a failed start,
    // a missed cleanup) could otherwise be moved against.
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      select: { status: true },
    });
    if (game?.status !== 'ongoing') {
      throw new NotFoundException('This game is no longer active');
    }
    return state;
  }

  /**
   * Rebuilds ActiveGameState from the authoritative game_moves rows after a
   * Redis state loss. Deterministic replay gives the exact FEN, turn,
   * position-counts, and per-color clocks (each GameMove row stores the
   * mover's clockRemainingMs); lastMoveAt is the last move's write time.
   * Returns null when there's nothing recoverable (no moves yet / game not
   * ongoing) so callers can decide to abort+refund instead.
   */
  async recoverActiveState(gameId: string): Promise<ActiveGameState | null> {
    const [game, moves] = await Promise.all([
      this.prisma.game.findUnique({ where: { id: gameId } }),
      this.prisma.gameMove.findMany({ where: { gameId }, orderBy: { moveNumber: 'asc' } }),
    ]);
    if (!game || game.status !== 'ongoing' || moves.length === 0) return null;

    const tc = this.timeControlFromLabel(game.timeControl);
    const ordered = moves.slice().sort((a, b) => a.moveNumber - b.moveNumber || (a.color === 'white' ? -1 : 1));

    let fen = this.engine.createNewGame();
    const positionCounts: Record<string, number> = { [this.engine.positionKey(fen)]: 1 };
    let turn: 'w' | 'b' = 'w';
    let whiteClockMs = tc.baseMs;
    let blackClockMs = tc.baseMs;
    let lastMoveAt = game.startedAt?.getTime() ?? Date.now();

    for (const m of ordered) {
      const applied = this.engine.applyMove(fen, m.moveSan);
      if (!applied.legal || !applied.fenAfter || !applied.turn) return null; // corrupt history — never guess
      fen = applied.fenAfter;
      turn = applied.turn;
      const key = this.engine.positionKey(fen);
      positionCounts[key] = (positionCounts[key] ?? 0) + 1;
      if (m.color === 'white') whiteClockMs = m.clockRemainingMs;
      else blackClockMs = m.clockRemainingMs;
      lastMoveAt = m.createdAt.getTime();
    }

    const state: ActiveGameState = {
      fen,
      turn,
      whiteClockMs,
      blackClockMs,
      incrementMs: tc.incrementMs,
      lastMoveAt,
      moveCount: moves.length,
      drawOfferBy: null,
      positionCounts,
    };

    await this.persistState(gameId, state);
    this.logger.warn(`Reconstructed in-memory state for game ${gameId} from move history (${moves.length} moves)`);
    return state;
  }

  /** Parses a TIME_CONTROLS display label ("5+0", "15+10") back into clock parameters — the DB only keeps the label, and state reconstruction needs the increment. */
  private timeControlFromLabel(label: string) {
    const match = /^(\d+(?:\.\d+)?)\s*\+\s*(\d+)$/.exec(String(label ?? '').trim());
    if (!match) throw new Error(`Cannot parse time control label: ${label}`);
    return {
      baseMs: Number(match[1]) * 60_000,
      incrementMs: Number(match[2]) * 1000,
    };
  }

  // ==========================================================================
  // RECOVERY SWEEP (runs on every instance; all operations idempotent)
  // ==========================================================================

  /**
   * Aborts matches created by matchmaking that never got both players into
   * the room — a matched-but-no-show opponent used to leave the other player
   * stuck on "waiting for opponent" forever and both players blocked from
   * re-queueing. Entry fees aren't held in the 'waiting' state, so no
   * wallet work is needed.
   */
  async abortStaleWaitingGames(thresholdMs: number): Promise<{ gameId: string }[]> {
    const cutoff = new Date(Date.now() - thresholdMs);
    const stale = await this.prisma.game.findMany({
      where: { status: 'waiting', createdAt: { lt: cutoff } },
      select: { id: true, playerWhiteId: true, playerBlackId: true, entryFee: true },
    });
    if (stale.length === 0) return [];

    // Feature modules (tournaments) can register exemptions — a tournament
    // match's game legitimately waits for both players until their round
    // starts, and must never be aborted by this sweep.
    const exempt = new Set<string>();
    for (const g of stale) {
      for (const predicate of this.staleWaitingExemptions) {
        if (await predicate(g.id)) {
          exempt.add(g.id);
          break;
        }
      }
    }
    const eligible = stale.filter((g) => !exempt.has(g.id));
    if (eligible.length === 0) return [];

    await this.prisma.$transaction(
      eligible.map((g) =>
        this.prisma.game.update({
          where: { id: g.id },
          data: { status: 'aborted', result: 'aborted', endedAt: new Date() },
        }),
      ),
    );

    for (const g of eligible) {
      await this.redis.del(this.joinedKey(g.id));
      // A failed start (e.g. a balance pre-check that threw) can leave a
      // state/players key on a game that never reached 'ongoing'. Wipe ALL
      // game-scoped keys so a stale state can't be re-read (and moved
      // against) after the game row is aborted.
      await this.redis.del(this.stateKey(g.id));
      await this.redis.del(this.playersKey(g.id));
      // A start that died AFTER the holds committed (see startGame's
      // try/catch) leaves entry fees locked on a 'waiting' row — release any
      // holds so funds are never stranded. releaseEntryFeeHold is a no-op
      // when nothing was held, so the normal no-holds case is unaffected.
      if (Number(g.entryFee) > 0) {
        await this.wallet
          .releaseEntryFeeHold(g.playerWhiteId, Number(g.entryFee), g.id, `release:${g.id}:${g.playerWhiteId}`)
          .catch(() => {});
        await this.wallet
          .releaseEntryFeeHold(g.playerBlackId, Number(g.entryFee), g.id, `release:${g.id}:${g.playerBlackId}`)
          .catch(() => {});
      }
      this.logger.log(`Aborted stale waiting game ${g.id}`);
    }
    return eligible.map((g) => ({ gameId: g.id }));
  }

  /** Recovers 'ongoing' games whose Redis state disappeared; aborts + refunds games that never produced a move (state created, then lost, holds taken). */
  async recoverOngoingGamesWithoutState(): Promise<void> {
    const ongoing = await this.prisma.game.findMany({ where: { status: 'ongoing' }, select: { id: true } });
    for (const { id } of ongoing) {
      if (await this.getActiveState(id)) continue;

      if (await this.recoverActiveState(id)) continue;

      const game = await this.prisma.game.findUnique({ where: { id } });
      if (!game) continue;
      if (Number(game.entryFee) > 0) {
        await this.wallet.refundDrawEntryFees(id, game.playerWhiteId, game.playerBlackId, Number(game.entryFee)).catch((err) => {
          this.logger.error(`Failed to refund entry fees for un-recoverable game ${id}: ${(err as Error).message}`);
        });
      }
      await this.prisma.game.update({
        where: { id },
        data: { status: 'aborted', result: 'aborted', endedAt: new Date() },
      });
      await this.redis.del(this.joinedKey(id));
      await this.redis.del(this.stateKey(id));
      await this.redis.del(this.playersKey(id));
      this.logger.warn(`Aborted un-recoverable ongoing game ${id} and refunded entry fees`);
    }
  }

  /**
   * Safety-net clock enforcement complementing the per-game gateway timers:
   * a gateway instance can be deployed over or crash, losing its in-memory
   * timers. Every N seconds this re-checks each ongoing game's clock against
   * the authoritative Redis state — enforcing the timeout even after a
   * restart. Alive games are skipped WITHOUT taking the per-game lock, so
   * the sweep stays cheap at scale.
   */
  async settleExpiredClocks(): Promise<{ gameId: string; winnerColor?: 'white' | 'black' }[]> {
    const ongoing = await this.prisma.game.findMany({ where: { status: 'ongoing' }, select: { id: true } });
    const settled: { gameId: string; winnerColor?: 'white' | 'black' }[] = [];

    for (const { id } of ongoing) {
      const raw = await this.redis.get(this.stateKey(id));
      if (!raw) continue; // recovered (or refunded/aborted) by recoverOngoingGamesWithoutState
      const state = JSON.parse(raw) as ActiveGameState;
      const elapsed = Date.now() - state.lastMoveAt;
      const remaining = state.turn === 'w' ? state.whiteClockMs - elapsed : state.blackClockMs - elapsed;
      if (remaining > 500) continue; // comfortably alive — don't take the lock

      const outcome = await this.enforceClockTimeout(id);
      if (outcome.gameOver) settled.push({ gameId: id, winnerColor: outcome.winnerColor });
    }
    return settled;
  }

  private async persistState(gameId: string, state: ActiveGameState) {
    await this.redis.set(this.stateKey(gameId), JSON.stringify(state), 'EX', this.STATE_TTL_SEC);
  }
}
