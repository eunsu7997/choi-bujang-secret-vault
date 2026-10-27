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

export async function runAttackChecks(config) {
  if (config.step === 1) return firstStepChecks(config, appUrl(config));
  if (config.step === 2) return secondStepChecks(config, appUrl(config));
  if (config.step === 3) return thirdStepChecks(config, appUrl(config));
  throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
}
