'use client';

import { useId } from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  segments,
  centerLabel = 'Total',
  valueFormatter = (v: number) => String(v),
}: {
  segments: DonutSegment[];
  centerLabel?: string;
  valueFormatter?: (v: number) => string;
}) {
  const id = useId();
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground">
        No games played yet
      </div>
    );
  }

  const R = 40;
  const C = 2 * Math.PI * R;
  const GAP = total > 1 ? 2 : 0;

  let cumulative = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const length = Math.max((s.value / total) * C - GAP, 0);
      const offset = cumulative;
      cumulative += (s.value / total) * C;
      return { ...s, length, offset };
    });

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
      <div className="relative shrink-0">
        <svg viewBox="0 0 100 100" className="h-40 w-40" role="img">
          <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="12" opacity="0.5" />
          <g transform="rotate(-90 50 50)">
            {arcs.map((arc, i) => (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={arc.color}
                strokeWidth="12"
                strokeDasharray={`${arc.length} ${C - arc.length}`}
                strokeDashoffset={-arc.offset}
                strokeLinecap={GAP > 0 ? 'butt' : 'round'}
                style={{ transition: 'stroke-dasharray 0.4s cubic-bezier(0.16,1,0.3,1)' }}
              />
            ))}
          </g>
          <text x="50" y="47" textAnchor="middle" fontSize="16" fontWeight="700" fill="hsl(var(--foreground))">
            {total}
          </text>
          <text x="50" y="60" textAnchor="middle" fontSize="8" fill="hsl(var(--muted-foreground))">
            {centerLabel}
          </text>
        </svg>
      </div>
      <ul className="grid flex-1 grid-cols-1 gap-2 sm:max-w-56">
        {segments.map((s, i) => {
          const pct = total > 0 ? ((s.value / total) * 100).toFixed(1) : '0';
          return (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                {s.label}
              </span>
              <span className="font-semibold tabular-nums">
                {valueFormatter(s.value)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">{pct}%</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
