import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client';
import { Panel, StatCard, LoadingRow, Badge } from '../components/ui';

interface Overview {
  users: { total: number; newToday: number };
  games: {
    activeNow: number;
    playedToday: number;
    free: { activeNow: number; playedToday: number };
    paid: { activeNow: number; playedToday: number };
  };
  revenue: { today: number };
  platformFunds: { available: number; locked: number; pending: number };
  queues: {
    pendingWithdrawals: number;
    pendingRefunds: number;
    openFraudSignals: number;
    unreviewedAnticheatFlags: number;
    openSupportTickets: number;
    driftedWallets: number;
    pendingKycDocuments: number;
  };
}

interface PresenceOverview {
  onlineNow: number;
  totalUsers: number;
  byStatus: Record<string, number>;
  recent: { userId: string; fullName: string | null; email: string; status: string; lastSeenAt: string }[];
}

const PRESENCE_STATUS_META: Record<string, { label: string; tone: 'default' | 'gain' | 'loss' | 'warn' | 'info' }> = {
  online: { label: 'Online', tone: 'gain' },
  away: { label: 'Away', tone: 'warn' },
  do_not_disturb: { label: 'Do Not Disturb', tone: 'loss' },
  invisible: { label: 'Invisible', tone: 'default' },
  in_match: { label: 'In Match', tone: 'info' },
  in_tournament: { label: 'In Tournament', tone: 'info' },
  spectating: { label: 'Spectating', tone: 'info' },
};

const PRESENCE_POLL_MS = 30_000;

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function DashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [series, setSeries] = useState<{ date: string; revenue: number }[]>([]);
  const [presence, setPresence] = useState<PresenceOverview | null>(null);

  useEffect(() => {
    api.get('/admin/dashboard/overview').then(({ data }) => setOverview(data));
    api.get('/admin/reports/revenue/series').then(({ data }) => setSeries(data));
  }, []);

  // Presence is REST-polled (no socket client in the admin app). Bounded scan
  // on the server, small payload — a 30s poll is plenty for an ops view.
  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .get('/admin/presence/overview')
        .then(({ data }) => {
          if (active) setPresence(data);
        })
        .catch(() => {});
    load();
    const interval = setInterval(load, PRESENCE_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  if (!overview) return <LoadingRow />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="Revenue Today" value={`$${overview.revenue.today.toFixed(2)}`} tone="gain" />
        <StatCard
          label="Active Games"
          value={String(overview.games.activeNow)}
          sublabel={`${overview.games.free.activeNow} free · ${overview.games.paid.activeNow} paid`}
        />
        <StatCard label="Total Users" value={String(overview.users.total)} sublabel={`+${overview.users.newToday} today`} />
        <StatCard
          label="Platform Funds"
          value={`$${(overview.platformFunds.available + overview.platformFunds.locked + overview.platformFunds.pending).toFixed(2)}`}
          sublabel={`$${overview.platformFunds.locked.toFixed(2)} in escrow`}
        />
      </div>

      <Panel title="Revenue — Last 30 Days">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262C39" />
              <XAxis dataKey="date" stroke="#5B6274" fontSize={11} tickLine={false} />
              <YAxis stroke="#5B6274" fontSize={11} tickLine={false} width={50} />
              <Tooltip
                contentStyle={{ background: '#1D222C', border: '1px solid #262C39', borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: '#8891A3' }}
              />
              <Line type="monotone" dataKey="revenue" stroke="#C9A24B" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      <div className="grid grid-cols-3 gap-4">
        <QueueCard label="Pending Withdrawals" value={overview.queues.pendingWithdrawals} href="/wallet" />
        <QueueCard label="Pending Refunds" value={overview.queues.pendingRefunds} href="/wallet" />
        <QueueCard label="Open Fraud Signals" value={overview.queues.openFraudSignals} href="/fraud" />
        <QueueCard label="Unreviewed Anti-Cheat Flags" value={overview.queues.unreviewedAnticheatFlags} href="/games" />
        <QueueCard label="Open Support Tickets" value={overview.queues.openSupportTickets} href="/support" />
        <QueueCard label="Wallets With Drift" value={overview.queues.driftedWallets} href="/wallet" />
        <QueueCard label="KYC Pending Review" value={overview.queues.pendingKycDocuments} href="/verification" />
      </div>

      <PresencePanel presence={presence} />
    </div>
  );
}

function PresencePanel({ presence }: { presence: PresenceOverview | null }) {
  if (!presence) return null;
  const statuses = Object.entries(PRESENCE_STATUS_META).filter(([key]) => (presence.byStatus[key] ?? 0) > 0);
  return (
    <Panel
      title="Live Presence"
      action={
        <span className="inline-flex items-center gap-2 text-xs text-ink-faint font-mono">
          <span className={`h-2 w-2 rounded-full ${presence.onlineNow > 0 ? 'bg-gain animate-pulse' : 'bg-ink-faint'}`} />
          online now
        </span>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-4">
          <div className="text-sm">
            <span className="font-mono text-xl font-semibold text-gain">{presence.onlineNow}</span>
            <span className="text-ink-faint ml-1.5">/ {presence.totalUsers} active users online</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {statuses.length === 0 && <span className="text-xs text-ink-faint">No members in the live window.</span>}
            {statuses.map(([key, meta]) => (
              <Badge key={key} tone={meta.tone}>
                {meta.label}: {presence.byStatus[key] ?? 0}
              </Badge>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted mb-2">Most recently active</div>
          {presence.recent.length === 0 ? (
            <p className="text-sm text-ink-faint">No users online right now.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {presence.recent.map((u) => {
                const meta = PRESENCE_STATUS_META[u.status] ?? { label: u.status, tone: 'default' as const };
                return (
                  <div key={u.userId} className="rounded border border-border bg-surface-raised/50 px-3 py-2 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm truncate">{u.fullName ?? u.email}</div>
                      <div className="text-[11px] text-ink-faint truncate">{u.email}</div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0">
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <span className="text-[10px] text-ink-faint">{relativeTime(u.lastSeenAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function QueueCard({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <a href={href} className="panel p-4 flex items-center justify-between hover:border-brass/50 transition-colors">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className={`font-mono text-lg font-semibold ${value > 0 ? 'text-warn' : 'text-ink-faint'}`}>{value}</span>
    </a>
  );
}
