import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { Roles, RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentService } from './tournament.service';
import { CancelTournamentDto, CreateTournamentDto, UpdateTournamentDto } from './dto/tournament-requests.dto';
import { AdminAuditService } from '../admin/audit/admin-audit.service';

// Tournament management touches money (entry fees, prize pools) and the live
// bracket, so every write is finance_admin/super_admin; read-only views are
// open to all admin roles.
const ALL = ['support_agent', 'moderator', 'finance_admin', 'super_admin'];
const FINANCE_UP = ['finance_admin', 'super_admin'];

@Controller('admin/tournaments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...ALL)
export class AdminTournamentController {
  constructor(
    private readonly tournament: TournamentService,
    private readonly audit: AdminAuditService,
  ) {}

  @Get()
  list(@Query('search') search?: string, @Query('statuses') statuses?: string, @Query('take') take?: string) {
    return this.tournament.listAll({
      statuses: statuses ? statuses.split(',') : undefined,
      search,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('overview')
  overview() {
    return this.tournament.statusOverview();
  }

  @Get(':tournamentId')
  detail(@Param('tournamentId') tournamentId: string) {
    return this.tournament.getDetail(tournamentId);
  }

  @Get(':tournamentId/finance')
  finance(@Param('tournamentId') tournamentId: string) {
    return this.tournament.getFinancialSummary(tournamentId);
  }

  @Post()
  @Roles(...FINANCE_UP)
  create(@Body() dto: CreateTournamentDto, @CurrentUser() admin: { userId: string }) {
    return this.tournament.create({ ...dto, createdBy: admin.userId });
  }

  @Post(':tournamentId/update')
  @Roles(...FINANCE_UP)
  async update(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: UpdateTournamentDto,
    @CurrentUser() admin: { userId: string },
    @Req() req: Request,
  ) {
    const updated = await this.tournament.update(tournamentId, { ...dto, createdBy: admin.userId }, admin.userId);
    await this.audit.log({
      adminId: admin.userId,
      action: 'tournament.update',
      targetType: 'tournament',
      targetId: tournamentId,
      newValue: { name: dto.name, format: dto.format, entryFee: dto.entryFee, prizePool: dto.prizePool },
      ip: req.ip,
    });
    return updated;
  }

  @Post(':tournamentId/publish')
  @Roles(...FINANCE_UP)
  publish(@Param('tournamentId') tournamentId: string, @CurrentUser() admin: { userId: string }, @Req() req: Request) {
    return this.tournament
      .publish(tournamentId, admin.userId)
      .then(async (t) => {
        await this.audit.log({
          adminId: admin.userId,
          action: 'tournament.publish',
          targetType: 'tournament',
          targetId: tournamentId,
          ip: req.ip,
        });
        return t;
      });
  }

  @Post(':tournamentId/start')
  @Roles(...FINANCE_UP)
  start(@Param('tournamentId') tournamentId: string, @CurrentUser() admin: { userId: string }, @Req() req: Request) {
    return this.tournament
      .start(tournamentId, admin.userId)
      .then(async (t) => {
        await this.audit.log({
          adminId: admin.userId,
          action: 'tournament.start',
          targetType: 'tournament',
          targetId: tournamentId,
          ip: req.ip,
        });
        return t;
      });
  }

  @Post(':tournamentId/cancel')
  @Roles(...FINANCE_UP)
  cancel(
    @Param('tournamentId') tournamentId: string,
    @Body() dto: CancelTournamentDto,
    @CurrentUser() admin: { userId: string },
    @Req() req: Request,
  ) {
    return this.tournament
      .cancel(tournamentId, dto.reason, admin.userId)
      .then(async (t) => {
        await this.audit.log({
          adminId: admin.userId,
          action: 'tournament.cancel',
          targetType: 'tournament',
          targetId: tournamentId,
          newValue: { reason: dto.reason },
          ip: req.ip,
        });
        return t;
      });
  }

  @Post(':tournamentId/players/:userId/remove')
  @Roles(...FINANCE_UP)
  removePlayer(
    @Param('tournamentId') tournamentId: string,
    @Param('userId') userId: string,
    @CurrentUser() admin: { userId: string },
    @Req() req: Request,
  ) {
    return this.tournament
      .removePlayer(tournamentId, userId)
      .then(async (result) => {
        await this.audit.log({
          adminId: admin.userId,
          action: 'tournament.removePlayer',
          targetType: 'tournament',
          targetId: tournamentId,
          newValue: { userId },
          ip: req.ip,
        });
        return result;
      });
  }
}
