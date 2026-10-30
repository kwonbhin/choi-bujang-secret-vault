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
export function createIdentityView() {
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
  // 22단계 재현 중 보완: 제공 화면은 「도움정보 불러오기」를 누르기 전까지 status 'idle' 을 넘깁니다.
  // idle 을 성공 화면처럼 빈 값으로 그리지 않고, 아직 불러오지 않았다는 것을 글로 보여 줍니다.
  if (field?.status === undefined || field?.status === null || field?.status === 'idle') {
    sec.append(row('상태', '진단 정보를 아직 불러오지 않았습니다. 필요하면 「도움정보 불러오기」를 직접 누르세요.'));
    appendCopyButton(sec, field);
    return sec;
  }
  if (field?.status !== 'ok') {
    sec.append(row('상태', `확인 불가 (${statusCode(field?.status)})`, 'unknown'));
    appendCopyButton(sec, field);
    return sec;
  }
  const d = field?.data ?? {};
  const val = (v) => (v === undefined || v === null || v === '') ? '확인 불가' : String(v);
  // 안전한 값만 표시합니다(토큰·키 등은 쓰지 않음).
  sec.append(row('requestId', val(d.requestId)));
  sec.append(row('component', val(d.component)));
  sec.append(row('version', val(d.version)));
  sec.append(row('checkedAt', val(d.checkedAt)));
  sec.append(row('engine.mode', val(d.engine?.mode)));
  sec.append(row('engine.code', val(d.engine?.code)));
  appendCopyButton(sec, field);
  return sec;
}


// ─────────────────────────────────────────────────────────────
// 마지막 총공세: 「내 PC 점검」 관제 대시보드 (내가 고른 핵심 기능 1)
// 규칙(내가 정한 것):
//  - 사용자가 「내 PC 다시 조회」를 누를 때만 api.get('/api/pc/status') 를 한 번 부릅니다.
//    화면을 다시 그리거나 onChange 가 불릴 때는 조회하지 않습니다(끝없는 반복 방지).
//  - 다섯 항목(CPU·메모리·디스크·방화벽·Windows 기록) 중 실제로 읽은 것만 '실측'으로 셉니다.
//    읽지 못한 항목은 '확인 불가'이며 정상·안전으로 바꾸지 않습니다.
//  - 실패하면 이전 값을 새 값처럼 남기지 않고, 지난 조회는 '조회 기록'에만 남깁니다.
//  - 조회 기록은 이 창을 켜 둔 동안 메모리에만 최대 10건 둡니다(저장·전송하지 않음).
// ─────────────────────────────────────────────────────────────
const PC_PATH = '/api/pc/status';
const PC_STALE_MS = 60 * 1000;      // 이보다 오래된 측정값은 '오래됨'으로 표시
const PC_HISTORY_MAX = 10;
const PC_REASON_TEXT = {
  unsupported: '이 운영체제에서는 읽지 않습니다',
  permission_denied: '읽을 권한이 없습니다',
  timeout: '조회 시간이 초과되었습니다',
  cancelled: '조회가 취소되었습니다',
  invalid_sample: '표본 값을 확인하지 못했습니다',
  invalid_response: '응답 형식을 확인하지 못했습니다',
  query_failed: '조회에 실패했습니다',
};
const pcReason = (r) => PC_REASON_TEXT[r] ?? '확인하지 못했습니다';

const pcState = {
  api: null,
  onChange: null,
  status: 'idle',        // idle | loading | ok | not-allowed | error
  result: null,          // 마지막 성공 응답의 data
  receivedAt: null,      // 앱이 응답을 받은 시각(ms)
  error: null,
  history: [],           // { at, status, summary }
  detailsOpen: false,
  historyOpen: false,
  restoreFocus: false,
};

function pcBytes(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '확인 불가';
  const gb = n / (1024 ** 3);
  return `${gb >= 100 ? gb.toFixed(0) : gb.toFixed(1)}GB`;
}

function pcTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '시각 확인 불가';
  return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// 항목 하나를 { label, value, tone, note, measured } 로 바꿉니다. tone: ok | warn | unknown
function pcItems(metrics = {}) {
  const items = [];
  const cpu = metrics.cpu;
  if (cpu?.state === 'ok' && typeof cpu.usagePercent === 'number') {
    items.push({ key: 'cpu', label: 'CPU 사용률', value: `${cpu.usagePercent}%`, percent: cpu.usagePercent,
      tone: cpu.usagePercent >= 90 ? 'warn' : 'ok', measured: true,
      note: `200ms 표본 한 번입니다. 높게 나와도 원인(어떤 프로그램인지)은 이것만으로 알 수 없습니다.` });
  } else items.push({ key: 'cpu', label: 'CPU 사용률', value: '확인 불가', tone: 'unknown', measured: false, note: pcReason(cpu?.reason) });

  const mem = metrics.memory;
  if (mem?.state === 'ok' && mem.totalBytes > 0) {
    const pct = Math.round((mem.usedBytes / mem.totalBytes) * 1000) / 10;
    items.push({ key: 'memory', label: '메모리 사용량', value: `${pct}% (${pcBytes(mem.usedBytes)} / ${pcBytes(mem.totalBytes)})`, percent: pct,
      tone: pct >= 90 ? 'warn' : 'ok', measured: true,
      note: '사용량이 높다는 것만으로 악성 프로그램이라고 판단하지 않습니다.' });
  } else items.push({ key: 'memory', label: '메모리 사용량', value: '확인 불가', tone: 'unknown', measured: false, note: pcReason(mem?.reason) });

  const disk = metrics.disk;
  if (disk?.state === 'ok' && disk.totalBytes > 0) {
    const freePct = Math.round((disk.freeBytes / disk.totalBytes) * 1000) / 10;
    items.push({ key: 'disk', label: '디스크 남은 공간', value: `${freePct}% (${pcBytes(disk.freeBytes)} 남음)`, percent: 100 - freePct,
      tone: freePct < 10 ? 'warn' : 'ok', measured: true,
      note: '앱이 설치된 드라이브 하나만 봅니다. 다른 드라이브는 이 값에 들어 있지 않습니다.' });
  } else items.push({ key: 'disk', label: '디스크 남은 공간', value: '확인 불가', tone: 'unknown', measured: false, note: pcReason(disk?.reason) });

  const fw = metrics.firewall;
  if (fw?.state === 'ok' && Array.isArray(fw.profiles)) {
    const off = fw.profiles.filter((p) => p.enabled === false).map((p) => p.name);
    items.push({ key: 'firewall', label: 'Windows 방화벽', value: off.length ? `꺼진 프로필: ${off.join(', ')}` : '세 프로필 모두 켜짐',
      tone: off.length ? 'warn' : 'ok', measured: true,
      note: '켜져 있다는 것만으로 PC가 안전하다고 말할 수 없습니다. 규칙 내용은 읽지 않습니다.' });
  } else items.push({ key: 'firewall', label: 'Windows 방화벽', value: '확인 불가', tone: 'unknown', measured: false, note: pcReason(fw?.reason) });

  const ev = metrics.events;
  if (ev?.state === 'ok') {
    items.push({ key: 'events', label: 'Windows 기록(경고·오류)', value: `경고 ${ev.warningCount}건 · 오류 ${ev.errorCount}건`,
      tone: 'ok', measured: true,
      note: `${ev.since ? pcTime(ev.since) + ' 이후, ' : ''}최대 ${ev.sampleLimit}건까지만 셉니다${ev.truncated ? '(한도에 걸려 일부만 셈)' : ''}. 건수는 침해 판정이 아니고, 기록 내용은 읽지 않습니다.` });
  } else items.push({ key: 'events', label: 'Windows 기록(경고·오류)', value: '확인 불가', tone: 'unknown', measured: false, note: pcReason(ev?.reason) });
  return items;
}

