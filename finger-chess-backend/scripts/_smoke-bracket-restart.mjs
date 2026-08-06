import { readFileSync } from 'node:fs';

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

const state = JSON.parse(readFileSync(new URL('./_smoke-bracket-state.json', import.meta.url), 'utf8'));

const admin = await login('smoke-admin@test.local');
const { data } = await req('GET', `/admin/tournaments/${state.id}`, admin);
const after = { bracket: data.bracket, edges: data.edges };

const key = (obj) => JSON.stringify({ bracket: obj.bracket, edges: obj.edges });
check('bracket identical after server restart', key(after) === key(state), `${after.bracket?.length ?? 0} matches, ${after.edges?.length ?? 0} edges`);

console.log(`\nRestart-persistence failures: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
