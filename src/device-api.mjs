// 11단계 기기 승인 서버 함수 POST /api/devices/:action 입니다(학생 설계, 판정기 계약의 보호 자료 경로가 아님).
//   challenge  { purpose: 'register' | 'verify' } → 서버가 낸 일회용 질문(2분, 한 번만)과 패스키 옵션
//   register   패스키 등록 응답 → 공개키만 등록부에 pending으로 올림. 본문의 status 같은 칸은 읽지 않습니다.
//   verify     패스키 서명 응답 → 등록부 공개키로 서명 검증 → 등록부가 approved인지 다시 읽음 →
//              그 결과를 계약대로 deviceRegistered로 넣어 판정기 decide()를 부르고, allow일 때만 30분 기기 확인 결과를 줍니다.
// 학생 로그인만 받습니다. 심판 토큰에는 브라우저 기기가 없어 403입니다(심판 기기는 엔진이 판정기에 알림).
// 승인·취소 경로는 이 앱에 두지 않습니다. 학생이 Supabase SQL Editor에서 직접 합니다(supabase/step11_devices.sql 아래 주석).
// 개인키는 기기 인증 장치 밖으로 나오지 않고, 질문·공개키·서명·기기 확인 결과는 로그에 남기지 않습니다.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { createLoginVerifier } from './verify-login.mjs';
import { decide as deciderDecide } from './decider.mjs';
import { WebAuthnError, fromB64url, verifyAssertion, verifyRegistration } from './webauthn.mjs';
import { createDeviceSigner, supabaseDeviceStore } from './device-gate.mjs';

const CHALLENGE_SECONDS = 120;
const ACTIONS = new Set(['challenge', 'register', 'verify']);
const hex = value => createHash('sha256').update(value).digest('hex');

// 판정기에 넣는 대표 요청: "이 기기로 메모 한 건 읽기"(GET /notes/:id). 판정기에는 기기 확인 전용 구역이 없어
// 기존 구역 규칙 그대로 이 요청으로 묻습니다. 계약의 18개 이름만 넣고, 계약에 없는 칸은 만들지 않습니다.
// classId·projectId는 반 엔진이 확인해 주는 값인데 이 앱 안 호출에는 없어서 null로 둡니다(판정기는 읽지 않음).
export function deviceDecisionRequest({ userId, credentialId, registered, userVerified, now }) {
  return {
    schema: 'aleph.decision.v1',
    requestId: randomUUID(),
    classId: null,
    projectId: null,
    subjectId: hex(`${config.identityProvider?.issuer}|${userId}`).slice(0, 32),
    deviceId: hex(credentialId).slice(0, 16),
    service: 'notes',
    method: 'GET',
    path: '/notes/device-check',
    route: 'GET /notes/:id',
    queryLength: 0,
    querySha256: hex(''),
    at: now.toISOString(),
    policyRevision: 1,
    deviceRegistered: registered === true,
    stepUp: userVerified ? { verified: true, authAgeSeconds: 0 } : { verified: false, authAgeSeconds: null },
    recentEvents: [],
    signals: { source: 'none', region: 'unknown', network: 'unknown', hour: null },
  };
}

function relyingParty() {
  const app = new URL(config.publicAppUrl);
  return { rpId: app.hostname, origin: app.origin };
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
    store: supabaseDeviceStore(supabase),
    signer: createDeviceSigner(key),
    decide: deciderDecide,
    rp: relyingParty(),
    now: () => new Date(),
  };
  return cached;
}

class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.extra = extra;
  }
}

