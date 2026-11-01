// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// docs/DECIDER_REQUEST.md의 aleph.decision.v1 요청 이름만 읽습니다.
// 브라우저가 보낸 사용자 번호·역할·기기 키·토큰·위치는 믿거나 저장하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered', 'step_up_required']);

const SCHEMA = 'aleph.decision.v1';

// 7단계 제작 1: 엔진이 검증해 넘긴 가상 접속 사건만 근거로 씁니다.
// 실제 경로의 source "none"이나 출처를 알 수 없는 값(예: 클라이언트 헤더)은 근거가 아닙니다.
const TRUSTED_SIGNAL_SOURCES = new Set(['judge_fixture']);
const USUAL_REGION = 'local';
const USUAL_NETWORK = 'usual';
const UNUSUAL_HOURS = new Set([0, 1, 2, 3, 4, 5]); // 평소와 다른 시각(새벽 0~5시)
const BURST_WINDOW_SECONDS = 600; // 최근 10분
const BURST_COUNT = 10; // 10분 안에 10건 이상이면 갑작스러운 대량 접근
const STEP_UP_FACTORS = 2; // 이상 근거가 2개 이상 겹칠 때만 추가 확인
const FRESH_STEP_UP_SECONDS = 300; // 추가 확인 후 5분 안의 요청만 다시 허용

function respond(request, decision, reasonCode, ruleIds) {
  return {
    schema: SCHEMA,
    requestId: request && typeof request === 'object' ? request.requestId : undefined,
    decision,
    reasonCode,
    ruleIds,
  };
}

const knownText = value => (typeof value === 'string' && value && value !== 'unknown' ? value : null);

// 값이 없거나 출처가 불명확하면 null입니다. 정상값으로 채우지 않습니다.
function trustedSignals(request) {
  const signals = request.signals;
  if (!signals || typeof signals !== 'object' || Array.isArray(signals)
      || !TRUSTED_SIGNAL_SOURCES.has(signals.source)) return null;
  const hour = Number.isInteger(signals.hour) && signals.hour >= 0 && signals.hour <= 23 ? signals.hour : null;
  return { region: knownText(signals.region), network: knownText(signals.network), hour };
}

// recentEvents는 엔진이 만든 최근 사건입니다. 최근 10분 건수만 셉니다.
function recentBurst(request) {
  const events = Array.isArray(request.recentEvents) ? request.recentEvents.slice(0, 12) : [];
  let total = 0;
  for (const item of events) {
    if (!item || typeof item !== 'object' || typeof item.kind !== 'string') continue;
    if (!Number.isFinite(item.ageSeconds) || item.ageSeconds < 0 || item.ageSeconds > BURST_WINDOW_SECONDS) continue;
    if (Number.isInteger(item.count) && item.count > 0) total += item.count;
  }
  return total >= BURST_COUNT;
}

// 지역 하나만으로는 추가 확인도 차단도 하지 않습니다. 여러 근거가 겹쳐야 합니다.
function riskFactors(request) {
  const signals = trustedSignals(request);
  const factors = [];
  if (signals?.hour !== null && signals?.hour !== undefined && UNUSUAL_HOURS.has(signals.hour)) factors.push('unusual_hour');
  if (signals?.network && signals.network !== USUAL_NETWORK) factors.push('new_network');
  if (signals?.region && signals.region !== USUAL_REGION) factors.push('region_change');
  if (recentBurst(request)) factors.push('burst_access');
  return factors;
}

function freshStepUp(request) {
  const stepUp = request.stepUp;
  return Boolean(stepUp && typeof stepUp === 'object' && stepUp.verified === true
    && Number.isInteger(stepUp.authAgeSeconds)
    && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= FRESH_STEP_UP_SECONDS);
}

export async function decide(request) {
  // 6단계 device_registered: 엔진이 등록 기기라고 확인한 요청(true)만 다음 검사로 넘깁니다.
  const registered = request !== null && typeof request === 'object'
    && request.deviceRegistered === true;
  if (!registered) return respond(request, 'deny', 'device_not_registered', ['device_registered']);

  // 7단계 step_up_required: 이상 근거가 겹치면 영구 차단 대신 추가 확인(다시 로그인)을 요구합니다.
  if (riskFactors(request).length >= STEP_UP_FACTORS) {
    if (freshStepUp(request)) return respond(request, 'allow', 'approved', ['device_registered', 'step_up_required']);
    return respond(request, 'step_up', 'step_up_required', ['step_up_required']);
  }
  return respond(request, 'allow', 'approved', ['device_registered']);
}
