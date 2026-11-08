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

// ---------- 15단계 · 접속 기록·XDR 경보 목록과 상세 보기 (Halo) ----------
// 받는 값: renderEvents({ status, mode, data?, error? }), data는 본인의 최근 기록 배열(최대 40건)입니다.
// 기록: { id, kind, at, appId, summary, evidence:[{id,text}], rules:[{id,text}], state:{access,session,device}, supportedActions }
// 서버에 다시 묻지 않고 받은 배열 안에서만 정렬·필터합니다. 원본 배열과 서버 자료는 바꾸지 않습니다.
const KIND_LABELS = { access: '접속 기록', xdr: 'XDR 경보' };
const ACCESS_LABELS = { allowed: '허용됨', denied: '거부됨', unknown: '확인 불가' };
const ACCESS_TONE = { allowed: 'ok', denied: 'blocked', unknown: 'unknown' };
const UNVERIFIED_CODES = new Set(['CONTRACT_MISMATCH', 'ENGINE_RESULT_UNVERIFIED']);
const NO_APP = '';

const kindText = (kind) => `${Object.hasOwn(KIND_LABELS, kind) ? KIND_LABELS[kind] : '확인 불가'} (${text(kind)})`;
const appText = (appId) => (typeof appId === 'string' && appId ? appId : '앱 확인 불가 (appId 없음)');
const appKey = (appId) => (typeof appId === 'string' && appId ? appId : NO_APP);
const accessOf = (event) => (typeof event?.state?.access === 'string' ? event.state.access : 'unknown');

// at 원래 값과 한국 시각을 함께 적습니다. 읽을 수 없는 값은 원래 값만 남깁니다.
function timeText(at) {
  const time = typeof at === 'string' ? Date.parse(at) : NaN;
  if (Number.isNaN(time)) return `시각 확인 불가 (${text(at)})`;
  const local = new Date(time).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
  return `${local} KST (${at})`;
}

function newestFirst(events) {
  const stamp = (event) => { const t = Date.parse(event?.at); return Number.isNaN(t) ? -Infinity : t; };
  return [...events].sort((a, b) => stamp(b) - stamp(a));
}

function filterSelect(id, name, entries, onChange) {
  const wrap = node('label', null, { for: id });
  wrap.append(node('span', name));
  const select = node('select', null, { id, name: id, 'aria-label': name });
  for (const [value, label] of entries) {
    const option = node('option', label, { value });
    select.append(option);
  }
  select.value = 'all';
  select.addEventListener('change', onChange);
  wrap.append(select);
  return { wrap, select };
}

function textItems(title, items, field) {
  const box = node('section', null, { 'data-detail-part': field });
  box.append(node('h5', title));
  const list = Array.isArray(items) ? items : [];
  if (!list.length) { box.append(node('p', `${title} 없음`)); return box; }
  const ul = node('ul');
  for (const item of list) ul.append(node('li', `${text(item?.id)}: ${text(item?.text)}`));
  box.append(ul);
  return box;
}

function renderEventDetail(event) {
  const detail = node('section', null, { 'data-student-event-detail': String(event.id), 'aria-label': `${text(event.id)} 상세 내용` });
  detail.append(node('h4', `${text(event.id)} 상세`));
  const facts = node('dl');
  pair(facts, '사건 ID', text(event.id));
  pair(facts, '앱', appText(event.appId));
  pair(facts, '종류', kindText(event.kind));
  pair(facts, '시각', timeText(event.at));
  detail.append(facts);
  detail.append(textItems('근거(evidence)', event.evidence, 'evidence'), textItems('규칙(rules)', event.rules, 'rules'));
  // 세 상태는 따로 적고, 모르는 값은 확인 불가로 둡니다. 지난 세션·기기의 unknown을 정상으로 바꾸지 않습니다.
  const states = node('dl', null, { 'data-detail-part': 'state' });
  const access = accessOf(event);
  pair(states, '접속 상태(state.access)', statusText(ACCESS_LABELS, access), { 'data-tone': toneOf(ACCESS_TONE, access) });
  pair(states, '세션 상태(state.session)', statusText(SESSION_LABELS, event.state?.session), { 'data-tone': toneOf(SESSION_TONE, event.state?.session) });
  pair(states, '기기 상태(state.device)', statusText(DEVICE_LABELS, event.state?.device), { 'data-tone': toneOf(DEVICE_TONE, event.state?.device) });
  detail.append(states);
  // 16단계: 실행이 연결되지 않은 조치가 넘어온 경우에만 '<action> 미지원' 비활성 버튼을 둡니다.
  // supportedActions가 비어 있으면 버튼을 만들지 않고, 어떤 경우에도 조치 요청을 보내지 않습니다.
  const actions = Array.isArray(event.supportedActions) ? event.supportedActions.filter((a) => typeof a === 'string' && a) : [];
  if (!actions.length) { detail.append(node('p', '연결된 조치 없음')); return detail; }
  const box = node('div', null, { 'data-detail-part': 'unsupported-actions' });
  for (const action of actions) {
    const button = node('button', `${action} 미지원`, { type: 'button', disabled: '', 'aria-disabled': 'true', 'aria-label': `${action} 미지원` });
    button.disabled = true;
    box.append(button);
  }
  box.append(node('p', '아직 지원하지 않는 조치입니다. 조치 실행 연결은 준비 중이며, 이 버튼은 요청을 보내지 않습니다.', { 'data-state': 'unsupported' }));
  detail.append(box);
  return detail;
}

export function renderEvents({ status, mode, data, error } = {}) {
  // 호출될 때마다 새 DOM을 만듭니다. 다시 불러오면 이전 목록·필터·상세 선택이 모두 사라집니다.
  const root = node('section', null, { class: 'student-events', 'data-agent': 'Halo', 'data-status': String(status ?? 'unknown') });
  root.append(node('h3', '내 접속 기록·XDR 경보'));
  root.append(node('p', '범위: 본인의 최근 기록(최대 40건)과 서버에 이미 저장된 XDR 경보입니다. 전체 직원 이력이나 실시간 탐지가 아닙니다.'));
  const note = modeNote({ mode });
  const finish = () => { if (note) root.append(note); return root; };

  if (status === 'loading' || status === undefined) { root.append(node('p', '기록을 불러오는 중', { role: 'status', 'data-state': 'loading' })); return finish(); }
  if (status === 'error') {
    if (UNVERIFIED_CODES.has(error?.code)) {
      root.append(node('p', `확인 불가: 서버 응답을 확인할 수 없어 목록을 표시하지 않습니다 (${error.code})`, { role: 'alert', 'data-state': 'unverified' }));
    } else {
      const message = typeof error?.message === 'string' && error.message ? error.message : '서버가 이유를 알려 주지 않았습니다';
      root.append(node('p', `기록을 불러오지 못했습니다: ${message}`, { role: 'alert', 'data-state': 'error' }));
    }
    return finish();
  }
  if (status !== 'ok' || !Array.isArray(data)) {
    root.append(node('p', '확인 불가: 기록 형식을 확인할 수 없습니다 (unknown)', { role: 'status', 'data-state': 'unknown' }));
    return finish();
  }
  if (!data.length) { root.append(node('p', '표시할 기록이 없습니다', { role: 'status', 'data-state': 'empty' })); return finish(); }

  const events = newestFirst(data.filter((event) => event && typeof event === 'object'));
  const unique = (values) => [...new Set(values)];
  const kinds = unique(events.map((event) => text(event.kind)));
  const apps = unique(events.map((event) => appKey(event.appId)));
  const accesses = unique(events.map(accessOf));
  let selectedId = null;
  const buttons = new Map();

  const redraw = () => draw();
  const kindFilter = filterSelect('student-filter-kind', '기록 종류', [['all', '전체'], ...kinds.map((k) => [k, kindText(k)])], redraw);
  const appFilter = filterSelect('student-filter-app', '업무 앱', [['all', '전체'], ...apps.map((a) => [a, appText(a)])], redraw);
  const accessFilter = filterSelect('student-filter-access', '접속 상태', [['all', '전체'], ...accesses.map((a) => [a, statusText(ACCESS_LABELS, a)])], redraw);
  const filters = node('div', null, { role: 'group', 'aria-label': '기록 필터' });
  filters.append(kindFilter.wrap, appFilter.wrap, accessFilter.wrap);
  const count = node('p', null, { role: 'status', 'data-field': 'count' });
  const list = node('ul', null, { 'data-field': 'events' });
  const detailSlot = node('div', null, { 'data-field': 'detail' });
  root.append(filters, count, list, detailSlot);

  function draw() {
    const shown = events.filter((event) =>
      (kindFilter.select.value === 'all' || text(event.kind) === kindFilter.select.value)
      && (appFilter.select.value === 'all' || appKey(event.appId) === appFilter.select.value)
      && (accessFilter.select.value === 'all' || accessOf(event) === accessFilter.select.value));
    count.textContent = `표시 ${shown.length}건 / 받은 기록 ${events.length}건`;
    list.replaceChildren();
    buttons.clear();
    if (!shown.length) list.append(node('li', '필터 조건에 맞는 기록이 없습니다', { 'data-state': 'filtered-empty' }));
    for (const event of shown) {
      const row = node('li', null, { 'data-student-event-id': String(event.id) });
      row.append(node('p', `${text(event.id)} · ${timeText(event.at)} · ${kindText(event.kind)} · ${appText(event.appId)} · ${text(event.summary)}`));
      const button = node('button', `${text(event.id)} 상세`, { type: 'button', 'aria-label': `${text(event.id)} 상세`, 'aria-expanded': String(selectedId === event.id) });
      button.addEventListener('click', () => {
        selectedId = selectedId === event.id ? null : event.id;
        draw();
        // 목록을 다시 그려도 키보드 사용자가 같은 버튼에서 이어서 조작하도록 초점을 돌려줍니다.
        buttons.get(event.id)?.focus?.();
      });
      buttons.set(event.id, button);
      row.append(button);
      list.append(row);
    }
    // 선택한 기록이 필터로 빠지면 상세도 지웁니다.
    const selected = shown.find((event) => event.id === selectedId);
    if (!selected) selectedId = null;
    detailSlot.replaceChildren(...(selected ? [renderEventDetail(selected)] : []));
  }
  draw();
  return finish();
}

