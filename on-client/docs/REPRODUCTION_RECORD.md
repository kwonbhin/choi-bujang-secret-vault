# 케셰브 보안 Agent 「빈」 재현 기록과 릴리스 기록 (학생 작성 · 권빈)

22단계 「최종 커밋의 새 환경 재현과 릴리스 기록」 문서입니다. 실행 방법은 [STUDENT_RUNBOOK.md](STUDENT_RUNBOOK.md)(21단계)를 따릅니다.

> 이 기록은 **학생 진술**입니다. ALEPH 서버의 AI 원문 검토는 코드를 읽고 판정하는 것이며, 실행 성공을 증명하지 않습니다. 22단계 통과는 원문 검토 기준의 수료이고, 실제 운영 인증이나 v1.0 인증이 아닙니다.

표기 규칙:
- **[학생 실행]**: 학생 PC(Windows)에서 학생이 직접 실행하고 본 것
- **[보조 실행]**: Claude가 클라우드 Linux 작업 공간에서 새로 clone해 실행한 것. 학생 PC 재현을 대신하지 않음
- **[예제]**: `--demo` 예제 자료. 실제 연결이 아님
- **[모의 점검]**: 가짜 입력으로 학생 함수만 실행한 것
- **[코드 확인]**: 원문을 읽기만 한 것
- **미확인**: 확인하지 못한 것

---

## 1. 릴리스 정보

| 항목 | 값 |
|---|---|
| 앱 이름 | 케셰브 보안 Agent (학생 Agent 이름 「빈」) |
| 학생 릴리스 이름 | `빈-r22` (**검증 중인 버전**: 실제 집행 연결 등 미완료 항목 있음, v1.0 아님) |
| 저장소 URL | https://github.com/kwonbhin/choi-bujang-secret-vault |
| 브랜치 | `main` |
| 재현 대상 코드 커밋 | `6a1f9e383ac0ae8c60417e8c82291a35709d63fc` (21단계 커밋) |
| 이 기록을 담은 커밋 | 이 문서를 추가한 커밋. `6a1f9e3` 이후에는 **문서(`*.md`)만 바뀌고 코드는 같음**. `git diff --stat 6a1f9e3 <제출 커밋>`으로 확인 가능 |
| 시작 틀 | `alekov-client-starter` 0.2.19 (`on-client/package.json`) |
| 학생 코드 | `on-client/student/extension.mjs` (13~20단계 함수 8개) |
| 외부 npm 의존성 | 없음 |

---

## 2. 새 폴더에서 같은 커밋 받기 (원래 작업 폴더는 보존)

원래 작업 폴더 `C:\Users\Administrator\Documents\choi-bujang-secret-vault`는 건드리지 않습니다. 새 빈 폴더에 따로 받습니다. 경로는 예시이며, 다른 PC에서는 바꿔 씁니다. 앱 코드는 이 절대경로에 의존하지 않습니다.

```powershell
# 1) 새 빈 폴더 만들기 (원래 폴더 밖)
mkdir C:\repro-bin
cd C:\repro-bin

# 2) GitHub에서 새로 받기
git clone https://github.com/kwonbhin/choi-bujang-secret-vault.git
cd choi-bujang-secret-vault

# 3) 제출할 커밋으로 맞추고 확인
git checkout <제출할 40자리 커밋>
git rev-parse HEAD

# 4) 런타임 확인
node --version

# 5) 앱 폴더로 이동해 문법 확인 → 실행
cd on-client
npm run check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1
```

- **설치 단계**: 외부 npm 의존성이 없어 `npm install`이 필요 없습니다(`package.json`에 dependencies 없음).
- **설정·인증 파일**: 원래 폴더에서 복사하지 않습니다. 계정 연결 설정은 실행 도구가 Windows 사용자 폴더에 프로젝트별로 자동으로 준비합니다(`docs/STUDENT_LAUNCH_GUIDE.md` 2장). 새 폴더는 다른 프로젝트 경로라서 계정 연결과 AI 앱 승인을 새로 해야 할 수 있습니다(미확인).
- **포트 충돌**: 원래 폴더의 앱이 켜져 있으면 5189 포트를 쓰고 있으므로, 원래 창을 `Ctrl+C`로 끄거나 새 폴더에서 `-Port 5190`을 붙입니다.

