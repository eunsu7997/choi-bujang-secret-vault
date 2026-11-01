import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { RESTORE_TARGET, contentHash } from '../src/restore.mjs';
import { zoneRoute } from '../src/zones.mjs';
import { SNAPSHOT_DIR, diffPolicy, drill, makeTestCopy, readLivePolicy, restorePolicy, tamper, verifySnapshot } from '../scripts/policy-backup.mjs';
import { call, fakeSupabase, judgeBearer, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';

// 제작 1·2: 안전 정책 사본
test('verified policy snapshot matches the live safety policy', () => {
  const { texts } = verifySnapshot();
  assert.deepEqual(texts, readLivePolicy());
});

test('missing or tampered snapshot stops before diff or restore', () => {
  const broken = mkdtempSync(join(tmpdir(), 'snap-'));
  try {
    assert.throws(() => verifySnapshot(broken), /사본/u);
    cpSync(SNAPSHOT_DIR, broken, { recursive: true });
    writeFileSync(join(broken, 'decider.mjs'), `${readFileSync(join(broken, 'decider.mjs'), 'utf8')}// x\n`);
    assert.throws(() => verifySnapshot(broken), /해시/u);
    assert.throws(() => restorePolicy(broken, { yes: true, dir: broken }), /해시/u);
  } finally { rmSync(broken, { recursive: true, force: true }); }
});

test('tampered test policy shows only the changed line, restores only with --yes, and keeps audit and other rules', () => {
  const testDir = makeTestCopy();
  try {
    tamper(testDir);
    const plan = diffPolicy(testDir);
    assert.equal(plan.changes.length, 1);
    assert.equal(plan.changes[0].name, 'decider.mjs');
    assert.equal(plan.changes[0].added.length, 1);
    assert.equal(restorePolicy(testDir).applied, false);
    assert.equal(diffPolicy(testDir).changes.length, 1);
    assert.equal(restorePolicy(testDir, { yes: true }).applied, true);
    assert.equal(diffPolicy(testDir).changes.length, 0);
    assert.equal(readFileSync(join(testDir, 'audit.log'), 'utf8').trim().split('\n').length, 2);
    assert.ok(existsSync(join(testDir, 'other-service.rules')));
  } finally { rmSync(testDir, { recursive: true, force: true }); }
});

test('drill: list route opened by tamper is denied again, own note read stays allowed', async () => {
  const result = await drill(() => {});
  assert.deepEqual(result.tampered, { list: 'allow', own: 'allow' });
  assert.deepEqual(result.restored, { list: 'deny', own: 'allow' });
  assert.equal(result.otherKept, true);
});

// 제작 3: B 메모 한 건 복원 경로
function fakeRestorer(pointOwner = userB) {
  const calls = [];
  return { calls, restore: async (id, actor) => {
    calls.push({ id, actor });
    if (id !== RESTORE_TARGET.id) return { status: 'missing' };
    if (!(actor.kind === 'judge' || (actor.kind === 'student' && actor.id === pointOwner))) return { status: 'forbidden' };
    return { status: 'restored', action: 'updated', id, owner_kind: 'student', owner_match: true, content_sha256: RESTORE_TARGET.contentSha256 };
  } };
}
function setup(restorer = fakeRestorer()) {
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(fakeSupabase()),
    writesEnabled: true, getRestorer: () => restorer });
  return { handler, restorer };
}
const url = `/api/restore/${RESTORE_TARGET.id}`;

test('restore target hash is sha256(title + newline + content)', () => {
  assert.equal(contentHash(RESTORE_TARGET.title, RESTORE_TARGET.content), RESTORE_TARGET.contentSha256);
});

test('restore route: anonymous 401, wrong method 405, bad id 400', async () => {
  const { handler, restorer } = setup();
  assert.equal((await call(handler, { method: 'POST', url })).status, 401);
  const b = { authorization: await studentBearer(userB) };
  assert.equal((await call(handler, { method: 'GET', headers: b, url })).status, 405);
  assert.equal((await call(handler, { method: 'POST', headers: b, url: '/api/restore/not-a-uuid' })).status, 400);
  assert.equal(restorer.calls.length, 0);
});

test('restore route: owner B or judge restores the one note; A is refused; unknown id is 404', async () => {
  const { handler, restorer } = setup();
  const ok = await call(handler, { method: 'POST', headers: { authorization: await studentBearer(userB) }, url });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { id: RESTORE_TARGET.id, action: 'updated', ownerKind: 'student', ownerMatch: true, contentSha256: RESTORE_TARGET.contentSha256 });
  assert.equal((await call(handler, { method: 'POST', headers: { authorization: await judgeBearer(userA, 'b') }, url })).status, 200);
  const a = await call(handler, { method: 'POST', headers: { authorization: await studentBearer(userA) }, url, body: { role: 'admin' } });
  assert.deepEqual([a.status, a.body], [403, { error: 'RESTORE_FORBIDDEN' }]);
  const other = await call(handler, { method: 'POST', headers: { authorization: await studentBearer(userB) }, url: '/api/restore/11111111-2222-4333-8444-555555555555' });
  assert.equal(other.status, 404);
  // 복원 함수에는 검증된 토큰의 신원만 넘어갑니다(본문 role 무시).
  assert.deepEqual(restorer.calls[2].actor, { kind: 'student', id: userA });
});

test('restore route errors never leak details', async () => {
  const { handler } = setup({ restore: async () => { throw Object.assign(new Error('x'), { code: 'P0001' }); } });
  const r = await call(handler, { method: 'POST', headers: { authorization: await studentBearer(userB) }, url });
  assert.deepEqual([r.status, r.body], [502, { error: 'RESTORE_FAILED' }]);
});

test('zone router: restore needs a UUID and the rewrite tag maps to the same zone', () => {
  assert.deepEqual(zoneRoute({ url, query: {} }), { zone: 'restore', id: RESTORE_TARGET.id });
  assert.deepEqual(zoneRoute({ url: `/api/notes?zone=restore&id=${RESTORE_TARGET.id.toUpperCase()}`, query: {} }), { zone: 'restore', id: RESTORE_TARGET.id });
  assert.deepEqual(zoneRoute({ url: '/api/restore', query: {} }), { zone: 'invalid' });
});

test('restore SQL compares id, owner and content hash and keeps audit append-only', async () => {
  const sql = await readFile(new URL('../supabase/notes-step10-restore-point.sql', import.meta.url), 'utf8');
  for (const needle of ['restore_point_hash_mismatch', 'restore_verify_failed', 'owner_mismatch', 'append-only',
    'force row level security', "revoke all on table public.notes_restore_point from public, anon, authenticated",
    'grant execute on function public.restore_note_from_point(uuid, text, uuid) to service_role', RESTORE_TARGET.id,
    RESTORE_TARGET.title, RESTORE_TARGET.content]) assert.ok(sql.includes(needle), needle);
  assert.doesNotMatch(sql, /delete from public\.notes|truncate public\.notes|drop table/iu);
  const check = await readFile(new URL('../supabase/notes-step10-check.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(check, /^\s*(insert|update|delete|grant|revoke|alter|drop|create|begin|commit)\b/imu);
});

test('config names the restore route and step 10', async () => {
  const config = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
  assert.ok(config.step >= 10);
  assert.equal(config.restoreRoute, `/api/restore/${RESTORE_TARGET.id}`);
});
