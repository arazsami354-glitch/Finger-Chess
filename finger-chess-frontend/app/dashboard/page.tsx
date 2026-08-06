'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Swords, Wallet, TrendingUp, ArrowRight, History } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';

interface MatchHistoryItem {
  id: string;
  result: string | null;
  entryFee: string;
  timeControl: string;
  endedAt: string | null;
  playerWhite: { email: string };
  playerBlack: { email: string };
}

export default function DashboardPage() {
  const { user, wallet } = useAuth();
  const [recentGames, setRecentGames] = useState<MatchHistoryItem[] | null>(null);

  useEffect(() => {
    api
      .get('/games/history')
      .then(({ data }) => setRecentGames(data.filter((g: MatchHistoryItem) => g.endedAt).slice(0, 5)))
      .catch(() => setRecentGames([]));
  }, []);

  return (
    <AppShell>
      <div className="space-y-8">
        <div>
          <h1 className="font-display font-bold text-2xl">Welcome back{user?.fullName ? `, ${user.fullName}` : ''}</h1>
          <p className="text-muted-foreground text-sm mt-1">Here&apos;s where things stand.</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Available Balance</span>
                <Wallet className="h-4 w-4 text-primary" />
              </div>
              <div className="font-mono text-2xl font-semibold">${wallet ? wallet.available.toFixed(2) : '—'}</div>
              <Link href="/wallet" className="text-xs text-primary hover:underline mt-2 inline-block">
                Manage wallet →
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">In Escrow</span>
                <TrendingUp className="h-4 w-4 text-gold" />
              </div>
              <div className="font-mono text-2xl font-semibold">${wallet ? wallet.locked.toFixed(2) : '—'}</div>
              <span className="text-xs text-muted-foreground mt-2 inline-block">Held in active matches</span>
            </CardContent>
          </Card>

          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-6 flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Ready to play?</span>
                  <Swords className="h-4 w-4 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Jump into matchmaking — five stakes, four time controls.</p>
              </div>
              <Button className="mt-4 w-full" asChild>
                <Link href="/lobby">
                  Enter lobby <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Games</CardTitle>
          </CardHeader>
          <CardContent>
            {recentGames === null ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : recentGames.length === 0 ? (
              <EmptyState
                icon={History}
                title="No games yet"
                description="Your history will show up here after your first match."
                action={
                  <Button asChild variant="outline">
                    <Link href="/lobby">
                      Find a game <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                }
              />
            ) : (
              <div className="divide-y divide-border">
                {recentGames.map((g) => (
                  <div key={g.id} className="flex items-center justify-between py-3">
                    <div className="text-sm">
                      {g.playerWhite.email} <span className="text-muted-foreground">vs</span> {g.playerBlack.email}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground font-mono">${g.entryFee}</span>
                      <ResultBadge result={g.result} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <Badge variant="secondary">In progress</Badge>;
  if (result === 'draw') return <Badge variant="secondary">Draw</Badge>;
  return <Badge>{result === 'white_win' ? 'White won' : 'Black won'}</Badge>;
}
