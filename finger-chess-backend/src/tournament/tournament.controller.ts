import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TournamentService } from './tournament.service';

@Controller('tournaments')
@UseGuards(JwtAuthGuard)
export class TournamentController {
  constructor(private readonly tournament: TournamentService) {}

  @Get()
  list(@Query('search') search?: string, @Query('statuses') statuses?: string, @Query('take') take?: string) {
    return this.tournament.listPublic({
      statuses: statuses ? statuses.split(',') : undefined,
      search,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('mine')
  mine(@CurrentUser() user: { userId: string }) {
    return this.tournament.listMyRegistrations(user.userId);
  }

  @Get('standings/:tournamentId')
  standings(@Param('tournamentId') tournamentId: string) {
    return this.tournament.getStandings(tournamentId);
  }

  @Get('bracket/:tournamentId')
  bracket(@Param('tournamentId') tournamentId: string) {
    return this.tournament.getBracket(tournamentId);
  }

  @Get(':tournamentId')
  detail(@Param('tournamentId') tournamentId: string, @CurrentUser() user: { userId: string }) {
    return this.tournament.getDetail(tournamentId, user.userId);
  }

  @Post(':tournamentId/register')
  register(@Param('tournamentId') tournamentId: string, @CurrentUser() user: { userId: string }) {
    return this.tournament.register(tournamentId, user.userId);
  }

  @Post(':tournamentId/withdraw')
  withdraw(@Param('tournamentId') tournamentId: string, @CurrentUser() user: { userId: string }) {
    return this.tournament.withdraw(tournamentId, user.userId);
  }
}
