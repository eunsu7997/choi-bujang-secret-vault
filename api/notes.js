// 3단계: 로그인 토큰을 서버가 직접 검증한 뒤, 자기 소유 메모만 다룹니다.
// 실제 DB 쓰기는 supabase/notes-ownership.sql 적용과 실제 DB 검증 뒤에 켭니다.
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { createLoginVerifier } from '../src/verify-login.mjs';
import { createFields, putFields, publicNote, noteRoute } from '../src/notes-contract.mjs';
import { ACCESS_COOKIE, readCookies, sameOrigin } from '../src/session-cookie.mjs';
import { authAction, authClientsFromEnv, createAuthHandler } from '../src/auth-handler.mjs';
import { NOTICES, instructorIdsFromEnv, isInstructor, resourceId, zoneRoute } from '../src/zones.mjs';
import { supabaseRestorer } from '../src/restore.mjs';
import { RULE_IDS } from '../src/decider.mjs';
import { runLocalProbes } from '../src/ops-local.mjs';
import { deviceAction, deviceCode, deviceCookie, deviceHash, newDeviceSecret, readDeviceSecret, supabaseDeviceStore } from '../src/device-approval.mjs';

const appConfig = createRequire(import.meta.url)('../aleph.config.json');
const policyManifest = createRequire(import.meta.url)('../backup/policy/manifest.json');
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

// 8단계 제작 3: 구역 거부는 짧은 이유 코드와 자원 ID만 남깁니다(토큰·사용자 번호·본문 제외).
function zoneDenied(response, status, reason, resource) {
  console.warn('zone_denied', reason, resource);
  return response.status(status).json({ error: reason });
}

