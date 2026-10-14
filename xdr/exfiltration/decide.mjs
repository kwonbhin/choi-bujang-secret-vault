// exfiltration 경보 하나를 받아 block·alert·record 를 돌려줍니다.
// 이 파일은 다른 파일·패키지를 불러오지 않고, 파일·네트워크를 쓰지 않으며, 앞뒤 경보를 기억하지 않습니다.
// 경보 id 나 순서, 호스트 이름, 목적지 주소 값 자체는 보지 않고 규칙 수준·MITRE 표시·크기·파일 수·반복·시각·설명만 봅니다.
// '백업'이라는 이름만으로는 정상으로 보지 않습니다. 평소 목적지 표기나 승인 표시가 있어야 record 입니다.

// xdr/exfiltration/patterns.json 을 그대로 옮겨 적은 상수입니다.
export const PATTERNS = deepFreeze({
  "moduleKey": "exfiltration",
  "source": "MITRE ATT&CK T1041 Exfiltration Over C2 Channel (https://attack.mitre.org/techniques/T1041/), T1048 Exfiltration Over Alternative Protocol (https://attack.mitre.org/techniques/T1048/), T1560 Archive Collected Data (https://attack.mitre.org/techniques/T1560/)",
  "note": "경보 원문에 실제로 나오는 모양(rule.mitre 의 T1041·T1048, data.dstip·bytes·files·count, 설명의 '처음 보는 목적지·외부 주소·평소와 다른 주소·평소에 쓰지 않던 포트·압축 파일·명령 통로·평소 목적지·수업 자료 주소·자료실·백업처럼 보이는' 표기)을 보고 정했습니다. 경보 묶음에는 도메인·파일 종류·압축 여부·평소 목적지 여부를 담는 칸이 없어 설명 문장과 숫자 칸으로 봅니다. 압축 후 반출은 T1048·T1041 에 더해 T1560 을 근거로 적었습니다. 기준값은 아래 thresholds·businessHours 에 적었고, 점수는 decide.mjs 에서 정합니다.",
  "thresholds": {
    "largeBytes": 50000000,
    "mediumBytes": 5000000,
    "manyFiles": 50,
    "manyRepeats": 5,
    "evidence": "원문에서 공격으로 적힌 전송(ex-01~10, '대용량·자료실 전체·큰 파일' 표기)은 70,000,000~320,000,000 바이트이고, 애매한 전송(ex-11~20, '중간 크기·작은 파일·큰 파일은 아닙니다')은 0~15,000,000 바이트입니다. 그 사이인 50,000,000 바이트(50MB) 이상을 대용량, 5,000,000 바이트 이상을 중간 크기로 봅니다. 파일 수는 공격 60~400건, 애매 1~12건이라 50건 이상을 많음으로, 반복은 공격 8~15번, 애매 3번이라 5번 이상을 반복으로 봅니다."
  },
  "businessHours": {
    "start": "09:00",
    "end": "17:00",
    "timezone": "경보 timestamp 에 적힌 +09:00 그대로",
    "evidence": "원문의 정상 이벤트(ex-21~30)와 '수업 시간에' 경보(ex-13 10:17)가 모두 09:03~16:08 에 있어 09:00 이상 17:00 미만을 수업(업무) 시간으로 봅니다. 다만 '수업 시간 밖'(ex-02 09:16)·'업무 시간 밖'(ex-06 12:02)이라고 적힌 경보의 timestamp 도 이 안에 있어 시각 칸과 설명이 어긋나므로, 시간 밖 신호는 설명 표기 또는 시각 둘 중 하나만 맞아도 셉니다."
  },
  "patterns": [
    {
      "name": "large-transfer-new-destination",
      "technique": "T1048 Exfiltration Over Alternative Protocol, T1041 Exfiltration Over C2 Channel",
      "match": {
        "destination": "설명에 '처음 보는 목적지·처음 보는 주소·목적지는 처음·평소와 다른 주소·외부 주소·다른 주소' 표기",
        "volume": "data.bytes 가 largeBytes 이상이거나 data.files 가 manyFiles 이상"
      },
      "evidence": "T1048·T1041: 공격자는 모은 자료를 평소 쓰지 않는 바깥 목적지로 내보내며, MITRE 탐지 안내는 평소와 다른 목적지로 가는 많은 양(high volume)의 전송을 유출 흔적으로 봅니다."
    },
    {
      "name": "archive-exfiltration",
      "technique": "T1560 Archive Collected Data + T1048 Exfiltration Over Alternative Protocol",
      "match": {
        "archive": "설명에 '압축 파일' 표기가 있고 실제로 나감('나갔·올라갔·전송·복사', '전송은 아직 없습니다' 제외)",
        "signals": "처음 보는 목적지, 대용량, 시간 밖"
      },
      "evidence": "T1560: 공격자는 빼낼 자료를 반출 전에 압축·암호화해 크기를 줄이고 내용을 숨기므로(Both compression and encryption are done prior to exfiltration), 압축 파일이 바깥으로 나가는 것이 유출 흔적입니다."
    },
    {
      "name": "repeated-bulk-transfer",
      "technique": "T1041 Exfiltration Over C2 Channel, T1048 Exfiltration Over Alternative Protocol",
      "match": {
        "repeat": "data.count 가 manyRepeats 이상이거나 설명에 '반복·연속' 표기",
        "with": "대용량 또는 처음 보는 목적지·명령 통로"
      },
      "evidence": "T1041·T1048: 많은 자료를 한 번에 보내지 않고 같은 목적지로 여러 번 나눠 보내도 합친 양이 크면 유출이며, 명령 통로(C2)로 반복해서 큰 자료가 나가는 것이 T1041 의 형태입니다."
    },
    {
      "name": "alternative-port-transfer",
      "technique": "T1048 Exfiltration Over Alternative Protocol",
      "match": {
        "port": "설명에 '평소에 쓰지 않던 포트·다른 프로토콜' 표기"
      },
      "evidence": "T1048: 공격자는 평소 통신과 다른 프로토콜·포트로 자료를 내보내 감시를 피하므로, 평소 쓰지 않던 포트로 자료가 나가는 것이 그 흔적입니다."
    },
    {
      "name": "off-hours-transfer",
      "technique": "T1048 Exfiltration Over Alternative Protocol (탐지 안내: off-hours activity)",
      "match": {
        "time": "설명의 '수업 시간 밖·업무 시간 밖' 표기, 또는 timestamp 가 businessHours 밖",
        "with": "실제 바깥 전송"
      },
      "evidence": "T1048 탐지 안내는 업무 시간 밖(off-hours)의 바깥 전송을 유출 신호로 보므로, 다른 신호와 겹치면 확신도를 올립니다."
    },
    {
      "name": "archive-staging",
      "technique": "T1560 Archive Collected Data",
      "match": {
        "archive": "압축 파일을 만들었거나 열었지만 바깥 전송은 아직 없거나 일부뿐"
      },
      "evidence": "T1560 압축은 반출 전 준비 단계라 전송이 없으면 유출로 확정할 수 없으므로 사람이 확인합니다."
    },
    {
      "name": "single-transfer-signal",
      "technique": "T1041 Exfiltration Over C2 Channel, T1048 Exfiltration Over Alternative Protocol",
      "match": {
        "mitre": "rule.mitre 에 T1041·T1048 이 있지만 신호가 하나뿐이거나 애매함(처음 보는 주소로 작은 파일, 전송량이 한 번 높음, 실패한 전송, 명령 통로의 짧은 이름, 백업처럼 보이지만 평소 목적지·승인 표시가 없음)"
      },
      "evidence": "T1041·T1048 의 전송 기록은 정상 업로드·동기화와 모양이 같으므로, 신호가 하나뿐이면 확정하지 않고 사람이 확인합니다."
    },
    {
      "name": "known-destination-baseline",
      "technique": "T1048 탐지 안내(평소 사용자 행동과 대조)",
      "match": {
        "usual": "설명에 '평소 목적지·수업 자료 주소·자료실'이 있고 크기가 mediumBytes 미만이며 다른 신호가 없음",
        "approved": "설명에 '승인된' 표기가 있고 처음 보는 목적지가 아님",
        "noTransfer": "T1041·T1048 표시가 없고 바깥 전송 신호도 없음(읽기·저장·로그아웃 등)"
      },
      "evidence": "T1048 탐지 안내는 평소 사용자 행동에서 벗어난 전송을 보라고 하므로, 평소 목적지로 가는 작은 동기화·승인된 백업·일반 읽기는 기록만 합니다. 이름이 '백업'이라는 것만으로는 정상으로 보지 않습니다."
    }
  ]
});

