/*
 * CABIN FEVER — between-round gun store (buy phase). Pure DOM, styles in store.css.
 * All rules/prices live in game/shop.js; this only renders the game state and forwards
 * clicks. Re-renders on open and after every purchase.
 * Keys: 1-3 tabs · Esc / F / Enter close (ready-up happens in the world: hold F).
 */
import './store.css';
import { esc, weaponSvg, rankSvg, fmtCash } from './hud.js';
import { WEAPONS } from '../player/weaponDefs.js';
import {
  MAX_LEVEL,
  shopWeapons,
  shopEquipment,
  ownedWeapons,
  weaponState,
  equipmentState,
  upgradesFor,
  upgradeCost,
  previewDef,
  buyWeapon,
  buyUpgrade,
  buyEquipment,
  maskCapacity,
} from '../game/shop.js';
import { BOT_DMG } from '../game/economy.js';

// Extra silhouettes in the 128x40 weapon-icon box (see hud.js WPN_PATHS).
const ITEM_PATHS = {
  launcher:
    'M4 13L28 15L28 25L10 28L4 28ZM28 12L58 12L58 26L50 26L47 36L39 35L42 26L28 26Z' +
    'M58 8L118 8Q124 8 124 14L124 22Q124 28 118 28L58 28ZM80 28L88 28L86 36L80 36ZM66 4L74 4L74 8L66 8Z' +
    'M64 15L112 15L112 17.5L64 17.5ZM64 20L112 20L112 22.5L64 22.5Z',
  molotov:
    'M38 9L80 9Q86 9 90 15L96 16.5L108 16.5L108 23.5L96 23.5L90 25Q86 31 80 31L38 31Q34 31 34 27L34 13Q34 9 38 9Z' +
    'M46 14L70 14L70 26L46 26ZM108 15L116 11L114 16L124 14L118 20L125 25L114 24L116 29L108 25Z',
  armor:
    'M50 3L57 3Q64 9 71 3L78 3L80 10L87 13L87 37L41 37L41 13L48 10Z' + 'M47 18L81 18L81 21L47 21ZM47 25L81 25L81 28L47 28Z',
  ammo:
    'M34 13L94 13L94 37L34 37ZM31 9L97 9L97 14L31 14ZM56 3L72 3L72 9L68 9L68 6L60 6L60 9L56 9Z' +
    'M44 19L50 19L50 31L44 31ZM54 19L60 19L60 31L54 31ZM64 19L70 19L70 31L64 31ZM74 19L80 19L80 31L74 31Z',
  gasmask:
    'M44 5Q64 -3 84 5Q92 13 88 24Q85 30 76 32L52 32Q43 30 40 24Q36 13 44 5Z' +
    'M48 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0ZM66 13a7 7 0 1 0 14 0a7 7 0 1 0-14 0Z' +
    'M57 33h14v6h-14ZM34 11L39 10L39 17L34 18ZM94 11L89 10L89 17L94 18Z',
};
const ICON_FALLBACK = { lmg: 'rifle' };
// tight viewBoxes for the small loadout kit icons
const KIT_VB = { grenade: '46 3 32 36', molotov: '32 6 94 28', armor: '39 1 50 38', gasmask: '32 -4 64 44' };

function itemSvg(kind, cls = '') {
  const p = ITEM_PATHS[kind];
  if (!p) return weaponSvg(ICON_FALLBACK[kind] || kind, cls);
  return `<svg class="${cls}" viewBox="0 0 128 40" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${p}"/></svg>`;
}

function kitSvg(kind) {
  return itemSvg(kind).replace('viewBox="0 0 128 40"', `viewBox="${KIT_VB[kind]}"`);
}

const TABS = [
  ['weapons', 'WEAPONS'],
  ['upgrades', 'UPGRADES'],
  ['equipment', 'EQUIPMENT'],
];
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const pad2 = (n) => String(Math.max(0, n | 0)).padStart(2, '0');
const money = (n) => `$${fmtCash(n)}`;

