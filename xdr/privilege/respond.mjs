// decide.mjs 의 판단 가운데 block 후보만 계정 세션 회수 거부 규칙 후보로 쌓고, block·alert 알림을 한 줄씩 남깁니다.
// decide.mjs 와 src/decider.mjs 는 고치지 않습니다. 판정기는 아직 이 규칙 파일을 읽지 않습니다.
// 규칙은 출발 주소나 PC가 아니라 경보의 계정(data.srcuser)의 세션에 겁니다.
// xdr/deny-rules.json 은 brute-force·web-injection·known-cve·persistence 와 함께 씁니다. 다른 모듈의 규칙은 지우거나 덮어쓰지 않습니다.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { decide } from './decide.mjs';

export const RULE_SCHEMA = 'aleph.xdr.deny-rules.v1';
// docs/DECIDER_REQUEST.md 응답 어휘에 맞춘 이름입니다. reasonCode 는 운영 등록부에 아직 등록되지 않았습니다.
export const RULE_ID = 'xdr_privilege_revoke_session';
export const REASON_CODE = 'xdr_privilege';
export const RULE_TTL_MINUTES = 60;
export const MODULE_KEY = 'privilege';
const ID_PREFIX = 'xdr-pv-';
// 계정 이름으로 받는 모양(영문·숫자·점·밑줄·하이픈, 64자 이하). 이메일·실명 모양은 받지 않습니다.
const ACCOUNT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_RULES_PATH = join(root, 'xdr', 'deny-rules.json');
export const DEFAULT_LOG_PATH = join(root, 'xdr', 'alerts.log');

export function accountOf(alert) {
  const user = alert?.data?.srcuser;
  return typeof user === 'string' && ACCOUNT.test(user.trim()) ? user.trim() : '';
}

export async function respond({
  alerts,
  now = new Date(),
  rulesPath = DEFAULT_RULES_PATH,
  logPath = DEFAULT_LOG_PATH,
}) {
  if (!Array.isArray(alerts)) throw new TypeError('alerts 는 배열이어야 합니다.');
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + RULE_TTL_MINUTES * 60_000).toISOString();

  const judged = [];
  for (const alert of alerts) {
    const out = await decide(alert);
    const alertId = typeof alert?.id === 'string' ? alert.id : '';
    const account = accountOf(alert);
    const srcip = typeof alert?.data?.srcip === 'string' ? alert.data.srcip.trim() : '';
    judged.push({ alertId, account, srcip, ...out });
  }

  // 같은 묶음에서 record(정상)로 나온 계정은 정상 사용자로 보고 세션을 거두지 않습니다.
  const normalAccounts = new Set(judged.filter((j) => j.action === 'record' && j.account).map((j) => j.account));

  const fresh = new Map();
  const skipped = [];
  for (const j of judged.filter((x) => x.action === 'block')) {
    if (!j.alertId) { skipped.push({ alertId: j.alertId, why: '경보 번호 없음' }); continue; }
    if (!j.account) { skipped.push({ alertId: j.alertId, why: '계정 형식 아님' }); continue; }
    if (normalAccounts.has(j.account)) { skipped.push({ alertId: j.alertId, why: `정상 경보와 같은 계정(${j.account})` }); continue; }
    const rule = fresh.get(j.account) ?? {
      id: `${ID_PREFIX}${j.account}`,
      module: MODULE_KEY,
      ruleId: RULE_ID,
      decision: 'deny',
      reasonCode: REASON_CODE,
      action: 'revoke_session',
      target: { kind: 'account', value: j.account },
      createdAt: nowIso,
      expiresAt,
      evidenceAlertIds: [],
      patterns: [],
      confidence: 0,
    };
    rule.evidenceAlertIds.push(j.alertId);
    for (const pattern of j.reason.split(':')[0].split('+')) {
      if (!rule.patterns.includes(pattern)) rule.patterns.push(pattern);
    }
    rule.confidence = Math.max(rule.confidence, j.confidence);
    fresh.set(j.account, rule);
  }

  const merged = mergeRules(await readRules(rulesPath), [...fresh.values()], now);
  await writeRules(rulesPath, merged, nowIso);
  const { rules } = merged;

  const lines = judged
    .filter((j) => j.action === 'block' || j.action === 'alert')
    .map((j) => JSON.stringify({
      at: nowIso,
      module: MODULE_KEY,
      alertId: j.alertId,
      action: j.action,
      confidence: j.confidence,
      account: j.account || null,
      srcip: isIP(j.srcip) ? j.srcip : null,
      reason: j.reason,
      ruleAdded: j.action === 'block' && Boolean(j.account) && fresh.has(j.account),
    }));
  if (lines.length > 0) {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  }

  return { added: fresh.size, active: rules.filter((r) => r?.id?.startsWith(ID_PREFIX)).length, logged: lines.length, skipped };
}

