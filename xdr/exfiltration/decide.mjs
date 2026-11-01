// patterns.json의 검증된 근거를 그대로 옮긴 상수입니다.
// 수치 기준은 로컬 학습 정책이며 MITRE가 정한 임계값이 아닙니다.
const PATTERNS = [
  {
    "name": "large_unusual_transfer",
    "condition": "실제 전송량 50MB 이상과 신규 목적지·시간 외·이례 포트·전체 외부 복사·압축 연속 전송·반복 5회 중 하나가 겹침. 출발·목적지 확인 및 수준 10 이상.",
    "evidence": "MITRE T1048: 기존 명령 통로와 다른 프로토콜·네트워크 위치를 사용한 자료 반출. 프로토콜 미상인 경보는 비정상 반출 정황으로만 분류.",
    "source": "https://attack.mitre.org/techniques/T1048/",
    "minBytes": 50000000,
    "minCount": 5,
    "minLevel": 10
  },
  {
    "name": "c2_data_transfer",
    "condition": "명령 통로를 통한 큰 파일 전송이며 50MB 이상, 반복 5회 이상, 수준 10 이상이면 차단 후보.",
    "evidence": "MITRE T1041: 기존 명령 제어 통로를 이용해 자료를 전송.",
    "source": "https://attack.mitre.org/techniques/T1041/"
  },
  {
    "name": "unconfirmed_transfer",
    "condition": "소량 신규 목적지·일시적 전송량 증가·압축 준비·실패·전송 차단/취소·명령 통로 소량 자료는 알림. 크기만으로 차단하지 않음.",
    "evidence": "MITRE T1041·T1048의 전송 행위는 목적지·통로·실제 전송 등 문맥 확인이 필요하며 크기만으로 악용을 단정하지 않음.",
    "source": "https://attack.mitre.org/techniques/T1048/"
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
  const d = alert.data, s = text(alert.rule.description), p = PATTERNS[0];
  const bytes = number(d.bytes), count = number(d.count);
  const hasDestination = validIp(d.srcip) && validIp(d.dstip) && d.srcip !== d.dstip;
  const c2 = /명령\s*통로|command.and.control|c2\s*channel/iu.test(s);
  const novelty = /처음\s*보는|처음\s*봅|처음\s*봅니다|평소와\s*다른|처음\s*봅니다/u.test(s);
  const outOfHours = /(?:수업|업무)\s*시간\s*밖/u.test(s);
  const unusual = novelty || outOfHours || /쓰지\s*않던\s*포트|전체가\s*외부|압축.*연속/u.test(s) || count >= p.minCount;
  const failed = /실패|전송은\s*아직\s*없|외부\s*전송.*없|전송[^.\n]{0,40}(?:차단|취소)(?:했|됐|되었|됨|합니다)/u.test(s);
  if (!failed && hasDestination && bytes >= p.minBytes && number(alert.rule.level) >= p.minLevel) {
    if (c2 && count >= p.minCount) return answer(0.96, PATTERNS[1].name);
    if (unusual) return answer(0.94, p.name);
  }
  // 큰 값 하나, 목적지 주소 하나, 규칙 수준 하나만으로 차단하지 않습니다.
  if (novelty || outOfHours || c2 || /전송량.*높|파일\s*수.*늘|압축\s*파일.*(?:만들|연)|자료\s*20건|백업처럼|다른\s*주소/u.test(s)
      || bytes >= p.minBytes) return answer(0.6, PATTERNS[2].name);
  return answer(0.05, 'no_supported_pattern');
}
