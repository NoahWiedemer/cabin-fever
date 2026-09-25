/*
 * CABIN FEVER — in-game HUD (pure DOM + CSS + Canvas2D).
 *
 * Layout follows the Combat Arms (2009) Fireteam HUD:
 *   top-center score/time, top-right radar + round, bottom-left vitals,
 *   bottom-right weapon/ammo, top-left kill feed, center crosshair.
 *
 * update() is called every frame: all DOM writes go through a value cache so
 * elements are only touched when their value actually changes. The radar is a
 * <canvas> redrawn each frame.
 */

const FONT_HREF =
  'https://fonts.googleapis.com/css2?family=Black+Ops+One&family=Rajdhani:wght@500;600;700&family=Share+Tech+Mono&family=Teko:wght@400;500;600;700&display=swap';

export function ensureUiFonts() {
  try {
    if (typeof document === 'undefined' || document.getElementById('cf-ui-fonts')) return;
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect';
    pre1.href = 'https://fonts.gstatic.com';
    pre1.crossOrigin = 'anonymous';
    const l = document.createElement('link');
    l.id = 'cf-ui-fonts';
    l.rel = 'stylesheet';
    l.href = FONT_HREF;
    document.head.appendChild(pre1);
    document.head.appendChild(l);
  } catch (_) {
    /* fonts are optional — CSS has fallbacks */
  }
}

/* ------------------------------------------------------------------ utils */

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC_MAP[c]);

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function pad(n, w) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return String(v).padStart(w, '0');
}

