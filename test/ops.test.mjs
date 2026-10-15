// 12단계 로컬 시험: 탈환 작전실, 신원 회수, 요청 ID, 제출 점검(GET·HEAD·alephEvidence), 실측 표.
// 실제 Supabase·배포·심판과 무관합니다. 가짜 저장소와 가짜 fetch만 씁니다.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createOpsHandler, SOURCES } from '../src/ops-api.mjs';
import { createNotesHandler } from '../src/notes-api.mjs';
import { createRestoreHandler } from '../src/restore-api.mjs';
import { createDeviceHandler } from '../src/device-api.mjs';
import { createDeviceGate, createDeviceSigner } from '../src/device-gate.mjs';
import { createIdentityCheck, createIdentityKeyer, supabaseRevocationStore } from '../src/identity-revocation.mjs';
import { runAttackChecks, stage12Plan } from '../src/attack-check.mjs';
import { CASES, runCases } from '../scripts/ops-verify.mjs';
import config from '../aleph.config.json' with { type: 'json' };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const JUDGE = randomUUID();
const SECRET = 'test-only-fake-server-key';
const SIGNER = createDeviceSigner(SECRET);
const KEYER = createIdentityKeyer(SECRET);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NOTE_TITLE = '작전실 시험 가상 제목';
const NOTE_BODY = '작전실 시험 가상 본문';

// 가짜 Supabase: 표마다 행을 두고, 거는 조건(eq·is)을 기록합니다. fail에 든 표는 오류를 돌려줍니다.
function fakeSupabase(tables, fail = new Set()) {
  const calls = [];
  const from = table => {
    const filters = [];
    let options;
    const q = {
      select(_columns, opts) { options = opts; return q; },
      eq(column, value) { filters.push([column, value]); return q; },
      is(column, value) { filters.push([column, value]); return q; },
      order() { return q; },
      limit() { return q; },
      then(resolve, reject) {
        calls.push({ table, filters: [...filters] });
        if (fail.has(table)) return Promise.resolve({ data: null, count: null, error: { code: 'XX000' } }).then(resolve, reject);
        const rows = (tables[table] ?? []).filter(row => filters.every(([c, v]) => (v === null ? row[c] == null : row[c] === v)));
        return Promise.resolve(options?.head ? { count: rows.length, error: null } : { data: rows, error: null }).then(resolve, reject);
      },
    };
    return q;
  };
  const rpc = async name => {
    calls.push({ table: `rpc:${name}`, filters: [] });
    return fail.has('rpc') ? { data: null, error: { code: 'XX000' } }
      : { data: [{ version: 's9-safe-1', captured_at: '2026-10-14T01:00:00Z' }], error: null };
  };
  return { calls, from, rpc };
}

function world({ revoked = [], fail = new Set() } = {}) {
  const deviceId = randomUUID();
  const tables = {
    vault_notes: [{ id: randomUUID(), owner_id: B, title: NOTE_TITLE, content: NOTE_BODY }],
    vault_notes_snapshot: [{ id: randomUUID(), owner_id: B, title: NOTE_TITLE, content: NOTE_BODY },
      { id: randomUUID(), owner_id: B, title: NOTE_TITLE, content: NOTE_BODY }, { id: randomUUID(), owner_id: A, title: 'A', content: 'A' }],
    vault_notes_backup_seal: [{ note_id: randomUUID(), owner_id: B }, { note_id: randomUUID(), owner_id: A }],
    vault_restore_audit: [{ audit_id: 7, actor_id: B, note_id: randomUUID(), outcome: 'restored', at: '2026-10-14T02:00:00Z' }],
    vault_devices: [{ id: deviceId, owner_id: B, status: 'approved' }, { id: randomUUID(), owner_id: B, status: 'pending' },
      { id: randomUUID(), owner_id: A, status: 'approved' }],
    vault_revoked_identities: revoked.map(sub => ({ identity_key: KEYER(sub), released_at: null })),
  };
  const supabase = fakeSupabase(tables, fail);
  const store = { deviceById: async id => tables.vault_devices.find(d => d.id === id) ?? null };
  const logins = { 'Bearer b': { kind: 'student', userId: B }, 'Bearer a': { kind: 'student', userId: A },
    'Bearer judge': { kind: 'judge', userId: JUDGE, runId: randomUUID(), identity: 'a' } };
  const deps = {
    verifyLogin: async header => logins[header] ?? null,
    supabase, sealer: null,
    checkDevice: createDeviceGate({ signer: SIGNER, store }),
    checkIdentity: createIdentityCheck({ keyer: KEYER, store: supabaseRevocationStore(supabase) }),
  };
  const deviceCheck = SIGNER.issue({ userId: B, deviceId }).token;
  return { tables, supabase, deps, deviceCheck };
}

