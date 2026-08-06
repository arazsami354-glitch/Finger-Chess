type StatusTone = 'gain' | 'warn' | 'destructive' | 'secondary';

const GAIN_STATUSES = new Set(['completed', 'success', 'approved']);
const WARN_STATUSES = new Set(['pending', 'requested', 'initiated', 'needs_more_info']);
const DESTRUCTIVE_STATUSES = new Set(['failed', 'rejected', 'reversed']);

/**
 * One shared mapping for every "status → color" need across the app —
 * previously duplicated with slightly different status vocabularies in
 * the wallet page and the KYC verification page. Covers both (and any
 * future status set using these same conventional words) since neither
 * vocabulary conflicts with the other.
 */
export function statusTone(status: string): StatusTone {
  if (GAIN_STATUSES.has(status)) return 'gain';
  if (WARN_STATUSES.has(status)) return 'warn';
  if (DESTRUCTIVE_STATUSES.has(status)) return 'destructive';
  return 'secondary';
}
