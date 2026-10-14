// 12단계 실측 표: 1~11단계(와 12단계 작전실)의 정상·금지 요청을 실제 배포에 보내고, 기대 결과·실제 API 결과·
// 요청 ID(X-Request-Id)·확인 시각을 표로 남깁니다. 학생이 자기 터미널에서 직접 실행합니다.
//   npm run ops:verify               로그인 없이 보낼 수 있는 요청만 보냄(로그인이 필요한 줄은 "미실행")
//   npm run ops:verify -- --login    B 계정 이메일·비밀번호를 물어보고(메모리에만) 로그인이 필요한 줄도 보냄
// 원칙
// - 실제로 보낸 요청만 결과를 적습니다. 보내지 않은 줄은 "미실행"과 이유를 적고 통과로 세지 않습니다.
// - 통과(일치)는 실제 상태 코드·오류 코드가 기대와 같을 때만입니다. 심판의 41종 시험을 대신하거나 통과로 처리하지 않습니다.
// - 판정기·탐지기 줄(6~9단계)은 반 엔진(ALEPH SDP 엔진, 제공)을 거쳐야 하는 판정이라 API 결과는 "미실행"이고,
//   비고에 로컬 판정기·탐지기 실행 결과(요청 아님)만 적습니다.
// - 이메일·비밀번호·토큰·메모 제목·내용은 출력·저장하지 않습니다. 결과 파일 artifacts/ops-verify-result.json은 Git에서 제외됩니다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const SAMPLE_ID = '00000000-0000-4000-8000-000000000012';
const base64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
// 학생 발급자를 흉내 낸 서명 없는 가짜 토큰입니다. 실제 키나 세션과 무관합니다.
function forgedToken() {
  const now = Math.floor(Date.now() / 1000);
  return [base64url({ alg: 'ES256', typ: 'JWT', kid: 'forged' }),
    base64url({ iss: config.identityProvider?.issuer, aud: 'authenticated', role: 'authenticated',
      sub: '00000000-0000-4000-8000-000000000000', iat: now, exp: now + 600 }), 'forged-signature'].join('.');
}

