import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UsePipes, ValidationPipe } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { GameService } from './game.service';
import { MoveDto } from './dto/move.dto';
import { WS_CORS_ORIGINS } from '../config/ws-cors';
import { WsRateLimiter } from '../common/ws/ws-rate-limiter';
import { authenticateSocket } from '../common/ws/ws-authenticate';
import { FairPlayDetectorService } from '../security/fairplay/fair-play-detector.service';
import { PresenceService } from '../social/presence/presence.service';
import { RedisService } from '../redis/redis.service';

interface AuthenticatedSocket extends Socket {
  data: {
    userId?: string;
    role?: 'player' | 'spectator';
    activeGameIds: Set<string>;
  };
}

// Disconnect grace period before a forfeit fires, scaled to time control —
// a bullet player can't reasonably get 2 minutes of grace, a classical
// player shouldn't lose over a 10-second wifi blip.
const GRACE_PERIOD_MS: Record<string, number> = {
  bullet: 15_000,
  blitz: 30_000,
  rapid: 60_000,
  classical: 120_000,
};

// A match that never got both players into the room within this window is
// dead — abort it so the waiting player isn't stranded and neither player is
// blocked from re-queueing by an eternally 'waiting' game row.
const WAITING_GAME_EXPIRY_MS = 120_000;

