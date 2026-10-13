# BYTE BACK 방어전 자료실 (현재 10단계)

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

## 6단계: 등록한 기기만 자료실에 들어옵니다

- **판정기 규칙 `device_registered`** (`src/decider.mjs`): `request.deviceRegistered`가 `true`가 아니면 `deny`·`device_not_registered`입니다. 등록 기기의 메모 읽기(`method`가 `GET`, `service`가 `notes`, `route`가 `GET /notes` 또는 `GET /notes/:id`)만 `allow`·`approved`이고, 그 밖의 요청은 시작 틀의 `starter.deny`로 거부합니다.
- **경로는 계약 표기로 봅니다.** 엔진이 넘기는 `route`는 `GET /notes/:id`처럼 `/api` 없이 오고 서비스는 `service: "notes"`로 따로 옵니다(`docs/DECIDER_REQUEST.md`). `aleph.config.json`의 `allowedRoutes`(`GET /api/notes/:id`)는 배포 경로 표기라 문자열이 맞지 않으므로 판정기에서 비교하지 않습니다.
- **`deviceRegistered`는 정확히 `true`일 때만 등록입니다.** `"true"`, `1`, 값 없음처럼 형식이 틀린 값을 등록으로 잘못 읽으면 미등록 기기가 들어오므로, 확실한 경우만 허용하고 나머지는 거부합니다.
- **기기-사용자 짝 검사는 엔진이 맡습니다.** 계약에는 `subjectId`와 `deviceId`를 묶는 값이 없습니다. 판정기에 임의의 짝 표를 만들지 않고, 엔진이 신원·기기를 확인한 뒤 넘긴 값만 씁니다.
- **확인 순서** (로컬 가상 요청 연습이며 심판 판정이 아닙니다. 따로 설치할 접속 프로그램은 없고, 실제 미등록 기기 공격은 심판이 맡습니다):
  1. `npm ci` (처음 한 번)
  2. `npm run decider:test`
  3. 정상: `통과 · 등록 기기의 정상 요청` (등록 기기의 `GET /notes/:id` → `allow`·`approved`)
  4. 거부되어야 할 결과: `통과 · 미등록 기기의 가상 요청` (`deviceRegistered: false` → `deny`·`device_not_registered`). "확인 필요"가 나오면 첫 줄만 보고 `src/decider.mjs`를 고칩니다.

## 7단계: 평소와 다른 접속은 다시 확인합니다

- **판정기 규칙 `step_up_required`** (`src/decider.mjs`): 등록 기기의 메모 읽기에서 평소와 다른 시각(`signals.hour`가 0~5시), 처음 보는 네트워크(`signals.network`가 `unusual`), 갑자기 많은 읽기(`recentEvents`의 최근 10분 `count` 합이 10 초과)가 **함께** 보이면 `step_up`·`step_up_required`로 추가 확인을 요청합니다. 하나만 다르면 허용합니다.
- **판단 순서**: 미등록 기기 거부(`device_registered`) → 메모 읽기가 아니면 `starter.deny` → 복합 이상이면 `step_up` → 허용. 미등록 기기는 접속 정보와 상관없이 먼저 거부됩니다.
- **시각 기준의 근거와 한계**: 계약에는 `hour`의 시간대도, 엔진이 "평소와 다른 시각"을 판단한 값도 없습니다. 시간대를 추측하지 않고 연습 요청(`scripts/fixture-7.mjs`)의 정상 14시·이상 3시를 근거로 새벽 0~5시만 평소와 다른 시각으로 봅니다. 엔진의 `hour`가 어느 시간대인지 확인되면 이 범위를 다시 맞춰야 합니다. 처음 보는 네트워크는 엔진이 판단해 넘기는 `signals.network`의 `unusual` 값을 그대로 씁니다.
- **지역만으로 막지 않습니다.** `signals.region`은 판단에 쓰지 않고, 영구 차단도 없습니다. 거부·추가 확인 사유는 `reasonCode`와 `ruleIds`로 남습니다(응답은 계약의 다섯 항목만).
- **입력 검사**: 접속 정보는 엔진이 만든 `signals`(`{source, region, network, hour}`), `recentEvents`(`{kind, ageSeconds, count}` 최대 12건), `stepUp`(`{verified, authAgeSeconds}`)만 씁니다. 계약은 브라우저 헤더를 넘기지 않고 판정기도 헤더를 읽지 않습니다. `signals.source`가 계약의 `none`·`judge_fixture`가 아니거나, 항목이 빠지거나 더해졌거나, `hour`가 0~23 정수가 아니면 정상으로 채우지 않고 `step_up`으로 보냅니다. 실제 경로의 `source: "none"`은 위치 증거가 없다는 뜻이라 정상값으로 바꾸지 않고, 시각·네트워크 판단을 하지 않습니다.
- **재로그인 뒤 다시 판정**: 계약의 `stepUp`에서 `verified`가 정확히 `true`이고 `authAgeSeconds`가 0~300초 정수일 때만 다시 확인된 것으로 보고 허용합니다. 문자열 `"true"`나 300초를 넘긴 확인은 다시 `step_up`입니다. 토큰 원문은 판정 요청에 없고 기록하지도 않습니다.
- **실제 자료 차단은 미실행**: 재로그인 화면과 확인 전 자료 차단은 반 엔진·릴레이가 합니다. 이 저장소의 `api/`는 판정기를 부르지 않으므로 학생이 직접 시험할 수 없어, 제출 묶음에 "미실행"으로 남깁니다.
- **확인 순서** (로컬 가상 요청 연습이며 심판 판정이 아닙니다):
  1. `npm run decider:test`
  2. 정상: `통과 · 등록 기기의 정상 요청`, `통과 · 다시 확인한 복합 이상 접속` (추가 인증 60초 뒤 `allow`)
  3. 거부·추가 확인되어야 할 결과: `통과 · 미등록 기기의 가상 요청` (`deny`·`device_not_registered`), `통과 · 복합 이상 접속` (`step_up`·`step_up_required`)
  4. `npm run fixture:7`: `정상 사건: allow`, `복합 이상 사건: step_up`

