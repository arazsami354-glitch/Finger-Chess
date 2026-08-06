# Security Audit Report — Finger Chess

**Scope:** Backend (NestJS/Prisma/PostgreSQL/Redis), Admin Dashboard (React/Vite), Player Frontend
(Next.js). **Method:** Manual code review of every module across auth, wallet, matchmaking, game
engine, WebSocket gateways, and both frontends — not an automated scan. Every finding below was
verified against the actual code, not inferred from a generic checklist.

**Summary:** 17 findings. 13 fixed in this pass (code changes included in the updated project
zips). 4 are architecture/infrastructure recommendations that need an operational decision (WAF
placement, secrets management, etc.) rather than an application code change — marked accordingly.

---

## 1. SQL Injection

**Verified: no SQL injection surface exists in the current codebase.**

Every database access goes through Prisma's parameterized query builder. I swept the full
codebase for the two ways this could still go wrong:

- `$queryRawUnsafe` / `$executeRawUnsafe` (string-interpolated raw SQL): **zero occurrences.**
  Two call sites *used* to exist — `AuthService.logSecurityEvent` and the original
  `AdminWalletController`'s audit logger — both used parameterized raw SQL (safe from injection
  even so), but both have since been replaced with typed Prisma calls (`securityLog.create`,
  `AdminAuditService.log`) as part of building out the admin dashboard. Confirmed via `grep -rn
  "executeRawUnsafe\|queryRawUnsafe" src/` → no matches.
- Dynamic `where` clause construction (e.g. `AdminUsersService.list`, `AdminGamesService.list`):
  builds a plain JS object passed to Prisma's query builder, never a string. `mode: 'insensitive'`
  search is still fully parameterized. Safe by construction, not by care taken.

**Status: no action needed — verified clean.**

---

## 2. XSS (Cross-Site Scripting)

| # | Finding | Severity | Status |
|---|---|---|---|
| 2.1 | HTML injection via `X-Device-Label` header into transactional emails | **High** | ✅ Fixed |
| 2.2 | React/JSX rendering | — | Verified clean |

### 2.1 — Email HTML injection via client-controlled device label

**Location:** `mail/mail.service.ts`, fed from `auth/auth.controller.ts`'s `requestMeta()`.

`sendNewDeviceAlert` interpolated `deviceLabel` — read directly from the client-supplied
`X-Device-Label` request header — into an HTML email body with no escaping. A client could set
that header to `<img src=x onerror="...">` or a block of HTML styled to impersonate a legitimate
part of the email (fake "your account was compromised, click here" phishing content, delivered
*from the platform's own transactional mail sender*, which recipients trust more than a spoofed
sender would get). This isn't reflected in a browser (so not "XSS" in the classic sense) but it's
the same root cause — unescaped user input reaching a rendering context (the recipient's email
client) — and the same severity, since it weaponizes the platform's own trusted sending domain.

**Fix applied:**
- Added `MailService.escapeHtml()` — escapes `& < > " '`, applied to every interpolated value in
  every template (`deviceLabel`, `ipAddress`, timestamps).
- Also capped `deviceLabel` to 100 characters at the point it's read in `auth.controller.ts`
  (defense in depth — an oversized header shouldn't reach the database's `sessions.device_label`
  column or logs either, independent of the email-rendering fix).

### 2.2 — Verified clean: JSX rendering, no `dangerouslySetInnerHTML`

Swept both frontends (`grep -rn "dangerouslySetInnerHTML"`) — zero occurrences. Every dynamic
value in both UIs (fraud signal `details` JSON, ticket messages, user-supplied names) is rendered
through JSX's default escaping. The one place raw JSON is shown (`FraudPage`'s
`JSON.stringify(s.details)`) renders as an escaped text node, not HTML — safe.

---

## 3. CSRF (Cross-Site Request Forgery)

**Verified: structurally not vulnerable, by design — no cookie-based auth exists anywhere in
the stack.**

