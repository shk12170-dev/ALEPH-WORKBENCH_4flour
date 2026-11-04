# PC·SaaS 참고 사례 연결 계약

2026-10-24 확인. 학생용 참고 사례이며 실제 사용자 계정 조회를 완료한 기록이 아니다. 서비스 하나를 먼저 연결하고 나머지는 연결 전으로 표시한다. 계정이나 프로젝트 조회 성공은 MFA·청구 접근·배포 보호·모든 프로젝트 보안 검증의 성공과 별개다.

| 대상 | 공식 조회 근거 | 이 사례에서 구분할 것 |
|---|---|---|
| 로컬 PC | 기존 GET /api/pc/status, schema aleph.on.pc-status.v1, source local-pc | 실제 실행 PC의 CPU/메모리/디스크/네트워크 요약/방화벽/경고·오류 집계. 오류 집계는 침해 판정이 아니다. 0.2.17까지의 학생 확장 API는 이 경로를 허용하지 않아 참고 코드에서 「지원 없음」으로 안내하고 제공 카드에서 실측을 본다. 0.2.18 후보에서는 정확한 이 경로를 읽기 전용으로 허용하며, 실제 설치·배포 여부는 별도로 확인한다. |
| GitHub | [Billing usage](https://docs.github.com/en/rest/billing/usage), 개인 사용량 GET /users/{username}/settings/billing/usage | 공식 문서의 개인 Plan 읽기 권한과 enhanced billing 대상 여부를 확인한다. 개인/조직/기업 청구 주체를 나누며 한 계정의 응답을 모든 구독의 합계로 쓰지 않는다. 계정 보안·저장소 경고는 별도 범위다. |
| Vercel | [FOCUS charges](https://vercel.com/docs/rest-api/billing/list-focus-billing-charges), GET /v1/billing/charges, [usage CLI](https://vercel.com/docs/cli/usage) | 팀·기간을 지정하고 실제 응답 단위/통화/권한을 검증한다. 청구 레코드와 월말 예상·실시간 사용량은 다르다. 학생이 CLI 설치나 유료 플랜을 추가로 구매해야 하는 최저 요건으로 만들지 않는다. Marketplace Submit Billing Data는 고객 비용을 읽는 API가 아니므로 사용하지 않는다. |
| Railway | [Public API](https://docs.railway.com/integrations/api), [Project Usage](https://docs.railway.com/projects/project-usage) | GraphQL의 HTTP200에도 errors/Not Authorized가 들어갈 수 있어 data와 함께 확인한다. 계정/워크스페이스/프로젝트 토큰의 범위를 구분한다. 프로젝트 토큰은 Project-Access-Token 헤더를 쓰며 모든 청구 조회 권한을 보장하지 않는다. 실적과 예상 비용은 별도다. |
| Supabase | [Management API](https://supabase.com/docs/reference/api/introduction), [billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Advisors](https://supabase.com/docs/guides/observability/advisors) | 조직마다 별도 구독/청구 주기이며 여러 프로젝트 사용량이 조직 단위로 합산된다. 프로젝트별 수치와 조직 총액을 중복 합산하지 않는다. scoped PAT 또는 OAuth의 허용 범위를 확인하며 데이터 API의 publishable/anon 키는 관리 API 조회 자격이 아니다. service_role/secret/PAT를 학생 브라우저에 넣지 않는다. 비용 조회 API를 확인하지 못한 항목은 대시보드 확인 또는 사용자 명시 입력으로 구분한다. Advisor 경고는 확인한 프로젝트 설정 범위이며 PC 전체 취약점 검사와 다르다. |

## 결과의 최소 정보

관측 항목마다 대상(PC/계정/조직/프로젝트), 출처, 조회 시각, 집계 시작/끝, 조회 성공 여부, 권한 또는 부분 결과, 실측/사용자 입력/추정/예시를 남긴다. 금액은 통화·실적/예상·크레딧/세금 포함 여부를 덧붙인다. 불명확한 금액은 null이며 0으로 바꾸지 않는다. 진짜 0이라는 공식 응답은 범위와 시각을 붙여 표시할 수 있다. 통화가 다르거나 실적과 예상이 섞인 금액은 합계하지 않는다. 환율을 쓸 때도 출처와 시각을 표시한다.

연결 전·지원 없음·권한 부족·조회 실패·부분 결과·오래됨·예시·조회 성공은 별도 상태다. 공급자의 공개 장애 상태는 해당 공급자 전체의 공지일 뿐, 개인 계정 권한이나 요금 정상의 근거가 아니다. 보안은 관측 항목별로 표현하고 임의 종합 보안 점수, 자동 차단, 자동 결제·설정 변경을 넣지 않는다.

## 취약점 표현

프로젝트 의존성의 정확한 패키지명·설치 버전·생태계·출처·조회 시각·대상 파일/커밋·완전/부분 결과를 함께 기록한다. 특정 버전에서 기록0건을 받았으면 그 범위에서 알려진 기록0건이라고 쓴다. 미조회 패키지·OS·계정 구성까지 안전하다고 확대하지 않는다. 합성 예시의 특정 패키지 버전과 0건 표시는 실제 취약점 조회 결과가 아니다.

## 이번 구현과 후속 연결

Claude CLI가 작성하는 참고 코드는 별도 examples 폴더에 두고 기존 앱의 학생 상태 칸에서만 검토한다. 원래 학생 확장 파일은 보존하고 별도 복사본에서 예제를 확인한다. 외부 자격 입력/저장/인증/API 연결은 아직 구현하지 않는다. 코드와 가이드가 검수된 뒤 기존 최종주 안내에서 같은 프로젝트의 확장 사례로 연결한다. 실제 계정 연결은 명확한 서비스/범위·서버 측 자격 보관·로그 비밀값 제거·페이지네이션·요청 취소·시간 초과·제한 응답 처리까지 검증한 후 제공한다.
