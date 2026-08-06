/**
 * The canonical set of in-app notification categories. Every producer of a
 * notification must use one of these strings so the notification center,
 * the preference toggles, and the realtime badge all agree on the same set.
 *
 * Keep in sync with the frontend (finger-chess-frontend/lib/notifications.ts).
 */
export const NOTIFICATION_CATEGORIES = [
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
  'admin_announcement',
  'support_ticket',
  'achievement_unlocked',
  'account_warning',
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

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
  friend_request: "Someone wants to add you as a friend",
  friend_request_accepted: "One of your friend requests was accepted",
  match_invitation: "A friend challenges you to a match",
  match_invitation_accepted: "A friend accepts your challenge",
  match_started: 'Your match has started — both players are ready',
  private_message: 'New direct messages from friends',
  wallet_deposit: 'A deposit was credited to your wallet',
  wallet_withdrawal: 'Withdrawal requests, approvals, and rejections',
  kyc_approved: 'Your identity verification was approved',
  kyc_rejected: 'Your identity verification was rejected',
  kyc_needs_more_info: 'Verification needs more information',
  tournament: 'Tournament registration, start, and results',
  admin_announcement: 'Broadcast announcements from the team',
  support_ticket: "Replies and status changes on your support tickets",
  achievement_unlocked: 'Achievements you have earned',
  account_warning: 'Warnings about your account',
};

/** Every category is enabled by default. Only an explicit opt-out stores a row. */
export const DEFAULT_NOTIFICATION_CATEGORIES: Record<string, boolean> = Object.fromEntries(
  NOTIFICATION_CATEGORIES.map((category) => [category, true]),
);

export function isNotificationCategory(value: string): value is NotificationCategory {
  return NOTIFICATION_CATEGORIES.includes(value as NotificationCategory);
}

export interface SendNotificationOptions {
  /** Merge into an existing UNREAD notification with the same key (bump `count`) instead of creating a new row. */
  groupKey?: string;
  /** Deep link to navigate to when the user clicks the notification. */
  actionUrl?: string;
  /** Display name of the actor (friend request sender, etc.) for richer rendering. */
  actorName?: string | null;
}

export interface NotificationPreferencesView {
  categories: Record<string, boolean>;
  soundEnabled: boolean;
  desktopEnabled: boolean;
}
