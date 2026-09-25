/*
 * CABIN FEVER — between-round gun store (buy phase). DOM + one small WebGL stage (itemStage.js) for
 * the 3D item thumbnails and the live turntable preview; styles in store.css. All rules and prices
 * live in game/shop.js: this renders the game state and forwards clicks.
 *
 * Layout: header (close · title · wallet); the WEAPONS | EQUIPMENT | GEAR bar over a card grid, and
 * on the right the selected item and one buy / equip / upgrade button.
 *  - WEAPONS: live 3D preview, stat bars, upgrade tracks of the guns you own (akimbo for pistols);
 *    with the weapon backpack worn a primary also picks its slot there.
 *  - EQUIPMENT: the consumables (frags, Molotovs, barricade kits, kevlar, ammo), live preview + meter.
 *  - GEAR: the wearable items of game/gear.js grouped by body slot (head → pocket); on the right the
 *    paperdoll (ui/storeDoll.js) shows what you wear on each slot, and under it the selected item's
 *    effects. Clicking a slot box picks that slot's items; an owned item goes back on for free.
 * Cards are built once per category and patched in place. Gear bits: ui/storeGear.js.
 *
 * Keys: Q / E or 1 / 2 / 3 category · arrows select · Enter buy / equip (closes the shop when the
 * selected item has nothing to buy, unless you just bought something: no accidental close while maxing
 * out frags) · Esc / F close. A focused button (upgrade row, buy, slot box, close) takes Enter natively.
 */
import './store.css';
import * as THREE from 'three';
import { esc, weaponSvg, fmtCash } from './hud.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { buildBarricadeKit } from '../player/barricadeKit.js';
import { buildProp } from '../world/propsSafe.js';
import { gasMask, kevlarVest } from '../world/gearModels.js';
import { ItemStage } from './itemStage.js';
import { GEAR_POSES, gearModelBuilder, GEAR_ICON_PATHS, gearDetailHtml, gearSlotTag, gearAltsHtml, packPickerHtml, slotIcon } from './storeGear.js';
import { Paperdoll } from './storeDoll.js';
import { PACK_SLOT, SLOT_LABEL, ONE_PER_SLOT, GEAR_SLOTS } from '../game/gear.js';
import {
  MAX_LEVEL,
  shopWeapons,
  shopEquipment,
  weaponState,
  equipmentState,
  upgradesFor,
  upgradeCost,
  previewDef,
  buyWeapon,
  buyUpgrade,
  buyEquipment,
  buyAkimbo,
  akimboState,
  itemSection,
  hasPack,
  primaryTarget,
} from '../game/shop.js';

/* ------------------------------------------------------------------ 3D models */

// guns: right side to camera, muzzle to the right, a little from the front and above
const GUN_POSE = { rot: [0, -Math.PI / 2, 0], az: 0.38, el: 0.2, fill: 0.95 };
const PISTOL_POSE = { ...GUN_POSE, fill: 0.8 };
const PAIR_POSE = { ...GUN_POSE, fill: 0.88 };

/** Akimbo preview: two of the pistol, crossed (grips low at the sides, muzzles up and out). */
function pistolPair(id) {
  const g = new THREE.Group();
  for (let i = 0; i < 2; i++) {
    const m = buildWeaponModel(id).root;
    m.rotation.set(i ? -0.5 : 0.5, i ? Math.PI : 0, 0);
    m.position.set(i ? -0.02 : 0.02, 0, i ? -0.085 : 0.085);
    g.add(m);
  }
  return g;
}

// stage key of an item (thumbnail / live preview): a pistol's crossed pair once its akimbo is owned
const stageKey = (item) => item.sk ?? item.k;
// gear: `roll` tilts tall items in the picture plane so they use the wide frame; matte gear takes
// less image light (`env`) so fabric and paint keep their color
const GEAR_POSE = {
  frag: { rot: [0, -Math.PI / 2, 0], az: 0.5, el: 0.28, fill: 0.74, env: 0.45 },
  molotov: { rot: [0, -Math.PI / 2, 0], roll: -0.95, az: 0.45, el: 0.2, fill: 0.86, env: 0.6 },
  armor: { rot: [0, 0, 0], az: -0.5, el: 0.16, fill: 0.8, env: 0.4 },
  ammo: { rot: [0, 0, 0], az: 0.62, el: 0.42, fill: 0.84, env: 0.5 },
  gasmask: { rot: [0, 0, 0], az: 0.5, el: 0.12, fill: 0.78, env: 0.6 },
  barricade: { rot: [0, -Math.PI / 2, 0], az: 0.5, el: 0.5, fill: 0.9, env: 0.55 },
  ...GEAR_POSES, // wearable gear (ui/storeGear.js)
};

function gearBuilder(it) {
  switch (it.key) {
    case 'frag':
      return () => buildWeaponModel('m67').root;
    case 'molotov':
      return () => buildWeaponModel('molotov').root;
    case 'armor':
      return kevlarVest;
    case 'gasmask':
      return gasMask;
    case 'ammo':
      return () => buildProp('ammoCrate', { seed: 5 }).object;
    case 'barricade':
      return () => {
        // a product shot, not the in-hand pose: planks lying flat, the hammer resting across them
        const kit = buildBarricadeKit();
        const { hammer, bundle } = kit.parts || {};
        if (hammer && bundle) {
          bundle.position.set(0, 0, 0);
          bundle.rotation.set(0, 0, 0);
          hammer.position.set(0.03, 0.115, 0.06);
          hammer.rotation.set(-1.2, 0.55, 0);
        }
        return kit.root;
      };
  }
  const gear = gearModelBuilder(it.key); // wearable gear (ui/storeGear.js)
  if (gear) return gear;
  const def = it.requires && WEAPONS[it.requires];
  return def ? () => buildWeaponModel(def.model || it.requires).root : null;
}

/* ------------------------------------------------------------------ fallback icons (no WebGL) */

