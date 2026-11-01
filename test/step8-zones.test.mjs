import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { instructorIdsFromEnv, zoneRoute } from '../src/zones.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';
import { call, fakeSupabase, judgeBearer, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const teacher = '55555555-5555-4555-8555-555555555555';
const judgeA = '33333333-3333-4333-8333-333333333333';

function setup() {
  const db = fakeSupabase();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(db),
    writesEnabled: true, getInstructorIds: () => instructorIdsFromEnv({ INSTRUCTOR_USER_IDS: teacher }) });
  return { db, handler };
}

// 판정기: 구역·동작·정확한 경로 모양
const ask = async (service, method, path, route, extra = {}) => {
  const { normal } = fixtureRequests();
  const request = { ...normal, requestId: randomUUID(), service, method, path, route, ...extra };
  const response = await decide(request);
  assert.equal(Object.keys(response).sort().join(','), 'decision,reasonCode,requestId,ruleIds,schema');
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)));
  return response;
};

test('decider allows one note by id and notice reads only', async () => {
  for (const [method, path, route] of [['GET', '/notes/demo', 'GET /notes/:id'], ['PUT', '/notes/n-1', 'PUT /notes/:id'],
    ['DELETE', '/notes/x', 'DELETE /notes/:id']]) assert.equal((await ask('notes', method, path, route)).decision, 'allow');
  assert.equal((await ask('notices', 'GET', '/notices', 'GET /notices')).decision, 'allow');
  assert.equal((await ask('notices', 'GET', '/notices/n1', 'GET /notices/:id')).decision, 'allow');
});

test('decider denies note list, notice writes, instructor zone, unknown and function routes', async () => {
  const deny = async (args, reason) => {
    const r = await ask(...args);
    assert.equal(r.decision, 'deny', JSON.stringify(args));
    assert.equal(r.reasonCode, reason, JSON.stringify(args));
    assert.deepEqual(r.ruleIds, ['resource_zone']);
  };
  await deny(['notes', 'GET', '/notes', 'GET /notes'], 'route_not_allowed');
  await deny(['notes', 'POST', '/notes', 'POST /notes'], 'route_not_allowed');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    await deny(['notices', m, '/notices/n1', `${m} /notices/:id`], 'notice_read_only');
  }
  await deny(['instructor', 'GET', '/instructor/m1', 'GET /instructor/:id'], 'instructor_zone_denied');
  await deny(['materials', 'PUT', '/materials/m1', 'PUT /materials/:id'], 'instructor_zone_denied');
  await deny(['unknown', 'GET', '/x', 'GET /x'], 'route_not_allowed');
  await deny(['notes', 'GET', '/notes/export', 'GET /notes/:id'], 'route_not_allowed');
  await deny(['notes', 'GET', '/notes/a/b', 'GET /notes/:id'], 'route_not_allowed');
  await deny(['notes', 'GET', '/notices/n1', 'GET /notices/:id'], 'route_not_allowed');
  await deny(['notes', 'GET', '/notes/demo', 'GET /notes/:id', { queryLength: 8 }], 'route_not_allowed');
  // 미등록 기기는 구역보다 먼저 거부됩니다.
  assert.equal((await ask('notes', 'GET', '/notes/demo', 'GET /notes/:id', { deviceRegistered: false })).reasonCode, 'device_not_registered');
});

test('decider does not narrow note ids to UUID', async () => {
  for (const id of ['demo', 'note-b', 'A1', randomUUID()]) {
    assert.equal((await ask('notes', 'GET', `/notes/${id}`, 'GET /notes/:id')).decision, 'allow', id);
  }
});

test('allowedRoutes lists only decider-allowed routes with methods', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  assert.ok(config.step >= 8);
  for (const entry of config.allowedRoutes) assert.match(entry, /^(GET|PUT|DELETE) \/api\/[a-z]+(\/:id)?$/u);
  assert.ok(!config.allowedRoutes.includes('GET /api/notes'));
  assert.ok(!config.allowedRoutes.some(entry => entry.includes('notices') && !entry.startsWith('GET ')));
});