async function invoke(handler, request) {
  const headers = {};
  let status;
  let json;
  await handler({ query: {}, ...request }, {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(code) { status = code; return { json(value) { json = value; } }; },
  });
  return { status, json, headers };
}
const leaves = (node, path = []) => {
  if (node && typeof node === 'object' && typeof node.source === 'string') return [[path.join('.'), node]];
  if (node && typeof node === 'object' && !Array.isArray(node)) return Object.entries(node).flatMap(([k, v]) => leaves(v, [...path, k]));
  return [];
};

test('작전실: 본인 범위만, 메모 본문·토큰·원본 사용자 번호 없음, 값마다 출처', async () => {
  const w = world();
  const out = await invoke(createOpsHandler(() => w.deps), { method: 'GET', headers: { authorization: 'Bearer b', 'x-vault-device': w.deviceCheck } });
  assert.equal(out.status, 200);
  const text = JSON.stringify(out.json);
  for (const secret of [NOTE_TITLE, NOTE_BODY, B, A, w.deviceCheck, 'Bearer', SECRET]) assert.equal(text.includes(secret), false, secret);
  assert.equal(out.json.requestId, out.headers['x-request-id']);
  // 본인 범위: 사용자 조건이 걸린 조회는 모두 B(로그인 사용자)만 겁니다.
  for (const call of w.supabase.calls) {
    for (const [column, value] of call.filters) {
      if (['owner_id', 'actor_id'].includes(column)) assert.equal(value, B, `${call.table}.${column}`);
    }
  }
  assert.deepEqual(out.json.restore.snapshots, { source: 'server', value: 2 });
  assert.deepEqual(out.json.restore.seals, { source: 'server', value: 1 });
  assert.deepEqual(out.json.restore.lastAudit.value, { outcome: 'restored', at: '2026-10-14T02:00:00Z' });
  assert.equal(out.json.revocation.devices.value.approved, 1);
  assert.equal(out.json.revocation.devices.value.pending, 1);
  assert.equal(out.json.revocation.identity.value.revoked, false);
  assert.match(out.json.revocation.identity.value.revocationKey, /^[0-9a-f]{64}$/u);
  assert.equal(out.json.detection.events.source, 'unconnected');
  assert.equal(out.json.decider.ruleIds.source, 'code');
  assert.ok(out.json.decider.zones.value.some(z => z.route === 'POST /notes/:id/restore'));
  const all = leaves(out.json);
  assert.ok(all.length >= 10);
  for (const [path, node] of all) assert.ok(SOURCES.includes(node.source), path);
});

test('작전실: 조회 실패는 failed, 심판은 기기 미연결·기기 검사 없음, 기기 확인 없는 학생은 403', async () => {
  const w = world({ fail: new Set(['vault_notes_snapshot', 'rpc']) });
  const out = await invoke(createOpsHandler(() => w.deps), { method: 'GET', headers: { authorization: 'Bearer b', 'x-vault-device': w.deviceCheck } });
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.restore.snapshots, { source: 'failed', value: null });
  assert.deepEqual(out.json.restore.dbPolicyBackup, { source: 'failed', value: null });
  const judge = await invoke(createOpsHandler(() => world().deps), { method: 'GET', headers: { authorization: 'Bearer judge' } });
  assert.equal(judge.status, 200);
  assert.equal(judge.json.viewer.value.kind, 'judge');
  assert.equal(judge.json.revocation.devices.source, 'unconnected');
  assert.equal(JSON.stringify(judge.json).includes(JUDGE), false);
  const noDevice = await invoke(createOpsHandler(() => world().deps), { method: 'GET', headers: { authorization: 'Bearer b' } });
  assert.deepEqual([noDevice.status, noDevice.json], [403, { error: 'DEVICE_CHECK_REQUIRED' }]);
  const anonymous = await invoke(createOpsHandler(() => world().deps), { method: 'GET', headers: {} });
  assert.equal(anonymous.status, 401);
  assert.equal((await invoke(createOpsHandler(() => world().deps), { method: 'POST', headers: { authorization: 'Bearer b' } })).status, 405);
});

