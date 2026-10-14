// 10단계 시험 정책 비교·복원입니다. 학생 설계(계약에 없음).
// 다루는 파일은 policy/ 안의 세 개뿐입니다. 운영 판정기(src/decider.mjs), DB 권한, supabase/*.sql은 읽거나 쓰지 않습니다.
//   policy/test-policy.json           가상 시험 정책(서비스별 규칙 + 감사 이력). 운영 판정기가 아닙니다.
//   policy/safe-policy.json           침해 전에 검증한 안전 정책 사본(revision, verifiedAt)
//   policy/safe-policy.manifest.json  사본 파일 이름, revision, verifiedAt, LF로 맞춘 내용의 sha256
//
//   npm run policy:diff                                 사본을 검증하고 서비스별로 바뀔 항목만 보여 줍니다. 아무것도 쓰지 않습니다.
//   npm run policy:restore -- --service <이름>           미리보기만 합니다.
//   npm run policy:restore -- --service <이름> --confirm 다시 검증한 뒤 그 서비스 규칙 하나만 사본 값으로 바꾸고 감사 한 줄을 덧붙입니다.
// 사본·manifest가 없거나 sha256·revision이 다르면 "복원을 중단합니다"로 종료 코드 1입니다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const POLICY_DIR = join(root, 'policy');
const TEST_FILE = 'test-policy.json';
const SAFE_FILE = 'safe-policy.json';
const MANIFEST_FILE = 'safe-policy.manifest.json';
const SCHEMAS = {
  test: 'aleph.student.test-policy.v1',
  safe: 'aleph.student.safe-policy.v1',
  manifest: 'aleph.student.safe-policy-manifest.v1',
};
// 운영 판정기 미변경 확인의 기준: 9단계 판정을 받은 커밋입니다. 이 파일은 판정기를 읽기만 합니다.
const DECIDER_BASELINE_COMMIT = '23fce0dd347ff7fa017402d2845bae46f543f300';

export class PolicyAbort extends Error {}
const abort = message => { throw new PolicyAbort(message); };

// 줄바꿈을 LF로 맞춘 내용의 sha256입니다. PC마다 CRLF로 바뀌어도 같은 값이 나옵니다.
export const lfSha256 = text => createHash('sha256').update(String(text).replace(/\r\n/gu, '\n'), 'utf8').digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// 키 순서와 무관하게 비교하기 위한 정렬된 JSON입니다.
const canonical = value => JSON.stringify(value, (key, item) => (isObject(item)
  ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item));
const same = (a, b) => canonical(a) === canonical(b);
const show = value => (value === undefined ? '(없음)' : JSON.stringify(value));

function readText(dir, file, missing) {
  const path = join(dir, file);
  if (!existsSync(path)) abort(missing);
  return readFileSync(path, 'utf8');
}
function parse(text, file) {
  try { return JSON.parse(text); } catch { return abort(`${file}을 JSON으로 읽을 수 없습니다.`); }
}

// 사본·manifest·시험 정책을 읽고 검증합니다. 하나라도 틀리면 중단합니다.
export function loadVerified(dir = POLICY_DIR) {
  const manifestText = readText(dir, MANIFEST_FILE, `manifest가 없습니다(policy/${MANIFEST_FILE}).`);
  const manifest = parse(manifestText, MANIFEST_FILE);
  if (manifest?.schema !== SCHEMAS.manifest || manifest.file !== SAFE_FILE
      || !/^[0-9a-f]{64}$/u.test(manifest.sha256 ?? '') || !Number.isInteger(manifest.revision)
      || Number.isNaN(Date.parse(manifest.verifiedAt ?? ''))) {
    abort(`manifest 형식이 아닙니다(policy/${MANIFEST_FILE}).`);
  }
  const safeText = readText(dir, SAFE_FILE, `안전 정책 사본이 없습니다(policy/${SAFE_FILE}).`);
  const safeSha256 = lfSha256(safeText);
  if (safeSha256 !== manifest.sha256) abort(`사본 sha256이 manifest와 다릅니다(사본 ${safeSha256.slice(0, 12)}, manifest ${manifest.sha256.slice(0, 12)}).`);
  const safe = parse(safeText, SAFE_FILE);
  if (safe?.schema !== SCHEMAS.safe || !isObject(safe.services)) abort('안전 정책 사본 형식이 아닙니다.');
  if (safe.revision !== manifest.revision) abort(`사본 revision(${show(safe.revision)})이 manifest(${manifest.revision})와 다릅니다.`);
  if (safe.verifiedAt !== manifest.verifiedAt) abort('사본 verifiedAt이 manifest와 다릅니다.');
  const testText = readText(dir, TEST_FILE, `시험 정책이 없습니다(policy/${TEST_FILE}).`);
  const test = parse(testText, TEST_FILE);
  if (test?.schema !== SCHEMAS.test || !isObject(test.services) || !Array.isArray(test.audit)) abort('시험 정책 형식이 아닙니다.');
  return {
    manifest, safe, test, safeSha256,
    fingerprint: [manifestText, safeText, testText].map(lfSha256).join(':'),
    testText,
  };
}

