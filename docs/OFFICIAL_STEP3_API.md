# 공식 3단계 API 계약 수정 후보

근거: PM이 제공한 공식 「진짜 로그인을 붙입니다」 카드 원문 요약과 후속 확인. 출처 https://aleph-omega.vercel.app/defense → 2차 침공 3단계 → 만들기 3. 포털 본문은 직접 접근 시 로그인이 필요하므로 PM 제공문에 의존한다.

| 명시된 요구 | 후보 구현·시험 |
|---|---|
| 로그인 사용자의 목록 배열 | GET /api/notes, 직접 배열 |
| POST {id,title,body}, id 선택 UUID, 생략 시 서버 생성, {id} 반환 | createFields 및 실제 서명 검증기를 통한 가상 저장소 계약 시험 |
| 개별 GET {id,title,body} | GET /api/notes/:id, 소유권 필터 |
| PUT 수정, DELETE 삭제 후 GET404 | PUT/DELETE /api/notes/:id, A/B 404·삭제 후404 시험 |
| 무로그인 거부 | 401 JSON, 저장소 접근 전 거부 |

## 공식 원문에 미명시된 구현 선택

- 개별 경로의 id 표기가 제공문에서 보이지 않아 기존 API 아래 `/api/notes/:id`로 구현했다. `?id=`는 내부 Vercel rewrite 및 이전 호환용으로 유지한다. 서로 다른 path/query id는 거부한다.
- POST201 + {id}, PUT 입력 {title,body} 두 필드 필수 및 성공200 + {id,title,body}, DELETE204/빈 본문은 PM이 허용한 REST 기본 설계이며 공식 확정 상태코드가 아니다.
- 중복 UUID는 소유자와 무관하게409 NOTE_ID_CONFLICT이며 덮어쓰지 않는다. 전역 UUID 충돌 응답은 ID 사용 여부를 추론할 수 있으나 소유자·내용을 반환하지 않는다.
- 잘못된 UUID·소유자 필드 주입·content 외부 입력·경로 충돌400, PATCH405. 기존 목록 최대50건 제한 유지.

## 검증 범위와 보존

로컬 회귀85PASS/0FAIL/1SKIP. 새 API는 가상 DB·로컬 시험용 서명 키로 검증했다. 실제 운영3a3c7a2의 이전 A/B·자연만료 JWT401 증거는 보존하되 새 형식 운영 실증으로 주장하지 않는다. SKIP은 배포 사본에 없는 로컬 시드 대조다.

verify-login.mjs, AGENTS.md, scripts/bundle.mjs 및 SQL은 변경하지 않았다. 학생/심판 소유권, 심판 쓰기403, UI 계정전환 보호·textContent, 서버키 분리를 유지했다. 실제 DB에 접속하거나 기존4개·백업4개를 변경하지 않았다. 현재 보존 여부는 이전 읽기 증거이며 이번 DB 재조회는 미실행이다.

## 배포 승인 후 순서

1. 후보 커밋·선별 파일 검수 후 push/배포 승인. 현재는 로컬 후보만 준비하며 자동배포를 유발하는 push 금지.
2. Vercel의 canonical path rewrite와 allowedRoutes 실제 호환성 확인. /aleph.json이 후보 커밋을 가리키는지 확인.
3. PM 직접 로그인 A/B로 새 body 형식 CRUD·선택 UUID·A200/B GET PUT DELETE404·무로그인401·삭제후404 실증. 시험용 ID만 정리하고 원본/백업4개를 읽기 비교.
4. 실패 시 인증된 안전 배포3a3c7a2 또는 학생 쓰기 차단으로 복구. DB/백업 및 인증 계약은 변경하지 않는다.
5. 최신 운영 대상 attack-check와 bundle 재생성. 후보와 현재 운영 커밋이 다르면 제출 불가.
6. 심판 공식 JWT·쓰기 요구와 포털 접수 형식은 미검증으로 유지. 임의 권한 활성화 금지. 최종 제출은 별도 승인.

실행: `node --test --test-reporter=tap test/*.test.mjs`
승인 후 화면에서는 로그인 → 메모 추가 → 편집 → 삭제를 확인한다. 정상은 본인 CRUD 성공, 거부는 비로그인401·타인404·심판쓰기403이다.
