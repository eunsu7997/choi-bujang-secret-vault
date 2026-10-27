// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
// 결과는 학생이 직접 보낸 요청의 관찰 기록이며 심판 판정이 아닙니다.
function appUrl(config) {
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
  return app;
}

const anonymousGet = (app, path) => fetch(new URL(path, app), {
  redirect: 'error', signal: AbortSignal.timeout(10000),
});

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function firstStepChecks(config, app) {
  const response = await anonymousGet(app, '/data.json');
  let visible = false;
  if (response.ok) {
    const data = await jsonOrNull(response);
    // A non-JSON response is a failed check, not a successful deployment.
    visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
      && data.notes.length > 0;
  }
  return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
    observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
}

// 요청 자체가 실패해도 다른 점검은 계속하고, 실패 사실만 기록합니다.
async function observe(attackId, expected, run) {
  let observed;
  try {
    observed = await run();
  } catch (error) {
    observed = `요청 실패 (${error?.name === 'TimeoutError' ? '시간 초과' : '응답 없음 또는 리디렉션'})`;
  }
  return { attackId, expected, observed };
}

const checkDataJson = (app) => observe('public_data_json_removed',
  '비로그인 /data.json 요청이 404이고 가상 메모가 보이지 않음', async () => {
    const response = await anonymousGet(app, '/data.json');
    const data = response.ok ? await jsonOrNull(response) : null;
    const visible = Array.isArray(data?.notes) && data.notes.length > 0;
    return `HTTP ${response.status}, 가상 메모 ${visible ? '보임' : '보이지 않음'}`;
  });

const checkIdentity = (config, app) => observe('deployment_identity_step',
  '/aleph.json이 현재 단계와 이 저장소 주소를 표시', async () => {
    const response = await anonymousGet(app, '/aleph.json');
    const data = response.ok ? await jsonOrNull(response) : null;
    const step = Number.isInteger(data?.step) ? data.step : '확인 불가';
    const repo = typeof config.repoUrl === 'string' && data?.repoUrl === config.repoUrl.replace(/\/$/u, '');
    return `HTTP ${response.status}, step ${step}, 저장소 주소 ${repo ? '일치' : '불일치'}`;
  });

async function secondStepChecks(config, app) {
  return Promise.all([
    checkDataJson(app),
    observe('anonymous_api_notes_read',
      '2단계 알려진 약점: 비로그인 /api/notes 요청에 메모가 응답됨 (3단계에서 차단 예정)', async () => {
        const response = await anonymousGet(app, '/api/notes');
        const data = response.ok ? await jsonOrNull(response) : null;
        const notes = Array.isArray(data?.notes) ? data.notes : null;
        const ownerExposed = notes?.some((note) => note && Object.hasOwn(note, 'owner_id')) ?? false;
        const nosniff = response.headers.get('x-content-type-options') === 'nosniff';
        return `HTTP ${response.status}, 메모 ${notes ? `${notes.length}건 응답` : '응답 없음'}, `
          + `owner_id ${ownerExposed ? '포함' : '미포함'}, nosniff ${nosniff ? '있음' : '없음'}`;
      }),
    checkIdentity(config, app),
  ]);
}

function notesRoute(config) {
  const route = Array.isArray(config.allowedRoutes) ? config.allowedRoutes[0] : null;
  if (typeof route !== 'string' || !/^\/api\/[a-z0-9-]+$/u.test(route)) {
    throw new Error('aleph.config.json의 allowedRoutes에 자료 API 경로를 넣어 주세요.');
  }
  return route;
}

// 매번 임시 키로 만든 위조 토큰입니다. 실제 비밀값이 아니며 결과에 기록하지 않습니다.
async function forgedToken(issuer, audience) {
  const { SignJWT, generateKeyPair } = await import('jose');
  const { privateKey } = await generateKeyPair('ES256');
  return new SignJWT({ role: 'authenticated' }).setProtectedHeader({ alg: 'ES256', kid: 'attack-check-forged' })
    .setIssuer(issuer).setAudience(audience).setSubject(crypto.randomUUID())
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
}

const statusOnly = async (request) => `HTTP ${(await request).status}`;

