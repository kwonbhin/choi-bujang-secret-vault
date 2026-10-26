# 케셰브 보안 Agent 「빈」 재현 기록과 릴리스 기록 (학생 작성 · 권빈)

22단계 「최종 커밋의 새 환경 재현과 릴리스 기록」 문서입니다. 실행 방법은 [STUDENT_RUNBOOK.md](STUDENT_RUNBOOK.md)(21단계)를 따릅니다.

> 이 기록은 **학생 진술**입니다. ALEPH 서버의 AI 원문 검토는 코드를 읽고 판정할 뿐, 실행 성공을 증명하지 않습니다. 22단계 통과는 원문 검토 기준의 수료이며, 실제 운영 인증이나 v1.0 인증이 아닙니다.

**표기 규칙**

| 표기 | 뜻 |
|---|---|
| **[학생 실행]** | 학생 PC(Windows)에서 학생이 직접 실행하고 본 것 |
| **[보조 실행]** | Claude가 클라우드 Linux 작업 공간에서 새로 clone해 실행한 것. 학생 PC 재현을 대신하지 않음 |
| **[예제]** | `--demo` 예제 자료. 실제 연결이 아님 |
| **[모의 점검]** | 가짜 입력으로 학생 함수만 실행한 것 |
| **[코드 확인]** | 원문을 읽기만 한 것 |
| **미확인** | 확인하지 못한 것 |

---

## 1. 릴리스 정보

| 항목 | 값 |
|---|---|
| 앱 이름 | 케셰브 보안 Agent (학생 Agent 이름 「빈」) |
| 학생 릴리스 이름 | `빈-r22`: **검증 중인 버전**. 실제 집행 연결 등 미완료 항목이 있으며 v1.0이 아님 |
| 저장소 URL | https://github.com/kwonbhin/choi-bujang-secret-vault |
| 브랜치 | `main` |
| **최종 코드 커밋(재현 대상)** | `4122f415eb606f204be1c06eb33d13eb152a1109` |
| 이 기록을 담은 커밋 | 이 문서를 갱신한 커밋. `4122f41` 이후로는 **문서(`*.md`)만 바뀌고 코드는 같음**. `git diff --stat 4122f41 <제출 커밋>`으로 확인 가능 |
| 시작 틀 | `alekov-client-starter` 0.2.19 (`on-client/package.json`) |
| 학생 코드 | `on-client/student/extension.mjs` (13~20단계 함수 8개) |
| 외부 npm 의존성 | 없음 (`npm install` 불필요) |

### 커밋 이력 (13~22단계, `git log` 기준)

| 커밋 | 내용 |
|---|---|
| `5b8b4db` | 17단계: on-client 0.2.11 → 0.2.19 업데이트 |
| `bf64747` | 18단계 `renderExplanation` |
| `c749f6a` | 19단계 `renderAction` |
| `2b37987` | 19단계 보완(사건·조치 ID 대조) |
| `ab3736f` | 20단계 `renderVulnerabilities` |
| `6a1f9e3` | 21단계 학생 실행 설명서·구성도 |
| `e657ee1` | 22단계 재현 기록 초안(문서만) |
| `4122f41` | 22단계 재현 중 보완: `renderStatus` 진단 정보 idle 표시(아래 3-3) — **최종 코드** |

---

## 2. 새 폴더에서 같은 커밋 받기 (원래 작업 폴더는 보존)

원래 작업 폴더 `C:\Users\Administrator\Documents\choi-bujang-secret-vault`는 건드리지 않고, 새 빈 폴더에 따로 받습니다. 아래 경로는 학생이 실제로 쓴 예시이며, 다른 PC에서는 바꿔 씁니다. 앱 코드는 이 절대경로에 의존하지 않습니다.

```powershell
mkdir C:\repro-bin
cd C:\repro-bin
git clone https://github.com/kwonbhin/choi-bujang-secret-vault.git
cd choi-bujang-secret-vault
git checkout 4122f415eb606f204be1c06eb33d13eb152a1109
git rev-parse HEAD
node --version
cd on-client
npm run check
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1
```

- **설정·인증 파일**: 원래 폴더에서 복사하지 않습니다. 계정 연결 설정은 실행 도구가 Windows 사용자 폴더에 자동으로 준비합니다(`docs/STUDENT_LAUNCH_GUIDE.md` 2장). 실제로 새 폴더에서도 `계정 연결 준비가 끝났습니다.`가 출력됐습니다(3-3·3-4). 서버를 다시 켜면 화면의 계정 연결 표시는 "아직 계정 연결을 확인하지 않았습니다"로 돌아가므로, 필요하면 연결을 다시 진행합니다.
- **포트**: 원래 폴더의 앱이 켜져 있으면 `Ctrl+C`로 끄거나 `-Port 5190`을 붙입니다.

