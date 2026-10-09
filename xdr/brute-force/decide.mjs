// brute-force 경보 하나를 받아 block·alert·record 를 돌려줍니다.
// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일·네트워크를 쓰지 않으며, 앞뒤 경보를 기억하지 않습니다.
// 경보 id 나 순서는 보지 않고 규칙 수준·T1110 표시·실패 횟수·대상 계정 수·설명만 봅니다.

// xdr/brute-force/patterns.json 을 그대로 옮겨 적은 상수입니다.
export const PATTERNS = deepFreeze({
  moduleKey: 'brute-force',
  source: 'MITRE ATT&CK T1110 Brute Force (https://attack.mitre.org/techniques/T1110/)',
  note: '알려진 공격 형태만 적었습니다. ATT&CK은 건수·시간 기준값을 정하지 않으므로 여기에도 숫자 기준을 넣지 않았습니다. 판정 기준은 decide.mjs 제작 단계에서 정합니다.',
  patterns: [
    {
      name: 'password-guessing',
      technique: 'T1110.001 Password Guessing',
      match: {
        mitre: 'rule.mitre 에 T1110 이 있음',
        sameSource: '같은 data.srcip',
        shortWindow: '짧은 시간 안에 이어진 시도',
        repeatedFailures: '로그인 실패가 연속으로 여러 건 (data.count)',
        noSuccess: '실패 뒤 성공이 없음',
      },
      evidence: 'T1110.001: 계정 비밀번호를 모를 때 한 계정에 여러 비밀번호를 반복해 넣어 맞히려는 형태이며, 짧은 시간의 연속 인증 실패로 드러납니다.',
    },
    {
      name: 'password-spraying',
      technique: 'T1110.003 Password Spraying',
      match: {
        mitre: 'rule.mitre 에 T1110 이 있음',
        sameSource: '같은 data.srcip',
        manyAccounts: '서로 다른 계정 여러 개 (data.accounts 또는 설명의 계정 수)',
        samePassword: '여러 계정에 같은 비밀번호로 실패',
      },
      evidence: 'T1110.003: 계정 잠금을 피하려고 흔한 비밀번호 하나를 여러 계정에 차례로 넣는 형태이며, 여러 계정에 걸친 인증 실패로 드러납니다.',
    },
  ],
});

// decide.mjs 에서 정한 기준값입니다. 패턴에는 숫자 기준이 없습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const LEVEL_LOW = 5; // 이 수준 이하는 수준 점수 0
const LEVEL_HIGH = 10; // 이 수준 이상은 수준 점수 1
const FAILURES_LOW = 5; // 실패 이 건수 이하는 실패 점수 0
const FAILURES_HIGH = 20; // 실패 이 건수 이상은 실패 점수 1
const ACCOUNTS_LOW = 2; // 대상 계정 이 수 이하는 계정 점수 0
const ACCOUNTS_HIGH = 10; // 대상 계정 이 수 이상은 계정 점수 1
const SUCCESS_PENALTY = 0.5; // 실패 뒤 성공이 있으면 guessing 강도를 이만큼 곱함

const [GUESSING, SPRAYING] = PATTERNS.patterns.map((p) => p.name);

export function decide(alert) {
  try {
    return judge(alert);
  } catch {
    return result(0, '경보 형식이 아니어서 판단하지 않음');
  }
}

function judge(alert) {
  if (!isObject(alert) || !isObject(alert.rule)) return result(0, '경보 형식이 아니어서 판단하지 않음');
  const rule = alert.rule;
  const data = isObject(alert.data) ? alert.data : {};
  const description = typeof rule.description === 'string' ? rule.description : '';

  const hasT1110 = Array.isArray(rule.mitre) && rule.mitre.some((t) => typeof t === 'string' && /^T1110(\.\d{3})?$/.test(t));
  if (!hasT1110) return result(0, '일치 패턴 없음: T1110 표시 없음');

  const level = Number.isFinite(rule.level) ? rule.level : null;
  const failures = countFailures(data, description);
  const accounts = countAccounts(data, description);
  const succeededAfter = /성공했/.test(description);
  const samePassword = /같은 비밀번호/.test(description);

  // 패턴의 최소 조건(T1110 + 실패 또는 여러 계정)이 맞지 않으면 record
  const guessingMin = failures !== null && failures >= 1;
  const sprayingMin = accounts !== null && accounts >= ACCOUNTS_LOW;
  if (!guessingMin && !sprayingMin) return result(0.2, '일치 패턴 없음: T1110 표시는 있으나 실패·대상 계정 수가 없음');

  const levelScore = scale(level, LEVEL_LOW, LEVEL_HIGH);
  const candidates = [];
  if (guessingMin) {
    let strength = (levelScore + scale(failures, FAILURES_LOW, FAILURES_HIGH)) / 2;
    if (succeededAfter) strength *= SUCCESS_PENALTY;
    candidates.push({ name: GUESSING, strength, detail: `실패 ${failures}건${succeededAfter ? ' 뒤 성공' : ''}` });
  }
  if (sprayingMin) {
    const strength = (levelScore + scale(accounts, ACCOUNTS_LOW, ACCOUNTS_HIGH)) / 2;
    candidates.push({ name: SPRAYING, strength, detail: `계정 ${accounts}개${samePassword ? '·같은 비밀번호' : ''}` });
  }
  const best = candidates.reduce((a, b) => (b.strength > a.strength ? b : a));
  const confidence = ALERT_AT + (1 - ALERT_AT) * best.strength;
  return result(confidence, `${best.name}: T1110, 수준 ${level ?? '없음'}, ${best.detail}`);
}

function countFailures(data, description) {
  const fromData = toCount(data.count);
  if (fromData !== null) return fromData;
  const m = description.match(/실패[가는]?\s*(\d+)\s*건/);
  return m ? Number(m[1]) : null;
}

function countAccounts(data, description) {
  if (typeof data.accounts === 'string') {
    const names = new Set(data.accounts.split(',').map((s) => s.trim()).filter(Boolean));
    if (names.size > 0) return names.size;
  }
  const m = description.match(/계정\s*(\d+)\s*개/);
  return m ? Number(m[1]) : null;
}

function toCount(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

function scale(value, low, high) {
  if (value === null) return 0;
  return Math.min(1, Math.max(0, (value - low) / (high - low)));
}

function result(confidence, reason) {
  const c = Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100;
  const action = c >= BLOCK_AT ? 'block' : c >= ALERT_AT ? 'alert' : 'record';
  return { action, confidence: c, reason };
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
