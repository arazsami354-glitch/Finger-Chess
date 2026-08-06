'use client';

import { memo } from 'react';

export type PieceColor = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

interface PieceProps {
  className?: string;
}

/**
 * ORIGINAL PIECE SET — "Aurea"
 *
 * Hand-authored geometry (no traced/copyrighted assets). The design brief:
 * a Staunton-*inspired* silhouette family (lathe-turned lower bodies sharing
 * one profile, distinctive heads) rendered like hand-polished heirloom
 * pieces — porcelain ivory for White, warm espresso-ebony for Black — with
 * subtle gold inlays (base ring, collar, crown details) that tie the set to
 * the app's single brand accent. Everything is vector, crisp at any size,
 * and drawn on a shared 100×100 viewBox so proportions are consistent.
 *
 * PERFORMANCE: exactly six gradients exist across the entire set (two body
 * fills, two light-catch sheens, one gold accent, one base shade). They are
 * mounted ONCE by <PieceDefs/> and referenced by fixed ids, so a full board
 * (32 pieces) shares the same rasterized defs instead of each instance
 * declaring its own. Drop shadows live in CSS filters (see .piece-shadow in
 * globals.css) — never SVG filters — and every piece is React.memo'd so a
 * single piece sliding across the board re-renders only that piece.
 */
export function PieceDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        {/* White — porcelain ivory, warm light from above-left */}
        <linearGradient id="fc-pw" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFDF6" />
          <stop offset="30%" stopColor="#F7EFDC" />
          <stop offset="72%" stopColor="#E7D3AE" />
          <stop offset="100%" stopColor="#CFB385" />
        </linearGradient>
        {/* Black — espresso-ebony, top-lit so the silhouette reads against dark wood */}
        <linearGradient id="fc-pb" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#5A5047" />
          <stop offset="35%" stopColor="#3A322B" />
          <stop offset="78%" stopColor="#251E19" />
          <stop offset="100%" stopColor="#14100C" />
        </linearGradient>
        {/* Vertical light-catch — the "turned" polish detail */}
        <linearGradient id="fc-pw-sh" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0" />
          <stop offset="50%" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="fc-pb-sh" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#CFC0A8" stopOpacity="0" />
          <stop offset="50%" stopColor="#CFC0A8" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#CFC0A8" stopOpacity="0" />
        </linearGradient>
        {/* Gold accent — the one brand color, used for inlay details */}
        <linearGradient id="fc-gold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#F9E7B0" />
          <stop offset="55%" stopColor="#DFBB62" />
          <stop offset="100%" stopColor="#A77D2C" />
        </linearGradient>
        {/* Grounded shading inside the base plinth */}
        <linearGradient id="fc-shade" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.22" />
        </linearGradient>
      </defs>
    </svg>
  );
}

const BODY = (color: PieceColor) => (color === 'w' ? 'url(#fc-pw)' : 'url(#fc-pb)');
const SHEEN = (color: PieceColor) => (color === 'w' ? 'url(#fc-pw-sh)' : 'url(#fc-pb-sh)');
const GOLD = 'url(#fc-gold)';
const strokeColor = (color: PieceColor) => (color === 'w' ? '#7C6947' : '#0D0A08');

/**
 * Shared wrapper. The <g> owns the outline stroke/join every piece uses;
 * silhouettes inherit it, gold inlays opt out with stroke="none". A single
 * vertical light-catch rect is the detail that reads as "polished, turned
 * ivory/ebony" rather than a flat silhouette.
 */
function PieceShell({ color, className, children }: { color: PieceColor; className?: string; children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 100 100" className={className} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <g stroke={strokeColor(color)} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" strokeOpacity={color === 'w' ? 0.55 : 0.85}>
        {children}
      </g>
      <rect x="37" y="16" width="26" height="72" fill={SHEEN(color)} opacity="0.9" pointerEvents="none" stroke="none" />
    </svg>
  );
}

/**
 * Shared base — plinth + flared foot + a gold inlay ring at the top of the
 * foot + a grounded shadow. Every piece uses this exact base (width varies),
 * which is what makes the six pieces read as one matched set.
 */
