import { Controller, ForbiddenException, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { ProfileStatsService } from './profile-stats.service';
import { TimeCategory } from '../../game/config/time-controls';

@Controller('social/players')
@UseGuards(JwtAuthGuard)
export class ProfileStatsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly stats: ProfileStatsService,
  ) {}

  /**
   * Charts + heavy analytics for a profile. Cached server-side for 30s and
   * rendered in lazy-loaded frontend sections so a profile paints instantly
   * and the expensive per-game analysis runs once per page view, not once
   * per chart.
   */
  @Get(':id/analytics')
  async analytics(@CurrentUser() viewer: { userId: string }, @Param('id') targetId: string) {
    await this.assertViewable(viewer.userId, targetId);
    return this.stats.computeAnalytics(targetId);
  }

  /** Cursor-paginated, filterable match history for a profile. */
  @Get(':id/games')
  async games(
    @CurrentUser() viewer: { userId: string },
    @Param('id') targetId: string,
    @Query('cursor') cursor?: string,
    @Query('take') take?: string,
    @Query('result') result?: 'win' | 'loss' | 'draw',
    @Query('mode') mode?: TimeCategory,
    @Query('timeControl') timeControl?: string,
    @Query('rated') rated?: string,
    @Query('search') search?: string,
  ) {
    await this.assertViewable(viewer.userId, targetId);

    const parsedTake = take ? Number.parseInt(take, 10) : 10;
    const ratedFilter = rated === 'true' ? true : rated === 'false' ? false : undefined;

    return this.stats.matchHistory(targetId, {
      take: Number.isNaN(parsedTake) ? undefined : parsedTake,
      cursor,
      result,
      mode,
      timeControl,
      rated: ratedFilter,
      search,
    });
  }

  private async assertViewable(viewerId: string, targetId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, privacySettings: true },
    });
    if (!target) throw new NotFoundException('Player not found');
    if (await this.friends.isBlocked(viewerId, targetId)) {
      throw new ForbiddenException('This profile is not available');
    }
    const showStats = target.privacySettings?.showProfileStats ?? true;
    if (!showStats) throw new ForbiddenException('This player has made their statistics private');
  }
}
