// 12단계 탈환 작전실 점검의 본체입니다. 제출 묶음(src/attack-check.mjs)과 npm run ops:probe가 함께 씁니다.
// 심판 격리 실행기에서도 불러올 수 있도록 src/ 밖 파일을 불러오지 않고, 불러오는 순간 경로를 계산하지 않습니다.
// 허용 모듈(node:crypto, node:fs)만 쓰고, 요청은 공개 HTTPS GET·HEAD만 보냅니다. 쓰기 점검은 not_run으로 남깁니다.
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ATTACKS, FORGED_BEARER, HTTP_PROBES, attackStatus, tally } from './ops-catalog.mjs';
import { runLocalProbes } from './ops-local.mjs';

const READ_METHODS = new Set(['GET', 'HEAD']);
const row = (probe, fields) => ({ id: probe.id, stage: probe.stage, kind: probe.kind, label: `${probe.label} (${probe.method} ${probe.path})`,
  where: '운영 API 실제 요청', expected: probe.expect.join('/'), ...fields });

export async function runHttpProbe(probe, base, fetchImpl = fetch) {
  const at = new Date().toISOString();
  const url = new URL(probe.path, base).href;
  const request = { method: probe.method, url };
  if (!READ_METHODS.has(probe.method)) return row(probe, { ...request, actual: 'not_run', ok: undefined, requestId: null, serverId: null, at, notRun: true });
  const requestId = randomUUID();
  const headers = { 'x-request-id': requestId, 'x-attack-id': probe.id };
  if (probe.auth === 'forged') headers.authorization = FORGED_BEARER;
  try {
    const response = await fetchImpl(url, { method: probe.method, headers, redirect: 'manual', signal: AbortSignal.timeout(10000) });
    return row(probe, { ...request, status: response.status, actual: `HTTP ${response.status}`, ok: probe.expect.includes(response.status), requestId,
      serverId: response.headers.get('x-vercel-id') ?? null, at });
  } catch (error) {
    // 연결 자체가 안 되면 결과가 아니라 미실행입니다(통과·실패 어느 쪽으로도 세지 않음).
    return row(probe, { ...request, actual: 'not_run', ok: undefined, requestId: null, serverId: null, at, notRun: true });
  }
}

// 안전 정책 사본(backup/policy) 해시를 다시 읽어 확인합니다. 이 파일 위치 기준 상대 URL로만 읽습니다.
const POLICY_SOURCES = [['decider.mjs', 'src/decider.mjs'], ['allowed-routes.json', 'aleph.config.json'],
  ['notes-step4-rls.sql', 'supabase/notes-step4-rls.sql'], ['notes-step5-revoke.sql', 'supabase/notes-step5-revoke.sql']];
const sha256 = text => createHash('sha256').update(text, 'utf8').digest('hex');

export function policyProbe(rootUrl = new URL('../', import.meta.url)) {
  const at = new Date().toISOString();
  const base = { id: 'policy_snapshot_verified', stage: 10, kind: '정상', label: '안전 정책 사본 해시 재검증', where: '정책 사본(backup/policy)',
    expected: '해시 일치·운영과 차이 0', requestId: randomUUID(), at };
  try {
    const manifest = JSON.parse(readFileSync(new URL('backup/policy/manifest.json', rootUrl), 'utf8'));
    let drift = 0;
    for (const [name, source] of POLICY_SOURCES) {
      const copy = readFileSync(new URL(`backup/policy/${name}`, rootUrl), 'utf8');
      if (sha256(copy) !== manifest.files?.[name]) return { ...base, actual: `사본 ${name} 해시 불일치`, ok: false };
      let live = readFileSync(new URL(source, rootUrl), 'utf8');
      if (name === 'allowed-routes.json') live = `${JSON.stringify(JSON.parse(live).allowedRoutes, null, 2)}\n`;
      if (live !== copy) drift += 1;
    }
    return { ...base, actual: `버전 ${manifest.version}, 차이 ${drift}개`, ok: drift === 0 };
  } catch {
    return { ...base, actual: '미실행 (정책 사본을 읽지 못함)', ok: undefined };
  }
}

export async function runOpsProbe({ base, fetchImpl = fetch, rootUrl } = {}) {
  const rows = [];
  for (const probe of HTTP_PROBES) rows.push(await runHttpProbe(probe, base, fetchImpl));
  rows.push(...await runLocalProbes(), policyProbe(rootUrl));
  const results = Object.fromEntries(rows.filter(item => typeof item.ok === 'boolean').map(item => [item.id, { ok: item.ok }]));
  const attacks = ATTACKS.map(attack => ({ id: attack.id, stage: attack.stage, name: attack.name, ...attackStatus(attack, results) }));
  return { checkedAt: new Date().toISOString(), base: String(base), rows, attacks, tally: tally(results) };
}
