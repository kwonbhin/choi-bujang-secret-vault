// 13단계 호스트 화면 (제공 영역). 학생은 이 파일이 아니라 student/extension.mjs 를 고칩니다.
// 역할: 세 메뉴(보호 현황·업무 앱·보안 기록)를 마우스와 Tab·Enter 로 오갈 수 있게 하고,
//       '다시 불러오기'로 신원 데이터를 다시 받아 학생 함수 renderIdentity 에 넘깁니다.
// 학생 모듈은 public 안에서 제공됩니다(/student/extension.mjs). 빌드가 student/ 를 복사합니다.
import { createStudentView, createDecisionView, createEventsView, createStatusView, createAiConnectionView } from './student/extension.mjs';

// 예제 신원 데이터. 서버가 없거나 꺼지면 fetch 가 실패해 error 상태가 보입니다.
const IDENTITY_SOURCE = './identity.sample.json';

const MENUS = [
  { id: 'status', label: '보호 현황' },
  { id: 'apps', label: '업무 앱' },
  { id: 'log', label: '보안 기록' },
];

const app = document.querySelector('#app');
const studentView = createStudentView();
const decisionView = createDecisionView();
const eventsView = createEventsView();
const statusView = createStatusView();
const aiView = createAiConnectionView();

// 업무 앱 목록(예제). 접근 요청 시 선택한 앱 하나의 판정을 받습니다.
const WORK_APPS = [
  { id: 'vault', label: '자료실' },
  { id: 'backup', label: '백업 복구' },
  { id: 'payroll', label: '결재' },
  { id: 'mail', label: '메일' },
];
let selectedApp = WORK_APPS[0].id;
const appChoiceButtons = [];

// --- 메뉴(탭) + 패널 만들기 ---
const tablist = document.createElement('div');
tablist.className = 'menu';
tablist.setAttribute('role', 'tablist');
tablist.setAttribute('aria-label', '보안 Agent 메뉴');

const panels = new Map();
const tabs = [];

