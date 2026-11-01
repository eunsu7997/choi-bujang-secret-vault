import { join } from 'node:path';
import { decide as baseDecide } from '../src/decider.mjs';
import { createResponder, MODULE_KEYS } from './respond-core.mjs';
import { createResponder as createKnownCveResponder } from './known-cve/respond.mjs';
import { createResponder as createPersistenceResponder } from './persistence/respond.mjs';
import { createResponder as createExfiltrationResponder } from './exfiltration/respond.mjs';

// 앱/엔진의 서버 연결부가 호출합니다. request의 공식 18개 항목은 추가하거나 바꾸지 않습니다.
export async function createXdrGate({ stateDir, logPath, clock, ttlMs, protectedSources, protectedDevices } = {}) {
  const responders = new Map();
  let decideRequest = baseDecide;
  for (const moduleKey of MODULE_KEYS) {
    const { decide } = await import(`./${moduleKey}/decide.mjs`);
    const options = { moduleKey, decide,
      ...(stateDir ? { statePath: join(stateDir, `${moduleKey}.json`) } : {}),
      ...(logPath ? { logPath } : {}), ...(clock ? { clock } : {}),
      ...(ttlMs === undefined ? {} : { ttlMs }), ...(protectedSources ? { protectedSources } : {}) };
    const factory = { 'known-cve': createKnownCveResponder, persistence: createPersistenceResponder,
      exfiltration: createExfiltrationResponder }[moduleKey] ?? createResponder;
    const worker = factory({ ...options, ...(protectedDevices ? { protectedDevices } : {}) });
    responders.set(moduleKey, worker);
    if (moduleKey === 'known-cve') {
      const prior = decideRequest;
      decideRequest = async (request, trustedContext) => {
        const original = await prior(request, trustedContext);
        if (original.decision !== 'allow') return original;
        if (trustedContext?.sourceIp !== trustedContext?.requestEvidence?.srcip) {
          throw new Error('이번 요청의 출발 주소와 요청 증거가 일치해야 합니다.');
        }
        return worker.wrapDecider(async () => original)(request, trustedContext?.requestEvidence);
      };
    } else if (moduleKey === 'persistence') {
      const prior = decideRequest;
      decideRequest = async (request, trustedContext) => {
        const original = await prior(request, trustedContext);
        if (original.decision !== 'allow') return original;
        return worker.wrapDecider(async () => original)(request);
      };
    } else decideRequest = worker.wrapDecider(decideRequest);
  }
  return {
    respond(moduleKey, alert, verifiedContext) {
      const worker = responders.get(moduleKey);
      if (!worker) throw new Error('알 수 없는 XDR 모듈');
      return moduleKey === 'persistence' ? worker.respond(alert, verifiedContext) : worker.respond(alert);
    },
    decideRequest,
  };
}
