'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chess, Square } from 'chess.js';
import { cn } from '@/lib/utils';
import { ChessPiece, PieceColor, PieceDefs, PieceType } from './pieces';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const MOVE_DURATION_MS = 260;
const CASTLE_FOLLOW_DELAY_MS = 90;

/* Premium maple / walnut square gradients — warm, high-contrast, with a
   soft diagonal sheen so the board reads as polished wood, not flat color. */
const LIGHT_SQUARE = 'linear-gradient(150deg, #F7E4C0 0%, #EBCF9F 55%, #DFBB84 100%)';
const DARK_SQUARE = 'linear-gradient(150deg, #7F522A 0%, #6B3E1E 55%, #572F16 100%)';
/* Frame is a layered mahogany/rosewood gradient. */
const FRAME_GRADIENT = 'linear-gradient(140deg, #5B3B21 0%, #43301B 38%, #2E1F10 72%, #221607 100%)';

interface BoardPiece {
  type: PieceType;
  color: PieceColor;
}

interface VisualPiece {
  id: string; // stable across a move so React animates the same element
  piece: BoardPiece;
  square: Square; // current visual square — where it's rendered right now
  ghost?: boolean; // a captured/lost piece, fading out rather than vanishing
  castleFollow?: boolean; // the rook trailing the king during castling
  animSeq?: number; // bump per move → forces the "land" bounce to re-trigger
  spawned?: boolean; // a piece that appeared (promotion) → pop-in animation
}

interface ChessBoardProps {
  fen: string;
  orientation?: 'white' | 'black';
  interactive?: boolean;
  lastMove?: { from: string; to: string } | null;
  gameOver?: boolean;
  onMove?: (from: string, to: string, promotion?: PieceType) => void;
}

function parseBoard(fen: string): Map<Square, BoardPiece> {
  const chess = new Chess(fen);
  const map = new Map<Square, BoardPiece>();
  for (const row of chess.board()) {
    for (const cell of row) {
      if (cell) map.set(cell.square as Square, { type: cell.type as PieceType, color: cell.color as PieceColor });
    }
  }
  return map;
}

function isCastlingMove(piece: BoardPiece, from: Square, to: Square): boolean {
  if (piece.type !== 'k') return false;
  return (from === 'e1' && (to === 'g1' || to === 'c1')) || (from === 'e8' && (to === 'g8' || to === 'c8'));
}

function castleRookPair(from: Square, to: Square): { from: Square; to: Square } | null {
  if (from === 'e1' && to === 'g1') return { from: 'h1', to: 'f1' };
  if (from === 'e1' && to === 'c1') return { from: 'a1', to: 'd1' };
  if (from === 'e8' && to === 'g8') return { from: 'h8', to: 'f8' };
  if (from === 'e8' && to === 'c8') return { from: 'a8', to: 'd8' };
  return null;
}

/**
 * Diffs the previous board against the new one to find which piece moved
 * from where to where (matched by same type+color, nearest vacated square
 * first) — this is what lets a piece animate traveling across the board
 * instead of instantly teleporting, which chess.js's FEN alone can't tell
 * you. Handles a normal move, a capture, and castling's two simultaneous
 * moves; unmatched appearances (promotion) fall back to a pop-in, and
 * vacated squares with no matching move (en passant, the pawn that
 * promoted) become fading ghosts.
 */
function diffBoards(prev: Map<Square, BoardPiece>, next: Map<Square, BoardPiece>) {
  const vacated: Square[] = [];
  const prevAt = new Map<Square, BoardPiece>();
  for (const [sq, p] of prev) {
    prevAt.set(sq, p);
    if (!next.has(sq) || next.get(sq)!.type !== p.type || next.get(sq)!.color !== p.color) {
      vacated.push(sq);
    }
  }

  const moves: { from: Square; to: Square; piece: BoardPiece }[] = [];
  const captured: Square[] = [];
  const appeared: Square[] = [];
  const usedVacated = new Set<Square>();

  for (const [sq, piece] of next) {
    const before = prev.get(sq);
    if (before && before.type === piece.type && before.color === piece.color) continue;

    const sourceIdx = vacated.findIndex((v) => !usedVacated.has(v) && prevAt.get(v)!.type === piece.type && prevAt.get(v)!.color === piece.color);
    if (sourceIdx !== -1) {
      const from = vacated[sourceIdx];
      usedVacated.add(from);
      moves.push({ from, to: sq, piece });
      if (before) captured.push(sq);
    } else {
      appeared.push(sq);
    }
  }

  return { moves, captured, appeared, vacated };
}