---

## 3. 재현 기록

### 3-1. [보조 실행] 클라우드 Linux에서 새 clone (2026-10-26)

| 항목 | 값 |
|---|---|
| 일시 | 2026-10-26T08:09:48Z (KST 17:09) |
| 환경 | Linux 6.18 (클라우드 작업 공간), Node.js v22.23.4, Chromium(Playwright) |
| 절차 | 빈 폴더에 `git clone` → `git checkout 6a1f9e383ac0ae8c60417e8c82291a35709d63fc` → `npm run check` → `ON_PORT=5199 node src/server.mjs`(= `npm start`, 포트만 변경) → 브라우저 확인 → 종료 → 재실행 → `--demo` 실행 |
| 차이 | 학생 PC와 OS가 다르고, PowerShell 실행 도구(`tools/start-alekov.ps1`) 대신 서버를 직접 실행함. 계정 연결·AI 연결은 하지 않음 |

| 확인 | 관찰 결과 |
|---|---|
| `git rev-parse HEAD` | `6a1f9e383ac0ae8c60417e8c82291a35709d63fc` |
| `npm run check` | 오류 없음 |
| 서버 시작 신호 | `케셰브 연결 확인: http://127.0.0.1:5199` |
| `GET /` | 200, 화면 HTML |
| `GET /student/extension.mjs` | 200, 학생 코드 제공됨 |
| `GET /api/diagnostics` | 200, `engine.mode: disconnected`, `engine.code: ENGINE_NOT_CONNECTED` |
| `GET /api/me`, `/api/events` | 503 `ENGINE_NOT_CONNECTED` (SDP 미연결. 예상대로) |
| `GET /api/vulnerabilities` | 200, `status: not_configured`, `code: PROJECT_NOT_CONFIGURED`, `packages: []` |
| 브라우저 학생 칸 8개 | 모두 그려짐, 페이지 스크립트 오류 0건. identity·events·status: "연결 없음"과 연결 실패 문구. decision: "앱을 골라 접속을 요청하세요". aiConnection: "AI 연결 점검 전". explanation: "보안 기록에서 기록을 먼저 고르세요…". action: "아직 미실행(idle)…「조치 준비」 버튼이 나오지 않으며, 이것이 정상입니다". vulnerabilities: "조회 전(idle)" |
| 「설치 패키지 조회」 클릭 | 학생 칸: "조회 준비 미완료(not_configured) … 조회 실패·미조회·취소는 '취약점 없음'이 아닙니다" |
| 종료 | 서버 프로세스 종료 뒤 주소 접속 불가 |
| 재실행 | 같은 명령으로 다시 시작, `GET /` 200 |
| **[예제]** `--demo` | 시작 신호 `케셰브 예제: http://127.0.0.1:5199`. 학생 기록 행 1개(`data-student-event-id="event-01"`), 상세(`data-student-event-detail="event-01"`)에 근거 e-01·규칙 rule-01·상태(접근 거부 denied / 세션 활성 active / 기기 확인 불가 unknown). 내 계정 칸 "예제 자료" 표시. **실제 연결이 아님** |

AI 설명 요청과 조치 요청은 유료 요청·실제 조치를 피하려고 누르지 않았습니다.

### 3-2. [학생 실행] 원래 폴더에서 실행 (2026-10-26, 학생 PC)

| 항목 | 값 |
|---|---|
| 환경 | Windows, Windows PowerShell, Node.js v24.19.0 추정(실행 도구가 다른 버전일 때 출력하는 "참고: 지금 Node.js 는 …" 줄이 나오지 않음). `node --version` 출력은 미기록 |
| 폴더 | `C:\Users\Administrator\Documents\choi-bujang-secret-vault\on-client` (원래 작업 폴더) |
| 코드 | 18단계 커밋 `bf64747`을 `git pull`한 상태(재현 대상 `6a1f9e3`보다 이전 커밋) |
| 관찰 | 실행 도구의 정상 시작 신호 5줄 출력, 화면 표시, 계정 연결·AI 앱 승인 완료, AI 연결 점검 `verified`(모델 수 1, 2026-10-26T06:37:39.158Z), SDP 미연결 화면("기존 서버·에이전트의 연결을 확인할 수 없습니다"), 18단계 "기록을 먼저 고르세요" 안내 |

