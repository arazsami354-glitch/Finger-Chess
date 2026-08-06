import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../../wallet/wallet.service';
import { AdminAuditService } from '../audit/admin-audit.service';

/**
 * Free vs paid is derived from `entryFee` (0 vs >0) rather than a separate
 * stored column — see the identical reasoning in
 * social/profile/player-profile.controller.ts's computeStats. Centralized
 * here since both listLive and list need the exact same filter shape.
 */
function entryFeeModeFilter(mode?: 'free' | 'paid') {
  if (mode === 'free') return { entryFee: { equals: 0 } };
  if (mode === 'paid') return { entryFee: { gt: 0 } };
  return {};
}

@Injectable()
export class AdminGamesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly audit: AdminAuditService,
  ) {}

  async listLive(mode?: 'free' | 'paid') {
    return this.prisma.game.findMany({
      where: { status: 'ongoing', ...entryFeeModeFilter(mode) },
      include: {
        playerWhite: { select: { id: true, email: true, fullName: true } },
        playerBlack: { select: { id: true, email: true, fullName: true } },
      },
      orderBy: { startedAt: 'desc' },
    });
  }

  async list(params: { status?: string; mode?: 'free' | 'paid'; playerId?: string; search?: string; cursor?: string; take?: number }) {
    const take = params.take ?? 50;
    const where: any = { ...entryFeeModeFilter(params.mode) };
    if (params.status) where.status = params.status;

    const orConditions: any[] = [];
    if (params.playerId) orConditions.push({ playerWhiteId: params.playerId }, { playerBlackId: params.playerId });
    if (params.search) {
      const playerMatch = {
        OR: [
          { email: { contains: params.search, mode: 'insensitive' } },
          { fullName: { contains: params.search, mode: 'insensitive' } },
        ],
      };
      orConditions.push({ playerWhite: playerMatch }, { playerBlack: playerMatch });
    }
    if (orConditions.length > 0) where.OR = orConditions;

    return this.prisma.game.findMany({
      where,
      include: {
        playerWhite: { select: { id: true, email: true } },
        playerBlack: { select: { id: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
      ...(params.cursor ? { skip: 1, cursor: { id: params.cursor } } : {}),
    });
  }

  async getDetail(gameId: string) {
    const game = await this.prisma.game.findUnique({
      where: { id: gameId },
      include: {
        playerWhite: { select: { id: true, email: true, fullName: true } },
        playerBlack: { select: { id: true, email: true, fullName: true } },
      },
    });
    if (!game) throw new NotFoundException('Game not found');

    const [moveCount, anticheatReports] = await Promise.all([
      this.prisma.gameMove.count({ where: { gameId } }),
      this.prisma.anticheatReport.findMany({ where: { gameId } }),
    ]);

    return { ...game, moveCount, anticheatReports };
  }

  /** Full move-by-move history for a game — the replay/verification view. */
  async getMoves(gameId: string) {
    const game = await this.prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
    if (!game) throw new NotFoundException('Game not found');

    return this.prisma.gameMove.findMany({
      where: { gameId },
      orderBy: [{ moveNumber: 'asc' }, { color: 'asc' }],
    });
  }

  /**
   * Admin cancellation. Scoped deliberately:
   *  - `waiting` games (never started — no entry-fee holds exist yet) → straight to aborted.
   *  - `ongoing` free games → aborted, no money involved.
   *  - `ongoing` paid games → both held entry fees return to the players via the
   *    exact same `entry_fee_release` ledger path WalletService uses for draws —
   *    reusing the existing settlement primitive rather than inventing new money math.
   */
  async cancel(gameId: string, adminId: string, reason: string | undefined, ip?: string) {
    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    if (game.status !== 'waiting' && game.status !== 'ongoing') {
      throw new BadRequestException('Only waiting or ongoing games can be cancelled');
    }

    if (game.status === 'ongoing' && Number(game.entryFee) > 0) {
      await this.wallet.refundDrawEntryFees(game.id, game.playerWhiteId, game.playerBlackId, Number(game.entryFee));
    }

    await this.prisma.game.update({
      where: { id: gameId },
      data: { status: 'aborted', result: 'aborted', endedAt: new Date() },
    });

    await this.audit.log({
      adminId,
      action: 'game.cancel',
      targetType: 'game',
      targetId: gameId,
      oldValue: { status: game.status },
      newValue: { status: 'aborted', reason },
      ip,
    });

    return { success: true };
  }

  /** Games flagged by AnticheatService, awaiting human review — the direct feed for a "cheating review" tab. */
  async listFlaggedGames() {
    const reports = await this.prisma.anticheatReport.findMany({
      where: { flagged: true, reviewStatus: 'unreviewed' },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const gameIds = [...new Set(reports.map((r) => r.gameId))];
    const games = await this.prisma.game.findMany({
      where: { id: { in: gameIds } },
      include: {
        playerWhite: { select: { id: true, email: true } },
        playerBlack: { select: { id: true, email: true } },
      },
    });

    const gamesById = new Map(games.map((g) => [g.id, g]));
    return reports.map((r) => ({ report: r, game: gamesById.get(r.gameId) }));
  }

  async reviewAnticheatReport(reportId: string, adminId: string, decision: 'reviewed_clean' | 'confirmed_cheating') {
    return this.prisma.anticheatReport.update({
      where: { id: reportId },
      data: { reviewStatus: decision, reviewedBy: adminId },
    });
  }
}
