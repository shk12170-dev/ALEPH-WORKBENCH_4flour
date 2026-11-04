// 점검 기록(src/pc-status/checks.mjs, student/checks.mjs)을 점검합니다(가짜 응답·모의 DOM, 실제 화면 확인이 아님).
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const srv = await import('../src/pc-status/checks.mjs');
const cli = await import('../student/checks.mjs');
let fails = 0; let total = 0;
const check = (n, ok) => { total++; if (!ok) { fails++; console.log('FAIL', n); } };

// 가짜 서버 응답(연결 없음 모드에서 기대대로)
const good = {
  '/': { status: 200, body: null }, '/pc': { status: 200, body: null },
  '/api/pc-status': { status: 200, body: { ok: true, data: { cpu: { status: 'ok' }, memory: { status: 'ok' }, disk: { status: 'ok' } } } },
  '/api/pc-connection': { status: 200, body: { ok: true, data: { network: { status: 'ok' }, firewall: { status: 'ok' }, events: { system: { status: 'ok' }, application: { status: 'ok' } }, sdp: { label: 'SDP 미연결' } } } },
  '/api/diagnostics': { status: 200, body: { ok: true, data: { engine: { mode: 'disconnected', code: 'ENGINE_NOT_CONNECTED' } } } },
  '/api/vulnerabilities': { status: 200, body: { ok: true, data: { status: 'not_configured', code: 'PROJECT_NOT_CONFIGURED' } } },
};
for (const k of ['me', 'apps', 'events', 'devices', 'sessions']) good[`/api/${k}`] = { status: 503, body: { ok: false, error: { code: 'ENGINE_NOT_CONNECTED' } } };
const methods = [];
const fakeFetch = (table) => async (url, o) => {
  methods.push(o.method);
  const path = new URL(url).pathname;
  if (!new URL(url).hostname.startsWith('127.0.0.1')) throw new Error('외부 요청');
  const r = table[path];
  if (r === 'throw') throw new TypeError('fetch failed');
  return { status: r.status, text: async () => (r.body ? JSON.stringify(r.body) : '<html>') };
};
const root = mkdtempSync(join(tmpdir(), 'chk-'));
mkdirSync(join(root, '.git', 'refs', 'heads'), { recursive: true });
writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
writeFileSync(join(root, '.git', 'refs', 'heads', 'main'), 'a'.repeat(40) + '\n');

const svc = srv.createChecksService({ root, fetchImpl: fakeFetch(good) });
const d = await svc.run({ port: 5555, mode: 'disconnected' });
check('실행 11건, 미실행 5건', d.executed.length === 11 && d.notRun.length === 5);
check('기대대로면 모두 일치', d.summary.match === 11 && d.summary.mismatch === 0 && d.summary.unverified === 0);
check('미실행은 일치 합계에 없음', d.summary.notRun === 5 && d.summary.total === 16 && d.summary.match + d.summary.mismatch + d.summary.unverified + d.summary.notRun === 16);
check('GET만 보냄', methods.length === 11 && methods.every(m => m === 'GET'));
check('503 사례에 연결 성공 아님 표시', d.executed.find(r => r.id === 'C-05').note === '연결 성공이 아닙니다.');
check('OSV 미조회 표시', /취약점 없음」으로 세지 않습니다/.test(d.executed.find(r => r.id === 'C-11').note));
check('커밋은 .git 에서 읽음', d.commit === 'a'.repeat(40));
check('대상·방법 표시', /127.0.0.1:5555/.test(d.target) && d.method === 'GET만');

// 불일치·확인 불가
const bad = { ...good, '/api/pc-status': { status: 200, body: { ok: true, data: { cpu: { status: 'unavailable' }, memory: { status: 'ok' }, disk: { status: 'ok' } } } }, '/pc': 'throw' };
const d2 = await srv.createChecksService({ root, fetchImpl: fakeFetch(bad) }).run({ port: 5555, mode: 'disconnected' });
check('항목 하나 실패 → 불일치', d2.executed.find(r => r.id === 'C-03').result === 'mismatch' && /2\/3 ok/.test(d2.executed.find(r => r.id === 'C-03').observed));
check('응답 없음 → 확인 불가(불일치로 세지 않음)', d2.executed.find(r => r.id === 'C-02').result === 'unverified' && d2.summary.unverified === 1 && d2.summary.mismatch === 1);

