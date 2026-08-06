# Database Audit Report — Finger Chess

**Scope:** PostgreSQL 16 schema (`finger_chess`), all Prisma migrations `0002–0012` plus the new
`0013`, and every model-level query/transaction in the NestJS backend (auth, wallet, matchmaking,
game, social, admin). **Method:** Manual review of the full `schema.prisma` (1010 lines), every
service `where` clause cross-referenced against declared indexes, and the migration history. **No
feature, API, UI, or business-logic behavior was changed.** Every index added backs a query that
actually exists in the code.

**Summary:** 4 indexes applied and verified (migration `0013`, additive-only). 5 documented
findings deferred because fixing them means changing application logic — out of scope for a
database pass, flagged for a future code pass. All validation gates green: `eslint`, `tsc
--noEmit`, `nest build`, `prisma migrate status`, live endpoint smoke tests.

---

## 1. Index Coverage

**Verified: every model's `where`/`orderBy` filter is covered by an existing or newly added
index.** I mapped all 47 models against their actual query patterns (grep-verified, not guessed).
The schema was already in good shape — the `0006_performance_indexes` migration had covered the
hot financial/game tables (`games`, `wallet_transactions`, `deposits`, `withdrawals`,
`notifications`). The following gaps existed and are now closed:

### Applied (migration `0013_support_refund_anticheat_indexes`)

| Table | Index | Backs |
|---|---|---|
| `support_tickets` | `idx_support_tickets_user_id` | `SupportService.listOwnTickets` (`WHERE user_id`), `AdminUsersService` open-ticket counts |
| `support_tickets` | `idx_support_tickets_status` | `AdminSupportService.list`, `AdminDashboardService.openTicketCount` (`status IN ('open','in_progress')`) |
| `refunds` | `idx_refunds_status` | `WalletController.getPendingRefunds`, `AdminDashboardService.pendingRefundCount` (`status='pending'`) |
| `anticheat_reports` | `idx_anticheat_reports_flagged_review_status` | `AdminGamesService.listFlagged`, `AdminDashboardService.anticheatCount` (`flagged=true AND review_status='unreviewed'`) |

