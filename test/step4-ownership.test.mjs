import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { call, fakeSupabase, judgeBearer, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const judgeA = '33333333-3333-4333-8333-333333333333';
const judgeB = '44444444-4444-4444-8444-444444444444';

function setup() {
  const db = fakeSupabase();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(db), writesEnabled: true });
  return { db, handler };
}
async function createAs(handler, authorization, title) {
  const result = await call(handler, { method: 'POST', headers: { authorization }, body: { title, body: `${title} 내용` } });
  assert.equal(result.status, 201);
  return result.body.id;
}

test('every read, update and delete query is scoped by owner_kind and owner_id', async () => {
  const { db, handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const id = await createAs(handler, a.authorization, '시험 A');
  await call(handler, { method: 'GET', headers: a });
  await call(handler, { method: 'GET', headers: a, query: { id } });
  await call(handler, { method: 'PUT', headers: a, query: { id }, body: { title: '시험 A', body: '바뀜' } });
  await call(handler, { method: 'DELETE', headers: a, query: { id } });
  const scoped = db.calls.filter((item) => item.op !== 'insert');
  assert.equal(scoped.length, 4);
  for (const item of scoped) {
    assert.ok(item.filters.includes('owner_kind') && item.filters.includes('owner_id'), JSON.stringify(item));
  }
  assert.deepEqual(db.calls.find((item) => item.op === 'insert').filters, []);
});

test('user B cannot list, read, update or delete user A notes, and learns nothing from the reply', async () => {
  const { db, handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const b = { authorization: await studentBearer(userB) };
  const id = await createAs(handler, a.authorization, '시험 A');
  const before = JSON.stringify(db.rows);

  assert.deepEqual((await call(handler, { method: 'GET', headers: b })).body, []);
  const missing = randomUUID();
  for (const [method, body] of [['GET'], ['PUT', { title: '탈취', body: '' }], ['DELETE']]) {
    const other = await call(handler, { method, headers: b, query: { id }, body });
    const none = await call(handler, { method, headers: b, query: { id: missing }, body });
    assert.deepEqual([other.status, other.body], [404, { error: 'NOTE_NOT_FOUND' }], method);
    // 남의 메모와 없는 메모의 응답이 완전히 같아야 존재 여부가 새지 않습니다.
    assert.deepEqual([other.status, other.body], [none.status, none.body], method);
  }
  // 대문자 UUID로 바꿔도 같은 규칙이 적용됩니다.
  const upper = await call(handler, { method: 'DELETE', headers: b, query: { id: id.toUpperCase() } });
  assert.equal(upper.status, 404);
  assert.equal(JSON.stringify(db.rows), before);

  const own = await call(handler, { method: 'GET', headers: a, query: { id: id.toUpperCase() } });
  assert.deepEqual(own.body, { id, title: '시험 A', body: '시험 A 내용' });
});

test('request bodies cannot choose or change the owner', async () => {
  const { db, handler } = setup();
  const b = { authorization: await studentBearer(userB) };
  const id = await createAs(handler, (await studentBearer(userA)), '시험 A');
  for (const body of [{ title: '주입', body: '', owner_id: userB }, { title: '주입', body: '', owner_kind: 'judge' }, { title: '주입', body: '', id: 'invalid' }]) {
    const created = await call(handler, { method: 'POST', headers: b, body });
    assert.deepEqual([created.status, created.body], [400, { error: 'INVALID_NOTE' }]);
  }
  const mine = await createAs(handler, b.authorization, '시험 B');
  const moved = await call(handler, { method: 'PUT', headers: b, query: { id: mine }, body: { owner_id: userA } });
  assert.equal(moved.status, 400);
  assert.deepEqual(db.rows.map((row) => [row.id === id ? 'A' : 'B', row.owner_kind, row.owner_id]),
    [['A', 'student', userA], ['B', 'student', userB]]);
});

test('student and judge owners are separate even when the user ID is the same', async () => {
  const { db, handler } = setup();
  const studentNote = await createAs(handler, await studentBearer(userA), '학생 메모');
  // 심판 토큰의 sub가 학생 ID와 같아도 학생 메모에 닿지 않아야 합니다.
  const sameIdJudge = { authorization: await judgeBearer(userA, 'a') };
  assert.deepEqual((await call(handler, { method: 'GET', headers: sameIdJudge })).body, []);
  assert.equal((await call(handler, { method: 'GET', headers: sameIdJudge, query: { id: studentNote } })).status, 404);
  assert.equal((await call(handler, { method: 'DELETE', headers: sameIdJudge, query: { id: studentNote } })).status, 404);
  const judgeNote = await createAs(handler, sameIdJudge.authorization, '심판 메모');
  assert.deepEqual(db.rows.find((row) => row.id === judgeNote).owner_kind, 'judge');
  const studentView = await call(handler, { method: 'GET', headers: { authorization: await studentBearer(userA) } });
  assert.deepEqual(studentView.body.map((note) => note.id), [studentNote]);
});

test('judge identity a and identity b cannot touch each other notes', async () => {
  const { handler } = setup();
  const ja = { authorization: await judgeBearer(judgeA, 'a') };
  const jb = { authorization: await judgeBearer(judgeB, 'b') };
  const id = await createAs(handler, ja.authorization, '심판 a 메모');
  assert.deepEqual((await call(handler, { method: 'GET', headers: jb })).body, []);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const result = await call(handler, { method, headers: jb, query: { id }, body: { title: '탈취', body: '' } });
    assert.equal(result.status, 404, method);
  }
  assert.deepEqual((await call(handler, { method: 'GET', headers: ja })).body.map((note) => note.id), [id]);
});

test('responses never carry owner fields', async () => {
  const { handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const id = await createAs(handler, a.authorization, '시험 A');
  for (const request of [{ method: 'GET' }, { method: 'GET', query: { id } },
    { method: 'PUT', query: { id }, body: { title: '시험 A2', body: '' } }]) {
    const result = await call(handler, { headers: a, ...request });
    assert.doesNotMatch(JSON.stringify(result.body), /owner_|created_at/u);
  }
});

test('principals without a known kind or a UUID subject are refused', async () => {
  const { db } = setup();
  for (const principal of [{ kind: 'admin', userId: userA }, { kind: 'student', userId: 'admin' },
    { kind: 'judge' }, { kind: 'student', userId: `${userA} ` }, null]) {
    const handler = createNotesHandler({ getVerifier: () => async () => principal,
      getStore: () => supabaseNotesStore(db), writesEnabled: true });
    const result = await call(handler, { method: 'GET', headers: { authorization: 'Bearer a.b.c' } });
    assert.deepEqual([result.status, result.body], [401, { error: 'UNAUTHORIZED' }], JSON.stringify(principal));
  }
  assert.equal(db.calls.length, 0);
});

test('ownership SQL adds owner_kind and server-only write grants without opening anon access', async () => {
  const sql = (await readFile(new URL('../supabase/notes-ownership.sql', import.meta.url), 'utf8')).replace(/--.*$/gmu, '');
  assert.match(sql, /add column if not exists owner_kind text not null default 'student'/u);
  assert.match(sql, /check \(owner_kind in \('student', 'judge'\)\)/u);
  assert.match(sql, /grant select, insert, update, delete on table public\.notes to service_role;/u);
  assert.match(sql, /revoke all on table public\.notes from public, anon, authenticated;/u);
  assert.doesNotMatch(sql, /create policy|to (anon|authenticated|public)\b|disable row level security|references\s+(?:auth|public)\./iu);
});

test('query arrays, lists and padded ids cannot widen access to another user note', async () => {
  const { db, handler } = setup();
  const a = await studentBearer(userA);
  const b = { authorization: await studentBearer(userB) };
  const id = await createAs(handler, a, '시험 A');
  const mine = await createAs(handler, b.authorization, '시험 B');
  const before = JSON.stringify(db.rows);
  for (const query of [{ id: [id] }, { id: [mine, id] }, { id: `${mine},${id}` }, { id: ` ${id}` },
    { id: `${id}%00` }, { id: `in.(${id})` }, { id: '*' }, { id: '' }]) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const result = await call(handler, { method, headers: b, query, body: { title: '탈취', body: '' } });
      assert.deepEqual([result.status, result.body], [400, { error: 'INVALID_NOTE_ID' }], `${method} ${JSON.stringify(query)}`);
    }
  }
  assert.equal(JSON.stringify(db.rows), before);
});