// ---------- 16단계 · 알림·빈 상태·오류·진단 정보 정리 (Halo) ----------
// 받는 값: renderStatus({ devices, sessions, notifications, diagnostics, mode })
// diagnostics는 제공 화면이 조회해 넘겨 준 값만 씁니다. 학생 코드는 /api/diagnostics를 직접 부르지 않고,
// 다시 시도도 자동으로 하지 않습니다(사용자가 위쪽 '다시 불러오기'를 직접 누름).
const RETRY_GUIDE = '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요.';
const DIAG_FIELDS = ['requestId', 'component', 'version', 'checkedAt', 'engine.mode', 'engine.code'];

function failureLine(resource, what) {
  const code = typeof resource.error?.code === 'string' ? resource.error.code : 'UNKNOWN';
  const message = typeof resource.error?.message === 'string' && resource.error.message ? resource.error.message : '서버가 이유를 알려 주지 않았습니다';
  const timeout = /TIMEOUT/u.test(code);
  return node('p', `${timeout ? '시간 초과 · ' : ''}${what}: 불러오지 못했습니다 — ${message} (${code}). ${RETRY_GUIDE}`,
    { role: 'alert', 'data-state': timeout ? 'timeout' : 'error' });
}

function resourceSection(resource, key, title, emptyText, describe, extra) {
  const section = node('section', null, { 'data-resource': key });
  section.append(node('h4', title));
  if (extra) section.append(node('p', extra));
  const note = modeNote(resource);
  if (!resource || resource.status === 'loading') section.append(node('p', `${title}: 불러오는 중`, { role: 'status', 'data-state': 'loading' }));
  else if (resource.status === 'error') section.append(failureLine(resource, title));
  else if (resource.status !== 'ok' || !Array.isArray(resource.data)) section.append(node('p', `${title}: 확인 불가 (unknown)`, { role: 'status', 'data-state': 'unknown' }));
  else if (!resource.data.length) section.append(node('p', emptyText, { role: 'status', 'data-state': 'empty' }));
  else {
    const list = node('ul');
    for (const item of resource.data) {
      const { label, tone } = describe(item ?? {});
      list.append(node('li', label, { 'data-tone': tone }));
    }
    section.append(list);
  }
  if (note) section.append(note);
  return section;
}

// 진단 결과에서 정해진 여섯 값만 꺼냅니다. 다른 필드(AI 설정 등)는 화면과 복사 내용에 넣지 않습니다.
function safeDiagnostics(data) {
  const pick = (value) => (typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 200) : '확인 불가');
  return {
    requestId: pick(data?.requestId),
    component: pick(data?.component),
    version: pick(data?.version),
    checkedAt: pick(data?.checkedAt),
    'engine.mode': pick(data?.engine?.mode),
    'engine.code': pick(data?.engine?.code),
  };
}

function diagnosticsSection(diagnostics) {
  const section = node('section', null, { 'data-resource': 'diagnostics' });
  section.append(node('h4', '도움정보(진단)'));
  const status = node('p', null, { role: 'status', 'data-field': 'copy-status' });
  const copy = node('button', '도움정보 복사', { type: 'button', 'aria-label': '도움정보 복사' });
  let safe = null;
  if (!diagnostics || diagnostics.status === 'idle') {
    section.append(node('p', '도움정보를 아직 불러오지 않았습니다. 위쪽 도움정보의 불러오기 버튼을 직접 누르세요.', { 'data-state': 'idle' }));
  } else if (diagnostics.status === 'loading') {
    section.append(node('p', '도움정보: 불러오는 중', { role: 'status', 'data-state': 'loading' }));
  } else if (diagnostics.status === 'error') {
    section.append(failureLine(diagnostics, '도움정보'));
  } else if (diagnostics.status === 'ok') {
    safe = safeDiagnostics(diagnostics.data);
    const list = node('dl', null, { 'data-field': 'diagnostics' });
    for (const field of DIAG_FIELDS) pair(list, field, safe[field]);
    section.append(list);
  } else {
    section.append(node('p', '도움정보: 확인 불가 (unknown)', { 'data-state': 'unknown' }));
  }
  section.append(node('p', '도움 요청에 쓸 수 있도록 위 진단 값만 복사합니다. 비밀번호·토큰·API 키는 넣지 않으며, 누를 때만 복사합니다.'));
  copy.disabled = !safe;
  if (!safe) copy.setAttribute('aria-disabled', 'true');
  copy.addEventListener('click', async () => {
    if (!safe) return;
    const textToCopy = DIAG_FIELDS.map((field) => `${field}: ${safe[field]}`).join('\n');
    try {
      await navigator.clipboard.writeText(textToCopy);
      status.textContent = '도움정보를 클립보드에 복사했습니다. 붙여 넣기 전에 내용을 확인하세요.';
    } catch {
      status.textContent = '복사하지 못했습니다. 위에 표시된 값을 직접 선택해 복사하세요.';
    }
  });
  section.append(copy, status);
  const note = modeNote(diagnostics);
  if (note) section.append(note);
  return section;
}

