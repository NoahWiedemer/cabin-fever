// The Hive's facility rooms (world/hive.js): the offices, the conference room, the director's office, the cafeteria
// and its kitchen, the lockers and restrooms, the sleeping quarters, operations, the server room, security,
// maintenance, the stores, the archive and the corridors' wall fittings. The props are built like hiveProps.js's:
// world-space geometry for the Kit (one mesh per material, baked light) and a collider for whatever you'd bump into.
//
// c: hiveProps.js's context plus X (EXTRA_MATS, baked), G (EXTRA_GLOW, emissive), label(text, x, y, z, face, w, h,
//    opts), decal(kind, x, z, size, rot, opts), wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on),
//    dyn (a THREE.Group) and updates (per-frame callbacks).
// Floor props take the centre of their footprint (x, z) and the `face` their front looks toward ('n' -z, 's' +z,
// 'w' -x, 'e' +x); wall props take the point on the wall line (the room rect's edge) and the face into the room.
// Rects are [x0, z0, x1, z1]. Nothing here is random but c.rnd().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import { SIGN, bottleShape } from './lab.js';
import * as P from './hiveProps.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FACE_YAW = P.FACE_YAW;
const PI = Math.PI;
const WARM = [1.0, 0.8, 0.55];
const COOL = [0.85, 0.93, 1.0];
const DOWN = [0, -1, 0];

/** baked materials this module adds (hive.js builds them as c.X.<name>) */
export const EXTRA_MATS = {
  rubber: { color: 0x1b1c1d, roughness: 0.92 },
  chrome: { color: 0xd4d9de, metalness: 0.85, roughness: 0.2 },
  brass: { color: 0xb38e4c, metalness: 0.8, roughness: 0.35 },
  alu: { color: 0xc0c5c9, metalness: 0.6, roughness: 0.4 },
  stainless: { color: 0xc4cacf, metalness: 0.7, roughness: 0.28 },
  gunmetal: { color: 0x2a2e32, metalness: 0.65, roughness: 0.38 },
  copper: { color: 0xa9643a, metalness: 0.8, roughness: 0.35 },
  oak: { color: 0x9a7650, roughness: 0.6 },
  walnut: { color: 0x4e3524, roughness: 0.45 },
  pine: { color: 0xb3946a, roughness: 0.9 },
  laminate: { color: 0xd3cbb9, roughness: 0.55 },
  beige: { color: 0xcdc3ab, roughness: 0.55 },
  pale: { color: 0xe6e8e3, roughness: 0.5 },
  charcoal: { color: 0x2c2f33, roughness: 0.6 },
  fabricBlue: { color: 0x3a4a60, roughness: 0.95 },
  fabricGrey: { color: 0x66696d, roughness: 0.95 },
  fabricGreen: { color: 0x4e5f4b, roughness: 0.95 },
  fabricRed: { color: 0x7a2e2a, roughness: 0.95 },
  leather: { color: 0x3d2619, roughness: 0.42 },
  cork: { color: 0xa9804f, roughness: 0.95 },
  paper: { color: 0xf1eee4, roughness: 0.85 },
  kraft: { color: 0x957550, roughness: 0.9 },
  leaf: { color: 0x3d6a34, roughness: 0.7 },
  leafDead: { color: 0x7d6a3c, roughness: 0.85 },
  soil: { color: 0x2d241a, roughness: 1 },
  terracotta: { color: 0xa65a3a, roughness: 0.8 },
  porcelain: { color: 0xf3f3ef, roughness: 0.12 },
  partition: { color: 0x7d8a93, metalness: 0.2, roughness: 0.45 },
  mirror: { color: 0xb9c6cf, metalness: 0.95, roughness: 0.06 },
  mattress: { color: 0xd8d3c4, roughness: 0.9 },
  blanket: { color: 0x55654c, roughness: 1 },
  wool: { color: 0x6e3a33, roughness: 1 },
  denim: { color: 0x34466a, roughness: 0.9 },
  labcoat: { color: 0xeceeea, roughness: 0.85 },
  orange: { color: 0xd9621e, roughness: 0.55 },
  olive: { color: 0x565c43, roughness: 0.7 },
  navy: { color: 0x1f2b3d, roughness: 0.7 },
  felt: { color: 0x2d5a3a, roughness: 1 },
  bottle: { color: 0x8fbfdc, roughness: 0.08 },
  food: { color: 0xa8662a, roughness: 0.7 },
  foodGreen: { color: 0x6f8f3a, roughness: 0.8 },
  foodPale: { color: 0xe3cf8a, roughness: 0.7 },
  machine: { color: 0x3f6b4f, metalness: 0.3, roughness: 0.55 },
  cream: { color: 0xe3d9bd, roughness: 0.6 },
};
/** emissive materials this module adds (c.G.<name>): colour, intensity */
export const EXTRA_GLOW = {
  lamp: [0xffdc9a, 1.5],
  heat: [0xff6a20, 1.6],
  exit: [0x2fff6a, 1.2],
  lightbox: [0xffb878, 1.1],
  display: [0x6fe8ff, 1.2],
  hob: [0xff3a12, 1.4],
  fridge: [0xe6f4ff, 1.0],
  beacon: [0xffa018, 1.8],
  mapGlow: [0x7fb8ff, 0.8],
};

// ---------------------------------------------------------------- shared geometry and the local frame
const GEO = new Map();
const cached = (key, make) => {
  let g = GEO.get(key);
  if (!g) GEO.set(key, (g = make()));
  return g;
};
const r3 = (v) => Math.round(v * 1000) / 1000;
/** a rounded box (created once per size, the Kit clones it) */
const rbox = (w, h, d, r = 0.02, s = 1) => cached(`rb${r3(w)},${r3(h)},${r3(d)},${r3(r)},${s}`, () => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2.02, h / 2.02, d / 2.02)));
const boxG = (w, h, d) => cached(`bx${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
/** a centred cylinder along y: r0 at the bottom, r1 at the top */
const cylG = (r0, r1, h, seg = 12, open = false) => cached(`cy${r3(r0)},${r3(r1)},${r3(h)},${seg},${open}`, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open));
const sphG = (r, w = 10, h = 6) => cached(`sp${r3(r)},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const octG = () => cached('oct', () => new THREE.OctahedronGeometry(1, 0));
const torG = (R, r, rs = 6, ts = 12, arc = PI * 2) => cached(`to${r3(R)},${r3(r)},${rs},${ts},${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const latheG = (key, pts, seg = 12) => cached(`la${key},${seg}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
const blobG = () => cached('blob', () => new THREE.IcosahedronGeometry(1, 0));

/** a bottle (8-sided lathe, shared per size) standing at (x, y, z), a cap on it */
function bottle(c, x, y, z, r, h, mat, cap = null) {
  const rr = Math.round(r * 200) / 200, hh = Math.round(h * 50) / 50;
  c.K.add(mat, latheG(`btl${rr},${hh}`, [[0, 0], [rr, 0], [rr, hh * 0.7], [rr * 0.45, hh * 0.86], [rr * 0.38, hh]], 8), x, y, z);
  if (cap) c.K.add(cap, cylG(rr * 0.42, rr * 0.42, 0.02, 6), x, y + hh + 0.01, z);
}
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];
const jit = (c, k) => (c.rnd() - 0.5) * 2 * k;

// world face names of the local frame's sides: f front (+b), b back, r (+a), l (-a)
const WFACE = { s: { f: 'pz', b: 'nz', r: 'px', l: 'nx' }, n: { f: 'nz', b: 'pz', r: 'nx', l: 'px' }, e: { f: 'px', b: 'nx', r: 'nz', l: 'pz' }, w: { f: 'nx', b: 'px', r: 'pz', l: 'nz' } };
/**
 * A local frame at (x, z) looking toward `face` ('n'|'s'|'e'|'w', or a yaw in radians): `a` runs across it, `b` toward
 * its front, y is up. A cardinal frame (a face letter) can also place axis-aligned boxes (B) and labels.
 */
function fr(x, z, face) {
  if (typeof face === 'number') return { x, z, yaw: face, cs: Math.cos(face), sn: Math.sin(face), face: null };
  const yaw = FACE_YAW[face];
  return { x, z, yaw, cs: Math.round(Math.cos(yaw)), sn: Math.round(Math.sin(yaw)), face };
}
const at = (f, a, b) => [f.x + a * f.cs + b * f.sn, f.z - a * f.sn + b * f.cs];
const sub = (f, a, b) => fr(...at(f, a, b), f.face ?? f.yaw);
/** the world point [x, y, z] of local (a, y, b) */
const atY = (f, a, y, b) => {
  const [x, z] = at(f, a, b);
  return [x, y, z];
};
/** an axis-aligned box between two local corners (cardinal frames); faces: a string of f b l r t d */
function B(c, f, m, a0, y0, b0, a1, y1, b1, faces) {
  const [x0, z0] = at(f, a0, b0), [x1, z1] = at(f, a1, b1);
  const o = faces ? { faces: [...faces].map((k) => (k === 't' ? 'py' : k === 'd' ? 'ny' : WFACE[f.face][k])) } : undefined;
  return c.K.box(m, x0, y0, z0, x1, y1, z1, o);
}
/** a geometry at local (a, y, b), turned rx (about a), ry (about y), rz (about b) in the frame */
function A(c, f, m, g, a, y, b, rx = 0, ry = 0, rz = 0, s = null) {
  const [x, z] = at(f, a, b);
  return c.K.add(m, g, x, y, z, [rx, f.yaw + ry, rz, 'YXZ'], s);
}
const R = (c, f, m, a, y, b, w, h, d, r = 0.02, ry = 0) => A(c, f, m, rbox(w, h, d, r), a, y, b, 0, ry);
const Cu = (c, f, m, a, y, b, w, h, d, ry = 0) => A(c, f, m, boxG(w, h, d), a, y, b, 0, ry);
const Cy = (c, f, m, a, y0, b, r0, r1, h, seg = 12) => A(c, f, m, cylG(r0, r1, h, seg), a, y0 + h / 2, b);
const Ca = (c, f, m, a, y, b, r, len, seg = 10) => A(c, f, m, cylG(r, r, len, seg), a, y, b, 0, 0, PI / 2);
const Cb = (c, f, m, a, y, b, r, len, seg = 10) => A(c, f, m, cylG(r, r, len, seg), a, y, b, PI / 2);
/** a collider over the local rect (any yaw: its bounding box) */
function col(c, f, a0, b0, a1, b1, y0, y1, surf = SURF.metal) {
  const p = [at(f, a0, b0), at(f, a1, b0), at(f, a0, b1), at(f, a1, b1)];
  c.col(Math.min(...p.map((q) => q[0])), y0, Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), y1, Math.max(...p.map((q) => q[1])), surf);
}
/** a text label facing the frame's front (cardinal frames) */
function L(c, f, text, a, y, b, w, h, opts) {
  const [x, z] = at(f, a, b);
  c.label?.(text, x, y, z, f.face, w, h, opts);
}
/** a multi-line label: the lines, joined, are its text too */
const Ln = (c, f, lines, a, y, b, w, h, opts = {}) => L(c, f, lines.join(' / '), a, y, b, w, h, { ...opts, lines });
/** a region of the lab sign atlas (lab.js SIGN) as a plane facing the front */
function S(c, f, rect, a, y, b, w, h) {
  const [x, z] = at(f, a, b);
  c.K.plane(c.M.signs, w, h, x, y, z, [0, f.yaw, 0], rect, 1024, 1024);
}
/** a monitor picture facing the front, tilted back by `tilt` */
function scr(c, f, a, y, b, w, h, on) {
  const [x, z] = at(f, a, b);
  c.screen?.(x, y, z, f.yaw, w, h, on);
}
const _E = new THREE.Euler(), _Q = new THREE.Quaternion(), _Pv = new THREE.Vector3(), _Sv = new THREE.Vector3(), _Lm = new THREE.Matrix4(), _Mm = new THREE.Matrix4();
/**
 * A transform for something that may lie tipped over: parts are given in its own space (u across, y up, v forward)
 * and placed by (x, y, z), `yaw`, then a tilt rx (+ falls forward) / rz. Returns add(mat, geo, u, y, v, ax, ay, az, s).
 */
function grp(c, x, y, z, yaw, rx = 0, rz = 0) {
  const base = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), V(1, 1, 1));
  return (m, g, u, py, v, ax = 0, ay = 0, az = 0, s = null) => {
    _Lm.compose(_Pv.set(u, py, v), _Q.setFromEuler(_E.set(ax, ay, az, 'YXZ')), s ? _Sv.set(s[0], s[1], s[2]) : _Sv.set(1, 1, 1));
    return c.K.addMatrix(m, g, _Mm.multiplyMatrices(base, _Lm));
  };
}
/** where a room's wall is: side 'n' (its z0 wall), 's' (z1), 'w' (x0), 'e' (x1) at `u` along it → [x, z, face into the room] */
export function onWall(s, side, u) {
  if (side === 'n') return [u, s.z0, 's'];
  if (side === 's') return [u, s.z1, 'n'];
  if (side === 'w') return [s.x0, u, 'e'];
  return [s.x1, u, 'w'];
}

// ---------------------------------------------------------------- small things on desks and counters
/** a mug (coffee in it) at (x, y, z) */
export function mug(c, x, y, z, mat = null, yaw = 0) {
  const { K, M, X, rnd } = c;
  const m = mat ?? pick(c, [M.white, M.red, M.blue, X.pale, X.charcoal, M.yellow]);
  K.add(m, cylG(0.04, 0.042, 0.095, 10, true), x, y + 0.0475, z);
  K.add(rnd() < 0.7 ? X.food : M.black, cylG(0.038, 0.038, 0.002, 8), x, y + 0.07, z); // cold coffee
  K.add(m, torG(0.026, 0.007, 3, 6, PI), x + Math.cos(yaw) * 0.042, y + 0.05, z - Math.sin(yaw) * 0.042, [0, yaw, -PI / 2, 'YXZ']);
}
/** a stack of papers (n sheets, a little askew) */
export function papers(c, x, y, z, yaw = 0, n = 3) {
  for (let i = 0; i < n; i++) c.K.cube(c.X.paper, x + jit(c, 0.02), y + 0.002 + i * 0.003, z + jit(c, 0.02), 0.21, 0.003, 0.297, yaw + jit(c, 0.15));
}
function keyboard(c, f, a, y, b) {
  Cu(c, f, c.X.charcoal, a, y + 0.012, b, 0.44, 0.022, 0.15);
  Cu(c, f, c.M.grey, a - 0.02, y + 0.024, b + 0.005, 0.38, 0.004, 0.11);
  Cu(c, f, c.X.charcoal, a + 0.3, y + 0.015, b + 0.01, 0.06, 0.03, 0.1);
}
/** a flat-panel monitor on its stand facing the frame's front; returns nothing */
function monitor(c, f, a, y, b, on, w = 0.52) {
  const { X, U } = c;
  const h = w * 0.6;
  Cu(c, f, X.charcoal, a, y + 0.008, b, 0.22, 0.016, 0.17);
  Cu(c, f, X.charcoal, a, y + 0.16, b - 0.03, 0.05, 0.3, 0.025);
  R(c, f, X.charcoal, a, y + 0.14 + h / 2, b, w, h, 0.03, 0.008);
  scr(c, f, a, y + 0.145 + h / 2, b + 0.0155, w - 0.03, h - 0.035, on);
  Cu(c, f, on ? U.ledB : U.ledA, a + w / 2 - 0.03, y + 0.15, b + 0.016, 0.008, 0.006, 0.002);
}
function deskPhone(c, f, a, y, b) {
  const { X, M } = c;
  A(c, f, X.charcoal, rbox(0.2, 0.06, 0.18, 0.015), a, y + 0.03, b, -0.25);
  A(c, f, X.charcoal, boxG(0.06, 0.04, 0.2), a - 0.06, y + 0.07, b + 0.005, -0.2, 0, 0);
  Cu(c, f, M.grey, a + 0.03, y + 0.062, b + 0.02, 0.08, 0.004, 0.08);
}
function penCup(c, x, y, z) {
  const { K, M, X } = c;
  K.add(X.charcoal, cylG(0.035, 0.035, 0.1, 8, true), x, y + 0.05, z);
  for (let i = 0; i < 3; i++) K.rod(pick(c, [M.blue, M.red, M.black, X.charcoal]), V(x + jit(c, 0.02), y + 0.02, z + jit(c, 0.02)), V(x + jit(c, 0.04), y + 0.15, z + jit(c, 0.04)), 0.004, 4);
}
/** a small photo frame standing on a surface, facing the frame's front */
function photo(c, f, a, y, b, ry = 0) {
  A(c, f, pick(c, [c.X.walnut, c.X.alu, c.M.black]), rbox(0.14, 0.18, 0.015, 0.004), a, y + 0.085, b, -0.18, ry);
  A(c, f, pick(c, [c.X.fabricBlue, c.X.leaf, c.X.cream, c.X.terracotta]), boxG(0.11, 0.14, 0.002), a + Math.sin(ry) * 0.009, y + 0.087, b + Math.cos(ry) * 0.009, -0.18, ry);
}
/** a laptop at (a, b) on a surface at y, open toward the frame's front */
function laptop(c, f, a, y, b, open = true, on = false) {
  const { X, M } = c;
  R(c, f, X.alu, a, y + 0.01, b, 0.34, 0.02, 0.24, 0.006);
  Cu(c, f, X.charcoal, a, y + 0.021, b + 0.02, 0.3, 0.002, 0.1);
  if (!open) return R(c, f, X.alu, a, y + 0.03, b, 0.34, 0.012, 0.24, 0.005);
  A(c, f, X.alu, boxG(0.34, 0.23, 0.01), a, y + 0.12, b - 0.13, -0.25);
  const [x, z] = at(f, a, b - 0.123);
  if (on) c.K.add(c.U.screen, new THREE.PlaneGeometry(0.3, 0.19), x, y + 0.12, z, [-0.25, f.yaw, 0, 'YXZ']);
  else A(c, f, M.black, boxG(0.3, 0.19, 0.002), a, y + 0.12, b - 0.123, -0.25);
}
/** a desk lamp (the banker's kind: brass, a green glass shade lit from inside) */
export function deskLamp(c, x, y, z, yaw = 0, { on = true, light = false } = {}) {
  const { K, X, M, G } = c;
  const f = fr(x, z, yaw);
  Cy(c, f, X.brass, 0, y, 0, 0.08, 0.07, 0.025, 12);
  Cy(c, f, X.brass, 0, y + 0.025, 0, 0.012, 0.012, 0.3, 6);
  A(c, f, M.green, cylG(0.07, 0.07, 0.28, 10, false), 0, y + 0.34, 0.07, 0, 0, PI / 2, [1, 1, 0.7]);
  if (on) A(c, f, G?.lamp ?? M.white, boxG(0.24, 0.005, 0.07), 0, y + 0.268, 0.07);
  if (on && light) c.light(...atY(f, 0, y + 0.2, 0.1), 0.35, 1.0, WARM, null, 2.5);
}
/** a wall plate: a power socket, a light switch or a data socket, at (x, y, z) on the wall facing `face` */
export function wallPlate(c, x, y, z, face, kind = 'socket') {
  const { X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.pale, -0.043, y - 0.043, 0, 0.043, y + 0.043, 0.01, 'flrt');
  if (kind === 'switch') B(c, f, X.pale, -0.018, y - 0.028, 0.01, 0.018, y + 0.028, 0.018, 'flrtd');
  else if (kind === 'data') B(c, f, M.dark, -0.012, y - 0.01, 0.01, 0.012, y + 0.01, 0.011, 'f');
  else for (const s of [-0.012, 0.012]) B(c, f, M.black, s - 0.004, y - 0.006, 0.01, s + 0.004, y + 0.006, 0.011, 'f');
}

