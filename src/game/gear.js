// Gear: the store's wearable items (bought once, kept for the whole match). Every item sits on a body
// slot; you OWN everything you buy, but only one item per slot is WORN (ONE_PER_SLOT), and only worn
// items work. Buying a second item for an occupied slot wears it and takes the other one off; owned
// items are swapped back for free in the store (ui/store.js). Prices and store texts are in
// game/shop.js, the effect tuning is here, and every system asks this module:
//   player.js    sprintMul()                                     combat boots
//   weapons.js   gearDef() (reload / ADS / draw), setBackpack(), setMelee()   vest, gloves, backpack, machete
//   shop.js      carryBonus() (frag / Molotov / barricade-kit caps)          grenadier vest
//   revive.js    defibFor() + DEFIB                              defibrillator
//   game.js      has('gasmask') via gear.mask                    gas mask
// Only the player wears gear (bots are unaffected). game.gear is a Gear; start() resets it.
import { gunMaterial } from '../player/gunModels.js';

/** One worn item per body slot. false: every owned item is worn at once (everything stacks). */
export const ONE_PER_SLOT = true;

export const GEAR_SLOTS = ['head', 'neck', 'torso', 'back', 'belt', 'hands', 'feet', 'pocket'];
export const SLOT_LABEL = { head: 'HEAD', neck: 'NECK', torso: 'TORSO', back: 'BACK', belt: 'BELT', hands: 'HANDS', feet: 'FEET', pocket: 'POCKET' };

// effect tuning. Time multipliers: 0.85 = takes 85 % as long ("15 % faster"), like the reload upgrade
export const GRENADIER = { carry: 2 }; // + frags, Molotovs and barricade kits you can carry
export const MAG_VEST = { reload: [0.85, 0.75] }; // reload time x, level 1 / level 2 (upgrade)
export const GLOVES = { handling: 0.7, tint: { gloveFabric: 0x7d6848 } }; // ADS and draw time x; first-person glove backs go coyote tan
export const BOOTS = { sprint: 1.15 }; // sprint speed x
export const DEFIB = { channel: 0.6, hp: 40 }; // revive channel time x, HP after the revive (default 20)
export const MACHETE = { id: 'machete' }; // the melee slot's weapon def while it's worn (weaponDefs.js)
export const PACK_SLOT = 6; // WeaponSystem slot of the weapon backpack's second primary (key 1 again)

/** Item key -> body slot. */
export const GEAR_SLOT = {
  gasmask: 'head',
  grenadier: 'torso',
  magvest: 'torso',
  backpack: 'back',
  defib: 'back',
  gloves: 'hands',
  boots: 'feet',
  machete: 'belt',
};

export class Gear {
  constructor(game) {
    this.game = game;
    this.ver = 0; // bumped on every change (cheap "did anything change" checks)
    this.reset();
  }

  /** A new match: nothing owned. Weapons reset their own slots (no backpack gun, the knife). */
  reset() {
    this.owned = new Set();
    this.worn = {}; // slot -> item key
    this.levels = {}; // item key -> upgrade level
    const gear = this;
    // the gas mask's filter (game.js drains / refills it); `owned` = worn, so a mask taken off stops filtering
    this.mask = {
      level: 0,
      filter: 0,
      get owned() {
        return gear.has('gasmask');
      },
    };
    this.ver++;
    tintGloves(false);
  }

  owns(key) {
    return this.owned.has(key);
  }

  /** Worn (so its effect applies). */
  has(key) {
    if (!this.owned.has(key)) return false;
    return !ONE_PER_SLOT || this.worn[GEAR_SLOT[key]] === key;
  }

  /** The item worn on a body slot, or null. */
  wornOn(slot) {
    if (!ONE_PER_SLOT) return null;
    const k = this.worn[slot];
    return k && this.owned.has(k) ? k : null;
  }

  level(key) {
    return key === 'gasmask' ? this.mask.level : this.levels[key] | 0;
  }

  /** Buy (own) an item and put it on. Returns the item it replaced on that slot, or null. */
  buy(key) {
    if (!GEAR_SLOT[key] || this.owned.has(key)) return null;
    const prev = this.wornOn(GEAR_SLOT[key]);
    this.owned.add(key);
    return this._wear(key, prev);
  }

