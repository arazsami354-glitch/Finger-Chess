'use client';

import { BookOpen, CalendarDays, MapPin, Users } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { PresenceDot, PresenceLabel } from '@/components/social/presence-dot';
import { TitleBadge } from '@/components/profile/title-badge';
import { countryName, flagEmoji, type PlayerProfile } from '@/lib/profile';

function formatMemberSince(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function formatLastSeen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function ProfileHeader({
  profile,
  liveStatus,
  liveLastSeen,
  actions,
}: {
  profile: PlayerProfile | null;
  liveStatus?: string | null;
  liveLastSeen?: string | null;
  actions?: React.ReactNode;
}) {
  if (!profile) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        <Skeleton className="h-28 w-full rounded-none" />
        <div className="p-5 pt-0">
          <Skeleton className="h-20 w-20 rounded-full ring-4 ring-card -mt-10" />
          <Skeleton className="mt-4 h-6 w-48" />
          <Skeleton className="mt-2 h-4 w-72 max-w-full" />
          <Skeleton className="mt-3 h-4 w-96 max-w-full" />
        </div>
      </div>
    );
  }

  const initials = (profile.fullName || 'Player').slice(0, 2).toUpperCase();
  const country = countryName(profile.countryCode);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="relative h-28 sm:h-36">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/30 via-gold/25 to-primary/30" />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'conic-gradient(hsla(var(--gold),0.16) 90deg, transparent 90deg, transparent 180deg, hsla(var(--gold),0.16) 180deg, hsla(var(--gold),0.16) 270deg, transparent 270deg)',
            backgroundSize: '24px 24px',
          }}
        />
      </div>

      <div className="px-5 pb-5 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-end sm:gap-4">
            <Avatar className="h-20 w-20 rounded-2xl border-4 border-card bg-secondary shadow-premium sm:-mt-10 sm:h-24 sm:w-24 sm:rounded-2xl">
              {profile.avatarUrl && (
                <AvatarImage src={profile.avatarUrl} alt={profile.fullName ?? 'Player'} />
              )}
              <AvatarFallback className="bg-primary/15 text-lg text-primary">{initials}</AvatarFallback>
            </Avatar>

            <div className="min-w-0">
              <div className="mt-3 flex flex-wrap items-center gap-2 sm:mt-0">
                <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">
                  {profile.fullName || 'Player'}
                </h1>
                <TitleBadge title={profile.title} />
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <PresenceDot status={liveStatus ?? undefined} />
                  <PresenceLabel status={liveStatus ?? undefined} />
                  {liveStatus === 'offline' && liveLastSeen && (
                    <span className="text-muted-foreground/80">· last seen {formatLastSeen(liveLastSeen)}</span>
                  )}
                </span>
                {country && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {flagEmoji(profile.countryCode!)} {country}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Member since {formatMemberSince(profile.memberSince)}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {profile.friendsCount} {profile.friendsCount === 1 ? 'friend' : 'friends'}
                </span>
              </div>
            </div>
          </div>

          {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>

        {profile.bio && (
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{profile.bio}</p>
        )}

        {profile.favoriteOpening && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-1.5 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 text-gold" />
            Favorite opening: <span className="font-medium text-foreground">{profile.favoriteOpening.name}</span>
            <span className="text-muted-foreground/70">· {profile.favoriteOpening.count}×</span>
          </div>
        )}
      </div>
    </div>
  );
}
