// 10단계 실제 배포 복구 확인입니다. 학생 설계(계약에 없음). 학생이 자기 터미널에서 직접 실행합니다.
//   npm run restore:live-check
// B 계정으로 로그인해 시험용 가상 메모를 새로 만들고(생성 직후 서버가 사본 봉인을 남김), 그 메모를 앱 API로
// 변조·삭제한 뒤 POST /api/notes/:id/restore로 되살려 내용 해시가 처음과 같은지 확인합니다. 시험 메모는 끝나도 남겨 둡니다.
// 기존 B 메모(id 앞 8자 9b10ccba)는 봉인이 없으므로 복구가 409(backup.sealed false)인지 한 번만 봅니다(쓰지 않음).
// A 메모는 건드리지 않습니다.
// 복원마다 먼저 {"dryRun": true}로 미리보기(버전·바뀔 항목)를 받고, 아무것도 안 바뀌었는지 본 뒤 복원합니다.
// - 이메일·비밀번호는 실행할 때 물어보고 메모리에만 둡니다. 비밀번호는 화면에 보이지 않습니다.
// - 로그인은 앱의 POST /api/auth/login으로 합니다. 그래서 publishable key가 필요 없습니다.
// - 출력에는 상태 코드, 일치 여부, id 앞 8자만 넣습니다. 메모 제목·내용, 해시, 토큰, 이메일은 출력하지 않습니다.
// - 끝나면 artifacts/restore-live-result.json(Git 제외)에 실행 시각, 대상 커밋(배포된 /aleph.json의 commit),
//   단계별 상태 코드·통과 여부·backup.verified·changes·audit id 개수만 저장합니다. 내용·토큰·이메일·해시는 넣지 않습니다.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { noteSha256 } from '../src/content-hash.mjs';

const config = JSON.parse(readFileSync(new URL('../aleph.config.json', import.meta.url), 'utf8'));
const app = new URL(config.publicAppUrl);
const TAMPER_MARK = '\n[restore-live-check 변조 시험]';
// 시험용 가상 메모(실제 정보 아님). 봉인은 서버가 생성 직후에 남깁니다.
const TEST_NOTE = { title: 'live-check 시험 메모', body: 'live-check 시험 메모입니다. 복구 시험용 가상 문장이며 실제 정보가 아닙니다.' };
// 봉인 도입 전에 만든 기존 B 메모의 id 앞 8자(봉인 없음 → 409 확인용).
const LEGACY_PREFIX = '9b10ccba';
const short = id => String(id).slice(0, 8);
// 복구 응답의 검증 표시: backup.verified, 사본 해시와 다시 계산한 해시가 같음, 다시 읽은 시각, version이 있음.
const verifiedBackup = data => data?.backup?.verified === true && data.backup.sealed === true && typeof data.backup.version === 'string'
  && data.backup.sha256 === data.backup.recomputedSha256 && data.backup.sha256 === data.sha256
  && !Number.isNaN(Date.parse(data.backup.rereadAt ?? ''));
const changesOf = data => (Array.isArray(data?.changes) ? data.changes : []);
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

// 단계 기록: 이름, 상태 코드, 통과 여부와 응답의 backup.verified·changes·audit id 개수만 남깁니다.
const results = [];
const auditCount = data => Object.values(data?.audit ?? {}).filter(value => value !== null && value !== undefined).length;
function record(label, pass, detail, response = null) {
  const step = { step: label, pass: Boolean(pass) };
  if (response) {
    step.status = response.status;
    if (typeof response.data?.backup?.verified === 'boolean') step.backupVerified = response.data.backup.verified;
    const changes = response.data?.plan?.changes ?? response.data?.changes;
    if (Array.isArray(changes)) step.changes = changes.filter(item => typeof item === 'string').slice(0, 5);
    if (response.data?.audit) step.auditIds = auditCount(response.data);
  }
  results.push(step);
  console.log(`${pass ? '통과' : '확인 필요'} · ${label} — ${detail}`);
  return pass;
}

// 미리보기: 사본 검증 표시, 아무것도 복원하지 않음, 미리보기 감사 id 하나, 바뀔 항목이 기대와 같음.
const previewOk = (res, startHash, beforeHash, expected) => res.status === 200 && res.data?.dryRun === true
  && res.data.restored === false && verifiedBackup({ ...res.data, sha256: res.data.plan?.backupSha256 })
  && typeof res.data.plan?.version === 'string' && res.data.plan.backupSha256 === startHash
  && res.data.plan.beforeSha256 === beforeHash
  && JSON.stringify(res.data.plan.changes) === JSON.stringify(expected) && auditCount(res.data) === 1;
