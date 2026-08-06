-- ============================================================================
-- MIGRATION 0017: FRIENDS — DROP FULL UNIQUE ON FRIEND REQUESTS
-- ============================================================================
--
-- 0007 added BOTH a full UNIQUE(sender_id, receiver_id) constraint and a
-- partial unique index (sender_id, receiver_id) WHERE status = 'pending'.
-- The full constraint directly contradicts the intended semantics documented
-- in 0007 ("a plain UNIQUE(sender_id, receiver_id) would block re-requesting
-- after a decline/cancel, which is a normal, legitimate flow") and made any
-- re-request after an accept/decline/cancel/remove throw a P2002 (500).
--
-- Fix: drop the full constraint. The partial index continues to enforce the
-- real rule — at most ONE pending request per direction — while still
-- allowing a fresh request once the previous one has been resolved.

ALTER TABLE friend_requests DROP CONSTRAINT IF EXISTS uq_friend_request_pair;

-- Safety: the partial index must exist for the invariant to hold.
CREATE UNIQUE INDEX IF NOT EXISTS uq_friend_request_pending
    ON friend_requests(sender_id, receiver_id) WHERE status = 'pending';
