import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { api } from '../api/client';
import { FingerChessLogo } from './brand/logo';

interface Overview {
  users: { total: number; newToday: number };
  games: { activeNow: number; playedToday: number };
  revenue: { today: number };
  queues: { pendingWithdrawals: number; openFraudSignals: number; unreviewedAnticheatFlags: number; openSupportTickets: number };
}

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/users', label: 'Users' },
  { to: '/verification', label: 'Identity Verification', roles: ['finance_admin', 'super_admin'] as const },
  { to: '/security', label: 'Risk & Security', roles: ['finance_admin', 'super_admin'] as const },
  { to: '/roles', label: 'Role Permissions' },
  { to: '/wallet', label: 'Wallet Monitoring' },
  { to: '/games', label: 'Game Monitoring' },
  { to: '/reports', label: 'Financial Reports' },
  { to: '/support', label: 'Support Tickets' },
  { to: '/fraud', label: 'Fraud Detection' },
  { to: '/fairplay', label: 'Fair Play' },
  { to: '/tournaments', label: 'Tournaments', roles: ['finance_admin', 'super_admin'] as const },
  { to: '/logs', label: 'System Logs', roles: ['super_admin'] as const },
];

export function AppLayout() {
  const { admin, logout, can } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    api.get('/admin/dashboard/overview').then(({ data }) => setOverview(data)).catch(() => undefined);
    const interval = setInterval(() => {
      api.get('/admin/dashboard/overview').then(({ data }) => setOverview(data)).catch(() => undefined);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen flex">
      <aside className="w-60 shrink-0 border-r border-border bg-surface flex flex-col">
        <div className="px-5 py-5 border-b border-border flex items-center gap-2.5">
          <FingerChessLogo className="h-6 w-6 text-brass shrink-0" />
          <div>
            <div className="font-display font-bold text-lg tracking-tight text-ink">Finger Chess</div>
            <div className="text-xs text-ink-faint mt-0.5">Platform Admin</div>
          </div>
        </div>

        <nav className="flex-1 py-3">
          {NAV_ITEMS.filter((item) => !item.roles || can(...item.roles)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `block px-5 py-2.5 text-sm border-l-2 transition-colors ${
                  isActive
                    ? 'border-brass text-ink bg-surface-raised font-medium'
                    : 'border-transparent text-ink-muted hover:text-ink hover:bg-surface-raised/50'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <div className="text-sm text-ink truncate">{admin?.email}</div>
          <div className="text-xs text-ink-faint mb-3 capitalize">{admin?.role.replace('_', ' ')}</div>
          <button onClick={logout} className="text-xs text-ink-muted hover:text-loss transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Signature element: a live ledger ticker strip — the platform's
            vitals in one glance, always visible regardless of which page
            you're on, styled like a running tape rather than a dashboard card. */}
        <div className="h-11 border-b border-border bg-surface flex items-center px-5 gap-6 font-mono text-xs overflow-x-auto">
          <TickerItem label="REVENUE TODAY" value={overview ? `$${overview.revenue.today.toFixed(2)}` : '—'} />
          <TickerDivider />
          <TickerItem label="LIVE GAMES" value={overview ? String(overview.games.activeNow) : '—'} />
          <TickerDivider />
          <TickerItem label="USERS" value={overview ? String(overview.users.total) : '—'} sub={overview ? `+${overview.users.newToday} today` : undefined} />
          <TickerDivider />
          <TickerItem
            label="QUEUE"
            value={overview ? String(overview.queues.pendingWithdrawals + overview.queues.openFraudSignals + overview.queues.unreviewedAnticheatFlags) : '—'}
            sub="pending review"
            tone={overview && overview.queues.pendingWithdrawals + overview.queues.openFraudSignals > 0 ? 'warn' : 'default'}
          />
        </div>

        <main className="flex-1 ledger-texture overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TickerItem({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'warn' }) {
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <span className="text-ink-faint tracking-wider">{label}</span>
      <span className={tone === 'warn' ? 'text-warn font-semibold' : 'text-ink font-semibold'}>{value}</span>
      {sub && <span className="text-ink-faint">{sub}</span>}
    </div>
  );
}

function TickerDivider() {
  return <span className="text-border select-none">/</span>;
}
