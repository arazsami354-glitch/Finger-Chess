-- ============================================================================
-- MIGRATION 0020: NOTIFICATION CENTER
-- ============================================================================
-- Upgrades `notifications` for a production Notification Center:
--   * group_key/count  — "similar notifications" merge into one unread row
--   * read_at          — when the row was marked read (is_read stays for compat)
--   * action_url       — deep-link target when a user clicks the item
--   * actor_name       — display name of the actor (friend request sender, etc.)
--   * new indexes      — cursor pagination + grouped-unread merge lookup
-- Also introduces `notification_preferences` (per-category opt-outs, sound,
-- desktop delivery). The table was originally created via `prisma db push`, so
-- every column here is written idempotently (IF NOT EXISTS) like the rest of
-- the hand-rolled migrations in this folder.

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS group_key TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_name TEXT;

-- Cursor pagination: list(user_id, ORDER BY created_at DESC). The existing
-- (user_id, is_read) index already backs the unread-count query.
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
-- Grouped unread-merge: WHERE user_id = ? AND group_key = ? AND NOT is_read.
CREATE INDEX IF NOT EXISTS idx_notifications_user_group_read ON notifications(user_id, group_key, is_read);

-- ----------------------------------------------------------------------------
-- Notification preferences (one row per user, created on first save)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
    id              TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    categories      JSONB NOT NULL DEFAULT '{}'::jsonb,
    sound_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
    desktop_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============================================================================
-- END OF MIGRATION 0020
-- ============================================================================
