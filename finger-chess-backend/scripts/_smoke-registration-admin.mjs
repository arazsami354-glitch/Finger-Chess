import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

async function balance(token) {
  const { data } = await req('GET', '/wallet/balance', token);
  return { available: Number(data.available), locked: Number(data.locked) };
}

const admin = await login('smoke-admin@test.local');
const p1 = await login('smoke-p1@test.local');
const p2 = await login('smoke-p2@test.local');
const p3 = await login('smoke-p3@test.local');

const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const { data: t } = await req('POST', '/admin/tournaments', admin, {
  name: 'Smoke Registration Admin',
  description: 'registration admin smoke',
  format: 'single_elimination',
  visibility: 'public',
  entryType: 'paid',
  entryFee: 5,
  prizePool: 20,
  maxPlayers: 2,
  minPlayers: 2,
  startTime: future,
  timeControl: 'blitz_3_0',
});
check('admin create paid tournament', Boolean(t?.id), `id=${t?.id}`);
await req('POST', `/admin/tournaments/${t.id}/publish`, admin);

// register p1, p2 (fill), p3 (waitlisted)
for (const token of [p1, p2, p3]) await req('POST', `/tournaments/${t.id}/register`, token);
let detail = (await req('GET', `/admin/tournaments/${t.id}`, admin)).data;
check('admin detail lists all 3 registrations', detail.players?.length === 3, `players=${detail.players?.length}`);
check('admin detail counts (2 registered / 1 waitlisted)', detail.playerCount === 2 && detail.waitlistCount === 1, `${detail.playerCount}/${detail.waitlistCount}`);
const p2Entry = detail.players.find((p) => p.status === 'waitlisted');
check('p3 is the waitlisted player', p2Entry?.email === 'smoke-p3@test.local', p2Entry?.email);

let b2 = await balance(p2);
check('p2 entry fee held on registration', b2.locked === 5, `locked=${b2.locked}`);

// admin removes p2 → hold released + p3 promoted
const p2UserId = detail.players.find((p) => p.email === 'smoke-p2@test.local')?.userId;
const removeP2 = await req('POST', `/admin/tournaments/${t.id}/players/${p2UserId}/remove`, admin);
check('admin remove player succeeds', [200, 201].includes(removeP2.status), `status=${removeP2.status}`);

detail = (await req('GET', `/admin/tournaments/${t.id}`, admin)).data;
const emails = detail.players.map((p) => p.email);
check('removed player no longer listed', !emails.includes('smoke-p2@test.local'), emails.join(','));
check('waitlisted p3 promoted to registered', detail.players.find((p) => p.email === 'smoke-p3@test.local')?.status === 'registered', detail.players.map((p) => `${p.email}:${p.status}`).join(','));
check('counts after removal (2 registered / 0 waitlisted)', detail.playerCount === 2 && detail.waitlistCount === 0, `${detail.playerCount}/${detail.waitlistCount}`);

b2 = await balance(p2);
check('removed player hold released (locked 0)', b2.locked === 0, `locked=${b2.locked}`);

const b3 = await balance(p3);
check('promoted waitlisted player hold taken', b3.locked === 5, `locked=${b3.locked}`);

// removing a non-registered player → 404
const notReg = await req('POST', `/admin/tournaments/${t.id}/players/${p2UserId}/remove`, admin);
check('removing non-registered player rejected (404)', notReg.status === 404, `status=${notReg.status}`);

// a plain player cannot remove
const forbidden = await req('POST', `/admin/tournaments/${t.id}/players/${p2UserId}/remove`, p1);
check('player cannot remove registrations (403)', forbidden.status === 403, `status=${forbidden.status}`);

// duplicate registration still impossible
const dup = await req('POST', `/tournaments/${t.id}/register`, p1);
check('duplicate registration rejected (409)', dup.status === 409, `status=${dup.status}`);

await prisma.$disconnect();
console.log(`\nRegistration admin failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
