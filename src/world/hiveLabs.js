// The Hive's laboratories and clinical wing (world/hive.js): the wet labs 4-A and 4-B, sequencing, decon, cryo
// storage, the infirmary, the isolation ward, the containment cells, the morgue, waste & incineration, the specimen
// hall and Nadja's lab outside her clean room. Props in the idiom of hiveProps.js (world-space geometry for the Kit,
// one mesh per material, baked light, a collider for whatever you'd bump into) and one dress function per room.
//
// c: hiveProps.js's build context plus X (EXTRA_MATS, baked), G (EXTRA_GLOW, emissive), label(text, x, y, z, face,
//    w, h, opts), decal(kind, x, z, size, rot, opts), wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on).
// Wall props take (x, z) = the middle of their back edge on the wall line and `face`, the side they open toward
// ('n' -z, 's' +z, 'w' -x, 'e' +x). Free-standing ones take their centre and a yaw (radians, 0 = front toward +z).
// Bench-top items take the surface height y as well.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { SIGN, SCREEN, atlasPlane } from './lab.js';
import * as P from './hiveProps.js';

/** baked materials this module adds (c.X) */
export const EXTRA_MATS = {
  chrome: { color: 0xd3d8dd, metalness: 0.9, roughness: 0.18 },
  rubber: { color: 0x1b1c1e, roughness: 0.92 },
  cream: { color: 0xebe7da, roughness: 0.5 }, // instrument casings, warm white
  labGrey: { color: 0xbfc5ca, roughness: 0.45 }, // pale grey plastics and trims
  laminate: { color: 0xd9d6cc, roughness: 0.6 }, // workstation desk tops
  navy: { color: 0x22344a, roughness: 0.45 }, // instrument upper shells
  teal: { color: 0x2c7c84, roughness: 0.5 },
  flamYellow: { color: 0xe6b81b, roughness: 0.42, metalness: 0.25 },
  acidBlue: { color: 0x1d5da8, roughness: 0.42, metalness: 0.25 },
  bioRed: { color: 0xc0231d, roughness: 0.45 },
  bagRed: { color: 0xd8321f, roughness: 0.3 },
  sharpsYellow: { color: 0xf2c417, roughness: 0.5 },
  safetyGreen: { color: 0x1d9a4d, roughness: 0.5 },
  brass: { color: 0xb8923c, metalness: 0.85, roughness: 0.32 },
  copper: { color: 0xb86b3d, metalness: 0.85, roughness: 0.35 },
  linen: { color: 0xeff1ec, roughness: 0.92 },
  blanket: { color: 0x5c7a98, roughness: 0.95 },
  curtain: { color: 0x87aba5, roughness: 0.9 },
  vinyl: { color: 0x2a5b7a, roughness: 0.55 },
  labCoat: { color: 0xf4f5f1, roughness: 0.85 },
  hazmat: { color: 0xdcb21c, roughness: 0.6 },
  tyvek: { color: 0xe8ebee, roughness: 0.8 },
  nitrile: { color: 0x3b6cd4, roughness: 0.6 },
  leather: { color: 0x3f2a1c, roughness: 0.7 },
  canvas: { color: 0x5a6246, roughness: 0.95 },
  rust: { color: 0x6b3b22, metalness: 0.45, roughness: 0.8 },
  soot: { color: 0x1d1b1a, roughness: 0.95 },
  heatGrey: { color: 0x585d62, metalness: 0.5, roughness: 0.55 },
  grate: { color: 0x3a3f44, metalness: 0.65, roughness: 0.45 },
  cellSteel: { color: 0x5a636a, metalness: 0.6, roughness: 0.45 },
  cork: { color: 0xa87a4c, roughness: 0.95 },
  paper: { color: 0xf3f1e7, roughness: 0.9 },
  film: { color: 0x121c26, roughness: 0.3 }, // x-ray film
  bloodDry: { color: 0x3c0906, roughness: 0.35 },
  medium: { color: 0xd46883, roughness: 0.3 }, // culture medium (phenol red)
  cryoBlue: { color: 0x4f7fae, metalness: 0.35, roughness: 0.4 },
  pvc: { color: 0xc9d0a2, roughness: 0.3 }, // heavy PVC shower / strip curtains
  tile: { color: 0xdde4e5, roughness: 0.28 },
  ivBag: { color: 0xdcebef, roughness: 0.2 },
  cartRed: { color: 0xb0211b, roughness: 0.42, metalness: 0.2 },
  woodLight: { color: 0x9b7b53, roughness: 0.7 },
  specimen: { color: 0x8a9460, roughness: 0.5 }, // pale tissue in the jars
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  lightbox: [0xeef5ff, 1.5],
  uv: [0x9b6bff, 1.7],
  fridge: [0xe4f6ff, 1.3],
  gel: [0xff9838, 1.9], // gel bands (stained DNA under UV)
  read: [0x48c8ff, 1.5], // the read map's bars
  flame: [0xff6418, 2.4],
  warn: [0xffae1c, 1.8],
  lcd: [0x9cf0c8, 1.2],
  surgical: [0xfff4dc, 2.2],
  map: [0x2fb8c8, 0.9],
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const YAW = P.FACE_YAW;
const RIGHT = { s: 'e', e: 'n', n: 'w', w: 's' }; // the +u side of a thing facing `face`
const LEFT = { s: 'w', e: 's', n: 'e', w: 'n' };
const BACK = { s: 'n', n: 's', e: 'w', w: 'e' };
const COOL = [0.93, 0.97, 1.0];
const DOWN = [0, -1, 0];
const nearFace = (yaw) => ['s', 'e', 'n', 'w'][((Math.round(yaw / (PI / 2)) % 4) + 4) % 4];
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];

// ---------------------------------------------------------------- shared geometry (built once, cloned by the Kit)
const _geo = new Map();
const cached = (key, make) => {
  let g = _geo.get(key);
  if (!g) _geo.set(key, (g = make()));
  return g;
};
const k3 = (...a) => a.map((v) => Math.round(v * 1000)).join(',');
/** a w × h × d box geometry, centred; rounded edges of radius r when r > 0 */
function rbox(w, h, d, r = 0) {
  if (r > 0) return cached('r' + k3(w, h, d, r), () => new RoundedBoxGeometry(w, h, d, 1, r));
  return cached('b' + k3(w, h, d), () => new THREE.BoxGeometry(w, h, d));
}
/** a cylinder standing on y 0 (r0 bottom, r1 top) */
const cylG = (r0, r1, h, seg = 12, open = false) => cached('c' + k3(r0, r1, h) + ':' + seg + open, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(0, h / 2, 0));
/** a centred cylinder along y */
const cylC = (r0, r1, h, seg = 12) => cached('cc' + k3(r0, r1, h) + ':' + seg, () => new THREE.CylinderGeometry(r1, r0, h, seg));
const sphG = (r, ws = 10, hs = 8) => cached('s' + k3(r) + ':' + ws + ':' + hs, () => new THREE.SphereGeometry(r, ws, hs));
const domeG = (r, ws = 16) => cached('d' + k3(r) + ':' + ws, () => new THREE.SphereGeometry(r, ws, 6, 0, PI * 2, 0, PI / 2));
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const capG = (r, l, cs = 4, rs = 8) => cached('p' + k3(r, l) + ':' + cs + ':' + rs, () => new THREE.CapsuleGeometry(r, l, cs, rs));
const discG = (r, seg = 16) => cached('o' + k3(r) + ':' + seg, () => new THREE.CircleGeometry(r, seg));
const planeG = (w, h) => cached('q' + k3(w, h), () => new THREE.PlaneGeometry(w, h));

// ---------------------------------------------------------------- the local frame
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = V(), _s = V(1, 1, 1);
/**
 * A prop's local frame: u across (to the right of someone looking at its front), y up, v out from its back toward its
 * front. Built at (x, y, z) turned by `face` (a face letter or a yaw), optionally tilted ([rx, rz], applied before the
 * yaw: a thing lying on its side). Everything it adds goes to the Kit in world space.
 */
class Frame {
  constructor(c, x, z, face, { y = 0, tilt = null } = {}) {
    this.c = c;
    this.yaw = typeof face === 'number' ? face : YAW[face];
    this.face = typeof face === 'number' ? nearFace(face) : face;
    this.tilted = !!tilt;
    _e.set(tilt?.[0] ?? 0, this.yaw, tilt?.[1] ?? 0, 'YXZ');
    this.m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(_e), V(1, 1, 1));
  }
  p(u, y, v) {
    return V(u, y, v).applyMatrix4(this.m);
  }
  /** any geometry at local (u, y, v), rotated [rx, ry, rz] (z, x, then y) and scaled */
  add(mat, g, u, y, v, r = null, s = null) {
    _e.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0, r?.[3] ?? 'YXZ');
    _m.compose(_p.set(u, y, v), _q.setFromEuler(_e), s ? _s.set(s[0], s[1], s[2]) : _s.set(1, 1, 1));
    return this.c.K.addMatrix(mat, g, _m2.multiplyMatrices(this.m, _m));
  }
  /** a box centred at (u, y, v): w across, h tall, d deep (rounded edges when r > 0) */
  box(mat, u, y, v, w, h, d, r = 0, rot = null) {
    return this.add(mat, rbox(w, h, d, r), u, y, v, rot);
  }
  /** a box between two corners */
  span(mat, u0, y0, v0, u1, y1, v1, r = 0) {
    return this.box(mat, (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2, Math.abs(u1 - u0), Math.abs(y1 - y0), Math.abs(v1 - v0), r);
  }
  /** an upright cylinder standing at (u, y, v) */
  cyl(mat, u, y, v, r0, r1, h, seg = 12, open = false) {
    return this.add(mat, cylG(r0, r1, h, seg, open), u, y, v);
  }
  /** a lying cylinder centred at (u, y, v), along 'u' or 'v' */
  hcyl(mat, u, y, v, r, len, seg = 12, axis = 'u', r1 = r) {
    return this.add(mat, cylC(r, r1, len, seg), u, y, v, axis === 'u' ? [0, 0, PI / 2] : [PI / 2, 0, 0]);
  }
  rod(mat, a, b, r, seg = 6) {
    return this.c.K.rod(mat, this.p(a[0], a[1], a[2]), this.p(b[0], b[1], b[2]), r, seg);
  }
  /** a flat picture facing the front (turned by `turn` about y), `rect` an atlas region */
  plane(mat, w, h, u, y, v, rect = null, W = 1024, H = 1024, turn = 0) {
    return this.add(mat, rect ? atlasPlane(w, h, rect, W, H) : planeG(w, h), u, y, v, [0, turn, 0]);
  }
  /** a gauge dial facing the front */
  gauge(u, y, v, s = 0.1) {
    this.add(this.c.M.dark, cylC(s * 0.56, s * 0.56, 0.025, 12), u, y, v + 0.0125, [PI / 2, 0, 0]);
    this.plane(this.c.M.signs, s, s, u, y, v + 0.026, SIGN.gauge);
  }
  /** text: a c.label on the front plane at depth v (or a side: 'left' / 'right' / 'back' / a face letter) */
  label(text, u, y, v, w, h, opts = {}, side = 'front') {
    const f = side === 'front' ? this.face : side === 'right' ? RIGHT[this.face] : side === 'left' ? LEFT[this.face] : side === 'back' ? BACK[this.face] : side;
    const p = this.p(u, y, v);
    this.c.label(text, p.x, p.y, p.z, f, w, h, opts);
  }
  /** a monitor picture on the front plane: a random lab screen, or a given SCREEN region */
  screen(u, y, v, w, h, on = true, which = null) {
    if (which && on) return this.plane(this.c.U.screen, w, h, u, y, v, SCREEN[which], 1024, 512);
    const p = this.p(u, y, v);
    this.c.screen(p.x, p.y, p.z, this.yaw, w, h, on);
  }
  light(u, y, v, i, r, rgb = COOL, dir = null, range = null) {
    const p = this.p(u, y, v);
    this.c.light(p.x, p.y, p.z, i, r, rgb, dir, range);
  }
  /** a world rect [x0, z0, x1, z1] of the local one */
  rect(u0, v0, u1, v1) {
    const a = this.p(u0, 0, v0), b = this.p(u1, 0, v1);
    return [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)];
  }
  /** the collider of a local box (its world AABB) */
  col(u0, v0, u1, v1, y1, surf = SURF.metal, flags = 0, y0 = 0, tag = null) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, ya = Infinity, yb = -Infinity;
    for (const u of [u0, u1]) {
      for (const v of [v0, v1]) {
        for (const y of [y0, y1]) {
          const p = this.p(u, y, v);
          x0 = Math.min(x0, p.x);
          x1 = Math.max(x1, p.x);
          z0 = Math.min(z0, p.z);
          z1 = Math.max(z1, p.z);
          ya = Math.min(ya, p.y);
          yb = Math.max(yb, p.y);
        }
      }
    }
    this.c.col(x0, Math.max(0, ya), z0, x1, yb, z1, surf, flags, tag);
  }
}

/** a gooseneck tap standing at (u, y, v) of the frame, reaching `reach` toward the front, wrist-blade levers */
function faucet(f, u, y, v, reach = 0.22, levers = true) {
  const { X } = f.c;
  const g = cached('faucet' + k3(reach), () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0, 0.26, 0), V(0, 0.38, reach * 0.4), V(0, 0.35, reach * 0.95), V(0, 0.27, reach)]), 12, 0.011, 6));
  f.cyl(X.chrome, u, y, v, 0.026, 0.022, 0.05, 10);
  f.add(X.chrome, g, u, y + 0.04, v);
  if (!levers) return;
  for (const s of [-1, 1]) {
    f.cyl(X.chrome, u + s * 0.1, y, v, 0.02, 0.017, 0.04, 8);
    f.box(X.chrome, u + s * 0.1, y + 0.05, v + 0.06, 0.016, 0.012, 0.13);
  }
}
/** a basin let into a top at height y: a steel rim round a dark bowl, a drain */
function basin(f, u, y, v, w, d, mat = null) {
  const { M } = f.c;
  const m = mat ?? M.steel;
  f.span(m, u - w / 2, y, v - d / 2, u + w / 2, y + 0.008, v - d / 2 + 0.025);
  f.span(m, u - w / 2, y, v + d / 2 - 0.025, u + w / 2, y + 0.008, v + d / 2);
  f.span(m, u - w / 2, y, v - d / 2, u - w / 2 + 0.025, y + 0.008, v + d / 2);
  f.span(m, u + w / 2 - 0.025, y, v - d / 2, u + w / 2, y + 0.008, v + d / 2);
  f.span(M.black, u - w / 2 + 0.025, y + 0.002, v - d / 2 + 0.025, u + w / 2 - 0.025, y + 0.004, v + d / 2 - 0.025);
  f.cyl(M.steel, u, y + 0.004, v, 0.03, 0.03, 0.003, 10);
}
/** a bench gas turret at (u, y, v): brass body, a hose barb toward the front, a coloured lever */
function gasTap(f, u, y, v, handle) {
  const { X } = f.c;
  f.cyl(X.brass, u, y, v, 0.018, 0.014, 0.1, 8);
  f.hcyl(X.brass, u, y + 0.085, v + 0.035, 0.007, 0.07, 6, 'v');
  f.box(handle, u, y + 0.105, v, 0.018, 0.012, 0.07);
}
/** a double power socket face on the frame's front plane v */
function socketAt(f, u, y, v, n = 2) {
  const { M } = f.c;
  const w = 0.085 * n;
  f.box(M.white, u, y, v + 0.006, w, 0.085, 0.012);
  for (let i = 0; i < n; i++) {
    const a = u - w / 2 + 0.0425 + i * 0.085;
    for (const s of [-0.012, 0.012]) f.box(M.black, a + s, y + 0.006, v + 0.0125, 0.005, 0.014, 0.002);
    f.box(M.black, a, y - 0.016, v + 0.0125, 0.01, 0.005, 0.002);
  }
}
/** a GHS-style hazard diamond on the front plane: red border, white field, a flame or an exclamation mark */
function ghs(f, u, y, v, s, glyph = 'flame') {
  const { M } = f.c;
  f.add(M.red, planeG(s, s), u, y, v, [0, 0, PI / 4]);
  f.add(M.white, planeG(s * 0.8, s * 0.8), u, y, v + 0.001, [0, 0, PI / 4]);
  if (glyph === 'flame') {
    const g = cached('flameGlyph', () => {
      const sh = new THREE.Shape();
      sh.moveTo(-0.3, -0.4);
      sh.quadraticCurveTo(-0.45, 0.05, -0.1, 0.45);
      sh.quadraticCurveTo(-0.05, 0.15, 0.08, 0.1);
      sh.quadraticCurveTo(0.05, 0.35, 0.2, 0.5);
      sh.quadraticCurveTo(0.5, 0.1, 0.3, -0.4);
      sh.lineTo(-0.3, -0.4);
      return new THREE.ShapeGeometry(sh, 4);
    });
    f.add(M.black, g, u, y, v + 0.002, null, [s * 0.5, s * 0.5, 1]);
  } else {
    f.box(M.black, u, y + s * 0.07, v + 0.002, s * 0.09, s * 0.36, 0.001);
    f.box(M.black, u, y - s * 0.2, v + 0.002, s * 0.09, s * 0.09, 0.001);
  }
}

// ---------------------------------------------------------------- small fittings (walls)
/** a power socket plate on the wall at (x, z) facing `face`, `n` gangs, y its centre height */
export function socket(c, x, y, z, face, n = 2) {
  socketAt(new Frame(c, x, z, face), 0, y, 0, n);
}

/** a light switch by a door: plate and rocker (x, z on the wall line) */
export function lightSwitch(c, x, z, face, y = 1.15) {
  const f = new Frame(c, x, z, face);
  f.box(c.M.white, 0, y, 0.006, 0.08, 0.12, 0.012);
  f.box(c.M.white, 0, y + 0.012, 0.015, 0.03, 0.05, 0.01, 0, [0.12, 0, 0]);
}

/** a wall clock (the lab atlas' dial in a black rim) at height y */
export function wallClock(c, x, y, z, face, r = 0.17) {
  const f = new Frame(c, x, z, face);
  f.add(c.M.black, cylC(r, r, 0.05, 20), 0, y, 0.025, [PI / 2, 0, 0]);
  f.plane(c.M.signs, r * 1.9, r * 1.9, 0, y, 0.052, SIGN.clock);
}

/** a green first-aid box on the wall, white cross, a label */
export function firstAidBox(c, x, y, z, face) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.safetyGreen, 0, y, 0.07, 0.4, 0.32, 0.13, 0.015);
  f.box(M.white, 0, y + 0.02, 0.137, 0.12, 0.035, 0.004);
  f.box(M.white, 0, y + 0.02, 0.137, 0.035, 0.12, 0.004);
  f.box(X.chrome, 0.17, y, 0.14, 0.015, 0.06, 0.01);
  f.label('FIRST AID', 0, y - 0.11, 0.1375, 0.24, 0.05, { bg: '#1d9a4d', fg: '#ffffff', border: '#1d9a4d', font: 'bold 44px Arial' });
}

/** a cork notice board (aluminium frame) with pinned sheets, a few of them labelled */
export function noticeBoard(c, x, y, z, face, { w = 1.2, h = 0.8, notes = [] } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.chrome, 0, y, 0.01, w + 0.04, h + 0.04, 0.02);
  f.box(X.cork, 0, y, 0.022, w, h, 0.01);
  const pins = [M.red, M.blue, M.yellow, M.green];
  const n = Math.max(3, Math.round(w * h * 7));
  for (let i = 0; i < n; i++) {
    const pw = 0.16 + rnd() * 0.08, ph = 0.21 + rnd() * 0.08;
    const u = (rnd() - 0.5) * (w - pw - 0.04), yy = y + (rnd() - 0.5) * (h - ph - 0.04);
    f.add(i % 4 === 3 ? M.yellow : X.paper, planeG(pw, ph), u, yy, 0.028 + i * 0.0006, [0, 0, (rnd() - 0.5) * 0.12]);
    f.add(pins[i % 4], sphG(0.008, 6, 4), u, yy + ph / 2 - 0.02, 0.034);
  }
  const cols = Math.max(1, Math.floor((w - 0.06) / 0.3));
  notes.forEach((t, i) => {
    const u = -w / 2 + 0.18 + (i % cols) * 0.3;
    f.label(t, u, y + h / 2 - 0.15 - Math.floor(i / cols) * 0.27, 0.036 + i * 0.001, 0.26, 0.2, { bg: '#f7f5ec', fg: '#1d2b3a', border: '#f7f5ec', font: 'bold 30px Arial' });
  });
}

/** a wall air grille (frame and slats), w × h at centre height y */
export function wallVent(c, x, y, z, face, w = 0.6, h = 0.3) {
  const { M } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.grey, 0, y, 0.01, w, h, 0.02);
  const n = Math.max(2, Math.round(h / 0.045));
  for (let i = 0; i < n; i++) f.box(M.dark, 0, y - h / 2 + 0.03 + (i * (h - 0.06)) / (n - 1), 0.024, w - 0.05, 0.012, 0.012, 0, [0.6, 0, 0]);
}

/** a CCTV camera on a wall bracket at height y, looking out and down; a red LED */
export function cctvCam(c, x, y, z, face, turn = 0) {
  const { M, U } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.grey, 0, y, 0.015, 0.1, 0.14, 0.03);
  f.rod(M.grey, [0, y, 0.03], [0, y - 0.02, 0.18], 0.018, 6);
  f.box(M.white, 0, y - 0.05, 0.26, 0.1, 0.09, 0.24, 0.02, [0.35, turn, 0]);
  f.box(M.black, 0, y - 0.1, 0.39, 0.075, 0.065, 0.02, 0, [0.35, turn, 0]);
  f.box(U.ledR, 0.035, y - 0.02, 0.37, 0.012, 0.012, 0.01, 0, [0.35, turn, 0]);
}

/**
 * A wall placard at height y: kind 'bio' (the biohazard triangle), 'bsl3', 'cryo', 'ppe', 'hot', 'neg', 'o2', 'nofood',
 * 'sharps', 'eyewash' or any text (a notice). A white backing plate, the right colours.
 */
export function hazardPlacard(c, x, y, z, face, kind = 'bio', { w = 0.5 } = {}) {
  const { M } = c;
  const f = new Frame(c, x, z, face);
  const S = {
    bsl3: ['BIOSAFETY LEVEL 3', 'AUTHORIZED PERSONNEL ONLY', '#b3141a', '#ffffff', true],
    cryo: ['CRYOGENIC HAZARD', 'LIQUID NITROGEN · ASPHYXIANT · FACE SHIELD & GLOVES', '#1d4f7a', '#ffffff', false],
    ppe: ['PPE REQUIRED', 'COAT · GLOVES · EYE PROTECTION', '#1f5fa6', '#ffffff', false],
    hot: ['DANGER · HOT SURFACE', 'DO NOT TOUCH · 850 °C', '#d6a31a', '#16181a', false],
    neg: ['NEGATIVE PRESSURE', 'KEEP DOOR CLOSED', '#1d4f7a', '#ffffff', false],
    o2: ['OXYGEN DEPLETION RISK', 'CHECK O₂ MONITOR BEFORE ENTRY', '#d6a31a', '#16181a', false],
    nofood: ['NO FOOD OR DRINK', 'IN THE LABORATORY', '#b3141a', '#ffffff', false],
    sharps: ['SHARPS ONLY', 'DO NOT OVERFILL', '#d6a31a', '#16181a', true],
    eyewash: ['EMERGENCY EYEWASH', 'FLUSH 15 MINUTES', '#1d9a4d', '#ffffff', false],
  };
  const h = w * 0.62;
  f.box(M.white, 0, y, 0.004, w, h, 0.008);
  if (kind === 'bio') {
    f.plane(M.signs, w * 0.9, w * 0.9, 0, y, 0.009, SIGN.bio);
    return;
  }
  const [t1, t2, bg, fg, icon] = S[kind] ?? [String(kind).toUpperCase(), '', '#1b2127', '#e8edf0', false];
  f.label(t1, icon ? w * 0.14 : 0, y + h * 0.18, 0.009, icon ? w * 0.66 : w * 0.94, h * 0.34, { bg, fg, border: bg, font: 'bold 64px Arial' });
  if (t2) f.label(t2, icon ? w * 0.14 : 0, y - h * 0.2, 0.009, icon ? w * 0.66 : w * 0.94, h * 0.3, { bg: '#ffffff', fg: '#16181a', border: '#ffffff', font: 'bold 40px Arial' });
  if (icon) f.plane(M.signs, h * 0.8, h * 0.8, -w * 0.33, y, 0.009, SIGN.bio);
}

/** claw gouges on the wall: `n` parallel dark scores, a blood smear under them */
export function clawMarks(c, x, y, z, face, { n = 4, len = 0.7, a = 0.5, blood = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * 0.06;
    f.box(i % 2 ? M.black : X.soot, o * Math.cos(a), y + o * Math.sin(a), 0.004, 0.016, len * (0.8 + 0.2 * Math.sin(i * 2.1)), 0.006, 0, [0, 0, a]);
  }
  if (blood) {
    const p = f.p(0, y - len * 0.35, 0.01);
    c.wallDecal('bloodSmear', p.x, p.y, p.z, face, 0.5, 0.7);
  }
}

/** a steel floor drain grate at (x, z), w × d */
export function drainGrate(c, x, z, w = 0.32, d = 0.32) {
  const { M, X } = c;
  const f = new Frame(c, x, z, 's');
  f.span(M.black, -w / 2, 0.001, -d / 2, w / 2, 0.004, d / 2);
  f.span(X.grate, -w / 2, 0.004, -d / 2, w / 2, 0.009, -d / 2 + 0.02);
  f.span(X.grate, -w / 2, 0.004, d / 2 - 0.02, w / 2, 0.009, d / 2);
  const n = Math.max(3, Math.round(w / 0.04));
  for (let i = 0; i < n; i++) f.box(X.grate, -w / 2 + ((i + 0.5) * w) / n, 0.0065, 0, 0.012, 0.005, d - 0.02);
}

/** a long floor drain channel (a grate over a dark trough) between two points on one axis, w wide */
export function drainChannel(c, x0, z0, x1, z1, w = 0.2) {
  const { M, X } = c;
  const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
  const L = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, alongX ? 's' : 'e');
  f.span(M.black, -L / 2, 0.001, -w / 2, L / 2, 0.003, w / 2);
  for (const s of [-1, 1]) f.span(X.grate, -L / 2, 0.003, s * w / 2 - 0.012, L / 2, 0.009, s * w / 2 + 0.012);
  const n = Math.floor(L / 0.06);
  for (let i = 0; i < n; i++) f.box(X.grate, -L / 2 + (i + 0.5) * (L / n), 0.006, 0, 0.012, 0.005, w - 0.02);
}

/** a wall-mounted hose reel at height y: the drum, a coiled hose, the nozzle hanging on a hook, a valve */
export function hoseReel(c, x, y, z, face, { hose = null } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const hm = hose ?? M.red;
  f.box(M.grey, 0, y, 0.02, 0.1, 0.5, 0.04);
  f.add(M.grey, cylC(0.26, 0.26, 0.02, 20), 0, y, 0.07, [PI / 2, 0, 0]);
  f.add(M.grey, cylC(0.08, 0.08, 0.18, 12), 0, y, 0.16, [PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) f.add(hm, torG(0.16 + i * 0.03, 0.022, 4, 14), 0, y, 0.12 + i * 0.045);
  f.add(hm, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.18, 0, 0.2), V(0.26, -0.3, 0.24), V(0.22, -0.55, 0.2), V(0.12, -0.6, 0.12)]), 8, 0.022, 5), 0, y, 0);
  f.box(M.black, 0.12, y - 0.64, 0.12, 0.05, 0.16, 0.05, 0.01);
  f.hcyl(X.brass, -0.2, y - 0.2, 0.06, 0.025, 0.12, 8, 'v');
  f.add(M.red, torG(0.05, 0.008, 4, 12), -0.2, y - 0.2, 0.12);
}

/** an amber / red warning beacon on a bracket at height y; lit adds a baked glow */
export function warningBeacon(c, x, y, z, face, { red = false, lit = true } = {}) {
  const { M, U, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.dark, 0, y, 0.02, 0.1, 0.1, 0.04);
  f.cyl(M.dark, 0, y - 0.02, 0.12, 0.07, 0.07, 0.04, 12);
  f.add(red ? U.red : G.warn, domeG(0.065, 12), 0, y + 0.02, 0.12);
  f.rod(M.dark, [0, y, 0.04], [0, y, 0.1], 0.015, 6);
  if (lit) f.light(0, y, 0.3, 0.35, 1.3, red ? [1, 0.2, 0.12] : [1, 0.62, 0.15], null, 3.2);
}

/** a wall-mounted X-ray light box (height y), backlit films with a chest showing through */
export function wallLightBox(c, x, y, z, face, { w = 0.9, h = 0.5, films = 2, lit = true } = {}) {
  const { X, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.labGrey, 0, y, 0.04, w + 0.06, h + 0.08, 0.08, 0.012);
  f.box(lit ? G.lightbox : X.labGrey, 0, y, 0.081, w, h, 0.004);
  const fw = w / films - 0.04;
  for (let i = 0; i < films; i++) {
    const u = -w / 2 + (i + 0.5) * (w / films);
    f.box(X.film, u, y - 0.01, 0.085, fw, h - 0.06, 0.002);
    f.box(X.chrome, u, y + h / 2 - 0.02, 0.087, 0.05, 0.02, 0.006);
    if (!lit) continue;
    // a chest: the spine, ribs arcing out both ways, collarbones
    const b = G.lightbox;
    f.box(b, u, y - 0.02, 0.088, 0.018, h - 0.16, 0.001);
    for (let r = 0; r < 5; r++) {
      const yy = y + h / 2 - 0.12 - r * 0.055;
      const R = fw * 0.26;
      for (const s of [-1, 1]) f.add(b, torG(R, 0.004, 3, 8, PI * 0.55), u, yy - R, 0.0885, [0, s < 0 ? PI : 0, -0.2]);
    }
    for (const s of [-1, 1]) f.box(b, u + s * fw * 0.18, y + h / 2 - 0.08, 0.0885, fw * 0.3, 0.008, 0.001, 0, [0, 0, s * 0.18]);
  }
  if (lit) f.light(0, y, 0.4, 0.28, 1.0, [0.92, 0.96, 1.0], null, 2.4);
}

/** a whiteboard (x, z on the wall) with lines of marker text, a tray, markers, a magnet-held printout */
export function whiteboardFormula(c, x, z, face, { w = 1.8, y = 1.5, h = 1.0, title = null, lines = [], note = null } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.chrome, 0, y, 0.012, w + 0.05, h + 0.05, 0.024, 0.006);
  f.box(M.board, 0, y, 0.026, w, h, 0.004);
  f.box(X.chrome, 0, y - h / 2 - 0.02, 0.05, w * 0.7, 0.02, 0.05);
  const mk = [M.blue, M.red, M.black, M.green];
  for (let i = 0; i < 3; i++) f.hcyl(mk[i], -w * 0.25 + i * 0.12, y - h / 2 - 0.005, 0.05, 0.009, 0.13, 6, 'u');
  f.box(M.black, w * 0.2, y - h / 2 - 0.0, 0.05, 0.13, 0.03, 0.05);
  const txt = { bg: '#f2f4f5', fg: '#1d3f8f', border: '#f2f4f5', font: 'bold 34px "Comic Sans MS", "Marker Felt", cursive', align: 'left' };
  if (title) f.label(title, -w * 0.08, y + h / 2 - 0.1, 0.029, w * 0.8, 0.12, { ...txt, fg: '#a2231d' });
  if (lines.length) f.label(lines[0], -w * 0.05, y - 0.05 + (title ? -0.03 : 0.05), 0.029, w * 0.86, h * (title ? 0.66 : 0.8), { ...txt, lines });
  if (note) {
    f.box(X.paper, w / 2 - 0.2, y + h / 2 - 0.22, 0.03, 0.21, 0.29, 0.002, 0, [0, 0, 0.06]);
    f.cyl(M.red, w / 2 - 0.2, y + h / 2 - 0.085, 0.031, 0.012, 0.012, 0.012, 8);
    f.label(note, w / 2 - 0.2, y + h / 2 - 0.23, 0.032, 0.18, 0.2, { bg: '#f7f5ec', fg: '#1d2b3a', border: '#f7f5ec', font: 'bold 26px Arial' });
  }
}
// ---------------------------------------------------------------- lab furniture
/** a row of reagent bottles on a surface at height y along u0..u1 at depth v (brown glass, HDPE, clear with liquid) */
function reagentRow(f, u0, u1, y, v, { tall = 0.2, dense = 1 } = {}) {
  const { M, U, rnd } = f.c;
  const caps = [M.black, M.blue, M.red, M.yellow, M.white];
  const liq = [U.blue, U.green, U.amber, U.cyan];
  let u = u0 + 0.04;
  while (u < u1 - 0.04) {
    const r = 0.022 + rnd() * 0.018, h = tall * (0.55 + rnd() * 0.45);
    if (u + r > u1 - 0.02) break;
    const k = rnd();
    if (k < 1 - 0.8 * dense) {
      u += 0.06 + rnd() * 0.1;
      continue;
    }
    const vv = v + (rnd() - 0.5) * 0.04;
    const b = rnd();
    if (b < 0.45) {
      // brown glass: body and shoulder
      f.cyl(M.amber, u, y, vv, r, r, h * 0.78, 6);
      f.cyl(M.amber, u, y + h * 0.78, vv, r, r * 0.45, h * 0.12, 6);
    } else if (b < 0.8) {
      f.box(M.white, u, y + h * 0.43, vv, r * 1.8, h * 0.86, r * 1.6, 0);
    } else {
      f.cyl(U.glass, u, y, vv, r, r, h * 0.85, 6, true);
      f.cyl(liq[Math.floor(rnd() * liq.length)], u, y + 0.004, vv, r * 0.88, r * 0.88, h * (0.2 + rnd() * 0.5), 6);
    }
    f.cyl(caps[Math.floor(rnd() * caps.length)], u, y + h * 0.86, vv, r * 0.48, r * 0.48, 0.025, 6);
    if (rnd() < 0.5) f.plane(M.signs, r * 1.5, h * 0.3, u, y + h * 0.4, vv + r + 0.002, SIGN.label);
    u += r * 2 + 0.02 + rnd() * 0.06;
  }
}

