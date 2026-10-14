// 11단계 기기 승인 로컬 시험입니다. 실제 Supabase·브라우저·심판과 무관하고, 가짜 인증 장치(Node가 만든 ES256 키)로
// 패스키 등록·서명 응답을 흉내 냅니다. 개인키는 이 시험 안 메모리에만 있고 파일에 쓰지 않습니다.
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { createDeviceHandler, deviceDecisionRequest } from '../src/device-api.mjs';
import { createDeviceGate, createDeviceSigner } from '../src/device-gate.mjs';
import { createNotesHandler } from '../src/notes-api.mjs';
import { createRestoreHandler } from '../src/restore-api.mjs';
import { createAuthHandler } from '../src/auth-api.mjs';
import { decide } from '../src/decider.mjs';
import { decodeCbor } from '../src/webauthn.mjs';

const RP = { rpId: 'student-vault.vercel.app', origin: 'https://student-vault.vercel.app' };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const SIGNER = createDeviceSigner('test-only-fake-server-key');
// 12단계 신원 회수 검사는 test/ops.test.mjs에서 따로 시험합니다. 여기서는 회수되지 않은 신원으로 봅니다.
const NOT_REVOKED = async () => ({ revoked: false });
const sha = data => createHash('sha256').update(data).digest();
const b64 = buf => Buffer.from(buf).toString('base64url');

// ── 아주 작은 CBOR 인코더(시험용) ──
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const s = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, s.length), s]); }
  if (value instanceof Map) {
    return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  }
  throw new Error('unsupported');
}

// ── 가짜 인증 장치 ──
function authenticator({ rpId = RP.rpId } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credentialId = randomBytes(32);
  const cose = new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
  const authData = (flags, withKey) => {
    const head = Buffer.concat([sha(Buffer.from(rpId)), Buffer.from([flags]), Buffer.from([0, 0, 0, 1])]);
    if (!withKey) return head;
    const len = Buffer.alloc(2); len.writeUInt16BE(credentialId.length);
    return Buffer.concat([head, Buffer.alloc(16), len, credentialId, cbor(cose)]);
  };
  const clientData = (type, challenge, origin) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    credentialId: b64(credentialId),
    register(challenge, { origin = RP.origin, flags = 0x45, extra = {} } = {}) {
      return {
        credentialId: b64(credentialId),
        clientDataJSON: b64(clientData('webauthn.create', challenge, origin)),
        attestationObject: b64(cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData(flags, true)]]))),
        ...extra,
      };
    },
    assert(challenge, { origin = RP.origin, flags = 0x05, key = privateKey } = {}) {
      const data = authData(flags, false);
      const client = clientData('webauthn.get', challenge, origin);
      return {
        credentialId: b64(credentialId),
        clientDataJSON: b64(client),
        authenticatorData: b64(data),
        signature: b64(sign('sha256', Buffer.concat([data, sha(client)]), key)),
      };
    },
  };
}

// ── 메모리 등록부(Supabase 등록부와 같은 모양) ──
function memoryStore(clock) {
  const devices = [];
  const challenges = [];
  return {
    devices, challenges,
    async insertChallenge({ ownerId, purpose, challengeSha256, expiresAt }) {
      challenges.push({ ownerId, purpose, challengeSha256, expiresAt, usedAt: null });
    },
    async consumeChallenge({ ownerId, purpose, challengeSha256, now }) {
      const row = challenges.find(c => c.challengeSha256 === challengeSha256 && c.ownerId === ownerId
        && c.purpose === purpose && !c.usedAt && c.expiresAt > now);
      if (!row) return false;
      row.usedAt = now;
      return true;
    },
    // DB 트리거처럼 status는 항상 pending입니다.
    async insertDevice({ ownerId, credentialId, publicKey, alg }) {
      if (devices.some(d => d.credential_id === credentialId)) throw Object.assign(new Error('dup'), { code: '23505' });
      const row = { id: randomUUID(), owner_id: ownerId, credential_id: credentialId, public_key: publicKey, alg, status: 'pending' };
      devices.push(row);
      return { id: row.id, status: row.status };
    },
    async deviceByCredential(credentialId) { return devices.find(d => d.credential_id === credentialId) ?? null; },
    async deviceById(id) { return devices.find(d => d.id === id) ?? null; },
    async activeCredentials(ownerId) {
      return devices.filter(d => d.owner_id === ownerId && d.status !== 'revoked').map(d => d.credential_id);
    },
    setStatus(id, status) { devices.find(d => d.id === id).status = status; },
  };
}

