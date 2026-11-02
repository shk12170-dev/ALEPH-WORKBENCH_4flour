// 이 파일은 학생이 같은 프로젝트에서 이어서 구현합니다.
// 제공 UI를 받은 것만으로 단계 완료를 인정하지 않습니다.
// ---- 13단계: 로그인 사용자·기기·세션 표시 (DOM은 createElement와 textContent로만 만듭니다) ----
const DEVICE_LABELS = { compliant: '보안 기준 충족', noncompliant: '보안 기준 미충족', unknown: '확인 불가' };
const SESSION_LABELS = { active: '활성', expired: '만료', revoked: '철회됨', unknown: '확인 불가' };
const MODE_LABELS = { demo: '예제 자료', disconnected: '연결 없음', unknown: '확인 불가', connected: '연결됨' };

function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// 정의되지 않은 값은 정상으로 보이지 않도록 확인 불가로 둡니다.
function labelOf(table, value) {
  return Object.hasOwn(table, value) ? table[value] : table.unknown;
}

function modeText(mode) {
  return labelOf(MODE_LABELS, typeof mode === 'string' ? mode : 'unknown').replace(/^/, '자료 출처: ');
}

function statusLine(kind, label, status, table, okValue) {
  const known = Object.hasOwn(table, status) ? status : 'unknown';
  // 번역 문구 옆에 서버가 보낸 원래 코드 값을 글자로 함께 보여 줍니다. 계약에 없는 값도 그대로 보입니다.
  const raw = typeof status === 'string' && status ? status : 'unknown';
  const text = `${label}: ${table[known]}(${raw})`;
  const line = node('span', known === okValue ? text : `주의 · ${text}`, `identity-status identity-status-${known}`);
  line.dataset.status = known;
  return line;
}

function resourceSection(title, resource, renderOk) {
  const section = node('section', undefined, 'identity-resource');
  section.append(node('h3', title));
  const res = resource && typeof resource === 'object' ? resource : { status: 'error', mode: 'unknown' };
  section.append(node('p', modeText(res.mode), `identity-mode identity-mode-${typeof res.mode === 'string' ? res.mode : 'unknown'}`));
  if (res.status === 'loading') {
    section.append(node('p', '불러오는 중…', 'state state-loading'));
  } else if (res.status === 'ok' && res.data != null) {
    renderOk(section, res.data);
  } else if (res.status === 'error') {
    const message = res.error && typeof res.error.message === 'string' && res.error.message ? res.error.message : '서버 응답 없음';
    // 오류에서는 이전 사용자·기기·세션 값을 남기지 않고 안내만 보여 줍니다.
    section.append(node('p', `연결 실패: ${message}`, 'state state-error'));
  } else {
    section.append(node('p', `${title} 확인 불가: 서버 응답을 확인할 수 없습니다.`, 'state state-error'));
  }
  return section;
}

function renderIdentity(input) {
  const { me, devices, sessions } = input || {};
  const root = node('div', undefined, 'student-identity-view');
  root.dataset.testid = 'student-identity-view';

  root.append(resourceSection('로그인 사용자', me, (section, data) => {
    const list = node('dl');
    const user = data.user || {};
    const device = data.device || {};
    const session = data.session || {};
    list.append(node('dt', '사용자'), node('dd', `${user.label ?? '이름 없음'} (${user.id ?? 'ID 없음'})`));
    list.append(node('dt', '현재 기기'), node('dd', `${device.label ?? '이름 없음'} (${device.id ?? 'ID 없음'})`));
    const deviceDd = node('dd');
    deviceDd.append(statusLine('device', '기기 상태', device.status, DEVICE_LABELS, 'compliant'));
    list.append(node('dt', '기기 보안 상태'), deviceDd);
    const sessionDd = node('dd');
    sessionDd.append(node('span', `${session.id ?? 'ID 없음'} · `), statusLine('session', '세션 상태', session.status, SESSION_LABELS, 'active'));
    list.append(node('dt', '현재 세션'), sessionDd);
    section.append(list);
  }));

  const currentDeviceId = me && me.status === 'ok' && me.data && me.data.device ? me.data.device.id : null;
  root.append(resourceSection('등록된 기기', devices, (section, data) => {
    if (!Array.isArray(data) || data.length === 0) return section.append(node('p', '등록된 기기가 없습니다.', 'state state-empty'));
    const list = node('ul');
    for (const device of data) {
      const item = node('li', `${device.label ?? '이름 없음'} (${device.id ?? 'ID 없음'})${device.id === currentDeviceId ? ' · 현재 기기' : ''} · `);
      item.append(statusLine('device', '기기 상태', device.status, DEVICE_LABELS, 'compliant'));
      list.append(item);
    }
    section.append(list);
  }));

  root.append(resourceSection('로그인 세션', sessions, (section, data) => {
    if (!Array.isArray(data) || data.length === 0) return section.append(node('p', '로그인 세션이 없습니다.', 'state state-empty'));
    const list = node('ul');
    for (const session of data) {
      const item = node('li', `${session.id ?? 'ID 없음'} · `);
      item.append(statusLine('session', '세션 상태', session.status, SESSION_LABELS, 'active'));
      list.append(item);
    }
    section.append(list);
  }));

  return root;
}

// ---- 14단계: 업무 앱 접근 판정 표시 ----
// allow는 정책상 허용이라는 뜻이며 실제 앱 접속 성공을 보장하지 않습니다.
// challenge는 이 앱이 추가 인증을 대신 수행한다는 뜻이 아닙니다.
const DECISION_LABELS = {
  allow: { text: '접근 허용', note: '정책상 접근이 허용된 판정입니다. 실제 앱 접속 성공을 보장하지 않습니다.' },
  deny: { text: '접근 거부', note: '정책상 접근이 거부된 판정입니다.' },
  challenge: { text: '추가 인증 또는 확인 필요', note: '접근 전에 추가 확인이 필요합니다. 이 화면은 추가 인증을 대신 수행하지 않습니다.' },
  unknown: { text: '판정 확인 불가', note: '판정을 확인할 수 없습니다. 접근이 허용된 것으로 보지 않습니다.' },
};

