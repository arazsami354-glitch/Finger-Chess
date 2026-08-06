import {
  buildDoubleEliminationPlan,
  buildSingleEliminationPlan,
  computeStandings,
  nextPowerOfTwo,
  pairSwissRound,
  placePlayers,
  seedOrder,
  suggestSwissRounds,
  SWISS_DRAW,
  SWISS_WIN,
  SwissStanding,
} from './bracket-engine';

const p = (id: string, rating?: number) => ({ id, rating });

function freshStanding(id: string, rating: number, score = 0, opponents: string[] = []): SwissStanding {
  return { id, rating, score, buchholz: 0, opponents, colorBalance: 0, lastColor: null, byesTaken: 0 };
}

describe('nextPowerOfTwo', () => {
  it('rounds up to the next power of two', () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(12)).toBe(16);
    expect(nextPowerOfTwo(16)).toBe(16);
    expect(nextPowerOfTwo(17)).toBe(32);
  });
});

describe('seedOrder', () => {
  it('produces the standard seeding permutation', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
  });

  it('never pairs two top-half seeds in the first round', () => {
    const order = seedOrder(16);
    const half = 8;
    for (let i = 0; i < order.length; i += 2) {
      const low = Math.min(order[i], order[i + 1]);
      const high = Math.max(order[i], order[i + 1]);
      expect(low).toBeLessThanOrEqual(half);
      expect(high).toBeGreaterThan(half);
    }
  });
});

describe('placePlayers', () => {
  it('places every player with no byes on a full bracket', () => {
    const players = ['a', 'b', 'c', 'd'].map((id) => p(id));
    const slots = placePlayers(players, 4);
    expect(slots).toEqual(['a', 'd', 'b', 'c']);
  });

  it('assigns byes to the top seeds', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((id) => p(id));
    const slots = placePlayers(players, 16);
    expect(slots).toHaveLength(16);
    const nonNull = slots.filter((s) => s !== null);
    expect(nonNull).toHaveLength(12);
    expect(slots[0]).toBe('a');
    expect(slots[8]).toBe('b'); // seed 2 sits at index 8
    expect(slots.filter((s) => s === null)).toHaveLength(4);
    // top four seeds each draw a first-round bye (partner slot is a dummy)
    const seedPos = [0, 8, 12, 4];
    for (const pos of seedPos) {
      const partner = pos % 2 === 0 ? pos + 1 : pos - 1;
      expect(slots[partner]).toBeNull();
    }
  });

  it('sorts by rating when mode is rating', () => {
    const players = [p('low', 1200), p('high', 2100), p('mid', 1500)];
    const slots = placePlayers(players, 4, { mode: 'rating' });
    expect(slots[0]).toBe('high');
    expect(slots[2]).toBe('mid');
    expect(slots[3]).toBe('low');
  });
});

describe('randomized seeding', () => {
  it('is reproducible for a given seed', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => p(id));
    const a = buildSingleEliminationPlan(players, { mode: 'random', randomSeed: 12345 });
    const b = buildSingleEliminationPlan(players, { mode: 'random', randomSeed: 12345 });
    const firstRound = (plan: typeof a) => plan.matches.filter((m) => m.round === 1).map((m) => [m.whiteUserId, m.blackUserId]);
    expect(firstRound(a)).toEqual(firstRound(b));
  });

  it('produces different pairings across different seeds', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => p(id));
    const seeds = Array.from({ length: 40 }, (_, i) => i * 97 + 13);
    const firstRounds = new Set(
      seeds.map((seed) =>
        JSON.stringify(buildSingleEliminationPlan(players, { mode: 'random', randomSeed: seed }).matches.filter((m) => m.round === 1).map((m) => [m.whiteUserId, m.blackUserId])),
      ),
    );
    expect(firstRounds.size).toBeGreaterThan(1);
  });

  it('still places every player exactly once', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => p(id));
    const plan = buildSingleEliminationPlan(players, { mode: 'random', randomSeed: 7 });
    const firstRound = plan.matches.filter((m) => m.round === 1);
    const appearances = firstRound.flatMap((m) => [m.whiteUserId, m.blackUserId]).filter(Boolean);
    expect(appearances).toHaveLength(players.length);
    expect(new Set(appearances).size).toBe(players.length);
    // non-power-of-two field: size - n first-round byes, each carrying a real player
    expect(firstRound.filter((m) => m.bye)).toHaveLength(nextPowerOfTwo(players.length) - players.length);
  });
});