// 0..1 lobby-style stat bars from a def (upgraded defs show their gain on top)
const c01 = (v) => Math.max(0.04, Math.min(1, v));
function statVals(d) {
  const per = (d.damage || 0) * (d.pellets || 1);
  let rpm = d.rpm || 60;
  if ((d.mode === 'bolt' || d.mode === 'pump') && d.boltTime) rpm = Math.min(rpm, 60 / d.boltTime);
  const f1 = d.falloff?.[1] ?? (d.projectile ? 70 : 80);
  return [
    ['DMG', d.projectile ? c01(0.55 + per / 900) : c01(Math.sqrt(per) / 14)],
    ['RATE', c01(rpm / 900)],
    ['RANGE', c01((f1 / 100) * (1 - Math.min(0.85, (d.spreadHip ?? 2) / 8)))],
    ['MOBILITY', c01(((d.moveMul ?? 1) - 0.7) / 0.4)],
  ];
}
function statBars(base, eff) {
  const a = statVals(base);
  const b = statVals(eff);
  return `<span class="cf-stats">${a
    .map(([k, v], i) => {
      const up = Math.max(0, b[i][1] - v);
      return `<span class="cf-stat-row"><em>${k}</em><i><b style="width:${(v * 100).toFixed(1)}%"></b>${
        up > 0.004 ? `<u style="width:${(up * 100).toFixed(1)}%"></u>` : ''
      }</i></span>`;
    })
    .join('')}</span>`;
}

const UPG_VAL = {
  dmg: (d) => (d.pellets > 1 ? `${Math.round(d.damage)}×${d.pellets}` : `${Math.round(d.damage)}`),
  mag: (d) => `${d.mag}`,
  reload: (d) => `${(d.reloadType === 'shell' ? d.shellTime : d.reload ?? 0).toFixed(2)}s`,
  rate: (d) => `${Math.round(d.rpm)}`,
};
const UPG_UNIT = { dmg: '', mag: ' RDS', reload: '', rate: ' RPM' };