function pcSummary(items) {
  const measured = items.filter((i) => i.measured).length;
  const unknown = items.length - measured;
  const warn = items.filter((i) => i.tone === 'warn').length;
  return { measured, unknown, warn, text: `실측 ${measured}/${items.length} · 확인 불가 ${unknown}개 · 주의 ${warn}개` };
}

async function refreshPc() {
  if (pcState.status === 'loading' || !pcState.api) return; // 진행 중이면 다시 부르지 않음
  pcState.status = 'loading';
  pcState.restoreFocus = true;
  pcState.onChange?.();
  let res;
  try { res = await pcState.api.get(PC_PATH); } catch (e) { res = { ok: false, error: { code: 'REQUEST_FAILED', message: String(e?.message ?? '') } }; }
  const now = Date.now();
  if (res?.ok && res.data?.metrics) {
    pcState.status = 'ok';
    pcState.result = res.data;
    pcState.receivedAt = now;
    pcState.error = null;
    pcState.history.unshift({ at: now, status: 'ok', summary: pcSummary(pcItems(res.data.metrics)).text,
      cpu: res.data.metrics.cpu?.usagePercent, memory: res.data.metrics.memory });
  } else {
    const code = res?.error?.code ?? 'UNKNOWN';
    pcState.status = code === 'NOT_ALLOWED' ? 'not-allowed' : 'error';
    pcState.result = null; // 실패하면 이전 값을 현재 값처럼 남기지 않음
    pcState.error = { code, message: res?.error?.message ?? '' };
    pcState.history.unshift({ at: now, status: 'error', summary: `조회 실패 (${code})` });
  }
  pcState.history = pcState.history.slice(0, PC_HISTORY_MAX);
  pcState.restoreFocus = true;
  pcState.onChange?.();
}

function pcKv(dl, labelText, valueText) {
  const dt = document.createElement('dt');
  dt.textContent = labelText;
  const dd = document.createElement('dd');
  dd.textContent = valueText;
  dl.append(dt, dd);
}

function pcTag(tone) {
  const t = document.createElement('span');
  t.className = tone === 'warn' ? 'tag tag-demo' : tone === 'ok' ? 'tag tag-student' : 'tag';
  t.textContent = tone === 'ok' ? '● 정상 범위' : tone === 'warn' ? '▲ 주의' : '? 확인 불가';
  return t;
}

// 상태 카드 하나. 색만으로 구분하지 않도록 ●/▲/? 기호와 글자를 함께 씁니다.
function pcCard(item) {
  const card = document.createElement('section');
  card.className = 'card';
  card.dataset.field = `pc-${item.key}`;
  card.dataset.status = item.tone;
  const h = document.createElement('h4');
  h.textContent = item.label;
  h.append(pcTag(item.tone));
  const value = document.createElement('p');
  value.className = 'pc-dash-value';
  value.textContent = item.value;
  card.append(h, value);
  if (typeof item.percent === 'number') {
    const m = document.createElement('meter');
    m.min = 0; m.max = 100; m.low = 70; m.high = 90; m.optimum = 0;
    m.value = Math.max(0, Math.min(100, item.percent));
    m.setAttribute('aria-label', `${item.label} 막대`);
    m.textContent = item.value;
    card.append(m);
  }
  return card;
}

function renderPcCheck() {
  const sec = document.createElement('section');
  sec.className = 'card student';
  sec.dataset.field = 'pc-check';
  sec.setAttribute('aria-label', '내 PC 점검');

  const h = document.createElement('h3');
  h.textContent = '내 PC 점검';
  const tag = document.createElement('span');
  tag.className = 'tag tag-student';
  tag.textContent = '학생 구현';
  h.append(tag);
  sec.append(h);

  // 1) 핵심 요약 — 한 줄로 지금 상태
  const items = pcState.status === 'ok' ? pcItems(pcState.result.metrics) : null;
  const summary = document.createElement('p');
  summary.setAttribute('role', 'status');
  let tone = 'state-empty';
  if (pcState.status === 'idle') summary.textContent = '아직 조회하지 않았습니다. 「내 PC 다시 조회」를 누르면 이 PC의 현재 상태를 한 번 읽습니다. 지금은 모든 항목이 확인 불가입니다.';
  else if (pcState.status === 'loading') { tone = 'state-loading'; summary.textContent = '지금 이 PC를 조회하고 있습니다… 이전 값은 새 값으로 보여 주지 않습니다.'; }
  else if (pcState.status === 'not-allowed') summary.textContent = '이 앱 판에서는 학생 화면이 PC 상태를 읽을 수 없습니다(지원 없음). 위쪽 제공 카드 「내 PC 상태」에서 확인하세요.';
  else if (pcState.status === 'error') { tone = 'state-error'; summary.textContent = `조회에 실패했습니다(${pcState.error?.code}). 값은 모두 확인 불가입니다. 잠시 뒤 「내 PC 다시 조회」를 직접 눌러 주세요.`; }
  else {
    const s = pcSummary(items);
    const stale = Date.now() - pcState.receivedAt > PC_STALE_MS;
    const head = s.measured === 0 ? '응답은 받았지만 읽은 항목이 없습니다' : s.warn ? '주의할 항목이 있습니다' : '읽은 항목에서 주의할 값은 보이지 않았습니다';
    tone = s.measured === 0 ? 'state-error' : (s.warn || stale) ? 'state-empty' : 'state-ok';
    summary.textContent = `${head} — ${s.text} · 측정 ${pcTime(pcState.result.measuredAt)}${stale ? ' · 오래됨(1분 넘음, 다시 조회하세요)' : ''}`;
  }
  summary.className = `state ${tone}`;
  sec.append(summary);

  // 2) 다음 행동
  const bar = document.createElement('p');
  bar.className = 'row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  const busy = pcState.status === 'loading';
  btn.textContent = busy ? '조회 중…' : '내 PC 다시 조회';
  btn.setAttribute('aria-disabled', busy ? 'true' : 'false');
  btn.addEventListener('click', () => { refreshPc(); });
  const hint = document.createElement('span');
  hint.className = 'muted';
  hint.textContent = '자동으로 다시 읽지 않습니다. 필요할 때 직접 누르세요.';
  bar.append(btn, hint);
  sec.append(bar);
  if (pcState.restoreFocus) {
    pcState.restoreFocus = false;
    setTimeout(() => { if (btn.isConnected) btn.focus(); }, 0);
  }

  // 3) 상태 카드(관제 대시보드)
  const cards = items ?? pcItems({}).map((i) => ({ ...i, note: pcState.status === 'idle' ? '아직 조회하지 않았습니다' : i.note }));
  const grid = document.createElement('div');
  grid.className = 'grid-2';
  for (const item of cards) grid.append(pcCard(item));
  sec.append(grid);

  // 4) 상세 근거(펼치기)
  const det = document.createElement('details');
  det.open = pcState.detailsOpen;
  det.addEventListener('toggle', () => { pcState.detailsOpen = det.open; });
  const sum = document.createElement('summary');
  sum.textContent = '근거와 한계 보기';
  const dl = document.createElement('dl');
  dl.className = 'kv';
  for (const item of cards) pcKv(dl, item.label, item.note);
  pcKv(dl, '출처', pcState.result?.source === 'local-pc' ? '이 PC(앱 서버가 직접 읽음)' : '확인 불가');
  pcKv(dl, '말할 수 없는 것', '주의 0개는 "이상 없음"이나 "안전"이 아닙니다. 읽은 다섯 항목의 현재 값일 뿐입니다.');
  det.append(sum, dl);
  sec.append(det);

  // 5) 조회 기록(타임라인)
  const his = document.createElement('details');
  his.open = pcState.historyOpen;
  his.addEventListener('toggle', () => { pcState.historyOpen = his.open; });
  const hs = document.createElement('summary');
  hs.textContent = `조회 기록 ${pcState.history.length}건 (이 창을 닫으면 사라짐)`;
  const hdl = document.createElement('dl');
  hdl.className = 'kv';
  if (!pcState.history.length) pcKv(hdl, '기록', '아직 조회한 적이 없습니다.');
  for (const h2 of pcState.history) {
    const memPct = h2.memory?.state === 'ok' ? `${Math.round((h2.memory.usedBytes / h2.memory.totalBytes) * 100)}%` : '확인 불가';
    const extra = h2.status === 'ok' ? ` · CPU ${typeof h2.cpu === 'number' ? h2.cpu + '%' : '확인 불가'} · 메모리 ${memPct}` : '';
    pcKv(hdl, pcTime(h2.at), `${h2.status === 'ok' ? '' : '✕ '}${h2.summary}${extra}`);
  }
  his.append(hs, hdl);
  sec.append(his);
  return sec;
}