@WebSocketGateway({ namespace: '/game', cors: { origin: WS_CORS_ORIGINS, credentials: true }, maxHttpBufferSize: 8 * 1024 })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(GameGateway.name);

  // gameId -> userId -> pending forfeit timer. In-memory per gateway
  // instance — fine for a single-instance deploy; at multi-instance scale,
  // move this to a Redis-backed delayed job (e.g. BullMQ) keyed the same
  // way, so a forfeit fires regardless of which instance the socket lands
  // on. Even then the settlement stays safe: forfeitOnDisconnect runs under
  // a Redis lock and finishGame is idempotent.
  private readonly disconnectTimers = new Map<string, NodeJS.Timeout>();

  // gameId -> server-side clock-enforcement timer. The old inline timeout
  // check only ran when a move was submitted, so a connected-but-idle player
  // could stall a real-money match forever. This arms the clock after every
  // move (and at start) and settles the game when the side to move flags.
  // Same multi-instance caveat as disconnectTimers; the recovery sweep
  // (handleRecoverySweep) is the cross-instance safety net for enforcement.
  private readonly clockTimers = new Map<string, NodeJS.Timeout>();

  // gameId -> (userId -> number of open sockets). Prevents a second browser
  // tab closing from forfeiting a player who is still actively playing.
  private readonly gameSocketCounts = new Map<string, Map<string, number>>();

  // 10 moves/second sustained (refilling every second) comfortably covers
  // even a bullet-chess pre-move flurry while making a flood indistinguishable
  // from abuse rather than play.
  private readonly moveRateLimiter = new WsRateLimiter(10, 1000);
  private readonly actionRateLimiter = new WsRateLimiter(5, 5000); // draw offers/responses, resign

  constructor(
    private readonly gameService: GameService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly fairPlay: FairPlayDetectorService,
    private readonly presence: PresenceService,
    private readonly redis: RedisService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    client.data.activeGameIds = new Set();
    // Auth lives in the shared ws-authenticate helper — see it for the
    // ban/suspend revocation check and the token-only-via-auth-payload rule.
    const userId = await authenticateSocket(client, this.jwt, this.config, this.redis);
    if (!userId) return;
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) return;

    for (const gameId of client.data.activeGameIds ?? []) {
      // Only treat the player as gone when their LAST socket in this game
      // closes — closing a second tab used to forfeit someone still playing.
      if (this.dropSocketCount(gameId, userId)) {
        this.logger.log(`Socket left game ${gameId} (user ${userId}) — scheduling forfeit grace`);
        void this.scheduleForfeit(gameId, userId);
        this.server.to(gameId).emit('opponentDisconnected', { userId, gameId });
        // Fair-play live detection: this is the exact moment a player is
        // "really" gone from a game (same condition that starts the forfeit
        // grace clock), so it's the right point to count reconnect abuse.
        void this.fairPlay.onPlayerDisconnected(userId, gameId);
      }
    }
  }

  // ---------------------------------------------------------------------
  // JOIN AS PLAYER (also doubles as the reconnect path)
  // ---------------------------------------------------------------------

  @SubscribeMessage('joinGame')
  async handleJoinGame(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { gameId: string }) {
    const userId = client.data.userId;
    if (!userId) return client.emit('error', { message: 'Not authenticated' });

    const color = await this.gameService.isParticipant(data.gameId, userId);
    if (!color) {
      return client.emit('error', { message: 'You are not a participant in this game' });
    }

    await client.join(data.gameId);
    client.data.role = 'player';
    client.data.activeGameIds.add(data.gameId);
    this.bumpSocketCount(data.gameId, userId);
    // Presence side-effect only — game logic is untouched. Reflect the live
    // "In Match" state to the player's friends, best-effort (a presence
    // failure must never break a game join).
    void this.presence.setUserStatus(userId, 'in_game');
    // Fair-play live detection: re-adds the game to the player's active set
    // (idempotent for the same game) and catches concurrent-session overlap.
    void this.fairPlay.onPlayerJoinedGame(userId, data.gameId);

    // Cross-instance: the pending forfeit timer may live on a DIFFERENT pod
    // (where the player's previous socket dropped). Deleting the shared-Redis
    // marker makes that timer's exists-check fail, so the reconnect cancels
    // the forfeit even when this instance has no local timer to clear.
    await this.cancelPendingForfeit(data.gameId, userId);
    this.server.to(data.gameId).emit('opponentReconnected', { userId, gameId: data.gameId });

    // Shared-Redis marker that this player is physically in the room —
    // startGameIfWaiting won't start the match until BOTH players are marked,
    // so the first joiner waits instead of getting a running clock.
    await this.gameService.markJoined(data.gameId, userId);

    let started: { turn: 'w' | 'b'; whiteClockMs: number; blackClockMs: number } | null = null;
    try {
      started = await this.gameService.startGameIfWaiting(data.gameId);
      if (started) {
        this.scheduleClockTimeout(data.gameId, started);
        this.logger.log(`Game ${data.gameId} started after both players joined`);
      }
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
      return;
    }

    try {
      const snapshot = await this.gameService.getSpectatorSnapshot(data.gameId);
      if (started) {
        // The join that triggered the start broadcasts the fresh state to the
        // WHOLE room. Previously only the joiner received it, leaving the
        // first player stuck on "waiting for your opponent to connect…".
        this.server.to(data.gameId).emit('gameState', snapshot);
      } else {
        client.emit('gameState', snapshot);
      }
    } catch {
      // Snapshot fails when the game hasn't started yet OR already finished.
      const outcome = await this.gameService.getGameOutcomeForReconnect(data.gameId);
      if (outcome) {
        client.emit('gameOver', outcome);
        this.cleanupGame(data.gameId);
      } else if (await this.gameService.isGameWaiting(data.gameId)) {
        client.emit('waitingForOpponent', { gameId: data.gameId });
      } else {
        client.emit('error', { message: 'Unable to load the game right now' });
      }
    }
  }

  // ---------------------------------------------------------------------
  // SPECTATE
  // ---------------------------------------------------------------------

  @SubscribeMessage('spectateGame')
  async handleSpectate(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { gameId: string }) {
    const userId = client.data.userId;
    if (!userId) return client.emit('error', { message: 'Not authenticated' });

    // Live real-money matches are only spectatable by their participants: a
    // live spectator of a paid match is a ghosting vector (they can watch both
    // sides' clocks and feed moves to a friend mid-game). Free matches stay
    // open to everyone.
    if (await this.gameService.isRealMoneyGame(data.gameId)) {
      const participant = await this.gameService.isParticipant(data.gameId, userId);
      if (!participant) {
        return client.emit('error', { message: 'Real-money matches are not open for spectating' });
      }
    }

    try {
      const snapshot = await this.gameService.getSpectatorSnapshot(data.gameId);
      await client.join(data.gameId);
      client.data.role = 'spectator';
      client.emit('gameState', snapshot);
      // Presence side-effect only — reflect "Spectating" to the user's friends.
      void this.presence.setUserStatus(userId, 'spectating');
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------
  // MOVES
  // ---------------------------------------------------------------------

  @SubscribeMessage('move')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleMove(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() dto: MoveDto) {
    const userId = client.data.userId;
    if (!userId) return client.emit('error', { message: 'Not authenticated' });
    if (client.data.role === 'spectator') return client.emit('error', { message: 'Spectators cannot move' });

    if (!this.moveRateLimiter.consume(userId)) {
      return client.emit('error', { message: 'Too many moves too fast — slow down' });
    }

    try {
      const playerColor = await this.gameService.getPlayerColor(dto.gameId, userId);
      const { state, result } = await this.gameService.applyMove(dto.gameId, playerColor, dto.san, dto.expectedMoveCount);

      this.server.to(dto.gameId).emit('moveApplied', {
        san: result.san,
        fen: state.fen,
        turn: state.turn,
        whiteClockMs: state.whiteClockMs,
        blackClockMs: state.blackClockMs,
        lastMoveAt: state.lastMoveAt,
        moveNumber: state.moveCount,
        color: playerColor === 'w' ? 'white' : 'black',
        isCheck: result.isCheck,
        isGameOver: result.isGameOver,
      });

      if (result.isGameOver) {
        this.emitGameOver(dto.gameId, this.gameOverReason(result), result.winnerColor);
        this.cleanupGame(dto.gameId);
      } else {
        this.scheduleClockTimeout(dto.gameId, state);
      }
    } catch (err) {
      client.emit('moveRejected', { message: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------
  // DRAW OFFERS
  // ---------------------------------------------------------------------

  @SubscribeMessage('offerDraw')
  async handleOfferDraw(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { gameId: string }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.actionRateLimiter.consume(userId)) return client.emit('error', { message: 'Too many actions too fast' });
    try {
      const color = await this.gameService.getPlayerColor(data.gameId, userId);
      await this.gameService.offerDraw(data.gameId, color);
      this.server.to(data.gameId).emit('drawOffered', { by: color });
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  @SubscribeMessage('respondDraw')
  async handleRespondDraw(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { gameId: string; accept: boolean },
  ) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.actionRateLimiter.consume(userId)) return client.emit('error', { message: 'Too many actions too fast' });
    try {
      const color = await this.gameService.getPlayerColor(data.gameId, userId);
      const outcome = await this.gameService.respondToDraw(data.gameId, color, data.accept);

      if (outcome.accepted) {
        this.emitGameOver(data.gameId, 'draw_agreement');
        this.cleanupGame(data.gameId);
      } else {
        this.server.to(data.gameId).emit('drawDeclined', { by: color });
      }
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------
  // RESIGN
  // ---------------------------------------------------------------------

  @SubscribeMessage('resign')
  async handleResign(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { gameId: string }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.actionRateLimiter.consume(userId)) return client.emit('error', { message: 'Too many actions too fast' });
    try {
      const color = await this.gameService.getPlayerColor(data.gameId, userId);
      const { winnerColor } = await this.gameService.resign(data.gameId, color);
      this.server.to(data.gameId).emit('gameOver', { reason: 'resignation', resignedBy: userId, winnerColor });
      this.cleanupGame(data.gameId);
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------
  // DISCONNECT / RECONNECT GRACE PERIOD
  // ---------------------------------------------------------------------

  private async scheduleForfeit(gameId: string, userId: string) {
    const key = `${gameId}:${userId}`;
    if (this.disconnectTimers.has(key)) return; // already scheduled

    const category = (await this.gameService.getGameCategory(gameId)) ?? 'blitz';
    const graceMs = GRACE_PERIOD_MS[category] ?? GRACE_PERIOD_MS.blitz;

    const timer = setTimeout(async () => {
      this.disconnectTimers.delete(key);
      // The player may have reconnected to a DIFFERENT pod during grace —
      // their joinGame deleted this shared-Redis marker, so don't forfeit.
      const reconnected = !(await this.redis.exists(this.forfeitKey(gameId, userId)));
      if (reconnected) {
        this.logger.log(`Forfeit cancelled for game ${gameId} user ${userId} — reconnected on another instance`);
        return;
      }
      await this.gameService.forfeitOnDisconnect(gameId, userId);
      this.server.to(gameId).emit('gameOver', { reason: 'abandonment', abandonedBy: userId });
      this.cleanupGame(gameId);
    }, graceMs);

    // TTL = graceMs + buffer, so the marker outlives the timer's own
    // exists-check (otherwise the key could expire before the check ran).
    // Cleared early by a reconnect via cancelPendingForfeit.
    await this.redis.set(this.forfeitKey(gameId, userId), '1', 'EX', Math.ceil((graceMs + 30_000) / 1000));

    this.disconnectTimers.set(key, timer);
    this.logger.log(`Forfeit scheduled for game ${gameId} user ${userId} in ${graceMs}ms`);
  }

  private async cancelPendingForfeit(gameId: string, userId: string) {
    await this.redis.del(this.forfeitKey(gameId, userId));
    const key = `${gameId}:${userId}`;
    const timer = this.disconnectTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(key);
    }
  }

  private forfeitKey(gameId: string, userId: string) {
    return `game:disconnect:${gameId}:${userId}`;
  }

  private clearForfeitTimersForGame(gameId: string) {
    for (const key of this.disconnectTimers.keys()) {
      if (key.startsWith(`${gameId}:`)) {
        clearTimeout(this.disconnectTimers.get(key)!);
        this.disconnectTimers.delete(key);
      }
    }
  }

  // ---------------------------------------------------------------------
  // SERVER-SIDE CLOCK ENFORCEMENT
  // ---------------------------------------------------------------------

  /**
   * Arms a timer for the current side's remaining clock. Fired once the
   * clock should be exhausted; enforceClockTimeout recomputes the true
   * elapsed under a Redis lock (so a racing move wins if it landed first)
   * and only settles when the side to move really did flag. If a move
   * arrived just as it fired, the timer re-arms from the live state.
   */
  private scheduleClockTimeout(gameId: string, state: { turn: 'w' | 'b'; whiteClockMs: number; blackClockMs: number }) {
    this.clearClockTimeout(gameId);
    const remaining = state.turn === 'w' ? state.whiteClockMs : state.blackClockMs;
    if (remaining <= 0) return;

    const timer = setTimeout(async () => {
      this.clockTimers.delete(gameId);
      try {
        const outcome = await this.gameService.enforceClockTimeout(gameId);
        if (outcome.gameOver) {
          this.logger.log(`Clock timeout enforced for game ${gameId}`);
          this.server.to(gameId).emit('gameOver', { reason: 'timeout', winnerColor: outcome.winnerColor });
          this.cleanupGame(gameId);
        } else {
          const live = await this.gameService.getActiveState(gameId);
          if (live) this.scheduleClockTimeout(gameId, live);
        }
      } catch (err) {
        this.logger.warn(`Clock timeout check failed for game ${gameId}: ${(err as Error).message}`);
      }
    }, remaining + 100);

    this.clockTimers.set(gameId, timer);
  }

  private clearClockTimeout(gameId: string) {
    const timer = this.clockTimers.get(gameId);
    if (timer) {
      clearTimeout(timer);
      this.clockTimers.delete(gameId);
    }
  }

  // ---------------------------------------------------------------------
  // MULTI-SOCKET / ROOM STATE TRACKING
  // ---------------------------------------------------------------------

  private bumpSocketCount(gameId: string, userId: string) {
    const counts = this.gameSocketCounts.get(gameId) ?? new Map<string, number>();
    counts.set(userId, (counts.get(userId) ?? 0) + 1);
    this.gameSocketCounts.set(gameId, counts);
  }

  /** Returns true when the player has NO remaining sockets in the game (i.e. should be treated as disconnected). */
  private dropSocketCount(gameId: string, userId: string): boolean {
    const counts = this.gameSocketCounts.get(gameId);
    if (!counts) return true;
    const count = counts.get(userId) ?? 0;
    if (count <= 1) {
      counts.delete(userId);
      if (counts.size === 0) this.gameSocketCounts.delete(gameId);
      return true;
    }
    counts.set(userId, count - 1);
    return false;
  }

  /** All game-scoped in-memory timers/state for a finished game — safe to call from every settlement path. */
  private cleanupGame(gameId: string) {
    this.clearForfeitTimersForGame(gameId);
    this.clearClockTimeout(gameId);
    this.gameSocketCounts.delete(gameId);
    // Presence side-effect: once a game settles, return any still-connected
    // players to their preferred status (online/away/dnd/invisible). Skipped
    // for players who have fully disconnected — their offline path already
    // ran in the social gateway. Best-effort; presence must never hold up
    // game settlement.
    void this.gameService
      .getPlayerIds(gameId)
      .then((ids) => ids.forEach((id) => void this.presence.restoreToPreferredIfConnected(id)))
      .catch(() => undefined);
  }

  // ---------------------------------------------------------------------
  // RECOVERY SWEEP
  // ---------------------------------------------------------------------

  /**
   * Cross-instance safety net that keeps the match lifecycle moving even
   * when in-memory timers are lost (deploy/restart/crash):
   *   1. Aborts matched-but-never-started games (no opponent ever joined).
   *   2. Rebuilds Redis state for 'ongoing' games from DB move history (or
   *      refunds + aborts ones that never produced a move).
   *   3. Enforces expired clocks so a timed-out game settles even after a
   *      restart. Every operation is idempotent, so multiple instances
   *      running the sweep concurrently is harmless.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleRecoverySweep() {
    try {
      const aborted = await this.gameService.abortStaleWaitingGames(WAITING_GAME_EXPIRY_MS);
      for (const { gameId } of aborted) {
        this.cleanupGame(gameId);
        this.server.to(gameId).emit('gameOver', { reason: 'aborted' });
      }

      await this.gameService.recoverOngoingGamesWithoutState();

      const settled = await this.gameService.settleExpiredClocks();
      for (const { gameId, winnerColor } of settled) {
        this.cleanupGame(gameId);
        this.server.to(gameId).emit('gameOver', { reason: 'timeout', winnerColor });
      }
    } catch (err) {
      this.logger.warn(`Recovery sweep failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------

  private emitGameOver(gameId: string, reason: string, winnerColor?: 'white' | 'black') {
    this.server.to(gameId).emit('gameOver', { reason, winnerColor });
  }

  private gameOverReason(result: { timeout?: boolean; isCheckmate?: boolean; isStalemate?: boolean; isDraw?: boolean }): string {
    if (result.timeout) return 'timeout';
    if (result.isCheckmate) return 'checkmate';
    if (result.isStalemate) return 'stalemate';
    return 'draw_rule'; // threefold / 50-move / insufficient material
  }
}
