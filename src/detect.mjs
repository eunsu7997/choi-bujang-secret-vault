// 9단계 학생 탐지기입니다. docs/DETECT_EVENTS.md의 가상 사건 계약을 따릅니다.
// 반 엔진이 검증한 사건만 전달해야 하며, 브라우저가 보낸 사용자 번호는 받지 않습니다.
// 사건마다 at(시각)·method(요청 종류)·identity.sub(가명 사용자) 세 값만 읽습니다.
// 네트워크·기기·지역 값은 만들거나 조건으로 쓰지 않고, 메모 내용·토큰·실명은 저장하거나 출력하지 않습니다.

const WINDOW_MS = 10 * 60 * 1000; // 10분 구간
const BURST_LIMIT = 120; // 120건을 "넘으면"(121건 이상) 의심, 정확히 120건은 정상
const OBSERVE = Object.freeze({ action: 'observe' });

// 제작 1: 세 값만 꺼냅니다. 형식이 맞지 않는 사건은 세지 않습니다(정상값으로 채우지 않음).
function readEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const at = typeof event.at === 'string' ? Date.parse(event.at) : Number.NaN;
  const method = typeof event.method === 'string' ? event.method.toUpperCase() : null;
  const identity = event.identity;
  const sub = identity && typeof identity === 'object' && !Array.isArray(identity)
    && typeof identity.sub === 'string' && identity.sub.length > 0 ? identity.sub : null;
  if (!Number.isFinite(at) || !method || !sub) return null;
  return { at, method, sub };
}

// 제작 2: 규칙 burst_read. 같은 sub의 GET만, at 시각만으로 어느 10분 구간이든 121건 이상인지 봅니다.
// 구간은 첫 사건 시각부터 10분 미만입니다(정확히 10분 뒤 사건은 다음 구간).
function firstBurst(times) {
  times.sort((a, b) => a - b);
  let start = 0;
  for (let end = 0; end < times.length; end += 1) {
    while (times[end] - times[start] >= WINDOW_MS) start += 1;
    if (end - start + 1 > BURST_LIMIT) return times[end];
  }
  return null;
}

export function detect(events) {
  if (!Array.isArray(events)) return { ...OBSERVE };
  const readsBySub = new Map();
  for (const raw of events) {
    const event = readEvent(raw);
    if (!event || event.method !== 'GET') continue;
    if (!readsBySub.has(event.sub)) readsBySub.set(event.sub, []);
    readsBySub.get(event.sub).push(event.at);
  }
  // 여러 사용자가 폭주하면 가장 먼저 기준을 넘은 사용자 한 명만 제안합니다.
  let suspect = null;
  for (const [sub, times] of readsBySub) {
    const crossedAt = firstBurst(times);
    if (crossedAt !== null && (!suspect || crossedAt < suspect.crossedAt)) suspect = { sub, crossedAt };
  }
  // 제작 3: 정확히 세 키만 돌려줍니다. 회수 실행·기기 권한 변경은 하지 않습니다.
  if (suspect) return { action: 'propose_revocation', reasonCode: 'burst_read', subject: suspect.sub };
  return { ...OBSERVE };
}
