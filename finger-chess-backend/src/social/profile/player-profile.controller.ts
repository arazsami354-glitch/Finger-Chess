import { Controller, ForbiddenException, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { FriendsService } from '../friends/friends.service';
import { AchievementsService } from '../achievements/achievements.service';
import { PresenceService } from '../presence/presence.service';
import { UploadService } from '../../upload/upload.service';
import { ProfileStatsService, PROFILE_SUMMARY_CACHE_KEY, PROFILE_SUMMARY_CACHE_TTL } from './profile-stats.service';
import { classifyOpening } from '../../game/utils/opening-book';

// "Favorite opening" is computed from a bounded recent window, not a
// player's entire history — scanning every game's move list for a player
// who's played thousands of games would be a real, unbounded cost. This
// is an honest "your recent favorite," not a claim of all-time analysis.
const RECENT_GAMES_FOR_OPENING_ANALYSIS = 30;
const RECENT_GAMES_DISPLAYED = 8;
const RATING_HISTORY_POINTS = 50;

@Controller('social/players')
@UseGuards(JwtAuthGuard)
export class PlayerProfileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly friends: FriendsService,
    private readonly achievements: AchievementsService,
    private readonly presence: PresenceService,
    private readonly upload: UploadService,
    private readonly stats: ProfileStatsService,
  ) {}

  @Get(':id')
  async getProfile(@CurrentUser() viewer: { userId: string }, @Param('id') targetId: string) {
    if (await this.friends.isBlocked(viewer.userId, targetId)) {
      throw new ForbiddenException('This profile is not available');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, fullName: true, email: true, avatarKey: true, bio: true, countryCode: true, createdAt: true, privacySettings: true },
    });
    if (!user) throw new NotFoundException('Player not found');

    const [areFriends, achievementsUnlocked, badges, isFavorited, friendsCount] = await Promise.all([
      this.friends.areFriends(viewer.userId, targetId),
      this.achievements.listUnlockedForUser(targetId),
      this.achievements.listBadgesForUser(targetId),
      this.prisma.favoriteOpponent.findUnique({ where: { userId_opponentId: { userId: viewer.userId, opponentId: targetId } } }),
      this.countFriends(targetId),
    ]);

    const showStats = user.privacySettings?.showProfileStats ?? true;
    const showStatus = user.privacySettings?.showOnlineStatus ?? true;

    // The stats block is the expensive part of a profile view (two full-table
    // game aggregates + bounded recent scans) and is purely target-derived,
    // so concurrent visitors share one short-lived computation via the cache.
    // `recentGames` deliberately stays uncached so a freshly finished game
    // appears in the "recent" list immediately even while headline numbers
    // lag their 15-second TTL.
    const [recentGames, summary] = showStats
      ? await Promise.all([
          this.getRecentGames(targetId),
          this.cache.getOrSet(PROFILE_SUMMARY_CACHE_KEY(targetId), PROFILE_SUMMARY_CACHE_TTL, () => this.computeProfileSummary(targetId)),
        ])
      : [[], null];

    const stats = summary?.stats ?? null;
    const favoriteOpening = summary?.favoriteOpening ?? null;
    const ratingHistory = summary?.ratingHistory ?? [];
    const enrichment = summary?.enrichment ?? null;
    // Invisible is masked to offline for anyone but the profile's owner —
    // a stranger browsing your profile should see "Offline", your own
    // profile (viewer === target) shows the honest state.
    const rawStatus = showStatus ? await this.presence.getStatus(targetId) : null;
    const status = rawStatus && rawStatus === 'invisible' && viewer.userId !== targetId ? 'offline' : rawStatus;
    const lastSeenAt = showStatus && status === 'offline' ? await this.presence.getLastSeen(targetId) : null;

    return {
      id: user.id,
      fullName: user.fullName,
      avatarUrl: await this.upload.getAvatarUrl(user.avatarKey),
      bio: user.bio,
      countryCode: user.countryCode,
      memberSince: user.createdAt,
      areFriends,
      isFavorited: !!isFavorited,
      friendsCount,
      presenceStatus: status,
      lastSeenAt,
      title: enrichment?.title ?? null,
      stats,
      enrichment,
      favoriteOpening,
      recentGames,
      ratingHistory,
      achievements: achievementsUnlocked.map((a) => a.achievement),
      badges: badges.map((b) => b.badge),
    };
  }

  private async computeProfileSummary(targetId: string) {
    const [stats, enrichment] = await Promise.all([
      this.computeStats(targetId),
      this.stats.computeProfileEnrichment(targetId),
    ]);
    const [favoriteOpening, ratingHistory] = await Promise.all([
      this.computeFavoriteOpening(targetId),
      this.getRatingHistory(targetId, stats),
    ]);
    return { stats, enrichment, favoriteOpening, ratingHistory };
  }

  private async countFriends(userId: string): Promise<number> {
    return this.prisma.friendship.count({ where: { OR: [{ userAId: userId }, { userBId: userId }] } });
  }

  private async getRecentGames(userId: string) {
    const games = await this.prisma.game.findMany({
      where: { status: 'completed', OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      orderBy: { endedAt: 'desc' },
      take: RECENT_GAMES_DISPLAYED,
      select: {
        id: true,
        result: true,
        winnerId: true,
        entryFee: true,
        timeControl: true,
        endedAt: true,
        playerWhiteId: true,
        playerBlackId: true,
        playerWhite: { select: { id: true, fullName: true } },
        playerBlack: { select: { id: true, fullName: true } },
      },
    });

    return games.map((g) => {
      const isWhite = g.playerWhiteId === userId;
      const opponent = isWhite ? g.playerBlack : g.playerWhite;
      const outcome: 'win' | 'loss' | 'draw' = !g.winnerId ? 'draw' : g.winnerId === userId ? 'win' : 'loss';
      return {
        gameId: g.id,
        opponent: { id: opponent.id, fullName: opponent.fullName },
        outcome,
        entryFee: Number(g.entryFee),
        timeControl: g.timeControl,
        endedAt: g.endedAt,
      };
    });
  }

  /** Classifies each of the user's recent games' opening moves and returns the single most-played one. */
  private async computeFavoriteOpening(userId: string): Promise<{ name: string; count: number } | null> {
    const recentGameIds = await this.prisma.game.findMany({
      where: { status: 'completed', OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
      orderBy: { endedAt: 'desc' },
      take: RECENT_GAMES_FOR_OPENING_ANALYSIS,
      select: { id: true },
    });
    if (recentGameIds.length === 0) return null;

    const moves = await this.prisma.gameMove.findMany({
      where: { gameId: { in: recentGameIds.map((g) => g.id) }, moveNumber: { lte: 6 } },
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

    if (counts.size === 0) return null;
    const [name, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    return { name, count };
  }

  private async getRatingHistory(userId: string, stats: Awaited<ReturnType<PlayerProfileController['computeStats']>>) {
    // Whichever mode the player has actually played most — a graph for a
    // mode they've played twice would be nearly empty and not the useful
    // default view.
    const primaryMode = [...(stats?.ratings ?? [])].sort((a, b) => b.gamesPlayed - a.gamesPlayed)[0]?.gameMode;
    if (!primaryMode) return [];

    const history = await this.prisma.ratingHistory.findMany({
      where: { userId, gameMode: primaryMode },
      orderBy: { createdAt: 'asc' },
      take: RATING_HISTORY_POINTS,
      select: { rating: true, createdAt: true },
    });
    return { gameMode: primaryMode, points: history };
  }

  private async computeStats(userId: string) {
    // Aggregated in SQL (free vs paid bucket) so a heavy player's whole game
    // table isn't shipped to the app server just to count wins/losses.
    const [buckets, ratings] = await Promise.all([
      this.prisma.$queryRaw<Array<{ bucket: string; played: number; wins: number; draws: number }>>`
        SELECT CASE WHEN entry_fee = 0 THEN 'free' ELSE 'paid' END AS bucket,
               COUNT(*)::int AS played,
               COUNT(*) FILTER (WHERE winner_id = ${userId})::int AS wins,
               COUNT(*) FILTER (WHERE result = 'draw')::int AS draws
        FROM games
        WHERE status = 'completed' AND (player_white_id = ${userId} OR player_black_id = ${userId})
        GROUP BY bucket`,
      this.prisma.rating.findMany({ where: { userId } }),
    ]);

    const summarize = (bucket: 'free' | 'paid') => {
      const row = buckets.find((b) => b.bucket === bucket);
      const played = row?.played ?? 0;
      const wins = row?.wins ?? 0;
      const draws = row?.draws ?? 0;
      return {
        gamesPlayed: played,
        wins,
        draws,
        losses: Math.max(0, played - wins - draws),
        winRate: played > 0 ? Number(((wins / played) * 100).toFixed(1)) : 0,
      };
    };

    const freeSummary = summarize('free');
    const paidSummary = summarize('paid');

    return {
      gamesPlayed: freeSummary.gamesPlayed + paidSummary.gamesPlayed,
      wins: freeSummary.wins + paidSummary.wins,
      draws: freeSummary.draws + paidSummary.draws,
      losses: freeSummary.losses + paidSummary.losses,
      winRate:
        freeSummary.gamesPlayed + paidSummary.gamesPlayed > 0
          ? Number((((freeSummary.wins + paidSummary.wins) / (freeSummary.gamesPlayed + paidSummary.gamesPlayed)) * 100).toFixed(1))
          : 0,
      free: freeSummary,
      paid: paidSummary,
      ratings: ratings.map((r) => ({ gameMode: r.gameMode, rating: r.rating, peakRating: r.peakRating, gamesPlayed: r.gamesPlayed })),
    };
  }
}
