// 8단계: 자료실 자원을 구역으로 나눕니다.
// 메모(notes)는 소유자만, 반 공지(notices)는 로그인한 사람이 읽기만, 공지 수정은 강사 관리 경로에서만 합니다.
// 강사 여부는 요청 본문·화면 메뉴의 role이 아니라 서버에 저장된 강사 목록(INSTRUCTOR_USER_IDS)으로만 정합니다.

// 반 공지는 공개 가능한 가상 공지입니다. 메모 UUID와 겹치지 않도록 notice- 로 시작하는 ID를 씁니다.
export const NOTICES = Object.freeze([
  Object.freeze({ id: 'notice-class-guide', title: '반 공지: 방어전 진행 안내', body: '이 공지는 공개 가능한 가상 공지입니다. 강사만 관리 경로에서 고칠 수 있습니다.' }),
]);

// 서버가 요청마다 구별하는 자원 ID입니다. 로그·거부 사유에는 이 ID와 이유 코드만 남깁니다.
export const resourceId = (zone, id) => (id ? `${zone}/${id}` : zone);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NOTICE_ID = /^notice-[a-z0-9-]{1,60}$/u;

function oneQuery(request, url, name) {
  const values = url.searchParams.getAll(name);
  const fromQuery = request.query?.[name];
  if (values.length > 1 || (fromQuery !== undefined && typeof fromQuery !== 'string')) return { bad: true };
  const all = [...values, ...(fromQuery !== undefined ? [fromQuery] : [])];
  if (all.some(value => value !== all[0])) return { bad: true };
  return { value: all[0] };
}

// 공지·관리 경로이면 구역 정보를, 메모 경로이면 null을 돌려줍니다(메모는 기존 noteRoute가 처리).
// /api/notes?zone= 는 vercel.json rewrite가 붙이는 내부 표시이며, 공지 읽기와 권한 검사가 같은 결과를 냅니다.
export function zoneRoute(request) {
  let url;
  try { url = new URL(request.url ?? '/api/notes', 'https://notes.internal'); } catch { return { zone: 'invalid' }; }
  if (url.origin !== 'https://notes.internal') return { zone: 'invalid' };
  const path = url.pathname;
  let zone = null;
  let id;
  const notice = /^\/api\/notices(?:\/([^/]+))?\/?$/u.exec(path);
  const admin = /^\/api\/admin\/notices\/([^/]+)\/?$/u.exec(path);
  try {
    if (notice) { zone = 'notices'; id = notice[1] && decodeURIComponent(notice[1]); }
    else if (admin) { zone = 'admin-notices'; id = decodeURIComponent(admin[1]); }
    else if (path === '/api/admin' || path.startsWith('/api/admin/') || path.startsWith('/api/notices')) return { zone: 'invalid' };
    else if (['/api/notes', '/api/notes/'].includes(path)) {
      const tag = oneQuery(request, url, 'zone');
      if (tag.bad) return { zone: 'invalid' };
      if (tag.value === undefined) return null;
      if (!['notices', 'admin-notices'].includes(tag.value)) return { zone: 'invalid' };
      zone = tag.value;
    } else return null;
  } catch { return { zone: 'invalid' }; }
  const queryId = oneQuery(request, url, 'id');
  if (queryId.bad || (id !== undefined && queryId.value !== undefined && queryId.value !== id)) return { zone: 'invalid' };
  id ??= queryId.value;
  if (id !== undefined && !NOTICE_ID.test(id)) return { zone: 'invalid' };
  if (zone === 'admin-notices' && id === undefined) return { zone: 'invalid' };
  return { zone, id };
}

// 서버 환경변수에 저장된 강사 사용자 번호(쉼표로 구분한 UUID)만 강사로 봅니다. 없으면 강사는 아무도 없습니다.
export function instructorIdsFromEnv(env = process.env) {
  const raw = typeof env.INSTRUCTOR_USER_IDS === 'string' ? env.INSTRUCTOR_USER_IDS : '';
  return new Set(raw.split(',').map(item => item.trim().toLowerCase()).filter(item => UUID.test(item)));
}

export const isInstructor = (owner, instructorIds) => Boolean(owner && owner.kind === 'student'
  && instructorIds instanceof Set && instructorIds.has(owner.id));
