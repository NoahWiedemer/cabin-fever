// Spent magazines: when the local player reloads a magazine gun, the empty falls out of the viewmodel
// into the world (player/viewmodel.js hands over the mag part the moment it leaves the well) and stays
// on the floor for a while. A pooled clone of that gun's magazine (same geometry and materials, world
// layer) takes over at the same spot on screen, falls with a little of the player's momentum and a
// tumble, bounces off the collision world with a clack, settles flat, lies there LIE seconds and sinks
// away. At most MAX lie around (the oldest goes first); clones are reused per weapon, so a reload
// allocates nothing once each magazine type has dropped a few times.
import * as THREE from 'three';

const MAX = 16;
const LIE = 8; // seconds on the floor
const SINK = 1.2; // then sinks out of sight
const G = 9.8;
const DEG = Math.PI / 180;

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _dq = new THREE.Quaternion();
const _rm = new THREE.Matrix4();
const _box = new THREE.Box3();
const _W = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _hit = {};

const rand = (a, b) => a + Math.random() * (b - a);

export class MagDrops {
  constructor(scene, world, audio) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.pools = new Map(); // weapon model id -> instances
    this.live = []; // oldest first
  }

  _instance(src, key) {
    let pool = this.pools.get(key);
    if (!pool) this.pools.set(key, (pool = []));
    const free = pool.find((it) => !it.live);
    if (free) return free;
    // one more clone of this magazine for the pool: the viewmodel's geometry and materials, world layer
    const inner = src.clone(true);
    inner.position.set(0, 0, 0);
    inner.quaternion.identity();
    inner.scale.set(1, 1, 1);
    inner.visible = true;
    inner.traverse((o) => {
      o.layers.set(0);
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = true;
        o.frustumCulled = true;
      }
    });
    inner.updateMatrixWorld(true);
    _box.setFromObject(inner, true);
    if (_box.isEmpty()) _box.set(_v.set(-0.01, -0.05, -0.02), _d.set(0.01, 0.05, 0.02));
    const c = _box.getCenter(new THREE.Vector3());
    const h = _box.getSize(new THREE.Vector3()).multiplyScalar(0.5).toArray();
    inner.position.copy(c).negate(); // the pooled object's origin is the middle of the magazine
    const obj = new THREE.Group();
    obj.name = 'droppedMag';
    obj.add(inner);
    obj.visible = false;
    this.scene.add(obj);
    const order = [0, 1, 2].sort((a, b) => h[a] - h[b]);
    const it = {
      obj,
      c,
      h,
      thin: order[0], // lies on its broad side
      long: order[2],
      live: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      q: new THREE.Quaternion(),
      w: new THREE.Vector3(), // tumble (rad/s, world axes)
      q0: new THREE.Quaternion(),
      q1: new THREE.Quaternion(),
      t: 0,
      st: 'fall',
      stT: 0,
      floor: 0,
      bounces: 0,
      scale0: 1,
    };
    pool.push(it);
    return it;
  }

  /**
   * Drop the viewmodel mag `src` (an Object3D in the viewmodel, current world matrix) as weapon `key`'s
   * magazine. `cam` / `vmCam`: the world and viewmodel cameras (the viewmodel has its own lens, so the
   * hand-over re-projects to keep the mag on the same spot on screen); `vel`: the player's velocity.
   */
  drop(src, key, cam, vmCam, vel) {
    if (!src || !cam) return;
    while (this.live.length >= MAX) this._free(this.live[0]);
    const it = this._instance(src, key);
    src.updateWorldMatrix(true, false);
    src.matrixWorld.decompose(_p, _q, _s); // a mirrored (left-hand) gun only flips a symmetric mag
    _p.copy(it.c).applyMatrix4(src.matrixWorld);
    let k = 1;
    if (vmCam) {
      k = Math.tan((cam.fov * DEG) / 2) / (cam.zoom || 1) / Math.tan((vmCam.fov * DEG) / 2);
      _qi.copy(cam.quaternion).invert();
      _v.copy(_p).sub(cam.position).applyQuaternion(_qi);
      _v.x *= k;
      _v.y *= k;
      _p.copy(_v.applyQuaternion(cam.quaternion)).add(cam.position);
    }
    it.p.copy(_p);
    it.q.copy(_q);
    it.v.set(rand(-0.25, 0.25), rand(-1.5, -1.0), rand(-0.25, 0.25));
    if (vel) it.v.addScaledVector(_v.set(vel.x, Math.max(0, vel.y), vel.z), 0.5);
    it.w.set(rand(-7, 7), rand(-3, 3), rand(-7, 7));
    it.t = 0;
    it.st = 'fall';
    it.bounces = 0;
    it.scale0 = k; // matches the viewmodel's apparent size, eases to true size as it falls away
    it.live = true;
    it.obj.visible = true;
    this.live.push(it);
    this._apply(it);
  }

  _free(it) {
    it.live = false;
    it.obj.visible = false;
    const i = this.live.indexOf(it);
    if (i >= 0) this.live.splice(i, 1);
  }

  /** How far the magazine reaches below its middle at its current orientation. */
  _below(it, q) {
    _rm.makeRotationFromQuaternion(q);
    const e = _rm.elements;
    return it.h[0] * Math.abs(e[1]) + it.h[1] * Math.abs(e[5]) + it.h[2] * Math.abs(e[9]);
  }

  /** Resting orientation: broad side down, long axis kept on its current heading. */
  _flat(it, out) {
    _rm.makeRotationFromQuaternion(it.q);
    const e = _rm.elements;
    const n = it.thin, l = it.long, m = 3 - n - l;
    _W[n].set(0, e[4 * n + 1] >= 0 ? 1 : -1, 0);
    _W[l].set(e[4 * l], 0, e[4 * l + 2]);
    if (_W[l].lengthSq() < 1e-6) _W[l].set(Math.cos(it.t * 7), 0, Math.sin(it.t * 7));
    _W[l].normalize();
    _W[m].crossVectors(_W[(m + 1) % 3], _W[(m + 2) % 3]);
    _rm.makeBasis(_W[0], _W[1], _W[2]);
    return out.setFromRotationMatrix(_rm);
  }

  _fall(it, dt) {
    const p = it.p, v = it.v;
    v.y -= G * dt;
    // walls, crates and furniture sides: sweep the step and bounce off
    const len = v.length() * dt;
    let moved = false;
    if (len > 1e-5) {
      _d.copy(v).divideScalar(len / dt);
      const hit = this.world.raycast(p.x, p.y, p.z, _d.x, _d.y, _d.z, len + 0.02, null, _hit);
      const vn = hit && hit.ny === 0 ? v.x * hit.nx + v.z * hit.nz : 0;
      if (vn < 0) {
        p.addScaledVector(_d, Math.max(0, hit.t - 0.02)); // up to the face, then off it
        v.x -= 1.4 * vn * hit.nx;
        v.z -= 1.4 * vn * hit.nz;
        v.x *= 0.7;
        v.z *= 0.7;
        it.w.multiplyScalar(0.6);
        moved = true;
      }
    }
    if (!moved) p.addScaledVector(v, dt);
    const ang = it.w.length();
    if (ang > 1e-4) {
      _dq.setFromAxisAngle(_ax.copy(it.w).divideScalar(ang), ang * dt);
      it.q.premultiply(_dq).normalize();
    }
    const below = this._below(it, it.q);
    const g = this.world.groundHeight(p.x, p.z, 0.02, p.y + 0.05);
    if (p.y - below < g) {
      p.y = g + below;
      if (!it.bounces) this.audio?.play('mag_drop', { position: p, volume: 0.6 });
      it.bounces++;
      v.y = -v.y * 0.3;
      v.x *= 0.55;
      v.z *= 0.55;
      // the impact knocks it over rather than spinning it up
      it.w.multiplyScalar(0.45).add(_ax.set(rand(-3, 3), 0, rand(-3, 3)));
      if (it.bounces >= 3 || Math.abs(v.y) < 0.55) {
        it.st = 'settle';
        it.stT = 0;
        it.floor = g;
        it.q0.copy(it.q);
        this._flat(it, it.q1);
      }
    }
    if (p.y < -60 || it.t > 8) this._free(it); // fell out of the world
  }

  update(dt) {
    if (!this.live.length) return;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const it = this.live[i];
      if (!it) continue;
      it.t += dt;
      if (it.st === 'fall') {
        this._fall(it, dt);
        if (!it.live) continue;
      } else if (it.st === 'settle') {
        // rock down onto its side and slide to a stop
        it.stT += dt;
        const k = smooth(Math.min(1, it.stT / 0.16));
        it.q.slerpQuaternions(it.q0, it.q1, k);
        const f = Math.exp(-10 * dt);
        it.v.x *= f;
        it.v.z *= f;
        it.p.x += it.v.x * dt;
        it.p.z += it.v.z * dt;
        it.p.y = it.floor + this._below(it, it.q);
        if (k >= 1) {
          it.st = 'lie';
          it.stT = 0;
        }
      } else if (it.st === 'lie') {
        it.stT += dt;
        if (it.stT > LIE) {
          it.st = 'sink';
          it.stT = 0;
        }
      } else {
        it.stT += dt;
        it.p.y -= ((it.h[it.thin] * 2 + 0.01) / SINK) * dt;
        if (it.stT >= SINK) {
          this._free(it);
          continue;
        }
      }
      this._apply(it);
    }
  }

  _apply(it) {
    const o = it.obj;
    o.position.copy(it.p);
    o.quaternion.copy(it.q);
    const s = it.scale0 + (1 - it.scale0) * Math.min(1, it.t / 0.25);
    o.scale.setScalar(s);
  }

  /** New game: sweep the floor. */
  clear() {
    while (this.live.length) this._free(this.live[0]);
  }
}

const smooth = (x) => x * x * (3 - 2 * x);