function Base({ color, rx }: { color: PieceColor; rx: number }) {
  const f = BODY(color);
  return (
    <>
      <ellipse cx="50" cy="92.5" rx={rx} ry="4.4" fill={f} />
      <ellipse cx="50" cy="88.5" rx={rx - 5} ry="3" fill="url(#fc-shade)" opacity="0.6" stroke="none" />
      <path
        d={`M${50 - rx} 92.5 C${50 - rx} 86.5 ${50 - rx + 4} 83.5 ${50 - rx + 7} 81.5 L${50 + rx - 7} 81.5 C${50 + rx - 4} 83.5 ${50 + rx} 86.5 ${50 + rx} 92.5 Z`}
        fill={f}
      />
      <ellipse cx="50" cy="84" rx={rx - 5} ry="2.1" fill="none" stroke={GOLD} strokeWidth="1.6" strokeOpacity={color === 'w' ? 0.85 : 0.65} />
    </>
  );
}

/** Thin gold ring used mid-body — a small luxury detail on the turned profile. */
function Ring({ cy, rx, opacity = 0.75 }: { cy: number; rx: number; opacity?: number }) {
  return <ellipse cx="50" cy={cy} rx={rx} ry="2.5" fill="none" stroke={GOLD} strokeWidth="1.6" strokeOpacity={opacity} />;
}

export function PawnPiece({ color, className }: PieceProps & { color: PieceColor }) {
  const f = BODY(color);
  return (
    <PieceShell color={color} className={className}>
      <Base color={color} rx={19} />
      {/* skirt → waist → collar, one continuous turned profile */}
      <path
        d="M35 81.5 C35 74.5 38 70.5 42 68.5 C37 65 35 60 35 55 C35 49.5 37.5 46.5 40.5 45.5 C37.5 44 36 41.5 36 38.5 C36 34.5 39 32 42 31 L44 31 C45.5 28.5 47.5 27 50 27 C52.5 27 54.5 28.5 56 31 L58 31 C61 32 64 34.5 64 38.5 C64 41.5 62.5 44 59.5 45.5 C62.5 46.5 65 49.5 65 55 C65 60 63 65 58 68.5 C62 70.5 65 74.5 65 81.5 Z"
        fill={f}
      />
      {/* head sphere */}
      <circle cx="50" cy="19.5" r="9.5" fill={f} />
      {/* gold collar band — the classic Staunton pawn's ring detail */}
      <ellipse cx="50" cy="47" rx="7" ry="2.4" fill="none" stroke={GOLD} strokeWidth="1.6" strokeOpacity="0.85" />
    </PieceShell>
  );
}

export function RookPiece({ color, className }: PieceProps & { color: PieceColor }) {
  const f = BODY(color);
  return (
    <PieceShell color={color} className={className}>
      <Base color={color} rx={23} />
      {/* tapered tower */}
      <path d="M36 16 C36 40 34 62 33 82 L67 82 C66 62 64 40 64 16 Z" fill={f} />
      {/* parapet walk + three merlons */}
      <rect x="31" y="11" width="38" height="9" rx="2" fill={f} />
      <rect x="33" y="3" width="8" height="8" rx="1.5" fill={f} />
      <rect x="46" y="3" width="8" height="8" rx="1.5" fill={f} />
      <rect x="59" y="3" width="8" height="8" rx="1.5" fill={f} />
      {/* gold band + ring */}
      <rect x="37.5" y="25" width="25" height="3.5" rx="1.6" fill={GOLD} opacity="0.9" stroke="none" />
      <Ring cy={50} rx={15} />
    </PieceShell>
  );
}

export function BishopPiece({ color, className }: PieceProps & { color: PieceColor }) {
  const f = BODY(color);
  return (
    <PieceShell color={color} className={className}>
      <Base color={color} rx={21} />
      {/* flared body up to the mitre seat */}
      <path d="M34 81.5 C34 74 37 70 41 67.5 C37 64 36 59 36 54 C36 47 38 43 41 40.5 L41 36 L59 36 L59 40.5 C62 43 64 47 64 54 C64 59 63 64 59 67.5 C63 70 66 74 66 81.5 Z" fill={f} />
      {/* mitre cap with a gold slit */}
      <path d="M40 36 C42 27 46 22 50 22 C54 22 58 27 60 36 Z" fill={f} />
      <path d="M47 23 Q50 28 53 23" stroke={GOLD} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeOpacity="0.95" />
      {/* finial ball */}
      <circle cx="50" cy="9.5" r="4.4" fill={f} />
      <Ring cy={58} rx={15.5} />
    </PieceShell>
  );
}

