// ALEPH SDP 엔진이 확인한 요청만 받는 학생 판정기 시작점입니다.
// 6단계부터 규칙을 하나씩 추가합니다. 어느 규칙에도 맞지 않으면 기본 응답으로 거부합니다.
// 요청 본문의 userId, role, 기기 키, 토큰을 별도로 믿거나 저장하지 마세요.
export const RULE_IDS = Object.freeze([
  'starter.deny', 'device_registered', 'step_up_required',
  'zone_note_read', 'zone_note_update', 'zone_notice_update',
  'zone_note_restore', 'restore_verified_policy',
]);

// 8단계 구역: 계약의 정확한 route 표기만 받습니다. allowedRoutes(`/api/...`)와는 표기가 다릅니다.
// 자원 ID는 종류를 앞에 붙여 메모(note:<id>)와 강사 공지(notice:<id>)를 구별합니다.
// 메모 주인은 판정기가 정하지 않습니다. 가명 subjectId를 owner_id와 비교하지 않고, 주인 검사는
// API(/api/notes의 owner_id 조건, 남의 메모는 404)가 맡습니다.
// 강사 역할은 계약에 없으므로 누구도 강사로 보지 않습니다. 공지 수정은 항상 거부합니다.
export const RESOURCE_KINDS = Object.freeze({
  note: Object.freeze({ service: 'notes', prefix: '/notes' }),
  notice: Object.freeze({ service: 'notices', prefix: '/notices' }),
});
// 메모는 한 건 읽기·수정과 (10단계) 한 건 복구만 허용합니다. 메모 전체 목록(GET /notes)은 표에 없어 거부됩니다.
// 공지 경로의 쓰기(POST·PUT·PATCH·DELETE)는 모두 zone_notice_update로 거부합니다.
const NOTICE_WRITE = { kind: 'notice', ruleId: 'zone_notice_update', deny: 'instructor_role_contract_missing' };
// 10단계 메모 복구(학생 설계): 정확히 /notes/<id>/restore 모양만 받고, 검증한 안전 정책 버전일 때만 허용합니다.
const ZONES = Object.freeze({
  'GET /notes/:id': { kind: 'note', item: true, ruleId: 'zone_note_read' },
  'PUT /notes/:id': { kind: 'note', item: true, ruleId: 'zone_note_update' },
  'POST /notes/:id/restore': { kind: 'note', item: true, suffix: '/restore', ruleId: 'zone_note_restore', verifiedPolicy: true },
  ...Object.fromEntries(['POST', 'PUT', 'PATCH', 'DELETE'].flatMap(method => [
    [`${method} /notices`, { ...NOTICE_WRITE, item: false }],
    [`${method} /notices/:id`, { ...NOTICE_WRITE, item: true }],
  ])),
});
// 자료 ID 모양입니다. 점·슬래시·% 인코딩은 받지 않습니다.
const RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
// :id 자리에 기능 이름이 오면 자료 ID로 보지 않습니다. 기능은 쿼리나 같은 깊이의 경로로 고르지 않습니다.
const FUNCTION_SEGMENTS = new Set(['export', 'import', 'download', 'upload', 'backup', 'dump', 'all',
  'bulk', 'admin', 'search', 'query', 'share', 'copy', 'raw', 'list', 'delete', 'edit', 'update']);

// 요청의 자원을 정합니다. 정확한 route·method·service·path가 맞고 쿼리가 없을 때만 돌려주고, 그 밖에는 null입니다.
export function resourceOf(request) {
  if (typeof request.route !== 'string' || !Object.hasOwn(ZONES, request.route)) return null;
  const zone = ZONES[request.route];
  const kind = RESOURCE_KINDS[zone.kind];
  const [method] = request.route.split(' ');
  if (request.method !== method || request.service !== kind.service) return null;
  if (request.queryLength !== 0) return null;
  if (typeof request.path !== 'string') return null;
  if (!zone.item) return request.path === kind.prefix ? { ...zone, id: null, resourceId: `${zone.kind}:*` } : null;
  if (!request.path.startsWith(`${kind.prefix}/`)) return null;
  const suffix = zone.suffix ?? '';
  if (suffix && !request.path.endsWith(suffix)) return null;
  const id = request.path.slice(kind.prefix.length + 1, request.path.length - suffix.length);
  if (!RESOURCE_ID.test(id) || FUNCTION_SEGMENTS.has(id.toLowerCase())) return null;
  return { ...zone, id, resourceId: `${zone.kind}:${id}` };
}

