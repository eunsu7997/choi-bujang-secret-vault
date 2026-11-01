import { appendFile, mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { decide as baseDecide, RULE_IDS as BASE_RULE_IDS } from '../../src/decider.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const RULE = 'xdr_brute_force';
export const RULE_IDS = Object.freeze([...BASE_RULE_IDS, RULE]);
const digest = value => createHash('sha256').update(value).digest('hex');
const safeAlertId = value => typeof value === 'string' && /^(?:[a-z]{1,16}-)?\d{1,20}(?:[.-]\d{1,20})?$/iu.test(value)
  ? value : `alert-${digest(typeof value === 'string' ? value : '').slice(0, 24)}`;
function address(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}
function blockable(ip) {
  if (!ip || ['0.0.0.0', '255.255.255.255', '::', '::1'].includes(ip)) return false;
  if (isIP(ip) === 4) return !ip.startsWith('127.') && Number(ip.split('.')[0]) < 224;
  return !ip.startsWith('ff') && !ip.startsWith('::ffff:');
}
// 파일 저장기는 한 프로세스에서 사용합니다. 동시 호출은 직렬화하고 파일 교체는 원자적으로 합니다.
let writes = Promise.resolve();
export function createResponder({
  statePath = join(root, 'xdr/state/brute-force-deny.json'),
  logPath = join(root, 'xdr/alerts.log'), clock = () => Date.now(), ttlMs = 300000, protectedSources = [],
} = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) throw new Error('차단 TTL은 1초부터 15분 사이입니다.');
  const protectedIps = new Set(protectedSources.map(ip => {
    const normalized = address(ip);
    if (!normalized) throw new Error('보호 주소는 IP 리터럴이어야 합니다.');
    return normalized;
  }));
  const nowMs = () => {
    const now = clock();
    if (!Number.isFinite(now)) throw new Error('검증 시각이 올바르지 않습니다.');
    return now;
  };
  async function load() {
    let raw;
    try { raw = await readFile(statePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { schema: 'aleph.xdr.deny.v1', rules: [] }; throw new Error('차단 규칙을 읽을 수 없습니다.'); }
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error('차단 규칙 형식 오류'); }
    if (state?.schema !== 'aleph.xdr.deny.v1' || !Array.isArray(state.rules)
        || state.rules.some(rule => rule?.ruleId !== RULE || rule.action !== 'deny' || !blockable(address(rule.sourceIp))
          || !Number.isFinite(Date.parse(rule.expiresAt)) || !Array.isArray(rule.alertIds)
          || !rule.alertIds.length || rule.alertIds.some(id => typeof id !== 'string' || safeAlertId(id) !== id && !/^alert-[a-f\d]{24}$/u.test(id)))) {
      throw new Error('차단 규칙 형식 오류');
    }
    return state;
  }
  async function save(state) {
    await mkdir(dirname(statePath), { recursive: true });
    const temp = `${statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temp, statePath);
    } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function apply(alert) {
    // 외부에서 전달한 block 플래그는 믿지 않고 독립 판단 모듈로 다시 판단합니다.
    const decision = decide(alert);
    const now = nowMs();
    const eventAt = typeof alert?.timestamp === 'string' ? Date.parse(alert.timestamp) : NaN;
    const alertId = safeAlertId(alert?.id);
    const ip = address(alert?.data?.srcip);
    const state = await load();
    state.rules = state.rules.filter(rule => Date.parse(rule.expiresAt) > now);
    let installed = false;
    let disposition = decision.action === 'block' ? 'invalid_or_stale_evidence' : 'not_a_block_candidate';
    if (decision.action === 'block' && decision.confidence >= 0.85 && blockable(ip)
        && Number.isFinite(eventAt) && eventAt <= now + 5000 && eventAt + ttlMs > now) {
      if (protectedIps.has(ip)) disposition = 'protected_source';
      else {
        const expiresAt = new Date(eventAt + ttlMs).toISOString();
        const rule = state.rules.find(item => item.sourceIp === ip);
        if (rule) {
          // 같은 경보 재전송은 현재 시각 기준으로 TTL을 늘리지 않습니다.
          const changed = !rule.alertIds.includes(alertId) || Date.parse(expiresAt) > Date.parse(rule.expiresAt);
          rule.alertIds = [...new Set([...rule.alertIds, alertId])];
          if (Date.parse(expiresAt) > Date.parse(rule.expiresAt)) rule.expiresAt = expiresAt;
          installed = changed;
          disposition = changed ? 'installed' : 'duplicate';
        } else {
          state.rules.push({ ruleId: RULE, action: 'deny', sourceIp: ip, expiresAt, alertIds: [alertId] });
          installed = true;
          disposition = 'installed';
        }
      }
    }
    await save(state);
    await mkdir(dirname(logPath), { recursive: true });
    // 계정·원본 설명·비밀번호·토큰·원본 경보 본문을 로그에 넣지 않습니다.
    await appendFile(logPath, `${JSON.stringify({ at: new Date(now).toISOString(), alertId,
      ...decision, installed, disposition, sourceHash: ip ? digest(ip).slice(0, 24) : null })}\n`, { mode: 0o600 });
    return { ...decision, installed, disposition, alertId };
  }
  const respond = alert => {
    const task = writes.then(() => apply(alert));
    writes = task.catch(() => {});
    return task;
  };
  function wrapDecider(existingDecide = baseDecide) {
    return async function decideRequest(request, trustedSourceIp) {
      // 기존 deny/step_up 규칙은 먼저 적용하며 XDR이 이를 allow로 바꾸지 않습니다.
      const original = await existingDecide(request);
      if (original.decision !== 'allow') return original;
      const ip = address(trustedSourceIp);
      if (!ip) throw new Error('엔진/서버가 검증한 접속 IP가 필요합니다. request에 임의 필드를 추가하지 마세요.');
      const state = await load();
      const rule = !protectedIps.has(ip) && state.rules.find(item => item.sourceIp === ip && Date.parse(item.expiresAt) > nowMs());
      if (!rule) return original;
      return { ...original, decision: 'deny', reasonCode: 'xdr_brute_force_blocked',
        ruleIds: [...new Set([...original.ruleIds, RULE])] };
    };
  }
  return { respond, wrapDecider, ruleIds: RULE_IDS };
}
const defaultResponder = createResponder();
export const respond = alert => defaultResponder.respond(alert);
export const decideRequest = defaultResponder.wrapDecider();

// 수업용 경보의 과거 시각을 쓰는 격리 재연. 실제 차단 파일에는 쓰지 않습니다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== '--fixture') throw new Error('시험 재연은 --fixture 옵션이 필요합니다.');
    const fixture = JSON.parse(await readFile(join(root, 'xdr/fixtures/brute-force.json'), 'utf8'));
    const { fixtureRequests } = await import('../../scripts/fixture-7.mjs');
    await mkdir(join(root, 'artifacts'), { recursive: true });
    const runDir = await mkdtemp(join(root, 'artifacts/brute-force-replay-'));
    let now;
    const worker = createResponder({ statePath: join(runDir, 'deny.json'), clock: () => now });
    const gate = worker.wrapDecider();
    const counts = { block: 0, alert: 0, record: 0 };
    const checks = { attacksDenied: 0, otherEventsAllowed: 0, controlRequestsAllowed: 0, normalBlocked: 0 };
    for (const alert of [...fixture.alerts].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
      now = Date.parse(alert.timestamp) + 1;
      const result = await worker.respond(alert);
      counts[result.action] += 1;
      const actual = await gate(fixtureRequests().normal, alert.data.srcip);
      if (result.action === 'block' && actual.decision === 'deny') checks.attacksDenied += 1;
      if (result.action !== 'block' && actual.decision === 'allow') checks.otherEventsAllowed += 1;
      if (result.action === 'record' && actual.decision !== 'allow') checks.normalBlocked += 1;
      if ((await gate(fixtureRequests().normal, '192.0.2.250')).decision === 'allow') checks.controlRequestsAllowed += 1;
    }
    const report = { mode: 'fixture-clock', counts, checks, productionRulesChanged: false };
    await writeFile(join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    if (checks.attacksDenied !== counts.block || checks.otherEventsAllowed !== counts.alert + counts.record
        || checks.controlRequestsAllowed !== fixture.alerts.length || checks.normalBlocked !== 0) throw new Error('시험 재연 불일치');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