test('신원 회수: 학생·심판 모두 메모·복구·기기·작전실에서 403 identity_revoked, 자료를 읽지 않음', async () => {
  const handlers = {
    notes: deps => createNotesHandler('collection', () => deps),
    restore: deps => createRestoreHandler(() => deps),
    devices: deps => createDeviceHandler(() => ({ ...deps, store: {}, signer: SIGNER, rp: {}, decide: async () => null, now: () => new Date() })),
    ops: deps => createOpsHandler(() => deps),
  };
  for (const [name, make] of Object.entries(handlers)) {
    for (const [auth, sub] of [['Bearer b', B], ['Bearer judge', JUDGE]]) {
      const w = world({ revoked: [sub] });
      const method = name === 'restore' || name === 'devices' ? 'POST' : 'GET';
      const query = name === 'restore' ? { id: randomUUID() } : name === 'devices' ? { action: 'challenge' } : {};
      const out = await invoke(make(w.deps), { method, query, body: { purpose: 'register' },
        headers: { authorization: auth, 'x-vault-device': w.deviceCheck } });
      assert.deepEqual([out.status, out.json], [403, { error: 'identity_revoked' }], `${name} ${auth}`);
      assert.deepEqual(w.supabase.calls.map(c => c.table), ['vault_revoked_identities'], `${name} ${auth}`);
      // 등록부에는 원본 ID가 아니라 HMAC 키로 조회합니다.
      const [[column, value]] = w.supabase.calls[0].filters;
      assert.equal(column, 'identity_key');
      assert.notEqual(value, sub);
      assert.match(value, /^[0-9a-f]{64}$/u);
    }
  }
  // 회수되지 않은 다른 사용자(A)는 그대로 지나갑니다(기기 확인이 없어 다음 단계인 기기 검사에서 403).
  const w = world({ revoked: [B] });
  const other = await invoke(createNotesHandler('collection', () => w.deps), { method: 'GET', headers: { authorization: 'Bearer a' } });
  assert.deepEqual(other.json, { error: 'DEVICE_CHECK_REQUIRED' });
  // 해제된 회수 행은 막지 않습니다.
  const released = world({ revoked: [B] });
  released.tables.vault_revoked_identities[0].released_at = '2026-10-14T03:00:00Z';
  const ok = await invoke(createNotesHandler('collection', () => released.deps), { method: 'GET', headers: { authorization: 'Bearer b', 'x-vault-device': released.deviceCheck } });
  assert.equal(ok.status, 200);
});

test('신원 회수: 등록부를 못 읽거나 검사기가 없으면 503으로 닫음(fail-closed)', async () => {
  for (const auth of ['Bearer b', 'Bearer judge']) {
    const w = world({ fail: new Set(['vault_revoked_identities']) });
    const out = await invoke(createNotesHandler('collection', () => w.deps), { method: 'GET', headers: { authorization: auth, 'x-vault-device': w.deviceCheck } });
    assert.deepEqual([out.status, out.json], [503, { error: 'IDENTITY_CHECK_UNAVAILABLE' }], auth);
    assert.equal(w.supabase.calls.some(c => c.table === 'vault_notes'), false);
  }
  const w = world();
  const { checkIdentity, ...withoutCheck } = w.deps;
  const out = await invoke(createRestoreHandler(() => withoutCheck), { method: 'POST', query: { id: randomUUID() }, headers: { authorization: 'Bearer judge' } });
  assert.deepEqual([out.status, out.json], [503, { error: 'IDENTITY_CHECK_UNAVAILABLE' }]);
});

