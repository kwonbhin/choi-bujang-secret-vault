// 10단계 복구 경로 POST /api/notes/:id/restore 의 로컬 시험입니다. 학생 설계(계약에 없음).
// 가짜 로그인 검사기와 .eq() 조건을 실제로 거르는 가짜 저장소를 씁니다. 배포된 API나 심판 판정이 아닙니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteSha256 } from '../src/content-hash.mjs';
import { createRestoreHandler } from '../src/restore-api.mjs';
import { createSealer, sealNewNote } from '../src/backup-seal.mjs';
import { createNotesHandler } from '../src/notes-api.mjs';

// 시험 전용 가짜 키입니다. 실제 서버 키가 아닙니다.
const SEALER = createSealer('test-only-fake-server-key');

const A = 'a0000000-0000-4000-8000-0000000000aa';
const B = 'b0000000-0000-4000-8000-0000000000bb';
const NOTE_A = '11111111-1111-4111-8111-111111111111';
const NOTE_B = '22222222-2222-4222-8222-222222222222';
const NOTE_B2 = '33333333-3333-4333-8333-333333333333';
const MISSING = '44444444-4444-4444-8444-444444444444';

function seed() {
  const note = (id, owner, title, content) => ({ id, owner_id: owner, title, content, created_at: '2026-10-01T00:00:00Z' });
  const notes = [note(NOTE_A, A, 'A 메모', '가상 본문 A'), note(NOTE_B, B, 'B 메모', '가상 본문 B'),
    note(NOTE_B2, B, 'B 다른 메모', '가상 본문 B2')];
  const vault_notes_snapshot = notes.map(n => ({ ...n, content_sha256: noteSha256(n.title, n.content), snapshot_at: n.created_at }));
  // 봉인: 메모가 생길 때 남긴 것처럼 사본마다 하나씩 둡니다.
  const vault_notes_backup_seal = vault_notes_snapshot.map(row => ({
    note_id: row.id, owner_id: row.owner_id, content_sha256: row.content_sha256,
    seal: SEALER.seal(row.id, row.owner_id, row.content_sha256), sealed_at: row.created_at,
  }));
  return { vault_notes: notes.map(n => ({ ...n })), vault_notes_snapshot, vault_notes_backup_seal, vault_restore_audit: [] };
}

// 응답 어디에도 메모 제목·본문이 없어야 합니다.
function assertNoContent(json) {
  assert.doesNotMatch(JSON.stringify(json), /가상 본문|변조된 본문|B 메모|사본이 바뀜/u);
}

