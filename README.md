# BYTE BACK 방어전 R5 · 12단계

- 운영: https://choi-bujang-secret-vault-livid.vercel.app/
- 저장소: https://github.com/eunsu7997/choi-bujang-secret-vault

## 12단계 · 탈환 작전실을 완성합니다 (2026-11-01)

### 제작 1 · 탈환 작전실 화면 (`/ops.html`)
- 판정기 규칙(`RULE_IDS`)과 고정 가상 요청 판정, 탐지 사건(정상·120건·121건), 회수 상태(이 계정 기기 승인 승인·대기·취소 수, 반 엔진 회수 연결은 미실행), 복구 버전(안전 정책 사본 버전, B 메모 복원 사본 수, 감사 기록 수·마지막 동작)을 보여 줍니다.
- 요약은 `GET /api/ops/summary`(로그인 필수, 브라우저는 승인된 기기만)에서 받습니다. 판정기·탐지기 값은 요청 때마다 서버가 학생 코드(`src/decider.mjs`, `src/detect.mjs`)를 실행한 결과이고, 회수·복구 값은 DB의 개수·상태만 읽습니다. 메모 본문·토큰·사용자 번호는 응답과 화면에 없고, 읽지 못한 값은 "확인 불가"로 둡니다.

### 제작 2 · 실측 표와 41종 구분
- 같은 시험 정의(`src/ops-catalog.mjs`, 빌드 때 `public/ops-catalog.js`로 복사)를 화면과 절차가 함께 씁니다. 운영 API 요청 13종(정상 3: 첫 화면·manifest·aleph.json / 금지 10: data.json, 비로그인 메모 목록·항목·수정, 위조 토큰, 비로그인 공지·관리 공지·복구·기기 상태·작전실 요약)은 로그인 정보 없이 실제로 보내고, 학생 판정기 14종·탐지기 3종은 실제로 실행하며, 정책 사본은 해시를 다시 검증합니다.
- 표에는 단계, 정상·금지, 시험, 기대, 실제 응답, 결과, 요청 ID(보낼 때 만든 UUID, `x-request-id`), 서버 ID(Vercel `x-vercel-id`, Vercel 요청 기록과 대조), 확인 시각이 남습니다. 연결 자체가 실패하면 통과·실패로 세지 않고 미실행입니다.
- 절차: `npm run ops:probe` → 같은 표를 출력하고 `artifacts/ops-results.json`(Git 제외)에 저장합니다.
- 공식 41종: 6~12단계 25종은 카드의 괴물 이름과 관련 시험으로 상태를 계산합니다(관련 시험이 하나라도 기대와 다르면 실측 실패, 일부만 실행했거나 로그인 토큰·반 엔진이 필요한 부분이 남으면 부분 실측, 모두 실행해 기대대로면 실측 통과, 하나도 실행 못 하면 미실행). 1~5단계 16종은 이 저장소에 공식 이름 기록이 없어 "이름 미기록 · 미실행"입니다. 이 구분은 공식 판정이 아니며, 화면의 "기대대로" 표시를 통과 근거로 쓰지 않습니다.

### 제작 3 · 설치·실행·중지·복구 안내 (검사 기준: 11단계 보완 `d2808ed` + 이 12단계 저장점)
출처 구분: **제공 엔진 = ALEPH SDP 엔진**(반에서 제공·운영, 이 저장소에 엔진 코드 없음, 사용만 함 — 기기 인증서·mTLS·요청 서명·회수 연결·판정기 호출 담당). **학생 몫 = 이 저장소 전체**(판정기·탐지기·자료실 서버 함수·화면·SQL). 비밀값(Supabase 서버 키, 계정 비밀번호, 토큰, 기기 쿠키 값)은 저장소·제출 묶음에 넣지 않고 Vercel 환경변수와 각자 브라우저에만 둡니다.

