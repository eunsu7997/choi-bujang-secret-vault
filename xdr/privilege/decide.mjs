// patterns.json의 검증된 근거를 그대로 옮긴 상수입니다.
// 수치 기준은 로컬 학습 정책이며 MITRE가 정한 임계값이 아닙니다.
const PATTERNS = [
  {
    "name": "unexpected_admin_membership",
    "condition": "administrators·sudo·wheel 그룹의 실제 추가/재가입과 원격 출발·일반 계정·반복 추가(3건 이상)·관리 명령·시간 외 신호 중 하나가 함께 있음. 수준 10~16, 유효한 출발 주소·계정 필요. 실패·부정·조회·교육 설명은 차단하지 않음.",
    "evidence": "MITRE T1078의 기존 계정 악용에 따른 권한 상승을 탐지하는 정황 패턴이며, 그룹 조작 행위 자체는 T1098로 보강함; 계정 탈취 성공을 확정하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1078/",
      "https://attack.mitre.org/techniques/T1098/"
    ],
    "minLevel": 10
  },
  {
    "name": "unexpected_elevated_execution",
    "condition": "관리자 명령 실행/세션 승격과 신규 출발지·직전 승격·다른 계정 권한 사용이 함께 보고됨. 수준 10~16, 유효한 출발 주소·계정 필요. 시간 외 신호 하나만 있으면 알림.",
    "evidence": "MITRE T1068은 소프트웨어 취약점 악용에 의한 승격, T1078은 기존 계정 권한 악용을 설명함; 이 패턴은 승격 후 이상 사용 정황만 탐지하며 취약점 악용이나 토큰 탈취 성공을 확정하지 않음.",
    "sources": [
      "https://attack.mitre.org/techniques/T1068/",
      "https://attack.mitre.org/techniques/T1078/"
    ],
    "minLevel": 10
  },
  {
    "name": "unconfirmed_privilege_change",
    "condition": "단발/취소/실패한 승격·그룹 변경·관리자 명령 시도, 시간 외 권한 사용 또는 필수 정보가 부족한 이상 사용은 알림. 읽기·변경 없음·교육용 설명·평소 로그인은 기록.",
    "evidence": "MITRE T1068·T1078의 권한 상승/계정 악용은 합법적인 관리자 활동과 구분해야 하므로, 권한 관련 신호 하나나 실패한 시도만으로 차단하지 않는 로컬 보수 정책임.",
    "sources": [
      "https://attack.mitre.org/techniques/T1068/",
      "https://attack.mitre.org/techniques/T1078/"
    ]
  }
];

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string'
  ? value.slice(0, 16384).normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/gu, ' ').trim() : '';
const number = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,15}$/u.test(value))) return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};
function validIp(ip) {
  if (typeof ip !== 'string') return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(ip)) return ip.split('.').every(part => String(Number(part)) === part && Number(part) <= 255);
  if (!/^[a-f\d:]{2,39}$/iu.test(ip) || ip.includes(':::')) return false;
  const parts = ip.split('::');
  if (parts.length > 2) return false;
  const groups = parts.flatMap(part => part ? part.split(':') : []);
  return groups.every(part => /^[a-f\d]{1,4}$/iu.test(part)) && (parts.length === 2 ? groups.length < 8 : groups.length === 8);
}
function answer(confidence, reason) {
  return { action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason };
}

