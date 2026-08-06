-- ============================================================================
-- MIGRATION 0006: PERFORMANCE INDEXES
-- ============================================================================
-- Every index below backs a query pattern that actually exists in the
-- codebase today (grep the referenced service/controller in each comment)
-- rather than being added speculatively. Uses CONCURRENTLY so this can run
-- against a live production table without holding a lock that blocks reads
-- and writes for the duration of the build — each statement must run in
-- its own transaction (CONCURRENTLY cannot run inside one), which is why
-- this file is NOT wrapped in a single BEGIN/COMMIT the way earlier
-- migrations were.

-- games: status filters run on nearly every admin/matchmaking/dashboard
-- query (AdminGamesService.list/listLive, MatchmakingService.assertNoActiveGame).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_status ON games(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_player_white_id ON games(player_white_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_player_black_id ON games(player_black_id);
-- AdminReportsService.getRevenueSummary/getCommissionByTier/getRevenueTimeSeries
-- all filter status='completed' AND endedAt BETWEEN ? AND ? — composite
-- index lets Postgres satisfy both the equality and range filter in one scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_status_ended_at ON games(status, ended_at);

-- wallet_transactions: every transaction-history read (WalletService.
-- getTransactionHistory, WalletController /wallet/transactions) is
-- WHERE wallet_id = ? ORDER BY created_at DESC — the old single-column
-- wallet_id index made Postgres sort the result set after the fact instead
-- of walking the index in the already-correct order.
DROP INDEX CONCURRENTLY IF EXISTS idx_wtxn_wallet_id;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wtxn_wallet_id_created_at ON wallet_transactions(wallet_id, created_at DESC);
-- AccountingService.reconcileWallet aggregates by status='completed' AND type IN (...).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_wtxn_status_type ON wallet_transactions(status, type);

-- deposits / withdrawals had ZERO indexes beyond their unique constraints
-- before this migration — every admin pending-review query and every
-- financial report was a full table scan on these two tables.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deposits_user_id ON deposits(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_deposits_status_completed_at ON deposits(status, completed_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_withdrawals_status ON withdrawals(status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_withdrawals_status_processed_at ON withdrawals(status, processed_at);

-- notifications: every notification-list read is WHERE user_id = ? AND
-- is_read = ? — had no index at all.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_user_id_is_read ON notifications(user_id, is_read);

-- ============================================================================
-- END OF MIGRATION 0006
-- ============================================================================
