import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { runXdr } from './xdr-run.mjs';
import { fixtureRequests } from './fixture-7.mjs';
import { MODULE_KEYS } from '../xdr/respond-core.mjs';
import { createXdrGate } from '../xdr/gate.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

// 재연은 가상 경보 시각과 격리된 상태 폴더를 씁니다. 운영 차단 파일에는 쓰지 않습니다.
export async function runAll({ replay = false } = {}) {
  const modules = [], totals = { block: 0, alert: 0, record: 0 };
  let replayDir;
  if (replay) {
    await mkdir(join(root, 'artifacts'), { recursive: true });
    replayDir = await mkdtemp(join(root, 'artifacts/xdr-suite-'));
  }
  for (const moduleKey of MODULE_KEYS) {
    const result = await runXdr({ root, moduleKey, writeError: () => { throw new Error(`${moduleKey}: 판단 반환 오류`); } });
    for (const action of Object.keys(totals)) totals[action] += result.counts[action];
    const entry = { moduleKey, counts: result.counts };
    if (replay) {
      const fixture = JSON.parse(await readFile(join(root, `xdr/fixtures/${moduleKey}.json`), 'utf8'));
      let now;
      const gate = await createXdrGate({ stateDir: join(replayDir, moduleKey), clock: () => now });
      const checks = { attacksDenied: 0, otherEventsAllowed: 0, recordEventsBlocked: 0, expiryReleased: 0 };
      for (const alert of [...fixture.alerts].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))) {
        now = Date.parse(alert.timestamp) + 1;
        // 기기 격리는 경보별 독립 시나리오입니다. 이 값은 운영 기기 매핑이 아닙니다.
        const deviceId = createHash('sha256').update(`${moduleKey}:${alert.id}`).digest('hex').slice(0, 16);
        const decision = await gate.respond(moduleKey, alert, { deviceId });
        const request = { ...fixtureRequests().normal, deviceId };
        const context = { sourceIp: alert.data.srcip, account: alert.data.srcuser ?? 'fixture-anonymous',
          destinationIp: alert.data.dstip ?? '192.0.2.10',
          requestEvidence: { ...alert.data, requestId: request.requestId } };
        const actual = await gate.decideRequest(request, context);
        if (decision.action === 'block' && actual.decision === 'deny') checks.attacksDenied++;
        if (decision.action !== 'block' && actual.decision === 'allow') checks.otherEventsAllowed++;
        if (decision.action === 'record' && actual.decision !== 'allow') checks.recordEventsBlocked++;
      }
      now += 900001;
      for (const alert of fixture.alerts) {
        const deviceId = createHash('sha256').update(`${moduleKey}:${alert.id}`).digest('hex').slice(0, 16);
        const request = { ...fixtureRequests().normal, deviceId };
        const actual = await gate.decideRequest(request,
          { sourceIp: alert.data.srcip, account: alert.data.srcuser ?? 'fixture-anonymous',
            destinationIp: alert.data.dstip ?? '192.0.2.10',
            requestEvidence: { ...alert.data, requestId: request.requestId } });
        if (actual.decision === 'allow') checks.expiryReleased++;
      }
      if (checks.attacksDenied !== result.counts.block || checks.otherEventsAllowed !== result.counts.alert + result.counts.record
          || checks.recordEventsBlocked || checks.expiryReleased !== fixture.alerts.length) throw new Error(`${moduleKey}: 차단 재연 불일치`);
      entry.replay = checks;
    }
    modules.push(entry);
  }
  const summary = { schema: 'aleph.xdr.summary.v1', mode: replay ? 'isolated-fixture-replay' : 'fixture-decisions',
    modules, totals, productionConnected: false, officialJudgment: false };
  await writeFile(join(root, 'xdr/summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  if (replay) await writeFile(join(replayDir, 'report.json'), `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await runAll({ replay: process.argv.includes('--replay') }), null, 2)); }
  catch { console.error('XDR 전체 실행 실패. 개별 xdr:run 명령과 검증 시험으로 확인하세요.'); process.exitCode = 1; }
}
