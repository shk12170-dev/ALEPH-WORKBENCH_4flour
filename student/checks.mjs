// 점검 기록(작전실) 화면(학생 추가, /checks). GET /api/checks 결과만 보여 주고 숫자를 직접 만들지 않습니다.
// 합계는 받은 행으로 다시 세어 서버 합계와 다르면 표시하지 않습니다. 실패하면 이전 결과를 현재 결과로 남기지 않습니다.

export const TIMEOUT_MS = 30000;
const RESULT_LABELS = { match: '일치', mismatch: '불일치', unverified: '확인 불가', not_run: '미실행(not_run)' };
const SOURCE_LABELS = { http: 'HTTP 실측', not_run: '미실행' };
const SHA = /^[0-9a-f]{40}$/;

const clean = (v, fallback = '확인 불가') => (typeof v === 'string' && v.trim() ? v.replace(/[\r\n\t]+/gu, ' ').trim().slice(0, 200) : fallback);

export function countRows(rows) {
  const count = (result) => rows.filter((r) => r?.result === result).length;
  return { total: rows.length, match: count('match'), mismatch: count('mismatch'), unverified: count('unverified'), notRun: count('not_run') };
}

// 서버 응답을 검사합니다. 형식이 맞지 않거나 합계가 행과 다르면 이유를 돌려주고 화면에 결과를 그리지 않습니다.
export function validateChecks(data) {
  if (!data || typeof data !== 'object' || data.schema !== 'student.checks.v1') return { error: '응답 형식이 맞지 않습니다.' };
  if (!Array.isArray(data.executed) || !Array.isArray(data.notRun)) return { error: '사례 목록이 없습니다.' };
  if (data.notRun.some((r) => r?.result !== 'not_run')) return { error: '미실행 목록에 실행 결과가 섞여 있습니다.' };
  if (data.executed.some((r) => !['match', 'mismatch', 'unverified'].includes(r?.result))) return { error: '실행한 사례에 알 수 없는 결과가 있습니다.' };
  const counted = countRows([...data.executed, ...data.notRun]);
  const s = data.summary ?? {};
  if (['total', 'match', 'mismatch', 'unverified', 'notRun'].some((k) => s[k] !== counted[k])) return { error: '서버 합계와 행에서 센 합계가 다릅니다.' };
  return { data, counted };
}

