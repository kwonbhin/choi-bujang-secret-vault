// 10단계 복구 경로 POST /api/restores/:id 의 로컬 시험입니다. 학생 설계(계약에 없음).
// 가짜 로그인 검사기와 .eq() 조건을 실제로 거르는 가짜 저장소를 씁니다. 배포된 API나 심판 판정이 아닙니다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noteSha256 } from '../src/content-hash.mjs';
import { createRestoreHandler } from '../src/restore-api.mjs';

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
  return { vault_notes: notes.map(n => ({ ...n })), vault_notes_snapshot, vault_restore_audit: [] };
}

// supabase-js의 from().select().eq().maybeSingle(), insert(), update().eq().select().maybeSingle() 흉내
function fakeSupabase(tables) {
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
          const found = rows.filter(match);
          if (found.length > 1) return { data: null, error: { code: 'PGRST116' } };
          if (found[0] && patch) Object.assign(found[0], patch);
          return { data: found[0] ? { ...found[0] } : null, error: null };
        },
        insert(row) {
          if (name !== 'vault_restore_audit' && rows.some(existing => existing.id === row.id)) {
            return Promise.resolve({ error: { code: '23505' } });
          }
          rows.push({ ...row });
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    },
  };
}

async function call(tables, { user = B, method = 'POST', id, body, query = {}, auth = true } = {}) {
  const handler = createRestoreHandler(() => ({
    verifyLogin: async header => (header === 'Bearer good' ? { userId: user } : null),
    supabase: fakeSupabase(tables),
  }));
  let status;
  let json;
  const response = { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } };
  await handler({ method, headers: auth ? { authorization: 'Bearer good' } : {}, query: { ...query, id }, body }, response);
  return { status, json };
}

const snapshotOf = (tables, id) => tables.vault_notes_snapshot.find(row => row.id === id);
const noteOf = (tables, id) => tables.vault_notes.find(row => row.id === id);

test('B 메모 변조 → 복구 성공, 해시 일치, 응답에 내용 없음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(json).sort(), ['id', 'matched', 'sha256']);
  assert.equal(json.matched, true);
  assert.equal(json.sha256, snapshotOf(tables, NOTE_B).content_sha256);
  assert.equal(noteOf(tables, NOTE_B).content, '가상 본문 B');
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'restored_modified');
});

test('B 메모 삭제 → 같은 id·owner_id로 복구 성공', async () => {
  const tables = seed();
  tables.vault_notes = tables.vault_notes.filter(row => row.id !== NOTE_B);
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 200);
  assert.equal(json.matched, true);
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
  assert.deepEqual(json, { error: 'NOTE_NOT_FOUND' });
  assert.equal(noteOf(tables, NOTE_A).content, 'A가 고친 본문');
});

test('없는 id → 404 (남의 메모와 같은 응답)', async () => {
  const tables = seed();
  const missing = await call(tables, { id: MISSING });
  const others = await call(seed(), { id: NOTE_A });
  assert.equal(missing.status, 404);
  assert.deepEqual(missing.json, others.json);
});

test('로그인 없음 → 401, 감사 기록 없음', async () => {
  const tables = seed();
  const { status, json } = await call(tables, { id: NOTE_B, auth: false });
  assert.equal(status, 401);
  assert.equal(json.error, 'LOGIN_REQUIRED');
  assert.equal(tables.vault_restore_audit.length, 0);
});

test('사본 해시 불일치 → 409, 복원 안 됨', async () => {
  const tables = seed();
  snapshotOf(tables, NOTE_B).content = '사본이 바뀜';
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 409);
  assert.equal(json.error, 'SNAPSHOT_HASH_MISMATCH');
  assert.equal(noteOf(tables, NOTE_B).content, '변조된 본문');
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'snapshot_hash_mismatch');
});

test('사본 주인은 B지만 지금 행 주인이 다르면 → 404, 덮어쓰지 않음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).owner_id = A;
  const { status } = await call(tables, { id: NOTE_B });
  assert.equal(status, 404);
  assert.equal(noteOf(tables, NOTE_B).owner_id, A);
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'owner_mismatch');
});

test('다른 메모·사본은 그대로, 감사 기록은 로그인 요청마다 한 줄씩만 늘고 내용·토큰이 없음', async () => {
  const tables = seed();
  noteOf(tables, NOTE_B).content = '변조된 본문';
  const before = JSON.stringify({ a: noteOf(tables, NOTE_A), b2: noteOf(tables, NOTE_B2), snaps: tables.vault_notes_snapshot });
  for (const id of [NOTE_B, NOTE_A, MISSING, 'not-a-uuid']) await call(tables, { id });
  await call(tables, { id: NOTE_B, auth: false });
  const after = JSON.stringify({ a: noteOf(tables, NOTE_A), b2: noteOf(tables, NOTE_B2), snaps: tables.vault_notes_snapshot });
  assert.equal(after, before);
  assert.equal(tables.vault_notes.length, 3);
  assert.deepEqual(tables.vault_restore_audit.map(row => row.outcome),
    ['restored_modified', 'not_found', 'not_found', 'invalid_id']);
  for (const row of tables.vault_restore_audit) {
    assert.deepEqual(Object.keys(row).sort(), ['actor_id', 'content_sha256', 'matched', 'note_id', 'outcome']);
    assert.doesNotMatch(JSON.stringify(row), /가상 본문|변조|Bearer|good/u);
  }
});

test('이미 사본과 같으면 쓰지 않고 일치로 답함, POST가 아니면 405', async () => {
  const tables = seed();
  const { status, json } = await call(tables, { id: NOTE_B });
  assert.equal(status, 200);
  assert.equal(json.matched, true);
  assert.equal(tables.vault_restore_audit.at(-1).outcome, 'already_matching');
  assert.equal((await call(tables, { id: NOTE_B, method: 'GET' })).status, 405);
});
