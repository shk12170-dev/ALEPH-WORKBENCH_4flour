# 내 보안 Agent 시작 틀 0.2.11

이 보안 Agent는 회사 직원이 자기 로그인 상태, 업무 앱 접속 결과, 최근 접속 기록과 보안 경보를 보는 보안 앱입니다. 13단계부터 22단계까지 이 프로젝트 하나로 화면을 채워 가며 완성합니다. 처음이라면 docs/GETTING_STARTED_STUDENT.md부터 읽습니다. 무엇을 왜 만드는지와 단계별 순서가 그 문서에 있습니다.

이 시작 틀을 받은 것만으로 단계를 통과하지 않습니다. 단계마다 docs/STUDENT_PROMPTS.md의 안내를 수업용 AI에 붙여 넣어 student/extension.mjs를 고치고, 화면에서 확인하고, 커밋한 뒤 ALEPH에 제출합니다. 제출하면 서버가 그 커밋의 코드를 받아 AI가 단계 과제 기준으로 읽고 판정합니다. 코드를 실행해서 판정하지 않습니다.

## 켜기

처음 보는 사람이 따라 하는 한 장 안내는 docs/QUICKSTART_ONE_PAGE.md입니다.

검수 환경은 Node.js 24.19.0이며 외부 npm 의존성이 없습니다. 이 폴더의 PowerShell에서 아래를 실행하고 PC 브라우저로 http://127.0.0.1:5189 를 엽니다. 자세한 켜기·끄기·다시 켜기는 docs/STUDENT_LAUNCH_GUIDE.md에 있습니다.

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1

npm start도 같은 서버를 켭니다. 기본 실행은 실제 회사 시스템(기존 엔진)에 연결되지 않은 상태입니다. npm run demo는 예제 자료로 화면을 보여 줄 뿐이며 실제 연결이나 성취가 아닙니다. npm run check는 student/extension.mjs의 문법만 확인합니다.

## 지킬 것

- 기존 1~3차 프로젝트와 학생 파일은 지우거나 덮어쓰지 않습니다. 새 폴더에서 시작하거나, 이미 하던 프로젝트를 이어 씁니다.
- AI 열쇠·비밀번호·토큰을 코드, 커밋, 캡처, 도움정보에 넣지 않습니다. 주소나 열쇠를 직접 입력하는 칸도 만들지 않습니다.
- .env.example에는 비밀 없는 설정만 있습니다.

## 더 읽을 곳

- 단계별 안내와 AI에 붙여 넣을 문장: docs/STUDENT_PROMPTS.md
- 단계별 확인 항목: docs/CURRICULUM.json, docs/IMPLEMENTATION_CONTRACT.md
- 오류 코드별 해결: docs/CONNECTION_TROUBLESHOOT.md
- 시작 틀 업데이트(내 파일 보존): docs/STARTER_UPDATE.md
- 실제 회사 시스템(SDP)·앱 안 AI 연결은 담당자가 따로 안내할 때만 씁니다: docs/SDP_HOST_CONNECTION.md, docs/AI_SETUP_GUIDE.md. 이 연결은 앱을 처음 켜고 13~16단계 화면을 만들거나 공식 AI 코드 판정을 받기 위한 전제 조건은 아닙니다. 다만 17단계 이후의 실제 연결과 새 환경 재현은 해당 단계의 기준에 따라 따로 확인합니다.

## 학생 실행 설명서

위 내용은 제공된 시작 틀 안내이고, 아래는 학생이 직접 작성한 부분입니다. 자세한 실행 절차·구성도·오류별 확인 순서는 `docs/STUDENT_RUNBOOK.md`에 있습니다.

- 목적과 기능: 직원이 자기 로그인 상태, 업무 앱 접속 판정, 접속 기록·보안 경보, 알림·진단 정보, AI 사건 설명, 조치 요청 상태, 설치 패키지 취약점 조회 결과를 보는 로컬 보안 앱입니다. 학생이 구현한 것은 `student/extension.mjs`의 화면 함수 8개(13~22단계)와, 완성하기 단계에서 더한 내 PC 상태·연결 조회(`src/pc-status/service.mjs`, `connection.mjs`), 내 PC 점검 화면 `/pc`(`student/pc.*`), 점검 기록 화면 `/checks`(`student/checks.*`, `src/pc-status/checks.mjs`), 연습 경보 시연 화면 `/practice`(`student/practice.*`, `src/practice-alerts/service.mjs`, 판단 모듈 6개는 방어전 보너스 결과를 복사한 `student/practice/`)입니다. 점검 파일은 `test/`에 있고 `npm test`로 다시 돌릴 수 있습니다.
- 지원 환경: Windows와 PowerShell 실행 도구, Node.js 22~24(수업 기준 24.19.0, 작성 PC에서 확인한 버전 v24.20.0), 외부 npm 의존성 없음. macOS·Linux·Node 22·23과 다른 브라우저는 확인하지 않았습니다.
- 실행: 앱 폴더에서 `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1` 실행 후 브라우저로 `http://127.0.0.1:5189`를 엽니다. 종료는 실행한 창에서 `Ctrl+C`입니다.
- 구성: 브라우저 → 로컬 앱 서버(`src/server.mjs`) → 접근 제어·XDR 시스템(`src/engine/`, 기본 연결 안 됨) / AI 게이트웨이(`src/ai/`, 기본 설정 안 됨) / OSV 공개 조회(`src/vulnerabilities/`, 허용 목록이 비면 조회 안 함). 서버와 `public/`, `src/`, `tools/`는 제공 코드입니다. 제공 파일 중 학생이 고친 것은 `src/server.mjs` 하나이며, 학생 API(`/api/pc-status`, `/api/pc-connection`, `/api/checks`, `/api/practice-alerts`)와 화면 경로(`/pc`, `/checks`, `/practice`)만 더했습니다. `public/`과 `tools/`, `student/engine-adapter.mjs`는 바꾸지 않았습니다.
- 확인하지 않은 것: 접근 제어·XDR 시스템 연결(위험 알림은 `/practice`에서 **공식 연습 경보로만** 시연하며 이 PC의 실제 탐지가 아님), 이 앱의 AI 게이트웨이 연결, 실제 OSV 조회, 조치 집행, 실제 클립보드 복사. 자세한 구분은 `docs/STUDENT_RUNBOOK.md`의 7장에 있습니다. 사례별 실측과 미실행 구분은 `docs/DEMO_AND_LIMITS.md` 4-5와 앱의 `/checks` 화면(`GET /api/checks`)에 있습니다.
- 릴리스 기록: `docs/STUDENT_RELEASE_RECORD.md`에 새 빈 폴더에서 같은 커밋을 받아 실행한 재현 기록, 13~21단계별 결과, 데이터 보존 계획, 버전과 미해결 사항을 적었습니다. 현재 버전은 실제 연결 없이 확인한 검증 중인 버전이며 운영 인증이나 v1.0이 아닙니다.

