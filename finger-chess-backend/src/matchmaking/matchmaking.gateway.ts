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
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MatchmakingService } from './matchmaking.service';
import { JoinQueueDto } from './dto/join-queue.dto';
import { PrismaService } from '../prisma/prisma.service';
import { getTimeControl } from '../game/config/time-controls';
import { WS_CORS_ORIGINS } from '../config/ws-cors';
import { WsRateLimiter } from '../common/ws/ws-rate-limiter';
import { authenticateSocket } from '../common/ws/ws-authenticate';
import { RedisService } from '../redis/redis.service';

interface AuthenticatedSocket extends Socket {
  data: { userId?: string };
}

// Max time a player sits in queue before we give up and tell them —
// scaled by category so a bullet player (who expects a match in seconds)
// doesn't wait as long as someone queueing for a slow classical room.
const QUEUE_TIMEOUT_MS: Record<string, number> = {
  bullet: 45_000,
  blitz: 60_000,
  rapid: 90_000,
  classical: 120_000,
};

// Grace window after an unexpected socket drop before we actually pull a
// queued player out of the queue — covers brief mobile network blips
// without losing their spot.
const DISCONNECT_GRACE_MS = 20_000;

// How long the shared-Redis userId -> socket.id map lives. Must comfortably
// exceed any queue window so a matched player's socket is always resolvable.
const SOCKET_TTL_SEC = 2 * 60 * 60;

