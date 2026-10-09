// web-injection 경보 하나를 받아 block·alert·record 를 돌려줍니다.
// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일·네트워크를 쓰지 않으며, 앞뒤 경보를 기억하지 않습니다.
// 경보 id 나 순서는 보지 않고 규칙 수준·T1190 표시·반복 횟수·요청 인자·설명만 봅니다.

// xdr/web-injection/patterns.json 을 그대로 옮겨 적은 상수입니다.
export const PATTERNS = deepFreeze({
  moduleKey: 'web-injection',
  source: 'MITRE ATT&CK T1190 Exploit Public-Facing Application (https://attack.mitre.org/techniques/T1190/)',
  note: '알려진 공격 형태만 적었습니다. ATT&CK은 횟수 기준값을 정하지 않으므로 여기에도 숫자 기준을 넣지 않았습니다. 판정 기준은 decide.mjs 제작 단계에서 정합니다. 경보의 url 값은 문서용 표기이므로 실제 공격 문자열로 바꾸거나 다른 시스템에 넣지 않습니다.',
  patterns: [
    {
      name: 'sql-injection',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        mitre: 'rule.mitre 에 T1190 이 있음',
        inRequestArgument: '요청 인자(data.url 의 ? 뒤) 안에 있음',
        sqlSyntax: 'SQL 구문·조회를 이어 붙이는 표기 (설명 또는 인자)',
        repeated: '같은 data.srcip 에서 여러 번 반복 (data.count)',
      },
      evidence: 'T1190: 외부에 공개된 웹 앱의 약점을 노려 접근하는 기법이며, 요청 인자에 SQL 구문을 넣어 데이터베이스 질의를 바꾸는 SQL 주입(CWE-89)이 대표적인 형태입니다.',
    },
    {
      name: 'script-injection',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        mitre: 'rule.mitre 에 T1190 이 있음',
        inRequestArgument: '요청 인자(data.url 의 ? 뒤) 안에 있음',
        scriptTag: '스크립트 태그·삽입 표식 (설명 또는 인자)',
        repeated: '같은 data.srcip 에서 여러 번 반복 (data.count)',
      },
      evidence: 'T1190: 외부 공개 웹 앱의 입력 처리 약점을 노리는 기법이며, 요청 인자에 스크립트 태그를 넣어 화면에서 실행되게 하는 스크립트 삽입(CWE-79)이 그런 약점의 하나입니다.',
    },
    {
      name: 'path-traversal',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        mitre: 'rule.mitre 에 T1190 이 있음',
        inRequestArgument: '요청 경로나 인자(data.url 의 ? 앞 경로 부분, 또는 ? 뒤 인자, 예: path·name) 안에 있음',
        parentDirectoryRepeat: '경로를 거슬러 올라가는 ../ 표기가 여러 단계 반복 (설명 또는 인자)',
        repeated: '같은 data.srcip 에서 여러 번 반복 (data.count)',
      },
      evidence: 'T1190: 외부 공개 웹 앱의 약점을 노리는 기법이며, 파일 경로 인자에 ../ 를 반복해 허용 폴더 밖의 파일을 읽으려는 경로 이탈(CWE-22)이 그런 약점의 하나입니다.',
    },
    {
      name: 'command-injection',
      technique: 'T1190 Exploit Public-Facing Application',
      match: {
        mitre: 'rule.mitre 에 T1190 이 있음',
        inRequestArgument: '요청 인자(data.url 의 ? 뒤) 안에 있음',
        commandSeparator: '명령 구분자 표기 (설명 또는 인자)',
        repeated: '같은 data.srcip 에서 여러 번 반복 (data.count)',
      },
      evidence: 'T1190: 외부 공개 웹 앱의 입력 처리 약점을 노리는 기법이며, 요청 인자에 명령 구분자를 넣어 서버에서 운영체제 명령이 실행되게 하는 명령 주입(CWE-78)이 그런 약점의 하나입니다.',
    },
  ],
});

