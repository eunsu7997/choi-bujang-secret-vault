// 12단계: 학생 판정기·탐지기를 고정 가상 요청으로 직접 실행한 결과입니다(서버 함수와 Node 절차가 함께 씁니다).
// 결과는 실행할 때마다 새로 계산하며, 메모 본문·토큰은 다루지 않습니다.
// 심판 격리 실행기에서도 불러올 수 있도록 src/ 밖 파일(scripts/)을 불러오지 않습니다.
import { createHash, randomUUID } from 'node:crypto';
import { decide } from './decider.mjs';
import { detect } from './detect.mjs';

// scripts/fixture-7.mjs와 같은 모양의 고정 가상 요청(엔진의 공개 입력 모양)입니다.
const fixture = (signals, recentEvents) => ({
  schema: 'aleph.decision.v1', requestId: randomUUID(), classId: 'class_fixture',
  projectId: 'project_fixture', subjectId: 'learner_fixture', deviceId: 'a'.repeat(16),
  service: 'notes', method: 'GET', path: '/notes/demo', route: 'GET /notes/:id',
  queryLength: 0, querySha256: createHash('sha256').update('').digest('hex'),
  at: new Date().toISOString(), policyRevision: 1, deviceRegistered: true,
  stepUp: { verified: false, authAgeSeconds: null }, recentEvents, signals,
});
const fixtureRequests = () => ({
  normal: fixture({ source: 'judge_fixture', region: 'local', network: 'usual', hour: 14 }, []),
  suspicious: fixture({ source: 'judge_fixture', region: 'foreign', network: 'unusual', hour: 3 }, [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }]),
});

const burst = [{ kind: 'risk_signal', ageSeconds: 60, count: 20 }];
const sig = (region, network, hour) => ({ source: 'judge_fixture', region, network, hour });
const reads = (count, gap, sub = 'learner_fixture') => Array.from({ length: count }, (_, i) => ({
  at: new Date(Date.UTC(2026, 9, 1) + i * gap * 1000).toISOString(), method: 'GET', identity: { sub } }));

function deciderCases() {
  const { normal, suspicious } = fixtureRequests();
  const zone = (service, method, path, route) => ({ ...normal, service, method, path, route });
  return [
    ['decider_normal_allow', 7, '정상', '정상 사건(등록 기기·평소 접속)', normal, 'allow'],
    ['decider_unregistered_deny', 6, '금지', '미등록 기기 사건', { ...normal, deviceRegistered: false }, 'deny'],
    ['decider_composite_step_up', 7, '금지', '새벽·낯선 네트워크·지역·대량 접근 복합 사건', suspicious, 'step_up'],
    ['decider_region_burst_step_up', 7, '금지', '지역 급변 + 대량 접근', { ...normal, signals: sig('foreign', 'usual', 14), recentEvents: burst }, 'step_up'],
    ['decider_region_only_allow', 7, '정상', '지역만 바뀐 정상 사용자(영구 차단 금지)', { ...normal, signals: sig('foreign', 'usual', 14) }, 'allow'],
    ['decider_hour_network_step_up', 7, '금지', '평소와 다른 시각 + 낯선 네트워크', { ...normal, signals: sig('local', 'unusual', 3) }, 'step_up'],
    ['decider_network_burst_step_up', 7, '금지', '낯선 네트워크 + 대량 수정', { ...normal, method: 'PUT', route: 'PUT /notes/:id', signals: sig('local', 'unusual', 14), recentEvents: burst }, 'step_up'],
    ['decider_stale_step_up', 7, '금지', '추가 확인이 오래된(900초) 복합 사건', { ...suspicious, stepUp: { verified: true, authAgeSeconds: 900 } }, 'step_up'],
    ['decider_fresh_step_up_allow', 7, '정상', '추가 확인을 마친(60초) 복합 사건', { ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } }, 'allow'],
    ['zone_own_note_allow', 8, '정상', '메모 ID 하나 읽기 GET /notes/:id', zone('notes', 'GET', '/notes/demo', 'GET /notes/:id'), 'allow'],
    ['zone_note_list_deny', 8, '금지', '메모 전체 목록 GET /notes', zone('notes', 'GET', '/notes', 'GET /notes'), 'deny'],
    ['zone_notice_write_deny', 8, '금지', '반 공지 수정 PUT /notices/:id', zone('notices', 'PUT', '/notices/n1', 'PUT /notices/:id'), 'deny'],
    ['zone_instructor_deny', 8, '금지', '강사 자료 조회', zone('instructor', 'GET', '/instructor/m1', 'GET /instructor/:id'), 'deny'],
    ['zone_unknown_deny', 8, '금지', '구역 밖(알 수 없는) 경로 조회', zone('unknown', 'GET', '/other/x', 'GET /other/:id'), 'deny'],
  ];
}

export async function runLocalProbes() {
  const out = [];
  for (const [id, stage, kind, label, request, expected] of deciderCases()) {
    const at = new Date().toISOString();
    const requestId = randomUUID();
    const result = await decide({ ...request, requestId });
    out.push({ id, stage, kind, label, where: '학생 판정기(src/decider.mjs)', expected, actual: `${result.decision} · ${result.reasonCode}`,
      ok: result.decision === expected && result.requestId === requestId, requestId, at });
  }
  for (const [id, label, events, expected] of [
    ['detect_normal_observe', '정상 조회 30건', reads(30, 2), 'observe'],
    ['detect_exact_120_observe', '10분 안 정확히 120건', reads(120, 2), 'observe'],
    ['detect_burst_revoke', '10분 안 121건 폭주', reads(121, 2), 'propose_revocation'],
  ]) {
    const at = new Date().toISOString();
    const result = detect(events);
    out.push({ id, stage: 9, kind: expected === 'observe' ? '정상' : '금지', label, where: '학생 탐지기(src/detect.mjs)', expected,
      actual: result.action + (result.reasonCode ? ` · ${result.reasonCode}` : ''), ok: result.action === expected, requestId: randomUUID(), at });
  }
  return out;
}
