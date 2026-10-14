// privilege 경보 하나를 받아 block·alert·record 를 돌려줍니다.
// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일·네트워크를 쓰지 않으며, 앞뒤 경보를 기억하지 않습니다.
// 경보 id 나 순서, 호스트 이름은 보지 않고 규칙 수준·MITRE 표시·그룹·횟수·계정 모양·시각·설명만 봅니다.

// xdr/privilege/patterns.json 을 그대로 옮겨 적은 상수입니다.
export const PATTERNS = deepFreeze({
  "moduleKey": "privilege",
  "source": "MITRE ATT&CK T1068 Exploitation for Privilege Escalation (https://attack.mitre.org/techniques/T1068/), T1078 Valid Accounts (https://attack.mitre.org/techniques/T1078/), T1078.003 Valid Accounts: Local Accounts (https://attack.mitre.org/techniques/T1078/003/), T1098.007 Account Manipulation: Additional Local or Domain Groups (https://attack.mitre.org/techniques/T1098/007/)",
  "note": "경보 원문에 실제로 나오는 모양(rule.mitre 의 T1068·T1078, data.group 의 administrators·과제 그룹, data.count, 설명의 '관리자 그룹에 추가·관리자 명령·처음 보는 주소·방금 관리자가 된·다른 계정의 권한·수업 시간 밖' 표기)을 보고 정했습니다. 관리자 그룹 추가는 경보에 T1078 로 붙어 있지만, 더 맞는 공식 하위 기법은 T1098.007 입니다. 업무 시간 기준은 아래 businessHours 에 적었습니다. 숫자 기준은 decide.mjs 에서 정합니다.",
  "businessHours": {
    "start": "09:00",
    "end": "16:00",
    "timezone": "경보 timestamp 에 적힌 +09:00 그대로",
    "evidence": "경보 원문에서 '수업 시간에·수업 중'이라고 적힌 경보(pv-10 09:26, pv-14 12:06)와 정상 이벤트(pv-18~26)가 모두 09:08~15:41 에 있어 09:00 이상 16:00 미만을 수업(업무) 시간으로 봅니다. 다만 '수업 시간 밖·업무처럼 보이지 않는 시각'이라고 적힌 경보(pv-03 10:03, pv-07 14:16)의 timestamp 도 이 안에 있어 시각 칸과 설명이 어긋나므로, 시간 밖 신호는 설명 표기 또는 시각 둘 중 하나만 맞아도 셉니다."
  },
  "patterns": [
    {
      "name": "admin-group-add",
      "technique": "T1098.007 Account Manipulation: Additional Local or Domain Groups (T1078.003 Local Accounts)",
      "match": {
        "group": "data.group 이 관리자 그룹(administrators·admins·wheel·sudo)이고 설명에 '추가·들어가·들어왔' 표기('아닙니다' 문장 제외)",
        "signals": "평범한 계정(admin·svc- 로 시작하지 않는 계정), 같은 경보의 관리자·권한 명령 실행, 원격·처음 보는 주소, 여러 계정(data.count 2 이상), 빠졌다가 다시 들어옴, 시간 밖"
      },
      "evidence": "T1098.007: 공격자는 손에 넣은 계정을 Windows 로컬 administrators 같은 관리자 그룹에 넣어 높은 권한을 유지하며, 평범한 계정이 관리자 그룹에 들어가는 것이 그 흔적입니다."
    },
    {
      "name": "new-admin-command",
      "technique": "T1078 Valid Accounts / T1078.003 Local Accounts, T1068 Exploitation for Privilege Escalation",
      "match": {
        "command": "설명에 '관리자 명령·권한 명령' 실행 표기('실패·없습니다' 제외)",
        "signals": "방금 관리자가 된 계정, 다른 계정의 권한으로 실행, 처음 보는 주소, 시간 밖"
      },
      "evidence": "T1078: 도용한 정상 계정으로 관리자 명령을 쓰면 평소와 다른 사용(처음 얻은 권한, 남의 권한, 처음 보는 주소, 시간 밖)으로만 드러나며, T1068 로 얻은 권한도 곧바로 관리자 명령으로 이어집니다."
    },
    {
      "name": "session-elevation",
      "technique": "T1068 Exploitation for Privilege Escalation",
      "match": {
        "elevation": "설명에 '관리자 권한으로 바뀌·권한 상승' 표기",
        "signals": "평범한 계정, 처음 보는 주소, 시간 밖. '취소·실패·명령은 없습니다'는 시도만 있는 것으로 봄"
      },
      "evidence": "T1068: 공격자는 취약점을 악용해 평범한 계정의 세션을 관리자(SYSTEM) 권한으로 올리므로, 평범한 계정 세션의 권한 상승이 그 흔적입니다."
    },
    {
      "name": "off-hours-privilege",
      "technique": "T1078 Valid Accounts",
      "match": {
        "time": "설명의 '수업 시간 밖·업무 시간 밖·업무처럼 보이지 않는 시각' 표기, 또는 timestamp 가 businessHours 밖",
        "with": "권한 관련 신호(T1068·T1078 표시, 관리자 그룹·명령·권한 상승)"
      },
      "evidence": "T1078 탐지 안내는 정상 계정이 평소와 다른 시각에 쓰이는 것을 도용 신호로 보며, 다른 신호와 겹치면 확신도를 올리고 혼자면 사람이 확인합니다."
    },
    {
      "name": "group-change-non-admin",
      "technique": "T1098.007 Account Manipulation: Additional Local or Domain Groups",
      "match": {
        "group": "관리자 그룹이 아닌 그룹(과제·수업 그룹 등)에 추가·새 그룹 생성·그룹 설명 변경"
      },
      "evidence": "T1098.007 은 추가 그룹 소속 변경 전체를 다루지만 관리자 그룹이 아니면 권한이 바로 오르지 않으므로, 수업 그룹 변경은 사람이 승인 여부를 확인합니다."
    },
    {
      "name": "single-privilege-signal",
      "technique": "T1068 Exploitation for Privilege Escalation, T1078 Valid Accounts",
      "match": {
        "mitre": "rule.mitre 에 T1068·T1078 이 있지만 위 신호가 하나뿐이거나 시도만 있음(권한 상승 창 취소, 관리자 명령 실패, 평소 주소의 관리자 명령 한 번, 계정 종류 조회)"
      },
      "evidence": "T1068·T1078 은 정상 관리 작업(승인된 권한 상승, 평소 관리 명령)과 같은 기록을 남기므로, 신호가 하나뿐이면 확정하지 않고 사람이 확인합니다."
    },
    {
      "name": "known-admin-baseline",
      "technique": "T1078 탐지 안내(정상 계정의 평소 사용과 대조)",
      "match": {
        "normal": "T1068·T1078 표시가 없고 권한 신호도 없음: 지정된 관리 계정(admin·svc- 계정)의 평소 주소 로그인·평소 작업, 로그인·로그아웃, 읽기만·조회, 자기 비밀번호 변경",
        "approved": "설명에 '승인된' 변경 표기가 있으면 권한 신호가 있어도 record"
      },
      "evidence": "T1078 탐지 안내는 계정 사용을 평소 기준(정해진 관리 계정, 평소 주소·시각)과 대조하라고 하므로, 원래 관리자의 평소 작업과 승인된 변경은 기록만 합니다."
    }
  ]
});

