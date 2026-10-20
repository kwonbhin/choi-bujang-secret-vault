// 13단계: 로그인 사용자·기기·세션 표시 (학생 구현 영역)
// 수정 대상은 이 파일의 renderIdentity 입니다. 호스트(public/app.js)는 건드리지 않습니다.
//
// 입력: renderIdentity({ me, devices, sessions })
//   me, devices, sessions 는 각각 { status, mode, data?, error? }
//     status: 'loading' | 'ok' | 'error'
//     mode:   'demo' | 'disconnected' | 'unknown' | 그 외(실시간)
//   me.data:       { user:{ id, label }, device:{ id, label, status }, session:{ id, status } }
//   devices.data:  [{ id, label, status }]
//   sessions.data: [{ id, status }]
//   기기 status: 'compliant' | 'noncompliant' | 'unknown'
//   세션 status: 'active' | 'expired' | 'revoked' | 'unknown'
//
// 규칙: document.createElement 와 textContent 만 씁니다. innerHTML 금지.
//       DOM 요소 하나를 돌려줍니다. 오류일 때 이전 사용자 값이 남지 않도록,
//       호출부(createStudentView.update)가 노드를 통째로 교체합니다.
//       한국어 상태 설명 옆에 서버가 준 '원래 상태 코드'도 함께 표시하고,
//       세션 ID 는 받은 원본을 그대로 보여 줍니다(자르지 않음).

// --- 상태값 → 화면 문구 (의미를 바꾸지 않는 정확한 한국어) ---
const DEVICE_STATUS_TEXT = {
  compliant: '보안 기준 충족',
  noncompliant: '보안 기준 미충족',
  unknown: '확인 불가',
};
const SESSION_STATUS_TEXT = {
  active: '활성',
  expired: '만료',
  revoked: '철회됨',
  unknown: '확인 불가',
};
// 색뿐 아니라 텍스트로도 구분하기 위한 톤. warn 은 '정상처럼 보이지 않게' 표시합니다.
const DEVICE_TONE = { compliant: 'ok', noncompliant: 'warn', unknown: 'unknown' };
const SESSION_TONE = { active: 'ok', expired: 'warn', revoked: 'warn', unknown: 'unknown' };
const MODE_TEXT = {
  demo: '예제 자료',
  disconnected: '연결 없음',
  unknown: '확인 불가',
};

// 서버가 준 원래 상태 코드. 값이 없으면 계약상 '확인 불가'에 해당하는 unknown 으로 둡니다.
const statusCode = (s) => (s === undefined || s === null || s === '') ? 'unknown' : String(s);
// 한국어 설명 옆에 원래 상태 코드를 괄호로 함께 표시합니다. 예: "보안 기준 충족 (compliant)"
const deviceStatusLabel = (s) => `${DEVICE_STATUS_TEXT[s] ?? '확인 불가'} (${statusCode(s)})`;
const sessionStatusLabel = (s) => `${SESSION_STATUS_TEXT[s] ?? '확인 불가'} (${statusCode(s)})`;
const deviceTone = (s) => DEVICE_TONE[s] ?? 'unknown';
const sessionTone = (s) => SESSION_TONE[s] ?? 'unknown';
const modeText = (mode) => MODE_TEXT[mode] ?? '';

// 라벨 + 값 한 줄. warn 톤이면 값 끝에 '· 주의'를 텍스트로 붙여 정상과 구별합니다.
function row(labelText, valueText, tone) {
  const el = document.createElement('p');
  el.className = 'identity-row';

  const label = document.createElement('span');
  label.className = 'identity-label';
  label.textContent = labelText;

  const value = document.createElement('span');
  value.className = 'identity-value';
  value.textContent = tone === 'warn' ? `${valueText} · 주의` : valueText;
  if (tone) value.dataset.tone = tone; // data-tone 으로 색 없이도 상태 구분

  el.append(label, value);
  return el;
}

// 전달받은 mode(demo/disconnected/unknown) 안내. 그 밖의 mode 는 표시하지 않습니다.
function modeNotice(mode) {
  const text = modeText(mode);
  if (!text) return null;
  const el = document.createElement('p');
  el.className = 'identity-mode';
  el.dataset.mode = mode;
  el.textContent = text;
  return el;
}

// me·devices·sessions 공통 뼈대. 제목 + (전달되면) mode 안내를 먼저 둡니다.
function blockShell(titleText, field, kind) {
  const section = document.createElement('section');
  section.className = 'identity-block';
  section.dataset.field = kind;
  section.dataset.status = field?.status ?? 'unknown';

  const heading = document.createElement('h3');
  heading.className = 'identity-block-title';
  heading.textContent = titleText;
  section.append(heading);

  const notice = modeNotice(field?.mode);
  if (notice) section.append(notice); // loading·error 상태에서도 mode 안내는 함께 표시

  return section;
}