function world({ decideFn = decide } = {}) {
  let now = new Date('2026-10-14T03:00:00Z');
  const clock = { now: () => now, advance: seconds => { now = new Date(now.getTime() + seconds * 1000); } };
  const store = memoryStore(clock);
  const logins = { 'Bearer a': { kind: 'student', userId: A }, 'Bearer b': { kind: 'student', userId: B },
    'Bearer judge': { kind: 'judge', userId: randomUUID(), runId: randomUUID(), identity: 'b' } };
  const verifyLogin = async header => logins[header] ?? null;
  const decided = [];
  const handler = createDeviceHandler(() => ({
    verifyLogin, store, signer: SIGNER, rp: RP, now: clock.now, checkIdentity: NOT_REVOKED,
    decide: async request => { decided.push(request); return decideFn(request); },
  }));
  const checkDevice = createDeviceGate({ signer: SIGNER, store, now: clock.now });
  const call = async (action, auth, body) => {
    let status; let json;
    await handler({ method: 'POST', headers: auth ? { authorization: auth } : {}, query: { action }, body },
      { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } });
    return { status, json };
  };
  return { clock, store, call, checkDevice, verifyLogin, decided };
}

async function registerDevice(w, auth = 'Bearer a', device = authenticator()) {
  const ch = await w.call('challenge', auth, { purpose: 'register' });
  assert.equal(ch.status, 200);
  const reg = await w.call('register', auth, device.register(ch.json.challenge));
  return { device, reg };
}
async function verifyDevice(w, device, auth = 'Bearer a', options = {}) {
  const ch = await w.call('challenge', auth, { purpose: 'verify' });
  return w.call('verify', auth, device.assert(options.challenge ?? ch.json.challenge, options));
}

// 메모 API를 가짜 저장소로 부릅니다. 저장소가 불렸는지(자료를 읽었는지) 셉니다.
async function notesCall(w, auth, headers = {}) {
  const touched = [];
  const supabase = {
    from(name) {
      touched.push(name);
      const q = { select: () => q, eq: () => q, order: async () => ({ data: [{ id: 'n1', title: '가상', content: '가상 본문' }], error: null }) };
      return q;
    },
  };
  const handler = createNotesHandler('collection', () => ({ verifyLogin: w.verifyLogin, supabase, sealer: null, checkDevice: w.checkDevice, checkIdentity: NOT_REVOKED }));
  let status; let json;
  await handler({ method: 'GET', headers: { authorization: auth, ...headers }, query: {} },
    { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } });
  return { status, json, touched };
}

test('기기 승인 전: 보호 요청은 403이고 자료를 읽지 않음', async () => {
  const w = world();
  const out = await notesCall(w, 'Bearer a');
  assert.equal(out.status, 403);
  assert.deepEqual(out.json, { error: 'DEVICE_CHECK_REQUIRED' });
  assert.deepEqual(out.touched, []);
  // 엉터리 기기 확인 값도 같습니다.
  const forged = await notesCall(w, 'Bearer a', { 'x-vault-device': 'abc.def' });
  assert.equal(forged.status, 403);
  assert.deepEqual(forged.touched, []);
});

test('승인 요청은 pending으로만 올라가고 본문의 status는 읽지 않음, 대기 중 확인은 403', async () => {
  const w = world();
  const device = authenticator();
  const ch = await w.call('challenge', 'Bearer a', { purpose: 'register' });
  assert.equal(ch.json.rpId, RP.rpId);
  const reg = await w.call('register', 'Bearer a', device.register(ch.json.challenge, { extra: { status: 'approved', owner_id: B } }));
  assert.equal(reg.status, 201);
  assert.equal(reg.json.status, 'pending');
  assert.equal(w.store.devices[0].owner_id, A);
  assert.equal(w.store.devices[0].status, 'pending');
  assert.equal(JSON.stringify(reg.json).includes('public'), false);
  const check = await verifyDevice(w, device);
  assert.equal(check.status, 403);
  assert.equal(check.json.status, 'pending');
  assert.equal(check.json.decision, 'deny');
  assert.equal(check.json.reasonCode, 'device_not_registered');
  assert.equal(check.json.deviceCheck, undefined);
  assert.equal((await notesCall(w, 'Bearer a')).status, 403);
});

