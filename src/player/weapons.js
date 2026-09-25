// Player weapon logic: inventory, fire modes, reloads (mag / shell-by-shell), bolt cycling,
// ADS, spread bloom, recoil, knife, grenades, chaingun spin-up.
import * as THREE from 'three';
import { WEAPONS } from './weaponDefs.js';
import { effectiveDef } from '../game/shop.js';
import { akimboDef, akimboTriggers, akimboTryReload, akimboReloadTick, akimboRounds } from './akimbo.js';
import { gearDef, PACK_SLOT } from '../game/gear.js';
import { clamp, coneDirection, damp, rand } from '../core/utils.js';

const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const DEG = Math.PI / 180;
const WHEEL_ORDER = [0, PACK_SLOT, 1, 2, 3, 4, 5]; // scroll order of the slots

export class WeaponSystem {
  constructor(game, player, viewmodel) {
    this.game = game;
    this.player = player;
    this.vm = viewmodel;
    this.slots = [null, 'm9', 'knife', 'm67', 'barricade', 'gascan', null]; // [6]: backpack primary (game/gear.js)
    this.ammo = {};
    this.grenades = 2;
    this.molotovs = 0;
    this.barricades = 0; // store barricade kits (slot 5; world/barricades.js does the building)
    this.buildT = null; // seconds into nailing one up (viewmodel hammer swing), set by world/barricades.js
    this.gascans = 0; // jerry cans from upstairs (slot 6; world/power.js does the refuelling)
    this.pourT = null; // seconds into pouring one into the generator (viewmodel), set by world/power.js
    this.tool = null; // a tool drawn for a moment instead of the weapon (generator repair, see beginTool)
    this.toolT = null; // seconds into using it (viewmodel), set by world/power.js
    this.burstLeft = 0;
    this.cur = 0;
    this.prev = 1;
    this.state = 'idle';
    this.stateT = 0;
    this.cooldown = 0;
    this.ads = 0;
    this.bloom = 0;
    this.spin = 0;
    this.shotCount = 0;
    this.triggerHeld = false;
    this.quickNade = false;
    this.nadeReturn = 0;
    this.adsWanted = false;
    this.spinHandle = null;
    this.fireHandle = null;
    this.fireBuffer = 0; // a click is remembered this long (s) so it isn't eaten by a cooldown / sprint-out
    this.sprintK = 0; // 0..1 sprint pose; firing waits for the sprint-out
    this.sprintLock = 0;
    this.airK = 0; // smoothed stance for the spread cone
    this.airT = 0;
    this.crouchK = 0;
  }

  reset(primaryId = 'm4a1') {
    this.slots = [primaryId, 'm9', 'knife', 'm67', 'barricade', 'gascan', null];
    this.packStash = null; // the backpack gun while the backpack is off (see setBackpack)
    this.owned = new Set([primaryId, 'm9']); // store inventory
    this.upgrades = {}; // id -> { dmg, mag, reload, rate } (replaced, never mutated)
    this.akimbo = new Set(); // pistols with the akimbo upgrade (player/akimbo.js)
    this.duo = null;
    this.game.fx?.mags?.clear(); // last run's empty magazines
    this.ammo = {};
    for (const id of this.slots) this._initAmmo(id);
    this.grenades = 2;
    this.molotovs = 0;
    this.barricades = 0;
    this.buildT = null;
    this.gascans = 0;
    this.pourT = null;
    this.tool = null;
    this.toolT = null;
    this.burstLeft = 0;
    this.cur = 0;
    this.prev = 1;
    this.lastPrimary = 0; // key 1 brings this primary back (0, or the backpack's PACK_SLOT)
    this._setState('draw');
    this.ads = 0;
    this.bloom = 0;
    this.spin = 0;
    this.fireBuffer = 0;
    this.sprintK = 0;
    this._stopLoops();
    this.vm.equip(this.def, this.state);
  }

  _initAmmo(id) {
    const d = this.defOf(id);
    if (!d || !d.mag) return;
    if (!this.ammo[id]) this.ammo[id] = { mag: d.mag, reserve: d.reserve };
  }

  get def() {
    const id = this.slots[this.cur];
    // the secondary as a pair once its akimbo upgrade is bought (player/akimbo.js); worn gear (faster
    // reloads, ADS, draws) on top (game/gear.js)
    return gearDef(this.game, this.cur === 1 && this.akimbo?.has(id) ? akimboDef(this.defOf(id)) : this.defOf(id));
  }
  get curAmmo() {
    return this.ammo[this.slots[this.cur]];
  }
  get primaryId() {
    return this.slots[0];
  }

