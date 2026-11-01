import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const secret = /(?:password|passwd|pwd|비밀번호|token|토큰|secret|api[_-]?key|authorization)\s*[:=]\s*\S+|Bearer\s+\S+|\beyJ[\w-]+\.[\w-]+\.[\w-]+|\b(?:sk-|sb_secret_)[\w-]+|-----BEGIN|[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu;
const safeText = value => typeof value !== 'string' ? null : secret.test(value) ? '[민감값 가림]' : value.replace(/[\r\n\t\u0000-\u001f]/gu, ' ').slice(0, 500);
export function projectAlert(alert) {
  const timestamp = typeof alert?.timestamp === 'string' && Number.isFinite(Date.parse(alert.timestamp)) ? new Date(alert.timestamp).toISOString() : null;
  const ip = alert?.data?.srcip;
  const account = safeText(alert?.data?.srcuser);
  return {
    timestamp,
    sourceIp: typeof ip === 'string' && isIP(ip) ? ip : null,
    account: account && /^[A-Za-z0-9_.-]{1,64}$/u.test(account) && !/[A-Za-z0-9_-]{24,}/u.test(account) ? account : account === null ? null : '[민감값 가림]',
    level: Number.isInteger(alert?.rule?.level) && alert.rule.level >= 0 && alert.rule.level <= 16 ? alert.rule.level : null,
    description: safeText(alert?.rule?.description),
  };
}
export async function readAlerts(path = new URL('../fixtures/brute-force.json', import.meta.url)) {
  const input = JSON.parse(await readFile(path, 'utf8'));
  if (input?.schema !== 'aleph.xdr.fixture.v1' || input.moduleKey !== 'brute-force' || !Array.isArray(input.alerts)) throw new Error('무차별 로그인 시험 경보 형식이 아닙니다.');
  return input.alerts.map(projectAlert);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { for (const row of await readAlerts()) process.stdout.write(`${JSON.stringify(row)}\n`); }
  catch { process.stderr.write('경보 읽기 실패: 입력 형식을 확인하세요.\n'); process.exitCode = 1; }
}
