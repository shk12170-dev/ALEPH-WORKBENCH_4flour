// 제작 3: 권한 가로채기(권한 상승) 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/privilege/patterns.json(근거: MITRE ATT&CK T1068·T1078)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 권한 상승 근거 둘 이상(사건과 정황 합쳐 서로 다른 종류) + 경보 수준 10 이상을 함께 만족할 때만 내립니다.
// 관리자라는 단어, 관리 계정의 정상 로그인, 일반 그룹 추가, 수준, 주소, 계정 이름, 경보 번호·순서 하나만으로는 막지 않습니다.
// 계정 이름은 판단에 쓰지 않고 이유에도 남기지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: "admin-group-addition",
    name: "평범한 계정의 관리자 그룹 추가",
    technique: "T1078",
    condition: "계정이 관리자 그룹에 추가되거나 다시 들어오고, 원격·처음 보는 주소·여러 계정 연속 추가·곧바로 이어진 명령 실행·수업 시간 밖 가운데 하나 이상이 함께 보이며 경보 수준 10 이상일 때 차단 후보. 관리자 그룹이 아닌 일반 그룹 추가나 수업 그룹 설명 변경은 알림.",
    evidence: "T1078 Valid Accounts: 공격자는 탈취한 정상 계정을 관리자 그룹에 넣어 높은 권한을 얻고 유지하며, 평범한 계정이 갑자기 관리자 그룹에 들어가는 것이 대표 흔적이다.",
  }),
  Object.freeze({
    id: "unfamiliar-admin-command",
    name: "처음 보는 관리자 명령 실행·권한 상승",
    technique: "T1068",
    condition: "관리자 명령 실행, 세션이 관리자 권한으로 바뀜, 다른 계정의 권한으로 명령 실행이 있고, 방금 관리자가 됨·처음 보는 주소·수업 시간 밖·그룹 추가 가운데 하나 이상이 함께 보이며 경보 수준 10 이상일 때 차단 후보. 평소 주소의 명령 한 번, 실패 한 건, 취소된 권한 상승 창은 알림.",
    evidence: "T1068 Exploitation for Privilege Escalation: 공격자는 권한 상승으로 평범한 계정에서 관리자 명령을 실행하며, 방금 상승한 세션의 명령 실행이 이어지는 것이 대표 흔적이다.",
  }),
  Object.freeze({
    id: "off-hours-privilege-use",
    name: "업무 시간 밖·낯선 주소의 권한 사용",
    technique: "T1078",
    condition: "수업 시간 밖이거나 처음 보는 주소에서 관리자 권한 사용이 있고 다른 권한 상승 근거가 하나 이상 함께 있으며 경보 수준 10 이상일 때 차단 후보. 시각이나 주소만 다른 경우는 알림.",
    evidence: "T1078 Valid Accounts: 도용된 정상 계정은 평소와 다른 시각·주소에서 권한을 쓰는 경우가 많아 이를 정상 사용과 구별하는 단서가 된다.",
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. 보편 임계값이 아닙니다.
const STRONG_LEVEL = 10;
const NOTABLE_LEVEL = 5;
const MIN_EVIDENCE = 2;
const MULTI_ACCOUNT_MIN = 3;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));
const ALL_NAMES = `패턴 ${PATTERNS.map(pattern => pattern.id).join('·')}`;
const round = value => Math.round(value * 100) / 100;
const ADMIN_GROUP = /^(administrators?|admins?|domain admins|root|sudo|wheel)$/iu;

// 권한 상승 사건(그 자체가 권한 상승을 뜻하는 근거)과 정황(주소·시각·직후 명령)을 구분합니다.
const EVENTS = Object.freeze([
  Object.freeze({ id: '관리자 그룹 추가', test: s => /관리자\s*그룹(에|으로)\s*(추가|들어)/u.test(s.text) || (s.adminGroup && /추가|들어/u.test(s.text)) }),
  Object.freeze({ id: '관리자 명령 실행', test: s => /(관리자|권한)\s*명령(을|이)?\s*(실행|수행)|(관리자|권한)\s*명령이[^.]{0,12}실행됐|관리자\s*권한으로\s*명령/u.test(s.text) && !/실패/u.test(s.text) }),
  Object.freeze({ id: '세션 권한 상승', test: s => /세션이\s*관리자\s*권한|관리자\s*권한으로\s*바뀌/u.test(s.text) }),
  Object.freeze({ id: '다른 계정의 권한 사용', test: s => /다른\s*계정의\s*권한/u.test(s.text) }),
  Object.freeze({ id: '여러 계정 연속 추가', test: s => s.count >= MULTI_ACCOUNT_MIN && (s.adminGroup || /관리자\s*그룹/u.test(s.text)) }),
  Object.freeze({ id: '그룹 탈퇴 직후 재가입', test: s => /빠진[^.]*다시[^.]*(들어|추가)/u.test(s.text) }),
]);
const CONTEXTS = Object.freeze([
  Object.freeze({ id: '원격·처음 보는 주소', test: s => /원격\s*주소|처음\s*(보는|봅)|요청\s*주소는\s*처음/u.test(s.text) }),
  Object.freeze({ id: '수업 시간 밖', test: s => /수업\s*시간\s*밖|업무처럼\s*보이지\s*않는|시간\s*밖|야간|새벽/u.test(s.text) }),
  Object.freeze({ id: '추가 직후 명령 실행', test: s => /방금\s*관리자가\s*된|곧바로|그룹\s*추가와\s*명령\s*실행이\s*같이/u.test(s.text) }),
]);

