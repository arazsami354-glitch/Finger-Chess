'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FORMAT_LABELS,
  STATUS_LABELS,
  entryLabel,
  formatTimeControl,
  isRegistrationOpen,
  statusVariant,
  type Tournament,
} from '@/lib/tournaments';
import {
  TournamentToolbar,
  type TournamentSort,
  type TournamentStatusFilter,
} from '@/components/tournaments/tournament-toolbar';
import { CountdownPhrase } from '@/components/tournaments/countdown';
import { RegistrationProgress } from '@/components/tournaments/registration-progress';
import { Clock, RotateCw, Search, Swords, Trophy, Users, Wallet } from 'lucide-react';

interface MyRegistration {
  tournamentId: string;
  status: string;
  seed: number | null;
  finalRank: number | null;
  prizeAmount: number | null;
  tournament: Tournament;
}

const FILTER_PREDICATES: Record<TournamentStatusFilter, (t: Tournament) => boolean> = {
  all: () => true,
  open: (t) => t.status === 'draft' || t.status === 'registered',
  live: (t) => t.status === 'active',
  completed: (t) => t.status === 'completed',
};

const SORTERS: Record<TournamentSort, (a: Tournament, b: Tournament) => number> = {
  startTime: (a, b) => (a.startTime ? new Date(a.startTime).getTime() : Infinity) - (b.startTime ? new Date(b.startTime).getTime() : Infinity),
  newest: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  prizePool: (a, b) => b.prizePool - a.prizePool,
};

