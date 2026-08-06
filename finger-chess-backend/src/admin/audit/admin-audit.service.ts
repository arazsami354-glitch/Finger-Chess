import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminAuditService {
  private readonly logger = new Logger(AdminAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every admin-initiated state change goes through here — bans, suspensions,
   * withdrawal/refund decisions, support ticket actions, commission changes.
   * Logging failure never blocks the underlying action (an admin ban
   * succeeding is more important than its audit row), but is always logged
   * loudly to the application logger so a logging outage is itself visible.
   */
  async log(params: {
    adminId: string;
    action: string;
    targetType: string;
    targetId?: string;
    oldValue?: Record<string, unknown>;
    newValue?: Record<string, unknown>;
    ip?: string;
  }) {
    try {
      await this.prisma.adminLog.create({
        data: {
          adminId: params.adminId,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId,
          // Prisma's generated JSON input type (Prisma.InputJsonValue) only
          // accepts values it can statically prove are JSON-safe — a plain
          // `Record<string, unknown>` doesn't qualify on its own, because
          // `unknown` isn't guaranteed assignable to it. The cast here is
          // safe specifically because every caller of `log()` only ever
          // passes plain, already-JSON-safe object literals (see every call
          // site across the admin module) — the parameter stays
          // `Record<string, unknown>` for callers' convenience; only this
          // one boundary into Prisma needs the stricter type.
          oldValue: params.oldValue as Prisma.InputJsonValue | undefined,
          newValue: params.newValue as Prisma.InputJsonValue | undefined,
          ipAddress: params.ip,
        },
      });
    } catch (err) {
      this.logger.error(`Failed to write admin audit log for action "${params.action}": ${(err as Error).message}`);
    }
  }
}
