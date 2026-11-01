import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';
import { createNotesHandler, opsAction, supabaseNotesStore } from '../api/notes.js';
import * as catalog from '../src/ops-catalog.mjs';
import { runLocalProbes } from '../src/ops-local.mjs';
import { runOpsProbe } from '../scripts/ops-probe.mjs';
import { call, fakeSupabase, studentBearer, verify } from './helpers/auth-fixture.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('catalog has exactly 41 attacks, unknown names are honest, and nothing passes without results', () => {
  assert.equal(catalog.ATTACKS.length, 41);
  assert.equal(new Set(catalog.ATTACKS.map(a => a.id)).size, 41);
  assert.equal(catalog.ATTACKS.filter(a => a.stage >= 6).length, 25);
  assert.ok(catalog.ATTACKS.filter(a => a.stage <= 5).every(a => a.probes.length === 0 && /이름 미기록/u.test(a.untested)));
  const empty = catalog.tally({});
  assert.deepEqual(empty, { '실측 통과': 0, '부분 실측': 0, '실측 실패': 0, '미실행': 41 });
  const probeIds = new Set([...catalog.HTTP_PROBES.map(p => p.id)]);
  for (const id of ['policy_snapshot_verified']) probeIds.add(id);
  return runLocalProbes().then(local => {
    for (const item of local) probeIds.add(item.id);
    for (const attack of catalog.ATTACKS) for (const id of attack.probes) assert.ok(probeIds.has(id), `${attack.name}: ${id}`);
  });
});

test('status rules: failure wins, untested parts keep it partial, full success only when everything ran', () => {
  const attack = { probes: ['a', 'b'], untested: '' };
  assert.equal(catalog.attackStatus(attack, {}).status, '미실행');
  assert.equal(catalog.attackStatus(attack, { a: { ok: true } }).status, '부분 실측');
  assert.equal(catalog.attackStatus(attack, { a: { ok: true }, b: { ok: false } }).status, '실측 실패');
  assert.equal(catalog.attackStatus(attack, { a: { ok: true }, b: { ok: true } }).status, '실측 통과');
  assert.equal(catalog.attackStatus({ probes: ['a'], untested: '토큰 필요' }, { a: { ok: true } }).status, '부분 실측');
});

test('local probes run the real student decider and detector with expected results', async () => {
  const local = await runLocalProbes();
  assert.ok(local.length >= 17);
  for (const item of local) {
    assert.equal(item.ok, true, `${item.id}: ${item.actual}`);
    assert.match(item.requestId, /^[0-9a-f-]{36}$/u);
    assert.ok(!Number.isNaN(Date.parse(item.at)));
  }
});

test('ops:probe procedure records real responses, request IDs and server IDs; connection failures stay 미실행', async () => {
  const fakeFetch = async (url, init) => {
    const path = new URL(url).pathname;
    const status = path === '/' || path === '/manifest.webmanifest' || path === '/aleph.json' ? 200 : path === '/data.json' ? 404 : 401;
    return { status, headers: new Map([['x-vercel-id', `icn1::${init.headers['x-request-id'].slice(0, 8)}`]]) };
  };
  const report = await runOpsProbe({ base: 'https://example.test/', fetchImpl: fakeFetch });
  const http = report.rows.filter(r => r.where === '운영 API 실제 요청');
  assert.equal(http.length, catalog.HTTP_PROBES.length);
  assert.ok(http.every(r => r.ok === true && r.serverId && r.serverId.endsWith(r.requestId.slice(0, 8))));
  assert.equal(report.attacks.length, 41);
  assert.equal(report.tally['실측 실패'], 0);
  assert.ok(report.tally['미실행'] >= 16);
  const down = await runOpsProbe({ base: 'https://example.test/', fetchImpl: async () => { throw new TypeError('down'); } });
  assert.ok(down.rows.filter(r => r.where === '운영 API 실제 요청').every(r => r.ok === undefined && /^미실행/u.test(r.actual)));
});

test('ops summary API: login required, approved device for browser, header path works, no memo bodies', async () => {
  const db = fakeSupabase();
  const handler = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(db), writesEnabled: true,
    getDeviceStore: () => ({ get: async () => null }),
    getOpsInfo: async () => ({ devices: { approved: 1, pending: 0, revoked: 0 }, restorePoints: 1, auditRows: 2, lastAudit: { action: 'updated', at: '2026-11-01T00:00:00Z' } }) });
  assert.equal((await call(handler, { method: 'GET', url: '/api/ops/summary' })).status, 401);
  const token = (await studentBearer(userA)).slice(7);
  assert.equal((await call(handler, { method: 'GET', url: '/api/ops/summary', headers: { cookie: `__Host-vault_at=${token}` } })).status, 403);
  const headers = { authorization: await studentBearer(userA) };
  await call(handler, { method: 'POST', headers, body: { title: 'SECRET_TITLE', body: 'SECRET_BODY' } });
  const ok = await call(handler, { method: 'GET', url: '/api/ops/summary', headers });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.rules, ['device_registered', 'resource_zone', 'step_up_required']);
  assert.ok(ok.body.local.every(item => item.ok === true));
  assert.equal(ok.body.restore.restorePoints, 1);
  assert.equal(ok.body.revocation.devices.approved, 1);
  assert.match(ok.body.revocation.engineLink, /미실행/u);
  const text = JSON.stringify(ok.body);
  assert.ok(!text.includes('SECRET_TITLE') && !text.includes('SECRET_BODY'));
  assert.equal((await call(handler, { method: 'POST', url: '/api/ops/summary', headers })).status, 405);
  // 요약 정보를 못 읽어도 "확인 불가"(null)로 두고 꾸미지 않습니다.
  const broken = createNotesHandler({ getVerifier: () => verify, getStore: () => supabaseNotesStore(fakeSupabase()), writesEnabled: true,
    getOpsInfo: async () => { throw Object.assign(new Error('x'), { code: '42P01' }); } });
  const partial = await call(broken, { method: 'GET', url: '/api/ops/summary', headers });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.restore.restorePoints, null);
  assert.equal(partial.body.revocation.devices, null);
});

