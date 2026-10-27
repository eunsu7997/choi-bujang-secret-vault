// 5단계 가점: 로그인·세션 확인·로그아웃을 서버 함수로 옮겨 화면 코드에서 Supabase 공개 키를 없앱니다.
// 토큰은 HttpOnly 쿠키에만 두고, 화면에는 로그인 여부와 사용자 구분값만 돌려줍니다.
// 별도 서버 함수를 늘리지 않도록 api/notes.js 함수 안에서 /api/auth/* 경로로 호출됩니다(공식 패키징 기준표 유지).
import { createClient } from '@supabase/supabase-js';
import { clearedCookies, readCookies, sameOrigin, sessionCookies, ACCESS_COOKIE, REFRESH_COOKIE } from './session-cookie.mjs';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/u;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 5;

function supabaseOrigin(env, config) {
  try {
    const url = new URL(env.SUPABASE_URL);
    const issuer = new URL(config?.identityProvider?.issuer);
    if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password
        || url.origin !== issuer.origin) return null;
    return url.origin;
  } catch { return null; }
}

const noSession = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

export function authClientsFromEnv(env, config) {
  const origin = supabaseOrigin(env, config);
  const publishable = env.SUPABASE_PUBLISHABLE_KEY;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!origin || typeof publishable !== 'string' || !publishable.startsWith('sb_publishable_')
      || typeof secret !== 'string' || !secret.trim() || secret === publishable) return null;
  return {
    // 공개 키는 서버 안에서만 씁니다. 화면으로 내보내지 않습니다.
    publicAuth: () => createClient(origin, publishable, noSession).auth,
    adminAuth: () => createClient(origin, secret, noSession).auth,
  };
}

// 서버 인스턴스 안의 간단한 실패 횟수 제한입니다. Supabase Auth 자체 제한과 함께 씁니다.
export function createLimiter(now = () => Date.now()) {
  const failures = new Map();
  const key = (ip, email) => `${ip}|${email}`;
  return {
    blocked(ip, email) {
      const entry = failures.get(key(ip, email));
      if (!entry || now() - entry.first > WINDOW_MS) { failures.delete(key(ip, email)); return false; }
      return entry.count >= MAX_FAILURES;
    },
    fail(ip, email) {
      const k = key(ip, email);
      const entry = failures.get(k);
      if (!entry || now() - entry.first > WINDOW_MS) failures.set(k, { first: now(), count: 1 });
      else entry.count += 1;
      if (failures.size > 5000) failures.delete(failures.keys().next().value);
    },
    clear(ip, email) { failures.delete(key(ip, email)); },
  };
}

// /api/auth/<action> 경로(또는 Vercel rewrite의 ?auth=<action>)이면 동작 이름을, 아니면 null을 돌려줍니다.
export function authAction(request) {
  let path = '';
  try { path = new URL(request.url ?? '/', 'https://notes.internal').pathname; } catch { return null; }
  const match = /^\/api\/auth\/([a-z]{1,16})\/?$/u.exec(path);
  if (match) return match[1];
  const query = request.query?.auth;
  // Vercel이 rewrite 뒤 경로를 /api/notes로 넘기는 경우에도 ?auth=<action>으로 구분합니다.
  return ['/api/notes', '/api/notes/'].includes(path) || path.startsWith('/api/auth')
    ? (typeof query === 'string' ? query : null) : null;
}

