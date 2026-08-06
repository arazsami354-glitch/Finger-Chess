import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Panel, Badge, Button, EmptyState, LoadingRow } from '../components/ui';

interface Tournament {
  id: string;
  name: string;
  description: string | null;
  format: string;
  visibility: string;
  entryType: string;
  entryFee: number;
  prizePool: number;
  maxPlayers: number;
  minPlayers: number;
  registrationDeadline: string | null;
  startTime: string | null;
  timeControl: string;
  status: string;
  currentRound: number;
  rounds: number | null;
  settings: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  cancellationReason: string | null;
  playerCount?: number;
  waitlistCount?: number;
}

interface DetailedMatch {
  id: string;
  round: number;
  bracket: string;
  slot: number;
  status: string;
  result: string | null;
  winnerUserId: string | null;
  whiteUser: { id: string; email: string; fullName: string | null } | null;
  blackUser: { id: string; email: string; fullName: string | null } | null;
  gameId: string | null;
}

interface StandingsEntry {
  id: string;
  name: string | null;
  email: string | null;
  rating: number | null;
  score: number;
  buchholz: number;
  byesTaken: number;
}

interface RegisteredPlayer {
  id: string;
  userId: string;
  status: 'registered' | 'waitlisted' | 'eliminated';
  seed: number | null;
  joinedAt: string;
  email: string;
  fullName: string | null;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  registered: 'Open',
  active: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const FORMAT_LABELS: Record<string, string> = {
  single_elimination: 'Single Elim',
  double_elimination: 'Double Elim',
  swiss: 'Swiss',
};

const TIME_CONTROLS = [
  'bullet_1_0',
  'bullet_2_1',
  'blitz_3_0',
  'blitz_3_2',
  'blitz_5_0',
  'blitz_5_3',
  'rapid_10_0',
  'rapid_15_10',
  'classical_30_0',
  'classical_60_0',
];

function statusTone(status: string): 'default' | 'gain' | 'loss' | 'warn' | 'info' {
  switch (status) {
    case 'active':
      return 'gain';
    case 'registered':
      return 'info';
    case 'cancelled':
      return 'loss';
    case 'completed':
      return 'default';
    default:
      return 'warn';
  }
}

export function TournamentsPage() {
  const { can } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [overview, setOverview] = useState<{ status: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState<Tournament | null>(null);
  const [detail, setDetail] = useState<{
    standings: StandingsEntry[];
    bracket: DetailedMatch[];
    edges: { fromMatchId: string; toMatchId: string }[];
    players: RegisteredPlayer[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const isFin = can('finance_admin', 'super_admin');

  function load() {
    setLoading(true);
    Promise.all([
      api
        .get('/admin/tournaments', { params: { search: search || undefined, statuses: statusFilter || undefined } })
        .then(({ data }) => setTournaments(data)),
      api.get('/admin/tournaments/overview').then(({ data }) => setOverview(data)),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [search, statusFilter]);

  async function openDetail(t: Tournament) {
    setSelected(t);
    setDetailLoading(true);
    setDetail(null);
    try {
      const { data } = await api.get(`/admin/tournaments/${t.id}`);
      setDetail({
        standings: data.standings ?? [],
        bracket: data.bracket ?? [],
        edges: data.edges ?? [],
        players: data.players ?? [],
      });
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function action(t: Tournament, kind: 'publish' | 'start' | 'cancel', reason?: string) {
    const body = kind === 'cancel' ? { reason: reason ?? 'Cancelled by admin' } : {};
    await api.post(`/admin/tournaments/${t.id}/${kind}`, body);
    load();
    if (selected?.id === t.id) openDetail(t);
  }

  async function removePlayer(t: Tournament, userId: string) {
    try {
      await api.post(`/admin/tournaments/${t.id}/players/${userId}/remove`);
    } catch {
      // ignore — the button state resets and the list is reloaded below
    }
    load();
    if (selected?.id === t.id) openDetail(t);
  }

  const counts = useMemo(() => {
    const map = Object.fromEntries(overview.map((o) => [o.status, o.count]));
    return {
      draft: map.draft ?? 0,
      registered: map.registered ?? 0,
      active: map.active ?? 0,
      completed: map.completed ?? 0,
    };
  }, [overview]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Tournaments</h1>
        {isFin && (
          <Button tone="brass" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Close form' : 'New Tournament'}
          </Button>
        )}
      </div>

      {showCreate && isFin && <CreateTournamentForm onCreated={() => { setShowCreate(false); load(); }} />}

      <div className="grid grid-cols-4 gap-4">
        {(['draft', 'registered', 'active', 'completed'] as const).map((s) => (
          <div key={s} className="panel p-5">
            <div className="text-xs uppercase tracking-wider text-ink-muted mb-2">{STATUS_LABELS[s]}</div>
            <div className="font-mono text-2xl font-semibold text-ink">{counts[s]}</div>
          </div>
        ))}
      </div>

      <Panel
        title={`All tournaments (${tournaments.length})`}
        action={
          <div className="flex gap-3">
            <input className="input w-56" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input w-40" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABELS).map(([v, label]) => (
                <option key={v} value={v}>{label}</option>
              ))}
            </select>
          </div>
        }
      >
        {loading ? (
          <LoadingRow />
        ) : tournaments.length === 0 ? (
          <EmptyState message="No tournaments match your filters." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">Name</th>
                <th className="th">Format</th>
                <th className="th">Entry</th>
                <th className="th">Prize Pool</th>
                <th className="th">Players</th>
                <th className="th">Status</th>
                <th className="th">Starts</th>
              </tr>
            </thead>
            <tbody>
              {tournaments.map((t) => (
                <tr key={t.id} className="cursor-pointer hover:bg-surface-raised/40" onClick={() => openDetail(t)}>
                  <td className="td font-medium text-ink">{t.name}</td>
                  <td className="td">{FORMAT_LABELS[t.format] ?? t.format}</td>
                  <td className="td font-mono">{t.entryType === 'paid' ? `$${t.entryFee.toFixed(2)}` : 'Free'}</td>
                  <td className="td font-mono">${t.prizePool.toFixed(2)}</td>
                  <td className="td font-mono">
                    {t.playerCount}/{t.maxPlayers}
                    {t.waitlistCount ? ` +${t.waitlistCount} WL` : ''}
                  </td>
                  <td className="td"><Badge tone={statusTone(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</Badge></td>
                  <td className="td text-xs text-ink-faint font-mono">{t.startTime ? new Date(t.startTime).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {selected && (
        <TournamentDetail t={selected} detail={detail} loading={detailLoading} isFin={isFin} onAction={action} onRemovePlayer={removePlayer} />
      )}
    </div>
  );
}

function TournamentDetail({
  t,
  detail,
  loading,
  isFin,
  onAction,
  onRemovePlayer,
}: {
  t: Tournament;
  detail: {
    standings: StandingsEntry[];
    bracket: DetailedMatch[];
    edges: { fromMatchId: string; toMatchId: string }[];
    players: RegisteredPlayer[];
  } | null;
  loading: boolean;
  isFin: boolean;
  onAction: (t: Tournament, kind: 'publish' | 'start' | 'cancel', reason?: string) => Promise<void>;
  onRemovePlayer: (t: Tournament, userId: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  const registrationsOpen = t.status === 'draft' || t.status === 'registered';

  const bracketRounds = useMemo(() => {
    if (!detail) return [];
    const groups = new Map<string, DetailedMatch[]>();
    for (const m of detail.bracket) {
      const key = `${m.round}${m.bracket === 'main' ? '' : ` · ${m.bracket}`}`;
      groups.set(key, [...(groups.get(key) ?? []), m]);
    }
    return [...groups.entries()];
  }, [detail]);

  return (
    <Panel
      title={`${t.name} — ${t.currentRound > 0 ? `Round ${t.currentRound}${t.rounds ? `/${t.rounds}` : ''}` : 'Not started'}`}
      action={
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(t.status)}>{STATUS_LABELS[t.status] ?? t.status}</Badge>
          {isFin && t.status === 'draft' && (
            <>
              <Button onClick={() => onAction(t, 'publish')}>Publish</Button>
              <Button tone="danger" onClick={() => onAction(t, 'cancel', 'Cancelled by admin')}>Cancel</Button>
            </>
          )}
          {isFin && t.status === 'registered' && (
            <>
              <Button tone="brass" onClick={() => onAction(t, 'start')}>Start</Button>
              <Button tone="danger" onClick={() => onAction(t, 'cancel', 'Cancelled by admin')}>Cancel</Button>
            </>
          )}
        </div>
      }
    >
      <div className="mb-4 text-sm text-ink-muted">
        <span className="font-mono">{FORMAT_LABELS[t.format] ?? t.format}</span>
        {' · '}
        <span className="font-mono">{t.entryType === 'paid' ? `$${t.entryFee.toFixed(2)} entry` : 'free entry'}</span>
        {' · '}
        <span className="font-mono">${t.prizePool.toFixed(2)} pool</span>
        {' · '}
        <span className="font-mono">{t.timeControl.replace(/_/g, ' ')}</span>
        {' · '}
        <span>{t.visibility}</span>
        {t.description && <p className="mt-2 text-ink-faint">{t.description}</p>}
      </div>

      {loading ? (
        <LoadingRow />
      ) : !detail ? (
        <EmptyState message="Nothing to show for this tournament yet." />
      ) : registrationsOpen && detail.players.length > 0 ? (
        <table className="-m-5 w-[calc(100%+2.5rem)]">
          <thead>
            <tr>
              <th className="th">Player</th>
              <th className="th">Status</th>
              <th className="th">Seed</th>
              <th className="th">Joined</th>
              {isFin && <th className="th text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {detail.players.map((p) => (
              <tr key={p.id}>
                <td className="td">
                  <span className="font-medium text-ink">{p.fullName ?? p.email}</span>
                  <span className="ml-2 text-xs text-ink-faint font-mono">{p.email}</span>
                </td>
                <td className="td">
                  <Badge tone={p.status === 'registered' ? 'gain' : p.status === 'waitlisted' ? 'warn' : 'default'}>
                    {p.status}
                  </Badge>
                </td>
                <td className="td font-mono text-ink-faint">{p.seed ?? '—'}</td>
                <td className="td text-xs text-ink-faint font-mono">{new Date(p.joinedAt).toLocaleString()}</td>
                {isFin && (
                  <td className="td text-right">
                    <Button
                      tone="danger"
                      disabled={removing === p.userId}
                      onClick={() => {
                        setRemoving(p.userId);
                        void onRemovePlayer(t, p.userId).finally(() => setRemoving(null));
                      }}
                    >
                      {removing === p.userId ? 'Removing…' : 'Remove'}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      ) : detail.standings.length > 0 ? (
        <table className="-m-5 w-[calc(100%+2.5rem)]">
          <thead>
            <tr>
              <th className="th">#</th>
              <th className="th">Player</th>
              <th className="th">Score</th>
              <th className="th">Buchholz</th>
              <th className="th">Rating</th>
            </tr>
          </thead>
          <tbody>
            {detail.standings.map((s, i) => (
              <tr key={s.id}>
                <td className="td font-mono text-ink-faint">{i + 1}</td>
                <td className="td">{s.name ?? s.email ?? s.id.slice(0, 8)}</td>
                <td className="td font-mono">{s.score}</td>
                <td className="td font-mono">{s.buchholz.toFixed(1)}</td>
                <td className="td font-mono">{s.rating ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : bracketRounds.length > 0 ? (
        <div className="space-y-6">
          {bracketRounds.map(([round, matches]) => (
            <div key={round}>
              <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Round {round}</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {matches.map((m) => {
                  const winnerLabel = m.winnerUserId === m.whiteUser?.id ? 'w' : m.winnerUserId === m.blackUser?.id ? 'b' : null;
                  return (
                    <div key={m.id} className="border border-border rounded p-3 text-sm">
                      <div className="flex items-center justify-between text-ink-muted text-xs mb-2">
                        <span className="font-mono">#{m.slot}</span>
                        <Badge tone={m.status === 'completed' ? 'gain' : m.status === 'ongoing' ? 'info' : 'default'}>
                          {m.status === 'completed' ? 'Done' : m.status === 'ongoing' ? 'Live' : m.status === 'bye' ? 'Bye' : 'Scheduled'}
                        </Badge>
                      </div>
                      <div className="flex flex-col gap-1">
                        <PlayerRow label="W" name={m.whiteUser?.fullName ?? m.whiteUser?.email ?? 'TBD'} win={winnerLabel === 'w'} />
                        <PlayerRow label="B" name={m.blackUser?.fullName ?? m.blackUser?.email ?? 'TBD'} win={winnerLabel === 'b'} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : registrationsOpen ? (
        <EmptyState message="No players registered yet." />
      ) : (
        <EmptyState message="No matches scheduled yet." />
      )}

      {(t.status === 'draft' || t.status === 'registered') && isFin && (
        <div className="mt-5 border-t border-border pt-4 flex gap-2">
          <input className="input flex-1" placeholder="Cancellation reason…" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button tone="danger" onClick={() => onAction(t, 'cancel', reason || 'Cancelled by admin')}>Cancel tournament</Button>
        </div>
      )}
    </Panel>
  );
}

function PlayerRow({ label, name, win }: { label: string; name: string; win: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded px-2 py-1 ${win ? 'bg-gain/10 text-gain' : 'text-ink'}`}>
      <span className="text-xs text-ink-faint w-4">{label}</span>
      <span className="truncate">{name}</span>
      {win && <span className="text-xs font-mono">WIN</span>}
    </div>
  );
}

function CreateTournamentForm({ onCreated }: { onCreated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    description: '',
    format: 'single_elimination',
    visibility: 'public',
    entryType: 'free',
    entryFee: '0',
    prizePool: '0',
    maxPlayers: '16',
    minPlayers: '2',
    timeControl: 'blitz_3_0',
    startTime: '',
    registrationDeadline: '',
    rounds: '',
    seeding: 'none',
    prizeDistribution: '100',
  });

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/tournaments', {
        name: form.name,
        description: form.description || undefined,
        format: form.format,
        visibility: form.visibility,
        entryType: form.entryType,
        entryFee: Number(form.entryFee),
        prizePool: Number(form.prizePool),
        maxPlayers: Number(form.maxPlayers),
        minPlayers: Number(form.minPlayers),
        timeControl: form.timeControl,
        startTime: form.startTime ? new Date(form.startTime).toISOString() : undefined,
        registrationDeadline: form.registrationDeadline ? new Date(form.registrationDeadline).toISOString() : undefined,
        rounds: form.format === 'swiss' && form.rounds ? Number(form.rounds) : undefined,
        seeding: form.seeding,
        prizeDistribution: form.prizeDistribution.split(',').map((p) => Number(p.trim())).filter((p) => !Number.isNaN(p)),
      });
      onCreated();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string | string[] } } };
      const msg = e.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : msg ?? 'Failed to create tournament');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Create tournament" action={<Badge tone="info">draft</Badge>}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Field label="Name *">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Format">
          <select className="input" value={form.format} onChange={(e) => set('format', e.target.value)}>
            <option value="single_elimination">Single Elimination</option>
            <option value="double_elimination">Double Elimination</option>
            <option value="swiss">Swiss</option>
          </select>
        </Field>
        <Field label="Time control">
          <select className="input" value={form.timeControl} onChange={(e) => set('timeControl', e.target.value)}>
            {TIME_CONTROLS.map((tc) => (
              <option key={tc} value={tc}>{tc.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </Field>
        <Field label="Entry type">
          <select className="input" value={form.entryType} onChange={(e) => set('entryType', e.target.value)}>
            <option value="free">Free</option>
            <option value="paid">Paid</option>
          </select>
        </Field>
        <Field label="Entry fee ($)">
          <input className="input" type="number" min="0" value={form.entryFee} onChange={(e) => set('entryFee', e.target.value)} disabled={form.entryType !== 'paid'} />
        </Field>
        <Field label="Prize pool ($)">
          <input className="input" type="number" min="0" value={form.prizePool} onChange={(e) => set('prizePool', e.target.value)} />
        </Field>
        <Field label="Max players">
          <input className="input" type="number" min="2" max="512" value={form.maxPlayers} onChange={(e) => set('maxPlayers', e.target.value)} />
        </Field>
        <Field label="Min players">
          <input className="input" type="number" min="2" max="512" value={form.minPlayers} onChange={(e) => set('minPlayers', e.target.value)} />
        </Field>
        <Field label="Visibility">
          <select className="input" value={form.visibility} onChange={(e) => set('visibility', e.target.value)}>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </Field>
        <Field label="Seeding">
          <select className="input" value={form.seeding} onChange={(e) => set('seeding', e.target.value)}>
            <option value="none">As registered</option>
            <option value="rating">By rating</option>
            <option value="random">Random</option>
          </select>
        </Field>
        <Field label="Start time">
          <input className="input" type="datetime-local" value={form.startTime} onChange={(e) => set('startTime', e.target.value)} />
        </Field>
        <Field label="Registration deadline">
          <input className="input" type="datetime-local" value={form.registrationDeadline} onChange={(e) => set('registrationDeadline', e.target.value)} />
        </Field>
        {form.format === 'swiss' && (
          <Field label="Rounds (1-9)">
            <input className="input" type="number" min="1" max="9" value={form.rounds} onChange={(e) => set('rounds', e.target.value)} />
          </Field>
        )}
        <Field label="Prize split % (comma separated, top→bottom)">
          <input className="input" value={form.prizeDistribution} onChange={(e) => set('prizeDistribution', e.target.value)} />
        </Field>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button tone="brass" onClick={submit} disabled={busy || !form.name.trim()}>{busy ? 'Creating…' : 'Create'}</Button>
        {error && <span className="text-sm text-loss">{error}</span>}
      </div>
    </Panel>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-ink-muted mb-1">{label}</span>
      {children}
    </label>
  );
}