async function thirdStepChecks(config, app) {
  const route = notesRoute(config);
  const { issuer, audience } = config.identityProvider ?? {};
  if (typeof issuer !== 'string' || typeof audience !== 'string') {
    throw new Error('aleph.config.json의 identityProvider를 먼저 채워 주세요.');
  }
  const send = (init) => fetch(new URL(route, app), { redirect: 'error', signal: AbortSignal.timeout(10000), ...init });
  return [
    await checkDataJson(app),
    await observe('anonymous_api_notes_blocked', `비로그인 GET ${route} 요청이 401로 거절됨`, async () => {
      const response = await send({});
      const headers = ['x-content-type-options', 'x-frame-options']
        .map((name) => `${name} ${response.headers.get(name) ? '있음' : '없음'}`).join(', ');
      return `HTTP ${response.status}, ${headers}`;
    }),
    await observe('forged_token_rejected', `임시 키로 서명한 위조 토큰의 GET ${route} 요청이 401로 거절됨`, async () =>
      statusOnly(send({ headers: { authorization: `Bearer ${await forgedToken(issuer, audience)}` } }))),
    await observe('other_issuer_token_rejected', `다른 발급자 토큰의 GET ${route} 요청이 401로 거절됨`, async () =>
      statusOnly(send({ headers: { authorization: `Bearer ${await forgedToken('https://login.other-service.example/auth/v1', audience)}` } }))),
    await observe('anonymous_write_blocked', `비로그인 POST ${route} 요청이 401로 거절됨`, async () =>
      statusOnly(send({ method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'attack-check', body: '' }) }))),
    // 학생 로그인 토큰은 자동 점검에 넣지 않으므로 실행하지 않은 점검으로 남깁니다.
    { attackId: 'student_login_read', expected: `학생 로그인 토큰의 GET ${route} 요청이 200`,
      observed: '미실행 (로그인 토큰이 필요해 자동 점검하지 않음, 브라우저에서 직접 확인)' },
    { attackId: 'cross_owner_access', expected: `학생 B 토큰으로 학생 A 메모의 GET·PUT·DELETE ${route}/:id 요청이 404`,
      observed: '미실행 (두 계정의 로그인 토큰이 필요해 자동 점검하지 않음)' },
    await checkIdentity(config, app),
  ];
}