const clientIp = (request) => String(request.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim().slice(0, 64) || 'unknown';

export function createAuthHandler({ getClients, getVerifier, limiter = createLimiter() }) {
  async function studentFrom(token) {
    let verify = null;
    try { verify = getVerifier(); } catch { verify = null; }
    if (!verify || !token) return null;
    try {
      const principal = await verify(`Bearer ${token}`);
      return principal?.kind === 'student' && typeof principal.userId === 'string' ? principal.userId.toLowerCase() : null;
    } catch { return null; }
  }

  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const action = authAction(request) ?? '';
    const method = request.method;
    const allowed = { login: 'POST', session: 'GET', logout: 'POST' };
    if (!allowed[action]) return response.status(404).json({ error: 'NOT_FOUND' });
    if (method !== allowed[action]) {
      response.setHeader('Allow', allowed[action]);
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    if (method === 'POST' && !sameOrigin(request)) return response.status(403).json({ error: 'CROSS_ORIGIN_REJECTED' });

    let clients = null;
    try { clients = getClients(); } catch { clients = null; }
    if (!clients) return response.status(500).json({ error: 'AUTH_NOT_CONFIGURED' });
    const cookies = readCookies(request);

    if (action === 'login') {
      const body = request.body;
      const type = String(request.headers?.['content-type'] ?? '');
      if (!type.startsWith('application/json') || !body || typeof body !== 'object' || Array.isArray(body)
          || Object.keys(body).some((k) => !['email', 'password'].includes(k))
          || typeof body.email !== 'string' || !EMAIL.test(body.email)
          || typeof body.password !== 'string' || body.password.length < 1 || body.password.length > 128) {
        return response.status(400).json({ error: 'INVALID_LOGIN' });
      }
      const ip = clientIp(request);
      const email = body.email.toLowerCase();
      if (limiter.blocked(ip, email)) return response.status(429).json({ error: 'TOO_MANY_ATTEMPTS' });
      let session = null;
      try {
        const { data, error } = await clients.publicAuth().signInWithPassword({ email: body.email, password: body.password });
        session = error ? null : data?.session ?? null;
      } catch { session = null; }
      const userId = session ? await studentFrom(session.access_token) : null;
      if (!userId) {
        limiter.fail(ip, email);
        // 계정 존재 여부를 알려 주지 않도록 같은 문구를 씁니다.
        return response.status(401).json({ error: 'LOGIN_FAILED' });
      }
      limiter.clear(ip, email);
      response.setHeader('Set-Cookie', sessionCookies(session));
      return response.status(200).json({ signedIn: true, userId });
    }

    if (action === 'session') {
      const current = await studentFrom(cookies[ACCESS_COOKIE]);
      if (current) return response.status(200).json({ signedIn: true, userId: current });
      if (cookies[REFRESH_COOKIE]) {
        let session = null;
        try {
          const { data, error } = await clients.publicAuth().refreshSession({ refresh_token: cookies[REFRESH_COOKIE] });
          session = error ? null : data?.session ?? null;
        } catch { session = null; }
        const userId = session ? await studentFrom(session.access_token) : null;
        if (userId) {
          response.setHeader('Set-Cookie', sessionCookies(session));
          return response.status(200).json({ signedIn: true, userId });
        }
      }
      if (cookies[ACCESS_COOKIE] || cookies[REFRESH_COOKIE]) response.setHeader('Set-Cookie', clearedCookies());
      return response.status(200).json({ signedIn: false });
    }

    // logout: 서버에서 이 세션을 끝내고, 성공 여부와 관계없이 쿠키는 지웁니다.
    let revoked = false;
    let token = cookies[ACCESS_COOKIE];
    if (!(token && await studentFrom(token)) && cookies[REFRESH_COOKIE]) {
      // 접근 토큰이 만료됐으면 갱신 토큰으로 한 번 이어 받아 그 세션을 끝냅니다.
      try {
        const { data, error } = await clients.publicAuth().refreshSession({ refresh_token: cookies[REFRESH_COOKIE] });
        token = error ? null : data?.session?.access_token ?? null;
      } catch { token = null; }
    }
    if (token && await studentFrom(token)) {
      try { revoked = !(await clients.adminAuth().admin.signOut(token, 'local'))?.error; } catch { revoked = false; }
    }
    response.setHeader('Set-Cookie', clearedCookies());
    return response.status(200).json({ signedIn: false, revoked });
  };
}

