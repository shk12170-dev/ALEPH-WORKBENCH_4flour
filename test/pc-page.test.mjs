// 내 PC 점검 화면(student/pc.mjs)을 점검합니다(모의 DOM·가짜 시계, 실제 화면 확인이 아님).
const make = tag => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, style: {}, className: '', _text: '', checked: false, disabled: false,
  set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text; },
  append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
  setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } });
const docListeners = {};
const doc = { createElement: make, hidden: false, addEventListener(t, f) { docListeners[t] = f; } };

let now = 0; let seq = 0; const timers = new Map();
const setTimer = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
const clearTimer = id => { timers.delete(id); };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const advance = async ms => {
  const end = now + ms;
  for (;;) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
  }
  now = end;
};
const pendingTimers = () => [...timers.values()].filter(t => t.at - now === 10000).length;

const ISO = '2026-11-03T03:00:00.000Z';
let cpu = 19.2;
const pcData = () => ({ measuredAt: ISO, cpu: { status: 'ok', value: cpu, windowMs: 500 }, memory: { status: 'ok', usedGiB: 9.5, totalGiB: 13.8, percent: 68.7 }, disk: { status: 'ok', freeGiB: 38.1, totalGiB: 237.4 } });
const connData = { measuredAt: ISO, network: { status: 'ok', adapters: [{ name: 'Wi-Fi', kind: '무선', connected: true }, { name: 'BT', kind: '가상', connected: false }] },
  firewall: { status: 'ok', profiles: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: true }] },
  events: { system: { status: 'ok', error: 10, warning: 9, hours: 24 }, application: { status: 'unavailable', reason: '권한이 없어 읽지 못했습니다(관리자 권한이 필요한 항목).' } },
  sdp: { state: 'not_connected', label: 'SDP 미연결', reason: 'SDP 호스트 설정 없이 실행 중입니다.' } };
const calls = []; let mode = 'ok'; let gate = null;
const fetchImpl = async (url, o) => {
  calls.push(url);
  if (gate) await new Promise((res, rej) => { gate.push(res); o.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }); });
  if (mode === 'down') throw new TypeError('Failed to fetch');
  return { ok: true, status: 200, json: async () => ({ ok: true, data: url.includes('connection') ? connData : pcData() }) };
};

const { mountPcPage, readItems, countItems, deltaText } = await import('../student/pc.mjs');
const walk = (n, o = []) => { o.push(n); for (const c of n.children ?? []) if (typeof c === 'object') walk(c, o); return o; };
const text = r => walk(r).map(n => n._text).filter(Boolean).join(' | ');
let fails = 0; let total = 0;
const check = (n, ok) => { total++; if (!ok) { fails++; console.log('FAIL', n); } };

// 순수 함수
const items = readItems({ data: pcData() }, { data: connData });
check('7개 항목 집계(1개 확인 불가)', JSON.stringify(countItems(items)) === JSON.stringify({ ok: 6, failed: 1, total: 7 }));
check('요청 실패면 해당 묶음 전부 확인 불가', countItems(readItems({ error: 'x' }, { data: connData })).failed === 4);
check('변화 표시', deltaText(26.7, 19.2, '%p') === '이전 조회 대비 +7.5%p' && deltaText(5, 5, '%p') === '이전 조회와 같음' && deltaText(null, 1, '') === '이전 조회와 비교 불가');
check('값이 이상하면 확인 불가', readItems({ data: { ...pcData(), cpu: { status: 'ok', value: 'x' } } }, { data: connData }).cpu.ok === false);

// 화면
const root = make('div');
mountPcPage(root, { doc, fetchImpl, setTimer, clearTimer });
const btn = label => walk(root).find(n => n.tag === 'button' && n.textContent === label);
const box = () => walk(root).find(n => n.tag === 'input');
const t0 = text(root);
check('처음: 조회 없음, 안내 표시', calls.length === 0 && /아직 조회하지 않았습니다/.test(t0) && /SDP 연결 상태: 아직 확인하지 않음/.test(t0));
check('취소 버튼은 처음에 비활성', btn('PC 조회 취소').disabled === true);
await advance(60000);
check('자동 꺼짐: 시간이 지나도 조회 없음', calls.length === 0);

