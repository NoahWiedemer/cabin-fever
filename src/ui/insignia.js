// Rank insignia (game/progress.js RANKS, Combat Arms' ladder) as inline SVG, US Army style: gold chevrons and
// rockers for the enlisted grades (a diamond, a star or a wreathed star for the top sergeants), then the
// officers' metal: bars, oak leaves, the eagle, and one to five stars. insigniaSvg(index) -> an <svg> string
// (its own gradient ids, so any number can share a page); masterySvg(level) -> the weapon mastery badge.

let uid = 0;

const chev = (y, t = 5, h = 11) => `M6 ${y + h}L32 ${y}L58 ${y + h}L58 ${y + h + t}L32 ${y + t}L6 ${y + h + t}Z`;
const rocker = (y, t = 5, c = 5) => `M6 ${y}Q32 ${y + 2 * c} 58 ${y}L58 ${y + t}Q32 ${y + t + 2 * c} 6 ${y + t}Z`;

function starPath(cx, cy, r, ri = r * 0.42, rot = -Math.PI / 2) {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? ri : r;
    d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * rr).toFixed(2)} ${(cy + Math.sin(a) * rr).toFixed(2)}`;
  }
  return d + 'Z';
}

/** an oak leaf, stem down: an elongated outline with rounded lobes down both sides */
function leafPath() {
  const pts = [];
  const N = 44;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 top .. 1 bottom, down the right side
    const y = 6 + t * 46;
    const w = Math.sin(Math.PI * Math.min(1, t * 1.08)) * 17 * (1 - 0.25 * t);
    const lobe = 1 + 0.28 * Math.pow(Math.abs(Math.sin(t * Math.PI * 4.5)), 0.7);
    pts.push([32 + w * lobe, y]);
  }
  const right = pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`);
  const left = pts.slice().reverse().map(([x, y]) => `${(64 - x).toFixed(2)} ${y.toFixed(2)}`);
  return `M${right.join('L')}L33.5 52L33 60L31 60L30.5 52L${left.join('L')}Z`;
}

// the colonel's eagle: spread wings with feathered edges, a fan tail, the head turned to its right
const EAGLE =
  'M32 17C29 17 27.6 19 27.8 21.2L24.5 22.4L27.9 23.2C28.3 24.3 28.9 25.1 29.6 25.7L18 21L11 11L12.5 19L5 16L9.2 24L3.5 24.5L10.6 29.6L6 31.5L14.4 33.2L12.2 36.4L22.2 34.8L27.4 38.6L25.2 47L29.2 44.6L28.6 52.8L32 49L35.4 52.8L34.8 44.6L38.8 47L36.6 38.6L41.8 34.8L51.8 36.4L49.6 33.2L58 31.5L53.4 29.6L60.5 24.5L54.8 24L59 16L51.5 19L53 11L46 21L34.9 25.4C36.3 24.1 36.9 22.5 36.6 20.6C36.2 18.4 34.3 17 32 17Z';

// the specialist's badge: a curved shield with an eagle's shape in it
const SPEC_SHIELD = 'M6 16L32 5L58 16L58 32Q58 50 32 59Q6 50 6 32Z';
const SPEC_BIRD = 'M32 22L25 18L18 24L25 23L28 27L22 33L29 31L32 37L35 31L42 33L36 27L39 23L46 24L39 18Z';

