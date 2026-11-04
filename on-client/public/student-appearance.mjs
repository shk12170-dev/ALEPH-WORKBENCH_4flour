// 학생 꾸밈 화면 적용(제공 UI). 서버가 검증한 정규화 DTO 를 다시 확인하고 textContent·DOM API 로만 적용한다.
// HTML 문자열 해석·inline style·외부 주소는 쓰지 않는다. 상태·연결·판정 표시와 학생 slot 내용은 건드리지 않는다.
// 배치는 같은 view 안의 기존 카드 순서만 DOM 에서 바꾼다(삭제·숨김·비활성·탭 간 이동 없음). 보이는 순서 = DOM·읽기·탭 순서.
export const APPEARANCE_VIEW_SCHEMA = 'alekov.student-appearance.view.v1';
export const APPEARANCE_PRESETS = Object.freeze(['default', 'student-first', 'compact']);
const VIEW_KEYS = ['schema', 'state', 'appName', 'icon', 'startPicture', 'dashboardPreset', 'palette', 'corrected', 'problem'];
const ICON_ROUTES = ['/student/assets/brand-icon.png'];
const PICTURE_ROUTES = ['/student/assets/start-picture.png', '/student/assets/start-picture.webp'];
const VIEW_IDS = ['view-protection', 'view-apps', 'view-records'];
const DEFAULT_NAME = '케셰브';
const TITLE_SUFFIX = ' · ZTNA & XDR';
// 서버 이름 규칙과 같은 거절 글자. 보이지 않는 서식 글자는 코드 값으로 만든다.
const charRanges = (...pairs) => pairs.map(([a, b]) => String.fromCodePoint(a) + '-' + String.fromCodePoint(b)).join('');
const NAME_HIDDEN = new RegExp('[' + charRanges([0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]) + ']');
const NAME_SYMBOLS = /[<>`\\/:"|?*]/;
const nameRejected = (value) => NAME_HIDDEN.test(value) || NAME_SYMBOLS.test(value);
const HEX = /^#[0-9a-f]{6}$/;
const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v, keys) => isRecord(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const shortText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);

// 서버 DTO 의 형식을 다시 확인한다. 맞지 않으면 null(적용하지 않고 기본 화면).
export function checkAppearanceView(raw) {
  if (!exact(raw, VIEW_KEYS) || raw.schema !== APPEARANCE_VIEW_SCHEMA || !['absent', 'applied', 'invalid'].includes(raw.state)) return null;
  if (!APPEARANCE_PRESETS.includes(raw.dashboardPreset) || !Array.isArray(raw.corrected) || raw.corrected.some((k) => !['accent', 'background', 'surface'].includes(k))) return null;
  if (raw.state !== 'applied') {
    if (raw.appName !== null || raw.icon !== null || raw.startPicture !== null || raw.palette !== null || raw.dashboardPreset !== 'default' || raw.corrected.length) return null;
    if (raw.state === 'absent') return raw.problem === null ? Object.freeze({ state: 'absent' }) : null;
    const p = raw.problem;
    if (!exact(p, ['code', 'file', 'field', 'message']) || !/^APPEARANCE_[A-Z_]{1,40}$/.test(p.code) || !/^student\/(?:appearance\.json|assets\/[a-z-]+\.(?:png|webp))$/.test(p.file)
      || !(p.field === null || shortText(p.field, 80)) || !shortText(p.message, 300)) return null;
    return Object.freeze({ state: 'invalid', problem: Object.freeze({ code: p.code, file: p.file, field: p.field, message: p.message }) });
  }
  if (raw.problem !== null) return null;
  if (raw.appName !== null && (!shortText(raw.appName, 64) || [...raw.appName].length > 32 || raw.appName !== raw.appName.trim() || nameRejected(raw.appName))) return null;
  if (raw.icon !== null && !ICON_ROUTES.includes(raw.icon)) return null;
  if (raw.startPicture !== null && !PICTURE_ROUTES.includes(raw.startPicture)) return null;
  if (raw.palette !== null && (!exact(raw.palette, ['accent', 'accentSoft', 'background', 'surface']) || Object.values(raw.palette).some((c) => !HEX.test(c)))) return null;
  return Object.freeze({ state: 'applied', appName: raw.appName, icon: raw.icon, startPicture: raw.startPicture, dashboardPreset: raw.dashboardPreset });
}

const isStudentCard = (node) => node.classList.contains('card') && node.classList.contains('student');
const holdsStudent = (node) => isStudentCard(node) || (node.classList.contains('grid-2') && [...node.children].some(isStudentCard));
const studentFirst = (list, test) => [...list.filter(test), ...list.filter((node) => !test(node))];
function reorder(parent, ordered) {
  const current = [...parent.children].filter((node) => ordered.includes(node));
  if (current.every((node, i) => node === ordered[i])) return 0;
  for (const node of ordered) parent.appendChild(node); // 이동만 한다. 같은 부모 안이며 노드·이벤트·id 는 그대로다.
  return ordered.length;
}

// 학생 먼저: 각 view 안에서 학생 카드(또는 학생 카드를 담은 2열 묶음)를 제목 바로 뒤로, 2열 묶음 안에서는 학생 카드를 앞으로.
// compact 는 순서를 바꾸지 않고 간격만 줄인다(style.css). default 는 제공 순서 그대로.
export function arrangeDashboard(doc, preset) {
  if (preset !== 'student-first') return 0;
  const active = doc.activeElement;
  let moved = 0;
  for (const id of VIEW_IDS) {
    const view = doc.getElementById(id);
    if (!view) continue;
    // 제목과 첫 화면 그림은 맨 위에 그대로 둔다. 나머지 카드 묶음만 재배치한다.
    const blocks = [...view.children].filter((node) => node.tagName !== 'H1' && !node.classList.contains('start-picture'));
    for (const grid of blocks.filter((node) => node.classList.contains('grid-2'))) moved += reorder(grid, studentFirst([...grid.children], isStudentCard));
    moved += reorder(view, studentFirst(blocks, holdsStudent));
  }
  if (active && active !== doc.activeElement && typeof active.focus === 'function' && active.isConnected) active.focus({ preventScroll: true });
  return moved;
}

export function showAppearanceNotice(doc, text) {
  const target = doc.getElementById('appearance-notice');
  if (!target) return;
  target.textContent = text;
  target.hidden = false;
}

// → {state, applied:[...]} 적용한 항목 이름만 돌려준다.
export function applyStudentAppearance(doc, raw) {
  const view = checkAppearanceView(raw);
  if (!view) {
    showAppearanceNotice(doc, '꾸밈 설정 응답을 확인할 수 없어 기본 화면으로 표시합니다. 다른 기능은 그대로 사용할 수 있습니다.');
    return { state: 'unverified', applied: [] };
  }
  if (view.state === 'absent') return { state: 'absent', applied: [] };
  if (view.state === 'invalid') {
    showAppearanceNotice(doc, `꾸밈 설정을 적용하지 않았습니다(${view.problem.file}${view.problem.field ? ' · ' + view.problem.field : ''}): ${view.problem.message} 기본 화면으로 표시합니다.`);
    return { state: 'invalid', applied: [] };
  }
  const applied = [];
  const name = view.appName ?? DEFAULT_NAME;
  if (view.appName !== null) {
    doc.title = name + TITLE_SUFFIX;
    const brand = doc.getElementById('brand-title');
    if (brand) brand.textContent = name;
    applied.push('appName');
  }
  const fallback = doc.getElementById('brand-mark-fallback');
  if (fallback && view.appName !== null) fallback.textContent = [...name][0];
  if (view.icon !== null) {
    const icon = doc.getElementById('brand-icon');
    if (icon) {
      const broken = () => { icon.hidden = true; if (fallback) fallback.hidden = false; };
      icon.addEventListener('error', broken, { once: true });
      icon.setAttribute('alt', `${name} 아이콘`);
      icon.removeAttribute('aria-hidden');
      icon.hidden = false;
      if (fallback) fallback.hidden = true;
      icon.setAttribute('src', view.icon);
      applied.push('icon');
    }
  }
  if (view.startPicture !== null) {
    const figure = doc.getElementById('start-picture');
    const picture = doc.getElementById('start-picture-image');
    if (figure && picture) {
      picture.addEventListener('load', () => { figure.hidden = false; }, { once: true });
      picture.addEventListener('error', () => { figure.hidden = true; }, { once: true });
      picture.setAttribute('src', view.startPicture);
      applied.push('startPicture');
    }
  }
  doc.documentElement.dataset.appearancePreset = view.dashboardPreset;
  if (arrangeDashboard(doc, view.dashboardPreset) || view.dashboardPreset !== 'default') applied.push('dashboardPreset');
  return { state: 'applied', applied };
}
