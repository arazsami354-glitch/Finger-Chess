'use client';

import { memo, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { useSocial } from '@/components/providers/social-provider';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { PlayerCard } from '@/components/social/player-card';
import { ChallengeDialog } from '@/components/invitations/challenge-dialog';
import { Check, X, UserMinus, Ban, Users, UserPlus, Send } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface Player {
  id: string;
  fullName: string | null;
  email: string;
  avatarUrl?: string | null;
}

interface FriendRequestItem {
  id: string;
  sender?: Player;
  receiver?: Player;
}

export default function FriendsPage() {
  return (
    <AppShell>
      <FriendsView />
    </AppShell>
  );
}

function FriendsView() {
  const { presenceMap } = useSocial();
  const [friends, setFriends] = useState<Player[] | null>(null);
  const [incoming, setIncoming] = useState<FriendRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestItem[]>([]);
  const [favorites, setFavorites] = useState<Player[]>([]);
  const [suggestions, setSuggestions] = useState<(Player & { mutualFriends: number })[]>([]);
  const [challengeTarget, setChallengeTarget] = useState<Player | null>(null);

  const load = useCallback(() => {
    api
      .get('/social/friends')
      .then(({ data }) => setFriends(data))
      .catch(() => toast.error("Couldn't load your friends"));
    api
      .get('/social/friends/requests')
      .then(({ data }) => {
        setIncoming(data.incoming);
        setOutgoing(data.outgoing);
      })
      .catch(() => {
        setIncoming([]);
        setOutgoing([]);
      });
    api
      .get('/social/friends/favorites')
      .then(({ data }) => setFavorites(data))
      .catch(() => setFavorites([]));
    api
      .get('/social/friends/suggestions')
      .then(({ data }) => setSuggestions(data))
      .catch(() => setSuggestions([]));
  }, []);

  useEffect(load, [load]);

  async function respond(requestId: string, decision: 'accept' | 'decline') {
    try {
      await api.post(`/social/friends/requests/${requestId}/respond`, { decision });
      toast.success(decision === 'accept' ? 'Friend request accepted' : 'Request declined');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not respond to the request');
    }
    load();
  }

  async function cancelRequest(requestId: string) {
    try {
      await api.post(`/social/friends/requests/${requestId}/cancel`);
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not cancel the request');
    }
    load();
  }

  const removeFriend = useCallback(
    async (friendId: string) => {
      try {
        await api.delete(`/social/friends/${friendId}`);
        toast.success('Friend removed');
      } catch (err: any) {
        toast.error(err.response?.data?.message ?? 'Could not remove friend');
      }
      load();
    },
    [load],
  );

  const blockUser = useCallback(
    async (userId: string) => {
      try {
        await api.post('/social/friends/block', { userId });
        toast.success('User blocked');
      } catch (err: any) {
        toast.error(err.response?.data?.message ?? 'Could not block user');
      }
      load();
    },
    [load],
  );

  async function sendRequest(receiverId: string) {
    try {
      await api.post('/social/friends/requests', { receiverId });
      toast.success('Friend request sent');
      load();
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not send request');
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader title="Friends" description="Manage your circle and find new opponents." />

        <Tabs defaultValue="friends">
          <TabsList>
            <TabsTrigger value="friends">All Friends ({friends?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="requests">
              Requests {incoming.length > 0 && `(${incoming.length})`}
            </TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          </TabsList>

          <TabsContent value="friends">
            <Card>
              <CardContent className="pt-6">
                {friends === null ? (
                  <LoadingPanel />
                ) : friends.length === 0 ? (
                  <EmptyState
                    icon={Users}
                    title="No friends yet"
                    description="Search for players to add and start building your circle."
                    action={
                      <Button asChild>
                        <Link href="/search">Find players</Link>
                      </Button>
                    }
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {friends.map((f) => (
                      <PlayerCard
                        key={f.id}
                        id={f.id}
                        fullName={f.fullName}
                        email={f.email}
                        avatarUrl={f.avatarUrl}
                        presenceStatus={presenceMap[f.id]}
                        actions={<FriendActions friend={f} onChallenge={setChallengeTarget} onRemove={removeFriend} onBlock={blockUser} />}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="requests">
            <div className="space-y-4">
              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-sm font-medium mb-2">Incoming</h3>
                  {incoming.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No incoming requests.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {incoming.map((r) => (
                        <PlayerCard
                          key={r.id}
                          id={r.sender!.id}
                          fullName={r.sender!.fullName}
                          email={r.sender!.email}
                          avatarUrl={r.sender!.avatarUrl}
                          actions={
                            <>
                              <Button size="sm" onClick={() => respond(r.id, 'accept')}>
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => respond(r.id, 'decline')}>
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

              <Card>
                <CardContent className="pt-6">
                  <h3 className="text-sm font-medium mb-2">Sent</h3>
                  {outgoing.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4">No outgoing requests.</p>
                  ) : (
                    <div className="divide-y divide-border">
                      {outgoing.map((r) => (
                        <PlayerCard
                          key={r.id}
                          id={r.receiver!.id}
                          fullName={r.receiver!.fullName}
                          email={r.receiver!.email}
                          avatarUrl={r.receiver!.avatarUrl}
                          actions={
                            <Button size="sm" variant="outline" onClick={() => cancelRequest(r.id)}>
                              Cancel
                            </Button>
                          }
                        />
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="suggestions">
            <Card>
              <CardContent className="pt-6">
                {suggestions.length === 0 ? (
                  <EmptyState
                    icon={UserPlus}
                    title="No suggestions right now"
                    description="Suggestions appear as you play games and grow your friend list."
                  />
                ) : (
                  <div className="divide-y divide-border">
                    {suggestions.map((s) => (
                      <PlayerCard
                        key={s.id}
                        id={s.id}
                        fullName={s.fullName}
                        email={s.email}
                        avatarUrl={s.avatarUrl}
                        subtitle={`${s.mutualFriends} mutual friend${s.mutualFriends === 1 ? '' : 's'}`}
                        actions={
                          <Button size="sm" onClick={() => sendRequest(s.id)}>
                            Add Friend
                          </Button>
                        }
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <ChallengeDialog
          open={!!challengeTarget}
          onOpenChange={(open) => setChallengeTarget(open ? challengeTarget : null)}
          opponentId={challengeTarget?.id ?? ''}
          opponentName={challengeTarget?.fullName ?? challengeTarget?.email ?? 'them'}
        />
      </div>
  );
}

/**
 * Memoized card actions with stable props (setState dispatch + useCallback
 * handlers) so a PlayerCard in the friends list survives parent re-renders
 * without rebuilding its buttons.
 */
const FriendActions = memo(function FriendActions({
  friend,
  onChallenge,
  onRemove,
  onBlock,
}: {
  friend: Player;
  onChallenge: (target: Player) => void;
  onRemove: (id: string) => void;
  onBlock: (id: string) => void;
}) {
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => onChallenge(friend)} aria-label={`Challenge ${friend.fullName ?? friend.email}`}>
        <Send className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" onClick={() => onRemove(friend.id)} aria-label={`Remove ${friend.fullName ?? friend.email} from friends`}>
        <UserMinus className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => onBlock(friend.id)} aria-label={`Block ${friend.fullName ?? friend.email}`}>
        <Ban className="h-4 w-4" />
      </Button>
    </>
  );
});
