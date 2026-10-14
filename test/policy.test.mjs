// 10단계 시험 정책 비교·복원(scripts/policy.mjs)의 로컬 시험입니다. 학생 설계(계약에 없음).
// 저장소의 policy/ 세 파일을 임시 폴더에 복사해 그 안에서만 읽고 씁니다. 저장소 파일과 운영 판정기는 건드리지 않습니다.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import {
  POLICY_DIR, PolicyAbort, diffReport, lfSha256, notesDecision, operationalDeciderCheck, restorePolicy,
} from '../scripts/policy.mjs';

const FILES = ['test-policy.json', 'safe-policy.json', 'safe-policy.manifest.json'];
const dirs = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true }); });

// 침해 상태(notes 세 항목이 바뀜)의 시험 정책으로 시작합니다. 저장소 파일이 이미 복원됐어도 같은 처음 상태를 만듭니다.
function workDir() {
  const dir = mkdtempSync(join(tmpdir(), 'policy-test-'));
  dirs.push(dir);
  for (const file of FILES) cpSync(join(POLICY_DIR, file), join(dir, file));
  const test = read(dir, 'test-policy.json');
  Object.assign(test.services.notes, { ownerOnly: false, listAllowed: true, itemMethods: ['GET', 'PUT', 'DELETE'] });
  test.audit = [{ at: '2026-10-14T00:00:00.000Z', event: 'simulated_breach', service: 'notes', changed: ['ownerOnly'] }];
  write(dir, 'test-policy.json', test);
  return dir;
}
const read = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
const write = (dir, file, value) => writeFileSync(join(dir, file), `${JSON.stringify(value, null, 2)}\n`);
const raw = dir => FILES.map(file => { try { return readFileSync(join(dir, file), 'utf8'); } catch { return null; } });
const NOW = () => '2026-10-14T09:00:00.000Z';

test('(가) policy:diff와 미리보기는 아무것도 쓰지 않음', () => {
  const dir = workDir();
  const before = raw(dir);
  const report = diffReport(dir);
  assert.equal(report.total, 3);
  assert.deepEqual(report.services.find(item => item.service === 'notes').changes.map(item => item.key),
    ['itemMethods', 'listAllowed', 'ownerOnly']);
  assert.ok(report.lines.includes('B가 A 메모 읽기(GET /notes/:id): 지금 시험 정책 허용, 사본 정책 거부'));
  const preview = restorePolicy({ dir, service: 'notes', now: NOW });
  assert.equal(preview.written, false);
  assert.equal(preview.changes.length, 3);
  assert.deepEqual(raw(dir), before);
});

test('(나) 지정 서비스만 복원, 다른 서비스·감사 이력 보존, B의 A 메모 읽기 거부·A 자기 메모 허용', () => {
  const dir = workDir();
  const before = read(dir, 'test-policy.json');
  const safe = read(dir, 'safe-policy.json');
  const manifest = read(dir, 'safe-policy.manifest.json');
  assert.equal(notesDecision(before, { actor: 'B', owner: 'A' }), 'allow');
  const result = restorePolicy({ dir, service: 'notes', confirm: true, now: NOW });
  assert.equal(result.written, true);
  const after = read(dir, 'test-policy.json');
  assert.deepEqual(after.services.notes, safe.services.notes);
  for (const name of Object.keys(before.services).filter(item => item !== 'notes')) {
    assert.deepEqual(after.services[name], before.services[name]);
  }
  assert.deepEqual(Object.keys(after.services).sort(), Object.keys(before.services).sort());
  assert.deepEqual(after.audit.slice(0, before.audit.length), before.audit);
  assert.deepEqual(after.audit.at(-1), {
    at: NOW(), event: 'restore', service: 'notes', revision: manifest.revision, safeSha256: manifest.sha256,
    changed: ['itemMethods', 'listAllowed', 'ownerOnly'],
  });
  assert.equal(after.audit.length, before.audit.length + 1);
  assert.equal(notesDecision(after, { actor: 'B', owner: 'A' }), 'deny');
  assert.equal(notesDecision(after, { actor: 'A', owner: 'A' }), 'allow');
  assert.equal(notesDecision(after, { actor: 'A', owner: 'A', method: 'DELETE' }), 'deny');
  assert.equal(notesDecision(after, { actor: 'A', list: true }), 'deny');
  // 사본·manifest는 바뀌지 않고, 다시 부르면 바뀔 항목이 없어 쓰지 않습니다.
  assert.deepEqual(read(dir, 'safe-policy.json'), safe);
  const again = restorePolicy({ dir, service: 'notes', confirm: true, now: NOW });
  assert.equal(again.written, false);
  assert.equal(read(dir, 'test-policy.json').audit.length, after.audit.length);
  assert.equal(diffReport(dir).total, 0);
});

test('(나) 다른 서비스를 지정하면 그 서비스만 바뀌고 notes 침해는 그대로', () => {
  const dir = workDir();
  const test = read(dir, 'test-policy.json');
  test.services.detect.burstLimitAbove = 1000;
  write(dir, 'test-policy.json', test);
  restorePolicy({ dir, service: 'detect', confirm: true, now: NOW });
  const after = read(dir, 'test-policy.json');
  assert.equal(after.services.detect.burstLimitAbove, 120);
  assert.deepEqual(after.services.notes, test.services.notes);
  assert.deepEqual(after.audit.at(-1).changed, ['burstLimitAbove']);
});

