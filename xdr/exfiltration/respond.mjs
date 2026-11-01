import { appendFile, mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide as baseDecide, RULE_IDS as BASE_RULE_IDS } from '../../src/decider.mjs';
import { decide } from './decide.mjs';
import { fixtureRequests } from '../../scripts/fixture-7.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const moduleKey = 'exfiltration';
export const RULE_IDS = Object.freeze([...BASE_RULE_IDS, 'xdr_exfiltration']);
const hash = value => createHash('sha256').update(value).digest('hex');
const accountHash = value => typeof value === 'string' && value.trim() && value.length <= 200 ? hash(value.trim()) : null;
const safeId = value => typeof value === 'string' && /^(?:[a-z]{1,8}-)?\d{1,20}(?:\.\d{1,20})?$/iu.test(value)
  ? value : `alert-${hash(typeof value === 'string' ? value : '').slice(0, 24)}`;
function address(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  return isIP(value) === 6 ? new URL(`http://[${value}]/`).hostname.slice(1, -1) : value;
}
function blockable(value) {
  const ip = address(value);
  if (!ip || ['0.0.0.0', '255.255.255.255', '::', '::1'].includes(ip)) return false;
  if (isIP(ip) === 4) return !ip.startsWith('127.') && Number(ip.split('.')[0]) < 224;
  return !ip.startsWith('ff') && !ip.startsWith('::ffff:');
}
const validDate = value => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value));
// 단일 프로세스의 responder 인스턴스 간 쓰기를 직렬화합니다.
let pending = Promise.resolve();

