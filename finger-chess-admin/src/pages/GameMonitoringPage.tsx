import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Panel, Badge, Button, LoadingRow, EmptyState } from '../components/ui';

interface LiveGame {
  id: string;
  entryFee: string;
  timeControl: string;
  startedAt: string;
  playerWhite: { email: string };
  playerBlack: { email: string };
}

interface FlaggedEntry {
  report: {
    id: string;
    gameId: string;
    userId: string;
    averageCentipawnLoss: number;
    topEngineMoveMatchPercent: number;
    suspicionScore: number;
  };
  game: { id: string; playerWhite: { email: string }; playerBlack: { email: string } } | undefined;
}

export function GameMonitoringPage() {
  const [live, setLive] = useState<LiveGame[]>([]);
  const [flagged, setFlagged] = useState<FlaggedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'' | 'free' | 'paid'>('');

  function load() {
    setLoading(true);
    Promise.all([
      api.get('/admin/games/live', { params: { mode: mode || undefined } }).then(({ data }) => setLive(data)),
      api.get('/admin/games/flagged').then(({ data }) => setFlagged(data)),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 15_000);
    return () => clearInterval(interval);
  }, [mode]);

  async function review(reportId: string, decision: 'reviewed_clean' | 'confirmed_cheating') {
    await api.post(`/admin/games/anticheat/${reportId}/review`, { decision });
    load();
  }

  if (loading) return <LoadingRow />;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Game Monitoring</h1>

      <Panel
        title={`Live Games (${live.length})`}
        action={
          <select className="input w-36" value={mode} onChange={(e) => setMode(e.target.value as '' | 'free' | 'paid')}>
            <option value="">All modes</option>
            <option value="free">Free Play</option>
            <option value="paid">Real Money</option>
          </select>
        }
      >
        {live.length === 0 ? (
          <EmptyState message="No games currently in progress." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">White</th>
                <th className="th">Black</th>
                <th className="th">Mode</th>
                <th className="th">Entry Fee</th>
                <th className="th">Time Control</th>
                <th className="th">Started</th>
              </tr>
            </thead>
            <tbody>
              {live.map((g) => (
                <tr key={g.id}>
                  <td className="td">{g.playerWhite.email}</td>
                  <td className="td">{g.playerBlack.email}</td>
                  <td className="td">
                    <Badge tone={Number(g.entryFee) === 0 ? 'default' : 'gain'}>{Number(g.entryFee) === 0 ? 'Free' : 'Paid'}</Badge>
                  </td>
                  <td className="td font-mono">${Number(g.entryFee).toFixed(2)}</td>
                  <td className="td">{g.timeControl}</td>
                  <td className="td text-xs text-ink-faint font-mono">{new Date(g.startedAt).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title={`Anti-Cheat Review Queue (${flagged.length})`}>
        {flagged.length === 0 ? (
          <EmptyState message="No games currently flagged for review." />
        ) : (
          <table className="-m-5 w-[calc(100%+2.5rem)]">
            <thead>
              <tr>
                <th className="th">Players</th>
                <th className="th">Avg Centipawn Loss</th>
                <th className="th">Top-Move Match</th>
                <th className="th">Suspicion Score</th>
                <th className="th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {flagged.map(({ report, game }) => (
                <tr key={report.id}>
                  <td className="td text-xs">
                    {game ? `${game.playerWhite.email} vs ${game.playerBlack.email}` : report.gameId}
                  </td>
                  <td className="td font-mono">{report.averageCentipawnLoss.toFixed(1)}</td>
                  <td className="td font-mono">{report.topEngineMoveMatchPercent.toFixed(1)}%</td>
                  <td className="td">
                    <Badge tone={report.suspicionScore > 70 ? 'loss' : 'warn'}>{report.suspicionScore.toFixed(0)}</Badge>
                  </td>
                  <td className="td">
                    <div className="flex gap-2">
                      <Button onClick={() => review(report.id, 'reviewed_clean')}>Clear</Button>
                      <Button tone="danger" onClick={() => review(report.id, 'confirmed_cheating')}>
                        Confirm
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