---

## 3. 재현 기록

### 3-1. [보조 실행] 클라우드 Linux에서 새 clone (코드 `6a1f9e3`)

| 항목 | 값 |
|---|---|
| 일시 | 2026-10-26T08:09:48Z (KST 17:09) |
| 환경 | Linux 6.18, Node.js v22.23.4, Chromium(Playwright) |
| 절차 | 빈 폴더에 `git clone` → `git checkout 6a1f9e3…` → `npm run check` → `ON_PORT=5199 node src/server.mjs` → 브라우저 → 종료 → 재실행 → `--demo` |
| 학생 PC와 다른 점 | OS가 다름. PowerShell 실행 도구 대신 서버를 직접 실행함. 계정·AI 연결은 하지 않음. 최종 커밋보다 이전 코드(차이는 `statusDiagnostics` 함수뿐) |

| 확인 | 관찰 결과 |
|---|---|
| `npm run check` | 오류 없음 |
| 서버 시작 | `케셰브 연결 확인: http://127.0.0.1:5199` |
| `GET /`, `GET /student/extension.mjs` | 200 |
| `GET /api/diagnostics` | 200, `engine.mode: disconnected`, `engine.code: ENGINE_NOT_CONNECTED` |
| `GET /api/me`, `/api/events` | 503 `ENGINE_NOT_CONNECTED` |
| `GET /api/vulnerabilities` | 200, `status: not_configured`, `code: PROJECT_NOT_CONFIGURED` |
| 브라우저 학생 칸 8개 | 모두 그려짐, 페이지 스크립트 오류 0건 |
| 종료 → 재실행 | 종료 뒤 접속 불가 → 다시 시작 후 `GET /` 200 |
| **[예제]** `--demo` | 학생 기록 행 `event-01`, 상세(근거 e-01, 규칙 rule-01, 접근 denied / 세션 active / 기기 unknown). **실제 연결이 아님** |

### 3-2. [학생 실행] 원래 폴더 (이전 커밋 `bf64747`, 2026-10-26 오후)

계정 연결·AI 앱 승인·AI 연결 점검 `verified`(모델 수 1, 2026-10-26T06:37:39.158Z), SDP 미연결 화면, 18단계 "기록을 먼저 고르세요" 안내를 확인했습니다. **이전 커밋의 결과이므로 최종 커밋 결과로 합치지 않습니다.**

### 3-3. [학생 실행] 새 폴더 재현 1차 — 커밋 `e657ee1` (문제 발견)

| 확인 | 결과 |
|---|---|
| 원래 폴더 보존 | `dir`로 `C:\Users\Administrator\Documents\choi-bujang-secret-vault`가 그대로 있음을 확인 |
| 새 폴더 | `C:\repro-bin\choi-bujang-secret-vault` (`git clone`) |
| `git rev-parse HEAD` | `e657ee11b086cdbb39ffecad13ddb36990b27a6e` |
| `node --version` | `v24.19.0` |
| `npm run check` | 오류 없음 |
| 실행 도구 | 시작 신호 5줄 정상 |
| **발견한 문제** | 「학생 상태·알림 표시」의 진단 정보가 `requestId`·`version` 등 **빈 값**으로 표시됨. 제공 화면은 「도움정보 불러오기」 전에는 진단 정보를 `idle`로 넘기는데, 16단계 학생 함수가 idle을 성공 화면처럼 그렸기 때문 |
| 조치 | `statusDiagnostics`를 고쳐 커밋 `4122f41` 생성. idle은 "아직 불러오지 않았습니다", ok가 아닌 상태는 확인 불가, 빈 필드는 "확인 불가"로 표시. [보조 실행]에서 불러오기 전·후를 브라우저로 확인함 |

### 3-4. [학생 실행] 새 폴더 재현 2차 — **최종 커밋 `4122f41`**

| 항목 | 값 |
|---|---|
| 일시 | 2026-10-26 KST 약 17:50~18:21 (화면 시각 2026-10-26T09:16:29Z~) |
| 환경 | Windows, Windows PowerShell, Node.js v24.19.0 |
| 폴더 | `C:\repro-bin\choi-bujang-secret-vault\on-client` (원래 폴더와 별개) |
| 절차 | 앱 종료 → `git fetch` → `git checkout 4122f41…` → `npm run check` → 실행 도구 → 브라우저 새로고침·확인 → `Ctrl+C` 종료 → 재실행 |

