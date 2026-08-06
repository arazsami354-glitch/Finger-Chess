'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useSocialSocket } from '@/hooks/use-social-socket';

type SocialContextValue = ReturnType<typeof useSocialSocket>;

const SocialContext = createContext<SocialContextValue | undefined>(undefined);

export function SocialProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const social = useSocialSocket({
    // A challenge I SENT was accepted — jump straight into the game.
    onInvitationAccepted: ({ gameId }) => router.push(`/play/${gameId}`),
  });

  // The hook's return object is a fresh reference every render. Memoize it on
  // the actual state values so the context value only changes when some state
  // really changed — otherwise a single presence heartbeat or typing indicator
  // would re-render every useSocial consumer (the whole app shell, friend
  // lists, notification center, message views) for nothing. All the functions
  // are stable useCallbacks, so only the state fields need to be deps.
  const value = useMemo(
    () => social,
    // `social` itself is a fresh reference every render (the whole point of
    // this memo), so it can't be a dep — the state fields below ARE the
    // memo's inputs. All functions on the object are stable useCallbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      social.connected,
      social.presenceMap,
      social.lastSeenMap,
      social.incomingMessages,
      social.typingByConversation,
      social.deliveryUpdates,
      social.readUpdates,
      social.notificationCount,
      social.incomingNotifications,
      social.notificationPreferences,
      social.incomingInvitations,
      social.pendingInvitationCount,
    ],
  );

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>;
}

export function useSocial() {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial must be used within SocialProvider');
  return ctx;
}