export function KnightPiece({ color, className }: PieceProps & { color: PieceColor }) {
  const f = BODY(color);
  const s = strokeColor(color);
  return (
    <PieceShell color={color} className={className}>
      <Base color={color} rx={22} />
      {/* horse-head profile, facing left — neck, jaw, cheek, forehead, poll */}
      <path
        d="M64 81.5 L39 81.5 C38.5 75.5 41 71.5 44.5 69 C41.5 65.5 40.5 61 40.5 56 C40.5 51 42 47.5 45 45 C41.5 44 39.5 41 39.5 37 C39.5 32 43.5 28 49 27.5 L52 22 C53.5 19.5 56.5 19.5 58 22 L59.5 27.5 C63.5 28.5 67 32.5 67.5 37.5 C68 43 64.5 47.5 60.5 49.5 C63 53.5 64 58.5 63.5 63.5 C63 67.5 61.5 71.5 62.5 75.5 C64 78.5 64 80.5 64 81.5 Z"
        fill={f}
      />
      {/* ear */}
      <path d="M50 26 L55.5 11.5 L61.5 21.5 Z" fill={f} />
      {/* eye + nostril */}
      <circle cx="52" cy="31" r="2" fill={s} opacity="0.8" stroke="none" />
      <path d="M36 41 C35 39.6 36.2 38 38.5 37.6" stroke={s} strokeWidth="1.4" fill="none" strokeOpacity="0.7" />
      {/* mane flowing down the back of the neck */}
      <path d="M59.5 29 C63.5 35 65 42 62.5 49.5 C64.5 44.5 65 38 61.5 31.5" stroke={s} strokeWidth="2" fill="none" strokeLinecap="round" strokeOpacity="0.6" />
      <Ring cy={73} rx={12.5} opacity={0.6} />
    </PieceShell>
  );
}

export function QueenPiece({ color, className }: PieceProps & { color: PieceColor }) {
  const f = BODY(color);
  return (
    <PieceShell color={color} className={className}>
      <Base color={color} rx={24} />
      {/* flared body up to the crown */}
      <path d="M30 81.5 C30 74 33 70 37 68 C33 65 32 60 32 55 C32 49 34 45 37.5 42.5 L36 43 L38 31 L44 25 L50 21 L56 25 L62 31 L64 43 L62.5 42.5 C66 45 68 49 68 55 C68 60 67 65 63 68 C67 70 70 74 70 81.5 Z" fill={f} />
      {/* gold crown band */}
      <rect x="35" y="46" width="30" height="6" rx="3" fill={GOLD} opacity="0.95" stroke="none" />
      {/* five ball-tipped coronet points */}
      <circle cx="38" cy="31" r="3.1" fill={f} />
      <circle cx="44" cy="25" r="3.4" fill={f} />
      <circle cx="50" cy="21" r="3.8" fill={f} />
      <circle cx="56" cy="25" r="3.4" fill={f} />
      <circle cx="62" cy="31" r="3.1" fill={f} />
      <Ring cy={62} rx={16} />
    </PieceShell>
  );
}

export function KingPiece({ color, className }: PieceProps & { color: PieceColor }) {
  const f = BODY(color);
  return (
    <PieceShell color={color} className={className}>
      <Base color={color} rx={24} />
      {/* broad royal body */}
      <path d="M29 81.5 C29 74 32 70 36 67.5 C32 64 31 59 31 54 C31 48 33 44 37 42 L63 42 C67 44 69 48 69 54 C69 59 68 64 64 67.5 C68 70 71 74 71 81.5 Z" fill={f} />
      {/* crown band with jewel inlays */}
      <rect x="35" y="30" width="30" height="12" rx="3.5" fill={f} />
      <circle cx="43" cy="36" r="1.5" fill={GOLD} opacity="0.95" stroke="none" />
      <circle cx="50" cy="36" r="1.5" fill={GOLD} opacity="0.95" stroke="none" />
      <circle cx="57" cy="36" r="1.5" fill={GOLD} opacity="0.95" stroke="none" />
      {/* finial column + gold cross */}
      <path d="M44.5 30 C44.5 22 46 16 50 16 C54 16 55.5 22 55.5 30 Z" fill={f} />
      <rect x="37" y="18" width="26" height="6.5" rx="2.5" fill={GOLD} opacity="0.95" stroke="none" />
      <circle cx="50" cy="9.5" r="2.9" fill={GOLD} stroke="none" />
      <Ring cy={58} rx={16.5} />
    </PieceShell>
  );
}

const PIECE_COMPONENTS: Record<PieceType, (props: PieceProps & { color: PieceColor }) => JSX.Element> = {
  p: PawnPiece,
  r: RookPiece,
  b: BishopPiece,
  n: KnightPiece,
  q: QueenPiece,
  k: KingPiece,
};

export const ChessPiece = memo(function ChessPiece({ type, color, className }: { type: PieceType; color: PieceColor; className?: string }) {
  const Component = PIECE_COMPONENTS[type];
  return <Component color={color} className={className} />;
});