/** the design of rank i: [paths with their fill ('g' gold, 's' silver, 'k' dark cut-out)] */
function design(i) {
  const g = (d) => ['g', d];
  const s = (d) => ['s', d];
  switch (i) {
    case 0: // Trainee: a hollow chevron
      return [['o', chev(20, 6, 14)]];
    case 1:
      return [g(chev(22, 7, 14))];
    case 2:
      return [g(chev(12, 7, 14)), g(rocker(40, 7, 5))];
    case 3:
      return [g(SPEC_SHIELD), ['k', SPEC_BIRD]];
    case 4:
      return [g(chev(12, 7, 14)), g(chev(24, 7, 14))];
    case 5:
      return [g(chev(8, 6, 13)), g(chev(18, 6, 13)), g(chev(28, 6, 13))];
    default:
      break;
  }
  if (i <= 11) {
    // three chevrons over one to three rockers (+ a diamond, a star, a wreathed star)
    const rockers = Math.min(3, i - 5);
    const out = [g(chev(2)), g(chev(9)), g(chev(16))];
    for (let k = 0; k < rockers; k++) out.push(g(rocker(38 + k * 7)));
    if (i === 9) out.push(g('M32 24L37 30L32 36L27 30Z'));
    if (i >= 10) out.push(g(starPath(32, 30, 6.2)));
    if (i === 11) out.push(['go', 'M22.5 26Q22 34 30 36.5M41.5 26Q42 34 34 36.5']);
    return out;
  }
  switch (i) {
    case 12:
      return [g('M24 6H40V58H24Z')];
    case 13:
      return [s('M24 6H40V58H24Z')];
    case 14:
      return [s('M13 6H29V58H13Z'), s('M35 6H51V58H35Z'), ['k', 'M29 20H35V24H29ZM29 40H35V44H29Z']];
    case 15:
      return [g(leafPath())];
    case 16:
      return [s(leafPath())];
    case 17:
      return [s(EAGLE)];
    default:
      break;
  }
  // generals: one to four stars in a row, the General of the Army's five in a ring
  if (i === 22) {
    const out = [];
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      out.push(s(starPath(32 + Math.cos(a) * 18, 33 + Math.sin(a) * 18, 9.5, 3.9, a)));
    }
    return out;
  }
  const n = i - 17;
  const r = [0, 16, 13, 10, 8.4][n];
  const gap = r * 2.08;
  const out = [];
  for (let k = 0; k < n; k++) out.push(s(starPath(32 + (k - (n - 1) / 2) * gap, 33, r)));
  return out;
}

/** the insignia of rank `index` as an <svg> string; opts.cls adds a class */
export function insigniaSvg(index, opts = {}) {
  const i = Math.max(0, Math.min(22, index | 0));
  const id = 'ins' + ++uid;
  const defs = `<defs>
    <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#e8b64a"/><stop offset="1" stop-color="#9a6516"/></linearGradient>
    <linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#b9c1ca"/><stop offset="1" stop-color="#6c747e"/></linearGradient>
  </defs>`;
  const paint = design(i)
    .map(([f, d]) => {
      if (f === 'o') return `<path d="${d}" fill="none" stroke="#c9ccd1" stroke-width="2.4" stroke-linejoin="round"/>`;
      if (f === 'go') return `<path d="${d}" fill="none" stroke="url(#${id}g)" stroke-width="3" stroke-linecap="round"/>`;
      if (f === 'k') return `<path d="${d}" fill="#15171a"/>`;
      return `<path d="${d}" fill="url(#${id}${f})" stroke="rgba(20,14,4,.75)" stroke-width="1.2" stroke-linejoin="round"/>`;
    })
    .join('');
  return `<svg class="cf-insignia${opts.cls ? ' ' + opts.cls : ''}" viewBox="0 0 64 64" aria-hidden="true">${defs}${paint}</svg>`;
}

/** weapon mastery badge: a shield with the level; gold from 10 */
export function masterySvg(level = 0) {
  const id = 'mst' + ++uid;
  const lv = Math.max(0, level | 0);
  const top = lv >= 10;
  const c0 = top ? '#fff1a8' : lv >= 6 ? '#d4dde6' : lv >= 3 ? '#e2a45c' : '#8d949c';
  const c1 = top ? '#b9791c' : lv >= 6 ? '#6f7a86' : lv >= 3 ? '#7a4418' : '#43484e';
  return `<svg class="cf-mastery" viewBox="0 0 40 44" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs><path d="M20 2L37 8V21C37 31 29 38 20 42C11 38 3 31 3 21V8Z" fill="url(#${id})" stroke="rgba(0,0,0,.6)" stroke-width="1.5"/><text x="20" y="27" text-anchor="middle" font-family="Teko, Impact, sans-serif" font-size="19" font-weight="700" fill="#101214">${lv}</text></svg>`;
}
