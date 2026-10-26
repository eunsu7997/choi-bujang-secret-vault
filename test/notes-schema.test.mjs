import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const readSql = async (path) => (await read(path)).replace(/--.*$/gmu, '');

test('notes schema has owner_id without auth.users foreign key', async () => {
  const sql = await readSql('supabase/notes.sql');
  assert.match(sql, /create table if not exists public\.notes/u);
  assert.match(sql, /owner_id uuid not null/u);
  assert.doesNotMatch(sql, /references|auth\.users/iu);
});

test('notes schema enables RLS and blocks anon/authenticated', async () => {
  const sql = await readSql('supabase/notes.sql');
  assert.match(sql, /enable row level security/u);
  assert.match(sql, /force row level security/u);
  assert.match(sql, /revoke all on table public\.notes from public, anon, authenticated/u);
  assert.doesNotMatch(sql, /create policy|grant /iu);
});

// data.json과 시드는 로컬 전용이라 새 클론에는 없습니다. 있을 때만 대조합니다.
const localOnly = ['data.json', 'supabase/seed.local.sql'].every((path) => existsSync(new URL(`../${path}`, import.meta.url)));

test('local seed matches local sample notes', { skip: !localOnly && '로컬 전용 파일 없음' }, async () => {
  const { notes } = JSON.parse(await read('data.json'));
  const seed = await read('supabase/seed.local.sql');
  for (const note of notes) assert.ok(seed.includes(`('${note.title}', '${note.content}')`), note.title);
});

test('local-only seed, sample data, and bundle notes stay out of Git', () => {
  const cwd = new URL('..', import.meta.url);
  const paths = ['supabase/seed.local.sql', 'data.json', 'bundle-notes.json'];
  assert.deepEqual(execFileSync('git', ['check-ignore', ...paths], { cwd, encoding: 'utf8' }).trim().split(/\r?\n/u), paths);
  assert.equal(execFileSync('git', ['ls-files', '--', ...paths], { cwd, encoding: 'utf8' }), '');
});
