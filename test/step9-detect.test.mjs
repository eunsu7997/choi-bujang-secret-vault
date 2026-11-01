import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { detect } from '../src/detect.mjs';

const START = Date.UTC(2026, 9, 1, 0, 0, 0);
const reads = (count, { gap = 2, sub = 'learner_fixture', start = START, method = 'GET' } = {}) =>
  Array.from({ length: count }, (_, i) => ({ at: new Date(start + i * gap * 1000).toISOString(), method, identity: { sub } }));
const revoke = sub => ({ action: 'propose_revocation', reasonCode: 'burst_read', subject: sub });
const observe = { action: 'observe' };

test('only more than 120 GETs inside 10 minutes for one sub is suspicious', () => {
  assert.deepEqual(detect(reads(120)), observe);
  assert.deepEqual(detect(reads(121)), revoke('learner_fixture'));
  // 121건이 정확히 10분(600초)에 걸치면 마지막 건은 다음 구간입니다.
  assert.deepEqual(detect(reads(121, { gap: 5 })), observe);
  assert.deepEqual(detect(reads(121, { gap: 4.99 })), revoke('learner_fixture'));
});

test('slow reads, other users, and non-GET events are not merged', () => {
  assert.deepEqual(detect(reads(300, { gap: 6 })), observe);
  assert.deepEqual(detect([...reads(100), ...reads(100, { sub: 'other' })]), observe);
  assert.deepEqual(detect(reads(200, { method: 'POST' })), observe);
  assert.deepEqual(detect([...reads(100), ...reads(30, { method: 'PUT' })]), observe);
});

test('burst is found in any window, in any input order, and only that sub is named', () => {
  const quiet = reads(50, { gap: 30 });
  const burst = reads(130, { gap: 1, sub: 'doppel', start: START + 3600 * 1000 });
  const mixed = [...quiet, ...burst, ...reads(80, { sub: 'normal' })].reverse();
  assert.deepEqual(detect(mixed), revoke('doppel'));
  const result = detect(burst);
  assert.deepEqual(Object.keys(result).sort(), ['action', 'reasonCode', 'subject']);
});

test('malformed events are skipped and never invent values', () => {
  const junk = [null, 'x', [], {}, { at: 'nope', method: 'GET', identity: { sub: 'a' } },
    { at: new Date(START).toISOString(), method: 'GET' }, { at: new Date(START).toISOString(), method: 'GET', identity: { sub: '' } }];
  assert.deepEqual(detect(junk), observe);
  assert.deepEqual(detect(undefined), observe);
  assert.deepEqual(detect([...junk, ...reads(121)]), revoke('learner_fixture'));
});

test('detector reads only at, method and identity.sub', async () => {
  const source = await readFile(new URL('../src/detect.mjs', import.meta.url), 'utf8');
  const reader = source.slice(source.indexOf('function readEvent'), source.indexOf('function firstBurst'));
  const fields = [...reader.matchAll(/event\.([a-zA-Z_]+)/gu)].map(m => m[1]);
  assert.deepEqual([...new Set(fields)].sort(), ['at', 'identity', 'method']);
  assert.doesNotMatch(source, /\b(network|device|region|geo|token|content|body)\s*[:=.]/u);
});
