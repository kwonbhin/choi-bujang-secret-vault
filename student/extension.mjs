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

// ===== 14단계: 업무 앱 접근 판정 표시 (renderDecision) =====
// 입력: renderDecision({ status, mode, data?, error?, appId })
//   status: 'idle'(요청 전) · 'loading' · 'ok' · 'error'
//   data: { appId, decision, reason, checkedAt }
//   decision: 'allow' · 'deny' · 'challenge' · 'unknown'
// 규칙: 한국어 뜻 + 원래 코드값 함께 표시. unknown·요청 실패는 허용/정상으로 읽히면 안 됨.
//       오류(error)는 거부(deny) 판정과 구분. createElement·textContent 만, innerHTML 금지.
const DECISION_TEXT = {
  allow: '허용',
  deny: '거부',
  challenge: '추가 확인 필요',
  unknown: '확인 불가',
};
const DECISION_TONE = {
  allow: 'ok',
  deny: 'warn',
  challenge: 'warn',
  unknown: 'unknown',
};
const isKnownDecision = (d) => d === 'allow' || d === 'deny' || d === 'challenge';

// 과제 핵심: 하나의 DOM 요소를 돌려줍니다.
export function renderDecision({ status, mode, data, error, appId } = {}) {
  const root = document.createElement('section');
  root.className = 'decision';
  root.dataset.status = status ?? 'idle';
  root.setAttribute('aria-label', '업무 앱 접근 판정');

  const notice = modeNotice(mode);
  if (notice) root.append(notice); // 전달된 mode(demo/disconnected/unknown) 안내

  const app = appId ?? data?.appId;
  if (app) root.append(row('대상 앱', String(app)));

  if (status === undefined || status === 'idle') {
    root.append(row('안내', '앱을 골라 접속을 요청하세요'));
    return root;
  }
  if (status === 'loading') {
    root.append(row('상태', '판정 확인 중'));
    return root;
  }
  if (status === 'error') {
    // 요청 실패: 접근 거부(deny)와 구분하고, 허용/정상으로 읽히지 않게 합니다.
    const message = error?.message ?? '확인 불가';
    root.append(row('상태', `요청 실패: ${message}`, 'alert'));
    root.append(row('구분', '요청이 실패한 것이며, 접근 거부 판정이 아닙니다.', 'alert'));
    return root;
  }

  // status === 'ok'
  const decision = data?.decision;
  if (isKnownDecision(decision)) {
    root.append(row('판정', `${DECISION_TEXT[decision]} (${decision})`, DECISION_TONE[decision]));
    if (decision === 'deny') {
      root.append(row('구분', '정책상 접근이 허용되지 않았습니다.', 'warn'));
    }
    if (decision === 'challenge') {
      root.append(row('안내', '추가 확인이 필요합니다. 이 앱이 확인 절차를 대신하지 않습니다.', 'warn'));
    }
  } else {
    // unknown 또는 네 값이 아님 → 확인 불가. 표시용 코드는 unknown으로 통일합니다.
    // (목록에 없는 값도 원래 값 대신 unknown으로 보여 허용/정상으로 읽히지 않게 합니다.)
    root.append(row('판정', '확인 불가 (unknown)', 'unknown'));
    root.append(row('구분', '판정을 확인할 수 없어 허용되지 않았습니다.', 'unknown'));
  }
  if (data?.reason) root.append(row('사유', String(data.reason)));
  if (data?.checkedAt) root.append(row('판정 시각', String(data.checkedAt)));
  return root;
}

// 업무 앱 메뉴에 붙는 학생 화면. update 로 새 입력이 오면 노드를 통째로 교체합니다.
export function createDecisionView() {
  const root = document.createElement('div');
  root.className = 'app-decision';

  const heading = document.createElement('h2');
  heading.textContent = '업무 앱 접근 판정';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'app-decision-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderDecision({ status: 'idle' })); // 처음에는 요청 전 안내

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderDecision(input ?? {}));
    },
  };
}

