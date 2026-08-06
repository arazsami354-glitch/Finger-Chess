/**
 * Tournament bracket engine — pure, side-effect-free algorithms for the three
 * supported formats. No NestJS/Prisma imports: every function operates on plain
 * data so the whole module is unit-testable in isolation.
 *
 * Elimination plans are built bottom-up. Matches carry a stable id
 * (`main-r1-s2`, `losers-r3-s1`, `gf-r1-s1`) and an AdvancementEdge tells the
 * caller where each match's winner/loser flows next, so participants of later
 * rounds (which are result-dependent) are wired statically via edges instead of
 * concrete user ids. Byes are represented as single-participant matches marked
 * `bye: true` rather than omitted rows, keeping round counts consistent with a
 * full power-of-two bracket.
 *
 * Seeding follows the standard chess-server permutation; with fewer players
 * than the bracket size, the TOP seeds receive the byes (bottom seeds occupy
 * the "dummy" slots, which by construction only ever face real players).
 */
export type TournamentFormat = 'single_elimination' | 'double_elimination' | 'swiss';
export type BracketKind = 'main' | 'losers' | 'grand_final' | 'swiss';
export type SeedingMode = 'none' | 'rating' | 'random';

export interface BracketPlayer {
  id: string;
  rating?: number | null;
}

export interface PlannedMatch {
  id: string;
  round: number;
  bracket: BracketKind;
  slot: number;
  /** Known at plan time for seeded/bye matches; null when only reachable via an edge. */
  whiteUserId: string | null;
  blackUserId: string | null;
  bye: boolean;
}

export interface AdvancementEdge {
  fromMatchId: string;
  fromSide: 'winner' | 'loser';
  toMatchId: string;
  toSide: 'white' | 'black';
}

export interface BracketPlan {
  matches: PlannedMatch[];
  edges: AdvancementEdge[];
  /** Scheduling groups in dependency order — every match in a stage may run before the next stage. */
  stages: PlannedMatch[][];
}

export interface SeedingOptions {
  mode?: SeedingMode;
  /** Deterministic shuffle seed when mode === 'random' (stable tests). */
  randomSeed?: number;
  /**
   * Stable id prefix so match ids (`main-r1-s2`, …) are unique per tournament —
   * ids are primary keys, so two tournaments must not reuse the same strings.
   */
  prefix?: string;
}

export const SWISS_WIN = 1;
export const SWISS_DRAW = 0.5;
export const SWISS_LOSS = 0;

// ==========================================================================
// PRIMITIVES
// ==========================================================================

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return size;
}

/**
 * Standard seeding permutation for a power-of-two bracket: recursive
 * construction pairs the top seed with the bottom, then the next two from the
 * ends inward, so the strongest players cannot meet until the latest possible
 * round. For size 16 this yields 1,16,8,9,4,13,5,12,2,15,7,10,3,14,6,11.
 */
export function seedOrder(size: number): number[] {
  if (size <= 1) return [1];
  const half = size / 2;
  const inner = seedOrder(half);
  const order: number[] = [];
  for (const seed of inner) order.push(seed, size + 1 - seed);
  return order;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: T[], seed: number): T[] {
  const arr = items.slice();
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function orderPlayers(players: BracketPlayer[], opts: SeedingOptions): BracketPlayer[] {
  const copy = players.slice();
  switch (opts.mode ?? 'none') {
    case 'rating':
      return copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.id.localeCompare(b.id));
    case 'random':
      return seededShuffle(copy, opts.randomSeed ?? 42);
    case 'none':
    default:
      return copy;
  }
}

/**
 * Places players into a size-length slot array (1-based bracket positions)
 * using the standard seed order. Positions whose seed exceeds the player count
 * become null "dummies" — by construction those slots are the bottom seeds'
 * positions, so seeds 1..byes all draw a first-round bye.
 */
export function placePlayers(players: BracketPlayer[], size: number, opts: SeedingOptions = {}): (string | null)[] {
  const n = players.length;
  const ordered = orderPlayers(players, opts);
  const order = seedOrder(size);
  const slots: (string | null)[] = new Array(size).fill(null);
  for (let i = 0; i < size; i++) {
    const seed = order[i];
    if (seed <= n) slots[i] = ordered[seed - 1].id;
  }
  return slots;
}

// ==========================================================================
// ELIMINATION BRACKETS
// ==========================================================================

