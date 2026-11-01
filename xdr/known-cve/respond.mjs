import { appendFile, mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { decide as baseDecide, RULE_IDS as BASE_RULE_IDS } from '../../src/decider.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RULE_ID = 'xdr_known_cve';
const BLOCK_PATTERN = 'log4shell_remote_lookup';
const SCHEMA = 'aleph.xdr.known-cve.deny.v1';
const MAX_TTL_MS = 900000;
const REQUEST_FIELDS = ['useragent', 'headers', 'url', 'query', 'args', 'params'];
export const RULE_IDS = Object.freeze([...BASE_RULE_IDS, RULE_ID]);
const hash = value => createHash('sha256').update(value).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const safeId = value => typeof value === 'string' && /^(?:kc-\d{1,12}|\d{1,20}(?:\.\d{1,20})?)$/u.test(value)
  ? value : 'event-' + hash(typeof value === 'string' ? value : '').slice(0, 24);

function address(value) {
  if (typeof value !== 'string' || value.includes('%') || !isIP(value)) return null;
  return isIP(value) === 6 ? new URL('http://[' + value + ']/').hostname.slice(1, -1) : value;
}

function blockable(ip) {
  if (!ip || ['0.0.0.0', '255.255.255.255', '::', '::1'].includes(ip)) return false;
  return isIP(ip) === 4 ? !ip.startsWith('127.') && Number(ip.split('.')[0]) < 224
    : !ip.startsWith('ff') && !ip.startsWith('::ffff:');
}

// 필드 순서가 달라도 같은 지문을 만들며 원문은 상태 파일과 로그에 보관하지 않습니다.
function canonical(value, depth = 0) {
  if (typeof value === 'string') return value.slice(0, 16384);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (!value || typeof value !== 'object' || depth >= 3) return null;
  if (Array.isArray(value)) return value.slice(0, 32).map(item => canonical(item, depth + 1));
  return Object.fromEntries(Object.keys(value).sort().slice(0, 32).map(key => [key, canonical(value[key], depth + 1)]));
}

function fingerprint(data) {
  return hash(JSON.stringify(Object.fromEntries(REQUEST_FIELDS.map(key => [key, canonical(data?.[key])]))));
}

// 단일 프로세스에서 같은 상태 파일을 다루는 호출들을 직렬화합니다.
let pendingWrites = Promise.resolve();
export function createResponder({
  statePath = join(ROOT, 'xdr/state/known-cve-deny.json'),
  logPath = join(ROOT, 'xdr/alerts.log'),
  clock = () => Date.now(),
  ttlMs = 300000,
  protectedSources = [],
} = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > MAX_TTL_MS) throw new Error('차단 만료는 1초부터 15분 사이여야 합니다.');
  const protectedHashes = new Set(protectedSources.map(value => {
    const ip = address(value);
    if (!ip) throw new Error('보호 주소 형식이 올바르지 않습니다.');
    return hash(ip);
  }));
  const nowMs = () => {
    const value = clock();
    if (!Number.isFinite(value) || !Number.isFinite(new Date(value).getTime())) throw new Error('검증 시각이 올바르지 않습니다.');
    return value;
  };
  const active = (rule, now) => Date.parse(rule.createdAt) <= now + 5000 && Date.parse(rule.expiresAt) > now;
  async function load() {
    let raw;
    try { raw = await readFile(statePath, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return { schema: SCHEMA, rules: [] };
      throw new Error('추가 거부 규칙을 읽을 수 없습니다.');
    }
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error('추가 거부 규칙 형식 오류'); }
    if (state?.schema !== SCHEMA || !Array.isArray(state.rules)
        || state.rules.some(rule => rule?.ruleId !== RULE_ID || rule.action !== 'deny'
          || (rule.patternName !== undefined && rule.patternName !== BLOCK_PATTERN)
          || !hex(rule.sourceHash) || !hex(rule.requestFingerprint)
          || !Number.isFinite(Date.parse(rule.createdAt)) || !Number.isFinite(Date.parse(rule.expiresAt))
          || Date.parse(rule.expiresAt) <= Date.parse(rule.createdAt)
          || Date.parse(rule.expiresAt) - Date.parse(rule.createdAt) > MAX_TTL_MS
          || !Array.isArray(rule.alertIds) || !rule.alertIds.length
          || rule.alertIds.some(id => typeof id !== 'string'
            || (safeId(id) !== id && !/^event-[a-f0-9]{24}$/u.test(id))))) {
      throw new Error('추가 거부 규칙 형식 오류');
    }
    return state;
  }
  async function save(state) {
    await mkdir(dirname(statePath), { recursive: true });
    const temporary = statePath + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      await rename(temporary, statePath);
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async function apply(alert, proposed) {
    // 전달받은 block 표지만 믿지 않고 독립 판단 모듈로 다시 계산합니다.
    const result = decide(alert);
    if (proposed && (proposed.action !== result.action || proposed.confidence !== result.confidence || proposed.reason !== result.reason)) {
      throw new Error('판단 결과가 원본 경보와 일치하지 않습니다.');
    }
    const now = nowMs();
    const eventAt = typeof alert?.timestamp === 'string' ? Date.parse(alert.timestamp) : NaN;
    const ip = address(alert?.data?.srcip);
    const sourceHash = ip ? hash(ip) : null;
    const alertId = safeId(alert?.id);
    const state = await load();
    state.rules = state.rules.filter(rule => active(rule, now));
    let installed = false;
    let disposition = result.action === 'block' ? 'invalid_or_stale_evidence' : 'not_a_block_candidate';
    if (result.action === 'block' && result.confidence >= 0.85 && blockable(ip)
        && Number.isFinite(eventAt) && eventAt <= now + 5000 && eventAt + ttlMs > now) {
      if (protectedHashes.has(sourceHash)) disposition = 'protected_source';
      else {
        const requestFingerprint = fingerprint(alert.data);
        const prior = state.rules.find(rule => rule.sourceHash === sourceHash
          && (rule.patternName === result.reason || (!rule.patternName && rule.requestFingerprint === requestFingerprint)));
        const createdAt = new Date(eventAt).toISOString();
        const expiresAt = new Date(eventAt + ttlMs).toISOString();
        if (prior) {
          installed = prior.patternName !== result.reason || !prior.alertIds.includes(alertId)
            || Date.parse(expiresAt) > Date.parse(prior.expiresAt);
          prior.patternName = result.reason;
          prior.alertIds = [...new Set([...prior.alertIds, alertId])];
          if (Date.parse(expiresAt) > Date.parse(prior.expiresAt)) {
            prior.createdAt = createdAt;
            prior.expiresAt = expiresAt;
          }
          disposition = installed ? 'installed' : 'duplicate';
        } else {
          state.rules.push({ ruleId: RULE_ID, action: 'deny', patternName: result.reason, sourceHash, requestFingerprint,
            createdAt, expiresAt, alertIds: [alertId] });
          installed = true;
          disposition = 'installed';
        }
      }
    }
    await save(state);
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, JSON.stringify({ moduleKey: 'known-cve', at: new Date(now).toISOString(),
      alertId, ...result, installed, disposition }) + '\n', { mode: 0o600 });
    return { ...result, installed, disposition, alertId };
  }
  const respond = (alert, proposed) => {
    const operation = pendingWrites.then(() => apply(alert, proposed));
    pendingWrites = operation.catch(() => {});
    return operation;
  };
  function wrapDecider(existingDecide = baseDecide) {
    return async function decideRequest(request, trustedEvidence) {
      const original = await existingDecide(request);
      // 기존 거부·추가 인증 판정을 우선하며 XDR이 허용으로 바꾸지 않습니다.
      if (original.decision !== 'allow') return original;
      if (!request?.requestId || trustedEvidence?.requestId !== request.requestId) {
        throw new Error('이번 요청에 대해 서버가 확인한 요청 증거가 필요합니다.');
      }
      const ip = address(trustedEvidence.srcip);
      if (!ip) throw new Error('서버가 확인한 출발 주소가 필요합니다.');
      const current = decide({ data: trustedEvidence });
      if (protectedHashes.has(hash(ip)) || current.action !== 'block') return original;
      const state = await load();
      const now = nowMs();
      const matched = state.rules.some(rule => active(rule, now) && rule.sourceHash === hash(ip)
        // 새 규칙은 같은 명확한 악용 패턴을 막습니다. 예전 규칙은 기존 지문 비교를 유지합니다.
        && (rule.patternName === current.reason || (!rule.patternName && rule.requestFingerprint === fingerprint(trustedEvidence))));
      if (!matched) return original;
      return { ...original, decision: 'deny', reasonCode: 'xdr_known_cve_blocked',
        ruleIds: [...new Set([...original.ruleIds, RULE_ID])] };
    };
  }
  return { respond, wrapDecider, ruleIds: RULE_IDS };
}

