// known-cve 경보 하나를 받아 block·alert·record 를 돌려줍니다.
// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일·네트워크를 쓰지 않으며, 앞뒤 경보를 기억하지 않습니다.
// 경보 id 나 순서는 보지 않고 규칙 수준·T1190 표시·반복 횟수·요청 머리글과 인자·설명만 봅니다.
// 경보의 조회 구문은 문서용 표기입니다. 이 파일은 그 문자열을 찾기만 하고 바꾸거나 다른 곳에 보내지 않습니다.

// xdr/known-cve/patterns.json 을 그대로 옮겨 적은 상수입니다.
export const PATTERNS = deepFreeze({
  moduleKey: 'known-cve',
  source: 'CVE-2021-44228 Apache Log4j2 JNDI 조회 원격 코드 실행 (https://nvd.nist.gov/vuln/detail/CVE-2021-44228), MITRE ATT&CK T1190 Exploit Public-Facing Application (https://attack.mitre.org/techniques/T1190/)',
  note: "경보 원문에 실제로 나오는 모양(머리글 useragent·주소 인자 url 안의 ${jndi:ldap://…} 표기, 설명의 '점검 흔적·점검 도구' 표기, T1190 표시)을 보고 정했습니다. 숫자 기준은 decide.mjs 에서 정합니다. 경보의 조회 구문은 문서용 표기이므로 실제 공격 문자열로 바꾸거나 다른 시스템에 넣지 않습니다. 점검 도구 이름 목록은 경보 원문에 없어 넣지 않았습니다.",
  patterns: [
    {
      name: 'jndi-lookup',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        where: '요청 머리글·인자(data.useragent, data.url 의 경로·? 뒤 인자, 그 밖의 data 문자열 칸. 출발 주소·계정·횟수 칸은 제외)',
        lookup: '${jndi:<방식>://…} 모양의 원격 조회 구문이 완전히 있음 (대소문자 무시, URL 인코딩을 푼 뒤)',
        mitre: 'rule.mitre 에 T1190 이 있으면 확신도를 더 높임',
      },
      evidence: 'CVE-2021-44228: Log4j2가 기록하는 문자열 안의 ${jndi:…} 조회를 해석해 공격자 서버(LDAP 등)에서 코드를 받아 실행하며, 머리글·요청 인자로 이 구문을 넣는 것이 T1190(공개 웹 앱 악용)의 형태입니다.',
    },
    {
      name: 'jndi-lookup-obfuscated',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        where: 'jndi-lookup 과 같음',
        nestedLookup: '${lower:j}·${upper:N}·${::-d}·${env:X:-i} 같은 중첩 조회를 풀어 보면 ${jndi:<방식>://…} 이 됨',
      },
      evidence: 'CVE-2021-44228: Log4j2는 조회 안의 조회를 먼저 풀기 때문에 ${lower:j}처럼 글자를 쪼갠 중첩 조회도 같은 ${jndi:…} 조회가 되며, 단순 문자열 비교를 피하려는 변형으로 쓰였습니다(이 경보 묶음에는 나오지 않음).',
    },
    {
      name: 'jndi-lookup-incomplete',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        where: 'jndi-lookup 과 같음',
        partial: '${jndi: 로 시작하지만 <방식>:// 까지 이어지지 않는 애매한 모양',
      },
      evidence: 'CVE-2021-44228: 원격 조회는 ${jndi:<방식>://주소} 가 완전해야 일어나므로, 앞부분만 있는 모양은 악용 시도인지 잘린 기록인지 사람이 확인해야 합니다.',
    },
    {
      name: 'scanner-trace',
      technique: 'T1190 Exploit Public-Facing Application (관련: T1595.002 Vulnerability Scanning)',
      match: {
        description: "rule.description 에 '취약점 점검 흔적' 또는 '점검 도구' 표기가 있음 ('아닙니다·없습니다' 문장 제외)",
      },
      evidence: 'T1190 악용 전에 공개 취약점이 있는지 자동 점검 도구로 훑는 활동(T1595.002)이 함께 보이면 공격 준비로 볼 수 있지만, 흔적만으로는 악용 여부를 확정할 수 없습니다.',
    },
    {
      name: 't1190-without-lookup',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        mitre: 'rule.mitre 에 T1190 이 있음',
        noLookup: '요청 머리글·인자와 설명 어디에도 원격 조회 구문이 없음 (CVE 번호·jndi 단어·잘린 글자만 있음)',
      },
      evidence: 'T1190 표시는 공개 앱 악용 의심이지만, CVE-2021-44228은 ${jndi:…} 조회 구문이 있어야 악용되므로 구문이 없으면 확정하지 않고 사람이 확인합니다.',
    },
  ],
});

// decide.mjs 에서 정한 기준값입니다. 패턴에는 숫자 기준이 없습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const LOOKUP_BASE = 0.88; // 완전한 조회 구문 + T1190
const LOOKUP_NO_T1190 = 0.86; // 완전한 조회 구문은 뚜렷하지만 T1190 표시가 없음 (block 바로 위)
const LEVEL_LOW = 10; // 이 수준 이하는 수준 가산 0
const LEVEL_HIGH = 13; // 이 수준 이상은 수준 가산 최대
const REPEAT_LOW = 1;
const REPEAT_HIGH = 5;
const INCOMPLETE = 0.7; // 조회 구문 앞부분만 있음 → alert
const SCANNER_ONLY = 0.6; // 점검 도구 흔적만 있음 → alert
const T1190_ONLY = ALERT_AT; // T1190 표시만 있고 구문 없음 → alert

