# Finger Chess — Backend

Finger Chess is a premium online chess platform where players compete in real-time matches for
real money — choosing a predefined entry-fee room, playing a fair match, and the winner receiving
the prize automatically, minus the platform's commission. This is the production NestJS backend
powering it.

> **See `SECURITY_AUDIT.md`** for a full security audit of this codebase — 17 findings across SQL
> injection, XSS, CSRF, DDoS, auth, payments, wallet, API abuse, WebSockets, and race conditions,
> 13 fixed in-place with the specific file/line changes documented, 4 flagged as infrastructure
> recommendations that need an operational decision rather than a code change.

## Stack
Node.js · NestJS · TypeScript · PostgreSQL (Prisma) · Redis · Socket.IO · Stripe · AWS S3 · nestjs-pino

## Getting Started

```bash
cp .env.example .env        # fill in real secrets
npm install
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

Requires PostgreSQL and Redis running locally (or update `.env` to point at
managed instances). A `docker-compose.yml` for local Postgres/Redis is
recommended to add alongside this if you don't already have one running.

## Folder Structure

```
src/
├── main.ts                    # bootstrap: helmet, validation, raw-body webhook route, global filter
├── app.module.ts               # root module: config, logging, global rate limiting, feature modules
├── config/                     # typed env configuration
├── prisma/                     # PrismaService (DB) — global module
├── redis/                      # RedisService (cache, queues, active game state) — global module
├── common/
│   ├── decorators/              # @CurrentUser, @Roles
│   ├── guards/                  # JwtAuthGuard, RolesGuard
│   └── filters/                 # AllExceptionsFilter
├── auth/                         # full auth system — see "Authentication System" section below
│   ├── two-factor/                # TOTP setup/confirm/verify/disable + backup codes
│   ├── strategies/                 # jwt, jwt-refresh, google, discord (passport)
│   └── dto/
├── mail/                         # transactional email (verification, reset, new-device, lockout alerts)
├── users/                       # profile
├── wallet/                      # ledger, escrow hold/capture/settle — the money-critical module
├── game/
│   ├── engine/                   # ChessEngineService — server-authoritative move validation (chess.js)
│   ├── dto/
│   ├── game.gateway.ts            # WebSocket: moves, clocks, resign
│   └── game.service.ts            # active game state (Redis) + move persistence + settlement trigger
├── matchmaking/                  # Redis sorted-set queueing by rating band + entry-fee tier
├── payment/                      # Stripe deposit intents, webhook handling, withdrawal requests
├── upload/                       # KYC document upload straight to S3 (memory storage, no local disk)
└── notifications/                # notification persistence + dispatch stub
```

## Authentication System

All endpoints are under `/api/v1/auth`.

| Endpoint | Method | Notes |
|---|---|---|
| `/register` | POST | Creates user + wallet, sends verification email |
| `/verify-email` | POST | Consumes a one-time, hashed, 24h-expiring token |
| `/resend-verification` | POST | Rate-limited to 3/min; generic response either way (no enumeration) |
| `/login` | POST | Returns tokens directly, or `{requiresTwoFactor, twoFactorSessionToken}` if 2FA is on |
| `/2fa/login-verify` | POST | Exchanges the pending-session token + TOTP/backup code for real tokens |
| `/refresh` | POST | Guarded by `jwt-refresh` strategy; rotates the token on every use |
| `/logout` | POST | Revokes the one session tied to the presented refresh token |
| `/logout-all` | POST | Revokes every session for the user (e.g. "sign out everywhere") |
| `/forgot-password` | POST | Rate-limited to 3/min; generic response either way |
| `/reset-password` | POST | Consumes a one-time, hashed, 30min-expiring token; revokes all sessions |
| `/2fa/setup` | POST | Generates a TOTP secret + QR code (not yet persisted) |
| `/2fa/confirm` | POST | Verifies the first code, persists the secret, returns one-time backup codes |
| `/2fa/disable` | POST | Requires a valid current code to turn 2FA off |
| `/sessions` | GET | Lists this user's active devices/sessions |
| `/sessions/:id` | DELETE | Revokes one specific session (remote sign-out of a single device) |
| `/google`, `/google/callback` | GET | Passport Google OAuth2 flow |
| `/discord`, `/discord/callback` | GET | Passport Discord OAuth2 flow |

### How the pieces fit together

- **JWT + refresh tokens**: short-lived (15min) access token for API calls, long-lived (7 day)
  refresh token for silent renewal. Refresh tokens are stored only as argon2 hashes in `sessions`
  and **rotate on every use** — reusing an already-rotated token revokes every session for that
  user, since that pattern only happens if a token was stolen and both the attacker and the
  legitimate user tried to use it.

- **2FA (TOTP)** is a two-step enable flow (`/2fa/setup` → `/2fa/confirm`) so a secret is never
  persisted until the user proves they can actually generate valid codes with it. Login becomes
  two calls when 2FA is on: `/login` returns a 5-minute-lived `twoFactorSessionToken` instead of
  real tokens, and `/2fa/login-verify` exchanges that + a code for the actual token pair. Ten
  single-use backup codes (argon2-hashed) cover the lost-authenticator case.

- **Account lockout**: failed password attempts increment `users.failedLoginAttempts`; hitting
  the configured max (default 5) sets `lockedUntil` and emails the user. A successful password
  check — even before 2FA — resets the counter. Resetting your password also clears any lock,
  since proving mailbox ownership is a stronger signal than waiting out a timer.

- **Device tracking**: each session stores a fingerprint (hashed user-agent, extendable with a
  client-supplied signal) and a human-readable label. A login from a fingerprint never seen for
  that user fires a "new sign-in" email and is logged as a `device_new` security event — this is
  the same signal a real attacker's login would trigger, so the user finds out immediately.

- **OAuth (Google/Discord)**: both strategies resolve to the same `AuthService.loginOrRegisterOAuth`.
  First-time sign-in either links to an existing account matched by verified email (letting a user
  who registered with a password also sign in with Google later) or creates a new one — OAuth
  emails are trusted as pre-verified since the provider already confirmed them. Tokens are returned
  to the frontend via a URL **fragment** (`#access_token=...`), not a query string, so they never
  land in server access logs or get sent in a `Referer` header.

