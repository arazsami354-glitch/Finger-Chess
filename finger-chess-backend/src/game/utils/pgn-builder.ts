import { GameResult } from '@prisma/client';

export interface PgnGameInfo {
  whiteName: string;
  blackName: string;
  result: GameResult | null;
  timeControlLabel: string;
  startedAt: Date | null;
  gameId: string;
  /** Rated games are tagged [Event "Rated ..."], casual games [Event "Casual ..."]. */
  rated?: boolean;
}

export interface PgnMove {
  moveNumber: number;
  color: 'white' | 'black';
  san: string;
}

const RESULT_TAG: Record<string, string> = {
  white_win: '1-0',
  black_win: '0-1',
  draw: '1/2-1/2',
  aborted: '*',
};

export function buildPgn(info: PgnGameInfo, moves: PgnMove[]): string {
  const date = info.startedAt ? formatPgnDate(info.startedAt) : '????.??.??';
  const resultTag = info.result ? (RESULT_TAG[info.result] ?? '*') : '*';

  const headers = [
    `[Event "${info.rated === false ? 'Casual' : 'Rated'} ${info.timeControlLabel} Match"]`,
    `[Site "Finger Chess Online"]`,
    `[Date "${date}"]`,
    `[Round "-"]`,
    `[White "${escapeTag(info.whiteName)}"]`,
    `[Black "${escapeTag(info.blackName)}"]`,
    `[Result "${resultTag}"]`,
    `[TimeControl "${toPgnTimeControl(info.timeControlLabel)}"]`,
    `[GameId "${info.gameId}"]`,
  ].join('\n');

  const movetext = buildMovetext(moves) + ` ${resultTag}`;

  return `${headers}\n\n${movetext}\n`;
}

function buildMovetext(moves: PgnMove[]): string {
  const parts: string[] = [];

  for (const move of moves) {
    // `moveNumber` is a PLY (server convention: 1, 2, 3, ...). PGN movetext
    // numbers are FULLMOVES (1., 2., ...) with white and black paired.
    const fullMove = Math.ceil(move.moveNumber / 2);
    if (move.color === 'white') {
      parts.push(`${fullMove}.`, move.san);
    } else {
      // Handles the case where black's move is the first entry replayed
      // (e.g. starting a PGN mid-game) by inserting the "..." black-to-move marker.
      if (parts.length === 0) {
        parts.push(`${fullMove}...`);
      }
      parts.push(move.san);
    }
  }

  return parts.join(' ');
}

function formatPgnDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/**
 * The PGN spec's TimeControl tag wants seconds (e.g. "600+0"), but the
 * app's labels are the chess-server shorthand ("10+0"). Convert; fall back
 * to the raw label if it isn't in the expected "base+increment" form.
 */
function toPgnTimeControl(label: string): string {
  const match = /^(\d+)\s*\+\s*(\d+)$/.exec(label.trim());
  if (!match) return label;
  return `${Number(match[1]) * 60}+${match[2]}`;
}

function escapeTag(value: string): string {
  return value.replace(/"/g, "'");
}
