import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const KEYS = 'decision,reasonCode,requestId,ruleIds,schema';
const run = async (base, changes = {}) => {
  const request = { ...base, requestId: randomUUID(), ...changes };
  const response = await decide(request);
  assert.equal(Object.keys(response).sort().join(','), KEYS);
  assert.equal(response.requestId, request.requestId);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)));
  return response;
};
const sig = (region, network, hour, source = 'judge_fixture') => ({ source, region, network, hour });
const burst = [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }];

test('normal is allowed and the composite unusual access needs step-up', async () => {
  const { normal, suspicious } = fixtureRequests();
  assert.equal((await run(normal)).decision, 'allow');
  const r = await run(suspicious);
  assert.equal(r.decision, 'step_up');
  assert.equal(r.reasonCode, 'step_up_required');
  assert.deepEqual(r.ruleIds, ['step_up_required']);
});

test('unusual hour + new network + burst read needs step-up', async () => {
  const { normal } = fixtureRequests();
  const r = await run(normal, { signals: sig('local', 'unusual', 3), recentEvents: burst });
  assert.equal(r.decision, 'step_up');
});

test('one signal alone, including region, is never blocked', async () => {
  const { normal } = fixtureRequests();
  for (const changes of [
    { signals: sig('foreign', 'usual', 14) },
    { signals: sig('local', 'usual', 3) },
    { signals: sig('local', 'unusual', 14) },
    { recentEvents: burst },
  ]) assert.equal((await run(normal, changes)).decision, 'allow');
});

test('forged or unknown sources are not promoted and missing values are not filled', async () => {
  const { normal, suspicious } = fixtureRequests();
  for (const source of ['client_header', 'browser', 'none', 'JUDGE_FIXTURE']) {
    const r = await run(normal, { signals: sig('foreign', 'unusual', 3, source) });
    assert.equal(r.decision, 'allow');
  }
  assert.equal((await run(normal, { signals: { region: 'foreign', network: 'unusual', hour: 3 } })).decision, 'allow');
  assert.equal((await run(normal, { signals: { source: 'none', region: 'unknown', network: 'unknown', hour: 14 } })).decision, 'allow');
  // 지역·네트워크를 모르면 정상으로 채우지 않습니다. 남은 근거(시각+대량)만으로 판정합니다.
  const unknown = await run(suspicious, { signals: sig('unknown', 'unknown', 3) });
  assert.equal(unknown.decision, 'step_up');
  for (const bad of [null, 'x', [], {}]) assert.ok(['allow', 'step_up'].includes((await run(normal, { signals: bad })).decision));
});

test('fresh step-up allows again, stale or unverified step-up does not', async () => {
  const { suspicious } = fixtureRequests();
  const fresh = await run(suspicious, { stepUp: { verified: true, authAgeSeconds: 60 } });
  assert.equal(fresh.decision, 'allow');
  for (const stepUp of [{ verified: true, authAgeSeconds: 900 }, { verified: false, authAgeSeconds: null },
    { verified: 'true', authAgeSeconds: 10 }, null]) {
    assert.equal((await run(suspicious, { stepUp })).decision, 'step_up');
  }
});

test('unregistered device is still denied before step-up', async () => {
  const { suspicious } = fixtureRequests();
  const r = await run(suspicious, { deviceRegistered: false, stepUp: { verified: true, authAgeSeconds: 10 } });
  assert.equal(r.decision, 'deny');
  assert.equal(r.reasonCode, 'device_not_registered');
});