// extra silhouettes in the 128x40 weapon-icon box (see hud.js WPN_PATHS)
const ITEM_PATHS = {
  launcher:
    'M4 13L28 15L28 25L10 28L4 28ZM28 12L58 12L58 26L50 26L47 36L39 35L42 26L28 26Z' +
    'M58 8L118 8Q124 8 124 14L124 22Q124 28 118 28L58 28ZM80 28L88 28L86 36L80 36ZM66 4L74 4L74 8L66 8Z' +
    'M64 15L112 15L112 17.5L64 17.5ZM64 20L112 20L112 22.5L64 22.5Z',
  molotov:
    'M38 9L80 9Q86 9 90 15L96 16.5L108 16.5L108 23.5L96 23.5L90 25Q86 31 80 31L38 31Q34 31 34 27L34 13Q34 9 38 9Z' +
    'M46 14L70 14L70 26L46 26ZM108 15L116 11L114 16L124 14L118 20L125 25L114 24L116 29L108 25Z',
  armor: 'M50 3L57 3Q64 9 71 3L78 3L80 10L87 13L87 37L41 37L41 13L48 10Z' + 'M47 18L81 18L81 21L47 21ZM47 25L81 25L81 28L47 28Z',
  ammo:
    'M34 13L94 13L94 37L34 37ZM31 9L97 9L97 14L31 14ZM56 3L72 3L72 9L68 9L68 6L60 6L60 9L56 9Z' +
    'M44 19L50 19L50 31L44 31ZM54 19L60 19L60 31L54 31ZM64 19L70 19L70 31L64 31ZM74 19L80 19L80 31L74 31Z',
  gasmask:
    'M44 5Q64 -3 84 5Q92 13 88 24Q85 30 76 32L52 32Q43 30 40 24Q36 13 44 5Z' +
    'M48 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0ZM66 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0Z' +
    'M57 33h14v6h-14ZM34 11L39 10L39 17L34 18ZM94 11L89 10L89 17L94 18Z',
  barricade:
    'M30 7L88 5L88 12L30 14ZM33 9h2.5v2.5h-2.5ZM83 7.5h2.5v2.5h-2.5Z' +
    'M28 17L90 18L90 25L28 24ZM31 19.5h2.5v2.5h-2.5ZM85 20h2.5v2.5h-2.5Z' +
    'M31 28L87 26L87 33L31 35ZM34 30h2.5v2.5h-2.5ZM82 28.5h2.5v2.5h-2.5Z' +
    'M97.2 37.1L100.8 38.9L113.8 14.9L110.2 13.1ZM123.5 11.1L120.3 17.3L103.6 8.4L106.8 2.2Z',
  ...GEAR_ICON_PATHS,
};
const ICON_FALLBACK = { lmg: 'rifle' };

function itemSvg(kind) {
  const p = ITEM_PATHS[kind];
  if (!p) return weaponSvg(ICON_FALLBACK[kind] || kind);
  return `<svg viewBox="0 0 128 40" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${p}"/></svg>`;
}

const svgBody = (svg) => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
const CAT_ICON = {
  weapons: `<svg viewBox="4 3 120 34" aria-hidden="true">${svgBody(weaponSvg('rifle'))}</svg>`,
  equipment: `<svg viewBox="46 3 32 36" aria-hidden="true">${svgBody(weaponSvg('grenade'))}</svg>`, // the frag
  gear: slotIcon('head', ''), // the helmet
};
const LOCK_SVG =
  '<svg viewBox="0 0 12 14" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M3 6V4a3 3 0 0 1 6 0v2h1.2c.4 0 .8.4.8.8v6.4c0 .4-.4.8-.8.8H1.8c-.4 0-.8-.4-.8-.8V6.8c0-.4.4-.8.8-.8ZM4.6 6h2.8V4a1.4 1.4 0 0 0-2.8 0Z"/></svg>';
const UP_SVG = '<svg viewBox="0 0 10 10" aria-hidden="true"><path fill="currentColor" d="M5 1L9.5 6H6.6V9H3.4V6H.5Z"/></svg>';

/* ------------------------------------------------------------------ stats */

const CATS = ['weapons', 'equipment', 'gear'];
const CAT_LABEL = { weapons: 'WEAPONS', equipment: 'EQUIPMENT', gear: 'GEAR' };
const CAT_KEY = { w: 'weapons', e: 'equipment', g: 'gear' }; // item key prefix -> category
const money = (n) => `$${fmtCash(n)}`;
const c01 = (v) => Math.max(0.04, Math.min(1, v));

// DAMAGE / FIRE RATE / MAGAZINE / HANDLING (0..1); each is raised by one upgrade track
const STATS = [
  ['DAMAGE', 'dmg'],
  ['FIRE RATE', 'rate'],
  ['MAGAZINE', 'mag'],
  ['HANDLING', 'reload'],
];
function statVals(d) {
  const per = (d.damage || 0) * (d.pellets || 1);
  let rpm = d.rpm || 60;
  if ((d.mode === 'bolt' || d.mode === 'pump') && d.boltTime) rpm = Math.min(rpm, 60 / d.boltTime);
  if (d.mode === 'burst' && d.burst) rpm = (d.burst * 60) / ((d.burst * 60) / rpm + (d.burstDelay || 0));
  if (d.rampRpm) rpm = (rpm + d.rampRpm) / 2;
  const reloadT = d.reloadType === 'shell' ? (d.reloadStart || 0) + (d.shellTime || 0) * 4 + (d.reloadEnd || 0) : d.reload ?? 2.5;
  const mv = ((d.moveMul ?? 1) - 0.8) / 0.28;
  const ads = (0.27 - (d.adsTime ?? 0.2)) / 0.15;
  const rl = (4.6 - reloadT) / 3.4;
  return [
    d.projectile ? c01(0.55 + per / 1000) : c01(Math.sqrt(per) / 18),
    c01(Math.sqrt(rpm / 1000)),
    d.noReload ? 1 : c01(Math.log(Math.max(1, d.mag || 1)) / Math.log(120)),
    c01(0.45 * mv + 0.3 * ads + 0.25 * rl),
  ];
}

const UPG_VAL = {
  dmg: (d) => (d.pellets > 1 ? `${Math.round(d.damage)}×${d.pellets}` : `${Math.round(d.damage)}`),
  mag: (d) => `${d.mag}`,
  reload: (d) => `${(d.reloadType === 'shell' ? d.shellTime : d.reload ?? 0).toFixed(2)}s`,
  rate: (d) => `${Math.round(d.rpm)}`,
};

const pips = (n, max) => `<span class="cf-st-pips">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(Math.max(0, max - n))}</span>`;
const pct = (v) => `${(Math.max(0, v) * 100).toFixed(1)}%`;

function upgTotal(w, id) {
  const lv = w.upgrades?.[id];
  return lv ? Object.values(lv).reduce((s, v) => s + (v | 0), 0) : 0;
}

/* ================================================================== Store */

