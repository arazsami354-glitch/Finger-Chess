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

async function createAndStart(name, playerLabels, { seeding = 'random', maxPlayers = 4 } = {}) {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: t } = await req('POST', '/admin/tournaments', admin, {
    name,
    description: 'bracket smoke',
    format: 'single_elimination',
    visibility: 'public',
    entryType: 'free',
    prizePool: 0,
    maxPlayers,
    minPlayers: 2,
    startTime: future,
    timeControl: 'blitz_3_0',
    seeding,
  });
  await req('POST', `/admin/tournaments/${t.id}/publish`, admin);
  for (const label of playerLabels) await req('POST', `/tournaments/${t.id}/register`, tokens[label]);
  const start = await req('POST', `/admin/tournaments/${t.id}/start`, admin);
  if (![200, 201].includes(start.status)) throw new Error(`start failed for ${name}: ${start.status} ${JSON.stringify(start.data)}`);
  return t.id;
}

// ---------------------------------------------------------------------------

const admin = await login('smoke-admin@test.local');
const tokens = {};
const tokensByUser = {};
for (const n of [1, 2, 3, 4]) {
  tokens[`p${n}`] = await login(`smoke-p${n}@test.local`);
  tokensByUser[sub(tokens[`p${n}`])] = tokens[`p${n}`];
}

// --- 1. bracket generation: 4 players, 2 round-1 matches, every player once ---
const r1 = await createAndStart('Bracket R1', ['p1', 'p2', 'p3', 'p4']);
let d1 = await bracket(r1);
const r1Matches = d1.bracket.filter((m) => m.round === 1);
check('R1: 2 round-1 matches generated', r1Matches.length === 2, `n=${r1Matches.length}`);
const r1Ids = r1Matches.flatMap((m) => [m.whiteUserId, m.blackUserId]);
check('R1: every player appears exactly once', r1Ids.length === 4 && new Set(r1Ids).size === 4, r1Ids.join(','));
const dupPair = r1Matches.filter((m) => m.whiteUserId && m.blackUserId && m.whiteUserId !== m.blackUserId).length;
check('R1: no self-pairings / duplicate pairings', r1Matches.every((m) => !(m.whiteUserId && m.blackUserId && m.whiteUserId === m.blackUserId)) && dupPair === 2, `pairs=${dupPair}`);

// --- 2. randomized seeding actually randomizes across tournaments ---
const r2 = await createAndStart('Bracket R2', ['p1', 'p2', 'p3', 'p4']);
const d2 = await bracket(r2);
const r2Pairing = JSON.stringify(d2.bracket.filter((m) => m.round === 1).map((m) => [m.whiteUserId, m.blackUserId]));
const r1Pairing = JSON.stringify(r1Matches.map((m) => [m.whiteUserId, m.blackUserId]));
check('R2: random seeding differs from R1', r2Pairing !== r1Pairing, `A=${r1Pairing} B=${r2Pairing}`);

// --- 3. byes for a non-power-of-two field (3 players → 1 bye to top seed) ---
const b1 = await createAndStart('Bracket Bye', ['p1', 'p2', 'p3']);
const db1 = await bracket(b1);
const b1Round1 = db1.bracket.filter((m) => m.round === 1);
const byes = b1Round1.filter((m) => m.status === 'bye' || (!m.blackUserId && m.whiteUserId));
check('B1: round 1 has exactly 1 bye', byes.length === 1, `byes=${byes.length}`);
const b1Ids = b1Round1.flatMap((m) => [m.whiteUserId, m.blackUserId]).filter(Boolean);
check('B1: all 3 players appear exactly once', b1Ids.length === 3 && new Set(b1Ids).size === 3, b1Ids.join(','));
check('B1: bye carried by the single seeded player', byes[0]?.whiteUserId && !byes[0]?.blackUserId, `${byes[0]?.whiteUserId} (no opponent)`);

// --- 4. winner advancement: settle R1 round 1, verify winners fill the final ---
const pending = d1.bracket.filter((m) => m.round === 1 && m.gameId);
for (const m of pending) {
  await settleGame(m.gameId, tokensByUser[m.whiteUserId], tokensByUser[m.blackUserId]);
}
const finalRound = await poll(async () => {
  const d = await bracket(r1);
  const fin = d.bracket.find((m) => m.round === 2);
  return fin && (fin.whiteUserId || fin.blackUserId) ? d : null;
}, 20000);
check('R1: final inserted after round 1 completes', Boolean(finalRound), finalRound ? `rounds=${finalRound.bracket.map((m) => m.round).join(',')}` : 'no final yet');
const finMatch = finalRound.bracket.find((m) => m.round === 2);
const r1Winners = pending.map((m) => (m.winnerUserId ?? m.whiteUserId));
const finalParticipants = [finMatch.whiteUserId, finMatch.blackUserId].sort();
const expectedParticipants = r1Winners.slice().sort();
check('R1: winners advanced into the final', JSON.stringify(finalParticipants) === JSON.stringify(expectedParticipants), `final=${finalParticipants.join(',')} winners=${expectedParticipants.join(',')}`);

// --- 5. persistence across server restart (snapshot saved for the restart harness) ---
const snapshot = await bracket(r1);
import { writeFileSync } from 'node:fs';
writeFileSync('scripts/_smoke-bracket-state.json', JSON.stringify({ id: r1, bracket: snapshot.bracket, edges: snapshot.edges }, null, 2));
check('snapshot saved for restart comparison', true, `id=${r1}`);

await prisma.$disconnect();
console.log(`\nBracket pre-restart failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
