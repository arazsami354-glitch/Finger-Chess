import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, Button, LoadingRow, EmptyState, StatCard } from '../components/ui';
import { useAuth } from '../auth/AuthContext';

interface UserRef {
  id: string;
  email: string | null;
  fullName?: string | null;
}

interface Signal {
  id: string;
  userId: string;
  signalType: string;
  severity: string;
  details: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  referenceId?: string | null;
  user?: UserRef;
}

interface OverviewData {
  openSignals: number;
  severityCounts: Record<string, number>;
  unreviewedAnticheatFlags: number;
  highRiskUsers: number;
  openCheatingReports: number;
  activeCheatingPenalties: number;
  recentSignals: (Signal & { user?: UserRef })[];
}

interface RiskEvidence {
  type: string;
  category: string;
  severity?: string;
  points: number;
  description: string;
  createdAt?: string;
}

interface RiskScore {
  score: number;
  tier: string;
  components: {
    flaggedAnticheatReports: number;
    openFraudSignals: number;
    linkedAccounts: string[];
    sharedIpAccountCount: number;
    tamperFlags: string[];
    activeCheatingPenalties: number;
    openPlayerReports: number;
  };
  evidence: RiskEvidence[];
}

interface Dossier {
  user: { id: string; email: string | null; fullName: string | null; status: string; kycStatus: string };
  riskScore: RiskScore;
  openSignals: Signal[];
  allSignals: Signal[];
  anticheatReports: { id: string; gameId: string; suspicionScore: number; flagged: boolean; reviewStatus: string; createdAt: string }[];
  penalties: { id: string; penaltyType: string; category: string; reason: string; startedAt: string; endsAt: string | null }[];
  reportsAgainst: { id: string; category: string; status: string; createdAt: string; reporter: UserRef }[];
  recentGames: { id: string; timeControl: string; result: string; entryFee: number; endedAt: string | null; playerWhiteId: string }[];
  notes: { id: string; createdAt: string; metadata: { note?: string; adminId?: string } | null }[];
  securityEvents: { id: string; eventType: string; createdAt: string; metadata: unknown }[];
}

interface PlayerRow {
  latest: Signal;
  count: number;
  severities: string[];
  user?: UserRef;
}

interface MatchRow {
  game: { id: string; timeControl: string; result: string; status: string; entryFee: number; endedAt: string | null; playerWhite: UserRef; playerBlack: UserRef } | undefined;
  signals: Signal[];
}

function tierTone(tier: string): 'loss' | 'warn' | 'default' {
  if (tier === 'critical') return 'loss';
  if (tier === 'high') return 'warn';
  return 'default';
}

function sevTone(sev: string): 'loss' | 'warn' | 'info' | 'default' {
  if (sev === 'critical') return 'loss';
  if (sev === 'high') return 'warn';
  if (sev === 'medium') return 'info';
  return 'default';
}

function fmt(ts?: string | null) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

interface MoveRow {
  id: string;
  moveNumber: number;
  color: string;
  moveSan: string;
  clockRemainingMs: number;
  createdAt: string;
}

interface MatchDetailData {
  game: any;
  moves: MoveRow[];
  signals: Signal[];
  anticheatReports: unknown[];
}

