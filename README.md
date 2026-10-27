# BYTE BACK 방어전 R5 · 5단계

- 운영: https://choi-bujang-secret-vault-livid.vercel.app/
- 저장소: https://github.com/eunsu7997/choi-bujang-secret-vault

## 5단계 가점 · 화면에서 Supabase 공개 키 없애기 (브랜치 step5-server-login)

- 로그인·세션 확인·로그아웃을 서버 함수로 옮겼습니다: `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout`. 공식 패키징 기준표(서버 함수 목록)를 지키기 위해 새 함수 파일 없이 `api/notes.js` 안에서 처리합니다(`src/auth-handler.mjs`).
- 토큰은 `__Host-vault_at`·`__Host-vault_rt` 쿠키(HttpOnly, Secure, SameSite=Strict, Path=/)에만 둡니다. 화면 코드는 토큰·공개 키·Supabase SDK를 다루지 않으며, 빌드는 `auth-config.json`과 `vendor/`를 만들지 않고 남은 것도 지웁니다.
- `/api/notes`는 Authorization 헤더(심판·자동 점검)를 우선하고, 헤더가 없을 때만 로그인 쿠키를 씁니다. 쿠키로 인증한 변경 요청은 같은 출처(Origin·Sec-Fetch-Site)만 허용합니다. 소유자 검사는 그대로입니다.
- 로그인 실패는 같은 문구(401)이며, 서버 인스턴스 안에서 IP·이메일별 10분 5회 실패 시 429입니다(Supabase Auth 자체 제한과 함께). 세션 복원 시 접근 토큰이 만료됐으면 갱신 토큰으로 새로 받습니다. 로그아웃은 서버 세션 종료(local) 후 쿠키를 항상 지웁니다.
- 한계: 실패 횟수 제한은 서버 인스턴스별입니다. 로그아웃 전에 발급된 접근 토큰은 만료(최대 1시간)까지 유효할 수 있습니다.

## 5단계 · 자료 요청을 서버 한곳으로 모읍니다 (2026-10-27)

- 브라우저의 메모 읽기·추가·수정·삭제는 원래부터 서버 함수(`/api/notes`, `/api/notes/:id`)로만 합니다. 화면 코드에 Supabase 자료 직접 호출(`.from('notes')`, `/rest/v1`)은 없습니다(제작 1: 없음). Supabase는 로그인(Auth)에만 씁니다.
- DB(`supabase/notes-step5-revoke.sql`): notes의 PUBLIC·anon·authenticated 직접 권한을 모두 회수하고 service_role(서버 함수)만 남깁니다. RLS·FORCE RLS와 4단계 정책 4개는 유지합니다(권한이 없으면 정책만으로 접근 불가). 확인: `notes-step5-check.sql`. 되돌리기: `notes-step4-rls.sql`. 2026-10-27 운영 적용 후 읽기 전용 확인: 권한은 service_role S/I/U/D만, anon·authenticated 없음, RLS·FORCE 켜짐, 정책 4개, 메모 5건. 공개 키로 원본 API 직접 GET·PATCH는 401(42501).
- `originalApiUrl`: `https://pttotbbsqtcsljawwjpr.supabase.co/rest/v1/notes` (쿼리 없는 원본 자료 경로).
- 서버 함수의 JWT 검증·(owner_kind, owner_id) 소유자 검사·서버 전용 키 설정은 4단계 그대로입니다.
- `npm run bundle`의 5단계 자기 점검: 공개 키로 원본 API 직접 조회·수정, 공개 정적 파일의 서버 키·시드 표식 검사, 비로그인 401 JSON, 보안 헤더, /aleph.json. 로그인 토큰이 필요한 2개는 미실행으로 남깁니다.

## 4단계 · 로그인해도 내 자료만 보이게 합니다 (2026-10-27)

