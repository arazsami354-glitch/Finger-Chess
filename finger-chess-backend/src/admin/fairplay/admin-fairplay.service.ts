import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RiskScoreService } from '../../security/risk-score.service';
import { FairPlayAuditService } from '../../security/fairplay/fair-play-audit.service';
import { AdminAuditService } from '../audit/admin-audit.service';

/**
 * Admin review layer for the Fair Play system.
 *
 * Every method here is READ-ONLY on detection data except the explicit
 * review/note actions, which are themselves only metadata writes: they never
 * change chess rules, wallet balances, or game outcomes — they resolve the
 * human-review question "is this flag legitimate or a false positive".
 * All admin state changes are audited through the global AdminAuditService.
 */
@Injectable()
export class AdminFairPlayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly riskScore: RiskScoreService,
    private readonly fairPlayAudit: FairPlayAuditService,
    private readonly audit: AdminAuditService,
  ) {}

  /** Aggregate "fair play health" numbers for the admin overview screen. */
  async overview() {
    const [openSignals, bySeverity, unreviewedAnticheat, highRisk, openCheatingReports, activeCheatingPenalties, recentSignals] =
      await Promise.all([
        this.prisma.fraudSignal.count({ where: { status: 'open', signalType: { startsWith: 'fairplay_' } } }),
        this.prisma.fraudSignal.groupBy({
          by: ['severity'],
          where: { status: 'open', signalType: { startsWith: 'fairplay_' } },
          _count: true,
        }),
        this.prisma.anticheatReport.count({ where: { flagged: true, reviewStatus: 'unreviewed' } }),
        this.prisma.fraudSignal.count({ where: { signalType: 'high_risk_score', status: 'open' } }),
        this.prisma.report.count({
          where: { status: 'open', category: { in: ['cheating', 'match_manipulation'] } },
        }),
        this.prisma.penaltyRecord.count({
          where: {
            category: 'cheating',
            liftedAt: null,
            OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }],
          },
        }),
        this.prisma.fraudSignal.findMany({
          where: { status: 'open', signalType: { startsWith: 'fairplay_' } },
          orderBy: { createdAt: 'desc' },
          take: 15,
        }),
      ]);

    const severityCounts: Record<string, number> = {};
    for (const row of bySeverity) severityCounts[row.severity] = row._count;

    const recentSignalsWithUser = await this.attachUsers(recentSignals);

    return {
      openSignals,
      severityCounts,
      unreviewedAnticheatFlags: unreviewedAnticheat,
      highRiskUsers: highRisk,
      openCheatingReports,
      activeCheatingPenalties,
      recentSignals: recentSignalsWithUser,
    };
  }

  /** FraudSignal has no `user` relation — join user rows manually (same pattern as RiskScoreService.listHighRiskUsers). */
  private async attachUsers<T extends { userId: string }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.userId))];
    if (ids.length === 0) return rows;
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, fullName: true },
    });
    const usersById = new Map(users.map((u) => [u.id, u] as const));
    return rows.map((r) => ({ ...r, user: usersById.get(r.userId) }));
  }

  /** Suspicious player list — every user with an open fair-play or high-risk flag, deduped to one row with their flag count. */
  async listSuspiciousPlayers(params: { search?: string; take?: number }) {
    const signals = await this.prisma.fraudSignal.findMany({
      where: {
        status: 'open',
        OR: [{ signalType: { startsWith: 'fairplay_' } }, { signalType: 'high_risk_score' }],
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });

    const usersById = new Map(
      (
        await this.prisma.user.findMany({
          where: { id: { in: [...new Set(signals.map((s) => s.userId))] } },
          select: { id: true, email: true, fullName: true, status: true, kycStatus: true },
        })
      ).map((u) => [u.id, u] as const),
    );

    const perUser = new Map<string, { latest: (typeof signals)[number]; count: number; severities: string[] }>();
    for (const s of signals) {
      const entry = perUser.get(s.userId);
      if (entry) {
        entry.count += 1;
        if (!entry.severities.includes(s.severity)) entry.severities.push(s.severity);
      } else {
        perUser.set(s.userId, { latest: s, count: 1, severities: [s.severity] });
      }
    }

    let rows = [...perUser.values()];
    if (params.search) {
      const q = params.search.toLowerCase();
      rows = rows.filter((r) => {
        const user = usersById.get(r.latest.userId);
        return (
          user?.email?.toLowerCase().includes(q) ||
          user?.fullName?.toLowerCase().includes(q) ||
          user?.id.toLowerCase().includes(q)
        );
      });
    }

    return rows.map((r) => ({ ...r, user: usersById.get(r.latest.userId) })).slice(0, params.take ?? 50);
  }

  /** Full investigation dossier for one player — every signal, every score, every piece of evidence, chronologically. */
  async playerDossier(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, status: true, kycStatus: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('Player not found');

    const [riskScore, openSignals, allSignals, anticheatReports, penalties, reportsAgainst, recentGames, notes, securityEvents] =
      await Promise.all([
        this.riskScore.getScore(userId, true),
        this.prisma.fraudSignal.findMany({ where: { userId, status: 'open' }, orderBy: { createdAt: 'desc' }, take: 50 }),
        this.prisma.fraudSignal.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 100 }),
        this.prisma.anticheatReport.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
        this.prisma.penaltyRecord.findMany({ where: { userId }, orderBy: { startedAt: 'desc' }, take: 20 }),
        this.prisma.report.findMany({
          where: { reportedUserId: userId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { reporter: { select: { id: true, email: true, fullName: true } } },
        }),
        this.prisma.game.findMany({
          where: { OR: [{ playerWhiteId: userId }, { playerBlackId: userId }], status: 'completed' },
          orderBy: { endedAt: 'desc' },
          take: 10,
        }),
        this.prisma.securityLog.findMany({
          where: { userId, eventType: 'fairplay_investigation_note' },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        this.prisma.securityLog.findMany({
          where: { userId, OR: [{ eventType: { startsWith: 'fairplay:' } }, { eventType: 'risk_tier_change' }] },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
      ]);

    return { user, riskScore, openSignals, allSignals, anticheatReports, penalties, reportsAgainst, recentGames, notes, securityEvents };
  }

  /** Completed games that carry any fair-play flag, for the match review queue. */
  async listMatches(params: { take?: number }) {
    const signals = await this.prisma.fraudSignal.findMany({
      where: { signalType: { startsWith: 'fairplay_' }, referenceType: 'game', referenceId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const gameIds = [...new Set(signals.map((s) => s.referenceId!))];
    const games = await this.prisma.game.findMany({
      where: { id: { in: gameIds } },
      include: {
        playerWhite: { select: { id: true, email: true, fullName: true } },
        playerBlack: { select: { id: true, email: true, fullName: true } },
      },
    });

    const gamesById = new Map(games.map((g) => [g.id, g]));
    const perGame = new Map<string, typeof signals>();
    for (const s of signals) {
      if (!s.referenceId) continue;
      const list = perGame.get(s.referenceId) ?? [];
      list.push(s);
      perGame.set(s.referenceId, list);
    }

    return [...perGame.entries()]
      .map(([gameId, gameSignals]) => ({
        game: gamesById.get(gameId),
        signals: gameSignals,
      }))
      .filter((entry) => entry.game)
      .slice(0, params.take ?? 50);
  }

  /** Full match review view — every move with its clock, every signal, engine report. */
  async matchDetail(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        playerWhite: { select: { id: true, email: true, fullName: true } },
        playerBlack: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!game) throw new NotFoundException('Game not found');

    const [moves, signals, anticheatReports] = await Promise.all([
      this.prisma.gameMove.findMany({ where: { gameId }, orderBy: [{ moveNumber: 'asc' }, { color: 'asc' }] }),
      this.prisma.fraudSignal.findMany({ where: { referenceType: 'game', referenceId: gameId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.anticheatReport.findMany({ where: { gameId } }),
    ]);

    return { game, moves, signals, anticheatReports };
  }

  /** Resolve an open fair-play signal. Audited via both the admin audit trail and the fair-play security log. */
  async reviewSignal(signalId: string, adminId: string, decision: 'reviewed' | 'dismissed' | 'confirmed', note?: string, ip?: string) {
    const signal = await this.prisma.fraudSignal.findUnique({ where: { id: signalId } });
    if (!signal) throw new NotFoundException('Signal not found');

    await this.prisma.fraudSignal.update({
      where: { id: signalId },
      data: { status: decision === 'dismissed' ? 'dismissed' : decision === 'confirmed' ? 'confirmed' : 'reviewed', reviewedBy: adminId },
    });

    await this.audit.log({
      adminId,
      action: `fairplay.signal.${decision}`,
      targetType: 'fraud_signal',
      targetId: signalId,
      oldValue: { status: signal.status, signalType: signal.signalType, userId: signal.userId },
      newValue: { status: decision, note },
      ip,
    });

    await this.fairPlayAudit.recordEvent({
      userId: signal.userId,
      eventType: `fairplay:signal_${decision}`,
      metadata: { signalId, signalType: signal.signalType, adminId, note },
      ipAddress: ip,
      dedupWindowSec: 0,
    });

    return { success: true };
  }

  /** Append an investigation note to a player's dossier. Append-only by design. */
  async addNote(userId: string, adminId: string, note: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Player not found');

    await this.fairPlayAudit.recordEvent({
      userId,
      eventType: 'fairplay_investigation_note',
      metadata: { adminId, note },
      ipAddress: ip,
      dedupWindowSec: 0,
    });

    return { success: true };
  }

  /** Manual admin decision on a player's whole case — marks reviewed or actioned. Never changes game/wallet state. */
  async reviewPlayer(userId: string, adminId: string, decision: 'reviewed' | 'actioned', note?: string, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw new NotFoundException('Player not found');

    await this.audit.log({
      adminId,
      action: `fairplay.player.${decision}`,
      targetType: 'user',
      targetId: userId,
      oldValue: { email: user.email },
      newValue: { decision, note },
      ip,
    });

    await this.fairPlayAudit.recordEvent({
      userId,
      eventType: `fairplay:player_${decision}`,
      metadata: { adminId, note },
      ipAddress: ip,
      dedupWindowSec: 0,
    });

    return { success: true };
  }
}
