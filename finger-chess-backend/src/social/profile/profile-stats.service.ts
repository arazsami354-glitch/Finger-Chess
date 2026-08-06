import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { classifyOpening } from '../../game/utils/opening-book';
import { categorize, TIME_CONTROLS, TimeCategory } from '../../game/config/time-controls';
import { AchievementsService } from '../achievements/achievements.service';

/**
 * Bounded windows for the "recent" analytics. Scanning every move of every
 * game a heavy player has ever played would be unbounded cost, so the
 * expensive per-game analyses (openings, average move time) run over a fixed
 * recent window and are honestly labelled "recent" in the UI. Headline
 * aggregates (games, wins, streaks, durations) are exact all-time numbers.
 */
const STREAK_SCAN_LIMIT = 1000;
const FORM_WINDOW = 20;
const OPENINGS_WINDOW = 100;
const MOVE_TIME_WINDOW = 100;
const RATING_HISTORY_POINTS = 60;
const MONTHS_BACK = 12;

const ANALYTICS_CACHE_KEY = (userId: string) => `profile:analytics:${userId}`;
const ANALYTICS_CACHE_TTL = 30;

/**
 * The player-profile page's headline block (stats + enrichment + favorite
 * opening + rating history) is target-derived (never viewer-dependent), so
 * concurrent/back-to-back profile views share one computation instead of each
 * fanning out the profile's 2 full-table game aggregates + several bounded
 * scans. Invalidated on privacy-settings changes so the showProfileStats
 * toggle takes effect immediately.
 */
export const PROFILE_SUMMARY_CACHE_KEY = (userId: string) => `profile:summary:${userId}`;
export const PROFILE_SUMMARY_CACHE_TTL = 15;

const RATING_TITLES: Array<{ min: number; title: string }> = [
  { min: 2000, title: 'Grandmaster' },
  { min: 1800, title: 'International Master' },
  { min: 1600, title: 'Master' },
  { min: 1400, title: 'Expert' },
  { min: 1200, title: 'Club Player' },
  { min: 1000, title: 'Amateur' },
  { min: 0, title: 'Novice' },
];

export type MatchOutcome = 'win' | 'loss' | 'draw';

interface MatchHistoryQuery {
  take?: number;
  cursor?: string;
  result?: 'win' | 'loss' | 'draw';
  mode?: TimeCategory;
  timeControl?: string;
  rated?: boolean;
  search?: string;
}

interface RecentGameRow {
  result: string | null;
  winnerId: string | null;
  endedAt: Date | null;
}

@Injectable()
export class ProfileStatsService {
  private readonly logger = new Logger(ProfileStatsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly achievements: AchievementsService,
  ) {}

  // ==========================================================================
  // HEADLINE STATS (exact, all-time)
  // ==========================================================================

