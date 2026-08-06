'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { Chess } from 'chess.js';
import { createNamespaceSocket } from '@/lib/socket';

interface GameState {
  fen: string;
  turn: 'w' | 'b';
  whiteClockMs: number;
  blackClockMs: number;
  drawOfferBy: 'w' | 'b' | null;
  whitePlayerId: string;
  blackPlayerId: string;
  lastMoveAt: number;
  moves: { moveNumber: number; color: 'white' | 'black'; san: string }[];
}

interface GameOverInfo {
  reason: string;
  winnerColor?: 'white' | 'black';
  resignedBy?: string;
  abandonedBy?: string;
}

export function useGameSocket(gameId: string, mode: 'play' | 'spectate', userId?: string) {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  // The board highlights the last move (from + to squares). Derived from the
  // SAN history so it's correct on fresh load, reconnect, and live moves.
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [gameOver, setGameOver] = useState<GameOverInfo | null>(null);
  const [drawOfferedByOpponent, setDrawOfferedByOpponent] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [opponentConnected, setOpponentConnected] = useState(true);

  // Refs keep the socket effect stable (deps: gameId, mode) while still
  // letting event handlers read the latest identity / own color.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const myColorRef = useRef<'w' | 'b' | null>(null);
  // Tracks the FEN the socket last delivered, so a `moveApplied` (which only
  // carries the post-move FEN) can replay its SAN against the pre-move
  // position to recover the from/to squares for the board highlight.
  const prevFenRef = useRef<string | null>(null);

  useEffect(() => {
    const socket = createNamespaceSocket('/game');
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit(mode === 'play' ? 'joinGame' : 'spectateGame', { gameId });
    });

    socket.on('gameState', (data: GameState) => {
      const myColor: 'w' | 'b' | null = userIdRef.current
        ? data.whitePlayerId === userIdRef.current
          ? 'w'
          : data.blackPlayerId === userIdRef.current
            ? 'b'
            : null
        : null;
      myColorRef.current = myColor;

      setGameState({
        ...data,
        whiteClockMs: toMoveClockMs(data, 'whiteClockMs'),
        blackClockMs: toMoveClockMs(data, 'blackClockMs'),
      });
      setWaiting(false);
      prevFenRef.current = data.fen;
      setLastMove(lastMoveFromSanList(data.moves));

      // Restore a still-pending draw offer on reconnect / mid-game join.
      if (mode === 'play') {
        setDrawOfferedByOpponent(data.drawOfferBy !== null && data.drawOfferBy !== myColor);
      }
    });

    socket.on('waitingForOpponent', () => setWaiting(true));

    socket.on('moveApplied', (data: any) => {
      setGameState((prev) =>
        prev
          ? {
              ...prev,
              fen: data.fen,
              turn: data.turn,
              whiteClockMs: toMoveClockMs(data, 'whiteClockMs'),
              blackClockMs: toMoveClockMs(data, 'blackClockMs'),
              lastMoveAt: data.lastMoveAt ?? prev.lastMoveAt,
              moves: data.san ? [...prev.moves, { moveNumber: data.moveNumber, color: data.color, san: data.san }] : prev.moves,
            }
          : prev,
      );
      setLastMove(sanToSquare(data.san, prevFenRef.current));
      if (data.fen) prevFenRef.current = data.fen;
      setDrawOfferedByOpponent(false);
    });

    socket.on('moveRejected', (data: { message: string }) => {
      setMoveError(data.message);
      setTimeout(() => setMoveError(null), 2500);
    });

    socket.on('drawOffered', (data: { by: 'w' | 'b' }) => {
      // The event is broadcast to the whole room including the offerer —
      // only show the accept/decline UI to the opponent.
      if (mode === 'play') setDrawOfferedByOpponent(data.by !== myColorRef.current);
    });
    socket.on('drawDeclined', () => setDrawOfferedByOpponent(false));

    socket.on('gameOver', (data: GameOverInfo) => setGameOver(data));

    socket.on('opponentDisconnected', () => setOpponentConnected(false));
    socket.on('opponentReconnected', () => setOpponentConnected(true));

    return () => {
      socket.disconnect();
    };
  }, [gameId, mode]);

  const makeMove = useCallback(
    (san: string, expectedMoveCount?: number) => {
      // expectedMoveCount lets the server distinguish a stale/duplicate
      // delivery ("board is out of sync") from an illegal move — the client's
      // ply count is sent so a repeated packet can't double-apply or desync.
      socketRef.current?.emit('move', { gameId, san, expectedMoveCount });
    },
    [gameId],
  );

  const offerDraw = useCallback(() => socketRef.current?.emit('offerDraw', { gameId }), [gameId]);
  const respondDraw = useCallback((accept: boolean) => socketRef.current?.emit('respondDraw', { gameId, accept }), [gameId]);
  const resign = useCallback(() => socketRef.current?.emit('resign', { gameId }), [gameId]);

  return { connected, gameState, lastMove, gameOver, drawOfferedByOpponent, moveError, waiting, opponentConnected, makeMove, offerDraw, respondDraw, resign };
}

/**
 * Server clock values are correct as of the server's `lastMoveAt`. Only the
 * side whose turn it is has been ticking since then, so subtract elapsed time
 * from exactly that clock (the mover's clock was frozen with the increment
 * already added). Prevents a freshly joined / reconnected client from showing
 * a clock that lags the server's by however long the last message spent in
 * flight.
 */
function toMoveClockMs(data: { turn: 'w' | 'b'; whiteClockMs: number; blackClockMs: number; lastMoveAt?: number }, field: 'whiteClockMs' | 'blackClockMs'): number {
  const runningSide = data.turn === 'w' ? 'whiteClockMs' : 'blackClockMs';
  if (runningSide !== field) return data[field];
  const elapsed = Math.max(0, Date.now() - (data.lastMoveAt ?? Date.now()));
  return Math.max(0, data[field] - elapsed);
}

/** Replays a full SAN history against a fresh board to recover the from/to
 *  squares of the most recent move (the one the board highlights). */
function lastMoveFromSanList(moves: { san: string }[]): { from: string; to: string } | null {
  if (moves.length === 0) return null;
  try {
    const chess = new Chess();
    let last: { from: string; to: string } | null = null;
    for (const m of moves) {
      const applied = chess.move(m.san);
      if (!applied) break;
      last = { from: applied.from, to: applied.to };
    }
    return last;
  } catch {
    return null;
  }
}

/** Applies a single SAN move to a known pre-move position and returns the
 *  from/to squares, or null when the SAN can't be replayed (reconnect race,
 *  malformed history). */
function sanToSquare(san: string, prevFen: string | null): { from: string; to: string } | null {
  if (!san || !prevFen) return null;
  try {
    const applied = new Chess(prevFen).move(san);
    return applied ? { from: applied.from, to: applied.to } : null;
  } catch {
    return null;
  }
}
