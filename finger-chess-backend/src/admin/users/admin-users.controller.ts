import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminUsersService } from './admin-users.service';
import {
  BanUserDto,
  ListUsersQueryDto,
  MuteChatDto,
  ReactivateUserDto,
  SuspendUserDto,
  UnbanUserDto,
  UpdateUserDto,
} from '../dto/admin-requests.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  list(@Query() query: ListUsersQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  getDetail(@Param('id') userId: string) {
    return this.service.getDetail(userId);
  }

  @Get(':id/penalties')
  getPenaltyHistory(@Param('id') userId: string) {
    return this.service.getPenaltyHistory(userId);
  }

  @Get(':id/rule-acceptance')
  getRuleAcceptanceHistory(@Param('id') userId: string) {
    return this.service.getRuleAcceptanceHistory(userId);
  }

  // Ban/suspend/mute are destructive enough to reserve for the higher tiers —
  // support_agent can view everything above but can't act on it here.
  @Post(':id/ban')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  ban(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: BanUserDto, @Req() req: Request) {
    return this.service.ban(userId, admin.userId, dto.reason, req.ip);
  }

  @Post(':id/suspend')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  suspend(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: SuspendUserDto, @Req() req: Request) {
    return this.service.suspend(userId, admin.userId, dto.reason, dto.until, req.ip, dto.category);
  }

  @Post(':id/reactivate')
  @Roles('finance_admin', 'super_admin')
  reactivate(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: ReactivateUserDto, @Req() req: Request) {
    return this.service.reactivate(userId, admin.userId, dto.note, req.ip);
  }

  @Post(':id/mute-chat')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  muteChat(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: MuteChatDto, @Req() req: Request) {
    return this.service.muteChat(userId, admin.userId, dto.reason, req.ip, dto.category, dto.durationHours);
  }

  @Post(':id/unmute-chat')
  @Roles('finance_admin', 'super_admin')
  unmuteChat(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Req() req: Request) {
    return this.service.liftChatMute(userId, admin.userId, req.ip);
  }

  @Post(':id/warn')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  warn(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: MuteChatDto, @Req() req: Request) {
    return this.service.warnUser(userId, admin.userId, dto.reason, req.ip, dto.category);
  }

  @Post(':id/unban')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  unban(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: UnbanUserDto, @Req() req: Request) {
    return this.service.unban(userId, admin.userId, dto.reason, req.ip);
  }

  @Post(':id/unsuspend')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  unsuspend(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: ReactivateUserDto, @Req() req: Request) {
    return this.service.unsuspend(userId, admin.userId, dto.note, req.ip);
  }

  @Post(':id/reset-password')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // emails the user, so bounded harder than other actions
  resetPassword(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Req() req: Request) {
    return this.service.adminResetPassword(userId, admin.userId, req.ip);
  }

  @Post(':id/force-logout')
  @Roles('finance_admin', 'super_admin')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  forceLogout(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Req() req: Request) {
    return this.service.forceLogout(userId, admin.userId, req.ip);
  }

  @Put(':id')
  update(@CurrentUser() admin: { userId: string }, @Param('id') userId: string, @Body() dto: UpdateUserDto, @Req() req: Request) {
    return this.service.updateUser(userId, admin.userId, dto, req.ip);
  }
}
