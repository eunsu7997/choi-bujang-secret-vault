// 5단계 「자료 요청을 서버 한곳으로 모읍니다」 정적 점검입니다. 실제 DB 권한·운영 결과가 아닙니다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = async (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sql = async (name) => (await read(`supabase/${name}`)).replace(/--.*$/gmu, '');

test('browser code reaches notes only through the server function', async () => {
  const page = await read('public/index.html');
  assert.doesNotMatch(page, /\.from\(\s*['"]notes['"]|\/rest\/v1|\.rpc\(/u);
  assert.match(page, /fetch\(id \? `\/api\/notes\/\$\{encodeURIComponent\(id\)\}` : '\/api\/notes'/u);
  assert.doesNotMatch(page, /sb_secret_|SUPABASE_SECRET_KEY|SAMPLE_NOTE_/u);
});

test('step 5 SQL revokes every direct notes privilege and keeps the server role', async () => {
  const text = await sql('notes-step5-revoke.sql');
  assert.match(text, /revoke all on table public\.notes from public, anon, authenticated;/u);
  assert.match(text, /grant select, insert, update, delete on table public\.notes to service_role;/u);
  assert.doesNotMatch(text, /grant[^;]*\bto\s+(anon|authenticated|public)\b/iu);
  assert.doesNotMatch(text, /disable row level security|\bdrop table\b|^\s*truncate\b|\bdelete from\b|drop policy/imu);
  for (const match of text.matchAll(/\b(?:alter table|on table)\s+([a-z_]+\.[a-z_]+)/giu)) assert.equal(match[1], 'public.notes');
  const check = await sql('notes-step5-check.sql');
  assert.doesNotMatch(check, /^\s*(insert|update|delete|grant|revoke|alter|drop|create|begin|commit)\b/imu);
});

test('config names the query-free original data API and keeps allowed routes', async () => {
  const config = JSON.parse(await read('aleph.config.json'));
  assert.equal(config.step, 5);
  const url = new URL(config.originalApiUrl);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.search, '');
  assert.equal(url.origin, new URL(config.identityProvider.issuer).origin);
  assert.equal(url.pathname, '/rest/v1/notes');
  assert.deepEqual(config.allowedRoutes, ['/api/notes', '/api/notes/:id']);
});

test('self-check implements step 5 without printing keys', async () => {
  const source = await read('src/attack-check.mjs');
  assert.match(source, /config\.step === 5\) return fifthStepChecks/u);
  assert.doesNotMatch(source.slice(source.indexOf('async function fifthStepChecks')), /observed:[^\n]*\$\{key\}/u);
});
