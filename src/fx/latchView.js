// First person with a Biter on your back (actors/biter.js): the kid's own GLB body on the viewmodel layer,
// clinging behind your head with its clawed hands hooked over your shoulders, creeping in at the bottom
// corners of the screen (two-bone IK from teammate.js onto animated camera-space targets), raking with each
// bite and slipping outward as you shake it. Its head stays tucked behind your right ear: brought round into
// view, the kid's head and torso would fill half the screen. Plus the HUD: a blood vignette that throbs with
// every bite and the "SHAKE IT OFF — MASH [V]" prompt with its meter. The world-space Biter is hidden meanwhile.
import * as THREE from 'three';
import { createCharacter } from '../actors/rig.js';
import { reach } from '../actors/teammate.js';
import { poseClinging } from '../actors/biter.js';
import { VIEWMODEL_LAYER } from '../core/renderer.js';
import { clamp, damp, smoothstep } from '../core/utils.js';

const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const _qx = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _t = new THREE.Vector3();
const _p = new THREE.Vector3();
const _al = new THREE.Vector3();
const _pl = new THREE.Vector3();

// camera space (x right, y up, z back), meters: where the kid's mid-shoulders sit (right behind your head,
// a little to the right), where its wrists claw (the lower corners of the view; the arms are only ~0.32 m
// long) and which way its elbows point. Extra neck turn / pitch keeps its head out of view
const SHOULDERS = new THREE.Vector3(0.1, -0.15, 0.06);
const HAND = { L: new THREE.Vector3(-0.19, -0.05, -0.23), R: new THREE.Vector3(0.2, -0.04, -0.22) };
const POLE = { L: new THREE.Vector3(-1, 0.7, 0.4), R: new THREE.Vector3(1, 0.7, 0.4) };
const NECK = { x: -0.8, y: -1.5 }; // head tipped back and turned to its right (your right ear)
const HEAD = { x: 0.2, y: -0.3 };
const LEAN = 0.1;

export class LatchView {
  constructor(game) {
    this.game = game;
    this.k = 0; // presence 0..1 (creeps in / slips away)
    this.body = null; // viewmodel-layer Biter (built on the first latch), false when the GLB is missing
    this.flash = 0; // HUD pulse after a bite
    this.lastBite = 0;
    this._buildHud(game.hud?.root);
  }

  _buildHud(parent) {
    if (!parent) return;
    const el = document.createElement('div');
    el.className = 'cf-latch';
    el.innerHTML = '<div class="cf-latch-vig"></div><div class="cf-latch-box"><div class="cf-latch-t">SHAKE IT OFF <em>— MASH</em> <b class="cf-key">V</b></div><div class="cf-latch-bar"><i></i></div></div>';
    parent.appendChild(el);
    this.el = el;
    this.vig = el.querySelector('.cf-latch-vig');
    this.fill = el.querySelector('.cf-latch-bar i');
    this._on = false;
    this._fill = -1;
    this._vig = -1;
  }

