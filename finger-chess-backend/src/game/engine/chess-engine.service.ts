import { Injectable } from '@nestjs/common';
import { Chess } from 'chess.js';

export interface MoveResult {
  legal: boolean;
  san?: string;
  uci?: string; // e.g. "e2e4", "e7e8q" for promotion — directly comparable to Stockfish's bestmove output
  fenAfter?: string;
  isCheck?: boolean;
  isCheckmate?: boolean;
  isStalemate?: boolean;
  isDraw?: boolean;
  isThreefoldRepetition?: boolean;
  isInsufficientMaterial?: boolean;
  isGameOver?: boolean;
  turn?: 'w' | 'b';
  error?: string;
}

/**
 * Every method here is pure/deterministic given a FEN — the gateway/service
 * layer is the only thing that persists state. This makes it trivial to
 * unit test and to re-run against a stored FEN for anti-cheat / dispute
 * review / replay.
 *
 * CRITICAL: this is the only place move legality is decided. The client's
 * own chess.js instance is for instant UI feedback only and is never trusted.
 */
@Injectable()
export class ChessEngineService {
  createNewGame(): string {
    return new Chess().fen();
  }

  applyMove(currentFen: string, moveSan: string): MoveResult {
    const chess = new Chess(currentFen);
    let move;
    try {
      move = chess.move(moveSan, { strict: false });
    } catch {
      move = null;
    }

    if (!move) {
      return { legal: false, error: 'Illegal move' };
    }

    return {
      legal: true,
      san: move.san,
      uci: `${move.from}${move.to}${move.promotion ?? ''}`,
      fenAfter: chess.fen(),
      isCheck: chess.inCheck(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw(),
      isThreefoldRepetition: chess.isThreefoldRepetition(),
      isInsufficientMaterial: chess.isInsufficientMaterial(),
      isGameOver: chess.isGameOver(),
      turn: chess.turn(),
    };
  }

  isLegalMove(currentFen: string, moveSan: string): boolean {
    return this.applyMove(currentFen, moveSan).legal;
  }

  /**
   * FIDE rule: a player who flags (runs out of time) still draws, rather
   * than loses, if their opponent has no way to deliver checkmate with the
   * material remaining on the board. Checked against the position at the
   * moment of the flag — not the mover's own material, the whole board's.
   */
  hasInsufficientMatingMaterial(fen: string): boolean {
    return new Chess(fen).isInsufficientMaterial();
  }

  /** Returns every legal move in the position, in SAN — used by the anti-cheat service to compare a played move against the full legal move set. */
  getLegalMoves(fen: string): string[] {
    return new Chess(fen).moves();
  }

  /**
   * Returns a stable position identity for a FEN — the same Zobrist hash
   * chess.js uses internally for repetition detection (board, side to move,
   * castling rights, en passant square) with the halfmove clock and fullmove
   * number excluded. Two identical boards reached at different fullmove
   * numbers therefore hash identically, which is what the threefold rule
   * requires. The GameService tracks these hashes across the whole game
   * because a fresh `new Chess(fen)` cannot see positions from earlier moves.
   */
  positionKey(fen: string): string {
    return new Chess(fen).hash();
  }

  /** Replays a full SAN move list from the starting position, returning the FEN before each move — used for anti-cheat analysis and replay verification. */
  replayGame(sanMoves: string[]): { fenBeforeMove: string; san: string; fenAfter: string }[] {
    const chess = new Chess();
    const steps: { fenBeforeMove: string; san: string; fenAfter: string }[] = [];
    for (const san of sanMoves) {
      const fenBeforeMove = chess.fen();
      chess.move(san, { strict: false });
      steps.push({ fenBeforeMove, san, fenAfter: chess.fen() });
    }
    return steps;
  }
}
