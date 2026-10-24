# 내 보안 Agent 시작 틀 0.2.11

이 보안 Agent는 회사 직원이 자기 로그인 상태, 업무 앱 접속 결과, 최근 접속 기록과 보안 경보를 보는 보안 앱입니다. 13단계부터 22단계까지 이 프로젝트 하나로 화면을 채워 가며 완성합니다. 처음이라면 docs/GETTING_STARTED_STUDENT.md부터 읽습니다. 무엇을 왜 만드는지와 단계별 순서가 그 문서에 있습니다.

이 시작 틀을 받은 것만으로 단계를 통과하지 않습니다. 단계마다 docs/STUDENT_PROMPTS.md의 안내를 수업용 AI에 붙여 넣어 student/extension.mjs를 고치고, 화면에서 확인하고, 커밋한 뒤 ALEPH에 제출합니다. 제출하면 서버가 그 커밋의 코드를 받아 AI가 단계 과제 기준으로 읽고 판정합니다. 코드를 실행해서 판정하지 않습니다.

## 켜기

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

- 목적과 기능: 직원이 자기 로그인 상태, 업무 앱 접속 판정, 접속 기록·보안 경보, 알림·진단 정보, AI 사건 설명, 조치 요청 상태, 설치 패키지 취약점 조회 결과를 보는 로컬 보안 앱입니다. 학생이 구현한 것은 `student/extension.mjs`의 화면 함수 8개입니다.
- 지원 환경: Windows와 PowerShell 실행 도구, Node.js 22~24(수업 기준 24.19.0, 작성 PC에서 확인한 버전 v24.20.0), 외부 npm 의존성 없음. macOS·Linux·Node 22·23과 다른 브라우저는 확인하지 않았습니다.
- 실행: 앱 폴더에서 `powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1` 실행 후 브라우저로 `http://127.0.0.1:5189`를 엽니다. 종료는 실행한 창에서 `Ctrl+C`입니다.
- 구성: 브라우저 → 로컬 앱 서버(`src/server.mjs`) → 접근 제어·XDR 시스템(`src/engine/`, 기본 연결 안 됨) / AI 게이트웨이(`src/ai/`, 기본 설정 안 됨) / OSV 공개 조회(`src/vulnerabilities/`, 허용 목록이 비면 조회 안 함). 서버와 `public/`, `src/`, `tools/`는 제공 코드이며 학생이 바꾸지 않았습니다.
- 확인하지 않은 것: 접근 제어·XDR 시스템 연결, AI 게이트웨이 연결, 실제 OSV 조회, 조치 집행, 실제 클립보드 복사. 자세한 구분은 `docs/STUDENT_RUNBOOK.md`의 7장에 있습니다.
- 릴리스 기록: `docs/STUDENT_RELEASE_RECORD.md`에 새 빈 폴더에서 같은 커밋을 받아 실행한 재현 기록, 13~21단계별 결과, 데이터 보존 계획, 버전과 미해결 사항을 적었습니다. 현재 버전은 실제 연결 없이 확인한 검증 중인 버전이며 운영 인증이나 v1.0이 아닙니다.