// loading / error 공통 처리. error 면 사용자 값을 만들지 않습니다.
function appendStateLine(section, field) {
  if (field?.status === 'loading') {
    section.append(row('상태', '불러오는 중'));
    return true;
  }
  if (field?.status === 'error') {
    const message = field?.error?.message ?? '확인 불가';
    section.append(row('상태', `연결 실패: ${message}`, 'alert'));
    return true;
  }
  return false; // ok 등은 호출부에서 처리
}

function renderMeBlock(me) {
  const section = blockShell('내 계정', me, 'me');
  if (appendStateLine(section, me)) return section;

  const data = me?.data;
  if (!data) {
    section.append(row('상태', '확인 불가 (unknown)', 'unknown'));
    return section;
  }
  const user = data.user ?? {};
  const device = data.device ?? {};
  const session = data.session ?? {};

  section.append(row('사용자', user.label ?? '확인 불가', user.label ? undefined : 'unknown'));
  // 서버 ID 원본도 함께 (있을 때)
  if (user.id) section.append(row('사용자 ID', String(user.id)));
  section.append(row(
    '현재 기기',
    `${device.label ?? '확인 불가'} — ${deviceStatusLabel(device.status)}`,
    deviceTone(device.status),
  ));
  section.append(row('현재 세션', sessionStatusLabel(session.status), sessionTone(session.status)));
  if (session.id) section.append(row('세션 ID', String(session.id)));
  return section;
}

function renderDevicesBlock(devices) {
  const section = blockShell('등록 기기', devices, 'devices');
  if (appendStateLine(section, devices)) return section;

  const list = Array.isArray(devices?.data) ? devices.data : [];
  if (!list.length) {
    section.append(row('상태', '표시할 기기가 없습니다.', 'unknown'));
    return section;
  }
  const ul = document.createElement('ul');
  ul.className = 'identity-list';
  for (const device of list) {
    const li = document.createElement('li');
    li.append(row(
      device?.label ?? '확인 불가',
      deviceStatusLabel(device?.status),
      deviceTone(device?.status),
    ));
    ul.append(li);
  }
  section.append(ul);
  return section;
}

function renderSessionsBlock(sessions) {
  const section = blockShell('로그인 세션', sessions, 'sessions');
  if (appendStateLine(section, sessions)) return section;

  const list = Array.isArray(sessions?.data) ? sessions.data : [];
  if (!list.length) {
    section.append(row('상태', '표시할 세션이 없습니다.', 'unknown'));
    return section;
  }
  const ul = document.createElement('ul');
  ul.className = 'identity-list';
  for (const session of list) {
    // 세션 ID 는 원본을 그대로 표시합니다(자르지 않음).
    const id = session?.id === undefined || session?.id === null ? '' : String(session.id);
    const li = document.createElement('li');
    li.append(row(id ? `세션 ${id}` : '세션', sessionStatusLabel(session?.status), sessionTone(session?.status)));
    ul.append(li);
  }
  section.append(ul);
  return section;
}

// 과제 핵심: 하나의 DOM 요소를 돌려줍니다.
export function renderIdentity({ me, devices, sessions } = {}) {
  const root = document.createElement('section');
  root.className = 'identity';
  root.setAttribute('aria-label', '내 계정·기기·세션');
  root.append(
    renderMeBlock(me ?? { status: 'unknown' }),
    renderDevicesBlock(devices ?? { status: 'unknown' }),
    renderSessionsBlock(sessions ?? { status: 'unknown' }),
  );
  return root;
}

// 보호 현황 메뉴에 붙는 학생 화면. update 로 새 데이터가 오면 노드를 통째로 교체합니다.
// → 이전 사용자·기기·세션 DOM 이 남지 않으므로, error 일 때 옛 사용자 이름이 사라집니다.
export function createStudentView() {
  const root = document.createElement('div');
  root.className = 'student-identity';

  const heading = document.createElement('h2');
  heading.textContent = '내 계정·기기·세션';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-identity-slot';
  slot.setAttribute('aria-live', 'polite'); // 바뀐 내용을 보조기기에 알림
  root.append(slot);

  // 최초에는 불러오는 중으로 그립니다.
  slot.append(renderIdentity({
    me: { status: 'loading' },
    devices: { status: 'loading' },
    sessions: { status: 'loading' },
  }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderIdentity(input ?? {}));
    },
  };
}
