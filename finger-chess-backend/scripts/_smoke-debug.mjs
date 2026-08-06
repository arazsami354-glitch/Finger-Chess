import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:3000/api/v1';
const state = JSON.parse(readFileSync(new URL('./_smoke-state.json', import.meta.url), 'utf8'));

async function req(method, path, token) {
  const res = await fetch(BASE + path, { method, headers: { authorization: `Bearer ${token}` } });
  return res.status === 204 ? { status: res.status, data: null } : { status: res.status, data: await res.json() };
}

for (const t of [state.A, state.B]) {
  const { data } = await req('GET', `/admin/tournaments/${t.id}`, state.admin);
  console.log(`\n=== ${t.id} status=${data.status} round=${data.currentRound} matches=${data.bracket.length}`);
  for (const m of data.bracket) {
    console.log(`  r${m.round} ${m.bracket} s${m.slot} ${m.status} game=${m.gameId ?? 'NULL'} w=${m.whiteUserId ? 'x' : '-'} b=${m.blackUserId ? 'x' : '-'} win=${m.winnerUserId ? 'x' : '-'}`);
  }
}