| 구성 | 설치 | 실행·확인 | 중지 | 복구 |
|---|---|---|---|---|
| 학생 판정기 `src/decider.mjs` | `npm ci` | 엔진이 `decide(request)` 호출. 로컬: `npm run decider:test`, `npm run fixture:7` | 엔진 쪽 판정기 연결 해제(엔진 운영자) | `npm run policy:verify` → 차이 있으면 `git checkout <검사 커밋> -- src/decider.mjs`, 시험 사본은 `npm run policy:restore -- <폴더> --yes` |
| 학생 탐지 규칙 `src/detect.mjs` | `npm ci` | 엔진이 `detect(events)` 호출. 로컬: `npm run detect:test` | 엔진 쪽 탐지 연결 해제(엔진 운영자) | `git checkout <검사 커밋> -- src/detect.mjs` 후 `npm run detect:test` |
| 접속 앱(설치형 웹앱) `public/` | 자료실 주소를 브라우저로 열고 "홈 화면에 추가" | 로그인 → 기기 승인 요청 → `supabase/device-approve.sql`로 승인 → 「승인 다시 확인」 | 로그아웃, 앱 삭제, 기기 승인 취소(`status='revoked'`) | 새 기기로 다시 승인 요청·승인. 서비스 워커는 오프라인 안내만 보관하므로 강력 새로고침(Ctrl+Shift+R)으로 최신 화면 |
| 자료실(Vercel + Supabase) | Vercel에 저장소 연결, 환경변수 3개 입력, SQL은 `docs/DB_OWNERSHIP_RUNBOOK.md` 순서 + 10단계 `notes-step10-restore-point.sql` + 11단계 `device-approvals.sql` | `git push` → 자동 배포 → `/aleph.json` 커밋 확인 → `npm run ops:probe`, `npm run bundle` | Vercel 프로젝트 배포 일시 중지 또는 이전 배포로 롤백 | 코드: `git revert`(reset --hard 금지) 후 push. B 메모: `POST /api/restore/b4b4b4b4-0000-4000-8000-000000000001`. 확인: `notes-step10-check.sql` |

- 재현 순서: ① `git clone` → `npm ci` ② `npm run decider:test`·`npm run detect:test`·`npm run policy:verify` ③ `node --test --test-concurrency=1 test/*.test.mjs` ④ 배포 후 `/aleph.json`의 커밋이 검사 커밋과 같은지 확인 ⑤ `npm run ops:probe`와 `/ops.html`의 표가 같은 기대·실제를 보이는지 대조 ⑥ `npm run bundle`.
- 12단계 보완: `vercel.json`의 서버 함수 포함 파일에 `backup/policy/manifest.json`을 더했고(빠지면 서버 함수가 시작하지 못해 모든 API가 오류였음), 파일이 없어도 서버는 멈추지 않고 정책 사본 버전만 "확인 불가"로 둡니다. `npm run ops:probe` 실측에서 운영 API 응답이 기대와 달랐던 것을 보고 찾은 문제입니다.
- 미실행으로 남는 것: 로그인 토큰이 필요한 교차 사용자 요청, 반 엔진의 mTLS·요청 서명·회수 재시도, 1~5단계 공식 공격 16종(이름 미기록). 결과를 꾸미지 않습니다.

## 11단계 · 나만의 접속 앱을 완성합니다 (2026-11-01)

