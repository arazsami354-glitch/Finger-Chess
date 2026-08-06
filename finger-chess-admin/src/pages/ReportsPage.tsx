import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { api } from '../api/client';
import { Panel, StatCard, LoadingRow } from '../components/ui';

interface RevenueSummary {
  totalRevenue: number;
  totalVolume: number;
  gamesSettled: number;
  averageCommissionPerGame: number;
  effectiveCommissionRate: number;
}

interface TierBreakdown {
  entryFeeTier: number;
  commission: number;
  games: number;
}

interface FlowSummary {
  totalDeposited: number;
  depositCount: number;
  totalWithdrawn: number;
  withdrawalCount: number;
  netFlow: number;
}

export function ReportsPage() {
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [tiers, setTiers] = useState<TierBreakdown[]>([]);
  const [flow, setFlow] = useState<FlowSummary | null>(null);

  function load() {
    const params = { from, to };
    api.get('/admin/reports/revenue', { params }).then(({ data }) => setRevenue(data));
    api.get('/admin/reports/commission/by-tier', { params }).then(({ data }) => setTiers(data));
    api.get('/admin/reports/deposits-withdrawals', { params }).then(({ data }) => setFlow(data));
  }

  useEffect(load, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Financial Reports</h1>
        <div className="flex items-center gap-2">
          <input type="date" className="input w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-ink-faint text-sm">to</span>
          <input type="date" className="input w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
          <button onClick={load} className="px-3 py-1.5 rounded text-sm bg-brass text-canvas font-medium">
            Apply
          </button>
        </div>
      </div>

      {!revenue || !flow ? (
        <LoadingRow />
      ) : (
        <>
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Revenue" value={`$${revenue.totalRevenue.toFixed(2)}`} tone="gain" />
            <StatCard label="Total Volume" value={`$${revenue.totalVolume.toFixed(2)}`} />
            <StatCard label="Games Settled" value={String(revenue.gamesSettled)} />
            <StatCard label="Effective Commission Rate" value={`${revenue.effectiveCommissionRate}%`} sublabel="hard-capped at 15%" />
          </div>

          <Panel title="Commission by Entry-Fee Tier">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tiers}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262C39" />
                  <XAxis dataKey="entryFeeTier" tickFormatter={(v) => `$${v}`} stroke="#5B6274" fontSize={11} tickLine={false} />
                  <YAxis stroke="#5B6274" fontSize={11} tickLine={false} width={50} />
                  <Tooltip
                    contentStyle={{ background: '#1D222C', border: '1px solid #262C39', borderRadius: 6, fontSize: 12 }}
                    labelFormatter={(v) => `$${v} room`}
                  />
                  <Bar dataKey="commission" fill="#C9A24B" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          <div className="grid grid-cols-3 gap-4">
            <StatCard label="Total Deposited" value={`$${flow.totalDeposited.toFixed(2)}`} sublabel={`${flow.depositCount} deposits`} tone="gain" />
            <StatCard label="Total Withdrawn" value={`$${flow.totalWithdrawn.toFixed(2)}`} sublabel={`${flow.withdrawalCount} withdrawals`} tone="loss" />
            <StatCard label="Net Flow" value={`$${flow.netFlow.toFixed(2)}`} tone={flow.netFlow >= 0 ? 'gain' : 'loss'} />
          </div>
        </>
      )}
    </div>
  );
}