이 기록은 **다른(이전) 커밋**의 결과입니다. 재현 대상 커밋의 결과로 합치지 않습니다.

### 3-3. [학생 실행] 새 폴더에서 제출 커밋 재현 — **미확인(진행 예정)**

2장 절차대로 새 폴더에서 실행한 뒤 아래 표를 채웁니다. 채우기 전까지는 미확인입니다.

| 확인 | 결과 |
|---|---|
| 새 폴더 경로 | 미확인 |
| `git rev-parse HEAD` | 미확인 |
| `node --version` | 미확인 |
| `npm run check` | 미확인 |
| 실행 도구 시작 신호 | 미확인 |
| 브라우저 `http://127.0.0.1:5189/` 화면 | 미확인 |
| 종료(`Ctrl+C`) → 재실행 | 미확인 |
| 원래 폴더가 그대로 남아 있음 | 미확인 |

---

## 4. 13~21단계 결과 정리

같은 최종 커밋 기준과 단계별 판정 커밋을 나눠 적습니다. **서로 다른 커밋의 판정 결과를 합쳐 최종 버전 전체 성공으로 표시하지 않습니다.** 포털 판정은 그 단계 커밋의 원문 검토 결과일 뿐, 실행 성공 증명이 아닙니다.

| 단계 | 기능(학생 함수·문서) | 포털 판정에 낸 커밋 | 포털 판정(학생 진술) | 확인 시각·근거 | 실제 시스템 연결 | 미확인 원인 |
|---|---|---|---|---|---|---|
| 13 | `renderIdentity` 계정·기기·세션 | 이전 커밋(기록 없음) | 통과(학생 진술) | — | SDP 미연결 → 실제 사용자 값 미확인. 연결 실패 표시는 [보조 실행]·[학생 실행]에서 확인 | SDP 설정 없음 |
| 14 | `renderDecision` 업무 앱 판정 | 이전 커밋 | 통과(학생 진술) | — | 미확인 | SDP 설정 없음 |
| 15 | `renderEvents` 기록 목록·상세 | 이전 커밋 | 다음 단계가 열렸으므로 통과로 추정(포털에서 확인 필요) | [예제] 3-1 | 미확인. 예제 자료로만 확인 | SDP 설정 없음 |
| 16 | `renderStatus` 상태·알림·진단 | 이전 커밋 | 통과(학생 진술) | [보조 실행] 3-1 | 연결 실패 표시만 확인 | SDP 설정 없음 |
| 17 | `renderAiConnection` AI 연결 점검 | `5b8b4db` 이후 새 커밋 | 통과(학생 진술) | [학생 실행] 2026-10-26T06:37:39.158Z verified | **AI 게이트웨이 연결 점검 성공(학생 실행)** | — |
| 18 | `renderExplanation` 근거 연결 AI 설명 | `bf64747` | 포털에서 확인 필요 | [모의 점검] 10가지, [학생 실행] 기록 미선택 안내 | 실제 사건 설명 미확인 | 보안 기록이 없어 요청 불가(SDP 미연결) |
| 19 | `renderAction` 조치 상태 구분 | `c749f6a`: 실패(`current_intent_binding`, 2026-10-26 16:14 판정 설명) → `2b37987` 보완 | `2b37987` 결과는 포털에서 확인 필요(20단계가 열린 것으로 보아 통과로 추정) | [모의 점검] 20가지, [보조 실행] idle 화면 | 실제 조치 준비·집행·결과 재조회 미확인 | **집행 연동 시스템 미준비(기다림 UNV)** |
| 20 | `renderVulnerabilities` 설치 버전·OSV | `ab3736f` | 포털에서 확인 필요 | [모의 점검] 8가지, [보조 실행] not_configured 화면 | 실제 OSV 조회 미확인 | 조회 대상 프로젝트·허용 패키지 미설정(운영자 준비) |
| 21 | `STUDENT_RUNBOOK.md`, README 4차 절 | `6a1f9e3` | 포털에서 확인 필요 | [코드 확인] 경로·명령·버튼 이름 대조 | 해당 없음 | 새 PC 재현은 3-3 |
| 22 | 이 문서 | 이 문서를 담은 커밋 | 제출 전 | 3-1 | — | 3-3 학생 새 폴더 재현 |