  _body() {
    if (this.body !== null) return this.body;
    const c = createCharacter('biter', 1);
    if (c.glb !== 'biter') {
      this.body = false; // procedural fallback would be a full-size soldier: skip the effect
      return false;
    }
    c.root.traverse((o) => {
      o.layers.set(VIEWMODEL_LAYER);
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        o.frustumCulled = false;
      }
    });
    c.root.visible = false;
    this.game.scene.add(c.root);
    this.body = c;
    return c;
  }

  /** biter.js: the Biter let go of the player ('shaken', 'shot', 'dead', 'host', 'gone') */
  onRelease(why) {
    if (why === 'gone' || !this.game.running) {
      // cleared away (restart / quit): no fade
      this.k = 0;
      if (this.body) this.body.root.visible = false;
      this._hud(null, 0);
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    const z = p?.alive ? p.latchedBy : null;
    const info = g.running ? z?.latchInfo ?? null : null;
    this.k = damp(this.k, info ? 1 : 0, info ? 9 : 6, dt);
    if (info && info.bite > this.lastBite + 0.5) this.flash = 1; // a fresh bite
    this.lastBite = info?.bite ?? 0;
    this.flash = Math.max(0, this.flash - dt * 3);
    this._hud(info, dt);
    const body = info || this.k > 0.02 ? this._body() : this.body;
    if (!body) return;
    const show = this.k > 0.02 && !!p?.alive;
    body.root.visible = show;
    if (!show) return;
    this._pose(body, info, dt);
  }

  _hud(info, dt) {
    if (!this.el) return;
    const on = !!info;
    if (on !== this._on) {
      this._on = on;
      this.el.classList.toggle('on', on);
    }
    if (!on) return;
    const f = Math.round(clamp(info.meter, 0, 1) * 100) / 100;
    if (f !== this._fill) {
      this._fill = f;
      this.fill.style.transform = `scaleX(${f})`;
    }
    const v = Math.round(clamp(0.55 + this.flash * 0.4 + Math.sin(info.t * 5) * 0.05, 0, 1) * 40) / 40;
    if (v !== this._vig) {
      this._vig = v;
      this.vig.style.opacity = String(v);
    }
  }

  _pose(c, info, dt) {
    const cam = this.game.camera;
    const b = c.bones;
    const t = (this.t = (this.t ?? 0) + dt);
    const k = smoothstep(0, 1, this.k);
    const bite = info?.bite ?? 0, jolt = info?.jolt ?? 0, meter = info?.meter ?? 0;

    // body: pose the clinging stance, then place it so its shoulders sit behind yours
    poseClinging(b, t, bite, jolt, 7);
    b.neck.rotation.x += NECK.x - bite * 0.2;
    b.neck.rotation.y += NECK.y;
    b.head.rotation.x += HEAD.x;
    b.head.rotation.y += HEAD.y;
    // camera-facing: its +Z (forward) along the camera's -Z, leaning onto you
    _qx.setFromAxisAngle(X, LEAN + jolt * 0.1);
    c.root.quaternion.copy(cam.quaternion).multiply(_qy).multiply(_qx);
    c.root.position.copy(cam.position);
    c.root.updateMatrixWorld(true);
    // shoulder midpoint → its camera-space spot (sliding back and down while it creeps in / is thrown off)
    b.upperArmL.getWorldPosition(_a);
    b.upperArmR.getWorldPosition(_b);
    _a.add(_b).multiplyScalar(0.5);
    _t.copy(SHOULDERS);
    _t.x += Math.sin(t * 9) * 0.01 + jolt * Math.sin(t * 37) * 0.03;
    _t.y += -(1 - k) * 0.3;
    _t.z += (1 - k) * 0.25 + jolt * 0.04;
    _t.applyQuaternion(cam.quaternion).add(cam.position);
    c.root.position.add(_t.sub(_a));
    c.root.updateMatrixWorld(true);

    // hands: claws hooked over your shoulders, scratching at your chest; they slip outward as the meter fills
    for (const s of ['L', 'R']) {
      const sx = s === 'L' ? -1 : 1;
      const ph = t * (s === 'L' ? 6.1 : 5.4);
      _p.copy(HAND[s]);
      _p.x += sx * (Math.sin(ph) * 0.015 - bite * 0.03 + meter * 0.07 + jolt * 0.05 + (1 - k) * 0.2); // rakes in on a bite
      _p.y += Math.abs(Math.sin(ph * 0.83)) * 0.03 - bite * 0.035 - meter * 0.05 - (1 - k) * 0.25;
      _p.z += Math.cos(ph * 1.1) * 0.02 + bite * 0.03;
      _p.applyQuaternion(cam.quaternion).add(cam.position);
      _t.copy(POLE[s]).applyQuaternion(cam.quaternion);
      // fingers forward, down and in; palms down onto you
      _al.set(-sx * 0.3, -0.55, -1).normalize().applyQuaternion(cam.quaternion);
      _pl.set(0, -1, 0.35).normalize().applyQuaternion(cam.quaternion);
      reach(b['upperArm' + s], b['foreArm' + s], b['hand' + s], _p, _t, _al, _pl, c.hands[s]);
    }
    c.rig.sync();
  }
}
