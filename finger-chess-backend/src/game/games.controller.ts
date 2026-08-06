import { Controller, ForbiddenException, Get, Header, Param, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { GameService } from './game.service';

const STAFF_ROLES = ['support_agent', 'finance_admin', 'super_admin'];

@Controller('games')
@UseGuards(JwtAuthGuard)
export class GamesController {
  constructor(private readonly gameService: GameService) {}

  /** The current user's own match history — used by the dashboard and profile pages. */
  @Get('history')
  getMyHistory(@CurrentUser() user: { userId: string }) {
    return this.gameService.getUserHistory(user.userId);
  }

  /**
   * SECURITY FIX: previously any authenticated user could pull ANY game's
   * full move history by ID — an IDOR (insecure direct object reference).
   * Move-by-move history reveals a player's opening repertoire, time
   * management, and playing strength; on a real-money platform that's
   * competitive information the two participants didn't agree to hand a
   * stranger, and it's exactly the kind of thing an opponent-scouting tool
   * would scrape at scale if left open. Now restricted to the two players
   * in the game or staff (support/finance/super admin) — spectating a
   * LIVE game remains a separate, intentionally public feature via the
   * WebSocket gateway's `spectateGame` event, which is unaffected by this.
   */
  @Get(':id/replay')
  async getReplay(@CurrentUser() user: { userId: string; role: string }, @Param('id') gameId: string) {
    await this.assertCanView(user, gameId);
    return this.gameService.getGameForReplay(gameId);
  }

  /** Downloadable, standard-compliant PGN for import into any chess software — same access rule as replay. */
  @Get(':id/pgn')
  @Header('Content-Type', 'text/plain')
  async getPgn(@CurrentUser() user: { userId: string; role: string }, @Param('id') gameId: string, @Res() res: Response) {
    await this.assertCanView(user, gameId);
    const pgn = await this.gameService.exportPgn(gameId);
    res.setHeader('Content-Disposition', `attachment; filename="game-${gameId}.pgn"`);
    res.send(pgn);
  }

  private async assertCanView(user: { userId: string; role: string }, gameId: string) {
    if (STAFF_ROLES.includes(user.role)) return;
    const color = await this.gameService.isParticipant(gameId, user.userId);
    if (!color) {
      throw new ForbiddenException('You can only view games you played in');
    }
  }
}
