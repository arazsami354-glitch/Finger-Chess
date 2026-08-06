import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, LoadingRow, EmptyState } from '../components/ui';

interface FraudSignal {
  id: string;
  userId: string;
  signalType: string;
  severity: string;
  details: Record<string, unknown>;
  status: string;
  createdAt: string;
}

export function FraudPage() {
  const [signals, setSignals] = useState<FraudSignal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get('/admin/wallet/fraud-signals', { params: { status: 'open' } })
      .then(({ data }) => setSignals(data))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingRow />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Fraud Detection</h1>

      <Panel title={`Open Signals (${signals.length})`}>
        {signals.length === 0 ? (
          <EmptyState message="No open fraud signals — clean queue." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">User</th>
                <th className="th">Signal</th>
                <th className="th">Severity</th>
                <th className="th">Details</th>
                <th className="th">Detected</th>
              </tr>
            </thead>
            <tbody>
              {signals.map((s) => (
                <tr key={s.id}>
                  <td className="td font-mono text-xs">{s.userId}</td>
                  <td className="td">{formatSignalType(s.signalType)}</td>
                  <td className="td">
                    <SeverityBadge severity={s.severity} />
                  </td>
                  <td className="td text-xs text-ink-faint max-w-xs truncate">{JSON.stringify(s.details)}</td>
                  <td className="td text-xs text-ink-faint font-mono">{new Date(s.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

function formatSignalType(type: string) {
  return type.replace(/_/g, ' ');
}

function SeverityBadge({ severity }: { severity: string }) {
  const tone: 'loss' | 'warn' | 'default' = severity === 'critical' ? 'loss' : severity === 'high' ? 'loss' : severity === 'medium' ? 'warn' : 'default';
  return <Badge tone={tone}>{severity}</Badge>;
}
