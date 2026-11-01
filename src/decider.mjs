// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기입니다.
// docs/DECIDER_REQUEST.md의 aleph.decision.v1 요청 이름만 읽습니다.
// 브라우저가 보낸 사용자 번호·역할·기기 키·토큰은 믿거나 저장하지 않습니다.
export const RULE_IDS = Object.freeze(['device_registered']);

const SCHEMA = 'aleph.decision.v1';

function respond(request, decision, reasonCode, ruleIds) {
  return {
    schema: SCHEMA,
    requestId: request && typeof request === 'object' ? request.requestId : undefined,
    decision,
    reasonCode,
    ruleIds,
  };
}

export async function decide(request) {
  // 6단계 device_registered: 엔진이 등록 기기라고 확인한 요청(true)만 허용합니다.
  // false·값 없음·true가 아닌 값은 모두 미등록으로 보고 거부합니다.
  const registered = request !== null && typeof request === 'object'
    && request.deviceRegistered === true;
  if (!registered) return respond(request, 'deny', 'device_not_registered', ['device_registered']);
  return respond(request, 'allow', 'approved', ['device_registered']);
}
