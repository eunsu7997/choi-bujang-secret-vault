# 보너스 xdr-06 · 자료 빼돌리기를 잡아 냅니다

이 저장소 루트(`aleph-stage12`)에서 실행합니다.

```powershell
node xdr/exfiltration/read-alerts.mjs
npm run xdr:run -- exfiltration
node xdr/exfiltration/respond.mjs --fixture
node --test test/exfiltration.test.mjs
```

읽기는 경보 30건에서 시각·출발 주소·계정·수준·설명 다섯 항목만 30줄로 출력합니다. 자유 입력에 인증값·비밀값·URL·긴 토큰 형태가 있으면 필드 전체를 가립니다. 원문·헤더·추가 data 필드는 출력하지 않습니다.

`patterns.json`은 [MITRE T1041](https://attack.mitre.org/techniques/T1041/)의 기존 명령 제어 통로 반출과 [T1048](https://attack.mitre.org/techniques/T1048/)의 다른 프로토콜 반출을 근거로 합니다. 경보만으로 프로토콜이 확인되지 않으면 기법을 확정하지 않고 비정상 전송 정황으로 분류합니다. 신규 목적지·업무 시간 밖 압축 전송·반복 전송은 수업용 탐지 신호이며, 50MB·반복 5회·수준 10은 MITRE 기준이 아닌 로컬 보수적 정책입니다.

`decide.mjs`는 JSON 패턴을 맨 위 상수로 복사하고 `decide(alert)` 하나만 내보냅니다. 다른 파일·패키지·네트워크·파일 시스템 없이 계산하며 입력을 바꾸거나 경보 사이에 상태를 공유하지 않습니다. 0.85 이상 block, 0.5 이상 alert, 나머지 record입니다. 크기·수준·기법 태그 하나만으로는 차단하지 않습니다.

제공 가상 경보의 로컬 검토 결과: **block 10 · alert 10 · record 10**, 검토한 정상 경보 10건의 block은 **0건**입니다. `result.json`은 판단 결과이며 공식 심판 점수가 아닙니다.

## 추가 거부 연결

`respond.mjs`는 명확한 차단 후보만 `xdr/state/exfiltration-destination-deny.json`의 별도 거부 규칙으로 저장합니다. 기존 `src/decider.mjs`의 규칙은 수정하지 않습니다. 출발 IP·계정 지문·목적지 IP가 모두 일치할 때만 추가 거부하므로 같은 사용자의 다른 목적지와 같은 IP의 다른 계정은 통과합니다. 기존 거부와 추가 인증 판단은 우선 보존합니다.

규칙에 근거 경보 번호·발생 시각·만료 시각을 붙입니다. 기본 5분, 최대 15분이며 경보 발생 시각부터 계산해 오래된 경보 재전송으로 차단을 연장하지 않습니다. 보호 출발지·계정 없는 경보·잘못된 주소·너무 오래되거나 미래인 경보는 설치하지 않습니다. 모든 판단은 `xdr/alerts.log`에 한 줄씩 쌓고, 원문·계정·비밀값은 로그에 쓰지 않습니다. 상태·로그·재연 산출물은 Git에서 제외합니다.

```js
import { createResponder } from './xdr/exfiltration/respond.mjs';

const responder = createResponder({ protectedSources: [] });
await responder.respond(verifiedCollectorAlert);
const decideRequest = responder.wrapDecider();
const result = await decideRequest(engineRequest, {
  sourceIp: verifiedSourceIp,
  account: verifiedAccountMapping,
  destinationIp: verifiedDestinationIp,
});
```

연결부는 서버가 확인한 수집기 경보와 요청의 출발지·계정·실제 목적지를 받아야 합니다. 브라우저 헤더나 요청 본문을 신뢰해 이 값을 채우지 않습니다. 공식 판정 요청 18항목은 바꾸지 않습니다. 운영 엔진이 이 매핑을 전달하고 `xdr_exfiltration_blocked` 이유 코드를 등록해야 운영 연결이 가능합니다. 기존의 전체 XDR 연결 초안(`xdr/gate.mjs`)과 별도로 위 반출 전용 연결부를 사용합니다. 실제 운영 엔진 연결·배포·심판 제출은 미실행입니다. 파일 저장기는 단일 프로세스용이며 서버리스 영속 저장기는 별도 연결이 필요합니다.

`--fixture`는 원본 시각과 `artifacts/xdr-exfiltration-*/`의 격리 규칙 파일로 재연합니다. 공격 거부 10건, 비차단 사건 요청 허용 20건, 다른 목적지 허용 30건, 다른 계정 허용 30건, 만료 후 허용 30건을 확인합니다. 운영 상태 파일에는 쓰지 않습니다.

화면에서는 추가 버튼을 만들지 않습니다. 터미널에서 위 명령을 실행해 `result.json`의 counts와 재연 요약을 확인하세요. 정상 목적지는 allow, 명확한 공격의 동일 목적지는 deny, 애매한 경보는 alert만 기록되어야 합니다.
