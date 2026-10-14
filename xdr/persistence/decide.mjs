// persistence 경보 하나를 받아 block·alert·record 를 돌려줍니다.
// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일·네트워크를 쓰지 않으며, 앞뒤 경보를 기억하지 않습니다.
// 경보 id 나 순서, 호스트 이름은 보지 않고 규칙 수준·MITRE 표시·반복 횟수·실행 파일 경로·설명만 봅니다.

// xdr/persistence/patterns.json 을 그대로 옮겨 적은 상수입니다.
export const PATTERNS = deepFreeze({
  "moduleKey": "persistence",
  "source": "MITRE ATT&CK T1543.003 Create or Modify System Process: Windows Service (https://attack.mitre.org/techniques/T1543/003/), T1053.005 Scheduled Task/Job: Scheduled Task (https://attack.mitre.org/techniques/T1053/005/), T1547.001 Boot or Logon Autostart Execution: Registry Run Keys / Startup Folder (https://attack.mitre.org/techniques/T1547/001/)",
  "note": "경보 원문에 실제로 나오는 모양(rule.mitre 의 T1543·T1053, 설명의 '서명 없는·처음 보는·평소 목록에 없는·임의 문자열·시작 폴더' 표기, data.path 의 AppData·Temp·Startup 경로, data.count)을 보고 정했습니다. 경보 묶음에는 서명 여부·예약 작업·시작 폴더를 따로 담는 칸이 없어 설명 문장과 경로로 봅니다. 시작 폴더 경보도 rule.mitre 는 T1543 으로 붙어 있지만, 시작 폴더의 공식 기법 번호는 T1547.001 입니다. 숫자 기준은 decide.mjs 에서 정합니다.",
  "patterns": [
    {
      "name": "unsigned-or-unknown-service",
      "technique": "T1543.003 Create or Modify System Process: Windows Service",
      "match": {
        "service": "rule.mitre 에 T1543 이 있고 설명에 '서비스'가 있음",
        "newOrChanged": "새 서비스 등록('새 서비스'·'등록', '등록은 없습니다' 제외) 또는 서비스 실행 파일 변경('실행 파일이 바뀌')",
        "signals": "서명 없음('서명 없는·서명이 없'), 평소 목록 밖('평소 목록에 없는·처음 보는'), 사용자 쓰기 가능 경로(data.path 의 \\AppData\\·\\Temp\\·\\Users\\Public\\ 또는 설명의 '임시 폴더'), 다시 켜도 남음('다시 켜도 남'), 반복(data.count 2 이상)"
      },
      "evidence": "T1543.003: 공격자는 Windows 서비스를 새로 만들거나 기존 서비스의 실행 파일을 바꿔 부팅 때마다 악성 프로그램이 다시 실행되게 하며, 서명 없는 실행 파일·평소 목록에 없는 서비스·사용자가 쓸 수 있는 경로가 그 흔적입니다."
    },
    {
      "name": "unfamiliar-scheduled-task",
      "technique": "T1053.005 Scheduled Task/Job: Scheduled Task",
      "match": {
        "task": "rule.mitre 에 T1053 이 있거나 설명에 '예약 작업'이 있음",
        "unfamiliar": "설명에 '처음 보는·평소 목록에 없는·임의 문자열' 표기",
        "signals": "사용자 쓰기 가능 경로(위와 같음), 수업 시간 밖 실행('수업 시간 밖'), 서명 없음"
      },
      "evidence": "T1053.005: 공격자는 Windows 작업 스케줄러에 예약 작업을 만들어 로그온·부팅·정해진 시각마다 악성 프로그램을 실행하며, 평소 목록에 없는 작업 이름과 임시 폴더의 실행 파일이 그 흔적입니다."
    },
    {
      "name": "startup-folder-change",
      "technique": "T1547.001 Boot or Logon Autostart Execution: Registry Run Keys / Startup Folder",
      "match": {
        "startup": "data.path 에 \\Start Menu\\Programs\\Startup\\ 이 있거나, 설명에 '시작 폴더·시작 프로그램·시작 항목'과 추가·변경·가리킴 표기('읽기만' 제외)",
        "signals": "평소 목록 밖, 사용자 쓰기 가능 경로, 예약 작업·서비스와 같은 파일을 함께 가리킴(rule.mitre 에 T1543·T1053 이 함께 있거나 설명에 '예약 작업'도 있음)"
      },
      "evidence": "T1547.001: 사용자 시작 폴더(%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\Startup)에 프로그램을 넣으면 로그온할 때마다 실행되므로, 파일 무결성 경보의 시작 폴더 추가·변경이 지속 실행 흔적입니다."
    },
    {
      "name": "temp-executable-only",
      "technique": "T1543.003 Windows Service, T1053.005 Scheduled Task (등록 전 단계)",
      "match": {
        "path": "사용자 쓰기 가능 경로에 실행 파일이 있음",
        "noRegistration": "서비스·예약 작업·시작 폴더 등록이 없음('등록은 없습니다')"
      },
      "evidence": "T1543.003·T1053.005 모두 서비스나 예약 작업이 그 파일을 실행하도록 등록돼야 지속성이 생기므로, 임시 폴더의 실행 파일만으로는 확정하지 않고 사람이 확인합니다."
    },
    {
      "name": "single-persistence-signal",
      "technique": "T1543.003 Windows Service, T1053.005 Scheduled Task, T1547.001 Startup Folder",
      "match": {
        "mechanism": "서비스·예약 작업·시작 항목 변화가 있음(rule.mitre 의 T1543·T1053 또는 설명)",
        "weak": "서명 없음·평소 목록 밖·사용자 쓰기 가능 경로가 하나도 뚜렷하지 않음(서명 '확인되지 않았·아직 모름', 수업 시간·수업 과제 이름, 설명만 변경, 같은 파일로 재시작)"
      },
      "evidence": "세 기법 모두 정상 관리 작업(수업 도구 등록, 예약 백업, 서비스 재시작)과 같은 기록을 남기므로, 신호가 하나뿐이면 사람이 평소 목록과 대조해야 합니다."
    },
    {
      "name": "known-baseline",
      "technique": "T1543.003·T1053.005 탐지 안내(알려진 소프트웨어·정기 업데이트와 대조)",
      "match": {
        "normal": "설명에 '서명된 채로·평소 시각에 그대로·평소 저장소·읽기만·기존 예약 작업이 … 마쳤' 표기",
        "noStrongSignal": "서명 없음·평소 목록 밖·사용자 쓰기 가능 경로 신호가 없음"
      },
      "evidence": "MITRE 탐지 안내는 서비스·예약 작업 변화를 알려진 소프트웨어와 정기 패치 주기와 대조하라고 하므로, 서명된 기존 서비스·평소 시각의 업데이트 예약·기존 작업의 정상 완료는 기록만 합니다."
    }
  ]
});