// decide.mjs 에서 정한 기준값입니다. 패턴에는 숫자 기준이 없습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const GROUP_BASE = 0.6; // 관리자 그룹 추가
const GROUP_ORDINARY = 0.1;
const GROUP_WITH_COMMAND = 0.25;
const GROUP_NEW_ADDRESS = 0.15;
const GROUP_MANY_MAX = 0.15; // data.count 1→0, 4 이상→최대
const GROUP_READD = 0.15;
const GROUP_OFF_HOURS = 0.1;
const ELEVATION_BASE = 0.6; // 세션 권한 상승
const ELEVATION_ORDINARY = 0.1;
const ELEVATION_NEW_ADDRESS = 0.15;
const ELEVATION_OFF_HOURS = 0.1;
const ELEVATION_WITH_COMMAND = 0.15;
const COMMAND_BASE = 0.55; // 관리자 명령
const COMMAND_JUST_ADMIN = 0.3;
const COMMAND_OTHER_ACCOUNT = 0.3;
const COMMAND_NEW_ADDRESS = 0.15;
const COMMAND_OFF_HOURS = 0.15;
const OFF_HOURS_ONLY = 0.6;
const GROUP_NON_ADMIN = 0.5;
const SINGLE_SIGNAL = 0.5;
const BASELINE = 0.1;
const APPROVED = 0.2;

const [GROUP_ADD, COMMAND, ELEVATION, OFF_HOURS, GROUP_OTHER, SINGLE, KNOWN] = PATTERNS.patterns.map((p) => p.name);
const BUSINESS_START = minutesOf(PATTERNS.businessHours.start);
const BUSINESS_END = minutesOf(PATTERNS.businessHours.end);

