import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CacheService } from '../redis/cache.service';
import { UploadService } from '../upload/upload.service';

const LEADERBOARD_CACHE_TTL_SEC = 30;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly upload: UploadService,
  ) {}

  async updateProfile(userId: string, data: { fullName?: string; countryCode?: string; bio?: string }) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { fullName: data.fullName, countryCode: data.countryCode, bio: data.bio },
      select: { id: true, email: true, fullName: true, countryCode: true, bio: true },
    });
  }

  /**
   * Cached for 30 seconds per game mode. This endpoint is polled by every
   * visitor to the leaderboard page and, unlike a wallet balance or a live
   * game state, has no correctness requirement to be instantaneous — a
   * player's rank being 30 seconds stale after their last game is
   * unnoticeable, while re-running a two-query rank computation on every
   * single page load for every visitor is pure waste. `CacheService`'s
   * stampede protection also means the TTL expiring under load triggers
   * exactly one recomputation, not one per concurrent viewer.
   */
  async getLeaderboard(gameMode: string, take = 50) {
    return this.cache.getOrSet(`leaderboard:${gameMode}:${take}`, LEADERBOARD_CACHE_TTL_SEC, () => this.computeLeaderboard(gameMode, take));
  }

  private async computeLeaderboard(gameMode: string, take: number) {
    const ratings = await this.prisma.rating.findMany({
      where: { gameMode, gamesPlayed: { gt: 0 } },
      orderBy: { rating: 'desc' },
      take,
    });

    // Prisma's Rating model doesn't declare a `user` relation (it stores a
    // plain userId to stay decoupled from the User model's lifecycle), so
    // resolve display info with a second batched query instead of a join.
    const userIds = ratings.map((r) => r.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, email: true, fullName: true },
    });
    const usersById = new Map(users.map((u) => [u.id, u]));

    return ratings.map((r, i) => ({
      rank: i + 1,
      userId: r.userId,
      email: usersById.get(r.userId)?.email ?? 'unknown',
      fullName: usersById.get(r.userId)?.fullName ?? null,
      rating: r.rating,
      gamesPlayed: r.gamesPlayed,
    }));
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        countryCode: true,
        kycStatus: true,
        role: true,
        avatarKey: true,
        bio: true,
        emailVerifiedAt: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    const { avatarKey, ...rest } = user;
    return { ...rest, avatarUrl: await this.upload.getAvatarUrl(avatarKey) };
  }
}