  _setState(s) {
    this.state = s;
    this.stateT = 0;
    this.phaseDone = {};
  }

  /**
   * Put a found weapon in a primary slot and draw it. Returns the id that was dropped. With the weapon
   * backpack it goes into the backpack while that is empty (nothing dropped), or replaces the primary
   * in your hands.
   */
  giveWeapon(id, slot = this._pickupSlot()) {
    const old = this.slots[slot];
    this.slots[slot] = id;
    const d = WEAPONS[id];
    this.ammo[id] = { mag: d.mag, reserve: d.reserve };
    this.switchTo(slot, true);
    return old;
  }

  /**
   * Key 1: the primary you last had out; pressed again with a primary in hand it swaps to the other
   * one, the weapon backpack's gun (like 4 toggles frag <-> Molotov).
   */
  _primaryKey() {
    const S = PACK_SLOT;
    if (!this.slots[S]) return 0;
    if (this.cur === 0) return S;
    if (this.cur === S) return 0;
    return this.lastPrimary === S ? S : 0;
  }

  /** HUD: with a primary in hand and a second one in the weapon backpack, the other one (key 1 swaps). */
  altPrimary() {
    const S = PACK_SLOT;
    if (!this.slots[S] || (this.cur !== 0 && this.cur !== S)) return null;
    return WEAPONS[this.slots[this.cur === S ? 0 : S]]?.name ?? null;
  }

  _pickupSlot() {
    if (this.cur === PACK_SLOT && this.slots[PACK_SLOT]) return PACK_SLOT;
    return this.game.gear?.has?.('backpack') && !this.slots[PACK_SLOT] ? PACK_SLOT : 0;
  }

  /**
   * Weapon backpack on / off (game/gear.js): off, its gun leaves the slots (still owned, kept with its
   * ammo) and comes back when the backpack is worn again.
   */
  setBackpack(on) {
    const S = PACK_SLOT;
    if (on) {
      const id = this.packStash;
      this.packStash = null;
      if (id && !this.slots[S] && id !== this.slots[0]) this.slots[S] = id;
      return;
    }
    this.packStash = this.slots[S];
    this.slots[S] = null;
    if (this.prev === S) this.prev = 0;
    if (this.cur === S) this.switchTo(0, true);
  }

  /** The two primaries trade places (store: choosing which gun sits where). */
  swapPrimaries() {
    const S = PACK_SLOT;
    if (!this.slots[S]) return false;
    [this.slots[0], this.slots[S]] = [this.slots[S], this.slots[0]];
    if (this.cur === 0 || this.cur === S) this.switchTo(this.cur, true);
    return true;
  }

  /** Slot 3's melee weapon: 'knife', or 'machete' while that gear is worn. */
  setMelee(id) {
    if (!WEAPONS[id] || this.slots[2] === id) return;
    this.slots[2] = id;
    if (this.cur === 2) this.switchTo(2, true);
  }

  restock() {
    for (const id of this.slots) {
      const d = this.defOf(id);
      if (!d || !d.mag || !this.ammo[id]) continue;
      const a = this.ammo[id];
      if (d.noReload) {
        a.mag = Math.max(a.mag, Math.round(d.mag * 0.5));
        continue;
      }
      a.reserve = Math.max(a.reserve, d.reserve);
    }
    this.grenades = Math.max(this.grenades, 2);
  }

  refillFull() {
    for (const id of this.slots) {
      const d = this.defOf(id);
      if (!d || !d.mag || !this.ammo[id]) continue;
      const a = this.ammo[id];
      if (d.noReload) a.mag = d.mag;
      else a.reserve = Math.max(a.reserve, d.maxReserve ?? d.reserve);
    }
    this.grenades = Math.max(this.grenades, 3); // keep store-bought extras
  }

  addRifleAmmo() {
    const id = this.slots[this.cur === PACK_SLOT ? PACK_SLOT : 0]; // the primary in your hands (or slot 1's)
    const d = WEAPONS[id];
    const a = this.ammo[id];
    if (!a) return false;
    if (d.noReload) {
      a.mag = Math.min(d.mag, a.mag + 300);
      return true;
    }
    a.reserve = Math.min(d.maxReserve ?? d.reserve * 2, a.reserve + Math.max(d.mag * 2, Math.round(d.reserve * 0.5)));
    return true;
  }

