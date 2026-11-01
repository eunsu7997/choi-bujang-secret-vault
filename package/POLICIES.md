# 검문소·탐지 규칙

실제로 구현한 규칙만 아래 표에 추가하세요. 규칙 이름, 단계, 어떤 요청을 막는지, 확인한 방법을 함께 적으세요.

| 규칙 | 단계 | 막는 공격 | 확인 방법 |
|---|---|---|---|
| device_registered | 6 | 미등록 기기의 자료실 요청 | test/step6-decider.test.mjs, npm run decider:test |
| step_up_required | 7 | 새벽·낯선 네트워크·지역 변경·대량 접근이 2개 이상 겹친 접속(추가 확인) | test/step7-step-up.test.mjs, npm run fixture:7 |
| resource_zone | 8 | 메모 전체 목록, 반 공지 쓰기, 강사 자료, 알 수 없는 경로·쿼리 기능 선택 | test/step8-zones.test.mjs |

브라우저에서 버튼을 숨기는 것만으로 서버 접근이 차단됐다고 적지 마세요.
