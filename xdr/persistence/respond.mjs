import { appendFile, mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from './decide.mjs';
import { decide as baseDecide, RULE_IDS as BASE_RULE_IDS } from '../../src/decider.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCHEMA = 'aleph.xdr.persistence.deny.v1';
const RULE = 'xdr_persistence';
export const RULE_IDS = Object.freeze([...BASE_RULE_IDS, RULE]);
const hash = value => createHash('sha256').update(value).digest('hex');
const deviceHash = value => typeof value === 'string' && /^[a-f0-9]{16}$/u.test(value) ? hash(value) : null;
const safeId = value => typeof value === 'string' && /^(?:ps-\d{1,12}|\d{1,20}(?:\.\d{1,20})?)$/u.test(value)
  ? value : `event-${hash(typeof value === 'string' ? value : '').slice(0, 24)}`;
const validId = value => typeof value === 'string' && (safeId(value) === value || /^event-[a-f\d]{24}$/u.test(value));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? Date.parse(value) : NaN;
let pending = Promise.resolve();

export function createResponder({ statePath = join(ROOT, 'xdr/state/persistence-deny.json'),
  logPath = join(ROOT, 'xdr/alerts.log'), clock = () => Date.now(), ttlMs = 300000, protectedDevices = [] } = {}) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1000 || ttlMs > 900000) throw new Error('차단 만료는 1초~15분입니다.');
  const protectedHashes = new Set(protectedDevices.map(value => {
    const hashed = deviceHash(value);
    if (!hashed) throw new Error('보호 기기 형식 오류');
    return hashed;
  }));
  function now() {
    const value = clock();
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) throw new Error('검증 시각 오류');
    return value;
  }
  async function load() {
    let raw;
    try { raw = await readFile(statePath, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return { schema: SCHEMA, rules: [] }; throw new Error('격리 규칙 읽기 오류'); }
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error('격리 규칙 형식 오류'); }
    if (state?.schema !== SCHEMA || !Array.isArray(state.rules) || state.rules.some(r => r?.ruleId !== RULE
      || r.action !== 'deny' || typeof r.deviceHash !== 'string' || !/^[a-f\d]{64}$/u.test(r.deviceHash)
      || !Number.isFinite(date(r.evidenceAt)) || !Number.isFinite(date(r.expiresAt))
      || date(r.expiresAt) <= date(r.evidenceAt) || date(r.expiresAt) - date(r.evidenceAt) > 900000
      || !Array.isArray(r.alertIds) || !r.alertIds.length || !r.alertIds.every(validId))) throw new Error('격리 규칙 형식 오류');
    return state;
  }
  async function save(state) {
    await mkdir(dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      await rename(temporary, statePath);
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function apply(alert, verifiedContext) {
    const decision = decide(alert), at = now(), state = await load();
    state.rules = state.rules.filter(r => date(r.expiresAt) > at);
    // 인증된 Wazuh 에이전트와 엔진 기기의 관리자 매핑만 받습니다. srcip/계정/표시 이름으로 추측하지 않습니다.
    const target = deviceHash(verifiedContext?.deviceId), evidenceAt = date(alert?.timestamp), alertId = safeId(alert?.id);
    let installed = false, disposition = 'not_a_block_candidate';
    if (decision.action === 'block') {
      disposition = target ? 'invalid_or_stale_evidence' : 'missing_device_mapping';
      if (target && evidenceAt <= at + 5000 && evidenceAt + ttlMs > at) {
        if (protectedHashes.has(target)) disposition = 'protected_device';
        else {
          const expiry = evidenceAt + ttlMs;
          const previous = state.rules.find(r => r.deviceHash === target);
          if (previous) {
            installed = !previous.alertIds.includes(alertId) || expiry > date(previous.expiresAt);
            if (!previous.alertIds.includes(alertId)) previous.alertIds.push(alertId);
            if (expiry > date(previous.expiresAt)) {
              previous.evidenceAt = new Date(evidenceAt).toISOString();
              previous.expiresAt = new Date(expiry).toISOString();
            }
          } else {
            state.rules.push({ ruleId: RULE, action: 'deny', deviceHash: target,
              evidenceAt: new Date(evidenceAt).toISOString(), expiresAt: new Date(expiry).toISOString(), alertIds: [alertId] });
            installed = true;
          }
          disposition = installed ? 'installed' : 'duplicate';
        }
      }
    }
    await save(state);
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify({ at: new Date(at).toISOString(), moduleKey: 'persistence', alertId,
      ...decision, installed, disposition })}\n`, { mode: 0o600 });
    return { ...decision, alertId, installed, disposition };
  }
  function respond(alert, verifiedContext) {
    const job = pending.then(() => apply(alert, verifiedContext));
    pending = job.catch(() => {});
    return job;
  }
  function wrapDecider(existingDecide = baseDecide) {
    return async request => {
      const original = await existingDecide(request);
      if (original.decision !== 'allow') return original;
      const target = deviceHash(request?.deviceId);
      if (!target) throw new Error('엔진이 검증한 deviceId가 필요합니다.');
      const state = await load(), at = now();
      if (protectedHashes.has(target) || !state.rules.some(r => r.deviceHash === target
        && date(r.evidenceAt) <= at + 5000 && date(r.expiresAt) > at)) return original;
      return { ...original, decision: 'deny', reasonCode: 'xdr_persistence_blocked', ruleIds: [...new Set([...original.ruleIds, RULE])] };
    };
  }
  return { respond, wrapDecider, ruleIds: RULE_IDS };
}
const worker = createResponder();
export const respond = (alert, verifiedContext) => worker.respond(alert, verifiedContext);
export const decideRequest = worker.wrapDecider();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] !== '--fixture') throw new Error('시험 재연에는 --fixture 옵션을 쓰세요.');
    const fixture = JSON.parse(await readFile(new URL('../fixtures/persistence.json', import.meta.url), 'utf8'));
    const { fixtureRequests } = await import('../../scripts/fixture-7.mjs');
    await mkdir(join(ROOT, 'artifacts'), { recursive: true });
    const directory = await mkdtemp(join(ROOT, 'artifacts/persistence-replay-'));
    const counts = { block: 0, alert: 0, record: 0 };
    const checks = { attacksDenied: 0, otherEventsAllowed: 0, otherDevicesAllowed: 0, normalBlocked: 0 };
    for (const [index, alert] of fixture.alerts.entries()) {
      // fixture의 agent.name은 공통 설명용 이름이므로 각 경보를 독립된 시나리오로 재연합니다.
      const deviceId = (index + 1).toString(16).padStart(16, '0');
      const responder = createResponder({ statePath: join(directory, `${index}.json`), clock: () => date(alert.timestamp) + 1 });
      const decision = await responder.respond(alert, { deviceId });
      counts[decision.action]++;
      const request = { ...fixtureRequests().normal, deviceId }, gate = responder.wrapDecider();
      const result = await gate(request);
      if (decision.action === 'block' && result.decision === 'deny') checks.attacksDenied++;
      if (decision.action !== 'block' && result.decision === 'allow') checks.otherEventsAllowed++;
      if (index >= 16 && result.decision !== 'allow') checks.normalBlocked++;
      if ((await gate({ ...request, deviceId: 'f'.repeat(16) })).decision === 'allow') checks.otherDevicesAllowed++;
    }
    const report = { mode: 'independent-fixture-scenarios', counts, checks, productionRulesChanged: false };
    await writeFile(join(directory, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    if (checks.attacksDenied !== counts.block || checks.otherEventsAllowed !== counts.alert + counts.record
      || checks.otherDevicesAllowed !== fixture.alerts.length || checks.normalBlocked !== 0) throw new Error('재연 결과 불일치');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
