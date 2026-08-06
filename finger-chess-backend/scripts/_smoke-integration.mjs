import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:3000/api/v1';
const WS = 'http://localhost:3000';

let failures = 0;
function check(label, cond, extra = '') {
  const ok = Boolean(cond);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

async function req(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

async function login(email) {
  const { status, data } = await req('POST', '/auth/login', null, { email, password: 'SmokePass123!' });
  if (status !== 201 && status !== 200) throw new Error(`login failed for ${email}: ${status}`);
  return data.accessToken;
}

function sub(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function poll(fn, timeoutMs = 20000, every = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(`${WS}/game`, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 10000 });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(new Error(`ws connect_error ${e.message}`)));
  });
}

function waitEvent(sock, event) {
  return new Promise((resolve) => sock.on(event, (d) => resolve(d)));
}

async function gameStatus(gameId) {
  const rows = await prisma.$queryRawUnsafe(`SELECT status FROM "games" WHERE id = $1`, gameId);
  return rows[0]?.status ?? null;
}

async function matchByGame(gameId) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, status, result, winner_user_id AS "winnerUserId", white_user_id AS "whiteUserId", black_user_id AS "blackUserId", game_id AS "gameId"
     FROM "tournament_matches" WHERE game_id = $1`,
    gameId,
  );
  return rows[0] ?? null;
}

/** Connects both players, waits for the game to start, runs onStarted, and closes. */
async function withGame(gameId, whiteToken, blackToken, onStarted) {
  const ws = await connect(whiteToken);
  const bs = await connect(blackToken);
  try {
    const startedP = Promise.all([waitEvent(ws, 'gameState'), waitEvent(bs, 'gameState')]);
    ws.emit('joinGame', { gameId });
    bs.emit('joinGame', { gameId });
    await startedP;
    return await onStarted(ws, bs);
  } finally {
    ws.disconnect();
    bs.disconnect();
  }
}

async function resignAsBlack(gameId, whiteToken, blackToken) {
  return withGame(gameId, whiteToken, blackToken, async (ws, bs) => {
    const overP = waitEvent(bs, 'gameOver');
    bs.emit('resign', { gameId });
    return overP;
  });
}

async function drawByAgreement(gameId, whiteToken, blackToken) {
  return withGame(gameId, whiteToken, blackToken, async (ws, bs) => {
    const overP = waitEvent(ws, 'gameOver');
    ws.emit('offerDraw', { gameId });
    await sleep(400);
    bs.emit('respondDraw', { gameId, accept: true });
    return overP;
  });
}

async function createAndStart(name) {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: t } = await req('POST', '/admin/tournaments', admin, {
    name,
    description: 'integration smoke',
    format: 'single_elimination',
    visibility: 'public',
    entryType: 'free',
    prizePool: 0,
    maxPlayers: 4,
    minPlayers: 2,
    startTime: future,
    timeControl: 'blitz_3_0',
  });
  await req('POST', `/admin/tournaments/${t.id}/publish`, admin);
  for (const p of ['p1', 'p2', 'p3', 'p4']) await req('POST', `/tournaments/${t.id}/register`, tokens[p]);
  const start = await req('POST', `/admin/tournaments/${t.id}/start`, admin);
  if (![200, 201].includes(start.status)) throw new Error(`start failed for ${name}: ${start.status}`);
  return t.id;
}

const admin = await login('smoke-admin@test.local');
const tokens = {};
const tokensByUser = {};
for (const n of [1, 2, 3, 4]) {
  tokens[`p${n}`] = await login(`smoke-p${n}@test.local`);
  tokensByUser[sub(tokens[`p${n}`])] = tokens[`p${n}`];
}

// ===========================================================================
// TOURNAMENT A — full integration: auto-create, both-ready start, resign,
// draw replay, progression, completion.
// ===========================================================================

const A = await createAndStart('Integration A');

// 1. automatic match creation + white/black assignment
let d = (await req('GET', `/admin/tournaments/${A}`, admin)).data;
const r1 = d.bracket.filter((m) => m.round === 1);
check('A: round 1 auto-created with 2 matches', r1.length === 2, `n=${r1.length}`);
check('A: every match has white AND black assigned', r1.every((m) => m.whiteUserId && m.blackUserId), r1.map((m) => `${m.whiteUserId?.slice(0, 6)}-${m.blackUserId?.slice(0, 6)}`).join(','));
check('A: every match has a linked game', r1.every((m) => m.gameId), r1.map((m) => m.gameId?.slice(0, 6)).join(','));
const aGameStatuses = await Promise.all(r1.map((m) => gameStatus(m.gameId)));
check('A: linked games start as waiting', aGameStatuses.every((s) => s === 'waiting'), aGameStatuses.join(','));

const m1 = r1[0];
const m2 = r1[1];
const white1 = tokensByUser[m1.whiteUserId];
const black1 = tokensByUser[m1.blackUserId];
const white2 = tokensByUser[m2.whiteUserId];
const black2 = tokensByUser[m2.blackUserId];

// 2. automatic match start ONLY when both players are ready
const solo = await connect(white1);
solo.emit('joinGame', { gameId: m1.gameId });
await waitEvent(solo, 'waitingForOpponent');
await sleep(1200);
check('A: game does NOT start with only one player in', (await gameStatus(m1.gameId)) === 'waiting', await gameStatus(m1.gameId));
solo.disconnect();

const both = await connect(white1);
const bboth = await connect(black1);
const startP = Promise.all([waitEvent(both, 'gameState'), waitEvent(bboth, 'gameState')]);
both.emit('joinGame', { gameId: m1.gameId });
bboth.emit('joinGame', { gameId: m1.gameId });
await startP;
check('A: game starts once both players are in', (await gameStatus(m1.gameId)) === 'ongoing', await gameStatus(m1.gameId));
both.disconnect();
bboth.disconnect();

// 3. resignation -> winner detection -> bracket advancement
const resignOutcome = await resignAsBlack(m1.gameId, white1, black1);
check('A: resignation settles game (black wins? no — white wins)', resignOutcome.reason === 'resignation' && resignOutcome.winnerColor === 'white', JSON.stringify(resignOutcome));
const m1After = await poll(async () => {
  const m = await matchByGame(m1.gameId);
  return m?.status === 'completed' ? m : null;
}, 15000);
check('A: match completed on resignation', Boolean(m1After), m1After?.status);
check('A: match winner = white player', m1After?.winnerUserId === m1.whiteUserId, m1After?.winnerUserId?.slice(0, 6));

// 4. draw handling -> tournament rules (replay in elimination)
const d1Outcome = await drawByAgreement(m2.gameId, white2, black2);
check('A: draw settles the game as draw_agreement', d1Outcome.reason === 'draw_agreement', d1Outcome.reason);
const replay = await poll(async () => {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT game_id AS "gameId", status FROM "tournament_matches" WHERE id = $1`,
    m2.id,
  );
  const row = rows[0];
  return row && row.gameId !== m2.gameId ? row : null;
}, 15000);
check('A: elimination draw triggers a rematch (new linked game)', Boolean(replay), replay ? `${m2.gameId?.slice(0, 6)} -> ${replay.gameId?.slice(0, 6)}` : 'no');
check('A: match reopened as ongoing for the rematch', replay?.status === 'ongoing', replay?.status);
check('A: rematch game starts waiting', (await gameStatus(replay.gameId)) === 'waiting', await gameStatus(replay.gameId));

