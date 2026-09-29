/*
 * CABIN FEVER — menus: cinematic main menu (title → play setup / settings / controls / credits),
 * loading, pause, end screens, click-to-play. Pure DOM; main-menu styles live in menu.css.
 * Settings and the last setup persist in localStorage. Everyone deploys with the standard kit;
 * better guns are bought in the between-round store.
 */

import './menu.css';
import { ensureUiFonts, esc, weaponSvg, weaponKind } from './hud.js';
import { MODE_LIST, MODES, DIFFICULTIES, THREATS, unlocksFor } from '../game/modes.js';
import { FIRETEAM, FIRETEAM_IDS, FIRETEAM_BY_ID, LEGACY_LINEUPS, normalizeFireteam } from '../actors/fireteam.js';
import * as LB from './leaderboard.js';
import * as Progress from '../game/progress.js';
import { insigniaSvg, masterySvg } from './insignia.js';
import { skinSwatch } from '../player/skins.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { cardIcon } from './cardIcons.js';
import { MAP_LIST, MAPS } from '../world/maps.js';

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
const VIEWS = { home: 'title', play: 'porch', career: 'interior', leaderboard: 'interior', settings: 'interior', controls: 'interior', credits: 'interior' };

const NAV = [
  ['play', 'PLAY', 'Map · mode · difficulty · fireteam'],
  ['career', 'CAREER', 'Rank · weapon mastery · operators'],
  ['leaderboard', 'LEADERBOARD', 'Your best runs'],
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
 * fireteam is a list of character ids; saves from the 0-3 size picker keep the characters that size
 * used to field (1 = Viper, 2 = Viper + Scorpion, 3 = Coach, Ellis, Viper).
 */
function sanitizeLoadout(c) {
  const o = { mode: 'cabinfever', difficulty: 'hard', fireteam: FIRETEAM_IDS.slice() };
  if (c && typeof c === 'object') {
    if (MODES[c.mode]) o.mode = c.mode;
    if (DIFFICULTIES.some((d) => d.id === c.difficulty)) o.difficulty = c.difficulty;
    const team = normalizeFireteam(c.fireteam);
    if (team) o.fireteam = team;
    else if (Number.isInteger(c.teammates)) o.fireteam = LEGACY_LINEUPS[clamp(c.teammates, 0, 3)].slice();
  }
  return o;
}

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
    for (const card of this.$main.mates) {
      const url = this._portraits[card.dataset.mate];
      const img = card.querySelector('img');
      if (!url || !img) continue;
      img.src = url;
      card.classList.add('has-pic');
    }
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
          <span class="cf-mm-mode-k">${m.kicker}</span>
          <span class="cf-mm-mode-n">${m.name}</span>
          <span class="cf-mm-mode-d">${esc(m.tagline)}</span>
        </span>
      </button>`
    ).join('');

    const mapHtml = MAP_LIST.map(
      (m) => `
      <button class="cf-mm-diff cf-mm-map" data-sfx data-map="${m.id}">
        <span class="cf-mm-map-emb">${MAP_EMBLEMS[m.id] || ''}</span>
        <span class="cf-mm-map-txt">
          <span class="cf-mm-diff-s">${esc(m.place)}</span>
          <span class="cf-mm-diff-n">${esc(m.name)}</span>
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

    // fireteam picker: one toggle card per character, portrait filled in by setPortraits()
    const mateHtml = FIRETEAM.map(
      (c, i) => `<button class="cf-mm-mate" data-sfx data-mate="${c.id}" aria-pressed="false" style="--i:${i}">
          <span class="cf-mm-mate-pic"><span class="cf-mm-mate-ph">${HELMET}</span><img alt="" draggable="false"></span>
          <span class="cf-mm-mate-chk" aria-hidden="true"></span>
          <span class="cf-mm-mate-txt">
            <span class="cf-mm-mate-n">${esc(c.name)}</span>
            <span class="cf-mm-mate-w"><i>${weaponSvg(weaponKind(c.gun))}</i>${esc(c.gun)}</span>
          </span>
        </button>`
    ).join('');

    const lbModeHtml = MODE_LIST.map((m) => `<button data-sfx data-lb-mode="${m.id}"><i>${EMBLEMS[m.id] || ''}</i>${m.name}</button>`).join('');
    const lbDiffHtml = DIFFICULTIES.map(
      (d) => `<button data-sfx data-lb-diff="${d.id}"><span class="cf-mm-skulls">${SKULL.repeat(d.skulls)}</span>${d.name}<em data-lb-count></em></button>`
    ).join('');

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
            <button class="cf-mm-profile" data-sfx data-go="career" data-row title="Career"></button>
          </section>

          <section class="cf-mm-view cf-mm-play" data-view="play">
            ${head('OPERATION SETUP', 'PLAY')}
            <div class="cf-mm-setup">
              <div class="cf-mm-steps">
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>01</b>MAP</div>
                  <div class="cf-mm-maps" data-row data-group>${mapHtml}</div>
                </div>
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>02</b>GAME MODE</div>
                  <div class="cf-mm-modes" data-row data-group>${modeHtml}</div>
                </div>
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>03</b>DIFFICULTY</div>
                  <div class="cf-mm-diffs" data-row data-group>${diffHtml}</div>
                </div>
                <div class="cf-mm-step">
                  <div class="cf-mm-step-h"><b>04</b>FIRETEAM</div>
                  <div class="cf-mm-mates" data-row data-group data-multi>${mateHtml}</div>
                  <div class="cf-mm-team-bar">
                    <span class="cf-mm-team-qs" data-row data-group data-multi>
                      <button class="cf-mm-team-q" data-sfx data-team-set="all">ALL</button>
                      <button class="cf-mm-team-q" data-sfx data-team-set="none">SOLO</button>
                    </span>
                  </div>
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

          <section class="cf-mm-view cf-mm-career" data-view="career">
            ${head('CAREER', 'SERVICE RECORD')}
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
            </div>
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

        <div class="cf-mm-dip"></div>
      </div>`);
    this.root.appendChild(el);

    const q = (s) => el.querySelector(s);
    this.$main = {
      root: el,
      views: Object.fromEntries([...el.querySelectorAll('[data-view]')].map((v) => [v.dataset.view, v])),
      maps: [...el.querySelectorAll('[data-map]')],
      modes: [...el.querySelectorAll('[data-mode]')],
      diffs: [...el.querySelectorAll('[data-diff]')],
      mates: [...el.querySelectorAll('[data-mate]')],
      teamSets: [...el.querySelectorAll('[data-team-set]')],
      briefT: q('.cf-mm-brief-t'),
      briefD: q('.cf-mm-brief-d'),
      facts: q('.cf-mm-facts'),
      threats: q('.cf-mm-threats'),
      kitNote: q('.cf-mm-kit-note'),
      profile: q('.cf-mm-profile'),
      car: { rank: q('.cf-car-rank'), ops: q('.cf-car-oprow'), opHint: q('.cf-car-ophint'), list: q('.cf-car-list') },
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
      const mp = t.closest('[data-map]');
      if (mp) return this._setConfig('map', mp.dataset.map);
      const m = t.closest('[data-mode]');
      if (m) return this._setConfig('mode', m.dataset.mode);
      const d = t.closest('[data-diff]');
      if (d) return d.classList.contains('na') ? this._nope(d) : this._setConfig('difficulty', d.dataset.diff);
      const camo = t.closest('[data-camo]');
      if (camo) return this._setCamo(camo);
      const op = t.closest('[data-op]');
      if (op) return this._setOperator(op);
      const mate = t.closest('[data-mate]');
      if (mate) return this._toggleMate(mate.dataset.mate);
      const set = t.closest('[data-team-set]');
      if (set) return this._setConfig('fireteam', set.dataset.teamSet === 'all' ? FIRETEAM_IDS.slice() : []);
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
    const r = Progress.rankOf();
    const pct = r.next ? r.into / r.span : 1;
    P.innerHTML = `<span class="cf-mm-prof-ins">${insigniaSvg(r.index)}</span><span class="cf-mm-prof-t"><small>${esc(this._name())}</small><b>${esc(r.rank.name)}</b><span class="cf-mm-prof-bar"><i style="transform:scaleX(${pct.toFixed(4)})"></i></span><em>${fmtNum(Progress.career().xp)} XP${r.next ? ` · NEXT ${esc(r.next.short)}` : ''}</em></span>`;
  }

  /** the career view: the rank and its ladder, the operator skins, every weapon's mastery and camos */
  _renderCareer() {
    const C = this.$main.car;
    const p = Progress.career();
    const r = Progress.rankOf();
    const pct = r.next ? r.into / r.span : 1;
    const wins = DIFFICULTIES.map((d) => `<span><small>${d.name}</small><b>${p.wins['cabinfever:' + d.id] ?? 0}</b></span>`).join('');
    const ladder = Progress.RANKS.map((k, i) => `<i class="${i < r.index ? 'got' : i === r.index ? 'cur' : ''}" title="${esc(k.name)} · ${fmtNum(k.xp)} XP">${insigniaSvg(i)}</i>`).join('');
    C.rank.innerHTML = `
      <div class="cf-car-me">
        <div class="cf-car-ins">${insigniaSvg(r.index)}</div>
        <div class="cf-car-id">
          <small>${esc(r.rank.short)} · GRADE ${r.index + 1} / ${Progress.RANKS.length}</small>
          <b>${esc(r.rank.name)}</b>
          <div class="cf-car-bar"><i style="transform:scaleX(${pct.toFixed(4)})"></i></div>
          <span class="cf-car-xp"><b>${fmtNum(p.xp)}</b> XP${r.next ? ` · ${fmtNum(r.span - r.into)} TO ${esc(r.next.name.toUpperCase())}` : ' · TOP OF THE LADDER'}</span>
        </div>
      </div>
      <div class="cf-car-stats">
        <span><small>RUNS</small><b>${fmtNum(p.runs)}</b></span>
        <span><small>KILLS</small><b>${fmtNum(p.kills)}</b></span>
        <span><small>HEADSHOTS</small><b>${fmtNum(p.headshots)}</b></span>
        <span><small>GAUNTLETS</small><b>${p.wins['gauntlet:extreme'] ?? 0}</b></span>
      </div>
      <div class="cf-car-wins"><small>CABIN FEVER WINS</small>${wins}</div>
      <div class="cf-car-ladder">${ladder}</div>`;
    // the operators
    const me = Progress.character();
    C.ops.innerHTML = Progress.CHARACTER_SKINS.map((c) => {
      const ok = Progress.characterUnlocked(c.id);
      const pic = this._portraits[c.bot ?? 'player'];
      return `<button class="cf-car-op${c.id === me.id ? ' sel' : ''}${ok ? '' : ' locked'}" data-sfx data-op="${c.id}" title="${esc(ok ? c.name : c.how)}">
          <span class="cf-car-op-pic">${pic ? `<img src="${pic}" alt="" draggable="false">` : HELMET}${ok ? '' : `<span class="cf-car-op-lock">${LOCK}</span>`}</span>
          <b>${esc(c.name)}</b><small>${ok ? (c.id === me.id ? 'ACTIVE' : 'READY') : esc(c.how.toUpperCase())}</small>
        </button>`;
    }).join('');
    this._opHint();
    // weapon mastery, the most used first
    const rows = MASTERY_IDS.map((id) => ({ id, m: Progress.masteryOf(id) })).sort((a, b) => b.m.xp - a.m.xp || MASTERY_IDS.indexOf(a.id) - MASTERY_IDS.indexOf(b.id));
    C.list.innerHTML = rows
      .map(({ id, m }) => {
        const d = WEAPONS[id];
        const cur = Progress.skinOf(id);
        const camos = CAMO_OK(id)
          ? Progress.WEAPON_SKINS.map((k) => {
              const ok = Progress.skinUnlocked(id, k.id);
              const sw = this._swatch(k.id);
              return `<button class="cf-car-camo c-${k.id}${cur === k.id ? ' sel' : ''}${ok ? '' : ' locked'}" data-sfx data-camo="${k.id}" data-wpn="${id}" title="${esc(k.name)}${ok ? '' : ` · mastery level ${k.level}`}"${sw ? ` style="background-image:url(${sw})"` : ''}>${ok ? '' : `<i>${k.level}</i>`}</button>`;
            }).join('')
          : '<small class="cf-car-nocamo">NO CAMOS</small>';
        const pct = m.span ? m.into / m.span : 1;
        return `<div class="cf-car-w${m.xp > 0 ? '' : ' fresh'}">
            <span class="cf-car-w-ico">${weaponSvg(weaponKind(d.name))}</span>
            <span class="cf-car-w-n"><b>${esc(d.name)}</b><small>${m.span ? `${fmtNum(m.into)} / ${fmtNum(m.span)} XP` : 'MASTERED'}</small><span class="cf-car-w-bar"><i style="transform:scaleX(${pct.toFixed(4)})"></i></span></span>
            <span class="cf-car-w-lv" title="Mastery level ${m.level}">${masterySvg(m.level)}</span>
            <span class="cf-car-camos"${CAMO_OK(id) ? ' data-row data-group' : ''}>${camos}</span>
          </div>`;
      })
      .join('');
  }

  _opHint() {
    const me = Progress.character();
    this.$main.car.opHint.textContent = me.bot ? `You are ${FIRETEAM_BY_ID[me.bot]?.name ?? me.name} now: the bot sits out your fireteam.` : 'Your own operator. Scorpion and Viper can be earned.';
  }

  _setCamo(btn) {
    if (btn.classList.contains('locked') || !Progress.setSkin(btn.dataset.wpn, btn.dataset.camo)) return this._nope(btn);
    for (const b of btn.parentElement.children) b.classList.toggle('sel', b === btn);
    this._sfx('ui_click');
  }

  _setOperator(btn) {
    if (btn.classList.contains('locked') || !Progress.setCharacter(btn.dataset.op)) return this._nope(btn);
    const me = Progress.character();
    for (const b of btn.parentElement.children) {
      b.classList.toggle('sel', b === btn);
      const ok = !b.classList.contains('locked');
      if (ok) b.querySelector('small').textContent = b === btn ? 'ACTIVE' : 'READY';
    }
    this._opHint();
    this._syncConfig(); // the fireteam card of the one you now wear
    this._sfx('ui_click');
    return me;
  }

  /* ---------------- fireteam picker ---------------- */

  _toggleMate(id) {
    if (id === Progress.character().bot) return this._nope(this.$main.mates.find((b) => b.dataset.mate === id));
    const on = new Set(this.config.fireteam);
    if (on.has(id)) on.delete(id);
    else on.add(id);
    this._setConfig('fireteam', normalizeFireteam([...on]));
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

  /** keyboard rows of the current view that are actually shown (the leaderboard hides its table or empty state) */
  _rows() {
    const v = this.$main.views[this._view];
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
    if (e.key === 'Escape' || (e.key === 'Backspace' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName))) {
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
    const dId = mode.difficulty ?? c.difficulty; // (the Gauntlet: always Extreme)
    const diff = DIFFICULTIES.find((x) => x.id === dId) || DIFFICULTIES[1];
    if (!MAPS[c.map]) c.map = this.loadedMap.id;
    const map = MAPS[c.map];
    for (const b of M.maps) b.classList.toggle('sel', b.dataset.map === c.map);
    for (const b of M.modes) {
      const tag = b.querySelector('.cf-mm-mode-d');
      if (tag) tag.textContent = map.modeTagline?.[b.dataset.mode] ?? MODES[b.dataset.mode]?.tagline ?? tag.textContent; // (a map without the story)
      b.classList.toggle('sel', b.dataset.mode === c.mode);
    }
    for (const b of M.diffs) {
      b.classList.toggle('sel', b.dataset.diff === dId);
      b.classList.toggle('na', !!mode.difficulty && b.dataset.diff !== mode.difficulty);
      const d = DIFFICULTIES.find((x) => x.id === b.dataset.diff);
      b.querySelector('[data-diff-sub]').textContent = mode.difficulty ? (d.id === mode.difficulty ? 'ALWAYS' : '') : mode.endless ? '' : `${d.rounds} ROUNDS`;
    }
    // fireteam cards (the one whose skin you wear is you: it sits the run out)
    const me = Progress.character();
    const team = (normalizeFireteam(c.fireteam) ?? []).filter((id) => id !== me.bot);
    for (const b of M.mates) {
      const on = team.includes(b.dataset.mate);
      b.classList.toggle('sel', on);
      b.classList.toggle('you', b.dataset.mate === me.bot);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    for (const b of M.teamSets) b.classList.toggle('sel', b.dataset.teamSet === 'all' ? team.length === FIRETEAM.length : !team.length);

    // briefing
    M.briefT.innerHTML = `${mode.name} <em>·</em> ${diff.name}`;
    const desc = map.modeDesc?.[mode.id] ?? mode.desc;
    M.briefD.textContent = mode.rogue ? desc : `${desc} ${mode.endless ? diff.edesc : diff.desc}`;
    const unlocks = unlocksFor(mode.id, diff.id, map);
    const names = team.map((id) => FIRETEAM_BY_ID[id].name.toUpperCase());
    const facts = [
      ['MAP', `${map.name} · ${map.place}${map.id !== this.loadedMap.id ? ' · LOADS ON DEPLOY' : ''}`, 'wide'],
      ['ROUNDS', mode.endless ? '∞' : String(diff.rounds)],
      ['TIME LIMIT', mode.endless || mode.timer === false ? 'NONE' : `${diff.minutes}:00`],
      ...(mode.rogue ? [['GUN SHOP', 'NONE · CARDS AND CURSES INSTEAD', 'wide']] : []),
      [map.id === 'farm' ? 'FLOORS' : 'UNLOCKS', unlocks.length ? unlocks.map((u) => `${u.name} R${u.round}`).join(' · ') : 'GROUND FLOOR ONLY', 'wide'],
      [team.length ? `FIRETEAM · YOU + ${team.length}` : 'FIRETEAM', team.length ? names.join(' · ') : 'SOLO · NO BACKUP', 'wide'],
    ];
    M.facts.innerHTML = facts.map(([k, v, cls]) => `<span class="${cls || ''}"><small>${k}</small><b>${esc(v)}</b></span>`).join('');
    M.kitNote.innerHTML = mode.rogue
      ? 'No gun shop, no cash. After every round <b>draw a card</b>: a weapon, a perk or supplies. Then <b>take a curse</b>.'
      : `Earn cash for every fireteam kill. Between rounds the <b>gun shop</b> ${esc(map.shopWhere)} sells weapons, upgrades and gear.`;
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
