import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  // In-flight computation per key, so N concurrent cache-miss requests for
  // the same key trigger the expensive query ONCE, not N times — the
  // classic "cache stampede" that hits hardest right after a TTL expires
  // on a popular key (the leaderboard's default "blitz" tab, the dashboard
  // overview every admin has open).
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  async getOrSet<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await this.redis.get(key).catch(() => null);
    if (cached !== null) {
      try {
        return JSON.parse(cached) as T;
      } catch {
        // Corrupt cache entry — fall through and recompute rather than error out.
      }
    }

    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      try {
        const value = await compute();
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch((err) => {
          // Cache write failures must never fail the request — the value
          // is still correct, it just won't be cached this time.
          this.logger.warn(`Cache write failed for key ${key}: ${(err as Error).message}`);
        });
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  async invalidate(keyOrPrefix: string, isPrefix = false) {
    if (!isPrefix) {
      await this.redis.del(keyOrPrefix);
      return;
    }
    // Redis KEYS is O(n) and normally avoided in hot paths, but invalidation
    // is rare (a rating update, an admin action) compared to reads — the
    // tradeoff is fine here. At high key-cardinality scale, switch this to
    // maintaining an explicit SET of keys-to-invalidate instead of a SCAN.
    const stream = this.redis.scanStream({ match: `${keyOrPrefix}*` });
    const keys: string[] = [];
    for await (const batch of stream) {
      keys.push(...(batch as string[]));
    }
    if (keys.length > 0) await this.redis.del(...keys);
  }
}