type SlotRef = { kind: 'player'; id: string | null } | { kind: 'winner' | 'loser'; matchId: string };
/** A bracket participant that is only reachable via a prior match's outcome. */
type MatchRef = { kind: 'winner' | 'loser'; matchId: string };

interface EliminationBuild {
  matches: PlannedMatch[];
  edges: AdvancementEdge[];
  roundsByRound: PlannedMatch[][];
  losersByRound: string[][];
  rounds: number;
}

function mainMatchId(round: number, slot: number): string {
  return `main-r${round}-s${slot}`;
}

/** Winners-bracket build shared by both elimination formats. */
function buildEliminationMatches(players: BracketPlayer[], opts: SeedingOptions): EliminationBuild {
  if (players.length < 1) throw new Error('A bracket requires at least one player');
  const size = nextPowerOfTwo(players.length);
  const rounds = Math.log2(size);
  const matches: PlannedMatch[] = [];
  const edges: AdvancementEdge[] = [];
  const roundsByRound: PlannedMatch[][] = [];
  const losersByRound: string[][] = [];
  const pid = (id: string) => (opts.prefix ? `${opts.prefix}-${id}` : id);

  let current: SlotRef[] = placePlayers(players, size, opts).map((id) => ({ kind: 'player', id }));

  for (let round = 1; round <= rounds; round++) {
    const roundMatches: PlannedMatch[] = [];
    const count = current.length / 2;
    for (let i = 0; i < count; i++) {
      const a = current[i * 2];
      const b = current[i * 2 + 1];
      const aId = a.kind === 'player' ? a.id : null;
      const bId = b.kind === 'player' ? b.id : null;
      const bye = aId === null !== (bId === null);
      let white = aId;
      let black = bId;
      if (bye && aId === null) {
        white = bId;
        black = aId;
      }
      const id = pid(mainMatchId(round, i + 1));
      roundMatches.push({ id, round, bracket: 'main', slot: i + 1, whiteUserId: white, blackUserId: black, bye });

      if (round < rounds) {
        const nextId = pid(mainMatchId(round + 1, Math.floor(i / 2) + 1));
        const toSide = i % 2 === 0 ? 'white' : 'black';
        edges.push({ fromMatchId: id, fromSide: 'winner', toMatchId: nextId, toSide });
      }
    }
    matches.push(...roundMatches);
    roundsByRound.push(roundMatches);
    losersByRound.push(roundMatches.filter((m) => !m.bye).map((m) => m.id));
    current = roundMatches.map((m) => ({ kind: 'winner', matchId: m.id }));
  }

  return { matches, edges, roundsByRound, losersByRound, rounds };
}

export function buildSingleEliminationPlan(players: BracketPlayer[], opts: SeedingOptions = {}): BracketPlan {
  const build = buildEliminationMatches(players, opts);
  return { matches: build.matches, edges: build.edges, stages: build.roundsByRound };
}

/**
 * Double elimination: a full winners bracket plus a losers bracket fed by the
 * losers of each winners round. Losers-bracket matches are wired via edges
 * (both participants are result-dependent). The losers bracket consolidates to
 * a single survivor (losers champion), who faces the winners champion in the
 * grand final. A grand-final loss for the winners champion does NOT trigger a
 * bracket reset — the single grand final decides the tournament.
 */
