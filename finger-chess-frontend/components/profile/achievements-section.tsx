'use client';

import { Check, Trophy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProfileAnalytics } from '@/lib/profile';

export function AchievementsSection({
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
          <Skeleton className="h-5 w-52" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  const achievements = analytics?.achievements ?? [];
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-gold" />
          Achievements
        </CardTitle>
        <span className="text-xs text-muted-foreground">
          {unlockedCount} / {achievements.length} unlocked
        </span>
      </CardHeader>
      <CardContent>
        {achievements.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No achievements available yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {achievements.map((a) => {
              const ratio = a.threshold > 0 ? Math.min(a.progress / a.threshold, 1) : a.unlocked ? 1 : 0;
              const pct = Math.round(ratio * 100);
              return (
                <div
                  key={a.id}
                  className={`rounded-lg border p-3 transition-colors ${
                    a.unlocked ? 'border-gold/40 bg-gold/5' : 'border-border bg-secondary/20'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg ${
                        a.unlocked ? 'bg-gold/20' : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      {a.icon && a.icon.length <= 2 ? a.icon : <Trophy className={`h-4 w-4 ${a.unlocked ? 'text-gold' : ''}`} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold">{a.name}</span>
                        {a.unlocked && <Check className="h-4 w-4 shrink-0 text-gain" />}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{a.description}</p>
                    </div>
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>{a.unlocked ? 'Unlocked' : `Progress`}</span>
                      <span className="tabular-nums">
                        {a.threshold > 0 ? `${Math.min(a.progress, a.threshold)} / ${a.threshold}` : '—'}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          a.unlocked ? 'bg-gradient-to-r from-gold to-primary' : 'bg-muted-foreground/40'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
