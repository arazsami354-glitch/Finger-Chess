import { Injectable, Logger } from '@nestjs/common';

export interface EngineAnalysis {
  bestMoveUci: string | null;
  evaluationCp: number | null; // centipawns, from the side-to-move's perspective
  isMate: boolean;
  mateIn: number | null;
}

/**
 * Wraps the `stockfish` npm package (a WASM build of Stockfish, no system
 * binary install required — important for portable container deploys).
 *
 * IMPORTANT — where this is and isn't used:
 * This service is used ONLY for:
 *   1. Post-game anti-cheat analysis (AntiCheatService), run asynchronously
 *      after a real-money game completes.
 *   2. Optional post-game "analysis board" for players/spectators reviewing
 *      a finished game.
 * It is NEVER wired into the live move-submission path — giving a player
 * engine access during their own game is the exact thing this platform's
 * anti-cheat system exists to detect and penalize.
 *
 * Concurrency: each analysis spins up a short-lived engine instance. A
 * semaphore caps concurrent instances so a burst of finished games can't
 * exhaust server CPU. In production at scale, replace this with a proper
 * job queue (BullMQ) feeding a small fixed pool of long-lived engine
 * workers instead of spawning per-call.
 */
@Injectable()
export class StockfishService {
  private readonly logger = new Logger(StockfishService.name);
  private activeInstances = 0;
  private readonly maxConcurrent = 2;
  private readonly queue: (() => void)[] = [];

  async analyzePosition(fen: string, depth = 14): Promise<EngineAnalysis> {
    await this.acquireSlot();
    try {
      return await this.runEngine(fen, depth);
    } finally {
      this.releaseSlot();
    }
  }

  private async runEngine(fen: string, depth: number): Promise<EngineAnalysis> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const stockfish = require('stockfish');
    const engine = stockfish();

    return new Promise((resolve, reject) => {
      let bestMoveUci: string | null = null;
      let evaluationCp: number | null = null;
      let isMate = false;
      let mateIn: number | null = null;

      const timeout = setTimeout(() => {
        engine.postMessage?.('quit');
        reject(new Error('Stockfish analysis timed out'));
      }, 15_000);

      engine.onmessage = (line: string) => {
        if (typeof line !== 'string') return;

        // Example: "info depth 14 seldepth 20 ... score cp 34 ... pv e2e4 e7e5"
        const cpMatch = line.match(/score cp (-?\d+)/);
        const mateMatch = line.match(/score mate (-?\d+)/);
        if (mateMatch) {
          isMate = true;
          mateIn = Number(mateMatch[1]);
        } else if (cpMatch) {
          evaluationCp = Number(cpMatch[1]);
        }

        if (line.startsWith('bestmove')) {
          bestMoveUci = line.split(' ')[1] ?? null;
          clearTimeout(timeout);
          resolve({ bestMoveUci, evaluationCp, isMate, mateIn });
        }
      };

      engine.postMessage('uci');
      engine.postMessage(`position fen ${fen}`);
      engine.postMessage(`go depth ${depth}`);
    });
  }

  private acquireSlot(): Promise<void> {
    if (this.activeInstances < this.maxConcurrent) {
      this.activeInstances++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.queue.push(resolve)).then(() => {
      this.activeInstances++;
    });
  }

  private releaseSlot() {
    this.activeInstances--;
    const next = this.queue.shift();
    if (next) next();
  }
}