/**
 * A lab bench along a wall: base units (door pairs, drawer stacks, a knee space), a black epoxy top with an upstand, a
 * service rail with sockets and gas turrets, optionally a steel sink with a gooseneck tap and a reagent shelf above.
 * (x, z) the middle of its back edge, len along the wall. opts: depth, sink (the sink's u offset or null), shelf,
 * gear (glassware pieces on the top), knee (the knee-space unit's index, -1: none), keep ([u0, u1] left clear)
 */
export function wallBench(c, x, z, face, len, { depth = 0.72, sink = null, shelf = true, gear = 4, knee = -1, keep = null, carcass = null } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const L = len, D = depth, T = 0.92;
  const body = carcass ?? M.white;
  f.span(M.dark, -L / 2 + 0.03, 0, 0.03, L / 2 - 0.03, 0.1, D - 0.08);
  const n = Math.max(1, Math.round(L / 0.6));
  const w = L / n, fv = D - 0.05;
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + w * (i + 0.5);
    if (i === knee) {
      f.span(body, u - w / 2, 0.1, 0.01, u + w / 2, 0.86, 0.04);
      f.span(body, u - w / 2, 0.79, 0.04, u + w / 2, 0.86, fv);
      continue;
    }
    f.span(body, u - w / 2 + 0.004, 0.1, 0.01, u + w / 2 - 0.004, 0.86, fv);
    const drawers = !(sink !== null && Math.abs(u - sink) < w) && (i + (rnd() < 0.3 ? 1 : 0)) % 3 === 1;
    if (drawers) {
      for (let k = 0; k < 4; k++) {
        const y0 = 0.12 + k * 0.183;
        const dv = rnd() < 0.07 ? 0.22 + rnd() * 0.1 : 0; // (one left pulled out now and then)
        f.span(body, u - w / 2 + 0.018, y0, fv + dv, u + w / 2 - 0.018, y0 + 0.168, fv + 0.018 + dv);
        f.box(X.chrome, u, y0 + 0.13, fv + 0.03 + dv, 0.13, 0.012, 0.014);
        if (dv) {
          f.span(body, u - w / 2 + 0.035, y0 + 0.02, fv, u + w / 2 - 0.035, y0 + 0.14, fv + dv);
          f.span(M.dark, u - w / 2 + 0.05, y0 + 0.141, fv + 0.005, u + w / 2 - 0.05, y0 + 0.142, fv + dv - 0.01);
        }
      }
    } else {
      for (const s of [-1, 1]) {
        const du = u + (s * w) / 4;
        f.span(body, du - w / 4 + 0.01, 0.12, fv, du + w / 4 - 0.01, 0.84, fv + 0.018);
        f.box(X.chrome, u + s * 0.045, 0.72, fv + 0.03, 0.012, 0.12, 0.014);
      }
    }
  }
  // the top, its upstand and the service rail (sockets, gas turrets)
  f.span(M.top, -L / 2, 0.86, 0, L / 2, T, D, 0.01);
  f.span(M.top, -L / 2, T, 0, L / 2, T + 0.1, 0.018);
  f.span(X.labGrey, -L / 2 + 0.04, 1.05, 0, L / 2 - 0.04, 1.19, 0.07, 0.01);
  const handles = [M.blue, M.green, M.yellow, M.red];
  const nt = Math.max(1, Math.floor(L / 0.75));
  for (let i = 0; i < nt; i++) {
    const u = -L / 2 + (L * (i + 0.5)) / nt;
    if (sink !== null && Math.abs(u - sink) < 0.35) continue;
    if (i % 2 === 0) socketAt(f, u, 1.12, 0.07);
    else gasTap(f, u, T, 0.1, handles[i % 4]);
  }
  if (sink !== null) {
    basin(f, sink, T, D * 0.55, 0.5, 0.4);
    faucet(f, sink, T, 0.08, D * 0.47 - 0.08);
  }
  if (shelf) {
    for (const s of [-1, 1]) {
      f.box(M.steel, s * (L / 2 - 0.25), 1.5, 0.008, 0.03, 0.14, 0.016);
      f.box(M.steel, s * (L / 2 - 0.25), 1.53, 0.14, 0.02, 0.02, 0.26);
    }
    f.span(M.white, -L / 2 + 0.08, 1.55, 0, L / 2 - 0.08, 1.575, 0.28);
    reagentRow(f, -L / 2 + 0.1, L / 2 - 0.1, 1.575, 0.14, { tall: 0.24 });
  }
  // glassware on the top, clear of the sink and of `keep`
  const bands = [];
  let a = -L / 2 + 0.12;
  const cuts = [];
  if (sink !== null) cuts.push([sink - 0.35, sink + 0.35]);
  if (keep) cuts.push(keep);
  cuts.sort((p, q) => p[0] - q[0]);
  for (const [c0, c1] of cuts) {
    if (c0 - a > 0.4) bands.push([a, c0]);
    a = Math.max(a, c1);
  }
  if (L / 2 - 0.12 - a > 0.4) bands.push([a, L / 2 - 0.12]);
  let left = gear;
  bands.forEach(([b0, b1], i) => {
    const k = i === bands.length - 1 ? left : Math.min(left, Math.round((gear * (b1 - b0)) / L));
    left -= k;
    if (k > 0) P.glassware(c, f.rect(b0, 0.16, b1, D - 0.06), T, k);
  });
  f.col(-L / 2, 0, L / 2, D, T, SURF.metal);
  return f;
}

/**
 * A double-sided island bench centred at (x, z), len along x (alongX) or z: cabinets both sides, a black top, a service
 * spine (sockets, gas turrets) carrying a two-tier reagent shelf, a cup sink at the +u end. opts: depth, sink, gear
 * (glassware pieces per side), shelf, keep ([u0, u1] kept clear on the top's +v side)
 */
export function islandBench(c, x, z, len, alongX, { depth = 1.5, sink = true, gear = 2, shelf = true } = {}) {
  const { M, X, rnd } = c;
  const face = alongX ? 's' : 'e';
  const f = new Frame(c, x, z, face);
  const fb = new Frame(c, x, z, BACK[face]); // the other side (u and v flipped)
  const L = len, D = depth, T = 0.92;
  f.span(M.dark, -L / 2 + 0.04, 0, -D / 2 + 0.08, L / 2 - 0.04, 0.1, D / 2 - 0.08);
  f.span(M.white, -L / 2 + 0.01, 0.1, -D / 2 + 0.05, L / 2 - 0.01, 0.86, D / 2 - 0.05);
  const n = Math.max(1, Math.round(L / 0.6)), w = L / n;
  for (const side of [-1, 1]) {
    const fv = side * (D / 2 - 0.05);
    for (let i = 0; i < n; i++) {
      const u = -L / 2 + w * (i + 0.5);
      if ((i + (side > 0 ? 1 : 0)) % 3 === 0) {
        for (let k = 0; k < 4; k++) {
          const y0 = 0.12 + k * 0.183;
          f.span(M.white, u - w / 2 + 0.018, y0, fv, u + w / 2 - 0.018, y0 + 0.168, fv + side * 0.018);
          f.box(X.chrome, u, y0 + 0.13, fv + side * 0.03, 0.13, 0.012, 0.014);
        }
      } else {
        for (const s of [-1, 1]) {
          const du = u + (s * w) / 4;
          f.span(M.white, du - w / 4 + 0.01, 0.12, fv, du + w / 4 - 0.01, 0.84, fv + side * 0.018);
          f.box(X.chrome, u + s * 0.045, 0.72, fv + side * 0.03, 0.012, 0.12, 0.014);
        }
      }
    }
  }
  f.span(M.top, -L / 2, 0.86, -D / 2, L / 2, T, D / 2, 0.01);
  // the spine: sockets both faces, gas turrets on the top both sides
  f.span(X.labGrey, -L / 2 + 0.1, T, -0.08, L / 2 - 0.1, T + 0.24, 0.08, 0.012);
  const handles = [M.blue, M.green, M.yellow];
  const nt = Math.max(1, Math.floor(L / 0.7));
  for (let i = 0; i < nt; i++) {
    const u = -L / 2 + (L * (i + 0.5)) / nt;
    if (sink && u > L / 2 - 0.55) continue;
    socketAt(f, u, T + 0.15, 0.08);
    socketAt(fb, -u, T + 0.15, 0.08);
    gasTap(f, u + 0.2, T, 0.13, handles[i % 3]);
    gasTap(fb, -u - 0.2, T, 0.13, handles[(i + 1) % 3]);
  }
  if (sink) {
    basin(f, L / 2 - 0.3, T, 0.26, 0.26, 0.2);
    faucet(f, L / 2 - 0.3, T + 0.24, 0.0, 0.24, false);
  }
  if (shelf) {
    const posts = L > 2.6 ? [-L / 2 + 0.2, 0, L / 2 - 0.2] : [-L / 2 + 0.2, L / 2 - 0.2];
    for (const u of posts) f.box(M.steel, u, T + 0.62, 0, 0.03, 0.76, 0.03);
    for (const y of [T + 0.6, T + 0.98]) f.span(M.white, -L / 2 + 0.12, y, -0.17, L / 2 - 0.12, y + 0.02, 0.17);
    reagentRow(f, -L / 2 + 0.15, L / 2 - 0.15, T + 0.62, 0.08, { tall: 0.22, dense: 0.6 });
    reagentRow(fb, -L / 2 + 0.15, L / 2 - 0.15, T + 0.62, 0.08, { tall: 0.22, dense: 0.6 });
    // the top tier: boxed consumables, a few big bottles
    let u = -L / 2 + 0.2;
    while (u < L / 2 - 0.35) {
      const bw = 0.18 + rnd() * 0.22;
      if (rnd() < 0.7) f.box(pick(c, [M.card, M.white, M.card, M.blue]), u + bw / 2, T + 1.0 + 0.07, (rnd() - 0.5) * 0.08, bw, 0.14, 0.24);
      else f.cyl(M.white, u + 0.08, T + 1.0, 0, 0.07, 0.07, 0.24, 8);
      u += bw + 0.05 + rnd() * 0.15;
    }
  }
  if (gear > 0) {
    P.glassware(c, f.rect(-L / 2 + 0.15, 0.22, (sink ? L / 2 - 0.6 : L / 2 - 0.15), D / 2 - 0.08), T, gear);
    P.glassware(c, f.rect(-L / 2 + 0.15, -D / 2 + 0.08, L / 2 - 0.15, -0.22), T, gear);
  }
  f.col(-L / 2, -D / 2, L / 2, D / 2, T, SURF.metal);
  return f;
}

/** a lab stool at (x, z): five-star base on casters, gas lift, foot ring, round vinyl seat; `down`: lying on its side */
export function labStool(c, x, z, { yaw = 0, down = false, h = 0.62, seat = null } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, down ? { y: 0.3, tilt: [PI / 2 + 0.2, 0] } : {});
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2;
    f.add(M.dark, rbox(0.28, 0.03, 0.045), Math.sin(a) * 0.14, 0.07, Math.cos(a) * 0.14, [0, a + PI / 2, 0]);
    f.add(M.black, sphG(0.026, 6, 4), Math.sin(a) * 0.27, 0.03, Math.cos(a) * 0.27);
  }
  f.cyl(M.black, 0, 0.06, 0, 0.03, 0.03, 0.2, 8);
  f.cyl(X.chrome, 0, 0.25, 0, 0.022, 0.022, h - 0.3, 8);
  f.add(X.chrome, torG(0.19, 0.01, 4, 16), 0, 0.33, 0, [PI / 2, 0, 0]);
  for (let k = 0; k < 3; k++) f.rod(X.chrome, [0, 0.33, 0], [Math.sin(k * 2.1) * 0.19, 0.33, Math.cos(k * 2.1) * 0.19], 0.007, 4);
  f.cyl(M.dark, 0, h - 0.08, 0, 0.13, 0.15, 0.03, 12);
  f.cyl(seat ?? X.vinyl, 0, h - 0.05, 0, 0.19, 0.185, 0.07, 16);
  if (down) f.col(-0.3, -0.3, 0.3, 0.3, h, SURF.metal);
  else c.col(x - 0.2, 0, z - 0.2, x + 0.2, h, z + 0.2, SURF.metal);
}

/**
 * A steel lab trolley at (x, z) turned yaw: two lipped shelves, a push handle, casters, a load: 'glass', 'dewar',
 * 'bags', 'trays', 'boxes', 'linen' or null; `tipped`: on its side.
 */
export function labTrolley(c, x, z, yaw, { load = 'glass', w = 0.9, d = 0.55, tipped = false } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw, tipped ? { y: d / 2 + 0.03, tilt: [PI / 2, 0] } : {});
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.cyl(X.chrome, su * (w / 2 - 0.03), 0.1, sv * (d / 2 - 0.03), 0.013, 0.013, 0.84, 6);
  for (const y of [0.3, 0.85]) {
    f.span(M.steel, -w / 2, y, -d / 2, w / 2, y + 0.02, d / 2, 0.004);
    for (const sv of [-1, 1]) f.span(M.steel, -w / 2, y + 0.02, sv * (d / 2) - 0.008, w / 2, y + 0.05, sv * (d / 2) + 0.008);
  }
  for (const sv of [-1, 1]) f.rod(X.chrome, [-w / 2 + 0.03, 0.9, sv * (d / 2 - 0.05)], [-w / 2 - 0.1, 0.95, sv * (d / 2 - 0.05)], 0.012, 6);
  f.hcyl(X.rubber, -w / 2 - 0.1, 0.95, 0, 0.018, d - 0.06, 8, 'v');
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      f.box(M.dark, su * (w / 2 - 0.05), 0.08, sv * (d / 2 - 0.05), 0.03, 0.05, 0.05);
      f.hcyl(X.rubber, su * (w / 2 - 0.05), 0.05, sv * (d / 2 - 0.05), 0.05, 0.03, 10, 'u');
    }
  }
  const y = 0.87;
  if (load === 'glass') P.glassware(c, f.rect(-w / 2 + 0.1, -d / 2 + 0.08, w / 2 - 0.1, d / 2 - 0.08), y, 3);
  else if (load === 'dewar') {
    for (const u of [-0.2, 0.2]) {
      f.cyl(M.steel, u, y, 0, 0.13, 0.13, 0.36, 12);
      f.add(M.steel, domeG(0.13, 12), u, y + 0.36, 0);
      f.cyl(M.dark, u, y + 0.46, 0, 0.04, 0.04, 0.06, 8);
      f.add(M.frost, torG(0.13, 0.008, 4, 16), u, y + 0.34, 0, [PI / 2, 0, 0]);
    }
  } else if (load === 'bags') {
    for (let i = 0; i < 3; i++) f.add(X.bagRed, capG(0.12, 0.18, 3, 8), -0.22 + i * 0.22, y + 0.12, (rnd() - 0.5) * 0.1, [PI / 2, rnd(), 0.3], [1, 1, 0.8]);
    f.add(X.bagRed, capG(0.1, 0.2, 3, 8), 0, 0.42, 0, [PI / 2, 1.2, 0.2]);
  } else if (load === 'trays') {
    for (const u of [-0.2, 0.2]) {
      f.box(M.steel, u, y + 0.015, 0, 0.36, 0.03, 0.26, 0.006);
      for (let k = 0; k < 4; k++) f.box(X.chrome, u - 0.12 + k * 0.07, y + 0.034, (rnd() - 0.5) * 0.1, 0.012, 0.006, 0.16, 0, [0, (rnd() - 0.5) * 0.4, 0]);
    }
  } else if (load === 'boxes') {
    for (let i = 0; i < 3; i++) f.box(M.card, -0.25 + i * 0.25, y + 0.09, (rnd() - 0.5) * 0.08, 0.22, 0.18, 0.3, 0, [0, (rnd() - 0.5) * 0.3, 0]);
    f.box(M.card, 0.1, 0.42, 0, 0.4, 0.22, 0.32);
  } else if (load === 'linen') {
    for (let i = 0; i < 3; i++) f.box(i % 2 ? c.X.linen : c.X.blanket, 0, y + 0.04 + i * 0.07, 0, 0.6, 0.07, 0.4, 0.02);
    f.box(c.X.linen, 0, 0.36, 0, 0.62, 0.12, 0.42, 0.03);
  }
  f.col(-w / 2 - 0.12, -d / 2, w / 2, d / 2, 0.97, SURF.metal);
}

/**
 * A sink against the wall: kind 'lab' (a cabinet with a steel top, a drainer, a gooseneck tap), 'hand' (a wall-hung
 * handwash basin, sensor tap) or 'scrub' (a steel scrub trough with knee paddles). Soap and towel dispensers above.
 */
export function sinkUnit(c, x, z, face, { w = 0.9, kind = 'lab' } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  if (kind === 'hand') {
    f.box(M.white, 0, 0.83, 0.24, 0.52, 0.13, 0.44, 0.035);
    f.box(M.grey, 0, 0.897, 0.27, 0.4, 0.002, 0.28);
    f.cyl(X.chrome, 0, 0.898, 0.27, 0.025, 0.025, 0.003, 10);
    f.cyl(X.chrome, 0, 0.42, 0.14, 0.022, 0.022, 0.35, 8);
    f.hcyl(X.chrome, 0, 0.44, 0.07, 0.02, 0.14, 8, 'v');
    faucet(f, 0, 0.895, 0.07, 0.17, false);
    f.box(M.white, 0.36, 1.25, 0.05, 0.1, 0.17, 0.1, 0.01);
    f.box(M.dark, 0.36, 1.15, 0.09, 0.02, 0.03, 0.03);
    f.box(M.white, -0.42, 1.35, 0.07, 0.28, 0.32, 0.14, 0.02);
    f.box(X.paper, -0.42, 1.17, 0.1, 0.18, 0.05, 0.002, 0, [0.3, 0, 0]);
    f.label('WASH HANDS', 0, 1.62, 0.004, 0.36, 0.09, { bg: '#1f5fa6', fg: '#ffffff', border: '#1f5fa6', font: 'bold 50px Arial' });
    f.col(-0.26, 0, 0.26, 0.46, 0.9, SURF.metal);
    return f;
  }
  if (kind === 'scrub') {
    f.box(M.steel, 0, 0.93, 0.3, w, 0.16, 0.56, 0.02);
    f.span(M.black, -w / 2 + 0.05, 1.005, 0.08, w / 2 - 0.05, 1.012, 0.53);
    f.span(M.steel, -w / 2, 1.0, 0, w / 2, 1.62, 0.02);
    for (const s of [-1, 1]) {
      f.box(M.steel, s * (w / 2 - 0.08), 0.43, 0.3, 0.05, 0.86, 0.05);
      faucet(f, s * w * 0.22, 1.28, 0.025, 0.28, false);
      f.box(M.steel, s * w * 0.22, 0.55, 0.59, 0.16, 0.2, 0.03, 0.01);
    }
    f.box(M.grey, -w / 2 + 0.15, 1.4, 0.07, 0.2, 0.3, 0.12, 0.015);
    f.label('SCRUB · 5 MIN', w * 0.2, 1.48, 0.024, 0.34, 0.1, { bg: '#1b2127', fg: '#e8edf0', border: '#1b2127', font: 'bold 44px Arial' });
    f.col(-w / 2, 0, w / 2, 0.58, 1.0, SURF.metal);
    return f;
  }
  f.span(M.dark, -w / 2 + 0.03, 0, 0.03, w / 2 - 0.03, 0.1, 0.55);
  f.span(M.white, -w / 2, 0.1, 0.01, w / 2, 0.86, 0.6);
  for (const s of [-1, 1]) {
    f.span(M.white, s * 0.005, 0.12, 0.6, s * (w / 2 - 0.01), 0.84, 0.618);
    f.box(X.chrome, s * 0.05, 0.72, 0.63, 0.012, 0.12, 0.014);
  }
  f.span(M.steel, -w / 2, 0.86, 0, w / 2, 0.9, 0.64, 0.008);
  f.span(M.steel, -w / 2, 0.9, 0, w / 2, 1.08, 0.02);
  basin(f, -w * 0.12, 0.9, 0.34, w * 0.5, 0.42);
  for (let i = 0; i < 5; i++) f.box(M.steel, w * 0.2 + i * 0.045, 0.903, 0.34, 0.012, 0.006, 0.38);
  faucet(f, -w * 0.12, 0.9, 0.06, 0.24);
  f.box(M.white, w / 2 - 0.1, 1.28, 0.05, 0.1, 0.17, 0.1, 0.01);
  f.box(M.white, -w / 2 + 0.16, 1.4, 0.07, 0.28, 0.32, 0.14, 0.02);
  f.col(-w / 2, 0, w / 2, 0.64, 0.9, SURF.metal);
  return f;
}

/** a wall-mounted eyewash at (x, z): supply pipe, a green bowl with two capped nozzles, the push flag, its sign */
export function eyewash(c, x, z, face, y = 1.0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.cyl(M.steel, 0, y - 0.6, 0.05, 0.016, 0.016, 0.6, 8);
  f.rod(M.steel, [0, y, 0.05], [0, y, 0.2], 0.016, 8);
  f.cyl(X.safetyGreen, 0, y - 0.03, 0.2, 0.06, 0.13, 0.06, 14);
  f.cyl(M.dark, 0, y + 0.03, 0.2, 0.11, 0.11, 0.002, 14);
  for (const s of [-1, 1]) {
    f.cyl(M.steel, s * 0.04, y + 0.03, 0.2, 0.012, 0.012, 0.04, 8);
    f.cyl(M.yellow, s * 0.04, y + 0.07, 0.2, 0.02, 0.02, 0.012, 8);
  }
  f.box(X.safetyGreen, 0.16, y + 0.02, 0.2, 0.1, 0.06, 0.02, 0.005);
  f.label('EYE WASH', 0, y + 0.42, 0.004, 0.34, 0.12, { bg: '#1d9a4d', fg: '#ffffff', border: '#1d9a4d', font: 'bold 56px Arial' });
}

