# Changelog

All notable changes to Finger Chess. Grouped by the actual development passes that produced them,
newest first.

## Fair Play & Anti-Cheat — Detection, Scoring, Admin Review

- New `fairplay` config section (`src/config/configuration.ts`, env-overridable via `FINGER_CHESS_FP_*`)
  covering severity points, per-category caps, scoring weights, auto-flag threshold, tiers, and every
  detector threshold.
- New `FairPlayDetectorService` (live + post-game detection engine, flag-for-review only):
  concurrent real-money sessions, rapid reconnect abuse, impossible move speed (captures exempt,
  bullet-tolerant), abnormal win streaks, repeated suspicious patterns / flagged engine use,
  abandonment-pattern detection, and a three-legged collusion heuristic (head-to-head + result skew +
  shared fingerprint/IP). Every signal carries severity + evidence and lands in the shared
  `fraud_signals` review queue.
- New `FairPlayAuditService` — single audited write path to `security_logs` with Redis dedup and a
  no-blocking best-effort failure mode.
- Rewrote `RiskScoreService`: severity-aware evidence scoring with per-category caps, per-signal-type
  bonuses, Redis-cached 0-100 score, tier thresholds, `risk_tier_change` security events, and an
  auto-flag `high_risk_score` signal at the configured threshold (still flag-for-review, never
  auto-punish).
- Extended `FraudService.recordSignal` with `referenceType`/`referenceId` so game-scoped signals
  surface in the match review queue.
- New admin review tooling (`AdminFairPlayService` + controller): `/admin/fairplay/overview`,
  `/players`, `/players/:id` dossier, `/players/:id/notes`, `/players/:id/review`, `/matches`,
  `/matches/:id`, `/signals/:id/review` — role-gated, fully audited.
- Game lifecycle hooks: gateway join/disconnect feed live detectors; `GameService.finishGame` runs
  the post-game pipeline fire-and-forget without touching settlement.
- Player reporting: new `match_manipulation` report category (backend validators + player dropdown),
  used consistently in category filters.
- Admin frontend: new Fair Play page (overview / players / matches tabs) with player dossier and
  match review modals; lazy-loaded, role-gated to `finance_admin`/`super_admin`.
- Chess rules, wallet calculations, and auth are untouched. No schema migration required.
- Full report with scores: `FAIR_PLAY_FINAL_REPORT.md`.

## Match System — Production Hardening

- Fixed first-joiner-only sync bug: a match now starts only when **both** players are physically in
  the room (`markJoined` + `startGameIfWaiting`), and the start broadcast goes to the whole room.
- Fixed reconnect-after-completion showing an infinite "waiting for opponent" spinner — a finished
  game now replays a `gameOver` payload to a rejoining player.
- Added server-side clock enforcement: per-move/start clock timers + `enforceClockTimeout` + a
  30-second recovery sweep (`settleExpiredClocks`) that settles flagged games even after a restart.
- Added `abortStaleWaitingGames` (120s) so a matched-but-no-show opponent no longer strands a player
  or blocks re-queueing.
- Fixed half-hold / stranded entry fees: `releaseEntryFeeHold` on every decisive settlement, a
  balance pre-check inside `startGame`, and one-sided-hold compensation.
- Added `recoverActiveState` (deterministic replay from `game_moves`) + `recoverOngoingGamesWithoutState`
  sweep; un-recoverable games are aborted and both entry fees refunded.
- Closed stale-state attacks: holds precede state writes, recovery aborts wipe all game-scoped Redis
  keys, and `requireActiveState` re-validates DB `ongoing` status on every mutation.
- Added `expectedMoveCount` ply guard (`MoveDto`) so duplicate/out-of-order moves get a clear
  "board out of sync" error instead of "Not your turn" / double-apply.
- Multi-socket forfeit guard: closing one tab no longer forfeits a player who still has an open one.
- Full report with scores: `MATCH_SYSTEM_FINAL_REPORT.md`.

## [Unreleased] — Project Audit & Export Preparation

- Consolidated duplicate status-color logic (`wallet` and `verification` pages each had their own
  implementation) into one shared `lib/status-tone.ts`.
