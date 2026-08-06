/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        gain: 'hsl(var(--gain))',
        loss: 'hsl(var(--loss))',
        warn: 'hsl(var(--warn))',
        gold: 'hsl(var(--gold))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 4px)',
        sm: 'calc(var(--radius) - 8px)',
        xl: 'calc(var(--radius) + 6px)',
        '2xl': 'calc(var(--radius) + 12px)',
      },
      fontFamily: {
        display: ['var(--font-sora)', 'sans-serif'],
        body: ['var(--font-inter)', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'monospace'],
      },
      // A soft, layered shadow scale — two shadows stacked (a tight
      // close-contact one + a broader diffuse one) reads as a genuinely
      // soft, physically-plausible shadow instead of the harsh single flat
      // shadow Tailwind's own defaults produce. Tuned lighter than most
      // defaults since a heavy shadow on a black/gold palette reads muddy,
      // not premium.
      boxShadow: {
        soft: '0 1px 2px hsla(0,0%,0%,0.04), 0 4px 16px -4px hsla(0,0%,0%,0.08)',
        premium: '0 2px 4px hsla(0,0%,0%,0.04), 0 12px 32px -8px hsla(0,0%,0%,0.12)',
        'premium-lg': '0 4px 8px hsla(0,0%,0%,0.06), 0 24px 48px -12px hsla(0,0%,0%,0.18)',
        glow: '0 0 0 1px hsla(var(--primary), 0.15), 0 8px 24px -4px hsla(var(--primary), 0.25)',
      },
      // A gentle "ease-out-expo"-style curve — fast start, long silky
      // deceleration. This single curve, used consistently, is most of
      // what makes an interface feel smooth and considered rather than
      // just "has transitions" — abrupt linear/ease timing is the single
      // biggest tell of an unpolished UI.
      transitionTimingFunction: {
        premium: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      transitionDuration: {
        260: '260ms',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 hsla(var(--primary), 0.4)' }, '100%': { boxShadow: '0 0 0 10px hsla(var(--primary), 0)' } },
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97)' }, to: { opacity: '1', transform: 'scale(1)' } },
        /* Chess board animation suite — tuned so pieces settle with a soft
           "snap" rather than teleporting or gliding forever. All transforms
           run on GPU-composited layers (transform/opacity only). */
        'piece-land': {
          '0%': { transform: 'scale(1)' },
          '55%': { transform: 'scale(1.09)' },
          '100%': { transform: 'scale(1)' },
        },
        'piece-captured': {
          '0%': { transform: 'scale(1)', opacity: '1' },
          '100%': { transform: 'scale(0.55)', opacity: '0' },
        },
        'piece-spawn': {
          '0%': { transform: 'scale(0.3)', opacity: '0' },
          '60%': { transform: 'scale(1.08)', opacity: '1' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'check-glow': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'square-flash': {
          '0%': { opacity: '0.9' },
          '100%': { opacity: '0' },
        },
        'promo-enter': {
          '0%': { opacity: '0', transform: 'translateY(14px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'dot-in': {
          '0%': { transform: 'scale(0)' },
          '70%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-ring': 'pulse-ring 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up': 'fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'piece-land': 'piece-land 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) 0.2s both',
        'piece-captured': 'piece-captured 0.28s ease-in 0.02s forwards',
        'piece-spawn': 'piece-spawn 0.32s cubic-bezier(0.16, 1, 0.3, 1) 0.05s both',
        'check-glow': 'check-glow 1.3s ease-in-out infinite',
        'square-flash': 'square-flash 0.35s ease-out forwards',
        'promo-enter': 'promo-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'dot-in': 'dot-in 0.22s cubic-bezier(0.16, 1, 0.3, 1) both',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