// ---------------------------------------------------------------- office furniture
/** an office chair at (x, z), its sitter looking toward `yaw` (knocked over: `down`) */
export function officeChair(c, x, z, yaw, { down = false, mat = null } = {}) {
  const { X, M } = c;
  const m = mat ?? pick(c, [X.fabricGrey, X.fabricBlue, X.charcoal]);
  const g = down ? grp(c, x, 0.3, z, yaw, -PI / 2 + 0.08, jit(c, 0.3)) : grp(c, x, 0, z, yaw);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2;
    g(X.charcoal, boxG(0.3, 0.035, 0.045), Math.sin(a) * 0.15, 0.075, Math.cos(a) * 0.15, 0, a + PI / 2, 0);
    g(X.rubber, cylG(0.028, 0.028, 0.03, 6), Math.sin(a) * 0.29, 0.03, Math.cos(a) * 0.29, 0, a, PI / 2);
  }
  g(X.chrome, cylG(0.022, 0.022, 0.3, 8), 0, 0.24, 0);
  g(M.black, cylG(0.04, 0.035, 0.08, 8), 0, 0.12, 0);
  g(m, rbox(0.48, 0.08, 0.46, 0.03), 0, 0.46, 0.02);
  g(X.charcoal, boxG(0.06, 0.34, 0.03), 0, 0.58, -0.25, -0.08);
  g(m, rbox(0.44, 0.5, 0.06, 0.03), 0, 0.84, -0.26, -0.1);
  for (const s of [-1, 1]) {
    g(X.charcoal, boxG(0.03, 0.2, 0.03), s * 0.25, 0.58, 0.0);
    g(X.charcoal, boxG(0.06, 0.03, 0.24), s * 0.25, 0.69, 0.02);
  }
}
/**
 * An office desk centred at (x, z), its sitter's side toward `face` (like hiveProps.desk): a laminate top on panel
 * legs, a modesty panel, a drawer pedestal, a monitor, keyboard, phone, the day's clutter and its chair.
 * opts: w, d, mess, top (material), chair, pc, down (the chair knocked over), pedestal ('r'|'l'|null)
 */
export function officeDesk(c, x, z, face, { w = 1.4, d = 0.75, mess = true, top = null, chair = true, pc = true, down = null, pedestal = 'r', on = null } = {}) {
  const { M, X, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.74;
  R(c, f, top ?? pick(c, [X.laminate, X.laminate, X.oak, M.white]), 0, T - 0.015, 0, w, 0.03, d, 0.01);
  for (const s of [-1, 1]) B(c, f, X.charcoal, s * (w / 2 - 0.03) - 0.018, 0, -d / 2 + 0.04, s * (w / 2 - 0.03) + 0.018, T - 0.03, d / 2 - 0.04, 'fblrt');
  B(c, f, X.charcoal, -w / 2 + 0.05, 0.32, -d / 2 + 0.05, w / 2 - 0.05, T - 0.03, -d / 2 + 0.068, 'fbt');
  if (pedestal) {
    const pa = (pedestal === 'r' ? 1 : -1) * (w / 2 - 0.27);
    B(c, f, M.grey, pa - 0.2, 0.04, -d / 2 + 0.1, pa + 0.2, T - 0.04, d / 2 - 0.06, 'flrt');
    for (let i = 0; i < 3; i++) {
      const y0 = 0.07 + i * 0.21, open = rnd() < 0.12 ? 0.22 : 0;
      B(c, f, M.grey, pa - 0.19, y0, d / 2 - 0.06 + open - 0.015, pa + 0.19, y0 + 0.19, d / 2 - 0.045 + open, 'fblrt');
      B(c, f, X.charcoal, pa - 0.06, y0 + 0.15, d / 2 - 0.045 + open, pa + 0.06, y0 + 0.165, d / 2 - 0.03 + open, 'ft');
      if (open) B(c, f, X.paper, pa - 0.15, y0 + 0.05, d / 2 - 0.3 + open, pa + 0.15, y0 + 0.17, d / 2 - 0.08 + open, 't');
    }
  }
  if (pc) {
    monitor(c, f, -0.08, T, -d / 2 + 0.2, on ?? rnd() < 0.45);
    keyboard(c, f, -0.08, T, 0.1);
    deskPhone(c, f, -w / 2 + 0.22, T, -0.12);
  }
  if (mess) {
    papers(c, ...atY(f, w / 2 - 0.3 + jit(c, 0.08), T, -0.05 + jit(c, 0.1)), f.yaw + jit(c, 0.4), 1 + Math.floor(rnd() * 4));
    if (rnd() < 0.7) mug(c, ...atY(f, w / 2 - 0.15, T, 0.15 + jit(c, 0.08)), null, rnd() * 6);
    if (rnd() < 0.6) penCup(c, ...atY(f, -w / 2 + 0.1, T, -d / 2 + 0.12));
    if (rnd() < 0.45) photo(c, f, w / 2 - 0.2, T, -d / 2 + 0.14, -0.4);
    if (rnd() < 0.5) for (let i = 0; i < 3; i++) Cu(c, f, M.yellow, -0.08 - 0.22 + i * 0.05, T + 0.14 + 0.02 * (i % 2), -d / 2 + 0.2 + 0.018, 0.05, 0.05, 0.002);
  }
  if (chair) officeChair(c, ...at(f, jit(c, 0.2), d / 2 + 0.32 + rnd() * 0.22), f.yaw + PI + jit(c, 0.5), { down: down ?? rnd() < 0.12 });
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, T, SURF.wood);
}
/** a fabric screen between two points (a partition on or between desks), from y0 up to y1, aluminium rails */
export function cubiclePartition(c, ax, az, bx, bz, { y0 = 0, y1 = 1.3, mat = null, collide = true } = {}) {
  const { K, X } = c;
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  const t = 0.025;
  const [x0, x1] = [Math.min(ax, bx), Math.max(ax, bx)], [z0, z1] = [Math.min(az, bz), Math.max(az, bz)];
  if (alongX) {
    K.box(mat ?? X.fabricBlue, x0 + 0.03, y0, az - t, x1 - 0.03, y1 - 0.03, az + t);
    K.box(X.alu, x0, y1 - 0.03, az - t - 0.005, x1, y1, az + t + 0.005);
    for (const x of [x0, x1 - 0.03]) K.box(X.alu, x, y0, az - t - 0.005, x + 0.03, y1, az + t + 0.005);
    if (collide) c.col(x0, y0, az - 0.05, x1, y1, az + 0.05, SURF.cardboard);
  } else {
    K.box(mat ?? X.fabricBlue, ax - t, y0, z0 + 0.03, ax + t, y1 - 0.03, z1 - 0.03);
    K.box(X.alu, ax - t - 0.005, y1 - 0.03, z0, ax + t + 0.005, y1, z1);
    for (const z of [z0, z1 - 0.03]) K.box(X.alu, ax - t - 0.005, y0, z, ax + t + 0.005, y1, z + 0.03);
    if (collide) c.col(ax - 0.05, y0, z0, ax + 0.05, y1, z1, SURF.cardboard);
  }
}
/**
 * A cluster of desks facing each other across a fabric screen, centred at (x, z): `n` desks a side, the screen along
 * x (alongX) or z. opts: w, d (a desk), mess, downs (how many chairs are knocked over), mat (the screen's fabric)
 */
export function deskCluster(c, x, z, alongX, { n = 2, w = 1.4, d = 0.75, mess = true, mat = null, on = null } = {}) {
  const L0 = n * w;
  for (let i = 0; i < n; i++) {
    const u = -L0 / 2 + w * (i + 0.5);
    for (const s of [-1, 1]) {
      const px = alongX ? x + u : x + s * d / 2, pz = alongX ? z + s * d / 2 : z + u;
      const face = alongX ? (s < 0 ? 'n' : 's') : s < 0 ? 'w' : 'e';
      officeDesk(c, px, pz, face, { w, d, mess, pedestal: i % 2 ? 'l' : 'r', on });
    }
  }
  if (alongX) cubiclePartition(c, x - L0 / 2, z, x + L0 / 2, z, { y0: 0.74, y1: 1.28, mat, collide: false });
  else cubiclePartition(c, x, z - L0 / 2, x, z + L0 / 2, { y0: 0.74, y1: 1.28, mat, collide: false });
  // (the screen above the desks: its collider on top of theirs)
  if (alongX) c.col(x - L0 / 2, 0.74, z - 0.04, x + L0 / 2, 1.28, z + 0.04, SURF.cardboard);
  else c.col(x - 0.04, 0.74, z - L0 / 2, x + 0.04, 1.28, z + L0 / 2, SURF.cardboard);
}
/** a steel filing cabinet at (x, z), drawers toward `face`; open: the index of a drawer pulled out (-1 none); down: toppled */
export function filingCabinet(c, x, z, face, { drawers = 4, h = 1.32, w = 0.47, d = 0.62, open = -1, mat = null, down = false } = {}) {
  const { M, X, K } = c;
  const m = mat ?? M.grey;
  if (down) {
    // fallen on its front: a box on the floor, drawers spilled, papers everywhere
    const g = grp(c, x, 0, z, FACE_YAW[face] + jit(c, 0.2));
    g(m, boxG(w, d, h), 0, d / 2, 0);
    g(m, boxG(w - 0.04, 0.3, 0.55), 0.05, 0.15, h / 2 + 0.3, 0, 0.3, 0);
    for (let i = 0; i < 6; i++) papers(c, x + jit(c, 0.9), 0, z + jit(c, 0.9), c.rnd() * 6, 1);
    c.decal?.('paper', x + jit(c, 0.5), z + jit(c, 0.5), 1.2, c.rnd() * 6);
    const f = fr(x, z, face);
    col(c, f, -w / 2, -h / 2, w / 2, h / 2 + 0.2, 0, d, SURF.metal);
    return;
  }
  const f = fr(x, z, face);
  B(c, f, m, -w / 2, 0, -d / 2, w / 2, h, d / 2 - 0.02, 'lrtb');
  B(c, f, X.charcoal, -w / 2 + 0.02, 0, d / 2 - 0.04, w / 2 - 0.02, 0.05, d / 2 - 0.02, 'f');
  const dh = (h - 0.06) / drawers;
  for (let i = 0; i < drawers; i++) {
    const y0 = 0.05 + i * dh, pull = i === open ? 0.38 : 0;
    B(c, f, m, -w / 2 + 0.012, y0 + 0.006, d / 2 - 0.02 + pull, w / 2 - 0.012, y0 + dh - 0.006, d / 2 + pull, 'fblrt');
    B(c, f, X.chrome, -0.07, y0 + dh * 0.62, d / 2 + pull, 0.07, y0 + dh * 0.62 + 0.022, d / 2 + 0.018 + pull, 'ftd');
    B(c, f, X.paper, -0.04, y0 + dh * 0.78, d / 2 + pull, 0.04, y0 + dh * 0.78 + 0.03, d / 2 + 0.003 + pull, 'f');
    if (pull) {
      B(c, f, m, -w / 2 + 0.03, y0 + 0.02, d / 2 - 0.02, w / 2 - 0.03, y0 + 0.03, d / 2 + pull - 0.02, 't');
      for (let k = 0; k < 7; k++) A(c, f, pick(c, [M.card, X.kraft, M.green, X.paper]), boxG(w - 0.1, dh * 0.7, 0.012), 0, y0 + 0.03 + dh * 0.35, d / 2 + 0.02 + k * 0.045, jit(c, 0.25));
    }
  }
  col(c, f, -w / 2, -d / 2, w / 2, d / 2 + (open >= 0 ? 0.38 : 0), 0, h, SURF.metal);
}
/** a big office copier at (x, z) facing `face`: paper trays, the scanner and its feeder, a lit panel; `broken`: an out-of-order note */
export function copier(c, x, z, face, { broken = true } = {}) {
  const { M, X, U, G } = c;
  const f = fr(x, z, face);
  const w = 0.62, d = 0.62;
  B(c, f, X.pale, -w / 2, 0.08, -d / 2, w / 2, 0.62, d / 2, 'fblrt');
  B(c, f, X.charcoal, -w / 2 + 0.02, 0, -d / 2 + 0.02, w / 2 - 0.02, 0.08, d / 2 - 0.02, 'fblr');
  for (let i = 0; i < 3; i++) {
    const y0 = 0.1 + i * 0.17;
    B(c, f, X.pale, -w / 2 + 0.02, y0, d / 2, w / 2 - 0.02, y0 + 0.15, d / 2 + 0.012, 'ft');
    B(c, f, X.charcoal, -0.1, y0 + 0.1, d / 2 + 0.012, 0.1, y0 + 0.12, d / 2 + 0.025, 'ftd');
  }
  R(c, f, X.pale, 0, 0.82, 0, w, 0.4, d, 0.03);
  B(c, f, X.charcoal, -w / 2 + 0.04, 0.7, d / 2 + 0.005, w / 2 - 0.04, 0.73, d / 2 + 0.006, 'f');
  R(c, f, X.beige, 0, 1.05, -0.02, w - 0.02, 0.06, d - 0.06, 0.015);
  R(c, f, X.pale, 0.02, 1.12, -0.05, w - 0.12, 0.08, d - 0.2, 0.02);
  // the output tray on the side and a few copies in it
  A(c, f, X.charcoal, boxG(0.3, 0.012, 0.36), w / 2 + 0.15, 0.78, 0, 0, 0, 0.12);
  A(c, f, X.paper, boxG(0.21, 0.01, 0.297), w / 2 + 0.15, 0.795, 0, 0, 0, 0.12);
  // the control panel, angled up at the front
  A(c, f, X.charcoal, boxG(0.3, 0.02, 0.14), 0.12, 1.02, d / 2 + 0.04, 0.5);
  A(c, f, broken ? U.ledA : (G?.display ?? U.ledB), boxG(0.12, 0.004, 0.06), 0.06, 1.033, d / 2 + 0.045, 0.5);
  if (broken) Ln(c, f, ['OUT OF ORDER', 'jammed again - call IT x2210'], -0.1, 0.9, d / 2 + 0.013, 0.24, 0.12, { bg: '#fdf6a8', fg: '#1a1a1a', font: 'bold 28px Arial' });
  col(c, f, -w / 2, -d / 2, w / 2 + 0.3, d / 2 + 0.1, 0, 1.18, SURF.metal);
}
/** a desktop laser printer on a surface at y */
export function printer(c, x, y, z, face) {
  const { X, U } = c;
  const f = fr(x, z, face);
  R(c, f, X.pale, 0, y + 0.12, 0, 0.42, 0.24, 0.38, 0.03);
  B(c, f, X.charcoal, -0.15, y + 0.235, -0.12, 0.15, y + 0.242, 0.05, 't');
  R(c, f, X.pale, 0, y + 0.05, 0.23, 0.36, 0.02, 0.14, 0.008);
  A(c, f, X.paper, boxG(0.21, 0.004, 0.25), 0, y + 0.246, -0.03, 0.05);
  A(c, f, X.charcoal, boxG(0.08, 0.03, 0.01), 0.14, y + 0.2, 0.192);
  A(c, f, U.ledG, boxG(0.008, 0.008, 0.004), 0.17, y + 0.19, 0.197);
}
/** a printer on its own little cabinet with reams of paper, at (x, z) facing `face` */
export function printerStand(c, x, z, face) {
  const { M, X } = c;
  const f = fr(x, z, face);
  B(c, f, X.charcoal, -0.3, 0, -0.24, 0.3, 0.7, 0.24, 'fblrt');
  B(c, f, M.black, -0.27, 0.05, 0.2, 0.27, 0.4, 0.241, 'f');
  for (let i = 0; i < 3; i++) B(c, f, X.paper, -0.22 + i * 0.01, 0.06 + i * 0.055, 0.0, 0.0 + i * 0.01, 0.11 + i * 0.055, 0.2, 'ftl');
  const [px, pz] = at(f, 0, 0);
  printer(c, px, 0.7, pz, face);
  col(c, f, -0.3, -0.24, 0.3, 0.3, 0, 0.94, SURF.metal);
}
/** a bean-to-cup coffee machine on a counter at y, facing `face` */
export function coffeeMachine(c, x, y, z, face) {
  const { X, M, U, G } = c;
  const f = fr(x, z, face);
  R(c, f, X.charcoal, 0, y + 0.19, 0, 0.3, 0.38, 0.38, 0.03);
  R(c, f, X.chrome, 0, y + 0.3, 0.19, 0.26, 0.14, 0.02, 0.006);
  A(c, f, G?.display ?? U.ledB, boxG(0.1, 0.05, 0.004), -0.04, y + 0.31, 0.2);
  for (let i = 0; i < 3; i++) Cb(c, f, X.chrome, 0.07, y + 0.335 - i * 0.03, 0.2, 0.008, 0.01, 6);
  Cy(c, f, X.charcoal, 0.06, y + 0.38, -0.06, 0.07, 0.08, 0.1, 10);
  B(c, f, X.chrome, -0.12, y, 0.1, 0.12, y + 0.02, 0.22, 'ftlr');
  B(c, f, X.charcoal, -0.05, y + 0.14, 0.12, 0.05, y + 0.18, 0.2, 'fdlr');
  mug(c, ...atY(f, 0, y + 0.02, 0.16), M.white);
}
/** a water cooler at (x, z) facing `face` (tipped: on its side, the bottle rolled off, a puddle) */
export function waterCooler(c, x, z, face, { tipped = false } = {}) {
  const { X, M } = c;
  const prof = [[0, 0], [0.13, 0], [0.135, 0.02], [0.135, 0.36], [0.1, 0.42], [0.04, 0.45], [0.035, 0.5], [0, 0.5]];
  const bottle = latheG('cooler', prof, 12);
  const yaw = FACE_YAW[face];
  const g = tipped ? grp(c, x, 0.17, z, yaw + jit(c, 0.3), -PI / 2) : grp(c, x, 0, z, yaw);
  g(X.pale, rbox(0.32, 0.95, 0.32, 0.02), 0, 0.475, 0);
  g(X.charcoal, boxG(0.22, 0.3, 0.02), 0, 0.72, 0.16);
  g(M.red, boxG(0.03, 0.05, 0.04), -0.05, 0.78, 0.175);
  g(M.blue, boxG(0.03, 0.05, 0.04), 0.05, 0.78, 0.175);
  g(X.charcoal, boxG(0.2, 0.02, 0.1), 0, 0.6, 0.17);
  g(X.pale, cylG(0.04, 0.04, 0.3, 8), 0.19, 0.72, 0.05);
  if (!tipped) {
    c.K.add(X.bottle, bottle, x, 1.42, z, [PI, 0, 0]);
    col(c, fr(x, z, face), -0.17, -0.17, 0.17, 0.2, 0, 1.45, SURF.metal);
    return;
  }
  const bx = x + jit(c, 0.6), bz = z + jit(c, 0.6);
  c.K.add(X.bottle, bottle, bx, 0.135, bz, [PI / 2, c.rnd() * 6, 0, 'YXZ']);
  c.decal?.('puddle', x + jit(c, 0.3), z + jit(c, 0.3), 1.6, c.rnd() * 6);
  c.col(x - 0.5, 0, z - 0.5, x + 0.5, 0.34, z + 0.5, SURF.metal);
}
/** an office fridge at (x, z) facing `face`: under-counter (h 0.85) or tall (h 1.7, a freezer door on top), a note on it */
export function officeFridge(c, x, z, face, { h = 0.85, w = 0.56, d = 0.58, note = true, mat = null } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const m = mat ?? X.pale;
  R(c, f, m, 0, h / 2, -0.02, w, h, d - 0.04, 0.02);
  const doors = h > 1.2 ? [[0.02, h * 0.62], [h * 0.63, h - 0.02]] : [[0.02, h - 0.02]];
  for (const [y0, y1] of doors) {
    R(c, f, m, 0, (y0 + y1) / 2, d / 2 - 0.02, w - 0.01, y1 - y0 - 0.01, 0.04, 0.012);
    B(c, f, X.chrome, w / 2 - 0.07, y0 + 0.08 + (y1 - y0 > 0.6 ? 0.25 : 0), d / 2, w / 2 - 0.05, y0 + (y1 - y0) * 0.75, d / 2 + 0.03, 'flrtd');
  }
  if (note) {
    Ln(c, f, ['PLEASE LABEL', 'YOUR FOOD!', 'anything unlabelled goes Fri.'], -0.06, h * 0.5 + 0.2, d / 2 + 0.002, 0.2, 0.15, { bg: '#fbfbf6', fg: '#b3141a', font: 'bold 30px Arial' });
    for (let i = 0; i < 4; i++) B(c, f, pick(c, [M.red, M.yellow, M.blue, M.green]), -0.2 + i * 0.07 + jit(c, 0.02), h * 0.3 + jit(c, 0.1), d / 2, -0.18 + i * 0.07 + jit(c, 0.02), h * 0.3 + 0.03, d / 2 + 0.012, 'flrt');
  }
  col(c, f, -w / 2, -d / 2, w / 2, d / 2 + 0.03, 0, h, SURF.metal);
}
/** a microwave on a surface at y facing `face` (door ajar: `open`) */
export function microwave(c, x, y, z, face, { open = false } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  R(c, f, X.pale, 0, y + 0.14, 0, 0.48, 0.28, 0.36, 0.015);
  if (open) {
    B(c, f, M.dark, -0.22, y + 0.03, 0.16, 0.1, y + 0.25, 0.18, 'f');
    A(c, f, X.pale, boxG(0.34, 0.26, 0.03).clone().translate(0.17, 0, 0), -0.23, y + 0.14, 0.19, 0, -1.1);
  } else {
    B(c, f, X.charcoal, -0.23, y + 0.02, 0.18, 0.12, y + 0.26, 0.19, 'f');
    B(c, f, M.black, -0.2, y + 0.05, 0.19, 0.07, y + 0.23, 0.192, 'f');
  }
  B(c, f, X.charcoal, 0.13, y + 0.02, 0.18, 0.23, y + 0.26, 0.19, 'f');
  B(c, f, U.ledG, 0.15, y + 0.22, 0.19, 0.21, y + 0.24, 0.192, 'f');
}
/** a kettle on a surface at y */
export function kettle(c, x, y, z, yaw = 0, mat = null) {
  const { X } = c;
  const f = fr(x, z, yaw);
  Cy(c, f, X.charcoal, 0, y, 0, 0.085, 0.085, 0.02, 12);
  A(c, f, mat ?? pick(c, [X.chrome, X.pale, c.M.red]), latheG('kettle', [[0, 0], [0.08, 0], [0.085, 0.03], [0.075, 0.17], [0.05, 0.2], [0, 0.2]], 12), 0, y + 0.02, 0);
  A(c, f, X.charcoal, torG(0.07, 0.012, 4, 8, PI), -0.07, y + 0.13, 0, 0, 0, PI / 2 + 0.2);
  A(c, f, X.charcoal, cylG(0.018, 0.01, 0.07, 6), 0.08, y + 0.14, 0, 0, 0, -0.8);
}
/**
 * A kitchenette run against a wall at (x, z) (its back on the wall line), facing `face`: base cupboards, a worktop, a
 * sink, the coffee machine, a kettle, mugs; a wall cupboard over it. opts: w, sink, micro
 */
