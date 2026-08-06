# Finger Chess — Player-Facing Frontend

Next.js 14 (App Router) + TypeScript + Tailwind CSS + shadcn/ui — the full player experience for
the chess wagering platform: landing, auth, dashboard, wallet, matchmaking lobby, live play,
profile, leaderboard, a condensed admin view, and settings.

## Stack
Next.js 14 · React 18 · TypeScript · Tailwind CSS · shadcn/ui (hand-authored primitives, not the
CLI-generated copies) · Radix UI · Socket.IO client · chess.js · Stripe Elements · Recharts

## Getting Started

```bash
cp .env.example .env.local
npm install
npm run dev        # http://localhost:3000... wait, backend is also 3000 — see note below
```

**Port note**: the backend defaults to port 3000. Run this frontend on a different port
(`next dev -p 3001`) or change the backend's `PORT` — `next.config.js`'s rewrite proxies `/api/*`
to whatever `NEXT_PUBLIC_API_PROXY_TARGET` points at, so the two need distinct ports locally.

## Every Page, and What It Talks To

| Page | Route | Backend endpoints |
|---|---|---|
| Landing | `/` | none — fully static |
| Login | `/login` | `POST /auth/login`, `/auth/2fa/login-verify`, OAuth redirects |
| Register | `/register` | `POST /auth/register` |
| Forgot/Reset Password | `/forgot-password`, `/reset-password` | `POST /auth/forgot-password`, `/auth/reset-password` |
| Email Verification | `/verify-email` | `POST /auth/verify-email` |
| OAuth Callback | `/oauth/callback` | reads the URL fragment the backend redirects to |
| Dashboard | `/dashboard` | `GET /wallet/balance`, `/games/history` |
| Wallet | `/wallet` | `GET /wallet/balance`, `/wallet/transactions`, `POST /payments/deposit/initiate`, `/wallet/withdraw/request` |
| Play — Mode Selection | `/lobby` | none — static; the primary entry point into either game mode, Free Play shown first and most prominent |
| Play — Free Play | `/lobby/free` | `/matchmaking` WebSocket namespace, always `entryFee: 0` — no wallet, no KYC, no age/rules gate |
| Play — Real Money | `/lobby/paid` | `/matchmaking` WebSocket namespace, `entryFee` from `$5–$100` — wallet balance, KYC, age, and rules all enforced |
| Game Screen | `/play/[gameId]` | `/game` WebSocket namespace, `GET /games/:id/pgn` |
| Profile | `/profile` | `GET /games/history` — Free/Paid stats split computed client-side from each game's `entryFee` |
| Leaderboard | `/leaderboard` | `GET /users/leaderboard` |
| Admin (condensed) | `/admin` | `GET /admin/dashboard/overview`, `/admin/wallet/withdrawals/pending`, `/admin/wallet/fraud-signals` |
| Settings | `/settings` | `GET/PATCH /users/me`, `/auth/sessions`, `/auth/2fa/*` |

## Design System

Finger Chess's brand identity: **Black (#111111), Gold (#D4AF37), White (#FFFFFF)** — modern,
minimal, premium, the specific reference points being Apple, Stripe, and Chess.com rather than a
generic SaaS look. Deliberately distinct from the separate ops-admin tool's own (functionally
similar but not brand-identical) dark palette — this is the player-facing product and carries the
actual brand, not an internal tool's own visual language.

- **Palette**: true black (`#111111`) dark-mode base — not a dark gray pretending to be black —
  with gold as the single, deliberate accent color for every primary action, focus ring, and
  highlight, and white for light-mode background / dark-mode text. Functional colors (green for a
  positive wallet balance, red for a loss/destructive action) exist alongside this for financial
  and win/loss UX, same as Stripe or Chess.com use color-coding within their own tightly-controlled
  brands — they're kept visually secondary, never competing with the black/gold/white identity.
- **Logo**: a king chess piece with a fingerprint's ridge pattern etched into its body —
  `components/brand/logo.tsx`. Strategy (the king) and identity (the fingerprint), which is the
  whole brand concept: every player puts their own name and rating on the line, one calculated
  move at a time. Inline SVG, not an image asset, so it inherits `currentColor` and needs no
  separate light/dark variants — the same component works everywhere, including the favicon
  (`app/icon.svg`) and the web manifest (`app/manifest.ts`, short name `FC`).
- **Type system**: Sora for display/headings (geometric, a little architectural), Inter for body
  and UI, JetBrains Mono for every number — ratings, balances, clocks, move lists. Numbers are
  always monospaced so they align and don't visually shift as digits change (matters a lot for a
  live countdown clock).
- **Texture**: `.board-texture` — a faint diagonal gold-on-black checker pattern referencing an
  actual chessboard, used behind hero/auth/game-adjacent sections. Subtle by design; it's a wink,
  not wallpaper.
- **Dark mode is the primary experience** (`defaultTheme="dark"`), light mode is a fully supported
  toggle, not an afterthought — both themes share the same token structure via CSS variables
  (`app/globals.css`) so neither drifts out of sync as the app grows, and both are built from the
  same three brand colors rather than diverging palettes per theme.


## Real-Time Architecture

Two Socket.IO namespaces, wrapped in dedicated hooks (`hooks/use-matchmaking-socket.ts`,
`hooks/use-game-socket.ts`) so page components stay declarative — they read state, they don't
manage socket lifecycle:

- **Matchmaking**: join a room (time control × entry fee), heartbeat every 5s to stay "present" for
  other players' match attempts, get redirected into `/play/[gameId]` the instant `matchFound`
  fires.
- **Game**: server-authoritative move submission — the board's own chess.js instance only
  determines *which squares to highlight as legal targets* for UX; the actual move is submitted as
  SAN and only applied to displayed state once the server confirms it via `moveApplied`. A
  rejected move never touches the board.

## What's Intentionally Left as a Stub

Consistent with how the rest of this project has flagged incomplete pieces rather than hiding them:

- **Promotion picker**: pawn promotions default to queen (`chess-board.tsx`'s `handleMove` in the
  game screen) — a real deployment needs a small piece-picker dialog when a pawn move reaches the
  back rank instead of silently assuming queen.
- **In-app replay viewer**: `GET /games/:id/replay` exists on the backend and PGN export is wired
  up (`Export PGN` button), but there's no in-app move-by-move replay UI yet — reviewing a finished
  game today means downloading the PGN into external software.
- **Admin page is condensed on purpose**: `/admin` here covers the two most time-sensitive queues
  (withdrawals, fraud signals) for a logged-in admin who's already in the player app. The separate
  standalone admin dashboard project is the full operator console — user management, financial
  reports with charts, support ticket threads, system logs. This page is a convenience view, not a
  replacement for it.
- **Backend gaps this build surfaced and fixed while wiring the frontend to it**: there was no
  `/games/history` (dashboard/profile needed it), no `/users/leaderboard` (leaderboard needed it),
  no `PATCH /users/me` (settings needed it), and `/users/me` didn't return `role` at all — meaning
  the admin nav link would never have appeared for an actual admin. All four are now in the
  backend project, not just assumed away on the frontend.
