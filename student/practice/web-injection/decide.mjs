// 제작 3: 웹 주입 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/web-injection/patterns.json(근거: MITRE ATT&CK T1190)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 주입 구조 근거 + 같은 주소의 반복 집계 + 경보 수준을 함께 만족할 때만 내립니다.
// select·script·SQL 같은 단어 하나, 수준, 태그, 주소, 경보 번호·순서만으로는 막지 않습니다.
// 요청 주소는 길이를 제한하고 최대 두 번 디코딩해 문자열로만 검사하며, 어떤 구문도 실행하지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: 'sql-injection',
    name: '요청 인자 안의 SQL 구문',
    technique: 'T1190',
    condition: '요청 인자에 SQL 구문을 이어 붙이거나 조건을 덧붙인 구조(예: union·select 연결, 따옴표 뒤 or 조건, 주석·구문 종료)가 있거나 센서가 SQL 구문 표기를 검출했고, 같은 주소에서 5번 이상 반복되며 경보 수준 10 이상일 때 차단 후보. 반복이 없으면 알림.',
    evidence: 'T1190: 공개 웹 앱의 입력 처리 약점에 SQL 구문을 넣어 데이터베이스를 조작하는 SQL 주입이 대표 악용 방식이다(예: MOVEit CVE-2023-34362).',
  }),
  Object.freeze({
    id: 'script-injection',
    name: '요청 인자 안의 스크립트 태그',
    technique: 'T1190',
    condition: '요청 인자에 script 태그·이벤트 처리기(onerror 등)·javascript: 같은 스크립트 삽입 구조가 있거나 센서가 스크립트 삽입 표식을 검출했고, 같은 주소에서 5번 이상 반복되며 경보 수준 10 이상일 때 차단 후보. 「스크립트」라는 수업 단어처럼 삽입 표식이 아닌 경우는 구조로 보지 않는다.',
    evidence: 'T1190: 공개 웹 앱이 입력을 걸러 내지 못하는 약점을 노려 스크립트를 삽입하는 것도 외부 공개 앱 악용에 속한다(OWASP Top 10 Injection).',
  }),
  Object.freeze({
    id: 'path-traversal',
    name: '경로 거슬러 올라가기(../) 반복',
    technique: 'T1190',
    condition: '요청 인자에 ../ 또는 그 인코딩이 두 단계 이상 이어지거나 센서가 경로 이탈 표기를 검출했고, 같은 주소에서 5번 이상 반복되며 경보 수준 10 이상일 때 차단 후보. 「up」 같은 글자 한 번은 구조로 보지 않는다.',
    evidence: 'T1190: 공개 웹 앱의 파일 경로 처리 약점을 이용해 허용되지 않은 위치의 파일을 읽는 경로 이탈(CWE-22)도 외부 공개 앱 악용 방식이다.',
  }),
  Object.freeze({
    id: 'command-injection',
    name: '요청 인자 안의 명령 구분자',
    technique: 'T1190',
    condition: '요청 인자에 명령 구분자(; | && $( `)와 명령어가 이어지거나 센서가 명령 구분자 표기를 검출했고, 같은 주소에서 5번 이상 반복되며 경보 수준 10 이상일 때 차단 후보. 이름 검색의 구분 문자 한 번은 알림.',
    evidence: 'T1190: 공개 웹 앱이 입력을 시스템 명령에 그대로 넘기는 약점(OS 명령 주입, CWE-78)을 악용하는 것도 외부 공개 앱 악용 방식이다.',
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. MITRE가 정한 보편 임계값이 아닙니다.
const MIN_REPEATS = 5;
const STRONG_LEVEL = 10;
const SENSOR_NOTABLE_LEVEL = 5;
const MAX_URL_LENGTH = 2048;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));

// 센서 설명에서 주입 구조를 말하는 표현(부정문은 제외)
const DESCRIPTION_STRUCTURE = Object.freeze({
  'sql-injection': /(SQL|데이터베이스\s*조회)[^.]*(구문|표기|표식|이어\s*붙)|(구문|표기|표식)[^.]*SQL/iu,
  'script-injection': /스크립트\s*(삽입|표식|태그)/u,
  'path-traversal': /경로[^.]*(거슬러|이탈)/u,
  'command-injection': /명령\s*(구분자|주입)/u,
});