/** a combination safety shower + eyewash standing against the wall at (x, z): the head, pull rod, bowl, drain, sign */
export function safetyShower(c, x, z, face, { eyewash: ew = true, h = 2.35 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const Y = M.yellow;
  f.cyl(M.dark, 0, 0, 0.14, 0.12, 0.12, 0.02, 12);
  f.cyl(Y, 0, 0.02, 0.14, 0.032, 0.032, h - 0.05, 10);
  f.add(Y, sphG(0.042, 8, 6), 0, h - 0.03, 0.14);
  f.rod(Y, [0, h - 0.03, 0.14], [0, h - 0.03, 0.62], 0.028, 8);
  f.cyl(Y, 0, h - 0.1, 0.62, 0.03, 0.03, 0.08, 8);
  f.cyl(Y, 0, h - 0.26, 0.62, 0.26, 0.05, 0.16, 16);
  f.add(M.dark, discG(0.25, 16), 0, h - 0.262, 0.62, [PI / 2, 0, 0]);
  // the pull rod and its triangle
  f.rod(M.steel, [0, h - 0.04, 0.4], [0, 1.78, 0.4], 0.006, 4);
  f.rod(Y, [0, 1.78, 0.4], [-0.08, 1.64, 0.4], 0.01, 4);
  f.rod(Y, [0, 1.78, 0.4], [0.08, 1.64, 0.4], 0.01, 4);
  f.rod(Y, [-0.08, 1.64, 0.4], [0.08, 1.64, 0.4], 0.01, 4);
  if (ew) {
    f.rod(Y, [0, 0.98, 0.14], [0, 0.98, 0.4], 0.022, 8);
    f.cyl(Y, 0, 0.93, 0.5, 0.08, 0.16, 0.08, 16);
    f.cyl(X.labGrey, 0, 1.01, 0.5, 0.14, 0.14, 0.002, 16);
    for (const s of [-1, 1]) {
      f.cyl(M.steel, s * 0.05, 1.01, 0.5, 0.012, 0.012, 0.04, 8);
      f.cyl(M.yellow, s * 0.05, 1.05, 0.5, 0.02, 0.02, 0.012, 8);
    }
    f.box(X.safetyGreen, 0.2, 0.99, 0.5, 0.09, 0.12, 0.02, 0.005, [0, PI / 2, 0]);
    f.cyl(Y, 0, 0.35, 0.5, 0.02, 0.02, 0.6, 8);
    f.label('EYE WASH', 0, 1.35, 0.004, 0.34, 0.1, { bg: '#1d9a4d', fg: '#ffffff', border: '#1d9a4d', font: 'bold 56px Arial' });
  }
  f.label('SAFETY SHOWER', 0, Math.min(h + 0.28, 2.75), 0.004, 0.56, 0.14, { bg: '#1d9a4d', fg: '#ffffff', border: '#1d9a4d', font: 'bold 56px Arial' });
  const p = f.p(0, 0, 0.62);
  drainGrate(c, p.x, p.z, 0.3, 0.3);
  f.col(-0.2, 0, 0.2, ew ? 0.66 : 0.3, 1.1, SURF.metal);
}

/**
 * A chemical fume hood against the wall: storage cabinets under it (flammables yellow / acids blue), an epoxy work
 * well, a sash half down, baffles, services, an airflow monitor, a duct to the ceiling, its light. w across.
 */
export function chemHood(c, x, z, face, { w = 1.5, ceil = 4, base = 'flam', light = true, gear = 3 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  const D = 0.88, T = 0.92, H = 2.45;
  const mats = base === 'flam' ? [X.flamYellow, X.acidBlue] : base === 'acid' ? [X.acidBlue, X.acidBlue] : [M.white, M.white];
  f.span(M.dark, -w / 2 + 0.03, 0, 0.03, w / 2 - 0.03, 0.08, D - 0.06);
  mats.forEach((mat, i) => {
    const s = i ? 1 : -1;
    f.span(mat, s < 0 ? -w / 2 : 0.006, 0.08, 0.02, s < 0 ? -0.006 : w / 2, 0.86, D - 0.03, 0.01);
    f.box(M.dark, s * 0.07, 0.62, D - 0.026, 0.012, 0.14, 0.012);
    if (base === 'flam' || base === 'acid') {
      const flam = mat === X.flamYellow;
      f.label(flam ? 'FLAMMABLE' : 'CORROSIVE', (s * w) / 4, 0.4, D - 0.028, w * 0.36, 0.08, { bg: flam ? '#e6b81b' : '#1d5da8', fg: flam ? '#b3141a' : '#ffffff', border: flam ? '#e6b81b' : '#1d5da8', font: 'bold 56px Arial' });
    }
  });
  f.span(M.top, -w / 2, 0.86, 0, w / 2, T, D, 0.01);
  f.span(M.top, -w / 2 + 0.07, T, D - 0.07, w / 2 - 0.07, T + 0.016, D - 0.035);
  // the hood's walls, baffle and top box
  for (const s of [-1, 1]) {
    f.span(M.white, s * (w / 2), T, 0, s * (w / 2 - 0.07), H, D - 0.04, 0.012);
    f.box(X.labGrey, s * (w / 2 - 0.04), (T + 2.0) / 2, D - 0.03, 0.09, 2.0 - T, 0.06, 0.02);
  }
  f.span(M.white, -w / 2, T, 0, w / 2, H, 0.05);
  f.span(X.labGrey, -w / 2 + 0.09, T + 0.04, 0.05, w / 2 - 0.09, 1.95, 0.08);
  for (const y of [T + 0.08, T + 0.55, 1.8]) f.span(M.black, -w / 2 + 0.16, y, 0.081, w / 2 - 0.16, y + 0.035, 0.083);
  f.span(M.white, -w / 2, 2.0, 0, w / 2, H, D, 0.02);
  f.box(U.panel, 0, 1.992, D * 0.45, w - 0.3, 0.012, 0.3);
  f.label('FUME HOOD · KEEP SASH LOW', 0, 2.22, D + 0.002, w * 0.62, 0.1, { bg: '#e4e7ea', fg: '#1b2127', border: '#e4e7ea', font: 'bold 44px Arial' });
  // the sash, half down
  const sy = 1.3;
  for (const s of [-1, 1]) f.box(X.chrome, s * (w / 2 - 0.1), (sy + 2.0) / 2, D - 0.03, 0.02, 2.0 - sy, 0.02);
  f.span(U.glass, -w / 2 + 0.1, sy + 0.02, D - 0.036, w / 2 - 0.1, 1.99, D - 0.026);
  f.hcyl(X.chrome, 0, sy, D - 0.01, 0.014, w - 0.2, 8, 'u');
  f.label('▲ MAX 45 cm', w / 2 - 0.05, 1.42, D + 0.001, 0.08, 0.05, { bg: '#e6b81b', fg: '#16181a', border: '#e6b81b', font: 'bold 30px Arial' });
  // airflow monitor on the right post, services inside
  f.box(M.dark, w / 2 - 0.045, 1.62, D + 0.005, 0.07, 0.12, 0.02);
  f.label('0.52 m/s', w / 2 - 0.045, 1.645, D + 0.016, 0.055, 0.03, { bg: '#08140e', fg: '#7dffa0', border: '#08140e', font: 'bold 40px monospace' });
  f.box(U.ledG, w / 2 - 0.045, 1.59, D + 0.016, 0.012, 0.012, 0.004);
  for (let i = 0; i < 2; i++) {
    const v = 0.3 + i * 0.18;
    f.hcyl(X.brass, -w / 2 + 0.1, T + 0.2, v, 0.01, 0.08, 6, 'u');
    f.box(i ? M.blue : M.green, -w / 2 + 0.09, T + 0.24, v, 0.016, 0.03, 0.05);
  }
  basin(f, w / 2 - 0.3, T, 0.25, 0.16, 0.14);
  if (gear) P.glassware(c, f.rect(-w / 2 + 0.2, 0.15, w / 2 - 0.45, D - 0.2), T, gear);
  f.cyl(M.steel, 0, H, D * 0.45, 0.15, 0.15, Math.max(0.1, ceil - H), 12);
  f.cyl(M.dark, 0, H + 0.2, D * 0.45, 0.16, 0.16, 0.06, 12);
  if (light) f.light(0, 1.9, D * 0.45, 0.32, 1.2, COOL, DOWN, 3);
  f.col(-w / 2, 0, w / 2, D, H, SURF.metal);
  return f;
}

/**
 * A class II biosafety cabinet on its stand: a sloped sash, a steel work tray with the front grille, the blower box
 * with its control panel, the UV tube glowing violet (`uv`), a few things left inside. w across.
 */
export function biosafetyCabinet(c, x, z, face, { w = 1.5, uv = true, light = true, mess = true } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const D = 0.82, B = 0.72, T = 0.97;
  for (const su of [-1, 1]) {
    for (const v of [0.08, D - 0.14]) {
      f.box(M.steel, su * (w / 2 - 0.07), B / 2, v, 0.045, B, 0.045);
      f.cyl(M.black, su * (w / 2 - 0.07), 0, v, 0.03, 0.03, 0.02, 8);
    }
    f.box(M.steel, su * (w / 2 - 0.07), 0.2, D / 2 - 0.03, 0.03, 0.03, D - 0.25);
  }
  f.box(M.steel, 0, 0.2, 0.08, w - 0.14, 0.03, 0.03);
  f.span(M.white, -w / 2, B, 0, w / 2, T - 0.02, D - 0.03, 0.015);
  for (const s of [-1, 1]) f.span(M.white, s * (w / 2), T - 0.02, 0, s * (w / 2 - 0.08), 2.05, D - 0.04, 0.012);
  f.span(M.white, -w / 2, T - 0.02, 0, w / 2, 2.05, 0.06);
  f.span(M.steel, -w / 2 + 0.08, T - 0.02, 0.06, w / 2 - 0.08, T, D - 0.12);
  f.span(M.black, -w / 2 + 0.08, T - 0.015, D - 0.16, w / 2 - 0.08, T + 0.002, D - 0.1);
  f.span(M.white, -w / 2, 1.82, D - 0.12, w / 2, 2.05, D - 0.03);
  f.span(M.white, -w / 2, 2.05, 0, w / 2, 2.45, D - 0.03, 0.025);
  for (let i = 0; i < 6; i++) f.span(M.dark, -w / 2 + 0.1 + i * 0.12, 2.28, D - 0.029, -w / 2 + 0.18 + i * 0.12, 2.3, D - 0.026);
  // the sloped sash (its top leans back), handle bar
  f.box(U.glass, 0, 1.45, D - 0.08, w - 0.18, 0.66, 0.012, 0, [-0.17, 0, 0]);
  f.hcyl(X.chrome, 0, 1.13, D - 0.03, 0.012, w - 0.3, 8, 'u');
  // controls
  f.box(M.black, 0, 1.94, D - 0.025, 0.36, 0.1, 0.01);
  f.label(uv ? 'UV CYCLE · 00:14' : 'AIRFLOW OK', 0, 1.94, D - 0.019, 0.34, 0.08, { bg: '#08140e', fg: uv ? '#c9a8ff' : '#7dffa0', border: '#08140e', font: 'bold 40px monospace' });
  for (let i = 0; i < 4; i++) f.box(i === 0 ? U.ledG : M.dark, 0.26 + i * 0.05, 1.94, D - 0.024, 0.03, 0.03, 0.012);
  f.label('CLASS II BSC', -w / 2 + 0.24, 1.94, D - 0.024, 0.3, 0.07, { bg: '#e4e7ea', fg: '#1b2127', border: '#e4e7ea', font: 'bold 40px Arial' });
  f.plane(M.signs, 0.2, 0.2, 0, 1.55, 0.001, SIGN.bio, 1024, 1024, 0);
  f.plane(M.signs, 0.18, 0.18, w / 2 + 0.001, 1.6, D / 2, SIGN.bio, 1024, 1024, PI / 2);
  if (uv) {
    f.hcyl(G.uv, 0, 1.76, 0.2, 0.012, w - 0.3, 8, 'u');
    if (light) f.light(0, 1.4, 0.4, 0.3, 1.0, [0.62, 0.42, 1.0], null, 2.6);
  } else {
    f.box(U.panel, 0, 1.8, 0.35, w - 0.3, 0.01, 0.2);
    if (light) f.light(0, 1.7, 0.4, 0.3, 1.0, COOL, DOWN, 2.6);
  }
  // left inside: a tube rack, a waste beaker, a pipette
  f.box(M.white, -0.3, T + 0.03, 0.4, 0.2, 0.06, 0.08);
  for (let i = 0; i < 5; i++) f.cyl(i === 2 ? U.magenta : U.glass, -0.38 + i * 0.04, T + 0.02, 0.4, 0.008, 0.008, 0.1, 6);
  f.cyl(U.glass, 0.25, T, 0.35, 0.05, 0.05, 0.14, 10, true);
  f.cyl(X.medium, 0.25, T + 0.004, 0.35, 0.045, 0.045, 0.05, 10);
  f.add(X.labGrey, cylC(0.012, 0.012, 0.2, 6), 0.05 + rnd() * 0.1, T + 0.012, 0.45, [0, 0, PI / 2 - 0.1]);
  if (mess) f.add(X.nitrile, rbox(0.08, 0.01, 0.12, 0.004), -0.1, T + 0.005, 0.25, [0, 0.6, 0]);
  f.col(-w / 2, 0, w / 2, D, 2.45, SURF.metal);
  return f;
}

/**
 * A safety storage cabinet: kind 'flam' (yellow, FLAMMABLE), 'acid' (blue, CORROSIVE) or 'tox' (white, TOXIC); two
 * doors with a three-point handle, vent bungs, GHS diamonds; `ajar` swings the right door open onto its shelves.
 */
export function chemCabinet(c, x, z, face, { kind = 'flam', w = 1.1, h = 1.65, d = 0.5, ajar = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const mat = kind === 'flam' ? X.flamYellow : kind === 'acid' ? X.acidBlue : M.white;
  const t = 0.03;
  for (const su of [-1, 1]) for (const sv of [0.06, d - 0.06]) f.cyl(M.black, su * (w / 2 - 0.06), 0, sv, 0.025, 0.025, 0.05, 8);
  f.span(mat, -w / 2, 0.05, 0, w / 2, h, t);
  f.span(mat, -w / 2, 0.05, 0, -w / 2 + t, h, d - 0.02);
  f.span(mat, w / 2 - t, 0.05, 0, w / 2, h, d - 0.02);
  f.span(mat, -w / 2, h - t, 0, w / 2, h, d - 0.02, 0.008);
  f.span(mat, -w / 2, 0.05, 0, w / 2, 0.12, d - 0.02);
  f.span(mat, -0.01, 0.05, 0, 0.01, h, d - 0.04);
  // shelves (the stock only shows when the door is open), a sump at the bottom
  for (const y of [0.55, 1.05]) f.span(mat, t - w / 2, y, t, w / 2 - t, y + 0.02, d - 0.05);
  const inside = new Frame(c, f.p(w / 4, 0, 0).x, f.p(w / 4, 0, 0).z, face);
  if (ajar) {
    reagentRow(inside, -w / 4 + 0.02, w / 4 - 0.03, 0.57, d / 2, { tall: 0.3 });
    reagentRow(inside, -w / 4 + 0.02, w / 4 - 0.03, 1.07, d / 2, { tall: 0.3 });
    reagentRow(inside, -w / 4 + 0.02, w / 4 - 0.03, 0.12, d / 2, { tall: 0.34 });
  }
  // the leaves, hinged at the outer edges (the right one swings out when ajar)
  const ww = w / 2 - 0.012;
  const leaf = (s) => cached('cabLeaf' + k3(ww, h) + s, () => new RoundedBoxGeometry(ww, h - 0.1, 0.022, 1, 0.006).translate((s * ww) / 2, 0, 0));
  f.add(mat, leaf(1), -w / 2 + 0.004, (h + 0.05) / 2, d - 0.009);
  f.add(mat, leaf(-1), w / 2 - 0.004, (h + 0.05) / 2, d - 0.009, [0, ajar ? 1.25 : 0, 0]);
  f.box(X.chrome, -0.03, h * 0.55, d + 0.02, 0.025, 0.3, 0.02, 0.006);
  f.cyl(M.dark, -0.03, h * 0.55 + 0.19, d, 0.012, 0.012, 0.02, 8);
  const flam = kind === 'flam', acid = kind === 'acid';
  const bg = flam ? '#e6b81b' : acid ? '#1d5da8' : '#e4e7ea';
  const fg = flam ? '#b3141a' : acid ? '#ffffff' : '#b3141a';
  const txt = flam ? ['FLAMMABLE', 'KEEP FIRE AWAY'] : acid ? ['CORROSIVE', 'ACIDS · BASES'] : ['TOXIC', 'POISONS · LOCKED'];
  f.label(txt[0], -w / 4, h - 0.3, d + 0.002, w * 0.44, 0.12, { bg, fg, border: bg, font: 'bold 64px Arial' });
  f.label(txt[1], -w / 4, h - 0.44, d + 0.002, w * 0.44, 0.08, { bg, fg, border: bg, font: 'bold 44px Arial' });
  ghs(f, -w / 4, 0.6, d + 0.003, 0.16, flam ? 'flame' : '!');
  for (const s of [-1, 1]) f.hcyl(M.dark, s * (w / 2 + 0.015), h - 0.25, d / 2, 0.03, 0.03, 10, 'u');
  f.col(-w / 2, 0, w / 2, d + 0.03, h, SURF.metal);
}

/**
 * An upright glass-door lab fridge: a hollow white cabinet (you see into it), wire shelves stocked with `stock`
 * ('samples', 'jars', 'bags', 'media'), the interior light (`glow` adds a baked one), the display, a kick grille.
 */
export function labFridge(c, x, z, face, { w = 0.8, h = 1.95, d = 0.72, glow = false, stock = 'samples', display = '+4 °C', light = true } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const t = 0.05;
  f.span(M.white, -w / 2, 0, 0, w / 2, h, t);
  for (const s of [-1, 1]) f.span(M.white, s * (w / 2), 0, 0, s * (w / 2 - t), h, d, 0.008);
  f.span(M.white, -w / 2, h - 0.2, 0, w / 2, h, d, 0.012);
  f.span(M.white, -w / 2, 0, 0, w / 2, 0.22, d);
  for (let i = 0; i < 3; i++) f.span(M.black, -w / 2 + 0.06, 0.05 + i * 0.05, d, w / 2 - 0.06, 0.07 + i * 0.05, d + 0.004);
  // shelves and stock
  const nS = 4;
  for (let k = 0; k < nS; k++) {
    const y = 0.28 + (k * (h - 0.55)) / nS;
    f.span(M.steel, -w / 2 + t, y, t, w / 2 - t, y + 0.012, d - 0.05);
    let u = -w / 2 + t + 0.05;
    while (u < w / 2 - t - 0.06) {
      const k2 = rnd();
      const v = t + 0.12 + rnd() * (d - 0.35);
      if (stock === 'jars') {
        f.cyl(U.glass, u + 0.02, y + 0.012, v, 0.055, 0.055, 0.2, 8, true);
        f.cyl(k2 < 0.3 ? U.murk : M.amber, u + 0.02, y + 0.014, v, 0.05, 0.05, 0.15, 8);
        if (k2 >= 0.3) f.add(X.specimen, sphG(0.035, 6, 4), u + 0.02, y + 0.08, v, null, [1, 0.8, 1.2]);
        f.cyl(M.dark, u + 0.02, y + 0.21, v, 0.057, 0.057, 0.025, 8);
        u += 0.15;
      } else if (stock === 'bags') {
        f.box(X.bagRed, u + 0.05, y + 0.1, v, 0.1, 0.17, 0.035, 0.012, [0.25, 0, 0]);
        u += 0.12;
      } else if (k2 < 0.55) {
        const mat = stock === 'media' ? X.medium : pick(c, [M.white, M.amber, M.white, X.medium]);
        f.cyl(mat, u + 0.03, y + 0.012, v, 0.028, 0.028, 0.12, 8);
        f.cyl(pick(c, [M.blue, M.red, M.yellow, M.white]), u + 0.03, y + 0.132, v, 0.02, 0.02, 0.02, 8);
        u += 0.07;
      } else if (k2 < 0.8) {
        f.box(pick(c, [M.white, M.blue, M.yellow, M.card]), u + 0.07, y + 0.04, v, 0.13, 0.055, 0.13);
        u += 0.16;
      } else u += 0.08;
    }
  }
  // the door: frame, glass, handle; the light strip, the display
  f.span(M.dark, -w / 2, 0.22, d, w / 2, 0.27, d + 0.035);
  f.span(M.dark, -w / 2, h - 0.25, d, w / 2, h - 0.2, d + 0.035);
  for (const s of [-1, 1]) f.span(M.dark, s * (w / 2), 0.22, d, s * (w / 2 - 0.05), h - 0.2, d + 0.035);
  f.span(U.glass, -w / 2 + 0.05, 0.27, d + 0.014, w / 2 - 0.05, h - 0.25, d + 0.022);
  f.box(X.chrome, w / 2 - 0.08, 1.15, d + 0.07, 0.025, 0.6, 0.025, 0.008);
  for (const y of [0.9, 1.4]) f.box(X.chrome, w / 2 - 0.08, y, d + 0.05, 0.02, 0.02, 0.04);
  if (light) f.span(G.fridge, -w / 2 + 0.08, h - 0.215, 0.1, w / 2 - 0.08, h - 0.205, 0.22);
  f.box(M.black, 0, h - 0.1, d + 0.002, 0.2, 0.07, 0.004);
  f.label(display, 0, h - 0.1, d + 0.005, 0.17, 0.055, { bg: '#0b1418', fg: '#5ee0ff', border: '#0b1418', font: 'bold 48px monospace' });
  f.box(U.ledG, 0.14, h - 0.1, d + 0.004, 0.012, 0.012, 0.006);
  if (glow) f.light(0, h * 0.55, d + 0.25, 0.22, 1.0, [0.86, 0.95, 1.0], null, 2.6);
  f.col(-w / 2, 0, w / 2, d + 0.04, h, SURF.metal);
}

/**
 * An upright ultra-low freezer (−80 °C, or `temp`): cream body on casters, a proud door with the lever handle, the
 * control head (display, keypad, alarm LED), frost at the seal, the compressor grille. `note`: a label on the door.
 */
export function freezerUpright(c, x, z, face, { w = 0.82, h = 1.98, d = 0.85, temp = -80, alarm = false, note = null } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.cream, -w / 2, 0.08, 0, w / 2, h, d - 0.07, 0.02);
  for (const su of [-1, 1]) for (const sv of [0.1, d - 0.2]) f.cyl(M.black, su * (w / 2 - 0.08), 0, sv, 0.035, 0.035, 0.08, 8);
  f.span(X.cream, -w / 2 + 0.012, 0.3, d - 0.07, w / 2 - 0.012, h - 0.22, d, 0.018);
  f.span(M.frost, -w / 2 + 0.012, h - 0.225, d - 0.075, w / 2 - 0.012, h - 0.212, d - 0.066);
  f.span(M.frost, -w / 2 + 0.012, 0.29, d - 0.075, w / 2 - 0.012, 0.302, d - 0.066);
  f.span(M.dark, -w / 2 + 0.04, h - 0.19, d - 0.07, w / 2 - 0.04, h - 0.03, d - 0.03);
  if (temp === -80) f.plane(M.signs, 0.16, 0.08, -0.14, h - 0.11, d - 0.029, SIGN.freezer);
  else f.label(`${temp}°C`, -0.14, h - 0.11, d - 0.029, 0.16, 0.08, { bg: '#0b1418', fg: '#5ee0ff', border: '#0b1418', font: 'bold 64px monospace' });
  f.plane(M.signs, 0.07, 0.1, 0.1, h - 0.11, d - 0.029, SIGN.keypad);
  f.box(U.ledG, 0.25, h - 0.08, d - 0.028, 0.014, 0.014, 0.004);
  f.box(alarm ? U.ledR : M.dark, 0.25, h - 0.13, d - 0.028, 0.014, 0.014, 0.004);
  f.box(X.chrome, w / 2 - 0.1, 1.25, d + 0.04, 0.045, 0.5, 0.05, 0.012);
  f.cyl(M.dark, w / 2 - 0.1, 1.52, d + 0.01, 0.012, 0.012, 0.04, 8);
  for (let i = 0; i < 4; i++) f.span(M.black, -w / 2 + 0.08, 0.1 + i * 0.045, d - 0.068, w / 2 - 0.08, 0.12 + i * 0.045, d - 0.064);
  if (note) {
    const lines = Array.isArray(note) ? note : [note];
    f.label(lines.join(' · '), -0.08, 1.2, d + 0.002, 0.42, 0.26, { bg: '#f7f5ec', fg: '#1d2b3a', border: '#f7f5ec', font: 'bold 34px Arial', lines });
  }
  f.col(-w / 2, 0, w / 2, d + 0.06, h, SURF.metal);
}

/**
 * CO₂ incubators stacked on a stand: rounded bodies, a display each (37 °C · 5 % CO₂); unit `open` (index) stands
 * with its outer door swung wide, the inner glass door and the shelves of pink culture flasks behind it.
 */
export function incubator(c, x, z, face, { stack = 2, open = -1, w = 0.72, d = 0.78 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  for (const su of [-1, 1]) for (const v of [0.08, d - 0.1]) f.box(M.steel, su * (w / 2 - 0.05), 0.15, v, 0.04, 0.3, 0.04);
  f.span(M.steel, -w / 2, 0.28, 0, w / 2, 0.3, d - 0.02);
  for (let k = 0; k < stack; k++) {
    const y0 = 0.3 + k * 0.84, y1 = y0 + 0.8;
    if (k === open) {
      f.span(M.white, -w / 2, y0, 0, w / 2, y1, 0.04, 0.01);
      for (const s of [-1, 1]) f.span(M.white, s * (w / 2), y0, 0, s * (w / 2 - 0.04), y1, d - 0.06, 0.01);
      f.span(M.white, -w / 2, y1 - 0.06, 0, w / 2, y1, d - 0.06, 0.01);
      f.span(M.white, -w / 2, y0, 0, w / 2, y0 + 0.06, d - 0.06, 0.01);
      for (let s = 0; s < 3; s++) {
        const y = y0 + 0.08 + s * 0.22;
        f.span(M.steel, -w / 2 + 0.04, y, 0.04, w / 2 - 0.04, y + 0.01, d - 0.1);
        for (let i = 0; i < 4; i++) {
          const u = -w / 2 + 0.12 + i * 0.15;
          f.box(U.glass, u, y + 0.03, 0.35, 0.08, 0.04, 0.14);
          f.box(X.medium, u, y + 0.018, 0.35, 0.072, 0.014, 0.13);
          f.cyl(M.blue, u, y + 0.03, 0.44, 0.012, 0.012, 0.025, 6);
        }
      }
      f.span(U.glass, -w / 2 + 0.04, y0 + 0.06, d - 0.07, w / 2 - 0.04, y1 - 0.06, d - 0.06);
      const g = cached('incDoor' + k3(w), () => new RoundedBoxGeometry(w - 0.02, 0.76, 0.05, 1, 0.02).translate((w - 0.02) / 2, 0, 0));
      f.add(M.white, g, -w / 2 + 0.01, (y0 + y1) / 2, d - 0.04, [0, -1.75, 0]);
      continue;
    }
    f.span(M.white, -w / 2, y0, 0, w / 2, y1, d - 0.06, 0.025);
    f.span(M.white, -w / 2 + 0.01, y0 + 0.02, d - 0.06, w / 2 - 0.01, y1 - 0.02, d - 0.01, 0.02);
    f.box(M.dark, w / 2 - 0.06, (y0 + y1) / 2, d, 0.03, 0.3, 0.02);
    f.box(M.black, -0.05, y1 - 0.1, d - 0.006, 0.36, 0.1, 0.006);
    f.label('37.0 °C   5.0 % CO₂', -0.05, y1 - 0.1, d - 0.002, 0.33, 0.07, { bg: '#08140e', fg: '#7dffa0', border: '#08140e', font: 'bold 40px monospace' });
    f.box(U.ledG, 0.2, y1 - 0.1, d - 0.002, 0.012, 0.012, 0.004);
  }
  f.rod(M.dark, [w / 2 - 0.1, 0.3 + stack * 0.84 - 0.1, 0.02], [w / 2 - 0.1, 0.3 + stack * 0.84 - 0.1, -0.001], 0.008, 4);
  f.col(-w / 2, 0, w / 2, d, 0.3 + stack * 0.84, SURF.metal);
}

/**
 * An autoclave: size 'floor' (a front-loader with a round door, locking wheel, gauges and a control panel) or 'bulk'
 * (a cart-in steriliser with a vertical door, control column and floor rails); `through`: a pass-through with a
 * door at both ends (then (x, z) is its back end and `len` its length).
 */
export function autoclave(c, x, z, face, { size = 'floor', through = false, len = 1.5, ceil = 4, label = 'STERILIZING · 121 °C · 2.1 bar' } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  if (size === 'floor') {
    const W = 1.0, H = 1.62, D = 0.95;
    f.span(M.dark, -W / 2 + 0.03, 0, 0.05, W / 2 - 0.03, 0.1, D - 0.05);
    f.span(M.steel, -W / 2, 0.1, 0.02, W / 2, H, D, 0.03);
    // the round door with its wheel
    f.add(M.steel, cylC(0.34, 0.34, 0.08, 24), -0.12, 0.92, D + 0.04, [PI / 2, 0, 0]);
    f.add(X.chrome, torG(0.34, 0.022, 5, 24), -0.12, 0.92, D + 0.08);
    f.add(X.chrome, torG(0.13, 0.016, 5, 16), -0.12, 0.92, D + 0.16);
    for (let k = 0; k < 4; k++) f.add(X.chrome, rbox(0.26, 0.018, 0.018), -0.12, 0.92, D + 0.13, [0, 0, (k * PI) / 4]);
    f.hcyl(X.chrome, -0.12, 0.92, D + 0.11, 0.03, 0.06, 10, 'v');
    f.box(M.dark, -0.5, 0.92, D + 0.02, 0.08, 0.3, 0.06);
    // the control panel column on the right
    f.span(M.dark, 0.26, 0.55, D, 0.48, 1.5, D + 0.02);
    f.label(label, 0.37, 1.38, D + 0.022, 0.2, 0.12, { bg: '#08140e', fg: '#7dffa0', border: '#08140e', font: 'bold 30px monospace', lines: label.split(' · ') });
    f.gauge(0.37, 1.15, D + 0.02, 0.1);
    f.gauge(0.37, 0.98, D + 0.02, 0.1);
    for (let i = 0; i < 3; i++) f.box([U.ledG, U.ledA, M.red][i], 0.3 + i * 0.07, 0.8, D + 0.03, 0.035, 0.035, 0.02);
    f.label('CAUTION · HOT SURFACE', -0.12, 1.45, D + 0.002, 0.44, 0.08, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 40px Arial' });
    // steam supply up the wall, a drain to the floor
    f.cyl(M.steel, 0.3, H, 0.1, 0.03, 0.03, Math.max(0.1, ceil - H), 8);
    f.add(M.red, torG(0.06, 0.01, 4, 12), 0.3, H + 0.3, 0.16, [0, 0, 0]);
    f.rod(M.steel, [0.3, H + 0.3, 0.1], [0.3, H + 0.3, 0.16], 0.012, 6);
    f.cyl(M.steel, -0.4, 0, 0.04, 0.02, 0.02, 0.12, 8);
    f.col(-W / 2, 0, W / 2, D + 0.15, H, SURF.metal);
    return f;
  }
  // bulk / pass-through: a long steel box, a square door at the front (and at the back when through)
  const W = 1.3, H = 2.1, D = through ? len : 1.5;
  f.span(M.dark, -W / 2 + 0.03, 0, 0.05, W / 2 - 0.03, 0.1, D - 0.05);
  f.span(M.steel, -W / 2, 0.1, 0.02, W / 2, H, D - 0.02, 0.03);
  const door = (fr, v) => {
    fr.span(M.dark, -0.5, 0.18, v, 0.35, 1.8, v + 0.03);
    fr.span(M.steel, -0.46, 0.22, v + 0.03, 0.31, 1.76, v + 0.06, 0.012);
    for (const y of [0.4, 1.0, 1.6]) fr.box(X.chrome, 0.25, y, v + 0.08, 0.05, 0.08, 0.04);
    fr.span(M.dark, 0.4, 0.3, v, 0.62, 1.95, v + 0.04);
    fr.label('ST-2 · CART-IN STERILISER', -0.07, 1.95, v + 0.002, 0.8, 0.09, { bg: '#1b2127', fg: '#e8edf0', border: '#1b2127', font: 'bold 40px Arial' });
    fr.label(label, 0.51, 1.7, v + 0.042, 0.18, 0.14, { bg: '#08140e', fg: '#7dffa0', border: '#08140e', font: 'bold 28px monospace', lines: label.split(' · ') });
    fr.gauge(0.51, 1.38, v + 0.04, 0.1);
    fr.add(M.red, cylC(0.035, 0.035, 0.04, 10), 0.51, 1.15, v + 0.06, [PI / 2, 0, 0]);
    fr.box(U.ledG, 0.46, 0.95, v + 0.045, 0.02, 0.02, 0.01);
    fr.box(U.ledA, 0.56, 0.95, v + 0.045, 0.02, 0.02, 0.01);
  };
  door(f, D - 0.02);
  // (the far door: a frame at the front turned round, so its v runs back to this one's v 0)
  if (through) door(new Frame(c, f.p(0, 0, D).x, f.p(0, 0, D).z, BACK[f.face]), D - 0.02);
  else for (const s of [-0.35, 0.35]) f.span(M.steel, s - 0.03, 0, D, s + 0.03, 0.03, D + 0.7);
  f.cyl(M.steel, -0.3, H, D * 0.33, 0.05, 0.05, Math.max(0.1, ceil - H), 8);
  f.cyl(M.steel, 0.2, H, D * 0.47, 0.03, 0.03, Math.max(0.1, ceil - H), 8);
  f.col(-W / 2, 0, W / 2, D, H, SURF.metal);
  return f;
}
// ---------------------------------------------------------------- instruments
/** a benchtop centrifuge on a surface at (x, y, z) turned yaw: rounded body, the lid (its window), a sloped panel */
export function centrifuge(c, x, y, z, yaw = 0, { open = false } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(X.labGrey, 0, 0.13, 0, 0.42, 0.26, 0.5, 0.04);
  if (open) {
    const g = cached('cfLid', () => new RoundedBoxGeometry(0.38, 0.03, 0.4, 1, 0.012).translate(0, 0, 0.2));
    f.add(X.cream, g, 0, 0.275, -0.23, [-1.25, 0, 0]);
    f.cyl(M.black, 0, 0.26, -0.03, 0.16, 0.16, 0.004, 16);
    f.cyl(M.steel, 0, 0.2, -0.03, 0.14, 0.12, 0.07, 16);
    for (let k = 0; k < 6; k++) f.cyl(M.dark, Math.cos(k * 1.05) * 0.1, 0.22, -0.03 + Math.sin(k * 1.05) * 0.1, 0.022, 0.022, 0.05, 6);
  } else {
    f.box(X.cream, 0, 0.275, -0.03, 0.38, 0.03, 0.4, 0.012);
    f.add(M.black, discG(0.1, 16), 0, 0.2905, -0.03, [-PI / 2, 0, 0]);
    f.add(X.chrome, torG(0.1, 0.006, 3, 16), 0, 0.291, -0.03, [PI / 2, 0, 0]);
  }
  f.add(M.dark, rbox(0.36, 0.09, 0.02, 0.006), 0, 0.2, 0.245, [-0.45, 0, 0]);
  f.add(G.lcd, rbox(0.12, 0.04, 0.004), -0.07, 0.206, 0.256, [-0.45, 0, 0]);
  for (let i = 0; i < 3; i++) f.add(i ? M.black : M.green, rbox(0.03, 0.02, 0.008), 0.06 + i * 0.04, 0.2, 0.257, [-0.45, 0, 0]);
}

/** a floor-standing centrifuge against the wall: cream body, the lid with a window ring, sloped keypad, a warning */
export function floorCentrifuge(c, x, z, face) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, face);
  const W = 0.74, H = 0.98, D = 0.82;
  f.span(M.dark, -W / 2 + 0.04, 0, 0.05, W / 2 - 0.04, 0.08, D - 0.05);
  f.span(X.cream, -W / 2, 0.08, 0.02, W / 2, 0.92, D, 0.04);
  f.span(X.labGrey, -W / 2 + 0.02, 0.92, 0.04, W / 2 - 0.02, H, D - 0.14, 0.02);
  f.add(M.black, discG(0.17, 18), 0, H + 0.001, 0.36, [-PI / 2, 0, 0]);
  f.add(X.chrome, torG(0.17, 0.01, 4, 18), 0, H + 0.002, 0.36, [PI / 2, 0, 0]);
  f.add(M.dark, rbox(W - 0.08, 0.16, 0.03, 0.01), 0, 0.88, D - 0.06, [-0.55, 0, 0]);
  f.add(G.lcd, rbox(0.2, 0.06, 0.004), -0.14, 0.9, D - 0.045, [-0.55, 0, 0]);
  for (let i = 0; i < 6; i++) f.add(i === 5 ? M.red : M.black, rbox(0.035, 0.025, 0.008), 0.03 + (i % 3) * 0.06, 0.915 - Math.floor(i / 3) * 0.05, D - 0.04 + Math.floor(i / 3) * 0.028, [-0.55, 0, 0]);
  f.span(M.dark, -W / 2 + 0.05, 0.1, D, W / 2 - 0.05, 0.16, D + 0.004);
  f.label('ROTOR 6 × 1 L · BALANCE LOADS', 0, 0.55, D + 0.002, 0.5, 0.07, { bg: '#ebe7da', fg: '#b3141a', border: '#ebe7da', font: 'bold 40px Arial' });
  f.col(-W / 2, 0, W / 2, D, H, SURF.metal);
}

/** a compound microscope on a surface at (x, y, z), eyepieces toward yaw's front */
export function microscope(c, x, y, z, yaw = 0) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(X.cream, 0, 0.025, -0.02, 0.2, 0.05, 0.26, 0.015);
  f.box(X.cream, 0, 0.19, -0.115, 0.07, 0.28, 0.07, 0.015);
  f.box(X.cream, 0, 0.345, -0.05, 0.075, 0.06, 0.18, 0.015);
  f.box(M.black, 0, 0.145, 0.01, 0.15, 0.014, 0.14);
  f.box(X.chrome, 0.05, 0.154, 0.03, 0.05, 0.004, 0.018);
  f.cyl(G.lcd, 0, 0.05, 0.01, 0.02, 0.02, 0.006, 8);
  f.cyl(M.dark, 0, 0.085, 0.01, 0.022, 0.022, 0.05, 8);
  f.cyl(M.dark, 0, 0.29, 0.0, 0.035, 0.03, 0.025, 10);
  for (let k = 0; k < 3; k++) f.add(X.chrome, cylC(0.008, 0.012, 0.05, 8), Math.sin(k * 2.1) * 0.02, 0.265, Math.cos(k * 2.1) * 0.02, [Math.cos(k * 2.1) * 0.3, 0, -Math.sin(k * 2.1) * 0.3]);
  f.box(X.cream, 0, 0.395, -0.02, 0.08, 0.06, 0.12, 0.012, [-0.35, 0, 0]);
  for (const s of [-1, 1]) f.add(M.dark, cylC(0.012, 0.013, 0.08, 8), s * 0.022, 0.44, 0.04, [0.75, 0, 0]);
  for (const s of [-1, 1]) {
    f.hcyl(M.dark, s * 0.05, 0.13, -0.11, 0.028, 0.02, 12, 'u');
    f.hcyl(M.dark, s * 0.07, 0.13, -0.11, 0.017, 0.02, 10, 'u');
  }
}

/** a thermal cycler on a surface at (x, y, z): the body, its heated lid (up when `open`, showing the block), a screen */
export function pcrCycler(c, x, y, z, yaw = 0, { open = false, on = true } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(X.labGrey, 0, 0.1, 0, 0.27, 0.2, 0.42, 0.02);
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) f.box(M.dark, s * 0.1355, 0.06 + i * 0.03, -0.05, 0.002, 0.012, 0.2);
  if (open) {
    const g = cached('pcrLid', () => new RoundedBoxGeometry(0.25, 0.05, 0.34, 1, 0.015).translate(0, 0, 0.17));
    f.add(M.dark, g, 0, 0.215, -0.19, [-1.2, 0, 0]);
    f.box(M.steel, 0, 0.205, -0.02, 0.2, 0.012, 0.14);
    for (let i = 0; i < 7; i++) f.box(M.black, 0, 0.2115, -0.08 + i * 0.02, 0.18, 0.002, 0.004);
  } else {
    f.box(M.dark, 0, 0.225, -0.02, 0.25, 0.05, 0.34, 0.015);
    f.box(M.black, 0, 0.253, 0.12, 0.08, 0.012, 0.03, 0.005);
  }
  f.box(M.black, 0, 0.1, 0.212, 0.2, 0.09, 0.004);
  f.screen(0, 0.1, 0.2145, 0.18, 0.075, on, on ? 'seq' : null);
  f.box(U.ledG, 0.11, 0.17, 0.212, 0.01, 0.01, 0.004);
}

