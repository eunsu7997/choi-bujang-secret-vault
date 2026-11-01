# 보너스 xdr-03 · 알려진 취약점 악용

수업용 known-cve 경보를 검사하는 부품입니다. 원본 경보와 기존 src/decider.mjs 규칙은 보존합니다.

- read-alerts.mjs: 시각·출발 주소·계정·규칙 수준·설명만 한 줄씩 출력합니다. 누락값은 null이며 비밀값으로 보이는 필드는 가립니다. 판단 모듈에서 사용하지 않습니다.
- patterns.json: 패턴별 이름·조건·근거 한 줄·공식 자료 또는 도구 제작자 출처를 적었습니다. 확신도는 출처의 점수가 아닌 이 모듈의 정책값입니다.
- decide.mjs: 동일한 패턴을 맨 위 상수로 복사했습니다. 단독 동기 함수 decide(alert)만 내보내며 다른 파일·패키지·네트워크·시계에 의존하지 않습니다. confidence ≥ 0.85는 block, ≥ 0.5는 alert, 그 아래는 record입니다. 약한 신호를 더해서 차단 수준으로 올리지 않습니다.
- respond.mjs: 독립 판단을 재확인한 차단 후보에만 추가 거부 규칙을 만듭니다. 알림·기록은 거부 규칙을 만들지 않습니다. 계정·원문 요청·원문 설명·비밀값은 상태와 로그에 저장하지 않습니다.

## 재실행

aleph-stage12 폴더의 터미널에서 실행합니다. 웹 화면에서 누를 버튼은 없습니다.

    node xdr/known-cve/read-alerts.mjs
    npm run xdr:run -- known-cve
    node xdr/known-cve/respond.mjs --fixture
    node --test test/known-cve-read-alerts.test.mjs test/known-cve.test.mjs

첫 명령은 원본 24건에 대해 JSON 24줄을 출력합니다. 두 번째는 result.json을 갱신합니다. 세 번째는 과거 경보의 시각에 맞춘 가상 시계와 artifacts/ 아래 격리된 상태 파일을 쓰고 verification.json을 갱신하며 xdr/alerts.log에 모듈명이 있는 JSON 한 줄씩을 추가합니다. 운영 상태 파일은 바꾸지 않습니다.

확인한 결과는 block 8 · alert 8 · record 8입니다. 재연에서 공격 8건 거부, 애매한 8건과 정상 8건 통과, 정상 차단 0건, 같은 출발 주소의 정상 요청 24건 통과, 만료 뒤 공격 요청 8건의 추가 거부 해제를 확인했습니다. 이 수치는 로컬 가상 경보 검증이며 공식 심판 판정이나 실제 운영 공격 차단 실적이 아닙니다.

## 기존 판정기에 추가하는 연결

respond.mjs의 createResponder()가 respond(alert, result)와 wrapDecider(existingDecide)를 제공합니다. result를 넘겨도 원본 경보를 다시 판단하므로 임의의 block 표지만으로 규칙을 만들 수 없습니다. 기본 상태 파일은 xdr/state/known-cve-deny.json, 로그는 xdr/alerts.log입니다. 상태와 로그는 Git에서 제외합니다.

서버에서 Wazuh 경보를 수신할 때 respond(alert, decide(alert))를 호출합니다. 접속 판정 시 wrapDecider()로 감싼 함수를 호출합니다.

    const responder = createResponder();
    await responder.respond(alert, decide(alert));
    const gate = responder.wrapDecider(existingDecide);
    const response = await gate(request, trustedEvidence);

trustedEvidence는 서버/엔진이 해당 접속에서 직접 확인한 증거입니다. requestId는 이번 request.requestId와 같고, srcip와 useragent/headers/url/query/args/params는 경보의 data와 같은 형식입니다. 클라이언트가 보낸 증거 객체나 X-Forwarded-For를 그대로 신뢰하면 안 됩니다. 이 증거는 판정기 요청 객체에 새 필드로 덧붙이지 않습니다.

기존 판정기의 deny·step_up는 그대로 반환합니다. 기존 판정기가 allow일 때만 추가 거부를 확인하며 출발 주소 지문과 공격 요청 지문이 모두 일치해야 거부합니다. 같은 IP의 다른 정상 요청이나 계정을 통째로 차단하지 않습니다. 거부 응답은 기존 다섯 항목을 유지하며 추가 ruleId는 xdr_known_cve, reasonCode는 xdr_known_cve_blocked입니다.

현재 aleph.decision.v1의 18개 항목에는 출발 IP·원문 머리글·쿼리가 없습니다. 따라서 서버의 신뢰 가능한 증거 연결과 운영 등록부의 새 ruleId/reasonCode 등록은 엔진 통합 시 필요합니다. 이 저장점은 연결 함수와 기존 판정기를 함께 호출하는 로컬 재연까지 검증한 것이며, 반 엔진에 배포하거나 등록부를 변경하지 않았습니다.

기본 만료는 경보 발생 후 5분이며 1초~15분으로 제한합니다. 오래된 경보·5초보다 먼 미래 경보·잘못된 주소·루프백/멀티캐스트·보호 주소는 규칙을 만들지 않습니다. 같은 경보 재전송으로 만료를 현재 시각 기준으로 연장하지 않습니다. 만료된 규칙은 판정에서 무시하고 다음 경보 처리 시 정리합니다. 파일 저장기는 단일 프로세스용이며 같은 모듈의 호출은 직렬화하고 상태 파일은 원자적으로 교체합니다.

판단은 허용한 요청 필드의 제한된 길이·깊이만 검사합니다. 복잡하게 난독화된 구문 전체와 모든 CVE를 탐지하는 도구는 아닙니다. 취약한 라이브러리의 패치를 대신하지 않습니다.

## 근거

- [Apache CVE-2021-44228](https://logging.apache.org/security.html#CVE-2021-44228)
- [NIST NVD CVE-2021-44228](https://nvd.nist.gov/vuln/detail/CVE-2021-44228)
- [MITRE ATT&CK T1190](https://attack.mitre.org/techniques/T1190/)
- [ProjectDiscovery의 Log4Shell 점검 템플릿](https://github.com/projectdiscovery/nuclei-templates/blob/main/http/cves/2021/CVE-2021-44228.yaml)
- [FullHunt log4j-scan](https://github.com/fullhunt/log4j-scan)
