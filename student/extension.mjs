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

export function createStudentView() {
  return {
    renderIdentity(input) { return renderIdentity(input); },
    renderDecision(input) { return renderDecision(input); },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
