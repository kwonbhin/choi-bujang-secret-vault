// POST /api/auth/logout: 쿠키를 지우고 Supabase 세션을 끝냄
import { createAuthHandler } from '../../src/auth-api.mjs';

export default createAuthHandler('logout');