- **Enumeration resistance**: `/forgot-password`, `/resend-verification`, and login's invalid-
  credential path all return the same generic message/shape regardless of whether the email
  exists, so none of them can be used to confirm a target's registered email address.

## Wallet System

All endpoints are under `/api/v1/wallet` (player) and `/api/v1/admin/wallet` (finance_admin/super_admin only).

| Endpoint | Method | Notes |
|---|---|---|
| `/wallet/balance` | GET | Returns `available`, `locked`, `pending`, and `total` |
| `/wallet/transactions` | GET | Cursor-paginated ledger history |
| `/wallet/withdraw/request` | POST | Requires verified KYC; immediately holds funds pending admin review |
| `/wallet/refund/request` | POST | Player requests a refund against a specific past transaction |
| `/admin/wallet/withdrawals/pending` | GET | Review queue |
| `/admin/wallet/withdrawals/:id/review` | POST | Approve (captures the hold) or reject (reverses it) |
| `/admin/wallet/refunds/pending` | GET | Review queue |
| `/admin/wallet/refunds/:id/review` | POST | Approve credits the user; reject just closes the request |
| `/admin/wallet/fraud-signals` | GET | Open fraud signals for manual review |
| `/admin/wallet/reconciliation/drifts` | GET | Any wallets where the ledger and cached balance disagree |

### Balance model: three numbers, not one

- **`available_balance`** — spendable right now (deposits, won prizes, refunds).
- **`locked_balance`** — held as match escrow while a game is in progress. Moves back to
  `available` on settlement (winner gets prize, both entry fees captured) or on a draw (both
  entry fees released back).
- **`pending_balance`** — held during withdrawal review. Separate from `locked` because it has a
  different lifecycle and a different owner (admin approval, not game outcome) — conflating the
  two would make it impossible to tell "money tied up in a match" from "money about to leave the
  platform" at a glance.

