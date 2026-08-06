-- ============================================================================
-- MIGRATION 0010: KYC VERIFICATION UPGRADE
-- ============================================================================
-- Adds a "Needs More Information" status distinct from a hard rejection —
-- lets an admin ask for a clearer photo/a missing corner/etc. without
-- forcing a full reject-and-restart cycle. Also adds preferred_id_type,
-- collected at registration, so the KYC upload page can pre-select a
-- sensible default document type in a brand new session rather than only
-- ever remembering it as transient client-side form state.

-- users.kyc_status had no CHECK constraint in the original schema (enforced
-- at the Prisma/application layer only) — only a width check is needed.
-- Widened unconditionally to VARCHAR(20): a widen-only ALTER is always
-- safe/idempotent regardless of the column's exact original width, and
-- 'needs_more_info' (16 chars) needs more room than 'not_submitted' (14)
-- already required.
ALTER TABLE users ALTER COLUMN kyc_status TYPE VARCHAR(20);

ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_id_type VARCHAR(20);
ALTER TABLE users ADD CONSTRAINT chk_users_preferred_id_type
    CHECK (preferred_id_type IS NULL OR preferred_id_type IN ('passport', 'national_id', 'drivers_license', 'health_card'));

-- kyc_documents.status was VARCHAR(10) — too narrow for 'needs_more_info'.
ALTER TABLE kyc_documents ALTER COLUMN status TYPE VARCHAR(20);
ALTER TABLE kyc_documents DROP CONSTRAINT IF EXISTS chk_kyc_document_status;
ALTER TABLE kyc_documents ADD CONSTRAINT chk_kyc_document_status
    CHECK (status IN ('pending', 'needs_more_info', 'approved', 'rejected'));

-- ============================================================================
-- END OF MIGRATION 0010
-- ============================================================================