describe('buildSingleEliminationPlan', () => {
  it('builds a full 8-player bracket', () => {
    const plan = buildSingleEliminationPlan(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => p(id)));
    expect(plan.matches).toHaveLength(7);
    expect(plan.stages).toHaveLength(3);
    expect(plan.stages.map((s) => s.length)).toEqual([4, 2, 1]);
    expect(plan.matches.filter((m) => m.bye)).toHaveLength(0);
    // first round pairs top seed vs bottom
    expect(plan.matches[0]).toMatchObject({ whiteUserId: 'a', blackUserId: 'h', bracket: 'main', round: 1 });
  });

  it('gives byes in the first round for an odd-sized field', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].map((id) => p(id));
    const plan = buildSingleEliminationPlan(players);
    expect(plan.stages[0].length).toBe(8);
    const byes = plan.matches.filter((m) => m.round === 1 && m.bye);
    expect(byes).toHaveLength(6);
    expect(plan.matches.filter((m) => m.bye)).toHaveLength(6);
  });

  it('wires every winner to exactly one downstream slot', () => {
    const plan = buildSingleEliminationPlan(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((id) => p(id)));
    const winnerEdges = plan.edges.filter((e) => e.fromSide === 'winner');
    expect(winnerEdges).toHaveLength(plan.matches.length - 1);
    const targets = new Set(winnerEdges.map((e) => `${e.toMatchId}:${e.toSide}`));
    expect(targets.size).toBe(plan.matches.length - 1);
    for (const e of winnerEdges) {
      const target = plan.matches.find((m) => m.id === e.toMatchId);
      expect(target).toBeDefined();
      expect(target!.round).toBe(Number(e.fromMatchId.split('-')[1].replace('r', '')) + 1);
    }
  });
});

describe('buildDoubleEliminationPlan', () => {
  it('produces 2N-2 playable matches for a full 8-player field', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => p(id));
    const plan = buildDoubleEliminationPlan(players);
    const real = plan.matches.filter((m) => !m.bye);
    expect(real).toHaveLength(2 * 8 - 2);
    expect(plan.matches).toHaveLength(2 * 8 - 1); // one losers-bracket bye row auto-advances
    const kinds = plan.matches.reduce<Record<string, number>>((acc, m) => {
      acc[m.bracket] = (acc[m.bracket] ?? 0) + 1;
      return acc;
    }, {});
    expect(kinds.main).toBe(7);
    expect(kinds.losers).toBe(7);
    expect(kinds.grand_final).toBe(1);
  });

  it('flows every winners loser into the losers bracket', () => {
    const players = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => p(id));
    const plan = buildDoubleEliminationPlan(players);
    const wbMatches = plan.matches.filter((m) => m.bracket === 'main' && !m.bye);
    const loserEdges = plan.edges.filter((e) => e.fromSide === 'loser');
    expect(loserEdges).toHaveLength(wbMatches.length);
    const losersMatches = plan.matches.filter((m) => m.bracket === 'losers');
    expect(loserEdges.length).toBeGreaterThan(0);
    for (const e of loserEdges) {
      expect(losersMatches.some((m) => m.id === e.toMatchId)).toBe(true);
    }
    // every losers match is fed by an edge; exactly one (the bye row) is fed by a single edge
    const incomingCounts = new Map<string, number>();
    for (const e of plan.edges.filter((e) => losersMatches.some((m) => m.id === e.toMatchId))) {
      incomingCounts.set(e.toMatchId, (incomingCounts.get(e.toMatchId) ?? 0) + 1);
    }
    expect(incomingCounts.size).toBe(losersMatches.length);
    expect([...incomingCounts.values()].filter((n) => n === 1)).toHaveLength(1);
    const gf = plan.matches.find((m) => m.bracket === 'grand_final')!;
    const gfEdges = plan.edges.filter((e) => e.toMatchId === gf.id);
    expect(gfEdges).toHaveLength(2);
    expect(gfEdges.map((e) => e.toSide).sort()).toEqual(['black', 'white']);
  });

  it('runs the losers bracket to a single grand final for a 4-player field', () => {
    const players = ['a', 'b', 'c', 'd'].map((id) => p(id));
    const plan = buildDoubleEliminationPlan(players);
    expect(plan.matches).toHaveLength(2 * 4 - 2);
    expect(plan.matches.filter((m) => m.bracket === 'losers')).toHaveLength(2);
    expect(plan.matches.filter((m) => m.bracket === 'grand_final')).toHaveLength(1);
  });
});

