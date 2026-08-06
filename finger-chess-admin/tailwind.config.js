/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // FINGER CHESS brand palette, exact hex per brand spec — the same
        // three colors as the player-facing app, not a separate internal-
        // tool palette. Surface/border tones are near-black shades derived
        // from the brand black, for layering depth only.
        canvas: '#111111',
        surface: '#1A1A1A',
        'surface-raised': '#232323',
        border: '#2E2E2E',
        'border-soft': '#232323',
        ink: '#FFFFFF',
        'ink-muted': '#A3A3A3',
        'ink-faint': '#6B6B6B',
        // Gold — the one brand accent, used identically to the player app.
        brass: '#D4AF37',
        'brass-bright': '#E4C567',
        // Status colors — functional (wallet/fraud state), deliberately
        // secondary to the black/gold/white identity, same reasoning as
        // the player app's README documents for its own gain/loss/warn.
        gain: '#3FA66C',
        loss: '#D3564C',
        warn: '#D4AF37',
        info: '#4C8FD3',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -8px rgba(0,0,0,0.5)',
        soft: '0 1px 2px rgba(0,0,0,0.2), 0 4px 16px -4px rgba(0,0,0,0.35)',
        premium: '0 2px 4px rgba(0,0,0,0.25), 0 16px 40px -12px rgba(0,0,0,0.55)',
      },
      borderRadius: {
        lg: '0.875rem',
        xl: '1.125rem',
      },
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
};