| 확인 | 관찰 결과 |
|---|---|
| `git rev-parse HEAD` | `4122f415eb606f204be1c06eb33d13eb152a1109` |
| 실행 도구 시작 신호 | `계정 연결 준비가 끝났습니다…` / `케셰브 연결 확인: http://127.0.0.1:5189` / `케셰브가 켜졌습니다…` / `서버가 응답한 것만 확인했습니다…` / `끄려면 이 창에서 Ctrl+C 를 누르세요.` |
| 학생 상태·알림(renderStatus) | 기기·세션 "연결 없음"과 `ENGINE_NOT_CONNECTED` 알림 5건(me·apps·events·devices·sessions). 진단 정보는 **"진단 정보를 아직 불러오지 않았습니다…"** → 3-3 수정 반영 확인 |
| 「도움정보 불러오기」(제공 칸) | `mode: disconnected`, `engine.code: ENGINE_NOT_CONNECTED`, `checkedAt: 2026-10-26T09:16:29.427Z`, `ai.configured: false` |
| 「설치 패키지 조회」 제공 칸 | "프로젝트 연결 준비 중", `PROJECT_NOT_CONFIGURED`, `2026-10-26T09:16:58.734Z` |
| 「설치 패키지 조회」 학생 칸(renderVulnerabilities) | "조회 준비 미완료(not_configured)… 조회 실패·미조회·취소는 '취약점 없음'이 아닙니다", "조회한 패키지가 없습니다. 미조회·확인 불가 상태이며 취약점 없음이 아닙니다", OSV 범위 안내 |
| 「AI 연결 점검」 학생 칸(renderAiConnection) | 재실행으로 계정 연결이 풀린 상태에서 누름 → "AI 연결 점검 실패", `ON_AI_PROVISIONING_PENDING`, 메시지 "학생 앱 이용 권한의 발급·연결을 준비 중입니다…". **실패를 실패로 표시함** |
| 종료 → 재실행 | `Ctrl+C` 후 같은 창에서 다시 실행 → 같은 시작 신호 5줄. 종료 직후 브라우저 접속 불가 화면은 따로 기록하지 않음 |
| 원래 폴더 | 건드리지 않음(새 폴더에서만 작업) |

**3-4에서 미확인**
- 학생 칸 진단 정보가 「도움정보 불러오기」 뒤 값으로 바뀌는 모습(학생 PC 화면). [보조 실행]에서만 확인함
- 보안 기록 메뉴의 학생 AI 설명·조치 칸 문구(학생 PC, 이번 커밋). [보조 실행]에서는 확인함
- 이번 실행에서의 계정 연결·AI 연결 `verified`(3-2에서는 이전 커밋으로 확인함)

---

## 4. 13~22단계 결과 정리

단계별로 포털 판정에 낸 커밋과 최종 커밋 기준 결과를 나눠 적습니다. **서로 다른 커밋의 판정 결과를 합쳐 최종 버전 전체 성공으로 표시하지 않습니다.** 포털 판정은 그 단계 커밋의 원문 검토 결과이며, 실행 성공 증명이 아닙니다.

| 단계 | 기능 | 포털 판정에 낸 커밋 / 판정(학생 진술) | 최종 커밋 `4122f41` 기준 확인 | 실제 시스템 연결 | 미확인 원인 |
|---|---|---|---|---|---|
| 13 | `renderIdentity` | 이전 커밋 / 통과 | [보조 실행] 연결 실패 표시 | 미확인 | SDP 설정 없음 |
| 14 | `renderDecision` | 이전 커밋 / 통과 | [보조 실행] "앱을 골라 접속을 요청하세요" | 미확인 | SDP 설정 없음 |
| 15 | `renderEvents` | 이전 커밋 / 다음 단계가 열려 통과로 추정(포털 확인 필요) | [보조 실행] 연결 실패 표시, [예제] 목록·상세 | 미확인 | SDP 설정 없음 |
| 16 | `renderStatus` | 이전 커밋 / 통과 | **[학생 실행] 3-4**. 진단 idle 표시는 22단계에서 보완(`4122f41`) | 연결 실패 표시만 | SDP 설정 없음 |
| 17 | `renderAiConnection` | `5b8b4db` 이후 커밋 / 통과 | **[학생 실행] 3-4** 실패(`ON_AI_PROVISIONING_PENDING`) 표시 | 이전 커밋에서 `verified` 확인(3-2) | 이번 커밋에서는 연결을 다시 하지 않음 |
| 18 | `renderExplanation` | `bf64747` / 포털 확인 필요 | [보조 실행] 기록 미선택 안내, [모의 점검] 10가지 | 실제 사건 설명 미확인 | 보안 기록 없음(SDP 미연결) |
| 19 | `renderAction` | `c749f6a` 실패(`current_intent_binding`) → `2b37987` / 20단계가 열려 통과로 추정(포털 확인 필요) | [보조 실행] idle 화면, [모의 점검] 20가지 | 미확인 | **집행 연동 시스템 미준비(기다림 UNV)** |
| 20 | `renderVulnerabilities` | `ab3736f` / 포털 확인 필요 | **[학생 실행] 3-4** not_configured 표시 | 실제 OSV 조회 미확인 | 조회 대상·허용 패키지 미설정(운영자 준비) |
| 21 | 실행 설명서·구성도 | `6a1f9e3` / 포털 확인 필요 | [학생 실행] 설명서 절차대로 실행·종료·재실행 | 해당 없음 | — |
| 22 | 이 문서 | 이 문서를 담은 커밋 / 제출 전 | 3-4 | — | 다른 PC 재현 |

