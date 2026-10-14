// 5단계: 화면 대신 서버 함수가 Supabase Auth에 로그인·토큰 갱신·로그아웃을 요청합니다.
// 화면 코드에는 Supabase 주소와 publishable key가 없습니다.
// 이 서버 함수는 Vercel 환경변수 SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY만 씁니다(서버 전용 키는 쓰지 않음).
//
// 토큰 위치(11단계부터):
// - access token·refresh token 모두 응답 본문으로만 돌려주고 화면은 메모리 변수에만 둡니다.
//   localStorage·sessionStorage·쿠키·IndexedDB에 쓰지 않습니다. 새로고침하면 다시 로그인합니다.
// - 토큰 갱신은 화면이 메모리의 refresh token을 JSON 본문 {refresh_token}으로 보낼 때만 합니다.
// - 5~10단계에 쓰던 HttpOnly 쿠키(vault_refresh)는 더 만들지 않고, 로그인·갱신·로그아웃 응답에서 지우기만 합니다.
//   (쿠키는 화면 스크립트가 읽을 수 없다는 장점이 있었지만, 토큰을 브라우저 저장소에 두지 않기로 했습니다.)
//
// 비밀번호·토큰·이메일은 로그에 남기지 않습니다. 실패할 때도 오류 코드만 남깁니다.
// 이 경로들은 JSON 본문(Content-Type: application/json)의 POST만 받습니다.
// 다른 사이트의 폼 전송은 이 형식을 만들 수 없고, fetch는 사전 요청에서 막힙니다.
import { createClient } from '@supabase/supabase-js';

const COOKIE = 'vault_refresh';
const COOKIE_PATH = '/api/auth';
const REFRESH_MAX = 2048;
const EMAIL_MAX = 320;
const PASSWORD_MAX = 1024;
// 화면이 이유를 보여 주는 Supabase Auth 오류 코드만 그대로 전달합니다.
const KNOWN_LOGIN_ERRORS = new Set([
  'invalid_credentials', 'email_not_confirmed', 'user_banned', 'over_request_rate_limit',
]);

function authConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL 또는 SUPABASE_PUBLISHABLE_KEY 환경변수가 없습니다.');
  return { url, key };
}

function authClient({ url, key }) {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// 예전 단계가 남긴 쿠키를 지웁니다. 새 쿠키는 만들지 않습니다.
function clearRefreshCookie(response) {
  response.setHeader('Set-Cookie', `${COOKIE}=; Path=${COOKIE_PATH}; Max-Age=0; HttpOnly; Secure; SameSite=Strict`);
}

// 본문 {refresh_token}만 읽습니다. 쿠키는 읽지 않습니다.
function readRefreshToken(raw) {
  let input = raw;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return null; }
  }
  const token = input && typeof input === 'object' && !Array.isArray(input) ? input.refresh_token : null;
  return typeof token === 'string' && token && token.length <= REFRESH_MAX && /^[A-Za-z0-9._-]+$/u.test(token) ? token : null;
}

// 화면에 돌려주는 값: access token, refresh token, 만료 시각(초), 표시할 이메일. 화면은 메모리에만 둡니다.
function sessionBody(session) {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at,
    user: { email: session.user?.email ?? null },
  };
}

function readCredentials(raw) {
  let input = raw;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return null; }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const { email, password } = input;
  if (typeof email !== 'string' || !email.trim() || email.length > EMAIL_MAX
      || typeof password !== 'string' || !password || password.length > PASSWORD_MAX) {
    return null;
  }
  return { email: email.trim(), password };
}

const actions = {
  async login({ request, response, config }) {
    const credentials = readCredentials(request.body);
    if (!credentials) return [400, { error: 'INVALID_LOGIN_REQUEST' }];
    const { data, error } = await authClient(config).auth.signInWithPassword(credentials);
    if (error || !data?.session) {
      if (error?.status === 0 || error?.name === 'AuthRetryableFetchError') {
        console.error('auth: 로그인 서버에 연결하지 못했습니다.');
        return [502, { error: 'AUTH_UNAVAILABLE' }];
      }
      const code = KNOWN_LOGIN_ERRORS.has(error?.code) ? error.code : 'login_failed';
      console.error('auth: 로그인 실패', code);
      return [code === 'over_request_rate_limit' ? 429 : 401, { error: code }];
    }
    clearRefreshCookie(response);
    return [200, sessionBody(data.session)];
  },

  async refresh({ request, response, config }) {
    clearRefreshCookie(response);
    const refreshToken = readRefreshToken(request.body);
    if (!refreshToken) return [401, { error: 'NO_SESSION' }];
    const { data, error } = await authClient(config).auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data?.session) {
      console.error('auth: 토큰 갱신 실패', error?.code || 'unknown');
      return [401, { error: 'SESSION_EXPIRED' }];
    }
    return [200, sessionBody(data.session)];
  },

  async logout({ request, response, config }) {
    // 예전 쿠키는 결과와 상관없이 지웁니다. access token이 있으면 Supabase에서도 이 세션을 끝냅니다.
    clearRefreshCookie(response);
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/u
      .exec(request.headers?.authorization ?? '');
    if (match) {
      try {
        const result = await fetch(new URL('/auth/v1/logout?scope=local', config.url), {
          method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${match[1]}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!result.ok && result.status !== 401 && result.status !== 403) {
          console.error('auth: Supabase 로그아웃 응답', result.status);
        }
      } catch {
        console.error('auth: Supabase 로그아웃 요청 실패');
      }
    }
    return [200, { ok: true }];
  },
};

// action: 'login' | 'refresh' | 'logout'. getConfig는 로컬 시험에서만 바꿉니다.
export function createAuthHandler(action, getConfig = authConfig) {
  const run = actions[action];
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    if (!/^application\/json(?:\s*;|$)/iu.test(request.headers?.['content-type'] ?? '')) {
      response.status(415).json({ error: 'JSON_REQUIRED' });
      return;
    }
    let config;
    try {
      config = getConfig();
    } catch (error) {
      console.error('auth: 설정을 불러오지 못했습니다.', error.message);
      response.status(500).json({ error: 'AUTH_NOT_CONFIGURED' });
      return;
    }
    try {
      const [status, body] = await run({ request, response, config });
      response.status(status).json(body);
    } catch {
      console.error('auth: 요청을 처리하지 못했습니다.');
      response.status(502).json({ error: 'AUTH_UNAVAILABLE' });
    }
  };
}