export function renderStatus({ devices, sessions, notifications, diagnostics, mode } = {}) {
  const root = document.createElement('section');
  root.className = 'status';
  root.setAttribute('aria-label', '보안 상태·알림·진단');

  const notice = modeNotice(mode);
  if (notice) root.append(notice);

  root.append(renderPcCheck()); // 마지막 총공세: 내 PC 점검 대시보드를 맨 위에
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

// ===== 17단계: 앱 내부 AI 연결 상태 표시 (renderAiConnection) — renderExplanation 은 18단계에서 완성 =====
// 입력: renderAiConnection({ status, mode, data?, error?, checkedAt, explanationAccepted })
//   status: idle(점검 전) · loading(점검 중) · ok · error
//   data: { transportChecked:true, audienceAuthorization:'test'|'verified', modelCount, help }
// 규칙: 연결 점검과 '사건 설명 실행'을 구분(모델 목록 응답을 설명으로 쓰지 않음).
//       실패는 안전한 code 로 원인 구분. 화면·복사에 열쇠·원문 오류를 쓰지 않음.
//       재점검 성공·계정 변경(idle) 뒤 이전 결과를 남기지 않음(호출부가 노드 교체).
//       자동 재점검 없음 — 사용자가 버튼을 직접 누름. textContent 만.
const AI_ERROR_GUIDE = {
  PERMISSION_PENDING: '계정 연결과 앱 권한이 준비 중입니다. 담당자에게 확인을 요청하세요. (내 설정 문제가 아닙니다)',
  UNVERIFIED: '연결을 확인할 수 없습니다. 담당자에게 계정 연결과 앱 권한을 확인해 달라고 요청하세요.',
  AUTH: '인증에 실패했습니다. 계정 연결을 다시 확인하고 담당자에게 문의하세요.',
  FORBIDDEN: '접근이 제한되었습니다. 계정 연결을 다시 확인하고 담당자에게 문의하세요.',
  QUOTA: '반 사용량·이용 한도에 도달했습니다. 담당자에게 확인을 요청하세요.',
  OFF_HOURS: '이용 시간이 아닙니다. 이용 시간을 확인하세요.',
  RATE_LIMIT: '요청이 제한되었습니다. 잠시 뒤 직접 다시 점검하세요.',
  TIMEOUT_NETWORK: '시간 초과 또는 네트워크 문제입니다. 잠시 뒤 직접 다시 점검하세요.',
  CANCELLED: '점검을 취소했습니다. 이전 결과는 현재 결과가 아닙니다.',
  NO_MODEL: '쓸 수 있는 모델이 없습니다. 담당자에게 모델 허용 설정을 요청하세요.',
};
const aiErrorGuide = (code) => AI_ERROR_GUIDE[code] ?? '연결을 확인하지 못했습니다. 담당자에게 문의하세요.';
const AI_RECHECK_HINT = '다시 점검은 「현재 API 연결 점검」 버튼을 직접 누르세요. 자동으로 점검하지 않습니다.';

export function renderAiConnection({ status, mode, data, error, checkedAt, explanationAccepted } = {}) {
  const root = document.createElement('section');
  root.className = 'ai-connection';
  root.dataset.status = status ?? 'idle';
  root.setAttribute('aria-label', 'AI 연결 점검');

  const notice = modeNotice(mode);
  if (notice) root.append(notice);

  if (status === undefined || status === 'idle') {
    root.append(row('상태', 'AI 연결 점검 전'));
    root.append(row('다시 점검', AI_RECHECK_HINT));
    return root;
  }
  if (status === 'loading') {
    root.append(row('상태', 'AI 연결 점검 중'));
    return root;
  }
  if (status === 'error') {
    const code = error?.code ?? 'UNKNOWN';
    const message = error?.message ?? '확인 불가';
    root.append(row('상태', 'AI 연결 점검 실패', 'alert'));
    root.append(row('원인(code)', String(code)));
    root.append(row('안내', aiErrorGuide(code)));
    root.append(row('메시지', String(message)));
    root.append(row('다시 점검', AI_RECHECK_HINT));
    return root;
  }

  // status === 'ok'
  const d = data ?? {};
  const aud = d.audienceAuthorization;
  const audLabel = aud === 'verified' ? '앱 권한 확인 후 점검 (verified)'
    : aud === 'test' ? '시험 연결 점검 (test)'
    : `확인 불가 (${statusCode(aud)})`;
  root.append(row('연결 점검', audLabel, aud === 'verified' ? 'ok' : aud === 'test' ? undefined : 'unknown'));
  root.append(row('전송 점검(transportChecked)', d.transportChecked ? '전송 경로 확인됨' : '확인 불가'));
  root.append(row('모델 수(modelCount)', String(d.modelCount ?? '확인 불가')));
  if (checkedAt) root.append(row('점검 시각(checkedAt)', String(checkedAt)));
  // 연결만 점검했음을 분명히 — 모델 목록 응답은 사건 설명이 아님.
  root.append(row('사건 설명', explanationAccepted
    ? '사건 설명이 별도로 실행되었습니다.'
    : '사건 설명은 아직 실행하지 않았습니다. (연결만 점검)'));
  return root;
}

// ===== 18단계: 근거에 연결된 AI 사건 설명 (renderExplanation) =====
// 입력: renderExplanation({ event, explanation, checkedAt })
//   event: 보안 기록에서 고른 기록(15단계와 같은 모양) 또는 null
//   explanation: { status, mode, data?, error? }  status: idle · loading · ok · error
//   data: { summary, evidenceIds, proposals:[{action,evidenceIds,reason}], requiresHumanConfirmation:true, executed:false }
// 규칙: 1) error 는 event 가 null 이어도 먼저 표시(안전한 code·message·실패 이유). 오류 없이 event 만 null 이면 기록 선택 안내.
//       2) 성공한 설명에만 data-student-explanation-event=event.id. 실패·자료 없음·근거 불일치에는 붙이지 않음.
//       3) evidenceIds 를 현재 event.evidence 의 id 와 대조. 없는 근거 ID 를 만들어 맞추지 않음(불일치면 설명 거부).
//       4) access·session·device 중 unknown 은 각각 '확인 불가(unknown)'. 정상·안전으로 바꾸지 않음.
//       5) 제안은 이유 + '사람 확인 필요·미실행'. 실행 버튼 없음. executed:true 설명은 쓰지 않음.
//       6) 매 호출마다 새 노드를 만들고 호출부가 통째로 교체 → 다른 기록 선택·새로고침·실패 때 이전 설명과 성공 속성이 남지 않음.
//       createElement·textContent 만 사용.
const EXPLAIN_STATE_KEYS = [
  { key: 'access', name: '접속' },
  { key: 'session', name: '세션' },
  { key: 'device', name: '기기' },
];
// 실패 code → 실패 이유(근거 부족·근거 불일치·취소·연결 문제를 구분)
const EXPLAIN_FAILURE_REASON = {
  ON_AI_INVALID_INPUT: '근거 부족·입력 오류: 이 기록에 설명에 필요한 근거·규칙이 없거나 확인할 수 없어 설명을 만들 수 없습니다.',
  ON_AI_INVALID_OUTPUT: '근거 불일치: AI 응답의 근거 ID·조치·형식이 이 기록과 맞지 않거나, 이미 실행했다고 답해 이 설명을 쓸 수 없습니다.',
  CANCELLED: '요청 취소: 설명 요청을 취소했습니다. 이전 설명은 현재 결과가 아닙니다.',
  WB_CLCO_CANCELLED: '요청 취소: 설명 요청을 취소했습니다. 이전 설명은 현재 결과가 아닙니다.',
  REQUEST_CANCELLED: '요청 취소: 설명 요청을 취소했습니다. 이전 설명은 현재 결과가 아닙니다.',
  SUBJECT_SCOPE_UNVERIFIED: '범위 확인 불가: 현재 로그인과 이 기록의 연결을 확인할 수 없습니다.',
};
const explainFailureReason = (code) => EXPLAIN_FAILURE_REASON[code]
  ?? 'AI 연결 또는 응답 문제: AI 설명을 받지 못했습니다. 보안 기록과 업무 앱 판정은 영향을 받지 않습니다.';
// 화면에 비밀값처럼 보이는 문자열을 그대로 쓰지 않기 위한 최소 검사(제공 코드 검사에 더한 이중 확인)
const EXPLAIN_SECRET = /(?:Bearer\s+\S+|sk-(?:proj-|ant-|svcacct-)?[A-Za-z0-9_-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?key|authorization|password|비밀번호|토큰)\s*[:=]\s*\S+)/i;
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const safeCode = (c) => (typeof c === 'string' && SAFE_CODE.test(c)) ? c : 'AI_REQUEST_UNVERIFIED';
const safeText = (v) => typeof v === 'string' && v.trim().length > 0 && !EXPLAIN_SECRET.test(v);

function explainHeading(text) {
  const h = document.createElement('h4');
  h.textContent = text;
  return h;
}

// 성공(ok)으로 전달된 설명도 현재 기록과 다시 대조합니다. 문제가 있으면 { code, reason } 을 돌려줍니다.
function checkExplanationAgainstEvent(event, data) {
  const evidence = Array.isArray(event?.evidence) ? event.evidence : [];
  if (!evidence.length) {
    return { code: 'ON_AI_INVALID_INPUT', reason: '근거 부족: 이 기록에는 근거(evidence)가 없어 설명을 만들 수 없습니다. 내용을 지어내지 않습니다.' };
  }
  if (!data || typeof data !== 'object') {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: '응답 형식 오류: 설명 자료가 없습니다.' };
  }
  if (data.executed !== false) {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: 'AI가 조치를 이미 실행했다고 답한 설명은 쓸 수 없습니다. 이 앱의 AI 설명은 조치를 실행하지 않습니다.' };
  }
  if (data.requiresHumanConfirmation !== true) {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: '사람 확인이 필요하다는 표시가 없어 이 설명을 쓸 수 없습니다.' };
  }
  if (!safeText(data.summary)) {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: '요약이 비어 있거나 비밀값으로 보이는 내용이 있어 이 설명을 쓸 수 없습니다.' };
  }
  const known = new Set(evidence.map((ev) => ev?.id));
  const ids = Array.isArray(data.evidenceIds) ? data.evidenceIds : [];
  const refsOk = (list) => Array.isArray(list) && list.length > 0 && new Set(list).size === list.length
    && list.every((ref) => known.has(ref));
  if (!refsOk(ids)) {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: '근거가 맞지 않음: AI가 인용한 근거 ID가 이 기록의 근거에 없거나 중복되어 이 설명을 쓸 수 없습니다.' };
  }
  if (ids.length !== known.size) {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: '근거가 빠짐: AI가 이 기록의 근거를 모두 인용하지 않아 이 설명을 쓸 수 없습니다.' };
  }
  const supported = Array.isArray(event?.supportedActions) ? event.supportedActions : [];
  const proposals = Array.isArray(data.proposals) ? data.proposals : null;
  if (!proposals) {
    return { code: 'ON_AI_INVALID_OUTPUT', reason: '응답 형식 오류: 조치 제안 목록이 없습니다.' };
  }
  for (const p of proposals) {
    if (!p || !supported.includes(p.action)) {
      return { code: 'ON_AI_INVALID_OUTPUT', reason: '연동 시스템이 지원하지 않는 조치를 제안해 이 설명을 쓸 수 없습니다.' };
    }
    if (!refsOk(p.evidenceIds) || !safeText(p.reason)) {
      return { code: 'ON_AI_INVALID_OUTPUT', reason: '근거가 맞지 않음: 조치 제안의 근거 ID 또는 이유가 이 기록과 맞지 않아 이 설명을 쓸 수 없습니다.' };
    }
  }
  return null;
}