// supabase-js의 from().select().eq().maybeSingle(), insert(), update().eq().select().maybeSingle() 흉내
function fakeSupabase(tables) {
  const reads = {};
  return {
    from(name) {
      const rows = tables[name];
      const filters = [];
      let patch = null;
      const match = row => filters.every(([key, value]) => row[key] === value);
      const builder = {
        select() { return builder; },
        eq(key, value) { filters.push([key, value]); return builder; },
        update(values) { patch = values; return builder; },
        async maybeSingle() {
          reads[name] = (reads[name] ?? 0) + 1;
          tables.onRead?.(name, reads[name], tables);
          const found = rows.filter(match);
          if (found.length > 1) return { data: null, error: { code: 'PGRST116' } };
          if (found[0] && patch) Object.assign(found[0], patch);
          return { data: found[0] ? { ...found[0] } : null, error: null };
        },
        // 감사 기록은 insert().select('audit_id').single()로 새 줄 id를 돌려받습니다.
        // tables.failAudit(row)가 true면 그 감사 줄 쓰기가 실패합니다.
        insert(row) {
          if (name === 'vault_restore_audit') {
            const write = () => {
              if (tables.failAudit?.(row)) return { data: null, error: { code: '42501' } };
              const audit_id = rows.length + 1;
              rows.push({ audit_id, ...row });
              return { data: { audit_id }, error: null };
            };
            return { select: () => ({ single: async () => write() }) };
          }
          const keyOf = item => item.id ?? item.note_id;
          if (tables.failInsert?.(name, row)) return Promise.resolve({ error: { code: '42501' } });
          if (rows.some(existing => keyOf(existing) === keyOf(row))) {
            return Promise.resolve({ error: { code: '23505' } });
          }
          rows.push({ ...row });
          tables.afterInsert?.(name, row, tables);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

// bodyThrows: 배포 환경에서 깨진 JSON 본문을 읽을 때처럼 request.body 읽기가 오류를 냅니다.
// 11단계 기기 검사는 test/device.test.mjs에서 따로 시험합니다. 여기서는 승인된 기기로 봅니다.
const APPROVED_DEVICE = async () => ({ ok: true });

async function call(tables, { user = B, method = 'POST', id, body, query = {}, auth = true, bodyThrows = false } = {}) {
  const handler = createRestoreHandler(() => ({
    verifyLogin: async header => (header === 'Bearer good' ? { userId: user } : null),
    supabase: fakeSupabase(tables),
    sealer: SEALER,
    checkDevice: APPROVED_DEVICE,
  }));
  let status;
  let json;
  const response = { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } };
  const request = { method, headers: auth ? { authorization: 'Bearer good' } : {}, query: { ...query, id }, body };
  if (bodyThrows) Object.defineProperty(request, 'body', { get() { throw new SyntaxError('Invalid JSON'); } });
  await handler(request, response);
  return { status, json };
}

const snapshotOf = (tables, id) => tables.vault_notes_snapshot.find(row => row.id === id);
const sealOf = (tables, id) => tables.vault_notes_backup_seal.find(row => row.note_id === id);
const noteOf = (tables, id) => tables.vault_notes.find(row => row.id === id);
const withoutAudit = ({ audit, ...rest }) => rest;

test('B 메모 변조 → 복구 성공, 해시 일치, 응답에 내용 없음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const { status, json } = await call(tables, { id: NOTE_B });
  const snapshot = snapshotOf(tables, NOTE_B);
  const tamperedSha = noteSha256('B 메모', '변조된 본문');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json).sort(), ['after', 'audit', 'backup', 'before', 'changes', 'id', 'matched', 'restored', 'sha256']);
  assert.equal(json.restored, true);
  assert.equal(json.matched, true);
  assert.equal(json.sha256, snapshot.content_sha256);
  assert.deepEqual(Object.keys(json.backup).sort(), ['recomputedSha256', 'rereadAt', 'sealed', 'sha256', 'verified', 'version']);
  assert.equal(json.backup.sealed, true);
  assert.doesNotMatch(JSON.stringify(json), new RegExp(sealOf(tables, NOTE_B).seal));
  assert.equal(json.backup.verified, true);
  assert.equal(json.backup.version, snapshot.snapshot_at);
  assert.equal(json.backup.sha256, snapshot.content_sha256);
  assert.equal(json.backup.recomputedSha256, snapshot.content_sha256);
  assert.ok(!Number.isNaN(Date.parse(json.backup.rereadAt)));
  assert.deepEqual(json.before, { exists: true, sha256: tamperedSha });
  assert.deepEqual(json.after, { sha256: snapshot.content_sha256 });
  assert.deepEqual(json.changes, ['content']);
  assertNoContent(json);
  assert.equal(noteOf(tables, NOTE_B).content, '가상 본문 B');
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'restored_modified');
});

test('B 메모 삭제 → 같은 id·owner_id로 복구 성공', async () => {
  const tables = seed();
  tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B);
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 200);
  assert.equal(json.matched, true);
  assert.equal(json.restored, true);
  assert.equal(json.backup.verified, true);
  assert.deepEqual(json.before, { exists: false, sha256: null });
  assert.deepEqual(json.changes, ['row_restored']);
  assertNoContent(json);
  const restored = noteOf(tables, NOTE_B);
  assert.equal(restored.owner_id, B);
  assert.equal(noteSha256(restored.title, restored.content), json.sha256);
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'restored_deleted');
});

test('B가 A 메모 복구 시도 → 404, A 메모는 그대로', async () => {
  const tables = seed();
  noteOf(tables, NOTE_A).content = 'A가 고친 본문';
  const { status, json } = await call(tables, { id: NOTE_A, body: { owner_id: A }, query: { owner_id: A } });
  assert.equal(status, 404);
  assert.deepEqual(withoutAudit(json), { error: 'NOTE_NOT_FOUND' });
  assert.equal(noteOf(tables, NOTE_A).content, 'A가 고친 본문');
});

