export type ColorPreference = 'random' | 'white' | 'black';

export const COLOR_PREFERENCES: readonly ColorPreference[] = ['random', 'white', 'black'];

/**
 * Resolves which of two players gets white given each one's preference.
 * Guarantees a player who explicitly picked a color keeps it UNLESS the
 * opponent picked the same color (a two-player match can only satisfy one of
 * them — in that genuine conflict, or when both are random, we coin-flip).
 */
export function resolveColors(
  aPref: ColorPreference,
  bPref: ColorPreference,
): { playerA: 'white' | 'black'; playerB: 'white' | 'black' } {
  if (aPref === 'white' && bPref !== 'white') return { playerA: 'white', playerB: 'black' };
  if (aPref === 'black' && bPref !== 'black') return { playerA: 'black', playerB: 'white' };
  if (bPref === 'white' && aPref !== 'white') return { playerA: 'black', playerB: 'white' };
  if (bPref === 'black' && aPref !== 'black') return { playerA: 'white', playerB: 'black' };
  return Math.random() < 0.5 ? { playerA: 'white', playerB: 'black' } : { playerA: 'black', playerB: 'white' };
}
