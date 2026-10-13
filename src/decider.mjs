// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 어느 규칙에도 맞지 않으면 기본 응답으로 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze(['starter.deny', 'device_registered', 'step_up_required']);

// 계약의 route 표기(`GET /notes/:id`)로 본 메모 읽기 경로입니다. allowedRoutes(`/api/...`)와는 표기가 다릅니다.
const NOTE_READ_ROUTE = /^GET \/notes(?:\/:id)?$/u;

// 계약에 나온 signals.source 두 값만 압니다. 그 밖의 출처는 신뢰하는 접속 정보로 쓰지 않습니다.
const KNOWN_SOURCES = new Set(['none', 'judge_fixture']);
const USUAL_HOURS = { from: 7, to: 22 }; // UTC 기준 평소 접속 시각(이 범위 밖이면 평소와 다른 시각)
const BURST_WINDOW_SECONDS = 600; // 최근 10분 안의 사건만 셉니다.
const BURST_COUNT = 10; // 그 안에 이만큼 넘게 몰리면 갑자기 많은 읽기로 봅니다.
const STEP_UP_MAX_AGE_SECONDS = 300; // 추가 인증 뒤 5분 안의 요청만 다시 확인된 것으로 봅니다.

const respond = (request, decision, reasonCode, ruleId) => ({
  schema: 'aleph.decision.v1',
  requestId: request.requestId,
  decision,
  reasonCode,
  ruleIds: [ruleId],
});

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasExactKeys = (value, keys) => isPlainObject(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');

// 접속 신호: 형식이 맞고 출처가 계약 값일 때만 씁니다. 빈 값을 정상값으로 채우지 않습니다.
// 반환: { trusted: false } 이면 출처·형식을 믿을 수 없음, { trusted: true, evidence: null } 이면 신호 없음(source "none").
function readSignals(signals) {
  if (!hasExactKeys(signals, ['source', 'region', 'network', 'hour'])
      || typeof signals.source !== 'string' || !KNOWN_SOURCES.has(signals.source)) {
    return { trusted: false };
  }
  if (signals.source === 'none') return { trusted: true, evidence: null };
  if (typeof signals.region !== 'string' || typeof signals.network !== 'string'
      || !Number.isInteger(signals.hour) || signals.hour < 0 || signals.hour > 23) {
    return { trusted: false };
  }
  return { trusted: true, evidence: signals };
}

// 행동: 엔진이 준 최근 사건 배열(최대 12건, 각 {kind, ageSeconds, count})만 셉니다.
function recentBurst(events) {
  if (!Array.isArray(events) || events.length > 12) return null;
  let total = 0;
  for (const event of events) {
    if (!hasExactKeys(event, ['kind', 'ageSeconds', 'count']) || typeof event.kind !== 'string'
        || !Number.isFinite(event.ageSeconds) || event.ageSeconds < 0
        || !Number.isInteger(event.count) || event.count < 0) {
      return null;
    }
    if (event.ageSeconds <= BURST_WINDOW_SECONDS) total += event.count;
  }
  return total;
}

// 추가 인증: verified가 정확히 true이고 경과 시간이 계약 범위 안의 최근 값일 때만 인정합니다.
const freshStepUp = stepUp => hasExactKeys(stepUp, ['verified', 'authAgeSeconds'])
  && stepUp.verified === true && Number.isInteger(stepUp.authAgeSeconds)
  && stepUp.authAgeSeconds >= 0 && stepUp.authAgeSeconds <= STEP_UP_MAX_AGE_SECONDS;

export async function decide(request) {
  // device_registered: 정확히 true일 때만 등록 기기입니다. "true", 1, 값 없음은 모두 미등록입니다.
  if (request.deviceRegistered !== true) {
    return respond(request, 'deny', 'device_not_registered', 'device_registered');
  }
  if (!(request.method === 'GET' && request.service === 'notes'
      && typeof request.route === 'string' && NOTE_READ_ROUTE.test(request.route))) {
    return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
  }
  // step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 갑자기 많은 읽기가 함께 보이면 추가 확인을 요청합니다.
  // 접속 신호나 사건의 출처·형식을 믿을 수 없을 때도 정상으로 보지 않고 추가 확인을 요청합니다.
  // 지역은 판단 근거로 쓰지 않습니다. 지역 하나로 막거나 영구 차단하지 않고, 다시 확인되면 허용합니다.
  const signals = readSignals(request.signals);
  const burst = recentBurst(request.recentEvents);
  const unusualAccess = signals.trusted && signals.evidence !== null
    && (signals.evidence.hour < USUAL_HOURS.from || signals.evidence.hour > USUAL_HOURS.to)
    && signals.evidence.network === 'unusual'
    && burst !== null && burst > BURST_COUNT;
  if ((!signals.trusted || burst === null || unusualAccess) && !freshStepUp(request.stepUp)) {
    return respond(request, 'step_up', 'step_up_required', 'step_up_required');
  }
  return respond(request, 'allow', 'approved', 'device_registered');
}