export function kitchenette(c, x, z, face, { w = 1.8, sink = true, micro = true, upper = true } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const d = 0.6, T = 0.9;
  B(c, f, X.pale, -w / 2, 0.1, 0, w / 2, T - 0.04, d - 0.02, 'flrt');
  B(c, f, X.charcoal, -w / 2 + 0.02, 0, 0, w / 2 - 0.02, 0.1, d - 0.07, 'f');
  const n = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    const a0 = -w / 2 + (w * i) / n, a1 = a0 + w / n;
    B(c, f, X.pale, a0 + 0.006, 0.11, d - 0.02, a1 - 0.006, T - 0.05, d, 'f');
    B(c, f, X.chrome, a1 - 0.06, 0.62, d, a1 - 0.045, 0.8, d + 0.025, 'flrt');
  }
  B(c, f, X.laminate, -w / 2, T - 0.04, 0, w / 2, T, d + 0.02, 'flrt');
  if (sink) {
    B(c, f, X.stainless, -w / 2 + 0.15, T, 0.12, -w / 2 + 0.6, T + 0.003, 0.5, 't');
    B(c, f, M.dark, -w / 2 + 0.18, T + 0.003, 0.15, -w / 2 + 0.57, T + 0.004, 0.47, 't');
    const [fx, fz] = at(f, -w / 2 + 0.375, 0.06);
    c.K.cyl(X.chrome, fx, T, fz, 0.018, 0.015, 0.28, 8);
    A(c, f, X.chrome, torG(0.1, 0.013, 5, 8, PI), -w / 2 + 0.375, T + 0.28, 0.16, 0, PI / 2, 0);
  }
  if (micro) microwave(c, ...atY(f, w / 2 - 0.3, T, 0.28), face);
  coffeeMachine(c, ...atY(f, micro ? w / 2 - 0.8 : w / 2 - 0.3, T, 0.25), face);
  kettle(c, ...atY(f, 0.05, T, 0.3), f.yaw);
  for (let i = 0; i < 3; i++) mug(c, ...atY(f, -0.35 + i * 0.1 + jit(c, 0.02), T, 0.4));
  if (upper) {
    B(c, f, X.pale, -w / 2, 1.5, 0, w / 2, 2.2, 0.35, 'flrd');
    for (let i = 0; i < n; i++) {
      const a0 = -w / 2 + (w * i) / n, a1 = a0 + w / n;
      B(c, f, X.pale, a0 + 0.006, 1.51, 0.35, a1 - 0.006, 2.19, 0.37, 'f');
      B(c, f, X.chrome, a1 - 0.06, 1.55, 0.37, a1 - 0.045, 1.7, 0.39, 'flrd');
    }
  }
  col(c, f, -w / 2, 0, w / 2, d + 0.02, 0, T, SURF.wood);
}

// ---------------------------------------------------------------- lounge furniture, shelves, wall things
/** a sofa at (x, z) facing `face`: a frame on wooden feet, seat and back cushions, arms. opts: w, d, mat */
export function sofa(c, x, z, face, { w = 2.0, d = 0.86, mat = null, seats = null } = {}) {
  const { X } = c;
  const m = mat ?? pick(c, [X.fabricGreen, X.fabricGrey, X.leather, X.fabricBlue]);
  const f = fr(x, z, face);
  const n = seats ?? Math.max(1, Math.round((w - 0.36) / 0.62));
  R(c, f, m, 0, 0.26, -0.02, w, 0.22, d - 0.04, 0.03);
  R(c, f, m, 0, 0.62, -d / 2 + 0.11, w - 0.02, 0.5, 0.2, 0.05);
  for (const s of [-1, 1]) R(c, f, m, s * (w / 2 - 0.09), 0.46, 0, 0.18, 0.4, d, 0.05);
  const cw = (w - 0.36) / n;
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + 0.18 + cw * (i + 0.5);
    A(c, f, m, rbox(cw - 0.02, 0.13, d - 0.26, 0.04), a, 0.43, 0.08, jit(c, 0.03), jit(c, 0.04));
    A(c, f, m, rbox(cw - 0.03, 0.42, 0.15, 0.05), a, 0.74, -d / 2 + 0.27, -0.2 + jit(c, 0.06), jit(c, 0.05));
  }
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy(c, f, X.walnut, s * (w / 2 - 0.06), 0, t * (d / 2 - 0.08), 0.022, 0.03, 0.15, 6);
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, 0.87, SURF.wood);
}
/** an armchair at (x, z) turned `yaw` (its sitter looking that way) */
export function armchair(c, x, z, yaw, { mat = null } = {}) {
  const { X } = c;
  const m = mat ?? pick(c, [X.leather, X.fabricGreen, X.fabricRed]);
  const f = fr(x, z, yaw);
  R(c, f, m, 0, 0.26, 0, 0.84, 0.22, 0.82, 0.03);
  R(c, f, m, 0, 0.64, -0.3, 0.82, 0.56, 0.2, 0.05);
  for (const s of [-1, 1]) R(c, f, m, s * 0.33, 0.47, 0.02, 0.18, 0.4, 0.8, 0.05);
  R(c, f, m, 0, 0.43, 0.07, 0.48, 0.13, 0.58, 0.04);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy(c, f, X.walnut, s * 0.36, 0, t * 0.33, 0.022, 0.03, 0.15, 6);
  col(c, f, -0.42, -0.41, 0.42, 0.41, 0, 0.92, SURF.wood);
}
/** a low coffee table at (x, z), long across `face`: magazines, a coaster, a remote */
export function coffeeTable(c, x, z, face, { w = 1.1, d = 0.6, mat = null } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, mat ?? X.walnut, 0, 0.42, 0, w, 0.04, d, 0.012);
  B(c, f, mat ?? X.walnut, -w / 2 + 0.08, 0.12, -d / 2 + 0.08, w / 2 - 0.08, 0.14, d / 2 - 0.08, 'tfblr');
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy(c, f, mat ?? X.walnut, s * (w / 2 - 0.06), 0, t * (d / 2 - 0.06), 0.02, 0.025, 0.4, 6);
  for (let i = 0; i < 2; i++) Cu(c, f, pick(c, [M.red, M.blue, X.cream, M.white]), jit(c, 0.25), 0.443 + i * 0.004, jit(c, 0.1), 0.21, 0.004, 0.28, c.rnd() * 3);
  Cu(c, f, M.black, 0.3, 0.448, 0.12, 0.05, 0.015, 0.16, 0.3);
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, 0.44, SURF.wood);
}
/**
 * A bookshelf against a wall at (x, z) (its back on the wall line), facing `face`: shelves of books and binders, a
 * few ornaments. opts: w, h, d, mat, fill ('books' | 'binders' | 'mixed'), sparse (0..1 of each shelf left empty)
 */
export function bookshelf(c, x, z, face, { w = 0.9, h = 2.0, d = 0.34, mat = null, fill = 'mixed', sparse = 0.15 } = {}) {
  const { M, X, rnd } = c;
  const m = mat ?? pick(c, [X.oak, X.walnut, M.white]);
  const f = fr(x, z, face);
  for (const s of [-1, 1]) B(c, f, m, s * (w / 2) - (s > 0 ? 0.02 : 0), 0, 0, s * (w / 2) + (s > 0 ? 0 : 0.02), h, d, 'flrt');
  B(c, f, m, -w / 2, h - 0.02, 0, w / 2, h, d, 'ftd');
  B(c, f, m, -w / 2 + 0.02, 0, 0, w / 2 - 0.02, 0.08, d, 'ft');
  B(c, f, m, -w / 2 + 0.02, 0.08, 0.005, w / 2 - 0.02, h - 0.02, 0.012, 'f');
  const n = Math.max(2, Math.round((h - 0.1) / 0.36));
  const gap = (h - 0.1) / n;
  const cols = [M.red, M.blue, M.green, X.navy, X.kraft, M.black, X.cream, X.wool, M.dark, X.olive];
  for (let i = 0; i < n; i++) {
    const y = 0.08 + i * gap;
    if (i > 0) B(c, f, m, -w / 2 + 0.02, y - 0.02, 0.012, w / 2 - 0.02, y, d, 'ftd');
    let a = -w / 2 + 0.03;
    const end = w / 2 - 0.03;
    const kind = fill === 'mixed' ? (rnd() < 0.3 ? 'binders' : 'books') : fill;
    while (a < end - 0.03) {
      if (rnd() < sparse * 0.25) {
        a += 0.08 + rnd() * 0.15;
        continue;
      }
      if (kind === 'binders') {
        const bw = 0.06, bh = Math.min(gap - 0.05, 0.31);
        if (a + bw > end) break;
        const mat2 = pick(c, [M.blue, M.red, M.black, X.navy, M.green]);
        B(c, f, mat2, a, y, 0.04, a + bw - 0.004, y + bh, d - 0.02, 'ftl');
        B(c, f, X.paper, a + 0.012, y + bh * 0.6, d - 0.02, a + bw - 0.016, y + bh * 0.8, d - 0.018, 'f');
        a += bw;
      } else {
        const bw = 0.02 + rnd() * 0.035, bh = Math.min(gap - 0.05, 0.17 + rnd() * 0.12), bd = 0.15 + rnd() * 0.08;
        if (a + bw > end) break;
        const mat2 = pick(c, cols);
        if (rnd() < 0.06 && a + 0.2 < end) {
          // a book leaning over
          A(c, f, mat2, boxG(bw, bh, bd), a + bh * 0.35, y + bh * 0.45, d - bd / 2 - 0.01, 0, 0, -0.7);
          a += bh * 0.75;
        } else {
          B(c, f, mat2, a, y, d - bd - 0.01, a + bw, y + bh, d - 0.01, 'ftr');
          a += bw + (rnd() < 0.1 ? 0.01 : 0.002);
        }
      }
    }
    if (rnd() < 0.2 && i > 0) photo(c, f, w / 2 - 0.12, y, d - 0.12, -0.3);
  }
  col(c, f, -w / 2, 0, w / 2, d, 0, h, SURF.wood);
}
/** a cork notice board on the wall at (x, z) facing `face`: pinned pages (pages: an array of line arrays for the readable ones) */
export function noticeBoard(c, x, z, face, { y = 1.45, w = 1.2, h = 0.85, pages = null, frame = null } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, frame ?? X.alu, -w / 2, y - h / 2, 0, w / 2, y + h / 2, 0.022, 'flrtd');
  B(c, f, X.cork, -w / 2 + 0.025, y - h / 2 + 0.025, 0.022, w / 2 - 0.025, y + h / 2 - 0.025, 0.024, 'f');
  const texts = pages ?? [];
  const n = Math.max(texts.length + 2, Math.round(w * 4));
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + 0.16 + ((w - 0.32) * (i + 0.5)) / n + jit(c, 0.05);
    const py = y + (i % 2 ? -0.16 : 0.14) + jit(c, 0.05);
    const pw = 0.21 * (0.8 + rnd() * 0.3), ph = pw * 1.3;
    const rz = jit(c, 0.08);
    A(c, f, rnd() < 0.2 ? M.yellow : X.paper, boxG(pw, ph, 0.002), a, py, 0.026, 0, 0, rz);
    Cu(c, f, pick(c, [M.red, M.blue, M.green, M.yellow]), a, py + ph / 2 - 0.025, 0.03, 0.012, 0.012, 0.008);
    if (texts[i]) Ln(c, f, texts[i], a, py, 0.0275, pw - 0.02, ph - 0.03, { bg: '#f7f5ee', fg: '#222222', font: 'bold 26px Arial' });
  }
}
/** a wall clock at (x, y, z) on the wall facing `face` */
export function wallClock(c, x, y, z, face, { r = 0.17 } = {}) {
  const f = fr(x, z, face);
  Cb(c, f, c.X.charcoal, 0, y, 0.025, r + 0.015, 0.05, 20);
  const k = 64 / 60;
  S(c, f, SIGN.clock, 0, y, 0.051, 2 * r * k, 2 * r * k);
}
/** a round waste bin at (x, z) (tipped: on its side, its paper spilled) */
export function trashCan(c, x, z, { r = 0.16, h = 0.36, tipped = false, mat = null } = {}) {
  const { X, M, rnd } = c;
  const m = mat ?? pick(c, [X.charcoal, M.grey, X.pale]);
  const prof = latheG(`bin${r3(r)}${r3(h)}`, [[0, 0], [r * 0.82, 0], [r, h], [r * 0.96, h]], 12);
  if (tipped) {
    const a = rnd() * 6;
    c.K.add(m, prof, x, r * 0.9, z, [PI / 2 - 0.08, a, 0, 'YXZ']);
    for (let i = 0; i < 5; i++) c.K.add(X.paper, blobG(), x + Math.sin(a) * (h + rnd() * 0.6) + jit(c, 0.3), 0.035, z + Math.cos(a) * (h + rnd() * 0.6) + jit(c, 0.3), [rnd(), rnd(), rnd()], [0.04, 0.035, 0.04]);
    return;
  }
  c.K.add(m, prof, x, 0, z);
  c.K.add(M.black, torG(r * 0.97, 0.008, 3, 12), x, h, z, [PI / 2, 0, 0]);
  for (let i = 0; i < 3; i++) c.K.add(X.paper, blobG(), x + jit(c, r * 0.5), h - 0.04 + rnd() * 0.04, z + jit(c, r * 0.5), [rnd(), rnd(), rnd()], [0.04, 0.035, 0.04]);
  c.col(x - r, 0, z - r, x + r, h, z + r, SURF.metal);
}
/** a row of recycling bins with coloured lids at (x, z) facing `face` */
export function recycleBin(c, x, z, face, { kinds = ['PAPER', 'PLASTIC', 'GENERAL'] } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const lids = { PAPER: M.blue, PLASTIC: M.yellow, GENERAL: X.charcoal, GLASS: M.green, CANS: M.red };
  const n = kinds.length, w = 0.34;
  kinds.forEach((k, i) => {
    const a = (i - (n - 1) / 2) * (w + 0.02);
    R(c, f, M.grey, a, 0.33, 0, w, 0.66, 0.42, 0.02);
    R(c, f, lids[k] ?? M.blue, a, 0.68, 0, w + 0.01, 0.04, 0.43, 0.012);
    B(c, f, M.black, a - 0.1, 0.66, 0.2, a + 0.1, 0.7, 0.216, 'ft');
    L(c, f, k, a, 0.5, 0.212, w - 0.06, 0.08, { bg: '#f2f2f2', fg: '#222222', font: 'bold 40px Arial' });
  });
  col(c, f, -(n * (w + 0.02)) / 2, -0.21, (n * (w + 0.02)) / 2, 0.21, 0, 0.7, SURF.metal);
}
/** a coat hanging from a hook point (x, y, z), turned `yaw`: shoulders, the body, sleeves (long: a lab coat) */
export function coat(c, x, y, z, yaw, mat = null, { long = false } = {}) {
  const { X } = c;
  const m = mat ?? pick(c, [X.navy, X.charcoal, X.olive, X.kraft, X.denim, X.wool]);
  const g = grp(c, x, y, z, yaw, jit(c, 0.05), jit(c, 0.05));
  const L0 = long ? 1.0 : 0.78;
  g(m, boxG(0.4, 0.08, 0.15), 0, -0.07, 0);
  g(m, rbox(0.44, L0, 0.12, 0.04), 0, -0.1 - L0 / 2, 0.005, 0.02);
  for (const s of [-1, 1]) g(m, boxG(0.1, L0 * 0.7, 0.1), s * 0.2, -0.12 - L0 * 0.35, 0.01, 0.03, 0, s * 0.06);
  g(X.charcoal, boxG(0.03, 0.05, 0.03), 0, -0.02, 0);
}
/** a coat stand at (x, z): a pole on a round base, hooks, `coats` coats hanging on it */
export function coatRack(c, x, z, { coats = 2 } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, 0);
  Cy(c, f, X.charcoal, 0, 0, 0, 0.22, 0.2, 0.03, 16);
  Cy(c, f, X.walnut, 0, 0.03, 0, 0.022, 0.018, 1.72, 8);
  A(c, f, X.walnut, sphG(0.035, 8, 6), 0, 1.77, 0);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * PI * 2;
    c.K.rod(X.charcoal, V(x, 1.62, z), V(x + Math.sin(a) * 0.14, 1.7, z + Math.cos(a) * 0.14), 0.008, 4);
  }
  for (let i = 0; i < coats; i++) {
    const a = (i / Math.max(1, coats)) * PI * 2 + rnd();
    coat(c, x + Math.sin(a) * 0.12, 1.68, z + Math.cos(a) * 0.12, a, null, { long: rnd() < 0.3 });
  }
  c.col(x - 0.22, 0, z - 0.22, x + 0.22, 1.8, z + 0.22, SURF.wood);
}
/**
 * A potted plant at (x, z) (on a surface at y): 'leafy' (a peace lily / rubber plant), 'tall' (a ficus on a trunk),
 * 'palm'; dead: brown, drooping, leaves on the floor. size scales it.
 */