// "…은 아닙니다", "변경은 없습니다", "취소됐습니다"처럼 권한 상승이 일어나지 않았다고 말하는 문장은 근거에서 뺍니다.
function positiveText(description) {
  return description.split('.').filter(sentence => !/아닙니다|(변경|명령|이어서)[^.]*없습니다|취소됐|읽기만|조회한\s*뒤/u.test(sentence)).join('.');
}

function readSignals(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;
  let count = Number.parseInt(String(data.count ?? ''), 10);
  if (!Number.isFinite(count) || count < 0) count = 0;
  const group = typeof data.group === 'string' ? data.group.slice(0, 64) : '';
  const s = { text: positiveText(description), adminGroup: ADMIN_GROUP.test(group), count };
  return {
    level,
    events: EVENTS.filter(item => item.test(s)).map(item => item.id),
    contexts: CONTEXTS.filter(item => item.test(s)).map(item => item.id),
  };
}

// 근거 조합에서 가장 가까운 패턴을 고릅니다.
function patternFor(events, contexts) {
  if (events.includes('관리자 명령 실행') && contexts.includes('수업 시간 밖')) return byId['off-hours-privilege-use'];
  if (events.includes('관리자 그룹 추가') || events.includes('여러 계정 연속 추가') || events.includes('그룹 탈퇴 직후 재가입')) return byId['admin-group-addition'];
  if (events.length) return byId['unfamiliar-admin-command'];
  if (contexts.includes('수업 시간 밖')) return byId['off-hours-privilege-use'];
  return null;
}

// 구조는 확인되지 않았지만 단어가 닮았을 때 이유 문구에 가장 가까운 패턴 이름을 적기 위한 약한 신호(차단 근거 아님)입니다.
const WEAK_HINTS = Object.freeze({
  'admin-group-addition': /그룹|group/iu,
  'unfamiliar-admin-command': /권한|명령|상승|관리자/u,
  'off-hours-privilege-use': /시간|주소|시각/u,
});

function weakHint(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  return PATTERNS.find(pattern => WEAK_HINTS[pattern.id].test(description)) ?? null;
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
  const { level, events, contexts } = readSignals(alert);
  const evidenceCount = events.length + contexts.length;
  const detail = `권한 상승 사건 ${events.length}개(${events.join('·') || '없음'}), 정황 ${contexts.length}개(${contexts.join('·') || '없음'}), 수준 ${level}`;
  const main = patternFor(events, contexts);

  if (events.length && evidenceCount >= MIN_EVIDENCE) {
    // 권한 상승 사건이 있고 서로 다른 근거가 둘 이상. 경보 수준이 높을 때만 차단 수준입니다.
    let confidence = 0.7;
    if (level >= STRONG_LEVEL) {
      confidence = 0.88 + 0.03 * Math.min(3, evidenceCount - MIN_EVIDENCE) + (level >= 12 ? 0.01 : 0);
    }
    confidence = round(Math.min(0.97, confidence));
    return { action: actionFor(confidence), confidence, reason: `${main.name} [${main.id}, ${main.technique}]: ${detail}` };
  }

  // 근거가 하나뿐이면 알림만 남깁니다(경보 수준이 눈여겨볼 만할 때).
  if (main && evidenceCount >= 1 && level >= NOTABLE_LEVEL) {
    return { action: 'alert', confidence: 0.6, reason: `${main.name} [${main.id}, ${main.technique}] 근거가 하나뿐이라 알림만 남김: ${detail}` };
  }
  if (level >= NOTABLE_LEVEL) {
    const hint = weakHint(alert);
    const reason = hint
      ? `${hint.name} [${hint.id}, ${hint.technique}] 의심 신호뿐(변경·실행 근거 부족)이라 알림만 남김: ${detail}`
      : `${ALL_NAMES} 어느 근거도 확인되지 않은 경보라 알림만 남김: ${detail}`;
    return { action: 'alert', confidence: 0.55, reason };
  }
  return { action: 'record', confidence: 0.1, reason: `${ALL_NAMES} 어느 패턴과도 맞지 않아 기록만 남김: ${detail}` };
}
