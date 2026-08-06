export const TOURNAMENT_FORMATS = ['single_elimination', 'double_elimination', 'swiss'] as const;
export type TournamentFormat = (typeof TOURNAMENT_FORMATS)[number];

export const TOURNAMENT_VISIBILITIES = ['public', 'private'] as const;
export type TournamentVisibility = (typeof TOURNAMENT_VISIBILITIES)[number];

export const TOURNAMENT_ENTRY_TYPES = ['free', 'paid'] as const;
export type TournamentEntryType = (typeof TOURNAMENT_ENTRY_TYPES)[number];

export const TOURNAMENT_SEEDING_MODES = ['none', 'rating', 'random'] as const;
export type TournamentSeedingMode = (typeof TOURNAMENT_SEEDING_MODES)[number];

export const TOURNAMENT_MATCH_STATUSES = ['scheduled', 'ongoing', 'completed', 'bye', 'cancelled'] as const;
export type TournamentMatchStatus = (typeof TOURNAMENT_MATCH_STATUSES)[number];

/** Default prize split (winner-takes-all) when a tournament has no explicit distribution. */
export const DEFAULT_PRIZE_DISTRIBUTION = [100];

/** Cap on the number of paid prize spots a distribution can define. */
export const MAX_PRIZE_SPOTS = 32;

/** Entry fee and prize money are capped to the same ceiling the wallet uses elsewhere. */
export const MAX_ENTRY_FEE = 10_000;

/** How long a tournament match's game may sit waiting for both players before no-show rules apply. */
export const MATCH_START_GRACE_MS = 5 * 60 * 1000;
