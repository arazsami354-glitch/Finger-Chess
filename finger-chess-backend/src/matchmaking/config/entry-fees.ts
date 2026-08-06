// $0 is a real, first-class tier — free/practice play, open to everyone
// regardless of age or KYC status. Every other tier is real money.
export const ENTRY_FEE_TIERS = [0, 5, 10, 25, 50, 100] as const;
export type EntryFeeTier = (typeof ENTRY_FEE_TIERS)[number];

export function isValidEntryFee(amount: number): amount is EntryFeeTier {
  return (ENTRY_FEE_TIERS as readonly number[]).includes(amount);
}

/**
 * A "room" is the pairing unit: players are only ever matched against
 * someone in the exact same room. Three dimensions define a room — time
 * control, entry fee AND rated/casual — so a $10 Rated Blitz queue and a
 * $10 Casual Blitz queue never mix, and neither do a $10 Blitz queue and a
 * $25 Blitz queue.
 */
export function roomKey(timeControlId: string, entryFee: EntryFeeTier, rated: boolean): string {
  return `${timeControlId}:${entryFee}:${rated ? 'rated' : 'casual'}`;
}

/**
 * Every paid room requires verified KYC — this used to only apply at $50+,
 * but the platform's compliance policy now requires identity verification
 * before ANY real-money match, not just the highest stakes. $0 (free play)
 * never requires it, which is exactly how an unverified or under-minimum-age
 * account still has something to do on the platform.
 */
export function requiresKyc(entryFee: EntryFeeTier): boolean {
  return entryFee > 0;
}
