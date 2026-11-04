// 핵심 기능 요약과 알림 카드 문구를 점검합니다(모의 DOM, 실제 화면 확인이 아님).
const make = tag => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, style: {}, className: '', _text: '',
  set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text; },
  append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
  setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } });
globalThis.document = { createElement: make };
const { createStudentView } = await import('../student/extension.mjs');
const view = createStudentView();
const walk = (n, o = []) => { o.push(n); for (const c of n.children ?? []) if (typeof c === 'object') walk(c, o); return o; };
const text = r => walk(r).map(n => n._text).filter(Boolean).join(' | ');
let fails = 0; let total = 0;
const check = (n, ok) => { total++; if (!ok) { fails++; console.log('FAIL', n); } };
const err = { status: 'error', error: { code: 'ENGINE_NOT_CONNECTED', message: '연결 없음' } };
const notes = [1, 2, 3, 4, 5].map(i => ({ id: 'n' + i, title: 't' + i, message: 'm' + i, severity: 'warn' }));

const dis = text(view.renderStatus({ devices: err, sessions: err, notifications: notes, diagnostics: undefined, mode: 'disconnected' }));
check('핵심 요약: 지금 됨 문구 제거', !/지금 됨/.test(dis));
check('핵심 요약: 사용 가능 표시', (dis.match(/사용 가능/g) || []).length === 2);
check('내 PC 상태: 버튼을 눌러야 읽는다는 안내', /「내 PC 확인」을 누르거나 「10초마다 확인」을 체크해야 읽습니다/.test(dis));
check('위험 알림은 실제 탐지가 아직 안 됨', /위험 알림 · 실제 탐지는 아직 안 됨/.test(dis));
check('알림 카드(연결 없음): 연결 실패·위험 판정 아님', /5건/.test(dis) && /연결 실패 알림입니다 · 위험 판정 아님 · Windows 기록 건수와 별개/.test(dis));

const demo = text(view.renderStatus({ devices: { status: 'ok', data: [] }, sessions: { status: 'ok', data: [] }, notifications: notes.slice(0, 2), diagnostics: undefined, mode: 'demo' }));
check('알림 카드(예제): 연결 실패라고 단정하지 않음', !/연결 실패 알림입니다/.test(demo) && /아래 알림 목록을 확인하세요 · Windows 기록 건수와 별개/.test(demo));

const none = text(view.renderStatus({ devices: err, sessions: err, notifications: [], diagnostics: undefined, mode: 'disconnected' }));
check('알림 0건: 부가 문구 없음', !/위험 판정 아님 · Windows/.test(none) && /0건/.test(none));
console.log(fails ? `실패 ${fails}건 / ${total}건` : `전부 OK (${total}건)`);
process.exitCode = fails ? 1 : 0;
