'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { toast } from 'sonner';
import { createNamespaceSocket } from '@/lib/socket';
import { api } from '@/lib/api';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationItem,
  NotificationPreferences,
  playNotificationSound,
  showDesktopNotification,
} from '@/lib/notifications';

export type PresenceStatus =
  | 'online'
  | 'away'
  | 'in_game'
  | 'in_tournament'
  | 'spectating'
  | 'do_not_disturb'
  | 'invisible'
  | 'offline';

export const CLIENT_STATUSES: PresenceStatus[] = ['online', 'away', 'do_not_disturb', 'invisible'];

export interface LiveMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  contentType: string;
  createdAt: string;
  recipientIds?: string[];
}

interface PresenceValue {
  status: PresenceStatus;
  lastSeenAt?: string | null;
}

export interface LiveInvitation {
  invitationId: string;
  senderId: string;
  timeControlId: string;
  entryFee: number;
  rated: boolean;
  colorPreference: 'random' | 'white' | 'black';
  message: string | null;
  expiresAt: string;
}

export interface SocialSocketHandlers {
  /** Fired when a challenge I SENT gets accepted — navigate the sender into the game. */
  onInvitationAccepted?: (data: { invitationId: string; gameId: string; opponentId: string }) => void;
}

export function useSocialSocket(handlers?: SocialSocketHandlers) {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [presenceMap, setPresenceMap] = useState<Record<string, PresenceStatus>>({});
  const [lastSeenMap, setLastSeenMap] = useState<Record<string, string | null>>({});
  const [incomingMessages, setIncomingMessages] = useState<LiveMessage[]>([]);
  const [typingByConversation, setTypingByConversation] = useState<Record<string, boolean>>({});
  const [deliveryUpdates, setDeliveryUpdates] = useState<Record<string, string>>({}); // messageId -> 'delivered'
  const [readUpdates, setReadUpdates] = useState<Record<string, string>>({}); // conversationId -> upToMessageId
  const [notificationCount, setNotificationCount] = useState(0);
  const [incomingNotifications, setIncomingNotifications] = useState<NotificationItem[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(
    DEFAULT_NOTIFICATION_PREFERENCES,
  );
  const [incomingInvitations, setIncomingInvitations] = useState<LiveInvitation[]>([]);
  const [pendingInvitationCount, setPendingInvitationCount] = useState(0);

  const prefsRef = useRef(notificationPreferences);
  useEffect(() => {
    prefsRef.current = notificationPreferences;
  }, [notificationPreferences]);

  /** Authoritative unread count (survives disconnects / missed socket events). */
  const refreshUnreadCount = useCallback(async () => {
    try {
      const { data } = await api.get<{ count: number }>('/notifications/unread-count');
      setNotificationCount(data.count);
    } catch {
      // Non-fatal — the badge falls back to whatever the socket reported.
    }
  }, []);

  const refreshPreferences = useCallback(async () => {
    try {
      const { data } = await api.get<NotificationPreferences>('/notifications/preferences');
      setNotificationPreferences(data);
    } catch {
      // Non-fatal — defaults are all-on.
    }
  }, []);

  /** Persist a preference change and adopt the server-merged result. */
  const updatePreferences = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      try {
        const { data } = await api.patch<NotificationPreferences>('/notifications/preferences', patch);
        setNotificationPreferences(data);
      } catch {
        // Non-fatal — the socket hook re-syncs prefs on the next connect.
      }
    },
    [],
  );

  /** Re-sync the pending-challenge badge count from the server (authoritative for the invitation center). */
  const refreshPendingInvitationCount = useCallback(async () => {
    try {
      const { data } = await api.get<{ count: number }>('/social/invitations/pending-count');
      setPendingInvitationCount(data.count);
    } catch {
      // Non-fatal — the badge is best-effort; the center page fetches on load.
    }
  }, []);

  useEffect(() => {
    const socket = createNamespaceSocket('/social');
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('heartbeat');
      // The socket is live but we may have missed events while disconnected —
      // pull authoritative counts + preferences the moment we reconnect.
      refreshUnreadCount();
      refreshPreferences();
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('presenceSnapshot', (snapshot: Record<string, PresenceValue | string>) => {
      mergePresence(snapshot, setPresenceMap, setLastSeenMap);
    });

    socket.on('presenceUpdate', (data: { userId: string; status: PresenceStatus; lastSeenAt?: string | null }) => {
      setPresenceMap((prev) => ({ ...prev, [data.userId]: data.status }));
      setLastSeenMap((prev) => ({ ...prev, [data.userId]: data.lastSeenAt ?? null }));
    });

    // Recipients get their copy via 'newMessage'; the SENDER's own client
    // never receives that event (MessagingService only emits to
    // recipientIds — see social/messaging/messaging.service.ts) and instead
    // gets a separate 'messageSent' ack from the gateway. Both are folded
    // into the same incomingMessages array so the conversation view doesn't
    // need to care which path a given message arrived by.
    socket.on('newMessage', (message: LiveMessage) => {
      // Bounded ring buffer — a long-lived social socket otherwise grows this
      // array without limit and re-creates it (and the context value) per
      // message for the whole session.
      setIncomingMessages((prev) => [...prev.slice(-199), message]);
      socket.emit('markDelivered', { messageId: message.id });
    });

    socket.on('messageSent', (message: LiveMessage) => {
      setIncomingMessages((prev) => [...prev.slice(-199), message]);
    });

    socket.on('messageRejected', (data: { message: string }) => {
      toast.error(data.message || 'Message could not be sent');
    });

    socket.on('typingIndicator', (data: { conversationId: string; isTyping: boolean }) => {
      setTypingByConversation((prev) => ({ ...prev, [data.conversationId]: data.isTyping }));
    });

    socket.on('messageDelivered', (data: { messageId: string }) => {
      setDeliveryUpdates((prev) => ({ ...prev, [data.messageId]: 'delivered' }));
    });

    socket.on('messagesRead', (data: { conversationId: string; upToMessageId: string }) => {
      setReadUpdates((prev) => ({ ...prev, [data.conversationId]: data.upToMessageId }));
    });

    // ---- Notifications (notification center + live delivery) ----
    // Every backend Notification send() emits the full row here. We fold it
    // into the live list, bump the authoritative unread count, and deliver
    // per the user's preferences (toast / sound / desktop).
    socket.on('notification', (notification: NotificationItem) => {
      setIncomingNotifications((prev) => {
        const next = [notification, ...prev].filter(
          (item, index, arr) => arr.findIndex((other) => other.id === item.id) === index,
        );
        return next.slice(0, 100);
      });
      if (!notification.isRead) setNotificationCount((c) => c + 1);

      const prefs = prefsRef.current;
      if (!prefs) return;
      const categoryEnabled = prefs.categories[notification.category] ?? true;
      if (!categoryEnabled) return;

      // Match challenges surface through the IncomingInvitationDialog + its
      // own toast, so skip the duplicate here.
      if (notification.category !== 'match_invitation') {
        toast(notification.title, { description: notification.message });
      }
      if (prefs.soundEnabled) playNotificationSound();
      if (prefs.desktopEnabled && !notification.isRead) {
        showDesktopNotification(notification.title, notification.message, notification.actionUrl ?? undefined);
      }
    });

    // Authoritative count pushed by the backend after any mutation (read,
    // read-all, grouped increment) — supersedes optimistic increments.
    socket.on('notification:unread', (data: { count: number }) => {
      setNotificationCount(data.count);
    });

    // ---- Match invitations ----
    // A friend challenged you — surface the invitation immediately (the
    // IncomingInvitationDialog in the AppShell auto-opens on this). The bell
    // count is handled by the authoritative 'notification' +
    // 'notification:unread' pair the backend emits alongside this event, so
    // no manual bump here (a manual +1 would transiently overcount). The
    // invitation lives on for ~60s server-side, so the center page can also
    // show it after the toast. Respects the user's match_invitation
    // preference: when disabled, no dialog/toast — but the pending badge
    // still reflects it so nothing is silently dropped.
    socket.on('invitationReceived', (data: LiveInvitation) => {
      refreshPendingInvitationCount();
      const prefs = prefsRef.current;
      if (!prefs || (prefs.categories['match_invitation'] ?? true) === false) return;
      setIncomingInvitations((prev) => {
        const next = prev.filter((i) => i.invitationId !== data.invitationId);
        return [...next, data];
      });
      toast(`${data.rated ? 'Rated' : 'Casual'} match challenge — ${timeControlLabel(data.timeControlId)}`, {
        description: feeText(data.entryFee),
      });
    });

    // A challenge I SENT was accepted — the handler navigates me into the
    // game that was just created. The acceptor navigates themselves from the
    // REST accept response, so only the sender is routed here.
    socket.on('invitationAccepted', (data: { invitationId: string; gameId: string; opponentId: string }) => {
      toast.success('Challenge accepted — starting your match');
      handlersRef.current?.onInvitationAccepted?.(data);
    });

    socket.on('invitationDeclined', () => {
      toast.info('Your challenge was declined');
    });

    socket.on('invitationCancelled', (data: { invitationId: string }) => {
      setIncomingInvitations((prev) => prev.filter((i) => i.invitationId !== data.invitationId));
      refreshPendingInvitationCount();
    });

    // Heartbeat keeps the server-side 90s presence TTL alive. 20s comfortably
    // clears it even across a missed tick.
    const heartbeat = setInterval(() => socket.emit('heartbeat'), 20_000);

    // Recovery: after a network drop, reconnect proactively and refresh the
    // TTL the moment the tab becomes visible again (laptop lid reopen, tab
    // backgrounded-and-restored). The server also counts sockets per user, so
    // a second tab never causes a false offline even before this runs.
    const onOnline = () => socket.connect();
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && socket.connected) socket.emit('heartbeat');
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendMessage = useCallback((conversationId: string, content: string) => {
    socketRef.current?.emit('sendMessage', { conversationId, content });
  }, []);

  const setTyping = useCallback((conversationId: string, isTyping: boolean) => {
    socketRef.current?.emit('typing', { conversationId, isTyping });
  }, []);

  const markRead = useCallback((conversationId: string, upToMessageId: string) => {
    socketRef.current?.emit('markRead', { conversationId, upToMessageId });
  }, []);

  const setStatus = useCallback((status: PresenceStatus) => {
    socketRef.current?.emit('setStatus', { status });
  }, []);

  const dismissLatestInvitation = useCallback(() => {
    setIncomingInvitations((prev) => prev.slice(0, -1));
  }, []);

  /**
   * Pulls live presence for arbitrary user ids (non-friends: tournament
   * rosters, match opponents) via the privacy-aware REST endpoint and merges
   * it into the shared presence maps. Real-time updates for these users come
   * from periodic refetches (see usePresence) since the server only pushes
   * presence for the caller's own friends.
   */
  const fetchPresence = useCallback(async (userIds: string[]) => {
    const ids = [...new Set(userIds)].filter(Boolean);
    if (ids.length === 0) return;
    try {
      const { data } = await api.get<Record<string, PresenceValue>>('/social/presence', { params: { ids: ids.join(',') } });
      mergePresence(data, setPresenceMap, setLastSeenMap);
    } catch {
      // Non-fatal — presence is best-effort; pages render without it.
    }
  }, []);

  return {
    connected,
    presenceMap,
    lastSeenMap,
    incomingMessages,
    typingByConversation,
    deliveryUpdates,
    readUpdates,
    notificationCount,
    incomingNotifications,
    notificationPreferences,
    refreshUnreadCount,
    refreshPreferences,
    updatePreferences,
    incomingInvitations,
    latestInvitation: incomingInvitations[incomingInvitations.length - 1] ?? null,
    pendingInvitationCount,
    refreshPendingInvitationCount,
    dismissLatestInvitation,
    sendMessage,
    setTyping,
    markRead,
    setStatus,
    fetchPresence,
  };
}

