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

async function poll(fn, timeoutMs = 30000, every = 700) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(every);
  }
  return null;
}

async function balance(token) {
  const { data } = await req('GET', '/wallet/balance', token);
  return { available: Number(data.available), locked: Number(data.locked), pending: Number(data.pending) };
}

async function createPaid(name, entryFee, prizePool, prizeDistribution, maxPlayers) {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data: t } = await req('POST', '/admin/tournaments', admin, {
    name,
    description: 'finance smoke',
    format: 'single_elimination',
    visibility: 'public',
    entryType: 'paid',
    entryFee,
    prizePool,
    prizeDistribution,
    maxPlayers,
    minPlayers: 2,
    startTime: future,
    timeControl: 'blitz_3_0',
  });
  await req('POST', `/admin/tournaments/${t.id}/publish`, admin);
  return t.id;
}

/** Both players join; once the game starts, black resigns → white wins. */
function settleGame(gameId, whiteToken, blackToken) {
  return new Promise((resolve, reject) => {
    const sockets = [];
    const started = { white: false, black: false };
    let resigned = false;
    const timer = setTimeout(() => { close(); reject(new Error(`settle timeout for ${gameId}`)); }, 40000);
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
      s.on('connect_error', (e) => { clearTimeout(timer); close(); reject(new Error(`ws connect_error ${e.message}`)); });
    };
    mk(whiteToken, 'white');
    mk(blackToken, 'black');
  });
}

async function settleTournament(tid, label) {
  let guard = 0;
  while (guard < 10) {
    guard += 1;
    const { data: d } = await req('GET', `/admin/tournaments/${tid}`, admin);
    const pending = (d.bracket ?? []).filter((m) => m.status === 'scheduled' || m.status === 'ongoing');
    if (pending.length === 0) return d;
    for (const m of pending) {
      let gameId = m.gameId;
      if (!gameId) {
        gameId = await poll(async () => {
          const { data: d2 } = await req('GET', `/admin/tournaments/${tid}`, admin);
          return (d2.bracket ?? []).find((x) => x.id === m.id)?.gameId ?? null;
        }, 10000);
      }
      if (!gameId) { console.log(`  ${label}: match ${m.id} has no game — skip`); continue; }
      await settleGame(gameId, playersById[m.whiteUserId], playersById[m.blackUserId]);
      await sleep(400);
    }
  }
  return (await req('GET', `/admin/tournaments/${tid}`, admin)).data;
}

