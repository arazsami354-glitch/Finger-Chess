'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/components/providers/auth-provider';
import { useMatchmakingSocket } from '@/hooks/use-matchmaking-socket';
import { SearchingScreen } from '@/components/lobby/searching-screen';
import { MatchSettings, type ColorPreference } from '@/components/lobby/match-settings';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { ShieldAlert, TimerOff } from 'lucide-react';
import { TIME_CONTROLS } from '@/lib/time-controls';

// $0 is a real, first-class tier — free/practice play, open to everyone
// regardless of age or KYC status. Every other tier is real money and
// requires verified identity (see the eligibility check below).
const ENTRY_FEES = [5, 10, 25, 50, 100];

export default function LobbyPage() {
  const { user, wallet } = useAuth();
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
  const [selectedFee, setSelectedFee] = useState(5);
  const [rated, setRated] = useState(true);
  const [colorPreference, setColorPreference] = useState<ColorPreference>('random');
  const [elapsed, setElapsed] = useState(0);
  const [ageEligible, setAgeEligible] = useState<boolean | null>(null);

  useEffect(() => {
    api.get('/compliance/age').then(({ data }) => setAgeEligible(data.meetsMinimumAge));
  }, []);

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

  const isPaid = selectedFee > 0;
  const kycVerified = user?.kycStatus === 'verified';
  const canAfford = wallet ? wallet.available >= selectedFee : false;

  // Surfaced BEFORE a join attempt, matching exactly what the backend's
  // MatchmakingService.assertEligible actually enforces — no dead-end
  // "request rejected" for something this page could have told you upfront.
  const blockedReason = !isPaid
    ? null
    : ageEligible === false
      ? 'You must meet the minimum age to play for real money.'
      : !kycVerified
        ? 'Identity verification is required for paid rooms.'
        : !canAfford
          ? 'Insufficient balance for this stake.'
          : null;

  const handleJoin = () => {
    const ok = joinQueue(selectedTc, selectedFee, { rated, colorPreference });
    if (!ok) toast.error('Could not connect to matchmaking. Please try again.');
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <Link href="/lobby" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3">
            ← Back to game modes
          </Link>
          <h1 className="font-display font-bold text-2xl">Real Money Match</h1>
          <p className="text-muted-foreground text-sm mt-1">Pick your time control and stake — matched only against players in the same room.</p>
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

            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-3">Entry Fee</h2>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {ENTRY_FEES.map((fee) => (
                  <button
                    key={fee}
                    onClick={() => setSelectedFee(fee)}
                    className={cn(
                      'rounded-lg border p-4 text-center transition-colors relative',
                      selectedFee === fee
                        ? fee === 0
                          ? 'border-primary bg-primary/10'
                          : 'border-gold bg-gold/10'
                        : 'border-border hover:border-gold/40',
                    )}
                  >
                    <div className="font-mono font-bold text-lg">{fee === 0 ? 'Free' : `$${fee}`}</div>
                    {fee > 0 && !kycVerified && (
                      <Badge variant="gold" className="absolute -top-2 -right-2 text-[9px] px-1.5">
                        KYC
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
              {isPaid && !kycVerified && (
                <p className="text-xs text-muted-foreground mt-2">
                  Paid rooms require identity verification.{' '}
                  <Link href="/settings/verification" className="text-primary underline">
                    Verify your identity
                  </Link>
                  .
                </p>
              )}
            </div>

            <MatchSettings
              rated={rated}
              onRatedChange={setRated}
              colorPreference={colorPreference}
              onColorPreferenceChange={setColorPreference}
            />

            <Card className="bg-secondary/50">
              <CardContent className="pt-6 flex items-center justify-between gap-4">
                <div className="text-sm text-muted-foreground">
                  {isPaid ? (
                    <>
                      Potential prize: <span className="font-mono text-foreground font-semibold">up to ${(selectedFee * 2 * 0.9).toFixed(2)}</span>
                      <span className="text-xs"> (after commission)</span> · {rated ? 'Rated' : 'Casual'}
                    </>
                  ) : (
                    'No stakes — practice freely, no verification required.'
                  )}
                </div>
                <Button size="lg" disabled={!!blockedReason} onClick={handleJoin}>
                  {blockedReason ? (
                    <>
                      <ShieldAlert className="h-4 w-4" /> Unavailable
                    </>
                  ) : (
                    `Find Match${isPaid ? ` — $${selectedFee}` : ''}`
                  )}
                </Button>
              </CardContent>
              {blockedReason && <CardContent className="pt-0 -mt-4 text-xs text-destructive">{blockedReason}</CardContent>}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