export function FairPlayPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'overview' | 'players' | 'matches'>('overview');
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [players, setPlayers] = useState<PlayerRow[] | null>(null);
  const [matches, setMatches] = useState<MatchRow[] | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [matchDetail, setMatchDetail] = useState<MatchDetailData | null>(null);
  const [loading, setLoading] = useState(true);

  const hasPlayers = can('finance_admin', 'super_admin');
  const hasMatches = can('finance_admin', 'super_admin');

  function loadOverview() {
    api.get('/admin/fairplay/overview').then(({ data }) => setOverview(data)).catch(() => undefined);
  }
  useEffect(() => {
    loadOverview();
    if (hasPlayers) api.get('/admin/fairplay/players').then(({ data }) => setPlayers(data)).catch(() => undefined);
    if (hasMatches) api.get('/admin/fairplay/matches').then(({ data }) => setMatches(data)).catch(() => undefined);
    setLoading(false);
  }, []);

  async function openDossier(userId: string) {
    setDossier(null);
    const { data } = await api.get(`/admin/fairplay/players/${userId}`);
    setDossier(data);
  }

  async function openMatch(gameId: string) {
    setMatchDetail(null);
    const { data } = await api.get(`/admin/fairplay/matches/${gameId}`);
    setMatchDetail(data);
  }

  async function reviewSignal(signalId: string, decision: 'reviewed' | 'dismissed' | 'confirmed') {
    await api.post(`/admin/fairplay/signals/${signalId}/review`, { decision });
    if (dossier) openDossier(dossier.user.id);
    loadOverview();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Fair Play &amp; Anti-Cheat</h1>
          <p className="text-sm text-ink-faint mt-1">
            Detection signals from every game, scored into risk, reviewed by humans. Nothing here auto-punishes — every flag is a review ticket.
          </p>
        </div>
        <Button onClick={() => { setDossier(null); setMatchDetail(null); loadOverview(); }}>Refresh</Button>
      </div>

      <div className="flex gap-1 border-b border-border">
        <TabButton active={tab === 'overview'} onClick={() => setTab('overview')}>Overview</TabButton>
        {hasPlayers && <TabButton active={tab === 'players'} onClick={() => setTab('players')}>Suspicious Players</TabButton>}
        {hasMatches && <TabButton active={tab === 'matches'} onClick={() => setTab('matches')}>Match Review</TabButton>}
      </div>

      {loading && <LoadingRow />}

      {tab === 'overview' && overview && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Open Fair-Play Signals" value={String(overview.openSignals)} tone={overview.openSignals > 0 ? 'warn' : 'default'} />
            <StatCard label="Unreviewed Engine Flags" value={String(overview.unreviewedAnticheatFlags)} tone={overview.unreviewedAnticheatFlags > 0 ? 'warn' : 'default'} />
            <StatCard label="High-Risk Users" value={String(overview.highRiskUsers)} tone={overview.highRiskUsers > 0 ? 'loss' : 'default'} />
            <StatCard label="Open Cheating Reports" value={String(overview.openCheatingReports)} tone={overview.openCheatingReports > 0 ? 'warn' : 'default'} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Panel title="Signals by Severity">
              <div className="flex flex-wrap gap-3">
                {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
                  <div key={s} className="flex items-center gap-2">
                    <Badge tone={sevTone(s)}>{s}</Badge>
                    <span className="font-mono text-lg text-ink">{overview.severityCounts[s] ?? 0}</span>
                  </div>
                ))}
                <div className="ml-auto text-xs text-ink-faint self-center">{overview.activeCheatingPenalties} active cheating penalty records</div>
              </div>
            </Panel>

            <Panel title="Recent Signals">
              {overview.recentSignals.length === 0 ? (
                <EmptyState message="No recent fair-play signals." />
              ) : (
                <div className="space-y-2.5">
                  {overview.recentSignals.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                      <div className="min-w-0">
                        <div className="text-ink truncate">{s.user?.fullName || s.user?.email || s.userId}</div>
                        <div className="text-xs text-ink-faint font-mono truncate">{s.signalType}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge tone={sevTone(s.severity)}>{s.severity}</Badge>
                        <span className="text-xs text-ink-faint font-mono">{fmt(s.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}

      {tab === 'players' && players && (
        <Panel title={`Suspicious Players (${players.length})`}>
          {players.length === 0 ? (
            <EmptyState message="No players currently carry an open fair-play or high-risk flag." />
          ) : (
            <div className="-m-5">
              <table className="w-[calc(100%+2.5rem)]">
                <thead>
                  <tr>
                    <th className="th">Player</th>
                    <th className="th">Open Signals</th>
                    <th className="th">Severity</th>
                    <th className="th">Latest Flag</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.latest.userId}>
                      <td className="td">
                        <div className="text-sm">{p.user?.fullName || p.user?.email}</div>
                        <div className="text-xs text-ink-faint">{p.user?.email}</div>
                      </td>
                      <td className="td font-mono text-sm">{p.count}</td>
                      <td className="td">{p.severities.map((s) => <Badge key={s} tone={sevTone(s)}>{s}</Badge>)}</td>
                      <td className="td text-xs text-ink-faint">
                        <div className="font-mono truncate max-w-56">{p.latest.signalType}</div>
                        <div className="font-mono">{fmt(p.latest.createdAt)}</div>
                      </td>
                      <td className="td text-right">
                        <Button onClick={() => openDossier(p.latest.userId)}>Dossier</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {tab === 'matches' && matches && (
        <Panel title={`Flagged Match Review Queue (${matches.length})`}>
          {matches.length === 0 ? (
            <EmptyState message="No games currently carry a fair-play flag." />
          ) : (
            <div className="-m-5">
              <table className="w-[calc(100%+2.5rem)]">
                <thead>
                  <tr>
                    <th className="th">Match</th>
                    <th className="th">Players</th>
                    <th className="th">Signals</th>
                    <th className="th">Result</th>
                    <th className="th"></th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.game?.id}>
                      <td className="td font-mono text-xs">{m.game?.id.slice(0, 8)}</td>
                      <td className="td text-sm">
                        {m.game?.playerWhite.email} <span className="text-ink-faint">vs</span> {m.game?.playerBlack.email}
                      </td>
                      <td className="td">
                        {m.signals.slice(0, 2).map((s) => <Badge key={s.id} tone={sevTone(s.severity)}>{s.signalType}</Badge>)}
                        {m.signals.length > 2 && <span className="text-xs text-ink-faint ml-1">+{m.signals.length - 2}</span>}
                      </td>
                      <td className="td text-xs">{m.game?.result}</td>
                      <td className="td text-right">
                        <Button onClick={() => openMatch(m.game!.id)}>Review</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {dossier && <DossierView dossier={dossier} onClose={() => setDossier(null)} onSignalReview={reviewSignal} onRefresh={() => openDossier(dossier.user.id)} />}
      {matchDetail && <MatchDetailView match={matchDetail} onClose={() => setMatchDetail(null)} />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm border-b-2 transition-colors ${
        active ? 'border-brass text-ink font-medium' : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function DossierView({
  dossier,
  onClose,
  onSignalReview,
  onRefresh,
}: {
  dossier: Dossier;
  onClose: () => void;
  onSignalReview: (signalId: string, decision: 'reviewed' | 'dismissed' | 'confirmed') => void;
  onRefresh: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function addNote() {
    if (note.trim().length < 3) return;
    setBusy(true);
    try {
      await api.post(`/admin/fairplay/players/${dossier.user.id}/notes`, { note: note.trim() });
      setNote('');
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: 'reviewed' | 'actioned') {
    setBusy(true);
    try {
      await api.post(`/admin/fairplay/players/${dossier.user.id}/review`, { decision, note: note.trim() || undefined });
      setNote('');
      onRefresh();
    } finally {
      setBusy(false);
    }
  }

  const risk = dossier.riskScore;

  return (
    <div className="fixed inset-0 z-40 bg-canvas/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="panel w-full max-w-5xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-display font-semibold tracking-wide text-ink">Player Dossier — {dossier.user.fullName || dossier.user.email}</h3>
            <div className="text-xs text-ink-faint mt-0.5">{dossier.user.email} · {dossier.user.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone="default">{dossier.user.status}</Badge>
            <Button onClick={onClose}>Close</Button>
          </div>
        </div>

        <div className="p-5 space-y-6">
          <div className="flex items-center gap-4">
            <div className="panel p-4">
              <div className="text-xs uppercase tracking-wider text-ink-muted mb-1">Risk Score</div>
              <Badge tone={tierTone(risk.tier)}>{risk.score}/100 · {risk.tier}</Badge>
            </div>
            <div className="panel p-4 text-xs text-ink-faint space-y-1">
              <div>{risk.components.flaggedAnticheatReports} engine-use flag(s)</div>
              <div>{risk.components.openFraudSignals} open signal(s)</div>
              <div>{risk.components.linkedAccounts.length} linked account(s)</div>
              <div>{risk.components.sharedIpAccountCount} shared-IP account(s)</div>
              <div>{risk.components.activeCheatingPenalties} active cheating penalty(ies)</div>
              <div>{risk.components.openPlayerReports} open cheating report(s)</div>
            </div>
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Why this score — evidence</h4>
            {risk.evidence.length === 0 ? (
              <div className="text-sm text-ink-faint">No contributing factors.</div>
            ) : (
              <div className="space-y-1.5">
                {risk.evidence.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="font-mono text-xs text-ink-faint w-14 shrink-0">+{e.points}</span>
                    <span className="text-ink min-w-0 flex-1 truncate">{e.description}</span>
                    {e.severity && <Badge tone={sevTone(e.severity)}>{e.severity}</Badge>}
                    <span className="text-xs text-ink-faint font-mono">{e.createdAt ? fmt(e.createdAt) : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Open Signals ({dossier.openSignals.length})</h4>
            {dossier.openSignals.length === 0 ? (
              <div className="text-sm text-ink-faint">No open signals.</div>
            ) : (
              <div className="space-y-2">
                {dossier.openSignals.map((s) => (
                  <div key={s.id} className="border border-border rounded-md p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm text-ink font-mono">{s.signalType}</div>
                      <div className="text-xs text-ink-faint font-mono truncate">#{s.id.slice(0, 8)} · {fmt(s.createdAt)}</div>
                      {s.details && <div className="text-xs text-ink-faint truncate">{JSON.stringify(s.details)}</div>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge tone={sevTone(s.severity)}>{s.severity}</Badge>
                      <Button disabled={busy} onClick={() => onSignalReview(s.id, 'dismissed')}>Dismiss</Button>
                      <Button disabled={busy} onClick={() => onSignalReview(s.id, 'confirmed')}>Confirm</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Engine-Use Reports</h4>
            {dossier.anticheatReports.length === 0 ? (
              <div className="text-sm text-ink-faint">None analyzed yet.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dossier.anticheatReports.map((r) => (
                  <Badge key={r.id} tone={r.flagged ? 'loss' : 'default'}>
                    {r.suspicionScore.toFixed(0)} · {r.reviewStatus}{r.flagged ? ' · flagged' : ''}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Reports Against ({dossier.reportsAgainst.length})</h4>
              {dossier.reportsAgainst.length === 0 ? (
                <div className="text-sm text-ink-faint">None.</div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {dossier.reportsAgainst.map((r) => (
                    <div key={r.id} className="flex justify-between gap-2">
                      <span className="text-ink truncate">{r.category}</span>
                      <span className="text-xs text-ink-faint font-mono">{fmt(r.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}

              <h4 className="text-xs uppercase tracking-wider text-ink-muted mt-5 mb-2">Penalties ({dossier.penalties.length})</h4>
              {dossier.penalties.length === 0 ? (
                <div className="text-sm text-ink-faint">None.</div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {dossier.penalties.map((p) => (
                    <div key={p.id} className="flex justify-between gap-2">
                      <span className="text-ink truncate">{p.penaltyType} · {p.category}</span>
                      <span className="text-xs text-ink-faint font-mono">{fmt(p.startedAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Recent Games ({dossier.recentGames.length})</h4>
              {dossier.recentGames.length === 0 ? (
                <div className="text-sm text-ink-faint">None.</div>
              ) : (
                <div className="space-y-1.5 text-sm">
                  {dossier.recentGames.map((g) => {
                    const won = (g.playerWhiteId === dossier.user.id && g.result === 'white_win') || (g.playerWhiteId !== dossier.user.id && g.result === 'black_win');
                    return (
                      <div key={g.id} className="flex justify-between gap-2">
                        <span className="text-ink font-mono truncate">{g.timeControl}</span>
                        <span className={won ? 'text-gain' : 'text-loss'}>{g.result}</span>
                        <span className="text-xs text-ink-faint font-mono">{fmt(g.endedAt)}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              <h4 className="text-xs uppercase tracking-wider text-ink-muted mt-5 mb-2">Investigation Notes</h4>
              {dossier.notes.length === 0 ? (
                <div className="text-sm text-ink-faint">No notes yet.</div>
              ) : (
                <div className="space-y-2">
                  {dossier.notes.map((n) => (
                    <div key={n.id} className="border border-border rounded-md p-2 text-sm">
                      <div className="text-ink whitespace-pre-wrap">{n.metadata?.note}</div>
                      <div className="text-xs text-ink-faint mt-1 font-mono">{fmt(n.createdAt)}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 flex gap-2">
                <input
                  className="flex-1 rounded-md border border-border bg-canvas px-3 py-1.5 text-sm text-ink"
                  placeholder="Add investigation note…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <Button disabled={busy || note.trim().length < 3} onClick={addNote}>Add note</Button>
                <Button disabled={busy} tone="danger" onClick={() => decide('actioned')}>Mark actioned</Button>
                <Button disabled={busy} onClick={() => decide('reviewed')}>Mark reviewed</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MatchDetailView({ match, onClose }: { match: MatchDetailData; onClose: () => void }) {
  const game = match.game;
  return (
    <div className="fixed inset-0 z-40 bg-canvas/80 backdrop-blur-sm flex items-start justify-center p-6 overflow-y-auto">
      <div className="panel w-full max-w-4xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h3 className="text-sm font-display font-semibold tracking-wide text-ink">Match Review</h3>
            <div className="text-xs text-ink-faint mt-0.5 font-mono">{game?.id} · {game?.timeControl} · {game?.result}</div>
          </div>
          <Button onClick={onClose}>Close</Button>
        </div>

        <div className="p-5 space-y-6">
          <div className="text-sm text-ink">
            <span className="text-ink-faint">White:</span> {game?.playerWhite?.email} &nbsp;·&nbsp; <span className="text-ink-faint">Black:</span> {game?.playerBlack?.email}
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Signals ({match.signals.length})</h4>
            {match.signals.length === 0 ? (
              <div className="text-sm text-ink-faint">None.</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {match.signals.map((s) => <Badge key={s.id} tone={sevTone(s.severity)}>{s.signalType} · {s.userId.slice(0, 8)}</Badge>)}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs uppercase tracking-wider text-ink-muted mb-2">Moves ({match.moves.length}) — clock remaining per move</h4>
            <div className="max-h-96 overflow-y-auto border border-border rounded-md">
              <table className="w-full">
                <thead className="sticky top-0 bg-surface-raised">
                  <tr>
                    <th className="th">#</th>
                    <th className="th">Color</th>
                    <th className="th">Move</th>
                    <th className="th">Clock left (ms)</th>
                    <th className="th">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {match.moves.map((m) => (
                    <tr key={m.id}>
                      <td className="td font-mono text-xs">{m.moveNumber}</td>
                      <td className="td text-xs">{m.color}</td>
                      <td className="td font-mono">{m.moveSan}</td>
                      <td className="td font-mono text-xs">{m.clockRemainingMs.toLocaleString()}</td>
                      <td className="td text-xs text-ink-faint font-mono">{fmt(m.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
