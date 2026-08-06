import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:3000/api/v1';
const state = JSON.parse(readFileSync(new URL('./_smoke-state.json', import.meta.url), 'utf8'));

async function req(method, path, token) {
  const res = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}` } });
  return res.status === 204 ? { status: res.status, data: null } : { status: res.status, data: await res.json() };
}

const { data } = await req('GET', `/admin/tournaments/${state.A.id}`, state.admin);
console.log('keys:', Object.keys(data));
console.log(JSON.stringify(data.bracket, null, 1).slice(0, 1500));
