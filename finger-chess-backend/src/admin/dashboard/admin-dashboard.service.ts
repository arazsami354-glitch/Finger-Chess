import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { PresenceService } from '../../social/presence/presence.service';

const OVERVIEW_CACHE_TTL_SEC = 15;

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly presence: PresenceService,
  ) {}

  /**
   * Cached for 15 seconds — shorter than the frontend's own 30-second poll
   * interval, so a single viewer never perceives staleness, while multiple
   * admins with the dashboard open concurrently (the common case — this is
   * exactly the page staff leave open all shift) share one computation
   * instead of each triggering their own 9-way Promise.all fan-out.
   */
  async getOverview() {
    return this.cache.getOrSet('admin:dashboard:overview', OVERVIEW_CACHE_TTL_SEC, () => this.computeOverview());
  }

  private async computeOverview() {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setUTCDate(startOfToday.getUTCDate() - ((now.getUTCDay() + 6) % 7)); // Monday
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    // Live "online right now" comes from Redis presence keys, not the DB
    // snapshot table — heartbeats refresh Redis TTLs but only snapshot to
    // Postgres on explicit status changes, so the snapshot undercounts.
    // A ZCOUNT over the presence index inside the live window counts exactly
    // the members with an unexpired heartbeat — no full KEYS scan, and it
    // cannot miscount the presence:pref/sockets/snap sibling keys.
    const onlineUsers = await this.presence.countOnlineNow();

    const [
      totalUsers,
      activeUsers,
      newUsersToday,
      newUsersThisWeek,
      emailVerifiedUsers,
      activeFreeGamesNow,
      activePaidGamesNow,
      waitingGamesNow,
      completedGamesToday,
      freeGamesToday,
      paidGamesToday,
      revenueTodayAgg,
      revenueWeekAgg,
      revenueMonthAgg,
      walletTotalsAgg,
      depositsTodayAgg,
      depositsTotalAgg,
      withdrawalsTodayAgg,
      withdrawalsTotalAgg,
      failedTxnsToday,
      failedTxnsTotal,
      pendingWithdrawals,
      pendingRefunds,
      openFraudSignals,
      unreviewedAnticheatFlags,
      openSupportTickets,
      driftedWallets,
      pendingKycDocuments,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: 'active' } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfToday } } }),
      this.prisma.user.count({ where: { createdAt: { gte: startOfWeek } } }),
      this.prisma.user.count({ where: { emailVerifiedAt: { not: null } } }),
      this.prisma.game.count({ where: { status: 'ongoing', entryFee: { equals: 0 } } }),
      this.prisma.game.count({ where: { status: 'ongoing', entryFee: { gt: 0 } } }),
      this.prisma.game.count({ where: { status: 'waiting' } }),
      this.prisma.game.count({ where: { status: 'completed', endedAt: { gte: startOfToday } } }),
      this.prisma.game.count({ where: { createdAt: { gte: startOfToday }, entryFee: { equals: 0 } } }),
      this.prisma.game.count({ where: { createdAt: { gte: startOfToday }, entryFee: { gt: 0 } } }),
      this.prisma.game.aggregate({ where: { status: 'completed', endedAt: { gte: startOfToday } }, _sum: { commissionAmount: true } }),
      this.prisma.game.aggregate({ where: { status: 'completed', endedAt: { gte: startOfWeek } }, _sum: { commissionAmount: true } }),
      this.prisma.game.aggregate({ where: { status: 'completed', endedAt: { gte: startOfMonth } }, _sum: { commissionAmount: true } }),
      this.prisma.wallet.aggregate({ _sum: { availableBalance: true, lockedBalance: true, pendingBalance: true } }),
      this.prisma.deposit.aggregate({ where: { status: 'success', completedAt: { gte: startOfToday } }, _sum: { amount: true }, _count: true }),
      this.prisma.deposit.aggregate({ where: { status: 'success' }, _sum: { amount: true }, _count: true }),
      this.prisma.withdrawal.aggregate({ where: { status: 'completed', processedAt: { gte: startOfToday } }, _sum: { amount: true }, _count: true }),
      this.prisma.withdrawal.aggregate({ where: { status: 'completed' }, _sum: { amount: true }, _count: true }),
      this.prisma.walletTransaction.count({ where: { status: 'failed', createdAt: { gte: startOfToday } } }),
      this.prisma.walletTransaction.count({ where: { status: 'failed' } }),
      this.prisma.withdrawal.count({ where: { status: 'requested' } }),
      this.prisma.refund.count({ where: { status: 'pending' } }),
      this.prisma.fraudSignal.count({ where: { status: 'open' } }),
      this.prisma.anticheatReport.count({ where: { flagged: true, reviewStatus: 'unreviewed' } }),
      this.prisma.supportTicket.count({ where: { status: { in: ['open', 'in_progress'] } } }),
      this.prisma.accountingReconciliationLog.count({ where: { status: 'drift_detected' } }),
      this.prisma.kycDocument.count({ where: { status: 'pending' } }),
    ]);

    const revenueToday = Number(revenueTodayAgg._sum.commissionAmount ?? 0);
    const revenueWeek = Number(revenueWeekAgg._sum.commissionAmount ?? 0);
    const revenueMonth = Number(revenueMonthAgg._sum.commissionAmount ?? 0);

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        online: onlineUsers,
        emailVerified: emailVerifiedUsers,
        newToday: newUsersToday,
        newThisWeek: newUsersThisWeek,
      },
      games: {
        activeNow: activeFreeGamesNow + activePaidGamesNow,
        waitingNow: waitingGamesNow,
        finishedToday: completedGamesToday,
        playedToday: freeGamesToday + paidGamesToday,
        byStatus: { waiting: waitingGamesNow, ongoing: activeFreeGamesNow + activePaidGamesNow, completedToday: completedGamesToday },
        // Revenue only ever comes from paid games (free games never touch
        // WalletService.settleMatch), so this breakdown is the one place
        // on the dashboard where "how much of our activity is actually
        // monetized" is visible at a glance.
        free: { activeNow: activeFreeGamesNow, playedToday: freeGamesToday },
        paid: { activeNow: activePaidGamesNow, playedToday: paidGamesToday },
      },
      revenue: { today: revenueToday, week: revenueWeek, month: revenueMonth },
      commission: { today: revenueToday, week: revenueWeek, month: revenueMonth },
      platformFunds: {
        available: Number(walletTotalsAgg._sum.availableBalance ?? 0),
        locked: Number(walletTotalsAgg._sum.lockedBalance ?? 0),
        pending: Number(walletTotalsAgg._sum.pendingBalance ?? 0),
      },
      payments: {
        depositsToday: Number(depositsTodayAgg._sum.amount ?? 0),
        depositCountToday: depositsTodayAgg._count,
        depositsTotal: Number(depositsTotalAgg._sum.amount ?? 0),
        depositCountTotal: depositsTotalAgg._count,
        withdrawalsToday: Number(withdrawalsTodayAgg._sum.amount ?? 0),
        withdrawalCountToday: withdrawalsTodayAgg._count,
        withdrawalsTotal: Number(withdrawalsTotalAgg._sum.amount ?? 0),
        withdrawalCountTotal: withdrawalsTotalAgg._count,
        failedOperationsToday: failedTxnsToday,
        failedOperationsTotal: failedTxnsTotal,
      },
      queues: {
        pendingWithdrawals,
        pendingRefunds,
        openFraudSignals,
        unreviewedAnticheatFlags,
        openSupportTickets,
        driftedWallets,
        pendingKycDocuments,
      },
    };
  }

  async getAdminLogs(params: { adminId?: string; targetType?: string; take?: number }) {
    return this.prisma.adminLog.findMany({
      where: { adminId: params.adminId, targetType: params.targetType },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100,
    });
  }

  async getSecurityLogs(params: { userId?: string; eventType?: string; take?: number }) {
    return this.prisma.securityLog.findMany({
      where: { userId: params.userId, eventType: params.eventType },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100,
    });
  }
}
