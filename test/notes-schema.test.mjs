import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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

test('local seed matches public sample notes and stays out of Git', async () => {
  const { notes } = JSON.parse(await read('data.json'));
  const seed = await read('supabase/seed.local.sql');
  for (const note of notes) assert.ok(seed.includes(`('${note.title}', '${note.content}')`), note.title);
  const cwd = new URL('..', import.meta.url);
  assert.equal(execFileSync('git', ['check-ignore', 'supabase/seed.local.sql'], { cwd, encoding: 'utf8' }).trim(),
    'supabase/seed.local.sql');
});
