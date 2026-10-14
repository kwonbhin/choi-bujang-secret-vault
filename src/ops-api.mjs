// 12단계 탈환 작전실 GET /api/ops/summary 입니다(학생 설계, 판정기 구역 표에는 없음).
// 로그인한 사람(학생은 승인된 기기 확인까지)의 본인 범위만, 서버가 실제로 읽은 값으로 돌려줍니다.
// 값마다 출처(source)를 붙입니다.
//   code         코드 정의값(이 배포의 코드에서 읽음)
//   server       서버 조회값(이번 요청에서 Supabase를 실제로 읽음)
//   failed       조회 실패(읽으려 했지만 실패, 값 없음)
//   unconnected  미연결(이 앱이 읽을 곳이 연결되지 않음)
// 메모 제목·본문, 토큰, 키, 원본 사용자 번호, 메모 id는 넣지 않습니다. 신원 회수 키는 원본 ID의 HMAC입니다.
// 이 응답은 상태 표시용이며 통과 근거가 아닙니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import safePolicy from '../policy/safe-policy.manifest.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';
import { RULE_IDS, resourceOf } from './decider.mjs';
import { detect } from './detect.mjs';
import { DEVICES, createDeviceGate, createDeviceSigner, guardDevice, supabaseDeviceStore } from './device-gate.mjs';
import { createIdentityCheck, createIdentityKeyer, guardIdentity, supabaseRevocationStore } from './identity-revocation.mjs';
import { trackRequest } from './request-id.mjs';

export const SOURCES = Object.freeze(['code', 'server', 'failed', 'unconnected']);
const code = value => ({ source: 'code', value });
const server = value => ({ source: 'server', value });
const failed = () => ({ source: 'failed', value: null });
const unconnected = note => ({ source: 'unconnected', value: null, note });

// 판정기 구역: 판정기 코드의 resourceOf에 경로 모양마다 예시 요청을 넣어 구역 표에 있는 것만 모읍니다.
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SHAPES = [
  ['notes', '/notes', '/notes'], ['notes', '/notes/:id', '/notes/sample1'], ['notes', '/notes/:id/restore', '/notes/sample1/restore'],
  ['notices', '/notices', '/notices'], ['notices', '/notices/:id', '/notices/sample1'],
];
export function deciderZones() {
  const zones = [];
  for (const [service, shape, path] of SHAPES) {
    for (const method of METHODS) {
      const route = `${method} ${shape}`;
      const zone = resourceOf({ route, method, service, path, queryLength: 0 });
      if (zone) {
        zones.push({ route, ruleId: zone.ruleId,
          outcome: zone.deny ? `deny ${zone.deny}` : zone.verifiedPolicy ? 'allow(경로상, 검증한 정책 버전일 때만)' : 'allow(경로상)' });
      }
    }
  }
  return zones;
}

// 탐지 규칙: 탐지기 코드에 가상 사건(같은 가명 사용자 GET 121건·120건, 4분 안)을 넣어 실제 결과를 읽습니다.
export function detectorRule() {
  const reads = n => Array.from({ length: n }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 1) + i * 2000).toISOString(), method: 'GET', identity: { sub: 'ops_fixture' } }));
  const brief = out => [out?.action, out?.reasonCode].filter(Boolean).join('·');
  return { file: 'src/detect.mjs', get121: brief(detect(reads(121))), get120: brief(detect(reads(120))) };
}

async function count(query) {
  const { count: n, error } = await query;
  if (error || !Number.isInteger(n)) throw error ?? new Error('no_count');
  return n;
}
const settle = async read => {
  try { return server(await read()); } catch { return failed(); }
};