const ADMIN_GROUP = /^(?:administrators|admins?|wheel|sudo|domain admins)$/i;
const ADMIN_GROUP_TEXT = /관리자\s*그룹/;
const NOT_ADMIN_GROUP = /관리자\s*그룹은\s*아닙니다/;
const JOIN = /추가|들어가|들어왔/;
const COMMAND_TEXT = /(?:관리자|권한)\s*명령|명령\s*실행/;
const COMMAND_FAILED = /명령이?\s*실패|실패\s*\d*\s*건/;
const NO_COMMAND = /명령은\s*없/;
const JUST_ADMIN = /방금\s*관리자가\s*된/;
const OTHER_ACCOUNT = /다른\s*계정의\s*권한/;
const NEW_ADDRESS = /처음\s*보는\s*주소|주소는\s*처음|원격\s*주소/;
const READD = /빠진.*다시/;
const ORDINARY_TEXT = /평범한\s*계정/;
const ADMIN_ACCOUNT = /^(?:admin|administrator|root|svc-)/i;
const ELEVATION_TEXT = /관리자\s*권한으로\s*바뀌|권한\s*상승/;
const ATTEMPT_ONLY = /취소|실패|명령은\s*없/;
const OFF_HOURS_TEXT = /(?:수업|업무)\s*시간\s*밖|업무처럼\s*보이지\s*않는\s*시각|새벽|심야/;
const GROUP_CHANGE_TEXT = /그룹이?\s*(?:하나\s*)?만들어|그룹\s*설명|그룹에\s*추가/;
const APPROVED_TEXT = /승인된/;
const BASELINE_TEXT = /로그인|로그아웃|읽기만|조회|평소|비밀번호를\s*변경|자료실/;

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
  const text = typeof rule.description === 'string' ? rule.description : '';
  const mitre = Array.isArray(rule.mitre) ? rule.mitre.filter((t) => typeof t === 'string') : [];
  const has = (id) => mitre.some((t) => t === id || t.startsWith(`${id}.`));
  const user = typeof data.srcuser === 'string' ? data.srcuser.trim() : '';
  const group = typeof data.group === 'string' ? data.group.trim() : '';
  const level = Number.isFinite(rule.level) ? rule.level : null;
  const repeats = toCount(data.count);

  const adminGroup = !NOT_ADMIN_GROUP.test(text) && (ADMIN_GROUP.test(group) || (!group && ADMIN_GROUP_TEXT.test(text)));
  const groupJoin = adminGroup && JOIN.test(text);
  const command = COMMAND_TEXT.test(text) && !COMMAND_FAILED.test(text) && !NO_COMMAND.test(text);
  const ordinary = ORDINARY_TEXT.test(text) || (user !== '' && !ADMIN_ACCOUNT.test(user));
  const newAddress = NEW_ADDRESS.test(text);
  const offHours = OFF_HOURS_TEXT.test(text) || outsideBusinessHours(alert.timestamp);
  const elevation = ELEVATION_TEXT.test(text);
  const privilegeMark = has('T1068') || has('T1078') || has('T1098');
  const facts = `수준 ${level ?? '없음'}${repeats === null ? '' : `, 반복 ${repeats}번`}`;
  const tags = (pairs) => pairs.filter(([on]) => on).map(([, label]) => label).join('·');
  const names = (pairs) => pairs.filter(([on]) => on).map(([, name]) => name).join('+');

  // 0. 승인된 변경은 기록만 합니다.
  if (APPROVED_TEXT.test(text)) return result(APPROVED, `${KNOWN}: 승인된 변경으로 적혀 있음, ${facts}`);
  // 원래 관리 계정(admin·svc-)이 평소대로 한 관리 작업은 기록만 합니다. 처음 보는 주소·시간 밖·남의 권한이 있으면 아래로 갑니다.
  if (ADMIN_ACCOUNT.test(user) && /평소/.test(text) && !newAddress && !offHours && !groupJoin
    && !JUST_ADMIN.test(text) && !OTHER_ACCOUNT.test(text)) {
    return result(BASELINE, `${KNOWN}: 원래 관리 계정의 평소 작업, ${facts}`);
  }

  // 1. 관리자 그룹 추가 (T1098.007)
  if (groupJoin) {
    const c = GROUP_BASE
      + (ordinary ? GROUP_ORDINARY : 0)
      + (command ? GROUP_WITH_COMMAND : 0)
      + (newAddress ? GROUP_NEW_ADDRESS : 0)
      + GROUP_MANY_MAX * scale(repeats, 1, 4)
      + (READD.test(text) ? GROUP_READD : 0)
      + (offHours ? GROUP_OFF_HOURS : 0);
    const why = tags([[true, '관리자 그룹 추가'], [ordinary, '평범한 계정'], [command, '관리자 명령'], [newAddress, '원격·처음 보는 주소'], [(repeats ?? 0) >= 2, `여러 번(${repeats})`], [READD.test(text), '빠졌다가 다시 들어옴'], [offHours, '시간 밖']]);
    return result(c, `${names([[true, GROUP_ADD], [command, COMMAND], [offHours, OFF_HOURS]])}: ${why}, ${facts}`);
  }
  // 2. 세션 권한 상승 (T1068). 취소·실패·명령 없음은 시도만 있는 것으로 봅니다(6번).
  if (elevation && !ATTEMPT_ONLY.test(text)) {
    const c = ELEVATION_BASE
      + (ordinary ? ELEVATION_ORDINARY : 0)
      + (newAddress ? ELEVATION_NEW_ADDRESS : 0)
      + (offHours ? ELEVATION_OFF_HOURS : 0)
      + (command ? ELEVATION_WITH_COMMAND : 0);
    const why = tags([[true, '세션 권한 상승'], [ordinary, '평범한 계정'], [newAddress, '처음 보는 주소'], [offHours, '시간 밖'], [command, '관리자 명령']]);
    return result(c, `${names([[true, ELEVATION], [command, COMMAND], [offHours, OFF_HOURS]])}: ${why}, ${facts}`);
  }
  // 3. 관리자 명령 (T1078·T1068)
  if (command) {
    const justAdmin = JUST_ADMIN.test(text);
    const other = OTHER_ACCOUNT.test(text);
    const c = COMMAND_BASE
      + (justAdmin ? COMMAND_JUST_ADMIN : 0)
      + (other ? COMMAND_OTHER_ACCOUNT : 0)
      + (newAddress ? COMMAND_NEW_ADDRESS : 0)
      + (offHours ? COMMAND_OFF_HOURS : 0);
    const why = tags([[true, '관리자 명령'], [justAdmin, '방금 관리자가 된 계정'], [other, '다른 계정의 권한'], [newAddress, '처음 보는 주소'], [offHours, '시간 밖']]);
    return result(c, `${names([[true, COMMAND], [offHours, OFF_HOURS]])}: ${why}, ${facts}`);
  }
  // 4. 시간 밖 권한 사용만 있음
  if (offHours && privilegeMark) {
    return result(OFF_HOURS_ONLY, `${OFF_HOURS}: 시간 밖 권한 표시만 있음, ${facts}`);
  }
  // 5. 관리자 그룹이 아닌 그룹 변경
  if (privilegeMark && ((group && !adminGroup) || GROUP_CHANGE_TEXT.test(text))) {
    return result(GROUP_NON_ADMIN, `${GROUP_OTHER}: 관리자 그룹이 아닌 그룹 변경${group ? `(${group})` : ''}, ${facts}`);
  }
  // 6. 권한 표시는 있지만 신호가 하나뿐이거나 시도만 있음
  if (privilegeMark || elevation || COMMAND_TEXT.test(text)) {
    const what = elevation ? '권한 상승 시도만' : COMMAND_TEXT.test(text) ? '관리자 명령 시도만' : '권한 표시만';
    return result(SINGLE_SIGNAL, `${SINGLE}: ${what} 있고 다른 신호 없음, ${facts}`);
  }
  // 7. 권한 신호 없음: 평소 로그인·조회·관리 계정의 평소 작업
  if (BASELINE_TEXT.test(text)) return result(BASELINE, `${KNOWN}: 권한 신호 없는 평소 사용, ${facts}`);
  return result(0, '일치 패턴 없음: 관리자 그룹·명령·권한 상승 없음');
}

// timestamp 에 적힌 시각(자기 시간대 그대로)이 업무 시간 밖인지 봅니다. 시각을 못 읽으면 밖으로 보지 않습니다.
function outsideBusinessHours(timestamp) {
  if (typeof timestamp !== 'string') return false;
  const m = /T(\d{2}):(\d{2})/.exec(timestamp);
  if (!m) return false;
  const minutes = Number(m[1]) * 60 + Number(m[2]);
  return minutes < BUSINESS_START || minutes >= BUSINESS_END;
}

function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
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