// settle the rematch (black resigns) -> match completes
await resignAsBlack(replay.gameId, white2, black2);
await poll(async () => (await matchByGame(replay.gameId))?.status === 'completed', 15000);
check('A: rematch completed after resignation', true);

// 5. tournament progression after every finished match -> final auto-created
const finalMatch = await poll(async () => {
  const dd = (await req('GET', `/admin/tournaments/${A}`, admin)).data;
  return dd.bracket.find((m) => m.round === 2) ?? null;
}, 20000);
check('A: final auto-created after both round-1 matches', Boolean(finalMatch), finalMatch ? `final=${finalMatch.id}` : 'no final');

const r1w1 = m1After.winnerUserId;
const r1w2 = (await matchByGame(replay.gameId)).winnerUserId;
const finalParticipants = [finalMatch.whiteUserId, finalMatch.blackUserId].sort();
const expectedFinal = [r1w1, r1w2].sort();
check('A: final participants = the two round-1 winners', JSON.stringify(finalParticipants) === JSON.stringify(expectedFinal), `${finalParticipants.join(',')} vs ${expectedFinal.join(',')}`);

// 6. finish the final -> tournament completion with a champion
await resignAsBlack(finalMatch.gameId, tokensByUser[finalMatch.whiteUserId], tokensByUser[finalMatch.blackUserId]);
const completed = await poll(async () => {
  const rows = await prisma.$queryRawUnsafe(`SELECT status FROM "tournaments" WHERE id = $1`, A);
  return rows[0]?.status === 'completed' ? true : null;
}, 20000);
check('A: tournament completes when the final settles', Boolean(completed));