  /** Carried count of a throwable ('m67' frags or 'molotov'). */
  throwCount(id = this.slots[3]) {
    return id === 'molotov' ? this.molotovs : this.grenades;
  }

  _otherThrowable(id = this.slots[3]) {
    return id === 'molotov' ? 'm67' : 'molotov';
  }

  /** Pick a throwable that is in stock for slot 3 (prefers the current one). */
  _pickThrowable() {
    if (this.throwCount() > 0) return true;
    const other = this._otherThrowable();
    if (this.throwCount(other) <= 0) return false;
    this.slots[3] = other;
    return true;
  }

  /** A usable slot to fall back to once a consumable slot (kits, cans) runs empty. */
  fallbackSlot() {
    const p = this.prev;
    if (p === 4 || p === 5 || (p === 3 && this.grenades + this.molotovs <= 0)) return 0;
    return p;
  }

  /**
   * Draw a tool for a moment instead of the weapon (world/power.js: the generator repair). Nothing
   * fires, aims, reloads or switches until endTool() brings the weapon back with a draw.
   */
  beginTool(id) {
    if (this.tool || !this.defOf(id)) return;
    this._stopLoops();
    this.tool = id;
    this.toolT = 0;
    this.ads = 0;
    this._setState('tool');
    this.vm.equip(this.defOf(id), 'draw');
  }

  endTool() {
    if (!this.tool) return;
    this.tool = null;
    this.toolT = null;
    this._setState('draw');
    this.vm.equip(this.def, 'draw');
  }

  switchTo(slot, force = false) {
    if (this.tool) {
      if (!force) return;
      this.tool = null;
      this.toolT = null;
    }
    // pressing 4 again while holding a throwable toggles frag <-> molotov
    if (slot === 3 && slot === this.cur && !force && this.state !== 'pinpull' && this.state !== 'throw') {
      const other = this._otherThrowable();
      if (this.throwCount(other) <= 0) return;
      this.slots[3] = other;
      force = true;
    }
    if (slot === this.cur && !force) return;
    if (!this.slots[slot]) return; // an empty backpack slot
    if ((slot === 3 && !this._pickThrowable()) || (slot === 4 && !(this.barricades > 0)) || (slot === 5 && !(this.gascans > 0))) {
      this.game.audio.play('dryfire', { volume: 0.4 });
      return;
    }
    if (this.state === 'throw' && !force) return;
    this._stopLoops();
    if (slot !== this.cur) this.prev = this.cur;
    if (slot === 0 || slot === PACK_SLOT) this.lastPrimary = slot;
    this.cur = slot;
    this._setState('draw');
    this.ads = Math.min(this.ads, 0.3);
    this.spin = 0;
    this.game.audio.play('weapon_switch', { volume: 0.55 });
    this.vm.equip(this.def, this.state);
  }

  _stopLoops() {
    this.spinHandle?.stop(0.1);
    this.fireHandle?.stop(0.08);
    this.spinHandle = null;
    this.fireHandle = null;
  }

  canAct() {
    return this.player.alive && this.state !== 'draw';
  }