- API: GET/POST /api/notes, GET/PUT/DELETE /api/notes/:id. 검증된 JWT의 (owner_kind, owner_id)로만 조회·추가·수정·삭제하며, 본문·URL의 소유자 값은 거절합니다. 남의 메모와 없는 메모는 같은 404입니다. 학생·심판 모두 자기 메모만 쓰기 가능(`writesEnabled: true`)합니다.
- DB(`supabase/notes-step4-*.sql`): 원본 가상 메모 4건은 학생 A, 공개 가능한 시험 메모 1건은 학생 B 소유입니다. notes에 RLS·FORCE RLS, anon 권한 없음, authenticated는 SELECT·INSERT·UPDATE·DELETE만, 네 정책 모두 `auth.uid() = owner_id and owner_kind = 'student'`입니다. 서버는 service_role로 접속해 RLS를 우회하므로 서버 소유권 필터가 1차 방어입니다.
- 적용 순서: notes-step4-check.sql(1~3 구간) → notes-step4-owners.sql → notes-step4-rls.sql → notes-step4-check.sql 전체. 되돌리기: notes-step4-rls-rollback.sql. 백업 스키마는 읽기만 합니다.
- 경로별 메서드: `GET /api/notes`(본인 목록), `POST /api/notes`(본인 생성, 입력 {id?,title,body} → 201 {id}), `GET /api/notes/:id`(본인 단건 {id,title,body}), `PUT /api/notes/:id`(본인 수정, 입력 {title,body}), `DELETE /api/notes/:id`(본인 삭제 → 204). `aleph.config.json`의 allowedRoutes는 공식 starter 점검과 호환되도록 경로 문자열만 둡니다.
- 운영 DB 적용(2026-10-27): owners·RLS SQL을 운영 Supabase에 적용했고, 읽기 전용 질의로 RLS/FORCE RLS, 정책 4개, authenticated S/I/U/D만, anon 권한 없음, 원본 4건 A 소유·B 시험 메모 1건·백업 4건을 확인했습니다. 원본 4건의 owner_id는 공식 카드에 따라 A로 바뀌었으므로 백업과 owner_id가 다른 것이 정상입니다(제목·본문·생성시각은 일치). authenticated 역할로 보이는 행은 A 4건·B 1건(읽기만 확인)입니다.
- 검증: `node --test --test-concurrency=1 test/*.test.mjs` 로컬 97건(96 PASS/1 SKIP, 가상 키·가상 DB). RLS 쓰기 차단(INSERT·UPDATE·DELETE)은 로컬 Postgres 모의 환경에서만 확인했고 운영 DB 쓰기 실측은 하지 않았습니다. 정상 심판 JWT 운영 시험과 공식 채점은 미검증입니다.
- `npm run bundle`의 4단계 자기 점검은 비로그인 401 JSON·위조 토큰·anon 키 Data API·첫 화면 보안 헤더·/aleph.json 등 8개를 실제 요청하고, 로그인 토큰이 필요한 2개는 미실행으로 남깁니다. 심판 판정이 아닙니다.

## 보안 기록 (4단계 범위 밖, 승인 전 변경 안 함)

- POST에 이미 있는 UUID를 넣으면 소유자와 관계없이 409입니다. 메모 내용은 읽거나 덮어쓸 수 없지만, 무작위 UUID(v4)를 맞힌 경우 존재 여부는 추측할 수 있습니다. 공식 선택 UUID 계약을 지키는 최소 대응 후보는 ①현재 유지(추측 비용이 2^122 수준) 또는 ②타인 소유 충돌을 본인 충돌과 같은 409로만 응답(현재도 동일)하는 것이며, 추가 변경은 하지 않았습니다.
- Supabase 경고: `public.rls_auto_enable()`은 SECURITY DEFINER(소유자 postgres, search_path=pg_catalog)이고 anon·authenticated에 EXECUTE가 있습니다. 반환형이 event_trigger이고 이벤트 트리거 `ensure_rls`로만 실행되어 직접 호출·REST RPC 경로는 확인되지 않았습니다. 권한 회수(`revoke execute ... from anon, authenticated`)는 PM 승인 후 별도 검토합니다.
- 그 밖의 Supabase 진단: backup 테이블 정책 없음(RLS·FORCE 켜짐, 공개 권한 회수 상태), 유출 비밀번호 보호 비활성화. 4단계 필수 항목은 아닙니다.

