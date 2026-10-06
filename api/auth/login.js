// POST /api/auth/login: {email, password} → {access_token, expires_at, user}, refresh token은 HttpOnly 쿠키
import { createAuthHandler } from '../../src/auth-api.mjs';

export default createAuthHandler('login');
