'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { useCountUp } from '@/hooks/use-count-up';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { statusTone } from '@/lib/status-tone';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  ShieldCheck,
  ShieldAlert,
  KeyRound,
  Download,
  Search,
  TrendingUp,
  Lock,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from 'lucide-react';

const DepositDialog = dynamic(() => import('@/components/wallet/deposit-dialog').then((m) => m.DepositDialog), { ssr: false });
const WithdrawDialog = dynamic(() => import('@/components/wallet/withdraw-dialog').then((m) => m.WithdrawDialog), { ssr: false });

interface Txn {
  id: string;
  type: string;
  amount: string;
  status: string;
  createdAt: string;
  referenceId: string | null;
}

interface DepositRow {
  id: string;
  amount: string;
  currency: string;
  status: string;
  initiatedAt: string;
  completedAt: string | null;
}

interface WithdrawalRow {
  id: string;
  amount: string;
  currency: string;
  payoutMethod: string;
  status: string;
  requestedAt: string;
  processedAt: string | null;
}

const TXN_LABELS: Record<string, string> = {
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  withdrawal_hold: 'Withdrawal (held)',
  withdrawal_reversal: 'Withdrawal reversed',
  entry_fee_hold: 'Entry fee held',
  entry_fee_capture: 'Entry fee',
  entry_fee_release: 'Entry fee released',
  prize_credit: 'Prize won',
  commission_debit: 'Commission',
  refund: 'Refund',
  adjustment: 'Adjustment',
};

const CREDIT_TYPES = new Set(['deposit', 'prize_credit', 'withdrawal_reversal', 'refund', 'entry_fee_release']);

const DATE_PRESETS = [
  { label: 'All time', days: null },
  { label: 'Today', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
] as const;

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  const Icon = tone === 'gain' ? CheckCircle2 : tone === 'warn' ? Clock : tone === 'destructive' ? XCircle : AlertCircle;
  return (
    <Badge variant={tone} className="gap-1">
      <Icon className="h-3 w-3" /> {status}
    </Badge>
  );
}

function AnimatedBalance({ value, className }: { value: number; className?: string }) {
  const display = useCountUp(value);
  return <span className={className}>${display.toFixed(2)}</span>;
}

