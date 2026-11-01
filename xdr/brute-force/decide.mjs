// patterns.json을 그대로 옮긴 상수. 횟수/수준 기준은 학습용 정책값이며 MITRE가 정한 수치가 아닙니다.
const PATTERNS = [
  {
    name: 'repeated_password_guessing',
    condition: '같은 출발 주소·계정의 인증 실패가 집계되고, 5분 이내 30회 이상 또는 시간 미상인 고수준 상관 경보에서 40회 이상이면 차단 후보. 3회 이상은 알림 후보.',
    evidence: 'MITRE T1110.001: 비밀번호를 반복·순차적으로 추측해 유효한 자격 증명을 찾는 행동.',
    source: 'https://attack.mitre.org/techniques/T1110/001/',
    minFailures: 30, minUndatedFailures: 40, maxWindowSeconds: 300, minLevel: 10, alertFailures: 3,
  },
  {
    name: 'password_spraying',
    condition: '같은 주소가 서로 다른 계정 8개 이상에 같은 비밀번호를 대입했다는 명시적 근거와 수준 10 이상이 함께 있으면 차단 후보. 비밀번호 값은 읽지 않음.',
    evidence: 'MITRE T1110.003: 하나 또는 소수의 비밀번호를 여러 계정에 시도하는 password spraying.',
    source: 'https://attack.mitre.org/techniques/T1110/003/', minAccounts: 8, minLevel: 10,
  },
  {
    name: 'automated_account_guessing',
    condition: '같은 주소가 15개 이상 계정에 일정한 간격으로 인증 실패를 발생시키고 수준이 10 이상이면 자동화된 계정 대입 차단 후보.',
    evidence: 'MITRE T1110: 계정 집합에 반복적·자동화된 비밀번호 추측을 수행하는 행동. 계정 수만으로 같은 비밀번호 사용을 추정하지 않음.',
    source: 'https://attack.mitre.org/techniques/T1110/', minAccounts: 15, minLevel: 10,
  },
];
const number = value => {
  if (typeof value !== 'number' && !(typeof value === 'string' && /^\d{1,7}$/u.test(value))) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 1000000 ? n : null;
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
function validIp(ip) {
  if (typeof ip !== 'string') return false;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(ip)) return ip.split('.').every(v => String(Number(v)) === v && Number(v) <= 255);
  if (!/^[a-f\d:]{2,39}$/iu.test(ip) || ip.includes(':::')) return false;
  const parts = ip.split('::');
  if (parts.length > 2) return false;
  const groups = parts.flatMap(part => part ? part.split(':') : []);
  return groups.every(v => /^[a-f\d]{1,4}$/iu.test(v)) && (parts.length === 2 ? groups.length < 8 : groups.length === 8);
}
function response(confidence, reason) {
  return { action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record', confidence, reason };
}

// 경보 하나의 Wazuh 상관 분석 결과만 사용합니다. ID·주소별 정답표나 이전 호출 상태를 사용하지 않습니다.
export function decide(alert) {
  if (!object(alert) || !object(alert.rule) || !object(alert.data)) return response(0, 'no_supported_pattern');
  const data = alert.data;
  const description = text(alert.rule.description);
  const parsedLevel = number(alert.rule.level);
  const level = parsedLevel !== null && parsedLevel <= 16 ? parsedLevel : 0;
  const count = number(data.count) ?? 0;
  const failure = /실패|failed|failure/iu.test(description)
    && !/실패(?:가|는)?\s*(?:없|0건)|no\s+(?:login\s+)?failures/iu.test(description);
  const samePassword = /같은\s*비밀번호|동일한?\s*비밀번호|same\s+password|password\s+spray/iu.test(description);
  const recovered = /성공했|성공하였|성공으로|로그인\s*성공|successfully\s+(?:logged|authenticated)|successful\s+login/iu.test(description)
    && !/성공(?:은|이|는)?\s*없|no\s+successful/iu.test(description);
  const tags = Array.isArray(alert.rule.mitre) ? alert.rule.mitre : alert.rule.mitre?.id;
  const tagged = Array.isArray(tags) && tags.some(id => typeof id === 'string' && /^T1110(?:\.\d{3})?$/u.test(id));
  const authentication = tagged || /로그인|비밀번호|계정|인증|login|password|authentication|account/iu.test(description);
  if (!authentication || (!failure && !samePassword)) return response(0.05, 'no_supported_pattern');
  const accountList = Array.isArray(data.accounts) ? data.accounts : typeof data.accounts === 'string' ? data.accounts.split(',') : [];
  const listedAccounts = new Set(accountList.filter(v => typeof v === 'string' && v.trim()).map(v => v.trim())).size;
  const accountMatch = description.match(/계정\s*(\d+)\s*개|(\d+)\s*(?:different\s+)?accounts/iu);
  const accounts = Math.max(listedAccounts, Number(accountMatch?.[1] ?? accountMatch?.[2] ?? 0));
  const windowMatch = description.match(/(\d+)\s*(초|분|시간|seconds?|minutes?|hours?)/iu);
  const unit = windowMatch?.[2]?.toLowerCase();
  const windowSeconds = windowMatch ? Number(windowMatch[1]) * (/시간|hour/u.test(unit) ? 3600 : /분|minute/u.test(unit) ? 60 : 1) : null;
  const targetKnown = validIp(data.srcip) && text(data.srcuser).trim().length > 0;
  const [guessing, spraying, automated] = PATTERNS;
  const timely = windowSeconds === null || windowSeconds <= guessing.maxWindowSeconds;
  if (targetKnown && !recovered && timely) {
    if (samePassword && accounts >= spraying.minAccounts && level >= spraying.minLevel) return response(0.95, spraying.name);
    if (failure && accounts >= automated.minAccounts && level >= automated.minLevel
        && /같은\s*간격|일정한\s*간격|regular\s+interval|automated/iu.test(description)) return response(0.9, automated.name);
    const threshold = windowSeconds === null ? guessing.minUndatedFailures : guessing.minFailures;
    if (failure && count >= threshold && level >= guessing.minLevel) return response(count >= 50 ? 0.97 : 0.9, guessing.name);
  }
  // 성공으로 회복된 소량 실패, 부족한 출발지/시간 근거, 소규모 여러 계정 시도는 자동 차단하지 않습니다.
  if ((failure && count >= guessing.alertFailures) || (samePassword && accounts >= 2)) {
    return response(count >= 10 || accounts >= 8 ? 0.75 : 0.6, samePassword ? spraying.name : guessing.name);
  }
  return response(0.1, 'no_supported_pattern');
}
