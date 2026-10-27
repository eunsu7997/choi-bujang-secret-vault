# BYTE BACK 방어전 R5 · 3단계

- 운영: https://choi-bujang-secret-vault-livid.vercel.app/
- 저장소: https://github.com/eunsu7997/choi-bujang-secret-vault

## 현재 운영 상태 · 2026-10-27

학생 JWT를 검증한 뒤 본인 메모 CRUD를 허용합니다. 실제 모드는 `writesEnabled: 'students-only'`입니다. 무인증 요청401, 본인 조회·수정200, 생성201, 삭제204, 타인 조회·수정·삭제404입니다. 심판의 공식 인증·소유권 분리·읽기는 유지하되 쓰기는403입니다. 정상 심판 JWT와 공식3단계 권한 요구가 미확보이므로 이 차단이 공식 채점에 적합하다고 확정하지 않습니다.

2026-10-26 커밋 `e5b3e4c1365450cde2f6a916da6afb247158f62b`에서 실제 A/B JWT·서로 다른 subject, A CRUD, B GET/PATCH/DELETE404, 원래 발급 JWT 자연만료 후401, 운영 UI CRUD·세션복원·로그아웃을 확인했습니다. 이후 문서만 변경해도 과거 요청을 새로 보냈다고 표현하지 않습니다.

B-1 `dc4448d`는 과거 인증 조회 전용 배포이며 현재 학생 쓰기403 상태가 아닙니다. 보안 실패 시 B-1 인증 조회로 복귀하되 DB/owner_kind/백업은 유지합니다. 인증 없는 과거 `af1740b`로 되돌리지 않습니다.

DB 백업·소유권 마이그레이션은 완료됐습니다. 원본4개·백업4개·5필드 차이0·합성 잔존0을 보존합니다. 백업을 재생성/삭제하거나 원본 owner_id를 시험 계정으로 재배정하지 마세요.

## 인증·소유권·공개 범위

`src/verify-login.mjs`는 공식 starter와 동일하며 JWT 서명·issuer·audience·만료를 확인합니다. 학생은 Supabase Auth, 심판은 공식 judgeIssuer/JWKS·ES256·배포 hostname audience 계약을 사용합니다. judgeIssuer를 임의 변경하지 않습니다.

모든 메모 조회·수정·삭제는 `(owner_kind, owner_id)`로 필터링합니다. 소유자는 검증된 신원에서만 정하고 본문의 소유자 지정은 거절합니다. 학생·심판은 같은 UUID여도 분리됩니다. 응답은 id/title/content만 포함합니다.

브라우저에는 Supabase URL과 publishable 키만 전달합니다. 서버 비밀키는 서버 환경변수로만 관리합니다. 모든 경로에 nosniff·X-Frame-Options DENY·CSP frame-ancestors 'none'을 설정합니다. `/data.json`은404이며 빌드에서 공개 메모를 복사하지 않습니다. DB의 RLS/FORCE RLS, anon/authenticated 권한 회수와 서버의 소유권 필터를 유지합니다.

## 검증과 제출 JSON

전체 회귀: `node --test --test-concurrency=1 test/*.test.mjs`

시험 구성은79건이며 기존 결과는78PASS/0FAIL/1SKIP입니다. SKIP은 배포 사본에 포함하지 않은 로컬 시드 대조입니다. 로컬 가짜 키·가상 신원 시험을 실제 학생/심판 인증이나 공식 점수로 보고하지 않습니다.

커밋 후 `npm run bundle`은 `src/attack-check.mjs`로6개 요청을 실제 실행하고, 로그인 세션이 필요한2개는 자동 미실행으로 기록합니다. 8개 모두 자동 실행했다고 하지 않습니다. 이 결과는 학생 자기 점검이며 심판 판정이 아닙니다.

PM 직접 로그인 세션에서 별도로 실행한 A/B 시험은 원본 로그·관측 커밋·날짜를 보존합니다. JSON 보완 시 v2의 attackId/expected/observed 구조를 유지하고 그 관찰이 실행된 커밋을 명시합니다. 코드·설정이 동일해도 오늘 해당 인증 요청을 다시 보냈다고 기록하지 않습니다. 자동 원본과 보완 JSON을 분리합니다. 포털 접수 형식·보완 허용 여부는 공식 카드 확인 전 미검증입니다.

`bundle-notes.json`, `artifacts/submission.json`, 실제 데이터·시드, 환경 파일은 Git에서 제외합니다. 제출물에 비밀번호·JWT·서버 키·실제 개인정보·메모 본문을 넣지 않습니다. 실제 제출은 별도 PM 승인 전 하지 않습니다.

## 실행과 DB 보존

의존성 설치: `npm ci`. 로컬 가상 화면: `npm run build -- --local`. 실제 Vercel 빌드는 저장소·커밋·URL 정보로 `/aleph.json`을 생성합니다. 설정은 step3, Supabase identityProvider, allowedRoutes=[/api/notes]입니다.

환경변수 이름은 SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY입니다. 값은 코드·대화·로그에 적지 않습니다. 현재 DB에서 notes.sql/백업/소유권 SQL을 처음부터 재실행하지 않습니다. 새 환경의 최초 구축은 `docs/DB_OWNERSHIP_RUNBOOK.md`를 현재 스키마와 PM 승인에 대조해 수행합니다.

## 공개 이력 감사와 한계

- 최초 공개 Git data.json은 공식 starter 가상 샘플과 같은 blob입니다. 로컬에서 도달 가능한 Git blob88개 비밀정보 패턴 검사에서 일치 항목이 없었습니다. 이 검사가 모든 개인정보 종류나 삭제된 원격 ref/fork/캐시까지 증명하지는 않습니다.
- 2026-10-27 기존 Vercel 고유 주소9개의 `/data.json`과 `/api/notes`는 모두 비로그인302로 Vercel 인증 화면에 이동했습니다. 보호를 우회하거나 인증 후 내부를 검사하지 않았습니다. 향후 보호가 해제되면 구버전 공개 API가 다시 노출될 수 있으므로 보호를 유지해야 합니다.
- 노출된 실제 키가 발견되면 우선 폐기/회전·접근 차단을 검토합니다. 이력 재작성·배포 삭제는 별도 승인을 받습니다. 과거 복사본까지 삭제됐다고 보장하지 않습니다.
- 로그아웃 후에도 기존 access token은 원래 만료까지 유효할 수 있습니다. 호출 횟수 제한은 미구현입니다. 공개 회원가입 허용 여부는 별도 정책입니다.
- 공식3단계 카드·전체 채점표·포털 접수 형식·정상 심판 JWT 실증은 미확보입니다. 심판 CRUD가 필수면 현재403이 감점 원인이 될 수 있습니다. 제출 JSON 구조나 로컬 PASS를 공식 통과/100점으로 확정하지 않습니다.

코딩 도구는 [AGENTS.md](AGENTS.md)를 따릅니다. decider/detect 후속 단계 연습은3단계 실제 채점 결과가 아닙니다.
