// 내 PC 실시간 6칸과 OSV 시각 표시를 점검합니다(모의 DOM·가짜 시계, 실제 화면 확인이 아님).
const make = tag => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, style: {}, className: '', _text: '', checked: false, isConnected: true,
  set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text; },
  append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
  setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } });
const docListeners = {};
globalThis.document = { createElement: make, hidden: false, addEventListener(t, f) { docListeners[t] = f; } };

// 가짜 시계: setTimeout 을 모아 두었다가 advance 로 실행합니다.
let now = 0; let seq = 0; const timers = new Map();
globalThis.setTimeout = (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; };
globalThis.clearTimeout = id => { timers.delete(id); };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const advance = async ms => {
  const end = now + ms;
  for (;;) {
    const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
  }
  now = end;
};

const ISO = '2026-11-03T02:00:00.000Z';
const pcData = { measuredAt: ISO, cpu: { status: 'ok', value: 19, windowMs: 500 }, memory: { status: 'ok', usedGiB: 9, totalGiB: 13.8, percent: 65 }, disk: { status: 'ok', freeGiB: 38.4, totalGiB: 237.4 } };
const connData = { measuredAt: ISO, network: { status: 'ok', adapters: [{ name: 'Wi-Fi', kind: '무선', connected: true }, { name: 'v', kind: '가상', connected: false }] },
  firewall: { status: 'ok', profiles: [{ name: 'Domain', enabled: true }, { name: 'Private', enabled: true }, { name: 'Public', enabled: false }] },
  events: { system: { status: 'ok', error: 9, warning: 13, hours: 24 }, application: { status: 'unavailable', reason: '권한' } } };
const calls = []; let mode = 'ok'; let hold = null;
globalThis.fetch = async url => {
  calls.push(url);
  if (hold) await hold.promise;
  if (mode === 'down') throw new TypeError('Failed to fetch');
  if (mode === '500') return { ok: false, status: 500, json: async () => ({ ok: false, error: { message: '서버 오류' } }) };
  return { ok: true, status: 200, json: async () => ({ ok: true, data: url.includes('connection') ? connData : pcData }) };
};

const { createStudentView } = await import('../student/extension.mjs');
const view = createStudentView();
const walk = (n, o = []) => { o.push(n); for (const c of n.children ?? []) if (typeof c === 'object') walk(c, o); return o; };
const text = r => walk(r).map(n => n._text).filter(Boolean).join(' | ');
let fails = 0; let total = 0;
const check = (n, ok) => { total++; if (!ok) { fails++; console.log('FAIL', n); } };
const err = { status: 'error', error: { code: 'ENGINE_NOT_CONNECTED', message: '연결 없음' } };
const input = { devices: err, sessions: err, notifications: [], mode: 'disconnected' };

const root = view.renderStatus(input);
const panel = walk(root).find(n => n.dataset.testid === 'student-live-pc');
const button = walk(panel).find(n => n.tag === 'button');
const box = walk(panel).find(n => n.tag === 'input');
const titles = ['CPU', '메모리', '디스크', '네트워크', 'Windows 방화벽', 'Windows 기록'];

check('6칸 제목 표시', titles.every(t => text(panel).includes(t)));
check('핵심 기능 바로 다음에 위치', root.children[0].dataset.testid === 'student-core' && root.children[1] === panel);
check('처음: 자동 조회 없음', calls.length === 0 && /아직 읽지 않았습니다/.test(text(panel)) && box.checked === false);
await advance(60000);
check('체크 전: 시간이 지나도 조회 없음', calls.length === 0 && timers.size === 0);

button.listeners.click(); await flush();
check('버튼: 두 주소를 한 번씩 조회', calls.length === 2 && calls.includes('/api/pc-status') && calls.includes('/api/pc-connection'));
const t1 = text(panel);
check('값 표시', /19% 사용/.test(t1) && /9 GiB \/ 13.8 GiB/.test(t1) && /38.4 GiB 남음/.test(t1) && /연결됨 1개 \/ 전체 2개/.test(t1) && /Domain 켜짐 · Private 켜짐 · Public 꺼짐/.test(t1));
check('기록 일부 불가 구분, 침해 판정 아님', /System 오류 9건 · 경고 13건 \/ Application 확인 불가/.test(t1) && /침해 판정이 아닙니다/.test(t1));
check('값 출처 표시', /\[내 PC에서 잰 값\]/.test(t1));
await advance(60000);
check('버튼만: 반복 없음', calls.length === 2);

calls.length = 0; box.checked = true; box.listeners.change(); await flush();
check('체크: 바로 조회', calls.length === 2);
await advance(9999);
check('10초 전에는 다시 안 읽음', calls.length === 2);
await advance(1);
check('10초 뒤 다시 읽음(6칸 전부)', calls.length === 4 && calls.filter(u => u.includes('connection')).length === 2);

