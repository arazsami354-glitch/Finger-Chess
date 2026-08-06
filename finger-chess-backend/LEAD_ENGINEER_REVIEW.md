# Lead Engineer Review — Finger Chess

A methodical pass across all four projects, prioritized by risk: newest/least-battle-tested code
first (the social system, built fastest), then a targeted sweep of the older, higher-stakes
modules (wallet, payments, matchmaking) using the same technique that kept finding real issues.

**Method, stated plainly:** rather than a surface read-through, this pass used two repeatable
techniques that found every substantive bug below:
1. **"Defined but never called" audits** — grep every public method against its own call sites.
   A method that exists, compiles, and is never invoked is either dead code or a half-finished
   feature; several of the findings below are the latter.
2. **Frontend-to-backend route cross-checks** — list every `api.get/post/patch/delete` call in
   each frontend, then verify each string against the actual `@Controller`/`@Get`/`@Post`
   decorators in the backend. This has caught a real mismatch in every prior round it was applied.

---

## Bugs Found and Fixed

### 1. Memory leak — `WsRateLimiter.sweep()` was never called (High)

**Location:** `common/ws/ws-rate-limiter.ts`, used by all three gateways (`game`, `matchmaking`,
`social`).

A cleanup method existed specifically to stop the rate limiter's internal tracking map from
growing forever, but nothing in the codebase ever called it. Every distinct user who connected to
any rate-limited gateway left a permanent entry, for the life of the process — on a platform
explicitly targeting millions of concurrent users, this is a real, not theoretical, unbounded
memory leak over any meaningful uptime.

**Fix:** the class now schedules its own periodic sweep internally (`setInterval` in the
constructor, `.unref()`'d so it never keeps the process alive on its own). Callers get automatic
cleanup without needing to remember to wire it up — which is exactly how it was missed the first
time.

### 2. New socket connections never received friends' presence (High)

**Location:** `social/social.gateway.ts`, `social/presence/presence.service.ts`.

`PresenceService.getBulkStatus` — an efficient batched presence lookup — was fully built and never
called from anywhere. In practice: a friends list on page load showed everyone as blank/offline,
only becoming accurate once each individual friend happened to change status while you stayed
connected. For a friend who'd already been online for hours before you logged in, that could be
never.

**Fix:** `handleConnection` now fetches the connecting user's friends' current presence in one
batched call and emits it as a `presenceSnapshot` event; the frontend hook now listens for it
alongside the existing one-off `presenceUpdate` events.

### 3. "Avatar Management" was half-built end-to-end (High)

**Location:** `upload/upload.service.ts`, `users/users.service.ts`, `social/friends/`,
`social/profile/`, and the corresponding frontend components.

Upload worked correctly (signed S3 storage, size/type validation). Display never did:
- `UploadModule` never exported `UploadService` — it was only reachable within its own controller.
- `GET /users/me` — the single most-called endpoint in the app — never selected or returned
  `avatarKey` at all. A user's own avatar could not appear in their own header or settings page,
  full stop.
- Every friends-list, requests, blocked-users, favorites, recent-players, and search endpoint
  returned a raw `avatarKey` (an opaque S3 object key) instead of a displayable URL.
- The frontend's `AvatarImage` component was defined and never once used — every avatar everywhere
  rendered as initials only, regardless of what the backend sent.

**Fix, both sides:**
- `UploadModule` now exports `UploadService`.
- `UsersService.getProfile` now selects `avatarKey` and `bio`, resolves the former to a signed URL,
  and returns `avatarUrl` instead of the raw key.
- New `AvatarResolverService` (`social/friends/avatar-resolver.service.ts`) — deliberately kept
  separate from `FriendsService` itself, since `FriendsService.listFriends` is reused internally
  for non-display purposes (presence-broadcast targeting, mutual-friend computation) where
  resolving a signed URL would be pure waste. Applied at the controller boundary to every
  client-facing list/search/profile endpoint instead.
- Frontend: `PlayerCard`, the player profile page, and the app shell's header avatar all now render
  `AvatarImage` when a URL is present, falling back to initials only when it isn't. Added an actual
  avatar-upload control (with live preview) to the Settings page, which had none before.

### 4. `bio` existed on the User model but could never be set (Medium)

**Location:** `users/users.controller.ts`, `users/users.service.ts`, Settings page.

Found while fixing #3 — the field existed in the schema and was just wired into the read side, but
`UpdateProfileDto` never accepted it and `updateProfile` never wrote it. Added the field to the DTO,
the service, and a proper bio textarea (300-char limit, shown) to Settings.

### 5. Manually-set `Content-Type` on a multipart upload would have broken it (Medium)

**Location:** Settings page's avatar upload handler.

`api.post('/uploads/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } })` —
setting this header manually omits the `boundary` parameter multipart parsing requires; most
multipart parsers, including multer on the backend, will reject or mis-parse the result. The
browser/axios generates the correct header (boundary included) automatically when the body is a
`FormData` instance — the fix was to remove the override entirely, not add a boundary by hand.

### 6. DRY violation — a duplicated raw query in the admin wallet controller (Low)

**Location:** `wallet/wallet.controller.ts`.

`AdminWalletController.listReconciliationDrifts` had its own inline Prisma query, duplicating
`AccountingService.getOpenDrifts()` — which already existed, in the same module, doing the exact
same thing. Fixed to delegate; one place to change if the query's shape ever needs to.

### 7. `getLastSeen` was built and never surfaced (Low)

**Location:** `social/presence/presence.service.ts`, `social/profile/player-profile.controller.ts`.

Same root cause as #2 — the durable "last seen" fallback (backed by
`user_presence_snapshots`) existed and was never called. Every offline player's profile showed
nothing instead of "last seen 3 hours ago." Wired into the profile response (only queried when a
player is actually offline — meaningless noise otherwise) and the frontend display.