/** a pipette carousel on a surface at (x, y, z): five pipettes hung round it, colour-coded plungers */
export function pipetteRack(c, x, y, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.cyl(X.labGrey, 0, 0, 0, 0.09, 0.09, 0.02, 14);
  f.cyl(M.dark, 0, 0.02, 0, 0.009, 0.009, 0.32, 6);
  f.cyl(X.labGrey, 0, 0.3, 0, 0.07, 0.07, 0.015, 14);
  const cols = [M.red, M.yellow, M.blue, M.green, X.teal];
  for (let i = 0; i < 5; i++) {
    const a = (i / 6) * PI * 2 + 0.3;
    const u = Math.cos(a) * 0.062, v = Math.sin(a) * 0.062;
    f.cyl(X.labGrey, u, 0.19, v, 0.012, 0.014, 0.13, 6);
    f.cyl(cols[i], u, 0.32, v, 0.007, 0.007, 0.025, 6);
    f.cyl(M.white, u, 0.06, v, 0.003, 0.009, 0.13, 6);
  }
}

/**
 * Small bench gear on a surface at (x, y, z) turned yaw, by kind: 'stirrer' (a hotplate stirrer with a beaker),
 * 'balance' (an analytical balance in its glass draft shield), 'vortex', 'waterbath', 'phmeter', 'minifuge',
 * 'laptop', 'tips' (pipette tip boxes), 'rack' (a tube rack), 'gel' (an electrophoresis tank with its power supply).
 */
export function benchKit(c, x, y, z, yaw, kind) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, yaw, { y });
  if (kind === 'stirrer') {
    f.box(X.cream, 0, 0.045, 0, 0.2, 0.09, 0.3, 0.015);
    f.box(M.white, 0, 0.095, -0.03, 0.18, 0.012, 0.18, 0.004);
    for (const s of [-1, 1]) f.hcyl(M.dark, s * 0.05, 0.045, 0.155, 0.018, 0.02, 10, 'v');
    f.box(M.red, 0.08, 0.07, 0.151, 0.012, 0.012, 0.004);
    f.cyl(U.glass, 0, 0.101, -0.03, 0.05, 0.05, 0.12, 12, true);
    f.cyl(pick(c, [U.blue, U.amber, U.green]), 0, 0.103, -0.03, 0.046, 0.046, 0.06, 12);
    f.add(M.white, capG(0.005, 0.02, 2, 6), 0, 0.108, -0.03, [0, 0, PI / 2]);
  } else if (kind === 'balance') {
    f.box(X.cream, 0, 0.04, 0, 0.22, 0.08, 0.34, 0.015);
    f.box(X.labGrey, 0, 0.18, -0.03, 0.21, 0.2, 0.22, 0.01);
    f.box(U.glass, 0, 0.18, -0.03, 0.2, 0.19, 0.21);
    f.cyl(M.steel, 0, 0.082, -0.03, 0.05, 0.05, 0.006, 14);
    f.box(M.black, 0, 0.05, 0.171, 0.14, 0.04, 0.004);
    f.label('0.0000 g', 0, 0.05, 0.1735, 0.12, 0.03, { bg: '#08140e', fg: '#7dffa0', border: '#08140e', font: 'bold 40px monospace' });
  } else if (kind === 'vortex') {
    f.cyl(X.labGrey, 0, 0, 0, 0.065, 0.06, 0.07, 12);
    f.cyl(M.black, 0, 0.07, 0, 0.025, 0.03, 0.03, 10);
    f.hcyl(M.dark, 0.05, 0.03, 0.03, 0.012, 0.02, 8, 'v');
  } else if (kind === 'waterbath') {
    f.box(M.steel, 0, 0.1, 0, 0.36, 0.2, 0.28, 0.012);
    f.box(M.blue, 0, 0.17, 0, 0.32, 0.01, 0.24);
    for (let i = 0; i < 4; i++) f.cyl(U.glass, -0.1 + i * 0.065, 0.12, 0.03, 0.012, 0.012, 0.1, 6);
    const g = cached('wbLid', () => new RoundedBoxGeometry(0.36, 0.015, 0.28, 1, 0.005).translate(0, 0, 0.14));
    f.add(M.steel, g, 0, 0.205, -0.14, [-1.1, 0, 0]);
    f.box(M.dark, 0, 0.1, 0.145, 0.12, 0.08, 0.02);
    f.add(G.lcd, rbox(0.06, 0.025, 0.004), 0, 0.11, 0.156);
  } else if (kind === 'phmeter') {
    f.box(X.labGrey, 0, 0.03, 0, 0.14, 0.06, 0.18, 0.012, [-0.2, 0, 0]);
    f.add(G.lcd, rbox(0.09, 0.04, 0.004), 0, 0.06, 0.02, [-0.2 - PI / 2 + 0.3, 0, 0]);
    f.cyl(M.dark, 0.12, 0, -0.04, 0.03, 0.03, 0.01, 10);
    f.cyl(X.chrome, 0.12, 0.01, -0.04, 0.005, 0.005, 0.3, 6);
    f.rod(X.chrome, [0.12, 0.28, -0.04], [0.2, 0.28, 0.02], 0.005, 4);
    f.cyl(M.white, 0.2, 0.1, 0.02, 0.008, 0.008, 0.18, 6);
    f.cyl(U.glass, 0.2, 0, 0.02, 0.035, 0.035, 0.08, 10, true);
    f.cyl(U.amber, 0.2, 0.002, 0.02, 0.032, 0.032, 0.04, 10);
  } else if (kind === 'minifuge') {
    f.cyl(X.labGrey, 0, 0, 0, 0.075, 0.07, 0.06, 14);
    f.add(U.glass, domeG(0.065, 12), 0, 0.06, 0, null, [1, 0.5, 1]);
    f.cyl(M.dark, 0, 0.06, 0, 0.05, 0.05, 0.01, 12);
  } else if (kind === 'laptop') {
    f.box(M.dark, 0, 0.01, 0, 0.34, 0.02, 0.24, 0.006);
    f.box(M.black, 0, 0.021, 0.02, 0.3, 0.002, 0.12);
    f.add(M.dark, rbox(0.34, 0.22, 0.012, 0.004).clone().translate(0, 0.11, 0), 0, 0.02, -0.115, [-0.3, 0, 0]);
    f.add(c.U.screen, atlasPlane(0.3, 0.19, SCREEN[pick(c, ['helix', 'seq', 'spectrum'])], 1024, 512).translate(0, 0.11, 0.0065), 0, 0.02, -0.115, [-0.3, 0, 0]);
  } else if (kind === 'tips') {
    for (let i = 0; i < 3; i++) {
      const col = [M.blue, M.yellow, X.teal][i];
      f.box(col, -0.13 + i * 0.13, 0.04, 0, 0.12, 0.08, 0.085, 0.006);
      f.box(U.glass, -0.13 + i * 0.13, 0.084, 0, 0.115, 0.008, 0.08);
    }
  } else if (kind === 'rack') {
    f.box(M.white, 0, 0.012, 0, 0.26, 0.012, 0.09);
    f.box(M.white, 0, 0.07, 0, 0.26, 0.012, 0.09);
    for (const s of [-1, 1]) f.box(M.white, s * 0.125, 0.04, 0, 0.012, 0.07, 0.09);
    const liq = [U.blue, U.magenta, U.green, U.amber];
    for (let i = 0; i < 6; i++) {
      if (rnd() < 0.25) continue;
      f.cyl(U.glass, -0.1 + i * 0.04, 0.015, 0, 0.008, 0.008, 0.1, 6, true);
      f.cyl(liq[(i + Math.floor(rnd() * 4)) % 4], -0.1 + i * 0.04, 0.017, 0, 0.007, 0.007, 0.03 + rnd() * 0.03, 6);
    }
  } else if (kind === 'gel') {
    f.box(U.glass, -0.05, 0.035, 0, 0.3, 0.07, 0.16);
    f.box(M.blue, -0.05, 0.02, 0, 0.28, 0.02, 0.14);
    f.box(M.black, -0.05, 0.072, 0, 0.32, 0.008, 0.17);
    f.hcyl(M.red, -0.2, 0.08, 0.05, 0.004, 0.04, 6, 'u');
    f.hcyl(M.black, 0.1, 0.08, 0.05, 0.004, 0.04, 6, 'u');
    f.box(M.grey, 0.22, 0.06, 0, 0.14, 0.12, 0.2, 0.01);
    f.add(G.lcd, rbox(0.08, 0.03, 0.004), 0.22, 0.09, 0.101);
    f.rod(M.red, [-0.2, 0.08, 0.07], [0.18, 0.05, 0.1], 0.004, 4);
  }
}

/**
 * A sequencer: kind 'floor' (a production instrument against the wall: cream base, navy upper shell, the flow-cell
 * window, a light bar and its touchscreen) or 'bench' (a desktop one standing on a surface at height y).
 */
export function sequencer(c, x, z, face, { kind = 'floor', y = 0, status = 'RUN 0412 · 73 %', on = true } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face, { y });
  if (kind === 'bench') {
    const W = 0.55, D = 0.55;
    f.box(M.white, 0, 0.22, D / 2, W, 0.44, D, 0.03);
    f.box(X.navy, 0, 0.47, D / 2 - 0.02, W - 0.02, 0.06, D - 0.06, 0.02);
    f.span(M.black, -W / 2 + 0.05, 0.08, D, 0.05, 0.36, D + 0.005);
    f.span(U.glass, -W / 2 + 0.06, 0.09, D + 0.006, 0.04, 0.35, D + 0.008);
    f.box(U.ledB, -W / 2 + 0.15, 0.2, D - 0.1, 0.08, 0.02, 0.02);
    f.box(M.black, 0.16, 0.28, D + 0.004, 0.18, 0.14, 0.008);
    f.screen(0.16, 0.28, D + 0.009, 0.16, 0.12, on, on ? 'seq' : null);
    f.span(U.ledB, -W / 2 + 0.03, 0.44, D - 0.01, W / 2 - 0.03, 0.452, D + 0.002);
    f.label('NOX-SEQ mini', 0.16, 0.12, D + 0.002, 0.2, 0.05, { bg: '#ffffff', fg: '#22344a', border: '#ffffff', font: 'bold 40px Arial' });
    return;
  }
  const W = 0.95, H = 1.62, D = 0.86;
  f.span(M.dark, -W / 2 + 0.04, 0, 0.05, W / 2 - 0.04, 0.06, D - 0.05);
  f.span(X.cream, -W / 2, 0.06, 0, W / 2, 0.94, D, 0.03);
  f.span(X.navy, -W / 2, 0.94, 0, W / 2, H, D - 0.04, 0.03);
  f.span(U.ledB, -W / 2 + 0.04, 0.925, D - 0.004, W / 2 - 0.04, 0.945, D + 0.004);
  // the flow-cell bay window, lit inside
  f.span(M.black, -W / 2 + 0.07, 1.04, D - 0.04, 0.02, 1.48, D - 0.035);
  f.span(U.glass, -W / 2 + 0.08, 1.05, D - 0.034, 0.01, 1.47, D - 0.03);
  for (let i = 0; i < 2; i++) f.box(U.ledB, -W / 2 + 0.2 + i * 0.16, 1.2, D - 0.2, 0.12, 0.012, 0.3);
  f.box(M.steel, -W / 2 + 0.28, 1.12, D - 0.15, 0.3, 0.02, 0.12);
  // the touchscreen on the upper right, the reagent drawer below
  f.box(M.black, W / 2 - 0.2, 1.3, D - 0.02, 0.34, 0.25, 0.03, 0.01);
  f.screen(W / 2 - 0.2, 1.3, D - 0.004, 0.31, 0.21, on, on ? 'seq' : null);
  f.span(M.dark, -W / 2 + 0.05, 0.52, D, W / 2 - 0.05, 0.525, D + 0.003);
  f.box(X.chrome, 0, 0.72, D + 0.02, 0.3, 0.025, 0.02, 0.008);
  f.label('NOX-SEQ 6000', -W / 2 + 0.2, 0.84, D + 0.002, 0.3, 0.06, { bg: '#ebe7da', fg: '#22344a', border: '#ebe7da', font: 'bold 44px Arial' });
  f.label(status, W / 2 - 0.2, 1.1, D - 0.037, 0.3, 0.05, { bg: '#22344a', fg: '#7dffa0', border: '#22344a', font: 'bold 36px monospace' });
  f.col(-W / 2, 0, W / 2, D, H, SURF.metal);
}

/** a laser printer on a surface at (x, y, z): the body, paper trays, a printout left in the output */
export function labPrinter(c, x, y, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(X.labGrey, 0, 0.14, 0, 0.42, 0.28, 0.4, 0.02);
  f.box(M.dark, 0, 0.29, -0.02, 0.36, 0.02, 0.28, 0.01);
  f.box(X.paper, 0, 0.302, 0.02, 0.21, 0.004, 0.28, 0, [0.06, 0.05, 0]);
  for (const y0 of [0.05, 0.11]) f.span(M.dark, -0.19, y0, 0.2, 0.19, y0 + 0.004, 0.203);
  f.box(M.black, 0.14, 0.24, 0.2, 0.08, 0.05, 0.006);
  f.box(c.U.ledG, 0.17, 0.24, 0.204, 0.01, 0.01, 0.004);
}

/**
 * A workstation desk along the wall: grey laminate on steel T-legs, `stations` places, each with `monitors[i]`
 * screens (2 or 3, angled in), a keyboard, a tower, the odd mug and printout, an office chair in front.
 */
export function computerBench(c, x, z, face, len, { stations = 2, monitors = [3, 2], depth = 0.8, chairs = true, screens = null } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const L = len, D = depth, T = 0.75;
  f.span(X.laminate, -L / 2, T - 0.035, 0, L / 2, T, D, 0.008);
  const nl = stations + 1;
  for (let i = 0; i < nl; i++) {
    const u = -L / 2 + 0.06 + (i * (L - 0.12)) / (nl - 1);
    f.box(M.dark, u, (T - 0.035) / 2, D / 2, 0.05, T - 0.035, 0.05);
    f.box(M.dark, u, 0.025, D / 2, 0.06, 0.05, D - 0.1);
  }
  f.span(M.dark, -L / 2 + 0.05, 0.3, 0.05, L / 2 - 0.05, T - 0.04, 0.07);
  const sw = L / stations;
  for (let s = 0; s < stations; s++) {
    const cu = -L / 2 + sw * (s + 0.5);
    const n = monitors[s] ?? 2;
    const angs = n === 3 ? [-0.38, 0, 0.38] : n === 2 ? [-0.18, 0.18] : [0];
    const du = n === 3 ? 0.56 : 0.3;
    angs.forEach((a, i) => {
      const u = cu + (i - (n - 1) / 2) * du, v = 0.2 + Math.abs(a) * 0.12;
      f.box(M.dark, u, T + 0.008, v, 0.22, 0.016, 0.16);
      f.box(M.dark, u, T + 0.14, v - 0.03, 0.05, 0.26, 0.03);
      f.box(M.black, u, T + 0.33, v, 0.56, 0.34, 0.035, 0.008, [0, -a, 0]);
      const p = f.p(u + Math.sin(-a) * 0.019, 0, v + Math.cos(-a) * 0.019);
      const which = screens ? screens[(s + i) % screens.length] : null;
      if (which) c.K.add(U.screen, atlasPlane(0.52, 0.3, SCREEN[which], 1024, 512), p.x, T + 0.33, p.z, [0, f.yaw - a, 0]);
      else c.screen(p.x, T + 0.33, p.z, f.yaw - a, 0.52, 0.3, rnd() < 0.8);
    });
    f.box(M.black, cu, T + 0.012, 0.5, 0.44, 0.02, 0.14, 0.004);
    f.box(M.black, cu + 0.32, T + 0.012, 0.52, 0.06, 0.02, 0.1, 0.01);
    f.box(M.black, cu + sw / 2 - 0.2, 0.23, 0.3, 0.2, 0.44, 0.45, 0.01);
    f.box(U.ledB, cu + sw / 2 - 0.2, 0.4, 0.526, 0.012, 0.012, 0.004);
    if (rnd() < 0.7) {
      const mu = cu - sw / 2 + 0.2;
      f.cyl(pick(c, [M.white, M.red, M.blue]), mu, T, 0.55, 0.04, 0.038, 0.1, 10);
      f.add(M.white, torG(0.03, 0.008, 4, 8, PI), mu + 0.04, T + 0.05, 0.55, [0, 0, -PI / 2]);
    }
    for (let k = 0; k < 2; k++) f.box(X.paper, cu + (rnd() - 0.5) * sw * 0.6, T + 0.002 + k * 0.001, 0.62, 0.21, 0.002, 0.29, 0, [0, rnd() * 2, 0]);
    if (chairs) {
      const p = f.p(cu + (rnd() - 0.5) * 0.3, 0, D + 0.5 + rnd() * 0.2);
      P.chair(c, p.x, p.z, f.yaw + PI + (rnd() - 0.5) * 0.9, rnd() < 0.15);
    }
  }
  f.col(-L / 2, 0, L / 2, D, T, SURF.wood);
}

/**
 * A big wall display at centre height y showing a DNA gel (lit bands in lanes, a ladder on the left) and a read map
 * with its coverage track, titles, a red box round the hotspot; a soft baked glow.
 */
export function dnaGelDisplay(c, x, y, z, face, { w = 2.4, h = 1.35, light = true } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.black, 0, y, 0.04, w, h, 0.07, 0.015);
  f.box(M.dark, 0, y - h / 2 - 0.05, 0.02, 0.3, 0.08, 0.04);
  const v = 0.0755;
  const gw = w * 0.52, gx = -w / 2 + 0.06 + gw / 2, gh = h - 0.26;
  f.box(X.film, gx, y - 0.06, v, gw, gh, 0.001);
  const lanes = 12;
  for (let l = 0; l < lanes; l++) {
    const u = gx - gw / 2 + ((l + 0.5) * gw) / lanes;
    f.box(M.dark, u, y - 0.06 + gh / 2 - 0.05, v + 0.001, gw / lanes - 0.02, 0.018, 0.001);
    const ladder = l === 0;
    const nb = ladder ? 9 : 2 + Math.floor(rnd() * 4);
    for (let b = 0; b < nb; b++) {
      const t = ladder ? (b + 0.5) / nb : 0.1 + rnd() * 0.85;
      const yy = y - 0.06 + gh / 2 - 0.12 - Math.pow(t, 1.3) * (gh - 0.2);
      f.box(G.gel, u, yy, v + 0.0015, gw / lanes - 0.03, ladder ? 0.006 : 0.008 + rnd() * 0.01, 0.001);
    }
  }
  f.label('AGAROSE 1.2 % · K-7 ISOLATES · LANES 1-12', gx, y + h / 2 - 0.07, v + 0.002, gw, 0.08, { bg: '#0a0f16', fg: '#ffb070', border: '#0a0f16', font: 'bold 36px monospace' });
  // the read map: stacked reads along the genome, the coverage track under them, a hotspot boxed in red
  const rw = w - gw - 0.2, rx = w / 2 - 0.07 - rw / 2;
  f.box(M.black, rx, y - 0.05, v, rw, gh, 0.001);
  for (let i = 0; i < 26; i++) {
    const len = 0.12 + rnd() * 0.3;
    const u = rx - rw / 2 + 0.03 + rnd() * (rw - len - 0.06) + len / 2;
    f.box(i % 7 === 3 ? U.magenta : G.read, u, y + gh / 2 - 0.12 - (i % 13) * 0.034, v + 0.0015, len, 0.012, 0.001);
  }
  for (let i = 0; i < 36; i++) {
    const hh = 0.02 + Math.pow(rnd(), 2) * 0.16 + (i > 20 && i < 25 ? 0.12 : 0);
    const u = rx - rw / 2 + 0.03 + (i * (rw - 0.06)) / 36;
    f.box(G.read, u, y - gh / 2 + 0.06 + hh / 2, v + 0.0015, (rw - 0.06) / 36 - 0.006, hh, 0.001);
  }
  const hx = rx - rw / 2 + 0.03 + (22.5 * (rw - 0.06)) / 36;
  for (const s of [-1, 1]) f.box(M.red, hx + s * 0.08, y - gh / 2 + 0.2, v + 0.002, 0.008, 0.34, 0.001);
  f.label('READ MAP · K-7 · CHR 4', rx, y + h / 2 - 0.07, v + 0.002, rw, 0.08, { bg: '#0a0f16', fg: '#9ad8ff', border: '#0a0f16', font: 'bold 36px monospace' });
  f.label('HOTSPOT Δ 0.34 %', hx, y - gh / 2 + 0.42, v + 0.002, 0.3, 0.06, { bg: '#0a0f16', fg: '#ff6ad5', border: '#0a0f16', font: 'bold 36px monospace' });
  if (light) f.light(0, y, 0.5, 0.3, 1.4, [0.8, 0.85, 1.0], null, 3.2);
}

/** a pedal waste bin at (x, z): kind 'bio' (red, biohazard), 'general' (grey) or 'glass' (a lined box); `open` lid */
export function wasteBin(c, x, z, { kind = 'bio', yaw = 0, open = false, s = 1 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  if (kind === 'glass') {
    f.box(M.card, 0, 0.3 * s, 0, 0.36 * s, 0.6 * s, 0.36 * s);
    f.span(M.card, -0.18 * s, 0.6 * s, -0.18 * s, 0.18 * s, 0.62 * s, 0.18 * s);
    f.label('BROKEN GLASS', 0, 0.35 * s, 0.182 * s, 0.3 * s, 0.1 * s, { bg: '#b08a5c', fg: '#16181a', border: '#b08a5c', font: 'bold 44px Arial' });
    c.col(x - 0.18 * s, 0, z - 0.18 * s, x + 0.18 * s, 0.6 * s, z + 0.18 * s, SURF.cardboard);
    return;
  }
  const mat = kind === 'bio' ? X.bioRed : M.grey;
  const W = 0.36 * s, H = 0.6 * s, D = 0.34 * s;
  f.box(mat, 0, H / 2, 0, W, H, D, 0.04 * s);
  f.box(M.dark, 0, 0.025, D / 2 + 0.04, 0.16 * s, 0.03, 0.1, 0.008);
  if (open) {
    const g = cached('binLid' + k3(W, D), () => new RoundedBoxGeometry(W + 0.01, 0.035, D + 0.01, 1, 0.015).translate(0, 0, (D + 0.01) / 2));
    f.add(mat, g, 0, H, -D / 2, [-1.7, 0, 0]);
    f.add(kind === 'bio' ? X.bagRed : M.black, torG(W * 0.45, 0.02, 4, 12), 0, H - 0.01, 0, [PI / 2, 0, 0], [1, D / W, 1]);
  } else f.box(mat, 0, H + 0.015, 0, W + 0.01, 0.035, D + 0.01, 0.015);
  if (kind === 'bio') f.plane(M.signs, 0.16 * s, 0.16 * s, 0, H * 0.55, D / 2 + 0.002, SIGN.bio);
  c.col(x - W / 2, 0, z - W / 2, x + W / 2, H, z + W / 2, SURF.metal);
}

/** a sharps container at (x, y, z) on the wall facing `face` (a bracket) or standing on a surface (wall = false) */
export function sharpsBox(c, x, y, z, face, { wall = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const v = wall ? 0.11 : 0;
  if (wall) {
    f.box(M.grey, 0, y + 0.1, 0.01, 0.2, 0.28, 0.02);
    f.box(M.grey, 0, y - 0.005, 0.07, 0.2, 0.01, 0.13);
  }
  f.box(X.sharpsYellow, 0, y + 0.12, v, 0.18, 0.24, 0.12, 0.012);
  f.box(X.bioRed, 0, y + 0.25, v, 0.19, 0.03, 0.13, 0.008);
  f.box(M.black, 0, y + 0.266, v + 0.02, 0.08, 0.004, 0.03);
  f.plane(M.signs, 0.08, 0.08, 0, y + 0.13, v + 0.061, SIGN.bio);
}

/** a sharps / clinical waste drum at (x, z): yellow body, red lid, the biohazard label */
export function sharpsDrum(c, x, z, { r = 0.24, h = 0.62, lid = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, 's');
  f.cyl(X.sharpsYellow, 0, 0, 0, r * 0.95, r, h, 14);
  for (const y of [h * 0.3, h * 0.7]) f.add(X.sharpsYellow, torG(r + 0.004, 0.01, 4, 14), 0, y, 0, [PI / 2, 0, 0]);
  if (lid) f.cyl(X.bioRed, 0, h, 0, r + 0.012, r + 0.01, 0.05, 14);
  f.plane(M.signs, r * 0.8, r * 0.8, 0, h * 0.5, r + 0.004, SIGN.bio);
  c.col(x - r, 0, z - r, x + r, h + 0.05, z + r, SURF.metal);
}

/** a lab coat hung at (u, y, v) of a frame (a coat on a hook), or crumpled on the floor (`floor`) */
function coat(f, u, y, v, { mat = null, floor = false, a = 0 } = {}) {
  const { M, X } = f.c;
  const m = mat ?? X.labCoat;
  if (floor) {
    f.add(m, capG(0.2, 0.5, 3, 8), u, 0.06, v, [PI / 2, a, 0.3], [1.3, 1, 0.3]);
    f.add(m, capG(0.05, 0.4, 3, 6), u + 0.3, 0.04, v + 0.1, [PI / 2, a + 1.1, 0]);
    f.add(m, capG(0.05, 0.35, 3, 6), u - 0.25, 0.04, v - 0.15, [PI / 2, a - 0.6, 0]);
    return;
  }
  f.cyl(M.steel, u, y - 0.02, v - 0.04, 0.008, 0.008, 0.04, 4);
  f.box(m, u, y - 0.08, v, 0.44, 0.1, 0.12, 0.04);
  f.add(m, capG(0.19, 0.6, 2, 8), u, y - 0.52, v, null, [1.1, 1, 0.45]);
  for (const s of [-1, 1]) f.add(m, capG(0.05, 0.62, 2, 6), u + s * 0.2, y - 0.46, v + 0.02, [0, 0, s * 0.08]);
  f.box(M.white, u - 0.1, y - 0.6, v + 0.08, 0.1, 0.08, 0.01);
  f.box(M.blue, u + 0.1, y - 0.3, v + 0.085, 0.04, 0.06, 0.01);
}

/** a coat rail on the wall at (x, z): `n` hooks, lab coats on all but the empty ones, one on the floor when `dropped` */
export function coatHooks(c, x, z, face, { n = 4, len = 1.4, y = 1.75, empty = [], dropped = false, mats = null } = {}) {
  const { M } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.wood, 0, y, 0.012, len, 0.09, 0.024);
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.5)) / n;
    f.rod(M.steel, [u, y, 0.024], [u, y + 0.03, 0.09], 0.008, 4);
    if (!empty.includes(i)) coat(f, u, y + 0.03, 0.12, { mat: mats?.[i % mats.length] });
  }
  if (dropped) coat(f, len * 0.3, 0, 0.55, { floor: true, a: 0.7 });
}
// ---------------------------------------------------------------- medical
/**
 * A hospital bed, its head against the wall at (x, z), the foot toward `face`: the frame on casters, head and foot
 * boards (a chart on the foot), the back section raised by `tilt`, mattress, sheet, pillow, blanket, side rails;
 * `blood` stains it, `restraints` straps it (`torn`: cut through), `rails` 'up' | 'down'.
 */
export function hospitalBed(c, x, z, face, { tilt = 0.45, blood = false, restraints = false, torn = false, rails = 'up', blanket = true, chart = 'PATIENT 0-17 · OBS 4-HOURLY' } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const W = 0.95, L = 2.1, v0 = 0.06;
  // chassis and casters
  f.span(M.dark, -0.3, 0.14, v0 + 0.3, 0.3, 0.32, v0 + L - 0.3, 0.02);
  f.span(X.labGrey, -W / 2 + 0.03, 0.34, v0 + 0.08, W / 2 - 0.03, 0.42, v0 + L - 0.05, 0.02);
  for (const su of [-1, 1]) {
    for (const vv of [v0 + 0.18, v0 + L - 0.18]) {
      f.box(M.dark, su * 0.38, 0.2, vv, 0.04, 0.2, 0.04);
      f.hcyl(X.rubber, su * 0.38, 0.06, vv, 0.06, 0.04, 10, 'u');
    }
  }
  // boards
  f.span(X.labGrey, -W / 2, 0.42, v0, W / 2, 1.05, v0 + 0.05, 0.02);
  f.span(X.labGrey, -W / 2, 0.42, v0 + L - 0.05, W / 2, 0.85, v0 + L, 0.02);
  f.box(M.dark, 0, 0.72, v0 + L + 0.01, 0.24, 0.3, 0.012, 0.004);
  f.label(chart, 0, 0.72, v0 + L + 0.018, 0.2, 0.26, { bg: '#fbfaf5', fg: '#1d2b3a', border: '#fbfaf5', font: 'bold 26px Arial', lines: chart.split(' · ') });
  // deck and mattress: the foot part flat, the back part raised about the hinge at vH
  const vH = v0 + 0.85, yM = 0.49;
  f.box(X.vinyl, 0, yM, (vH + v0 + L - 0.06) / 2, 0.88, 0.14, v0 + L - 0.06 - vH, 0.04);
  f.box(X.linen, 0, yM + 0.075, (vH + v0 + L - 0.06) / 2, 0.92, 0.015, v0 + L - 0.04 - vH, 0.005);
  for (const s of [-1, 1]) f.box(X.linen, s * 0.465, yM - 0.02, (vH + v0 + L - 0.06) / 2, 0.012, 0.18, v0 + L - 0.1 - vH);
  const back = cached('bedBack', () => new RoundedBoxGeometry(0.88, 0.14, 0.78, 1, 0.04).translate(0, 0, -0.39));
  f.add(X.vinyl, back, 0, yM, vH, [tilt, 0, 0]);
  const sheet = cached('bedSheet', () => new THREE.BoxGeometry(0.92, 0.015, 0.8).translate(0, 0.075, -0.4));
  f.add(X.linen, sheet, 0, yM, vH, [tilt, 0, 0]);
  const pil = cached('bedPillow', () => new RoundedBoxGeometry(0.6, 0.12, 0.34, 1, 0.05).translate(0, 0.14, -0.55));
  f.add(X.linen, pil, 0, yM, vH, [tilt + 0.05, 0, 0]);
  if (blanket) f.box(X.blanket, (rnd() - 0.5) * 0.1, yM + 0.1, v0 + L - 0.35, 0.94, 0.05, 0.45, 0.02, [0, (rnd() - 0.5) * 0.2, 0]);
  if (blood) {
    f.box(X.bloodDry, 0.1, yM + 0.084, vH + 0.45, 0.4, 0.002, 0.5, 0, [0, 0.4, 0]);
    f.add(X.bloodDry, sheet, 0.02, yM + 0.005, vH, [tilt, 0, 0], [0.5, 1, 0.6]);
    const p = f.p(0.5, 0, vH + 0.5);
    c.decal('blood', p.x, p.z, 0.9, rnd() * 3);
  }
  // side rails
  const ry = rails === 'up' ? 0.62 : 0.4;
  for (const s of [-1, 1]) {
    for (const [a, b] of [[v0 + 0.25, v0 + 0.95], [v0 + 1.15, v0 + 1.85]]) {
      if (rails === 'up' && s > 0 && a > 1 && rnd() < 0.5) continue;
      f.span(X.labGrey, s * 0.5 - 0.015, ry + 0.2, a, s * 0.5 + 0.015, ry + 0.25, b, 0.01);
      f.span(X.labGrey, s * 0.5 - 0.012, ry, a + 0.05, s * 0.5 + 0.012, ry + 0.2, a + 0.08);
      f.span(X.labGrey, s * 0.5 - 0.012, ry, b - 0.08, s * 0.5 + 0.012, ry + 0.2, b - 0.05);
    }
  }
  if (restraints) {
    for (const vv of [vH + 0.1, v0 + L - 0.3]) {
      for (const s of [-1, 1]) {
        f.box(X.leather, s * 0.3, yM + 0.09, vv, 0.2, 0.012, 0.07);
        f.box(X.chrome, s * 0.22, yM + 0.1, vv, 0.03, 0.01, 0.04);
        f.box(X.leather, s * 0.47, yM - 0.05, vv, 0.012, torn ? 0.12 : 0.22, 0.06);
        if (torn) f.box(X.leather, s * 0.55, 0.05, vv + 0.1, 0.18, 0.01, 0.06, 0, [0, 0.8, 0]);
      }
    }
  }
  f.col(-W / 2 - 0.03, v0, W / 2 + 0.03, v0 + L + 0.03, 0.75, SURF.metal);
}

