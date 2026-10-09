# BYTE BACK 방어전 자료실 (현재 5단계)

1단계 시작 틀 R5로 만든 학생 본인의 자료실입니다. 메모는 모두 실습을 위한 가상 자료입니다. 실제 학생 자료, 비밀번호, 토큰, 서버 전용 키를 코드·Git·제출 묶음에 넣지 마세요.

- 배포 주소: https://choi-bujang-secret-vault-tqlv.vercel.app
- 저장소: https://github.com/kwonbhin/choi-bujang-secret-vault

## 지금 작동하는 기능

- 화면 `/`의 로그인·로그아웃은 서버 함수 `/api/auth/*`를 거쳐 Supabase Auth 이메일·비밀번호로 합니다. 회원가입 화면은 없고, 시험 계정은 Supabase 대시보드에서 만듭니다. 화면 코드에는 Supabase 주소·publishable key·supabase-js가 없습니다.
- 로그인한 사람은 자기 가상 메모만 보고 추가·수정·삭제합니다. 화면은 access token을 `Authorization: Bearer`로 `/api/notes`에 보내고, 로그아웃 상태에서는 "로그인하면 자료가 보입니다."만 보여 줍니다.
- 메모 API (`aleph.config.json`의 `allowedRoutes`와 같음):

  | 경로 | 동작 |
  |---|---|
  | `GET /api/notes` | 로그인 사용자의 메모 배열 `[{id,title,body}]` |
  | `POST /api/notes` | `{id?, title, body}` 저장 → 201 `{id}` (id는 UUID, 없으면 서버가 만듦). 본문의 `owner_id`는 무시하고 검사된 사용자 ID로 저장 |
  | `GET /api/notes/:id` | 본인 메모면 `{id,title,body}`, 아니면 404 |
  | `PUT /api/notes/:id` | 본문 `{title, body}`. 본인 메모만 수정 → `{id,title,body}`, 아니면 404 |
  | `DELETE /api/notes/:id` | 본인 메모만 삭제 → `{id}`, 아니면 404. 지운 뒤 GET은 404 |

- 로그인 API (자료 경로가 아니므로 `allowedRoutes`에 넣지 않음, 모두 JSON 본문의 POST만):

  | 경로 | 동작 |
  |---|---|
  | `POST /api/auth/login` | `{email, password}` → `{access_token, expires_at, user:{email}}`, refresh token은 HttpOnly 쿠키 |
  | `POST /api/auth/refresh` | 쿠키의 refresh token으로 새 access token |
  | `POST /api/auth/logout` | 쿠키를 지우고 Supabase 세션을 끝냄 |

- 로그인 검사: 메모 API는 시작 틀의 `src/verify-login.mjs`로 토큰을 검사합니다. 토큰이 없으면 401 `LOGIN_REQUIRED`, 검사에 실패하면 401 `INVALID_LOGIN`이고 자료는 보내지 않습니다. 발급자 정보는 `aleph.config.json`의 `identityProvider`에 있습니다(비밀 키 없음).
- 서버 함수의 Vercel 환경변수: `SUPABASE_URL`, 서버 전용 `SUPABASE_SECRET_KEY`(메모 API), `SUPABASE_PUBLISHABLE_KEY`(로그인 API). 값은 Vercel 설정 화면에만 둡니다.
- 메모는 Supabase 테이블 `vault_notes`에 있고, 표의 칸 이름 `content`는 API에서만 `body`로 바꿔 부릅니다.
- 공개 `/data.json`은 없습니다(404). 모든 경로에 `X-Content-Type-Options: nosniff` 헤더가 붙습니다.

## 5단계: 자료 요청을 서버 한곳으로 모았습니다

- **메모 요청은 서버 함수로만**: 화면은 메모를 `/api/notes`로만 읽고 씁니다. `vault_notes`의 PUBLIC·anon·authenticated 직접 권한을 테이블·칸 단위 모두 회수했습니다(`supabase/notes-revoke-direct.sql`). 그래서 publishable key나 로그인 토큰으로 Data API를 직접 불러도 `42501`로 거부되고, 서버 함수(service_role)만 읽고 씁니다. 원본 자료 API 주소는 `aleph.config.json`의 `originalApiUrl`입니다.
- **로그인도 서버 함수로**: 화면에서 supabase-js와 publishable key, Project URL을 뺐습니다. 로그인 서버 함수는 비밀번호·토큰·이메일을 로그에 남기지 않고 오류 코드만 남깁니다. 로그인 실패 이유(이메일·비밀번호 불일치, 이메일 미인증, 정지된 계정, 시도 횟수 초과)는 전처럼 화면에 보입니다.
- **토큰 보관**: access token은 화면 메모리 변수에만 두고 브라우저 저장소에 쓰지 않습니다. refresh token은 응답 본문에 넣지 않고 `HttpOnly; Secure; SameSite=Strict; Path=/api/auth` 쿠키로만 둡니다. 화면 스크립트가 읽을 수 없어 XSS로 빼 가기 어렵고, 다른 사이트의 요청에는 실리지 않습니다. 새로고침하면 쿠키로 로그인을 되살리고, 만료 1분 전에 자동 갱신합니다.
- **4단계에서 이어진 방어**: 메모 API의 소유자 검사(남의 메모와 없는 메모는 같은 404), `vault_notes`의 RLS 본인 행 정책 4개는 그대로입니다. 정책은 직접 권한을 회수한 지금은 쓰이지 않지만, 실수로 authenticated 권한이 되살아나도 본인 행만 열리도록 남겨 두었습니다.

