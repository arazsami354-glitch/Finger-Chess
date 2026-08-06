'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useMatchmakingSocket } from '@/hooks/use-matchmaking-socket';
import { SearchingScreen } from '@/components/lobby/searching-screen';
import { MatchSettings, type ColorPreference } from '@/components/lobby/match-settings';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TimerOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { TIME_CONTROLS } from '@/lib/time-controls';

// Free Play always joins the $0 room — never surfaced as a choice on this
// page at all, since there's genuinely nothing to choose: no stake, no
// wallet check, no KYC gate. The backend's own room-key design (time
// control + entry fee + rated together define a room) already guarantees
// this queue can never mix with a paid one — see
// matchmaking/config/entry-fees.ts's roomKey() for the underlying
// guarantee this page relies on.
const FREE_ENTRY_FEE = 0;

export default function FreePlayLobbyPage() {
  const router = useRouter();
  const {
    state,
    matchedGameId,
    queuedSince,
    estimatedWaitSeconds,
    currentRatingBand,
    connectionQuality,
    pingMs,
    joinQueue,
    cancelQueue,
  } = useMatchmakingSocket();
  const [selectedTc, setSelectedTc] = useState(TIME_CONTROLS[2].id);
  const [rated, setRated] = useState(true);
  const [colorPreference, setColorPreference] = useState<ColorPreference>('random');
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (matchedGameId) {
      const t = setTimeout(() => router.push(`/play/${matchedGameId}`), 600);
      return () => clearTimeout(t);
    }
  }, [matchedGameId, router]);

  useEffect(() => {
    if (state !== 'queued' || !queuedSince) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - queuedSince) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [state, queuedSince]);

  const handleJoin = () => {
    const ok = joinQueue(selectedTc, FREE_ENTRY_FEE, { rated, colorPreference });
    if (!ok) toast.error('Could not connect to matchmaking. Please try again.');
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <Link href="/lobby" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3">
            ← Back to game modes
          </Link>
          <h1 className="font-display font-bold text-2xl">Free Play</h1>
          <p className="text-muted-foreground text-sm mt-1">No stakes, no wallet, no verification — just chess. Pick a time control.</p>
        </div>

        {state === 'timeout' ? (
          <Card>
            <CardContent className="pt-10 pb-10 flex flex-col items-center gap-5 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
                <TimerOff className="h-5 w-5 text-muted-foreground" />
              </span>
              <div className="space-y-1">
                <p className="font-display font-semibold text-lg">No opponent found</p>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  The queue timed out and your spot was released. Try again, or adjust your settings.
                </p>
              </div>
              <div className="flex gap-3">
                <Button onClick={handleJoin}>Search again</Button>
                <Button variant="outline" onClick={cancelQueue}>
                  Change settings
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : state === 'queued' || state === 'matched' ? (
          <SearchingScreen
            matched={state === 'matched'}
            elapsedSeconds={elapsed}
            estimatedWaitSeconds={estimatedWaitSeconds}
            currentRatingBand={currentRatingBand}
            connectionQuality={connectionQuality}
            pingMs={pingMs}
            onCancel={cancelQueue}
          />
        ) : (
          <>
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Time Control</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {TIME_CONTROLS.map((tc) => (
                  <button
                    key={tc.id}
                    onClick={() => setSelectedTc(tc.id)}
                    className={cn(
                      'rounded-lg border p-4 text-left transition-colors',
                      selectedTc === tc.id ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/40',
                    )}
                  >
                    <tc.icon className="h-4 w-4 text-primary mb-2" />
                    <div className="font-mono font-semibold text-sm">{tc.label}</div>
                    <div className="text-xs text-muted-foreground">{tc.category}</div>
                  </button>
                ))}
              </div>
            </div>

            <MatchSettings
              rated={rated}
              onRatedChange={setRated}
              colorPreference={colorPreference}
              onColorPreferenceChange={setColorPreference}
            />

            <Card className="bg-secondary/50">
              <CardContent className="pt-6 flex items-center justify-between">
                <div className="text-sm text-muted-foreground">
                  {rated ? 'Rated free play — no stakes, but your Elo is on the line.' : 'Casual free play — no stakes, no rating change.'}
                </div>
                <Button size="lg" onClick={handleJoin}>
                  Find Match
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
