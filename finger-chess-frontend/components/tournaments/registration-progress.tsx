'use client';

import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/** Registration fill bar: how many of the max player slots are taken. */
export function RegistrationProgress({ count, max, className }: { count: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0;
  const full = count >= max;
  const label = `${count}/${max} registered${full ? ' — full' : ''}`;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Progress
        value={pct}
        aria-label={label}
        indicatorClassName={full ? 'bg-gain' : undefined}
        className={cn(full && 'bg-gain/15')}
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{pct}%</span>
      </div>
    </div>
  );
}
