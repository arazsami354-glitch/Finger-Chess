import { useId } from 'react';

interface FingerChessLogoProps {
  className?: string;
  /** Body fill — defaults to currentColor so the mark adapts to the surrounding text color automatically. */
  bodyColor?: string;
  /** Fingerprint ridge color — defaults to the brand gold. */
  ridgeColor?: string;
}

/**
 * The Finger Chess mark: a king chess piece — strategy — with a
 * fingerprint's ridge pattern etched into its body — identity. Ported
 * from the player-facing app (components/brand/logo.tsx there) so the
 * admin console carries the exact same brand mark rather than a
 * different logo for internal tooling.
 */
export function FingerChessLogo({ className, bodyColor = 'currentColor', ridgeColor = '#D4AF37' }: FingerChessLogoProps) {
  const clipId = useId();

  return (
    <svg viewBox="0 0 48 48" className={className} fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Finger Chess">
      <defs>
        <clipPath id={clipId}>
          <path d={KING_SILHOUETTE_PATH} />
        </clipPath>
      </defs>

      <path d={KING_SILHOUETTE_PATH} fill={bodyColor} />

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
