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

- **서비스·경로**: 메모 서비스(`notes`) 아래 복구 경로 `POST /api/notes/:id/restore` 하나를 더했습니다(`api/notes/[id]/restore.js` → `src/restore-api.mjs`). 처음에는 `POST /api/restores/:id`였지만, 판정기 표에 없어 반 엔진을 거친 심판 요청이 API에 오지 못한 것으로 보고 메모 서비스 아래로 옮겼습니다. 옛 경로 파일은 지워 404입니다. `aleph.config.json`의 `restoreRoute`는 `"POST /api/notes/:id/restore"`이고 `allowedRoutes`에도 같은 경로만 넣었습니다. 빌드는 `restoreRoute`가 경로 형식이 아니거나 `allowedRoutes`에 없으면 멈추고, 맞으면 `/aleph.json`에 옮겨 적습니다. 메모 API `/api/notes`, `/api/notes/:id`의 동작은 그대로입니다.
- **판정기 복구 경로 규칙** (`src/decider.mjs`, 계약 `docs/DECIDER_REQUEST.md`의 값만 읽음):
  - 구역 표에 `'POST /notes/:id/restore'`를 메모(note) 항목으로 더했습니다(규칙 `zone_note_restore`). path가 정확히 `/notes/<id>/restore`일 때만 맞고, id는 기존 `RESOURCE_ID`·`FUNCTION_SEGMENTS` 검사를 그대로 받습니다. 쿼리가 있으면 거부합니다.
  - `restore_verified_policy`: 복구 경로에만 적용합니다. 계약의 `request.policyRevision`이 검증한 안전 정책 버전 `1`(연습 정상 요청 `scripts/fixture-7.mjs`의 값)과 정확히 같을 때만 허용합니다. 값이 없거나 다르면(`2`, 문자열 `"1"` 포함) `deny`·`policy_unverified`·`['restore_verified_policy']`입니다.
  - 순서: 기기 미등록 → 구역 → 추가 확인(`step_up_required`) → `restore_verified_policy`. 허용이면 `ruleIds`는 `['device_registered', 'zone_note_restore', 'restore_verified_policy']`입니다.
  - 다른 경로의 판정은 그대로입니다. 고치기 전 판정기와 복구 경로 밖 가상 요청 1,232건을 비교해 다른 결과 0건이었습니다(로컬).
  - `policy_unverified`가 운영 등록부의 `allowedReasonCodes`에 있는지는 확인하지 못했습니다. 계약상 등록되지 않은 코드면 엔진이 응답을 받아들이지 않지만, 이 경우는 어차피 거부입니다.
  - DB 쪽 안전 정책 사본 `s9-safe-1`(아래)이 정책 버전 1에 대응합니다. 판정기는 DB를 읽지 않으므로 이 연결은 이름과 설명으로만 맞춥니다.