- 제작 1(설치형 웹앱): 지금 배포 중인 자료실 화면(`public/index.html`)에 `manifest.webmanifest`(앱 이름 「BYTE BACK 최부장의 비밀 자료실」, standalone, 아이콘 `icon.svg`)를 연결하고, 오프라인 안내(화면 상단 표시 + `offline.html`)를 넣었습니다. 서비스 워커(`sw.js`)는 오프라인 안내 페이지만 보관하고 `/api/*`·로그인 응답은 저장하지 않습니다. 화면에는 "앱을 설치(홈 화면에 추가)했다고 기기 확인이 끝난 것은 아닙니다"라고 표시합니다. 따로 설치하는 접속 프로그램은 만들지 않았습니다.
- 제작 2(기기 승인 흐름): 브라우저 로그인(쿠키)으로 들어온 자료 요청은 서버가 이 기기를 승인된 기기로 확인한 뒤에만 처리하고, 그 전에는 403 `DEVICE_NOT_APPROVED`로 자료를 주지 않습니다. 화면은 이때 메모 목록·쓰기 대신 기기 승인 화면(승인 코드, 「이 기기 승인 요청」, 「승인 다시 확인」)을 보여 줍니다.
  - 기기 식별값: 서버가 만든 무작위 값을 HttpOnly·Secure·SameSite=Strict 쿠키 `__Host-vault_device`로만 주고받습니다. 화면 코드는 읽을 수 없고, localStorage·IndexedDB에는 기기 키·토큰을 넣지 않습니다. DB(`public.device_approvals`)에는 SHA-256 해시만 두고, 화면에는 해시 앞 8자리 승인 코드만 보입니다.
  - 승인: 「승인 요청」 버튼은 대기(pending) 행만 만듭니다(서버 권한은 읽기·추가뿐, 추가 행은 트리거로 pending만 허용). 본문에 `approved`를 넣어도 무시됩니다. 승인은 계정 주인이 Supabase SQL Editor에서 `supabase/device-approve.sql`(내 이메일 + 화면의 승인 코드, 대기 중인 한 대만)로만 합니다. 취소는 같은 조건으로 `revoked`.
  - 경로: `GET /api/device/status`, `POST /api/device/request`(`vercel.json` rewrite → `api/notes.js`). 둘 다 로그인 필수(비로그인 401), 쿠키 POST는 같은 출처만.
  - 기존 결과 유지: 비로그인 401, 위조 토큰 401, 소유자 검사(남의 메모 404), 공지·관리·복원 경로는 그대로입니다. Authorization 헤더(심판·자동 점검) 경로의 기기 확인은 반 엔진·판정기(6단계 `device_registered`)가 맡고, 서버 화면 경로의 기기 승인과는 따로입니다. 기기 기록을 확인할 수 없으면(테이블 없음 등) 거부합니다.
- 11단계 보완(심판 S11_DATA_BEFORE_APPROVAL 반영): 화면이 로그인 직후·「승인 다시 확인」·온라인 복귀 때 먼저 `GET /api/device/status`를 묻고, 서버 응답이 `approved: true`(state `approved`)일 때만 메모를 요청합니다. 미승인·확인 실패면 메모를 요청하지 않고 승인 안내만 보여 주며, 쓰기 화면도 자료를 받은 뒤에만 엽니다.
- 운영 적용(학생이 직접): ① Supabase SQL Editor에서 `supabase/device-approvals.sql` 실행(마지막 확인 결과 `rls_forced=true`, `public_grants=0`, `server_grants=INSERT,SELECT`) ② 배포된 화면에서 로그인 → 「이 기기 승인 요청」 → 승인 코드 확인 ③ `supabase/device-approve.sql`의 이메일·코드 두 값을 SQL Editor에서만 바꿔 실행 ④ 화면에서 「승인 다시 확인」 → 기존 메모 화면이 열림. ①을 하기 전에는 브라우저 화면에서 메모가 열리지 않습니다(실패 시 닫힘).
- 확인: `node --test --test-concurrency=1 test/*.test.mjs`(`test/step11-device-app.test.mjs`: 승인 전 403·버튼은 pending만·승인 뒤 정상·다른 기기 차단·헤더 경로 유지·저장소 오류 시 거부·manifest/서비스 워커 검사, `test/ui-security.test.mjs`: 실제 화면 코드에서 승인 전 자료 없음·승인 뒤 기존 화면). 로그인 쿠키가 필요한 운영 확인(승인 전 자료 없음, 승인한 기기의 기존 화면)은 **미실행**이며 위 운영 적용 순서로 직접 확인합니다. 서명 위조(서명 뒤 경로·본문 변경, 서명 없는 요청)는 반 엔진의 기기 서명 검증 범위로, 이 저장소에서 실측하지 않았습니다.

## 10단계 · 백업에서 자료실을 되살립니다 (2026-11-01)

