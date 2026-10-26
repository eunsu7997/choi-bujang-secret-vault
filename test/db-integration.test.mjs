import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { runDbIntegration } from '../scripts/db-integration.mjs';
import { fakeSupabase } from './helpers/auth-fixture.mjs';

const quiet = () => {};

test('integration check passes against a correct mock DB and removes every synthetic row', async () => {
  const existing = { id: 'keep', owner_kind: 'student', owner_id: '00000000-0000-0000-0000-000000000000', title: 't', content: '' };
  const db = fakeSupabase([existing]);
  const results = await runDbIntegration({ client: db, checkOnly: false, directRead: async () => 401, log: quiet });
  assert.ok(results.length >= 10);
  assert.deepEqual(results.filter((item) => !item.ok), []);
  assert.deepEqual(db.rows, [existing]);
});

test('integration check stops before writing when the ownership SQL is not applied', async () => {
  const db = fakeSupabase([], { missingColumn: 'owner_kind' });
  const results = await runDbIntegration({ client: db, checkOnly: false, log: quiet });
  assert.deepEqual(results, [{ name: '소유권 스키마(owner_kind) 적용', ok: false }]);
  assert.ok(db.calls.every((item) => item.op === 'select'));
});

test('integration check stops before writing when public REST is open', async () => {
  const db = fakeSupabase();
  const results = await runDbIntegration({ client: db, checkOnly: false, directRead: async () => 200, log: quiet });
  assert.deepEqual(results.at(-1), { name: '공개 키 직접 조회 거절', ok: false });
  assert.ok(db.calls.every((item) => item.op === 'select'));
  assert.deepEqual(db.rows, []);
});

test('integration check stops on owner isolation failure and still cleans up synthetic rows', async () => {
  const db = fakeSupabase([], { ignoreOwnerFilters: true });
  const results = await runDbIntegration({ client: db, checkOnly: false, directRead: async () => 401, log: quiet });
  assert.ok(results.some((item) => item.name === 'B 목록에 A 메모 없음' && !item.ok));
  assert.ok(!results.some((item) => item.name === 'A 메모 수정'));
  assert.deepEqual(db.rows, []);
  assert.deepEqual(results.at(-1), { name: '시험 행 잔존 없음', ok: true });
});

test('check-only mode never writes', async () => {
  const db = fakeSupabase();
  await runDbIntegration({ client: db, checkOnly: true, log: quiet });
  assert.ok(db.calls.every((item) => item.op === 'select'));
});

test('CLI refuses to run without an explicit mode or server settings, without network', () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('SUPABASE_')));
  for (const args of [[], ['--check-only', '--yes-write-test-rows'], ['--check-only']]) {
    const result = spawnSync(process.execPath, ['scripts/db-integration.mjs', ...args],
      { cwd: new URL('..', import.meta.url), env, encoding: 'utf8' });
    assert.equal(result.status, 1, args.join(' '));
    assert.match(result.stderr, /^중단: /u);
  }
});

test('a missing public-key check and a failed cleanup are both reported as failures', async () => {
  const noKey = await runDbIntegration({ client: fakeSupabase(), checkOnly: true, log: quiet });
  assert.deepEqual(noKey.find((item) => item.name === '공개 키 직접 조회 거절'), { name: '공개 키 직접 조회 거절', ok: false });

  const db = fakeSupabase();
  const failingCleanup = {
    from(table) {
      const query = db.from(table);
      query.in = () => ({ select: async () => ({ data: null, error: { code: 'XX000' } }) });
      return query;
    },
  };
  const results = await runDbIntegration({ client: failingCleanup, checkOnly: false, directRead: async () => 401, log: quiet });
  assert.deepEqual(results.at(-1), { name: '시험 행 정리', ok: false });
});


test('missing public-key validation cannot fall through into writes', async () => {
  const db = fakeSupabase();
  const results = await runDbIntegration({ client: db, checkOnly: false, log: quiet });
  assert.equal(results.at(-1).ok, false);
  assert.ok(db.calls.every((item) => item.op === 'select'));
});


test('successful cleanup status cannot hide residual synthetic rows', async () => {
  const db = fakeSupabase();
  const client = { from(table) {
    const query = db.from(table);
    const remove = query.delete;
    const filter = query.in;
    let deleting = false;
    query.delete = () => { deleting = true; return remove(); };
    query.in = (column, values) => deleting ? filter(column, values)
      : Promise.resolve({ data: [{ id: 'synthetic-residue' }], error: null });
    return query;
  } };
  const results = await runDbIntegration({ client, checkOnly: false, directRead: async () => 401, log: quiet });
  assert.deepEqual(results.at(-1), { name: '시험 행 잔존 없음', ok: false });
});
