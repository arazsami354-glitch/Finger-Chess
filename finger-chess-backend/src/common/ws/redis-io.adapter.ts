import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Without this, Socket.IO keeps room membership and broadcast routing
 * entirely in the memory of whichever single process handled a given
 * connection. That's invisible in development (one process, of course
 * `server.to(gameId).emit(...)` reaches both players) and silently broken
 * the moment this app runs as more than one instance behind a load
 * balancer: if two players in the same game land on different instances —
 * which a load balancer will do by default — a move made by one would
 * never reach the other, since `server.to(room).emit()` only broadcasts to
 * sockets known to *that process*.
 *
 * The Redis adapter fixes this by having every instance publish room
 * events through Redis pub/sub instead of only checking its own local
 * socket map — `server.to(gameId).emit(...)` now correctly reaches a
 * player connected to a completely different instance.
 *
 * This does NOT make the gateways' other in-memory state (disconnect
 * timers, the WsRateLimiter buckets, the onlineSockets map in
 * MatchmakingGateway) instance-safe — those still need the Redis-backed
 * versions called out as follow-up work in SECURITY_AUDIT.md and the game/
 * matchmaking READMEs. This adapter solves message delivery specifically;
 * it's the prerequisite for horizontal scaling, not the whole of it.
 *
 * Load balancer requirement: sticky sessions (session affinity) are still
 * required so a single client's Socket.IO polling/upgrade handshake
 * consistently reaches the same instance during connection setup — the
 * Redis adapter solves cross-instance BROADCAST, not the initial handshake.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: ReturnType<typeof createAdapter>;
  private pubClient?: Redis;
  private subClient?: Redis;

  constructor(private readonly app: INestApplicationContext) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const config = this.app.get(ConfigService);
    const host = config.get<string>('redis.host');
    const port = config.get<number>('redis.port');
    const password = config.get<string>('redis.password');

    const pubClient = new Redis({ host, port, password });
    const subClient = pubClient.duplicate();

    pubClient.on('error', (err) => this.logger.error(`Redis pub client error: ${err.message}`));
    subClient.on('error', (err) => this.logger.error(`Redis sub client error: ${err.message}`));

    this.pubClient = pubClient;
    this.subClient = subClient;
    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log('Socket.IO Redis adapter connected — WebSocket broadcasts now work across instances');
  }

  /**
   * Closes the Socket.IO pub/sub clients during graceful shutdown. These two
   * connections are owned by the adapter, not by a Nest provider, so the
   * application's shutdown hooks (RedisService/PrismaService's OnModuleDestroy)
   * never touch them — without this, a SIGTERM during a rolling rollout leaves
   * both sockets dangling until the process is killed by the orchestrator.
   */
  disconnectClients(): void {
    this.pubClient?.disconnect();
    this.subClient?.disconnect();
    this.pubClient = undefined;
    this.subClient = undefined;
    this.adapterConstructor = undefined;
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    } else {
      this.logger.warn('Redis adapter not initialized before server creation — call connectToRedis() first. Falling back to in-memory adapter (single-instance only).');
    }
    return server;
  }
}
