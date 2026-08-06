'use client';

import type { LucideIcon } from 'lucide-react';
import {
  Award,
  Bell,
  Check,
  LifeBuoy,
  Megaphone,
  MessageCircle,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Swords,
  Timer,
  Trophy,
  UserPlus,
  Wallet,
} from 'lucide-react';

/**
 * Shared notification types + category metadata. Keep the category strings in
 * sync with the backend (finger-chess-backend/src/notifications/
 * notification-categories.ts).
 */

export interface NotificationItem {
  id: string;
  userId: string;
  channel: string;
  category: string;
  title: string;
  message: string;
  metadata: Record<string, unknown> | null;
  groupKey: string | null;
  count: number;
  readAt: string | null;
  actionUrl: string | null;
  actorName: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface NotificationPreferences {
  categories: Record<string, boolean>;
  soundEnabled: boolean;
  desktopEnabled: boolean;
}

export interface NotificationListEnvelope {
  items: NotificationItem[];
  nextCursor: string | null;
  unread: number;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  categories: {},
  soundEnabled: true,
  desktopEnabled: false,
};

/** Canonical categories in display order — keep in sync with the backend. */
export const ALL_NOTIFICATION_CATEGORIES: string[] = [
  'friend_request',
  'friend_request_accepted',
  'match_invitation',
  'match_invitation_accepted',
  'match_started',
  'private_message',
  'wallet_deposit',
  'wallet_withdrawal',
  'kyc_approved',
  'kyc_rejected',
  'kyc_needs_more_info',
  'tournament',
  'achievement_unlocked',
  'support_ticket',
  'admin_announcement',
  'account_warning',
];

export const NOTIFICATION_CATEGORY_LABELS: Record<string, string> = {
  friend_request: 'Friend requests',
  friend_request_accepted: 'Friend request accepted',
  match_invitation: 'Match challenges',
  match_invitation_accepted: 'Challenge accepted',
  match_started: 'Match started',
  private_message: 'Private messages',
  wallet_deposit: 'Wallet deposits',
  wallet_withdrawal: 'Wallet withdrawals',
  kyc_approved: 'KYC approved',
  kyc_rejected: 'KYC rejected',
  kyc_needs_more_info: 'KYC more info needed',
  tournament: 'Tournaments',
  admin_announcement: 'Announcements',
  support_ticket: 'Support updates',
  achievement_unlocked: 'Achievements',
  account_warning: 'Account warnings',
};

export const NOTIFICATION_CATEGORY_DESCRIPTIONS: Record<string, string> = {
  friend_request: 'Someone wants to add you as a friend',
  friend_request_accepted: 'One of your friend requests was accepted',
  match_invitation: 'A friend challenges you to a match',
  match_invitation_accepted: 'A friend accepts your challenge',
  match_started: 'Your match has started — both players are ready',
  private_message: 'New direct messages from friends',
  wallet_deposit: 'A deposit was credited to your wallet',
  wallet_withdrawal: 'Withdrawal requests, approvals, and rejections',
  kyc_approved: 'Your identity verification was approved',
  kyc_rejected: 'Your identity verification was rejected',
  kyc_needs_more_info: 'Verification needs more information',
  tournament: 'Tournament registration, start, and results',
  admin_announcement: 'Broadcast announcements from the team',
  support_ticket: 'Replies and status changes on your support tickets',
  achievement_unlocked: 'Achievements you have earned',
  account_warning: 'Warnings about your account',
};

/** Static destination for a category. Dynamic deep links (match, message) come from the item's actionUrl. */
const CATEGORY_LINKS: Record<string, string> = {
  friend_request: '/friends',
  friend_request_accepted: '/friends',
  match_invitation: '/invitations',
  wallet_deposit: '/wallet',
  wallet_withdrawal: '/wallet',
  kyc_approved: '/settings/verification',
  kyc_rejected: '/settings/verification',
  kyc_needs_more_info: '/settings/verification',
  tournament: '/tournaments',
  admin_announcement: '/',
  achievement_unlocked: '/profile',
  account_warning: '/settings',
};

/** Categories whose real destination is a per-item deep link set server-side. */
const DYNAMIC_LINK_CATEGORIES = new Set(['match_started', 'match_invitation_accepted', 'private_message']);

export function resolveNotificationLink(item: NotificationItem): string | null {
  if (DYNAMIC_LINK_CATEGORIES.has(item.category) && item.actionUrl) return item.actionUrl;
  return CATEGORY_LINKS[item.category] ?? null;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  friend_request: UserPlus,
  friend_request_accepted: Check,
  match_invitation: Swords,
  match_invitation_accepted: Swords,
  match_started: Timer,
  private_message: MessageCircle,
  wallet_deposit: Wallet,
  wallet_withdrawal: Wallet,
  kyc_approved: ShieldCheck,
  kyc_rejected: ShieldX,
  kyc_needs_more_info: ShieldAlert,
  tournament: Trophy,
  admin_announcement: Megaphone,
  support_ticket: LifeBuoy,
  achievement_unlocked: Award,
  account_warning: Bell,
};

export function notificationIcon(category: string): LucideIcon {
  return CATEGORY_ICONS[category] ?? Bell;
}

export function notificationCategoryLabel(category: string): string {
  return NOTIFICATION_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

// ============================================================================
// DELIVERY HELPERS (sound + desktop notifications)
// ============================================================================

let audioCtx: AudioContext | null = null;

/** Soft two-tone chime synthesized via WebAudio — no asset file, no autoplay breakage. */
export function playNotificationSound(): void {
  try {
    if (typeof window === 'undefined') return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume().catch(() => {});
    const now = audioCtx.currentTime;
    for (const [freq, offset] of [
      [880, 0],
      [1174.66, 0.12],
    ] as const) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    }
  } catch {
    // Audio must never break a notification.
  }
}

export function desktopNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopNotificationsPermission(): NotificationPermission | 'unsupported' {
  if (!desktopNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestDesktopNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!desktopNotificationsSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function showDesktopNotification(title: string, body: string, url?: string): void {
  try {
    if (!desktopNotificationsSupported() || Notification.permission !== 'granted') return;
    const notification = new Notification(title, { body, icon: '/icon.svg', tag: 'finger-chess' });
    notification.onclick = () => {
      window.focus();
      if (url) window.location.href = url;
      notification.close();
    };
  } catch {
    // Desktop notifications are best-effort.
  }
}