// 서버 API: 검증된 사용자와 저장된 소유자·강사 권한으로 다시 대조
test('API: anonymous requests to notices and admin path are 401', async () => {
  const { handler } = setup();
  for (const [method, url] of [['GET', '/api/notices'], ['PUT', '/api/admin/notices/notice-class-guide']]) {
    assert.equal((await call(handler, { method, url, body: { title: 'x', body: 'x' } })).status, 401);
  }
});

test('API: students and judge read notices but cannot write them', async () => {
  const { handler } = setup();
  for (const authorization of [await studentBearer(userA), await judgeBearer(judgeA, 'a')]) {
    const headers = { authorization };
    const list = await call(handler, { method: 'GET', headers, url: '/api/notices' });
    assert.equal(list.status, 200);
    assert.ok(list.body.every(item => item.id.startsWith('notice-')));
    const one = await call(handler, { method: 'GET', headers, url: '/api/notices/notice-class-guide' });
    assert.equal(one.status, 200);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const r = await call(handler, { method, headers, url: '/api/notices/notice-class-guide', body: { title: 'x', body: 'x' } });
      assert.deepEqual([r.status, r.body], [405, { error: 'NOTICE_READ_ONLY' }], method);
    }
  }
});

test('API: student test account cannot edit instructor notices even with role in body', async () => {
  const { handler, db } = setup();
  const headers = { authorization: await studentBearer(userA) };
  for (const url of ['/api/admin/notices/notice-class-guide', '/api/notes?zone=admin-notices&id=notice-class-guide']) {
    const r = await call(handler, { method: 'PUT', headers, url, body: { title: 'x', body: 'x', role: 'instructor' } });
    assert.deepEqual([r.status, r.body], [403, { error: 'INSTRUCTOR_ONLY' }], url);
  }
  const judge = await call(handler, { method: 'PUT', headers: { authorization: await judgeBearer(teacher, 'a') },
    url: '/api/admin/notices/notice-class-guide', body: { title: 'x', body: 'x' } });
  assert.equal(judge.status, 403);
  assert.equal(db.calls.length, 0);
  // 서버에 저장된 강사 목록에 있는 사용자만 관리 경로의 강사 확인을 통과합니다(공지 저장소 미연결이라 501).
  const ok = await call(handler, { method: 'PUT', headers: { authorization: await studentBearer(teacher) },
    url: '/api/admin/notices/notice-class-guide', body: { title: 'x', body: 'x' } });
  assert.equal(ok.status, 501);
});

test('API: other users notes stay hidden through direct API calls', async () => {
  const { handler } = setup();
  const a = { authorization: await studentBearer(userA) };
  const b = { authorization: await studentBearer(userB) };
  const created = await call(handler, { method: 'POST', headers: a, body: { title: 'A 메모', body: '비공개' } });
  const id = created.body.id;
  assert.deepEqual((await call(handler, { method: 'GET', headers: b })).body, []);
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const r = await call(handler, { method, headers: b, url: `/api/notes/${id}`, body: { title: 'x', body: 'x' } });
    assert.equal(r.status, 404, method);
  }
  assert.equal((await call(handler, { method: 'GET', headers: a, url: `/api/notes/${id}` })).status, 200);
});

test('zone router rejects malformed notice ids and conflicting tags', () => {
  for (const url of ['/api/notices/%ZZ', '/api/notices/abc', '/api/admin/notices',
    '/api/notes?zone=unknown', '/api/notes?zone=notices&zone=admin-notices']) {
    assert.deepEqual(zoneRoute({ url, query: {} }), { zone: 'invalid' }, url);
  }
  assert.equal(zoneRoute({ url: '/api/notes', query: {} }), null);
  assert.equal(zoneRoute({ url: '/api/notices/..', query: {} }), null); // 정규화되면 메모 경로 검사(400)로 넘어갑니다.
  assert.deepEqual(zoneRoute({ url: '/api/notices', query: {} }), { zone: 'notices', id: undefined });
});
