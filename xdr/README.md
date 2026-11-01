# XDR 보너스 경보

이 폴더는 보너스 여섯 개의 연습 경보입니다. 경보는 수업용으로 만든 Wazuh 모양이며, 실제 로그가 아닙니다. 정답은 이 저장소에 없습니다.

## 경보 묶음

`xdr/fixtures/<moduleKey>.json` 을 읽습니다. `moduleKey` 는 아래 여섯 개입니다.

| moduleKey | 보는 것 |
|---|---|
| `brute-force` | 짧은 시간에 몰린 로그인 실패 |
| `web-injection` | 웹 요청에 섞인 주입 형태 |
| `known-cve` | 이미 공개된 취약점을 노린 요청 형태 |
| `persistence` | 다시 켜도 남도록 심긴 서비스·예약 작업 |
| `privilege` | 평범한 계정의 갑작스러운 권한 상승 |
| `exfiltration` | 처음 보는 곳으로 빠지는 큰 전송 |

한 파일에는 명확한 공격, 애매한 시도, 정상 이벤트가 함께 들어 있습니다. 주소는 문서용 대역만 쓰고, 계정은 `user01` 같은 가상 이름입니다. `known-cve` 의 원격 조회 구문은 문서용 표기입니다. 그 문자열을 다른 시스템에 넣거나 변형하지 않습니다.

## 학생이 만드는 파일

항목마다 `xdr/<moduleKey>/decide.mjs` 를 만듭니다. `decide(alert)` 를 내보냅니다. 비동기 함수여도 됩니다. 반환은 아래 세 값입니다.

- `action`: `block`, `alert`, `record` 중 하나
- `confidence`: 0 이상 1 이하 숫자
- `reason`: 짧은 이유

명확한 공격은 `block`, 애매한 시도는 `alert`, 정상 이벤트는 `record` 입니다. 경보 원본은 고치지 않습니다.

## 실행

저장소 루트에서 항목 키 하나를 넣습니다.

```
node scripts/xdr-run.mjs brute-force
```

`npm run xdr:run -- brute-force` 도 같은 명령입니다. 실행기는 해당 경보마다 `decide` 를 부르고, 결과를 `xdr/<moduleKey>/result.json` 에 씁니다. 형식은 `aleph.xdr.result.v1` 이고, `decisions` 에는 경보 id·행동·확신도·이유가, `counts` 에는 `block`·`alert`·`record` 건수가 있습니다.

반환 형식이 틀린 경보는 `record` 로 남고, 오류 한 줄이 출력됩니다. 실행기 자체는 네트워크를 쓰지 않습니다. 판정자는 격리된 환경에서 같은 명령을 다시 실행해 결과를 봅니다. 이미 커밋된 `result.json` 만으로 판정이 끝나지 않습니다.

## 심판 격리 환경에서 지킬 것

심판은 인터넷 없이 `decide.mjs` 한 파일을 불러와 경보마다 바로 답을 받습니다. 이 파일이 돌지 못하면 건수를 셀 수 없어 `XDR_DECIDE_NOT_RUNNING` 으로 끝납니다.

- `decide.mjs` 에는 `import` 문을 두지 않습니다. 필요한 패턴은 `patterns.json` 에서 파일 맨 위 상수로 옮겨 적습니다.
- 파일을 읽거나 쓰지 않고, 바깥에 묻지 않고, 그 파일 안에서 혼자 계산해 답합니다. 경보 하나에 2초 안에 답합니다.
- `confidence`(확신도)는 경보가 패턴과 얼마나 뚜렷하게 맞는지를 `decide` 가 스스로 0~1 로 매긴 값입니다.
- `xdr/alerts.log` 기록과 판정기 연결은 `respond.mjs` 같은 다른 파일에서 합니다. `decide.mjs` 는 판단 결과만 돌려줍니다.

인터넷을 끈 상태에서 `npm run xdr:run -- <moduleKey>` 를 돌려도 같은 결과가 나오면 심판에서도 같은 결과가 나옵니다.

## 여섯 모듈 전체 실행·재연

`npm run xdr:all`은 여섯 개의 `result.json`과 `xdr/summary.json`을 갱신하고, 가상 시각으로 격리된 연결 시험을 실행합니다. 각 과제의 경보는 별도 시나리오로 재연합니다. 실제 운영 규칙 폴더에는 쓰지 않고 `artifacts/xdr-suite-*/`에 상태와 재연 보고서를 남깁니다. `xdr/alerts.log`는 원문·계정·인증값 없이 모듈·경보 번호·판정·적용 여부를 한 줄씩 기록합니다. 로그·차단 상태는 Git에서 제외합니다.

