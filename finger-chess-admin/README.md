# Finger Chess — Admin Console

React + TypeScript + Vite admin frontend for the Finger Chess backend — the internal operator
console for user management, wallet monitoring, game oversight, financial reporting, support, and
fraud review.

## Stack
React 18 · TypeScript · Vite · Tailwind CSS · React Router · Recharts · Axios

## Getting Started

```bash
cp .env.example .env
npm install
npm run dev        # served at http://localhost:5174, proxies /api to the backend
```

In production, serve the built `dist/` behind the same origin (or reverse proxy) as the backend
API so `/api/*` calls need no CORS configuration — `vite.config.ts`'s proxy is dev-only.

## Design System

This isn't styled as a generic admin template, and it now carries Finger Chess's actual brand
identity rather than a separate internal-tool palette — the same **Black (`#111111`), Gold
(`#D4AF37`), White (`#FFFFFF`)** used across the whole product, styled here as a ledger/trading
terminal since this tool's entire job is overseeing real money:

- **Palette**: true black canvas (`#111111`), the brand gold (`#D4AF37`) as the single accent —
  standing in for weight and seriousness rather than "friendly SaaS blue" — and muted (not neon)
  status colors — forest green for gains, muted red for losses, gold doing double duty for
  pending/warning states since introducing a fourth hue wasn't worth diluting the three-color
  brand identity for.
- **Logo**: the same king + fingerprint mark as the player-facing app (`components/brand/logo.tsx`,
  ported directly) — one brand identity across every surface of the product, not a different logo
  for internal tooling.
- **Type system**: three deliberate roles — Space Grotesk for headings (a little architectural,
  not a default system font), Inter for UI labels and prose, IBM Plex Mono for every number,
  balance, ID, and timestamp. Financial data is always monospaced so figures align in columns.
- **Signature element**: the ticker strip under the header (`AppLayout.tsx`) — a live, running
  tape of revenue/active games/user count/queue depth, styled like a market ticker rather than a
  dashboard card. It's visible on every page, not just the dashboard, because those numbers are
  the job, not a summary of it.
- **Texture**: a faint ruled-ledger-page hairline pattern (`.ledger-texture` in `index.css`) on
  the main content background — subtle enough to not interfere with reading, present enough to
  reinforce what this tool is.

## Pages → Backend Endpoints

| Page | Endpoints |
|---|---|
| Dashboard | `GET /admin/dashboard/overview`, `GET /admin/reports/revenue/series` |
| Users | `GET/POST /admin/users*` (list, detail, ban, suspend, reactivate) |
| Wallet Monitoring | `GET/POST /admin/wallet/withdrawals*`, `/refunds*`, `GET /admin/wallet/reconciliation/drifts` |
| Game Monitoring | `GET /admin/games/live`, `GET /admin/games/flagged`, `POST /admin/games/anticheat/:id/review` |
| Financial Reports | `GET /admin/reports/revenue`, `/revenue/series`, `/commission/by-tier`, `/deposits-withdrawals` |
| Support Tickets | `GET/POST /admin/support/tickets*` |
| Fraud Detection | `GET /admin/wallet/fraud-signals` |
| System Logs | `GET /admin/dashboard/logs/admin`, `/logs/security` (super_admin only) |

## Auth & Role Gating

Login reuses the platform's own `/auth/login` (including the 2FA step, if the admin account has
it enabled) — there's no separate admin auth system. After login, `AuthContext` fetches `/users/me`
and refuses to set an authenticated session unless the account's `role` is `support_agent`,
`finance_admin`, or `super_admin` — a `player` account that somehow gets a valid token still can't
use this app.

Role gating happens at two levels, matching the backend's own `@Roles()` guards exactly:
- **Nav visibility**: `AppLayout`'s nav list filters out items the current role can't reach (e.g.
  "System Logs" only renders for `super_admin`).
- **Action visibility**: destructive actions (ban/suspend on the Users page) only render for
  `finance_admin`/`super_admin` — a `support_agent` sees the same user detail panel but no
  ban/suspend buttons. This is a UX convenience only, not the real boundary — the backend's own
  `RolesGuard` is what actually enforces it if someone bypasses the UI.

Tokens are refreshed silently on a 401 (`api/client.ts`) using the same rotate-on-use refresh
token flow the backend implements, so an admin mid-review of a withdrawal doesn't get logged out
mid-task just because their 15-minute access token expired.

## What's Intentionally Left as a Stub

- **Token storage**: access/refresh tokens live in `localStorage` for simplicity, matching the
  backend's JSON-body token contract. A hardened production deploy would prefer httpOnly cookies
  issued by the backend directly — that's a backend contract change, not just a frontend one, so
  it's noted here rather than silently done differently from the API this connects to.
- **User creation for admin roles**: there's no "create admin" UI — `support_agent`/`finance_admin`/
  `super_admin` accounts are expected to be provisioned directly (seed script or DB), consistent
  with not wanting a self-service path to admin privileges.
- **Pagination**: list endpoints return a single page (cursor param exists on the backend); the UI
  doesn't yet page through it. Fine at current scale, worth adding once user/game counts grow.
