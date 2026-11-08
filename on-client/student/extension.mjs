// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
// ---------- 13단계 · 로그인 사용자·기기·세션 표시 (Halo) ----------
// 받는 값: renderIdentity({ me, devices, sessions }) — 셋 다 { status, mode, data?, error? }.
// 화면은 createElement·textContent로만 만들고, 호출될 때마다 새 DOM 하나를 돌려줍니다.
// 제공 UI가 다시 불러오기마다 이 함수를 새 입력으로 다시 부르므로 이전 사용자·기기·세션 DOM은 통째로 교체됩니다.

const DEVICE_LABELS = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
const SESSION_LABELS = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
// 정상으로 보여도 되는 값만 ok로 표시하고, 나머지는 경고·확인 불가로 구분합니다(색만이 아니라 글자로도 구분).
const DEVICE_TONE = { compliant: 'ok', noncompliant: 'warning', unknown: 'unknown' };
const SESSION_TONE = { active: 'ok', expired: 'warning', revoked: 'warning', unknown: 'unknown' };
const MODE_NOTES = { demo: '예제 자료 · 실제 연결 아님', disconnected: '연결 없음', unknown: '확인 불가' };
const RESOURCE_NAMES = { me: '현재 로그인', devices: '내 기기 목록', sessions: '내 세션 목록' };

function node(tag, text, attrs = {}) {
  const element = document.createElement(tag);
  if (text !== undefined && text !== null) element.textContent = String(text);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  return element;
}

// 모르는 상태값은 정상처럼 보이지 않게 확인 불가로 표시하고, 원래 값은 괄호로 함께 남깁니다.
function statusText(labels, value) {
  const known = Object.hasOwn(labels, value);
  return `${known ? labels[value] : '확인 불가'} (${typeof value === 'string' && value ? value : 'unknown'})`;
}
const toneOf = (tones, value) => (Object.hasOwn(tones, value) ? tones[value] : 'unknown');
const text = (value) => (typeof value === 'string' && value.trim() ? value : '확인 불가');

// loading·ok·error 모두에서 전달받은 demo·disconnected·unknown 모드 안내를 함께 붙입니다.
function modeNote(resource) {
  const mode = resource?.mode;
  if (!Object.hasOwn(MODE_NOTES, mode)) return null;
  return node('p', `자료 상태: ${MODE_NOTES[mode]}`, { 'data-mode': mode, class: 'student-mode' });
}

function stateLine(resource, name) {
  if (!resource || resource.status === 'loading') return node('p', `${name}: 불러오는 중`, { role: 'status', 'data-state': 'loading' });
  if (resource.status === 'error') {
    const message = typeof resource.error?.message === 'string' && resource.error.message ? resource.error.message : '서버가 이유를 알려 주지 않았습니다';
    return node('p', `${name} 연결 실패: ${message}`, { role: 'alert', 'data-state': 'error' });
  }
  if (resource.status !== 'ok') return node('p', `${name}: 확인 불가`, { role: 'status', 'data-state': 'unknown' });
  return null;
}

function pair(list, label, value, attrs = {}) {
  list.append(node('dt', label), node('dd', value, attrs));
}

function renderMe(me) {
  const section = node('section', null, { 'data-resource': 'me' });
  section.append(node('h3', RESOURCE_NAMES.me));
  const note = modeNote(me);
  const state = stateLine(me, RESOURCE_NAMES.me);
  // 오류·불러오는 중일 때는 사용자 이름을 그리지 않아 이전 사용자 값이 현재 값처럼 남지 않습니다.
  if (state) { section.append(state); if (note) section.append(note); return section; }
  const data = me.data ?? {};
  const list = node('dl');
  pair(list, '사용자', `${text(data.user?.label)} (${text(data.user?.id)})`, { 'data-field': 'user' });
  pair(list, '현재 기기', `${text(data.device?.label)} (${text(data.device?.id)}) · ${statusText(DEVICE_LABELS, data.device?.status)}`,
    { 'data-field': 'device', 'data-tone': toneOf(DEVICE_TONE, data.device?.status) });
  pair(list, '현재 세션', `${text(data.session?.id)} · ${statusText(SESSION_LABELS, data.session?.status)}`,
    { 'data-field': 'session', 'data-tone': toneOf(SESSION_TONE, data.session?.status) });
  section.append(list);
  if (note) section.append(note);
  return section;
}

function renderList(resource, key, describe) {
  const section = node('section', null, { 'data-resource': key });
  section.append(node('h3', RESOURCE_NAMES[key]));
  const note = modeNote(resource);
  const state = stateLine(resource, RESOURCE_NAMES[key]);
  if (state) { section.append(state); if (note) section.append(note); return section; }
  const items = Array.isArray(resource.data) ? resource.data : [];
  if (!items.length) section.append(node('p', `${RESOURCE_NAMES[key]}: 표시할 항목이 없습니다`, { 'data-state': 'empty' }));
  else {
    const list = node('ul');
    for (const item of items) {
      const { label, tone } = describe(item ?? {});
      list.append(node('li', label, { 'data-tone': tone }));
    }
    section.append(list);
  }
  if (note) section.append(note);
  return section;
}