### 제작 1·2 · 안전 정책 사본과 되돌리기
- 안전 정책 = `src/decider.mjs`(판정기 규칙), `aleph.config.json`의 `allowedRoutes`, DB 접근 정책(`supabase/notes-step4-rls.sql`, `supabase/notes-step5-revoke.sql`). 사본은 `backup/policy/`에, 항목별 SHA-256과 전체 해시는 `backup/policy/manifest.json`에 있습니다(버전 `6c42a96e83f9`).
- `npm run policy:verify`: 사본을 다시 읽어 해시를 검증하고 현재 운영 정책과 다른 항목을 보여 줍니다. 사본이 없거나 해시가 하나라도 다르면 중단합니다. `npm run policy:snapshot`은 사본이 있으면 덮어쓰지 않습니다.
- `npm run policy:diff -- <시험폴더>`: 검증한 사본과 시험 정책의 차이(복원할 버전, 바뀐 파일·줄)만 보여 줍니다. `npm run policy:restore -- <시험폴더>`는 바뀔 항목만 보여 주고 멈추며, `--yes`를 붙여야 그 항목만 사본으로 되돌립니다. 시험 폴더의 다른 파일(다른 서비스 규칙)과 `audit.log` 이력은 보존하고 복원 한 줄을 추가합니다. 운영 정책 파일은 바꾸지 않습니다.
- `npm run policy:drill`: 임시 시험 사본을 만들어 메모 구역에 `GET /notes`(ID 없는 전체 목록) 한 줄을 끼워 침공을 흉내 내고(목록 allow), 차이를 보여 준 뒤 확인 없이는 적용하지 않고, `--yes` 복원 뒤 목록 deny·자기 메모 ID 읽기 allow를 다시 확인합니다. B의 A 자료 요청 거부는 API 소유자 검사(`test/step4-ownership.test.mjs`, `test/step8-zones.test.mjs`)로 확인합니다.

### 제작 3 · 시험 계정 B 메모 한 건 복원
- 복원 대상: 시험 계정 B(학생 B)의 가상 메모 **`b4b4b4b4-0000-4000-8000-000000000001`** (제목 `B 시험 메모 (공개 가능한 가상 자료)`). 내용 해시 = sha256(제목 + 줄바꿈 + 본문) = `43001f020a39ae0dd87914d5282b2b0560864e38ef02af144b396cf85f7e3676`.
- 서비스·경로: `api/notes.js`(서버 함수) · **`POST /api/restore/b4b4b4b4-0000-4000-8000-000000000001`** (`vercel.json` rewrite, `aleph.config.json`의 `restoreRoute`). 로그인 필수(비로그인 401), POST만(그 밖 405), 사본 주인(학생 B)이나 심판 토큰만 허용(그 밖 403 `RESTORE_FORBIDDEN`). 성공 응답: `{id, action(updated|reinserted|unchanged), ownerKind, ownerMatch, contentSha256}`.
- 비공개 사본: `supabase/notes-step10-restore-point.sql`이 만드는 `public.notes_restore_point`(RLS·FORCE RLS, anon·authenticated 권한 없음, service_role 읽기만). B 메모가 검증된 원래 제목·본문일 때만 사본을 만들고 기존 사본은 덮어쓰지 않습니다. 복원 함수 `public.restore_note_from_point`는 사본 해시를 다시 계산해 확인하고, 현재 메모의 소유자(owner_kind, owner_id)가 사본과 다르면 409로 멈추며, 그 한 건만 수정 또는 다시 삽입한 뒤 ID·소유자·내용 해시를 다시 대조합니다. 다른 메모는 건드리지 않고, 모든 시도는 추가만 되는 `public.notes_restore_audit`에 남습니다(수정·삭제·비우기 금지 트리거).
- 운영 적용(학생이 직접): Supabase SQL Editor에서 `notes-step10-restore-point.sql` 실행 → `notes-step10-check.sql`로 `restore_points=1`, `point_sha256=current_sha256`, `owner_match=true`, `point_rls·audit_rls=true`, `public_grants=0` 확인. SQL 적용 전에는 복원 경로가 502를 돌려줍니다.