## 8단계: 자료마다 갈 수 있는 구역을 나눕니다

- **자원 ID**: 판정기의 `resourceOf(request)`가 엔진이 확인한 `route`·`method`·`service`·`path`로 자원을 정하고, 종류를 앞에 붙여 메모 `note:<id>`와 강사 공지 `notice:<id>`를 구별합니다. 메모의 배포 주소 `/api/notes`, `/api/notes/:id`와 메모 자료는 그대로입니다.
- **구역 규칙** (`src/decider.mjs`, 계약의 정확한 route 표기만 허용):

  | route | 결정 | 규칙 |
  |---|---|---|
  | `GET /notes/:id` | `allow`·`approved` (7단계 복합 이상이면 `step_up`) | `zone_note_read` |
  | `PUT /notes/:id` | `allow`·`approved` (7단계 복합 이상이면 `step_up`) | `zone_note_update` |
  | `POST`·`PUT`·`PATCH`·`DELETE` `/notices`, `/notices/:id` | 항상 `deny`·`instructor_role_contract_missing` | `zone_notice_update` |
  | 그 밖의 route(메모 전체 목록 `GET /notes` 포함), 쿼리가 붙은 요청(`queryLength`가 0이 아님), `:id` 자리의 기능 이름(`export` 등), method·service·path가 route와 맞지 않는 요청 | `deny`·`starter_not_ready` | `starter.deny` |

- **판단 순서**: 미등록 기기 거부(`device_registered`) → 구역 표에 없으면 `starter.deny` → 공지 쓰기 거부 → 7단계 복합 이상이면 `step_up` → 허용.
- **메모 주인은 API가 검사합니다.** 계약에는 자원의 주인이 없고 `subjectId`는 가명이라 판정기는 주인을 비교하지 않습니다. 그래서 B가 A의 메모를 요청해도 판정기에서는 경로상 `allow`이고, `/api/notes/:id`의 `owner_id` 조건(4단계)이 404 `NOTE_NOT_FOUND`로 막습니다. 판정기는 메모 한 건 단위로만 허용하고, 메모 전체 목록 `GET /notes`는 판정기에서 거부합니다. `vault_notes`의 RLS 본인 행 정책은 직접 권한을 회수해 지금은 쓰이지 않으며, 권한이 되살아날 때를 대비해 남겨 두었습니다(서버 함수의 service_role은 RLS를 거치지 않습니다).
- **강사 역할 계약이 없습니다.** 계약에 `request.role`이 없어 판정기는 누구도 강사로 보지 않고, 공지 쓰기(추가·수정·삭제)는 항상 거부합니다. 사용자·강사 목록 상수표는 만들지 않았습니다. 운영 엔진이 확인한 역할을 계약으로 넘겨주면 `zone_notice_update`에 허용 조건을 더할 수 있습니다. `instructor_role_contract_missing`은 운영 등록부에 아직 없는 이유 코드라 엔진이 받지 않을 수 있지만, 그때도 결과는 거부입니다.
- **공지 API는 만들지 않았습니다.** 수정할 수 있는 사람이 없는 동안 항상 거부될 서버 함수를 새로 열지 않았습니다. 그래서 `allowedRoutes`는 바꾸지 않았습니다(배포된 자료 API 경로가 그대로입니다).
- **기능은 경로·쿼리로 고르지 않습니다.** 쿼리는 자료 ID를 고르는 데도 쓰지 않으며, `:id`와 같은 깊이에 `export` 같은 기능 경로를 만들지 않았습니다.
- **한계**: `GET /api/notes`(목록), `POST /api/notes`(추가), `DELETE /api/notes/:id`(삭제)는 구역 표에 없어 판정기를 거치면 거부됩니다. 화면은 지금처럼 `/api/notes`를 직접 부르므로 목록·추가·삭제는 그대로 작동합니다(이 저장소의 `api/`는 판정기를 부르지 않습니다).
- **확인 순서** (로컬 가상 요청 연습이며 심판 판정이 아닙니다):
  1. `npm run decider:test`: 6·7단계 시험 네 줄이 모두 `통과`입니다. 이 스크립트에는 8단계 시험이 없습니다.
  2. `npm run bundle`의 8단계 점검: 메모 수정은 `allow`, 공지 수정·삭제는 `deny`·`instructor_role_contract_missing`, 메모 전체 목록·모르는 경로·쿼리 기능·`/notes/export`는 `deny`·`starter_not_ready`로 기록됩니다.
  3. 거부되어야 할 결과가 `allow`로 나오면 `src/decider.mjs`의 `ZONES`와 `resourceOf`를 확인합니다.