## 사례별 실측 표(요약)

전체 표(기대 조건·실제 관측·출처 포함)는 `docs/DEMO_AND_LIMITS.md` 4-5에 있습니다. 여기에는 결과만 옮겼고 원칙은 **관측·모의·미실행을 나누어 적고 합계에 섞지 않는다**입니다.

- 측정 커밋: `6ba5550adfece3d7de5566a31f23a2ca6add866a`, 측정 시각: 2026-11-03 오후 12:34(한국 시간), Node `v24.20.0`, 이 PC의 로컬 서버(GET만). 이후 커밋이 생겨도 측정 커밋은 바꾸지 않습니다.
- 합계: **실측 10건(모두 기대대로) · 모의로만 확인 2건 · 미실행 3건 · 합계 15건**

| 사례 | 영역 | 결과 |
|---|---|---|
| C-01~C-03 | 화면 파일, PC 자원, 연결·기록 | 기대대로(HTTP 실측) |
| C-04 | 연결 없음 API 5개 | 503 `ENGINE_NOT_CONNECTED`가 기대값이라 기대대로. **연결 성공이 아님** |
| C-05, C-06 | 도움정보, OSV | 기대대로. **OSV 조회는 하지 않았고 「취약점 없음」으로 세지 않음** |
| C-07 | 예제 기록 | 기대대로. [예시 화면 · 설명용 값] |
| C-08~C-10 | `/pc` 집계, 기록 화면 실패 안내, 알림 | 기대대로(화면 실측) |
| C-11, C-12 | 서버 중단, 권한 부족 | `not_run` · 모의 점검으로만 확인 |
| C-13~C-15 | SDP 실제 연결, 이 앱의 계정·AI 연결, AI 설명·조치 집행 | `not_run`(미실행) |

앱이 직접 실행하는 같은 원칙의 점검(`/checks`)은 **일치 11 + 미실행 5 = 16**이며, 위 표와 사례 수·번호가 다릅니다(위 표는 화면 확인 3건을 포함한 `6ba5550` 기준의 별도 측정). `/practice`의 값은 연습 경보로 계산한 [예시 화면 · 설명용 값]이라 이 표의 합계에 넣지 않았습니다.

## SDP·XDR 관련 파일의 출처

「누가 만들었나」를 구분합니다. 이 저장소의 SDP 관련 파일은 모두 시작 틀(제공)이고, XDR 판단 모듈은 방어전 1~12단계 저장소(`choi-bujang-secret-vault`)의 보너스 작업(학생이 AI와 함께 만듦)을 복사한 것입니다. 「SDR」이라는 이름의 파일은 두 저장소 어디에도 없습니다.

| 파일 | 출처 | 비고 |
|---|---|---|
| `docs/SDP_HOST_*.md`, `src/engine/sdp-*.mjs`, `src/actions/sdp-action-engine.mjs`, `src/connection/native-*.mjs`, `src/engine.mjs`, `student/engine-adapter.mjs`, `tools/*native-host*.ps1` | **제공(시작 틀)** | `.on-starter-manifest.json`에 있고 내용을 고치지 않음 |
| `student/practice/<모듈>/decide.mjs` 6개 | **학생이 만든 것(방어전 보너스 xdr-01~06)을 내용 그대로 복사** | vault 저장소 `xdr/<모듈>/decide.mjs`와 같은 내용 |
| `student/practice/fixtures/*.json` | **제공(공식 연습 경보)** | 실제 로그가 아닌 연습 데이터 |
| `student/practice/expected/*.json` | 학생 작업 결과(vault `xdr/<모듈>/result.json` 복사) | 판단 일치 대조용 |
| `src/practice-alerts/service.mjs`, `student/practice.*` | **학생이 만든 것(11일차)** | 읽고 계산만 함 |

## 다시 만드는 순서

```powershell
npm test
npm start
```

`npm test`는 모의 점검 6개 파일(123건)을 실행합니다(서버와 브라우저 없이). `npm start` 뒤 `http://127.0.0.1:5189/practice`, `/checks`, `/pc`를 엽니다. 새 화면 목록은 서버를 **다시 켜야** 반영됩니다.
