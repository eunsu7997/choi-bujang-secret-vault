// 실제 Supabase DB 소유권 통합 점검입니다. PM이 notes-ownership.sql을 적용한 뒤에만 직접 실행합니다.
//   읽기 전용 확인:  node scripts/db-integration.mjs --check-only
//   쓰기 시험:       node scripts/db-integration.mjs --yes-write-test-rows
// 쓰기 시험은 매번 새로 만든 가상 소유자 UUID로만 행을 만들고, 끝나면 그 행을 모두 지웁니다.
// 출력에는 상태 코드와 건수만 남기며 키·주소·메모 본문은 쓰지 않습니다.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createNotesHandler, supabaseFromEnv, supabaseNotesStore } from '../api/notes.js';

function call(handler, request) {
  let status;
  let body;
  const response = {
    setHeader() {},
    status: (value) => { status = value; return { json: (value) => { body = value; }, end: () => {} }; },
  };
  return handler({ headers: {}, query: {}, ...request }, response).then(() => ({ status, body }));
}

// client와 directRead는 시험에서 가짜로 바꿔 끼울 수 있습니다.
export async function runDbIntegration({ client, checkOnly, directRead, log = console.log }) {
  const results = [];
  const stopped = Symbol('failed-check');
  const record = (name, ok, detail) => {
    results.push({ name, ok });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
    if (!ok) throw stopped;
  };
  try { await steps(); } catch (error) { if (error !== stopped) throw error; }
  return results;

  async function steps() {

  const schema = await client.from('notes').select('id, owner_kind').limit(1);
  record('소유권 스키마(owner_kind) 적용', !schema.error, schema.error ? `오류 코드 ${schema.error.code}` : '');
  if (schema.error) return;

  if (directRead) {
    // 공개 키로 REST를 직접 부르면 여전히 거절돼야 합니다.
    const status = await directRead();
    record('공개 키 직접 조회 거절', status === 401 || status === 403, `HTTP ${status}`);
  } else {
    record('공개 키 직접 조회 거절', false, '미실행: SUPABASE_PUBLISHABLE_KEY 없음');
  }
  if (checkOnly) return;

  const owners = { a: randomUUID(), b: randomUUID() };
  const principals = {
    'Bearer a': { kind: 'student', userId: owners.a },
    'Bearer b': { kind: 'student', userId: owners.b },
    // 학생 A와 같은 UUID를 가진 심판: 종류가 달라 A의 메모에 닿지 않아야 합니다.
    'Bearer j': { kind: 'judge', userId: owners.a },
  };
  const handler = createNotesHandler({
    getVerifier: () => async (authorization) => principals[authorization] ?? null,
    getStore: () => supabaseNotesStore(client),
    writesEnabled: true,
  });
  const as = (who) => ({ authorization: `Bearer ${who}` });

  try {
    const created = await call(handler, { method: 'POST', headers: as('a'), body: { title: 'db-integration', content: 'synthetic' } });
    record('A 메모 생성', created.status === 201, `HTTP ${created.status}`);
    const id = created.body?.note?.id;
    if (!id) return;
    const ownList = await call(handler, { method: 'GET', headers: as('a') });
    record('A 목록에 자기 메모만', ownList.status === 200 && ownList.body.notes.length === 1, `${ownList.body?.notes?.length}건`);
    const otherList = await call(handler, { method: 'GET', headers: as('b') });
    record('B 목록에 A 메모 없음', otherList.status === 200 && otherList.body.notes.length === 0, `${otherList.body?.notes?.length}건`);
    for (const [who, method, body] of [['b', 'GET'], ['b', 'PATCH', { title: 'taken' }], ['b', 'DELETE'],
      ['j', 'GET'], ['j', 'PATCH', { title: 'taken' }], ['j', 'DELETE']]) {
      const result = await call(handler, { method, headers: as(who), query: { id }, body });
      record(`${who === 'b' ? '학생 B' : '같은 UUID 심판'} ${method} A 메모 거절`, result.status === 404, `HTTP ${result.status}`);
    }
    const patched = await call(handler, { method: 'PATCH', headers: as('a'), query: { id }, body: { content: 'changed' } });
    record('A 메모 수정', patched.status === 200, `HTTP ${patched.status}`);
    const removed = await call(handler, { method: 'DELETE', headers: as('a'), query: { id } });
    record('A 메모 삭제', removed.status === 204, `HTTP ${removed.status}`);
  } finally {
    // 가상 소유자로 만든 행만 지웁니다.
    const cleanup = await client.from('notes').delete().in('owner_id', [owners.a, owners.b]).select('id');
    record('시험 행 정리', !cleanup.error, cleanup.error ? `오류 코드 ${cleanup.error.code}` : `${cleanup.data?.length ?? 0}건 삭제`);
    const remaining = await client.from('notes').select('id').in('owner_id', [owners.a, owners.b]);
    record('시험 행 잔존 없음', !remaining.error && Array.isArray(remaining.data) && remaining.data.length === 0);
  }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has('--check-only');
  try {
    if (checkOnly === args.has('--yes-write-test-rows')) {
      throw new Error('--check-only 또는 --yes-write-test-rows 중 하나만 지정하세요.');
    }
    const client = supabaseFromEnv();
    if (!client) throw new Error('SUPABASE_URL·SUPABASE_SECRET_KEY가 없거나 aleph.config.json의 발급자와 다른 프로젝트입니다.');
    const publishable = process.env.SUPABASE_PUBLISHABLE_KEY;
    const directRead = publishable && (async () => (await fetch(new URL('/rest/v1/notes?select=id&limit=1', process.env.SUPABASE_URL),
      { headers: { apikey: publishable }, redirect: 'error', signal: AbortSignal.timeout(10000) })).status);
    const results = await runDbIntegration({ client, checkOnly, directRead });
    if (results.some((item) => !item.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(`중단: ${error.message}`);
    process.exitCode = 1;
  }
}