// auth: none(로그인 없음) | forged(가짜 토큰) | student(B 로그인, 기기 확인 없음) | studentBadDevice(B 로그인 + 엉터리 기기 확인 값)
// skip: 이 스크립트가 보낼 수 없는 줄의 이유(API 결과는 미실행). local: 로컬 실행 비고를 만드는 함수 이름.
export const CASES = Object.freeze([
  { stage: 1, id: 'S1-1', kind: '금지', label: '공개 자료 파일 읽기', method: 'GET', path: '/data.json', auth: 'none', expect: { status: 404 } },
  { stage: 2, id: 'S2-1', kind: '금지', label: '로그인 없이 메모 목록', method: 'GET', path: '/api/notes', auth: 'none', expect: { status: 401, error: 'LOGIN_REQUIRED' } },
  { stage: 3, id: 'S3-1', kind: '금지', label: '로그인 없이 메모 추가', method: 'POST', path: '/api/notes', auth: 'none', body: { title: 'ops-verify', body: '' }, expect: { status: 401, error: 'LOGIN_REQUIRED' } },
  { stage: 3, id: 'S3-2', kind: '금지', label: '가짜 토큰으로 메모 목록', method: 'GET', path: '/api/notes', auth: 'forged', expect: { status: 401, error: 'INVALID_LOGIN' } },
  { stage: 3, id: 'S3-3', kind: '정상', label: 'B 로그인', login: true, expect: { status: 200 } },
  { stage: 4, id: 'S4-1', kind: '정상', label: 'B 자기 메모 목록(승인된 기기)', skip: '패스키 기기 승인이 필요해 이 스크립트가 보낼 수 없음(화면에서 확인)', expect: { status: 200 } },
  { stage: 4, id: 'S4-2', kind: '금지', label: 'B가 A 메모 읽기(승인된 기기) → 404', skip: '패스키 기기 승인이 필요해 이 스크립트가 보낼 수 없음', expect: { status: 404 } },
  { stage: 5, id: 'S5-1', kind: '금지', label: '화면에 공개 키·서버 키 없음', method: 'GET', path: '/', auth: 'none', expect: { status: 200, noKeys: true } },
  { stage: 5, id: 'S5-2', kind: '금지', label: 'anon 키로 원본 API 읽기 → 42501', skip: 'publishable key가 필요해 보내지 않음(npm run bundle에 키를 넘기면 제출 점검이 GET으로 보냄)', expect: { status: 401 } },
  { stage: 6, id: 'S6-1', kind: '정상', label: '등록 기기의 메모 한 건 읽기 판정', skip: '반 엔진(ALEPH SDP 엔진, 제공)을 거치는 판정이라 학생이 보낼 수 없음', local: 'deciderRegistered', expect: { decision: 'allow' } },
  { stage: 6, id: 'S6-2', kind: '금지', label: '미등록 기기 판정', skip: '반 엔진을 거치는 판정이라 학생이 보낼 수 없음', local: 'deciderUnregistered', expect: { decision: 'deny' } },
  { stage: 7, id: 'S7-1', kind: '금지', label: '복합 이상 접속 판정 → step_up', skip: '반 엔진을 거치는 판정이라 학생이 보낼 수 없음', local: 'deciderStepUp', expect: { decision: 'step_up' } },
  { stage: 8, id: 'S8-1', kind: '금지', label: '메모 전체 목록 판정 → 거부', skip: '반 엔진을 거치는 판정이라 학생이 보낼 수 없음', local: 'deciderNoteList', expect: { decision: 'deny' } },
  { stage: 8, id: 'S8-2', kind: '금지', label: '공지 수정 판정 → 거부', skip: '반 엔진을 거치는 판정이라 학생이 보낼 수 없음', local: 'deciderNotice', expect: { decision: 'deny' } },
  { stage: 9, id: 'S9-1', kind: '금지', label: 'GET 121건 몰림 → 회수 제안', skip: '반 엔진의 사건 전달이 연결되지 않음', local: 'detectBurst', expect: { action: 'propose_revocation' } },
  { stage: 10, id: 'S10-1', kind: '금지', label: '로그인 없이 복구', method: 'POST', path: `/api/notes/${SAMPLE_ID}/restore`, auth: 'none', body: { dryRun: true }, expect: { status: 401, error: 'LOGIN_REQUIRED' } },
  { stage: 10, id: 'S10-2', kind: '금지', label: '가짜 토큰으로 복구', method: 'POST', path: `/api/notes/${SAMPLE_ID}/restore`, auth: 'forged', body: { dryRun: true }, expect: { status: 401, error: 'INVALID_LOGIN' } },
  { stage: 10, id: 'S10-3', kind: '정상', label: 'B 메모 복구 미리보기(승인된 기기)', skip: '패스키 기기 승인이 필요해 이 스크립트가 보낼 수 없음', expect: { status: 200 } },
  { stage: 11, id: 'S11-1', kind: '금지', label: 'B 로그인했지만 기기 확인 없이 메모 목록', method: 'GET', path: '/api/notes', auth: 'student', expect: { status: 403, error: 'DEVICE_CHECK_REQUIRED' } },
  { stage: 11, id: 'S11-2', kind: '금지', label: 'B 로그인 + 엉터리 기기 확인 값', method: 'GET', path: '/api/notes', auth: 'studentBadDevice', expect: { status: 403, error: 'DEVICE_CHECK_REQUIRED' } },
  { stage: 11, id: 'S11-3', kind: '정상', label: '설치형 웹앱 설정', method: 'GET', path: '/manifest.webmanifest', auth: 'none', expect: { status: 200 } },
  { stage: 11, id: 'S11-4', kind: '금지', label: '기기 승인 경로 GET', method: 'GET', path: '/api/devices/verify', auth: 'none', expect: { status: 405, error: 'METHOD_NOT_ALLOWED' } },
  { stage: 11, id: 'S11-5', kind: '정상', label: '승인된 기기에서 메모 목록', skip: '패스키 기기 승인이 필요해 이 스크립트가 보낼 수 없음(화면에서 확인)', expect: { status: 200 } },
  { stage: 12, id: 'S12-1', kind: '금지', label: '로그인 없이 작전실', method: 'GET', path: '/api/ops/summary', auth: 'none', expect: { status: 401, error: 'LOGIN_REQUIRED' } },
  { stage: 12, id: 'S12-2', kind: '금지', label: 'B 로그인했지만 기기 확인 없이 작전실', method: 'GET', path: '/api/ops/summary', auth: 'student', expect: { status: 403, error: 'DEVICE_CHECK_REQUIRED' } },
]);

