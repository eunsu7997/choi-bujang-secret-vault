// 12단계 제작 2: 1~11단계의 정상·금지 요청을 실제로 실행해 한 표로 남기는 절차입니다(본체는 src/ops-probe-core.mjs).
//   npm run ops:probe   운영 주소(aleph.config.json publicAppUrl)로 공개 HTTPS GET·HEAD 요청 + 학생 판정기·탐지기·정책 사본 실행
//   결과: 화면 표 출력 + artifacts/ops-results.json(Git 제외). 쓰기 점검(PUT·POST)은 보내지 않고 not_run, 로그인이 필요한 시험은 미실행입니다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runOpsProbe } from '../src/ops-probe-core.mjs';

export { policyProbe, runHttpProbe, runOpsProbe } from '../src/ops-probe-core.mjs';

if (process.argv[1] && /ops-probe\.mjs$/u.test(process.argv[1])) {
  const root = new URL('../', import.meta.url);
  const config = JSON.parse(readFileSync(new URL('aleph.config.json', root), 'utf8'));
  const report = await runOpsProbe({ base: config.publicAppUrl });
  for (const item of report.rows) {
    const mark = item.ok === true ? '통과' : item.ok === false ? '실패' : item.notRun ? 'not_run' : '미실행';
    process.stdout.write(`[${mark}] ${item.stage}단계 ${item.kind} · ${item.label} · 기대 ${item.expected} · 실제 ${item.actual} · 요청ID ${item.requestId}${item.serverId ? ` · 서버ID ${item.serverId}` : ''} · ${item.at}\n`);
  }
  process.stdout.write(`\n공식 41종(이 절차 기준, 공식 판정 아님): ${Object.entries(report.tally).map(([label, value]) => `${label} ${value}`).join(' · ')}\n`);
  mkdirSync(new URL('artifacts/', root), { recursive: true });
  writeFileSync(new URL('artifacts/ops-results.json', root), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write('결과: artifacts/ops-results.json (Git에 올리지 않음)\n');
}
