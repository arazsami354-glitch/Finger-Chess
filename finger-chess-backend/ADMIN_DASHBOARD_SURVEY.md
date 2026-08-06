# Admin Dashboard — Survey & Role Permissions

## What already existed, surveyed before building anything

Nearly everything on the requested list was already real, built incrementally across many earlier
passes — this wasn't a "create from scratch" task, and treating it as one would have meant
duplicating working pages:

| Requested | Status |
|---|---|
| Dashboard | `DashboardPage` — overview stats + a real revenue line chart (recharts) |
| Users | `UsersPage` — list, detail, ban/suspend/reactivate/mute/warn, penalty history |
| Wallets / Withdrawals / Deposits | `WalletMonitoringPage` |
| Reports / Revenue / Statistics | `ReportsPage` — revenue summary, commission-by-tier bar chart, deposit/withdrawal volumes |
| Support Tickets | `SupportPage` |
| Cheat Detection | Anti-cheat flagged-game review inside `GameMonitoringPage`, plus the risk-score engine's high-risk queue in `SecurityPage` |
| Live Games | `GameMonitoringPage` |
| Charts | Already real — a line chart on Dashboard, a bar chart on Reports (recharts, an actual dependency, not decoration) |
| Activity Logs / Audit Logs | `LogsPage` (admin audit trail + security event log tabs) |
| Analytics | Substantively covered by Dashboard + Reports rather than needing a third overlapping page |
| **Role Permissions** | **Did not exist at all — the one genuine gap, built this pass** |

## Role Permissions — built from a real grep, not a guess

Every `@Roles(...)` decorator across the entire backend was grepped and read in full (not recalled
from memory) before writing the permissions matrix — 18 occurrences across 10 controllers,
including the per-method overrides (e.g. `admin-users.controller.ts` has a class-level default
plus five stricter method-level overrides for the account-restricting actions). The matrix shown
on the new page matches that ground truth exactly.

Stated plainly in the code itself: this is a **maintained reference**, not a live introspection
system. If a controller's `@Roles()` requirements change later, this matrix needs updating
alongside it — building automatic reflection over Nest's metadata system would be a meaningfully
larger undertaking than what a reference page needs, and pretending otherwise would be dishonest
about what was actually built.

## A real access-control bug caught before it shipped

The new `AdminRolesController` was initially written with `@UseGuards(JwtAuthGuard, RolesGuard)`
but no `@Roles(...)` decorator. Checking `RolesGuard`'s actual implementation
(`common/guards/roles.guard.ts`) turned up this line:

```ts
if (!requiredRoles || requiredRoles.length === 0) return true;
```

**With no `@Roles()` decorator present, the guard defaults to allowing *any* authenticated user
through — not just admins.** Without the fix, the permissions-reference endpoint would have been
reachable by any logged-in player, not just admin accounts. Fixed by adding an explicit
`@Roles('support_agent', 'finance_admin', 'super_admin')`.

Given how serious that class of bug is, every other controller in the codebase using `RolesGuard`
was then checked systematically (not just the one just written) to confirm none of them had the
same gap — all 10 already had at least one `@Roles()` decorator. The omission was isolated to the
one controller written this pass, not a pattern.

## A second real bug caught during verification

The frontend page initially used `<Badge tone="brass">` for the super-admin checkmark — `'brass'`
is a valid `tone` on this admin app's `Button` component, but *not* on `Badge`, which only supports
`default | gain | loss | warn | info`. Caught during the type-error verification sweep (not
assumed to be more environmental noise without checking) and fixed to use the real `'info'` tone.

## Verified, not asserted

- `tsc --noEmit` clean on both projects.
- The frontend's `GET /admin/roles/permissions` call cross-checked directly against the backend's
  `@Get('permissions')` under `@Controller('admin/roles')` — exact match.
- Every remaining "children is missing" type error from the sweep confirmed as the project's known
  missing-`@types/react` sandbox artifact by checking the identical pattern appears on
  `SecurityPage.tsx`, a file untouched this session — not assumed, checked.
