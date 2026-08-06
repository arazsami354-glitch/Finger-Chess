import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, Button, LoadingRow, EmptyState } from '../components/ui';

interface Withdrawal {
  id: string;
  amount: string;
  payoutMethod: string;
  status: string;
  requestedAt: string;
  user: { id: string; email: string; kycStatus: string };
}

interface Refund {
  id: string;
  amount: string;
  reason: string;
  status: string;
  createdAt: string;
  userId: string;
}

interface Drift {
  id: string;
  walletId: string;
  ledgerBalance: string;
  cachedBalance: string;
  driftAmount: string;
  checkedAt: string;
}

export function WalletMonitoringPage() {
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [refunds, setRefunds] = useState<Refund[]>([]);
  const [drifts, setDrifts] = useState<Drift[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/admin/wallet/withdrawals/pending').then(({ data }) => setWithdrawals(data)),
      api.get('/admin/wallet/refunds/pending').then(({ data }) => setRefunds(data)),
      api.get('/admin/wallet/reconciliation/drifts').then(({ data }) => setDrifts(data)),
    ]).finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function reviewWithdrawal(id: string, decision: 'approve' | 'reject') {
    const reason = decision === 'reject' ? window.prompt('Reason for rejection (visible in audit log):') ?? '' : undefined;
    await api.post(`/admin/wallet/withdrawals/${id}/review`, { decision, reason });
    load();
  }

  async function reviewRefund(id: string, decision: 'approve' | 'reject') {
    await api.post(`/admin/wallet/refunds/${id}/review`, { decision });
    load();
  }

  if (loading) return <LoadingRow />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Wallet Monitoring</h1>

      <Panel title={`Pending Withdrawals (${withdrawals.length})`}>
        {withdrawals.length === 0 ? (
          <EmptyState message="No withdrawals awaiting review." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">User</th>
                <th className="th">Amount</th>
                <th className="th">Method</th>
                <th className="th">KYC</th>
                <th className="th">Requested</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {withdrawals.map((w) => (
                <tr key={w.id}>
                  <td className="td">{w.user.email}</td>
                  <td className="td font-mono">${Number(w.amount).toFixed(2)}</td>
                  <td className="td">{w.payoutMethod}</td>
                  <td className="td">
                    <Badge tone={w.user.kycStatus === 'verified' ? 'gain' : 'loss'}>{w.user.kycStatus}</Badge>
                  </td>
                  <td className="td text-xs text-ink-faint font-mono">{new Date(w.requestedAt).toLocaleString()}</td>
                  <td className="td">
                    <div className="flex gap-2">
                      <Button tone="brass" onClick={() => reviewWithdrawal(w.id, 'approve')}>
                        Approve
                      </Button>
                      <Button tone="danger" onClick={() => reviewWithdrawal(w.id, 'reject')}>
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Pending Refunds (${refunds.length})`}>
        {refunds.length === 0 ? (
          <EmptyState message="No refund requests awaiting review." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">Amount</th>
                <th className="th">Reason</th>
                <th className="th">Requested</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td className="td font-mono">${Number(r.amount).toFixed(2)}</td>
                  <td className="td max-w-md truncate">{r.reason}</td>
                  <td className="td text-xs text-ink-faint font-mono">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="td">
                    <div className="flex gap-2">
                      <Button tone="brass" onClick={() => reviewRefund(r.id, 'approve')}>
                        Approve
                      </Button>
                      <Button tone="danger" onClick={() => reviewRefund(r.id, 'reject')}>
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Reconciliation Drift (${drifts.length})`}>
        {drifts.length === 0 ? (
          <EmptyState message="No ledger drift detected — every wallet matches its transaction history." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">Wallet</th>
                <th className="th">Ledger Balance</th>
                <th className="th">Cached Balance</th>
                <th className="th">Drift</th>
                <th className="th">Checked</th>
              </tr>
            </thead>
            <tbody>
              {drifts.map((d) => (
                <tr key={d.id}>
                  <td className="td font-mono text-xs">{d.walletId}</td>
                  <td className="td font-mono">${Number(d.ledgerBalance).toFixed(2)}</td>
                  <td className="td font-mono">${Number(d.cachedBalance).toFixed(2)}</td>
                  <td className="td font-mono text-loss">${Number(d.driftAmount).toFixed(2)}</td>
                  <td className="td text-xs text-ink-faint font-mono">{new Date(d.checkedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
