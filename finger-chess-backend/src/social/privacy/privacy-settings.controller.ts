import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheService } from '../../redis/cache.service';
import { UpdatePrivacySettingsDto } from '../dto/social-requests.dto';
import { PROFILE_SUMMARY_CACHE_KEY } from '../profile/profile-stats.service';

@Controller('social/privacy')
@UseGuards(JwtAuthGuard)
export class PrivacySettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  @Get()
  async get(@CurrentUser() user: { userId: string }) {
    const settings = await this.prisma.privacySettings.findUnique({ where: { userId: user.userId } });
    // Every user gets sane defaults even before they've ever touched this
    // page — the row is created lazily on first read/write rather than at
    // registration time, keeping the registration flow untouched.
    return settings ?? this.prisma.privacySettings.create({ data: { userId: user.userId } });
  }

  @Patch()
  async update(@CurrentUser() user: { userId: string }, @Body() dto: UpdatePrivacySettingsDto) {
    const result = await this.prisma.privacySettings.upsert({
      where: { userId: user.userId },
      create: { userId: user.userId, ...dto },
      update: dto,
    });
    // A privacy change (e.g. showProfileStats toggled off) must take effect
    // immediately for other visitors, not after the cached summary's TTL.
    await this.cache.invalidate(PROFILE_SUMMARY_CACHE_KEY(user.userId));
    return result;
  }
}
