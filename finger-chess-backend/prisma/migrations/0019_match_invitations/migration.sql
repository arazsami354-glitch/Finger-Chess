-- ============================================================================
-- MIGRATION 0019: MATCH INVITATIONS + rated flag on games
-- ============================================================================

-- 'rated' gates Elo updates at settlement. Quick play and friend challenges
-- both let a player choose Rated or Casual; a casual game must never move
-- ratings. Defaults to TRUE so all pre-existing games keep their rated
-- semantics (matchmaking was always rated).
ALTER TABLE games ADD COLUMN IF NOT EXISTS rated BOOLEAN DEFAULT TRUE NOT NULL;

-- ============================================================================
-- MATCH INVITATIONS (friend challenges)
-- ============================================================================

CREATE TABLE IF NOT EXISTS match_invitations (
    id               TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    time_control_id  VARCHAR(40) NOT NULL,
    entry_fee        DECIMAL(18,2) NOT NULL DEFAULT 0,
    rated            BOOLEAN NOT NULL DEFAULT TRUE,
    color_preference VARCHAR(10) NOT NULL DEFAULT 'random',
    message          VARCHAR(300),
    status           VARCHAR(10) NOT NULL DEFAULT 'pending',
    game_id          TEXT REFERENCES games(id) ON DELETE SET NULL,
    expires_at       TIMESTAMPTZ NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
    responded_at     TIMESTAMPTZ,
    CONSTRAINT chk_invitation_status CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
    CONSTRAINT chk_invitation_color CHECK (color_preference IN ('random', 'white', 'black')),
    CONSTRAINT chk_invitation_not_self CHECK (sender_id <> recipient_id)
);

-- Backs the invitation-center queries (incoming / outgoing pending) and the
-- expiry sweep (status = 'pending' AND expires_at < now()).
CREATE INDEX IF NOT EXISTS idx_match_invitations_recipient_status ON match_invitations(recipient_id, status);
CREATE INDEX IF NOT EXISTS idx_match_invitations_sender_status ON match_invitations(sender_id, status);

-- Only one PENDING challenge per (sender, recipient) pair at a time — mirrors
-- the friend_requests partial unique index so a resolved challenge can be
-- followed by a fresh one. Cross-direction duplicates (A->B while B->A is
-- pending) are rejected in the service layer; the service ALSO guards the
-- race with its own pending-pair read before create.
CREATE UNIQUE INDEX IF NOT EXISTS uq_match_invitation_pending
    ON match_invitations(sender_id, recipient_id) WHERE status = 'pending';

-- ============================================================================
-- END OF MIGRATION 0019
-- ============================================================================