### Commission Deduction
`WalletService.settleMatch` clamps `commissionPercent` to a hard `MAX_COMMISSION_PERCENT = 15`
**in code**, independent of whatever value is passed in — the same defense-in-depth pattern as
the database `CHECK` constraint on `commission_configs`. Prize = `(entryFee × 2) − commission`,
credited to the winner in the same serializable transaction that captures both entry-fee holds.

### Refunds
A `refunds` table (separate from the generic `refund` wallet-transaction type) gives refunds an
explicit approval trail: who requested it, why, who approved it, and when. Approving a refund and
crediting the wallet happen in the same transaction as marking the refund `completed` — there's no
window where the refund shows approved but the money hasn't actually moved.

### Payment Verification
Stripe webhook signature verification (proves the event came from Stripe) is only step one.
`PaymentService.handleDepositWebhookSucceeded` additionally checks the **content** of the event —
amount and currency — against what the deposit record actually expects before crediting anything.
A mismatch doesn't get silently accepted; it marks the deposit `failed` and logs a fraud signal,
since a mismatched amount on an otherwise-valid signature is exactly what a replayed or tampered
request looks like.

### Anti-Fraud
`FraudService` runs Redis-backed velocity checks (deposit count/hour, withdrawal count/day),
detects the deposit-then-immediate-withdraw pattern common to card testing and layering, and
tracks how many distinct accounts have deposited from the same IP. Almost everything **flags**
into `fraud_signals` for human review rather than auto-blocking — the one exception is a
withdrawal from a user with a confirmed chargeback on file, which auto-blocks, since that's a
platform that has already been defrauded once by this account.

### Accounting Logs
`AccountingService` runs a nightly job (`@Cron` at 3am) that re-derives each wallet's "true"
balance by summing its `wallet_transactions` and diffs it against the cached `available_balance`.
Anything beyond a one-cent rounding tolerance is written to `accounting_reconciliation_logs` as
`drift_detected` and surfaced in the admin queue — this is how a ledger bug gets caught same-day
instead of during a year-end audit.

## Chess Game System

Real-time gameplay is served over Socket.IO under the `/game` namespace, backed by chess.js for
move legality and a WASM Stockfish for post-game analysis only.

### Time Controls
Four categories — Bullet, Blitz, Rapid, Classical — defined in `game/config/time-controls.ts` and
categorized the way Lichess/Chess.com do: `estimatedMinutes = base + 40 × increment`. Fischer
increment is credited to the mover's own clock immediately after a legal move is confirmed
server-side; the client's own clock display is cosmetic only.

### WebSocket Events (`/game` namespace)

| Client → Server | Server → Client | Notes |
|---|---|---|
| `joinGame {gameId}` | `gameState` or `waitingForOpponent` | Also the reconnect path — cancels any pending forfeit timer |
| `spectateGame {gameId}` | `gameState` | Joins the room read-only; move attempts are rejected |
| `move {gameId, san}` | `moveApplied`, `moveRejected` | Server-authoritative; illegal moves are rejected without mutating state |
| `offerDraw {gameId}` | `drawOffered` | |
| `respondDraw {gameId, accept}` | `drawDeclined` or `gameOver` | Any move implicitly declines a pending offer |
| `resign {gameId}` | `gameOver` | |
| — | `opponentDisconnected` / `opponentReconnected` | Fired automatically around the grace-period window |
| — | `gameOver {reason}` | `checkmate` \| `stalemate` \| `draw_rule` \| `draw_agreement` \| `resignation` \| `timeout` \| `abandonment` |

### Move Validation & Illegal Move Detection
`ChessEngineService` wraps chess.js as the **only** authority on legality — the client's own
chess.js instance is UX sugar for instant feedback and is never trusted. An illegal move is
rejected with `moveRejected` and never touches Redis state or the DB.

### Draws, Resign, Timeout
- **Draw**: offer/accept/decline flow, plus automatic draw detection (chess.js covers
  stalemate, threefold repetition, the 50-move rule, and insufficient material).
