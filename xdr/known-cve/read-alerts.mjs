// 확인 전용 읽기 도구입니다. 판정기나 XDR decide에서는 불러오지 않습니다.
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const FIXTURE = new URL('../fixtures/known-cve.json', import.meta.url);
const REDACTED = '[redacted]';

// 허용한 항목 안에도 비밀값이 섞일 수 있으므로 의심되는 항목 전체를 가립니다.
function safeText(value) {
  if (typeof value !== 'string') return null;
  // 전각 문자·공백·보이지 않는 문자로 나뉜 비밀값 항목명도 검사합니다.
  const inspected = value.normalize('NFKC').replace(/[\p{Cc}\p{Cf}\p{Z}\s]/gu, '');
  if (/(?:password|passwd|passphrase|secret|token|api[_-]?key|authorization|cookie|credential|bearer)/iu.test(inspected)
      || /(?:비밀번호|비번|암호|인증키|접근키|개인키|비밀키|토큰|세션키|쿠키)/u.test(inspected)
      || /(?:pwd|pass|pin|auth|session(?:[_-]?id)?|(?:access|private|client|signing)[_-]?key)["']*[:=]/iu.test(inspected)
      || /-----BEGIN|\b(?:sk|ghp|github_pat)[_-]|\bAKIA[A-Z0-9]{16}\b/u.test(inspected)
      || /[A-Za-z0-9_+\/-]{32,}/u.test(inspected)
      || /[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/u.test(inspected)
      || /:\/\/[^\s/]+@|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u.test(inspected)
      || /[?&][^\s=]+=/u.test(inspected)) return REDACTED;
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').slice(0, 500);
}

export function summarizeAlert(alert) {
  const timestamp = alert?.timestamp;
  const sourceAddress = alert?.data?.srcip;
  const level = alert?.rule?.level;
  return {
    timestamp: typeof timestamp === 'string'
      && /^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/u.test(timestamp)
      && Number.isFinite(Date.parse(timestamp)) ? timestamp : null,
    sourceAddress: typeof sourceAddress === 'string' && isIP(sourceAddress) ? sourceAddress : null,
    account: safeText(alert?.data?.srcuser),
    ruleLevel: Number.isInteger(level) && level >= 0 && level <= 16 ? level : null,
    description: safeText(alert?.rule?.description),
  };
}

export async function readAlerts() {
  const fixture = JSON.parse(await readFile(FIXTURE, 'utf8'));
  if (fixture?.schema !== 'aleph.xdr.fixture.v1' || fixture.moduleKey !== 'known-cve'
      || !Array.isArray(fixture.alerts)) throw new Error('경보 묶음 형식이 아닙니다.');
  return fixture.alerts.map(summarizeAlert);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    for (const row of await readAlerts()) process.stdout.write(`${JSON.stringify(row)}\n`);
  } catch {
    // 파싱 오류에도 원본 경보의 일부가 노출되지 않게 고정 문구만 출력합니다.
    process.stderr.write('경보 읽기 실패: 파일 경로와 경보 묶음 형식을 확인하세요.\n');
    process.exitCode = 1;
  }
}
