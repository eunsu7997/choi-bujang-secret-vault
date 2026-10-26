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

async function secondStepChecks(config, app) {
  return Promise.all([
    observe('public_data_json_removed', '비로그인 /data.json 요청이 404이고 가상 메모가 보이지 않음', async () => {
      const response = await anonymousGet(app, '/data.json');
      const data = response.ok ? await jsonOrNull(response) : null;
      const visible = Array.isArray(data?.notes) && data.notes.length > 0;
      return `HTTP ${response.status}, 가상 메모 ${visible ? '보임' : '보이지 않음'}`;
    }),
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
    observe('deployment_identity_step', '/aleph.json이 현재 단계와 이 저장소 주소를 표시', async () => {
      const response = await anonymousGet(app, '/aleph.json');
      const data = response.ok ? await jsonOrNull(response) : null;
      const step = Number.isInteger(data?.step) ? data.step : '확인 불가';
      const repo = typeof config.repoUrl === 'string' && data?.repoUrl === config.repoUrl.replace(/\/$/u, '');
      return `HTTP ${response.status}, step ${step}, 저장소 주소 ${repo ? '일치' : '불일치'}`;
    }),
  ]);
}

export async function runAttackChecks(config) {
  if (config.step === 1) return firstStepChecks(config, appUrl(config));
  if (config.step === 2) return secondStepChecks(config, appUrl(config));
  throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
}
