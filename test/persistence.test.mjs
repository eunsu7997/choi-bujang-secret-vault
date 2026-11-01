import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { decide } from '../xdr/persistence/decide.mjs';
import { readAlerts, summarizeAlert } from '../xdr/persistence/read-alerts.mjs';
import { createResponder, RULE_IDS } from '../xdr/persistence/respond.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = join(root, 'xdr/fixtures/persistence.json');
const original = await readFile(fixturePath);
const { alerts } = JSON.parse(original);
const clone = value => structuredClone(value);
async function setup(options = {}) {
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const dir = await mkdtemp(join(root, 'artifacts/persistence-test-'));
  let at = Date.parse(alerts[0].timestamp) + 1;
  const config = { statePath: join(dir, 'state.json'), logPath: join(dir, 'log'), clock: () => at, ...options };
  return { ...createResponder(config), config, advance(ms) { at += ms; } };
}

test('fixture semantic review: 8 attacks, 8 ambiguous events, 8 normal events', () => {
  alerts.forEach((a, i) => {
    const result = decide(a);
    assert.equal(result.action, i < 8 ? 'block' : i < 16 ? 'alert' : 'record', a.id);
    assert.deepEqual(Object.keys(result).sort(), ['action', 'confidence', 'reason']);
    assert.ok(result.confidence >= 0 && result.confidence <= 1);
    assert.equal(result.action, result.confidence >= .85 ? 'block' : result.confidence >= .5 ? 'alert' : 'record');
  });
});

test('single file runs without imports, globals or state and matches the pattern list', async () => {
  const source = await readFile(join(root, 'xdr/persistence/decide.mjs'), 'utf8');
  assert.doesNotMatch(source, /\b(?:import|require|fetch|process|readFile|writeFile)\b/u);
  const code = source.replace('export function decide', 'function decide');
  const result = runInNewContext(`${code}; JSON.stringify({patterns:PATTERNS,results:alerts.map(decide)})`, { alerts: clone(alerts) }, { timeout: 1000 });
  const isolated = JSON.parse(result);
  assert.deepEqual(isolated.results, alerts.map(decide));
  assert.deepEqual(isolated.patterns, JSON.parse(await readFile(join(root, 'xdr/persistence/patterns.json'))));
  for (const a of [...alerts].reverse()) {
    const changed = clone(a);
    changed.id = 'different-id'; changed.data.srcip = '192.0.2.199'; changed.data.srcuser = 'different-user';
    assert.deepEqual(decide(changed), decide(a));
  }
});

test('uncertain signatures, invalid evidence, explicit no-change and read-only events never block', () => {
  for (const a of [null, [], {}, 1, 'bad']) assert.equal(decide(a).action, 'record');
  const a = clone(alerts[0]);
  a.rule.description = '새 서비스가 임시 폴더에 있습니다. 서명은 아직 확인되지 않았습니다.';
  assert.notEqual(decide(a).action, 'block');
  a.rule.description = '서명 없는 새 서비스 등록은 없습니다.';
  assert.notEqual(decide(a).action, 'block');
  a.rule.description = '서명 없는 새 서비스 목록을 읽기만 했습니다.';
  assert.equal(decide(a).action, 'record');
  for (const level of [0, 9, 99, Infinity, -1]) {
    const b = clone(alerts[0]); b.rule.level = level;
    assert.notEqual(decide(b).action, 'block');
  }
  for (const ip of ['', '999.1.1.1', '2001:::1']) {
    const b = clone(alerts[0]); b.data.srcip = ip;
    assert.notEqual(decide(b).action, 'block');
  }
  Object.defineProperty(a.data, 'password', { get() { throw new Error('secret read'); } });
  assert.doesNotThrow(() => decide(a));
});

