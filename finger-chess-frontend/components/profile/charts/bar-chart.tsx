'use client';

import { useState } from 'react';

export interface BarDatum {
  label: string;
  value: number;
  secondary?: number;
  color?: string;
  secondaryColor?: string;
}

export function BarChart({
  data,
  height = 160,
  color = 'hsl(var(--primary))',
  secondaryColor = 'hsl(var(--gain))',
  valueFormatter = (v: number) => String(v),
}: {
  data: BarDatum[];
  height?: number;
  color?: string;
  secondaryColor?: string;
  valueFormatter?: (v: number) => string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const W = 600;
  const H = height;
  const PAD = { t: 14, r: 8, b: 22, l: 8 };

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const slotW = (W - PAD.l - PAD.r) / data.length;
  const barW = Math.min(slotW * 0.6, 30);
  const plotH = H - PAD.t - PAD.b;

  if (data.length === 0) {
    return (
      <div className="flex h-full min-h-32 items-center justify-center text-sm text-muted-foreground">
        No data yet
      </div>
    );
  }

  const cx = (i: number) => PAD.l + slotW * i + slotW / 2;
  const yFor = (v: number) => PAD.t + (1 - v / maxValue) * plotH;

  const showEveryLabel = data.length <= 12 ? 1 : 2;

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(data.length - 1, Math.floor(ratio * data.length)));
    setHoverIndex(index);
  };

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIndex(null)}
      role="img"
    >
      {[0, 0.5, 1].map((f, i) => (
        <line
          key={i}
          x1={PAD.l}
          x2={W - PAD.r}
          y1={yFor(f * maxValue)}
          y2={yFor(f * maxValue)}
          stroke="hsl(var(--border))"
          strokeWidth="1"
        />
      ))}

      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max((d.value / maxValue) * plotH, 2) : 0;
        const top = yFor(d.value);
        const main = d.secondary !== undefined ? (d.secondary / maxValue) * plotH : h;
        return (
          <g key={i} opacity={hoverIndex === null || hoverIndex === i ? 1 : 0.35}>
            <rect
              x={cx(i) - barW / 2}
              y={top}
              width={barW}
              height={h}
              rx="3"
              fill={d.color ?? color}
            />
            {d.secondary !== undefined && d.secondary > 0 && (
              <rect
                x={cx(i) - barW / 2}
                y={yFor(d.secondary)}
                width={barW}
                height={Math.max(main, 2)}
                rx="3"
                fill={d.secondaryColor ?? secondaryColor}
              />
            )}
            {hoverIndex === i && (
              <text
                x={cx(i)}
                y={Math.max(top - 4, 8)}
                textAnchor="middle"
                fontSize="9"
                fontWeight="600"
                fill="hsl(var(--foreground))"
              >
                {valueFormatter(d.value)}
              </text>
            )}
            {i % showEveryLabel === 0 && (
              <text
                x={cx(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize="8.5"
                fill="hsl(var(--muted-foreground))"
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