- 반 엔진을 거치지 않는 직접 호출도 있으므로 소유자·사본 검증은 서버 함수가 다시 맡습니다.
- **복구 서버 함수**:
  - 로그인이 필요합니다. 사용자는 검사된 토큰의 userId로만 정하고, URL·본문·쿼리의 `owner_id`는 읽지 않습니다. 본문과 쿼리에서는 `dryRun`·`preview`만 읽습니다. 본문 모양 때문에 400으로 막지 않습니다.
  - **감사 기록 먼저**: 복원 전에 감사 기록에 시작 줄(`restore_started`)을 씁니다. 쓰지 못하면 메모·사본을 읽지도 쓰지도 않고 503 `{ error: "AUDIT_UNAVAILABLE", restored: false }`로 멈춥니다. 끝나면(성공·멈춤 모두) 결과 줄을 한 줄 더 쓰고, 응답에 `audit: { startId, resultId }`를 넣습니다. 결과 줄을 쓰지 못하면 500 `{ error: "AUDIT_FAILED", restored, audit: { startId, resultId: null } }`입니다. 감사 기록은 insert만 하고 update·delete는 하지 않습니다.
  - **실행 전 미리보기**: 본문 `dryRun` 또는 `preview`가 `true`·`"true"`이거나 쿼리 `?dryRun=true`로 부르면 사본을 두 번 읽어 검증한 뒤 `plan: { version, changes, beforeSha256, backupSha256 }`과 `backup`만 답하고(`dryRun: true`, `restored: false`) 메모는 쓰지 않습니다. 감사 기록에는 `preview` 줄 하나만 남기고 응답에 `audit: { previewId }`를 넣습니다. 사본이 없거나 검증이 실패하면 미리보기도 같은 409로 멈춥니다. 그 밖의 경우(본문 없음, `{}`, 다른 칸, 깨진 JSON, `false`, `"false"` 등)는 모두 지금처럼 복원합니다.
  - 사본의 `owner_id`가 로그인 사용자이고, 지금 행이 있으면 그 `owner_id`도 로그인 사용자여야 합니다. 아니면 남의 메모든 없는 메모든 같은 404 `NOTE_NOT_FOUND`입니다.
  - **멈추는 경우** (복원하지 않고, 로그인한 요청이므로 감사 기록은 남김):
    - 자기 메모가 지금 있는데 사본이 없으면 409 `{ error: "BACKUP_MISSING", restored: false }`
    - 사본 해시를 다시 계산해 대조한 결과가 다르면 409 `{ error: "BACKUP_VERIFICATION_FAILED", restored: false, backup: { verified: false, version } }`
    - 복원 직전에 사본을 한 번 더 읽어, 검증한 그 행(`version` = `snapshot_at`, 해시)과 다르면 같은 409 `BACKUP_VERIFICATION_FAILED`
    - 남의 메모와, 사본도 행도 없는 메모는 같은 404 `NOTE_NOT_FOUND`
  - 지정한 한 건만 처리합니다. 복원에는 복원 직전에 다시 읽어 검증한 사본 행만 씁니다. 변조됐으면 사본 내용으로 덮어쓰고, 삭제됐으면 같은 id·owner_id로 다시 넣고, 이미 같으면 쓰지 않습니다.
  - 복원 뒤 행을 다시 읽어 id·owner_id·해시를 사본과 대조합니다.
  - **성공 응답(200)**: 메모 내용은 넣지 않고 검증 과정만 보여 줍니다.

    ```json
    {
      "id": "<메모 id>", "restored": true, "matched": true, "sha256": "<사본 해시, 이전 응답과 호환>",
      "backup": { "verified": true, "version": "<snapshot_at>", "sha256": "<사본에 저장된 해시>",
                  "recomputedSha256": "<사본을 다시 읽어 계산한 해시>", "rereadAt": "<복원 직전에 다시 읽은 시각>" },
      "before": { "exists": true, "sha256": "<복원 전 지금 행 해시, 없으면 null>" },
      "after": { "sha256": "<복원 뒤 다시 읽은 행 해시>" },
      "changes": ["content"],
      "audit": { "startId": 41, "resultId": 42 }
    }
    ```

    `changes`는 바뀐 칸 이름(`title`, `content`)이고, 삭제된 메모를 다시 넣었으면 `["row_restored"]`, 이미 같으면 `[]`와 `restored: false`입니다.
- **내용 해시**: `SHA-256( UTF-8(title) + 0x00 바이트 + UTF-8(content) )`의 소문자 16진수 64자입니다. Postgres는 `public.vault_note_sha256(title, content)`, JS는 `src/content-hash.mjs`의 `noteSha256(title, content)`로 같은 값을 냅니다. Postgres의 text에는 0x00이 없어서 제목·본문 경계가 섞이지 않습니다. 유니코드 정규화는 하지 않습니다. 한글 예시로 두 쪽 결과가 같은지 확인했습니다(PostgreSQL 16 PGlite, 로컬).
- **사본과 감사 기록** (`supabase/restore.sql`):
  - `vault_notes_snapshot`: `vault_notes`의 칸(`id`, `owner_id`, `title`, `content`, `created_at`)에 `content_sha256`, `snapshot_at`을 더했습니다. `id`는 primary key(unique)입니다.
  - `vault_restore_audit`: `actor_id`(로그인 사용자 ID), `note_id`, `outcome`, `content_sha256`, `matched`, `at`만 둡니다. 메모 내용과 토큰은 넣지 않습니다. 로그인한 복구 요청은 시작 줄과 결과 줄 두 줄, 미리보기는 `preview` 한 줄, id 형식 오류는 한 줄을 남깁니다. 로그인하지 않은 요청(401)은 남기지 않습니다(누구나 기록을 채우지 못하게). 새 칸이나 권한은 더하지 않았습니다(서버 함수는 insert 뒤 `audit_id`만 돌려받으며, 기존 `select`·`insert` 권한 안입니다).
  - 두 테이블 모두 만든 직후 PUBLIC·anon·authenticated·service_role 권한을 거두고 RLS를 켭니다(정책 없음). service_role에는 사본 `select`, 감사 기록 `select`·`insert`만 줍니다. 감사 기록의 `update`·`delete` 권한은 아무에게도 없습니다.
  - `vault_notes`에 AFTER INSERT 트리거만 걸어, 새 메모가 생기는 순간 사본을 뜹니다. 같은 id 사본이 있으면 아무것도 하지 않습니다(`ON CONFLICT DO NOTHING`). UPDATE·DELETE에는 걸지 않아, 변조·삭제를 당해도 처음 내용이 남습니다. 사본 쓰기는 트리거 함수(소유자 권한)만 하므로 서버 키로도 사본을 고칠 수 없습니다.
  - 함수 두 개(해시 함수, 트리거 함수)는 `search_path`를 `''`로 고정하고, 안에서 쓰는 이름에 `public.`·`pg_catalog.`를 붙였습니다. 두 함수의 실행 권한은 모두 거뒀습니다.
  - `vault_notes`의 테이블·권한·RLS 정책은 바꾸지 않습니다.
