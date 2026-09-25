// Gun store: data-driven catalog (weapons, per-weapon upgrades, equipment), the pure
// upgrade → weapon def derivation used by WeaponSystem, and the purchase actions.
// To extend the store just add entries below. Weapon entries whose id is not in WEAPONS
// (yet) are hidden, as are equipment entries whose `requires` weapon is missing.
import { WEAPONS } from '../player/weaponDefs.js';
import { giveAkimbo } from '../player/akimbo.js';
import { SLOT_LABEL, ONE_PER_SLOT, GRENADIER, MAG_VEST, GLOVES, BOOTS, DEFIB, PACK_SLOT } from './gear.js';

// slot 0 = primary, slot 1 = secondary (replaces the M9). `upg` scales upgrade prices. `akimbo`: price
// of the one-time dual-wield upgrade (a second gun in the left hand, player/akimbo.js).
export const SHOP_WEAPONS = [
  { id: 'm4a1', slot: 0, price: 1200, type: 'ASSAULT RIFLE', icon: 'rifle' },
  { id: 'm4super90', slot: 0, price: 1400, type: 'SEMI-AUTO SHOTGUN', icon: 'shotgun' },
  { id: 'm16a2', slot: 0, price: 1500, type: '3-ROUND BURST RIFLE', icon: 'rifle' },
  { id: 'spas12', slot: 0, price: 1800, type: 'COMBAT SHOTGUN', icon: 'shotgun' },
  { id: 'p90', slot: 0, price: 2000, type: 'SUBMACHINE GUN', icon: 'rifle' },
  { id: 'r201', slot: 0, price: 2400, type: 'ASSAULT RIFLE', icon: 'rifle', upg: 1.15 },
  { id: 'softball', slot: 0, price: 3500, type: 'GRENADE LAUNCHER', icon: 'launcher', upg: 1.3 },
  { id: 'devotion', slot: 0, price: 3800, type: 'LIGHT MACHINE GUN', icon: 'lmg', upg: 1.3 },
  { id: 'sigma', slot: 0, price: 4500, type: 'HEAVY MACHINE GUN', icon: 'lmg', upg: 1.4 },
  { id: 'm9', slot: 1, price: 0, type: 'PISTOL', icon: 'pistol', upg: 0.6, akimbo: 2500 },
  { id: 'mozambique', slot: 1, price: 700, type: 'SHOTGUN PISTOL', icon: 'pistol', upg: 0.7, akimbo: 3200 },
];

// Per-weapon upgrades: `costs[n]` buys level n+1, `mult[level]` is the stat multiplier.
export const MAX_LEVEL = 3;
export const UPGRADES = [
  { key: 'dmg', name: 'DAMAGE', short: 'DMG', costs: [450, 900, 1600], mult: [1, 1.15, 1.32, 1.5] },
  { key: 'mag', name: 'MAGAZINE', short: 'MAG', costs: [300, 650, 1200], mult: [1, 1.25, 1.5, 2] },
  { key: 'reload', name: 'RELOAD SPEED', short: 'RLD', costs: [300, 650, 1200], mult: [1, 0.85, 0.72, 0.6] },
  { key: 'rate', name: 'FIRE RATE', short: 'ROF', costs: [400, 850, 1500], mult: [1, 1.08, 1.16, 1.25] },
];
const UPG = Object.fromEntries(UPGRADES.map((u) => [u.key, u]));

// Gas mask: a filter with `base` seconds of clean air, +`perLevel` s per upgrade level. It drains
// only in the gas, recharges `recharge` s/s outside it and refills at every round end.
export const GAS_MASK = { price: 600, base: 8, perLevel: 4, costs: [400, 700, 1100], recharge: 0.5 };
export const maskCapacity = (level) => GAS_MASK.base + GAS_MASK.perLevel * (level | 0);

// Barricade kit: planks + nails for one doorway (world/barricades.js), carried in slot 5.
export const BARRICADE_KIT = { price: 300, max: 3 };

