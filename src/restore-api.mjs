// 10단계 복구 서버 함수 POST /api/restores/:id 입니다. 학생 설계(계약에 없음).
// 판정기(src/decider.mjs)는 바꾸지 않았습니다. 복구 경로의 보안은 이 함수가 맡습니다.
// - 로그인 필수: 사용자는 src/verify-login.mjs가 검사한 토큰의 userId로만 정합니다.
//   URL·본문·쿼리의 owner_id는 읽지 않습니다. 본문과 쿼리에서는 dryRun만 읽습니다.
// - 사본(vault_notes_snapshot)의 owner_id가 로그인 사용자이고, 지금 메모 행이 있으면 그 owner_id도
//   로그인 사용자여야 합니다. 아니면 남의 메모와 없는 메모를 같은 404로 답합니다.
// - 복원 전에 사본 해시를 다시 계산해 대조하고, 다르면 복원하지 않고 409 BACKUP_VERIFICATION_FAILED로 멈춥니다.
//   자기 메모가 있는데 사본이 없으면 409 BACKUP_MISSING으로 멈춥니다.
// - 복원 직전에 사본을 한 번 더 읽어 검증한 그 행(version=snapshot_at, 해시)이 그대로인지 확인하고, 다르면 멈춥니다.
// - 지정한 한 건만: 변조됐으면 사본 내용으로 덮어쓰고, 삭제됐으면 같은 id·owner_id로 다시 넣습니다.
//   다른 메모, 사본, 감사 기록은 바꾸지 않습니다. 감사 기록은 insert만 하고 update·delete는 하지 않습니다.
// - 감사 먼저: 복원 전에 감사 기록에 시작 줄(restore_started)을 쓰고, 쓰지 못하면 메모·사본을 읽지도 쓰지도 않고
//   503 AUDIT_UNAVAILABLE(restored false)로 멈춥니다. 끝나면 결과 줄을 한 줄 더 씁니다. 응답에 audit: { startId, resultId }.
// - 미리보기: 본문 dryRun이 true 또는 "true"이거나 쿼리 ?dryRun=true면 사본을 읽어 검증하고 plan(version, changes, beforeSha256, backupSha256)만 답합니다.
//   메모는 쓰지 않고, 감사 기록에는 preview 줄 하나만 남깁니다. 응답에 audit: { previewId }.
// - 복원 뒤 행을 다시 읽어 id·owner_id·해시가 사본과 같은지 확인합니다.
// - 응답에는 id, restored, matched, sha256, backup(검증 표시·version·해시·다시 읽은 시각), before, after, changes(칸 이름)만 넣고
//   메모 내용은 넣지 않습니다. 감사 기록에도 내용과 토큰은 넣지 않습니다.
import { createClient } from '@supabase/supabase-js';
import config from '../aleph.config.json' with { type: 'json' };
import { noteSha256 } from './content-hash.mjs';
import { createLoginVerifier } from './verify-login.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NOTES = 'vault_notes';
const SNAPSHOT = 'vault_notes_snapshot';
const AUDIT = 'vault_restore_audit';