## 9단계: 도플갱어를 찾고 권한을 거둡니다

- **탐지기 `src/detect.mjs`** (계약 `docs/DETECT_EVENTS.md`, 시험 `scripts/detect-test.mjs`): 사건마다 계약의 `at`, `method`, `identity.sub` 세 값만 읽습니다. 메모 내용·토큰·실명 같은 다른 칸은 읽지도 저장하지도 출력하지도 않고, 형식이 틀린 사건은 세지 않습니다.
- **탐지 규칙 `burst_read`**: 같은 `identity.sub`의 `GET` 사건이 어느 10분 구간에서든 120건을 넘을 때만 `{ action: 'propose_revocation', reasonCode: 'burst_read', subject: <sub> }`, 그 밖에는 `{ action: 'observe' }`입니다. 정확히 120건, 다른 사용자의 사건 합산, 10분 밖으로 흩어진 사건(정확히 10분 떨어진 사건 포함)은 제안하지 않습니다. 여러 사용자가 넘으면 가장 먼저 넘은 한 명만 제안합니다.
- **과제 화면 문구와 계약이 다릅니다. 계약을 따랐습니다.** 화면은 "낯선 네트워크 + 다량 조회일 때만, 대상은 가상 기기 한 개"라고 하지만, 계약의 사건에는 네트워크·지역·기기·판정 칸이 없고, 회수 대상은 `subject`(가명 사용자)이며, 다량 조회만으로 제안합니다(121건 시험). 계약에 없는 칸을 지어내면 반 엔진이 보내는 사건과 맞지 않고 `npm run detect:test`도 실패하므로 만들지 않았습니다. 기준값 "10분 120건 초과"도 계약값이며, 7단계 판정기의 "10분 10건 초과"와 다른 값입니다.
- **제안만 하고 집행하지 않습니다.** 회수 API를 만들지 않았고 기기·사용자 권한을 바꾸지 않습니다. 판정기의 응답 형식과 규칙은 그대로입니다. 운영 반 엔진이 검증한 사건 전달과 회수 집행은 이 저장소와 연결되지 않았습니다.
- **한계**: 같은 사건이 중복으로 오면 그대로 셉니다(계약에 사건 ID가 없어 같은 시각의 실제 조회와 중복을 구별할 수 없음).
- **한계**: `method`는 계약 표기대로 대문자 `GET`만 셉니다(소문자 `get`은 세지 않음).
- **확인 순서** (가상 사건 연습이며 실제 접속 회수나 심판 판정이 아닙니다):
  1. `npm run detect:test`
  2. 정상: `통과 · 정상 조회 30건`, `통과 · 10분 안에 120건`, `통과 · 서로 다른 사용자 각 100건`, `통과 · 10분 밖으로 흩어진 조회 200건` (모두 `observe`)
  3. 회수 제안이 나와야 할 결과: `통과 · 10분 안에 121건`, `통과 · 폭주 조회 200건` (`propose_revocation`·`burst_read`)
  4. `npm run decider:test`도 그대로 네 줄 `통과`입니다.

## 10단계: 백업에서 자료실을 되살립니다

10단계 계약(복구 경로 모양, 사본 위치, 해시 방법, 감사 기록 정의)은 이 저장소와 원본 시작 틀에 없습니다. 아래는 모두 **학생 설계(계약에 없음)**이며 심판 기준과 다를 수 있습니다.

- **서비스·경로**: 메모 서비스(`notes`)의 복구 경로 `POST /api/restores/:id` 하나를 더했습니다(`api/restores/[id].js`, `src/restore-api.mjs`). `aleph.config.json`의 `restoreRoute`는 `"POST /api/restores/:id"`이고 `allowedRoutes`에도 넣었습니다. 빌드는 `restoreRoute`가 경로 형식이 아니거나 `allowedRoutes`에 없으면 멈추고, 맞으면 `/aleph.json`에 옮겨 적습니다. 메모 API `/api/notes`, `/api/notes/:id`의 동작은 그대로입니다.
- **판정기는 바꾸지 않았습니다.** `src/decider.mjs`의 구역 규칙에는 복구 경로가 없어 엔진을 거치면 `starter.deny`로 거부됩니다. 복구 경로의 보안은 서버 함수가 맡습니다.
- **복구 서버 함수**:
  - 로그인이 필요합니다. 사용자는 검사된 토큰의 userId로만 정하고, URL·본문·쿼리의 `owner_id`는 읽지 않습니다.
  - 사본의 `owner_id`가 로그인 사용자이고, 지금 행이 있으면 그 `owner_id`도 로그인 사용자여야 합니다. 아니면 남의 메모든 없는 메모든 같은 404 `NOTE_NOT_FOUND`입니다.
  - 복원 전에 사본 해시를 다시 계산해 대조하고, 다르면 복원하지 않고 409 `SNAPSHOT_HASH_MISMATCH`로 멈춥니다.
  - 지정한 한 건만 처리합니다. 변조됐으면 사본 내용으로 덮어쓰고, 삭제됐으면 같은 id·owner_id로 다시 넣고, 이미 같으면 쓰지 않습니다.
  - 복원 뒤 행을 다시 읽어 id·owner_id·해시를 사본과 대조합니다. 응답은 `{id, sha256, matched}`뿐이고 메모 내용은 없습니다.