test('없는 id → 404 (남의 메모와 같은 응답)', async () => {
  const tables = seed();
  const missing = await call(tables, { id: MISSING });
  const others = await call(seed(), { id: NOTE_A });
  assert.equal(missing.status, 404);
  // audit id 숫자만 다르고 나머지는 같아야 합니다.
  assert.deepEqual(withoutAudit(missing.json), withoutAudit(others.json));
  assert.deepEqual(Object.keys(missing.json.audit), Object.keys(others.json.audit));
});

test('로그인 없음 → 401, 감사 기록 없음', async () => {
  const tables = seed();
  const { status, json } = await call(tables, { id: NOTE_B, auth: false });
  assert.equal(status, 401);
  assert.equal(json.error, 'LOGIN_REQUIRED');
  assert.equal(tables.vault_restore_audit.length, 0);
});

test('사본 해시 대조 실패 → 409 BACKUP_VERIFICATION_FAILED, 복원 안 됨, 감사 기록 남음', async () => {
  const tables = seed();
  snapshotOf(tables, NOTE_B).content = '사본이 바뀜';
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 409);
  assert.deepEqual(withoutAudit(json), { error: 'BACKUP_VERIFICATION_FAILED', restored: false,
    backup: { verified: false, version: snapshotOf(tables, NOTE_B).snapshot_at } });
  assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'backup_verification_failed');
  assert.equal(tables.vault_restore_audit.at(-1).matched, false);
});

test('자기 메모가 있는데 사본이 없음 → 409 BACKUP_MISSING, 복원 안 됨, 감사 기록 남음', async () => {
  const tables = seed();
  tables.vault_notes_snapshot = tables.vault_notes_snapshot.filter(row => row.id !== NOTE_B);
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 409);
  assert.deepEqual(withoutAudit(json), { error: 'BACKUP_MISSING', restored: false });
  assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'backup_missing');
  // 남의 메모(사본 없음)는 BACKUP_MISSING이 아니라 같은 404입니다.
  tables.vault_notes_snapshot = tables.vault_notes_snapshot.filter(row => row.id !== NOTE_A);
  const other = await call(tables, { id: NOTE_A });
  assert.equal(other.status, 404);
  assert.deepEqual(withoutAudit(other.json), { error: 'NOTE_NOT_FOUND' });
});

test('복원 직전에 다시 읽은 사본이 검증한 것과 다름 → 409, 복원 안 됨', async () => {
  for (const change of [
    row => { row.snapshot_at = '2026-10-02T00:00:00Z'; },
    row => { row.content = '사본이 바뀜'; row.content_sha256 = noteSha256(row.title, row.content); },
    row => { row.content = '사본이 바뀜'; },
  ]) {
    const tables = seed();
    noteOf(tables, NOTE_B).content = '변조된 본문';
    const version = snapshotOf(tables, NOTE_B).snapshot_at;
    tables.onRead = (name, n, t) => { if (name === 'vault_notes_snapshot' && n === 2) change(snapshotOf(t, NOTE_B)); };
    const { status, json } = await call(tables, { id: NOTE_B });
    assert.equal(status, 409);
    assert.deepEqual(withoutAudit(json), { error: 'BACKUP_VERIFICATION_FAILED', restored: false, backup: { verified: false, version } });
    assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
    assert.equal(tables.vault_restore_audit.at(-1).outcome, 'backup_changed');
  }
});

test('복원 전에 사본을 두 번 읽음(검증 1번, 복원 직전 1번)', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const snapshotReads = [];
  tables.onRead = (name, n) => { if (name === 'vault_notes_snapshot') snapshotReads.push(n); };
  assert.equal((await call(tables, { id: NOTE_B })).status, 200);
  assert.deepEqual(snapshotReads, [1, 2]);
});

test('사본 주인은 B지만 지금 행 주인이 다르면 → 404, 덮어쓰지 않음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).owner_id = A;
  const { status } = await call(tables, { id: NOTE_B });
  assert.equal(status, 404);
  assert.equal(noteOf(tables, NOTE_B).owner_id, A);
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'owner_mismatch');
});