  // ------------------------------------------------------------------ update
  update(dt, input) {
    const p = this.player;
    const d = this.def;
    this.stateT += dt;
    this.cooldown -= dt;

    if (!p.alive) {
      this._stopLoops();
      return;
    }
    if (p.climbing) input = null; // hands on the ladder (actors/ladders.js): no switching, reloading or firing

    // weapon selection
    if (input) {
      if (input.hit('Digit1')) this.switchTo(this._primaryKey());
      if (input.hit('Digit2')) this.switchTo(1);
      if (input.hit('Digit3')) this.switchTo(2);
      if (input.hit('Digit4')) this.switchTo(3);
      if (input.hit('Digit5')) this.switchTo(4);
      if (input.hit('Digit6')) this.switchTo(5);
      if (input.hit('KeyQ')) this.switchTo(this.prev);
      if (input.wheel !== 0 && this.state !== 'throw') {
        // empty throwable / barricade / gas can / backpack slots are skipped; the backpack gun comes
        // right after the primary
        const order = WHEEL_ORDER;
        const n = order.length;
        let i = order.indexOf(this.cur);
        let s = this.cur;
        for (let k = 0; k < n; k++) {
          i = (i + (input.wheel > 0 ? 1 : n - 1)) % n;
          s = order[i];
          if (s === 3 ? this.grenades + this.molotovs > 0 : s === 4 ? this.barricades > 0 : s === 5 ? this.gascans > 0 : !!this.slots[s]) break;
        }
        this.switchTo(s);
      }
      if (input.hit('KeyG') && this.cur !== 3 && this.state !== 'throw' && !this.tool && this._pickThrowable()) {
        this.nadeReturn = this.cur;
        this.quickNade = true;
        this._stopLoops();
        this.prev = this.cur;
        this.cur = 3;
        this._setState('pinpull');
        this.vm.equip(this.def, 'quick');
        this.game.audio.play('grenade_pin', { volume: 0.7 });
      }
      if (input.hit('KeyR')) this.tryReload();
    }

    const fireDown = input ? input.mouse(0) : false;
    const firePressed = input ? input.mouseHit(0) : false;
    const altDown = input ? input.mouse(2) : false;
    const altPressed = input ? input.mouseHit(2) : false;
    const gun = d.mode === 'auto' || d.mode === 'semi' || d.mode === 'bolt' || d.mode === 'pump' || d.mode === 'burst';

    // a click is buffered briefly: pressed during the sprint-out, a bolt cycle or a hair before the
    // next round is ready, it still fires the moment it can (semi-autos never swallow a click)
    this.fireBuffer = firePressed ? 0.14 : Math.max(0, this.fireBuffer - dt);

    // sprint: firing / aiming breaks it and the gun comes back up in a short sprint-out (sprintK < 0.35)
    this.sprintLock = Math.max(0, this.sprintLock - dt);
    p.noSprint = altDown || (gun && (fireDown || this.fireBuffer > 0 || this.sprintLock > 0));
    this.sprintK = damp(this.sprintK, p.sprinting ? 1 : 0, p.sprinting ? 8 : 16, dt);

    // stance for the spread cone: a jump widens it at once, landing / crouching settle smoothly
    this.airT = p.body.onGround ? 0 : this.airT + dt;
    const air = !p.body.onGround && (this.airT > 0.08 || p.body.vel.y > 1) ? 1 : 0; // ignore stair-step blips
    this.airK = damp(this.airK, air, air > this.airK ? 30 : 12, dt);
    this.crouchK = damp(this.crouchK, p.crouching ? 1 : 0, 12, dt);

    // state progression
    switch (this.state) {
      case 'draw':
        if (this.stateT >= (d.drawTime ?? 0.4)) this._setState('idle');
        break;
      case 'reload':
        this._updateMagReload(dt);
        break;
      case 'shellReload':
        this._updateShellReload(dt, firePressed);
        break;
      case 'bolt': // bolt-action and pump cycling
        if (this.stateT >= d.boltTime) {
          this._setState('idle');
          if (this.curAmmo.mag <= 0) this.tryReload();
        }
        if (!this.phaseDone.snd && this.stateT > (d.cycleAt ?? 0.12)) {
          this.phaseDone.snd = true;
          this.game.audio.play(d.cycleSound ?? 'sniper_bolt', { volume: 0.8 });
          this._ejectShell(d.shell, 0.8);
        }
        break;
      case 'melee':
      case 'heavy': {
        const heavy = this.state === 'heavy';
        const T = heavy ? d.heavyTime : d.swingTime;
        const hitAt = heavy ? d.heavyHitAt ?? 0.35 : d.hitAt ?? 0.12;
        if (!this.phaseDone.hit && this.stateT >= hitAt) {
          this.phaseDone.hit = true;
          this.game.meleeAttack(p, heavy ? d.heavyDamage : d.damage, heavy ? d.heavyRange : d.range, heavy, d);
        }
        if (this.stateT >= T) this._setState('idle');
        break;
      }
      case 'pinpull':
        if (this.stateT >= 0.3 && (!fireDown || this.quickNade)) this._setState('throw');
        break;
      case 'throw':
        if (!this.phaseDone.release && this.stateT >= 0.14) {
          this.phaseDone.release = true;
          if (d.id === 'molotov') this.molotovs--;
          else this.grenades--;
          this.game.throwGrenade(p, d);
          this.game.audio.play('grenade_throw', { volume: 0.7 });
        }
        if (this.stateT >= 0.55) {
          if (this.quickNade) {
            this.quickNade = false;
            this.cur = this.nadeReturn;
            this._setState('draw');
            this.vm.equip(this.def, 'draw');
          } else if (!this._pickThrowable()) {
            this.switchTo(this.prev === 3 ? 0 : this.prev, true);
          } else {
            this._setState('draw');
            this.vm.equip(this.def, 'draw');
          }
        }
        break;
      default:
        break;
    }

    // ADS: eases toward the target (fast start, settled in ~adsTime, out a bit quicker); the linear
    // floor lands it exactly, so full ADS accuracy arrives on time
    const canAds = !d.akimbo && d.mode !== 'melee' && d.mode !== 'grenade' && d.mode !== 'build' && d.mode !== 'pour' && (this.state === 'idle' || this.state === 'bolt' || this.state === 'draw') && !(d.scope && this.state === 'bolt') && !p.latchedBy; // no aiming with a Biter on your back
    this.adsWanted = altDown && canAds;
    const adsTime = d.adsTime ?? 0.2;
    const adsGoal = this.adsWanted ? 1 : 0;
    const adsStep = Math.max(Math.abs(adsGoal - this.ads) * (1 - Math.exp(-((this.adsWanted ? 3.2 : 4) / adsTime) * dt)), (0.3 / adsTime) * dt);
    this.ads = this.ads < adsGoal ? Math.min(adsGoal, this.ads + adsStep) : Math.max(adsGoal, this.ads - adsStep);
    if (this.adsWanted && altPressed) this.game.audio.play('aim_in', { volume: 0.35 });

    // melee alt = heavy
    if (d.mode === 'melee' && this.state === 'idle') {
      if (altPressed) {
        this._setState('heavy');
        this.game.audio.play(d.swingSound ?? 'knife_swing', { volume: 0.8, pitch: 0.8 });
      } else if (firePressed) {
        this._setState('melee');
        this.game.audio.play(d.swingSound ?? 'knife_swing', { volume: 0.7 });
      }
    }

    // grenade
    if (d.mode === 'grenade' && this.state === 'idle' && firePressed && this.throwCount() > 0) {
      this._setState('pinpull');
      this.game.audio.play('grenade_pin', { volume: 0.7 });
    }

    // chaingun spin
    if (d.id === 'chaingun') {
      const wantSpin = fireDown && this.state === 'idle' && this.curAmmo.mag > 0;
      if (wantSpin && this.spin === 0) this.game.audio.play('minigun_spinup', { volume: 0.8 });
      if (!wantSpin && this.spin > 0.6 && !this._spinDownPlayed) {
        this._spinDownPlayed = true;
        this.game.audio.play('minigun_spindown', { volume: 0.7 });
      }
      if (wantSpin) this._spinDownPlayed = false;
      this.spin = clamp(this.spin + (wantSpin ? dt / d.spinup : -dt / 0.8), 0, 1);
      if (!(wantSpin && this.spin >= 1)) {
        this.fireHandle?.stop(0.06);
        this.fireHandle = null;
      }
    }

    // firing: a click fires on this very frame. While the trigger is held the cooldown carries its
    // overshoot (see _fire), so full-auto holds its exact rpm at any frame rate, and a long frame
    // fires the rounds it owes instead of dropping them.
    if (d.akimbo) {
      akimboTriggers(this, dt, firePressed, altPressed); // Mouse1 the right gun, Mouse2 the left one
    } else if (gun && (this.state === 'idle' || (this.state === 'draw' && this.stateT > (d.drawTime ?? 0.4) * 0.75))) {
      for (let n = 0; n < 4 && this.cooldown <= 0 && this.sprintK < 0.35; n++) {
        const wants = d.mode === 'auto' ? fireDown || this.fireBuffer > 0 : d.mode === 'burst' ? this.fireBuffer > 0 || this.burstLeft > 0 : this.fireBuffer > 0;
        if (!wants || (d.id === 'chaingun' && this.spin < 1)) break; // chaingun: still spinning up
        if (this.curAmmo.mag <= 0) {
          if (firePressed) {
            this.game.audio.play('dryfire', { volume: 0.6 });
            this.tryReload();
          }
          this.burstLeft = 0;
          this.fireBuffer = 0;
          this.cooldown = 0.2;
          break;
        }
        if (d.mode === 'burst' && this.burstLeft <= 0) this.burstLeft = d.burst ?? 3;
        this.fireBuffer = 0;
        this._fire(dt);
        if (d.mode === 'burst' && --this.burstLeft <= 0) this.cooldown = Math.max(this.cooldown, d.burstDelay ?? 0.2);
        if (this.state !== 'idle' && this.state !== 'draw') break; // bolt / pump cycling
      }
    } else {
      this.burstLeft = 0;
    }
    if (!fireDown) this.shotCount = 0;

    // bloom: builds per shot, holds while spraying, snaps back (~0.2 s) once you ease off
    const spraying = fireDown && d.mode === 'auto' && this.shotCount > 0;
    this.bloom = damp(this.bloom, 0, spraying ? 3 : 14, dt);
    this.vm.setAds(this.ads);
  }

