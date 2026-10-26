# 3단계 최종 적용 체크리스트 (PM 실행용)

DB 적용부터 배포·제출까지의 순서입니다. 코딩 도구는 SQL 실행·쓰기 활성화·커밋·배포를 하지 않습니다. 키 값은 대화·파일·로그에 적지 않고, 입력란이나 별도 터미널에만 넣습니다.

**순서를 바꾸지 마세요.** 3단계 코드는 `owner_kind` 컬럼을 읽으므로, 소유권 SQL보다 먼저 배포하면 메모 조회가 502가 됩니다. 현재 운영(2단계 `af1740b`)은 이 컬럼을 무시하고 인증 없이 모든 행을 조회합니다. 백업·SQL 적용 전 외부 접근을 차단해야 하며, 완료 전까지 노출 위험이 없어졌다고 판단하면 안 됩니다.

## 0. 시작 전 상태 확인 (읽기 전용)

- [ ] 운영 `/aleph.json`이 `step 2`, `af1740b`인지 확인합니다. (현재 운영은 비로그인 `/api/notes`가 열려 있습니다. 이 위험은 3단계 배포 뒤에 닫힙니다.)
- [ ] SQL Editor에서 확인합니다.
  ```sql
  select count(*) as notes, count(distinct owner_id) as owners from public.notes;
  select relrowsecurity, relforcerowsecurity from pg_class where oid = 'public.notes'::regclass;
  select count(*) as policies from pg_policies where schemaname = 'public' and tablename = 'notes';
  ```
  정상: 메모 수가 예상과 같고, RLS 두 값이 `true`, 정책이 `0`.

## 1. 백업

- [ ] SQL Editor에서 `supabase/notes-backup.sql`을 실행합니다. 마지막 결과의 `original`과 `backup` 수가 같아야 합니다.
- 사본은 API로 공개되지 않는 `backup` 스키마에 있고, RLS가 켜져 있으며 anon·authenticated 권한이 없습니다.
- 추가 안전망이 필요하면 Table Editor에서 CSV로도 내려받되, 그 파일은 저장소 밖에 두고 Git에 넣지 않습니다.

## 2. 소유권 SQL 적용

- [ ] SQL Editor에서 `supabase/notes-ownership.sql` 전체를 실행합니다. 한 트랜잭션이라 사전 점검에 걸리거나 중간에 실패하면 아무것도 바뀌지 않습니다.
- [ ] 마지막 결과에서 `student` 건수가 0번의 메모 수와 같고, 정책이 `0`인지 봅니다.
- [ ] 시드 메모의 `owner_id`가 자리표시자(`00000000-…`)라면 계정 A로 로그인해도 목록이 비어 보입니다. 필요하면 로컬 전용 SQL(`supabase/*.local.sql`, Git 제외)로 계정 A의 UUID로 바꿉니다.

## 3. 실제 DB 점검 (로컬 별도 터미널, 값은 직접 입력)

```powershell
$env:SUPABASE_URL = Read-Host "Project URL"
$s = Read-Host "서버 전용 키" -AsSecureString
$env:SUPABASE_SECRET_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
$env:SUPABASE_PUBLISHABLE_KEY = Read-Host "publishable 키"
node scripts/db-integration.mjs --check-only
node scripts/db-integration.mjs --yes-write-test-rows
Remove-Item Env:SUPABASE_URL, Env:SUPABASE_SECRET_KEY, Env:SUPABASE_PUBLISHABLE_KEY
```

- [ ] `--check-only`: 스키마 적용과 공개 키 직접 조회 거절(401/403)이 PASS. 공개 키를 넣지 않으면 FAIL로 남습니다.
- [ ] `--yes-write-test-rows`: 가상 소유자 UUID로 만든 시험 메모에 대해 학생 B와 같은 UUID의 심판이 각각 읽기·수정·삭제 모두 404, A의 수정·삭제 성공, 시험 행 정리까지 **모든 줄이 PASS**.
- FAIL이 하나라도 있으면 4번으로 가지 않고 6번(되돌리기)을 검토합니다.

## 4. 쓰기 활성화 (별도 승인)