export function renderStatus({ devices, sessions, notifications, diagnostics, mode } = {}) {
  const root = node('section', null, { class: 'student-status', 'data-agent': 'Halo' });
  root.append(node('h3', '기기·세션·알림·도움정보'));

  // 알림: 어느 자료(resource)의 알림인지, 안전한 code, message를 항목별로 적습니다.
  const alerts = node('section', null, { 'data-resource': 'notifications' });
  alerts.append(node('h4', '알림'));
  const items = Array.isArray(notifications) ? notifications : [];
  if (!items.length) alerts.append(node('p', '주의할 알림이 없습니다', { role: 'status', 'data-state': 'empty' }));
  else {
    const list = node('ul');
    for (const item of items) {
      const code = typeof item?.code === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(item.code) ? item.code : 'UNKNOWN';
      list.append(node('li', `[${text(item?.resource)}] ${code} · ${text(item?.message)}`, { 'data-resource': String(item?.resource ?? '') }));
    }
    alerts.append(list);
  }

  root.append(
    alerts,
    resourceSection(devices, 'devices', '등록 기기', '등록된 기기가 없습니다',
      (d) => ({ label: `${text(d.label)} (${text(d.id)}) · ${statusText(DEVICE_LABELS, d.status)}`, tone: toneOf(DEVICE_TONE, d.status) }),
      '내 이름으로 등록되고 회수되지 않은 기기(최대 100개)입니다. 지금 쓰는 기기가 맨 앞에 옵니다.'),
    resourceSection(sessions, 'sessions', '현재 세션', '현재 연결 없음',
      (x) => ({ label: `${text(x.id)} · ${statusText(SESSION_LABELS, x.status)}`, tone: toneOf(SESSION_TONE, x.status) }),
      '지금 검증된 연결 하나만 표시합니다. 지난 세션 목록이 아닙니다.'),
    diagnosticsSection(diagnostics),
  );
  const note = modeNote({ mode });
  if (note) root.append(note);
  return root;
}

// ---------- 17단계 · 앱 내부 AI 연결 상태 표시 (Halo) ----------
// 받는 값: renderAiConnection({ status, mode, data?, error?, checkedAt, explanationAccepted:false })
// data: { transportChecked:true, audienceAuthorization:'test'|'verified', modelCount, help }
// 이 칸은 앱 서버를 거친 "연결 점검" 결과만 보여 줍니다. 모델 목록 응답은 사건 설명 실행이 아닙니다.
// 열쇠·토큰·원문 오류는 입력에도 없고 화면에도 쓰지 않습니다. 자동 재점검은 하지 않습니다.
const MANUAL_RECHECK = "다시 점검은 '현재 API 연결 점검' 버튼을 직접 누르세요. 자동으로 다시 점검하지 않습니다.";
const AUDIENCE_LABELS = { test: '시험 연결 점검(test)', verified: '앱 권한 확인 후 점검(verified)' };
// 안전한 error.code로 원인을 나눕니다. 목록에 없는 code는 확인 불가로 안내합니다.
const AI_FAILURE_GROUPS = [
  { kind: 'provisioning', label: '권한 준비 중·확인 불가', guide: '학생 잘못이 아닙니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요.',
    codes: ['ON_AI_PROVISIONING_PENDING', 'ON_AI_AUTHORIZATION_CHANGED', 'AI_REQUEST_UNVERIFIED', 'SUBJECT_SCOPE_UNVERIFIED'] },
  { kind: 'auth', label: '인증 실패', guide: '계정 연결을 다시 확인하고, 계속되면 담당자에게 확인하세요. Workbench 열쇠나 AI 회사 열쇠를 복사해 붙이지 마세요.',
    codes: ['WB_CLCO_AUTH_REQUIRED'] },
  { kind: 'access', label: '접근 제한', guide: '계정 연결을 다시 확인하고, 운영 중지·이용 권한은 담당자에게 확인하세요.', codes: ['WB_CLCO_ACCESS_BLOCKED'] },
  { kind: 'limits', label: '반 사용량·이용 한도', guide: '담당자에게 사용량과 한도를 확인하세요.', codes: ['WB_CLCO_COHORT_BUDGET_EXHAUSTED', 'WB_CLCO_LIMIT_REACHED'] },
  { kind: 'session', label: '이용 시간 아님', guide: 'AI 이용 시간을 확인하세요.', codes: ['WB_CLCO_SESSION_CLOSED'] },
  { kind: 'transient', label: '요청 제한·시간 초과·네트워크', guide: '잠시 뒤 직접 다시 점검하세요.',
    codes: ['WB_CLCO_RATE_LIMITED', 'WB_CLCO_TIMEOUT', 'REQUEST_TIMEOUT', 'ENGINE_TIMEOUT', 'TIMEOUT', 'NETWORK_ERROR', 'SERVICE_UNAVAILABLE'] },
  { kind: 'cancelled', label: '취소됨', guide: '요청을 취소했습니다. 이전 점검 결과는 현재 결과가 아닙니다.', codes: ['WB_CLCO_CANCELLED', 'CANCELLED', 'REQUEST_CANCELLED'] },
  { kind: 'no-model', label: '쓸 수 있는 모델 없음', guide: '담당자에게 모델 허용 설정 확인을 요청하세요.', codes: ['ON_AI_MODEL_LIST_EMPTY', 'MODEL_NOT_CONFIGURED'] },
];
const SAFE_CODE = /^[A-Z0-9_]{1,64}$/u;

function aiFailure(error) {
  const code = typeof error?.code === 'string' && SAFE_CODE.test(error.code) ? error.code : 'AI_REQUEST_UNVERIFIED';
  const group = AI_FAILURE_GROUPS.find((g) => g.codes.includes(code))
    ?? { kind: 'unknown', label: '확인 불가', guide: '원인을 확인할 수 없습니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요.' };
  // 제공 화면이 정해 둔 안전한 안내 문장만 오므로 그대로 쓰되, 길이를 제한합니다.
  const message = typeof error?.message === 'string' && error.message ? error.message.slice(0, 300) : '안내 문구 없음';
  return { code, message, group };
}

export function renderAiConnection({ status, mode, data, error, checkedAt } = {}) {
  // 호출마다 새 DOM 하나를 만들어, 다시 점검·계정 재연결 뒤 이전 결과가 남지 않게 합니다.
  const root = node('section', null, { class: 'student-ai-connection', 'data-agent': 'Halo', 'data-status': String(status ?? 'idle') });
  root.append(node('h3', 'AI 연결 점검'));
  root.append(node('p', '앱 서버를 거쳐 수업용 AI 게이트와의 연결만 점검합니다. 사건 설명은 보안 기록에서 따로 요청합니다.'));
  if (status === 'idle' || status === undefined) {
    root.append(node('p', 'AI 연결 점검 전', { role: 'status', 'data-state': 'idle' }));
  } else if (status === 'loading') {
    root.append(node('p', 'AI 연결 점검 중', { role: 'status', 'data-state': 'loading' }));
  } else if (status === 'ok') {
    const audience = Object.hasOwn(AUDIENCE_LABELS, data?.audienceAuthorization) ? AUDIENCE_LABELS[data.audienceAuthorization] : '점검 종류 확인 불가 (unknown)';
    const list = node('dl', null, { 'data-state': 'ok' });
    pair(list, '결과', data?.transportChecked === true ? '앱 서버를 거친 AI 연결 점검 완료' : '연결 점검 확인 불가 (unknown)');
    pair(list, '점검 종류', audience, { 'data-field': 'audienceAuthorization' });
    pair(list, '응답 모델 수', Number.isInteger(data?.modelCount) ? String(data.modelCount) : '확인 불가', { 'data-field': 'modelCount' });
    pair(list, '점검 시각', text(checkedAt), { 'data-field': 'checkedAt' });
    root.append(list, node('p', '연결만 점검했습니다. 사건 설명은 아직 실행하지 않았습니다.', { 'data-state': 'explanation-not-run' }));
  } else if (status === 'error') {
    const failure = aiFailure(error);
    root.append(
      node('p', `AI 연결 점검 실패 · ${failure.group.label}: ${failure.message} (${failure.code})`, { role: 'alert', 'data-state': 'error', 'data-failure': failure.group.kind }),
      node('p', failure.group.guide, { 'data-failure': failure.group.kind }),
    );
  } else {
    root.append(node('p', 'AI 연결 상태 확인 불가 (unknown)', { role: 'status', 'data-state': 'unknown' }));
  }
  root.append(node('p', MANUAL_RECHECK));
  const note = modeNote({ mode });
  if (note) root.append(note);
  return root;
}

