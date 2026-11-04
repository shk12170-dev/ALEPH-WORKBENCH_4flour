// 연습 경보 시연 화면(학생 추가, /practice). GET /api/practice-alerts 결과만 보여 줍니다.
// 모든 값은 [예시 화면 · 설명용 값]입니다. 합계는 모듈 행으로 다시 세어 서버 합계와 다르면 그리지 않습니다.

export const TIMEOUT_MS = 20000;
const ACTIONS = ['block', 'alert', 'record'];
const ACTION_LABELS = { block: '차단 수준(block)', alert: '알림(alert)', record: '기록만(record)' };

const clean = (v, fallback = '확인 불가') => (typeof v === 'string' && v.trim() ? v.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 300) : fallback);

export function validatePractice(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.modules)) return { error: '응답 형식이 맞지 않습니다.' };
  const ok = data.modules.filter((m) => m?.status === 'ok');
  if (ok.some((m) => !Array.isArray(m.rows) || ACTIONS.some((a) => m.counts?.[a] !== m.rows.filter((r) => r?.action === a).length))) {
    return { error: '모듈 합계와 행에서 센 합계가 다릅니다.' };
  }
  const counted = Object.fromEntries(ACTIONS.map((a) => [a, ok.reduce((n, m) => n + m.counts[a], 0)]));
  const total = ok.reduce((n, m) => n + m.rows.length, 0);
  if (ACTIONS.some((a) => data.counts?.[a] !== counted[a]) || data.total !== total) return { error: '서버 합계와 행에서 센 합계가 다릅니다.' };
  return { data, counted, total, ok };
}

export function mountPracticePage(root, env = {}) {
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
  const state = { loading: false };

  const panel = make('section', undefined, 'pc-panel');
  panel.append(make('h2', '연습 경보 시연 · 위험 판단'));
  panel.append(make('p', '값 출처: [예시 화면 · 설명용 값] · 공식 연습 경보 6종을 방어전 보너스 판단 모듈(xdr-01~06)에 넣은 계산 결과입니다. 이 PC의 실제 로그를 읽지 않고, 어떤 조치도 실행하지 않습니다.', 'pc-muted'));
  const actions = make('div', undefined, 'pc-actions');
  const run = make('button', '연습 경보 판단 실행', 'pc-btn pc-btn-primary');
  run.type = 'button';
  actions.append(run);
  const status = make('p', undefined, 'pc-summary');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = make('div', undefined, 'pc-practice-body');
  panel.append(actions, status, body);
  panel.append(make('p', '「차단 수준」은 판단 결과일 뿐 실제로 차단하지 않았습니다. 한 가지 단서만으로는 차단 수준으로 올리지 않는 규칙을 모듈이 따릅니다. 실제 위험 탐지와 조치 집행은 이 앱에서 되지 않습니다(연결 없음).', 'pc-muted'));
  root.replaceChildren(panel);

  function card(title, value, sub) {
    const c = make('div', undefined, 'pc-card');
    c.dataset.state = 'info';
    c.append(make('p', title, 'pc-card-title'), make('p', value, 'pc-card-value'), make('p', sub, 'pc-card-sub'));
    return c;
  }

  function render(checked) {
    const { data, counted, total, ok } = checked;
    const cards = make('div', undefined, 'pc-cards pc-cards-4');
    cards.append(card('판단한 연습 경보', `${total}건`, `모듈 ${ok.length}/${data.modules.length}개 읽음`));
    for (const a of ACTIONS) cards.append(card(ACTION_LABELS[a], `${counted[a]}건`, '[예시 화면 · 설명용 값]'));
    const all = data.vaultMatch === data.vaultTotal && data.vaultTotal === total;
    const match = make('p', `vault 보너스 결과와 판단 일치: ${data.vaultMatch}/${data.vaultTotal}건 ${all ? '(전부 일치)' : '(다릅니다. 일치로 세지 않습니다)'}`, 'pc-muted');
    const table = make('table', undefined, 'pc-table');
    const head = make('tr');
    ['모듈', '경보 수', 'block', 'alert', 'record', '상태'].forEach((t) => head.append(make('th', t)));
    table.append(head);
    for (const m of data.modules) {
      const tr = make('tr');
      if (m.status === 'ok') [m.label, `${m.total}건`, `${m.counts.block}`, `${m.counts.alert}`, `${m.counts.record}`, '읽음'].forEach((t) => tr.append(make('td', t)));
      else [clean(m.label), '확인 불가', '-', '-', '-', `읽지 못함 (${clean(m.code)})`].forEach((t) => tr.append(make('td', t)));
      table.append(tr);
    }
    body.replaceChildren(cards, match, make('h3', '모듈별 합계'), table);
    for (const m of ok) {
      const details = make('details');
      details.append(make('summary', `${m.label} · 경보별 판단 이유 ${m.rows.length}건`));
      const t = make('table', undefined, 'pc-table');
      const h = make('tr');
      ['경보', '수준', '판단', '신뢰도', '이유(패턴 · MITRE)'].forEach((x) => h.append(make('th', x)));
      t.append(h);
      for (const r of m.rows) {
        const tr = make('tr');
        [clean(r.alertId), String(r.level ?? '-'), ACTION_LABELS[r.action] ?? '확인 불가', String(r.confidence), clean(r.reason)].forEach((x) => tr.append(make('td', x)));
        t.append(tr);
      }
      details.append(t);
      body.append(details);
    }
  }

  async function load() {
    if (state.loading) return;
    state.loading = true;
    run.disabled = true;
    status.textContent = '연습 경보를 판단하는 중입니다…';
    body.replaceChildren(); // 실패하면 이전 결과를 남기지 않습니다.
    const controller = new AbortController();
    const timer = setTimer(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl('/api/practice-alerts', { signal: controller.signal, headers: { accept: 'application/json' } });
      const json = await res.json();
      if (!res.ok || json?.ok !== true) throw new Error(clean(json?.error?.code, `HTTP ${res.status}`));
      const checked = validatePractice(json.data);
      if (checked.error) throw new Error(checked.error);
      render(checked);
      status.textContent = `계산 완료 · ${checked.total}건 [예시 화면 · 설명용 값]`;
    } catch (error) {
      status.textContent = `확인 불가 · ${clean(error?.message)} · 서버가 켜져 있는지 확인하고 다시 실행하세요.`;
    } finally {
      clearTimer(timer);
      state.loading = false;
      run.disabled = false;
    }
  }
  run.addEventListener('click', load);
  return { load };
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('practice-app');
  if (root) mountPracticePage(root).load();
}
