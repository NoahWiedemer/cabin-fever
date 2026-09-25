// Small math / helper utilities shared across the game.
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
export const dampAngle = (current, target, lambda, dt) => current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));

export function randomInSphere(out = new THREE.Vector3(), r = 1) {
  let x, y, z;
  do {
    x = Math.random() * 2 - 1;
    y = Math.random() * 2 - 1;
    z = Math.random() * 2 - 1;
  } while (x * x + y * y + z * z > 1);
  return out.set(x * r, y * r, z * r);
}

// Random direction inside a cone around `dir` with half-angle `angle` (radians).
const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
export function coneDirection(dir, angle, out = new THREE.Vector3()) {
  if (angle <= 0) return out.copy(dir);
  const up = Math.abs(dir.y) < 0.99 ? _t1.set(0, 1, 0) : _t1.set(1, 0, 0);
  const right = _t2.crossVectors(dir, up).normalize();
  const up2 = up.crossVectors(right, dir).normalize();
  // Gaussian-ish distribution (more hits near center)
  const r = Math.tan(angle) * Math.sqrt(-2 * Math.log(Math.max(1e-6, Math.random()))) * 0.5;
  const rr = Math.min(r, Math.tan(angle) * 1.6);
  const th = Math.random() * Math.PI * 2;
  out.copy(dir)
    .addScaledVector(right, Math.cos(th) * rr)
    .addScaledVector(up2, Math.sin(th) * rr)
    .normalize();
  return out;
}

// Ray vs sphere; returns distance or -1
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const thc = Math.sqrt(r2 - d2);
  let t = tca - thc;
  if (t < 0) t = tca + thc;
  return t < 0 ? -1 : t;
}

// Ray vs capsule (segment a-b, radius r). Returns distance or -1.
export function rayCapsule(o, d, a, b, r) {
  // Based on Inigo Quilez's capsule intersection
  const bax = b.x - a.x, bay = b.y - a.y, baz = b.z - a.z;
  const oax = o.x - a.x, oay = o.y - a.y, oaz = o.z - a.z;
  const baba = bax * bax + bay * bay + baz * baz;
  const bard = bax * d.x + bay * d.y + baz * d.z;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  const A = baba - bard * bard;
  let B = baba * rdoa - baoa * bard;
  let C = baba * oaoa - baoa * baoa - r * r * baba;
  let h = B * B - A * C;
  if (h >= 0) {
    const t = (-B - Math.sqrt(h)) / A;
    const y = baoa + t * bard;
    if (y > 0 && y < baba && t >= 0) return t;
    // caps
    const ocx = y <= 0 ? oax : o.x - b.x;
    const ocy = y <= 0 ? oay : o.y - b.y;
    const ocz = y <= 0 ? oaz : o.z - b.z;
    B = d.x * ocx + d.y * ocy + d.z * ocz;
    C = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
    h = B * B - C;
    if (h > 0) {
      const tc = -B - Math.sqrt(h);
      if (tc >= 0) return tc;
    }
  }
  return -1;
}

export class Pool {
  constructor(factory, size) {
    this.items = [];
    for (let i = 0; i < size; i++) this.items.push(factory(i));
    this.index = 0;
  }
  next() {
    const it = this.items[this.index];
    this.index = (this.index + 1) % this.items.length;
    return it;
  }
}

// Screen-shake "trauma" helper
export class Shake {
  constructor() {
    this.trauma = 0;
    this.t = 0;
  }
  add(v) {
    this.trauma = Math.min(1, this.trauma + v);
  }
  update(dt) {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
  }
  sample(seed) {
    const s = this.trauma * this.trauma;
    const t = this.t * 28;
    return s * (Math.sin(t * 1.3 + seed * 17.1) * 0.6 + Math.sin(t * 2.7 + seed * 3.3) * 0.4);
  }
}

export function formatScore(n) {
  return String(Math.max(0, Math.floor(n))).padStart(6, '0');
}
