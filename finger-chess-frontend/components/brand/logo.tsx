'use client';

import { useId } from 'react';

interface FingerChessLogoProps {
  className?: string;
  /** Body fill — defaults to currentColor so the mark adapts to dark/light mode and its surrounding text color automatically. */
  bodyColor?: string;
  /** Fingerprint ridge color — defaults to the brand gold, since the identity/fingerprint half of the mark is the accent, not the base shape. */
  ridgeColor?: string;
}

/**
 * The Finger Chess mark: a king chess piece — the strategy half of the
 * brand — with a fingerprint's concentric ridge pattern etched into its
 * body — the identity half. Every player who sits down to play is putting
 * their own name and rating on the line, one move at a time; the king
 * carries that mark rather than standing plain.
 *
 * Built as inline SVG (not an image asset) so it inherits `currentColor`
 * by default, scales losslessly at any size from a favicon to a hero
 * lockup, and needs no separate light/dark asset variants — the same
 * component IS both.
 */
export function FingerChessLogo({ className, bodyColor = 'currentColor', ridgeColor = '#D4AF37' }: FingerChessLogoProps) {
  const clipId = useId();

  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Finger Chess">
      <defs>
        <clipPath id={clipId}>
          {/* The king silhouette also serves as the clip region for the
              fingerprint ridges below, so the ridge pattern only ever
              shows up "inside" the piece rather than floating free of it. */}
          <path d={KING_SILHOUETTE_PATH} />
        </clipPath>
      </defs>

      {/* Base king silhouette */}
      <path d={KING_SILHOUETTE_PATH} fill={bodyColor} />

      {/* Fingerprint ridges — concentric, deliberately off-center (toward
          the crown/upper body) rather than perfectly centered, so it
          reads as a print pressed into the piece rather than a bullseye
          target painted on top of it. Clipped to the silhouette above. */}
      <g clipPath={`url(#${clipId})`} stroke={ridgeColor} strokeWidth="1.1" strokeLinecap="round" opacity="0.92">
        <path d="M14 34c4-5 16-5 20 0" />
        <path d="M12.5 30c5.5-6.5 17.5-6.5 23 0" />
        <path d="M13 26.5c6-6.8 16-6.8 22 0" />
        <path d="M14.5 23.2c5-5.6 14-5.6 19 0" />
        <path d="M16.5 20.2c3.8-4 10.7-4 14.5 0" />
        <path d="M15 37.5c4.6-4.4 13.4-4.4 18 0" />
      </g>
    </svg>
  );
}

// A simplified, iconic king silhouette: cross finial, crown ball, banded
// neck, a bell-curved body tapering to a wide base — legible at 16px
// (favicon scale) and detailed enough to hold the fingerprint ridges at
// full size without either half fighting the other for attention.
const KING_SILHOUETTE_PATH = `
  M22.5 2.5 H25.5 V6 H29 V9 H25.5 V11.3
  A5.2 5.2 0 0 1 27.6 15.6
  C30.5 17.3 32.5 20.6 33.4 24.5
  C34.5 29 34.8 34 34.8 38.5
  H37 A2 2 0 0 1 39 40.5
  V42.5 A1.5 1.5 0 0 1 37.5 44
  H10.5 A1.5 1.5 0 0 1 9 42.5
  V40.5 A2 2 0 0 1 11 38.5
  H13.2
  C13.2 34 13.5 29 14.6 24.5
  C15.5 20.6 17.5 17.3 20.4 15.6
  A5.2 5.2 0 0 1 22.5 11.3
  V9 H19 V6 H22.5
  Z
`;
