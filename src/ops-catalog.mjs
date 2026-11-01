// 12단계 탈환 작전실의 공통 목록입니다. 브라우저(빌드 때 public/ops-catalog.mjs로 복사)와 Node 절차가 같은 파일을 씁니다.
// 여기에는 시험 "정의"만 있습니다. 통과 여부는 실제 요청·실행 결과로만 정하고, 결과가 없으면 미실행입니다.

export const RESTORE_TARGET_ID = 'b4b4b4b4-0000-4000-8000-000000000001';
const RANDOM_NOTE = 'aaaaaaaa-0000-4000-8000-00000000abcd';
// 서명이 맞지 않는 가짜 토큰입니다(비밀값 아님). 서버는 401로 거부해야 합니다.
export const FORGED_BEARER = 'Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvcHMtZm9yZ2VkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.AAAA';

// 운영 주소로 실제로 보내는 요청(로그인 없이·위조 토큰만). 로그인 토큰이 필요한 시험은 여기 없고 미실행으로 남습니다.
export const HTTP_PROBES = Object.freeze([
  { id: 'http_root_ok', stage: 11, kind: '정상', label: '첫 화면 열기', method: 'GET', path: '/', expect: [200] },
  { id: 'http_manifest_ok', stage: 11, kind: '정상', label: '설치형 앱 설정 열기', method: 'GET', path: '/manifest.webmanifest', expect: [200] },
  { id: 'http_aleph_json_ok', stage: 12, kind: '정상', label: '배포 신원(aleph.json) 열기', method: 'GET', path: '/aleph.json', expect: [200] },
  { id: 'http_data_json_hidden', stage: 2, kind: '금지', label: '공개 data.json 직접 열기', method: 'GET', path: '/data.json', expect: [404] },
  { id: 'http_notes_anon', stage: 3, kind: '금지', label: '로그인 없이 메모 목록 조회', method: 'GET', path: '/api/notes', expect: [401] },
  { id: 'http_note_item_anon', stage: 4, kind: '금지', label: '로그인 없이 다른 메모 ID 조회', method: 'GET', path: `/api/notes/${RANDOM_NOTE}`, expect: [401] },
  { id: 'http_notes_forged', stage: 3, kind: '금지', label: '서명이 틀린 토큰으로 메모 조회', method: 'GET', path: '/api/notes', auth: 'forged', expect: [401] },
  { id: 'http_note_put_anon', stage: 12, kind: '금지', label: '로그인·서명 없이 메모 수정', method: 'PUT', path: `/api/notes/${RANDOM_NOTE}`, body: { title: 'x', body: 'x' }, expect: [401] },
  { id: 'http_notices_anon', stage: 8, kind: '금지', label: '로그인 없이 반 공지 조회', method: 'GET', path: '/api/notices', expect: [401] },
  { id: 'http_admin_notice_anon', stage: 8, kind: '금지', label: '로그인 없이 강사 공지 수정', method: 'PUT', path: '/api/admin/notices/notice-class-guide', body: { title: 'x', body: 'x' }, expect: [401] },
  { id: 'http_restore_anon', stage: 10, kind: '금지', label: '로그인 없이 복구 경로 호출', method: 'POST', path: `/api/restore/${RESTORE_TARGET_ID}`, expect: [401] },
  { id: 'http_device_status_anon', stage: 11, kind: '금지', label: '로그인 없이 기기 승인 상태 조회', method: 'GET', path: '/api/device/status', expect: [401] },
  { id: 'http_ops_summary_anon', stage: 12, kind: '금지', label: '로그인 없이 작전실 요약 조회', method: 'GET', path: '/api/ops/summary', expect: [401] },
]);