## 이전 기록 · 3단계 운영 상태 (2026-10-27)

운영 기준은 `3a3c7a2`입니다. 이 분리 작업본은 공식 3단계 API 계약 수정 후보이며 아직 배포하지 않았습니다. 아래 과거 실운영 검증은 새 API 형식의 운영 검증을 대체하지 않습니다.

후보 API: GET /api/notes → 배열, POST {id(선택 UUID),title,body} → 201 {id}, GET /api/notes/:id → {id,title,body}, PUT {title,body} → 200 메모, DELETE → 204 및 이후 GET404. 외부 body를 기존 DB content로 매핑합니다. 개별 :id 경로와 성공 상태코드·PUT 세부 형식은 구현 선택입니다. 상세 근거·배포 전 확인은 docs/OFFICIAL_STEP3_API.md를 보세요.

학생 JWT를 검증한 뒤 본인 메모 CRUD를 허용합니다. 실제 모드는 `writesEnabled: 'students-only'`입니다. 무인증 요청401, 본인 조회·수정200, 생성201, 삭제204, 타인 조회·수정·삭제404입니다. 심판의 공식 인증·소유권 분리·읽기는 유지하되 쓰기는403입니다. 정상 심판 JWT와 공식3단계 권한 요구가 미확보이므로 이 차단이 공식 채점에 적합하다고 확정하지 않습니다.

2026-10-26 커밋 `e5b3e4c1365450cde2f6a916da6afb247158f62b`에서 실제 A/B JWT·서로 다른 subject, A CRUD, B GET/PATCH/DELETE404, 원래 발급 JWT 자연만료 후401, 운영 UI CRUD·세션복원·로그아웃을 확인했습니다. 이후 문서만 변경해도 과거 요청을 새로 보냈다고 표현하지 않습니다.

B-1 `dc4448d`는 과거 인증 조회 전용 배포이며 현재 학생 쓰기403 상태가 아닙니다. 보안 실패 시 B-1 인증 조회로 복귀하되 DB/owner_kind/백업은 유지합니다. 인증 없는 과거 `af1740b`로 되돌리지 않습니다.

DB 백업·소유권 마이그레이션은 완료됐습니다. 원본4개·백업4개·5필드 차이0·합성 잔존0을 보존합니다. 백업을 재생성/삭제하거나 원본 owner_id를 시험 계정으로 재배정하지 마세요.

## 인증·소유권·공개 범위

`src/verify-login.mjs`는 공식 starter와 동일하며 JWT 서명·issuer·audience·만료를 확인합니다. 학생은 Supabase Auth, 심판은 공식 judgeIssuer/JWKS·ES256·배포 hostname audience 계약을 사용합니다. judgeIssuer를 임의 변경하지 않습니다.

모든 메모 조회·수정·삭제는 `(owner_kind, owner_id)`로 필터링합니다. 소유자는 검증된 신원에서만 정하고 본문의 소유자 지정은 거절합니다. 학생·심판은 같은 UUID여도 분리됩니다. 후보의 개별 조회·수정 응답은 id/title/body만 포함하고 생성 응답은 id만 포함합니다.

브라우저에는 Supabase URL과 publishable 키만 전달합니다. 서버 비밀키는 서버 환경변수로만 관리합니다. 모든 경로에 nosniff·X-Frame-Options DENY·CSP frame-ancestors 'none'을 설정합니다. `/data.json`은404이며 빌드에서 공개 메모를 복사하지 않습니다. DB의 RLS/FORCE RLS, anon/authenticated 권한 회수와 서버의 소유권 필터를 유지합니다.

## 검증과 제출 JSON

전체 회귀: `node --test --test-concurrency=1 test/*.test.mjs`

후보 시험 구성은86건이며 결과는85PASS/0FAIL/1SKIP입니다. 이전 운영본은78PASS/0FAIL/1SKIP입니다. SKIP은 배포 사본에 포함하지 않은 로컬 시드 대조입니다. 로컬 가짜 키·가상 신원 시험을 실제 학생/심판 인증이나 공식 점수로 보고하지 않습니다.

