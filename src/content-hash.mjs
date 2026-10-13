// 10단계 메모 내용 해시입니다. 학생 설계(계약에 없음).
// 해시 = SHA-256( UTF-8(title) + 0x00 바이트 + UTF-8(content) )의 소문자 16진수 64자.
// Postgres의 text에는 0x00이 들어갈 수 없으므로 구분 바이트로 쓰면 제목·본문 경계가 섞이지 않습니다.
// 같은 계산을 supabase/restore.sql의 public.vault_note_sha256(title, content)가 합니다.
// 유니코드 정규화는 하지 않고 저장된 문자열의 바이트 그대로 계산합니다.
import { createHash } from 'node:crypto';

export function noteSha256(title, content) {
  if (typeof title !== 'string' || typeof content !== 'string') throw new TypeError('invalid_note_text');
  return createHash('sha256')
    .update(Buffer.from(title, 'utf8'))
    .update(Buffer.from([0]))
    .update(Buffer.from(content, 'utf8'))
    .digest('hex');
}