@WebSocketGateway({ namespace: '/matchmaking', cors: { origin: WS_CORS_ORIGINS, credentials: true }, maxHttpBufferSize: 4 * 1024 })
export class MatchmakingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MatchmakingGateway.name);

  // userId -> current socket.id for this namespace. Lived in-memory per
  // instance — at 3 replicas, a match between players pinned to different
  // pods would look up the opponent's socket in the WRONG pod's map and the
  // `matchFound` would never be delivered. The mapping is shared via Redis
  // (see socketKey) so any instance can resolve and reach the opponent.
  private readonly queueTimeoutTimers = new Map<string, NodeJS.Timeout>();
  private readonly disconnectGraceTimers = new Map<string, NodeJS.Timeout>();

  // joinQueue already goes through MatchmakingService's own per-user rate
  // limit (assertRateLimitNotExceeded — 10/min, tied to actual queue-join
  // semantics like the duplicate-session check). This second, tighter limit
  // guards the socket layer itself, since a flood of raw socket emits costs
  // a Redis round-trip each before that service-level check even runs.
  private readonly joinQueueRateLimiter = new WsRateLimiter(5, 10_000);
  private readonly heartbeatRateLimiter = new WsRateLimiter(2, 4_000); // client is expected to heartbeat every 5s
  private readonly pingRateLimiter = new WsRateLimiter(2, 1_000); // stateless echo, but still bounded

  constructor(
    private readonly matchmaking: MatchmakingService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const userId = await authenticateSocket(client, this.jwt, this.config, this.redis);
    if (!userId) return;

    await this.redis.set(this.socketKey(userId), client.id, 'EX', SOCKET_TTL_SEC);
    await this.cancelDisconnectGrace(userId);

    // Resume UI state if this socket is reconnecting mid-queue (e.g. after a
    // network blip) rather than starting fresh.
    const existing = await this.matchmaking.getActiveQueueEntry(userId);
    if (existing) {
      await this.matchmaking.refreshPresence(userId);
      const estimatedWaitSeconds = await this.matchmaking.getEstimatedWaitSeconds(existing.room);
      client.emit('queued', { room: existing.room, resumed: true, estimatedWaitSeconds });
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) return;

    // Only clear the shared map if THIS socket is the one registered — a
    // reconnect on another pod may have already overwritten it.
    await this.redis.delIfEquals(this.socketKey(userId), client.id);

    // Only start a grace timer if this user was actually mid-queue —
    // otherwise there's nothing to protect.
    this.matchmaking.getActiveQueueEntry(userId).then((entry) => {
      if (!entry) return;
      void this.scheduleDisconnectGrace(userId, entry.room);
    });
  }

  // ---------------------------------------------------------------------
  // JOIN QUEUE
  // ---------------------------------------------------------------------

  @SubscribeMessage('joinQueue')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async handleJoinQueue(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() dto: JoinQueueDto) {
    const userId = client.data.userId;
    if (!userId) return client.emit('error', { message: 'Not authenticated' });
    if (!this.joinQueueRateLimiter.consume(userId)) {
      return client.emit('error', { message: 'Too many queue attempts too fast' });
    }

    try {
      const tc = getTimeControl(dto.timeControlId);
      const rating = await this.getRating(userId, tc.category);

      const result = await this.matchmaking.joinQueue(userId, rating, dto.timeControlId, dto.entryFee, {
        waitedSeconds: 0,
        rated: dto.rated ?? true,
        colorPreference: dto.colorPreference ?? 'random',
      });

      if (result.matched) {
        this.clearQueueTimeout(userId);
        this.clearQueueTimeout(result.opponentId!);

        client.emit('matchFound', { gameId: result.gameId, opponentId: result.opponentId });

        // The opponent may be connected to a DIFFERENT pod — resolve their
        // socket from shared Redis (see socketKey) and let the Redis Socket.IO
        // adapter route the emit to whichever instance hosts them.
        const opponentSocketId = await this.redis.get(this.socketKey(result.opponentId!));
        if (opponentSocketId) {
          this.server.to(opponentSocketId).emit('matchFound', { gameId: result.gameId, opponentId: userId });
        } else {
          this.logger.warn(`Matched opponent ${result.opponentId} has no live socket to notify — they'll pick up the game on reconnect`);
        }
        return;
      }

      client.emit('queued', {
        room: result.room,
        resumed: false,
        estimatedWaitSeconds: result.estimatedWaitSeconds,
        currentRatingBand: result.currentRatingBand,
      });
      await this.scheduleQueueTimeout(userId, tc.category, result.room!);
    } catch (err) {
      client.emit('error', { message: (err as Error).message });
    }
  }

  // ---------------------------------------------------------------------
  // CANCEL
  // ---------------------------------------------------------------------

  @SubscribeMessage('cancelQueue')
  async handleCancelQueue(@ConnectedSocket() client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) return;

    const entry = await this.matchmaking.getActiveQueueEntry(userId);
    if (!entry) return client.emit('queueCancelled', { wasQueued: false });

    await this.matchmaking.leaveQueue(userId, entry.room);
    this.clearQueueTimeout(userId);
    client.emit('queueCancelled', { wasQueued: true });
  }

  // ---------------------------------------------------------------------
  // HEARTBEAT (keeps the presence key alive so this user is considered a
  // viable match candidate by other players' tryMatch calls)
  // ---------------------------------------------------------------------

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.heartbeatRateLimiter.consume(userId)) return; // silently drop — no need to talk back to a flooding client

    // Only a queued player needs their presence kept alive (tryMatch filters
    // candidates by the presence key) or their queueStatus recomputed. Doing
    // the entry check FIRST means the common case — an open matchmaking
    // socket that isn't currently queued — costs a single Redis GET instead
    // of a GET + SET + LRANGE every 5 seconds.
    const entry = await this.matchmaking.getActiveQueueEntry(userId);
    if (!entry) return;

    await this.matchmaking.refreshPresence(userId);

    const status = await this.matchmaking.getQueueStatus(userId);
    if (status) client.emit('queueStatus', status);
  }

  /**
   * Connection quality — a stateless echo, deliberately: the server does
   * no work beyond bouncing the client's own timestamp back, so this adds
   * essentially zero server cost even at high frequency. The client
   * computes round-trip time itself from the timestamp it sent.
   */
  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() data: { t: number }) {
    const userId = client.data.userId;
    if (!userId) return;
    if (!this.pingRateLimiter.consume(userId)) return; // silently drop — no need to echo a flooding client
    client.emit('pong', { t: data.t });
  }

  // ---------------------------------------------------------------------
  // TIMERS
  // ---------------------------------------------------------------------

  private async scheduleQueueTimeout(userId: string, category: string, room: string) {
    this.clearQueueTimeout(userId);
    const timeoutMs = QUEUE_TIMEOUT_MS[category] ?? QUEUE_TIMEOUT_MS.blitz;

    const timer = setTimeout(async () => {
      this.queueTimeoutTimers.delete(userId);
      // If the player was matched or cancelled meanwhile (their queue entry
      // cleared, possibly on ANOTHER instance that matched them), don't fire a
      // spurious timeout — there is nothing left to expire or notify.
      if (!(await this.matchmaking.getActiveQueueEntry(userId))) return;
      await this.matchmaking.expireQueueEntry(userId, room);
      const currentSocketId = await this.redis.get(this.socketKey(userId));
      if (currentSocketId) {
        this.server.to(currentSocketId).emit('queueTimeout', { room });
      }
    }, timeoutMs);

    this.queueTimeoutTimers.set(userId, timer);
  }

  private clearQueueTimeout(userId: string) {
    const timer = this.queueTimeoutTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.queueTimeoutTimers.delete(userId);
    }
  }

  private async scheduleDisconnectGrace(userId: string, room: string) {
    if (this.disconnectGraceTimers.has(userId)) return;

    // Shared-Redis marker so a reconnect landing on a DIFFERENT pod cancels
    // this timer's effect: the reconnect handler deletes the key, and the
    // timer below re-checks it before pulling the player out of the queue.
    await this.redis.set(this.graceKey(userId), '1', 'EX', DISCONNECT_GRACE_MS + 15_000);

    const timer = setTimeout(async () => {
      this.disconnectGraceTimers.delete(userId);
      const stillDisconnected = await this.redis.exists(this.graceKey(userId));
      if (!stillDisconnected) return; // reconnected on another instance — keep their queue spot
      await this.matchmaking.leaveQueue(userId, room);
      this.clearQueueTimeout(userId);
      this.logger.log(`User ${userId} removed from queue after disconnect grace period expired`);
    }, DISCONNECT_GRACE_MS);

    this.disconnectGraceTimers.set(userId, timer);
  }

  private async cancelDisconnectGrace(userId: string) {
    await this.redis.del(this.graceKey(userId));
    const timer = this.disconnectGraceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectGraceTimers.delete(userId);
    }
  }

  // ---------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------

  private async getRating(userId: string, gameMode: string): Promise<number> {
    const rating = await this.prisma.rating.findUnique({
      where: { userId_gameMode: { userId, gameMode } },
    });
    return rating?.rating ?? 1200;
  }

  private socketKey(userId: string) {
    return `matchmaking:socket:${userId}`;
  }

  private graceKey(userId: string) {
    return `matchmaking:grace:${userId}`;
  }
}
