'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { NotificationItem, NotificationListEnvelope } from '@/lib/notifications';
import { useSocial } from '@/components/providers/social-provider';

const PAGE_SIZE = 20;

/**
 * Data layer for the Notification Center. Owns the paginated history list and
 * the mutation calls (read one, read all, delete); realtime concerns (live
 * push, authoritative unread badge) come from the shared SocialProvider socket.
 */
export function useNotifications() {
  const { incomingNotifications, refreshUnreadCount } = useSocial();

  const [items, setItems] = useState<NotificationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [mutatingAll, setMutatingAll] = useState(false);

  // Ids the user deleted this session — kept out of the list so a socket
  // "live" row doesn't resurface after being removed.
  const deletedIdsRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (cursor?: string | null) => {
    try {
      const { data } = await api.get<NotificationListEnvelope>('/notifications', {
        params: cursor ? { take: PAGE_SIZE, cursor } : { take: PAGE_SIZE },
      });
      setItems((prev) => (cursor ? [...prev, ...data.items] : data.items));
      setNextCursor(data.nextCursor);
      setUnread(data.unread);
      setError(null);
    } catch {
      setError('Could not load notifications. Please try again.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    void load(null);
  }, [load]);

  // Fold live notifications (arriving over the socket) into the top of the
  // list, deduped against anything the paginated fetch already has and anything
  // the user deleted this session.
  useEffect(() => {
    if (incomingNotifications.length === 0) return;
    setItems((prev) => {
      const live = incomingNotifications.filter((n) => !deletedIdsRef.current.has(n.id));
      const liveIds = new Set(live.map((n) => n.id));
      const rest = prev.filter((n) => !liveIds.has(n.id));
      return [...live, ...rest];
    });
  }, [incomingNotifications]);

  const markOneRead = useCallback(
    async (id: string) => {
      setMutatingId(id);
      try {
        await api.post(`/notifications/${id}/read`);
        setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true, readAt: new Date().toISOString() } : n)));
        setUnread((prev) => Math.max(0, prev - 1));
        void refreshUnreadCount();
      } catch {
        // Non-fatal — the row stays unread and the badge resyncs on next connect.
      } finally {
        setMutatingId(null);
      }
    },
    [refreshUnreadCount],
  );

  const markAllRead = useCallback(async () => {
    setMutatingAll(true);
    try {
      await api.post('/notifications/read-all');
      setItems((prev) => prev.map((n) => ({ ...n, isRead: true, readAt: new Date().toISOString() })));
      setUnread(0);
      void refreshUnreadCount();
    } catch {
      // Non-fatal — retried by the user if needed.
    } finally {
      setMutatingAll(false);
    }
  }, [refreshUnreadCount]);

  const removeOne = useCallback(
    async (id: string) => {
      setMutatingId(id);
      try {
        await api.delete(`/notifications/${id}`);
        deletedIdsRef.current.add(id);
        setItems((prev) => {
          const removed = prev.find((n) => n.id === id);
          if (removed && !removed.isRead) setUnread((u) => Math.max(0, u - 1));
          return prev.filter((n) => n.id !== id);
        });
        void refreshUnreadCount();
      } catch {
        // Non-fatal — the row simply stays.
      } finally {
        setMutatingId(null);
      }
    },
    [refreshUnreadCount],
  );

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore || loading) return;
    setLoadingMore(true);
    void load(nextCursor);
  }, [nextCursor, loadingMore, loading, load]);

  return {
    items,
    unread,
    nextCursor,
    loading,
    loadingMore,
    error,
    mutatingId,
    mutatingAll,
    markOneRead,
    markAllRead,
    removeOne,
    loadMore,
  };
}