// ---------- 18단계 · 근거에 연결된 AI 보안 이벤트 설명 (Halo) ----------
// 받는 값: renderExplanation({ event, explanation, checkedAt })
// event: 보안 기록에서 고른 기록(15단계와 같은 모양) 또는 null
// explanation: { status, mode, data?, error? }, data: { summary, evidenceIds, proposals:[{action,evidenceIds,reason}], requiresHumanConfirmation:true, executed:false }
// AI 설명은 참고용 해석입니다. 사실 판단은 근거 글과 연동 시스템이 알려 준 상태로 하며, 설명·제안만으로 조치를 실행하지 않습니다.
// 호출마다 새 DOM을 만들어, 다른 기록 선택·다시 불러오기·실패 시 이전 설명과 성공 표식이 남지 않게 합니다.
const STATE_PARTS = [['access', '접속', ACCESS_LABELS], ['session', '세션', SESSION_LABELS], ['device', '기기', DEVICE_LABELS]];

function explanationFailure(root, code, message, reason) {
  root.append(
    node('p', `AI 설명 실패: ${reason ? `${reason} · ` : ''}${message} (${code})`, { role: 'alert', 'data-state': 'error' }),
    node('p', '기록은 그대로입니다. AI 설명 실패는 과제 실패가 아니며, 업무 앱 판정과 보안 기록은 계속 사용할 수 있습니다. 다시 요청은 보안 기록에서 직접 누르세요.'),
  );
  return root;
}

// 근거가 이 기록과 맞는지 검사합니다. 맞지 않으면 설명을 쓰지 않고, 없는 근거를 만들어 맞추지 않습니다.
function bindEvidence(event, data) {
  const evidence = Array.isArray(event.evidence) ? event.evidence : [];
  const byId = new Map(evidence.filter((e) => typeof e?.id === 'string').map((e) => [e.id, e]));
  const cited = Array.isArray(data?.evidenceIds) ? data.evidenceIds : [];
  if (data?.executed !== false) return { error: 'AI가 이미 실행했다고 답한 설명은 쓸 수 없습니다' };
  if (data?.requiresHumanConfirmation !== true) return { error: '사람 확인이 필요하다는 표시가 없는 설명은 쓸 수 없습니다' };
  if (typeof data?.summary !== 'string' || !data.summary.trim()) return { error: 'AI 요약이 비어 있어 설명을 쓸 수 없습니다' };
  if (!cited.length) return { error: '근거 부족: 설명이 인용한 근거가 없습니다' };
  const missing = cited.filter((id) => !byId.has(id));
  if (missing.length) return { error: `근거가 맞지 않음: 이 기록(${event.id})에 없는 근거 ID ${missing.map(String).join(', ')}` };
  if (new Set(cited).size !== cited.length) return { error: '근거가 맞지 않음: 같은 근거 ID가 중복 인용됐습니다' };
  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  for (const proposal of proposals) {
    const refs = Array.isArray(proposal?.evidenceIds) ? proposal.evidenceIds : [];
    if (!refs.length || refs.some((id) => !byId.has(id))) return { error: `근거가 맞지 않음: 제안 ${text(proposal?.action)}의 근거가 이 기록에 없습니다` };
  }
  return { cited: cited.map((id) => byId.get(id)), proposals };
}

export function renderExplanation({ event, explanation, checkedAt } = {}) {
  const status = explanation?.status;
  const plain = () => node('section', null, { class: 'student-explanation', 'data-agent': 'Halo', 'data-status': String(status ?? 'idle') });

  // 1) 오류가 있으면 기록 선택 여부와 관계없이 안전한 code·message와 실패 이유를 먼저 보여 줍니다.
  if (status === 'error') {
    const root = plain();
    root.append(node('h3', 'AI 설명(참고용)'));
    const failure = aiFailure(explanation.error);
    if (event?.id) root.append(node('p', `선택한 기록: ${text(event.id)}`));
    return explanationFailure(root, failure.code, failure.message, failure.group.kind === 'unknown' ? '근거 부족 또는 응답 확인 불가' : failure.group.label);
  }
  // 2) 오류 없이 기록이 없으면 기록을 먼저 고르라고 안내합니다.
  if (!event || typeof event !== 'object' || typeof event.id !== 'string' || !event.id) {
    const root = plain();
    root.append(node('h3', 'AI 설명(참고용)'), node('p', '보안 기록에서 기록을 먼저 고르세요', { role: 'status', 'data-state': 'no-event' }));
    return root;
  }
  if (status === 'loading') {
    const root = plain();
    root.append(node('h3', 'AI 설명(참고용)'), node('p', `설명 요청 중: ${event.id}`, { role: 'status', 'data-state': 'loading' }));
    return root;
  }
  if (status !== 'ok') {
    const root = plain();
    root.append(node('h3', 'AI 설명(참고용)'), node('p', `${event.id}: 아직 AI 설명을 요청하지 않았습니다. 보안 기록에서 직접 요청하세요.`, { 'data-state': 'idle' }));
    return root;
  }

  // 3) 성공 응답이라도 이 기록의 근거와 맞지 않으면 실패로 보여 주고 성공 표식을 붙이지 않습니다.
  const bound = bindEvidence(event, explanation.data);
  if (bound.error) {
    const root = plain();
    root.append(node('h3', 'AI 설명(참고용)'), node('p', `선택한 기록: ${event.id}`));
    const code = typeof explanation.error?.code === 'string' && SAFE_CODE.test(explanation.error.code) ? explanation.error.code : 'EVIDENCE_MISMATCH';
    return explanationFailure(root, code, '이 설명은 쓸 수 없습니다', bound.error);
  }

  const root = node('section', null, { class: 'student-explanation', 'data-agent': 'Halo', 'data-status': 'ok', 'data-student-explanation-event': event.id });
  root.append(node('h3', 'AI 설명(참고용)'));
  const head = node('dl');
  pair(head, '사건 ID', event.id, { 'data-field': 'event-id' });
  pair(head, 'AI 요약', explanation.data.summary, { 'data-field': 'summary' });
  pair(head, '설명 시각', text(checkedAt));
  root.append(head, node('p', 'AI 설명은 해석입니다. 사실 판단은 아래 근거 글과 연동 시스템이 알려 준 상태로 하세요.'));

  const evidence = node('section', null, { 'data-explanation-part': 'evidence' });
  evidence.append(node('h4', '인용한 근거'));
  const evidenceList = node('ul');
  for (const item of bound.cited) evidenceList.append(node('li', `${item.id} — ${text(item.text)}`, { 'data-evidence-id': item.id }));
  evidence.append(evidenceList);

  const rules = node('section', null, { 'data-explanation-part': 'rules' });
  rules.append(node('h4', '규칙'));
  const ruleItems = Array.isArray(event.rules) ? event.rules : [];
  if (!ruleItems.length) rules.append(node('p', '규칙 없음'));
  else {
    const ruleList = node('ul');
    for (const rule of ruleItems) ruleList.append(node('li', `${text(rule?.id)} — ${text(rule?.text)}`));
    rules.append(ruleList);
  }

  // 확인할 수 없는 상태는 접속·세션·기기별로 나눠 적고, 정상·안전으로 바꾸지 않습니다.
  const unknowns = node('section', null, { 'data-explanation-part': 'unknown-states' });
  unknowns.append(node('h4', '확인 불가 상태'));
  const unknownParts = STATE_PARTS.filter(([key, , labels]) => !Object.hasOwn(labels, event.state?.[key]) || event.state[key] === 'unknown');
  if (!unknownParts.length) unknowns.append(node('p', '없음'));
  else {
    const unknownList = node('ul');
    for (const [key, name] of unknownParts) unknownList.append(node('li', `${name}: 확인 불가(unknown)`, { 'data-state-part': key }));
    unknowns.append(unknownList);
  }

  const proposals = node('section', null, { 'data-explanation-part': 'proposals' });
  proposals.append(node('h4', '조치 제안'));
  const supported = Array.isArray(event.supportedActions) ? event.supportedActions : [];
  if (!bound.proposals.length) {
    proposals.append(node('p', supported.length ? 'AI가 제안한 조치가 없습니다.' : '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'));
  } else {
    const proposalList = node('ul');
    for (const proposal of bound.proposals) {
      proposalList.append(node('li', `${text(proposal.action)} — ${text(proposal.reason)} (근거: ${proposal.evidenceIds.join(', ')}) · 사람 확인이 필요하며 실행되지 않았습니다`));
    }
    proposals.append(proposalList);
  }
  root.append(evidence, rules, unknowns, proposals, node('p', '설명·제안만으로 보안 조치가 실행되지 않습니다. 이 칸에는 실행 버튼이 없습니다.'));
  return root;
}

