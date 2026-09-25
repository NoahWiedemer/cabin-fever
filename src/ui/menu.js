/*
 * CABIN FEVER — menus: cinematic main menu (title → play setup / settings / controls / credits),
 * loading, pause, end screens, click-to-play. Pure DOM; main-menu styles live in menu.css.
 * Settings and the last setup persist in localStorage. Everyone deploys with the standard kit;
 * better guns are bought in the between-round store.
 */

import './menu.css';
import { ensureUiFonts, esc, weaponSvg } from './hud.js';
import { MODE_LIST, MODES, DIFFICULTIES, THREATS, unlocksFor } from '../game/modes.js';

const LS_SETTINGS = 'cabinfever.settings.v1';
const LS_LOADOUT = 'cabinfever.loadout.v1';
const STANDARD_PRIMARY = 'm4a1';

const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1.0,
  fov: 90,
  quality: 'high',
  volume: 0.8,
  music: 0.6,
  showFps: false,
});

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

// main-menu views → camera shot behind them (game.js MENU_SHOTS)
const VIEWS = { home: 'title', play: 'porch', settings: 'interior', controls: 'interior', credits: 'interior' };

const NAV = [
  ['play', 'PLAY', 'Mode · difficulty · fireteam'],
  ['settings', 'SETTINGS', 'Mouse · video · audio'],
  ['controls', 'CONTROLS', 'Keyboard & mouse'],
  ['credits', 'CREDITS', 'The people and tools behind it'],
];

const KIT = [
  ['rifle', 'M4A1', 'RIFLE'],
  ['pistol', 'M9', 'PISTOL'],
  ['knife', 'KNIFE', 'MELEE'],
  ['grenade', '2× M67', 'FRAG'],
];

const CONTROLS = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['SHIFT'], 'Sprint'],
  [['SPACE'], 'Jump'],
  [['CTRL', '/', 'C'], 'Crouch'],
  [['MOUSE 1'], 'Fire'],
  [['MOUSE 2'], 'Aim / scope'],
  [['R'], 'Reload'],
  [['1', '–', '4', '/', 'WHEEL'], 'Switch weapon'],
  [['4'], 'Again: frag ↔ Molotov'],
  [['Q'], 'Last weapon'],
  [['G'], 'Quick throw'],
  [['E'], 'Pick up'],
  [['F'], 'Flashlight · gun shop counter'],
  [['HOLD F'], 'Buy phase: ready up'],
  [['TAB'], 'Scoreboard'],
  [['ESC'], 'Pause · close the shop'],
];

const TIPS = [
  'Headshots are worth bonus points — and bonus cash.',
  'Every kill by your fireteam pays everyone. Spend it in the cellar gun shop between rounds.',
  'A gas mask from the gun shop lets you breathe outside for a while. Upgrade the filter for longer.',
  'Stick with your fireteam. Infected flank lone survivors.',
  'Stay out of the green gas. It hurts more than it looks.',
  'Mutant dogs hunt in packs from round 3. Listen for them.',
  'Rare weapons appear in the basement once it opens.',
  'Chain kills quickly to build a combo multiplier.',
  'Crouch to steady your aim.',
];

const SKULL =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 1C4.2 1 1.5 3.6 1.5 7c0 2 1 3.4 2.5 4.2v2.3c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5v-2.3c1.5-.8 2.5-2.2 2.5-4.2C14.5 3.6 11.8 1 8 1ZM3.9 7.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0ZM8.7 7.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0ZM8 9.3L7.1 10.8h1.8Z"/></svg>';

const HELMET =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M3 11C3 6 6.2 3 10 3s7 3 7 8l1.4 1.6-2.6.3-.5 3.2C15 17.2 13 18.4 10 18.4S5 17.2 4.7 15.1l-.5-3.2-2.6-.3Z"/></svg>';

const MOUSE_SVG =
  '<svg viewBox="0 0 24 36" aria-hidden="true"><rect x="1.5" y="1.5" width="21" height="33" rx="10.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v12M1.5 13.5h21" stroke="currentColor" stroke-width="2"/><path class="cf-mouse-lmb" d="M2.6 12.4V12A9.4 9.4 0 0 1 11 2.6v9.8Z" fill="currentColor"/></svg>';

// mode emblems (64x64)
const EMBLEMS = {
  cabinfever:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M6 58V33L32 12L58 33V58ZM27 58V43H37V58ZM13 37h8v8h-8ZM43 37h8v8h-8ZM28 26h8v7h-8Z"/><path fill="currentColor" d="M50 3a8 8 0 1 0 9 11a6.5 6.5 0 1 1-9-11Z" opacity=".75"/><path fill="currentColor" d="M2 58h60v3H2Z"/></svg>',
  endless:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" d="M32 32c-5-7-9-11-15-11c-6 0-11 5-11 11s5 11 11 11c6 0 10-4 15-11s9-11 15-11c6 0 11 5 11 11s-5 11-11 11c-6 0-10-4-15-11Z"/></svg>',
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function loadJSON(key) {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    /* storage unavailable (private mode / blocked) — ignore */
  }
}

