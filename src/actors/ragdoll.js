// Ragdoll deaths. On a share of kills (RAGDOLL.chance, far more for blasts, point-blank buckshot and heavy
// rounds) the body is thrown as a position-based ragdoll instead of playing the canned fall in zombie.js.
//   Solver (PBD): particles on the main joints (+ the head's center), bone-length sticks, one rigid torso
//   block (shape matching: pelvis, spine, chest, neck, shoulders, hips; a spine-jointed two-block torso
//   kept fighting wall / floor contacts when wedged), soft cone limits (neck, shoulders, hips, dog legs),
//   soft hinge limits (elbows, knees), a few self-collision pairs and sphere-vs-box contacts against the
//   collision world (swept + speculative faces, restitution, Coulomb friction), then damping that spares the
//   rigid motion. Fixed RAGDOLL.hz substeps, rendered interpolated between the last two.
//   Retarget: rig.js bodies and GLB proxies share bone names and an identity rest pose, so a bone's world
//   rotation maps its rest-pose (model space) vectors straight onto world vectors. Each driven bone gets
//   the rotation that turns its rest segment onto its particle segment (torso: the block's rotation;
//   upper arm / thigh: a full frame from the segment plus the elbow / knee hinge axis, so they twist with
//   the bend), then local = inv(parentWorld) * world; GLB bodies retarget from the proxies via rig.sync().
//   The dog gets a quadruped layout (rigid trunk, head, 3-segment legs).
// At most RAGDOLL.max bodies simulate; settled or old ones freeze in place (the corpse timer then sinks
// them). Purely visual: dead zombies never block bullets, players or navigation.
import * as THREE from 'three';
import { clamp, lerp, rand, smoothstep } from '../core/utils.js';
import { WEAPONS } from '../player/weaponDefs.js';

export const RAGDOLL = {
  chance: 0.2, // ordinary kills
  blast: [0.6, 1], // explosions: at the edge → at the center of the blast
  buckshot: { near: 3.5, far: 7, p: [0.55, 0.2] }, // pellet guns by distance to the shooter (never below `chance`)
  heavy: { l96a1: 0.5, sigma: 0.3, devotion: 0.3, chaingun: 0.3 }, // sniper / LMG rounds
  max: 6, // bodies simulated at once (4 on low quality)
  life: 6, // s: freeze even if still moving
  hz: 120, // substep rate
  iters: 8,
  gravity: 15,
  friction: 0.55,
  bounce: 0.18,
};

const HIP_Y = 0.98;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V3(), _b = V3(), _c = V3(), _d = V3(), _e = V3(), _f = V3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _eu = new THREE.Euler();
const IDQ = new THREE.Quaternion();

/** Chance (0..1) that this kill turns into a ragdoll. */
export function ragdollChance(z, source, opts = {}) {
  if (opts.burn) return 0;
  if (opts.explosion) return lerp(RAGDOLL.blast[0], RAGDOLL.blast[1], clamp(opts.blast ?? 0.5, 0, 1));
  let p = RAGDOLL.chance;
  const w = WEAPONS[opts.weapon];
  if (w?.pellets > 1 && source?.pos) {
    const { near, far, p: bp } = RAGDOLL.buckshot;
    const d = source.pos.distanceTo(z.pos);
    p = Math.max(p, d >= far ? 0 : lerp(bp[0], bp[1], clamp((d - near) / (far - near), 0, 1)));
  }
  return Math.max(p, RAGDOLL.heavy[opts.weapon] ?? 0);
}

/** Crushers burst into gore and Boomers blown up on the spot vanish at once: no body to throw. */
function eligible(z, opts) {
  if (z.typeName === 'crusher') return false;
  if (z.typeName === 'charger' && (opts.dynamiteShot || opts.explosion)) return false;
  return !!z.bones?.hips || !!(z.quad && z.bones?.root);
}

// ---------------------------------------------------------------- layouts
const depthOf = (o) => {
  let d = 0;
  for (let p = o; p; p = p.parent) d++;
  return d;
};

/** bone keys in hierarchy order, their parents and model-space (root-local, unscaled) rest positions */
function restModel(z) {
  const bones = z.bones;
  const keyOf = new Map(Object.entries(bones).map(([k, b]) => [b, k]));
  const keys = Object.keys(bones).sort((a, b) => depthOf(bones[a]) - depthOf(bones[b]));
  const M = {}, parent = {};
  for (const k of keys) {
    const b = bones[k];
    const pk = keyOf.get(b.parent) ?? null;
    parent[k] = pk;
    if (pk) M[k] = M[pk].clone().add(b.position);
    else {
      // root bone: GLB bodies hang it off a fixed 'base' offset; its own position is animated, use the rest
      const base = b.parent && b.parent !== z.mesh ? b.parent.position.clone() : V3();
      M[k] = base.add(z.rest?.[k] ?? V3(0, HIP_Y, 0));
    }
  }
  return { keys, parent, M };
}

const HUMAN = [
  // name, bone, mass, air drag (1/s: light extremities trail behind while flying)
  ['pelvis', 'hips', 4, 0.05], ['spine', 'spine', 3, 0.05], ['chest', 'chest', 4, 0.05], ['neck', 'neck', 1.2, 0.1], ['head', 'head', 1.8, 0.25],
  ['shL', 'upperArmL', 1.5, 0.1], ['elL', 'foreArmL', 1, 0.3], ['haL', 'handL', 0.6, 0.6],
  ['shR', 'upperArmR', 1.5, 0.1], ['elR', 'foreArmR', 1, 0.3], ['haR', 'handR', 0.6, 0.6],
  ['hiL', 'thighL', 2.2, 0.1], ['knL', 'shinL', 1.6, 0.25], ['ftL', 'footL', 1, 0.5],
  ['hiR', 'thighR', 2.2, 0.1], ['knR', 'shinR', 1.6, 0.25], ['ftR', 'footR', 1, 0.5],
];

/**
 * Elbow / knee limit. The allowed bend direction is measured against a reference that moves with the torso
 * block: legs use the block's own left-right axis (thigh twist is small), arms swing a T-pose frame onto the
 * upper arm (their range is too wide for a fixed axis; never singular inside the shoulder cone).
 */
function makeHinge(M, c, i, j, k, from, to, n0, b0, maxBend, maxAz, byAxis = false) {
  const r0 = M[to].clone().sub(M[from]).normalize();
  const n = n0 ? n0.clone().normalize() : r0.clone();
  const qn = new THREE.Quaternion().setFromUnitVectors(r0, n);
  const bend = b0.clone().addScaledVector(r0, -b0.dot(r0)).normalize(); // rest bend direction ⟂ segment
  const h0 = r0.clone().cross(bend).normalize(); // rest hinge axis
  const B0T = new THREE.Matrix4().makeBasis(r0, h0, r0.clone().cross(h0)).transpose();
  const b0n = bend.clone().applyQuaternion(qn);
  return { c, i, j, k, r0, n0: n, qn, b0n, h0, B0T, maxBend, maxAz, byAxis };
}

