// 3단계: 로그인 토큰을 서버가 직접 검증한 뒤, 자기 소유 메모만 다룹니다.
// 실제 DB 쓰기는 supabase/notes-ownership.sql 적용과 실제 DB 검증 뒤에 켭니다.
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';

const appConfig = createRequire(import.meta.url)('../aleph.config.json');
const MAX_NOTES = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE';
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
    async create(owner, { title, content }) {
      return checked(await notes().insert({ owner_kind: owner.kind, owner_id: owner.id, title, content })
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

// 응답에는 화면에 필요한 값만 내보내고 owner_id·owner_kind는 숨깁니다.
const publicNote = ({ id, title, content }) => ({ id, title, content });

function noteFields(body, { partial }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const fields = {};
  if (body.title !== undefined || !partial) {
    if (typeof body.title !== 'string') return null;
    const title = body.title.trim();
    if (title.length < 1 || title.length > 200) return null;
    fields.title = title;
  }
  if (body.content !== undefined || !partial) {
    const content = body.content ?? '';
    if (typeof content !== 'string' || content.length > 10000) return null;
    fields.content = content;
  }
  if (Object.keys(body).some((key) => !['title', 'content'].includes(key))) return null;
  return Object.keys(fields).length ? fields : null;
}

function noteId(request) {
  const id = request.query?.id;
  return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
}

export function createNotesHandler({ getVerifier, getStore, writesEnabled = false }) {
  if (typeof getVerifier !== 'function' || typeof getStore !== 'function') throw new TypeError('invalid_notes_handler');
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const method = request.method;
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) {
      response.setHeader('Allow', ALLOWED_METHODS);
      return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    }
    let verify = null;
    try { verify = getVerifier(); } catch { verify = null; }
    if (!verify) return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });

    let owner = null;
    try { owner = ownerOf(await verify(request.headers?.authorization)); } catch { owner = null; }
    // 위조·만료·다른 서비스 토큰·무토큰을 구분하지 않고 같은 응답으로 거절합니다.
    if (!owner) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      return response.status(401).json({ error: 'UNAUTHORIZED' });
    }

    // Explicit modes only: production enables students while judge writes remain gated.
    const mayWrite = writesEnabled === true
      || (writesEnabled === 'students-only' && owner.kind === 'student');
    if (method !== 'GET' && !mayWrite) {
      return response.status(403).json({ error: 'WRITES_DISABLED' });
    }

    // 저장소는 로그인 확인을 통과한 뒤에만 준비합니다.
    let store = null;
    try { store = getStore(); } catch { store = null; }
    if (!store) return response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });

    try {
      if (method === 'GET' && request.query?.id === undefined) {
        return response.status(200).json({ notes: (await store.list(owner)).map(publicNote) });
      }
      if (method === 'POST') {
        const fields = noteFields(request.body, { partial: false });
        if (!fields) return response.status(400).json({ error: 'INVALID_NOTE' });
        // 소유자는 요청 본문이 아니라 검증된 토큰에서만 정합니다.
        return response.status(201).json({ note: publicNote(await store.create(owner, fields)) });
      }
      const id = noteId(request);
      if (!id) return response.status(400).json({ error: 'INVALID_NOTE_ID' });
      if (method === 'GET') {
        const note = await store.get(owner, id);
        return note ? response.status(200).json({ note: publicNote(note) }) : notFound(response);
      }
      if (method === 'PATCH') {
        const fields = noteFields(request.body, { partial: true });
        if (!fields) return response.status(400).json({ error: 'INVALID_NOTE' });
        const note = await store.update(owner, id, fields);
        return note ? response.status(200).json({ note: publicNote(note) }) : notFound(response);
      }
      const removed = await store.remove(owner, id);
      return removed ? response.status(204).end() : notFound(response);
    } catch (error) {
      // 오류 코드만 남기고 키·주소·토큰·메모 본문은 기록하지 않습니다.
      console.error('notes_query_failed', typeof error?.code === 'string' ? error.code : 'unknown');
      return response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    }
  };
}

export default createNotesHandler({
  getVerifier: () => verifierFromEnv(),
  getStore: () => {
    const client = supabaseFromEnv();
    return client && supabaseNotesStore(client);
  },
  // Actual student JWT isolation and genuine expiration were verified before this release.
  // Official judge authentication remains unverified; retain its write gate.
  writesEnabled: 'students-only',
});
