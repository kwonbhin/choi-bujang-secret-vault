// 12단계 신원 회수: 회수된 신원 등록부(supabase/step12_revoked_identities.sql, vault_revoked_identities)를 읽습니다.
// - 신원 키 = HMAC-SHA256(서버 전용 키에서 HKDF로 뽑은 키, 토큰의 사용자 ID sub)의 16진수. 원본 ID는 표에 남지 않습니다.
// - 보호 API(메모·복구·기기·작전실)는 로그인 확인 직후, 학생·심판 토큰 모두 등록부에 있으면(해제되지 않았으면)
//   자료 없이 403 identity_revoked로 닫습니다. 등록부를 읽지 못하면 503으로 닫습니다(fail-closed).
// - 회수·해제는 앱에 경로가 없고 학생이 SQL Editor에서만 합니다. 키 원문과 신원 키는 로그에 남기지 않습니다.
import { createHmac, hkdfSync } from 'node:crypto';

export const REVOKED_IDENTITIES = 'vault_revoked_identities';
const LABEL = 'vault-identity-revocation-v1';

export function createIdentityKeyer(secretKey) {
  if (typeof secretKey !== 'string' || !secretKey) throw new TypeError('missing_identity_key');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secretKey, 'utf8'), Buffer.alloc(0), Buffer.from(LABEL, 'utf8'), 32));
  return sub => createHmac('sha256', key).update(String(sub), 'utf8').digest('hex');
}

export function supabaseRevocationStore(supabase) {
  return {
    // 해제되지 않은 회수 행이 있으면 true. 읽기 오류는 그대로 던져 호출한 쪽이 503으로 닫습니다.
    async isRevoked(identityKey) {
      const { data, error } = await supabase.from(REVOKED_IDENTITIES).select('identity_key')
        .eq('identity_key', identityKey).is('released_at', null).limit(1);
      if (error) throw error;
      return Array.isArray(data) && data.length > 0;
    },
  };
}

// 반환: async login => { revoked: boolean, identityKey }
export function createIdentityCheck({ keyer, store }) {
  return async function checkIdentity(login) {
    const identityKey = keyer(login.userId);
    return { revoked: await store.isRevoked(identityKey), identityKey };
  };
}

// 보호 API가 로그인 확인 바로 뒤에 부릅니다. 닫으면 false.
export async function guardIdentity(deps, login, send) {
  if (typeof deps.checkIdentity !== 'function') {
    send(503, { error: 'IDENTITY_CHECK_UNAVAILABLE' });
    return null;
  }
  let result;
  try {
    result = await deps.checkIdentity(login);
  } catch (error) {
    console.error('identity: 회수 등록부를 읽지 못했습니다.', error?.code || 'unknown');
    send(503, { error: 'IDENTITY_CHECK_UNAVAILABLE' });
    return null;
  }
  if (!result || typeof result.revoked !== 'boolean') {
    send(503, { error: 'IDENTITY_CHECK_UNAVAILABLE' });
    return null;
  }
  if (result.revoked) {
    send(403, { error: 'identity_revoked' });
    return null;
  }
  return result;
}