// 요청 주소 안의 주입 구조(디코딩한 문자열을 검사만 함). doc-* 는 공식 가상 경보의 문서용 표기입니다.
const URL_STRUCTURE = Object.freeze({
  'sql-injection': /\bunion\b[\s\S]{0,30}\bselect\b|'\s*(or|and)\s+['\d]|\bor\s+\d+\s*=\s*\d+|;\s*(drop|delete|insert|update)\s|\/\*|\bsleep\s*\(|doc-sql|doc-mixed/u,
  'script-injection': /<\s*\/?\s*script\b|\bon(error|load|click|mouseover)\s*=|javascript:|doc-script|doc-mixed/u,
  'path-traversal': /(\.\.[\\/]){2,}|doc-up-repeat/u,
  'command-injection': /(;|\|\||&&|\$\(|`)\s*(cat|ls|id|whoami|rm|curl|wget|sh|bash|nc|ping)\b|doc-cmd/u,
});

function decodeUrl(value) {
  let text = typeof value === 'string' ? value.slice(0, MAX_URL_LENGTH) : '';
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(text.replace(/\+/gu, ' '));
      if (next === text) break;
      text = next;
    } catch {
      break;
    }
  }
  return text.toLowerCase();
}

function readSignals(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const level = Number.isInteger(alert?.rule?.level) ? alert.rule.level : 0;
  let repeats = Number.parseInt(String(data.count ?? ''), 10);
  if (!Number.isFinite(repeats) || repeats < 0) {
    const match = /(\d+)\s*(번|회|건)/u.exec(description);
    repeats = match ? Number.parseInt(match[1], 10) : 0;
  }
  // "…표식은 아닙니다", "…없습니다"처럼 부정하는 문장은 구조 근거로 쓰지 않습니다.
  const positive = description.split('.').filter(sentence => !/아닙니다|없습니다/u.test(sentence)).join('.');
  const url = decodeUrl(data.url);
  const structures = PATTERNS.map(pattern => ({
    id: pattern.id,
    fromDescription: DESCRIPTION_STRUCTURE[pattern.id].test(positive),
    fromUrl: URL_STRUCTURE[pattern.id].test(url),
  })).filter(item => item.fromDescription || item.fromUrl);
  return { level, repeats, structures };
}

const ALL_NAMES = `패턴 ${PATTERNS.map(pattern => pattern.id).join('·')}`;

// 차단 근거가 아니라 이유 문구에 가장 가까운 패턴 이름을 적기 위한 약한 신호(단어·문자 하나)입니다.
const WEAK_HINTS = Object.freeze({
  'sql-injection': /따옴표|select|sql|union|데이터베이스|'/iu,
  'script-injection': /스크립트|script|[<>]/iu,
  'path-traversal': /경로|\.\.|(^|[^a-z])up([^a-z]|$)/iu,
  'command-injection': /구분\s*문자|구분자|명령|[;|&`]/u,
});

function weakHint(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const url = decodeUrl(alert?.data?.url);
  return PATTERNS.find(pattern => WEAK_HINTS[pattern.id].test(description) || WEAK_HINTS[pattern.id].test(url)) ?? null;
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
  const { level, repeats, structures } = readSignals(alert);
  const evidence = `반복 ${repeats}번, 수준 ${level}`;

  if (structures.length) {
    // 근거가 여럿이면 설명과 요청 주소 양쪽에서 확인된 패턴을 앞에 둡니다. 같으면 상수 순서를 따릅니다.
    const best = [...structures].sort((a, b) => Number(b.fromDescription && b.fromUrl) - Number(a.fromDescription && a.fromUrl))[0];
    const pattern = byId[best.id];
    const names = structures.map(item => item.id).join('+');
    let confidence;
    if (repeats >= MIN_REPEATS && level >= STRONG_LEVEL) {
      confidence = 0.9 + (repeats >= 10 ? 0.04 : 0) + (repeats >= 15 ? 0.02 : 0) + (structures.length > 1 ? 0.01 : 0);
    } else {
      // 구조는 있으나 반복이 적거나 수준이 낮으면 알림만 남깁니다.
      confidence = repeats >= 2 ? 0.7 : 0.6;
    }
    confidence = Math.round(Math.min(0.97, confidence) * 100) / 100;
    return { action: actionFor(confidence), confidence, reason: `${pattern.name} [${names}, ${pattern.technique}]: ${evidence}` };
  }

  // 주입 구조는 보이지 않지만 센서가 눈여겨볼 수준으로 남긴 웹 경보는 애매한 사례로 알림만 남깁니다.
  if (level >= SENSOR_NOTABLE_LEVEL) {
    // 구조는 확인되지 않았지만 단어·문자가 닮은 패턴이 있으면 그 패턴 이름을 근거로 적습니다(차단 근거는 아님).
    const hint = weakHint(alert);
    const reason = hint
      ? `${hint.name} [${hint.id}, ${hint.technique}] 의심 신호뿐(구조·반복 근거 부족)이라 알림만 남김: ${evidence}`
      : `${ALL_NAMES} 어느 구조도 확인되지 않은 웹 경보라 알림만 남김: ${evidence}`;
    return { action: 'alert', confidence: 0.55, reason };
  }
  return { action: 'record', confidence: 0.1, reason: `${ALL_NAMES} 어느 패턴과도 맞지 않아 기록만 남김: ${evidence}` };
}