// 실패·거부 화면 공통. data-student-explanation-event 를 붙이지 않습니다.
function appendExplanationFailure(root, { event, code, message, reason, title }) {
  root.append(row('상태', title, 'alert'));
  if (event?.id !== undefined && event?.id !== null) root.append(row('사건 ID', String(event.id)));
  root.append(row('원인(code)', safeCode(code)));
  if (message) root.append(row('메시지', String(message)));
  root.append(row('실패 이유', reason));
  root.append(row('안내', '기록은 그대로입니다. AI 설명 실패는 과제 실패가 아니며, 보안 기록과 업무 앱 판정은 계속 동작합니다.'));
}

export function renderExplanation({ event, explanation, checkedAt } = {}) {
  const root = document.createElement('section');
  root.className = 'explanation';
  root.setAttribute('aria-label', 'AI 사건 설명');
  const st = explanation?.status;
  root.dataset.status = st ?? 'idle';

  const notice = modeNotice(explanation?.mode);
  if (notice) root.append(notice);

  // 1) 실패가 가장 먼저: event 가 null 이어도 안전한 code·message·실패 이유를 보여 줍니다.
  if (st === 'error') {
    const code = safeCode(explanation?.error?.code);
    const rawMsg = explanation?.error?.message;
    appendExplanationFailure(root, {
      event,
      code,
      message: `AI 설명 실패: ${safeText(rawMsg) ? rawMsg : '확인 불가'}`,
      reason: explainFailureReason(code),
      title: 'AI 설명 실패',
    });
    return root;
  }

  // 오류 없이 event 만 없음 → 기록을 먼저 고르라는 안내
  if (!event) {
    root.dataset.status = 'no-event';
    root.append(row('안내', '보안 기록에서 기록을 먼저 고르세요. 고른 기록에서 「AI 설명 요청」을 누르면 여기에 표시됩니다.'));
    return root;
  }

  if (st === 'loading') {
    root.append(row('사건 ID', String(event.id)));
    root.append(row('상태', 'AI 설명 요청 중'));
    return root;
  }

  if (st !== 'ok') {
    // idle 등: 요청 전. 성공 속성 없음.
    root.append(row('사건 ID', String(event.id)));
    root.append(row('상태', 'AI 설명 요청 전'));
    return root;
  }

  // status === 'ok' → 현재 기록과 다시 대조. 맞지 않으면 설명을 쓰지 않습니다(지어내지 않음).
  const data = explanation?.data;
  const problem = checkExplanationAgainstEvent(event, data);
  if (problem) {
    root.dataset.status = 'rejected';
    appendExplanationFailure(root, {
      event,
      code: problem.code,
      message: '',
      reason: problem.reason,
      title: 'AI 설명을 쓸 수 없음',
    });
    return root;
  }

  // 2) 성공한 설명에만 성공 속성
  root.setAttribute('data-student-explanation-event', String(event.id));
  root.append(explainHeading('AI 설명(참고용)'));
  root.append(row('사건 ID', String(event.id)));
  root.append(row('AI 요약', String(data.summary)));
  root.append(row('안내', 'AI 요약은 해석입니다. 사실 판단은 아래 근거 글과 연동 시스템이 알려 준 현재 상태로 하세요.'));
  if (checkedAt) root.append(row('설명 시각(checkedAt)', String(checkedAt)));

  // 3) 인용한 근거: 현재 event.evidence 에서 같은 id 를 찾아 "근거 ID — 근거 글"
  root.append(explainHeading('인용한 근거(evidence)'));
  const evText = new Map(event.evidence.map((ev) => [ev.id, ev.text]));
  const evUl = document.createElement('ul');
  evUl.className = 'identity-list';
  for (const id of data.evidenceIds) {
    const li = document.createElement('li');
    li.setAttribute('data-evidence-id', String(id));
    li.textContent = `${id} — ${String(evText.get(id))}`;
    evUl.append(li);
  }
  root.append(evUl);

  // 규칙: id 와 text 함께
  root.append(explainHeading('규칙(rules)'));
  const rules = Array.isArray(event.rules) ? event.rules : [];
  if (!rules.length) root.append(row('규칙', '없음'));
  else {
    const rUl = document.createElement('ul');
    rUl.className = 'identity-list';
    for (const rl of rules) {
      const li = document.createElement('li');
      li.textContent = `${String(rl?.id ?? '')} — ${String(rl?.text ?? '')}`;
      rUl.append(li);
    }
    root.append(rUl);
  }

  // 4) 현재 상태: 접속·세션·기기를 각각 구분. unknown 은 확인 불가로, 정상·안전으로 적지 않음.
  root.append(explainHeading('현재 상태(연동 시스템 기준)'));
  const evState = event.state ?? {};
  const labelOf = {
    access: accessLabel, session: sessionStatusLabel, device: deviceStatusLabel,
  };
  const toneOf = { access: accessTone, session: sessionTone, device: deviceTone };
  const unknownNames = [];
  for (const { key, name } of EXPLAIN_STATE_KEYS) {
    const v = evState[key];
    if (v === 'unknown' || v === undefined || v === null || v === '') {
      unknownNames.push(name);
      root.append(row(name, '확인 불가(unknown)', 'unknown'));
    } else {
      root.append(row(name, labelOf[key](v), toneOf[key](v)));
    }
  }
  root.append(explainHeading('확인 불가 상태'));
  if (!unknownNames.length) root.append(row('확인 불가', '없음'));
  else {
    const uUl = document.createElement('ul');
    uUl.className = 'identity-list';
    for (const name of unknownNames) {
      const li = document.createElement('li');
      li.textContent = `${name}: 확인 불가(unknown)`;
      uUl.append(li);
    }
    root.append(uUl);
    root.append(row('주의', '확인 불가 상태는 정상·안전·기준 충족으로 판단하지 않습니다.', 'unknown'));
  }

  // 5) 조치 제안: 이유 + 사람 확인 필요·미실행. 실행 버튼은 만들지 않습니다.
  root.append(explainHeading('AI 조치 제안'));
  const supported = Array.isArray(event.supportedActions) ? event.supportedActions : [];
  if (!data.proposals.length) {
    root.append(row('제안', supported.length === 0
      ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
      : 'AI가 이 기록에 맞는 조치를 제안하지 않았습니다.'));
  } else {
    const pUl = document.createElement('ul');
    pUl.className = 'identity-list';
    for (const p of data.proposals) {
      const li = document.createElement('li');
      li.append(row('조치(action)', String(p.action)));
      li.append(row('이유', String(p.reason)));
      li.append(row('근거 ID', p.evidenceIds.map(String).join(', ')));
      li.append(row('실행 상태', '사람 확인이 필요하며 실행되지 않았습니다', 'warn'));
      pUl.append(li);
    }
    root.append(pUl);
  }
  root.append(row('안내', 'AI 설명은 참고 정보입니다. 설명·제안만으로 보안 조치가 실행되지 않습니다.'));
  return root;
}