const [LOOKUP, OBFUSCATED, PARTIAL, SCANNER, T1190_NO_LOOKUP] = PATTERNS.patterns.map((p) => p.name);

// 출발 주소·도착 주소·계정·횟수 칸은 요청 내용이 아니므로 보지 않습니다.
const NOT_REQUEST_FIELDS = new Set(['srcip', 'dstip', 'srcuser', 'dstuser', 'count']);
// 완전한 원격 조회: ${jndi:<방식>://
const FULL_LOOKUP = /\$\{\s*jndi\s*:\s*[a-z][a-z0-9+.-]*\s*:\s*\/\//i;
// 앞부분만: ${jndi:
const PARTIAL_LOOKUP = /\$\{\s*jndi\s*:/i;
// 설명의 점검 도구 흔적 표기
const SCANNER_TEXT = /취약점\s*점검\s*흔적|점검\s*도구/;

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
  const hasT1190 = Array.isArray(rule.mitre) && rule.mitre.some((t) => typeof t === 'string' && /^T1190$/.test(t));
  const level = Number.isFinite(rule.level) ? rule.level : null;
  const repeats = toCount(data.count);

  const fields = requestFields(data);
  const plain = fields.filter((f) => FULL_LOOKUP.test(f.text)).map((f) => f.name);
  const nested = fields.filter((f) => !FULL_LOOKUP.test(f.text) && FULL_LOOKUP.test(unnest(f.text))).map((f) => f.name);
  const partial = fields.filter((f) => PARTIAL_LOOKUP.test(unnest(f.text))).map((f) => f.name);
  const sentences = description.split(/[.。]/).filter((s) => !/아닙니다|없습니다/.test(s)).join('.');
  const scanner = SCANNER_TEXT.test(sentences);
  const extra = scanner ? `+${SCANNER}` : '';
  const facts = `수준 ${level ?? '없음'}, ${repeats === null ? '반복 정보 없음' : `반복 ${repeats}번`}`;

  if (plain.length > 0 || nested.length > 0) {
    const name = plain.length > 0 ? LOOKUP : OBFUSCATED;
    const where = [...new Set([...plain, ...nested])].join('·');
    if (!hasT1190) return result(LOOKUP_NO_T1190, `${name}${extra}: ${where}에 원격 조회 구문, T1190 표시 없음`);
    const confidence = LOOKUP_BASE + 0.06 * scale(level, LEVEL_LOW, LEVEL_HIGH) + 0.05 * scale(repeats, REPEAT_LOW, REPEAT_HIGH);
    return result(confidence, `${name}${extra}: ${where}에 원격 조회 구문, T1190, ${facts}`);
  }
  if (partial.length > 0) {
    return result(INCOMPLETE, `${PARTIAL}${extra}: ${partial.join('·')}에 조회 구문 앞부분만 있음, ${facts}`);
  }
  if (scanner) {
    return result(SCANNER_ONLY, `${SCANNER}: 점검 도구 흔적만 있고 조회 구문 없음, ${facts}`);
  }
  if (hasT1190) {
    return result(T1190_ONLY, `${T1190_NO_LOOKUP}: T1190 표시만 있고 조회 구문 없음, ${facts}`);
  }
  return result(0, '일치 패턴 없음: T1190 표시·조회 구문 없음');
}

// 요청 머리글·인자 칸을 꺼냅니다. url 은 경로와 ? 뒤 인자를 URL 인코딩을 풀어 봅니다.
function requestFields(data) {
  const fields = [];
  for (const [name, value] of Object.entries(data)) {
    if (NOT_REQUEST_FIELDS.has(name)) continue;
    if (typeof value === 'string') fields.push({ name, text: name === 'url' ? decodeAll(value.replace(/\+/g, ' ')) : decodeAll(value) });
    else if (isObject(value)) {
      for (const [inner, text] of Object.entries(value)) {
        if (typeof text === 'string') fields.push({ name: `${name}.${inner}`, text: decodeAll(text) });
      }
    }
  }
  return fields;
}

// 중첩 조회를 풉니다: ${lower:x}→x, ${upper:x}→x, ${아무것:-x}→x(기본값), ${::-x}→x. 바깥 ${jndi: 는 남깁니다.
function unnest(text) {
  let out = text;
  for (let i = 0; i < 10; i += 1) {
    const next = out
      .replace(/\$\{\s*(?:lower|upper)\s*:([^${}]*)\}/gi, '$1')
      .replace(/\$\{[^${}]*?:-([^${}]*)\}/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out;
}

function decodeAll(text) {
  let out = text;
  for (let i = 0; i < 3; i += 1) {
    let next;
    try {
      next = decodeURIComponent(out);
    } catch {
      next = out.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    if (next === out) break;
    out = next;
  }
  return out;
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
