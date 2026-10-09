// decide.mjs 의 판단 가운데 block 후보만 거부 규칙 후보로 쌓고, block·alert 알림을 한 줄씩 남깁니다.
// decide.mjs 와 src/decider.mjs 는 고치지 않습니다. 판정기는 아직 이 규칙 파일을 읽지 않습니다.
// 규칙은 출발 주소에만 겁니다. 경보의 계정(srcuser)은 공격 대상, 곧 정상 사용자일 수 있으므로 막지 않습니다.
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { decide } from './decide.mjs';

export const RULE_SCHEMA = 'aleph.xdr.deny-rules.v1';
// docs/DECIDER_REQUEST.md 응답 어휘에 맞춘 이름입니다. reasonCode 는 운영 등록부에 아직 등록되지 않았습니다.
export const RULE_ID = 'xdr_brute_force_block';
export const REASON_CODE = 'xdr_brute_force';
export const RULE_TTL_MINUTES = 60;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_RULES_PATH = join(root, 'xdr', 'deny-rules.json');
export const DEFAULT_LOG_PATH = join(root, 'xdr', 'alerts.log');

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
    const srcip = typeof alert?.data?.srcip === 'string' ? alert.data.srcip.trim() : '';
    judged.push({ alertId, srcip, ...out });
  }

  // 같은 묶음에서 record(정상)로 나온 주소는 정상 사용자도 쓰는 주소로 보고 막지 않습니다.
  const normalIps = new Set(judged.filter((j) => j.action === 'record' && isIP(j.srcip)).map((j) => j.srcip));

  const fresh = new Map();
  const skipped = [];
  for (const j of judged.filter((x) => x.action === 'block')) {
    if (!j.alertId) { skipped.push({ alertId: j.alertId, why: '경보 번호 없음' }); continue; }
    if (!isIP(j.srcip)) { skipped.push({ alertId: j.alertId, why: '출발 주소 형식 아님' }); continue; }
    if (normalIps.has(j.srcip)) { skipped.push({ alertId: j.alertId, why: '정상 경보와 같은 주소' }); continue; }
    const rule = fresh.get(j.srcip) ?? {
      id: `xdr-bf-${j.srcip}`,
      ruleId: RULE_ID,
      decision: 'deny',
      reasonCode: REASON_CODE,
      target: { kind: 'source_ip', value: j.srcip },
      createdAt: nowIso,
      expiresAt,
      evidenceAlertIds: [],
      patterns: [],
      confidence: 0,
    };
    rule.evidenceAlertIds.push(j.alertId);
    const pattern = j.reason.split(':')[0];
    if (!rule.patterns.includes(pattern)) rule.patterns.push(pattern);
    rule.confidence = Math.max(rule.confidence, j.confidence);
    fresh.set(j.srcip, rule);
  }

  const rules = mergeRules(await readRules(rulesPath), [...fresh.values()], now);
  await writeRules(rulesPath, rules, nowIso);

  const lines = judged
    .filter((j) => j.action === 'block' || j.action === 'alert')
    .map((j) => JSON.stringify({
      at: nowIso,
      alertId: j.alertId,
      action: j.action,
      confidence: j.confidence,
      srcip: isIP(j.srcip) ? j.srcip : null,
      reason: j.reason,
      ruleAdded: j.action === 'block' && fresh.has(j.srcip),
    }));
  if (lines.length > 0) {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  }

  return { added: fresh.size, active: rules.length, logged: lines.length, skipped };
}

async function readRules(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return parsed?.schema === RULE_SCHEMA && Array.isArray(parsed.rules) ? parsed.rules : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`규칙 파일을 읽지 못했습니다: ${path}`);
  }
}

// 만료된 규칙은 지우고, 같은 주소의 규칙은 근거를 합치고 만료 시각을 늦춥니다.
function mergeRules(existing, incoming, now) {
  const byId = new Map();
  for (const rule of existing) {
    if (rule && typeof rule.id === 'string' && Date.parse(rule.expiresAt) > now.getTime()) byId.set(rule.id, rule);
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
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

async function writeRules(path, rules, nowIso) {
  const body = {
    schema: RULE_SCHEMA,
    contract: 'docs/DECIDER_REQUEST.md aleph.decision.v1',
    contractMatch: null,
    note: '현재 판정기 요청 계약에는 출발 주소가 없어 판정기가 이 규칙을 요청과 맞출 수 없습니다. 운영 엔진이 출처를 확인한 주소를 별도 계약으로 줄 때까지 판정기에 연결하지 않습니다.',
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
    const fixture = JSON.parse(await readFile(join(root, 'xdr', 'fixtures', 'brute-force.json'), 'utf8'));
    const summary = await respond({ alerts: fixture.alerts });
    console.log(`거부 규칙 후보 추가 ${summary.added}건, 유효 ${summary.active}건, 알림 ${summary.logged}줄`);
    for (const s of summary.skipped) console.log(`건너뜀: ${s.alertId || '(번호 없음)'} — ${s.why}`);
    console.log('로컬 연습 결과이며 판정기에 연결되지 않았고 심판 판정도 아닙니다.');
  } catch (error) {
    console.error(`첫 오류: ${error.message}`);
    process.exitCode = 1;
  }
}