// 겹침 없음: 조회가 끝나지 않으면 다음 조회를 시작하지 않습니다.
calls.length = 0; let release; hold = { promise: new Promise(r => { release = r; }) };
await advance(10000);
check('조회 시작', calls.length === 2);
await advance(15000);
check('응답 전에는 겹치지 않음', calls.length === 2);
button.listeners.click(); await flush();
check('응답 전 버튼도 겹치지 않음', calls.length === 2);
hold = null; release(); await flush();
await advance(9999);
check('끝난 뒤 10초를 다시 셈', calls.length === 2);
await advance(1);
check('끝난 뒤 10초에 다시 읽음', calls.length === 4);

// 탭 숨김
calls.length = 0; document.hidden = true; docListeners.visibilitychange();
await advance(60000);
check('탭이 안 보이면 멈춤', calls.length === 0 && timers.size === 0);
document.hidden = false; docListeners.visibilitychange(); await flush();
check('탭이 보이면 바로 다시 읽음', calls.length === 2);

// 실패 시 이전 값 제거
calls.length = 0; mode = 'down';
await advance(10000);
const t2 = text(panel);
check('실패: 이전 값 없음', !/19% 사용/.test(t2) && !/연결됨 1개/.test(t2) && /이번 조회 확인 불가/.test(t2));
check('실패 이유 표시', /서버에 연결하지 못했습니다/.test(t2));
mode = '500'; await advance(10000);
check('서버 오류 이유 표시', /서버 오류/.test(text(panel)));
mode = 'ok'; await advance(10000);
check('복구되면 다시 값 표시', /19% 사용/.test(text(panel)) && !/이번 조회 확인 불가/.test(text(panel)));

// 시간 초과
let aborted = false; globalThis.fetch = (url, o) => new Promise((_, rej) => { o.signal.addEventListener('abort', () => { aborted = true; const e = new Error('x'); e.name = 'AbortError'; rej(e); }); });
await advance(10000); await advance(20000); await flush();
check('시간 초과 표시', aborted && /시간 초과로 읽지 못했습니다/.test(text(panel)));
globalThis.fetch = async url => ({ ok: true, status: 200, json: async () => ({ ok: true, data: url.includes('connection') ? connData : pcData }) });

// 체크 해제
await advance(10000); box.checked = false; box.listeners.change(); await flush();
calls.length = 0; await advance(60000);
check('체크 해제: 멈춤', calls.length === 0 && timers.size === 0);

// 다시 그리기: 타이머가 겹치지 않음
box.checked = true; box.listeners.change(); await flush();
const count0 = timers.size;
const root2 = view.renderStatus(input); view.renderStatus(input);
check('다시 그려도 타이머가 늘지 않음', timers.size === count0);
check('다시 그려도 체크 상태 유지', walk(walk(root2).find(n => n.dataset.testid === 'student-live-pc')).find(n => n.tag === 'input').checked === true);

// 화면에서 빠지면 멈춤
const latest = view.renderStatus(input); walk(latest).find(n => n.dataset.testid === 'student-live-pc').isConnected = false;
await advance(10000); await flush();
check('화면에서 빠지면 다음 조회를 멈춤', timers.size === 0);

// 항목별 확인 불가
pcData.cpu = { status: 'unavailable', reason: '시간 초과로 읽지 못했습니다.' };
walk(latest).find(n => n.dataset.testid === 'student-live-pc').isConnected = true;
const r3 = view.renderStatus(input);
const p3 = walk(r3).find(n => n.dataset.testid === 'student-live-pc');
walk(p3).find(n => n.tag === 'button').listeners.click(); await flush();
check('항목 하나만 확인 불가, 나머지 유지', /확인 불가/.test(text(p3)) && /이유: 시간 초과로 읽지 못했습니다/.test(text(p3)) && /9 GiB \/ 13.8 GiB/.test(text(p3)));

// OSV 시각 표시
const nc = text(view.renderVulnerabilities({ status: 'ok', mode: 'disconnected', data: { status: 'not_configured', code: 'PROJECT_NOT_CONFIGURED', checkedAt: ISO, packages: [] } }));
check('not_configured: 상태 확인 시각, 한국 시간과 원문', /상태 확인 시각\(실제 OSV 조회 아님\)/.test(nc) && !/조회 시각\(checkedAt\)/.test(nc) && /오전 11:00:00/.test(nc) && nc.includes(ISO));
const dn = text(view.renderVulnerabilities({ status: 'ok', mode: 'engine', data: { status: 'complete', checkedAt: ISO, packages: [] } }));
check('complete: 조회 시각 유지', /조회 시각\(checkedAt\)/.test(dn) && !/상태 확인 시각/.test(dn));

console.log(fails ? `실패 ${fails}건 / ${total}건` : `전부 OK (${total}건)`);
process.exitCode = fails ? 1 : 0;