export function plantPot(c, x, z, { size = 1, dead = false, y = 0, kind = 'leafy', pot = null } = {}) {
  const { K, X, M, rnd } = c;
  const s = size;
  const pm = pot ?? pick(c, [X.terracotta, X.charcoal, M.white, X.pale]);
  const ph = 0.36 * s, pr = 0.19 * s;
  K.add(pm, latheG(`pot${r3(s)}`, [[0, 0], [pr * 0.74, 0], [pr * 0.95, ph * 0.94], [pr, ph], [pr * 0.93, ph]], 12), x, y, z);
  K.cyl(X.soil, x, y + ph * 0.86, z, pr * 0.92, pr * 0.92, 0.01, 10);
  const lm = dead ? X.leafDead : X.leaf;
  const top = y + ph * 0.87;
  const leaf = (px, py, pz, yaw, elev, len, wd = 0.055) => {
    const ce = Math.cos(elev);
    K.add(lm, octG(), px + Math.sin(yaw) * ce * len / 2, py + Math.sin(elev) * len / 2, pz + Math.cos(yaw) * ce * len / 2, [-elev, yaw, 0, 'YXZ'], [wd * s, 0.008, len / 2]);
  };
  if (kind === 'tall') {
    const H = 1.35 * s;
    K.rod(X.walnut, V(x, top, z), V(x + 0.03, y + H, z - 0.02), 0.025 * s, 6);
    const blobs = dead ? 3 : 6;
    for (let i = 0; i < blobs; i++) {
      const a = i * 2.4, rr = 0.12 + rnd() * 0.12;
      const bx = x + Math.sin(a) * rr, bz = z + Math.cos(a) * rr, by = y + H - 0.25 + rnd() * 0.35;
      K.rod(X.walnut, V(x + 0.02, y + H - 0.35, z), V(bx, by, bz), 0.01, 4);
      for (let k = 0; k < (dead ? 3 : 7); k++) leaf(bx, by, bz, rnd() * 6, dead ? -0.6 - rnd() * 0.6 : jit(c, 0.6), 0.16 * s, 0.045);
    }
  } else {
    const n = dead ? 7 : kind === 'palm' ? 9 : 13;
    for (let i = 0; i < n; i++) {
      const a = i * 2.39996, h0 = kind === 'palm' ? 0.35 * s : rnd() * 0.18 * s;
      const len = (kind === 'palm' ? 0.55 : 0.28 + rnd() * 0.18) * s;
      const elev = dead ? -0.2 - rnd() * 0.7 : kind === 'palm' ? 0.15 + rnd() * 0.35 : 0.5 + rnd() * 0.6;
      const sx = x + Math.sin(a) * 0.03, sz = z + Math.cos(a) * 0.03;
      if (h0 > 0.05) K.rod(dead ? X.leafDead : X.leaf, V(x, top, z), V(sx, top + h0, sz), 0.008 * s, 4);
      leaf(sx, top + h0, sz, a, elev, len, kind === 'palm' ? 0.08 : 0.06);
    }
  }
  if (dead) for (let i = 0; i < 4; i++) leaf(x + jit(c, 0.5), y ? y + 0.005 : 0.005, z + jit(c, 0.5), rnd() * 6, 0, 0.14 * s, 0.05);
  if (!y && s >= 0.8) c.col(x - pr, 0, z - pr, x + pr, kind === 'tall' ? 1.2 * s : 0.7 * s, z + pr, SURF.wood);
}
/** a flat TV on a wall bracket at (x, y, z) facing `face`: a lab screen, or text (lines: an emergency broadcast, a news crawl) */
export function tvOnWall(c, x, y, z, face, { w = 1.1, on = true, lines = null, bg = '#0b2a66', fg = '#ffffff' } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  const h = w * 0.58;
  B(c, f, X.charcoal, -0.15, y - 0.12, 0, 0.15, y + 0.12, 0.02, 'flrtd');
  B(c, f, M.dark, -0.03, y - 0.03, 0.02, 0.03, y + 0.03, 0.09, 'lrtd');
  R(c, f, M.black, 0, y, 0.112, w, h, 0.045, 0.008);
  if (lines) Ln(c, f, lines, 0, y, 0.1355, w - 0.05, h - 0.05, { bg, fg, font: 'bold 40px Arial' });
  else scr(c, f, 0, y, 0.1355, w - 0.05, h - 0.05, on);
  Cu(c, f, on || lines ? U.ledB : U.ledR, w / 2 - 0.06, y - h / 2 + 0.012, 0.135, 0.012, 0.006, 0.002);
}
/** a pull-down projection screen on the wall at (x, z) facing `face`, its case at `top`, down `drop` */
export function projectorScreen(c, x, z, face, { w = 2.4, top = 2.85, drop = 1.7 } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  Ca(c, f, X.pale, 0, top, 0.08, 0.065, w + 0.16, 12);
  for (const s of [-1, 1]) B(c, f, X.charcoal, s * (w / 2 + 0.08) - 0.03, top - 0.07, 0, s * (w / 2 + 0.08) + 0.03, top + 0.07, 0.15, 'flrtd');
  B(c, f, M.black, -w / 2, top - 0.3, 0.07, w / 2, top - 0.06, 0.074, 'f');
  B(c, f, M.white, -w / 2, top - drop, 0.07, w / 2, top - 0.3, 0.074, 'f');
  for (const s of [-1, 1]) B(c, f, M.black, s * w / 2 - (s > 0 ? 0.05 : 0), top - drop, 0.074, s * w / 2 + (s < 0 ? 0.05 : 0), top - 0.3, 0.075, 'f');
  Ca(c, f, X.alu, 0, top - drop - 0.01, 0.075, 0.014, w + 0.02, 8);
  c.K.rod(M.black, V(...atY(f, 0.3, top - drop - 0.02, 0.075)), V(...atY(f, 0.3, top - drop - 0.45, 0.078)), 0.003, 3);
  A(c, f, M.black, torG(0.02, 0.004, 3, 8), 0.3, top - drop - 0.47, 0.078);
}
/** a projector at (x, y, z) (y: its underside) aimed toward `face`; ceiling: the ceiling height it hangs from (null: on a table) */
export function projector(c, x, y, z, face, { ceiling = null, on = false } = {}) {
  const { X, M, G, U } = c;
  const f = fr(x, z, face);
  R(c, f, X.pale, 0, y + 0.06, 0, 0.32, 0.11, 0.26, 0.02);
  Cb(c, f, M.black, 0.08, y + 0.06, 0.14, 0.042, 0.04, 14);
  Cb(c, f, on ? G?.fridge ?? U.ledB : M.dark, 0.08, y + 0.06, 0.161, 0.03, 0.004, 12);
  for (let i = 0; i < 4; i++) B(c, f, X.charcoal, -0.14, y + 0.03, -0.1 + i * 0.05, -0.06, y + 0.09, -0.08 + i * 0.05, 't');
  Cu(c, f, U.ledG, -0.1, y + 0.117, 0.1, 0.01, 0.004, 0.01);
  if (ceiling) {
    Cy(c, f, X.charcoal, 0, y + 0.115, 0, 0.018, 0.018, ceiling - y - 0.13, 8);
    Cy(c, f, X.charcoal, 0, ceiling - 0.02, 0, 0.07, 0.07, 0.02, 10);
    c.K.rod(M.black, V(...atY(f, -0.12, y + 0.06, -0.13)), V(...atY(f, -0.05, ceiling - 0.05, -0.05)), 0.006, 4);
  }
}
/** a whiteboard on the wall at (x, z) facing `face` with writing (lines) and a marker tray */
export function whiteboardPlan(c, x, z, face, { w = 1.8, lines = null, fg = '#1c3f8f', font = 'bold 34px "Comic Sans MS", Arial' } = {}) {
  const { X, M } = c;
  P.whiteboard(c, x, z, face, w);
  const f = fr(x, z, face);
  if (lines) Ln(c, f, lines, 0, 1.52, 0.037, w - 0.14, 0.9, { bg: '#f4f6f7', fg, font, align: 'left' });
  B(c, f, X.alu, -w / 2 + 0.15, 0.96, 0.03, w / 2 - 0.15, 0.975, 0.09, 'ftd');
  [M.red, M.blue, M.black].forEach((m, i) => Ca(c, f, m, -0.3 + i * 0.16, 0.99, 0.06, 0.009, 0.13, 6));
  Cu(c, f, X.charcoal, 0.3, 0.995, 0.06, 0.13, 0.035, 0.05);
}
/** a wall phone at (x, y, z) facing `face`: the handset on its hook, a coiled cord, a number on a sticker */
export function wallPhone(c, x, y, z, face, { number = 'EMERGENCY  5555', off = false } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.beige, 0, y, 0.03, 0.14, 0.22, 0.06, 0.012);
  B(c, f, X.charcoal, -0.035, y - 0.06, 0.06, 0.035, y + 0.02, 0.062, 'f');
  if (off) {
    // the handset left dangling on its cord
    A(c, f, X.beige, rbox(0.05, 0.2, 0.045, 0.018), 0.12, y - 0.62, 0.1, 0.2, 0, 0.3);
    c.K.rod(M.black, V(...atY(f, 0.07, y - 0.09, 0.05)), V(...atY(f, 0.12, y - 0.52, 0.1)), 0.006, 3);
  } else {
    A(c, f, X.beige, rbox(0.05, 0.2, 0.045, 0.018), 0.1, y + 0.01, 0.05);
    c.K.rod(M.black, V(...atY(f, 0.1, y - 0.09, 0.05)), V(...atY(f, 0.06, y - 0.3, 0.07)), 0.006, 3);
    c.K.rod(M.black, V(...atY(f, 0.06, y - 0.3, 0.07)), V(...atY(f, 0.02, y - 0.1, 0.06)), 0.006, 3);
  }
  if (number) L(c, f, number, 0, y + 0.17, 0.001, 0.26, 0.06, { bg: '#b3141a', fg: '#ffffff', font: 'bold 34px Arial' });
}
/**
 * A glass-walled office on the rect's open sides: aluminium rails and posts, glass panes, a frosted band, blinds half
 * down. sides: the rect's sides that are glass ('n' z0, 's' z1, 'w' x0, 'e' x1); door: [side, u0, u1] the doorway;
 * smash: [side, u0, u1] a pane shot out. H: the partition's height.
 */
