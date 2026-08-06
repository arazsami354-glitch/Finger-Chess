'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { useSocial } from '@/components/providers/social-provider';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PlayerCard } from '@/components/social/player-card';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Check, X, Ban, Send } from 'lucide-react';

interface InvitationUser {
  id: string;
  fullName: string | null;
  email: string;
  avatarUrl?: string | null;
}

interface Invitation {
  id: string;
  timeControlId: string;
  entryFee: number;
  rated: boolean;
  colorPreference: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  gameId: string | null;
  expiresAt: string;
  createdAt: string;
  sender?: InvitationUser;
  recipient?: InvitationUser;
}

const TC_LABELS: Record<string, string> = {
  bullet_1_0: '1 min',
  bullet_2_1: '2 | 1',
  blitz_3_0: '3 | 0',
  blitz_3_2: '3 | 2',
  blitz_5_0: '5 | 0',
  blitz_5_3: '5 | 3',
  rapid_10_0: '10 min',
  rapid_15_10: '15 | 10',
  classical_30_0: '30 min',
  classical_60_0: '60 min',
};

function rulesLabel(i: Invitation): string {
  const tc = TC_LABELS[i.timeControlId] ?? i.timeControlId;
  const stake = i.entryFee > 0 ? ` · $${i.entryFee}` : '';
  return `${i.rated ? 'Rated' : 'Casual'} · ${tc}${stake}`;
}

export default function InvitationsPage() {
  return (
    <AppShell>
      <InvitationsView />
    </AppShell>
  );
}

function InvitationsView() {
  const { refreshPendingInvitationCount } = useSocial();
  const [incoming, setIncoming] = useState<Invitation[] | null>(null);
  const [outgoing, setOutgoing] = useState<Invitation[] | null>(null);

  function load() {
    api
      .get('/social/invitations')
      .then(({ data }) => {
        setIncoming(data.incoming);
        setOutgoing(data.outgoing);
        refreshPendingInvitationCount();
      })
      .catch(() => {
        setIncoming([]);
        setOutgoing([]);
        toast.error("Couldn't load invitations");
      });
  }

  useEffect(load, [refreshPendingInvitationCount]);

  async function accept(id: string) {
    try {
      const { data } = await api.post<{ gameId: string }>(`/social/invitations/${id}/accept`);
      toast.success('Challenge accepted — starting match');
      load();
      if (data.gameId) {
        // Small delay so the toast reads before the navigation.
        setTimeout(() => window.location.assign(`/play/${data.gameId}`), 400);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not accept challenge');
      load();
    }
  }

  async function decline(id: string) {
    try {
      await api.post(`/social/invitations/${id}/decline`);
      toast.success('Challenge declined');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not decline challenge');
    }
    load();
  }

  async function cancel(id: string) {
    try {
      await api.post(`/social/invitations/${id}/cancel`);
      toast.success('Challenge cancelled');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not cancel challenge');
    }
    load();
  }

  const incomingPending = (incoming ?? []).filter((i) => i.status === 'pending');
  const incomingResolved = (incoming ?? []).filter((i) => i.status !== 'pending');
  const outgoingPending = (outgoing ?? []).filter((i) => i.status === 'pending');
  const outgoingResolved = (outgoing ?? []).filter((i) => i.status !== 'pending');

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <PageHeader title="Invitations" description="Friend challenges — accept, decline or review past ones." />

      <Tabs defaultValue="incoming">
        <TabsList>
          <TabsTrigger value="incoming">Incoming {incomingPending.length > 0 && `(${incomingPending.length})`}</TabsTrigger>
          <TabsTrigger value="outgoing">Sent {outgoingPending.length > 0 && `(${outgoingPending.length})`}</TabsTrigger>
        </TabsList>

        <TabsContent value="incoming">
          <Card>
            <CardContent className="pt-6">
              {incoming === null ? (
                <LoadingPanel />
              ) : incomingPending.length === 0 ? (
                <EmptyState
                  icon={Send}
                  title="No open challenges"
                  description="When a friend challenges you, it appears here with a live countdown."
                  action={
                    <Button asChild variant="outline">
                      <Link href="/friends">Challenge a friend</Link>
                    </Button>
                  }
                />
              ) : (
                <div className="divide-y divide-border">
                  {incomingPending.map((i) => (
                    <PlayerCard
                      key={i.id}
                      id={i.sender!.id}
                      fullName={i.sender!.fullName}
                      email={i.sender!.email}
                      avatarUrl={i.sender!.avatarUrl}
                      presenceStatus={undefined}
                      subtitle={rulesLabel(i)}
                      actions={
                        <>
                          <Button size="sm" onClick={() => accept(i.id)}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => decline(i.id)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      }
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {incomingResolved.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-medium mb-2">Past</h3>
                <div className="divide-y divide-border">
                  {incomingResolved.map((i) => (
                    <PlayerCard
                      key={i.id}
                      id={i.sender!.id}
                      fullName={i.sender!.fullName}
                      email={i.sender!.email}
                      avatarUrl={i.sender!.avatarUrl}
                      subtitle={rulesLabel(i)}
                      actions={<Badge variant={i.status === 'accepted' ? 'gold' : 'secondary'}>{i.status}</Badge>}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="outgoing">
          <Card>
            <CardContent className="pt-6">
              {outgoing === null ? (
                <LoadingPanel />
              ) : outgoingPending.length === 0 ? (
                <EmptyState
                  icon={Send}
                  title="No outgoing challenges"
                  description="Challenges you've sent while waiting for an answer appear here."
                />
              ) : (
                <div className="divide-y divide-border">
                  {outgoingPending.map((i) => (
                    <PlayerCard
                      key={i.id}
                      id={i.recipient!.id}
                      fullName={i.recipient!.fullName}
                      email={i.recipient!.email}
                      avatarUrl={i.recipient!.avatarUrl}
                      subtitle={rulesLabel(i)}
                      actions={
                        <Button size="sm" variant="outline" onClick={() => cancel(i.id)}>
                          <Ban className="h-4 w-4" /> Cancel
                        </Button>
                      }
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {outgoingResolved.length > 0 && (
            <Card>
              <CardContent className="pt-6">
                <h3 className="text-sm font-medium mb-2">Past</h3>
                <div className="divide-y divide-border">
                  {outgoingResolved.map((i) => (
                    <PlayerCard
                      key={i.id}
                      id={i.recipient!.id}
                      fullName={i.recipient!.fullName}
                      email={i.recipient!.email}
                      avatarUrl={i.recipient!.avatarUrl}
                      subtitle={rulesLabel(i)}
                      actions={<Badge variant={i.status === 'accepted' ? 'gold' : 'secondary'}>{i.status}</Badge>}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