export function ChessBoard({ fen, orientation = 'white', interactive = false, lastMove, gameOver = false, onMove }: ChessBoardProps) {
  const [selected, setSelected] = useState<Square | null>(null);
  const [visualPieces, setVisualPieces] = useState<VisualPiece[]>(() =>
    Array.from(parseBoard(fen)).map(([square, piece]) => ({ id: `${piece.color}${piece.type}-${square}-init`, piece, square })),
  );
  const [drag, setDrag] = useState<{ id: string; square: Square; x: number; y: number } | null>(null);
  const [promotionPrompt, setPromotionPrompt] = useState<{ from: Square; to: Square; color: PieceColor } | null>(null);
  const [flashSquares, setFlashSquares] = useState<Set<string>>(new Set());
  const prevBoardRef = useRef<Map<Square, BoardPiece>>(parseBoard(fen));
  const boardRef = useRef<HTMLDivElement>(null);
  const idCounterRef = useRef(0);
  const moveSeqRef = useRef(0);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chess = useMemo(() => {
    try {
      return new Chess(fen);
    } catch {
      return new Chess();
    }
  }, [fen]);

  const inCheck = chess.inCheck();
  const kingSquare = useMemo(() => {
    if (!inCheck) return null;
    const turnColor = chess.turn();
    for (const row of chess.board()) {
      for (const cell of row) {
        if (cell && cell.type === 'k' && cell.color === turnColor) return cell.square as Square;
      }
    }
    return null;
  }, [chess, inCheck]);

  // Reconciles the FEN → the visual piece layer, animating the diff rather
  // than snapping straight to the new board. Captured/lost pieces linger as
  // a fading "ghost"; the castling rook trails the king by a beat.
  useEffect(() => {
    const nextBoard = parseBoard(fen);
    const { moves, captured, appeared, vacated } = diffBoards(prevBoardRef.current, nextBoard);

    // Detect castling so the rook can follow the king instead of moving in parallel.
    const castleRookFrom = new Map<Square, boolean>();
    for (const mv of moves) {
      if (isCastlingMove(mv.piece, mv.from, mv.to)) {
        const pair = castleRookPair(mv.from, mv.to);
        if (pair && moves.some((m) => m.from === pair.from && m.to === pair.to)) castleRookFrom.set(pair.from, true);
      }
    }

    const hasMoves = moves.length > 0 || appeared.length > 0;
    if (hasMoves) moveSeqRef.current += 1;
    const seq = moveSeqRef.current;

    setVisualPieces((current) => {
      const bySquare = new Map<Square, VisualPiece>(current.map((v) => [v.square, v]));
      const next: VisualPiece[] = [];
      const consumed = new Set<string>();

      for (const move of moves) {
        const existing = bySquare.get(move.from);
        const id = existing ? existing.id : `${move.piece.color}${move.piece.type}-${idCounterRef.current++}`;
        consumed.add(move.from);
        next.push({
          id,
          piece: move.piece,
          square: move.to,
          animSeq: seq,
          castleFollow: !!castleRookFrom.get(move.from),
        });
      }
      for (const sq of appeared) {
        next.push({ id: `${nextBoard.get(sq)!.color}${nextBoard.get(sq)!.type}-${idCounterRef.current++}`, piece: nextBoard.get(sq)!, square: sq, spawned: true, animSeq: seq });
      }
      for (const [sq, piece] of nextBoard) {
        if (moves.some((m) => m.to === sq) || appeared.includes(sq)) continue;
        const existing = bySquare.get(sq);
        next.push({ id: existing?.id ?? `${piece.color}${piece.type}-${sq}-carry`, piece, square: sq });
      }
      // Ghosts: the captured piece, plus anything that vanished with no
      // matching move (en passant's target pawn, the pawn that promoted).
      const ghostSquares = new Set<Square>(captured);
      for (const sq of vacated) {
        if (!consumed.has(sq) && !ghostSquares.has(sq)) ghostSquares.add(sq);
      }
      for (const sq of ghostSquares) {
        const ghostPiece = prevBoardRef.current.get(sq);
        if (ghostPiece) next.push({ id: `ghost-${idCounterRef.current++}`, piece: ghostPiece, square: sq, ghost: true });
      }

      return next;
    });

    prevBoardRef.current = nextBoard;
    setSelected(null);
    setDrag(null);

    if (captured.length > 0) {
      setFlashSquares(new Set(captured));
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => setFlashSquares(new Set()), MOVE_DURATION_MS + 120);
    }
    if (moves.length > 0 || captured.length > 0) {
      const t = setTimeout(() => setVisualPieces((v) => v.filter((p) => !p.ghost)), MOVE_DURATION_MS + 60);
      return () => clearTimeout(t);
    }
  }, [fen]);

  // Reset interaction state when the board flips.
  useEffect(() => {
    setSelected(null);
    setDrag(null);
  }, [orientation]);

  useEffect(() => () => { if (flashTimerRef.current) clearTimeout(flashTimerRef.current); }, []);

  const legalTargets = useMemo(() => {
    if (!selected) return new Map<string, boolean>(); // value = isCapture
    const map = new Map<string, boolean>();
    for (const m of chess.moves({ square: selected, verbose: true }) as any[]) {
      map.set(m.to, !!m.captured);
    }
    return map;
  }, [selected, chess]);

  const ranks = useMemo(() => (orientation === 'white' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8]), [orientation]);
  const files = useMemo(() => (orientation === 'white' ? [...FILES] : [...FILES].reverse()), [orientation]);

  function squareToPercent(square: Square): { left: number; top: number } {
    const file = square[0];
    const rank = Number(square[1]);
    const fileIdx = orientation === 'white' ? FILES.indexOf(file as (typeof FILES)[number]) : 7 - FILES.indexOf(file as (typeof FILES)[number]);
    const rankIdx = orientation === 'white' ? 8 - rank : rank - 1;
    return { left: fileIdx * 12.5, top: rankIdx * 12.5 };
  }

  function attemptMove(from: Square, to: Square) {
    const piece = chess.get(from);
    const isPromotion = piece?.type === 'p' && (to[1] === '8' || to[1] === '1');
    if (isPromotion) {
      setPromotionPrompt({ from, to, color: piece!.color as PieceColor });
      return;
    }
    onMove?.(from, to);
  }

  function handleSquareClick(square: Square) {
    if (!interactive || promotionPrompt) return;
    if (square === selected) {
      setSelected(null);
      return;
    }
    const piece = chess.get(square);

    if (selected && legalTargets.has(square)) {
      attemptMove(selected, square);
      setSelected(null);
      return;
    }
    setSelected(piece && piece.color === chess.turn() ? square : null);
  }

  function handlePointerDown(e: React.PointerEvent, visual: VisualPiece) {
    if (!interactive || visual.ghost || promotionPrompt) return;
    const piece = chess.get(visual.square);
    if (!piece || piece.color !== chess.turn()) return;
    setSelected(visual.square);
    setDrag({ id: visual.id, square: visual.square, x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag) return;
    setDrag({ ...drag, x: e.clientX, y: e.clientY });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag || !boardRef.current) {
      setDrag(null);
      return;
    }
    const rect = boardRef.current.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    if (relX >= 0 && relX <= 1 && relY >= 0 && relY <= 1) {
      const fileIdx = Math.floor(relX * 8);
      const rankIdx = Math.floor(relY * 8);
      const file = orientation === 'white' ? FILES[fileIdx] : FILES[7 - fileIdx];
      const rank = orientation === 'white' ? 8 - rankIdx : rankIdx + 1;
      const target = `${file}${rank}` as Square;
      if (target !== drag.square && legalTargets.has(target)) {
        attemptMove(drag.square, target);
        setSelected(null);
      }
    }
    setDrag(null);
  }

  function handlePromotionChoice(type: PieceType) {
    if (!promotionPrompt) return;
    onMove?.(promotionPrompt.from, promotionPrompt.to, type);
    setPromotionPrompt(null);
    setSelected(null);
  }

  // Escape dismisses the promotion picker.
  useEffect(() => {
    if (!promotionPrompt) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPromotionPrompt(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [promotionPrompt]);

  const squareNodes = useMemo(() => {
    const nodes: React.ReactNode[] = [];
    for (const rank of ranks) {
      for (const file of files) {
        const square = `${file}${rank}` as Square;
        const isDark = (FILES.indexOf(file as (typeof FILES)[number]) + rank) % 2 === 0;
        const isSelected = selected === square;
        const legalInfo = legalTargets.get(square);
        const isLastMove = lastMove ? lastMove.from === square || lastMove.to === square : false;
        const isCheckSquare = kingSquare === square;
        const hasFlash = flashSquares.has(square);

        nodes.push(
          <button
            key={square}
            onClick={() => handleSquareClick(square)}
            disabled={!interactive}
            aria-label={`${file}${rank}`}
            className={cn('relative aspect-square overflow-hidden focus-visible:outline-none', interactive && 'cursor-pointer')}
            style={{ background: isDark ? DARK_SQUARE : LIGHT_SQUARE }}
          >
            {isLastMove && (
              <span
                className="absolute inset-0 pointer-events-none"
                style={{ background: 'radial-gradient(130% 130% at 50% 50%, hsla(var(--gold), 0.30) 0%, hsla(var(--gold), 0.16) 100%)' }}
              />
            )}
            {isSelected && (
              <span
                className="absolute inset-0 pointer-events-none animate-fade-in"
                style={{ background: 'radial-gradient(circle at 50% 45%, hsla(var(--gold), 0.24) 0%, hsla(var(--gold), 0.08) 100%)', boxShadow: 'inset 0 0 0 2px hsla(var(--gold), 0.85)' }}
              />
            )}
            {isCheckSquare && (
              <span
                className="absolute inset-0 pointer-events-none animate-check-glow"
                style={{ background: 'radial-gradient(circle at 50% 45%, hsla(0, 88%, 58%, 0.5) 0%, hsla(0, 84%, 50%, 0.2) 62%, transparent 100%)' }}
              />
            )}
            {legalInfo !== undefined &&
              (legalInfo ? (
                <span className="absolute inset-0 pointer-events-none animate-fade-in">
                  {/* Corner brackets — a refined "capture target" marker */}
                  <span className="absolute left-0 top-0 h-[38%] w-[38%] border-l-[3px] border-t-[3px] rounded-tl-md" style={{ borderColor: 'hsla(var(--gold), 0.9)' }} />
                  <span className="absolute right-0 top-0 h-[38%] w-[38%] border-r-[3px] border-t-[3px] rounded-tr-md" style={{ borderColor: 'hsla(var(--gold), 0.9)' }} />
                  <span className="absolute bottom-0 left-0 h-[38%] w-[38%] border-b-[3px] border-l-[3px] rounded-bl-md" style={{ borderColor: 'hsla(var(--gold), 0.9)' }} />
                  <span className="absolute bottom-0 right-0 h-[38%] w-[38%] border-b-[3px] border-r-[3px] rounded-br-md" style={{ borderColor: 'hsla(var(--gold), 0.9)' }} />
                </span>
              ) : (
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span
                    className="h-[30%] w-[30%] rounded-full animate-dot-in"
                    style={{ background: 'radial-gradient(circle at 50% 38%, hsla(var(--gold), 0.95) 0%, hsla(var(--gold), 0.55) 100%)', boxShadow: '0 1px 2px rgba(0, 0, 0, 0.18)' }}
                  />
                </span>
              ))}
            {hasFlash && <span className="absolute inset-0 pointer-events-none animate-square-flash" style={{ background: 'radial-gradient(120% 120% at 50% 50%, hsla(var(--gold), 0.55) 0%, transparent 78%)' }} />}
          </button>,
        );
      }
    }
    return nodes;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranks, files, interactive, selected, legalTargets, lastMove, kingSquare, flashSquares]);

  return (
    <div className="inline-block select-none">
      <PieceDefs />
      {/* Wooden frame — layered mahogany/rosewood with a gold hairline and a
          top light-catch so it reads as a polished board, not a flat border. */}
      <div
        className="relative rounded-2xl p-3 sm:p-4 shadow-[0_10px_40px_rgba(0,0,0,0.4),0_2px_8px_rgba(0,0,0,0.35)] transition-transform duration-500 ease-premium"
        style={{ background: FRAME_GRADIENT, border: '1px solid hsla(var(--gold), 0.3)' }}
      >
        <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ background: 'radial-gradient(140% 110% at 50% -10%, rgba(255, 228, 178, 0.12) 0%, transparent 45%)' }} />
        <div className="pointer-events-none absolute inset-0 rounded-2xl" style={{ boxShadow: 'inset 0 1px 0 rgba(255, 235, 200, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.5)' }} />

        <div
          className="relative rounded-lg overflow-hidden"
          style={{ boxShadow: 'inset 0 0 0 2px rgba(0, 0, 0, 0.45), inset 0 2px 12px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.08)' }}
        >
          <div
            ref={boardRef}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="relative grid grid-cols-8 aspect-square touch-none w-[min(92vw,560px,calc(100dvh-330px))]"
          >
            {squareNodes}

            {/* Piece layer — absolutely positioned on top of the grid so a
                piece's left/top can transition smoothly between squares
                instead of remounting inside a new cell every move. */}
            {visualPieces.map((v) => {
              const isDragging = drag?.id === v.id;
              const pos = squareToPercent(v.square);
              const isMyPiece = !v.ghost && interactive && chess.get(v.square)?.color === chess.turn();
              const inner = (
                <span
                  className={cn(
                    'pointer-events-none relative block h-full w-full transition-transform duration-200 ease-premium',
                    isMyPiece && 'group-hover:-translate-y-[5%] group-hover:scale-[1.05]',
                    v.spawned && 'animate-piece-spawn',
                    v.animSeq != null && !v.spawned && 'animate-piece-land',
                    v.ghost && 'animate-piece-captured',
                  )}
                >
                  <ChessPiece
                    type={v.piece.type}
                    color={v.piece.color}
                    className={cn('h-full w-full', isDragging ? 'piece-shadow-raised' : 'piece-shadow')}
                  />
                </span>
              );
              return (
                <div
                  key={v.id}
                  onPointerDown={(e) => handlePointerDown(e, v)}
                  className={cn(
                    'group absolute flex w-[12.5%] h-[12.5%] items-center justify-center p-[5%]',
                    v.ghost ? 'pointer-events-none' : '',
                    isMyPiece && 'cursor-grab active:cursor-grabbing',
                    isDragging ? 'z-50 will-change-transform transition-none' : 'z-10 transition-[left,top] duration-260 ease-premium',
                  )}
                  style={{
                    left: `${pos.left}%`,
                    top: `${pos.top}%`,
                    transitionDelay: v.castleFollow ? `${CASTLE_FOLLOW_DELAY_MS}ms` : undefined,
                    transform: isDragging
                      ? `translate(${drag!.x - (boardRef.current?.getBoundingClientRect().left ?? 0) - (boardRef.current?.getBoundingClientRect().width ?? 0) * 0.0625}px, ${drag!.y - (boardRef.current?.getBoundingClientRect().top ?? 0) - (boardRef.current?.getBoundingClientRect().width ?? 0) * 0.0625}px) scale(1.08)`
                      : undefined,
                  }}
                >
                  {inner}
                </div>
              );
            })}

            {/* Checkmate — a soft vignette settles over the board so the
                final position reads as "resolved", not merely paused. */}
            {gameOver && inCheck && (
              <div className="pointer-events-none absolute inset-0 z-40 animate-fade-in" style={{ background: 'radial-gradient(120% 120% at 50% 50%, transparent 52%, rgba(0,0,0,0.38) 100%)' }} />
            )}
          </div>
        </div>

        {/* Coordinates — file letters along the bottom, rank numbers along
            the left, inlaid into the wooden frame like a marquetry label. */}
        <div className="absolute inset-x-0 bottom-1 flex px-3 sm:px-4">
          {files.map((f) => (
            <span key={f} className="flex-1 text-center font-mono tracking-wider text-[#E6D3AC]/75" style={{ fontSize: 'clamp(8px, 1.9vw, 12px)' }}>
              {f}
            </span>
          ))}
        </div>
        <div className="absolute bottom-2.5 left-1 top-2.5 flex flex-col sm:left-1.5 sm:top-3.5">
          {ranks.map((r) => (
            <span key={r} className="flex flex-1 w-3 items-center justify-center font-mono tracking-wider text-[#E6D3AC]/75" style={{ fontSize: 'clamp(8px, 1.9vw, 12px)' }}>
              {r}
            </span>
          ))}
        </div>
      </div>

      {/* Promotion picker — a glassy panel with the four options, cancel on
          outside click or Escape, and a tasteful entrance animation. */}
      {promotionPrompt && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-background/60 backdrop-blur-sm animate-fade-in"
          onClick={() => setPromotionPrompt(null)}
          role="dialog"
          aria-label="Promote pawn"
        >
          <div
            className="animate-promo-enter rounded-2xl border border-border bg-card/90 p-4 shadow-premium-lg backdrop-blur-md"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-3 text-center text-xs uppercase tracking-[0.18em] text-muted-foreground">Promote to</p>
            <div className="flex gap-2">
              {(['q', 'r', 'b', 'n'] as PieceType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => handlePromotionChoice(type)}
                  className="group flex h-16 w-16 flex-col items-center justify-center rounded-xl border border-border bg-secondary/60 p-1.5 shadow-soft transition-all duration-200 ease-premium hover:scale-[1.06] hover:border-gold/40 hover:bg-gold/10 focus-visible:outline-none"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)' }}
                >
                  <span className="pointer-events-none flex h-full w-full items-center justify-center">
                    <ChessPiece type={type} color={promotionPrompt.color} className="h-full w-full piece-shadow transition-transform duration-200 ease-premium group-hover:scale-110" />
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