test('다른 메모·사본은 그대로, 감사 기록은 시작·결과 줄만 늘고 내용·토큰이 없음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const before = JSON.stringify({ a: noteOf(tables, NOTE_A), b2: noteOf(tables, NOTE_B2), snaps: tables.vault_notes_snapshot });
  for (const id of [NOTE_B, NOTE_A, MISSING, 'not-a-uuid']) await call(tables, { id });
  await call(tables, { id: NOTE_B, auth: false });
  const after = JSON.stringify({ a: noteOf(tables, NOTE_A), b2: noteOf(tables, NOTE_B2), snaps: tables.vault_notes_snapshot });
  assert.equal(after, before);
  assert.equal(tables.vault_notes.length, 3);
  assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome),
    ['restore_started', 'restored_modified', 'restore_started', 'not_found', 'restore_started', 'not_found', 'invalid_id']);
  for (const row of tables.vault_restore_audit) {
    assert.deepEqual(Object.keys(row).sort(), ['actor_id', 'audit_id', 'content_sha256', 'matched', 'note_id', 'outcome']);
    assert.doesNotMatch(JSON.stringify(row), /가상 본문|변조|Bearer|good/u);
  }
});

test('이미 사본과 같으면 쓰지 않고 일치로 답함, POST가 아니면 405', async () => {
  const tables = seed();
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 200);
  assert.equal(json.matched, true);
  assert.equal(json.restored, false);
  assert.deepEqual(json.changes, []);
  assert.equal(json.backup.verified, true);
  assert.equal(json.before.sha256, json.after.sha256);
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'already_matching');
  assert.equal((await call(tables, { id: NOTE_B, method: 'GET' })).status, 405);
});

test('감사 시작 줄 쓰기 실패 → 503 AUDIT_UNAVAILABLE, 메모·사본을 읽지도 쓰지도 않음', async () => {
  for (const setup of [
    tables => { noteOf(tables, NOTE_B).content = '변조된 본문'; },
    tables => { tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B); },
  ]) {
    const tables = seed();
    setup(tables);
    const before = JSON.stringify({ notes: tables.vault_notes, snaps: tables.vault_notes_snapshot });
    const reads = [];
    tables.onRead = name => reads.push(name);
    tables.failAudit = row => row.outcome === 'restore_started';
    const { status, json } = await call(tables, { id: NOTE_B });
    assert.equal(status, 503);
    assert.deepEqual(json, { error: 'AUDIT_UNAVAILABLE', restored: false });
    assert.deepEqual(reads, []);
    assert.equal(JSON.stringify({ notes: tables.vault_notes, snaps: tables.vault_notes_snapshot }), before);
    assert.equal(tables.vault_restore_audit.length, 0);
  }
});

test('복원 응답에 audit: { startId, resultId }, 시작 줄이 결과 줄보다 먼저', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 200);
  const [start, result] = tables.vault_restore_audit;
  assert.deepEqual(json.audit, { startId: start.audit_id, resultId: result.audit_id });
  assert.ok(json.audit.startId < json.audit.resultId);
  assert.equal(start.outcome, 'restore_started');
  assert.equal(result.outcome, 'restored_modified');
  assert.equal(tables.vault_restore_audit.length, 2);
});

test('결과 줄 쓰기 실패 → 500 AUDIT_FAILED, 시작 줄은 남고 지우지 않음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  tables.failAudit = row => row.outcome !== 'restore_started';
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 500);
  assert.deepEqual(json, { error: 'AUDIT_FAILED', restored: true, audit: { startId: 1, resultId: null } });
  assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome), ['restore_started']);
});