function formatCheckedAt(value) {
  if (typeof value !== 'string' || !value) return '시각 정보 없음';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleString('ko-KR')} (${value})`;
}

function renderDecision(input) {
  const { status, mode, data, error, appId } = input || {};
  const root = node('div', undefined, 'student-decision-view');
  root.dataset.testid = 'student-decision-view';
  root.append(node('h3', '업무 앱 접근 판정'));
  root.append(node('p', modeText(mode), `identity-mode identity-mode-${typeof mode === 'string' ? mode : 'unknown'}`));

  if (status === 'idle' || status === undefined) {
    root.append(node('p', '앱을 골라 접속을 요청하세요.', 'state state-empty'));
    return root;
  }
  const shownApp = data && typeof data.appId === 'string' && data.appId ? data.appId : appId;
  if (shownApp) root.append(node('p', `대상 앱: ${shownApp}`));

  if (status === 'loading') {
    root.append(node('p', '판정 확인 중…', 'state state-loading'));
  } else if (status === 'error') {
    // 요청 실패는 거부 판정과 다릅니다. 판정을 받지 못했을 뿐입니다.
    const message = error && typeof error.message === 'string' && error.message ? error.message : '서버 응답 없음';
    root.append(node('p', `요청 실패: ${message}`, 'state state-error'));
    root.append(node('p', '접근 거부 판정이 아닙니다. 판정을 받지 못했으므로 접근 허용 여부를 알 수 없습니다.', 'state state-error'));
  } else if (status === 'ok' && data && typeof data === 'object') {
    const known = typeof data.decision === 'string' && Object.hasOwn(DECISION_LABELS, data.decision) ? data.decision : 'unknown';
    const info = DECISION_LABELS[known];
    const verdict = node('p', `판정: ${info.text}(${known})`, `decision-verdict decision-verdict-${known}`);
    verdict.dataset.decision = known;
    root.append(verdict);
    // 목록에 없는 값은 확인 불가로 처리하되, 받은 원래 값은 글자로 남깁니다.
    if (known === 'unknown' && data.decision !== 'unknown') root.append(node('p', `수신한 판정 값: ${typeof data.decision === 'string' && data.decision ? data.decision : '없음'}`));
    root.append(node('p', info.note, 'decision-note'));
    root.append(node('p', `판정 이유: ${typeof data.reason === 'string' && data.reason ? data.reason : '이유 정보 없음'}`));
    root.append(node('p', `판정 시각: ${formatCheckedAt(data.checkedAt)}`));
  } else {
    const info = DECISION_LABELS.unknown;
    root.append(node('p', `판정: ${info.text}(unknown)`, 'decision-verdict decision-verdict-unknown'));
    root.append(node('p', info.note, 'decision-note'));
  }
  return root;
}

// ---- 15단계: 접속 기록·XDR 경보 목록과 상세 보기 ----
// 본인의 최근 기록(최대 40건)만 받습니다. 모든 직원의 전체 이력이나 실시간 전체 위협 탐지가 아닙니다.
// supportedActions 는 읽지 않고 조치 버튼은 만들지 않습니다(연결되지 않은 조치 안내는 16단계).
const KIND_LABELS = { access: '접속', xdr: 'XDR 경보' };
const ACCESS_LABELS = { allowed: '허용됨', denied: '거부됨', unknown: '확인 불가' };
const MISSING_APP = '';

function withCode(table, value) {
  const known = typeof value === 'string' && Object.hasOwn(table, value) ? value : 'unknown';
  const raw = typeof value === 'string' && value ? value : 'unknown';
  return `${table[known]}(${raw})`;
}

function kindText(kind) {
  return typeof kind === 'string' && Object.hasOwn(KIND_LABELS, kind) ? `${KIND_LABELS[kind]}(${kind})` : `종류 확인 불가(${kind ?? 'unknown'})`;
}

function appText(appId) {
  return typeof appId === 'string' && appId ? appId : '앱을 확인할 수 없음';
}

function textRows(title, rows) {
  const block = node('div', undefined, 'event-detail-block');
  block.append(node('h4', title));
  if (!Array.isArray(rows) || rows.length === 0) {
    block.append(node('p', '없음'));
    return block;
  }
  const list = node('ul');
  for (const row of rows) list.append(node('li', `${row?.id ?? 'ID 없음'}: ${row?.text ?? ''}`));
  block.append(list);
  return block;
}

function eventDetail(event) {
  const detail = node('section', undefined, 'student-event-detail');
  detail.dataset.studentEventDetail = event.id;
  detail.append(node('h3', `${event.id} 상세`));
  const info = node('dl');
  info.append(node('dt', '사건 ID'), node('dd', String(event.id)));
  info.append(node('dt', '앱(appId)'), node('dd', appText(event.appId)));
  detail.append(info);
  detail.append(textRows('근거(evidence)', event.evidence));
  detail.append(textRows('규칙(rules)', event.rules));
  const state = event.state && typeof event.state === 'object' ? event.state : {};
  const states = node('dl');
  states.append(node('dt', '접속 상태(access)'), node('dd', withCode(ACCESS_LABELS, state.access)));
  states.append(node('dt', '세션 상태(session)'), node('dd', withCode(SESSION_LABELS, state.session)));
  states.append(node('dt', '기기 상태(device)'), node('dd', withCode(DEVICE_LABELS, state.device)));
  detail.append(states);
  // 연결되지 않은 조치가 입력된 경우에만 안내합니다. 비활성 버튼이며 어떤 요청도 보내지 않습니다.
  const actions = Array.isArray(event.supportedActions)
    ? event.supportedActions.filter((a) => typeof a === 'string' && ACTION_ID.test(a))
    : [];
  if (actions.length > 0) {
    const block = node('div', undefined, 'event-detail-block event-unsupported-actions');
    block.append(node('h4', '조치'));
    for (const action of actions) {
      const button = node('button', `${action} 미지원`);
      button.type = 'button';
      button.disabled = true;
      button.setAttribute('aria-label', `${action} 미지원`);
      block.append(button);
    }
    block.append(node('p', '아직 지원하지 않는 조치입니다. 조치 실행 연결은 준비 중이며 이 화면은 어떤 요청도 보내지 않습니다.', 'muted'));
    detail.append(block);
  }
  return detail;
}

function filterBox(name, options) {
  const label = node('label', `${name} `);
  const select = node('select');
  select.setAttribute('aria-label', name);
  for (const [value, text] of options) {
    const option = node('option', text);
    option.value = value;
    select.append(option);
  }
  label.append(select);
  return { label, select };
}

function renderEvents(input) {
  const { status, mode, data, error } = input || {};
  const root = node('div', undefined, 'student-events-view');
  root.dataset.testid = 'student-events-view';
  root.append(node('h3', '내 접속 기록·XDR 경보'));
  root.append(node('p', modeText(mode), `identity-mode identity-mode-${typeof mode === 'string' ? mode : 'unknown'}`));
  root.append(node('p', '본인의 최근 기록(최대 40건)입니다. 모든 직원의 전체 이력이나 실시간 전체 위협 탐지가 아닙니다.', 'muted'));

  if (status === 'loading') {
    root.append(node('p', '기록을 불러오는 중…', 'state state-loading'));
    return root;
  }
  if (status === 'error' || (status === 'ok' && !Array.isArray(data))) {
    // 실패는 빈 목록과 다릅니다. 이전 목록은 그리지 않습니다.
    const message = error && typeof error.message === 'string' && error.message ? error.message : '서버 응답 없음';
    root.append(node('p', `기록을 불러오지 못했습니다: ${message}`, 'state state-error'));
    if (status === 'ok' || (error && (error.code === 'CONTRACT_MISMATCH' || error.code === 'ENGINE_RESULT_UNVERIFIED'))) {
      root.append(node('p', '확인 불가: 응답을 확인할 수 없어 기록을 표시하지 않습니다. 기록이 없다는 뜻이 아닙니다.', 'state state-error'));
    }
    return root;
  }
  if (status !== 'ok') {
    root.append(node('p', '기록 상태를 확인할 수 없습니다.', 'state state-error'));
    return root;
  }
  // 값 출처는 기록 조회가 성공해 결과를 보여 줄 때만 붙입니다. 불러오는 중·조회 실패·확인 불가에는 보여 주는 값이 없습니다.
  root.append(node('p', `값 출처: ${valueTag(mode)}`, 'muted'));
  if (data.length === 0) {
    root.append(node('p', '표시할 기록이 없습니다.', 'state state-empty'));
    return root;
  }

  // 원본 배열은 고치지 않고 복사해서 최신순으로 정렬합니다.
  const events = [...data].sort((a, b) => (Date.parse(b?.at) || 0) - (Date.parse(a?.at) || 0));
  const appOf = (e) => (typeof e.appId === 'string' && e.appId ? e.appId : MISSING_APP);
  const kinds = [...new Set(events.map((e) => e.kind))];
  const apps = [...new Set(events.map(appOf))];
  const accesses = [...new Set(events.map((e) => e.state?.access))];

  const kindFilter = filterBox('기록 종류', [['all', '전체'], ...kinds.map((k) => [String(k), kindText(k)])]);
  const appFilter = filterBox('업무 앱', [['all', '전체'], ...apps.map((a) => [a, a === MISSING_APP ? '앱을 확인할 수 없음' : a])]);
  const accessFilter = filterBox('접속 상태', [['all', '전체'], ...accesses.map((a) => [String(a), withCode(ACCESS_LABELS, a)])]);
  const filters = node('div', undefined, 'student-event-filters');
  filters.append(kindFilter.label, appFilter.label, accessFilter.label);

  const count = node('p', undefined, 'student-event-count');
  count.setAttribute('role', 'status');
  const list = node('ul', undefined, 'student-event-list');
  const detailSlot = node('div', undefined, 'student-event-detail-slot');
  detailSlot.setAttribute('aria-live', 'polite');
  let selectedId = null;

  function draw() {
    const shown = events.filter((e) => (kindFilter.select.value === 'all' || String(e.kind) === kindFilter.select.value)
      && (appFilter.select.value === 'all' || appOf(e) === appFilter.select.value)
      && (accessFilter.select.value === 'all' || String(e.state?.access) === accessFilter.select.value));
    count.textContent = `${shown.length}건 표시 / 전체 ${events.length}건 · 가장 최근 ${formatCheckedAt(events[0]?.at)}`;
    list.replaceChildren();
    if (shown.length === 0) list.append(node('li', '선택한 조건에 맞는 기록이 없습니다.', 'state state-empty'));
    for (const event of shown) {
      const row = node('li', undefined, 'student-event-row');
      row.dataset.studentEventId = event.id;
      row.append(node('span', `사건 ID: ${event.id} · 시각: ${formatCheckedAt(event.at)} · 종류: ${kindText(event.kind)} · 앱: ${appText(event.appId)} · 요약: ${event.summary ?? '요약 없음'} `));
      const button = node('button', `${event.id} 상세`);
      button.type = 'button';
      button.setAttribute('aria-label', `${event.id} 상세`);
      button.addEventListener('click', () => {
        selectedId = event.id;
        detailSlot.replaceChildren(eventDetail(event));
      });
      row.append(button);
      list.append(row);
    }
    // 걸러져서 보이지 않게 된 기록의 상세는 지웁니다.
    if (selectedId !== null && !shown.some((e) => e.id === selectedId)) {
      selectedId = null;
      detailSlot.replaceChildren();
    }
  }
  for (const box of [kindFilter, appFilter, accessFilter]) box.select.addEventListener('change', draw);
  draw();

  root.append(filters, count, list, detailSlot);
  return root;
}

// ---- 16단계: 알림·빈 상태·오류·진단 정보 정리 ----
// 다시 시도는 사용자가 제공 화면의 「다시 불러오기」를 직접 누르는 것뿐입니다. 이 파일은 자동 재요청을 하지 않고
// /api/diagnostics 를 직접 부르지 않으며, 제공 화면이 전달한 diagnostics 입력만 읽습니다.
const RESOURCE_NAMES = { devices: '기기 목록', sessions: '세션', diagnostics: '도움정보', events: '접속·보안 기록', me: '로그인 사용자', apps: '업무 앱', access: '접속 판정' };
const TIMEOUT_CODES = ['TIMEOUT', 'ENGINE_TIMEOUT', 'REQUEST_TIMEOUT', 'ACTION_TIMEOUT'];
const SECRET_LIKE = /(?:Bearer\s+\S+|\bsk-[A-Za-z0-9_-]{8,}|\bsb_(?:secret|publishable)_\S+|\beyJ[A-Za-z0-9_-]{8,}\.\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*|(?:api[_ -]?key|authorization|password|secret|token|비밀번호|토큰)\s*[:=]\s*\S+)/giu;

// 서버가 준 값을 화면과 복사본에 쓰기 전에 비밀처럼 보이는 부분을 가리고 길이를 줄입니다.
function safeText(value, fallback = '확인 불가') {
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  const text = String(value).replace(SECRET_LIKE, '[가림]').replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 200);
  return text || fallback;
}

// 제공 화면(public/app.js)의 ID 검증 규칙과 같습니다: 영문·숫자로 시작하고 1~80자. 이 규칙을 통과한 조치 이름은 하나도 생략하지 않습니다.
const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u;

function safeCode(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_.-]{1,64}$/u.test(value) ? value : '확인 불가';
}

function resourceName(key) {
  return Object.hasOwn(RESOURCE_NAMES, key) ? `${RESOURCE_NAMES[key]}(${key})` : safeText(key);
}

// 실패 안내: 무엇을 불러오지 못했는지, 사유, 사용자가 직접 누르는 다시 시도 방법을 함께 적습니다.
function failureBox(key, error) {
  const box = node('div', undefined, 'state state-error');
  const code = error && typeof error.code === 'string' ? error.code : '';
  const message = error && typeof error.message === 'string' && error.message ? safeText(error.message) : '서버 응답 없음';
  const timedOut = TIMEOUT_CODES.includes(code);
  const unverified = code === 'CONTRACT_MISMATCH' || code === 'ENGINE_RESULT_UNVERIFIED';
  box.append(node('p', `${resourceName(key)}을(를) 불러오지 못했습니다${timedOut ? '(시간 초과)' : unverified ? '(확인 불가)' : ''}: ${message}`));
  box.append(node('p', '자동으로 다시 요청하지 않습니다. 다시 시도는 위쪽 다시 불러오기 버튼을 직접 누르세요.'));
  return box;
}

function statusSection(key, title, resource, renderOk) {
  const section = node('section', undefined, `status-resource status-${key}`);
  section.dataset.resource = key;
  section.append(node('h3', title));
  const res = resource && typeof resource === 'object' ? resource : { status: 'unknown' };
  if (res.status !== 'idle') {
    section.append(node('p', modeText(res.mode), `identity-mode identity-mode-${typeof res.mode === 'string' ? res.mode : 'unknown'}`));
  }
  if (res.status === 'loading') section.append(node('p', '불러오는 중…', 'state state-loading'));
  else if (res.status === 'error') section.append(failureBox(key, res.error));
  else if (res.status === 'ok' && res.data != null) renderOk(section, res.data);
  else if (res.status === 'idle') section.append(node('p', '아직 불러오지 않았습니다. 제공 화면의 도움정보 확인 버튼을 눌러야 표시됩니다.', 'state state-empty'));
  else section.append(node('p', `${resourceName(key)} 상태를 확인할 수 없습니다.`, 'state state-error'));
  return section;
}

// 복사할 안전한 값은 여섯 가지뿐입니다.
function diagnosticsFields(data) {
  const d = data && typeof data === 'object' ? data : {};
  const engine = d.engine && typeof d.engine === 'object' ? d.engine : {};
  return [
    ['requestId', safeText(d.requestId)],
    ['component', safeText(d.component)],
    ['version', safeText(d.version)],
    ['checkedAt', safeText(d.checkedAt)],
    ['engine.mode', safeText(engine.mode)],
    ['engine.code', safeText(engine.code)],
  ];
}

// ---- 완성하기 4일차: 화면 다듬기 도우미 ----
// 제공 화면의 CSS(public/style.css)와 화면 보안 규칙(style-src 'self')은 그대로 두고, 학생이 더한 요소에만 style 속성값을 지정합니다.
// style 객체가 없는 환경(모의 DOM)에서는 아무 일도 하지 않습니다.
function look(element, props) {
  if (element && element.style) Object.assign(element.style, props);
  return element;
}

function withFocusRing(element) {
  element.addEventListener('focus', () => look(element, { outline: '3px solid #7c3aed', outlineOffset: '2px' }));
  element.addEventListener('blur', () => look(element, { outline: '' }));
  return element;
}

function actionButton(label) {
  const button = node('button', label);
  button.type = 'button';
  button.setAttribute('aria-label', label);
  look(button, { minHeight: '2.5rem', padding: '0.5rem 1rem', fontSize: '1rem', cursor: 'pointer' });
  return withFocusRing(button);
}

// 실패 이유에 맞는 다음 행동을 알려 줍니다. 읽기 전용 앱이라 설정을 바꾸라고 하지 않습니다.
function nextStep(reason) {
  const text = typeof reason === 'string' ? reason : '';
  if (/서버에 연결하지 못했습니다/.test(text)) return '앱 폴더의 PowerShell에서 npm start 로 서버가 켜져 있는지 확인한 뒤 「다시 조회」를 누르세요.';
  if (/권한/.test(text)) return '관리자 권한이 필요한 항목입니다. 앱은 설정을 바꾸지 않습니다. 필요하면 PC 관리자에게 읽기 권한을 문의한 뒤 「다시 조회」를 누르세요.';
  if (/시간 초과/.test(text)) return '잠시 뒤 「다시 조회」를 눌러 주세요. 계속 오래 걸리면 다른 프로그램을 줄이고 다시 시도하세요.';
  if (/PowerShell/.test(text)) return 'PowerShell 실행이 막혀 있는지 확인하세요. 막혀 있어도 앱은 설정을 바꾸지 않습니다.';
  if (/Windows가 아니/.test(text)) return 'Windows PC에서만 읽을 수 있는 항목입니다.';
  return '「다시 조회」를 눌러 다시 시도하세요. 계속 실패하면 이 화면의 문구를 그대로 복사해 AI에게 보여 주세요.';
}

function serverReason(error) {
  const message = error && typeof error.message === 'string' ? error.message : '';
  if (error instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(message)) return '서버에 연결하지 못했습니다.';
  return safeText(message, '서버 응답 없음');
}

// 오류 화면: 실패한 항목, 이유, 다음에 할 일을 적습니다. 예시 값이나 이전 값으로 대신하지 않습니다.
function failureScreen(title, failures) {
  const box = node('div', undefined, 'state state-error student-failure');
  box.setAttribute('role', 'alert');
  box.append(look(node('strong', title), { fontSize: '1.05rem' }));
  const list = node('ul');
  for (const failure of failures) {
    list.append(node('li', `실패한 항목: ${failure.name} · 이유: ${failure.reason} · 다음에 할 일: ${nextStep(failure.reason)}`));
  }
  box.append(list);
  box.append(node('p', '예시 값이나 이전에 잰 값으로 대신 보여 주지 않았습니다.', 'muted'));
  return look(box, { padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '1rem', lineHeight: '1.6' });
}

// 조회가 끝나면 결과 칸으로 포커스를 옮겨 키보드·화면 읽기 사용자가 결과를 바로 알 수 있게 합니다.
function prepareResultRegion(region) {
  region.tabIndex = -1;
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-busy', 'false');
  return look(withFocusRing(region), { lineHeight: '1.6', fontSize: '1rem' });
}

function focusResult(region) {
  region.setAttribute('aria-busy', 'false');
  if (typeof region.focus === 'function') region.focus();
}

// ---- 완성하기: 관제 대시보드(상태 카드 4개 + 추이) ----
// 값 출처 표시: 예제 모드는 설명용 값, 그 밖에는 이 PC에서 방금 조회한 값입니다. 서버에 저장된 이력이 아닙니다.
const VALUE_MEASURED = '[내 PC에서 잰 값]';
const VALUE_EXAMPLE = '[예시 화면 · 설명용 값]';
const TREND_MAX = 10;
const trend = [];
let lastSeen = { devices: null, sessions: null };

function valueTag(mode) {
  return mode === 'demo' ? VALUE_EXAMPLE : VALUE_MEASURED;
}

function resourceBrief(resource, unit) {
  const res = resource && typeof resource === 'object' ? resource : {};
  if (res.status === 'loading') return '불러오는 중';
  if (res.status === 'error') return '조회 실패';
  if (res.status === 'ok' && Array.isArray(res.data)) return `${res.data.length}${unit}`;
  return '확인 불가';
}

function settled(resource) {
  return resource && typeof resource === 'object' && (resource.status === 'ok' || resource.status === 'error');
}

// 새로 불러온 결과가 나왔을 때만 한 줄 기록합니다(같은 결과를 다시 그릴 때는 늘리지 않습니다).
function recordTrend(devices, sessions) {
  if (!settled(devices) || !settled(sessions)) return;
  if (devices === lastSeen.devices && sessions === lastSeen.sessions) return;
  lastSeen = { devices, sessions };
  const row = { at: new Date(), devices: resourceBrief(devices, '대'), sessions: resourceBrief(sessions, '개') };
  // 같은 불러오기에서 화면이 연달아 다시 그려져도 같은 결과가 같은 초에 두 줄 생기지 않게 합니다.
  const prev = trend[0];
  if (prev && prev.devices === row.devices && prev.sessions === row.sessions && row.at - prev.at < 2000) return;
  trend.unshift(row);
  if (trend.length > TREND_MAX) trend.length = TREND_MAX;
}

function clockText(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

function statusCard(title, value, note, tone) {
  const card = node('div', undefined, `dashboard-card dashboard-card-${tone}`);
  card.append(node('strong', title), look(node('p', value, 'dashboard-card-value'), { fontSize: '1.15rem', fontWeight: '700', margin: '0.25rem 0' }));
  if (note) card.append(node('p', note, 'muted'));
  return look(card, { border: '1px solid rgba(124, 58, 237, 0.35)', borderLeft: `6px solid ${tone === 'ok' ? '#15803d' : '#b45309'}`, borderRadius: '8px', padding: '0.75rem 1rem' });
}

function dashboardView(input) {
  const { devices, sessions, notifications, diagnostics, mode } = input;
  recordTrend(devices, sessions);
  const section = node('section', undefined, 'student-dashboard');
  section.dataset.testid = 'student-dashboard';
  section.append(node('h3', '관제 대시보드'));
  section.append(node('p', `값 출처: ${valueTag(mode)} · ${modeText(mode)}`, 'muted'));

  const diag = diagnostics && diagnostics.status === 'ok' && diagnostics.data && typeof diagnostics.data === 'object' ? diagnostics.data : null;
  const engineCode = diag ? safeText(diag.engine?.code, '코드 없음') : '도움정보 미조회';
  const notifyCount = Array.isArray(notifications) ? notifications.length : null;
  const failed = [devices, sessions].some((r) => r && r.status === 'error');
  const cards = look(node('div', undefined, 'dashboard-cards'), { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' });
  cards.append(
    statusCard('① 연결', labelOf(MODE_LABELS, typeof mode === 'string' ? mode : 'unknown'), `엔진 코드: ${engineCode}`, mode === 'connected' || mode === 'demo' ? 'ok' : 'warn'),
    statusCard('② 기기·세션', `기기 ${resourceBrief(devices, '대')} / 세션 ${resourceBrief(sessions, '개')}`, failed ? '일부 조회 실패' : undefined, failed ? 'warn' : 'ok'),
    statusCard('③ 알림', notifyCount === null ? '확인 불가' : `${notifyCount}건`, notifyCount ? (mode === 'disconnected' ? '연결 실패 알림입니다 · 위험 판정 아님 · Windows 기록 건수와 별개' : '아래 알림 목록을 확인하세요 · Windows 기록 건수와 별개') : undefined, notifyCount ? 'warn' : 'ok'),
    statusCard('④ 마지막 확인', trend.length ? clockText(trend[0].at) : '아직 조회 결과 없음', '이 화면에서 직접 불러온 시각', 'ok'),
  );
  section.append(cards);

  section.append(node('h4', `추이(이번 접속에서 불러온 최근 ${TREND_MAX}번까지)`));
  if (trend.length === 0) {
    section.append(node('p', '아직 불러온 결과가 없습니다.', 'state state-empty'));
  } else {
    const list = node('ul', undefined, 'dashboard-trend');
    for (const row of trend) list.append(node('li', `${clockText(row.at)} · 기기 ${row.devices} · 세션 ${row.sessions}`));
    section.append(list);
  }
  section.append(node('p', '추이는 이 브라우저 화면이 열려 있는 동안만 남습니다. 서버에 저장된 이력이 아닙니다.', 'muted'));
  return section;
}

// ---- 완성하기 2일차: 내 PC의 CPU·메모리·디스크 (서버 GET /api/pc-status, 사용자가 누를 때만 조회) ----
// 제공 기능이 아니라 학생이 추가한 부분입니다. 읽지 못한 값은 0이나 예시 값이 아니라 확인 불가와 이유로 보여 줍니다.
const PC_TREND_MAX = 10;
const pcTrend = [];
let pcState = { status: 'idle' };

function pcNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function pcItem(label, item, format) {
  if (!item || typeof item !== 'object' || item.status !== 'ok') {
    const reason = item && typeof item.reason === 'string' && item.reason ? safeText(item.reason) : '서버가 값을 주지 않았습니다.';
    return { text: `${label}: 확인 불가 · 이유: ${reason}`, value: null, failure: { name: label, reason } };
  }
  const result = format(item);
  return result ?? { text: `${label}: 확인 불가 · 이유: 응답 값이 올바르지 않습니다.`, value: null, failure: { name: label, reason: '응답 값이 올바르지 않습니다.' } };
}

function pcRows(data) {
  const cpu = pcItem('CPU 사용률', data?.cpu, (i) => {
    const v = pcNumber(i.value);
    return v === null ? null : { text: `CPU 사용률: ${v}% (약 ${pcNumber(i.windowMs) ?? '?'}ms 동안 평균)`, value: v };
  });
  const memory = pcItem('메모리 사용량', data?.memory, (i) => {
    const used = pcNumber(i.usedGiB); const total = pcNumber(i.totalGiB); const pct = pcNumber(i.percent);
    return used === null || total === null || pct === null ? null : { text: `메모리 사용량: ${used} GiB / ${total} GiB (${pct}%)`, value: pct };
  });
  const disk = pcItem('디스크 남은 공간', data?.disk, (i) => {
    const free = pcNumber(i.freeGiB); const total = pcNumber(i.totalGiB);
    return free === null || total === null ? null : { text: `디스크 남은 공간: ${free} GiB / ${total} GiB (앱 폴더가 있는 드라이브)`, value: free };
  });
  return { cpu, memory, disk };
}

function pcDelta(now, before, unit) {
  if (now === null || before === null) return '이전 값과 비교 불가';
  const diff = Math.round((now - before) * 10) / 10;
  return diff === 0 ? '이전과 같음' : `이전보다 ${diff > 0 ? '+' : ''}${diff}${unit}`;
}

function pcStatusView() {
  const section = node('section', undefined, 'student-pc-status');
  section.dataset.testid = 'student-pc-status';
  section.append(node('h3', '내 PC 상태(CPU·메모리·디스크)'));
  section.append(node('p', `값 출처: ${VALUE_MEASURED} · 이 앱을 실행 중인 PC의 운영체제에서 일반 권한으로 읽은 값입니다. 예제 모드에서도 예시 값으로 바꾸지 않습니다.`, 'muted'));
  const result = prepareResultRegion(node('div', undefined, 'student-pc-result'));
  const button = actionButton('PC 상태 다시 조회');
  const feedback = node('p', undefined, 'muted');
  feedback.setAttribute('role', 'status');

  function draw() {
    result.replaceChildren();
    if (pcState.status === 'idle') {
      result.append(node('p', '아직 재지 않았습니다. 버튼을 누를 때만 한 번 읽습니다(자동으로 반복하지 않습니다).', 'state state-empty'));
      return;
    }
    if (pcState.status === 'loading') { result.append(node('p', '새로 읽는 중… (CPU는 약 0.5초 걸립니다)', 'state state-loading')); return; }
    if (pcState.status === 'error') {
      result.append(failureScreen('내 PC 상태를 읽지 못했습니다', [{ name: 'PC 상태(CPU·메모리·디스크) 전체', reason: pcState.message }]));
    } else {
      const rows = pcRows(pcState.data);
      const prev = pcTrend[1] ? pcRows(pcTrend[1].data) : null;
      const measuredAt = typeof pcState.data?.measuredAt === 'string' ? formatCheckedAt(pcState.data.measuredAt) : '확인 불가';
      result.append(node('p', `잰 시각: ${measuredAt}`));
      const list = node('ul');
      list.append(
        node('li', `${rows.cpu.text} · ${pcDelta(rows.cpu.value, prev?.cpu.value ?? null, '%p')}`),
        node('li', `${rows.memory.text} · ${pcDelta(rows.memory.value, prev?.memory.value ?? null, '%p')}`),
        node('li', `${rows.disk.text} · ${pcDelta(rows.disk.value, prev?.disk.value ?? null, ' GiB')}`),
      );
      result.append(list);
      const failures = [rows.cpu, rows.memory, rows.disk].filter((row) => row.failure).map((row) => row.failure);
      if (failures.length) result.append(failureScreen('일부 항목을 읽지 못했습니다(읽은 항목은 위에 그대로 표시)', failures));
    }
    if (pcTrend.length) {
      result.append(node('h4', `재 본 기록(이번 접속에서 최근 ${PC_TREND_MAX}번까지)`));
      const history = node('ul');
      for (const row of pcTrend) {
        const r = pcRows(row.data);
        history.append(node('li', `${formatCheckedAt(row.data?.measuredAt)} · CPU ${r.cpu.value === null ? '확인 불가' : `${r.cpu.value}%`} · 메모리 ${r.memory.value === null ? '확인 불가' : `${r.memory.value}%`} · 디스크 남음 ${r.disk.value === null ? '확인 불가' : `${r.disk.value} GiB`}`));
      }
      result.append(history);
    }
  }

  button.addEventListener('click', async () => {
    if (pcState.status === 'loading') return;
    pcState = { status: 'loading' };
    button.disabled = true;
    result.setAttribute('aria-busy', 'true');
    draw();
    try {
      if (typeof fetch !== 'function') throw new Error('이 환경에서는 조회할 수 없습니다.');
      const response = await fetch('/api/pc-status', { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok || !body || body.ok !== true || !body.data || typeof body.data !== 'object') {
        throw new Error(body?.error?.message ?? `서버가 ${response.status}로 응답했습니다.`);
      }
      pcState = { status: 'ok', data: body.data };
      pcTrend.unshift({ data: body.data });
      if (pcTrend.length > PC_TREND_MAX) pcTrend.length = PC_TREND_MAX;
      feedback.textContent = '';
    } catch (error) {
      pcState = { status: 'error', message: serverReason(error) };
    }
    button.disabled = false;
    draw();
    focusResult(result);
  });
  draw();
  section.append(button, feedback, result);
  return look(section, { marginTop: '1rem', padding: '0.75rem 0' });
}

// ---- 완성하기 3일차: 네트워크 연결·방화벽 설정·Windows 기록 건수 (서버 GET /api/pc-connection, 읽기만) ----
// 설정은 바꾸지 않습니다. 기록 건수는 침해·공격 탐지 결과가 아닙니다. SDP 연결 상태는 PC 조회 결과와 따로 보여 줍니다.
let connState = { status: 'idle' };

function connBlock(title, item, renderOk, failures) {
  const block = node('li', undefined, 'student-conn-item');
  block.append(node('strong', title));
  if (!item || typeof item !== 'object' || item.status !== 'ok') {
    const reason = item && typeof item.reason === 'string' && item.reason ? safeText(item.reason) : '서버가 값을 주지 않았습니다.';
    block.append(node('p', `확인 불가 · 이유: ${reason}`, 'state state-error'));
    failures.push({ name: title, reason });
    return block;
  }
  const text = renderOk(item);
  if (text === null) failures.push({ name: title, reason: '응답 값이 올바르지 않습니다.' });
  block.append(node('p', text ?? '확인 불가 · 이유: 응답 값이 올바르지 않습니다.', text === null ? 'state state-error' : undefined));
  return block;
}

function networkText(item) {
  if (!Array.isArray(item.adapters)) return null;
  if (item.adapters.length === 0) return '읽을 수 있는 네트워크 어댑터가 없습니다.';
  return item.adapters.map((a) => `${safeText(a?.name, '이름 없음')} · ${safeText(a?.kind, '종류 확인 불가')} · ${a?.connected === true ? '연결됨' : a?.connected === false ? '연결 안 됨' : '연결 여부 확인 불가'}`).join(' / ');
}

function firewallText(item) {
  if (!Array.isArray(item.profiles)) return null;
  const list = item.profiles.map((p) => `${safeText(p?.name, '이름 없음')}: ${p?.enabled === true ? '켜짐' : p?.enabled === false ? '꺼짐' : '확인 불가'}`).join(' / ');
  return `${list} · 읽기만 함(바꾸지 않음)`;
}

function eventText(log) {
  return (item) => {
    const e = pcNumber(item.error); const w = pcNumber(item.warning); const h = pcNumber(item.hours);
    return e === null || w === null ? null : `${log} 기록: 오류 ${e}건 · 경고 ${w}건 (최근 ${h ?? '?'}시간) · 침해 판정 아님`;
  };
}

function connectionView() {
  const section = node('section', undefined, 'student-pc-connection');
  section.dataset.testid = 'student-pc-connection';
  section.append(node('h3', '연결과 기록(읽기만 함)'));
  section.append(node('p', `값 출처: ${VALUE_MEASURED} · 이 PC의 네트워크 구성, 방화벽 설정, Windows 기록(System·Application)을 읽기만 합니다. 방화벽과 보안 설정은 바꾸지 않습니다.`, 'muted'));
  section.append(node('p', '경고·오류 건수는 시스템이 남긴 기록의 개수일 뿐 침해나 공격을 탐지한 결과가 아닙니다.', 'muted'));
  const result = prepareResultRegion(node('div', undefined, 'student-conn-result'));
  const button = actionButton('연결·기록 다시 조회');

  function draw() {
    result.replaceChildren();
    if (connState.status === 'idle') { result.append(node('p', '아직 읽지 않았습니다. 버튼을 누를 때만 한 번 읽습니다(자동으로 반복하지 않습니다).', 'state state-empty')); return; }
    if (connState.status === 'loading') { result.append(node('p', '새로 읽는 중… (10초 안팎 걸릴 수 있습니다)', 'state state-loading')); return; }
    if (connState.status === 'error') {
      result.append(failureScreen('연결·방화벽·기록을 읽지 못했습니다', [{ name: '연결·방화벽·기록 전체', reason: connState.message }]));
      result.append(node('p', 'PC 조회 실패와 SDP 서버 연결 상태는 서로 다른 내용입니다. SDP 연결 여부는 이 실패로 판단하지 않습니다.', 'muted'));
      return;
    }
    const d = connState.data;
    const measuredAt = typeof d?.measuredAt === 'string' ? formatCheckedAt(d.measuredAt) : '확인 불가';
    result.append(node('p', `읽은 시각: ${measuredAt}`));
    const failures = [];
    const pcList = node('ul');
    pcList.append(
      connBlock('네트워크 연결', d?.network, networkText, failures),
      connBlock('방화벽 설정', d?.firewall, firewallText, failures),
      connBlock('Windows 경고·오류(System)', d?.events?.system, eventText('System'), failures),
      connBlock('Windows 경고·오류(Application)', d?.events?.application, eventText('Application'), failures),
    );
    result.append(node('h4', 'PC 조회 결과(위 네 항목)'), pcList);
    if (failures.length) result.append(failureScreen('일부 항목을 읽지 못했습니다(읽은 항목은 위에 그대로 표시)', failures));
    const sdp = d?.sdp && typeof d.sdp === 'object' ? d.sdp : null;
    const label = sdp && ['SDP 미연결', '예제 자료(SDP 연결 아님)', '확인 불가'].includes(sdp.label) ? sdp.label : '확인 불가';
    const reason = sdp && typeof sdp.reason === 'string' && sdp.reason ? safeText(sdp.reason) : '서버가 SDP 상태를 주지 않았습니다.';
    result.append(node('h4', 'SDP 서버 연결 상태(PC 조회와 별개)'));
    result.append(node('p', `SDP 서버: ${label} · ${reason}`, label === '확인 불가' ? 'state state-error' : undefined));
    result.append(node('p', 'PC 조회가 성공했다는 것은 SDP 서버에 연결됐다는 뜻이 아닙니다.', 'muted'));
  }

  button.addEventListener('click', async () => {
    if (connState.status === 'loading') return;
    connState = { status: 'loading' };
    button.disabled = true;
    result.setAttribute('aria-busy', 'true');
    draw();
    try {
      if (typeof fetch !== 'function') throw new Error('이 환경에서는 조회할 수 없습니다.');
      const response = await fetch('/api/pc-connection', { headers: { accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok || !body || body.ok !== true || !body.data || typeof body.data !== 'object') {
        throw new Error(body?.error?.message ?? `서버가 ${response.status}로 응답했습니다.`);
      }
      connState = { status: 'ok', data: body.data };
    } catch (error) {
      connState = { status: 'error', message: serverReason(error) };
    }
    button.disabled = false;
    draw();
    focusResult(result);
  });
  draw();
  section.append(button, result);
  return look(section, { marginTop: '1rem', padding: '0.75rem 0' });
}

// 핵심 기능 3가지(기록 보기 → 내 PC 상태 → 위험 알림)를 학생 칸 맨 위에 먼저 보여 줍니다.
function jumpTo(target) {
  if (!target) return;
  target.tabIndex = -1;
  if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
  if (typeof target.focus === 'function') target.focus();
}

function coreFeatureStrip(targets) {
  const section = node('section', undefined, 'student-core');
  section.dataset.testid = 'student-core';
  section.setAttribute('aria-label', '핵심 기능 3가지');
  section.append(look(node('h3', '핵심 기능 3가지(먼저 보세요)'), { fontSize: '1.25rem' }));
  const list = look(node('ol'), { paddingLeft: '1.5rem', lineHeight: '1.8', fontSize: '1.05rem' });
  const item1 = node('li', '기록 보기 · 사용 가능 · 왼쪽 메뉴의 「보안 기록」에서 봅니다. 연결이 없으면 조회 실패로 표시됩니다.');
  const item2 = node('li', '내 PC 상태 · 사용 가능 · 값은 아래 「PC 상태 다시 조회」를 눌러야 읽습니다(누르기 전에는 「아직 읽지 않았습니다」). ');
  const go2 = actionButton('내 PC 상태로 이동');
  go2.addEventListener('click', () => jumpTo(targets.pc));
  item2.append(go2);
  const item3 = node('li', '위험 알림 · 아직 안 됨 · 시스템 연결 설정이 있어야 합니다. 지금은 연결 실패 알림만 보입니다. ');
  const go3 = actionButton('알림 목록으로 이동');
  go3.addEventListener('click', () => jumpTo(targets.alerts));
  item3.append(go3);
  list.append(item1, item2, item3);
  section.append(list);
  section.append(node('p', `상태 표시는 점검표(docs/FEATURE_CHECKLIST.md) 기준입니다. 아래 값은 ${VALUE_MEASURED}이고, 안내 화면의 예시는 ${VALUE_EXAMPLE}입니다.`, 'muted'));
  return look(section, { marginBottom: '1rem', padding: '0.75rem 1rem', border: '2px solid rgba(124, 58, 237, 0.5)', borderRadius: '8px' });
}

function renderStatus(input) {
  const { devices, sessions, notifications, diagnostics, mode } = input || {};
  const root = node('div', undefined, 'student-status-view');
  root.dataset.testid = 'student-status-view';
  const targets = {};
  root.append(coreFeatureStrip(targets));
  root.append(dashboardView({ devices, sessions, notifications, diagnostics, mode }));
  targets.pc = pcStatusView();
  root.append(targets.pc);
  root.append(connectionView());
  root.append(node('h3', '연결 상태·알림'));
  root.append(node('p', modeText(mode), `identity-mode identity-mode-${typeof mode === 'string' ? mode : 'unknown'}`));

  root.append(statusSection('devices', '내 기기', devices, (section, data) => {
    if (!Array.isArray(data) || data.length === 0) return section.append(node('p', '등록된 기기가 없습니다.', 'state state-empty'));
    const list = node('ul');
    for (const device of data) list.append(node('li', `${safeText(device?.label, '이름 없음')}(${safeText(device?.id, 'ID 없음')}) · 기기 상태: ${withCode(DEVICE_LABELS, device?.status)}`));
    section.append(list);
    section.append(node('p', '내 이름으로 등록되고 회수되지 않은 기기 최대 100개입니다. 서버가 모르는 값은 확인 불가로 표시됩니다.', 'muted'));
  }));

  root.append(statusSection('sessions', '내 세션', sessions, (section, data) => {
    if (!Array.isArray(data) || data.length === 0) return section.append(node('p', '현재 연결 없음', 'state state-empty'));
    const list = node('ul');
    for (const session of data) list.append(node('li', `${safeText(session?.id, 'ID 없음')} · 세션 상태: ${withCode(SESSION_LABELS, session?.status)}`));
    section.append(list);
  }));
  root.append(node('p', '세션은 현재 검증된 연결 하나만 표시합니다. 지난 세션 목록이 아닙니다.', 'muted'));

  // 알림: 항목마다 어느 자료(resource)인지, 안전한 code, message 를 보여 줍니다.
  const alerts = node('section', undefined, 'status-notifications');
  targets.alerts = alerts;
  alerts.append(node('h3', '알림'));
  if (!Array.isArray(notifications) || notifications.length === 0) {
    alerts.append(node('p', '주의할 알림이 없습니다.', 'state state-empty'));
  } else {
    const list = node('ul');
    for (const item of notifications) {
      const li = node('li', `자료: ${resourceName(item?.resource)} · 코드: ${safeCode(item?.code)} · ${safeText(item?.message, '메시지 없음')}`);
      li.dataset.resource = typeof item?.resource === 'string' ? item.resource : 'unknown';
      list.append(li);
    }
    alerts.append(list);
  }
  root.append(alerts);

  // 도움정보: 제공 화면이 조회한 diagnostics 입력만 읽습니다.
  let copyText = '';
  root.append(statusSection('diagnostics', '도움정보', diagnostics, (section, data) => {
    const fields = diagnosticsFields(data);
    copyText = fields.map(([name, value]) => `${name}: ${value}`).join('\n');
    const list = node('dl');
    for (const [name, value] of fields) list.append(node('dt', name), node('dd', value));
    section.append(list);
  }));

  const help = node('div', undefined, 'status-help');
  const copyButton = node('button', '도움정보 복사');
  copyButton.type = 'button';
  copyButton.setAttribute('aria-label', '도움정보 복사');
  const feedback = node('p', undefined, 'muted');
  feedback.setAttribute('role', 'status');
  const fallback = node('pre');
  fallback.hidden = true;
  if (!copyText) {
    copyButton.disabled = true;
    feedback.textContent = '복사할 도움정보가 없습니다. 도움정보를 먼저 불러와야 합니다.';
  } else {
    feedback.textContent = '위 여섯 항목만 도움 요청용으로 복사합니다. 누를 때만 복사하며 어디에도 전송하지 않습니다.';
  }
  copyButton.addEventListener('click', async () => {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      feedback.textContent = '도움정보를 복사했습니다.';
    } catch {
      fallback.textContent = copyText;
      fallback.hidden = false;
      feedback.textContent = '자동 복사를 사용할 수 없습니다. 아래 내용을 직접 선택해 복사하세요.';
    }
  });
  help.append(copyButton, feedback, fallback);
  root.append(help);
  return root;
}

// ---- 18단계: 근거에 연결된 AI 보안 이벤트 설명 ----
// AI 설명은 참고 정보이며, 이 함수는 조치 요청이나 실행을 만들지 않습니다.
function renderExplanation(input) {
  const value = input && typeof input === 'object' ? input : {};
  const event = value.event && typeof value.event === 'object' ? value.event : null;
  const explanation = value.explanation && typeof value.explanation === 'object' ? value.explanation : {};
  const data = explanation.data && typeof explanation.data === 'object' ? explanation.data : null;
  const root = node('div', undefined, 'student-explanation-view');
  root.dataset.testid = 'student-explanation-view';

  const errorMessage = explanation.error && typeof explanation.error.message === 'string' && explanation.error.message
    ? safeText(explanation.error.message)
    : 'AI 설명 응답을 확인할 수 없습니다.';
  const errorCode = explanation.error && typeof explanation.error.code === 'string'
    ? safeCode(explanation.error.code)
    : '확인 불가';

  if (explanation.status === 'error') {
    root.append(node('h3', 'AI 설명 실패', 'state state-error'));
    root.append(node('p', `오류 코드: ${errorCode}`));
    root.append(node('p', `오류 메시지: ${errorMessage}`, 'state state-error'));
    root.append(node('p', '근거가 부족하거나 설명 응답을 확인할 수 없어 설명을 표시하지 않습니다.'));
    root.append(node('p', 'AI가 이미 실행했다고 답한 설명은 사용할 수 없습니다.', 'muted'));
    root.append(node('p', '기록은 그대로입니다. AI 설명이나 제안만으로 보안 조치가 실행되지는 않습니다.', 'muted'));
    return root;
  }

  if (!event) {
    root.append(node('p', explanation.status === 'loading' ? 'AI 설명 요청 중입니다.' : '보안 기록에서 기록을 먼저 고르세요.', explanation.status === 'loading' ? 'state state-loading' : 'state state-empty'));
    return root;
  }

  if (explanation.status === 'loading') {
    root.append(node('h3', `${safeText(event.id, '사건 ID 확인 불가')} AI 설명`));
    root.append(node('p', 'AI 설명 요청 중입니다.', 'state state-loading'));
    return root;
  }
  if (explanation.status === 'idle' || explanation.status === undefined) {
    root.append(node('h3', `${safeText(event.id, '사건 ID 확인 불가')} AI 설명`));
    root.append(node('p', '이 기록의 AI 설명을 아직 요청하지 않았습니다. 설명은 기록 상세의 요청 버튼으로 직접 요청합니다.', 'state state-empty'));
    return root;
  }

  const evidence = Array.isArray(event.evidence) ? event.evidence : [];
  const evidenceById = new Map(evidence.map((row) => [row?.id, row]));
  const evidenceIds = data && Array.isArray(data.evidenceIds) ? data.evidenceIds : [];
  const hasMatchingEvidence = data
    && Array.isArray(data.evidenceIds)
    && data.evidenceIds.length > 0
    && data.evidenceIds.every((id) => evidenceById.has(id));
  const executed = data && data.executed === true;

  if (explanation.status !== 'ok' || !data || !hasMatchingEvidence || executed) {
    root.append(node('h3', 'AI 설명을 표시할 수 없음', 'state state-error'));
    root.append(node('p', executed
      ? 'AI가 이미 실행했다고 답한 설명은 사용할 수 없습니다.'
      : '이 설명을 쓸 수 없습니다. 설명의 근거 ID가 현재 사건의 근거와 맞지 않거나 응답 자료가 부족합니다.', 'state state-error'));
    root.append(node('p', '근거가 맞지 않으므로 내용을 지어내지 않습니다. 기록은 그대로입니다.', 'muted'));
    return root;
  }

  root.dataset.studentExplanationEvent = String(event.id);
  root.append(node('h3', `${safeText(event.id, '사건 ID 확인 불가')} · AI 설명(참고용)`));
  root.append(node('p', '아래 요약은 참고 정보입니다. 사실 판단은 기록의 근거와 연동 시스템이 알려 준 현재 상태를 기준으로 하세요.', 'muted'));
  root.append(node('p', safeText(data.summary, '요약 없음')));

  const evidenceBlock = node('section', undefined, 'explanation-evidence');
  evidenceBlock.append(node('h4', '인용한 근거'));
  const evidenceList = node('ul');
  for (const id of evidenceIds) {
    const row = evidenceById.get(id);
    evidenceList.append(node('li', `${safeText(id, 'ID 확인 불가')} — ${safeText(row?.text, '근거 글 확인 불가')}`));
  }
  evidenceBlock.append(evidenceList);
  root.append(evidenceBlock);

  const rulesBlock = node('section', undefined, 'explanation-rules');
  rulesBlock.append(node('h4', '규칙'));
  const rules = Array.isArray(event.rules) ? event.rules : [];
  if (rules.length === 0) rulesBlock.append(node('p', '없음'));
  else {
    const ruleList = node('ul');
    for (const rule of rules) ruleList.append(node('li', `${safeText(rule?.id, 'ID 확인 불가')} — ${safeText(rule?.text, '규칙 글 확인 불가')}`));
    rulesBlock.append(ruleList);
  }
  root.append(rulesBlock);

  const statesBlock = node('section', undefined, 'explanation-states');
  statesBlock.append(node('h4', '현재 상태'));
  const state = event.state && typeof event.state === 'object' ? event.state : {};
  const stateLabels = [['access', '접속'], ['session', '세션'], ['device', '기기']];
  const unknownStates = stateLabels.filter(([key]) => state[key] === 'unknown');
  if (unknownStates.length === 0) statesBlock.append(node('p', '없음'));
  else {
    const stateList = node('ul');
    for (const [key, label] of unknownStates) stateList.append(node('li', `${label}: 확인 불가(unknown)`));
    statesBlock.append(stateList);
  }
  root.append(statesBlock);

  const proposalBlock = node('section', undefined, 'explanation-proposals');
  proposalBlock.append(node('h4', '조치 제안'));
  const proposals = Array.isArray(data.proposals) ? data.proposals : [];
  if (proposals.length === 0) {
    const supported = Array.isArray(event.supportedActions) ? event.supportedActions : [];
    proposalBlock.append(node('p', supported.length === 0
      ? '연동 시스템이 지원하는 조치가 없어 제안이 없습니다(정상).'
      : 'AI가 이 기록에 맞는 조치를 제안하지 않았습니다.'));
  } else {
    const proposalList = node('ul');
    for (const proposal of proposals) {
      proposalList.append(node('li', `${safeText(proposal?.action, '조치 확인 불가')} — ${safeText(proposal?.reason, '이유 확인 불가')} · 사람이 확인해야 실행되며 실행되지 않았습니다.`));
    }
    proposalBlock.append(proposalList);
  }
  proposalBlock.append(node('p', 'AI 설명과 제안은 실행되지 않습니다. 실행에는 별도의 사람 확인이 필요합니다.', 'muted'));
  root.append(proposalBlock);
  return root;
}

// ---- 17단계: 앱 내부 AI 연결 상태와 사건 설명 기본 표시 ----
// 연결 점검(모델 목록 응답)과 실제 사건 설명 실행은 다른 일입니다. 점검 결과를 설명 성공처럼 쓰지 않습니다.
// 다시 점검은 사용자가 제공 화면의 버튼을 직접 누르는 것뿐이며, 이 파일은 자동으로 요청하지 않습니다.
// 열쇠·토큰·원문 오류는 화면에 쓰지 않습니다(safeText 가 비밀처럼 보이는 값을 가립니다).
const AUDIENCE_LABELS = { test: '시험 연결 점검(test)', verified: '앱 권한 확인 후 점검(verified)' };

const AI_ERROR_GROUPS = [
  { name: '권한 준비 중', codes: ['ON_AI_PROVISIONING_PENDING'], guide: '학생 앱 이용 권한의 발급·연결이 준비 중이거나 확인되지 않았습니다. 학생 잘못이 아닙니다. 담당자에게 계정 연결과 앱 권한 확인을 요청하세요.' },
  { name: '인증 실패', codes: ['WB_CLCO_AUTH_REQUIRED'], guide: '계정 연결을 다시 확인하세요. 해결되지 않으면 담당자에게 확인을 요청하세요. 다른 열쇠를 복사해 넣지 마세요.' },
  { name: '접근 제한', codes: ['WB_CLCO_ACCESS_BLOCKED', 'ON_AI_AUTHORIZATION_CHANGED', 'SUBJECT_SCOPE_UNVERIFIED'], guide: '이용 권한이나 로그인·프로젝트 연결을 확인할 수 없습니다. 계정 연결을 다시 확인하고 담당자에게 현재 권한을 확인하세요.' },
  { name: '사용량·이용 한도', codes: ['WB_CLCO_COHORT_BUDGET_EXHAUSTED', 'WB_CLCO_LIMIT_REACHED'], guide: '반 사용량 또는 이용 한도에 도달했습니다. 담당자에게 확인하세요.' },
  { name: '이용 시간 아님', codes: ['WB_CLCO_SESSION_CLOSED'], guide: '현재 AI 이용 시간이 아닙니다. 이용 시간을 확인하세요.' },
  { name: '요청 제한', codes: ['WB_CLCO_RATE_LIMITED'], guide: '요청이 잠시 제한됐습니다. 잠시 뒤 직접 다시 점검하세요.' },
  { name: '시간 초과', codes: ['WB_CLCO_TIMEOUT', 'REQUEST_TIMEOUT', 'ENGINE_TIMEOUT', 'TIMEOUT'], guide: '응답 시간이 초과됐습니다. 잠시 뒤 직접 다시 점검하세요.' },
  { name: '네트워크 오류', codes: ['NETWORK_ERROR'], guide: '서버에 연결하지 못했습니다. 잠시 뒤 직접 다시 점검하세요.' },
  { name: '취소됨', codes: ['WB_CLCO_CANCELLED', 'CANCELLED', 'REQUEST_CANCELLED'], guide: '요청이 취소됐습니다. 이전 결과는 현재 결과가 아닙니다.' },
  { name: '쓸 수 있는 모델 없음', codes: ['ON_AI_MODEL_LIST_EMPTY'], guide: '현재 앱 권한으로 쓸 수 있는 모델이 없습니다. 담당자에게 모델 허용 설정 확인을 요청하세요.' },
  { name: '모델 설정 필요', codes: ['MODEL_NOT_CONFIGURED'], guide: '서버에 사용할 모델이 설정되지 않았습니다. 담당자에게 확인을 요청하세요.' },
  { name: '응답 확인 불가', codes: ['ON_AI_INVALID_INPUT', 'ON_AI_INVALID_OUTPUT', 'AI_REQUEST_UNVERIFIED'], guide: 'AI 연결 또는 응답을 확인할 수 없습니다. 기존 기록은 그대로입니다. 성공으로 보지 않습니다.' },
];

function aiErrorGroup(code) {
  return AI_ERROR_GROUPS.find((group) => group.codes.includes(code))
    ?? { name: '확인 불가', codes: [], guide: '원인을 확인할 수 없습니다. 담당자에게 확인을 요청하고, 성공으로 보지 않습니다.' };
}

function aiFailureBox(error) {
  const code = safeCode(error && error.code);
  const group = aiErrorGroup(code);
  const box = node('div', undefined, 'state state-error');
  box.dataset.aiError = group.name;
  box.append(node('p', `오류: ${group.name} · 코드: ${code} · ${safeText(error && error.message, '메시지 없음')}`));
  box.append(node('p', group.guide));
  return box;
}

function renderAiConnection(input) {
  const { status, mode, data, error, checkedAt } = input || {};
  const root = node('div', undefined, 'student-ai-connection-view');
  root.dataset.testid = 'student-ai-connection-view';
  root.append(node('h3', 'AI 연결 점검'));
  root.append(node('p', '워크벤치 수업용 AI(코드 작성), 앱 안의 AI 설명 기능(보안 기록 설명), ALEPH의 공식 과제 판정 AI(제출 코드 확인)는 서로 다른 역할입니다.', 'muted'));

  if (status === 'idle' || status === undefined) {
    // 계정 연결을 다시 하는 등 idle 로 돌아오면 이전 점검 결과는 남기지 않습니다.
    root.append(node('p', 'AI 연결 점검 전', 'state state-empty'));
    root.append(node('p', '점검은 AI 연결 칸의 「현재 API 연결 점검」을 직접 눌러 시작합니다. 자동으로 점검하지 않습니다.', 'muted'));
    return root;
  }
  root.append(node('p', modeText(mode), `identity-mode identity-mode-${typeof mode === 'string' ? mode : 'unknown'}`));

  if (status === 'loading') {
    root.append(node('p', 'AI 연결 점검 중…', 'state state-loading'));
    root.append(node('p', '응답이 오기 전에는 연결됐다고 볼 수 없습니다.', 'muted'));
    return root;
  }
  if (status === 'error') {
    root.append(aiFailureBox(error));
    root.append(node('p', '다시 점검은 사용자가 「현재 API 연결 점검」 버튼을 직접 눌러 합니다. 자동으로 다시 점검하지 않습니다.', 'muted'));
    return root;
  }
  const valid = status === 'ok' && data && typeof data === 'object'
    && Object.hasOwn(AUDIENCE_LABELS, data.audienceAuthorization) && Number.isInteger(data.modelCount);
  if (!valid) {
    root.append(node('p', 'AI 연결 점검 결과를 확인할 수 없습니다. 연결됐다고 볼 수 없습니다.', 'state state-error'));
    return root;
  }
  const result = node('dl');
  result.append(node('dt', '점검 종류'), node('dd', AUDIENCE_LABELS[data.audienceAuthorization]));
  result.append(node('dt', '모델 수(modelCount)'), node('dd', String(data.modelCount)));
  result.append(node('dt', '점검 시각(checkedAt)'), node('dd', formatCheckedAt(checkedAt)));
  root.append(node('p', 'AI 연결 점검 결과: 연결만 점검했습니다.', 'state state-ok'));
  root.append(result);
  // 모델 목록 응답은 사건 설명이 된 것이 아닙니다.
  root.append(node('p', '사건 설명은 아직 실행하지 않았습니다. 사건 설명은 보안 기록에서 따로 요청하고 확인합니다.', 'state state-empty'));
  return root;
}

// ---- 19단계: 보안 조치 요청 상태와 실제 결과 구분 ----
// 조치 제안, 사람 확인, 서버 접수(ACK), 연동 시스템의 효과 관측은 서로 다른 단계입니다.
// 이 함수는 버튼·요청·확인 번호를 만들지 않으며, 입력에 있는 값 가운데 아래 allowlist 만 글자로 표시합니다.
// 확인 번호(confirmationId)와 같은 값은 읽지도 저장하지도 않습니다. 실제 조작은 제공 화면의 버튼을 씁니다.
const ACTION_STATUS_TEXT = {
  idle: ['아직 미실행(idle)', '조치 제안은 아직 실행되지 않았습니다.'],
  loading: ['조치 준비 또는 결과 조회 중(loading)', '연동 시스템의 응답을 기다리는 중이며 결과가 아직 확인되지 않았습니다.'],
  prepared: ['준비됨·미실행(prepared)', '조치는 준비만 되었고 실행되지 않았습니다. 아래 대상과 확인 기한을 사람이 확인한 뒤 제공 화면의 「대상과 조치를 확인했으며 집행합니다」 버튼을 직접 누르는 경우에만 전달됩니다.'],
  executing: ['서버에 전달 중(executing)', '사람이 확인한 조치를 서버에 전달하는 중입니다. 결과가 아직 확인되지 않았습니다.'],
  pending: ['서버 접수·처리 중(pending)', '서버가 요청을 받았다는 응답(ACK)입니다. ACK는 효과가 확인된 것이 아니며, 결과가 아직 확인되지 않았습니다. 제공 화면의 「원천 결과만 재조회」로 결과를 다시 조회하세요.'],
  denied: ['연동 시스템 거절(denied)', '연동 시스템이 이 조치를 거절했습니다. 효과가 적용되지 않았습니다.'],
  failed: ['실패(failed)', '연동 시스템에서 조치 처리에 실패했습니다.'],
  unknown: ['결과 불명(unknown)', '효과가 적용되었다고도 적용되지 않았다고도 판단하지 마세요. 제공 화면의 「원천 결과만 재조회」로 결과만 다시 조회하세요.'],
  expired: ['확인 기한 지남(expired)', '사람 확인 기한이 지나 전달되지 않았습니다. 필요하면 조치를 다시 준비하세요.'],
  error: ['요청 처리 안 됨(error)', '요청이 처리되지 않았습니다. 조치 효과가 적용되었다고 볼 수 없습니다.'],
};
// 서버에 이미 전달된 조치의 효과는 화면을 취소해도 되돌아가지 않습니다.
const ACTION_CANCEL_NOTE = '「조치 화면 취소」는 화면의 진행을 멈출 뿐, 이미 서버에 전달된 조치의 효과를 되돌리지 않습니다.';

function actionIdText(value, fallback) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/u.test(value) ? value : fallback;
}

function renderAction(input) {
  const value = input && typeof input === 'object' ? input : {};
  const root = node('div', undefined, 'student-action-view');
  root.dataset.testid = 'student-action-view';
  root.append(node('h3', '보안 조치 요청 상태'));
  root.append(node('p', '조치 제안, 사람 확인, 서버 접수(ACK), 연동 시스템의 효과 관측은 서로 다른 단계입니다. 화면의 문구가 아니라 아래 관측 값으로 판단하세요.', 'muted'));

  const event = value.event && typeof value.event === 'object' ? value.event : null;
  const eventId = event ? actionIdText(event.id, null) : null;
  const actionId = actionIdText(value.actionId, null);
  const target = value.target && typeof value.target === 'object' ? value.target : null;
  const receipt = value.receipt && typeof value.receipt === 'object' ? value.receipt : null;
  const observation = value.observation && typeof value.observation === 'object' ? value.observation : null;
  const rawStatus = typeof value.status === 'string' ? value.status : '';
  const known = Object.hasOwn(ACTION_STATUS_TEXT, rawStatus);

  // 현재 사건·조치와 응답이 같은 대상인지 확인합니다. 어긋나면 응답을 표시하지 않고 결과 불명으로 둡니다.
  const mismatched = receipt && ((typeof receipt.eventId === 'string' && eventId !== null && receipt.eventId !== eventId)
    || (typeof receipt.actionId === 'string' && actionId !== null && receipt.actionId !== actionId));

  // succeeded 는 연동 시스템이 효과를 관측했을 때(observation.effectApplied === true)만 효과 확인입니다.
  const effectConfirmed = rawStatus === 'succeeded' && observation && observation.effectApplied === true
    && typeof observation.observedAt === 'string' && observation.observedAt.length > 0;

  let headline;
  let guide;
  let tone;
  if (mismatched) {
    headline = '결과 불명(unknown)';
    guide = '받은 응답의 사건 또는 조치가 현재 화면의 사건·조치와 맞지 않아 표시하지 않습니다. 효과가 적용되었다고도 적용되지 않았다고도 판단하지 말고 결과만 다시 조회하세요.';
    tone = 'state state-error';
  } else if (rawStatus === 'succeeded') {
    if (effectConfirmed) {
      headline = '효과 확인(succeeded)';
      guide = '연동 시스템이 조치 효과를 관측했습니다. 아래 관측 시각과 영수증 ID로 확인하세요.';
      tone = 'state state-ok';
    } else {
      headline = '결과 불명(succeeded이지만 효과 관측 없음)';
      guide = 'succeeded 상태에는 연동 시스템의 효과 관측(observation.effectApplied: true)이 함께 와야 합니다. 관측이 없으므로 효과 확인으로 표시하지 않으며, 성공으로도 효과 없음으로도 판단하지 마세요. 결과만 다시 조회하세요.';
      tone = 'state state-error';
    }
  } else if (known) {
    [headline, guide] = ACTION_STATUS_TEXT[rawStatus];
    tone = ['denied', 'failed', 'error', 'unknown', 'expired'].includes(rawStatus) ? 'state state-error' : 'state state-empty';
  } else {
    headline = `결과 불명(unknown) — 알 수 없는 상태 값: ${safeCode(rawStatus)}`;
    guide = '정의되지 않은 상태 값은 성공이나 효과 없음으로 보지 않습니다. 결과만 다시 조회하세요.';
    tone = 'state state-error';
  }
  root.append(node('p', headline, tone));
  root.append(node('p', guide));

  if (rawStatus === 'idle' && (!event || (Array.isArray(event.supportedActions) && event.supportedActions.length === 0))) {
    root.append(node('p', '지금 기록에는 연동 시스템이 지원하는 조치가 없어 「조치 준비」 버튼이 나오지 않는 것이 정상입니다.', 'muted'));
  }

  // 현재 사건·근거·조치·대상·요청·영수증 값은 받은 범위에서만 글자로 표시합니다.
  if (!mismatched) {
    const details = node('dl');
    const add = (label, text) => { details.append(node('dt', label), node('dd', text)); };
    if (eventId !== null) add('사건 ID(event.id)', eventId);
    const evidenceIds = event && Array.isArray(event.evidence)
      ? event.evidence.map((row) => actionIdText(row && row.id, null)).filter((id) => id !== null)
      : [];
    if (evidenceIds.length > 0) add('근거 ID(event.evidence)', evidenceIds.join(', '));
    if (actionId !== null) add('조치(actionId)', actionId);
    if (target) {
      const targetId = actionIdText(target.id, null);
      if (targetId !== null) add('실제 대상(target.id)', targetId);
      if (Number.isSafeInteger(target.generation)) add('대상 세대(target.generation)', String(target.generation));
    }
    if (receipt) {
      const requestId = actionIdText(receipt.requestId, null);
      const receiptId = actionIdText(receipt.receiptId, null);
      if (requestId !== null) add('요청 ID(receipt.requestId)', requestId);
      if (receiptId !== null) add('영수증 ID(receipt.receiptId)', receiptId);
      if (Number.isSafeInteger(receipt.version)) add('버전(receipt.version)', String(receipt.version));
    }
    if (rawStatus === 'prepared' && typeof value.confirmationExpiresAt === 'string') {
      add('확인 기한(confirmationExpiresAt)', safeText(value.confirmationExpiresAt));
    }
    if (effectConfirmed) {
      add('관측 시각(observation.observedAt)', safeText(observation.observedAt));
      add('효과 관측(observation.effectApplied)', 'effectApplied: true');
    }
    if (details.children.length > 0) root.append(details);
  }

  if ((rawStatus === 'denied' || rawStatus === 'failed') && typeof value.message === 'string' && value.message) {
    root.append(node('p', `메시지: ${safeText(value.message)}`, 'state state-error'));
  }
  if (rawStatus === 'error' && value.error && typeof value.error === 'object') {
    root.append(node('p', `오류 코드: ${safeCode(value.error.code)} · 메시지: ${safeText(value.error.message, '메시지 없음')}`, 'state state-error'));
  }
  if (['executing', 'pending', 'unknown', 'loading'].includes(rawStatus) || mismatched) root.append(node('p', ACTION_CANCEL_NOTE, 'muted'));

  // 성공적으로 그린 조치 표시에만 사건·요청 표식을 붙입니다. 접수(ACK)만 있는 경우와 불명·실패 화면에도 같은 표식이 필요한지는
  // 공식 안내에 따라 현재 사건과 요청이 있는 정상 표시(prepared·executing·pending·효과 확인·denied·failed)에 한합니다.
  const requestId = receipt ? actionIdText(receipt.requestId, null) : null;
  const marked = !mismatched && eventId !== null && requestId !== null
    && (effectConfirmed || ['prepared', 'executing', 'pending', 'denied', 'failed'].includes(rawStatus));
  if (marked) {
    root.dataset.studentActionEvent = eventId;
    root.dataset.studentActionRequest = requestId;
  }
  return root;
}

// ---- 20단계: 설치 패키지 버전과 알려진 취약점 조회 결과 ----
// package-lock.json 에 기록된 정확한 설치 버전과 OSV 조회 결과를 보여 줍니다. 이 함수는 조회 요청을 만들지 않으며
// 제공 화면이 전달한 값만 글자로 표시합니다. 조회 실패·미조회는 「취약점 없음」이 아니고, 조회 결과가 없다는 사실만으로
// 패키지나 앱이 안전하다고 보장할 수 없습니다. 오류·조회 중에는 이전 표를 현재 결과처럼 남기지 않습니다.
const VULN_SCAN_TEXT = {
  complete: ['모두 조회(complete)', '전달된 모든 패키지의 조회가 끝났습니다. 조회 시점에 OSV가 알고 있는 범위의 결과입니다.'],
  partial: ['일부 조회 실패(partial)', '일부 패키지는 조회하지 못했습니다. 조회하지 못한 패키지는 취약점이 없다는 뜻이 아닙니다. 이미 받은 취약점 ID는 그대로 표시합니다.'],
  not_checked: ['아직 조회 안 함(not_checked)', '승인된 공개 조회 대상이 없는 등 조회하지 않은 상태입니다. 취약점이 없다는 뜻이 아닙니다.'],
  not_configured: ['조회 준비 미완료(not_configured)', '조회 대상 프로젝트 설정이 필요합니다. 설정과 허용 패키지는 운영자가 준비하며 학생이 바꾸지 않습니다. 취약점이 없다는 뜻이 아닙니다.'],
  unverifiable: ['lock 파일 확인 불가(unverifiable)', 'package-lock.json 을 확인할 수 없어 설치 버전을 알 수 없습니다. 취약점이 없다는 뜻이 아닙니다.'],
};
const VULN_PACKAGE_STATUSES = ['known_vulnerabilities', 'none_found', 'unverifiable'];
// 설치된 정확한 버전만 허용합니다. ^1.2.0·~1.2.0·>=1.0.0·* 같은 범위는 설치 버전이 아닙니다.
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;
const FINDING_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;

function packageStatusText(pkg) {
  if (pkg.status === 'unverifiable' && pkg.vulnerabilities.length > 0) return '일부 확인·전체 조회 확인 불가(unverifiable) — 받은 취약점 ID는 아래에 유지합니다.';
  if (pkg.status === 'unverifiable') return '조회 확인 불가(unverifiable) — 취약점이 없다는 뜻이 아닙니다.';
  if (pkg.status === 'known_vulnerabilities') return '알려진 항목 있음(known_vulnerabilities)';
  return '알려진 항목 없음(none_found) — 조회 범위에서 알려진 항목이 없다는 뜻이며 안전을 보장하지 않습니다.';
}

// 표시하기 전에 형식을 확인합니다. 하나라도 어긋나면 표를 만들지 않고 조회 결과 확인 불가로 표시합니다.
function checkedPackages(data) {
  if (!Array.isArray(data.packages)) return null;
  const rows = [];
  for (const pkg of data.packages) {
    if (!pkg || typeof pkg !== 'object') return null;
    if (typeof pkg.name !== 'string' || !PACKAGE_NAME.test(pkg.name)) return null;
    if (typeof pkg.version !== 'string' || !EXACT_VERSION.test(pkg.version)) return null;
    if (!VULN_PACKAGE_STATUSES.includes(pkg.status) || !Array.isArray(pkg.vulnerabilities)) return null;
    const findings = [];
    for (const finding of pkg.vulnerabilities) {
      if (!finding || typeof finding !== 'object' || typeof finding.id !== 'string' || !FINDING_ID.test(finding.id)) return null;
      findings.push({ id: finding.id, modified: typeof finding.modified === 'string' ? finding.modified : null });
    }
    if (pkg.status === 'known_vulnerabilities' && findings.length === 0) return null;
    if (pkg.status === 'none_found' && findings.length > 0) return null;
    rows.push({ name: pkg.name, version: pkg.version, status: pkg.status, vulnerabilities: findings, source: pkg.source, checkedAt: pkg.checkedAt });
  }
  return rows;
}

function renderVulnerabilities(input) {
  const { status, mode, data, error } = input || {};
  const root = node('div', undefined, 'student-vulnerabilities-view');
  root.dataset.testid = 'student-vulnerabilities-view';
  root.append(node('h3', '설치 패키지 취약점 조회(OSV)'));
  root.append(node('p', 'OSV는 알려진 취약점 데이터베이스입니다. 조회 결과가 없다는 사실만으로 해당 패키지나 앱 전체가 안전하다고 보장할 수 없습니다. 회사·비공개 패키지 이름은 밖으로 보내 확인하지 않습니다.', 'muted'));

  if (status === 'idle' || status === undefined) {
    root.append(node('p', '조회 전', 'state state-empty'));
    root.append(node('p', '조회는 보호 현황의 설치 패키지 조회 버튼을 사용자가 직접 눌러 시작합니다. 자동으로 조회하지 않습니다.', 'muted'));
    return root;
  }
  root.append(node('p', modeText(mode), `identity-mode identity-mode-${typeof mode === 'string' ? mode : 'unknown'}`));
  if (status === 'loading') {
    root.append(node('p', '조회 중', 'state state-loading'));
    root.append(node('p', '조회가 끝나기 전에는 결과가 없습니다. 이전 조회의 표는 현재 결과가 아니므로 표시하지 않습니다.', 'muted'));
    return root;
  }
  if (status === 'error') {
    const message = error && typeof error.message === 'string' && error.message ? safeText(error.message) : '응답을 확인할 수 없습니다.';
    root.append(node('p', `조회 실패: ${message}`, 'state state-error'));
    if (error && typeof error.code === 'string') root.append(node('p', `오류 코드: ${safeCode(error.code)}`));
    root.append(node('p', '조회 실패는 취약점이 없다는 뜻이 아닙니다. 이전 표는 현재 결과가 아니므로 표시하지 않습니다. 다시 조회는 사용자가 보호 현황의 설치 패키지 조회 버튼을 직접 눌러 합니다.', 'muted'));
    return root;
  }

  const known = status === 'ok' && data && typeof data === 'object' && Object.hasOwn(VULN_SCAN_TEXT, data.status);
  const rows = known ? checkedPackages(data) : null;
  if (!known || rows === null) {
    root.append(node('p', '조회 결과를 확인할 수 없습니다. 형식이 맞지 않는 응답은 표시하지 않으며, 취약점이 없다는 뜻이 아닙니다.', 'state state-error'));
    return root;
  }

  const [label, meaning] = VULN_SCAN_TEXT[data.status];
  const stateClass = data.status === 'complete' ? 'state state-ok' : data.status === 'partial' || data.status === 'unverifiable' ? 'state state-error' : 'state state-empty';
  root.dataset.studentVulnerabilityScan = data.status;
  root.append(node('p', `조회 상태: ${label}`, stateClass));
  root.append(node('p', meaning));

  // 전달된 경우에만 표시합니다.
  const summary = node('dl');
  if (data.lockfileVersion !== undefined && data.lockfileVersion !== null) summary.append(node('dt', '잠금 파일 버전(lockfileVersion)'), node('dd', safeText(String(data.lockfileVersion))));
  if (typeof data.lockfileHash === 'string' && data.lockfileHash) summary.append(node('dt', '잠금 파일 해시(lockfileHash)'), node('dd', safeText(data.lockfileHash)));
  if (typeof data.checkedAt === 'string' && data.checkedAt) summary.append(node('dt', '조회 시각(checkedAt)'), node('dd', safeText(data.checkedAt)));
  if (summary.children.length > 0) root.append(summary);

  if (rows.length === 0) {
    root.append(node('p', data.status === 'complete' ? '표시할 패키지 조회 결과가 없습니다.' : '표시할 패키지 조회 결과가 없습니다. 위 조회 상태를 확인하세요.', 'state state-empty'));
    return root;
  }

  const table = node('table');
  const head = node('tr');
  for (const column of ['패키지(name)', '설치 버전(version)', '조회 상태(status)', '취약점 ID·수정 시각(id·modified)', '출처(source)', '패키지 조회 시각(checkedAt)']) head.append(node('th', column));
  const thead = node('thead');
  thead.append(head);
  const tbody = node('tbody');
  for (const pkg of rows) {
    const row = node('tr');
    row.dataset.studentPackageName = pkg.name;
    row.dataset.studentPackageVersion = pkg.version;
    const findings = node('td');
    if (pkg.vulnerabilities.length === 0) findings.textContent = '없음';
    else {
      const list = node('ul');
      for (const finding of pkg.vulnerabilities) list.append(node('li', `${finding.id} · 수정 시각: ${finding.modified ? safeText(finding.modified) : '확인 불가'}`));
      findings.append(list);
    }
    row.append(node('td', pkg.name), node('td', pkg.version), node('td', packageStatusText(pkg)), findings,
      node('td', safeText(pkg.source, '확인 불가')), node('td', safeText(pkg.checkedAt, '확인 불가')));
    tbody.append(row);
  }
  table.append(thead, tbody);
  root.append(table);
  return root;
}

export function createStudentView() {
  return {
    renderIdentity(input) { return renderIdentity(input); },
    renderDecision(input) { return renderDecision(input); },
    renderEvents(input) { return renderEvents(input); },
    renderStatus(input) { return renderStatus(input); },
    renderVulnerabilities(input) { return renderVulnerabilities(input); },
    renderAiConnection(input) { return renderAiConnection(input); },
    renderExplanation(input) { return renderExplanation(input); },
    renderAction(input) { return renderAction(input); },
  };
}