// 서비스 하나의 바뀔 항목(지금 값 → 사본 값)입니다.
export function changesFor(test, safe, service) {
  const now = isObject(test.services[service]) ? test.services[service] : {};
  const want = safe.services[service];
  return [...new Set([...Object.keys(now), ...Object.keys(want)])].sort()
    .filter(key => !same(now[key], want[key]))
    .map(key => ({ key, from: now[key], to: want[key] }));
}

// 가상 시험 정책에서 메모 요청이 허용인지 거부인지 봅니다. 운영 판정기와는 따로 계산합니다.
// 등록 기기·추가 확인은 통과한 요청으로 보고 notes 규칙만 봅니다. 값이 없으면 거부 쪽으로 봅니다.
export function notesDecision(policy, { actor, owner, method = 'GET', list = false }) {
  const notes = policy?.services?.notes;
  if (!isObject(notes)) return 'deny';
  if (list) return notes.listAllowed === true ? 'allow' : 'deny';
  if (!Array.isArray(notes.itemMethods) || !notes.itemMethods.includes(method)) return 'deny';
  if (notes.ownerOnly !== false && actor !== owner) return 'deny';
  return 'allow';
}
const bReadsA = policy => notesDecision(policy, { actor: 'B', owner: 'A' });
const label = decision => (decision === 'allow' ? '허용' : '거부');

// 운영 판정기 src/decider.mjs가 9단계 판정 커밋과 같은지 봅니다(읽기만 함).
export function operationalDeciderCheck() {
  const nowSha = lfSha256(readFileSync(join(root, 'src', 'decider.mjs'), 'utf8'));
  let baseSha = null;
  try {
    baseSha = lfSha256(execFileSync('git', ['-C', root, 'show', `${DECIDER_BASELINE_COMMIT}:src/decider.mjs`], { encoding: 'utf8', windowsHide: true }));
  } catch { /* 기준 커밋을 못 읽으면 같다고 하지 않습니다. */ }
  return { same: baseSha !== null && nowSha === baseSha, sha256: nowSha, baseline: DECIDER_BASELINE_COMMIT.slice(0, 7) };
}

export function diffReport(dir = POLICY_DIR) {
  const { manifest, safe, test, safeSha256 } = loadVerified(dir);
  const services = Object.keys(safe.services).map(service => ({ service, changes: changesFor(test, safe, service) }));
  const lines = [
    `안전 정책 사본 검증 통과: policy/${SAFE_FILE} sha256 ${safeSha256.slice(0, 12)}, manifest와 같음`,
    `복원할 버전: revision ${manifest.revision} (검증 시각 ${manifest.verifiedAt})`,
    '서비스별 바뀔 항목 (지금 값 → 사본 값):',
  ];
  for (const { service, changes } of services) {
    lines.push(`  ${service}: ${changes.length ? `${changes.length}개` : '없음'}`);
    for (const { key, from, to } of changes) lines.push(`    ${key}: ${show(from)} → ${show(to)}`);
  }
  const total = services.reduce((sum, item) => sum + item.changes.length, 0);
  lines.push(`B가 A 메모 읽기(GET /notes/:id): 지금 시험 정책 ${label(bReadsA(test))}, 사본 정책 ${label(bReadsA(safe))}`);
  lines.push('아무것도 쓰지 않았습니다.');
  return { lines, total, services, revision: manifest.revision, verifiedAt: manifest.verifiedAt };
}

