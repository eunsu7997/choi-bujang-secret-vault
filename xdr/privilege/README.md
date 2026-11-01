# 보너스 xdr-05 · 권한 가로채기를 잡아 냅니다

Wazuh 모양의 수업용 경보를 검사하여 기존 ZTNA 판정기에 임시 거부 검사를 더하는 부품입니다. 실제 계정의 Windows 관리자 권한을 제거하거나 외부 엔진 세션을 직접 취소하는 코드는 아닙니다.

- `read-alerts.mjs`: 시각·출발 주소·계정·규칙 수준·설명 다섯 필드만 JSON 한 줄로 출력합니다. 원본 26건과 출력 26줄이 일치합니다. 자유 입력에 비밀값 형태가 있으면 가리며 원본을 변경하지 않습니다.
- `patterns.json`: 패턴마다 이름·조건·근거 한 줄과 MITRE 공식 출처가 있습니다. T1068(취약점 악용 승격)·T1078(기존 계정 악용)을 구분하며 관리자 그룹 조작은 T1098로 보강합니다. 일반적인 승격 경보만으로 취약점 악용이나 토큰 탈취 성공을 단정하지 않습니다.
- `decide.mjs`: 맨 위에 동일한 패턴 상수를 갖고 동기 함수 `decide(alert)` 하나만 내보냅니다. 다른 파일·패키지·시계·네트워크·파일 입출력에 의존하지 않습니다. 확신도 0.85 이상은 block, 0.5 이상은 alert, 나머지는 record이며 이유는 고정된 패턴 이름 한 줄입니다. 수치는 이 연습의 정책값입니다.
- 명확한 관리자 그룹 변경이나 권한 실행에 독립적인 이상 문맥이 겹칠 때 차단합니다. 수준이나 MITRE 표지, 시간 외 활동만으로는 차단하지 않습니다. 실패·취소는 알림, 읽기·변경 없음은 기록입니다. 승인된 변경 설명은 차단하지 않고 알림으로 검토합니다. 평소 로그인과 무관한 이벤트는 기록합니다.
- `respond.mjs`: 공통 저장기 `../respond-core.mjs`를 통해 판단을 다시 계산하고 block 후보에만 출발 주소와 계정 지문으로 범위를 제한한 임시 거부 규칙을 만듭니다. 계정 원문·설명·비밀값은 상태와 로그에 저장하지 않습니다. 로그는 `xdr/alerts.log`, 기본 상태는 `xdr/state/privilege-scoped-deny.json`이며 둘 다 Git 제외 대상입니다.

## 재실행

`aleph-stage12` 폴더의 터미널에서 실행합니다. 웹 화면에서 누를 버튼은 없습니다.

```powershell
node xdr/privilege/read-alerts.mjs
npm run xdr:run -- privilege
node xdr/privilege/respond.mjs --fixture
node --test test/privilege.test.mjs
```

로컬 제공 경보 결과는 **block 9 · alert 6 · record 11**입니다. 명확한 공격 9건을 거부하고 알림 6건·기록 11건을 허용했습니다. 수동 검토한 정상 이벤트의 오차단은 0건입니다. 변경이 없는 조회 두 건(pv-13·pv-17)도 record이므로 숫자를 억지로 균등하게 맞추지 않습니다. 이 검토 기대치는 시험에서만 쓰며 판단 모듈은 경보 번호로 분류하지 않습니다.

`--fixture`는 과거 경보 시각의 가상 시계와 `artifacts/privilege-replay-*/`의 격리 상태로 연결을 재연하고 `verification.json`을 갱신합니다. 정상 출발 주소/계정 요청 통과, 같은 IP의 다른 계정 26건 통과, 만료 후 공격 요청 9건의 추가 거부 해제를 확인합니다. 재연 로그는 기본 `xdr/alerts.log`에 쌓이며 운영 상태는 바꾸지 않습니다. 전용 시험은 읽기·가림·정상/공격·부정문·필수 정보·단독 실행·원본 보존·중복·만료·보호 주소·기존 거부/추가 인증 보존을 확인합니다.

## 판정기 연결과 제한

```js
import { createResponder } from './xdr/privilege/respond.mjs';
const responder = createResponder();
await responder.respond(verifiedCollectorAlert);
const gate = responder.wrapDecider(existingDecide);
const result = await gate(engineRequest, {
  sourceIp: verifiedSourceIp,
  account: verifiedAccountMapping,
});
```

인증된 수집기의 경보와 서버/엔진이 직접 확인한 출발 주소·계정 매핑만 사용합니다. 브라우저 헤더를 그대로 믿지 않습니다. 기존 판정기의 deny·step_up를 우선하며 allow인 경우에만 추가 거부를 검사합니다. 기존 다섯 응답 항목을 유지하고 추가 규칙 ID는 `xdr_privilege`, 거부 이유는 `xdr_privilege_blocked`입니다. 판단 파일과 기존 판정 규칙은 서로 불러오지 않습니다.

기본 만료는 경보 발생 시각 + 5분이며 설정은 1초~15분입니다. 오래된 경보·5초를 넘는 미래 경보·보호 주소·루프백 등은 규칙을 만들지 않습니다. 같은 경보 재전송으로 만료를 현재 시각 기준으로 연장하지 않습니다. 근거 경보 ID와 만료 시각을 보존합니다. 같은 IP의 다른 계정은 허용하며 해당 출발 주소/계정에만 추가 거부를 적용합니다. 계정 전체의 모든 IP 세션을 회수하는 구현은 아닙니다.

공식 `aleph.decision.v1` 요청에는 출발 IP와 Wazuh 계정 매핑이 없으므로 새 요청 필드를 만들지 않습니다. 실제 운영에는 엔진의 검증된 매핑 연결과 규칙/이유 코드 등록이 필요합니다. 파일 저장기는 단일 프로세스용입니다. 이 저장점은 로컬 재연 검증까지이며 외부 엔진 연결·배포·공식 심판 제출·점수 확인은 미실행입니다.

## 근거

- [MITRE T1068: Exploitation for Privilege Escalation](https://attack.mitre.org/techniques/T1068/)
- [MITRE T1078: Valid Accounts](https://attack.mitre.org/techniques/T1078/)
- [MITRE T1098: Account Manipulation](https://attack.mitre.org/techniques/T1098/)
