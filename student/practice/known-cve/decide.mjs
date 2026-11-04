// 제작 3: 알려진 취약점(CVE-2021-44228 형태) 악용 경보 판단 모듈. 다른 파일·패키지를 불러오지 않고, 파일·네트워크·시계를 쓰지 않고,
// 받은 경보 하나만 보고 혼자 계산해 { action, confidence, reason }을 돌려줍니다. 경보 원본은 고치지 않습니다.
// 패턴은 xdr/known-cve/patterns.json(근거: CVE-2021-44228, MITRE ATT&CK T1190)과 같은 내용을 옮겨 적은 상수입니다.
// 차단(block)은 완전한 원격 조회 구문(구조 근거) + 경보 수준 10 이상을 함께 만족할 때만 내립니다.
// CVE 번호 글자, jndi 단어, 중괄호, 취약점 이름 검색, 점검 도구와 비슷한 이름, 수준, 주소, 경보 번호·순서 하나만으로는 막지 않습니다.
// 문서용 조회 구문은 문자열로만 검사하며 실행·변형·전달하지 않고, 이유에도 원문을 남기지 않습니다.
const PATTERNS = Object.freeze([
  Object.freeze({
    id: "jndi-lookup-expression",
    name: "머리글·주소 인자 안의 원격 조회 구문(jndi)",
    technique: "T1190",
    condition: "요청 머리글이나 주소 인자에 ${jndi:프로토콜://대상} 형태의 완전한 조회 구문이 있고(디코딩과 lower·upper·기본값 표기로 쪼갠 변형 포함) 경보 수준이 10 이상일 때 차단 후보. 머리글과 주소 양쪽에 있거나 같은 주소에서 반복되면 확신도를 높인다. 수준이 낮으면 알림.",
    evidence: "CVE-2021-44228: Log4j 2의 JNDI 기능이 공격자가 정한 LDAP 등 원격 대상을 막지 않아, 기록되는 문자열에 조회 구문이 들어 있으면 원격 코드 실행으로 이어진다(T1190 공개 앱 악용).",
  }),
  Object.freeze({
    id: "repeated-lookup-probe",
    name: "같은 주소의 원격 조회 구문 반복 시도",
    technique: "T1190",
    condition: "같은 주소에서 완전한 원격 조회 구문이 3번 이상 반복되고 경보 수준 10 이상일 때 차단 후보(구문이 한 번뿐이어도 위 패턴으로 차단 후보가 될 수 있고, 반복은 확신도를 높이는 근거다).",
    evidence: "T1190: 공개 앱의 알려진 취약점은 공개 직후 자동화된 도구가 같은 구문을 여러 번 보내 악용을 시도하는 일이 흔하다(CVE-2021-44228 공개 직후 대규모 악용 시도).",
  }),
  Object.freeze({
    id: "known-vuln-scanner-trace",
    name: "알려진 취약점 점검 도구의 흔적",
    technique: "T1595.002",
    condition: "센서가 알려진 취약점 점검 도구의 흔적(probe 표식, 점검 도구 이름)을 검출했으면 단독으로는 알림. 완전한 원격 조회 구문과 함께 있고 경보 수준 10 이상이면 위 패턴과 함께 차단 후보. 점검 도구와 비슷한 수업용 프로그램 이름은 흔적으로 보지 않고 알림만 남긴다.",
    evidence: "T1595.002 Vulnerability Scanning: 공격자는 악용 전에 알려진 취약점을 도구로 점검하며, CVE-2021-44228도 점검 도구가 조회 구문을 넣은 요청으로 찾아다녔다.",
  }),
]);

const BLOCK_AT = 0.85;
const ALERT_AT = 0.5;
// 학습용 기준값입니다. 보편 임계값이 아닙니다.
const STRONG_LEVEL = 10;
const NOTABLE_LEVEL = 5;
const REPEAT_MIN = 3;
const MAX_FIELD_LENGTH = 2048;
const MAX_FIELDS = 12;

const byId = Object.freeze(Object.fromEntries(PATTERNS.map(pattern => [pattern.id, pattern])));
const ALL_NAMES = `패턴 ${PATTERNS.map(pattern => pattern.id).join('·')}`;
const round = value => Math.round(value * 100) / 100;

// 완전한 조회 구문: ${jndi:프로토콜://대상}. CVE 번호 글자나 jndi 단어만으로는 맞지 않습니다.
const LOOKUP = /\$\{\s*jndi\s*:\s*(?:ldaps?|rmi|dns|iiop|nis|corba|https?)\s*:\s*\/\/[^}\s]+\}/iu;
const KNOWN_SCANNER_AGENT = /nuclei|zgrab|masscan|nikto|sqlmap|acunetix|nessus|openvas|qualys|log4j-scan|interactsh|dirbuster|gobuster/iu;