test('요청 ID: 보호 API 응답마다 X-Request-Id, 로그는 한 줄에 메서드·경로 모양·상태·결과 코드만', async () => {
  const w = world();
  const logged = [];
  const original = console.log;
  console.log = (...args) => logged.push(args.join(' '));
  let results;
  try {
    const id = randomUUID();
    results = [
      await invoke(createNotesHandler('item', () => w.deps), { method: 'GET', query: { id, q: 'secret-query' }, headers: { authorization: 'Bearer b' } }),
      await invoke(createNotesHandler('collection', () => w.deps), { method: 'GET', headers: {} }),
      await invoke(createRestoreHandler(() => w.deps), { method: 'GET', query: { id }, headers: {} }),
      await invoke(createOpsHandler(() => w.deps), { method: 'GET', headers: { authorization: 'Bearer b', 'x-vault-device': w.deviceCheck } }),
    ];
    for (const r of results) assert.match(r.headers['x-request-id'], UUID);
    assert.equal(new Set(results.map(r => r.headers['x-request-id'])).size, results.length);
    assert.equal(logged.length, results.length);
    for (const [i, line] of logged.entries()) {
      const entry = JSON.parse(line.replace(/^request /u, ''));
      assert.deepEqual(Object.keys(entry), ['requestId', 'method', 'route', 'status', 'code']);
      assert.equal(entry.requestId, results[i].headers['x-request-id']);
      assert.equal(entry.status, results[i].status);
      for (const leak of [B, id, 'secret-query', w.deviceCheck, 'Bearer']) assert.equal(line.includes(leak), false, leak);
    }
    assert.deepEqual(logged.map(l => JSON.parse(l.replace(/^request /u, '')).route),
      ['/api/notes/:id', '/api/notes', '/api/notes/:id/restore', '/api/ops/summary']);
    assert.deepEqual(logged.map(l => JSON.parse(l.replace(/^request /u, '')).code),
      ['DEVICE_CHECK_REQUIRED', 'LOGIN_REQUIRED', 'METHOD_NOT_ALLOWED', 'ok']);
  } finally {
    console.log = original;
  }
});