test('dryRun: 변조·삭제 모두 plan만 답하고 메모·사본은 그대로, 감사 기록은 preview 한 줄', async () => {
  for (const [setup, expectChanges, expectBefore] of [
    [tables => { noteOf(tables, NOTE_B).content = '변조된 본문'; }, ['content'], noteSha256('B 메모', '변조된 본문')],
    [tables => { tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B); }, ['row_restored'], null],
    [() => {}, [], noteSha256('B 메모', '가상 본문 B')],
  ]) {
    const tables = seed();
    setup(tables);
    const before = JSON.stringify({ notes: tables.vault_notes, snaps: tables.vault_notes_snapshot });
    const snapshot = snapshotOf(tables, NOTE_B);
    const { status, json } = await call(tables, { id: NOTE_B, body: { dryRun: true } });
    assert.equal(status, 200);
    assert.equal(json.dryRun, true);
    assert.equal(json.restored, false);
    assert.deepEqual(json.plan, { version: snapshot.snapshot_at, changes: expectChanges,
      beforeSha256: expectBefore, backupSha256: snapshot.content_sha256 });
    assert.equal(json.backup.verified, true);
    assertNoContent(json);
    assert.equal(JSON.stringify({ notes: tables.vault_notes, snaps: tables.vault_notes_snapshot }), before);
    assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome), ['preview']);
    assert.deepEqual(json.audit, { previewId: tables.vault_restore_audit[0].audit_id });
  }
});

test('dryRun: 문자열 본문도 읽고, 사본 검증 실패면 409로 멈춤, preview 줄을 못 쓰면 503', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const preview = await call(tables, { id: NOTE_B, body: '{"dryRun":true}' });
  assert.equal(preview.status, 200);
  assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');

  const broken = seed();
  snapshotOf(broken, NOTE_B).content = '사본이 바뀜';
  const failed = await call(broken, { id: NOTE_B, body: { dryRun: true } });
  assert.equal(failed.status, 409);
  assert.equal(failed.json.restored, false);
  assert.deepEqual(broken.vault_restore_audit.map(row => row.outcome), ['preview']);

  const noAudit = seed();
  noAudit.failAudit = () => true;
  const blocked = await call(noAudit, { id: NOTE_B, body: { dryRun: true } });
  assert.equal(blocked.status, 503);
  assert.deepEqual(blocked.json, { error: 'AUDIT_UNAVAILABLE', restored: false });
});

test('미리보기 조건: 본문 dryRun·preview true·"true", 문자열 본문, 쿼리 ?dryRun=true → 쓰지 않고 plan만', async () => {
  for (const options of [
    { body: { dryRun: true } }, { body: { dryRun: 'true' } }, { body: '{"dryRun":"true"}' },
    { body: { preview: true } }, { body: { preview: 'true' } }, { body: '{"preview":true}' }, { body: { dryRun: false, preview: true } },
    { query: { dryRun: 'true' } }, { query: { dryRun: ['true'] } }, { query: { dryRun: 'true' }, body: { dryRun: false } },
  ]) {
    const tables = seed();
    noteOf(tables, NOTE_B).content = '변조된 본문';
    const { status, json } = await call(tables, { id: NOTE_B, ...options });
    assert.equal(status, 200, JSON.stringify(options));
    assert.equal(json.dryRun, true);
    assert.equal(json.restored, false);
    assert.deepEqual(json.plan.changes, ['content']);
    assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
    assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome), ['preview']);
  }
});

test('그 밖의 본문은 400으로 막지 않고 모두 복원: 없음, {}, 다른 칸, 깨진 JSON, false, 배열, 숫자', async () => {
  for (const options of [
    {}, { body: {} }, { body: '' }, { body: null }, { body: { other: 1 } }, { body: { dryRun: false } },
    { body: { dryRun: 'false' } }, { body: { dryRun: 'TRUE' } }, { body: { dryRun: 1 } }, { body: 'not json' },
    { body: { preview: false } }, { body: { preview: 'yes' } },
    { body: '{"dryRun":' }, { body: [1] }, { body: 7 }, { bodyThrows: true },
    { query: { dryRun: 'false' } }, { query: { dryRun: '1' } },
  ]) {
    const tables = seed();
    noteOf(tables, NOTE_B).content = '변조된 본문';
    const { status, json } = await call(tables, { id: NOTE_B, ...options });
    assert.equal(status, 200, JSON.stringify(options));
    assert.equal(json.restored, true);
    assert.equal(json.dryRun, undefined);
    assert.equal(noteOf(tables, NOTE_B).content, '가상 본문 B');
    assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome), ['restore_started', 'restored_modified']);
  }
});

