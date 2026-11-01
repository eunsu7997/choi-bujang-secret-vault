import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { decide } from '../xdr/known-cve/decide.mjs';
import { createResponder, RULE_IDS } from '../xdr/known-cve/respond.mjs';
import { decide as baseDecide } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureUrl = new URL('../xdr/fixtures/known-cve.json', import.meta.url);
const fixtureBytes = await readFile(fixtureUrl);
const fixture = JSON.parse(fixtureBytes);
const source = await readFile(new URL('../xdr/known-cve/decide.mjs', import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const fixedNow = Date.parse('2026-11-01T12:00:00Z');
const attack = (overrides = {}) => ({ ...structuredClone(fixture.alerts[0]), timestamp: new Date(fixedNow).toISOString(), ...overrides });
const evidence = (request, alert) => ({ ...alert.data, requestId: request.requestId });

async function worker(options = {}) {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const directory = await mkdtemp(join(root, 'artifacts/known-cve-test-'));
  const statePath = join(directory, 'deny.json');
  const logPath = join(directory, 'alerts.log');
  return { ...createResponder({ statePath, logPath, clock: () => fixedNow, ...options }), statePath, logPath };
}

test('24개 수업용 경보의 세 범주와 원본 보존', async () => {
  const counts = { block: 0, alert: 0, record: 0 };
  for (const [index, alert] of fixture.alerts.entries()) {
    const result = decide(alert);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    const expected = index < 8 ? 'block' : index < 16 ? 'alert' : 'record';
    assert.ok(result.action === expected, 'fixture category ' + index);
    assert.ok(!result.reason.includes('\n'));
    counts[result.action]++;
  }
  assert.deepEqual(counts, { block: 8, alert: 8, record: 8 });
  assert.equal(digest(await readFile(fixtureUrl)), digest(fixtureBytes));
});

test('단독 파일의 패턴 상수는 근거가 있는 JSON 목록과 같다', async () => {
  const patterns = JSON.parse(await readFile(new URL('../xdr/known-cve/patterns.json', import.meta.url), 'utf8'));
  const embedded = JSON.parse(/^const PATTERNS = ([\s\S]*?);\r?\n/u.exec(source)[1]);
  assert.deepEqual(embedded, patterns);
  assert.equal(new Set(patterns.map(pattern => pattern.name)).size, patterns.length);
  for (const pattern of patterns) {
    assert.ok(pattern.name && pattern.condition && pattern.evidence.trim());
    assert.ok(!pattern.evidence.includes('\n'));
    assert.ok(pattern.sources.length > 0 && pattern.sources.every(url => url.startsWith('https://')));
  }
  assert.doesNotMatch(source, /\b(?:import|require|fetch|process|XMLHttpRequest|WebSocket|eval)\b/u);
});

test('외부 접근 없는 격리 환경에서 즉시 같은 판정을 반환한다', () => {
  const standalone = runInNewContext(source.replace('export function decide', 'function decide') + '\ndecide;',
    { Date: undefined, console: undefined }, { timeout: 1000 });
  for (const alert of fixture.alerts) {
    const expected = decide(alert);
    const actual = standalone(alert);
    assert.ok(actual.action === expected.action && actual.confidence === expected.confidence && actual.reason === expected.reason);
  }
});

test('경보 번호·계정·수준이 아니라 요청 증거로 차단한다', () => {
  const sample = attack({ id: 'unseen', rule: { level: 0, mitre: [], description: '일반 요청' } });
  sample.data.srcuser = 'user01';
  assert.equal(decide(sample).action, 'block');
  assert.equal(decide({ rule: fixture.alerts[0].rule, data: { url: '/health' } }).action, 'alert');
  assert.equal(decide({ rule: { description: fixture.alerts[0].data.useragent, level: 16 }, data: {} }).action, 'record');
  assert.equal(decide({ data: { headers: { 'User-Agent': fixture.alerts[0].data.useragent } } }).action, 'block');
  for (const input of [null, undefined, [], 'text', 3, {}, { data: null }]) assert.equal(decide(input).action, 'record');
});

test('점검 도구 이름·CVE 언급·T1190 태그는 합쳐져도 차단하지 않는다', () => {
  const result = decide({ data: { useragent: 'nuclei', url: '/search?q=CVE-2021-44228' },
    rule: { mitre: { id: ['T1190'] }, level: 16 } });
  assert.equal(result.action, 'alert');
  assert.ok(result.confidence < 0.85);
  const large = { data: { headers: Object.fromEntries(Array.from({ length: 100 }, (_, i) => ['h' + i, 'x'.repeat(20000)])) } };
  const before = performance.now();
  assert.equal(decide(large).action, 'record');
  assert.ok(performance.now() - before < 2000);
});

test('연결 모듈이 차단 후보만 추가하고 응답 다섯 항목을 유지한다', async () => {
  const responder = await worker();
  const alert = attack();
  const result = await responder.respond(alert, decide(alert));
  assert.equal(result.installed, true);
  const state = JSON.parse(await readFile(responder.statePath, 'utf8'));
  assert.equal(state.rules.length, 1);
  assert.deepEqual(state.rules[0].alertIds, ['kc-01']);
  assert.equal(Date.parse(state.rules[0].expiresAt), fixedNow + 300000);
  const request = fixtureRequests().normal;
  const gate = responder.wrapDecider();
  const denied = await gate(request, evidence(request, alert));
  assert.equal(denied.decision, 'deny');
  assert.equal(denied.reasonCode, 'xdr_known_cve_blocked');
  assert.deepEqual(Object.keys(denied).sort(), ['decision', 'reasonCode', 'requestId', 'ruleIds', 'schema']);
  assert.ok(denied.ruleIds.every(rule => RULE_IDS.includes(rule)));
  for (const item of fixture.alerts.slice(8)) {
    await responder.respond({ ...item, timestamp: new Date(fixedNow).toISOString() });
    assert.equal((await gate(request, evidence(request, item))).decision, 'allow');
  }
  assert.equal(JSON.parse(await readFile(responder.statePath, 'utf8')).rules.length, 1);
});

test('같은 IP의 정상 요청과 다른 IP 요청은 통과하고 기존 거부·추가 인증은 유지한다', async () => {
  const responder = await worker();
  const alert = attack();
  await responder.respond(alert);
  const { normal, suspicious } = fixtureRequests();
  const gate = responder.wrapDecider();
  assert.equal((await gate(normal, { requestId: normal.requestId, srcip: alert.data.srcip, url: '/health' })).decision, 'allow');
  assert.equal((await gate(normal, { ...evidence(normal, alert), srcip: '192.0.2.250' })).decision, 'allow');
  const noDevice = { ...normal, deviceRegistered: false };
  assert.deepEqual(await gate(noDevice), await baseDecide(noDevice));
  assert.deepEqual(await gate(suspicious), await baseDecide(suspicious));
  await assert.rejects(() => gate(normal), /서버가 확인한 요청 증거/u);
  await assert.rejects(() => gate(normal, { ...evidence(normal, alert), requestId: 'unrelated' }), /요청 증거/u);
});

test('중복·동시 경보는 규칙을 복제하거나 만료를 연장하지 않는다', async () => {
  let now = fixedNow;
  const responder = await worker({ clock: () => now });
  const alert = attack();
  const outcomes = await Promise.all(Array.from({ length: 8 }, () => responder.respond(alert)));
  assert.equal(outcomes.filter(result => result.installed).length, 1);
  const state = JSON.parse(await readFile(responder.statePath, 'utf8'));
  assert.equal(state.rules.length, 1);
  now += 299999;
  assert.equal((await responder.respond(alert)).installed, false);
  assert.equal(JSON.parse(await readFile(responder.statePath, 'utf8')).rules[0].expiresAt, state.rules[0].expiresAt);
  now++;
  const request = fixtureRequests().normal;
  assert.equal((await responder.wrapDecider()(request, evidence(request, alert))).decision, 'allow');
  assert.equal((await responder.respond(alert)).installed, false);
  assert.equal(JSON.parse(await readFile(responder.statePath, 'utf8')).rules.length, 0);
});

test('오래된·미래·잘못된 출발 주소의 경보와 보호 주소는 규칙을 만들지 않는다', async () => {
  for (const overrides of [
    { timestamp: new Date(fixedNow - 300000).toISOString() },
    { timestamp: new Date(fixedNow + 5001).toISOString() },
    { timestamp: 'invalid' },
    { data: { ...attack().data, srcip: '127.0.0.1' } },
    { data: { ...attack().data, srcip: 'not-an-ip' } },
  ]) {
    const responder = await worker();
    assert.equal((await responder.respond(attack(overrides))).installed, false);
    assert.equal(JSON.parse(await readFile(responder.statePath, 'utf8')).rules.length, 0);
  }
  const responder = await worker({ protectedSources: [attack().data.srcip] });
  assert.equal((await responder.respond(attack())).disposition, 'protected_source');
});

test('위조된 block 결과는 거절하고 손상된 규칙은 오류로 처리한다', async () => {
  const responder = await worker();
  await assert.rejects(() => responder.respond(fixture.alerts[16], { action: 'block', confidence: 1, reason: 'forged' }), /일치하지/u);
  await writeFile(responder.statePath, '{"schema":"wrong","rules":[]}');
  await assert.rejects(() => responder.respond(attack()), /형식 오류/u);
  assert.throws(() => createResponder({ ttlMs: 900001 }), /만료/u);
});

test('로그와 상태에 원문·계정·비밀값·출발 IP를 보관하지 않는다', async () => {
  const responder = await worker();
  const alert = attack({ id: 'password=synthetic-only' });
  alert.data.srcuser = 'private-account';
  alert.data.headers = { Authorization: 'Bearer synthetic-only' };
  await responder.respond(alert);
  const state = await readFile(responder.statePath, 'utf8');
  const log = await readFile(responder.logPath, 'utf8');
  for (const value of ['synthetic-only', 'private-account', alert.data.srcip, alert.data.useragent]) {
    assert.ok(!state.includes(value) && !log.includes(value), 'private value excluded');
  }
  assert.equal(log.trim().split('\n').length, 1);
  const event = JSON.parse(log);
  assert.equal(event.reason, 'log4shell_remote_lookup');
  assert.match(event.alertId, /^event-[a-f0-9]{24}$/u);
});