// 사건 설명 영역 학생 화면. update 로 새 입력이 오면 통째로 교체합니다(이전 설명·성공 속성 제거).
export function createExplanationView() {
  const root = document.createElement('div');
  root.className = 'student-explanation';

  const heading = document.createElement('h2');
  heading.textContent = 'AI 사건 설명';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-explanation-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderExplanation({ event: null, explanation: { status: 'idle' } }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderExplanation(input ?? {}));
    },
  };
}

// AI 연결 영역에 붙는 학생 화면. update 로 새 입력이 오면 통째로 교체합니다.
export function createAiConnectionView() {
  const root = document.createElement('div');
  root.className = 'student-ai';

  const heading = document.createElement('h2');
  heading.textContent = 'AI 연결 점검';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-ai-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderAiConnection({ status: 'idle' }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderAiConnection(input ?? {}));
    },
  };
}

// ===== 19단계: AI 조치 제안과 기존 서버 처리 결과 (renderAction) =====
// 입력: renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt?, error? })
//   status: idle · loading · prepared · executing · pending · succeeded · denied · failed · unknown · error · expired
//   target: { id, generation } | null   receipt: { requestId, receiptId, eventId, actionId, status, version, replayed, superseded? } | null
//   observation: { observedAt, effectApplied } | null
// 규칙: 제안 · 사람 확인(준비됨·미실행) · 서버 접수(ACK) · 실제 효과 확인을 서로 다른 문장으로 구분합니다.
//       succeeded 이면서 observation.effectApplied === true(관측 시각·receiptId 있음, 현재 사건·조치와 일치)일 때만 '효과 확인'.
//       조건이 하나라도 맞지 않으면 결과 불명(unknown)으로 처리합니다. unknown 은 성공·효과 없음으로 단정하지 않습니다.
//       학생 코드는 버튼·POST 요청·확인 티켓을 만들거나 저장하지 않습니다(제공 화면 버튼 사용).
//       매 호출마다 새 노드를 만들고 호출부가 통째로 교체 → 새 입력이 오면 이전 대상·요청·결과가 남지 않습니다.
//       createElement·textContent 만 사용.
const ACTION_STATUS = {
  idle: { title: '아직 미실행(idle)', tone: undefined },
  loading: { title: '조치 준비 또는 결과 조회 중(loading) · 아직 미실행이거나 결과 미확인', tone: undefined },
  prepared: { title: '준비됨·미실행(prepared)', tone: 'warn' },
  executing: { title: '서버에 전달 중(executing) · 결과가 아직 없음', tone: 'warn' },
  pending: { title: '서버 접수·처리 중(pending) · 결과 미확인', tone: 'warn' },
  succeeded: { title: '효과 확인(succeeded)', tone: 'ok' },
  denied: { title: '거절(denied)', tone: 'alert' },
  failed: { title: '실패(failed)', tone: 'alert' },
  unknown: { title: '결과 불명(unknown)', tone: 'unknown' },
  expired: { title: '확인 기한 지남(expired)', tone: 'warn' },
  error: { title: '요청이 처리되지 않음(error)', tone: 'alert' },
};
const ACTION_GUIDE = {
  idle: '조치 제안은 아직 실행되지 않았습니다. AI 설명의 제안에서 제공 화면의 「조치 준비」를 눌러야 준비가 시작됩니다. 현재 기록처럼 연동 시스템이 지원하는 조치가 없으면 「조치 준비」 버튼이 나오지 않으며, 이것이 정상입니다.',
  loading: '연동 시스템에 확인하는 중입니다. 결과가 확인되기 전까지 실행 완료로 판단하지 마세요.',
  prepared: '조치를 준비만 했고 아직 실행하지 않았습니다. 아래 사건·조치·실제 대상·확인 기한을 확인한 뒤, 사람이 직접 제공 화면의 「대상과 조치를 확인했으며 집행합니다」를 눌러야 서버에 전달됩니다.',
  executing: '사람 확인 뒤 서버에 전달하는 중입니다. 서버 결과가 아직 없으므로 완료 아님입니다.',
  pending: '서버가 요청을 받았습니다(ACK). 접수는 실제 효과가 아니며 완료 아님입니다. 결과는 제공 화면의 「원천 결과만 재조회」로 직접 확인하세요.',
  succeeded: '연동 시스템이 실제 효과를 관측했습니다(effectApplied: true). 아래 관측 시각과 receiptId 를 함께 확인하세요.',
  denied: '연동 시스템이 이 조치를 거절했습니다. 조치는 적용되지 않았습니다.',
  failed: '연동 시스템이 이 조치 처리에 실패했다고 알렸습니다.',
  unknown: '결과를 확인할 수 없습니다. 성공으로도, 효과 없음으로도 판단하지 마세요. 다시 집행하지 말고 제공 화면의 「원천 결과만 재조회」로 결과만 다시 조회하세요.',
  expired: '사람 확인 기한이 지나 이번 준비로는 집행할 수 없습니다. 현재 사건에서 조치를 다시 준비하세요.',
  error: '요청이 처리되지 않았습니다. 아래 원인을 확인하세요.',
};
const ACTION_CANCEL_NOTE = '「조치 화면 취소」는 화면을 비우는 기능이며, 이미 서버에 전달된 조치 효과를 되돌리지 않습니다.';
const hasVal = (v) => v !== undefined && v !== null && v !== '';

