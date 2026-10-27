import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { createNotesHandler } from '../api/notes.js';
import { createLoginVerifier } from '../src/verify-login.mjs';

// 모두 시험용 가짜 주소·키입니다. 외부 네트워크로 나가지 않습니다.
const realConfig = JSON.parse(await readFile(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const studentIssuer = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1';
const config = {
  judgeIssuer: realConfig.judgeIssuer,
  publicAppUrl: 'https://student-defense.vercel.app/',
  identityProvider: { issuer: studentIssuer, audience: 'authenticated', jwksUrl: `${studentIssuer}/.well-known/jwks.json` },
};
const appHost = 'student-defense.vercel.app';
const userA = '11111111-1111-4111-8111-111111111111';

const studentKeys = await generateKeyPair('ES256');
const attackerKeys = await generateKeyPair('ES256');
const judgeKeys = await generateKeyPair('ES256');
const studentJwk = { ...(await exportJWK(studentKeys.publicKey)), kid: 'student-kid', alg: 'ES256', use: 'sig' };
const judgeJwk = { ...(await exportJWK(judgeKeys.publicKey)), kid: 'judge-kid', alg: 'ES256', use: 'sig' };

const networkCalls = [];
async function fakeFetch(input) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  networkCalls.push(url.pathname);
  if (url.origin !== new URL(studentIssuer).origin) throw new Error('unexpected host');
  if (url.pathname === '/auth/v1/.well-known/jwks.json') return Response.json({ keys: [studentJwk] });
  // 대칭키 토큰은 getUser()로 확인하는데, 시험 서버는 항상 거절합니다.
  return Response.json({ code: 401, msg: 'invalid JWT' }, { status: 401 });
}
const supabaseClient = createClient(new URL(studentIssuer).origin, 'test-only-not-a-key', {
  global: { fetch: fakeFetch },
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});
const verify = createLoginVerifier({ config, supabaseClient, judgeKeySet: createLocalJWKSet({ keys: [judgeJwk] }) });

const now = () => Math.floor(Date.now() / 1000);
function studentToken(overrides = {}, { key = studentKeys.privateKey, kid = 'student-kid', alg = 'ES256' } = {}) {
  return new SignJWT({ role: 'authenticated', ...overrides.claims })
    .setProtectedHeader({ alg, kid, typ: 'JWT' })
    .setIssuer(overrides.iss ?? studentIssuer).setAudience(overrides.aud ?? 'authenticated')
    .setSubject(overrides.sub ?? userA).setIssuedAt(overrides.iat ?? now() - 10)
    .setExpirationTime(overrides.exp ?? now() + 600).sign(key);
}
function judgeToken(overrides = {}, { key = judgeKeys.privateKey, alg = 'ES256' } = {}) {
  const iat = overrides.iat ?? now() - 5;
  return new SignJWT({ aleph_run: randomUUID(), aleph_role: 'judge', aleph_identity: 'a', ...overrides.claims })
    .setProtectedHeader({ alg, kid: 'judge-kid', typ: 'JWT' })
    .setIssuer(realConfig.judgeIssuer).setAudience(overrides.aud ?? appHost)
    .setSubject(randomUUID()).setIssuedAt(iat).setExpirationTime(overrides.exp ?? iat + 600).sign(key);
}
const bearer = (token) => `Bearer ${token}`;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

test('checked-in aleph.config.json is accepted by the login verifier', () => {
  assert.equal(realConfig.identityProvider.audience, 'authenticated');
  assert.equal(realConfig.identityProvider.jwksUrl, `${realConfig.identityProvider.issuer}/.well-known/jwks.json`);
  assert.doesNotThrow(() => createLoginVerifier({ config: realConfig, supabaseClient, judgeKeySet: () => {} }));
});

test('a valid student token passes through real signature verification', async () => {
  assert.deepEqual({ ...(await verify(bearer(await studentToken()))) }, { kind: 'student', userId: userA });
});

test('forged, expired, other-service and mis-scoped student tokens are rejected', async () => {
  const otherProject = 'https://zzzzzzzzzzzzzzzzzzzz.supabase.co/auth/v1';
  const cases = {
    forgedSignature: await studentToken({}, { key: attackerKeys.privateKey }),
    expired: await studentToken({ iat: now() - 7200, exp: now() - 3600 }),
    otherService: await studentToken({ iss: 'https://login.other-service.example/auth/v1' }),
    otherSupabaseProject: await studentToken({ iss: otherProject }),
    wrongAudience: await studentToken({ aud: 'anon' }),
    anonRole: await studentToken({ claims: { role: 'anon' } }),
    serviceRole: await studentToken({ claims: { role: 'service_role' } }),
    notUuidSubject: await studentToken({ sub: 'admin' }),
    unknownKid: await studentToken({}, { kid: 'attacker-kid', key: attackerKeys.privateKey }),
    hs256Shared: await studentToken({}, { alg: 'HS256', key: new TextEncoder().encode('guessed-shared-secret') }),
    algNone: `${b64({ alg: 'none', kid: 'student-kid' })}.${b64({ iss: studentIssuer, aud: 'authenticated',
      role: 'authenticated', sub: userA, iat: now(), exp: now() + 600 })}.AAAA`,
    studentKeyPosingAsJudge: await new SignJWT({ aleph_run: randomUUID(), aleph_role: 'judge', aleph_identity: 'a' })
      .setProtectedHeader({ alg: 'ES256', kid: 'judge-kid' }).setIssuer(realConfig.judgeIssuer).setAudience(appHost)
      .setSubject(randomUUID()).setIssuedAt().setExpirationTime('10m').sign(studentKeys.privateKey),
  };
  for (const [name, token] of Object.entries(cases)) {
    assert.equal(await verify(bearer(token)), null, name);
  }
});

test('missing or malformed Authorization headers are rejected', async () => {
  const token = await studentToken();
  for (const header of [undefined, '', 'Bearer', `Basic ${token}`, `bearer ${token}`, `Bearer ${token} extra`,
    `Bearer ${'a'.repeat(8200)}.b.c`, 'Bearer a.b']) {
    assert.equal(await verify(header), null, String(header).slice(0, 20));
  }
});

test('judge tokens are checked for signature, audience, lifetime and role', async () => {
  const valid = await verify(bearer(await judgeToken()));
  assert.equal(valid?.kind, 'judge');
  for (const [name, token] of Object.entries({
    wrongAudience: await judgeToken({ aud: 'other-app.vercel.app' }),
    tooLong: await judgeToken({ exp: now() + 3600 }),
    expired: await judgeToken({ iat: now() - 1200, exp: now() - 600 }),
    notJudgeRole: await judgeToken({ claims: { aleph_role: 'student' } }),
    forged: await judgeToken({}, { key: attackerKeys.privateKey }),
    hs256: await judgeToken({}, { alg: 'HS256', key: new TextEncoder().encode('guessed-shared-secret') }),
  })) {
    assert.equal(await verify(bearer(token)), null, name);
  }
});

test('student verification never leaves the fake Supabase host', () => {
  assert.ok(networkCalls.every((path) => path.startsWith('/auth/v1/')));
  // 비대칭 토큰은 JWKS로 서명을 확인하고, 대칭 토큰은 Auth 서버 확인까지 가서 거절됐는지 봅니다.
  assert.ok(networkCalls.includes('/auth/v1/.well-known/jwks.json'));
  assert.ok(networkCalls.includes('/auth/v1/user'));
});

// ---- CRUD: 격리된 메모리 저장소에서만 검증합니다(실제 DB 미사용) ----
function memoryStore() {
  const rows = new Map();
  const owns = (owner, row) => row && row.owner_kind === owner.kind && row.owner_id === owner.id;
  return {
    rows,
    async list(owner) { return [...rows.values()].filter((row) => owns(owner, row)); },
    async get(owner, id) { return owns(owner, rows.get(id)) ? rows.get(id) : null; },
    async create(owner, { id, title, content }) {
      const row = { id, owner_kind: owner.kind, owner_id: owner.id, title, content };
      rows.set(row.id, row);
      return row;
    },
    async update(owner, id, fields) {
      if (!owns(owner, rows.get(id))) return null;
      const row = { ...rows.get(id), ...fields };
      rows.set(id, row);
      return row;
    },
    async remove(owner, id) { return owns(owner, rows.get(id)) && rows.delete(id) ? { id } : null; },
  };
}

function call(handler, request) {
  const headers = new Map();
  let status;
  let body;
  const response = {
    setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    status: (value) => { status = value; return { json: (value) => { body = value; }, end: () => {} }; },
  };
  return handler({ headers: {}, query: {}, ...request }, response).then(() => ({ status, body, headers }));
}

test('unauthenticated, forged and expired requests are refused for every method before touching the store', async () => {
  const store = memoryStore();
  const touched = [];
  const spy = new Proxy(store, { get: (target, prop) => (touched.push(prop), target[prop]) });
  const handler = createNotesHandler({ getVerifier: () => verify,
    getStore: () => (touched.push('getStore'), spy), writesEnabled: true });
  const forged = await studentToken({}, { key: attackerKeys.privateKey });
  const expired = await studentToken({ iat: now() - 7200, exp: now() - 3600 });
  for (const authorization of [undefined, bearer(forged), bearer(expired), 'Bearer not.a.jwt']) {
    for (const method of ['GET', 'POST', 'PUT', 'DELETE']) {
      const result = await call(handler, { method, headers: { authorization },
        query: { id: randomUUID() }, body: { title: '시험', body: '시험' } });
      assert.deepEqual([result.status, result.body], [401, { error: 'UNAUTHORIZED' }], `${method}`);
      assert.equal(result.headers.get('www-authenticate'), 'Bearer');
      assert.equal(result.headers.get('cache-control'), 'no-store');
    }
  }
  assert.deepEqual(touched, []);
  assert.equal(store.rows.size, 0);
});

test('CRUD works in the isolated mock store with a verified student token', async () => {
  const store = memoryStore();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => store, writesEnabled: true });
  const headers = { authorization: bearer(await studentToken()) };

  const created = await call(handler, { method: 'POST', headers, body: { title: '  시험 제목  ', body: '시험 내용' } });
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.body).sort(), ['id']);
  assert.equal(store.rows.get(created.body.id).title, '시험 제목');
  const id = created.body.id;
  assert.equal(store.rows.get(id).owner_id, userA);

  const listed = await call(handler, { method: 'GET', headers });
  assert.deepEqual(listed.body, [{ id, title: '시험 제목', body: '시험 내용' }]);

  const patched = await call(handler, { method: 'PUT', headers, query: { id }, body: { title: '시험 제목', body: '바뀐 내용' } });
  assert.deepEqual([patched.status, patched.body.body], [200, '바뀐 내용']);

  const removed = await call(handler, { method: 'DELETE', headers, query: { id } });
  assert.equal(removed.status, 204);
  assert.equal(store.rows.size, 0);
  const again = await call(handler, { method: 'DELETE', headers, query: { id } });
  assert.deepEqual([again.status, again.body], [404, { error: 'NOTE_NOT_FOUND' }]);
});

