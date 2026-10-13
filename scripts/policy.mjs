// 10단계 안전 정책 사본과 차이 보기·되돌리기입니다. 학생 설계(계약에 없음).
//   npm run policy:snapshot -- <커밋>   정책 파일을 그 커밋 내용으로 policy/에 뜨고 sha256 목록(policy/manifest.json)을 만듭니다.
//   npm run policy:diff                사본을 검증하고, 복원할 커밋과 지금 파일과 다른 항목만 보여 줍니다.
//   npm run policy:restore [-- --apply] 기본은 미리보기. --apply일 때만 다른 정책 파일을 사본 내용으로 되돌립니다.
// 다루는 파일은 POLICY_FILES 목록뿐입니다. Vercel 설정, 배포된 DB, 다른 파일, 감사 기록은 건드리지 않습니다.
// supabase/*.sql을 되돌려도 저장소의 파일만 바뀝니다. DB에 적용하려면 SQL Editor에서 직접 실행해야 합니다.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const POLICY_DIR = join(root, 'policy');
const MANIFEST = join(POLICY_DIR, 'manifest.json');
const SCHEMA = 'aleph.student.policy-snapshot.v1';
// 정책 파일: 판정기 규칙과 vault_notes의 권한·RLS SQL
export const POLICY_FILES = Object.freeze([
  'src/decider.mjs',
  'supabase/notes.sql',
  'supabase/notes-write-grants.sql',
  'supabase/notes-rls.sql',
  'supabase/notes-revoke-direct.sql',
]);

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
// 사본 이름 끝에 .snapshot을 붙입니다. 사본이 .mjs·.sql로 읽혀 실행·검사 대상이 되지 않게 하기 위해서입니다. 해시는 내용 기준 그대로입니다.
const COPY_SUFFIX = '.snapshot';
const copyName = path => `files/${path}${COPY_SUFFIX}`;
const copyPath = path => join(POLICY_DIR, copyName(path));
const fail = message => { throw new Error(message); };
const git = (...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 4 * 1024 * 1024 });

function snapshot(commitArg) {
  if (!commitArg || !/^[0-9a-f]{7,40}$/iu.test(commitArg)) fail('사본을 뜰 커밋을 적어 주세요. 예: npm run policy:snapshot -- 23fce0d');
  const commit = git('rev-parse', '--verify', `${commitArg}^{commit}`).toString().trim();
  rmSync(join(POLICY_DIR, 'files'), { recursive: true, force: true });
  const files = POLICY_FILES.map(path => {
    const content = git('show', `${commit}:${path}`);
    mkdirSync(dirname(copyPath(path)), { recursive: true });
    writeFileSync(copyPath(path), content);
    return { path, copy: copyName(path), sha256: sha256(content), bytes: content.length };
  });
  const subject = git('log', '-1', '--format=%s', commit).toString().trim();
  writeFileSync(MANIFEST, `${JSON.stringify({ schema: SCHEMA, commit, subject, files }, null, 2)}\n`);
  console.log(`정책 사본을 떴습니다: 커밋 ${commit.slice(0, 7)} (${subject}), 파일 ${files.length}개 → policy/`);
}

// 사본이 없거나, 목록이 정책 파일과 다르거나, 사본 해시가 목록과 다르면 멈춥니다.
export function verifiedManifest() {
  if (!existsSync(MANIFEST)) fail('정책 사본이 없습니다(policy/manifest.json). 먼저 npm run policy:snapshot -- <커밋>을 실행하세요.');
  let manifest;
  try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); } catch { fail('policy/manifest.json을 읽을 수 없습니다.'); }
  if (manifest?.schema !== SCHEMA || !/^[0-9a-f]{40}$/u.test(manifest.commit ?? '') || !Array.isArray(manifest.files)) {
    fail('policy/manifest.json 형식이 아닙니다.');
  }
  const paths = manifest.files.map(file => file?.path);
  if (paths.length !== POLICY_FILES.length || POLICY_FILES.some(path => !paths.includes(path))) {
    fail('사본 목록이 정책 파일 목록과 다릅니다. 다른 파일은 되돌리지 않습니다.');
  }
  for (const file of manifest.files) {
    if (!/^[0-9a-f]{64}$/u.test(file.sha256 ?? '')) fail(`사본 목록의 해시 형식이 틀립니다: ${file.path}`);
    if (file.copy !== copyName(file.path)) fail(`사본 목록의 사본 이름이 틀립니다: ${file.path} (기대: policy/${copyName(file.path)})`);
    if (!existsSync(copyPath(file.path))) fail(`사본 파일이 없습니다: policy/${copyName(file.path)}`);
    if (sha256(readFileSync(copyPath(file.path))) !== file.sha256) fail(`사본 해시가 목록과 다릅니다: policy/${copyName(file.path)}`);
  }
  return manifest;
}

export function differences(manifest) {
  return manifest.files.flatMap(file => {
    const current = join(root, file.path);
    if (!existsSync(current)) return [{ path: file.path, now: '없음' }];
    const hash = sha256(readFileSync(current));
    return hash === file.sha256 ? [] : [{ path: file.path, now: hash.slice(0, 12) }];
  });
}

function showDiff(manifest, changed) {
  console.log(`사본 검증 통과: 복원할 버전은 커밋 ${manifest.commit.slice(0, 7)} (${manifest.subject ?? ''}), 파일 ${manifest.files.length}개`);
  if (!changed.length) {
    console.log('지금 파일과 다른 항목이 없습니다.');
    return;
  }
  console.log(`지금 파일과 다른 항목 ${changed.length}개:`);
  for (const item of changed) {
    const saved = manifest.files.find(file => file.path === item.path).sha256.slice(0, 12);
    console.log(`  ${item.path}  사본 ${saved} / 지금 ${item.now}`);
  }
}

function restore(apply) {
  const manifest = verifiedManifest();
  const changed = differences(manifest);
  showDiff(manifest, changed);
  if (!changed.length) return;
  if (!apply) {
    console.log('미리보기입니다. 아무 파일도 바꾸지 않았습니다. 되돌리려면 npm run policy:restore -- --apply');
    return;
  }
  for (const item of changed) {
    if (!POLICY_FILES.includes(item.path)) fail(`정책 파일이 아니어서 되돌리지 않습니다: ${item.path}`);
    writeFileSync(join(root, item.path), readFileSync(copyPath(item.path)));
    console.log(`  되돌림: ${item.path}`);
  }
  console.log('정책 파일만 되돌렸습니다. git diff로 확인하세요. supabase/*.sql은 DB에 자동 적용되지 않습니다.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === 'snapshot') snapshot(rest[0]);
    else if (command === 'diff') showDiff(...(m => [m, differences(m)])(verifiedManifest()));
    else if (command === 'restore') restore(rest.includes('--apply'));
    else fail('사용법: node scripts/policy.mjs snapshot <커밋> | diff | restore [--apply]');
  } catch (error) {
    console.error(`정책 사본 첫 오류: ${error.message}`);
    process.exitCode = 1;
  }
}
