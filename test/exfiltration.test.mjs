import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createContext, Script } from 'node:vm';
import { decide } from '../xdr/exfiltration/decide.mjs';
import { readAlerts, summarizeAlert } from '../xdr/exfiltration/read-alerts.mjs';
import { createResponder, replayFixture } from '../xdr/exfiltration/respond.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = join(root, 'xdr/fixtures/exfiltration.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
// 설명·전송량·수준을 수동 검토한 시험 기대치이며 공식 심판 정답이 아닙니다.
const attacks = ['ex-01','ex-02','ex-03','ex-04','ex-05','ex-06','ex-07','ex-08','ex-09','ex-10'];
const ambiguous = ['ex-11','ex-12','ex-13','ex-14','ex-15','ex-16','ex-17','ex-18','ex-19','ex-20'];
const normal = ['ex-21','ex-22','ex-23','ex-24','ex-25','ex-26','ex-27','ex-28','ex-29','ex-30'];

test('30개 경보를 단독 격리 실행하고 패턴·원본·결과 형식을 확인', async () => {
  const before = await readFile(fixturePath, 'utf8');
  const source = await readFile(join(root, 'xdr/exfiltration/decide.mjs'), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|\b(?:require|fetch|process|readFile|writeFile|eval|Function)\s*[.(]/u);
  const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  new Script(source.replace('export function decide', 'function decide')
    + '\nthis.patterns = JSON.stringify(PATTERNS);').runInContext(context, { timeout: 1000 });
  const patterns = JSON.parse(await readFile(join(root, 'xdr/exfiltration/patterns.json')));
  assert.deepEqual(JSON.parse(context.patterns), patterns);
  for (const p of patterns) {
    assert.ok(p.name && p.condition && p.evidence && p.source);
    assert.doesNotMatch(p.evidence, /[\r\n]/u);
  }
  const counts = { block: 0, alert: 0, record: 0 };
  const original = structuredClone(fixture.alerts);
  for (const alert of fixture.alerts) {
    const result = decide(alert);
    context.input = structuredClone(alert);
    assert.deepEqual(JSON.parse(new Script('JSON.stringify(decide(input))').runInContext(context, { timeout: 1000 })), result);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
    assert.ok(Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1);
    assert.equal(result.action, result.confidence >= 0.85 ? 'block' : result.confidence >= 0.5 ? 'alert' : 'record');
    assert.equal(result.action, attacks.includes(alert.id) ? 'block' : ambiguous.includes(alert.id) ? 'alert' : 'record');
    assert.ok(normal.includes(alert.id) || patterns.some(p => p.name === result.reason));
    counts[result.action]++;
    const renamed = structuredClone(alert);
    renamed.id = 'unrelated-id';
    renamed.data.srcip = '192.0.2.199';
    assert.deepEqual(decide(renamed), result, '경보 ID·특정 IP를 정답표로 사용하지 않음');
  }
  assert.deepEqual(counts, { block: 10, alert: 10, record: 10 });
  assert.deepEqual(fixture.alerts, original);
  assert.equal(await readFile(fixturePath, 'utf8'), before);
});

test('읽기 출력 30줄·다섯 필드·비밀값 가림', async () => {
  const rows = await readAlerts();
  const lines = execFileSync(process.execPath, [join(root, 'xdr/exfiltration/read-alerts.mjs')], { encoding: 'utf8' }).trim().split(/\r?\n/u);
  assert.equal(rows.length, fixture.alerts.length);
  assert.equal(lines.length, rows.length);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['account','description','ruleLevel','sourceAddress','timestamp']);
  for (const value of ['password=synthetic', 'Bearer synthetic', 'api_key=synthetic',
    'ｔｏｋｅｎ=synthetic', 'to\u200bken=synthetic', 'x'.repeat(40), 'https://example.invalid/?secret=synthetic']) {
    const row = summarizeAlert({ data: { srcuser: value }, rule: { description: value } });
    assert.equal(row.account, '[REDACTED]');
    assert.equal(row.description, '[REDACTED]');
  }
});

test('크기·수준·기법 태그만으로 차단하지 않으며 실패·잘못된 주소는 알림', () => {
  for (const invalid of [undefined, null, 1, 'text', [], {}]) assert.equal(decide(invalid).action, 'record');
  const alert = structuredClone(fixture.alerts[0]);
  alert.rule.description = '평소 자료실에 파일을 전송했습니다.';
  assert.notEqual(decide(alert).action, 'block');
  alert.rule.description = '처음 보는 목적지로 전송이 실패했습니다.';
  assert.equal(decide(alert).action, 'alert');
  alert.rule.description = fixture.alerts[0].rule.description;
  alert.data.dstip = '999.0.0.1';
  assert.equal(decide(alert).action, 'alert');
  alert.data.dstip = fixture.alerts[0].data.dstip;
  for (const bytes of ['-1', 'NaN', Infinity, {}, '1e12']) {
    alert.data.bytes = bytes;
    assert.equal(decide(alert).action, 'alert');
  }
});

