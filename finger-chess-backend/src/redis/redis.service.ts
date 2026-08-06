import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const RELEASE_LOCK_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

const DEL_IF_EQUALS_SCRIPT = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(config: ConfigService) {
    super({
      host: config.get<string>('redis.host'),
      port: config.get<number>('redis.port'),
      password: config.get<string>('redis.password'),
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleDestroy() {
    this.disconnect();
  }

  /** Adds a player to a matchmaking queue, scored by rating for range queries. */
  async enqueuePlayer(queueKey: string, userId: string, rating: number) {
    await this.zadd(queueKey, rating, userId);
  }

  async dequeuePlayer(queueKey: string, userId: string) {
    await this.zrem(queueKey, userId);
  }

  /**
   * Atomically attempts to remove a specific member from the queue and
   * reports whether THIS call was the one that actually removed it.
   * ZREM is atomic in Redis, so when two concurrent matchmaking attempts
   * both pick the same waiting candidate, only one of the two ZREM calls
   * returns 1 — the other returns 0 and must treat the candidate as
   * already claimed rather than proceeding to create a second game for
   * the same player. This is what closes the double-match race that a
   * naive "find candidate, then separately remove it" sequence leaves open.
   */
  async claimQueueMember(queueKey: string, userId: string): Promise<boolean> {
    const removed = await this.zrem(queueKey, userId);
    return removed === 1;
  }

  /**
   * Atomically deletes a key only if it currently holds exactly `value`.
   * Used by the cross-instance socket maps so a stale socket's disconnect
   * handler can never clear a fresher mapping left by a reconnect that
   * landed on a different pod.
   */
  async delIfEquals(key: string, value: string): Promise<boolean> {
    const res = await this.eval(DEL_IF_EQUALS_SCRIPT, 1, key, value);
    return res === 1;
  }

  /** Finds candidate opponents within a rating band, ordered by closeness. */
  async findOpponentsInRange(queueKey: string, minRating: number, maxRating: number) {
    return this.zrangebyscore(queueKey, minRating, maxRating);
  }

  /**
   * Serializes a critical section against a Redis key using a short-lived
   * SET NX lock (30s TTL as a safety net against a crashed holder) with an
   * exponential-ish poll for acquisition. Release is a compare-and-delete
   * Lua script so a stale holder's lock can never clobber a newer holder's.
   *
   * Used by GameService to make read-modify-write sequences (move apply,
   * draw offers, resign, disconnect forfeit) atomic — otherwise two
   * near-simultaneous events can both read the same `lastMoveAt` and
   * double-apply a move or race two settlement paths.
   */
  async withLock<T>(key: string, task: () => Promise<T>, opts?: { acquireTimeoutMs?: number }): Promise<T> {
    const lockKey = `lock:${key}`;
    const token = crypto.randomUUID();
    const acquireTimeoutMs = opts?.acquireTimeoutMs ?? 10_000;

    const deadline = Date.now() + acquireTimeoutMs;
    for (;;) {
      const acquired = await this.set(lockKey, token, 'EX', 30, 'NX');
      if (acquired) break;
      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring lock for ${key}`);
      }
      await sleep(25 + Math.floor(Math.random() * 50));
    }

    try {
      return await task();
    } finally {
      try {
        await this.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
      } catch (err) {
        this.logger.warn(`Failed to release lock ${lockKey}: ${(err as Error).message}`);
      }
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