export function glassOffice(c, [x0, z0, x1, z1], { sides = 'ws', door = null, smash = null, H = 2.3, blinds = true, name = null } = {}) {
  const { K, X, M, U } = c;
  const t = 0.05;
  for (const side of sides) {
    const alongX = side === 'n' || side === 's';
    const fixed = side === 'n' ? z0 : side === 's' ? z1 : side === 'w' ? x0 : x1;
    const u0 = alongX ? x0 : z0, u1 = alongX ? x1 : z1;
    const box = (m, a0, y0, a1, y1, th = t) => (alongX ? K.box(m, a0, y0, fixed - th / 2, a1, y1, fixed + th / 2) : K.box(m, fixed - th / 2, y0, a0, fixed + th / 2, y1, a1));
    const colr = (a0, a1) => (alongX ? c.col(a0, 0, fixed - 0.05, a1, H, fixed + 0.05, SURF.glass) : c.col(fixed - 0.05, 0, a0, fixed + 0.05, H, a1, SURF.glass));
    // the spans between the doorway
    const spans = [];
    if (door && door[0] === side) spans.push([u0, door[1]], [door[2], u1]);
    else spans.push([u0, u1]);
    box(X.alu, u0, H - 0.08, u1, H, 0.08);
    for (const [a0, a1] of spans) {
      if (a1 - a0 < 0.05) continue;
      box(X.alu, a0, 0, a1, 0.07, 0.07);
      const n = Math.max(1, Math.round((a1 - a0) / 1.1));
      for (let i = 0; i <= n; i++) {
        const u = a0 + ((a1 - a0) * i) / n;
        box(X.alu, Math.max(a0, u - 0.025), 0, Math.min(a1, u + 0.025), H, 0.07);
      }
      for (let i = 0; i < n; i++) {
        const p0 = a0 + ((a1 - a0) * i) / n + 0.025, p1 = a0 + ((a1 - a0) * (i + 1)) / n - 0.025;
        const shot = smash && smash[0] === side && smash[1] < p1 && smash[2] > p0;
        if (shot) {
          // jagged shards left in the frame, glass on the floor
          for (let k = 0; k < 6; k++) {
            const u = p0 + ((p1 - p0) * (k + 0.5)) / 6, hh = 0.1 + c.rnd() * 0.35;
            const [sx, sz] = alongX ? [u, fixed] : [fixed, u];
            K.add(U.glass, new THREE.ConeGeometry(0.07, hh, 3), sx, 0.07 + hh / 2, sz, [0, c.rnd() * 3, 0], [1, 1, 0.15]);
          }
          const [gx, gz] = alongX ? [(p0 + p1) / 2, fixed + (c.rnd() < 0.5 ? -0.6 : 0.6)] : [fixed + 0.6, (p0 + p1) / 2];
          c.decal?.('glass', gx, gz, 1.4, c.rnd() * 6);
          continue;
        }
        box(U.glass, p0, 0.07, p1, H - 0.08, 0.012);
        box(M.frost, p0, 1.2, p1, 1.32, 0.016);
        if (blinds && (i + side.charCodeAt(0)) % 3 !== 0) {
          const low = 1.5 + c.rnd() * 0.5;
          box(X.beige, p0 + 0.02, low, p1 - 0.02, H - 0.1, 0.03);
          for (let y = low + 0.06; y < H - 0.12; y += 0.09) box(X.charcoal, p0 + 0.02, y, p1 - 0.02, y + 0.006, 0.034);
        }
        colr(p0 - 0.025, p1 + 0.025);
      }
    }
    if (door && door[0] === side) {
      // the glass door hung open into the office
      const [a0, a1] = [door[1], door[2]];
      const w = a1 - a0 - 0.04;
      const hx = alongX ? a0 + 0.02 : fixed, hz = alongX ? fixed : a0 + 0.02;
      const yaw = (alongX ? 0 : -PI / 2) + (side === 's' || side === 'e' ? -1 : 1) * 1.25;
      const g = grp(c, hx, 0, hz, yaw);
      g(U.glass, boxG(w, H - 0.12, 0.012), w / 2, (H - 0.1) / 2 + 0.02, 0);
      g(X.alu, boxG(w, 0.06, 0.04), w / 2, 0.05, 0);
      g(X.alu, boxG(w, 0.05, 0.04), w / 2, H - 0.1, 0);
      g(X.chrome, cylG(0.012, 0.012, 0.9, 6), w - 0.08, 1.05, 0.04);
      if (name) {
        const [nx, nz] = alongX ? [a1 + 0.35, fixed] : [fixed, a1 + 0.35];
        const face = side === 'n' ? 'n' : side === 's' ? 's' : side === 'w' ? 'w' : 'e';
        c.label?.(name, nx + (face === 'e' ? 0.02 : face === 'w' ? -0.02 : 0), 1.5, nz + (face === 's' ? 0.02 : face === 'n' ? -0.02 : 0), face, 0.5, 0.12, { bg: '#e8ecef', fg: '#1b2127', font: 'bold 30px Arial' });
      }
    }
  }
}
/** a rug on the floor centred at (x, z), w along x and d along z; a border in a second material */
export function rug(c, x, z, w, d, { mat = null, border = null } = {}) {
  const { K, X } = c;
  const m = mat ?? pick(c, [X.wool, X.navy, X.fabricGreen]);
  K.box(border ?? X.cream, x - w / 2, 0, z - d / 2, x + w / 2, 0.01, z + d / 2, { faces: ['py', 'px', 'nx', 'pz', 'nz'] });
  K.box(m, x - w / 2 + 0.1, 0.01, z - d / 2 + 0.1, x + w / 2 - 0.1, 0.012, z + d / 2 - 0.1, { faces: ['py'] });
  K.box(border ?? X.cream, x - w / 2 + 0.2, 0.012, z - d / 2 + 0.2, x + w / 2 - 0.2, 0.013, z + d / 2 - 0.2, { faces: ['py'] });
  K.box(m, x - w / 2 + 0.23, 0.013, z - d / 2 + 0.23, x + w / 2 - 0.23, 0.014, z + d / 2 - 0.23, { faces: ['py'] });
}
/** a framed picture on the wall at (x, y, z) facing `face`: a diploma, a photo, a logo (lines: its text) */
export function framed(c, x, y, z, face, { w = 0.5, h = 0.38, lines = null, bg = '#f6f1e2', fg = '#2a2a2a', frame = null, font = 'bold 30px Georgia, serif' } = {}) {
  const { X } = c;
  const f = fr(x, z, face);
  B(c, f, frame ?? pick(c, [X.walnut, X.brass, c.M.black]), -w / 2 - 0.03, y - h / 2 - 0.03, 0, w / 2 + 0.03, y + h / 2 + 0.03, 0.025, 'flrtd');
  if (lines) Ln(c, f, lines, 0, y, 0.026, w, h, { bg, fg, font });
  else B(c, f, pick(c, [X.fabricBlue, X.cream, X.leaf, X.terracotta]), -w / 2, y - h / 2, 0.025, w / 2, y + h / 2, 0.026, 'f');
}
/** a drinks cabinet against the wall at (x, z) facing `face`: a walnut base, a mirrored back with glass shelves, bottles, glasses, an ice bucket */
export function bar(c, x, z, face, { w = 1.4 } = {}) {
  const { X, M, U, G, rnd } = c;
  const f = fr(x, z, face);
  const d = 0.5, T = 0.95;
  B(c, f, X.walnut, -w / 2, 0.06, 0, w / 2, T - 0.03, d, 'flrt');
  B(c, f, M.black, -w / 2 + 0.03, 0, 0, w / 2 - 0.03, 0.06, d - 0.03, 'f');
  for (const s of [-1, 1]) {
    B(c, f, X.walnut, s > 0 ? 0.01 : -w / 2 + 0.02, 0.1, d, s > 0 ? w / 2 - 0.02 : -0.01, T - 0.07, d + 0.015, 'f');
    B(c, f, X.brass, s * 0.06 - 0.008, 0.45, d + 0.015, s * 0.06 + 0.008, 0.62, d + 0.03, 'flrt');
  }
  B(c, f, X.walnut, -w / 2 - 0.02, T - 0.03, 0, w / 2 + 0.02, T, d + 0.03, 'flrtd');
  B(c, f, X.mirror, -w / 2 + 0.05, T, 0.005, w / 2 - 0.05, 2.05, 0.012, 'f');
  B(c, f, X.walnut, -w / 2, T, 0, -w / 2 + 0.05, 2.1, 0.25, 'flrt');
  B(c, f, X.walnut, w / 2 - 0.05, T, 0, w / 2, 2.1, 0.25, 'flrt');
  B(c, f, X.walnut, -w / 2, 2.05, 0, w / 2, 2.1, 0.25, 'fdt');
  B(c, f, G?.lamp ?? M.white, -w / 2 + 0.08, 2.04, 0.08, w / 2 - 0.08, 2.05, 0.12, 'd');
  for (const y of [1.35, 1.7]) B(c, f, U.glass, -w / 2 + 0.05, y, 0.012, w / 2 - 0.05, y + 0.012, 0.22, 'td');
  for (const y of [T, 1.362, 1.712]) {
    let a = -w / 2 + 0.14;
    while (a < w / 2 - 0.12) {
      if (y > T || rnd() < 0.4) bottle(c, ...atY(f, a, y, y > T ? 0.12 : 0.15), 0.035 + rnd() * 0.012, 0.22 + rnd() * 0.1, pick(c, [M.amber, M.amber, M.green, X.bottle, M.black]), pick(c, [M.black, X.brass, M.red]));
      a += 0.12 + rnd() * 0.1;
    }
  }
  for (let i = 0; i < 4; i++) A(c, f, U.glass, cylG(0.032, 0.036, 0.09, 8, true), -0.35 + i * 0.09, T + 0.045, d - 0.1);
  A(c, f, M.amber, cylG(0.03, 0.03, 0.03, 8), -0.26, T + 0.016, d - 0.1);
  A(c, f, X.chrome, latheG('icebucket', [[0, 0], [0.09, 0], [0.11, 0.2], [0.1, 0.2]], 12), 0.4, T, d - 0.2);
  A(c, f, U.glass, latheG('decanter', [[0, 0], [0.08, 0], [0.09, 0.08], [0.05, 0.2], [0.02, 0.24], [0.025, 0.26]], 12), 0.15, T, d - 0.12);
  col(c, f, -w / 2, 0, w / 2, d + 0.03, 0, T, SURF.wood);
  col(c, f, -w / 2, 0, w / 2, 0.25, T, 2.1, SURF.wood);
}
/** a safe built into the wall at (x, z) facing `face`, its bottom at y: `open` the door's swing (rad), cash and files inside */
export function wallSafe(c, x, y, z, face, { w = 0.55, h = 0.6, d = 0.34, open = 1.3 } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.gunmetal, -w / 2, y, 0, w / 2, y + h, d, 'flrtd');
  B(c, f, M.black, -w / 2 + 0.05, y + 0.05, 0.03, w / 2 - 0.05, y + h - 0.05, d + 0.001, 'f');
  B(c, f, X.gunmetal, -w / 2 + 0.05, y + h / 2 - 0.01, 0.05, w / 2 - 0.05, y + h / 2 + 0.01, d, 't');
  for (let i = 0; i < 3; i++) B(c, f, M.green, -0.18 + i * 0.1, y + 0.05, 0.12, -0.1 + i * 0.1, y + 0.08 + (i % 2) * 0.03, 0.2, 'ftlr');
  B(c, f, X.kraft, -0.05, y + h / 2 + 0.01, 0.06, 0.2, y + h / 2 + 0.05, 0.3, 'ft');
  // the door, hinged on its left edge, swung out
  const [hx, hz] = at(f, -w / 2 + 0.02, d + 0.02);
  const g = grp(c, hx, y, hz, f.yaw - open);
  g(X.gunmetal, boxG(w - 0.06, h - 0.06, 0.08), (w - 0.06) / 2, h / 2, 0.04);
  g(X.chrome, cylG(0.06, 0.06, 0.03, 16), (w - 0.06) / 2 + 0.08, h / 2 + 0.08, 0.095, PI / 2);
  g(M.black, boxG(0.02, 0.02, 0.01), (w - 0.06) / 2 + 0.08, h / 2 + 0.13, 0.11);
  for (let k = 0; k < 3; k++) g(X.chrome, cylG(0.008, 0.008, 0.1, 6), (w - 0.06) / 2 - 0.05 + Math.cos(k * 2.1) * 0.05, h / 2 - 0.08 + Math.sin(k * 2.1) * 0.05, 0.1, 0, 0, k * 2.1 + PI / 2);
  for (let k = 0; k < 3; k++) g(X.chrome, cylG(0.015, 0.015, 0.05, 8), w - 0.06, 0.12 + k * ((h - 0.24) / 2), 0.04, 0, 0, PI / 2);
  for (let i = 0; i < 4; i++) papers(c, ...atY(f, jit(c, 0.5), 0, d + 0.3 + rnd() * 0.5), rnd() * 6, 1);
}
/** a ball-and-stick molecule model on a walnut base at (x, y, z) */
export function moleculeModel(c, x, y, z, { yaw = 0 } = {}) {
  const { X, M } = c;
  const f = fr(x, z, yaw);
  R(c, f, X.walnut, 0, y + 0.02, 0, 0.26, 0.04, 0.26, 0.01);
  Cy(c, f, X.chrome, 0, y + 0.04, 0, 0.008, 0.008, 0.2, 6);
  // a six-ring with substituents (caffeine-ish), tilted on its stand
  const atoms = [];
  const cy0 = y + 0.36;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * PI * 2;
    atoms.push([Math.cos(a) * 0.1, Math.sin(a) * 0.1, k % 3 === 1 ? M.blue : M.black]);
  }
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * PI * 2;
    atoms.push([Math.cos(a) * 0.19, Math.sin(a) * 0.19, k % 2 ? M.red : k === 4 ? M.blue : X.pale]);
  }
  const pos = atoms.map(([u, v]) => atY(f, u, cy0 + v * 0.8, v * 0.6));
  atoms.forEach(([, , m], i) => c.K.add(m, sphG(i < 6 ? 0.03 : 0.024, 7, 4), ...pos[i]));
  for (let k = 0; k < 6; k++) {
    c.K.rod(X.chrome, V(...pos[k]), V(...pos[(k + 1) % 6]), 0.006, 5);
    c.K.rod(X.chrome, V(...pos[k]), V(...pos[k + 6]), 0.006, 5);
  }
  c.K.rod(X.chrome, V(...atY(f, 0, y + 0.24, 0)), V(...pos[4]), 0.007, 5);
}
/** a backlit city skyline on the wall at (x, z) facing `face` (a fake window for an office underground), centre height y */
export function skylineBox(c, x, z, face, { w = 2.6, h = 1.3, y = 1.55, caption = null } = {}) {
  const { X, M, G, U, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.charcoal, -w / 2 - 0.06, y - h / 2 - 0.06, 0, w / 2 + 0.06, y + h / 2 + 0.06, 0.08, 'lrtd');
  for (const [a0, a1, y0, y1] of [[-w / 2 - 0.06, w / 2 + 0.06, y + h / 2, y + h / 2 + 0.06], [-w / 2 - 0.06, w / 2 + 0.06, y - h / 2 - 0.06, y - h / 2], [-w / 2 - 0.06, -w / 2, y - h / 2, y + h / 2], [w / 2, w / 2 + 0.06, y - h / 2, y + h / 2]]) B(c, f, X.charcoal, a0, y0, 0.06, a1, y1, 0.09, 'f');
  B(c, f, G?.lightbox ?? U.amber, -w / 2, y - h / 2, 0.03, w / 2, y + h / 2, 0.031, 'f');
  B(c, f, X.navy, -w / 2, y + h * 0.18, 0.032, w / 2, y + h / 2, 0.033, 'f');
  let a = -w / 2;
  while (a < w / 2 - 0.02) {
    const bw = Math.min(w / 2 - a, 0.06 + rnd() * 0.16), bh = h * (0.12 + Math.pow(rnd(), 1.6) * 0.62);
    B(c, f, M.black, a, y - h / 2, 0.036, a + bw, y - h / 2 + bh, 0.04, 'f');
    if (bh > h * 0.5 && rnd() < 0.4) B(c, f, M.black, a + bw / 2 - 0.004, y - h / 2 + bh, 0.036, a + bw / 2 + 0.004, y - h / 2 + bh + 0.12, 0.04, 'f');
    for (let k = 0; k < Math.floor(bh / 0.1); k++) if (rnd() < 0.3) B(c, f, U.ledA, a + 0.015 + rnd() * (bw - 0.035), y - h / 2 + 0.05 + k * 0.1, 0.04, a + 0.025 + rnd() * (bw - 0.035), y - h / 2 + 0.065 + k * 0.1, 0.041, 'f');
    a += bw + (rnd() < 0.3 ? 0.03 : 0);
  }
  B(c, f, U.glass, -w / 2, y - h / 2, 0.08, w / 2, y + h / 2, 0.085, 'f');
  if (caption) L(c, f, caption, 0, y - h / 2 - 0.16, 0.002, 0.9, 0.08, { bg: '#1b2127', fg: '#d9c9a8', font: 'bold 30px Georgia, serif' });
  c.light(...atY(f, 0, y, 0.5), 0.35, 1.4, [1.0, 0.75, 0.5], null, 3.5);
}
/**
 * The executive desk centred at (x, z), its sitter's side toward `face`: a walnut top on two pedestals, a panelled
 * front, a leather pad, a banker's lamp, a nameplate, a laptop, a phone, a whisky glass. Its chair is separate.
 */
export function bigDesk(c, x, z, face, { w = 2.2, d = 1.0, name = null } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  const T = 0.76;
  R(c, f, X.walnut, 0, T - 0.025, 0, w, 0.05, d, 0.015);
  for (const s of [-1, 1]) {
    const a = s * (w / 2 - 0.28);
    B(c, f, X.walnut, a - 0.25, 0.03, -d / 2 + 0.05, a + 0.25, T - 0.05, d / 2 - 0.05, 'fblr');
    for (let i = 0; i < 3; i++) {
      const y0 = 0.07 + i * 0.21;
      B(c, f, X.walnut, a - 0.23, y0, d / 2 - 0.05, a + 0.23, y0 + 0.19, d / 2 - 0.035, 'ft');
      B(c, f, X.brass, a - 0.05, y0 + 0.12, d / 2 - 0.035, a + 0.05, y0 + 0.135, d / 2 - 0.02, 'ft');
    }
  }
  // the front (toward the visitors) panelled
  B(c, f, X.walnut, -w / 2 + 0.53, 0.2, -d / 2 + 0.05, w / 2 - 0.53, T - 0.05, -d / 2 + 0.08, 'bt');
  for (const s of [-1, 0, 1]) B(c, f, X.walnut, s * (w / 2 - 0.28) - 0.18, 0.18, -d / 2 + 0.04, s * (w / 2 - 0.28) + 0.18, T - 0.12, -d / 2 + 0.05, 'b');
  B(c, f, X.leather, -0.4, T, -0.05, 0.4, T + 0.005, 0.35, 'tflr');
  deskLamp(c, ...atY(f, -w / 2 + 0.25, T, -d / 2 + 0.25), f.yaw + PI, { light: true });
  laptop(c, f, 0.05, T + 0.005, 0.1, true, true);
  deskPhone(c, f, w / 2 - 0.3, T, -0.2);
  papers(c, ...atY(f, -0.55, T, 0.2), f.yaw + 0.3, 5);
  B(c, f, X.kraft, 0.45, T, 0.1, 0.72, T + 0.02, 0.45, 'tflr');
  photo(c, f, w / 2 - 0.2, T, -d / 2 + 0.2, -0.5);
  A(c, f, U.glass, cylG(0.035, 0.038, 0.09, 8, true), 0.55, T + 0.045, -0.2);
  A(c, f, M.amber, cylG(0.033, 0.033, 0.025, 8), 0.55, T + 0.013, -0.2);
  if (name) {
    A(c, f, X.walnut, boxG(0.34, 0.07, 0.05), 0, T + 0.035, -d / 2 + 0.08);
    const [nx, nz] = at(f, 0, -d / 2 + 0.054);
    c.label?.(name, nx, T + 0.035, nz, { s: 'n', n: 's', e: 'w', w: 'e' }[f.face], 0.3, 0.05, { bg: '#b8964e', fg: '#1a1208', font: 'bold 28px Georgia, serif' });
  }
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, T, SURF.wood);
}
/** a four-legged visitor's chair at (x, z), its sitter looking toward `yaw` */
export function guestChair(c, x, z, yaw, { mat = null, frame = null, down = false } = {}) {
  const { X } = c;
  const m = mat ?? pick(c, [X.leather, X.fabricRed, X.fabricBlue]);
  const fm = frame ?? X.chrome;
  const g = down ? grp(c, x, 0.24, z, yaw, -PI / 2, 0) : grp(c, x, 0, z, yaw);
  g(m, rbox(0.5, 0.08, 0.48, 0.03), 0, 0.46, 0);
  g(m, rbox(0.48, 0.42, 0.07, 0.03), 0, 0.78, -0.23, -0.1);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g(fm, cylG(0.014, 0.014, 0.44, 6), s * 0.21, 0.22, t * 0.2);
  for (const s of [-1, 1]) {
    g(fm, cylG(0.012, 0.012, 0.44, 6), s * 0.24, 0.64, -0.02, PI / 2);
    g(fm, cylG(0.012, 0.012, 0.2, 6), s * 0.24, 0.54, 0.2);
  }
}

// ---------------------------------------------------------------- the cafeteria and its kitchen
/** a stack of `n` canteen trays on a surface at y */
export function trayStack(c, x, y, z, n = 8, yaw = 0) {
  for (let i = 0; i < n; i++) c.K.add(c.M.tray, rbox(0.44, 0.02, 0.32, 0.008), x + jit(c, 0.008), y + 0.012 + i * 0.021, z + jit(c, 0.008), [0, yaw + jit(c, 0.03), 0]);
}
/** a plate of food at (x, y, z) (on a tray or a table) */
function plate(c, x, y, z) {
  const { K, X, M } = c;
  K.add(M.white, cylG(0.1, 0.11, 0.018, 12), x, y + 0.009, z);
  const food = pick(c, [X.food, X.foodGreen, X.foodPale]);
  K.add(food, blobG(), x + jit(c, 0.03), y + 0.025, z + jit(c, 0.03), [c.rnd(), c.rnd(), 0], [0.06, 0.02, 0.05]);
  if (c.rnd() < 0.6) K.add(pick(c, [X.food, X.foodGreen, X.foodPale]), blobG(), x + jit(c, 0.04), y + 0.022, z + jit(c, 0.04), [c.rnd(), 0, 0], [0.04, 0.015, 0.035]);
}
/** a tray with a meal on it, at (x, y, z) */
export function mealTray(c, x, y, z, yaw = 0) {
  const { K, M, X } = c;
  K.add(M.tray, rbox(0.44, 0.02, 0.32, 0.008), x, y + 0.01, z, [0, yaw, 0]);
  const f = fr(x, z, yaw);
  plate(c, ...atY(f, -0.08, y + 0.02, 0));
  if (c.rnd() < 0.7) A(c, f, pick(c, [X.bottle, M.white, M.red]), cylG(0.032, 0.035, 0.11, 8), 0.14, y + 0.075, -0.07);
  A(c, f, X.chrome, boxG(0.012, 0.004, 0.17), 0.12, y + 0.022, 0.06, 0, 0.1);
}
/**
 * The serving counter over x0..x1 at depth z0..z1, its customers' side toward `face` ('n' | 's'): stainless, a tray
 * slide, bain-marie wells with food, a sneeze guard and a heat-lamp gantry over them. clear: metres at the x0 end
 * kept bare (the top only: a pickup lies there).
 */
