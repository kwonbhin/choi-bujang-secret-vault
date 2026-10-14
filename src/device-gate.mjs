// 11단계: 기기 등록부(supabase/step11_devices.sql)와 기기 확인 결과를 다룹니다.
// - 기기 확인 결과: 패스키 서명 검증 + 등록부 approved + 판정기 allow일 때만 서버가 주는 30분짜리 표입니다.
//   서버 전용 키(SUPABASE_SECRET_KEY)에서 HKDF로 뽑은 키의 HMAC-SHA256으로 서명하고, 화면은 메모리 변수에만 둡니다.
// - 보호 자료 API는 학생 로그인일 때 이 표의 서명·만료·사용자를 확인하고, 등록부를 다시 읽어 그 기기가 지금도
//   approved이고 같은 사용자의 것인지 확인합니다. 없거나 승인 아님이면 자료를 읽거나 쓰기 전에 403입니다.
// - 심판 토큰(verify-login의 kind 'judge')에는 이 브라우저 기기 검사를 걸지 않습니다. 심판 요청의 기기는
//   반 엔진이 계약대로 deviceRegistered로 판정기에 알립니다.
// 키·표 원문·공개키는 로그와 응답에 넣지 않습니다.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const DEVICES = 'vault_devices';
export const CHALLENGES = 'vault_device_challenges';
export const DEVICE_HEADER = 'x-vault-device';
export const DEVICE_CHECK_SECONDS = 30 * 60;
const LABEL = 'vault-device-check-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const TOKEN = /^[A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{43}$/u;

function checked({ data, error }) {
  if (error) throw error;
  return data;
}

// Supabase 등록부. 로컬 시험은 같은 모양의 메모리 저장소를 넣습니다.
export function supabaseDeviceStore(supabase) {
  return {
    async insertChallenge({ ownerId, purpose, challengeSha256, expiresAt }) {
      checked(await supabase.from(CHALLENGES).insert({
        owner_id: ownerId, purpose, challenge_sha256: challengeSha256, expires_at: expiresAt.toISOString(),
      }));
    },
    // 서버가 낸 질문을 한 번만 씁니다: 같은 사용자·용도이고, 쓰지 않았고, 만료 전일 때만 used_at을 채웁니다.
    async consumeChallenge({ ownerId, purpose, challengeSha256, now }) {
      const row = checked(await supabase.from(CHALLENGES).update({ used_at: now.toISOString() })
        .eq('challenge_sha256', challengeSha256).eq('owner_id', ownerId).eq('purpose', purpose)
        .is('used_at', null).gt('expires_at', now.toISOString()).select('id').maybeSingle());
      return Boolean(row);
    },
    // status는 넣지 않습니다. DB 트리거가 새 기기를 항상 pending으로 만듭니다.
    async insertDevice({ ownerId, credentialId, publicKey, alg }) {
      return checked(await supabase.from(DEVICES)
        .insert({ owner_id: ownerId, credential_id: credentialId, public_key: publicKey, alg })
        .select('id, status').single());
    },
    async deviceByCredential(credentialId) {
      return checked(await supabase.from(DEVICES).select('id, owner_id, public_key, alg, status')
        .eq('credential_id', credentialId).maybeSingle());
    },
    async deviceById(id) {
      return checked(await supabase.from(DEVICES).select('id, owner_id, status').eq('id', id).maybeSingle());
    },
    async activeCredentials(ownerId) {
      const rows = checked(await supabase.from(DEVICES).select('credential_id')
        .eq('owner_id', ownerId).neq('status', 'revoked').order('created_at', { ascending: true }).limit(10));
      return rows.map(row => row.credential_id);
    },
  };
}

export function createDeviceSigner(secretKey) {
  if (typeof secretKey !== 'string' || !secretKey) throw new TypeError('missing_device_key');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secretKey, 'utf8'), Buffer.alloc(0), Buffer.from(LABEL, 'utf8'), 32));
  const mac = text => createHmac('sha256', key).update(text, 'utf8').digest();
  return Object.freeze({
    issue({ userId, deviceId, now = new Date() }) {
      const exp = Math.floor(now.getTime() / 1000) + DEVICE_CHECK_SECONDS;
      const body = Buffer.from(JSON.stringify({ v: 1, sub: userId, dev: deviceId, exp }), 'utf8').toString('base64url');
      return { token: `${body}.${mac(body).toString('base64url')}`, expiresAt: new Date(exp * 1000).toISOString() };
    },
    // 서명·형식·만료가 맞으면 { userId, deviceId }, 아니면 null.
    read(token, now = new Date()) {
      if (typeof token !== 'string' || !TOKEN.test(token)) return null;
      const [body, signature] = token.split('.');
      const given = Buffer.from(signature, 'base64url');
      const expected = mac(body);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      let payload;
      try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
      if (payload?.v !== 1 || !UUID.test(payload.sub ?? '') || !UUID.test(payload.dev ?? '')
          || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(now.getTime() / 1000)) return null;
      return { userId: payload.sub, deviceId: payload.dev };
    },
  });
}

// 보호 자료 API가 부르는 검사입니다. 반환: { ok: true } 또는 { ok: false, error }.
export function createDeviceGate({ signer, store, now = () => new Date() }) {
  return async function checkDevice(login, request) {
    if (login?.kind === 'judge') return { ok: true, skipped: 'judge' };
    const header = request.headers?.[DEVICE_HEADER];
    const check = signer.read(Array.isArray(header) ? header[0] : header, now());
    if (!check) return { ok: false, error: 'DEVICE_CHECK_REQUIRED' };
    if (check.userId !== login.userId) return { ok: false, error: 'DEVICE_CHECK_REQUIRED' };
    const device = await store.deviceById(check.deviceId);
    if (!device || device.owner_id !== login.userId || device.status !== 'approved') {
      return { ok: false, error: 'DEVICE_NOT_APPROVED' };
    }
    return { ok: true };
  };
}

// notes-api·restore-api가 함께 씁니다. 검사기가 없거나 등록부를 읽지 못하면 자료를 열지 않습니다.
export async function guardDevice(deps, login, request, send) {
  if (login?.kind === 'judge') return true;
  if (typeof deps.checkDevice !== 'function') {
    send(500, { error: 'DEVICE_CHECK_NOT_CONFIGURED' });
    return false;
  }
  let result;
  try {
    result = await deps.checkDevice(login, request);
  } catch (error) {
    console.error('devices: 기기 등록부를 읽지 못했습니다.', error?.code || 'unknown');
    send(503, { error: 'DEVICE_CHECK_UNAVAILABLE' });
    return false;
  }
  if (!result?.ok) {
    send(403, { error: result?.error ?? 'DEVICE_NOT_APPROVED' });
    return false;
  }
  return true;
}