- **내용 해시**: `SHA-256( UTF-8(title) + 0x00 바이트 + UTF-8(content) )`의 소문자 16진수 64자입니다. Postgres는 `public.vault_note_sha256(title, content)`, JS는 `src/content-hash.mjs`의 `noteSha256(title, content)`로 같은 값을 냅니다. Postgres의 text에는 0x00이 없어서 제목·본문 경계가 섞이지 않습니다. 유니코드 정규화는 하지 않습니다. 한글 예시로 두 쪽 결과가 같은지 확인했습니다(PostgreSQL 16 PGlite, 로컬).
- **사본과 감사 기록** (`supabase/restore.sql`):
  - `vault_notes_snapshot`: `vault_notes`의 칸(`id`, `owner_id`, `title`, `content`, `created_at`)에 `content_sha256`, `snapshot_at`을 더했습니다. `id`는 primary key(unique)입니다.
  - `vault_restore_audit`: `actor_id`(로그인 사용자 ID), `note_id`, `outcome`, `content_sha256`, `matched`, `at`만 둡니다. 메모 내용과 토큰은 넣지 않습니다. 로그인한 복구 요청은 성공·실패 모두 한 줄 남기고, 기록을 쓰지 못하면 500 `AUDIT_FAILED`입니다. 로그인하지 않은 요청(401)은 남기지 않습니다(누구나 기록을 채우지 못하게).
  - 두 테이블 모두 만든 직후 PUBLIC·anon·authenticated·service_role 권한을 거두고 RLS를 켭니다(정책 없음). service_role에는 사본 `select`, 감사 기록 `select`·`insert`만 줍니다. 감사 기록의 `update`·`delete` 권한은 아무에게도 없습니다.
  - `vault_notes`에 AFTER INSERT 트리거만 걸어, 새 메모가 생기는 순간 사본을 뜹니다. 같은 id 사본이 있으면 아무것도 하지 않습니다(`ON CONFLICT DO NOTHING`). UPDATE·DELETE에는 걸지 않아, 변조·삭제를 당해도 처음 내용이 남습니다. 사본 쓰기는 트리거 함수(소유자 권한)만 하므로 서버 키로도 사본을 고칠 수 없습니다.
  - 함수 두 개(해시 함수, 트리거 함수)는 `search_path`를 `''`로 고정하고, 안에서 쓰는 이름에 `public.`·`pg_catalog.`를 붙였습니다. 두 함수의 실행 권한은 모두 거뒀습니다.
  - `vault_notes`의 테이블·권한·RLS 정책은 바꾸지 않습니다.
- **안전 정책 사본** (`policy/`, `scripts/policy.mjs`):
  - 9단계 판정을 받은 커밋 `23fce0d`의 정책 파일 다섯 개(`src/decider.mjs`, `supabase/notes.sql`, `notes-write-grants.sql`, `notes-rls.sql`, `notes-revoke-direct.sql`)를 `policy/files/` 아래에 이름 끝에 `.snapshot`을 붙여(예: `policy/files/src/decider.mjs.snapshot`), sha256 목록(내용 기준)을 `policy/manifest.json`에 두었습니다.
  - `npm run policy:diff`: 사본이 없거나 목록·사본 이름·해시가 다르면 멈춥니다. 통과하면 복원할 커밋과 지금 파일과 다른 항목만 보여 줍니다.
  - `npm run policy:restore`: 기본은 미리보기입니다. `-- --apply`일 때만 다른 정책 파일을 사본 내용으로 되돌립니다. Vercel 설정, 배포된 DB, 다른 파일, 감사 기록은 건드리지 않습니다. SQL 파일을 되돌려도 DB에는 SQL Editor에서 직접 실행해야 적용됩니다.