function humanLayout(z) {
  const { keys, parent, M } = restModel(z);
  const b = z.bones;
  const s0 = z.scale || 1; // hit radii are world sized for the type scale
  const part = (name, bone) => z.hitParts.find((p) => p.name === name && (!bone || p.bone === bone));
  const R = (p, def) => (p ? p.r / s0 : def);
  const head = part('head', b.head);
  const torsoR = R(part('torso'), 0.17);
  const rad = {
    pelvis: 0.72 * R(part('pelvis'), 0.16), spine: 0.62 * torsoR, chest: 0.7 * torsoR, neck: 0.05, head: 0.95 * R(head, 0.125),
    sh: 1.1 * R(part('arm', b.upperArmL), 0.065), el: R(part('arm', b.foreArmL), 0.06), ha: 0.045,
    hi: 0.9 * R(part('leg', b.thighL), 0.09), kn: R(part('leg', b.shinL), 0.07), ft: 0.06,
  };
  const headOff = head ? head.off.clone() : V3(0, 0.1, 0.01);
  const P = HUMAN.map(([name, key, mass, drag]) => ({
    key, mass, drag,
    off: name === 'head' ? headOff : V3(),
    rest: M[key].clone().add(name === 'head' ? headOff : V3()),
    r: rad[name] ?? rad[name.slice(0, 2)],
  }));
  const headDir = P[4].rest.clone().sub(P[3].rest);
  const hl = headDir.length() || 0.1;
  const X = V3(1, 0, 0), Z = V3(0, 0, 1);
  return {
    quad: false, keys, parent, M, P, rootKey: keys[0],
    clusters: [[0, 1, 2, 3, 5, 8, 11, 14]],
    sticks: [[3, 4], [5, 6], [6, 7], [8, 9], [9, 10], [11, 12], [12, 13], [14, 15], [15, 16]],
    pairs: [[7, 2], [10, 2], [7, 0], [10, 0], [6, 2], [9, 2], [6, 0], [9, 0], [7, 4], [10, 4], [7, 10], [12, 15], [13, 16]],
    cones: [
      { c: 0, i: 3, j: 4, axis: headDir.clone().add(V3(0, 0, 0.2 * hl)).normalize(), max: 0.9 },
      { c: 0, i: 5, j: 6, axis: V3(0.85, 0, 0.35).normalize(), max: 1.92 },
      { c: 0, i: 8, j: 9, axis: V3(-0.85, 0, 0.35).normalize(), max: 1.92 },
      { c: 0, i: 11, j: 12, axis: V3(0.15, -1, 0.4).normalize(), max: 1.3 },
      { c: 0, i: 14, j: 15, axis: V3(-0.15, -1, 0.4).normalize(), max: 1.3 },
    ],
    hinges: [
      // elbows swing from a T-pose neutral (never antiparallel within the shoulder cone), bend forward
      makeHinge(M, 0, 5, 6, 7, 'upperArmL', 'foreArmL', X, Z, 2.5, 1.6),
      makeHinge(M, 0, 8, 9, 10, 'upperArmR', 'foreArmR', V3(-1, 0, 0), Z, 2.5, 1.6),
      // knees bend backward, little twist
      makeHinge(M, 0, 11, 12, 13, 'thighL', 'shinL', null, V3(0, 0, -1), 2.6, 0.7, true),
      makeHinge(M, 0, 14, 15, 16, 'thighR', 'shinR', null, V3(0, 0, -1), 2.6, 0.7, true),
    ],
    headDir: headDir.normalize(),
    arm: ['L', 'R'].map((s, n) => ({ ua: 'upperArm' + s, fa: 'foreArm' + s, h: n, r0: M['hand' + s].clone().sub(M['foreArm' + s]).normalize(), j: 6 + 3 * n, k: 7 + 3 * n })),
    leg: ['L', 'R'].map((s, n) => ({ th: 'thigh' + s, sh: 'shin' + s, h: 2 + n, r0: M['foot' + s].clone().sub(M['shin' + s]).normalize(), j: 12 + 3 * n, k: 13 + 3 * n })),
  };
}

const LEGS = ['fL', 'fR', 'hL', 'hR'];

function dogLayout(z) {
  const { keys, parent, M } = restModel(z);
  const b = z.bones;
  const s0 = z.scale || 1;
  const part = (name, bone) => z.hitParts.find((p) => p.name === name && p.bone === bone);
  const R = (p, def) => (p ? p.r / s0 : def);
  const torsoR = R(part('torso', b.root), 0.14);
  const head = part('head', b.head);
  const headOff = head ? head.off.clone() : V3();
  const pivot = b.neck ? 'neck' : 'head';
  const P = [];
  const add = (key, mass, drag, r, off = V3()) => P.push({ key, mass, drag, r, off, rest: M[key].clone().add(off) }) - 1;
  add('root', 3, 0.05, 0.85 * torsoR);
  add('chest', 3, 0.05, 0.85 * torsoR);
  const upper = LEGS.map((l) => add(l[0] + 'Upper' + l[1], 1.2, 0.1, 0.07));
  add(pivot, 1, 0.15, 0.07);
  add('head', 1.3, 0.25, 0.9 * R(head, 0.1), headOff);
  const legs = LEGS.map((l, n) => {
    const k = (s) => l[0] + s + l[1];
    const lr = (s, d) => R(part('leg', b[k(s)]), d);
    const m = add(k('Mid'), 0.8, 0.3, lr('Upper', 0.05));
    const lo = add(k('Low'), 0.55, 0.4, lr('Mid', 0.045));
    const pw = add(k('Paw'), 0.35, 0.5, lr('Low', 0.04));
    const dir = (from, to) => M[to].clone().sub(M[from]).normalize();
    return { keys: [k('Upper'), k('Mid'), k('Low')], idx: [upper[n], m, lo, pw], r0: [dir(k('Upper'), k('Mid')), dir(k('Mid'), k('Low')), dir(k('Low'), k('Paw'))] };
  });
  const headDir = P[7].rest.clone().sub(P[6].rest).normalize();
  const sticks = [[6, 7]];
  for (const L of legs) sticks.push([L.idx[0], L.idx[1]], [L.idx[1], L.idx[2]], [L.idx[2], L.idx[3]]);
  return {
    quad: true, keys, parent, M, P, rootKey: 'root', pivot,
    clusters: [[0, 1, 2, 3, 4, 5, 6]],
    sticks,
    pairs: [],
    cones: [{ c: 0, i: 6, j: 7, axis: headDir, max: 0.95 }],
    hinges: [],
    headDir,
    legs,
  };
}

// ---------------------------------------------------------------- contacts
// Per particle and substep: a plane (n·p >= d) for every box the sphere (radius r) swept from o to p enters,
// overlaps or comes within MARGIN of (speculative: the constraints still move particles after detection).
const MARGIN = 0.12;
const C = { rd: null, i: 0, r: 0, ox: 0, oy: 0, oz: 0, px: 0, py: 0, pz: 0, minY: 0, maxY: 0 };

