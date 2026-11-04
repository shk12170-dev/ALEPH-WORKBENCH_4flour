// 참고 사례: 내 PC 점검 · 서비스 연결/사용량/비용 · 이상 징후 근거 (ZTNA/XDR 개인 클라이언트)
//
// 이 파일은 학생이 읽고 자기 코드로 다시 만드는 참고 코드입니다. 자동 성취가 아닙니다.
// - 기존 createStudentView({ api, onChange }) 계약만 씁니다. 새 주소·권한·서버 코드를 만들지 않습니다.
// - 내 PC 실측은 시작 틀 0.2.18 후보의 api.get('/api/pc/status')(기존 읽기 전용 경로)로 버튼을 누를 때만 읽습니다.
//   이전 판 앱은 이 경로를 NOT_ALLOWED 로 돌려주므로 「지원 없음」으로 따로 보여 줍니다.
// - 외부 SaaS(GitHub·Vercel·Railway·Supabase)는 실제로 연결하지 않습니다. 모두 「연결 전 · 확인 불가」로 시작합니다.
// - 키·토큰 입력, 브라우저 저장(localStorage 등), 외부 요청(fetch), 인증 구현이 없습니다.
// - 화면에는 textContent 만 씁니다. 서버나 예시 값이 HTML 로 해석되지 않습니다.
// - 예시 값은 「예시 보기」를 누를 때만 보이고, 서비스 요약과 근거 상세에 [예시] 표시가 붙습니다.
// - 정체성·접속 판정·이벤트·조치 등 다른 칸은 학생 구현 과제로 그대로 둡니다.
// - ZTNA 범위는 「접속 신뢰 근거를 보여 주는 모니터링」입니다. 실제 네트워크 차단·보안 인증이 아닙니다.
//
// 화면 순서: 지금 상태 요약 → 서비스별 연결·사용량·비용 요약 → (펼칠 때만) 근거 상세 → (펼칠 때만) 개발 참고.
// 근거 상세는 기본 details/summary 로 접어 둡니다. 앱이 이 칸을 다시 그려도 펼침 상태와
// 이 칸 안에 있던 초점은 되살리고, 사용자가 다른 곳으로 옮긴 초점은 가져오지 않습니다.
// PC 값은 「조회 응답 성공」과 「개별 항목 실측 성공」을 나눠 보이고, 관찰 0건을 안전 판정으로 쓰지 않습니다.

const PC_PATH = '/api/pc/status';
const PC_SCHEMA = 'aleph.on.pc-status.v1';
const PC_MAX_AGE_MS = 60000;
const PC_ITEM_COUNT = 5; // CPU · 메모리 · 디스크 · Windows 방화벽 · Windows 기록

// 근거 상태는 섞지 않습니다. 「확인 불가」와 「실패」를 안전으로 바꾸지 않습니다.
const EVIDENCE = Object.freeze({
  not_connected: '연결 전',
  ok: '조회 성공',
  permission_denied: '권한 부족',
  partial: '부분 결과',
  stale: '오래됨',
  unverifiable: '확인 불가',
  failed: '실패',
  unsupported: '지원 없음',
  example: '예시',
});

const SERVICES = Object.freeze(['GitHub', 'Vercel', 'Railway', 'Supabase']);

