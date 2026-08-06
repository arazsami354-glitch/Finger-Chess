import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FriendsService } from '../friends/friends.service';
import { SocialRealtimeService } from '../realtime/social-realtime.service';

/**
 * The live source of truth for user status lives in Redis, not Postgres:
 * reads are O(1) per user and batched friend-list lookups are one pipelined
 * round trip. The Postgres `UserPresenceSnapshot` row is a durable fallback
 * only (a profile can still answer "last seen 3 hours ago" after a server
 * restart or once a user has been offline long enough to fall out of Redis).
 *
 * A user can be in exactly one of these states at a time:
 *   online / away / in_game / in_tournament / spectating /
 *   do_not_disturb / invisible / offline
 *
 * Distinction that matters:
 *   - `invisible` is a REAL stored state (the user is connected) that is
 *     masked to 'offline' for every other user — the user's own clients and
 *     admins still see the truth. Self-view is never masked.
 *   - `do_not_disturb` is a full, honest status; chat suppression is out of
 *     scope for presence (messaging is a separate concern).
 */

export const PRESENCE_STATUSES = [
  'online',
  'away',
  'in_game',
  'in_tournament',
  'spectating',
  'do_not_disturb',
  'invisible',
  'offline',
] as const;

export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** States a normal client may set on itself (offline is disconnect-managed; auto states are context-managed). */
export const CLIENT_SETTABLE_STATUSES: readonly PresenceStatus[] = ['online', 'away', 'do_not_disturb', 'invisible'];

interface PresenceEntry {
  s: PresenceStatus;
  /** lastSeenAt as epoch ms — refreshed by heartbeat and every status write */
  t: number;
}

// If a client goes this long without a heartbeat, it's treated as offline
// even when the disconnect itself was unclean (laptop lid closed, tab
// suspended, network partition). Must stay comfortably above the client's
// 20s heartbeat and the 8s disconnect grace.
const PRESENCE_TTL_SEC = 90;
// A user is counted as "online right now" for the admin overview if their
// last activity was within this window (equals the presence TTL).
const ONLINE_WINDOW_SEC = 90;
// Upper bound on how many users the admin overview scans live — bounded
// work regardless of total registration count.
const ADMIN_OVERVIEW_SCAN = 200;
const ADMIN_RECENT_LIMIT = 25;
// Cooldown sentinel that throttles lastSeen DB writes to once per window
// per user, regardless of heartbeat frequency or instance count.
const DB_WRITE_COOLDOWN_SEC = 60;

