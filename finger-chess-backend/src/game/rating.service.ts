import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_RATING = 1200;

/**
 * Tiered K-factor — the same standard practice FIDE itself uses: newer
 * players' ratings move faster so they converge toward their true
 * strength quickly, established players' ratings move more slowly so a
 * single unusual result doesn't swing a long, accurate history much.
 */
function kFactorFor(gamesPlayed: number, rating: number): number {
  if (gamesPlayed < 30) return 40;
  if (rating >= 2400) return 10;
  return 20;
}

function expectedScore(ratingSelf: number, ratingOpponent: number): number {
  return 1 / (1 + Math.pow(10, (ratingOpponent - ratingSelf) / 400));
}

@Injectable()
export class RatingService {
  private readonly logger = new Logger(RatingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called synchronously from GameService.finishGame — unlike the
   * Stockfish/behavior analysis passes, a rating update IS core game
   * state (the player's rating on their very next page load should
   * already reflect this game), not a background signal that can lag.
   * It's also cheap: simple arithmetic plus a handful of small writes,
   * nothing that risks delaying settlement the way a Stockfish pass would.
   *
   * `gameMode` is the time-control CATEGORY ('bullet' | 'blitz' | 'rapid' |
   * 'classical'). GameService resolves it from the Redis players record —
   * the DB row's `timeControl` column holds the display label ("10+0"),
   * not the TIME_CONTROLS id, so resolving it here from the id would throw.
   */
  async updateRatingsForGame(gameId: string, gameMode: string, whiteUserId: string, blackUserId: string, result: 'white_win' | 'black_win' | 'draw') {
    try {
      const [whiteRating, blackRating] = await Promise.all([
        this.getOrCreateRating(whiteUserId, gameMode),
        this.getOrCreateRating(blackUserId, gameMode),
      ]);

      const whiteActual = result === 'white_win' ? 1 : result === 'draw' ? 0.5 : 0;
      const blackActual = 1 - whiteActual;

      const whiteExpected = expectedScore(whiteRating.rating, blackRating.rating);
      const blackExpected = 1 - whiteExpected;

      const whiteK = kFactorFor(whiteRating.gamesPlayed, whiteRating.rating);
      const blackK = kFactorFor(blackRating.gamesPlayed, blackRating.rating);

      const whiteNewRating = Math.round(whiteRating.rating + whiteK * (whiteActual - whiteExpected));
      const blackNewRating = Math.round(blackRating.rating + blackK * (blackActual - blackExpected));

      await this.prisma.$transaction([
        this.prisma.rating.update({
          where: { userId_gameMode: { userId: whiteUserId, gameMode } },
          data: {
            rating: whiteNewRating,
            peakRating: Math.max(whiteRating.peakRating, whiteNewRating),
            gamesPlayed: { increment: 1 },
          },
        }),
        this.prisma.rating.update({
          where: { userId_gameMode: { userId: blackUserId, gameMode } },
          data: {
            rating: blackNewRating,
            peakRating: Math.max(blackRating.peakRating, blackNewRating),
            gamesPlayed: { increment: 1 },
          },
        }),
        this.prisma.ratingHistory.create({ data: { userId: whiteUserId, gameMode, rating: whiteNewRating, gameId } }),
        this.prisma.ratingHistory.create({ data: { userId: blackUserId, gameMode, rating: blackNewRating, gameId } }),
      ]);
    } catch (err) {
      // A rating-update failure should never be allowed to break game
      // completion itself — the game is already settled and over by the
      // time this runs; worst case here is a rating staying stale for one
      // game, not a broken settlement.
      this.logger.error(`Rating update failed for game ${gameId}: ${(err as Error).message}`);
    }
  }

  private async getOrCreateRating(userId: string, gameMode: string) {
    return this.prisma.rating.upsert({
      where: { userId_gameMode: { userId, gameMode } },
      create: { userId, gameMode, rating: DEFAULT_RATING, peakRating: DEFAULT_RATING },
      update: {},
    });
  }

  async getRatingHistory(userId: string, gameMode: string, take = 50) {
    return this.prisma.ratingHistory.findMany({
      where: { userId, gameMode },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }
}
