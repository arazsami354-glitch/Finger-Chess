import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChessEngineService } from '../engine/chess-engine.service';
import { StockfishService } from '../engine/stockfish.service';

// Thresholds are intentionally conservative — this flags for HUMAN REVIEW,
// it never auto-punishes. A strong human player can legitimately post a low
// average centipawn loss over a single game; sustained numbers like these
// across MANY games is the real signal, which is why every report is kept
// (not just flagged ones) — a reviewer can pull a player's history.
const FLAG_MAX_AVG_CENTIPAWN_LOSS = 15;
const FLAG_MIN_TOP_MOVE_MATCH_PERCENT = 85;
const MIN_MOVES_TO_ANALYZE = 20; // very short games are too noisy to score meaningfully
const ANALYSIS_DEPTH = 14;

@Injectable()
export class AnticheatService {
  private readonly logger = new Logger(AnticheatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: ChessEngineService,
    private readonly stockfish: StockfishService,
  ) {}

  /**
   * Fire-and-forget entry point called from GameService after a real-money
   * game completes. Never awaited by the settlement path — analysis takes
   * seconds to minutes and must not delay prize payout.
   */
  async analyzeGameAsync(gameId: string) {
    this.runAnalysis(gameId).catch((err) => {
      this.logger.error(`Anti-cheat analysis failed for game ${gameId}: ${(err as Error).message}`);
    });
  }

  private async runAnalysis(gameId: string) {
    const game = await this.prisma.game.findUniqueOrThrow({ where: { id: gameId } });
    const moves = await this.prisma.gameMove.findMany({ where: { gameId }, orderBy: { moveNumber: 'asc' } });

    if (moves.length < MIN_MOVES_TO_ANALYZE) {
      this.logger.log(`Skipping anti-cheat analysis for game ${gameId} — too few moves (${moves.length})`);
      return;
    }

    const sanSequence = this.orderMovesBySequence(moves);
    const replay = this.engine.replayGame(sanSequence.map((m) => m.san));

    const perPlayer: Record<'white' | 'black', { centipawnLosses: number[]; topMoveMatches: number; total: number }> = {
      white: { centipawnLosses: [], topMoveMatches: 0, total: 0 },
      black: { centipawnLosses: [], topMoveMatches: 0, total: 0 },
    };

    for (let i = 0; i < replay.length; i++) {
      const step = replay[i];
      const color = sanSequence[i].color;

      try {
        const analysis = await this.stockfish.analyzePosition(step.fenBeforeMove, ANALYSIS_DEPTH);
        if (analysis.evaluationCp === null || analysis.bestMoveUci === null) continue;

        const playedMove = this.engine.applyMove(step.fenBeforeMove, step.san);
        if (!playedMove.legal || !playedMove.fenAfter || !playedMove.uci) continue;

        // Centipawn loss: how much worse the played move was than the engine's
        // top choice, from the mover's own perspective (positive = worse for mover).
        const playedMoveEval = await this.evaluateAfterMove(playedMove.fenAfter);
        if (playedMoveEval === null) continue;

        const bestEval = analysis.evaluationCp;
        const loss = Math.max(0, bestEval - playedMoveEval);

        perPlayer[color].centipawnLosses.push(loss);
        perPlayer[color].total += 1;

        if (playedMove.uci === analysis.bestMoveUci) {
          perPlayer[color].topMoveMatches += 1;
        }
      } catch (err) {
        this.logger.warn(`Stockfish analysis skipped for a move in game ${gameId}: ${(err as Error).message}`);
      }
    }

    await this.persistReport(gameId, game.playerWhiteId, 'white', perPlayer.white);
    await this.persistReport(gameId, game.playerBlackId, 'black', perPlayer.black);
  }

  private async evaluateAfterMove(fenAfterMove: string): Promise<number | null> {
    // Evaluate the resulting position from the perspective of the side who
    // just moved by negating the engine's side-to-move-relative score
    // (Stockfish always scores from whoever is to move next).
    const analysis = await this.stockfish.analyzePosition(fenAfterMove, ANALYSIS_DEPTH);
    if (analysis.evaluationCp === null) return null;
    return -analysis.evaluationCp;
  }

  private orderMovesBySequence(moves: { moveNumber: number; color: 'white' | 'black'; moveSan: string }[]) {
    return moves
      .slice()
      .sort((a, b) => a.moveNumber - b.moveNumber || (a.color === 'white' ? -1 : 1))
      .map((m) => ({ san: m.moveSan, color: m.color }));
  }

  private async persistReport(
    gameId: string,
    userId: string,
    color: 'white' | 'black',
    stats: { centipawnLosses: number[]; topMoveMatches: number; total: number },
  ) {
    if (stats.total === 0) return;

    const avgLoss = stats.centipawnLosses.reduce((a, b) => a + b, 0) / stats.centipawnLosses.length;
    const matchPercent = (stats.topMoveMatches / stats.total) * 100;

    const flagged = avgLoss <= FLAG_MAX_AVG_CENTIPAWN_LOSS && matchPercent >= FLAG_MIN_TOP_MOVE_MATCH_PERCENT;
    const suspicionScore = Math.max(0, Math.min(100, matchPercent - avgLoss));

    await this.prisma.anticheatReport.upsert({
      where: { gameId_userId: { gameId, userId } },
      create: {
        gameId,
        userId,
        averageCentipawnLoss: avgLoss,
        topEngineMoveMatchPercent: matchPercent,
        movesAnalyzed: stats.total,
        suspicionScore,
        flagged,
      },
      update: {
        averageCentipawnLoss: avgLoss,
        topEngineMoveMatchPercent: matchPercent,
        movesAnalyzed: stats.total,
        suspicionScore,
        flagged,
      },
    });

    if (flagged) {
      this.logger.warn(`Anti-cheat flag: user ${userId} in game ${gameId} (avgLoss=${avgLoss.toFixed(1)}, match=${matchPercent.toFixed(1)}%)`);
    }
  }
}