  tryReload() {
    const d = this.def;
    if (d.akimbo) return akimboTryReload(this);
    const a = this.curAmmo;
    if (!a || d.noReload) return;
    if (this.state !== 'idle' && this.state !== 'bolt') return;
    if (a.mag >= d.mag || a.reserve <= 0) return;
    this._stopLoops();
    if (d.reloadType === 'shell') {
      this._setState('shellReload');
      this.reloadPhase = 'start';
      this.reloadEmpty = a.mag === 0;
      this.vm.onReload(d, 'shellStart');
    } else {
      this.reloadEmpty = a.mag === 0;
      this.reloadDur = this.reloadEmpty ? d.reloadEmpty : d.reload;
      this._setState('reload');
      this.vm.onReload(d, 'mag', this.reloadDur, this.reloadEmpty);
      const snd = d.id === 'm9' ? 'pistol_reload' : d.id === 'm32' ? 'm32_reload' : null;
      if (snd) this.game.audio.play(snd, { volume: 0.8 });
    }
  }

  _updateMagReload() {
    const d = this.def;
    if (d.akimbo) return akimboReloadTick(this);
    const a = this.curAmmo;
    const T = this.reloadDur;
    const f = this.stateT / T;
    if (d.id !== 'm9') {
      if (!this.phaseDone.out && f > 0.12) {
        this.phaseDone.out = true;
        this.game.audio.play('m4_mag_out', { volume: 0.8 });
      }
      if (!this.phaseDone.in && f > 0.52) {
        this.phaseDone.in = true;
        this.game.audio.play('m4_mag_in', { volume: 0.9 });
      }
      if (this.reloadEmpty && !this.phaseDone.bolt && f > 0.8) {
        this.phaseDone.bolt = true;
        this.game.audio.play(d.id === 'l96a1' ? 'sniper_bolt' : 'm4_bolt', { volume: 0.8 });
      }
    }
    if (!this.phaseDone.ammo && f > 0.6) {
      this.phaseDone.ammo = true;
      const need = d.mag - a.mag;
      const take = Math.min(need, a.reserve);
      a.mag += take;
      a.reserve -= take;
    }
    if (f >= 1) this._setState('idle');
  }