// ---------- 19단계 · 보안 조치 요청 상태와 실제 결과 구분 (Halo) ----------
// 받는 값: renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt?, error? })
// 이 함수는 상태를 보여 주기만 합니다. 조치 버튼·POST 요청·확인 티켓은 만들지 않으며, 조작은 제공 화면 버튼으로 합니다.
// AI 제안 → 사람 확인 → 서버 전달(ACK) → 연동 시스템 결과 재조회를 구분하고, ACK를 효과로 보지 않습니다.
const PROVIDED_BUTTONS = "조작은 제공 화면의 '조치 준비', '대상과 조치를 확인했으며 집행합니다', '연동 시스템 결과만 재조회', '조치 화면 취소' 버튼을 쓰세요. '조치 화면 취소'는 이미 전달된 조치 효과를 되돌리지 않습니다.";
const ACTION_STATES = {
  idle: { text: '아직 미실행(idle)', tone: 'idle', guide: '조치 제안은 실행되지 않았습니다. 지금 기록은 연동 시스템이 지원하는 조치가 없어(supportedActions 빈 배열) 조치 준비 버튼이 나오지 않는 것이 정상입니다.' },
  loading: { text: '조치 준비 또는 결과 조회 중(loading) · 미실행', tone: 'progress', guide: '아직 결과가 없습니다.' },
  prepared: { text: '준비됨·미실행(prepared)', tone: 'progress', guide: '사람이 대상과 조치를 확인하기 전까지 실행되지 않습니다. 확인 기한 안에 제공 화면에서 직접 확인하세요.' },
  executing: { text: '서버에 전달 중(executing)', tone: 'progress', guide: '결과가 아직 확인되지 않았습니다. 완료 아님.' },
  pending: { text: '서버 접수·처리 중(pending)', tone: 'progress', guide: '서버가 받았다는 응답(ACK)일 뿐 효과가 확인된 것이 아닙니다. 완료 아님. 연동 시스템 결과만 재조회해 확인하세요.' },
  succeeded: { text: '효과 확인(succeeded)', tone: 'ok', guide: '연동 시스템이 효과를 관측했습니다.' },
  denied: { text: '거절(denied)', tone: 'blocked', guide: '연동 시스템이 조치를 거절했습니다.' },
  failed: { text: '실패(failed)', tone: 'blocked', guide: '연동 시스템이 조치를 처리하지 못했습니다.' },
  unknown: { text: '결과 불명(unknown)', tone: 'unknown', guide: '성공으로도 효과 없음으로도 판단하지 마세요. 다시 집행하지 말고 연동 시스템 결과만 재조회하세요.' },
  expired: { text: '확인 기한 지남(expired)', tone: 'unknown', guide: '확인 기한이 지나 집행할 수 없습니다. 제공 화면에서 다시 준비하세요.' },
  error: { text: '요청 처리 안 됨(error)', tone: 'blocked', guide: '요청이 처리되지 않았습니다. 상태를 확인한 뒤 제공 화면 버튼을 직접 누르세요.' },
};

export function renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error } = {}) {
  const eventId = typeof event?.id === 'string' && event.id ? event.id : null;
  const requestId = typeof receipt?.requestId === 'string' && receipt.requestId ? receipt.requestId : null;
  let code = Object.hasOwn(ACTION_STATES, status) ? status : 'unknown';
  const reasons = [];
  // 현재 의도(사건·조치)와 다른 영수증은 이 화면의 결과로 쓰지 않습니다.
  const mismatch = receipt && ((receipt.eventId && eventId && receipt.eventId !== eventId) || (receipt.actionId && actionId && receipt.actionId !== actionId));
  if (mismatch) { code = 'unknown'; reasons.push('영수증이 현재 사건·조치와 맞지 않습니다'); }
  // 효과는 succeeded이면서 observation.effectApplied === true일 때만 인정합니다.
  if (code === 'succeeded' && observation?.effectApplied !== true) { code = 'unknown'; reasons.push('연동 시스템 효과 관측(effectApplied: true)이 없습니다'); }
  if (receipt?.superseded === true) { code = 'unknown'; reasons.push('더 새로운 요청으로 대체됐습니다(superseded)'); }

  const attrs = { class: 'student-action', 'data-agent': 'Halo', 'data-status': code };
  if (eventId && !mismatch) attrs['data-student-action-event'] = eventId;
  if (eventId && requestId && !mismatch) attrs['data-student-action-request'] = requestId;
  const root = node('section', null, attrs);
  root.append(node('h3', '보안 조치 상태'));

  const state = ACTION_STATES[code];
  root.append(node('p', state.text, { role: code === 'error' || code === 'unknown' ? 'alert' : 'status', 'data-tone': state.tone, 'data-state': code }));
  if (code !== status && typeof status === 'string') root.append(node('p', `서버 상태 값: ${status} → 결과 불명으로 처리했습니다 (${reasons.join(', ') || '알 수 없는 상태'})`));
  root.append(node('p', state.guide));

  // 받은 범위의 식별값만 글자로 적습니다. 확인 번호 같은 값은 입력에 없으므로 만들거나 저장하지 않습니다.
  const facts = node('dl', null, { 'data-field': 'intent' });
  if (eventId) pair(facts, '사건 ID', eventId);
  const evidenceIds = Array.isArray(event?.evidence) ? event.evidence.map((e) => e?.id).filter((id) => typeof id === 'string') : [];
  if (evidenceIds.length) pair(facts, '근거 ID', evidenceIds.join(', '));
  if (typeof actionId === 'string' && actionId) pair(facts, '조치(actionId)', actionId);
  if (target && typeof target.id === 'string') pair(facts, '실제 대상', `${target.id} (generation ${text(String(target.generation ?? ''))})`);
  if (code === 'prepared' || confirmationExpiresAt) pair(facts, '확인 기한', text(confirmationExpiresAt));
  if (requestId) pair(facts, 'requestId', requestId);
  if (typeof receipt?.receiptId === 'string') pair(facts, 'receiptId', receipt.receiptId);
  if (Number.isSafeInteger(receipt?.version)) pair(facts, 'version', String(receipt.version));
  // 같은 요청을 다시 보내도 서버가 중복 실행하지 않고 앞선 결과를 돌려준 경우를 구분합니다.
  if (typeof receipt?.replayed === 'boolean') pair(facts, '재전달 응답(replayed)', receipt.replayed ? '예 · 앞선 요청의 결과입니다(중복 실행 아님)' : '아니요');
  if (code === 'succeeded') {
    pair(facts, '효과', 'effectApplied: true');
    pair(facts, '관측 시각', text(observation?.observedAt));
  } else if (observation && typeof observation.effectApplied === 'boolean') {
    pair(facts, '관측', `effectApplied: ${observation.effectApplied} · ${text(observation.observedAt)}`);
  }
  if (facts.children.length) root.append(facts);

  if (code === 'error' || code === 'denied' || code === 'failed' || code === 'expired') {
    const safeCode = typeof error?.code === 'string' && SAFE_CODE.test(error.code) ? error.code : null;
    const detail = typeof error?.message === 'string' && error.message ? error.message : (typeof message === 'string' && message ? message : '안내 문구 없음');
    root.append(node('p', `${safeCode ? `${safeCode}: ` : ''}${detail}`, { 'data-state': code }));
  } else if (typeof message === 'string' && message && code !== 'succeeded') {
    root.append(node('p', `제공 화면 안내: ${message}`));
  }
  root.append(node('p', PROVIDED_BUTTONS));
  return root;
}

