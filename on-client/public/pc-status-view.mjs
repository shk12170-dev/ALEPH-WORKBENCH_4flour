// 이 PC의 조회 결과만 표시한다. SDP 연결 표시·AI 입력·원격 전송과 독립적이다.
const REASONS = {
  permission_denied: '읽기 권한이 없습니다. 관리자 권한으로 바꾸기 전에 담당자에게 확인하세요.',
  unsupported: '이 운영체제에서는 이 항목을 조회하지 않습니다.',
  timeout: '조회 시간이 초과됐습니다. 잠시 후 다시 확인하세요.',
};
const bytes = n => `${(n / 1024 ** 3).toFixed(1)} GB`;
const number = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const percent = n => number(n) && n <= 100;
const counter = n => Number.isSafeInteger(n) && n >= 0;

export function pcMetricText(key, metric) {
  if (metric?.state !== 'ok') return {text: '확인 불가', note: REASONS[metric?.reason] ?? '이번 조회에서 값을 확인하지 못했습니다. 다시 확인해 주세요.', state: 'unavailable'};
  let text, note;
  if (key === 'cpu' && percent(metric.usagePercent)) {
    text = `${metric.usagePercent.toFixed(1)}% 사용`; note = '짧은 구간의 실측값입니다. 계속 높으면 사용 중인 앱을 확인하세요.';
  } else if (key === 'memory' && number(metric.usedBytes) && number(metric.totalBytes) && metric.totalBytes > 0 && metric.usedBytes <= metric.totalBytes) {
    text = `${bytes(metric.usedBytes)} / ${bytes(metric.totalBytes)}`; note = metric.usedBytes / metric.totalBytes >= .85 ? '메모리 사용량이 높습니다. 필요한 작업을 저장하고 사용 중인 앱을 확인하세요.' : '사용 중인 메모리와 전체 메모리입니다.';
  } else if (key === 'disk' && number(metric.freeBytes) && number(metric.totalBytes) && metric.totalBytes > 0 && metric.freeBytes <= metric.totalBytes) {
    text = `${bytes(metric.freeBytes)} 여유 / ${bytes(metric.totalBytes)}`; note = metric.freeBytes / metric.totalBytes < .1 ? '남은 공간이 적습니다. 삭제하기 전에 파일을 확인하고 백업하세요.' : '현재 앱이 있는 디스크의 여유 공간입니다.';
  } else if (key === 'network' && counter(metric.interfaceCount) && counter(metric.ipv4Count)) {
    text = `네트워크 인터페이스 ${metric.interfaceCount}개 · IPv4 구성 ${metric.ipv4Count}개`; note = '로컬 구성 요약입니다. 인터넷 접속이나 ZTNA 허용을 확인한 결과는 아닙니다.';
  } else if (key === 'firewall' && Array.isArray(metric.profiles) && metric.profiles.length === 3 && ['Domain', 'Private', 'Public'].every(name => metric.profiles.some(p => p.name === name && typeof p.enabled === 'boolean'))) {
    text = metric.profiles.map(p => `${p.name} ${p.enabled ? '켜짐' : '꺼짐'}`).join(' · '); note = 'Windows 방화벽 설정을 읽었습니다. 앱이 설정을 바꾸지 않습니다. 보호 전체의 안전 판정은 아닙니다.';
  } else if (key === 'events' && counter(metric.warningCount) && counter(metric.errorCount) && metric.warningCount + metric.errorCount <= 5000 && metric.sampleLimit === 5000 && typeof metric.truncated === 'boolean') {
    text = `최근 24시간 경고 ${metric.warningCount}건 · 오류 ${metric.errorCount}건${metric.truncated ? ' (일부 집계)' : ''}`; note = 'System·Application 기록을 최대 5,000건까지 읽습니다. 오류 건수는 침해 사고 판정이 아닙니다.';
  }
  return text ? {text, note, state: 'measured'} : {text: '확인 불가', note: '응답의 값이나 단위를 확인할 수 없습니다. 정상으로 판단하지 마세요.', state: 'unavailable'};
}

