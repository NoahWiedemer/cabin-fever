// Viewmodel side of akimbo (rules in player/akimbo.js): the second pistol, in the left hand.
// It is its own model instance under a holder mirrored across X, so the left gun is the right one's
// mirror image: it ejects to the left, and the mirrored left arm closes on its `rightHand` marker with
// the same firing grip the right hand uses (trigger finger and all). It has its own recoil springs,
// slide, muzzle flash and reload timing and draws a beat after the right gun; the shared motion (bob,
// sway, strafe roll, landing) is added in view space so both guns move as one pair.
import * as THREE from 'three';
import { buildWeaponModel } from './gunSafe.js';
import { VIEWMODEL_LAYER } from '../core/renderer.js';
import { clamp, smoothstep } from '../core/utils.js';
import { AKIMBO_RELOAD } from './akimbo.js';

function pulse(f, a, b, c, d) {
  if (f <= a || f >= d) return 0;
  if (f < b) return smoothstep(a, b, f);
  if (f <= c) return 1;
  return 1 - smoothstep(c, d, f);
}

export class AkimboRig {
  constructor(vm) {
    this.vm = vm;
    this.holder = new THREE.Group();
    this.holder.name = 'akimboLeft';
    this.holder.scale.x = -1;
    vm.pivot.add(this.holder);
    this.models = {};
    this.cur = null;
    this.key = null;
    // its own muzzle flash (the quads' geometry and materials are shared with the right gun's)
    this.flash = vm.flashGroup.clone(true);
    this.flash.visible = false;
    this.flashT = 0;
    this.flashDur = 0.045;
    this.flashS = 1;
    this.slideT = 1;
    this.recoilPos = new THREE.Vector3();
    this.recoilVel = new THREE.Vector3();
    this.recoilRot = new THREE.Vector3();
    this.recoilRotVel = new THREE.Vector3();
    this.base = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }; // hip + sprint, before the draw and state anims
    this.o = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }; // scratch offsets
  }

  _model(id) {
    if (id in this.models) return this.models[id];
    let m = null;
    try {
      m = buildWeaponModel(id);
      m.root.traverse((o) => {
        o.layers.set(VIEWMODEL_LAYER);
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = true;
          o.frustumCulled = false;
        }
      });
      m.root.visible = false;
      m.rest = {};
      for (const [k, p] of Object.entries(m.parts || {})) if (p) m.rest[k] = { pos: p.position.clone(), rot: p.rotation.clone(), vis: p.visible };
      this.holder.add(m.root);
    } catch (e) {
      console.warn('akimbo: left gun failed', id, e);
      m = null;
    }
    this.models[id] = m;
    return m;
  }

  equip(def) {
    const m = this._model(def.model);
    if (this.cur && this.cur !== m) this.cur.root.visible = false;
    this.cur = m;
    this.key = def.model;
    this.flash.visible = false;
    this.flashT = 0;
    this.slideT = 1;
    for (const v of [this.recoilPos, this.recoilVel, this.recoilRot, this.recoilRotVel]) v.set(0, 0, 0);
    if (!m) return;
    m.root.visible = true;
    this.resetParts(m);
    if (m.muzzle) m.muzzle.add(this.flash);
  }

  hide() {
    if (this.cur) this.cur.root.visible = false;
    this.cur = null;
    this.flash.visible = false;
  }

  resetParts(m) {
    for (const [k, r] of Object.entries(m.rest)) {
      const p = m.parts[k];
      p.position.copy(r.pos);
      p.rotation.copy(r.rot);
      p.visible = r.vis;
    }
  }

  get muzzle() {
    return this.cur?.muzzle ?? null;
  }
  get ejectPort() {
    return this.cur?.ejectPort || this.cur?.muzzle || null;
  }

  /** Left trigger: the same punch the right gun gets (Viewmodel.onFire), on this gun's own springs. */
  onFire(def) {
    const k = def.kick ?? 1;
    this.recoilPos.z = Math.min(0.06, this.recoilPos.z + 0.012 * k);
    this.recoilPos.y += 0.002 * k;
    this.recoilVel.z += 0.15 * k;
    this.recoilRot.x = Math.min(0.14, this.recoilRot.x + 0.02 * k);
    this.recoilRotVel.x += 0.25 * k;
    this.recoilRotVel.z += (Math.random() - 0.5) * 0.6 * k;
    this.recoilRotVel.y += (Math.random() - 0.5) * 0.3 * k;
    this.flashT = this.flashDur = def.pellets > 1 ? 0.06 : 0.045;
    this.flash.visible = !!this.cur;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    this.flashS = (def.pellets > 1 ? 1.5 : def.id === 'm9' ? 0.75 : 1) * (0.8 + Math.random() * 0.4);
    this.flash.scale.setScalar(this.flashS);
    this.slideT = 0;
  }

  /** Viewmodel.update: the pose both guns share before their own draw / reload offsets (right-gun space). */
  setBase(pos, rx, ry, rz) {
    const b = this.base;
    b.x = pos.x;
    b.y = pos.y;
    b.z = pos.z;
    b.rx = rx;
    b.ry = ry;
    b.rz = rz;
  }

  /**
   * One gun's akimbo reload (side 0 right, 1 left) at fraction f: pose offsets into a fresh `this.o`,
   * the gun's mag and slide posed, and the empty queued to fall into the world as it leaves the well.
   * Both guns flick the empties out together, then each dips out of view onto a fresh mag in turn.
   */
  reloadPose(f, side, anim, m, key) {
    const o = this.o;
    o.x = o.y = o.z = o.rx = o.ry = o.rz = 0;
    const R = AKIMBO_RELOAD;
    const P = m.parts || {};
    const drop = R.drop[side];
    const seat = R.seat[side];
    // mag release: a flick muzzle-up and outward so the empties fall clear of the hands
    const flick = pulse(f, 0, 0.06, drop + 0.02, drop + 0.12);
    o.rx += flick * 0.3;
    o.rz -= flick * 0.28;
    o.y += flick * 0.012;
    o.x += flick * 0.01;
    // dip: down and in, muzzle low, the magwell pushed onto a fresh mag at the belt, then back up
    const dip = pulse(f, seat - 0.17, seat - 0.03, seat + 0.01, seat + 0.17);
    o.y -= dip * 0.21;
    o.x -= dip * 0.035;
    o.z += dip * 0.05;
    o.rx -= dip * 0.9;
    o.rz += dip * 0.35;
    const jolt = pulse(f, seat, seat + 0.015, seat + 0.015, seat + 0.06);
    o.y += jolt * 0.012;
    o.rx += jolt * 0.05;
    if (P.mag && m.rest.mag) {
      if (f >= drop && !anim.dropped?.[side]) {
        (anim.dropped ??= [false, false])[side] = true;
        this.vm.dropMag(P.mag, key);
      }
      const fresh = f >= seat - 0.04; // the new one goes in at the bottom of the dip, out of view
      if (!fresh) P.mag.position.y = m.rest.mag.pos.y - smoothstep(drop - 0.05, drop, f) * 0.015; // eases out, then falls
      P.mag.visible = f < drop || fresh;
    }
    // an empty gun: slide locked back until it's up again, then the thumb drops the slide stop
    if (anim.empty?.[side] && P.slide && m.rest.slide) {
      const rel = R.slide[side];
      const locked = f < rel ? smoothstep(0, 0.04, f) : 1 - smoothstep(rel, rel + 0.025, f);
      P.slide.position.z = m.rest.slide.pos.z + locked * 0.035;
      o.rz -= pulse(f, rel - 0.03, rel, rel + 0.01, rel + 0.07) * 0.08;
    }
    return o;
  }

  /**
   * Pose the left gun (after the right one): its own draw, reload, slide and recoil in right-gun space,
   * mirrored into view space, plus `shared` (view space: x, y, pitch, yaw, roll). Returns the left
   * hand's grip target.
   */
  update(dt, def, st, anim, drawT, shared) {
    const m = this.cur;
    if (!m) return null;
    // recoil springs (same tuning as the right gun's)
    const stiff = 420, dampK = 26;
    const steps = Math.ceil(dt * 120);
    const h = steps > 0 ? dt / steps : 0;
    for (let i = 0; i < steps; i++) {
      this.recoilVel.addScaledVector(this.recoilPos, -stiff * h);
      this.recoilVel.multiplyScalar(Math.exp(-dampK * h));
      this.recoilPos.addScaledVector(this.recoilVel, h);
      this.recoilRotVel.addScaledVector(this.recoilRot, -stiff * h);
      this.recoilRotVel.multiplyScalar(Math.exp(-dampK * h));
      this.recoilRot.addScaledVector(this.recoilRotVel, h);
    }
    const b = this.base;
    let x = b.x, y = b.y, z = b.z, rx = b.rx, ry = b.ry, rz = b.rz;
    // draw: a beat behind the right gun
    if (drawT < 1) {
      const t = clamp((drawT - 0.15) / 0.85, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      y -= (1 - e) * 0.22;
      x += (1 - e) * 0.05;
      rx -= (1 - e) * 0.9;
      rz += (1 - e) * 0.3;
    }
    this.resetParts(m);
    const P = m.parts || {};
    this.slideT = Math.min(1, this.slideT + dt / 0.07);
    if (P.slide && m.rest.slide) P.slide.position.z = m.rest.slide.pos.z + Math.sin(this.slideT * Math.PI) * 0.035;
    if (anim && anim.kind === 'akimbo' && st === 'reload') {
      const o = this.reloadPose(clamp(anim.t / anim.dur, 0, 1), 1, anim, m, this.key);
      x += o.x;
      y += o.y;
      z += o.z;
      rx += o.rx;
      ry += o.ry;
      rz += o.rz;
    }
    // mirror image of that pose (see the holder's scale), then the motion both guns share
    const rp = this.recoilPos, rr = this.recoilRot;
    this.holder.position.set(-(x + rp.x) + shared.x, y + rp.y + shared.y, z + rp.z);
    this.holder.rotation.set(rx + rr.x + shared.pitch, -(ry + rr.y) + shared.yaw, -(rz + rr.z) + shared.roll);
    m.root.visible = true;
    if (this.flashT > 0) {
      this.flash.scale.setScalar(this.flashS * (0.55 + 0.45 * (this.flashT / this.flashDur)));
      this.flashT -= dt;
      if (this.flashT <= 0) this.flash.visible = false;
    }
    return m.rightHand;
  }
}
