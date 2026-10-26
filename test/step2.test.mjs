import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createNotesHandler, supabaseFromEnv } from '../api/notes.js';
import { runAttackChecks } from '../src/attack-check.mjs';
import { deploymentIdentity } from '../scripts/deployment-identity.mjs';

const root = new URL('..', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

function call(handler, request) {
  const headers = new Map();
  let status;
  let body;
  const response = {
    setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    status: (value) => { status = value; return { json: (value) => { body = value; } }; },
  };
  return handler(request, response).then(() => ({ status, body, headers }));
}

function fakeClient(result, seen = {}) {
  return {
    from(table) {
      seen.table = table;
      const query = {
        select: (columns) => { seen.columns = columns; return query; },
        order: () => query,
        limit: async () => result,
      };
      return query;
    },
  };
}

test('notes API returns only title and content from the server query', async () => {
  const seen = {};
  const rows = [
    { title: '시험 제목 A', content: '시험 내용 A', owner_id: '00000000-0000-0000-0000-000000000000' },
    { title: '시험 제목 B', content: '시험 내용 B' },
  ];
  const { status, body, headers } = await call(
    createNotesHandler(() => fakeClient({ data: rows, error: null }, seen)), { method: 'GET' });
  assert.equal(status, 200);
  assert.equal(headers.get('cache-control'), 'no-store');
  assert.equal(seen.table, 'notes');
  assert.equal(seen.columns, 'title, content');
  assert.deepEqual(body.notes, rows.map(({ title, content }) => ({ title, content })));
});

test('notes API rejects other methods and missing configuration without echoing values', async () => {
  const post = await call(createNotesHandler(() => fakeClient({ data: [], error: null })), { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET');
  const missing = await call(createNotesHandler(() => null), { method: 'GET' });
  assert.deepEqual([missing.status, missing.body], [500, { error: 'NOTES_NOT_CONFIGURED' }]);
  assert.equal(supabaseFromEnv({}), null);
  assert.equal(supabaseFromEnv({ SUPABASE_URL: 'http://plain.example', SUPABASE_SECRET_KEY: 'x' }), null);
  assert.equal(supabaseFromEnv({ SUPABASE_URL: 'https://abc.supabase.co/rest', SUPABASE_SECRET_KEY: 'x' }), null);
  assert.equal(supabaseFromEnv({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: ' ' }), null);
});

test('notes API hides database error details', async () => {
  const originalError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const failed = await call(createNotesHandler(() => fakeClient({
      data: null, error: { code: '42501', message: 'permission denied for table notes' },
    })), { method: 'GET' });
    assert.deepEqual([failed.status, failed.body], [502, { error: 'NOTES_UNAVAILABLE' }]);
    assert.deepEqual(logged, ['notes_query_failed 42501']);
  } finally {
    console.error = originalError;
  }
});

test('step 2 page reads the API and public data.json is gone', async () => {
  const config = JSON.parse(await read('aleph.config.json'));
  assert.equal(config.step, 2);
  const page = await read('public/index.html');
  assert.match(page, /fetch\('\/api\/notes'/u);
  assert.doesNotMatch(page, /data\.json/u);
  execFileSync(process.execPath, ['scripts/build-public.mjs', '--local'], { cwd: root });
  assert.equal(existsSync(new URL('public/data.json', root)), false);
  assert.equal(execFileSync('git', ['ls-files', 'public/data.json'], { cwd: root, encoding: 'utf8' }), '');
});

test('deployment identity keeps /aleph.json at step 2', () => {
  const env = {
    VERCEL_GIT_PROVIDER: 'github', VERCEL_GIT_REPO_OWNER: 'Student-A', VERCEL_GIT_REPO_SLUG: 'aleph-defense',
    VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40), VERCEL_URL: 'student-defense-123.vercel.app',
  };
  const config = { step: 2, judgeIssuer: 'https://aleph-judge-production.up.railway.app/defense/judge',
    sampleMarker: 'SAMPLE_NOTE_1' };
  assert.equal(deploymentIdentity(env, config).step, 2);
  assert.throws(() => deploymentIdentity(env, { ...config, step: '2' }));
  assert.throws(() => deploymentIdentity(env, { ...config, step: 13 }));
});

test('vercel.json sends nosniff on every path', async () => {
  const vercel = JSON.parse(await read('vercel.json'));
  const rule = vercel.headers.find((item) => item.source === '/(.*)');
  assert.deepEqual(rule.headers, [{ key: 'X-Content-Type-Options', value: 'nosniff' }]);
  assert.equal(vercel.outputDirectory, 'public');
});

test('step 2 attack check records only observed status, counts, and headers', async () => {
  const config = { step: 2, publicAppUrl: 'https://student-defense.vercel.app/', sampleMarker: 'SAMPLE_NOTE_1',
    repoUrl: 'https://github.com/student-a/aleph-defense' };
  const originalFetch = globalThis.fetch;
  const requested = [];
  const json = (value, headers = {}) => new Response(JSON.stringify(value),
    { status: 200, headers: { 'content-type': 'application/json', ...headers } });
  try {
    globalThis.fetch = async (url, init) => {
      requested.push([new URL(url).pathname, init.redirect, init.headers?.authorization]);
      const path = new URL(url).pathname;
      if (path === '/api/notes') {
        return json({ notes: [{ title: '시험 제목 A', content: '시험 내용 A' }] }, { 'x-content-type-options': 'nosniff' });
      }
      if (path === '/aleph.json') return json({ step: 2, repoUrl: config.repoUrl });
      return new Response('not found', { status: 404 });
    };
    const results = await runAttackChecks(config);
    assert.deepEqual(requested.map(([path]) => path).sort(), ['/aleph.json', '/api/notes', '/data.json']);
    assert.ok(requested.every(([, redirect, auth]) => redirect === 'error' && auth === undefined));
    assert.deepEqual(Object.fromEntries(results.map((item) => [item.attackId, item.observed])), {
      public_data_json_removed: 'HTTP 404, 가상 메모 보이지 않음',
      anonymous_api_notes_read: 'HTTP 200, 메모 1건 응답, owner_id 미포함, nosniff 있음',
      deployment_identity_step: 'HTTP 200, step 2, 저장소 주소 일치',
    });
    assert.doesNotMatch(JSON.stringify(results), /시험 (제목|내용)|심판|통과/u);

    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const failed = await runAttackChecks(config);
    assert.ok(failed.every((item) => item.observed === '요청 실패 (응답 없음 또는 리디렉션)'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
