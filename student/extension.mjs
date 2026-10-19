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
  const line = node('span', `${label}: ${table[known]}`, `identity-status identity-status-${known}`);
  line.dataset.status = known;
  if (known !== okValue) line.textContent = `주의 · ${label}: ${table[known]}`;
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

export function createStudentView() {
  return {
    renderIdentity(input) { return renderIdentity(input); },
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderStatus() { return '학생 구현 대기: 기기·세션·알림과 연결 점검 상태를 구분하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
