'use client';

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface RatingInfo {
  gameMode: string;
  rating: number;
  peakRating: number;
  gamesPlayed: number;
}

export interface PlayerStats {
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  free: { gamesPlayed: number; wins: number; draws: number; losses: number; winRate: number };
  paid: { gamesPlayed: number; wins: number; draws: number; losses: number; winRate: number };
  ratings: RatingInfo[];
}

export interface ProfileEnrichment {
  title: string | null;
  tournamentWins: number;
  currentStreak: number;
  longestStreak: number;
  avgGameDurationSeconds: number | null;
  avgMoveTimeSeconds: number | null;
  peakRatingOverall: number;
  primaryGameMode: string;
  recentForm: MatchOutcome[];
}

export interface PlayerProfile {
  id: string;
  fullName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  countryCode: string | null;
  memberSince: string;
  areFriends: boolean;
  isFavorited: boolean;
  friendsCount: number;
  presenceStatus: string | null;
  lastSeenAt: string | null;
  title: string | null;
  stats: PlayerStats | null;
  enrichment: ProfileEnrichment | null;
  favoriteOpening: { name: string; count: number } | null;
  recentGames: {
    gameId: string;
    opponent: { id: string; fullName: string | null; email: string };
    outcome: MatchOutcome;
    entryFee: number;
    timeControl: string;
    endedAt: string | null;
  }[];
  ratingHistory: { gameMode: string; points: { rating: number; createdAt: string }[] } | null;
  achievements: { id: string; name: string; description: string; icon: string }[];
  badges: { id: string; name: string; description: string; icon: string; tier: string }[];
}

export interface ProfileAnalytics {
  ratingHistory: { gameMode: string; points: { rating: number; createdAt: string }[] }[];
  monthlyActivity: { month: string; games: number; wins: number }[];
  winLoss: { wins: number; losses: number; draws: number };
  recentForm: MatchOutcome[];
  timeControls: { label: string; category: string; games: number; wins: number }[];
  openings: { name: string; count: number }[];
  performanceTrend: { month: string; games: number; wins: number; winRate: number }[];
  tournament: {
    joined: number;
    finished: number;
    wins: number;
    bestRank: number | null;
    prizes: number;
    history: {
      tournamentId: string;
      name: string;
      format: string;
      timeControl: string;
      status: string;
      finalRank: number | null;
      prizeAmount: number;
      joinedAt: string | null;
      endedAt: string | null;
    }[];
  };
  achievements: {
    id: string;
    code: string;
    name: string;
    description: string;
    icon: string;
    unlocked: boolean;
    unlockedAt: string | null;
    threshold: number;
    progress: number;
  }[];
}

export interface MatchHistoryItem {
  gameId: string;
  result: string | null;
  outcome: MatchOutcome;
  winnerId: string | null;
  white: { id: string; fullName: string | null; email: string };
  black: { id: string; fullName: string | null; email: string };
  timeControl: string;
  rated: boolean;
  entryFee: number;
  startedAt: string | null;
  endedAt: string | null;
}

export interface MatchHistoryEnvelope {
  items: MatchHistoryItem[];
  nextCursor: string | null;
}

export const GAME_MODES = ['bullet', 'blitz', 'rapid', 'classical'] as const;

export const MODE_LABELS: Record<string, string> = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rapid',
  classical: 'Classical',
};

const COUNTRIES: Record<string, string> = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia', DE: 'Germany',
  FR: 'France', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', SE: 'Sweden', NO: 'Norway',
  DK: 'Denmark', FI: 'Finland', IE: 'Ireland', PT: 'Portugal', PL: 'Poland', CH: 'Switzerland',
  AT: 'Austria', BE: 'Belgium', NZ: 'New Zealand', SG: 'Singapore', JP: 'Japan', KR: 'South Korea',
  IN: 'India', BR: 'Brazil', MX: 'Mexico', ZA: 'South Africa', AE: 'United Arab Emirates',
  IL: 'Israel', PH: 'Philippines',
};

export function countryName(code: string | null): string | null {
  if (!code) return null;
  return COUNTRIES[code.toUpperCase()] ?? code.toUpperCase();
}

export function formatGameDuration(totalSeconds: number | null): string {
  if (totalSeconds === null || totalSeconds <= 0) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatAvgMoveTime(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatMediumDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  const monthIndex = Number(m) - 1;
  const date = new Date(Number(year), monthIndex, 1);
  return date.toLocaleDateString(undefined, { month: 'short' });
}

export function outcomeColor(outcome: MatchOutcome): string {
  if (outcome === 'win') return 'var(--gain)';
  if (outcome === 'loss') return 'var(--loss)';
  return 'var(--gold)';
}

export function outcomeLabel(outcome: MatchOutcome): string {
  return outcome === 'win' ? 'Win' : outcome === 'loss' ? 'Loss' : 'Draw';
}

export function flagEmoji(code: string): string {
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export function displayName(fullName: string | null, email: string): string {
  return fullName || email.split('@')[0] || 'Player';
}
