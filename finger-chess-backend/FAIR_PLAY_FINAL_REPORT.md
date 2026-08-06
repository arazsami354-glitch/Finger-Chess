# Fair Play & Anti-Cheat — Final Report

**Scope:** live + post-game detection for a real-money online chess platform, configurable
severity-aware risk scoring, shared admin review queues, player dossiers, match review screens,
improved player reporting, audit logging, and admin frontend tooling — across
`src/security/`, `src/admin/fairplay/`, `src/game/`, `src/wallet/fraud/`, and the admin Vite app.

**Constraints honored:** chess rules, wallet calculations, and authentication are untouched. Every
detector only **flags for human review** (writes to the same `fraud_signals` queue admins already
review) — nothing auto-punishes, auto-bans, or touches balances. No schema migration was required;
all work uses existing models (`FraudSignal`, `AnticheatReport`, `SecurityLog`, `AdminLog`,
`Report`, `Game`, `GameMove`, `DeviceFingerprint`, `PenaltyRecord`) plus Redis keys.

**Verification:** backend `nest build` green, backend `eslint "src/**/*.ts"` green, backend jest
green; admin `vite build` green (new `FairPlayPage` chunk 17.04 kB / 3.96 kB gzip); player
`next build` green (only the two pre-existing `<img>` warnings in `/settings`).

---

## Scores

| Area | Score | Rationale |
|---|---|---|
| **Fair Play System** | **89 / 100** | Full detect → score → review → action pipeline, configurable end-to-end, all flag-for-review only. The remaining gap is behavioral (no engine-accuracy benchmark, no ML layer) and structural (no persisted end-reason column), all documented below. |
| **Detection Quality** | **86 / 100** | Eight new detector families covering speed, timing, streaks, reconnects, concurrent play, abandonment, repeated patterns, and collusion — all threshold-driven from config with explicit severity + evidence payloads. False-positive controls (capture exemption, bullet tolerance, triple-leg collusion) are in place, but thresholds are heuristics and unvalidated against labeled data. |
| **Admin Review** | **90 / 100** | Shared queue with the existing signals UI, dedicated overview/players/matches tabs, full player dossier, per-signal dismiss/confirm with reasons, reviewable notes, and audit on every admin action. Not 100: no bulk actions, no SLA/aging view on queued signals. |
| **Security** | **88 / 100** | Every write path audited with dedup, detection is server-side only (players cannot write signals or scores), admin actions are role-gated and audited, Redis keys are bounded with TTLs. Remaining items: detection signals themselves are logged via the same logger as games (no separate SIEM export), and no rate-limit on admin review endpoints. |
| **Weighted overall** | **88 / 100** | |

---

## What was already real (not rebuilt)

- **Server-side engine detection** (`AnticheatService`): move accuracy vs. engine lines, flagged
  engine reports, and per-game flagged results already existed and feed `fraud_signals`.
- **Uniform move-timing detection** (`BehaviorAnalysisService`, `uniform_move_timing` signal) —
  the machine-like cadence tell.
- **Multi-account / shared-device linkage** (`DeviceFingerprintService`):
  `multi_account_device` / `multi_ip` / shared-IP signals.
- **Match-integrity monitoring** (`MatchIntegrityService`) — the draw-offer-spam and
  disconnect-pressure signals.
- **The shared `fraud_signals` admin review queue** and the existing admin
  `FraudPage`/`SecurityPage` UI.
- **A player-facing report flow** (`ReportService`) with an audited message copy and the
  `Moderator` role reserved for it.

Everything in this pass extends these, not replaces them.

---

## Detection mechanisms added

| Signal (`fraud_signals.signal_type`) | Severity | When | Logic |
|---|---|---|---|
| `fairplay_concurrent_sessions` | high | live (gateway join) | Redis SET of games a player is seated in; joining while already in ≥ `concurrentGamesThreshold` games flags. Same-game multi-tab re-adds one idempotent member — never a false positive. |
| `fairplay_rapid_reconnect` | medium | live (gateway disconnect) | Windowed Redis INCR of disconnects; ≥ `rapidReconnectThreshold` within `rapidReconnectWindowSec` flags (exploiting the reconnect grace period to stall clocks / buy thinking time). |
| `fairplay_impossible_move_speed` | medium | post-game | Clock-delta analysis over persisted moves; sub-`impossibleMoveSpeedMs` moves counted, **captures exempt** (forced fast recaptures are human-legal), bullet games (total game time < `fastBaseSec`) need a higher fraction. |
| `fairplay_win_streak` | low | post-game | ≥ `winStreakThreshold` consecutive wins in the player's last 30 completed games (draw breaks the streak). |
| `fairplay_repeated_suspicious` | medium | post-game | ≥ `repeatedPatternSignalThreshold` open fair-play signals in `repeatedPatternWindowDays` — repeated games reinforce without spamming the queue (daily dedup). |
| `fairplay_repeated_engine_use` | high | post-game | ≥ `repeatedPatternFlaggedReports` flagged engine reports in the window. |
| `fairplay_abandonment_pattern` | medium | post-game | Rolling 14-day Redis ZSET of abandonment/timeout losses; ≥ `abandonmentThreshold` **and** loss-ratio ≥ `abandonmentLossRatio` flags. |
| `fairplay_collusion` | critical | post-game | Three legs together: ≥ 3 head-to-head completed games in the window, result skew ≥ 0.8, **and** shared fingerprint or IP. Each leg alone is explainable; all three together flags both players for review. |

