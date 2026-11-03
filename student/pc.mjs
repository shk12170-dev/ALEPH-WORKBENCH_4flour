// 내 PC 점검 별도 화면(학생 추가, /pc). 기존 GET /api/pc-status, /api/pc-connection 만 씁니다.
// 기본은 「PC 상태 다시 조회」를 누를 때만 읽고, 「10초마다 자동 확인」을 켠 동안에만 반복합니다.
// 앞 조회가 끝난 뒤 10초를 세므로 겹치지 않고, 앱 탭이 안 보이면 멈춥니다.
// 읽지 못한 값은 0이나 예시 값으로 채우지 않고 확인 불가와 이유를 보여 줍니다. 값은 모두 [내 PC에서 잰 값]이며 보안 안전 판정이 아닙니다.

export const INTERVAL_MS = 10000;
export const TIMEOUT_MS = 20000;
export const HISTORY_MAX = 20;
export const TABLE_ROWS = 5;
const VALUE_MEASURED = '[내 PC에서 잰 값]';
const SOURCES = { pc: '/api/pc-status', conn: '/api/pc-connection' };
const ITEM_NAMES = { cpu: 'CPU', memory: '메모리', disk: '디스크', network: '네트워크', firewall: 'Windows 방화벽', system: 'Windows 기록(System)', application: 'Windows 기록(Application)' };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const clean = (v, fallback = '확인 불가') => (typeof v === 'string' && v.trim() ? v.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 120) : fallback);

function checkItem(item, valid) {
  if (!item || typeof item !== 'object' || item.status !== 'ok') {
    return { ok: false, reason: item && typeof item.reason === 'string' && item.reason ? clean(item.reason) : '서버가 값을 주지 않았습니다.' };
  }
  return valid(item) ? { ok: true, item } : { ok: false, reason: '응답 값이 올바르지 않습니다.' };
}

// pc·conn 은 { data } 또는 { error } 입니다. 일곱 항목을 각각 조회 성공·확인 불가로 나눕니다.
export function readItems(pc, conn) {
  const fromPc = (key) => (pc.error ? { status: 'unavailable', reason: pc.error } : pc.data?.[key]);
  const fromConn = (pick) => (conn.error ? { status: 'unavailable', reason: conn.error } : pick(conn.data));
  const counts = (i) => num(i.error) !== null && num(i.warning) !== null;
  return {
    cpu: checkItem(fromPc('cpu'), (i) => num(i.value) !== null),
    memory: checkItem(fromPc('memory'), (i) => num(i.usedGiB) !== null && num(i.totalGiB) !== null && num(i.percent) !== null),
    disk: checkItem(fromPc('disk'), (i) => num(i.freeGiB) !== null && num(i.totalGiB) !== null),
    network: checkItem(fromConn((d) => d?.network), (i) => Array.isArray(i.adapters)),
    firewall: checkItem(fromConn((d) => d?.firewall), (i) => Array.isArray(i.profiles) && i.profiles.length > 0),
    system: checkItem(fromConn((d) => d?.events?.system), counts),
    application: checkItem(fromConn((d) => d?.events?.application), counts),
  };
}

export function countItems(items) {
  const all = Object.values(items);
  const ok = all.filter((i) => i.ok).length;
  return { ok, failed: all.length - ok, total: all.length };
}

export function deltaText(now, before, unit) {
  if (now === null || before === null) return '이전 조회와 비교 불가';
  const diff = Math.round((now - before) * 10) / 10;
  return diff === 0 ? '이전 조회와 같음' : `이전 조회 대비 ${diff > 0 ? '+' : ''}${diff}${unit}`;
}

export function nextStep(reason) {
  if (/서버에 연결하지 못했습니다/.test(reason)) return '앱 폴더에서 npm start 로 서버를 켠 뒤 다시 조회하세요.';
  if (/시간 초과/.test(reason)) return '잠시 뒤 다시 조회하세요. 계속되면 다른 프로그램을 줄여 보세요.';
  if (/권한/.test(reason)) return '관리자 권한이 필요한 항목입니다. 앱은 설정을 바꾸지 않습니다.';
  return '「PC 상태 다시 조회」를 다시 눌러 보세요.';
}

const metric = (items, key, pick) => (items?.[key]?.ok ? pick(items[key].item) : null);