test('승인된 기기: 서명 검증 → 등록부 approved → 판정기 allow → 30분 기기 확인 결과로 자료 열림', async () => {
  const w = world();
  const { device, reg } = await registerDevice(w);
  w.store.setStatus(reg.json.deviceId, 'approved');
  const check = await verifyDevice(w, device);
  assert.equal(check.status, 200);
  assert.equal(check.json.status, 'approved');
  assert.equal(check.json.decision, 'allow');
  assert.equal(Date.parse(check.json.expiresAt) - w.clock.now().getTime(), 30 * 60 * 1000);
  // 판정기에는 계약의 18개 이름만, deviceRegistered true로 넣었습니다.
  const request = w.decided.at(-1);
  assert.deepEqual(Object.keys(request).sort(), ['at', 'classId', 'deviceId', 'deviceRegistered', 'method', 'path', 'policyRevision',
    'projectId', 'queryLength', 'querySha256', 'recentEvents', 'requestId', 'route', 'schema', 'service', 'signals', 'stepUp', 'subjectId'].sort());
  assert.equal(request.deviceRegistered, true);
  assert.equal(request.route, 'GET /notes/:id');
  assert.match(request.deviceId, /^[0-9a-f]{16}$/u);
  const notes = await notesCall(w, 'Bearer a', { 'x-vault-device': check.json.deviceCheck });
  assert.equal(notes.status, 200);
  assert.deepEqual(notes.json, [{ id: 'n1', title: '가상', body: '가상 본문' }]);
  // 30분이 지나면 다시 403입니다.
  w.clock.advance(30 * 60 + 1);
  assert.equal((await notesCall(w, 'Bearer a', { 'x-vault-device': check.json.deviceCheck })).status, 403);
});

test('취소된 기기: 이미 받은 기기 확인 결과도 등록부를 다시 읽어 403, 다시 확인해도 거부', async () => {
  const w = world();
  const { device, reg } = await registerDevice(w);
  w.store.setStatus(reg.json.deviceId, 'approved');
  const check = await verifyDevice(w, device);
  w.store.setStatus(reg.json.deviceId, 'revoked');
  const notes = await notesCall(w, 'Bearer a', { 'x-vault-device': check.json.deviceCheck });
  assert.equal(notes.status, 403);
  assert.deepEqual(notes.json, { error: 'DEVICE_NOT_APPROVED' });
  assert.deepEqual(notes.touched, []);
  // 취소된 기기는 질문 목록에서도 빠집니다.
  const ch = await w.call('challenge', 'Bearer a', { purpose: 'verify' });
  assert.deepEqual(ch.json.allowCredentials, []);
});

