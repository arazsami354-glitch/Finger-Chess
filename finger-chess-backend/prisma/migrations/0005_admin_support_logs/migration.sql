-- ============================================================================
-- MIGRATION 0005: ADMIN DASHBOARD — moderation fields, support threads, logs
-- ============================================================================

-- 1. User moderation fields (ban/suspend tracking).
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_until TIMESTAMPTZ;

-- ============================================================================
-- SUPPORT TICKET MESSAGES — threaded replies (user <-> admin)
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_ticket_messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    sender_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sender_type     VARCHAR(10) NOT NULL, -- 'user' | 'admin'
    message         TEXT NOT NULL,
    attachment_url  TEXT,
    created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_sender_type CHECK (sender_type IN ('user', 'admin'))
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON support_ticket_messages(ticket_id);

-- ============================================================================
-- ADMIN LOGS — immutable audit trail of every admin action
-- ============================================================================

CREATE TABLE IF NOT EXISTS admin_logs (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    action      VARCHAR(100) NOT NULL,
    target_type VARCHAR(50) NOT NULL,
    target_id   UUID,
    old_value   JSONB,
    new_value   JSONB,
    ip_address  INET,
    created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_logs_admin_id ON admin_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_target ON admin_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_admin_logs_created_at ON admin_logs(created_at);

-- ============================================================================
-- SECURITY LOGS
-- ============================================================================

CREATE TABLE IF NOT EXISTS security_logs (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type          VARCHAR(50) NOT NULL,
    ip_address          INET,
    user_agent          TEXT,
    device_fingerprint  VARCHAR(255),
    metadata            JSONB,
    created_at          TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_event_type ON security_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs(created_at);

-- ============================================================================
-- END OF MIGRATION 0005
-- ============================================================================
