// The student changes this check as each stage adds an attack to the same app.
// Never return tokens, private keys, real names, or note bodies.
const SECRET_SHAPE = /sb_secret_|service_role|SUPABASE_SECRET_KEY|eyJ[A-Za-z0-9_-]{10,}\./u;

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

async function get(app, path) {
  return fetch(new URL(path, app), { redirect: 'error', signal: AbortSignal.timeout(10000) });
}

async function noteCount(response) {
  if (!response.ok) return 0;
  try {
    const data = await response.clone().json();
    return Array.isArray(data?.notes) ? data.notes.length : 0;
  } catch {
    return 0;
  }
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
  throw new Error('이 단계의 공격 점검을 src/attack-check.mjs에 구현해 주세요.');
}
