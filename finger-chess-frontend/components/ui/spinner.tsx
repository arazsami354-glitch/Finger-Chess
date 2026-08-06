import { cn } from '@/lib/utils';

/** Branded loading indicator — a gold ring, used everywhere a component is
 *  fetching. The rotating ring is GPU-cheap and reads as intentional rather
 *  than the bare "Loading…" text that used to litter the app. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn('inline-block h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary', className)}
    />
  );
}

/** Inline panel loader — fills the space a Card's content will occupy so the
 *  layout doesn't jump when data arrives. */
export function LoadingPanel({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex w-full flex-col items-center justify-center gap-3 py-14 text-muted-foreground', className)}>
      <Spinner className="h-7 w-7" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

/** Full-viewport loader for auth/onboarding flows that sit outside AppShell. */
export function FullScreenLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner className="h-8 w-8" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
