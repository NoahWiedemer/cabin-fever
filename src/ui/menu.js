/*
 * CABIN FEVER — menus: cinematic main menu (title → play setup / settings / controls / credits),
 * loading, pause, end screens, click-to-play. Pure DOM; main-menu styles live in menu.css.
 * Settings and the last setup persist in localStorage. Everyone deploys with the standard kit;
 * better guns are bought in the between-round store.
 */

import './menu.css';
import { ensureUiFonts, esc, weaponSvg, weaponKind } from './hud.js';
import { MODE_LIST, MODES, DIFFICULTIES } from '../game/modes.js';
import { FIRETEAM, FIRETEAM_BY_ID, LEGACY_LINEUPS, MAX_BOTS, DEFAULT_TEAM, normalizeFireteam } from '../actors/fireteam.js';
import * as LB from './leaderboard.js';
import * as Progress from '../game/progress.js';
import { insigniaSvg, masterySvg } from './insignia.js';
import { skinSwatch } from '../player/skins.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { cardIcon } from './cardIcons.js';
import { MAP_LIST, MAPS } from '../world/maps.js';
import { LobbyStage } from './lobbyStage.js';

// the MAP step's emblems (world/maps.js ids)
const MAP_EMBLEMS = {
  farm: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 15L16 5l12 10M7 13v14h18V13"/><path d="M13 27v-7h6v7M9.5 17h3v3h-3zM19.5 17h3v3h-3z"/></svg>',
  appenweier: '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 27h26M5 27V15l7-4 7 4v12M19 27V17h9v10"/><path d="M9 3h6v8M9 7h6M8.5 20h3v4h-3zM21 20h5M21 23h5"/></svg>',
};

const LS_SETTINGS = 'cabinfever.settings.v1';
const LS_LOADOUT = 'cabinfever.loadout.v1';
const STANDARD_PRIMARY = 'm4a1';

const DEFAULT_SETTINGS = Object.freeze({
  sensitivity: 1.0,
  fov: 90,
  quality: 'high',
  volume: 0.8,
  music: 0.9,
  showFps: false,
  fullscreen: false, // the whole page (core/fullscreen.js); re-entered on the next click after a reload
  rev: 2, // settings revision (2: louder music default)
});

const QUALITIES = ['low', 'medium', 'high', 'ultra'];

// main-menu views → camera shot behind them (game.js MENU_SHOTS)
const VIEWS = { home: 'title', play: 'lobby', career: 'interior', leaderboard: 'interior', settings: 'interior', controls: 'interior', credits: 'interior' };

const NAV = [
  ['play', 'PLAY', 'Map · mode · difficulty · fireteam'],
  ['career', 'CAREER', 'Rank · weapon mastery · operators'],
  ['leaderboard', 'LEADERBOARD', 'Your best runs'],
  ['settings', 'SETTINGS', 'Mouse · video · audio'],
  ['controls', 'CONTROLS', 'Keyboard & mouse'],
  ['credits', 'CREDITS', 'The people and tools behind it'],
];

const CONTROLS = [
  [['W', 'A', 'S', 'D'], 'Move'],
  [['SHIFT'], 'Sprint'],
  [['SPACE'], 'Jump'],
  [['CTRL', '/', 'C'], 'Crouch'],
  [['MOUSE 1'], 'Fire'],
  [['MOUSE 2'], 'Aim / scope'],
  [['R'], 'Reload'],
  [['1', '–', '5', '/', 'WHEEL'], 'Switch weapon'],
  [['1'], 'Again: primary ↔ backpack gun (weapon backpack)'],
  [['4'], 'Again: frag → Molotov → mine → pipe bomb'],
  [['X'], 'Shockwave emitter (store gear, once a round)'],
  [['5'], 'Barricade kit · hold Mouse 1 at a doorway'],
  [['Q'], 'Last weapon'],
  [['G'], 'Quick throw'],
  [['E'], 'Pick up'],
  [['V'], 'Mash: shake off a Biter'],
  [['F'], 'Flashlight · gun shop counter'],
  [['HOLD F'], 'Buy phase: ready up'],
  [['TAB'], 'Scoreboard'],
  [['ESC'], 'Pause · close the shop'],
  [['HOLD ESC'], 'Leave fullscreen'],
];

// a tip per map where they differ: { farm, appenweier } (world/maps.js ids)
const TIPS = [
  'Headshots are worth bonus points — and bonus cash.',
  {
    farm: 'Every kill by your fireteam pays everyone. Spend it in the cellar gun shop between rounds.',
    appenweier: 'Every kill by your fireteam pays everyone. Spend it in the garage gun shop behind 13a between rounds.',
  },
  {
    farm: 'A gas mask from the gun shop lets you breathe outside for a while. Upgrade the filter for longer.',
    appenweier: 'The toxic haze only thickens at the edge of Appenweier. Keep to the houses and the road.',
  },
  'Gear from the gun shop stays with you all match: one item per body slot, and owned gear goes back on for free.',
  'Barricade kits from the gun shop board up a doorway. You can still shoot through the gaps between the planks.',
  'Stick with your fireteam. Infected flank lone survivors.',
  { farm: 'Stay out of the green gas. It hurts more than it looks.', appenweier: 'Listen to the corn field across the road. The infected come out of it.' },
  'Mutant dogs hunt in packs from round 3. Listen for them.',
  { farm: 'Rare weapons appear in the basement once it opens.', appenweier: 'Rare weapons wait in the fire station and the drugstore once they open.' },
  'Chain kills quickly to build a combo multiplier.',
  'Crouch to steady your aim.',
];

const SKULL =
  '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8 1C4.2 1 1.5 3.6 1.5 7c0 2 1 3.4 2.5 4.2v2.3c0 .8.7 1.5 1.5 1.5h5c.8 0 1.5-.7 1.5-1.5v-2.3c1.5-.8 2.5-2.2 2.5-4.2C14.5 3.6 11.8 1 8 1ZM3.9 7.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0ZM8.7 7.4a1.7 1.7 0 1 0 3.4 0a1.7 1.7 0 1 0-3.4 0ZM8 9.3L7.1 10.8h1.8Z"/></svg>';

const HELMET =
  '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M3 11C3 6 6.2 3 10 3s7 3 7 8l1.4 1.6-2.6.3-.5 3.2C15 17.2 13 18.4 10 18.4S5 17.2 4.7 15.1l-.5-3.2-2.6-.3Z"/></svg>';

// mode emblems (64x64)
const EMBLEMS = {
  cabinfever:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M6 58V33L32 12L58 33V58ZM27 58V43H37V58ZM13 37h8v8h-8ZM43 37h8v8h-8ZM28 26h8v7h-8Z"/><path fill="currentColor" d="M50 3a8 8 0 1 0 9 11a6.5 6.5 0 1 1-9-11Z" opacity=".75"/><path fill="currentColor" d="M2 58h60v3H2Z"/></svg>',
  endless:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" d="M32 32c-5-7-9-11-15-11c-6 0-11 5-11 11s5 11 11 11c6 0 10-4 15-11s9-11 15-11c6 0 11 5 11 11s-5 11-11 11c-6 0-10-4-15-11Z"/></svg>',
  // the Gauntlet: three cards fanned out, a skull on the front one
  gauntlet:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><g fill="currentColor"><path d="M5 18L22 11L32 50L15 57Z" opacity=".45"/><path d="M42 11L59 18L49 57L32 50Z" opacity=".45"/><path fill-rule="evenodd" d="M21 6H43V56H21ZM32 18C26.5 18 23.5 21.5 23.5 26C23.5 29 25 31 27 32.2V36H37V32.2C39 31 40.5 29 40.5 26C40.5 21.5 37.5 18 32 18ZM28.5 25.5a2.5 2.5 0 1 0 0.01 0ZM35.5 25.5a2.5 2.5 0 1 0 0.01 0ZM26 44H38V47H26Z"/></g></svg>',
};

// the career screen: every weapon that levels up (not the tools), and the ones that take a camo
const MASTERY_IDS = Object.values(WEAPONS)
  .filter((d) => d.slot >= 0 && d.slot <= 3)
  .map((d) => d.id);
const CAMO_OK = (id) => WEAPONS[id]?.slot >= 0 && WEAPONS[id].slot <= 2;
const fmtNum = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const GEAR = '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M8.2 1h3.6l.5 2.4 1.5.8 2.3-.9 1.8 3.1-1.8 1.6v1.8l1.8 1.6-1.8 3.1-2.3-.9-1.5.8-.5 2.4H8.2l-.5-2.4-1.5-.8-2.3.9-1.8-3.1 1.8-1.6V8l-1.8-1.6 1.8-3.1 2.3.9 1.5-.8ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"/></svg>';
const LOCK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M4 7V5a4 4 0 0 1 8 0v2h1v8H3V7Zm2 0h4V5a2 2 0 0 0-4 0Z"/></svg>';

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
    // saves from before rev 2 that still hold the old, too quiet default get the new one
    if ((s.rev ?? 1) < 2 && s.music === 0.6) o.music = DEFAULT_SETTINGS.music;
    o.showFps = !!s.showFps;
    o.fullscreen = !!s.fullscreen;
  }
  return o;
}

