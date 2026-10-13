// 10단계 실제 배포 복구 확인입니다. 학생 설계(계약에 없음). 학생이 자기 터미널에서 직접 실행합니다.
//   npm run restore:live-check
// B 계정으로 로그인해 B 메모 한 건을 앱 API로 변조·삭제하고 POST /api/restores/:id로 되살린 뒤,
// 내용 해시가 처음과 같은지 확인합니다. A 메모는 건드리지 않습니다(B 로그인으로 보이는 B 메모 한 건만 씀).
// - 이메일·비밀번호는 실행할 때 물어보고 메모리에만 둡니다. 비밀번호는 화면에 보이지 않습니다.
// - 로그인은 앱의 POST /api/auth/login으로 합니다. 그래서 publishable key가 필요 없습니다.
// - 파일을 쓰지 않습니다. 출력에는 상태 코드, 일치 여부, id 앞 8자만 넣습니다.
//   메모 제목·내용, 해시, 토큰, 이메일은 출력하지 않습니다.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { noteSha256 } from '../src/content-hash.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const app = new URL(config.publicAppUrl);
const TAMPER_MARK = '\n[restore-live-check 변조 시험]';
const short = id => String(id).slice(0, 8);
let chosenId = null;

async function askEmail() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question('B 계정 이메일: ')).trim(); } finally { rl.close(); }
}

// 입력한 글자를 화면에 되돌려 쓰지 않습니다.
function askHidden(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) throw new Error('비밀번호를 숨겨 입력할 수 있는 터미널에서 실행해 주세요.');
  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = '';
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const done = error => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      stdout.write('\n');
      if (error) reject(error); else resolve(value);
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

async function call(method, path, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(new URL(path, app), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

const results = [];
function record(label, pass, detail) {
  results.push(pass);
  console.log(`${pass ? '통과' : '확인 필요'} · ${label} — ${detail}`);
  return pass;
}

async function currentHash(token, id) {
  const got = await call('GET', `/api/notes/${id}`, { token });
  if (got.status !== 200 || typeof got.data?.title !== 'string' || typeof got.data?.body !== 'string') {
    return { status: got.status, hash: null };
  }
  return { status: got.status, hash: noteSha256(got.data.title, got.data.body) };
}

async function main() {
  console.log(`대상 배포: ${app.origin} (이메일·비밀번호·메모 내용·토큰은 출력하지 않습니다)`);
  const email = await askEmail();
  let password = await askHidden('B 계정 비밀번호(화면에 보이지 않음): ');
  const login = await call('POST', '/api/auth/login', { body: { email, password } });
  password = '';
  const token = typeof login.data?.access_token === 'string' ? login.data.access_token : null;
  if (!record('B 로그인', login.status === 200 && token, `HTTP ${login.status}`)) return;

  let original = null;
  let state = 'clean';
  try {
    const list = await call('GET', '/api/notes', { token });
    const notes = Array.isArray(list.data) ? list.data : [];
    if (!record('B 메모 목록', list.status === 200 && notes.length > 0, `HTTP ${list.status}, ${notes.length}건`)) return;
    const id = notes[0].id;
    chosenId = id;
    const first = await call('GET', `/api/notes/${id}`, { token });
    if (!record(`메모 ${short(id)} 처음 읽기`, first.status === 200, `HTTP ${first.status}`)) return;
    original = { title: first.data.title, body: first.data.body };
    const startHash = noteSha256(original.title, original.body);

    // 사본이 지금 내용과 같은지 먼저 봅니다. 다르면 아래 시험이 B의 정상 수정을 되돌리게 되므로 멈춥니다.
    const pre = await call('POST', `/api/restores/${id}`, { token });
    const preSame = pre.status === 200 && pre.data?.sha256 === startHash && pre.data?.matched === true;
    if (!record('사본과 지금 내용 일치(시험 전)', preSame, `HTTP ${pre.status}, 일치 ${preSame}`)) {
      if (pre.status === 200 && pre.data?.sha256 !== startHash) state = 'tampered';
      return;
    }

    state = 'tampered';
    const tamper = await call('PUT', `/api/notes/${id}`, { token, body: { title: original.title, body: original.body + TAMPER_MARK } });
    const afterTamper = await currentHash(token, id);
    record('앱 API로 변조(PUT)', tamper.status === 200 && afterTamper.hash !== startHash,
      `HTTP ${tamper.status}, 내용이 처음과 다름 ${afterTamper.hash !== startHash}`);

    const restored1 = await call('POST', `/api/restores/${id}`, { token });
    const check1 = await currentHash(token, id);
    const same1 = check1.hash === startHash;
    record('변조 뒤 복구', restored1.status === 200 && restored1.data?.matched === true && same1,
      `HTTP ${restored1.status}, matched ${restored1.data?.matched}, 다시 읽기 HTTP ${check1.status}, 처음과 같음 ${same1}`);
    if (same1) state = 'clean';

    const removed = await call('DELETE', `/api/notes/${id}`, { token });
    const gone = await call('GET', `/api/notes/${id}`, { token });
    state = 'deleted';
    record('앱 API로 삭제(DELETE)', removed.status === 200 && gone.status === 404,
      `HTTP ${removed.status}, 삭제 뒤 GET HTTP ${gone.status}`);

    const restored2 = await call('POST', `/api/restores/${id}`, { token });
    const check2 = await currentHash(token, id);
    const same2 = check2.hash === startHash;
    record('삭제 뒤 복구', restored2.status === 200 && restored2.data?.matched === true && same2,
      `HTTP ${restored2.status}, matched ${restored2.data?.matched}, 다시 읽기 HTTP ${check2.status}, 처음과 같음 ${same2}`);
    if (same2) state = 'clean';

    const anonymous = await call('POST', `/api/restores/${id}`);
    record('로그인 없이 복구', anonymous.status === 401, `HTTP ${anonymous.status} (기대 401)`);
    const missing = await call('POST', `/api/restores/${randomUUID()}`, { token });
    record('없는 id 복구', missing.status === 404, `HTTP ${missing.status} (기대 404)`);
  } finally {
    // 시험 중 멈췄다면 한 번 더 복구를 부르고, 그래도 안 되면 메모리의 처음 내용으로 되돌립니다.
    if (state !== 'clean' && original) {
      console.log('시험이 중간에 멈춰 메모를 되돌립니다.');
      await putBack(token, original);
    }
    const out = await call('POST', '/api/auth/logout', { token, body: {} });
    console.log(`로그아웃 HTTP ${out.status}`);
  }
}

async function putBack(token, original) {
  if (!chosenId) return;
  const again = await call('POST', `/api/restores/${chosenId}`, { token });
  if (again.status === 200 && again.data?.matched === true
      && (await currentHash(token, chosenId)).hash === noteSha256(original.title, original.body)) {
    console.log(`되돌림: 복구 HTTP ${again.status}`);
    return;
  }
  const exists = await call('GET', `/api/notes/${chosenId}`, { token });
  const fix = exists.status === 200
    ? await call('PUT', `/api/notes/${chosenId}`, { token, body: original })
    : await call('POST', '/api/notes', { token, body: { id: chosenId, ...original } });
  console.log(`되돌림: 복구 HTTP ${again.status}, 처음 내용으로 다시 쓰기 HTTP ${fix.status}`);
}

try {
  await main();
} catch (error) {
  results.push(false);
  console.error(`첫 오류: ${String(error?.message).slice(0, 120)}`);
}
const failed = results.filter(pass => !pass).length;
console.log(failed ? `확인 필요 ${failed}개` : `모두 통과 (${results.length}개)`);
process.exitCode = failed ? 1 : 0;