커밋 후 `npm run bundle`은 `src/attack-check.mjs`로6개 요청을 실제 실행하고, 로그인 세션이 필요한2개는 자동 미실행으로 기록합니다. 8개 모두 자동 실행했다고 하지 않습니다. 이 결과는 학생 자기 점검이며 심판 판정이 아닙니다.

PM 직접 로그인 세션에서 별도로 실행한 A/B 시험은 원본 로그·관측 커밋·날짜를 보존합니다. JSON 보완 시 v2의 attackId/expected/observed 구조를 유지하고 그 관찰이 실행된 커밋을 명시합니다. 코드·설정이 동일해도 오늘 해당 인증 요청을 다시 보냈다고 기록하지 않습니다. 자동 원본과 보완 JSON을 분리합니다. 포털 접수 형식·보완 허용 여부는 공식 카드 확인 전 미검증입니다.

`bundle-notes.json`, `artifacts/submission.json`, 실제 데이터·시드, 환경 파일은 Git에서 제외합니다. 제출물에 비밀번호·JWT·서버 키·실제 개인정보·메모 본문을 넣지 않습니다. 실제 제출은 별도 PM 승인 전 하지 않습니다.

## 실행과 DB 보존

의존성 설치: `npm ci`. 로컬 가상 화면: `npm run build -- --local`. 실제 Vercel 빌드는 저장소·커밋·URL 정보로 `/aleph.json`을 생성합니다. 설정은 step5, Supabase identityProvider, allowedRoutes=[/api/notes, /api/notes/:id, /api/auth/login, /api/auth/session, /api/auth/logout], originalApiUrl=원본 notes REST 경로입니다.

환경변수 이름은 SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY입니다. 값은 코드·대화·로그에 적지 않습니다. 현재 DB에서 notes.sql/백업/소유권 SQL을 처음부터 재실행하지 않습니다. 새 환경의 최초 구축은 `docs/DB_OWNERSHIP_RUNBOOK.md`를 현재 스키마와 PM 승인에 대조해 수행합니다.

## 공개 이력 감사와 한계

- 최초 공개 Git data.json은 공식 starter 가상 샘플과 같은 blob입니다. 로컬에서 도달 가능한 Git blob88개 비밀정보 패턴 검사에서 일치 항목이 없었습니다. 이 검사가 모든 개인정보 종류나 삭제된 원격 ref/fork/캐시까지 증명하지는 않습니다.
- 2026-10-27 기존 Vercel 고유 주소9개의 `/data.json`과 `/api/notes`는 모두 비로그인302로 Vercel 인증 화면에 이동했습니다. 보호를 우회하거나 인증 후 내부를 검사하지 않았습니다. 향후 보호가 해제되면 구버전 공개 API가 다시 노출될 수 있으므로 보호를 유지해야 합니다.
- 노출된 실제 키가 발견되면 우선 폐기/회전·접근 차단을 검토합니다. 이력 재작성·배포 삭제는 별도 승인을 받습니다. 과거 복사본까지 삭제됐다고 보장하지 않습니다.
- 로그아웃 후에도 기존 access token은 원래 만료까지 유효할 수 있습니다. 호출 횟수 제한은 미구현입니다. 공개 회원가입 허용 여부는 별도 정책입니다.
- 공식3단계 카드 계약은 PM 제공문을 확보했습니다. 포털 본문 직접 접근은 로그인 필요 상태입니다. 전체 채점표·포털 접수 형식·정상 심판 JWT 실증은 미검증입니다. 심판 CRUD가 필수면 현재403이 감점 원인이 될 수 있습니다. 제출 JSON 구조나 로컬 PASS를 공식 통과/100점으로 확정하지 않습니다.

코딩 도구는 [AGENTS.md](AGENTS.md)를 따릅니다. decider/detect 후속 단계 연습은3단계 실제 채점 결과가 아닙니다.