- **시험 정책과 안전 정책 사본** (`policy/`, `scripts/policy.mjs`) — **판정기 경로 규칙의 로컬 연습용**입니다. 실제 안전 정책(DB의 RLS·권한) 사본·복원은 아래 "DB 안전 정책"입니다:
  - 경과: 처음에는 시험 정책을 운영 판정기 파일로 해석해, `src/decider.mjs`와 정책 SQL 4개의 사본(`policy/files/`)으로 파일을 통째로 되돌리는 `--apply`를 만들었습니다. 이것은 "실제 운영 정책은 건드리지 않는다", "다른 서비스 규칙과 감사 이력은 보존한다"는 과제 요구와 맞지 않아, 운영 판정기와 분리된 가상 시험 정책으로 다시 만들었습니다. 옛 사본(`policy/files/`, `policy/manifest.json`), `--apply`, `policy:snapshot`은 없앴습니다.
  - `policy/test-policy.json`: **가상 시험 정책**입니다. 운영 판정기·DB 권한·배포된 자료실과 연결되지 않아, 바꿔도 실제 접근 판정은 바뀌지 않습니다. `schema`, `revision`, `services`, `audit`(감사 이력 배열)로 되어 있습니다. 처음 상태는 3차 침공을 흉내 내 notes 규칙 세 개(`ownerOnly` false, `listAllowed` true, `itemMethods`에 DELETE 추가)를 바꾼 침해 상태입니다.
  - `services`의 값은 1~10단계 구현에서 옮겼습니다(지어낸 규칙 없음). `basis` 칸에 근거를 적었습니다.

    | 서비스 | 규칙(안전 값) | 근거 |
    |---|---|---|
    | `notes` | `ownerOnly` true, `listAllowed` false, `itemMethods` [GET, PUT] | 4단계 owner_id 조건, 8단계 구역 GET·PUT `/notes/:id`, 목록은 구역 표에 없음 |
    | `notices` | `writeAllowed` false | 8단계 `zone_notice_update` |
    | `devices` | `registeredOnly` true | 6단계 `device_registered` |
    | `stepUp` | 0~5시·`unusual` 네트워크·600초 안 10건 초과가 함께면 추가 확인, 확인 뒤 300초, 지역 미사용 | 7단계 `step_up_required` |
    | `detect` | GET, 600초 안 120건 초과면 `propose_revocation`, 집행 안 함 | 9단계 `src/detect.mjs` |
    | `noteRestore` | 소유자만, 사본 해시 재계산·복원 직전 재읽기, 사본 없으면 멈춤, 감사 먼저 | 10단계 `src/restore-api.mjs` |

  - `policy/safe-policy.json`: 침해 전에 검증한 안전 사본입니다(`revision` 9, `verifiedAt`). 값은 9단계 판정 커밋 `23fce0d`의 구현과 같습니다(그 뒤 `src/decider.mjs`, `src/detect.mjs`, `src/notes-api.mjs`는 바뀌지 않음).
  - `policy/safe-policy.manifest.json`: 사본 파일 이름, `revision`, `verifiedAt`, LF로 맞춘 내용의 sha256입니다.
  - `npm run policy:diff`: 사본과 manifest의 sha256·revision·verifiedAt을 대조합니다. 복원할 버전과 서비스별 바뀔 항목(지금 값 → 사본 값), "B가 A 메모 읽기" 허용·거부를 한 줄로 보여 줍니다. 아무것도 쓰지 않습니다. manifest가 없거나, 사본이 없거나, sha256·revision이 다르면 `복원을 중단합니다: …`로 종료 코드 1입니다.
  - `npm run policy:restore -- --service <이름>`: 기본은 미리보기만 합니다. `--confirm`이 있을 때만 씁니다.
    - 쓰기 직전에 사본·manifest·시험 정책을 다시 읽어 검증하고, 미리보기 때와 다르면 중단합니다.
    - 지정한 서비스 하나의 규칙만 사본 값으로 바꿉니다. 다른 서비스 규칙과 이미 있던 `audit` 줄은 그대로 둡니다.
    - `audit`에는 이번 복원 한 줄(시각, 서비스, revision, 사본 sha256, 바뀐 항목 이름)만 덧붙입니다.
    - 쓴 뒤 다시 읽어 "대상 서비스는 사본과 같음, 다른 서비스 그대로, 이전 감사 이력 그대로"를 확인하고, 틀리면 쓰기 전 내용으로 되돌리고 중단합니다.
    - 사본에 없는 서비스를 지정하면 중단합니다. `--apply`는 없앴습니다(주면 중단).
  - 이 기능은 `policy/` 안의 세 파일만 다룹니다. 운영 판정기(`src/decider.mjs`), DB 권한, `supabase/*.sql`, 메모 복구 경로는 읽거나 쓰지 않습니다(운영 판정기 미변경 확인만 읽음).
  - 줄바꿈 고정(`.gitattributes`): `policy/**`는 `-text`, `src/decider.mjs`와 9단계 정책 SQL 4개는 `eol=lf`입니다. sha256도 LF로 맞춘 내용으로 계산해서 PC마다 같은 값이 나옵니다.
  - **실제 저장소에서 실행한 결과** (2026-10-14 01:56 UTC, `node scripts/policy.mjs …`로 실행. `npm run policy:*`와 같은 명령):

    | 순서 | 명령 | 결과 |
    |---|---|---|
    | 0 | `src/decider.mjs` sha256 | `a7de40b2b649…`, 커밋 `23fce0d`와 같음 |
    | 1 | `policy:diff` | 사본 검증 통과(sha256 `c6afb187871a`, revision 9). notes 3개 바뀜(`itemMethods` ["GET","PUT","DELETE"] → ["GET","PUT"], `listAllowed` true → false, `ownerOnly` false → true), 다른 서비스 없음. B가 A 메모 읽기: 지금 허용, 사본 거부. 종료 0 |
    | 2 | `policy:restore -- --service notes` | 미리보기, 아무것도 쓰지 않음. 종료 0 |
    | 3 | `policy:restore -- --service notes --confirm` | notes만 바꿈. 쓴 뒤 확인: 대상 사본과 같음 true, 다른 서비스 그대로 true, 이전 감사 이력 그대로 true(1줄 → 2줄). B가 A 메모 읽기: 이제 거부. 종료 0 |
    | 4 | `policy:diff` | 모든 서비스 바뀔 항목 없음. B가 A 메모 읽기: 지금 거부, 사본 거부. 종료 0 |
    | 5 | `src/decider.mjs` sha256 | `a7de40b2b649…`, 실행 전과 같음(커밋 `23fce0d`와 같음) |

    그래서 저장소의 `policy/test-policy.json`은 notes가 복원된 상태이고, `audit`는 침해 흉내 한 줄과 복원 한 줄입니다.
  - 로컬 시험 `npm run test:policy`(8개)는 임시 폴더에서 다음을 확인합니다.
    - 미리보기는 아무것도 쓰지 않음
    - 지정 서비스만 복원되고 다른 서비스·감사 이력은 보존됨. B의 A 메모 읽기는 거부로 바뀌고 A 자기 메모는 허용
    - manifest 없음·사본 없음·sha256 다름·revision 다름·없는 서비스는 중단, CLI 종료 코드 1
    - 미리보기 뒤 사본이나 시험 정책이 바뀌면 중단
    - CRLF 사본도 LF 기준 sha256으로 검증됨
    - 운영 판정기는 바뀌지 않음