- [ ] 3번이 모두 PASS면 `api/notes.js` 기본 핸들러의 `writesEnabled: false`를 `true`로 바꾸는 변경을 승인받습니다.
- [ ] `node --test --test-concurrency=1 test/*.test.mjs`가 모두 통과하는지 다시 봅니다. (쓰기 비활성을 확인하는 테스트는 이 변경과 함께 기대값을 바꿉니다.)

## 5. 커밋·배포·운영 확인·제출 (별도 승인)

- [ ] Vercel Production 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`가 모두 있는지 확인합니다.
- [ ] 커밋 전 포함 파일과 비밀값 검사 결과를 확인합니다. `bundle-notes.json`, `artifacts/`, `data.json`, `supabase/*.local.sql`, `public/auth-config.json`은 커밋하지 않습니다.
- [ ] 커밋 → 일반 push(강제 push 금지) → Vercel 자동 배포 성공을 확인합니다.
- [ ] 운영 확인:
  - `/aleph.json`이 `step 3`과 새 커밋
  - 비로그인 `GET /api/notes` → 401, 위조 토큰 → 401
  - `/data.json` → 404
  - 응답 헤더에 `X-Content-Type-Options: nosniff`, `Content-Security-Policy: frame-ancestors 'none'`, `X-Frame-Options: DENY`
  - 브라우저: 계정 A 로그인 → 자기 메모만 보임, 추가·수정·삭제 동작, 계정 B는 A의 메모를 볼 수 없음
- [ ] `npm run bundle`로 제출 묶음을 만들고 내용을 검수한 뒤 제출합니다.

## 6. 되돌리기

구버전(2단계 `af1740b`)은 인증 없이 모든 메모를 읽습니다. 공개 상태로 복귀하지 않습니다. 먼저 PM 승인으로 외부 접근을 차단하고 쓰기를 중단한 뒤 아래 조건을 확인합니다. 심판 메모가 있으면 삭제·학생 전환 없이 롤백 자체를 중단합니다.

1. [ ] 쓰기 차단(SQL Editor): `revoke insert, update, delete on table public.notes from service_role;` — 이때부터 3단계 앱의 추가·수정·삭제는 실패하고 조회만 됩니다.
2. [ ] 확인(읽기 전용): `select count(*) from public.notes where owner_kind is distinct from 'student';`
3. [ ] 0이 아니면 기존 학생·심판 소유권을 보존한 채 롤백을 중단합니다. 별도 데이터 변경 승인 없이 이동·삭제·재분류하지 않습니다.
4. [ ] 외부 접근 차단을 유지한 상태에서만 호환 버전 복귀를 검토합니다. 인증 없는 2단계 버전을 공개 운영에 Promote하지 않습니다.
5. [ ] `supabase/notes-ownership-rollback.sql`을 실행합니다. 심판 메모가 남아 있으면 중단합니다.
6. [ ] 데이터가 손상된 경우에만 `supabase/notes-backup.sql` 끝의 복원 절차(주석)를 따릅니다. 먼저 현재 상태를 보존하고, 백업 뒤 새로 생긴 메모와 사라진 메모 수를 확인한 다음 PM이 판단합니다.
7. [ ] 0번의 확인 SQL로 메모 수와 RLS·정책 상태가 적용 전과 같은지 봅니다.


## 최종 결함 수정 후 롤백 승인 조건

- 롤백 SQL은 `current_user`의 `rolsuper OR rolbypassrls`를 먼저 검사합니다. 권한 부족이면 SQLSTATE `42501`로 트랜잭션이 실패하며 스키마·행·소유권을 바꾸지 않습니다. 실패한 세션은 `ROLLBACK`으로 종료해야 합니다.
- 권한 검사 뒤 `ACCESS EXCLUSIVE` 잠금을 잡고 심판·알 수 없는 종류·NULL 소유권을 검사합니다. 검사부터 컬럼 제거까지 동시 쓰기를 막으며, 잠금 획득 실패도 전체 트랜잭션 실패입니다.
- 심판 메모가 있으면 삭제하거나 학생 소유로 바꾸지 말고 롤백을 중단합니다. 기존 6절의 '정리'는 데이터 삭제 허가가 아닙니다. 데이터 이동·삭제는 별도 PM 결정과 승인이 필요합니다.
- 정상 롤백은 모든 행이 학생 소유일 때만 가능합니다. `owner_id`, 메모 ID·본문·생성 시각은 유지하고 `owner_kind` 구분만 제거합니다. 심판 소유권 구분을 지우는 롤백은 허용하지 않습니다.
- 2단계 `af1740b`는 인증 없는 API이므로 6절의 구버전 배포를 공개 서비스에서 그대로 실행하지 마세요. 외부 접근을 먼저 차단한 유지보수 환경이나 검증된 인증 유지 버전이 필요합니다. 접근 차단·배포·SQL 실행은 각각 PM 승인 대상입니다.
- 이번 자동 시험은 SQL 텍스트의 안전 조건과 모의 저장소의 학생·심판 격리를 확인합니다. PostgreSQL에서 권한 부족/심판 존재/정상 롤백의 실제 원자성·잠금·데이터 보존은 미실행입니다. 승인된 격리 DB에서 별도 확인하기 전 완료로 표시하지 않습니다.


## 최종 운영 승인 묶음과 실제 확인 현황

- 읽기 전용 확인(2026-10-26): 메모 4개, 소유자 1개, 자리표시자 소유자 0개, RLS/FORCE RLS=true, 정책 0개, owner_kind 없음, backup.notes_before_ownership 없음. 실제 사용자 UUID·메모 본문은 수집하지 않았습니다.
- 서비스 역할의 기존 TRUNCATE/REFERENCES/TRIGGER 권한을 확인했습니다. 적용·롤백 SQL은 이 세 권한을 명시적으로 회수합니다. 이 수정 SQL은 아직 실행하지 않았습니다.
- 백업 SQL은 SHARE 잠금으로 복사 도중 쓰기를 차단합니다. 적용 SQL은 ACCESS EXCLUSIVE 잠금 아래 원본과 백업의 ID·owner_id·제목·내용·생성시각을 양방향 EXCEPT ALL로 대조하고 불일치 시 중단합니다. 백업 존재만으로 데이터 보존을 완료 처리하지 않습니다.
- Vercel Production에는 SUPABASE_URL·SUPABASE_SECRET_KEY가 있으나 SUPABASE_PUBLISHABLE_KEY는 없습니다. 공개 키 등록은 승인 후 공식 설정 화면에서 직접 하며, 서버 전용 키를 공개 키로 대체하지 않습니다.
- 승인 순서: (1) 운영 외부 접근 차단 (2) 백업 SQL 실행과 4개 원본 대조 (3) 소유권 SQL 적용·백업 일치·권한 대조 (4) 합성 소유자 DB 쓰기/정리 시험 (5) 실제 A/B 로그인과 401/200/403/404 시험 (6) 쓰기 활성화 변경 (7) 선별 commit·push·배포 (8) 운영 재시험·새 commit으로 번들 생성·내용 검수·제출. 자동 배포를 일으킬 수 있는 push도 별도 승인 대상입니다.
- scripts/db-integration.mjs의 A/B/심판은 가상 검증기를 사용하므로 실제 JWT 로그인 시험을 대신하지 않습니다. 실제 계정 A 로그인은 자기 메모 GET 200, B는 A ID의 GET/PATCH/DELETE 404, 위조·만료·무토큰은 401이어야 합니다. 쓰기 비활성 단계의 인증된 POST/PATCH/DELETE는 403이어야 합니다.
- 원본 계약 근거: ChoiTimo/aleph-defense-starter 커밋 2cd777b452525b95e29f12f2c76d9190a594ec23의 src/verify-login.mjs는 심판 aud를 publicAppUrl의 hostname으로 검증합니다. 현행 검증 코드의 LF 정규화 Git blob은 원본 784ec5af7067e01c6b7f83cf423db0b8c63d9e09와 일치합니다. 실제 심판 발급 토큰과 공식 채점표는 미확보이므로 채점 PASS/100점을 보장하지 않습니다.
- 현재 운영 무토큰 GET /api/notes=200, /data.json=404, /auth-config.json=404, /aleph.json=step 2/af1740b입니다. nosniff는 있으나 framing 헤더는 운영에 아직 없습니다. 로컬 코드는 인증 차단·framing 헤더가 준비되어 있으며 배포 전에는 운영 취약점 해결로 표시하지 않습니다.