// 「예시 보기」를 눌렀을 때만 쓰는 고정 예시입니다. 실제 계정·금액·조회 결과가 아닙니다.
// 일부러 상태를 섞었습니다. 모든 서비스를 정상으로 보이게 하는 예시를 만들지 않습니다.
// 종합 보안 점수는 만들지 않습니다.
const EXAMPLES = Object.freeze({
  GitHub: {
    connection: { state: 'partial', text: '개인 계정 항목은 읽었고 조직 정책은 권한 부족으로 읽지 못함', at: '2026-10-24T10:05:00+09:00', source: '예시 · GitHub API 응답을 가정' },
    security: [
      { item: '2단계 인증', observed: '켜짐', state: 'ok', source: '예시 · 계정 설정 조회를 가정', at: '2026-10-24T10:05:00+09:00' },
      { item: '조직 SSO 강제 여부', observed: '읽지 못함', state: 'permission_denied', source: '예시 · 조직 관리자 권한 없음', at: '2026-10-24T10:05:00+09:00' },
    ],
    usage: { state: 'ok', text: 'Actions 사용 312분', period: '2026-10-01 ~ 2026-10-24', source: '예시' },
    cost: { state: 'ok', billingMonth: '2026-10', currency: 'USD', amount: '3.20', period: '2026-10-01 ~ 2026-10-24', basis: '실적', credits: '무료 사용량 차감 후 초과분', tax: '세금 제외', source: '예시 · 청구 화면 값을 가정' },
    vulnerabilities: { state: 'ok', text: 'Dependabot 경고 2건(열림)', scope: '저장소 1개 · 기본 브랜치', at: '2026-10-24T10:05:00+09:00', source: '예시' },
  },
  Vercel: {
    connection: { state: 'stale', text: '마지막 조회가 3일 전이라 현재 상태로 쓰지 않음', at: '2026-10-21T09:00:00+09:00', source: '예시' },
    security: [
      { item: '배포 보호(Deployment Protection)', observed: '3일 전 조회 값만 있음', state: 'stale', source: '예시', at: '2026-10-21T09:00:00+09:00' },
    ],
    usage: { state: 'stale', text: '함수 실행 시간 값이 3일 전 것', period: '2026-10-01 ~ 2026-10-21', source: '예시' },
    cost: { state: 'unverifiable', billingMonth: '2026-10', currency: '확인 불가', amount: null, period: '확인 불가', basis: '확인 불가', credits: '확인 불가', tax: '확인 불가', source: '예시 · 청구 API를 조회하지 않음' },
    vulnerabilities: { state: 'unverifiable', text: '조회하지 않음', scope: '없음', at: null, source: '예시' },
  },
  Railway: {
    connection: { state: 'permission_denied', text: '토큰 권한이 프로젝트 읽기에 부족함', at: '2026-10-24T10:06:00+09:00', source: '예시' },
    security: [],
    usage: { state: 'permission_denied', text: '읽지 못함', period: '해당 없음', source: '예시' },
    cost: { state: 'ok', billingMonth: '2026-10', currency: 'USD', amount: '4.80', period: '2026-10-01 ~ 2026-10-24', basis: '예상(월말 추정)', credits: '크레딧 차감 전', tax: '세금 포함 여부 표시 없음', source: '예시 · 사용량 화면 값을 가정' },
    vulnerabilities: { state: 'unverifiable', text: '조회하지 않음', scope: '없음', at: null, source: '예시' },
  },
  Supabase: {
    connection: { state: 'failed', text: '요청 시간 초과', at: '2026-10-24T10:07:00+09:00', source: '예시' },
    security: [],
    usage: { state: 'failed', text: '읽지 못함', period: '해당 없음', source: '예시' },
    cost: { state: 'failed', billingMonth: '2026-10', currency: '확인 불가', amount: null, period: '확인 불가', basis: '확인 불가', credits: '확인 불가', tax: '확인 불가', source: '예시' },
    // 실제 패키지 이름·버전을 쓰지 않습니다. 예시의 「0건」이 실제 조회 결과처럼 읽히지 않게 합니다.
    vulnerabilities: { state: 'ok', text: '형식 예시: 「이 버전·이 출처·이 시각에 알려진 기록 0건」처럼 씀 · 실제로 조회하지 않음', scope: '예시용 가상 패키지 example-package 0.0.0-example 1개만', at: '2026-10-24T10:07:30+09:00', source: '예시 · OSV 조회를 가정(실제 OSV 연동은 학생 과제)' },
  },
});

const kst = iso => {
  const ms = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? `${new Date(ms).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국 시간)` : '시각 없음';
};
const gb = n => `${(n / 1024 ** 3).toFixed(1)} GB`;
const isNum = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const isCount = n => Number.isSafeInteger(n) && n >= 0;

// textContent 만 쓰는 작은 도우미. innerHTML·style 속성을 쓰지 않습니다.
function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = String(text);
  return n;
}
// role="status" 는 사용자 조작의 결과를 알리는 문단 몇 개에만 붙입니다(announce).
// 서비스 필드마다 알림을 걸지 않습니다. 이 칸 바깥 상자는 앱이 이미 aria-live="polite" 로 둡니다.
function stateBox(kind, text, announce = false) {
  const p = node('p', `state state-${kind}`, text);
  if (announce) p.setAttribute('role', 'status');
  return p;
}
function tag(text, kind) {
  return node('span', kind ? `tag tag-${kind}` : 'tag', text);
}
function kv(rows) {
  const dl = node('dl', 'kv');
  for (const [k, v] of rows) dl.append(node('dt', null, k), node('dd', null, v));
  return dl;
}
function evidenceLabel(state) {
  return EVIDENCE[state] ?? EVIDENCE.unverifiable;
}
// 비용은 요약에 「확인했는지」만 보여 주고, 금액과 근거는 상세에 둡니다. 서비스끼리 금액을 합치지 않습니다.
function costSummary(c) {
  if (c.state === 'ok' && c.amount != null) return `확인함 · ${c.basis}`;
  return `${evidenceLabel(c.state)} · 0원으로 보지 않음`;
}
// 닫힌 details 의 내용 안에 있는 요소인지 봅니다. summary 자체는 닫혀 있어도 보입니다.
function hiddenByDetails(el) {
  for (let d = el.closest('details'); d; d = d.parentElement ? d.parentElement.closest('details') : null) {
    if (!d.open && !(el.tagName === 'SUMMARY' && el.parentElement === d)) return true;
  }
  return false;
}