// 4단계: 소유권 격리. 로그인 토큰이 필요한 A/B 교차 시험은 자동으로 보내지 않고 미실행으로 남깁니다.
async function fourthStepChecks(config, app) {
  const route = notesRoute(config);
  const { issuer, audience } = config.identityProvider ?? {};
  if (typeof issuer !== 'string' || typeof audience !== 'string') {
    throw new Error('aleph.config.json의 identityProvider를 먼저 채워 주세요.');
  }
  const send = (init) => fetch(new URL(route, app), { redirect: 'error', signal: AbortSignal.timeout(10000), ...init });
  return [
    await checkDataJson(app),
    await observe('anonymous_list_json_error', `비로그인 GET ${route} 요청이 401 또는 403과 JSON 오류 문구로 거절됨`, async () => {
      const response = await send({});
      const type = response.headers.get('content-type') ?? '';
      const data = type.includes('application/json') ? await jsonOrNull(response) : null;
      const message = typeof data?.error === 'string' && data.error.length > 0;
      return `HTTP ${response.status}, JSON ${data ? '응답' : '아님'}, 오류 문구 ${message ? '있음' : '없음'}`;
    }),
    await observe('forged_token_rejected', `임시 키로 서명한 위조 토큰의 GET ${route} 요청이 401로 거절됨`, async () =>
      statusOnly(send({ headers: { authorization: `Bearer ${await forgedToken(issuer, audience)}` } }))),
    await observe('forged_owner_write_blocked', `비로그인 POST ${route} 요청에 owner_id를 넣어도 401로 거절됨`, async () =>
      statusOnly(send({ method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'attack-check', body: '', owner_id: crypto.randomUUID() }) }))),
    await observe('anonymous_item_delete_blocked', `비로그인 DELETE ${route}/:id 요청이 401로 거절됨`, async () =>
      statusOnly(fetch(new URL(`${route}/${crypto.randomUUID()}`, app),
        { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(10000) }))),
    await observe('data_api_anon_key_blocked',
      '공개 anon(publishable) 키로 Supabase Data API notes 직접 조회가 거절되거나 행이 0건', async () => {
        const settings = await jsonOrNull(await anonymousGet(app, '/auth-config.json'));
        let base;
        try { base = new URL(settings?.supabaseUrl); } catch { return '공개 로그인 설정을 읽지 못해 미실행'; }
        if (base.protocol !== 'https:' || typeof settings?.publishableKey !== 'string') return '공개 로그인 설정을 읽지 못해 미실행';
        const response = await fetch(new URL('/rest/v1/notes?select=id&limit=1', base.origin), {
          redirect: 'error', signal: AbortSignal.timeout(10000),
          headers: { apikey: settings.publishableKey, accept: 'application/json' },
        });
        const data = await jsonOrNull(response);
        const rows = Array.isArray(data) ? `${data.length}건` : '배열 아님';
        return `HTTP ${response.status}, 행 ${rows}`;
      }),
    await observe('home_security_headers', '첫 화면 응답에 X-Content-Type-Options nosniff 또는 CSP 헤더가 있음', async () => {
      const response = await anonymousGet(app, '/');
      const nosniff = response.headers.get('x-content-type-options') === 'nosniff';
      const csp = Boolean(response.headers.get('content-security-policy'));
      return `HTTP ${response.status}, nosniff ${nosniff ? '있음' : '없음'}, CSP ${csp ? '있음' : '없음'}`;
    }),
    { attackId: 'owner_read_write', expected: `학생 A·B 각자 자기 메모의 GET·POST·PUT·DELETE ${route} 요청이 허용됨`,
      observed: '미실행 (로그인 토큰이 필요해 자동 점검하지 않음, 두 계정으로 브라우저에서 직접 확인)' },
    { attackId: 'cross_owner_access', expected: `학생 B 토큰으로 학생 A 메모의 GET·PUT·DELETE ${route}/:id 요청이 404`,
      observed: '미실행 (두 계정의 로그인 토큰이 필요해 자동 점검하지 않음)' },
    await checkIdentity(config, app),
  ];
}

// 5단계: 자료 요청을 서버 함수 한곳으로 모읍니다. 공개 키로 원본 자료 API를 직접 부르는 길과 정적 파일 노출을 점검합니다.
function originalApi(config) {
  let url;
  try { url = new URL(config.originalApiUrl); } catch { url = null; }
  if (!url || url.protocol !== 'https:' || url.search || url.hash || url.username || url.password) {
    throw new Error('aleph.config.json의 originalApiUrl에 쿼리 없는 원본 자료 HTTPS 주소를 넣어 주세요.');
  }
  return url;
}

// 공개(publishable) 키만 씁니다. 화면 설정에서 찾지 못하면 학생 로컬 환경변수를 쓰고, 둘 다 없으면 미실행입니다.
async function publicKey(app) {
  try {
    const response = await anonymousGet(app, '/auth-config.json');
    const data = response.ok ? await jsonOrNull(response) : null;
    if (typeof data?.publishableKey === 'string' && data.publishableKey.startsWith('sb_publishable_')) return data.publishableKey;
  } catch { /* 화면 설정이 없으면 아래로 넘어갑니다. */ }
  const local = process.env.SUPABASE_PUBLISHABLE_KEY;
  return typeof local === 'string' && local.startsWith('sb_publishable_') ? local : null;
}

