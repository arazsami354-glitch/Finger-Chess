'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConnectionQuality } from '@/hooks/use-matchmaking-socket';
import { Wifi, WifiOff, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUALITY_META: Record<ConnectionQuality, { label: string; color: string }> = {
  excellent: { label: 'Excellent', color: 'text-gain' },
  good: { label: 'Good', color: 'text-gain' },
  fair: { label: 'Fair', color: 'text-warn' },
  poor: { label: 'Poor', color: 'text-destructive' },
  unknown: { label: 'Measuring…', color: 'text-muted-foreground' },
};

interface SearchingScreenProps {
  matched: boolean;
  elapsedSeconds: number;
  estimatedWaitSeconds: number | null;
  currentRatingBand: number | null;
  connectionQuality: ConnectionQuality;
  pingMs: number | null;
  onCancel: () => void;
}

export function SearchingScreen({
  matched,
  elapsedSeconds,
  estimatedWaitSeconds,
  currentRatingBand,
  connectionQuality,
  pingMs,
  onCancel,
}: SearchingScreenProps) {
  const quality = QUALITY_META[connectionQuality];
  // Countdown toward the estimate rather than just counting up — "about
  // 12s left" feels faster and more premium than a bare elapsed timer,
  // and it's grounded in a real number (the rolling wait-time average),
  // not a fabricated countdown with nothing behind it. Floors at 0
  // instead of going negative once the estimate's been passed.
  const remaining = estimatedWaitSeconds !== null ? Math.max(estimatedWaitSeconds - elapsedSeconds, 0) : null;

  return (
    <Card className="border-primary/40 overflow-hidden">
      <CardContent className="pt-10 pb-10 flex flex-col items-center gap-5">
        <div className="relative h-20 w-20 flex items-center justify-center">
          {!matched && (
            <>
              <span className="absolute inset-0 rounded-full border-2 border-primary/40 animate-ping [animation-duration:1.8s]" />
              <span className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping [animation-duration:1.8s] [animation-delay:0.6s]" />
              <span className="absolute inset-0 rounded-full border-2 border-primary/20 animate-ping [animation-duration:1.8s] [animation-delay:1.2s]" />
            </>
          )}
          <div className={cn('h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center', matched && 'animate-scale-in')}>
            <Target className="h-5 w-5 text-primary" />
          </div>
        </div>

        <div className="text-center space-y-1">
          <div className="font-display font-semibold text-lg">{matched ? 'Match found — entering game…' : 'Searching for an opponent…'}</div>
          {!matched && (
            <div className="font-mono text-sm text-muted-foreground">
              {remaining !== null ? (
                <>
                  ~{remaining}s remaining{' '}
                  <span className="text-xs">
                    · {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} elapsed
                  </span>
                </>
              ) : (
                <>
                  {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')} elapsed
                </>
              )}
            </div>
          )}
        </div>

        {!matched && (
          <div className="flex items-center gap-4 text-xs">
            {currentRatingBand !== null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-muted-foreground">
                Searching ±{currentRatingBand} rating
              </span>
            )}
            <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1', quality.color)}>
              {connectionQuality === 'poor' ? <WifiOff className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
              {quality.label}
              {pingMs !== null && <span className="font-mono text-muted-foreground">{pingMs}ms</span>}
            </span>
          </div>
        )}

        {!matched && (
          <Button variant="outline" onClick={onCancel}>
            Cancel search
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