// ===== 15단계: 접속 기록·XDR 경보 목록과 상세 보기 (renderEvents) =====
// 입력: renderEvents({ status, mode, data?, error? }), data = 기록 배열
//   기록: { id, kind, at, appId, summary, evidence:[{id,text}], rules:[{id,text}],
//          state:{ access, session, device }, supportedActions:[] }
//   kind: 'access'(접속) · 'xdr'(XDR 경보)
//   state.access: allowed·denied·unknown / session·device 는 13단계와 같음
// 규칙: data 를 복사해 at 최신순 정렬(원본 불변). 각 행에 data-student-event-id.
//       「기록 종류/업무 앱/접속 상태」필터(전체=all, 나머지는 원래 값). 배열 안에서만 필터.
//       「<id> 상세」버튼 → evidence·rules·state 세 값 표시(data-student-event-detail).
//       빈 배열·조회 실패는 서로 다르게. 새 자료가 오면 목록·상세 모두 교체(호출부가 노드 교체).
//       createElement·textContent 만(<b> 등도 글자 그대로). 조치 버튼은 만들지 않음.
const KIND_TEXT = { access: '접속', xdr: 'XDR 경보' };
const ACCESS_TEXT = { allowed: '접근 허용', denied: '접근 거부', unknown: '확인 불가' };
const ACCESS_TONE = { allowed: 'ok', denied: 'warn', unknown: 'unknown' };
const kindLabel = (k) => `${KIND_TEXT[k] ?? '기타'} (${statusCode(k)})`;
const accessLabel = (a) => `${ACCESS_TEXT[a] ?? '확인 불가'} (${statusCode(a)})`;
const accessTone = (a) => ACCESS_TONE[a] ?? 'unknown';
const appLabel = (appId) => (appId === undefined || appId === null || appId === '') ? '앱을 확인할 수 없음' : String(appId);

