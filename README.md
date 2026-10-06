# BYTE BACK 방어전 시작 틀 R5

이 저장소는 1단계에서 학생 본인이 GitHub 저장소와 Vercel 배포를 만드는 출발점입니다. 포함된 메모 네 건은 가상 자료입니다. 실제 학생 자료, 토큰, 비밀키를 넣지 마세요.

## 학생이 하는 일: 세 걸음

1. GitHub 계정을 만듭니다.
2. 방어전 1단계 카드의 **Deploy** 버튼을 누릅니다. Vercel에 GitHub로 로그인하고, 새 저장소가 **본인 계정의 Public 저장소**인지 확인한 뒤 Deploy를 누릅니다.
3. 배포가 끝나면 화면에 나온 `https://…vercel.app` 주소를 방어전 1단계 카드에 붙여넣고 제출합니다. 저장소 주소나 설정 파일은 적지 않습니다.

배포가 끝나면 `/`에서 점령된 가상 자료실을 볼 수 있습니다. `/data.json`에는 같은 가상 메모가 공개됩니다. 이 공개 상태를 확인하는 것이 1단계의 출발점입니다. 1단계 접수와 심판 판정은 포털에서 확인합니다.

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`을 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 생성합니다. 이 값이 없으면 빌드가 실패하므로, 성공한 것처럼 빈 주소를 내보내지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조해야 합니다.

`aleph.config.json`의 `repoUrl`과 `publicAppUrl`은 이전 제출 묶음 방식의 자리표시자입니다. 1단계에서는 학생이 편집하지 않습니다. 2단계 이후 코딩 도구가 필요한 설정과 보호 기능을 단계별로 작성합니다. `npm run bundle`과 `bundle-notes.json`도 1단계의 세 걸음에는 포함되지 않습니다.

로컬에서 가상 화면만 확인할 때는 `npm run build -- --local`을 사용합니다. 로컬 실행은 Vercel 배포나 심판 접수를 증명하지 않습니다. 저장소의 `src/attack-check.mjs`는 실제 배포가 된 뒤 `/data.json`을 비로그인으로 요청해 공개 가상 메모의 확인 표시를 읽습니다.

## 2단계: 자료를 코드 밖으로 옮겼습니다

- 가상 메모 네 건은 학습용 Supabase 테이블 `vault_notes`에 있습니다. 테이블을 만드는 SQL은 `supabase/notes.sql`입니다. 메모를 넣는 시드 파일 `supabase/seed.local.sql`은 `.gitignore`에 있어 저장소에 없습니다. 다시 넣을 때는 SQL Editor에서 `notes.sql`을 먼저 실행하고, 로컬의 시드 파일을 실행합니다. 로컬에 시드 파일이 없으면 Table Editor에서 직접 넣습니다. 테이블은 RLS가 켜져 있고, `anon`·`authenticated`에는 권한이 없으며, `service_role`만 `select`할 수 있습니다.
- 공개 `public/data.json`은 없어졌습니다. 빌드는 2단계부터 공개 data.json을 만들지 않습니다.
- 화면 `/`은 Vercel 서버 함수 `/api/notes`를 거쳐 메모를 읽습니다. 함수는 Vercel 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 씁니다. 키 값은 Vercel 프로젝트 설정의 Environment Variables에만 두고, 코드·Git·브라우저 파일·응답·로그에는 넣지 않습니다.
- 다시 실행: GitHub에 커밋을 올리면 Vercel이 다시 배포합니다. 배포 주소의 `/`와 `/api/notes`에서 메모 네 건을 확인합니다.

**남은 약점:** `/api/notes`는 아직 로그인 확인이 없는 공개 주소입니다. 키는 서버에 숨었지만, 이 주소를 아는 누구나 비로그인으로 메모 네 건을 읽을 수 있습니다. 3단계에서 로그인 확인을 붙여 막아야 합니다.

### 가상 메모 문장 검색 절차

메모 네 건에 공통으로 들어 있는 문장 `실습용 가상`을 세 곳에서 검색합니다. 이 검색은 학생이 스스로 하는 점검이며 심판 판정이 아닙니다.

1. GitHub 최신 파일: `git fetch origin` 뒤 `git grep -n "실습용 가상" origin/main`
2. 과거 공개 커밋: `git log --oneline -S "실습용 가상" origin/main`
3. 현재 배포 파일: 브라우저의 비로그인 창이나 `curl -s https://choi-bujang-secret-vault-tqlv.vercel.app/<경로>`로 `/`, `/data.json`, `/api/notes`, `/aleph.json`을 열고 같은 문장을 찾습니다. `/aleph.json`의 `step`과 `commit`으로 어느 커밋이 배포됐는지 확인합니다.

### 검색 결과 (2026-10-06, 2단계 변경을 커밋하기 전)

| 위치 | 결과 |
|---|---|
| GitHub 최신 `origin/main` (`e21bf94`) | `data.json`, `public/data.json`에 메모 네 건이 있음 |
| 과거 커밋 | `e21bf94 Initial commit`에 메모 네 건이 있음 |
| 다음에 올릴 로컬 파일 | `data.json`, `public/data.json`은 삭제됨. 메모 문장은 추적하지 않는 `supabase/seed.local.sql`에만 있음. README의 검색어 설명 줄은 제외 |
| 현재 배포 (`/aleph.json` 기준 step 1, `e21bf94`) | `/data.json` HTTP 200, 메모 네 건이 보임. `/` 본문에는 없음(화면이 불러옴). `/api/notes`는 404(아직 배포 전) |

**과거 노출은 해소되지 않았습니다.** 새 커밋을 올려도 `e21bf94`는 공개 저장소의 기록에 남고, 그 커밋으로 만든 옛 Vercel 배포 주소도 지우기 전까지는 `/data.json`을 내보낼 수 있습니다. 옛 커밋과 옛 배포가 남아 있는 한, 이 메모는 이미 공개된 것으로 봅니다.

**공개 API의 남은 약점:** 2단계를 배포하면 `/data.json`은 사라지지만 `/api/notes`가 비로그인 요청에도 메모 네 건을 돌려줍니다. 위치만 파일에서 함수로 바뀌었을 뿐, 누가 읽는지는 아직 확인하지 않습니다.

### 배포 설정

- `vercel.json`은 모든 경로에 `X-Content-Type-Options: nosniff` 헤더를 붙입니다.
- 빌드는 2단계부터 `public/data.json`만 지우고 `public/aleph.json`은 지우지 않습니다. 배포 빌드에서는 `aleph.json`을 현재 step으로 다시 씁니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 2단계부터는 자료 보호를 구현할 때 `public/data.json`을 복사하는 1단계 빌드 흐름도 함께 바꿔야 합니다. 3단계 이후의 로그인, 허용 경로, 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 1단계 이후 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 남아 있으며, 코딩 도구가 해당 단계의 최신 배포 주소와 Git 원격을 맞춘 뒤 사용합니다.