const pips = (n, max) => `<span class="cf-st-pips">${'<i class="on"></i>'.repeat(n)}${'<i></i>'.repeat(Math.max(0, max - n))}</span>`;

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

    const root = (this.root = document.createElement('div'));
    root.className = 'cf-menu cf-store';
    root.innerHTML = `
      <div class="cf-st-dim"></div>
      <div class="cf-st-wrap">
        <header class="cf-st-head">
          <div class="cf-st-titles">
            <div class="cf-st-kicker"></div>
            <h2 class="cf-st-title"></h2>
            <div class="cf-st-sum"></div>
          </div>
          <div class="cf-st-wallet">
            <small>YOUR WALLET</small>
            <b><span class="cf-st-dollar">$</span><span class="cf-st-cash">0</span></b>
            <div class="cf-st-toast"></div>
          </div>
        </header>
        <div class="cf-st-body">
          <section class="cf-panel cf-st-main">
            <div class="cf-tabs cf-st-tabs">${TABS.map(
              ([k, l], i) => `<button class="cf-tab" data-sfx data-tab="${k}"><span class="cf-kc">${i + 1}</span>${l}</button>`
            ).join('')}</div>
            <div class="cf-st-list"></div>
          </section>
          <aside class="cf-st-side">
            <section class="cf-panel cf-st-loadout">
              <div class="cf-panel-head"><span>LOADOUT</span><em>YOU</em></div>
              <div class="cf-st-slots"></div>
            </section>
            <section class="cf-panel cf-st-team">
              <div class="cf-panel-head"><span>FIRETEAM</span><em>WALLETS</em></div>
              <div class="cf-st-mates"></div>
            </section>
            <div class="cf-st-go">
              <button class="cf-st-ready" data-sfx data-act="close"><span>CLOSE</span><i class="cf-kc">ESC</i></button>
              <div class="cf-st-hint"></div>
            </div>
          </aside>
        </div>
      </div>`;
    (host || document.body).appendChild(root);

    const q = (s) => root.querySelector(s);
    this.$ = {
      kicker: q('.cf-st-kicker'),
      title: q('.cf-st-title'),
      sum: q('.cf-st-sum'),
      wallet: q('.cf-st-wallet'),
      cash: q('.cf-st-cash'),
      toast: q('.cf-st-toast'),
      tabs: [...root.querySelectorAll('[data-tab]')],
      list: q('.cf-st-list'),
      slots: q('.cf-st-slots'),
      mates: q('.cf-st-mates'),
      ready: q('.cf-st-ready'),
      hint: q('.cf-st-hint'),
    };

    root.addEventListener('click', (e) => this._onClick(e));
    let last = null;
    root.addEventListener('mouseover', (e) => {
      const t = e.target.closest?.('[data-sfx]');
      if (t && t !== last && !t.disabled) this._sfx('ui_hover', 0.5);
      last = t;
    });
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  /* ------------------------------------------------------------ API */

  open(game) {
    this.game = game;
    this.isOpen = true;
    this.$.toast.className = 'cf-st-toast';
    this.$.list.scrollTop = 0;
    this.root.classList.add('on');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    this.render();
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('on');
  }

  render() {
    const g = this.game;
    if (!g) return;
    const me = g.economy.wallet(g.player) || { cash: 0, round: { kills: 0, bonus: 0, count: 0 } };
    const $ = this.$;
    $.kicker.textContent = `${g.endless ? 'ENDLESS' : 'FIRETEAM'} - ${g.diff?.label ?? ''}  ·  BUY PHASE`;
    $.title.innerHTML = `ROUND <em>${pad2(g.round)}</em> CLEARED`;
    const next = g.round + 1;
    const intel = [...(g.shopNews || [])];
    if (next === 5) intel.push('STRIKERS JOIN THE HORDE');
    if (next === 11) intel.push('CRUSHERS INCOMING');
    if (next === g.maxRounds) intel.push('FINAL WAVE');
    $.sum.innerHTML =
      `<span><small>KILLS · ${me.round.count}</small><b>+${money(me.round.kills)}</b></span>` +
      `<span><small>CLEAR BONUS</small><b>+${money(me.round.bonus)}</b></span>` +
      `<span><small>NEXT</small><b class="nx">ROUND ${pad2(next)}<i>/${g.endless ? '∞' : pad2(g.maxRounds)}</i></b></span>` +
      (intel.length ? `<span class="intel"><small>INTEL</small><b>${esc(intel.join(' · '))}</b></span>` : '');
    $.cash.textContent = fmtCash(me.cash);
    for (const t of $.tabs) t.classList.toggle('on', t.dataset.tab === this.tab);
    $.list.innerHTML = this.tab === 'upgrades' ? this._upgradesHtml() : this.tab === 'equipment' ? this._equipmentHtml() : this._weaponsHtml();
    $.slots.innerHTML = this._loadoutHtml();
    $.mates.innerHTML = this._teamHtml();
    $.hint.innerHTML = `Close the shop, then hold <b>[F]</b> when ready for round <b>${pad2(next)}</b>`;
  }

  /* ------------------------------------------------------------ tabs */

  _weaponsHtml() {
    const sec = (slot, label, note) => {
      const list = shopWeapons(slot);
      if (!list.length) return '';
      return `<div class="cf-st-sec"><div class="cf-label">${label} <small>${note}</small></div><div class="cf-st-grid">${list
        .map((e) => this._weaponCard(e))
        .join('')}</div></div>`;
    };
    const cur = WEAPONS[this.game.weapons.slots[0]];
    const special = cur?.special ? `REPLACES YOUR ${esc(cur.name)}` : 'SLOT 1';
    return sec(0, 'PRIMARY', special) + sec(1, 'SECONDARY', 'SLOT 2 · REPLACES THE M9');
  }

  _weaponCard(e) {
    const g = this.game;
    const base = WEAPONS[e.id];
    const eff = g.weapons.defOf(e.id);
    const s = weaponState(g, e);
    const n = upgTotal(g.weapons, e.id);
    const cls = `cf-opt cf-st-card${s.equipped ? ' sel' : ''}${s.owned ? ' owned' : ''}${s.afford ? '' : ' poor'}`;
    const foot = s.equipped
      ? '<span class="cf-st-tag on">EQUIPPED</span>'
      : s.owned
        ? '<span class="cf-st-tag">OWNED · EQUIP</span>'
        : `<span class="cf-st-price">${money(e.price)}</span>`;
    return `<button class="${cls}" data-sfx data-act="weapon" data-id="${e.id}">
      <span class="cf-opt-wpnimg">${itemSvg(e.icon)}</span>
      <span class="cf-opt-name">${esc(base.name)}</span>
      <span class="cf-opt-sub">${esc(e.type)}</span>
      ${statBars(base, eff)}
      <span class="cf-st-foot">${n ? `<span class="cf-st-lv">UPG ${n}</span>` : '<span></span>'}${foot}</span>
    </button>`;
  }

  _upgradesHtml() {
    const g = this.game;
    const w = g.weapons;
    const list = ownedWeapons(g);
    if (!list.length) return '<div class="cf-st-empty">Buy a weapon to unlock upgrades.</div>';
    return list
      .map((e) => {
        const base = WEAPONS[e.id];
        const eff = w.defOf(e.id);
        const lvls = w.upgrades?.[e.id] || {};
        const s = weaponState(g, e);
        const rows = upgradesFor(base)
          .map((u) => {
            const lv = w.upgradeLevel(e.id, u.key);
            const max = lv >= MAX_LEVEL;
            const cost = max ? 0 : upgradeCost(e, u.key, lv);
            const poor = !max && !g.economy.canAfford(g.player, cost);
            const nextDef = max ? null : previewDef(base, { ...lvls, [u.key]: lv + 1 });
            const val = UPG_VAL[u.key];
            return `<button class="cf-st-upg${max ? ' max' : ''}${poor ? ' poor' : ''}" data-sfx data-act="upgrade" data-id="${e.id}" data-key="${u.key}"${
              max ? ' disabled' : ''
            }>
              <span class="cf-st-upg-top"><span class="cf-st-upg-name">${u.name}</span>${pips(lv, MAX_LEVEL)}</span>
              <span class="cf-st-upg-val">${val(eff)}${nextDef ? `<i>→</i><b>${val(nextDef)}</b>` : ''}<small>${UPG_UNIT[u.key]}</small></span>
              <span class="cf-st-upg-cost">${max ? '<span class="cf-st-tag on">MAX</span>' : `<span class="cf-st-price">${money(cost)}</span>`}</span>
            </button>`;
          })
          .join('');
        return `<div class="cf-st-upgw${s.equipped ? ' on' : ''}">
          <div class="cf-st-upgw-head">
            <span class="cf-st-upgw-ico">${itemSvg(e.icon)}</span>
            <span class="cf-st-upgw-name">${esc(base.name)}<small>${esc(e.type)}</small></span>
            ${s.equipped ? '<span class="cf-st-tag on">EQUIPPED</span>' : '<span class="cf-st-tag">OWNED</span>'}
          </div>
          <div class="cf-st-upg-grid">${rows}</div>
        </div>`;
      })
      .join('');
  }

  _equipmentHtml() {
    const g = this.game;
    const cards = shopEquipment()
      .map((it) => {
        const s = equipmentState(g, it);
        const cls = `cf-opt cf-st-card cf-st-eq${s.maxed ? ' maxed' : ''}${s.afford || s.maxed ? '' : ' poor'}`;
        let count = '';
        if (it.owned) {
          const u = it.upgrade;
          const max = u ? u.costs.length : 0;
          count = !s.owned
            ? `<span class="cf-st-count">${u ? `<b>${u.value(0)}</b> ${u.name}` : ''}</span>`
            : `<span class="cf-st-count">${pips(s.level, max)}<b>${u.value(s.level)}</b>${s.maxed ? '' : ` <i>→</i> <b>${u.value(s.level + 1)}</b>`}</span>`;
          const foot = s.maxed
            ? '<span class="cf-st-tag on">MAX</span>'
            : `${s.owned ? `<span class="cf-st-lv">${u.name} ${'I'.repeat(s.level + 1)}</span>` : '<span></span>'}<span class="cf-st-price">${money(s.cost)}</span>`;
          return `<button class="${cls}${s.owned ? ' owned' : ''}" data-sfx data-act="equip" data-key="${it.key}">
          <span class="cf-opt-wpnimg">${itemSvg(it.icon)}</span>
          <span class="cf-opt-name">${esc(it.name)}</span>
          <span class="cf-opt-sub">${esc(s.owned ? `OWNED · ${u.name} UPGRADES` : it.type)}</span>
          ${count}
          <span class="cf-st-foot">${s.maxed ? '<span></span>' : ''}${foot}</span>
        </button>`;
        }
        if (it.unit === 'AP') count = `<span class="cf-st-count"><b>${s.count}</b> AP${s.maxed ? '' : ` <i>→</i> <b>${Math.min(it.max, s.count + 50)}</b>`}</span>`;
        else if (it.max) count = `<span class="cf-st-count">${pips(Math.min(s.count, it.max), it.max)}<b>${s.count}</b>/${it.max}</span>`;
        else count = `<span class="cf-st-count">${s.maxed ? 'RESERVES FULL' : 'TOP UP ALL RESERVES'}</span>`;
        const foot = s.maxed ? `<span class="cf-st-tag on">${it.unit || it.max ? 'MAX' : 'FULL'}</span>` : `<span class="cf-st-price">${money(it.price)}</span>`;
        return `<button class="${cls}" data-sfx data-act="equip" data-key="${it.key}">
          <span class="cf-opt-wpnimg">${itemSvg(it.icon)}</span>
          <span class="cf-opt-name">${esc(it.name)}</span>
          <span class="cf-opt-sub">${esc(it.type)}</span>
          ${count}
          <span class="cf-st-foot"><span></span>${foot}</span>
        </button>`;
      })
      .join('');
    return `<div class="cf-st-sec"><div class="cf-label">EQUIPMENT <small>CARRIED INTO THE NEXT ROUND</small></div><div class="cf-st-grid">${cards}</div></div>`;
  }

  /* ------------------------------------------------------------ side */

  _loadoutHtml() {
    const g = this.game;
    const w = g.weapons;
    const slot = (n, id, label) => {
      const d = w.defOf(id);
      if (!d) return '';
      const a = w.ammo[id];
      const e = shopWeapons().find((x) => x.id === id);
      const lv = w.upgrades?.[id] || {};
      const tags = upgradesFor(WEAPONS[id])
        .filter((u) => lv[u.key])
        .map((u) => `${u.short} ${ROMAN[lv[u.key]]}`)
        .join(' · ');
      return `<div class="cf-st-slot"><em>${n}</em><span class="cf-st-slot-ico">${itemSvg(e?.icon || 'rifle')}</span>
        <span class="cf-st-slot-nm">${esc(d.name)}<small>${label}${tags ? ` · ${tags}` : ''}</small></span>
        <span class="cf-st-slot-am">${a ? `${a.mag}<i>/${a.reserve}</i>` : ''}</span></div>`;
    };
    const molo = WEAPONS.molotov ? `<span class="molo">${kitSvg('molotov')}<b>×${w.molotovs ?? 0}</b></span>` : '';
    const mask = g.gear?.mask;
    const maskHtml = mask?.owned ? `<span class="mask">${kitSvg('gasmask')}<b>${maskCapacity(mask.level)}</b><small>S</small></span>` : '';
    return (
      slot(1, w.slots[0], 'PRIMARY') +
      slot(2, w.slots[1], 'SECONDARY') +
      `<div class="cf-st-slot cf-st-slot-kit"><em>4</em><span class="cf-st-kit"><span>${kitSvg('grenade')}<b>×${w.grenades}</b></span>${molo}<span>${kitSvg(
        'armor'
      )}<b>${Math.ceil(g.player.ap)}</b><small>AP</small></span>${maskHtml}</span></div>`
    );
  }

  _teamHtml() {
    const g = this.game;
    const bought = new Map((g.botBuys || []).map((b) => [b.bot, b.level]));
    return g.team
      .map((m) => {
        const w = g.economy.wallet(m);
        if (!w) return '';
        const me = m.isPlayer;
        const up = bought.get(m);
        return `<div class="cf-st-mate${me ? ' me' : ''}">
          <span class="cf-st-mate-rk">${rankSvg(me ? 3 : m.rank)}</span>
          <span class="cf-st-mate-nm">${esc(me ? 'You' : m.name)}${
            me ? '' : `<small>RIFLE DMG ${pips(w.dmgLv, BOT_DMG.costs.length)}${up ? `<b class="cf-st-new">▲ ${ROMAN[up]}</b>` : ''}</small>`
          }</span>
          <span class="cf-st-mate-cash">${money(w.cash)}</span>
        </div>`;
      })
      .join('');
  }

  /* ------------------------------------------------------------ input */

  _sfx(name, volume = 0.6) {
    try {
      this.game?.audio.play(name, { volume });
    } catch (_) {}
  }

  _setTab(tab) {
    if (tab === this.tab) return;
    this.tab = tab;
    this._sfx('ui_click', 0.5);
    this.render();
    this.$.list.scrollTop = 0;
  }

  _close() {
    if (!this.isOpen) return;
    this._sfx('ui_click', 0.7);
    this.cb.onClose?.();
  }

  _onClick(e) {
    if (!this.isOpen || !this.game) return;
    const tab = e.target.closest('[data-tab]');
    if (tab) return this._setTab(tab.dataset.tab);
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    if (act === 'close') return this._close();
    let res;
    if (act === 'weapon') res = buyWeapon(this.game, b.dataset.id);
    else if (act === 'upgrade') res = buyUpgrade(this.game, b.dataset.id, b.dataset.key);
    else if (act === 'equip') res = buyEquipment(this.game, b.dataset.key);
    if (!res) return;
    this._feedback(res);
    this.render();
    // keyboard activation keeps focus on the same control across the re-render
    if (e.detail === 0) {
      let sel = `[data-act="${act}"]`;
      if (b.dataset.id) sel += `[data-id="${b.dataset.id}"]`;
      if (b.dataset.key) sel += `[data-key="${b.dataset.key}"]`;
      this.root.querySelector(sel)?.focus();
    }
  }

  _feedback(res) {
    const t = this.$.toast;
    if (res.ok) {
      this._sfx(res.sound || 'weapon_switch', 0.75);
      if (res.cost) this._sfx('ui_click', 0.6);
    } else {
      this._sfx(res.sound || 'ui_hover', 0.6);
    }
    t.innerHTML = res.cost ? `<b>-${money(res.cost)}</b>${esc(res.msg)}` : esc(res.msg);
    t.className = 'cf-st-toast';
    void t.offsetWidth; // restart the animation
    t.classList.add('show', res.ok ? 'ok' : 'bad');
    const wl = this.$.wallet;
    wl.classList.remove('spent', 'denied');
    void wl.offsetWidth;
    if (res.cost) wl.classList.add('spent');
    else if (!res.ok && res.sound === 'dryfire') wl.classList.add('denied');
  }

  _onKey(e) {
    if (!this.isOpen || this.game?.paused || e.repeat) return;
    const k = e.code;
    if (k === 'Enter' || k === 'NumpadEnter') {
      // Enter on a focused item activates it natively; otherwise it closes the shop
      const a = document.activeElement;
      if (a && a !== this.$.ready && a.tagName === 'BUTTON' && this.root.contains(a)) return;
      e.preventDefault();
      this._close();
    } else if (k === 'KeyF' || k === 'Escape') {
      e.preventDefault();
      this._close();
    } else if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') {
      this._setTab(TABS[Number(k.slice(5)) - 1][0]);
    }
  }
}

export default Store;
