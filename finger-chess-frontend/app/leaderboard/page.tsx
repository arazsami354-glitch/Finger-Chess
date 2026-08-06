'use client';

import { useEffect, useState } from 'react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Trophy } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingPanel } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';

interface LeaderboardEntry {
  rank: number;
  userId: string;
  email: string;
  fullName: string | null;
  rating: number;
  gamesPlayed: number;
}

const CATEGORIES = ['bullet', 'blitz', 'rapid', 'classical'];

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState('blitz');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);

  useEffect(() => {
    setEntries(null);
    api.get('/users/leaderboard', { params: { gameMode: category } }).then(({ data }) => setEntries(data));
  }, [category]);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-6">
        <PageHeader title="Leaderboard" description="Top-rated players, by time control." />

        <Tabs value={category} onValueChange={setCategory}>
          <TabsList>
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c} value={c} className="capitalize">
                {c}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value={category}>
            <Card>
              <CardContent className="pt-6">
                {entries === null ? (
                  <LoadingPanel />
                ) : entries.length === 0 ? (
                  <EmptyState
                    icon={Trophy}
                    title="No rated players yet"
                    description="Ratings appear here once players finish games in this time control."
                  />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">Rank</TableHead>
                        <TableHead>Player</TableHead>
                        <TableHead className="text-right">Rating</TableHead>
                        <TableHead className="text-right">Games</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((e) => (
                        <TableRow key={e.userId} className={cn(e.userId === user?.id && 'bg-primary/5')}>
                          <TableCell>
                            {e.rank <= 3 ? (
                              <Trophy className={cn('h-4 w-4', e.rank === 1 ? 'text-gold' : e.rank === 2 ? 'text-muted-foreground' : 'text-loss/70')} />
                            ) : (
                              <span className="text-muted-foreground text-sm">{e.rank}</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2.5">
                              <Avatar className="h-7 w-7">
                                <AvatarFallback className="text-[10px] bg-secondary">
                                  {(e.fullName || e.email).slice(0, 2).toUpperCase()}
                                </AvatarFallback>
                              </Avatar>
                              <span className="text-sm">{e.fullName || e.email}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{e.rating}</TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground text-sm">{e.gamesPlayed}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