// Equipment: CONSUMABLES (`count`/`max` cap stacking, `carry`: the grenadier vest raises the cap,
// `give` applies one purchase) and GEAR (`slot`: a body slot, see game/gear.js). Items with `owned`
// are bought once; their optional `upgrade` track is then bought from the same card.
export const SHOP_EQUIPMENT = [
  {
    key: 'frag', name: 'M67 FRAG', type: 'FRAG GRENADE', icon: 'grenade', price: 250, max: 4, carry: true, requires: 'm67',
    count: (g) => g.weapons.grenades,
    give: (g) => { g.weapons.grenades++; },
  },
  {
    key: 'molotov', name: 'MOLOTOV', type: 'INCENDIARY', icon: 'molotov', price: 350, max: 3, carry: true, requires: 'molotov',
    count: (g) => g.weapons.molotovs ?? 0,
    give: (g) => { g.weapons.molotovs = (g.weapons.molotovs ?? 0) + 1; },
  },
  {
    key: 'barricade', name: 'BARRICADE KIT', type: 'PLANKS + NAILS · BOARD UP A DOOR', icon: 'barricade',
    price: BARRICADE_KIT.price, max: BARRICADE_KIT.max, carry: true, requires: 'barricade',
    count: (g) => g.weapons.barricades ?? 0,
    give: (g) => { g.weapons.barricades = (g.weapons.barricades ?? 0) + 1; },
  },
  {
    key: 'armor', name: 'KEVLAR PLATES', type: '+50 AP · UP TO 200', icon: 'armor', price: 400, max: 200, unit: 'AP',
    count: (g) => Math.ceil(g.player.ap),
    give: (g) => { g.player.ap = Math.min(200, g.player.ap + 50); },
  },
  {
    key: 'ammo', name: 'AMMO CRATE', type: 'MAX RESERVE · ALL GUNS', icon: 'ammo', price: 200,
    full: (g) => !g.weapons.refillReserves(true),
    give: (g) => { g.weapons.refillReserves(); },
  },
  // ---- GEAR: worn on a body slot (game/gear.js), bought once and kept all match; only one item per
  // slot is worn (buying another one swaps it, owned items are equipped again for free). `desc`: the
  // effect lines in the store's detail panel.
  {
    key: 'gasmask', slot: 'head', name: 'GAS MASK', type: 'BREATHE IN THE TOXIC GAS', icon: 'gasmask', price: GAS_MASK.price,
    desc: ['No gas damage while the filter lasts', 'Filter drains in the gas, refills every round'],
    owned: (g) => !!g.gear?.owns('gasmask'),
    give: (g) => {
      g.gear.buy('gasmask');
      g.gear.mask.filter = maskCapacity(g.gear.mask.level);
    },
    upgrade: {
      name: 'FILTER', costs: GAS_MASK.costs,
      level: (g) => g.gear?.mask.level ?? 0,
      value: (lv) => `${maskCapacity(lv)}s`,
      apply: (g) => {
        const m = g.gear.mask;
        g.gear.upgrade('gasmask');
        m.filter = maskCapacity(m.level);
      },
    },
  },
  gearItem('grenadier', 'torso', 'GRENADIER VEST', 'BANDOLIER RIG · +2 THROWABLES', 'grenadier', 600, [
    `Carry +${GRENADIER.carry} frags, +${GRENADIER.carry} Molotovs`,
    `and +${GRENADIER.carry} barricade kits`,
  ]),
  gearItem('magvest', 'torso', 'MAG-POUCH VEST', 'FASTER RELOADS · ALL WEAPONS', 'magvest', 1000, ['Spare mags right at hand', 'Every weapon reloads faster'], {
    name: 'RELOAD', costs: [700],
    level: (g) => g.gear?.level('magvest') ?? 0,
    value: (lv) => `-${Math.round((1 - MAG_VEST.reload[Math.min(lv, MAG_VEST.reload.length - 1)]) * 100)}%`,
    apply: (g) => g.gear.upgrade('magvest'),
  }),
  gearItem('backpack', 'back', 'WEAPON BACKPACK', 'CARRY TWO PRIMARY WEAPONS', 'backpack', 2500, [
    'A second primary on your back',
    'Press 1 again to swap them',
  ], null, 'GUN BACKPACK'),
  gearItem('defib', 'back', 'DEFIBRILLATOR', 'FASTER REVIVES · +HP', 'defib', 1500, [
    `Revives take ${Math.round(DEFIB.channel * 100)}% of the time`,
    `The revived come back with ${DEFIB.hp} HP`,
  ]),
  gearItem('gloves', 'hands', 'TACTICAL GLOVES', 'FASTER AIM + WEAPON SWITCH', 'gloves', 800, [
    `Aim down sights ${Math.round((1 - GLOVES.handling) * 100)}% faster`,
    `Draw weapons ${Math.round((1 - GLOVES.handling) * 100)}% faster`,
  ]),
  gearItem('boots', 'feet', 'COMBAT BOOTS', 'FASTER SPRINT', 'boots', 600, [`Sprint ${Math.round((BOOTS.sprint - 1) * 100)}% faster`, 'Stairs included']),
  gearItem('machete', 'belt', 'MACHETE', 'REPLACES THE KNIFE · SLOT 3', 'machete', 500, ['Double melee damage, faster swing', 'Cuts a Biter down in one hit']),
];

