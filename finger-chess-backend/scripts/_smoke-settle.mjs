import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { io } from 'socket.io-client';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE = 'http://localhost:3000/api/v1';
const WS = 'http://localhost:3000';
const state = JSON.parse(readFileSync(new URL('./_smoke-state.json', import.meta.url), 'utf8'));

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

async function poll(fn, timeoutMs = 25000, every = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

async function bracket(tid) {
  const { data } = await req('GET', `/admin/tournaments/${tid}`, state.admin);
  return data;
}

async function balance(token) {
  const { data } = await req('GET', '/wallet/balance', token);
  return Number(data.available);
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
      const s = io(`${WS}/game`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: 10000,
      });
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

async function settleTournament(tid, label) {
  let detail = await bracket(tid);
  let guard = 0;
  while (guard < 12) {
    const pending = (detail.bracket ?? []).filter((m) => m.status === 'scheduled' || m.status === 'ongoing');
    if (pending.length === 0) break;
    guard += 1;
    for (const m of pending) {
      const white = playersById[m.whiteUserId];
      const black = playersById[m.blackUserId];
      if (!white || !black) {
        console.log(`  ${label}: match ${m.id} missing a participant — skip`);
        continue;
      }
      let gameId = m.gameId;
      if (!gameId) {
        gameId = await poll(async () => {
          const d = await bracket(tid);
          return (d.bracket ?? []).find((x) => x.id === m.id)?.gameId ?? null;
        }, 10000);
      }
      if (!gameId) {
        console.log(`  ${label}: match ${m.id} still has no game — skip`);
        continue;
      }
      await settleGame(gameId, white, black);
      const done = await poll(async () => {
        const d = await bracket(tid);
        const mm = (d.bracket ?? []).find((x) => x.id === m.id);
        return mm && (mm.status === 'completed' || mm.status === 'bye') ? mm : null;
      });
      if (!done) console.log(`  ${label}: match ${m.id} did not settle — check server log`);
    }
    detail = await bracket(tid);
  }
  return detail;
}

// ---------------------------------------------------------------------------

const playersById = {};
for (const label of ['p1', 'p2', 'p3', 'p4']) {
  const token = await login(`smoke-${label}@test.local`);
  playersById[sub(token)] = token;
}

const balancesBefore = {};
for (const [uid, tok] of Object.entries(playersById)) balancesBefore[uid] = await balance(tok);
console.log(`Starting balances: ${Object.values(balancesBefore).join(', ')}`);

// --- Tournament A (free, prizePool 100 → ranks only, no credits) ---
const aAfter = await settleTournament(state.A.id, 'A');
check('A (free) completed', aAfter.status === 'completed', `status=${aAfter.status}`);
for (const [uid, tok] of Object.entries(playersById)) {
  const delta = (await balance(tok)) - balancesBefore[uid];
  check(`A: player balance unchanged (no prizes on free tournament)`, delta === 0, `Δ ${delta}`);
}

// --- Tournament B (paid $10, prizePool 40, winner-take-all) ---
const bAfter = await settleTournament(state.B.id, 'B');
check('B (paid) completed', bAfter.status === 'completed', `status=${bAfter.status}`);

const completedB = (bAfter.bracket ?? [])
  .filter((m) => m.status === 'completed' && m.winnerUserId)
  .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime());
const championId = completedB[0]?.winnerUserId ?? null;
const championLabel = Object.keys(playersById).find((u) => u === championId);
const championDelta = championLabel ? (await balance(playersById[championLabel])) - balancesBefore[championId] : NaN;
check('B: champion paid exactly $40 (winner-take-all pool)', championDelta === 40, `Δ ${championDelta}`);
for (const [uid, tok] of Object.entries(playersById)) {
  if (uid === championId) continue;
  const delta = (await balance(tok)) - balancesBefore[uid];
  check('B: non-champion balances unchanged', delta === 0, `Δ ${delta}`);
}

// --- DB-level verification of ranks + prize records ---
const regs = await prisma.$queryRawUnsafe(
  `SELECT r.tournament_id AS tid, r.user_id AS uid, r.final_rank AS rank, r.prize_amount AS prize,
          r.paid_out_at AS paid
   FROM "tournament_registrations" r
   WHERE r.tournament_id IN ($1, $2)`,
  state.A.id,
  state.B.id,
);
const aRegs = regs.filter((r) => r.tid === state.A.id);
const bRegs = regs.filter((r) => r.tid === state.B.id);
const ranksA = aRegs.map((r) => Number(r.rank)).sort((a, b) => a - b);
const ranksB = bRegs.map((r) => Number(r.rank)).sort((a, b) => a - b);
check('A: all 4 registrations ranked 1..4', JSON.stringify(ranksA) === JSON.stringify([1, 2, 3, 4]), `${ranksA.join(',')}`);
check('B: all 4 registrations ranked 1..4', JSON.stringify(ranksB) === JSON.stringify([1, 2, 3, 4]), `${ranksB.join(',')}`);

const bChampReg = bRegs.find((r) => r.uid === championId);
check('B: champion registration has prize_amount 40', bChampReg && Number(bChampReg.prize) === 40, `prize=${bChampReg?.prize}`);
check('B: champion registration paid_out_at set', bChampReg && Boolean(bChampReg.paid), `paid=${bChampReg?.paid}`);
const aPrizes = aRegs.filter((r) => r.prize !== null && Number(r.prize) > 0);
check('A: no prize records on free tournament', aPrizes.length === 0, `prizes=${aPrizes.length}`);

await prisma.$disconnect();
console.log(`\nSettle failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