test('ops routes are recognised only for /api/ops paths or the internal rewrite', () => {
  assert.equal(opsAction({ url: '/api/ops/summary' }), 'summary');
  assert.equal(opsAction({ url: '/api/notes?ops=summary', query: { ops: 'summary' } }), 'summary');
  assert.equal(opsAction({ url: '/api/ops/export' }), 'invalid');
  assert.equal(opsAction({ url: '/api/notes' }), null);
});

// 실제 작전실 화면 코드를 가짜 DOM에서 실행합니다(브라우저·서버 없이).
async function opsPage({ summaryStatus = 200, failAll = false } = {}) {
  const html = await read('public/ops.html');
  const script = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/gu)].at(-1)[1].replace(/^\s*import [^;]+;/mu, '');
  const elements = new Map();
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.textContent = ''; this.events = {}; this.style = {}; this.className = ''; }
    append(...items) { this.children.push(...items); }
    replaceChildren(...items) { this.children = items; }
    addEventListener(name, fn) { this.events[name] = fn; }
  }
  const get = key => { if (!elements.has(key)) elements.set(key, new El(key)); return elements.get(key); };
  const requests = [];
  let n = 0;
  const local = await runLocalProbes();
  const context = {
    ...catalog, document: { querySelector: get, createElement: tag => new El(tag) },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` },
    fetch: async (url, init = {}) => {
      requests.push({ url, init });
      if (failAll) throw new TypeError('down');
      if (url === '/api/ops/summary' && init.credentials !== 'omit') {
        return { ok: summaryStatus === 200, status: summaryStatus, json: async () => ({ generatedAt: '2026-11-01T00:00:00Z', step: 12, commit: 'abc', rules: ['device_registered'],
          local, detection: [], revocation: { engineLink: '미실행', devices: null }, restore: { policyVersion: 'v', restorePoints: 1, auditRows: 0, lastAudit: null } }) };
      }
      const probe = catalog.HTTP_PROBES.find(p => p.path === url);
      return { ok: true, status: probe.expect[0], headers: { get: () => 'icn1::server' } };
    },
  };
  await vm.runInNewContext(`(async () => {${script}\n})()`, context);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 20));
  return { get, requests };
}

test('ops page shows real request results with IDs, merges server-run student results, and counts 41 honestly', async () => {
  const page = await opsPage();
  const rows = page.get('#probe-rows').children;
  assert.equal(rows.length, catalog.HTTP_PROBES.length + (await runLocalProbes()).length);
  const bad = rows.filter(r => r.children[6].textContent !== '기대대로').map(r => r.children.map(c => c.textContent).join('|'));
  assert.deepEqual(bad, []);
  assert.ok(rows.slice(0, catalog.HTTP_PROBES.length).every(r => /^0{8}-/u.test(r.children[7].textContent) && r.children[8].textContent === 'icn1::server'));
  // 운영 API 요청은 로그인 정보 없이 보냅니다.
  assert.ok(page.requests.filter(r => r.url !== '/api/ops/summary').every(r => r.init.credentials === 'omit'));
  assert.equal(page.get('#attack-rows').children.length, 41);
  assert.match(page.get('#attack-tally').textContent, /미실행 \d+/u);
  assert.match(page.get('#attack-tally').textContent, /공식 판정 아님/u);
  const unnamed = page.get('#attack-rows').children.filter(r => /1~5단계/u.test(r.children[2].textContent));
  assert.equal(unnamed.length, 16);
  assert.ok(unnamed.every(r => r.children[4].textContent === '미실행'));
});

test('ops page without login or with network failure never marks attacks as passed', async () => {
  const anon = await opsPage({ summaryStatus: 401 });
  assert.match(anon.get('#summary-status').textContent, /로그인/u);
  const down = await opsPage({ failAll: true });
  assert.ok(down.get('#probe-rows').children.every(r => r.children[6].textContent === '미실행'));
  assert.ok(down.get('#attack-rows').children.every(r => r.children[4].textContent === '미실행'));
});

test('ops page never renders memo bodies or uses innerHTML/browser storage', async () => {
  const html = await read('public/ops.html');
  assert.doesNotMatch(html, /innerHTML|localStorage|sessionStorage|indexedDB/iu);
  assert.doesNotMatch(html, /\/api\/notes['`]/u);
  assert.match(html, /메모 본문은 표시하지 않습니다/u);
});