test('틀린 서명·서버가 낸 적 없는 질문·만료된 질문·다시 쓴 질문은 거부', async () => {
  const w = world();
  const { device, reg } = await registerDevice(w);
  w.store.setStatus(reg.json.deviceId, 'approved');
  const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const badSig = await verifyDevice(w, device, 'Bearer a', { key: other });
  assert.deepEqual([badSig.status, badSig.json.error], [400, 'WEBAUTHN_SIGNATURE']);
  const neverIssued = await verifyDevice(w, device, 'Bearer a', { challenge: randomBytes(32).toString('base64url') });
  assert.deepEqual([neverIssued.status, neverIssued.json.error], [400, 'CHALLENGE_INVALID']);
  const ch = await w.call('challenge', 'Bearer a', { purpose: 'verify' });
  w.clock.advance(121);
  const expired = await w.call('verify', 'Bearer a', device.assert(ch.json.challenge));
  assert.deepEqual([expired.status, expired.json.error], [400, 'CHALLENGE_INVALID']);
  const fresh = await w.call('challenge', 'Bearer a', { purpose: 'verify' });
  assert.equal((await w.call('verify', 'Bearer a', device.assert(fresh.json.challenge))).status, 200);
  const reused = await w.call('verify', 'Bearer a', device.assert(fresh.json.challenge));
  assert.deepEqual([reused.status, reused.json.error], [400, 'CHALLENGE_INVALID']);
  // 등록 질문을 확인에 쓰거나, 다른 출처·다른 rpId·사용자 확인 없음도 거부합니다.
  const regChallenge = await w.call('challenge', 'Bearer a', { purpose: 'register' });
  assert.equal((await w.call('verify', 'Bearer a', device.assert(regChallenge.json.challenge))).json.error, 'CHALLENGE_INVALID');
  const v1 = await w.call('challenge', 'Bearer a', { purpose: 'verify' });
  assert.equal((await w.call('verify', 'Bearer a', device.assert(v1.json.challenge, { origin: 'https://evil.example' }))).json.error, 'WEBAUTHN_ORIGIN');
  assert.equal((await w.call('verify', 'Bearer a', device.assert(v1.json.challenge, { flags: 0x01 }))).json.error, 'WEBAUTHN_USER_VERIFICATION');
  const wrongRp = authenticator({ rpId: 'other.vercel.app' });
  const r1 = await w.call('challenge', 'Bearer a', { purpose: 'register' });
  assert.equal((await w.call('register', 'Bearer a', wrongRp.register(r1.json.challenge))).json.error, 'WEBAUTHN_RP');
});

test('다른 사람 기기: B가 A의 기기 서명이나 A의 기기 확인 결과를 써도 거부', async () => {
  const w = world();
  const { device, reg } = await registerDevice(w, 'Bearer a');
  w.store.setStatus(reg.json.deviceId, 'approved');
  const okA = await verifyDevice(w, device, 'Bearer a');
  assert.equal(okA.status, 200);
  const chB = await w.call('challenge', 'Bearer b', { purpose: 'verify' });
  assert.deepEqual(chB.json.allowCredentials, []);
  const regB = await w.call('challenge', 'Bearer b', { purpose: 'register' });
  const asB = await w.call('verify', 'Bearer b', device.assert(regB.json.challenge));
  assert.deepEqual([asB.status, asB.json.error], [403, 'DEVICE_NOT_FOUND']);
  const notesB = await notesCall(w, 'Bearer b', { 'x-vault-device': okA.json.deviceCheck });
  assert.equal(notesB.status, 403);
  assert.deepEqual(notesB.touched, []);
  // 같은 기기를 B가 다시 등록하려 해도 막힙니다.
  const again = await w.call('register', 'Bearer b', device.register(regB.json.challenge));
  assert.equal(again.status === 409 || again.status === 400, true);
  // 서명을 바꾼 기기 확인 결과도 거부합니다.
  const [body] = okA.json.deviceCheck.split('.');
  const tampered = `${body}.${Buffer.alloc(32).toString('base64url')}`;
  assert.equal((await notesCall(w, 'Bearer a', { 'x-vault-device': tampered })).status, 403);
});

test('판정기가 allow가 아니면 기기 확인 결과를 주지 않음', async () => {
  const w = world({ decideFn: async request => ({ schema: 'aleph.decision.v1', requestId: request.requestId,
    decision: 'step_up', reasonCode: 'step_up_required', ruleIds: ['step_up_required'] }) });
  const { device, reg } = await registerDevice(w);
  w.store.setStatus(reg.json.deviceId, 'approved');
  const check = await verifyDevice(w, device);
  assert.equal(check.status, 403);
  assert.equal(check.json.decision, 'step_up');
  assert.equal(check.json.deviceCheck, undefined);
  // 실제 판정기: 등록 안 됨 → deny·device_not_registered, 등록됨 → allow
  const base = { userId: A, credentialId: 'x'.repeat(22), userVerified: true, now: new Date() };
  assert.equal((await decide(deviceDecisionRequest({ ...base, registered: false }))).reasonCode, 'device_not_registered');
  assert.equal((await decide(deviceDecisionRequest({ ...base, registered: true }))).decision, 'allow');
});