- **실제 DB에서 발견한 정책 변경과 되돌린 방법** (2026-10-14, `supabase/restore-check.sql` 결과):
  - 발견: `vault_notes`에 `authenticated`의 테이블 권한(DELETE, INSERT 등)과 칸 단위 권한이 생겨 있었습니다. 안전 정책 사본(`policy/`, 커밋 `23fce0d`)의 기준은 "PUBLIC·anon·authenticated 권한 없음"이라 정책과 다릅니다. RLS 켜짐, 정책 4개, 칸 이름, 트리거 없음, 메모 5개는 정상이었습니다.
  - 영향: 직접 권한이 살아 있는 동안은 로그인 토큰으로 Data API에 직접 닿을 수 있었습니다. RLS 정책 4개가 그대로라 본인 행으로 제한되지만, 서버 함수의 검사(길이 제한 등)를 거치지 않는 쓰기가 가능했습니다. 언제·어떻게 생겼는지는 DB 기록으로 확인하지 않았습니다.
  - 칸 단위 권한 표(`information_schema.column_privileges`)는 테이블 권한도 칸마다 다시 보여 주므로, 칸 단위 항목이 별도로 준 권한인지는 이 표만으로 구별되지 않습니다.
  - 되돌린 방법: `supabase/policy-restore-db.sql`. 기준 사본 `notes-revoke-direct.sql`과 같은 방식으로 `vault_notes`에서 PUBLIC·anon·authenticated의 테이블 권한과 **지금 있는 모든 칸**의 칸 단위 권한만 거둡니다. service_role 권한, RLS, 정책 4개, 다른 테이블은 건드리지 않습니다. 여러 번 실행해도 되고, 마지막 표에서 되돌린 뒤 상태를 기대값과 함께 보여 줍니다.
  - 메모 변조 확인: `supabase/notes-review.local.sql`(Git에 없음, 읽기 전용)로 id, owner_id, 제목, 만든 시각, 내용 길이, 내용 앞 20자를 눈으로 봅니다. 결과는 Git·보고·제출 묶음에 넣지 않습니다.
- **Supabase SQL Editor에서 실행한 결과** (2026-10-14, 학생이 실제 DB에서 직접 실행):

  | 순서 | 파일 | 결과 |
  |---|---|---|
  | 1 | `supabase/restore-check.sql` | 위 정책 변경 발견 |
  | 2 | `supabase/policy-restore-db.sql` | 9행 모두 기대값 |
  | 3 | `supabase/restore-check.sql` 재확인 | `vault_notes`의 anon·authenticated·PUBLIC 권한 없음, 칸 단위 권한 없음, 정책 4개 |
  | 4 | `supabase/restore.sql` | 21행 모두 기대값(트리거 1개, 새 테이블 외부 권한 없음, 함수 실행 false) |
  | 5 | `supabase/restore-snapshot-existing.sql` | 메모 5, 사본 5, 사본 없는 메모 0, 바뀐 메모 0, 주인 다른 사본 0 |

- **실제 배포 복구 확인** `npm run restore:live-check` (학생이 Claude Code 밖의 자기 터미널에서 실행):
  - B 이메일과 비밀번호를 실행할 때 묻습니다. 비밀번호는 화면에 보이지 않고, 둘 다 파일·로그에 남지 않습니다. 로그인은 앱의 `POST /api/auth/login`으로 하므로 publishable key는 필요 없습니다.
  - 순서: B 로그인 → B 메모 목록의 첫 메모 하나 고르기 → 해시 기록 → 사본과 지금 내용이 같은지 먼저 확인(다르면 멈추고 처음 내용으로 되돌림) → 앱 API로 변조(PUT) → 복구 → 처음 해시와 같은지 → 앱 API로 삭제(DELETE) → 복구 → 다시 같은지 → 로그인 없이 복구(401 기대) → 없는 id 복구(404 기대) → 로그아웃.
  - 출력은 상태 코드, 일치 여부, id 앞 8자뿐입니다. 메모 제목·내용, 해시, 토큰, 이메일은 출력하지 않습니다. B 로그인으로 보이는 B 메모 한 건만 쓰고 A 메모는 건드리지 않습니다. 시험이 중간에 멈추면 복구를 한 번 더 부르고, 그래도 안 되면 메모리에 둔 처음 내용으로 다시 씁니다.
  - 정상: `모두 통과 (10개)`. 거부되어야 할 결과: `로그인 없이 복구 — HTTP 401`, `없는 id 복구 — HTTP 404`.
- **로컬 확인 순서** (로컬 시험이며 배포된 API나 심판 판정이 아닙니다):
  1. `npm run test:restore`: 아홉 줄 모두 `✔`(B 변조·삭제 복구, B가 A 메모 404, 없는 id 404, 로그인 없음 401, 사본 해시 불일치 409, 다른 메모·감사 기록 보존)
  2. `npm run policy:diff`: `사본 검증 통과`와 `지금 파일과 다른 항목이 없습니다.`
  3. 거부되어야 할 결과가 200으로 나오면 `src/restore-api.mjs`의 주인 조건을 확인합니다.

### 복구 뒤 1~9단계 정상·금지 요청 다시 실행하기 (제작 4)

복구 뒤에도 앞 단계의 방어가 그대로인지 아래 순서로 다시 봅니다. "결과"는 2026-10-14에 실제로 돌린 것만 적었고, 돌리지 않은 것은 "미실행"입니다. 배포 요청은 이 저장점을 올리기 전 배포(`23fce0d`, step 9)에 보냈습니다.