/** an IV stand at (x, z): five-star base on casters, the pole, hooks, `bags` fluid bags with drip lines; `down` */
export function ivStand(c, x, z, { yaw = 0, bags = 1, down = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, down ? { y: 0.05, tilt: [PI / 2, 0] } : {});
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2 + 0.3;
    f.add(X.chrome, rbox(0.3, 0.02, 0.03), Math.sin(a) * 0.15, 0.07, Math.cos(a) * 0.15, [0, a + PI / 2, 0]);
    f.add(M.black, sphG(0.025, 6, 4), Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29);
  }
  f.cyl(X.chrome, 0, 0.07, 0, 0.014, 0.014, 1.95, 8);
  f.cyl(M.dark, 0, 1.1, 0, 0.022, 0.022, 0.05, 8);
  for (let k = 0; k < 4; k++) {
    const a = (k * PI) / 2;
    f.rod(X.chrome, [0, 1.98, 0], [Math.sin(a) * 0.12, 2.04, Math.cos(a) * 0.12], 0.006, 4);
  }
  for (let b = 0; b < bags; b++) {
    const a = b * PI;
    const u = Math.sin(a) * 0.12, v = Math.cos(a) * 0.12;
    f.box(X.ivBag, u, 1.86, v, 0.12, 0.2, 0.035, 0.015, [0, a, 0]);
    f.cyl(X.ivBag, u, 1.7, v, 0.012, 0.012, 0.06, 6);
    const line = cached('ivLine' + b, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.02, -0.4, 0.05), V(0.1, -0.9, 0.18), V(0.25, -1.0, 0.25), V(0.35, -0.8, 0.28)]), 10, 0.004, 4));
    f.add(M.white, line, u, 1.7, v, [0, a, 0]);
  }
}

/** a vitals monitor on a rolling stand at (x, z) turned yaw, the traces lit (`on`), a cable coiled on the hook */
export function vitalsMonitor(c, x, z, { yaw = 0, on = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2;
    f.add(M.dark, rbox(0.28, 0.025, 0.035), Math.sin(a) * 0.14, 0.07, Math.cos(a) * 0.14, [0, a + PI / 2, 0]);
    f.add(M.black, sphG(0.024, 6, 4), Math.sin(a) * 0.27, 0.03, Math.cos(a) * 0.27);
  }
  f.cyl(X.labGrey, 0, 0.07, 0, 0.02, 0.02, 1.05, 8);
  f.box(X.labGrey, 0, 1.08, 0.05, 0.08, 0.06, 0.1);
  f.box(X.labGrey, 0, 1.28, 0.08, 0.38, 0.3, 0.12, 0.025, [-0.12, 0, 0]);
  f.box(M.black, 0, 1.29, 0.141, 0.32, 0.22, 0.004, 0, [-0.12, 0, 0]);
  if (on) f.add(c.U.screen, atlasPlane(0.3, 0.2, SCREEN.vitals, 1024, 512), 0, 1.29, 0.1445, [-0.12, 0, 0]);
  f.box(X.labGrey, 0, 0.72, 0.06, 0.2, 0.1, 0.12, 0.01);
  f.add(M.black, torG(0.08, 0.008, 4, 12), 0.0, 0.8, 0.13);
  f.add(M.black, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.15, 1.18, 0.1), V(0.3, 0.9, 0.2), V(0.35, 0.5, 0.3), V(0.5, 0.65, 0.5)]), 8, 0.005, 4), 0, 0, 0);
}

/**
 * A crash cart against the wall: red drawer stack on casters (one drawer pulled), the defibrillator on top with its
 * paddles, a CPR board, an oxygen bottle on the side, a sharps box, the seal tag. (x, z) back middle.
 */
export function crashCart(c, x, z, face, { open = true } = {}) {
  const { M, X, U } = c;
  const f = new Frame(c, x, z, face);
  const W = 0.78, H = 1.0, D = 0.55;
  for (const su of [-1, 1]) for (const vv of [0.1, D - 0.08]) f.hcyl(X.rubber, su * (W / 2 - 0.06), 0.05, vv, 0.05, 0.035, 10, 'u');
  f.span(X.cartRed, -W / 2, 0.1, 0.02, W / 2, H - 0.05, D, 0.02);
  f.span(M.grey, -W / 2 - 0.02, H - 0.05, 0, W / 2 + 0.02, H, D + 0.02, 0.01);
  for (const s of [-1, 1]) f.span(M.grey, s * (W / 2 + 0.02), H, 0, s * (W / 2 + 0.005), H + 0.04, D + 0.02);
  const hs = [0.14, 0.14, 0.17, 0.2, 0.2];
  let y = H - 0.08;
  hs.forEach((h, i) => {
    const pulled = open && i === 2 ? 0.3 : 0;
    f.span(M.black, -W / 2 + 0.02, y - 0.004, D, W / 2 - 0.02, y, D + 0.004);
    if (pulled) {
      f.span(X.cartRed, -W / 2 + 0.04, y - h + 0.02, D, W / 2 - 0.04, y - 0.02, D + pulled);
      f.span(M.dark, -W / 2 + 0.06, y - 0.021, D + 0.01, W / 2 - 0.06, y - 0.02, D + pulled - 0.03);
      for (let k = 0; k < 5; k++) f.box(k % 2 ? M.white : X.ivBag, -0.25 + k * 0.12, y - 0.01, D + 0.12 + (k % 2) * 0.08, 0.08, 0.03, 0.12, 0.005);
    }
    f.box(X.chrome, 0, y - h / 2, D + 0.015 + pulled, 0.3, 0.02, 0.02, 0.006);
    y -= h;
  });
  f.box(M.yellow, 0.3, H - 0.2, D + 0.005, 0.03, 0.06, 0.004);
  // the defibrillator, its paddles, the CPR board
  f.box(M.dark, 0.05, H + 0.12, 0.26, 0.36, 0.22, 0.26, 0.02);
  f.box(M.black, 0.05, H + 0.15, 0.391, 0.2, 0.12, 0.004);
  f.plane(c.U.screen, 0.18, 0.1, 0.05, H + 0.15, 0.394, SCREEN.vitals, 1024, 512);
  for (const s of [-1, 1]) f.box(X.labGrey, 0.05 + s * 0.12, H + 0.25, 0.34, 0.09, 0.05, 0.14, 0.012);
  f.box(U.ledG, 0.2, H + 0.08, 0.392, 0.012, 0.012, 0.004);
  f.span(X.cream, -W / 2 - 0.035, 0.3, 0.05, -W / 2 - 0.015, 0.95, 0.5);
  f.cyl(M.green, W / 2 + 0.08, 0.35, 0.2, 0.06, 0.06, 0.55, 10);
  f.cyl(M.white, W / 2 + 0.08, 0.9, 0.2, 0.06, 0.02, 0.08, 10);
  f.box(M.dark, W / 2 + 0.03, 0.6, 0.2, 0.04, 0.05, 0.12);
  f.label('CRASH CART', 0, H - 0.02, D + 0.022, 0.4, 0.035, { bg: '#b0211b', fg: '#ffffff', border: '#b0211b', font: 'bold 40px Arial' });
  f.col(-W / 2 - 0.04, 0, W / 2 + 0.15, D + 0.03, H + 0.25, SURF.metal);
}

/** a wall-mounted glass-door medicine cabinet at centre height y: shelves of bottles and boxes, one door ajar */
export function medCabinet(c, x, y, z, face, { w = 0.8, h = 0.9, d = 0.3, ajar = true } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const t = 0.025, y0 = y - h / 2, y1 = y + h / 2;
  f.span(M.white, -w / 2, y0, 0, w / 2, y1, t);
  for (const s of [-1, 1]) f.span(M.white, s * (w / 2), y0, 0, s * (w / 2 - t), y1, d);
  f.span(M.white, -w / 2, y1 - t, 0, w / 2, y1, d);
  f.span(M.white, -w / 2, y0, 0, w / 2, y0 + t, d);
  for (let k = 0; k < 3; k++) {
    const yy = y0 + t + (k * (h - 2 * t)) / 3;
    if (k) f.span(U.glass, -w / 2 + t, yy, t, w / 2 - t, yy + 0.008, d - 0.03);
    let u = -w / 2 + t + 0.04;
    while (u < w / 2 - t - 0.05) {
      const r = rnd();
      if (r < 0.5) {
        f.cyl(r < 0.25 ? M.amber : M.white, u + 0.02, yy + 0.008, d / 2, 0.022, 0.022, 0.1, 8);
        f.cyl(M.white, u + 0.02, yy + 0.108, d / 2, 0.015, 0.015, 0.02, 8);
        u += 0.055;
      } else if (r < 0.85) {
        f.box(pick(c, [M.white, M.blue, X.paper, M.yellow]), u + 0.05, yy + 0.07, d / 2, 0.09, 0.13, 0.16);
        u += 0.11;
      } else u += 0.07;
    }
  }
  const lw = w / 2 - 0.01;
  const leaf = (s) => cached('medLeaf' + k3(lw, h) + s, () => new THREE.BoxGeometry(lw, h - 0.02, 0.012).translate((s * lw) / 2, 0, 0));
  const frame = (s, a) => {
    f.add(U.glass, leaf(s), s < 0 ? w / 2 : -w / 2, y, d + 0.006, [0, a, 0]);
    const hinge = s < 0 ? w / 2 : -w / 2;
    const q = f.p(hinge, y, d + 0.006);
    const g = cached('medRim' + k3(lw, h) + s, () => {
      const parts = [new THREE.BoxGeometry(lw, 0.02, 0.016).translate((s * lw) / 2, (h - 0.02) / 2, 0), new THREE.BoxGeometry(lw, 0.02, 0.016).translate((s * lw) / 2, -(h - 0.02) / 2, 0), new THREE.BoxGeometry(0.02, h, 0.016).translate(s * (lw - 0.01), 0, 0)];
      return parts;
    });
    for (const p of g) f.add(M.dark, p, hinge, y, d + 0.006, [0, a, 0]);
    return q;
  };
  frame(1, 0);
  frame(-1, ajar ? 1.4 : 0);
  f.box(M.green, 0, y1 + 0.08, 0.05, 0.12, 0.035, 0.02);
  f.box(M.green, 0, y1 + 0.08, 0.05, 0.035, 0.12, 0.02);
  f.label('MEDICATION · KEEP LOCKED', 0, y1 + 0.2, 0.004, 0.5, 0.07, { bg: '#ffffff', fg: '#1d9a4d', border: '#ffffff', font: 'bold 40px Arial' });
  f.col(-w / 2, 0, w / 2, d + 0.02, y1, SURF.glass, 0, y0);
}

/** an exam table, its head end on the wall at (x, z): cabinet base, the padded top (head raised), paper roll, step */
export function examTable(c, x, z, face, { paper = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.cream, -0.3, 0.05, 0.25, 0.3, 0.62, 1.7, 0.02);
  f.span(M.dark, -0.28, 0, 0.3, 0.28, 0.05, 1.65);
  for (let i = 0; i < 3; i++) {
    const vv = 0.5 + i * 0.4;
    f.span(M.dark, 0.302, 0.3, vv - 0.15, 0.304, 0.3 + 0.004, vv + 0.15);
    f.box(X.chrome, 0.31, 0.45, vv, 0.012, 0.012, 0.12);
  }
  f.box(X.vinyl, 0, 0.67, 1.2, 0.7, 0.1, 1.2, 0.035);
  const head = cached('examHead', () => new RoundedBoxGeometry(0.7, 0.1, 0.62, 1, 0.035).translate(0, 0, -0.31));
  f.add(X.vinyl, head, 0, 0.67, 0.6, [0.35, 0, 0]);
  if (paper) {
    f.box(X.paper, 0, 0.723, 1.2, 0.5, 0.004, 1.2);
    f.add(X.paper, cached('examPaper', () => new THREE.BoxGeometry(0.5, 0.004, 0.62).translate(0, 0.053, -0.31)), 0, 0.67, 0.6, [0.35, 0, 0]);
    f.hcyl(X.paper, 0, 0.93, 0.08, 0.05, 0.52, 12, 'u');
    for (const s of [-1, 1]) f.box(X.chrome, s * 0.28, 0.9, 0.08, 0.012, 0.1, 0.02);
  }
  f.span(X.labGrey, -0.25, 0, 1.85, 0.25, 0.2, 2.15, 0.01);
  f.span(M.black, -0.23, 0.2, 1.87, 0.23, 0.21, 2.13);
  f.col(-0.35, 0, 0.35, 1.82, 0.73, SURF.metal);
}

/**
 * Privacy curtains on a ceiling track: `path` [[x, z], ...] at the track height `top`; each segment's curtain is drawn
 * over `drawn[i]` (0..1) of it from its start, the rest bunched at the start. Pleated, double-sided, no collider.
 */
export function privacyCurtain(c, path, top, { drawn = [], bottom = 0.35, mat = null } = {}) {
  const { M, X } = c;
  const m = mat ?? X.curtain;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, az] = path[i], [bx, bz] = path[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    c.K.rod(M.steel, V(ax, top, az), V(bx, top, bz), 0.012, 6);
    for (let k = 0; k <= Math.floor(L / 1.2); k++) {
      const t = Math.min(L, k * 1.2 + 0.05);
      c.K.cyl(M.steel, ax + ux * t, top, az + uz * t, 0.006, 0.006, 0.6, 4);
    }
    const d = Math.max(0.12, (drawn[i] ?? 1) * L);
    const n = Math.max(3, Math.round(d / 0.13));
    const amp = (0.035 * L) / d + 0.02;
    const pos = [];
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * d, o = (k % 2 ? 1 : -1) * Math.min(0.09, amp);
      const px = ax + ux * s - uz * o, pz = az + uz * s + ux * o;
      pos.push([px, pz]);
    }
    // (two sheets of vertices, one per side, so each side gets its own normals)
    const y0 = bottom, y1 = top - 0.04;
    for (const side of [0, 1]) {
      const Pp = [], I = [];
      pos.forEach(([px, pz]) => Pp.push(px, y0, pz, px, y1, pz));
      for (let k = 0; k < n; k++) {
        const a = k * 2, b = a + 2;
        if (side) I.push(a, b, a + 1, b, b + 1, a + 1);
        else I.push(a, a + 1, b, b, a + 1, b + 1);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(Pp, 3));
      g.setIndex(I);
      g.computeVertexNormals();
      c.K.put(m, g);
    }
    for (let k = 0; k < n; k += 2) c.K.cyl(M.steel, pos[k][0], y1, pos[k][1], 0.01, 0.01, 0.03, 4);
  }
}

/** a ceiling-hung surgical / examination lamp over (x, z): canopy, arms, the lamp head at height y, its glowing face */
export function surgicalLamp(c, x, z, ceil, { y = 1.95, arm = 0.55, yaw = 0, lit = true } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, yaw);
  f.cyl(X.labGrey, 0, ceil - 0.06, 0, 0.14, 0.14, 0.06, 16);
  f.cyl(X.labGrey, 0, y + 0.55, 0, 0.035, 0.035, ceil - y - 0.6, 10);
  f.rod(X.labGrey, [0, y + 0.55, 0], [arm, y + 0.5, 0], 0.03, 8);
  f.add(X.labGrey, sphG(0.045, 8, 6), arm, y + 0.5, 0);
  f.rod(X.labGrey, [arm, y + 0.5, 0], [arm + 0.25, y + 0.2, 0.05], 0.025, 8);
  const hx = arm + 0.3, hz = 0.05;
  f.add(X.labGrey, cached('lampHead', () => new THREE.LatheGeometry([[0, 0.16], [0.14, 0.15], [0.3, 0.06], [0.34, 0.0], [0.33, -0.02], [0, -0.02]].map(([r, yy]) => new THREE.Vector2(r, yy)), 20)), hx, y, hz);
  f.add(lit ? G.surgical : M.white, discG(0.3, 20), hx, y - 0.021, hz, [PI / 2, 0, 0]);
  for (let k = 0; k < 6; k++) f.add(X.chrome, discG(0.045, 10), hx + Math.cos(k * 1.05) * 0.17, y - 0.022, hz + Math.sin(k * 1.05) * 0.17, [PI / 2, 0, 0]);
  f.cyl(X.labGrey, hx, y - 0.14, hz, 0.025, 0.03, 0.12, 8);
  if (lit) f.light(hx, y - 0.2, hz, 0.55, 1.1, [1.0, 0.97, 0.9], DOWN, 2.6);
}

/** a wheelchair at (x, z) turned yaw: big wheels with push rims, sling seat and back, footrests, front casters */
export function wheelchair(c, x, z, yaw, { folded = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  const hw = folded ? 0.16 : 0.3;
  for (const s of [-1, 1]) {
    const u = s * hw;
    f.add(X.rubber, torG(0.29, 0.016, 4, 20), u, 0.3, -0.12, [0, PI / 2, 0]);
    f.add(X.chrome, torG(0.26, 0.006, 3, 18), u + s * 0.03, 0.3, -0.12, [0, PI / 2, 0]);
    f.hcyl(M.dark, u, 0.3, -0.12, 0.035, 0.05, 8, 'u');
    for (let k = 0; k < 3; k++) f.add(X.chrome, rbox(0.004, 0.56, 0.004), u, 0.3, -0.12, [(k * PI) / 3, 0, 0]);
    f.rod(X.chrome, [u - s * 0.02, 0.5, -0.2], [u - s * 0.02, 0.5, 0.25], 0.012, 6);
    f.rod(X.chrome, [u - s * 0.02, 0.5, -0.22], [u - s * 0.02, 0.98, -0.3], 0.012, 6);
    f.rod(X.chrome, [u - s * 0.02, 0.98, -0.3], [u - s * 0.02, 1.0, -0.42], 0.012, 6);
    f.cyl(M.black, u - s * 0.02, 0.98, -0.42, 0.016, 0.016, 0.1, 6);
    f.box(M.black, u - s * 0.02, 0.7, 0.0, 0.05, 0.03, 0.35, 0.01);
    f.rod(X.chrome, [u - s * 0.02, 0.5, 0.2], [u - s * 0.05, 0.12, 0.38], 0.011, 6);
    f.box(M.black, u - s * 0.08, 0.11, 0.42, 0.16, 0.012, 0.12, 0.004);
    f.cyl(M.dark, u - s * 0.02, 0.1, 0.25, 0.012, 0.012, 0.4, 6);
    f.hcyl(X.rubber, u - s * 0.02, 0.07, 0.29, 0.07, 0.025, 10, 'u');
  }
  if (!folded) {
    f.box(M.black, 0, 0.5, 0.02, 0.56, 0.015, 0.42);
    f.box(M.black, 0, 0.75, -0.26, 0.56, 0.4, 0.012, 0, [-0.12, 0, 0]);
  }
  c.col(x - 0.34, 0, z - 0.34, x + 0.34, 0.9, z + 0.34, SURF.metal);
}

/**
 * A nurses' station, its back to the wall at (x, z): a counter across the front at depth `depth` with a raised
 * transaction ledge, a return at the +u end, a monitor, phone, binders and files; wall shelves behind; a chair.
 */
export function nurseStation(c, x, z, face, len, { depth = 1.7 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const L = len, D = depth;
  const cv0 = D - 0.62, cv1 = D;
  f.span(X.labGrey, -L / 2, 0, cv1 - 0.08, L / 2, 1.05, cv1, 0.01);
  f.span(X.laminate, -L / 2, 0.72, cv0, L / 2, 0.75, cv1 - 0.08, 0.006);
  f.span(X.laminate, -L / 2 - 0.02, 1.05, cv1 - 0.3, L / 2 + 0.02, 1.08, cv1 + 0.04, 0.008);
  f.span(M.dark, -L / 2 + 0.05, 0, cv0 + 0.05, -L / 2 + 0.1, 0.72, cv1 - 0.1);
  // the return at +u, closing the L
  f.span(X.labGrey, L / 2 - 0.08, 0, 0.55, L / 2, 1.05, cv1, 0.01);
  f.span(X.laminate, L / 2 - 0.6, 0.72, 0.55, L / 2 - 0.08, 0.75, cv0, 0.006);
  f.label('NURSES', 0, 0.88, cv1 + 0.002, 0.6, 0.12, { bg: '#bfc5ca', fg: '#1d4f7a', border: '#bfc5ca', font: 'bold 60px Arial' });
  // on the desk
  const mu = -L / 2 + 0.7;
  f.box(M.dark, mu, 0.76, cv0 + 0.3, 0.2, 0.02, 0.16);
  f.box(M.dark, mu, 0.9, cv0 + 0.32, 0.04, 0.26, 0.03);
  f.box(M.black, mu, 1.02, cv0 + 0.3, 0.52, 0.32, 0.03, 0.008, [0, PI, 0]);
  f.plane(c.U.screen, 0.48, 0.28, mu, 1.02, cv0 + 0.284, SCREEN.vitals, 1024, 512, PI);
  f.box(M.black, mu, 0.76, cv0 - 0.02, 0.42, 0.02, 0.14, 0, [0, PI, 0]);
  f.box(M.dark, mu + 0.45, 0.78, cv0 + 0.2, 0.18, 0.06, 0.2, 0.01);
  f.box(M.black, mu + 0.45, 0.82, cv0 + 0.2, 0.05, 0.03, 0.2, 0.012);
  for (let i = 0; i < 6; i++) f.box(pick(c, [M.blue, M.red, M.green, M.yellow, M.white]), -L / 2 + 0.2 + i * 0.07, 1.2, cv1 - 0.18, 0.05, 0.25, 0.22, 0, [0, 0, i === 5 ? 0.35 : 0]);
  for (let k = 0; k < 4; k++) f.box(X.paper, (rnd() - 0.2) * L * 0.5, 0.752 + k * 0.001, cv0 + 0.25, 0.21, 0.002, 0.29, 0, [0, rnd() * 3, 0]);
  f.cyl(M.white, L / 2 - 0.4, 0.75, cv0 - 0.2, 0.04, 0.036, 0.1, 10);
  // wall shelf of binders behind, a wall phone
  f.span(M.white, -L / 2 + 0.1, 1.55, 0, L / 2 - 0.1, 1.575, 0.3);
  for (let i = 0; i < Math.floor((L - 0.4) / 0.07); i++) f.box(pick(c, [M.blue, M.red, M.green, M.dark, X.teal]), -L / 2 + 0.2 + i * 0.07, 1.72, 0.14, 0.055, 0.29, 0.24, 0, [0, 0, rnd() < 0.1 ? 0.2 : 0]);
  f.box(M.white, L / 2 - 0.3, 1.35, 0.03, 0.12, 0.2, 0.06, 0.012);
  f.box(M.white, L / 2 - 0.3, 1.38, 0.07, 0.05, 0.18, 0.04, 0.012);
  const p = f.p(-L / 2 + 0.9, 0, cv0 - 0.45);
  P.chair(c, p.x, p.z, f.yaw + (rnd() - 0.5) * 0.8);
  f.col(-L / 2, cv0, L / 2, cv1 + 0.04, 1.08, SURF.wood);
  f.col(L / 2 - 0.6, 0.55, L / 2, cv0, 1.05, SURF.wood);
}

/** a folding army cot at (x, z) turned yaw (long along its v): X legs, canvas, a sleeping bag or blanket, a pillow */
export function cot(c, x, z, yaw, { made = true, stuff = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const L = 1.9, W = 0.68;
  for (const s of [-1, 1]) f.hcyl(M.dark, s * (W / 2), 0.42, 0, 0.014, L, 6, 'v');
  for (const vv of [-L / 2 + 0.15, 0, L / 2 - 0.15]) {
    for (const s of [-1, 1]) f.rod(M.dark, [s * (W / 2 - 0.02), 0.42, vv - 0.15], [s * (W / 2 - 0.02), 0.0, vv + 0.15], 0.011, 5);
    for (const s of [-1, 1]) f.rod(M.dark, [s * (W / 2 - 0.02), 0.42, vv + 0.15], [s * (W / 2 - 0.02), 0.0, vv - 0.15], 0.011, 5);
  }
  f.box(X.canvas, 0, 0.41, 0, W - 0.02, 0.02, L - 0.06);
  if (made) f.box(X.blanket, 0.02, 0.45, 0.2, W - 0.06, 0.07, 1.3, 0.03, [0, (rnd() - 0.5) * 0.08, 0]);
  else f.add(X.blanket, capG(0.12, 0.6, 3, 8), 0.05, 0.47, 0.2, [PI / 2, 0.3, 0], [1.6, 1, 0.5]);
  f.box(X.linen, 0, 0.47, -L / 2 + 0.25, 0.46, 0.1, 0.3, 0.04);
  if (stuff) {
    f.box(M.dark, -0.1, 0.03, L / 2 - 0.2, 0.3, 0.06, 0.12, 0.01);
    f.box(X.paper, 0.15, 0.462, 0.5, 0.15, 0.02, 0.21, 0, [0, 0.3, 0]);
  }
  f.col(-W / 2, -L / 2, W / 2, L / 2, 0.5, SURF.cardboard);
}

/** a body bag at (x, z) turned yaw, lying at height y (the floor, a tray, a gurney): black, zipped, a tag */
export function bodyBag(c, x, z, yaw, { y = 0 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.add(M.bag, capG(0.25, 1.3, 4, 10), 0, 0.13, 0, [PI / 2, 0, 0], [1.05, 1, 0.5]);
  f.box(M.dark, 0.05, 0.254, 0, 0.012, 0.008, 1.4);
  f.box(X.paper, 0.2, 0.2, 0.85, 0.05, 0.002, 0.08, 0, [0.3, 0, 0]);
}

/**
 * An autopsy table at (x, z) turned yaw (long along v): the pedestal, a tilted steel tray with raised edges, the
 * head block, a drain at the foot into the sink with its gooseneck and hose, an overhead lamp (ceil > 0);
 * `body`: a sheet over a corpse (toe tag out); `blood`: stains and a puddle.
 */
export function dissectionTable(c, x, z, yaw, { ceil = 0, body = false, blood = false } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  f.cyl(M.steel, 0, 0, 0, 0.32, 0.32, 0.03, 16);
  f.cyl(M.steel, 0, 0.03, 0, 0.14, 0.11, 0.72, 12);
  f.box(M.steel, 0, 0.8, 0, 0.35, 0.1, 0.9, 0.02);
  const T = 0.87;
  f.box(M.steel, 0, T, 0, 0.76, 0.03, 2.1, 0.01);
  for (const s of [-1, 1]) f.box(M.steel, s * 0.37, T + 0.04, 0, 0.025, 0.07, 2.1, 0.008);
  f.box(M.steel, 0, T + 0.04, -1.04, 0.76, 0.07, 0.025, 0.008);
  for (let i = 0; i < 9; i++) f.box(M.black, 0, T + 0.016, -0.8 + i * 0.2, 0.5, 0.002, 0.02);
  f.box(M.steel, 0, T + 0.06, -0.9, 0.2, 0.08, 0.14, 0.02);
  f.cyl(M.black, 0, T + 0.016, 0.95, 0.04, 0.04, 0.002, 10);
  // the sink at the foot
  f.span(M.steel, -0.35, 0.75, 1.07, 0.35, 0.95, 1.5, 0.02);
  basin(f, 0, 0.95, 1.29, 0.6, 0.36);
  faucet(f, 0, 0.95, 1.45, -0.16, true);
  f.add(M.black, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.2, 1.0, 1.45), V(0.3, 1.1, 1.2), V(0.34, 0.95, 0.9), V(0.3, T + 0.05, 0.7)]), 10, 0.012, 5), 0, 0, 0);
  f.span(M.steel, -0.3, 0, 1.12, 0.3, 0.75, 1.45);
  if (body) {
    f.add(X.linen, capG(0.22, 1.25, 4, 10), 0, T + 0.16, 0.05, [PI / 2, 0, 0], [1.1, 1, 0.6]);
    f.add(X.linen, sphG(0.13, 10, 8), 0, T + 0.17, -0.8, null, [1, 0.8, 1.1]);
    for (const s of [-1, 1]) f.add(X.specimen, capG(0.045, 0.1, 3, 6), s * 0.08, T + 0.12, 0.85, [PI / 2 - 0.4, 0, 0]);
    f.box(X.paper, 0.1, T + 0.14, 0.93, 0.05, 0.002, 0.08, 0, [0.4, 0, 0]);
  }
  if (blood) {
    f.box(X.bloodDry, (rnd() - 0.5) * 0.2, T + 0.017, 0.3, 0.35, 0.002, 0.6, 0, [0, rnd(), 0]);
    const p = f.p(0.1, 0, 0.8);
    c.decal('blood', p.x, p.z, 0.8, rnd() * 3);
  }
  if (ceil > 0) {
    const p = f.p(0.1, 0, -0.2);
    surgicalLamp(c, p.x, p.z, ceil, { y: Math.min(2.1, ceil - 0.6), arm: 0.0, yaw: f.yaw + PI / 2, lit: !blood });
  }
  f.col(-0.4, -1.08, 0.4, 1.5, 0.95, SURF.metal);
}

/** a Mayo instrument stand at (x, z) turned yaw: a U base on casters, the post, a tray of instruments */
export function mayoStand(c, x, z, yaw = 0, { tipped = false } = {}) {
  const { M, X, rnd } = c;
  if (tipped) {
    const f = new Frame(c, x, z, yaw);
    f.box(M.steel, 0, 0.02, 0, 0.5, 0.02, 0.36, 0.005, [0, 0, 0.1]);
    for (let k = 0; k < 5; k++) f.box(X.chrome, (rnd() - 0.5) * 1.2, 0.006, (rnd() - 0.5) * 1.0, 0.012, 0.006, 0.15, 0, [0, rnd() * 3, 0]);
    f.rod(M.steel, [0.2, 0.03, -0.3], [0.9, 0.05, -0.4], 0.015, 6);
    return;
  }
  const f = new Frame(c, x, z, yaw);
  for (const s of [-1, 1]) f.box(M.steel, s * 0.2, 0.04, 0, 0.03, 0.03, 0.5);
  f.box(M.steel, 0, 0.04, -0.24, 0.43, 0.03, 0.03);
  for (const s of [-1, 1]) for (const vv of [-0.22, 0.22]) f.add(M.black, sphG(0.025, 6, 4), s * 0.2, 0.025, vv);
  f.cyl(M.steel, 0, 0.05, -0.24, 0.015, 0.015, 0.95, 8);
  f.rod(M.steel, [0, 1.0, -0.24], [0, 1.0, 0.0], 0.015, 6);
  f.box(M.steel, 0, 1.0, 0.05, 0.5, 0.02, 0.36, 0.005);
  for (const s of [-1, 1]) f.box(M.steel, s * 0.25, 1.02, 0.05, 0.01, 0.03, 0.36);
  for (let k = 0; k < 6; k++) f.box(X.chrome, -0.2 + k * 0.08, 1.014, 0.05 + (rnd() - 0.5) * 0.06, 0.012, 0.006, 0.12 + rnd() * 0.06, 0, [0, (rnd() - 0.5) * 0.2, 0]);
  f.add(X.chrome, torG(0.02, 0.004, 3, 10), 0.2, 1.015, -0.05, [PI / 2, 0, 0]);
}

/** a hanging (spring) scale over (x, z) from the ceiling: chain, dial at height y facing `face`, a steel pan */
export function hangingScale(c, x, z, ceil, face, { y = 1.45 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.cyl(M.dark, 0, y + 0.18, 0, 0.006, 0.006, ceil - y - 0.18, 4);
  f.add(X.chrome, cylC(0.13, 0.13, 0.06, 18), 0, y, 0, [PI / 2, 0, 0]);
  f.plane(M.signs, 0.2, 0.2, 0, y, 0.031, SIGN.gauge);
  f.add(M.white, discG(0.12, 16), 0, y, -0.031, [0, PI, 0]);
  f.cyl(X.chrome, 0, y + 0.13, 0, 0.012, 0.012, 0.05, 6);
  f.cyl(X.chrome, 0, y - 0.25, 0, 0.006, 0.006, 0.12, 4);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2;
    f.rod(X.chrome, [0, y - 0.25, 0], [Math.cos(a) * 0.2, y - 0.5, Math.sin(a) * 0.2], 0.003, 3);
  }
  f.add(X.chrome, cached('scalePan', () => new THREE.LatheGeometry([[0, 0], [0.16, 0.01], [0.22, 0.06], [0.215, 0.065]].map(([r, yy]) => new THREE.Vector2(r, yy)), 18)), 0, y - 0.56, 0);
}
// ---------------------------------------------------------------- decon
/**
 * A decontamination shower stall against the wall: tiled back, steel side panels (`left` / `right`), a floor pan with
 * a drain, the deluge ring and side nozzle bars, a hand hose, the cycle button; a PVC curtain `curtain` drawn
 * (0..1) across the front. (x, z) back middle, w wide, d deep.
 */
