# BYTE BACK 방어전 자료실 (현재 4단계)

1단계 시작 틀 R5로 만든 학생 본인의 자료실입니다. 메모는 모두 실습을 위한 가상 자료입니다. 실제 학생 자료, 비밀번호, 토큰, 서버 전용 키를 코드·Git·제출 묶음에 넣지 마세요.

- 배포 주소: https://choi-bujang-secret-vault-tqlv.vercel.app
- 저장소: https://github.com/kwonbhin/choi-bujang-secret-vault

## 지금 작동하는 기능

- 화면 `/`에서 Supabase Auth 이메일·비밀번호로 로그인·로그아웃합니다. 회원가입 화면은 없고, 시험 계정은 Supabase 대시보드에서 만듭니다. 화면에는 공개용 Project URL과 publishable key만 있습니다.
- 로그인한 사람은 자기 가상 메모만 보고 추가·수정·삭제합니다. 화면은 세션의 access token을 `Authorization: Bearer`로 보내고, 로그아웃 상태에서는 "로그인하면 자료가 보입니다."만 보여 줍니다.
- 메모 API (`aleph.config.json`의 `allowedRoutes`와 같음):

  | 경로 | 동작 |
  |---|---|
  | `GET /api/notes` | 로그인 사용자의 메모 배열 `[{id,title,body}]` |
  | `POST /api/notes` | `{id?, title, body}` 저장 → 201 `{id}` (id는 UUID, 없으면 서버가 만듦). 본문의 `owner_id`는 무시하고 검사된 사용자 ID로 저장 |
  | `GET /api/notes/:id` | 본인 메모면 `{id,title,body}`, 아니면 404 |
  | `PUT /api/notes/:id` | 본문 `{title, body}`. 본인 메모만 수정 → `{id,title,body}`, 아니면 404 |
  | `DELETE /api/notes/:id` | 본인 메모만 삭제 → `{id}`, 아니면 404. 지운 뒤 GET은 404 |

- 로그인 검사: 서버 함수는 시작 틀의 `src/verify-login.mjs`로 토큰을 검사합니다. 토큰이 없으면 401 `LOGIN_REQUIRED`, 검사에 실패하면 401 `INVALID_LOGIN`이고 자료는 보내지 않습니다. 발급자 정보는 `aleph.config.json`의 `identityProvider`에 있습니다(비밀 키 없음).
- 메모는 Supabase 테이블 `vault_notes`에 있고, 표의 칸 이름 `content`는 API에서만 `body`로 바꿔 부릅니다. 서버 함수는 Vercel 환경변수 `SUPABASE_URL`과 서버 전용 `SUPABASE_SECRET_KEY`를 쓰며, 키 값은 Vercel 설정 화면에만 둡니다.
- 공개 `/data.json`은 없습니다(404). 모든 경로에 `X-Content-Type-Options: nosniff` 헤더가 붙습니다.

## 4단계: 로그인해도 내 자료만 보이게 했습니다

두 겹으로 막습니다.

1. **API 소유자 검사** (`src/notes-api.mjs`): 한 건 읽기·수정·삭제 조회마다 `owner_id = 검사된 사용자 ID` 조건을 함께 겁니다. 소유자를 확인하는 단계와 바꾸는 단계가 한 조회라서 그 사이에 틈이 없습니다. 사용자는 토큰으로만 정하고, URL·본문의 `owner_id`·`userId`는 믿지 않습니다. 수정은 `owner_id`를 바꾸지 않고 결과의 소유자를 다시 확인하며, 본문에 다른 `owner_id`·`userId`가 있으면 403 `OWNER_CHANGE_FORBIDDEN`입니다.
2. **404로 존재 숨김**: 남의 메모와 없는 메모는 본문까지 같은 `404 {"error":"NOTE_NOT_FOUND"}`로 답합니다. 403을 쓰면 "그 id의 메모는 있다"는 사실이 드러나 남의 id를 찾아볼 수 있기 때문입니다.
3. **DB RLS와 최소 권한** (`supabase/notes-rls.sql`): `vault_notes`의 PUBLIC·anon·authenticated 권한을 회수하고 authenticated에 SELECT·INSERT·UPDATE·DELETE만 줍니다. anon에는 아무 권한도 없습니다. 정책 4개는 모두 `authenticated` 대상이고 `(select auth.uid()) = owner_id`일 때만 허용합니다.

   | 정책 | 조건 |
   |---|---|
   | SELECT | 기존 행 `USING` |
   | INSERT | 새 행 `WITH CHECK` |
   | UPDATE | 기존 행 `USING` + 새 행 `WITH CHECK` (남에게 소유자 넘기기도 거부) |
   | DELETE | 기존 행 `USING` |

   service_role 권한은 바꾸지 않았습니다. 서버 함수는 service_role로 RLS를 거치지 않으므로, 서버 쪽의 소유자 검사는 1번 API 검사가 맡습니다.