### 제작 4 · 복구 뒤 재시험 순서 (실행 결과는 꾸미지 않고 실행한 것만 기록)
1. 정책: `npm run policy:verify` → 해시 일치·운영 정책과 다른 항목 0개, `npm run policy:drill` → 변조 뒤 목록 allow, 복원 뒤 목록 deny·자기 메모 allow.
2. 자료: 학생 B로 로그인해 B 메모를 수정(또는 삭제)한 뒤 같은 화면 개발자 도구에서 `fetch('/api/restore/b4b4b4b4-0000-4000-8000-000000000001',{method:'POST'})` → 200, `contentSha256`이 위 해시와 같음. `notes-step10-check.sql`로 `point_sha256=current_sha256`, `owner_match=true`, 메모 총수 유지, `audit_rows` 증가 확인. — **미실행**(학생 B 로그인 필요)
3. 1~9단계 정상·금지 요청 재시험: `npm run decider:test`(6·7단계), `npm run fixture:7`, `npm run detect:test`(9단계), `node --test --test-concurrency=1 test/*.test.mjs`(3~10단계 API·구역·소유자), `npm run bundle`(비로그인 401·위조 토큰·원본 API 직접 접근·보안 헤더 실제 요청). 로그인 토큰이 필요한 A/B 교차 요청(B의 A 메모 GET·PUT·DELETE 404, A 자기 메모 정상)은 **미실행**으로 두고 브라우저에서 직접 확인합니다.
4. 복원 경로 금지 요청: 비로그인 POST 401(bundle 자동), 학생 A 토큰 POST 403(**미실행**, 가상 토큰 시험 `test/step10-restore.test.mjs`로 대조).

## 9단계 · 도플갱어를 찾고 권한을 거둡니다 (2026-11-01)

- 제작 1(입력 처리): `src/detect.mjs`는 `docs/DETECT_EVENTS.md`대로 사건마다 `at`·`method`·`identity.sub` 세 값만 읽습니다. 형식이 맞지 않는 사건(시각 해석 불가, sub 없음 등)은 세지 않고, 네트워크·기기·지역 값은 만들거나 조건으로 쓰지 않습니다. 메모 내용·토큰·실명은 저장·출력하지 않습니다.
- 제작 2(규칙 `burst_read`): 같은 `identity.sub`의 `GET` 사건만 모아 `at` 시각으로 정렬하고, 어느 10분 구간(첫 사건부터 600초 미만)에서든 **120건을 넘으면**(121건 이상) 의심으로 봅니다. 정확히 120건, 10분 밖으로 흩어진 사건, 다른 사용자의 사건, GET이 아닌 사건은 합치지 않습니다. 여러 사용자가 넘으면 가장 먼저 넘은 한 명만 제안합니다.
- 제작 3(결과): 의심이면 정확히 `{action:"propose_revocation", reasonCode:"burst_read", subject: sub}`, 아니면 `{action:"observe"}`만 돌려줍니다. 기기 번호 등 다른 키는 붙이지 않고, 판정기 응답 형식·회수 API·기기 권한은 바꾸지 않았습니다. 정상 사건은 observe이므로 정상 기기는 그대로입니다.
- 확인 순서: ① `npm ci` ② `npm run detect:test` → 통과 6줄(정상 30건, 10분 안 120건, 121건, 폭주 200건, 다른 사용자 각 100건, 흩어진 200건) ③ `node --test --test-concurrency=1 test/*.test.mjs` (`test/step9-detect.test.mjs`: 정확히 600초에 걸친 121건은 observe, 입력 순서 무관, GET 외 사건 제외, 잘못된 사건 무시, 세 값만 읽기) ④ 커밋 후 `npm run bundle`.
- `npm run detect:test`가 통과해도 운영 반 엔진의 사건 전달·접속 회수가 연결됐다는 뜻은 아닙니다. 회수된 신원·세션의 재시도 차단은 이 저장소에서 실측하지 않았습니다(미실행).

