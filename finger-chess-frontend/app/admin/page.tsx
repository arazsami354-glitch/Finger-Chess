'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { AlertTriangle, RefreshCw, ShieldCheck, ShieldAlert } from 'lucide-react';

const ADMIN_ROLES = ['support_agent', 'finance_admin', 'super_admin'];

interface Overview {
  users: { total: number; newToday: number };
  games: { activeNow: number; playedToday: number };
  revenue: { today: number };
  queues: { pendingWithdrawals: number; pendingRefunds: number; openFraudSignals: number; unreviewedAnticheatFlags: number; openSupportTickets: number };
}

function QueueRows() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, i) => (
        <TableRow key={i}>
          <TableCell>
            <Skeleton className="h-4 w-2/3 max-w-52" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-4 w-14" />
          </TableCell>
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          <TableCell>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </TableCell>
        </TableRow>
      ))}
    </>
  );
}

export default function AdminDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [fraudSignals, setFraudSignals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && user && !ADMIN_ROLES.includes(user.role)) {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [overviewRes, withdrawalsRes, fraudRes] = await Promise.all([
        api.get('/admin/dashboard/overview'),
        api.get('/admin/wallet/withdrawals/pending'),
        api.get('/admin/wallet/fraud-signals', { params: { status: 'open' } }),
      ]);
      setOverview(overviewRes.data);
      setWithdrawals(withdrawalsRes.data);
      setFraudSignals(fraudRes.data);
    } catch {
      // Distinct from "queue is clear" — the user needs to know the fetch
      // itself failed rather than seeing a reassuring empty state.
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user || !ADMIN_ROLES.includes(user.role)) return;
    loadData();
  }, [user, loadData]);

  async function reviewWithdrawal(id: string, decision: 'approve' | 'reject') {
    setReviewingId(id);
    try {
      await api.post(`/admin/wallet/withdrawals/${id}/review`, { decision });
      setWithdrawals((prev) => prev.filter((w) => w.id !== id));
      toast.success(`Withdrawal ${decision}d`);
    } catch {
      toast.error(`Could not ${decision} the withdrawal. Please try again.`);
    } finally {
      setReviewingId(null);
    }
  }

  if (!user || !ADMIN_ROLES.includes(user.role)) return null;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Admin"
          description="Condensed operator view. The full admin console has deeper tooling for reports, logs, and support."
        >
          <Button variant="outline" size="sm" onClick={() => loadData()} disabled={loading}>
            {loading ? <Spinner className="h-3.5 w-3.5" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </PageHeader>

        {loading && !overview ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-7 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          overview && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label="Revenue Today" value={`$${overview.revenue.today.toFixed(2)}`} />
              <StatCard label="Live Games" value={String(overview.games.activeNow)} />
              <StatCard label="Total Users" value={String(overview.users.total)} sub={`+${overview.users.newToday} today`} />
              <StatCard
                label="Review Queue"
                value={String(overview.queues.pendingWithdrawals + overview.queues.openFraudSignals + overview.queues.unreviewedAnticheatFlags)}
                tone="warn"
              />
            </div>
          )
        )}

        {loadError ? (
          <Card>
            <CardContent className="pt-6">
              <EmptyState
                icon={AlertTriangle}
                title="Couldn't load the admin dashboard"
                description="The overview, withdrawals, and fraud signals failed to load. This is a network or server problem — your queue is not necessarily empty."
                action={
                  <Button onClick={() => loadData()}>
                    <RefreshCw className="h-4 w-4" />
                    Try again
                  </Button>
                }
                className="py-10"
              />
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="withdrawals">
            <TabsList>
              <TabsTrigger value="withdrawals">Withdrawals ({withdrawals.length})</TabsTrigger>
              <TabsTrigger value="fraud">Fraud Signals ({fraudSignals.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="withdrawals">
              <Card>
                <CardContent className="pt-6">
                  {loading && withdrawals.length === 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>KYC</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        <QueueRows />
                      </TableBody>
                    </Table>
                  ) : withdrawals.length === 0 ? (
                    <EmptyState
                      icon={ShieldCheck}
                      title="Queue is clear"
                      description="No withdrawals awaiting review."
                      className="py-8"
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>KYC</TableHead>
                          <TableHead>Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {withdrawals.map((w) => (
                          <TableRow key={w.id}>
                            <TableCell className="text-sm">{w.user.email}</TableCell>
                            <TableCell className="font-mono">${Number(w.amount).toFixed(2)}</TableCell>
                            <TableCell>
                              <Badge variant={w.user.kycStatus === 'verified' ? 'default' : 'destructive'}>{w.user.kycStatus}</Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-2">
                                <Button size="sm" disabled={reviewingId !== null} onClick={() => reviewWithdrawal(w.id, 'approve')}>
                                  {reviewingId === w.id ? <Spinner className="h-3.5 w-3.5" /> : 'Approve'}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={reviewingId !== null}
                                  onClick={() => reviewWithdrawal(w.id, 'reject')}
                                >
                                  Reject
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="fraud">
              <Card>
                <CardContent className="pt-6">
                  {loading && fraudSignals.length === 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Signal</TableHead>
                          <TableHead>Severity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Array.from({ length: 4 }).map((_, i) => (
                          <TableRow key={i}>
                            <TableCell>
                              <Skeleton className="h-4 w-32" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-4 w-48" />
                            </TableCell>
                            <TableCell>
                              <Skeleton className="h-5 w-16 rounded-full" />
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : fraudSignals.length === 0 ? (
                    <EmptyState
                      icon={ShieldAlert}
                      title="No open fraud signals"
                      description="Flagged activity will appear here for review."
                      className="py-8"
                    />
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Signal</TableHead>
                          <TableHead>Severity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fraudSignals.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="font-mono text-xs">{s.userId}</TableCell>
                            <TableCell className="text-sm">{s.signalType.replace(/_/g, ' ')}</TableCell>
                            <TableCell>
                              <Badge variant={s.severity === 'critical' || s.severity === 'high' ? 'destructive' : 'warn'}>{s.severity}</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
        <div className={`font-mono text-2xl font-semibold ${tone === 'warn' ? 'text-warn' : ''}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