export function renderIdentity({ me, devices, sessions } = {}) {
  const root = node('div', null, { class: 'student-identity', 'data-agent': 'Halo' });
  root.append(
    renderMe(me),
    renderList(devices, 'devices', (d) => ({ label: `${text(d.label)} (${text(d.id)}) · ${statusText(DEVICE_LABELS, d.status)}`, tone: toneOf(DEVICE_TONE, d.status) })),
    renderList(sessions, 'sessions', (s) => ({ label: `${text(s.id)} · ${statusText(SESSION_LABELS, s.status)}`, tone: toneOf(SESSION_TONE, s.status) })),
  );
  return root;
}

// ---------- 14단계 · 업무 앱 접근 요청 결과 표시 (Halo) ----------
// 받는 값: renderDecision({ status, mode, data?, error?, appId }), data: { appId, decision, reason, checkedAt }.
// status: idle(요청 전)·loading(요청 중)·ok(판정 수신)·error(요청 실패). 판정과 요청 실패를 글자로 구분합니다.
const DECISION_LABELS = {
  allow: { label: '접근 허용', tone: 'ok', note: '정책상 접근 허용이라는 뜻이며, 실제 앱 접속 성공을 보장하지 않습니다.' },
  deny: { label: '접근 거부', tone: 'blocked', note: '서버 정책이 이 앱 접근을 거부했습니다.' },
  challenge: { label: '추가 인증 또는 확인 필요', tone: 'warning', note: '추가 확인이 필요합니다. 이 화면은 추가 인증 절차를 대신 수행하지 않습니다.' },
  unknown: { label: '판정 확인 불가', tone: 'unknown', note: '판정을 확인할 수 없습니다. 접근이 허용되지 않은 것으로 다루세요.' },
};

function decisionOf(value) {
  // 네 가지 공식 값이 아니면 모두 확인 불가로 처리해 허용처럼 보이지 않게 합니다.
  return Object.hasOwn(DECISION_LABELS, value) ? value : 'unknown';
}

export function renderDecision({ status, mode, data, error, appId } = {}) {
  const root = node('section', null, { class: 'student-decision', 'data-agent': 'Halo', 'data-status': String(status ?? 'unknown') });
  root.append(node('h3', '업무 앱 접근 판정'));
  const note = modeNote({ mode });
  const target = typeof appId === 'string' && appId ? appId : null;

  if (status === 'idle' || status === undefined) {
    root.append(node('p', '앱을 골라 접속을 요청하세요. 아직 판정을 요청하지 않았습니다.', { role: 'status', 'data-state': 'idle' }));
  } else if (status === 'loading') {
    root.append(node('p', `판정 확인 중${target ? `: ${target}` : ''}`, { role: 'status', 'data-state': 'loading' }));
  } else if (status === 'error') {
    const message = typeof error?.message === 'string' && error.message ? error.message : '서버가 이유를 알려 주지 않았습니다';
    root.append(
      node('p', `요청 실패: ${message}`, { role: 'alert', 'data-state': 'error' }),
      node('p', '판정을 받지 못한 것이며 접근 거부 판정이 아닙니다. 접근이 허용되지 않은 상태로 다루고 다시 요청하세요.', { 'data-state': 'error' }),
    );
    if (target) root.append(node('p', `요청한 앱: ${target}`));
  } else if (status === 'ok') {
    const result = data && typeof data === 'object' ? data : {};
    // 다른 앱의 응답이 섞이면 그 판정을 이 앱의 결과로 쓰지 않습니다.
    const sameApp = !target || result.appId === target;
    const code = sameApp ? decisionOf(result.decision) : 'unknown';
    const { label, tone, note: meaning } = DECISION_LABELS[code];
    const list = node('dl', null, { 'data-decision': code, 'data-tone': tone });
    pair(list, '앱', text(result.appId ?? target), { 'data-field': 'appId' });
    pair(list, '판정', `${label} (${code})`, { 'data-field': 'decision', 'data-tone': tone });
    if (code === 'unknown' && sameApp && result.decision !== 'unknown') {
      pair(list, '서버 값', text(typeof result.decision === 'string' ? result.decision : ''), { 'data-field': 'raw-decision' });
    }
    if (!sameApp) pair(list, '확인 불가 이유', '요청한 앱과 다른 앱의 응답입니다', { 'data-field': 'mismatch' });
    pair(list, '판정 이유', text(result.reason), { 'data-field': 'reason' });
    pair(list, '판정 시각', text(result.checkedAt), { 'data-field': 'checkedAt' });
    root.append(list, node('p', meaning, { 'data-tone': tone }));
  } else {
    root.append(node('p', '판정 확인 불가 (unknown) · 허용되지 않음', { role: 'status', 'data-state': 'unknown' }));
  }
  if (note) root.append(note);
  return root;
}

export function createStudentView() {
  return {
    renderIdentity,
    renderDecision,
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