test('이미 차단·취소된 전송은 새 거부 규칙을 설치하지 않음', async () => {
  const s = await setup();
  for (const description of [
    '처음 보는 목적지로 압축 파일 전송을 차단했습니다.',
    '처음 보는 목적지로 파일 전송이 취소됐습니다.',
    '업무 시간 밖에 전송이 차단되었습니다.',
  ]) {
    const alert = { ...s.attack, rule: { ...s.attack.rule, description } };
    assert.equal(decide(alert).action, 'alert');
    assert.equal((await s.worker.respond(alert)).installed, false);
  }
  assert.equal(JSON.parse(await readFile(s.statePath)).rules.length, 0);
  // 차단이라는 단어가 있어도 전송 성공을 말하는 경우에는 실제 공격 신호를 보존합니다.
  const successful = { ...s.attack, rule: { ...s.attack.rule,
    description: '차단 규칙을 우회해 처음 보는 목적지로 파일 전송이 완료됐습니다.' } };
  assert.equal(decide(successful).action, 'block');
});

async function setup(options = {}) {
  const parent = join(root, 'artifacts');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'exfiltration-test-'));
  const statePath = join(dir, 'deny.json'), logPath = join(dir, 'alerts.log');
  let now = Date.parse('2026-11-01T00:00:00Z');
  const worker = createResponder({ statePath, logPath, clock: () => now, ...options });
  const attack = structuredClone(fixture.alerts[0]);
  attack.timestamp = new Date(now).toISOString();
  const request = fixtureRequests().normal;
  const context = { sourceIp: attack.data.srcip, account: attack.data.srcuser, destinationIp: attack.data.dstip };
  return { worker, attack, request, context, statePath, logPath, advance: ms => { now += ms; } };
}

test('목적지·계정·출발지 범위, 중복·만료, 기존 deny·step_up 보존', async () => {
  const s = await setup(), check = s.worker.wrapDecider();
  s.attack.data.password = 'synthetic-never-persist';
  assert.equal((await s.worker.respond(s.attack)).installed, true);
  const first = JSON.parse(await readFile(s.statePath));
  assert.equal(first.rules[0].destinationIp, s.attack.data.dstip);
  assert.deepEqual(first.rules[0].alertIds, [s.attack.id]);
  assert.equal(Date.parse(first.rules[0].expiresAt) - Date.parse(s.attack.timestamp), 300000);
  assert.equal((await check(s.request, s.context)).decision, 'deny');
  for (const patch of [{ destinationIp: '192.0.2.10' }, { account: 'unrelated-user' }, { sourceIp: '192.0.2.200' }]) {
    assert.equal((await check(s.request, { ...s.context, ...patch })).decision, 'allow');
  }
  assert.equal((await check({ ...s.request, deviceRegistered: false }, s.context)).reasonCode, 'device_not_registered');
  assert.equal((await check(fixtureRequests().suspicious, s.context)).decision, 'step_up');
  await assert.rejects(check(s.request, { ...s.context, destinationIp: undefined }), /destinationIp/u);
  s.advance(1000);
  assert.equal((await s.worker.respond(s.attack)).disposition, 'duplicate');
  assert.deepEqual(JSON.parse(await readFile(s.statePath)), first);
  const saved = await readFile(s.statePath, 'utf8'), log = await readFile(s.logPath, 'utf8');
  for (const text of [s.attack.data.password, s.attack.data.srcuser, s.attack.rule.description]) {
    assert.ok(!saved.includes(text) && !log.includes(text));
  }
  assert.equal(log.trim().split('\n').length, 2);
  s.advance(299000);
  assert.equal((await check(s.request, s.context)).decision, 'allow');
  assert.equal((await s.worker.respond(s.attack)).installed, false, '재전송으로 만료를 연장하지 않음');
});

test('보호 주소·과거/미래·계정 누락·알림·기록은 거부 규칙을 만들지 않음', async () => {
  const s = await setup({ protectedSources: [fixture.alerts[0].data.srcip] });
  assert.equal((await s.worker.respond(s.attack)).disposition, 'protected_source');
  assert.equal(JSON.parse(await readFile(s.statePath)).rules.length, 0);
  const other = await setup();
  for (const alert of [fixture.alerts[0], { ...other.attack, timestamp: '2026-11-01T00:01:00Z' },
    { ...other.attack, data: { ...other.attack.data, srcuser: undefined } }, fixture.alerts[10], fixture.alerts[20]]) {
    assert.equal((await other.worker.respond(alert)).installed, false);
  }
  assert.equal(JSON.parse(await readFile(other.statePath)).rules.length, 0);
  await writeFile(other.statePath, '{broken');
  await assert.rejects(other.worker.wrapDecider()(other.request, other.context), /형식/u);
});

test('동시 쓰기·두 목적지·IPv6 정규화', async () => {
  const s = await setup();
  const events = ['2001:db8::1', '2001:db8::2'].map((dstip, i) => ({ ...s.attack, id: `ex-${100+i}`,
    data: { ...s.attack.data, srcip: '2001:db8:0:0:0:0:0:3', dstip } }));
  await Promise.all(events.map(alert => s.worker.respond(alert)));
  assert.equal(JSON.parse(await readFile(s.statePath)).rules.length, 2);
  const check = s.worker.wrapDecider();
  assert.equal((await check(s.request, { ...s.context, sourceIp: '2001:db8::3', destinationIp: '2001:db8:0:0:0:0:0:1' })).decision, 'deny');
});

test('원본 시각 재연: 공격만 거부·정상 목적지와 다른 계정 통과·만료 해제', async () => {
  const report = await replayFixture();
  assert.deepEqual(report.counts, { block: 10, alert: 10, record: 10 });
  assert.equal(report.blockedRequests, 10);
  assert.equal(report.nonBlockAllowed, 20);
  for (const key of ['safeDestinationAllowed', 'otherAccountAllowed', 'expiredAllowed']) assert.equal(report[key], 30);
});