**같은 최종 커밋 기준 결과**: 재현 대상 `6a1f9e3`의 코드로는 3-1 [보조 실행]만 했습니다. 학생 PC의 새 폴더 재현(3-3)은 미확인입니다.

---

## 5. 데이터 보존 계획

| 데이터 | 위치 | 보존·백업 | 복원 | 제한 |
|---|---|---|---|---|
| 학생 코드·문서 | Git 저장소(GitHub `kwonbhin/choi-bujang-secret-vault`, 원래 작업 폴더) | 단계마다 커밋·푸시. 원래 폴더는 지우거나 덮어쓰지 않음 | 새 폴더에 `git clone` 후 `git checkout <커밋>` (2장) | 커밋하지 않은 변경은 보존되지 않음. `git reset --hard` 사용 금지 |
| 4차 앱의 화면 자료(계정·기기·세션·기록) | 학생 앱에 저장하지 않음. 매번 서버에서 조회하고 학생 함수는 상태를 보관하지 않음 | 해당 없음 | 다시 불러오기 | SDP 원천이 원본 |
| 계정 연결 설정·앱 자격 | 학생 프로젝트 밖의 Windows 사용자 폴더(실행 도구가 프로젝트별로 준비) | Git에 넣지 않음, 복사하지 않음 | 앱의 계정 연결·AI 앱 승인을 다시 진행 | 비밀값이라 문서·커밋·도움정보에 적지 않음 |
| 조치 기록(`src/actions/store.mjs`, SQLite) | 운영자가 조치 연결을 설정한 실행에서만 사용 | 학생 범위 밖 | 학생 범위 밖 | 현재 집행 연결 미준비 |
| 1~12단계 자료실 메모 | Supabase 테이블 `vault_notes` | 10단계 백업 사본·감사 기록(README "10단계" 절) | README 10단계 복원 절차(미리보기 → 복원 → 대조) | 가상 메모만 저장. 실제 개인정보 넣지 않음 |
| 비밀값(.env 등) | `.gitignore`가 `.env`, `.env.*` 제외 | Git에 넣지 않음 | 담당자 안내에 따라 다시 설정 | `on-client`에는 `.env.example` 파일이 없음(제공 README 문구와 차이) |

---

## 6. 지원 범위와 미해결 사항

| 구분 | 내용 |
|---|---|
| 지원 환경 | Windows + Windows PowerShell + Node.js 22~24(기준 24.19.0). 실행 도구는 Windows 전용 |
| 보조 확인한 환경 | Linux + Node.js v22.23.4에서 `node src/server.mjs` 직접 실행(3-1). 실행 도구 미사용 |
| 확인하지 않은 환경 | macOS, Node.js 21 이하·25 이상, 학생 PC 새 폴더 재현 |
| 미해결 1 | 실제 접근 제어·XDR(SDP) 연결: 담당자 설정 발급 전. 보안 기록·업무 앱 판정 실제 값 미확인 |
| 미해결 2 | 실제 AI 사건 설명: 보안 기록이 없어 미확인 |
| 미해결 3 | 19단계 실제 조치 집행·결과 재조회: 집행 연동 시스템 미준비(기다림) |
| 미해결 4 | 20단계 실제 OSV 조회: 조회 대상 설정 미준비(not_configured) |
| 미해결 5 | 학생 PC 새 폴더 재현(3-3) |
| 버튼 이름 차이 | 19단계 안내의 「연동 시스템 결과만 재조회」는 실제 화면에서 「원천 결과만 재조회」. 학생 코드·문서는 실제 이름 사용 |

이 버전은 **검증 중인 버전**입니다. 위 미해결 항목이 남아 있으므로 실제 운영 가능 버전이나 v1.0으로 표시하지 않습니다.