## 8단계 · 자료마다 갈 수 있는 구역을 나눕니다 (2026-11-01)

- 제작 1(자원 ID): 메모는 기존 UUID(`notes/<uuid>`), 반 공지는 `notice-`로 시작하는 별도 ID(`notices/notice-class-guide`)로 구별합니다(`src/zones.mjs`). 기존 메모 자료·주소(`/api/notes`, `/api/notes/:id`)와 화면은 그대로입니다. 반 공지는 공개 가능한 가상 공지 1건이 코드에 고정돼 있습니다.
- 제작 2(판정기 규칙 `resource_zone`): 서비스와 정확한 경로 모양으로 나눕니다. 메모는 `GET·PUT·DELETE /notes/:id`만 허용하고 ID 없는 `GET /notes`(전체 목록)·`POST /notes`는 거부, 반 공지는 `GET /notices`, `GET /notices/:id`만 허용하고 쓰기(POST·PUT·PATCH·DELETE)는 누구에게나 `notice_read_only`로 거부, 강사 자료(instructor·materials 등)는 모두 `instructor_zone_denied`, 알 수 없는 경로·route와 path 불일치·쿼리가 붙은 요청·`:id` 자리의 기능 이름(export·all·list 등)은 `route_not_allowed`입니다. 메모 ID 형식(UUID 여부)은 판정기에서 좁히지 않고, 메모 주인 비교는 서버 API가 합니다. 6단계 기기 규칙을 먼저, 7단계 추가 확인 규칙을 구역 통과 뒤에 그대로 적용합니다.
- `aleph.config.json` allowedRoutes에는 판정기가 허용하는 경로만 메서드와 함께 적었습니다: `GET /api/notes/:id`, `PUT /api/notes/:id`, `DELETE /api/notes/:id`, `GET /api/notices`, `GET /api/notices/:id`. 화면이 쓰는 내 메모 목록 `GET /api/notes`와 로그인 경로는 서버 함수에 그대로 있지만 판정기 허용 목록에는 넣지 않았습니다.
- 제작 3(API 재확인): `api/notes.js`가 검증된 토큰의 사용자로 다시 대조합니다. 메모는 기존 (owner_kind, owner_id) 소유자 검사로 남의 메모가 404, 반 공지는 로그인한 학생·심판이 읽기만 하고 쓰기는 405 `NOTICE_READ_ONLY`, 강사 공지 수정은 관리 경로 `PUT /api/admin/notices/:id`에서 서버 환경변수 `INSTRUCTOR_USER_IDS`(쉼표로 구분한 강사 사용자 UUID, 비우면 강사 없음)에 있는 학생 로그인 사용자만 통과하고 그 밖은 403 `INSTRUCTOR_ONLY`입니다. 요청 본문·화면 메뉴의 role은 보지 않습니다. 공지 저장소가 아직 없어 강사 확인을 통과해도 변경은 하지 않고 501을 돌려줍니다. 거부 시 로그에는 이유 코드와 자원 ID만 남깁니다(`zone_denied`).
- 경로 연결: 서버 함수 목록을 늘리지 않기 위해 `vercel.json` rewrite로 `/api/notices`, `/api/notices/:id`, `/api/admin/notices/:id`를 `api/notes.js`에 연결합니다(내부 표시 `?zone=`). 기능을 쿼리로 고르는 공개 경로는 만들지 않았고, 내부 표시로 직접 들어와도 같은 권한 검사를 거칩니다.
- 확인 순서: ① `npm ci` ② `npm run decider:test` → 통과 4줄 ③ `node --test --test-concurrency=1 test/*.test.mjs` (`test/step8-zones.test.mjs`: 판정기 구역 허용·거부, UUID가 아닌 메모 ID 허용, 공지 쓰기 405, 학생의 강사 공지 수정 403(본문 role 무시), 다른 사람 메모 404) ④ 커밋 후 `npm run bundle`.
- 판정기 결과는 로컬 가상 요청 연습이며 심판 판정이 아닙니다. 새 이유 코드(`route_not_allowed`, `notice_read_only`, `instructor_zone_denied`)가 운영 등록부에 없으면 엔진은 그 요청을 허용하지 않습니다(거부 쪽으로 처리). 로그인 토큰이 필요한 운영 API 시험은 미실행입니다.

