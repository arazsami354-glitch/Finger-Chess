import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private dateRange(from?: string, to?: string) {
    return {
      gte: from ? new Date(from) : new Date(Date.now() - 30 * 86_400_000),
      lte: to ? new Date(to) : new Date(),
    };
  }

  /** Platform revenue = sum of commission taken across completed real-money games in the window. */
  async getRevenueSummary(from?: string, to?: string) {
    const range = this.dateRange(from, to);

    const [aggregate, gameCount] = await Promise.all([
      this.prisma.game.aggregate({
        where: { status: 'completed', endedAt: { gte: range.gte, lte: range.lte }, entryFee: { gt: 0 } },
        _sum: { commissionAmount: true, prizeAmount: true, entryFee: true },
      }),
      this.prisma.game.count({
        where: { status: 'completed', endedAt: { gte: range.gte, lte: range.lte }, entryFee: { gt: 0 } },
      }),
    ]);

    const totalCommission = Number(aggregate._sum.commissionAmount ?? 0);
    const totalVolume = Number(aggregate._sum.entryFee ?? 0) * 2; // both players' entry fees combined, per game

    return {
      from: range.gte,
      to: range.lte,
      totalRevenue: totalCommission,
      totalVolume,
      gamesSettled: gameCount,
      averageCommissionPerGame: gameCount > 0 ? Number((totalCommission / gameCount).toFixed(2)) : 0,
      effectiveCommissionRate: totalVolume > 0 ? Number(((totalCommission / totalVolume) * 100).toFixed(2)) : 0,
    };
  }

  /** Commission broken down by entry-fee tier — shows which stakes actually drive revenue. */
  async getCommissionByTier(from?: string, to?: string) {
    const range = this.dateRange(from, to);

    // Postgres does the grouping/summing — a busy platform could have tens
    // of thousands of completed games in a 30-day window, and there are
    // only 5 fixed entry-fee tiers total (see matchmaking/config/entry-fees.ts),
    // so pulling every row into Node just to add five running totals in a
    // JS Map was pure wasted network and memory for a result this small.
    const grouped = await this.prisma.game.groupBy({
      by: ['entryFee'],
      where: { status: 'completed', endedAt: { gte: range.gte, lte: range.lte }, entryFee: { gt: 0 } },
      _sum: { commissionAmount: true },
      _count: true,
    });

    return grouped
      .map((g) => ({
        entryFeeTier: Number(g.entryFee),
        commission: Number(g._sum.commissionAmount ?? 0),
        games: g._count,
      }))
      .sort((a, b) => a.entryFeeTier - b.entryFeeTier);
  }

  /** Daily revenue series for charting. */
  /** Daily revenue series for charting. */
  async getRevenueTimeSeries(from?: string, to?: string) {
    const range = this.dateRange(from, to);

    // $queryRaw is Prisma's tagged-template raw query — parameters are
    // sent separately from the SQL text (same protection as any other
    // parameterized query), unlike $queryRawUnsafe which does string
    // interpolation. Used here because Prisma's query builder has no way to
    // express "group by day-truncated timestamp" — the alternative was
    // pulling every completed game's row over the wire just to truncate
    // and sum in JS, which doesn't scale with game volume the way this does.
    const rows = await this.prisma.$queryRaw<{ day: Date; revenue: string }[]>`
      SELECT date_trunc('day', ended_at) AS day, SUM(commission_amount) AS revenue
      FROM games
      WHERE status = 'completed'
        AND entry_fee > 0
        AND ended_at BETWEEN ${range.gte} AND ${range.lte}
      GROUP BY day
      ORDER BY day ASC
    `;

    return rows.map((r) => ({
      date: r.day.toISOString().slice(0, 10),
      revenue: Number(r.revenue ?? 0),
    }));
  }

  async getDepositsWithdrawalsSummary(from?: string, to?: string) {
    const range = this.dateRange(from, to);

    const [deposits, withdrawals] = await Promise.all([
      this.prisma.deposit.aggregate({
        where: { status: 'success', completedAt: { gte: range.gte, lte: range.lte } },
        _sum: { amount: true },
        _count: true,
      }),
      this.prisma.withdrawal.aggregate({
        where: { status: 'completed', processedAt: { gte: range.gte, lte: range.lte } },
        _sum: { amount: true },
        _count: true,
      }),
    ]);

    return {
      from: range.gte,
      to: range.lte,
      totalDeposited: Number(deposits._sum.amount ?? 0),
      depositCount: deposits._count,
      totalWithdrawn: Number(withdrawals._sum.amount ?? 0),
      withdrawalCount: withdrawals._count,
      netFlow: Number(deposits._sum.amount ?? 0) - Number(withdrawals._sum.amount ?? 0),
    };
  }
}