btn('PC 상태 다시 조회').listeners.click(); await flush();
const t1 = text(root);
check('수동 조회: 두 주소 한 번씩', calls.length === 2);
check('큰 숫자 카드', /19.2 %/.test(t1) && /9.5 GiB/.test(t1) && /38.1 GiB/.test(t1) && /6 \/ 7/.test(t1));
check('요약: 7개 중 6개 조회, 1개 확인 불가', /7개 항목 중 6개 조회, 1개 확인 불가/.test(t1) && /마지막 수동 조회/.test(t1));
check('SDP 띠는 별개로 표시', /SDP 미연결 · SDP 호스트 설정 없이 실행 중입니다. · 이 PC의 로컬 조회 결과와 별개입니다/.test(t1));
check('네트워크·방화벽', /연결됨 1 \/ 전체 2/.test(t1) && /Wi-Fi · 무선 · 연결됨/.test(t1) && /켜짐 3 \/ 3/.test(t1) && /IP 주소는 읽지 않으며/.test(t1));
check('기록: 일부만, 이유와 다음 행동', /오류 10 · 경고 9 \(일부만\)/.test(t1) && /Application: 확인 불가 · 이유: 권한이 없어/.test(t1));
check('첫 조회는 비교 불가', /이전 조회와 비교 불가/.test(t1));
check('값 출처 표시', /\[내 PC에서 잰 값\]/.test(t1));
check('추이 표 1행(수동)', walk(root).filter(n => n.tag === 'tr').length === 2 && /수동/.test(t1));
check('막대 너비', walk(root).some(n => n.className === 'pc-bar-fill' && n.style.width === '19.2%'));
await advance(60000);
check('수동만: 반복 없음', calls.length === 2);

cpu = 26.7; btn('PC 상태 다시 조회').listeners.click(); await flush();
check('두 번째: 이전 조회 대비', /이전 조회 대비 \+7.5%p/.test(text(root)));

// 자동
calls.length = 0; box().checked = true; box().listeners.change(); await flush();
check('자동 켜면 바로 조회', calls.length === 2 && /10초 뒤 다시 확인합니다/.test(text(root)));
await advance(9999); check('10초 전엔 안 함', calls.length === 2);
await advance(1); check('10초 뒤 자동 조회', calls.length === 4 && /자동/.test(text(root)));

// 겹침 없음과 취소
calls.length = 0; gate = [];
await advance(10000);
check('조회 중', calls.length === 2 && btn('PC 조회 취소').disabled === false && btn('PC 상태 다시 조회').disabled === true);
await advance(15000); check('조회 중에는 겹치지 않음', calls.length === 2);
btn('PC 조회 취소').listeners.click(); await flush();
const t2 = text(root);
check('취소: 자동도 꺼짐, 이전 값의 시각 안내', /이번 조회를 취소했습니다. 자동 확인도 껐습니다/.test(t2) && box().checked === false);
check('취소 뒤 남은 타이머 없음', timers.size === 0);
gate = null;

// 실패
mode = 'down'; btn('PC 상태 다시 조회').listeners.click(); await flush();
const t3 = text(root);
const cardsText = text(walk(root).find(n => typeof n.className === 'string' && n.className.includes('pc-cards-4')));
check('실패: 카드에 이전 값 대신 확인 불가', !/26.7 %/.test(cardsText) && /0 \/ 7/.test(t3) && /서버에 연결하지 못했습니다/.test(t3) && /npm start/.test(t3));
check('실패도 추이에 확인 불가로 남음', /확인 불가/.test(walk(root).find(n => n.tag === 'table') ? text(walk(root).find(n => n.tag === 'table')) : ''));
mode = 'ok';

// 시간 초과
const slow = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => { const e = new Error('a'); e.name = 'AbortError'; rej(e); }));
const root2 = make('div');
mountPcPage(root2, { doc, fetchImpl: slow, setTimer, clearTimer });
walk(root2).find(n => n.tag === 'button' && n.textContent === 'PC 상태 다시 조회').listeners.click(); await flush();
await advance(20000); await flush();
check('시간 초과 표시', /시간 초과로 읽지 못했습니다/.test(text(root2)) && /잠시 뒤 다시 조회하세요/.test(text(root2)));

// 탭 숨김
const root3 = make('div'); calls.length = 0;
mountPcPage(root3, { doc, fetchImpl, setTimer, clearTimer });
const box3 = walk(root3).find(n => n.tag === 'input'); box3.checked = true; box3.listeners.change(); await flush();
doc.hidden = true; docListeners.visibilitychange();
const before = calls.length; await advance(60000);
check('탭이 안 보이면 멈춤', calls.length === before);
doc.hidden = false; docListeners.visibilitychange(); await flush();
check('탭이 보이면 바로 다시', calls.length === before + 2);

// 추이 최대 5행
for (let i = 0; i < 7; i++) { await advance(10000); }
check('추이 표는 최근 5회', walk(root3).filter(n => n.tag === 'tr').length === 6);

console.log(fails ? `실패 ${fails}건 / ${total}건` : `전부 OK (${total}건)`);
process.exitCode = fails ? 1 : 0;