export function showerStall(c, x, z, face, { w = 1.05, d = 1.0, h = 2.2, curtain = 0.5, left = true, right = true, blood = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.steel, -w / 2, 0, 0, w / 2, 0.03, d);
  f.span(M.steel, -w / 2, 0.03, d - 0.05, w / 2, 0.07, d);
  f.span(M.black, -0.1, 0.03, d / 2 - 0.1, 0.1, 0.033, d / 2 + 0.1);
  for (let i = 0; i < 5; i++) f.box(X.grate, -0.08 + i * 0.04, 0.036, d / 2, 0.012, 0.006, 0.19);
  f.span(X.tile, -w / 2, 0.03, 0, w / 2, h, 0.02);
  for (let i = 1; i < 8; i++) f.span(M.grey, -w / 2 + 0.04, 0.03 + i * 0.27, 0.02, w / 2 - 0.04, 0.036 + i * 0.27, 0.022);
  for (const s of [-1, 1]) {
    if ((s < 0 && !left) || (s > 0 && !right)) continue;
    f.span(M.steel, s * (w / 2), 0, 0, s * (w / 2 - 0.04), h, d, 0.008);
    f.cyl(M.steel, s * (w / 2 - 0.12), 0.45, 0.05, 0.015, 0.015, 1.45, 6);
    for (let k = 0; k < 3; k++) f.hcyl(M.dark, s * (w / 2 - 0.12), 0.7 + k * 0.45, 0.085, 0.012, 0.06, 6, 'v');
  }
  f.rod(M.steel, [0, h + 0.08, 0.02], [0, h + 0.08, d / 2], 0.022, 8);
  f.add(M.steel, torG(0.24, 0.014, 4, 16), 0, h + 0.06, d / 2, [PI / 2, 0, 0]);
  for (let k = 0; k < 6; k++) f.cyl(M.dark, Math.cos(k * 1.05) * 0.24, h + 0.01, d / 2 + Math.sin(k * 1.05) * 0.24, 0.01, 0.018, 0.04, 6);
  // the hand hose on its hook, the cycle button
  f.box(M.steel, -w / 2 + 0.2, 1.5, 0.04, 0.04, 0.08, 0.05);
  f.add(M.black, new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-w / 2 + 0.2, 1.52, 0.06), V(-w / 2 + 0.28, 1.0, 0.1), V(-w / 2 + 0.24, 0.5, 0.12), V(-w / 2 + 0.16, 0.9, 0.08), V(-w / 2 + 0.2, 1.45, 0.07)]), 12, 0.012, 5), 0, 0, 0);
  f.box(M.yellow, 0.25, 1.35, 0.045, 0.14, 0.14, 0.05, 0.01);
  f.add(c.X.safetyGreen, cylC(0.045, 0.045, 0.04, 12), 0.25, 1.35, 0.085, [PI / 2, 0, 0]);
  f.label('PUSH · DECON CYCLE 3 MIN', 0.12, 1.62, 0.022, 0.5, 0.1, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 40px Arial' });
  if (blood) {
    const p = f.p(-0.1, 1.2, 0.023);
    c.wallDecal('blood', p.x, 1.2, p.z, face, 0.35, 0.5);
  }
  f.hcyl(X.chrome, 0, h - 0.02, d - 0.03, 0.012, w - 0.1, 6, 'u');
  const a = f.p(-w / 2 + 0.05, 0, d - 0.03), b = f.p(w / 2 - 0.05, 0, d - 0.03);
  privacyCurtain(c, [[a.x, a.z], [b.x, b.z]], h - 0.02, { drawn: [Math.max(0.1, curtain)], bottom: 0.12, mat: X.pvc });
  for (const s of [-1, 1]) if ((s < 0 && left) || (s > 0 && right)) f.col(s * (w / 2), 0, s * (w / 2 - 0.05), d, h, SURF.metal);
}

/**
 * A rack of hazmat suits hanging on a wall rail at (x, z): `n` suits (hood with visor, torso, arms with gloves, legs),
 * boots below, the hangers in `empty` bare, suit colours from `mats`. Soft: bullets pass through.
 */
export function hazmatRack(c, x, z, face, { len = 2.2, n = 3, empty = [], mats = null } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.steel, 0, 2.0, 0.05, len, 0.04, 0.04);
  for (const s of [-1, 1]) f.box(M.steel, s * (len / 2 - 0.05), 2.0, 0.025, 0.04, 0.12, 0.05);
  const ms = mats ?? [X.hazmat, X.tyvek, X.hazmat];
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.5)) / n;
    f.rod(M.dark, [u, 2.0, 0.07], [u, 1.93, 0.2], 0.006, 4);
    f.box(M.dark, u, 1.92, 0.2, 0.42, 0.015, 0.015);
    if (empty.includes(i)) continue;
    const m = ms[i % ms.length];
    f.box(m, u, 1.73, 0.21, 0.3, 0.32, 0.26, 0.1);
    f.box(M.black, u, 1.72, 0.34, 0.22, 0.15, 0.015, 0.03);
    f.add(m, capG(0.22, 0.42, 3, 10), u, 1.25, 0.21, null, [1.15, 1, 0.55]);
    for (const s of [-1, 1]) {
      f.add(m, capG(0.07, 0.55, 3, 6), u + s * 0.28, 1.28, 0.21, [0, 0, s * 0.12]);
      f.add(X.rubber, capG(0.05, 0.1, 2, 6), u + s * 0.32, 0.9, 0.21);
      f.add(m, capG(0.08, 0.45, 3, 6), u + s * 0.11, 0.72, 0.21);
      f.box(X.rubber, u + s * 0.12, 0.13, 0.26, 0.12, 0.26, 0.3, 0.03);
    }
    f.box(M.dark, u, 1.02, 0.33, 0.2, 0.05, 0.02);
  }
  f.label('LEVEL A / B SUITS · INSPECT SEALS BEFORE DONNING', 0, 2.2, 0.004, Math.min(len, 1.6), 0.1, { bg: '#1b2127', fg: '#f0c030', border: '#1b2127', font: 'bold 36px Arial' });
  f.col(-len / 2, 0, len / 2, 0.42, 2.0, SURF.cardboard, FLAG_NOBULLET);
}

/** a PPE changing bench on the wall at (x, z): slatted seat, boots under it, a shelf of glove / mask boxes above */
export function ppeBench(c, x, z, face, len = 1.6) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  for (const u of [-len / 2 + 0.1, len / 2 - 0.1]) {
    f.box(M.steel, u, 0.22, 0.2, 0.04, 0.44, 0.04);
    f.box(M.steel, u, 0.02, 0.2, 0.05, 0.04, 0.36);
  }
  for (let i = 0; i < 3; i++) f.box(M.wood, 0, 0.45, 0.07 + i * 0.12, len, 0.03, 0.1, 0.008);
  for (let i = 0; i < Math.floor(len / 0.35); i++) {
    const u = -len / 2 + 0.25 + i * 0.35;
    for (const s of [-1, 1]) f.box(i % 2 ? X.rubber : M.black, u + s * 0.07, 0.14, 0.18 + rnd() * 0.05, 0.1, 0.28, 0.26, 0.03, [0, (rnd() - 0.5) * 0.3, 0]);
  }
  f.span(M.white, -len / 2, 1.45, 0, len / 2, 1.47, 0.26);
  const boxes = [X.nitrile, X.nitrile, M.white, X.teal, M.white];
  for (let i = 0; i < Math.floor(len / 0.3); i++) {
    const u = -len / 2 + 0.18 + i * 0.3;
    f.box(boxes[i % boxes.length], u, 1.53, 0.13, 0.24, 0.12, 0.12, 0.004);
    f.box(M.black, u, 1.59, 0.13, 0.08, 0.002, 0.04);
  }
  f.label('GLOVES · S  M  L  XL', 0, 1.72, 0.004, 0.6, 0.08, { bg: '#1f5fa6', fg: '#ffffff', border: '#1f5fa6', font: 'bold 40px Arial' });
  f.box(M.white, len / 2 - 0.1, 1.15, 0.05, 0.1, 0.18, 0.1, 0.01);
  f.col(-len / 2, 0, len / 2, 0.4, 0.47, SURF.wood);
}

/** a wall-mounted decon spray system: headers, three nozzle bars, the control box with its valve wheel and gauge */
export function sprayManifold(c, x, z, face, { w = 2.2, y0 = 0.5, y1 = 2.3, ceil = 3.2 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  for (const s of [-1, 1]) f.cyl(M.steel, s * (w / 2), y0, 0.08, 0.025, 0.025, y1 - y0, 8);
  f.hcyl(M.steel, 0, y1, 0.08, 0.025, w, 8, 'u');
  f.cyl(M.steel, w / 2, y1, 0.08, 0.03, 0.03, ceil - y1, 8);
  for (const y of [y0 + 0.2, (y0 + y1) / 2, y1 - 0.25]) {
    f.hcyl(M.steel, 0, y, 0.08, 0.018, w, 8, 'u');
    for (let k = 0; k < Math.floor(w / 0.35); k++) f.hcyl(M.dark, -w / 2 + 0.2 + k * 0.35, y, 0.12, 0.012, 0.06, 6, 'v', 0.02);
  }
  for (const s of [-1, 1]) for (const y of [y0, y1]) f.box(M.dark, s * (w / 2), y, 0.03, 0.08, 0.06, 0.06);
  f.box(M.grey, w / 2 + 0.3, 1.4, 0.08, 0.34, 0.46, 0.16, 0.015);
  f.add(M.red, torG(0.09, 0.012, 4, 14), w / 2 + 0.3, 1.5, 0.2);
  for (let k = 0; k < 2; k++) f.add(M.red, rbox(0.18, 0.012, 0.012), w / 2 + 0.3, 1.5, 0.2, [0, 0, (k * PI) / 2]);
  f.gauge(w / 2 + 0.3, 1.27, 0.16, 0.08);
  f.box(U.ledA, w / 2 + 0.2, 1.62, 0.162, 0.02, 0.02, 0.006);
  f.box(U.ledG, w / 2 + 0.25, 1.62, 0.162, 0.02, 0.02, 0.006);
  f.label('DECON SPRAY · HOLD 30 s', w / 2 + 0.3, 1.72, 0.004, 0.5, 0.1, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 40px Arial' });
}

// ---------------------------------------------------------------- cryo
/**
 * A bulk liquid-nitrogen supply tank at (x, z), its plumbing cabinet toward `face`: skirt, body, domed head, frost
 * bands, valves with hand wheels, gauges, the relief stack, the insulated line up to the ceiling, placards.
 */
export function ln2Tank(c, x, z, face, { r = 0.75, h = 2.6, ceil = 4 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.cyl(M.dark, 0, 0, 0, r * 0.92, r * 0.92, 0.22, 24);
  const top = h - r * 0.35;
  f.cyl(M.white, 0, 0.22, 0, r, r, top - 0.22, 24);
  f.add(M.white, domeG(r, 24), 0, top, 0, null, [1, 0.45, 1]);
  for (const [y0, hh] of [[0.26, 0.3], [0.7, 0.12]]) f.cyl(M.frost, 0, y0, 0, r + 0.012, r + 0.012, hh, 24, true);
  for (const y of [1.0, top - 0.2]) f.add(M.steel, torG(r + 0.006, 0.012, 4, 32), 0, y, 0, [PI / 2, 0, 0]);
  // the plumbing cabinet on the front
  f.box(M.steel, 0, 1.25, r + 0.06, 0.62, 0.8, 0.12, 0.012);
  f.gauge(-0.16, 1.5, r + 0.12, 0.12);
  f.gauge(0.16, 1.5, r + 0.12, 0.12);
  const wheels = [M.green, M.red, M.blue];
  wheels.forEach((m, i) => {
    const u = -0.2 + i * 0.2;
    f.hcyl(X.brass, u, 1.12, r + 0.16, 0.02, 0.1, 8, 'v');
    f.add(m, torG(0.06, 0.01, 4, 14), u, 1.12, r + 0.22);
    f.add(m, rbox(0.12, 0.01, 0.01), u, 1.12, r + 0.22);
  });
  f.rod(X.copper, [-0.25, 0.95, r + 0.14], [0.25, 0.95, r + 0.14], 0.02, 8);
  f.box(M.white, 0, 1.78, r + 0.02, 0.44, 0.2, 0.012);
  f.label('LIQUID NITROGEN', 0, 1.8, r + 0.028, 0.4, 0.09, { bg: '#1d4f7a', fg: '#ffffff', border: '#1d4f7a', font: 'bold 56px Arial' });
  f.label('UN1977 · −196 °C', 0, 1.72, r + 0.028, 0.34, 0.05, { bg: '#ffffff', fg: '#1d4f7a', border: '#ffffff', font: 'bold 40px Arial' });
  // relief stack, the insulated line
  f.cyl(M.steel, 0.25, top + r * 0.3, -0.2, 0.025, 0.025, 0.5, 8);
  f.cyl(M.dark, 0.25, top + r * 0.3 + 0.5, -0.2, 0.05, 0.035, 0.08, 8);
  f.cyl(M.steel, -0.1, top + r * 0.38, 0.1, 0.05, 0.05, Math.max(0.1, ceil - top - r * 0.38), 10);
  f.cyl(M.frost, -0.1, top + r * 0.38, 0.1, 0.06, 0.06, 0.25, 10);
  // the floor marking round it
  for (const [a, b, cc, d] of [[-r - 0.35, -r - 0.35, r + 0.35, -r - 0.25], [-r - 0.35, r + 0.35, r + 0.35, r + 0.45], [-r - 0.35, -r - 0.35, -r - 0.25, r + 0.45], [r + 0.25, -r - 0.35, r + 0.35, r + 0.45]]) {
    const p0 = f.p(a, 0, b), p1 = f.p(cc, 0, d);
    c.K.box(M.hazard, Math.min(p0.x, p1.x), 0.001, Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), 0.004, Math.max(p0.z, p1.z), { faces: ['py'] });
  }
  f.col(-r, -r, r, r + 0.24, h, SURF.metal);
}

/**
 * An LN₂ storage vessel (a round cryo freezer) at (x, z) turned yaw: caster ring, steel body, frost at the lid seam, the
 * lid (lifted when `open`, rack tops showing), its controller with the level readout, the fill hose.
 */
export function cryoVessel(c, x, z, { yaw = 0, r = 0.46, h = 1.0, open = false, level = 42 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, yaw);
  f.cyl(M.dark, 0, 0, 0, r * 0.95, r * 0.95, 0.1, 20);
  f.cyl(M.steel, 0, 0.1, 0, r, r, h - 0.1, 20);
  f.add(M.steel, torG(r + 0.004, 0.01, 4, 24), 0, 0.5, 0, [PI / 2, 0, 0]);
  f.add(M.frost, torG(r, 0.014, 4, 24), 0, h - 0.01, 0, [PI / 2, 0, 0]);
  if (open) {
    f.cyl(M.black, 0, h - 0.004, 0, r * 0.85, r * 0.85, 0.005, 20);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * PI * 2;
      f.box(M.steel, Math.cos(a) * r * 0.5, h + 0.04, Math.sin(a) * r * 0.5, 0.12, 0.08, 0.12);
      f.rod(M.steel, [Math.cos(a) * r * 0.5, h + 0.08, Math.sin(a) * r * 0.5], [Math.cos(a) * r * 0.5, h + 0.2, Math.sin(a) * r * 0.5], 0.006, 4);
    }
    const g = cached('cvLid' + k3(r), () => new THREE.CylinderGeometry(r * 0.9, r * 0.98, 0.08, 20).translate(0, 0.04, r));
    f.add(M.steel, g, 0, h, -r, [-1.9, 0, 0]);
  } else {
    f.cyl(M.steel, 0, h, 0, r * 0.98, r * 0.9, 0.08, 20);
    f.cyl(M.white, 0, h + 0.08, 0, 0.15, 0.13, 0.08, 14);
    f.rod(M.dark, [-0.12, h + 0.18, 0.1], [0.12, h + 0.18, 0.1], 0.012, 6);
  }
  f.box(M.dark, 0, h - 0.16, r + 0.05, 0.28, 0.22, 0.1, 0.015);
  f.label(`−190 °C · LN₂ ${level} %`, 0, h - 0.13, r + 0.101, 0.24, 0.07, { bg: '#08121a', fg: '#5ee0ff', border: '#08121a', font: 'bold 34px monospace' });
  f.box(level < 25 ? U.ledR : U.ledG, -0.09, h - 0.22, r + 0.101, 0.015, 0.015, 0.004);
  f.box(U.ledA, -0.05, h - 0.22, r + 0.101, 0.015, 0.015, 0.004);
  f.add(M.dark, cached('cvHose', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0.12, 0, 0), V(0.2, 0.15, 0.06), V(0.3, -0.4, 0.08), V(0.35, -0.9, 0.2), V(0.5, -0.97, 0.45)]), 10, 0.018, 5)), 0, h, r * 0.7, null);
  c.col(x - r, 0, z - r, x + r, h + 0.12, z + r, SURF.metal);
}

/** a low rack of portable LN₂ dewars against the wall at (x, z): platform, back rail, `n` dewars of mixed sizes */
export function dewarRack(c, x, z, face, { len = 2.0, n = 4 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.steel, -len / 2, 0.12, 0.02, len / 2, 0.15, 0.52, 0.006);
  for (const u of [-len / 2 + 0.05, len / 2 - 0.05]) {
    for (const v of [0.06, 0.48]) f.box(M.steel, u, 0.06, v, 0.04, 0.12, 0.04);
    f.box(M.steel, u, 0.55, 0.04, 0.04, 0.8, 0.04);
  }
  f.hcyl(M.steel, 0, 0.9, 0.04, 0.018, len, 8, 'u');
  f.hcyl(M.yellow, 0, 0.6, 0.5, 0.01, len - 0.1, 6, 'u');
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.5)) / n;
    const r = 0.16 + rnd() * 0.07, hh = 0.5 + rnd() * 0.25;
    f.cyl(M.steel, u, 0.15, 0.27, r, r, hh * 0.78, 14);
    f.add(M.steel, domeG(r, 14), u, 0.15 + hh * 0.78, 0.27, null, [1, 0.5, 1]);
    f.cyl(M.dark, u, 0.15 + hh * 0.78 + r * 0.45, 0.27, 0.05, 0.05, 0.1, 8);
    f.cyl(i % 2 ? X.cryoBlue : M.white, u, 0.15 + hh * 0.78 + r * 0.45 + 0.1, 0.27, 0.065, 0.06, 0.04, 8);
    f.add(M.frost, torG(0.055, 0.01, 4, 10), u, 0.15 + hh * 0.78 + r * 0.45 + 0.02, 0.27, [PI / 2, 0, 0]);
    for (const s of [-1, 1]) f.add(M.steel, torG(0.07, 0.008, 3, 8, PI), u + s * r * 0.55, 0.15 + hh * 0.78 + r * 0.25, 0.27, [0, s * PI / 2, 0]);
  }
  f.label('LN₂ DEWARS · FILL FROM TANK T-1 ONLY', 0, 1.15, 0.004, 0.9, 0.08, { bg: '#1d4f7a', fg: '#ffffff', border: '#1d4f7a', font: 'bold 36px Arial' });
  f.col(-len / 2, 0, len / 2, 0.52, 0.95, SURF.metal);
}

/**
 * A gas manifold on the wall at (x, z): backing panel, a copper header up to the ceiling, per gas a regulator with two
 * gauges, a pigtail to its chained cylinder (hiveProps' gasCylinder, collider included), a label; the shut-off.
 */
export function gasManifold(c, x, z, face, { w = 2.0, gases = ['N₂', 'CO₂', 'O₂', 'Ar'], ceil = 4 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const cols = { 'N₂': M.black, 'CO₂': M.grey, 'O₂': M.white, Ar: M.green, He: M.blue };
  f.box(X.labGrey, 0, 1.6, 0.01, w, 0.9, 0.02, 0.01);
  f.hcyl(X.copper, 0, 1.9, 0.08, 0.02, w - 0.1, 8, 'u');
  f.cyl(X.copper, w / 2 - 0.08, 1.9, 0.08, 0.02, 0.02, Math.max(0.1, ceil - 1.9), 8);
  const n = gases.length;
  gases.forEach((g, i) => {
    const u = -w / 2 + (w * (i + 0.5)) / n;
    f.cyl(X.copper, u, 1.6, 0.08, 0.012, 0.012, 0.3, 6);
    f.box(X.brass, u, 1.52, 0.09, 0.09, 0.12, 0.08, 0.01);
    f.gauge(u - 0.07, 1.62, 0.12, 0.07);
    f.gauge(u + 0.07, 1.62, 0.12, 0.07);
    f.hcyl(M.dark, u, 1.45, 0.14, 0.022, 0.04, 8, 'v');
    f.add(X.copper, cached('pigtail', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.02, -0.12, 0.05), V(0.0, -0.08, 0.13), V(0, 0.0, 0.14)]), 8, 0.006, 4)), u, 1.47, 0.1);
    const p = f.p(u, 0, 0.24);
    P.gasCylinder(c, p.x, p.z, cols[g] ?? M.blue);
    f.label(g, u, 2.0, 0.021, 0.16, 0.08, { bg: '#1b2127', fg: '#e8edf0', border: '#1b2127', font: 'bold 56px Arial' });
  });
  f.hcyl(M.dark, 0, 1.05, 0.39, 0.012, w - 0.1, 6, 'u');
  for (const s of [-1, 1]) f.box(M.steel, s * (w / 2 - 0.03), 0.55, 0.2, 0.04, 1.1, 0.4);
  f.box(M.red, -w / 2 + 0.15, 1.3, 0.05, 0.16, 0.03, 0.03);
  f.label('EMERGENCY GAS SHUT-OFF', -w / 2 + 0.2, 1.22, 0.022, 0.36, 0.06, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 36px Arial' });
}

/** a rack of cryo boxes / cold plates on a surface at (x, y, z): 'cryo' (a steel tower of boxes), 'plates' (stacked well plates on a cold block) */
export function sampleRack(c, x, y, z, yaw = 0, { kind = 'cryo' } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw, { y });
  if (kind === 'plates') {
    f.box(M.steel, 0, 0.03, 0, 0.16, 0.06, 0.12, 0.006);
    for (let i = 0; i < 6; i++) f.box(pick(c, [M.white, X.labGrey, M.blue, M.yellow]), (rnd() - 0.5) * 0.005, 0.07 + i * 0.016, 0, 0.13, 0.014, 0.086);
    f.box(M.white, 0.2, 0.012, 0.02, 0.13, 0.024, 0.086);
    return;
  }
  f.span(M.steel, -0.07, 0, -0.07, 0.07, 0.6, -0.065);
  for (const s of [-1, 1]) f.span(M.steel, s * 0.07, 0, -0.07, s * 0.068, 0.6, 0.07);
  f.box(M.steel, 0, 0.62, 0, 0.14, 0.02, 0.14);
  f.rod(M.steel, [0, 0.62, 0], [0, 0.75, 0], 0.006, 4);
  for (let i = 0; i < 5; i++) f.box(pick(c, [M.card, M.white, M.blue, M.red, M.yellow]), 0, 0.06 + i * 0.115, 0.005, 0.13, 0.1, 0.13);
}

/**
 * A walk-in cold room over the rect, its door on the `face` side at `door` (offset along that side): insulated
 * panels with seams, the condensing unit on top, a heavy door with latch, hinges and a frosted window, the display.
 * Closed; its inside is a solid collider (nobody spawns in there).
 */
export function coldRoom(c, x0, z0, x1, z1, face, { door = 0, temp = '−20 °C', name = 'COLD ROOM 2', h = 2.7 } = {}) {
  const { M, U, X } = c;
  const K = c.K;
  K.box(M.white, x0, 0, z0, x1, h, z1, { seg: 1.2 });
  K.box(M.steel, x0 - 0.005, 0, z0 - 0.005, x1 + 0.005, 0.15, z1 + 0.005, { faces: ['px', 'nx', 'pz', 'nz'] });
  for (let x = x0 + 1.1; x < x1 - 0.2; x += 1.1) for (const z of [z0 - 0.003, z1 + 0.003]) K.box(M.grey, x - 0.006, 0.15, z - 0.002, x + 0.006, h, z + 0.002);
  for (let z = z0 + 1.1; z < z1 - 0.2; z += 1.1) for (const x of [x0 - 0.003, x1 + 0.003]) K.box(M.grey, x - 0.002, 0.15, z - 0.006, x + 0.002, h, z + 0.006);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  K.box(M.grey, cx - 0.5, h, cz - 0.35, cx + 0.5, h + 0.42, cz + 0.35);
  for (const s of [-0.25, 0.25]) K.cyl(M.black, cx + s, h + 0.42, cz, 0.18, 0.18, 0.01, 16);
  K.rod(X.copper, V(cx + 0.5, h + 0.2, cz), V(x1, h + 0.2, cz), 0.015, 6);
  // the door side
  const fx = face === 'e' ? x1 : face === 'w' ? x0 : cx + door, fz = face === 's' ? z1 : face === 'n' ? z0 : cz + door;
  const f = new Frame(c, fx, fz, face);
  f.span(M.dark, -0.55, 0, 0, 0.55, 2.15, 0.02);
  f.span(M.frost, -0.52, 0.02, 0.02, 0.52, 2.12, 0.03);
  f.span(X.cream, -0.49, 0.03, 0.03, 0.49, 2.08, 0.1, 0.02);
  f.span(M.steel, -0.47, 0.05, 0.1, 0.47, 0.35, 0.106);
  f.span(M.dark, 0.08, 1.35, 0.1, 0.38, 1.75, 0.108);
  f.span(M.frost, 0.1, 1.37, 0.108, 0.36, 1.73, 0.112);
  for (const y of [0.35, 1.05, 1.8]) f.box(X.chrome, -0.5, y, 0.08, 0.06, 0.18, 0.08, 0.012);
  f.box(X.chrome, 0.38, 1.1, 0.14, 0.06, 0.24, 0.08, 0.015);
  f.box(X.chrome, 0.3, 1.1, 0.19, 0.22, 0.03, 0.03, 0.01);
  f.box(M.black, 0.8, 1.55, 0.02, 0.24, 0.16, 0.04, 0.01);
  f.label(temp, 0.8, 1.57, 0.041, 0.2, 0.08, { bg: '#08121a', fg: '#5ee0ff', border: '#08121a', font: 'bold 56px monospace' });
  f.box(U.ledG, 0.72, 1.49, 0.041, 0.015, 0.015, 0.004);
  f.box(M.red, 0.8, 1.3, 0.03, 0.08, 0.08, 0.04, 0.01);
  f.label(`${name} · DO NOT PROP OPEN`, 0, 2.35, 0.004, 1.2, 0.12, { bg: '#1b2127', fg: '#e8edf0', border: '#1b2127', font: 'bold 44px Arial' });
  f.plane(M.signs, 0.28, 0.28 * (64 / 128), -0.8, 1.6, 0.004, SIGN.freezer);
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
  f.col(-0.5, 0, 0.5, 0.2, 2.1, SURF.metal);
}

// ---------------------------------------------------------------- containment
/**
 * A holding cell over the rect with its front toward `face`: steel side walls, a ceiling grille, a front of armored
 * glass (or bars, `glass: false`) with a heavy door at `door` (offset along the front) carrying a viewing slot and a
 * feeding hatch, a steel cot, a floor drain, a hose point, a camera, the number plate, a status light.
 * state 'closed' (its inside a no-spawn collider) or 'broken' (door torn off and flung out, the front smashed open).
 */
export function holdingCell(c, x0, z0, x1, z1, face, { state = 'closed', door = 0, glass = true, n = 'C-01', subject = null, sides = [true, true] } = {}) {
  const { M, U, X, rnd } = c;
  const alongX = face === 's' || face === 'n';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const bx = face === 'e' ? x0 : face === 'w' ? x1 : (x0 + x1) / 2, bz = face === 's' ? z0 : face === 'n' ? z1 : (z0 + z1) / 2;
  const f = new Frame(c, bx, bz, face);
  const H = 2.6, t = 0.08, broken = state === 'broken';
  f.span(X.cellSteel, -W / 2 + 0.01, 0, 0.0, W / 2 - 0.01, H, 0.02);
  for (let i = 0; i < 3; i++) f.span(M.dark, -W / 2 + 0.05, 0.6 + i * 0.7, 0.02, W / 2 - 0.05, 0.62 + i * 0.7, 0.025);
  for (const s of [-1, 1]) {
    if (!sides[s < 0 ? 0 : 1]) continue;
    f.span(X.cellSteel, s * (W / 2), 0, 0, s * (W / 2 - t), H, D, 0.008);
    for (let i = 1; i < 4; i++) f.span(M.dark, s * (W / 2 - t) - s * 0.002, 0.1, (i * D) / 4 - 0.01, s * (W / 2 - t) - s * 0.006, H - 0.1, (i * D) / 4 + 0.01);
  }
  f.span(M.dark, -W / 2, H, 0, W / 2, H + 0.05, D);
  const dw = 0.95, du0 = door - dw / 2, du1 = door + dw / 2, fv0 = D - 0.12;
  // the front: posts, jambs, header, threshold
  f.span(X.cellSteel, -W / 2, 0, fv0, -W / 2 + 0.1, H, D);
  f.span(X.cellSteel, W / 2 - 0.1, 0, fv0, W / 2, H, D);
  f.span(X.cellSteel, du0 - 0.09, 0, fv0, du0, H, D, 0.006);
  f.span(X.cellSteel, du1, 0, fv0, du1 + 0.09, H, D, 0.006);
  f.span(X.cellSteel, -W / 2, 2.25, fv0, W / 2, H, D);
  f.span(M.steel, du0, 0, fv0, du1, 0.025, D);
  f.label(n, door, 2.42, D + 0.002, 0.32, 0.14, { bg: '#16181a', fg: '#f0c030', border: '#16181a', font: 'bold 72px Arial' });
  f.box(broken ? M.dark : U.ledR, du1 + 0.25, 2.42, D + 0.01, 0.07, 0.07, 0.03, 0.01);
  f.label(broken ? 'BREACH' : 'OCCUPIED', du1 + 0.5, 2.42, D + 0.002, 0.3, 0.08, { bg: '#16181a', fg: broken ? '#ff5a3c' : '#e8edf0', border: '#16181a', font: 'bold 40px Arial' });
  const segs = [[-W / 2 + 0.1, du0 - 0.09], [du1 + 0.09, W / 2 - 0.1]].filter(([a, b]) => b - a > 0.08);
  for (const [a, b] of segs) {
    f.span(X.cellSteel, a, 0, fv0, b, 0.12, D);
    if (glass) {
      if (!broken) {
        f.span(U.glass, a, 0.12, D - 0.075, b, 2.25, D - 0.045);
        for (const y of [0.95, 1.75]) f.span(X.cellSteel, a, y, fv0, b, y + 0.05, D - 0.02);
        f.plane(M.signs, 0.26, 0.1, (a + b) / 2, 1.3, D - 0.04, SIGN.glass);
      } else {
        for (let k = 0; k < 5; k++) f.add(U.glass, new THREE.ConeGeometry(0.05, 0.15 + rnd() * 0.25, 3), a + ((k + 0.5) * (b - a)) / 5, 0.2, D - 0.06, [0, rnd() * 3, (rnd() - 0.5) * 0.4]);
        for (let k = 0; k < 3; k++) f.add(U.glass, new THREE.ConeGeometry(0.05, 0.12 + rnd() * 0.2, 3), a + ((k + 0.5) * (b - a)) / 3, 2.18, D - 0.06, [PI, rnd() * 3, 0]);
        for (let k = 0; k < 10; k++) f.box(U.glass, a + rnd() * (b - a), 0.004, D + 0.2 + rnd() * 1.2, 0.05 + rnd() * 0.08, 0.004, 0.04 + rnd() * 0.06, 0, [0, rnd() * 3, 0]);
        const p = f.p((a + b) / 2, 0, D + 0.7);
        c.decal('glass', p.x, p.z, 1.3, rnd() * 3);
      }
    } else {
      for (let u = a + 0.07; u < b - 0.03; u += 0.12) {
        if (broken && rnd() < 0.35) f.rod(X.cellSteel, [u, 0.12, D - 0.06], [u + (rnd() - 0.5) * 0.3, 1.2, D + 0.2 + rnd() * 0.2], 0.017, 6);
        else f.cyl(X.cellSteel, u, 0.12, D - 0.06, 0.017, 0.017, 2.13, 6);
      }
      for (const y of [1.0, 1.8]) f.span(X.cellSteel, a, y, fv0 + 0.02, b, y + 0.05, D - 0.02);
    }
  }
  // the door: shut in its frame, or torn off and thrown out onto the floor
  const leaf = (fr, u, y, v, rot) => {
    fr.box(X.cellSteel, u, y, v, dw - 0.02, 2.2, 0.06, 0.01, rot);
  };
  if (!broken) {
    leaf(f, door, 1.12, D - 0.07, null);
    f.span(M.dark, door - 0.15, 1.45, D - 0.04, door + 0.15, 1.72, D - 0.03);
    f.span(U.glass, door - 0.13, 1.47, D - 0.03, door + 0.13, 1.7, D - 0.025);
    for (let i = 0; i < 3; i++) f.span(M.dark, door - 0.13, 1.52 + i * 0.06, D - 0.024, door + 0.13, 1.525 + i * 0.06, D - 0.022);
    f.span(M.dark, door - 0.22, 0.95, D - 0.04, door + 0.22, 1.1, D - 0.02);
    f.box(X.chrome, door, 1.1, D - 0.015, 0.2, 0.02, 0.02);
    for (const y of [0.5, 1.2, 1.9]) f.box(X.chrome, door + dw / 2 - 0.1, y, D - 0.02, 0.12, 0.06, 0.04, 0.01);
    f.box(X.chrome, door + dw / 2 - 0.15, 1.2, D, 0.04, 0.24, 0.04, 0.01);
    if (subject) f.plane(M.signs, 0.3, 0.11, door, 1.95, D - 0.036, SIGN.subject);
  } else {
    const p = f.p(door + 0.35, 0, D + 1.35);
    const fl = new Frame(c, p.x, p.z, f.yaw + 0.5 + rnd() * 0.3, { y: 0.04 });
    fl.box(X.cellSteel, 0, 0, 0, dw - 0.02, 0.06, 2.2, 0.01, [0.03, 0, 0]);
    fl.span(M.dark, -0.15, 0.03, -0.62, 0.15, 0.035, -0.35);
    for (const y of [0.5, 1.9]) f.box(X.chrome, du0 - 0.02, y, D - 0.02, 0.06, 0.1, 0.05, 0, [0, 0, 0.6]);
    const q = f.p(door, 0, D + 0.6);
    c.decal('bloodDrag', q.x, q.z, 1.6, f.yaw + (rnd() - 0.5) * 0.6);
  }
  // inside: a steel cot on wall brackets, the drain, a hose point, a camera up in the back corner
  f.span(M.steel, -W / 2 + t, 0.42, 0.05, -W / 2 + t + 0.7, 0.47, Math.min(D - 0.3, 1.95));
  for (const vv of [0.3, Math.min(D - 0.3, 1.95) - 0.25]) f.box(M.steel, -W / 2 + t + 0.04, 0.3, vv, 0.04, 0.2, 0.04, 0, [0, 0, 0.5]);
  const dp = f.p(0.15, 0, D / 2);
  drainGrate(c, dp.x, dp.z, 0.24, 0.24);
  f.hcyl(X.brass, W / 2 - t - 0.04, 0.6, D - 0.35, 0.02, 0.08, 8, 'u');
  f.box(M.red, W / 2 - t - 0.09, 0.66, D - 0.35, 0.03, 0.03, 0.08);
  f.box(M.white, W / 2 - t - 0.12, H - 0.15, 0.12, 0.1, 0.08, 0.16, 0.01, [0.4, -0.7, 0]);
  f.box(U.ledR, W / 2 - t - 0.17, H - 0.19, 0.18, 0.012, 0.012, 0.012);
  // colliders: the sides, the front (glass apart from the steel), inside a closed cell a no-spawn block
  for (const s of [-1, 1]) if (sides[s < 0 ? 0 : 1]) f.col(s * (W / 2), 0, s * (W / 2 - t), D, H, SURF.metal);
  f.col(-W / 2, fv0, -W / 2 + 0.1, D, H, SURF.metal);
  f.col(W / 2 - 0.1, fv0, W / 2, D, H, SURF.metal);
  f.col(du0 - 0.09, fv0, du0, D, H, SURF.metal);
  f.col(du1, fv0, du1 + 0.09, D, H, SURF.metal);
  if (!broken) {
    for (const [a, b] of segs) f.col(a, fv0, b, D, H, glass ? SURF.glass : SURF.metal, glass ? 0 : FLAG_NOBULLET);
    f.col(du0, fv0, du1, D, H, SURF.metal);
    f.col(-W / 2 + t, 0.02, W / 2 - t, fv0, H, SURF.metal, FLAG_NOBULLET, 0, 'cellVoid');
  } else f.col(-W / 2 + t, 0.05, -W / 2 + t + 0.7, Math.min(D - 0.3, 1.95), 0.47, SURF.metal);
}

