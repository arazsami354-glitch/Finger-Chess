-- ============================================================================
-- MIGRATION 0007: SOCIAL SYSTEM
-- ============================================================================

-- 1. User profile/presence-fallback fields.
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(300);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- ============================================================================
-- FRIEND REQUESTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS friend_requests (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    receiver_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status       VARCHAR(10) NOT NULL DEFAULT 'pending',
    created_at   TIMESTAMPTZ DEFAULT now() NOT NULL,
    responded_at TIMESTAMPTZ,
    CONSTRAINT chk_friend_request_status CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
    CONSTRAINT chk_friend_request_not_self CHECK (sender_id <> receiver_id),
    CONSTRAINT uq_friend_request_pair UNIQUE (sender_id, receiver_id)
);

CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_status ON friend_requests(receiver_id, status);

-- Only one PENDING request per direction — a partial unique index, since a
-- plain UNIQUE(sender_id, receiver_id) would block re-requesting after a
-- decline/cancel, which is a normal, legitimate flow.
CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_request_pending
    ON friend_requests(sender_id, receiver_id) WHERE status = 'pending';

-- ============================================================================
-- FRIENDSHIPS (accepted relationship, one row per pair, ever)
-- ============================================================================

CREATE TABLE IF NOT EXISTS friendships (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_b_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_friendship_ordered CHECK (user_a_id < user_b_id), -- canonical ordering enforced at the DB layer, not just app logic
    CONSTRAINT uq_friendship_pair UNIQUE (user_a_id, user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships(user_b_id);

-- ============================================================================
-- BLOCKED / MUTED USERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS blocked_users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason     VARCHAR(300),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_block_not_self CHECK (blocker_id <> blocked_id),
    CONSTRAINT uq_block_pair UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);

CREATE TABLE IF NOT EXISTS muted_users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    muter_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    muted_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_mute_not_self CHECK (muter_id <> muted_id),
    CONSTRAINT uq_mute_pair UNIQUE (muter_id, muted_id)
);

-- ============================================================================
-- CONVERSATIONS / MESSAGES / DELIVERY STATUS
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type            VARCHAR(10) NOT NULL DEFAULT 'direct',
    game_id         UUID,
    last_message_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_conversation_type CHECK (type IN ('direct', 'game'))
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC);

CREATE TABLE IF NOT EXISTS conversation_participants (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id       UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_message_id  UUID,
    last_read_at          TIMESTAMPTZ,
    is_muted              BOOLEAN DEFAULT FALSE NOT NULL,
    joined_at             TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_conversation_participant UNIQUE (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants(user_id);

CREATE TABLE IF NOT EXISTS messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content_type    VARCHAR(10) NOT NULL DEFAULT 'text',
    content         TEXT NOT NULL,
    is_flagged      BOOLEAN DEFAULT FALSE NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    edited_at       TIMESTAMPTZ,
    deleted_at      TIMESTAMPTZ,
    CONSTRAINT chk_message_content_type CHECK (content_type IN ('text', 'system'))
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);

-- Now that conversation_participants.last_read_message_id references a
-- real table, attach the FK (deferred to here since messages didn't exist
-- yet when conversation_participants was created above).
ALTER TABLE conversation_participants
    ADD CONSTRAINT fk_conversation_participants_last_read
    FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS message_delivery_statuses (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status     VARCHAR(10) NOT NULL DEFAULT 'sent',
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_delivery_status CHECK (status IN ('sent', 'delivered', 'read')),
    CONSTRAINT uq_message_delivery_recipient UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_delivery_user_status ON message_delivery_statuses(user_id, status);

-- ============================================================================
-- PRESENCE (durable fallback snapshot — live state is Redis)
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_presence_snapshots (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    status       VARCHAR(10) NOT NULL DEFAULT 'offline',
    last_seen_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_presence_status CHECK (status IN ('online', 'away', 'in_game', 'offline'))
);

-- ============================================================================
-- ACHIEVEMENTS / BADGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS achievements (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    icon        VARCHAR(50) NOT NULL,
    criteria    JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id UUID NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
    unlocked_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_user_achievement UNIQUE (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS badges (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code        VARCHAR(50) NOT NULL UNIQUE,
    name        VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    icon        VARCHAR(50) NOT NULL,
    tier        VARCHAR(20) NOT NULL DEFAULT 'standard',
    created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    badge_id   UUID NOT NULL REFERENCES badges(id) ON DELETE CASCADE,
    awarded_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT uq_user_badge UNIQUE (user_id, badge_id)
);

-- ============================================================================
-- FAVORITE OPPONENTS / PRIVACY SETTINGS / USER ACTIVITY
-- ============================================================================

CREATE TABLE IF NOT EXISTS favorite_opponents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    opponent_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_favorite_not_self CHECK (user_id <> opponent_id),
    CONSTRAINT uq_favorite_opponent UNIQUE (user_id, opponent_id)
);

CREATE TABLE IF NOT EXISTS privacy_settings (
    user_id                  UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    who_can_message          VARCHAR(20) NOT NULL DEFAULT 'friends',
    who_can_friend_request   VARCHAR(20) NOT NULL DEFAULT 'everyone',
    show_online_status       BOOLEAN NOT NULL DEFAULT TRUE,
    show_profile_stats       BOOLEAN NOT NULL DEFAULT TRUE,
    allow_friend_suggestions BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_who_can_message CHECK (who_can_message IN ('everyone', 'friends', 'none')),
    CONSTRAINT chk_who_can_friend_request CHECK (who_can_friend_request IN ('everyone', 'friends_of_friends', 'none'))
);

CREATE TABLE IF NOT EXISTS user_activities (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_type VARCHAR(50) NOT NULL,
    metadata      JSONB,
    visibility    VARCHAR(10) NOT NULL DEFAULT 'friends',
    created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_activity_visibility CHECK (visibility IN ('public', 'friends', 'private'))
);

CREATE INDEX IF NOT EXISTS idx_user_activities_user_created ON user_activities(user_id, created_at DESC);

-- ============================================================================
-- REPORTS (messages and/or players)
-- ============================================================================

CREATE TABLE IF NOT EXISTS reports (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reported_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    category            VARCHAR(30) NOT NULL,
    description         VARCHAR(1000),
    status              VARCHAR(20) NOT NULL DEFAULT 'open',
    reviewed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_report_not_self CHECK (reporter_id <> reported_user_id),
    CONSTRAINT chk_report_category CHECK (category IN ('harassment', 'spam', 'impersonation', 'cheating', 'inappropriate_content', 'other')),
    CONSTRAINT chk_report_status CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS idx_reports_reported_user_status ON reports(reported_user_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);

-- ============================================================================
-- END OF MIGRATION 0007
-- ============================================================================
