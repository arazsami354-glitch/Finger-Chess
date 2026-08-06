-- ============================================================================
-- MIGRATION 0008: COMPLIANCE — age, KYC documents, platform rules, penalties
-- ============================================================================

-- 1. User fields: age (stored as date of birth) and the chat-mute fast path.
ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_muted_until TIMESTAMPTZ;

-- ============================================================================
-- KYC DOCUMENTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS kyc_documents (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    document_type          VARCHAR(20) NOT NULL,
    storage_key            TEXT NOT NULL,
    status                 VARCHAR(10) NOT NULL DEFAULT 'pending',
    rejection_reason       VARCHAR(500),
    provider               VARCHAR(50) NOT NULL DEFAULT 'manual',
    provider_reference_id  VARCHAR(255),
    provider_response      JSONB,
    reviewed_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at            TIMESTAMPTZ,
    submitted_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
    CONSTRAINT chk_kyc_document_type CHECK (document_type IN ('passport', 'national_id', 'drivers_license', 'health_card')),
    CONSTRAINT chk_kyc_document_status CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_kyc_documents_user_id ON kyc_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_documents_status ON kyc_documents(status);

-- ============================================================================
-- PLATFORM RULE ACCEPTANCE
-- ============================================================================

CREATE TABLE IF NOT EXISTS rule_acceptances (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    version     VARCHAR(20) NOT NULL,
    accepted_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    ip_address  INET,
    CONSTRAINT uq_rule_acceptance_user_version UNIQUE (user_id, version)
);

-- ============================================================================
-- PENALTY RECORDS (suspension history + chat-mute history, unified)
-- ============================================================================

CREATE TABLE IF NOT EXISTS penalty_records (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    penalty_type   VARCHAR(20) NOT NULL,
    category       VARCHAR(20) NOT NULL DEFAULT 'other',
    reason         VARCHAR(500) NOT NULL,
    duration_hours INTEGER,
    started_at     TIMESTAMPTZ DEFAULT now() NOT NULL,
    ends_at        TIMESTAMPTZ,
    issued_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    lifted_at      TIMESTAMPTZ,
    lifted_by      UUID REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT chk_penalty_type CHECK (penalty_type IN ('suspension', 'chat_mute')),
    CONSTRAINT chk_penalty_category CHECK (category IN ('cheating', 'chat_abuse', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_penalty_records_user_type ON penalty_records(user_id, penalty_type);
CREATE INDEX IF NOT EXISTS idx_penalty_records_ends_at ON penalty_records(ends_at);

-- ============================================================================
-- END OF MIGRATION 0008
-- ============================================================================
