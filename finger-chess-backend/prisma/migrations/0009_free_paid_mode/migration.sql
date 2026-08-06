-- ============================================================================
-- MIGRATION 0009: FREE PLAY / REAL MONEY MODE SUPPORT
-- ============================================================================
--
-- No new column is added here. "Free" vs "Paid" has always been fully and
-- unambiguously derivable from the existing `entry_fee` column (0 = free,
-- >0 = paid) — every place that now needs to distinguish the two modes
-- (admin game filters, the dashboard's active-games breakdown, player
-- profile stats) queries `entry_fee` directly rather than a redundant
-- boolean that could drift out of sync with it. This migration only adds
-- the index those new queries need to stay fast at scale.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_games_status_entry_fee ON games(status, entry_fee);

-- ============================================================================
-- END OF MIGRATION 0009
-- ============================================================================