## 7단계 · 평소와 다른 접속은 다시 확인합니다 (2026-11-01)

- 제작 1(입력 검사): `src/decider.mjs`는 `signals.source`가 엔진이 검증해 넘긴 가상 사건(`judge_fixture`)일 때만 지역·네트워크·시각을 근거로 씁니다. 실제 경로의 `source: "none"`, 클라이언트 헤더 등 출처가 불명확한 값은 무시하고, `unknown`·빈 값·범위 밖 시각은 정상값으로 채우지 않고 "모름"으로 둡니다. `recentEvents`는 엔진이 만든 최근 사건이며 최근 10분 건수만 셉니다.
- 제작 2(규칙 `step_up_required`): 이상 근거 4가지(새벽 0~5시, 평소와 다른 네트워크, 평소와 다른 지역, 최근 10분 10건 이상) 중 **2개 이상** 겹치면 `step_up · step_up_required`로 추가 확인(다시 로그인)을 요구합니다. 지역 하나만으로는 차단·추가 확인을 하지 않고, 차단 대신 추가 확인이므로 영구 차단이 아닙니다. 응답은 다섯 항목만 돌려주므로 근거별 사유는 코드 주석과 이 기록에 남깁니다. 6단계 `device_registered`는 먼저 검사하며 그대로입니다(미등록은 추가 확인과 관계없이 deny).
- 다시 허용: `stepUp.verified`가 true이고 추가 확인 후 300초 이내일 때만 같은 복합 사건을 allow합니다. 900초처럼 오래됐거나 verified가 true가 아니면 다시 step_up입니다.
- 제작 3: 저장소의 판정 계약에는 `stepUp` 값만 있고, 제공 엔진이 같은 로그인으로 다시 로그인한 시각을 검증해 자료를 막고 새 요청을 다시 판정하는 계약은 없습니다. 그래서 가상 사건 규칙만 시험했고 실제 자료 차단·재로그인 실측은 **미실행**입니다. 토큰 원문은 기록하지 않습니다. 민감 메모 구분 값도 계약에 없어 메모별 추가 확인은 하지 않습니다.
- 확인 순서: ① `npm ci` ② `npm run decider:test` → 통과 4줄(등록 기기 정상, 미등록 기기, 복합 이상 접속, 다시 확인한 복합 이상 접속) ③ `npm run fixture:7` → `정상 사건: allow`, `복합 이상 사건: step_up` ④ `node --test --test-concurrency=1 test/*.test.mjs` (`test/step7-step-up.test.mjs`: 단일 근거·지역만 변경은 allow, 위조 출처 무시, 오래된 재인증 거부 등) ⑤ 커밋 후 `npm run bundle`.
- 위 명령은 모두 로컬 가상 요청 연습이며 심판 판정이 아닙니다.

## 6단계 · 등록한 기기만 자료실에 들어옵니다 (2026-11-01)

