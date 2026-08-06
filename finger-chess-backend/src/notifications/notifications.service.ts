import { Injectable, Logger } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SocialRealtimeService } from '../social/realtime/social-realtime.service';
import {
  DEFAULT_NOTIFICATION_CATEGORIES,
  isNotificationCategory,
  type NotificationPreferencesView,
  type SendNotificationOptions,
} from './notification-categories';
import { UpdateNotificationPreferencesDto } from './dto/notification-preferences.dto';

const UNREAD_COUNT_CACHE_KEY = (userId: string) => `notifications:unread:${userId}`;
const UNREAD_COUNT_CACHE_TTL = 10;
const ONLINE_INDEX_KEY = 'presence:index';
const LIST_MAX_TAKE = 100;

interface CachedPrefs {
  categories: Record<string, boolean>;
  soundEnabled: boolean;
  desktopEnabled: boolean;
  expiresAt: number;
}

/**
 * The in-app notification pipeline. Producers call `send()` (positional
 * signature kept for the pre-existing call sites); the service:
 *
 *   1. gates delivery on the user's per-category preference,
 *   2. collapses "similar" notifications into one unread row via `groupKey`,
 *   3. persists the row,
 *   4. pushes it to the user's live socket (`notification` event),
 *   5. publishes the authoritative unread badge count (`notification:unread`).
 *
 * The realtime push rides the /social namespace through SocialRealtimeService,
 * which every connected client joins as `user:{userId}` — so no producer ever
 * needs to know anything about Socket.IO.
 *
 * `unreadCount` is served from a short Redis cache to keep the badge hot path
 * off Postgres; every mutation invalidates/refreshes it.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly prefCache = new Map<string, CachedPrefs>();
  private readonly PREF_CACHE_TTL_MS = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: SocialRealtimeService,
    private readonly redis: RedisService,
  ) {}

  // ==========================================================================
  // SENDING
  // ==========================================================================

  /**
   * Create (or merge into an existing unread group) and deliver a notification.
   * Returns null when the category is disabled for this user — nothing is
   * persisted or pushed in that case.
   */
  async send(
    userId: string,
    channel: string,
    category: string,
    title: string,
    message: string,
    metadata?: Record<string, unknown>,
    options?: SendNotificationOptions,
  ): Promise<Notification | null> {
    if (!(await this.isCategoryEnabled(userId, category))) {
      this.logger.debug(`Notification suppressed for ${userId} (${category} disabled)`);
      return null;
    }

    const notification = await this.createOrMerge(userId, {
      userId,
      channel,
      category,
      title,
      message,
      metadata: (metadata ?? {}) as Prisma.InputJsonValue,
      groupKey: options?.groupKey ?? null,
      actionUrl: options?.actionUrl ?? null,
      actorName: options?.actorName ?? null,
    });

    this.realtime.emitToUser(userId, 'notification', notification);
    await this.refreshUnread(userId);
    this.logger.log(`Notification queued for ${userId}: ${category}`);
    return notification;
  }

  private async createOrMerge(
    userId: string,
    data: Prisma.NotificationUncheckedCreateInput & { groupKey?: string | null },
  ): Promise<Notification> {
    const { groupKey, ...rest } = data;
    if (!groupKey) {
      return this.prisma.notification.create({ data: rest });
    }

    const existing = await this.prisma.notification.findFirst({
      where: { userId, groupKey, isRead: false },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!existing) {
      return this.prisma.notification.create({ data: { ...rest, groupKey } });
    }

    // Merge: bump the count, refresh content/actor, and bubble the group back
    // to the top of the timeline so "3 new friend requests" reads as one item.
    return this.prisma.notification.update({
      where: { id: existing.id },
      data: {
        count: { increment: 1 },
        title: rest.title,
        message: rest.message,
        actorName: rest.actorName ?? null,
        actionUrl: rest.actionUrl ?? null,
        createdAt: new Date(),
      },
    });
  }

  // ==========================================================================
  // NOTIFICATION CENTER
  // ==========================================================================

  /**
   * Cursor-paginated history, newest first. Returns the items, the next cursor
   * (null when there is no more), and the current authoritative unread count
   * so a single request can hydrate both the list and the badge.
   */
  async list(userId: string, take = 50, cursor?: string) {
    const safeTake = Math.min(Math.max(take, 1), LIST_MAX_TAKE);
    const notifications = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: safeTake + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = notifications.length > safeTake;
    const items = hasMore ? notifications.slice(0, safeTake) : notifications;
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    return {
      items,
      nextCursor,
      unread: await this.unreadCount(userId),
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const cached = await this.redis.get(UNREAD_COUNT_CACHE_KEY(userId));
    if (cached !== null) {
      const parsed = Number.parseInt(cached, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }

    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    await this.redis
      .set(UNREAD_COUNT_CACHE_KEY(userId), String(count), 'EX', UNREAD_COUNT_CACHE_TTL)
      .catch(() => {});
    return count;
  }

  /** Recompute + cache + push the user's live unread badge. Called after every mutation. */
  async refreshUnread(userId: string): Promise<number> {
    const count = await this.prisma.notification.count({ where: { userId, isRead: false } });
    await this.redis
      .set(UNREAD_COUNT_CACHE_KEY(userId), String(count), 'EX', UNREAD_COUNT_CACHE_TTL)
      .catch(() => {});
    this.realtime.emitToUser(userId, 'notification:unread', { count });
    return count;
  }

  async markRead(userId: string, notificationId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { isRead: true, readAt: new Date() },
    });
    if (result.count === 0) return { success: false };
    await this.refreshUnread(userId);
    return { success: true };
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    await this.refreshUnread(userId);
    return { success: true, updated: result.count };
  }

  /** Ownership-enforced delete: the row is only removed when it belongs to the caller. */
  async delete(userId: string, notificationId: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
    if (result.count === 0) return { success: false };
    await this.refreshUnread(userId);
    return { success: true };
  }

  // ==========================================================================
  // PREFERENCES
  // ==========================================================================

  async getPreferences(userId: string): Promise<NotificationPreferencesView> {
    const cached = this.prefCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        categories: { ...cached.categories },
        soundEnabled: cached.soundEnabled,
        desktopEnabled: cached.desktopEnabled,
      };
    }

    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    const stored = (row?.categories as Record<string, boolean> | null) ?? {};
    const categories = { ...DEFAULT_NOTIFICATION_CATEGORIES, ...stored };

    this.prefCache.set(userId, {
      categories,
      soundEnabled: row?.soundEnabled ?? true,
      desktopEnabled: row?.desktopEnabled ?? false,
      expiresAt: Date.now() + this.PREF_CACHE_TTL_MS,
    });

    return {
      categories,
      soundEnabled: row?.soundEnabled ?? true,
      desktopEnabled: row?.desktopEnabled ?? false,
    };
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto): Promise<NotificationPreferencesView> {
    const existing = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    const storedBase = (existing?.categories as Record<string, boolean> | null) ?? {};
    const merged = dto.categories ? { ...storedBase, ...dto.categories } : storedBase;
    for (const key of Object.keys(merged)) {
      if (!isNotificationCategory(key)) delete merged[key];
    }

    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        categories: merged as Prisma.InputJsonValue,
        soundEnabled: dto.soundEnabled ?? true,
        desktopEnabled: dto.desktopEnabled ?? false,
      },
      update: {
        categories: merged as Prisma.InputJsonValue,
        soundEnabled: dto.soundEnabled ?? existing?.soundEnabled ?? true,
        desktopEnabled: dto.desktopEnabled ?? existing?.desktopEnabled ?? false,
      },
    });

    this.prefCache.delete(userId);
    return this.getPreferences(userId);
  }

  // ==========================================================================
  // ADMIN ANNOUNCEMENTS
  // ==========================================================================

  /**
   * Broadcast an announcement to every active user. Rows are bulk-inserted in
   * chunks (one row per recipient — this is what makes each user's history and
   * preferences work uniformly); live delivery + badge refresh only touches
   * currently-online users; cached badge counters are invalidated for everyone.
   */
  async announce(adminId: string, title: string, message: string) {
    const targetUsers = await this.prisma.user.findMany({
      where: { id: { not: adminId }, status: 'active' },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    const userIds = targetUsers.map((u) => u.id);
    const now = new Date();

    const rows: Prisma.NotificationCreateManyInput[] = userIds.map((userId) => ({
      id: randomUUID(),
      userId,
      channel: 'in_app',
      category: 'admin_announcement',
      title,
      message,
      metadata: { announcedBy: adminId } as Prisma.InputJsonValue,
      groupKey: null,
      count: 1,
      isRead: false,
      createdAt: now,
    }));

    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await this.prisma.notification.createMany({ data: rows.slice(i, i + CHUNK) });
    }

    const online = await this.onlineUserIds();
    for (const userId of online) {
      const payload =
        rows.find((r) => r.userId === userId) ??
        ({
          id: randomUUID(),
          userId,
          channel: 'in_app',
          category: 'admin_announcement',
          title,
          message,
          metadata: { announcedBy: adminId },
          groupKey: null,
          count: 1,
          isRead: false,
          createdAt: now,
        } as Prisma.NotificationCreateManyInput);
      this.realtime.emitToUser(userId, 'notification', payload);
      void this.refreshUnread(userId).catch(() => {});
    }

    await this.invalidateUnreadCaches(userIds);
    this.logger.log(`Announcement sent to ${userIds.length} users: ${title}`);
    return { recipients: userIds.length, online: online.length };
  }

  private async onlineUserIds(): Promise<string[]> {
    try {
      return await this.redis.zrange(ONLINE_INDEX_KEY, 0, -1);
    } catch {
      return [];
    }
  }

  private async invalidateUnreadCaches(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const userId of userIds) pipeline.del(UNREAD_COUNT_CACHE_KEY(userId));
    await pipeline.exec().catch(() => {});
  }

  // ==========================================================================
  // PREFERENCE GATING
  // ==========================================================================

  private async isCategoryEnabled(userId: string, category: string): Promise<boolean> {
    const prefs = await this.getPreferences(userId);
    return prefs.categories[category] ?? true;
  }
}