## 남은 약점과 한계

- **POST 409로 id 사용 여부가 드러납니다.** 이미 있는 id로 POST하면 남의 메모여도 409 `NOTE_ID_TAKEN`입니다. 내용은 드러나지 않지만 그 id가 쓰이고 있다는 사실은 알 수 있습니다. 클라이언트가 id를 정하는 `POST {id,…}` 형식을 유지해서 남긴 한계입니다.
- **로그인 횟수 제한이 서버 IP 기준이 됩니다.** 로그인 요청이 모두 Vercel 서버에서 Supabase로 가므로, Supabase의 IP별 로그인 제한을 사용자별이 아니라 Vercel 쪽에서 함께 씁니다.
- **로그아웃은 이 기기 세션만 끝냅니다**(`scope=local`). refresh 쿠키는 최대 7일 유지됩니다.
- **공개 키와 메모 문장은 옛 커밋과 옛 배포에 남아 있습니다.** publishable key는 커밋 `a31fb32`~`b11b79c`의 `public/index.html`에, 메모 문장은 `e21bf94`(1단계)에 있습니다. 그 커밋으로 만든 옛 Vercel 배포 주소도 지우기 전까지는 내보낼 수 있으며, 옛 배포 주소는 따로 확인하지 않았습니다. 옛 커밋과 옛 배포가 남아 있는 한, 과거 노출은 해소되지 않았습니다. publishable key는 원래 공개용이며, 직접 권한 회수로 이 키만으로는 `vault_notes`에 닿지 못합니다.
- 4단계의 "Data API 직접 쓰기에는 길이 검사가 없음" 한계는 authenticated 직접 권한을 회수해 더는 해당하지 않습니다.

## 보너스: 무차별 로그인 경보 (`xdr/brute-force`)

- `decide.mjs`가 경보 하나를 block·alert·record로 판단합니다(`npm run xdr:run -- brute-force`). 근거 패턴은 `patterns.json`(T1110.001, T1110.003)입니다.
- `node xdr/brute-force/respond.mjs`는 block 후보를 거부 규칙 후보로 `xdr/deny-rules.json`에 쌓고, block·alert 알림을 `xdr/alerts.log`에 JSON 한 줄씩 덧붙입니다.
- `xdr/deny-rules.json` 모양: `{schema: "aleph.xdr.deny-rules.v1", contractMatch: null, updatedAt, rules: [{id, ruleId: "xdr_brute_force_block", decision: "deny", reasonCode: "xdr_brute_force", target: {kind: "source_ip", value}, createdAt, expiresAt, evidenceAlertIds, patterns, confidence}]}`. 규칙은 만든 뒤 60분에 만료되고, 같은 주소는 근거를 합칩니다. 계정은 막지 않고, 같은 묶음에서 정상(record)으로 나온 주소도 막지 않습니다.
- **판정기에 연결하지 않았습니다.** `docs/DECIDER_REQUEST.md` 요청에는 출발 주소가 없어 `src/decider.mjs`가 이 규칙을 요청과 맞출 수 없고, `xdr_brute_force`는 운영 등록부에 없는 이유 코드입니다. 배포된 `/api/notes` 동작은 그대로입니다. 로컬 연습 결과이며 심판 판정이 아닙니다.

## 다시 실행하는 방법

1. Supabase 대시보드 > SQL Editor에서 아래 순서대로 실행합니다. 뒤 파일이 앞 파일의 권한을 바꾸므로, 다시 실행할 때도 이 순서 전체를 지킵니다(예: `notes-rls.sql`만 다시 실행하면 authenticated 직접 권한이 되살아납니다).

   | 순서 | 파일 | 하는 일 | 저장소 |
   |---|---|---|---|
   | 1 | `supabase/notes.sql` | 테이블·RLS 켜기·service_role select | 있음 |
   | 2 | `supabase/notes-write-grants.sql` | service_role insert·update·delete | 있음 |
   | 3 | `supabase/seed.local.sql` | 처음 가상 메모 네 건 | 없음(`.gitignore`) |
   | 4 | `supabase/owners.local.sql` | 처음 메모를 A에게 연결, B 시험 메모 한 건(고정 id `b0000000-0000-4000-8000-000000000001`) | 없음(`.gitignore`, 시험 계정 이메일 포함) |
   | 5 | `supabase/notes-rls.sql` | 본인 행 정책 4개, authenticated 권한(6번에서 다시 회수) | 있음 |
   | 6 | `supabase/notes-revoke-direct.sql` | PUBLIC·anon·authenticated 직접 권한 회수, 적용 전후 대조 | 있음 |

   `*.local.sql`이 없으면 3·4번 대신 화면에서 로그인해 메모를 추가합니다. 대조 조회가 있는 파일은 구역 [1]·[2]·[3]을 각각 선택해 실행하면 적용 전후 권한을 비교할 수 있습니다.
2. Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`를 Vercel 설정 화면에 직접 넣습니다.
3. `main`에 push하면 Vercel이 배포합니다. `/aleph.json`의 `step`과 `commit`으로 배포된 커밋을 확인합니다.
4. 로컬 확인: `npm ci` 뒤 `npm run build -- --local`, `npm run test:r5`, `npm run test:package`. 로컬 실행은 Vercel 배포나 심판 판정을 증명하지 않습니다.
5. 제출 묶음: `bundle-notes.json`(커밋하지 않음)에 이번 단계 설명을 적고 `npm run bundle`을 실행하면 `artifacts/submission.json`이 생깁니다. `src/attack-check.mjs`가 배포 주소와 `originalApiUrl`로 실제 보낸 요청 결과만 기록하며, 학생 자기 점검이지 심판 판정이 아닙니다. 시험 계정 비밀번호가 필요한 점검은 넣지 않았습니다. anon 점검의 publishable key는 파일에 저장하지 않고 실행 명령에서만 넘깁니다. 키를 넘기지 않으면 그 두 점검은 "미실행"으로 기록됩니다.
   - Git Bash: `SUPABASE_PUBLISHABLE_KEY=<publishable key> npm run bundle`
   - PowerShell: `$env:SUPABASE_PUBLISHABLE_KEY='<publishable key>'; npm run bundle; Remove-Item Env:SUPABASE_PUBLISHABLE_KEY`

## 단계 기록

- **1단계 (`e21bf94`)**: 시작 틀을 Vercel에 배포했습니다. 가상 메모 네 건이 공개 `/data.json`으로 누구에게나 보였습니다.
- **2단계 (`029641b`)**: 메모를 Supabase `vault_notes`로 옮기고 공개 `data.json`을 지웠습니다. 화면은 서버 함수 `/api/notes`로 읽었지만, 이 함수에 로그인 확인이 없어 누구나 읽을 수 있었습니다.
- **3단계 (`a31fb32`, `a29bc06`, `d5109ff`, 저장점 `02a6c4b`)**: 로그인·로그아웃 화면, 토큰 검사가 붙은 자료 API, 로그인 사용자의 메모 추가·수정·삭제를 붙였습니다. 이때는 소유자 검사가 없어 B가 A의 메모를 고칠 수 있었습니다.
- **4단계 (`223faf0`, `ec093bc`, 저장점 `ddd8e80`)**: API 소유자 검사와 404 존재 숨김, `vault_notes` RLS 본인 행 정책 4개와 최소 권한을 붙였습니다.
- **5단계 (`b11b79c`, `85e9eb9`, 이 저장점)**: `vault_notes` 직접 권한 회수와 `originalApiUrl`, 로그인·토큰 갱신·로그아웃의 서버 함수 이전, 화면에서 공개 키 제거.

## 가상 메모 문장 검색 절차

처음 메모 네 건에 공통으로 들어 있는 문장 `실습용 가상`을 검색합니다. 학생이 스스로 하는 점검이며 심판 판정이 아닙니다. README의 이 절차 설명 줄은 검색어 자체이므로 결과에서 뺍니다(`src/attack-check.mjs`는 이 문장을 유니코드 이스케이프로 적어 검색에 걸리지 않습니다).

1. GitHub 최신 파일: `git fetch origin` 뒤 `git grep -n "실습용 가상" origin/main`
2. 과거 공개 커밋: `git log --oneline -S "실습용 가상" origin/main`
3. 현재 배포: 비로그인 창이나 `curl -s https://choi-bujang-secret-vault-tqlv.vercel.app/<경로>`로 `/`, `/data.json`, `/api/notes`, `/aleph.json`을 열고 같은 문장을 찾습니다.

### 검색 결과 (2026-10-06, 5단계 저장점 직전 `85e9eb9` 기준)

| 위치 | 결과 |
|---|---|
| GitHub 최신 `origin/main` (`85e9eb9`) | README 검색어 설명 줄 말고는 메모 문장이 없음 |
| 과거 커밋 | `e21bf94`(메모를 넣은 커밋)와 `029641b`(메모를 지운 커밋)가 나옴. `e21bf94`의 `data.json`, `public/data.json`에는 메모 네 건이 그대로 있음 |
| 현재 배포 (`85e9eb9`) | `/`·`/index.html` 200, `/data.json` 404, `/api/notes` 401, `/aleph.json` 200. 다섯 경로 모두 메모 문장·`sb_publishable_`·`sb_secret_` 0건 |
| 옛 배포 주소 | 확인하지 않음 |

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`과 `api/` 서버 함수를 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 만듭니다. 이 값이 없으면 빌드가 실패합니다. 2단계부터 빌드는 공개 `public/data.json`을 만들지 않고, `public/aleph.json`은 지우지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 6단계 이후 정책 규칙은 `docs/DECIDER_REQUEST.md`의 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 있습니다.
