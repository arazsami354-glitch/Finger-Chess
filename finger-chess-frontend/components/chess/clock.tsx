'use client';

import { useEffect, useState } from 'react';
import { PresenceDot } from '@/components/social/presence-dot';
import type { PresenceStatus } from '@/hooks/use-social-socket';
import { cn } from '@/lib/utils';

export function ChessClock({
  ms,
  isRunning,
  label,
  presenceStatus,
}: {
  ms: number;
  isRunning: boolean;
  label: string;
  presenceStatus?: PresenceStatus;
}) {
  const [remaining, setRemaining] = useState(ms);

  useEffect(() => setRemaining(ms), [ms]);

  useEffect(() => {
    if (!isRunning) return;
    // Whole-second display granularity — a 1s tick is visually identical to
    // 100ms while re-rendering 10x less often.
    const interval = setInterval(() => setRemaining((r) => Math.max(0, r - 1000)), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  const totalSeconds = Math.max(0, Math.floor(remaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const low = remaining < 30_000;

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3 flex items-center justify-between transition-colors',
        isRunning ? 'border-primary bg-primary/10' : 'border-border bg-card',
        low && isRunning && 'border-loss bg-loss/10 animate-pulse-ring',
      )}
    >
      <span className="text-xs text-muted-foreground uppercase tracking-wider inline-flex items-center gap-2">
        {presenceStatus && <PresenceDot status={presenceStatus} />}
        {label}
      </span>
      <span className={cn('font-mono text-xl font-semibold tabular-nums', low ? 'text-loss' : 'text-foreground')}>
        {minutes}:{seconds.toString().padStart(2, '0')}
      </span>
    </div>
  );
}