const defaultResponder = createResponder();
export const respond = (alert, result) => defaultResponder.respond(alert, result);
export const decideRequest = defaultResponder.wrapDecider();

// 과거 시각의 수업용 경보는 격리된 상태 파일과 가상 시계로만 재연합니다.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== '--fixture') throw new Error('시험 재연은 --fixture 옵션이 필요합니다.');
    const fixture = JSON.parse(await readFile(join(ROOT, 'xdr/fixtures/known-cve.json'), 'utf8'));
    const { fixtureRequests } = await import('../../scripts/fixture-7.mjs');
    await mkdir(join(ROOT, 'artifacts'), { recursive: true });
    const runDir = await mkdtemp(join(ROOT, 'artifacts/known-cve-replay-'));
    let now;
    const responder = createResponder({ statePath: join(runDir, 'deny.json'), clock: () => now });
    const gate = responder.wrapDecider();
    const counts = { block: 0, alert: 0, record: 0 };
    const checks = { attacksDenied: 0, ambiguousAllowed: 0, normalAllowed: 0, normalBlocked: 0,
      sameSourceNormalAllowed: 0, expiredAttackAllowed: 0 };
    for (const alert of [...fixture.alerts].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
      now = Date.parse(alert.timestamp) + 1;
      const result = await responder.respond(alert, decide(alert));
      counts[result.action]++;
      const request = fixtureRequests().normal;
      const outcome = await gate(request, { ...alert.data, requestId: request.requestId });
      if (result.action === 'block' && outcome.decision === 'deny') checks.attacksDenied++;
      if (result.action === 'alert' && outcome.decision === 'allow') checks.ambiguousAllowed++;
      if (result.action === 'record' && outcome.decision === 'allow') checks.normalAllowed++;
      if (result.action === 'record' && outcome.decision !== 'allow') checks.normalBlocked++;
      const clean = await gate(request, { requestId: request.requestId, srcip: alert.data.srcip, url: '/health' });
      if (clean.decision === 'allow') checks.sameSourceNormalAllowed++;
      if (result.action === 'block') {
        now = Date.parse(alert.timestamp) + 300000;
        if ((await gate(request, { ...alert.data, requestId: request.requestId })).decision === 'allow') checks.expiredAttackAllowed++;
      }
    }
    const report = { schema: 'aleph.xdr.known-cve.verification.v1', mode: 'isolated-fixture-clock',
      counts, checks, productionRulesChanged: false };
    await writeFile(join(ROOT, 'xdr/known-cve/verification.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
    if (checks.attacksDenied !== counts.block || checks.ambiguousAllowed !== counts.alert
        || checks.normalAllowed !== counts.record || checks.normalBlocked !== 0
        || checks.sameSourceNormalAllowed !== fixture.alerts.length || checks.expiredAttackAllowed !== counts.block) {
      throw new Error('시험 재연 불일치');
    }
  } catch {
    console.error('응답 모듈 실행 실패: 시험 재연과 추가 규칙 파일을 확인하세요.');
    process.exitCode = 1;
  }
}