async function readRules(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    if (parsed?.schema !== RULE_SCHEMA || !Array.isArray(parsed.rules)) {
      throw new Error(`규칙 파일 형식이 아니어서 덮어쓰지 않았습니다: ${path}`);
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') return { rules: [] };
    if (error instanceof SyntaxError) throw new Error(`규칙 파일을 읽지 못해 덮어쓰지 않았습니다: ${path}`);
    throw error;
  }
}

// 이 모듈의 만료된 규칙만 지우고, 같은 계정의 규칙은 근거를 합치고 만료 시각을 늦춥니다.
// 다른 모듈(brute-force·web-injection·known-cve·persistence 등)이 넣은 규칙은 만료 여부와 상관없이 그대로 둡니다.
function mergeRules(existing, incoming, now) {
  const byId = new Map();
  const others = [];
  for (const rule of existing.rules) {
    if (!rule || typeof rule.id !== 'string' || !rule.id.startsWith(ID_PREFIX)) { others.push(rule); continue; }
    if (Date.parse(rule.expiresAt) > now.getTime()) byId.set(rule.id, rule);
  }
  for (const rule of incoming) {
    const old = byId.get(rule.id);
    if (!old) { byId.set(rule.id, rule); continue; }
    byId.set(rule.id, {
      ...rule,
      createdAt: old.createdAt,
      evidenceAlertIds: [...new Set([...old.evidenceAlertIds, ...rule.evidenceAlertIds])],
      patterns: [...new Set([...old.patterns, ...rule.patterns])],
      confidence: Math.max(old.confidence, rule.confidence),
    });
  }
  return { header: existing, rules: [...others, ...[...byId.values()].sort((a, b) => a.id.localeCompare(b.id))] };
}

// 파일 머리(contract·note 등)는 다른 모듈이 쓴 그대로 두고 rules·updatedAt 만 바꿉니다.
async function writeRules(path, merged, nowIso) {
  const { header, rules } = merged;
  const body = {
    schema: RULE_SCHEMA,
    contract: header.contract ?? 'docs/DECIDER_REQUEST.md aleph.decision.v1',
    contractMatch: null,
    note: header.note ?? '현재 판정기 요청 계약에는 출발 주소·PC 식별값이 없어 판정기가 이 규칙을 요청과 맞출 수 없습니다. 운영 엔진이 출처를 확인한 값을 별도 계약으로 줄 때까지 판정기에 연결하지 않습니다.',
    updatedAt: nowIso,
    rules,
  };
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  await rename(tmp, path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'privilege.json'), 'utf8'));
    const summary = await respond({ alerts: fixture.alerts });
    console.log(`세션 회수 규칙 후보 추가 ${summary.added}건, privilege 유효 ${summary.active}건, 알림 ${summary.logged}줄`);
    for (const s of summary.skipped) console.log(`건너뜀: ${s.alertId || '(번호 없음)'} — ${s.why}`);
    console.log('로컬 연습 결과이며 판정기에 연결되지 않았고 심판 판정도 아닙니다.');
  } catch (error) {
    console.error(`첫 오류: ${error.message}`);
    process.exitCode = 1;
  }
}
