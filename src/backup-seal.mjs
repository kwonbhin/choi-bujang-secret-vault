// 10단계 사본 봉인입니다. 학생 설계(계약에 없음).
// 서버 전용 키(SUPABASE_SECRET_KEY)에서 HKDF-SHA256(라벨 "vault-backup-seal-v1")로 봉인 키를 뽑고,
// HMAC-SHA256(note_id | owner_id | content_sha256)을 봉인으로 씁니다(소문자 16진수 64자).
// 사본 행과 그 해시를 함께 바꾸더라도 서버 키 없이는 맞는 봉인을 만들 수 없습니다.
// 키 원문·봉인 키·봉인 값은 로그와 응답에 넣지 않습니다. 오류는 코드만 남깁니다.
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

export const SEAL_TABLE = 'vault_notes_backup_seal';
const SNAPSHOT = 'vault_notes_snapshot';
const LABEL = 'vault-backup-seal-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export function createSealer(secretKey) {
  if (typeof secretKey !== 'string' || !secretKey) throw new Error('봉인 키를 만들 서버 전용 키가 없습니다.');
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secretKey, 'utf8'), Buffer.alloc(0), Buffer.from(LABEL, 'utf8'), 32));
  const compute = (noteId, ownerId, contentSha256) => createHmac('sha256', key)
    .update(`${noteId}|${ownerId}|${contentSha256}`, 'utf8').digest();
  return Object.freeze({
    // 새 봉인 값(16진수). 저장할 때만 씁니다.
    seal(noteId, ownerId, contentSha256) {
      return compute(noteId, ownerId, contentSha256).toString('hex');
    },
    // 저장된 봉인 행이 이 사본(note_id, owner_id, content_sha256)과 맞는지 다시 계산해 시간 일정 비교로 봅니다.
    verify(sealRow, { noteId, ownerId, contentSha256 }) {
      if (!sealRow || sealRow.note_id !== noteId || sealRow.owner_id !== ownerId
          || sealRow.content_sha256 !== contentSha256 || typeof sealRow.seal !== 'string'
          || !SHA256_HEX.test(sealRow.seal)) {
        return false;
      }
      return timingSafeEqual(Buffer.from(sealRow.seal, 'hex'), compute(noteId, ownerId, contentSha256));
    },
  });
}

// 새 메모가 생긴 직후 부릅니다. 사본 행을 다시 읽어 그 해시로 봉인을 한 번만 넣습니다(이미 있으면 그대로).
// 반환: 'sealed' | 'already_sealed'. 실패하면 오류를 던지고, 부르는 쪽이 코드만 로그에 남깁니다.
export async function sealNewNote({ supabase, sealer, noteId }) {
  if (!sealer) throw Object.assign(new Error('seal_not_configured'), { code: 'seal_not_configured' });
  if (typeof noteId !== 'string' || !UUID.test(noteId)) throw Object.assign(new Error('seal_bad_id'), { code: 'seal_bad_id' });
  const { data: snapshot, error } = await supabase.from(SNAPSHOT)
    .select('id, owner_id, content_sha256').eq('id', noteId).maybeSingle();
  if (error) throw error;
  if (!snapshot || !SHA256_HEX.test(snapshot.content_sha256 ?? '')) {
    throw Object.assign(new Error('seal_snapshot_missing'), { code: 'seal_snapshot_missing' });
  }
  const { error: insertError } = await supabase.from(SEAL_TABLE).insert({
    note_id: snapshot.id, owner_id: snapshot.owner_id, content_sha256: snapshot.content_sha256,
    seal: sealer.seal(snapshot.id, snapshot.owner_id, snapshot.content_sha256),
  });
  if (insertError?.code === '23505') return 'already_sealed';
  if (insertError) throw insertError;
  return 'sealed';
}