export function decide(alert) {
  if (!object(alert?.data) || !object(alert?.rule)) return answer(0, 'no_supported_pattern');
  const d = alert.data, s = text(alert.rule.description), level = number(alert.rule.level);
  const group = text(d.group).toLowerCase();
  const adminGroup = group === 'administrators' || group === 'sudo' || group === 'wheel';
  // 원문 설명에 있는 행위와 문맥만 검사합니다. ID·계정 이름·MITRE 표지는 정답으로 쓰지 않습니다.
  const membership = /관리자\s*그룹.{0,100}(?:추가|들어|가입)|다시\s*관리자로\s*들어|(?:added|joined|rejoined).{0,80}(?:administrators|sudo|wheel)|(?:administrators|sudo|wheel).{0,80}(?:added|joined)/iu.test(s);
  const execution = /관리자\s*명령|권한\s*명령|세션.{0,80}관리자\s*권한|(?:admin(?:istrator)?|privileged|elevated)\s+command|session.{0,80}(?:elevated|admin(?:istrator)?\s+privileges)/iu.test(s);
  // 계정 권한 종류 조사와 그룹 설명 변경은 승격 성공이 아니어도 검토할 약한 신호입니다.
  // 단순 그룹 소속 읽기·자기 세션 조회와 구분하며, 실제 승격/명령의 차단 판정을 덮지 않습니다.
  const privilegeInquiry = !membership && !execution && (
    /계정\s*(?:종류|유형|권한).{0,60}(?:조회|확인)|(?:조회|확인).{0,60}계정\s*(?:종류|유형|권한)/u.test(s)
    || /그룹.{0,60}설명.{0,40}(?:바뀌|변경|수정)/u.test(s));
  const relevant = privilegeInquiry || membership || execution || /권한\s*상승|그룹.{0,80}(?:추가|만들)|관리자로|privilege\s+escalation/iu.test(s);
  if (!relevant) return answer(0.05, 'no_supported_pattern');
  if (privilegeInquiry) return answer(0.6, PATTERNS[2].name);

  // 단어 언급·부정·조회가 양성 신호로 승격되는 것을 막습니다.
  const failed = /취소|실패|\b(?:failed|cancelled|canceled|denied|attempt(?:ed)?)\b/iu.test(s);
  const noChange = /(?:추가|가입|실행|승격|변경|상승)(?:는|은|가|이|된\s*적이)?\s*없|(?:추가|가입|실행|승격|변경|상승)(?:를|을)?\s*(?:하지|되지|되지도)\s*않|관리자\s*그룹은\s*아닙|\b(?:not|never)\s+(?:added|executed|elevated)|\bno\s+(?:changes?|execution|elevation)\b/iu.test(s);
  const readOnly = /읽기만|조회한\s*뒤\s*변경은\s*없|목록을\s*읽은|(?:안내|설명|문서|교육|수업\s*자료).{0,80}(?:읽|조회|학습)|\bread[ -]only\b|\b(?:read|viewed).{0,80}(?:documentation|tutorial|guide)\b/iu.test(s);
  if (readOnly || (noChange && !failed && !/관리자\s*그룹은\s*아닙/u.test(s))) return answer(0.05, 'no_supported_pattern');
  if (failed || noChange) return answer(0.6, PATTERNS[2].name);

  const remote = /원격\s*주소|\bremote\s+(?:address|source|ip)\b/iu.test(s);
  const ordinary = /평범한\s*계정|일반\s*계정|\b(?:ordinary|standard|unprivileged)\s+(?:user|account)\b/iu.test(s);
  const newSource = /처음\s*보는\s*(?:주소|출발지)|주소는\s*처음|\b(?:new|unseen|unfamiliar)\s+(?:source|address|ip)\b/iu.test(s);
  const recentElevation = /방금\s*관리자|직전\s*승격|\b(?:just|newly|recently).{0,40}(?:elevated|admin(?:istrator)?|promoted)\b/iu.test(s);
  const otherAccount = /다른\s*계정의\s*권한|\banother\s+account.{0,40}privileges\b/iu.test(s);
  const afterHours = /(?:수업|업무)\s*시간\s*(?:밖|외)|업무처럼\s*보이지\s*않는|\bafter[ -]hours\b|\boutside\s+(?:business|working)\s+hours\b/iu.test(s);
  const reAdded = /빠진\s*계정.{0,80}다시|\brejoined\b|\bre[ -]added\b/iu.test(s);
  const approved = /승인된|승인을\s*받|\bapproved\b|\bauthorized\b/iu.test(s);
  const account = typeof d.srcuser === 'string' && d.srcuser.trim().length > 0 && d.srcuser.length <= 200;
  const attributable = validIp(d.srcip) && account && level <= 16;
  // 시간만으로 업무 시간 여부를 추측하지 않습니다. 경보가 보고한 기준 이탈만 사용합니다.
  if (!approved && attributable) {
    if (adminGroup && membership && level >= PATTERNS[0].minLevel
        && (remote || ordinary || execution || afterHours || reAdded || number(d.count) >= 3)) {
      return answer(0.95, PATTERNS[0].name);
    }
    if (execution && level >= PATTERNS[1].minLevel && (newSource || recentElevation || otherAccount)) {
      return answer(0.93, PATTERNS[1].name);
    }
  }
  return answer(0.6, PATTERNS[2].name);
}