CSRF works by a browser *automatically* attaching a session cookie to a cross-site request the
victim didn't intend to make. This platform's entire auth model is bearer-token (`Authorization:
Bearer <JWT>`), issued at login and attached manually by the frontend's `axios` interceptor.
There's no cookie a malicious page could ride on: to forge a request, an attacker's page would
need to read the token out of the victim's `localStorage` first, which requires script execution
in the app's own origin — i.e. it degrades to an XSS problem, not a CSRF one, and Section 2 above
covers the one XSS-adjacent finding that existed.

Confirmed via `grep -rn "cookie" src/ -i` on the backend → zero occurrences of cookie-based
session handling.

**One related, explicitly-flagged tradeoff (not a new finding, restated here for completeness):**
both frontend READMEs already document that `localStorage` token storage is an XSS-amplification
risk *if* an XSS vulnerability existed elsewhere — a stolen token is usable until it expires or is
revoked. httpOnly cookies would remove that specific risk but reopen CSRF, trading one class of
bug for another; the mitigation either way is "don't have an XSS bug," which Section 2 addresses
directly. Noted as an accepted architectural tradeoff, not left silent.

---

## 4. DDoS / Denial of Service

| # | Finding | Severity | Status |
|---|---|---|---|
| 4.1 | WebSocket events completely unthrottled | **High** | ✅ Fixed |
| 4.2 | No `trust proxy` config — every IP-based control was silently broken behind a reverse proxy | **High** | ✅ Fixed |
| 4.3 | No explicit request body size limit | **Medium** | ✅ Fixed |
| 4.4 | Stripe webhook inherits the global per-IP throttle | **Low** | ✅ Fixed |
| 4.5 | No WAF / L3-L4 DDoS protection at the edge | **Medium** | ⚠️ Recommendation (infra) |

### 4.1 — WebSocket events were completely unthrottled

**Location:** `game/game.gateway.ts`, `matchmaking/matchmaking.gateway.ts`.

`ThrottlerModule` (the global rate limiter) only instruments Nest's HTTP pipeline. Every
`@SubscribeMessage` handler — `move`, `offerDraw`, `resign`, `joinQueue`, `heartbeat` — was
reachable at whatever rate a socket could emit, with zero rate limiting. `move` in particular
writes a `GameMove` row to Postgres on every call; an unthrottled flood from even one connection is
a direct database-load DoS vector, not just wasted CPU on rejected requests.

