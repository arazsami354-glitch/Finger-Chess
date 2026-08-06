-- ============================================================================
-- MIGRATION 0018: FRIENDS — DROP STRAY FULL-UNIQUE INDEX, RESTORE NOT-SELF CHECK
-- ============================================================================
--
-- 0017 dropped the `uq_friend_request_pair` constraint, but the live table
-- also carried a Prisma-generated unique index named
-- `friend_requests_sender_id_receiver_id_key` (created when FriendRequest
-- still declared @@unique([senderId, receiverId])). It enforces the same
-- full-pair uniqueness and equally blocks re-requesting after a
-- decline/cancel/remove (P2002 -> 500). Drop it too; the partial unique index
-- (pending only) is the correct enforcement.
DROP INDEX IF EXISTS friend_requests_sender_id_receiver_id_key;

-- 0007 declared `chk_friend_request_not_self CHECK (sender_id <> receiver_id)`,
-- but the live table predates the migration system and `CREATE TABLE IF NOT
-- EXISTS` never re-added it. The service rejects self-requests (400) today;
-- this restores the intended DB-level guard (defense in depth).
DELETE FROM friend_requests WHERE sender_id = receiver_id;
ALTER TABLE friend_requests ADD CONSTRAINT chk_friend_request_not_self CHECK (sender_id <> receiver_id);
