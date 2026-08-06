import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications.service';

interface AchievementCriteria {
  type: 'games_won' | 'games_played' | 'rating_reached';
  threshold: number;
  gameMode?: string;
}

@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async listCatalog() {
    return this.prisma.achievement.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async listUnlockedForUser(userId: string) {
    return this.prisma.userAchievement.findMany({
      where: { userId },
      include: { achievement: true },
      orderBy: { unlockedAt: 'desc' },
    });
  }

  async listBadgesForUser(userId: string) {
    return this.prisma.userBadge.findMany({
      where: { userId },
      include: { badge: true },
      orderBy: { awardedAt: 'desc' },
    });
  }

  /**
   * Catalog + per-user unlock/progress for the profile achievements section.
   * `stats` is the caller's headline snapshot (games played/won, highest
   * rating) used to compute how close a locked achievement is to unlocking —
   * returning a fraction per achievement keeps the profile page from having
   * to duplicate the criteria interpretation.
   */
  async listWithProgress(
    userId: string,
    stats: { gamesPlayed: number; gamesWon: number; maxRating: number },
  ) {
    const [catalog, unlocked] = await Promise.all([
      this.prisma.achievement.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.userAchievement.findMany({
        where: { userId },
        select: { achievementId: true, unlockedAt: true },
      }),
    ]);

    const unlockedMap = new Map(unlocked.map((u) => [u.achievementId, u.unlockedAt]));

    return catalog.map((achievement) => {
      const criteria = (achievement.criteria ?? {}) as Record<string, unknown>;
      const type = criteria.type as string | undefined;
      const threshold = Number(criteria.threshold ?? 0);
      const progress = this.progressToward(type, threshold, stats);
      return {
        id: achievement.id,
        code: achievement.code,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        unlocked: unlockedMap.has(achievement.id),
        unlockedAt: unlockedMap.get(achievement.id) ?? null,
        threshold,
        progress,
      };
    });
  }

  private progressToward(type: string | undefined, threshold: number, stats: { gamesPlayed: number; gamesWon: number; maxRating: number }): number {
    const value =
      type === 'games_played' ? stats.gamesPlayed : type === 'games_won' ? stats.gamesWon : type === 'rating_reached' ? stats.maxRating : 0;
    return threshold > 0 ? value : 0;
  }

  /**
   * Called from GameService.finishGame after a match settles (see the
   * integration point noted there) — never blocks settlement, since
   * unlocking an achievement a few hundred milliseconds late is invisible
   * to a player but a delayed prize payout is not.
   */
  async checkAndUnlockForUser(userId: string) {
    try {
      const [achievements, alreadyUnlocked, gamesWon, gamesPlayed] = await Promise.all([
        this.prisma.achievement.findMany(),
        this.prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
        this.prisma.game.count({ where: { winnerId: userId, status: 'completed' } }),
        this.prisma.game.count({
          where: { status: 'completed', OR: [{ playerWhiteId: userId }, { playerBlackId: userId }] },
        }),
      ]);

      const unlockedIds = new Set(alreadyUnlocked.map((a) => a.achievementId));
      const stats = { games_won: gamesWon, games_played: gamesPlayed };

      for (const achievement of achievements) {
        if (unlockedIds.has(achievement.id)) continue;
        const criteria = achievement.criteria as unknown as AchievementCriteria;
        const statValue = stats[criteria.type as 'games_won' | 'games_played'];
        if (statValue === undefined || statValue < criteria.threshold) continue;

        await this.prisma.userAchievement.create({ data: { userId, achievementId: achievement.id } });
        await this.prisma.userActivity.create({
          data: { userId, activityType: 'achievement_unlocked', metadata: { achievementCode: achievement.code }, visibility: 'friends' },
        });
        await this.notifications.send(userId, 'in_app', 'achievement_unlocked', 'Achievement unlocked', achievement.name, {
          achievementId: achievement.id,
        });
      }
    } catch (err) {
      // Achievement unlocking is celebratory, not critical-path — a failure
      // here must never propagate up into the settlement flow that called it.
      this.logger.error(`Achievement check failed for user ${userId}: ${(err as Error).message}`);
    }
  }
}