test('감사 기록은 insert만: 기존 줄은 바뀌거나 지워지지 않음', async () => {
  const tables = seed();
  const old = { audit_id: 1, actor_id: A, note_id: NOTE_A, outcome: 'restored_modified', content_sha256: null, matched: true };
  tables.vault_restore_audit.push({ ...old });
  noteOf(tables, NOTE_B).content = '변조된 본문';
  await call(tables, { id: NOTE_B, body: { dryRun: true } });
  await call(tables, { id: NOTE_B });
  tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B);
  await call(tables, { id: NOTE_B });
  assert.deepEqual(tables.vault_restore_audit[0], old);
  assert.equal(tables.vault_restore_audit.length, 6);
});

test('봉인 없음 → 409 BACKUP_VERIFICATION_FAILED(sealed false), 아무것도 안 씀, 감사 stopped_seal_missing', async () => {
  for (const setup of [
    tables => { noteOf(tables, NOTE_B).content = '변조된 본문'; },
    tables => { tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B); },
  ]) {
    const tables = seed();
    setup(tables);
    tables.vault_notes_backup_seal = tables.vault_notes_backup_seal.filter(row => row.note_id !== NOTE_B);
    const before = JSON.stringify(tables.vault_notes);
    const { status, json } = await call(tables, { id: NOTE_B });
    assert.equal(status, 409);
    assert.deepEqual(withoutAudit(json), { error: 'BACKUP_VERIFICATION_FAILED', restored: false,
      backup: { verified: false, sealed: false, version: snapshotOf(tables, NOTE_B).snapshot_at } });
    assert.equal(JSON.stringify(tables.vault_notes), before);
    assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome), ['restore_started', 'stopped_seal_missing']);
  }
});

test('봉인 값이 다름 → 409(sealed false), 감사 stopped_seal_mismatch', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  sealOf(tables, NOTE_B).seal = SEALER.seal(NOTE_B, B, noteSha256('다른', '내용'));
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 409);
  assert.equal(json.backup.sealed, false);
  assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'stopped_seal_mismatch');
  // 봉인 행의 주인 칸만 바꿔도 같은 결과입니다.
  const other = seed();
  sealOf(other, NOTE_B).owner_id = A;
  assert.equal((await call(other, { id: NOTE_B })).status, 409);
  assert.equal(other.vault_restore_audit.at(-1).outcome, 'stopped_seal_mismatch');
});

test('사본만 바뀌고 해시도 맞춘 경우 → 해시 검사는 통과하지만 봉인으로 잡힘(409), 메모는 그대로', async () => {
  for (const dryRun of [false, true]) {
    const tables = seed();
    noteOf(tables, NOTE_B).content = '변조된 본문';
    const snapshot = snapshotOf(tables, NOTE_B);
    snapshot.content = '사본이 바뀜';
    snapshot.content_sha256 = noteSha256(snapshot.title, snapshot.content);
    const { status, json } = await call(tables, { id: NOTE_B, body: dryRun ? { dryRun: true } : undefined });
    assert.equal(status, 409);
    assert.equal(json.error, 'BACKUP_VERIFICATION_FAILED');
    assert.equal(json.backup.sealed, false);
    assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
    assert.equal(tables.vault_restore_audit.at(-1).outcome, dryRun ? 'preview' : 'stopped_seal_mismatch');
  }
});

test('복원 직전에 봉인이 사라지거나 바뀌면 → 409, 복원 안 됨', async () => {
  for (const [change, outcome] of [
    [t => { t.vault_notes_backup_seal = t.vault_notes_backup_seal.filter(row => row.note_id !== NOTE_B); }, 'stopped_seal_missing'],
    [t => { sealOf(t, NOTE_B).seal = '0'.repeat(64); }, 'stopped_seal_mismatch'],
  ]) {
    const tables = seed();
    noteOf(tables, NOTE_B).content = '변조된 본문';
    let reads = 0;
    tables.onRead = (name, n, t) => { if (name === 'vault_notes_snapshot' && n === 2) { reads = n; change(t); } };
    const { status, json } = await call(tables, { id: NOTE_B });
    assert.equal(reads, 2);
    assert.equal(status, 409);
    assert.equal(json.backup.sealed, false);
    assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
    assert.equal(tables.vault_restore_audit.at(-1).outcome, outcome);
  }
});