export class Store {
  constructor(host, cb = {}) {
    this.cb = cb;
    this.game = null;
    this.isOpen = false;
    this.tab = 'weapons';
    this.sel = { weapons: null, equipment: null, gear: null };
    this.slotFocus = null; // GEAR: the body slot picked on the paperdoll (its group stands out in the list)
    this._round = null;
    this._cash = null;
    // the live preview idles while the paperdoll stands in its place
    this.stage = new ItemStage({ isPaused: () => !!this.game?.paused || this.tab === 'gear' });
    this.doll = new Paperdoll();

    const root = (this.root = document.createElement('div'));
    root.className = 'cf-menu cf-store';
    root.innerHTML = `
      <div class="cf-st-bg"><div class="cf-st-dim"></div><div class="cf-bg-noise"></div><div class="cf-st-vig"></div></div>
      <div class="cf-st-wrap">
        <header class="cf-st-head">
          <button class="cf-st-close" data-sfx data-act="close"><i></i><span>CLOSE</span><span class="cf-kc">ESC</span></button>
          <h2 class="cf-st-title">GUN SHOP</h2>
          <div class="cf-st-wallet">
            <span class="cf-st-spent"></span>
            <b><span class="cf-st-dollar">$</span><span class="cf-st-cash">0</span></b>
            <div class="cf-st-toast"></div>
          </div>
        </header>
        <div class="cf-st-body">
          <section class="cf-st-main">
            <nav class="cf-st-cats" role="tablist">
              <span class="cf-kc cf-st-cat-k">Q</span>
              ${CATS.map((c, i) => `<button class="cf-st-cat" role="tab" data-sfx data-cat="${c}" title="${CAT_LABEL[c]} (${i + 1})">${CAT_ICON[c]}<span>${CAT_LABEL[c]}</span></button>`).join('')}
              <span class="cf-kc cf-st-cat-k">E</span>
              <span class="cf-st-cats-note">${ONE_PER_SLOT ? 'KEPT ALL MATCH · ONE WORN PER BODY SLOT' : 'KEPT ALL MATCH'}</span>
            </nav>
            <div class="cf-st-list"></div>
          </section>
          <aside class="cf-panel cf-st-detail">
            <div class="cf-st-stage"><div class="cf-st-stage-fb"></div><div class="cf-st-stage-flash"></div></div>
            <div class="cf-st-info"></div>
            <div class="cf-st-act"></div>
          </aside>
        </div>
      </div>`;
    (host || document.body).appendChild(root);

    const q = (s) => root.querySelector(s);
    this.$ = {
      wallet: q('.cf-st-wallet'),
      cash: q('.cf-st-cash'),
      spent: q('.cf-st-spent'),
      toast: q('.cf-st-toast'),
      cats: [...root.querySelectorAll('.cf-st-cat')],
      list: q('.cf-st-list'),
      detail: q('.cf-st-detail'),
      stage: q('.cf-st-stage'),
      fb: q('.cf-st-stage-fb'),
      flash: q('.cf-st-stage-flash'),
      info: q('.cf-st-info'),
      act: q('.cf-st-act'),
      close: q('.cf-st-close'),
    };
    this.$.stage.after(this.doll.el); // GEAR: the paperdoll in the preview's place

    root.addEventListener('click', (e) => this._onClick(e));
    let last = null;
    root.addEventListener('mouseover', (e) => {
      const t = e.target.closest?.('[data-sfx]');
      if (t && t !== last && !t.disabled) this._sfx('ui_hover', 0.5);
      last = t;
      // hovering an upgrade previews its gain on the matching stat bar
      const u = e.target.closest?.('.cf-st-upg');
      this.$.detail.dataset.hl = u && !u.disabled ? u.dataset.key : '';
    });
    this.$.detail.addEventListener('mouseleave', () => (this.$.detail.dataset.hl = ''));
    // the preview's purchase flash ends for good (the stage is hidden on GEAR: showing it again would replay it)
    this.$.detail.addEventListener('animationend', (e) => {
      if (e.animationName === 'cf-st-stage-flash') this.$.detail.classList.remove('flash');
    });
    this.$.detail.addEventListener('focusin', (e) => {
      const u = e.target.closest?.('.cf-st-upg');
      this.$.detail.dataset.hl = u && !u.disabled ? u.dataset.key : '';
    });
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  /* ------------------------------------------------------------ API */

  open(game) {
    this.game = game;
    this.isOpen = true;
    // a new buy phase starts on the equipped primary (its upgrades are right there)
    if (this._round !== game.round) {
      this._round = game.round;
      this.tab = 'weapons';
      this.sel.weapons = null;
      this.pick = {}; // backpack slot picks (_packTarget)
    }
    this._cash = null;
    this.slotFocus = null;
    this.doll.reset();
    this.$.toast.className = 'cf-st-toast';
    this.root.classList.add('on');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    if (this.stage.ok) {
      this.stage.attach(this.$.stage);
      this.stage.start();
    }
    if (this.tab === 'gear') this.doll.ensureFigure();
    this._buildList();
    this._select(this._validSel(), true);
    this.render();
    this._bakeAll(); // anything the idle warmup hasn't baked yet (cards show their icon until then)
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('on');
    this.stage.stop(); // also frees the preview models' GPU memory
  }

  /** Bake the item thumbnails in idle time (called once after boot) so the first visit is instant. */
  warmup() {
    if (this._warm) return;
    this._warm = true;
    this._bakeAll(1500);
    // the GEAR paperdoll's figure: rendered once, in idle time too
    setTimeout(() => {
      const go = () => this.doll.ensureFigure();
      if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 4000 });
      else go();
    }, 5000);
  }

  /** One baking loop at a time: the open category first, one item after another, never blocking. */
  async _bakeAll(delay = 0) {
    if (this._baking || !this.stage.ok) return;
    this._baking = true;
    try {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      for (let tries = 0; tries < 64 && this.stage.ok; tries++) {
        const pool = this.isOpen ? [...this._items(this.tab), ...this._allItems()] : this._allItems();
        const item = pool.find((i) => !this.stage.hasThumb(stageKey(i)));
        if (!item) break;
        const m = this._model(item);
        const url = m ? await this.stage.bake(stageKey(item), m.build, m.pose) : null;
        if (!m) this.stage.thumbs.set(stageKey(item), null);
        if (url === undefined) await new Promise((r) => setTimeout(r, 500)); // interrupted: again shortly
        else this._onThumb(item.k);
      }
    } finally {
      this._baking = false;
    }
  }

  _onThumb(k) {
    if (!this.isOpen) return;
    const el = this.$.list.querySelector(`.cf-st-card[data-k="${k}"]`);
    if (el) this._patchCard(el);
    if (this.tab === 'gear') this._renderDoll(); // a worn item's picture on its slot box
    else if (k === this.sel[this.tab] && this.$.stage.classList.contains('wait')) this._placeholder(this._item(k));
  }

  /** Full refresh of the state-dependent bits (wallet, cards, detail). */
  render() {
    const g = this.game;
    if (!g) return;
    const cash = g.economy.cash(g.player);
    if (this._cash == null) this._showCash(cash);
    else if (cash !== this._cash) this._tickCash(cash);
    this.root.dataset.cat = this.tab; // store.css: panel width, preview vs paperdoll
    for (const b of this.$.cats) {
      const on = b.dataset.cat === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    }
    for (const el of this.$.list.querySelectorAll('.cf-st-card')) this._patchCard(el);
    // GEAR: the slot picked on the paperdoll stands out, the other groups step back
    for (const el of this.$.list.querySelectorAll('.cf-st-grp')) {
      el.classList.toggle('focus', el.dataset.slot === this.slotFocus);
      el.classList.toggle('dim', !!this.slotFocus && el.dataset.slot !== this.slotFocus);
    }
    this._renderDetail();
  }

  /* ------------------------------------------------------------ items */

  _allItems() {
    return CATS.flatMap((c) => this._items(c));
  }

  /** A category's items in list order: weapons; the consumables; the gear by body slot (head → pocket). */
  _items(cat) {
    if (cat === 'weapons') {
      const ak = this.game?.weapons.akimbo;
      return shopWeapons().map((e) => ({ k: `w:${e.id}`, sk: ak?.has(e.id) ? `w:${e.id}:x2` : `w:${e.id}`, kind: 'weapon', e }));
    }
    const sec = cat === 'gear' ? 'gear' : 'consumable';
    const list = shopEquipment().filter((it) => itemSection(it) === sec);
    if (sec === 'gear') list.sort((a, b) => GEAR_SLOTS.indexOf(a.slot) - GEAR_SLOTS.indexOf(b.slot)); // stable: store order within a slot
    return list.map((it) => ({ k: `${cat[0]}:${it.key}`, kind: 'gear', it }));
  }

  _item(k) {
    if (!k) return null;
    return this._items(CAT_KEY[k[0]] || 'equipment').find((i) => i.k === k) || null;
  }

  _model(item) {
    if (item.kind === 'weapon') {
      const def = WEAPONS[item.e.id];
      if (stageKey(item) !== item.k) return { build: () => pistolPair(def.model || item.e.id), pose: PAIR_POSE };
      return { build: () => buildWeaponModel(def.model || item.e.id).root, pose: item.e.slot === 1 ? PISTOL_POSE : GUN_POSE };
    }
    const build = gearBuilder(item.it);
    return build ? { build, pose: GEAR_POSE[item.it.key] || { az: 0.5, el: 0.2, fill: 0.8 } } : null;
  }

  /** Which baked thumbnail an item shows ('' = none yet): the single pistol stands in while its pair bakes. */
  _thumbKey(item) {
    if (!this.stage.ok) return '';
    const sk = stageKey(item);
    return this.stage.thumb(sk) ? sk : this.stage.thumb(item.k) ? item.k : '';
  }

  _pic(item) {
    const tk = this._thumbKey(item);
    return tk ? `<img src="${this.stage.thumb(tk)}" alt="" draggable="false">` : this._icon(item);
  }

  _icon(item) {
    return itemSvg(item.kind === 'weapon' ? item.e.icon : item.it.icon);
  }

  /** Buy-button action for an item: null when there's nothing to do (equipped / maxed / full). */
  _state(item) {
    const g = this.game;
    if (item.kind === 'weapon') {
      const e = item.e;
      const s = weaponState(g, e);
      // weapon backpack worn: a primary goes into the picked slot (primary or backpack)
      const target = this._packTarget(e);
      const w = g.weapons;
      let act = null;
      let done = s.where === PACK_SLOT ? 'IN BACKPACK' : s.equipped ? 'EQUIPPED' : '';
      if (!s.owned) act = { label: 'BUY', cost: e.price };
      else if (target != null && s.where !== target) {
        // moving it from slot 1 into an empty backpack would leave slot 1 empty
        if (s.where === 0 && !w.slots[target]) done = 'EQUIPPED';
        else act = { label: s.equipped ? 'SWAP' : 'EQUIP', cost: 0 };
      } else if (!s.equipped) act = { label: 'EQUIP', cost: 0 };
      return { ...s, act, done, target, upg: s.owned ? upgTotal(w, e.id) : 0, x2: !!w.akimbo?.has(e.id) };
    }
    const it = item.it;
    const s = equipmentState(g, it);
    let act = null;
    let done = '';
    let chip = '';
    if (it.owned) {
      // gear: buy -> worn; owned but taken off -> EQUIP (free, on its body slot); worn -> its upgrade
      const u = it.upgrade;
      if (!s.owned) act = { label: 'BUY', cost: s.cost };
      else if (s.equip) act = { label: 'EQUIP', cost: 0, slot: it.slot };
      else if (!s.maxed) act = { label: `UPGRADE ${u.name}`, cost: s.cost };
      else done = u ? 'MAXED' : 'WORN';
      if (s.owned && u) chip = `${u.value(s.level)}`;
    } else {
      if (!s.maxed) act = { label: 'BUY', cost: it.price };
      else done = it.unit || it.max ? 'MAX' : 'FULL';
      if (it.unit) chip = `${s.count} ${it.unit}`;
      else if (s.max) chip = `${s.count}/${s.max}`;
    }
    return { ...s, act, done, chip, afford: !act || !act.cost || g.economy.canAfford(g.player, act.cost) };
  }

  /* ------------------------------------------------------------ list */

  _validSel() {
    const list = this._items(this.tab);
    let k = this.sel[this.tab];
    if (!list.some((i) => i.k === k)) {
      k = null;
      if (this.tab === 'weapons') {
        const cur = this.game?.weapons.slots[0];
        if (list.some((i) => i.k === `w:${cur}`)) k = `w:${cur}`;
      }
      k ??= list[0]?.k ?? null;
    }
    return k;
  }

  _buildList() {
    const items = this._items(this.tab);
    let i = 0;
    const card = (it) => {
      const name = it.kind === 'weapon' ? WEAPONS[it.e.id].name : it.it.short ?? it.it.name;
      // gear: its body slot as an icon (+ WORN while it's on)
      const sl = it.kind === 'gear' && it.it.slot;
      const slot = sl ? `<span class="cf-st-slotb" title="${SLOT_LABEL[sl]}" aria-label="${SLOT_LABEL[sl]} SLOT">${slotIcon(sl)}<b>WORN</b></span>` : '';
      return `<button class="cf-st-card" data-sfx data-k="${it.k}" data-tk="${this._thumbKey(it)}" style="--i:${i++}">
        <span class="cf-st-card-pic">${this._pic(it)}</span>
        <span class="cf-st-chip"></span><span class="cf-st-x2" title="AKIMBO">×2</span>${slot}
        <span class="cf-st-card-foot"><span class="cf-st-card-name${it.kind === 'gear' && name.length > 12 ? ' long' : ''}">${esc(name)}</span><span class="cf-st-card-tag"></span></span>
      </button>`;
    };
    let html;
    if (this.tab === 'weapons') {
      const sec = (slot, label) => {
        const list = items.filter((it) => it.e.slot === slot);
        return list.length ? `<div class="cf-st-sec"><div class="cf-st-sec-h">${label}</div><div class="cf-st-grid">${list.map(card).join('')}</div></div>` : '';
      };
      html = sec(0, 'PRIMARY') + sec(1, 'SECONDARY');
    } else if (this.tab === 'gear') {
      // one group per body slot (head → pocket), each under its slot icon; the groups flow three cards wide
      html = GEAR_SLOTS.map((sl) => {
        const list = items.filter((it) => it.it.slot === sl);
        if (!list.length) return '';
        return `<div class="cf-st-grp" data-slot="${sl}" style="--n:${Math.min(3, list.length)}">
          <div class="cf-st-sec-h cf-st-grp-h">${slotIcon(sl)}${SLOT_LABEL[sl]}</div><div class="cf-st-grid">${list.map(card).join('')}</div></div>`;
      }).join('');
      html = `<div class="cf-st-groups">${html}</div>`;
    } else {
      html = `<div class="cf-st-sec"><div class="cf-st-sec-h">CONSUMABLES</div><div class="cf-st-grid">${items.map(card).join('')}</div></div>`;
    }
    const L = this.$.list;
    L.dataset.cat = this.tab;
    L.innerHTML = html;
    L.scrollTop = 0;
    L.classList.remove('in');
    void L.offsetWidth;
    L.classList.add('in');
  }

  _patchCard(el) {
    const item = this._item(el.dataset.k);
    if (!item) return;
    const s = this._state(item);
    const sel = el.dataset.k === this.sel[this.tab];
    el.classList.toggle('sel', sel);
    el.setAttribute('aria-pressed', sel);
    const on = item.kind === 'weapon' ? s.equipped : s.worn; // gear: worn on its body slot
    el.classList.toggle('owned', item.kind === 'weapon' ? s.owned && !s.equipped : !!(item.it.owned && s.owned && !s.worn));
    el.classList.toggle('equipped', !!on);
    el.classList.toggle('maxed', !s.act && item.kind === 'gear');
    el.classList.toggle('poor', !!s.act && !s.afford);
    const tag = el.querySelector('.cf-st-card-tag');
    let t;
    if (s.act?.cost) t = `<span class="cf-st-price">${s.act.label.startsWith('UPGRADE') ? UP_SVG : ''}${money(s.act.cost)}</span>`;
    else if (s.equipped) t = `<span class="cf-st-tag on">${s.where === PACK_SLOT ? 'BACKPACK' : 'EQUIPPED'}</span>`;
    else if (item.kind === 'weapon' || s.equip) t = '<span class="cf-st-tag">OWNED</span>'; // gear: owned, not worn
    else if (s.done === 'WORN') t = ''; // gear: its slot badge says WORN
    else t = `<span class="cf-st-tag on">${s.done || 'OWNED'}</span>`;
    if (tag.innerHTML !== t) tag.innerHTML = t;
    const chip = el.querySelector('.cf-st-chip');
    const c = item.kind === 'weapon' ? (s.upg ? `${UP_SVG}${s.upg}` : '') : esc(s.chip || '');
    if (chip.innerHTML !== c) chip.innerHTML = c;
    chip.classList.toggle('on', !!c);
    chip.classList.toggle('up', item.kind === 'weapon');
    el.classList.toggle('x2', !!s.x2); // akimbo badge
    // a thumbnail that finished baking after the grid was built (or the akimbo pair's, once bought)
    const tk = this._thumbKey(item);
    if (tk && el.dataset.tk !== tk) {
      el.dataset.tk = tk;
      const pic = el.querySelector('.cf-st-card-pic');
      pic.innerHTML = this._pic(item);
      pic.classList.add('baked');
    }
  }

  _placeholder(item) {
    this.$.fb.innerHTML = item ? this._pic(item) : '';
  }

  /** Live 3D preview once the model is prepared; its thumbnail (or icon) stands in until then. */
  _preview(item, k) {
    const m = this._model(item);
    const $s = this.$.stage;
    const live = this.stage.ok && !!m;
    const sk = stageKey(item);
    const ready = live && this.stage.isReady(sk);
    $s.classList.toggle('fb', !live);
    $s.classList.toggle('wait', live && !ready);
    if (!ready) this._placeholder(item);
    if (live) {
      this.stage.show(sk, m.build, m.pose).then((ok) => {
        if (!this.isOpen || this.sel[this.tab] !== k || this.stage.want !== sk) return; // superseded
        $s.classList.remove('wait');
        $s.classList.toggle('fb', !ok);
      });
    }
  }

  _select(k, silent) {
    if (!k) return;
    const prev = this.sel[this.tab];
    this.sel[this.tab] = k;
    const item = this._item(k);
    if (!item) return;
    // GEAR: picking an item of another slot lets go of the slot picked on the paperdoll
    if (this.slotFocus && item.it?.slot !== this.slotFocus) this.slotFocus = null;
    if (this.tab !== 'gear') this._preview(item, k);
    if (!silent && prev !== k) this._sfx('ui_click', 0.45);
    if (!silent) this.render();
  }

  /* ------------------------------------------------------------ detail panel */

  _renderDetail() {
    const item = this._item(this.sel[this.tab]);
    const $ = this.$;
    if (this.tab === 'gear') this._renderDoll();
    if (!item) {
      $.info.innerHTML = '';
      $.act.innerHTML = '';
      return;
    }
    const s = this._state(item);
    $.info.innerHTML = item.kind === 'weapon' ? this._weaponInfo(item, s) : this._gearInfo(item, s);
    // the buy button: amber when actionable, red price when broke, muted when there's nothing to buy
    const a = s.act;
    const focused = document.activeElement?.classList?.contains('cf-st-buy');
    // above the button: the backpack's primary-slot picker, which worn gear this one would replace, or
    // (worn gear) the other items you own for its slot
    let pre = '';
    const it = item.it;
    if (item.kind === 'weapon' && s.target != null) pre = packPickerHtml(this.game.weapons, item.e.id, s.target);
    else if (it?.slot && s.replaces && !s.worn) pre = `<div class="cf-st-act-hint">REPLACES <b>${esc(s.replaces)}</b> ON YOUR ${esc(s.slotLabel)} · YOU KEEP IT</div>`;
    else if (it?.slot && s.worn) pre = gearAltsHtml(it.slot, this._alts(it));
    const done = it?.slot && s.worn ? (it.upgrade ? 'WORN · MAXED' : 'WORN') : s.done;
    $.act.innerHTML =
      pre +
      (a
        ? `<button class="cf-st-buy${s.afford ? '' : ' poor'}" data-sfx data-act="buy">
          <span class="cf-st-buy-l">${a.label}</span>${a.slot ? `<span class="cf-st-buy-s">${slotIcon(a.slot)}${SLOT_LABEL[a.slot]}</span>` : ''}${a.cost ? `<span class="cf-st-buy-c">${money(a.cost)}</span>` : ''}<span class="cf-kc">ENTER</span>
        </button>`
        : `<button class="cf-st-buy off" disabled><span class="cf-st-buy-l">${done}</span><svg class="cf-st-tick" viewBox="0 0 12 10" aria-hidden="true"><path d="M1 5.2L4.3 8.5L11 1.5" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>`);
    if (focused) $.act.querySelector('.cf-st-buy:not(:disabled)')?.focus();
    // one-shot feedback on the freshly rendered controls: denied shake / bought flash
    const fx = this._fx;
    this._fx = null;
    if (fx) {
      const el = fx.key ? $.info.querySelector(`.cf-st-upg[data-key="${fx.key}"]`) : $.act.querySelector('.cf-st-buy');
      el?.classList.add(fx.ok ? 'flash' : 'nope');
    }
  }

  _head(name, type, tag) {
    return `<div class="cf-st-d-head"><div class="cf-st-d-t"><h3>${esc(name)}</h3><small>${esc(type)}</small></div>${tag}</div>`;
  }

  _weaponInfo(item, s) {
    const g = this.game;
    const w = g.weapons;
    const e = item.e;
    const base = WEAPONS[e.id];
    const eff = w.defOf(e.id) || base;
    const lv = w.upgrades?.[e.id] || {};
    const ups = upgradesFor(base);
    const b0 = statVals(base);
    // akimbo: two guns' worth of fire rate and rounds on the bars (x2: the preview while it's for sale)
    const ak = akimboState(g, e);
    const pair = (d) => ({ ...d, rpm: d.rpm * 2, mag: d.mag * 2 });
    const dual = (d) => (ak.owned ? pair(d) : d);
    const cur = statVals(dual(eff));
    const x2 = ak.avail && !ak.owned ? statVals(pair(eff)) : null;
    const next = {};
    for (const u of ups) {
      const l = w.upgradeLevel(e.id, u.key);
      if (l < MAX_LEVEL) next[u.key] = statVals(dual(previewDef(base, { ...lv, [u.key]: l + 1 })));
    }
    const tag = s.equipped ? '<span class="cf-st-tag on">EQUIPPED</span>' : s.owned ? '<span class="cf-st-tag">OWNED</span>' : '';
    const held = WEAPONS[w.slots[s.target ?? e.slot]]; // the backpack picker's slot, if any
    const warn = s.target == null && !s.equipped && e.slot === 0 && held?.special ? `<div class="cf-st-warn">REPLACES YOUR ${esc(held.name)}</div>` : ''; // (backpack: the picker says it)
    const bars = STATS.map(([label, key], i) => {
      const ghost = next[key] ? next[key][i] - cur[i] : 0;
      return `<div class="cf-st-bar" data-u="${key}"><em>${label}</em><i><b style="width:${pct(b0[i])}"></b>${
        cur[i] - b0[i] > 0.004 ? `<u style="width:${pct(cur[i] - b0[i])}"></u>` : ''
      }${ghost > 0.004 ? `<s style="width:${pct(ghost)}"></s>` : ''}${
        x2 && x2[i] - cur[i] > 0.004 ? `<s class="x2" style="width:${pct(x2[i] - cur[i])}"></s>` : ''
      }</i></div>`;
    }).join('');
    const rows = ups
      .map((u) => {
        const l = w.upgradeLevel(e.id, u.key);
        const val = UPG_VAL[u.key];
        if (!s.owned) {
          return `<button class="cf-st-upg lock" data-key="${u.key}" disabled><span class="cf-st-upg-n">${u.name}</span>${pips(0, MAX_LEVEL)}<span class="cf-st-upg-v">${val(base)}</span><span class="cf-st-upg-p">${LOCK_SVG}</span></button>`;
        }
        const max = l >= MAX_LEVEL;
        const cost = max ? 0 : upgradeCost(e, u.key, l);
        const poor = !max && !g.economy.canAfford(g.player, cost);
        const nd = max ? null : previewDef(base, { ...lv, [u.key]: l + 1 });
        return `<button class="cf-st-upg${max ? ' max' : ''}${poor ? ' poor' : ''}" data-sfx data-act="upgrade" data-id="${e.id}" data-key="${u.key}"${max ? ' disabled' : ''}>
          <span class="cf-st-upg-n">${u.name}</span>${pips(l, MAX_LEVEL)}
          <span class="cf-st-upg-v">${val(eff)}${nd ? `<i>›</i><b>${val(nd)}</b>` : ''}</span>
          <span class="cf-st-upg-p">${max ? 'MAX' : money(cost)}</span>
        </button>`;
      })
      .join('');
    // the premium one: a second gun for the left hand (owned pistols only)
    const akRow = ak.avail
      ? `<button class="cf-st-upg cf-st-ak${ak.owned ? ' max' : ''}${ak.afford ? '' : ' poor'}" data-sfx data-act="akimbo" data-id="${e.id}" data-key="akimbo"${ak.owned ? ' disabled' : ''}>
          <span class="cf-st-upg-n">AKIMBO</span><span class="cf-st-ak-x">×2</span>
          <span class="cf-st-upg-v">${ak.owned ? '' : `${eff.mag}<i>›</i>`}<b>2×${eff.mag}</b></span>
          <span class="cf-st-upg-p">${ak.owned ? 'OWNED' : money(ak.cost)}</span>
        </button><div class="cf-st-ak-hint">${ak.owned ? 'MOUSE1 RIGHT GUN · MOUSE2 LEFT GUN' : 'DUAL WIELD · MOUSE2 FIRES THE LEFT GUN · NO ADS'}</div>`
      : '';
    return (
      this._head(base.name, e.type, tag) +
      warn +
      `<div class="cf-st-bars">${bars}</div>` +
      (rows ? `<div class="cf-st-upgs${s.owned ? '' : ' locked'}"><div class="cf-st-sub">UPGRADES</div>${rows}${akRow}</div>` : '')
    );
  }

  /** The other gear you own for a slot (not worn now), for the one-click swaps under a worn item. */
  _alts(it) {
    const gear = this.game.gear;
    return this._items('gear')
      .filter((i) => i.it.slot === it.slot && i.it.key !== it.key && gear?.owns(i.it.key) && !gear.has(i.it.key))
      .map((i) => ({ key: i.it.key, name: i.it.short ?? i.it.name }));
  }

  /** GEAR: fill the paperdoll's slot boxes (what's worn where) and light up the selected item's slot. */
  _renderDoll() {
    const gear = this.game?.gear;
    const items = this._items('gear');
    const slots = {};
    const none = [];
    for (const sl of GEAR_SLOTS) {
      const list = items.filter((i) => i.it.slot === sl);
      if (!list.length) none.push(sl);
      const w = list.find((i) => gear?.has(i.it.key));
      slots[sl] = w
        ? { key: w.it.key, name: w.it.short ?? w.it.name, pic: this._pic(w), tk: this._thumbKey(w), alt: list.filter((i) => i !== w && gear.owns(i.it.key)).length }
        : null;
    }
    const sel = this._item(this.sel.gear);
    this.doll.update(slots, { hl: sel?.it.slot ?? null, focus: this.slotFocus, none });
  }

  _gearInfo(item, s) {
    const it = item.it;
    let meter;
    if (it.owned) {
      const u = it.upgrade;
      const max = u ? u.costs.length : 0;
      meter = u
        ? `<div class="cf-st-meter"><em>${u.name}</em>${s.owned ? pips(s.level, max) : ''}<span class="cf-st-meter-v"><b>${u.value(s.owned ? s.level : 0)}</b>${
            s.owned && !s.maxed ? `<i>›</i><b class="nx">${u.value(s.level + 1)}</b>` : ''
          }</span></div>`
        : '';
    } else if (it.unit) {
      const nx = Math.min(it.max, s.count + 50);
      meter = `<div class="cf-st-meter"><em>ARMOR</em><i class="cf-st-meter-bar"><b style="width:${pct(s.count / it.max)}"></b>${
        s.maxed ? '' : `<s style="width:${pct((nx - s.count) / it.max)}"></s>`
      }</i><span class="cf-st-meter-v"><b>${s.count}</b>${s.maxed ? '' : `<i>›</i><b class="nx">${nx}</b>`}<small>${esc(it.unit)}</small></span></div>`;
    } else if (s.max) {
      // the grenadier vest's extra carry shows as its own note
      const bonus = s.max > it.max ? `<div class="cf-st-meter-note">+${s.max - it.max} FROM YOUR GRENADIER VEST</div>` : '';
      meter = `<div class="cf-st-meter"><em>CARRYING</em>${pips(Math.min(s.count, s.max), s.max)}<span class="cf-st-meter-v"><b>${s.count}</b><small>/ ${s.max}</small></span></div>${bonus}`;
    } else {
      meter = `<div class="cf-st-meter"><em>RESERVES</em><span class="cf-st-meter-v"><b${s.maxed ? '' : ' class="nx"'}>${s.maxed ? 'FULL' : 'REFILL'}</b></span></div>`;
    }
    if (it.slot) return this._head(it.name, it.type, gearSlotTag(it, s)) + gearDetailHtml(it) + meter; // GEAR (under the paperdoll)
    return this._head(it.name, it.type, '') + meter; // a consumable
  }

  /* ------------------------------------------------------------ wallet */

  _showCash(v) {
    this._cash = v;
    cancelAnimationFrame(this._cashRaf);
    this._cashShown = v;
    this.$.cash.textContent = fmtCash(v);
  }

  _tickCash(v) {
    const from = this._cashShown ?? v;
    this._cash = v;
    const t0 = performance.now();
    const dur = 520;
    cancelAnimationFrame(this._cashRaf);
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      this._cashShown = Math.round(from + (v - from) * e);
      this.$.cash.textContent = fmtCash(this._cashShown);
      if (k < 1) this._cashRaf = requestAnimationFrame(step);
    };
    this._cashRaf = requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------ input */

  _sfx(name, volume = 0.6) {
    try {
      this.game?.audio.play(name, { volume });
    } catch (_) {}
  }

  _setTab(tab) {
    if (!CATS.includes(tab) || tab === this.tab) return;
    this.tab = tab;
    this.slotFocus = null;
    this._sfx('ui_click', 0.5);
    if (tab === 'gear') this.doll.ensureFigure();
    this._buildList();
    this._select(this._validSel(), true);
    this.render();
  }

  /**
   * GEAR: a slot box on the paperdoll was clicked. Its group stands out in the list and the item worn
   * there (else the slot's first) is selected, so its details and the other items you own for that slot
   * show; clicking it again lets go. Nothing in stock for that slot: a shake and a note.
   */
  _onSlot(slot) {
    const list = this._items('gear').filter((i) => i.it.slot === slot);
    if (!list.length) {
      this.doll.nope(slot);
      this._feedback({ ok: false, msg: `NO ${SLOT_LABEL[slot] ?? ''} GEAR IN STOCK` });
      return;
    }
    if (this.slotFocus === slot) {
      this.slotFocus = null;
      this._sfx('ui_click', 0.4);
      this.render();
      return;
    }
    this.slotFocus = slot;
    const cur = this._item(this.sel.gear);
    const pick = cur?.it.slot === slot ? cur : list.find((i) => this.game.gear?.has(i.it.key)) || list[0];
    this._select(pick.k, true);
    this._sfx('ui_click', 0.45);
    this.render();
    const grp = this.$.list.querySelector(`.cf-st-grp[data-slot="${slot}"]`);
    grp?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  _close() {
    if (!this.isOpen) return;
    this._sfx('ui_click', 0.7);
    this.cb.onClose?.();
  }

  _buy() {
    const item = this._item(this.sel[this.tab]);
    if (!item) return null;
    return item.kind === 'weapon' ? buyWeapon(this.game, item.e.id, this._packTarget(item.e)) : buyEquipment(this.game, item.it.key);
  }

  /**
   * Weapon backpack worn and a primary selected: the slot it goes into (0 primary / PACK_SLOT
   * backpack), as picked in the detail panel (default shop.js primaryTarget). null otherwise.
   */
  _packTarget(e) {
    if (!this.game || e.slot !== 0 || !hasPack(this.game)) return null;
    return this.pick?.[e.id] ?? primaryTarget(this.game, e.id);
  }

  _onClick(e) {
    if (!this.isOpen || !this.game) return;
    // the tab buttons only: the item list also carries data-cat (for styling), so a bare [data-cat]
    // match swallowed every card click as a no-op tab switch
    const cat = e.target.closest('.cf-st-cat');
    if (cat) return this._setTab(cat.dataset.cat);
    const card = e.target.closest('.cf-st-card');
    if (card) return this._select(card.dataset.k);
    const slot = e.target.closest('.cf-st-ds'); // a paperdoll slot box
    if (slot) {
      if (e.detail) slot.blur(); // clicked: Enter keeps buying the selection (keyboard focus keeps it)
      return this._onSlot(slot.dataset.slot);
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'close') return this._close();
    if (act === 'pslot') {
      // backpack primary picker: which slot the selected gun goes into
      const item = this._item(this.sel[this.tab]);
      if (item?.kind !== 'weapon') return;
      (this.pick ??= {})[item.e.id] = Number(b.dataset.slot);
      this._sfx('ui_click', 0.5);
      this.render();
      return;
    }
    let res;
    if (act === 'buy') res = this._buy();
    else if (act === 'upgrade') res = buyUpgrade(this.game, b.dataset.id, b.dataset.key);
    else if (act === 'akimbo') res = buyAkimbo(this.game, b.dataset.id);
    else if (act === 'wear') {
      // an owned alternative put on from under the worn item: it becomes the selection
      res = buyEquipment(this.game, b.dataset.key);
      if (res.ok) this.sel.gear = `g:${b.dataset.key}`;
    }
    if (!res) return;
    this._feedback(res, act === 'upgrade' || act === 'akimbo' ? b.dataset.key : null);
    this.render();
    if (act === 'akimbo' && res.ok) {
      this._select(this.sel[this.tab], true); // the preview becomes the pair
      this._bakeAll(); // and so does the card's thumbnail
    }
    // keyboard activation keeps focus on the same control across the re-render
    if (e.detail === 0) {
      const sel = act === 'upgrade' ? `.cf-st-upg[data-key="${b.dataset.key}"]:not(:disabled)` : '.cf-st-buy:not(:disabled)';
      this.root.querySelector(sel)?.focus();
    }
  }

  _feedback(res, upgKey) {
    const t = this.$.toast;
    if (res.ok) {
      this._buyT = performance.now();
      this._sfx(res.sound || 'weapon_switch', 0.75);
      if (res.cost) this._sfx('ui_click', 0.6);
    } else {
      this._sfx(res.sound || 'ui_hover', 0.6);
    }
    t.textContent = res.msg;
    t.className = 'cf-st-toast';
    void t.offsetWidth; // restart the animation
    t.classList.add('show', res.ok ? 'ok' : 'bad');
    const wl = this.$.wallet;
    wl.classList.remove('spent', 'denied');
    void wl.offsetWidth;
    if (res.cost) {
      wl.classList.add('spent');
      this.$.spent.textContent = `-${money(res.cost)}`;
    } else if (!res.ok && res.sound === 'dryfire') wl.classList.add('denied');
    if (res.ok) {
      // purchase flash on the card and the preview (GEAR: on the item's slot box)
      const card = this.$.list.querySelector(`.cf-st-card[data-k="${this.sel[this.tab]}"]`);
      const gear = this.tab === 'gear';
      for (const el of [card, gear ? null : this.$.detail]) {
        if (!el) continue;
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
      }
      if (gear) {
        const sl = this._item(this.sel.gear)?.it.slot;
        if (sl) this.doll.flash(sl);
      } else this.stage.pop();
      if (upgKey) this._fx = { ok: true, key: upgKey };
    } else if (res.sound === 'dryfire') {
      this._fx = { ok: false, key: upgKey };
    }
  }

  _move(dir) {
    const cards = [...this.$.list.querySelectorAll('.cf-st-card')];
    if (!cards.length) return;
    let i = cards.findIndex((c) => c.dataset.k === this.sel[this.tab]);
    if (i < 0) i = 0;
    let j = i;
    const n = cards.length;
    if (dir === 'left') j = (i - 1 + n) % n;
    else if (dir === 'right') j = (i + 1) % n;
    else {
      // nearest card in the next row up / down, then the closest column in that row
      const r0 = cards[i].getBoundingClientRect();
      const x0 = r0.left + r0.width / 2;
      const y0 = r0.top + r0.height / 2;
      let bestDy = Infinity;
      let bestDx = Infinity;
      cards.forEach((c, k) => {
        const r = c.getBoundingClientRect();
        const dy = dir === 'down' ? r.top + r.height / 2 - y0 : y0 - (r.top + r.height / 2);
        if (dy < 4) return;
        const dx = Math.abs(r.left + r.width / 2 - x0);
        if (dy < bestDy - 4 || (Math.abs(dy - bestDy) <= 4 && dx < bestDx)) {
          j = k;
          bestDy = dy;
          bestDx = dx;
        }
      });
    }
    if (j === i) return;
    this._select(cards[j].dataset.k);
    cards[j].scrollIntoView({ block: 'nearest' });
  }

  _onKey(e) {
    if (!this.isOpen || this.game?.paused) return;
    const k = e.code;
    const a = document.activeElement;
    const inStore = a && a !== document.body && this.root.contains(a);
    const arrows = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (arrows[k]) {
      e.preventDefault();
      // inside the detail panel up / down walk its buttons (upgrade rows, buy)
      if (inStore && this.$.detail.contains(a) && (k === 'ArrowUp' || k === 'ArrowDown')) {
        const btns = [...this.$.detail.querySelectorAll('button:not(:disabled)')];
        const i = btns.indexOf(a);
        btns[Math.max(0, Math.min(btns.length - 1, i + (k === 'ArrowUp' ? -1 : 1)))]?.focus();
        return;
      }
      if (inStore) a.blur();
      this._move(arrows[k]);
      return;
    }
    if (e.repeat) return;
    if (k === 'Enter' || k === 'NumpadEnter' || k === 'Space') {
      // a focused control (upgrade row, buy, close, tab) takes it natively
      if (inStore && a.tagName === 'BUTTON' && !a.classList.contains('cf-st-card')) return;
      e.preventDefault();
      const item = this._item(this.sel[this.tab]);
      const buying = item && this._state(item).act;
      // nothing to buy: Enter closes, unless it's the tail of a buying spree (frags to max...)
      const spree = performance.now() - (this._buyT || 0) < 1500;
      if (buying || (item && (spree || k === 'Space'))) {
        const res = this._buy();
        if (res) {
          this._feedback(res);
          this.render();
        }
      } else if (k !== 'Space') this._close();
    } else if (k === 'KeyF' || k === 'Escape') {
      e.preventDefault();
      this._close();
    } else if (/^(Digit|Numpad)[1-9]$/.test(k)) {
      this._setTab(CATS[Number(k.slice(-1)) - 1]); // 1 / 2 / 3: WEAPONS / EQUIPMENT / GEAR
    } else if (k === 'KeyQ' || k === 'KeyE') {
      const i = CATS.indexOf(this.tab) + (k === 'KeyQ' ? -1 : 1);
      this._setTab(CATS[(i + CATS.length) % CATS.length]);
    }
  }
}

export default Store;