/** a tilting restraint board at (x, z) turned yaw on its bolted pedestal: pad, straps (`torn`), head block, drip tray */
export function restraintTable(c, x, z, yaw, { tilt = 0.3, blood = true, torn = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  f.box(M.dark, 0, 0.02, 0, 0.6, 0.04, 0.9);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.cyl(M.steel, su * 0.25, 0.04, sv * 0.4, 0.02, 0.02, 0.02, 6);
  f.box(M.steel, 0, 0.42, 0, 0.26, 0.76, 0.4, 0.02);
  f.hcyl(M.dark, 0, 0.82, 0, 0.06, 0.4, 12, 'u');
  const b = new Frame(c, x, z, yaw, { y: 0.95, tilt: [tilt, 0] });
  b.box(M.steel, 0, 0, 0, 0.72, 0.06, 2.0, 0.02);
  b.box(M.black, 0, 0.055, 0, 0.62, 0.05, 1.9, 0.02);
  b.box(M.black, 0, 0.1, -0.85, 0.3, 0.08, 0.2, 0.03);
  for (const [vv, wide] of [[-0.82, 0.3], [-0.45, 0.66], [-0.05, 0.66], [0.35, 0.66], [0.78, 0.66]]) {
    const cut = torn && rnd() < 0.5;
    b.box(X.leather, 0, 0.083, vv, cut ? wide * 0.45 : wide, 0.012, 0.07);
    b.box(X.chrome, 0.12, 0.09, vv, 0.035, 0.012, 0.05);
    for (const s of [-1, 1]) b.box(X.leather, s * 0.37, -0.05, vv, 0.012, cut && s > 0 ? 0.3 : 0.14, 0.06);
  }
  for (const s of [-1, 1]) {
    b.box(X.leather, s * 0.3, 0.09, 0.05, 0.12, 0.03, 0.09, 0.01);
    b.box(X.chrome, s * 0.3, 0.1, 0.05, 0.05, 0.035, 0.02);
  }
  if (blood) {
    b.box(X.bloodDry, 0.05, 0.081, -0.3, 0.34, 0.002, 0.5, 0, [0, 0.3, 0]);
    b.box(X.bloodDry, -0.1, 0.081, 0.4, 0.2, 0.002, 0.3, 0, [0, -0.5, 0]);
    const p = f.p(0.1, 0, 0.9);
    c.decal('blood', p.x, p.z, 0.8, rnd() * 3);
  }
  f.box(M.steel, 0, 0.3, 1.02, 0.5, 0.05, 0.3, 0.01);
  f.col(-0.4, -1.05, 0.4, 1.17, 1.3, SURF.metal);
}

/** a wall rack of shock prods at (x, z): the board, clips, prods (one taken), a catch pole, the charger, a shield */
export function prodRack(c, x, z, face, { n = 4, empty = [1] } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.grey, 0, 1.4, 0.01, 1.2, 0.9, 0.02, 0.01);
  for (let i = 0; i < n; i++) {
    const u = -0.45 + i * 0.22;
    for (const y of [1.12, 1.62]) f.box(M.dark, u, y, 0.035, 0.06, 0.03, 0.05);
    f.label(`P-${i + 1}`, u, 1.82, 0.021, 0.1, 0.05, { bg: '#16181a', fg: '#f0c030', border: '#16181a', font: 'bold 44px Arial' });
    if (empty.includes(i)) continue;
    f.cyl(M.black, u, 0.98, 0.06, 0.014, 0.014, 0.78, 6);
    f.cyl(M.yellow, u, 0.95, 0.06, 0.022, 0.022, 0.26, 8);
    for (const s of [-1, 1]) f.cyl(X.chrome, u + s * 0.012, 1.76, 0.06, 0.004, 0.004, 0.05, 4);
  }
  f.cyl(X.chrome, 0.52, 0.2, 0.08, 0.014, 0.014, 2.0, 6);
  f.add(M.black, torG(0.1, 0.008, 3, 12), 0.52, 2.28, 0.08, [0, PI / 2, 0]);
  f.cyl(M.black, 0.52, 0.9, 0.08, 0.02, 0.02, 0.25, 6);
  f.box(M.dark, -0.45, 0.8, 0.05, 0.22, 0.12, 0.08, 0.01);
  f.box(U.ledG, -0.5, 0.82, 0.092, 0.015, 0.015, 0.004);
  f.box(U.ledR, -0.42, 0.82, 0.092, 0.015, 0.015, 0.004);
  f.label('SIGN OUT · CONTAINMENT STAFF ONLY', 0, 1.94, 0.021, 0.8, 0.07, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 36px Arial' });
  const sf = new Frame(c, f.p(0.1, 0, 0.22).x, f.p(0.1, 0, 0.22).z, face, { tilt: [-0.18, 0] });
  sf.box(U.glass, 0, 0.5, 0, 0.55, 0.95, 0.02, 0.02);
  for (const s of [-1, 1]) sf.box(M.black, s * 0.275, 0.5, 0, 0.02, 0.95, 0.03);
  sf.box(M.black, 0, 0.5, -0.03, 0.2, 0.04, 0.04);
}

/**
 * The guard cage in the middle of a cell block, over the rect, its door on the `face` side: posts, kick panels, bar
 * mesh (bullets pass), the door swung open, inside a console with a monitor bridge, the cell door panel (per cell a
 * lit button), the big release under a flip cover, a chair.
 */
export function controlCage(c, x0, z0, x1, z1, face, { door = 0, cells = ['C-01', 'C-02', 'C-03', 'C-04'], breached = ['C-02'] } = {}) {
  const { M, U, X, rnd } = c;
  const alongX = face === 's' || face === 'n';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const H = 2.4, dw = 0.85;
  const corners = [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]];
  for (const [u, v] of corners) f.box(X.cellSteel, u - Math.sign(u) * 0.03, H / 2, v - Math.sign(v) * 0.03, 0.06, H, 0.06);
  for (const v of [-D / 2 + 0.03, D / 2 - 0.03]) f.box(X.cellSteel, 0, H - 0.03, v, W, 0.06, 0.06);
  for (const u of [-W / 2 + 0.03, W / 2 - 0.03]) f.box(X.cellSteel, u, H - 0.03, 0, 0.06, 0.06, D);
  for (let u = -W / 2 + 0.2; u < W / 2 - 0.1; u += 0.2) f.box(M.dark, u, H - 0.01, 0, 0.012, 0.012, D - 0.06);
  // sides: kick panel, rails, bars
  const side = (a, b, v, alongU) => {
    const L = b - a, m = (a + b) / 2;
    if (alongU) {
      f.box(X.cellSteel, m, 0.22, v, L, 0.44, 0.02);
      for (const y of [1.1, 1.8]) f.box(X.cellSteel, m, y, v, L, 0.04, 0.03);
      for (let u = a + 0.05; u < b - 0.02; u += 0.1) f.box(M.dark, u, 0.44 + (H - 0.5) / 2, v, 0.012, H - 0.5, 0.012);
    } else {
      f.box(X.cellSteel, v, 0.22, m, 0.02, 0.44, L);
      for (const y of [1.1, 1.8]) f.box(X.cellSteel, v, y, m, 0.03, 0.04, L);
      for (let w = a + 0.05; w < b - 0.02; w += 0.1) f.box(M.dark, v, 0.44 + (H - 0.5) / 2, w, 0.012, H - 0.5, 0.012);
    }
  };
  side(-W / 2 + 0.06, W / 2 - 0.06, -D / 2 + 0.03, true);
  side(-D / 2 + 0.06, D / 2 - 0.06, -W / 2 + 0.03, false);
  side(-D / 2 + 0.06, D / 2 - 0.06, W / 2 - 0.03, false);
  side(-W / 2 + 0.06, door - dw / 2, D / 2 - 0.03, true);
  side(door + dw / 2, W / 2 - 0.06, D / 2 - 0.03, true);
  for (const u of [door - dw / 2, door + dw / 2]) f.box(X.cellSteel, u, H / 2, D / 2 - 0.03, 0.05, H, 0.05);
  // the door, swung out
  const dg = cached('cageDoor' + k3(dw), () => {
    const parts = [new THREE.BoxGeometry(dw - 0.04, 0.04, 0.03).translate((dw - 0.04) / 2, 0.1, 0), new THREE.BoxGeometry(dw - 0.04, 0.04, 0.03).translate((dw - 0.04) / 2, 2.1, 0), new THREE.BoxGeometry(0.04, 2.04, 0.03).translate(dw - 0.06, 1.1, 0), new THREE.BoxGeometry(dw - 0.04, 0.04, 0.03).translate((dw - 0.04) / 2, 1.1, 0)];
    for (let u = 0.08; u < dw - 0.08; u += 0.1) parts.push(new THREE.BoxGeometry(0.012, 2.0, 0.012).translate(u, 1.1, 0));
    return parts;
  });
  for (const g of dg) f.add(X.cellSteel, g, door - dw / 2 + 0.02, 0, D / 2 - 0.03, [0, -1.1, 0]);
  // the console along the back
  const cv = -D / 2 + 0.06;
  f.span(X.labGrey, -W / 2 + 0.1, 0, cv, W / 2 - 0.1, 0.78, cv + 0.6, 0.01);
  f.add(M.dark, rbox(W - 0.3, 0.02, 0.36), 0, 0.84, cv + 0.25, [0.35, 0, 0]);
  cells.forEach((name, i) => {
    const u = -W / 2 + 0.35 + (i * (W - 0.7)) / Math.max(1, cells.length - 1);
    const bad = breached.includes(name);
    f.add(bad ? U.ledR : U.ledG, rbox(0.06, 0.02, 0.04, 0.008), u, 0.86, cv + 0.2, [0.35, 0, 0]);
    f.label(name, u, 0.93, cv + 0.37, 0.14, 0.05, { bg: '#16181a', fg: bad ? '#ff5a3c' : '#e8edf0', border: '#16181a', font: 'bold 40px Arial' });
  });
  f.cyl(M.red, W / 2 - 0.3, 0.86, cv + 0.42, 0.05, 0.05, 0.04, 12);
  f.box(U.glass, W / 2 - 0.3, 0.93, cv + 0.42, 0.14, 0.08, 0.14);
  f.label('RELEASE ALL', W / 2 - 0.3, 0.93, cv + 0.6, 0.2, 0.05, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 36px Arial' });
  for (let i = 0; i < 2; i++) {
    const u = -0.32 + i * 0.64;
    f.box(M.dark, u, 1.02, cv + 0.08, 0.04, 0.3, 0.04);
    f.box(M.black, u, 1.28, cv + 0.1, 0.56, 0.34, 0.035, 0.008);
    f.screen(u, 1.28, cv + 0.119, 0.52, 0.3, true, i ? 'vitals' : null);
  }
  f.cyl(M.dark, 0.05, 0.78, cv + 0.35, 0.04, 0.04, 0.02, 8);
  f.rod(M.dark, [0.05, 0.8, cv + 0.35], [0.1, 1.0, cv + 0.45], 0.006, 4);
  f.box(X.paper, -0.2, 0.9, cv + 0.45, 0.21, 0.002, 0.29, 0, [0.35, 0.3, 0]);
  const p = f.p(0.3, 0, cv + 1.0);
  P.chair(c, p.x, p.z, f.yaw + PI + (rnd() - 0.5) * 0.5, false);
  f.label('CONTROL · STAFF ONLY', 0, 2.2, D / 2 + 0.002, 0.8, 0.1, { bg: '#16181a', fg: '#f0c030', border: '#16181a', font: 'bold 44px Arial' });
  const B = FLAG_NOBULLET;
  f.col(-W / 2, -D / 2, W / 2, -D / 2 + 0.06, H, SURF.metal, B);
  f.col(-W / 2, -D / 2, -W / 2 + 0.06, D / 2, H, SURF.metal, B);
  f.col(W / 2 - 0.06, -D / 2, W / 2, D / 2, H, SURF.metal, B);
  f.col(-W / 2, D / 2 - 0.06, door - dw / 2, D / 2, H, SURF.metal, B);
  f.col(door + dw / 2, D / 2 - 0.06, W / 2, D / 2, H, SURF.metal, B);
  f.col(-W / 2 + 0.1, cv, W / 2 - 0.1, cv + 0.6, 0.9, SURF.metal);
}

/** a specimen transport cage at (x, z) turned yaw, standing at height y: bar box, floor tray, the door (open / bent), handles, a tag */
export function cage(c, x, z, yaw, { w = 0.9, d = 0.62, h = 0.7, y = 0, open = false, broken = false, tag = null, col = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(M.steel, 0, 0.03, 0, w, 0.06, d, 0.01);
  f.box(M.dark, 0, 0.065, 0, w - 0.06, 0.01, d - 0.06);
  for (const [u, v] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) f.box(M.steel, u - Math.sign(u) * 0.01, h / 2, v - Math.sign(v) * 0.01, 0.02, h, 0.02);
  for (const v of [-d / 2 + 0.01, d / 2 - 0.01]) f.box(M.steel, 0, h - 0.01, v, w, 0.02, 0.02);
  for (const u of [-w / 2 + 0.01, w / 2 - 0.01]) f.box(M.steel, u, h - 0.01, 0, 0.02, 0.02, d);
  for (let u = -w / 2 + 0.07; u < w / 2 - 0.03; u += 0.07) {
    f.box(M.steel, u, h / 2, -d / 2 + 0.01, 0.008, h - 0.04, 0.008);
    f.box(M.steel, u, h - 0.01, 0, 0.008, 0.008, d);
  }
  for (const s of [-1, 1]) for (let v = -d / 2 + 0.07; v < d / 2 - 0.03; v += 0.07) f.box(M.steel, s * (w / 2 - 0.01), h / 2, v, 0.008, h - 0.04, 0.008);
  // the door on the front: a bar panel hinged at its bottom edge
  const dg = cached('cgDoor' + k3(w, h), () => {
    const parts = [new THREE.BoxGeometry(w - 0.06, 0.02, 0.02).translate(0, h - 0.1, 0), new THREE.BoxGeometry(w - 0.06, 0.02, 0.02).translate(0, 0.02, 0)];
    for (let u = -w / 2 + 0.07; u < w / 2 - 0.05; u += 0.07) parts.push(new THREE.BoxGeometry(0.008, h - 0.1, 0.008).translate(u, h / 2 - 0.04, 0));
    return parts;
  });
  const a = broken ? 1.5 + rnd() * 0.3 : open ? 1.45 : 0;
  for (const g of dg) f.add(M.steel, g, 0, 0.06, d / 2 - 0.01, [a, broken ? 0.3 : 0, broken ? 0.2 : 0]);
  if (!open && !broken) f.box(X.chrome, w / 2 - 0.08, h / 2, d / 2 + 0.01, 0.04, 0.06, 0.02);
  for (const s of [-1, 1]) f.box(M.dark, s * (w / 2 + 0.02), h - 0.12, 0, 0.02, 0.03, 0.2);
  if (tag) f.label(tag, -w / 4, h * 0.7, d / 2 + 0.004, 0.18, 0.08, { bg: '#f7f5ec', fg: '#1d2b3a', border: '#f7f5ec', font: 'bold 36px Arial' });
  if (col) f.col(-w / 2, -d / 2, w / 2, d / 2, h, SURF.metal, FLAG_NOBULLET);
}
// ---------------------------------------------------------------- waste & plant
/**
 * The incinerator against the wall at (x, z), front toward `face` (the hero of the waste room): a ribbed, riveted
 * primary chamber, the loading door with its glowing spy port (`lit`), the ash door, the afterburner drum, the stack
 * up through the ceiling, the burner and gas train on the side, the control cabinet, soot, warnings.
 */
export function incinerator(c, x, z, face, { w = 3.0, d = 2.3, ceil = 3.6, lit = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const H = 2.15;
  f.span(M.dark, -w / 2, 0, 0.1, w / 2, 0.14, d);
  f.span(X.heatGrey, -w / 2 + 0.05, 0.14, 0.18, w / 2 - 0.05, H, d - 0.06, 0.04);
  for (let i = 0; i <= 5; i++) {
    const u = -w / 2 + 0.1 + (i * (w - 0.2)) / 5;
    f.span(M.dark, u - 0.03, 0.14, d - 0.06, u + 0.03, H, d - 0.02);
    for (let k = 0; k < 6; k++) f.add(M.dark, cylC(0.012, 0.012, 0.012, 6), u, 0.3 + k * 0.32, d - 0.013, [PI / 2, 0, 0]);
  }
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) f.span(M.dark, s * (w / 2 - 0.05), 0.14, 0.4 + k * 0.5, s * (w / 2 - 0.02), H, 0.46 + k * 0.5);
  f.span(M.dark, -w / 2 + 0.05, H - 0.08, 0.18, w / 2 - 0.05, H, d - 0.02);
  // the loading door (left of centre): frame, the rusty leaf, a heavy latch, the glowing spy port; the hood over it
  const du = -0.45;
  f.span(M.dark, du - 0.6, 0.65, d - 0.02, du + 0.6, 1.72, d + 0.03);
  f.span(X.rust, du - 0.52, 0.72, d + 0.03, du + 0.52, 1.65, d + 0.1, 0.02);
  for (const y of [0.85, 1.52]) f.add(M.dark, cylC(0.04, 0.04, 0.16, 8), du - 0.56, y, d + 0.06);
  f.rod(X.chrome, [du + 0.3, 1.2, d + 0.12], [du + 0.62, 1.45, d + 0.2], 0.022, 6);
  f.box(M.dark, du + 0.3, 1.2, d + 0.11, 0.1, 0.16, 0.04);
  f.add(M.dark, torG(0.07, 0.015, 4, 14), du, 1.3, d + 0.105);
  f.add(lit ? G.flame : M.black, discG(0.062, 14), du, 1.3, d + 0.101);
  f.span(X.soot, du - 0.55, 1.66, d + 0.03, du + 0.55, 1.95, d + 0.035);
  f.add(X.heatGrey, rbox(1.4, 0.08, 0.4, 0.01), du, 1.95, d + 0.15, [-0.35, 0, 0]);
  f.span(M.hazard, du - 0.7, 1.99, d + 0.02, du + 0.7, 2.1, d + 0.03);
  // the ash door low down, a steel ash bin
  f.span(M.dark, du - 0.35, 0.18, d - 0.02, du + 0.35, 0.52, d + 0.05);
  f.box(X.chrome, du, 0.35, d + 0.07, 0.3, 0.03, 0.03);
  // the afterburner drum across the top at the back, the stack up through the ceiling
  f.hcyl(X.heatGrey, 0, H + 0.36, 0.65, 0.38, w - 0.5, 20, 'u');
  for (const s of [-1, 1]) f.add(M.dark, cylC(0.4, 0.4, 0.05, 20), s * (w / 2 - 0.25), H + 0.36, 0.65, [0, 0, PI / 2]);
  f.cyl(X.soot, w / 2 - 0.7, H + 0.5, 0.45, 0.28, 0.28, Math.max(0.1, ceil - H - 0.5), 16);
  for (const y of [H + 0.8, ceil - 0.15]) f.add(M.dark, torG(0.29, 0.02, 4, 16), w / 2 - 0.7, y, 0.45, [PI / 2, 0, 0]);
  // the burner and gas train on the right side
  f.hcyl(M.blue, w / 2 + 0.2, 0.9, d * 0.55, 0.2, 0.4, 14, 'u');
  f.box(M.blue, w / 2 + 0.3, 0.65, d * 0.55, 0.3, 0.3, 0.3, 0.02);
  f.rod(M.yellow, [w / 2 + 0.35, 0.9, d * 0.55 - 0.2], [w / 2 + 0.35, 0.9, 0.15], 0.03, 8);
  f.cyl(M.yellow, w / 2 + 0.35, 0.9, 0.15, 0.03, 0.03, ceil - 0.9, 8);
  for (const v of [0.6, 1.0]) f.add(M.red, torG(0.06, 0.01, 4, 12), w / 2 + 0.35, 0.9, v, [0, PI / 2, 0]);
  // the control cabinet on the front right
  const cu = w / 2 - 0.5;
  f.span(M.grey, cu - 0.33, 0.85, d + 0.0, cu + 0.33, 1.85, d + 0.25, 0.015);
  f.screen(cu - 0.08, 1.58, d + 0.252, 0.3, 0.2, true, 'spectrum');
  f.gauge(cu + 0.2, 1.62, d + 0.25, 0.1);
  f.gauge(cu + 0.2, 1.46, d + 0.25, 0.1);
  f.label('CHAMBER 850 °C', cu - 0.08, 1.4, d + 0.252, 0.3, 0.06, { bg: '#08140e', fg: '#ffa040', border: '#08140e', font: 'bold 40px monospace' });
  f.label('AFTERBURN 1100 °C', cu - 0.08, 1.32, d + 0.252, 0.3, 0.06, { bg: '#08140e', fg: '#ffa040', border: '#08140e', font: 'bold 40px monospace' });
  for (let i = 0; i < 3; i++) f.box([U.ledG, U.ledA, U.ledR][i], cu - 0.2 + i * 0.1, 1.18, d + 0.255, 0.04, 0.04, 0.02, 0.008);
  f.add(M.red, cylC(0.045, 0.045, 0.05, 12), cu + 0.2, 1.05, d + 0.27, [PI / 2, 0, 0]);
  f.box(M.yellow, cu + 0.2, 1.05, d + 0.251, 0.13, 0.13, 0.004);
  f.label('DANGER · HOT SURFACE · 850 °C', du, 2.35, d - 0.02, 1.1, 0.14, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 44px Arial' });
  f.label('BIOHAZARD WASTE ONLY · LOG EVERY LOAD', cu, 0.62, d + 0.002, 0.64, 0.1, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 32px Arial' });
  // the heat on the floor, the glow
  const p = f.p(du, 0, d + 0.6);
  c.decal('burn', p.x, p.z, 1.4, 0.3);
  if (lit) f.light(du, 1.2, d + 0.5, 0.55, 1.4, [1.0, 0.45, 0.15], null, 3.4);
  f.col(-w / 2, 0.1, w / 2 + 0.45, d + 0.1, H + 0.75, SURF.metal);
}

/**
 * A 660 L wheeled waste cart at (x, z) turned yaw: kind 'bio' (red, biohazard) or 'general' (green); the lid shut or
 * flipped back over a heap of red bags (`open`); `tipped` lies on its side with the bags spilled.
 */
export function wasteCart(c, x, z, yaw, { kind = 'bio', open = false, tipped = false } = {}) {
  const { M, X, rnd } = c;
  const W = 1.25, D = 0.75, H = 1.05;
  const mat = kind === 'bio' ? X.bioRed : M.green;
  const f = new Frame(c, x, z, yaw, tipped ? { y: D / 2 + 0.02, tilt: [PI / 2, 0] } : {});
  f.span(mat, -W / 2 + 0.04, 0.14, -D / 2 + 0.04, W / 2 - 0.04, H, D / 2 - 0.02, 0.05);
  f.span(mat, -W / 2, H - 0.12, -D / 2, W / 2, H, D / 2 + 0.03, 0.02);
  for (const s of [-1, 1]) f.box(M.dark, s * (W / 2 + 0.01), H - 0.35, 0, 0.04, 0.08, 0.12);
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      f.box(M.dark, su * (W / 2 - 0.12), 0.12, sv * (D / 2 - 0.12), 0.06, 0.06, 0.06);
      f.hcyl(X.rubber, su * (W / 2 - 0.12), 0.07, sv * (D / 2 - 0.12), 0.07, 0.04, 10, 'u');
    }
  }
  f.hcyl(X.chrome, 0, H - 0.1, -D / 2 - 0.06, 0.018, W - 0.2, 8, 'u');
  for (const s of [-1, 1]) f.rod(X.chrome, [s * (W / 2 - 0.1), H - 0.1, -D / 2 - 0.06], [s * (W / 2 - 0.1), H - 0.1, -D / 2 + 0.02], 0.015, 6);
  if (open || tipped) {
    const g = cached('wcLid', () => new RoundedBoxGeometry(W + 0.02, 0.05, D + 0.04, 1, 0.02).translate(0, 0, (D + 0.04) / 2));
    f.add(mat, g, 0, H, -D / 2 - 0.02, [-(PI - 0.4), 0, 0]);
    for (let i = 0; i < 4; i++) f.add(X.bagRed, capG(0.18, 0.2, 3, 8), -0.35 + i * 0.24, H - 0.05 + (i % 2) * 0.06, (rnd() - 0.5) * 0.2, [PI / 2, rnd() * 3, 0], [1, 1, 0.75]);
  } else f.box(mat, 0, H + 0.025, 0.02, W + 0.02, 0.05, D + 0.04, 0.02);
  if (kind === 'bio') f.plane(M.signs, 0.3, 0.3, 0, H * 0.55, D / 2 - 0.018, SIGN.bio);
  f.label(kind === 'bio' ? 'CLINICAL WASTE · UN3291' : 'GENERAL WASTE', 0, H * 0.25, D / 2 - 0.018, 0.6, 0.08, { bg: kind === 'bio' ? '#c0231d' : '#2e6e40', fg: '#ffffff', border: kind === 'bio' ? '#c0231d' : '#2e6e40', font: 'bold 40px Arial' });
  if (tipped) {
    for (let i = 0; i < 4; i++) {
      const p = f.p(-0.4 + i * 0.3 + rnd() * 0.2, 0, 0);
      c.K.add(X.bagRed, capG(0.18, 0.2, 3, 8), p.x + Math.sin(f.yaw) * (0.9 + rnd() * 0.6), 0.14, p.z + Math.cos(f.yaw) * (0.9 + rnd() * 0.6), [PI / 2, rnd() * 3, 0], [1, 1, 0.7]);
    }
  }
  f.col(-W / 2, -D / 2 - 0.08, W / 2, D / 2 + 0.03, H + 0.05, SURF.metal);
}

/**
 * An overhead monorail hoist: an I-beam from (x0, z0) to (x1, z1) at height y hung from the ceiling, a trolley at `t`
 * (0..1 along it) with a chain block and a hook `drop` below the beam; `load` 'drum' | 'bag' | 'cage' | null hangs on it.
 */
export function hoist(c, x0, z0, x1, z1, y, ceil, { t = 0.5, drop = 1.0, load = null } = {}) {
  const { M, X } = c;
  const L = Math.hypot(x1 - x0, z1 - z0);
  const yaw = Math.atan2(x1 - x0, z1 - z0);
  const f = new Frame(c, x0, z0, yaw);
  f.box(M.yellow, 0, y, L / 2, 0.012, 0.22, L);
  for (const s of [-1, 1]) f.box(M.yellow, 0, y + s * 0.1, L / 2, 0.14, 0.02, L);
  for (let v = 0.3; v < L; v += 2.0) {
    f.cyl(M.dark, 0, y + 0.11, v, 0.02, 0.02, ceil - y - 0.11, 6);
    f.box(M.dark, 0, ceil - 0.02, v, 0.2, 0.04, 0.2);
  }
  for (const v of [0, L]) f.box(M.red, 0, y - 0.05, v, 0.16, 0.12, 0.04);
  const tv = L * t;
  f.box(M.dark, 0, y - 0.14, tv, 0.2, 0.08, 0.3, 0.01);
  for (const s of [-1, 1]) for (const dv of [-0.1, 0.1]) f.hcyl(M.dark, s * 0.08, y - 0.08, tv + dv, 0.035, 0.03, 8, 'u');
  f.box(M.yellow, 0, y - 0.4, tv, 0.26, 0.3, 0.22, 0.04);
  f.add(M.dark, torG(0.13, 0.006, 3, 16), 0.15, y - 0.75, tv, [0, PI / 2, 0], [1, 2.4, 1]);
  const hy = y - 0.55 - drop;
  f.cyl(M.dark, 0, hy + 0.12, tv, 0.008, 0.008, y - 0.55 - hy - 0.12, 4);
  f.box(M.yellow, 0, hy + 0.08, tv, 0.08, 0.12, 0.06, 0.01);
  f.add(M.dark, torG(0.05, 0.012, 4, 10, PI * 1.5), 0, hy - 0.02, tv, [0, PI / 2, PI / 2]);
  if (load === 'drum') {
    for (const s of [-1, 1]) f.rod(M.dark, [0, hy - 0.05, tv], [s * 0.25, hy - 0.35, tv], 0.006, 4);
    f.cyl(M.blue, 0, hy - 1.25, tv, 0.29, 0.29, 0.88, 16);
    f.add(M.dark, torG(0.295, 0.012, 4, 16), 0, hy - 0.6, tv, [PI / 2, 0, 0]);
  } else if (load === 'bag') {
    for (const s of [-1, 1]) f.rod(M.dark, [0, hy - 0.05, tv], [0, hy - 0.45, tv + s * 0.6], 0.008, 4);
    f.add(M.bag, capG(0.24, 1.3, 4, 10), 0, hy - 0.5, tv, [PI / 2, 0, 0], [1, 1, 0.6]);
  } else if (load === 'cage') {
    for (const s of [-1, 1]) for (const r of [-1, 1]) f.rod(M.dark, [0, hy - 0.05, tv], [s * 0.4, hy - 0.4, tv + r * 0.3], 0.005, 3);
    const p = f.p(0, 0, tv);
    cage(c, p.x, p.z, yaw, { y: hy - 1.15, h: 0.75, col: false, broken: true });
  }
}

/** a roller conveyor over the rect (running along its longer side): frame, rollers, legs, side guards, a pull-cord, a motor */
export function conveyor(c, x0, z0, x1, z1, { h = 0.82, load = true } = {}) {
  const { M, U, X, rnd } = c;
  const alongX = x1 - x0 >= z1 - z0;
  const L = alongX ? x1 - x0 : z1 - z0, W = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, alongX ? 'e' : 's');
  // (frame: u across, v along the run)
  for (const s of [-1, 1]) {
    f.box(M.grey, s * (W / 2 - 0.03), h - 0.06, 0, 0.05, 0.12, L);
    f.box(M.yellow, s * (W / 2 - 0.02), h + 0.08, 0, 0.02, 0.1, L);
  }
  const n = Math.floor(L / 0.12);
  for (let i = 0; i < n; i++) f.hcyl(M.steel, 0, h - 0.03, -L / 2 + (i + 0.5) * (L / n), 0.03, W - 0.1, 8, 'u');
  for (let v = -L / 2 + 0.2; v <= L / 2 - 0.15; v += Math.max(0.8, (L - 0.4) / Math.max(1, Math.round((L - 0.4) / 1.2)))) {
    for (const s of [-1, 1]) {
      f.box(M.grey, s * (W / 2 - 0.06), (h - 0.12) / 2, v, 0.05, h - 0.12, 0.05);
      f.box(M.dark, s * (W / 2 - 0.06), 0.015, v, 0.1, 0.03, 0.1);
    }
    f.box(M.grey, 0, 0.25, v, W - 0.12, 0.04, 0.04);
  }
  f.box(M.blue, W / 2 + 0.12, h - 0.2, -L / 2 + 0.3, 0.22, 0.24, 0.3, 0.02);
  f.hcyl(M.yellow, -W / 2 - 0.04, h + 0.02, 0, 0.006, L - 0.2, 4, 'v');
  f.box(M.dark, -W / 2 - 0.04, h + 0.1, L / 2 - 0.2, 0.06, 0.1, 0.06);
  f.box(U.ledR, -W / 2 - 0.074, h + 0.12, L / 2 - 0.2, 0.004, 0.02, 0.02);
  if (load) {
    f.box(M.card, 0.02, h + 0.14, -L / 4, 0.45, 0.28, 0.4, 0, [0, 0.1, 0]);
    f.plane(M.signs, 0.16, 0.16, 0.02 + 0.226, h + 0.15, -L / 4, SIGN.bio, 1024, 1024, PI / 2);
    f.add(X.bagRed, capG(0.18, 0.25, 3, 8), -0.05, h + 0.14, L / 5, [PI / 2, rnd(), 0], [1, 1, 0.7]);
  }
  f.col(-W / 2 - 0.06, -L / 2, W / 2 + 0.25, L / 2, h + 0.13, SURF.metal);
}

/**
 * A cantilevered steel catwalk along a wall: grated deck at height y over the rect (the wall on the `wall` side),
 * toe plates, a railing on the open side, triangular wall brackets. Overhead and unreachable: no collider.
 */
export function catwalk(c, x0, z0, x1, z1, y, wall, { rail = true } = {}) {
  const { M, X } = c;
  const alongX = wall === 'n' || wall === 's';
  const L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const bx = wall === 'w' ? x0 : wall === 'e' ? x1 : (x0 + x1) / 2, bz = wall === 'n' ? z0 : wall === 's' ? z1 : (z0 + z1) / 2;
  const f = new Frame(c, bx, bz, BACK[wall]);
  f.span(X.grate, -L / 2, y - 0.03, 0, L / 2, y, D);
  for (let u = -L / 2 + 0.15; u < L / 2; u += 0.3) f.box(M.dark, u, y + 0.002, D / 2, 0.02, 0.004, D - 0.04);
  f.span(M.yellow, -L / 2, y, D - 0.012, L / 2, y + 0.1, D);
  f.span(M.dark, -L / 2, y - 0.12, D - 0.06, L / 2, y - 0.03, D);
  for (let u = -L / 2 + 0.3; u < L / 2; u += 2.0) {
    f.box(M.dark, u, y - 0.08, D / 2, 0.06, 0.1, D);
    f.rod(M.dark, [u, y - 0.1, D - 0.1], [u, y - 0.8, 0.02], 0.025, 6);
    f.box(M.dark, u, y - 0.8, 0.02, 0.1, 0.12, 0.04);
  }
  if (!rail) return;
  for (let u = -L / 2 + 0.05; u <= L / 2; u += 1.5) f.cyl(M.yellow, u, y, D - 0.04, 0.022, 0.022, 1.05, 6);
  for (const yy of [y + 0.5, y + 1.05]) f.hcyl(M.yellow, 0, yy, D - 0.04, 0.022, L, 6, 'u');
}

/** a caged wall ladder at (x, z) facing `face` from the floor up to y1: stiles, rungs, standoffs, the safety hoops */
export function ladder(c, x, z, face, y1, { w = 0.5, cageFrom = 2.2 } = {}) {
  const { M } = c;
  const f = new Frame(c, x, z, face);
  for (const s of [-1, 1]) f.cyl(M.yellow, s * (w / 2), 0, 0.2, 0.022, 0.022, y1 + 1.0, 6);
  for (let y = 0.3; y < y1 + 0.1; y += 0.3) f.hcyl(M.dark, 0, y, 0.2, 0.014, w, 6, 'u');
  for (let y = 0.5; y < y1 + 0.8; y += 1.2) for (const s of [-1, 1]) f.box(M.dark, s * (w / 2), y, 0.1, 0.03, 0.03, 0.2);
  for (let y = cageFrom; y < y1 + 0.9; y += 0.7) f.add(M.yellow, torG(0.36, 0.012, 3, 14, PI), 0, y, 0.34, [PI / 2, 0, 0]);
  for (let k = 0; k < 4; k++) {
    const a = (k / 3) * PI;
    f.rod(M.yellow, [Math.cos(a) * 0.36, cageFrom, 0.34 + Math.sin(a) * 0.36], [Math.cos(a) * 0.36, y1 + 0.8, 0.34 + Math.sin(a) * 0.36], 0.008, 4);
  }
}

/** a floodlight on a bracket at height y (wall or railing), tilted down toward `face`: housing, lit face, a baked light */
export function floodLight(c, x, y, z, face, { lit = true, i = 0.6, r = 2.6, tilt = 0.6 } = {}) {
  const { M, U } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.dark, 0, y, 0.03, 0.08, 0.14, 0.06);
  f.rod(M.dark, [0, y, 0.05], [0, y - 0.05, 0.16], 0.015, 6);
  f.box(M.dark, 0, y - 0.08, 0.22, 0.34, 0.24, 0.12, 0.02, [tilt, 0, 0]);
  f.box(lit ? U.panel : M.grey, 0, y - 0.11, 0.28, 0.3, 0.2, 0.004, 0, [tilt, 0, 0]);
  // (the beam: the housing's front normal, turned into the world)
  if (lit) f.light(0, y - 0.3, 0.45, i, r, [0.95, 0.98, 1.0], [Math.sin(f.yaw) * Math.cos(tilt), -Math.sin(tilt), Math.cos(f.yaw) * Math.cos(tilt)], r * 3);
}

