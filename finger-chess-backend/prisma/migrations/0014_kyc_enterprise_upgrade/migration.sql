-- ============================================================================
-- MIGRATION 0014: KYC ENTERPRISE UPGRADE
-- ============================================================================
-- Enriches the identity-verification record with the file metadata admins
-- need to triage a queue entry (what was uploaded, when, and what format)
-- without pulling the object from S3, plus a dedicated internal-review-notes
-- column. Every new column is nullable so the migration is purely additive
-- and non-breaking for existing rows.

ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS file_size INTEGER;
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS mime_type VARCHAR(64);
ALTER TABLE kyc_documents ADD COLUMN IF NOT EXISTS notes VARCHAR(2000);

-- ============================================================================
-- END OF MIGRATION 0014
-- ============================================================================
