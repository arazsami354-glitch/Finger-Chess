-- ============================================================================
-- MIGRATION 0022: WALLET/SECURITY AUDIT QUERY INDEXES
-- ============================================================================
-- Mirrors the 0006/0013 convention: every index backs a query pattern that
-- actually exists in the codebase today (grep the referenced service in each
-- comment) rather than being added speculatively.
--
-- NOTE: deliberately uses plain CREATE INDEX (no CONCURRENTLY) — Prisma
-- Migrate executes each migration inside a transaction block, and CREATE
-- INDEX CONCURRENTLY is not allowed inside a transaction (error 25001).
-- 0013's CONCURRENTLY only worked because it was applied outside the
-- migrate-deploy path; this file must deploy via `prisma migrate deploy`.

-- games previously had no winner_id index (only player_white_id/player_black_id):
--   * AchievementsService.countWins            -> WHERE winner_id = ? AND status = 'completed'
--   * profile win/loss statistics              -> WHERE winner_id = ?
CREATE INDEX IF NOT EXISTS games_winner_id_status_idx ON games(winner_id, status);

-- anticheat_reports previously had no user_id index:
--   * FairPlayDetectorService (recent reports) -> WHERE user_id = ? ORDER BY created_at DESC
--   * RiskScoreService                         -> WHERE user_id = ?
--   * AdminUsersService / AdminFairplayService -> WHERE user_id = ?
CREATE INDEX IF NOT EXISTS anticheat_reports_user_id_created_at_idx ON anticheat_reports(user_id, created_at);

-- ============================================================================
-- END OF MIGRATION 0022
-- ============================================================================