export function renderEvents({ status, mode, data, error } = {}) {
  const root = document.createElement('section');
  root.className = 'events';
  root.dataset.status = status ?? 'ok';
  root.setAttribute('aria-label', '보안 기록');

  const notice = modeNotice(mode);
  if (notice) root.append(notice);

  if (status === 'loading') {
    root.append(row('상태', '기록을 불러오는 중'));
    return root;
  }
  if (status === 'error') {
    const message = error?.message ?? '확인 불가';
    // 형식 불일치(error.code === 'CONTRACT_MISMATCH')는 일반 실패와 달리 '기록 확인 불가'로 표시.
    if (error?.code === 'CONTRACT_MISMATCH') {
      root.append(row('상태', `기록 확인 불가 (CONTRACT_MISMATCH): ${message}`, 'unknown'));
      root.append(row('구분', '응답 형식이 맞지 않아 기록을 확인할 수 없습니다. 이전 목록은 지웁니다.', 'unknown'));
      return root;
    }
    root.append(row('상태', `기록을 불러오지 못했습니다: ${message}`, 'alert'));
    return root;
  }

  const records = Array.isArray(data) ? data : [];
  if (!records.length) {
    root.append(row('상태', '표시할 기록이 없습니다.'));
    return root;
  }

  // 원본을 복사해 at 최신순 정렬 (원본·서버 데이터 불변)
  const toTime = (v) => { const n = Date.parse(v); return Number.isNaN(n) ? null : n; };
  const sorted = records.slice().sort((a, b) => {
    const ta = toTime(a?.at), tb = toTime(b?.at);
    if (ta !== null && tb !== null) return tb - ta;
    return String(b?.at ?? '').localeCompare(String(a?.at ?? ''));
  });

  // 이 렌더 인스턴스 안에서만 유지되는 필터·상세 상태 (새로 렌더되면 초기화)
  let fKind = 'all', fApp = 'all', fAccess = 'all', detailId = null;

  const uniq = (arr) => [...new Set(arr)];
  const kinds = uniq(sorted.map((e) => e?.kind).filter((v) => v !== undefined && v !== null && v !== ''));
  const apps = uniq(sorted.map((e) => (e?.appId === undefined || e?.appId === null) ? '' : String(e.appId)));
  const accesses = uniq(sorted.map((e) => e?.state?.access).filter((v) => v !== undefined && v !== null && v !== ''));

  const makeSelect = (labelText, options, onChange) => {
    const wrap = document.createElement('label');
    wrap.className = 'events-filter';
    const span = document.createElement('span');
    span.textContent = labelText;
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', labelText);
    for (const opt of options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      sel.append(o);
    }
    sel.addEventListener('change', () => { onChange(sel.value); redraw(); });
    wrap.append(span, sel);
    return wrap;
  };

  const kindOptions = [{ value: 'all', label: '전체' }, ...kinds.map((k) => ({ value: String(k), label: `${KIND_TEXT[k] ?? k} (${k})` }))];
  const appOptions = [{ value: 'all', label: '전체' }, ...apps.map((a) => ({ value: a, label: a === '' ? '앱 없음' : a }))];
  const accessOptions = [{ value: 'all', label: '전체' }, ...accesses.map((a) => ({ value: String(a), label: `${ACCESS_TEXT[a] ?? a} (${a})` }))];

  const filters = document.createElement('div');
  filters.className = 'events-filters';
  filters.append(
    makeSelect('기록 종류', kindOptions, (v) => { fKind = v; }),
    makeSelect('업무 앱', appOptions, (v) => { fApp = v; }),
    makeSelect('접속 상태', accessOptions, (v) => { fAccess = v; }),
  );
  root.append(filters);

  const count = document.createElement('p');
  count.className = 'events-count';
  root.append(count);

  const listEl = document.createElement('ul');
  listEl.className = 'events-list';
  root.append(listEl);

  const detailEl = document.createElement('div');
  detailEl.className = 'events-detail';
  root.append(detailEl);

  function passesFilter(e) {
    if (fKind !== 'all' && String(e?.kind) !== fKind) return false;
    const appVal = (e?.appId === undefined || e?.appId === null) ? '' : String(e.appId);
    if (fApp !== 'all' && appVal !== fApp) return false;
    if (fAccess !== 'all' && String(e?.state?.access) !== fAccess) return false;
    return true;
  }

  function buildDetail(e) {
    const box = document.createElement('div');
    box.className = 'events-detail-box';
    box.setAttribute('data-student-event-detail', String(e.id));

    box.append(row('사건 ID', String(e.id)));
    box.append(row('업무 앱', appLabel(e.appId)));

    const evH = document.createElement('h4');
    evH.textContent = '근거(evidence)';
    box.append(evH);
    const evList = Array.isArray(e.evidence) ? e.evidence : [];
    if (!evList.length) box.append(row('근거', '없음'));
    else {
      const ul = document.createElement('ul');
      ul.className = 'identity-list';
      for (const ev of evList) {
        const li = document.createElement('li');
        li.append(row(String(ev?.id ?? ''), String(ev?.text ?? '')));
        ul.append(li);
      }
      box.append(ul);
    }

    const rH = document.createElement('h4');
    rH.textContent = '규칙(rules)';
    box.append(rH);
    const rList = Array.isArray(e.rules) ? e.rules : [];
    if (!rList.length) box.append(row('규칙', '없음'));
    else {
      const ul = document.createElement('ul');
      ul.className = 'identity-list';
      for (const rl of rList) {
        const li = document.createElement('li');
        li.append(row(String(rl?.id ?? ''), String(rl?.text ?? '')));
        ul.append(li);
      }
      box.append(ul);
    }

    const sH = document.createElement('h4');
    sH.textContent = '상태(state)';
    box.append(sH);
    const st = e.state ?? {};
    box.append(row('접근(access)', accessLabel(st.access), accessTone(st.access)));
    box.append(row('세션(session)', sessionStatusLabel(st.session), sessionTone(st.session)));
    box.append(row('기기(device)', deviceStatusLabel(st.device), deviceTone(st.device)));

    // 16단계: 미지원 조치가 입력된 경우에만 비활성 안내 버튼을 둡니다(요청은 보내지 않음).
    const actions = Array.isArray(e.supportedActions) ? e.supportedActions : [];
    if (actions.length) {
      const aH = document.createElement('h4');
      aH.textContent = '조치(미지원)';
      box.append(aH);
      for (const act of actions) {
        const name = (act && typeof act === 'object') ? String(act.id ?? act.action ?? '') : String(act);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'events-action-btn';
        btn.disabled = true; // 비활성: 어떤 요청도 보내지 않습니다.
        btn.textContent = `${name} 미지원`;
        btn.setAttribute('aria-label', `${name} 미지원`);
        box.append(btn);
      }
      box.append(row('안내', '조치 실행 연결은 준비 중입니다. 요청을 보내지 않습니다.'));
    }
    return box;
  }

  function redraw() {
    const filtered = sorted.filter(passesFilter);
    count.textContent = `표시 ${filtered.length}건 / 전체 ${sorted.length}건`;

    listEl.replaceChildren();
    if (!filtered.length) {
      const li = document.createElement('li');
      li.append(row('안내', '조건에 맞는 기록이 없습니다.'));
      listEl.append(li);
    } else {
      for (const e of filtered) {
        const li = document.createElement('li');
        li.className = 'events-row';
        li.setAttribute('data-student-event-id', String(e.id));
        li.append(row('사건 ID', String(e.id)));
        li.append(row('시각', String(e.at ?? '')));
        li.append(row('종류', kindLabel(e.kind)));
        li.append(row('앱', appLabel(e.appId)));
        li.append(row('요약', String(e.summary ?? '')));
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'events-detail-btn';
        btn.textContent = `${e.id} 상세`;
        btn.setAttribute('aria-label', `${e.id} 상세`);
        btn.addEventListener('click', () => { detailId = e.id; redraw(); });
        li.append(btn);
        listEl.append(li);
      }
    }

    detailEl.replaceChildren();
    if (detailId !== null) {
      const sel = sorted.find((e) => e.id === detailId);
      if (sel && passesFilter(sel)) detailEl.append(buildDetail(sel));
      else detailId = null; // 필터로 사라지면 상세를 닫습니다.
    }
  }

  redraw();
  return root;
}