test('reader outputs 24 five-field rows, preserves source and redacts secret-looking text', async () => {
  const rows = await readAlerts();
  assert.equal(rows.length, alerts.length);
  rows.forEach(row => assert.deepEqual(Object.keys(row).sort(), ['account', 'description', 'ruleLevel', 'sourceAddress', 'timestamp']));
  for (const value of ['password=FAKE_CANARY', 'api key: FAKE_CANARY', 't\u200boken=FAKE_CANARY', 'user@example.invalid']) {
    const row = summarizeAlert({ data: { srcuser: value }, rule: { description: value } });
    assert.equal(row.account, '[REDACTED]'); assert.equal(row.description, '[REDACTED]');
  }
  const stdout = execFileSync(process.execPath, ['xdr/persistence/read-alerts.mjs'], { cwd: root, encoding: 'utf8' });
  assert.equal(stdout.trim().split('\n').length, 24);
  assert.deepEqual(await readFile(fixturePath), original);
});

test('device quarantine survives account changes, preserves other devices and base rules, and expires', async () => {
  const w = await setup(), request = fixtureRequests().normal, context = { deviceId: request.deviceId };
  assert.equal((await w.respond(alerts[0], context)).installed, true);
  const gate = w.wrapDecider();
  const result = await gate(request);
  assert.equal(result.decision, 'deny');
  assert.ok(result.ruleIds.every(rule => RULE_IDS.includes(rule)));
  assert.equal((await gate({ ...request, subjectId: 'other-account' })).decision, 'deny');
  assert.equal((await gate({ ...request, deviceId: 'b'.repeat(16) })).decision, 'allow');
  assert.equal((await gate({ ...request, deviceRegistered: false })).reasonCode, 'device_not_registered');
  assert.equal((await gate(fixtureRequests().suspicious)).decision, 'step_up');
  const state = JSON.parse(await readFile(w.config.statePath));
  assert.deepEqual(state.rules[0].alertIds, ['ps-01']);
  assert.equal(Date.parse(state.rules[0].expiresAt), Date.parse(alerts[0].timestamp) + 300000);
  w.advance(1000);
  assert.equal((await w.respond(alerts[0], context)).disposition, 'duplicate');
  assert.deepEqual(JSON.parse(await readFile(w.config.statePath)), state);
  assert.equal((await createResponder(w.config).wrapDecider()(request)).decision, 'deny');
  w.advance(300000);
  assert.equal((await gate(request)).decision, 'allow');
  assert.equal((await w.respond(alerts[0], context)).installed, false);
});

test('missing mapping, protected device, future events and ambiguous events install no quarantine', async () => {
  const w = await setup({ protectedDevices: ['c'.repeat(16)] });
  assert.equal((await w.respond(alerts[0])).disposition, 'missing_device_mapping');
  assert.equal((await w.respond(alerts[0], { deviceId: 'c'.repeat(16) })).disposition, 'protected_device');
  const future = clone(alerts[0]); future.timestamp = new Date(Date.parse(future.timestamp) + 60000).toISOString();
  assert.equal((await w.respond(future, { deviceId: 'b'.repeat(16) })).installed, false);
  for (const a of alerts.slice(8)) assert.equal((await w.respond(a, { deviceId: 'b'.repeat(16) })).installed, false);
  assert.equal(JSON.parse(await readFile(w.config.statePath)).rules.length, 0);
});

test('concurrent writes preserve evidence, logs omit secrets, corrupted state is not overwritten', async () => {
  const w = await setup(), a = clone(alerts[0]);
  a.data.password = 'FAKE_CANARY'; a.data.srcuser = 'PRIVATE_CANARY';
  await Promise.all(['a'.repeat(16), 'b'.repeat(16)].map(deviceId => w.respond(a, { deviceId })));
  const state = await readFile(w.config.statePath, 'utf8'), logs = await readFile(w.config.logPath, 'utf8');
  assert.equal(JSON.parse(state).rules.length, 2);
  assert.equal(logs.trim().split('\n').length, 2);
  assert.doesNotMatch(state + logs, /FAKE_CANARY|PRIVATE_CANARY|aaaaaaaaaaaaaaaa|203\.0\.113\.12/u);
  await writeFile(w.config.statePath, 'bad state');
  await assert.rejects(w.respond(a, { deviceId: 'a'.repeat(16) }), /형식 오류/u);
  assert.equal(await readFile(w.config.statePath, 'utf8'), 'bad state');
});
