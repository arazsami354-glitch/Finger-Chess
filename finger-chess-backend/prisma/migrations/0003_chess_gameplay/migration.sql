-- ============================================================================
-- MIGRATION 0003: CHESS GAMEPLAY — anti-cheat reports
-- ============================================================================

CREATE TABLE IF NOT EXISTS anticheat_reports (
    id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id                        UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id                        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    average_centipawn_loss         DOUBLE PRECISION NOT NULL,
    top_engine_move_match_percent  DOUBLE PRECISION NOT NULL,
    moves_analyzed                 INTEGER NOT NULL,
    suspicion_score                DOUBLE PRECISION NOT NULL, -- 0-100, higher = more suspicious
    flagged                        BOOLEAN DEFAULT FALSE NOT NULL,
    review_status                  VARCHAR(20) DEFAULT 'unreviewed' NOT NULL, -- 'unreviewed' | 'reviewed_clean' | 'confirmed_cheating'
    reviewed_by                    UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at                     TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_anticheat_game_user UNIQUE (game_id, user_id),
    CONSTRAINT chk_anticheat_review_status CHECK (review_status IN ('unreviewed', 'reviewed_clean', 'confirmed_cheating'))
);

CREATE INDEX IF NOT EXISTS idx_anticheat_flagged ON anticheat_reports(flagged);
CREATE INDEX IF NOT EXISTS idx_anticheat_user_id ON anticheat_reports(user_id);

-- ============================================================================
-- END OF MIGRATION 0003
-- ============================================================================