// 보안 기록 메뉴에 붙는 학생 화면. update 로 새 자료가 오면 목록·상세를 통째로 교체합니다.
export function createEventsView() {
  const root = document.createElement('div');
  root.className = 'student-events';

  const heading = document.createElement('h2');
  heading.textContent = '보안 기록';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-events-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderEvents({ status: 'loading' }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderEvents(input ?? {}));
    },
  };
}

// ===== 16단계: 알림·기기·세션·진단·오류·빈 화면 (renderStatus) =====
// 입력: renderStatus({ devices, sessions, notifications, diagnostics, mode })
//   devices·sessions·diagnostics: { status, mode, data?, error? }
//   notifications: [{ resource, code, message }]
//   diagnostics.data: { requestId, component, version, checkedAt, engine:{ mode, code } }
// 규칙: 불러오는 중·빈 목록·실패를 서로 다른 문장으로. 자동 재요청 없음(사용자가 버튼 누름).
//       진단 정보는 입력으로 받음(학생이 /api/diagnostics 직접 호출하지 않음). 비밀값 표시·복사 금지.
//       "도움정보 복사" 버튼은 누를 때만 안전한 값만 복사. textContent 만.

// 실패 시 '다시 시도' 안내(자동 재요청 아님). 시간 초과면 그 사실을 드러냅니다.
function appendRetryHint(sec, field) {
  const msg = String(field?.error?.message ?? '');
  const isTimeout = field?.error?.code === 'TIMEOUT' || /timeout|시간\s*초과/i.test(msg);
  if (isTimeout) sec.append(row('구분', '요청 시간이 초과되었습니다.', 'alert'));
  sec.append(row('다시 시도', '다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요'));
}