function sanitizeSettings(s) {
  const o = { ...DEFAULT_SETTINGS };
  if (s && typeof s === 'object') {
    const n = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
    o.sensitivity = clamp(n(s.sensitivity, o.sensitivity), 0.1, 3);
    o.fov = Math.round(clamp(n(s.fov, o.fov), 70, 110));
    o.quality = QUALITIES.includes(s.quality) ? s.quality : o.quality;
    o.volume = clamp(n(s.volume, o.volume), 0, 1);
    o.music = clamp(n(s.music, o.music), 0, 1);
    o.showFps = !!s.showFps;
  }
  return o;
}

/** Last setup. Older saves also carry `primary`; it's dropped (everyone gets the standard kit). */
function sanitizeLoadout(c) {
  const o = { mode: 'cabinfever', difficulty: 'hard', teammates: 3 };
  if (c && typeof c === 'object') {
    if (MODES[c.mode]) o.mode = c.mode;
    if (DIFFICULTIES.some((d) => d.id === c.difficulty)) o.difficulty = c.difficulty;
    if (Number.isInteger(c.teammates)) o.teammates = clamp(c.teammates, 0, 3);
  }
  return o;
}

const pad = (n, w) => String(Math.max(0, Math.floor(Number(n) || 0))).padStart(w, '0');
const fmtTime = (sec) => {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad(m, 2)}:${pad(r, 2)}` : `${pad(m, 2)}:${pad(r, 2)}`;
};

function keycaps(keys) {
  return keys
    .map((k) => (k === '/' || k === '–' ? `<span class="cf-kc-sep">${k}</span>` : `<span class="cf-kc">${esc(k)}</span>`))
    .join('');
}

/* ================================================================== Menu */

export class Menu {
  constructor(rootElement, callbacks = {}) {
    ensureUiFonts();
    this.cb = callbacks || {};
    this.settings = sanitizeSettings(loadJSON(LS_SETTINGS));
    this.config = sanitizeLoadout(loadJSON(LS_LOADOUT));
    saveJSON(LS_LOADOUT, this.config);
    this._panels = [];
    this._current = null;
    this._view = 'home';
    this._bots = ['NightOwl', 'Kr4ken', 'Hollow_Point'];
    this._saveTimer = 0;
    this._tipTimer = 0;
    this._countRaf = 0;
    this._flash = -1;

    const root = (this.root = document.createElement('div'));
    root.className = 'cf-menu';
    (rootElement || document.body).appendChild(root);

    this._buildMain();
    this._buildPause();
    this._buildEnd();
    this._buildLoading();
    this._buildClick();
    this.$curtain = this._el('<div class="cf-curtain"></div>');
    root.appendChild(this.$curtain);
    this._bindSfx();
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  /* ------------------------------------------------------------ public API */

  getSettings() {
    return { ...this.settings };
  }

  showMain() {
    this._setView('home', { instant: true });
    this._show('main');
  }

  showPause() {
    this._togglePauseSettings(false);
    this._show('pause');
  }

  hideAll() {
    this._show(null);
    this.hideLoading();
    this.showClickToPlay(false);
  }

  /** Teammate display names for the fireteam picker. */
  setBots(names) {
    if (Array.isArray(names) && names.length) this._bots = names.map(String);
    this._syncConfig();
  }

  /** Lightning 0..1 from the game: brightens the title and flashes the sky. */
  setFlash(v) {
    const f = Math.round(clamp(Number(v) || 0, 0, 1) * 40) / 40;
    if (f === this._flash) return;
    this._flash = f;
    this.$main.root.style.setProperty('--flash', String(f));
  }

  setLoading(fraction, label) {
    const f = clamp(Number(fraction) || 0, 0, 1);
    const L = this.$load;
    if (!L.root.classList.contains('on')) {
      L.root.classList.add('on');
      this._startTips();
    }
    L.fill.style.transform = `scaleX(${f})`;
    L.pct.textContent = `${Math.round(f * 100)}%`;
    if (label != null) L.label.textContent = String(label);
  }

  hideLoading() {
    const L = this.$load;
    if (!L) return;
    L.root.classList.remove('on');
    clearInterval(this._tipTimer);
    this._tipTimer = 0;
  }

  showEnd({ victory = false, endless = false, mode, score = 0, kills = 0, headshots = 0, rounds = 0, roundReached = 0, maxRounds = 0, timeSeconds = 0 } = {}) {
    const E = this.$end;
    const diff = DIFFICULTIES.find((d) => d.id === this.config.difficulty);
    const m = MODES[mode] || MODES[this.config.mode] || MODES.cabinfever;
    endless = endless || !!m.endless;
    E.root.classList.toggle('victory', !!victory);
    E.root.classList.toggle('defeat', !victory);
    E.kicker.textContent = `${m.endless ? 'ENDLESS' : 'FIRETEAM'} - ${diff ? diff.name : 'HARD'}  ·  AFTER-ACTION REPORT`;
    E.title.textContent = victory ? 'MISSION COMPLETE' : endless ? 'OVERRUN' : 'MISSION FAILED';
    E.title.setAttribute('data-text', E.title.textContent);
    E.text.textContent = victory
      ? 'Extraction arrived at dawn.'
      : endless
        ? `Your fireteam held out until round ${Math.max(1, roundReached | 0)}.`
        : 'Your fireteam was overrun.';
    E.epi.style.display = victory ? '' : 'none';
    E.roundsLbl.textContent = endless ? 'ROUND REACHED' : 'ROUNDS SURVIVED';
    E.rounds.textContent = endless ? pad(roundReached, 2) : `${pad(rounds, 2)}/${pad(maxRounds, 2)}`;
    E.time.textContent = fmtTime(timeSeconds);
    this._show('end');

    // count-up animation for the big numbers
    cancelAnimationFrame(this._countRaf);
    const targets = [
      [E.score, Math.max(0, score | 0), 6],
      [E.kills, Math.max(0, kills | 0), 0],
      [E.hs, Math.max(0, headshots | 0), 0],
    ];
    const t0 = performance.now();
    const D = 1400;
    const step = (t) => {
      const k = clamp((t - t0 - 250) / D, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      for (const [el, v, w] of targets) {
        const cur = Math.round(v * e);
        el.textContent = w ? pad(cur, w) : String(cur);
      }
      if (k < 1) this._countRaf = requestAnimationFrame(step);
    };
    this._countRaf = requestAnimationFrame(step);
  }

  showClickToPlay(on) {
    this.$click.classList.toggle('on', !!on);
  }

  /* ------------------------------------------------------------ internals */

  _show(name) {
    const was = this._current;
    for (const [k, el] of Object.entries(this.$screens)) el.classList.toggle('on', k === name);
    this._current = name;
    if (name) {
      this.$click.classList.remove('on');
      this.hideLoading();
    }
    if (name !== 'end') cancelAnimationFrame(this._countRaf);
    if ((was === 'main') !== (name === 'main')) this._call('onMainMenu', name === 'main');
    if (name === 'main') this._call('onShot', VIEWS[this._view]);
  }

  _sfx(name) {
    try {
      this.cb.onUiSound?.(name);
    } catch (_) {}
  }

  _call(name, ...args) {
    try {
      const f = this.cb[name];
      if (typeof f === 'function') f(...args);
    } catch (err) {
      console.error(`[menu] ${name} callback failed`, err);
    }
  }

  _bindSfx() {
    let last = null;
    this.root.addEventListener('mouseover', (e) => {
      const t = e.target.closest?.('[data-sfx]');
      if (t && t !== last && !t.disabled) {
        last = t;
        this._sfx('ui_hover');
      } else if (!t) last = null;
    });
    this.root.addEventListener('click', (e) => {
      const t = e.target.closest?.('[data-sfx]');
      if (t) this._sfx('ui_click');
    });
  }

  _el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  _bg() {
    return `<div class="cf-bg"><div class="cf-bg-tint"></div><div class="cf-bg-vig"></div><div class="cf-bg-scan"></div><div class="cf-bg-roll"></div><div class="cf-bg-noise"></div></div>`;
  }

  /* ---------------- main ---------------- */

  _buildMain() {
    const navHtml = NAV.map(
      ([go, label, sub], i) => `
      <button class="cf-mm-item${i === 0 ? ' primary' : ''}" data-sfx data-go="${go}" data-row style="--i:${i}">
        <em>${pad(i + 1, 2)}</em><span class="cf-mm-item-l">${label}</span><small>${sub}</small><i class="cf-mm-chev"></i>
      </button>`
    ).join('');

    const modeHtml = MODE_LIST.map(
      (m) => `
      <button class="cf-mm-mode" data-sfx data-mode="${m.id}">
        <span class="cf-mm-mode-emb">${EMBLEMS[m.id] || ''}</span>
        <span class="cf-mm-mode-txt">
          <span class="cf-mm-mode-k">${m.kicker}<b>${m.tag}</b></span>
          <span class="cf-mm-mode-n">${m.name}</span>
          <span class="cf-mm-mode-d">${esc(m.tagline)}</span>
        </span>
      </button>`
    ).join('');

    const diffHtml = DIFFICULTIES.map(
      (d) => `
      <button class="cf-mm-diff" data-sfx data-diff="${d.id}">
        <span class="cf-mm-skulls">${SKULL.repeat(d.skulls)}</span>
        <span class="cf-mm-diff-n">${d.name}</span>
        <span class="cf-mm-diff-s" data-diff-sub></span>
      </button>`
    ).join('');

    const teamHtml = [0, 1, 2, 3]
      .map(
        (n) => `<button class="cf-mm-team-b" data-sfx data-team="${n}">
          <span class="cf-mm-team-ico">${n === 0 ? '<span class="cf-mm-solo">SOLO</span>' : HELMET.repeat(n)}</span>
          <span class="cf-mm-team-n">${n}</span></button>`
      )
      .join('');

    const kitHtml = KIT.map(
      ([icon, name, kind]) => `<span class="cf-mm-kit-i"><span class="cf-mm-kit-ico ${icon}">${weaponSvg(icon)}</span><b>${name}</b><small>${kind}</small></span>`
    ).join('');

    const ctrlHtml = CONTROLS.map(
      ([keys, act]) => `<div class="cf-ctrl-row"><span class="cf-ctrl-keys">${keycaps(keys)}</span><span class="cf-ctrl-act">${esc(act)}</span></div>`
    ).join('');

    const head = (title, kicker) => `
      <div class="cf-mm-head">
        <button class="cf-mm-back" data-sfx data-go="home" data-row><i></i>BACK<span class="cf-kc">ESC</span></button>
        <div class="cf-mm-head-t"><small>${kicker}</small><h2>${title}</h2></div>
      </div>`;

    const el = this._el(`
      <div class="cf-screen cf-main cf-mm">
        <div class="cf-mm-fx">
          <div class="cf-mm-shade"></div>
          <div class="cf-mm-flash"></div>
          <div class="cf-bg-scan"></div>
          <div class="cf-bg-noise"></div>
        </div>

        <div class="cf-mm-views">
          <section class="cf-mm-view cf-mm-home" data-view="home">
            <div class="cf-mm-brand">
              <h1 class="cf-mm-title"><span class="t1">CABIN</span><span class="t2">FEVER</span></h1>
              <div class="cf-mm-sub"><i></i>FIRETEAM · ZOMBIE SURVIVAL<i></i></div>
            </div>
            <nav class="cf-mm-nav">${navHtml}</nav>
          </section>

          <section class="cf-mm-view cf-mm-play" data-view="play">
            ${head('OPERATION SETUP', 'PLAY')}
            <div class="cf-mm-setup">
              <div class="cf-mm-steps">
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>01</b>GAME MODE</div>
                  <div class="cf-mm-modes" data-row data-group>${modeHtml}</div>
                </div>
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>02</b>DIFFICULTY</div>
                  <div class="cf-mm-diffs" data-row data-group>${diffHtml}</div>
                </div>
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>03</b>FIRETEAM <small>AI TEAMMATES</small></div>
                  <div class="cf-mm-team" data-row data-group>${teamHtml}</div>
                  <div class="cf-mm-roster"></div>
                </div>
              </div>
              <aside class="cf-mm-brief">
                <div class="cf-mm-brief-body">
                <div class="cf-mm-brief-k">MISSION BRIEFING</div>
                <h3 class="cf-mm-brief-t"></h3>
                <p class="cf-mm-brief-d"></p>
                <div class="cf-mm-facts"></div>
                <div class="cf-mm-threats"></div>
                <div class="cf-mm-kit">
                  <div class="cf-mm-kit-h">STANDARD ISSUE</div>
                  <div class="cf-mm-kit-row">${kitHtml}</div>
                  <div class="cf-mm-kit-note">Earn cash for every fireteam kill. Between rounds the <b>gun shop</b> in the cellar sells weapons, upgrades and gear.</div>
                </div>
                </div>
              </aside>
              <button class="cf-mm-deploy" data-sfx data-row><span>DEPLOY</span><i class="cf-mm-arrows"><b></b><b></b><b></b></i></button>
            </div>
          </section>

          <section class="cf-mm-view cf-mm-settings" data-view="settings">
            ${head('SETTINGS', 'SYSTEM')}
            <div class="cf-panel cf-mm-panel cf-mm-set-body"></div>
          </section>

          <section class="cf-mm-view cf-mm-controls" data-view="controls">
            ${head('CONTROLS', 'FIELD MANUAL')}
            <div class="cf-panel cf-mm-panel"><div class="cf-ctrl cf-mm-ctrl">${ctrlHtml}</div></div>
          </section>

          <section class="cf-mm-view cf-mm-credits" data-view="credits">
            ${head('CREDITS', 'THE FARMHOUSE CREW')}
            <div class="cf-panel cf-mm-panel cf-mm-cred">
              <p class="cf-mm-cred-lead">A fan-made tribute to the <b>Fireteam: Cabin Fever</b> zombie mode of <b>Combat Arms</b> (2009). Not affiliated with or endorsed by the original developers or publishers.</p>
              <dl>
                <dt>GAME</dt><dd>Design, code, procedural textures, synthesized sound</dd>
                <dt>MAIN THEME</dt><dd>“Abandoned Farmhouse”</dd>
                <dt>ENGINE</dt><dd>three.js · postprocessing · N8AO · Vite</dd>
                <dt>TYPE</dt><dd>Black Ops One · Teko · Rajdhani · Share Tech Mono</dd>
                <dt>THANKS</dt><dd>Everyone who held the farmhouse in 2009</dd>
              </dl>
            </div>
          </section>
        </div>

        <div class="cf-mm-dip"></div>
      </div>`);
    this.root.appendChild(el);

    const q = (s) => el.querySelector(s);
    this.$main = {
      root: el,
      views: Object.fromEntries([...el.querySelectorAll('[data-view]')].map((v) => [v.dataset.view, v])),
      modes: [...el.querySelectorAll('[data-mode]')],
      diffs: [...el.querySelectorAll('[data-diff]')],
      teams: [...el.querySelectorAll('[data-team]')],
      roster: q('.cf-mm-roster'),
      briefT: q('.cf-mm-brief-t'),
      briefD: q('.cf-mm-brief-d'),
      facts: q('.cf-mm-facts'),
      threats: q('.cf-mm-threats'),
    };

    el.addEventListener('click', (e) => {
      const t = e.target;
      const go = t.closest('[data-go]');
      if (go) return this._setView(go.dataset.go, { kbd: e.detail === 0 });
      const m = t.closest('[data-mode]');
      if (m) return this._setConfig('mode', m.dataset.mode);
      const d = t.closest('[data-diff]');
      if (d) return this._setConfig('difficulty', d.dataset.diff);
      const tm = t.closest('[data-team]');
      if (tm) return this._setConfig('teammates', Number(tm.dataset.team));
      if (t.closest('.cf-mm-deploy')) this._deploy();
    });

    this._buildSettings(q('.cf-mm-set-body'));
    this._syncConfig();
  }

  _setView(view, { kbd = false, instant = false } = {}) {
    if (!VIEWS[view]) view = 'home';
    const M = this.$main;
    const prev = this._view;
    const apply = () => {
      this._view = view;
      for (const [k, v] of Object.entries(M.views)) v.classList.toggle('on', k === view);
      M.root.dataset.view = view;
      if (kbd) this._focusView();
    };
    const cut = !instant && prev !== view && VIEWS[prev] !== VIEWS[view];
    if (!cut) {
      apply();
      if (!instant && this._current === 'main') this._call('onShot', VIEWS[view]);
      return;
    }
    // dip to black, cut the camera, come back up on the new view
    M.root.classList.add('dipping');
    clearTimeout(this._dipT);
    this._dipT = setTimeout(() => {
      apply();
      this._call('onShot', VIEWS[view]);
      setTimeout(() => M.root.classList.remove('dipping'), 40);
    }, 260);
  }

  _focusView() {
    const v = this.$main.views[this._view];
    const rows = [...v.querySelectorAll('[data-row]')];
    const first = rows.find((r) => !r.classList.contains('cf-mm-back')) || rows[0];
    this._focusRow(first);
  }

  _focusRow(row) {
    if (!row) return;
    const target = row.hasAttribute('data-group') ? row.querySelector('.sel') || row.querySelector('button') : row;
    target?.focus();
  }

  _onKey(e) {
    if (this._current !== 'main') return;
    if (e.key === 'Escape' || (e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName))) {
      if (this._view !== 'home') {
        e.preventDefault();
        this._sfx('ui_click');
        this._setView('home', { kbd: true });
      }
      return;
    }
    const k = e.key;
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    const a = document.activeElement;
    if (a?.tagName === 'INPUT') return; // sliders use the arrows themselves
    const view = this.$main.views[this._view];
    const rows = [...view.querySelectorAll('[data-row]')];
    if (!rows.length) return;
    e.preventDefault();
    const row = rows.find((r) => r === a || r.contains(a));
    if (!row) return this._focusRow(rows.find((r) => !r.classList.contains('cf-mm-back')) || rows[0]);
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && row.hasAttribute('data-group')) {
      // move inside an option group and select
      const btns = [...row.querySelectorAll('button')];
      const i = btns.indexOf(a);
      const next = btns[clamp(i + (k === 'ArrowRight' ? 1 : -1), 0, btns.length - 1)];
      if (next && next !== a) {
        next.focus();
        next.click();
      }
      return;
    }
    const i = rows.indexOf(row);
    const next = rows[clamp(i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1), 0, rows.length - 1)];
    if (next !== row) {
      this._sfx('ui_hover');
      this._focusRow(next);
    }
  }

  _deploy() {
    const cfg = { ...this.config, primary: STANDARD_PRIMARY };
    saveJSON(LS_LOADOUT, this.config);
    // cut to black, then fade into the game
    const c = this.$curtain;
    c.classList.remove('lift');
    c.classList.add('on');
    void c.offsetWidth;
    this._show(null);
    this._call('onDeploy', cfg);
    setTimeout(() => {
      c.classList.add('lift');
      c.classList.remove('on');
    }, 40);
  }

  _setConfig(key, value) {
    this.config[key] = value;
    saveJSON(LS_LOADOUT, this.config);
    this._syncConfig();
  }

  _syncConfig() {
    const M = this.$main;
    const c = this.config;
    const mode = MODES[c.mode] || MODES.cabinfever;
    const diff = DIFFICULTIES.find((x) => x.id === c.difficulty) || DIFFICULTIES[1];
    for (const b of M.modes) b.classList.toggle('sel', b.dataset.mode === c.mode);
    for (const b of M.diffs) {
      b.classList.toggle('sel', b.dataset.diff === c.difficulty);
      const d = DIFFICULTIES.find((x) => x.id === b.dataset.diff);
      b.querySelector('[data-diff-sub]').textContent = mode.endless ? d.horde : `${d.rounds} ROUNDS`;
    }
    for (const b of M.teams) b.classList.toggle('sel', Number(b.dataset.team) === c.teammates);
    M.roster.innerHTML =
      c.teammates === 0
        ? '<span class="solo">Going in alone. Every kill is yours, so is every mistake.</span>'
        : this._bots
            .slice(0, c.teammates)
            .map((n) => `<span>${HELMET}${esc(n)}</span>`)
            .join('');

    // briefing
    M.briefT.innerHTML = `${mode.name} <em>·</em> ${diff.name}`;
    M.briefD.textContent = `${mode.desc} ${mode.endless ? diff.edesc : diff.desc}`;
    const unlocks = unlocksFor(mode.id, diff.id);
    const facts = [
      ['ROUNDS', mode.endless ? '∞' : String(diff.rounds)],
      ['TIME LIMIT', mode.endless ? 'NONE' : `${diff.minutes}:00`],
      ['FLOORS', unlocks.length ? unlocks.map((u) => `${u.name} R${u.round}`).join(' · ') : 'GROUND FLOOR ONLY', 'wide'],
    ];
    M.facts.innerHTML = facts.map(([k, v, cls]) => `<span class="${cls || ''}"><small>${k}</small><b>${v}</b></span>`).join('');
    const last = mode.endless ? Infinity : diff.rounds;
    M.threats.innerHTML =
      '<div class="cf-mm-threats-h">THREAT TIMELINE</div>' +
      THREATS.filter((t) => t.round <= last)
        .map((t) => `<div class="cf-mm-threat"><em>R${pad(t.round, 2)}</em><b>${t.name}</b><span>${t.text}</span></div>`)
        .join('');
  }

  /* ---------------- settings (shared by main + pause) ---------------- */

  _buildSettings(container) {
    const wrap = document.createElement('div');
    wrap.className = 'cf-settings';
    wrap.innerHTML = `
      <div class="cf-set-row" data-key="sensitivity">
        <label>MOUSE SENSITIVITY</label><span class="cf-set-val"></span>
        <input class="cf-range" type="range" min="0.1" max="3" step="0.05" data-sfx>
      </div>
      <div class="cf-set-row" data-key="fov">
        <label>FIELD OF VIEW</label><span class="cf-set-val"></span>
        <input class="cf-range" type="range" min="70" max="110" step="1" data-sfx>
      </div>
      <div class="cf-set-row cf-set-seg" data-key="quality">
        <label>GRAPHICS QUALITY</label><span class="cf-set-val"></span>
        <div class="cf-seg">${QUALITIES.map((q) => `<button data-sfx data-q="${q}">${q.toUpperCase()}</button>`).join('')}</div>
      </div>
      <div class="cf-set-row" data-key="volume">
        <label>MASTER VOLUME</label><span class="cf-set-val"></span>
        <input class="cf-range" type="range" min="0" max="1" step="0.01" data-sfx>
      </div>
      <div class="cf-set-row" data-key="music">
        <label>MUSIC VOLUME</label><span class="cf-set-val"></span>
        <input class="cf-range" type="range" min="0" max="1" step="0.01" data-sfx>
      </div>
      <div class="cf-set-row cf-set-toggle" data-key="showFps">
        <label>SHOW FPS</label>
        <button class="cf-toggle" data-sfx role="switch"><i></i><span class="cf-toggle-off">OFF</span><span class="cf-toggle-on">ON</span></button>
      </div>
      <div class="cf-set-foot"><button class="cf-link" data-sfx data-reset>RESET TO DEFAULTS</button></div>`;
    container.appendChild(wrap);

    const ranges = {};
    for (const key of ['sensitivity', 'fov', 'volume', 'music']) {
      const row = wrap.querySelector(`[data-key="${key}"]`);
      const input = row.querySelector('input');
      const val = row.querySelector('.cf-set-val');
      ranges[key] = { input, val };
      input.addEventListener('input', () => this._setSetting(key, Number(input.value)));
      input.addEventListener('change', () => this._sfx('ui_click'));
    }
    const segBtns = [...wrap.querySelectorAll('[data-q]')];
    const qVal = wrap.querySelector('[data-key="quality"] .cf-set-val');
    wrap.querySelector('.cf-seg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-q]');
      if (b) this._setSetting('quality', b.dataset.q);
    });
    const tog = wrap.querySelector('.cf-toggle');
    tog.addEventListener('click', () => this._setSetting('showFps', !this.settings.showFps));
    wrap.querySelector('[data-reset]').addEventListener('click', () => {
      this.settings = { ...DEFAULT_SETTINGS };
      this._settingsChanged();
    });

    const fmt = {
      sensitivity: (v) => v.toFixed(2),
      fov: (v) => `${Math.round(v)}°`,
      volume: (v) => `${Math.round(v * 100)}%`,
      music: (v) => `${Math.round(v * 100)}%`,
    };
    const panel = {
      sync: () => {
        const s = this.settings;
        for (const key of Object.keys(ranges)) {
          const { input, val } = ranges[key];
          if (Number(input.value) !== s[key]) input.value = String(s[key]);
          const min = Number(input.min);
          const max = Number(input.max);
          input.style.setProperty('--fill', `${((s[key] - min) / (max - min)) * 100}%`);
          val.textContent = fmt[key](s[key]);
        }
        for (const b of segBtns) b.classList.toggle('sel', b.dataset.q === s.quality);
        qVal.textContent = '';
        tog.classList.toggle('on', !!s.showFps);
        tog.setAttribute('aria-checked', s.showFps ? 'true' : 'false');
      },
    };
    this._panels.push(panel);
    panel.sync();
    return panel;
  }

  _setSetting(key, value) {
    if (key === 'sensitivity') value = clamp(Math.round(value * 100) / 100, 0.1, 3);
    if (key === 'fov') value = Math.round(clamp(value, 70, 110));
    if (key === 'volume' || key === 'music') value = clamp(Math.round(value * 100) / 100, 0, 1);
    if (key === 'quality' && !QUALITIES.includes(value)) return;
    if (key === 'showFps') value = !!value;
    if (this.settings[key] === value) return;
    this.settings[key] = value;
    this._settingsChanged();
  }

  _settingsChanged() {
    for (const p of this._panels) p.sync();
    clearTimeout(this._saveTimer);
    const snap = { ...this.settings };
    this._saveTimer = setTimeout(() => saveJSON(LS_SETTINGS, snap), 150);
    this._call('onSettingsChange', { ...this.settings });
  }

  /* ---------------- pause ---------------- */

  _buildPause() {
    const el = this._el(`
      <div class="cf-screen cf-pause">
        <div class="cf-dim"></div>
        <div class="cf-pause-wrap">
          <section class="cf-panel cf-pause-panel">
            <div class="cf-pause-kicker">OPERATION ON HOLD</div>
            <div class="cf-pause-title">PAUSED</div>
            <div class="cf-pause-btns">
              <button class="cf-btn cf-btn-primary" data-sfx data-act="resume"><span>RESUME</span></button>
              <button class="cf-btn" data-sfx data-act="settings"><span>SETTINGS</span></button>
              <button class="cf-btn cf-btn-danger" data-sfx data-act="quit"><span>QUIT TO MENU</span></button>
            </div>
          </section>
          <section class="cf-panel cf-pause-settings">
            <div class="cf-panel-head"><span>SETTINGS</span><em>SYS</em></div>
            <div class="cf-pause-set-body"></div>
          </section>
        </div>
      </div>`);
    this.root.appendChild(el);
    this.$pause = { root: el, setBtn: el.querySelector('[data-act="settings"]') };
    this._buildSettings(el.querySelector('.cf-pause-set-body'));

    el.querySelector('.cf-pause-btns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'resume') {
        this._call('onResume');
        if (this._current === 'pause') this._show(null);
      } else if (act === 'settings') {
        this._togglePauseSettings();
      } else if (act === 'quit') {
        this._call('onQuit');
        if (this._current === 'pause') this.showMain();
      }
    });
  }

  _togglePauseSettings(force) {
    const P = this.$pause;
    if (!P) return;
    const on = force == null ? !P.root.classList.contains('show-settings') : !!force;
    P.root.classList.toggle('show-settings', on);
    P.setBtn.classList.toggle('sel', on);
  }

  /* ---------------- end ---------------- */

  _buildEnd() {
    const el = this._el(`
      <div class="cf-screen cf-end">
        ${this._bg()}
        <div class="cf-end-glow"></div>
        <div class="cf-end-wrap">
          <div class="cf-end-kicker"></div>
          <h2 class="cf-end-title" data-text=""></h2>
          <div class="cf-end-rule"><i></i></div>
          <p class="cf-end-text"></p>
          <div class="cf-end-stats">
            <div class="cf-stat cf-stat-score"><label>FINAL SCORE</label><b class="cf-e-score">000000</b></div>
            <div class="cf-stat"><label>KILLS</label><b class="cf-e-kills">0</b></div>
            <div class="cf-stat"><label>HEADSHOTS</label><b class="cf-e-hs">0</b></div>
            <div class="cf-stat"><label class="cf-e-rounds-l">ROUNDS SURVIVED</label><b class="cf-e-rounds">00/00</b></div>
            <div class="cf-stat"><label>TIME</label><b class="cf-e-time">00:00</b></div>
          </div>
          <p class="cf-end-epi">Prolonged exposure to the toxic gas has consequences...</p>
          <div class="cf-end-btns">
            <button class="cf-btn cf-btn-primary" data-sfx data-act="again"><span>PLAY AGAIN</span></button>
            <button class="cf-btn" data-sfx data-act="menu"><span>MAIN MENU</span></button>
          </div>
        </div>
      </div>`);
    this.root.appendChild(el);
    const q = (s) => el.querySelector(s);
    this.$end = {
      root: el,
      kicker: q('.cf-end-kicker'),
      title: q('.cf-end-title'),
      text: q('.cf-end-text'),
      epi: q('.cf-end-epi'),
      score: q('.cf-e-score'),
      kills: q('.cf-e-kills'),
      hs: q('.cf-e-hs'),
      rounds: q('.cf-e-rounds'),
      roundsLbl: q('.cf-e-rounds-l'),
      time: q('.cf-e-time'),
    };
    q('.cf-end-btns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'again') {
        this._call('onPlayAgain');
        if (this._current === 'end') this._show(null);
      } else {
        this._call('onQuit');
        if (this._current === 'end') this.showMain();
      }
    });
  }

  /* ---------------- loading ---------------- */

  _buildLoading() {
    const el = this._el(`
      <div class="cf-screen cf-loading">
        <div class="cf-load-bg"></div>
        <div class="cf-bg"><div class="cf-bg-scan"></div><div class="cf-bg-noise"></div></div>
        <div class="cf-load-wrap">
          <div class="cf-load-title"><span>CABIN</span> <span class="r">FEVER</span></div>
          <div class="cf-load-sub">FIRETEAM · ZOMBIE SURVIVAL</div>
          <div class="cf-load-row"><span class="cf-load-label">Preparing operation…</span><span class="cf-load-pct">0%</span></div>
          <div class="cf-load-bar"><div class="cf-load-fill"></div></div>
          <div class="cf-load-tip"><b>TIP</b><span></span></div>
        </div>
      </div>`);
    this.root.appendChild(el);
    this.$load = {
      root: el,
      fill: el.querySelector('.cf-load-fill'),
      pct: el.querySelector('.cf-load-pct'),
      label: el.querySelector('.cf-load-label'),
      tip: el.querySelector('.cf-load-tip span'),
    };
  }

  _startTips() {
    const tip = this.$load.tip;
    let i = Math.floor(Math.random() * TIPS.length);
    tip.textContent = TIPS[i];
    clearInterval(this._tipTimer);
    this._tipTimer = setInterval(() => {
      i = (i + 1) % TIPS.length;
      tip.textContent = TIPS[i];
    }, 4200);
  }

  /* ---------------- click to continue ---------------- */

  _buildClick() {
    const el = this._el(`
      <div class="cf-screen cf-click" data-sfx>
        <div class="cf-click-box">
          <div class="cf-click-ico">${MOUSE_SVG}</div>
          <div class="cf-click-title">CLICK TO CONTINUE</div>
          <div class="cf-click-sub">Mouse control released</div>
        </div>
      </div>`);
    this.root.appendChild(el);
    this.$click = el;
    el.addEventListener('click', () => {
      this._call('onResume');
    });
    // safety net: once the pointer is locked again the overlay is never needed
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) this.showClickToPlay(false);
    });
    this.$screens = {
      main: this.$main.root,
      pause: this.$pause.root,
      end: this.$end.root,
    };
  }
}

export default Menu;