| 순서 | 단계 | 요청 | 정상·거부 기대 | 결과 |
|---|---|---|---|---|
| 1 | 1·2단계 | `GET /data.json` | 404 (공개 메모 없음) | 404 |
| 2 | 2·5단계 | `/`, `/index.html`, `/aleph.json`, `/data.json`에서 `sb_publishable_`·`sb_secret_`·시드 메모 문장 검색 | 모두 0건 | 200·200·200·404, 모두 0건 |
| 3 | 3단계 | 로그인 없이 `GET /api/notes`, `POST /api/notes`, `GET /api/notes/:id` | 401 `LOGIN_REQUIRED` | 셋 다 401 `LOGIN_REQUIRED` |
| 4 | 3단계 | 서명 없는 가짜 토큰으로 `GET /api/notes` | 401 `INVALID_LOGIN` | 401 `INVALID_LOGIN` |
| 5 | 3·4단계 | B 로그인 뒤 자기 메모 목록·읽기·수정·삭제 | 200 | `restore:live-check` 안에서 확인 예정, 지금은 미실행 |
| 6 | 4단계 | B 토큰으로 A 메모 `GET`·`PUT`·`DELETE /api/notes/:id` | 404 `NOTE_NOT_FOUND` | 미실행 |
| 7 | 5단계 | publishable key로 `originalApiUrl` 읽기·쓰기 | 42501 거부 | 미실행 (키를 넘겨 `npm run bundle`을 실행할 때 기록). DB 권한은 위 SQL Editor 재확인에서 "없음" |
| 8 | 6·7단계 | `npm run decider:test`, `npm run fixture:7` | 네 줄 `통과`, `정상 사건: allow`, `복합 이상 사건: step_up` | 그대로 나옴(로컬 가상 요청) |
| 9 | 8단계 | `npm run bundle`의 8단계 점검 | 메모 수정 `allow`, 공지 쓰기 `deny`, 목록·모르는 경로 `deny` | 미실행 (`npm run bundle`은 실제 복구 시험 뒤 실행) |
| 10 | 9단계 | `npm run detect:test` | 여섯 줄 `통과` | 그대로 나옴(로컬 가상 사건) |
| 11 | 10단계 | `npm run test:restore`, `npm run policy:diff` | 9개 통과, 다른 항목 없음 | 9개 통과, 다른 항목 없음(로컬) |
| 12 | 10단계 | `npm run restore:live-check` | `모두 통과 (10개)` | 미실행 |

## 남은 약점과 한계

- **POST 409로 id 사용 여부가 드러납니다.** 이미 있는 id로 POST하면 남의 메모여도 409 `NOTE_ID_TAKEN`입니다. 내용은 드러나지 않지만 그 id가 쓰이고 있다는 사실은 알 수 있습니다. 클라이언트가 id를 정하는 `POST {id,…}` 형식을 유지해서 남긴 한계입니다.
- **로그인 횟수 제한이 서버 IP 기준이 됩니다.** 로그인 요청이 모두 Vercel 서버에서 Supabase로 가므로, Supabase의 IP별 로그인 제한을 사용자별이 아니라 Vercel 쪽에서 함께 씁니다.
- **로그아웃은 이 기기 세션만 끝냅니다**(`scope=local`). refresh 쿠키는 최대 7일 유지됩니다.
- **공개 키와 메모 문장은 옛 커밋과 옛 배포에 남아 있습니다.** publishable key는 커밋 `a31fb32`~`b11b79c`의 `public/index.html`에, 메모 문장은 `e21bf94`(1단계)에 있습니다. 그 커밋으로 만든 옛 Vercel 배포 주소도 지우기 전까지는 내보낼 수 있으며, 옛 배포 주소는 따로 확인하지 않았습니다. 옛 커밋과 옛 배포가 남아 있는 한, 과거 노출은 해소되지 않았습니다. publishable key는 원래 공개용이며, 직접 권한 회수로 이 키만으로는 `vault_notes`에 닿지 못합니다.
- **10단계 사본은 처음 내용만 기준입니다.** 사본은 메모가 처음 생길 때 한 번만 뜨므로, 그 뒤 주인이 정상으로 고친 내용도 복구하면 처음 내용으로 돌아갑니다. 정상 수정을 새 기준으로 삼는 방법은 만들지 않았습니다.
- **복구 경로는 판정기 구역 표에 없습니다.** `allowedRoutes`에는 `POST /api/restores/:id`가 있지만 `src/decider.mjs`는 바꾸지 않아, 운영 엔진을 거치면 `starter.deny`로 거부됩니다. 이 저장소의 `api/`는 판정기를 부르지 않습니다.
- 4단계의 "Data API 직접 쓰기에는 길이 검사가 없음" 한계는 authenticated 직접 권한을 회수해 더는 해당하지 않습니다.

## 보너스: 무차별 로그인 경보 (`xdr/brute-force`)

