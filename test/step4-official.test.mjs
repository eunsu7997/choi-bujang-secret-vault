// 4단계 「로그인해도 내 자료만 보이게 합니다」 공식 카드의 확인 항목을 가상 신원으로 재현합니다.
// 로컬 가짜 키·가상 DB 시험이며 실제 학생/심판 인증이나 공식 점수가 아닙니다.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { call, fakeSupabase, judgeBearer, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = 'aaaaaaaa-1111-4111-8111-111111111111';
const userB = 'bbbbbbbb-2222-4222-8222-222222222222';
const judgeA = 'cccccccc-3333-4333-8333-333333333333';
const judgeB = 'dddddddd-4444-4444-8444-444444444444';

// 운영 기본값(writesEnabled: true)과 같은 설정입니다. 아래 소스 검사로 둘이 같은지 확인합니다.
function setup(rows = []) {
  const db = fakeSupabase(rows);
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(db), writesEnabled: true });
  return { db, handler };
}
const path = (id) => `/api/notes/${id}`;
async function create(handler, authorization, title) {
  const r = await call(handler, { method: 'POST', url: '/api/notes', headers: { authorization }, body: { title, body: `${title} 본문` } });
  assert.equal(r.status, 201);
  assert.deepEqual(Object.keys(r.body), ['id']);
  return r.body.id;
}

test('production handler opens owner-scoped writes for students and judges', async () => {
  const source = await readFile(new URL('../api/notes.js', import.meta.url), 'utf8');
  assert.match(source.slice(source.indexOf('const notesHandler = createNotesHandler')), /writesEnabled: true,/u);
});

test('anonymous list is refused with 401 JSON, never HTML or an empty list', async () => {
  const { db, handler } = setup();
  const r = await call(handler, { method: 'GET', url: '/api/notes' });
  assert.deepEqual([r.status, r.body], [401, { error: 'UNAUTHORIZED' }]);
  assert.equal(r.headers.get('www-authenticate'), 'Bearer');
  assert.equal(db.calls.length, 0);
});

test('A and B each read, create, update and delete only their own notes (cases 1, 2, 7)', async () => {
  const { db, handler } = setup();
  for (const [sub, label] of [[userA, 'A'], [userB, 'B']]) {
    const auth = { authorization: await studentBearer(sub) };
    const id = await create(handler, auth.authorization, `시험 ${label}`);
    assert.equal(db.rows.find((row) => row.id === id).owner_id, sub);
    assert.equal(db.rows.find((row) => row.id === id).owner_kind, 'student');
    const one = await call(handler, { method: 'GET', url: path(id), headers: auth });
    assert.deepEqual([one.status, one.body], [200, { id, title: `시험 ${label}`, body: `시험 ${label} 본문` }]);
    const list = await call(handler, { method: 'GET', url: '/api/notes', headers: auth });
    assert.deepEqual(list.body.map((note) => note.id), [id]);
    const put = await call(handler, { method: 'PUT', url: path(id), headers: auth, body: { title: '수정', body: '새 본문' } });
    assert.deepEqual([put.status, put.body], [200, { id, title: '수정', body: '새 본문' }]);
    assert.equal((await call(handler, { method: 'DELETE', url: path(id), headers: auth })).status, 204);
    assert.equal((await call(handler, { method: 'GET', url: path(id), headers: auth })).status, 404);
  }
  assert.equal(db.rows.length, 0);
});

test('A and B cannot read, update or delete each other notes (cases 3-6)', async () => {
  const { db, handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const b = { authorization: await studentBearer(userB) };
  const idA = await create(handler, a.authorization, 'A 메모');
  const idB = await create(handler, b.authorization, 'B 메모');
  const before = JSON.stringify(db.rows);
  for (const [headers, id] of [[a, idB], [b, idA]]) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await call(handler, { method, url: path(id), headers, body: { title: '탈취', body: '' } });
      assert.deepEqual([r.status, r.body], [404, { error: 'NOTE_NOT_FOUND' }], method);
    }
  }
  assert.equal(JSON.stringify(db.rows), before);
  assert.deepEqual((await call(handler, { method: 'GET', url: '/api/notes', headers: b })).body.map((n) => n.id), [idB]);
});