`npm run test:xdr`은 제공 경보의 수동 검토 기대치, 비밀값 가림, 원본 보존, 입력 변형, 외부 기능 없는 격리 실행, 만료·중복·보호 주소·같은 IP의 다른 계정·기존 거부/추가 확인 보존을 검증합니다. 이는 로컬 가상 경보 시험이며 공식 채점 결과가 아닙니다. 수업명만으로 차단하지 않으며, 센서의 T1190 분류만 있을 때는 검토 알림만 남깁니다. 임계 횟수·전송량·수준은 이 연습의 보수적 정책값이며 MITRE가 정한 임계값이 아닙니다.

## 추가 판정 연결

`xdr/gate.mjs`의 `createXdrGate()`는 기존 `src/decider.mjs`를 먼저 실행하고, 허용된 요청에만 여섯 모듈의 추가 거부를 검사합니다. 알려진 취약점·기기 격리·반출은 각 전용 `respond.mjs`를 조합하며, 웹 주입 등은 `respond-core.mjs`의 저장기를 사용합니다. 판단 파일은 독립적으로 실행되고 이 연결부를 읽지 않습니다.

```js
import { createXdrGate } from './xdr/gate.mjs';
const gate = await createXdrGate({ protectedSources: [] });
// 인증된 수집기에서 받은 경보에만 적용합니다. HTTP 입력을 경보로 직접 신뢰하지 않습니다.
await gate.respond('web-injection', verifiedCollectorAlert);
// trustedContext는 서버/엔진이 확인한 값입니다. 브라우저 헤더를 그대로 넣지 않습니다.
const result = await gate.decideRequest(engineRequest, {
  sourceIp: verifiedSourceIp,
  account: verifiedAccountMapping,
  destinationIp: verifiedDestinationIp, // 자료 반출 검사용. 서버가 확인한 실제 목적지.
  requestEvidence: verifiedRequestEvidence, // 이번 requestId·srcip와 요청 인자/헤더. 알려진 취약점 연결용.
});
// 지속 실행 경보는 수집기 agent와 엔진 deviceId의 검증된 매핑도 필요합니다.
await gate.respond('persistence', verifiedPersistenceAlert, { deviceId: verifiedDeviceId });
```

기본 TTL은 5분이고 최대 15분입니다. 만료 기준은 경보 발생 시각이므로 과거 경보 재전송으로 차단이 연장되지 않습니다. 계정이 확인된 경보는 출발 IP와 계정 지문을 함께 제한하여 같은 IP의 다른 계정에 영향을 줄입니다. 웹처럼 계정 없는 공격은 출발 IP에만 적용되므로 공유 주소를 보호해야 할 때 `protectedSources`에 명시합니다. 알려진 취약점은 해당 모듈의 요청 지문 연결부를 재사용하므로 같은 IP의 깨끗한 요청은 통과합니다. `requestEvidence`는 서버가 이번 요청에서 확인한 `requestId`, `srcip` 및 요청 인자·헤더이며, 값이나 원문은 로그에 넣지 않습니다. 파일 저장기는 한 프로세스 안에서 쓰기를 직렬화하며 여러 프로세스가 같은 상태 파일을 공유하는 운영 용도는 지원하지 않습니다.

**운영 연결은 미적용입니다.** 공식 요청 계약에는 출발 IP와 경보 계정 매핑이 없으므로 새 요청 필드를 만들지 않았습니다. 엔진 운영자가 검증된 IP·계정 매핑을 별도 연결 인자로 제공하고, `xdr_<module_key>_blocked` 이유 코드를 등록해야 실제 엔진에 연결할 수 있습니다. 서버리스 환경에서는 영속 상태 저장기도 필요합니다. 기존 기기·구역·추가 인증 규칙, 로그인 설정, DB 및 배포는 변경하지 않습니다.

웹 패턴은 [MITRE T1190](https://attack.mitre.org/techniques/T1190/)과 [CWE-89](https://cwe.mitre.org/data/definitions/89.html)·[79](https://cwe.mitre.org/data/definitions/79.html)·[22](https://cwe.mitre.org/data/definitions/22.html)·[78](https://cwe.mitre.org/data/definitions/78.html)에 근거합니다. 지속 실행은 [T1543](https://attack.mitre.org/techniques/T1543/)·[T1053](https://attack.mitre.org/techniques/T1053/)·[T1547.001](https://attack.mitre.org/techniques/T1547/001/), 권한 변경은 [T1068](https://attack.mitre.org/techniques/T1068/)·[T1078](https://attack.mitre.org/techniques/T1078/)·[T1098](https://attack.mitre.org/techniques/T1098/), 반출은 [T1041](https://attack.mitre.org/techniques/T1041/)·[T1048](https://attack.mitre.org/techniques/T1048/)에 연결했습니다. 권한 변경 경보만으로 취약점 악용·계정 탈취 성공을 확정하지 않습니다.