function statusDevices(field) {
  const sec = blockShell('등록 기기 상태', field, 'status-devices');
  if (field?.status === 'loading') { sec.append(row('상태', '불러오는 중')); return sec; }
  if (field?.status === 'error') {
    sec.append(row('상태', `등록 기기를 불러오지 못했습니다: ${field?.error?.message ?? '확인 불가'}`, 'alert'));
    appendRetryHint(sec, field);
    return sec;
  }
  const list = Array.isArray(field?.data) ? field.data : [];
  if (!list.length) { sec.append(row('상태', '등록된 기기가 없습니다')); return sec; }
  const ul = document.createElement('ul');
  ul.className = 'identity-list';
  for (const d of list) {
    const li = document.createElement('li');
    li.append(row(d?.label ?? '확인 불가', deviceStatusLabel(d?.status), deviceTone(d?.status)));
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

function statusSessions(field) {
  const sec = blockShell('현재 연결(세션)', field, 'status-sessions');
  if (field?.status === 'loading') { sec.append(row('상태', '불러오는 중')); return sec; }
  if (field?.status === 'error') {
    sec.append(row('상태', `현재 연결을 불러오지 못했습니다: ${field?.error?.message ?? '확인 불가'}`, 'alert'));
    appendRetryHint(sec, field);
    return sec;
  }
  const list = Array.isArray(field?.data) ? field.data : [];
  if (!list.length) { sec.append(row('상태', '현재 연결 없음')); return sec; }
  const ul = document.createElement('ul');
  ul.className = 'identity-list';
  for (const s of list) {
    const li = document.createElement('li');
    li.append(row(`세션 ${s?.id ?? ''}`, sessionStatusLabel(s?.status), sessionTone(s?.status)));
    ul.append(li);
  }
  sec.append(ul);
  sec.append(row('안내', '현재 검증된 연결 하나만 표시합니다. 지난 세션 목록이 아닙니다.'));
  return sec;
}

function statusNotifications(notifications) {
  const sec = document.createElement('section');
  sec.className = 'status-block';
  sec.dataset.field = 'notifications';
  const h = document.createElement('h3');
  h.className = 'identity-block-title';
  h.textContent = '알림';
  sec.append(h);
  const list = Array.isArray(notifications) ? notifications : [];
  if (!list.length) { sec.append(row('상태', '주의할 알림이 없습니다')); return sec; }
  const ul = document.createElement('ul');
  ul.className = 'identity-list';
  for (const n of list) {
    const li = document.createElement('li');
    li.append(row('자료(resource)', String(n?.resource ?? '확인 불가')));
    li.append(row('코드(code)', String(n?.code ?? '')));
    li.append(row('메시지', String(n?.message ?? '')));
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

// 도움정보 복사: 누를 때만 안전한 6개 값만 복사(비밀번호·토큰·키 제외).
function appendCopyButton(sec, field) {
  const note = document.createElement('p');
  note.className = 'status-note';
  note.textContent = '아래 버튼은 도움 요청에 쓸 진단 정보만 복사합니다. 비밀번호·토큰·API 키는 포함하지 않습니다.';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'reload';
  btn.textContent = '도움정보 복사';
  btn.addEventListener('click', () => {
    const d = (field?.status === 'ok' && field?.data) ? field.data : {};
    const text = [
      `requestId: ${d.requestId ?? ''}`,
      `component: ${d.component ?? ''}`,
      `version: ${d.version ?? ''}`,
      `checkedAt: ${d.checkedAt ?? ''}`,
      `engine.mode: ${d.engine?.mode ?? ''}`,
      `engine.code: ${d.engine?.code ?? ''}`,
    ].join('\n');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text);
    } catch (_) { /* 복사 실패는 무시 */ }
  });
  sec.append(note, btn);
}

function statusDiagnostics(field) {
  const sec = blockShell('진단 정보', field, 'status-diagnostics');
  if (field?.status === 'loading') { sec.append(row('상태', '불러오는 중')); appendCopyButton(sec, field); return sec; }
  if (field?.status === 'error') {
    sec.append(row('상태', `진단 정보를 불러오지 못했습니다: ${field?.error?.message ?? '확인 불가'}`, 'alert'));
    appendRetryHint(sec, field);
    appendCopyButton(sec, field);
    return sec;
  }
  const d = field?.data ?? {};
  // 안전한 값만 표시합니다(토큰·키 등은 쓰지 않음).
  sec.append(row('requestId', String(d.requestId ?? '')));
  sec.append(row('component', String(d.component ?? '')));
  sec.append(row('version', String(d.version ?? '')));
  sec.append(row('checkedAt', String(d.checkedAt ?? '')));
  sec.append(row('engine.mode', String(d.engine?.mode ?? '')));
  sec.append(row('engine.code', String(d.engine?.code ?? '')));
  appendCopyButton(sec, field);
  return sec;
}

export function renderStatus({ devices, sessions, notifications, diagnostics, mode } = {}) {
  const root = document.createElement('section');
  root.className = 'status';
  root.setAttribute('aria-label', '보안 상태·알림·진단');

  const notice = modeNotice(mode);
  if (notice) root.append(notice);

  root.append(statusDevices(devices ?? { status: 'unknown' }));
  root.append(statusSessions(sessions ?? { status: 'unknown' }));
  root.append(statusNotifications(notifications));
  root.append(statusDiagnostics(diagnostics ?? { status: 'unknown' }));
  return root;
}

// 보호 현황에 함께 붙는 상태 화면. update 로 새 입력이 오면 통째로 교체합니다(성공 시 이전 오류 제거).
export function createStatusView() {
  const root = document.createElement('div');
  root.className = 'student-status';

  const heading = document.createElement('h2');
  heading.textContent = '보안 상태·알림·진단';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-status-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderStatus({
    devices: { status: 'loading' },
    sessions: { status: 'loading' },
    diagnostics: { status: 'loading' },
    notifications: [],
  }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderStatus(input ?? {}));
    },
  };
}
