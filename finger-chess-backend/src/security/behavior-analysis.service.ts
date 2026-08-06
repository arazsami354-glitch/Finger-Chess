import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MIN_MOVES_FOR_TIMING_ANALYSIS = 15;
// A human's think-time varies a lot move to move (an instant recapture vs.
// a long think on a critical position) — a coefficient of variation this
// low means the time between moves is suspiciously CONSTANT, which is
// exactly what a scripted/engine-assisted player who always "thinks" for
// a fixed delay produces. A real threshold would be tuned against real
// game data over time; this is a defensible, documented starting point,
// not a claim of statistical precision.
const LOW_VARIANCE_THRESHOLD = 0.15; // coefficient of variation (stddev / mean)

@Injectable()
export class BehaviorAnalysisService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Derives per-move think-time from the clock-remaining sequence already
   * recorded on every GameMove (clockRemainingMs) — no new data collection
   * needed, this is a real signal computed from data the game engine
   * already persists for an entirely different reason (clock display/sync).
   */
  async analyzeGameTiming(gameId: string): Promise<{ white: TimingResult; black: TimingResult }> {
    const moves = await this.prisma.gameMove.findMany({
      where: { gameId },
      orderBy: [{ color: 'asc' }, { moveNumber: 'asc' }],
    });

    return {
      white: this.analyzeColorTiming(moves.filter((m) => m.color === 'white')),
      black: this.analyzeColorTiming(moves.filter((m) => m.color === 'black')),
    };
  }

  private analyzeColorTiming(moves: { clockRemainingMs: number }[]): TimingResult {
    if (moves.length < MIN_MOVES_FOR_TIMING_ANALYSIS) {
      return { analyzed: false, suspicious: false, coefficientOfVariation: null, moveCount: moves.length };
    }

    const thinkTimes: number[] = [];
    for (let i = 1; i < moves.length; i++) {
      // A positive delta means time was actually spent (ignoring increment
      // additions, which would show as the clock going UP — those moves
      // are simply excluded rather than producing a nonsensical negative
      // think-time).
      const delta = moves[i - 1].clockRemainingMs - moves[i].clockRemainingMs;
      if (delta > 0) thinkTimes.push(delta);
    }
    if (thinkTimes.length < MIN_MOVES_FOR_TIMING_ANALYSIS) {
      return { analyzed: false, suspicious: false, coefficientOfVariation: null, moveCount: moves.length };
    }

    const mean = thinkTimes.reduce((a, b) => a + b, 0) / thinkTimes.length;
    const variance = thinkTimes.reduce((sum, t) => sum + (t - mean) ** 2, 0) / thinkTimes.length;
    const stddev = Math.sqrt(variance);
    const cv = mean > 0 ? stddev / mean : 0;

    return { analyzed: true, suspicious: cv < LOW_VARIANCE_THRESHOLD, coefficientOfVariation: Number(cv.toFixed(3)), moveCount: thinkTimes.length };
  }
}

interface TimingResult {
  analyzed: boolean;
  suspicious: boolean;
  coefficientOfVariation: number | null;
  moveCount: number;
}