test('제출 점검(12단계): GET만, 점검마다 한 번, 정해진 순서, alephEvidence는 fetch 옵션에만, observed는 HTTP 상태 또는 not_run', async () => {
  const sent = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    sent.push({ url: String(url), init });
    return new Response(JSON.stringify({ error: 'LOGIN_REQUIRED' }), { status: 401, headers: { 'content-type': 'application/json' } });
  };
  try {
    for (const key of [undefined, 'test-only-fake-publishable-key']) {
      sent.length = 0;
      const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
      if (key) process.env.SUPABASE_PUBLISHABLE_KEY = key; else delete process.env.SUPABASE_PUBLISHABLE_KEY;
      const checks = await runAttackChecks({ ...config, step: 12 });
      if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
      const plan = stage12Plan();
      assert.ok(checks.length <= 20);
      assert.deepEqual(checks.map(c => c.attackId), plan.map(p => p.attackId));
      for (const c of checks) assert.match(c.observed, /^(?:HTTP \d{3}|not_run)$/u, c.attackId);
      const requested = checks.filter(c => c.observed !== 'not_run');
      assert.equal(sent.length, requested.length);
      assert.equal(sent.length, plan.filter(p => !p.notRun).length);
      assert.deepEqual(sent.map(s => s.init.alephEvidence.caseId), requested.map(c => c.attackId));
      for (const { url, init } of sent) {
        assert.equal(init.method, 'GET');
        assert.equal(init.body, undefined);
        assert.equal(init.alephEvidence.requestKey, 'read');
        assert.equal(url.includes('alephEvidence'), false);
        assert.equal(JSON.stringify(init.headers ?? {}).includes('alephEvidence'), false);
        assert.equal(url.startsWith('https://'), true);
      }
      // 키가 있어도 원본 API에는 보내지 않습니다(묶음은 배포 주소 GET만).
      assert.equal(checks.find(c => c.attackId === 'anon_original_api_read').observed, 'not_run');
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('제출 점검(12단계): 요청이 실패하면 그 점검은 not_run', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('network'); };
  try {
    const checks = await runAttackChecks({ ...config, step: 12 });
    assert.ok(checks.every(c => c.observed === 'not_run'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('제출 점검(12단계): 모듈·Buffer·crypto 없이 돎(격리 환경 흉내: Buffer·process 정보를 지운 Node, 하위 프로세스 금지)', () => {
  const source = readFileSync(new URL('../src/attack-check.mjs', import.meta.url), 'utf8');
  const stage12 = source.slice(source.indexOf('// 12단계 점검:'), source.indexOf('export async function runAttackChecks'));
  for (const word of ['import(', 'import ', 'crypto', 'randomUUID', 'btoa', 'TextEncoder', 'process.', 'child_process', 'require(']) {
    assert.equal(stage12.includes(word), false, word);
  }
  // 전역 Buffer는 쓰지 않습니다(응답 메서드 arrayBuffer()는 전역 객체가 아님).
  assert.equal(/(?<![A-Za-z])Buffer\b/u.test(stage12), false, 'Buffer');
  for (const word of ['child_process', 'execFile', 'execSync', 'spawn(', 'node:net', 'node:http', 'writeFile']) {
    assert.equal(source.includes(word), false, word);
  }
  const script = `
    delete globalThis.Buffer;
    globalThis.fetch = async (url, init) => new Response('{"error":"LOGIN_REQUIRED"}', { status: 401 });
    const { runAttackChecks } = await import(${JSON.stringify(new URL('../src/attack-check.mjs', import.meta.url).href)});
    const config = JSON.parse(process.env.CHECK_CONFIG);
    const checks = await runAttackChecks(config);
    process.stdout.write(JSON.stringify(checks.map(c => c.observed)));
  `;
  const out = execFileSync(process.execPath, ['--permission', '--allow-fs-read=*', '--input-type=module', '-e', script], {
    encoding: 'utf8', windowsHide: true,
    env: { ...process.env, CHECK_CONFIG: JSON.stringify({ ...config, step: 12 }) },
  });
  const observed = JSON.parse(out);
  assert.equal(observed.length, stage12Plan().length);
  assert.ok(observed.every(text => text === 'HTTP 401' || text === 'not_run'), out);
  assert.throws(() => execFileSync(process.execPath, ['--permission', '--allow-fs-read=*', '--input-type=module', '-e',
    "import('node:child_process').then(m => m.execFileSync('git', ['--version']))"], { encoding: 'utf8', windowsHide: true, stdio: 'pipe' }));
});

test('실측 표: 보낸 요청만 결과를 적고, 보내지 않은 줄은 미실행·일치 없음', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push(`${init.method} ${new URL(url).pathname}`);
    return new Response(JSON.stringify({ error: 'LOGIN_REQUIRED' }), { status: 401, headers: { 'x-request-id': 'rid-1' } });
  };
  const rows = await runCases({ app: new URL('https://student.vercel.app'), fetchImpl, withLocal: false,
    now: () => new Date('2026-10-14T05:00:00Z') });
  assert.equal(rows.length, CASES.length);
  for (const row of rows) {
    if (row.actual.startsWith('미실행')) {
      assert.equal(row.pass, null, row.id);
      assert.equal(row.checkedAt, null, row.id);
      assert.equal(row.requestId, '-', row.id);
    } else {
      assert.equal(row.checkedAt, '2026-10-14T05:00:00.000Z');
      assert.equal(row.requestId, 'rid-1');
    }
  }
  // 로그인 없이 실행하면 학생 토큰이 필요한 줄과 기기 승인이 필요한 줄은 보내지 않습니다.
  for (const id of ['S3-3', 'S4-1', 'S11-1', 'S11-2', 'S12-2', 'S6-1']) {
    assert.ok(rows.find(r => r.id === id).actual.startsWith('미실행'), id);
  }
  assert.equal(sent.length, rows.filter(r => r.checkedAt).length);
  // 401만 돌려준 가짜 서버에서 404를 기대한 줄은 일치하지 않습니다(임의로 통과 처리하지 않음).
  assert.equal(rows.find(r => r.id === 'S1-1').pass, false);
  assert.equal(rows.find(r => r.id === 'S2-1').pass, true);
});
