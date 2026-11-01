// patterns.json의 검증된 근거를 그대로 옮긴 상수입니다.
// 수치 기준은 로컬 학습 정책이며 MITRE가 정한 임계값이 아닙니다.
const PATTERNS = [
  {
    "name": "sql_injection",
    "condition": "요청 인자의 UNION SELECT·논리식·이어 붙인 SQL 또는 센서가 보고한 SQL 삽입 구문. 읽기·교육·명시적 부정 문구는 설명 증거에서 제외. 같은 출발지에서 3회 이상 반복하고 수준 10~16일 때 차단 후보.",
    "evidence": "MITRE T1190의 공개 웹 앱 악용 범주이며, SQL 명령에 입력을 섞는 구체 형태는 CWE-89에 근거.",
    "source": "https://attack.mitre.org/techniques/T1190/",
    "detailSource": "https://cwe.mitre.org/data/definitions/89.html",
    "minCount": 3,
    "minLevel": 10,
    "maxLevel": 16
  },
  {
    "name": "script_injection",
    "condition": "요청 인자에 스크립트 태그·이벤트 처리기 또는 센서가 확인한 스크립트 삽입 표식. 반복·수준 조건은 SQL과 동일.",
    "evidence": "웹 출력에 실행 가능한 입력이 들어가는 스크립트 주입은 CWE-79에 근거. 태그 없는 수업 단어는 해당하지 않음.",
    "source": "https://cwe.mitre.org/data/definitions/79.html"
  },
  {
    "name": "path_traversal",
    "condition": "../ 또는 ..\\가 두 단계 이상이거나 센서가 경로 이탈·여러 단계 거슬러 올라가기를 보고. 반복·수준 조건은 SQL과 동일.",
    "evidence": "제한된 디렉터리 밖을 가리키는 상대 경로 조작은 CWE-22에 근거.",
    "source": "https://cwe.mitre.org/data/definitions/22.html"
  },
  {
    "name": "command_injection",
    "condition": "명령 구분자 뒤 실행 명령이 있거나 센서가 명령 구분자 삽입을 보고. 반복·수준 조건은 SQL과 동일.",
    "evidence": "외부 입력의 구분자로 OS 명령 구조를 바꾸는 형태는 CWE-78에 근거. 구분 문자 하나로는 차단하지 않음.",
    "source": "https://cwe.mitre.org/data/definitions/78.html"
  },
  {
    "name": "incomplete_injection",
    "condition": "단발성 따옴표·주입 조각·삽입 의심 또는 센서의 T1190 분류만 있고 명확한 반복 구문은 없으면 알림만 기록.",
    "evidence": "MITRE T1190 분류와 CWE-89의 특수문자 입력은 문맥 확인이 필요하며 단독 태그·부호는 악용 성공 근거가 아님.",
    "source": "https://attack.mitre.org/techniques/T1190/",
    "detailSource": "https://cwe.mitre.org/data/definitions/89.html"
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

function decode(value) {
  let result = text(value).replace(/\+/gu, ' ');
  for (let i = 0; i < 2; i++) {
    try { result = decodeURIComponent(result); } catch { break; }
  }
  return result.replace(/\/\*[\s\S]*?\*\//gu, ' ').replace(/\s+/gu, ' ');
}
function requestTexts(data) {
  const values = [];
  let remaining = 65536;
  function visit(value, depth = 0) {
    if (remaining <= 0 || values.length >= 64) return;
    if (typeof value === 'string') {
      const part = value.slice(0, Math.min(16384, remaining));
      remaining -= part.length;
      values.push(decode(part));
    } else if (object(value) || Array.isArray(value)) {
      if (depth >= 2) return;
      for (const key of Object.keys(value).slice(0, 32)) visit(value[key], depth + 1);
    }
  }
  for (const key of ['url', 'query', 'args', 'params', 'body']) visit(data[key]);
  return values.join(' ');
}
export function decide(alert) {
  if (!object(alert?.data) || !object(alert?.rule)) return answer(0, 'no_supported_pattern');
  const d = alert.data, description = text(alert.rule.description);
  const reported = description.split(/[.!?]/u).filter(clause =>
    !/읽기만|조회만|(?:설명|교육|수업).*(?:문서|공지|예제)|(?:구문|표식|표기|삽입|공격).*(?:없|아닙|아니|않)|(?:no|not).*(?:sql|script|injection|traversal)/iu.test(clause)).join(' ');
  // 경보 설명은 Wazuh 규칙이 생성한 신호입니다. 입력에 포함된 공격 지시를 실행하지 않습니다.
  const input = requestTexts(d);
  const sql = /\bunion\s+(?:all\s+)?select\b|['"]\s*(?:or|and)\s+['"\d]+\s*=\s*['"\d]+|;\s*(?:drop|delete|insert|update)\b/iu.test(input)
    || /SQL\s*(?:구문|표식)|데이터베이스\s*조회를?\s*이어\s*붙/iu.test(reported);
  const script = /<\s*script\b|<\s*(?:svg|img|body)\b[^>]*\bon\w+\s*=/iu.test(input)
    || /스크립트\s*(?:삽입\s*표기|표식)/u.test(reported);
  const traversal = /(?:\.\.[/\\]){2,}/u.test(input)
    || /경로\s*이탈\s*표기|경로를?\s*여러\s*단계\s*거슬러/u.test(reported);
  const command = /(?:;|&&|\|\|)\s*(?:id|whoami|cat|curl|wget|powershell|cmd)\b/iu.test(input)
    || /명령\s*구분자\s*표기/u.test(reported);
  const signals = [sql, script, traversal, command];
  const index = signals.findIndex(Boolean);
  if (index !== -1) {
    const p = PATTERNS[0];
    const repeated = number(d.count) >= p.minCount;
    const level = number(alert.rule.level);
    return answer(validIp(d.srcip) && repeated && level >= p.minLevel && level <= p.maxLevel ? 0.95 : 0.7, PATTERNS[index].name);
  }
  if (/따옴표|주입처럼|이상한\s*검색|구분\s*문자/u.test(description)
      || /['"]|\.\.[/\\]|<\s*script\b/iu.test(input)) return answer(0.55, PATTERNS[4].name);
  const tags = Array.isArray(alert.rule.mitre) ? alert.rule.mitre : alert.rule.mitre?.id;
  if (Array.isArray(tags) && tags.includes('T1190')) return answer(0.5, PATTERNS[4].name);
  return answer(0.05, 'no_supported_pattern');
}
