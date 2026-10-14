// decide.mjs 의 판단 가운데 block 후보만 PC 격리 거부 규칙 후보로 쌓고, block·alert 알림을 한 줄씩 남깁니다.
// decide.mjs 와 src/decider.mjs 는 고치지 않습니다. 판정기는 아직 이 규칙 파일을 읽지 않습니다.
// 규칙은 출발 주소가 아니라 경보의 PC(agent.id, 없으면 agent.name)에 겁니다. 계정(srcuser)은 막지 않습니다.
// xdr/deny-rules.json 은 brute-force·web-injection·known-cve 와 함께 씁니다. 다른 모듈의 규칙은 지우거나 덮어쓰지 않습니다.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { decide } from './decide.mjs';

export const RULE_SCHEMA = 'aleph.xdr.deny-rules.v1';
// docs/DECIDER_REQUEST.md 응답 어휘에 맞춘 이름입니다. reasonCode 는 운영 등록부에 아직 등록되지 않았습니다.
export const RULE_ID = 'xdr_persistence_isolate';
export const REASON_CODE = 'xdr_persistence';
export const RULE_TTL_MINUTES = 60;
export const MODULE_KEY = 'persistence';
const ID_PREFIX = 'xdr-ps-';
// 호스트 식별값으로 받는 모양(영문·숫자·점·밑줄·하이픈, 64자 이하)
const HOST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_RULES_PATH = join(root, 'xdr', 'deny-rules.json');
export const DEFAULT_LOG_PATH = join(root, 'xdr', 'alerts.log');

export function hostOf(alert) {
  const agent = alert?.agent;
  if (typeof agent?.id === 'string' && HOST_ID.test(agent.id.trim())) return { kind: 'agent_id', value: agent.id.trim() };
  if (typeof agent?.name === 'string' && HOST_ID.test(agent.name.trim())) return { kind: 'host', value: agent.name.trim() };
  return null;
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
    const host = hostOf(alert);
    const srcip = typeof alert?.data?.srcip === 'string' ? alert.data.srcip.trim() : '';
    const srcuser = typeof alert?.data?.srcuser === 'string' ? alert.data.srcuser.trim() : '';
    judged.push({ alertId, host, srcip, srcuser, ...out });
  }

  // 같은 묶음에서 record(정상)로 나온 PC는 정상 사용이 있는 PC로 보고 격리하지 않습니다.
  // 정상으로 나온 계정이 함께 적힌 block 경보도 격리하지 않습니다(그 PC를 쓰는 정상 사용자를 막지 않기 위해).
  const keyOf = (host) => `${host.kind}:${host.value}`;
  const normalHosts = new Set(judged.filter((j) => j.action === 'record' && j.host).map((j) => keyOf(j.host)));
  const normalUsers = new Set(judged.filter((j) => j.action === 'record' && j.srcuser).map((j) => j.srcuser));

  const fresh = new Map();
  const skipped = [];
  for (const j of judged.filter((x) => x.action === 'block')) {
    if (!j.alertId) { skipped.push({ alertId: j.alertId, why: '경보 번호 없음' }); continue; }
    if (!j.host) { skipped.push({ alertId: j.alertId, why: '호스트·에이전트 식별값 없음' }); continue; }
    if (normalHosts.has(keyOf(j.host))) { skipped.push({ alertId: j.alertId, why: `정상 경보와 같은 PC(${j.host.value})` }); continue; }
    if (j.srcuser && normalUsers.has(j.srcuser)) { skipped.push({ alertId: j.alertId, why: '정상 경보와 같은 계정' }); continue; }
    const key = keyOf(j.host);
    const rule = fresh.get(key) ?? {
      id: `${ID_PREFIX}${j.host.value}`,
      module: MODULE_KEY,
      ruleId: RULE_ID,
      decision: 'deny',
      reasonCode: REASON_CODE,
      target: { kind: j.host.kind, value: j.host.value },
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
    fresh.set(key, rule);
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
      host: j.host ? j.host.value : null,
      srcip: isIP(j.srcip) ? j.srcip : null,
      reason: j.reason,
      ruleAdded: j.action === 'block' && Boolean(j.host) && fresh.has(keyOf(j.host)),
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

// 이 모듈의 만료된 규칙만 지우고, 같은 PC의 규칙은 근거를 합치고 만료 시각을 늦춥니다.
// 다른 모듈(brute-force·web-injection·known-cve 등)이 넣은 규칙은 만료 여부와 상관없이 그대로 둡니다.
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
    const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'persistence.json'), 'utf8'));
    const summary = await respond({ alerts: fixture.alerts });
    console.log(`PC 격리 규칙 후보 추가 ${summary.added}건, persistence 유효 ${summary.active}건, 알림 ${summary.logged}줄`);
    for (const s of summary.skipped) console.log(`건너뜀: ${s.alertId || '(번호 없음)'} — ${s.why}`);
    console.log('로컬 연습 결과이며 판정기에 연결되지 않았고 심판 판정도 아닙니다.');
  } catch (error) {
    console.error(`첫 오류: ${error.message}`);
    process.exitCode = 1;
  }
}