function buildPanel(menu) {
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = `panel-${menu.id}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `tab-${menu.id}`);
  panel.tabIndex = 0;

  if (menu.id === 'status') {
    const bar = document.createElement('div');
    bar.className = 'panel-bar';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'reload';
    reload.textContent = '다시 불러오기';
    // 위쪽 '다시 불러오기': 신원과 보안 상태(기기·세션·알림·진단)를 사용자가 누를 때만 다시 불러옵니다.
    reload.addEventListener('click', () => { loadIdentity(); loadStatus(); });
    bar.append(reload);
    panel.append(bar, studentView.element, statusView.element);
    buildAiControls(panel);
  } else if (menu.id === 'apps') {
    buildAppsPanel(panel);
  } else {
    buildLogPanel(panel);
  }
  return panel;
}

// 보안 기록 패널: 관측 범위 안내(제공 화면 몫) + 다시 불러오기 + renderEvents 목록
function buildLogPanel(panel) {
  const h = document.createElement('h2');
  h.textContent = '보안 기록';
  panel.append(h);

  const scope = document.createElement('p');
  scope.className = 'panel-hint';
  scope.textContent = '이 목록은 본인의 최근 40건입니다. 전체 로그나 다른 직원 기록, 실시간 전체 탐지가 아닙니다.';
  panel.append(scope);

  const bar = document.createElement('div');
  bar.className = 'panel-bar';
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'reload';
  reload.textContent = '다시 불러오기';
  reload.addEventListener('click', () => { loadEvents(); });
  bar.append(reload);
  panel.append(bar, eventsView.element);
}

function exampleList(title, items) {
  const wrap = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = title;
  const ul = document.createElement('ul');
  ul.className = 'identity-list';
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    ul.append(li);
  }
  wrap.append(h, ul);
  return wrap;
}

// 업무 앱 패널: 앱 선택 → 접근 요청 → 판정을 renderDecision 으로 표시
function buildAppsPanel(panel) {
  const h = document.createElement('h2');
  h.textContent = '업무 앱 접근 요청';
  panel.append(h);

  const hint = document.createElement('p');
  hint.className = 'panel-hint';
  hint.textContent = '앱을 고르면 그 앱 한 개의 접근 판정을 요청합니다.';
  panel.append(hint);

  const chooser = document.createElement('div');
  chooser.className = 'app-chooser';
  chooser.setAttribute('role', 'group');
  chooser.setAttribute('aria-label', '업무 앱 선택');
  WORK_APPS.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'app-choice';
    b.textContent = a.label;
    b.setAttribute('aria-pressed', a.id === selectedApp ? 'true' : 'false');
    // 마우스·키보드(Tab→Enter) 모두: 앱을 고르면 바로 그 앱의 판정을 요청합니다.
    b.addEventListener('click', () => {
      selectedApp = a.id;
      appChoiceButtons.forEach((x, i) => x.setAttribute('aria-pressed', WORK_APPS[i].id === selectedApp ? 'true' : 'false'));
      loadDecision(a.id);
    });
    appChoiceButtons.push(b);
    chooser.append(b);
  });
  panel.append(chooser);

  const requestBtn = document.createElement('button');
  requestBtn.type = 'button';
  requestBtn.className = 'reload';
  requestBtn.textContent = '접근 요청';
  requestBtn.addEventListener('click', () => loadDecision(selectedApp));
  panel.append(requestBtn);

  panel.append(decisionView.element);

  // 기존 메모 앱(자료실) 바로가기 — 앞 단계 기능 보존
  const link = document.createElement('a');
  link.href = './vault.html';
  link.textContent = '자료실 열기 — 로그인한 계정의 가상 메모';
  link.className = 'app-link';
  panel.append(link);
}

// 예제 판정 자료. 서버가 없거나 꺼지면 fetch 가 실패해 error 상태가 보입니다.
const DECISION_SOURCE = './decision.sample.json';
async function loadDecision(appId) {
  decisionView.update({ status: 'loading', appId });
  try {
    const response = await fetch(DECISION_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    const all = await response.json();
    const entry = all && all[appId];
    const checkedAt = new Date().toISOString();
    if (!entry) {
      // 목록에 없는 앱: 판정 확인 불가
      decisionView.update({ status: 'ok', mode: 'demo', appId, data: { appId, decision: 'unknown', reason: '판정 정보가 없습니다.', checkedAt } });
      return;
    }
    decisionView.update({ status: 'ok', mode: 'demo', appId, data: { ...entry, appId, checkedAt } });
  } catch (error) {
    decisionView.update({ status: 'error', mode: 'disconnected', appId, error: { message: error.message } });
  }
}

// 17단계: AI 연결 영역(제공 화면). 주소·열쇠 입력 없음. 연결 순서 버튼 + 점검/취소/다시 연결.
// 실제 연결은 운영 측 계정 권한이 준비돼야 되며, 학생 코드는 결과 표시만 합니다.
let aiCheckToken = 0;
const AI_SOURCE = './ai-connection.sample.json';
function aiNote(text) { const n = document.getElementById('ai-note'); if (n) n.textContent = text; }
async function loadAiConnection() {
  const my = ++aiCheckToken;
  aiView.update({ status: 'loading' });
  try {
    const response = await fetch(AI_SOURCE, { cache: 'no-store' });
    if (my !== aiCheckToken) return; // 취소·다른 점검이 끼어들면 늦은 응답 무시
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    const payload = await response.json();
    if (my !== aiCheckToken) return;
    aiView.update({ status: 'ok', mode: 'demo', data: payload.data, checkedAt: new Date().toISOString(), explanationAccepted: false });
  } catch (error) {
    if (my !== aiCheckToken) return;
    aiView.update({ status: 'error', mode: 'disconnected', error: { code: 'TIMEOUT_NETWORK', message: error.message }, checkedAt: new Date().toISOString() });
  }
}
function cancelAiCheck() {
  aiCheckToken++; // 진행 중 점검의 늦은 응답을 버립니다.
  aiView.update({ status: 'error', error: { code: 'CANCELLED', message: '사용자가 점검을 취소했습니다.' }, checkedAt: new Date().toISOString() });
}
function resetAiConnection() {
  aiCheckToken++; // 계정 다시 연결: 이전 점검 결과를 지우고 점검 전으로.
  aiView.update({ status: 'idle' });
  aiNote('');
}
function buildAiControls(panel) {
  const wrap = document.createElement('div');
  wrap.className = 'ai-controls';
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reload';
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  wrap.append(
    mk('AI 연결 시작', () => aiNote('확인 번호를 승인 페이지와 대조한 뒤 승인하세요. (데모)')),
    mk('승인 페이지 열기', () => aiNote('포털에서 같은 계정으로 승인한 뒤 「승인했으며 연결 확인」을 누르세요. (데모)')),
    mk('승인했으며 연결 확인', () => aiNote('승인 확인됨. 이제 「현재 API 연결 점검」을 누르세요. (데모)')),
    mk('현재 API 연결 점검', () => loadAiConnection()),
    mk('취소', () => cancelAiCheck()),
    mk('계정 다시 연결', () => resetAiConnection()),
  );
  const note = document.createElement('p');
  note.className = 'panel-hint';
  note.id = 'ai-note';
  note.textContent = '';
  panel.append(wrap, note, aiView.element);
}

// 진단 정보는 제공 화면(이 호스트)이 조회해 renderStatus 입력으로 전달합니다.
// 학생 코드(student/extension.mjs)는 /api/diagnostics 를 직접 호출하지 않습니다.
const STATUS_SOURCE = './status.sample.json';
async function loadStatus() {
  statusView.update({
    devices: { status: 'loading' },
    sessions: { status: 'loading' },
    diagnostics: { status: 'loading' },
    notifications: [],
  });
  try {
    const response = await fetch(STATUS_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    const s = await response.json();
    statusView.update({
      devices: s.devices,
      sessions: s.sessions,
      notifications: s.notifications,
      diagnostics: s.diagnostics,
      mode: 'demo',
    });
  } catch (error) {
    const field = { status: 'error', mode: 'disconnected', error: { message: error.message } };
    statusView.update({ devices: field, sessions: field, notifications: [], diagnostics: field, mode: 'disconnected' });
  }
}

// 예제 보안 기록. 서버가 없거나 꺼지면 fetch 가 실패해 error 상태가 보입니다.
const EVENTS_SOURCE = './events.sample.json';
async function loadEvents() {
  eventsView.update({ status: 'loading' });
  try {
    const response = await fetch(EVENTS_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    const data = await response.json();
    eventsView.update({ status: 'ok', mode: 'demo', data });
  } catch (error) {
    eventsView.update({ status: 'error', mode: 'disconnected', error: { message: error.message } });
  }
}

function selectTab(index) {
  MENUS.forEach((menu, i) => {
    const active = i === index;
    tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    // 세 메뉴 모두 Tab 순서에 둡니다. Tab 으로 각 메뉴에 도달하고 Enter(또는 Space)로 선택합니다.
    tabs[i].tabIndex = 0;
    panels.get(menu.id).hidden = !active;
  });
}

MENUS.forEach((menu, index) => {
  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'menu-item';
  tab.id = `tab-${menu.id}`;
  tab.textContent = menu.label;
  tab.setAttribute('role', 'tab');
  tab.setAttribute('aria-controls', `panel-${menu.id}`);
  tab.addEventListener('click', () => {
    selectTab(index);
    tabs[index].focus();
  });
  // 좌우 화살표·Home·End 로도 메뉴 이동 (Tab·Enter 는 버튼 기본 동작)
  tab.addEventListener('keydown', (event) => {
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % MENUS.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + MENUS.length) % MENUS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MENUS.length - 1;
    if (next === null) return;
    event.preventDefault();
    selectTab(next);
    tabs[next].focus();
  });
  tabs.push(tab);
  tablist.append(tab);
  panels.set(menu.id, buildPanel(menu));
});

app.append(tablist);
for (const menu of MENUS) app.append(panels.get(menu.id));
selectTab(0);

// --- 신원 데이터 불러오기 ---
const loadingField = { status: 'loading' };

async function loadIdentity() {
  // 먼저 불러오는 중으로 표시
  studentView.update({ me: loadingField, devices: loadingField, sessions: loadingField });
  try {
    const response = await fetch(IDENTITY_SOURCE, { cache: 'no-store' });
    if (!response.ok) throw new Error(`서버 응답 ${response.status}`);
    const payload = await response.json();
    // payload 는 { me, devices, sessions } 각각 { status, mode, data } 형태.
    studentView.update(payload);
  } catch (error) {
    // 연결 실패: 세 영역 모두 error 로 바꿔, 이전 사용자 값이 남지 않게 합니다.
    const field = { status: 'error', mode: 'disconnected', error: { message: error.message } };
    studentView.update({ me: field, devices: field, sessions: field });
  }
}

loadIdentity();
loadStatus();
loadEvents();