/**
 * Last setup. Older saves also carry `primary`; it's dropped (everyone gets the standard kit). The
 * fireteam is a list of character ids (at most MAX_BOTS: a run has four seats) and `slots` says where each
 * one stands in the lobby; saves from the 0-3 size picker keep the characters that size used to field
 * (1 = Viper, 2 = Viper + Scorpion, 3 = Coach, Ellis, Viper).
 */
function sanitizeLoadout(c) {
  const o = { mode: 'cabinfever', difficulty: 'hard', fireteam: DEFAULT_TEAM.slice() };
  let slots = null;
  if (c && typeof c === 'object') {
    if (MODES[c.mode]) o.mode = c.mode;
    if (DIFFICULTIES.some((d) => d.id === c.difficulty)) o.difficulty = c.difficulty;
    const team = normalizeFireteam(c.fireteam);
    if (team) o.fireteam = team;
    else if (Number.isInteger(c.teammates)) o.fireteam = LEGACY_LINEUPS[clamp(c.teammates, 0, 3)].slice();
    if (Array.isArray(c.slots)) slots = c.slots;
  }
  o.slots = cleanSlots(slots, o.fireteam);
  o.fireteam = normalizeFireteam(o.slots.filter(Boolean)) ?? [];
  return o;
}

/** The three bot seats (you take the fourth): saved seats as they were, else the team in roster order. */
function cleanSlots(slots, team) {
  const out = Array(MAX_BOTS).fill(null);
  if (Array.isArray(slots)) {
    const seen = new Set();
    slots.slice(0, MAX_BOTS).forEach((id, i) => {
      if (FIRETEAM_BY_ID[id] && !seen.has(id)) {
        out[i] = id;
        seen.add(id);
      }
    });
  } else team.slice(0, MAX_BOTS).forEach((id, i) => (out[i] = id));
  return out;
}