  async computeHeadlineStats(userId: string) {
    const [aggregate, duration] = await Promise.all([
      this.prisma.$queryRaw<Array<{ played: number; wins: number; draws: number }>>`
        SELECT COUNT(*)::int AS played,
               COUNT(*) FILTER (WHERE winner_id = ${userId})::int AS wins,
               COUNT(*) FILTER (WHERE result = 'draw')::int AS draws
        FROM games
        WHERE status = 'completed' AND (player_white_id = ${userId} OR player_black_id = ${userId})`,
      this.prisma.$queryRaw<Array<{ avgSeconds: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (ended_at - started_at)))::float8 AS "avgSeconds"
        FROM games
        WHERE status = 'completed'
          AND (player_white_id = ${userId} OR player_black_id = ${userId})
          AND started_at IS NOT NULL AND ended_at IS NOT NULL`,
    ]);

    const played = aggregate[0]?.played ?? 0;
    const wins = aggregate[0]?.wins ?? 0;
    const draws = aggregate[0]?.draws ?? 0;
    const losses = Math.max(0, played - wins - draws);

    const [recent, ratings, avgMoveTimeSeconds] = await Promise.all([
      this.recentCompleted(userId),
      this.prisma.rating.findMany({ where: { userId }, orderBy: { rating: 'desc' } }),
      this.computeAvgMoveTimeSeconds(userId),
    ]);

    const streaks = this.computeStreaks(userId, recent);
    const ratingsAsc = [...ratings].sort((a, b) => b.gamesPlayed - a.gamesPlayed);

    return {
      gamesPlayed: played,
      wins,
      losses,
      draws,
      winRate: played > 0 ? Number(((wins / played) * 100).toFixed(1)) : 0,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
      avgGameDurationSeconds: duration[0]?.avgSeconds ? Math.round(duration[0].avgSeconds) : null,
      avgMoveTimeSeconds,
      peakRatingOverall: ratings[0]?.peakRating ?? 1200,
      primaryGameMode: ratingsAsc[0]?.gameMode ?? 'blitz',
      recentForm: recent.slice(0, FORM_WINDOW).map((g) => this.outcomeOf(g, userId)),
    };
  }

  /** Player title derived from the highest rating ever reached (all modes). */
  deriveTitle(peakRatingOverall: number, tournamentWins: number): string | null {
    if (tournamentWins > 0) return 'Tournament Champion';
    const entry = RATING_TITLES.find((t) => peakRatingOverall >= t.min);
    return entry?.title ?? 'Novice';
  }

  /**
   * The extra headline fields a profile header shows (title, streaks,
   * durations). Kept separate from computeHeadlineStats so the profile
   * controller can enrich without pulling the whole analytics payload.
   */
  async computeProfileEnrichment(userId: string) {
    const [headline, tournamentWins] = await Promise.all([
      this.computeHeadlineStats(userId),
      this.prisma.$queryRaw<Array<{ wins: number }>>`
        SELECT COUNT(*) FILTER (WHERE final_rank = 1)::int AS wins
        FROM tournament_registrations
        WHERE user_id = ${userId}`,
    ]);

    return {
      title: this.deriveTitle(headline.peakRatingOverall, tournamentWins[0]?.wins ?? 0),
      tournamentWins: tournamentWins[0]?.wins ?? 0,
      currentStreak: headline.currentStreak,
      longestStreak: headline.longestStreak,
      avgGameDurationSeconds: headline.avgGameDurationSeconds,
      avgMoveTimeSeconds: headline.avgMoveTimeSeconds,
      peakRatingOverall: headline.peakRatingOverall,
      primaryGameMode: headline.primaryGameMode,
      recentForm: headline.recentForm,
    };
  }

  // ==========================================================================
  // ANALYTICS (charts + heavy per-game analysis)
  // ==========================================================================

  async computeAnalytics(userId: string) {
    const cached = await this.redis.get(ANALYTICS_CACHE_KEY(userId));
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // corrupted cache — fall through and recompute
      }
    }

    const headline = await this.computeHeadlineStats(userId);

    const [ratingHistory, monthlyActivity, timeControls, openings, tournament, achievements] = await Promise.all([
      this.computeRatingHistory(userId),
      this.computeMonthlyActivity(userId),
      this.computeTimeControls(userId),
      this.computeOpenings(userId),
      this.computeTournamentSummary(userId),
      this.achievements.listWithProgress(userId, {
        gamesPlayed: headline.gamesPlayed,
        gamesWon: headline.wins,
        maxRating: headline.peakRatingOverall,
      }),
    ]);

    const analytics = {
      ratingHistory,
      monthlyActivity,
      winLoss: { wins: headline.wins, losses: headline.losses, draws: headline.draws },
      recentForm: headline.recentForm,
      timeControls,
      openings,
      performanceTrend: monthlyActivity.map((m) => ({
        month: m.month,
        games: m.games,
        wins: m.wins,
        winRate: m.games > 0 ? Number(((m.wins / m.games) * 100).toFixed(1)) : 0,
      })),
      tournament,
      achievements,
    };

    await this.redis.set(ANALYTICS_CACHE_KEY(userId), JSON.stringify(analytics), 'EX', ANALYTICS_CACHE_TTL).catch(() => {});
    return analytics;
  }

  private async computeRatingHistory(userId: string) {
    const ratings = await this.prisma.rating.findMany({ where: { userId }, select: { gameMode: true } });
    const results = await Promise.all(
      ratings.map(async ({ gameMode }) => {
        const points = await this.prisma.ratingHistory.findMany({
          where: { userId, gameMode },
          orderBy: { createdAt: 'asc' },
          take: RATING_HISTORY_POINTS,
          select: { rating: true, createdAt: true },
        });
        return { gameMode, points };
      }),
    );
    return results.filter((r) => r.points.length > 0);
  }

  private async computeMonthlyActivity(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ month: string; games: number; wins: number }>>`
      SELECT TO_CHAR(date_trunc('month', ended_at), 'YYYY-MM') AS month,
             COUNT(*)::int AS games,
             COUNT(*) FILTER (WHERE winner_id = ${userId})::int AS wins
      FROM games
      WHERE status = 'completed'
        AND (player_white_id = ${userId} OR player_black_id = ${userId})
        AND ended_at IS NOT NULL
        AND ended_at >= now() - make_interval(months => ${MONTHS_BACK})
      GROUP BY date_trunc('month', ended_at)
      ORDER BY month`;

    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const out: Array<{ month: string; games: number; wins: number }> = [];
    const now = new Date();
    for (let i = MONTHS_BACK; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      out.push(byMonth.get(key) ?? { month: key, games: 0, wins: 0 });
    }
    return out;
  }

  private async computeTimeControls(userId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ label: string; games: number; wins: number }>>`
      SELECT time_control AS label,
             COUNT(*)::int AS games,
             COUNT(*) FILTER (WHERE winner_id = ${userId})::int AS wins
      FROM games
      WHERE status = 'completed' AND (player_white_id = ${userId} OR player_black_id = ${userId})
      GROUP BY time_control
      ORDER BY games DESC`;

    return rows.map((r) => ({
      label: r.label,
      category: this.categoryOfLabel(r.label),
      games: r.games,
      wins: r.wins,
    }));
  }

  /** Most-played openings over the recent window — "recent favorites", not all-time. */
  private async computeOpenings(userId: string) {
    const gameIds = await this.prisma.game.findMany({
      where: { status: 'completed', OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      orderBy: { endedAt: 'desc' },
      take: OPENINGS_WINDOW,
      select: { id: true },
    });
    if (gameIds.length === 0) return [];

    const moves = await this.prisma.gameMove.findMany({
      where: { gameId: { in: gameIds.map((g) => g.id) }, moveNumber: { lte: 6 } },
      orderBy: [{ gameId: 'asc' }, { moveNumber: 'asc' }],
      select: { gameId: true, moveSan: true },
    });

    const movesByGame = new Map<string, string[]>();
    for (const m of moves) {
      const arr = movesByGame.get(m.gameId) ?? [];
      arr.push(m.moveSan);
      movesByGame.set(m.gameId, arr);
    }

    const counts = new Map<string, number>();
    for (const sanMoves of movesByGame.values()) {
      const opening = classifyOpening(sanMoves);
      if (opening) counts.set(opening, (counts.get(opening) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  private async computeAvgMoveTimeSeconds(userId: string): Promise<number | null> {
    const games = await this.prisma.game.findMany({
      where: { status: 'completed', OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      orderBy: { endedAt: 'desc' },
      take: MOVE_TIME_WINDOW,
      select: { id: true, timeControl: true, playerWhiteId: true, playerBlackId: true },
    });
    if (games.length === 0) return null;

    const moveRows = await this.prisma.gameMove.findMany({
      where: { gameId: { in: games.map((g) => g.id) } },
      orderBy: [{ gameId: 'asc' }, { moveNumber: 'asc' }],
      select: { gameId: true, color: true, clockRemainingMs: true },
    });

    const movesByGame = new Map<string, Array<{ color: string; clockRemainingMs: number }>>();
    for (const m of moveRows) {
      const arr = movesByGame.get(m.gameId) ?? [];
      arr.push({ color: m.color, clockRemainingMs: m.clockRemainingMs });
      movesByGame.set(m.gameId, arr);
    }

    const elapsed: number[] = [];
    for (const game of games) {
      const def = this.definitionOfLabel(game.timeControl);
      if (!def) continue;
      const myColor = game.playerWhiteId === userId ? 'white' : 'black';
      const myMoves = (movesByGame.get(game.id) ?? []).filter((m) => m.color === myColor);

      let prevClock: number | null = null;
      for (const move of myMoves) {
        const seconds =
          prevClock === null
            ? (def.baseMs + def.incrementMs - move.clockRemainingMs) / 1000
            : (prevClock - move.clockRemainingMs + def.incrementMs) / 1000;
        if (Number.isFinite(seconds) && seconds > 0 && seconds < def.baseMs / 1000 + 300) {
          elapsed.push(seconds);
        }
        prevClock = move.clockRemainingMs;
      }
    }

    if (elapsed.length === 0) return null;
    return Number((elapsed.reduce((a, b) => a + b, 0) / elapsed.length).toFixed(1));
  }

  private async computeTournamentSummary(userId: string) {
    const [summary, history] = await Promise.all([
      this.prisma.$queryRaw<Array<{ joined: number; finished: number; wins: number; bestRank: number | null; prizes: number }>>`
        SELECT COUNT(*)::int AS joined,
               COUNT(*) FILTER (WHERE final_rank IS NOT NULL)::int AS finished,
               COUNT(*) FILTER (WHERE final_rank = 1)::int AS wins,
               MIN(final_rank)::int AS "bestRank",
               COALESCE(SUM(prize_amount) FILTER (WHERE paid_out_at IS NOT NULL), 0)::float8 AS prizes
        FROM tournament_registrations
        WHERE user_id = ${userId}`,
      this.prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT r.tournament_id AS "tournamentId",
               r.status AS "status",
               r.final_rank AS "finalRank",
               r.joined_at AS "joinedAt",
               r.eliminated_at AS "eliminatedAt",
               r.prize_amount AS "prizeAmount",
               t.name AS "name",
               t.format AS "format",
               t.time_control AS "timeControl",
               t.status AS "tournamentStatus",
               t.ended_at AS "endedAt"
        FROM tournament_registrations r
        JOIN tournaments t ON t.id = r.tournament_id
        WHERE r.user_id = ${userId}
        ORDER BY r.joined_at DESC
        LIMIT 20`,
    ]);

