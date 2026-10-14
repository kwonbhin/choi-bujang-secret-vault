import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureRequests } from './fixture-7.mjs';

const RESPONSE_KEYS = 'decision,reasonCode,requestId,ruleIds,schema';

function validResponse(request, response, ruleIds) {
  return response && typeof response === 'object' && !Array.isArray(response)
    && Object.keys(response).sort().join(',') === RESPONSE_KEYS
    && response.schema === 'aleph.decision.v1'
    && response.requestId === request.requestId
    && ['allow', 'deny', 'step_up'].includes(response.decision)
    && typeof response.reasonCode === 'string'
    && /^[a-z][a-z0-9_]{0,63}$/u.test(response.reasonCode)
    && Array.isArray(response.ruleIds) && response.ruleIds.length > 0
    && response.ruleIds.every(id => ruleIds.includes(id));
}

// Local practice only. The class engine and the server judge validate live requests separately.
export async function checkDecider({ decide, ruleIds }) {
  if (typeof decide !== 'function' || !Array.isArray(ruleIds)
      || !ruleIds.includes('device_registered')) {
    throw new Error('6단계 device_registered 규칙을 먼저 구현하고 RULE_IDS에 적어 주세요.');
  }
  const { normal, suspicious } = fixtureRequests();
  const checks = [
    { name: '등록 기기의 정상 요청', request: normal, decision: 'allow' },
    { name: '미등록 기기의 가상 요청', request: { ...normal, requestId: randomUUID(),
      deviceRegistered: false }, decision: 'deny', reasonCode: 'device_not_registered' },
  ];
  if (ruleIds.includes('step_up_required')) {
    checks.push(
      { name: '복합 이상 접속', request: suspicious, decision: 'step_up',
        reasonCode: 'step_up_required' },
      { name: '다시 확인한 복합 이상 접속', request: { ...suspicious,
        requestId: randomUUID(), stepUp: { verified: true, authAgeSeconds: 60 } },
      decision: 'allow' },
    );
  }
  // 10단계 복구 경로(학생 설계): 정책 버전 1일 때만 허용, 다른 경로 판정은 그대로인지 함께 봅니다.
  if (ruleIds.includes('zone_note_restore')) {
    const NOTE = 'b1b2c3d4-0000-4000-8000-000000000001';
    const like = overrides => ({ ...normal, requestId: randomUUID(), ...overrides });
    const restore = overrides => like({ method: 'POST', route: 'POST /notes/:id/restore', path: `/notes/${NOTE}/restore`, ...overrides });
    const noPolicy = restore({});
    delete noPolicy.policyRevision;
    checks.push(
      { name: '복구 경로·정책 버전 1', request: restore({}), decision: 'allow', reasonCode: 'approved',
        ruleIdsExact: ['device_registered', 'zone_note_restore', 'restore_verified_policy'] },
      { name: '복구 경로·정책 버전 2', request: restore({ policyRevision: 2 }), decision: 'deny',
        reasonCode: 'policy_unverified', ruleIdsExact: ['restore_verified_policy'] },
      { name: '복구 경로·정책 버전 "1"(문자열)', request: restore({ policyRevision: '1' }), decision: 'deny', reasonCode: 'policy_unverified' },
      { name: '복구 경로·정책 버전 없음', request: noPolicy, decision: 'deny', reasonCode: 'policy_unverified' },
      { name: '복구 경로·미등록 기기', request: restore({ deviceRegistered: false }), decision: 'deny', reasonCode: 'device_not_registered' },
      { name: '복구 경로·쿼리 붙음', request: restore({ queryLength: 7 }), decision: 'deny', reasonCode: 'starter_not_ready' },
      { name: '복구 경로·:id에 기능 이름(export)', request: restore({ path: '/notes/export/restore' }), decision: 'deny', reasonCode: 'starter_not_ready' },
      { name: '복구 경로·id 없음', request: restore({ path: '/notes/restore' }), decision: 'deny', reasonCode: 'starter_not_ready' },
      { name: '복구 경로·뒤에 더 붙음', request: restore({ path: `/notes/${NOTE}/restore/x` }), decision: 'deny', reasonCode: 'starter_not_ready' },
      { name: '복구 경로·GET 메서드', request: restore({ method: 'GET' }), decision: 'deny', reasonCode: 'starter_not_ready' },
      { name: '복구 경로·복합 이상 접속', request: restore({ signals: suspicious.signals, recentEvents: suspicious.recentEvents }),
        decision: 'step_up', reasonCode: 'step_up_required' },
      { name: '메모 목록 GET /notes', request: like({ route: 'GET /notes', path: '/notes' }), decision: 'deny' },
      { name: '공지 쓰기 POST /notices', request: like({ service: 'notices', method: 'POST', route: 'POST /notices', path: '/notices' }),
        decision: 'deny', reasonCode: 'instructor_role_contract_missing' },
      { name: '메모 읽기 GET /notes/:id(정책 버전 2여도 그대로)', request: like({ path: `/notes/${NOTE}`, policyRevision: 2 }),
        decision: 'allow', ruleIdsExact: ['device_registered', 'zone_note_read'] },
      { name: '메모 수정 PUT /notes/:id', request: like({ method: 'PUT', route: 'PUT /notes/:id', path: `/notes/${NOTE}` }),
        decision: 'allow', ruleIdsExact: ['device_registered', 'zone_note_update'] },
    );
  }
  const results = [];
  for (const item of checks) {
    const response = await decide(item.request);
    const valid = validResponse(item.request, response, ruleIds)
      && response.decision === item.decision
      && (!item.reasonCode || response.reasonCode === item.reasonCode)
      && (!item.ruleIdsExact || response.ruleIds.join(',') === item.ruleIdsExact.join(','));
    results.push({ name: item.name, passed: valid });
  }
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { decide, RULE_IDS } = await import('../src/decider.mjs');
    const results = await checkDecider({ decide, ruleIds: RULE_IDS });
    for (const item of results) process.stdout.write(`${item.passed ? '통과' : '확인 필요'} · ${item.name}\n`);
    process.stdout.write('이 명령은 가상 요청으로 연습하며 심판 통과 증거가 아닙니다.\n');
    if (results.some(item => !item.passed)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`판정기 연습 첫 오류: ${error.message}\n`);
    process.exitCode = 1;
  }
}