/** entry face of the segment o→p into the box grown by r: axis*2 + (sign > 0), or -1 */
function entryFace(b, r) {
  const ox = C.ox, oy = C.oy, oz = C.oz;
  const dx = C.px - ox, dy = C.py - oy, dz = C.pz - oz;
  let t0 = -Infinity, t1 = Infinity, ax = -1, sg = 0;
  for (let k = 0; k < 3; k++) {
    const o = k === 0 ? ox : k === 1 ? oy : oz;
    const d = k === 0 ? dx : k === 1 ? dy : dz;
    const lo = (k === 0 ? b.minX : k === 1 ? b.minY : b.minZ) - r;
    const hi = (k === 0 ? b.maxX : k === 1 ? b.maxY : b.maxZ) + r;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return -1;
      continue;
    }
    let ta = (lo - o) / d, tb = (hi - o) / d, s = -1;
    if (ta > tb) {
      const t = ta;
      ta = tb;
      tb = t;
      s = 1;
    }
    if (ta > t0) {
      t0 = ta;
      ax = k;
      sg = s;
    }
    if (tb < t1) t1 = tb;
  }
  if (ax < 0 || t0 < 0 || t0 > t1 || t0 > 1) return -1;
  // the grown box's corners are not part of the rounded sweep: require a real touch at the entry point
  const ex = ox + dx * t0, ey = oy + dy * t0, ez = oz + dz * t0;
  const cx = clamp(ex, b.minX, b.maxX) - ex, cy = clamp(ey, b.minY, b.maxY) - ey, cz = clamp(ez, b.minZ, b.maxZ) - ez;
  return cx * cx + cy * cy + cz * cz <= r * r * 1.1 ? ax * 2 + (sg > 0 ? 1 : 0) : -1;
}

function contactCb(b) {
  if (b.maxY < C.minY || b.minY > C.maxY) return;
  const r = C.r, rd = C.rd;
  const f = entryFace(b, r);
  if (f >= 0) {
    // entered during this step (also catches tunneling through thin walls)
    const ax = f >> 1, pos = f & 1;
    const lo = ax === 0 ? b.minX : ax === 1 ? b.minY : b.minZ;
    const hi = ax === 0 ? b.maxX : ax === 1 ? b.maxY : b.maxZ;
    const sg = pos ? 1 : -1;
    rd._addContact(C.i, ax === 0 ? sg : 0, ax === 1 ? sg : 0, ax === 2 ? sg : 0, pos ? hi + r : r - lo);
    return;
  }
  const px = C.px, py = C.py, pz = C.pz;
  let cx = clamp(px, b.minX, b.maxX), cy = clamp(py, b.minY, b.maxY), cz = clamp(pz, b.minZ, b.maxZ);
  let nx = px - cx, ny = py - cy, nz = pz - cz;
  let d2 = nx * nx + ny * ny + nz * nz;
  if (d2 > 1e-12) {
    // outside: touching or close, normal from the closest point. Only faces are speculative: an edge or
    // corner plane (e.g. the seam between two stacked wall boxes) would turn a push into the wall into a
    // push along it, so those count only on a real touch
    const faces = (nx !== 0) + (ny !== 0) + (nz !== 0);
    const R = faces > 1 ? r : r + MARGIN;
    if (d2 >= R * R) return;
  } else {
    // center ended inside: push back out toward where it came from
    const ox = C.ox, oy = C.oy, oz = C.oz;
    cx = clamp(ox, b.minX, b.maxX);
    cy = clamp(oy, b.minY, b.maxY);
    cz = clamp(oz, b.minZ, b.maxZ);
    nx = ox - cx;
    ny = oy - cy;
    nz = oz - cz;
    d2 = nx * nx + ny * ny + nz * nz;
    if (d2 <= 1e-12) {
      // started inside too: shallowest face
      let best = b.maxY - py, fx = 0, fy = 1, fz = 0, fd = b.maxY + r;
      if (py - b.minY < best) (best = py - b.minY), (fx = 0), (fy = -1), (fz = 0), (fd = r - b.minY);
      if (b.maxX - px < best) (best = b.maxX - px), (fx = 1), (fy = 0), (fz = 0), (fd = b.maxX + r);
      if (px - b.minX < best) (best = px - b.minX), (fx = -1), (fy = 0), (fz = 0), (fd = r - b.minX);
      if (b.maxZ - pz < best) (best = b.maxZ - pz), (fx = 0), (fy = 0), (fz = 1), (fd = b.maxZ + r);
      if (pz - b.minZ < best) (best = pz - b.minZ), (fx = 0), (fy = 0), (fz = -1), (fd = r - b.minZ);
      rd._addContact(C.i, fx, fy, fz, fd);
      return;
    }
  }
  const dl = Math.sqrt(d2);
  nx /= dl;
  ny /= dl;
  nz /= dl;
  rd._addContact(C.i, nx, ny, nz, nx * cx + ny * cy + nz * cz + r);
}

// ---------------------------------------------------------------- one body
const MAXC = 4; // contact planes per particle
const MAX_DV = 4; // m/s: most a particle may speed up in one substep through the constraints

class Ragdoll {
  constructor(sys, z, L) {
    this.sys = sys;
    this.z = z;
    this.L = L;
    const n = (this.n = L.P.length);
    this.x = new Float64Array(n * 3); // positions
    this.p = new Float64Array(n * 3); // predicted
    this.v = new Float64Array(n * 3); // velocities
    this.o = new Float64Array(n * 3); // positions at the start of the last substep (render interpolation)
    this.ip = new Float64Array(n * 3); // interpolated
    this.w = new Float64Array(n); // inverse masses as seen by joints / sticks (torso particles: their block's)
    this.m = new Float64Array(n);
    this.trunk = new Uint8Array(n); // torso-block members
    this.r = new Float64Array(n); // world radii
    this.dragF = new Float64Array(n);
    this.cn = new Float64Array(n * MAXC * 3); // contact normals
    this.cd = new Float64Array(n * MAXC); // plane offsets: n·p >= d
    this.cv = new Float64Array(n * MAXC); // normal velocity when the contact was found
    this.cc = new Uint8Array(n);
    this.restLen = new Float64Array(L.sticks.length);
    this.pairLen = new Float64Array(L.pairs.length);
    this.clusters = L.clusters.map((idx) => ({ idx, rest: new Float64Array(idx.length * 3), mass: 0, q: new THREE.Quaternion(), q0: new THREE.Quaternion(), qi: new THREE.Quaternion() }));
    // mapping: world rotation per bone key, driven flags, fixed locals for the rest
    this.K = Object.fromEntries(L.keys.map((k, i) => [k, i]));
    this.W = L.keys.map(() => new THREE.Quaternion());
    this.parentIdx = L.keys.map((k) => (L.parent[k] ? this.K[L.parent[k]] : -1));
    this.driven = new Uint8Array(L.keys.length);
    this.fixed = L.keys.map(() => null);
    this.boneList = L.keys.map((k) => z.bones[k]);
    this.rootP = V3();
  }