// 본문에서 정해진 칸만 꺼냅니다. 그 밖의 칸(status·owner_id·approved 등)은 읽지 않습니다.
function readBody(raw, fields) {
  let input = raw;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { throw new HttpError(400, 'INVALID_JSON'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'INVALID_BODY');
  return Object.fromEntries(fields.map(name => [name, input[name]]));
}

async function consume(deps, login, purpose, challenge) {
  const used = await deps.store.consumeChallenge({
    ownerId: login.userId, purpose, challengeSha256: hex(fromB64url(challenge, { max: 128 })), now: deps.now(),
  });
  if (!used) throw new HttpError(400, 'CHALLENGE_INVALID');
}

const actions = {
  async challenge(deps, login, request) {
    const { purpose } = readBody(request.body, ['purpose']);
    if (purpose !== 'register' && purpose !== 'verify') throw new HttpError(400, 'INVALID_PURPOSE');
    let allowCredentials = [];
    if (purpose === 'verify') {
      allowCredentials = await deps.store.activeCredentials(login.userId);
      // 등록한 기기가 없으면 질문을 만들지 않습니다.
      if (!allowCredentials.length) return [200, { purpose, status: 'none', allowCredentials: [] }];
    }
    const challenge = randomBytes(32).toString('base64url');
    const now = deps.now();
    await deps.store.insertChallenge({
      ownerId: login.userId, purpose, challengeSha256: hex(Buffer.from(challenge, 'base64url')),
      expiresAt: new Date(now.getTime() + CHALLENGE_SECONDS * 1000),
    });
    return [200, {
      purpose, challenge, rpId: deps.rp.rpId, timeoutMs: CHALLENGE_SECONDS * 1000,
      // 패스키 사용자 id: 로그인 사용자 번호의 해시 앞 16바이트(이메일·이름은 넣지 않음).
      ...(purpose === 'register' ? { userHandle: createHash('sha256').update(login.userId).digest().subarray(0, 16).toString('base64url') } : {}),
      allowCredentials,
    }];
  },

  async register(deps, login, request) {
    const body = readBody(request.body, ['credentialId', 'clientDataJSON', 'attestationObject']);
    const registration = verifyRegistration(body, deps.rp);
    await consume(deps, login, 'register', registration.challenge);
    let row;
    try {
      row = await deps.store.insertDevice({
        ownerId: login.userId, credentialId: registration.credentialId,
        publicKey: registration.publicKey, alg: registration.alg,
      });
    } catch (error) {
      if (error?.code === '23505') throw new HttpError(409, 'DEVICE_ALREADY_REGISTERED');
      if (error?.code === 'P0001') throw new HttpError(429, 'TOO_MANY_PENDING_DEVICES');
      throw error;
    }
    return [201, { deviceId: row.id, status: row.status }];
  },

  async verify(deps, login, request) {
    const body = readBody(request.body, ['credentialId', 'clientDataJSON', 'authenticatorData', 'signature']);
    const credentialId = fromB64url(body.credentialId, { max: 1400 }).toString('base64url');
    const device = await deps.store.deviceByCredential(credentialId);
    // 다른 사람 기기와 없는 기기는 같은 답으로 거부합니다.
    if (!device || device.owner_id !== login.userId) throw new HttpError(403, 'DEVICE_NOT_FOUND');
    const assertion = verifyAssertion(body, device, deps.rp);
    await consume(deps, login, 'verify', assertion.challenge);
    // 서명이 맞은 뒤 등록부를 다시 읽어 지금 상태로 판단합니다.
    const current = await deps.store.deviceById(device.id);
    const status = current && current.owner_id === login.userId ? current.status : 'revoked';
    const decision = await deps.decide(deviceDecisionRequest({
      userId: login.userId, credentialId, registered: status === 'approved',
      userVerified: assertion.userVerified, now: deps.now(),
    }));
    const verdict = { decision: decision?.decision ?? 'deny', reasonCode: decision?.reasonCode ?? 'unknown' };
    if (status !== 'approved' || decision?.decision !== 'allow') {
      return [403, { error: 'DEVICE_NOT_APPROVED', status, deviceId: device.id, ...verdict }];
    }
    const issued = deps.signer.issue({ userId: login.userId, deviceId: device.id, now: deps.now() });
    return [200, { status, deviceId: device.id, ...verdict, deviceCheck: issued.token, expiresAt: issued.expiresAt }];
  },
};

// getDeps는 로컬 시험에서 가짜 검사기·저장소를 넣을 때만 바꿉니다.
export function createDeviceHandler(getDeps = loadDeps) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => response.status(status).json(body);
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    const action = request.query?.action;
    if (typeof action !== 'string' || !ACTIONS.has(action)) {
      send(404, { error: 'NOT_FOUND' });
      return;
    }
    let deps;
    try {
      deps = getDeps();
    } catch (error) {
      console.error('devices: 설정을 불러오지 못했습니다.', error.message);
      send(500, { error: 'DEVICES_NOT_CONFIGURED' });
      return;
    }
    const authorization = request.headers?.authorization;
    const login = authorization ? await deps.verifyLogin(authorization) : null;
    if (!login) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      send(401, { error: authorization ? 'INVALID_LOGIN' : 'LOGIN_REQUIRED' });
      return;
    }
    if (login.kind === 'judge') {
      send(403, { error: 'STUDENT_DEVICE_ONLY' });
      return;
    }
    try {
      const [status, body] = await actions[action](deps, login, request);
      send(status, body);
    } catch (error) {
      if (error instanceof HttpError) {
        send(error.status, { error: error.message, ...error.extra });
        return;
      }
      if (error instanceof WebAuthnError) {
        send(400, { error: error.code });
        return;
      }
      console.error('devices: 요청을 처리하지 못했습니다.', error?.code || 'unknown');
      send(502, { error: 'DEVICES_UNAVAILABLE' });
    }
  };
}