- **DB 안전 정책(vault_notes RLS·정책·권한) 사본·검증·차이·복원** (`supabase/step10_policy_backup.sql`, `supabase/step10_policy_restore_test.sql`, 학생이 SQL Editor에서 직접 실행):
  - 표: `vault_policy_backup`(version, snapshot jsonb, snapshot_sha256, captured_at), `vault_policy_audit`(추가만). 두 표 모두 RLS 켜짐, PUBLIC·anon·authenticated·service_role 권한 없음, UPDATE·DELETE·TRUNCATE는 트리거로 막음.
  - 함수(모두 security definer, `search_path ''`, 실행 권한은 PUBLIC·anon·authenticated·service_role에서 거둠 → SQL Editor에서만):
    - `vault_policy_current()`: 지금 `vault_notes`의 RLS 켜짐·강제, 정책(이름·역할·명령·조건), 역할별 테이블·칸 권한을 jsonb로 읽음
    - `vault_policy_sha256(jsonb)`
    - `vault_policy_capture(version, 정책 버전)`: 지금 정책이 안전 기준과 같을 때만 사본을 남김. 아니면 거부. 같은 버전은 덮어쓰지 않음
    - `vault_policy_verify(version)`: 사본을 다시 읽어 해시 재계산. 없거나 다르면 멈춤
    - `vault_policy_diff(version)`: 읽기 전용, 버전과 바뀔 항목
    - `vault_policy_restore(version, 확인)`: 확인 false면 버전·바뀔 항목만. true면 사본을 다시 읽어 검증 → `vault_notes`의 정책·권한만 사본대로 → 다시 읽어 대조, 다르면 예외로 전부 취소. 사본 없음·검증 실패면 아무것도 바꾸지 않고 멈춤
  - 안전 기준: RLS 켜짐, `notes-rls.sql`의 본인 행 정책 4개, PUBLIC·anon·authenticated의 테이블·칸 권한 없음.
  - 감사: 사본 남기기·검증·미리보기·복원·복원 시험은 모두 `vault_policy_audit`에 한 줄씩 남깁니다. `vault_policy_diff`는 읽기 전용이라 남기지 않습니다. 다른 표의 정책·사본·감사 기록은 건드리지 않습니다.
  - 실행 순서: `restore-check.sql`(확인) → `step10_policy_backup.sql`(끝에서 사본 `s9-safe-1`을 남기고 결과 표) → `step10_policy_restore_test.sql`.
    - 복원 시험은 한 트랜잭션 안에서 침공을 흉내 냅니다(모두 읽기 정책 추가, 본인 수정 정책 삭제, authenticated SELECT).
    - 그다음 미리보기 → 복원 → 사본과 같은지, authenticated 직접 읽기 거부, B가 A 메모 0건, A 자기 메모 1건 이상을 확인합니다.
    - 결과는 감사 기록에 pass/fail로 남기고, 실패하면 바꾼 것을 전부 취소합니다.
  - 로컬 확인(2026-10-14): PGlite(PostgreSQL 16)에 Supabase 역할·`auth.uid()`·안전 상태 `vault_notes`를 흉내 낸 가짜 DB를 만들어 두 파일을 두 번씩 실행했습니다.
    - 결과 표는 모두 기대값이었고, 시험은 pass였습니다.
    - 사본·감사 수정·삭제 막힘, 없는 버전 멈춤, 침해 상태 사본 남기기 거부, 메모 주인이 한 명이면 fail·전부 취소도 확인했습니다.
  - **실제 Supabase 결과** — 실행(2026-10-14, 학생이 SQL Editor에서 직접):
    - `step10_policy_backup.sql`:
      - 사본 남기기 `captured`, 안전 기준과 다른 점 `[]`, 사본 해시 재계산 true, 사본 sha256 앞 12자 `bfe01770a71c`
      - 바뀔 항목 0, 사본 1 / 감사 1, 두 표 RLS true·true, 두 표 외부 권한 없음, 트리거 4
      - 함수 실행 권한 anon·authenticated·service_role 모두 false, `vault_notes` RLS true / 정책 4
    - `step10_policy_restore_test.sql`:
      - **pass**. 침공 흉내 뒤 사본과 달라짐 true
      - 미리보기 바뀔 항목 3개(`policy:vault_notes_breach_read_all`, `policy:vault_notes_update_own`, `grant:authenticated`)
      - 복원 true, 복원 뒤 사본과 같음 true, authenticated 직접 읽기 거부 true
      - B가 A 메모 0건, A가 자기 메모 4건, RLS 확인 오류 없음
      - 시험 뒤 정책 4개(본인 행), 외부 권한 없음, 마지막 감사 `restore_test pass`
    - 여기의 A·B는 "메모를 먼저 만든 주인 = A, 두 번째 = B"입니다.
    - 로컬 PGlite와 실제 Supabase의 사본 sha256 앞 12자(`bfe01770a71c`)가 같았습니다.
