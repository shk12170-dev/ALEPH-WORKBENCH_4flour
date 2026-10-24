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
    count.textContent = `${shown.length}건 표시 / 전체 ${events.length}건`;
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

function renderStatus(input) {
  const { devices, sessions, notifications, diagnostics, mode } = input || {};
  const root = node('div', undefined, 'student-status-view');
  root.dataset.testid = 'student-status-view';
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

export function createStudentView() {
  return {
    renderIdentity(input) { return renderIdentity(input); },
    renderDecision(input) { return renderDecision(input); },
    renderEvents(input) { return renderEvents(input); },
    renderStatus(input) { return renderStatus(input); },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection(input) { return renderAiConnection(input); },
    renderExplanation(input) { return renderExplanation(input); },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