test('심판 토큰은 브라우저 기기 검사를 건너뛰고 기존대로 처리, 기기 승인 경로는 학생만', async () => {
  const w = world();
  let called = 0;
  const gate = async (...args) => { called += 1; return w.checkDevice(...args); };
  const supabase = { from: () => { const q = { select: () => q, eq: () => q, order: async () => ({ data: [], error: null }) }; return q; } };
  const handler = createNotesHandler('collection', () => ({ verifyLogin: w.verifyLogin, supabase, sealer: null, checkDevice: gate, checkIdentity: NOT_REVOKED }));
  let status;
  await handler({ method: 'GET', headers: { authorization: 'Bearer judge' }, query: {} },
    { setHeader() {}, status(code) { status = code; return { json() {} }; } });
  assert.equal(status, 200);
  assert.equal(called, 0);
  const judgeDevice = await w.call('challenge', 'Bearer judge', { purpose: 'register' });
  assert.deepEqual([judgeDevice.status, judgeDevice.json.error], [403, 'STUDENT_DEVICE_ONLY']);
  assert.equal((await w.call('challenge', undefined, { purpose: 'register' })).status, 401);
});

test('복구 API도 기기 검사가 먼저: 승인 안 된 학생은 감사 기록·메모를 건드리지 않고 403', async () => {
  const w = world();
  const touched = [];
  const handler = createRestoreHandler(() => ({
    verifyLogin: w.verifyLogin, sealer: null, checkDevice: w.checkDevice, checkIdentity: NOT_REVOKED,
    supabase: { from(name) { touched.push(name); throw new Error('읽으면 안 됨'); } },
  }));
  let status; let json;
  await handler({ method: 'POST', headers: { authorization: 'Bearer a' }, query: { id: randomUUID() }, body: {} },
    { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } });
  assert.equal(status, 403);
  assert.deepEqual(json, { error: 'DEVICE_CHECK_REQUIRED' });
  assert.deepEqual(touched, []);
  // 검사기가 빠진 설정은 자료를 열지 않습니다.
  const unconfigured = createRestoreHandler(() => ({ verifyLogin: w.verifyLogin, supabase: {}, sealer: null, checkIdentity: NOT_REVOKED }));
  await unconfigured({ method: 'POST', headers: { authorization: 'Bearer a' }, query: { id: randomUUID() }, body: {} },
    { setHeader() {}, status(code) { status = code; return { json(value) { json = value; } }; } });
  assert.deepEqual([status, json.error], [500, 'DEVICE_CHECK_NOT_CONFIGURED']);
});

test('화면 코드: 브라우저 저장소·쿠키·서비스 워커 사용 0건, 토큰 갱신은 쿠키가 아닌 본문', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const word of ['localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'serviceWorker', 'caches.']) {
    assert.equal(html.includes(word), false, word);
  }
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest">/u);
  // refresh token이 본문에 없으면 401이고, 남은 옛 쿠키는 지우기만 합니다(새 쿠키를 만들지 않음).
  const headers = {};
  let status; let json;
  await createAuthHandler('refresh', () => ({ url: 'https://example.supabase.co', key: 'unused' }))(
    { method: 'POST', headers: { 'content-type': 'application/json', cookie: 'vault_refresh=old' }, body: {} },
    { setHeader(k, v) { headers[k.toLowerCase()] = v; }, status(code) { status = code; return { json(value) { json = value; } }; } });
  assert.deepEqual([status, json.error], [401, 'NO_SESSION']);
  assert.match(headers['set-cookie'], /Max-Age=0/u);
  const auth = await readFile(new URL('../src/auth-api.mjs', import.meta.url), 'utf8');
  assert.equal(/Max-Age=\$\{/u.test(auth), false);
});

test('설치형 웹앱 설정: 이름·start_url·standalone·아이콘 192·512 PNG', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, '점령된 자료실');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(item => item.sizes === `${size}x${size}`);
    assert.ok(icon, `${size}`);
    const png = await readFile(new URL(`../public${icon.src}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [size, size]);
  }
});

test('CBOR 읽기는 길이를 모르는 항목·깊은 중첩을 받지 않음', () => {
  assert.throws(() => decodeCbor(Buffer.from([0x5f])), /WEBAUTHN_FORMAT/u);
  assert.throws(() => decodeCbor(Buffer.from([0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81, 0x00])), /WEBAUTHN_FORMAT/u);
  assert.equal(decodeCbor(cbor(new Map([[1, 2]]))).value.get(1), 2);
});
