-- ============================================================================
-- MIGRATION 0013: SUPPORT / REFUND / ANTICHEAT QUERY INDEXES
-- ============================================================================
-- Mirrors the 0006 convention: every index backs a query pattern that
-- actually exists in the codebase today (grep the referenced service in each
-- comment) rather than being added speculatively. Uses CONCURRENTLY so this
-- can run against a live production table without holding a lock that blocks
-- reads and writes for the duration of the build -- each statement must run
-- in its own transaction (CONCURRENTLY cannot run inside one), which is why
-- this file is NOT wrapped in a single BEGIN/COMMIT the way earlier
-- migrations were.

-- support_tickets had ZERO indexes beyond the primary key:
--   * SupportService.listOwnTickets            -> WHERE user_id = ?
--   * AdminSupportService.list                 -> WHERE status/priority/assigned_to
--   * AdminUsersService (user detail counts)   -> WHERE user_id AND status IN (...)
--   * AdminDashboardService.openTicketCount    -> WHERE status IN ('open','in_progress')
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);

-- refunds only had user_id:
--   * WalletController.getPendingRefunds       -> WHERE status = 'pending'
--   * AdminDashboardService.pendingRefundCount -> WHERE status = 'pending'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_refunds_status ON refunds(status);

-- anticheat_reports only had flagged:
--   * AdminGamesService.listFlagged            -> WHERE flagged = true AND review_status = 'unreviewed'
--   * AdminDashboardService.anticheatCount     -> WHERE flagged = true AND review_status = 'unreviewed'
-- The composite serves that exact query shape in a single scan (the existing
-- single-column flagged index still backs any flagged-only reads).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_anticheat_reports_flagged_review_status
    ON anticheat_reports(flagged, review_status);

-- ============================================================================
-- END OF MIGRATION 0013
-- ============================================================================