const mapImageUrl = (m) => `${import.meta.env.BASE_URL}${m.image}`;

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const fmtDate = (ms) => {
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? `${pad(d.getDate(), 2)} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
};
const fmtStamp = (ms) => {
  try {
    return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) {
    return '';
  }
};

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
    // the map this page loaded (world/maps.js); picking another one on the PLAY screen reloads on DEPLOY
    this.loadedMap = this.cb.map ?? MAPS.farm;
    this.config.map = this.loadedMap.id;
    saveJSON(LS_LOADOUT, this.config);
    this._panels = [];
    this._current = null;
    this._shownAt = 0; // (performance.now) when the current screen came up
    this._view = 'home';
    this._portraits = {}; // character id -> rendered portrait (data URL), set once the game has loaded
    this._lb = { mode: this.config.mode, difficulty: this.config.difficulty }; // leaderboard filter
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
    this.$screens = {
      main: this.$main.root,
      pause: this.$pause.root,
      end: this.$end.root,
    };
    this.$curtain = this._el('<div class="cf-curtain"></div>');
    root.appendChild(this.$curtain);
    this._bindSfx();
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  /* ------------------------------------------------------------ public API */

  getSettings() {
    return { ...this.settings };
  }

  /** Change one setting from outside (e.g. FULLSCREEN when the browser refused or the player left it). */
  setSetting(key, value) {
    this._setSetting(key, value);
  }

  showMain(view = 'home') {
    if (view === 'leaderboard') this._renderBoard();
    if (view === 'career') this._renderCareer();
    this._renderProfile(); // (a run may have promoted you or unlocked a skin)
    this._syncConfig();
    this._setView(view, { instant: true });
    this._show('main');
  }

  showPause() {
    this._togglePauseSettings(false);
    this._show('pause');
  }

  hideAll() {
    this._show(null);
    this.hideLoading();
  }

  /** Character portraits ({ id: image URL }, actors/portraits.js) for the fireteam cards and the leaderboard. */
  setPortraits(map) {
    this._portraits = map && typeof map === 'object' ? { ...map } : {};
    this._renderLobby();
    if (this._layer === this.$main.layers.pick) this._renderPick();
    if (this._view === 'leaderboard') this._renderBoard();
  }

  /**
   * Keep a finished run on the local leaderboard (game.js runStats()). Returns the placement
   * ({ rank, best, key, record }) or null; the end screen shows it, the leaderboard highlights it.
   */
  recordRun(stats) {
    let placed = null;
    try {
      placed = LB.recordRun(stats, this._name());
    } catch (err) {
      console.error('[menu] leaderboard record failed', err);
    }
    if (placed?.record) this._lb = { mode: placed.record.mode, difficulty: placed.record.difficulty };
    return placed;
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

  showEnd({ victory = false, endless = false, mode, difficulty, outcome, score = 0, kills = 0, headshots = 0, accuracy = null, rounds = 0, roundReached = 0, maxRounds = 0, timeSeconds = 0, fireteam, team, placed = null, career = null, rogue = null } = {}) {
    const E = this.$end;
    const diff = DIFFICULTIES.find((d) => d.id === (difficulty ?? this.config.difficulty));
    const m = MODES[mode] || MODES[this.config.mode] || MODES.cabinfever;
    endless = endless || !!m.endless;
    const ids = normalizeFireteam(fireteam) ?? [];
    const solo = Array.isArray(fireteam) && !ids.length;
    E.root.classList.toggle('victory', !!victory);
    E.root.classList.toggle('defeat', !victory);
    E.kicker.textContent = `${m.rogue ? 'THE GAUNTLET' : m.endless ? 'ENDLESS' : 'FIRETEAM'} - ${diff ? diff.name : 'HARD'}  ·  AFTER-ACTION REPORT`;
    E.title.textContent = victory ? (m.rogue ? 'GAUNTLET CLEARED' : 'MISSION COMPLETE') : endless ? 'OVERRUN' : 'MISSION FAILED';
    E.title.setAttribute('data-text', E.title.textContent);
    E.text.textContent = victory
      ? m.rogue
        ? 'Fifteen waves, every curse you chose, and you are still standing.'
        : 'Extraction arrived at dawn.'
      : outcome === 'timeout'
        ? 'The clock ran out before extraction.'
        : endless
          ? `${solo ? 'You' : 'Your fireteam'} held out until round ${Math.max(1, roundReached | 0)}.`
          : solo
            ? 'You were overrun.'
            : 'Your fireteam was overrun.';
    E.epi.style.display = victory && !m.rogue ? '' : 'none';
    E.roundsLbl.textContent = endless ? 'ROUND REACHED' : 'ROUNDS SURVIVED';
    E.rounds.textContent = endless ? pad(roundReached, 2) : `${pad(rounds, 2)}/${pad(maxRounds, 2)}`;
    E.time.textContent = fmtTime(timeSeconds);
    E.acc.textContent = accuracy == null || !isFinite(accuracy) ? '—' : `${Math.round(clamp(accuracy, 0, 1) * 100)}%`;
    // local leaderboard placement
    this._endBoard = placed?.record ? { mode: placed.record.mode, difficulty: placed.record.difficulty } : { mode: m.id, difficulty: diff?.id ?? 'hard' };
    const where = `${m.name} · ${diff ? diff.name : 'HARD'}`;
    E.rank.hidden = !placed?.rank;
    E.rank.classList.toggle('best', !!placed?.best);
    if (placed?.rank) {
      E.rankT.textContent = placed.best ? 'NEW HIGH SCORE' : `RANKED #${placed.rank}`;
      E.rankS.textContent = placed.best ? `#1 on your ${where} leaderboard` : `on your ${where} leaderboard`;
    }
    // the fireteam that went in: portrait chips with each bot's kills
    const byId = new Map((Array.isArray(team) ? team : []).map((t) => [t.id, t]));
    E.team.innerHTML = ids.length
      ? `<span class="cf-end-team-h">FIRETEAM</span>` +
        ids
          .map((id) => {
            const c = FIRETEAM_BY_ID[id];
            const t = byId.get(id);
            return `<span class="cf-end-mate">${this._avatar(id)}<b>${esc(c.name)}</b><small>${t ? `${t.kills | 0} KILLS${t.revives > 0 ? ` · ${t.revives} REVIVE${t.revives > 1 ? 'S' : ''}` : ''}` : esc(c.gun)}</small></span>`;
          })
          .join('')
      : solo
        ? '<span class="cf-end-team-h">SOLO RUN</span>'
        : '';
    this._endCareer(career, rogue);
    this._show('end');

    // count-up animation for the big numbers
    cancelAnimationFrame(this._countRaf);
    const targets = [
      [E.score, Math.max(0, score | 0), 6],
      [E.kills, Math.max(0, kills | 0), 0],
      [E.hs, Math.max(0, headshots | 0), 0],
      [E.cXp, Math.max(0, career?.xp | 0), 'n'],
    ];
    const t0 = performance.now();
    const D = 1400;
    const step = (t) => {
      const k = clamp((t - t0 - 250) / D, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      for (const [el, v, w] of targets) {
        const cur = Math.round(v * e);
        el.textContent = w === 'n' ? fmtNum(cur) : w ? pad(cur, w) : String(cur);
      }
      if (k < 1) this._countRaf = requestAnimationFrame(step);
    };
    this._countRaf = requestAnimationFrame(step);
  }

  /**
   * The end screen's service record (game/progress.js runEnd): the xp the run earned, the rank bar (what was
   * there and what the run added), a promotion, the weapons it levelled, what it unlocked; the Gauntlet's build.
   */
  _endCareer(c, rogue) {
    const E = this.$end;
    E.career.hidden = !c;
    E.career.classList.toggle('promoted', !!c?.promoted);
    E.mastery.innerHTML = '';
    E.unlocks.innerHTML = '';
    E.build.innerHTML = '';
    if (c) {
      E.cIns.innerHTML = insigniaSvg(c.rankIndex);
      E.cName.textContent = c.rank.name;
      E.cXp.textContent = '0';
      const before = c.promoted ? 0 : Math.max(0, (c.into - c.xp) / c.span);
      E.cWas.style.transform = `scaleX(${before.toFixed(4)})`;
      E.cGain.style.transition = 'none';
      E.cGain.style.transform = `scaleX(${before.toFixed(4)})`;
      clearTimeout(this._barT);
      this._barT = setTimeout(() => {
        E.cGain.style.transition = '';
        E.cGain.style.transform = `scaleX(${c.progress.toFixed(4)})`;
      }, 900);
      E.cInto.textContent = c.next ? `${fmtNum(c.into)} / ${fmtNum(c.span)} XP · NEXT: ${c.next.name.toUpperCase()}` : 'GENERAL OF THE ARMY · THE TOP';
      const P = c.parts ?? {};
      E.cParts.innerHTML = [['KILLS', P.kills], ['HEADSHOTS', P.heads], ['ROUNDS', P.rounds], ['WIN', P.win]]
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `<span><small>${k}</small>+${fmtNum(v)}</span>`)
        .join('');
      E.mastery.innerHTML = c.mastery
        .slice(0, 6)
        .map((w) => {
          const up = w.level > w.before;
          const pct = w.span ? w.into / w.span : 1;
          return `<span class="cf-ec-m${up ? ' up' : ''}">${masterySvg(w.level)}<b>${esc(WEAPONS[w.weapon]?.name ?? w.weapon)}</b><small>${up ? `LV ${w.before} → ${w.level}` : `${w.kills} KILL${w.kills === 1 ? '' : 'S'}`}</small><i style="--k:${pct.toFixed(3)}"></i></span>`;
        })
        .join('');
      E.unlocks.innerHTML = c.unlocks
        .map((u) => {
          const what = u.kind === 'camo' ? `CAMO · ${esc(WEAPONS[u.weapon]?.name ?? '')}` : 'OPERATOR';
          const sw = u.kind === 'camo' ? this._swatch(u.id) : null;
          return `<span class="cf-ec-un">${sw ? `<i style="background-image:url(${sw})"></i>` : ''}<small>UNLOCKED</small><b>${esc(u.name)}</b><em>${what}</em></span>`;
        })
        .join('');
    }
    if (rogue) {
      const chip = (x, curse) => `<span class="cf-dr-chip${curse ? ' curse' : ''}">${cardIcon(x.icon)}<b>${esc(x.name)}</b>${x.n > 1 ? `<em>×${x.n}</em>` : ''}</span>`;
      E.build.innerHTML = `<span class="cf-end-team-h">YOUR RUN</span>${rogue.perks.map((x) => chip(x)).join('')}${rogue.curses.map((x) => chip(x, true)).join('')}`;
    }
  }

  /** True while the main menu (home / play / leaderboard / settings ...) is the visible screen. */
  get onMainScreen() {
    return this._current === 'main';
  }

  /* ------------------------------------------------------------ internals */

  _show(name) {
    const was = this._current;
    for (const [k, el] of Object.entries(this.$screens)) el.classList.toggle('on', k === name);
    this._current = name;
    if (name !== was) this._shownAt = performance.now();
    if (name) this.hideLoading();
    if (name !== 'end') cancelAnimationFrame(this._countRaf);
    if ((was === 'main') !== (name === 'main')) this._call('onMainMenu', name === 'main');
    if (name === 'main') this._call('onShot', VIEWS[this._view]);
    if (name === 'main' && this._view === 'play') this._lobbyShow();
    else if (name !== 'main') this._lobbyHide();
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

    // the map and mode selects: one button showing the pick (icon, bold name); the list opens under it
    const selItems = {
      map: MAP_LIST.map((m) => ({ id: m.id, icon: MAP_EMBLEMS[m.id] || '', name: m.name })),
      mode: MODE_LIST.map((m) => ({ id: m.id, icon: EMBLEMS[m.id] || '', name: m.name })),
    };
    const selectHtml = (key, label) => `
      <div class="cf-sel" data-sel="${key}">
        <div class="cf-sel-l">${label}</div>
        <button class="cf-sel-btn" data-sfx data-row data-sel-toggle="${key}" aria-haspopup="listbox" aria-expanded="false">
          <span class="cf-sel-ico" data-sel-ico></span><span class="cf-sel-n" data-sel-name></span><i class="cf-sel-chev"></i>
        </button>
      </div>`;
    // (the lists sit in the briefing panel itself, not in its scrolling body, so nothing clips them)
    const listHtml = (key) => `
      <div class="cf-sel-list" role="listbox" data-sel-list="${key}" hidden>
        ${selItems[key]
          .map(
            (it) => `<button class="cf-sel-opt" role="option" data-sfx data-opt="${it.id}" data-of="${key}">
              <span class="cf-sel-ico">${it.icon}</span><span class="cf-sel-n">${esc(it.name)}</span>
            </button>`
          )
          .join('')}
      </div>`;

    const diffHtml = DIFFICULTIES.map(
      (d) => `
      <button class="cf-mm-diff" data-sfx data-diff="${d.id}" title="${esc(d.desc)}">
        <span class="cf-mm-skulls">${SKULL.repeat(d.skulls)}</span>
        <span class="cf-mm-diff-n">${d.name}</span>
        <span class="cf-mm-diff-s" data-diff-sub></span>
      </button>`
    ).join('');

    // the career panels: the rank, the operators, every weapon's mastery and camos (the CAREER view and the
    // LOADOUT window of the play screen show the same thing)
    const carHtml = () => `
      <div class="cf-car">
        <div class="cf-car-side">
          <div class="cf-panel cf-car-rank"></div>
          <div class="cf-panel cf-car-ops">
            <div class="cf-car-h">OPERATOR</div>
            <div class="cf-car-oprow" data-row data-group></div>
            <div class="cf-car-ophint"></div>
          </div>
        </div>
        <div class="cf-panel cf-car-wpns">
          <div class="cf-car-h">WEAPON MASTERY <small>Kills level a weapon up · camos at levels 2 · 4 · 6 · 8 · 10</small></div>
          <div class="cf-car-list"></div>
        </div>
      </div>`;

    const lbModeHtml = MODE_LIST.map((m) => `<button data-sfx data-lb-mode="${m.id}"><i>${EMBLEMS[m.id] || ''}</i>${m.name}</button>`).join('');
    const lbDiffHtml = DIFFICULTIES.map(
      (d) => `<button data-sfx data-lb-diff="${d.id}"><span class="cf-mm-skulls">${SKULL.repeat(d.skulls)}</span>${d.name}<em data-lb-count></em></button>`
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
            <button class="cf-mm-profile" data-sfx data-go="career" data-row title="Career"></button>
          </section>

          <section class="cf-mm-view cf-mm-play" data-view="play">
            <div class="cf-mm-head">
              <button class="cf-mm-back cf-mm-back-lg" data-sfx data-go="home" data-row><i></i>BACK<span class="cf-kc">ESC</span></button>
            </div>
            <div class="cf-lob">
              <div class="cf-lob-stage">
                <div class="cf-lob-slots"></div>
              </div>
              <aside class="cf-mm-brief">
                <div class="cf-mm-brief-body">
                  <div class="cf-brief-pic">
                    <img data-brief-img alt="" draggable="false">
                    <span class="cf-brief-cap"><b data-brief-map></b></span>
                  </div>
                  <h3 class="cf-mm-brief-t"></h3>
                  <p class="cf-mm-brief-d"></p>
                  <div class="cf-sels">
                    ${selectHtml('map', 'MAP')}
                    ${selectHtml('mode', 'GAME MODE')}
                  </div>
                  <div class="cf-sel-l">DIFFICULTY</div>
                  <div class="cf-mm-diffs" data-row data-group>${diffHtml}</div>
                </div>
                ${listHtml('map')}
                ${listHtml('mode')}
              </aside>
              <button class="cf-mm-deploy" data-sfx data-row><span>DEPLOY</span><i class="cf-mm-arrows"><b></b><b></b><b></b></i></button>
            </div>
          </section>

          <section class="cf-mm-view cf-mm-career" data-view="career">
            ${head('CAREER', 'SERVICE RECORD')}
            ${carHtml()}
          </section>

          <section class="cf-mm-view cf-mm-lb" data-view="leaderboard">
            ${head('LEADERBOARD', 'LOCAL RECORDS')}
            <div class="cf-mm-lb-bar">
              <div class="cf-mm-lb-filters">
                <div class="cf-mm-lb-tabs cf-mm-lb-modes" data-row data-group>${lbModeHtml}</div>
                <div class="cf-mm-lb-tabs cf-mm-lb-diffs" data-row data-group>${lbDiffHtml}</div>
              </div>
              <label class="cf-mm-lb-name">
                <small>CALLSIGN</small>
                <span class="cf-mm-lb-name-f"><input type="text" data-row data-name maxlength="${LB.NAME_MAX}" spellcheck="false" autocomplete="off" autocapitalize="off" enterkeyhint="done" placeholder="${LB.DEFAULT_NAME}"><i class="cf-mm-lb-saved">SAVED</i></span>
              </label>
            </div>
            <div class="cf-panel cf-mm-lb-panel">
              <div class="cf-mm-lb-cap"><span class="cf-mm-lb-title"></span><span class="cf-mm-lb-meta"></span></div>
              <div class="cf-mm-lb-table" role="table" aria-label="Leaderboard">
                <div class="cf-mm-lb-row cf-mm-lb-hdr" role="row"><span>#</span><span>CALLSIGN</span><span class="r">SCORE</span><span class="r">ROUND</span><span class="r">KILLS</span><span class="r c-hs">HS</span><span class="r c-acc">ACC</span><span class="r c-time">TIME</span><span class="c-team">FIRETEAM</span><span class="r">DATE</span></div>
                <div class="cf-mm-lb-rows" data-row tabindex="0"></div>
              </div>
              <div class="cf-mm-lb-empty">
                <span class="cf-mm-lb-empty-ico">${EMBLEMS.cabinfever}</span>
                <b>NO RECORDS YET</b>
                <span class="cf-mm-lb-empty-t"></span>
                <button class="cf-btn cf-btn-primary" data-sfx data-go="play" data-row><span>PLAY</span></button>
              </div>
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
                <dt>APPENWEIER</dt><dd>Buildings: LoD2 © LGL Baden-Württemberg (dl-de/by-2-0) · Streets: © OpenStreetMap contributors (ODbL)</dd>
                <dt>THANKS</dt><dd>Everyone who held the farmhouse in 2009</dd>
              </dl>
            </div>
          </section>
        </div>

        <div class="cf-lo" data-layer="loadout" hidden>
          <div class="cf-lo-back" data-close></div>
          <div class="cf-lo-panel cf-panel">
            <div class="cf-lo-head">
              <div class="cf-lo-t"><h2>LOADOUT</h2></div>
              <button class="cf-lo-close" data-sfx data-row data-close><i></i>CLOSE<span class="cf-kc">ESC</span></button>
            </div>
            <div class="cf-lo-body">${carHtml()}</div>
            <div class="cf-sel-list cf-camo-list" role="listbox" data-camo-list hidden></div>
          </div>
        </div>

        <div class="cf-pk" data-layer="pick" hidden>
          <div class="cf-lo-back" data-close></div>
          <div class="cf-pk-panel cf-panel">
            <div class="cf-lo-head">
              <div class="cf-lo-t"><small data-pk-k>SLOT 2</small><h2>CHOOSE A BOT</h2></div>
              <button class="cf-lo-close" data-sfx data-row data-close><i></i>CLOSE<span class="cf-kc">ESC</span></button>
            </div>
            <div class="cf-pk-grid" data-row data-group data-multi></div>
          </div>
        </div>

        <div class="cf-mm-dip"></div>
      </div>`);
    this.root.appendChild(el);

    const q = (s) => el.querySelector(s);
    this.$main = {
      root: el,
      views: Object.fromEntries([...el.querySelectorAll('[data-view]')].map((v) => [v.dataset.view, v])),
      stage: q('.cf-lob-stage'),
      slots: q('.cf-lob-slots'),
      brief: q('.cf-mm-brief'),
      picBox: q('.cf-brief-pic'),
      pic: q('[data-brief-img]'),
      picMap: q('[data-brief-map]'),
      briefT: q('.cf-mm-brief-t'),
      briefD: q('.cf-mm-brief-d'),
      sels: Object.fromEntries(
        ['map', 'mode'].map((k) => [k, { btn: q(`[data-sel-toggle="${k}"]`), ico: q(`[data-sel="${k}"] [data-sel-ico]`), name: q(`[data-sel="${k}"] [data-sel-name]`), list: q(`[data-sel-list="${k}"]`) }])
      ),
      diffs: [...el.querySelectorAll('[data-diff]')],
      layers: { loadout: q('[data-layer="loadout"]'), pick: q('[data-layer="pick"]') },
      pickGrid: q('.cf-pk-grid'),
      pickK: q('[data-pk-k]'),
      profile: q('.cf-mm-profile'),
      cars: [...el.querySelectorAll('.cf-car')].map((c) => ({ compact: !!c.closest('.cf-lo'), rank: c.querySelector('.cf-car-rank'), ops: c.querySelector('.cf-car-oprow'), opHint: c.querySelector('.cf-car-ophint'), list: c.querySelector('.cf-car-list') })),
      camoList: q('[data-camo-list]'),
      lb: {
        modes: [...el.querySelectorAll('[data-lb-mode]')],
        diffs: [...el.querySelectorAll('[data-lb-diff]')],
        name: q('[data-name]'),
        saved: q('.cf-mm-lb-saved'),
        panel: q('.cf-mm-lb-panel'),
        title: q('.cf-mm-lb-title'),
        meta: q('.cf-mm-lb-meta'),
        rows: q('.cf-mm-lb-rows'),
        emptyT: q('.cf-mm-lb-empty-t'),
      },
    };

    el.addEventListener('click', (e) => {
      const t = e.target;
      const go = t.closest('[data-go]');
      if (go) {
        if (go.dataset.go === 'leaderboard') this._renderBoard(this.config.mode, this.config.difficulty);
        if (go.dataset.go === 'career') this._renderCareer();
        return this._setView(go.dataset.go, { kbd: e.detail === 0 });
      }
      if (this._sel && !t.closest('.cf-sel-list') && !t.closest('[data-sel-toggle]') && !t.closest('[data-camo-toggle]')) this._closeSel(this._sel);
      const ctog = t.closest('[data-camo-toggle]');
      if (ctog) return this._openCamo(ctog);
      const copt = t.closest('[data-copt]');
      if (copt) return this._pickCamo(copt);
      const tog = t.closest('[data-sel-toggle]');
      if (tog) return this._toggleSel(tog.dataset.selToggle);
      const opt = t.closest('[data-opt]');
      if (opt) {
        this._setConfig(opt.dataset.of, opt.dataset.opt);
        return this._closeSel(opt.dataset.of, true);
      }
      const d = t.closest('[data-diff]');
      if (d) return d.classList.contains('na') ? this._nope(d) : this._setConfig('difficulty', d.dataset.diff);
      const camo = t.closest('[data-camo]');
      if (camo) return this._setCamo(camo);
      const op = t.closest('[data-op]');
      if (op) return this._setOperator(op);
      const seat = t.closest('[data-seat]');
      if (seat) return this._openPick(Number(seat.dataset.seat));
      const clr = t.closest('[data-seat-clear]');
      if (clr) return this._setBot(Number(clr.dataset.seatClear), null);
      const pick = t.closest('[data-pick]');
      if (pick) {
        const seat = this._pickSeat;
        this._closeLayer();
        return this._setBot(seat, pick.dataset.pick || null); // (and focus goes to that seat)
      }
      if (t.closest('[data-loadout]')) return this._openLoadout();
      if (t.closest('[data-close]')) return this._closeLayer();
      const lm = t.closest('[data-lb-mode]');
      if (lm) return this._renderBoard(lm.dataset.lbMode, this._lb.difficulty);
      const ld = t.closest('[data-lb-diff]');
      if (ld) return this._renderBoard(this._lb.mode, ld.dataset.lbDiff);
      if (t.closest('.cf-mm-deploy')) this._deploy();
    });

    this._bindName();
    this._buildSettings(q('.cf-mm-set-body'));
    this._syncConfig();
    this._renderProfile();
  }

  /* ---------------- career (game/progress.js) ---------------- */

  /** a locked option was clicked: a shake and a dull click */
  _nope(el) {
    el.classList.remove('nope');
    void el.offsetWidth;
    el.classList.add('nope');
    this._sfx('ui_hover');
  }

  _swatch(id) {
    this._sw ??= {};
    if (!(id in this._sw)) this._sw[id] = skinSwatch(id);
    return this._sw[id];
  }

  /** the home screen's badge: insignia, rank, the bar to the next one */
  _renderProfile() {
    const P = this.$main?.profile;
    if (!P) return;
    const you = this.$main.slots?.querySelector('.cf-lob-slot.you .cf-lob-name');
    if (you) you.textContent = this._name();
    const r = Progress.rankOf();
    const pct = r.next ? r.into / r.span : 1;
    P.innerHTML = `<span class="cf-mm-prof-ins">${insigniaSvg(r.index)}</span><span class="cf-mm-prof-t"><small>${esc(this._name())}</small><b>${esc(r.rank.name)}</b><span class="cf-mm-prof-bar"><i style="transform:scaleX(${pct.toFixed(4)})"></i></span><em>${fmtNum(Progress.career().xp)} XP${r.next ? ` · NEXT ${esc(r.next.short)}` : ''}</em></span>`;
  }

  /** the career view: the rank and its ladder, the operator skins, every weapon's mastery and camos */
  _renderCareer() {
    for (const C of this.$main.cars) this._renderCareerInto(C);
  }

  _renderCareerInto(C) {
    const compact = C.compact; // the loadout window: your rank, the operators, one camo per weapon (a select); the CAREER view has it all
    const p = Progress.career();
    const r = Progress.rankOf();
    const pct = r.next ? r.into / r.span : 1;
    const me = `
      <div class="cf-car-me">
        <div class="cf-car-ins">${insigniaSvg(r.index)}</div>
        <div class="cf-car-id">
          ${compact ? '' : `<small>${esc(r.rank.short)} · GRADE ${r.index + 1} / ${Progress.RANKS.length}</small>`}
          <b>${esc(r.rank.name)}</b>
          <div class="cf-car-bar"><i style="transform:scaleX(${pct.toFixed(4)})"></i></div>
          <span class="cf-car-xp"><b>${fmtNum(p.xp)}</b> XP${r.next ? ` · ${fmtNum(r.span - r.into)} TO ${esc(r.next.name.toUpperCase())}` : ' · TOP OF THE LADDER'}</span>
        </div>
      </div>`;
    if (compact) C.rank.innerHTML = me;
    else {
      const wins = DIFFICULTIES.map((d) => `<span><small>${d.name}</small><b>${p.wins['cabinfever:' + d.id] ?? 0}</b></span>`).join('');
      const ladder = Progress.RANKS.map((k, i) => `<i class="${i < r.index ? 'got' : i === r.index ? 'cur' : ''}" title="${esc(k.name)} · ${fmtNum(k.xp)} XP">${insigniaSvg(i)}</i>`).join('');
      C.rank.innerHTML = `${me}
      <div class="cf-car-stats">
        <span><small>RUNS</small><b>${fmtNum(p.runs)}</b></span>
        <span><small>KILLS</small><b>${fmtNum(p.kills)}</b></span>
        <span><small>HEADSHOTS</small><b>${fmtNum(p.headshots)}</b></span>
        <span><small>GAUNTLETS</small><b>${p.wins['gauntlet:extreme'] ?? 0}</b></span>
      </div>
      <div class="cf-car-wins"><small>STORY WINS</small>${wins}</div>
      <div class="cf-car-ladder">${ladder}</div>`;
    }
    // the operators (the window names only what is locked: how to earn it)
    const you = Progress.character();
    C.ops.innerHTML = Progress.CHARACTER_SKINS.map((c) => {
      const ok = Progress.characterUnlocked(c.id);
      const pic = this._portraits[c.bot ?? 'player'];
      const note = ok ? (compact ? '' : c.id === you.id ? 'ACTIVE' : 'READY') : esc(c.how.toUpperCase());
      return `<button class="cf-car-op${c.id === you.id ? ' sel' : ''}${ok ? '' : ' locked'}" data-sfx data-op="${c.id}" title="${esc(ok ? c.name : c.how)}">
          <span class="cf-car-op-pic">${pic ? `<img src="${pic}" alt="" draggable="false">` : HELMET}${ok ? '' : `<span class="cf-car-op-lock">${LOCK}</span>`}</span>
          <b>${esc(c.name)}</b>${note ? `<small>${note}</small>` : ''}
        </button>`;
    }).join('');
    this._opHint(C);
    // weapon mastery, the most used first
    const rows = MASTERY_IDS.map((id) => ({ id, m: Progress.masteryOf(id) })).sort((a, b) => b.m.xp - a.m.xp || MASTERY_IDS.indexOf(a.id) - MASTERY_IDS.indexOf(b.id));
    C.list.innerHTML = rows
      .map(({ id, m }) => {
        const d = WEAPONS[id];
        const cur = Progress.skinOf(id);
        let camos;
        if (!CAMO_OK(id)) camos = '<small class="cf-car-nocamo">NO CAMOS</small>';
        else if (compact) camos = this._camoBtn(id);
        else
          camos = Progress.WEAPON_SKINS.map((k) => {
            const ok = Progress.skinUnlocked(id, k.id);
            const sw = this._swatch(k.id);
            return `<button class="cf-car-camo c-${k.id}${cur === k.id ? ' sel' : ''}${ok ? '' : ' locked'}" data-sfx data-camo="${k.id}" data-wpn="${id}" title="${esc(k.name)}${ok ? '' : ` · mastery level ${k.level}`}"${sw ? ` style="background-image:url(${sw})"` : ''}>${ok ? '' : `<i>${k.level}</i>`}</button>`;
          }).join('');
        const pct = m.span ? m.into / m.span : 1;
        return `<div class="cf-car-w${m.xp > 0 ? '' : ' fresh'}${compact ? ' compact' : ''}">
            <span class="cf-car-w-ico">${weaponSvg(weaponKind(d.name))}</span>
            <span class="cf-car-w-n"><b>${esc(d.name)}</b><small>${m.span ? `${fmtNum(m.into)} / ${fmtNum(m.span)} XP` : 'MASTERED'}</small><span class="cf-car-w-bar"><i style="transform:scaleX(${pct.toFixed(4)})"></i></span></span>
            <span class="cf-car-w-lv" title="Mastery level ${m.level}">${masterySvg(m.level)}</span>
            <span class="cf-car-camos"${CAMO_OK(id) && !compact ? ' data-row data-group' : ''}>${camos}</span>
          </div>`;
      })
      .join('');
  }

  /** a weapon's camo select (the loadout window): the camo it wears; the list of all of them opens under it */
  _camoBtn(id) {
    const cur = Progress.WEAPON_SKINS.find((k) => k.id === Progress.skinOf(id)) ?? Progress.WEAPON_SKINS[0];
    const sw = this._swatch(cur.id);
    return `<button class="cf-camo-btn" data-sfx data-row data-camo-toggle="${id}" aria-haspopup="listbox" aria-expanded="false"><i class="cf-camo-sw"${sw ? ` style="background-image:url(${sw})"` : ''}></i><span>${esc(cur.name)}</span><i class="cf-sel-chev"></i></button>`;
  }

  _openCamo(btn) {
    const wpn = btn.dataset.camoToggle;
    if (this._sel === 'camo' && this._camoBtnEl === btn) return this._closeSel('camo', true);
    this._closeSel(this._sel);
    this._camoBtnEl = btn;
    this._camoWpn = wpn;
    const list = this.$main.camoList;
    const cur = Progress.skinOf(wpn);
    list.innerHTML = Progress.WEAPON_SKINS.map((k) => {
      const ok = Progress.skinUnlocked(wpn, k.id);
      const sw = this._swatch(k.id);
      return `<button class="cf-sel-opt cf-camo-opt${k.id === cur ? ' sel' : ''}${ok ? '' : ' locked'}" role="option" data-sfx data-copt="${k.id}" aria-selected="${k.id === cur}">
          <i class="cf-camo-sw"${sw ? ` style="background-image:url(${sw})"` : ''}></i><span class="cf-sel-n">${esc(k.name)}</span>${ok ? '' : `<small>${LOCK}LEVEL ${k.level}</small>`}
        </button>`;
    }).join('');
    const panel = this.$main.layers.loadout.querySelector('.cf-lo-panel');
    const b = btn.getBoundingClientRect();
    const a = panel.getBoundingClientRect();
    list.style.width = `${Math.max(b.width, 230)}px`;
    list.style.left = `${Math.min(b.left, a.right - Math.max(b.width, 230) - 12) - a.left}px`;
    list.hidden = false;
    // under the button, or over it when the panel's bottom is in the way
    const h = list.offsetHeight;
    list.style.top = `${(b.bottom + 6 + h > a.bottom - 8 ? b.top - h - 6 : b.bottom + 6) - a.top}px`;
    btn.setAttribute('aria-expanded', 'true');
    this._sel = 'camo';
    (list.querySelector('.sel') || list.querySelector('[data-copt]'))?.focus();
  }

  /** a camo picked from the list: worn at once (a locked one shakes); the button shows it */
  _pickCamo(opt) {
    const wpn = this._camoWpn;
    if (opt.classList.contains('locked') || !Progress.setSkin(wpn, opt.dataset.copt)) return this._nope(opt);
    const btn = this._camoBtnEl;
    if (btn) btn.outerHTML = this._camoBtn(wpn);
    this._camoBtnEl = this.$main.layers.loadout.querySelector(`[data-camo-toggle="${wpn}"]`);
    this._closeSel('camo', true);
    if (wpn === 'm4a1') this._lobbyCast(); // (the rifle in your hands in the line-up)
  }

  _opHint(C) {
    const me = Progress.character();
    const text = me.bot ? `You are ${FIRETEAM_BY_ID[me.bot]?.name ?? me.name} now: the bot sits out your fireteam.` : 'Your own operator. Scorpion and Viper can be earned.';
    for (const c of C ? [C] : this.$main.cars) c.opHint.textContent = text;
  }

  _setCamo(btn) {
    if (btn.classList.contains('locked') || !Progress.setSkin(btn.dataset.wpn, btn.dataset.camo)) return this._nope(btn);
    for (const b of btn.parentElement.children) b.classList.toggle('sel', b === btn);
    if (btn.dataset.wpn === 'm4a1') this._lobbyCast(); // (the rifle in your hands in the line-up)
    this._sfx('ui_click');
  }

  _setOperator(btn) {
    if (btn.classList.contains('locked') || !Progress.setCharacter(btn.dataset.op)) return this._nope(btn);
    const me = Progress.character();
    for (const b of btn.parentElement.children) {
      b.classList.toggle('sel', b === btn);
      const ok = !b.classList.contains('locked');
      const note = b.querySelector('small');
      if (ok && note) note.textContent = b === btn ? 'ACTIVE' : 'READY';
    }
    this._opHint();
    this._renderLobby(); // the body in the line-up (and the bot seat of the one you now wear)
    this._sfx('ui_click');
    return me;
  }

  /* ---------------- lobby: the four seats ---------------- */

  /**
   * The four seats: you, then the bots you brought (or an empty seat to add one to). Each is an anchor that
   * ui/lobbyStage.js moves over that body's feet in the map: its name under it, the click target over it, the
   * plus on an empty seat, LOADOUT under your own name.
   */
  _renderLobby() {
    const M = this.$main;
    if (!M.slots) return;
    const me = Progress.character();
    const seat = (i, cls, inner) => `<div class="cf-lob-seat ${cls}" data-slot="${i}" style="--i:${i}" hidden>${inner}</div>`;
    const seats = [
      seat(
        0,
        'you',
        `<button class="cf-lob-hit" data-sfx data-loadout tabindex="-1" aria-hidden="true"></button>
        <div class="cf-lob-label"><b class="cf-lob-name">${esc(this._name())}</b><button class="cf-lob-loadout" data-sfx data-row data-loadout>${GEAR}<span>LOADOUT</span></button></div>`
      ),
    ];
    this.config.slots.forEach((id, i) => {
      const bot = id && id !== me.bot ? FIRETEAM_BY_ID[id] : null; // (the one whose body you wear sits out)
      seats.push(
        bot
          ? seat(
              i + 1,
              'bot',
              `<button class="cf-lob-hit" data-sfx data-row data-seat="${i}" aria-label="Change ${esc(bot.name)}"></button>
              <div class="cf-lob-label"><b class="cf-lob-name">${esc(bot.name)}</b><span class="cf-lob-x" data-sfx data-seat-clear="${i}" title="Remove ${esc(bot.name)}"><i></i></span></div>`
            )
          : seat(
              i + 1,
              'empty',
              `<button class="cf-lob-hit" data-sfx data-seat="${i}" tabindex="-1" aria-hidden="true"></button>
              <button class="cf-lob-add" data-sfx data-row data-seat="${i}" aria-label="Add a bot"><span class="cf-lob-plus"></span></button>
              <div class="cf-lob-label"><b class="cf-lob-name">ADD BOT</b></div>`
            )
      );
    });
    M.slots.innerHTML = seats.join('');
    this._lobbyCast();
  }

  /** bots into the seats (and your own operator, with the camo on its rifle), for the live line-up */
  _lobbyCast() {
    const st = this._stage;
    if (!st?.running) return;
    const cast = this.cb.getLobbyCast?.();
    if (!cast) return;
    const me = Progress.character();
    const you = cast.player;
    you._wear(me.body); // (an operator switch: the new body takes the old one's place in the scene)
    const list = [{ slot: 0, body: you, skin: Progress.skinOf('m4a1') }];
    this.config.slots.forEach((id, i) => {
      const bot = id && id !== me.bot ? cast.bots.find((b) => b.id === id) : null;
      if (bot) list.push({ slot: i + 1, body: bot });
    });
    st.setCast(list);
  }

  _lobbyShow() {
    if (this._view !== 'play' || this._current !== 'main') return;
    const M = this.$main;
    const cast = this.cb.getLobbyCast?.();
    if (!cast) return; // (the game is still loading)
    this._stage ??= new LobbyStage(cast.game, M.stage, () => [...M.slots.querySelectorAll('.cf-lob-seat')]);
    window.__lobbyStage = this._stage; // (debug handle, like __game: re-aim a map's 'lobby' shot live)
    if (this._stage.start()) this._lobbyCast();
  }

  /** the bodies are hidden again (before DEPLOY, and whenever the play view goes away) */
  _lobbyHide() {
    this._stage?.stop();
  }

  /** put a bot on seat `i` (0-2), or clear it; a bot only sits once */
  _setBot(i, id) {
    const slots = this.config.slots.slice();
    if (id) for (let k = 0; k < slots.length; k++) if (slots[k] === id) slots[k] = null;
    slots[i] = id || null;
    this.config.slots = slots;
    this.config.fireteam = normalizeFireteam(slots.filter(Boolean)) ?? [];
    saveJSON(LS_LOADOUT, this.config);
    this._renderLobby();
    this._focusSeat(i);
  }

  _focusSeat(i) {
    this.$main.slots.querySelector(`[data-seat="${i}"]`)?.focus();
  }

  /** the picker: the characters that aren't seated yet (and not the one whose body you wear) */
  _openPick(i) {
    this._pickSeat = i;
    this.$main.pickK.textContent = `SEAT ${i + 2}`;
    this._renderPick();
    this._openLayer('pick');
  }

  _renderPick() {
    const i = this._pickSeat;
    const me = Progress.character();
    const cur = this.config.slots[i];
    const taken = new Set(this.config.slots.filter((id, k) => id && k !== i));
    const cards = FIRETEAM.filter((c) => c.id !== me.bot && !taken.has(c.id)).map((c) => {
      const url = this._portraits[c.id];
      return `<button class="cf-pk-card${c.id === cur ? ' sel' : ''}" data-sfx data-pick="${c.id}">
          <span class="cf-pk-pic">${url ? `<img src="${url}" alt="" draggable="false">` : HELMET}</span>
          <span class="cf-pk-txt"><b>${esc(c.name)}</b><span><i>${weaponSvg(weaponKind(c.gun))}</i>${esc(c.gun)}</span></span>
        </button>`;
    });
    if (cur && cur !== me.bot) cards.push(`<button class="cf-pk-card rm" data-sfx data-pick=""><span class="cf-pk-pic"><i class="cf-pk-rm"></i></span><span class="cf-pk-txt"><b>REMOVE</b><span>EMPTY SEAT</span></span></button>`);
    this.$main.pickGrid.innerHTML = cards.join('') || '<div class="cf-pk-none">EVERYONE IS ALREADY ON THE TEAM</div>';
  }

  /* ---------------- windows over the play view: the picker and the loadout ---------------- */

  _openLoadout() {
    this._renderCareer();
    this._openLayer('loadout');
  }

  _openLayer(name) {
    this._closeSel(this._sel);
    const L = this.$main.layers[name];
    if (this._layer && this._layer !== L) this._layer.hidden = true;
    this._from = this._layer ? this._from : document.activeElement;
    L.hidden = false;
    this._layer = L;
    L.classList.remove('in');
    void L.offsetWidth;
    L.classList.add('in');
    (L.querySelector('.cf-pk-card.sel, .cf-car-op.sel') || L.querySelector('.cf-pk-card') || L.querySelector('.cf-lo-close'))?.focus();
  }

  _closeLayer() {
    const L = this._layer;
    if (!L) return;
    this._closeSel(this._sel);
    L.hidden = true;
    this._layer = null;
    const from = this._from;
    this._from = null;
    if (from && document.contains(from) && from.getClientRects().length) from.focus();
    else this._focusView();
  }

  /* ---------------- the map and mode selects ---------------- */

  _fillSelect(key, id, icon, name) {
    const S = this.$main.sels[key];
    S.btn.dataset.val = id; // (the CSS colours the Endless and Gauntlet emblems red)
    S.ico.innerHTML = icon || '';
    S.name.textContent = name;
    for (const o of S.list.querySelectorAll('[data-opt]')) {
      const on = o.dataset.opt === id;
      o.classList.toggle('sel', on);
      o.setAttribute('aria-selected', on ? 'true' : 'false');
    }
  }

  _toggleSel(key) {
    const S = this.$main.sels[key];
    if (!S.list.hidden) return this._closeSel(key);
    this._closeSel(this._sel);
    const M = this.$main;
    const b = S.btn.getBoundingClientRect();
    const a = M.brief.getBoundingClientRect();
    S.list.style.left = `${b.left - a.left}px`;
    S.list.style.top = `${b.bottom - a.top + 6}px`;
    S.list.style.width = `${b.width}px`;
    S.list.hidden = false;
    S.btn.setAttribute('aria-expanded', 'true');
    this._sel = key;
    (S.list.querySelector('.sel') || S.list.querySelector('[data-opt]'))?.focus();
  }

  /** close a select's list; refocus: back on its button (a pick, Esc) */
  _closeSel(key, refocus = false) {
    if (!key) return;
    const S = key === 'camo' ? { list: this.$main.camoList, btn: this._camoBtnEl } : this.$main.sels[key];
    S.list.hidden = true;
    S.btn?.setAttribute('aria-expanded', 'false');
    if (this._sel === key) this._sel = null;
    if (refocus) S.btn?.focus();
  }

  /** keys while a select's list is open: arrows move, Enter / Space pick (the button's own click), Esc closes */
  _selKey(e) {
    const S = this._sel === 'camo' ? { list: this.$main.camoList } : this.$main.sels[this._sel];
    const opts = [...S.list.querySelectorAll('[data-opt], [data-copt]')];
    const a = document.activeElement;
    const i = opts.indexOf(a);
    const k = e.key;
    if (k === 'Escape' || k === 'Backspace' || k === 'Tab') {
      e.preventDefault();
      this._sfx('ui_click');
      return this._closeSel(this._sel, true);
    }
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowLeft') {
      e.preventDefault();
      const next = opts[clamp(i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1), 0, opts.length - 1)];
      if (next && next !== a) {
        next.focus();
        this._sfx('ui_hover');
      }
      return;
    }
    if (k === ' ' && a?.tagName === 'BUTTON') {
      e.preventDefault();
      if (!e.repeat) a.click();
    }
  }

  /** small round portrait of a character (initial when the portraits aren't rendered) */
  _avatar(id) {
    const c = FIRETEAM_BY_ID[id];
    if (!c) return '';
    const url = this._portraits[id];
    return `<i class="cf-av" title="${esc(c.name)} · ${esc(c.gun)}">${url ? `<img src="${url}" alt="">` : esc(c.name[0])}</i>`;
  }

  /* ---------------- leaderboard ---------------- */

  _name() {
    if (this._playerName == null) this._playerName = LB.getPlayerName();
    return this._playerName;
  }

  _bindName() {
    const L = this.$main.lb;
    const input = L.name;
    input.value = this._name();
    let t = 0;
    const commit = (flash) => {
      const n = LB.setPlayerName(input.value);
      const changed = n !== this._playerName;
      this._playerName = n;
      if (changed) this._renderProfile();
      if (flash && changed) {
        L.saved.classList.remove('on');
        void L.saved.offsetWidth;
        L.saved.classList.add('on');
      }
    };
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => commit(true), 500);
    });
    input.addEventListener('blur', () => {
      clearTimeout(t);
      commit(true);
      input.value = this._name(); // show the cleaned-up name (or the default when left empty)
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        clearTimeout(t);
        commit(true);
        input.value = this._name();
        this._sfx('ui_click');
      }
      // typing stays in the field: the game's key tracker would swallow Space / Ctrl combos.
      // Esc and Up / Down still reach the menu navigation.
      if (e.key !== 'Escape' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') e.stopPropagation();
    });
  }

  /** (Re)draw the leaderboard for a mode × difficulty (defaults: the current filter). */
  _renderBoard(mode = this._lb.mode, difficulty = this._lb.difficulty) {
    const L = this.$main.lb;
    if (!MODES[mode]) mode = 'cabinfever';
    if (!DIFFICULTIES.some((d) => d.id === difficulty)) difficulty = 'hard';
    const switched = mode !== this._lb.mode || difficulty !== this._lb.difficulty;
    this._lb = { mode, difficulty };
    const m = MODES[mode];
    const diff = DIFFICULTIES.find((d) => d.id === difficulty);
    let runs = [];
    let sum = { counts: {}, last: null };
    try {
      runs = LB.topRuns(mode, difficulty);
      sum = LB.summary();
    } catch (err) {
      console.error('[menu] leaderboard read failed', err);
    }
    for (const b of L.modes) b.classList.toggle('sel', b.dataset.lbMode === mode);
    for (const b of L.diffs) {
      b.classList.toggle('sel', b.dataset.lbDiff === difficulty);
      const n = sum.counts[LB.boardKey(mode, b.dataset.lbDiff)] ?? 0;
      b.querySelector('[data-lb-count]').textContent = n ? String(n) : '';
    }
    if (document.activeElement !== L.name) L.name.value = this._name();
    L.title.innerHTML = `${m.name} <em>·</em> ${diff.name}`;
    L.meta.textContent = runs.length ? `${runs.length} RUN${runs.length === 1 ? '' : 'S'} · BEST ${pad(runs[0].score, 6)}` : 'NO RUNS';
    L.panel.classList.toggle('empty', !runs.length);
    L.emptyT.innerHTML = m.endless
      ? `Hold out in <b>${m.name} · ${diff.name}</b> and your best runs land here.`
      : `Finish a <b>${m.name} · ${diff.name}</b> run (or quit after round 1) to set the first score.`;
    const maxR = m.endless ? null : diff.rounds;
    L.rows.innerHTML = runs
      .map((r, i) => {
        const last = r.id === sum.last;
        const acc = r.accuracy == null ? '—' : `${Math.round(r.accuracy * 100)}%`;
        const team = r.team.length ? r.team.map((id) => this._avatar(id)).join('') : '<small>SOLO</small>';
        const round = maxR ? `${pad(r.round, 2)}<small>/${maxR}</small>` : pad(r.round, 2);
        return `<div class="cf-mm-lb-row${last ? ' last' : ''}${i < 3 ? ` top top${i + 1}` : ''}" role="row">
          <span class="c-rank">${pad(i + 1, 2)}</span>
          <span class="c-name"><b>${esc(r.name)}</b>${last ? '<em>LATEST</em>' : ''}<small class="o-${r.outcome}">${LB.OUTCOMES[r.outcome]}</small></span>
          <span class="r c-score">${pad(r.score, 6)}</span>
          <span class="r c-round">${round}</span>
          <span class="r">${r.kills}</span>
          <span class="r c-hs">${r.headshots}</span>
          <span class="r c-acc">${acc}</span>
          <span class="r c-time">${fmtTime(r.time)}</span>
          <span class="c-team">${team}</span>
          <span class="r c-date" title="${esc(fmtStamp(r.date))}">${fmtDate(r.date)}</span>
        </div>`;
      })
      .join('');
    if (switched) L.rows.scrollTop = 0;
    // bring the latest run into view (next frame: the view may only just have been shown)
    const hi = L.rows.querySelector('.last');
    if (hi) requestAnimationFrame(() => hi.scrollIntoView?.({ block: 'nearest' }));
  }

  _setView(view, { kbd = false, instant = false } = {}) {
    if (!VIEWS[view]) view = 'home';
    const M = this.$main;
    const prev = this._view;
    const apply = () => {
      this._view = view;
      this._closeSel(this._sel);
      if (this._layer) this._closeLayer();
      for (const [k, v] of Object.entries(M.views)) v.classList.toggle('on', k === view);
      M.root.dataset.view = view;
      if (view === 'play') {
        this._renderLobby();
        this._lobbyShow();
      } else this._lobbyHide();
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

  /** keyboard rows of the current view that are actually shown (the leaderboard hides its table or empty state) */
  _rows() {
    const v = this._layer ?? this.$main.views[this._view];
    return [...v.querySelectorAll('[data-row]')].filter((r) => r.getClientRects().length > 0);
  }

  _focusView() {
    const rows = this._rows();
    const first = rows.find((r) => !r.classList.contains('cf-mm-back')) || rows[0];
    this._focusRow(first);
  }

  _focusRow(row) {
    if (!row) return;
    const target = row.hasAttribute('data-group') ? row.querySelector('.sel') || row.querySelector('button') : row;
    target?.focus();
  }

  _onKey(e) {
    if (this._current === 'pause') return this._pauseKey(e);
    if (this._current !== 'main') return;
    if (this._sel) return this._selKey(e);
    if (e.key === 'Escape' || (e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName))) {
      if (this._layer) {
        e.preventDefault();
        this._sfx('ui_click');
        this._closeLayer();
        return;
      }
      if (this._view !== 'home') {
        e.preventDefault();
        this._sfx('ui_click');
        this._setView('home', { kbd: true });
      }
      return;
    }
    const k = e.key;
    if (k === ' ' && document.activeElement?.tagName === 'BUTTON' && this.root.contains(document.activeElement)) {
      // Space presses the focused button (the game's key tracker cancels the browser's own Space activation)
      e.preventDefault();
      if (!e.repeat) document.activeElement.click();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
    const a = document.activeElement;
    // sliders use the arrows themselves; a text field keeps left / right for its caret
    if (a?.tagName === 'INPUT' && (a.type !== 'text' || k === 'ArrowLeft' || k === 'ArrowRight')) return;
    const rows = this._rows();
    if (!rows.length) return;
    e.preventDefault();
    const row = rows.find((r) => r === a || r.contains(a));
    if (!row) return this._focusRow(rows.find((r) => !r.classList.contains('cf-mm-back')) || rows[0]);
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && row.hasAttribute('data-group')) {
      // move inside an option group: selects it (radio groups) or just moves (toggle groups: Enter / Space toggles)
      const btns = [...row.querySelectorAll('button')];
      const i = btns.indexOf(a);
      const next = btns[clamp(i + (k === 'ArrowRight' ? 1 : -1), 0, btns.length - 1)];
      if (next && next !== a) {
        next.focus();
        if (row.hasAttribute('data-multi')) this._sfx('ui_hover');
        else next.click();
      }
      return;
    }
    // the leaderboard table scrolls with Up / Down first, then hands focus on
    if (row === this.$main.lb.rows && (k === 'ArrowUp' || k === 'ArrowDown')) {
      const down = k === 'ArrowDown';
      if (down ? row.scrollTop + row.clientHeight < row.scrollHeight - 1 : row.scrollTop > 0) {
        row.scrollTop += down ? 44 : -44;
        return;
      }
    }
    const i = rows.indexOf(row);
    const next = rows[clamp(i + (k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1), 0, rows.length - 1)];
    if (next !== row) {
      this._sfx('ui_hover');
      this._focusRow(next);
    }
  }

  /** main.js: go straight on with a setup (a deploy that switched maps, resumed after the reload) */
  deploy(config) {
    if (config && typeof config === 'object') this.config = { ...sanitizeLoadout(config), map: this.loadedMap.id };
    this._syncConfig();
    this._deploy();
  }

  _deploy() {
    this._lobbyHide(); // (game.start() spawns the bots itself: they must be back in the game scene)
    const me = Progress.character();
    const cfg = { ...this.config, primary: STANDARD_PRIMARY, fireteam: (this.config.fireteam ?? []).filter((id) => id !== me.bot) };
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
    const dId = mode.difficulty ?? c.difficulty; // (the Gauntlet: always Extreme)
    if (!MAPS[c.map]) c.map = this.loadedMap.id;
    const map = MAPS[c.map];
    this._fillSelect('map', map.id, MAP_EMBLEMS[map.id], map.name);
    this._fillSelect('mode', mode.id, EMBLEMS[mode.id], mode.name);
    for (const b of M.diffs) {
      b.classList.toggle('sel', b.dataset.diff === dId);
      b.classList.toggle('na', !!mode.difficulty && b.dataset.diff !== mode.difficulty);
      b.querySelector('[data-diff-sub]').textContent = mode.difficulty && b.dataset.diff === mode.difficulty ? 'ALWAYS' : '';
    }
    // the briefing: the map's picture, the mode's name and its text
    if (M.pic.dataset.map !== map.id) {
      M.pic.dataset.map = map.id;
      M.picBox.classList.remove('nopic', 'swap');
      void M.picBox.offsetWidth;
      M.picBox.classList.add('swap');
      M.pic.onerror = () => M.picBox.classList.add('nopic');
      M.pic.src = mapImageUrl(map);
    }
    M.picMap.textContent = map.name;
    M.briefT.textContent = mode.name;
    M.briefD.textContent = map.modeDesc?.[mode.id] ?? mode.desc;
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
      <div class="cf-set-row cf-set-toggle" data-key="fullscreen"${document.fullscreenEnabled ? '' : ' hidden'}>
        <label>FULLSCREEN</label>
        <button class="cf-toggle" data-sfx role="switch"><i></i><span class="cf-toggle-off">OFF</span><span class="cf-toggle-on">ON</span></button>
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
    const toggles = [...wrap.querySelectorAll('.cf-set-toggle')].map((row) => {
      const key = row.dataset.key;
      const btn = row.querySelector('.cf-toggle');
      btn.addEventListener('click', () => this._setSetting(key, !this.settings[key]));
      return { key, btn };
    });
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
        for (const { key, btn } of toggles) {
          btn.classList.toggle('on', !!s[key]);
          btn.setAttribute('aria-checked', s[key] ? 'true' : 'false');
        }
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
    if (key === 'showFps' || key === 'fullscreen') value = !!value;
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

  /** Esc again closes the pause menu: its settings panel first, then the menu itself (back into the game). */
  _pauseKey(e) {
    // (not the Esc that paused, where a browser hands that one to the page too)
    if (e.key !== 'Escape' || e.repeat || performance.now() - this._shownAt < 250) return;
    e.preventDefault();
    this._sfx('ui_click');
    if (this.$pause.root.classList.contains('show-settings')) {
      this._togglePauseSettings(false);
      return;
    }
    this._call('onResume');
    if (this._current === 'pause') this._show(null);
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
            <div class="cf-stat"><label>ACCURACY</label><b class="cf-e-acc">—</b></div>
            <div class="cf-stat"><label class="cf-e-rounds-l">ROUNDS SURVIVED</label><b class="cf-e-rounds">00/00</b></div>
            <div class="cf-stat"><label>TIME</label><b class="cf-e-time">00:00</b></div>
          </div>
          <div class="cf-end-career" hidden>
            <div class="cf-ec-ins"></div>
            <div class="cf-ec-main">
              <div class="cf-ec-top"><small>SERVICE RECORD</small><span class="cf-ec-promo">PROMOTED</span><b class="cf-ec-xp">+<span>0</span> XP</b></div>
              <div class="cf-ec-name"></div>
              <div class="cf-ec-bar"><i class="cf-ec-gain"></i><i class="cf-ec-was"></i></div>
              <div class="cf-ec-sub"><span class="cf-ec-into"></span><span class="cf-ec-parts"></span></div>
            </div>
          </div>
          <div class="cf-end-chips cf-end-mastery"></div>
          <div class="cf-end-chips cf-end-unlocks"></div>
          <div class="cf-end-chips cf-end-build"></div>
          <div class="cf-end-rank" hidden><b></b><span></span></div>
          <div class="cf-end-team"></div>
          <p class="cf-end-epi">Prolonged exposure to the toxic gas has consequences...</p>
          <div class="cf-end-btns">
            <button class="cf-btn cf-btn-primary" data-sfx data-act="again"><span>PLAY AGAIN</span></button>
            <button class="cf-btn" data-sfx data-act="board"><span>LEADERBOARD</span></button>
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
      acc: q('.cf-e-acc'),
      rank: q('.cf-end-rank'),
      rankT: q('.cf-end-rank b'),
      rankS: q('.cf-end-rank span'),
      team: q('.cf-end-team'),
      career: q('.cf-end-career'),
      cIns: q('.cf-ec-ins'),
      cXp: q('.cf-ec-xp span'),
      cName: q('.cf-ec-name'),
      cWas: q('.cf-ec-was'),
      cGain: q('.cf-ec-gain'),
      cInto: q('.cf-ec-into'),
      cParts: q('.cf-ec-parts'),
      mastery: q('.cf-end-mastery'),
      unlocks: q('.cf-end-unlocks'),
      build: q('.cf-end-build'),
    };
    q('.cf-end-btns').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'again') {
        this._call('onPlayAgain');
        if (this._current === 'end') this._show(null);
      } else if (b.dataset.act === 'board') {
        // back to the menu, straight onto this run's board with the run highlighted
        this._call('onQuit');
        if (this._current === 'end') {
          const B = this._endBoard ?? this._lb;
          this._lb = { mode: B.mode, difficulty: B.difficulty };
          this.showMain('leaderboard');
        }
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
    const text = (t) => (typeof t === 'string' ? t : t[this.loadedMap?.id] ?? t.farm);
    let i = Math.floor(Math.random() * TIPS.length);
    tip.textContent = text(TIPS[i]);
    clearInterval(this._tipTimer);
    this._tipTimer = setInterval(() => {
      i = (i + 1) % TIPS.length;
      tip.textContent = text(TIPS[i]);
    }, 4200);
  }
}

export default Menu;