export function servingCounter(c, x0, z0, x1, z1, face = 'n', { clear = 0.8, T = 0.95 } = {}) {
  const { K, M, X, G, U } = c;
  const f = fr((x0 + x1) / 2, (z0 + z1) / 2, face);
  const w = x1 - x0, d = z1 - z0;
  // (local a runs along the counter: for face 'n' +a is -x, so the clear end x0 is at a = +w/2)
  const sgn = face === 'n' ? -1 : 1;
  const aClear = sgn * (-w / 2);
  B(c, f, X.stainless, -w / 2, 0.12, -d / 2, w / 2, T - 0.04, d / 2, 'fblr');
  B(c, f, M.black, -w / 2 + 0.03, 0, -d / 2 + 0.05, w / 2 - 0.03, 0.12, d / 2 - 0.05, 'fb');
  for (let i = 0; i < Math.round(w / 0.8); i++) {
    const a = -w / 2 + ((i + 0.5) * w) / Math.round(w / 0.8);
    B(c, f, M.steel, a - 0.35, 0.2, d / 2, a + 0.35, T - 0.12, d / 2 + 0.005, 'f');
  }
  B(c, f, X.stainless, -w / 2, T - 0.04, -d / 2, w / 2, T, d / 2 + 0.02, 'flrtbd');
  // the tray slide on brackets
  for (const k of [0, 1, 2]) Ca(c, f, X.chrome, 0, T - 0.1, d / 2 + 0.12 + k * 0.07, 0.013, w, 8);
  for (let i = 0; i <= Math.round(w / 1.2); i++) {
    const a = -w / 2 + 0.05 + ((w - 0.1) * i) / Math.round(w / 1.2);
    B(c, f, X.chrome, a - 0.015, T - 0.25, d / 2, a + 0.015, T - 0.09, d / 2 + 0.28, 'lrt');
  }
  // the wells: pans of food in a dark well, away from the clear end
  const wa0 = Math.min(aClear, -aClear) + (sgn > 0 ? clear + 0.1 : 0.25), wa1 = Math.max(aClear, -aClear) - (sgn > 0 ? 0.25 : clear + 0.1);
  B(c, f, M.dark, wa0, T, -d / 2 + 0.12, wa1, T + 0.003, d / 2 - 0.12, 't');
  const np = Math.floor((wa1 - wa0) / 0.36);
  for (let i = 0; i < np; i++) {
    const a = wa0 + 0.03 + i * 0.36;
    for (const b of [-0.13, 0.13]) {
      B(c, f, X.stainless, a, T, b - 0.13, a + 0.32, T + 0.012, b + 0.13, 't');
      B(c, f, pick(c, [X.food, X.foodGreen, X.foodPale, M.card, X.food]), a + 0.02, T + 0.012, b - 0.11, a + 0.3, T + 0.018 + c.rnd() * 0.02, b + 0.11, 't');
    }
    if (c.rnd() < 0.5) A(c, f, X.stainless, cylG(0.02, 0.02, 0.28, 6), a + 0.16, T + 0.08, 0.05, 0.9, c.rnd());
  }
  // the sneeze guard and the heat-lamp gantry over the wells
  for (const a of [wa0, (wa0 + wa1) / 2, wa1]) {
    B(c, f, X.chrome, a - 0.015, T, d / 2 - 0.06, a + 0.015, T + 0.62, d / 2 - 0.03, 'fblr');
    B(c, f, X.chrome, a - 0.015, T, -d / 2 + 0.05, a + 0.015, T + 0.62, -d / 2 + 0.08, 'fblr');
  }
  A(c, f, U.glass, boxG(wa1 - wa0, 0.36, 0.008), (wa0 + wa1) / 2, T + 0.42, d / 2 + 0.04, -0.45);
  B(c, f, X.stainless, wa0 - 0.02, T + 0.6, -d / 2 + 0.03, wa1 + 0.02, T + 0.68, d / 2 - 0.02, 'fblrtd');
  const nl = Math.max(1, Math.round((wa1 - wa0) / 0.7));
  for (let i = 0; i < nl; i++) {
    const a = wa0 + ((i + 0.5) * (wa1 - wa0)) / nl;
    Cy(c, f, X.stainless, a, T + 0.54, 0, 0.08, 0.05, 0.07, 10);
    Cy(c, f, G?.heat ?? U.amber, a, T + 0.535, 0, 0.065, 0.065, 0.006, 10);
  }
  c.light(...atY(f, (wa0 + wa1) / 2, T + 0.4, 0), 0.4, 1.3, [1.0, 0.55, 0.25], DOWN, 3);
  col(c, f, -w / 2, -d / 2, w / 2, d / 2 + 0.3, 0, T, SURF.metal);
}
/** a juice / soda dispenser on a counter at y facing `face`: three lit panels, nozzles, a drip tray */
export function drinkDispenser(c, x, y, z, face, { names = ['COLA', 'ORANGE', 'WATER'] } = {}) {
  const { X, M, G, U } = c;
  const f = fr(x, z, face);
  const w = 0.2 * names.length + 0.1;
  R(c, f, X.stainless, 0, y + 0.35, -0.05, w, 0.7, 0.5, 0.02);
  B(c, f, X.stainless, -w / 2 + 0.03, y, 0.06, w / 2 - 0.03, y + 0.03, 0.3, 'ft');
  B(c, f, M.dark, -w / 2 + 0.05, y + 0.03, 0.1, w / 2 - 0.05, y + 0.032, 0.28, 't');
  names.forEach((n, i) => {
    const a = -w / 2 + 0.15 + i * 0.2;
    B(c, f, G?.display ?? U.ledB, a - 0.08, y + 0.44, 0.2, a + 0.08, y + 0.64, 0.201, 'f');
    L(c, f, n, a, y + 0.54, 0.203, 0.15, 0.06, { bg: '#0d2436', fg: '#ffffff', font: 'bold 34px Arial' });
    Cb(c, f, M.black, a, y + 0.33, 0.24, 0.02, 0.08, 8);
    B(c, f, X.charcoal, a - 0.03, y + 0.3, 0.19, a + 0.03, y + 0.4, 0.23, 'flrt');
  });
}
/** a stacking chair (a plastic shell on steel legs) at (x, z), its sitter looking toward `yaw` */
export function stackChair(c, x, z, yaw, { down = false, mat = null } = {}) {
  const { X, M } = c;
  const m = mat ?? pick(c, [X.orange, M.blue, X.charcoal, M.green]);
  const g = down ? grp(c, x, 0.24, z, yaw, PI / 2 - 0.05, jit(c, 0.4)) : grp(c, x, 0, z, yaw);
  g(m, rbox(0.44, 0.03, 0.42, 0.012), 0, 0.45, 0.01);
  g(m, rbox(0.42, 0.34, 0.03, 0.012), 0, 0.7, -0.21, -0.12);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g(X.chrome, cylG(0.011, 0.011, 0.45, 5), s * 0.19, 0.22, t * 0.18, t * 0.06, 0, -s * 0.05);
  g(X.chrome, cylG(0.01, 0.01, 0.3, 5), -0.19, 0.58, -0.2, -0.12);
  g(X.chrome, cylG(0.01, 0.01, 0.3, 5), 0.19, 0.58, -0.2, -0.12);
}
/** a stack of `n` stacking chairs at (x, z) */
export function chairStack(c, x, z, yaw = 0, n = 6, mat = null) {
  const { X } = c;
  const m = mat ?? X.orange;
  const f = fr(x, z, yaw);
  for (let i = 0; i < n; i++) {
    A(c, f, m, rbox(0.44, 0.03, 0.42, 0.012), 0, 0.45 + i * 0.085, 0.01 + i * 0.012);
    A(c, f, m, rbox(0.42, 0.34, 0.03, 0.012), 0, 0.7 + i * 0.085, -0.21 + i * 0.012, -0.12);
  }
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy(c, f, X.chrome, s * 0.19, 0, t * 0.18, 0.011, 0.011, 0.45 + (n - 1) * 0.085, 5);
  col(c, f, -0.24, -0.24, 0.24, 0.26, 0, 0.8 + n * 0.085, SURF.metal);
}
/** a round cafeteria table at (x, z) with `chairs` stacking chairs round it (some pushed back, one knocked over) */
export function roundTable(c, x, z, { r = 0.45, chairs = 4, messy = true, mat = null, spin = 0 } = {}) {
  const { K, X, M, rnd } = c;
  K.add(mat ?? pick(c, [M.white, X.laminate]), cylG(r, r, 0.03, 18), x, 0.735, z);
  K.add(X.charcoal, torG(r, 0.012, 3, 18), x, 0.735, z, [PI / 2, 0, 0]);
  K.cyl(X.chrome, x, 0.03, z, 0.035, 0.035, 0.7, 8);
  K.cyl(X.charcoal, x, 0, z, 0.26, 0.24, 0.04, 12);
  const chm = pick(c, [X.orange, M.blue, X.charcoal]);
  for (let i = 0; i < chairs; i++) {
    const a = spin + (i / chairs) * PI * 2 + jit(c, 0.25);
    const dd = r + 0.22 + rnd() * 0.25;
    stackChair(c, x + Math.sin(a) * dd, z + Math.cos(a) * dd, a + PI + jit(c, 0.4), { down: rnd() < 0.15, mat: chm });
  }
  if (messy) {
    for (let i = 0; i < 2; i++) {
      const a = rnd() * 6, dd = rnd() * (r - 0.2);
      if (rnd() < 0.6) mealTray(c, x + Math.sin(a) * dd, 0.75, z + Math.cos(a) * dd, rnd() * 6);
      else mug(c, x + Math.sin(a) * dd, 0.75, z + Math.cos(a) * dd);
    }
  }
  c.col(x - r, 0, z - r, x + r, 0.75, z + r, SURF.wood);
}
/** a long table knocked onto its side at (x, z), its top toward `face` (cover, a barricade) */
export function tippedTable(c, x, z, face, { w = 2.4, d = 0.8, mat = null } = {}) {
  const { M, X } = c;
  const f = fr(x, z, face);
  B(c, f, mat ?? M.white, -w / 2, 0, -0.02, w / 2, d, 0.02, 'fblrt');
  for (const s of [-1, 1]) {
    B(c, f, X.chrome, s * (w / 2 - 0.25) - 0.02, d / 2 - 0.3, -0.72, s * (w / 2 - 0.25) + 0.02, d / 2 + 0.3, -0.02, 'lrt');
    B(c, f, X.chrome, s * (w / 2 - 0.25) - 0.02, d / 2 - 0.02, -0.7, s * (w / 2 - 0.25) + 0.02, d / 2 + 0.02, -0.02, 'lrtd');
  }
  col(c, f, -w / 2, -0.72, w / 2, 0.03, 0, d, SURF.wood);
}
/** a menu board on the wall at (x, y, z) facing `face`: a black frame, chalk lines (lines: the menu) */
export function menuBoard(c, x, y, z, face, { w = 2.2, h = 0.9, lines = [] } = {}) {
  const f = fr(x, z, face);
  B(c, f, c.X.walnut, -w / 2 - 0.04, y - h / 2 - 0.04, 0, w / 2 + 0.04, y + h / 2 + 0.04, 0.03, 'flrtd');
  Ln(c, f, lines, 0, y, 0.031, w, h, { bg: '#1d2620', fg: '#f3efe0', font: 'bold 34px "Comic Sans MS", Arial', align: 'left' });
}
/** a tray-return trolley at (x, z) facing `face`: slots of dirty trays, a bin for the scraps */
export function trayReturn(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  for (const s of [-1, 1]) for (const t of [-1, 1]) Cy(c, f, X.chrome, s * 0.3, 0.08, t * 0.22, 0.012, 0.012, 1.55, 6);
  for (const s of [-1, 1]) for (const t of [-1, 1]) A(c, f, X.rubber, cylG(0.04, 0.04, 0.03, 8), s * 0.3, 0.04, t * 0.22, 0, 0, PI / 2);
  for (let i = 0; i < 8; i++) {
    const y = 0.2 + i * 0.17;
    for (const s of [-1, 1]) B(c, f, X.chrome, s * 0.3 - 0.012, y, -0.24, s * 0.3 + 0.012, y + 0.012, 0.24, 't');
    if (c.rnd() < 0.7) {
      B(c, f, M.tray, -0.28, y + 0.012, -0.21, 0.28, y + 0.032, 0.2, 'ftlr');
      if (c.rnd() < 0.6) plate(c, ...atY(f, jit(c, 0.1), y + 0.032, jit(c, 0.05)));
    }
  }
  B(c, f, X.chrome, -0.32, 1.63, -0.24, 0.32, 1.65, 0.24, 'tf');
  col(c, f, -0.34, -0.26, 0.34, 0.26, 0, 1.65, SURF.metal);
}
/** a stainless prep table at (x, z), long across `face` (its working side): an undershelf, cutting boards, bowls, a knife block */
export function steelPrepTable(c, x, z, face, { w = 1.8, d = 0.75, items = true, lip = false } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.9;
  B(c, f, X.stainless, -w / 2, T - 0.04, -d / 2, w / 2, T, d / 2, 'fblrtd');
  if (lip) B(c, f, X.stainless, -w / 2, T, -d / 2, w / 2, T + 0.1, -d / 2 + 0.02, 'fblrt');
  B(c, f, X.stainless, -w / 2 + 0.04, 0.18, -d / 2 + 0.04, w / 2 - 0.04, 0.2, d / 2 - 0.04, 'ftd');
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    Cy(c, f, X.stainless, s * (w / 2 - 0.05), 0.03, t * (d / 2 - 0.05), 0.02, 0.02, T - 0.07, 6);
    Cy(c, f, X.stainless, s * (w / 2 - 0.05), 0, t * (d / 2 - 0.05), 0.03, 0.025, 0.03, 6);
  }
  // stock on the undershelf
  for (let i = 0; i < 3; i++) if (rnd() < 0.7) B(c, f, pick(c, [X.stainless, M.white, X.kraft]), -w / 2 + 0.15 + i * (w / 3), 0.2, -0.2, -w / 2 + 0.45 + i * (w / 3), 0.2 + 0.1 + rnd() * 0.15, 0.2, 'ftlr');
  if (items) {
    const a0 = jit(c, w / 4);
    B(c, f, pick(c, [X.pale, X.oak, M.green, M.red]), a0 - 0.25, T, 0.0, a0 + 0.25, T + 0.02, 0.35, 'ftlr');
    if (rnd() < 0.6) A(c, f, X.chrome, boxG(0.08, 0.004, 0.3), a0 + jit(c, 0.1), T + 0.024, 0.17, 0, 0.6);
    A(c, f, X.stainless, latheG('bowl', [[0, 0], [0.08, 0], [0.16, 0.09], [0.17, 0.1]], 12), a0 + 0.55 * (a0 < 0 ? 1 : -1), T, 0.1);
    knifeBlock(c, ...atY(f, -w / 2 + 0.15, T, -d / 2 + 0.12), f.yaw + 0.3);
    for (let i = 0; i < 3; i++) c.K.add(pick(c, [X.foodGreen, M.red, X.foodPale]), sphG(0.04, 6, 4), ...atY(f, a0 - 0.1 + i * 0.08, T + 0.06, 0.2 + jit(c, 0.05)));
  }
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, T, SURF.metal);
}
/** a knife block at (x, y, z): a wooden block, black handles */
export function knifeBlock(c, x, y, z, yaw = 0) {
  const f = fr(x, z, yaw);
  A(c, f, c.X.oak, boxG(0.12, 0.2, 0.1), 0, y + 0.1, 0, -0.35);
  for (let i = 0; i < 4; i++) A(c, f, c.M.black, boxG(0.02, 0.1, 0.025), -0.04 + i * 0.027, y + 0.24, -0.06, -0.35);
}
/** a stock pot on a surface at y: steel, two handles, the lid askew */
export function stockPot(c, x, y, z, { r = 0.2, h = 0.34 } = {}) {
  const { K, X } = c;
  K.add(X.stainless, cylG(r, r, h, 16, true), x, y + h / 2, z);
  K.add(X.stainless, cylG(r, r, 0.01, 16), x, y + 0.005, z);
  K.add(X.food, cylG(r - 0.01, r - 0.01, 0.01, 12), x, y + h * 0.7, z);
  for (const s of [-1, 1]) K.add(X.stainless, torG(0.035, 0.008, 3, 6, PI), x + s * (r + 0.01), y + h - 0.05, z, [0, 0, s * PI / 2]);
  K.add(X.stainless, cylG(r + 0.01, r * 0.9, 0.03, 16), x + 0.05, y + h + 0.03, z, [0.12, 0, 0.1]);
  K.add(c.M.black, cylG(0.03, 0.03, 0.03, 6), x + 0.05, y + h + 0.06, z);
}
/**
 * A commercial range at (x, z) against the wall (its back on the wall line), facing `face`: six burners on grates
 * (one left on, glowing), two oven doors, a knob row, a raised back shelf; the hood over it to the ceiling `ceil`.
 */
export function kitchenRange(c, x, z, face, { w = 1.8, d = 0.85, ceil = 3.2, pot = true } = {}) {
  const { X, M, G, U } = c;
  const f = fr(x, z, face);
  const T = 0.92;
  B(c, f, X.stainless, -w / 2, 0.12, 0, w / 2, T, d, 'flrt');
  B(c, f, M.black, -w / 2 + 0.04, 0, 0.05, w / 2 - 0.04, 0.12, d - 0.06, 'flr');
  for (const s of [-1, 1]) {
    const a = s * w / 4;
    B(c, f, X.stainless, a - w / 4 + 0.03, 0.16, d, a + w / 4 - 0.03, 0.7, d + 0.015, 'ft');
    B(c, f, M.black, a - 0.2, 0.35, d + 0.015, a + 0.2, 0.55, d + 0.017, 'f');
    Ca(c, f, X.chrome, a, 0.66, d + 0.06, 0.013, w / 2 - 0.2, 6);
  }
  for (let i = 0; i < 6; i++) Cb(c, f, M.black, -w / 2 + 0.15 + i * ((w - 0.3) / 5), 0.8, d + 0.02, 0.025, 0.04, 8);
  // the grates and the burners
  B(c, f, M.black, -w / 2 + 0.03, T, 0.18, w / 2 - 0.03, T + 0.005, d - 0.03, 't');
  for (let i = 0; i < 3; i++) {
    for (const b of [0.35, 0.65]) {
      const a = -w / 2 + (w * (i + 0.5)) / 3;
      const hot = i === 1 && b > 0.5 && G;
      A(c, f, hot ? G.hob : X.charcoal, torG(0.09, 0.012, 3, 10), a, T + 0.012, b, PI / 2);
      B(c, f, M.dark, a - 0.14, T + 0.02, b - 0.005, a + 0.14, T + 0.035, b + 0.005, 'ftb');
      B(c, f, M.dark, a - 0.005, T + 0.02, b - 0.14, a + 0.005, T + 0.035, b + 0.14, 'flr');
    }
  }
  B(c, f, X.stainless, -w / 2, T, 0, w / 2, T + 0.45, 0.14, 'flrt');
  B(c, f, X.stainless, -w / 2, T + 0.45, 0, w / 2, T + 0.48, 0.28, 'fdt');
  if (pot) stockPot(c, ...atY(f, 0, T + 0.035, 0.65), { r: 0.21, h: 0.36 });
  // the hood
  const y0 = 2.0;
  B(c, f, X.stainless, -w / 2 - 0.1, y0, 0, w / 2 + 0.1, y0 + 0.5, 1.05, 'fblrd');
  for (let i = 0; i < 4; i++) A(c, f, M.dark, boxG((w - 0.2) / 4 - 0.04, 0.3, 0.01), -w / 2 + 0.1 + ((w - 0.2) * (i + 0.5)) / 4, y0 + 0.22, 0.35, -0.6);
  B(c, f, G?.lamp ?? U.panel, -w / 2 + 0.1, y0 - 0.001, 0.8, w / 2 - 0.1, y0, 0.95, 'd');
  B(c, f, X.stainless, -0.25, y0 + 0.5, 0.15, 0.25, ceil, 0.55, 'flr');
  // the suppression nozzles and the pull station beside the range
  for (let i = 0; i < 3; i++) Cy(c, f, X.chrome, -w / 2 + 0.3 + i * (w - 0.6) / 2, y0 - 0.06, 0.5, 0.012, 0.012, 0.06, 6);
  B(c, f, M.red, w / 2 + 0.12, 1.3, 0, w / 2 + 0.28, 1.5, 0.08, 'flrtd');
  L(c, f, 'FIRE - PULL', w / 2 + 0.2, 1.56, 0.002, 0.2, 0.05, { bg: '#b3141a', fg: '#ffffff', font: 'bold 30px Arial' });
  c.light(...atY(f, 0, 1.6, 0.8), 0.3, 1.4, [1.0, 0.95, 0.85], DOWN, 3);
  col(c, f, -w / 2, 0, w / 2, d, 0, T, SURF.metal);
}
/** a walk-in cold room door on the wall at (x, z) facing `face`: insulated, a big lever, a window, a temperature readout; ajar: swung open a crack */
export function walkInDoor(c, x, z, face, { w = 1.0, h = 2.05, label = 'COOL ROOM', temp = '+3°C', ajar = 0, note = null } = {}) {
  const { X, M, G, U } = c;
  const f = fr(x, z, face);
  B(c, f, X.stainless, -w / 2 - 0.1, 0, 0, w / 2 + 0.1, h + 0.1, 0.06, 'flrt');
  B(c, f, M.black, -w / 2, 0, 0.06, w / 2, h, 0.061, 'f');
  const [hx, hz] = at(f, -w / 2, 0.06);
  const g = grp(c, hx, 0, hz, f.yaw - ajar);
  g(X.pale, boxG(w, h, 0.1), w / 2, h / 2, 0.05);
  g(M.frost, boxG(0.3, 0.4, 0.01), w / 2, 1.55, 0.1);
  g(X.chrome, boxG(0.06, 0.04, 0.1), w - 0.12, 1.1, 0.14);
  g(X.chrome, boxG(0.3, 0.035, 0.035), w - 0.25, 1.1, 0.19);
  for (const y of [0.35, h - 0.35]) g(X.chrome, boxG(0.3, 0.07, 0.02), 0.13, y, 0.11);
  if (ajar) for (let i = 0; i < 6; i++) B(c, f, U.glass, -w / 2 + 0.02 + i * (w / 6), 0.02, 0.05, -w / 2 + (i + 1) * (w / 6) - 0.01, h - 0.02, 0.055, 'f');
  B(c, f, X.charcoal, w / 2 + 0.14, 1.55, 0, w / 2 + 0.34, 1.7, 0.04, 'flrtd');
  B(c, f, G?.display ?? U.ledB, w / 2 + 0.16, 1.58, 0.04, w / 2 + 0.32, 1.67, 0.041, 'f');
  L(c, f, temp, w / 2 + 0.24, 1.625, 0.043, 0.14, 0.07, { bg: '#0b1418', fg: '#5ee0ff', font: 'bold 44px monospace' });
  L(c, f, label, 0, h + 0.25, 0.002, 0.8, 0.14, { bg: '#1d4f7a', fg: '#ffffff', font: 'bold 40px Arial' });
  if (note) Ln(c, f, note, 0, 1.3, 0.1 + 0.012, 0.3, 0.2, { bg: '#fdfcf4', fg: '#9a1010', font: 'bold 34px "Comic Sans MS", Arial' });
}
/** a three-bowl dish sink against the wall at (x, z) facing `face`: drainboards, faucets, a pre-rinse spray, a rack of plates */
export function dishSink(c, x, z, face, { w = 2.0, d = 0.7 } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const T = 0.9;
  B(c, f, X.stainless, -w / 2, T - 0.3, 0, w / 2, T, d, 'flrt');
  B(c, f, X.stainless, -w / 2, T, 0, w / 2, T + 0.3, 0.04, 'flrt');
  const bw = (w - 0.6) / 3;
  for (let i = 0; i < 3; i++) {
    const a = -w / 2 + 0.3 + bw * (i + 0.5);
    B(c, f, M.dark, a - bw / 2 + 0.03, T - 0.001, 0.12, a + bw / 2 - 0.03, T, d - 0.08, 't');
    Cy(c, f, X.chrome, a, T, 0.08, 0.015, 0.015, 0.3, 6);
    A(c, f, X.chrome, torG(0.08, 0.012, 4, 8, PI), a, T + 0.3, 0.16, 0, PI / 2);
    if (i === 1) A(c, f, M.card, cylG(bw / 2 - 0.05, bw / 2 - 0.05, 0.005, 12), a, T - 0.05, (d + 0.04) / 2);
  }
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy(c, f, X.stainless, s * (w / 2 - 0.05), 0, (t > 0 ? d - 0.06 : 0.06), 0.022, 0.022, T - 0.3, 6);
  // the pre-rinse spray on its spring
  Cy(c, f, X.chrome, -w / 2 + 0.12, T, 0.08, 0.015, 0.015, 1.0, 6);
  c.K.rod(X.chrome, V(...atY(f, -w / 2 + 0.12, T + 1.0, 0.08)), V(...atY(f, -w / 2 + 0.12, T + 1.0, 0.35)), 0.012, 6);
  Cy(c, f, X.charcoal, -w / 2 + 0.12, T + 0.55, 0.35, 0.02, 0.02, 0.45, 6);
  dishRack(c, ...atY(f, w / 2 - 0.15, T, d / 2), face);
  col(c, f, -w / 2, 0, w / 2, d, 0, T, SURF.metal);
}
/** a wire dish rack of plates and cups on a surface at y */
export function dishRack(c, x, y, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.chrome, -0.25, y, -0.25, 0.25, y + 0.01, 0.25, 't');
  for (const s of [-1, 1]) B(c, f, X.chrome, -0.25, y, s * 0.25 - 0.005, 0.25, y + 0.1, s * 0.25 + 0.005, 'fb');
  for (let i = 0; i < 8; i++) A(c, f, M.white, cylG(0.11, 0.11, 0.012, 12), -0.2 + i * 0.045, y + 0.12, -0.06, 0, PI / 2, PI / 2);
  for (let i = 0; i < 4; i++) A(c, f, M.white, cylG(0.035, 0.04, 0.09, 8, true), -0.18 + i * 0.12, y + 0.055, 0.17, PI);
}
/**
 * Wire shelving against the wall at (x, z) facing `face`, stocked with cans, catering tins, sacks and jars.
 * opts: w, h, d, levels
 */
