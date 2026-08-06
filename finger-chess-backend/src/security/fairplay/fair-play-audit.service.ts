import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';

/**
 * The single write path for every Fair Play / anti-cheat audit event.
 *
 * Every detection signal, risk-tier change, admin investigation note, and
 * admin decision lands in `security_logs` through this service so that:
 *   - super_admin-only security log reads (`/admin/dashboard/logs/security`)
 *     see one consistent, queryable story per player and per event type, and
 *   - no subsystem sprinkles its own `prisma.securityLog.create` calls with
 *     slightly different shapes that later become un-queryable.
 *
 * Logging is strictly best-effort: a failed audit write NEVER blocks the
 * detection or admin action it records (mirroring the existing auth and
 * AdminAuditService convention). Loud, but non-fatal.
 */
@Injectable()
export class FairPlayAuditService {
  private readonly logger = new Logger(FairPlayAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Records a fair-play security event.
   *
   * `dedupKey` (or the automatic `eventType` default) is rate-limited through
   * Redis: repeated identical events within `dedupWindowSec` seconds are
   * collapsed into one log row. This is essential for noisy live signals
   * (e.g. a reconnect storm could otherwise write dozens of rows per minute)
   * while still guaranteeing at least one durable row per burst. Pass
   * `dedupWindowSec: 0` to force a write every time (used for admin actions,
   * which must never be deduplicated away).
   */
  async recordEvent(params: {
    userId?: string;
    eventType: string;
    metadata?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    dedupWindowSec?: number;
  }): Promise<void> {
    try {
      const windowSec = params.dedupWindowSec ?? 300; // default 5 minutes
      if (windowSec > 0) {
        const dedupKey = `fairplay:audit:${params.eventType}:${params.userId ?? 'global'}`;
        const alreadyLogged = await this.redis.get(dedupKey);
        if (alreadyLogged) return;
        await this.redis.set(dedupKey, '1', 'EX', windowSec);
      }

      await this.prisma.securityLog.create({
        data: {
          userId: params.userId,
          eventType: params.eventType,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent ? params.userAgent.slice(0, 500) : undefined,
          metadata: params.metadata as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write fair-play audit event "${params.eventType}": ${(err as Error).message}`);
    }
  }
}