// ---------- 20단계 · 설치 패키지 버전과 알려진 취약점 조회 결과 (Halo) ----------
// 받는 값: renderVulnerabilities({ status, mode, data?, error? }), status: idle·loading·error·ok
// data: { status, lockfileVersion, lockfileHash, checkedAt, packages:[{ name, version, status, vulnerabilities:[{id,modified}], source, checkedAt }] }
// 서버가 package-lock.json과 설치된 node_modules 메타데이터를 대조해 준 정확한 버전만 표시합니다.
// 조회 실패·미조회는 "취약점 없음"이 아니며, OSV에 알려진 항목이 없다는 것도 안전 보장이 아닙니다.
const SCAN_STATUS = {
  complete: '모두 조회(complete)',
  partial: '일부 조회 실패(partial) · 실패한 패키지는 취약점 없음이 아닙니다',
  not_checked: '아직 조회 안 함(not_checked) · 승인된 공개 조회 대상이 없는 등 미조회 상태입니다',
  not_configured: '조회 준비 미완료(not_configured) · 조회 대상 프로젝트 설정이 필요합니다(운영자 준비)',
  unverifiable: 'lock 파일 확인 불가(unverifiable)',
};
const PACKAGE_STATUS = {
  known_vulnerabilities: { text: '알려진 항목 있음(known_vulnerabilities)', tone: 'warning' },
  none_found: { text: '알려진 항목 없음(none_found) · 조회 범위의 OSV에서 알려진 항목이 없다는 뜻이며 안전 보장이 아닙니다', tone: 'ok' },
  unverifiable: { text: '조회 확인 불가(unverifiable)', tone: 'unknown' },
};
// ^1.2.0·~1.2·>=1 같은 범위는 설치 버전이 아니므로 정확한 버전으로 표시하지 않습니다.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

function packageRow(pkg) {
  const name = typeof pkg?.name === 'string' && pkg.name ? pkg.name : '이름 확인 불가';
  const exact = typeof pkg?.version === 'string' && EXACT_VERSION.test(pkg.version);
  const version = exact ? pkg.version : '정확한 설치 버전 확인 불가';
  const findings = Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities.filter((v) => typeof v?.id === 'string') : [];
  let state = Object.hasOwn(PACKAGE_STATUS, pkg?.status) && exact ? pkg.status : 'unverifiable';
  // none_found인데 항목이 있거나, 있다고 했는데 항목이 없으면 확인 불가로 둡니다(받은 ID는 유지).
  if ((state === 'none_found' && findings.length) || (state === 'known_vulnerabilities' && !findings.length)) state = 'unverifiable';
  const row = node('tr', null, { 'data-student-package-name': name, 'data-student-package-version': exact ? pkg.version : '' });
  const label = state === 'unverifiable' && findings.length ? '일부 확인·전체 조회 확인 불가(unverifiable)' : PACKAGE_STATUS[state].text;
  const list = findings.length
    ? findings.map((v) => `${v.id} (수정 ${text(v.modified)})`).join(', ')
    : (state === 'none_found' ? '알려진 항목 없음' : '조회 결과 없음(취약점 없음 아님)');
  for (const cell of [name, version, label, list, text(pkg?.source), text(pkg?.checkedAt)]) row.append(node('td', cell));
  row.setAttribute('data-tone', PACKAGE_STATUS[state].tone);
  return row;
}

export function renderVulnerabilities({ status, mode, data, error } = {}) {
  // 호출마다 새 DOM을 만들어, 조회 중·오류·다시 조회 시 이전 표가 현재 결과처럼 남지 않게 합니다.
  const root = node('section', null, { class: 'student-vulnerabilities', 'data-agent': 'Halo', 'data-status': String(status ?? 'idle') });
  root.append(node('h3', '설치 패키지와 알려진 취약점(OSV)'));
  const note = modeNote({ mode });
  const finish = () => {
    root.append(node('p', 'OSV는 알려진 취약점 데이터베이스입니다. 조회 결과가 없다는 사실만으로 패키지나 앱 전체가 안전하다고 보장할 수 없습니다.'));
    if (note) root.append(note);
    return root;
  };
  if (status === 'idle' || status === undefined) { root.append(node('p', '조회 전 · 보호 현황의 설치 패키지 조회를 직접 누르세요.', { role: 'status', 'data-state': 'idle' })); return finish(); }
  if (status === 'loading') { root.append(node('p', '조회 중 · 아직 결과가 없습니다.', { role: 'status', 'data-state': 'loading' })); return finish(); }
  if (status === 'error') {
    const code = typeof error?.code === 'string' && SAFE_CODE.test(error.code) ? ` (${error.code})` : '';
    const message = typeof error?.message === 'string' && error.message ? error.message : '서버가 이유를 알려 주지 않았습니다';
    root.append(
      node('p', `조회 실패: ${message}${code}`, { role: 'alert', 'data-state': 'error' }),
      node('p', '조회 실패는 취약점 없음이 아닙니다. 다시 조회는 설치 패키지 조회 버튼을 직접 누르세요.'),
    );
    return finish();
  }
  if (status !== 'ok' || !data || typeof data !== 'object') { root.append(node('p', '조회 결과 확인 불가 (unknown)', { 'data-state': 'unknown' })); return finish(); }

  const overall = Object.hasOwn(SCAN_STATUS, data.status) ? SCAN_STATUS[data.status] : `확인 불가(${text(typeof data.status === 'string' ? data.status : '')})`;
  const summary = node('dl', null, { 'data-field': 'scan' });
  pair(summary, '전체 조회 상태', overall, { 'data-scan-status': String(data.status ?? 'unknown') });
  pair(summary, '근거', 'package-lock.json과 설치된 node_modules 메타데이터를 대조한 정확한 버전');
  if (data.lockfileVersion !== undefined && data.lockfileVersion !== null) pair(summary, 'lockfileVersion', String(data.lockfileVersion));
  if (typeof data.lockfileHash === 'string' && data.lockfileHash) pair(summary, 'lockfileHash', data.lockfileHash);
  if (typeof data.checkedAt === 'string' && data.checkedAt) pair(summary, '확인 시각', data.checkedAt);
  root.append(summary);

  const packages = Array.isArray(data.packages) ? data.packages : [];
  if (!packages.length) {
    root.append(node('p', data.status === 'complete' ? '조회할 패키지가 없습니다' : '표시할 패키지 결과가 없습니다 · 미조회·설정 필요·확인 불가는 취약점 없음이 아닙니다', { 'data-state': 'empty' }));
    return finish();
  }
  const table = node('table');
  const headRow = node('tr');
  for (const title of ['패키지', '설치 버전', '상태', '취약점 ID(수정 시각)', '출처', '확인 시각']) headRow.append(node('th', title, { scope: 'col' }));
  const head = node('thead'); head.append(headRow);
  const body = node('tbody');
  for (const pkg of packages) body.append(packageRow(pkg));
  table.append(head, body);
  root.append(table);
  return finish();
}