export function canShelf(c, x, z, face, { w = 1.8, h = 1.85, d = 0.5, levels = 4 } = {}) {
  const { X, M, K, rnd } = c;
  const f = fr(x, z, face);
  for (const s of [-1, 1]) for (const b of [0.03, d - 0.03]) Cy(c, f, X.chrome, s * (w / 2 - 0.02), 0, b, 0.013, 0.013, h, 6);
  const labels = [M.red, M.green, M.blue, M.yellow, X.cream, X.orange];
  for (let i = 0; i < levels; i++) {
    const y = 0.15 + (i * (h - 0.3)) / (levels - 1);
    B(c, f, X.chrome, -w / 2, y - 0.012, 0.01, w / 2, y, d - 0.01, 'td');
    let a = -w / 2 + 0.06;
    const kind = i === 0 ? 'sacks' : i === levels - 1 ? 'boxes' : 'cans';
    while (a < w / 2 - 0.12) {
      if (kind === 'sacks') {
        const sw = 0.35 + rnd() * 0.1;
        if (a + sw > w / 2 - 0.04) break;
        A(c, f, pick(c, [X.cream, X.kraft, M.white]), rbox(sw, 0.2 + rnd() * 0.08, d - 0.12, 0.06), a + sw / 2, y + 0.12, d / 2, 0, jit(c, 0.2));
        a += sw + 0.04;
      } else if (kind === 'boxes') {
        const bw = 0.25 + rnd() * 0.15;
        if (a + bw > w / 2 - 0.04) break;
        if (rnd() < 0.8) B(c, f, pick(c, [M.card, X.kraft, M.white]), a, y, 0.06, a + bw, y + 0.15 + rnd() * 0.15, d - 0.06, 'ftlr');
        a += bw + 0.03;
      } else {
        // a block of cans three deep, sometimes a big catering tin
        const big = rnd() < 0.3;
        const r = big ? 0.08 : 0.04, hh = big ? 0.18 : 0.11;
        const m = pick(c, labels);
        if (a + 2 * r > w / 2 - 0.04) break;
        for (let k = 0; k < (big ? 2 : 3); k++) {
          if (rnd() < 0.15) continue;
          K.add(m, cylG(r, r, hh, 7), ...atY(f, a + r, y + hh / 2, d - 0.06 - r - k * (2 * r + 0.01)));
        }
        a += 2 * r + 0.01;
      }
    }
  }
  col(c, f, -w / 2, 0, w / 2, d, 0, h, SURF.metal);
}
/** a ceiling pot rack centred at (x, z) along x (alongX) or z, `y` its rail height, `ceil` the ceiling: pots and pans on S-hooks */
export function hangingPots(c, x, z, alongX, { len = 2.2, y = 2.25, ceil = 3.2 } = {}) {
  const { K, X, M, rnd } = c;
  const f = fr(x, z, alongX ? 's' : 'e');
  Ca(c, f, X.stainless, 0, y, 0, 0.018, len, 8);
  for (const s of [-1, 1]) Cy(c, f, X.stainless, s * (len / 2 - 0.1), y, 0, 0.008, 0.008, ceil - y, 4);
  const n = Math.floor(len / 0.28);
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + 0.18 + i * ((len - 0.36) / Math.max(1, n - 1));
    A(c, f, X.chrome, torG(0.02, 0.004, 3, 6), a, y - 0.02, 0);
    if (rnd() < 0.55) {
      // a frying pan hanging by its handle
      const r = 0.12 + rnd() * 0.06;
      Cy(c, f, X.charcoal, a, y - 0.3, 0, 0.008, 0.008, 0.26, 4);
      A(c, f, pick(c, [X.charcoal, X.stainless, X.copper]), cylG(r, r * 0.9, 0.04, 12), a, y - 0.3 - r, 0, PI / 2, rnd() * 0.5);
    } else {
      const r = 0.1 + rnd() * 0.05, h = 0.12 + rnd() * 0.08;
      Cy(c, f, X.chrome, a, y - 0.12, 0, 0.004, 0.004, 0.1, 3);
      A(c, f, pick(c, [X.stainless, X.copper]), cylG(r, r, h, 10, true), a, y - 0.14 - h / 2, 0, 0.05);
      A(c, f, pick(c, [X.stainless, X.copper]), cylG(r, r, 0.004, 10), a, y - 0.14 - h, 0, 0.05);
    }
  }
}
/** a square floor drain at (x, z): a frame and slats */
export function floorDrain(c, x, z, s = 0.3) {
  const { K, M, X } = c;
  K.box(X.stainless, x - s / 2, 0, z - s / 2, x + s / 2, 0.004, z + s / 2, { faces: ['py'] });
  for (let i = 0; i < 5; i++) K.box(M.black, x - s / 2 + 0.03, 0, z - s / 2 + 0.04 + i * (s - 0.08) / 4 - 0.008, x + s / 2 - 0.03, 0.005, z - s / 2 + 0.04 + i * (s - 0.08) / 4 + 0.008, { faces: ['py'] });
}
/** a two-door stainless reach-in fridge at (x, z) facing `face` */
export function reachInFridge(c, x, z, face, { w = 1.2, d = 0.8, h = 2.0 } = {}) {
  const { X, M, G, U } = c;
  const f = fr(x, z, face);
  B(c, f, X.stainless, -w / 2, 0.12, 0, w / 2, h, d - 0.03, 'flrt');
  B(c, f, M.black, -w / 2 + 0.05, 0, 0.05, w / 2 - 0.05, 0.12, d - 0.1, 'f');
  for (const s of [-1, 1]) {
    B(c, f, X.stainless, s > 0 ? 0.005 : -w / 2 + 0.01, 0.15, d - 0.03, s > 0 ? w / 2 - 0.01 : -0.005, h - 0.2, d, 'f');
    B(c, f, X.chrome, s * 0.05 - 0.015, 0.9, d, s * 0.05 + 0.015, 1.5, d + 0.04, 'flrt');
  }
  B(c, f, X.charcoal, -w / 2, h - 0.18, d - 0.03, w / 2, h - 0.02, d, 'f');
  B(c, f, G?.display ?? U.ledB, -0.1, h - 0.14, d, 0.1, h - 0.06, d + 0.002, 'f');
  col(c, f, -w / 2, 0, w / 2, d + 0.04, 0, h, SURF.metal);
}
/** a yellow mop bucket on castors with its wringer at (x, z), the mop leaning in it */
export function mopBucket(c, x, z, yaw = 0) {
  const { X, M } = c;
  const f = fr(x, z, yaw);
  R(c, f, M.yellow, 0, 0.2, 0, 0.42, 0.3, 0.32, 0.04);
  B(c, f, X.bottle, -0.17, 0.3, -0.12, 0.08, 0.301, 0.12, 't');
  R(c, f, X.charcoal, 0.14, 0.44, 0, 0.14, 0.2, 0.26, 0.02);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) A(c, f, X.rubber, cylG(0.025, 0.025, 0.025, 6), s * 0.17, 0.025, t * 0.12, 0, 0, PI / 2);
  c.K.rod(X.alu, V(...atY(f, -0.05, 0.08, 0)), V(...atY(f, -0.3, 1.35, 0.1)), 0.012, 5);
  A(c, f, X.cream, cylG(0.05, 0.09, 0.2, 7), -0.05, 0.18, 0);
}
/** a yellow wet-floor A-frame at (x, z) turned `yaw` (down: knocked flat) */
export function wetFloorSign(c, x, z, yaw = 0, { down = false } = {}) {
  const { M } = c;
  if (down) {
    c.K.add(M.yellow, boxG(0.3, 0.02, 0.62), x, 0.02, z, [0, yaw, 0]);
    return;
  }
  const f = fr(x, z, yaw);
  for (const s of [-1, 1]) {
    A(c, f, M.yellow, boxG(0.3, 0.62, 0.015), 0, 0.3, s * 0.1, s * -0.17);
    const [lx, lz] = at(f, 0, s * 0.112);
    if (f.face) L(c, fr(lx, lz, s > 0 ? f.face : { s: 'n', n: 's', e: 'w', w: 'e' }[f.face]), 'CAUTION  WET FLOOR', 0, 0.36, 0, 0.24, 0.16, { bg: '#e8b417', fg: '#111111', font: 'bold 34px Arial', lines: ['CAUTION', 'WET FLOOR'] });
  }
}
/** a sheet-pan rack on castors at (x, z) facing `face` (its open side), half full of trays */
export function speedRack(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  for (const s of [-1, 1]) for (const b of [-0.3, 0.3]) Cy(c, f, X.alu, s * 0.25, 0.08, b, 0.012, 0.012, 1.6, 5);
  for (let i = 0; i < 14; i++) {
    const y = 0.2 + i * 0.1;
    if (c.rnd() < 0.5) B(c, f, X.alu, -0.24, y, -0.32, 0.24, y + 0.015, 0.32, 'tf');
    if (c.rnd() < 0.2) B(c, f, pick(c, [X.foodPale, X.food]), -0.18, y + 0.015, -0.2, 0.18, y + 0.05, 0.2, 'tf');
  }
  for (const s of [-1, 1]) for (const b of [-0.3, 0.3]) A(c, f, X.rubber, cylG(0.035, 0.035, 0.025, 6), s * 0.25, 0.04, b, 0, 0, PI / 2);
  col(c, f, -0.27, -0.33, 0.27, 0.33, 0, 1.7, SURF.metal);
}
/** a floor-standing dough mixer at (x, z) facing `face`: the base, the column, the head, the bowl with its hook */
export function mixer(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.cream, 0, 0.1, 0, 0.6, 0.2, 0.7, 0.04);
  R(c, f, X.cream, 0, 0.75, -0.2, 0.4, 1.1, 0.3, 0.06);
  R(c, f, X.cream, 0, 1.35, 0.05, 0.36, 0.28, 0.6, 0.08);
  A(c, f, X.stainless, latheG('mixbowl', [[0, 0], [0.12, 0], [0.24, 0.1], [0.26, 0.38], [0.27, 0.4]], 14), 0, 0.55, 0.15);
  Cy(c, f, X.stainless, 0, 0.75, 0.15, 0.02, 0.02, 0.45, 6);
  for (const s of [-1, 1]) B(c, f, X.cream, s * 0.28 - 0.03, 0.8, -0.1, s * 0.28 + 0.03, 0.9, 0.2, 'flrtd');
  B(c, f, M.dark, -0.12, 0.95, -0.05, 0.12, 1.1, -0.04, 'f');
  B(c, f, M.red, 0.04, 1.02, -0.04, 0.08, 1.06, -0.03, 'f');
  col(c, f, -0.32, -0.36, 0.32, 0.42, 0, 1.5, SURF.metal);
}
/** an order-ticket rail on the wall at (x, y, z) facing `face`, tickets clipped to it (lines: the orders) */
export function ticketRail(c, x, y, z, face, { w = 1.2, tickets = [] } = {}) {
  const f = fr(x, z, face);
  B(c, f, c.X.stainless, -w / 2, y, 0, w / 2, y + 0.04, 0.05, 'flrtd');
  tickets.forEach((t, i) => {
    const a = -w / 2 + 0.12 + i * 0.16;
    Ln(c, f, t, a, y - 0.1, 0.052, 0.12, 0.2, { bg: '#fbfbf2', fg: '#222222', font: 'bold 26px monospace', align: 'left' });
  });
}

// ---------------------------------------------------------------- lockers, restrooms, the sleeping quarters
/**
 * A bank of lockers along the rect (its back on the wall or back to back), doors toward `face`: vented doors with
 * numbers, handles and padlocks; `forced` the share jemmied open (bent, swung out, stuff inside). opts: h, tiers, first (number)
 */
