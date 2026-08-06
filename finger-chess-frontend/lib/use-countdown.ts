'use client';

import { useEffect, useMemo, useState } from 'react';

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
  expired: boolean;
}

/** Ticks once per second toward a target timestamp. Returns zero-padded-ready
 *  parts plus `expired` so callers can swap copy the moment the deadline hits. */
export function useCountdown(target: string | number | Date): CountdownParts {
  const targetMs = useMemo(() => new Date(target).getTime(), [target]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  const total = Math.max(0, targetMs - now);
  return {
    days: Math.floor(total / 86_400_000),
    hours: Math.floor(total / 3_600_000) % 24,
    minutes: Math.floor(total / 60_000) % 60,
    seconds: Math.floor(total / 1_000) % 60,
    total,
    expired: total <= 0,
  };
}