  /** Wear an owned item again (free). Returns the item taken off that slot, or null. */
  equip(key) {
    if (!this.owned.has(key) || this.has(key)) return null;
    return this._wear(key, this.wornOn(GEAR_SLOT[key]));
  }

  _wear(key, prev) {
    this.worn[GEAR_SLOT[key]] = key;
    this.ver++;
    if (prev && prev !== key) this._apply(prev, false);
    this._apply(key, true);
    return prev && prev !== key ? prev : null;
  }

  upgrade(key) {
    if (key === 'gasmask') this.mask.level++;
    else this.levels[key] = (this.levels[key] | 0) + 1;
    this.ver++;
  }

  /** Side effects of putting an item on / taking it off. */
  _apply(key, on) {
    const w = this.game?.weapons;
    if (key === 'backpack') w?.setBackpack?.(on);
    else if (key === 'machete') w?.setMelee?.(on ? MACHETE.id : 'knife');
    else if (key === 'gloves') tintGloves(on);
  }

  /* ------------------------------------------------------------ effects (the player's) */

  /** Extra frags / Molotovs / barricade kits you can carry. */
  carryBonus() {
    return this.has('grenadier') ? GRENADIER.carry : 0;
  }

  /** Reload time multiplier (mag-pouch vest, by level). */
  reloadMul() {
    if (!this.has('magvest')) return 1;
    const r = MAG_VEST.reload;
    return r[Math.min(r.length - 1, this.level('magvest'))];
  }

  /** ADS + draw time multiplier (tactical gloves). */
  handlingMul() {
    return this.has('gloves') ? GLOVES.handling : 1;
  }

  /** Sprint speed multiplier (combat boots). */
  sprintMul() {
    return this.has('boots') ? BOOTS.sprint : 1;
  }
}

/** The first-person arms (player/gltfArms.js share gunModels' glove materials) wear the tactical gloves' colors. */
function tintGloves(on) {
  if (typeof document === 'undefined') return;
  for (const [key, hex] of Object.entries(GLOVES.tint)) {
    const m = gunMaterial(key);
    m.userData.baseHex ??= m.color.getHex();
    m.color.setHex(on ? hex : m.userData.baseHex);
  }
}

/**
 * The defibrillator on the player's back: it is used in every revive the player takes part in
 * (the player reviving a teammate, or a teammate reviving the player with it). Such a revive
 * channels DEFIB.channel x as long and brings the downed one back with DEFIB.hp. Bot-to-bot revives
 * and the revive window are unchanged. (game/revive.js calls this.)
 */
export function defibFor(game, reviver, target) {
  return !!game?.gear?.has?.('defib') && (!!reviver?.isPlayer || !!target?.isPlayer);
}

// ------------------------------------------------------------------ weapon defs

const RELOAD_KEYS = ['reload', 'reloadEmpty', 'reloadStart', 'shellTime', 'reloadEnd'];
const _gd = new WeakMap(); // def -> { r, h, def }

/**
 * The held weapon's def with the worn gear applied (mag-pouch vest: reload timings; tactical gloves:
 * ADS + draw time). Returns `d` itself when nothing applies, and the same object every frame while
 * the gear stays the same, so `def === d` checks keep working. The store's stat bars use the plain
 * defs (upgrades only).
 */
export function gearDef(game, d) {
  const g = game?.gear;
  if (!d || !g?.reloadMul) return d;
  const r = g.reloadMul();
  const h = g.handlingMul();
  if (r === 1 && h === 1) return d;
  const c = _gd.get(d);
  if (c && c.r === r && c.h === h) return c.def;
  const def = { ...d };
  if (r !== 1) for (const k of RELOAD_KEYS) if (d[k]) def[k] = d[k] * r;
  if (h !== 1) {
    if (d.adsTime) def.adsTime = d.adsTime * h;
    def.drawTime = (d.drawTime ?? 0.4) * h;
  }
  _gd.set(d, { r, h, def });
  return def;
}