test('CRUD rejects invalid input without writing', async () => {
  const store = memoryStore();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => store, writesEnabled: true });
  const headers = { authorization: bearer(await studentToken()) };
  for (const body of [undefined, [], { title: '' }, { title: '   ' }, { title: 'a'.repeat(201) },
    { title: '시험', body: 'a'.repeat(10001) }, { title: '시험', owner_id: userA }, { title: 1 }]) {
    const result = await call(handler, { method: 'POST', headers, body });
    assert.deepEqual([result.status, result.body], [400, { error: 'INVALID_NOTE' }], JSON.stringify(body)?.slice(0, 30));
  }
  for (const query of [{}, { id: 'not-a-uuid' }, { id: ['a', 'b'] }]) {
    const result = await call(handler, { method: 'DELETE', headers, query });
    assert.deepEqual([result.status, result.body], [400, { error: 'INVALID_NOTE_ID' }]);
  }
  assert.equal(store.rows.size, 0);
});

test('factory defaults remain read-only and production explicitly enables owner-scoped writes', async () => {
  const store = memoryStore();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => store });
  const headers = { authorization: bearer(await studentToken()) };
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const result = await call(handler, { method, headers, query: { id: randomUUID() }, body: { title: '시험' } });
    assert.deepEqual([result.status, result.body], [403, { error: 'WRITES_DISABLED' }], method);
  }
  assert.equal(store.rows.size, 0);
  assert.equal((await call(handler, { method: 'GET', headers })).status, 200);
  const source = await readFile(new URL('../api/notes.js', import.meta.url), 'utf8');
  const defaultExport = source.slice(source.indexOf('export default createNotesHandler'));
  assert.match(defaultExport, /writesEnabled: true,/u);
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*WRITE/u);
});