const SECRET_MARKERS = [/\bsb_secret_[A-Za-z0-9_-]{8,}/u, /"role"\s*:\s*"service_role"/u, /SUPABASE_SECRET_KEY\s*[:=]\s*["'][^"']+/u];

async function fifthStepChecks(config, app) {
  const route = notesRoute(config);
  const original = originalApi(config);
  const key = await publicKey(app);
  const direct = (init = {}, query = '?select=id&limit=1') => fetch(new URL(`${original.pathname}${query}`, original.origin), {
    redirect: 'error', signal: AbortSignal.timeout(10000), ...init,
    headers: { apikey: key, accept: 'application/json', ...(init.headers ?? {}) },
  });
  const noKey = '미실행 (공개 키를 화면 설정·로컬 환경변수에서 찾지 못함)';
  return [
    await checkDataJson(app),
    await observe('original_api_anon_read_blocked', '공개 키로 원본 자료 API를 직접 조회하면 거절되거나 메모가 0건', async () => {
      if (!key) return noKey;
      const response = await direct();
      const data = await jsonOrNull(response);
      return `HTTP ${response.status}, 행 ${Array.isArray(data) ? `${data.length}건` : '배열 아님'}`;
    }),
    await observe('original_api_anon_write_blocked', '공개 키로 원본 자료 API를 직접 수정(PATCH)하면 거절됨', async () => {
      if (!key) return noKey;
      const response = await direct({ method: 'PATCH', headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
        body: JSON.stringify({ title: 'attack-check' }) }, `?id=eq.${crypto.randomUUID()}`);
      return `HTTP ${response.status}`;
    }),
    await observe('static_files_secret_scan', '공개 정적 파일·브라우저 묶음에 서버 전용 키와 시드 표식이 없음', async () => {
      const home = await anonymousGet(app, '/');
      const html = home.ok ? await home.text() : '';
      const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)].map((m) => m[1])
        .filter((src) => src.startsWith('/') && !src.startsWith('//'));
      const paths = [...new Set(['/', '/auth-config.json', '/aleph.json', ...scripts])];
      let scanned = 0; let secret = 0; let seed = 0; let publishable = 0;
      for (const path of paths) {
        const response = path === '/' ? null : await anonymousGet(app, path);
        const text = path === '/' ? html : (response.ok ? await response.text() : null);
        if (text === null) continue;
        scanned += 1;
        if (SECRET_MARKERS.some((pattern) => pattern.test(text))) secret += 1;
        // /aleph.json의 sampleMarker는 공식 배포 식별 형식이라 시드 노출로 세지 않습니다.
        if (path !== '/aleph.json' && text.includes(config.sampleMarker)) seed += 1;
        if (/\bsb_publishable_[A-Za-z0-9_-]{8,}/u.test(text)) publishable += 1;
      }
      return `파일 ${scanned}개 검사, 서버 전용 키 ${secret}곳, 시드 표식 ${seed}곳(공식 /aleph.json 제외), 공개 키 ${publishable}곳`;
    }),
    await observe('anonymous_list_json_error', `비로그인 GET ${route} 요청이 401 또는 403과 JSON 오류 문구로 거절됨`, async () => {
      const response = await fetch(new URL(route, app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
      const data = (response.headers.get('content-type') ?? '').includes('application/json') ? await jsonOrNull(response) : null;
      return `HTTP ${response.status}, JSON ${data ? '응답' : '아님'}, 오류 문구 ${typeof data?.error === 'string' ? '있음' : '없음'}`;
    }),
    await observe('home_security_headers', '첫 화면 응답에 X-Content-Type-Options nosniff 또는 CSP 헤더가 있음', async () => {
      const response = await anonymousGet(app, '/');
      return `HTTP ${response.status}, nosniff ${response.headers.get('x-content-type-options') === 'nosniff' ? '있음' : '없음'}, `
        + `CSP ${response.headers.get('content-security-policy') ? '있음' : '없음'}`;
    }),
    { attackId: 'original_api_token_access', expected: '공개 키와 학생 로그인 토큰으로 원본 자료 API 직접 조회·수정이 거절됨',
      observed: '미실행 (로그인 토큰이 필요해 자동 점검하지 않음, DB 권한 확인 SQL로 대조)' },
    { attackId: 'owner_read_write', expected: `학생 A는 서버 함수 ${route}로 자기 메모를 읽고 쓰며, B·비로그인 요청은 거절됨`,
      observed: '미실행 (로그인 토큰이 필요해 자동 점검하지 않음, 두 계정으로 브라우저에서 직접 확인)' },
    await checkIdentity(config, app),
  ];
}

export async function runAttackChecks(config) {
  if (config.step === 1) return firstStepChecks(config, appUrl(config));
  if (config.step === 2) return secondStepChecks(config, appUrl(config));
  if (config.step === 3) return thirdStepChecks(config, appUrl(config));
  if (config.step === 4) return fourthStepChecks(config, appUrl(config));
  if (config.step === 5) return fifthStepChecks(config, appUrl(config));
  throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
}
