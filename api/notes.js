// 3단계: 로그인 토큰을 시작 틀의 src/verify-login.mjs로 검사한 뒤에만
// 서버 전용 키로 가상 메모를 읽어 전달합니다.
// 키는 Vercel 환경변수에서만 읽고 응답·로그에 넣지 않습니다.
// 요청 본문·쿼리의 userId·role은 읽지 않습니다. 사용자는 검사된 토큰으로만 정합니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from '../src/verify-login.mjs';

let verifyLogin;

function deny(response, status, error) {
  if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
  response.status(status).json({ error });
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
    return;
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error('notes: SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 없습니다.');
    response.status(500).json({ error: 'NOTES_NOT_CONFIGURED' });
    return;
  }
  try {
    verifyLogin ??= createLoginVerifier({ config, supabaseSecretKey: key });
  } catch (error) {
    console.error('notes: 로그인 검사기를 만들지 못했습니다.', error.message);
    response.status(500).json({ error: 'LOGIN_NOT_CONFIGURED' });
    return;
  }
  const authorization = request.headers?.authorization;
  if (!authorization) {
    deny(response, 401, 'LOGIN_REQUIRED');
    return;
  }
  const login = await verifyLogin(authorization);
  if (!login) {
    deny(response, 401, 'INVALID_LOGIN');
    return;
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase
    .from('vault_notes')
    .select('title, content')
    .order('title', { ascending: true });
  if (error) {
    console.error('notes: 자료를 읽지 못했습니다.', error.code || 'unknown');
    response.status(502).json({ error: 'NOTES_UNAVAILABLE' });
    return;
  }
  response.status(200).json({ notes: data.map(({ title, content }) => ({ title, content })) });
}
