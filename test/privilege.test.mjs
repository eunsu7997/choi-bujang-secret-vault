import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createContext, Script } from 'node:vm';
import { decide } from '../xdr/privilege/decide.mjs';
import { createResponder } from '../xdr/privilege/respond.mjs';
import { summarizeAlert } from '../xdr/privilege/read-alerts.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = join(root, 'xdr/fixtures/privilege.json');
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
// 설명을 수동 검토한 로컬 기대치입니다. 판단 모듈에서는 읽지 않습니다.
// pv-13(변경 없음), pv-17(목록 읽기/설명 변경)도 기록 대상입니다.
const expected = new Map(fixture.alerts.map(a => [a.id,
  ['pv-01', 'pv-02', 'pv-03', 'pv-04', 'pv-05', 'pv-06', 'pv-07', 'pv-08', 'pv-09'].includes(a.id)
    ? 'block' : ['pv-10', 'pv-11', 'pv-12', 'pv-14', 'pv-15', 'pv-16'].includes(a.id) ? 'alert' : 'record']));
const event = (description, overrides = {}) => ({ timestamp: '2026-11-01T00:00:00Z', id: 'pv-900',
  rule: { level: 12, description }, data: { srcip: '192.0.2.99', srcuser: 'fixture-user', group: 'administrators' },
  ...overrides });
