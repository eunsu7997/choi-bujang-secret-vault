// patterns.json의 검증된 근거를 그대로 옮긴 상수입니다.
// 수치 기준은 로컬 학습 정책이며 MITRE가 정한 임계값이 아닙니다.
const PATTERNS = [
  {
    "name": "suspicious_service",
    "condition": "서비스 생성·실행 파일 변경에 서명 없음과 임시 경로 또는 반복 원격 등록이 겹치거나, 평소 목록에 없는 서비스가 임시 경로에서 재부팅 후에도 남도록 등록됨. 수준 10 이상.",
    "evidence": "MITRE T1543: 서비스를 생성·변경해 반복 실행과 재부팅 후 지속 실행을 구성.",
    "source": "https://attack.mitre.org/techniques/T1543/",
    "minLevel": 10
  },
  {
    "name": "suspicious_scheduled_task",
    "condition": "새 예약 작업이 임시 실행 파일을 가리키며 시간 외 실행·임의 이름·시작 프로그램 중복 중 하나가 함께 확인됨. 수준 10 이상.",
    "evidence": "MITRE T1053: 예약 작업을 이용해 프로그램을 정해진 시각 또는 시작 시 실행.",
    "source": "https://attack.mitre.org/techniques/T1053/"
  },
  {
    "name": "unexpected_startup",
    "condition": "Startup 폴더에 평소 목록에 없는 실행 파일이 새로 추가됨. 수준 10 이상.",
    "evidence": "MITRE T1547.001: 시작 폴더에 프로그램을 추가하면 로그인 시 실행될 수 있음.",
    "source": "https://attack.mitre.org/techniques/T1547/001/"
  },
  {
    "name": "unconfirmed_persistence",
    "condition": "예약·시작 항목 변경이나 임시 실행 파일 발견만 있고 악성 지속 실행의 결합 근거는 부족하면 알림. 수준 5 이상인 서비스 설명 변경·재시작도 확인 알림만 남김.",
    "evidence": "T1543·T1053·T1547.001에 해당하는 구성 변경도 관리 작업일 수 있어 단일 신호는 자동 차단 근거로 삼지 않음.",
    "source": "https://attack.mitre.org/techniques/T1053/"
  }
];

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.slice(0, 16384) : '';
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
  const d = alert.data, s = text(alert.rule.description), path = text(d.path);
  const rawLevel = number(alert.rule.level);
  const level = rawLevel <= 16 ? rawLevel : 0;
  const temporary = /[/\\]temp[/\\]|[/\\]tmp[/\\]/iu.test(path);
  const unsigned = /서명(?:이|은)?\s*없|서명\s*없는|unsigned/iu.test(s);
  const service = /서비스|service/iu.test(s);
  const task = /예약\s*작업|scheduled\s*task/iu.test(s);
  const startup = /시작\s*(?:폴더|프로그램|항목)|startup/iu.test(s);
  const added = /등록|추가|바뀌|변경|created|modified/iu.test(s);
  const unknown = /새\s*서비스|처음\s*보는|평소\s*목록에\s*없는|unknown|new\s+service/iu.test(s);
  const oddTask = /수업\s*시간\s*밖|임의\s*문자열|시작\s*프로그램/iu.test(s);
  if (/읽기만|조회만|read.only|list.only/iu.test(s)) return answer(0.05, 'no_supported_pattern');
  const deniedChange = /(?:등록|추가|변경|생성)(?:은|이|는)?\s*(?:없|안\s*됐|되지\s*않)|not\s+(?:created|registered|modified)/iu.test(s);
  const high = !deniedChange && validIp(d.srcip) && text(d.srcuser).trim().length > 0 && level >= PATTERNS[0].minLevel;
  if (high && service && (added || unknown) && !/서비스\s*등록은\s*없/u.test(s) && ((unsigned && (temporary || (number(d.count) >= 3 && /원격/u.test(s))))
      || (unknown && added && temporary && /다시\s*켜도|남도록/u.test(s)))) return answer(0.95, PATTERNS[0].name);
  if (high && task && temporary && oddTask) return answer(0.93, PATTERNS[1].name);
  if (high && startup && added && unknown && /[/\\]startup[/\\]/iu.test(path)) return answer(0.92, PATTERNS[2].name);
  // 서명된 기존 도구·읽기·기존 작업 실행은 구성 생성과 구분합니다.
  if (service && level >= 5 && /설명만.*바뀌|멈췄다가.*다시\s*시작/u.test(s)) return answer(0.55, PATTERNS[3].name);
  if (/기존.*서명된|기존\s*예약\s*작업.*마쳤|그대로/u.test(s)) return answer(0.05, 'no_supported_pattern');
  if ((service || task || startup) && /만들|변경|추가|서명.*(?:모릅|확인되지|모름)|예약\s*작업.*(?:하나|이름)|시작\s*항목/u.test(s)
      || temporary && /\.(?:exe|cmd|ps1|bat)$/iu.test(path)) return answer(0.6, PATTERNS[3].name);
  return answer(0.05, 'no_supported_pattern');
}