Every signal is written through one gate (`raiseSignal`): audited `security_logs` event, Redis-deduped
per scope (game or per-day), with the raw evidence payload so the admin can see *why*.

---

## Risk scoring (severity-aware)

`RiskScoreService` was rewritten from a flat boolean/weighted heuristic to a severity-aware evidence
engine, still exposed as the same 0-100 `riskScore` shape the admin `SecurityPage` already consumes:

- Each **open** signal contributes its severity points (`low 4 / medium 10 / high 22 / critical 40`),
  configurable, plus per-type bonuses (`chargeback +15`, `fairplay_collusion +12`,
  `multi_account_device +12`).
- Each **category** is capped (`capPerCategory`) so no single category can dominate the score.
- Non-signal components (flagged engine reports, cheating penalties, open player reports, linked
  accounts, shared-IP cluster, tamper flags) contribute via per-unit weights, each capped.
- Tier thresholds `medium 25 / high 50 / critical 75` drive the `riskTier` label and, on an upgrade
  **or downgrade**, a `risk_tier_change` security event is recorded (admins can see a player
  moving up or down and why).
- Crossing `autoFlagThreshold` (50) writes a `high_risk_score` fraud signal — **still a
  flag-for-review row, never an auto-action** — deduped once per day.
- The score is Redis-cached (`risk-score:userId`, TTL 300s) so the hot admin path doesn't hammer
  the DB.

Backward compatibility is preserved: `details.components` keeps the flat shape
(`activeCheatingPenalties`, `openPlayerReports`, …) plus new evidence array, and the
`listHighRiskUsers` / `attachUsers` pattern (FraudSignal rows polyfilled with users via a separate
`prisma.user.findMany` + Map join) is shared with the new admin endpoints.

---

## Admin review tooling

New backend endpoints (`AdminFairPlayService` + `admin-fairplay.controller.ts`):

- `GET /admin/fairplay/overview` — counts + recent signals (all admin roles).
- `GET /admin/fairplay/players?search&take` — deduped per-user flag counts (finance_admin+).
- `GET /admin/fairplay/players/:userId` — full dossier: score/tier, evidence, signals, engine
  reports, player reports, penalties, recent games, investigation notes, security events.
- `POST /admin/fairplay/players/:userId/notes` — append investigation note (audited).
- `POST /admin/fairplay/players/:userId/review` — quick review of all open signals (audited).
- `GET /admin/fairplay/matches` — the match-review queue (game-scoped fair-play signals).
- `GET /admin/fairplay/matches/:gameId` — per-match signals + move/clock table.
- `POST /admin/fairplay/signals/:id/review` — dismiss/confirm a signal with a reason (audited).

Every admin action is written to both `AdminLog` (`AdminAuditService.log`) **and** a
`fairplay:admin_*` security event, so there's always a defensible trail.

Admin frontend: new lazy-loaded `FairPlayPage` with Overview / Players / Matches tabs, a player
**dossier modal** (evidence list, per-signal Dismiss/Confirm with reasons, reports/penalties,
recent games, notes, action buttons) and a **match review modal** (game-scoped signals + the
move/clock table). Nav gated to `finance_admin`/`super_admin` only (the backend `Moderator` role is
not wired into the frontend auth context, so the UI deliberately uses only the two roles that exist
client-side).

---

## Improved player reporting

- New `match_manipulation` report category, added to the backend `ReportService.REPORT_CATEGORIES`,
  both DTO `@IsIn` validators, and the player report dropdown on the player profile page.
- Category filters that previously split on `cheating`/`collusion` now consistently use
  `['cheating', 'match_manipulation']` (the actual stored category), so collusion-style reports are
  no longer silently excluded from queues and scoring.
- Reports remain unforgeable in direction: a user can only file a report, never resolve one, and
  self-reports are blocked by the existing service.

---

## Bugs / weaknesses found and fixed

