// 5단계 가점: 화면 로그인을 서버 함수로 옮긴 부분의 로컬 시험입니다. 가상 키·가짜 Supabase이며 실제 로그인이 아닙니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotesHandler, supabaseNotesStore } from '../api/notes.js';
import { authAction, createAuthHandler, createLimiter } from '../src/auth-handler.mjs';
import { ACCESS_COOKIE, REFRESH_COOKIE, readCookies, sameOrigin } from '../src/session-cookie.mjs';
import { call, fakeSupabase, judgeBearer, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = 'aaaaaaaa-1111-4111-8111-111111111111';
const userB = 'bbbbbbbb-2222-4222-8222-222222222222';
const HOST = 'vault.example.vercel.app';
const sameSite = { host: HOST, origin: `https://${HOST}`, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const raw = async (sub) => (await studentBearer(sub)).slice('Bearer '.length);

function fakeAuth({ password = 'right', refreshTo = null } = {}) {
  const calls = [];
  return {
    calls,
    publicAuth: () => ({
      async signInWithPassword({ password: given }) {
        calls.push('signIn');
        return given === password
          ? { data: { session: { access_token: await raw(userA), refresh_token: 'rt-A-1', expires_in: 3600 } }, error: null }
          : { data: { session: null }, error: { message: 'Invalid login credentials' } };
      },
      async refreshSession({ refresh_token }) {
        calls.push(`refresh:${refresh_token}`);
        return refreshTo
          ? { data: { session: { access_token: await raw(refreshTo), refresh_token: 'rt-A-2', expires_in: 3600 } }, error: null }
          : { data: { session: null }, error: { message: 'invalid' } };
      },
    }),
    adminAuth: () => ({ admin: { async signOut(token, scope) { calls.push(`signOut:${scope}`); return { error: null }; } } }),
  };
}

function authSetup(options) {
  const clients = fakeAuth(options);
  const handler = createAuthHandler({ getClients: () => clients, getVerifier: () => verify, limiter: createLimiter() });
  return { clients, handler };
}

const cookieHeader = (cookies) => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
const setCookies = (result) => [].concat(result.headers.get('set-cookie') ?? []);

test('login sets HttpOnly Secure SameSite=Strict host cookies and returns no token to the page', async () => {
  const { handler } = authSetup();
  const r = await call(handler, { method: 'POST', url: '/api/auth/login', headers: sameSite,
    body: { email: 'a@test.invalid', password: 'right' } });
  assert.deepEqual([r.status, r.body], [200, { signedIn: true, userId: userA }]);
  const cookies = setCookies(r);
  assert.equal(cookies.length, 2);
  for (const c of cookies) {
    assert.match(c, /^__Host-vault_(at|rt)=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Strict$/u);
  }
  assert.doesNotMatch(JSON.stringify(r.body), /eyJ|rt-A/u);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('login failures share one message, are rate limited, and bad input or cross-origin is refused', async () => {
  const { handler, clients } = authSetup();
  for (let i = 0; i < 5; i++) {
    const r = await call(handler, { method: 'POST', url: '/api/auth/login', headers: sameSite,
      body: { email: 'a@test.invalid', password: 'wrong' } });
    assert.deepEqual([r.status, r.body], [401, { error: 'LOGIN_FAILED' }]);
    assert.equal(setCookies(r).length, 0);
  }
  const limited = await call(handler, { method: 'POST', url: '/api/auth/login', headers: sameSite,
    body: { email: 'a@test.invalid', password: 'right' } });
  assert.deepEqual([limited.status, limited.body], [429, { error: 'TOO_MANY_ATTEMPTS' }]);
  assert.equal(clients.calls.filter((c) => c === 'signIn').length, 5);

  const cross = await call(handler, { method: 'POST', url: '/api/auth/login',
    headers: { ...sameSite, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, body: { email: 'b@test.invalid', password: 'right' } });
  assert.deepEqual([cross.status, cross.body], [403, { error: 'CROSS_ORIGIN_REJECTED' }]);
  for (const body of [{ email: 'b@test.invalid' }, { email: 'x', password: 'p' }, { email: 'b@test.invalid', password: 'p', extra: 1 }]) {
    const bad = await call(handler, { method: 'POST', url: '/api/auth/login', headers: sameSite, body });
    assert.equal(bad.status, 400);
  }
  const wrongMethod = await call(handler, { method: 'GET', url: '/api/auth/login', headers: sameSite });
  assert.equal(wrongMethod.status, 405);
  assert.equal((await call(handler, { method: 'GET', url: '/api/auth/unknown', headers: sameSite })).status, 404);
});

test('session restores from the access cookie, refreshes from the refresh cookie, and otherwise reports signed out', async () => {
  const valid = authSetup();
  const ok = await call(valid.handler, { method: 'GET', url: '/api/auth/session',
    headers: { cookie: cookieHeader({ [ACCESS_COOKIE]: await raw(userA) }) } });
  assert.deepEqual([ok.status, ok.body], [200, { signedIn: true, userId: userA }]);

  const refreshing = authSetup({ refreshTo: userA });
  const renewed = await call(refreshing.handler, { method: 'GET', url: '/api/auth/session',
    headers: { cookie: cookieHeader({ [ACCESS_COOKIE]: 'expired.token.value', [REFRESH_COOKIE]: 'rt-A-1' }) } });
  assert.deepEqual([renewed.status, renewed.body], [200, { signedIn: true, userId: userA }]);
  assert.equal(setCookies(renewed).length, 2);
  assert.ok(refreshing.clients.calls.includes('refresh:rt-A-1'));

  const dead = authSetup();
  const out = await call(dead.handler, { method: 'GET', url: '/api/auth/session',
    headers: { cookie: cookieHeader({ [REFRESH_COOKIE]: 'rt-revoked' }) } });
  assert.deepEqual([out.status, out.body], [200, { signedIn: false }]);
  assert.ok(setCookies(out).every((c) => /Max-Age=0/u.test(c)));

  // 심판 토큰을 쿠키에 넣어도 화면 세션으로 인정하지 않습니다.
  const judge = (await judgeBearer('cccccccc-3333-4333-8333-333333333333', 'a')).slice('Bearer '.length);
  const judged = await call(valid.handler, { method: 'GET', url: '/api/auth/session', headers: { cookie: cookieHeader({ [ACCESS_COOKIE]: judge }) } });
  assert.deepEqual(judged.body, { signedIn: false });
});

test('logout revokes the server session and always clears both cookies', async () => {
  const { handler, clients } = authSetup();
  const r = await call(handler, { method: 'POST', url: '/api/auth/logout',
    headers: { ...sameSite, cookie: cookieHeader({ [ACCESS_COOKIE]: await raw(userA), [REFRESH_COOKIE]: 'rt-A-1' }) }, body: {} });
  assert.deepEqual([r.status, r.body], [200, { signedIn: false, revoked: true }]);
  assert.ok(clients.calls.includes('signOut:local'));
  assert.deepEqual(setCookies(r).map((c) => c.split('=')[0]), [ACCESS_COOKIE, REFRESH_COOKIE]);
  assert.ok(setCookies(r).every((c) => /Max-Age=0/u.test(c)));
  const cross = await call(handler, { method: 'POST', url: '/api/auth/logout', headers: { origin: 'https://evil.example', host: HOST }, body: {} });
  assert.equal(cross.status, 403);
});

test('notes API accepts the login cookie, keeps ownership, and refuses cross-origin cookie writes', async () => {
  const db = fakeSupabase();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(db), writesEnabled: true });
  const a = { cookie: cookieHeader({ [ACCESS_COOKIE]: await raw(userA) }) };
  const created = await call(handler, { method: 'POST', url: '/api/notes', headers: { ...sameSite, ...a }, body: { title: 'A', body: '' } });
  assert.equal(created.status, 201);
  assert.equal(db.rows[0].owner_id, userA);
  assert.equal((await call(handler, { method: 'GET', url: '/api/notes', headers: a })).body.length, 1);
  for (const headers of [{ ...a, host: HOST, origin: 'https://evil.example' }, { ...a, 'sec-fetch-site': 'cross-site' }, a]) {
    const r = await call(handler, { method: 'DELETE', url: `/api/notes/${created.body.id}`, headers });
    assert.deepEqual([r.status, r.body], [403, { error: 'CROSS_ORIGIN_REJECTED' }]);
  }
  // B의 쿠키로는 A 메모가 보이지 않습니다.
  const b = { cookie: cookieHeader({ [ACCESS_COOKIE]: await raw(userB) }) };
  assert.equal((await call(handler, { method: 'GET', url: `/api/notes/${created.body.id}`, headers: b })).status, 404);
  // Authorization 헤더가 있으면 쿠키로 대신하지 않습니다(잘못된 헤더 + 정상 쿠키 = 401).
  const r = await call(handler, { method: 'GET', url: '/api/notes', headers: { ...a, authorization: 'Bearer bad.token.value' } });
  assert.equal(r.status, 401);
  // 헤더 인증(심판·자동 점검)은 Origin 없이도 그대로 동작합니다.
  const viaHeader = await call(handler, { method: 'DELETE', url: `/api/notes/${created.body.id}`, headers: { authorization: await studentBearer(userA) } });
  assert.equal(viaHeader.status, 204);
});

test('auth routes are recognised only for /api/auth paths or the internal rewrite', () => {
  assert.equal(authAction({ url: '/api/auth/login' }), 'login');
  assert.equal(authAction({ url: '/api/notes?auth=session', query: { auth: 'session' } }), 'session');
  assert.equal(authAction({ url: '/api/notes' }), null);
  assert.equal(authAction({ url: '/api/notes/aaaaaaaa-1111-4111-8111-111111111111' }), null);
  assert.equal(authAction({ url: '/other?auth=login', query: { auth: 'login' } }), null);
});

test('cookie parsing ignores unrelated or malformed cookies and same-origin requires matching https origin', () => {
  assert.deepEqual(readCookies({ headers: { cookie: `x=1; ${ACCESS_COOKIE}=a.b.c; ${ACCESS_COOKIE}=second; bad` } }), { [ACCESS_COOKIE]: 'a.b.c' });
  assert.deepEqual(readCookies({ headers: { cookie: `${ACCESS_COOKIE}=has space` } }), {});
  assert.equal(sameOrigin({ headers: { origin: `https://${HOST}`, host: HOST } }), true);
  assert.equal(sameOrigin({ headers: { origin: `http://${HOST}`, host: HOST } }), false);
  assert.equal(sameOrigin({ headers: { 'sec-fetch-site': 'same-origin' } }), true);
  assert.equal(sameOrigin({ headers: {} }), false);
});