test('정상 봉인 → 변조·삭제 복구 성공(sealed true), 미리보기도 sealed true', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const preview = await call(tables, { id: NOTE_B, body: { preview: true } });
  assert.equal(preview.status, 200);
  assert.equal(preview.json.backup.sealed, true);
  assert.equal((await call(tables, { id: NOTE_B })).json.backup.sealed, true);
  tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B);
  const restored = await call(tables, { id: NOTE_B });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.json.changes, ['row_restored']);
  assert.equal(restored.json.backup.sealed, true);
});

test('봉인 만들기: 사본을 다시 읽어 한 번만 넣음, 이미 있으면 그대로, 사본 없으면 오류 코드', async () => {
  const tables = seed();
  const NEW = '55555555-5555-4555-8555-555555555555';
  tables.vault_notes_snapshot.push({ id: NEW, owner_id: B, title: 't', content: '새 가상 본문',
    created_at: '2026-10-14T00:00:00Z', content_sha256: noteSha256('t', '새 가상 본문'), snapshot_at: '2026-10-14T00:00:00Z' });
  const supabase = fakeSupabase(tables);
  assert.equal(await sealNewNote({ supabase, sealer: SEALER, noteId: NEW }), 'sealed');
  const first = { ...sealOf(tables, NEW) };
  assert.equal(SEALER.verify(first, { noteId: NEW, ownerId: B, contentSha256: noteSha256('t', '새 가상 본문') }), true);
  assert.equal(await sealNewNote({ supabase, sealer: SEALER, noteId: NEW }), 'already_sealed');
  assert.deepEqual(sealOf(tables, NEW), first);
  assert.equal(tables.vault_notes_backup_seal.filter(row => row.note_id === NEW).length, 1);
  await assert.rejects(sealNewNote({ supabase, sealer: SEALER, noteId: MISSING }), { code: 'seal_snapshot_missing' });
  // 다른 키로 만든 봉인은 맞지 않습니다.
  assert.equal(createSealer('another-fake-key').verify(first, { noteId: NEW, ownerId: B, contentSha256: first.content_sha256 }), false);
});

test('POST /api/notes: 생성 직후 사본으로 봉인, 봉인 쓰기가 실패해도 201 응답은 같고 오류 코드만 로그', async () => {
  for (const failSeal of [false, true]) {
    const tables = seed();
    // AFTER INSERT 트리거 흉내: 메모가 생기면 사본을 뜹니다.
    tables.afterInsert = (name, row, t) => {
      if (name === 'vault_notes') t.vault_notes_snapshot.push({ ...row, created_at: '2026-10-14T00:00:00Z',
        content_sha256: noteSha256(row.title, row.content), snapshot_at: '2026-10-14T00:00:00Z' });
    };
    tables.failInsert = name => failSeal && name === 'vault_notes_backup_seal';
    const handler = createNotesHandler('collection', () => ({
      verifyLogin: async header => (header === 'Bearer good' ? { userId: B } : null),
      supabase: fakeSupabase(tables), sealer: SEALER, checkDevice: APPROVED_DEVICE,
    }));
    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.join(' '));
    let status;
    let json;
    try {
      await handler({ method: 'POST', headers: { authorization: 'Bearer good' }, query: {}, body: { title: '가상 제목', body: 'live-check 시험 메모' } },
        { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } });
    } finally {
      console.error = original;
    }
    assert.equal(status, 201);
    assert.deepEqual(Object.keys(json), ['id']);
    const sealRow = sealOf(tables, json.id);
    if (failSeal) {
      assert.equal(sealRow, undefined);
      assert.deepEqual(logged, ['notes: 사본 봉인을 남기지 못했습니다. 42501']);
    } else {
      assert.equal(SEALER.verify(sealRow, { noteId: json.id, ownerId: B, contentSha256: snapshotOf(tables, json.id).content_sha256 }), true);
      assert.deepEqual(logged, []);
    }
  }
});
