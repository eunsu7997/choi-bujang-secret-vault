import { createResponder as createCoreResponder } from '../respond-core.mjs';
import { decide } from './decide.mjs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function createResponder(options = {}) {
  return createCoreResponder({ ...options, moduleKey: 'privilege', decide });
}
const worker = createResponder();
export const respond = alert => worker.respond(alert);
export const decideRequest = worker.wrapDecider();
export const RULE_IDS = worker.ruleIds;

// 과거 수업 경보는 운영 상태를 건드리지 않는 가상 시계/격리 폴더에서 재연합니다.
export async function replayFixture() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const { fixtureRequests } = await import('../../scripts/fixture-7.mjs');
  const fixture = JSON.parse(await readFile(join(root, 'xdr/fixtures/privilege.json'), 'utf8'));
  await mkdir(join(root, 'artifacts'), { recursive: true });
  const runDir = await mkdtemp(join(root, 'artifacts/privilege-replay-'));
  let now;
  const responder = createResponder({ statePath: join(runDir, 'deny.json'), clock: () => now });
  const gate = responder.wrapDecider();
  const counts = { block: 0, alert: 0, record: 0 };
  const checks = { attacksDenied: 0, ambiguousAllowed: 0, recordAllowed: 0,
    recordEventsBlocked: 0, sameSourceOtherAccountAllowed: 0, expiredAttackAllowed: 0 };
  const request = fixtureRequests().normal;
  for (const alert of [...fixture.alerts].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
    now = Date.parse(alert.timestamp) + 1;
    const result = await responder.respond(alert);
    counts[result.action]++;
    const context = { sourceIp: alert.data.srcip, account: alert.data.srcuser };
    const actual = await gate(request, context);
    if (result.action === 'block' && actual.decision === 'deny') checks.attacksDenied++;
    if (result.action === 'alert' && actual.decision === 'allow') checks.ambiguousAllowed++;
    if (result.action === 'record') {
      if (actual.decision === 'allow') checks.recordAllowed++;
      else checks.recordEventsBlocked++;
    }
    if ((await gate(request, { ...context, account: 'replay-unrelated-account' })).decision === 'allow') {
      checks.sameSourceOtherAccountAllowed++;
    }
    // 만료 시험은 별도 시각으로 확인하고 다음 사건의 재연 시각으로 복귀합니다.
    const eventClock = now;
    now += 300001;
    if (result.action === 'block' && (await gate(request, context)).decision === 'allow') checks.expiredAttackAllowed++;
    now = eventClock;
  }
  if (checks.attacksDenied !== counts.block || checks.ambiguousAllowed !== counts.alert
      || checks.recordAllowed !== counts.record || checks.recordEventsBlocked !== 0
      || checks.sameSourceOtherAccountAllowed !== fixture.alerts.length || checks.expiredAttackAllowed !== counts.block) {
    throw new Error('권한 상승 연결 재연 불일치');
  }
  const report = { schema: 'aleph.xdr.privilege.verification.v1', mode: 'isolated-fixture-replay',
    counts, checks, productionConnected: false, officialJudgment: false };
  await writeFile(join(root, 'xdr/privilege/verification.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(runDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--fixture') {
    console.error('시험 재연은 --fixture 옵션이 필요합니다.');
    process.exitCode = 1;
  } else {
    try { console.log(JSON.stringify(await replayFixture(), null, 2)); }
    catch { console.error('권한 상승 재연 실패. 전용 시험으로 첫 오류를 확인하세요.'); process.exitCode = 1; }
  }
}
