# 케셰브(내 보안 Agent 앱) 실행 안내

22단계까지 만든 보안 Agent 앱을 내 PC에서 켜는 방법입니다. 앱 폴더는 저장소 안의 `on-client` 입니다.

## 준비

- **Node.js 22~24** (수업 기준 24.19.0). 없으면 https://nodejs.org 에서 설치한 뒤 터미널/PowerShell을 **새로 엽니다**. 확인: `node -v`
- **Git**. 없으면 https://git-scm.com 에서 설치. 확인: `git --version`
- 외부 npm 패키지는 없습니다. **`npm install` 을 하지 않아도** 바로 실행됩니다.

### 처음 받는 경우 (저장소가 아직 없을 때)

원하는 폴더에서 저장소를 받습니다. 받으면 `choi-bujang-secret-vault` 폴더가 생깁니다.

```
git clone https://github.com/kwonbhin/choi-bujang-secret-vault
cd choi-bujang-secret-vault
```

### 이미 받아 둔 경우

그 `choi-bujang-secret-vault` 폴더로 이동해 최신 코드를 받습니다.

```
git pull
```

## Windows (학원 PC · 수업 기준 환경)

`on-client` 폴더에서 PowerShell을 열고:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\start-alekov.ps1
```

- 예제 화면으로 켜려면 끝에 `-Demo` 를 붙입니다.
- 브라우저에서 `http://127.0.0.1:5189/` 를 엽니다. 끄기는 실행 창에서 `Ctrl+C`.
- Windows에서는 「내 PC 점검」의 다섯 항목(CPU·메모리·디스크·방화벽·Windows 기록)을 모두 읽을 수 있습니다.

## Mac

`on-client` 폴더에서 터미널을 열고:

```bash
npm start          # 기본 실행(서버 연결 안 함)
npm run demo       # 예제 화면
```

- 브라우저에서 `http://127.0.0.1:5189/` 를 엽니다. 끄기는 `Ctrl+C`.
- Mac에서는 방화벽·Windows 기록을 읽지 않으므로 「내 PC 점검」이 **실측 3/5 · 확인 불가 2개**로 나옵니다. 고장이 아니라 정상입니다.
- 계정 연결·AI 연결 설정은 Windows PC에 만들어 두었으므로 Mac에서는 연결되지 않을 수 있습니다.

## 화면에서 무엇을 보면 되나

| 메뉴 | 볼 것 |
|---|---|
| 보호 현황 | 맨 아래 학생 칸의 「내 PC 점검」 → 「내 PC 다시 조회」. 요약 한 줄, 상태 카드, 근거와 한계, 조회 기록 |
| 업무 앱 | 앱 하나를 눌러 판정(허용·거부·추가 확인·확인 불가)과 「다음에 할 일」 확인 |
| 보안 기록 | 걸러 보기, 기록 상세, AI 설명 요청 |

## 막힐 때 (처음 보는 사람이 자주 겪는 것)

| 증상 | 원인 | 할 일 |
|---|---|---|
| `git: command not found` 또는 `git pull`이 안 됨 | Git이 없거나 저장소를 아직 안 받음 | Git 설치 후 위 「처음 받는 경우」의 `git clone`부터 |
| `node: command not found` 또는 `지금 Node.js 는 …` | Node 없음·버전 밖(22~24 아님) | Node.js 22~24 설치 후 창을 **새로 열고** 다시 |
| 브라우저에 `ERR_CONNECTION_REFUSED`("연결 거부") | 서버가 안 켜졌거나 실행 창을 닫음 | 실행 창을 **켜 둔 채로** `http://127.0.0.1:5189/` 새로고침. 창이 꺼졌으면 실행 명령을 다시 |
| `포트 5189 를 다른 프로그램이 쓰고 있습니다` | 5189를 다른 프로그램이 사용 중 | Windows: 명령 끝에 `-Port 5190` · Mac: `ON_PORT=5190 npm start`. 브라우저도 `:5190`으로 |
| PowerShell이 스크립트를 막음 | 실행 정책 | 명령에 이미 `-ExecutionPolicy Bypass`가 있음(이번 실행만 적용). 그래도 막히면 차단 문구를 담당자에게 전달 |
| ZIP 안에서 실행이 안 됨 | 압축 상태로는 실행 불가 | 받은 **저장소 폴더**(starter ZIP 아님)의 `on-client`에서 실행 |

## 알아 둘 것

- 상단의 「예제 데이터(demo)」나 「연결 없음」은 실제 서버 연결 성공이 아닙니다.
- 「확인 불가」는 정상도 안전도 아닙니다. 읽지 못했다는 뜻입니다.
- 앱은 자동으로 다시 조회하지 않습니다. 필요할 때 버튼을 직접 누르세요.
- API 키·토큰은 화면이나 저장소에 넣지 않습니다.