// 디코딩(최대 두 번)과 lower·upper·기본값 표기로 쪼갠 변형을 풀어 문자열로만 비교합니다.
function normalize(value) {
  let text = String(value).slice(0, MAX_FIELD_LENGTH);
  for (let i = 0; i < 2; i += 1) {
    try {
      const next = decodeURIComponent(text.replace(/\+/gu, ' '));
      if (next === text) break;
      text = next;
    } catch {
      break;
    }
  }
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(/\$\{\s*(?:lower|upper)\s*:\s*([^${}]*)\}/giu, '$1')
      .replace(/\$\{[^${}:]*:[^${}:]*:-([^${}]*)\}/gu, '$1')
      .replace(/\$\{::-([^${}]*)\}/gu, '$1');
    if (next === text) break;
    text = next;
  }
  return text;
}

// 문장 단위로 "없습니다·아닙니다"와 수업·비슷한 표현이 들어 있으면 위협 근거에서 뺍니다.
function positiveText(description, extra = /(?!)/u) {
  return description.split('.').filter(sentence => !/없습니다|아닙니다|비슷한|수업용|일부|잘린/u.test(sentence) && !extra.test(sentence)).join('.');
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

  // 요청 머리글(주소 이외의 문자열 값)과 요청 주소 인자에서 완전한 조회 구문을 찾습니다. 출발 주소·계정 칸은 보지 않습니다.
  const locations = new Set();
  let scannerTrace = false;
  Object.entries(data).slice(0, MAX_FIELDS).forEach(([key, value]) => {
    if (typeof value !== 'string' || key === 'srcip' || key === 'srcuser' || key === 'dstuser') return;
    const text = normalize(value);
    if (LOOKUP.test(text)) locations.add(key === 'url' ? '주소' : '머리글');
    if (key === 'useragent' && KNOWN_SCANNER_AGENT.test(text)) scannerTrace = true;
    if (key === 'url' && /(^|[?&])probe=/iu.test(text)) scannerTrace = true;
  });
  if (/점검\s*(도구|흔적)/u.test(positiveText(description))) scannerTrace = true;

  return { level, repeats, locations: [...locations], scannerTrace };
}

// 구조는 확인되지 않았지만 단어·표기가 닮았을 때 이유 문구에 가장 가까운 패턴 이름을 적기 위한 약한 신호(차단 근거 아님)입니다.
const WEAK_HINTS = Object.freeze({
  'jndi-lookup-expression': /jndi|\$\{|[{}]|cve-2021-44228|조회|라이브러리|log4j/iu,
  'repeated-lookup-probe': /반복|여러\s*번/u,
  'known-vuln-scanner-trace': /점검|probe|scan|tool|도구|취약점/iu,
});

function weakHint(alert) {
  const description = typeof alert?.rule?.description === 'string' ? alert.rule.description.slice(0, 500) : '';
  const data = alert && typeof alert.data === 'object' && alert.data ? alert.data : {};
  const text = [description, ...Object.entries(data).filter(([key]) => key !== 'srcip' && key !== 'srcuser')
    .map(([, value]) => (typeof value === 'string' ? normalize(value) : ''))].join(' ');
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
  const { level, repeats, locations, scannerTrace } = readSignals(alert);
  const where = locations.length ? `${locations.join('·')} 인자 ${locations.length}곳` : '조회 구문 없음';
  const evidence = `${where}, 반복 ${repeats}번, 수준 ${level}${scannerTrace ? ', 점검 도구 흔적' : ''}`;

  if (locations.length) {
    // 완전한 조회 구문이 있고 경보 수준이 높을 때만 차단 수준입니다.
    const repeated = repeats >= REPEAT_MIN;
    let confidence = 0.7;
    if (level >= STRONG_LEVEL) {
      confidence = 0.9 + (locations.length > 1 ? 0.03 : 0) + (repeated ? 0.03 : 0) + (scannerTrace ? 0.02 : 0) + (level >= 12 ? 0.01 : 0);
    }
    confidence = round(Math.min(0.97, confidence));
    const main = repeated && level >= STRONG_LEVEL ? byId['repeated-lookup-probe'] : byId['jndi-lookup-expression'];
    const ids = [main.id, ...(scannerTrace ? [byId['known-vuln-scanner-trace'].id] : [])].join('+');
    return { action: actionFor(confidence), confidence, reason: `${main.name} [${ids}, ${main.technique}]: ${evidence}` };
  }

  if (scannerTrace && level >= NOTABLE_LEVEL) {
    const pattern = byId['known-vuln-scanner-trace'];
    return { action: 'alert', confidence: 0.6, reason: `${pattern.name} [${pattern.id}, ${pattern.technique}] 단독 흔적이라 알림만 남김: ${evidence}` };
  }

  // 구조는 없지만 센서가 눈여겨볼 수준으로 남긴 경보는 닮은 패턴 이름을 근거로 알림만 남깁니다.
  if (level >= NOTABLE_LEVEL) {
    const hint = weakHint(alert);
    const reason = hint
      ? `${hint.name} [${hint.id}, ${hint.technique}] 의심 신호뿐(완전한 구문 없음)이라 알림만 남김: ${evidence}`
      : `${ALL_NAMES} 어느 구조도 확인되지 않은 경보라 알림만 남김: ${evidence}`;
    return { action: 'alert', confidence: 0.55, reason };
  }
  return { action: 'record', confidence: 0.1, reason: `${ALL_NAMES} 어느 패턴과도 맞지 않아 기록만 남김: ${evidence}` };
}