// succeeded 를 '효과 확인'으로 인정할 수 있는지. 아니면 이유 문자열을 돌려줍니다.
// 현재 event.id·actionId 와 영수증의 eventId·actionId 가 '모두 존재하고' 서로 같아야 합니다(ID 가 없으면 성공 불가).
function actionSuccessProblem({ event, actionId, receipt, observation }) {
  if (!observation || observation.effectApplied !== true) return '연동 시스템이 실제 효과(effectApplied: true)를 확인하지 않았습니다.';
  if (!hasVal(observation.observedAt)) return '관측 시각(observedAt)이 없습니다.';
  if (!receipt || !hasVal(receipt.receiptId)) return 'receiptId 가 없습니다.';
  if (!hasVal(receipt.requestId)) return 'requestId 가 없습니다.';
  return actionBindingProblem({ event, actionId, receipt, strict: true });
}
// 현재 의도(사건·조치)와 영수증이 맞는지. 다른 사건·조치의 결과를 붙이지 않습니다.
//   - 현재 event.id·actionId 가 없으면 무엇에 대한 결과인지 확인할 수 없으므로 문제로 봅니다.
//   - 영수증에 eventId·actionId 가 있으면 현재 값과 같아야 합니다.
//   - strict(성공 판정)일 때는 영수증의 두 ID 도 반드시 있어야 합니다.
function actionBindingProblem({ event, actionId, receipt, strict = false }) {
  if (!hasVal(event?.id)) return '현재 사건 ID(event.id)가 없어 어느 사건의 결과인지 확인할 수 없습니다.';
  if (!hasVal(actionId)) return '현재 조치 ID(actionId)가 없어 어느 조치의 결과인지 확인할 수 없습니다.';
  if (!receipt) return null;
  if (strict && !hasVal(receipt.eventId)) return '영수증에 사건 ID(receipt.eventId)가 없어 현재 사건과 대조할 수 없습니다.';
  if (strict && !hasVal(receipt.actionId)) return '영수증에 조치 ID(receipt.actionId)가 없어 현재 조치와 대조할 수 없습니다.';
  if (hasVal(receipt.eventId) && receipt.eventId !== event.id) return '영수증의 사건 ID가 현재 사건과 다릅니다.';
  if (hasVal(receipt.actionId) && receipt.actionId !== actionId) return '영수증의 조치 ID가 현재 조치와 다릅니다.';
  return null;
}

export function renderAction({ status, event, actionId, target, receipt, observation, message, confirmationExpiresAt, error } = {}) {
  const root = document.createElement('section');
  root.className = 'action-status';
  root.setAttribute('aria-label', '조치 요청 상태와 실제 결과');

  let st = Object.hasOwn(ACTION_STATUS, status) ? status : 'unknown';
  let downgradeReason = null;
  // 현재 사건·조치와 영수증이 맞지 않으면 결과 불명
  const binding = actionBindingProblem({ event, actionId, receipt });
  if (binding && !['idle', 'error', 'expired'].includes(st)) { downgradeReason = binding; st = 'unknown'; }
  // succeeded 는 조건을 모두 만족할 때만 효과 확인. 아니면 결과 불명
  if (st === 'succeeded') {
    const p = actionSuccessProblem({ event, actionId, receipt, observation });
    if (p) { downgradeReason = p; st = 'unknown'; }
  }
  if (!Object.hasOwn(ACTION_STATUS, status)) downgradeReason = `알 수 없는 상태값(${statusCode(status)})입니다.`;
  root.dataset.status = st;

  const info = ACTION_STATUS[st];
  root.append(row('상태', info.title, info.tone));
  if (st !== status && hasVal(status)) root.append(row('받은 상태값', String(status)));
  if (downgradeReason) root.append(row('결과 불명 이유', downgradeReason, 'unknown'));
  root.append(row('안내', ACTION_GUIDE[st]));

  // 제공 화면이 준 안내 문구(있을 때). 효과 확인 화면에서는 중복을 피해 생략합니다.
  if (hasVal(message) && st !== 'succeeded') root.append(row('제공 화면 안내(message)', String(message)));

  // idle 은 이전 사건·대상·요청이 남지 않도록 아무 값도 표시하지 않습니다.
  if (st === 'idle') {
    root.append(row('실행 여부', '실행되지 않음'));
    root.append(row('참고', ACTION_CANCEL_NOTE));
    return root;
  }

  // 현재 의도(사건·근거·조치·대상) — 받은 값만 글자로
  root.append(explainHeading('현재 사건과 조치'));
  if (hasVal(event?.id)) {
    if (!downgradeReason) root.setAttribute('data-student-action-event', String(event.id)); // 대조에 문제가 없을 때만
    root.append(row('사건 ID(event.id)', String(event.id)));
  } else {
    root.append(row('사건 ID(event.id)', '확인 불가', 'unknown'));
  }
  const evIds = Array.isArray(event?.evidence) ? event.evidence.map((ev) => ev?.id).filter(hasVal) : [];
  root.append(row('근거 ID', evIds.length ? evIds.map(String).join(', ') : '없음'));
  root.append(row('조치(actionId)', hasVal(actionId) ? String(actionId) : '확인 불가', hasVal(actionId) ? undefined : 'unknown'));
  if (target && typeof target === 'object') {
    root.append(row('실제 대상(target.id)', hasVal(target.id) ? String(target.id) : '확인 불가'));
    root.append(row('대상 세대(target.generation)', hasVal(target.generation) ? String(target.generation) : '확인 불가'));
  } else if (st === 'prepared') {
    root.append(row('실제 대상', '확인 불가 — 대상을 확인할 수 없으면 집행하지 마세요', 'unknown'));
  }
  if (st === 'prepared' || hasVal(confirmationExpiresAt)) {
    root.append(row('사람 확인 기한(confirmationExpiresAt)', hasVal(confirmationExpiresAt) ? String(confirmationExpiresAt) : '확인 불가',
      hasVal(confirmationExpiresAt) ? undefined : 'unknown'));
    if (st === 'prepared') root.append(row('사람 확인', '사람 확인이 필요하며 아직 실행되지 않았습니다', 'warn'));
  }

  // 요청·영수증
  if (receipt && typeof receipt === 'object') {
    root.append(explainHeading('서버 요청·영수증'));
    if (hasVal(receipt.requestId)) {
      if (!downgradeReason) root.setAttribute('data-student-action-request', String(receipt.requestId)); // 대조에 문제가 없을 때만
      root.append(row('요청 ID(requestId)', String(receipt.requestId)));
    }
    root.append(row('영수증 ID(receiptId)', hasVal(receipt.receiptId) ? String(receipt.receiptId) : '확인 불가'));
    root.append(row('버전(version)', hasVal(receipt.version) ? String(receipt.version) : '확인 불가'));
    if (hasVal(receipt.status)) root.append(row('서버 상태값(receipt.status)', String(receipt.status)));
    if (receipt.replayed === true) {
      root.append(row('중복 방지(replayed)', '같은 요청 ID의 기존 결과를 다시 받은 것입니다. 조치를 한 번 더 실행한 것이 아닙니다.'));
    }
    if (receipt.superseded === true) {
      root.append(row('최신 아님(superseded)', '이전 조회 결과는 최신 결과를 대신하지 않습니다. 결과만 다시 조회하세요.', 'unknown'));
    }
  }

  // 실제 효과 관측
  if (observation && typeof observation === 'object') {
    root.append(explainHeading('연동 시스템 관측 결과'));
    root.append(row('관측 시각(observedAt)', hasVal(observation.observedAt) ? String(observation.observedAt) : '확인 불가'));
    root.append(row('effectApplied', String(observation.effectApplied === true ? true : observation.effectApplied === false ? false : 'unknown')));
  } else if (['executing', 'pending', 'unknown'].includes(st)) {
    root.append(row('관측 결과', '아직 관측된 결과가 없습니다.', st === 'unknown' ? 'unknown' : undefined));
  }

  if (st === 'error' || st === 'expired' || st === 'denied' || st === 'failed' || error) {
    const code = error?.code;
    if (hasVal(code)) root.append(row('원인(code)', safeCode(code)));
    if (hasVal(error?.message) && safeText(error.message)) root.append(row('메시지', String(error.message)));
  }

  root.append(row('참고', ACTION_CANCEL_NOTE));
  return root;
}