// 예제 모드에서는 기대가 바뀜
const demoTable = { ...good, '/api/diagnostics': { status: 200, body: { ok: true, data: { engine: { mode: 'demo' } } } } };
for (const k of ['me', 'apps', 'events', 'devices', 'sessions']) demoTable[`/api/${k}`] = { status: 200, body: { ok: true, data: [] } };
const d3 = await srv.createChecksService({ root, fetchImpl: fakeFetch(demoTable) }).run({ port: 5555, mode: 'demo' });
check('예제 모드: 200이 기대, 예제 자료 표시', d3.summary.match === 11 && d3.executed.find(r => r.id === 'C-07').note === '예제 자료입니다.');
check('연결 없음 기대로 예제 응답을 받으면 불일치', (await srv.createChecksService({ root, fetchImpl: fakeFetch(demoTable) }).run({ port: 5555, mode: 'disconnected' })).summary.mismatch >= 5);

// 동시 실행 막기
const waiting = []; const release = () => waiting.splice(0).forEach(r => r());
const slow = async (url) => { await new Promise(r => { waiting.push(r); }); return { status: 200, text: async () => '' }; };
const s4 = srv.createChecksService({ root, fetchImpl: slow });
const p = s4.run({ port: 1, mode: 'disconnected' });
check('실행 중이면 두 번째는 null(409)', (await s4.run({ port: 1, mode: 'disconnected' })) === null);
release(); await p.catch(() => {});

// 커밋 읽기: 이상한 ref 거부
writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/../../secret\n');
check('.. 이 든 ref 는 읽지 않음', (await srv.readCommit(root)) === null);
writeFileSync(join(root, '.git', 'HEAD'), 'b'.repeat(40));
check('분리된 HEAD 도 읽음', (await srv.readCommit(root)) === 'b'.repeat(40));

// 화면 쪽 검사
check('정상 응답 통과', !cli.validateChecks(d).error);
check('합계 조작 거부', /합계/.test(cli.validateChecks({ ...d, summary: { ...d.summary, match: 16 } }).error));
check('미실행 목록에 실행 결과 섞임 거부', !!cli.validateChecks({ ...d, notRun: [{ ...d.notRun[0], result: 'match' }] }).error);
check('형식 다름 거부', !!cli.validateChecks({ ...d, schema: 'x' }).error);

// 화면 그리기(모의 DOM)
const make = tag => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, style: {}, className: '', _text: '', disabled: false,
  set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text; },
  append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; },
  setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(t, f) { this.listeners[t] = f; } });
const doc = { createElement: make };
const walk = (n, o = []) => { o.push(n); for (const c of n.children ?? []) if (typeof c === 'object') walk(c, o); return o; };
const text = r => walk(r).map(n => n._text).filter(Boolean).join(' | ');
let reply = { ok: true, status: 200, json: async () => ({ ok: true, data: d }) };
const ui = make('div');
const page = cli.mountChecksPage(ui, { doc, fetchImpl: async () => reply, setTimer: () => 0, clearTimer: () => {} });
check('처음: 점검 안 함', /아직 점검하지 않았습니다/.test(text(ui)));
await page.runChecks();
const t1 = text(ui);
check('합계 식 표시', /전체 16 = 일치 11 \+ 불일치 0 \+ 확인 불가 0 \+ 미실행 5/.test(t1));
check('두 표 분리', /실행한 사례 \(11건\)/.test(t1) && /실행하지 않은 사례 \(5건\)/.test(t1));
check('측정 커밋 표시', t1.includes('a'.repeat(40)));
reply = { ok: false, status: 500, json: async () => ({ ok: false, error: { message: '서버 오류' } }) };
await page.runChecks();
const t2 = text(ui);
check('실패 시 이전 결과 제거', !/실행한 사례/.test(t2) && /확인 불가/.test(t2) && /서버 오류/.test(t2));
reply = { ok: true, status: 200, json: async () => ({ ok: true, data: { ...d, summary: { ...d.summary, match: 99 } } }) };
await page.runChecks();
check('합계가 다르면 표를 그리지 않음', /합계가 다릅니다/.test(text(ui)) && !/실행한 사례/.test(text(ui)));

console.log(fails ? `실패 ${fails}건 / ${total}건` : `전부 OK (${total}건)`);
process.exitCode = fails ? 1 : 0;
