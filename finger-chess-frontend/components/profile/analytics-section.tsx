'use client';

import { useMemo, useState } from 'react';
import { BarChart3, LineChart, PieChart, Trophy, TrendingUp, Swords } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { AreaLineChart } from '@/components/profile/charts/area-line-chart';
import { BarChart } from '@/components/profile/charts/bar-chart';
import { DonutChart } from '@/components/profile/charts/donut-chart';
import { FormStrip } from '@/components/profile/charts/form-strip';
import { MODE_LABELS, formatShortDate, monthLabel, type ProfileAnalytics } from '@/lib/profile';

function PanelSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-5 w-40" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-40 w-full" />
      </CardContent>
    </Card>
  );
}

function Panel({
  icon,
  title,
  subtitle,
  children,
  className,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="text-muted-foreground">{icon}</span>
            {title}
          </CardTitle>
          {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function AnalyticsSection({
  analytics,
  loading,
}: {
  analytics: ProfileAnalytics | null;
  loading?: boolean;
}) {
  const [mode, setMode] = useState<string | null>(null);

  const modes = analytics?.ratingHistory.map((h) => h.gameMode) ?? [];
  const activeMode = mode && modes.includes(mode) ? mode : modes[0];

  const ratingPoints = useMemo(() => {
    const hist = analytics?.ratingHistory.find((h) => h.gameMode === activeMode);
    return (hist?.points ?? []).map((p) => ({
      label: formatShortDate(p.createdAt),
      value: p.rating,
    }));
  }, [analytics, activeMode]);

  const activityData = useMemo(
    () =>
      (analytics?.monthlyActivity ?? []).map((m) => ({
        label: monthLabel(m.month),
        value: m.games,
        secondary: m.wins,
      })),
    [analytics],
  );

  const performanceData = useMemo(
    () =>
      (analytics?.performanceTrend ?? [])
        .slice(-6)
        .map((p) => ({ label: monthLabel(p.month), value: p.winRate })),
    [analytics],
  );

  if (loading && !analytics) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PanelSkeleton className="lg:col-span-2" />
        <PanelSkeleton />
        <PanelSkeleton />
        <PanelSkeleton className="lg:col-span-2" />
        <PanelSkeleton />
        <PanelSkeleton className="lg:col-span-2" />
        <PanelSkeleton />
      </div>
    );
  }

  if (!analytics) {
    return (
      <Card>
        <CardContent className="pt-6 text-center text-sm text-muted-foreground">
          Analytics are not available for this player.
        </CardContent>
      </Card>
    );
  }

  const winLossSegments = [
    { label: 'Wins', value: analytics.winLoss.wins, color: 'hsl(var(--gain))' },
    { label: 'Losses', value: analytics.winLoss.losses, color: 'hsl(var(--loss))' },
    { label: 'Draws', value: analytics.winLoss.draws, color: 'hsl(var(--gold))' },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Panel
        icon={<LineChart className="h-4 w-4" />}
        title="Rating History"
        subtitle="Tracked per time control"
        className="lg:col-span-2"
        action={
          modes.length > 1 ? (
            <div className="flex flex-wrap gap-1">
              {modes.map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    activeMode === m
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {MODE_LABELS[m] ?? m}
                </button>
              ))}
            </div>
          ) : undefined
        }
      >
        <div className="mt-2">
          <AreaLineChart
            series={[{ name: activeMode, color: 'hsl(var(--primary))', points: ratingPoints }]}
            valueFormatter={(v) => String(v)}
          />
        </div>
      </Panel>

      <Panel
        icon={<PieChart className="h-4 w-4" />}
        title="Win / Loss"
        subtitle="All completed games"
      >
        <div className="mt-2">
          <DonutChart segments={winLossSegments} centerLabel="Games" />
        </div>
      </Panel>

      <Panel
        icon={<TrendingUp className="h-4 w-4" />}
        title="Recent Form"
        subtitle="Last 20 completed games"
      >
        <div className="mt-2">
          <FormStrip form={analytics.recentForm} />
        </div>
      </Panel>

      <Panel
        icon={<BarChart3 className="h-4 w-4" />}
        title="Monthly Activity"
        subtitle="Games per month (wins highlighted)"
        className="lg:col-span-2"
      >
        <div className="mt-2">
          <BarChart data={activityData} valueFormatter={(v) => String(v)} />
        </div>
        <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-primary" /> Games
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-gain" /> Wins
          </span>
        </div>
      </Panel>

      <Panel
        icon={<Swords className="h-4 w-4" />}
        title="Time Controls"
        subtitle="Win rate by control"
      >
        <div className="mt-2 space-y-4">
          {analytics.timeControls.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No completed games yet.</p>
          ) : (
            analytics.timeControls.map((tc) => {
              const pct = tc.games > 0 ? (tc.wins / tc.games) * 100 : 0;
              return (
                <div key={tc.label}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-semibold">{tc.label}</span>
                    <span className="text-muted-foreground">
                      {tc.games} {tc.games === 1 ? 'game' : 'games'} · {Math.round(pct)}% win
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-gold transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Panel>

      <Panel
        icon={<Trophy className="h-4 w-4" />}
        title="Performance Trend"
        subtitle="Win rate by month"
        className="lg:col-span-2"
      >
        <div className="mt-2">
          <AreaLineChart
            series={[{ name: 'Win rate', color: 'hsl(var(--gold))', points: performanceData }]}
            valueFormatter={(v) => `${v}%`}
          />
        </div>
      </Panel>

      <Panel icon={<Trophy className="h-4 w-4" />} title="Favorite Openings" subtitle="Top 5 from recent games">
        <div className="mt-2 space-y-3">
          {analytics.openings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Not enough games to classify openings yet.</p>
          ) : (
            analytics.openings.map((o, i) => (
              <div key={o.name} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="w-4 text-xs tabular-nums text-muted-foreground">#{i + 1}</span>
                  <span className="truncate font-medium">{o.name}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{o.count}×</span>
              </div>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
