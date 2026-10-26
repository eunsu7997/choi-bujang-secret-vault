# BYTE BACK 방어전 R5 · 2단계

가상 메모 네 건을 공개 파일(`/data.json`)에서 Supabase DB로 옮기고, 화면은 서버 API(`/api/notes`)에서 읽는 단계입니다. 메모는 모두 실습용 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

- 저장소: https://github.com/eunsu7997/choi-bujang-secret-vault
- 배포: https://choi-bujang-secret-vault-livid.vercel.app/

## 현재 작동하는 기능

- `/` 화면은 `/api/notes`에서 메모를 읽습니다.
- `api/notes.js`는 서버 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`로 `notes` 테이블의 `title`, `content`만 읽어 돌려줍니다. GET 외에는 405, 설정 누락은 500, DB 오류는 502이며 오류 내용은 응답·로그에 남기지 않습니다.
- `notes` 테이블(`supabase/notes.sql`)은 RLS가 켜져 있고 정책이 없으며 `anon`·`authenticated` 권한을 회수했습니다. Supabase REST로 직접 조회하면 거부됩니다.
- 빌드(`npm run build`)는 더 이상 `public/data.json`을 만들지 않고, Vercel 배포 정보로 `/aleph.json`(step 2)을 생성합니다.
- 모든 경로에 `X-Content-Type-Options: nosniff`를 붙입니다(`vercel.json`).

## 다시 실행하는 방법

1. Supabase SQL Editor에서 `supabase/notes.sql`을 실행합니다. 가상 메모는 로컬 전용 `supabase/seed.local.sql`로 넣습니다(Git 제외).
2. Vercel → Settings → Environment Variables에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 직접 입력합니다. 값은 코드·Git·대화에 적지 않습니다.
3. 로컬 시험: `npm ci` 후 `node --test test/*.test.mjs`, 화면만 볼 때는 `npm run build -- --local`
4. 배포 후 자기 점검: 커밋한 뒤 `npm run bundle`. `src/attack-check.mjs`가 비로그인으로 `/data.json`, `/api/notes`, `/aleph.json`을 실제 요청해 관찰 결과를 기록합니다. 이 결과는 학생의 자기 점검이며 심판 판정이 아닙니다.

로컬 전용 파일(`data.json`, `supabase/*.local.sql`, `bundle-notes.json`)은 `.gitignore`에 등록되어 있습니다.

## 남은 약점과 한계

- `/api/notes`에 아직 로그인 확인이 없어 누구나 메모를 읽을 수 있습니다. 서버 전용 키는 RLS를 우회하므로 서버 코드가 유일한 관문입니다. 3단계에서 로그인과 소유자(`owner_id`) 확인을 추가합니다.
- 호출 횟수 제한이 없습니다.
- 최신 파일에서 메모 본문을 지워도 **과거 공개 커밋**(예: 첫 커밋 `f4b2de4`의 `data.json`, `public/data.json`)에는 그대로 남아 있어 GitHub에서 열람할 수 있습니다. 이 저장소는 기록을 강제로 지우지 않습니다.
- **이전 Vercel 배포**의 고유 주소는 새 배포 뒤에도 남아 있어 `/data.json`이 계속 열릴 수 있습니다. 필요하면 Vercel에서 이전 배포를 직접 삭제하거나 보호 설정을 켜세요.
- `src/decider.mjs`, `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다.

## 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 있습니다.