- Extracted byte-identical duplicated `TIME_CONTROLS` data (present in both lobby pages) into a
  shared `lib/time-controls.ts`.
- Removed two genuinely unused dependencies from the player frontend
  (`@radix-ui/react-tooltip`, `@radix-ui/react-scroll-area`) — zero imports anywhere in the codebase.
- Added the backend's missing `.gitignore` (frontend and admin already had one).
- Added this CHANGELOG and a proprietary `LICENSE` at the project root.

## Security Hardening — Secure Cookies

- Migrated the refresh token from `localStorage` to an httpOnly, `SameSite=Strict` cookie, on both
  frontends — closes a real OWASP A07 weakness where a single XSS bug could previously result in
  full, persistent account takeover via a JavaScript-readable long-lived token.
- Access token moved to in-memory-only storage; bootstrap flow now silently re-authenticates via
  the httpOnly cookie on page load instead of assuming "no token = logged out."
- Fixed the OAuth callback flow, which previously put both tokens in a URL fragment (would have
  been a live bypass of the cookie migration).
- Fixed `logout()` on both frontends, which previously never called the backend at all — meaning a
  "logged out" session's server-side session and cookie would have silently remained valid.

## Anti-Cheat & Risk Engine

- New `RiskScoreService`: aggregates engine-use detection, fraud signals, device-fingerprint
  multi-account linkage, shared-IP clustering, and browser-tamper flags into one cached 0–100 score
  per user, with automatic flagging into the existing admin fraud-review queue.
- New `DeviceFingerprintService` and client-side fingerprint collection.
- New `BehaviorAnalysisService`: move-timing anomaly detection from existing per-move clock data.
- New admin "Risk & Security" dashboard page.
- New `warning` penalty tier and `fraud` penalty category.

## Matchmaking Upgrade

- Real, rolling-average estimated wait time per matchmaking room.
- The existing skill-matching rating band is now pushed live to the client.
- Real ping/pong round-trip connection-quality measurement.
- New shared animated searching-screen component used by both free and paid matchmaking flows.

## Player Profile Redesign

- New Elo-based `RatingService` — ratings now actually update after every game (previously static
  at the 1200 default for every account). Tracks peak rating and full rating history per game mode.
- New `RatingHistory` table and a hand-built SVG rating-over-time chart.
- New "favorite opening" classifier against a curated common-openings book.
- Country, friends count, and recent-games history added to the public profile.

## Admin Dashboard — Role Permissions

- New, hand-verified role-permissions reference page and endpoint, built directly from every
  `@Roles(...)` decorator in the backend.

## Verification (KYC) System Upgrade

- New `needs_more_info` status, distinct from a hard rejection, with its own admin action.
- Real drag-and-drop upload with genuine upload-progress tracking.
- Registration now collects country and preferred ID type.
- Verification timeline built from existing resubmission history.

## Wallet System Upgrade

- Real transaction filters, search, and CSV export (server-side).
- New "Lifetime Earnings" metric and dedicated deposit/withdrawal status feeds.
- Security-indicator panel (KYC/2FA status) on the wallet dashboard.

## Chess Board Redesign

- Original, hand-built SVG piece set (shared gradient defs for performance) and a wood-textured
  board with real drag/drop, move/capture/promotion animation, and a working promotion picker.

## UI/UX Redesign Pass

- Design-token-level redesign (colors, radius, shadow, motion).
- Fixed a real accessibility bug: brand gold text failed WCAG AA contrast in light mode (~2.1:1);
  fixed at the token level so all usages across the app were corrected at once.

## Free Play Mode

- A genuinely separate, structurally-isolated ($0 entry fee) matchmaking room and dedicated UI flow
  alongside real-money matches — free and paid players can never be matched together by construction.

## Foundational Build

- Full four-project platform: NestJS backend, Next.js player frontend, Vite admin console, Docker/
  Kubernetes infrastructure. Authentication (JWT + refresh rotation, 2FA, OAuth), wallet system,
  real-time chess engine and matchmaking, KYC/compliance, full social system, and the complete
  admin dashboard.