/** A plain gear entry: bought once, worn on `slot` (game/gear.js does the effect). `short`: card label. */
function gearItem(key, slot, name, type, icon, price, desc, upgrade = null, short = null) {
  return {
    key, slot, name, type, icon, price, desc, upgrade, short,
    owned: (g) => !!g.gear?.owns(key),
    give: (g) => g.gear.buy(key),
  };
}

// ------------------------------------------------------------------ upgrade math

const RELOAD_KEYS = ['reload', 'reloadEmpty', 'reloadStart', 'shellTime', 'reloadEnd'];
const CYCLE_KEYS = ['boltTime', 'cycleAt', 'burstDelay'];
const _defCache = new WeakMap(); // levels object → { base, def }

/**
 * Upgraded copy of a weapon def. `levels` = { dmg, mag, reload, rate } (0..3) and must be
 * treated as immutable (replace it to change levels): the result is cached per levels object,
 * so the same object comes back every frame.
 */
export function effectiveDef(base, levels) {
  if (!base || !levels) return base;
  const c = _defCache.get(levels);
  if (c && c.base === base) return c.def;
  const def = deriveDef(base, levels);
  _defCache.set(levels, { base, def });
  return def;
}

/** Uncached derived def, for store previews ("next level" values). */
export function previewDef(base, levels) {
  return deriveDef(base, levels || {});
}

function mult(key, lv) {
  const m = UPG[key].mult;
  return m[Math.max(0, Math.min(m.length - 1, lv | 0))];
}

function deriveDef(base, lv) {
  const d = { ...base, upgrades: lv };
  if (base.damage) d.damage = base.damage * mult('dmg', lv.dmg);
  if (base.mag && !base.noReload) {
    const m = mult('mag', lv.mag);
    d.mag = Math.max(base.mag + (lv.mag | 0), Math.round(base.mag * m));
    if (base.reserve) d.reserve = Math.round(base.reserve * m);
    if (base.maxReserve) d.maxReserve = Math.round(base.maxReserve * m);
  }
  const r = mult('reload', lv.reload);
  for (const k of RELOAD_KEYS) if (base[k]) d[k] = base[k] * r;
  const f = mult('rate', lv.rate);
  if (base.rpm) d.rpm = base.rpm * f;
  for (const k of CYCLE_KEYS) if (base[k]) d[k] = base[k] / f;
  return d;
}

// ------------------------------------------------------------------ catalog views

export const weaponEntry = (id) => SHOP_WEAPONS.find((e) => e.id === id);
export const upgradeOf = (key) => UPG[key];

/** Visible catalog weapons (ids missing from WEAPONS are hidden), cheapest first per slot. */
export function shopWeapons(slot) {
  return SHOP_WEAPONS.filter((e) => WEAPONS[e.id] && (slot == null || e.slot === slot)).sort((a, b) => a.price - b.price);
}

export function shopEquipment() {
  return SHOP_EQUIPMENT.filter((e) => !e.requires || WEAPONS[e.requires]);
}

/** Upgrades that make sense for a weapon def (no mag/reload on belt-fed guns, etc). */
export function upgradesFor(base) {
  const reloads = !!base?.mag && !base.noReload;
  return UPGRADES.filter((u) => (u.key === 'dmg' ? base?.damage : u.key === 'rate' ? base?.rpm : reloads));
}

export function upgradeCost(entry, key, level) {
  const c = UPG[key]?.costs[level];
  if (c == null) return null;
  return Math.round((c * (entry?.upg ?? 1)) / 50) * 50;
}

