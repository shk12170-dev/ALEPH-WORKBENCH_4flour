// 제작 3: 몰래 심어진 프로그램(지속성) 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/persistence/patterns.json(근거: MITRE ATT&CK T1543·T1053·T1547.001)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 지속 수단 + 의심 요인 둘 이상 + 경보 수준 10 이상을 함께 만족할 때만 내립니다.
// 서비스·예약 작업·시작 폴더라는 말, 서명 미확인, 수업 도구 이름, 수준, 주소, 경보 번호·순서 하나만으로는 막지 않습니다.
// 파일 경로는 문자열로만 검사하며 실행하지 않고, 이유에도 경로·계정을 남기지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: "unsigned-new-service",
    name: "서명 없는 새 서비스 등록·교체",
    technique: "T1543.003",
    condition: "서비스 등록이나 서비스 실행 파일 교체가 있고, 서명 없음·임시 폴더 실행 파일·평소 목록에 없음·다시 켜도 남도록 등록·원격 주소에서 연속 등록 가운데 둘 이상이 함께 보이며 경보 수준 10 이상일 때 차단 후보. 서비스 설명만 바뀌었거나 서명을 확인하지 못한 경우는 알림.",
    evidence: "T1543.003 Windows Service: 공격자는 부팅할 때마다 다시 실행되도록 새 서비스를 만들거나 기존 서비스의 실행 파일을 바꿔 지속성을 확보한다(SUNBURST 사건에서도 서비스로 도는 추가 악성코드가 쓰였다).",
  }),
  Object.freeze({
    id: "unfamiliar-scheduled-task",
    name: "낯선 예약 작업 생성",
    technique: "T1053.005",
    condition: "예약 작업 생성이 있고, 처음 보는 작업·임의 문자열 이름·임시 폴더 프로그램·수업 시간 밖 실행·서명 없음 가운데 둘 이상이 함께 보이며 경보 수준 10 이상일 때 차단 후보. 수업 중 만든 작업 하나나 수업 과제와 비슷한 이름은 알림.",
    evidence: "T1053.005 Scheduled Task: 공격자는 예약 작업으로 악성 프로그램이 일정에 따라 계속 실행되게 하며, 임시 폴더의 프로그램이나 무작위 이름이 흔한 흔적이다(SUNBURST 사건에서도 예약 작업을 잠깐 바꿨다 되돌렸다).",
  }),
  Object.freeze({
    id: "startup-folder-change",
    name: "시작 폴더·시작 프로그램 변경",
    technique: "T1547.001",
    condition: "시작 폴더나 시작 프로그램에 평소 목록에 없는 항목이 추가되고, 임시 폴더 실행 파일·서명 없음·같은 파일을 가리키는 예약 작업 가운데 하나 이상이 함께 보이며 경보 수준 10 이상일 때 차단 후보. 변경이 한 건이고 이어서 실행된 기록이 없으면 알림.",
    evidence: "T1547.001 Registry Run Keys / Startup Folder: 시작 폴더에 프로그램을 두면 사용자가 로그온할 때마다 실행되어, 다시 켜도 살아남게 하는 대표적인 지속 수단이다.",
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. 보편 임계값이 아닙니다.
const STRONG_LEVEL = 10;
const NOTABLE_LEVEL = 5;
const MIN_FACTORS = 2;
const REPEAT_MIN = 3;
const MAX_FIELD_LENGTH = 1024;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));
const ALL_NAMES = `패턴 ${PATTERNS.map(pattern => pattern.id).join('·')}`;
const round = value => Math.round(value * 100) / 100;

// 의심 요인(서로 다른 종류만 한 번씩 셉니다).
const FACTORS = Object.freeze([
  Object.freeze({ id: '서명 없음', test: s => /서명\s*(이\s*)?없/u.test(s.text) }),
  Object.freeze({ id: '임시 폴더 실행 파일', test: s => /\\appdata\\local\\temp\\|\\windows\\temp\\|\\temp\\/u.test(s.path) || /임시\s*폴더/u.test(s.text) }),
  Object.freeze({ id: '평소 목록에 없음', test: s => /평소\s*목록에\s*없|처음\s*보는|낯선|새\s*(서비스|예약|항목)|새로\s*(생겼|등록)|추가됐/u.test(s.text) }),
  Object.freeze({ id: '수업 시간 밖 실행', test: s => /수업\s*시간\s*밖|시간\s*밖|야간|새벽/u.test(s.text) }),
  Object.freeze({ id: '임의 문자열 이름', test: s => /임의\s*문자열|무작위/u.test(s.text) }),
  Object.freeze({ id: '다시 켜도 남도록 등록', test: s => /다시\s*켜도\s*남|재부팅\s*후에도|부팅\s*(때|시)\s*(마다\s*)?자동/u.test(s.text) }),
  Object.freeze({ id: '실행 파일 교체', test: s => /실행\s*파일이\s*바뀌|실행\s*파일을\s*교체/u.test(s.text) }),
  Object.freeze({ id: '원격 주소 연속 등록', test: s => /원격\s*주소/u.test(s.text) || s.count >= REPEAT_MIN }),
  Object.freeze({ id: '두 수단이 같은 파일 지정', test: s => s.mechanisms.length >= 2 }),
  Object.freeze({ id: '시작 폴더 경로의 새 파일', test: s => /\\start menu\\programs\\startup\\|\\startup\\/u.test(s.path) && /추가됐|새로|평소\s*목록에\s*없/u.test(s.text) }),
]);