// ---------- 마지막 총공세 · Halo 요약 대시보드 ----------
// 내 PC 상태(/api/pc/status)를 한눈에 보는 요약 카드입니다. 학생이 '내 PC 다시 확인'을 누를 때만 조회하고,
// 자동으로 다시 조회하지 않습니다. 화면은 createElement·textContent로만 만들며 POST·조치·AI 호출은 하지 않습니다.
// 정상(●)·주의(▲)·확인 불가(?)를 색뿐 아니라 기호와 글자로 함께 구분합니다.
const PC_METRICS = [['cpu', 'CPU'], ['memory', '메모리'], ['disk', '디스크'], ['firewall', '방화벽'], ['events', 'Windows 이벤트'], ['network', '네트워크']];
const PC_LEVELS = { ok: { mark: '●', label: '정상' }, warn: { mark: '▲', label: '주의' }, unknown: { mark: '?', label: '확인 불가' } };
const PC_REASONS = { permission_denied: '권한 없음', query_failed: '조회 실패', invalid_response: '응답 형식 오류', unsupported: '지원하지 않는 환경', timeout: '시간 초과' };
const PC_HISTORY_MAX = 10;
const PC_SCHEMA = 'aleph.on.pc-status.v1';
const finiteNumber = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const gib = (bytes) => `${(bytes / 1024 ** 3).toFixed(1)}GB`;
const percent = (part, whole) => Math.round((1000 * part) / whole) / 10;

function pcTime(at) {
  const ms = typeof at === 'string' ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms)) return '측정 시각 확인 불가';
  return `${new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} KST`;
}

// 지표 하나를 판정합니다. 값이 없거나 형식이 다르면 정상으로 보이지 않게 확인 불가로 둡니다.
function judgeMetric(key, metric) {
  if (!metric || metric.state !== 'ok') {
    const reason = typeof metric?.reason === 'string' && Object.hasOwn(PC_REASONS, metric.reason) ? PC_REASONS[metric.reason] : '값 없음';
    return { level: 'unknown', value: `확인 불가 (${reason})`, next: `${key === 'firewall' || key === 'events' ? '관리자 권한·Windows 환경인지 ' : ''}확인한 뒤 다시 확인을 누르세요.` };
  }
  if (key === 'cpu') {
    const usage = finiteNumber(metric.usagePercent);
    if (usage === null) return { level: 'unknown', value: '사용률 확인 불가' };
    return usage >= 85
      ? { level: 'warn', value: `사용률 ${usage}%`, next: '작업 관리자에서 CPU를 많이 쓰는 프로그램을 확인하세요.' }
      : { level: 'ok', value: `사용률 ${usage}%` };
  }
  if (key === 'memory') {
    const used = finiteNumber(metric.usedBytes); const total = finiteNumber(metric.totalBytes);
    if (used === null || !total) return { level: 'unknown', value: '사용량 확인 불가' };
    const rate = percent(used, total);
    return rate >= 90
      ? { level: 'warn', value: `${gib(used)} / ${gib(total)} (${rate}%)`, next: '쓰지 않는 프로그램을 닫아 메모리를 확보하세요.' }
      : { level: 'ok', value: `${gib(used)} / ${gib(total)} (${rate}%)` };
  }
  if (key === 'disk') {
    const free = finiteNumber(metric.freeBytes); const total = finiteNumber(metric.totalBytes);
    if (free === null || !total) return { level: 'unknown', value: '여유 공간 확인 불가' };
    const rate = percent(free, total);
    return rate < 10
      ? { level: 'warn', value: `여유 ${gib(free)} / ${gib(total)} (${rate}%)`, next: '디스크 정리로 여유 공간을 10% 이상 확보하세요.' }
      : { level: 'ok', value: `여유 ${gib(free)} / ${gib(total)} (${rate}%)` };
  }
  if (key === 'firewall') {
    const profiles = Array.isArray(metric.profiles) ? metric.profiles : [];
    if (!profiles.length || profiles.some((p) => typeof p?.enabled !== 'boolean')) return { level: 'unknown', value: '프로필 확인 불가' };
    const off = profiles.filter((p) => !p.enabled).map((p) => text(p.name));
    return off.length
      ? { level: 'warn', value: `꺼진 프로필: ${off.join(', ')}`, next: 'Windows 보안 > 방화벽에서 꺼진 프로필을 직접 확인하세요. 이 앱은 설정을 바꾸지 않습니다.' }
      : { level: 'ok', value: `${profiles.map((p) => text(p.name)).join('·')} 모두 켜짐` };
  }
  if (key === 'events') {
    const errors = finiteNumber(metric.errorCount); const warnings = finiteNumber(metric.warningCount);
    if (errors === null || warnings === null) return { level: 'unknown', value: '건수 확인 불가' };
    const value = `오류 ${errors}건 · 경고 ${warnings}건${metric.truncated ? ' (표본 상한 도달, 실제는 더 많을 수 있음)' : ''}`;
    return errors > 0
      ? { level: 'warn', value, next: '이벤트 뷰어 > Windows 로그 > 시스템에서 오류 내용을 확인하세요.' }
      : { level: 'ok', value };
  }
  if (key === 'network') {
    const ifaces = finiteNumber(metric.interfaceCount); const ipv4 = finiteNumber(metric.ipv4Count);
    if (ifaces === null || ipv4 === null) return { level: 'unknown', value: '연결 정보 확인 불가' };
    return ipv4 === 0
      ? { level: 'warn', value: `인터페이스 ${ifaces}개 · IPv4 주소 없음`, next: '네트워크 연결(와이파이·랜선)을 확인하세요.' }
      : { level: 'ok', value: `인터페이스 ${ifaces}개 · IPv4 ${ipv4}개` };
  }
  return { level: 'unknown', value: '확인 불가' };
}

function summarizePc(data) {
  const metrics = data && typeof data === 'object' && data.metrics && typeof data.metrics === 'object' ? data.metrics : {};
  const items = PC_METRICS.map(([key, label]) => ({ key, label, ...judgeMetric(key, metrics[key]) }));
  const count = (level) => items.filter((item) => item.level === level).length;
  const cpu = metrics.cpu?.state === 'ok' ? finiteNumber(metrics.cpu.usagePercent) : null;
  const usedBytes = metrics.memory?.state === 'ok' ? finiteNumber(metrics.memory.usedBytes) : null;
  const totalBytes = metrics.memory?.state === 'ok' ? finiteNumber(metrics.memory.totalBytes) : null;
  const memory = usedBytes !== null && totalBytes ? percent(usedBytes, totalBytes) : null;
  return { items, ok: count('ok'), warn: count('warn'), unknown: count('unknown'), measuredAt: data?.measuredAt, schemaOk: data?.schema === PC_SCHEMA, cpu, memory };
}

function pcCard(item) {
  const level = PC_LEVELS[item.level];
  const card = node('li', null, { 'data-metric': item.key, 'data-tone': item.level === 'warn' ? 'warning' : item.level });
  card.append(node('strong', `${level.mark} ${item.label}`), node('span', ` · ${level.label} · ${item.value}`));
  return card;
}

// 변화 그래프: 확인할 때마다 쌓인 CPU·메모리 사용률을 오래된 것부터 막대(<meter>)로 보여 줍니다.
// 제공 화면의 보안 정책상 인라인 style을 쓰지 않고, 브라우저 기본 막대와 숫자 글자를 함께 둡니다.
function usageCell(value, name) {
  const cell = node('td');
  if (value === null) { cell.append(node('span', '? 확인 불가', { 'data-tone': 'unknown' })); return cell; }
  const bar = node('meter', null, { min: '0', max: '100', low: '70', high: name === 'CPU' ? '85' : '90', optimum: '0', value: String(value), 'aria-label': `${name} 사용률 ${value}%` });
  cell.append(bar, node('span', ` ${value}%`));
  return cell;
}

function trendSection(history) {
  const points = history.filter((h) => h.ok).slice().reverse();
  const section = node('section', null, { 'data-field': 'trend' });
  section.append(node('h4', '변화 그래프 · CPU·메모리 사용률'));
  if (points.length < 2) {
    section.append(node('p', `확인을 2번 이상 하면 변화가 보입니다 (지금 ${points.length}번).`, { 'data-state': 'empty' }));
    return section;
  }
  const table = node('table');
  table.append(node('caption', `최근 ${points.length}번 확인 · 위가 오래된 값, 아래가 최신 값`));
  const head = node('tr');
  for (const label of ['측정 시각', 'CPU', '메모리']) head.append(node('th', label, { scope: 'col' }));
  table.append(head);
  for (const point of points) {
    const row = node('tr');
    row.append(node('th', pcTime(point.at), { scope: 'row' }), usageCell(point.summary.cpu, 'CPU'), usageCell(point.summary.memory, '메모리'));
    table.append(row);
  }
  section.append(table);
  const first = points[0].summary; const last = points[points.length - 1].summary;
  const diff = (a, b) => (a === null || b === null ? '비교 불가' : `${b - a >= 0 ? '+' : ''}${Math.round((b - a) * 10) / 10}%p`);
  section.append(node('p', `처음 대비 변화: CPU ${diff(first.cpu, last.cpu)} · 메모리 ${diff(first.memory, last.memory)}`, { 'data-field': 'trend-diff' }));
  return section;
}

