# 무차별 로그인 공격 탐지 · xdr-01

제공 엔진은 **ALEPH SDP 엔진**입니다. 이 디렉터리는 학생이 만든 추가 판단·연결 부품이며 기존 `src/decider.mjs`의 규칙을 대체하지 않습니다. 모든 시험 경보는 제공된 가상 자료입니다.

## 구성과 재현

```sh
npm ci
node xdr/brute-force/read-alerts.mjs
npm run xdr:run -- brute-force
node xdr/brute-force/respond.mjs --fixture
node --test test/xdr-brute-force.test.mjs
```

- `read-alerts.mjs`: 원본 28건을 수정하지 않고 시각·주소·계정·수준·설명만 28줄로 출력합니다. 비밀값처럼 보이는 설명·계정은 가립니다. 실제 개인정보가 있는 원본은 공개 저장소에 넣지 않습니다.
- `patterns.json`: [T1110](https://attack.mitre.org/techniques/T1110/), [Password Guessing T1110.001](https://attack.mitre.org/techniques/T1110/001/), [Password Spraying T1110.003](https://attack.mitre.org/techniques/T1110/003/)을 근거로 합니다. **횟수·시간·수준·확신도 수치는 이 과제의 정책값이며 MITRE가 제시한 수치가 아닙니다.**
- `decide.mjs`: 패턴 상수를 내부에 두고 `decide(alert)`만 내보냅니다. import·파일 접근·네트워크·호출 간 누적 상태가 없습니다. `action`, `confidence`, 정적인 패턴 이름인 `reason`만 반환합니다. 계정·비밀번호·원본 설명을 reason에 복사하지 않습니다.
- `respond.mjs`: 판단을 다시 계산한 뒤 명확한 후보에만 임시 거부 규칙을 저장하고 `xdr/alerts.log`에 JSON 한 줄을 추가합니다. 로그에는 계정·원문·비밀번호·원본 IP가 없으며 출발 주소는 해시로 남깁니다. 런타임 파일은 Git 제외입니다.
- `result.json`: `xdr:run`이 만든 제출용 순수 판단 결과입니다. block 10, alert 9, record 9. 공식 채점 결과는 아닙니다.

## 판정의 근거와 한계

Wazuh가 한 출발지의 실패들을 이미 집계한 경보의 `data.count`, `data.accounts`, `rule.level`, 인증 실패 설명을 함께 사용합니다. 현재 fixture에 시간 창·동일 비밀번호·자동화 근거가 설명으로 들어 있으므로 해당 표현을 해석합니다. 임의의 단일 실패 이벤트를 자체 누적하는 수집기는 아닙니다. 실제 Wazuh 설치에서 필드 구조가 다르면 신뢰할 수 있는 수집 단계에서 같은 집계 형태로 정규화해야 합니다.

- 5분 이내 실패 30회 이상, 또는 시간 창 미상인 고수준 상관 경보의 실패 40회 이상은 반복 추측 후보입니다.
- 같은 비밀번호라는 명시적 근거와 서로 다른 계정 8개 이상은 spraying 후보입니다. 계정 수만으로 같은 비밀번호를 추정하지 않습니다.
- 계정 15개 이상에 일정 간격으로 인증 실패를 반복하면 자동화된 계정 대입 후보입니다.
- 위 차단에는 수준 10 이상, 유효한 주소와 계정 근거도 필요합니다. 성공으로 회복된 시도, 긴 시간 창, 부족한 근거는 자동 차단하지 않습니다. 일반적인 실패 3회 이상은 알림 후보입니다.
- 확신도 0.85 이상은 block, 0.5 이상은 alert, 나머지는 record입니다. 이는 통계적으로 보정한 확률이 아니라 근거 강도를 나타내는 정책 점수입니다.

## 기존 판정기 연결

```js
import { createResponder } from './xdr/brute-force/respond.mjs';
import { decide } from './src/decider.mjs';

const xdr = createResponder({
  // 공유 프록시/NAT 등 차단하면 정상 사용자가 함께 막히는 주소는 운영자가 보호 목록으로 지정합니다.
  protectedSources: [],
});
const guardedDecide = xdr.wrapDecider(decide);

// 인증된 Wazuh 수집 경로에서만 호출합니다. 사용자 입력으로 경보를 받지 않습니다.
await xdr.respond(trustedWazuhAlert);
// IP는 엔진/서버의 신뢰 가능한 전송 계층 정보이며 사용자 헤더에서 그대로 가져오지 않습니다.
const result = await guardedDecide(engineRequest, verifiedTransportIp);
```

기존 판정 결과가 deny 또는 step_up이면 그대로 반환합니다. allow일 때만 추가 거부 규칙을 적용합니다. 요청 객체에 임의의 `ip`, `role`, `identity`, `device` 필드를 만들지 않습니다. 연결 모듈은 기존 규칙에 `xdr_brute_force`를 더한 `RULE_IDS`를 내보내며, 이 추가 거부의 reasonCode는 `xdr_brute_force_blocked`입니다. **외부 엔진은 연결 모듈과 이 추가 규칙·이유 코드를 등록하고 검증한 IP를 전달해야 합니다. 현재 ALEPH 요청 계약에는 IP가 없고 엔진 설정 API도 제공되지 않아, 여기서 확인한 범위는 기존 판정기와 연결 모듈을 함께 실행한 로컬 재연까지입니다. 운영 엔진 연결 완료를 뜻하지 않습니다.**

규칙에는 만료 시각과 근거 경보 ID가 들어갑니다. 기본 만료는 **경보 시각 + 5분**(설정 범위 1초~15분)입니다. 이미 만료됐거나 미래로 5초 이상 어긋난 경보, 루프백·멀티캐스트·보호 주소는 설치하지 않습니다. 동일 경보 재전송으로 현재 시각부터 TTL을 늘리지 않습니다. 만료되면 판정에서 즉시 무시하고 다음 경보 처리 때 정리합니다. 경보 시계는 동기화돼 있어야 합니다.

파일 저장기는 같은 프로세스의 동시 호출을 직렬화하고 임시 파일 교체로 저장합니다. 로컬의 단일 프로세스 연결용입니다. 여러 서버·Vercel 함수 간 공유 차단이 필요하면 운영 엔진의 신뢰 가능한 공용 저장소 연결이 필요합니다. state 파일의 주소·근거 ID는 관리자만 접근하도록 관리합니다. 손상된 규칙 파일은 덮어쓰지 않고 오류로 중단합니다.

## 확인·중지·복구

`respond.mjs --fixture`는 과거 시험 경보의 시각을 재연하고 `artifacts/brute-force-replay-*` 안의 별도 규칙만 사용합니다. 운영용 `xdr/state/brute-force-deny.json`에는 쓰지 않습니다. 결과는 공격 거부 10건·다른 이벤트 출발지 허용 18건·별도 정상 요청 허용 28건·정상 이벤트 차단 0건입니다. 실제 운영 IP 차단을 실행한 시험이 아닙니다.

중지하려면 경보 수집 경로의 `respond` 호출을 중지하고 엔진의 연결 함수를 기존 `decide`로 되돌립니다. 기존 판정기 규칙은 유지합니다. 복구 시 먼저 별도 사본에서 위 명령과 시험을 실행한 뒤 연결 함수를 다시 등록합니다. 오래된 경보 재생으로 운영 차단을 다시 만들지 않습니다. 원본 경보·DB·다른 보너스 파일은 삭제하지 않습니다.
