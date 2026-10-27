// 브라우저 로그인 세션을 HttpOnly 쿠키로 다룹니다. 화면 코드는 토큰과 Supabase 공개 키를 직접 다루지 않습니다.
// __Host- 접두어: Secure·Path=/·Domain 없음을 브라우저가 강제합니다.
export const ACCESS_COOKIE = '__Host-vault_at';
export const REFRESH_COOKIE = '__Host-vault_rt';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;
const TOKEN = /^[A-Za-z0-9._~+/=-]{1,4096}$/u;

export function readCookies(request) {
  const header = request.headers?.cookie;
  const out = {};
  if (typeof header !== 'string' || header.length > 16384) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if ((name === ACCESS_COOKIE || name === REFRESH_COOKIE) && TOKEN.test(value) && !(name in out)) out[name] = value;
  }
  return out;
}

const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

export function sessionCookies(session) {
  const ttl = Number.isSafeInteger(session?.expires_in) && session.expires_in > 0 ? Math.min(session.expires_in, 3600) : 3600;
  return [cookie(ACCESS_COOKIE, session.access_token, ttl), cookie(REFRESH_COOKIE, session.refresh_token, REFRESH_MAX_AGE)];
}

export const clearedCookies = () => [cookie(ACCESS_COOKIE, '', 0), cookie(REFRESH_COOKIE, '', 0)];

// 쿠키로 인증한 변경 요청은 같은 출처에서 온 것만 받습니다(SameSite=Strict에 더한 이중 방어).
export function sameOrigin(request) {
  const site = request.headers?.['sec-fetch-site'];
  if (site !== undefined && site !== 'same-origin') return false;
  const origin = request.headers?.origin;
  const host = request.headers?.['x-forwarded-host'] ?? request.headers?.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return site === 'same-origin';
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.host === host.split(',')[0].trim();
  } catch { return false; }
}
