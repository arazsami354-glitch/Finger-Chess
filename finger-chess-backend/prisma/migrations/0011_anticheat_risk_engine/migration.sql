-- ============================================================================
-- MIGRATION 0011: ANTI-CHEAT / RISK ENGINE
-- ============================================================================

-- Widen the penalty type/category CHECK constraints — VARCHAR(20) already
-- comfortably fits both new values, only the allowed-value lists change.
ALTER TABLE penalty_records DROP CONSTRAINT IF EXISTS chk_penalty_type;
ALTER TABLE penalty_records ADD CONSTRAINT chk_penalty_type
    CHECK (penalty_type IN ('warning', 'suspension', 'chat_mute'));

ALTER TABLE penalty_records DROP CONSTRAINT IF EXISTS chk_penalty_category;
ALTER TABLE penalty_records ADD CONSTRAINT chk_penalty_category
    CHECK (category IN ('cheating', 'chat_abuse', 'fraud', 'other'));

-- ============================================================================
-- DEVICE FINGERPRINTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS device_fingerprints (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fingerprint_hash  VARCHAR(64) NOT NULL,
    raw_signals       JSONB NOT NULL,
    ip_address        INET NOT NULL,
    user_agent        VARCHAR(500) NOT NULL,
    tamper_flags      TEXT[] NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_device_fingerprints_user_id ON device_fingerprints(user_id);
-- The core multi-account query: "which OTHER users share this exact
-- fingerprint hash" — this index is what keeps that query fast as the
-- table grows into the millions of rows.
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_hash ON device_fingerprints(fingerprint_hash);
-- The core shared-IP query: "how many distinct users have logged in from
-- this IP recently" — the VPN/proxy-adjacent heuristic.
CREATE INDEX IF NOT EXISTS idx_device_fingerprints_ip_created ON device_fingerprints(ip_address, created_at);

-- ============================================================================
-- END OF MIGRATION 0011
-- ============================================================================
