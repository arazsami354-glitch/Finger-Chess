# Finger Chess — Social System

Real-time social layer: friends, DMs, presence, notifications, achievements/badges, and moderation.

## Architecture

Single WebSocket namespace, `/social`, handling presence + chat + typing + delivery receipts in
one connection per client — deliberately not split into per-concern namespaces the way `/game` and
`/matchmaking` are, since a chat message and a presence update are cheap enough that the overhead
of a second socket per client isn't worth it at "millions of concurrent users" scale.

**`SocialRealtimeService`** (`social/realtime/`) is the key decoupling piece: every service that
needs to push a live update (a friend request, a new message, an achievement unlock) calls
`emitToUser()` on this shared service instead of holding a reference to the gateway. That's what
makes REST-triggered actions (a friend request sent over plain HTTP, not through the socket) still
deliver identical real-time push as WebSocket-originated ones — and it's why adding this system
didn't require touching the wallet/game modules' existing real-time code at all.

## Database

12 new tables (`prisma/migrations/0007_social_system`): `friend_requests`, `friendships`,
`blocked_users`, `muted_users`, `conversations` + `conversation_participants`, `messages` +
`message_delivery_statuses`, `user_presence_snapshots`, `achievements` + `user_achievements`,
`badges` + `user_badges`, `favorite_opponents`, `privacy_settings`, `user_activities`, `reports`.

Key normalization decisions:
- **`Friendship` is one row per pair, ever** — ordered (`userAId < userBId`, enforced by a DB
  `CHECK`) so the relationship is naturally undirected without storing it twice. `FriendRequest`
  is a separate table for the pending workflow, so declining and re-requesting doesn't require
  deleting/resurrecting a relationship row.
- **Blocking has zero relationship to Friendship** — you can block a stranger you've never
  friended. Blocking a friend transactionally deletes the friendship and cancels any pending
  request between the two, since a block is a hard boundary, not just "no new requests."
- **`MessageDeliveryStatus` is one row per (message, recipient)**, not per sender — a direct
  message has exactly one row per message today, but the shape already supports a future group
  conversation with zero schema change.
- **`Report` covers both message and player reports** — `reportedMessageId` is nullable
  specifically so a conduct report (a harassment pattern, an offensive avatar) isn't forced to
  point at one arbitrary message.

## Security

- **Message encryption at rest** (AES-256-GCM, `messaging/util/message-encryption.service.ts`) —
  explicitly NOT end-to-end; the backend can still read content, which is required for the
  profanity filter, spam detection, and report review to function. Stated as a deliberate scope
  decision, not an oversight — see the file's own comment.
- **Spam/flood protection**: `ModerationService` rejects >8 messages/10s per sender and exact
  duplicate messages within 30s (both Redis-backed, cheap). The `WsRateLimiter` already built for
  the game/matchmaking gateways is reused here at the socket layer (15 messages/10s) as a second,
  independent bound.
- **Every friend/message action is block-aware** — `FriendsService.isBlocked` is checked before a
  friend request, before starting a conversation, and before every message send.
- **Privacy settings enforced server-side**, not just hidden in the UI: `whoCanMessage` and
  `whoCanFriendRequest` are checked in `MessagingService`/`FriendsService` before the action is
  even attempted, not just used to filter what a client displays.
- **Report filing is rate-limited** (10/min) — deters using the report system itself as a
  harassment vector against the reported user.

## What's Intentionally Left as a Stub

- **Push notifications** (native mobile/web push) — `NotificationsService.send` writes the DB row
  and pushes to any open socket via `SocialRealtimeService`; dispatching to FCM/APNs/web-push for
  an offline user is the same "next slice" already noted in the original notifications stub.
- **Group conversations** — the schema supports N participants per conversation already
  (`ConversationParticipant` has no 2-person constraint), but `MessagingService.getOrCreateDirectConversation`
  and the gateway's typing-indicator broadcast both assume exactly 2 participants today.
- **Badges are admin-awarded only** — unlike achievements (auto-unlocked by stat criteria), there's
  no automatic badge-award logic yet; the admin audit pattern is there to build that endpoint on.
- **Multi-instance timers/limiters**: same caveat as every other gateway in this codebase — the
  `WsRateLimiter` buckets and the offline-grace timer are in-memory per instance.