// decide.mjs 에서 정한 점수입니다. 크기·파일 수·반복·업무 시간 기준은 PATTERNS 에 있습니다.
const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
const TRANSFER_BASE = 0.4; // 바깥 전송이 있음
const ADD_NEW_DESTINATION = 0.2;
const ADD_LARGE = 0.25;
const ADD_MEDIUM = 0.05;
const ADD_MANY_FILES = 0.15;
const ADD_REPEAT = 0.2;
const ADD_ARCHIVE = 0.15;
const ADD_OFF_HOURS = 0.1;
const ADD_PORT = 0.15;
const REVIEW_FLOOR = ALERT_AT; // T1041·T1048 표시가 있는 전송은 정상 기준에 맞지 않으면 사람이 봄
const STAGING = 0.5;
const APPROVED = 0.2;
const BASELINE = 0.1;

const [LARGE_NEW, ARCHIVE_OUT, REPEATED, PORT, OFF_HOURS, STAGE, SINGLE, KNOWN] = PATTERNS.patterns.map((p) => p.name);
const { largeBytes: LARGE_BYTES, mediumBytes: MEDIUM_BYTES, manyFiles: MANY_FILES, manyRepeats: MANY_REPEATS } = PATTERNS.thresholds;
const BUSINESS_START = minutesOf(PATTERNS.businessHours.start);
const BUSINESS_END = minutesOf(PATTERNS.businessHours.end);