- **Resign**: immediate loss for the resigning player.
- **Timeout**: server-computed from its own `lastMoveAt` timestamp, never the client's reported
  time. Correctly implements the FIDE exception — flagging while your opponent has no mating
  material is a **draw**, not a loss, checked via `hasInsufficientMatingMaterial`.

### Reconnect
Each active game's players are tracked server-side; on disconnect, a grace timer starts sized to
the game's time category (15s bullet / 30s blitz / 60s rapid / 120s classical — you can't
reasonably give a bullet player two minutes of grace). Reconnecting within the window cancels the
timer and replays a full state snapshot; missing the window triggers `forfeitOnDisconnect`, which
settles the game exactly like a resignation. **Note**: the timer map is in-memory per gateway
instance — fine for a single instance, but at multi-instance scale this needs to move to a
Redis-backed delayed job so a forfeit fires regardless of which instance the socket reconnects to.

### Spectator Mode
`spectateGame` joins the same Socket.IO room as the players (read-only) and receives the same
`moveApplied`/`gameOver` broadcasts — a spectator's `move` attempts are rejected server-side before
even reaching the engine.

### Game Replay & PGN Export
`GET /games/:id/replay` returns every move with its resulting FEN, so a client can step through
the game position-by-position. `GET /games/:id/pgn` builds a standards-compliant PGN (seven-tag
roster + movetext) from the same `game_moves` rows and returns it as a downloadable file — openable
in any chess software.

### Stockfish — Where It Is and Isn't Used
**Never in the live move path.** `StockfishService` wraps a WASM Stockfish build and is used only
for (1) post-game anti-cheat analysis and (2) an optional post-game analysis board. Giving a
player engine access during their own game is exactly the failure mode the platform's anti-cheat
exists to catch — so the service is wired into `AnticheatService` only, triggered fire-and-forget
after a real-money game completes (never awaited by the settlement path).

`AnticheatService` replays the game through chess.js, evaluates the position before each move at
depth 14, and compares the played move's resulting evaluation against Stockfish's own best move —
both compared directly in UCI notation (`chess.js`'s move object gives exact `from`/`to`/`promotion`,
no fuzzy matching needed). Two numbers come out per player per game: average centipawn loss and
top-engine-move match rate. Games with both a very low average loss and a very high match rate are
written to `anticheat_reports` as `flagged`, but **nothing auto-punishes** — every report (flagged
or not) is kept for a human reviewer, since sustained numbers across *many* games is the real
signal, not one strong game.

## Matchmaking System

Real-time queueing over Socket.IO under the `/matchmaking` namespace. Rooms are the pairing unit —
players are **only** ever matched against someone in the exact same room.

### Two Game Modes, One Underlying Mechanism

**Free Play** and **Real Money Matches** are presented as two completely separate, clearly labeled
options in the player-facing app (`/lobby` is now a mode-selection screen — see the frontend
README) — but underneath, both are the exact same matchmaking engine, distinguished by nothing more
than entry fee. This is deliberate: rather than building and maintaining two parallel matchmaking
systems, the existing room design already makes the separation absolute.

### Entry Fee Tiers
`$0, $5, $10, $25, $50, $100` (`matchmaking/config/entry-fees.ts`) — not user-configurable, not
derived from anything else. A room is `(timeControlId, entryFee)` together, so a $10 Blitz queue and
a $25 Blitz queue never mix, and neither do a $10 Blitz queue and a $10 Rapid queue — **which is
exactly why a $0 (Free Play) queue can never mix with any paid queue either**: it's the identical
mechanism that already keeps every other tier separate, just applied to one more value. No
additional matchmaking logic was needed to guarantee free and paid players are never matched
together.

Every entry fee above $0 requires verified KYC (`requiresKyc()`) — this used to only apply at
$50+, but the platform's compliance policy now requires identity verification before any
real-money match, not just the highest stakes. $0 requires no verification, no minimum age, and no
platform-rules acceptance — see `compliance/` for what free play deliberately bypasses and why.