  /** capture the current pose, throw it */
  start(dir, source, opts) {
    const z = this.z, L = this.L, n = this.n;
    this.t = 0;
    this.sleepT = 0;
    this.thudT = 0;
    this.thuds = 0;
    this.grounded = false;
    this.landed = false;
    this.frozen = false;
    this.pooled = false;
    this.s = z.root.scale.x;
    const s = this.s;
    z.root.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      const P = L.P[i];
      _a.copy(P.off).applyMatrix4(z.bones[P.key].matrixWorld);
      this.x[i * 3] = _a.x;
      this.x[i * 3 + 1] = _a.y;
      this.x[i * 3 + 2] = _a.z;
      this.m[i] = P.mass;
      this.w[i] = 1 / P.mass;
      this.r[i] = P.r * s;
      this.dragF[i] = Math.exp(-P.drag / RAGDOLL.hz);
    }
    this.M = this.m.reduce((a, b) => a + b, 0);
    this.trunk.fill(0);
    for (const c of L.clusters) for (const i of c) this.trunk[i] = 1;
    for (let k = 0; k < L.sticks.length; k++) {
      const [i, j] = L.sticks[k];
      this.restLen[k] = L.P[i].rest.distanceTo(L.P[j].rest) * s;
    }
    for (let k = 0; k < L.pairs.length; k++) {
      const [i, j] = L.pairs[k];
      this.pairLen[k] = (L.P[i].r + L.P[j].r) * s * 0.9;
    }
    // rigid blocks: rest offsets around the rest centroid, rotation fitted to the current pose
    for (let ci = 0; ci < this.clusters.length; ci++) {
      const c = this.clusters[ci];
      let M = 0;
      _a.set(0, 0, 0);
      for (const i of c.idx) {
        _a.addScaledVector(L.P[i].rest, L.P[i].mass);
        M += L.P[i].mass;
      }
      _a.multiplyScalar(1 / M);
      c.mass = M;
      c.idx.forEach((i, k) => {
        _b.copy(L.P[i].rest).sub(_a).multiplyScalar(s);
        c.rest[k * 3] = _b.x;
        c.rest[k * 3 + 1] = _b.y;
        c.rest[k * 3 + 2] = _b.z;
      });
      for (const i of c.idx) this.w[i] = Math.min(this.w[i], 1 / M); // a joint tugging a torso particle moves the block
      z.bones[L.P[c.idx[0]].key].getWorldQuaternion(c.q); // warm start: hips / dog root
      this.p.set(this.x);
      this._match(c, 24);
      this.x.set(this.p);
      c.q0.copy(c.q);
    }
    // settle the limbs onto their bone lengths before the throw
    this.p.set(this.x);
    for (let it = 0; it < 4; it++) this._sticks();
    this.x.set(this.p);
    this.o.set(this.x);

    // ---- throw: along the shot (away from a blast), lifted, tumbling
    let hx = dir?.x ?? 0, hz = dir?.z ?? 0;
    if (hx * hx + hz * hz < 1e-4 && source?.pos) {
      hx = z.pos.x - source.pos.x;
      hz = z.pos.z - source.pos.z;
    }
    let hl = Math.hypot(hx, hz);
    if (hl < 1e-4) {
      const a = Math.random() * Math.PI * 2;
      hx = Math.cos(a);
      hz = Math.sin(a);
      hl = 1;
    }
    hx /= hl;
    hz /= hl;
    const w = WEAPONS[opts.weapon];
    let H, U, spin;
    if (opts.explosion) {
      const k = clamp(opts.blast ?? 0.6, 0, 1);
      H = lerp(6, 10, k) * rand(0.9, 1.1);
      U = lerp(4.5, 7.5, k) * rand(0.9, 1.1);
      spin = rand(3, 7) * (Math.random() < 0.5 ? -1 : 1);
    } else if (w?.pellets > 1) {
      const d = source?.pos ? source.pos.distanceTo(z.pos) : 5;
      H = lerp(12, 7, clamp((d - 1) / 6, 0, 1));
      U = rand(3.5, 4.5);
      spin = rand(5, 7);
    } else if (opts.weapon === 'l96a1') {
      H = rand(10, 12);
      U = rand(3.5, 4.5);
      spin = rand(6, 8);
    } else if (RAGDOLL.heavy[opts.weapon]) {
      H = rand(8, 9.5);
      U = rand(3, 4);
      spin = rand(4.5, 6);
    } else if (opts.weapon === 'knife') {
      H = rand(4.5, 6);
      U = rand(2.5, 3.2);
      spin = rand(2.5, 3.5);
    } else {
      H = rand(6.5, 9);
      U = rand(3, 4.5);
      spin = rand(4, 6);
    }
    if (!opts.explosion) {
      const part = z.lastPart;
      if (opts.headshot || part === 'head') spin *= 1.5; // snapped back by the head
      else if (part === 'leg') spin *= -1; // legs swept out from under it
      else if (part === 'pelvis') spin *= 0.4;
    }
    const mk = 1 / Math.sqrt(z.type.mass ?? 1); // light dogs / strikers fly further
    H *= mk;
    spin *= mk;
    const bv = z.body.vel;
    const vx = hx * H + bv.x * 0.5, vy = U + Math.max(0, bv.y), vz = hz * H + bv.z * 0.5;
    // spin: tip over along the throw (cross(up, dir)), plus some yaw and roll
    const yaw = rand(-2.5, 2.5), roll = rand(-2, 2);
    const wx = hz * spin + hx * roll, wy = yaw, wz = -hx * spin + hz * roll;
    let cx = 0, cy = 0, cz = 0, M = 0;
    for (let i = 0; i < n; i++) {
      cx += this.x[i * 3] * this.m[i];
      cy += this.x[i * 3 + 1] * this.m[i];
      cz += this.x[i * 3 + 2] * this.m[i];
      M += this.m[i];
    }
    cx /= M;
    cy /= M;
    cz /= M;
    for (let i = 0; i < n; i++) {
      const rx = this.x[i * 3] - cx, ry = this.x[i * 3 + 1] - cy, rz = this.x[i * 3 + 2] - cz;
      const flail = L.P[i].drag * 3; // hands / feet / head get a random kick of their own
      this.v[i * 3] = vx + wy * rz - wz * ry + rand(-flail, flail);
      this.v[i * 3 + 1] = vy + wz * rx - wx * rz + rand(-flail, flail);
      this.v[i * 3 + 2] = vz + wx * ry - wy * rx + rand(-flail, flail);
    }