  _updateShellReload(dt, firePressed) {
    const d = this.def;
    const a = this.curAmmo;
    if (this.reloadPhase === 'start') {
      if (this.stateT >= d.reloadStart) {
        this.reloadPhase = 'insert';
        this.stateT = 0;
        this.vm.onReload(d, 'shellInsert', d.shellTime);
      }
    } else if (this.reloadPhase === 'insert') {
      if (firePressed && a.mag > 0) {
        this.reloadPhase = 'end';
        this.stateT = 0;
        this.vm.onReload(d, 'shellEnd', d.reloadEnd, this.reloadEmpty);
        return;
      }
      if (!this.phaseDone.snd && this.stateT >= d.shellTime * 0.6) {
        this.phaseDone.snd = true;
        this.game.audio.play(d.id === 'm32' ? 'm4_mag_in' : 'shotgun_insert', { volume: 0.8 });
        a.mag++;
        a.reserve--;
      }
      if (this.stateT >= d.shellTime) {
        this.phaseDone.snd = false;
        this.stateT = 0;
        if (a.mag >= d.mag || a.reserve <= 0) {
          this.reloadPhase = 'end';
          this.vm.onReload(d, 'shellEnd', d.reloadEnd, this.reloadEmpty);
        } else {
          this.vm.onReload(d, 'shellInsert', d.shellTime);
        }
      }
    } else if (this.reloadPhase === 'end') {
      if (!this.phaseDone.pump && this.stateT >= d.reloadEnd * 0.3 && this.reloadEmpty) {
        this.phaseDone.pump = true;
        this.game.audio.play(d.id === 'm32' ? 'm32_reload' : 'shotgun_pump', { volume: 0.8 });
      }
      if (this.stateT >= d.reloadEnd) this._setState('idle');
    }
  }

  /** Full cone angle (deg) of the next round. The crosshair is drawn from this, so it never lies. */
  currentSpread() {
    const d = this.def;
    const p = this.player;
    if (d.spreadHip == null) return 0; // knife / throwables
    const moving = clamp(p.horizontalSpeed / 5, 0, 1);
    let s = d.spreadHip + (d.spreadAds - d.spreadHip) * this.ads;
    s += (moving + this.sprintK * 0.6) * d.spreadMove * (1 - this.ads * 0.6);
    s += this.airK * d.spreadAir;
    s *= 1 - 0.2 * this.crouchK;
    s += this.bloom * (1 - this.ads * 0.7);
    return s;
  }