- **실제 DB에서 발견한 정책 변경과 되돌린 방법** (2026-10-14, `supabase/restore-check.sql` 결과):
  - 발견: `vault_notes`에 `authenticated`의 테이블 권한(DELETE, INSERT 등)과 칸 단위 권한이 생겨 있었습니다. 9단계 판정 커밋 `23fce0d`의 `supabase/notes-revoke-direct.sql` 기준은 "PUBLIC·anon·authenticated 권한 없음"이라 정책과 다릅니다. RLS 켜짐, 정책 4개, 칸 이름, 트리거 없음, 메모 5개는 정상이었습니다.
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
  | 6 | `supabase/step10_policy_backup.sql` | 실행(2026-10-14, 학생이 SQL Editor에서 직접): 사본 `s9-safe-1` captured, 다른 점 [], 재계산 true, sha256 `bfe01770a71c…`, 바뀔 항목 0, 두 표 RLS·외부 권한 없음·트리거 4, 함수 실행 권한 모두 false, `vault_notes` RLS true / 정책 4 |
  | 7 | `supabase/step10_policy_restore_test.sql` | 실행(2026-10-14, 학생이 SQL Editor에서 직접): pass. 미리보기 3항목 → 복원 true → 사본과 같음, 직접 읽기 거부, B→A 0건, A 자기 메모 4건, 정책 4개·외부 권한 없음, 감사 `restore_test pass` |

