import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

/**
 * Deliberately unauthenticated and excluded from the global 'api/v1' prefix
 * (see main.ts) — this is infrastructure plumbing (Docker HEALTHCHECK,
 * Kubernetes liveness/readiness probes, load balancer target health) that
 * should live at a stable path independent of API versioning, and should
 * keep responding even if, say, a JWT secret env var were misconfigured,
 * so an infra problem doesn't masquerade as "the whole app is down" when
 * it's actually one specific thing.
 */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Liveness — "is the process alive and able to respond at all." No dependency checks; a slow DB shouldn't fail this and trigger a container restart that won't fix a slow DB. */
  @Get()
  liveness() {
    return { status: 'ok' };
  }

  /** Readiness — "is this instance actually able to serve real traffic right now." Checked by the load balancer / k8s readiness probe before routing traffic to a pod. */
  @Get('ready')
  async readiness() {
    const [dbOk, redisOk] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    const healthy = dbOk && redisOk;
    return {
      status: healthy ? 'ok' : 'degraded',
      checks: { database: dbOk, redis: redisOk },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }
}
