// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
// 실제 키 값의 모양만 찾습니다. "sb_secret_…" 같은 안내 문구는 키가 아닙니다.
const SECRET_SHAPE = /sb_secret_[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./u;

function appUrl(config) {
  let app;
  try {
    app = new URL(config.publicAppUrl);
  } catch {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  if (app.protocol !== 'https:' || app.username || app.password || app.search || app.hash
      || app.pathname !== '/' || app.hostname.endsWith('.example')) {
    throw new Error('aleph.config.json의 실제 배포 주소를 먼저 넣어 주세요.');
  }
  return app;
}

async function get(app, path, init = {}) {
  return fetch(new URL(path, app), { redirect: 'error', signal: AbortSignal.timeout(10000), ...init });
}

// 2단계 목록은 {notes:[…]}, 3단계부터는 배열입니다. 둘 다 셉니다.
async function noteCount(response) {
  if (!response.ok) return 0;
  try {
    const data = await response.clone().json();
    if (Array.isArray(data)) return data.length;
    return Array.isArray(data?.notes) ? data.notes.length : 0;
  } catch {
    return 0;
  }
}

// 상태 코드, JSON 오류 문구, 메모 수만 기록합니다. 메모 본문은 기록하지 않습니다.
async function describe(response) {
  let error = 'JSON 아님';
  try {
    const data = await response.clone().json();
    error = typeof data?.error === 'string' ? `JSON 오류 ${data.error.slice(0, 40)}` : 'JSON(오류 문구 없음)';
  } catch {
    // A non-JSON response is recorded as such.
  }
  return `HTTP ${response.status}, ${error}, 메모 ${await noteCount(response)}건`;
}

const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');

// 학생 발급자를 흉내 낸 서명 없는 가짜 토큰입니다. 실제 키나 세션과 무관합니다.
function forgedToken(config) {
  const now = Math.floor(Date.now() / 1000);
  return [base64url({ alg: 'ES256', typ: 'JWT', kid: 'forged' }),
    base64url({ iss: config.identityProvider?.issuer, aud: 'authenticated', role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000000', iat: now, exp: now + 600 }),
    'forged-signature'].join('.');
}

async function keyLeak(responses) {
  for (const response of responses) {
    const text = await response.clone().text().catch(() => '');
    if (SECRET_SHAPE.test(text) || [...response.headers.values()].some(value => SECRET_SHAPE.test(value))) {
      return true;
    }
  }
  return false;
}

export async function runAttackChecks(config) {
  const app = appUrl(config);
  if (config.step === 1) {
    if (typeof config.sampleMarker !== 'string' || !config.sampleMarker) throw new Error('가상 메모의 확인 표시를 넣어 주세요.');
    const response = await get(app, '/data.json');
    let visible = false;
    if (response.ok) {
      try {
        const data = await response.json();
        visible = data?.sampleMarker === config.sampleMarker && Array.isArray(data.notes)
          && data.notes.length > 0;
      } catch {
        // A non-JSON response is a failed check, not a successful deployment.
      }
    }
    return [{ attackId: 'anonymous_note_read', expected: '비로그인 화면에서 가상 메모를 확인',
      observed: visible ? '비로그인 요청에서 공개 가상 메모 확인 표시가 보임' : `비로그인 요청에서 확인 표시가 보이지 않음 (HTTP ${response.status})` }];
  }
  if (config.step === 2) {
    const publicFile = await get(app, '/data.json');
    const publicCount = await noteCount(publicFile);
    const api = await get(app, '/api/notes');
    const apiCount = await noteCount(api);
    const apiText = await api.text();
    const page = await get(app, '/');
    const pageText = page.ok ? await page.text() : '';
    const leaked = SECRET_SHAPE.test(apiText) || SECRET_SHAPE.test(pageText)
      || [...api.headers.values()].some(value => SECRET_SHAPE.test(value));
    return [
      { attackId: 'anonymous_public_file_read', expected: '공개 /data.json에서 가상 메모가 보이지 않음',
        observed: publicCount ? `공개 /data.json에서 가상 메모 ${publicCount}건이 보임 (HTTP ${publicFile.status})`
          : `공개 /data.json에서 가상 메모가 보이지 않음 (HTTP ${publicFile.status})` },
      { attackId: 'anonymous_api_note_read', expected: '아직 로그인 확인이 없어 비로그인 /api/notes 요청에도 가상 메모가 보임 (3단계에서 막을 약점)',
        observed: `비로그인 /api/notes 요청에서 가상 메모 ${apiCount}건 (HTTP ${api.status})` },
      { attackId: 'server_key_exposure', expected: '화면과 /api/notes 응답에 서버 전용 키 형태가 없음',
        observed: leaked ? '화면 또는 /api/notes 응답에 서버 전용 키로 보이는 값이 있음' : '화면과 /api/notes 응답에서 서버 전용 키 형태가 보이지 않음' },
    ];
  }
  if (config.step === 3) {
    const publicFile = await get(app, '/data.json');
    const list = await get(app, '/api/notes');
    const create = await get(app, '/api/notes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '비로그인 점검', body: '' }),
    });
    const forged = await get(app, '/api/notes', {
      headers: { Authorization: `Bearer ${forgedToken(config)}` },
    });
    const page = await get(app, '/');
    const leaked = await keyLeak([page, list, create, forged]);
    return [
      { attackId: 'anonymous_public_file_read', expected: '공개 /data.json에서 가상 메모가 보이지 않음',
        observed: `공개 /data.json 요청: HTTP ${publicFile.status}, 메모 ${await noteCount(publicFile)}건` },
      { attackId: 'anonymous_api_list', expected: '로그인 없이 GET /api/notes는 401 JSON으로 거부되고 메모 없음',
        observed: `로그인 없이 GET /api/notes: ${await describe(list)}` },
      { attackId: 'anonymous_api_create', expected: '로그인 없이 POST /api/notes는 401 JSON으로 거부되고 저장되지 않음',
        observed: `로그인 없이 POST /api/notes: ${await describe(create)}` },
      { attackId: 'forged_token_read', expected: '서명이 없는 가짜 토큰으로 GET /api/notes는 401 JSON으로 거부됨',
        observed: `가짜 토큰으로 GET /api/notes: ${await describe(forged)}` },
      { attackId: 'server_key_exposure', expected: '화면과 /api/notes 응답에 서버 전용 키 형태가 없음',
        observed: leaked ? '화면 또는 /api/notes 응답에 서버 전용 키로 보이는 값이 있음' : '화면과 /api/notes 응답 4건에서 서버 전용 키 형태가 보이지 않음' },
    ];
  }
  if (config.step === 4) {
    const list = await get(app, '/api/notes');
    const forged = await get(app, '/api/notes', {
      headers: { Authorization: `Bearer ${forgedToken(config)}` },
    });
    const page = await get(app, '/');
    const leaked = await keyLeak([page, list, forged]);
    // anon 점검에는 공개용 publishable key만 씁니다. 화면에는 키가 없으므로
    // 로컬 환경변수 SUPABASE_PUBLISHABLE_KEY로만 받고, 없으면 이 점검은 미실행으로 남깁니다.
    const publishable = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
    let dataRead = '로컬 환경변수 SUPABASE_PUBLISHABLE_KEY가 없어 미실행';
    let dataInsert = dataRead;
    if (publishable) {
      const rest = new URL(config.originalApiUrl
        ?? new URL('/rest/v1/vault_notes', new URL(config.identityProvider.issuer).origin));
      const anonHeaders = { apikey: publishable };
      const read = await fetch(`${rest}?select=id&limit=1`, {
        headers: anonHeaders, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const insert = await fetch(rest, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { ...anonHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ title: 'anon check', content: 'x' }),
      });
      const dataApi = async response => {
        const code = await response.clone().json().then(data => data?.code, () => null);
        const rows = await response.clone().json().then(data => (Array.isArray(data) ? data.length : 0), () => 0);
        return `HTTP ${response.status}, 코드 ${typeof code === 'string' ? code.slice(0, 20) : '없음'}, 행 ${rows}개`;
      };
      dataRead = `anon 키로 Data API GET vault_notes: ${await dataApi(read)}`;
      dataInsert = `anon 키로 Data API POST vault_notes: ${await dataApi(insert)}`;
    }
    return [
      { attackId: 'anonymous_api_list', expected: '로그인 없이 GET /api/notes는 401 JSON으로 거부되고 메모 없음',
        observed: `로그인 없이 GET /api/notes: ${await describe(list)}` },
      { attackId: 'forged_token_read', expected: '서명이 없는 가짜 토큰으로 GET /api/notes는 401 JSON으로 거부됨',
        observed: `가짜 토큰으로 GET /api/notes: ${await describe(forged)}` },
      { attackId: 'anon_data_api_read', expected: 'anon(publishable) 키로 Data API의 vault_notes 읽기가 권한 없음(42501)으로 거부됨',
        observed: dataRead },
      { attackId: 'anon_data_api_insert', expected: 'anon(publishable) 키로 Data API의 vault_notes 쓰기가 권한 없음(42501)으로 거부됨',
        observed: dataInsert },
      { attackId: 'server_key_exposure', expected: '화면과 /api/notes 응답에 서버 전용 키 형태가 없음',
        observed: leaked ? '화면 또는 /api/notes 응답에 서버 전용 키로 보이는 값이 있음' : '화면과 /api/notes 응답 3건에서 서버 전용 키 형태가 보이지 않음' },
    ];
  }
  if (config.step >= 5 && config.step <= 8) {
    const list = await get(app, '/api/notes');
    const forged = await get(app, '/api/notes', {
      headers: { Authorization: `Bearer ${forgedToken(config)}` },
    });
    // 화면과 공개 파일에 공개 키·서버 전용 키 접두어·시드 메모 문장이 있는지 셉니다(값은 기록하지 않음).
    // 시드 메모 문장은 이 파일이 README의 저장소 검색에 걸리지 않도록 유니코드 이스케이프로 적습니다.
    const SEED_SENTENCE = /\uC2E4\uC2B5\uC6A9 \uAC00\uC0C1/gu;
    const publicPaths = ['/', '/index.html', '/aleph.json', '/data.json'];
    const counts = { publishable: 0, secret: 0, seed: 0 };
    const statuses = [];
    for (const path of publicPaths) {
      const response = await get(app, path);
      const text = await response.text().catch(() => '');
      statuses.push(`${path} ${response.status}`);
      counts.publishable += text.match(/sb_publishable_/gu)?.length ?? 0;
      counts.secret += text.match(/sb_secret_/gu)?.length ?? 0;
      counts.seed += text.match(SEED_SENTENCE)?.length ?? 0;
    }
    // anon 키는 bundle을 실행하는 명령의 환경변수로만 받습니다. 파일에 저장하지 않습니다.
    const publishable = process.env.SUPABASE_PUBLISHABLE_KEY?.trim();
    let dataRead = '실행 명령에 SUPABASE_PUBLISHABLE_KEY 환경변수가 없어 미실행';
    let dataInsert = dataRead;
    if (publishable && config.originalApiUrl) {
      const original = new URL(config.originalApiUrl);
      const read = await fetch(original, {
        headers: { apikey: publishable }, redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const insert = await fetch(original, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { apikey: publishable, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ title: 'anon check', content: 'x' }),
      });
      const dataApi = async response => {
        const data = await response.clone().json().catch(() => null);
        const code = typeof data?.code === 'string' ? data.code.slice(0, 20) : '없음';
        return `HTTP ${response.status}, 코드 ${code}, 행 ${Array.isArray(data) ? data.length : 0}개`;
      };
      dataRead = `anon 키로 originalApiUrl GET: ${await dataApi(read)}`;
      dataInsert = `anon 키로 originalApiUrl POST: ${await dataApi(insert)}`;
    } else if (publishable) {
      dataRead = 'aleph.config.json에 originalApiUrl이 없어 미실행';
      dataInsert = dataRead;
    }
    const checks = [
      { attackId: 'anonymous_api_list', expected: '로그인 없이 GET /api/notes는 401 JSON으로 거부되고 메모 없음',
        observed: `로그인 없이 GET /api/notes: ${await describe(list)}` },
      { attackId: 'forged_token_read', expected: '서명이 없는 가짜 토큰으로 GET /api/notes는 401 JSON으로 거부됨',
        observed: `가짜 토큰으로 GET /api/notes: ${await describe(forged)}` },
      { attackId: 'public_files_key_scan', expected: '화면과 공개 파일에 sb_publishable_·sb_secret_·시드 메모 문장이 0건',
        observed: `${statuses.join(', ')} 검사: sb_publishable_ ${counts.publishable}건, sb_secret_ ${counts.secret}건, 시드 메모 문장 ${counts.seed}건` },
      { attackId: 'anon_original_api_read', expected: 'anon 키로 originalApiUrl 읽기가 권한 없음(42501)으로 거부됨',
        observed: dataRead },
      { attackId: 'anon_original_api_insert', expected: 'anon 키로 originalApiUrl 쓰기가 권한 없음(42501)으로 거부됨',
        observed: dataInsert },
    ];
    if (config.step >= 6) {
      // 6단계: 로컬 판정기에 가상 요청을 넣은 실제 응답만 기록합니다. 반 엔진이나 심판의 판정이 아닙니다.
      const { fixtureRequests } = await import('../scripts/fixture-7.mjs');
      const { decide } = await import('./decider.mjs');
      const { normal, suspicious } = fixtureRequests();
      const answer = async request => {
        try {
          const response = await decide(request);
          return `${response?.decision}·${response?.reasonCode} (규칙 ${Array.isArray(response?.ruleIds) ? response.ruleIds.join(',') : '없음'})`;
        } catch (error) {
          return `판정기 오류: ${String(error?.message).slice(0, 80)}`;
        }
      };
      checks.push(
        { attackId: 'decider_registered_device_read', expected: '로컬 판정기에 등록 기기(deviceRegistered: true)의 GET /notes/:id 가상 요청을 넣으면 allow',
          observed: `로컬 판정기 응답: ${await answer(normal)}` },
        { attackId: 'decider_unregistered_device', expected: '로컬 판정기에 미등록 기기(deviceRegistered: false) 가상 요청을 넣으면 deny·device_not_registered',
          observed: `로컬 판정기 응답: ${await answer({ ...normal, deviceRegistered: false })}` },
      );
      if (config.step >= 7) {
        // 7단계: 복합 이상 가상 사건, 추가 인증 뒤 다시 판정, 계약에 없는 출처의 접속 신호를 넣어 봅니다.
        checks.push(
          { attackId: 'decider_unusual_access_step_up', expected: '평소와 다른 시각·처음 보는 네트워크·많은 읽기가 겹친 가상 사건은 step_up·step_up_required',
            observed: `로컬 판정기 응답: ${await answer(suspicious)}` },
          { attackId: 'decider_step_up_verified_retry', expected: '같은 가상 사건에 엔진의 추가 인증(stepUp verified, 60초)이 붙으면 다시 판정해 allow',
            observed: `로컬 판정기 응답: ${await answer({ ...suspicious, stepUp: { verified: true, authAgeSeconds: 60 } })}` },
          { attackId: 'decider_forged_signal_source', expected: '계약에 없는 출처(client_header)의 정상처럼 보이는 접속 신호는 믿지 않고 step_up',
            observed: `로컬 판정기 응답: ${await answer({ ...normal,
              signals: { source: 'client_header', region: 'local', network: 'usual', hour: 14 } })}` },
          { attackId: 'relay_step_up_data_block', expected: '실제 릴레이가 추가 확인 전 /api/notes 자료를 막고 재로그인 뒤 다시 판정함',
            observed: '미실행: 실제 재로그인·자료 차단은 반 엔진이 맡고, 이 저장소의 api/는 판정기를 부르지 않아 학생이 직접 보낼 수 없음' },
        );
      }
      if (config.step >= 8) {
        // 8단계: 구역 규칙에 가상 요청을 넣은 실제 응답만 기록합니다. 메모 주인은 판정기가 아니라 API가 검사합니다.
        const { createHash } = await import('node:crypto');
        const query = 'fn=export';
        checks.push(
          { attackId: 'decider_zone_note_update', expected: '등록 기기의 PUT /notes/:id 가상 요청은 경로상 allow (주인 검사는 API의 owner_id 404)',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, method: 'PUT', route: 'PUT /notes/:id' })}` },
          { attackId: 'decider_zone_notice_update', expected: '공지 수정 PUT /notices/:id는 강사 역할 계약이 없어 deny·instructor_role_contract_missing',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, service: 'notices', method: 'PUT',
              route: 'PUT /notices/:id', path: '/notices/week3' })}` },
          { attackId: 'decider_zone_unknown_route', expected: '구역 표에 없는 GET /notes/:id/export는 deny·starter_not_ready',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, route: 'GET /notes/:id/export', path: '/notes/demo/export' })}` },
          { attackId: 'decider_zone_query_function', expected: '쿼리로 기능을 고르는 GET /notes?…는 deny·starter_not_ready',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, route: 'GET /notes', path: '/notes',
              queryLength: query.length, querySha256: createHash('sha256').update(query).digest('hex') })}` },
          { attackId: 'decider_zone_function_segment', expected: ':id 자리에 기능 이름이 온 GET /notes/export는 deny·starter_not_ready',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, path: '/notes/export' })}` },
          { attackId: 'decider_zone_note_list', expected: '메모 전체 목록 GET /notes는 구역 표에 없어 deny·starter_not_ready',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, route: 'GET /notes', path: '/notes' })}` },
          { attackId: 'decider_zone_notice_delete', expected: '공지 삭제 DELETE /notices/:id도 deny·instructor_role_contract_missing',
            observed: `로컬 판정기 응답: ${await answer({ ...normal, service: 'notices', method: 'DELETE',
              route: 'DELETE /notices/:id', path: '/notices/week3' })}` },
        );
      }
    }
    return checks;
  }
  throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
}
