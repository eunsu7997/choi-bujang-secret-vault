// 11단계: 기기 승인. 승인 여부는 서버(DB)가 정하고, 화면의 버튼은 승인 "요청"만 합니다.
// 기기 식별값은 서버가 만든 무작위 값을 HttpOnly 쿠키(__Host-vault_device)로만 주고받습니다.
// 화면 코드는 이 값을 읽을 수 없고, localStorage·sessionStorage·IndexedDB에는 기기 키나 토큰을 넣지 않습니다.
// DB에는 원래 값이 아니라 SHA-256 해시만 저장하고, 화면에는 해시 앞 8자리(승인 코드)만 보여 줍니다.
import { createHash, randomBytes } from 'node:crypto';

export const DEVICE_COOKIE = '__Host-vault_device';
const SECRET = /^[A-Za-z0-9_-]{43}$/u;
const YEAR = 60 * 60 * 24 * 365;

export function readDeviceSecret(request) {
  const header = request.headers?.cookie;
  if (typeof header !== 'string' || header.length > 16384) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 1 || part.slice(0, index).trim() !== DEVICE_COOKIE) continue;
    const value = part.slice(index + 1).trim();
    return SECRET.test(value) ? value : null;
  }
  return null;
}

export const newDeviceSecret = () => randomBytes(32).toString('base64url');
export const deviceHash = secret => createHash('sha256').update(secret, 'utf8').digest('hex');
export const deviceCode = hash => `${hash.slice(0, 4)}-${hash.slice(4, 8)}`.toUpperCase();
export const deviceCookie = secret => `${DEVICE_COOKIE}=${secret}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Strict`;

// /api/device/status, /api/device/request (vercel.json rewrite가 붙이는 ?device= 표시도 같은 동작)
export function deviceAction(request) {
  let url;
  try { url = new URL(request.url ?? '/', 'https://notes.internal'); } catch { return null; }
  const match = /^\/api\/device\/([a-z]{1,16})\/?$/u.exec(url.pathname);
  let action = match?.[1];
  if (!action && ['/api/notes', '/api/notes/'].includes(url.pathname)) {
    const values = [...url.searchParams.getAll('device'), ...(typeof request.query?.device === 'string' ? [request.query.device] : [])];
    if (values.length && values.every(value => value === values[0])) action = values[0];
  }
  if (!action) return null;
  return ['status', 'request'].includes(action) ? action : 'invalid';
}

const STATES = new Set(['pending', 'approved', 'revoked']);

export function supabaseDeviceStore(client) {
  const table = () => client.from('device_approvals');
  const checked = ({ data, error }) => {
    if (error) throw Object.assign(new Error('device'), { code: error.code });
    return data;
  };
  return {
    async get(owner, hash) {
      const row = checked(await table().select('status').eq('owner_kind', owner.kind).eq('user_id', owner.id)
        .eq('device_hash', hash).maybeSingle());
      return row && STATES.has(row.status) ? row.status : null;
    },
    // 승인 요청은 대기(pending) 행만 만듭니다. 이미 있으면 그대로 둡니다(승인 상태를 바꾸지 않음).
    async request(owner, hash) {
      const { error } = await table().insert({ owner_kind: owner.kind, user_id: owner.id, device_hash: hash, status: 'pending' });
      if (error && error.code !== '23505') throw Object.assign(new Error('device'), { code: error.code });
      return this.get(owner, hash);
    },
  };
}