    // ---- mapping setup
    this.driven.fill(0);
    this.fixed.fill(null);
    const K = this.K;
    const drive = (...keys) => keys.forEach((k) => K[k] != null && (this.driven[K[k]] = 1));
    const fix = (k, x, y, zz) => K[k] != null && (this.fixed[K[k]] = new THREE.Quaternion().setFromEuler(_eu.set(x, y, zz)));
    if (L.quad) {
      drive('root', L.pivot, ...L.legs.flatMap((l) => l.keys));
      fix('jaw', -0.3, 0, 0);
      fix('tail0', -0.25, rand(-0.4, 0.4), 0);
    } else {
      drive('hips', 'spine', 'chest', 'neck', 'upperArmL', 'foreArmL', 'upperArmR', 'foreArmR', 'thighL', 'shinL', 'thighR', 'shinR');
      fix('head', 0, rand(-0.5, 0.5), rand(-0.25, 0.25));
      fix('handL', rand(0.2, 0.6), 0, 0);
      fix('handR', rand(0.2, 0.6), 0, 0);
      fix('footL', rand(0.3, 0.6), 0, 0);
      fix('footR', rand(0.3, 0.6), 0, 0);
    }
    // the root keeps its rest offset; everything below is rotation only
    const rb = z.bones[L.rootKey];
    rb.position.copy(z.rest?.[L.rootKey] ?? V3(0, HIP_Y, 0));
    this.rootP.copy(L.M[L.rootKey]).multiplyScalar(s);
    z.mesh.position.set(0, 0, 0);
    this.pose(0);
  }

  // ---------------------------------------------------------------- solver
  step(h, world) {
    const n = this.n, x = this.x, p = this.p, v = this.v;
    this.t += h;
    this.thudT -= h;
    this.o.set(x);
    for (const c of this.clusters) c.q0.copy(c.q);
    const gh = RAGDOLL.gravity * h;
    for (let i = 0; i < n; i++) {
      const f = this.dragF[i];
      v[i * 3] *= f;
      v[i * 3 + 1] = (v[i * 3 + 1] - gh) * f;
      v[i * 3 + 2] *= f;
      p[i * 3] = x[i * 3] + v[i * 3] * h;
      p[i * 3 + 1] = x[i * 3 + 1] + v[i * 3 + 1] * h;
      p[i * 3 + 2] = x[i * 3 + 2] + v[i * 3 + 2] * h;
    }
    this._collide(world);
    for (let it = 0; it < RAGDOLL.iters; it++) {
      this._sticks();
      for (const c of this.clusters) this._match(c, 2);
      for (const c of this.L.cones) this._cone(c);
      for (const hg of this.L.hinges) this._hinge(hg);
      if (this.L.legs) this._dogLegs();
      this._pairs();
      this._contacts();
    }
    this._velocities(h);
  }

  _sticks() {
    const p = this.p, w = this.w, S = this.L.sticks;
    for (let k = 0; k < S.length; k++) {
      const i = S[k][0] * 3, j = S[k][1] * 3;
      const dx = p[j] - p[i], dy = p[j + 1] - p[i + 1], dz = p[j + 2] - p[i + 2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const wi = w[S[k][0]], wj = w[S[k][1]];
      if (len < 1e-9 || wi + wj <= 0) continue;
      const f = (len - this.restLen[k]) / (len * (wi + wj));
      p[i] += dx * f * wi;
      p[i + 1] += dy * f * wi;
      p[i + 2] += dz * f * wi;
      p[j] -= dx * f * wj;
      p[j + 1] -= dy * f * wj;
      p[j + 2] -= dz * f * wj;
    }
  }

  /** shape matching: best-fit rotation (Müller et al. 2016, warm started), then snap to the rigid goals */
  _match(c, iters) {
    const p = this.p, m = this.m, idx = c.idx, r = c.rest;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3, mi = m[idx[k]];
      cx += p[i] * mi;
      cy += p[i + 1] * mi;
      cz += p[i + 2] * mi;
    }
    cx /= c.mass;
    cy /= c.mass;
    cz /= c.mass;
    // A = Σ m (p - c) r^T, stored by columns
    let a00 = 0, a10 = 0, a20 = 0, a01 = 0, a11 = 0, a21 = 0, a02 = 0, a12 = 0, a22 = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3, mi = m[idx[k]];
      const qx = (p[i] - cx) * mi, qy = (p[i + 1] - cy) * mi, qz = (p[i + 2] - cz) * mi;
      const rx = r[k * 3], ry = r[k * 3 + 1], rz = r[k * 3 + 2];
      a00 += qx * rx; a10 += qy * rx; a20 += qz * rx;
      a01 += qx * ry; a11 += qy * ry; a21 += qz * ry;
      a02 += qx * rz; a12 += qy * rz; a22 += qz * rz;
    }
    const q = c.q;
    for (let it = 0; it < iters; it++) {
      // rotation columns
      const { x, y, z, w } = q;
      const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + z * w), r20 = 2 * (x * z - y * w);
      const r01 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + x * w);
      const r02 = 2 * (x * z + y * w), r12 = 2 * (y * z - x * w), r22 = 1 - 2 * (x * x + y * y);
      let ox = r10 * a20 - r20 * a10 + (r11 * a21 - r21 * a11) + (r12 * a22 - r22 * a12);
      let oy = r20 * a00 - r00 * a20 + (r21 * a01 - r01 * a21) + (r22 * a02 - r02 * a22);
      let oz = r00 * a10 - r10 * a00 + (r01 * a11 - r11 * a01) + (r02 * a12 - r12 * a02);
      const den = Math.abs(r00 * a00 + r10 * a10 + r20 * a20 + r01 * a01 + r11 * a11 + r21 * a21 + r02 * a02 + r12 * a12 + r22 * a22) + 1e-9;
      ox /= den;
      oy /= den;
      oz /= den;
      const ang = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (ang < 1e-9) break;
      _a.set(ox / ang, oy / ang, oz / ang);
      _qa.setFromAxisAngle(_a, ang);
      q.premultiply(_qa).normalize();
    }
    // goals
    const { x, y, z, w } = q;
    const r00 = 1 - 2 * (y * y + z * z), r10 = 2 * (x * y + z * w), r20 = 2 * (x * z - y * w);
    const r01 = 2 * (x * y - z * w), r11 = 1 - 2 * (x * x + z * z), r21 = 2 * (y * z + x * w);
    const r02 = 2 * (x * z + y * w), r12 = 2 * (y * z - x * w), r22 = 1 - 2 * (x * x + y * y);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k] * 3;
      const rx = r[k * 3], ry = r[k * 3 + 1], rz = r[k * 3 + 2];
      p[i] = cx + r00 * rx + r01 * ry + r02 * rz;
      p[i + 1] = cy + r10 * rx + r11 * ry + r12 * rz;
      p[i + 2] = cz + r20 * rx + r21 * ry + r22 * rz;
    }
  }

  /** shift particle j by d and its partner i the opposite way, in inverse-mass proportion */
  _move(i, j, dx, dy, dz) {
    const wi = this.w[i], wj = this.w[j], s = wi + wj;
    if (s <= 0) return;
    const kj = wj / s, ki = wi / s, p = this.p;
    p[j * 3] += dx * kj;
    p[j * 3 + 1] += dy * kj;
    p[j * 3 + 2] += dz * kj;
    p[i * 3] -= dx * ki;
    p[i * 3 + 1] -= dy * ki;
    p[i * 3 + 2] -= dz * ki;
  }

  /** keep segment i→j within `max` rad of the world axis `ax` */
  _coneTo(i, j, ax, max) {
    const p = this.p;
    let dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return;
    dx /= len;
    dy /= len;
    dz /= len;
    const cm = Math.cos(max);
    const c = dx * ax.x + dy * ax.y + dz * ax.z;
    if (c >= cm) return;
    _e.set(dx - ax.x * c, dy - ax.y * c, dz - ax.z * c);
    if (_e.lengthSq() < 1e-10) _e.set(1, 0, 0).cross(ax);
    if (_e.lengthSq() < 1e-10) _e.set(0, 1, 0).cross(ax);
    _e.normalize();
    const sm = Math.sin(max), K = 0.6;
    const tx = (ax.x * cm + _e.x * sm) * len, ty = (ax.y * cm + _e.y * sm) * len, tz = (ax.z * cm + _e.z * sm) * len;
    this._move(i, j, (p[i * 3] + tx - p[j * 3]) * K, (p[i * 3 + 1] + ty - p[j * 3 + 1]) * K, (p[i * 3 + 2] + tz - p[j * 3 + 2]) * K);
  }

  _cone(c) {
    _f.copy(c.axis).applyQuaternion(this.clusters[c.c].q);
    this._coneTo(c.i, c.j, _f, c.max);
  }

  /** elbow / knee: bend angle ≤ maxBend, bend direction within ±maxAz of the untwisted rest bend */
  _hinge(H) {
    const p = this.p, i = H.i * 3, j = H.j * 3, k = H.k * 3;
    const a = _a.set(p[j] - p[i], p[j + 1] - p[i + 1], p[j + 2] - p[i + 2]);
    if (a.lengthSq() < 1e-12) return;
    a.normalize();
    const bref = this._bendRef(H, this.clusters[H.c].q, a, _b);
    const cax = _c.copy(a).cross(bref);
    const f = _d.set(p[k] - p[j], p[k + 1] - p[j + 1], p[k + 2] - p[j + 2]);
    const lf = f.length();
    if (lf < 1e-6) return;
    f.multiplyScalar(1 / lf);
    const fa = f.dot(a);
    const px = f.dot(bref), py = f.dot(cax);
    const st = Math.hypot(px, py);
    const th = Math.atan2(st, fa);
    let th2 = Math.min(th, H.maxBend);
    let ph = st > 1e-5 ? Math.atan2(py, px) : 0;
    let ph2 = clamp(ph, -H.maxAz, H.maxAz);
    if (ph2 !== ph && Math.sin(th) * Math.sin((Math.abs(ph) - H.maxAz) / 2) >= Math.sin(th / 2)) {
      // bent the wrong way by more than it is bent: straightening is the closer fix
      th2 = 0;
      ph2 = ph;
    }
    if (th2 === th && ph2 === ph) return;
    const sn = Math.sin(th2), cs = Math.cos(th2);
    const cp = Math.cos(ph2), sp = Math.sin(ph2);
    const tx = (a.x * cs + (bref.x * cp + cax.x * sp) * sn) * lf;
    const ty = (a.y * cs + (bref.y * cp + cax.y * sp) * sn) * lf;
    const tz = (a.z * cs + (bref.z * cp + cax.z * sp) * sn) * lf;
    const K = 0.6; // soft: a violated limit is eased back over the iterations instead of snapped
    this._move(H.j, H.k, (p[j] + tx - p[k]) * K, (p[j + 1] + ty - p[k + 1]) * K, (p[j + 2] + tz - p[k + 2]) * K);
  }

  /** out = the allowed bend direction (⟂ segment a) for hinge H under the block rotation q */
  _bendRef(H, q, a, out) {
    if (H.byAxis) {
      // hinge axis = the block's axis made ⟂ to the segment; bend = axis × segment
      _f.copy(H.h0).applyQuaternion(q);
      _f.addScaledVector(a, -_f.dot(a));
      if (_f.lengthSq() > 1e-6) return out.copy(_f.normalize()).cross(a);
    }
    _qa.setFromUnitVectors(out.copy(H.n0).applyQuaternion(q), a);
    out.copy(H.b0n).applyQuaternion(q).applyQuaternion(_qa);
    return out.addScaledVector(a, -out.dot(a)).normalize();
  }

  /** dog legs: each segment within a cone around its rest direction in the (untwisted) parent frame */
  _dogLegs() {
    const qT = this.clusters[0].q, p = this.p;
    const lim = [1.2, 1.3, 1.0];
    for (const leg of this.L.legs) {
      _qb.copy(qT);
      for (let s = 0; s < 3; s++) {
        const i = leg.idx[s], j = leg.idx[s + 1];
        _f.copy(leg.r0[s]).applyQuaternion(_qb);
        this._coneTo(i, j, _f, lim[s]);
        if (s === 2) break;
        _a.set(p[j * 3] - p[i * 3], p[j * 3 + 1] - p[i * 3 + 1], p[j * 3 + 2] - p[i * 3 + 2]);
        if (_a.lengthSq() < 1e-12) continue;
        _qa.setFromUnitVectors(_f, _a.normalize());
        _qb.premultiply(_qa);
      }
    }
  }

  _pairs() {
    const p = this.p, P = this.L.pairs;
    for (let k = 0; k < P.length; k++) {
      const i = P[k][0], j = P[k][1];
      const dx = p[j * 3] - p[i * 3], dy = p[j * 3 + 1] - p[i * 3 + 1], dz = p[j * 3 + 2] - p[i * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz, L = this.pairLen[k];
      if (d2 >= L * L || d2 < 1e-12) continue;
      const d = Math.sqrt(d2), f = (L - d) / d;
      this._move(i, j, dx * f, dy * f, dz * f);
    }
  }

  _collide(world) {
    const x = this.x, p = this.p, r = this.r;
    this.cc.fill(0);
    C.rd = this;
    for (let i = 0; i < this.n; i++) {
      const ri = r[i];
      C.i = i;
      C.r = ri;
      C.ox = x[i * 3];
      C.oy = x[i * 3 + 1];
      C.oz = x[i * 3 + 2];
      C.px = p[i * 3];
      C.py = p[i * 3 + 1];
      C.pz = p[i * 3 + 2];
      const R = ri + MARGIN;
      C.minY = Math.min(C.oy, C.py) - R;
      C.maxY = Math.max(C.oy, C.py) + R;
      world.query(Math.min(C.ox, C.px) - R, Math.min(C.oz, C.pz) - R, Math.max(C.ox, C.px) + R, Math.max(C.oz, C.pz) + R, contactCb);
    }
    C.rd = null;
  }

  _addContact(i, nx, ny, nz, d) {
    const c = this.cc[i], cn = this.cn, base = i * MAXC;
    for (let k = 0; k < c; k++) {
      const o = (base + k) * 3;
      // same face of another box (floor seams, stacked walls): keep the outermost; merely similar
      // normals (a box edge next to a floor) are different planes and must not be merged
      if (cn[o] * nx + cn[o + 1] * ny + cn[o + 2] * nz > 0.99999) {
        if (d > this.cd[base + k]) this.cd[base + k] = d;
        return;
      }
    }
    let k = c;
    if (c >= MAXC) {
      // full: replace the plane the particle is furthest from, if this one is closer
      const p = this.p, px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
      let far = -Infinity;
      for (let q = 0; q < c; q++) {
        const o = (base + q) * 3;
        const s = px * cn[o] + py * cn[o + 1] + pz * cn[o + 2] - this.cd[base + q];
        if (s > far) (far = s), (k = q);
      }
      if (px * nx + py * ny + pz * nz - d >= far) return;
    } else this.cc[i] = c + 1;
    const o = (base + k) * 3;
    cn[o] = nx;
    cn[o + 1] = ny;
    cn[o + 2] = nz;
    this.cd[base + k] = d;
    this.cv[base + k] = this.v[i * 3] * nx + this.v[i * 3 + 1] * ny + this.v[i * 3 + 2] * nz;
  }

  _contacts() {
    const p = this.p, cn = this.cn, cd = this.cd;
    for (let i = 0; i < this.n; i++) {
      const c = this.cc[i];
      for (let k = 0; k < c; k++) {
        const o = (i * MAXC + k) * 3;
        const s = p[i * 3] * cn[o] + p[i * 3 + 1] * cn[o + 1] + p[i * 3 + 2] * cn[o + 2] - cd[i * MAXC + k];
        if (s >= 0) continue;
        p[i * 3] -= cn[o] * s;
        p[i * 3 + 1] -= cn[o + 1] * s;
        p[i * 3 + 2] -= cn[o + 2] * s;
      }
    }
  }

  /** v = Δx / h, then restitution + Coulomb friction on the contacts that still touch, then damping */
  _velocities(h) {
    const n = this.n, x = this.x, p = this.p, v = this.v, cn = this.cn, inv = 1 / h, trunk = this.trunk;
    const mu = RAGDOLL.friction, e = RAGDOLL.bounce;
    let grounded = false, thud = 0, thudI = -1, hit = 0;
    for (let i = 0; i < n; i++) {
      let vx = (p[i * 3] - x[i * 3]) * inv, vy = (p[i * 3 + 1] - x[i * 3 + 1]) * inv, vz = (p[i * 3 + 2] - x[i * 3 + 2]) * inv;
      // constraints that could not agree within the iterations leave a residual jump; it may redirect a
      // particle but not speed it up by more than MAX_DV per substep (no limbs snapping off at 30 m/s)
      const s0 = Math.sqrt(v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2);
      const s1 = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (s1 > s0 + MAX_DV) {
        const f = (s0 + MAX_DV) / s1;
        vx *= f;
        vy *= f;
        vz *= f;
      }
      for (let k = 0; k < this.cc[i]; k++) {
        const o = (i * MAXC + k) * 3, nx = cn[o], ny = cn[o + 1], nz = cn[o + 2];
        if (p[i * 3] * nx + p[i * 3 + 1] * ny + p[i * 3 + 2] * nz - this.cd[i * MAXC + k] > 0.004) continue;
        if (ny > 0.5) {
          grounded = true;
          if (trunk[i]) this.landed = true;
        }
        const vn0 = this.cv[i * MAXC + k];
        let vn = vx * nx + vy * ny + vz * nz;
        // normal: a little bounce off hard hits; being pushed back out of a surface must not launch it
        const want = vn0 < -2 ? -e * vn0 : 0;
        const vn2 = clamp(vn, want, want + 0.5);
        if (vn2 !== vn) {
          vx += nx * (vn2 - vn);
          vy += ny * (vn2 - vn);
          vz += nz * (vn2 - vn);
          vn = vn2;
        }
        // Coulomb friction from the normal velocity the contact took away
        const jn = Math.max(0, vn - Math.min(vn0, 0));
        const tx = vx - nx * vn, ty = vy - ny * vn, tz = vz - nz * vn;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (tl > 1e-6) {
          const f = Math.max(0, 1 - (mu * jn) / tl);
          vx = nx * vn + tx * f;
          vy = ny * vn + ty * f;
          vz = nz * vn + tz * f;
        }
        if (trunk[i] && -vn0 > thud) {
          thud = -vn0;
          thudI = i;
        }
        if (vn0 < -2) hit += this.m[i] * (-vn0 - 2);
      }
      v[i * 3] = vx;
      v[i * 3 + 1] = vy;
      v[i * 3 + 2] = vz;
    }
    x.set(p);
    this.grounded = grounded;
    // flesh doesn't bounce: hard impacts soak up part of the whole body's motion
    const k = hit > 0 ? Math.max(0.6, 1 - (0.1 * hit) / this.M) : 1;
    this._damp(h, grounded ? 6 : 1.2, k);
    let vmax = 0, vsum = 0;
    for (let i = 0; i < n; i++) {
      let sp = v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2;
      if (sp > 900) {
        const f = 30 / Math.sqrt(sp);
        v[i * 3] *= f;
        v[i * 3 + 1] *= f;
        v[i * 3 + 2] *= f;
        sp = 900;
      }
      if (sp > vmax) vmax = sp;
      vsum += sp;
    }
    // settle: slow for a moment while touching the floor
    if (grounded && vmax < 1.0 && vsum / n < 0.09) this.sleepT += h;
    else this.sleepT = 0;
    // a thud when the trunk slams into something
    if (thud > 3.5 && this.thudT <= 0 && this.thuds < 3) {
      this.thudT = 0.3;
      this.thuds++;
      _a.set(x[thudI * 3], x[thudI * 3 + 1], x[thudI * 3 + 2]);
      this.sys.game.audio?.play('bodyfall', { position: _a, volume: clamp(thud / 9, 0.3, 0.9), pitch: (this.L.quad ? 1.3 : 1) * rand(0.9, 1.1) });
    }
  }

  /**
   * Damping that spares the rigid motion (Müller et al., PBD): velocities relax toward the body's overall
   * translation + spin at `rate` (1/s), so flailing and solver noise die out while the throw and the tumble
   * carry on. `k` scales everything (impact soak). Once the trunk has landed, the body as a whole may not be
   * flung back up by its own constraints (a slide into a wall corner would otherwise climb it).
   */
  _damp(h, rate, k) {
    const n = this.n, x = this.x, v = this.v, m = this.m, M = this.M;
    let cx = 0, cy = 0, cz = 0, ux = 0, uy = 0, uz = 0;
    for (let i = 0; i < n; i++) {
      cx += x[i * 3] * m[i];
      cy += x[i * 3 + 1] * m[i];
      cz += x[i * 3 + 2] * m[i];
      ux += v[i * 3] * m[i];
      uy += v[i * 3 + 1] * m[i];
      uz += v[i * 3 + 2] * m[i];
    }
    cx /= M; cy /= M; cz /= M; ux /= M; uy /= M; uz /= M;
    // angular momentum and inertia tensor about the center of mass
    let lx = 0, ly = 0, lz = 0, i00 = 0, i01 = 0, i02 = 0, i11 = 0, i12 = 0, i22 = 0;
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz, mi = m[i];
      const wx = v[i * 3] - ux, wy = v[i * 3 + 1] - uy, wz = v[i * 3 + 2] - uz;
      lx += mi * (ry * wz - rz * wy);
      ly += mi * (rz * wx - rx * wz);
      lz += mi * (rx * wy - ry * wx);
      i00 += mi * (ry * ry + rz * rz);
      i11 += mi * (rx * rx + rz * rz);
      i22 += mi * (rx * rx + ry * ry);
      i01 -= mi * rx * ry;
      i02 -= mi * rx * rz;
      i12 -= mi * ry * rz;
    }
    // ω = I⁻¹ L (symmetric 3×3 via cofactors)
    const c00 = i11 * i22 - i12 * i12, c01 = i02 * i12 - i01 * i22, c02 = i01 * i12 - i02 * i11;
    const det = i00 * c00 + i01 * c01 + i02 * c02;
    let ox = 0, oy = 0, oz = 0;
    if (Math.abs(det) > 1e-9) {
      const c11 = i00 * i22 - i02 * i02, c12 = i01 * i02 - i00 * i12, c22 = i00 * i11 - i01 * i01;
      ox = (c00 * lx + c01 * ly + c02 * lz) / det;
      oy = (c01 * lx + c11 * ly + c12 * lz) / det;
      oz = (c02 * lx + c12 * ly + c22 * lz) / det;
    }
    const lift = this.landed ? Math.max(0, uy - 1.2) : 0;
    const d = 1 - Math.exp(-rate * h);
    for (let i = 0; i < n; i++) {
      const rx = x[i * 3] - cx, ry = x[i * 3 + 1] - cy, rz = x[i * 3 + 2] - cz;
      const gx = ux + oy * rz - oz * ry, gy = uy + oz * rx - ox * rz, gz = uz + ox * ry - oy * rx;
      v[i * 3] = (v[i * 3] + (gx - v[i * 3]) * d) * k;
      v[i * 3 + 1] = (v[i * 3 + 1] + (gy - v[i * 3 + 1]) * d - lift) * k;
      v[i * 3 + 2] = (v[i * 3 + 2] + (gz - v[i * 3 + 2]) * d) * k;
    }
  }

  // ---------------------------------------------------------------- retarget
  /** write the (interpolated) particle state onto the skeleton */
  pose(alpha) {
    const z = this.z, L = this.L, ip = this.ip, x = this.x, o = this.o;
    for (let k = 0; k < ip.length; k++) ip[k] = o[k] + (x[k] - o[k]) * alpha;
    for (const c of this.clusters) c.qi.slerpQuaternions(c.q0, c.q, alpha);
    const W = this.W, K = this.K;
    if (L.quad) {
      const qT = this.clusters[0].qi;
      W[K.root].copy(qT);
      this._aim(W[K[L.pivot]], qT, L.headDir, 6, 7);
      for (const leg of L.legs) {
        let prev = qT;
        for (let s = 0; s < 3; s++) {
          const q = W[K[leg.keys[s]]];
          this._aim(q, prev, leg.r0[s], leg.idx[s], leg.idx[s + 1]);
          prev = q;
        }
      }
    } else {
      const qL = this.clusters[0].qi, qU = qL; // one rigid torso: hips, spine and chest share its rotation
      W[K.hips].copy(qL);
      W[K.spine].copy(qU);
      W[K.chest].copy(qU);
      this._aim(W[K.neck], qU, L.headDir, 3, 4);
      for (const a of L.arm) {
        this._hingeFrame(W[K[a.ua]], qU, L.hinges[a.h]);
        this._aim(W[K[a.fa]], W[K[a.ua]], a.r0, a.j, a.k);
      }
      for (const g of L.leg) {
        this._hingeFrame(W[K[g.th]], qL, L.hinges[g.h]);
        this._aim(W[K[g.sh]], W[K[g.th]], g.r0, g.j, g.k);
      }
    }
    // world → local down the hierarchy (the root's parents carry no rotation)
    const bones = this.boneList;
    for (let k = 0; k < bones.length; k++) {
      const pi = this.parentIdx[k];
      const Wp = pi < 0 ? IDQ : W[pi];
      if (!this.driven[k]) {
        W[k].copy(Wp);
        if (this.fixed[k]) W[k].multiply(this.fixed[k]);
      }
      bones[k].quaternion.copy(Wp).invert().multiply(W[k]);
    }
    z.root.quaternion.identity();
    z.root.position.set(ip[0] - this.rootP.x, ip[1] - this.rootP.y, ip[2] - this.rootP.z);
    if (z.rig) z.rig.sync();
  }

  /** out = swing(Wp·r0 → particle segment i→j) · Wp */
  _aim(out, Wp, r0, i, j) {
    const ip = this.ip;
    _a.copy(r0).applyQuaternion(Wp);
    _b.set(ip[j * 3] - ip[i * 3], ip[j * 3 + 1] - ip[i * 3 + 1], ip[j * 3 + 2] - ip[i * 3 + 2]);
    const l = _b.length();
    if (l < 1e-6) {
      out.copy(Wp);
      return;
    }
    _qa.setFromUnitVectors(_a, _b.multiplyScalar(1 / l));
    out.copy(_qa).multiply(Wp);
  }

  /** upper arm / thigh: frame from its segment + the elbow / knee hinge axis (the untwisted reference when straight) */
  _hingeFrame(out, qc, H) {
    const ip = this.ip, i = H.i * 3, j = H.j * 3, k = H.k * 3;
    const a = _c.set(ip[j] - ip[i], ip[j + 1] - ip[i + 1], ip[j + 2] - ip[i + 2]);
    if (a.lengthSq() < 1e-12) {
      out.copy(qc);
      return;
    }
    a.normalize();
    const hs = this._bendRef(H, qc, a, _d); // untwisted bend direction...
    hs.crossVectors(a, _a.copy(hs)); // ...→ its hinge axis (a × bend)
    const f = _e.set(ip[k] - ip[j], ip[k + 1] - ip[j + 1], ip[k + 2] - ip[j + 2]).normalize();
    const hb = _f.copy(a).cross(f);
    const sb = hb.length();
    let wgt = sb > 1e-6 ? smoothstep(0.08, 0.3, sb) : 0;
    if (wgt > 0) {
      hb.multiplyScalar(1 / sb);
      if (hb.dot(hs) < 0) wgt = 0;
    }
    hs.multiplyScalar(1 - wgt).addScaledVector(hb, wgt);
    hs.addScaledVector(a, -hs.dot(a)).normalize();
    _b.copy(a).cross(hs);
    _m.makeBasis(a, hs, _b).multiply(H.B0T);
    out.setFromRotationMatrix(_m);
  }

  /** feet-level point under the body now (the Boomer's delayed blast follows its flying corpse) */
  anchor(out) {
    const x = this.x;
    return out.set(x[0], x[1] - 0.6 * this.s, x[2]);
  }

  freeze() {
    if (this.frozen) return;
    this.frozen = true;
    this.pose(1);
    const z = this.z;
    if (!this.pooled && this.grounded && z.typeName !== 'charger') {
      this.pooled = true;
      this.sys.game.fx?.bloodPoolAt(_a.set(this.x[0], this.x[1], this.x[2]));
    }
  }
}

