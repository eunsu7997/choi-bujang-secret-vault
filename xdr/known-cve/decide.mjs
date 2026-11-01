const PATTERNS = [
  {
    "name": "log4shell_remote_lookup",
    "condition": {
      "kind": "remote_lookup",
      "fields": [
        "data.useragent",
        "data.headers",
        "data.url",
        "data.query",
        "data.args",
        "data.params"
      ],
      "regex": "\\$\\{jndi:(?:ldap|ldaps|rmi):\\/\\/(?:\\[[0-9a-f:.]+\\]|[a-z0-9][a-z0-9.-]*)(?::[0-9]{1,5})?(?:\\/[^\\s{}]*)?\\}",
      "flags": "i"
    },
    "confidence": 0.97,
    "evidence": "Apache의 CVE-2021-44228 설명과 MITRE T1190에 따라 요청 안의 완전한 외부 JNDI 조회 구문을 악용 형태로 판단한다.",
    "sources": [
      "https://logging.apache.org/security.html#CVE-2021-44228",
      "https://attack.mitre.org/techniques/T1190/"
    ]
  },
  {
    "name": "log4shell_lookup_fragment",
    "condition": {
      "kind": "request_text",
      "fields": [
        "data.useragent",
        "data.headers",
        "data.url",
        "data.query",
        "data.args",
        "data.params"
      ],
      "regex": "\\$\\{\\s*jndi\\s*:|\\bjndi\\s*:\\s*(?:ldap|ldaps|rmi)",
      "flags": "i"
    },
    "confidence": 0.65,
    "evidence": "CVE-2021-44228의 JNDI 조회 관련 조각은 완전한 외부 조회 구문보다 근거가 약하므로 로컬 정책상 알림만 남긴다.",
    "sources": [
      "https://logging.apache.org/security.html#CVE-2021-44228"
    ]
  },
  {
    "name": "vulnerability_scanner_trace",
    "condition": {
      "kind": "request_text",
      "fields": [
        "data.useragent",
        "data.headers",
        "data.url",
        "data.query",
        "data.args",
        "data.params"
      ],
      "regex": "\\b(?:nuclei|log4j-scan)\\b",
      "flags": "i"
    },
    "confidence": 0.6,
    "evidence": "공개 Log4Shell 점검 도구의 이름은 점검 흔적일 수 있으나 승인된 점검과 구분할 수 없어 로컬 정책상 알림만 남긴다.",
    "sources": [
      "https://github.com/projectdiscovery/nuclei-templates/blob/main/http/cves/2021/CVE-2021-44228.yaml",
      "https://github.com/fullhunt/log4j-scan"
    ]
  },
  {
    "name": "log4shell_cve_reference",
    "condition": {
      "kind": "request_text",
      "fields": [
        "data.useragent",
        "data.headers",
        "data.url",
        "data.query",
        "data.args",
        "data.params"
      ],
      "regex": "\\bCVE-2021-44228\\b",
      "flags": "i"
    },
    "confidence": 0.55,
    "evidence": "CVE-2021-44228 이름만으로는 원격 실행 형태가 확인되지 않으므로 로컬 정책상 검토 알림만 남긴다.",
    "sources": [
      "https://nvd.nist.gov/vuln/detail/CVE-2021-44228"
    ]
  },
  {
    "name": "t1190_review",
    "condition": {
      "kind": "mitre_tag",
      "technique": "T1190"
    },
    "confidence": 0.5,
    "evidence": "MITRE T1190은 공개 애플리케이션 악용 기법 분류이며 태그만으로 실제 공격을 확정할 수 없어 로컬 정책상 알림만 남긴다.",
    "sources": [
      "https://attack.mitre.org/techniques/T1190/"
    ]
  }
];

const COMPILED = PATTERNS.map(pattern => ({
  ...pattern,
  matcher: pattern.condition.regex ? new RegExp(pattern.condition.regex, pattern.condition.flags) : null,
}));

function requestTexts(alert) {
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const values = [];
  let remaining = 131072;
  function visit(value, depth = 0) {
    if (remaining <= 0 || values.length >= 64) return;
    if (typeof value === 'string') {
      const part = value.slice(0, Math.min(16384, remaining));
      remaining -= part.length;
      values.push(part);
    } else if (value && typeof value === 'object' && depth < 2) {
      for (const key of Object.keys(value).slice(0, 32)) visit(value[key], depth + 1);
    }
  }
  for (const key of ['useragent', 'headers', 'url', 'query', 'args', 'params']) visit(data[key]);
  // 전송 인코딩만 메모리에서 해석하며 조회·실행·네트워크 요청은 하지 않습니다.
  return values.flatMap(value => {
    const versions = [value];
    for (let i = 0; i < 2; i++) {
      try {
        const decoded = decodeURIComponent(versions.at(-1));
        if (decoded === versions.at(-1)) break;
        versions.push(decoded);
      } catch { break; }
    }
    return versions;
  });
}

function hasTechnique(alert, technique) {
  const mitre = alert?.rule?.mitre;
  if (Array.isArray(mitre)) return mitre.includes(technique);
  return Array.isArray(mitre?.id) && mitre.id.includes(technique);
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: 'no_known_cve_pattern' };
  }
  const texts = requestTexts(alert);
  let best = null;
  for (const pattern of COMPILED) {
    const matches = pattern.condition.kind === 'mitre_tag'
      ? hasTechnique(alert, pattern.condition.technique)
      : texts.some(value => pattern.matcher.test(value));
    if (matches && (!best || pattern.confidence > best.confidence)) best = pattern;
  }
  const confidence = best?.confidence ?? 0;
  return {
    action: confidence >= 0.85 ? 'block' : confidence >= 0.5 ? 'alert' : 'record',
    confidence,
    reason: best?.name ?? 'no_known_cve_pattern',
  };
}