- `decide.mjs`가 경보 하나를 block·alert·record로 판단합니다(`npm run xdr:run -- brute-force`). 근거 패턴은 `patterns.json`(T1110.001, T1110.003)입니다.
- `node xdr/brute-force/respond.mjs`는 block 후보를 거부 규칙 후보로 `xdr/deny-rules.json`에 쌓고, block·alert 알림을 `xdr/alerts.log`에 JSON 한 줄씩 덧붙입니다.
- `xdr/deny-rules.json` 모양: `{schema: "aleph.xdr.deny-rules.v1", contractMatch: null, updatedAt, rules: [{id, module, ruleId, decision: "deny", reasonCode, target: {kind: "source_ip", value}, createdAt, expiresAt, evidenceAlertIds, patterns, confidence}]}`. 규칙은 만든 뒤 60분에 만료되고, 같은 주소는 근거를 합칩니다. 계정은 막지 않고, 같은 묶음에서 정상(record)으로 나온 주소도 막지 않습니다.
- 이 파일은 brute-force와 web-injection이 함께 씁니다. `module`과 `id` 앞머리로 출처를 구분합니다(`brute-force`: `xdr-bf-`, `xdr_brute_force_block`, `xdr_brute_force` / `web-injection`: `xdr-wi-`, `xdr_web_injection_block`, `xdr_web_injection`). 각 모듈은 자기 규칙만 고치거나 만료 정리하고, 다른 모듈의 규칙은 그대로 둡니다. 파일 형식이 틀리면 덮어쓰지 않고 멈춥니다. `xdr/alerts.log` 각 줄에도 `module`이 있습니다.
- **판정기에 연결하지 않았습니다.** `docs/DECIDER_REQUEST.md` 요청에는 출발 주소가 없어 `src/decider.mjs`가 이 규칙을 요청과 맞출 수 없고, 두 이유 코드는 운영 등록부에 없습니다. 배포된 `/api/notes` 동작은 그대로입니다. 로컬 연습 결과이며 심판 판정이 아닙니다.

## 보너스: 웹 주입 경보 (`xdr/web-injection`)

- `decide.mjs`가 경보 하나를 판단합니다(`npm run xdr:run -- web-injection`). 근거 패턴은 `patterns.json`(T1190: sql-injection, script-injection, path-traversal, command-injection)입니다. 문서용 표기와 실제 구문 모양을 모두 보며, block은 구문 모양이 뚜렷하고 `data.count`가 2번 이상일 때만 나옵니다.
- `node xdr/web-injection/respond.mjs`는 block 후보를 위의 `xdr/deny-rules.json`에, block·alert 알림을 `xdr/alerts.log`에 쌓습니다.

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
   | 7 | `supabase/restore-check.sql` | 10단계 읽기 전용 확인. 권한이 기준과 다르면 `supabase/policy-restore-db.sql`을 먼저 실행하고 다시 확인 | 있음 |
   | 8 | `supabase/restore.sql` | 10단계 사본·감사 기록 테이블, 권한, AFTER INSERT 트리거 | 있음 |
   | 9 | `supabase/restore-snapshot-existing.sql` | 지금 있는 메모를 한 번 사본으로 뜸. 실행 전에 `supabase/notes-review.local.sql`(Git에 없음)로 메모가 정상인지 확인 | 있음 |

   `*.local.sql`이 없으면 3·4번 대신 화면에서 로그인해 메모를 추가합니다. 대조 조회가 있는 파일은 구역 [1]·[2]·[3]을 각각 선택해 실행하면 적용 전후 권한을 비교할 수 있습니다.
2. Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`를 Vercel 설정 화면에 직접 넣습니다.
3. `main`에 push하면 Vercel이 배포합니다. `/aleph.json`의 `step`과 `commit`으로 배포된 커밋을 확인합니다.
4. 로컬 확인: `npm ci` 뒤 `npm run build -- --local`, `npm run test:r5`, `npm run test:package`, `npm run decider:test`, `npm run fixture:7`, `npm run detect:test`, `npm run test:restore`, `npm run policy:diff`. 배포된 복구 확인은 자기 터미널에서 `npm run restore:live-check`(B 계정 필요). 로컬 실행은 Vercel 배포나 심판 판정을 증명하지 않습니다.
5. 제출 묶음: `bundle-notes.json`(커밋하지 않음)에 이번 단계 설명을 적고 `npm run bundle`을 실행하면 `artifacts/submission.json`이 생깁니다. `src/attack-check.mjs`가 배포 주소와 `originalApiUrl`로 실제 보낸 요청 결과만 기록하며, 학생 자기 점검이지 심판 판정이 아닙니다. 6단계에서는 5단계 점검 다섯 개에 더해, 로컬 `src/decider.mjs`에 등록·미등록 기기 가상 요청을 넣은 실제 응답 두 개를, 7단계에서는 복합 이상·추가 인증 뒤 재판정·위조 출처 신호의 응답 세 개와 미실행인 실제 자료 차단 한 개를, 8단계에서는 메모 수정·공지 수정·모르는 경로·쿼리 기능·`:id` 자리 기능 이름·메모 전체 목록·공지 삭제의 응답 일곱 개를, 9단계에서는 로컬 탐지기에 가상 사건을 넣은 결과 두 개(121건 제안, 120건·다른 사용자 섞임 관찰)를, 10단계에서는 로그인 없이·가짜 토큰으로 보낸 복구 요청(401 기대), 로컬 정책 사본 검증, 미실행인 B 계정 복구 흐름 세 개를 더 기록합니다(반 엔진 판정 아님). 점검은 모두 20개로 제출 묶음의 상한이라, 10단계에서 같은 단계의 점검 둘씩을 한 줄로 합쳤습니다(5단계 anon 읽기·쓰기 → `anon_original_api_read_write`, 7단계 복합 이상·추가 인증 뒤 재판정 → `decider_step_up_and_verified_retry`, 8단계 모르는 경로·`:id` 자리 기능 이름 → `decider_zone_unknown_route_and_function_segment`). 보내는 요청과 가상 요청은 줄지 않았습니다. 시험 계정 비밀번호가 필요한 점검은 넣지 않았습니다. anon 점검의 publishable key는 파일에 저장하지 않고 실행 명령에서만 넘깁니다. 키를 넘기지 않으면 그 두 점검은 "미실행"으로 기록됩니다.
   - Git Bash: `SUPABASE_PUBLISHABLE_KEY=<publishable key> npm run bundle`
   - PowerShell: `$env:SUPABASE_PUBLISHABLE_KEY='<publishable key>'; npm run bundle; Remove-Item Env:SUPABASE_PUBLISHABLE_KEY`

## 단계 기록

- **1단계 (`e21bf94`)**: 시작 틀을 Vercel에 배포했습니다. 가상 메모 네 건이 공개 `/data.json`으로 누구에게나 보였습니다.
- **2단계 (`029641b`)**: 메모를 Supabase `vault_notes`로 옮기고 공개 `data.json`을 지웠습니다. 화면은 서버 함수 `/api/notes`로 읽었지만, 이 함수에 로그인 확인이 없어 누구나 읽을 수 있었습니다.
- **3단계 (`a31fb32`, `a29bc06`, `d5109ff`, 저장점 `02a6c4b`)**: 로그인·로그아웃 화면, 토큰 검사가 붙은 자료 API, 로그인 사용자의 메모 추가·수정·삭제를 붙였습니다. 이때는 소유자 검사가 없어 B가 A의 메모를 고칠 수 있었습니다.
- **4단계 (`223faf0`, `ec093bc`, 저장점 `ddd8e80`)**: API 소유자 검사와 404 존재 숨김, `vault_notes` RLS 본인 행 정책 4개와 최소 권한을 붙였습니다.
- **5단계 (`b11b79c`, `85e9eb9`, 저장점 `dc6225e`, 보충 `2fad6e1`, `684f4a3`)**: `vault_notes` 직접 권한 회수와 `originalApiUrl`, 로그인·토큰 갱신·로그아웃의 서버 함수 이전, 화면에서 공개 키 제거. 저장점 뒤에 `/aleph.json`에 `originalApiUrl`·`allowedRoutes`·`identityProvider`를 기록했습니다.
- **보너스 (`c4f3df2` xdr-01, `cfd64cc` xdr-02)**: `xdr/brute-force`, `xdr/web-injection` 경보 판단. 판정기에는 연결하지 않았습니다.
- **6단계 (저장점 `546c072`)**: 판정기 규칙 `device_registered`. 등록 기기의 메모 읽기만 허용하고, 미등록 기기는 `deny`·`device_not_registered`로 거부합니다.
- **7단계 (저장점 `e757df3`, 보충 `97d06f2`)**: 판정기 규칙 `step_up_required`와 접속 신호 입력 검사. 평소와 다른 시각·처음 보는 네트워크·많은 읽기가 겹친 가상 사건은 `step_up`, 엔진의 추가 인증 뒤에는 다시 판정해 허용합니다. 저장점 뒤에 평소와 다른 시각을 `signals.hour` 0~5시로 바꿨습니다.
- **8단계 (저장점 `3391c25`, 수정 `810142a`)**: 판정기 구역 규칙 `zone_note_read`·`zone_note_update`·`zone_notice_update`. 정확한 route의 메모 한 건 읽기·수정만 경로상 허용하고, 강사 공지 쓰기(POST·PUT·PATCH·DELETE)는 강사 역할 계약이 없어 항상 거부, 메모 전체 목록과 그 밖의 경로·쿼리 기능·`:id` 자리 기능 이름은 `starter.deny`로 거부합니다. 수정 커밋에서 메모 전체 목록을 거부하고 공지 쓰기 네 메서드를 `zone_notice_update`로 명시했습니다.
- **9단계 (저장점 `6487932`, 보충 `23fce0d`)**: 탐지기 `src/detect.mjs`. 같은 가명 사용자(`identity.sub`)의 GET이 어느 10분 구간에서든 120건을 넘으면 `propose_revocation`·`burst_read` 제안을 돌려줍니다. 집행은 하지 않습니다. 보충 커밋에서 README에 한계 두 줄(중복 사건, 대문자 GET만)을 더했습니다.
- **10단계 (이 저장점, 학생 설계·계약에 없음)**: 복구 경로 `POST /api/restores/:id`, 메모 사본·감사 기록 테이블과 내용 해시, 안전 정책 사본 `policy/`, 실제 DB에서 발견한 `authenticated` 권한을 `supabase/policy-restore-db.sql`로 되돌림, 배포 복구 확인 `npm run restore:live-check`.

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
