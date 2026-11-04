// 4일차(다시 조회·대기 표시·오류 화면·키보드)를 모의 DOM으로 점검합니다(실제 화면 확인이 아님).
const make = tag => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, className: '', _text: '', disabled: false, tabIndex: undefined, focused: 0, scrolled: 0,
  set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text; },
  append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
  setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; },
  focus() { this.focused += 1; }, scrollIntoView() { this.scrolled += 1; } });
globalThis.document = { createElement: make };
const { createStudentView } = await import('../student/extension.mjs');
const view = createStudentView();
const walk = (n, o = []) => { o.push(n); for (const c of n.children ?? []) if (typeof c === 'object') walk(c, o); return o; };
const text = r => walk(r).map(n => n._text).filter(Boolean).join(' | ');
let fails = 0; const check = (n, ok) => { if (!ok) { fails++; console.log('FAIL', n); } };

const root = view.renderStatus({ devices: { status: 'idle' }, sessions: { status: 'idle' }, notifications: [{ resource: 'me', code: 'ENGINE_NOT_CONNECTED', message: '연결 없음' }], diagnostics: { status: 'idle' }, mode: 'disconnected' });
const all = walk(root);

// 핵심 3가지가 맨 위, 이동 버튼은 키보드로 쓸 수 있는 button
const first = root.children[0];
check('핵심 3가지가 맨 위', first?.dataset?.testid === 'student-core' && /기록 보기 · 사용 가능/.test(text(first)) && /내 PC 상태 · 사용 가능/.test(text(first)) && /위험 알림 · 실제 탐지는 아직 안 됨/.test(text(first)));
const goPc = all.find(n => n.tag === 'button' && n.textContent === '내 PC 상태로 이동');
const goAlert = all.find(n => n.tag === 'button' && n.textContent === '알림 목록으로 이동');
check('이동 버튼 둘 다 button', !!goPc && !!goAlert && goPc.type === 'button');
goPc.listeners.click(); goAlert.listeners.click();
const pcSection = all.find(n => n.dataset?.testid === 'student-live-pc');
const alertSection = all.find(n => n.className === 'status-notifications');
check('이동하면 포커스·스크롤', pcSection.focused === 1 && pcSection.scrolled === 1 && alertSection.focused === 1 && pcSection.tabIndex === -1);
check('값 구분 표시', /\[내 PC에서 잰 값\]/.test(text(first)) && /\[예시 화면 · 설명용 값\]/.test(text(first)));

// 다시 조회 + 대기 표시 + 포커스 이동
const pcBtn = all.find(n => n.tag === 'button' && n.textContent === 'PC 상태 다시 조회');
const connBtn = all.find(n => n.tag === 'button' && n.textContent === '연결·기록 다시 조회');
check('다시 조회 버튼 둘', !!pcBtn && !!connBtn && pcBtn.attrs['aria-label'] === 'PC 상태 다시 조회');
const pcResult = all.find(n => n.className === 'student-pc-result');
check('결과 칸 aria-live/tabIndex', pcResult.attrs['aria-live'] === 'polite' && pcResult.tabIndex === -1);
let release;
globalThis.fetch = () => new Promise(r => { release = r; });
const p = pcBtn.listeners.click();
check('대기 중 표시·버튼 잠금', /새로 읽는 중/.test(text(pcResult)) && pcBtn.disabled === true && pcResult.attrs['aria-busy'] === 'true');
release({ ok: true, status: 200, json: async () => ({ ok: true, data: { measuredAt: '2026-10-31T03:00:00Z', cpu: { status: 'ok', value: 5, windowMs: 500 }, memory: { status: 'ok', usedGiB: 1, totalGiB: 2, percent: 50 }, disk: { status: 'unavailable', reason: '권한이 없어 읽지 못했습니다(관리자 권한이 필요한 항목).' } } }) });
await p;
let t = text(pcResult);
check('끝나면 버튼 풀림·포커스 이동', pcBtn.disabled === false && pcResult.focused === 1 && pcResult.attrs['aria-busy'] === 'false');
check('성공 항목 유지 + 잰 시각', /CPU 사용률: 5%/.test(t) && /잰 시각/.test(t));
check('실패 항목·이유·다음 행동', /실패한 항목: 디스크 남은 공간 · 이유: 권한이 없어/.test(t) && /다음에 할 일: 관리자 권한이 필요한 항목입니다/.test(t));
check('오류 화면 role=alert', walk(pcResult).some(n => n.attrs?.role === 'alert'));
check('예시 값 대신 안 보여 줌', /예시 값이나 이전에 잰 값으로 대신 보여 주지 않았습니다/.test(t) && !/디스크 남은 공간: \d/.test(t));

// 서버 꺼짐(실제 브라우저에서는 fetch가 TypeError)
globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
await pcBtn.listeners.click();
t = text(pcResult);
check('서버 꺼짐 안내', /실패한 항목: PC 상태\(CPU·메모리·디스크\) 전체 · 이유: 서버에 연결하지 못했습니다/.test(t) && /npm start/.test(t));
await connBtn.listeners.click();
const connResult = all.find(n => n.className === 'student-conn-result');
t = text(connResult);
check('연결·기록 서버 꺼짐 안내 + SDP 분리 문구', /이유: 서버에 연결하지 못했습니다/.test(t) && /SDP 연결 여부는 이 실패로 판단하지 않습니다/.test(t));

// 시간 초과 항목
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, data: { measuredAt: '2026-10-31T03:00:00Z', network: { status: 'ok', adapters: [] }, firewall: { status: 'unavailable', reason: '시간 초과로 읽지 못했습니다.' }, events: { system: { status: 'ok', error: 1, warning: 2, hours: 24 }, application: { status: 'ok', error: 0, warning: 0, hours: 24 } }, sdp: { label: 'SDP 미연결', reason: '설정 없음' } } }) });
await connBtn.listeners.click();
t = text(connResult);
check('시간 초과 → 다시 조회 안내', /실패한 항목: 방화벽 설정 · 이유: 시간 초과/.test(t) && /잠시 뒤 「다시 조회」/.test(t));
check('성공 항목(System 건수) 유지', /System 기록: 오류 1건 · 경고 2건/.test(t));

console.log(fails ? `실패 ${fails}건` : '4일차 모의 점검 전부 OK');
process.exitCode = fails ? 1 : 0;
