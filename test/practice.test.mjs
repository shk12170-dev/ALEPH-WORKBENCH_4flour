// 연습 경보 시연(src/practice-alerts/service.mjs, student/practice.mjs)을 점검합니다(실제 서버·브라우저 없이, 실제 탐지 확인이 아님).
import { createPracticeAlertsService, MODULES } from '../src/practice-alerts/service.mjs';
import { validatePractice, mountPracticePage } from '../student/practice.mjs';
import { mkdtempSync, mkdirSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

let fails = 0; let total = 0;
const check = (n, ok) => { total++; if (!ok) { fails++; console.log('FAIL', n); } };
const root = fileURLToPath(new URL('../', import.meta.url));

const d = await createPracticeAlertsService({ root }).read();
check('모듈 6/6 읽음', d.modulesOk === 6 && d.modulesTotal === 6 && d.modules.length === MODULES.length);
check('연습 경보 158건 = block 53 + alert 52 + record 53', d.total === 158 && d.counts.block === 53 && d.counts.alert === 52 && d.counts.record === 53);
check('vault 보너스 결과와 158/158 일치', d.vaultMatch === 158 && d.vaultTotal === 158);
check('값 표시는 예시 화면·설명용 값', d.label === '예시 화면 · 설명용 값' && /실제 탐지가 아니며/.test(d.notice));
check('계정·주소 원문이 응답에 없음', !/\b\d{1,3}(\.\d{1,3}){3}\b/.test(JSON.stringify(d)) && !/user01/.test(JSON.stringify(d)));
check('서버 응답이 화면 검사를 통과', !validatePractice(d).error);

const bad = structuredClone(d); bad.counts.block += 1;
check('합계가 행과 다르면 화면이 거부', !!validatePractice(bad).error);
check('형식이 다르면 거부', !!validatePractice(null).error && !!validatePractice({}).error);

// 모듈 하나를 읽지 못하면 0건으로 세지 않고 읽지 못함으로 따로 둡니다(임시 폴더에 5개만 복사).
const tmp = mkdtempSync(join(tmpdir(), 'prc-'));
mkdirSync(join(tmp, 'student'), { recursive: true });
cpSync(join(root, 'student', 'practice'), join(tmp, 'student', 'practice'), { recursive: true });
const { rmSync } = await import('node:fs');
rmSync(join(tmp, 'student', 'practice', 'privilege', 'decide.mjs'));
const part = await createPracticeAlertsService({ root: tmp }).read();
const lost = part.modules.find((m) => m.key === 'privilege');
check('읽지 못한 모듈은 unavailable', lost.status === 'unavailable' && part.modulesOk === 5 && part.total === 158 - 26);
check('일부만 읽어도 합계가 행과 맞음', !validatePractice(part).error);

// 화면: 가짜 fetch로 그려 보고, 실패하면 이전 결과를 지웁니다(모의 DOM).
const make = (tag) => ({ tag, children: [], dataset: {}, attrs: {}, listeners: {}, className: '', _text: '', disabled: false,
  set textContent(v) { this._text = String(v); this.children = []; }, get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); },
  append(...n) { this.children.push(...n); }, replaceChildren(...n) { this.children = n; this._text = ''; },
  setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(e, f) { this.listeners[e] = f; } });
const doc = { createElement: make };
const root1 = make('div');
let mode = 'ok';
const fetchImpl = async () => (mode === 'ok'
  ? { ok: true, status: 200, json: async () => ({ ok: true, data: d }) }
  : { ok: false, status: 503, json: async () => ({ ok: false, error: { code: 'DOWN' } }) });
const page = mountPracticePage(root1, { doc, fetchImpl, setTimer: () => 0, clearTimer: () => {} });
await page.load();
check('성공하면 158건과 예시 표시가 보임', /158건/.test(root1.textContent) && /전부 일치/.test(root1.textContent) && /예시 화면 · 설명용 값/.test(root1.textContent));
mode = 'fail';
await page.load();
check('실패하면 이전 158건을 남기지 않음', !/전부 일치/.test(root1.textContent) && /확인 불가/.test(root1.textContent));

console.log(fails ? `실패 ${fails}건 / ${total}건` : `전부 OK (${total}건)`);
process.exitCode = fails ? 1 : 0;