export function createResponder({ statePath, logPath = join(ROOT, 'xdr/alerts.log'),
  clock = () => Date.now(), ttlMs = 300000, protectedSources = [] } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) throw new Error('차단 만료는 1초~15분입니다.');
  statePath ??= join(ROOT, 'xdr/state/exfiltration-destination-deny.json');
  const ruleId = `xdr_${moduleKey.replaceAll('-', '_')}`;
  const protectedIps = new Set(protectedSources.map(value => {
    const ip = address(value);
    if (!ip) throw new Error('보호 주소 형식 오류');
    return ip;
  }));
  // 출발지·계정·목적지가 모두 맞는 요청만 제한합니다.
  function now() {
    const result = clock();
    if (!Number.isSafeInteger(result) || result < 0) throw new Error('검증 시각 오류');
    return result;
  }
  async function load() {
    let raw;
    try { raw = await readFile(statePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { schema: 'aleph.xdr.exfiltration.deny.v1', moduleKey, rules: [] }; throw new Error('차단 규칙 읽기 오류'); }
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error('차단 규칙 형식 오류'); }
    if (state?.schema !== 'aleph.xdr.exfiltration.deny.v1' || state.moduleKey !== moduleKey || !Array.isArray(state.rules)
        || state.rules.some(r => r?.ruleId !== ruleId || r.action !== 'deny' || !blockable(r.sourceIp) || !blockable(r.destinationIp) || r.sourceIp === r.destinationIp
          || (r.accountHash !== null && !/^[a-f\d]{64}$/u.test(r.accountHash)) || !r.accountHash
          || !validDate(r.evidenceAt) || !validDate(r.expiresAt)
          || Date.parse(r.expiresAt) <= Date.parse(r.evidenceAt) || Date.parse(r.expiresAt) - Date.parse(r.evidenceAt) > 900000
          || !Array.isArray(r.alertIds) || !r.alertIds.length
          || r.alertIds.some(id => typeof id !== 'string' || (safeId(id) !== id && !/^alert-[a-f\d]{24}$/u.test(id))))) {
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
    // 호출자가 넘긴 action 대신 판단 모듈을 다시 실행합니다.
    const decision = await decide(alert);
    if (!['block', 'alert', 'record'].includes(decision?.action) || !Number.isFinite(decision.confidence)
        || decision.confidence < 0 || decision.confidence > 1 || !/^[a-z][a-z0-9_]{0,63}$/u.test(decision.reason)
        || decision.action !== (decision.confidence >= 0.85 ? 'block' : decision.confidence >= 0.5 ? 'alert' : 'record')) {
      throw new Error('판단 결과 형식 오류');
    }
    const at = now(), state = await load();
    state.rules = state.rules.filter(r => Date.parse(r.expiresAt) > at);
    const ip = address(alert?.data?.srcip), account = accountHash(alert?.data?.srcuser);
    const destinationIp = address(alert?.data?.dstip);
    const eventAt = validDate(alert?.timestamp) ? Date.parse(alert.timestamp) : NaN;
    const alertId = safeId(alert?.id);
    let installed = false, disposition = 'not_a_block_candidate';
    if (decision.action === 'block') {
      disposition = 'invalid_or_stale_evidence';
      if (blockable(ip) && blockable(destinationIp) && ip !== destinationIp && account && eventAt <= at + 5000 && eventAt + ttlMs > at) {
        if (protectedIps.has(ip)) disposition = 'protected_source';
        else {
          const expiresAt = new Date(eventAt + ttlMs).toISOString();
          const previous = state.rules.find(r => r.sourceIp === ip && r.destinationIp === destinationIp && r.accountHash === account);
          if (previous) {
            installed = !previous.alertIds.includes(alertId) || Date.parse(previous.expiresAt) < Date.parse(expiresAt);
            if (!previous.alertIds.includes(alertId)) previous.alertIds.push(alertId);
            if (Date.parse(previous.expiresAt) < Date.parse(expiresAt)) {
              previous.expiresAt = expiresAt;
              previous.evidenceAt = new Date(eventAt).toISOString();
            }
            disposition = installed ? 'installed' : 'duplicate';
          } else {
            state.rules.push({ ruleId, action: 'deny', sourceIp: ip, destinationIp, accountHash: account,
              evidenceAt: new Date(eventAt).toISOString(), expiresAt, alertIds: [alertId] });
            installed = true;
            disposition = 'installed';
          }
        }
      }
    }
    await save(state);
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ at: new Date(at).toISOString(), moduleKey, alertId,
      ...decision, installed, disposition, sourceHash: ip ? hash(ip) : null })}\n`, { mode: 0o600 });
    return { ...decision, alertId, installed, disposition };
  }
  function respond(alert) {
    const job = pending.then(() => apply(alert));
    pending = job.catch(() => {});
    return job;
  }
  function wrapDecider(existingDecide = baseDecide) {
    return async (request, trustedContext) => {
      // 원래의 거부·추가 확인을 그대로 유지합니다. 접속 정보는 엔진 측 연결부의 별도 인자입니다.
      const original = await existingDecide(request, trustedContext);
      if (original.decision !== 'allow') return original;
      const ip = address(trustedContext?.sourceIp);
      if (!ip) throw new Error('서버가 검증한 sourceIp 연결이 필요합니다.');
      const account = accountHash(trustedContext?.account);
      if (!account) throw new Error('서버가 검증한 계정 매핑이 필요합니다.');
      const destinationIp = address(trustedContext?.destinationIp);
      if (!destinationIp) throw new Error('서버가 검증한 destinationIp 연결이 필요합니다.');
      const state = await load(), at = now();
      const blocked = !protectedIps.has(ip) && state.rules.some(r => r.sourceIp === ip && r.destinationIp === destinationIp
        && Date.parse(r.evidenceAt) <= at + 5000 && (!r.accountHash || r.accountHash === account) && Date.parse(r.expiresAt) > at);
      if (!blocked) return original;
      return { ...original, decision: 'deny', reasonCode: `${ruleId}_blocked`, ruleIds: [...new Set([...original.ruleIds, ruleId])] };
    };
  }
  return { respond, wrapDecider, ruleIds: RULE_IDS };
}


const worker = createResponder();
export const respond = alert => worker.respond(alert);
export const decideRequest = worker.wrapDecider();

// 원본 시각으로 격리 재연하며 운영 상태 파일에는 쓰지 않습니다.
export async function replayFixture() {
  const fixturePath = join(ROOT, 'xdr/fixtures/exfiltration.json');
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== moduleKey || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식 오류');
  }
  const parent = join(ROOT, 'artifacts');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'xdr-exfiltration-'));
  const request = fixtureRequests().normal;
  let time = 0;
  const replay = createResponder({ statePath: join(dir, 'deny.json'), clock: () => time });
  const check = replay.wrapDecider();
  const report = { schema: 'aleph.xdr.exfiltration.replay.v1', counts: { block: 0, alert: 0, record: 0 },
    blockedRequests: 0, nonBlockAllowed: 0, safeDestinationAllowed: 0, otherAccountAllowed: 0, expiredAllowed: 0 };
  for (const alert of fixture.alerts) {
    time = Date.parse(alert.timestamp);
    const result = await replay.respond(alert);
    report.counts[result.action]++;
    const context = { sourceIp: alert.data.srcip, account: alert.data.srcuser,
      destinationIp: alert.data.dstip ?? '192.0.2.10' };
    const out = await check(request, context);
    if (result.action === 'block') {
      if (!result.installed || out.decision !== 'deny') throw new Error('차단 재연 불일치');
      report.blockedRequests++;
    } else {
      if (out.decision !== 'allow') throw new Error('알림·기록 요청 차단');
      report.nonBlockAllowed++;
    }
    const safe = await check(request, { ...context, destinationIp: '192.0.2.10' });
    if (safe.decision !== 'allow') throw new Error('정상 목적지 요청 차단');
    report.safeDestinationAllowed++;
    const other = await check(request, { ...context, account: 'unrelated-user' });
    if (other.decision !== 'allow') throw new Error('다른 계정 요청 차단');
    report.otherAccountAllowed++;
    time += 300000;
    if ((await check(request, context)).decision !== 'allow') throw new Error('만료 해제 실패');
    report.expiredAllowed++;
  }
  await writeFile(join(dir, 'replay.json'), JSON.stringify(report, null, 2) + '\n');
  return report;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== '--fixture') throw new Error('재연 옵션 필요');
    console.log(JSON.stringify(await replayFixture()));
  } catch {
    console.error('반출 재연 오류: 전용 시험으로 첫 실패를 확인하세요.');
    process.exitCode = 1;
  }
}
