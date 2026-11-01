# 보너스 xdr-04 · 몰래 심어진 프로그램 탐지

제공 엔진은 **ALEPH SDP 엔진**이며, 이 폴더는 학생이 만든 추가 탐지·격리 부품입니다. 기존 `src/decider.mjs`의 기기 등록·구역·추가 인증 규칙과 12단계 제출 코드는 변경하지 않습니다.

## 재현

```sh
npm ci
node xdr/persistence/read-alerts.mjs
npm run xdr:run -- persistence
node xdr/persistence/respond.mjs --fixture
node --test test/persistence.test.mjs
```

읽기는 원본 24건을 수정하지 않고 시각·출발 주소·계정·규칙 수준·설명만 24줄로 출력합니다. 비밀값처럼 보이는 자유 입력은 가립니다. 판단 파일은 읽기 모듈을 가져오지 않습니다.

`decide.mjs`는 `patterns.json`의 상수를 내부에 두고 `decide(alert)`만 내보냅니다. import·파일 입출력·네트워크·호출 간 상태가 없습니다. 반환은 `{action, confidence, reason}`이며 확신도 0.85 이상 block, 0.5 이상 alert, 나머지 record입니다. reason에는 정적인 패턴 이름만 쓰며 원문·계정·비밀값을 넣지 않습니다.

가상 경보 결과는 **block 8 · alert 8 · record 8**, 의미를 검토한 정상 이벤트 8건의 차단은 **0건**입니다. `result.json`에는 실제 모듈 실행 결과만 기록합니다. 공식 심판 점수는 별도입니다.

## 패턴과 근거

- 새 서비스·실행 파일 변경: 서명 없음과 임시 경로 또는 반복 원격 등록을 함께 확인합니다. 평소 목록에 없는 임시 경로 서비스의 재부팅 후 지속 실행 등록도 탐지합니다. 근거: [MITRE T1543](https://attack.mitre.org/techniques/T1543/).
- 예약 작업: 임시 실행 경로에 시간 외 실행·임의 이름·시작 프로그램 중복이라는 추가 근거가 겹칠 때 차단 후보입니다. 근거: [MITRE T1053](https://attack.mitre.org/techniques/T1053/).
- 시작 폴더: 평소 목록에 없는 새 항목과 실제 Startup 경로를 함께 확인합니다. 이 신호의 정확한 근거는 [MITRE T1547.001](https://attack.mitre.org/techniques/T1547/001/)입니다.
- 서명 확인 전·작은 변경·서비스 재시작은 알림으로 두고, 정상 서명된 기존 서비스·목록 읽기·기존 작업 완료는 기록합니다. 높은 경보 수준만으로 차단하지 않습니다.

수준 10·반복 3회 등의 수치와 확신도는 학습 정책값이며 MITRE가 정한 임계값이나 통계적 확률이 아닙니다. 현재 fixture의 설명에 있는 서명·평소 목록·변경 근거를 읽습니다. 실제 PC 파일이나 서명을 직접 검사한 결과가 아니므로 운영 수집기는 인증된 Wazuh 데이터와 승인된 기준 목록을 확인해야 합니다.

## 격리 연결

```js
import { createResponder } from './xdr/persistence/respond.mjs';
import { decide } from './src/decider.mjs';

const xdr = createResponder();
const guardedDecide = xdr.wrapDecider(decide);

// 인증된 수집기에서 Wazuh 에이전트 → 엔진 기기 ID 매핑을 검증한 뒤 전달합니다.
await xdr.respond(trustedAlert, { deviceId: mappedEngineDeviceId });
// 엔진이 신원·기기·경로를 검증한 공식 18개 항목 요청입니다.
const result = await guardedDecide(engineRequest);
```

기기 ID는 계약에 있는 16자리 소문자 16진수입니다. IP·계정·에이전트 표시 이름을 기기 ID로 추측하지 않습니다. 매핑이 없으면 `missing_device_mapping`으로 기록하고 격리하지 않습니다. 매핑은 사용자 요청·헤더에서 받아서는 안 됩니다.

격리는 **해당 기기 전체**에 적용합니다. 같은 PC에서 계정이 바뀌어도 유지하고 다른 기기는 허용합니다. 기존 deny/step_up은 그대로 유지하며 allow인 경우에만 추가 검사합니다. `RULE_IDS`는 기존 규칙에 `xdr_persistence`를 더한 목록이고 새 reasonCode는 `xdr_persistence_blocked`입니다. 실제 운영에는 외부 엔진의 새 규칙·이유 코드 등록, 인증된 경보 전달, 에이전트-기기 매핑이 필요합니다. 이 저장소에는 해당 운영 설정 API가 없어 **로컬 연결 재연까지 검증했으며 운영 격리 완료는 아닙니다.**

규칙은 경보 시각부터 기본 5분 뒤 만료합니다(설정 가능 범위 1초~15분). 근거 경보 ID와 만료 시각을 저장하고, 원본 기기 ID는 해시로 보관합니다. 같은 경보 재전송으로 현재 시각부터 만료를 연장하지 않습니다. 오래된 경보·5초 넘게 미래인 경보·보호 기기는 설치하지 않습니다. 실제 운영 시 경보 시계를 동기화해야 합니다. 만료는 악성 파일 삭제나 복구를 뜻하지 않으므로 추가 경보·현장 조사로 격리 연장을 결정해야 합니다.

`xdr/alerts.log`에는 경보 ID·판단·설치 여부를 JSON 한 줄로 추가합니다. 원문 설명·계정·경로·주소·기기 ID·비밀값은 로그에 없습니다. 상태 파일은 `xdr/state/persistence-deny.json`이며 로그와 함께 Git에서 제외합니다. 파일 저장기는 단일 프로세스용이고 동시 호출을 직렬화합니다. 여러 서버 간 운영 격리에는 공유 저장소가 필요합니다. 손상된 파일은 덮어쓰지 않습니다.

## 시험의 범위와 중지

제공 경보의 `agent.name`은 전부 같은 설명용 이름입니다. `--fixture`는 각 경보를 **독립된 시나리오**로 두고 별도 가상 기기를 명시적으로 매핑합니다. 과거 경보 시각을 재연하고 `artifacts/persistence-replay-*`에만 규칙을 만듭니다. 공격 거부 8건·다른 사건 허용 16건·무관한 기기 허용 24건·정상 이벤트 차단 0건을 확인합니다. 이미 격리된 감염 PC에서 정상 이벤트가 발생했다고 즉시 격리를 해제하는 시험이 아닙니다.

전용 테스트는 같은 기기의 계정 변경·다른 기기 허용·중복·만료·오래된/미래 경보·보호 기기·동시 저장·비밀값 가림·파일 손상을 추가 검증합니다. `decide.mjs`만 격리된 JavaScript 환경에서 실행해 외부 의존성이 없는지도 검사합니다.

중지하려면 인증된 경보의 `respond` 호출을 중단하고 엔진 연결 함수를 기존 `decide`로 되돌립니다. 복구는 별도 사본에서 위 명령을 검증한 뒤 다시 연결합니다. 기존 판정기·다른 보너스 작업·DB·원본 경보는 삭제하지 않습니다.