export function mountPcPage(root, env = {}) {
  const doc = env.doc ?? document;
  const fetchImpl = env.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  const setTimer = env.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = env.clearTimer ?? ((id) => clearTimeout(id));
  const make = (tag, text, className) => {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const timeText = (iso) => {
    const date = new Date(iso ?? NaN);
    return Number.isNaN(date.getTime()) ? '시각 확인 불가' : date.toLocaleString('ko-KR');
  };
  const clockText = (iso) => {
    const date = new Date(iso ?? NaN);
    return Number.isNaN(date.getTime()) ? '시각 확인 불가' : date.toLocaleTimeString('ko-KR');
  };

  const state = { loading: false, last: null, prev: null, history: [], auto: false, controller: null, cancelled: false, timer: null, note: '' };

  // ---- 화면 뼈대 ----
  const panel = make('section', undefined, 'pc-panel');
  panel.append(make('h2', '내 PC 상태 · 마지막 조회'));
  panel.append(make('p', `값 출처: ${VALUE_MEASURED} · 이 PC에서 일반 권한으로 읽기만 합니다. 설정은 바꾸지 않습니다. 보안 서버(SDP) 연결 상태는 따로 표시합니다.`, 'pc-muted'));
  const actions = make('div', undefined, 'pc-actions');
  const refresh = make('button', 'PC 상태 다시 조회', 'pc-btn pc-btn-primary');
  refresh.type = 'button';
  const cancel = make('button', 'PC 조회 취소', 'pc-btn');
  cancel.type = 'button';
  cancel.disabled = true;
  const autoLabel = make('label', undefined, 'pc-auto');
  const auto = make('input');
  auto.type = 'checkbox';
  autoLabel.append(auto, make('span', '10초마다 자동 확인 (앱 탭이 보이는 동안)'));
  actions.append(refresh, cancel, autoLabel);
  const summary = make('p', undefined, 'pc-summary');
  summary.setAttribute('role', 'status');
  const sdp = make('p', undefined, 'pc-sdp');
  const resourceCards = make('div', undefined, 'pc-cards pc-cards-4');
  const connCards = make('div', undefined, 'pc-cards pc-cards-3');
  const table = make('table', undefined, 'pc-table');
  panel.append(actions, summary, sdp, resourceCards);
  panel.append(make('h3', '연결·Windows 기록'), connCards);
  panel.append(make('h3', '조회 추이'));
  panel.append(make('p', `이 화면에서 읽은 최근 ${HISTORY_MAX}회만 브라우저 메모리에 보관하고 ${TABLE_ROWS}회를 보여 줍니다. 새로고침하면 사라지며 지속 감시 자료가 아닙니다.`, 'pc-muted'));
  panel.append(table);
  panel.append(make('p', 'CPU는 약 0.5초 순간값이라 조회마다 크게 달라질 수 있습니다. 오류·경고 건수는 시스템 기록의 개수일 뿐 침해 판정이 아닙니다.', 'pc-muted'));
  root.replaceChildren(panel);

  // ---- 칸 그리기 ----
  function card(title, value, lines, cardState, extra) {
    const box = make('div', undefined, 'pc-card');
    box.dataset.state = cardState;
    box.append(make('p', title, 'pc-card-title'), make('p', value, 'pc-card-value'));
    if (extra) box.append(extra);
    for (const line of lines) if (line) box.append(make('p', line, 'pc-card-sub'));
    return box;
  }

  function itemCard(title, key, okRender) {
    const items = state.last?.items;
    if (!items) return card(title, state.loading ? '읽는 중…' : '아직 조회하지 않음', [], 'idle');
    const result = items[key];
    if (!result.ok) return card(title, '확인 불가', [`이유: ${result.reason}`, `다음에 할 일: ${nextStep(result.reason)}`], 'unavailable');
    const [value, lines, extra] = okRender(result.item);
    return card(title, value, lines, 'ok', extra);
  }

  function listBox(lines) {
    const list = make('ul', undefined, 'pc-card-list');
    for (const line of lines) list.append(make('li', line));
    return list;
  }

  function drawCards() {
    const last = state.last;
    const prevItems = state.prev?.items;
    const pcAt = last?.pc.data?.measuredAt;
    const connAt = last?.conn.data?.measuredAt;
    const cpuCard = itemCard('CPU 사용률', 'cpu', (i) => [`${i.value} %`, [`약 ${num(i.windowMs) ?? '?'}ms 동안 평균`, deltaText(i.value, metric(prevItems, 'cpu', (p) => p.value), '%p'), `측정 시각 ${timeText(pcAt)}`]]);
    const memoryCard = itemCard('메모리 사용량', 'memory', (i) => [`${i.usedGiB} GiB`, [`전체 ${i.totalGiB} GiB · ${i.percent} %`, deltaText(i.percent, metric(prevItems, 'memory', (p) => p.percent), '%p'), `측정 시각 ${timeText(pcAt)}`]]);
    const diskCard = itemCard('디스크 여유 공간', 'disk', (i) => [`${i.freeGiB} GiB`, [`앱 폴더가 있는 드라이브 · 전체 ${i.totalGiB} GiB`, deltaText(i.freeGiB, metric(prevItems, 'disk', (p) => p.freeGiB), ' GiB'), `측정 시각 ${timeText(pcAt)}`]]);
    let statusCard;
    if (!last) statusCard = card('조회 상태', state.loading ? '읽는 중…' : '- / 7', ['아직 조회하지 않았습니다.'], 'idle');
    else {
      const c = countItems(last.items);
      statusCard = card('조회 상태', `${c.ok} / ${c.total}`, [`확인 불가 ${c.failed}개`, '실제 로컬 조회 · 보안 안전 판정이 아닙니다.'], c.failed ? 'unavailable' : 'info');
    }
    resourceCards.replaceChildren(cpuCard, memoryCard, diskCard, statusCard);

    const network = itemCard('네트워크', 'network', (i) => {
      const up = i.adapters.filter((a) => a?.connected === true).length;
      const list = listBox(i.adapters.map((a) => `${clean(a?.name, '이름 없음')} · ${clean(a?.kind, '종류 확인 불가')} · ${a?.connected === true ? '연결됨' : a?.connected === false ? '연결 안 됨' : '확인 불가'}`));
      return [`연결됨 ${up} / 전체 ${i.adapters.length}`, ['어댑터 이름·종류·연결 여부만 읽습니다. IP 주소는 읽지 않으며, 인터넷 접속이나 ZTNA 허용을 확인한 결과가 아닙니다.', `측정 시각 ${timeText(connAt)}`], list];
    });
    const firewall = itemCard('Windows 방화벽', 'firewall', (i) => {
      const on = i.profiles.filter((p) => p?.enabled === true).length;
      return [`켜짐 ${on} / ${i.profiles.length}`, [i.profiles.map((p) => `${clean(p?.name, '이름 없음')} ${p?.enabled === true ? '켜짐' : p?.enabled === false ? '꺼짐' : '확인 불가'}`).join(' · '), '읽기만 함(바꾸지 않음) · 보호 전체의 안전 판정이 아닙니다.', `측정 시각 ${timeText(connAt)}`]];
    });
    connCards.replaceChildren(network, firewall, recordsCard(connAt));
  }

  function recordsCard(connAt) {
    const items = state.last?.items;
    if (!items) return card('Windows 기록(최근 24시간)', state.loading ? '읽는 중…' : '아직 조회하지 않음', [], 'idle');
    const { system, application } = items;
    if (!system.ok && !application.ok) return card('Windows 기록(최근 24시간)', '확인 불가', [`이유: ${system.reason}`, `다음에 할 일: ${nextStep(system.reason)}`], 'unavailable');
    const line = (name, r) => (r.ok ? `${name}: 오류 ${r.item.error}건 · 경고 ${r.item.warning}건` : `${name}: 확인 불가 · 이유: ${r.reason}`);
    const okOnes = [system, application].filter((r) => r.ok);
    const errors = okOnes.reduce((sum, r) => sum + r.item.error, 0);
    const warnings = okOnes.reduce((sum, r) => sum + r.item.warning, 0);
    const value = `오류 ${errors} · 경고 ${warnings}${okOnes.length < 2 ? ' (일부만)' : ''}`;
    return card('Windows 기록(최근 24시간)', value, [line('System', system), line('Application', application), '시스템이 남긴 기록의 개수입니다. 침해 판정이 아닙니다.', `측정 시각 ${timeText(connAt)}`], okOnes.length < 2 ? 'unavailable' : 'ok');
  }

  function bar(value) {
    const cell = make('td');
    if (value === null) { cell.textContent = '확인 불가'; return cell; }
    cell.append(make('span', `${value} %`, 'pc-bar-text'));
    const track = make('span', undefined, 'pc-bar');
    const fill = make('span', undefined, 'pc-bar-fill');
    if (fill.style) fill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    track.append(fill);
    cell.append(track);
    return cell;
  }

  function drawTable() {
    const head = make('thead');
    const headRow = make('tr');
    for (const label of ['조회 시각', '방식', 'CPU (%)', '메모리 (%)', '디스크 여유 (GiB)']) headRow.append(make('th', label));
    head.append(headRow);
    const body = make('tbody');
    if (state.history.length === 0) {
      const row = make('tr');
      const cell = make('td', '아직 조회 기록이 없습니다.');
      cell.colSpan = 5;
      row.append(cell);
      body.append(row);
    }
    for (const entry of state.history.slice(0, TABLE_ROWS)) {
      const row = make('tr');
      row.append(make('td', clockText(entry.at)), make('td', entry.mode), bar(entry.cpu), bar(entry.memory), make('td', entry.disk === null ? '확인 불가' : String(entry.disk)));
      body.append(row);
    }
    table.replaceChildren(head, body);
  }

  function drawSummary() {
    const last = state.last;
    const lastText = last ? `${last.mode} 조회 ${timeText(last.at)}` : '';
    if (state.loading) summary.textContent = `이 PC에서 읽는 중… (네트워크·방화벽·기록은 몇 초 더 걸립니다)${last ? ` · 아래 값은 마지막 ${lastText} 결과입니다.` : ''}`;
    else if (state.note) summary.textContent = state.note;
    else if (!last) summary.textContent = '아직 조회하지 않았습니다. 「PC 상태 다시 조회」를 누르거나 「10초마다 자동 확인」을 켜세요.';
    else {
      const c = countItems(last.items);
      summary.textContent = `마지막 ${lastText} · ${c.total}개 항목 중 ${c.ok}개 조회, ${c.failed}개 확인 불가${state.auto ? ' · 10초 뒤 다시 확인합니다' : ''}`;
    }
    summary.setAttribute('aria-live', state.auto ? 'off' : 'polite');
    const info = last?.conn.data?.sdp;
    if (info && typeof info.label === 'string') {
      sdp.textContent = `${clean(info.label)} · ${clean(info.reason, '이유 확인 불가')} · 이 PC의 로컬 조회 결과와 별개입니다.`;
      sdp.dataset.state = 'shown';
    } else {
      sdp.textContent = 'SDP 연결 상태: 아직 확인하지 않음(연결·기록 조회 때 함께 표시합니다). PC 조회 결과와 별개입니다.';
      sdp.dataset.state = 'idle';
    }
  }

  function draw() {
    refresh.disabled = state.loading;
    cancel.disabled = !state.loading;
    auto.checked = state.auto;
    drawSummary();
    drawCards();
    drawTable();
  }

  // ---- 조회 ----
  async function fetchOne(url, signal) {
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' }, signal });
      const body = await response.json();
      if (!response.ok || !body || body.ok !== true || !body.data || typeof body.data !== 'object') {
        return { error: clean(body?.error?.message, `서버가 ${response.status}로 응답했습니다.`) };
      }
      return { data: body.data };
    } catch (error) {
      if (error?.name === 'AbortError') return { aborted: true };
      return { error: error instanceof TypeError ? '서버에 연결하지 못했습니다.' : '응답을 읽지 못했습니다.' };
    }
  }

  function stopTimer() {
    if (state.timer !== null) clearTimer(state.timer);
    state.timer = null;
  }

  function schedule() {
    stopTimer();
    if (state.auto && !doc.hidden) state.timer = setTimer(() => { state.timer = null; void read('자동'); }, INTERVAL_MS);
  }

  async function read(mode) {
    if (state.loading || doc.hidden) return;
    stopTimer();
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimer(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    state.controller = controller;
    state.cancelled = false;
    state.loading = true;
    state.note = '';
    draw();
    const [pc, conn] = await Promise.all([fetchOne(SOURCES.pc, controller.signal), fetchOne(SOURCES.conn, controller.signal)]);
    clearTimer(deadline);
    state.loading = false;
    state.controller = null;
    if (state.cancelled) {
      const last = state.last;
      state.note = last
        ? `이번 조회를 취소했습니다. 자동 확인도 껐습니다. 아래 값은 ${timeText(last.at)}에 잰 값입니다.`
        : '조회를 취소했습니다. 아직 잰 값이 없습니다.';
      draw();
      return;
    }
    const timeout = { error: '시간 초과로 읽지 못했습니다.' };
    const pcResult = pc.aborted ? (timedOut ? timeout : { error: '조회가 중단됐습니다.' }) : pc;
    const connResult = conn.aborted ? (timedOut ? timeout : { error: '조회가 중단됐습니다.' }) : conn;
    const items = readItems(pcResult, connResult);
    const at = pcResult.data?.measuredAt ?? connResult.data?.measuredAt ?? new Date().toISOString();
    if (state.last) state.prev = state.last;
    state.last = { pc: pcResult, conn: connResult, items, at, mode };
    state.history.unshift({
      at, mode,
      cpu: metric(items, 'cpu', (i) => i.value),
      memory: metric(items, 'memory', (i) => i.percent),
      disk: metric(items, 'disk', (i) => i.freeGiB),
    });
    if (state.history.length > HISTORY_MAX) state.history.length = HISTORY_MAX;
    draw();
    schedule();
  }

  refresh.addEventListener('click', () => { void read('수동'); });
  cancel.addEventListener('click', () => {
    if (!state.loading) return;
    state.cancelled = true;
    state.auto = false;
    stopTimer();
    state.controller?.abort();
  });
  auto.addEventListener('change', () => {
    state.auto = auto.checked;
    if (state.auto) void read('자동');
    else { stopTimer(); draw(); }
  });
  if (typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', () => {
      if (!state.auto) return;
      if (doc.hidden) stopTimer();
      else void read('자동');
    });
  }
  draw();
  return { read, state };
}

if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  const root = document.getElementById('pc-app');
  if (root) mountPcPage(root);
}