const NEW_DESTINATION = /처음\s*보는\s*(?:목적지|주소)|목적지는\s*처음|평소와\s*다른\s*주소|외부\s*주소|다른\s*주소/;
const USUAL_DESTINATION = /평소\s*목적지|수업\s*자료\s*주소|자료실/;
const PORT_TEXT = /평소에?\s*쓰지\s*않던\s*포트|다른\s*프로토콜/;
const ARCHIVE_TEXT = /압축\s*파일/;
const SENT_TEXT = /나갔|올라갔|전송|복사/;
const NO_TRANSFER = /전송은\s*(?:아직\s*)?없|외부\s*전송은\s*(?:아직\s*)?없/;
const PARTIAL = /일부만/;
const FAILED = /실패/;
const REPEAT_TEXT = /반복|연속/;
const C2_TEXT = /명령\s*통로/;
const LARGE_TEXT = /대용량|자료실\s*전체|큰\s*파일(?!은\s*아닙니다)/;
const NOT_LARGE_TEXT = /큰\s*파일은\s*아닙니다|작은\s*(?:파일|동기화)/;
const OFF_HOURS_TEXT = /(?:수업|업무)\s*시간\s*밖|새벽|심야/;
const APPROVED_TEXT = /승인된/;
const BACKUP_TEXT = /백업/;
const ORDINARY_USE = /읽었|저장했|받았|열었|새로고침|확인|로그아웃|로그인/;

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
  const level = Number.isFinite(rule.level) ? rule.level : null;
  const bytes = toCount(data.bytes);
  const files = toCount(data.files);
  const repeats = toCount(data.count);

  const exfilMark = has('T1041') || has('T1048');
  const noTransfer = NO_TRANSFER.test(text);
  const sent = !noTransfer && (SENT_TEXT.test(text) || C2_TEXT.test(text));
  const newDestination = NEW_DESTINATION.test(text);
  const usualDestination = USUAL_DESTINATION.test(text) && !newDestination;
  const large = !NOT_LARGE_TEXT.test(text) && ((bytes ?? 0) >= LARGE_BYTES || LARGE_TEXT.test(text));
  const medium = !large && (bytes ?? 0) >= MEDIUM_BYTES;
  const manyFiles = (files ?? 0) >= MANY_FILES;
  const repeated = (repeats ?? 0) >= MANY_REPEATS || (REPEAT_TEXT.test(text) && (large || newDestination));
  const archive = ARCHIVE_TEXT.test(text);
  const staging = archive && (noTransfer || PARTIAL.test(text));
  const port = PORT_TEXT.test(text);
  const offHours = OFF_HOURS_TEXT.test(text) || outsideBusinessHours(alert.timestamp);
  const backupLike = BACKUP_TEXT.test(text);
  const size = bytes === null ? '크기 없음' : `${bytes}바이트`;
  const facts = `${size}${files === null ? '' : `, 파일 ${files}건`}${repeats === null ? '' : `, 반복 ${repeats}번`}, 수준 ${level ?? '없음'}`;

  // 0. 승인 표시가 있고 처음 보는 목적지가 아니면 기록만 합니다.
  if (APPROVED_TEXT.test(text) && !newDestination) {
    return result(APPROVED, `${KNOWN}: 승인된 전송${backupLike ? '(백업)' : ''}, ${facts}`);
  }
  // 바깥 전송도 유출 표시도 없으면(읽기·저장·로그아웃 등) 기록만 합니다.
  if (!sent && !exfilMark && !archive) {
    return result(noTransfer || ORDINARY_USE.test(text) ? BASELINE : 0, `${KNOWN}: 바깥 전송 신호 없음, ${facts}`);
  }
  // 평소 목적지로 가는 작은 전송이고 다른 신호가 없으면 기록만 합니다.
  if (usualDestination && (bytes ?? 0) < MEDIUM_BYTES && !manyFiles && !repeated && !archive && !port && !offHours && !/한\s*번\s*(?:높|늘)/.test(text)) {
    return result(BASELINE, `${KNOWN}: 평소 목적지로 가는 작은 전송, ${facts}`);
  }
  // 1. 압축만 하고 바깥 전송은 없음
  if (archive && noTransfer) {
    return result(STAGING, `${STAGE}: 압축 파일을 만들었지만 바깥 전송은 없음, ${facts}`);
  }

  const c = (sent ? TRANSFER_BASE : 0)
    + (newDestination ? ADD_NEW_DESTINATION : 0)
    + (large ? ADD_LARGE : medium ? ADD_MEDIUM : 0)
    + (manyFiles ? ADD_MANY_FILES : 0)
    + (repeated ? ADD_REPEAT : 0)
    + (archive && sent ? ADD_ARCHIVE : 0)
    + (offHours && sent ? ADD_OFF_HOURS : 0)
    + (port ? ADD_PORT : 0);
  const named = [
    [newDestination && (large || manyFiles), LARGE_NEW],
    [archive && sent && !staging, ARCHIVE_OUT],
    [staging, STAGE],
    [repeated && (large || newDestination || C2_TEXT.test(text)), REPEATED],
    [port, PORT],
    [offHours && sent && (large || archive || repeated || newDestination), OFF_HOURS],
  ].filter(([on]) => on).map(([, name]) => name);
  const why = [
    [newDestination, '처음 보는 목적지'], [large, '대용량'], [medium, '중간 크기'], [manyFiles, '파일 많음'],
    [repeated, '반복'], [archive, staging ? '압축 파일(일부·미전송)' : '압축 파일'], [port, '평소 쓰지 않던 포트'],
    [offHours, '시간 밖'], [C2_TEXT.test(text), '명령 통로'], [FAILED.test(text), '전송 실패'],
    [backupLike && !APPROVED_TEXT.test(text) && !usualDestination, '백업처럼 보이지만 평소 목적지·승인 표시 없음'],
    [backupLike && APPROVED_TEXT.test(text), '승인 표시가 있지만 처음 보는 목적지'], [usualDestination, '평소 목적지 표기'],
  ].filter(([on]) => on).map(([, label]) => label).join('·') || '신호 하나';
  const score = exfilMark || sent ? Math.max(c, REVIEW_FLOOR) : c;
  // 시간 밖 하나만으로는 패턴 이름을 붙이지 않고 single-transfer-signal 로 둡니다.
  const name = named.length === 1 && named[0] === OFF_HOURS ? SINGLE : named.join('+') || SINGLE;
  return result(score, `${name}: ${why}, ${facts}`);
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
