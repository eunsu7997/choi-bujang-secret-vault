import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { decide } from '../xdr/brute-force/decide.mjs';
import { readAlerts, projectAlert } from '../xdr/brute-force/read-alerts.mjs';
import { createResponder, RULE_IDS } from '../xdr/brute-force/respond.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = join(root, 'xdr/fixtures/brute-force.json');
const fixtureBytes = await readFile(fixturePath);
const fixture = JSON.parse(fixtureBytes);
const clone = value => structuredClone(value);
const attack = () => clone(fixture.alerts[0]);
async function sandbox(options = {}) {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const directory = await mkdtemp(join(root, 'artifacts/brute-force-test-'));
  const paths = { statePath: join(directory, 'deny.json'), logPath: join(directory, 'alerts.log') };
  let now = Date.parse(fixture.alerts[0].timestamp) + 1;
  const config = { ...paths, clock: () => now, ...options };
  return { ...createResponder(config), paths, config, setNow(value) { now = value; } };
}

test('28 supplied alerts: clear attacks block, ambiguous attempts alert, ordinary events record', () => {
  const expected = [...Array(10).fill('block'), ...Array(9).fill('alert'), ...Array(9).fill('record')];
  // Expected labels are a manual semantic review of the fixture, not a judge result.
  assert.equal(fixture.alerts.length, expected.length);
  fixture.alerts.forEach((alert, index) => {
    const actual = decide(alert);
    assert.equal(actual.action, expected[index], alert.id);
    assert.deepEqual(Object.keys(actual).sort(), ['action', 'confidence', 'reason']);
    assert.ok(actual.confidence >= 0 && actual.confidence <= 1);
    assert.equal(actual.action, actual.confidence >= 0.85 ? 'block' : actual.confidence >= 0.5 ? 'alert' : 'record');
  });
});

test('standalone decision has no imports; isolated evaluation and renamed inputs give the same answers', async () => {
  const source = await readFile(join(root, 'xdr/brute-force/decide.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|fetch|process)\b/u);
  const isolated = source.replace('export function decide', 'function decide');
  const context = { alerts: clone([...fixture.alerts].reverse()) };
  const result = runInNewContext(`${isolated}\nalerts.map(decide)`, context, { timeout: 2000 });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), context.alerts.map(decide));
  for (const alert of fixture.alerts) {
    const renamed = clone(alert);
    renamed.id = 'unrelated-id';
    renamed.data.srcip = '198.51.100.190';
    renamed.data.srcuser = 'renamed-user';
    assert.deepEqual(decide(renamed), decide(alert));
    assert.deepEqual(decide(alert), decide(alert));
  }
  const patterns = JSON.parse(await readFile(join(root, 'xdr/brute-force/patterns.json'), 'utf8'));
  const inline = runInNewContext(`${isolated}\nJSON.stringify(PATTERNS)`, {}, { timeout: 2000 });
  assert.deepEqual(JSON.parse(inline), patterns);
  assert.ok(patterns.every(pattern => pattern.evidence && pattern.source.startsWith('https://attack.mitre.org/')));
});

test('thresholds and missing evidence cannot silently become high confidence', () => {
  const a = attack();
  a.data.count = 29;
  assert.equal(decide(a).action, 'alert');
  a.data.count = 30;
  assert.equal(decide(a).action, 'block');
  a.rule.description = '같은 주소·계정에서 10분 동안 로그인 실패';
  a.data.count = 100;
  assert.equal(decide(a).action, 'alert');
  a.rule.description = '로그인 실패가 반복됨';
  a.data.count = 39;
  assert.equal(decide(a).action, 'alert');
  a.data.count = 40;
  assert.equal(decide(a).action, 'block');
  for (const invalid of ['', 'unknown', '999.1.1.1', '127.00.0.1', '2001:::1']) {
    a.data.srcip = invalid;
    assert.equal(decide(a).action, 'alert');
  }
  a.data.srcip = '2001:db8::1';
  assert.equal(decide(a).action, 'block');
  a.data.srcuser = '';
  assert.equal(decide(a).action, 'alert');
  a.data.srcuser = 'user01';
  a.rule.level = 99;
  assert.equal(decide(a).action, 'alert');
  a.rule.level = 12;
  a.rule.description = '로그인 실패 이후 정상 로그인 성공';
  assert.equal(decide(a).action, 'alert');
  a.rule.description = '로그인 성공';
  assert.equal(decide(a).action, 'record');
  a.rule.description = '인증 실패는 없습니다';
  assert.equal(decide(a).action, 'record');
  for (const value of [null, [], {}, true, 'bad', { rule: null, data: {} }]) assert.equal(decide(value).action, 'record');
});

test('multiple accounts alone do not prove password spraying and duplicates do not inflate targets', () => {
  const a = clone(fixture.alerts[1]);
  a.data.accounts = Array(8).fill('same-account');
  a.rule.description = '같은 비밀번호로 여러 계정에 로그인 시도';
  assert.notEqual(decide(a).action, 'block');
  a.data.accounts = Array.from({ length: 8 }, (_, i) => `user-${i}`);
  assert.equal(decide(a).action, 'block');
  a.rule.description = '여러 계정 로그인 실패';
  a.data.count = 8;
  assert.equal(decide(a).action, 'alert');
});