### 8. Type-safety escape hatches masking real gaps, not necessary casts

Swept every `as any` in the backend; five of eight were papering over a real issue rather than
working around a genuine library-typing limitation:

- **`wallet/accounting/accounting.service.ts`** — the reconciliation job's credit/debit type
  arrays were plain `string[]`, cast to `any` to satisfy Prisma's enum-typed query. A typo in
  either array would have compiled silently in a job whose entire purpose is catching financial
  discrepancies. Fixed by typing both arrays as Prisma's actual generated `TxnType[]`.
- **`auth/auth.controller.ts`** (×2) — both OAuth callback handlers cast `req.user` to `any` before
  passing it to a function expecting a concrete `OAuthProfile`. Fixed with a proper `OAuthRequest`
  interface, so a mismatch between what a Passport strategy returns and what the handler expects
  is now a compile error instead of a silent runtime one.
- **`social/moderation/report.service.ts`** — the report-category validator itself, of all places,
  bypassed its own type-checking with a cast. Replaced with a proper TypeScript type guard.
- **`game/game.service.ts` / `game/utils/pgn-builder.ts`** — `PgnGameInfo.result` hand-duplicated
  Prisma's `GameResult` enum as a plain string-literal union, which is why the cast was "needed" in
  the first place (TypeScript string enums are nominally typed, not structurally interchangeable
  with plain literals). Fixed by importing and reusing Prisma's actual `GameResult` type — the two
  can no longer drift out of sync, and the cast became unnecessary rather than just tolerated.
- **`auth/strategies/google.strategy.ts`** — this one was simply unnecessary defensive coding;
  `OAuthProfile` already satisfies Passport's expected `Express.User` shape without a cast. Removed.

(The remaining three `as any` occurrences are legitimate: two are typing external OAuth
provider library payloads, which genuinely aren't strongly typed upstream; one was a false
positive — the word "any" appearing inside a comment, not a cast at all.)

### 9. Admin dashboard Badge helpers used casts instead of typing the value (Low)

**Location:** `finger-chess-admin/src/pages/UsersPage.tsx`, `SupportPage.tsx`, `FraudPage.tsx`.

Same root cause as the report-category fix above: three small `StatusBadge`/`PriorityBadge`/
`SeverityBadge` helpers computed a `tone` value via ternary (which TypeScript widens to plain
`string`) and cast the JSX prop to `any` to force it through. Fixed by typing the local `tone`
variable with the exact union `Badge` expects — same visual result, no cast.

---

## Verified Correct (Investigated, No Fix Needed)

- **`AccountingService.reconcileWallet`'s credit/debit type split**: initially looked suspicious
  (why does `entry_fee_capture` appear in neither list?), but tracing `WalletService.settleMatch`
  confirmed it's correct — `entry_fee_capture` only ever touches `locked_balance`, never
  `available_balance`, so excluding it from both sums is exactly right, not an oversight.
- **Every `Promise.all`/`$transaction` array of Prisma calls** flagged by an initial "missing
  await" sweep — all correctly rely on the surrounding `Promise.all`/transaction array being
  awaited as a whole, not a bug.
- **The fire-and-forget achievement checks in `GameService.finishGame`** — deliberately unawaited,
  and correct: `AchievementsService.checkAndUnlockForUser` swallows its own errors internally so a
  celebratory feature can never delay or break prize settlement.
- **Frontend-to-backend route cross-check, admin frontend**: every single API call in
  `finger-chess-admin` matches an actual backend route. No mismatches found this round.

---

## What This Pass Did Not Cover

Stated plainly rather than implied by omission:
- The `finger-chess-infra` project (Docker/Kubernetes manifests, CI/CD) was not re-reviewed this
  pass — it was reviewed and corrected during the rebrand pass and hasn't changed since.
- No automated test suite exists yet (`package.json`'s `test` script is `jest --passWithNoTests`,
  documented honestly as a placeholder in the CI workflow's own comments) — this review is manual
  code inspection, not test-verified behavior.
- The known, previously-documented scale limitations (in-memory WS rate limiters and disconnect
  timers being per-instance rather than Redis-backed) remain as previously stated; they're a
  scaling *next step*, not a bug, and are called out consistently everywhere they apply rather than
  hidden.
