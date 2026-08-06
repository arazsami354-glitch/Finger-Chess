'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { useSocial } from '@/components/providers/social-provider';
import { usePresence } from '@/hooks/use-presence';
import type { PresenceStatus } from '@/hooks/use-social-socket';
import { PresenceDot } from '@/components/social/presence-dot';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FORMAT_LABELS,
  STATUS_LABELS,
  entryLabel,
  statusVariant,
  type DetailedMatch,
  type StandingsEntry,
  type Tournament,
} from '@/lib/tournaments';
import { ArrowLeft, Calendar, Clock, Crown, Swords, Trophy, Users, Wallet } from 'lucide-react';

interface TournamentDetail extends Tournament {
  myRegistration: { status: string; seed: number | null; finalRank: number | null; prizeAmount: number | null } | null;
  standings: StandingsEntry[] | null;
  bracket: DetailedMatch[] | null;
  edges: { fromMatchId: string; toMatchId: string }[];
}

export default function TournamentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/tournaments/${id}`);
      setDetail(data);
      setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e.response?.data?.message ?? 'Could not load tournament');
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // While viewing a live tournament the user is registered in, reflect the
  // "In Tournament" presence state. Reverted when they leave the page; the
  // backend remembers their manual status and restores it after any match.
  const { setStatus } = useSocial();
  const registered = !!detail?.myRegistration;
  const tournamentLive = !!detail && (detail.status === 'active' || detail.status === 'registered');
  useEffect(() => {
    if (!tournamentLive || !registered) return;
    setStatus('in_tournament');
    return () => setStatus('online');
  }, [tournamentLive, registered, setStatus]);

  const onJoin = useCallback(async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`/tournaments/${id}/register`);
      if (data.waitlisted) toast.info('You are on the waitlist — a spot will open if a player withdraws.');
      else toast.success('You are registered');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message ?? 'Could not register');
    } finally {
      setBusy(false);
    }
  }, [id, load]);

  const onWithdraw = useCallback(async () => {
    setBusy(true);
    try {
      await api.post(`/tournaments/${id}/withdraw`);
      toast.success('Withdrawn');
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      toast.error(e.response?.data?.message ?? 'Could not withdraw');
    } finally {
      setBusy(false);
    }
  }, [id, load]);

  if (error) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto">
          <Card>
            <CardContent className="pt-6">
              <EmptyState icon={Trophy} title="Tournament unavailable" description={error} />
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  if (!detail) {
    return (
      <AppShell>
        <LoadingPanel label="Loading tournament…" />
      </AppShell>
    );
  }

  const now = Date.now();
  const registrationOpen = (detail.status === 'draft' || detail.status === 'registered') && (!detail.registrationDeadline || new Date(detail.registrationDeadline).getTime() >= now);
  const reg = detail.myRegistration;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>

        <div className="animate-fade-up">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(detail.status)}>{STATUS_LABELS[detail.status] ?? detail.status}</Badge>
            <Badge variant="secondary">{FORMAT_LABELS[detail.format] ?? detail.format}</Badge>
            <Badge variant="outline">{detail.visibility}</Badge>
          </div>
          <h1 className="font-display font-bold text-3xl mt-3">{detail.name}</h1>
          {detail.description && <p className="text-muted-foreground text-sm mt-2 max-w-2xl">{detail.description}</p>}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-up [animation-delay:60ms] [animation-fill-mode:backwards]">
          <Stat icon={Users} label="Players" value={`${detail.playerCount}/${detail.maxPlayers}${detail.waitlistCount ? ` (${detail.waitlistCount} waiting)` : ''}`} />
          <Stat icon={Wallet} label="Entry" value={entryLabel(detail)} />
          <Stat icon={Trophy} label="Prize pool" value={`$${detail.prizePool.toFixed(2)}`} />
          <Stat icon={Clock} label="Time control" value={detail.timeControl.replace(/_/g, ' ')} />
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground animate-fade-up [animation-delay:100ms] [animation-fill-mode:backwards]">
          <span className="inline-flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {detail.startTime ? `Starts ${new Date(detail.startTime).toLocaleString()}` : 'Start time TBA'}
          </span>
          {detail.registrationDeadline && (
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Registration closes {new Date(detail.registrationDeadline).toLocaleString()}
            </span>
          )}
          {detail.rounds && <span>Rounds: {detail.rounds}</span>}
          {detail.cancellationReason && <span className="text-destructive">Cancelled: {detail.cancellationReason}</span>}
        </div>

        {reg && (
          <div className="flex flex-wrap items-center gap-3 animate-fade-up [animation-delay:140ms] [animation-fill-mode:backwards]">
            <Badge variant={reg.status === 'waitlisted' ? 'warn' : 'gain'}>
              {reg.status === 'waitlisted' ? 'You are waitlisted' : 'You are registered'}
            </Badge>
            {reg.seed != null && <span className="text-xs text-muted-foreground font-mono">Seed #{reg.seed}</span>}
            {reg.finalRank != null && (
              <span className="inline-flex items-center gap-1 text-xs font-mono text-gold">
                <Crown className="h-3.5 w-3.5" /> Finished #{reg.finalRank}
                {reg.prizeAmount != null && reg.prizeAmount > 0 ? ` · won $${reg.prizeAmount.toFixed(2)}` : ''}
              </span>
            )}
            {registrationOpen && reg.status !== 'waitlisted' && (
              <Button variant="outline" size="sm" onClick={onWithdraw} disabled={busy}>
                Withdraw
              </Button>
            )}
            {registrationOpen && reg.status === 'waitlisted' && (
              <Button variant="outline" size="sm" onClick={onWithdraw} disabled={busy}>
                Leave waitlist
              </Button>
            )}
          </div>
        )}

        {!reg && registrationOpen && (
          <div className="animate-fade-up [animation-delay:160ms] [animation-fill-mode:backwards]">
            <Button onClick={onJoin} disabled={busy}>
              <Swords className="h-4 w-4" /> {detail.entryType === 'paid' && detail.entryFee > 0 ? `Join · ${entryLabel(detail)}` : 'Join tournament'}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              {detail.entryType === 'paid' && detail.entryFee > 0
                ? `Your ${entryLabel(detail)} is escrowed on entry and returned if you withdraw before the tournament starts, or captured only when the tournament runs.`
                : 'Free to enter — registration is instant.'}
            </p>
          </div>
        )}

        <TournamentBody detail={detail} />

        {detail.status === 'completed' && (
          <Card className="animate-fade-up">
            <CardHeader>
              <CardTitle className="text-base">Final payout summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Prizes are credited automatically from the escrowed entry fees once all matches settle. Your finish and winnings (if any) appear above.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function TournamentBody({ detail }: { detail: TournamentDetail }) {
  const [view, setView] = useState<'standings' | 'bracket'>('standings');

  const hasStandings = (detail.standings?.length ?? 0) > 0;
  const hasBracket = (detail.bracket?.length ?? 0) > 0;
  const active = detail.status === 'active' || detail.status === 'completed';

  if (!active) {
    return (
      <Card className="animate-fade-up">
        <CardContent className="pt-6">
          <EmptyState icon={Calendar} title="Not started yet" description="The bracket and standings appear here once the tournament goes live." />
        </CardContent>
      </Card>
    );
  }

  if (hasStandings && hasBracket) {
    return (
      <div className="space-y-4 animate-fade-up">
        <div className="flex gap-2">
          <Button size="sm" variant={view === 'standings' ? 'default' : 'outline'} onClick={() => setView('standings')}>
            Standings
          </Button>
          <Button size="sm" variant={view === 'bracket' ? 'default' : 'outline'} onClick={() => setView('bracket')}>
            Bracket
          </Button>
        </div>
        {view === 'standings' ? <StandingsTable standings={detail.standings} /> : <Bracket bracket={detail.bracket} />}
      </div>
    );
  }

  if (hasStandings) return <StandingsTable standings={detail.standings} />;
  if (hasBracket) return <Bracket bracket={detail.bracket} />;

  return (
    <Card>
      <CardContent className="pt-6">
        <EmptyState icon={Calendar} title="No matches yet" description="Matches will appear here as rounds are paired." />
      </CardContent>
    </Card>
  );
}

function StandingsTable({ standings }: { standings: StandingsEntry[] | null }) {
  const { statusFor } = usePresence(standings?.map((s) => s.id) ?? []);
  if (!standings) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Standings</CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-5 py-2 text-left font-medium">#</th>
              <th className="px-5 py-2 text-left font-medium">Player</th>
              <th className="px-5 py-2 text-right font-medium">Score</th>
              <th className="px-5 py-2 text-right font-medium">Buchholz</th>
              <th className="px-5 py-2 text-right font-medium">Rating</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0">
                <td className="px-5 py-2.5 font-mono text-muted-foreground">{i + 1}</td>
                <td className="px-5 py-2.5 font-medium">
                  <span className="inline-flex items-center gap-2">
                    <PresenceDot status={statusFor(s.id)} />
                    <Link href={`/players/${s.id}`} className="hover:text-primary transition-colors">
                      {s.name ?? s.email ?? s.id.slice(0, 8)}
                    </Link>
                  </span>
                </td>
                <td className="px-5 py-2.5 font-mono text-right">{s.score}</td>
                <td className="px-5 py-2.5 font-mono text-right text-muted-foreground">{s.buchholz.toFixed(1)}</td>
                <td className="px-5 py-2.5 font-mono text-right text-muted-foreground">{s.rating ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function Bracket({ bracket }: { bracket: DetailedMatch[] | null }) {
  const participantIds = bracket
    ? [...new Set(bracket.flatMap((m) => [m.whiteUser?.id, m.blackUser?.id].filter((id): id is string => !!id)))]
    : [];
  const { statusFor } = usePresence(participantIds);

  if (!bracket) return null;

  const rounds = new Map<string, DetailedMatch[]>();
  for (const m of bracket) {
    const key = m.bracket === 'main' ? `Round ${m.round}` : `Round ${m.round} · ${m.bracket}`;
    rounds.set(key, [...(rounds.get(key) ?? []), m]);
  }

  return (
    <div className="space-y-6">
      {[...rounds.entries()].map(([label, matches]) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle className="text-sm">{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {matches.map((m) => {
                const whiteWon = m.winnerUserId != null && m.winnerUserId === m.whiteUser?.id;
                const blackWon = m.winnerUserId != null && m.winnerUserId === m.blackUser?.id;
                const over = m.status === 'completed' || m.status === 'bye';
                return (
                  <div key={m.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-mono">#{m.slot}</span>
                      <Badge variant={m.status === 'completed' ? 'gain' : m.status === 'ongoing' ? 'default' : 'outline'}>
                        {m.status === 'completed' ? 'Finished' : m.status === 'ongoing' ? 'In progress' : m.status === 'bye' ? 'Bye' : 'Scheduled'}
                      </Badge>
                    </div>
                    <MatchRow label="W" name={m.whiteUser?.fullName ?? m.whiteUser?.email ?? 'TBD'} win={whiteWon} userId={m.whiteUser?.id} statusFor={statusFor} />
                    <MatchRow label="B" name={m.blackUser?.fullName ?? m.blackUser?.email ?? 'TBD'} win={blackWon} userId={m.blackUser?.id} statusFor={statusFor} />
                    {over && m.result && <div className="text-[11px] font-mono text-muted-foreground pt-1 border-t border-border/50">{m.result}</div>}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MatchRow({
  label,
  name,
  win,
  userId,
  statusFor,
}: {
  label: string;
  name: string;
  win: boolean;
  userId?: string;
  statusFor?: (id: string) => PresenceStatus | undefined;
}) {
  const status = userId && statusFor ? statusFor(userId) : undefined;
  return (
    <div className={`flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${win ? 'bg-gain/10 text-gain' : 'text-foreground'}`}>
      <span className="text-xs text-muted-foreground w-4">{label}</span>
      <span className="truncate inline-flex items-center gap-2 min-w-0">
        {userId && <PresenceDot status={status} />}
        <span className="truncate">{name}</span>
      </span>
      {win && <Crown className="h-3.5 w-3.5 shrink-0" />}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <Card className="surface-interactive">
      <CardContent className="pt-4">
        <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
          <Icon className="h-3.5 w-3.5" /> {label}
        </div>
        <div className="font-mono font-semibold truncate">{value}</div>
      </CardContent>
    </Card>
  );
}