describe('suggestSwissRounds', () => {
  it('suggests log2-based round counts capped at the maximum', () => {
    expect(suggestSwissRounds(2)).toBe(1);
    expect(suggestSwissRounds(8)).toBe(3);
    expect(suggestSwissRounds(100)).toBe(7);
    expect(suggestSwissRounds(100, 5)).toBe(5);
  });
});

describe('pairSwissRound', () => {
  it('pairs an even field with no rematches and balanced colors', () => {
    const standings = [
      freshStanding('a', 2000, 2),
      freshStanding('b', 1900, 2),
      freshStanding('c', 1800, 1),
      freshStanding('d', 1700, 1),
      freshStanding('e', 1600, 0),
      freshStanding('f', 1500, 0),
    ];
    const pairings = pairSwissRound(standings, 1);
    expect(pairings).toHaveLength(3);
    const all = pairings.flatMap((x) => [x.whiteUserId, x.blackUserId]);
    expect(new Set(all).size).toBe(6);
    const rematch = pairings.filter((x) => x.bye);
    expect(rematch).toHaveLength(0);
    for (const pair of pairings) {
      expect(pair.whiteUserId).not.toBe(pair.blackUserId);
    }
  });

  it('gives the lowest-ranked un-byed player a bye on an odd field', () => {
    const standings = [
      freshStanding('p1', 1500, 2),
      freshStanding('p2', 1400, 2),
      freshStanding('p3', 1300, 1),
      freshStanding('p4', 1200, 1),
      freshStanding('p5', 1100, 0),
    ];
    const pairings = pairSwissRound(standings, 2);
    const bye = pairings.find((x) => x.bye);
    expect(bye).toBeDefined();
    expect(bye!.byeUserId).toBe('p5'); // lowest score, no bye yet
    expect(pairings.filter((x) => !x.bye)).toHaveLength(2);
  });

  it('avoids rematches when possible', () => {
    const standings = [
      freshStanding('a', 2000, 1, ['c']),
      freshStanding('b', 1900, 1, ['d']),
      freshStanding('c', 1800, 1, ['a']),
      freshStanding('d', 1700, 1, ['b']),
      freshStanding('e', 1600, 1, ['f']),
      freshStanding('f', 1500, 1, ['e']),
    ];
    const pairings = pairSwissRound(standings, 2);
    for (const x of pairings) {
      const pairKey = [x.whiteUserId, x.blackUserId].sort().join(':');
      expect(pairKey).not.toBe('a:c');
      expect(pairKey).not.toBe('b:d');
    }
  });
});

describe('computeStandings', () => {
  it('computes scores and Buchholz from results', () => {
    const players = ['a', 'b', 'c', 'd'].map((id) => p(id, 1500));
    const standings = computeStandings(players, [
      { whiteUserId: 'a', blackUserId: 'b', winnerUserId: 'a' },
      { whiteUserId: 'c', blackUserId: 'd', winnerUserId: null },
    ]);
    expect(standings.find((s) => s.id === 'a')!.score).toBe(SWISS_WIN);
    expect(standings.find((s) => s.id === 'b')!.score).toBe(0);
    expect(standings.find((s) => s.id === 'c')!.score).toBe(SWISS_DRAW);
    expect(standings.find((s) => s.id === 'd')!.score).toBe(SWISS_DRAW);
    // Buchholz = sum of opponents' scores
    expect(standings.find((s) => s.id === 'a')!.buchholz).toBe(0);
    expect(standings.find((s) => s.id === 'c')!.buchholz).toBe(SWISS_DRAW);
  });

  it('sorts by score then Buchholz', () => {
    const players = ['a', 'b', 'c'].map((id) => p(id, 1500));
    const standings = computeStandings(players, [
      { whiteUserId: 'a', blackUserId: 'b', winnerUserId: 'a' },
    ]);
    expect(standings[0].id).toBe('a');
  });
});
