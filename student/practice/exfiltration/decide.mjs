// 제작 3: 자료 빼돌리기(반출) 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/exfiltration/patterns.json(근거: MITRE ATT&CK T1041·T1048)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 대량 전송 + 목적지·시각·방식의 이상 정황 하나 이상 + 경보 수준 10 이상을 함께 만족할 때만 내립니다.
// 전송량 하나, 압축 파일 생성, 작은 파일의 낯선 목적지, 수준, 주소, 계정 이름, 경보 번호·순서 하나만으로는 막지 않습니다.
// 계정 이름은 판단에 쓰지 않고 이유에도 남기지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: "large-transfer-new-destination",
    name: "처음 보는 목적지로 대용량 전송",
    technique: "T1048",
    condition: "전송량이 5천만 바이트 이상이거나 파일 50건 이상이고, 처음 보는 목적지·평소 쓰지 않던 포트·여러 목적지 가운데 하나 이상이 함께 보이며 경보 수준 10 이상일 때 차단 후보. 중간 크기 전송이나 작은 파일의 낯선 목적지는 알림.",
    evidence: "T1048 Exfiltration Over Alternative Protocol: 공격자는 평소 쓰지 않는 목적지·포트·프로토콜로 큰 자료를 보내 정상 통신과 구별되지 않게 반출하며, 처음 보는 목적지로의 대용량 전송이 대표 흔적이다.",
  }),
  Object.freeze({
    id: "off-hours-archive-exfiltration",
    name: "업무 시간 밖 압축 파일 반출",
    technique: "T1048",
    condition: "압축 파일이 수업 시간 밖에 외부 주소로 나가고 전송량이 5천만 바이트 이상이며 경보 수준 10 이상일 때 차단 후보. 압축 파일을 만들기만 했거나 외부 전송이 없는 경우는 알림.",
    evidence: "T1048과 수집 후 반출 흐름: 공격자는 자료를 압축해 묶은 뒤 사람이 없는 시간대에 한꺼번에 내보내는 경우가 많아 시각과 압축 파일이 함께 보이면 의심 단서가 된다.",
  }),
  Object.freeze({
    id: "repeated-c2-channel-transfer",
    name: "명령 통로로 반복된 대용량 전송",
    technique: "T1041",
    condition: "같은 목적지로 대용량 전송이 3번 이상 반복되거나 명령 통로로 큰 파일이 보내지고, 전송량이 5천만 바이트 이상이며 경보 수준 10 이상일 때 차단 후보. 명령 통로에 짧은 자료 이름이 몇 번 보인 정도는 알림.",
    evidence: "T1041 Exfiltration Over C2 Channel: 공격자는 이미 쓰고 있는 명령 통제 통로로 자료를 반복해서 내보내므로 같은 목적지로의 대용량 반복 전송이 대표 흔적이다.",
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. 보편 임계값이 아닙니다.
const LARGE_BYTES = 50000000;
const MEDIUM_BYTES = 5000000;
const BULK_FILES = 50;
const REPEAT_MIN = 3;
const STRONG_LEVEL = 10;
const NOTABLE_LEVEL = 5;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));
const ALL_NAMES = `패턴 ${PATTERNS.map(pattern => pattern.id).join('·')}`;
const round = value => Math.round(value * 100) / 100;
const toCount = value => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

// 설명 문장 가운데 "…은 없습니다"처럼 전송이 없었다고 말하는 문장은 근거에서 뺍니다.
function positiveText(description) {
  return description.split('.').filter(sentence => !/(전송|반복|연속)은\s*(아직\s*)?없습니다|아닙니다|큰\s*파일은/u.test(sentence)).join('.');
}

// 이상 정황(서로 다른 종류만 한 번씩 셉니다).
const CONTEXTS = Object.freeze([
  Object.freeze({ id: '처음 보는 목적지', test: s => /처음\s*(보는|봅)|평소와\s*다른\s*(주소|목적지)|낯선\s*(주소|목적지)/u.test(s.text) && !/수업\s*자료\s*주소/u.test(s.text) }),
  Object.freeze({ id: '수업 시간 밖', test: s => /수업\s*시간\s*밖|업무\s*시간\s*밖|야간|새벽/u.test(s.text) }),
  Object.freeze({ id: '압축 파일', test: s => /압축\s*파일/u.test(s.text) }),
  Object.freeze({ id: '평소 쓰지 않던 포트', test: s => /쓰지\s*않던\s*포트|평소와\s*다른\s*포트/u.test(s.text) }),
  Object.freeze({ id: '명령 통로', test: s => /명령\s*통로/u.test(s.text) }),
  Object.freeze({ id: '반복 전송', test: s => s.repeats >= REPEAT_MIN || /반복|연속\s*(전송|으로)/u.test(s.text) }),
  Object.freeze({ id: '자료실 전체 복사', test: s => /자료실\s*전체|전체가\s*(외부|다른)/u.test(s.text) }),
  Object.freeze({ id: '여러 목적지', test: s => /(두|세|여러)\s*곳|목적지\s*(두|세|여러)/u.test(s.text) }),
]);