// 조치 상태 학생 화면. update 로 새 입력이 오면 통째로 교체합니다(이전 대상·요청·결과 제거).
export function createActionView() {
  const root = document.createElement('div');
  root.className = 'student-action';

  const heading = document.createElement('h2');
  heading.textContent = '조치 요청 상태와 실제 결과';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-action-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderAction({ status: 'idle' }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderAction(input ?? {}));
    },
  };
}

// ===== 20단계: 사용 라이브러리와 취약점 정보 대조 (renderVulnerabilities) =====
// 입력: renderVulnerabilities({ status, mode, data?, error? })  status: idle · loading · error · ok
//   data.status: complete · partial · not_checked · not_configured · unverifiable
//   data: { lockfileVersion?, lockfileHash?, checkedAt, code?, excluded?:{count}, packages:[...] }
//   package: { name, version, status, vulnerabilities:[{id, modified}], source, checkedAt }
//   package.status: known_vulnerabilities · none_found · unverifiable
// 규칙: 결과는 package-lock.json 과 설치된 node_modules 메타데이터를 대조한 '설치된 정확한 버전' 기준입니다.
//       ^1.2.0 같은 범위 표기를 버전으로 쓰지 않습니다(받은 version 원문만 표시).
//       조회 실패·미조회·취소·확인 불가는 '취약점 없음'이 아닙니다. 일부 실패 때 이미 받은 취약점 ID 는 지우지 않습니다.
//       idle·loading·error 에서는 패키지 표를 그리지 않아 이전 표가 현재 결과처럼 남지 않습니다(호출부가 노드 교체).
//       자동 재조회 없음 — 다시 조회는 제공 화면의 「설치 패키지 조회」 버튼. createElement·textContent 만.
const SCAN_STATUS_TEXT = {
  complete: '모두 조회(complete) — 조회 대상 패키지를 모두 OSV에 조회했습니다.',
  partial: '일부 조회 실패(partial) — 일부 패키지는 조회하지 못했습니다. 일부 결과입니다.',
  not_checked: '아직 조회 안 함(not_checked) — 승인된 공개 조회 대상 패키지가 없어 조회하지 않았습니다.',
  not_configured: '조회 준비 미완료(not_configured) — 조회 대상 프로젝트 설정이 필요합니다(운영자 준비).',
  unverifiable: 'lock 파일 확인 불가(unverifiable) — 설치 목록(package-lock.json)을 확인할 수 없어 조회하지 않았습니다.',
};
const SCAN_STATUS_TONE = { complete: 'ok', partial: 'warn', not_checked: 'unknown', not_configured: 'unknown', unverifiable: 'unknown' };
const PKG_STATUS_TEXT = {
  known_vulnerabilities: '알려진 항목 있음(known_vulnerabilities)',
  none_found: '알려진 항목 없음(none_found) — 조회 시점·조회 범위에서 OSV에 알려진 항목이 없다는 뜻입니다',
  unverifiable: '조회 확인 불가(unverifiable)',
};
const PKG_STATUS_TONE = { known_vulnerabilities: 'alert', none_found: undefined, unverifiable: 'unknown' };
const VULN_NOT_CLEAN = '조회 실패·미조회·취소는 "취약점 없음"이 아닙니다.';
const OSV_SCOPE_NOTE = 'OSV는 알려진 취약점 데이터베이스입니다. 조회 결과가 없다는 사실만으로 패키지나 앱 전체가 안전하다고 보장할 수 없습니다.';
const VULN_RETRY = '다시 조회는 제공 화면의 「설치 패키지 조회」 버튼을 직접 누르세요. 자동으로 다시 조회하지 않습니다.';

function packageStatusLabel(pkg, vulns) {
  if (pkg?.status === 'unverifiable' && vulns.length > 0) return '일부 확인·전체 조회 확인 불가(unverifiable) — 받은 취약점 ID는 그대로 표시합니다';
  return PKG_STATUS_TEXT[pkg?.status] ?? `조회 확인 불가(${statusCode(pkg?.status)})`;
}
const pkgTone = (pkg) => (Object.hasOwn(PKG_STATUS_TONE, pkg?.status) ? PKG_STATUS_TONE[pkg.status] : 'unknown');

