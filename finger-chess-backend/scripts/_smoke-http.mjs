import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000/api/v1';

let failures = 0;
function check(label, cond, extra = '') {
  const ok = Boolean(cond);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
}

async function req(method, path, token, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

async function login(email) {
  const { status, data } = await req('POST', '/auth/login', null, { email, password: 'SmokePass123!' });
  if (status !== 201 && status !== 200) throw new Error(`login failed for ${email}: ${status} ${JSON.stringify(data)}`);
  return data.accessToken;
}

const future = new Date(Date.now() + 30 * 60 * 1000).toISOString();

const admin = await login('smoke-admin@test.local');
const players = {};
for (const n of [1, 2, 3, 4]) players[`p${n}`] = await login(`smoke-p${n}@test.local`);

const base = { visibility: 'public', startTime: future, minPlayers: 2, maxPlayers: 4, timeControl: 'blitz_3_0' };

async function createTournament(name, format, entryType, extra = {}) {
  const { status, data } = await req('POST', '/admin/tournaments', admin, {
    name,
    description: `Smoke test — ${name}`,
    format,
    entryType,
    ...base,
    ...extra,
  });
  check(`admin create "${name}" (${format}/${entryType})`, status === 201 || status === 200, `status=${status}`);
  return data;
}

const A = await createTournament('Smoke SE Free', 'single_elimination', 'free', { prizePool: 100 });
const B = await createTournament('Smoke SE Paid', 'single_elimination', 'paid', { entryFee: 10, prizePool: 40, prizeDistribution: [100] });
const C = await createTournament('Smoke Waitlist', 'single_elimination', 'free', { prizePool: 0, maxPlayers: 2 });
const D = await createTournament('Smoke Cancel', 'single_elimination', 'paid', { entryFee: 5, prizePool: 20 });

for (const t of [A, B, C, D]) {
  const { status, data } = await req('POST', `/admin/tournaments/${t.id}/publish`, admin);
  check(`admin publish "${t.name}"`, status === 201 || status === 200, `status=${status} → ${data.status}`);
}

async function register(player, tid) {
  return req('POST', `/tournaments/${tid}/register`, players[player]);
}
async function withdraw(player, tid) {
  return req('POST', `/tournaments/${tid}/withdraw`, players[player]);
}
async function balance(player) {
  const { data } = await req('GET', '/wallet/balance', players[player]);
  return { available: Number(data.available), locked: Number(data.locked), pending: Number(data.pending) };
}

// --- register everyone ---
for (const p of ['p1', 'p2', 'p3', 'p4']) {
  const r1 = await register(p, A.id);
  const r2 = await register(p, B.id);
  check(`register ${p} in A`, [201, 200].includes(r1.status));
  check(`register ${p} in B (paid hold)`, [201, 200].includes(r2.status));
}
await register('p1', C.id);
await register('p2', C.id);
const c3 = await register('p3', C.id);
check('p3 waitlisted on full C', c3.data?.waitlisted === true);
await register('p1', D.id);

let b1 = await balance('p1');
check('p1 balances after holds (B $10 + D $5): available 185, locked 15', b1.available === 185 && b1.locked === 15, `${b1.available}/${b1.locked}`);

// --- waitlist promotion on withdraw ---
const cDetail = await req('GET', `/tournaments/${C.id}`, players['p1']);
check('C shows 1 waitlisted before promotion', cDetail.data.waitlistCount === 1, `wl=${cDetail.data.waitlistCount}`);
await withdraw('p2', C.id);
const cDetail2 = await req('GET', `/tournaments/${C.id}`, players['p1']);
check('C: p3 promoted after p2 withdraws (2 registered, 0 waitlisted)', cDetail2.data.playerCount === 2 && cDetail2.data.waitlistCount === 0, `${cDetail2.data.playerCount}/${cDetail2.data.waitlistCount}`);

// --- start A and B ---
const startA = await req('POST', `/admin/tournaments/${A.id}/start`, admin);
check('admin start A → active', startA.status === 201 || startA.status === 200, `status=${startA.status}`);
const aDetail = await req('GET', `/admin/tournaments/${A.id}`, admin);
check('A bracket stage 1 created (single elim, 4 players = 2 round-1 matches)', (aDetail.data.bracket?.length ?? 0) === 2, `matches=${aDetail.data.bracket?.length}`);
check('A currentRound = 1', aDetail.data.currentRound === 1);

const startB = await req('POST', `/admin/tournaments/${B.id}/start`, admin);
check('admin start B → active', [200, 201].includes(startB.status), `status=${startB.status}`);

b1 = await balance('p1');
check('p1 after B capture + D still held: available 185, locked 5', b1.available === 185 && b1.locked === 5, `${b1.available}/${b1.locked}`);

// --- cancel D → refund ---
const cancelD = await req('POST', `/admin/tournaments/${D.id}/cancel`, admin, { reason: 'Smoke test cancel' });
check('admin cancel D', [200, 201].includes(cancelD.status), `status=${cancelD.status}`);
b1 = await balance('p1');
check('p1 after D cancelled: available 190, locked 0', b1.available === 190 && b1.locked === 0, `${b1.available}/${b1.locked}`);

// --- admin overview + audit trail ---
const ov = await req('GET', '/admin/tournaments/overview', admin);
const ovMap = Object.fromEntries((ov.data ?? []).map((o) => [o.status, o.count]));
check('overview reports active tournaments', (ovMap.active ?? 0) >= 2, `active=${ovMap.active}`);

// role guard: a plain player must NOT create tournaments
const forbidden = await req('POST', '/admin/tournaments', players['p1'], { name: 'Should fail', format: 'single_elimination', entryType: 'free', ...base });
check('player blocked from admin create (403)', forbidden.status === 403, `status=${forbidden.status}`);

// --- save state for the settle harness ---
const state = {
  A: { id: A.id },
  B: { id: B.id },
  players: Object.fromEntries(Object.entries(players).map(([k, v]) => [k, v])),
  admin,
};
const bracketA = (await req('GET', `/admin/tournaments/${A.id}`, admin)).data.bracket;
const bracketB = (await req('GET', `/admin/tournaments/${B.id}`, admin)).data.bracket;
state.A.matches = bracketA.map((m) => ({ id: m.id, round: m.round, bracket: m.bracket, whiteUserId: m.whiteUserId, blackUserId: m.blackUserId, gameId: m.gameId }));
state.B.matches = bracketB.map((m) => ({ id: m.id, round: m.round, bracket: m.bracket, whiteUserId: m.whiteUserId, blackUserId: m.blackUserId, gameId: m.gameId }));

writeFileSync('scripts/_smoke-state.json', JSON.stringify(state, null, 2));
console.log(`\nState saved. Failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
