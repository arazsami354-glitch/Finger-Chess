export interface Tournament {
  id: string;
  name: string;
  description: string | null;
  format: string;
  visibility: string;
  entryType: string;
  entryFee: number;
  prizePool: number;
  maxPlayers: number;
  minPlayers: number;
  registrationDeadline: string | null;
  startTime: string | null;
  timeControl: string;
  status: string;
  currentRound: number;
  rounds: number | null;
  settings: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
  cancellationReason: string | null;
  playerCount?: number;
  waitlistCount?: number;
}

export interface DetailedMatch {
  id: string;
  round: number;
  bracket: string;
  slot: number;
  status: string;
  result: string | null;
  winnerUserId: string | null;
  whiteUser: { id: string; email: string; fullName: string | null } | null;
  blackUser: { id: string; email: string; fullName: string | null } | null;
  gameId: string | null;
}

export interface StandingsEntry {
  id: string;
  name: string | null;
  email: string | null;
  rating: number | null;
  score: number;
  buchholz: number;
  byesTaken: number;
}

export const FORMAT_LABELS: Record<string, string> = {
  single_elimination: 'Single Elimination',
  double_elimination: 'Double Elimination',
  swiss: 'Swiss',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  registered: 'Open',
  active: 'Live',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function statusVariant(status: string): 'default' | 'secondary' | 'gain' | 'warn' | 'destructive' | 'gold' {
  switch (status) {
    case 'active':
      return 'gain';
    case 'registered':
      return 'default';
    case 'draft':
      return 'warn';
    case 'completed':
      return 'gold';
    case 'cancelled':
      return 'destructive';
    default:
      return 'secondary';
  }
}

export function entryLabel(t: Tournament): string {
  return t.entryType === 'paid' && t.entryFee > 0 ? `$${t.entryFee.toFixed(2)} entry` : 'Free entry';
}

export function formatTimeControl(timeControl: string): string {
  return timeControl.replace(/_/g, ' ');
}

export function isRegistrationOpen(t: Tournament, now: number): boolean {
  if (t.status !== 'draft' && t.status !== 'registered') return false;
  if (t.registrationDeadline && new Date(t.registrationDeadline).getTime() < now) return false;
  return true;
}