test('ownership SQL is transactional with prechecks, and rollback refuses to merge judge notes', async () => {
  const read = async (name) => (await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8')).replace(/--.*$/gmu, '');
  const apply = await read('notes-ownership.sql');
  assert.ok(apply.indexOf('begin;') < apply.indexOf('alter table') && apply.indexOf('commit;') > apply.lastIndexOf('revoke all'));
  assert.match(apply, /raise exception/u);
  assert.doesNotMatch(apply, /\b(delete from|truncate\s+(?:table\s+)?(?:public\.)?notes|drop table|drop column)\b/iu);
  const rollback = await read('notes-ownership-rollback.sql');
  assert.ok(rollback.indexOf('begin;') < rollback.indexOf('raise exception') && rollback.indexOf('raise exception') < rollback.indexOf('drop column'));
  // NULL인 owner_kind도 놓치지 않도록 is distinct from으로 검사합니다.
  assert.match(rollback, /owner_kind is distinct from 'student'/u);
  assert.match(rollback, /revoke all on table public\.notes from public, anon, authenticated;/u);
  assert.doesNotMatch(rollback, /\b(delete from|truncate\s+(?:table\s+)?(?:public\.)?notes|drop table|disable row level security)\b/iu);
});

test('CRUD page sends the login token, renders text only and never uses blocking dialogs', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(page, /credentials: 'same-origin'/u);
  assert.doesNotMatch(page, /Authorization|access_token/u);
  assert.match(page, /encodeURIComponent\(id\)/u);
  assert.match(page, /id="note-title" maxlength="200" required/u);
  assert.match(page, /id="note-content" maxlength="10000"/u);
  assert.match(page, /title\.textContent = note\.title;/u);
  assert.match(page, /403: '요청이 거절되었습니다/u);
  assert.doesNotMatch(page, /innerHTML|insertAdjacentHTML|outerHTML|document\.write|\b(alert|confirm|prompt)\(/u);
  assert.doesNotMatch(page, /owner_id|owner_kind/u);
});

test('ownership SQL keeps dollar quotes balanced and enforces owner_kind even on an existing column', async () => {
  for (const name of ['notes-ownership.sql', 'notes-ownership-rollback.sql']) {
    const sql = await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
    const count = (pattern) => (sql.match(pattern) ?? []).length;
    assert.equal(count(/^do \$\$$/gmu), count(/^end \$\$;$/gmu), name);
    assert.equal(count(/^end \$;$/gmu), 0, name);
    assert.equal(count(/^begin;$/gmu), 1, name);
    assert.equal(count(/^commit;$/gmu), 1, name);
  }
  const apply = (await readFile(new URL('../supabase/notes-ownership.sql', import.meta.url), 'utf8')).replace(/--.*$/gmu, '');
  assert.match(apply, /update public\.notes set owner_kind = 'student' where owner_kind is null;/u);
  assert.match(apply, /alter column owner_kind set not null;/u);
  assert.match(apply, /data_type <> 'text'/u);
  const rollback = await readFile(new URL('../supabase/notes-ownership-rollback.sql', import.meta.url), 'utf8');
  assert.match(rollback, /owner_kind is distinct from 'student'/u);
});

test('backup SQL copies into a non-exposed schema with RLS on and public access revoked', async () => {
  const raw = await readFile(new URL('../supabase/notes-backup.sql', import.meta.url), 'utf8');
  const sql = raw.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
  assert.match(sql, /create table backup\.notes_before_ownership as table public\.notes;/u);
  assert.match(sql, /revoke all on schema backup from public, anon, authenticated;/u);
  assert.match(sql, /alter table backup\.notes_before_ownership enable row level security;/u);
  assert.match(sql, /revoke all on table backup\.notes_before_ownership from public, anon, authenticated;/u);
  assert.equal((sql.match(/^do \$\$$/gmu) ?? []).length, (sql.match(/^end \$\$;$/gmu) ?? []).length);
  // 실행 부분에는 원본을 지우거나 바꾸는 문장이 없어야 합니다(복원 예시는 주석).
  assert.doesNotMatch(sql, /\b(delete from|truncate|drop table|update public|insert into public|grant)\b/iu);
});

test('backup and ownership SQL refuse to run as a role that RLS would blind, and backup refuses an empty copy', async () => {
  for (const name of ['notes-backup.sql', 'notes-ownership.sql', 'notes-ownership-rollback.sql']) {
    const sql = await readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
    assert.match(sql, /rolname = current_user and \(rolsuper or rolbypassrls\)/u, name);
  }
  const backup = await readFile(new URL('../supabase/notes-backup.sql', import.meta.url), 'utf8');
  assert.match(backup, /from backup\.notes_before_ownership\) = 0 then/u);
  const ownership = await readFile(new URL('../supabase/notes-ownership.sql', import.meta.url), 'utf8');
  assert.ok(ownership.indexOf("to_regclass('backup.notes_before_ownership') is null") < ownership.indexOf('alter table'));
});


test('rollback fails closed before locking or changing schema when its current role cannot bypass FORCE RLS', async () => {
  const sql = (await readFile(new URL('../supabase/notes-ownership-rollback.sql', import.meta.url), 'utf8'))
    .replace(/--.*$/gmu, '');
  const guard = sql.indexOf('if not exists (select 1 from pg_catalog.pg_roles');
  const refusal = sql.indexOf("using errcode = '42501';");
  const lock = sql.indexOf('lock table public.notes in access exclusive mode;');
  const judgeCheck = sql.indexOf("owner_kind is distinct from 'student'");
  const firstChange = sql.indexOf('drop index');
  assert.ok(sql.indexOf('begin;') < guard && guard < refusal && refusal < lock);
  assert.ok(lock < judgeCheck && judgeCheck < firstChange);
  assert.match(sql.slice(guard, refusal), /rolname = current_user and \(rolsuper or rolbypassrls\)/u);
  assert.doesNotMatch(sql, /exception\s+when|set\s+(?:local\s+)?role|set\s+session\s+authorization/iu);
});

test('rollback never rewrites memo data or owner IDs and refuses judge, unknown, and null owner kinds', async () => {
  const sql = (await readFile(new URL('../supabase/notes-ownership-rollback.sql', import.meta.url), 'utf8'))
    .replace(/--.*$/gmu, '');
  assert.match(sql, /if exists[\s\S]*owner_kind is distinct from 'student'[\s\S]*raise exception/u);
  assert.doesNotMatch(sql, /\b(?:insert\s+into|update\s+public\.notes|delete\s+from|truncate\s+(?:table\s+)?(?:public\.)?notes|drop\s+table)\b/iu);
  assert.doesNotMatch(sql, /drop\s+column\s+(?:if\s+exists\s+)?(?:id|owner_id|title|content|created_at)\b/iu);
  assert.match(sql, /alter table public\.notes drop column if exists owner_kind;/u);
  assert.match(sql, /create index if not exists notes_owner_id_idx on public\.notes \(owner_id\);/u);
  assert.match(sql, /revoke insert, update, delete on table public\.notes from service_role;/u);
  assert.match(sql, /force row level security;/u);
  assert.equal((sql.match(/\bcommit;/gu) ?? []).length, 1);
});
