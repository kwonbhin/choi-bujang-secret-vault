// 12단계 요청 ID: 보호 API(메모·복구·기기·작전실) 응답마다 서버가 만든 X-Request-Id를 붙이고,
// 같은 ID로 서버 로그에 한 줄만 남깁니다. 로그에는 메서드·경로 모양·상태·결과 코드만 넣고
// 본문·토큰·쿼리·사용자 번호는 넣지 않습니다.
import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-Id';
const CODE = /^[A-Za-z_]{1,60}$/u;

// routeShape는 '/api/notes/:id'처럼 고정된 모양입니다(실제 id·쿼리를 넣지 않음).
export function trackRequest(request, response, routeShape, log = console.log) {
  const requestId = randomUUID();
  response.setHeader(REQUEST_ID_HEADER, requestId);
  let logged = false;
  const send = (status, body) => {
    if (!logged) {
      logged = true;
      const code = typeof body?.error === 'string' && CODE.test(body.error) ? body.error : (status < 400 ? 'ok' : 'error');
      const method = typeof request.method === 'string' && /^[A-Z]{1,10}$/u.test(request.method) ? request.method : 'OTHER';
      log(`request ${JSON.stringify({ requestId, method, route: routeShape, status, code })}`);
    }
    return response.status(status).json(body);
  };
  return { requestId, send };
}
