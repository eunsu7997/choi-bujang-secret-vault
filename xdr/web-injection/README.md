# 웹 주입 탐지 · xdr-02

제공된 가상 경보 26건은 block 8 · alert 9 · record 9입니다. 명확한 SQL·스크립트·경로 이탈·명령 구분자 주입의 반복만 차단 후보로 두며, 단발성 조각이나 센서의 T1190 분류만 있으면 알림으로 둡니다. 키워드·높은 수준·큰 횟수 하나만으로 차단하지 않습니다.

```powershell
node xdr/web-injection/read-alerts.mjs
npm run xdr:run -- web-injection
npm run test:xdr
npm run xdr:all
```

읽기 모듈은 다섯 항목을 26줄로 출력하고 비밀값 형태를 가립니다. `patterns.json`의 이름·조건·한 줄 근거는 `decide.mjs` 맨 위 상수와 같습니다. 판단 파일은 import·파일 접근·네트워크·호출 간 누적 상태 없이 `decide(alert)`만 내보냅니다. 실물 구문뿐 아니라 Wazuh 규칙이 보고한 문서용 삽입 표기도 검사하며, 입력 문자열을 실행하지 않습니다.

`respond.mjs`는 `createResponder()`로 별도 규칙 저장기를 만들며 `respond(alert)`로 판단을 다시 계산합니다. 기본 만료는 경보 발생 후 5분입니다. `wrapDecider()`/`decideRequest()`는 원래 판정이 허용인 요청에만 서버가 검증한 `sourceIp`를 검사합니다. 계정 없는 반복 공격은 IP 단위이므로 공유 주소 보호가 필요하면 `protectedSources`에 넣습니다. 오래된 경보·미래 경보·보호 주소는 규칙을 만들지 않습니다. 같은 경보 재전송은 TTL을 연장하지 않습니다.

`result.json`은 판단 결과이고, [전체 집계](../summary.json)의 재연은 격리된 가상 시각 시험입니다. 검토한 정상 경보의 차단은 0건이며 기존 판정기의 거부·추가 확인은 유지합니다. 원본 경보와 기존 규칙을 보존했습니다. 운영 엔진의 출발지 전달·이유 코드 등록·배포·공식 심판 제출은 미실행입니다.
