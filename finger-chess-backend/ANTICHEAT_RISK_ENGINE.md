# Anti-Cheat & Risk Engine

Built as a unification layer over signals that mostly already existed (Stockfish-based engine
detection, payment fraud checks, matchmaking collusion detection) plus three genuinely new signal
sources, rather than a parallel system duplicating what was already there.

## What's real vs. honestly scoped

- **Engine usage / suspicious move accuracy**: pre-existing (`AnticheatService`) — centipawn-loss
  and top-engine-move-match analysis via a real Stockfish instance. The risk engine reads its
  output (`flagged` count), it doesn't reimplement it.
- **Device fingerprinting**: real. A stable hash from hardware/canvas/audio rendering signals —
  deliberately excludes session-variable signals (language, timezone) that would break the
  multi-account match on the same real device.
- **Browser tampering**: real, documented signals — `navigator.webdriver` (set by
  Selenium/Puppeteer/Playwright by design), zero plugin count (characteristic of headless Chrome),
  blocked canvas fingerprinting.
- **Behavior analysis**: real — coefficient-of-variation on per-move think-time, derived from clock
  data (`GameMove.clockRemainingMs`) the game engine already records for an unrelated reason (clock
  sync), so no new data collection was needed. Runs on every completed game, not just paid ones,
  since it's cheap arithmetic, unlike the Stockfish pass.
- **VPN detection**: honestly scoped as a *heuristic*, not a real VPN/proxy database lookup — no
  such provider is wired in. What's real: counting distinct accounts sharing an IP within a 7-day
  window, above a threshold chosen specifically to avoid flagging normal shared networks (a
  household, an office). This is VPN/proxy-*adjacent*, correlated but not equivalent, and documented
  as such rather than presented as a definitive "VPN: yes/no" the platform can't actually back up.
- **Multiple accounts**: real — the fingerprint-hash-collision query.
- **Automatic flags**: real — a "high" or "critical" risk score writes into the *existing*
  `fraud_signals` table (idempotent, once per day per user via a Redis dedup key), so it surfaces in
  the admin review queue that already exists rather than a second, parallel alert list to remember
  to check.
- **Risk score**: real aggregation, explicit tunable weights (documented, not hidden magic
  numbers), Redis-cached for 5 minutes — the scalability requirement is concrete here: an admin
  dashboard listing many high-risk users doesn't re-run five separate table aggregations per row on
  every page load.
- **Warning / temporary bans / permanent bans**: warning is a new, genuinely lighter penalty tier
  (no restriction at all, just a logged notice + notification) added alongside the pre-existing
  suspend/ban actions — not rebuilt from scratch.

## Two real bugs caught while building this

1. Declared an `AUTO_FLAG_THRESHOLD` constant, then wrote the actual check using a hardcoded
   tier-string comparison instead of the constant — meaning changing the threshold later would have
   silently done nothing. Fixed to reference the constant directly.
2. Widened the `fraud` penalty category in TypeScript's type unions but almost missed that
   `class-validator`'s `@IsIn()` decorator uses a separate *runtime* array — the types would have
   compiled fine while the API silently 400'd every real request using the new category. Caught by
   explicitly checking, not assuming the type-level fix was sufficient.
3. The admin Risk & Security dashboard's "Suspend (7 days)" button would have actually triggered an
   **indefinite** suspension — `AdminUsersService.suspend()` only applies a default multi-day
   duration for `category: 'cheating'`; every other category (including the new `fraud` category this
   dashboard uses) falls through to `suspendedUntil = null` when no explicit date is passed. Caught
   by reading the actual service logic rather than trusting the button label I'd just written, and
   fixed by computing and passing an explicit 7-day date client-side.

## Verified, not asserted

`tsc --noEmit` clean across all three projects. Every new/changed API call — including the
multi-line `api\n.get(...)` call my first grep pass missed and had to re-check directly — matched
against the actual backend route decorators. No circular module dependencies introduced
(`SecurityModule` → `WalletModule` is one-directional; `GameModule` and `AppModule` both import
`SecurityModule` directly, which Nest handles as a normal shared dependency, not a cycle).