export function buildDoubleEliminationPlan(players: BracketPlayer[], opts: SeedingOptions = {}): BracketPlan {
  if (players.length < 1) throw new Error('A bracket requires at least one player');
  const build = buildEliminationMatches(players, opts);
  const matches = [...build.matches];
  const edges = [...build.edges];
  const pid = (id: string) => (opts.prefix ? `${opts.prefix}-${id}` : id);

  let lbCurrent: MatchRef[] = [];
  let lbRound = 0;
  const lbStages: PlannedMatch[][] = [];

  const consumePool = (pool: MatchRef[]): PlannedMatch[] => {
    const count = Math.ceil(pool.length / 2);
    const roundMatches: PlannedMatch[] = [];
    for (let i = 0; i < count; i++) {
      const a = pool[i * 2];
      const b = pool[i * 2 + 1];
      const bye = !b;
      const id = pid(`losers-r${lbRound}-s${i + 1}`);
      roundMatches.push({
        id,
        round: lbRound,
        bracket: 'losers',
        slot: i + 1,
        whiteUserId: null,
        blackUserId: null,
        bye,
      });
      edges.push({ fromMatchId: a.matchId, fromSide: a.kind, toMatchId: id, toSide: 'white' });
      if (b) edges.push({ fromMatchId: b.matchId, fromSide: b.kind, toMatchId: id, toSide: 'black' });
    }
    matches.push(...roundMatches);
    return roundMatches;
  };

  for (let r = 1; r <= build.rounds; r++) {
    const incoming: MatchRef[] = build.losersByRound[r - 1].map((matchId) => ({ kind: 'loser', matchId }));
    const pool = [...lbCurrent, ...incoming];
    if (pool.length > 1) {
      lbRound += 1;
      const roundMatches = consumePool(pool);
      lbStages.push(roundMatches);
      lbCurrent = roundMatches.map((m) => ({ kind: 'winner', matchId: m.id }));
    } else {
      lbCurrent = pool;
    }
  }

  while (lbCurrent.length > 1) {
    lbRound += 1;
    const roundMatches = consumePool(lbCurrent);
    lbStages.push(roundMatches);
    lbCurrent = roundMatches.map((m) => ({ kind: 'winner', matchId: m.id }));
  }

  const grandFinalId = pid('gf-r1-s1');
  matches.push({
    id: grandFinalId,
    round: 1,
    bracket: 'grand_final',
    slot: 1,
    whiteUserId: null,
    blackUserId: null,
    bye: false,
  });
  edges.push({ fromMatchId: pid(mainMatchId(build.rounds, 1)), fromSide: 'winner', toMatchId: grandFinalId, toSide: 'white' });
  const lbChamp = lbCurrent[0];
  if (lbChamp) edges.push({ fromMatchId: lbChamp.matchId, fromSide: lbChamp.kind, toMatchId: grandFinalId, toSide: 'black' });

  const stages: PlannedMatch[][] = [];
  for (let r = 0; r < build.rounds; r++) {
    stages.push(build.roundsByRound[r]);
    if (lbStages[r]) stages.push(lbStages[r]);
  }
  stages.push([matches[matches.length - 1]]);

  return { matches, edges, stages };
}

// ==========================================================================
// SWISS
// ==========================================================================

export interface SwissStanding {
  id: string;
  rating: number | null;
  score: number;
  buchholz: number;
  opponents: string[];
  /** +1 per white, -1 per black. Higher means the player has had more whites. */
  colorBalance: number;
  lastColor: 'w' | 'b' | null;
  byesTaken: number;
}

export interface SwissPairing {
  round: number;
  whiteUserId: string;
  blackUserId: string;
  bye: boolean;
  byeUserId?: string;
}

export interface SwissMatchResult {
  whiteUserId: string;
  blackUserId: string;
  /** null = draw. */
  winnerUserId: string | null;
}

/**
 * Recomputes Swiss standings from a season of completed round results:
 * score (win=1, draw=0.5), opponents faced, and Buchholz (sum of opponents'
 * scores). Buchholz is a second-pass property so it is computed after all
 * scores are known. Returns players sorted by score, then Buchholz, then
 * rating, then id for a deterministic order.
 */
export function computeStandings(
  players: BracketPlayer[],
  results: SwissMatchResult[],
): SwissStanding[] {
  const standings = new Map<string, SwissStanding>();
  for (const player of players) {
    standings.set(player.id, {
      id: player.id,
      rating: player.rating ?? null,
      score: 0,
      buchholz: 0,
      opponents: [],
      colorBalance: 0,
      lastColor: null,
      byesTaken: 0,
    });
  }

  for (const result of results) {
    const white = standings.get(result.whiteUserId);
    const black = standings.get(result.blackUserId);
    if (!white || !black) continue;
    if (result.winnerUserId === null) {
      white.score += SWISS_DRAW;
      black.score += SWISS_DRAW;
    } else if (result.winnerUserId === white.id) {
      white.score += SWISS_WIN;
    } else if (result.winnerUserId === black.id) {
      black.score += SWISS_WIN;
    }
    white.opponents.push(black.id);
    black.opponents.push(white.id);
    white.lastColor = 'w';
    black.lastColor = 'b';
    white.colorBalance += 1;
    black.colorBalance -= 1;
  }

  for (const s of standings.values()) {
    s.buchholz = s.opponents.reduce((sum, oppId) => sum + (standings.get(oppId)?.score ?? 0), 0);
  }

  return [...standings.values()].sort(compareStandings);
}

export function suggestSwissRounds(playerCount: number, maxRounds = 9): number {
  if (playerCount < 2) return 0;
  return Math.max(1, Math.min(maxRounds, Math.ceil(Math.log2(playerCount))));
}

