// 확인용 읽기 도구입니다. 판단 모듈에서는 이 파일을 불러오지 않습니다.
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = new URL('../fixtures/exfiltration.json', import.meta.url);
const REDACTED = '[REDACTED]';

// 자유 입력 필드는 비밀값의 이름이나 토큰 형태가 보이면 전체를 가립니다.
// URL·본문·헤더·원본 경보는 출력 대상에 넣지 않습니다.
function safeText(value) {
  if (typeof value !== 'string') return null;
  // 전각 문자와 숨은 문자로 비밀값 이름 검사를 우회하지 못하게 합니다.
  const inspected = value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}]/gu, '');
  if (/password|passwd|passphrase|pwd|token|secret|credential|bearer|authorization|cookie|session[ _-]*(?:id|key)|(?:api|private|access)[ _-]*key|비밀번호|비번|비밀|토큰/iu.test(inspected)
      || /\bBearer\s|-----BEGIN|\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.|\b(?:sk|ghp|github_pat)[_-]|\bAKIA[A-Z0-9]{16}\b/iu.test(inspected)
      || /[A-Za-z0-9_+/=-]{32,}/u.test(inspected)
      || /\b[a-z][a-z0-9+.-]*:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bsession\s*[:=]/iu.test(inspected)) return REDACTED;
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, ' ').slice(0, 400);
}

export function summarizeAlert(alert) {
  const timestamp = typeof alert?.timestamp === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(alert.timestamp)
    && Number.isFinite(Date.parse(alert.timestamp)) ? alert.timestamp : null;
  const address = alert?.data?.srcip;
  const level = alert?.rule?.level;
  return {
    timestamp,
    sourceAddress: typeof address === 'string' && !address.includes('%') && isIP(address) ? address : null,
    account: safeText(alert?.data?.srcuser),
    ruleLevel: Number.isInteger(level) && level >= 0 && level <= 16 ? level : null,
    description: safeText(alert?.rule?.description),
  };
}

export async function readAlerts() {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1'
      || fixture.moduleKey !== 'exfiltration' || !Array.isArray(fixture.alerts)) {
    throw new Error('경보 묶음 형식이 아닙니다.');
  }
  return fixture.alerts.map(summarizeAlert);
}

const isMain = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const rows = await readAlerts();
    for (const row of rows) console.log(JSON.stringify(row));
  } catch {
    // 파싱 오류에는 원본 내용이 섞일 수 있으므로 고정 문구만 출력합니다.
    console.error('경보를 읽을 수 없습니다. 파일 위치와 형식을 확인하세요.');
    process.exitCode = 1;
  }
}