export function lockerBank(c, [x0, z0, x1, z1], face, { h = 1.9, tiers = 1, forced = 0.15, first = 101, mat = null } = {}) {
  const { X, M, rnd } = c;
  const f = fr((x0 + x1) / 2, (z0 + z1) / 2, face);
  const alongX = face === 'n' || face === 's';
  const len = alongX ? x1 - x0 : z1 - z0, dep = alongX ? z1 - z0 : x1 - x0;
  const m = mat ?? M.lockerBlue;
  B(c, f, m, -len / 2, 0.1, -dep / 2, len / 2, h, dep / 2 - 0.02, 'lrt');
  B(c, f, X.charcoal, -len / 2, 0, -dep / 2, len / 2, 0.1, dep / 2 - 0.03, 'flrt');
  const n = Math.max(1, Math.round(len / 0.38));
  const dw = len / n, th = (h - 0.12) / tiers;
  let num = first;
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + dw * (i + 0.5);
    for (let t = 0; t < tiers; t++) {
      const y0 = 0.12 + t * th, y1 = y0 + th - 0.012;
      const open = rnd() < forced;
      if (open) {
        // the inside: a shelf, a hook, something left behind; the door bent open
        B(c, f, M.dark, a - dw / 2 + 0.01, y0, dep / 2 - 0.021, a + dw / 2 - 0.01, y1, dep / 2 - 0.02, 'f');
        B(c, f, m, a - dw / 2 + 0.02, y1 - 0.3, -dep / 2 + 0.05, a + dw / 2 - 0.02, y1 - 0.28, dep / 2 - 0.03, 't');
        if (th > 1 && rnd() < 0.6) coat(c, ...atY(f, a, y1 - 0.34, -dep / 2 + 0.2), f.yaw + PI / 2, pick(c, [X.labcoat, X.navy, X.denim]));
        else if (rnd() < 0.6) A(c, f, pick(c, [X.olive, M.black, X.navy]), rbox(dw - 0.1, 0.22, 0.25, 0.06), a, y0 + 0.11, 0);
        const [hx, hz] = at(f, a - dw / 2 + 0.01, dep / 2);
        const g = grp(c, hx, 0, hz, f.yaw - 1.6 - rnd() * 0.5, 0, jit(c, 0.04));
        g(m, boxG(dw - 0.02, th - 0.02, 0.015), (dw - 0.02) / 2, (y0 + y1) / 2, 0.01, 0, 0, 0);
        g(m, boxG(dw * 0.4, th * 0.3, 0.015), dw * 0.75, y0 + th * 0.55, 0.03, 0, 0.35, 0);
      } else {
        B(c, f, m, a - dw / 2 + 0.006, y0, dep / 2 - 0.02, a + dw / 2 - 0.006, y1, dep / 2, 'f');
        for (let k = 0; k < 4; k++) B(c, f, M.dark, a - 0.09, y1 - 0.12 - k * 0.035, dep / 2, a + 0.09, y1 - 0.108 - k * 0.035, dep / 2 + 0.001, 'f');
        B(c, f, X.chrome, a + dw / 2 - 0.07, y0 + th * 0.45, dep / 2, a + dw / 2 - 0.05, y0 + th * 0.45 + 0.12, dep / 2 + 0.02, 'flrtd');
        if (rnd() < 0.4) A(c, f, pick(c, [X.brass, X.chrome, M.red]), rbox(0.035, 0.045, 0.015, 0.006), a + dw / 2 - 0.06, y0 + th * 0.45 - 0.04, dep / 2 + 0.03);
      }
      L(c, f, String(num++), a - dw / 2 + 0.07, y1 - 0.05, dep / 2 + 0.002, 0.07, 0.04, { bg: '#e6e6e0', fg: '#1b2127', font: 'bold 40px Arial' });
    }
  }
  // a sloped top so nothing gets stored up there
  A(c, f, m, boxG(len, 0.02, dep * 1.1), 0, h + 0.1, 0, -0.35);
  col(c, f, -len / 2, -dep / 2, len / 2, dep / 2, 0, h + 0.2, SURF.metal);
}
/** a changing-room bench over the rect: oak slats on steel pedestals */
export function lockerBench(c, [x0, z0, x1, z1]) {
  const { K, X } = c;
  const alongX = x1 - x0 >= z1 - z0;
  const L0 = alongX ? x1 - x0 : z1 - z0, W = alongX ? z1 - z0 : x1 - x0;
  for (let i = 0; i < 3; i++) {
    const o = -W / 2 + (W * (i + 0.5)) / 3;
    if (alongX) K.box(X.oak, x0, 0.42, (z0 + z1) / 2 + o - W / 7, x1, 0.45, (z0 + z1) / 2 + o + W / 7);
    else K.box(X.oak, (x0 + x1) / 2 + o - W / 7, 0.42, z0, (x0 + x1) / 2 + o + W / 7, 0.45, z1);
  }
  const n = Math.max(2, Math.round(L0 / 1.2) + 1);
  for (let i = 0; i < n; i++) {
    const u = (alongX ? x0 : z0) + 0.15 + ((L0 - 0.3) * i) / (n - 1);
    if (alongX) {
      K.box(X.charcoal, u - 0.025, 0.02, z0 + 0.03, u + 0.025, 0.42, z1 - 0.03);
      K.box(X.charcoal, u - 0.05, 0, z0 + 0.02, u + 0.05, 0.02, z1 - 0.02);
    } else {
      K.box(X.charcoal, x0 + 0.03, 0.02, u - 0.025, x1 - 0.03, 0.42, u + 0.025);
      K.box(X.charcoal, x0 + 0.02, 0, u - 0.05, x1 - 0.02, 0.02, u + 0.05);
    }
  }
  c.col(x0, 0, z0, x1, 0.45, z1, SURF.wood);
}
/** a row of coat hooks on the wall at (x, z) facing `face` (w long), coats and lab coats hanging from some */
export function coatHooks(c, x, z, face, { w = 2.0, y = 1.75, coats = 0.6, mats = null } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.oak, -w / 2, y - 0.05, 0, w / 2, y + 0.05, 0.025, 'flrtd');
  const n = Math.max(2, Math.round(w / 0.3));
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + (w * (i + 0.5)) / n;
    A(c, f, X.chrome, boxG(0.015, 0.015, 0.08), a, y + 0.01, 0.06, -0.5);
    if (rnd() < coats) {
      const m = mats ? pick(c, mats) : pick(c, [X.labcoat, X.labcoat, X.navy, X.orange, X.denim, X.olive]);
      coat(c, ...atY(f, a, y + 0.02, 0.1), f.yaw + jit(c, 0.2), m, { long: m === X.labcoat });
    }
  }
}
/** a mirror on the wall at (x, y, z) facing `face` (cracked: a crack decal over it) */
export function mirror(c, x, y, z, face, { w = 0.6, h = 0.8, cracked = false } = {}) {
  const f = fr(x, z, face);
  B(c, f, c.X.alu, -w / 2 - 0.015, y - h / 2 - 0.015, 0, w / 2 + 0.015, y + h / 2 + 0.015, 0.012, 'flrtd');
  B(c, f, c.X.mirror, -w / 2, y - h / 2, 0.012, w / 2, y + h / 2, 0.014, 'f');
  if (cracked) c.wallDecal?.('crack', ...atY(f, jit(c, w / 4), y + jit(c, h / 4), 0.016), face, w * 0.8, h * 0.7);
}
/** a wall-hung washbasin at (x, z) facing `face`: porcelain, a chrome tap, the trap under it, soap, a mirror over it */
export function washbasin(c, x, z, face, { mirrorToo = true, cracked = false } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.porcelain, 0, 0.8, 0.24, 0.55, 0.14, 0.45, 0.04);
  B(c, f, M.dark, -0.18, 0.869, 0.12, 0.18, 0.872, 0.38, 't');
  Cy(c, f, X.chrome, 0, 0.87, 0.08, 0.018, 0.015, 0.16, 6);
  Cb(c, f, X.chrome, 0, 1.02, 0.14, 0.012, 0.13, 6);
  Cy(c, f, X.chrome, 0, 0.35, 0.18, 0.02, 0.02, 0.38, 6);
  Cb(c, f, X.chrome, 0, 0.36, 0.09, 0.02, 0.18, 6);
  B(c, f, X.pale, 0.2, 1.05, 0, 0.3, 1.25, 0.1, 'flrtd');
  if (mirrorToo) mirror(c, x, 1.55, z, face, { cracked });
  col(c, f, -0.28, 0, 0.28, 0.47, 0.72, 0.87, SURF.glass);
}
/** a hand dryer on the wall at (x, y, z) facing `face` */
export function handDryer(c, x, y, z, face) {
  const f = fr(x, z, face);
  R(c, f, c.X.pale, 0, y, 0.1, 0.28, 0.3, 0.2, 0.05);
  Cb(c, f, c.X.chrome, 0.02, y - 0.17, 0.12, 0.03, 0.08, 8);
  B(c, f, c.M.dark, -0.08, y + 0.05, 0.2, 0.0, y + 0.1, 0.201, 'f');
}
/** a paper-towel dispenser on the wall at (x, y, z) facing `face`, a bin under it */
export function paperTowelDispenser(c, x, y, z, face, { bin = true } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.pale, 0, y, 0.07, 0.3, 0.38, 0.13, 0.02);
  B(c, f, M.frost, -0.08, y, 0.135, 0.08, y + 0.1, 0.136, 'f');
  A(c, f, X.paper, boxG(0.22, 0.12, 0.004), 0, y - 0.24, 0.1, 0.25);
  if (bin) {
    B(c, f, M.grey, -0.18, 0, 0.02, 0.18, 0.6, 0.32, 'flrt');
    for (let i = 0; i < 3; i++) c.K.add(X.paper, blobG(), ...atY(f, jit(c, 0.1), 0.62, 0.17 + jit(c, 0.06)), [c.rnd(), c.rnd(), 0], [0.05, 0.04, 0.05]);
    col(c, f, -0.18, 0, 0.18, 0.32, 0, 0.6, SURF.metal);
  }
}
/** a toilet at (x, z), its seat toward `face`: the bowl, the seat (lid up or down), a flush plate on the wall behind */
export function toilet(c, x, z, face, { lidUp = false } = {}) {
  const { X } = c;
  const f = fr(x, z, face);
  A(c, f, X.porcelain, latheG('wcbowl', [[0, 0], [0.13, 0], [0.16, 0.2], [0.19, 0.38], [0.18, 0.4]], 12), 0, 0, 0.35, 0, 0, 0, [1, 1, 1.25]);
  R(c, f, X.porcelain, 0, 0.3, 0.1, 0.34, 0.2, 0.2, 0.04);
  A(c, f, X.pale, torG(0.16, 0.025, 4, 12), 0, 0.41, 0.36, PI / 2, 0, 0, [1, 1.25, 1]);
  if (lidUp) A(c, f, X.pale, rbox(0.34, 0.42, 0.025, 0.012), 0, 0.62, 0.14, -0.15);
  else A(c, f, X.pale, rbox(0.34, 0.025, 0.42, 0.012), 0, 0.44, 0.36);
  B(c, f, X.pale, -0.12, 0.95, 0, 0.12, 1.1, 0.012, 'flrtd');
  B(c, f, X.chrome, -0.1, 0.97, 0.012, -0.005, 1.08, 0.016, 'f');
  B(c, f, X.chrome, 0.005, 0.97, 0.012, 0.1, 1.08, 0.016, 'f');
}
/**
 * A toilet cubicle at (x, z) (the centre of its floor), its door toward `face`: partitions on legs, a pilaster front
 * with the door ('closed' | 'open' | 'broken' (off a hinge) | 'locked' (red, something seeping under it)), the
 * toilet, a paper holder, a hook. Side partitions are built on sides 'l' / 'r' when listed in `walls`.
 */
export function toiletStall(c, x, z, face, { w = 0.95, d = 1.5, door = 'closed', walls = 'lr', H = 2.0 } = {}) {
  const { X, M, U, rnd } = c;
  const f = fr(x, z, face);
  const pm = X.partition;
  for (const side of walls) {
    const a = side === 'l' ? -w / 2 : w / 2;
    B(c, f, pm, a - 0.012, 0.15, -d / 2, a + 0.012, H, d / 2, 'lrtf');
    Cy(c, f, X.chrome, a, 0, d / 2 - 0.05, 0.015, 0.015, 0.15, 6);
  }
  // the front: pilasters either side of a 0.6 doorway, a head rail
  const dw = 0.62;
  B(c, f, pm, -w / 2, 0.15, d / 2 - 0.012, -dw / 2, H, d / 2 + 0.012, 'fblrt');
  B(c, f, pm, dw / 2, 0.15, d / 2 - 0.012, w / 2, H, d / 2 + 0.012, 'fblrt');
  B(c, f, X.alu, -w / 2, H, d / 2 - 0.02, w / 2, H + 0.04, d / 2 + 0.02, 'fbtd');
  const [hx, hz] = at(f, -dw / 2, d / 2);
  if (door === 'broken') {
    // hanging off its top hinge, twisted into the stall
    const g = grp(c, hx, 0.15, hz, f.yaw + 0.6, 0.12, 0.35);
    g(pm, boxG(dw - 0.01, H - 0.2, 0.025), dw / 2, (H - 0.2) / 2, 0);
  } else {
    const swing = door === 'open' ? -1.4 - rnd() * 0.3 : 0;
    const g = grp(c, hx, 0.15, hz, f.yaw + swing);
    g(pm, boxG(dw - 0.01, H - 0.2, 0.025), dw / 2, (H - 0.2) / 2, 0);
    g(X.chrome, boxG(0.05, 0.02, 0.03), dw - 0.07, 0.85, 0.02);
    g(door === 'locked' ? U.ledR : U.ledG, boxG(0.04, 0.02, 0.004), dw - 0.07, 0.9, 0.018);
    if (door === 'locked') c.decal?.('blood', ...at(f, 0, d / 2 + 0.15), 0.7, rnd() * 6);
  }
  toilet(c, ...at(f, 0, -d / 2), face, { lidUp: rnd() < 0.5 });
  Cb(c, f, X.chrome, w / 2 - 0.1, 0.7, -d / 2 + 0.55, 0.06, 0.1, 10);
  Ca(c, f, X.paper, w / 2 - 0.1, 0.7, -d / 2 + 0.55, 0.055, 0.1, 10);
  A(c, f, X.chrome, boxG(0.015, 0.015, 0.06), -w / 2 + 0.03, 1.7, 0, 0, PI / 2);
  for (const side of walls) {
    const a = side === 'l' ? -w / 2 : w / 2;
    col(c, f, a - 0.02, -d / 2, a + 0.02, d / 2, 0.15, H, SURF.wood);
  }
  col(c, f, -w / 2, d / 2 - 0.02, -dw / 2, d / 2 + 0.02, 0.15, H, SURF.wood);
  col(c, f, dw / 2, d / 2 - 0.02, w / 2, d / 2 + 0.02, 0.15, H, SURF.wood);
  if (door === 'closed' || door === 'locked') col(c, f, -dw / 2, d / 2 - 0.02, dw / 2, d / 2 + 0.02, 0.15, H, SURF.wood);
}
/** a laundry cart (a canvas bin on a steel frame, castors) at (x, z), heaped with lab coats and towels */
export function laundryCart(c, x, z, yaw = 'n') {
  const { X, M } = c;
  const f = fr(x, z, typeof yaw === 'string' ? yaw : 's'); // (a face letter)
  R(c, f, X.cream, 0, 0.5, 0, 0.62, 0.5, 0.9, 0.03);
  B(c, f, X.chrome, -0.32, 0.74, -0.46, 0.32, 0.76, 0.46, 'tfblr');
  for (let i = 0; i < 5; i++) A(c, f, pick(c, [X.labcoat, X.labcoat, M.white, X.bottle]), rbox(0.35, 0.12, 0.4, 0.05), jit(c, 0.12), 0.76 + i * 0.03, jit(c, 0.25), jit(c, 0.2), c.rnd() * 3, jit(c, 0.2));
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    Cy(c, f, X.chrome, s * 0.3, 0.05, t * 0.43, 0.012, 0.012, 0.25, 5);
    A(c, f, X.rubber, cylG(0.04, 0.04, 0.03, 6), s * 0.3, 0.04, t * 0.43, 0, 0, PI / 2);
  }
  col(c, f, -0.32, -0.46, 0.32, 0.46, 0, 0.9, SURF.cardboard);
}
/**
 * A steel bunk bed at (x, z), long across `face` (the side you climb in from): two mattresses, pillows, blankets
 * (unmade: kicked back, rumpled), a ladder at one end.
 */
export function bunkBed(c, x, z, face, { unmade = true, len = 1.95, w = 0.9 } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  const fm = pick(c, [M.dark, X.olive, M.grey]);
  for (const s of [-1, 1]) for (const t of [-1, 1]) B(c, f, fm, s * len / 2 - (s > 0 ? 0.04 : 0), 0, t * w / 2 - (t > 0 ? 0.04 : 0), s * len / 2 + (s > 0 ? 0 : 0.04), 1.75, t * w / 2 + (t > 0 ? 0 : 0.04));
  for (const y of [0.3, 1.3]) {
    for (const t of [-1, 1]) B(c, f, fm, -len / 2, y, t * w / 2 - 0.02, len / 2, y + 0.05, t * w / 2 + 0.02, 'fbtd');
    for (const s of [-1, 1]) B(c, f, fm, s * len / 2 - 0.02, y, -w / 2, s * len / 2 + 0.02, y + 0.05, w / 2, 'lrtd');
    B(c, f, M.dark, -len / 2 + 0.04, y + 0.02, -w / 2 + 0.04, len / 2 - 0.04, y + 0.03, w / 2 - 0.04, 't');
    R(c, f, X.mattress, 0, y + 0.1, 0, len - 0.1, 0.14, w - 0.1, 0.04);
    const px = -len / 2 + 0.28;
    A(c, f, M.white, rbox(0.42, 0.1, 0.55, 0.045), px + jit(c, 0.04), y + 0.21, jit(c, 0.05), jit(c, 0.05), jit(c, 0.25), 0);
    const bm = pick(c, [X.blanket, X.wool, X.navy]);
    if (unmade && rnd() < 0.8) {
      A(c, f, bm, rbox(1.1, 0.12, w - 0.05, 0.05), 0.3 + jit(c, 0.1), y + 0.22, 0.05, 0.1, jit(c, 0.3), 0.05);
      A(c, f, bm, rbox(0.4, 0.2, w * 0.6, 0.08), 0.7, y + 0.26, jit(c, 0.1), 0, jit(c, 0.5), 0);
    } else A(c, f, bm, rbox(1.4, 0.03, w - 0.06, 0.012), 0.2, y + 0.185, 0);
  }
  B(c, f, fm, -len / 2, 1.72, -w / 2, len / 2, 1.75, -w / 2 + 0.04, 'fbt');
  // the ladder at the foot, on the open side
  for (const s of [-0.18, 0.18]) B(c, f, fm, len / 2 - 0.3 + s - 0.015, 0.3, w / 2 - 0.02, len / 2 - 0.3 + s + 0.015, 1.55, w / 2 + 0.01);
  for (let k = 0; k < 4; k++) Ca(c, f, fm, len / 2 - 0.3, 0.55 + k * 0.25, w / 2, 0.012, 0.36, 5);
  col(c, f, -len / 2, -w / 2, len / 2, w / 2, 0, 1.75, SURF.metal);
}
/** a footlocker at (x, z) facing `face`: olive steel with a stencil, handles (open: the lid up, clothes in it) */
export function footlocker(c, x, z, face, { open = false, name = null } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.olive, -0.4, 0, -0.2, 0.4, 0.34, 0.2, 'fblrt');
  B(c, f, X.charcoal, -0.4, 0.3, 0.2, 0.4, 0.32, 0.205, 'f');
  for (const s of [-1, 1]) B(c, f, X.charcoal, s * 0.4 - (s > 0 ? 0 : 0.015), 0.2, -0.05, s * 0.4 + (s > 0 ? 0.015 : 0), 0.23, 0.05, 'lrt');
  B(c, f, X.brass, -0.03, 0.26, 0.2, 0.03, 0.31, 0.21, 'ft');
  if (open) {
    A(c, f, X.olive, boxG(0.8, 0.4, 0.03), 0, 0.53, -0.21, -0.12);
    B(c, f, M.dark, -0.37, 0.33, -0.17, 0.37, 0.335, 0.17, 't');
    A(c, f, pick(c, [X.denim, X.navy, X.olive]), rbox(0.35, 0.08, 0.25, 0.03), -0.12, 0.33, 0, 0, 0.3);
  } else B(c, f, X.olive, -0.41, 0.34, -0.21, 0.41, 0.4, 0.21, 'fblrt');
  if (name) L(c, f, name, 0, 0.14, 0.202, 0.4, 0.08, { bg: '#565c43', fg: '#e8e2c8', font: 'bold 40px "Courier New", monospace' });
  col(c, f, -0.41, -0.21, 0.41, 0.21, 0, open ? 0.34 : 0.4, SURF.metal);
}
/** a clothesline from a to b at height y (hooks on the walls), clothes pegged on it */
export function clothesline(c, ax, az, bx, bz, y, { n = 6 } = {}) {
  const { K, X, M, rnd } = c;
  K.rod(M.white, V(ax, y, az), V(bx, y - 0.04, bz), 0.004, 3);
  for (const [x, z] of [[ax, az], [bx, bz]]) K.add(X.chrome, sphG(0.015, 5, 3), x, y, z);
  const yaw = Math.atan2(bx - ax, bz - az) + PI / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5 + jit(c, 0.2)) / n;
    const x = ax + (bx - ax) * t, z = az + (bz - az) * t, yy = y - 0.04 * t - Math.sin(t * PI) * 0.06;
    const m = pick(c, [M.white, X.navy, X.olive, M.red, X.denim, X.cream, M.grey]);
    const k = rnd();
    if (k < 0.45) {
      // a t-shirt
      K.add(m, boxG(0.42, 0.55, 0.01), x, yy - 0.3, z, [0, yaw, 0]);
      K.add(m, boxG(0.62, 0.16, 0.01), x, yy - 0.1, z, [0, yaw, 0]);
    } else if (k < 0.7) K.add(m, boxG(0.5, 0.7, 0.01), x, yy - 0.36, z, [0, yaw, jit(c, 0.05)]);
    else for (const s of [-1, 1]) K.add(m, boxG(0.08, 0.26, 0.012), x + Math.cos(yaw) * s * 0.06, yy - 0.14, z - Math.sin(yaw) * s * 0.06, [0, yaw, 0]);
    K.add(X.oak, boxG(0.012, 0.05, 0.02), x, yy - 0.01, z, [0, yaw, 0]);
  }
}
/** a poster on the wall at (x, y, z) facing `face`, taped at its corners (lines: its text) */
export function poster(c, x, y, z, face, { w = 0.6, h = 0.85, lines = ['NOX'], bg = '#1d4f7a', fg = '#ffffff', font = 'bold 44px Arial' } = {}) {
  const f = fr(x, z, face);
  Ln(c, f, lines, 0, y, 0.004, w, h, { bg, fg, font });
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) A(c, f, c.X.paper, boxG(0.06, 0.025, 0.002), s * (w / 2 - 0.01), y + t * (h / 2 - 0.01), 0.006, 0, 0, s * t * 0.7);
}
/** an acoustic guitar leaning on the wall at (x, z) (its back to the wall facing `face`) */
export function guitar(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const shape = cached('guitar', () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.2, 0, 0.21, 0.22, 0.13, 0.3);
    s.bezierCurveTo(0.1, 0.34, 0.16, 0.44, 0.13, 0.5);
    s.bezierCurveTo(0.08, 0.6, -0.08, 0.6, -0.13, 0.5);
    s.bezierCurveTo(-0.16, 0.44, -0.1, 0.34, -0.13, 0.3);
    s.bezierCurveTo(-0.21, 0.22, -0.2, 0, 0, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.09, bevelEnabled: false, curveSegments: 5 });
    g.translate(0, 0, -0.045);
    return g;
  });
  const lean = 0.22;
  A(c, f, X.oak, shape, 0, 0.02, 0.2, -lean);
  A(c, f, M.black, cylG(0.045, 0.045, 0.005, 10), 0, 0.02 + Math.cos(lean) * 0.36, 0.2 - Math.sin(lean) * 0.36 + 0.047, PI / 2 - lean);
  A(c, f, X.walnut, boxG(0.05, 0.5, 0.025), 0, 0.02 + Math.cos(lean) * 0.82, 0.2 - Math.sin(lean) * 0.82, -lean);
  A(c, f, X.walnut, boxG(0.07, 0.16, 0.02), 0, 0.02 + Math.cos(lean) * 1.14, 0.2 - Math.sin(lean) * 1.14, -lean);
}
/** a duffel bag on the floor at (x, z) turned `yaw` */
export function duffelBag(c, x, z, yaw = 0, mat = null) {
  const { X } = c;
  const f = fr(x, z, yaw);
  const m = mat ?? pick(c, [X.olive, X.navy, c.M.black]);
  A(c, f, m, cylG(0.16, 0.16, 0.65, 10), 0, 0.15, 0, 0, 0, PI / 2, [1, 1, 0.8]);
  A(c, f, X.charcoal, torG(0.1, 0.012, 3, 8, PI), 0, 0.28, 0);
}