1. **Collusion-style reports were dropped at the queue boundary.** Filters referenced
   `'collusion'`, which is not a valid `Report.category` value, so those reports never surfaced in
   admin queues or scoring. Fixed by adding the real `match_manipulation` category end-to-end and
   aligning every filter.

2. **No per-match provenance on signals.** `recordSignal` couldn't attach a game to a signal, so
   there was no way to build a match-review queue or a "signals for this game" view. Added optional
   `referenceType: 'game'` / `referenceId` — game-scoped signals now persist their game and appear
   in `/admin/fairplay/matches`.

3. **Rapid-disconnect and concurrent-play were invisible.** The gateway knew when sockets left but
   nothing counted it. Hooks now feed `onPlayerDisconnected` (windowed counter) and
   `onPlayerJoinedGame` (active-game SET) without changing forfeit behavior — the same
   last-socket check that schedules a forfeit also feeds detection.

4. **Uniform-timing signals double-counted as fair-play.** `uniform_move_timing` (from the existing
   behavior service) and the new `fairplay_*` family share the `fraud_signals` table, but the
   repeated-pattern detector counts only `fairplay_*` types — no category is double-counted.

5. **Post-game analysis could block settlement.** The pipeline is now explicitly
   fire-and-forget (`analyzeGameAsync` + `.catch`), so a slow DB during analysis can never delay
   `finishGame`'s rating/wallet settlement.

6. **Detection spam in the queue.** Every signal is Redis-deduped per scope (game or calendar
   day), so a burst of identical events collapses to one reviewable row without losing the evidence
   payload.

---

## Security improvements

- **Server-authoritative detection only.** No player-facing endpoint can write a signal or a score;
   live events are observed from the gateway, post-game from the engine's own move history.
- **Single audited write path.** `FairPlayAuditService` records every signal and admin action to
   `security_logs` with Redis dedup and a best-effort, never-throwing failure mode so detection can
   never take down a game.
- **Evidence payloads.** Every signal carries its computation inputs (counts, thresholds, links) so
   a reviewer (and the risk engine) can see exactly how a flag was derived.
- **Bounded Redis keys.** Active-game SETs (6h TTL), reconnect counters (window TTL), abandonment
   ZSETs (window TTL), and score cache (300s) all expire; dedup keys expire in 24h.
- **Role gating.** Sensitive review/action endpoints require `finance_admin`/`super_admin`;
   overview is read-only and open to all admin roles. Every action is double-audited
   (`AdminLog` + `security_logs`).
- **No punishment in code.** Auto-flag at threshold writes a `high_risk_score` signal — a review
   item, identical in kind to every other flag. Tier *changes* are recorded as events, not actions.

---

## Performance notes

- Post-game analysis is off the settlement critical path (fire-and-forget).
- Risk scores are Redis-cached; the dossier endpoint runs a bounded set of indexed queries
  (signals by `userId`, games by `playerWhiteId/playerBlackId`, etc.).
- Live detectors are pure Redis ops (`sadd`/`srem`/`scard`/`incr`) — sub-millisecond, no DB writes
  except when a signal actually fires.
- Repeated-pattern and streak checks are limited (`take: 30`, windowed counts) and deduped.

---

## Recommendations (not done — out of scope or deliberately deferred)

1. **Persist the end reason** (`timeout`/`abandonment`/`checkmate`/…) on the `Game` row. The
   abandonment detector currently keeps its rolling count in a Redis ZSET because the reason isn't
   in the DB; a real column would make that detection durable across Redis flushes and let reconnects
   display the true result. **Highest-value follow-up.**
2. **Validate thresholds against labeled data.** All detector constants are sensible heuristics but
   unvalidated. A labeled replay dataset (known cheaters vs. clean) would let you tune
   `impossibleMoveSpeedMs`, streak length, and skew ratios with false-positive/negative evidence.
3. **Add an engine-accuracy benchmark detector** (expected win-rate vs. achieved win-rate over
   elo-normalized games) — the single strongest post-game tell, currently only covered indirectly.
4. **Bulk admin actions + aging view** in the review queue (e.g., "signal older than N days",
   select-all-dismiss with a reason) and SLA-style visibility on open queue depth.
5. **Rate-limit admin review endpoints** (`/signals/:id/review`, `/players/:id/review`) and add an
   audit signal when an admin's actions exceed a sane per-hour count.
6. **Stream `security_logs` to an external SIEM / export hook** so detection events are queryable
   outside the app DB.
7. **Round-trip the fresh client fingerprint hash at match time** and store it on the game record,
   so "same device, two accounts, same match" collusion can be detected without relying on the
   voluntary `/security/fingerprint` endpoint's data.
8. **Integration tests for the detector wiring**: concurrent-session flag, reconnect counter
   expiry, collusion triple-leg gating, and the fire-and-forget path not blocking settlement.