// 11단계: 기기 승인 상태 확인·요청. 승인 자체는 계정 주인이 서버(DB)에서만 합니다.
async function handleDevice(action, method, owner, request, getDeviceStore, response) {
  if (action === 'invalid') return response.status(404).json({ error: 'NOT_FOUND' });
  const wantMethod = action === 'status' ? 'GET' : 'POST';
  if (method !== wantMethod) {
    response.setHeader('Allow', wantMethod);
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let store = null;
  try { store = getDeviceStore(); } catch { store = null; }
  if (!store) return response.status(503).json({ error: 'DEVICE_APPROVAL_UNAVAILABLE' });
  let secret = readDeviceSecret(request);
  try {
    if (action === 'status') {
      if (!secret) return response.status(200).json({ state: 'none', approved: false });
      const hash = deviceHash(secret);
      const state = (await store.get(owner, hash)) ?? 'none';
      return response.status(200).json({ state, approved: state === 'approved', code: deviceCode(hash) });
    }
    if (!secret) {
      secret = newDeviceSecret();
      response.setHeader('Set-Cookie', deviceCookie(secret));
    }
    const hash = deviceHash(secret);
    const state = (await store.request(owner, hash)) ?? 'pending';
    return response.status(200).json({ state, approved: state === 'approved', code: deviceCode(hash) });
  } catch (error) {
    console.error('device_check_failed', typeof error?.code === 'string' ? error.code : 'unknown');
    return response.status(503).json({ error: 'DEVICE_APPROVAL_UNAVAILABLE' });
  }
}

// 12단계: 탈환 작전실 요약. 판정기·탐지기는 지금 서버에서 학생 코드를 실행한 결과, 회수·복구는 DB의 개수·상태만 돌려줍니다.
// 메모 본문·토큰·사용자 번호는 담지 않습니다. 확인하지 못한 값은 null(화면에는 "확인 불가")입니다.
export function opsAction(request) {
  let url;
  try { url = new URL(request.url ?? '/', 'https://notes.internal'); } catch { return null; }
  if (/^\/api\/ops\/summary\/?$/u.test(url.pathname)) return 'summary';
  if (/^\/api\/ops(\/|$)/u.test(url.pathname)) return 'invalid';
  if (['/api/notes', '/api/notes/'].includes(url.pathname) && (url.searchParams.has('ops') || request.query?.ops !== undefined)) {
    const values = [...url.searchParams.getAll('ops'), ...(typeof request.query?.ops === 'string' ? [request.query.ops] : [])];
    return values.length && values.every(value => value === 'summary') ? 'summary' : 'invalid';
  }
  return null;
}

async function handleOps(action, method, owner, getOpsInfo, response) {
  if (action !== 'summary') return response.status(404).json({ error: 'NOT_FOUND' });
  if (method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let info = null;
  try { info = await getOpsInfo(owner); } catch (error) {
    console.error('ops_info_failed', typeof error?.code === 'string' ? error.code : 'unknown');
    info = null;
  }
  const local = await runLocalProbes();
  return response.status(200).json({
    generatedAt: new Date().toISOString(),
    step: appConfig.step,
    commit: typeof process.env.VERCEL_GIT_COMMIT_SHA === 'string' ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 12) : null,
    rules: [...RULE_IDS],
    local,
    detection: local.filter(item => item.id.startsWith('detect_')).map(({ id, label, actual, ok }) => ({ id, label, actual, ok })),
    revocation: { engineLink: '미실행 (반 엔진 회수 연결은 이 저장소에서 시험하지 않음)', devices: info?.devices ?? null },
    restore: { policyVersion: typeof policyManifest?.version === 'string' ? policyManifest.version : null,
      restorePoints: info?.restorePoints ?? null, auditRows: info?.auditRows ?? null, lastAudit: info?.lastAudit ?? null },
  });
}

async function countRows(client, table, build = query => query) {
  const { count, error } = await build(client.from(table).select('*', { count: 'exact', head: true }));
  if (error) throw Object.assign(new Error('ops'), { code: error.code });
  return count ?? 0;
}

export function supabaseOpsInfo(client) {
  return async owner => {
    const safe = async run => { try { return await run(); } catch { return null; } };
    const devices = await safe(async () => {
      const { data, error } = await client.from('device_approvals').select('status').eq('owner_kind', owner.kind).eq('user_id', owner.id);
      if (error) throw error;
      const out = { approved: 0, pending: 0, revoked: 0 };
      for (const row of data ?? []) if (row.status in out) out[row.status] += 1;
      return out;
    });
    const lastAudit = await safe(async () => {
      const { data, error } = await client.from('notes_restore_audit').select('action, at').order('seq', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return data ? { action: String(data.action), at: String(data.at) } : null;
    });
    return {
      devices,
      restorePoints: await safe(() => countRows(client, 'notes_restore_point')),
      auditRows: await safe(() => countRows(client, 'notes_restore_audit')),
      lastAudit,
    };
  };
}

// 브라우저 로그인(쿠키)으로 들어온 자료 요청은 승인된 기기에서만 받습니다. 확인할 수 없으면 거부합니다(실패 시 닫힘).
async function deviceApproved(owner, request, getDeviceStore) {
  const secret = readDeviceSecret(request);
  if (!secret) return false;
  try {
    const store = getDeviceStore();
    return Boolean(store) && (await store.get(owner, deviceHash(secret))) === 'approved';
  } catch (error) {
    console.error('device_check_failed', typeof error?.code === 'string' ? error.code : 'unknown');
    return false;
  }
}

// 10단계 제작 3: POST /api/restore/:id — 비공개 사본에서 메모 한 건만 복원합니다.
// 사본 주인(학생 B)이나 심판만 허용하고, ID·소유자·내용 해시 대조와 감사 기록은 DB 함수가 합니다.
async function handleRestore(route, method, owner, getRestorer, response) {
  if (method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  let restorer = null;
  try { restorer = getRestorer(); } catch { restorer = null; }
  if (!restorer) return response.status(500).json({ error: 'RESTORE_NOT_CONFIGURED' });
  try {
    const result = await restorer.restore(route.id, owner);
    if (result?.status === 'missing') return response.status(404).json({ error: 'RESTORE_POINT_NOT_FOUND' });
    if (result?.status === 'forbidden') return zoneDenied(response, 403, 'RESTORE_FORBIDDEN', resourceId('restore', route.id));
    if (result?.status === 'conflict') return zoneDenied(response, 409, 'RESTORE_OWNER_MISMATCH', resourceId('restore', route.id));
    if (result?.status !== 'restored') return response.status(502).json({ error: 'RESTORE_FAILED' });
    return response.status(200).json({ id: result.id, action: result.action, ownerKind: result.owner_kind,
      ownerMatch: result.owner_match === true, contentSha256: result.content_sha256 });
  } catch (error) {
    console.error('restore_failed', typeof error?.code === 'string' ? error.code : 'unknown');
    return response.status(502).json({ error: 'RESTORE_FAILED' });
  }
}

// 반 공지: 로그인한 학생·심판은 읽기만 합니다. 쓰기는 누구에게나 거부합니다.
// 강사 공지 수정은 /api/admin/notices/:id 관리 경로에서 서버에 저장된 강사 목록으로만 허용합니다.
function handleZone(route, method, owner, instructorIds, response) {
  if (route.zone === 'invalid') return response.status(400).json({ error: 'INVALID_RESOURCE' });
  if (route.zone === 'notices') {
    if (method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return zoneDenied(response, 405, 'NOTICE_READ_ONLY', resourceId('notices', route.id));
    }
    if (route.id === undefined) return response.status(200).json(NOTICES.map(({ id, title, body }) => ({ id, title, body })));
    const notice = NOTICES.find(item => item.id === route.id);
    return notice ? response.status(200).json({ id: notice.id, title: notice.title, body: notice.body })
      : response.status(404).json({ error: 'NOTICE_NOT_FOUND' });
  }
  // admin-notices
  if (!isInstructor(owner, instructorIds)) return zoneDenied(response, 403, 'INSTRUCTOR_ONLY', resourceId('admin-notices', route.id));
  if (method !== 'PUT') {
    response.setHeader('Allow', 'PUT');
    return response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  // 공지는 아직 코드에 고정된 가상 공지라 저장소가 연결되지 않았습니다. 강사 확인까지만 하고 변경은 하지 않습니다.
  return response.status(501).json({ error: 'NOTICE_STORE_NOT_CONNECTED' });
}

export function createNotesHandler({ getVerifier, getStore, writesEnabled = false, getInstructorIds = () => new Set(), getRestorer = () => null, getDeviceStore = () => null, getOpsInfo = async () => null }) {
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

    // 11단계: 기기 승인 요청·상태 확인은 자료 요청보다 먼저 처리합니다.
    const device = deviceAction(request);
    if (device) return handleDevice(device, method, owner, request, getDeviceStore, response);
    // 브라우저 로그인(쿠키) 경로는 서버가 이 기기를 승인된 기기로 확인한 뒤에만 자료를 줍니다.
    // Authorization 헤더(심판·자동 점검) 경로의 기기 확인은 반 엔진·판정기(6단계 device_registered)가 맡습니다.
    if (cookieToken && !(await deviceApproved(owner, request, getDeviceStore))) {
      return response.status(403).json({ error: 'DEVICE_NOT_APPROVED' });
    }

    // 12단계: 탈환 작전실 요약(로그인 + 브라우저는 승인된 기기)
    const ops = opsAction(request);
    if (ops) return handleOps(ops, method, owner, getOpsInfo, response);

    // 8단계: 공지·관리 경로는 메모와 다른 구역으로 처리합니다. 화면 메뉴나 본문의 role은 보지 않습니다.
    const zone = zoneRoute(request);
    if (zone?.zone === 'restore') return handleRestore(zone, method, owner, getRestorer, response);
    if (zone) {
      let instructorIds = new Set();
      try { instructorIds = getInstructorIds() ?? new Set(); } catch { instructorIds = new Set(); }
      return handleZone(zone, method, owner, instructorIds, response);
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
  getInstructorIds: () => instructorIdsFromEnv(),
  getRestorer: () => {
    const client = supabaseFromEnv();
    return client && supabaseRestorer(client);
  },
  getDeviceStore: () => {
    const client = supabaseFromEnv();
    return client && supabaseDeviceStore(client);
  },
  getOpsInfo: async owner => {
    const client = supabaseFromEnv();
    return client ? supabaseOpsInfo(client)(owner) : null;
  },
});

// 5단계 가점: 화면 로그인(/api/auth/login·session·logout)도 이 서버 함수가 처리합니다.
const authHandler = createAuthHandler({
  getClients: () => authClientsFromEnv(process.env, appConfig),
  getVerifier: () => verifierFromEnv(),
});

export default function handler(request, response) {
  return authAction(request) !== null ? authHandler(request, response) : notesHandler(request, response);
}
