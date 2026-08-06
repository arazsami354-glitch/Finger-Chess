import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../../common/guards/roles.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminFairPlayService } from './admin-fairplay.service';
import {
  AddFairPlayNoteDto,
  FairPlayPlayerReviewDto,
  ReviewFairPlaySignalDto,
} from '../dto/admin-requests.dto';

// Role mapping mirrors the existing permissions matrix:
//  - risk scores / high-risk queue  -> finance_admin, super_admin
//  - flagged-game queue view        -> moderator+
//  - overview counts                -> all admin roles
const ALL = ['support_agent', 'moderator', 'finance_admin', 'super_admin'];
const MODERATE_UP = ['moderator', 'finance_admin', 'super_admin'];
const FINANCE_UP = ['finance_admin', 'super_admin'];

@Controller('admin/fairplay')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ALL)
export class AdminFairPlayController {
  constructor(private readonly service: AdminFairPlayService) {}

  @Get('overview')
  overview() {
    return this.service.overview();
  }

  @Get('players')
  @Roles(...FINANCE_UP)
  listPlayers(@Query('search') search?: string, @Query('take') take?: string) {
    return this.service.listSuspiciousPlayers({ search, take: take ? Number(take) : undefined });
  }

  @Get('players/:userId')
  @Roles(...FINANCE_UP)
  playerDossier(@Param('userId') userId: string) {
    return this.service.playerDossier(userId);
  }

  @Post('players/:userId/notes')
  @Roles(...FINANCE_UP)
  addNote(
    @CurrentUser() admin: { userId: string },
    @Param('userId') userId: string,
    @Body() dto: AddFairPlayNoteDto,
    @Req() req: Request,
  ) {
    return this.service.addNote(userId, admin.userId, dto.note, req.ip);
  }

  @Post('players/:userId/review')
  @Roles(...FINANCE_UP)
  reviewPlayer(
    @CurrentUser() admin: { userId: string },
    @Param('userId') userId: string,
    @Body() dto: FairPlayPlayerReviewDto,
    @Req() req: Request,
  ) {
    return this.service.reviewPlayer(userId, admin.userId, dto.decision, dto.note, req.ip);
  }

  @Get('matches')
  @Roles(...MODERATE_UP)
  listMatches(@Query('take') take?: string) {
    return this.service.listMatches({ take: take ? Number(take) : undefined });
  }

  @Get('matches/:gameId')
  @Roles(...MODERATE_UP)
  matchDetail(@Param('gameId') gameId: string) {
    return this.service.matchDetail(gameId);
  }

  @Post('signals/:id/review')
  @Roles(...FINANCE_UP)
  reviewSignal(
    @CurrentUser() admin: { userId: string },
    @Param('id') signalId: string,
    @Body() dto: ReviewFairPlaySignalDto,
    @Req() req: Request,
  ) {
    return this.service.reviewSignal(signalId, admin.userId, dto.decision, dto.note, req.ip);
  }
}
