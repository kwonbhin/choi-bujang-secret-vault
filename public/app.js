// 13단계 호스트 화면 (제공 영역). 학생은 이 파일이 아니라 student/extension.mjs 를 고칩니다.
// 역할: 세 메뉴(보호 현황·업무 앱·보안 기록)를 마우스와 Tab·Enter 로 오갈 수 있게 하고,
//       '다시 불러오기'로 신원 데이터를 다시 받아 학생 함수 renderIdentity 에 넘깁니다.
// 학생 모듈은 public 안에서 제공됩니다(/student/extension.mjs). 빌드가 student/ 를 복사합니다.
import { createStudentView } from './student/extension.mjs';

// 예제 신원 데이터. 서버가 없거나 꺼지면 fetch 가 실패해 error 상태가 보입니다.
const IDENTITY_SOURCE = './identity.sample.json';

const MENUS = [
  { id: 'status', label: '보호 현황' },
  { id: 'apps', label: '업무 앱' },
  { id: 'log', label: '보안 기록' },
];

const app = document.querySelector('#app');
const studentView = createStudentView();

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
    reload.addEventListener('click', () => { loadIdentity(); });
    bar.append(reload);
    panel.append(bar, studentView.element);
  } else if (menu.id === 'apps') {
    panel.append(exampleList('업무 앱', [
      '백업 복구 — 사본에서 자료 되살리기',
    ]));
    const link = document.createElement('a');
    link.href = './vault.html';
    link.textContent = '자료실 열기 — 로그인한 계정의 가상 메모';
    link.className = 'app-link';
    panel.append(link);
  } else {
    panel.append(exampleList('보안 기록(예제)', [
      '등록되지 않은 기기의 접속 시도 거부',
      '평소와 다른 시각·네트워크의 접속 추가 확인',
    ]));
  }
  return panel;
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
