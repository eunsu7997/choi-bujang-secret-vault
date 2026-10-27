// 4단계 SQL 파일의 정적 점검입니다. 실제 DB 적용·권한 결과가 아닙니다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = async (name) => (await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8')).replace(/--.*$/gmu, '');

test('step 4 RLS SQL revokes first, grants four privileges to authenticated only, and scopes all four commands', async () => {
  const sql = await read('notes-step4-rls.sql');
  const revoke = sql.indexOf('revoke all on table public.notes from public, anon, authenticated;');
  const grant = sql.indexOf('grant select, insert, update, delete on table public.notes to authenticated;');
  assert.ok(revoke >= 0 && grant > revoke);
  assert.doesNotMatch(sql, /grant[^;]*\bto\s+(anon|public)\b/iu);
  assert.doesNotMatch(sql, /disable row level security|\bdrop table\b|^\s*truncate\b|\bdelete from\b/imu);
  const own = "auth.uid() = owner_id and owner_kind = 'student'";
  assert.match(sql, new RegExp(`for select to authenticated\\s+using \\(${own.replace(/[()]/gu, '\\$&')}\\);`, 'u'));
  assert.match(sql, new RegExp(`for insert to authenticated\\s+with check \\(${own.replace(/[()]/gu, '\\$&')}\\);`, 'u'));
  assert.match(sql, new RegExp(`for update to authenticated\\s+using \\(${own.replace(/[()]/gu, '\\$&')}\\)\\s+with check \\(${own.replace(/[()]/gu, '\\$&')}\\);`, 'u'));
  assert.match(sql, new RegExp(`for delete to authenticated\\s+using \\(${own.replace(/[()]/gu, '\\$&')}\\);`, 'u'));
  // public.notes 이외의 테이블은 바꾸지 않습니다.
  for (const match of sql.matchAll(/\b(?:alter table|on table|on)\s+([a-z_]+\.[a-z_]+)/giu)) assert.equal(match[1], 'public.notes');
});

test('step 4 rollback returns to the step 3 state without touching data', async () => {
  const sql = await read('notes-step4-rls-rollback.sql');
  assert.match(sql, /revoke all on table public\.notes from public, anon, authenticated;/u);
  assert.equal((sql.match(/drop policy if exists notes_\w+_own on public\.notes;/gu) ?? []).length, 4);
  assert.doesNotMatch(sql, /\bdelete from\b|\btruncate\b|\bdrop table\b|\bgrant\b|disable row level security/iu);
});

test('step 4 owner SQL keeps backups read-only, refuses silent reassignment and stores no real emails', async () => {
  const raw = await readFile(new URL('../supabase/notes-step4-owners.sql', import.meta.url), 'utf8');
  const sql = raw.replace(/--.*$/gmu, '');
  assert.match(sql, /'A_EMAIL_HERE'/u);
  assert.match(sql, /'B_EMAIL_HERE'/u);
  assert.doesNotMatch(raw, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu);
  assert.match(sql, /false as allow_reassign/u);
  assert.match(sql, /on conflict \(id\) do nothing/u);
  assert.doesNotMatch(sql, /(?:update|insert into|delete from|truncate|drop table)\s+backup\./iu);
  assert.doesNotMatch(sql, /\bdelete from\b|\btruncate\b|\bgrant\b|\brevoke\b|create policy/iu);
});

test('step 4 check SQL never persists changes', async () => {
  const sql = await read('notes-step4-check.sql');
  assert.match(sql.trimEnd(), /rollback;$/u);
  assert.doesNotMatch(sql, /^\s*commit\s*;/imu);
});