export default function TournamentsPage() {
  const [upcoming, setUpcoming] = useState<Tournament[] | null>(null);
  const [mine, setMine] = useState<MyRegistration[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TournamentStatusFilter>('all');
  const [sort, setSort] = useState<TournamentSort>('startTime');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [upcomingRes, mineRes] = await Promise.all([api.get('/tournaments'), api.get('/tournaments/mine')]);
      setUpcoming(upcomingRes.data);
      setMine(mineRes.data);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Could not load tournaments');
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onJoin = useCallback(async (t: Tournament) => {
    setBusyId(t.id);
    try {
      const { data } = await api.post(`/tournaments/${t.id}/register`);
      if (data.waitlisted) toast.info('You are on the waitlist — a spot will open if a player withdraws.');
      else toast.success(`You are registered for "${t.name}"`);
      await refresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message ?? 'Could not register');
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const onWithdraw = useCallback(async (id: string) => {
    setBusyId(id);
    try {
      await api.post(`/tournaments/${id}/withdraw`);
      toast.success('Withdrawn');
      await refresh();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message ?? 'Could not withdraw');
    } finally {
      setBusyId(null);
    }
  }, [refresh]);

  const myByTournament = useMemo(() => new Map((mine ?? []).map((r) => [r.tournamentId, r])), [mine]);

  const filteredUpcoming = useMemo(() => {
    if (!upcoming) return [];
    const q = search.trim().toLowerCase();
    return upcoming
      .filter((t) => FILTER_PREDICATES[filter](t))
      .filter((t) => !q || t.name.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q))
      .sort(SORTERS[sort]);
  }, [upcoming, search, filter, sort]);

  return (
    <AppShell>
      <div className="space-y-10">
        <div className="animate-fade-up">
          <h1 className="font-display font-bold text-2xl">Tournaments</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compete for prizes against the field. Entry fees are escrowed until the tournament settles, then paid out to the top finishers.
          </p>
        </div>

        {mine !== null && mine.length > 0 && (
          <section className="space-y-4 animate-fade-up [animation-delay:60ms] [animation-fill-mode:backwards]">
            <h2 className="font-display font-semibold text-lg">Your tournaments</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {mine.map((r) => (
                <TournamentCard
                  key={r.tournamentId}
                  t={r.tournament}
                  registration={r.status}
                  busy={busyId === r.tournamentId}
                  onJoin={() => onJoin(r.tournament)}
                  onWithdraw={() => onWithdraw(r.tournamentId)}
                />
              ))}
            </div>
          </section>
        )}

        <section className="space-y-4 animate-fade-up [animation-delay:100ms] [animation-fill-mode:backwards]">
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold text-lg">Open &amp; upcoming</h2>
              {upcoming !== null && !error && (
                <TournamentToolbar
                  search={search}
                  onSearch={setSearch}
                  filter={filter}
                  onFilter={setFilter}
                  sort={sort}
                  onSort={setSort}
                  shown={filteredUpcoming.length}
                  total={upcoming.length}
                />
              )}
            </div>

            {error ? (
              <Card>
                <CardContent className="pt-6">
                  <EmptyState
                    icon={Trophy}
                    title="Couldn't load tournaments"
                    description={error}
                    action={
                      <Button variant="outline" size="sm" onClick={refresh}>
                        <RotateCw className="h-3.5 w-3.5 mr-1.5" /> Try again
                      </Button>
                    }
                  />
                </CardContent>
              </Card>
            ) : upcoming === null ? (
              <div className="grid gap-4 md:grid-cols-2" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <Card key={i}>
                    <CardContent className="pt-5 space-y-4">
                      <Skeleton className="h-5 w-1/2" />
                      <Skeleton className="h-4 w-full" />
                      <div className="grid grid-cols-3 gap-2">
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                        <Skeleton className="h-16" />
                      </div>
                      <Skeleton className="h-4 w-2/3" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : filteredUpcoming.length === 0 ? (
              <Card>
                <CardContent>
                  <EmptyState
                    icon={search || filter !== 'all' ? Search : Trophy}
                    title={search || filter !== 'all' ? 'No tournaments match' : 'No tournaments right now'}
                    description={
                      search || filter !== 'all'
                        ? 'Try a different search or clear the filters.'
                        : 'Check back soon — new tournaments are opened by our team regularly.'
                    }
                    action={
                      search || filter !== 'all' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSearch('');
                            setFilter('all');
                          }}
                        >
                          Clear filters
                        </Button>
                      ) : undefined
                    }
                  />
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {filteredUpcoming.map((t) => {
                  const reg = myByTournament.get(t.id);
                  return (
                    <TournamentCard
                      key={t.id}
                      t={t}
                      registration={reg?.status}
                      busy={busyId === t.id}
                      onJoin={() => onJoin(t)}
                      onWithdraw={() => onWithdraw(t.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function TournamentCard({
  t,
  registration,
  busy,
  onJoin,
  onWithdraw,
}: {
  t: Tournament;
  registration?: string;
  busy: boolean;
  onJoin: () => void;
  onWithdraw: () => void;
}) {
  const now = Date.now();
  const open = isRegistrationOpen(t, now);

  const timingLabel = (() => {
    if (open && t.registrationDeadline) {
      return <CountdownPhrase target={t.registrationDeadline} label="Registration closes in" expiredLabel="Registration closed" />;
    }
    if (t.status === 'registered' || t.status === 'draft') {
      return t.startTime ? <CountdownPhrase target={t.startTime} label="Starts in" expiredLabel="Starting now" /> : <span>Start time TBA</span>;
    }
    if (t.status === 'active') return <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-gain animate-pulse" /> Live now</span>;
    if (t.status === 'completed') return <span>Ended</span>;
    return <span>Start time TBA</span>;
  })();

  return (
    <Link
      href={`/tournaments/${t.id}`}
      className="block group rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <Card className="h-full surface-interactive transition-colors group-hover:border-primary/40 group-focus-visible:border-primary/60">
        <CardContent className="pt-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-display font-semibold text-lg truncate group-hover:text-primary transition-colors">{t.name}</h3>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <Badge variant={statusVariant(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</Badge>
                <Badge variant="secondary">{FORMAT_LABELS[t.format] ?? t.format}</Badge>
                {t.entryType === 'paid' && t.entryFee > 0 && (
                  <Badge variant="outline">
                    <Wallet className="h-3 w-3 mr-1" /> {entryLabel(t)}
                  </Badge>
                )}
              </div>
            </div>
            {registration && (
              <Badge variant={registration === 'waitlisted' ? 'warn' : 'gain'}>
                {registration === 'waitlisted' ? 'Waitlisted' : 'Registered'}
              </Badge>
            )}
          </div>

          {t.description && <p className="text-sm text-muted-foreground line-clamp-2">{t.description}</p>}

          <div className="grid grid-cols-3 gap-2 text-sm">
            <div className="rounded-md bg-secondary/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Players
              </div>
              <div className="font-mono font-medium mt-0.5">
                {t.playerCount}/{t.maxPlayers}
                {t.waitlistCount ? ` +${t.waitlistCount} wl` : ''}
              </div>
            </div>
            <div className="rounded-md bg-secondary/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Trophy className="h-3.5 w-3.5" /> Prize pool
              </div>
              <div className="font-mono font-medium mt-0.5">${t.prizePool.toFixed(2)}</div>
            </div>
            <div className="rounded-md bg-secondary/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" /> Time control
              </div>
              <div className="font-mono font-medium mt-0.5">{formatTimeControl(t.timeControl)}</div>
            </div>
          </div>

          {open && (
            <RegistrationProgress count={t.playerCount ?? 0} max={t.maxPlayers} aria-label={`${t.playerCount} of ${t.maxPlayers} players registered`} />
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">{timingLabel}</span>
            <span onClick={(e) => e.preventDefault()}>
              {registration === 'waitlisted' ? (
                <Button variant="outline" size="sm" onClick={onWithdraw} disabled={busy}>
                  Leave waitlist
                </Button>
              ) : registration === 'registered' ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onWithdraw}
                  disabled={busy || t.status === 'active'}
                  className={t.status === 'active' ? 'opacity-50 cursor-not-allowed' : ''}
                >
                  Withdraw
                </Button>
              ) : open ? (
                <Button size="sm" onClick={onJoin} disabled={busy}>
                  <Swords className="h-3.5 w-3.5" /> {t.entryType === 'paid' && t.entryFee > 0 ? `Join · ${entryLabel(t)}` : 'Join'}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t.status === 'active' ? 'Live now' : t.status === 'completed' ? 'Ended' : 'Closed'}</span>
              )}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
