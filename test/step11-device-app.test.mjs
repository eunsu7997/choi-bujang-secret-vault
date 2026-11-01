import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { ACCESS_COOKIE } from '../src/session-cookie.mjs';
import { DEVICE_COOKIE, deviceAction, deviceCode, deviceHash } from '../src/device-approval.mjs';
import { call, fakeSupabase, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const sameSite = { 'sec-fetch-site': 'same-origin' };
const raw = async sub => (await studentBearer(sub)).slice('Bearer '.length);

// 메모리 기기 기록: 서버 코드는 대기(pending)만 만들 수 있고, 승인은 시험이 "관리자"로서 직접 바꿉니다.
function memoryDevices() {
  const rows = new Map();
  const key = (owner, hash) => `${owner.kind}:${owner.id}:${hash}`;
  return {
    rows,
    approve: (owner, hash) => rows.set(key(owner, hash), 'approved'),
    store: {
      get: async (owner, hash) => rows.get(key(owner, hash)) ?? null,
      request: async (owner, hash) => { if (!rows.has(key(owner, hash))) rows.set(key(owner, hash), 'pending'); return rows.get(key(owner, hash)); },
    },
  };
}
function setup() {
  const devices = memoryDevices();
  const db = fakeSupabase();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(db), writesEnabled: true,
    getDeviceStore: () => devices.store });
  return { handler, devices, db };
}
const cookie = (token, secret) => ({ cookie: [`${ACCESS_COOKIE}=${token}`, ...(secret ? [`${DEVICE_COOKIE}=${secret}`] : [])].join('; ') });
const secretFrom = result => /__Host-vault_device=([A-Za-z0-9_-]{43});/u.exec([].concat(result.headers.get('set-cookie') ?? []).join(' '))?.[1];

test('before approval the browser gets no notes; the request button only creates a pending record', async () => {
  const { handler, devices } = setup();
  const token = await raw(userA);
  const noDevice = await call(handler, { method: 'GET', url: '/api/notes', headers: cookie(token) });
  assert.deepEqual([noDevice.status, noDevice.body], [403, { error: 'DEVICE_NOT_APPROVED' }]);
  assert.deepEqual((await call(handler, { method: 'GET', url: '/api/device/status', headers: cookie(token) })).body, { state: 'none', approved: false });
  const requested = await call(handler, { method: 'POST', url: '/api/device/request', headers: { ...sameSite, ...cookie(token) }, body: { approved: true } });
  assert.equal(requested.status, 200);
  assert.equal(requested.body.state, 'pending');
  assert.equal(requested.body.approved, false);
  const secret = secretFrom(requested);
  assert.ok(secret, 'device cookie is set');
  assert.match([].concat(requested.headers.get('set-cookie')).join(' '), /HttpOnly; Secure; SameSite=Strict/u);
  assert.equal(requested.body.code, deviceCode(deviceHash(secret)));
  assert.ok(!JSON.stringify(requested.body).includes(secret), 'secret never in body');
  // 버튼을 다시 눌러도, 본문에 approved를 넣어도 승인되지 않습니다.
  await call(handler, { method: 'POST', url: '/api/device/request', headers: { ...sameSite, ...cookie(token, secret) }, body: { status: 'approved' } });
  assert.equal((await call(handler, { method: 'GET', url: '/api/notes', headers: cookie(token, secret) })).status, 403);
  assert.deepEqual([...devices.rows.values()], ['pending']);
});

test('after the server approves this device the existing screen data opens; other devices stay blocked', async () => {
  const { handler, devices } = setup();
  const token = await raw(userA);
  const requested = await call(handler, { method: 'POST', url: '/api/device/request', headers: { ...sameSite, ...cookie(token) } });
  const secret = secretFrom(requested);
  devices.approve({ kind: 'student', id: userA }, deviceHash(secret));
  assert.equal((await call(handler, { method: 'GET', url: '/api/device/status', headers: cookie(token, secret) })).body.approved, true);
  const created = await call(handler, { method: 'POST', url: '/api/notes', headers: { ...sameSite, ...cookie(token, secret) }, body: { title: 't', body: '' } });
  assert.equal(created.status, 201);
  assert.equal((await call(handler, { method: 'GET', url: '/api/notes', headers: cookie(token, secret) })).body.length, 1);
  const other = await call(handler, { method: 'GET', url: '/api/notes', headers: cookie(token, 'x'.repeat(43)) });
  assert.equal(other.status, 403);
});

test('existing protected-request results are kept: anonymous 401, header path unchanged, device store failure closes', async () => {
  const { handler } = setup();
  assert.equal((await call(handler, { method: 'GET', url: '/api/notes' })).status, 401);
  assert.equal((await call(handler, { method: 'GET', url: '/api/device/status' })).status, 401);
  assert.equal((await call(handler, { method: 'GET', url: '/api/notes', headers: { authorization: await studentBearer(userA) } })).status, 200);
  const broken = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(fakeSupabase()), writesEnabled: true,
    getDeviceStore: () => ({ get: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } }) });
  assert.equal((await call(broken, { method: 'GET', url: '/api/notes', headers: cookie(await raw(userA), 'y'.repeat(43)) })).status, 403);
  assert.equal((await call(handler, { method: 'POST', url: '/api/device/status', headers: { ...sameSite, ...cookie(await raw(userA)) } })).status, 405);
  assert.equal((await call(handler, { method: 'POST', url: '/api/device/request', headers: { ...cookie(await raw(userA)), 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('device routes are recognised only for /api/device paths or the internal rewrite', () => {
  assert.equal(deviceAction({ url: '/api/device/status' }), 'status');
  assert.equal(deviceAction({ url: '/api/notes?device=request', query: { device: 'request' } }), 'request');
  assert.equal(deviceAction({ url: '/api/device/approve' }), 'invalid');
  assert.equal(deviceAction({ url: '/api/notes' }), null);
});

test('install manifest, offline page and service worker never claim device trust or cache API data', async () => {
  const manifest = JSON.parse(await read('public/manifest.webmanifest'));
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.name && manifest.short_name && manifest.start_url === '/');
  const html = await read('public/index.html');
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  assert.match(html, /설치\(홈 화면에 추가\)했다고 기기 확인이 끝난 것은 아닙니다/u);
  assert.doesNotMatch(html, /localStorage|indexedDB/iu);
  const sw = await read('public/sw.js');
  assert.match(sw, /startsWith\('\/api\/'\)\) return/u);
  assert.doesNotMatch(sw, /localStorage|indexedDB|token/iu);
  assert.match(await read('public/offline.html'), /오프라인/u);
});

test('device SQL keeps server rows pending-only and approval as an owner action', async () => {
  const sql = await read('supabase/device-approvals.sql');
  for (const needle of ['force row level security', 'revoke all on table public.device_approvals from public, anon, authenticated, service_role',
    'grant select, insert on table public.device_approvals to service_role', 'rows start as pending']) assert.ok(sql.includes(needle), needle);
  assert.doesNotMatch(sql, /grant[^;]*update[^;]*service_role/iu);
  const approve = await read('supabase/device-approve.sql');
  assert.match(approve, /status = 'pending'/u);
  assert.match(approve, /\(select count\(\*\) from target\) = 1/u);
});

test('config is step 11 or later', async () => {
  assert.ok(JSON.parse(await read('aleph.config.json')).step >= 11);
});