/** Store weapons the player owns (upgrade targets), equipped ones first. */
export function ownedWeapons(game) {
  const w = game.weapons;
  const rank = (e) => (weaponSlotOf(w, e) >= 0 ? 0 : 1) + e.slot * 0.5;
  return shopWeapons().filter((e) => w.owned?.has(e.id)).sort((a, b) => rank(a) - rank(b));
}

/** The WeaponSystem slot a store weapon is carried in (a primary: 0 or the backpack's), or -1. */
export function weaponSlotOf(w, e) {
  if (w.slots[e.slot] === e.id) return e.slot;
  return e.slot === 0 && w.slots[PACK_SLOT] === e.id ? PACK_SLOT : -1;
}

/** `where`: the slot it's carried in (-1: not carried). A gun in the weapon backpack counts as equipped. */
export function weaponState(game, e) {
  const w = game.weapons;
  const owned = !!w.owned?.has(e.id);
  const where = weaponSlotOf(w, e);
  return { owned, equipped: where >= 0, where, afford: owned || game.economy.canAfford(game.player, e.price) };
}

/** True when the weapon backpack is worn: primaries then pick a slot (0 or PACK_SLOT). */
export const hasPack = (game) => !!game.gear?.has?.('backpack');

/**
 * Default primary slot for a store primary with the backpack worn: where it already is, else the
 * backpack (a second primary goes into the pack instead of replacing your main gun).
 */
export function primaryTarget(game, id) {
  const w = game.weapons;
  if (!hasPack(game)) return 0;
  if (w.slots[0] === id) return 0;
  return PACK_SLOT;
}

/** Carry cap of a consumable (the grenadier vest raises frags, Molotovs and barricade kits). */
export function itemMax(game, item) {
  return item.max == null ? null : item.max + (item.carry ? game.gear?.carryBonus?.() ?? 0 : 0);
}

/** Store section of an equipment entry: 'gear' (worn on a body slot) or 'consumable'. */
export const itemSection = (item) => (item.slot ? 'gear' : 'consumable');

/**
 * Body-slot state of a gear entry: { slot, slotLabel, worn, replaces } (`replaces`: the name of the
 * item worn on that slot now, which putting this one on would take off).
 */
export function gearSlotState(game, item) {
  const gear = game.gear;
  const on = ONE_PER_SLOT ? gear?.wornOn?.(item.slot) : null;
  const other = on && on !== item.key ? SHOP_EQUIPMENT.find((e) => e.key === on) : null;
  return { slot: item.slot, slotLabel: SLOT_LABEL[item.slot] ?? '', worn: !!gear?.has?.(item.key), replaces: other?.name ?? null };
}

export function equipmentState(game, item) {
  if (item.owned) {
    // one-off gear (optional upgrade track); an owned item that's off is put on again for free
    const owned = item.owned(game);
    const lv = item.upgrade ? item.upgrade.level(game) : 0;
    const gs = item.slot ? gearSlotState(game, item) : null;
    const equip = owned && !!gs && !gs.worn;
    const cost = !owned ? item.price : equip ? 0 : item.upgrade?.costs[lv];
    const maxed = owned && !equip && cost == null;
    return { ...gs, owned, level: lv, cost, maxed, equip, afford: maxed || equip || game.economy.canAfford(game.player, cost) };
  }
  const n = item.count ? item.count(game) : 0;
  const max = itemMax(game, item);
  const maxed = item.full ? item.full(game) : n >= max;
  return { count: n, max, maxed, cost: item.price, afford: game.economy.canAfford(game.player, item.price) };
}

// ------------------------------------------------------------------ purchases
// Each returns { ok, msg, sound?, cost? } for the store UI.

const NO_CASH = { ok: false, msg: 'NOT ENOUGH CASH', sound: 'dryfire' };

/**
 * Buy / equip a store weapon. `target`: for a primary with the weapon backpack worn, the slot it goes
 * into (0 or PACK_SLOT, default primaryTarget); a gun already in the other primary slot trades places.
 */