// 공식 41종. 6~12단계는 이 대화·카드에 나온 이름, 1~5단계는 이 저장소에 이름 기록이 없어 "이름 미기록"으로 둡니다.
// probes: 이 공격과 관련해 실제로 실행되는 시험 ID, untested: 실행하지 못하는 부분(있으면 통과가 아니라 부분 실측).
const A = (stage, name, attack, probes = [], untested = '') => ({ stage, name, attack, probes, untested });
export const ATTACKS = Object.freeze([
  ...Array.from({ length: 16 }, (_, i) => A(i < 3 ? 1 : i < 6 ? 2 : i < 9 ? 3 : i < 12 ? 4 : 5,
    `1~5단계 공식 공격 ${i + 1}`, '이 저장소에 공식 공격 이름·순서 기록이 없음', [], '이름 미기록 · 심판 판정 대기')),
  A(6, '나태한해태', '미등록 기기 인증서로 자료실 조회', ['decider_unregistered_deny'], '실제 인증서 경로는 반 엔진 범위'),
  A(6, '의성6쪽마누라', '클라이언트 인증서 없이 mTLS 통로 요청', [], '반 엔진 mTLS 범위'),
  A(6, '김보성녹차', '등록 기기와 다른 사용자 토큰을 조합', ['decider_unregistered_deny'], '다른 사용자 토큰 조합은 로그인 토큰 필요'),
  A(6, '청양후추', '판정기에 등록되지 않은 가상 기기 사건을 직접 입력', ['decider_unregistered_deny']),
  A(7, '금산산삼', '가상 접속 지역이 급변한 사건을 판정기에 입력', ['decider_region_burst_step_up', 'decider_region_only_allow']),
  A(7, '조치원복슬복슬아', '평소와 다른 시각의 가상 접속 사건을 입력', ['decider_hour_network_step_up']),
  A(7, '울산흔들바지', '낯선 네트워크에서 대량 수정하는 가상 사건을 입력', ['decider_network_burst_step_up']),
  A(7, '순창된장고추장', '추가 인증을 마치지 않은 토큰으로 민감 메모 조회', ['decider_stale_step_up', 'decider_fresh_step_up_allow'], '민감 메모 구분 값은 계약에 없음'),
  A(8, '갓김치사량', '다른 구역 메모를 API로 조회', ['http_note_item_anon', 'zone_unknown_deny'], '다른 사용자 토큰으로 남의 메모 조회는 로그인 토큰 필요'),
  A(8, '충무공김밥', '다른 구역 메모를 API로 수정', ['http_note_put_anon'], '다른 사용자 토큰으로 수정은 로그인 토큰 필요'),
  A(8, '성주참외롭다', '다른 구역의 메모 목록을 API로 조회', ['zone_note_list_deny', 'http_notes_anon']),
  A(8, '경주화남빵', '학생 시험 계정으로 강사 공지 수정', ['zone_notice_write_deny', 'http_admin_notice_anon'], '학생 토큰으로 관리 경로 403은 로그인 토큰 필요'),
  A(9, '대구막창드라마', '합성 도플갱어 접속 사건을 기록과 탐지기에 입력', ['detect_burst_revoke', 'detect_exact_120_observe', 'detect_normal_observe']),
  A(9, '제주흑돈까스', '회수된 신원으로 다음 요청을 재시도', [], '반 엔진 회수 연결 범위'),
  A(9, '나폴리맛소금', '회수 뒤 남은 탈취 세션으로 재접속', [], '반 엔진 회수 연결 범위'),
  A(9, '개발세발낙지', '회수된 도플갱어가 다른 자원으로 이동', ['zone_unknown_deny'], '회수 상태 연동은 반 엔진 범위'),
  A(10, '닭크웹', '시험 계정 B의 메모를 변조한 뒤 복구 경로 호출', ['http_restore_anon'], '학생 B·심판 토큰으로 복구는 로그인 토큰 필요'),
  A(10, '동래해물피자', '시험 계정 B의 메모를 삭제한 뒤 복구 경로 호출', ['http_restore_anon'], '학생 B·심판 토큰으로 복구는 로그인 토큰 필요'),
  A(10, '속초꼴뚜기순대', '복구 직후 1~9단계 대표 공격을 다시 전송', ['policy_snapshot_verified', 'http_notes_anon', 'http_notes_forged', 'decider_unregistered_deny', 'zone_note_list_deny'], '로그인 토큰이 필요한 대표 공격'),
  A(11, '대구두꺼운만두', '설치형 앱 서명 없이 보호 요청', ['http_device_status_anon', 'http_notes_anon'], '승인되지 않은 기기의 로그인 쿠키 요청은 로그인 필요'),
  A(11, '호박엿장수마음대로', '서명 뒤 요청 경로를 변경', [], '반 엔진 요청 서명 범위'),
  A(11, '부산돼지미역국밥', '서명 뒤 수정 본문을 변경', [], '반 엔진 요청 서명 범위'),
  A(12, '1첩반상', '무인증 조회와 타인 메모 조회를 같은 제출본에 연속 전송', ['http_notes_anon', 'http_note_item_anon'], '타인 메모 조회는 로그인 토큰 필요'),
  A(12, '천안호날두과자', '미등록 기기 요청 뒤 회수된 신원으로 다시 전송', ['decider_unregistered_deny'], '회수된 신원 재전송은 반 엔진 범위'),
  A(12, '양양송이버섯고양이', '복구 뒤 서명 없는 변경 요청과 구역 밖 조회를 전송', ['http_note_put_anon', 'zone_unknown_deny', 'policy_snapshot_verified']),
].map((item, index) => Object.freeze({ id: `atk_${String(index + 1).padStart(2, '0')}`, ...item })));

// results: { [probeId]: { ok: boolean } } — 실행한 시험만 들어 있습니다.
export function attackStatus(attack, results) {
  const ran = attack.probes.filter(id => results[id]);
  if (!ran.length) return { status: '미실행', detail: attack.untested || '실행한 시험 없음' };
  if (ran.some(id => results[id].ok !== true)) return { status: '실측 실패', detail: ran.filter(id => results[id].ok !== true).join(', ') };
  if (ran.length < attack.probes.length || attack.untested) {
    return { status: '부분 실측', detail: [ran.length < attack.probes.length ? `미실행 시험 ${attack.probes.length - ran.length}개` : '', attack.untested].filter(Boolean).join(' · ') };
  }
  return { status: '실측 통과', detail: `${ran.length}개 시험 기대대로` };
}

export function tally(results) {
  const counts = { '실측 통과': 0, '부분 실측': 0, '실측 실패': 0, '미실행': 0 };
  for (const attack of ATTACKS) counts[attackStatus(attack, results).status] += 1;
  return counts;
}