Free vs. paid is derived everywhere from `entryFee` (`0` vs `> 0`) — deliberately not a separate
stored column. Player stats (`social/profile/player-profile.controller.ts`), admin game filters
(`admin/games/`), and the admin dashboard's active-games breakdown
(`admin/dashboard/admin-dashboard.service.ts`) all compute the split this way, so there's exactly
one source of truth for "is this game free or paid" and nothing that can drift out of sync with it.

### WebSocket Events (`/matchmaking` namespace)

| Client → Server | Server → Client | Notes |
|---|---|---|
| `joinQueue {timeControlId, entryFee}` | `matchFound {gameId, opponentId}` or `queued {room}` | Validates eligibility, balance, and rate limit before enqueueing — entryFee=0 skips balance/KYC/age/rules checks entirely |
| `cancelQueue` | `queueCancelled {wasQueued}` | |
| `heartbeat` | — | Client should ping every few seconds while queued; keeps the presence key alive |
| — | `queueTimeout {room}` | Fired when the server-side max-wait timer expires |

### Waiting Queue
Redis sorted sets (`matchmaking:queue:{room}`, score = rating) per room, with the same
wait-time rating-band widening used elsewhere (`100 → 600` Elo over time). `tryMatch` walks
candidates closest-in-rating-first and skips — never dequeues — anyone who fails a presence,
balance, or integrity check, so a stale or blocked candidate doesn't get kicked out from under
them; they just keep waiting for their own timeout or a different match.