  /**
   * HUD crosshair: the gap (px) is the live spread cone projected on screen (~86% of rounds land
   * inside it, see coneDirection). Fades out fast for ADS and while sprinting; shotguns get a ring.
   */
  crosshair(camera) {
    const d = this.def;
    const half = Math.tan((camera.fov * DEG) / 2) / (camera.zoom || 1);
    const px = (Math.tan((this.currentSpread() * DEG) / 2) / half) * (window.innerHeight / 2);
    return {
      visible: this.player.alive && d.mode !== 'grenade' && this.ads < 0.6,
      alpha: clamp(1 - this.ads / 0.45, 0, 1) * clamp(1 - this.sprintK * 1.4, 0, 1),
      spread: Math.max(3, px),
      style: d.pellets > 1 ? 'ring' : 'lines',
    };
  }

  /** One round (`side`: akimbo 0 = right gun, 1 = left gun). */
  _fire(dt = 0, side = 0) {
    const d = this.def;
    const a = this.curAmmo;
    const p = this.player;
    const game = this.game;
    const wind = d.rampRpm ? Math.min(1, this.shotCount / (d.rampShots ?? 12)) : 0;
    // carry the overshoot while the trigger is held (this round was due inside the frame), so the
    // average rate is exactly rpm; after a pause the clock simply restarts from now
    this.cooldown = (this.cooldown > -dt ? this.cooldown : 0) + 60 / (d.rampRpm ? d.rpm + (d.rampRpm - d.rpm) * wind : d.rpm);
    if (side) a.mag2--;
    else a.mag--;
    this.shotCount++;
    const spreadDeg = this.currentSpread();
    this.bloom = Math.min(d.spreadMax, this.bloom + d.spreadPerShot);

    // aim ray from the eye
    p.camera.getWorldDirection(_fwd);
    const origin = p.camera.position;
    this.vm.getMuzzleWorld(_muzzle, side);
    const tracer = d.tracerEvery > 0 && this.shotCount % d.tracerEvery === 0;
    if (d.projectile) {
      coneDirection(_fwd, spreadDeg * DEG * 0.5, _dir);
      game.launchProjectile(d, origin.clone().addScaledVector(_fwd, 0.4), _dir.clone(), p);
    } else {
      const dealt = game.hitAccum;
      for (let i = 0; i < d.pellets; i++) {
        coneDirection(_fwd, spreadDeg * DEG * 0.5, _dir);
        game.hitscan(origin, _dir, d, p, { tracerFrom: tracer || (d.pellets > 1 && i < 3) ? _muzzle : null, pellet: i });
      }
      // accuracy for the after-action report: a shot (all its pellets) hits if it damaged anything
      if (p.stats) {
        p.stats.shots = (p.stats.shots ?? 0) + 1;
        if (game.hitAccum > dealt) p.stats.hits = (p.stats.hits ?? 0) + 1;
      }
    }

    // feedback
    if (d.sound) game.audio.play(d.sound, { volume: 1 });
    if (d.id === 'chaingun' && !this.fireHandle) this.fireHandle = game.audio.play('minigun_fire', { loop: true, volume: 0.9 });
    game.lighting.muzzleFlash(_muzzle, d.pellets > 1 ? 1.4 : d.id === 'l96a1' ? 1.6 : 1);
    game.fx.muzzleSmoke(_muzzle, _fwd, d.pellets > 1 ? 1.5 : 0.6);
    // recoil: an instant kick on the aim (the player springs most of it back once you stop firing),
    // an aim-neutral camera punch, a sharp viewmodel punch and a thump of shake on the heavy hitters
    const vk = d.recoilV * (1 - this.ads * 0.3) * (1 - 0.2 * this.crouchK);
    const hk = (Math.random() * 2 - 1) * d.recoilH * (1 - this.ads * 0.3) + (d.akimbo ? (side ? 0.35 : -0.35) * d.recoilH : 0); // akimbo: each gun pulls to its side
    p.addRecoil(vk, hk, d.kick ?? 1);
    const sk = d.shake ?? d.kick * 0.02;
    game.shake.add(Math.min(sk, Math.max(0, sk * 2.5 - game.shake.trauma))); // sustained fire can't pile it up
    this.vm.onFire(d, side);
    this.sprintLock = 0.25;
    if (d.mode === 'bolt' || d.mode === 'pump') {
      this._setState('bolt');
    } else if (!d.noEject && d.shell && d.reloadType !== 'shell') {
      this._ejectShell(d.shell, 1, side);
    } else if (d.id === 'm4super90' || d.id === 'goldenPunisher') {
      this._ejectShell('shotgun', 1);
    }
    game.alertNoise(p.pos, d.id === 'l96a1' ? 45 : 30);
    if ((d.akimbo ? akimboRounds(a) : a.mag) === 0 && d.mode !== 'bolt' && d.mode !== 'pump' && !d.noReload) {
      // auto-reload after a short beat
      setTimeout(() => {
        if (this.def === d && this.state === 'idle' && (d.akimbo ? akimboRounds(this.curAmmo) : this.curAmmo.mag) === 0) this.tryReload();
      }, 250);
    }
  }