**Fix applied:** new `common/ws/ws-rate-limiter.ts` — a small in-memory token-bucket limiter,
applied per-`userId` (not per-socket, so reconnecting doesn't reset the budget):
- `move`: 10/second sustained — generous enough for legitimate bullet-chess pre-moves, tight
  enough that a flood is unmistakable.
- `offerDraw` / `resign`: 5 per 5 seconds.
- `joinQueue` (socket layer): 5 per 10 seconds — on top of, not instead of,
  `MatchmakingService`'s existing 10/minute account-level limit; this one guards the Redis
  round-trip cost of the socket layer itself, before that service-level check even runs.
- `heartbeat`: capped to roughly match the expected 5-second client interval; over-budget calls
  are silently dropped rather than erroring back, since a flooding client doesn't deserve a
  response either way.

Also added `maxHttpBufferSize` caps (8KB game namespace, 4KB matchmaking namespace) — Socket.IO's
default is 1MB per message, wildly oversized for a chess move payload and itself a minor
amplification vector.

**Known limitation, stated honestly:** these limiters are in-memory per gateway instance — correct
for a single-instance deployment, and explicitly called out (matching the same caveat already
present for the disconnect-grace-period timers) as needing a Redis-backed version before running
multiple backend instances, or a flooding client could reset its budget by landing on a different
instance.

### 4.2 — Missing `trust proxy` broke every IP-based control behind a reverse proxy

**Location:** `main.ts`.

Nothing set Express's `trust proxy` setting. In any real deployment (behind nginx, an ALB,
Cloudflare, etc.), `req.ip` without this setting resolves to the *proxy's* IP for every single
request, not the actual client's. This silently breaks:
- The global `ThrottlerModule` rate limiter (every user shares one IP bucket — the proxy's).
- `FraudService`'s IP-based multi-account detection (`trackIpUserAssociation`) — completely
  inert, since every user looks like the same IP.
- Every `security_logs` and `fraud_signals` row that records an IP — all identical, useless for
  investigation.

This is the kind of gap that doesn't show up in local development (no proxy in front of `next
dev`/`nest start`) and would only surface in production, quietly, as every IP-based defense in this
codebase doing nothing.

**Fix applied:** `app.getHttpAdapter().getInstance().set('trust proxy',
Number(process.env.TRUST_PROXY_HOPS ?? 1))`. Set to the actual number of trusted proxy hops in
front of the service — `1` for a single reverse proxy/load balancer, more if there's a CDN in
front of that. Explicitly **not** set to `true` (which trusts an `X-Forwarded-For` header
verbatim from anyone, letting a client spoof its own apparent IP by just setting the header
directly against an origin that has no real proxy in front of it) — the exact hop count needs to
match real infrastructure.

### 4.3 — No explicit request body size limit

**Location:** `main.ts`.

NestJS's default body parser has a reasonable built-in limit, but it wasn't explicit anywhere in
the codebase — meaning it was one dependency upgrade away from silently changing. Added an
explicit `express.json({ limit: '256kb' })` / `express.urlencoded({ limit: '256kb' })` — small
enough that no legitimate payload in this API (DTOs, chess moves, JSON bodies) comes close, tight
enough to bound memory use from a flood of oversized bodies before validation even runs. File
uploads are unaffected (they go through multer's own 8MB limit in `upload.controller.ts`, already
correctly configured).

### 4.4 — Stripe webhook inherited the global per-IP throttle

**Location:** `payment/payment.controller.ts`.

Stripe sends webhook events from a shared pool of egress IPs across all of Stripe's customers. The
global 100-req/60s throttle applying to that route means a burst of legitimate events (e.g. a
platform-wide payment settlement batch) shares its rate budget with unrelated traffic from other
Stripe customers hitting the same egress IPs — a false-positive throttling risk on exactly the
endpoint that must never silently drop a real event. Signature verification (already correctly
implemented) is the actual security control for this route, not request rate.

**Fix applied:** `@SkipThrottle()` on the webhook handler specifically — every other route keeps
its throttle.

### 4.5 — No WAF / edge-layer DDoS protection

**Recommendation, not a code fix** — this needs an infrastructure decision, not an application
change: put Cloudflare, AWS Shield, or equivalent in front of production. Everything above raises
the cost of application-layer abuse; it does nothing against a volumetric L3/L4 flood, which has to
be stopped before it reaches this process at all.

---

## 5. Authentication

| # | Finding | Severity | Status |
|---|---|---|---|
| 5.1 | 2FA setup trusted a client-supplied secret | **Critical** | ✅ Fixed |
| 5.2 | Banned/suspended accounts kept working for up to 15 minutes | **High** | ✅ Fixed |
| 5.3 | Account lockout / refresh rotation / password hashing | — | Verified sound |

### 5.1 — 2FA setup trusted a client-supplied secret (persistence backdoor)

**Location:** `auth/two-factor/two-factor.service.ts`.

This is the most serious finding in this audit. `POST /auth/2fa/setup` generated a TOTP secret and
returned it **to the client**, expecting `POST /auth/2fa/confirm` to receive that same secret back
in the request body to activate it. Nothing tied the confirmed secret to the one the server had
actually generated for that setup session — the endpoint accepted *whatever secret the caller
sent*, as long as the accompanying code validated against it.

**Why this is critical:** anyone holding a valid access token for an account — including an
attacker who briefly compromised a session (a shared/public computer, a leaked token, a narrow
XSS window before it's found and fixed) — could call `/2fa/confirm` with a secret **they
generated themselves**, for which they already know how to produce valid codes indefinitely. This
silently enables 2FA on the victim's account using an attacker-chosen secret, planting persistent,
attacker-controlled access that survives a password change (2FA isn't reset by
`AuthService.resetPassword`) and looks, from the account owner's side, like they simply have 2FA
turned on. The real user would need to know to disable and re-enable 2FA correctly to notice
anything was wrong — most wouldn't.

**Fix applied:** the secret now lives server-side only, in Redis, keyed by `userId`, with a
10-minute TTL (`2fa:pending_setup:{userId}`). `/2fa/setup` returns only the QR code image; the raw
secret is never sent to the client at all. `/2fa/confirm` reads the secret back from Redis, not
from the request body — the `secret` field was removed from `ConfirmTwoFactorDto` entirely, so
sending one now fails the global `forbidNonWhitelisted` validation. This means the *only* secret
`/2fa/confirm` can ever act on is the one the server itself generated for that user in the last 10
minutes — an attacker can no longer choose it.

*(Both frontends were updated to match — the Settings page no longer holds or resubmits a secret.)*

### 5.2 — Banned/suspended accounts stayed authenticated for up to 15 minutes

**Location:** `auth/strategies/jwt.strategy.ts`, `admin/users/admin-users.service.ts`.

`AdminUsersService.ban`/`suspend` correctly revoked every row in the `sessions` table — but that
only affects *refresh* tokens. Access tokens are stateless JWTs, verified by signature alone, valid
for their full 15-minute lifetime regardless of what happens to the account afterward. A banned
user's already-issued access token kept working, unmodified, until it naturally expired — meaning
"ban" wasn't actually immediate for up to 15 minutes, which matters a great deal for e.g. a
confirmed-cheating or fraud-signal-triggered ban where every additional minute of access is a
minute the platform explicitly decided the account shouldn't have.

**Fix applied:** `JwtStrategy.validate()` now checks a lightweight Redis flag
(`user:revoked:{userId}`) on every single authenticated request — one cheap `GET`, no database
round trip. `ban`/`suspend` set it; `reactivate` clears it. This closes the window to effectively
immediate (next request, not next-token-expiry) while adding negligible latency (a single Redis
`GET` alongside the JWT signature check that already happens on every request).

### 5.3 — Verified sound

- **Password hashing**: argon2, correct usage (`argon2.hash`/`argon2.verify`, no custom parameters
  weakening the defaults).
- **Refresh token rotation**: rotates on every use, and reuse of an already-rotated token revokes
  every session for that user — correctly implemented, no changes needed.
- **Account lockout**: per-account (not just per-IP) failed-login tracking, correctly complements
  the IP-based throttle rather than duplicating it — an attacker rotating IPs to dodge the IP
  throttle still hits the account-level lockout.
- **Enumeration resistance**: `forgot-password`, `resend-verification`, and login's invalid-
  credential path all return identical generic responses regardless of whether the account exists
  — verified this pattern held across every one of those call sites, not just checked once.

---

## 6. Payments

| # | Finding | Severity | Status |
|---|---|---|---|
| 6.1 | Deposit-initiate had no dedicated rate limit | **Medium** | ✅ Fixed |
| 6.2 | Webhook signature + content verification | — | Verified sound (built in a prior round, re-confirmed here) |

### 6.1 — Deposit initiation had no dedicated rate limit

**Location:** `payment/payment.controller.ts`.

`POST /payments/deposit/initiate` creates a real Stripe `PaymentIntent` on every call — a
per-request cost against the platform's Stripe account, and a vector for someone to spam-create
abandoned payment intents (minor cost/noise, not a fund-safety issue, but worth bounding). It
previously relied only on the generous global 100-req/60s default.

**Fix applied:** `@Throttle({ limit: 8, ttl: 60_000 })` — a legitimate user depositing repeatedly
in a minute is already an edge case; 8 is comfortable headroom without leaving the endpoint
effectively unbounded.

### 6.2 — Re-confirmed: webhook verification is layered correctly

This was built correctly in an earlier round of this project and re-verified here rather than
re-explained at length: signature verification (`StripeProvider.constructWebhookEvent`, proves the
event came from Stripe) is layered with **content** verification
(`PaymentService.handleDepositWebhookSucceeded` checks the event's amount/currency against what
the deposit record actually expects before crediting anything) — a valid signature on a
tampered-amount event is still rejected and logged as a fraud signal, not silently trusted. No
regressions found.

---

## 7. Wallet

| # | Finding | Severity | Status |
|---|---|---|---|
| 7.1 | Serializable transactions had no retry logic | **High** | ✅ Fixed |
| 7.2 | Commission hard-cap, idempotency keys, escrow model | — | Verified sound |

### 7.1 — Serializable transactions had no retry logic

**Location:** `prisma/prisma.service.ts`.

Every money-moving operation correctly runs inside a Postgres `SERIALIZABLE` transaction — the
right isolation level for "read a balance, then write based on it" flows like entry-fee holds,
match settlement, and withdrawal processing. But `SERIALIZABLE` doesn't *prevent* concurrent
conflicting transactions from both proceeding — it **detects** the conflict and aborts one of them
(Postgres error `40001`, `could not serialize access`), expecting the application to retry. There
was no retry logic anywhere. In practice, this meant two legitimate, simultaneous operations
touching the same wallet — both halves of a match settlement landing at the same instant a
withdrawal hold is requested, for example — had a real chance of one of them surfacing as a raw
`500 Internal Server Error` to the user, instead of just quietly succeeding on retry, which is
exactly the behavior `SERIALIZABLE` is designed to make possible.

**Fix applied:** `runInSerializableTransaction` now catches serialization failures (`40001`) and
deadlocks (`40P01`) specifically, and retries with jittered exponential backoff (25ms base, up to 5
attempts) before giving up and returning a `503 Service Unavailable` (rather than an opaque `500`)
if contention is somehow still unresolved after that. Retries are safe here specifically *because*
every write inside these transactions is already idempotency-keyed — a retried transaction either
re-does the same no-op check-and-skip on an already-processed idempotency key, or performs the
write exactly once. This wasn't true by accident; it's why the idempotency-key pattern was applied
so consistently throughout the wallet system in the first place.

### 7.2 — Verified sound

- **Commission hard cap**: clamped in code (`Math.min(Math.max(commissionPercent, 0), 15)`)
  independent of whatever config value is passed in, matching the database `CHECK` constraint —
  genuine defense in depth, re-verified both layers are still in place.
- **Idempotency keys**: every wallet-mutating operation (deposits, withdrawal hold/capture/reverse,
  entry-fee hold/capture/release, settlement, refunds) is keyed and checked before any balance
  mutation. Swept every method in `WalletService` — no exceptions found.
- **Escrow model**: `available` / `locked` / `pending` remain three genuinely distinct states with
  no code path that conflates them.

---

## 8. API Abuse

| # | Finding | Severity | Status |
|---|---|---|---|
| 8.1 | IDOR: any authenticated user could view any game's full replay/PGN | **High** | ✅ Fixed |
| 8.2 | Admin destructive actions had no dedicated throttle | **Low** | ✅ Fixed |
| 8.3 | Global validation (`forbidNonWhitelisted`), RBAC coverage | — | Verified sound |

### 8.1 — IDOR: any authenticated user could pull any game's move history

**Location:** `game/games.controller.ts`.

`GET /games/:id/replay` and `GET /games/:id/pgn` had no ownership or role check at all — only
`JwtAuthGuard`, meaning *any* registered user could fetch the complete move-by-move history and
exported PGN of *any* game on the platform by ID, not just their own. This is a textbook IDOR
(insecure direct object reference): the game ID is a UUID, not sequentially guessable, but that
only prevents casual enumeration — it does nothing against a targeted request once an ID is known
(e.g. scraped from a public leaderboard link, a spectated live game, or simple brute-force at
UUID-guessing scale being impractical but the *authorization* being absent regardless of how hard
guessing is). Full move history reveals a player's opening repertoire, time management under
pressure, and playing strength — real competitive information the two participants didn't agree to
hand a stranger, and exactly the shape of data an opponent-scouting scraper would want at scale.

**Fix applied:** both endpoints now require the requester to either be one of the two participants
in the game or hold a staff role (`support_agent`/`finance_admin`/`super_admin`) — checked via the
existing `GameService.isParticipant` lookup, reused rather than duplicated. **Explicitly does not
affect** the separate, intentionally-public spectator feature (`spectateGame` over the `/game`
WebSocket namespace) — watching a game *live* remains open to anyone, by design; this fix is
specifically about *after-the-fact* full history retrieval by ID.

### 8.2 — Admin ban/suspend had no dedicated throttle

**Location:** `admin/users/admin-users.controller.ts`.

RBAC (`finance_admin`/`super_admin` only) is the real control here and was already correctly in
place — this is defense in depth on top of that, not a fix for a broken boundary. Added
`@Throttle({ limit: 20, ttl: 60_000 })` to `ban` and `suspend` specifically: if an admin credential
is ever compromised, this bounds how fast it can be used to mass-ban accounts before the compromise
is noticed and the credential revoked, without meaningfully constraining any legitimate moderation
workflow (20 bans/minute is far beyond any human admin's real pace).

### 8.3 — Verified sound

- **Mass-assignment protection**: the global `ValidationPipe`'s `whitelist: true` +
  `forbidNonWhitelisted: true` strips (and in the latter case, rejects outright) any field not
  explicitly declared on a DTO — verified this is still globally applied in `main.ts` and not
  overridden anywhere per-route.
- **RBAC coverage**: every `/admin/*` controller carries `@UseGuards(JwtAuthGuard, RolesGuard)` at
  the class level with an explicit `@Roles(...)` — swept all five admin controllers
  (users/games/reports/support/dashboard/wallet), no route found relying on guard inheritance from
  a parent that doesn't actually apply RBAC.

---

## 9. WebSockets

Covered substantively in **Section 4.1** (rate limiting) — restated here briefly for completeness
against the specific category, plus one additional item:

| # | Finding | Severity | Status |
|---|---|---|---|
| 9.1 | Wildcard CORS (`origin: '*'`) on both gateways | **Medium** | ✅ Fixed |
| 9.2 | No per-event rate limiting | **High** | ✅ Fixed (see §4.1) |
| 9.3 | Oversized message payloads accepted | **Low** | ✅ Fixed (see §4.1) |
| 9.4 | Connection-time auth, server-authoritative game state | — | Verified sound |

### 9.1 — Wildcard CORS on both WebSocket gateways

**Location:** `game/game.gateway.ts`, `matchmaking/matchmaking.gateway.ts`.

Both gateways were configured with `cors: { origin: '*' }` — any website on the internet could open
a WebSocket connection to these namespaces from a victim's browser. Socket.IO's `cors` option is
evaluated independently of the HTTP-layer CORS config in `main.ts`, so fixing the latter (which
was already reasonably configured with an env-driven origin list) didn't touch this at all — it had
to be fixed separately.

**Fix applied:** new `config/ws-cors.ts` exports the same explicit origin allow-list pattern used
for HTTP CORS (`CORS_ORIGINS` env var, no wildcard fallback), imported into both gateways.

### 9.4 — Verified sound

- **Connection-time authentication**: both gateways verify the JWT during the `connection`
  handshake and disconnect immediately on failure — no event handler trusts an unauthenticated
  socket.
- **Server-authoritative state**: re-confirmed that `move` validation happens entirely server-side
  against `ChessEngineService` (chess.js) — the client's own board is UX-only. No path found where
  a client-reported FEN, clock value, or move result is trusted directly.

---

## 10. Race Conditions

| # | Finding | Severity | Status |
|---|---|---|---|
| 10.1 | Matchmaking could match one player to two opponents simultaneously | **High** | ✅ Fixed |
| 10.2 | Wallet transaction conflicts had no retry | **High** | ✅ Fixed (see §7.1) |
| 10.3 | Game-start double-trigger | — | Verified already handled |

### 10.1 — Matchmaking double-match race condition

**Location:** `matchmaking/matchmaking.service.ts`.

`tryMatch` read candidates from a Redis sorted set (`findOpponentsInRange`), picked the first
viable one, and only removed both players from the queue *afterward*, inside `finalizeMatch`. The
read (find a candidate) and the write (remove them from the queue) weren't atomic with each other.
Under real concurrency — two different players' `joinQueue` calls landing close enough together —
both could independently select the *same* waiting candidate as their match before either one had
dequeued them, and both would proceed to call `finalizeMatch`, creating **two separate `games` rows
for the same candidate**, who is now supposedly playing two matches at once with two different
opponents, each of whom paid an entry fee expecting a real opponent. This is exactly the kind of
bug that's rare enough to pass casual testing (needs genuinely concurrent requests to trigger) and
severe enough to be a real incident when it happens at any production traffic level.

**Fix applied:** added `RedisService.claimQueueMember()` — a thin wrapper around `ZREM` that
reports whether *this specific call* was the one that actually removed the member (`ZREM`'s return
value is the count actually removed, which is atomic in Redis). `tryMatch` now attempts to
atomically claim the candidate *before* treating the match as valid; if the claim fails (someone
else's concurrent `tryMatch` won the race), it moves on to the next candidate instead of
proceeding. It then also claims *itself* the same way, handling the symmetric case where the
current player gets claimed as someone else's candidate in the same window — if that happens, the
already-claimed opponent is correctly re-enqueued rather than lost, and this attempt backs off
cleanly. `finalizeMatch` no longer does any queue mutation of its own — both players are guaranteed
already claimed by the time it's called, which is the actual fix: the mutex is the atomic `ZREM`,
not "do the check, then do the removal" as two separate steps.

### 10.3 — Verified already handled: game-start double-trigger

`GameService.startGameIfWaiting` — called from the gateway when either player's socket joins — was
already correctly guarded with a Redis `SET ... NX EX 30` lock before this audit, preventing two
near-simultaneous joins from both triggering `startGame` (which holds entry fees and would
otherwise double-charge). No changes needed; confirmed the existing implementation is correct.

---

## Fixes Applied — File Index

| File | Change |
|---|---|
| `src/main.ts` | `trust proxy`, explicit CSP, body size limits, CORS wildcard removed, webhook route registered before body parser (pre-existing, unchanged) |
| `src/config/ws-cors.ts` | **New** — shared WS origin allow-list |
| `src/game/game.gateway.ts` | CORS fix, `maxHttpBufferSize`, move/action rate limiting |
| `src/matchmaking/matchmaking.gateway.ts` | CORS fix, `maxHttpBufferSize`, joinQueue/heartbeat rate limiting |
| `src/common/ws/ws-rate-limiter.ts` | **New** — token-bucket limiter for WS events |
| `src/prisma/prisma.service.ts` | Serialization-failure retry with backoff |
| `src/redis/redis.service.ts` | `claimQueueMember()` atomic claim helper |
| `src/matchmaking/matchmaking.service.ts` | Atomic double-match fix |
| `src/auth/two-factor/two-factor.service.ts` | Server-side pending-secret storage (Redis) |
| `src/auth/dto/two-factor.dto.ts` | Removed client-supplied `secret` field |
| `src/auth/auth.controller.ts` | `confirmEnable` signature update, device-label length cap |
| `src/auth/strategies/jwt.strategy.ts` | Redis-backed immediate revocation check |
| `src/admin/users/admin-users.service.ts` | Sets/clears the revocation flag on ban/suspend/reactivate |
| `src/admin/users/admin-users.controller.ts` | Throttle on ban/suspend |
| `src/mail/mail.service.ts` | HTML-escapes all interpolated values |
| `src/game/games.controller.ts` | IDOR fix — participant/staff-only replay & PGN access |
| `src/payment/payment.controller.ts` | Throttle on deposit-initiate, `@SkipThrottle()` on webhook |
| `src/upload/upload.service.ts` | Filename sanitization |
| `chess-frontend/next.config.js` | Security headers (CSP, X-Frame-Options, etc.) |
| `chess-frontend/app/settings/page.tsx` | Matches the 2FA secret-handling fix |
| `chess-admin-frontend/index.html` | Baseline CSP meta tag |

## Recommendations Not Implemented (Infrastructure / Operational)

These need a deployment or tooling decision outside application code, not a code change:

1. **WAF / edge DDoS protection** (§4.5) — Cloudflare, AWS Shield, or equivalent in front of
   production.
2. **KYC document malware scanning** — uploaded files are validated by MIME type and size but not
   scanned for embedded malware; recommend an antivirus scan step (e.g. ClamAV, or a managed
   service) between upload and any future human review of the stored document.
3. **Secrets management** — `.env.example` files document what's needed; production should source
   these from a real secrets manager (AWS Secrets Manager, Vault) rather than environment files,
   consistent with what the original architecture document already recommended.
4. **`TRUST_PROXY_HOPS` must match real infrastructure** — the fix in §4.2 is only correct if the
   deployed hop count matches the env var; this needs to be set correctly per-environment as part
   of deployment, not something the application can verify on its own.
