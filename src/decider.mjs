// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 어느 규칙에도 맞지 않으면 기본 응답으로 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered']);

// 계약의 route 표기(`GET /notes/:id`)로 본 메모 읽기 경로입니다. allowedRoutes(`/api/...`)와는 표기가 다릅니다.
const NOTE_READ_ROUTE = /^GET \/notes(?:\/:id)?$/u;

const respond = (request, decision, reasonCode, ruleId) => ({
  schema: 'aleph.decision.v1',
  requestId: request.requestId,
  decision,
  reasonCode,
  ruleIds: [ruleId],
});

export async function decide(request) {
  // device_registered: 정확히 true일 때만 등록 기기입니다. "true", 1, 값 없음은 모두 미등록입니다.
  if (request.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', 'device_registered');
  }
  if (request.method === 'GET' && request.service === 'notes'
      && typeof request.route === 'string' && NOTE_READ_ROUTE.test(request.route)) {
    return respond(request, 'allow', 'approved', 'device_registered');
  }
  return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
}