// 설명 문장 가운데 "…은 없습니다"처럼 해당 수단이나 행동이 없다고 말하는 문장은 근거에서 뺍니다.
function positiveText(description) {
  return description.split('.').filter(sentence => !/(등록|기록|변경|표기|구문)은\s*없습니다|아닙니다/u.test(sentence)).join('.');
}

function readSignals(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;
  const text = positiveText(description);
  const path = typeof data.path === 'string' ? data.path.slice(0, MAX_FIELD_LENGTH).toLowerCase().replace(/\//gu, '\\') : '';
  let count = Number.parseInt(String(data.count ?? ''), 10);
  if (!Number.isFinite(count) || count < 0) count = 0;

  const mechanisms = [];
  if (/서비스/u.test(text)) mechanisms.push('service');
  if (/예약\s*작업/u.test(text)) mechanisms.push('task');
  if (/시작\s*(폴더|프로그램|항목)/u.test(text) || /\\startup\\/u.test(path)) mechanisms.push('startup');
  const factors = FACTORS.filter(factor => factor.test({ text, path, count, mechanisms })).map(factor => factor.id);
  return { level, mechanisms, factors };
}

// 지속 수단에서 가장 가까운 패턴을 고릅니다(여러 수단이면 서비스, 예약 작업, 시작 폴더 순).
function patternFor(mechanisms) {
  if (mechanisms.includes('service')) return byId['unsigned-new-service'];
  if (mechanisms.includes('task')) return byId['unfamiliar-scheduled-task'];
  if (mechanisms.includes('startup')) return byId['startup-folder-change'];
  return null;
}

// 구조는 확인되지 않았지만 단어가 닮았을 때 이유 문구에 가장 가까운 패턴 이름을 적기 위한 약한 신호(차단 근거 아님)입니다.
const WEAK_HINTS = Object.freeze({
  'unsigned-new-service': /서비스|service|서명/iu,
  'unfamiliar-scheduled-task': /예약|작업|task/iu,
  'startup-folder-change': /시작|startup|임시\s*폴더|실행\s*파일/iu,
});

function weakHint(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const text = positiveText(description);
  return PATTERNS.find(pattern => WEAK_HINTS[pattern.id].test(text)) ?? null;
}

function actionFor(confidence) {
  if (confidence >= BLOCK_AT) return 'block';
  if (confidence >= ALERT_AT) return 'alert';
  return 'record';
}

export function decide(alert) {
  if (!alert || typeof alert !== 'object' || Array.isArray(alert)) {
    return { action: 'record', confidence: 0, reason: '경보 형식이 아니라 기록만 남김' };
  }
  const { level, mechanisms, factors } = readSignals(alert);
  const main = patternFor(mechanisms);
  const evidence = `수단 ${mechanisms.length}개, 의심 요인 ${factors.length}개(${factors.join('·') || '없음'}), 수준 ${level}`;

  if (main && factors.length >= MIN_FACTORS) {
    // 지속 수단 + 의심 요인 둘 이상. 경보 수준이 높을 때만 차단 수준입니다.
    let confidence = 0.7;
    if (level >= STRONG_LEVEL) {
      confidence = 0.88 + 0.03 * Math.min(3, factors.length - MIN_FACTORS) + (level >= 12 ? 0.01 : 0);
    }
    confidence = round(Math.min(0.97, confidence));
    return { action: actionFor(confidence), confidence, reason: `${main.name} [${main.id}, ${main.technique}]: ${evidence}` };
  }

  // 지속 수단이나 의심 요인이 하나뿐이면 알림만 남깁니다(경보 수준이 눈여겨볼 만할 때).
  if ((main || factors.length) && level >= NOTABLE_LEVEL) {
    const pattern = main ?? weakHint(alert) ?? byId['unsigned-new-service'];
    const confidence = factors.length ? 0.6 : 0.55;
    return { action: 'alert', confidence, reason: `${pattern.name} [${pattern.id}, ${pattern.technique}] 단서가 하나뿐이라 알림만 남김: ${evidence}` };
  }

  if (level >= NOTABLE_LEVEL) {
    const hint = weakHint(alert);
    const reason = hint
      ? `${hint.name} [${hint.id}, ${hint.technique}] 의심 신호뿐(지속 수단·요인 부족)이라 알림만 남김: ${evidence}`
      : `${ALL_NAMES} 어느 구조도 확인되지 않은 경보라 알림만 남김: ${evidence}`;
    return { action: 'alert', confidence: 0.55, reason };
  }
  return { action: 'record', confidence: 0.1, reason: `${ALL_NAMES} 어느 패턴과도 맞지 않아 기록만 남김: ${evidence}` };
}
