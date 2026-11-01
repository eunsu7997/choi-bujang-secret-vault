// 12단계 제작 2: 1~11단계의 정상·금지 요청을 실제로 실행해 한 표로 남기는 절차입니다.
//   npm run ops:probe            운영 주소(aleph.config.json publicAppUrl)로 실제 요청 + 학생 판정기·탐지기·정책 사본 실행
//   결과: 화면 표 출력 + artifacts/ops-results.json(Git 제외). 로그인 토큰이 필요한 시험은 실행하지 않고 미실행으로 남깁니다.
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ATTACKS, FORGED_BEARER, HTTP_PROBES, attackStatus, tally } from '../src/ops-catalog.mjs';
import { runLocalProbes } from '../src/ops-local.mjs';
import { verifySnapshot, readLivePolicy } from './policy-backup.mjs';

const root = resolve(import.meta.dirname, '..');

export async function runHttpProbe(probe, base, fetchImpl = fetch) {
  const requestId = randomUUID();
  const at = new Date().toISOString();
  const headers = { 'x-request-id': requestId };
  if (probe.auth === 'forged') headers.authorization = FORGED_BEARER;
  if (probe.body) headers['content-type'] = 'application/json';
  try {
    const response = await fetchImpl(new URL(probe.path, base), { method: probe.method, headers, redirect: 'manual',
      body: probe.body ? JSON.stringify(probe.body) : undefined, signal: AbortSignal.timeout(10000) });
    return { id: probe.id, stage: probe.stage, kind: probe.kind, label: `${probe.label} (${probe.method} ${probe.path})`, where: '운영 API 실제 요청',
      expected: probe.expect.join('/'), actual: `HTTP ${response.status}`, ok: probe.expect.includes(response.status),
      requestId, serverId: response.headers.get('x-vercel-id') ?? null, at };
  } catch (error) {
    return { id: probe.id, stage: probe.stage, kind: probe.kind, label: `${probe.label} (${probe.method} ${probe.path})`, where: '운영 API 실제 요청',
      expected: probe.expect.join('/'), actual: `요청 실패(${error?.name === 'TimeoutError' ? '시간 초과' : '연결 안 됨'})`, ok: false, requestId, serverId: null, at, failed: true };
  }
}

export function policyProbe() {
  const at = new Date().toISOString();
  try {
    const { manifest, texts } = verifySnapshot();
    const live = readLivePolicy();
    const drift = Object.keys(live).filter(name => live[name] !== texts[name]);
    return { id: 'policy_snapshot_verified', stage: 10, kind: '정상', label: '안전 정책 사본 해시 재검증', where: '정책 사본(backup/policy)',
      expected: '해시 일치·운영과 차이 0', actual: `버전 ${manifest.version}, 차이 ${drift.length}개`, ok: drift.length === 0, requestId: randomUUID(), at };
  } catch (error) {
    return { id: 'policy_snapshot_verified', stage: 10, kind: '정상', label: '안전 정책 사본 해시 재검증', where: '정책 사본(backup/policy)',
      expected: '해시 일치·운영과 차이 0', actual: '검증 중단', ok: false, requestId: randomUUID(), at };
  }
}

export async function runOpsProbe({ base, fetchImpl = fetch } = {}) {
  const rows = [];
  for (const probe of HTTP_PROBES) {
    const row = await runHttpProbe(probe, base, fetchImpl);
    // 연결 자체가 안 되면 결과가 아니라 미실행으로 둡니다(통과·실패 어느 쪽으로도 세지 않음).
    if (!row.failed) rows.push(row);
    else rows.push({ ...row, ok: undefined, actual: `미실행 (${row.actual})` });
  }
  rows.push(...await runLocalProbes(), policyProbe());
  const results = Object.fromEntries(rows.filter(row => typeof row.ok === 'boolean').map(row => [row.id, { ok: row.ok }]));
  const attacks = ATTACKS.map(attack => ({ id: attack.id, stage: attack.stage, name: attack.name, ...attackStatus(attack, results) }));
  return { checkedAt: new Date().toISOString(), base: String(base), rows, attacks, tally: tally(results) };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const config = JSON.parse(await readFile(resolve(root, 'aleph.config.json'), 'utf8'));
  const report = await runOpsProbe({ base: config.publicAppUrl });
  for (const row of report.rows) {
    const mark = row.ok === true ? '통과' : row.ok === false ? '실패' : '미실행';
    process.stdout.write(`[${mark}] ${row.stage}단계 ${row.kind} · ${row.label} · 기대 ${row.expected} · 실제 ${row.actual} · 요청ID ${row.requestId}${row.serverId ? ` · 서버ID ${row.serverId}` : ''} · ${row.at}\n`);
  }
  process.stdout.write(`\n공식 41종(이 절차 기준, 공식 판정 아님): ${Object.entries(report.tally).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(resolve(root, 'artifacts', 'ops-results.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write('결과: artifacts/ops-results.json (Git에 올리지 않음)\n');
}
