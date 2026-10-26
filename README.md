# BYTE BACK 방어전 R5 · 3단계

가상 메모는 Supabase DB에 있고, 서버 API(`/api/notes`)는 Supabase Auth 로그인 토큰을 직접 검증한 요청에만 답합니다. 메모는 모두 실습용 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

- 저장소: https://github.com/eunsu7997/choi-bujang-secret-vault
- 배포: https://choi-bujang-secret-vault-livid.vercel.app/

## 운영과 로컬의 구분

- 이 배포는 B-1 인증 조회 단계이며 writesEnabled:false를 유지합니다. 무자격 요청은 401, 인증된 쓰기는 403입니다. 실제 학생·심판 JWT 운영 검증 전에는 쓰기를 켜지 않습니다. 긴급503 복구 기준은 c038aa9입니다.
- 운영 차단을 해제하는 기능 배포는 DB 적용·시험과 별도 PM 승인 뒤에만 합니다. 구버전 공개 API로 되돌리지 않습니다.

## 로컬에 구현한 기능

- `/` 화면은 Supabase Auth 이메일 로그인·로그아웃을 제공하고, 로그인 토큰을 `Authorization: Bearer`로 붙여 `/api/notes`를 읽습니다. 브라우저에는 `public/auth-config.json`(URL과 publishable 키, 빌드 생성·Git 제외)만 전달합니다.
- `api/notes.js`는 `src/verify-login.mjs`로 토큰의 서명·발급자·대상·만료를 확인합니다. 무토큰·위조·만료·다른 발급자 토큰은 모두 401입니다. 응답은 `id`, `title`, `content`만 담고 `owner_id`는 숨깁니다.
- 모든 조회·수정·삭제는 `(owner_kind, owner_id)`로 걸러 **자기 메모만** 다룹니다. 남의 메모와 없는 메모는 같은 404이며, 소유자는 요청 본문이 아니라 검증된 토큰에서만 정합니다. 학생과 심판은 ID가 같아도 서로 분리됩니다.
- 생성·수정·삭제(POST·PATCH·DELETE)는 구현돼 있지만 **로컬 후보는 인증된 쓰기를 403으로 차단하며, 이 B-1 배포는 인증된 쓰기를 403으로 제한합니다.** `supabase/notes-ownership.sql`(owner_kind 컬럼, service_role 쓰기 권한)을 적용하고 실제 DB에서 검증한 뒤 켭니다. CRUD는 테스트의 메모리 저장소에서 검증했습니다.
- 로그아웃 시 서버 확인이 실패해도 이 기기의 세션을 지우고 그 사실을 화면에 알립니다.
- `aleph.config.json`: step 3, `identityProvider`(Supabase Auth 발급자·대상·JWKS), `allowedRoutes: ["/api/notes"]`.
- `notes` 테이블(`supabase/notes.sql`)은 RLS가 켜져 있고 정책이 없으며 `anon`·`authenticated` 권한을 회수했습니다. Supabase REST로 직접 조회하면 거부됩니다.
- 빌드(`npm run build`)는 더 이상 `public/data.json`을 만들지 않고, Vercel 배포 정보로 `/aleph.json`(step 3)을 생성합니다.
- 모든 경로에 `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`를 붙입니다(`vercel.json`).

## 다시 실행하는 방법

1. Supabase SQL Editor에서 `supabase/notes.sql` → `supabase/notes-backup.sql` → `supabase/notes-ownership.sql` 순서로 실행합니다(백업이 없으면 소유권 SQL은 중단됩니다). 자세한 순서와 되돌리기는 `docs/DB_OWNERSHIP_RUNBOOK.md`를 따릅니다. **소유권 SQL을 적용하기 전에 이 버전을 배포하면 목록 조회가 502가 됩니다.** 가상 메모는 로컬 전용 `supabase/seed.local.sql`로 넣습니다(Git 제외).
2. Vercel → Settings → Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`를 직접 입력합니다. 값은 코드·Git·대화에 적지 않습니다.
3. 로컬 시험: `npm ci` 후 `node --test --test-concurrency=1 test/*.test.mjs`, 화면만 볼 때는 `npm run build -- --local`
4. 배포 후 자기 점검: 커밋한 뒤 `npm run bundle`. `src/attack-check.mjs`가 `/data.json`, 비로그인·위조 토큰·다른 발급자 토큰의 `/api/notes`, `/aleph.json`을 실제 요청해 상태 코드만 기록합니다. 로그인 상태 조회는 미실행으로 남깁니다. 이 결과는 학생의 자기 점검이며 심판 판정이 아닙니다.

로컬 전용 파일(`data.json`, `supabase/*.local.sql`, `bundle-notes.json`)은 `.gitignore`에 등록되어 있습니다.

## 남은 약점과 한계

- 서버 전용 키는 RLS를 우회하므로 서버 코드의 소유자 조건이 유일한 관문입니다. DB 쪽 RLS 정책은 없습니다.
- 로그아웃해도 이미 발급된 access token은 만료(기본 1시간)까지 유효합니다(현재 정책으로 수용).
- Supabase 공개 회원가입이 허용돼 있으면 누구나 계정을 만들어 로그인할 수 있습니다.
- 호출 횟수 제한이 없습니다.
- 최신 파일에서 메모 본문을 지워도 **과거 공개 커밋**(예: 첫 커밋 `f4b2de4`의 `data.json`, `public/data.json`)에는 그대로 남아 있어 GitHub에서 열람할 수 있습니다. 이 저장소는 기록을 강제로 지우지 않습니다.
- **이전 Vercel 배포**의 고유 주소는 새 배포 뒤에도 남아 있어 `/data.json`이 계속 열릴 수 있습니다. 필요하면 Vercel에서 이전 배포를 직접 삭제하거나 보호 설정을 켜세요.
- `src/decider.mjs`, `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다.

## 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 있습니다.
