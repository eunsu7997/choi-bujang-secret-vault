import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, Script } from 'node:vm';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { MODULE_KEYS, createResponder } from '../xdr/respond-core.mjs';
import { createXdrGate } from '../xdr/gate.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const load = async key => JSON.parse(await readFile(join(root, `xdr/fixtures/${key}.json`), 'utf8'));
const digest = value => createHash('sha256').update(value).digest('hex');
// 경보 설명·요청·수치를 직접 검토한 로컬 검수 기대치입니다. 심판 정답이 아닙니다.
// 이 표는 판단 모듈에서 읽지 않으며 ID별 판정 로직은 허용하지 않습니다.
const reviewed = {
  'brute-force': { attacks: 10, normalStart: 20 },
  'web-injection': { attacks: 8, normalStart: 18 },
  'known-cve': { attacks: 8, normalStart: 17 },
  persistence: { attacks: 8, normalStart: 17 },
  privilege: { attacks: 9, normalStart: 18 },
  exfiltration: { attacks: 10, normalStart: 21 },
};

for (const key of MODULE_KEYS) {
  test(`${key}: 검토한 공격·애매한 사건·정상 사건과 독립 실행`, async () => {
    const path = join(root, `xdr/fixtures/${key}.json`), before = digest(await readFile(path));
    const { alerts } = await load(key);
    const loaded = await import(`../xdr/${key}/decide.mjs`);
    assert.deepEqual(Object.keys(loaded), ['decide']);
    const expected = reviewed[key];
    const original = structuredClone(alerts);
    const source = await readFile(join(root, `xdr/${key}/decide.mjs`), 'utf8');
    assert.doesNotMatch(source, /\bimport\s*(?:\(|[{*'"\w])/u);
    assert.doesNotMatch(source, /\b(?:require|fetch|readFile|writeFile|process|eval|Function)\s*[.(]/u);
    const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
    const code = source.replace(/export\s+(?:async\s+)?function\s+decide/u, 'function decide');
    new Script(`${code}\nthis.classify = decide; this.patterns = JSON.stringify(PATTERNS);`).runInContext(context, { timeout: 1000 });
    assert.deepEqual(JSON.parse(context.patterns), JSON.parse(await readFile(join(root, `xdr/${key}/patterns.json`))));
    for (const pattern of JSON.parse(context.patterns)) {
      assert.ok(pattern.name && pattern.condition && pattern.evidence);
      assert.doesNotMatch(pattern.evidence, /[\r\n]/u);
      assert.ok(pattern.source || pattern.sources?.length);
    }
    for (let i = 0; i < alerts.length; i++) {
      const start = performance.now();
      const result = await loaded.decide(alerts[i]);
      assert.ok(performance.now() - start < 2000);
      context.input = structuredClone(alerts[i]);
      const isolated = new Script('JSON.stringify(classify(input))').runInContext(context, { timeout: 1000 });
      assert.deepEqual(JSON.parse(isolated), result);
      assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
      assert.ok(Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1);
      assert.equal(result.action, result.confidence >= 0.85 ? 'block' : result.confidence >= 0.5 ? 'alert' : 'record');
      assert.doesNotMatch(result.reason, /[\r\n]/u);
      if (i < expected.attacks) assert.equal(result.action, 'block', alerts[i].id);
      else assert.notEqual(result.action, 'block', alerts[i].id);
      if (i + 1 >= expected.normalStart) assert.equal(result.action, 'record', alerts[i].id);
      const renamed = structuredClone(alerts[i]);
      renamed.id = 'unrelated-id';
      renamed.data.srcip = '192.0.2.199';
      assert.equal((await loaded.decide(renamed)).action, result.action, 'ID·주소별 정답표 금지');
    }
    for (const invalid of [undefined, null, 1, 'string', [], {}]) {
      assert.equal((await loaded.decide(invalid)).action, 'record');
    }
    for (const a of [...alerts].reverse()) await loaded.decide(a);
    assert.deepEqual(await loaded.decide(alerts[0]), await loaded.decide(original[0]));
    assert.deepEqual(alerts, original);
    assert.equal(digest(await readFile(path)), before);
    const reader = join(root, `xdr/${key}/read-alerts.mjs`);
    const lines = execFileSync(process.execPath, [reader], { cwd: tmpdir(), encoding: 'utf8' }).trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(lines.length, alerts.length);
    for (const line of lines) assert.equal(Object.keys(line).length, 5);
  });
}

test('웹 주입: 실제 구문·인코딩·반복 문턱 및 정상 수업 단어', async () => {
  const { decide } = await import('../xdr/web-injection/decide.mjs');
  const alert = (url, description = '웹 요청 검사', count = '3') => ({
    rule: { level: 12, description }, data: { srcip: '192.0.2.199', url, count },
  });
  for (const url of ["/search?q=' OR 1=1", '/search?q=%253Cscript%253E', '/files?path=../../example', '/search?q=;whoami']) {
    assert.equal(decide(alert(url)).action, 'block');
    assert.equal(decide(alert(url, '웹 요청 검사', '2')).action, 'alert');
  }
  for (const value of ['select-course', 'script-class', 'sql-class-notice', 'up-notes']) {
    assert.equal(decide(alert(`/search?q=${value}`, '수업 공지를 조회했습니다.', '999')).action, 'record');
  }
  assert.notEqual(decide(alert('/search?q=normal', 'SQL 구문은 없습니다.', '999')).action, 'block');
  const malformed = alert('/files?path=../../example');
  malformed.data.srcip = 'not-an-ip';
  assert.equal(decide(malformed).action, 'alert');
  assert.equal(decide(alert('/search?q=%E0%A4%A')).action, 'record');
  const nested = alert('/search');
  nested.data.args = { q: { value: '<script>' } };
  assert.equal(decide(nested).action, 'block');
  const taggedLesson = alert('/search?q=sql-class', '수업 공지를 조회했습니다.');
  taggedLesson.rule.mitre = ['T1190'];
  assert.equal(decide(taggedLesson).action, 'alert', '센서 기법 분류만 있으면 차단 대신 검토');
  const { summarizeAlert } = await import('../xdr/web-injection/read-alerts.mjs');
  for (const description of ['p a s s w o r d=synthetic', '암호=synthetic', '인증 키=synthetic']) {
    assert.equal(summarizeAlert({ rule: { description } }).description, '[REDACTED]');
  }
});

test('웹 주입 검수: 교육·조회·명시적 부정과 잘못된 수준은 자동 차단하지 않음', async () => {
  const { decide } = await import('../xdr/web-injection/decide.mjs');
  const input = description => ({ rule: { level: 12, description },
    data: { srcip: '192.0.2.200', url: '/docs/lesson', count: '100' } });
  for (const description of ['SQL 구문을 설명하는 수업 공지를 읽기만 했습니다.',
    '명령 구분자 표기를 설명하는 문서를 조회만 했습니다.', 'SQL 구문은 사용하지 않습니다.']) {
    assert.equal(decide(input(description)).action, 'record');
    const real = input(description);
    real.data.url = '/files?path=../../example';
    assert.equal(decide(real).action, 'block', '실제 요청 증거는 설명의 안전 문구로 우회하지 못함');
  }
  const invalid = input('웹 요청 검사');
  invalid.rule.level = 999;
  invalid.data.url = '/files?path=../../example';
  assert.equal(decide(invalid).action, 'alert');
});

test('지속 실행·권한·반출: 강한 결합 신호가 빠지면 차단하지 않음', async () => {
  const ps = (await import('../xdr/persistence/decide.mjs')).decide;
  const pv = (await import('../xdr/privilege/decide.mjs')).decide;
  const ex = (await import('../xdr/exfiltration/decide.mjs')).decide;
  const p = structuredClone((await load('persistence')).alerts[0]);
  p.rule.description = '임시 폴더에 실행 파일이 있습니다. 서비스 등록은 없습니다.';
  assert.notEqual(ps(p).action, 'block');
  const v = structuredClone((await load('privilege')).alerts[0]);
  v.rule.description = '평소 주소에서 관리자 명령이 한 번 실행됐습니다.';
  assert.equal(pv(v).action, 'alert');
  v.rule.description = '원격 주소에서 관리자 그룹 추가가 실패했습니다.';
  assert.notEqual(pv(v).action, 'block');
  const e = structuredClone((await load('exfiltration')).alerts[0]);
  e.rule.description = '평소 수업 자료 주소로 전송했습니다.';
  assert.notEqual(ex(e).action, 'block', '크기만으로 차단 금지');
  e.rule.description = '처음 보는 목적지로 전송이 실패했습니다.';
  assert.notEqual(ex(e).action, 'block');
  e.data.bytes = '-1';
  assert.notEqual(ex(e).action, 'block');
});

test('읽기 모듈: 비밀값·숨은 문자·IPv6 scope·잘못된 필드 가림', async () => {
  for (const key of ['web-injection', 'persistence', 'privilege', 'exfiltration']) {
    const { summarizeAlert } = await import(`../xdr/${key}/read-alerts.mjs`);
    for (const value of ['password=synthetic', 'pass\u200bword=synthetic', 'ｐａｓｓｗｏｒｄ=synthetic',
      'session_id=synthetic', 'access_key=synthetic', 'Bearer synthetic', '비번=synthetic', 'synthetic@example.invalid']) {
      const row = summarizeAlert({ data: { srcuser: value }, rule: { description: value } });
      assert.equal(row.account, '[REDACTED]');
      assert.equal(row.description, '[REDACTED]');
    }
    assert.equal(summarizeAlert({ data: { srcip: 'fe80::1%password=synthetic' } }).sourceAddress, null);
    assert.equal(summarizeAlert({ rule: { level: Infinity } }).ruleLevel, null);
  }
});

async function workspace(t) {
  const parent = resolve(root, 'artifacts');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'xdr-suite-test-'));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(`${parent}${sep}`));
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}

test('연결부: 모듈 합성·계정 범위·기존 거부·만료·로그 비밀값', async t => {
  const dir = await workspace(t), logPath = join(dir, 'alerts.log');
  let now = Date.parse('2026-09-27T00:13:00Z');
  const gate = await createXdrGate({ stateDir: join(dir, 'state'), logPath, clock: () => now });
  const attack = structuredClone((await load('privilege')).alerts[0]);
  attack.timestamp = new Date(now).toISOString();
  attack.data.password = 'synthetic-never-logged';
  const normal = fixtureRequests().normal;
  const context = { sourceIp: attack.data.srcip, account: attack.data.srcuser, destinationIp: '192.0.2.10',
    requestEvidence: { requestId: normal.requestId, srcip: attack.data.srcip, url: '/health' } };
  const installed = await gate.respond('privilege', attack);
  assert.equal(installed.installed, true);
  assert.equal((await gate.decideRequest(normal, context)).decision, 'deny');
  assert.equal((await gate.decideRequest(normal, { ...context, account: 'unrelated-user' })).decision, 'allow');
  assert.equal((await gate.decideRequest(normal, { ...context, sourceIp: '192.0.2.200',
    requestEvidence: { ...context.requestEvidence, srcip: '192.0.2.200' } })).decision, 'allow');
  assert.equal((await gate.decideRequest({ ...normal, deviceRegistered: false }, context)).reasonCode, 'device_not_registered');
  assert.equal((await gate.decideRequest(fixtureRequests().suspicious, context)).decision, 'step_up');
  await assert.rejects(gate.decideRequest(normal, { account: 'user01' }), /sourceIp/u);
  await assert.rejects(gate.decideRequest(normal, { sourceIp: context.sourceIp }), /계정/u);
  const statePath = join(dir, 'state/privilege.json');
  const first = JSON.parse(await readFile(statePath));
  now += 1000;
  assert.equal((await gate.respond('privilege', attack)).disposition, 'duplicate');
  assert.deepEqual(JSON.parse(await readFile(statePath)), first);
  const stateText = await readFile(statePath, 'utf8'), logText = await readFile(logPath, 'utf8');
  assert.ok(first.rules[0].alertIds.includes(attack.id));
  assert.ok(first.rules[0].expiresAt);
  assert.ok(!stateText.includes(attack.data.srcuser) && !logText.includes(attack.data.srcuser));
  assert.ok(!logText.includes('synthetic-never-logged') && !logText.includes(attack.rule.description));
  assert.equal(logText.trim().split('\n').length, 2);
  now += 300000;
  assert.equal((await gate.decideRequest(normal, context)).decision, 'allow');
  assert.equal((await gate.respond('privilege', attack)).installed, false, '과거 경보 재전송으로 TTL 연장 금지');
});

test('전체 연결부에서도 알려진 취약점은 같은 IP의 깨끗한 요청을 통과시킴', async t => {
  const dir = await workspace(t), now = Date.parse('2026-11-01T00:00:00Z');
  const gate = await createXdrGate({ stateDir: dir, logPath: join(dir, 'log'), clock: () => now });
  const attack = structuredClone((await load('known-cve')).alerts[0]);
  attack.timestamp = new Date(now).toISOString();
  await gate.respond('known-cve', attack);
  const request = fixtureRequests().normal;
  const context = { sourceIp: attack.data.srcip, account: 'fixture-anonymous', destinationIp: '192.0.2.10',
    requestEvidence: { ...attack.data, requestId: request.requestId } };
  assert.equal((await gate.decideRequest(request, context)).decision, 'deny');
  const clean = { ...context, requestEvidence: { requestId: request.requestId, srcip: context.sourceIp, url: '/health' } };
  assert.equal((await gate.decideRequest(request, clean)).decision, 'allow');
  await assert.rejects(gate.decideRequest(request, { ...clean,
    requestEvidence: { ...clean.requestEvidence, requestId: 'unrelated-request' } }), /이번 요청/u);
});

test('전체 연결부: 지속 실행은 검증된 기기만 격리', async t => {
  const dir = await workspace(t), now = Date.parse('2026-11-01T00:00:00Z');
  const gate = await createXdrGate({ stateDir: dir, logPath: join(dir, 'log'), clock: () => now });
  const attack = structuredClone((await load('persistence')).alerts[0]);
  attack.timestamp = new Date(now).toISOString();
  const request = { ...fixtureRequests().normal, deviceId: 'b'.repeat(16) };
  const context = { sourceIp: attack.data.srcip, account: attack.data.srcuser, destinationIp: '192.0.2.10',
    requestEvidence: { requestId: request.requestId, srcip: attack.data.srcip, url: '/health' } };
  assert.equal((await gate.respond('persistence', attack, { deviceId: request.deviceId })).installed, true);
  assert.equal((await gate.decideRequest(request, context)).decision, 'deny');
  assert.equal((await gate.decideRequest({ ...request, deviceId: 'c'.repeat(16) }, context)).decision, 'allow');
});

test('전체 연결부: 반출은 문제 목적지에만 차단 적용', async t => {
  const dir = await workspace(t), now = Date.parse('2026-11-01T00:00:00Z');
  const gate = await createXdrGate({ stateDir: dir, logPath: join(dir, 'log'), clock: () => now });
  const attack = structuredClone((await load('exfiltration')).alerts[0]);
  attack.timestamp = new Date(now).toISOString();
  const request = fixtureRequests().normal;
  const context = { sourceIp: attack.data.srcip, account: attack.data.srcuser, destinationIp: attack.data.dstip,
    requestEvidence: { requestId: request.requestId, srcip: attack.data.srcip, url: '/health' } };
  await gate.respond('exfiltration', attack);
  assert.equal((await gate.decideRequest(request, context)).decision, 'deny');
  assert.equal((await gate.decideRequest(request, { ...context, destinationIp: '192.0.2.10' })).decision, 'allow');
});

test('연결부: 오래된/미래/보호 주소 및 알림·기록은 규칙을 만들지 않음', async t => {
  const dir = await workspace(t), now = Date.parse('2026-11-01T00:00:00Z');
  const { decide } = await import('../xdr/web-injection/decide.mjs');
  const worker = createResponder({ moduleKey: 'web-injection', decide, statePath: join(dir, 'state.json'),
    logPath: join(dir, 'log'), clock: () => now, protectedSources: ['192.0.2.201'] });
  const source = (await load('web-injection')).alerts[0];
  const cases = [source, { ...source, timestamp: new Date(now + 60000).toISOString() },
    { ...source, timestamp: new Date(now).toISOString(), data: { ...source.data, srcip: '192.0.2.201' } },
    { ...source, timestamp: new Date(now).toISOString(), data: { ...source.data, count: '1' } },
    (await load('web-injection')).alerts.at(-1)];
  for (const a of cases) assert.equal((await worker.respond(a)).installed, false);
  assert.equal(JSON.parse(await readFile(join(dir, 'state.json'))).rules.length, 0);
  await writeFile(join(dir, 'state.json'), '{malformed');
  await assert.rejects(worker.wrapDecider()(fixtureRequests().normal, { sourceIp: '192.0.2.200' }), /형식/u);
});

test('연결부: 동시 처리 보존·IPv6 정규화·부정확한 반환 거부', async t => {
  const dir = await workspace(t), now = Date.parse('2026-11-01T00:00:00Z');
  const { decide } = await import('../xdr/web-injection/decide.mjs');
  const options = { moduleKey: 'web-injection', decide, statePath: join(dir, 'state.json'), logPath: join(dir, 'log'), clock: () => now };
  const worker = createResponder(options), source = (await load('web-injection')).alerts[0];
  const events = Array.from({ length: 8 }, (_, i) => ({ ...source, id: `wi-${100 + i}`,
    timestamp: new Date(now).toISOString(), data: { ...source.data, srcip: `2001:db8:0:0:0:0:0:${i + 1}` } }));
  await Promise.all(events.map(a => worker.respond(a)));
  assert.equal(JSON.parse(await readFile(options.statePath)).rules.length, 8);
  assert.equal((await worker.wrapDecider()(fixtureRequests().normal, { sourceIp: '2001:db8::1' })).decision, 'deny');
  const invalid = createResponder({ ...options, decide: () => ({ action: 'block', confidence: 0.1, reason: 'bad' }) });
  await assert.rejects(invalid.respond(events[0]), /형식/u);
  assert.throws(() => createResponder({ ...options, ttlMs: Infinity }), /만료/u);
});
