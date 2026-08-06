import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminGamesService } from './admin-games.service';
import { CancelGameDto, ReviewAnticheatDto } from '../dto/admin-requests.dto';

@Controller('admin/games')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('support_agent', 'moderator', 'finance_admin', 'super_admin')
export class AdminGamesController {
  constructor(private readonly service: AdminGamesService) {}

  @Get('live')
  listLive(@Query('mode') mode?: 'free' | 'paid') {
    return this.service.listLive(mode);
  }

  @Get('flagged')
  listFlagged() {
    return this.service.listFlaggedGames();
  }

  @Get(':id')
  getDetail(@Param('id') gameId: string) {
    return this.service.getDetail(gameId);
  }

  @Get(':id/moves')
  getMoves(@Param('id') gameId: string) {
    return this.service.getMoves(gameId);
  }

  @Get()
  list(
    @Query('status') status?: string,
    @Query('mode') mode?: 'free' | 'paid',
    @Query('playerId') playerId?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.list({ status, mode, playerId, search, cursor });
  }

  @Post('anticheat/:reportId/review')
  @Roles('finance_admin', 'super_admin')
  reviewAnticheat(@CurrentUser() admin: { userId: string }, @Param('reportId') reportId: string, @Body() dto: ReviewAnticheatDto) {
    return this.service.reviewAnticheatReport(reportId, admin.userId, dto.decision);
  }

  @Post(':id/cancel')
  @Roles('finance_admin', 'super_admin')
  cancel(@CurrentUser() admin: { userId: string }, @Param('id') gameId: string, @Body() dto: CancelGameDto, @Req() req: Request) {
    return this.service.cancel(gameId, admin.userId, dto.reason, req.ip);
  }
}