- **실제 배포 복구 확인** `npm run restore:live-check` (학생이 Claude Code 밖의 자기 터미널에서 실행):
  - B 이메일과 비밀번호를 실행할 때 묻습니다. 비밀번호는 화면에 보이지 않고, 둘 다 파일·로그에 남지 않습니다. 로그인은 앱의 `POST /api/auth/login`으로 하므로 publishable key는 필요 없습니다.
  - 순서: 배포된 `/aleph.json`의 commit 읽기 → B 로그인 → B 메모 목록의 첫 메모 하나 고르기 → 해시 기록 → 미리보기(`dryRun`)로 사본과 지금 내용이 같은지 확인(`changes` [], 다르면 아무것도 안 바꾸고 멈춤) → 앱 API로 변조(PUT) → 미리보기(`changes` [content], 메모는 변조 그대로) → 복구(`backup.verified` true, `changes`에 `content`, 감사 `startId` < `resultId`) → 처음 해시와 같은지 → 앱 API로 삭제(DELETE) → 미리보기(`changes` [row_restored], 메모는 삭제 그대로) → 복구(`backup.verified` true, `changes`에 `row_restored`, 감사 id 두 개) → 다시 같은지 → 로그인 없이 복구(401 기대) → 없는 id 복구(404 기대) → 로그아웃.
  - 출력은 상태 코드, 일치 여부, id 앞 8자뿐입니다. 메모 제목·내용, 해시, 토큰, 이메일은 출력하지 않습니다. B 로그인으로 보이는 B 메모 한 건만 쓰고 A 메모는 건드리지 않습니다. 시험이 중간에 멈추면 복구를 한 번 더 부르고, 그래도 안 되면 메모리에 둔 처음 내용으로 다시 씁니다.
  - 끝나면 `artifacts/restore-live-result.json`(Git 제외)에 실행 시각, 대상 커밋(배포된 `/aleph.json`의 commit), 단계별 상태 코드·통과 여부·`backup.verified`·`changes`·감사 id 개수만 저장합니다(실패해도 그대로 덮어씀). 메모 내용·토큰·이메일·해시는 넣지 않습니다.
  - `npm run bundle`은 이 파일이 있고 대상 커밋이 지금 HEAD와 같을 때만 `restore_owner_flow_live`를 "실행(학생이 직접, 시각)"으로 적고 파일의 통과 수·상태 코드를 그대로 옮깁니다. 파일이 없거나 커밋이 다르면 "미실행"입니다. 그래서 커밋·push → 배포의 `/aleph.json` commit 확인 → `npm run restore:live-check` → `npm run bundle` 순서로 실행합니다.
  - 정상: `모두 통과 (12개)`. 거부되어야 할 결과: `로그인 없이 복구 — HTTP 401`, `없는 id 복구 — HTTP 404`.
  - **이전 실제 결과** (2026-10-14, 배포 커밋 `922b398`, 감사 먼저 쓰기·미리보기가 없던 버전, 학생이 자기 터미널에서 실행): `모두 통과 (10개)`. 변조 뒤 복구 `backup.verified` true·`changes` [content], 삭제 뒤 복구 `changes` [row_restored], 로그인 없이 복구 401, 없는 id 복구 404. 감사 먼저 쓰기·미리보기 버전의 실제 시험은 아직 미실행입니다.
