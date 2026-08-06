'use client';

import Link from 'next/link';
import { Crown, Medal, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { formatMediumDate, type ProfileAnalytics } from '@/lib/profile';

export function TournamentsSection({
  analytics,
  loading,
}: {
  analytics: ProfileAnalytics | null;
  loading?: boolean;
}) {
  if (loading && !analytics) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-44" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  const tournament = analytics?.tournament;

  const summary: { label: string; value: string | number; icon: React.ReactNode }[] = tournament
    ? [
        { label: 'Joined', value: tournament.joined, icon: <Trophy className="h-4 w-4 text-primary" /> },
        { label: 'Finished', value: tournament.finished, icon: <Medal className="h-4 w-4 text-primary" /> },
        { label: 'Wins', value: tournament.wins, icon: <Crown className="h-4 w-4 text-gold" /> },
        { label: 'Best Rank', value: tournament.bestRank ?? '—', icon: <Trophy className="h-4 w-4 text-gold" /> },
        { label: 'Prizes Won', value: tournament.prizes > 0 ? `$${tournament.prizes.toFixed(2)}` : '$0.00', icon: <Medal className="h-4 w-4 text-gold" /> },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-gold" />
          Tournaments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!tournament || tournament.joined === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No tournaments joined yet.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {summary.map((s) => (
                <div key={s.label} className="rounded-lg border border-border bg-secondary/40 p-3 text-center">
                  <div className="flex justify-center text-muted-foreground">{s.icon}</div>
                  <div className="mt-1.5 font-mono text-lg font-semibold">{s.value}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{s.label}</div>
                </div>
              ))}
            </div>

            <div className="divide-y divide-border rounded-lg border border-border">
              {tournament.history.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No tournament finishes recorded yet.
                </p>
              ) : (
                tournament.history.map((t) => {
                  const placed = t.finalRank !== null && t.finalRank <= 3;
                  return (
                    <Link
                      key={t.tournamentId}
                      href={`/tournaments/${t.tournamentId}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-secondary/40"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{t.name}</span>
                          {t.finalRank === 1 && (
                            <Crown className="h-3.5 w-3.5 shrink-0 text-gold" />
                          )}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {t.timeControl || t.format} · {formatMediumDate(t.joinedAt ?? t.endedAt)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {placed && (
                          <Badge variant="gold">#{t.finalRank}</Badge>
                        )}
                        {t.prizeAmount > 0 && (
                          <span className="font-mono text-xs font-semibold text-gain">
                            +${Number(t.prizeAmount).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