function fmtTime(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ icons */

// Weapon silhouettes in a 128x40 box, muzzle to the right. evenodd for cut-outs.
const WPN_PATHS = {
  rifle:
    'M3 12L8 11L10 12L30 13L30 14L36 14L36 11L40 11L40 8L40 5L46 5L46 8L64 8L64 11L74 11L74 12L95 12L96.5 5L98.5 5L100 12L100 15L118 15L118 14L126 14L126 19L118 19L118 18L100 18L100 21L74 21L74 22L68 22L67 30L65 37L56 35L58 29L58.5 26L50 26L50 24L48 24L46 34L38 33L40 22L36 22L36 18L30 18L28 22L12 25L8 27L3 27Z' +
    'M78 14.5h3v4h-3zM84 14.5h3v4h-3zM90 14.5h3v4h-3z',
  shotgun:
    'M3 11L8 10L10 11L30 12L33 11L36 11L36 10L60 10L60 6L66 6L66 10L70 10L70 12L118 12L118 9L121 9L121 12L124 12L124 15.5L102 15.5L102 17L112 17L112 16.5L116 16.5L116 22L112 22L112 21.5L98 21.5L98 23L70 23L70 21L58 21L58 25L50 25L50 23L48 23L45 34L37 33L40 21L36 21L30 21L12 24L8 26L3 26Z' +
    'M12 15L28 15.5L28 18.5L12 20.5Z',
  sniper:
    'M2 12L6 11L22 14L30 17L40 17L44 15L44 13L55 13L55 9L54 9L52 11L44 10L44 5L52 4L54 6L60 6L60 3.5L64 3.5L64 6L70 6L72 4L82 4L82 10L72 10L70 9L69 9L69 13L76 13L76 14.5L120 14.5L120 13.5L126 13.5L126 18L120 18L120 17L96 17L96 23L88 23.4L110 25L110 26.5L88 25L76 24L66 24L66 30L58 30L58 24L56 24L55 25L53 25L51.5 21.5L50 22L42 22L36 30L30 30L33 23L26 23L10 26L6 28L2 28Z' +
    'M58 9h8v4h-8zM31 19.5L38 19.5L36 22L31 22Z',
  pistol:
    'M40 9L92 9L92 12L94 12L94 15L92 15L92 18L66 18L66 24L58 24L56 21L56 22L53 36L41 36L45 19L40 18Z' +
    'M58 19.5h6v2.5h-5z',
  knife:
    'M8 16L40 15L42 17L42 11L46 11L46 15L100 15L118 19L108 23L46 24L46 29L42 29L42 23L40 25L8 24L6 20Z' +
    'M14 18.5h20v2h-20z',
  grenade:
    'M54 24a10 12 0 1 0 20 0a10 12 0 1 0 -20 0ZM58 9L70 9L75 10L74 26L71.5 26L71.5 13L58 13Z' +
    'M50 9a4 4 0 1 0 8 0a4 4 0 1 0 -8 0ZM52 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0Z',
};

export function weaponKind(name) {
  const n = String(name || '').toLowerCase();
  if (/knife|kukri|machete|axe|melee|blade/.test(n)) return 'knife';
  if (/grenade|frag|\bhe\b|explos|mine|c4|molotov|cocktail|softball/.test(n)) return 'grenade';
  if (/l96|sniper|awm|awp|barrett|m82|dragunov|svd|psg|msg|intervention|\bm24\b|scout/.test(n)) return 'sniper';
  if (/super ?90|shotgun|spas|m1014|870|saiga|aa-?12|usas|benelli/.test(n)) return 'shotgun';
  if (/pistol|m9|m1911|glock|deagle|desert eagle|p226|usp|revolver|python|five-?seven|mk23/.test(n)) return 'pistol';
  return 'rifle';
}

export function weaponSvg(kind, cls = '') {
  const p = WPN_PATHS[kind] || WPN_PATHS.rifle;
  return `<svg class="${cls}" viewBox="0 0 128 40" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${p}"/></svg>`;
}

const SKULL_SVG =
  '<svg class="cf-skull" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 1C4.2 1 1.5 3.6 1.5 7c0 2 1 3.4 2.5 4.2v2.3c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5v-2.3c1.5-.8 2.5-2.2 2.5-4.2C14.5 3.6 11.8 1 8 1ZM3.9 7.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0ZM8.7 7.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0ZM8 9.3L7.1 10.8h1.8ZM6.3 12.6h.9v2.4h-.9ZM7.55 12.6h.9v2.4h-.9ZM8.8 12.6h.9v2.4h-.9Z"/></svg>';

const HAZARD_SVG =
  '<svg viewBox="0 0 24 22" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M12 1L23 21H1ZM10.8 8h2.4l-.4 6.5h-1.6ZM10.7 16.2h2.6v2.4h-2.6Z"/></svg>';

const GRENADE_SVG =
  '<svg class="cf-gren-ico" viewBox="46 3 32 36" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="' +
  WPN_PATHS.grenade +
  '"/></svg>';

const MOLOTOV_SVG =
  '<svg class="cf-gren-ico" viewBox="0 0 32 36" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M10 17Q10 13.5 13 12.5L13.6 8L18.4 8L19 12.5Q22 13.5 22 17L22 33Q22 35 20 35L12 35Q10 35 10 33ZM13 20h6v8h-6zM13.4 8L12 3.5L14.6 5L16 1L17.6 4.6L20.4 3L18.6 8Z"/></svg>';

const GASMASK_SVG =
  '<svg class="cf-mask-ico" viewBox="32 -4 64 44" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M44 5Q64 -3 84 5Q92 13 88 24Q85 30 76 32L52 32Q43 30 40 24Q36 13 44 5ZM48 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0ZM66 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0ZM57 33h14v6h-14ZM34 11L39 10L39 17L34 18ZM94 11L89 10L89 17L94 18Z"/></svg>';

/** "$ 1,250" style money formatting. */
export const fmtCash = (n) => Math.max(0, Math.round(Number(n) || 0)).toLocaleString('en-US');

/** Rank insignia (0-5), CA style: chevrons → rocker → bar → star. */
export function rankSvg(rank = 0) {
  const r = clamp(Math.round(Number(rank) || 0), 0, 5);
  const chev = (y) => `M2 ${y + 3}L8 ${y}L14 ${y + 3}L14 ${y + 5.6}L8 ${y + 2.6}L2 ${y + 5.6}Z`;
  let d = '';
  if (r === 0) d = chev(5);
  else if (r === 1) d = chev(3) + chev(8);
  else if (r === 2) d = chev(1) + chev(5.5) + chev(10);
  else if (r === 3) d = chev(1) + chev(5.5) + 'M2 11.5Q8 16 14 11.5L14 14Q8 18.2 2 14Z';
  else if (r === 4) d = 'M3 3h10v10h-10ZM5.2 5.2v5.6h5.6v-5.6Z';
  else d = 'M8 1.2L9.9 6.1L15.1 6.3L11 9.5L12.4 14.6L8 11.7L3.6 14.6L5 9.5L.9 6.3L6.1 6.1Z';
  return `<svg class="cf-rank cf-rank-${r}" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${d}"/></svg>`;
}

// Soldier silhouettes (48x96 box). Standing: low-ready rifle. Crouching: kneeling.
const STAND_SVG = `<svg class="cf-sil-stand" viewBox="0 0 48 96" aria-hidden="true"><g fill="currentColor">
<path d="M16.6 9.6C16.6 4.6 20.2 1.4 24.6 1.4C29.4 1.4 32.8 4.4 32.8 9.2L34.2 10.9L31.4 11.2L30.8 15.2C30.3 18 28.3 19.8 25.1 19.8C22 19.8 19.9 18 19.3 15.3L18.9 11.3L15.6 11Z"/>
<path d="M22 18.6h6.2v4.2H22Z"/>
<path d="M15.2 22.4C17.6 21 21 20.6 25 20.6C29.2 20.6 32.4 21 34.8 22.4L37.2 24.6L37.8 34.2L35.4 47.6L14.8 47.6L12.5 34.4L12.9 24.6Z"/>
<path d="M14.4 46.8H35.8L36.3 51.2H13.9Z"/>
<path d="M13 23.8L9.3 31.4L9.8 39.4L15.4 41.8L17.4 37.6L14.2 34.6L15.6 28Z"/>
<path d="M36.8 24L40.2 30.6L38.4 38.6L31.4 40.8L30 36.6L34.3 33.4L33.2 27.4Z"/>
<path d="M4.6 45.2L6.8 41.4L39.6 30.2L43.9 28.6L45.2 30.3L41.4 32.8L42.2 34.4L38.2 35.4L33.2 37.2L30.6 43.4L27.4 42.4L28.3 38.8L12.4 44.3L8.6 48.6Z"/>
<path d="M14.2 51H24.3L23.9 60.4L22.3 74.4L21.9 87.6H15.6L16.1 74.2L14.9 60.6Z"/>
<path d="M25.8 51H35.8L35.6 60.6L34.4 74.4L34.9 87.6H28.6L28.1 74.4L26.6 60.4Z"/>
<path d="M14.8 86.8H22.4L23.4 93.4H12.6Z"/>
<path d="M28.2 86.8H35.4L37.6 93.4H27.6Z"/>
</g></svg>`;

const CROUCH_SVG = `<svg class="cf-sil-crouch" viewBox="0 0 48 96" aria-hidden="true"><g fill="currentColor">
<path d="M18.6 33.8C18.6 29.2 21.9 26.4 26 26.4C30.4 26.4 33.6 29.2 33.6 33.4L34.8 35L32.2 35.3L31.7 38.9C31.2 41.5 29.4 43.1 26.4 43.1C23.6 43.1 21.6 41.5 21.1 39L20.8 35.4L17.7 35.1Z"/>
<path d="M23.4 42h5.8v3.8h-5.8Z"/>
<path d="M17.4 45.4C19.6 44.2 22.6 43.9 26.2 43.9C30 43.9 33 44.4 35 45.6L37 47.8L36.2 57L32.8 67.4L16.2 66.4L14.9 56.4L15.4 47.6Z"/>
<path d="M15.6 47.2L12.2 53.8L12.9 60.9L18.2 62.8L19.9 59.2L17 56.4L18 50.8Z"/>
<path d="M36 47.4L39.2 53.2L37.4 60.4L31 62.4L29.8 58.6L33.6 55.8L32.7 50.4Z"/>
<path d="M7.8 66.2L9.8 62.8L39.8 52.8L43.8 51.4L45 53L41.4 55.3L42.1 56.8L38.4 57.7L33.8 59.3L31.4 65L28.4 64.1L29.2 60.8L14.8 65.6L11.4 69.4Z"/>
<path d="M16 65.6L33 66.4L39.6 69.6L41 73.2L38.6 76.4L30.4 74.8L17.2 72.4Z"/>
<path d="M34.2 72.2H41.2L40.6 87.2L34.8 87.2Z"/>
<path d="M33.8 86.4H41.2L43.2 93.2H33.2Z"/>
<path d="M16.4 70.6L23.2 71.6L22.4 88.8L16.6 88.8Z"/>
<path d="M17 86.2L22.8 88.4L10.6 93.4L4.2 93.4L4.6 91.2Z"/>
</g></svg>`;

const SCOPE_SVG = (() => {
  // viewBox -1000..1000 maps to the clear lens circle. Mil-dots every 60u out to the posts.
  let dots = '';
  for (let i = 1; i <= 4; i++) {
    const d = i * 60;
    dots += `<ellipse cx="${d}" cy="0" rx="4.2" ry="6"/><ellipse cx="${-d}" cy="0" rx="4.2" ry="6"/>`;
    dots += `<ellipse cx="0" cy="${d}" rx="6" ry="4.2"/><ellipse cx="0" cy="${-d}" rx="6" ry="4.2"/>`;
  }
  return `<svg class="cf-scope-ret" viewBox="-1000 -1000 2000 2000" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
<g fill="#000">
<path d="M300 -4.5L1000 -13L1000 13L300 4.5Z"/>
<path d="M-300 -4.5L-1000 -13L-1000 13L-300 4.5Z"/>
<path d="M-4.5 300L-13 1000L13 1000L4.5 300Z"/>
<path d="M-3 -300L-8 -1000L8 -1000L3 -300Z"/>
${dots}
</g>
<g stroke="#000" fill="none">
<line x1="-300" y1="0" x2="300" y2="0"/>
<line x1="0" y1="-300" x2="0" y2="300"/>
<line x1="-18" y1="-150" x2="18" y2="-150"/>
<line x1="-12" y1="150" x2="12" y2="150"/>
<line x1="-12" y1="210" x2="12" y2="210"/>
</g>
</svg>`;
})();

const DMG_ARC_SVG = `<svg class="cf-dmg-arc" viewBox="-160 -160 320 320" aria-hidden="true">
<defs><linearGradient id="cf-dmg-grad" gradientUnits="userSpaceOnUse" x1="-72" y1="0" x2="72" y2="0">
<stop offset="0" stop-color="#ff2a1a" stop-opacity="0"/><stop offset=".3" stop-color="#ff2a1a" stop-opacity=".85"/>
<stop offset=".5" stop-color="#ff5a3a" stop-opacity="1"/><stop offset=".7" stop-color="#ff2a1a" stop-opacity=".85"/>
<stop offset="1" stop-color="#ff2a1a" stop-opacity="0"/></linearGradient></defs>
<path d="M-70.4 -119.3A138.5 138.5 0 0 1 70.4 -119.3" fill="none" stroke="url(#cf-dmg-grad)" stroke-width="11"/>
<path d="M-52 -128.4A138.5 138.5 0 0 1 52 -128.4" fill="none" stroke="#ffd2c8" stroke-opacity=".55" stroke-width="1.6"/>
<path d="M-9 -145L0 -156L9 -145Z" fill="#ff3a26"/>
</svg>`;

/* ------------------------------------------------------------------ markup */

const HUD_HTML = `
<div class="cf-vig cf-vig-low"><div class="cf-vig-beat"></div></div>
<div class="cf-vig cf-vig-gas"></div>
<div class="cf-vig cf-vig-dmg"></div>
<div class="cf-vig cf-vig-mask"></div>
<div class="cf-scope"><div class="cf-scope-mask"></div><div class="cf-scope-lens"></div>${SCOPE_SVG}</div>
<div class="cf-dmg"></div>
<div class="cf-plates"></div>
<div class="cf-center">
  <div class="cf-xhair"><i class="t"></i><i class="r"></i><i class="b"></i><i class="l"></i><b></b></div>
  <div class="cf-hit"><i></i><i></i><i></i><i></i></div>
  <div class="cf-pops"></div>
  <div class="cf-hold"><svg viewBox="0 0 44 44" aria-hidden="true"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" pathLength="100"/></svg><span>HOLD <b class="cf-key">F</b> READY FOR THE NEXT ROUND</span></div>
</div>
<div class="cf-fps"></div>
<div class="cf-killfeed"></div>
<div class="cf-top">
  <div class="cf-mode">FIRETEAM - HARD</div>
  <div class="cf-score"><span class="cf-score-lbl">SCORE</span><span class="cf-score-sep">:</span><span class="cf-score-val cf-metal">000000</span></div>
  <div class="cf-time">00:00</div>
  <div class="cf-cash cf-hide"><span class="cf-cash-sign">$</span><b class="cf-cash-val">0</b><span class="cf-cash-pops"></span></div>
  <div class="cf-countdown"><span class="cf-cd-lbl">NEXT ROUND IN</span><span class="cf-cd-num">0</span></div>
  <div class="cf-buy"><div class="cf-buy-t">BUY PHASE</div><div class="cf-buy-s"></div></div>
</div>
<div class="cf-gaswarn">${HAZARD_SVG}<span>TOXIC GAS</span>${HAZARD_SVG}</div>
<div class="cf-mask">${GASMASK_SVG}<div class="cf-mask-bar"><i></i></div><b>0.0s</b></div>
<div class="cf-wp"><i class="cf-wp-dia"></i><span class="cf-wp-l"></span><b class="cf-wp-d"></b><i class="cf-wp-arrow"></i></div>
<div class="cf-radar">
  <div class="cf-radar-disc"><canvas class="cf-radar-cv"></canvas></div>
  <div class="cf-round"><span class="cf-round-num">00/00</span><span class="cf-round-lbl">ROUND</span></div>
  <div class="cf-infected"><span>INFECTED</span><b>0</b></div>
</div>
<div class="cf-banner">
  <div class="cf-banner-title"></div>
  <div class="cf-banner-rule"><i></i></div>
  <div class="cf-banner-sub"></div>
</div>
<div class="cf-reload"></div>
<div class="cf-pickup"></div>
<div class="cf-pickup cf-interact"></div>
<div class="cf-vitals">
  <div class="cf-sil">${STAND_SVG}${CROUCH_SVG}<span class="cf-sp">SP</span></div>
  <div class="cf-vit-main">
    <div class="cf-vit-row">
      <span class="cf-hp"><small>HP.</small><b>100</b></span>
      <span class="cf-ap"><small>AP.</small><b>100</b></span>
    </div>
    <div class="cf-bar cf-bar-hp"><div class="cf-bar-fill"></div><div class="cf-bar-ticks"></div></div>
  </div>
</div>
<div class="cf-weapon">
  <div class="cf-wpn-top"><span class="cf-reloading">RELOADING</span><span class="cf-wpn-name"></span></div>
  <div class="cf-ammo-row">
    <div class="cf-gren">${GRENADE_SVG}<span class="cf-gren-x">×</span><b>0</b></div>
    <div class="cf-gren cf-molo cf-hide">${MOLOTOV_SVG}<span class="cf-gren-x">×</span><b>0</b></div>
    <div class="cf-ammo"><b class="cf-mag">000</b><span class="cf-res">/000</span></div>
  </div>
  <div class="cf-bar cf-bar-mag"><div class="cf-bar-fill"></div><div class="cf-bar-ticks"></div></div>
</div>
<div class="cf-board">
  <div class="cf-board-panel">
    <div class="cf-board-head">
      <div class="cf-board-title"><span class="cf-board-diff">FIRETEAM - HARD</span></div>
      <div class="cf-board-meta"></div>
    </div>
    <div class="cf-sb-row cf-sb-hdr"><span></span><span>NAME</span><span>SCORE</span><span>KILLS</span><span>DEATHS</span><span>HEADSHOTS</span></div>
    <div class="cf-board-rows"></div>
    <div class="cf-board-foot"><span>CABIN FEVER</span><span class="cf-board-foot-r"></span></div>
  </div>
</div>
`;

const INFECTED_RE = /infect|zombie|mutant|boss|crawler|brute|hound|spitter|ghoul|undead|horde|butcher|charger/i;

/* ================================================================== HUD */

export class HUD {
  constructor(rootElement) {
    ensureUiFonts();
    this.host = rootElement || document.body;
    const root = (this.root = document.createElement('div'));
    root.className = 'cf-hud';
    root.innerHTML = HUD_HTML;
    this.host.appendChild(root);

    const q = (s) => root.querySelector(s);
    this.$ = {
      vigLow: q('.cf-vig-low'),
      vigGas: q('.cf-vig-gas'),
      vigDmg: q('.cf-vig-dmg'),
      scope: q('.cf-scope'),
      dmg: q('.cf-dmg'),
      plates: q('.cf-plates'),
      xhair: q('.cf-xhair'),
      hit: q('.cf-hit'),
      pops: q('.cf-pops'),
      fps: q('.cf-fps'),
      feed: q('.cf-killfeed'),
      mode: q('.cf-mode'),
      score: q('.cf-score-val'),
      time: q('.cf-time'),
      cd: q('.cf-countdown'),
      cdNum: q('.cf-cd-num'),
      gas: q('.cf-gaswarn'),
      radarDisc: q('.cf-radar-disc'),
      radar: q('.cf-radar-cv'),
      round: q('.cf-round'),
      roundNum: q('.cf-round-num'),
      infected: q('.cf-infected'),
      infectedNum: q('.cf-infected b'),
      banner: q('.cf-banner'),
      bTitle: q('.cf-banner-title'),
      bSub: q('.cf-banner-sub'),
      reload: q('.cf-reload'),
      pickup: q('.cf-pickup'),
      sil: q('.cf-sil'),
      hp: q('.cf-hp'),
      hpNum: q('.cf-hp b'),
      apNum: q('.cf-ap b'),
      hpBar: q('.cf-bar-hp'),
      hpFill: q('.cf-bar-hp .cf-bar-fill'),
      weapon: q('.cf-weapon'),
      wpnName: q('.cf-wpn-name'),
      reloading: q('.cf-reloading'),
      gren: q('.cf-gren'),
      grenNum: q('.cf-gren b'),
      molo: q('.cf-molo'),
      moloNum: q('.cf-molo b'),
      vigMask: q('.cf-vig-mask'),
      hold: q('.cf-hold'),
      holdFg: q('.cf-hold .fg'),
      buy: q('.cf-buy'),
      buyS: q('.cf-buy-s'),
      interact: q('.cf-interact'),
      mask: q('.cf-mask'),
      maskFill: q('.cf-mask-bar i'),
      maskSecs: q('.cf-mask b'),
      wp: q('.cf-wp'),
      wpL: q('.cf-wp-l'),
      wpD: q('.cf-wp-d'),
      wpArrow: q('.cf-wp-arrow'),
      cash: q('.cf-cash'),
      cashVal: q('.cf-cash-val'),
      cashPops: q('.cf-cash-pops'),
      ammo: q('.cf-ammo'),
      mag: q('.cf-mag'),
      res: q('.cf-res'),
      magBar: q('.cf-bar-mag'),
      magFill: q('.cf-bar-mag .cf-bar-fill'),
      board: q('.cf-board'),
      boardDiff: q('.cf-board-diff'),
      boardMeta: q('.cf-board-meta'),
      boardRows: q('.cf-board-rows'),
      boardFoot: q('.cf-board-foot-r'),
    };

    this._c = new Map(); // value cache for DOM writes
    this._segments = [];
    this._scoped = false;
    this._visible = true;
    this._state = null;
    this._time = 0;

    this.radarRange = 30; // meters from center to rim

    // damage arcs pool
    this._arcs = [];
    for (let i = 0; i < 6; i++) {
      const w = document.createElement('div');
      w.className = 'cf-dmg-wrap';
      w.innerHTML = DMG_ARC_SVG;
      this.$.dmg.appendChild(w);
      this._arcs.push(w);
    }
    this._arcIdx = 0;

    // banners
    this._bannerQueue = [];
    this._bannerCur = null;
    this._bannerTimer = 0;
    this._bannerStart = 0;

    // nameplates
    this._plates = new Map();

    // scoreboard
    this._boardKey = '';

    // radar canvas
    this._ctx = this.$.radar.getContext('2d');
    this._rdpr = 1;
    this._rsize = 0;
    this._setupRadarSizing();

    // initial state
    this._text(this.$.reload, 'reload', '');
  }

  /* ------------------------------------------------------------ helpers */

  _set(key, val) {
    if (this._c.get(key) === val) return false;
    this._c.set(key, val);
    return true;
  }

  _text(el, key, val) {
    if (this._set(key, val)) el.textContent = val;
  }

  _cls(el, cls, key, on) {
    on = !!on;
    if (this._set(key, on)) el.classList.toggle(cls, on);
  }

  _setupRadarSizing() {
    const cv = this.$.radar;
    const measure = (w) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.max(1, Math.round(w * dpr));
      if (px !== this._rsize) {
        this._rsize = px;
        this._rdpr = dpr;
        cv.width = px;
        cv.height = px;
      }
    };
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver((entries) => {
        for (const e of entries) measure(e.contentRect.width);
      });
      this._ro.observe(this.$.radarDisc);
    } else {
      const onR = () => measure(this.$.radarDisc.clientWidth);
      window.addEventListener('resize', onR);
      requestAnimationFrame(onR);
    }
  }

  /* ------------------------------------------------------------ API */

  setVisible(v) {
    v = !!v;
    this._visible = v;
    this.root.classList.toggle('cf-off', !v);
  }

  setMapOutline(segments) {
    this._segments = Array.isArray(segments) ? segments.filter((s) => s && s.length >= 4) : [];
  }

  update(state, dt = 0) {
    if (!state) return;
    this._state = state;
    this._time += dt || 0;
    const $ = this.$;

    /* top center */
    this._text($.mode, 'mode', `${state.modeLabel ?? 'FIRETEAM'} - ${String(state.difficulty ?? 'NORMAL').toUpperCase()}`);
    this._text($.score, 'score', pad(state.score, 6));
    const hasTime = state.timeLeft != null && isFinite(state.timeLeft);
    this._cls($.time, 'cf-hide', 'timeHide', !hasTime);
    if (hasTime) {
      this._text($.time, 'time', fmtTime(state.timeLeft));
      this._cls($.time, 'warn', 'timeWarn', state.timeLeft <= 60);
    }
    const hasCash = state.cash != null;
    this._cls($.cash, 'cf-hide', 'cashHide', !hasCash);
    if (hasCash) this._text($.cashVal, 'cash', fmtCash(state.cash));

    /* round + infected */
    const round = Number(state.round) || 0;
    const inRound = round > 0;
    this._cls($.round, 'on', 'roundOn', inRound);
    if (inRound) {
      const w = Math.max(2, String(state.maxRounds ?? 0).length);
      // endless mode has no cap (maxRounds null)
      this._text($.roundNum, 'round', state.maxRounds == null ? `${pad(round, 2)}/∞` : `${pad(round, w)}/${pad(state.maxRounds, w)}`);
    }
    const showInf = inRound && state.enemiesLeft != null;
    this._cls($.infected, 'on', 'infOn', showInf);
    if (showInf) this._text($.infectedNum, 'inf', String(Math.max(0, state.enemiesLeft | 0)));

    /* vitals */
    const maxHp = Math.max(1, Number(state.maxHp) || 100);
    const hp = clamp(Math.ceil(Number(state.hp) || 0), 0, 999);
    this._text($.hpNum, 'hp', pad(hp, 3));
    this._text($.apNum, 'ap', pad(clamp(Math.ceil(Number(state.ap) || 0), 0, 999), 3));
    const lowHp = hp < 30;
    this._cls($.hp, 'low', 'hpLow', lowHp);
    this._cls($.hpBar, 'low', 'hpBarLow', lowHp);
    const hpFrac = Math.round(clamp(hp / maxHp, 0, 1) * 500) / 500;
    if (this._set('hpFrac', hpFrac)) $.hpFill.style.transform = `scaleX(${hpFrac})`;
    this._cls($.sil, 'crouched', 'crouch', state.crouching);
    this._cls($.sil, 'hurt', 'silHurt', lowHp);

    /* weapon */
    this._text($.wpnName, 'wname', String(state.weaponName ?? '').toUpperCase());
    const showAmmo = state.showAmmo !== false;
    this._cls($.weapon, 'noammo', 'noAmmo', !showAmmo);
    const ammo = Math.max(0, Number(state.ammo) | 0);
    const mag = Math.max(0, Number(state.magSize) | 0);
    const reserve = Math.max(0, Number(state.reserve) | 0);
    if (showAmmo) {
      this._text($.mag, 'ammo', pad(ammo, 3));
      this._text($.res, 'res', `/${pad(reserve, 3)}`);
      const low = mag > 0 && ammo / mag < 0.25;
      this._cls($.ammo, 'low', 'ammoLow', low && ammo > 0);
      this._cls($.ammo, 'empty', 'ammoEmpty', ammo === 0);
      this._cls($.magBar, 'low', 'magBarLow', low);
      const mf = mag > 0 ? Math.round(clamp(ammo / mag, 0, 1) * 500) / 500 : 0;
      if (this._set('magFrac', mf)) $.magFill.style.transform = `scaleX(${mf})`;
    }
    const reloading = !!state.reloading;
    this._cls($.reloading, 'on', 'reloading', reloading && showAmmo);
    const hasGren = state.grenades != null;
    this._cls($.gren, 'cf-hide', 'grenHide', !hasGren);
    if (hasGren) {
      const g = Math.max(0, state.grenades | 0);
      this._text($.grenNum, 'gren', String(g));
      this._cls($.gren, 'zero', 'grenZero', g === 0);
    }
    const molo = Math.max(0, state.molotovs | 0);
    this._cls($.molo, 'cf-hide', 'moloHide', !molo);
    if (molo) this._text($.moloNum, 'molo', String(molo));

    /* reload hint */
    let hint = '';
    if (showAmmo && ammo === 0 && !reloading) hint = reserve > 0 ? 'reload' : 'noammo';
    if (this._set('hint', hint)) {
      $.reload.innerHTML =
        hint === 'reload' ? 'RELOAD <span class="cf-key">R</span>' : hint === 'noammo' ? 'NO AMMO' : '';
      $.reload.classList.toggle('on', !!hint);
      $.reload.classList.toggle('dry', hint === 'noammo');
    }

    /* crosshair: gap (px) = the live spread cone; alpha fades it for ADS / sprint; ring for shotguns */
    const ch = state.crosshair || {};
    const xa = ch.visible !== false && !this._scoped ? Math.round(clamp(ch.alpha ?? 1, 0, 1) * 20) / 20 : 0;
    this._cls($.xhair, 'off', 'xOff', xa <= 0);
    if (this._set('xAlpha', xa)) $.xhair.style.opacity = String(xa);
    this._cls($.xhair, 'ring', 'xRing', ch.style === 'ring');
    if (xa > 0) {
      const g = Math.round(clamp(Number(ch.spread) || 0, 0, 400) * 2) / 2;
      if (this._set('xgap', g)) $.xhair.style.setProperty('--g', `${g}px`);
    }

    /* screen effects */
    const low = Math.round(clamp(Number(state.lowHealth) || 0, 0, 1) * 50) / 50;
    if (this._set('vLow', low)) $.vigLow.style.opacity = String(low);
    const gas = Math.round(clamp(Number(state.inGas) || 0, 0, 1) * 50) / 50;
    if (this._set('vGas', gas)) $.vigGas.style.opacity = String(gas);
    this._cls($.gas, 'on', 'gasOn', gas > 0.04);

    /* radar */
    this._drawRadar(state.radar);

    /* scoreboard meta when open */
    if (this._c.get('boardOn')) this._updateBoardMeta();
  }

  addKill({ killer, victim, weapon, headshot } = {}) {
    const row = document.createElement('div');
    row.className = 'cf-kf-row' + (headshot ? ' hs' : '');
    const victimInfected = INFECTED_RE.test(String(victim || ''));
    const killerInfected = INFECTED_RE.test(String(killer || '')) && !victimInfected;
    const kCls = killerInfected ? 'cf-kf-enemy' : 'cf-kf-ally';
    const vCls = victimInfected ? 'cf-kf-enemy' : killerInfected ? 'cf-kf-ally' : 'cf-kf-enemy';
    row.innerHTML =
      `<span class="cf-kf-name ${kCls}">${esc(killer ?? '')}</span>` +
      `<span class="cf-kf-wpn">${weaponSvg(weaponKind(weapon))}</span>` +
      (headshot ? `<span class="cf-kf-hs">${SKULL_SVG}</span>` : '') +
      `<span class="cf-kf-name ${vCls}">${esc(victim ?? '')}</span>`;
    const feed = this.$.feed;
    feed.appendChild(row);
    while (feed.children.length > 5) feed.firstElementChild.remove();
    setTimeout(() => {
      row.classList.add('out');
      setTimeout(() => row.remove(), 520);
    }, 5000);
  }

  popScore(amount, label) {
    const amt = Math.round(Number(amount) || 0);
    const neg = amt < 0;
    const lbl = label ? String(label) : '';
    const lblCls = /head/i.test(lbl) ? 'hs' : /combo|multi|streak|kill/i.test(lbl) ? 'combo' : '';
    const s = clamp(0.9 + Math.log10(Math.max(10, Math.abs(amt))) * 0.12, 1, 1.45);

    // Older popups get pushed up so combos stack instead of overprinting.
    const pops = this.$.pops;
    const step = 34 * s;
    for (const p of pops.children) {
      p._push = (p._push || 0) + step;
      p.style.transform = `translate3d(0, calc(var(--u) * ${-p._push}), 0)`;
    }

    const wrap = document.createElement('div');
    wrap.className = 'cf-pop-wrap';
    wrap._push = 0;
    const el = document.createElement('div');
    el.className = 'cf-pop' + (neg ? ' neg' : '') + (lblCls ? ` ${lblCls}` : '');
    el.innerHTML =
      (amt === 0 && lbl ? '' : `<span class="cf-pop-num">${neg ? '-' : '+'}${Math.abs(amt)}</span>`) +
      (lbl ? `<span class="cf-pop-lbl ${lblCls}">${esc(lbl.toUpperCase())}</span>` : '');
    el.style.setProperty('--s', s.toFixed(3));
    el.style.setProperty('--dx', `calc(var(--u) * ${((Math.random() * 2 - 1) * 8).toFixed(1)})`);
    el.addEventListener('animationend', () => wrap.remove(), { once: true });
    wrap.appendChild(el);
    pops.appendChild(wrap);
    while (pops.children.length > 7) pops.firstElementChild.remove();
  }

  /** "+$60" rising next to the wallet. */
  popCash(amount) {
    const amt = Math.round(Number(amount) || 0);
    if (!amt || !this._visible) return;
    const pops = this.$.cashPops;
    const el = document.createElement('span');
    el.className = 'cf-cash-pop' + (amt < 0 ? ' neg' : amt >= 200 ? ' big' : '');
    el.textContent = `${amt < 0 ? '-' : '+'}$${fmtCash(Math.abs(amt))}`;
    el.addEventListener('animationend', () => el.remove(), { once: true });
    pops.appendChild(el);
    while (pops.children.length > 4) pops.firstElementChild.remove();
    const v = this.$.cashVal;
    if (v.animate) v.animate([{ color: '#fff6c8', transform: 'scale(1.12)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }

  hitMarker(isKill = false, isHeadshot = false) {
    const h = this.$.hit;
    // pellets / victims landing in the same frame merge into the strongest marker
    const now = performance.now();
    if (now - (this._hitAt ?? -1e9) < 12) {
      isKill = isKill || this._hitKill;
      isHeadshot = isHeadshot || this._hitHs;
    }
    this._hitAt = now;
    this._hitKill = !!isKill;
    this._hitHs = !!isHeadshot;
    h.classList.toggle('kill', !!isKill);
    h.classList.toggle('hs', !!isHeadshot);
    // crisp pop: snaps in oversized, settles, gone in ~0.15 s (kills hold a beat longer)
    const big = isKill ? 1.5 : isHeadshot ? 1.4 : 1.3;
    const dur = isKill ? 360 : isHeadshot ? 210 : 160;
    if (h.animate) {
      if (this._hitAnim) this._hitAnim.cancel();
      this._hitAnim = h.animate(
        [
          { opacity: 1, transform: `scale(${big})` },
          { opacity: 1, transform: 'scale(1)', offset: 0.2 },
          { opacity: 1, transform: 'scale(1)', offset: isKill ? 0.55 : 0.38 },
          { opacity: 0, transform: 'scale(0.94)' },
        ],
        { duration: dur, easing: 'cubic-bezier(.2,.9,.25,1)' }
      );
    }
  }

  damage(angleRad, amount = 10) {
    const a = Number(angleRad) || 0;
    const w = this._arcs[this._arcIdx++ % this._arcs.length];
    const strength = clamp(0.45 + (Number(amount) || 0) / 35, 0.45, 1);
    w.style.transform = `rotate(${a}rad)`;
    if (w.animate) {
      w.animate(
        [
          { opacity: 0, transform: `rotate(${a}rad) scale(1.12)` },
          { opacity: strength, transform: `rotate(${a}rad) scale(1)`, offset: 0.08 },
          { opacity: strength, transform: `rotate(${a}rad) scale(1)`, offset: 0.4 },
          { opacity: 0, transform: `rotate(${a}rad) scale(.98)` },
        ],
        { duration: 1500, easing: 'ease-out' }
      );
      const v = clamp((Number(amount) || 0) / 30, 0.3, 0.95);
      this.$.vigDmg.animate([{ opacity: v }, { opacity: v * 0.6, offset: 0.25 }, { opacity: 0 }], {
        duration: 650,
        easing: 'ease-out',
      });
    }
  }

  banner(title, subtitle, durationSec = 3, style = 'normal') {
    const b = {
      title: String(title ?? ''),
      subtitle: subtitle == null ? '' : String(subtitle),
      dur: Math.max(0.6, Number(durationSec) || 3),
      style: style === 'danger' || style === 'success' ? style : 'normal',
    };
    const cur = this._bannerCur;
    if (cur) {
      const last = this._bannerQueue[this._bannerQueue.length - 1] || cur;
      if (last.title === b.title && last.subtitle === b.subtitle) return;
      this._bannerQueue.push(b);
      if (this._bannerQueue.length > 4) this._bannerQueue.shift();
      // shorten the current banner so the queue doesn't lag behind gameplay
      const shown = (performance.now() - this._bannerStart) / 1000;
      const remain = Math.max(0, 1.4 - shown);
      clearTimeout(this._bannerTimer);
      this._bannerTimer = setTimeout(() => this._endBanner(), remain * 1000);
      return;
    }
    this._showBanner(b);
  }

  _showBanner(b) {
    const el = this.$.banner;
    this._bannerCur = b;
    this._bannerStart = performance.now();
    const m = /^(.*?)(\d+)\s*$/.exec(b.title);
    this.$.bTitle.innerHTML = m ? `${esc(m[1])}<em>${esc(m[2])}</em>` : esc(b.title);
    this.$.bSub.textContent = b.subtitle;
    this.$.bSub.style.display = b.subtitle ? '' : 'none';
    el.classList.remove('show', 'out', 'normal', 'danger', 'success');
    void el.offsetWidth; // restart CSS animation (only on banner events)
    el.classList.add('show', b.style);
    clearTimeout(this._bannerTimer);
    const dur = this._bannerQueue.length ? Math.min(b.dur, 1.6) : b.dur;
    this._bannerTimer = setTimeout(() => this._endBanner(), dur * 1000);
  }

  _endBanner() {
    const el = this.$.banner;
    el.classList.add('out');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => {
      el.classList.remove('show', 'out');
      this._bannerCur = null;
      const next = this._bannerQueue.shift();
      if (next) this._showBanner(next);
    }, 420);
  }

  setCountdown(n) {
    const $ = this.$;
    const on = n != null && isFinite(n);
    this._cls($.cd, 'on', 'cdOn', on);
    if (!on) {
      this._c.delete('cd');
      return;
    }
    const v = String(Math.max(0, Math.ceil(Number(n))));
    if (this._set('cd', v)) {
      $.cdNum.textContent = v;
      $.cd.classList.toggle('urgent', Number(v) <= 3);
      if ($.cdNum.animate) {
        $.cdNum.animate(
          [
            { transform: 'scale(1.7)', opacity: 0.2 },
            { transform: 'scale(1)', opacity: 1 },
          ],
          { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1.2)' }
        );
      }
    }
  }

  setPickupPrompt(text, el = this.$.pickup, key = 'pickup') {
    const on = !!text;
    if (!this._set(key, on ? String(text) : '')) return;
    if (on) {
      // "[E]" → keycap; ALL-CAPS runs (weapon names) highlighted.
      const parts = String(text).split(/(\[[^\]]{1,14}\])/);
      el.innerHTML = parts
        .map((p) => {
          const k = /^\[([^\]]+)\]$/.exec(p);
          if (k) return `<span class="cf-key">${esc(k[1])}</span>`;
          return esc(p).replace(
            /([A-Z0-9][A-Z0-9.\-]*[A-Z0-9](?:\s+[A-Z0-9][A-Z0-9.\-]*[A-Z0-9])*)/g,
            '<b>$1</b>'
          );
        })
        .join('');
    }
    el.classList.toggle('on', on);
  }

  /** Context prompt ("Press [F] to open the GUN SHOP"), separate from weapon pickups. */
  setInteract(text) {
    this.setPickupPrompt(text, this.$.interact, 'interact');
  }

  /** Buy-phase panel under the timer: { next, gunshop } or null. */
  setBuyPhase(info) {
    const $ = this.$;
    this._cls($.buy, 'on', 'buyOn', !!info);
    if (!info) return;
    const where = info.gunshop ? 'Gun shop in the cellar' : 'Tap <b class="cf-key">F</b> for the gun shop';
    const html = `${where} <i>·</i> hold <b class="cf-key">F</b> when ready for round ${pad(info.next, 2)}`;
    if (this._set('buyS', html)) $.buyS.innerHTML = html;
  }

  /** Hold-to-ready ring under the crosshair: progress 0..1 or null. */
  setHold(p) {
    const on = p != null;
    this._cls(this.$.hold, 'on', 'holdOn', on);
    if (!on) return;
    const v = Math.round(clamp(p, 0, 1) * 100);
    if (this._set('hold', v)) this.$.holdFg.style.strokeDashoffset = String(100 - v);
  }

  /** Screen-space waypoint: { x, y, label, dist, edge, angle } or null. */
  setWaypoint(wp) {
    const $ = this.$;
    this._cls($.wp, 'on', 'wpOn', !!wp);
    if (!wp) return;
    this._cls($.wp, 'edge', 'wpEdge', wp.edge);
    this._text($.wpL, 'wpL', String(wp.label ?? ''));
    this._text($.wpD, 'wpD', `${Math.max(0, wp.dist | 0)}m`);
    const x = Math.round(wp.x), y = Math.round(wp.y);
    if (this._set('wpXY', x * 10000 + y)) $.wp.style.transform = `translate3d(${x}px,${y}px,0)`;
    const a = Math.round((wp.angle || 0) * 50) / 50;
    if (wp.edge && this._set('wpA', a)) $.wpArrow.style.transform = `rotate(${a}rad)`;
  }

  /** Gas mask filter meter: { frac, secs, active } or null. */
  setMask(m) {
    const $ = this.$;
    this._cls($.mask, 'on', 'maskOn', !!m);
    if (!m) return;
    const f = Math.round(clamp(m.frac, 0, 1) * 200) / 200;
    if (this._set('maskF', f)) $.maskFill.style.transform = `scaleX(${f})`;
    this._text($.maskSecs, 'maskS', m.secs > 0.05 ? `${m.secs.toFixed(1)}s` : 'EMPTY');
    this._cls($.mask, 'low', 'maskLow', f < 0.25);
    this._cls($.mask, 'active', 'maskAct', !!m.active);
  }

  /** Gas mask lens vignette 0..1. */
  setMaskFx(v) {
    const o = Math.round(clamp(v, 0, 1) * 40) / 40;
    if (this._set('maskFx', o)) this.$.vigMask.style.opacity = String(o);
  }

  setScope(on) {
    on = !!on;
    this._scoped = on;
    this.$.scope.classList.toggle('on', on);
    this.root.classList.toggle('scoped', on);
    this._cls(this.$.xhair, 'off', 'xOff', on || (this._state?.crosshair?.visible === false));
  }

  setScoreboard(visible, rows) {
    const on = !!visible;
    this._cls(this.$.board, 'on', 'boardOn', on);
    if (!on) return;
    this._updateBoardMeta();
    const list = Array.isArray(rows) ? rows.slice() : [];
    list.sort((a, b) => (b.score || 0) - (a.score || 0));
    let key = '';
    for (const r of list) key += `${r.name}|${r.score}|${r.kills}|${r.deaths}|${r.headshots}|${r.isPlayer ? 1 : 0}|${r.rank};`;
    if (key === this._boardKey) return;
    this._boardKey = key;
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      html +=
        `<div class="cf-sb-row${r.isPlayer ? ' me' : ''}">` +
        `<span class="cf-sb-rank">${rankSvg(r.rank)}</span>` +
        `<span class="cf-sb-name"><i>${i + 1}</i>${esc(r.name ?? '')}</span>` +
        `<span class="cf-sb-num">${pad(r.score, 6)}</span>` +
        `<span class="cf-sb-num">${Math.max(0, r.kills | 0)}</span>` +
        `<span class="cf-sb-num">${Math.max(0, r.deaths | 0)}</span>` +
        `<span class="cf-sb-num">${Math.max(0, r.headshots | 0)}</span>` +
        `</div>`;
    }
    this.$.boardRows.innerHTML = html;
  }

  _updateBoardMeta() {
    const s = this._state;
    if (!s) return;
    this._text(this.$.boardDiff, 'bDiff', `${s.modeLabel ?? 'FIRETEAM'} - ${String(s.difficulty ?? '').toUpperCase()}`);
    const r = Number(s.round) || 0;
    const meta = [r > 0 ? `ROUND ${pad(r, 2)}/${s.maxRounds == null ? '∞' : pad(s.maxRounds, 2)}` : '', s.timeLeft != null ? fmtTime(s.timeLeft) : '']
      .filter(Boolean)
      .join('   ·   ');
    this._text(this.$.boardMeta, 'bMeta', meta);
    this._text(this.$.boardFoot, 'bFoot', r > 0 && s.enemiesLeft != null ? `INFECTED REMAINING  ${s.enemiesLeft | 0}` : '');
  }

  setNameplates(list) {
    const seen = new Set();
    const arr = Array.isArray(list) ? list : [];
    for (const p of arr) {
      if (!p || p.id == null) continue;
      const id = String(p.id);
      seen.add(id);
      let e = this._plates.get(id);
      if (!e) {
        const el = document.createElement('div');
        el.className = 'cf-plate hidden';
        el.innerHTML = `<div class="cf-plate-row">${rankSvg(p.rank ?? 1)}<span></span></div><div class="cf-plate-hp"><i></i></div>`;
        this.$.plates.appendChild(el);
        e = { el, name: el.querySelector('span'), hp: el.querySelector('.cf-plate-hp i'), x: NaN, y: NaN, vis: false, n: null, h: -1 };
        this._plates.set(id, e);
      }
      const vis = !!p.visible && isFinite(p.x) && isFinite(p.y);
      if (vis !== e.vis) {
        e.vis = vis;
        e.el.classList.toggle('hidden', !vis);
      }
      if (!vis) continue;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x !== e.x || y !== e.y) {
        e.x = x;
        e.y = y;
        e.el.style.transform = `translate3d(${x}px,${y}px,0) translate(-50%,-100%)`;
      }
      const nm = String(p.name ?? '');
      if (nm !== e.n) {
        e.n = nm;
        e.name.textContent = nm;
      }
      const h = p.hp01 == null ? 1 : Math.round(clamp(p.hp01, 0, 1) * 100) / 100;
      if (h !== e.h) {
        e.h = h;
        e.hp.style.transform = `scaleX(${h})`;
        e.el.classList.toggle('lowhp', h < 0.3);
      }
    }
    for (const [id, e] of this._plates) {
      if (!seen.has(id)) {
        e.el.remove();
        this._plates.delete(id);
      }
    }
  }

  setFps(fps) {
    const on = fps != null && isFinite(fps);
    this._cls(this.$.fps, 'on', 'fpsOn', on);
    if (on) this._text(this.$.fps, 'fps', `${Math.round(fps)} FPS`);
  }

  /* ------------------------------------------------------------ radar */

  _drawRadar(r) {
    const ctx = this._ctx;
    const W = this._rsize;
    if (!ctx || !W || W < 16 || !this._visible) return;
    const dpr = this._rdpr;
    const c = W / 2;
    const R = c - 1 * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, W);

    // static grid: rings + cross
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgba(170,205,235,0.10)';
    ctx.beginPath();
    ctx.arc(c, c, R * 0.33, 0, Math.PI * 2);
    ctx.moveTo(c + R * 0.66, c);
    ctx.arc(c, c, R * 0.66, 0, Math.PI * 2);
    ctx.moveTo(c - R, c);
    ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R);
    ctx.lineTo(c, c + R);
    ctx.stroke();

    if (!r) return;

    const yaw = Number(r.yaw) || 0;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const px = Number(r.x) || 0;
    const pz = Number(r.z) || 0;
    const s = R / this.radarRange;
    const lim = this.radarRange * 1.5;

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.clip();

    // house outline
    const segs = this._segments;
    if (segs.length) {
      ctx.beginPath();
      for (let i = 0; i < segs.length; i++) {
        const g = segs[i];
        const ax = g[0] - px, az = g[1] - pz, bx = g[2] - px, bz = g[3] - pz;
        if (Math.abs(ax) > lim && Math.abs(bx) > lim && Math.sign(ax) === Math.sign(bx)) continue;
        if (Math.abs(az) > lim && Math.abs(bz) > lim && Math.sign(az) === Math.sign(bz)) continue;
        ctx.moveTo(c + (ax * cy - az * sy) * s, c + (ax * sy + az * cy) * s);
        ctx.lineTo(c + (bx * cy - bz * sy) * s, c + (bx * sy + bz * cy) * s);
      }
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(215,232,248,0.30)';
      ctx.lineWidth = 1.6 * dpr;
      ctx.stroke();
    }

    // view cone
    const coneR = R * 0.95;
    const half = 0.62;
    const grad = ctx.createRadialGradient(c, c, 0, c, c, coneR);
    grad.addColorStop(0, 'rgba(200,235,255,0.30)');
    grad.addColorStop(1, 'rgba(200,235,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, coneR, -Math.PI / 2 - half, -Math.PI / 2 + half);
    ctx.closePath();
    ctx.fill();

    // pickups
    const pk = r.pickups;
    if (pk && pk.length) {
      for (let i = 0; i < pk.length; i++) {
        const p = pk[i];
        const dx = p.x - px, dz = p.z - pz;
        const x = c + (dx * cy - dz * sy) * s;
        const y = c + (dx * sy + dz * cy) * s;
        const d2 = (x - c) * (x - c) + (y - c) * (y - c);
        if (d2 > R * R) continue;
        const kind = String(p.kind || '');
        ctx.fillStyle = /health|med/i.test(kind) ? '#6dff8a' : /ammo/i.test(kind) ? '#ffd24a' : '#ffe38a';
        const k = 3.2 * dpr;
        ctx.beginPath();
        ctx.moveTo(x, y - k);
        ctx.lineTo(x + k, y);
        ctx.lineTo(x, y + k);
        ctx.lineTo(x - k, y);
        ctx.closePath();
        ctx.fill();
      }
    }

    // allies
    const al = r.allies;
    if (al && al.length) {
      for (let i = 0; i < al.length; i++) {
        const a = al[i];
        const dx = a.x - px, dz = a.z - pz;
        let x = (dx * cy - dz * sy) * s;
        let y = (dx * sy + dz * cy) * s;
        const d = Math.hypot(x, y);
        if (d > R - 4 * dpr) {
          const k = (R - 4 * dpr) / d;
          x *= k;
          y *= k;
        }
        ctx.fillStyle = 'rgba(90,215,255,0.28)';
        ctx.beginPath();
        ctx.arc(c + x, c + y, 5.2 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7fe2ff';
        ctx.beginPath();
        ctx.arc(c + x, c + y, 3 * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(c + x, c + y, 1.3 * dpr, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // enemies
    const en = r.enemies;
    if (en && en.length) {
      const lvl = r.level ?? 0;
      const pulse = 0.5 + 0.5 * Math.sin(this._time * 9);
      for (let i = 0; i < en.length; i++) {
        const e = en[i];
        const dx = e.x - px, dz = e.z - pz;
        let x = (dx * cy - dz * sy) * s;
        let y = (dx * sy + dz * cy) * s;
        const d = Math.hypot(x, y);
        const out = d > R - 3.5 * dpr;
        if (out) {
          const k = (R - 3.5 * dpr) / d;
          x *= k;
          y *= k;
        }
        const other = e.level != null && e.level !== lvl;
        const near = !out && !other && d < 7 * s;
        const X = c + x, Y = c + y;
        if (other) {
          ctx.strokeStyle = 'rgba(255,150,60,0.75)';
          ctx.lineWidth = 1.2 * dpr;
          ctx.beginPath();
          ctx.arc(X, Y, 2.6 * dpr, 0, Math.PI * 2);
          ctx.stroke();
          continue;
        }
        ctx.fillStyle = `rgba(255,120,20,${near ? 0.22 + pulse * 0.25 : 0.22})`;
        ctx.beginPath();
        ctx.arc(X, Y, (near ? 5.5 + pulse * 1.6 : 5) * dpr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = out ? 'rgba(255,140,40,0.7)' : '#ff8a1f';
        ctx.beginPath();
        ctx.arc(X, Y, (out ? 2.2 : 2.9) * dpr, 0, Math.PI * 2);
        ctx.fill();
        if (!out) {
          ctx.fillStyle = 'rgba(255,225,170,0.9)';
          ctx.beginPath();
          ctx.arc(X, Y, 1.1 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // player marker
    const k = dpr;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1 * dpr;
    ctx.beginPath();
    ctx.moveTo(c, c - 6 * k);
    ctx.lineTo(c + 4.4 * k, c + 4.6 * k);
    ctx.lineTo(c, c + 2.4 * k);
    ctx.lineTo(c - 4.4 * k, c + 4.6 * k);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.restore();

    // north marker on the rim (world north = -Z)
    const nx = c + Math.sin(yaw) * (R - 9 * dpr);
    const ny = c - Math.cos(yaw) * (R - 9 * dpr);
    ctx.font = `700 ${Math.round(10 * dpr)}px Rajdhani, Bahnschrift, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText('N', nx, ny + 1 * dpr);
    ctx.fillStyle = 'rgba(230,240,250,0.85)';
    ctx.fillText('N', nx, ny);
  }

  destroy() {
    try {
      this._ro?.disconnect();
    } catch (_) {}
    clearTimeout(this._bannerTimer);
    this.root.remove();
  }
}

export default HUD;