- **로컬 확인 순서** (로컬 시험이며 배포된 API나 심판 판정이 아닙니다):
  1. `npm run test:restore`: 스무 줄 모두 `✔`(B 변조·삭제 복구와 응답의 검증 칸, B가 A 메모 404, 없는 id 404, 로그인 없음 401, 사본 없음 409 `BACKUP_MISSING`, 해시 대조 실패·복원 직전 다시 읽은 사본이 다름 409 `BACKUP_VERIFICATION_FAILED`(복원 안 됨), 사본을 두 번 읽음, 다른 메모·감사 기록 보존, 감사 시작 줄 실패 시 503·복원 안 됨, `audit` id 응답, 결과 줄 실패 시 500, `dryRun`은 아무것도 안 씀, 미리보기 조건(본문 true·"true", 쿼리 ?dryRun=true), 그 밖의 본문(없음·{}·다른 칸·깨진 JSON·false 등)은 400 없이 복원, 기존 감사 줄 보존). 감사 기록 실패 시험 중에는 `restores: 감사 기록을 남기지 못했습니다. 42501` 줄이 일부러 찍힙니다.
  2. `npm run test:policy`: 여덟 줄 모두 `✔`. `npm run policy:diff`: `안전 정책 사본 검증 통과`, 모든 서비스 `없음`, `B가 A 메모 읽기 … 지금 시험 정책 거부`, 종료 코드 0
  3. 거부되어야 할 결과가 200으로 나오면 `src/restore-api.mjs`의 주인 조건을 확인합니다.

### 복구 뒤 1~9단계 정상·금지 요청 다시 실행하기 (제작 4)

복구 뒤에도 앞 단계의 방어가 그대로인지 아래 순서로 다시 봅니다. "결과"는 2026-10-14에 실제로 돌린 것만 적었고, 돌리지 않은 것은 "미실행"입니다. 배포 요청은 따로 적지 않았으면 10단계 저장점을 올리기 전 배포(`23fce0d`, step 9)에 보냈고, 5·12번은 10단계 저장점 배포(`b613f24`)에서 학생이 `npm run restore:live-check`로 실행했습니다.

| 순서 | 단계 | 요청 | 정상·거부 기대 | 결과 |
|---|---|---|---|---|
| 1 | 1·2단계 | `GET /data.json` | 404 (공개 메모 없음) | 404 |
| 2 | 2·5단계 | `/`, `/index.html`, `/aleph.json`, `/data.json`에서 `sb_publishable_`·`sb_secret_`·시드 메모 문장 검색 | 모두 0건 | 200·200·200·404, 모두 0건 |
| 3 | 3단계 | 로그인 없이 `GET /api/notes`, `POST /api/notes`, `GET /api/notes/:id` | 401 `LOGIN_REQUIRED` | 셋 다 401 `LOGIN_REQUIRED` |
| 4 | 3단계 | 서명 없는 가짜 토큰으로 `GET /api/notes` | 401 `INVALID_LOGIN` | 401 `INVALID_LOGIN` |
| 5 | 3·4단계 | B 로그인 뒤 자기 메모 목록·읽기·수정·삭제 | 200 | `b613f24`에서 `restore:live-check`: 목록 200(1건), 읽기 200, 수정(PUT) 200, 삭제(DELETE) 200·삭제 뒤 GET 404 |
| 6 | 4단계 | B 토큰으로 A 메모 `GET`·`PUT`·`DELETE /api/notes/:id` | 404 `NOTE_NOT_FOUND` | 미실행 |
| 7 | 5단계 | publishable key로 `originalApiUrl` 읽기·쓰기 | 42501 거부 | 미실행 (키를 넘겨 `npm run bundle`을 실행할 때 기록). DB 권한은 위 SQL Editor 재확인에서 "없음" |
| 8 | 6·7단계 | `npm run decider:test`, `npm run fixture:7` | 네 줄 `통과`, `정상 사건: allow`, `복합 이상 사건: step_up` | 그대로 나옴(로컬 가상 요청) |
| 9 | 8단계 | `npm run bundle`의 8단계 점검 | 메모 수정 `allow`, 공지 쓰기 `deny`, 목록·모르는 경로 `deny` | 미실행 (`npm run bundle`은 실제 복구 시험 뒤 실행) |
| 10 | 9단계 | `npm run detect:test` | 여섯 줄 `통과` | 그대로 나옴(로컬 가상 사건) |
| 11 | 10단계 | `npm run test:restore`, `npm run policy:diff` | 9개 통과, 다른 항목 없음 | 9개 통과, 다른 항목 없음(로컬) |
| 12 | 10단계 | `npm run restore:live-check` | `모두 통과 (10개)` | `b613f24`에서 `모두 통과 (10개)`: 변조·삭제 뒤 복구 모두 200·matched true·처음 해시와 같음, 로그인 없이 복구 401, 없는 id 복구 404 |
| 13 | 4·10단계 | SQL Editor에서 `supabase/step10_policy_restore_test.sql`(DB 안전 정책 침공 흉내 → 미리보기 → 복원) | pass, B→A 0건, A 자기 메모 1건 이상 | 실행(2026-10-14, 학생이 SQL Editor에서 직접): pass, B→A 0건, A 자기 메모 4건, authenticated 직접 읽기 거부, 정책 4개·외부 권한 없음 |

