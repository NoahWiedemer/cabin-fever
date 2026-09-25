// Barn fire: a rare round event. Every round has a BARN_FIRE.chance roll; on a hit a lightning bolt comes down
// on the barn roof at a random moment of that round (white flash, a crack right on top of you, sparks) and
// sets it alight. The fire front creeps over the roof (~0.45 m/s: the whole barn burns within 20-40 s), the
// hay in the loft and on the floor catches first and burns hottest, burning debris drops onto the loft floor.
//   Flames, embers and a thick smoke column (shared fx particle systems, capped per frame), flickering orange
//   light (2 of the pooled dynamic lights, lighting.flashAt), a roar + creaking timbers near the barn.
//   Burning hay and floor spots are Molotov fire zones (game.fires): they hurt anyone standing in them and set
//   the infected alight. The loft is no place to be.
//   The barn chars as the fire passes: its static geometry darkens vertex by vertex behind the fire front, the
//   barn's own materials (roof, gables, rafters, hay: materials.js barn*) blacken and glow with embers.
//   After a few minutes it burns out and smoulders, charred, for the rest of the game. A new game restores it.
// Debug: game.barnFire.force(delay) strikes `delay` s into this round (or the next one); .strike() right now.
import * as THREE from 'three';
import { BARN, LOFT, barnToWorld } from './ranchLayout.js';
import { getMaterial } from './materials.js';
import { clamp, rand } from '../core/utils.js';

export const BARN_FIRE = {
  chance: 0.02, // per round
  window: [10, 40], // s into the round
  spread: 0.45, // m/s: the fire front over the roof
  haySpread: 0.95, // m/s: hay catches from embers / falling debris
  roofBurn: [110, 170], // s a roof section burns
  hayBurn: [45, 75],
  floorBurn: [55, 90],
  fade: 22, // s a spot takes to die down
  charTime: 40, // s from catching to fully charred
  perFrame: { fire: 9, smoke: 2, ember: 3 }, // particle caps per frame
};

const BURN_DEF = { id: 'barnFire', damage: 40, fireTime: 3 }; // game._updateFires: zombies 40 dps (+ afterburn)
const HAY = [
  // loft (y = LOFT.y): stacks along the north wall, the south stacks, round bale, piles, loose bales
  [22.2, -7.1, 1.0], [23.8, -7.1, 1.0], [25.1, -6.8, 0.9], [24.6, -6.0, 0.7], [23.7, 3.2, 1.0], [22.3, 2.85, 0.9], [24.4, 1.1, 1.0],
  [25.3, 0.2, 0.7], [23.4, -2.2, 0.7], [22.3, -4.1, 0.7], [23.6, -4.6, 0.8],
].map(([x, z, r]) => ({ x, z, r, y: LOFT.y, kind: 'hay' }))
  .concat(
    // ground floor: bales under the loft, the round bale, stall straw, the pile by the east doors
    [[22.8, -7.2, 1.0], [22.5, 2.95, 0.9], [24.35, 3.3, 0.6], [28.5, 2.3, 0.8], [31.0, 2.3, 0.8], [33.6, 2.3, 0.8], [33.4, -3.9, 0.8], [28.4, -2.6, 0.7]].map(([x, z, r]) => ({ x, z, r, y: BARN.floor, kind: 'hay' }))
  );
const FLOOR_SPOTS = [[22.5, -5.8], [24.4, -4.2], [22.6, -1.6], [25.2, -2.0], [24.6, 2.4], [22.3, 0.6]].map(([x, z]) => ({ x, z, r: 0.9, y: LOFT.y, kind: 'floor' }));
const CHAR_MATS = { barnTin: 0.72, barnSheathing: 0.86, barnGable: 0.82, barnGableIn: 0.86, barnTimber: 0.86, barnBarge: 0.9, barnStraw: 0.93 };
const GLOW_MATS = { barnSheathing: 0.5, barnTimber: 0.45, barnGableIn: 0.3, barnStraw: 0.9, barnTin: 0.12, barnGable: 0.12 };
const CHAR_COL = new THREE.Color(0x0e0b09);
const EMBER_COL = new THREE.Color(0xff5a14);
const HALF = (BARN.z1 - BARN.z0) / 2;

