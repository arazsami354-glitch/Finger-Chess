'use client';

import { outcomeColor, outcomeLabel, type MatchOutcome } from '@/lib/profile';

export function FormStrip({ form, limit = 20 }: { form: MatchOutcome[]; limit?: number }) {
  const recent = form.slice(-limit);
  const counts = recent.reduce(
    (acc, o) => {
      acc[o] += 1;
      return acc;
    },
    { win: 0, loss: 0, draw: 0 } as Record<MatchOutcome, number>,
  );

  if (recent.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">No completed games in the recent window.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {recent.map((o, i) => (
          <span
            key={i}
            title={`${outcomeLabel(o)} (game ${i + 1} of recent ${recent.length})`}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-bold text-background transition-transform duration-150 hover:scale-110"
            style={{ backgroundColor: outcomeColor(o) }}
          >
            {o === 'win' ? 'W' : o === 'loss' ? 'L' : 'D'}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'hsl(var(--gain))' }} />
          {counts.win} W
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'hsl(var(--loss))' }} />
          {counts.loss} L
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'hsl(var(--gold))' }} />
          {counts.draw} D
        </span>
      </div>
    </div>
  );
}