// decide.mjs 에서 정한 기준값입니다. 패턴에는 숫자 기준이 없습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const LEVEL_LOW = 5; // 이 수준 이하는 수준 점수 0
const LEVEL_HIGH = 10; // 이 수준 이상은 수준 점수 1
const REPEAT_LOW = 1; // 1번은 반복 점수 0
const REPEAT_HIGH = 5; // 이 횟수 이상은 반복 점수 1
const SHAPE_SYNTAX = 1; // 인자에 실제 구문 모양이 있음
const SHAPE_DOC = 1; // 인자에 문서용 표기가 있음
const SHAPE_DESCRIPTION = 0.8; // 설명에만 패턴 표기가 있음
const NO_T1190_WITH_SYNTAX = 0.5; // T1190 표시는 없지만 실제 구문 모양이 뚜렷함
const BLOCK_MIN_REPEATS = 2; // data.count 가 이 횟수 미만이면 block 대신 alert 까지만
const SINGLE_TRY_CAP = 0.84; // 한 번뿐인 시도의 확신도 상한 (BLOCK_AT 바로 아래)

const [SQL, SCRIPT, TRAVERSAL, COMMAND] = PATTERNS.patterns.map((p) => p.name);

// 실제 구문 모양입니다. 단어 하나(select·drop·script)만으로는 맞지 않고, 따옴표·태그·구분자와 함께 있어야 맞습니다.
const SYNTAX = {
  [SQL]: [
    /['"`]\s*\)?\s*(?:or|and)\s+['"`]?\w+['"`]?\s*(?:=|like)\s*['"`]?\w+/i, // 따옴표 뒤 OR 1=1
    /\bunion\b(?:\s|\/\*.*?\*\/|\+)+(?:all\s+)?select\b/i, // UNION SELECT
    /['"`]\s*\)?\s*;\s*(?:drop|delete|insert|update|select|truncate|alter)\s+\w+/i, // 따옴표 뒤 이어 붙인 질의
    /['"`]\s*\)?\s*(?:--|#|\/\*)/, // 따옴표 뒤 주석으로 나머지 질의 끊기
  ],
  [SCRIPT]: [
    /<\s*\/?\s*script\b/i, // <script
    /<\s*[a-z]+\b[^>]*\bon[a-z]+\s*=/i, // 태그 안의 onerror= 같은 이벤트
    /\bjavascript\s*:/i,
  ],
  [TRAVERSAL]: [
    /(?:\.\.[\/\\]){2,}/, // ../ 두 단계 이상
  ],
  [COMMAND]: [
    /(?:;|\|\|?|&&|`|\$\()\s*(?:cat|ls|id|whoami|uname|wget|curl|nc|ncat|bash|sh|ping|rm|echo|chmod|python\d?|perl|powershell|cmd)\b/i,
  ],
};

// 시험 경보의 문서용 표기입니다.
const DOC_MARKERS = [
  { re: /\bdoc-sql-/i, names: [SQL] },
  { re: /\bdoc-script-/i, names: [SCRIPT] },
  { re: /\bdoc-up-repeat\b/i, names: [TRAVERSAL] },
  { re: /\bdoc-cmd-/i, names: [COMMAND] },
  { re: /\bdoc-mixed-marker\b/i, names: [SQL, SCRIPT] },
];

// 설명 문장의 패턴 표기입니다. "아닙니다·없습니다"가 있는 문장은 보지 않습니다.
const DESCRIPTION = {
  [SQL]: /SQL\s*(?:구문|표식|표기)|데이터베이스\s*조회를\s*이어/i,
  [SCRIPT]: /스크립트\s*(?:삽입\s*)?(?:표식|표기|태그)/,
  [TRAVERSAL]: /거슬러\s*올라가|경로\s*이탈/,
  [COMMAND]: /명령\s*구분자/,
};

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
  const args = requestArguments(data.url);
  const path = requestPath(data.url);

  const hasT1190 = Array.isArray(rule.mitre) && rule.mitre.some((t) => typeof t === 'string' && /^T1190$/.test(t));
  const level = Number.isFinite(rule.level) ? rule.level : null;
  const repeats = countRepeats(data, description);

  const shapes = matchShapes(args, path, description);
  const best = shapes.reduce((a, b) => (b.score > a.score ? b : a), { names: [], score: 0, via: '' });
  const names = shapes.filter((s) => s.score === best.score).flatMap((s) => s.names);
  const label = [...new Set(names)].join('+');

  if (!hasT1190) {
    if (best.score === SHAPE_SYNTAX && best.via.endsWith('구문 모양')) {
      return result(NO_T1190_WITH_SYNTAX, `${label}: T1190 표시 없음, ${best.via} 있음`);
    }
    return result(0, '일치 패턴 없음: T1190 표시 없음');
  }
  if (args === null && path === null && best.score === 0) return result(0.2, '일치 패턴 없음: T1190 표시는 있으나 요청 주소·패턴 표기 없음');
  if (best.score === 0) {
    return result(ALERT_AT, `일치 패턴 없음: T1190 표시만 있음, 수준 ${level ?? '없음'}, ${repeats === null ? '반복 정보 없음' : `반복 ${repeats}번`}, 주입 구문 모양 없음`);
  }

  const strength = best.score * (0.4 + 0.3 * scale(level, LEVEL_LOW, LEVEL_HIGH) + 0.3 * scale(repeats, REPEAT_LOW, REPEAT_HIGH));
  let confidence = ALERT_AT + (1 - ALERT_AT) * strength;
  // 같은 주소에서 반복된 시도만 막습니다. data.count 가 2번 미만이면 수준이 높아도 alert 까지만.
  const counted = toCount(data.count);
  const single = counted === null || counted < BLOCK_MIN_REPEATS;
  if (single) confidence = Math.min(confidence, SINGLE_TRY_CAP);
  return result(confidence, `${label}: T1190, 수준 ${level ?? '없음'}, ${repeats === null ? '반복 정보 없음' : `반복 ${repeats}번`}, ${best.via}${single ? ', 반복 아님(alert 상한)' : ''}`);
}

// 요청 인자(? 뒤)를 URL 인코딩을 풀어 돌려줍니다. 두 번 인코딩된 값도 풉니다.
function requestArguments(url) {
  if (typeof url !== 'string') return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  let text = url.slice(q + 1).replace(/\+/g, ' ');
  for (let i = 0; i < 3; i += 1) {
    const next = safeDecode(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

// 요청 경로(? 앞)를 URL 인코딩을 풀어 돌려줍니다. path-traversal 만 이 값을 봅니다.
function requestPath(url) {
  if (typeof url !== 'string') return null;
  const q = url.indexOf('?');
  let text = (q < 0 ? url : url.slice(0, q)).split('#')[0];
  if (text === '') return null;
  for (let i = 0; i < 3; i += 1) {
    const next = safeDecode(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }
}

function matchShapes(args, path, description) {
  const shapes = [];
  if (path !== null && SYNTAX[TRAVERSAL].some((re) => re.test(path))) {
    shapes.push({ names: [TRAVERSAL], score: SHAPE_SYNTAX, via: '경로의 구문 모양' });
  }
  if (args !== null) {
    for (const [name, list] of Object.entries(SYNTAX)) {
      if (list.some((re) => re.test(args))) shapes.push({ names: [name], score: SHAPE_SYNTAX, via: '구문 모양' });
    }
    for (const { re, names } of DOC_MARKERS) {
      if (re.test(args)) shapes.push({ names, score: SHAPE_DOC, via: '문서용 표기' });
    }
  }
  const sentences = description.split(/[.。]/).filter((s) => !/아닙니다|없습니다/.test(s)).join('.');
  for (const [name, re] of Object.entries(DESCRIPTION)) {
    if (re.test(sentences)) shapes.push({ names: [name], score: SHAPE_DESCRIPTION, via: '설명 표기' });
  }
  return shapes;
}

function countRepeats(data, description) {
  const fromData = toCount(data.count);
  if (fromData !== null) return fromData;
  const m = description.match(/(\d+)\s*번/);
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
