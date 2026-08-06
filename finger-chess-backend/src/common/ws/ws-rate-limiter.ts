/**
 * ThrottlerModule (see app.module.ts) only guards HTTP routes — every
 * @SubscribeMessage handler in game.gateway.ts, matchmaking.gateway.ts, and
 * social.gateway.ts needed its own throttling. A single malicious or
 * just-buggy client could emit 'move' or 'heartbeat' as fast as the socket
 * would carry them; 'move' in particular triggers a database write per
 * call (GameMove.create), so an unthrottled flood is a direct DB-load DoS
 * vector, not just wasted CPU.
 *
 * This is a simple per-key (userId + event name) token bucket, in-memory —
 * matching the same "fine for one instance, needs a Redis-backed version at
 * multi-instance scale" caveat already called out for the disconnect-grace
 * and queue-timeout timers elsewhere in this codebase.
 *
 * BUG FIX (lead-engineer review pass): a `sweep()` cleanup method existed
 * here but was never actually called from anywhere in the codebase — every
 * distinct userId that ever connected to a rate-limited gateway left a
 * permanent entry in `buckets`, for the lifetime of the process, even long
 * after that user disconnected and never returned. On a platform targeting
 * "millions of concurrent users" over any real uptime, that's an
 * unbounded memory leak, not a theoretical one. Fixed by having each
 * instance schedule its own periodic sweep internally — callers get
 * automatic cleanup for free instead of needing to remember to wire it up
 * (which is exactly how it was missed the first time).
 */
export class WsRateLimiter {
  private readonly buckets = new Map<string, { tokens: number; lastRefill: number }>();
  private readonly sweepInterval: NodeJS.Timeout;

  constructor(
    private readonly maxTokens: number,
    private readonly refillIntervalMs: number,
  ) {
    // A bucket is only ever "stale" once it's well past its own refill
    // window with no activity — 10x the refill interval, floored at 60s,
    // is a comfortably safe margin that never evicts a bucket still in
    // active use. The sweep itself runs on the same cadence.
    const sweepEveryMs = Math.max(this.refillIntervalMs * 10, 60_000);
    this.sweepInterval = setInterval(() => this.sweep(sweepEveryMs), sweepEveryMs);
    this.sweepInterval.unref?.(); // never keep the Node process alive on its own just for this
  }

  /** Returns true if the call is allowed, false if the caller is over the limit. */
  consume(key: string): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.maxTokens, lastRefill: now };

    const elapsed = now - bucket.lastRefill;
    if (elapsed > this.refillIntervalMs) {
      bucket.tokens = this.maxTokens;
      bucket.lastRefill = now;
    }

    if (bucket.tokens <= 0) {
      this.buckets.set(key, bucket);
      return false;
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return true;
  }

  private sweep(maxAgeMs: number) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) this.buckets.delete(key);
    }
  }

  /** Called from the owning gateway's onModuleDestroy, if it has one — stops the sweep timer from outliving the object that created it. Safe to skip: `unref()` above already means it won't keep the process alive on its own. */
  dispose() {
    clearInterval(this.sweepInterval);
  }
}