function renderPcDashboard(state, recheck) {
  const root = node('section', null, { class: 'student-dashboard', 'data-agent': 'Halo', 'data-status': state.status });
  root.append(node('h3', 'Halo 요약 대시보드 · 내 PC'));
  const button = node('button', state.status === 'loading' ? '확인 중…' : '내 PC 다시 확인', { type: 'button', 'aria-describedby': 'halo-pc-help' });
  root.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');
  if (state.status === 'loading') button.disabled = true;
  button.addEventListener('click', recheck);
  // 다시 그려도 키보드 사용자가 버튼 위치를 잃지 않도록, 버튼으로 조회했다면 새 버튼에 초점을 돌려줍니다.
  if (state.keepFocus && state.status !== 'loading') {
    state.keepFocus = false;
    queueMicrotask(() => { if (typeof button.focus === 'function') button.focus(); });
  }
  root.append(button, node('p', '버튼을 누를 때만 조회합니다. 자동으로 다시 확인하거나 PC 설정을 바꾸지 않습니다.', { class: 'student-mode', id: 'halo-pc-help' }));

  if (state.status === 'idle') {
    root.append(node('p', "아직 확인하지 않았습니다. '내 PC 다시 확인'을 누르세요.", { role: 'status', 'data-state': 'idle' }));
  } else if (state.status === 'loading') {
    root.append(node('p', '내 PC 상태를 확인하는 중입니다', { role: 'status', 'data-state': 'loading' }));
  } else if (state.status === 'error') {
    const code = typeof state.error?.code === 'string' && SAFE_CODE.test(state.error.code) ? state.error.code : 'UNKNOWN';
    const message = typeof state.error?.message === 'string' && state.error.message ? state.error.message : '서버가 이유를 알려 주지 않았습니다';
    root.append(node('p', `내 PC 상태를 불러오지 못했습니다 — ${message} (${code}). 직접 다시 확인을 누르세요.`, { role: 'alert', 'data-state': 'error' }));
  }

  const summary = state.summary;
  if (summary) {
    const verdict = summary.warn ? 'warning' : summary.unknown ? 'unknown' : 'ok';
    const headline = summary.warn
      ? `▲ 주의 ${summary.warn}개 · 정상 ${summary.ok}개 · 확인 불가 ${summary.unknown}개`
      : summary.unknown
        ? `? 확인 불가 ${summary.unknown}개 · 정상 ${summary.ok}개 (확인 불가 항목은 정상으로 보지 않습니다)`
        : `● 6개 항목 모두 정상`;
    root.append(node('p', headline, { 'data-field': 'verdict', 'data-tone': verdict, role: 'status', 'aria-live': 'polite' }));
    root.append(node('p', `측정 시각: ${pcTime(summary.measuredAt)}${state.status === 'error' ? ' · 이전 결과입니다' : ''}`, { 'data-field': 'measuredAt' }));
    if (!summary.schemaOk) root.append(node('p', '응답 형식(schema)이 예상과 달라 값을 확인 불가로 다뤘습니다.', { 'data-tone': 'unknown' }));
    const cards = node('ul', null, { class: 'student-dashboard-cards' });
    for (const item of summary.items) cards.append(pcCard(item));
    root.append(cards);

    const nexts = summary.items.filter((item) => item.level !== 'ok' && item.next);
    const todo = node('section', null, { 'data-field': 'next' });
    todo.append(node('h4', '다음 할 일'));
    if (!nexts.length) todo.append(node('p', '지금 바로 할 일은 없습니다. 하루 한 번 다시 확인하세요.'));
    else {
      const list = node('ol');
      for (const item of nexts) list.append(node('li', `${item.label}: ${item.next}`));
      todo.append(list);
    }
    root.append(todo);
  }

  root.append(trendSection(state.history));

  if (state.history.length) {
    const history = node('details', null, { 'data-field': 'history' });
    history.append(node('summary', `최근 확인 기록 (${state.history.length}회, 최대 10회 · 이 화면을 연 동안만 보관)`));
    const list = node('ul');
    for (const h of state.history) {
      list.append(node('li', h.ok ? `${pcTime(h.at)} · 정상 ${h.summary.ok} · 주의 ${h.summary.warn} · 확인 불가 ${h.summary.unknown}` : `${pcTime(h.at)} · 조회 실패 (${h.code})`));
    }
    history.append(list);
    root.append(history);
  }

  const detail = node('details', null, { 'data-field': 'detail' });
  detail.append(node('summary', '자세히 보기 · 판정 기준'));
  const rules = node('ul');
  for (const rule of ['CPU 사용률 85% 이상이면 주의', '메모리 사용 90% 이상이면 주의', '디스크 여유 10% 미만이면 주의',
    '방화벽 프로필 중 하나라도 꺼져 있으면 주의', 'Windows 시스템 이벤트에 오류가 1건 이상이면 주의', 'IPv4 주소가 없으면 주의',
    '값이 없거나 형식이 다르면 정상이 아니라 확인 불가', '변화 그래프와 기록은 이 화면을 연 동안 최근 10번만 보관(저장하지 않음)', '출처: 로컬 서버의 /api/pc/status 읽기 전용 조회. 보안 판정·조치·AI 설명이 아닙니다.']) rules.append(node('li', rule));
  detail.append(rules);
  root.append(detail);
  return root;
}

export function createStudentView({ api, onChange } = {}) {
  // 대시보드 상태는 이 화면 안(클로저)에서만 보관합니다. 저장소·localStorage에 쓰지 않습니다.
  const pc = { status: 'idle', summary: null, error: null, history: [], keepFocus: false };
  const refresh = () => { if (typeof onChange === 'function') onChange(); };
  async function recheck() {
    if (pc.status === 'loading' || typeof api?.get !== 'function') return;
    pc.status = 'loading';
    pc.keepFocus = true;
    refresh();
    let result;
    try { result = await api.get('/api/pc/status'); } catch { result = { ok: false, error: { code: 'NETWORK_ERROR', message: '조회 중 오류가 났습니다' } }; }
    const at = new Date().toISOString();
    if (result?.ok && result.data && typeof result.data === 'object') {
      pc.status = 'ok'; pc.error = null; pc.summary = summarizePc(result.data);
      pc.history.unshift({ ok: true, at: pc.summary.measuredAt ?? at, summary: pc.summary });
    } else {
      pc.status = 'error'; pc.error = result?.error ?? null;
      const code = typeof pc.error?.code === 'string' && SAFE_CODE.test(pc.error.code) ? pc.error.code : 'UNKNOWN';
      pc.history.unshift({ ok: false, at, code });
    }
    pc.history.length = Math.min(pc.history.length, PC_HISTORY_MAX);
    refresh();
  }
  // 16단계 renderStatus는 그대로 두고, 그 위에 요약 대시보드만 덧붙입니다.
  const renderStatusWithDashboard = (input) => {
    const wrap = node('div', null, { class: 'student-status-with-dashboard' });
    wrap.append(renderPcDashboard(pc, recheck), renderStatus(input));
    return wrap;
  };
  return {
    renderIdentity,
    renderDecision,
    renderEvents,
    renderStatus: renderStatusWithDashboard,
    renderVulnerabilities,
    renderAiConnection,
    renderExplanation,
    renderAction,
  };
}