export function mountChecksPage(root, env = {}) {
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
    return Number.isNaN(date.getTime()) ? '시각 확인 불가' : `${date.toLocaleString('ko-KR')} (${iso})`;
  };
  const state = { loading: false, result: null, error: '' };

  const panel = make('section', undefined, 'pc-panel');
  panel.append(make('h2', '점검 기록 · 사례별 실측'));
  panel.append(make('p', '값 출처: [내 PC에서 잰 값] · 이 PC의 앱 서버 자신에게만 요청합니다. 외부 서비스나 다른 사람의 앱에는 보내지 않고, 쓰기 요청도 보내지 않습니다.', 'pc-muted'));
  const actions = make('div', undefined, 'pc-actions');
  const run = make('button', '점검 실행', 'pc-btn pc-btn-primary');
  run.type = 'button';
  actions.append(run);
  const status = make('p', undefined, 'pc-summary');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const body = make('div', undefined, 'pc-checks-body');
  panel.append(actions, status, body);
  panel.append(make('p', '이 점검은 앱이 기대대로 응답하는지 대조한 것입니다. 보안 안전 판정이나 공식 과제 판정이 아닙니다. 공식 판정은 포털에서 따로 확인합니다.', 'pc-muted'));
  root.replaceChildren(panel);

  function card(title, value, sub, cardState) {
    const box = make('div', undefined, 'pc-card');
    box.dataset.state = cardState;
    box.append(make('p', title, 'pc-card-title'), make('p', value, 'pc-card-value'));
    if (sub) box.append(make('p', sub, 'pc-card-sub'));
    return box;
  }

  function table(headers, rows) {
    const t = make('table', undefined, 'pc-table');
    const head = make('thead');
    const tr = make('tr');
    for (const h of headers) tr.append(make('th', h));
    head.append(tr);
    const tbody = make('tbody');
    for (const cells of rows) {
      const row = make('tr');
      for (const cell of cells) {
        if (typeof cell === 'object' && cell) row.append(cell);
        else row.append(make('td', String(cell)));
      }
      tbody.append(row);
    }
    t.append(head, tbody);
    return t;
  }

  function badge(result) {
    const cell = make('td');
    const tag = make('span', RESULT_LABELS[result] ?? '확인 불가', 'pc-result');
    tag.dataset.result = result;
    cell.append(tag);
    return cell;
  }

  function draw() {
    run.disabled = state.loading;
    body.replaceChildren();
    if (state.loading) {
      status.textContent = '점검하는 중… (연결·기록 조회 때문에 몇 초 걸립니다)';
      return;
    }
    if (state.error) {
      status.textContent = '';
      body.append(card('점검 결과', '확인 불가', `이유: ${state.error} · 이전 결과는 현재 결과로 보여 주지 않습니다. 「점검 실행」을 다시 눌러 보세요.`, 'unavailable'));
      return;
    }
    if (!state.result) {
      status.textContent = '아직 점검하지 않았습니다. 「점검 실행」을 누르면 이 서버에 읽기 요청을 보내 대조합니다.';
      return;
    }
    const { data, counted } = state.result;
    status.textContent = `점검 완료 · ${timeText(data.finishedAt)}`;

    const meta = make('dl', undefined, 'pc-meta');
    const commit = SHA.test(data.commit ?? '') ? data.commit : '확인 불가';
    for (const [k, v] of [['측정 시작', timeText(data.startedAt)], ['측정 끝', timeText(data.finishedAt)], ['대상', clean(data.target)], ['실행 모드', clean(data.mode)], ['요청 방법', clean(data.method)], ['측정 커밋', `${commit} · ${clean(data.commitNote, '')}`]]) {
      meta.append(make('dt', k), make('dd', v));
    }
    body.append(meta);

    const cards = make('div', undefined, 'pc-cards pc-cards-5');
    cards.append(
      card('전체 사례', String(counted.total), '아래 두 표의 행 수', 'info'),
      card('일치', String(counted.match), '기대한 응답과 같음', 'ok'),
      card('불일치', String(counted.mismatch), counted.mismatch ? '아래 표에서 확인하세요' : '', counted.mismatch ? 'unavailable' : 'ok'),
      card('확인 불가', String(counted.unverified), '응답을 받지 못함', counted.unverified ? 'unavailable' : 'ok'),
      card('미실행', String(counted.notRun), '일치 합계에 넣지 않음', 'idle'),
    );
    body.append(cards);
    body.append(make('p', `전체 ${counted.total} = 일치 ${counted.match} + 불일치 ${counted.mismatch} + 확인 불가 ${counted.unverified} + 미실행 ${counted.notRun}. 이 숫자는 받은 행을 이 화면에서 다시 센 값이며 서버 합계와 같습니다.`, 'pc-muted'));

    body.append(make('h3', `실행한 사례 (${data.executed.length}건)`));
    body.append(table(['사례 ID', '영역', '기대 조건', '실제 관측', '결과', '출처', '참고'],
      data.executed.map((r) => [clean(r.id), clean(r.area), clean(r.expect), clean(r.observed), badge(r.result), SOURCE_LABELS[r.source] ?? '확인 불가', clean(r.note, '')])));
    body.append(make('h3', `실행하지 않은 사례 (${data.notRun.length}건)`));
    body.append(make('p', '실행하지 않은 사례는 실패도 성공도 아닙니다. 이유를 적고 일치 합계에서 뺍니다.', 'pc-muted'));
    body.append(table(['사례 ID', '영역', '결과', '이유'], data.notRun.map((r) => [clean(r.id), clean(r.area), badge(r.result), clean(r.reason)])));
  }

  async function runChecks() {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    state.result = null;
    draw();
    const controller = new AbortController();
    let timedOut = false;
    const deadline = setTimer(() => { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    try {
      const response = await fetchImpl('/api/checks', { headers: { accept: 'application/json' }, signal: controller.signal });
      const json = await response.json();
      if (!response.ok || !json || json.ok !== true) throw new Error(clean(json?.error?.message, `서버가 ${response.status}로 응답했습니다.`));
      const checked = validateChecks(json.data);
      if (checked.error) throw new Error(checked.error);
      state.result = checked;
    } catch (error) {
      state.error = timedOut ? '시간 초과로 결과를 받지 못했습니다.' : error instanceof TypeError ? '서버에 연결하지 못했습니다. 앱 폴더에서 npm start 로 서버를 켜 주세요.' : clean(error?.message, '결과를 읽지 못했습니다.');
    }
    clearTimer(deadline);
    state.loading = false;
    draw();
  }

  run.addEventListener('click', () => { void runChecks(); });
  draw();
  return { runChecks, state };
}

if (typeof document !== 'undefined' && typeof document.getElementById === 'function') {
  const root = document.getElementById('checks-app');
  if (root) mountChecksPage(root);
}
