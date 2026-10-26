import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
const sql = async name => (await readFile(new URL('../supabase/' + name, import.meta.url), 'utf8')).replace(/--.*$/gmu, '');

test('backup blocks concurrent writes and migration refuses any stale backup before changing data', async () => {
  const backup = await sql('notes-backup.sql');
  assert.ok(backup.indexOf('lock table public.notes in share mode;') < backup.indexOf('create table backup.notes_before_ownership'));
  const migration = await sql('notes-ownership.sql');
  assert.ok(migration.indexOf('lock table public.notes in access exclusive mode;') < migration.indexOf('except all'));
  assert.equal((migration.match(/except all/gu) ?? []).length, 2);
  assert.ok(migration.indexOf('except all') < migration.indexOf('alter table'));
  assert.match(migration, /id, owner_id, title, content, created_at from public\.notes/u);
  assert.doesNotMatch(migration, /\bdelete from|\btruncate public|\bdrop table/iu);
});

test('server role cannot retain destructive table privileges after applying or rolling back ownership', async () => {
  for (const name of ['notes-ownership.sql', 'notes-ownership-rollback.sql']) {
    assert.match(await sql(name), /revoke truncate, references, trigger on table public\.notes from service_role;/u);
  }
});