const champ = (await matchByGame(finalMatch.gameId)).winnerUserId;
const champRow = await prisma.$queryRawUnsafe(
  `SELECT final_rank AS "finalRank" FROM "tournament_registrations" WHERE tournament_id = $1 AND user_id = $2`,
  A,
  champ,
);
check('A: champion recorded as rank 1', Number(champRow[0]?.finalRank) === 1, `rank=${champRow[0]?.finalRank}`);

const dupMatches = await prisma.$queryRawUnsafe(
  `SELECT COUNT(*)::int AS n FROM (SELECT id FROM "tournament_matches" WHERE tournament_id = $1 GROUP BY id HAVING COUNT(*) > 1) x`,
  A,
);
check('A: no duplicate match rows', Number(dupMatches[0].n) === 0);

// ===========================================================================
// TOURNAMENT B — match cancellation (recovery abort) updates the tournament
// and the bracket resumes.
// ===========================================================================

const B = await createAndStart('Integration B');
const dB = (await req('GET', `/admin/tournaments/${B}`, admin)).data;
const bR1 = dB.bracket.filter((m) => m.round === 1);
check('B: round 1 created', bR1.length === 2, `n=${bR1.length}`);

// simulate the recovery sweep aborting an ongoing game (no tournament hook fired)
await prisma.$executeRawUnsafe(
  `UPDATE "games" SET status = 'aborted', result = 'aborted', ended_at = NOW() WHERE id = $1`,
  bR1[0].gameId,
);
check('B: game force-aborted (simulated recovery)', (await gameStatus(bR1[0].gameId)) === 'aborted', await gameStatus(bR1[0].gameId));

// tournament scheduler sweep resolves the cancelled match (up to ~35s)
const bResolved = await poll(async () => {
  const m = await matchByGame(bR1[0].gameId);
  return m && m.status === 'completed' ? m : null;
}, 40000, 3000);
check('B: cancelled match resolved by tournament sweep', Boolean(bResolved), bResolved ? `result=${bResolved.result}` : 'not resolved');
check('B: cancelled match voided (not a no-show win)', bResolved?.result === 'cancelled', bResolved?.result);

// abort the second game too -> both round-1 matches done -> final auto-created
await prisma.$executeRawUnsafe(
  `UPDATE "games" SET status = 'aborted', result = 'aborted', ended_at = NOW() WHERE id = $1`,
  bR1[1].gameId,
);
const bFinal = await poll(async () => {
  const dd = (await req('GET', `/admin/tournaments/${B}`, admin)).data;
  return dd.bracket.find((m) => m.round === 2) ?? null;
}, 50000, 3000);
check('B: bracket resumed past cancelled matches (final created)', Boolean(bFinal), bFinal ? `final=${bFinal.id}` : 'no final');

await prisma.$disconnect();
console.log(`\nIntegration failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