### Timeout
A server-side timer per queued user, scaled by category (45s bullet / 60s blitz / 90s rapid /
120s classical — the same reasoning as the in-game disconnect grace periods, just inverted: a
bullet player expects a match in seconds, so a long wait means something's wrong). On expiry the
user is dequeued and told via `queueTimeout`.

### Cancellation
Explicit `cancelQueue` event — clears the Redis queue entry, the presence key, and the pending
timeout timer in one call.

### Reconnect
A disconnect while queued doesn't immediately drop the queue spot — a 20-second grace timer
starts, and if the socket reconnects within that window (same user, any device), the grace timer
is cancelled and `queued {resumed: true}` is replayed so the client can restore its "searching..."
UI without losing its place. Only a disconnect that outlasts the grace period actually removes the
entry.

### Cancellation vs. Fake Accounts vs. Duplicate Sessions — how they interact
- **Duplicate sessions**: `matchmaking:active:{userId}` is a hard single-entry lock — a second
  `joinQueue` call while one is already active is rejected with a clear "cancel that first"
  error, not silently ignored or double-queued.
- **Fake accounts / collusion**: `MatchIntegrityService` runs at match-*finalization* time, right
  before a game row is created — cheap relative to a game actually starting:
  - **Linked-account detection**: compares each candidate pair's recent session IPs and device
    fingerprints for overlap. A match is never finalized between two accounts that look like the
    same person.
  - **Frequency/collusion detection**: more than 3 completed games between the same two accounts
    in a 7-day window blocks further pairing between them specifically (not a platform-wide ban)
    — and if that head-to-head history is lopsided (≥80% one-sided), it's logged as
    `collusion_suspected` rather than just `excessive_pairing_frequency`, since a consistent loser
    is the actual signature of intentional fund transfer via entry fees.
  - Every block writes a `fraud_signals` row for both accounts, for the same admin review queue
    the wallet system's fraud detection already feeds.

### What's Still Simplified — Matchmaking
- **Rating updates**: `ratings` defaults every player to 1200 and never updates post-game — an
  Elo/Glicko-2 update step wired into `GameService.finishGame` is the natural next addition;
  matchmaking itself doesn't need it to function, just to get *better* over time.
- **Multi-instance timers**: like the game gateway's disconnect grace timers, the queue-timeout
  and disconnect-grace timers here are in-memory `Map`s per gateway instance — correct for a
  single instance, and flagged the same way as the earlier reconnect logic for when you scale out.

## Admin Dashboard Backend

Every admin endpoint sits under `/admin/*`, gated by `RolesGuard` with the same three-tier RBAC
used throughout: `support_agent` (read + support actions), `finance_admin` (+ money/moderation
actions), `super_admin` (+ system logs). A `player` token — even a stolen one — hits a 403 on
every single route here; role is re-checked server-side on every request, never trusted from a
UI's nav visibility.

| Area | Endpoints | Notes |
|---|---|---|
| **Manage / Ban / Suspend Users** | `admin/users*` | Ban and suspend both immediately revoke every active session (`sessions.isRevoked = true`) — no grace period, unlike a password reset. A `super_admin` account can't be banned/suspended through this endpoint at all, closing off a privilege-escalation-then-lockout attack path. |
| **Wallet Monitoring** | `admin/wallet/withdrawals*`, `/refunds*`, `/reconciliation/drifts` | Reuses everything built in the wallet system — this dashboard is a UI on top of infrastructure that already existed, not a parallel system. |
| **Game Monitoring** | `admin/games/live`, `/flagged`, `/anticheat/:id/review` | `flagged` is the direct feed from `AnticheatService` — every unreviewed flagged report, joined with the game and both players. |
| **Financial Reports / Revenue / Commission Reports** | `admin/reports/revenue`, `/revenue/series`, `/commission/by-tier`, `/deposits-withdrawals` | Revenue is derived entirely from `games.commissionAmount` on completed real-money games — no separate ledger to keep in sync; the same source of truth the wallet settlement itself writes to. |
| **Support Tickets** | `support/tickets*` (user-facing, new this round) + `admin/support/tickets*` (admin) | A user reply on a `resolved` ticket automatically reopens it — a ticket doesn't silently stay "resolved" if the issue wasn't actually fixed. |
| **Fraud Detection** | `admin/wallet/fraud-signals` | Feeds from the same `fraud_signals` table the wallet anti-fraud checks and the matchmaking integrity checks both already write to — one review queue for every fraud source on the platform, not three separate ones. |
| **System Logs** | `admin/dashboard/logs/admin`, `/logs/security` | `super_admin` only. `admin_logs` is written by the new shared `AdminAuditService` (`admin/audit/`) — every admin controller calls the same one, so there's exactly one code path that produces audit entries, not one per controller. |
| **Dashboard Analytics** | `admin/dashboard/overview` | Nine parallel aggregate queries (`Promise.all`) — total users, new today, live games, revenue today, platform funds by bucket, and every pending-review queue depth in one call, built for a dashboard's opening paint. |

### A bug this round caught (and fixed)

Building the admin logs viewer surfaced that `AuthService`'s security-event logging and the
original `AdminWalletController`'s audit logging were both writing via raw SQL that assumed a
`security_event_type` **Postgres enum** existed — it never did; only a plain `VARCHAR` migration
was ever written for that table. Under the old code, every login/logout/2FA event would have
silently failed to log (caught by a `.catch(() => undefined)` that was there specifically so a
logging failure could never break auth — which is correct behavior, but it also means the bug
would never have surfaced as an error, just as permanently empty security logs). Fixed by
switching both call sites to proper Prisma calls (`securityLog.create` / the new shared
`AdminAuditService`) against models that now actually exist in the schema.

### New this round: centralized audit logging

`AdminAuditService` (`admin/audit/`, globally available like `PrismaService`) is now the single
place every admin action gets written to `admin_logs` — bans, suspensions, withdrawal/refund
decisions, ticket actions. Previously `AdminWalletController` had its own private raw-SQL logger;
that's gone now in favor of one shared, typed service every admin controller calls the same way.

## Frontend: Admin Dashboard

A separate React + TypeScript + Vite project (not part of this repo) implements the operator UI
for everything above — user management, wallet/game monitoring, financial reports with charts,
support ticket threads, fraud review, and system logs, with the same three-tier role gating
mirrored in the UI. See its own README for the design system and setup.

## Performance, Scalability & Deployment

### Database
- Added indexes for every query pattern that was actually missing one — `games` had none beyond
  its primary key, `deposits`/`withdrawals` had zero indexes at all beyond unique constraints
  before this pass (see `prisma/migrations/0006_performance_indexes`). Composite indexes match
  real `WHERE`/`ORDER BY` combinations (e.g. `wallet_transactions(wallet_id, created_at DESC)` —
  every transaction-history read is exactly that shape) rather than one index per column.
- `AdminReportsService.getCommissionByTier`/`getRevenueTimeSeries` used to pull every matching
  `games` row into Node and sum in a JS `Map` — replaced with Prisma's `groupBy` and a parameterized
  `$queryRaw` (for the date-truncation `getRevenueTimeSeries` needs, which `groupBy` can't express)
  respectively, so Postgres does the aggregation instead of the application.
- `DATABASE_URL`'s `connection_limit`/`pool_timeout` are now documented in `.env.example` — Prisma
  reads pool sizing from the URL itself, and it was previously unset (silently defaulting to a
  per-instance formula that's wrong the moment you run more than one replica).

### Caching (Redis)
- New `CacheService` (`redis/cache.service.ts`) — a cache-aside helper with stampede protection
  (concurrent cache-miss requests for the same key share one in-flight computation instead of each
  triggering their own).
- Applied to the two hottest read paths: the leaderboard (30s TTL) and the admin dashboard overview
  (15s TTL, shorter than the frontend's own 30s poll interval so no viewer perceives staleness).

### Compression
- `compression` middleware in `main.ts` — gzip/brotli negotiated per client, skipping the Stripe
  webhook route (compressing a body only ever read once buys nothing) and payloads under 1KB.

### WebSocket Performance & Scalability
- **Socket.IO Redis adapter** (`common/ws/redis-io.adapter.ts`) — the single biggest scalability
  change in this pass. Without it, `server.to(gameId).emit(...)` only reaches sockets connected to
  the *same process*; two players in one game landing on different instances behind a load
  balancer would never see each other's moves. Now wired in `main.ts` before the app starts
  listening.
- Per-event rate limiting (`common/ws/ws-rate-limiter.ts`) — see `SECURITY_AUDIT.md` §4.1/§9.2 for
  the full writeup; it's a performance fix as much as a security one, since `move` writes to
  Postgres on every call.
- `maxHttpBufferSize` capped on both gateways (8KB game, 4KB matchmaking) — down from Socket.IO's
  1MB default, which was never going to be approached by a real chess move payload.
- **What's still per-instance** (and the concrete next step): disconnect-grace timers, queue-
  timeout timers, and the rate limiter's token buckets are all in-memory `Map`s today — correct on
  one instance, and explicitly flagged (here and in `finger-chess-infra/README.md`) as needing a
  Redis-backed version before they're fully consistent across a horizontally-scaled deployment.

### Frontend: Code Splitting & Lazy Loading
- Both frontends: route-level or dynamic-import code splitting for the heaviest dependencies —
  Stripe Elements is now dynamically imported behind the deposit dialog (`next/dynamic`,
  `ssr: false`) instead of shipping with the wallet page's initial JS; the admin dashboard's five
  non-landing pages are `React.lazy`-loaded per route instead of bundled into one chunk.
- Removed an entirely unused `recharts` dependency from the player-facing frontend — it was listed
  in `package.json` and never actually imported anywhere, just dead weight in the bundle.
- Vite's build now splits vendor code (`react`, `react-router-dom`, `recharts`) into its own
  long-term-cacheable chunk, separate from app code that changes on every deploy.
- Next.js: `output: 'standalone'` + explicit image optimization config (`next.config.js`) — the
  former is what makes the Docker image lean (see below), the latter is ready for the first
  avatar/KYC-preview image feature without someone having to remember to configure it retroactively.

### Docker
Multi-stage, non-root, health-checked Dockerfiles for all three projects:
- **Backend**: 4-stage build (`deps` → `build` → `prod-deps` → `runtime`) — dev dependencies
  (TypeScript, `@nestjs/cli`, Jest) never reach the final image, which runs as an unprivileged user.
- **Player frontend**: built around Next's `standalone` output — the runtime image excludes the
  full `node_modules` tree entirely.
- **Admin frontend**: static Vite build served by `nginx:alpine` — no Node runtime at all in the
  final image, plus gzip and immutable long-term caching for hashed asset filenames configured in
  `nginx.conf`.
- New `GET /health` (liveness — process alive, no dependency checks) and `GET /health/ready`
  (readiness — verifies DB + Redis connectivity) endpoints, excluded from the `api/v1` prefix so
  they stay stable across API versions. Used by every Dockerfile's `HEALTHCHECK` and every
  Kubernetes probe.

### Kubernetes & CI/CD
See `../finger-chess-infra/` for the full Kubernetes manifests (Deployment/Service/HPA/Ingress
for all three apps, with WebSocket-aware Ingress annotations and the reasoning for keeping
Postgres/Redis as managed services rather than self-hosted StatefulSets) and `.github/workflows/`
in each project for the lint → build → Docker push → rollout CI/CD pipeline.

## Key Architectural Decisions

1. **The Wallet Service is the only thing that can move money.** The Game
   Service emits results and calls `WalletService.settleMatch()` — it never
   writes to `wallets` or `wallet_transactions` directly. This boundary is
   what makes a game-logic bug incapable of corrupting a balance.

2. **Every money-moving operation has an idempotency key** and runs inside a
   `Serializable` Prisma transaction. Retries (network blips, webhook
   redelivery, double-clicks) can never double-credit or double-debit.

3. **Refresh tokens rotate on every use** (`AuthService.refreshTokens`) and
   are stored only as argon2 hashes, never in plaintext. Reuse of an already-
   rotated token revokes every session for that user — a strong signal of
   token theft.

4. **The server is the only chess authority.** `ChessEngineService` runs
   entirely server-side against a FEN string; the client's own move
   validation is UX sugar only and is never trusted to decide legality, win
   conditions, or clock state.

5. **Rate limiting is layered**: a global default (100 req/60s) from
   `ThrottlerModule`, with much stricter overrides on `/auth/login` and
   `/auth/register` specifically, since those are the highest-value targets
   for credential-stuffing and mass-registration abuse.

6. **Commission is capped at the database and service layer, not just the
   admin UI** — `WalletService.settleMatch` clamps to 15% regardless of what
   value is passed in, and the `commission_configs` table itself has a CHECK
   constraint enforcing the same cap.

## What's Actually Still Simplified Today

This section previously listed email verification dispatch, the draw-outcome refund path,
`resolvePlayerColor`, and the entire admin module as unbuilt stubs. All four were fully implemented
many development rounds ago — that version of this section was stale and actively wrong, not
current documentation, and has been replaced rather than trusted. Verified against the real source
before writing this:

- **Ratings never update post-game** — every player defaults to 1200 and stays there; an Elo/Glicko-2
  update step in `GameService.finishGame` is the natural next addition (see "What's Still
  Simplified — Matchmaking" above, where this was first flagged and remains true).
- **Multi-instance in-memory timers** — the game gateway's disconnect-grace timers, the
  matchmaking gateway's queue-timeout/disconnect-grace timers, and the WebSocket rate limiter's
  token buckets are all in-memory `Map`s per process. Correct on one instance; a Redis-backed
  version is the documented next step for running more than one backend replica. Flagged
  consistently everywhere it applies rather than only once.
- **The profanity filter's word list is a placeholder seed** (`social/moderation/moderation.service.ts`)
  — the filtering *logic* is real and wired in; the specific word list is a small illustrative set,
  not a production-grade, maintained, per-locale list from an actual moderation API.

Everything else this file, `SECURITY_AUDIT.md`, `LEAD_ENGINEER_REVIEW.md`, `SOCIAL_SYSTEM.md`,
`WALLET_UPGRADE.md`, and `VERIFICATION_UPGRADE.md` describe as built — auth, wallet, matchmaking,
the chess engine, the full social system, KYC/compliance, the admin dashboard, free play vs.
real-money mode — is real, wired, and verified against the actual source, not aspirational.
