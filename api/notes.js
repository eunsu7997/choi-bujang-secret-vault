// 3단계: 로그인 토큰을 서버가 직접 검증한 뒤, 자기 소유 메모만 다룹니다.
// 실제 DB 쓰기는 supabase/notes-ownership.sql 적용과 실제 DB 검증 뒤에 켭니다.
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { createFields, putFields, publicNote, noteRoute } from '../src/notes-contract.mjs';
import { ACCESS_COOKIE, readCookies, sameOrigin } from '../src/session-cookie.mjs';
import { authAction, authClientsFromEnv, createAuthHandler } from '../src/auth-handler.mjs';

const appConfig = createRequire(import.meta.url)('../aleph.config.json');
const MAX_NOTES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE';
let cachedClient;
let cachedVerifier;

function serverSettings(env, config) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SECRET_KEY;
  if (typeof url !== 'string' || typeof key !== 'string' || !key.trim() || key !== key.trim()) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
  // 서버가 읽는 DB와 토큰 발급자가 같은 Supabase 프로젝트여야 합니다.
  let issuer;
  try { issuer = new URL(config?.identityProvider?.issuer); } catch { return null; }
  if (issuer.origin !== parsed.origin) return null;
  return { origin: parsed.origin, key };
}

export function supabaseFromEnv(env = process.env, config = appConfig) {
  const settings = serverSettings(env, config);
  if (!settings) return null;
  cachedClient ??= createClient(settings.origin, settings.key, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return cachedClient;
}

export function verifierFromEnv(env = process.env, config = appConfig) {
  if (cachedVerifier) return cachedVerifier;
  const settings = serverSettings(env, config);
  if (!settings) return null;
  try {
    cachedVerifier = createLoginVerifier({ config, supabaseSecretKey: settings.key });
  } catch (error) {
    console.error('login_verifier_config_invalid', error instanceof TypeError ? error.message : 'unknown');
    return null;
  }
  return cachedVerifier;
}

// 모든 조회·수정·삭제는 (owner_kind, owner_id) 두 조건을 함께 겁니다.
// 학생과 심판의 사용자 ID가 같아도 서로의 메모에 닿지 않게 하기 위해서입니다.
export function supabaseNotesStore(client) {
  const notes = () => client.from('notes');
  const mine = (query, owner) => query.eq('owner_kind', owner.kind).eq('owner_id', owner.id);
  const checked = ({ data, error }) => {
    if (error) throw Object.assign(new Error('query'), { code: error.code });
    return data;
  };
  return {
    async list(owner) {
      const data = checked(await mine(notes().select('id, title, content'), owner)
        .order('created_at', { ascending: true }).limit(MAX_NOTES));
      if (!Array.isArray(data)) throw new Error('query');
      return data;
    },
    async get(owner, id) {
      return checked(await mine(notes().select('id, title, content').eq('id', id), owner).maybeSingle());
    },
    async create(owner, { id, title, content }) {
      return checked(await notes().insert({ id, owner_kind: owner.kind, owner_id: owner.id, title, content })
        .select('id, title, content').single());
    },
    async update(owner, id, fields) {
      return checked(await mine(notes().update(fields).eq('id', id), owner)
        .select('id, title, content').maybeSingle());
    },
    async remove(owner, id) {
      return checked(await mine(notes().delete().eq('id', id), owner).select('id').maybeSingle());
    },
  };
}

// 권한 정책: 학생과 심판은 모두 자기 소유 메모만 다룹니다. 그 밖의 주체는 거절합니다.
const OWNER_KINDS = new Set(['student', 'judge']);
function ownerOf(principal) {
  if (!principal || !OWNER_KINDS.has(principal.kind) || typeof principal.userId !== 'string'
      || !UUID.test(principal.userId)) return null;
  return Object.freeze({ kind: principal.kind, id: principal.userId.toLowerCase() });
}

// 남의 메모와 없는 메모를 구분할 수 없도록 같은 응답을 씁니다.
const notFound = (response) => response.status(404).json({ error: 'NOTE_NOT_FOUND' });

export function createNotesHandler({ getVerifier, getStore, writesEnabled = false }) {
  if (typeof getVerifier !== 'function' || typeof getStore !== 'function') throw new TypeError('invalid_notes_handler');
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const method = request.method;
    if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
      response.setHeader('Allow', ALLOWED_METHODS);
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    let verify = null;
    try { verify = getVerifier(); } catch { verify = null; }
    if (!verify) return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });

    // Authorization 헤더(심판·자동 점검)가 있으면 그것만 씁니다. 없을 때만 화면 로그인 쿠키를 봅니다.
    const header = request.headers?.authorization;
    const cookieToken = header === undefined ? readCookies(request)[ACCESS_COOKIE] : undefined;
    const authorization = header !== undefined ? header : (cookieToken ? `Bearer ${cookieToken}` : undefined);
    let owner = null;
    try { owner = ownerOf(await verify(authorization)); } catch { owner = null; }
    // 위조·만료·다른 서비스 토큰·무토큰을 구분하지 않고 같은 응답으로 거절합니다.
    if (!owner) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }

    // 쿠키로 인증한 변경 요청은 같은 출처에서 온 것만 받습니다.
    if (cookieToken && method !== 'GET' && !sameOrigin(request)) {
      return response.status(403).json({ error: 'CROSS_ORIGIN_REJECTED' });
    }

    // Explicit modes only: production enables students while judge writes remain gated.
    const mayWrite = writesEnabled === true
      || (writesEnabled === 'students-only' && owner.kind === 'student');
    if (method !== 'GET' && !mayWrite) {
      return response.status(403).json({ error: 'WRITES_DISABLED' });
    }

    const route = noteRoute(request);
    if (route.invalid || (['PUT', 'DELETE'].includes(method) && !route.isItem)) {
      return response.status(400).json({ error: 'INVALID_NOTE_ID' });
    }
    if (method === 'POST' && route.isItem) {
      response.setHeader('Allow', 'GET, PUT, DELETE');
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    const fields = method === 'POST' ? createFields(request.body)
      : method === 'PUT' ? putFields(request.body) : null;
    if (['POST', 'PUT'].includes(method) && !fields) {
      return response.status(400).json({ error: 'INVALID_NOTE' });
    }

    // 저장소는 로그인 확인을 통과한 뒤에만 준비합니다.
    let store = null;
    try { store = getStore(); } catch { store = null; }
    if (!store) return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });

    try {
      if (method === 'GET' && !route.isItem) {
        return response.status(200).json((await store.list(owner)).map(publicNote));
      }
      if (method === 'POST') {
        // 소유자는 요청 본문이 아니라 검증된 토큰에서만 정합니다.
        const created = await store.create(owner, fields);
        return response.status(201).json({ id: created.id });
      }
      const id = route.id;
      if (method === 'GET') {
        const note = await store.get(owner, id);
        return note ? response.status(200).json(publicNote(note)) : notFound(response);
      }
      if (method === 'PUT') {
        const note = await store.update(owner, id, fields);
        return note ? response.status(200).json(publicNote(note)) : notFound(response);
      }
      const removed = await store.remove(owner, id);
      return removed ? response.status(204).end() : notFound(response);
    } catch (error) {
      if (error?.code === '23505') return response.status(409).json({ error: 'NOTE_ID_CONFLICT' });
      // 오류 코드만 남기고 키·주소·토큰·메모 본문은 기록하지 않습니다.
      console.error('notes_query_failed', typeof error?.code === 'string' ? error.code : 'unknown');
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

const notesHandler = createNotesHandler({
  getVerifier: () => verifierFromEnv(),
  getStore: () => {
    const client = supabaseFromEnv();
    return client && supabaseNotesStore(client);
  },
  // 4단계: 학생·심판 모두 자기 소유 메모만 읽고 쓰며, 격리는 (owner_kind, owner_id)로 유지합니다.
  // 심판도 자기 메모를 만들어야 "타인 메모 접근 차단" 시험이 성립하므로 쓰기를 엽니다.
  writesEnabled: true,
});

// 5단계 가점: 화면 로그인(/api/auth/login·session·logout)도 이 서버 함수가 처리합니다.
const authHandler = createAuthHandler({
  getClients: () => authClientsFromEnv(process.env, appConfig),
  getVerifier: () => verifierFromEnv(),
});

export default function handler(request, response) {
  return authAction(request) !== null ? authHandler(request, response) : notesHandler(request, response);
}