// 6~9단계 비고: 로컬 판정기·탐지기에 가상 요청을 넣은 실제 결과(요청 아님).
async function localNote(name) {
  const { fixtureRequests } = await import('./fixture-7.mjs');
  const { decide } = await import('../src/decider.mjs');
  const { detect } = await import('../src/detect.mjs');
  const { normal, suspicious } = fixtureRequests();
  const brief = r => `${r?.decision}·${r?.reasonCode}`;
  const reads = n => Array.from({ length: n }, (_, i) => ({ at: new Date(Date.UTC(2026, 9, 1) + i * 2000).toISOString(), method: 'GET', identity: { sub: 'learner_fixture' } }));
  switch (name) {
    case 'deciderRegistered': return `로컬 판정기 ${brief(await decide(normal))}`;
    case 'deciderUnregistered': return `로컬 판정기 ${brief(await decide({ ...normal, deviceRegistered: false }))}`;
    case 'deciderStepUp': return `로컬 판정기 ${brief(await decide(suspicious))}`;
    case 'deciderNoteList': return `로컬 판정기 ${brief(await decide({ ...normal, route: 'GET /notes', path: '/notes' }))}`;
    case 'deciderNotice': return `로컬 판정기 ${brief(await decide({ ...normal, service: 'notices', method: 'PUT', route: 'PUT /notices/:id', path: '/notices/week3' }))}`;
    case 'detectBurst': { const out = detect(reads(121)); return `로컬 탐지기 ${out?.action}·${out?.reasonCode}`; }
    default: return '';
  }
}

function matches(expect, status, error, text) {
  if (expect.status !== undefined && status !== expect.status) return false;
  if (expect.error !== undefined && error !== expect.error) return false;
  if (expect.noKeys && /sb_publishable_|sb_secret_/u.test(text)) return false;
  return true;
}
const expectText = e => [e.status !== undefined ? `HTTP ${e.status}` : null, e.error, e.noKeys ? '키 0건' : null,
  e.decision ? `판정 ${e.decision}` : null, e.action ? `탐지 ${e.action}` : null].filter(Boolean).join(' ');

// session: { token } 또는 null. fetchImpl·now는 로컬 시험에서만 바꿉니다.
export async function runCases({ app, session = null, loginResult = null, fetchImpl = fetch, now = () => new Date(), withLocal = true } = {}) {
  const rows = [];
  for (const c of CASES) {
    const row = { stage: c.stage, id: c.id, kind: c.kind, label: c.label, expected: expectText(c.expect),
      actual: null, pass: null, requestId: '-', checkedAt: null, note: '' };
    if (c.local && withLocal) row.note = await localNote(c.local).catch(() => '로컬 실행 오류');
    if (c.skip) { row.actual = `미실행: ${c.skip}`; rows.push(row); continue; }
    if (c.login) {
      if (!loginResult) { row.actual = '미실행: --login 없이 실행해 로그인하지 않음'; rows.push(row); continue; }
      Object.assign(row, loginResult, { pass: loginResult.status === c.expect.status, actual: `HTTP ${loginResult.status}` });
      delete row.status;
      rows.push(row);
      continue;
    }
    if ((c.auth === 'student' || c.auth === 'studentBadDevice') && !session) {
      row.actual = '미실행: --login 없이 실행해 B 로그인 토큰이 없음';
      rows.push(row);
      continue;
    }
    const headers = {};
    if (c.auth === 'forged') headers.Authorization = `Bearer ${forgedToken()}`;
    if (c.auth === 'student' || c.auth === 'studentBadDevice') headers.Authorization = `Bearer ${session.token}`;
    if (c.auth === 'studentBadDevice') headers['X-Vault-Device'] = 'not-a-device-check.value';
    if (c.body !== undefined) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetchImpl(new URL(c.path, app), { method: c.method, headers,
        body: c.body === undefined ? undefined : JSON.stringify(c.body), redirect: 'error', signal: AbortSignal.timeout(15000) });
      row.checkedAt = now().toISOString();
      const text = await response.text().catch(() => '');
      let error = null;
      try { const data = JSON.parse(text); if (typeof data?.error === 'string') error = data.error; } catch { /* JSON이 아닌 응답 */ }
      row.requestId = response.headers.get('x-request-id') ?? '-';
      row.actual = `HTTP ${response.status}${error ? ` ${error}` : ''}${c.expect.noKeys ? `, 키 모양 ${(text.match(/sb_publishable_|sb_secret_/gu) ?? []).length}건` : ''}`;
      row.pass = matches(c.expect, response.status, error, text);
    } catch (err) {
      row.checkedAt = now().toISOString();
      row.actual = `요청 실패: ${String(err?.name ?? 'Error').slice(0, 40)}`;
      row.pass = false;
    }
    rows.push(row);
  }
  return rows;
}