function compareStandings(a: SwissStanding, b: SwissStanding): number {
  return (
    b.score - a.score ||
    b.buchholz - a.buchholz ||
    (b.rating ?? 0) - (a.rating ?? 0) ||
    a.id.localeCompare(b.id)
  );
}

function foldGroup(members: SwissStanding[]): [SwissStanding, SwissStanding][] {
  const pairs: [SwissStanding, SwissStanding][] = [];
  for (let i = 0; i < members.length / 2; i++) {
    pairs.push([members[i], members[members.length - 1 - i]]);
  }
  return pairs;
}

/**
 * Bounded rematch repair: walks the paired list and, when two players have
 * already met, tries to swap partners inside the same score group. Gives up
 * quietly after a few passes rather than degrading pairing quality further —
 * an unavoidable rematch is preferable to a wildly unbalanced pair.
 */
function resolveRematches(pairs: [SwissStanding, SwissStanding][], used: Set<string>): [SwissStanding, SwissStanding][] {
  const key = (a: SwissStanding, b: SwissStanding) => [a.id, b.id].sort().join(':');
  const working = pairs.slice();
  for (let pass = 0; pass < 4; pass++) {
    let fixed = false;
    for (let i = 0; i < working.length; i++) {
      const [a, b] = working[i];
      if (!used.has(key(a, b))) continue;
      for (let j = i + 1; j < working.length; j++) {
        const [c, d] = working[j];
        const candidates: [SwissStanding, SwissStanding][] = [
          [a, c],
          [a, d],
        ];
        for (const [x, y] of candidates) {
          const partnerX = y === c ? d : c;
          const partnerY = y === c ? b : d;
          if (!used.has(key(x, partnerX)) && !used.has(key(y, partnerY))) {
            working[i] = [x, partnerX];
            working[j] = [y, partnerY];
            fixed = true;
            break;
          }
        }
        if (fixed) break;
      }
      if (fixed) break;
    }
    if (!fixed) break;
  }
  return working;
}

function assignColors(pairs: [SwissStanding, SwissStanding][], round: number): SwissPairing[] {
  return pairs.map(([a, b]) => {
    let white = a;
    let black = b;
    const aWasBlackLast = a.lastColor === 'b';
    const bWasBlackLast = b.lastColor === 'b';
    if (aWasBlackLast !== bWasBlackLast) {
      white = aWasBlackLast ? a : b;
      black = white === a ? b : a;
    } else if (a.colorBalance <= b.colorBalance) {
      white = a;
      black = b;
    } else {
      white = b;
      black = a;
    }
    return { round, whiteUserId: white.id, blackUserId: black.id, bye: false };
  });
}

/**
 * Pairs one Swiss round from the current standings. Deterministic given the
 * input: players are grouped by score (descending), folded highest-vs-lowest
 * inside each group with odd members floated down, rematches repaired where
 * possible, then colors assigned to balance color counts and alternate from the
 * previous round. With an odd field the lowest-ranked player who has not yet
 * received a bye sits out.
 */
export function pairSwissRound(standings: SwissStanding[], round: number): SwissPairing[] {
  if (standings.length < 2) return [];
  const sorted = standings.slice().sort(compareStandings);
  let pool = sorted;

  const byeIndex = pool.length % 2 === 1 ? pool.length - 1 : -1;
  let byeUserId: string | undefined;
  if (byeIndex >= 0) {
    const candidate = pool[byeIndex];
    byeUserId = candidate.id;
    pool = pool.filter((p) => p.id !== candidate.id);
  }

  const groups: SwissStanding[][] = [];
  for (const player of pool) {
    const last = groups[groups.length - 1];
    if (last && last[0].score === player.score) last.push(player);
    else groups.push([player]);
  }

  const used = new Set<string>();
  for (const s of pool) for (const opp of s.opponents) if (pool.some((p) => p.id === opp)) used.add([s.id, opp].sort().join(':'));

  const pairs: [SwissStanding, SwissStanding][] = [];
  let floated: SwissStanding | null = null;
  for (const group of groups) {
    const members: SwissStanding[] = floated ? [floated, ...group] : [...group];
    floated = null;
    if (members.length % 2 === 1) floated = members.pop()!;
    pairs.push(...foldGroup(members));
  }

  const fixed = resolveRematches(pairs, used);
  const pairings = assignColors(fixed, round);
  if (byeUserId) {
    pairings.push({ round, whiteUserId: byeUserId, blackUserId: byeUserId, bye: true, byeUserId });
  }
  return pairings;
}
