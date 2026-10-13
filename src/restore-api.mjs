// 10단계 복구 서버 함수 POST /api/restores/:id 입니다. 학생 설계(계약에 없음).
// 판정기(src/decider.mjs)는 바꾸지 않았습니다. 복구 경로의 보안은 이 함수가 맡습니다.
// - 로그인 필수: 사용자는 src/verify-login.mjs가 검사한 토큰의 userId로만 정합니다.
//   URL·본문·쿼리의 owner_id는 읽지 않습니다(본문은 아예 읽지 않습니다).
// - 사본(vault_notes_snapshot)의 owner_id가 로그인 사용자이고, 지금 메모 행이 있으면 그 owner_id도
//   로그인 사용자여야 합니다. 아니면 남의 메모와 없는 메모를 같은 404로 답합니다.
// - 복원 전에 사본 해시를 다시 계산해 대조하고, 다르면 복원하지 않고 409로 멈춥니다.
// - 지정한 한 건만: 변조됐으면 사본 내용으로 덮어쓰고, 삭제됐으면 같은 id·owner_id로 다시 넣습니다.
//   다른 메모, 사본, 감사 기록은 바꾸지 않습니다(감사 기록에 한 줄 더하는 것만).
// - 복원 뒤 행을 다시 읽어 id·owner_id·해시가 사본과 같은지 확인합니다.
// - 응답에는 id, 해시, 일치 여부만 넣고 메모 내용은 넣지 않습니다. 감사 기록에도 내용과 토큰은 넣지 않습니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { noteSha256 } from './content-hash.mjs';
import { createLoginVerifier } from './verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NOTES = 'vault_notes';
const SNAPSHOT = 'vault_notes_snapshot';
const AUDIT = 'vault_restore_audit';

let cached;
function loadDeps() {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL 또는 SUPABASE_SECRET_KEY 환경변수가 없습니다.');
  cached = {
    verifyLogin: createLoginVerifier({ config, supabaseSecretKey: key }),
    supabase: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  };
  return cached;
}

function checked({ data, error }) {
  if (error) throw error;
  return data;
}

// getDeps는 로컬 시험에서 가짜 검사기·저장소를 넣을 때만 바꿉니다.
export function createRestoreHandler(getDeps = loadDeps) {
  return async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => response.status(status).json(body);
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      send(405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    let deps;
    try {
      deps = getDeps();
    } catch (error) {
      console.error('restores: 설정을 불러오지 못했습니다.', error.message);
      send(500, { error: 'RESTORE_NOT_CONFIGURED' });
      return;
    }
    const authorization = request.headers?.authorization;
    const login = authorization ? await deps.verifyLogin(authorization) : null;
    if (!login) {
      // 로그인하지 않은 요청은 감사 기록에 남기지 않습니다(누구나 기록을 채우지 못하게).
      response.setHeader('WWW-Authenticate', 'Bearer');
      send(401, { error: authorization ? 'INVALID_LOGIN' : 'LOGIN_REQUIRED' });
      return;
    }
    const { supabase } = deps;
    const rawId = request.query?.id;
    const id = typeof rawId === 'string' && UUID.test(rawId) ? rawId.toLowerCase() : null;

    // 성공이든 실패든 로그인한 요청은 감사 기록에 한 줄 남깁니다. 기록하지 못하면 500으로 알립니다.
    const finish = async (status, body, outcome, sha256 = null, matched = null) => {
      const { error } = await supabase.from(AUDIT).insert({
        actor_id: login.userId, note_id: id, outcome, content_sha256: sha256, matched,
      });
      if (error) {
        console.error('restores: 감사 기록을 남기지 못했습니다.', error.code || 'unknown');
        send(500, { error: 'AUDIT_FAILED' });
        return;
      }
      send(status, body);
    };

    if (!id) {
      await finish(400, { error: 'INVALID_ID' }, 'invalid_id');
      return;
    }
    try {
      // 1. 사본: 로그인 사용자의 것만 찾습니다. 남의 사본과 없는 사본은 같은 404입니다.
      const snapshot = checked(await supabase.from(SNAPSHOT)
        .select('id, owner_id, title, content, created_at, content_sha256')
        .eq('id', id).eq('owner_id', login.userId).maybeSingle());
      if (!snapshot) {
        await finish(404, { error: 'NOTE_NOT_FOUND' }, 'not_found');
        return;
      }
      // 2. 사본 해시를 다시 계산해 대조합니다. 다르면 복원하지 않습니다.
      const snapshotHash = noteSha256(snapshot.title, snapshot.content);
      if (snapshotHash !== snapshot.content_sha256) {
        await finish(409, { error: 'SNAPSHOT_HASH_MISMATCH' }, 'snapshot_hash_mismatch', snapshot.content_sha256, false);
        return;
      }
      // 3. 지금 행: 있으면 주인이 로그인 사용자여야 합니다. 다르면 덮어쓰지 않고 같은 404입니다.
      const current = checked(await supabase.from(NOTES)
        .select('id, owner_id, title, content').eq('id', id).maybeSingle());
      if (current && current.owner_id !== login.userId) {
        await finish(404, { error: 'NOTE_NOT_FOUND' }, 'owner_mismatch');
        return;
      }
      // 4. 한 건만 복원합니다.
      let outcome;
      if (!current) {
        const { error } = await supabase.from(NOTES).insert({
          id, owner_id: login.userId, title: snapshot.title, content: snapshot.content,
          created_at: snapshot.created_at,
        });
        if (error?.code === '23505') {
          await finish(409, { error: 'RESTORE_CONFLICT' }, 'conflict', snapshotHash, false);
          return;
        }
        if (error) throw error;
        outcome = 'restored_deleted';
      } else if (noteSha256(current.title, current.content) !== snapshotHash) {
        checked(await supabase.from(NOTES).update({ title: snapshot.title, content: snapshot.content })
          .eq('id', id).eq('owner_id', login.userId).select('id').maybeSingle());
        outcome = 'restored_modified';
      } else {
        outcome = 'already_matching';
      }
      // 5. 다시 읽어 id·owner_id·해시를 사본과 대조합니다.
      const after = checked(await supabase.from(NOTES)
        .select('id, owner_id, title, content').eq('id', id).eq('owner_id', login.userId).maybeSingle());
      const matched = Boolean(after) && after.id === snapshot.id && after.owner_id === snapshot.owner_id
        && noteSha256(after.title, after.content) === snapshotHash;
      if (!matched) {
        await finish(500, { id, sha256: snapshotHash, matched: false }, 'verify_failed', snapshotHash, false);
        return;
      }
      await finish(200, { id, sha256: snapshotHash, matched: true }, outcome, snapshotHash, true);
    } catch (error) {
      console.error('restores: 복구하지 못했습니다.', error?.code || 'unknown');
      await finish(502, { error: 'RESTORE_UNAVAILABLE' }, 'error');
    }
  };
}
