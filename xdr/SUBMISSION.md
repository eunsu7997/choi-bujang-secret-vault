# XDR 보너스 제출 안내

각 과제의 다음 두 입력란에는 같은 주소를 사용합니다.

| 입력란 | 값 |
|---|---|
| 내 배포 주소 | https://choi-bujang-secret-vault-livid.vercel.app/ |
| 내 GitHub 저장소 주소 | https://github.com/eunsu7997/choi-bujang-secret-vault |

저장소 기본 브랜치는 `main`이며 공개 저장소입니다. 과제별 판단 파일은 다음 위치에 있습니다.

| 과제 | moduleKey | 판단 파일 |
|---|---|---|
| 무차별 로그인 | brute-force | [decide.mjs](brute-force/decide.mjs) |
| 웹 입력 조작 | web-injection | [decide.mjs](web-injection/decide.mjs) |
| 알려진 취약점 | known-cve | [decide.mjs](known-cve/decide.mjs) |
| 몰래 심은 프로그램 | persistence | [decide.mjs](persistence/decide.mjs) |
| 권한 가로채기 | privilege | [decide.mjs](privilege/decide.mjs) |
| 자료 빼돌리기 | exfiltration | [decide.mjs](exfiltration/decide.mjs) |

재현은 `npm ci` → `npm run xdr:all` → `npm run test:xdr` 순서입니다. 개별 과제는 `npm run xdr:run -- <moduleKey>`로 실행합니다. 심판이 읽는 각 `decide.mjs`는 다른 파일·패키지·네트워크를 사용하지 않습니다. `confidence` 범위는 0~1이며 0.85 이상 block, 0.5 이상 alert, 그 아래 record입니다.

최신 가상 경보 결과는 [summary.json](summary.json), 검수 근거는 [verification.json](verification.json), 연결 방식과 제한은 [README.md](README.md)에 있습니다. `result.json`만으로 공식 통과를 확정하지 않으며, 심판이 판단 파일을 다시 실행합니다. 실제 엔진의 추가 규칙 등록·접속 정보 매핑은 별도 작업이고 이 저장소의 로컬 연결 시험과 구분합니다.

여섯 과제의 “심판에게 제출하기” 버튼은 과제마다 각각 누릅니다. 이 안내나 GitHub 업로드만으로 접수가 완료되지는 않습니다. 기존 12단계 제출 JSON은 보너스 결과 파일을 대신하지 않으며, 이미 통과한 단계의 설정·판정 규칙은 이 보너스 때문에 바꾸지 않습니다.