export async function buildSummary({ supabase, login, requestId, device, identity, now = new Date() }) {
  const student = login.kind !== 'judge';
  const own = (table, column = 'owner_id') => supabase.from(table).select(column, { count: 'exact', head: true }).eq(column, login.userId);
  return {
    schema: 'vault.ops.summary.v1',
    requestId,
    generatedAt: now.toISOString(),
    notice: '상태 표시용 응답입니다. 이 화면이나 응답을 통과 근거로 쓰지 않습니다.',
    viewer: code({ kind: student ? 'student' : 'judge', scope: 'self' }),
    decider: {
      ruleIds: code([...RULE_IDS]),
      zones: code(deciderZones()),
    },
    detection: {
      rule: code(detectorRule()),
      events: unconnected('반 엔진(ALEPH SDP 엔진, 제공)의 사건 전달이 이 앱에 연결되지 않아 서버가 읽은 탐지 사건이 없습니다.'),
    },
    revocation: {
      devices: student
        ? await settle(async () => {
          const { data, error } = await supabase.from(DEVICES).select('status').eq('owner_id', login.userId);
          if (error) throw error;
          const counts = { pending: 0, approved: 0, revoked: 0 };
          for (const row of data) if (Object.hasOwn(counts, row.status)) counts[row.status] += 1;
          return { ...counts, thisDevice: device?.ok ? 'approved' : null };
        })
        : unconnected('심판 토큰에는 브라우저 기기가 없습니다. 심판 기기는 반 엔진이 deviceRegistered로 판정기에 알립니다.'),
      identity: identity
        ? server({ revoked: identity.revoked, revocationKey: identity.identityKey })
        : failed(),
    },
    restore: {
      snapshots: await settle(() => count(own('vault_notes_snapshot'))),
      seals: await settle(() => count(own('vault_notes_backup_seal'))),
      lastAudit: await settle(async () => {
        const { data, error } = await supabase.from('vault_restore_audit').select('outcome, at')
          .eq('actor_id', login.userId).order('audit_id', { ascending: false }).limit(1);
        if (error) throw error;
        return data.length ? { outcome: data[0].outcome, at: data[0].at } : null;
      }),
      dbPolicyBackup: await settle(async () => {
        const { data, error } = await supabase.rpc('vault_policy_backup_versions');
        if (error) throw error;
        return data.map(row => ({ version: row.version, capturedAt: row.captured_at }));
      }),
      testPolicyManifest: code({ revision: safePolicy.revision, verifiedAt: safePolicy.verifiedAt }),
    },
  };
}

let cached;
function loadDeps() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 없습니다.');
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  cached = {
    verifyLogin: createLoginVerifier({ config, supabaseSecretKey: key }),
    supabase,
    checkDevice: createDeviceGate({ signer: createDeviceSigner(key), store: supabaseDeviceStore(supabase) }),
    checkIdentity: createIdentityCheck({ keyer: createIdentityKeyer(key), store: supabaseRevocationStore(supabase) }),
  };
  return cached;
}

// getDeps는 로컬 시험에서 가짜 검사기·저장소를 넣을 때만 바꿉니다.
export function createOpsHandler(getDeps = loadDeps) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const { requestId, send } = trackRequest(request, response, '/api/ops/summary');
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      send(405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let deps;
    try {
      deps = getDeps();
    } catch (error) {
      console.error('ops: 설정을 불러오지 못했습니다.', error.message);
      send(500, { error: 'OPS_NOT_CONFIGURED' });
      return;
    }
    const authorization = request.headers?.authorization;
    const login = authorization ? await deps.verifyLogin(authorization) : null;
    if (!login) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      send(401, { error: authorization ? 'INVALID_LOGIN' : 'LOGIN_REQUIRED' });
      return;
    }
    const identity = await guardIdentity(deps, login, send);
    if (!identity) return;
    if (!(await guardDevice(deps, login, request, send))) return;
    try {
      send(200, await buildSummary({ supabase: deps.supabase, login, requestId, identity,
        device: login.kind === 'judge' ? null : { ok: true } }));
    } catch (error) {
      console.error('ops: 요약을 만들지 못했습니다.', error?.code || 'unknown');
      send(502, { error: 'OPS_UNAVAILABLE' });
    }
  };
}
