-- ============================================================================
-- MIGRATION 0021: SOCIAL SYSTEM — WIDEN PRESENCE STATUS + REPORT CATEGORY
-- ============================================================================
--
-- Two 0007-era constraints were written before the social system reached its
-- full surface area, and both now reject legitimate writes:
--
--   1. user_presence_snapshots.status was VARCHAR(10) with chk_presence_status
--      allowing only online/away/in_game/offline. PresenceService persists its
--      full 8-state model (online, away, in_game, in_tournament, spectating,
--      do_not_disturb, invisible, offline) on status transitions, so setting
--      do_not_disturb or invisible manually (or an in_tournament/spectating
--      auto-state) threw a CHECK/length violation on the fallback snapshot
--      write — surfacing as a failed status change / game-context transition.
--
--   2. reports.category CHECK (chk_report_category) lacked match_manipulation,
--      even though the send-match-invitation DTO, ReportService, the players
--      page dialog and schema.prisma all accept it — so a legitimate match
--      manipulation report was rejected at the DB layer.
--
-- Both are widened in place; every existing row is already within the new
-- bounds, so no data repair is needed.

ALTER TABLE user_presence_snapshots
    ALTER COLUMN status TYPE VARCHAR(20);

ALTER TABLE user_presence_snapshots
    DROP CONSTRAINT IF EXISTS chk_presence_status;

ALTER TABLE user_presence_snapshots
    ADD CONSTRAINT chk_presence_status CHECK (status IN ('online', 'away', 'in_game', 'in_tournament', 'spectating', 'do_not_disturb', 'invisible', 'offline'));

ALTER TABLE reports
    DROP CONSTRAINT IF EXISTS chk_report_category;

ALTER TABLE reports
    ADD CONSTRAINT chk_report_category CHECK (category IN ('harassment', 'spam', 'impersonation', 'cheating', 'match_manipulation', 'inappropriate_content', 'other'));

-- ============================================================================
-- END OF MIGRATION 0021
-- ============================================================================