async function ledgerCount(tid, type) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "wallet_transactions" WHERE reference_type = 'tournament' AND reference_id = $1 AND type = CAST($2 AS "TxnType")`,
    tid,
    type,
  );
  return rows[0].n;
}

// ---------------------------------------------------------------------------

const admin = await login('smoke-admin@test.local');
const tokens = {};
const playersById = {};
for (const n of [1, 2, 3, 4]) {
  tokens[`p${n}`] = await login(`smoke-p${n}@test.local`);
  playersById[sub(tokens[`p${n}`])] = tokens[`p${n}`];
}

// ===========================================================================
// F1 — computed prize pool (prizePool 0) + [70/30] distribution
// ===========================================================================

const F1 = await createPaid('Finance F1', 10, 0, [70, 30], 4);

for (const p of ['p1', 'p2', 'p3', 'p4']) {
  const r = await req('POST', `/tournaments/${F1}/register`, tokens[p]);
  check(`F1: register ${p}`, [201, 200].includes(r.status), `status=${r.status}`);
}
for (const p of ['p1', 'p2', 'p3', 'p4']) {
  const b = await balance(tokens[p]);
  check(`F1: ${p} available 190 / locked 10 after hold`, b.available === 190 && b.locked === 10, `${b.available}/${b.locked}`);
}
check('F1: exactly 4 entry_fee_hold txns (no double charge)', (await ledgerCount(F1, 'entry_fee_hold')) === 4);

const dupReg = await req('POST', `/tournaments/${F1}/register`, tokens.p1);
check('F1: duplicate register rejected (409)', dupReg.status === 409, `status=${dupReg.status}`);
check('F1: no extra hold after duplicate register', (await ledgerCount(F1, 'entry_fee_hold')) === 4);

const f1Start = await req('POST', `/admin/tournaments/${F1}/start`, admin);
check('F1: start ok', [200, 201].includes(f1Start.status), `status=${f1Start.status}`);

const f1Detail = await req('GET', `/admin/tournaments/${F1}/finance`, admin);
check('F1: prize pool funded from entries (0 → 40)', Number(f1Detail.data.tournament.prizePool) === 40, `pool=${f1Detail.data.tournament.prizePool}`);
for (const p of ['p1', 'p2', 'p3', 'p4']) {
  const b = await balance(tokens[p]);
  check(`F1: ${p} available 190 / locked 0 after capture`, b.available === 190 && b.locked === 0, `${b.available}/${b.locked}`);
}
check('F1: exactly 4 entry_fee_capture txns', (await ledgerCount(F1, 'entry_fee_capture')) === 4);

const dupStart = await req('POST', `/admin/tournaments/${F1}/start`, admin);
check('F1: double start rejected (409) — no second capture', dupStart.status === 409, `status=${dupStart.status}`);
check('F1: still 4 captures after double start', (await ledgerCount(F1, 'entry_fee_capture')) === 4);

// settle → champion (final white) +$28, runner-up (final black) +$12
const f1Done = await settleTournament(F1, 'F1');
const finalMatch = f1Done.bracket.find((m) => m.round === 2 && m.status === 'completed' && m.winnerUserId);
check('F1: tournament completed', f1Done.status === 'completed', f1Done.status);
check('F1: final has a winner', Boolean(finalMatch), finalMatch?.winnerUserId?.slice(0, 6));

const champToken = playersById[finalMatch.whiteUserId];
const runnerToken = playersById[finalMatch.blackUserId];
const loserTokens = [tokens.p1, tokens.p2, tokens.p3, tokens.p4].filter(
  (t) => t !== champToken && t !== runnerToken,
);

const champBal = await balance(champToken);
const runnerBal = await balance(runnerToken);
check('F1: champion +$28 (218)', champBal.available === 218, `avail=${champBal.available}`);
check('F1: runner-up +$12 (202)', runnerBal.available === 202, `avail=${runnerBal.available}`);
for (const t of loserTokens) {
  const b = await balance(t);
  check('F1: eliminated player stays at 190', b.available === 190, `avail=${b.available}`);
}
check('F1: exactly 2 prize_credit txns (no double reward)', (await ledgerCount(F1, 'prize_credit')) === 2);

const f1Finance = await req('GET', `/admin/tournaments/${F1}/finance`, admin);
const tot = f1Finance.data.totals;
check('F1 finance: expectedEntries=40 held=40 captured=40', tot.expectedEntries === 40 && tot.held === 40 && tot.captured === 40, JSON.stringify(tot));
check('F1 finance: refunded=0 prizesPaid=40 platformRetained=0', tot.refunded === 0 && tot.prizesPaid === 40 && tot.platformRetained === 0, JSON.stringify(tot));
const dist = f1Finance.data.distribution;
check('F1 finance: distribution [rank1=28, rank2=12]', dist.length === 2 && dist[0].amount === 28 && dist[1].amount === 12, JSON.stringify(dist));
const champPay = f1Finance.data.payments.find((p) => p.userId === finalMatch.whiteUserId);
const runnerPay = f1Finance.data.payments.find((p) => p.userId === finalMatch.blackUserId);
check('F1 finance: champion entryStatus=paid prizeAmount=28 rank=1', champPay.entryStatus === 'paid' && champPay.prizeAmount === 28 && champPay.finalRank === 1, JSON.stringify(champPay));
check('F1 finance: runner-up prizeAmount=12 rank=2 paid out', runnerPay.prizeAmount === 12 && runnerPay.finalRank === 2 && Boolean(runnerPay.paidOutAt), JSON.stringify(runnerPay));

const champTxns = (await req('GET', `/wallet/transactions?search=${F1}`, champToken)).data;
const champTypes = champTxns.map((x) => x.type).sort();
check('F1 history: champion ledger has hold/capture/prize', JSON.stringify(champTypes) === JSON.stringify(['entry_fee_capture', 'entry_fee_hold', 'prize_credit']), champTypes.join(','));

// ===========================================================================
// F2 — explicit admin-set pool is never overwritten
// ===========================================================================

const F2 = await createPaid('Finance F2', 10, 50, [100], 2);
for (const p of ['p1', 'p2']) await req('POST', `/tournaments/${F2}/register`, tokens[p]);
const f2Start = await req('POST', `/admin/tournaments/${F2}/start`, admin);
check('F2: start ok', [200, 201].includes(f2Start.status), `status=${f2Start.status}`);
const f2Finance = await req('GET', `/admin/tournaments/${F2}/finance`, admin);
check('F2: explicit prize pool preserved (50, not 20)', Number(f2Finance.data.tournament.prizePool) === 50, `pool=${f2Finance.data.tournament.prizePool}`);

const f2Before = {};
for (const p of ['p1', 'p2']) f2Before[sub(tokens[p])] = (await balance(tokens[p])).available;
const f2Done = await settleTournament(F2, 'F2');
const f2Final = f2Done.bracket.find((m) => m.status === 'completed' && m.winnerUserId);
const f2WinnerAfter = (await balance(playersById[f2Final.whiteUserId])).available;
check('F2: winner +$50', f2WinnerAfter === f2Before[f2Final.whiteUserId] + 50, `before=${f2Before[f2Final.whiteUserId]} after=${f2WinnerAfter}`);
const f2Finance2 = await req('GET', `/admin/tournaments/${F2}/finance`, admin);
check('F2 finance: prizesPaid=50 prizePoolResolved=50', f2Finance2.data.totals.prizesPaid === 50 && f2Finance2.data.totals.prizePoolResolved === 50, JSON.stringify(f2Finance2.data.totals));
check('F2 finance: subsidized pool books -30 retained (20 captured, 50 paid)', f2Finance2.data.totals.platformRetained === -30, `retained=${f2Finance2.data.totals.platformRetained}`);

// ===========================================================================
// F3 — refund on admin cancel (pre-capture)
// ===========================================================================

const F3 = await createPaid('Finance F3', 5, 0, [100], 4);
const p1Before = await balance(tokens.p1);
await req('POST', `/tournaments/${F3}/register`, tokens.p1);
const p1Held = await balance(tokens.p1);
check('F3: entry held on register (-5 locked)', p1Held.available === p1Before.available - 5 && p1Held.locked === 5, `${p1Held.available}/${p1Held.locked}`);
const f3Cancel = await req('POST', `/admin/tournaments/${F3}/cancel`, admin, { reason: 'finance smoke' });
check('F3: cancel ok', [200, 201].includes(f3Cancel.status), `status=${f3Cancel.status}`);
const p1AfterCancel = await balance(tokens.p1);
check('F3: refund released fully after cancel', p1AfterCancel.available === p1Before.available && p1AfterCancel.locked === 0, `${p1AfterCancel.available}/${p1AfterCancel.locked}`);
const f3Finance = await req('GET', `/admin/tournaments/${F3}/finance`, admin);
const f3tot = f3Finance.data.totals;
check('F3 finance: held=5 refunded=5 captured=0 prizes=0', f3tot.held === 5 && f3tot.refunded === 5 && f3tot.captured === 0 && f3tot.prizesPaid === 0, JSON.stringify(f3tot));
check('F3 finance: participant entryStatus=refunded', f3Finance.data.payments.find((p) => p.userId === sub(tokens.p1))?.entryStatus === 'refunded', JSON.stringify(f3Finance.data.payments));

// ===========================================================================
// F4 — insufficient balance rejected, no hold written
// ===========================================================================

const F4 = await createPaid('Finance F4', 500, 0, [100], 2);
const p1BalBefore = await balance(tokens.p1);
const f4Reg = await req('POST', `/tournaments/${F4}/register`, tokens.p1);
check('F4: register rejected on insufficient balance (400)', f4Reg.status === 400, `status=${f4Reg.status}`);
const p1BalAfter = await balance(tokens.p1);
check('F4: balance unchanged after rejected register', p1BalAfter.available === p1BalBefore.available && p1BalAfter.locked === 0, `${p1BalAfter.available}/${p1BalAfter.locked}`);
check('F4: no hold txn written', (await ledgerCount(F4, 'entry_fee_hold')) === 0);

// ===========================================================================
// F5 — withdraw refund before start
// ===========================================================================

const F5 = await createPaid('Finance F5', 5, 0, [100], 4);
for (const p of ['p1', 'p2']) await req('POST', `/tournaments/${F5}/register`, tokens[p]);
const p1WithdrawBefore = (await balance(tokens.p1)).available;
await req('POST', `/tournaments/${F5}/withdraw`, tokens.p1);
const p1WithdrawAfter = await balance(tokens.p1);
check('F5: withdraw refunds the hold', p1WithdrawAfter.available === p1WithdrawBefore + 5 && p1WithdrawAfter.locked === 0, `${p1WithdrawAfter.available}/${p1WithdrawAfter.locked}`);
const f5Finance = await req('GET', `/admin/tournaments/${F5}/finance`, admin);
check('F5 finance: held=10 refunded=5 captured=0', f5Finance.data.totals.held === 10 && f5Finance.data.totals.refunded === 5 && f5Finance.data.totals.captured === 0, JSON.stringify(f5Finance.data.totals));

await prisma.$disconnect();
console.log(`\nFinance integration failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