`support_tickets` had **zero indexes** beyond the primary key before this pass; the other two
tables only had the `user_id` column indexed while their admin review queues filter purely on
`status`. Each index uses `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (non-blocking on a live table)
and the schema declarations use `map:` names so `schema.prisma` and the database agree — the same
convention mismatch that leaves the pre-existing `idx_*` names from `0006` detached from Prisma's
default names is *not* repeated for the new indexes.

### Explicitly not added (no query uses them — no speculative indexes)

- `MutedUser(mutedId)` / `FavoriteOpponent(opponentId)` — all lookups are `findUnique` on the
  composite `(muterId, mutedId)` / `(userId, opponentId)`; no reverse-direction query exists.
- `FraudSignal(walletId)` — `walletId` is never filtered on.
- `Conversation(gameId)` — `gameId` is never queried.
- `Game(winnerId)` — no `winnerId`-only query exists.

---

## 2. Query Efficiency

**Verified: no N+1 patterns in the hot paths.**

- `WalletService.getTransactionHistory` — cursor pagination on `(walletId, createdAt)`, already
  indexed. The optional `search` filter uses `referenceId contains` (ILIKE `%…%`), which a b-tree
  cannot serve; acceptable for a per-user history scan (pg_trgm GIN is the only real fix, and not
  warranted at this scale).
- `MessagingService.listMessages` — single `findMany` with `include: { deliveryStatuses: true }`
  on `(conversationId, createdAt)`; no per-row queries.
- Leaderboard (`computeLeaderboard`) — 2 batched queries on `(gameMode, rating)`.
- `MessageDeliveryStatus`, `GameMove`, `Session` refresh lookups, `Report`, `KycDocument`,
  `DeviceFingerprint` multi-account queries — all match declared indexes.

---

## 3. Transactions & Concurrency

**Verified: money movement is concurrency-safe.**

- All balance-changing operations in `wallet.service.ts` run inside
  `runInSerializableTransaction` (custom helper at `prisma.service.ts:35` wrapping Prisma's
  `Serializable` isolation) with an `idempotencyKey` unique constraint, so concurrent deposits /
  settlement cannot double-spend or lose an update.
- `Wallet.version` is incremented on every mutation but **never read** as an optimistic-lock
  predicate — it is a vestigial column. The actual protection comes from serializable isolation,
  so this is cosmetic, not a bug. Documented; left in place (removal is out of scope).
- `AdminUsersService.ban`, session revocation, and wallet hold/release flows use `$transaction`.

### Documented, not changed (requires application-logic change)

- **Registration is not atomic** (`auth.service.ts:50,61,75` and OAuth path `:194,201`): `user.create`
  → `wallet.create` → `emailVerificationToken.create` are three separate statements. A failure
  between them leaves a user with no wallet/verification token. Fixing this means wrapping the
  writes in a `$transaction` (and moving the email send outside it) — a code change, flagged for
  the next code pass.

---

## 4. Data Integrity

- `email` and `phone` are `@unique` but Postgres uniqueness is **case-sensitive**: `Foo@x.com`
  and `foo@x.com` can both register. Normalizing to lowercase at write time (or a
  `lower(email)` unique index) is a behavior change — documented for a future code/data pass.
- String-documented enum values (e.g. `SupportTicket.status`, `Deposit.status`,
  `FraudSignal.signalType/status`, `AnticheatReport.reviewStatus`, `Refund.status`) are consistent
  across services (grep-verified vocabulary), but are `String` columns rather than Postgres
  `ENUM`/`CHECK` constraints. Converting requires a migration touching existing data — documented,
  not applied. No conflicting values were found in the live DB.
- Foreign keys use sensible `onDelete` (Restrict on wallet/withdrawal/deposit, Cascade on owned
  child rows, SetNull on admin reviewer references) — no orphan risk identified.

---

## 5. Security (DB layer)

- **No SQL injection surface**: zero `$queryRawUnsafe`/`$executeRawUnsafe`; all access is
  parameterized Prisma.
- Sensitive columns are appropriately stored: `Session.refreshTokenHash` (hash, unique),
  `PasswordResetToken.tokenHash`, `Withdrawal.payoutDetailsEncrypted` (`Bytes`),
  `DeviceFingerprint.rawSignals` (detector inputs, not secrets). `User.twoFactorSecret` is stored
  plaintext (encryption is deferred to KMS at prod per the column comment) — known, documented in
  the prior security pass.
- The new migration introduces no functions, triggers, or `SECURITY DEFINER` objects.

---

## Validation Evidence

- `npx prisma migrate deploy` initially fails `0013` (Prisma wraps migration files in a
  transaction; `CREATE INDEX CONCURRENTLY` cannot run inside one — this is why `0006` was applied
  the same way: per-statement execution + `migrate resolve --applied`). Applied each `CREATE INDEX
  CONCURRENTLY IF NOT EXISTS` individually via `prisma db execute`, then recorded `0013` as
  applied. `prisma migrate status` → **Database schema is up to date!** (12 migrations).
- All 4 indexes confirmed present via `pg_indexes` (`count = 4`).
- `npm run lint` clean, `npx tsc --noEmit` exit 0, `npm run build` exit 0.
- Live smoke test on `:3000`: `/health/ready` 200 (database + redis true); register 201, login
  201, `GET /users/me` 200, support-ticket create 201 / list 200 / detail 200 — the create/list
  round-trip exercises the newly indexed `support_tickets(user_id)` path.
- `prisma generate` could not run while the dev server holds `query_engine-windows.dll.node`
  (EPERM on Windows). **Not** caused by this change and index-only schema edits leave the generated
  client API identical — re-run `npx prisma generate` once the backend process is stopped.

---

## Scores

| Dimension | Score | Basis |
|---|---|---|
| **Database** | 92/100 | Schema well-designed (normalized, documented), enum-vs-string columns are the main deduction |
| **Performance** | 88/100 | All real query patterns indexed; ILIKE search and per-user scans are the residual items |
| **Scalability** | 85/100 | CONCURRENTLY migrations, cursor pagination, Redis presence; admin list endpoints lack pagination |
| **Integrity** | 86/100 | Serializable transactions + idempotency keys; registration non-atomicity and email case-sensitivity are the gaps |
| **Security** | 90/100 | No injection surface, hashed tokens; `twoFactorSecret` at rest and `change_me_*` dev JWT secrets carry over from the prior pass |