function timeControlLabel(id: string): string {
  const known: Record<string, string> = {
    bullet_1_0: '1 min',
    bullet_2_1: '2 | 1',
    blitz_3_0: '3 | 0',
    blitz_3_2: '3 | 2',
    blitz_5_0: '5 | 0',
    blitz_5_3: '5 | 3',
    rapid_10_0: '10 min',
    rapid_15_10: '15 | 10',
    classical_30_0: '30 min',
    classical_60_0: '60 min',
  };
  return known[id] ?? id;
}

function feeText(entryFee: number): string {
  return entryFee > 0 ? `Stake $${entryFee}` : 'Free play — no stake';
}

function mergePresence(
  snapshot: Record<string, PresenceValue | string>,
  setPresenceMap: (fn: (prev: Record<string, PresenceStatus>) => Record<string, PresenceStatus>) => void,
  setLastSeenMap: (fn: (prev: Record<string, string | null>) => Record<string, string | null>) => void,
) {
  const statuses: Record<string, PresenceStatus> = {};
  const lastSeens: Record<string, string | null> = {};
  for (const [userId, value] of Object.entries(snapshot ?? {})) {
    if (typeof value === 'object' && value !== null && 'status' in value) {
      statuses[userId] = value.status;
      lastSeens[userId] = value.lastSeenAt ?? null;
    } else if (typeof value === 'string') {
      statuses[userId] = value as PresenceStatus;
      lastSeens[userId] = null;
    }
  }
  // Diff before set: a poll tick that returned identical data must NOT
  // allocate a new map reference, or every useSocial consumer re-renders
  // for a 30s poll that changed nothing.
  setPresenceMap((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const [id, s] of Object.entries(statuses)) {
      if (next[id] !== s) {
        next[id] = s;
        changed = true;
      }
    }
    return changed ? next : prev;
  });
  setLastSeenMap((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const [id, s] of Object.entries(lastSeens)) {
      if (next[id] !== s) {
        next[id] = s;
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}
