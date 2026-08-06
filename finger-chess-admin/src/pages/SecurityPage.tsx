import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, Button, LoadingRow, EmptyState } from '../components/ui';

interface HighRiskEntry {
  id: string;
  createdAt: string;
  details: {
    score: number;
    tier: string;
    components: {
      flaggedAnticheatReports: number;
      openFraudSignals: number;
      linkedAccounts: string[];
      sharedIpAccountCount: number;
      tamperFlags: string[];
    };
  };
  user: { id: string; email: string; fullName: string | null; status: string; kycStatus: string };
}

function tierTone(tier: string): 'loss' | 'warn' | 'default' {
  if (tier === 'critical') return 'loss';
  if (tier === 'high') return 'warn';
  return 'default';
}

export function SecurityPage() {
  const [entries, setEntries] = useState<HighRiskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    setLoading(true);
    api
      .get('/admin/security/high-risk-users')
      .then(({ data }) => setEntries(data))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function warn(userId: string) {
    if (actionReason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${userId}/warn`, { reason: actionReason.trim(), category: 'fraud' });
      setActionReason('');
      setExpandedId(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function suspend(userId: string) {
    if (actionReason.trim().length < 5) return;
    setBusy(true);
    try {
      const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await api.post(`/admin/users/${userId}/suspend`, { reason: actionReason.trim(), category: 'fraud', until });
      setActionReason('');
      setExpandedId(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  async function ban(userId: string) {
    if (actionReason.trim().length < 5) return;
    setBusy(true);
    try {
      await api.post(`/admin/users/${userId}/ban`, { reason: actionReason.trim() });
      setActionReason('');
      setExpandedId(null);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingRow />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Risk &amp; Security</h1>
      <p className="text-sm text-ink-faint -mt-4">
        Every account currently scored 'high' risk or above — engine-use detection, fraud signals, linked accounts,
        shared-IP clustering, and browser tamper flags, aggregated into one queue.
      </p>

      <Panel title={`High Risk Accounts (${entries.length})`}>
        {entries.length === 0 ? (
          <EmptyState message="No accounts currently flagged as high risk." />
        ) : (
          <div className="-m-5">
            <table className="w-[calc(100%+2.5rem)]">
              <thead>
                <tr>
                  <th className="th">User</th>
                  <th className="th">Score</th>
                  <th className="th">Signals</th>
                  <th className="th">Flagged</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="td">
                      <div className="text-sm">{e.user.fullName || e.user.email}</div>
                      <div className="text-xs text-ink-faint">{e.user.email}</div>
                    </td>
                    <td className="td">
                      <Badge tone={tierTone(e.details.tier)}>
                        {e.details.score}/100 · {e.details.tier}
                      </Badge>
                    </td>
                    <td className="td text-xs text-ink-faint">
                      {e.details.components.flaggedAnticheatReports > 0 && <div>{e.details.components.flaggedAnticheatReports} anti-cheat flag(s)</div>}
                      {e.details.components.openFraudSignals > 0 && <div>{e.details.components.openFraudSignals} open fraud signal(s)</div>}
                      {e.details.components.linkedAccounts.length > 0 && <div>{e.details.components.linkedAccounts.length} linked account(s)</div>}
                      {e.details.components.sharedIpAccountCount >= 4 && <div>{e.details.components.sharedIpAccountCount} accounts on shared IP</div>}
                      {e.details.components.tamperFlags.length > 0 && <div>Tamper: {e.details.components.tamperFlags.join(', ')}</div>}
                    </td>
                    <td className="td text-xs text-ink-faint font-mono">{new Date(e.createdAt).toLocaleString()}</td>
                    <td className="td text-right">
                      <Button onClick={() => setExpandedId(expandedId === e.user.id ? null : e.user.id)}>
                        {expandedId === e.user.id ? 'Close' : 'Act'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {expandedId && (
              <div className="border-t border-border p-5 space-y-3 bg-surface-raised">
                <textarea
                  className="w-full min-h-20 rounded-md border border-border bg-canvas px-3 py-2 text-sm text-ink"
                  placeholder="Reason — shown to the user for a warning or suspension…"
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                />
                <div className="flex items-center gap-3">
                  <Button disabled={busy || actionReason.trim().length < 5} onClick={() => warn(expandedId)}>
                    Warn
                  </Button>
                  <Button disabled={busy || actionReason.trim().length < 5} onClick={() => suspend(expandedId)}>
                    Suspend (7 days)
                  </Button>
                  <Button tone="danger" disabled={busy || actionReason.trim().length < 5} onClick={() => ban(expandedId)}>
                    Permanent Ban
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
