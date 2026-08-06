import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminAuditService } from '../audit/admin-audit.service';
import { RedisService } from '../../redis/redis.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { MailService } from '../../mail/mail.service';

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h, same intent as the self-service flow

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AdminAuditService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
  ) {}

  async list(params: {
    status?: string;
    kycStatus?: string;
    role?: string;
    emailVerified?: string;
    search?: string;
    cursor?: string;
    take?: number;
  }) {
    const take = Math.min(params.take ?? 50, 100);

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.kycStatus) where.kycStatus = params.kycStatus;
    if (params.role) where.role = params.role;
    if (params.emailVerified === 'verified') where.emailVerifiedAt = { not: null };
    if (params.emailVerified === 'unverified') where.emailVerifiedAt = null;
    if (params.search) {
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { fullName: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        kycStatus: true,
        role: true,
        emailVerifiedAt: true,
        createdAt: true,
        // Wallet balances inline so the list doubles as a wallet-status read
        // without a second request per row (fits a 50-row page comfortably).
        wallet: { select: { availableBalance: true, lockedBalance: true, pendingBalance: true, currency: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    });

    const items = rows.slice(0, take);
    return { items, nextCursor: rows.length > take ? items[items.length - 1].id : null };
  }

  async getDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        countryCode: true,
        status: true,
        statusReason: true,
        suspendedUntil: true,
        kycStatus: true,
        role: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        createdAt: true,
        dateOfBirth: true,
        chatMutedUntil: true,
        wallet: { select: { availableBalance: true, lockedBalance: true, pendingBalance: true, currency: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const [gamesPlayed, openFraudSignals, anticheatFlags, openTickets, pendingKycDocuments, currentRulesAccepted] = await Promise.all([
      this.prisma.game.count({ where: { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }], status: 'completed' } }),
      this.prisma.fraudSignal.count({ where: { userId, status: 'open' } }),
      this.prisma.anticheatReport.count({ where: { userId, flagged: true } }),
      this.prisma.supportTicket.count({ where: { userId, status: { in: ['open', 'in_progress'] } } }),
      this.prisma.kycDocument.count({ where: { userId, status: 'pending' } }),
      this.prisma.ruleAcceptance.findFirst({
        where: { userId, version: this.config.get<string>('compliance.platformRulesVersion') },
      }),
    ]);

    return {
      ...user,
      gamesPlayed,
      openFraudSignals,
      anticheatFlags,
      openTickets,
      pendingKycDocuments,
      hasAcceptedCurrentRules: currentRulesAccepted !== null,
      rulesAcceptedAt: currentRulesAccepted?.acceptedAt ?? null,
    };
  }

  async ban(userId: string, adminId: string, reason: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'super_admin') {
      throw new BadRequestException('Cannot ban a super_admin account through this endpoint');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: 'banned', statusReason: reason, suspendedUntil: null },
      }),
      // A ban also kills every active session immediately — no grace period, unlike a password reset.
      this.prisma.session.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
    ]);

    // Closes the access-token window: this account's already-issued access
    // tokens (which the session revocation above can't touch, since they're
    // stateless) now fail on their very next request. See jwt.strategy.ts.
    await this.redis.set(`user:revoked:${userId}`, '1');

    await this.audit.log({
      adminId,
      action: 'user.ban',
      targetType: 'user',
      targetId: userId,
      oldValue: { status: user.status },
      newValue: { status: 'banned', reason },
      ip,
    });

    return { success: true };
  }

  /**
   * `category` drives the DEFAULT suspension length from configured
   * penalty durations (e.g. 'cheating' -> FINGER_CHESS_PENALTY_CHEATING_SUSPENSION_HOURS)
   * — an explicit `until` always takes precedence when the admin provides
   * one. Either way, a PenaltyRecord is written with the duration actually
   * used captured at issuance time, so a later config change never
   * rewrites what a past suspension's length really was.
   */
  async suspend(
    userId: string,
    adminId: string,
    reason: string,
    until: string | undefined,
    ip?: string,
    category: 'cheating' | 'chat_abuse' | 'fraud' | 'other' = 'other',
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'super_admin') {
      throw new BadRequestException('Cannot suspend a super_admin account through this endpoint');
    }

    let suspendedUntil: Date | null;
    let durationHours: number | null;

    if (until) {
      suspendedUntil = new Date(until);
      durationHours = Math.round((suspendedUntil.getTime() - Date.now()) / 3_600_000);
    } else if (category === 'cheating') {
      durationHours = this.config.get<number>('compliance.penaltyCheatingSuspensionHours')!;
      suspendedUntil = new Date(Date.now() + durationHours * 3_600_000);
    } else {
      suspendedUntil = null; // indefinite, pending manual review
      durationHours = null;
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: 'suspended', statusReason: reason, suspendedUntil },
      }),
      this.prisma.session.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
      this.prisma.penaltyRecord.create({
        data: {
          userId,
          penaltyType: 'suspension',
          category,
          reason,
          durationHours: durationHours ?? undefined,
          endsAt: suspendedUntil,
          issuedBy: adminId,
        },
      }),
    ]);

    await this.redis.set(`user:revoked:${userId}`, '1');

    await this.audit.log({
      adminId,
      action: 'user.suspend',
      targetType: 'user',
      targetId: userId,
      oldValue: { status: user.status },
      newValue: { status: 'suspended', reason, until: suspendedUntil, category },
      ip,
    });

    return { success: true };
  }

  async reactivate(userId: string, adminId: string, note: string | undefined, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: 'active', statusReason: null, suspendedUntil: null, failedLoginAttempts: 0, lockedUntil: null },
      }),
      // Mark the most recent active suspension as lifted early, if one exists.
      this.prisma.penaltyRecord.updateMany({
        where: { userId, penaltyType: 'suspension', liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        data: { liftedAt: new Date(), liftedBy: adminId },
      }),
    ]);

    await this.redis.del(`user:revoked:${userId}`);

    await this.audit.log({
      adminId,
      action: 'user.reactivate',
      targetType: 'user',
      targetId: userId,
      oldValue: { status: user.status },
      newValue: { status: 'active', note },
      ip,
    });

    return { success: true };
  }

  /**
   * Chat mute — a much lighter penalty than suspension: the account stays
   * fully usable (matches, wallet, everything), only sending messages is
   * blocked. Enforced via the denormalized `User.chatMutedUntil` field,
   * checked on every message send (see social/messaging/messaging.service.ts).
   */
  async muteChat(
    userId: string,
    adminId: string,
    reason: string,
    ip?: string,
    category: 'cheating' | 'chat_abuse' | 'fraud' | 'other' = 'chat_abuse',
    durationHoursOverride?: number,
  ) {
    const durationHours =
      durationHoursOverride ?? (category === 'chat_abuse' ? this.config.get<number>('compliance.penaltyChatAbuseMuteHours')! : 24);
    const mutedUntil = new Date(Date.now() + durationHours * 3_600_000);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { chatMutedUntil: mutedUntil } }),
      this.prisma.penaltyRecord.create({
        data: {
          userId,
          penaltyType: 'chat_mute',
          category,
          reason,
          durationHours,
          endsAt: mutedUntil,
          issuedBy: adminId,
        },
      }),
    ]);

    await this.audit.log({
      adminId,
      action: 'user.chat_mute',
      targetType: 'user',
      targetId: userId,
      newValue: { mutedUntil, reason, category, durationHours },
      ip,
    });

    return { success: true, mutedUntil };
  }

  async liftChatMute(userId: string, adminId: string, ip?: string) {
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { chatMutedUntil: null } }),
      this.prisma.penaltyRecord.updateMany({
        where: { userId, penaltyType: 'chat_mute', liftedAt: null, endsAt: { gt: new Date() } },
        data: { liftedAt: new Date(), liftedBy: adminId },
      }),
    ]);

    await this.audit.log({ adminId, action: 'user.chat_unmute', targetType: 'user', targetId: userId, ip });
    return { success: true };
  }

  /**
   * The lightest penalty tier — no account restriction at all, unlike a
   * suspension or chat mute. Just a logged notice (in `penalty_records`,
   * same audit trail as every other penalty type) and a notification to
   * the user, so "you're on our radar for X" can be communicated before
   * anything harsher. A pattern of warnings is itself a real signal an
   * admin reviewing penalty history can act on.
   */
  async warnUser(userId: string, adminId: string, reason: string, ip?: string, category: 'cheating' | 'chat_abuse' | 'fraud' | 'other' = 'other') {
    await this.prisma.penaltyRecord.create({
      data: { userId, penaltyType: 'warning', category, reason, issuedBy: adminId },
    });

    await this.notifications.send(userId, 'in_app', 'account_warning', 'Account warning', reason);

    await this.audit.log({ adminId, action: 'user.warn', targetType: 'user', targetId: userId, newValue: { reason, category }, ip });
    return { success: true };
  }

  /**
   * Lifts a permanent ban back to a fully-active account. Unlike reactivate
   * (which targets suspensions), this clears `statusReason` too and is gated
   * on the account actually being banned so a fat-fingered click can't be
   * misread later in the audit trail.
   */
  async unban(userId: string, adminId: string, reason: string | undefined, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'super_admin') {
      throw new BadRequestException('Cannot unban a super_admin account through this endpoint');
    }
    if (user.status !== 'banned') {
      throw new BadRequestException('User is not currently banned');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: 'active', statusReason: null, suspendedUntil: null, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.penaltyRecord.updateMany({
        where: { userId, penaltyType: 'suspension', liftedAt: null },
        data: { liftedAt: new Date(), liftedBy: adminId },
      }),
    ]);

    await this.redis.del(`user:revoked:${userId}`);

    await this.audit.log({
      adminId,
      action: 'user.unban',
      targetType: 'user',
      targetId: userId,
      oldValue: { status: user.status },
      newValue: { status: 'active', reason },
      ip,
    });

    return { success: true };
  }

  /**
   * Explicit "unsuspend" — a lift of a suspension. Shares the restore-to-active
   * mechanics with reactivate but documents the intent in the audit trail and
   * only applies to actually-suspended accounts.
   */
  async unsuspend(userId: string, adminId: string, note: string | undefined, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'suspended') {
      throw new BadRequestException('User is not currently suspended');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { status: 'active', statusReason: null, suspendedUntil: null, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.prisma.penaltyRecord.updateMany({
        where: { userId, penaltyType: 'suspension', liftedAt: null, OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
        data: { liftedAt: new Date(), liftedBy: adminId },
      }),
    ]);

    await this.redis.del(`user:revoked:${userId}`);

    await this.audit.log({
      adminId,
      action: 'user.unsuspend',
      targetType: 'user',
      targetId: userId,
      oldValue: { status: user.status },
      newValue: { status: 'active', note },
      ip,
    });

    return { success: true };
  }

  /**
   * Immediately ends every live session for the account. Unlike a ban this is
   * non-permanent: the access-token revocation flag is given a short TTL equal
   * to the access-token lifetime, so already-issued tokens die on their next
   * request but the user can sign right back in.
   */
  async forceLogout(userId: string, adminId: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await this.prisma.session.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } });
    await this.redis.set(`user:revoked:${userId}`, '1', 'EX', 15 * 60); // 15m = access-token lifetime

    await this.audit.log({
      adminId,
      action: 'user.force_logout',
      targetType: 'user',
      targetId: userId,
      oldValue: { status: user.status },
      newValue: { sessionsRevoked: true },
      ip,
    });

    return { success: true };
  }

  /**
   * Admin-initiated password reset. Rather than inventing a credential the
   * admin would have to relay to the user out-of-band (a phone/chat leak
   * vector), it mirrors the self-service forgot-password flow: a hashed reset
   * token is created and emailed to the account's registered address, and all
   * sessions are revoked so a hijacked one dies immediately.
   */
  async adminResetPassword(userId: string, adminId: string, ip?: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.role === 'super_admin') {
      throw new BadRequestException('Use the standard password flow for super_admin accounts');
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS) },
      }),
      this.prisma.session.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } }),
    ]);

    await this.mail.sendPasswordResetEmail(user.email, rawToken);

    await this.audit.log({
      adminId,
      action: 'user.reset_password',
      targetType: 'user',
      targetId: userId,
      newValue: { emailSent: true },
      ip,
    });

    return { success: true };
  }

  /** Profile edits — limited to safe, non-credential fields. Role changes are deliberately not exposed here. */
  async updateUser(
    userId: string,
    adminId: string,
    data: { fullName?: string; countryCode?: string },
    ip?: string,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(data.fullName !== undefined && { fullName: data.fullName }), ...(data.countryCode !== undefined && { countryCode: data.countryCode }) },
    });

    await this.audit.log({
      adminId,
      action: 'user.update',
      targetType: 'user',
      targetId: userId,
      oldValue: { fullName: user.fullName, countryCode: user.countryCode },
      newValue: { fullName: updated.fullName, countryCode: updated.countryCode },
      ip,
    });

    return { success: true };
  }

  async getPenaltyHistory(userId: string) {
    return this.prisma.penaltyRecord.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
      include: {
        issuer: { select: { id: true, email: true } },
        lifter: { select: { id: true, email: true } },
      },
    });
  }

  async getRuleAcceptanceHistory(userId: string) {
    return this.prisma.ruleAcceptance.findMany({ where: { userId }, orderBy: { acceptedAt: 'desc' } });
  }
}
