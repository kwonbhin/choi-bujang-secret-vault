// 2단계: 서버에서만 Supabase 서버 전용 키로 가상 메모를 읽어 화면에 전달합니다.
// 키는 Vercel 환경변수에서만 읽고 응답·로그에 넣지 않습니다.
// 약점: 아직 로그인 확인이 없어 이 함수 주소를 아는 누구나 메모를 읽을 수 있습니다.
import { createClient } from '@supabase/supabase-js';

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