test('owner fields in POST or PUT bodies are refused and never change ownership (cases 8, 9)', async () => {
  const { db, handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const b = { authorization: await studentBearer(userB) };
  for (const body of [{ title: '위조', body: '', owner_id: userA }, { title: '위조', body: '', owner_kind: 'judge' },
    { title: '위조', body: '', ownerId: userA }]) {
    const r = await call(handler, { method: 'POST', url: '/api/notes', headers: b, body });
    assert.deepEqual([r.status, r.body], [400, { error: 'INVALID_NOTE' }], JSON.stringify(body));
  }
  // URL에 owner_id를 붙여도 무시하거나 거절하며, 소유자는 토큰에서만 정합니다.
  const viaQuery = await call(handler, { method: 'GET', url: `/api/notes?owner_id=${userA}`, headers: b });
  assert.ok([200, 400].includes(viaQuery.status));
  if (viaQuery.status === 200) assert.deepEqual(viaQuery.body, []);
  assert.equal(db.rows.length, 0);

  const idB = await create(handler, b.authorization, 'B 메모');
  for (const body of [{ title: '이전', body: '', owner_id: userA }, { title: '이전', body: '', owner_kind: 'judge' }]) {
    const r = await call(handler, { method: 'PUT', url: path(idB), headers: b, body });
    assert.deepEqual([r.status, r.body], [400, { error: 'INVALID_NOTE' }]);
  }
  assert.deepEqual([db.rows[0].owner_id, db.rows[0].owner_kind], [userB, 'student']);
  assert.deepEqual((await call(handler, { method: 'GET', url: '/api/notes', headers: a })).body, []);
});

test('judge-owned notes are writable by their judge and isolated from students and the other judge (case 10)', async () => {
  const { db, handler } = setup();
  const ja = { authorization: await judgeBearer(judgeA, 'a') };
  const jb = { authorization: await judgeBearer(judgeB, 'b') };
  // 학생과 심판이 같은 UUID여도 owner_kind로 분리됩니다.
  const sameUuidStudent = { authorization: await studentBearer(judgeA) };
  const student = { authorization: await studentBearer(userB) };
  const idJ = await create(handler, ja.authorization, '심판 메모');
  assert.deepEqual([db.rows[0].owner_kind, db.rows[0].owner_id], ['judge', judgeA]);
  const before = JSON.stringify(db.rows);
  for (const headers of [jb, sameUuidStudent, student]) {
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await call(handler, { method, url: path(idJ), headers, body: { title: '탈취', body: '' } });
      assert.equal(r.status, 404, method);
    }
    assert.deepEqual((await call(handler, { method: 'GET', url: '/api/notes', headers })).body, []);
  }
  assert.equal(JSON.stringify(db.rows), before);
  const put = await call(handler, { method: 'PUT', url: path(idJ), headers: ja, body: { title: '심판 수정', body: '' } });
  assert.deepEqual([put.status, put.body], [200, { id: idJ, title: '심판 수정', body: '' }]);
  assert.equal((await call(handler, { method: 'DELETE', url: path(idJ), headers: ja })).status, 204);
  assert.equal(db.rows.length, 0);
});

test('a supplied id that already belongs to someone else is a conflict, never a takeover', async () => {
  const { db, handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const b = { authorization: await studentBearer(userB) };
  const idA = await create(handler, a.authorization, 'A 메모');
  const r = await call(handler, { method: 'POST', url: '/api/notes', headers: b, body: { id: idA, title: '덮어쓰기', body: '' } });
  assert.deepEqual([r.status, r.body], [409, { error: 'NOTE_ID_CONFLICT' }]);
  assert.deepEqual([db.rows.length, db.rows[0].owner_id, db.rows[0].title], [1, userA, 'A 메모']);
});
