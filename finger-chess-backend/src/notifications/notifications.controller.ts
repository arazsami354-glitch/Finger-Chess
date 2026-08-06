import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard, Roles } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { AdminAnnounceDto, UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /** Cursor-paginated history + authoritative unread count in one response. */
  @Get()
  list(
    @CurrentUser() user: { userId: string },
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
  ) {
    const parsedTake = take ? Number.parseInt(take, 10) : 50;
    if (Number.isNaN(parsedTake)) throw new BadRequestException('Invalid take');
    return this.service.list(user.userId, parsedTake, cursor);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: { userId: string }) {
    return this.service.unreadCount(user.userId).then((count) => ({ count }));
  }

  @Post(':id/read')
  markRead(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.service.markRead(user.userId, id);
  }

  @Post('read-all')
  markAllRead(@CurrentUser() user: { userId: string }) {
    return this.service.markAllRead(user.userId);
  }

  @Delete(':id')
  delete(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.service.delete(user.userId, id);
  }

  // ==========================================================================
  // PREFERENCES
  // ==========================================================================

  @Get('preferences')
  getPreferences(@CurrentUser() user: { userId: string }) {
    return this.service.getPreferences(user.userId);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: { userId: string },
    @Body() dto: UpdateNotificationPreferencesDto,
  ) {
    return this.service.updatePreferences(user.userId, dto);
  }

  // ==========================================================================
  // ADMIN — platform-wide announcement
  // ==========================================================================

  @Post('admin/announce')
  @UseGuards(RolesGuard)
  @Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
  announce(@CurrentUser() user: { userId: string }, @Body() dto: AdminAnnounceDto) {
    return this.service.announce(user.userId, dto.title, dto.message);
  }
}
