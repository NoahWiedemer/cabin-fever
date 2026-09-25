// Bust secondary motion: one damped spring per side (see gltfCharacter.js addBust). Each jiggle bone
// lags its anchor on the chest joint in world space and is pulled back to it, so footstep bob,
// rifle recoil, jumps, hits and falls make it bounce and settle. Two springs per character, a few
// vector ops each: cheap.
import * as THREE from 'three';

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _v = new THREE.Vector3();
const _acc = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _chain = [];

const K = 780; // stiffness (1/s²): ~4.4 Hz
const C = 9.5; // damping (1/s): ζ ≈ 0.17, settles in well under a second
const UP = 1.8; // vertical response gain: the bounce reads best up and down
const MAX_ACC = 120; // clamp for frame spikes / teleports (m/s²)

export class Jiggle {
  /** chest: the joint the jiggle bones hang off; bones [L, R] with rest local positions; size: bust radius (m) */
  constructor(chest, bones, rests, size) {
    this.chest = chest;
    // the two sides are detuned a little so they never move in lockstep
    this.sides = bones.map((bone, i) => ({
      bone,
      rest: rests[i].clone(),
      k: K * (i ? 0.92 : 1.08),
      off: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      prev: new THREE.Vector3(),
      prevVel: new THREE.Vector3(),
    }));
    this.max = size * 0.5;
    this.primed = 0;
  }

  reset() {
    for (const s of this.sides) {
      s.off.set(0, 0, 0);
      s.vel.set(0, 0, 0);
      s.bone.position.copy(s.rest);
    }
    this.primed = 0;
  }

  /** world-space velocity impulse (m/s): recoil, hits */
  kick(x, y, z) {
    this.sides.forEach((s, i) => {
      const f = i ? 0.85 : 1.15;
      s.vel.x += x * f;
      s.vel.y += y * f;
      s.vel.z += z * f;
    });
  }

  update(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 1 / 20);
    // the chest's current world matrix: multiply up the parent chain ourselves, because r186's
    // updateWorldMatrix(true) does not refresh static (matrixAutoUpdate = false) ancestors
    _chain.length = 0;
    for (let o = this.chest; o; o = o.parent) _chain.push(o);
    const m = _m.identity();
    for (let i = _chain.length - 1; i >= 0; i--) {
      const o = _chain[i];
      if (o.matrixAutoUpdate) o.updateMatrix();
      m.multiply(o.matrix);
    }
    m.decompose(_p, _q, _s);
    _q.invert();
    const n = Math.ceil(dt * 240), h = dt / n;
    for (const s of this.sides) {
      const anchor = _a.copy(s.rest).applyMatrix4(m);
      _v.copy(anchor).sub(s.prev).divideScalar(dt);
      _acc.copy(_v).sub(s.prevVel).divideScalar(dt);
      s.prev.copy(anchor);
      s.prevVel.copy(_v);
      if (this.primed < 2) continue; // need two frames of history
      if (_acc.lengthSq() > MAX_ACC * MAX_ACC) _acc.setLength(MAX_ACC);
      _acc.y *= UP;
      // off'' = -k off - c off' - a(anchor), semi-implicit Euler substeps
      for (let i = 0; i < n; i++) {
        s.vel.x += (-s.k * s.off.x - C * s.vel.x - _acc.x) * h;
        s.vel.y += (-s.k * s.off.y - C * s.vel.y - _acc.y) * h;
        s.vel.z += (-s.k * s.off.z - C * s.vel.z - _acc.z) * h;
        s.off.addScaledVector(s.vel, h);
      }
      if (s.off.lengthSq() > this.max * this.max) {
        s.off.setLength(this.max);
        s.vel.multiplyScalar(0.5);
      }
      s.bone.position.copy(_v.copy(s.off).applyQuaternion(_q).divideScalar(_s.x)).add(s.rest);
    }
    this.primed++;
  }
}
