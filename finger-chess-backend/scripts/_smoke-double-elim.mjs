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

async function bracket(tid) {
  const { data } = await req('GET', `/admin/tournaments/${tid}`, admin);
  return data;
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
  name: 'Smoke Double Elim',
  description: 'double elim smoke',
  format: 'double_elimination',
  visibility: 'public',
  entryType: 'free',
  prizePool: 0,
  maxPlayers: 4,
  minPlayers: 2,
  startTime: future,
  timeControl: 'blitz_3_0',
});
check('admin create double-elim tournament', Boolean(t?.id), `id=${t?.id}`);
await req('POST', `/admin/tournaments/${t.id}/publish`, admin);
for (const p of ['p1', 'p2', 'p3', 'p4']) {
  await req('POST', `/tournaments/${t.id}/register`, tokens[p]);
}
const start = await req('POST', `/admin/tournaments/${t.id}/start`, admin);
check('admin start double-elim → active', [200, 201].includes(start.status), `status=${start.status}`);

let detail = await bracket(t.id);
const bracketKinds = [...new Set(detail.bracket.map((m) => m.bracket))];
check('bracket starts with only the main stage', bracketKinds.length === 1 && bracketKinds[0] === 'main', bracketKinds.join(','));

let guard = 0;
while (guard < 20) {
  const pending = (detail.bracket ?? []).filter((m) => m.status === 'scheduled' || m.status === 'ongoing');
  if (pending.length === 0) break;
  guard += 1;
  for (const m of pending) {
    const white = tokensByUser[m.whiteUserId];
    const black = tokensByUser[m.blackUserId];
    if (!white || !black) continue;
    let gameId = m.gameId;
    if (!gameId) {
      gameId = await poll(async () => {
        const d = await bracket(t.id);
        return (d.bracket ?? []).find((x) => x.id === m.id)?.gameId ?? null;
      }, 10000);
    }
    if (!gameId) continue;
    await settleGame(gameId, white, black);
    await poll(async () => {
      const d = await bracket(t.id);
      const mm = (d.bracket ?? []).find((x) => x.id === m.id);
      return mm && (mm.status === 'completed' || mm.status === 'bye') ? mm : null;
    });
  }
  detail = await bracket(t.id);
}

check('double-elim tournament completed', detail.status === 'completed', `status=${detail.status}`);
const completed = (detail.bracket ?? []).filter((m) => m.status === 'completed');
check('double-elim settled >4 matches (multiple stages)', completed.length >= 5, `completed=${completed.length}`);
const kindSet = [...new Set(completed.map((m) => m.bracket))];
check('completed matches span main + losers + grand_final', kindSet.includes('main') && kindSet.includes('losers') && kindSet.includes('grand_final'), kindSet.join(','));
const eliminations = await prisma.$queryRawUnsafe(
  `SELECT COUNT(*)::int AS n FROM "tournament_registrations" WHERE tournament_id = $1 AND status = 'eliminated'`,
  t.id,
);
check('losers eliminated in double-elim', Number(eliminations[0].n) === 3, `eliminated=${eliminations[0].n}`);

const regs = await prisma.$queryRawUnsafe(
  `SELECT final_rank AS "finalRank" FROM "tournament_registrations" WHERE tournament_id = $1`,
  t.id,
);
const ranks = regs.map((r) => Number(r.finalRank)).sort((a, b) => a - b);
check('all players ranked 1..4', JSON.stringify(ranks) === JSON.stringify([1, 2, 3, 4]), ranks.join(','));

await prisma.$disconnect();
console.log(`\nDouble-elim failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