// ---------------------------------------------------------------- system
export class RagdollSystem {
  constructor(game) {
    this.game = game;
    this.list = []; // simulating
    this.acc = 0;
    this.force = null; // debug: override the kill chance (0..1)
  }

  get max() {
    return this.game.settings?.quality === 'low' ? Math.min(4, RAGDOLL.max) : RAGDOLL.max;
  }

  /** called from Zombie._die: maybe throw the body. Sets z.ragdoll when it does. */
  tryStart(z, dir, source, opts = {}) {
    if (!eligible(z, opts)) return null;
    const p = this.force ?? ragdollChance(z, source, opts);
    if (!(Math.random() < p)) return null;
    return this.start(z, dir, source, opts);
  }

  start(z, dir, source = null, opts = {}) {
    if (!z.active || !eligible(z, opts)) return null;
    this._prune();
    if (this.list.length >= this.max) {
      // make room: freeze the oldest body that is already down (never one still in the air)
      let old = null;
      for (const r of this.list) if ((r.grounded || r.t > 2.5) && r.t > 0.6 && (!old || r.t > old.t)) old = r;
      if (!old) return null;
      old.freeze();
      this.list.splice(this.list.indexOf(old), 1);
    }
    try {
      if (!z._ragLayout) z._ragLayout = z.quad ? dogLayout(z) : humanLayout(z);
      const rd = (z._ragdoll ??= new Ragdoll(this, z, z._ragLayout));
      z.ragdoll = rd;
      rd.start(dir, source, opts);
      this.list.push(rd);
      return rd;
    } catch (e) {
      console.warn('[ragdoll] skipped', z.typeName, e);
      z.ragdoll = null;
      return null;
    }
  }

  _prune() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (r.z.ragdoll !== r || !r.z.active) this.list.splice(i, 1);
    }
  }

  update(dt, world) {
    this._prune();
    if (!this.list.length) {
      this.acc = 0;
      return;
    }
    const h = 1 / RAGDOLL.hz;
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= h && n < 12) {
      for (const r of this.list) r.step(h, world);
      this.acc -= h;
      n++;
    }
    if (this.acc >= h) this.acc = 0; // too far behind: drop the backlog (slow motion beats a spiral)
    const alpha = this.acc / h;
    const life = this.game.corpseTime ?? 7;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i];
      if (!(Math.abs(r.x[0]) + Math.abs(r.x[1]) < 1e5)) {
        // numerically lost (never seen): keep the last good pose rather than writing NaN into the skeleton
        r.frozen = true;
        this.list.splice(i, 1);
      } else if (r.t > RAGDOLL.life || r.sleepT > 0.5 || r.z.corpseT > life - 0.2) {
        r.freeze();
        this.list.splice(i, 1);
      } else r.pose(alpha);
    }
  }

  clear() {
    for (const r of this.list) if (r.z.ragdoll === r) r.frozen = true;
    this.list.length = 0;
    this.acc = 0;
  }
}
