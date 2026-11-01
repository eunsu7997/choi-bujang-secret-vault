import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { decide, RULE_IDS } from '../src/decider.mjs';
import { fixtureRequests } from '../scripts/fixture-7.mjs';

const KEYS = 'decision,reasonCode,requestId,ruleIds,schema';
const shape = (request, response) => {
  assert.equal(Object.keys(response).sort().join(','), KEYS);
  assert.equal(response.schema, 'aleph.decision.v1');
  assert.equal(response.requestId, request.requestId);
  assert.ok(response.ruleIds.length > 0 && response.ruleIds.every(id => RULE_IDS.includes(id)));
};

test('registered device is allowed, unregistered or missing flag is denied', async () => {
  const { normal } = fixtureRequests();
  const ok = await decide(normal);
  shape(normal, ok);
  assert.equal(ok.decision, 'allow');
  for (const value of [false, undefined, null, 'true', 1]) {
    const request = { ...normal, requestId: randomUUID(), deviceRegistered: value };
    if (value === undefined) delete request.deviceRegistered;
    const response = await decide(request);
    shape(request, response);
    assert.equal(response.decision, 'deny');
    assert.equal(response.reasonCode, 'device_not_registered');
  }
});

test('decider reads only contract fields and keeps the device rule', async () => {
  const source = await readFile(new URL('../src/decider.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /request\.(role|identity|device|geo)\b/u);
  assert.ok(RULE_IDS.includes('device_registered'));
});