**최종 커밋 기준 결론**: `4122f41`은 같은 PC의 새 폴더에서 clone·문법 확인·실행·화면 확인·종료·재실행까지 재현됐습니다(학생 진술). 실제 시스템 연결(SDP·조치 집행·OSV 조회)과 이번 커밋에서의 AI 사건 설명은 확인되지 않았으므로 **검증 중인 버전**입니다.

---

## 5. 데이터 보존 계획

| 데이터 | 위치 | 보존·백업 | 복원 | 제한 |
|---|---|---|---|---|
| 학생 코드·문서 | Git(GitHub `kwonbhin/choi-bujang-secret-vault`, 원래 작업 폴더) | 단계마다 커밋·푸시. 원래 폴더는 지우거나 덮어쓰지 않음 | 새 폴더에 `git clone` 후 `git checkout <커밋>` (2장, 3-4에서 실제로 해 봄) | 커밋하지 않은 변경은 보존되지 않음. `git reset --hard` 금지 |
| 4차 앱 화면 자료(계정·기기·세션·기록) | 학생 앱에 저장하지 않음. 매번 서버에서 조회하고 학생 함수는 상태를 보관하지 않음 | 해당 없음 | 「다시 불러오기」 | 원본은 SDP 원천 |
| 계정 연결 설정·앱 자격 | 학생 프로젝트 밖 Windows 사용자 폴더(실행 도구가 프로젝트별로 준비) | Git에 넣지 않음, 복사하지 않음 | 앱에서 계정 연결·AI 앱 승인을 다시 진행 | 비밀값이라 문서·커밋·도움정보에 적지 않음 |
| 조치 기록(`src/actions/store.mjs`, SQLite) | 운영자가 조치 연결을 설정한 실행에서만 사용 | 학생 범위 밖 | 학생 범위 밖 | 현재 집행 연결 미준비 |
| 1~12단계 자료실 메모 | Supabase 테이블 `vault_notes` | 10단계 백업 사본·감사 기록(README "10단계" 절) | README 10단계 복원 절차(미리보기 → 복원 → 대조) | 가상 메모만. 실제 개인정보 금지 |
| 비밀값 | `.gitignore`가 `.env`, `.env.*` 제외 | Git에 넣지 않음 | 담당자 안내로 다시 설정 | `on-client`에는 `.env.example` 파일이 없음(제공 README 문구와 차이) |

---

## 6. 지원 범위와 미해결 사항

| 구분 | 내용 |
|---|---|
| 지원 환경 | Windows + Windows PowerShell + Node.js 22~24(기준 24.19.0). 실행 도구는 Windows 전용 |
| 재현한 환경 | 학생 PC Windows + Node.js v24.19.0(3-4). 보조로 Linux + Node.js v22.23.4(3-1, 실행 도구 미사용) |
| 확인하지 않은 환경 | 다른 Windows PC, macOS, Node.js 21 이하·25 이상 |
| 미해결 1 | 실제 접근 제어·XDR(SDP) 연결: 담당자 설정 발급 전. 보안 기록·업무 앱 판정 실제 값 미확인 |
| 미해결 2 | 실제 AI 사건 설명: 보안 기록이 없어 미확인 |
| 미해결 3 | 19단계 실제 조치 집행·결과 재조회: 집행 연동 시스템 미준비(기다림) |
| 미해결 4 | 20단계 실제 OSV 조회: 조회 대상 설정 미준비(not_configured) |
| 알려진 사소한 문제 | 17단계 `renderAiConnection`의 안내표에 `ON_AI_PROVISIONING_PENDING` 항목이 없어 안내 줄이 일반 문구("연결을 확인하지 못했습니다. 담당자에게 문의하세요")로 나옴. 원인 코드·메시지 줄은 정확하고 성공으로 보이지 않음. 최종 커밋을 다시 바꾸지 않으려고 이번 릴리스에서는 고치지 않음 |
| 버튼 이름 차이 | 19단계 안내의 「연동 시스템 결과만 재조회」는 실제 화면에서 「원천 결과만 재조회」. 학생 코드·문서는 실제 이름을 씀 |

이 버전은 **검증 중인 버전**입니다. 위 미해결 항목이 남아 있으므로 실제 운영 가능 버전이나 v1.0으로 표시하지 않습니다.
