-- ============================================================================
-- MIGRATION 0004: MATCHMAKING — ratings table
-- ============================================================================
-- Was previously only in the standalone schema.sql reference; added here to
-- the live Prisma-tracked schema since matchmaking depends on it directly.

CREATE TABLE IF NOT EXISTS ratings (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_mode           VARCHAR(20) NOT NULL,              -- 'bullet' | 'blitz' | 'rapid' | 'classical'
    rating              INTEGER DEFAULT 1200 NOT NULL,
    rating_deviation    DOUBLE PRECISION DEFAULT 350 NOT NULL,
    volatility          DOUBLE PRECISION DEFAULT 0.06 NOT NULL,
    games_played        INTEGER DEFAULT 0 NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_ratings_user_mode UNIQUE (user_id, game_mode)
);

CREATE INDEX IF NOT EXISTS idx_ratings_mode_rating ON ratings(game_mode, rating DESC); -- fast leaderboards / matchmaking band queries

-- ============================================================================
-- END OF MIGRATION 0004
-- ============================================================================