export default function WalletPage() {
  const { user, wallet, refreshWallet } = useAuth();
  const [transactions, setTransactions] = useState<Txn[] | null>(null);
  const [deposits, setDeposits] = useState<DepositRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [datePreset, setDatePreset] = useState<(typeof DATE_PRESETS)[number]>(DATE_PRESETS[0]);
  const [exporting, setExporting] = useState(false);

  const filterParams = useMemo(() => {
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    if (typeFilter !== 'all') params.type = typeFilter;
    if (statusFilter !== 'all') params.status = statusFilter;
    if (datePreset.days) params.from = new Date(Date.now() - datePreset.days * 86_400_000).toISOString();
    return params;
  }, [search, typeFilter, statusFilter, datePreset]);

  function loadTransactions() {
    api.get('/wallet/transactions', { params: filterParams }).then(({ data }) => setTransactions(data));
  }

  useEffect(loadTransactions, [filterParams]);

  useEffect(() => {
    api.get('/wallet/deposits').then(({ data }) => setDeposits(data));
    api.get('/wallet/withdrawals').then(({ data }) => setWithdrawals(data));
  }, []);

  function refreshAll() {
    refreshWallet();
    loadTransactions();
    api.get('/wallet/deposits').then(({ data }) => setDeposits(data));
    api.get('/wallet/withdrawals').then(({ data }) => setWithdrawals(data));
  }

  async function handleExport() {
    setExporting(true);
    try {
      const response = await api.get('/wallet/transactions/export', { params: filterParams, responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([response.data], { type: 'text/csv' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `finger-chess-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  const kycVerified = user?.kycStatus === 'verified';

  return (
    <AppShell>
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="animate-fade-up">
            <h1 className="font-display font-bold text-2xl">Wallet</h1>
            <p className="text-muted-foreground text-sm mt-1">Deposits, withdrawals, and every transaction in between.</p>
          </div>
          <div className="flex gap-3 animate-fade-up [animation-delay:60ms] [animation-fill-mode:backwards]">
            <Button variant="outline" onClick={() => setWithdrawOpen(true)}>
              <ArrowUpCircle className="h-4 w-4" /> Withdraw
            </Button>
            <Button onClick={() => setDepositOpen(true)}>
              <ArrowDownCircle className="h-4 w-4" /> Deposit
            </Button>
          </div>
        </div>

        {/* Security indicators — trust signals a Revolut/Stripe-grade wallet
            leads with, drawn from real account state rather than decorative claims. */}
        <div className="flex flex-wrap gap-2 animate-fade-up [animation-delay:100ms] [animation-fill-mode:backwards]">
          {kycVerified ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gain/30 bg-gain/10 text-gain text-xs font-medium px-3 py-1.5">
              <ShieldCheck className="h-3.5 w-3.5" /> Identity verified
            </span>
          ) : (
            <Link
              href="/settings/verification"
              className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn text-xs font-medium px-3 py-1.5 hover:bg-warn/15 transition-colors"
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Verify identity to unlock deposits &amp; withdrawals
            </Link>
          )}
          {user?.twoFactorEnabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gain/30 bg-gain/10 text-gain text-xs font-medium px-3 py-1.5">
              <KeyRound className="h-3.5 w-3.5" /> Two-factor authentication on
            </span>
          ) : (
            <Link
              href="/settings"
              className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn/10 text-warn text-xs font-medium px-3 py-1.5 hover:bg-warn/15 transition-colors"
            >
              <KeyRound className="h-3.5 w-3.5" /> Enable 2FA to secure your wallet
            </Link>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary text-muted-foreground text-xs font-medium px-3 py-1.5">
            <Lock className="h-3.5 w-3.5" /> Payments secured by Stripe
          </span>
        </div>

        {/* Balance hero — available is the primary figure (largest, gold),
            everything else supporting. Every number ticks up on load/change
            via useCountUp rather than snapping to its new value instantly. */}
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="surface-interactive animate-fade-up [animation-delay:140ms] [animation-fill-mode:backwards] lg:col-span-2 bg-gradient-to-br from-primary/10 via-card to-card border-primary/20">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Available Balance</span>
                <ArrowDownCircle className="h-4 w-4 text-primary" />
              </div>
              <AnimatedBalance value={wallet?.available ?? 0} className="font-mono text-4xl font-bold text-primary" />
              <p className="text-xs text-muted-foreground mt-2">Ready to deposit into a match or withdraw anytime.</p>
            </CardContent>
          </Card>
          <Card className="surface-interactive animate-fade-up [animation-delay:180ms] [animation-fill-mode:backwards]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Pending</span>
                <Clock className="h-4 w-4 text-warn" />
              </div>
              <AnimatedBalance value={wallet?.pending ?? 0} className="font-mono text-2xl font-semibold text-warn" />
              <p className="text-xs text-muted-foreground mt-2">Withdrawal under review.</p>
            </CardContent>
          </Card>
          <Card className="surface-interactive animate-fade-up [animation-delay:220ms] [animation-fill-mode:backwards]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">In Escrow</span>
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
              <AnimatedBalance value={wallet?.locked ?? 0} className="font-mono text-2xl font-semibold" />
              <p className="text-xs text-muted-foreground mt-2">Held for an active paid match.</p>
            </CardContent>
          </Card>
          <Card className="surface-interactive animate-fade-up [animation-delay:260ms] [animation-fill-mode:backwards]">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Lifetime Earnings</span>
                <TrendingUp className="h-4 w-4 text-gain" />
              </div>
              <AnimatedBalance value={wallet?.lifetimeEarnings ?? 0} className="font-mono text-2xl font-semibold text-gain" />
              <p className="text-xs text-muted-foreground mt-2">Total prize money won, all-time.</p>
            </CardContent>
          </Card>
        </div>

        {/* Recent deposits / withdrawals — each with its own richer status
            (a deposit's 'pending'/'success'/'failed' is a different state
            machine than a withdrawal's 'requested'/'completed'/'rejected',
            so these get their own panels rather than being folded into the
            generic transaction list, which only knows the ledger's own
            pending/completed/failed/reversed states). */}
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="animate-fade-up [animation-delay:300ms] [animation-fill-mode:backwards]">
            <CardHeader>
              <CardTitle className="text-base">Recent Deposits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {deposits.length === 0 ? (
                <EmptyState
                  icon={ArrowDownCircle}
                  title="No deposits yet"
                  description="Your first deposit will appear here."
                  className="py-8"
                />
              ) : (
                deposits.slice(0, 5).map((d) => (
                  <div key={d.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-mono text-sm font-medium">${Number(d.amount).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">{new Date(d.initiatedAt).toLocaleString()}</div>
                    </div>
                    <StatusPill status={d.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card className="animate-fade-up [animation-delay:340ms] [animation-fill-mode:backwards]">
            <CardHeader>
              <CardTitle className="text-base">Recent Withdrawals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {withdrawals.length === 0 ? (
                <EmptyState
                  icon={ArrowUpCircle}
                  title="No withdrawals yet"
                  description="Withdrawals you request will show up here."
                  className="py-8"
                />
              ) : (
                withdrawals.slice(0, 5).map((w) => (
                  <div key={w.id} className="flex items-center justify-between">
                    <div>
                      <div className="font-mono text-sm font-medium">${Number(w.amount).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">
                        {w.payoutMethod} · {new Date(w.requestedAt).toLocaleString()}
                      </div>
                    </div>
                    <StatusPill status={w.status} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="animate-fade-up [animation-delay:380ms] [animation-fill-mode:backwards]">
          <CardHeader className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Transaction History</CardTitle>
              <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting}>
                <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export CSV'}
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search by reference or amount…" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-full sm:w-44">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {Object.entries(TXN_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-36">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                  <SelectItem value="reversed">Reversed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => setDatePreset(preset)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-all duration-200 ease-premium ${
                    datePreset.label === preset.label ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {transactions === null ? (
              <LoadingPanel />
            ) : transactions.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No transactions found"
                description="No transactions match your filters — try widening the date range or clearing the search."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t, i) => (
                    <TableRow key={t.id} className="animate-fade-up" style={{ animationDelay: `${Math.min(i * 30, 300)}ms`, animationFillMode: 'backwards' }}>
                      <TableCell className="text-sm">{TXN_LABELS[t.type] ?? t.type}</TableCell>
                      <TableCell className={`font-mono text-sm ${CREDIT_TYPES.has(t.type) ? 'text-gain' : 'text-foreground'}`}>
                        {CREDIT_TYPES.has(t.type) ? '+' : '-'}${Number(t.amount).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={t.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">{new Date(t.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <DepositDialog
        open={depositOpen}
        onOpenChange={setDepositOpen}
        kycVerified={kycVerified}
        onSuccess={refreshAll}
      />
      <WithdrawDialog
        open={withdrawOpen}
        onOpenChange={setWithdrawOpen}
        availableBalance={wallet?.available ?? 0}
        kycVerified={kycVerified}
        onSuccess={refreshAll}
      />
    </AppShell>
  );
}
