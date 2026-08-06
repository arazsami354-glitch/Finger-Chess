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

function settleGame(gameId, whiteToken, blackToken) {
  return new Promise((resolve, reject) => {
    const sockets = [];
    const started = { white: false, black: false };
    let resigned = false;
    const timer = setTimeout(() => { close(); reject(new Error(`settle timeout for ${gameId}`)); }, 35000);
    function close() { for (const s of sockets) s.disconnect(); }
    function checkStart() {
      if (started.white && started.black && !resigned) {
        resigned = true;
        sockets[1].emit('resign', { gameId });
      }
    }
    const mk = (token, color) => {
      const s = io(`${WS}/game`, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 10000 });
      sockets.push(s);
      s.on('connect', () => s.emit('joinGame', { gameId }));
      s.on('gameState', () => { started[color] = true; checkStart(); });
      s.on('gameOver', () => { clearTimeout(timer); close(); resolve(); });
      s.on('error', (e) => { clearTimeout(timer); close(); reject(new Error(`ws error ${JSON.stringify(e)}`)); });
      s.on('connect_error', (e) => { clearTimeout(timer); close(); reject(new Error(`ws connect_error ${e.message}`)); });
    };
    mk(whiteToken, 'white');
    mk(blackToken, 'black');
  });
}

async function listMatches(tid, round) {
  return prisma.$queryRawUnsafe(
    `SELECT id, status, white_user_id AS "whiteUserId", black_user_id AS "blackUserId", game_id AS "gameId"
     FROM "tournament_matches" WHERE tournament_id = $1 AND round = $2 AND status IN ('scheduled','ongoing')`,
    tid,
    round,
  );
}

async function pendingCount(tid, round) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "tournament_matches"
     WHERE tournament_id = $1 AND round = $2 AND status IN ('scheduled','ongoing')`,
    tid,
    round,
  );
  return Number(rows[0].n);
}

async function settleRound(tid, round, tokensByUser) {
  const matches = await listMatches(tid, round);
  check(`round ${round}: ${matches.length} match(es) paired`, matches.length === 2, `n=${matches.length}`);
  for (const m of matches) {
    if (m.status === 'scheduled') {
      await poll(async () => {
        const g = (await prisma.$queryRawUnsafe(`SELECT game_id AS "gameId" FROM "tournament_matches" WHERE id = $1`, m.id))[0];
        return g?.gameId ?? null;
      }, 10000);
    }
    const fresh = (await prisma.$queryRawUnsafe(
      `SELECT game_id AS "gameId", white_user_id AS "whiteUserId", black_user_id AS "blackUserId" FROM "tournament_matches" WHERE id = $1`,
      m.id,
    ))[0];
    if (!fresh?.gameId) continue;
    await settleGame(fresh.gameId, tokensByUser[fresh.whiteUserId], tokensByUser[fresh.blackUserId]);
  }
  const done = await poll(async () => (await pendingCount(tid, round)) === 0, 25000);
  check(`round ${round}: all matches settled`, Boolean(done));
}

// ---------------------------------------------------------------------------

const admin = await login('smoke-admin@test.local');
const tokens = {};
const tokensByUser = {};
for (const n of [1, 2, 3, 4]) {
  tokens[`p${n}`] = await login(`smoke-p${n}@test.local`);
  tokensByUser[sub(tokens[`p${n}`])] = tokens[`p${n}`];
}

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const { data: t } = await req('POST', '/admin/tournaments', admin, {
  name: 'Smoke Swiss',
  description: 'swiss smoke',
  format: 'swiss',
  visibility: 'public',
  entryType: 'free',
  prizePool: 0,
  maxPlayers: 4,
  minPlayers: 2,
  rounds: 3,
  startTime: future,
  timeControl: 'blitz_3_0',
});
check('admin create Swiss tournament', Boolean(t?.id), `id=${t?.id}`);
await req('POST', `/admin/tournaments/${t.id}/publish`, admin);
for (const p of ['p1', 'p2', 'p3', 'p4']) {
  await req('POST', `/tournaments/${t.id}/register`, tokens[p]);
}
const start = await req('POST', `/admin/tournaments/${t.id}/start`, admin);
check('admin start Swiss → active', [200, 201].includes(start.status), `status=${start.status}`);

const detail = (await req('GET', `/tournaments/${t.id}`, tokens.p1)).data;
check('player detail: status active, round 1', detail.status === 'active' && detail.currentRound === 1, `${detail.status}/r${detail.currentRound}`);
check('player detail: standings present with names', detail.standings?.length === 4 && detail.standings.every((s) => s.name && s.email), detail.standings?.map((s) => s.name).join(','));

for (let round = 1; round <= 3; round++) {
  await settleRound(t.id, round, tokensByUser);
  if (round < 3) {
    const advanced = await poll(async () => {
      const tt = (await prisma.$queryRawUnsafe(
        `SELECT current_round AS "currentRound", status FROM "tournaments" WHERE id = $1`,
        t.id,
      ))[0];
      return Number(tt.currentRound) > round ? tt : null;
    }, 15000);
    check(`round ${round + 1} auto-paired after round ${round}`, Boolean(advanced), advanced ? `r${advanced.currentRound}` : 'no');
  }
}

const finished = await poll(async () => {
  const tt = (await prisma.$queryRawUnsafe(`SELECT status FROM "tournaments" WHERE id = $1`, t.id))[0];
  return tt.status === 'completed' ? tt : null;
}, 20000);
check('Swiss tournament completed after 3 rounds', Boolean(finished));

const finalDetail = (await req('GET', `/tournaments/${t.id}`, tokens.p1)).data;
const scores = finalDetail.standings.map((s) => `${s.name}:${s.score}`);
check('final standings have names + scores', finalDetail.standings.length === 4 && finalDetail.standings.every((s) => typeof s.score === 'number' && s.name), scores.join(','));

const regs = await prisma.$queryRawUnsafe(
  `SELECT final_rank AS "finalRank" FROM "tournament_registrations" WHERE tournament_id = $1`,
  t.id,
);
const ranks = regs.map((r) => Number(r.finalRank)).sort((a, b) => a - b);
check('all Swiss players ranked 1..4', JSON.stringify(ranks) === JSON.stringify([1, 2, 3, 4]), ranks.join(','));

await prisma.$disconnect();
console.log(`\nSwiss failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
