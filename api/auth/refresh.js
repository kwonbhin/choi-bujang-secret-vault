// POST /api/auth/refresh: HttpOnly 쿠키의 refresh token으로 새 access token
import { createAuthHandler } from '../../src/auth-api.mjs';

export default createAuthHandler('refresh');