// decide.mjs 에서 정한 기준값입니다. 패턴에는 숫자 기준이 없습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const SERVICE_BASE = 0.55; // 새 서비스 등록·실행 파일 변경
const TASK_UNFAMILIAR = 0.7; // 평소 목록 밖 예약 작업
const STARTUP_BASE = 0.6; // 시작 폴더 추가·변경
const ADD_UNSIGNED = 0.2;
const ADD_UNFAMILIAR = 0.15;
const ADD_WRITABLE_SERVICE = 0.1;
const ADD_WRITABLE_TASK = 0.15;
const ADD_WRITABLE_STARTUP = 0.1;
const ADD_REBOOT = 0.05;
const ADD_REPEAT_MAX = 0.1; // data.count 1→0, 3 이상→최대
const ADD_OFF_HOURS = 0.05;
const ADD_SECOND_MECHANISM = 0.15;
const TEMP_ONLY = 0.5;
const SINGLE_SIGNAL = 0.5;
const SINGLE_NEW_TASK = 0.55;
const BASELINE = 0.1;

const [SERVICE, TASK, STARTUP, TEMP_EXE, SINGLE, KNOWN] = PATTERNS.patterns.map((p) => p.name);

const UNSIGNED = /서명\s*(?:이|은)?\s*없/;
const UNFAMILIAR = /처음\s*보는|평소\s*목록에\s*없|임의\s*문자열/;
const NO_REGISTRATION = /등록은\s*없/;
const NEW_SERVICE = /새\s*서비스|서비스\s*등록|등록(?:됐|되었|했)/;
const CHANGED_EXE = /실행\s*파일이\s*바뀌/;
const REBOOT = /다시\s*켜도\s*남/;
const OFF_HOURS = /수업\s*시간\s*밖/;
const TEMP_TEXT = /임시\s*폴더|임시\s*파일/;
const STARTUP_TEXT = /시작\s*(?:폴더|프로그램|항목)/;
const STARTUP_CHANGE = /추가|변경|바뀌|가리킵|생겼|있습니다/;
const READ_ONLY = /읽기만/;
const NORMAL_TEXT = /서명된|정상\s*업데이트|평소\s*시각에\s*그대로|평소\s*저장소|읽기만|기존\s*예약\s*작업이.*마쳤/;
const WRITABLE_PATH = /\\(?:AppData|Temp|Tmp)\\|\\Users\\Public\\|\\ProgramData\\[^\\]+\.exe$/i;
const STARTUP_PATH = /\\Start Menu\\Programs\\Startup\\/i;

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
  const path = typeof data.path === 'string' ? data.path : '';
  const level = Number.isFinite(rule.level) ? rule.level : null;
  const repeats = toCount(data.count);

  const unsigned = UNSIGNED.test(text);
  const unfamiliar = UNFAMILIAR.test(text);
  const writable = WRITABLE_PATH.test(path) || TEMP_TEXT.test(text);
  // '서비스 등록은 없습니다'처럼 서비스가 없다고 적힌 경보는 서비스 변화로 보지 않습니다.
  const service = has('T1543') && /서비스/.test(text) && !NO_REGISTRATION.test(text);
  const task = has('T1053') || /예약\s*작업/.test(text);
  const startup = STARTUP_PATH.test(path) || (STARTUP_TEXT.test(text) && STARTUP_CHANGE.test(text) && !READ_ONLY.test(text));
  const registered = !NO_REGISTRATION.test(text) && NEW_SERVICE.test(text);
  const changedExe = CHANGED_EXE.test(text);
  const facts = `수준 ${level ?? '없음'}${repeats === null ? '' : `, 반복 ${repeats}번`}`;
  const tags = (pairs) => pairs.filter(([on]) => on).map(([, label]) => label).join('·');

  // 1. 서명 없는 새 서비스·평소 목록 밖 서비스 (T1543.003)
  if (service && (registered || changedExe) && (unsigned || unfamiliar || writable)) {
    const c = SERVICE_BASE
      + (unsigned ? ADD_UNSIGNED : 0)
      + (unfamiliar ? ADD_UNFAMILIAR : 0)
      + (writable ? ADD_WRITABLE_SERVICE : 0)
      + (REBOOT.test(text) ? ADD_REBOOT : 0)
      + ADD_REPEAT_MAX * scale(repeats, 1, 3);
    const why = tags([[registered, '새 등록'], [changedExe, '실행 파일 변경'], [unsigned, '서명 없음'], [unfamiliar, '평소 목록 밖'], [writable, '사용자 쓰기 가능 경로'], [REBOOT.test(text), '재부팅 뒤에도 남음']]);
    return result(c, `${SERVICE}: ${why}, ${facts}`);
  }
  // 2. 시작 폴더 추가·변경 (T1547.001). 예약 작업과 함께 가리키면 두 기법이 겹친 것으로 봅니다.
  if (startup) {
    const second = (has('T1543') && has('T1053')) || (task && STARTUP_TEXT.test(text));
    const c = STARTUP_BASE
      + (unfamiliar ? ADD_UNFAMILIAR : 0)
      + (writable ? ADD_WRITABLE_STARTUP : 0)
      + (second ? ADD_SECOND_MECHANISM : 0)
      + (unsigned ? ADD_UNSIGNED : 0);
    const why = tags([[true, '시작 폴더 변경'], [unfamiliar, '평소 목록 밖'], [writable, '사용자 쓰기 가능 경로'], [second, '예약 작업과 같은 파일'], [unsigned, '서명 없음']]);
    return result(c, `${second ? `${STARTUP}+${TASK}` : STARTUP}: ${why}, ${facts}`);
  }
  // 3. 평소 목록 밖 예약 작업 (T1053.005)
  if (task && unfamiliar) {
    const c = TASK_UNFAMILIAR
      + (writable ? ADD_WRITABLE_TASK : 0)
      + (OFF_HOURS.test(text) ? ADD_OFF_HOURS : 0)
      + (unsigned ? ADD_UNSIGNED : 0);
    const why = tags([[true, '평소 목록 밖'], [writable, '사용자 쓰기 가능 경로'], [OFF_HOURS.test(text), '수업 시간 밖'], [unsigned, '서명 없음']]);
    return result(c, `${TASK}: ${why}, ${facts}`);
  }
  // 4. 정상 기준과 맞음: 서명된 기존 서비스, 평소 시각의 예약, 정상 업데이트, 읽기만
  if (NORMAL_TEXT.test(text) && !unsigned && !unfamiliar && !writable) {
    return result(BASELINE, `${KNOWN}: 평소 목록·서명된 기존 항목과 맞음, ${facts}`);
  }
  // 5. 임시 폴더 실행 파일만 있고 등록은 없음
  if (writable && !service && !task && !startup) {
    return result(TEMP_ONLY, `${TEMP_EXE}: 사용자 쓰기 가능 경로의 실행 파일, 서비스·예약 작업 등록 없음, ${facts}`);
  }
  // 6. 지속 기법 표시는 있지만 신호가 하나뿐임
  if (service || task || has('T1543') || has('T1053') || has('T1547')) {
    const newTask = task && /만들었|생성/.test(text);
    const c = unsigned ? SINGLE_SIGNAL + ADD_UNSIGNED : newTask ? SINGLE_NEW_TASK : SINGLE_SIGNAL;
    const what = service ? '서비스 변화' : task ? '예약 작업' : '지속 기법 표시';
    return result(c, `${SINGLE}: ${what}만 있고 서명 없음·평소 목록 밖·사용자 쓰기 가능 경로가 뚜렷하지 않음, ${facts}`);
  }
  return result(0, '일치 패턴 없음: 서비스·예약 작업·시작 폴더 변화 없음');
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