## 남은 약점과 한계

- **POST 409로 id 사용 여부가 드러납니다.** 이미 있는 id로 POST하면 남의 메모여도 409 `NOTE_ID_TAKEN`입니다. 내용은 드러나지 않지만 그 id가 쓰이고 있다는 사실은 알 수 있습니다. 보통 id는 무작위 UUID라 추측하기 어렵지만, B 시험 메모처럼 고정 id는 알려져 있습니다. 클라이언트가 id를 정하는 `POST {id,…}` 형식을 유지해서 남긴 한계입니다.
- **Data API 직접 쓰기에는 길이 검사가 없습니다.** authenticated에 권한이 있으므로, 로그인한 사람이 publishable key와 자기 토큰으로 Data API를 직접 불러 자기 행을 읽고 쓸 수 있습니다. RLS 때문에 남의 행에는 닿지 못하지만, API의 제목 1~200자·내용 10000자 검사는 거치지 않습니다. DB에 `check` 제약을 더하면 막을 수 있습니다.
- **과거 노출은 해소되지 않았습니다.** 메모 문장은 공개 저장소의 옛 커밋 `e21bf94`(1단계)에 남아 있고, 그 커밋으로 만든 옛 Vercel 배포 주소도 지우기 전까지는 `/data.json`을 내보낼 수 있습니다. 옛 배포 주소는 따로 확인하지 않았습니다. 옛 커밋과 옛 배포가 남아 있는 한, 이 메모는 이미 공개된 것으로 봅니다.

## 다시 실행하는 방법

1. Supabase 대시보드 > SQL Editor에서 아래 순서대로 실행합니다. 뒤 파일이 앞 파일의 권한을 바꾸므로, 다시 실행할 때도 이 순서 전체를 지킵니다(예: `notes-write-grants.sql`만 다시 실행하면 authenticated 권한이 회수됩니다).

   | 순서 | 파일 | 하는 일 | 저장소 |
   |---|---|---|---|
   | 1 | `supabase/notes.sql` | 테이블·RLS 켜기·service_role select | 있음 |
   | 2 | `supabase/notes-write-grants.sql` | service_role insert·update·delete | 있음 |
   | 3 | `supabase/seed.local.sql` | 처음 가상 메모 네 건 | 없음(`.gitignore`) |
   | 4 | `supabase/owners.local.sql` | 처음 메모를 A에게 연결, B 시험 메모 한 건(고정 id `b0000000-0000-4000-8000-000000000001`) | 없음(`.gitignore`, 시험 계정 이메일 포함) |
   | 5 | `supabase/notes-rls.sql` | 권한 회수, authenticated 최소 권한, 본인 행 정책 4개, 적용 전후 대조 | 있음 |

   `*.local.sql`이 없으면 3·4번 대신 화면에서 로그인해 메모를 추가합니다. `notes-rls.sql`은 구역 [1]·[2]·[3]을 각각 선택해 실행하면 적용 전후 권한을 비교할 수 있습니다.
2. Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`를 Vercel 설정 화면에 직접 넣습니다.
3. `main`에 push하면 Vercel이 배포합니다. `/aleph.json`의 `step`과 `commit`으로 배포된 커밋을 확인합니다.
4. 로컬 확인: `npm ci` 뒤 `npm run build -- --local`, `npm run test:r5`, `npm run test:package`. 로컬 실행은 Vercel 배포나 심판 판정을 증명하지 않습니다.
5. 제출 묶음: `bundle-notes.json`(커밋하지 않음)에 이번 단계 설명을 적고 `npm run bundle`을 실행하면 `artifacts/submission.json`이 생깁니다. `src/attack-check.mjs`가 배포 주소와 Supabase Data API(화면의 publishable key 사용)로 실제 보낸 요청 결과만 기록하며, 학생 자기 점검이지 심판 판정이 아닙니다. 시험 계정 비밀번호가 필요한 점검은 넣지 않았습니다.

## 단계 기록

- **1단계 (`e21bf94`)**: 시작 틀을 Vercel에 배포했습니다. 가상 메모 네 건이 공개 `/data.json`으로 누구에게나 보였습니다.
- **2단계 (`029641b`)**: 메모를 Supabase `vault_notes`로 옮기고 공개 `data.json`을 지웠습니다. 화면은 서버 함수 `/api/notes`로 읽었지만, 이 함수에 로그인 확인이 없어 누구나 읽을 수 있었습니다.
- **3단계 (`a31fb32`, `a29bc06`, `d5109ff`, 저장점 `02a6c4b`)**: 로그인·로그아웃 화면, 토큰 검사가 붙은 자료 API, 로그인 사용자의 메모 추가·수정·삭제를 붙였습니다. 이때는 소유자 검사가 없어 B가 A의 메모를 고칠 수 있었습니다.
- **4단계 (`223faf0`, `ec093bc`, 이 저장점)**: API 소유자 검사와 404 존재 숨김, `vault_notes` RLS 본인 행 정책 4개와 최소 권한을 붙였습니다.

## 가상 메모 문장 검색 절차

처음 메모 네 건에 공통으로 들어 있는 문장 `실습용 가상`을 검색합니다. 학생이 스스로 하는 점검이며 심판 판정이 아닙니다. README의 이 절차 설명 줄은 검색어 자체이므로 결과에서 뺍니다.

1. GitHub 최신 파일: `git fetch origin` 뒤 `git grep -n "실습용 가상" origin/main`
2. 과거 공개 커밋: `git log --oneline -S "실습용 가상" origin/main`
3. 현재 배포: 비로그인 창이나 `curl -s https://choi-bujang-secret-vault-tqlv.vercel.app/<경로>`로 `/`, `/data.json`, `/api/notes`, `/aleph.json`을 열고 같은 문장을 찾습니다.

### 검색 결과 (2026-10-06, 4단계 저장점 직전 `ec093bc` 기준)

| 위치 | 결과 |
|---|---|
| GitHub 최신 `origin/main` (`ec093bc`) | README 검색어 설명 줄 말고는 메모 문장이 없음 |
| 과거 커밋 | `e21bf94`(메모를 넣은 커밋)와 `029641b`(메모를 지운 커밋)가 나옴. `e21bf94`의 `data.json`, `public/data.json`에는 메모 네 건이 그대로 있음 |
| 현재 배포 (`ec093bc`) | `/` 200, `/data.json` 404, `/api/notes` 401, `/aleph.json` 200. 네 경로 모두 메모 문장 0건 |
| 옛 배포 주소 | 확인하지 않음 |

## 시작 틀의 자동 처리

`vercel.json`은 정적 결과물 `public`과 `api/` 서버 함수를 배포합니다. 빌드 명령 `npm run build`는 Vercel이 제공하는 GitHub 저장소 소유자·이름, 커밋 SHA, 배포 URL을 검증하고 `public/aleph.json`을 만듭니다. 이 값이 없으면 빌드가 실패합니다. 2단계부터 빌드는 공개 `public/data.json`을 만들지 않고, `public/aleph.json`은 지우지 않습니다. `aleph.json`의 내용만으로 저장소 소유권이나 방어 성공을 인정하지 않습니다. 심판이 공개 저장소의 실제 커밋과 배포된 자료를 따로 대조합니다.

## 다음 단계의 코딩 도구에 전달할 규칙

[AGENTS.md](AGENTS.md)를 먼저 읽히고 한 번에 한 제작 단위만 요청하세요. 5단계의 원본 API 주소, 6단계 이후 정책 규칙은 해당 단계 원고와 계약에 맞춰 추가합니다. 비밀번호·토큰·서버 전용 키·실제 학생 기록을 코드, Git, 제출 묶음에 넣지 않습니다.

`src/decider.mjs`와 `src/detect.mjs`의 로컬 시험은 반 엔진이나 운영 심판의 결과가 아닙니다. 제출 묶음 계약 `aleph.defense.submission.v2`는 `scripts/bundle.mjs`에 있습니다.