// 미리보기는 본문 dryRun이 true 또는 "true"이거나 쿼리 dryRun이 "true"일 때뿐입니다.
// 그 밖의 경우(본문 없음, {}, 다른 칸, 깨진 JSON, false 등)는 모두 복원입니다. 본문 모양 때문에 400으로 막지 않습니다.
const isTrue = value => value === true || value === 'true';
function dryRunOf(body, query) {
  if ([].concat(query?.dryRun ?? []).some(isTrue)) return true;
  let value = body;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return false; }
  }
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && isTrue(value.dryRun);
}

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

    // 배포 환경에서 깨진 JSON 본문은 request.body를 읽을 때 오류가 나므로, 그때도 복원으로 봅니다.
    let body;
    try { body = request.body; } catch { body = undefined; }
    const dryRun = dryRunOf(body, request.query);

    // 감사 기록은 insert만 합니다. 새 줄의 audit_id를 돌려받고, 쓰지 못하면 null입니다.
    const writeAudit = async (outcome, sha256 = null, matched = null) => {
      const { data, error } = await supabase.from(AUDIT).insert({
        actor_id: login.userId, note_id: id, outcome, content_sha256: sha256, matched,
      }).select('audit_id').single();
      if (error || data?.audit_id === undefined || data?.audit_id === null) {
        console.error('restores: 감사 기록을 남기지 못했습니다.', error?.code || 'unknown');
        return null;
      }
      return data.audit_id;
    };
    const auditUnavailable = () => send(503, { error: 'AUDIT_UNAVAILABLE', restored: false });

    // 시작 줄 전에 멈추는 요청(id 형식 오류)은 한 줄만 남깁니다.
    if (!id) {
      const auditId = await writeAudit('invalid_id');
      if (auditId === null) auditUnavailable();
      else send(400, { error: 'INVALID_ID', restored: false, audit: { startId: auditId, resultId: null } });
      return;
    }

    // 감사 먼저: 시작(미리보기면 preview) 줄을 쓰지 못하면 메모·사본을 읽지도 쓰지도 않고 멈춥니다.
    const startId = await writeAudit(dryRun ? 'preview' : 'restore_started');
    if (startId === null) {
      auditUnavailable();
      return;
    }

    // 미리보기는 줄을 더 쓰지 않습니다. 복원은 결과 줄을 한 줄 더 쓰고 두 id를 응답에 넣습니다.
    const finish = async (status, body, outcome, sha256 = null, matched = null) => {
      if (dryRun) {
        send(status, { ...body, audit: { previewId: startId } });
        return;
      }
      const resultId = await writeAudit(outcome, sha256, matched);
      if (resultId === null) {
        send(500, { error: 'AUDIT_FAILED', restored: body.restored === true, audit: { startId, resultId: null } });
        return;
      }
      send(status, { ...body, audit: { startId, resultId } });
    };
    try {
      // 1. 사본: 로그인 사용자의 것만 찾습니다.
      const readBackup = async () => checked(await supabase.from(SNAPSHOT)
        .select('id, owner_id, title, content, created_at, content_sha256, snapshot_at')
        .eq('id', id).eq('owner_id', login.userId).maybeSingle());
      const readMine = async () => checked(await supabase.from(NOTES)
        .select('id, owner_id, title, content').eq('id', id).eq('owner_id', login.userId).maybeSingle());
      const backup = await readBackup();
      if (!backup) {
        // 자기 메모가 지금 있는데 사본이 없으면 복원하지 않고 멈춥니다.
        // 남의 메모와, 사본도 행도 없는 메모는 같은 404로 답해 있는지 없는지 드러내지 않습니다.
        if (await readMine()) {
          await finish(409, { error: 'BACKUP_MISSING', restored: false }, 'backup_missing', null, false);
        } else {
          await finish(404, { error: 'NOTE_NOT_FOUND' }, 'not_found');
        }
        return;
      }
      const version = backup.snapshot_at ?? null;
      // 2. 사본 해시를 다시 계산해 대조합니다. 다르면 복원하지 않고 멈춥니다.
      const recomputed = noteSha256(backup.title, backup.content);
      const stopUnverified = outcome => finish(409, {
        error: 'BACKUP_VERIFICATION_FAILED', restored: false, backup: { verified: false, version },
      }, outcome, backup.content_sha256, false);
      if (recomputed !== backup.content_sha256) {
        await stopUnverified('backup_verification_failed');
        return;
      }
      // 3. 지금 행: 있으면 주인이 로그인 사용자여야 합니다. 다르면 덮어쓰지 않고 같은 404입니다.
      const current = checked(await supabase.from(NOTES)
        .select('id, owner_id, title, content').eq('id', id).maybeSingle());
      if (current && current.owner_id !== login.userId) {
        await finish(404, { error: 'NOTE_NOT_FOUND' }, 'owner_mismatch');
        return;
      }
      const beforeSha = current ? noteSha256(current.title, current.content) : null;
      // 4. 복원 직전에 사본을 한 번 더 읽어, 검증한 그 행(version·해시)이 그대로인지 확인합니다.
      //    다르면 멈춥니다. 복원에는 다시 읽어 검증한 이 행만 씁니다.
      const reread = await readBackup();
      const rereadAt = new Date().toISOString();
      if (!reread || (reread.snapshot_at ?? null) !== version || reread.content_sha256 !== backup.content_sha256
          || noteSha256(reread.title, reread.content) !== backup.content_sha256) {
        await stopUnverified('backup_changed');
        return;
      }
      // 바뀔 항목: 삭제됐으면 row_restored, 아니면 사본과 다른 칸 이름. 내용은 남기지 않습니다.
      const changes = current ? ['title', 'content'].filter(key => current[key] !== reread[key]) : ['row_restored'];
      const backupInfo = { verified: true, version, sha256: backup.content_sha256, recomputedSha256: recomputed, rereadAt };
      if (dryRun) {
        await finish(200, {
          id, dryRun: true, restored: false,
          plan: { version, changes, beforeSha256: beforeSha, backupSha256: recomputed },
          backup: backupInfo,
        });
        return;
      }
      // 5. 한 건만 복원합니다.
      let outcome;
      if (!current) {
        const { error } = await supabase.from(NOTES).insert({
          id, owner_id: login.userId, title: reread.title, content: reread.content,
          created_at: reread.created_at,
        });
        if (error?.code === '23505') {
          await finish(409, { error: 'RESTORE_CONFLICT', restored: false }, 'conflict', recomputed, false);
          return;
        }
        if (error) throw error;
        outcome = 'restored_deleted';
      } else if (changes.length) {
        checked(await supabase.from(NOTES).update({ title: reread.title, content: reread.content })
          .eq('id', id).eq('owner_id', login.userId).select('id').maybeSingle());
        outcome = 'restored_modified';
      } else {
        outcome = 'already_matching';
      }
      const restored = changes.length > 0;
      // 6. 다시 읽어 id·owner_id·해시를 사본과 대조합니다.
      const after = await readMine();
      const afterSha = after ? noteSha256(after.title, after.content) : null;
      const matched = Boolean(after) && after.id === reread.id && after.owner_id === reread.owner_id
        && afterSha === recomputed;
      const body = {
        id, restored, matched, sha256: recomputed,
        backup: backupInfo,
        before: { exists: Boolean(current), sha256: beforeSha },
        after: { sha256: afterSha },
        changes,
      };
      if (!matched) {
        await finish(500, body, 'verify_failed', recomputed, false);
        return;
      }
      await finish(200, body, outcome, recomputed, true);
    } catch (error) {
      console.error('restores: 복구하지 못했습니다.', error?.code || 'unknown');
      await finish(502, { error: 'RESTORE_UNAVAILABLE' }, 'error');
    }
  };
}