export function buyWeapon(game, id, target = null) {
  const e = weaponEntry(id);
  const def = WEAPONS[id];
  if (!e || !def) return { ok: false, msg: 'UNAVAILABLE' };
  const w = game.weapons;
  const pack = e.slot === 0 && hasPack(game);
  const slot = pack ? target ?? primaryTarget(game, id) : e.slot;
  const where = pack && slot === PACK_SLOT ? ' · BACKPACK' : '';
  if (w.slots[slot] === id) return { ok: false, msg: `${def.name} ALREADY EQUIPPED` };
  if (pack && w.slots[slot === 0 ? PACK_SLOT : 0] === id) {
    // carried in the other primary slot: the two guns trade places
    if (!w.slots[slot]) return { ok: false, msg: 'SLOT 1 CAN\u2019T BE EMPTY', sound: 'dryfire' };
    w.swapPrimaries();
    return { ok: true, msg: `${def.name} MOVED${where || ' · SLOT 1'}` };
  }
  if (!w.owned.has(id)) {
    if (!game.economy.spend(game.player, e.price)) return NO_CASH;
    w.owned.add(id);
    w.equipFromStore(id, slot);
    return { ok: true, msg: `${def.name} PURCHASED${where}`, sound: 'pickup_weapon', cost: e.price };
  }
  w.equipFromStore(id, slot);
  return { ok: true, msg: `${def.name} EQUIPPED${where}` };
}

export function buyUpgrade(game, id, key) {
  const e = weaponEntry(id);
  const w = game.weapons;
  if (!e || !UPG[key] || !w.owned?.has(id)) return { ok: false, msg: 'UNAVAILABLE' };
  const lv = w.upgradeLevel(id, key);
  if (lv >= MAX_LEVEL) return { ok: false, msg: 'MAXED OUT' };
  const cost = upgradeCost(e, key, lv);
  if (!game.economy.spend(game.player, cost)) return NO_CASH;
  w.setUpgrade(id, key, lv + 1);
  return { ok: true, msg: `${WEAPONS[id].name} ${UPG[key].name} ${'I'.repeat(lv + 1)}`, sound: 'm4_bolt', cost };
}

/** Akimbo upgrade of a pistol: { avail (offered for it), owned, cost, afford }. */
export function akimboState(game, e) {
  const w = game.weapons;
  const owned = !!w.akimbo?.has(e.id);
  const cost = e.akimbo ?? null;
  return { avail: cost != null && !!w.owned?.has(e.id), owned, cost, afford: owned || (cost != null && game.economy.canAfford(game.player, cost)) };
}

export function buyAkimbo(game, id) {
  const e = weaponEntry(id);
  const w = game.weapons;
  if (!e?.akimbo || !w.owned?.has(id)) return { ok: false, msg: 'UNAVAILABLE' };
  if (w.akimbo?.has(id)) return { ok: false, msg: 'ALREADY AKIMBO' };
  if (!game.economy.spend(game.player, e.akimbo)) return NO_CASH;
  giveAkimbo(w, id);
  return { ok: true, msg: `AKIMBO ${WEAPONS[id].name}`, sound: 'pickup_weapon', cost: e.akimbo };
}

export function buyEquipment(game, key) {
  const item = shopEquipment().find((i) => i.key === key);
  if (!item) return { ok: false, msg: 'UNAVAILABLE' };
  if (item.owned) {
    const st = equipmentState(game, item);
    if (st.equip) {
      game.gear.equip(key); // owned, back on (free)
      return { ok: true, msg: st.replaces ? `${item.name} ON · ${st.replaces} OFF` : `${item.name} EQUIPPED`, sound: 'weapon_switch' };
    }
    if (st.maxed) return { ok: false, msg: 'MAXED OUT', sound: 'dryfire' };
    if (!game.economy.spend(game.player, st.cost)) return NO_CASH;
    if (!st.owned) {
      item.give(game);
      return { ok: true, msg: st.replaces ? `${item.name} ON · ${st.replaces} OFF` : `${item.name} PURCHASED`, sound: 'pickup_ammo', cost: st.cost };
    }
    item.upgrade.apply(game);
    return { ok: true, msg: `${item.name} ${item.upgrade.name} ${'I'.repeat(st.level + 1)}`, sound: 'm4_bolt', cost: st.cost };
  }
  const st = equipmentState(game, item);
  if (st.maxed) return { ok: false, msg: item.full ? 'ALREADY FULL' : `CARRYING MAX (${st.max})`, sound: 'dryfire' };
  if (!game.economy.spend(game.player, item.price)) return NO_CASH;
  item.give(game);
  return { ok: true, msg: `${item.name} PURCHASED`, sound: key === 'ammo' || key === 'armor' ? 'pickup_ammo' : key === 'barricade' ? 'plank_drop' : 'grenade_pin', cost: item.price };
}
