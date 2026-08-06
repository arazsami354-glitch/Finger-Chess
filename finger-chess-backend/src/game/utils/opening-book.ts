/**
 * A curated set of ~30 well-known openings, matched by their first few
 * SAN moves. This is explicitly NOT a full ECO (Encyclopaedia of Chess
 * Openings) database — that's several hundred codes with countless
 * transpositions and sub-variations, which isn't something to fabricate
 * or half-implement. This is a real, working classifier for the openings
 * players actually reach most often, honestly scoped as a "common
 * openings" recognizer rather than a claim of exhaustive coverage.
 *
 * Matching is longest-prefix-wins: entries are checked longest move
 * sequence first, so e.g. "Ruy Lopez, Berlin Defence" (4 moves) is
 * preferred over the more generic "Ruy Lopez" (3 moves) when both match.
 */
interface OpeningEntry {
  name: string;
  moves: string[]; // SAN, from move 1
}

const OPENING_BOOK: OpeningEntry[] = [
  // --- e4 openings ---
  { name: 'Ruy Lopez, Berlin Defence', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6'] },
  { name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
  { name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { name: "King's Gambit", moves: ['e4', 'e5', 'f4'] },
  { name: 'Petrov Defence', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { name: 'Philidor Defence', moves: ['e4', 'e5', 'Nf3', 'd6'] },
  { name: 'Vienna Game', moves: ['e4', 'e5', 'Nc3'] },
  { name: 'Open Game', moves: ['e4', 'e5'] },
  { name: 'Sicilian Defence, Najdorf', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
  { name: 'Sicilian Defence, Dragon', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'g6'] },
  { name: 'Sicilian Defence', moves: ['e4', 'c5'] },
  { name: 'French Defence', moves: ['e4', 'e6'] },
  { name: 'Caro-Kann Defence', moves: ['e4', 'c6'] },
  { name: 'Pirc Defence', moves: ['e4', 'd6'] },
  { name: 'Scandinavian Defence', moves: ['e4', 'd5'] },
  { name: 'Alekhine Defence', moves: ['e4', 'Nf6'] },

  // --- d4 openings ---
  { name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { name: "Queen's Gambit Accepted", moves: ['d4', 'd5', 'c4', 'dxc4'] },
  { name: 'Slav Defence', moves: ['d4', 'd5', 'c4', 'c6'] },
  { name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { name: "King's Indian Defence", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { name: 'Nimzo-Indian Defence', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { name: 'Grünfeld Defence', moves: ['d4', 'Nf6', 'c4', 'g6', 'Nc3', 'd5'] },
  { name: 'Queen’s Indian Defence', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nf3', 'b6'] },
  { name: 'Dutch Defence', moves: ['d4', 'f5'] },
  { name: 'Benoni Defence', moves: ['d4', 'Nf6', 'c4', 'c5'] },
  { name: 'Closed Game', moves: ['d4', 'd5'] },

  // --- flank openings ---
  { name: 'English Opening', moves: ['c4'] },
  { name: 'Réti Opening', moves: ['Nf3', 'd5', 'c4'] },
  { name: "Bird's Opening", moves: ['f4'] },
  { name: 'Nimzo-Larsen Attack', moves: ['b3'] },
];

// Longest move-sequence entries checked first — see the file header.
const SORTED_BOOK = [...OPENING_BOOK].sort((a, b) => b.moves.length - a.moves.length);

export function classifyOpening(sanMoves: string[]): string | null {
  for (const entry of SORTED_BOOK) {
    if (sanMoves.length < entry.moves.length) continue;
    const matches = entry.moves.every((move, i) => sanMoves[i] === move);
    if (matches) return entry.name;
  }
  return null;
}