    return {
      joined: summary[0]?.joined ?? 0,
      finished: summary[0]?.finished ?? 0,
      wins: summary[0]?.wins ?? 0,
      bestRank: summary[0]?.bestRank ?? null,
      prizes: Number(summary[0]?.prizes ?? 0),
      history: history.map((h) => ({
        tournamentId: String(h.tournamentId),
        name: String(h.name ?? 'Unnamed tournament'),
        format: String(h.format ?? 'knockout'),
        timeControl: String(h.timeControl ?? ''),
        status: String(h.status ?? 'registered'),
        finalRank: h.finalRank === null || h.finalRank === undefined ? null : Number(h.finalRank),
        prizeAmount: h.prizeAmount === null || h.prizeAmount === undefined ? 0 : Number(h.prizeAmount),
        joinedAt: h.joinedAt ? new Date(h.joinedAt as string) : null,
        endedAt: h.endedAt ? new Date(h.endedAt as string) : null,
      })),
    };
  }

  // ==========================================================================
  // MATCH HISTORY (paged, filterable)
  // ==========================================================================

  async matchHistory(targetId: string, query: MatchHistoryQuery) {
    const take = Math.min(Math.max(query.take ?? 10, 1), 50);
    const where = this.buildHistoryWhere(targetId, query);

    const games = await this.prisma.game.findMany({
      where: where as never,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      select: {
        id: true,
        result: true,
        winnerId: true,
        rated: true,
        timeControl: true,
        entryFee: true,
        startedAt: true,
        endedAt: true,
        playerWhiteId: true,
        playerBlackId: true,
        playerWhite: { select: { id: true, fullName: true } },
        playerBlack: { select: { id: true, fullName: true } },
      },
    });

    const hasMore = games.length > take;
    const items = hasMore ? games.slice(0, take) : games;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items: items.map((g) => ({
        gameId: g.id,
        result: g.result,
        outcome: this.outcomeOf(g as unknown as RecentGameRow, targetId),
        winnerId: g.winnerId,
        white: { id: g.playerWhite.id, fullName: g.playerWhite.fullName },
        black: { id: g.playerBlack.id, fullName: g.playerBlack.fullName },
        timeControl: g.timeControl,
        rated: g.rated,
        entryFee: Number(g.entryFee),
        startedAt: g.startedAt,
        endedAt: g.endedAt,
      })),
      nextCursor,
    };
  }

  private buildHistoryWhere(targetId: string, query: MatchHistoryQuery): Record<string, unknown> {
    const where: Record<string, unknown> = {
      status: 'completed',
      OR: [{ playerWhiteId: targetId }, { playerBlackId: targetId }],
    };

    if (query.result === 'win') {
      where.winnerId = targetId;
    } else if (query.result === 'loss') {
      where.winnerId = { not: targetId };
      where.result = { not: 'draw' };
    } else if (query.result === 'draw') {
      where.result = 'draw';
    }

    if (query.rated !== undefined) where.rated = query.rated;

    if (query.mode) {
      const labels = Object.values(TIME_CONTROLS)
        .filter((tc) => tc.category === query.mode)
        .map((tc) => tc.label);
      where.timeControl = { in: labels };
    } else if (query.timeControl) {
      where.timeControl = query.timeControl;
    }

    if (query.search?.trim()) {
      const term = query.search.trim();
      const opponentFilter = {
        OR: [
          { fullName: { contains: term, mode: 'insensitive' as const } },
          { email: { contains: term, mode: 'insensitive' as const } },
        ],
      };
      where.OR = [
        { playerWhiteId: targetId, playerBlack: opponentFilter },
        { playerBlackId: targetId, playerWhite: opponentFilter },
      ];
    }

    return where;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async recentCompleted(userId: string): Promise<RecentGameRow[]> {
    return this.prisma.game.findMany({
      where: { status: 'completed', OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      orderBy: { endedAt: 'desc' },
      take: STREAK_SCAN_LIMIT,
      select: { result: true, winnerId: true, endedAt: true },
    });
  }

  private outcomeOf(game: RecentGameRow, userId: string): MatchOutcome {
    if (!game.result || game.result === 'aborted') return 'draw';
    if (game.result === 'draw') return 'draw';
    return game.winnerId === userId ? 'win' : 'loss';
  }

  /** Streaks over the (newest-first) recent scan. Exact for the scanned window. */
  private computeStreaks(userId: string, recent: RecentGameRow[]): { current: number; longest: number } {
    let current = 0;
    for (const g of recent) {
      if (this.outcomeOf(g, userId) === 'win') current += 1;
      else break;
    }

    let longest = 0;
    let run = 0;
    for (const g of recent) {
      if (this.outcomeOf(g, userId) === 'win') {
        run += 1;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
    return { current, longest };
  }

  private categoryOfLabel(label: string): TimeCategory {
    const def = this.definitionOfLabel(label);
    return def?.category ?? 'rapid';
  }

  private definitionOfLabel(label: string): { baseMs: number; incrementMs: number; category: TimeCategory } | null {
    const byLabel = Object.values(TIME_CONTROLS).find((tc) => tc.label === label);
    if (byLabel) return byLabel;
    const match = /^(\d+)\+(\d+)$/.exec((label ?? '').trim());
    if (!match) return null;
    const baseSeconds = Number(match[1]) * 60;
    const incrementSeconds = Number(match[2]);
    return {
      baseMs: baseSeconds * 1000,
      incrementMs: incrementSeconds * 1000,
      category: categorize(baseSeconds, incrementSeconds),
    };
  }
}
