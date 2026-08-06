'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Eye, History, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import {
  GAME_MODES,
  MODE_LABELS,
  displayName,
  formatMediumDate,
  type MatchHistoryEnvelope,
  type MatchHistoryItem,
  type MatchOutcome,
} from '@/lib/profile';

const OUTCOME_META: Record<MatchOutcome, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  win: { label: 'W', variant: 'default' },
  draw: { label: 'D', variant: 'secondary' },
  loss: { label: 'L', variant: 'destructive' },
};

export function MatchHistory({
  playerId,
  timeControlOptions,
}: {
  playerId: string;
  timeControlOptions?: { label: string }[];
}) {
  const [result, setResult] = useState('');
  const [mode, setMode] = useState('');
  const [rated, setRated] = useState('');
  const [timeControl, setTimeControl] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<MatchHistoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const fetchPage = useCallback(
    async (pageCursor: string | null, append: boolean) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set('take', '20');
        if (pageCursor) params.set('cursor', pageCursor);
        if (result && result !== '__all') params.set('result', result);
        if (mode && mode !== '__all') params.set('mode', mode);
        if (rated && rated !== '__all') params.set('rated', rated);
        if (timeControl && timeControl !== '__all') params.set('timeControl', timeControl);
        if (debouncedSearch) params.set('search', debouncedSearch);

        const { data } = await api.get<MatchHistoryEnvelope>(`/social/players/${playerId}/games?${params}`);
        if (seq !== requestSeq.current) return;
        setItems((prev) => (append ? [...prev, ...data.items] : data.items));
        setNextCursor(data.nextCursor);
      } catch (err: any) {
        if (seq !== requestSeq.current) return;
        setError(err.response?.data?.message ?? 'Could not load match history');
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [playerId, result, mode, rated, timeControl, debouncedSearch],
  );

  useEffect(() => {
    setCursor(null);
    setItems([]);
    fetchPage(null, false);
  }, [fetchPage]);

  const opponent = (item: MatchHistoryItem) =>
    item.white.id === playerId ? item.black : item.white;

  const duration = (item: MatchHistoryItem) => {
    if (!item.startedAt || !item.endedAt) return null;
    const s = (new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime()) / 1000;
    if (s <= 0 || !isFinite(s)) return null;
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4 text-primary" />
          Match History
        </CardTitle>
        <span className="text-xs text-muted-foreground">{items.length} shown</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Select value={result} onValueChange={setResult}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Result" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All results</SelectItem>
              <SelectItem value="win">Win</SelectItem>
              <SelectItem value="loss">Loss</SelectItem>
              <SelectItem value="draw">Draw</SelectItem>
            </SelectContent>
          </Select>

          <Select value={mode} onValueChange={setMode}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Mode" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All modes</SelectItem>
              {GAME_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {MODE_LABELS[m]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(timeControlOptions?.length ?? 0) > 0 && (
            <Select value={timeControl} onValueChange={setTimeControl}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Time control" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All controls</SelectItem>
                {timeControlOptions!.map((tc) => (
                  <SelectItem key={tc.label} value={tc.label}>
                    {tc.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={rated} onValueChange={setRated}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Stake" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Free & Paid</SelectItem>
              <SelectItem value="false">Free</SelectItem>
              <SelectItem value="true">Paid</SelectItem>
            </SelectContent>
          </Select>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search opponent…"
            className="w-44 sm:w-56"
          />

          {(result || mode || rated || timeControl || debouncedSearch) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setResult('');
                setMode('');
                setRated('');
                setTimeControl('');
                setSearch('');
              }}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Reset
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="divide-y divide-border rounded-lg border border-border">
          {loading && items.length === 0 ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              icon={History}
              title="No matches found"
              description="Try adjusting the filters, or play a game to populate history."
              className="py-10"
            />
          ) : (
            items.map((item) => {
              const opp = opponent(item);
              const meta = OUTCOME_META[item.outcome];
              const dur = duration(item);
              return (
                <div key={item.gameId} className="flex items-center gap-3 px-4 py-3">
                  <Badge variant={meta.variant} className="w-7 justify-center">
                    {meta.label}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-sm">
                      <span className="font-medium">vs</span>
                      <Link
                        href={`/players/${opp.id}`}
                        className="max-w-40 truncate font-medium hover:text-primary sm:max-w-64"
                      >
                        {displayName(opp.fullName, opp.email)}
                      </Link>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span className="font-mono">{item.timeControl}</span>
                      {item.rated ? (
                        <Badge variant="gold" className="px-1.5 py-0 text-[10px]">
                          ${Number(item.entryFee).toFixed(2)}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          Free
                        </Badge>
                      )}
                      {dur && <span>{dur}</span>}
                      <span>{formatMediumDate(item.endedAt ?? item.startedAt)}</span>
                    </div>
                  </div>
                  <Link
                    href={`/play/${item.gameId}`}
                    className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </Link>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {loading ? 'Loading…' : nextCursor ? 'More matches available' : items.length > 0 ? 'You’re all caught up' : ''}
          </span>
          {nextCursor && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPage(nextCursor, true)}
              disabled={loading}
            >
              Load more
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
