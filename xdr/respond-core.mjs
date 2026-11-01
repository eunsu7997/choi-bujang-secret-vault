import { appendFile, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide as baseDecide, RULE_IDS as BASE_RULE_IDS } from '../src/decider.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const MODULE_KEYS = Object.freeze(['brute-force', 'web-injection', 'known-cve', 'persistence', 'privilege', 'exfiltration']);
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
// 한 프로세스에서 사용하는 파일 저장기입니다. 모듈 간 쓰기도 직렬화합니다.
let pending = Promise.resolve();

export function createResponder({ moduleKey, decide, statePath, logPath = join(ROOT, 'xdr/alerts.log'),
  clock = () => Date.now(), ttlMs = 300000, protectedSources = [] } = {}) {
  if (!MODULE_KEYS.includes(moduleKey) || typeof decide !== 'function') throw new Error('XDR 모듈 설정 오류');
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) throw new Error('차단 만료는 1초~15분입니다.');
  statePath ??= join(ROOT, `xdr/state/${moduleKey}-scoped-deny.json`);
  const ruleId = `xdr_${moduleKey.replaceAll('-', '_')}`;
  const protectedIps = new Set(protectedSources.map(value => {
    const ip = address(value);
    if (!ip) throw new Error('보호 주소 형식 오류');
    return ip;
  }));
  const needsAccount = !['web-injection', 'known-cve'].includes(moduleKey);
  function now() {
    const result = clock();
    if (!Number.isSafeInteger(result) || result < 0) throw new Error('검증 시각 오류');
    return result;
  }
  async function load() {
    let raw;
    try { raw = await readFile(statePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { schema: 'aleph.xdr.scoped-deny.v1', moduleKey, rules: [] }; throw new Error('차단 규칙 읽기 오류'); }
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error('차단 규칙 형식 오류'); }
    if (state?.schema !== 'aleph.xdr.scoped-deny.v1' || state.moduleKey !== moduleKey || !Array.isArray(state.rules)
        || state.rules.some(r => r?.ruleId !== ruleId || r.action !== 'deny' || !blockable(r.sourceIp)
          || (r.accountHash !== null && !/^[a-f\d]{64}$/u.test(r.accountHash)) || (needsAccount && !r.accountHash)
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
    const eventAt = validDate(alert?.timestamp) ? Date.parse(alert.timestamp) : NaN;
    const alertId = safeId(alert?.id);
    let installed = false, disposition = 'not_a_block_candidate';
    if (decision.action === 'block') {
      disposition = 'invalid_or_stale_evidence';
      if (blockable(ip) && (!needsAccount || account) && eventAt <= at + 5000 && eventAt + ttlMs > at) {
        if (protectedIps.has(ip)) disposition = 'protected_source';
        else {
          const expiresAt = new Date(eventAt + ttlMs).toISOString();
          const previous = state.rules.find(r => r.sourceIp === ip && r.accountHash === account);
          if (previous) {
            installed = !previous.alertIds.includes(alertId) || Date.parse(previous.expiresAt) < Date.parse(expiresAt);
            if (!previous.alertIds.includes(alertId)) previous.alertIds.push(alertId);
            if (Date.parse(previous.expiresAt) < Date.parse(expiresAt)) {
              previous.expiresAt = expiresAt;
              previous.evidenceAt = new Date(eventAt).toISOString();
            }
            disposition = installed ? 'installed' : 'duplicate';
          } else {
            state.rules.push({ ruleId, action: 'deny', sourceIp: ip, accountHash: account,
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
      if (needsAccount && !account) throw new Error('서버가 검증한 계정 매핑이 필요합니다.');
      const state = await load(), at = now();
      const blocked = !protectedIps.has(ip) && state.rules.some(r => r.sourceIp === ip
        && (!r.accountHash || r.accountHash === account) && Date.parse(r.expiresAt) > at);
      if (!blocked) return original;
      return { ...original, decision: 'deny', reasonCode: `${ruleId}_blocked`, ruleIds: [...new Set([...original.ruleIds, ruleId])] };
    };
  }
  return { respond, wrapDecider, ruleIds: Object.freeze([...BASE_RULE_IDS, ruleId]) };
}