export function toMarkdown(rows) {
  const lines = ['| 단계 | 번호 | 구분 | 요청 | 기대 결과 | 실제 API 결과 | 일치 | 요청 ID | 확인 시각 | 비고 |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) {
    lines.push(`| ${r.stage} | ${r.id} | ${r.kind} | ${r.label} | ${r.expected} | ${r.actual} | ${r.pass === null ? '-' : r.pass ? '예' : '아니오'} | ${r.requestId} | ${r.checkedAt ?? '-'} | ${r.note || ''} |`);
  }
  return lines.join('\n');
}

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(question)).trim(); } finally { rl.close(); }
}
function askHidden(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error('비밀번호를 숨겨 입력할 수 있는 터미널에서 실행해 주세요.');
  stdout.write(prompt);
  return new Promise((resolveValue, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = error => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error); else resolveValue(value);
    };
    const onData = chunk => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') return done(new Error('입력을 취소했습니다.'));
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const app = new URL(config.publicAppUrl);
  console.log(`대상 배포: ${app.origin} (이메일·비밀번호·토큰·메모 내용은 출력하지 않습니다)`);
  let deployed = null;
  try {
    const identity = await (await fetch(new URL('/aleph.json', app), { redirect: 'error', signal: AbortSignal.timeout(15000) })).json();
    deployed = { commit: identity?.commit ?? null, step: identity?.step ?? null };
  } catch { /* 못 읽으면 null로 남깁니다. */ }
  console.log(`배포된 커밋: ${deployed?.commit ? deployed.commit.slice(0, 7) : '읽지 못함'}, step ${deployed?.step ?? '읽지 못함'}`);
  let session = null;
  let loginResult = null;
  if (process.argv.includes('--login')) {
    const email = await ask('B 계정 이메일: ');
    let password = await askHidden('B 계정 비밀번호(화면에 보이지 않음): ');
    const response = await fetch(new URL('/api/auth/login', app), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    password = '';
    const data = await response.json().catch(() => null);
    loginResult = { status: response.status, checkedAt: new Date().toISOString() };
    if (response.ok && typeof data?.access_token === 'string') session = { token: data.access_token };
  }
  const rows = await runCases({ app, session, loginResult });
  if (session) {
    await fetch(new URL('/api/auth/logout', app), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` }, body: '{}' }).catch(() => null);
    session = null;
  }
  console.log(toMarkdown(rows));
  const sent = rows.filter(r => r.checkedAt);
  console.log(`\n보낸 요청 ${sent.length}개, 기대와 일치 ${sent.filter(r => r.pass).length}개, 미실행 ${rows.length - sent.length}개. 학생 실측이며 심판 판정이 아닙니다.`);
  mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../artifacts/ops-verify-result.json', import.meta.url), `${JSON.stringify({
    schema: 'aleph.student.ops-verify-result.v1', ranAt: new Date().toISOString(), target: deployed, rows,
  }, null, 2)}\n`);
  console.log('결과 파일: artifacts/ops-verify-result.json (Git 제외)');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`첫 오류: ${error.message}`);
    process.exitCode = 1;
  });
}
