export type TimeCategory = 'bullet' | 'blitz' | 'rapid' | 'classical';

export interface TimeControlDefinition {
  id: string;
  label: string; // standard "base+increment" notation, in minutes/seconds
  baseMs: number;
  incrementMs: number;
  category: TimeCategory;
}

/**
 * Categorization follows the standard chess-server convention: estimated
 * game length = base + 40 * increment (40 being a rough average game
 * length in moves). Thresholds match Lichess/Chess.com conventions:
 *   < 3 min  -> bullet
 *   < 8 min  -> blitz
 *   < 25 min -> rapid
 *   >= 25min -> classical
 */
export function categorize(baseSeconds: number, incrementSeconds: number): TimeCategory {
  const estimate = baseSeconds + 40 * incrementSeconds;
  if (estimate < 180) return 'bullet';
  if (estimate < 480) return 'blitz';
  if (estimate < 1500) return 'rapid';
  return 'classical';
}

function define(id: string, baseSeconds: number, incrementSeconds: number): TimeControlDefinition {
  return {
    id,
    label: incrementSeconds > 0 ? `${baseSeconds / 60}+${incrementSeconds}` : `${baseSeconds / 60}+0`,
    baseMs: baseSeconds * 1000,
    incrementMs: incrementSeconds * 1000,
    category: categorize(baseSeconds, incrementSeconds),
  };
}

export const TIME_CONTROLS: Record<string, TimeControlDefinition> = {
  bullet_1_0: define('bullet_1_0', 60, 0),
  bullet_2_1: define('bullet_2_1', 120, 1),
  blitz_3_0: define('blitz_3_0', 180, 0),
  blitz_3_2: define('blitz_3_2', 180, 2),
  blitz_5_0: define('blitz_5_0', 300, 0),
  blitz_5_3: define('blitz_5_3', 300, 3),
  rapid_10_0: define('rapid_10_0', 600, 0),
  rapid_15_10: define('rapid_15_10', 900, 10),
  classical_30_0: define('classical_30_0', 1800, 0),
  classical_60_0: define('classical_60_0', 3600, 0),
};

export function getTimeControl(id: string): TimeControlDefinition {
  const tc = TIME_CONTROLS[id];
  if (!tc) throw new Error(`Unknown time control id: ${id}`);
  return tc;
}

export function listTimeControlsByCategory(category: TimeCategory): TimeControlDefinition[] {
  return Object.values(TIME_CONTROLS).filter((tc) => tc.category === category);
}