async function workspace(t) {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const path = await mkdtemp(join(root, 'artifacts/privilege-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('제공 경보: 수동 검토 기대치·확신도·정상 오차단 0·원본 불변', async () => {
  const raw = await readFile(fixturePath, 'utf8'), original = structuredClone(fixture.alerts);
  const counts = { block: 0, alert: 0, record: 0 };
  for (const a of fixture.alerts) {
    const result = decide(a);
    assert.equal(result.action, expected.get(a.id), a.id);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
    assert.equal(result.action, result.confidence >= 0.85 ? 'block' : result.confidence >= 0.5 ? 'alert' : 'record');
    assert.ok(Number.isFinite(result.confidence) && result.confidence >= 0 && result.confidence <= 1);
    assert.match(result.reason, /^[a-z][a-z0-9_]+$/u);
    counts[result.action]++;
    const renamed = structuredClone(a);
    renamed.id = 'unrelated-id'; renamed.data.srcuser = 'another-account'; renamed.data.srcip = '2001:db8::9';
    assert.deepEqual(decide(renamed), result, 'ID·계정·주소별 정답표 사용 금지');
  }
  assert.deepEqual(counts, { block: 9, alert: 6, record: 11 });
  assert.deepEqual(fixture.alerts, original);
  assert.equal(await readFile(fixturePath, 'utf8'), raw);
});

test('부정·실패·안내 조회를 실제 공격으로 오인하지 않음', () => {
  for (const description of [
    '원격 주소에서 관리자 그룹 추가 안내를 읽기만 했습니다.',
    '원격 주소에서 관리자 그룹 추가는 없었습니다.',
    '원격 주소에서 관리자 명령 실행은 없었습니다.',
    '원격 주소에서 관리자 그룹에 추가된 적이 없습니다.',
    '원격 주소에서 관리자 그룹 추가를 하지 않았습니다.',
    '처음 보는 주소에서 관리자 명령을 실행하지 않았습니다.',
    'Administrator command was never executed from a new source IP.',
    'Read documentation about users added to administrators from a remote address.',
  ]) assert.equal(decide(event(description)).action, 'record', description);
  for (const description of [
    '원격 주소에서 관리자 그룹 추가가 실패했습니다.',
    '처음 보는 주소에서 관리자 명령 실행이 취소됐습니다.',
    'User added to administrators from a remote address: failed.',
  ]) assert.equal(decide(event(description)).action, 'alert', description);
});

test('높은 수준·반복 횟수·MITRE 표지·시간 외 신호만으로는 차단하지 않음', () => {
  for (const description of [
    '평소 주소에서 관리자 명령이 한 번 실행됐습니다.',
    '업무 시간 밖에 관리자 명령을 실행했습니다.',
    '관리자 그룹에 계정이 추가됐습니다.',
    '승인된 정기 작업으로 원격 주소에서 관리자 그룹에 추가됐습니다.',
  ]) assert.equal(decide(event(description)).action, 'alert', description);
  const benign = event('정상 로그인했습니다.');
  benign.rule.mitre = ['T1068', 'T1078']; benign.data.count = '99999';
  assert.equal(decide(benign).action, 'record');
  assert.equal(decide(event('원격 주소에서 과제 그룹에 추가됐습니다.', {
    data: { srcip: '192.0.2.99', srcuser: 'fixture-user', group: 'project-week3', count: '999' },
  })).action, 'alert');
});

test('명확한 실제 행위 결합은 차단하고 필수 정보 누락/비정상 수준은 알림', () => {
  for (const description of [
    '평범한 계정이 관리자 그룹에 추가됐습니다.',
    '처음 보는 주소에서 관리자 명령을 실행했습니다.',
    '방금 관리자가 된 계정이 관리자 명령을 실행했습니다.',
    'User was added to administrators from a remote address.',
    'Privileged command executed from an unseen source IP.',
  ]) assert.equal(decide(event(description)).action, 'block', description);
  const a = event('원격 주소에서 관리자 그룹에 추가됐습니다.');
  for (const level of [undefined, null, NaN, Infinity, -1, 9, 17, 999, '12junk']) {
    const altered = structuredClone(a); altered.rule.level = level;
    assert.equal(decide(altered).action, 'alert');
  }
  for (const data of [{}, { srcip: 'not-an-ip', srcuser: 'user', group: 'administrators' },
    { ...a.data, srcuser: ' ' }, { ...a.data, srcuser: 'x'.repeat(201) }]) {
    assert.equal(decide({ ...a, data }).action, 'alert');
  }
  for (const invalid of [null, undefined, [], {}, 1, 'string', { data: [], rule: {} }]) {
    assert.equal(decide(invalid).action, 'record');
  }
});

test('판단 파일만 외부 기능 없는 격리 환경에서 실행·패턴 일치·근거 한 줄', async () => {
  const source = await readFile(join(root, 'xdr/privilege/decide.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|fetch|process|Date\.now)\b/u);
  const patterns = JSON.parse(await readFile(join(root, 'xdr/privilege/patterns.json'), 'utf8'));
  const context = createContext({}, { codeGeneration: { strings: false, wasm: false } });
  new Script(source.replace('export function decide', 'function decide')
    + '\nthis.run = decide; this.patterns = JSON.stringify(PATTERNS);').runInContext(context, { timeout: 1000 });
  assert.deepEqual(JSON.parse(context.patterns), patterns);
  assert.match(JSON.stringify(patterns), /T1068/u); assert.match(JSON.stringify(patterns), /T1078/u);
  for (const p of patterns) {
    assert.ok(p.name && p.condition && p.evidence && p.sources.length);
    assert.doesNotMatch(p.evidence, /[\r\n]/u);
  }
  for (const a of fixture.alerts) {
    context.input = structuredClone(a);
    const result = new Script('JSON.stringify(run(input))').runInContext(context, { timeout: 1000 });
    assert.deepEqual(JSON.parse(result), decide(a));
  }
});

test('읽기 CLI: 다른 작업 폴더에서도 26건=26줄·5개 필드·비밀값 가림', () => {
  const lines = execFileSync(process.execPath, [join(root, 'xdr/privilege/read-alerts.mjs')],
    { cwd: tmpdir(), encoding: 'utf8' }).trim().split(/\r?\n/u).map(JSON.parse);
  assert.equal(lines.length, fixture.alerts.length);
  for (const line of lines) assert.deepEqual(Object.keys(line), ['timestamp', 'sourceAddress', 'account', 'ruleLevel', 'description']);
  for (const value of ['password=synthetic', 'ｔｏｋｅｎ=synthetic', 'pass\u200bword=synthetic',
    'Bearer synthetic', 'synthetic@example.invalid', 'A'.repeat(64)]) {
    const line = summarizeAlert({ data: { srcuser: value, password: 'never-output' }, rule: { description: value } });
    assert.equal(line.account, '[REDACTED]'); assert.equal(line.description, '[REDACTED]');
    assert.ok(!JSON.stringify(line).includes('never-output'));
  }
});

test('연결 재연: 검토한 공격만 거부·정상/같은 IP 다른 계정 허용·기존 판정 보존', async t => {
  const dir = await workspace(t); let now = Date.parse('2026-11-01T00:00:00Z');
  const statePath = join(dir, 'state.json'), logPath = join(dir, 'alerts.log');
  const worker = createResponder({ statePath, logPath, clock: () => now });
  const gate = worker.wrapDecider(), request = fixtureRequests().normal;
  for (const original of fixture.alerts) {
    const a = structuredClone(original); a.timestamp = new Date(now).toISOString();
    const decision = await worker.respond(a), category = expected.get(a.id);
    assert.equal(decision.installed, category === 'block', a.id);
    const ctx = { sourceIp: a.data.srcip, account: a.data.srcuser };
    assert.equal((await gate(request, ctx)).decision, category === 'block' ? 'deny' : 'allow', a.id);
    assert.equal((await gate(request, { ...ctx, account: 'unrelated-user' })).decision, 'allow');
  }
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(state.rules.length, 8); // pv-01·pv-02는 같은 출발 주소/계정입니다.
  assert.equal(state.rules.flatMap(r => r.alertIds).length, 9);
  for (const r of state.rules) {
    assert.equal(Date.parse(r.expiresAt) - Date.parse(r.evidenceAt), 300000);
    assert.equal(r.action, 'deny'); assert.ok(r.accountHash);
  }
  const ctx = { sourceIp: fixture.alerts[0].data.srcip, account: fixture.alerts[0].data.srcuser };
  assert.equal((await gate({ ...request, deviceRegistered: false }, ctx)).reasonCode, 'device_not_registered');
  assert.equal((await gate(fixtureRequests().suspicious, ctx)).decision, 'step_up');
  now += 300001;
  assert.equal((await gate(request, ctx)).decision, 'allow');
  assert.equal((await worker.respond({ ...fixture.alerts[0], timestamp: '2026-11-01T00:00:00Z' })).installed, false);
  const log = await readFile(logPath, 'utf8');
  assert.equal(log.trim().split('\n').length, 27);
  assert.ok(!log.includes('user01') && !log.includes(fixture.alerts[0].rule.description));
});

test('연결 경계: 중복·과거/미래·보호 주소·루프백·잘못된 시각·깨진 상태', async t => {
  const dir = await workspace(t); let now = Date.parse('2026-11-01T00:00:00Z');
  const statePath = join(dir, 'state.json'), logPath = join(dir, 'alerts.log');
  const worker = createResponder({ statePath, logPath, clock: () => now, protectedSources: ['192.0.2.77'] });
  const a = event('원격 주소에서 관리자 그룹에 추가됐습니다.');
  a.data.password = 'synthetic-never-output';
  assert.equal((await worker.respond(a)).installed, true);
  const before = await readFile(statePath, 'utf8'); now += 1000;
  assert.equal((await worker.respond(a)).disposition, 'duplicate');
  assert.equal(await readFile(statePath, 'utf8'), before);
  for (const timestamp of ['invalid', '2026-09-27T00:00:00Z', new Date(now + 60000).toISOString()]) {
    assert.equal((await worker.respond({ ...a, timestamp })).installed, false);
  }
  for (const srcip of ['192.0.2.77', '127.0.0.1', '::1', '0.0.0.0', 'ff02::1']) {
    assert.equal((await worker.respond({ ...a, data: { ...a.data, srcip } })).installed, false);
  }
  const gate = worker.wrapDecider(), request = fixtureRequests().normal;
  await assert.rejects(gate(request, { account: 'user' }), /sourceIp/u);
  await assert.rejects(gate(request, { sourceIp: '192.0.2.99' }), /계정/u);
  assert.ok(!(await readFile(logPath, 'utf8')).includes('synthetic-never-output'));
  await writeFile(statePath, '{invalid');
  await assert.rejects(gate(request, { sourceIp: '192.0.2.99', account: 'fixture-user' }), /형식/u);
});