test('reader preserves one row per alert and projects only five safe fields', async () => {
  const rows = await readAlerts();
  assert.equal(rows.length, fixture.alerts.length);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['account', 'description', 'level', 'sourceIp', 'timestamp']);
  const a = attack();
  a.rule.description = 'password=FAKE_TEST_CANARY';
  a.data.srcuser = 'example@example.invalid';
  a.data.password = 'FAKE_TEST_CANARY';
  a.full_log = 'FAKE_TEST_CANARY';
  assert.doesNotMatch(JSON.stringify(projectAlert(a)), /FAKE_TEST_CANARY|example@/u);
  assert.deepEqual(await readFile(fixturePath), fixtureBytes);
  const cli = spawnSync(process.execPath, ['xdr/brute-force/read-alerts.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(cli.stdout.trim().split('\n').length, fixture.alerts.length);
  for (const key of ['password', 'token', 'full_log']) Object.defineProperty(a.data, key, { get() { throw new Error('secret field read'); } });
  assert.doesNotThrow(() => decide(a));
  assert.doesNotThrow(() => projectAlert(a));
});

test('response installs evidence with expiry, enforces deny, preserves base deny and step_up, and expires', async () => {
  const worker = await sandbox();
  const a = attack();
  assert.equal((await worker.respond(a)).installed, true);
  const state = JSON.parse(await readFile(worker.paths.statePath, 'utf8'));
  assert.equal(state.rules.length, 1);
  assert.deepEqual(state.rules[0].alertIds, [a.id]);
  assert.equal(Date.parse(state.rules[0].expiresAt), Date.parse(a.timestamp) + 300000);
  const gate = worker.wrapDecider();
  const requests = fixtureRequests();
  const blocked = await gate(requests.normal, a.data.srcip);
  assert.equal(blocked.decision, 'deny');
  assert.ok(blocked.ruleIds.every(id => RULE_IDS.includes(id)));
  assert.equal((await gate(requests.normal, '192.0.2.250')).decision, 'allow');
  assert.equal((await gate({ ...requests.normal, deviceRegistered: false }, a.data.srcip)).reasonCode, 'device_not_registered');
  assert.equal((await gate(requests.suspicious, a.data.srcip)).decision, 'step_up');
  await assert.rejects(gate({ ...requests.normal, ip: a.data.srcip }), /검증한 접속 IP/u);
  worker.setNow(Date.parse(a.timestamp) + 1000);
  assert.equal((await worker.respond(a)).disposition, 'duplicate');
  assert.equal(JSON.parse(await readFile(worker.paths.statePath, 'utf8')).rules[0].expiresAt, state.rules[0].expiresAt);
  const restart = createResponder(worker.config);
  assert.equal((await restart.wrapDecider()(requests.normal, a.data.srcip)).decision, 'deny');
  worker.setNow(Date.parse(state.rules[0].expiresAt));
  assert.equal((await gate(requests.normal, a.data.srcip)).decision, 'allow');
  assert.equal((await worker.respond(a)).installed, false);
});

test('ambiguous, normal, stale, future, protected and non-routable sources create no deny rule', async () => {
  const worker = await sandbox({ protectedSources: ['203.0.113.10'] });
  assert.equal((await worker.respond(attack())).disposition, 'protected_source');
  for (const alert of fixture.alerts.slice(10)) assert.equal((await worker.respond(alert)).installed, false);
  const a = attack();
  a.data.srcip = '198.51.100.9';
  a.timestamp = new Date(Date.parse(a.timestamp) + 60000).toISOString();
  assert.equal((await worker.respond(a)).installed, false);
  a.timestamp = new Date(Date.parse(a.timestamp) - 900000).toISOString();
  assert.equal((await worker.respond(a)).installed, false);
  a.timestamp = fixture.alerts[0].timestamp;
  for (const ip of ['0.0.0.0', '127.0.0.1', '224.0.0.1', '::1', 'ff02::1']) {
    a.data.srcip = ip;
    assert.equal((await worker.respond(a)).installed, false);
  }
  assert.equal(JSON.parse(await readFile(worker.paths.statePath, 'utf8')).rules.length, 0);
});

test('concurrent responses keep both rules; logs omit raw account, description and secrets', async () => {
  const worker = await sandbox();
  const a = attack();
  a.data.srcuser = 'PRIVATE_ACCOUNT_CANARY';
  a.data.password = 'FAKE_TEST_CANARY';
  const b = clone(a);
  b.id = 'bf-99';
  b.data.srcip = '198.51.100.99';
  await Promise.all([worker.respond(a), worker.respond(b)]);
  assert.equal(JSON.parse(await readFile(worker.paths.statePath, 'utf8')).rules.length, 2);
  const logs = await readFile(worker.paths.logPath, 'utf8');
  assert.equal(logs.trim().split('\n').length, 2);
  assert.doesNotMatch(logs, /PRIVATE_ACCOUNT_CANARY|FAKE_TEST_CANARY|203\.0\.113\.10/u);
  await writeFile(worker.paths.statePath, 'corrupt');
  await assert.rejects(worker.respond(a), /형식 오류/u);
  assert.equal(await readFile(worker.paths.statePath, 'utf8'), 'corrupt');
});
