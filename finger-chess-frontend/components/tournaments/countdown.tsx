'use client';

import { useCountdown } from '@/lib/use-countdown';
import { cn } from '@/lib/utils';

const pad = (n: number) => String(n).padStart(2, '0');

/** Compact inline timer: `1d 02:03:04`. Screen-reader friendly via role="timer". */
export function Countdown({ target, className }: { target: string | number | Date; className?: string }) {
  const { days, hours, minutes, seconds } = useCountdown(target);
  const label = `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return (
    <span
      role="timer"
      aria-label={`${days} days, ${hours} hours, ${minutes} minutes, ${seconds} seconds remaining`}
      className={cn('font-mono tabular-nums', className)}
    >
      {label}
    </span>
  );
}

/** Labeled phrase that swaps copy once the target passes: "Starts in 1d 02:03:04". */
export function CountdownPhrase({
  target,
  label,
  expiredLabel,
  className,
}: {
  target: string | number | Date;
  label: string;
  expiredLabel: string;
  className?: string;
}) {
  const { expired } = useCountdown(target);
  if (expired) return <span className={cn('text-muted-foreground', className)}>{expiredLabel}</span>;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      {label} in <Countdown target={target} />
    </span>
  );
}
