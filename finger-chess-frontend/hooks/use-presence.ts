'use client';

import { useEffect } from 'react';
import { useSocial } from '@/components/providers/social-provider';
import type { PresenceStatus } from '@/hooks/use-social-socket';

// Non-friend users don't get server-pushed presence updates (the /social
// socket only broadcasts friends), so arbitrary rosters (tournament
// participants, match opponents) poll the privacy-aware REST endpoint on an
// interval. 30s is a fair middle ground between freshness and traffic.
const REFRESH_MS = 30_000;

/**
 * Tracks live presence for a set of user ids. Merges the real-time friend
 * pushes that the socket already provides with periodic REST refreshes for
 * everyone else, exposing a stable statusFor/lastSeenFor API for pages.
 */
export function usePresence(userIds: string[] | null | undefined) {
  const { presenceMap, lastSeenMap, fetchPresence } = useSocial();
  const ids = userIds ?? [];

  useEffect(() => {
    if (ids.length === 0) return;
    const tick = () => {
      // Skip while the tab is hidden — browsers throttle timers there anyway,
      // and refreshing presence for an invisible user is pure waste.
      if (document.visibilityState === 'visible') fetchPresence(ids);
    };
    const onVisibility = () => {
      // Catch up immediately on reveal instead of waiting for the next tick.
      if (document.visibilityState === 'visible') fetchPresence(ids);
    };
    tick();
    const interval = setInterval(tick, REFRESH_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')]);

  return {
    statusFor: (id: string): PresenceStatus | undefined => presenceMap[id],
    lastSeenFor: (id: string): string | null | undefined => lastSeenMap[id],
  };
}