test('verifier errors are treated as refusal, not as a server crash', async () => {
  const handler = createNotesHandler({ getVerifier: () => async () => { throw new Error('boom'); },
    getStore: () => memoryStore() });
  const result = await call(handler, { method: 'GET', headers: { authorization: 'Bearer a.b.c' } });
  assert.deepEqual([result.status, result.body], [401, { error: 'UNAUTHORIZED' }]);
  // 초기화 예외도 서버 오류 원문 없이 같은 설정 오류로 답합니다.
  const headers = { authorization: bearer(await studentToken()) };
  const boom = () => { throw new Error('init failed'); };
  for (const options of [{ getVerifier: boom, getStore: () => memoryStore() }, { getVerifier: () => verify, getStore: boom }]) {
    const failed = await call(createNotesHandler(options), { method: 'GET', headers });
    assert.deepEqual([failed.status, failed.body], [500, { error: 'NOTES_NOT_CONFIGURED' }]);
  }
});

test('step 3 attack check records only statuses for anonymous, forged and other-issuer requests', async () => {
  const { runAttackChecks } = await import('../src/attack-check.mjs');
  const checkConfig = { step: 3, publicAppUrl: 'https://student-defense.vercel.app/', sampleMarker: 'SAMPLE_NOTE_1',
    repoUrl: 'https://github.com/student-a/aleph-defense', allowedRoutes: ['/api/notes'],
    identityProvider: config.identityProvider };
  const originalFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init = {}) => {
      const path = new URL(url).pathname;
      const auth = init.headers?.authorization;
      seen.push({ path, method: init.method ?? 'GET', redirect: init.redirect, auth: Boolean(auth) });
      if (path === '/aleph.json') return Response.json({ step: 3, repoUrl: checkConfig.repoUrl });
      if (path === '/api/notes') {
        // 시험 서버: 진짜 검증기로 위조 토큰을 판정합니다.
        const ok = auth && await verify(auth);
        return ok ? Response.json({ notes: [] })
          : Response.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' } });
      }
      return new Response('not found', { status: 404 });
    };
    const results = await runAttackChecks(checkConfig);
    assert.deepEqual(Object.fromEntries(results.map((item) => [item.attackId, item.observed])), {
      public_data_json_removed: 'HTTP 404, 가상 메모 보이지 않음',
      anonymous_api_notes_blocked: 'HTTP 401, x-content-type-options 있음, x-frame-options 있음',
      forged_token_rejected: 'HTTP 401',
      other_issuer_token_rejected: 'HTTP 401',
      anonymous_write_blocked: 'HTTP 401',
      student_login_read: '미실행 (로그인 토큰이 필요해 자동 점검하지 않음, 브라우저에서 직접 확인)',
      cross_owner_access: '미실행 (두 계정의 로그인 토큰이 필요해 자동 점검하지 않음)',
      deployment_identity_step: 'HTTP 200, step 3, 저장소 주소 일치',
    });
    assert.ok(seen.every((item) => item.redirect === 'error'));
    assert.equal(seen.filter((item) => item.auth).length, 2);
    assert.ok(results.every((item) => Object.keys(item).sort().join() === 'attackId,expected,observed'));
    assert.doesNotMatch(JSON.stringify(results), /eyJ|Bearer|심판 판정|통과했/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