export function mountPcStatus(host, {fetchImpl = globalThis.fetch?.bind(globalThis), intervalMs = 10000, timeoutMs = 10000} = {}) {
  const doc = host.ownerDocument, win = doc.defaultView;
  const make = (tag, text, cls) => {const node = doc.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node;};
  const heading = make('h2', '내 PC 상태');
  const intro = make('p', '이 앱을 실행한 PC의 값을 읽습니다. 제공된 조회 기능이며 학생 구현 성취와 구분합니다. 이 결과는 AI나 외부 서버로 자동 전송하지 않습니다.', 'muted');
  const refresh = make('button', '내 PC 확인', 'btn'); refresh.type = 'button';
  const label = make('label', '', 'pc-auto'); const auto = doc.createElement('input'); auto.type = 'checkbox';
  label.append(auto, doc.createTextNode(' 10초마다 확인 (앱 탭이 보이는 동안)'));
  const status = make('p', '아직 조회하지 않았습니다.', 'muted'); status.setAttribute('role', 'status');
  const grid = make('div', '', 'pc-metrics');
  const rows = new Map();
  for (const [key, title] of Object.entries({cpu: 'CPU', memory: '메모리', disk: '디스크', network: '네트워크', firewall: 'Windows 방화벽', events: 'Windows 기록'})) {
    const article = make('article', '', 'pc-metric'), value = make('p', '아직 조회하지 않음', 'pc-value'), note = make('p', '', 'muted');
    article.append(make('h3', title), value, note); grid.append(article); rows.set(key, {article, value, note});
  }
  host.replaceChildren(heading, intro, refresh, label, status, grid);
  let disposed = false, controller = null, generation = 0, timer = null;
  function stopTimer() {if (timer !== null) win.clearTimeout(timer); timer = null;}
  function next() {stopTimer(); if (!disposed && auto.checked && !doc.hidden) timer = win.setTimeout(() => {void read();}, Math.max(10000, intervalMs));}
  function unavailable() {for (const row of rows.values()) {row.article.dataset.state = 'unavailable'; row.value.textContent = '이번 조회 확인 불가'; row.note.textContent = '이전 값을 현재 상태로 표시하지 않습니다.';}}
  async function read() {
    if (disposed || doc.hidden) return;
    stopTimer(); controller?.abort(); const own = ++generation, abort = new AbortController(); controller = abort;
    refresh.disabled = true; status.textContent = '이 PC에서 읽는 중…';
    let timedOut = false;
    const deadline = win.setTimeout(() => {timedOut = true; abort.abort();}, timeoutMs);
    try {
      const stopped = new Promise((_, reject) => abort.signal.addEventListener('abort', () => reject(Error('cancelled')), {once: true}));
      const result = await Promise.race([Promise.resolve().then(async () => {
        const response = await fetchImpl('/api/pc/status', {cache: 'no-store', signal: abort.signal});
        if (!response.ok) throw Error('failed'); return response.json();
      }), stopped]);
      if (disposed || own !== generation) return;
      const data = result?.ok === true ? result.data : null;
      const measured = typeof data?.measuredAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(data.measuredAt) ? Date.parse(data.measuredAt) : NaN;
      if (data?.schema !== 'aleph.on.pc-status.v1' || data.source !== 'local-pc' || !Number.isFinite(measured) || Math.abs(Date.now() - measured) > 60000) throw Error('stale');
      for (const [key, row] of rows) {
        const info = pcMetricText(key, data.metrics?.[key]);
        row.article.dataset.state = info.state; row.value.textContent = info.text; row.note.textContent = info.note;
      }
      status.textContent = `이 PC 마지막 실측 · ${new Date(measured).toLocaleString('ko-KR')} · 보안 서버 연결 상태와 별도`;
    } catch {
      if (disposed || own !== generation) return;
      unavailable(); status.textContent = timedOut ? REASONS.timeout : '이번 상태를 확인하지 못했습니다. 앱이 실행 중인지 확인하고 다시 조회하세요.';
    } finally {
      win.clearTimeout(deadline);
      if (!disposed && own === generation) {controller = null; refresh.disabled = false; next();}
    }
  }
  const visibility = () => {
    if (doc.hidden) {stopTimer(); generation++; controller?.abort(); controller = null; refresh.disabled = false; unavailable(); status.textContent = '화면을 보지 않는 동안 자동 확인을 멈췄습니다.';}
    else if (auto.checked) void read();
  };
  refresh.addEventListener('click', read);
  const onAuto = () => {if (auto.checked) void read(); else stopTimer();}; auto.addEventListener('change', onAuto);
  doc.addEventListener('visibilitychange', visibility);
  const dispose = () => {if (disposed) return; disposed = true; generation++; stopTimer(); controller?.abort(); refresh.removeEventListener('click', read); auto.removeEventListener('change', onAuto); doc.removeEventListener('visibilitychange', visibility); win.removeEventListener('pagehide', dispose);};
  win.addEventListener('pagehide', dispose, {once: true});
  return {read, dispose};
}