// 복원: 시작 줄과 결과 줄 id가 둘 다 있고 시작이 먼저입니다.
const auditPair = data => data?.audit?.startId != null && data?.audit?.resultId != null
  && Number(data.audit.startId) < Number(data.audit.resultId);
const previewDetail = res => `HTTP ${res.status}, dryRun ${res.data?.dryRun}, backup.verified ${res.data?.backup?.verified}, `
  + `changes [${(res.data?.plan?.changes ?? []).join(',')}], restored ${res.data?.restored}${res.data?.error ? `, ${res.data.error}` : ''}`;

async function currentHash(token, id) {
  const got = await call('GET', `/api/notes/${id}`, { token });
  if (got.status !== 200 || typeof got.data?.title !== 'string' || typeof got.data?.body !== 'string') {
    return { status: got.status, hash: null };
  }
  return { status: got.status, hash: noteSha256(got.data.title, got.data.body) };
}

// 시험한 배포의 커밋: 배포된 /aleph.json의 commit(공개 정보)입니다. 못 읽으면 null로 남깁니다.
let targetCommit = null;
async function readDeployedCommit() {
  try {
    const got = await call('GET', '/aleph.json');
    return typeof got.data?.commit === 'string' && /^[0-9a-f]{40}$/u.test(got.data.commit) ? got.data.commit : null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`대상 배포: ${app.origin} (이메일·비밀번호·메모 내용·토큰은 출력하지 않습니다)`);
  targetCommit = await readDeployedCommit();
  console.log(`배포된 커밋: ${targetCommit ? targetCommit.slice(0, 7) : '읽지 못함'}`);
  const email = await askEmail();
  let password = await askHidden('B 계정 비밀번호(화면에 보이지 않음): ');
  const login = await call('POST', '/api/auth/login', { body: { email, password } });
  password = '';
  const token = typeof login.data?.access_token === 'string' ? login.data.access_token : null;
  if (!record('B 로그인', login.status === 200 && token, `HTTP ${login.status}`, { status: login.status })) return;

  let original = null;
  let state = 'clean';
  try {
    const list = await call('GET', '/api/notes', { token });
    const notes = Array.isArray(list.data) ? list.data : [];
    if (!record('B 메모 목록', list.status === 200 && notes.length > 0, `HTTP ${list.status}, ${notes.length}건`, { status: list.status })) return;

    // 기존 메모(봉인 없음): 복구를 불러도 봉인 검증에서 쓰기 전에 멈춰 409여야 합니다.
    const legacy = notes.find(note => typeof note?.id === 'string' && note.id.startsWith(LEGACY_PREFIX));
    if (legacy) {
      const old = await call('POST', `/api/notes/${legacy.id}/restore`, { token });
      record(`기존 메모 ${LEGACY_PREFIX} 복구(봉인 없음)`, old.status === 409 && old.data?.backup?.sealed === false && old.data?.restored === false,
        `HTTP ${old.status} (기대 409), backup.sealed ${old.data?.backup?.sealed}, restored ${old.data?.restored}`, old);
    } else {
      record(`기존 메모 ${LEGACY_PREFIX} 복구(봉인 없음)`, false, '목록에 없어 미실행', null);
    }

    // 시험용 가상 메모를 새로 만듭니다. 서버가 생성 직후 사본 봉인을 남깁니다.
    const created = await call('POST', '/api/notes', { token, body: TEST_NOTE });
    const id = typeof created.data?.id === 'string' ? created.data.id : null;
    if (!record('시험 메모 만들기', created.status === 201 && id, `HTTP ${created.status}${id ? `, id ${short(id)}` : ''}`, { status: created.status })) return;
    chosenId = id;
    const first = await call('GET', `/api/notes/${id}`, { token });
    if (!record(`메모 ${short(id)} 처음 읽기`, first.status === 200, `HTTP ${first.status}`, { status: first.status })) return;
    original = { title: first.data.title, body: first.data.body };
    const startHash = noteSha256(original.title, original.body);
    const preview = () => call('POST', `/api/notes/${id}/restore`, { token, body: { dryRun: true } });

    // 미리보기로 사본이 지금 내용과 같은지 먼저 봅니다(아무것도 쓰지 않음).
    // 다르면 아래 시험이 B의 정상 수정을 되돌리게 되므로 멈춥니다.
    const pre = await preview();
    if (!record('미리보기: 사본과 지금 내용 일치(시험 전)', previewOk(pre, startHash, startHash, []), previewDetail(pre), pre)) return;

    state = 'tampered';
    const tamper = await call('PUT', `/api/notes/${id}`, { token, body: { title: original.title, body: original.body + TAMPER_MARK } });
    const afterTamper = await currentHash(token, id);
    record('앱 API로 변조(PUT)', tamper.status === 200 && afterTamper.hash !== startHash,
      `HTTP ${tamper.status}, 내용이 처음과 다름 ${afterTamper.hash !== startHash}`, { status: tamper.status });

    const preview1 = await preview();
    const stillTampered = (await currentHash(token, id)).hash === afterTamper.hash;
    record('미리보기: 변조 뒤(버전·바뀔 항목만, 쓰지 않음)', previewOk(preview1, startHash, afterTamper.hash, ['content']) && stillTampered,
      `${previewDetail(preview1)}, 미리보기 뒤에도 변조 그대로 ${stillTampered}`, preview1);

    const restored1 = await call('POST', `/api/notes/${id}/restore`, { token });
    const check1 = await currentHash(token, id);
    const same1 = check1.hash === startHash;
    record('변조 뒤 복구', restored1.status === 200 && restored1.data?.matched === true && same1
      && verifiedBackup(restored1.data) && restored1.data.restored === true && changesOf(restored1.data).includes('content')
      && auditPair(restored1.data),
      `HTTP ${restored1.status}, matched ${restored1.data?.matched}, backup.verified ${restored1.data?.backup?.verified}, `
      + `changes [${changesOf(restored1.data).join(',')}], 감사 시작·결과 ${auditPair(restored1.data)}, 다시 읽기 HTTP ${check1.status}, 처음과 같음 ${same1}`,
      restored1);
    if (same1) state = 'clean';

    const removed = await call('DELETE', `/api/notes/${id}`, { token });
    const gone = await call('GET', `/api/notes/${id}`, { token });
    state = 'deleted';
    record('앱 API로 삭제(DELETE)', removed.status === 200 && gone.status === 404,
      `HTTP ${removed.status}, 삭제 뒤 GET HTTP ${gone.status}`, { status: removed.status });

    const preview2 = await preview();
    const stillGone = (await call('GET', `/api/notes/${id}`, { token })).status === 404;
    record('미리보기: 삭제 뒤(버전·바뀔 항목만, 쓰지 않음)', previewOk(preview2, startHash, null, ['row_restored']) && stillGone,
      `${previewDetail(preview2)}, 미리보기 뒤에도 삭제 그대로 ${stillGone}`, preview2);

    const restored2 = await call('POST', `/api/notes/${id}/restore`, { token });
    const check2 = await currentHash(token, id);
    const same2 = check2.hash === startHash;
    record('삭제 뒤 복구', restored2.status === 200 && restored2.data?.matched === true && same2
      && verifiedBackup(restored2.data) && restored2.data.restored === true && changesOf(restored2.data).includes('row_restored')
      && auditPair(restored2.data),
      `HTTP ${restored2.status}, matched ${restored2.data?.matched}, backup.verified ${restored2.data?.backup?.verified}, `
      + `changes [${changesOf(restored2.data).join(',')}], 감사 시작·결과 ${auditPair(restored2.data)}, 다시 읽기 HTTP ${check2.status}, 처음과 같음 ${same2}`,
      restored2);
    if (same2) state = 'clean';

    const anonymous = await call('POST', `/api/notes/${id}/restore`);
    record('로그인 없이 복구', anonymous.status === 401, `HTTP ${anonymous.status} (기대 401)`, { status: anonymous.status });
    const missing = await call('POST', `/api/notes/${randomUUID()}/restore`, { token });
    record('없는 id 복구', missing.status === 404, `HTTP ${missing.status} (기대 404)`, missing);
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
  const again = await call('POST', `/api/notes/${chosenId}/restore`, { token });
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
  results.push({ step: '실행 오류', pass: false });
  console.error(`첫 오류: ${String(error?.message).slice(0, 120)}`);
}
const failed = results.filter(step => !step.pass).length;
console.log(failed ? `확인 필요 ${failed}개` : `모두 통과 (${results.length}개)`);
// 실제로 보낸 요청의 결과만 저장합니다. 실패해도 그대로 저장합니다(덮어씀).
try {
  const saved = {
    schema: 'aleph.student.restore-live-result.v1', ranAt: new Date().toISOString(), targetCommit,
    passed: results.length - failed, failed, steps: results,
  };
  mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../artifacts/restore-live-result.json', import.meta.url), `${JSON.stringify(saved, null, 2)}\n`);
  console.log('결과 저장: artifacts/restore-live-result.json (Git 제외)');
} catch (error) {
  console.error(`결과 저장 실패: ${String(error?.message).slice(0, 120)}`);
}
process.exitCode = failed ? 1 : 0;