- `src/decider.mjs`에 규칙 `device_registered` 하나를 넣었습니다. `docs/DECIDER_REQUEST.md` 계약의 `deviceRegistered`가 정확히 `true`일 때만 `allow · approved`, `false`·값 없음·그 밖의 값은 `deny · device_not_registered`입니다. 응답은 다섯 항목(schema·requestId·decision·reasonCode·ruleIds)만 돌려주고, `RULE_IDS`에는 구현한 `device_registered`만 남겼습니다(시작 틀 `starter.deny` 제거).
- 판정기는 계약에 있는 요청 이름만 읽습니다. 계약에 없는 역할·신원·기기 객체·위치 값은 쓰지 않습니다. 인증서·CA·서명 키·기기 개인키는 만들거나 저장소에 넣지 않았습니다. 이번 단계에는 따로 설치할 접속 프로그램이 없습니다.
- 기존 자료실 주소, 화면, `/api/notes` 서버 함수, 4~5단계 소유자 검사·DB 권한은 그대로입니다. 등록 기기면 자료실 동작(읽기 포함)을 그대로 허용합니다.
- 확인 순서: ① `npm ci` ② `npm run decider:test` → `통과 · 등록 기기의 정상 요청`, `통과 · 미등록 기기의 가상 요청` 두 줄 ③ `node --test --test-concurrency=1 test/*.test.mjs` (`test/step6-decider.test.mjs`가 false·값 없음·null·문자열 등 거부와 응답 형식을 확인) ④ 커밋 후 `npm run bundle` → 6단계 자기 점검에 판정기 가상 요청 3건과 5단계 운영 점검이 함께 기록됩니다.
- `npm run decider:test`와 bundle의 판정기 점검은 로컬 가상 요청 연습이며 심판 판정이 아닙니다. 미등록 기기 공격은 심판이 맡습니다. `npm run fixture:7`(7단계 step_up 연습)은 아직 구현 전이라 실패하는 것이 정상입니다.

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

의존성 설치: `npm ci`. 로컬 가상 화면: `npm run build -- --local`. 실제 Vercel 빌드는 저장소·커밋·URL 정보로 `/aleph.json`을 생성합니다. 설정은 step12, restoreRoute=/api/restore/b4b4b4b4-0000-4000-8000-000000000001, Supabase identityProvider, allowedRoutes=[GET·PUT·DELETE /api/notes/:id, GET /api/notices, GET /api/notices/:id](판정기가 허용하는 경로만), originalApiUrl=원본 notes REST 경로입니다.

환경변수 이름은 SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY입니다. 값은 코드·대화·로그에 적지 않습니다. 현재 DB에서 notes.sql/백업/소유권 SQL을 처음부터 재실행하지 않습니다. 새 환경의 최초 구축은 `docs/DB_OWNERSHIP_RUNBOOK.md`를 현재 스키마와 PM 승인에 대조해 수행합니다.

## 공개 이력 감사와 한계

- 최초 공개 Git data.json은 공식 starter 가상 샘플과 같은 blob입니다. 로컬에서 도달 가능한 Git blob88개 비밀정보 패턴 검사에서 일치 항목이 없었습니다. 이 검사가 모든 개인정보 종류나 삭제된 원격 ref/fork/캐시까지 증명하지는 않습니다.
- 2026-10-27 기존 Vercel 고유 주소9개의 `/data.json`과 `/api/notes`는 모두 비로그인302로 Vercel 인증 화면에 이동했습니다. 보호를 우회하거나 인증 후 내부를 검사하지 않았습니다. 향후 보호가 해제되면 구버전 공개 API가 다시 노출될 수 있으므로 보호를 유지해야 합니다.
- 노출된 실제 키가 발견되면 우선 폐기/회전·접근 차단을 검토합니다. 이력 재작성·배포 삭제는 별도 승인을 받습니다. 과거 복사본까지 삭제됐다고 보장하지 않습니다.
- 로그아웃 후에도 기존 access token은 원래 만료까지 유효할 수 있습니다. 호출 횟수 제한은 미구현입니다. 공개 회원가입 허용 여부는 별도 정책입니다.
- 공식3단계 카드 계약은 PM 제공문을 확보했습니다. 포털 본문 직접 접근은 로그인 필요 상태입니다. 전체 채점표·포털 접수 형식·정상 심판 JWT 실증은 미검증입니다. 심판 CRUD가 필수면 현재403이 감점 원인이 될 수 있습니다. 제출 JSON 구조나 로컬 PASS를 공식 통과/100점으로 확정하지 않습니다.

코딩 도구는 [AGENTS.md](AGENTS.md)를 따릅니다. decider/detect 후속 단계 연습은3단계 실제 채점 결과가 아닙니다.