@Injectable()
export class PresenceService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly realtime: SocialRealtimeService,
  ) {}

  private key(userId: string) {
    return `presence:${userId}`;
  }

  /** Sorted set of userId -> lastSeenEpoch for every live user. Feeds the admin overview with bounded scans. */
  private get indexKey() {
    return 'presence:index';
  }

  /** Manual status preference (online/away/dnd/invisible) chosen by the user — survives auto-state transitions like `in_game`. */
  private prefKey(userId: string) {
    return `presence:pref:${userId}`;
  }

  /** Socket memberships per user so offline is only declared when the LAST tab closes. */
  private socketsKey(userId: string) {
    return `presence:sockets:${userId}`;
  }

  /** Cooldown sentinel for throttled DB lastSeen writes. */
  private snapKey(userId: string) {
    return `presence:snap:${userId}`;
  }

  // ==========================================================================
  // LOW-LEVEL REDIS WRITES
  // ==========================================================================

  /**
   * Sets the live entry. Passing `status === 'offline'` deletes the entry
   * entirely and snapshots the DB. This is the low-level write — callers
   * that want friends notified use setUserStatus() instead.
   */
  async setStatus(userId: string, status: PresenceStatus): Promise<void> {
    if (status === 'offline') {
      await this.redis.del(this.key(userId));
      await this.redis.zrem(this.indexKey, userId);
      await this.snapshotToDb(userId, 'offline');
      return;
    }
    const entry: PresenceEntry = { s: status, t: Date.now() };
    await this.redis.set(this.key(userId), JSON.stringify(entry), 'EX', PRESENCE_TTL_SEC);
    await this.redis.zadd(this.indexKey, entry.t, userId);
  }

  /** Heartbeat: refresh TTL + index, throttle the DB lastSeen write. Never changes status, never broadcasts. */
  async touch(userId: string): Promise<PresenceStatus> {
    const entry = await this.readEntry(userId);
    if (!entry) return 'offline';
    entry.t = Date.now();
    await this.redis.set(this.key(userId), JSON.stringify(entry), 'EX', PRESENCE_TTL_SEC);
    await this.redis.zadd(this.indexKey, entry.t, userId);
    await this.writeLastSeenCooldown(userId, entry.s);
    return entry.s;
  }

  /**
   * Canonical "this user is now X" path used by the social gateway, the game
   * gateway and (for the user's own choices) the client. Sets the live entry,
   * snapshots the DB (only on an actual status change), and pushes a masked
   * presenceUpdate to the user's friends. A manual choice (online/away/dnd/
   * invisible) is also remembered so auto-states like `in_game` can return
   * the user to their preferred state when the game ends.
   */
  async setUserStatus(userId: string, status: PresenceStatus, opts?: { manual?: boolean }): Promise<void> {
    if (opts?.manual && status !== 'offline') {
      await this.redis.set(this.prefKey(userId), status);
    }
    if (status === 'offline') {
      await this.setStatus(userId, 'offline');
      await this.broadcastToFriends(userId, 'offline');
      return;
    }

    const previous = await this.readEntry(userId);
    await this.setStatus(userId, status);

    // DB write only on an actual status transition, not on every reconnect.
    if (previous?.s !== status) {
      await this.snapshotToDb(userId, status);
    }

    await this.broadcastToFriends(userId, status);
  }

  /** After a game/tournament context ends: return a still-connected user to their preferred state (online by default). */
  async restoreToPreferredIfConnected(userId: string): Promise<void> {
    if (!(await this.isConnected(userId))) return;
    const pref = (await this.redis.get(this.prefKey(userId))) as PresenceStatus | null;
    const status = pref && pref !== 'offline' ? pref : 'online';
    await this.setUserStatus(userId, status);
  }

  // ==========================================================================
  // MULTI-TAB CONNECTION TRACKING
  // ==========================================================================

  /**
   * Registers one socket for a user. Returns true when this is the user's
   * FIRST live socket — the caller uses that to know whether to announce
   * 'online' (first tab) or merely refresh TTL (a second tab opening).
   */
  async registerSocket(userId: string, socketId: string): Promise<boolean> {
    const added = await this.redis.sadd(this.socketsKey(userId), socketId);
    await this.redis.expire(this.socketsKey(userId), PRESENCE_TTL_SEC);
    return added === 1;
  }

  /** Unregisters one socket and returns how many sockets the user still has open (0 = last tab closed). */
  async unregisterSocket(userId: string, socketId: string): Promise<number> {
    await this.redis.srem(this.socketsKey(userId), socketId);
    const remaining = await this.redis.scard(this.socketsKey(userId));
    if (remaining <= 0) await this.redis.del(this.socketsKey(userId));
    return remaining;
  }

  /** Whether the user currently has a live presence entry (i.e. is genuinely connected). */
  async isConnected(userId: string): Promise<boolean> {
    return (await this.readEntry(userId)) !== null;
  }

  // ==========================================================================
  // READS
  // ==========================================================================

  /** Real stored status, including 'invisible'. Use getPublicStatus() for anything shown to other users. */
  async getStatus(userId: string): Promise<PresenceStatus> {
    const entry = await this.readEntry(userId);
    return entry?.s ?? 'offline';
  }

  /** Friend/stranger-facing status: 'invisible' is masked to 'offline'. */
  async getPublicStatus(userId: string): Promise<PresenceStatus> {
    const status = await this.getStatus(userId);
    return status === 'invisible' ? 'offline' : status;
  }

  /** Batched lookup for a friends list — one pipelined Redis round trip. Statuses are public-facing (invisible masked). */
  async getBulkStatus(userIds: string[]): Promise<Record<string, PresenceStatus>> {
    const entries = await this.readEntries(userIds);
    const statuses: Record<string, PresenceStatus> = {};
    for (const [id, entry] of entries) {
      statuses[id] = entry ? (entry.s === 'invisible' ? 'offline' : entry.s) : 'offline';
    }
    return statuses;
  }

  /** Last seen: live entry timestamp while present, DB snapshot once offline. */
  async getLastSeen(userId: string): Promise<Date | null> {
    const entry = await this.readEntry(userId);
    if (entry) return new Date(entry.t);
    const snapshot = await this.prisma.userPresenceSnapshot.findUnique({ where: { userId } });
    return snapshot?.lastSeenAt ?? null;
  }

  /**
   * Privacy-aware bulk presence for the /social/presence endpoint (tournament
   * pages, match pages, admin-less arbitrary user sets). Respects
   * showOnlineStatus=false (→ offline, no lastSeen), masks invisible→offline,
   * hides presence entirely for blocked users, and never masks the viewer's
   * own id so the self-view is truthful.
   */
  async getBulkPresence(userIds: string[], viewerId: string): Promise<Record<string, { status: PresenceStatus; lastSeenAt: Date | null }>> {
    const unique = [...new Set(userIds)].filter((id) => id && id !== viewerId);
    const result: Record<string, { status: PresenceStatus; lastSeenAt: Date | null }> = {};

    // Always include the viewer's own entry first (truthful self-view).
    if (viewerId && userIds.includes(viewerId)) {
      const entry = await this.readEntry(viewerId);
      result[viewerId] = { status: entry?.s ?? 'offline', lastSeenAt: entry ? new Date(entry.t) : await this.getLastSeen(viewerId) };
    }

    if (unique.length === 0) return result;

    const [entries, snapshots, privacyRows, blocks] = await Promise.all([
      this.readEntries(unique),
      this.prisma.userPresenceSnapshot.findMany({ where: { userId: { in: unique } } }),
      this.prisma.privacySettings.findMany({ where: { userId: { in: unique } } }),
      this.prisma.blockedUser.findMany({
        where: {
          OR: [{ blockerId: viewerId, blockedId: { in: unique } }, { blockerId: { in: unique }, blockedId: viewerId }],
        },
      }),
    ]);

    const snapshotByUser = new Map(snapshots.map((s) => [s.userId, s]));
    const privacyByUser = new Map(privacyRows.map((p) => [p.userId, p]));
    const hidden = new Set<string>();
    for (const b of blocks) {
      if (b.blockerId === viewerId) hidden.add(b.blockedId);
      else hidden.add(b.blockerId); // target blocked the viewer
    }

    for (const id of unique) {
      if (hidden.has(id)) {
        result[id] = { status: 'offline', lastSeenAt: null };
        continue;
      }
      if (privacyByUser.get(id)?.showOnlineStatus === false) {
        result[id] = { status: 'offline', lastSeenAt: null };
        continue;
      }
      const entry = entries.get(id);
      if (entry) {
        result[id] = { status: entry.s === 'invisible' ? 'offline' : entry.s, lastSeenAt: new Date(entry.t) };
      } else {
        result[id] = { status: 'offline', lastSeenAt: snapshotByUser.get(id)?.lastSeenAt ?? null };
      }
    }

    return result;
  }

  // ==========================================================================
  // ADMIN OVERVIEW
  // ==========================================================================

  /**
   * Live "online right now" count for the admin dashboard. O(log N) ZCOUNT on
   * the presence index within the live window — never a full KEYS scan.
   */
  async countOnlineNow(): Promise<number> {
    const now = Date.now();
    const windowMs = ONLINE_WINDOW_SEC * 1000;
    try {
      return await this.redis.zcount(this.indexKey, now - windowMs, '+inf');
    } catch {
      return 0;
    }
  }

  /** Live ops view for the admin dashboard: counts per status + most recently active users. Bounded scans, no full-table iteration. */
  async getAdminOverview() {
    const now = Date.now();
    const windowMs = ONLINE_WINDOW_SEC * 1000;

    // "Online right now" = members whose lastSeen falls inside the window —
    // this stays accurate across unclean disconnects that never ran the
    // offline path (server restart, crash) because stale members simply age
    // out of the window instead of lingering forever.
    const onlineNow = await this.redis.zcount(this.indexKey, now - windowMs, '+inf');

    // Scan only the most recently active members for the status breakdown.
    const memberIds = await this.redis.zrevrange(this.indexKey, 0, ADMIN_OVERVIEW_SCAN - 1);
    const entries = await this.readEntries(memberIds);

    const byStatus: Record<string, number> = {};
    for (const status of PRESENCE_STATUSES) {
      if (status !== 'offline') byStatus[status] = 0;
    }

    const recent: { userId: string; fullName: string | null; email: string; status: PresenceStatus; lastSeenAt: Date | null }[] = [];

    // Only members inside the live window count as "now"; older members of
    // the index are stale and skipped (the index has no TTL of its own).
    const live = memberIds
      .map((id) => ({ id, entry: entries.get(id) }))
      .filter(({ entry }) => entry !== undefined && entry !== null && entry.t >= now - windowMs);

    for (const { entry } of live) {
      byStatus[entry!.s] = (byStatus[entry!.s] ?? 0) + 1;
    }

    const recentIds = live.slice(0, ADMIN_RECENT_LIMIT).map(({ id }) => id);
    if (recentIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: recentIds } },
        select: { id: true, fullName: true, email: true },
      });
      const userById = new Map(users.map((u) => [u.id, u]));
      for (const { id, entry } of live.slice(0, ADMIN_RECENT_LIMIT)) {
        const user = userById.get(id);
        recent.push({
          userId: id,
          fullName: user?.fullName ?? null,
          email: user?.email ?? id,
          status: entry!.s,
          lastSeenAt: new Date(entry!.t),
        });
      }
    }

    const totalUsers = await this.prisma.user.count({ where: { status: 'active' } });

    return { onlineNow, byStatus, recent, totalUsers };
  }

  // ==========================================================================
  // INTERNALS
  // ==========================================================================

  private async readEntry(userId: string): Promise<PresenceEntry | null> {
    const raw = await this.redis.get(this.key(userId));
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PresenceEntry;
      if (!parsed.s) return null;
      return parsed;
    } catch {
      // Corrupt/legacy value (e.g. a bare status string from before this
      // format) — treat as absent rather than crashing.
      return null;
    }
  }

  /** Pipelined multi-get, one Redis round trip for the whole list. */
  private async readEntries(userIds: string[]): Promise<Map<string, PresenceEntry>> {
    const map = new Map<string, PresenceEntry>();
    if (userIds.length === 0) return map;
    const pipeline = this.redis.pipeline();
    userIds.forEach((id) => pipeline.get(this.key(id)));
    const results = await pipeline.exec();
    userIds.forEach((id, i) => {
      const value = results?.[i]?.[1] as string | null;
      if (!value) return;
      try {
        const parsed = JSON.parse(value) as PresenceEntry;
        if (parsed.s) map.set(id, parsed);
      } catch {
        // legacy/corrupt value — ignore
      }
    });
    return map;
  }

  private async broadcastToFriends(userId: string, status: PresenceStatus) {
    try {
      const friends = await this.friends.listFriends(userId);
      if (friends.length === 0) return;
      const publicStatus: PresenceStatus = status === 'invisible' ? 'offline' : status;
      this.realtime.emitToUsers(
        friends.map((f) => f.id),
        'presenceUpdate',
        { userId, status: publicStatus, lastSeenAt: new Date().toISOString() },
      );
    } catch {
      // Presence broadcast must never take a connection/game path down —
      // a friend-list failure here is not worth surfacing.
    }
  }

  private async snapshotToDb(userId: string, status: PresenceStatus) {
    await this.prisma.userPresenceSnapshot.upsert({
      where: { userId },
      create: { userId, status, lastSeenAt: new Date() },
      update: { status, lastSeenAt: new Date() },
    });
  }

  /** Writes lastSeenAt (and current status) to the DB at most once per cooldown window. */
  private async writeLastSeenCooldown(userId: string, status: PresenceStatus) {
    const acquired = await this.redis.set(this.snapKey(userId), '1', 'EX', DB_WRITE_COOLDOWN_SEC, 'NX');
    if (acquired === 'OK') {
      await this.prisma.userPresenceSnapshot.upsert({
        where: { userId },
        create: { userId, status, lastSeenAt: new Date() },
        update: { lastSeenAt: new Date() },
      });
    }
  }
}
