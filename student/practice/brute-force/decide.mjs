// 제작 3: 무차별 로그인 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/brute-force/patterns.json(근거: MITRE ATT&CK T1110)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 구조 근거 + 반복 집계 + 경보 수준을 함께 만족할 때만 내립니다. 단어·수준·태그 하나만으로는 막지 않습니다.
// 경보 번호·주소·순서는 판단에 쓰지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'same-source-failure-burst',
    name: '같은 주소의 짧은 시간 로그인 실패 연속',
    technique: 'T1110.001',
  }),
  Object.freeze({
    id: 'multi-account-same-password',
    name: '여러 계정에 같은 비밀번호를 대입',
    technique: 'T1110.003',
  }),
  Object.freeze({
    id: 'incremental-password-guess',
    name: '비밀번호를 조금씩 바꿔 가며 대입',
    technique: 'T1110.001',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. MITRE가 정한 보편 임계값이 아닙니다.
const BURST_MIN_FAILURES = 20;
const SPRAY_MIN_ACCOUNTS = 5;
const SPRAY_MIN_FAILURES_WITHOUT_LIST = 10;
const STRONG_LEVEL = 10;
const SHORT_WINDOW_MINUTES = 5;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));
const round = value => Math.round(value * 100) / 100;
const first = (text, regex) => {
  const match = regex.exec(text);
  return match ? Number.parseInt(match[1], 10) : null;
};

// 경보에서 판단에 쓰는 값만 꺼냅니다. 값이 없거나 이상하면 0/null로 두어 의심 점수를 올리지 않습니다.
function readSignals(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;

  let failures = Number.parseInt(String(data.count ?? ''), 10);
  if (!Number.isFinite(failures) || failures < 0) failures = first(description, /실패\s*(\d+)\s*건/u) ?? 0;

  let accounts = 0;
  let accountsExplicit = true;
  if (typeof data.accounts === 'string') {
    accounts = new Set(data.accounts.split(',').map(name => name.trim()).filter(Boolean)).size;
  } else if (Array.isArray(data.accounts)) {
    accounts = new Set(data.accounts.filter(name => typeof name === 'string' && name.trim())).size;
  }
  if (!accounts) accounts = first(description, /계정\s*(\d+)\s*개/u) ?? (/두\s*계정/u.test(description) ? 2 : 0);
  if (!accounts && /여러\s*계정|계정\s*이름을\s*바꿔/u.test(description)) {
    accounts = SPRAY_MIN_ACCOUNTS;
    accountsExplicit = false;
  }

  const noSuccess = /성공(은|이)\s*없/u.test(description);
  return {
    failures,
    accounts,
    accountsExplicit,
    level,
    windowMinutes: first(description, /(\d+)\s*분/u),
    successAfter: !noSuccess && /실패[^.]*뒤[^.]*성공|뒤에\s*성공/u.test(description),
    samePassword: /같은\s*비밀번호/u.test(description),
    sameInterval: /같은\s*간격/u.test(description),
    renamedAccounts: /계정\s*이름을\s*바꿔/u.test(description),
    stepping: /한\s*글자씩|조금씩\s*바꿔/u.test(description),
    failureStructure: /로그인\s*실패|비밀번호\s*실패|실패/u.test(description) || failures > 0,
  };
}

// 같은 주소·계정의 실패 연속: 실패 20건 이상 + 수준 10 이상 + (시간 범위가 있으면 5분 이내)일 때만 차단 수준입니다.
function burstScore(s) {
  const n = s.failures;
  if (!s.failureStructure || n <= 0) return 0;
  const strong = n >= BURST_MIN_FAILURES && s.level >= STRONG_LEVEL
    && (s.windowMinutes === null || s.windowMinutes <= SHORT_WINDOW_MINUTES);
  if (strong) return n >= 40 ? 0.97 : 0.93;
  let score;
  if (n >= 10) score = 0.7;
  else if (n >= 5) score = 0.6;
  else if (n >= 3) score = 0.55;
  else if (n === 2) score = 0.3;
  else score = 0.15;
  if (n >= 3) {
    // 실패 뒤 성공이거나 오래 걸친 시도는 조금 덜 뚜렷하지만, 3건 이상은 알림 아래로 내리지 않습니다.
    let drop = 0;
    if (s.successAfter) drop += 0.05;
    if (s.windowMinutes !== null && s.windowMinutes > 10) drop += 0.03;
    score = Math.max(ALERT_AT, Math.min(score, 0.8) - drop);
  }
  return round(score);
}

// 여러 계정에 같은 비밀번호·같은 간격·계정 이름 바꿔 대입: 계정 5개 이상 + 수준 10 이상일 때 차단 수준입니다.
// 계정 수가 설명에 직접 없으면 실패 집계 10건 이상도 함께 봅니다.
function sprayScore(s) {
  const hint = s.samePassword || s.sameInterval || s.renamedAccounts;
  if (!hint || s.accounts < 2) return 0;
  const enoughEvidence = s.accountsExplicit || s.failures >= SPRAY_MIN_FAILURES_WITHOUT_LIST;
  if (s.accounts >= SPRAY_MIN_ACCOUNTS && s.level >= STRONG_LEVEL && enoughEvidence) {
    if (s.accounts >= 15) return 0.93;
    if (s.accounts >= 8) return 0.9;
    return 0.88;
  }
  return s.accounts >= SPRAY_MIN_ACCOUNTS ? 0.65 : 0.55;
}

// 비밀번호를 조금씩 바꿔 넣는 변형 추측도 실패 20건 이상 + 수준 10 이상일 때만 차단 수준입니다.
function incrementalScore(s) {
  if (!s.stepping || s.failures < 3) return 0;
  if (s.failures >= BURST_MIN_FAILURES && s.level >= STRONG_LEVEL) return 0.93;
  return s.failures >= 10 ? 0.7 : 0.55;
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
  const signals = readSignals(alert);
  // 점수가 같으면 앞에 있는(더 구체적인) 패턴을 근거로 삼습니다.
  const candidates = [
    { pattern: byId['incremental-password-guess'], score: incrementalScore(signals),
      detail: `변형 대입 실패 ${signals.failures}건, 수준 ${signals.level}` },
    { pattern: byId['multi-account-same-password'], score: sprayScore(signals),
      detail: `계정 ${signals.accounts}개에 같은 시도, 수준 ${signals.level}` },
    { pattern: byId['same-source-failure-burst'], score: burstScore(signals),
      detail: `실패 ${signals.failures}건${signals.windowMinutes !== null ? ` / ${signals.windowMinutes}분` : ''}${signals.successAfter ? ' / 뒤에 성공' : ''}, 수준 ${signals.level}` },
  ];
  const best = candidates.reduce((top, item) => (item.score > top.score ? item : top), candidates[0]);
  const confidence = Math.min(1, Math.max(0, best.score));
  const action = actionFor(confidence);
  if (confidence < ALERT_AT) {
    return { action, confidence, reason: `패턴과 뚜렷하게 맞지 않아 기록만 남김 (${best.detail})` };
  }
  return { action, confidence, reason: `${best.pattern.name} [${best.pattern.id}, ${best.pattern.technique}]: ${best.detail}` };
}