## 남은 약점과 한계

- **POST 409로 id 사용 여부가 드러납니다.** 이미 있는 id로 POST하면 남의 메모여도 409 `NOTE_ID_TAKEN`입니다. 내용은 드러나지 않지만 그 id가 쓰이고 있다는 사실은 알 수 있습니다. 클라이언트가 id를 정하는 `POST {id,…}` 형식을 유지해서 남긴 한계입니다.
- **로그인 횟수 제한이 서버 IP 기준이 됩니다.** 로그인 요청이 모두 Vercel 서버에서 Supabase로 가므로, Supabase의 IP별 로그인 제한을 사용자별이 아니라 Vercel 쪽에서 함께 씁니다.
- **로그아웃은 이 기기 세션만 끝냅니다**(`scope=local`). refresh 쿠키는 최대 7일 유지됩니다.
- **공개 키와 메모 문장은 옛 커밋과 옛 배포에 남아 있습니다.** publishable key는 커밋 `a31fb32`~`b11b79c`의 `public/index.html`에, 메모 문장은 `e21bf94`(1단계)에 있습니다. 그 커밋으로 만든 옛 Vercel 배포 주소도 지우기 전까지는 내보낼 수 있으며, 옛 배포 주소는 따로 확인하지 않았습니다. 옛 커밋과 옛 배포가 남아 있는 한, 과거 노출은 해소되지 않았습니다. publishable key는 원래 공개용이며, 직접 권한 회수로 이 키만으로는 `vault_notes`에 닿지 못합니다.
- **10단계 사본은 처음 내용만 기준입니다.** 사본은 메모가 처음 생길 때 한 번만 뜨므로, 그 뒤 주인이 정상으로 고친 내용도 복구하면 처음 내용으로 돌아갑니다. 정상 수정을 새 기준으로 삼는 방법은 만들지 않았습니다.
- **복구 경로의 판정기 허용은 로컬 가상 요청으로만 확인했습니다.** 반 엔진이 `POST /notes/:id/restore` 경로와 `policyRevision`을 어떻게 보내는지, `policy_unverified`가 등록된 이유 코드인지는 확인하지 못했습니다. 이 저장소의 `api/`는 판정기를 부르지 않습니다.
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
   | 10 | `supabase/step10_policy_backup.sql` | 10단계 DB 안전 정책 사본 표·함수, 침해 전 사본 `s9-safe-1` | 있음 |
   | 11 | `supabase/step10_policy_restore_test.sql` | 10단계 침공 흉내 → 미리보기 → 복원 → 확인(실패하면 전부 취소) | 있음 |

   `*.local.sql`이 없으면 3·4번 대신 화면에서 로그인해 메모를 추가합니다. 대조 조회가 있는 파일은 구역 [1]·[2]·[3]을 각각 선택해 실행하면 적용 전후 권한을 비교할 수 있습니다.
2. Vercel 환경변수 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`를 Vercel 설정 화면에 직접 넣습니다.
3. `main`에 push하면 Vercel이 배포합니다. `/aleph.json`의 `step`과 `commit`으로 배포된 커밋을 확인합니다.
4. 로컬 확인: `npm ci` 뒤 `npm run build -- --local`, `npm run test:r5`, `npm run test:package`, `npm run decider:test`, `npm run fixture:7`, `npm run detect:test`, `npm run test:restore`, `npm run test:policy`, `npm run policy:diff`. 배포된 복구 확인은 자기 터미널에서 `npm run restore:live-check`(B 계정 필요). 로컬 실행은 Vercel 배포나 심판 판정을 증명하지 않습니다.
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
- **10단계 (이 저장점, 학생 설계·계약에 없음)**: 복구 경로 `POST /api/notes/:id/restore`와 판정기 `zone_note_restore`·`restore_verified_policy`(정책 버전 1), DB 안전 정책(RLS·권한) 사본·검증·복원 SQL, 메모 사본·감사 기록 테이블과 내용 해시, 판정기 경로 규칙 연습용 가상 시험 정책 `policy/test-policy.json`과 안전 사본·manifest(서비스 하나만 복원, 감사 이력 보존), 실제 DB에서 발견한 `authenticated` 권한을 `supabase/policy-restore-db.sql`로 되돌림, 배포 복구 확인 `npm run restore:live-check`.

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