/** outer roof surface height at z (gambrel) */
function roofY(z) {
  const dz = Math.abs(z - BARN.zc), kz = HALF - BARN.knee_in;
  if (dz <= kz) return BARN.ridge + ((BARN.knee - BARN.ridge) * dz) / kz;
  return BARN.knee + ((BARN.eave - BARN.knee) * (dz - kz)) / BARN.knee_in;
}

const _p = new THREE.Vector3();
const FO = { life: 0, size: 0, grow: 1.1, drag: 1.5, gravity: -1.8, color: [5, 2.5, 0.9], endColor: [1.0, 0.24, 0.05], rotV: 0 };
const SO = { life: 0, size: 0, grow: 1.4, drag: 0.6, gravity: -0.35, color: [0.2, 0.15, 0.12], endColor: [0.08, 0.075, 0.07], alpha: 0.5, fadeIn: 0.25, rotV: 0 }; // lit by the fire from below, cooling
const EO = { life: 0, size: 0, grow: 0, drag: 0.8, gravity: -0.6, color: [4.5, 1.7, 0.4] };
const cap = { fire: 0, smoke: 0, ember: 0 }; // this frame's particle budget

export class BarnFire {
  constructor(game) {
    this.game = game;
    // burnable spots: the roof (ridge, both slopes), hay, the loft floor
    const roof = [];
    for (let x = BARN.x0 + 0.9; x < BARN.x1 - 0.5; x += 1.75) {
      for (const dz of [0, -2.4, 2.4, -4.9, 4.9, -5.7, 5.7]) {
        const z = BARN.zc + dz;
        roof.push({ x: x + (dz ? 0.85 : 0), z, r: 1.0, y: roofY(z) + 0.06, kind: 'roof' });
      }
    }
    // spots are laid out in the barn's local frame (lx, lz); x, z are world (the barn is turned)
    this.sites = [...roof, ...HAY, ...FLOOR_SPOTS].map((s) => {
      const [x, z] = barnToWorld(s.x, s.z);
      return { ...s, lx: s.x, lz: s.z, x, z, ign: 0, burn: 0, I: 0, acc: [Math.random(), Math.random(), Math.random()], zone: null };
    });
    this.mats = Object.keys(CHAR_MATS).map((name) => {
      const m = getMaterial(name);
      // the ember glow re-uses the colour map: set it now so the shader isn't recompiled mid-game
      m.emissiveMap = m.map ?? null;
      m.emissive = new THREE.Color(0, 0, 0);
      m.needsUpdate = true;
      return { m, name, color: m.color.clone(), rough: m.roughness, char: CHAR_MATS[name], glow: GLOW_MATS[name] ?? 0 };
    });
    this._collectVertices();
    this.state = 'idle'; // idle | armed | burning | smoulder
    this.forceNext = false;
    this.T = 0;
    this.lightT = 0;
    this.creakT = 0;
    this.vcT = 0;
    this.snd = null;
  }

  /** the barn's static boxes (its own merged buckets, positions in the barn's local frame): vertices + colours */
  _collectVertices() {
    this.vc = [];
    for (const mesh of this.game.level?.barn?.buckets ?? []) {
      const g = mesh.geometry;
      const col = g?.attributes?.color, pos = g?.attributes?.position;
      if (!col || !pos || col.itemSize !== 3) continue;
      const idx = [];
      for (let i = 0; i < pos.count; i++) if (pos.getY(i) > -0.45) idx.push(i);
      if (!idx.length) continue;
      const I = Uint32Array.from(idx);
      const orig = new Float32Array(idx.length);
      const noise = new Float32Array(idx.length);
      for (let k = 0; k < idx.length; k++) {
        const i = idx[k];
        orig[k] = col.getX(i);
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        noise[k] = 0.62 + 0.34 * (0.5 + 0.5 * Math.sin(x * 3.7 + z * 2.9 + y * 5.3) * Math.cos(x * 1.3 - y * 2.1));
      }
      this.vc.push({ col, pos, idx: I, orig, noise, ign: new Float32Array(idx.length), lo: idx[0], hi: idx[idx.length - 1] });
    }
  }

  // ------------------------------------------------------------------ round hooks
  reset() {
    this._stopSound();
    for (const s of this.sites) {
      s.I = 0;
      s.zone = null;
    }
    for (const e of this.mats) {
      e.m.color.copy(e.color);
      e.m.roughness = e.rough;
      e.m.emissive.setRGB(0, 0, 0);
      e.m.emissiveIntensity = 1;
    }
    for (const v of this.vc) {
      for (let k = 0; k < v.idx.length; k++) {
        const i = v.idx[k], c = v.orig[k];
        v.col.setXYZ(i, c, c, c);
      }
      this._upload(v);
    }
    this.state = 'idle';
    this.forceNext = false;
    this.T = 0;
  }