export function createStudentView({ api, onChange } = {}) {
  let pc = { status: 'idle' };
  let pcGeneration = 0;
  let showExample = false;
  let root = null;
  // 펼침 상태는 이 칸을 다시 그려도 유지합니다. 브라우저 저장소에는 남기지 않습니다.
  const openKeys = new Set();
  const changed = () => { if (typeof onChange === 'function') onChange(); };

  // 기존 studentApi.get 계약으로만 읽습니다. 0.2.18 후보는 이 경로를 읽기 전용으로 허용합니다.
  // 이전 판은 NOT_ALLOWED 를 돌려주고, 이 예제는 그것을 실패가 아닌 「지원 없음」으로 안내합니다.
  // 버튼을 누를 때만 부르고, 그리기(renderStatus)나 onChange 에서는 부르지 않습니다. 직접 fetch 하지 않습니다.
  async function probePc() {
    if (pc.status === 'loading') return;
    if (!api || typeof api.get !== 'function') { pc = { status: 'unsupported', code: 'NO_STUDENT_API' }; changed(); return; }
    const own = ++pcGeneration;
    pc = { status: 'loading' }; changed();
    let result;
    try { result = await api.get(PC_PATH); } catch { result = { ok: false, error: { code: 'CLIENT_ERROR' } }; }
    if (own !== pcGeneration) return;
    pc = classifyPc(result);
    changed();
  }

  function classifyPc(result) {
    if (!result || result.ok !== true) {
      const code = result?.error?.code ?? 'UNKNOWN_ERROR';
      if (code === 'NOT_ALLOWED') return { status: 'unsupported', code };
      return { status: 'failed', code };
    }
    const data = result.data;
    const measured = typeof data?.measuredAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(data.measuredAt) ? Date.parse(data.measuredAt) : NaN;
    if (data?.schema !== PC_SCHEMA || data.source !== 'local-pc' || !Number.isFinite(measured)) return { status: 'unverifiable', code: 'PC_SHAPE_UNVERIFIED' };
    if (Math.abs(Date.now() - measured) > PC_MAX_AGE_MS) return { status: 'stale', measuredAt: data.measuredAt };
    return { status: 'ok', measuredAt: data.measuredAt, metrics: data.metrics ?? {} };
  }

  // PC 값에서 「관찰」만 뽑습니다. 판정(악성코드 있음/안전함)을 만들지 않습니다.
  // 방화벽 세 프로필이 모두 켜진 것은 이상 징후가 아니므로 목록에 넣지 않습니다(제공 카드에서 봅니다).
  function pcSignals(metrics) {
    const out = [];
    const missing = [];
    const m = metrics.memory, c = metrics.cpu, d = metrics.disk, f = metrics.firewall, e = metrics.events;
    if (c?.state === 'ok' && isNum(c.usagePercent) && c.usagePercent <= 100 && c.sampleMs === 200) {
      if (c.usagePercent >= 90) out.push({ what: `CPU ${c.usagePercent.toFixed(1)}% (200ms 표본 1회)`, limit: '짧은 표본입니다. 어떤 프로그램인지, 계속되는지 확인해야 원인을 말할 수 있습니다.' });
    } else missing.push('CPU');
    if (m?.state === 'ok' && isNum(m.usedBytes) && isNum(m.totalBytes) && m.totalBytes > 0 && m.usedBytes <= m.totalBytes) {
      if (m.usedBytes / m.totalBytes >= 0.85) out.push({ what: `메모리 사용 ${gb(m.usedBytes)} / ${gb(m.totalBytes)}`, limit: '메모리 사용량만으로 악성코드를 판정하지 않습니다. 사용 중인 앱부터 확인합니다.' });
    } else missing.push('메모리');
    if (d?.state === 'ok' && isNum(d.freeBytes) && isNum(d.totalBytes) && d.totalBytes > 0 && d.freeBytes <= d.totalBytes) {
      if (d.freeBytes / d.totalBytes < 0.1) out.push({ what: `디스크 여유 ${gb(d.freeBytes)}`, limit: '공간 부족 관찰입니다. 삭제 전에 파일을 확인하고 백업합니다.' });
    } else missing.push('디스크');
    if (f?.state === 'ok' && Array.isArray(f.profiles) && f.profiles.length === 3 && ['Domain', 'Private', 'Public'].every(name => f.profiles.some(p => p?.name === name && typeof p.enabled === 'boolean'))) {
      const off = f.profiles.filter(p => !p.enabled).map(p => String(p.name));
      if (off.length) out.push({ what: `Windows 방화벽 꺼진 프로필: ${off.join(', ')}`, limit: '설정 관찰입니다. 앱은 설정을 바꾸지 않습니다.' });
    } else missing.push('Windows 방화벽');
    if (e?.state === 'ok' && isCount(e.warningCount) && isCount(e.errorCount) && e.warningCount + e.errorCount <= 5000 && e.sampleLimit === 5000 && typeof e.truncated === 'boolean') {
      if (e.errorCount > 0) out.push({ what: `최근 24시간 Windows 오류 기록 ${e.errorCount}건${e.truncated ? ' (일부 집계 · 부분 결과)' : ''}`, limit: '오류 건수는 침해 판정이 아닙니다. 기록 내용은 이 조회에 들어 있지 않습니다.' });
    } else missing.push('Windows 기록');
    return { signals: out, missing };
  }

  // 「조회 응답 성공」과 「개별 항목 실측 성공」을 나눕니다. 응답이 와도 항목을 하나도 못 읽었으면 성공으로 쓰지 않습니다.
  function pcCoverage() {
    if (pc.status !== 'ok') return null;
    const { signals, missing } = pcSignals(pc.metrics);
    const partialEvents = pc.metrics.events?.state === 'ok' && pc.metrics.events.truncated === true && !missing.includes('Windows 기록');
    return { signals, missing, measured: PC_ITEM_COUNT - missing.length, partialEvents };
  }
  function pcCoverageText(cov) {
    if (!cov.measured) return `조회 응답은 왔지만 관찰 대상 ${PC_ITEM_COUNT}개 모두 확인 불가(${cov.missing.join(', ')}) · 실측 0개`;
    const base = `조회 응답 성공 · 관찰 대상 실측 ${cov.measured}/${PC_ITEM_COUNT}`;
    const gaps = cov.missing.length ? ` · 확인 불가 ${cov.missing.length}개(${cov.missing.join(', ')})` : '';
    return base + gaps + (cov.partialEvents ? ' · Windows 기록 일부 집계(최대 5,000건)' : '');
  }

  // 이상 징후 근거 목록. PC 관찰과 (예시를 켰을 때만) 예시 서비스 관찰을 모읍니다.
  function collectAnomalies(cov) {
    const items = [];
    if (cov) {
      for (const s of cov.signals) items.push({ title: s.what, note: `출처 local-pc · ${kst(pc.measuredAt)} · ${s.limit}`, example: false });
    }
    if (showExample) {
      for (const name of SERVICES) {
        for (const s of EXAMPLES[name].security) if (s.state !== 'ok') {
          items.push({ title: `[예시] ${name} · ${s.item}: ${evidenceLabel(s.state)}`, note: `[예시] ${s.source} · ${kst(s.at)} · 근거가 부족하다는 뜻이며 위험 판정이 아닙니다.`, example: true });
        }
      }
    }
    return items;
  }

  // 기본 details/summary 를 씁니다. 키보드(Enter·Space)와 펼침 상태 전달은 브라우저에 맡기고 ARIA 를 덧붙이지 않습니다.
  function disclosure(key, className, summaryText) {
    const d = node('details', className);
    d.dataset.disclosureKey = key;
    d.open = openKeys.has(key);
    d.addEventListener('toggle', () => {
      if (!d.isConnected) return;
      if (d.open) openKeys.add(key); else openKeys.delete(key);
    });
    const s = node('summary');
    s.dataset.focusKey = key;
    s.append(node('span', 'item-title', summaryText));
    d.append(s);
    return d;
  }

  function renderOverview(anomalies, cov) {
    const box = node('section', 'event');
    box.append(node('h3', null, '지금 상태 요약'));
    // 관찰 0건은 안전 판정이 아닙니다. 확인하지 못한 PC 항목 수를 같이 보입니다.
    const pcGap = (cov?.missing.length ? ` · PC 항목 확인 불가 ${cov.missing.length}개` : '') + (cov?.partialEvents ? ' · Windows 기록 일부 집계' : '');
    let anomalyText;
    if (anomalies.length) anomalyText = `관찰 ${anomalies.length}건${pcGap} · 판정 아님 · 아래 「이상 징후 근거」를 펼쳐 확인합니다.`;
    else if (cov?.measured) anomalyText = `관찰 0건${pcGap} · 「이상 없음」 판정이 아닙니다.`;
    else anomalyText = `근거 없음${pcGap} · 확인 불가(「이상 없음」이 아닙니다).`;
    box.append(kv([
      ['내 PC', cov
        ? `${pcCoverageText(cov)}. 위쪽 「내 PC 상태」 카드에서도 확인합니다.`
        : '위쪽 「내 PC 상태」 카드에서 확인합니다. 같은 실측을 내 코드로 받아 보려면 「개발 참고」를 펼쳐 조회합니다. 이 칸은 스스로 다시 재지 않습니다.'],
      ['서비스', showExample
        ? '[예시] 4개 고정 예시를 보는 중 · 실제 연결 0개 · 실제 보안·취약점 조회 없음'
        : '4개 모두 연결 전 · 연결·비용·보안·취약점 확인 불가'],
      ['이상 징후', anomalyText],
      ['다음 행동', '서비스 1개를 골라 연결 전 화면부터 내 코드로 만듭니다.'],
    ]));
    box.append(node('p', 'muted', '참고 사례이며 자동 성취가 아닙니다. 접속 신뢰 근거를 보여 주는 모니터링 범위이고, 실제 차단·보안 인증이 아닙니다.'));
    return box;
  }

  function renderEvidenceDetail(name, ex) {
    const d = disclosure(`svc:${name}`, null, `[예시] ${name} 근거 보기 · 출처·시각·기간·크레딧·세금·취약점`);
    d.append(node('p', 'muted', '[예시] 아래 값은 화면 형식을 보여 주는 고정 예시입니다. 실제 계정·금액·조회 결과가 아닙니다.'));
    d.append(kv([
      ['연결', `${evidenceLabel(ex.connection.state)} · ${ex.connection.text} · ${kst(ex.connection.at)} · ${ex.connection.source}`],
      ['사용량', `${evidenceLabel(ex.usage.state)} · ${ex.usage.text} · 기간 ${ex.usage.period} · ${ex.usage.source}`],
    ]));

    const c = ex.cost;
    const cost = node('div', 'event-block');
    cost.append(node('h4', null, '월 비용 근거'));
    cost.append(kv([
      ['금액', c.amount == null ? '확인 불가 · 0원으로 표시하지 않음' : `[예시] ${c.amount} ${c.currency}`],
      ['청구월', c.billingMonth],
      ['통화', c.currency],
      ['집계 기간', c.period],
      ['실적/예상', c.basis],
      ['크레딧', c.credits],
      ['세금', c.tax],
      ['출처', c.source],
    ]));
    d.append(cost);

    const sec = node('div', 'event-block');
    sec.append(node('h4', null, '관측한 계정 보안 항목 · 종합 점수 없음'));
    if (!ex.security.length) sec.append(node('p', 'muted', '관측한 항목 없음 · 확인 불가'));
    else {
      const ul = node('ul');
      for (const s of ex.security) ul.append(node('li', null, `[예시] ${s.item}: ${s.observed} · ${evidenceLabel(s.state)} · ${s.source} · ${kst(s.at)}`));
      sec.append(ul);
    }
    d.append(sec);

    const v = ex.vulnerabilities;
    const vul = node('div', 'event-block');
    vul.append(node('h4', null, '취약점 근거'));
    vul.append(node('p', null, `[예시] ${evidenceLabel(v.state)} · ${v.text} · 범위 ${v.scope} · ${v.at ? kst(v.at) : '조회 시각 없음'} · ${v.source}`));
    vul.append(node('p', 'muted', v.state === 'ok'
      ? '「0건」은 적힌 정확한 버전·출처·시각·범위에만 해당합니다. 다른 패키지와 미조회 항목은 판단하지 않습니다.'
      : '조회하지 않았거나 인증에 실패한 결과는 안전 판정이 아닙니다.'));
    d.append(vul);
    return d;
  }

  // 예시 요약에서 보안 항목 중 확인 못 한 수와 취약점 조회 범위를 짧게 남깁니다. 종합 점수는 만들지 않습니다.
  function securitySummary(ex) {
    const sec = ex.security;
    const unseen = sec.filter(s => s.state !== 'ok').length;
    const secText = sec.length
      ? `보안 항목 ${sec.length}개 중 ${unseen ? `${unseen}개 확인 불가` : '모두 확인'}`
      : '보안 항목 관측 없음';
    const v = ex.vulnerabilities;
    return `${secText} · 취약점 ${evidenceLabel(v.state)}${v.state === 'ok' ? '(적힌 범위만)' : ''}`;
  }

  // 서비스마다 이름 · 실제/예시 표시 · 연결 상태 · 비용 · 보안·취약점 확인 여부를 요약에 항상 보입니다.
  function renderServiceItem(name) {
    const ex = showExample ? EXAMPLES[name] : null;
    const li = node('li', 'event');
    const head = node('div', 'event-head');
    head.append(node('span', 'item-title', name));
    head.append(ex ? tag('[예시] 실제 값 아님', 'demo') : tag('실제 연결 없음'));
    li.append(head);
    li.append(kv(ex ? [
      ['연결', `[예시] ${evidenceLabel(ex.connection.state)}`],
      ['사용량', `[예시] ${evidenceLabel(ex.usage.state)}`],
      ['월 비용', `[예시] ${costSummary(ex.cost)}`],
      ['보안·취약점', `[예시] ${securitySummary(ex)}`],
    ] : [
      ['연결', evidenceLabel('not_connected')],
      ['사용량', evidenceLabel('unverifiable')],
      ['월 비용', `${evidenceLabel('unverifiable')} · 0원으로 보지 않음`],
      ['보안·취약점', `${evidenceLabel('unverifiable')} · 「발견 없음」으로 보지 않음`],
    ]));
    if (ex) li.append(renderEvidenceDetail(name, ex));
    return li;
  }

  function renderServices() {
    const box = node('section', 'event');
    const head = node('div', 'event-head');
    head.append(node('h3', null, '서비스별 연결 · 사용량 · 비용'), tag('학생 구현 과제', 'student'));
    box.append(head);

    const actions = node('div', 'event-actions');
    const toggle = node('button', 'btn', showExample ? '예시 숨기기' : '예시 보기');
    toggle.type = 'button';
    toggle.dataset.focusKey = 'example-toggle';
    toggle.addEventListener('click', () => {
      showExample = !showExample;
      // 예시를 숨기면 예시 근거의 펼침 기억도 지웁니다. 다시 켜면 접힌 상태로 시작합니다.
      if (!showExample) for (const k of [...openKeys]) if (k.startsWith('svc:')) openKeys.delete(k);
      changed();
    });
    actions.append(toggle);
    box.append(actions);
    box.append(stateBox('empty', showExample
      ? '[예시] 고정 예시를 보는 중입니다. 실제 계정·금액·조회 결과가 아닙니다.'
      : '실제 연결 전 상태를 보는 중입니다. 화면 형식만 보려면 「예시 보기」를 누릅니다.', true));

    const list = node('ul', 'records');
    for (const name of SERVICES) list.append(renderServiceItem(name));
    box.append(list);

    if (showExample) box.append(node('p', 'muted', '서비스마다 청구월·통화·실적/예상이 달라 금액을 합치지 않습니다. 조회하지 않은 보안·취약점 항목은 안전이나 「발견 없음」이 아닙니다.'));
    else box.append(node('p', 'muted', '확인하지 않은 비용은 0원이 아니고, 조회하지 않은 취약점은 「발견 없음」이 아닙니다. 다음 행동: 서비스 1개의 연결을 서버 쪽에서 만듭니다. 키·토큰은 화면과 브라우저에 두지 않습니다.'));
    return box;
  }

  function renderAnomalies(data, anomalies, cov) {
    const gap = (cov?.missing.length ? ` · PC 확인 불가 ${cov.missing.length}개` : '') + (cov?.partialEvents ? ' · Windows 기록 일부 집계' : '');
    const d = disclosure('anomaly', 'event', `이상 징후 근거 · 관찰 ${anomalies.length}건${gap} · 판정 아님`);
    const modeText = { connected: '연결됨', demo: '예제 데이터(demo)', disconnected: '연결 없음' }[data?.mode] ?? '확인 불가';
    d.append(node('p', 'muted', `보안 서버 연결 표시(제공 자료): ${modeText}. 이 예제는 접속 허용·차단을 판단하지 않습니다.`));
    if (cov?.missing.length) d.append(node('p', 'muted', `이번 PC 조회에서 확인 불가: ${cov.missing.join(', ')}. 확인하지 못한 항목을 안전으로 보지 않습니다.`));
    if (anomalies.length) {
      const ul = node('ul', 'plain-list');
      for (const a of anomalies) {
        const li = node('li');
        const body = node('div');
        body.append(node('span', 'item-title', a.title), node('p', 'muted', a.note));
        li.append(body);
        if (a.example) li.append(tag('[예시]', 'demo'));
        ul.append(li);
      }
      d.append(ul);
    } else {
      let emptyText;
      if (cov?.measured) emptyText = `실측한 PC 항목 ${cov.measured}개에서 뽑은 관찰이 없습니다. 이것은 「이상 없음」 판정이 아닙니다.`;
      else if (cov) emptyText = '조회 응답은 왔지만 PC 항목을 하나도 실측하지 못했습니다(확인 불가). 「이상 없음」이 아닙니다.';
      else emptyText = '근거가 아직 없습니다(확인 불가). 다음 행동: 서비스 1개를 연결하거나, 위 「내 PC 상태」 카드의 값을 내 코드로 옮길 방법을 정합니다.';
      d.append(stateBox('empty', emptyText));
    }
    return d;
  }

  // 학생 API 로 PC 실측을 받아 보는 버튼은 학생의 첫 행동이 아니므로 개발 참고 안에 둡니다.
  function renderDeveloperNotes(cov) {
    const d = disclosure('dev', 'event', '개발 참고 · 내 코드로 PC 실측 받아 보기와 남은 과제');
    d.append(node('p', 'muted', `제공 카드 「내 PC 상태」와 같은 실측을 학생 확장 계약(studentApi.get)의 ${PC_PATH} 로 받아 봅니다. 누를 때만 한 번 읽고, 스스로 다시 읽지 않습니다. 받은 자료를 보여 주는 것만으로는 성취가 아닙니다.`));
    d.append(node('p', 'muted', '응답에는 네트워크 요약도 포함됩니다. 이 참고 화면은 CPU·메모리·디스크·Windows 방화벽·Windows 기록 5개를 관찰 집계에 쓰고, 네트워크 요약은 위쪽 「내 PC 상태」 카드에서 보여 줍니다.'));
    const actions = node('div', 'event-actions');
    const loading = pc.status === 'loading';
    const button = node('button', 'btn', loading ? '확인 중…' : '학생 API로 내 PC 실측 조회');
    button.type = 'button';
    button.dataset.focusKey = 'pc-probe';
    // disabled 로 바꾸면 누른 버튼에서 초점이 빠지므로, 진행 중에는 aria-disabled 로 알리고 클릭만 무시합니다.
    if (loading) button.setAttribute('aria-disabled', 'true');
    button.addEventListener('click', () => { void probePc(); });
    actions.append(button);
    d.append(actions);

    let result;
    if (pc.status === 'idle') result = stateBox('empty', '아직 조회하지 않았습니다(확인 불가). 조회하지 않은 상태를 정상으로 보지 않습니다.', true);
    else if (pc.status === 'loading') result = stateBox('loading', '조회 중…', true);
    else if (pc.status === 'unsupported') result = stateBox('empty', `${evidenceLabel('unsupported')}: 이 앱의 studentApi 는 ${PC_PATH} 를 허용하지 않습니다(${pc.code}). 이전 판 앱에서는 이렇게 나오는 것이 맞습니다. 위 「내 PC 상태」 카드에서 확인합니다. 이 예제는 다른 주소나 권한을 만들지 않습니다.`, true);
    else if (pc.status === 'failed') result = stateBox('error', `${evidenceLabel('failed')}: ${pc.code}. 이전 값을 현재 상태로 쓰지 않습니다. 다음 행동: 다시 시도하거나 「내 PC 상태」 카드를 봅니다.`, true);
    else if (pc.status === 'unverifiable') result = stateBox('empty', `${evidenceLabel('unverifiable')}: 응답 형식을 확인할 수 없습니다(${pc.code}). 정상으로 보지 않습니다.`, true);
    else if (pc.status === 'stale') result = stateBox('empty', `${evidenceLabel('stale')}: 측정 시각 ${kst(pc.measuredAt)} 이 1분보다 오래됐습니다. 다시 조회합니다.`, true);
    // 응답 형식이 맞아도 항목을 하나도 실측하지 못했으면 성공 상자로 그리지 않습니다.
    else result = stateBox(cov.measured ? 'ok' : 'empty', `${pcCoverageText(cov)} · 측정 ${kst(pc.measuredAt)} · 출처 local-pc`, true);
    d.append(result);
    if (cov?.missing.length) d.append(node('p', 'muted', `이번 조회에서 확인 불가: ${cov.missing.join(', ')}. 확인하지 못한 항목을 안전으로 보지 않습니다.`));

    const tasks = node('div', 'event-block');
    tasks.append(node('h4', null, '이 예제가 해결하지 않는 학생 구현 과제'));
    const ul = node('ul');
    for (const t of [
      '본인 로그인·기기·세션(정체성) 연결 — renderIdentity',
      '본인 접속·XDR 이벤트 연결 — renderEvents',
      '조치와 사람 확인·ACK — renderAction',
      '서비스 1개 실제 연결: 비밀값은 서버에만 두고 화면·브라우저에 저장하지 않기',
      '정확한 설치 버전으로 OSV 조회 (추후 학생 과제)',
    ]) ul.append(node('li', null, t));
    tasks.append(ul);
    d.append(tasks);
    return d;
  }

  // 앱은 이 칸을 그릴 때마다 내용을 통째로 바꿉니다. 바꾸기 직전 초점이 이 칸 안에 있었을 때만
  // 같은 조작부로 초점을 되돌립니다. 그사이 사용자가 다른 곳으로 옮겼으면 건드리지 않습니다.
  // 같은 동기 턴에 여러 번 다시 그려도 키를 잃지 않도록, 키는 클로저에 두고 마지막 root 에서 한 번만 씁니다.
  let pendingFocusKey = null;
  let focusQueued = false;
  const noFocus = el => !el || el === document.body || el === document.documentElement;

  function rememberFocus() {
    const active = document.activeElement;
    // 앞선 다시 그리기로 초점이 body 로 빠진 경우에는 이미 기억한 키를 그대로 둡니다.
    if (noFocus(active)) return;
    pendingFocusKey = root && root.contains(active) ? active.dataset?.focusKey ?? null : null;
  }

  // 대상이 닫힌 details 안에 있으면 그 안에 초점을 두지 않고, 보이는 가장 바깥 닫힌 details 의 summary 로 갑니다.
  function visibleFocusTarget(el) {
    if (!hiddenByDetails(el)) return el;
    let outer = null;
    for (let d = el.closest('details'); d; d = d.parentElement ? d.parentElement.closest('details') : null) {
      if (!d.open) outer = d;
    }
    const s = outer ? [...outer.children].find(c => c.tagName === 'SUMMARY') : null;
    return s && !hiddenByDetails(s) ? s : null;
  }

  function flushFocus() {
    focusQueued = false;
    const key = pendingFocusKey;
    pendingFocusKey = null;
    if (!key || !root?.isConnected) return;
    if (!noFocus(document.activeElement)) return;
    const found = root.querySelector(`[data-focus-key="${key}"]`);
    const target = found ? visibleFocusTarget(found) : null;
    if (target) target.focus({ preventScroll: true });
  }

  return {
    renderStatus(data) {
      if (typeof document !== 'undefined') rememberFocus();
      // toggle 이벤트보다 응답이 먼저 와도 현재 화면의 펼침 상태를 보존합니다.
      // 예시를 숨기는 동작은 이전 예시의 펼침 상태를 되살리지 않습니다.
      if (root?.isConnected) for (const d of root.querySelectorAll('details[data-disclosure-key]')) {
        const key = d.dataset.disclosureKey;
        if (key.startsWith('svc:') && !showExample || !d.open) openKeys.delete(key);
        else openKeys.add(key);
      }
      const cov = pcCoverage();
      const anomalies = collectAnomalies(cov);
      const next = node('div');
      const list = node('div', 'records');
      list.append(renderOverview(anomalies, cov), renderServices(), renderAnomalies(data, anomalies, cov), renderDeveloperNotes(cov));
      next.append(list);
      root = next;
      if (pendingFocusKey && !focusQueued) { focusQueued = true; queueMicrotask(flushFocus); }
      return next;
    },
    // 아래 칸은 학생 구현 과제로 그대로 둡니다(기존 student/extension.mjs 문구와 같음).
    renderIdentity() { return '학생 구현 대기: 실제 로그인·기기·세션 정보를 연결하세요.'; },
    renderDecision() { return '학생 구현 대기: 서버의 판정과 이유를 연결하세요.'; },
    renderEvents() { return '학생 구현 대기: 본인 접속·XDR 기록을 연결하세요.'; },
    renderVulnerabilities() { return '학생 구현 대기: 정확한 설치 버전·OSV 출처·조회 시각·부분 결과·조회 실패를 구분하세요.'; },
    renderAiConnection() { return '학생 구현 대기: 모델 응답 점검과 실제 사건 설명을 구분하고 AI 오류·취소·수동 복구를 안내하세요.'; },
    renderExplanation() { return '학생 구현 대기: 선택한 사건의 근거·규칙·현재 상태와 AI 설명을 연결하세요. 제안은 자동 실행하지 않습니다.'; },
    renderAction() { return '학생 구현 대기: 현재 사건·조치·실제 대상·사람 확인·ACK와 원천 효과·unknown을 구분하세요.'; },
  };
}