/**
 * A control desk against the wall at (x, z), `len` long: a sloped console of buttons and sliders, a monitor bridge
 * (vitals feeds), a gooseneck mic, a log book, per-channel status lamps (`channels`, the `bad` ones red), chairs.
 */
export function controlDesk(c, x, z, face, len, { channels = [], bad = [], chairs = 2 } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const L = len, D = 0.8;
  f.span(X.labGrey, -L / 2, 0, 0.05, L / 2, 0.72, D - 0.02, 0.012);
  f.span(M.dark, -L / 2 + 0.03, 0, D - 0.04, L / 2 - 0.03, 0.08, D - 0.02);
  f.span(X.laminate, -L / 2 - 0.02, 0.72, 0.05, L / 2 + 0.02, 0.76, D + 0.04, 0.01);
  f.add(M.dark, rbox(L - 0.1, 0.03, 0.4, 0.01), 0, 0.84, 0.28, [0.3, 0, 0]);
  const nb = Math.floor((L - 0.2) / 0.06);
  for (let i = 0; i < nb; i++) {
    const u = -L / 2 + 0.13 + i * 0.06;
    const m = i % 7 === 3 ? U.ledA : i % 5 === 1 ? U.ledG : M.black;
    f.add(m, rbox(0.035, 0.015, 0.035), u, 0.86, 0.22, [0.3, 0, 0]);
    if (i % 3 === 0) f.add(M.steel, rbox(0.012, 0.03, 0.06), u, 0.83, 0.34, [0.3, 0, 0]);
  }
  f.span(M.dark, -L / 2 + 0.05, 1.0, 0.02, L / 2 - 0.05, 1.04, 0.2);
  for (const u of [-L / 2 + 0.1, L / 2 - 0.1]) f.box(M.dark, u, 0.9, 0.05, 0.04, 0.3, 0.04);
  const nm = Math.max(1, Math.floor(L / 0.62));
  for (let i = 0; i < nm; i++) {
    const u = -L / 2 + (L * (i + 0.5)) / nm;
    f.box(M.black, u, 1.24, 0.1, 0.58, 0.36, 0.04, 0.008);
    f.screen(u, 1.24, 0.121, 0.54, 0.32, true, i % 2 ? 'vitals' : null);
  }
  channels.forEach((name, i) => {
    const u = -L / 2 + 0.3 + (i * (L - 0.6)) / Math.max(1, channels.length - 1);
    const b = bad.includes(name);
    f.box(b ? U.ledR : U.ledG, u, 1.47, 0.12, 0.05, 0.05, 0.03, 0.01);
    f.label(name, u, 1.53, 0.1, 0.22, 0.05, { bg: '#16181a', fg: b ? '#ff5a3c' : '#e8edf0', border: '#16181a', font: 'bold 36px Arial' });
  });
  f.cyl(M.dark, L / 2 - 0.4, 0.76, 0.5, 0.04, 0.04, 0.02, 8);
  f.rod(M.dark, [L / 2 - 0.4, 0.78, 0.5], [L / 2 - 0.35, 1.0, 0.62], 0.006, 4);
  f.box(M.red, -L / 2 + 0.3, 0.77, 0.62, 0.3, 0.02, 0.22, 0.004, [0, 0.1, 0]);
  f.box(X.paper, -L / 2 + 0.3, 0.782, 0.62, 0.28, 0.002, 0.2, 0, [0, 0.1, 0]);
  for (let i = 0; i < chairs; i++) {
    const p = f.p(-L / 2 + (L * (i + 0.5)) / chairs + (rnd() - 0.5) * 0.3, 0, D + 0.55);
    P.chair(c, p.x, p.z, f.yaw + PI + (rnd() - 0.5) * 0.9, i === chairs - 1 && rnd() < 0.4);
  }
  f.col(-L / 2, 0, L / 2, D + 0.04, 0.9, SURF.metal);
}

// ---------------------------------------------------------------- the lived-in bits
/**
 * A standing-height briefing table centred at (x, z), w × d: its lit top shows the complex's plan (every space of
 * `spaces` as a glowing tile, `here` marked red), papers, a radio, mugs, a torch; a soft glow.
 */
export function briefingTable(c, x, z, w, d, { spaces = [], here = null, light = true } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, 's');
  const T = 0.95;
  f.span(M.dark, -w / 2, T - 0.06, -d / 2, w / 2, T, d / 2, 0.015);
  f.span(M.black, -w / 2 + 0.06, T, -d / 2 + 0.06, w / 2 - 0.06, T + 0.004, d / 2 - 0.06);
  for (const [su, sv] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) f.box(M.dark, su * (w / 2 - 0.12), (T - 0.06) / 2, sv * (d / 2 - 0.12), 0.08, T - 0.06, 0.08);
  f.span(M.dark, -w / 2 + 0.12, 0.15, -0.03, w / 2 - 0.12, 0.2, 0.03);
  if (spaces.length) {
    let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
    for (const s of spaces) {
      ax0 = Math.min(ax0, s.x0);
      az0 = Math.min(az0, s.z0);
      ax1 = Math.max(ax1, s.x1);
      az1 = Math.max(az1, s.z1);
    }
    const k = Math.min((w - 0.2) / (ax1 - ax0), (d - 0.2) / (az1 - az0));
    const mx = (ax0 + ax1) / 2, mz = (az0 + az1) / 2;
    for (const s of spaces) {
      const u0 = (s.x0 - mx) * k, u1 = (s.x1 - mx) * k, v0 = (s.z0 - mz) * k, v1 = (s.z1 - mz) * k;
      f.span(s.id === here ? U.red : G.map, u0 + 0.004, T + 0.004, v0 + 0.004, u1 - 0.004, T + 0.007, v1 - 0.004);
    }
  }
  f.box(X.paper, -w / 2 + 0.3, T + 0.009, d / 2 - 0.25, 0.21, 0.002, 0.29, 0, [0, 0.3, 0]);
  f.box(X.paper, w / 2 - 0.35, T + 0.009, -d / 2 + 0.3, 0.21, 0.002, 0.29, 0, [0, -0.5, 0]);
  f.box(M.black, w / 2 - 0.25, T + 0.06, d / 2 - 0.2, 0.07, 0.12, 0.04, 0.01);
  f.cyl(M.black, w / 2 - 0.23, T + 0.12, d / 2 - 0.2, 0.006, 0.006, 0.12, 4);
  for (let i = 0; i < 3; i++) f.cyl(pick(c, [M.white, M.red, M.blue]), -w / 2 + 0.25 + i * 0.5 + rnd() * 0.2, T + 0.004, -d / 2 + 0.2 + rnd() * 0.1, 0.04, 0.038, 0.1, 10);
  f.hcyl(M.dark, 0.3, T + 0.03, d / 2 - 0.15, 0.025, 0.2, 8, 'u');
  if (light) f.light(0, T + 0.4, 0, 0.18, 1.2, [0.35, 0.85, 0.95], null, 2.6);
  f.col(-w / 2, -d / 2, w / 2, d / 2, T, SURF.metal);
}

/** a coffee corner against the wall at (x, z): a low counter, the coffee machine and its jug, mugs, a microwave, a note */
export function coffeeStation(c, x, z, face, len = 1.6) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const D = 0.6, T = 0.9;
  f.span(M.white, -len / 2, 0.1, 0.01, len / 2, T - 0.04, D - 0.03);
  f.span(M.dark, -len / 2 + 0.03, 0, 0.03, len / 2 - 0.03, 0.1, D - 0.06);
  for (let i = 0; i < Math.round(len / 0.5); i++) f.box(X.chrome, -len / 2 + 0.25 + i * 0.5, T - 0.2, D - 0.01, 0.12, 0.012, 0.014);
  f.span(X.laminate, -len / 2, T - 0.04, 0, len / 2, T, D, 0.008);
  f.box(M.black, -len / 2 + 0.3, T + 0.2, 0.2, 0.28, 0.4, 0.3, 0.02);
  f.box(M.dark, -len / 2 + 0.3, T + 0.03, 0.3, 0.22, 0.02, 0.2);
  f.cyl(U.glass, -len / 2 + 0.3, T + 0.04, 0.3, 0.07, 0.06, 0.15, 12);
  f.cyl(M.black, -len / 2 + 0.3, T + 0.045, 0.3, 0.064, 0.064, 0.07, 12);
  f.box(U.ledR, -len / 2 + 0.4, T + 0.33, 0.352, 0.012, 0.012, 0.004);
  for (let i = 0; i < 5; i++) {
    const mu = -len / 2 + 0.6 + i * 0.1 + rnd() * 0.03;
    f.cyl(pick(c, [M.white, M.red, M.blue, M.yellow, X.teal]), mu, T, 0.45 - (i % 2) * 0.08, 0.04, 0.038, 0.1, 10);
  }
  f.box(M.grey, len / 2 - 0.3, T + 0.16, 0.25, 0.48, 0.3, 0.36, 0.02);
  f.box(M.black, len / 2 - 0.36, T + 0.16, 0.431, 0.3, 0.2, 0.004);
  f.box(M.dark, len / 2 - 0.12, T + 0.16, 0.431, 0.08, 0.22, 0.004);
  f.box(M.yellow, 0, T + 0.5, 0.004, 0.14, 0.14, 0.004, 0, [0, 0, 0.08]);
  f.label('WASH YOUR MUG — N.', 0, T + 0.5, 0.0065, 0.13, 0.12, { bg: '#f2d64b', fg: '#1d2b3a', border: '#f2d64b', font: 'bold 30px Arial', lines: ['WASH YOUR', 'MUG — N.'] });
  f.col(-len / 2, 0, len / 2, D, T, SURF.wood);
}

/** a water cooler against the wall at (x, z): white cabinet, the blue bottle upside down on top, two taps, a cup stack */
export function waterCooler(c, x, z, face) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.white, 0, 0.5, 0.2, 0.32, 1.0, 0.32, 0.03);
  f.box(M.dark, 0, 0.62, 0.36, 0.22, 0.14, 0.02);
  for (const [s, m] of [[-1, M.blue], [1, M.red]]) f.box(m, s * 0.05, 0.72, 0.37, 0.03, 0.04, 0.03);
  f.cyl(U.glass, 0, 1.0, 0.2, 0.13, 0.13, 0.3, 14);
  f.cyl(M.blue, 0, 1.0, 0.2, 0.12, 0.12, 0.22, 14);
  f.add(U.glass, domeG(0.13, 14), 0, 1.3, 0.2, null, [1, 0.4, 1]);
  f.cyl(M.white, 0.19, 0.95, 0.2, 0.03, 0.035, 0.18, 8);
  f.col(-0.17, 0.03, 0.17, 0.37, 1.3, SURF.metal);
}

/** an olive footlocker at (x, z) turned yaw: latches, handles, stencilled name; a few personal things on the lid */
export function footLocker(c, x, z, yaw, { name = 'VASQUEZ', stuff = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  f.box(X.canvas, 0, 0.19, 0, 0.8, 0.38, 0.42, 0.02);
  f.box(M.dark, 0, 0.39, 0, 0.82, 0.03, 0.44, 0.01);
  for (const s of [-1, 1]) {
    f.box(X.chrome, s * 0.25, 0.33, 0.215, 0.05, 0.07, 0.015);
    f.box(M.dark, s * 0.41, 0.25, 0, 0.02, 0.03, 0.14);
  }
  f.label(name, 0, 0.2, 0.2115, 0.4, 0.08, { bg: '#5a6246', fg: '#e8e2cc', border: '#5a6246', font: 'bold 56px Arial' });
  if (stuff) {
    f.box(M.black, -0.2, 0.44, 0.05, 0.12, 0.1, 0.02, 0, [-0.2, 0.3, 0]);
    f.box(M.red, 0.15, 0.425, -0.02, 0.16, 0.035, 0.22, 0, [0, 0.4, 0]);
    f.hcyl(M.dark, 0.2, 0.43, 0.12, 0.02, 0.14, 8, 'u');
  }
  f.col(-0.41, -0.22, 0.41, 0.22, 0.41, SURF.metal);
}
// ---------------------------------------------------------------- room helpers
/**
 * A glazed partition along x at z from xa to xb: a white base panel, glass with steel mullions, a white panel up to
 * the ceiling h; `gaps` [[x0, x1, top]] are openings (a header above each from `top`).
 */
function glassWall(c, xa, xb, z, h, gaps = []) {
  const { M, U } = c;
  const K = c.K;
  const t = 0.05;
  const cuts = [...gaps].sort((a, b) => a[0] - b[0]);
  let a = xa;
  const segs = [];
  for (const [g0, g1] of cuts) {
    if (g0 - a > 0.02) segs.push([a, g0]);
    a = g1;
  }
  if (xb - a > 0.02) segs.push([a, xb]);
  for (const [s0, s1] of segs) {
    K.box(M.white, s0, 0, z - t, s1, 1.0, z + t);
    K.box(U.glass, s0, 1.0, z - 0.012, s1, 2.4, z + 0.012);
    K.box(M.steel, s0, 0.98, z - t - 0.01, s1, 1.02, z + t + 0.01);
    K.box(M.steel, s0, 2.38, z - t - 0.01, s1, 2.42, z + t + 0.01);
    K.box(M.white, s0, 2.42, z - t, s1, h, z + t);
    const n = Math.max(1, Math.round((s1 - s0) / 1.1));
    for (let i = 0; i <= n; i++) {
      const x = s0 + ((s1 - s0) * i) / n;
      K.box(M.steel, Math.max(s0, x - 0.03), 1.0, z - t, Math.min(s1, x + 0.03), 2.4, z + t);
    }
    c.col(s0, 0, z - t, s1, h, z + t, SURF.glass);
  }
  for (const [g0, g1, top] of cuts) {
    K.box(M.white, g0, top, z - t, g1, h, z + t);
    K.box(M.steel, g0, top - 0.06, z - t - 0.01, g1, top, z + t + 0.01);
    c.col(g0, top, z - t, g1, h, z + t, SURF.metal);
  }
}

/** papers scattered round (x, z): flat sheets and a couple of paper decals */
function papers(c, x, z, n = 5, spread = 0.8) {
  const { X, rnd } = c;
  for (let i = 0; i < n; i++) c.K.add(X.paper, planeG(0.21, 0.29), x + (rnd() - 0.5) * spread * 2, 0.002 + i * 0.0004, z + (rnd() - 0.5) * spread * 2, [-PI / 2, 0, rnd() * 3]);
  c.decal('paper', x, z, spread * 1.6, rnd() * 3);
}

/** a room title plate on the wall (a dark plate with the room's name and a coloured bar) */
function roomTitle(c, text, x, y, z, face, w = 2.4, col = '#3fbf6a') {
  c.label(text, x, y, z, face, w, 0.26, { bg: '#1b2127', fg: '#e8edf0', border: col, font: 'bold 60px Arial' });
}

// ---------------------------------------------------------------- the rooms
/**
 * Lab 4-A, the chemistry / prep lab: fume hoods, a reagent bench with its sink, coats and the safety shower down the
 * west wall; a double island in the middle (the cover between the corridor and sequencing doors); the microscopy
 * bench and its whiteboard east; the autoclave and a −80 in the north-east corner; a hand sink by the exit.
 */
export function dressLabA(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // west wall: hoods, the bench, coats, the shower (no doors on it)
  chemHood(c, x0, -11.15, 'e', { w: 1.5, ceil: h, base: 'flam' });
  chemHood(c, x0, -9.55, 'e', { w: 1.5, ceil: h, base: 'acid', gear: 2 });
  wallBench(c, x0, -7.2, 'e', 3.0, { sink: 0.9, gear: 3 });
  coatHooks(c, x0, -5.0, 'e', { n: 3, len: 1.2, dropped: true });
  safetyShower(c, x0, -3.55, 'e');
  P.gasCylinder(c, -32.95, z0 + 0.17, M.green);
  P.gasCylinder(c, -32.66, z0 + 0.2, M.blue);
  c.K.box(M.dark, -33.1, 1.0, z0, -32.52, 1.04, z0 + 0.34);
  // south wall, west of the corridor door: the flammables cabinet, first aid above it
  chemCabinet(c, -33.05, z1, 'n', { kind: 'flam', w: 1.0 });
  firstAidBox(c, -33.05, 2.0, z1, 'n');
  hazardPlacard(c, -33.05, 2.65, z1, 'n', 'nofood', { w: 0.5 });
  // east of it: the hand sink, the extinguisher
  sinkUnit(c, -26.3, z1, 'n', { kind: 'hand' });
  P.extinguisher(c, -26.85, z1, 'n');
  // the microscopy bench and its whiteboard on the east wall (south of the door to 4-B)
  wallBench(c, x1, -4.0, 'w', 2.9, { shelf: false, gear: 0, knee: 2 });
  microscope(c, -25.35, 0.92, -4.75, -PI / 2);
  microscope(c, -25.35, 0.92, -3.3, -PI / 2);
  benchKit(c, -25.4, 0.92, -2.85, -PI / 2, 'rack');
  benchKit(c, -25.38, 0.92, -5.15, -PI / 2, 'laptop');
  labStool(c, -26.05, -4.05);
  labStool(c, -26.2, -3.25, { yaw: 0.4 });
  whiteboardFormula(c, x1, -4.0, 'w', {
    w: 2.4, y: 1.98, h: 0.85, title: 'K-7 SERUM PREP · BATCH 12',
    lines: ['NaCl 0.9 % → 500 mL,  pH 7.4 ± 0.05', 'c₁V₁ = c₂V₂ → 2.5 mL stock / 50 mL', 'centrifuge 4 000 g · 10 min · 4 °C', 'titre ↓ 38 % after 3rd passage (?!)', 'DO NOT freeze-thaw K-7 stocks — N.'],
    note: 'MICROSCOPES BOOKED · DR. HALE 14:00',
  });
  // the north-east corner: the autoclave, a −80, the notice board above
  autoclave(c, -26.45, z0, 's', { ceil: h });
  freezerUpright(c, -25.47, z0, 's', { w: 0.8, note: ['SERUM STOCKS', 'K-7 · A1-A9'] });
  noticeBoard(c, -25.8, 2.55, z0, 's', { w: 0.9, h: 0.55, notes: ['FIRE DRILL · THU', 'HOOD 2 SASH STICKS'] });
  // the island in the middle, stools round it, gear on it
  islandBench(c, -30.1, -7.5, 4.2, false, { depth: 1.5, gear: 1 });
  centrifuge(c, -29.62, 0.92, -6.2, PI / 2);
  benchKit(c, -30.58, 0.92, -6.5, -PI / 2, 'stirrer');
  benchKit(c, -30.58, 0.92, -8.1, -PI / 2, 'balance');
  benchKit(c, -29.65, 0.92, -7.7, PI / 2, 'phmeter');
  benchKit(c, -29.6, 0.92, -8.6, PI / 2, 'rack');
  labStool(c, -31.35, -8.6);
  labStool(c, -31.4, -6.3, { yaw: 1 });
  labStool(c, -28.85, -8.0, { yaw: 2 });
  labStool(c, -28.6, -5.6, { down: true, yaw: 0.7 });
  labTrolley(c, -27.6, -6.9, 0.25, { load: 'glass' });
  // left in a hurry: a broken flask and its spill, papers, footprints to the door
  c.decal('glass', -28.9, -9.9, 0.6, 1.1);
  c.decal('puddle', -28.8, -10.1, 1.0, 0.3);
  papers(c, -31.7, -4.6, 5, 0.6);
  c.decal('footprints', -29.8, -4.1, 1.6, PI);
  // signs and the clock
  roomTitle(c, 'LAB 4-A · CHEMISTRY & PREP', -29.75, 3.25, z0 + 0.01, 's', 2.6, '#c63a2e');
  wallClock(c, -29.75, 3.1, z1, 'n');
  hazardPlacard(c, -29.75, 3.05, z0, 's', 'ppe', { w: 0.6 });
}

/**
 * Lab 4-B, the BSL-3 side: a glazed partition with an anteroom behind the corridor door (PPE bench, gowns, the
 * pass-through autoclave, a waste cart); inside, biosafety cabinets and incubators on the north wall, a −80, the
 * floor centrifuge, a media fridge and a bench with a sink east, the culture island; the breach: a tipped trolley, a
 * spilled culture and a blood trail to the infirmary door.
 */
export function dressLabB(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  const pz = -4.4;
  // the partition with its door opening and the autoclave let through it
  glassWall(c, x0, x1, pz, h, [[-21.3, -18.2, 2.5], [-16.35, x1, 2.1]]);
  c.K.box(M.steel, -15.05, 0, pz - 0.05, x1, 2.1, pz + 0.05);
  for (const x of [-21.3, -18.2]) c.K.box(M.steel, x - 0.04, 0, pz - 0.07, x + 0.04, 2.5, pz + 0.07);
  autoclave(c, -15.7, -3.4, 'n', { size: 'bulk', through: true, len: 1.5, ceil: h, label: 'PASS-THROUGH · 134 °C · CYCLE 4' });
  c.K.box(M.blue, -21.1, 0, -4.9, -18.4, 0.006, -4.35, { faces: ['py'] });
  c.K.box(M.hazard, -21.3, 0.001, pz - 0.05, -18.2, 0.007, pz + 0.05, { faces: ['py'] });
  hazardPlacard(c, -22.9, 2.75, pz + 0.05, 's', 'bsl3', { w: 0.7 });
  hazardPlacard(c, -19.75, 2.9, pz + 0.05, 's', 'bio', { w: 0.34 });
  hazardPlacard(c, -17.3, 2.75, pz + 0.05, 's', 'neg', { w: 0.6 });
  hazardPlacard(c, -19.75, 2.9, pz - 0.05, 'n', 'EXIT · DOFF PPE HERE', { w: 0.6 });
  // the anteroom: the PPE bench, gowns on hooks, the waste cart by the autoclave's clean door
  ppeBench(c, -23.4, z1, 'n', 1.6);
  coatHooks(c, x0, -3.45, 'e', { n: 3, len: 1.3, mats: [X.tyvek, X.labCoat, X.tyvek], empty: [1] });
  wasteCart(c, -17.3, -3.2, 0, { kind: 'bio' });
  wallClock(c, -19.75, 3.1, z1, 'n');
  // north wall (east of the infirmary door): two biosafety cabinets, the incubator stack
  biosafetyCabinet(c, -18.7, z0, 's', { uv: true });
  biosafetyCabinet(c, -17.12, z0, 's', { uv: false, mess: false });
  incubator(c, -15.75, z0, 's', { stack: 2, open: 1 });
  labStool(c, -18.5, -10.6, { yaw: 0.3 });
  // west wall: the toxics cabinet, the eyewash
  chemCabinet(c, x0, -11.2, 'e', { kind: 'tox', w: 1.1, ajar: true });
  eyewash(c, x0, -5.0, 'e');
  sharpsBox(c, x0, 1.25, -4.75, 'e');
  // east wall: a −80, the floor centrifuge, the media fridge, the bench with its sink
  freezerUpright(c, x1, -10.64, 'w', { w: 0.82, alarm: true, note: ['K-7 LIVE CULTURE', 'BSL-3 · 2 PERSON RULE'] });
  floorCentrifuge(c, x1, -9.73, 'w');
  labFridge(c, x1, -8.85, 'w', { glow: true, stock: 'media' });
  wallBench(c, x1, -7.15, 'w', 2.4, { sink: -0.6, gear: 2 });
  sharpsBox(c, x1, 1.25, -5.45, 'w');
  // the culture island and its stools
  islandBench(c, -19.2, -8.1, 4.0, true, { depth: 1.5, gear: 1 });
  benchKit(c, -20.3, 0.92, -7.62, 0, 'waterbath');
  pipetteRack(c, -19.45, 0.92, -7.58, 0);
  benchKit(c, -18.75, 0.92, -7.55, 0, 'vortex');
  centrifuge(c, -20.15, 0.92, -8.58, PI, { open: true });
  microscope(c, -18.85, 0.92, -8.55, PI);
  labStool(c, -20.5, -9.35);
  labStool(c, -18.4, -9.45, { yaw: 1.2 });
  labStool(c, -19.9, -6.75, { yaw: 0.5 });
  labStool(c, -17.5, -6.65, { down: true, yaw: 2.2 });
  // the breach: a trolley over, the culture spilled, the injured dragged to the infirmary
  labTrolley(c, -22.35, -6.1, 1.3, { load: 'glass', tipped: true });
  c.decal('glass', -22.1, -5.5, 0.8, 0.4);
  c.decal('slime', -21.7, -5.9, 1.4, 1.2);
  c.decal('blood', -19.4, -10.4, 0.9, 0.2);
  c.decal('bloodDrag', -20.6, -10.9, 1.8, 2.1);
  c.decal('bloodDrag', -21.9, -11.4, 1.4, 2.4);
  c.decal('footprints', -21.0, -10.0, 1.2, 2.0);
  papers(c, -16.6, -6.4, 4, 0.5);
  coat(new Frame(c, -23.1, -9.9, 's'), 0, 0, 0, { floor: true, mat: X.tyvek, a: 1.9 });
  roomTitle(c, 'LAB 4-B · CELL CULTURE · BSL-3', -17.3, 3.35, z0 + 0.01, 's', 2.8, '#c63a2e');
}
// @@END
