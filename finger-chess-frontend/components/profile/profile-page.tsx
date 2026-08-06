'use client';

import { useEffect, useRef, useState } from 'react';
import { Award, ShieldAlert } from 'lucide-react';
import { useSocial } from '@/components/providers/social-provider';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ProfileHeader } from '@/components/profile/profile-header';
import { StatsGrid } from '@/components/profile/stats-grid';
import { AnalyticsSection } from '@/components/profile/analytics-section';
import { TournamentsSection } from '@/components/profile/tournaments-section';
import { AchievementsSection } from '@/components/profile/achievements-section';
import { MatchHistory } from '@/components/profile/match-history';
import type { PlayerProfile, ProfileAnalytics } from '@/lib/profile';

export function ProfilePage({
  playerId,
  actions,
  onProfileChange,
}: {
  playerId: string;
  actions?: React.ReactNode;
  onProfileChange?: (profile: PlayerProfile | null) => void;
}) {
  const { presenceMap, lastSeenMap } = useSocial();
  const onProfileChangeRef = useRef(onProfileChange);
  onProfileChangeRef.current = onProfileChange;
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [analytics, setAnalytics] = useState<ProfileAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setAnalytics(null);
    setError(null);

    api
      .get<PlayerProfile>(`/social/players/${playerId}`)
      .then(({ data }) => {
        if (cancelled) return;
        setProfile(data);
        onProfileChangeRef.current?.(data);
      })
      .catch((err: any) => {
        if (cancelled) return;
        onProfileChangeRef.current?.(null);
        if (err.response?.status === 403) {
          setError('This profile is not viewable (blocked or private).');
        } else if (err.response?.status === 404) {
          setError('This player could not be found.');
        } else {
          setError(err.response?.data?.message ?? 'Could not load profile.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [playerId]);

  useEffect(() => {
    let cancelled = false;
    if (!profile) return;
    setAnalyticsLoading(true);

    api
      .get<ProfileAnalytics>(`/social/players/${playerId}/analytics`)
      .then(({ data }) => {
        if (!cancelled) setAnalytics(data);
      })
      .catch(() => {
        if (!cancelled) setAnalytics(null);
      })
      .finally(() => {
        if (!cancelled) setAnalyticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [profile, playerId]);

  if (error) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Profile unavailable"
        description={error}
        className="mx-auto max-w-lg"
      />
    );
  }

  const liveStatus = (presenceMap[playerId] as string | undefined) ?? profile?.presenceStatus ?? null;
  const liveLastSeen = lastSeenMap[playerId] ?? profile?.lastSeenAt ?? null;

  return (
    <div className="space-y-6">
      <ProfileHeader
        profile={profile}
        liveStatus={liveStatus}
        liveLastSeen={liveLastSeen}
        actions={actions}
      />

      {profile && profile.badges.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Award className="h-3.5 w-3.5" /> Badges:
          </span>
          {profile.badges.map((b) => (
            <Badge key={b.id} variant={b.tier === 'premium' ? 'gold' : 'secondary'}>
              {b.name}
            </Badge>
          ))}
        </div>
      )}

      <StatsGrid profile={profile} />

      {profile?.stats && (
        <>
          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">Advanced Analytics</h2>
            <AnalyticsSection analytics={analytics} loading={analyticsLoading} />
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">Tournaments</h2>
            <TournamentsSection analytics={analytics} loading={analyticsLoading} />
          </div>

          <div>
            <h2 className="mb-3 font-display text-lg font-semibold">Achievements</h2>
            <AchievementsSection analytics={analytics} loading={analyticsLoading} />
          </div>
        </>
      )}

      <MatchHistory
        playerId={playerId}
        timeControlOptions={analytics?.timeControls?.map((tc) => ({ label: tc.label })) ?? undefined}
      />
    </div>
  );
}
