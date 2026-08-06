'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AppShell } from '@/components/layout/app-shell';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PlayerCard } from '@/components/social/player-card';
import { Search as SearchIcon, UserSearch, Clock, Star } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { EmptyState } from '@/components/ui/empty-state';

interface Player {
  id: string;
  fullName: string | null;
  email: string;
  avatarUrl?: string | null;
}

export default function SearchPlayersPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Player[]>([]);
  const [recentPlayers, setRecentPlayers] = useState<Player[]>([]);
  const [favorites, setFavorites] = useState<Player[]>([]);

  useEffect(() => {
    api.get('/social/friends/recent-players').then(({ data }) => setRecentPlayers(data));
    api.get('/social/friends/favorites').then(({ data }) => setFavorites(data));
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get('/social/friends/search', { params: { q: query } }).then(({ data }) => setResults(data));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  async function sendRequest(id: string) {
    try {
      await api.post('/social/friends/requests', { receiverId: id });
      toast.success('Friend request sent');
    } catch (err: any) {
      toast.error(err.response?.data?.message ?? 'Could not send request');
    }
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto space-y-6">
        <PageHeader title="Search Players" description="Find opponents by name or email." />

        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name or email…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {query.trim().length >= 2 && (
          <Card>
            <CardContent className="pt-6">
              {results.length === 0 ? (
                <EmptyState icon={UserSearch} title="No players found" description={`Nothing matches "${query.trim()}" — try a different spelling.`} />
              ) : (
                <div className="divide-y divide-border">
                  {results.map((p) => (
                    <PlayerCard
                      key={p.id}
                      id={p.id}
                      fullName={p.fullName}
                      email={p.email}
                      avatarUrl={p.avatarUrl}
                      actions={
                        <Button size="sm" onClick={() => sendRequest(p.id)}>
                          Add Friend
                        </Button>
                      }
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Players</CardTitle>
          </CardHeader>
          <CardContent>
            {recentPlayers.length === 0 ? (
              <EmptyState icon={Clock} title="No recent players" description="Play a game to see recent opponents here." className="py-8" />
            ) : (
              <div className="divide-y divide-border">
                {recentPlayers.map((p) => (
                  <PlayerCard key={p.id} id={p.id} fullName={p.fullName} email={p.email} avatarUrl={p.avatarUrl} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Favorite Opponents</CardTitle>
          </CardHeader>
          <CardContent>
            {favorites.length === 0 ? (
              <EmptyState icon={Star} title="No favorites yet" description="Star an opponent from their profile to pin them here." className="py-8" />
            ) : (
              <div className="divide-y divide-border">
                {favorites.map((p) => (
                  <PlayerCard key={p.id} id={p.id} fullName={p.fullName} email={p.email} avatarUrl={p.avatarUrl} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