  onRoundStart() {
    if (this.state !== 'idle') return; // once per game
    if (!this.forceNext && !(Math.random() < BARN_FIRE.chance)) return;
    this.forceNext = false;
    this.state = 'armed';
    this.strikeAt = rand(BARN_FIRE.window[0], BARN_FIRE.window[1]);
  }

  /** debug: strike `delay` s from now if a round is on, else early in the next round */
  force(delay = 2) {
    if (this.state === 'burning' || this.state === 'smoulder') return 'already burnt';
    if (this.game.state === 'combat') {
      this.state = 'armed';
      this.strikeAt = (this.game.roundTime ?? 0) + delay;
      return 'armed';
    }
    this.forceNext = true;
    return 'next round';
  }

  // ------------------------------------------------------------------ the strike
  strike() {
    const g = this.game;
    this.state = 'burning';
    this.T = 0;
    const z = BARN.zc + rand(-1.4, 1.4);
    const hitL = new THREE.Vector3(rand(BARN.x0 + 2.5, BARN.x1 - 3), roofY(z) + 0.05, z); // barn-local
    const [hx, hz] = barnToWorld(hitL.x, hitL.z);
    const hit = new THREE.Vector3(hx, hitL.y, hz);
    this.hit = hit;
    // ignition times: the front crawls over the roof, embers light the hay below well ahead of it
    for (const s of this.sites) {
      const d = Math.hypot(s.lx - hitL.x, s.y - hitL.y, s.lz - hitL.z);
      if (s.kind === 'roof') {
        s.ign = (d / BARN_FIRE.spread) * rand(0.8, 1.15);
        s.burn = rand(...BARN_FIRE.roofBurn);
      } else if (s.kind === 'hay') {
        s.ign = (d / BARN_FIRE.haySpread) * rand(0.8, 1.25) + (s.y < 1 ? 7 : 1.5);
        s.burn = rand(...BARN_FIRE.hayBurn);
      } else {
        s.ign = (d / BARN_FIRE.spread) * rand(0.7, 1.0) + 8;
        s.burn = rand(...BARN_FIRE.floorBurn);
      }
      s.I = 0;
    }
    for (const v of this.vc) {
      for (let k = 0; k < v.idx.length; k++) {
        const i = v.idx[k];
        const x = v.pos.getX(i), y = v.pos.getY(i), zz = v.pos.getZ(i);
        const d = Math.hypot(x - hitL.x, y - hitL.y, zz - hitL.z);
        v.ign[k] = (d / BARN_FIRE.spread) * (y < LOFT.y ? 1.25 : 1) * (0.85 + 0.3 * v.noise[k]);
      }
    }
    this.burnEnd = Math.max(...this.sites.map((s) => s.ign + s.burn)) + BARN_FIRE.fade;
    // the bolt: flash, crack right overhead, rolling thunder
    g.weather?.strikeAt(hit);
    const L = g.lighting;
    if (L) {
      L.lightningQueue.push({ at: 0, dur: 0.14, amp: 1.7 }, { at: 0.2, dur: 0.07, amp: 1.0 }, { at: 0.36, dur: 0.1, amp: 1.35 });
      L.flashAt(_p.copy(hit), 0xcfe0ff, 900, 0.35, 45);
    }
    g.audio?.play('lightning_crack', { position: hit, volume: 1 });
    g.audio?.thunder(1.35, 0.05);
    const dist = g.player ? g.player.pos.distanceTo(hit) : 30;
    g.shake?.add(clamp(1.1 - dist / 45, 0.15, 0.9));
    g.alertNoise?.(hit, 45);
    // sparks + a burst of flame and smoke where it hit
    const fx = g.fx;
    if (fx) {
      for (let i = 0; i < 40; i++) {
        EO.life = rand(0.6, 1.6);
        EO.size = rand(0.05, 0.12);
        EO.gravity = 6;
        fx.glow.emit(hit.x, hit.y + 0.1, hit.z, rand(-5, 5), rand(1, 7), rand(-5, 5), EO);
      }
      EO.gravity = -0.6;
      for (let i = 0; i < 16; i++) {
        FO.life = rand(0.4, 0.8);
        FO.size = rand(0.8, 1.6);
        fx.fire.emit(hit.x + rand(-0.6, 0.6), hit.y + 0.2, hit.z + rand(-0.6, 0.6), rand(-1, 1), rand(1.5, 3.5), rand(-1, 1), FO);
      }
    }
    g.hud?.banner('LIGHTNING STRUCK THE BARN', 'The barn is on fire · keep clear of the flames', 4, 'danger');
    this.snd = g.audio?.play('fire_roar', { position: hit, loop: true, volume: 0 }) ?? null;
  }