// 지정한 서비스 하나만 사본 값으로 되돌립니다. confirm이 없으면 미리보기만 합니다.
// onPreviewed는 시험에서 미리보기와 쓰기 사이에 파일을 바꿔 보려고 넣는 자리입니다.
export function restorePolicy({ dir = POLICY_DIR, service, confirm = false, now = () => new Date().toISOString(), onPreviewed } = {}) {
  if (typeof service !== 'string' || !service) abort('--service <이름>으로 복원할 서비스 하나를 정해 주세요.');
  const first = loadVerified(dir);
  if (!Object.hasOwn(first.safe.services, service)) abort(`사본에 없는 서비스입니다: ${service}`);
  const changes = changesFor(first.test, first.safe, service);
  const lines = [
    `복원할 버전: revision ${first.manifest.revision} (검증 시각 ${first.manifest.verifiedAt}), 사본 sha256 ${first.safeSha256.slice(0, 12)}`,
    `${service}의 바뀔 항목 ${changes.length}개 (지금 값 → 사본 값):`,
    ...changes.map(({ key, from, to }) => `  ${key}: ${show(from)} → ${show(to)}`),
    `다른 서비스(${Object.keys(first.test.services).filter(name => name !== service).join(', ') || '없음'})와 감사 이력 ${first.test.audit.length}줄은 그대로 둡니다.`,
  ];
  if (!confirm || !changes.length) {
    lines.push(changes.length ? '미리보기입니다. 아무것도 쓰지 않았습니다. 쓰려면 --confirm을 붙이세요.' : '바뀔 항목이 없어 쓰지 않았습니다.');
    return { lines, written: false, changes };
  }
  onPreviewed?.();
  // 쓰기 직전에 세 파일을 다시 읽어 검증하고, 미리보기 때와 하나라도 다르면 멈춥니다.
  const again = loadVerified(dir);
  if (again.fingerprint !== first.fingerprint) abort('미리보기 뒤 사본·manifest·시험 정책이 바뀌었습니다.');
  const before = again.test;
  const entry = {
    at: now(), event: 'restore', service, revision: again.manifest.revision,
    safeSha256: again.safeSha256, changed: changes.map(item => item.key),
  };
  const next = {
    ...before,
    services: { ...before.services, [service]: structuredClone(again.safe.services[service]) },
    audit: [...before.audit, entry],
  };
  const path = join(dir, TEST_FILE);
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  // 쓴 뒤 다시 읽어 확인합니다. 틀리면 쓰기 전 내용으로 되돌리고 멈춥니다.
  const after = parse(readFileSync(path, 'utf8'), TEST_FILE);
  const others = Object.keys(before.services).filter(name => name !== service);
  const checks = {
    target: same(after.services?.[service], again.safe.services[service]),
    others: others.every(name => same(after.services?.[name], before.services[name]))
      && Object.keys(after.services ?? {}).sort().join() === [...new Set([...Object.keys(before.services), service])].sort().join(),
    audit: Array.isArray(after.audit) && after.audit.length === before.audit.length + 1
      && same(after.audit.slice(0, before.audit.length), before.audit) && same(after.audit.at(-1), entry),
  };
  if (!checks.target || !checks.others || !checks.audit) {
    writeFileSync(path, again.testText);
    abort(`쓴 뒤 확인이 틀려 쓰기 전 내용으로 되돌렸습니다(${JSON.stringify(checks)}).`);
  }
  lines.push(`썼습니다: ${service}만 사본 값으로 바꾸고 감사 한 줄을 덧붙였습니다.`);
  lines.push(`쓴 뒤 확인: 대상 서비스는 사본과 같음 ${checks.target}, 다른 서비스 그대로 ${checks.others}, 이전 감사 이력 그대로 ${checks.audit} (${before.audit.length}줄 → ${after.audit.length}줄)`);
  lines.push(`B가 A 메모 읽기(GET /notes/:id): 이제 시험 정책 ${label(bReadsA(after))}`);
  return { lines, written: true, changes, entry };
}

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (rest.includes('--apply')) abort('--apply는 없앴습니다. 운영 판정기·SQL을 덮어쓰지 않습니다. --service <이름> --confirm을 쓰세요.');
    // --dir은 시험(test/policy.test.mjs)에서 임시 폴더를 가리킬 때만 씁니다.
    const dir = argValue(rest, '--dir') ?? POLICY_DIR;
    if (command === 'diff') console.log(diffReport(dir).lines.join('\n'));
    else if (command === 'restore') {
      console.log(restorePolicy({ dir, service: argValue(rest, '--service'), confirm: rest.includes('--confirm') }).lines.join('\n'));
    } else abort('사용법: node scripts/policy.mjs diff | restore --service <이름> [--confirm]');
  } catch (error) {
    console.error(`복원을 중단합니다: ${error.message}`);
    process.exitCode = 1;
  }
}
