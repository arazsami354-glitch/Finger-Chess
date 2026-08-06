-- ============================================================================
-- MIGRATION 0012: RATING SYSTEM (peak rating + history)
-- ============================================================================
-- Player ratings previously never actually updated after a game — every
-- account sat at the 1200 default permanently. This migration is the
-- database side of finally closing that gap (see RatingService): a real
-- post-game rating update needs somewhere to record the peak (distinct
-- from "current," which can go up AND down) and a history of every change
-- (what a rating-over-time graph actually plots).

ALTER TABLE ratings ADD COLUMN IF NOT EXISTS peak_rating INTEGER NOT NULL DEFAULT 1200;

-- Backfill: for any rating that's already drifted from 1200 by whatever
-- mechanism existed before this migration, peak should never start out
-- LOWER than the current value.
UPDATE ratings SET peak_rating = rating WHERE rating > peak_rating;

CREATE TABLE IF NOT EXISTS rating_history (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_mode  VARCHAR(20) NOT NULL,
    rating     INTEGER NOT NULL,
    game_id    UUID REFERENCES games(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rating_history_user_mode_created ON rating_history(user_id, game_mode, created_at);

-- ============================================================================
-- END OF MIGRATION 0012
-- ============================================================================