  // ------------------------------------------------------------------ per frame
  update(dt) {
    const g = this.game;
    if (this.state === 'armed') {
      if (g.state !== 'combat') this.state = 'idle'; // the round ended first: no strike this time
      else if ((g.roundTime ?? 0) >= this.strikeAt) this.strike();
      return;
    }
    if (this.state !== 'burning' && this.state !== 'smoulder') return;
    this.T += dt;
    const T = this.T;
    const fx = g.fx;
    cap.fire = BARN_FIRE.perFrame.fire;
    cap.smoke = BARN_FIRE.perFrame.smoke;
    cap.ember = BARN_FIRE.perFrame.ember;
    let total = 0, cx = 0, cy = 0, cz = 0, hot = null, hotI = 0, burning = 0;
    const smoulder = this.state === 'smoulder';
    for (const s of this.sites) {
      // intensity: catches over 4 s, burns, dies down over `fade` s
      const a = T - s.ign;
      let I = 0;
      if (!smoulder && a > 0) I = Math.min(1, a / 4) * (1 - clamp((a - s.burn) / BARN_FIRE.fade, 0, 1));
      s.I = I;
      if (I > 0.02) {
        burning++;
        total += I;
        cx += s.x * I;
        cy += s.y * I;
        cz += s.z * I;
        if (I * (0.6 + Math.random()) > hotI) (hotI = I), (hot = s);
      }
      // fire zones on the floors (hay, loft floor): Molotov damage in game._updateFires
      if (s.kind !== 'roof') this._zone(s, I);
      if (!fx) continue;
      const hay = s.kind === 'hay';
      const rate = s.kind === 'roof' ? [4, 0.8, 1.2] : hay ? [8, 0.7, 2.2] : [5, 0.4, 1.0]; // fire, smoke, embers per s
      const sm = smoulder && s.kind === 'roof' && Math.abs(s.x * 7 + s.z * 3) % 5 < 1 ? 0.35 : 0; // a few spots smoke on
      s.acc[0] += dt * rate[0] * I;
      s.acc[1] += dt * (rate[1] * I + sm);
      s.acc[2] += dt * rate[2] * I;
      while (s.acc[0] >= 1 && cap.fire > 0) {
        s.acc[0] -= 1;
        cap.fire--;
        const ang = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * s.r;
        FO.life = rand(0.45, 0.9) * (hay ? 1.2 : 1);
        FO.size = rand(0.7, 1.4) * (s.kind === 'roof' ? 1.35 : hay ? 1.15 : 0.9) * (0.6 + 0.4 * I);
        FO.rotV = rand(-1.5, 1.5);
        fx.fire.emit(s.x + Math.cos(ang) * rr, s.y + 0.05, s.z + Math.sin(ang) * rr, rand(-0.2, 0.2), rand(1.0, 2.2), rand(-0.2, 0.2), FO);
      }
      if (s.acc[0] > 3) s.acc[0] = 3;
      while (s.acc[1] >= 1 && cap.smoke > 0) {
        s.acc[1] -= 1;
        cap.smoke--;
        const inside = s.kind !== 'roof';
        SO.life = inside ? rand(2.5, 4) : rand(4.5, 7);
        SO.size = inside ? rand(0.8, 1.4) : rand(1.6, 3.0);
        SO.alpha = smoulder ? 0.3 : inside ? 0.35 : 0.6;
        SO.color[0] = smoulder ? 0.13 : 0.22;
        SO.color[1] = smoulder ? 0.125 : 0.16;
        SO.color[2] = smoulder ? 0.12 : 0.12;
        SO.rotV = rand(-0.3, 0.3);
        fx.smoke.emit(s.x + rand(-0.5, 0.5), s.y + (inside ? 1.2 : 0.6), s.z + rand(-0.5, 0.5), rand(0.1, 0.6), rand(1.2, 2.6) * (inside ? 0.5 : 1), rand(-0.1, 0.4), SO);
      }
      if (s.acc[1] > 3) s.acc[1] = 3;
      while (s.acc[2] >= 1 && cap.ember > 0) {
        s.acc[2] -= 1;
        cap.ember--;
        EO.life = rand(1.4, 3.0);
        EO.size = rand(0.04, 0.09);
        fx.glow.emit(s.x + rand(-s.r, s.r), s.y + rand(0.2, 1.0), s.z + rand(-s.r, s.r), rand(-0.5, 0.9), rand(1.5, 3.5), rand(-0.5, 0.6), EO);
      }
      if (s.acc[2] > 3) s.acc[2] = 3;
    }
    const heat = clamp(total / 10, 0, 1); // how big the fire is
    // flickering orange light: two of the pooled dynamic lights, alternating on the hottest spots
    this.lightT -= dt;
    if (hot && this.lightT <= 0) {
      this.lightT = rand(0.12, 0.2);
      _p.set(hot.x + rand(-0.4, 0.4), hot.y + (hot.kind === 'roof' ? -0.8 : 0.9), hot.z + rand(-0.4, 0.4));
      g.lighting?.flashAt(_p, 0xff7a2a, (70 + 140 * heat) * rand(0.8, 1.1), 0.4, 26);
    }
    // sound: roar at the heart of the fire, creaking timbers
    if (this.snd) {
      if (total > 0) this.snd.setPosition?.(_p.set(cx / total, cy / total, cz / total));
      this.snd.setVolume?.(Math.min(1, 0.25 + heat) * (total > 0.05 ? 1 : 0));
    }
    this.creakT -= dt;
    if (hot && this.creakT <= 0) {
      this.creakT = rand(2.5, 7);
      g.audio?.play('wood_creak', { position: _p.set(hot.x, hot.y, hot.z), volume: 0.5 + 0.4 * heat, pitch: rand(0.7, 0.95) });
    }
    // charring: materials follow the whole fire, the static geometry the front
    const charG = clamp(T / 70, 0, 1);
    const flick = 0.75 + 0.25 * Math.sin(T * 13) * Math.sin(T * 5.3 + 1);
    for (const e of this.mats) {
      const k = e.name === 'barnStraw' ? clamp(T / 55, 0, 1) : charG;
      e.m.color.copy(e.color).lerp(CHAR_COL, k * e.char);
      e.m.roughness = Math.min(1, e.rough + k * 0.2);
      e.m.emissive.copy(EMBER_COL).multiplyScalar(e.glow * heat * flick * (smoulder ? 0 : 1) * (e.name === 'barnStraw' ? 1 - 0.7 * k : Math.min(1, k * 2.5)));
    }
    this.vcT -= dt;
    if (this.vcT <= 0 && !smoulder) {
      this.vcT = 0.4;
      for (const v of this.vc) {
        for (let k = 0; k < v.idx.length; k++) {
          const c = clamp((T - v.ign[k]) / BARN_FIRE.charTime, 0, 1) * v.noise[k] * 0.95;
          const val = v.orig[k] * (1 - c);
          v.col.setXYZ(v.idx[k], val, val, val);
        }
        this._upload(v);
      }
    }
    if (this.state === 'burning' && (T > this.burnEnd || (burning === 0 && T > 30))) {
      this.state = 'smoulder';
      this._stopSound();
      for (const s of this.sites) this._zone(s, 0);
      g.hud?.banner?.('THE BARN BURNED OUT', 'It smoulders on', 3, 'normal');
    }
  }

  _zone(s, I) {
    const g = this.game;
    if (I > 0.25 && g.fires) {
      if (!s.zone || !g.fires.includes(s.zone)) {
        s.zone = { p: new THREE.Vector3(s.x, s.y, s.z), radius: s.r + 0.35, t: 2 * I, owner: null, def: BURN_DEF };
        g.fires.push(s.zone);
      }
      s.zone.t = 2 * I; // _updateFires: k = min(1, t / 2) = I
    } else if (s.zone) {
      s.zone.t = 0; // _updateFires drops it
      s.zone = null;
    }
  }

  _upload(v) {
    v.col.clearUpdateRanges?.();
    v.col.addUpdateRange?.(v.lo * 3, (v.hi - v.lo + 1) * 3);
    v.col.needsUpdate = true;
  }

  _stopSound() {
    this.snd?.stop?.(2.5);
    this.snd = null;
  }
}
