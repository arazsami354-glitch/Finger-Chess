'use client';

import { Clock, Flame, Gauge, Percent, Swords, Timer, Trophy } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MODE_LABELS, formatAvgMoveTime, formatGameDuration, type PlayerProfile } from '@/lib/profile';

function StatCard({
  icon,
  label,
  value,
  sub,
  subTone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  subTone?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-center gap-2 text-muted-foreground">
          {icon}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="mt-2 font-mono text-2xl font-semibold leading-none text-foreground">{value}</div>
        {sub && <div className={`mt-2 text-xs ${subTone ?? 'text-muted-foreground'}`}>{sub}</div>}
      </CardContent>
    </Card>
  );
}

export function StatsGrid({ profile }: { profile: PlayerProfile | null }) {
  if (!profile) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-5">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="mt-3 h-7 w-16" />
              <Skeleton className="mt-2 h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const stats = profile.stats;
  const enrich = profile.enrichment;

  if (!stats || !enrich) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          This player&apos;s statistics are private.
        </CardContent>
      </Card>
    );
  }

  const modeLabel = MODE_LABELS[enrich.primaryGameMode] ?? enrich.primaryGameMode;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          label="Peak Rating"
          value={enrich.peakRatingOverall > 0 ? enrich.peakRatingOverall : '—'}
          sub={modeLabel ? `Best in ${modeLabel}` : undefined}
          subTone="text-gold"
        />
        <StatCard
          icon={<Swords className="h-4 w-4 text-primary" />}
          label="Games Played"
          value={stats.gamesPlayed}
          sub={`${stats.wins}W · ${stats.draws}D · ${stats.losses}L`}
        />
        <StatCard
          icon={<Percent className="h-4 w-4 text-gold" />}
          label="Win Rate"
          value={`${stats.winRate}%`}
          sub={`${stats.free.gamesPlayed} free · ${stats.paid.gamesPlayed} paid`}
        />
        <StatCard
          icon={<Flame className="h-4 w-4 text-warn" />}
          label="Current Streak"
          value={enrich.currentStreak}
          sub={enrich.currentStreak === 1 ? '1 game in a row' : `${enrich.currentStreak} in a row`}
          subTone={enrich.currentStreak > 1 ? 'text-gain' : undefined}
        />
        <StatCard
          icon={<Trophy className="h-4 w-4 text-gold" />}
          label="Longest Streak"
          value={enrich.longestStreak}
          sub="Best winning run"
        />
        <StatCard
          icon={<Clock className="h-4 w-4 text-primary" />}
          label="Avg Game Time"
          value={formatGameDuration(enrich.avgGameDurationSeconds)}
          sub="Per completed game"
        />
        <StatCard
          icon={<Timer className="h-4 w-4 text-primary" />}
          label="Avg Move Time"
          value={formatAvgMoveTime(enrich.avgMoveTimeSeconds)}
          sub="Recent games"
        />
        <StatCard
          icon={<Trophy className="h-4 w-4 text-gold" />}
          label="Tournament Wins"
          value={enrich.tournamentWins}
          sub={enrich.title ?? undefined}
          subTone="text-gold"
        />
      </div>

      {stats.ratings.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Ratings by time control
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {stats.ratings.map((r) => (
                <div key={r.gameMode} className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="text-xs text-muted-foreground">
                    {MODE_LABELS[r.gameMode] ?? r.gameMode}
                  </div>
                  <div className="mt-1 font-mono text-xl font-semibold">{r.rating}</div>
                  <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
                    <span>Peak {r.peakRating}</span>
                    <span>{r.gamesPlayed} games</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs font-medium text-muted-foreground">Free Play</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="font-mono text-xl font-semibold">{stats.free.gamesPlayed}</span>
              <span className="text-xs text-muted-foreground">matches</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-mono text-lg font-semibold text-gain">{stats.free.wins} wins</span>
              <span className="text-xs text-muted-foreground">{stats.free.winRate}%</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <div className="text-xs font-medium text-gold">Real Money</div>
            <div className="mt-2 flex items-baseline justify-between">
              <span className="font-mono text-xl font-semibold">{stats.paid.gamesPlayed}</span>
              <span className="text-xs text-muted-foreground">matches</span>
            </div>
            <div className="mt-1 flex items-baseline justify-between">
              <span className="font-mono text-lg font-semibold text-gain">{stats.paid.wins} wins</span>
              <span className="text-xs text-muted-foreground">{stats.paid.winRate}%</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
