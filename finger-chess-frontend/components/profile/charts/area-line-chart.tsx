'use client';

import { useId, useMemo, useState } from 'react';

export interface LineChartPoint {
  label: string;
  value: number;
}

export interface LineSeries {
  name: string;
  color: string;
  points: LineChartPoint[];
}

export function AreaLineChart({
  series,
  height = 240,
  valueFormatter = (v: number) => String(v),
}: {
  series: LineSeries[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  const gradId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const W = 600;
  const H = height;
  const PAD = { t: 16, r: 16, b: 24, l: 16 };

  const count = Math.max(...series.map((s) => s.points.length), 0);

  const { min, max } = useMemo(() => {
    const vals = series.flatMap((s) => s.points.map((p) => p.value));
    if (vals.length === 0) return { min: 0, max: 1 };
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const range = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
    return { min: rawMin - range * 0.15, max: rawMax + range * 0.15 };
  }, [series]);

  const x = (i: number) =>
    count <= 1 ? W / 2 : PAD.l + (i / (count - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((max - v) / (max - min)) * (H - PAD.t - PAD.b);
  const base = H - PAD.b;

  const gridTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let i = 0; i < 4; i++) {
      ticks.push(max - ((max - min) * i) / 3);
    }
    return ticks;
  }, [min, max]);

  if (count === 0) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }

  const firstLabel = series[0]?.points[0]?.label ?? '';
  const lastLabel = series[0]?.points[count - 1]?.label ?? '';

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
    setHoverIndex(index);
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
      >
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${gradId}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {gridTicks.map((tick, i) => (
          <g key={i}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(tick)}
              y2={y(tick)}
              stroke="hsl(var(--border))"
              strokeWidth="1"
            />
            <text
              x={W - PAD.r}
              y={y(tick) - 3}
              textAnchor="end"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
            >
              {valueFormatter(Math.round(tick))}
            </text>
          </g>
        ))}

        {hoverIndex !== null && (
          <line
            x1={x(hoverIndex)}
            x2={x(hoverIndex)}
            y1={PAD.t}
            y2={base}
            stroke="hsl(var(--muted-foreground))"
            strokeOpacity="0.5"
            strokeDasharray="3 3"
          />
        )}

        {series.map((s, si) => {
          const linePath = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.value)}`).join(' ');
          const areaPath =
            count > 1
              ? `M${x(0)},${base} ${linePath.slice(1)} L${x(count - 1)},${base} Z`
              : '';
          return (
            <g key={si}>
              {areaPath && <path d={areaPath} fill={`url(#${gradId}-${si})`} />}
              <path d={linePath} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hoverIndex !== null && (
                <circle
                  cx={x(hoverIndex)}
                  cy={y(s.points[hoverIndex].value)}
                  r="3"
                  fill={s.color}
                  stroke="hsl(var(--card))"
                  strokeWidth="1.5"
                />
              )}
            </g>
          );
        })}

        {hoverIndex !== null && (
          <g>
            {series.map((s, si) => (
              <text
                key={si}
                x={x(hoverIndex)}
                y={si === 0 ? PAD.t + 4 : PAD.t + 16}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill={s.color}
              >
                {valueFormatter(s.points[hoverIndex].value)}
              </text>
            ))}
            <text
              x={x(hoverIndex)}
              y={H - 7}
              textAnchor="middle"
              fontSize="9"
              fill="hsl(var(--muted-foreground))"
            >
              {series[0].points[hoverIndex].label}
            </text>
          </g>
        )}

        {hoverIndex === null && (
          <>
            <text x={PAD.l} y={H - 7} fontSize="9" fill="hsl(var(--muted-foreground))">
              {firstLabel}
            </text>
            <text x={W - PAD.r} y={H - 7} textAnchor="end" fontSize="9" fill="hsl(var(--muted-foreground))">
              {lastLabel}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