// 계약에 나온 signals.source 두 값만 압니다. 그 밖의 출처는 신뢰하는 접속 정보로 쓰지 않습니다.
const KNOWN_SOURCES = new Set(['none', 'judge_fixture']);
// 평소와 다른 시각: signals.hour 0~5시. 계약에 hour의 시간대가 없어 추측하지 않고,
// 연습 요청(scripts/fixture-7.mjs)의 정상 14시·이상 3시를 근거로 새벽 구간만 봅니다.
const UNUSUAL_HOURS = { from: 0, to: 5 };
const BURST_WINDOW_SECONDS = 600; // 최근 10분 안의 사건만 셉니다.
const BURST_COUNT = 10; // 그 안에 이만큼 넘게 몰리면 갑자기 많은 읽기로 봅니다.
const STEP_UP_MAX_AGE_SECONDS = 300; // 추가 인증 뒤 5분 안의 요청만 다시 확인된 것으로 봅니다.
// 복구 경로에 적용할 검증한 안전 정책 버전: 계약의 policyRevision. 연습 정상 요청(scripts/fixture-7.mjs)의 값 1과 같습니다.
// DB 쪽 안전 정책 사본 's9-safe-1'(supabase/step10_policy_backup.sql)이 이 버전에 대응합니다.
const VERIFIED_POLICY_REVISION = 1;

const respond = (request, decision, reasonCode, ruleIds) => ({
  schema: 'aleph.decision.v1',
  requestId: request.requestId,
  decision,
  reasonCode,
  ruleIds: [ruleIds].flat(),
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
  // 구역: 표에 있는 정확한 경로가 아니거나, 쿼리가 붙었거나, :id 자리에 기능 이름이 오면 시작 틀 규칙으로 거부합니다.
  const resource = resourceOf(request);
  if (!resource) {
    return respond(request, 'deny', 'starter_not_ready', RULE_IDS[0]);
  }
  // zone_notice_update: 강사 역할 계약이 없어 누구도 강사로 보지 않으므로 공지 수정은 항상 거부합니다.
  if (resource.deny) {
    return respond(request, 'deny', resource.deny, resource.ruleId);
  }
  // step_up_required: 평소와 다른 시각 + 처음 보는 네트워크 + 갑자기 많은 읽기가 함께 보이면 추가 확인을 요청합니다.
  // 접속 신호나 사건의 출처·형식을 믿을 수 없을 때도 정상으로 보지 않고 추가 확인을 요청합니다.
  // 지역은 판단 근거로 쓰지 않습니다. 지역 하나로 막거나 영구 차단하지 않고, 다시 확인되면 허용합니다.
  const signals = readSignals(request.signals);
  const burst = recentBurst(request.recentEvents);
  const unusualAccess = signals.trusted && signals.evidence !== null
    && signals.evidence.hour >= UNUSUAL_HOURS.from && signals.evidence.hour <= UNUSUAL_HOURS.to
    && signals.evidence.network === 'unusual'
    && burst !== null && burst > BURST_COUNT;
  if ((!signals.trusted || burst === null || unusualAccess) && !freshStepUp(request.stepUp)) {
    return respond(request, 'step_up', 'step_up_required', 'step_up_required');
  }
  // restore_verified_policy: 복구 경로는 계약의 policyRevision이 검증한 안전 정책 버전과 정확히 같을 때만 허용합니다.
  // 값이 없거나 다르면 복구하지 않습니다. 다른 경로는 이 규칙을 보지 않습니다.
  if (resource.verifiedPolicy) {
    if (request.policyRevision !== VERIFIED_POLICY_REVISION) {
      return respond(request, 'deny', 'policy_unverified', 'restore_verified_policy');
    }
    return respond(request, 'allow', 'approved', ['device_registered', resource.ruleId, 'restore_verified_policy']);
  }
  // 메모 읽기·수정 구역의 경로상 허용입니다. 그 메모가 요청한 사람의 것인지는 API가 owner_id로 다시 검사합니다.
  return respond(request, 'allow', 'approved', ['device_registered', resource.ruleId]);
}