function renderPackageRow(pkg) {
  const li = document.createElement('li');
  li.className = 'vuln-package';
  const name = hasVal(pkg?.name) ? String(pkg.name) : '';
  const version = hasVal(pkg?.version) ? String(pkg.version) : '';
  li.setAttribute('data-student-package-name', name);
  li.setAttribute('data-student-package-version', version);
  li.dataset.status = String(pkg?.status ?? 'unknown');

  const vulns = Array.isArray(pkg?.vulnerabilities) ? pkg.vulnerabilities : [];
  li.append(row('패키지(name)', name || '확인 불가', name ? undefined : 'unknown'));
  li.append(row('설치된 정확한 버전(version)', version || '확인 불가', version ? undefined : 'unknown'));
  li.append(row('조회 상태(status)', packageStatusLabel(pkg, vulns), pkgTone(pkg)));
  li.append(row('출처(source)', hasVal(pkg?.source) ? String(pkg.source) : '확인 불가'));
  li.append(row('패키지 조회 시각(checkedAt)', hasVal(pkg?.checkedAt) ? String(pkg.checkedAt) : '확인 불가'));

  if (vulns.length) {
    const ul = document.createElement('ul');
    ul.className = 'identity-list vuln-findings';
    for (const v of vulns) {
      const vli = document.createElement('li');
      vli.setAttribute('data-student-vulnerability-id', String(v?.id ?? ''));
      vli.append(row('취약점 ID(id)', String(v?.id ?? '확인 불가')));
      vli.append(row('수정 시각(modified)', String(v?.modified ?? '확인 불가')));
      ul.append(vli);
    }
    li.append(ul);
  } else if (pkg?.status === 'unverifiable') {
    li.append(row('취약점', '조회하지 못해 확인할 수 없습니다. 취약점 없음이 아닙니다.', 'unknown'));
  } else if (pkg?.status === 'known_vulnerabilities') {
    li.append(row('취약점', '알려진 항목이 있다고 했지만 ID를 받지 못했습니다. 확인 불가로 봅니다.', 'unknown'));
  }
  return li;
}

export function renderVulnerabilities({ status, mode, data, error } = {}) {
  const root = document.createElement('section');
  root.className = 'vulnerabilities';
  root.setAttribute('aria-label', '설치 패키지 버전과 알려진 취약점 조회 결과');
  root.dataset.status = status ?? 'idle';

  const notice = modeNotice(mode);
  if (notice) root.append(notice);

  if (status === undefined || status === null || status === 'idle') {
    root.append(row('상태', '조회 전(idle)'));
    root.append(row('안내', '아직 조회하지 않았습니다. 조회 전은 "취약점 없음"이 아닙니다.'));
    root.append(row('다시 조회', VULN_RETRY));
    return root;
  }
  if (status === 'loading') {
    root.append(row('상태', '조회 중(loading)'));
    root.append(row('안내', '조회가 끝나기 전에는 결과를 표시하지 않습니다. 이전 결과는 현재 결과가 아닙니다.'));
    return root;
  }
  if (status !== 'ok') {
    // error(또는 알 수 없는 상태): 실패. 이전 표를 그리지 않습니다.
    root.dataset.status = 'error';
    const code = safeCode(error?.code);
    const msg = safeText(error?.message) ? error.message : '확인 불가';
    const cancelled = ['CANCELLED', 'REQUEST_CANCELLED'].includes(error?.code);
    root.append(row('상태', `${cancelled ? '조회 취소' : '조회 실패'}: ${msg}`, 'alert'));
    root.append(row('원인(code)', code));
    root.append(row('구분', `${VULN_NOT_CLEAN} 이전 조회 결과를 현재 결과로 보지 않습니다.`, 'alert'));
    root.append(row('다시 조회', VULN_RETRY));
    return root;
  }

  // status === 'ok'
  const d = data ?? {};
  const scanStatus = d.status;
  root.dataset.scan = String(scanStatus ?? 'unknown');
  root.append(row('전체 조회 상태', SCAN_STATUS_TEXT[scanStatus] ?? `확인 불가(${statusCode(scanStatus)})`,
    SCAN_STATUS_TONE[scanStatus] ?? 'unknown'));
  if (scanStatus !== 'complete') root.append(row('구분', VULN_NOT_CLEAN, 'unknown'));

  root.append(explainHeading('전체 결과(package-lock.json·설치된 node_modules 대조)'));
  root.append(row('기준', '버전은 package-lock.json 과 설치된 node_modules 메타데이터를 대조한 설치 버전입니다. ^1.2.0 같은 범위 표기가 아닙니다.'));
  if (hasVal(d.code)) root.append(row('코드(code)', safeCode(d.code)));
  if (hasVal(d.lockfileVersion)) root.append(row('lock 파일 버전(lockfileVersion)', String(d.lockfileVersion)));
  if (hasVal(d.lockfileHash)) root.append(row('lock 파일 해시(lockfileHash)', String(d.lockfileHash)));
  if (hasVal(d.checkedAt)) root.append(row('조회 시각(checkedAt)', String(d.checkedAt)));
  if (d.excluded && Number.isSafeInteger(d.excluded.count)) {
    root.append(row('조회 제외', `${d.excluded.count}건 — 승인되지 않은 패키지 등은 밖으로 보내 조회하지 않았습니다.`));
  }

  const packages = Array.isArray(d.packages) ? d.packages : [];
  root.append(explainHeading('패키지별 결과'));
  if (!packages.length) {
    const why = scanStatus === 'complete'
      ? '표시할 패키지 조회 결과가 없습니다.'
      : '조회한 패키지가 없습니다. 미조회·확인 불가 상태이며 취약점 없음이 아닙니다.';
    root.append(row('패키지', why, scanStatus === 'complete' ? undefined : 'unknown'));
  } else {
    const counts = { known_vulnerabilities: 0, none_found: 0, unverifiable: 0 };
    for (const p of packages) if (Object.hasOwn(counts, p?.status)) counts[p.status] += 1;
    root.append(row('요약', `알려진 항목 있음 ${counts.known_vulnerabilities}건 · 알려진 항목 없음 ${counts.none_found}건 · 조회 확인 불가 ${counts.unverifiable}건`));
    const ul = document.createElement('ul');
    ul.className = 'identity-list vuln-packages';
    for (const p of packages) ul.append(renderPackageRow(p));
    root.append(ul);
  }
  root.append(row('참고', OSV_SCOPE_NOTE));
  return root;
}

// 설치 패키지 학생 화면. update 로 새 입력이 오면 통째로 교체합니다(이전 표 제거).
export function createVulnerabilitiesView() {
  const root = document.createElement('div');
  root.className = 'student-vulnerabilities';

  const heading = document.createElement('h2');
  heading.textContent = '설치 패키지와 알려진 취약점';
  root.append(heading);

  const slot = document.createElement('div');
  slot.className = 'student-vulnerabilities-slot';
  slot.setAttribute('aria-live', 'polite');
  root.append(slot);

  slot.append(renderVulnerabilities({ status: 'idle' }));

  return {
    element: root,
    update(input) {
      slot.replaceChildren(renderVulnerabilities(input ?? {}));
    },
  };
}

// ===== on-client 제공 UI 연결 (ALEPH Workbench) =====
// 제공 app.js는 createStudentView({ api, onChange })를 호출하고, 각 메서드를
// studentData(kind)로 불러 DOM 요소(또는 문자열)를 받아 화면에 붙입니다.
// 여기서는 위에서 구현한 학생 render 함수들을 그대로 묶어 돌려줍니다.
// 13~20단계 학생 render 함수를 모두 연결합니다.
export function createStudentView(context) {
  // 내 PC 점검이 버튼을 누를 때만 조회하도록 api·onChange 를 기억해 둡니다.
  pcState.api = context?.api ?? null;
  pcState.onChange = typeof context?.onChange === 'function' ? context.onChange : null;
  return {
    renderIdentity: (data) => renderIdentity(data),
    renderDecision: (data) => renderDecision(data),
    renderEvents: (data) => renderEvents(data),
    renderStatus: (data) => renderStatus(data),
    renderAiConnection: (data) => renderAiConnection(data),
    renderExplanation: (data) => renderExplanation(data),
    renderVulnerabilities: (data) => renderVulnerabilities(data),
    renderAction: (data) => renderAction(data),
  };
}