  _ejectShell(type, strength = 1, side = 0) {
    const cam = this.player.camera;
    const port = this.vm.getEjectWorld(new THREE.Vector3(), side);
    const right = new THREE.Vector3(side ? -1 : 1, 0, 0).applyQuaternion(cam.quaternion); // the mirrored left gun ejects left
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const v = right.multiplyScalar(rand(2.2, 3.2) * strength).addScaledVector(up, rand(1.6, 2.6)).addScaledVector(fwd, rand(-0.6, 0.4));
    v.add(this.player.body.vel);
    this.game.fx.shell(type, port, v);
  }

  hudInfo() {
    const d = this.def;
    const a = this.curAmmo;
    return {
      name: d.name,
      ammo: a ? a.mag : d.mode === 'grenade' ? this.grenades : 0,
      magSize: a ? d.mag : 1,
      reserve: a ? a.reserve : 0,
      showAmmo: d.mode !== 'melee' && d.mode !== 'build' && d.mode !== 'pour',
      reloading: this.state === 'reload' || this.state === 'shellReload',
      dual: d.akimbo && a ? { l: a.mag2 ?? 0, r: a.mag } : null, // akimbo: both guns' mags
    };
  }

  // ------------------------------------------------------------------ store (see game/shop.js)
  /** Def of any weapon id with its store upgrades applied (base def when not upgraded). */
  defOf(id) {
    const base = WEAPONS[id];
    const lv = this.upgrades?.[id];
    return lv && base ? effectiveDef(base, lv) : base;
  }

  upgradeLevel(id, key) {
    return this.upgrades?.[id]?.[key] ?? 0;
  }

  setUpgrade(id, key, level) {
    this.upgrades ??= {};
    this.upgrades[id] = { ...this.upgrades[id], [key]: level };
    // bigger mags come loaded
    const d = this.defOf(id);
    const a = this.ammo[id];
    if (key === 'mag' && a && d.mag) {
      a.mag = Math.max(a.mag, d.mag);
      if (a.mag2 != null) a.mag2 = Math.max(a.mag2, d.mag); // the akimbo left gun
      a.reserve = Math.max(a.reserve, d.reserve);
    }
  }

  /** Put an owned store weapon into its slot (0 primary / 6 backpack via giveWeapon, 1 secondary), fully loaded. */
  equipFromStore(id, slot = WEAPONS[id]?.slot === 1 ? 1 : 0) {
    if (!WEAPONS[id]) return false;
    const kept = this.ammo[id]?.reserve ?? 0; // reserve carried from an earlier stint
    if (slot === 0 || slot === PACK_SLOT) this.giveWeapon(id, slot);
    else this.slots[1] = id;
    const d = this.defOf(id);
    if (d.mag) this.ammo[id] = { mag: d.mag, mag2: d.mag, reserve: Math.max(kept, d.reserve) }; // mag2: an akimbo left gun
    if (slot === 1 && this.cur === 1) this.switchTo(1, true);
    return true;
  }

  /** Store ammo crate: carried guns to max reserve. `dry` only reports whether anything would change. */
  refillReserves(dry = false) {
    let changed = false;
    for (const id of this.slots) {
      const d = this.defOf(id);
      const a = this.ammo[id];
      if (!d || !d.mag || !a) continue;
      if (d.noReload) {
        if (a.mag < d.mag) changed = true;
        if (!dry) a.mag = Math.max(a.mag, d.mag);
        continue;
      }
      const max = d.maxReserve ?? d.reserve;
      if (a.reserve < max) changed = true;
      if (!dry) a.reserve = Math.max(a.reserve, max);
    }
    return changed;
  }
}