function readSignals(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;
  const bytes = toCount(data.bytes);
  const files = toCount(data.files);
  const repeats = toCount(data.count);
  const s = { text: positiveText(description), repeats };
  const contexts = CONTEXTS.filter(item => item.test(s)).map(item => item.id);
  // 막을 대상(목적지 주소)이 경보에 있어야 차단 후보가 됩니다. 외부 전송이 없는 경보는 전송량이 커도 알림만 남깁니다.
  const hasDestination = typeof data.dstip === 'string' && data.dstip.length > 0;
  return { level, bytes, files, repeats, contexts, hasDestination };
}

// 가장 가까운 패턴을 고릅니다(명령 통로·반복 → 시각+압축 → 대용량 새 목적지 순).
function patternFor(contexts) {
  if (contexts.includes('명령 통로') || contexts.includes('반복 전송')) return byId['repeated-c2-channel-transfer'];
  if (contexts.includes('수업 시간 밖') && contexts.includes('압축 파일')) return byId['off-hours-archive-exfiltration'];
  return byId['large-transfer-new-destination'];
}

// 구조는 확인되지 않았지만 단어가 닮았을 때 이유 문구에 가장 가까운 패턴 이름을 적기 위한 약한 신호(차단 근거 아님)입니다.
const WEAK_HINTS = Object.freeze({
  'large-transfer-new-destination': /목적지|주소|전송|나갔|파일/u,
  'off-hours-archive-exfiltration': /압축|시간|백업/u,
  'repeated-c2-channel-transfer': /명령\s*통로|반복|연속/u,
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
  const { level, bytes, files, contexts, hasDestination } = readSignals(alert);
  const large = bytes >= LARGE_BYTES || files >= BULK_FILES;
  const medium = bytes >= MEDIUM_BYTES;
  const mb = Math.round(bytes / 1000000);
  const detail = `전송량 ${mb}MB·파일 ${files}건(${large ? '대량' : medium ? '중간' : '소량'}), 정황 ${contexts.length}개(${contexts.join('·') || '없음'}), 수준 ${level}`;
  const main = patternFor(contexts);

  if (large && contexts.length >= 1 && hasDestination) {
    // 대량 전송 + 이상 정황. 경보 수준이 높을 때만 차단 수준입니다.
    let confidence = 0.7;
    if (level >= STRONG_LEVEL) {
      confidence = 0.88 + 0.03 * Math.min(3, contexts.length - 1) + (bytes >= 200000000 ? 0.01 : 0) + (level >= 12 ? 0.01 : 0);
    }
    confidence = round(Math.min(0.97, confidence));
    return { action: actionFor(confidence), confidence, reason: `${main.name} [${main.id}, ${main.technique}]: ${detail}` };
  }

  // 대량 근거가 없거나 정황이 없으면 알림만 남깁니다(전송량이 중간이거나 경보 수준이 눈여겨볼 만할 때).
  if (medium || large || (contexts.length && level >= NOTABLE_LEVEL)) {
    return { action: 'alert', confidence: contexts.length ? 0.6 : 0.55, reason: `${main.name} [${main.id}, ${main.technique}] 대량 전송 근거가 부족해 알림만 남김: ${detail}` };
  }
  if (level >= NOTABLE_LEVEL) {
    const hint = weakHint(alert);
    const reason = hint
      ? `${hint.name} [${hint.id}, ${hint.technique}] 의심 신호뿐(전송량·정황 근거 부족)이라 알림만 남김: ${detail}`
      : `${ALL_NAMES} 어느 근거도 확인되지 않은 경보라 알림만 남김: ${detail}`;
    return { action: 'alert', confidence: 0.55, reason };
  }
  return { action: 'record', confidence: 0.1, reason: `${ALL_NAMES} 어느 패턴과도 맞지 않아 기록만 남김: ${detail}` };
}