test('(다) manifest 없음·사본 없음·sha256 다름·revision 다름·없는 서비스는 중단, 아무것도 안 씀', () => {
  const cases = {
    'manifest 없음': dir => rmSync(join(dir, 'safe-policy.manifest.json')),
    '사본 없음': dir => rmSync(join(dir, 'safe-policy.json')),
    'sha256 다름': dir => {
      const safe = read(dir, 'safe-policy.json');
      safe.services.notes.ownerOnly = false;
      write(dir, 'safe-policy.json', safe);
    },
    'revision 다름(manifest)': dir => {
      const manifest = read(dir, 'safe-policy.manifest.json');
      manifest.revision += 1;
      write(dir, 'safe-policy.manifest.json', manifest);
    },
    'revision 다름(사본, sha256은 맞춤)': dir => {
      const safe = read(dir, 'safe-policy.json');
      safe.revision += 1;
      write(dir, 'safe-policy.json', safe);
      const manifest = read(dir, 'safe-policy.manifest.json');
      manifest.sha256 = lfSha256(readFileSync(join(dir, 'safe-policy.json'), 'utf8'));
      write(dir, 'safe-policy.manifest.json', manifest);
    },
  };
  for (const [name, breakIt] of Object.entries(cases)) {
    const dir = workDir();
    breakIt(dir);
    const before = raw(dir);
    assert.throws(() => diffReport(dir), PolicyAbort, name);
    assert.throws(() => restorePolicy({ dir, service: 'notes', confirm: true, now: NOW }), PolicyAbort, name);
    assert.deepEqual(raw(dir), before, name);
  }
  const dir = workDir();
  const before = raw(dir);
  assert.throws(() => restorePolicy({ dir, service: 'billing', confirm: true }), /사본에 없는 서비스/u);
  assert.throws(() => restorePolicy({ dir, confirm: true }), /--service/u);
  assert.deepEqual(raw(dir), before);
});

test('(다) CLI는 "복원을 중단합니다"로 종료 코드 1, --apply는 없음', () => {
  const dir = workDir();
  rmSync(join(dir, 'safe-policy.manifest.json'));
  const run = args => {
    try {
      execFileSync(process.execPath, ['scripts/policy.mjs', ...args, '--dir', dir], { encoding: 'utf8', stdio: 'pipe' });
      return { code: 0 };
    } catch (error) {
      return { code: error.status, stderr: error.stderr };
    }
  };
  for (const args of [['diff'], ['restore', '--service', 'notes', '--confirm']]) {
    const result = run(args);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /^복원을 중단합니다: manifest가 없습니다/u);
  }
  const ok = workDir();
  const apply = (() => {
    try { execFileSync(process.execPath, ['scripts/policy.mjs', 'restore', '--apply', '--dir', ok], { stdio: 'pipe' }); return 0; } catch (error) { return error.status; }
  })();
  assert.equal(apply, 1);
});

test('(라) 미리보기 뒤 사본이나 시험 정책이 바뀌면 쓰지 않고 중단', () => {
  const mutations = {
    '시험 정책 감사 줄 추가': dir => {
      const test = read(dir, 'test-policy.json');
      test.audit.push({ at: 'x', event: 'other' });
      write(dir, 'test-policy.json', test);
    },
    '시험 정책 다른 서비스 변경': dir => {
      const test = read(dir, 'test-policy.json');
      test.services.notices.writeAllowed = true;
      write(dir, 'test-policy.json', test);
    },
    '사본 변경(manifest도 맞춤)': dir => {
      const safe = read(dir, 'safe-policy.json');
      safe.services.notes.itemMethods = ['GET'];
      write(dir, 'safe-policy.json', safe);
      const manifest = read(dir, 'safe-policy.manifest.json');
      manifest.sha256 = lfSha256(readFileSync(join(dir, 'safe-policy.json'), 'utf8'));
      write(dir, 'safe-policy.manifest.json', manifest);
    },
    '사본만 변경(sha256 틀림)': dir => {
      const safe = read(dir, 'safe-policy.json');
      safe.note = '바뀜';
      write(dir, 'safe-policy.json', safe);
    },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const dir = workDir();
    let changed;
    assert.throws(() => restorePolicy({
      dir, service: 'notes', confirm: true, now: NOW,
      onPreviewed: () => { mutate(dir); changed = raw(dir); },
    }), PolicyAbort, name);
    assert.deepEqual(raw(dir), changed, name);
  }
});

test('CRLF로 바뀐 사본도 같은 sha256(LF 기준)으로 검증됨', () => {
  const dir = workDir();
  const path = join(dir, 'safe-policy.json');
  writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/gu, '\r\n'));
  assert.equal(diffReport(dir).total, 3);
});

test('정책 복원은 운영 판정기 src/decider.mjs를 바꾸지 않음(복원 전후 sha256 같음)', () => {
  const before = operationalDeciderCheck();
  const dir = workDir();
  restorePolicy({ dir, service: 'notes', confirm: true, now: NOW });
  const after = operationalDeciderCheck();
  assert.equal(after.sha256, before.sha256);
  assert.equal(after.same, before.same);
});
