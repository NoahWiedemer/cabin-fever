// The Hive's canteen wing and the staff rooms (world/hive.js): the cafeteria, its kitchen, the lockers, the restrooms
// and the sleeping quarters. The room dress functions compose hiveFacility.js's catering / locker / bunk props with
// the ones here (long canteen tables, a condiment station, drinks coolers, the cook line's fryer, combi oven and tilt
// kettle, an ice machine, a hood dishwasher, urinals, a vanity, a janitor's cart, a card table ...).
// Everything is world-space geometry for the Kit (one mesh per material, baked light) and a collider for whatever
// you'd bump into, like hiveProps.js.
//
// c: hiveProps.js's context plus X (EXTRA_MATS of this module, hiveFacility.js and hiveLabs.js, baked), G (their
//    EXTRA_GLOW), label(text, x, y, z, face, w, h, opts), decal(kind, x, z, size, rot), wallDecal(kind, x, y, z, face,
//    w, h), screen(x, y, z, yaw, w, h, on).
// Floor props take the centre of their footprint (x, z) and the `face` their front looks toward ('n' -z, 's' +z,
// 'w' -x, 'e' +x); wall props take the point on the wall line (the room rect's edge) and the face into the room.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import { SIGN } from './lab.js';
import * as P from './hiveProps.js';
import * as Fac from './hiveFacility.js';
import * as HL from './hiveLabs.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const FACE_YAW = P.FACE_YAW;
const COLD = [0.85, 0.93, 1.0];

/** baked materials this module adds (c.X.<name>) */
export const EXTRA_MATS = {
  f2_laminate: { color: 0xd9d2c0, roughness: 0.5 }, // canteen table tops
  f2_mint: { color: 0x9cc2b2, roughness: 0.5 }, // the older tables' retro laminate
  f2_edge: { color: 0x34383b, roughness: 0.7 }, // table edge bands, T-legs
  f2_shellRed: { color: 0xb3392f, roughness: 0.42 }, // moulded chair shells
  f2_shellTeal: { color: 0x2d7c84, roughness: 0.42 },
  f2_shellGrey: { color: 0x8b9095, roughness: 0.45 },
  f2_oil: { color: 0x6e4a10, metalness: 0.1, roughness: 0.08 }, // fryer oil
  f2_grease: { color: 0x3b2a18, roughness: 0.55 },
  f2_ice: { color: 0xdcebf3, roughness: 0.12 },
  f2_binGrey: { color: 0x5b6165, roughness: 0.7 }, // the big kitchen bins
  f2_binBag: { color: 0x121315, roughness: 0.25 },
  f2_solid: { color: 0xbcc1be, roughness: 0.35 }, // the vanity's solid-surface top
  f2_china: { color: 0xeef2f1, roughness: 0.1 }, // urinals, the mop sink
  f2_felt: { color: 0x2c6a45, roughness: 1 },
  f2_cardBack: { color: 0x9b1e23, roughness: 0.5 },
  f2_sauce: { color: 0xa3170f, roughness: 0.3 },
  f2_mustard: { color: 0xd6a21c, roughness: 0.35 },
  f2_cola: { color: 0x2a1408, roughness: 0.1 },
  f2_can: { color: 0xb6bcc2, metalness: 0.7, roughness: 0.3 },
  f2_jcart: { color: 0xe0b11a, roughness: 0.5 }, // the janitor's cart
  f2_glove: { color: 0x4f86d6, roughness: 0.55 },
  f2_cherry: { color: 0x7a3f28, roughness: 0.55 },
  f2_towel: { color: 0x8db4c7, roughness: 1 },
  f2_khaki: { color: 0x7d7352, roughness: 0.8 }, // folding chairs / table frames
};
/** emissive materials this module adds (c.G.<name>): colour, intensity */
export const EXTRA_GLOW = {
  f2_cooler: [0xe8f4ff, 1.35], // a drinks cooler's lit inside
  f2_header: [0xff4a3a, 1.2], // its header box
  f2_pilot: [0x3aa0ff, 1.4],
  f2_dial: [0xffc04a, 1.3], // amber displays and radio dials
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
const rbox = (w, h, d, r = 0.02) => cached(`rb${r3(w)},${r3(h)},${r3(d)},${r3(r)}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.02, h / 2.02, d / 2.02)));
const boxG = (w, h, d) => cached(`bx${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
/** a centred cylinder along y: r0 at the bottom, r1 at the top */
const cylG = (r0, r1, h, seg = 12, open = false) => cached(`cy${r3(r0)},${r3(r1)},${r3(h)},${seg},${open}`, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open));
const sphG = (r, w = 8, h = 6) => cached(`sp${r3(r)},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const torG = (R, r, rs = 4, ts = 10, arc = PI * 2) => cached(`to${r3(R)},${r3(r)},${rs},${ts},${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const latheG = (key, pts, seg = 12) => cached(`la${key},${seg}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];
const jit = (c, k) => (c.rnd() - 0.5) * 2 * k;

// world face names of the local frame's sides: f front (+b), b back, r (+a), l (-a)
const WFACE = { s: { f: 'pz', b: 'nz', r: 'px', l: 'nx' }, n: { f: 'nz', b: 'pz', r: 'nx', l: 'px' }, e: { f: 'px', b: 'nx', r: 'nz', l: 'pz' }, w: { f: 'nx', b: 'px', r: 'pz', l: 'nz' } };
/** a local frame at (x, z) looking toward `face` (a letter, or a yaw): `a` runs across it, `b` toward its front */
function fr(x, z, face) {
  if (typeof face === 'number') return { x, z, yaw: face, cs: Math.cos(face), sn: Math.sin(face), face: null };
  const yaw = FACE_YAW[face];
  return { x, z, yaw, cs: Math.round(Math.cos(yaw)), sn: Math.round(Math.sin(yaw)), face };
}
const at = (f, a, b) => [f.x + a * f.cs + b * f.sn, f.z - a * f.sn + b * f.cs];
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
const Ca = (c, f, m, a, y, b, r, len, seg = 8) => A(c, f, m, cylG(r, r, len, seg), a, y, b, 0, 0, PI / 2);
const Cb = (c, f, m, a, y, b, r, len, seg = 8) => A(c, f, m, cylG(r, r, len, seg), a, y, b, PI / 2);
/** a collider over the local rect (any yaw: its bounding box) */
function col(c, f, a0, b0, a1, b1, y0, y1, surf = SURF.metal) {
  const p = [at(f, a0, b0), at(f, a1, b0), at(f, a0, b1), at(f, a1, b1)];
  c.col(Math.min(...p.map((q) => q[0])), y0, Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), y1, Math.max(...p.map((q) => q[1])), surf);
}
/** a text label facing the frame's front (cardinal frames); lines: a multi-line one */
function lbl(c, f, text, a, y, b, w, h, opts = {}) {
  const [x, z] = at(f, a, b);
  const t = Array.isArray(text) ? text.join(' / ') : text;
  c.label?.(t, x, y, z, f.face, w, h, Array.isArray(text) ? { ...opts, lines: text } : opts);
}
const _E = new THREE.Euler(), _Q = new THREE.Quaternion(), _Pv = new THREE.Vector3(), _Sv = new THREE.Vector3(), _Lm = new THREE.Matrix4(), _Mm = new THREE.Matrix4();
/**
 * A transform for something that may lie tipped over: parts in its own space (u across, y up, v forward), placed at
 * (x, y, z), turned `yaw`, then tilted rx (+ falls forward) / rz. Returns add(mat, geo, u, y, v, ax, ay, az, s).
 */
function grp(c, x, y, z, yaw, rx = 0, rz = 0) {
  const base = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), V(1, 1, 1));
  return (m, g, u, py, v, ax = 0, ay = 0, az = 0, s = null) => {
    _Lm.compose(_Pv.set(u, py, v), _Q.setFromEuler(_E.set(ax, ay, az, 'YXZ')), s ? _Sv.set(s[0], s[1], s[2]) : _Sv.set(1, 1, 1));
    return c.K.addMatrix(m, g, _Mm.multiplyMatrices(base, _Lm));
  };
}

// ---------------------------------------------------------------- the cafeteria
/** the moulded chair shell's profile (seat curving up into the back), extruded across: about 36 triangles */
const shellG = () => cached('shell', () => {
  const s = new THREE.Shape();
  const pts = [[0.22, 0.455], [-0.11, 0.465], [-0.16, 0.5], [-0.195, 0.62], [-0.22, 0.86], [-0.245, 0.858], [-0.22, 0.62], [-0.185, 0.485], [-0.125, 0.437], [0.215, 0.428]];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.44, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.22);
  g.rotateY(-PI / 2); // profile x → forward, the extrusion → across
  return g;
});
/** a moulded plastic chair (one curved shell on four splayed chrome legs) at (x, z), its sitter looking toward `yaw`; down: on its side */
export function shellChair(c, x, z, yaw, { down = false, mat = null } = {}) {
  const { X } = c;
  const m = mat ?? pick(c, [X.f2_shellRed, X.f2_shellTeal, X.f2_shellGrey]);
  const g = down ? grp(c, x, 0.235, z, yaw, jit(c, 0.15), c.rnd() < 0.5 ? PI / 2 : -PI / 2) : grp(c, x, 0, z, yaw);
  g(m, shellG(), 0, 0, 0);
  for (const s of [-1, 1]) {
    g(X.chrome, cylG(0.01, 0.01, 0.44, 5), s * 0.2, 0.215, 0.17, -0.1, 0, s * 0.05);
    g(X.chrome, cylG(0.01, 0.01, 0.44, 5), s * 0.2, 0.215, -0.13, 0.12, 0, s * 0.05);
    g(X.rubber, cylG(0.014, 0.014, 0.012, 5), s * 0.21, 0.006, 0.21);
  }
  g(X.chrome, cylG(0.008, 0.008, 0.38, 4), 0, 0.41, -0.1, 0, 0, PI / 2);
}
/**
 * A long canteen table at (x, z) (alongX: its length along x, else z): a laminate top with a dark edge band on two
 * T-legs, `chairs` moulded chairs a side (some pushed back, one or two knocked over, a few gone), trays and cups left.
 */
export function canteenTable(c, x, z, alongX, { len = 2.4, chairs = 3, messy = true, top = null, mat = null } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, alongX ? 's' : 'e');
  R(c, f, top ?? (rnd() < 0.7 ? X.f2_laminate : X.f2_mint), 0, 0.745, 0, len, 0.03, 0.8, 0.012);
  R(c, f, X.f2_edge, 0, 0.722, 0, len + 0.012, 0.022, 0.812, 0.008);
  for (const s of [-1, 1]) {
    const a = s * (len / 2 - 0.32);
    Cy(c, f, X.f2_edge, a, 0.05, 0, 0.035, 0.03, 0.66, 8);
    R(c, f, X.f2_edge, a, 0.032, 0, 0.07, 0.04, 0.68, 0.015);
    Cu(c, f, X.f2_edge, a, 0.69, 0, 0.05, 0.04, 0.64);
    for (const t of [-1, 1]) Cy(c, f, X.rubber, a, 0, t * 0.31, 0.022, 0.022, 0.012, 6);
  }
  Cu(c, f, X.f2_edge, 0, 0.69, 0, len - 0.7, 0.03, 0.06);
  const cm = mat ?? pick(c, [X.f2_shellRed, X.f2_shellTeal, X.f2_shellGrey]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < chairs; i++) {
      if (rnd() < 0.15) continue;
      const a = -len / 2 + (len * (i + 0.5)) / chairs + jit(c, 0.06);
      const out = rnd() < 0.3 ? 0.25 + rnd() * 0.3 : 0;
      const [cx, cz] = at(f, a, side * (0.6 + out));
      shellChair(c, cx, cz, f.yaw + (side > 0 ? PI : 0) + jit(c, out ? 0.6 : 0.1), { down: rnd() < 0.12, mat: cm });
    }
  }
  if (messy) {
    for (let i = 0; i < Math.round(len * 1.2); i++) {
      const [px, pz] = at(f, jit(c, len / 2 - 0.3), jit(c, 0.2));
      const k = rnd();
      if (k < 0.45) Fac.mealTray(c, px, 0.76, pz, rnd() * 6);
      else if (k < 0.75) Fac.mug(c, px, 0.76, pz);
      else if (k < 0.88) c.K.add(X.f2_can, cylG(0.033, 0.033, 0.12, 8), px, 0.82, pz);
      else c.K.add(X.f2_can, cylG(0.033, 0.033, 0.12, 8), px, 0.793, pz, [PI / 2, rnd() * 6, 0, 'YXZ']);
    }
  }
  col(c, f, -len / 2, -0.4, len / 2, 0.4, 0, 0.76, SURF.wood);
}
/**
 * A condiment station against the wall at (x, z) facing `face`: a laminate cabinet, a drinks dispenser, napkins,
 * a cutlery caddy, squeeze bottles, straws and a stack of paper cups; a "clear your tray" notice over it.
 */
export function condimentStation(c, x, z, face, { w = 1.6 } = {}) {
  const { X, M, U, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.92, d = 0.6;
  R(c, f, X.f2_laminate, 0, 0.5, d / 2, w, 0.8, d - 0.02, 0.015);
  B(c, f, X.stainless, -w / 2 + 0.02, 0, 0.02, w / 2 - 0.02, 0.1, d - 0.05, 'flr');
  R(c, f, X.f2_edge, 0, T - 0.015, d / 2, w + 0.02, 0.03, d + 0.02, 0.01);
  for (const s of [-1, 1]) {
    B(c, f, X.pale, s > 0 ? 0.01 : -w / 2 + 0.04, 0.14, d - 0.005, s > 0 ? w / 2 - 0.04 : -0.01, 0.84, d + 0.004, 'f');
    B(c, f, X.chrome, s * 0.06 - 0.01, 0.6, d + 0.004, s * 0.06 + 0.01, 0.78, d + 0.024, 'flrt');
  }
  Fac.drinkDispenser(c, ...atY(f, -w / 2 + 0.4, T, 0.33), face, { names: ['COLA', 'LEMON', 'WATER'] });
  // napkins, the cutlery caddy, sauces, straws, cups
  const a0 = -w / 2 + 0.85;
  R(c, f, X.chrome, a0, T + 0.07, 0.42, 0.13, 0.14, 0.1, 0.012);
  B(c, f, X.paper, a0 - 0.05, T + 0.1, 0.47, a0 + 0.05, T + 0.12, 0.48, 'ft');
  R(c, f, X.pale, a0 + 0.3, T + 0.05, 0.25, 0.36, 0.1, 0.13, 0.012);
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) A(c, f, X.chrome, boxG(0.012, 0.12, 0.004), a0 + 0.17 + i * 0.087 + k * 0.012, T + 0.14, 0.25 + jit(c, 0.02), jit(c, 0.15), 0, jit(c, 0.15));
  for (let i = 0; i < 4; i++) {
    const m = i % 2 ? X.f2_mustard : X.f2_sauce, [bx, bz] = at(f, a0 + 0.1 + i * 0.07, 0.48);
    if (i === 3 && rnd() < 0.6) {
      c.K.add(m, cylG(0.028, 0.03, 0.16, 8), bx + 0.04, T + 0.03, bz, [PI / 2, rnd() * 6, 0, 'YXZ']); // knocked over
      continue;
    }
    c.K.add(m, cylG(0.028, 0.03, 0.16, 8), bx, T + 0.08, bz);
    c.K.add(m, cylG(0.026, 0.004, 0.05, 8), bx, T + 0.185, bz);
  }
  Cy(c, f, U.glass, w / 2 - 0.3, T, 0.2, 0.05, 0.05, 0.24, 10);
  for (let i = 0; i < 9; i++) Cy(c, f, i % 3 ? M.white : M.red, w / 2 - 0.3 + jit(c, 0.03), T + 0.01, 0.2 + jit(c, 0.03), 0.004, 0.004, 0.27, 3);
  for (const k of [0, 1]) A(c, f, M.white, cylG(0.034, 0.045, 0.3 + k * 0.08, 10, true), w / 2 - 0.12, T + 0.15 + k * 0.04, 0.18 + k * 0.17, PI);
  lbl(c, f, ['PLEASE CLEAR', 'YOUR TRAY'], 0.25, 1.5, 0.004, 0.46, 0.24, { bg: '#f4f1e6', fg: '#1d4f7a', border: '#1d4f7a', font: 'bold 40px Arial' });
  col(c, f, -w / 2, 0, w / 2, d, 0, T, SURF.wood);
}
/**
 * A glass-door drinks cooler against the wall at (x, z) facing `face`: a coloured cabinet, a lit header with the
 * brand, wire shelves of bottles and cans (some taken), the inside lit (lit: false, dead and dark).
 */
export function drinksCooler(c, x, z, face, { w = 0.75, d = 0.7, h = 2.0, lit = true, brand = 'ICE COLD', mat = null } = {}) {
  const { X, M, U, G, rnd } = c;
  const f = fr(x, z, face);
  const m = mat ?? M.red;
  for (const s of [-1, 1]) B(c, f, m, s > 0 ? w / 2 - 0.05 : -w / 2, 0.1, 0, s > 0 ? w / 2 : -w / 2 + 0.05, h, d - 0.04, 'flrt');
  B(c, f, m, -w / 2 + 0.05, h - 0.3, 0, w / 2 - 0.05, h, d - 0.04, 'fdt');
  B(c, f, M.black, -w / 2 + 0.05, 0.1, 0, w / 2 - 0.05, 0.3, d - 0.04, 'ft');
  for (let i = 0; i < 4; i++) B(c, f, M.dark, -w / 2 + 0.1, 0.14 + i * 0.04, d - 0.04, w / 2 - 0.1, 0.16 + i * 0.04, d - 0.035, 'f');
  B(c, f, M.black, -w / 2 + 0.03, 0, 0.03, w / 2 - 0.03, 0.1, d - 0.08, 'flr');
  B(c, f, lit ? G.f2_header : X.charcoal, -w / 2 + 0.07, h - 0.27, d - 0.04, w / 2 - 0.07, h - 0.05, d - 0.035, 'f');
  lbl(c, f, brand, 0, h - 0.16, d - 0.03, w - 0.18, 0.16, { bg: lit ? '#d8261c' : '#5a1a16', fg: '#ffffff', font: 'bold italic 52px Arial' });
  B(c, f, lit ? G.f2_cooler : M.white, -w / 2 + 0.05, 0.3, 0.03, w / 2 - 0.05, h - 0.3, 0.04, 'f');
  // the shelves: bottles, a shelf of cans; looted gaps
  const drinks = [X.f2_cola, M.red, M.green, X.bottle, X.f2_mustard];
  for (let i = 0; i < 4; i++) {
    const y = 0.34 + i * 0.33;
    B(c, f, X.chrome, -w / 2 + 0.05, y, 0.06, w / 2 - 0.05, y + 0.012, d - 0.08, 't');
    const can = i === 3, n = can ? 6 : 5, mm = pick(c, drinks);
    for (let k = 0; k < n; k++) {
      if (rnd() < 0.22) continue;
      const a = -w / 2 + 0.1 + (k * (w - 0.2)) / (n - 1);
      if (can) Cy(c, f, X.f2_can, a, y + 0.012, d - 0.16, 0.032, 0.032, 0.12, 8);
      else {
        Cy(c, f, k % 2 ? mm : drinks[(i + k) % drinks.length], a, y + 0.012, d - 0.17, 0.032, 0.032, 0.17, 6);
        Cy(c, f, X.bottle, a, y + 0.182, d - 0.17, 0.03, 0.014, 0.07, 6);
      }
    }
  }
  // the door: a glass pane in a frame, a long handle
  B(c, f, U.glass, -w / 2 + 0.05, 0.32, d - 0.035, w / 2 - 0.05, h - 0.32, d - 0.025, 'f');
  B(c, f, X.charcoal, -w / 2 + 0.03, 0.3, d - 0.04, -w / 2 + 0.07, h - 0.3, d - 0.02, 'flrt');
  B(c, f, X.charcoal, w / 2 - 0.07, 0.3, d - 0.04, w / 2 - 0.03, h - 0.3, d - 0.02, 'flrt');
  Cy(c, f, X.chrome, w / 2 - 0.1, 0.75, d + 0.01, 0.012, 0.012, 0.6, 6);
  if (lit) c.light(...atY(f, 0, 1.1, d + 0.35), 0.25, 1.1, COLD, null, 2.6);
  col(c, f, -w / 2, 0, w / 2, d, 0, h, SURF.metal);
}
/**
 * A barricade of canteen tables at (x, z), w wide, knocked onto their sides with their tops toward `face` (where the
 * threat came from), chairs piled against the front and dropped behind it.
 */
export function tableBarricade(c, x, z, face, { w = 4.8 } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, face);
  const n = Math.max(1, Math.round(w / 2.45));
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + (w * (i + 0.5)) / n;
    const [tx, tz] = at(f, a, jit(c, 0.06));
    Fac.tippedTable(c, tx, tz, face, { w: w / n - 0.08, mat: rnd() < 0.6 ? X.f2_laminate : X.f2_mint });
    for (let k = 0; k < 2; k++) {
      const [cx, cz] = at(f, a + jit(c, w / n / 2 - 0.3), 0.3 + rnd() * 0.15);
      shellChair(c, cx, cz, rnd() * 6, { down: true });
    }
    const [bx, bz] = at(f, a + jit(c, 0.6), -1.05 - rnd() * 0.3);
    shellChair(c, bx, bz, f.yaw + PI + jit(c, 0.8), { down: rnd() < 0.5 });
  }
}

// ---------------------------------------------------------------- the kitchen
/** a twin-vat deep fryer against the wall at (x, z) facing `face`: oil wells, one basket down, one hung up to drain, a thermostat */
export function deepFryer(c, x, z, face, { w = 0.8, d = 0.8 } = {}) {
  const { X, M, G, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.92;
  B(c, f, X.stainless, -w / 2, 0.15, 0, w / 2, T - 0.02, d, 'flrt');
  for (const [s, t] of [[-1, 0.06], [1, 0.06], [-1, d - 0.06], [1, d - 0.06]]) Cy(c, f, X.stainless, s * (w / 2 - 0.05), 0, t, 0.025, 0.025, 0.15, 6);
  B(c, f, X.stainless, -w / 2, T - 0.02, 0, w / 2, T, d, 'flrt');
  B(c, f, X.stainless, -w / 2, T, 0, w / 2, T + 0.33, 0.12, 'flrt');
  for (let i = 0; i < 5; i++) B(c, f, M.black, -w / 2 + 0.08 + i * ((w - 0.16) / 5), T + 0.33, 0.03, -w / 2 + 0.12 + i * ((w - 0.16) / 5), T + 0.331, 0.09, 't');
  for (const s of [-1, 1]) {
    const a = s * w / 4;
    B(c, f, X.f2_oil, a - 0.15, T, 0.2, a + 0.15, T + 0.003, d - 0.08, 't');
    // the door below and its dial
    B(c, f, X.stainless, a - w / 4 + 0.02, 0.2, d, a + w / 4 - 0.02, 0.75, d + 0.01, 'f');
    Cb(c, f, M.black, a, 0.82, d + 0.02, 0.025, 0.035, 10);
    B(c, f, G.f2_dial, a + 0.06, 0.8, d, a + 0.075, 0.815, d + 0.004, 'f');
    // a basket: down in the oil (left) or hung on the back rail (right)
    const down = s < 0;
    const by = down ? T - 0.09 : T + 0.1;
    B(c, f, X.chrome, a - 0.13, by, 0.24, a + 0.13, by + 0.14, 0.52, 'flrbt');
    c.K.rod(X.chrome, V(...atY(f, a, by + 0.12, 0.52)), V(...atY(f, a, by + (down ? 0.2 : 0.12), 0.78)), 0.008, 4);
    Cb(c, f, M.black, a, by + (down ? 0.2 : 0.12), 0.84, 0.016, 0.12, 6);
  }
  lbl(c, f, 'FRYER 2  ·  180°C', 0, 0.86, d + 0.012, 0.3, 0.05, { bg: '#1b2127', fg: '#ffd27a', font: 'bold 34px Arial' });
  if (rnd() < 0.7) B(c, f, X.f2_grease, -w / 2 + 0.05, T + 0.003, 0.04, w / 2 - 0.05, T + 0.004, 0.19, 't');
  col(c, f, -w / 2, 0, w / 2, d, 0, T);
}
/** a combi steamer oven on its stand against the wall at (x, z) facing `face`: a glass door, a control strip, pans under it */
export function combiOven(c, x, z, face, { w = 0.9, d = 0.82 } = {}) {
  const { X, M, U, G } = c;
  const f = fr(x, z, face);
  for (const [s, t] of [[-1, 0.05], [1, 0.05], [-1, d - 0.05], [1, d - 0.05]]) Cy(c, f, X.stainless, s * (w / 2 - 0.04), 0, t, 0.022, 0.022, 0.7, 6);
  for (const y of [0.15, 0.66]) B(c, f, X.stainless, -w / 2 + 0.02, y, 0.02, w / 2 - 0.02, y + 0.03, d - 0.02, 'ftd');
  for (let i = 0; i < 3; i++) B(c, f, X.alu, -w / 2 + 0.08, 0.18 + i * 0.012, 0.1, w / 2 - 0.08, 0.19 + i * 0.012, d - 0.12, 'ft');
  R(c, f, X.stainless, 0, 1.12, d / 2, w, 0.84, d, 0.02);
  B(c, f, M.black, -w / 2 + 0.05, 0.8, d, w / 2 - 0.25, 1.46, d + 0.004, 'f');
  B(c, f, U.glass, -w / 2 + 0.08, 0.84, d + 0.004, w / 2 - 0.28, 1.42, d + 0.008, 'f');
  for (let i = 0; i < 5; i++) B(c, f, X.chrome, -w / 2 + 0.1, 0.9 + i * 0.11, 0.2, w / 2 - 0.3, 0.905 + i * 0.11, d - 0.06, 't');
  Cy(c, f, X.chrome, w / 2 - 0.29, 0.95, d + 0.05, 0.014, 0.014, 0.4, 6);
  B(c, f, X.charcoal, w / 2 - 0.22, 0.8, d, w / 2 - 0.04, 1.48, d + 0.008, 'f');
  B(c, f, G.f2_dial, w / 2 - 0.19, 1.34, d + 0.008, w / 2 - 0.07, 1.42, d + 0.01, 'f');
  for (const y of [1.18, 1.0]) Cb(c, f, X.chrome, w / 2 - 0.13, y, d + 0.02, 0.03, 0.03, 10);
  lbl(c, f, 'COMBI 10·1/1', -0.1, 1.5, d + 0.005, 0.3, 0.05, { bg: '#c4cacf', fg: '#1b2127', font: 'bold 34px Arial' });
  Cy(c, f, X.chrome, -w / 2 + 0.15, 1.54, 0.15, 0.045, 0.045, 0.12, 8);
  col(c, f, -w / 2, 0, w / 2, d + 0.03, 0, 1.54);
}
/**
 * The kitchen's hero: an 80 L tilting kettle at (x, z) facing `face` (its pouring lip): a steam-jacketed bowl on two
 * pedestals, the lid thrown open, a tilt handwheel, a swing spout, soup gone cold in it, a floor drain under the lip.
 */
export function tiltKettle(c, x, z, face, { r = 0.42 } = {}) {
  const { K, X, M, rnd } = c;
  const f = fr(x, z, face);
  const y0 = 0.42, rim = y0 + 0.58, pa = r + 0.17;
  for (const s of [-1, 1]) {
    R(c, f, X.stainless, s * pa, 0.48, 0, 0.18, 0.96, 0.34, 0.025);
    B(c, f, X.stainless, s * pa - 0.12, 0, -0.22, s * pa + 0.12, 0.03, 0.22, 'flrbt');
    Ca(c, f, X.chrome, s * (r + 0.04), y0 + 0.32, 0, 0.035, 0.1, 10);
  }
  A(c, f, X.stainless, latheG(`kettle${r3(r)}`, [[0, 0], [r * 0.55, 0.02], [r * 0.85, 0.1], [r, 0.26], [r, 0.56], [r + 0.03, 0.58]], 18), 0, y0, 0);
  A(c, f, X.stainless, latheG(`kettleIn${r3(r)}`, [[r - 0.015, 0.575], [r - 0.015, 0.4]], 18), 0, y0, 0);
  Cy(c, f, X.food, 0, y0 + 0.4, 0, r - 0.02, r - 0.02, 0.006, 18);
  A(c, f, X.stainless, torG(r + 0.02, 0.015, 4, 18), 0, rim, 0, PI / 2);
  // the pouring lip
  A(c, f, X.stainless, boxG(0.22, 0.05, 0.14), 0, rim - 0.04, r + 0.04, 0.35);
  // the lid, open back on its hinge
  const th = 1.3;
  const ly = rim + 0.02 + r * Math.sin(th), lb = -r + r * Math.cos(th), sn = Math.sin(th), cs = Math.cos(th);
  A(c, f, X.stainless, cylG(r + 0.03, r + 0.03, 0.03, 18), 0, ly, lb, -th);
  A(c, f, M.black, boxG(0.18, 0.03, 0.04), 0, ly + (r - 0.06) * sn + 0.03 * cs, lb + (r - 0.06) * cs - 0.03 * sn, -th);
  // the tilt handwheel on the right pedestal
  const [wx, wz] = at(f, pa + 0.12, 0.05);
  K.add(X.chrome, torG(0.15, 0.012, 4, 14), wx, 0.92, wz, [0, f.yaw + PI / 2, 0]);
  for (let i = 0; i < 3; i++) A(c, f, X.chrome, boxG(0.012, 0.3, 0.012), pa + 0.12, 0.92, 0.05, i * PI / 3);
  Ca(c, f, M.black, pa + 0.15, 0.92 + 0.15, 0.05, 0.016, 0.08, 6);
  // the swing spout on the left pedestal's back
  Cy(c, f, X.chrome, -pa, 0.96, -0.12, 0.016, 0.016, 0.5, 6);
  K.rod(X.chrome, V(...atY(f, -pa, 1.46, -0.12)), V(...atY(f, -0.15, 1.46, -0.05)), 0.014, 6);
  Cy(c, f, X.chrome, -0.15, 1.36, -0.05, 0.012, 0.012, 0.1, 6);
  lbl(c, f, ['TILT KETTLE 80 L', 'STEAM · HOT SURFACE'], -pa, 0.62, 0.172, 0.17, 0.12, { bg: '#d6a31a', fg: '#16181a', font: 'bold 30px Arial' });
  // the jacket's pressure gauge
  Cb(c, f, X.chrome, -pa, 0.86, 0.175, 0.055, 0.012, 14);
  K.plane(M.signs, 0.095, 0.095, ...atY(f, -pa, 0.86, 0.182), [0, f.yaw, 0], SIGN.gauge, 1024, 1024);
  Fac.floorDrain(c, ...at(f, 0, r + 0.45), 0.36);
  if (rnd() < 0.8) c.decal?.('puddle', ...at(f, 0.1, r + 0.55), 0.9, rnd() * 6);
  col(c, f, -pa - 0.13, -r - 0.05, pa + 0.25, r + 0.1, 0, rim);
}
/** an ice machine on its storage bin against the wall at (x, z) facing `face`: a louvred head, the bin's flap, a scoop on a hook */
export function iceMachine(c, x, z, face, { w = 0.76, d = 0.75 } = {}) {
  const { X, M, G } = c;
  const f = fr(x, z, face);
  for (const [s, t] of [[-1, 0.06], [1, 0.06], [-1, d - 0.06], [1, d - 0.06]]) Cy(c, f, X.stainless, s * (w / 2 - 0.05), 0, t, 0.022, 0.022, 0.1, 6);
  R(c, f, X.stainless, 0, 0.53, d / 2, w, 0.86, d, 0.02);
  A(c, f, X.stainless, boxG(w - 0.12, 0.36, 0.02), 0, 0.72, d + 0.02, -0.18);
  Ca(c, f, M.black, 0, 0.9, d + 0.06, 0.016, w - 0.3, 6);
  B(c, f, M.dark, -w / 2 + 0.06, 0.12, d, w / 2 - 0.06, 0.48, d + 0.004, 'f');
  R(c, f, X.stainless, 0, 1.31, d / 2 - 0.02, w, 0.68, d - 0.04, 0.02);
  for (let i = 0; i < 6; i++) B(c, f, M.black, -w / 2 + 0.08, 1.1 + i * 0.045, d - 0.04, w / 2 - 0.08, 1.12 + i * 0.045, d - 0.035, 'f');
  B(c, f, G.f2_pilot, w / 2 - 0.12, 1.55, d - 0.04, w / 2 - 0.08, 1.57, d - 0.035, 'f');
  lbl(c, f, 'ICE · USE SCOOP ONLY', -0.05, 1.56, d - 0.033, 0.4, 0.06, { bg: '#1d4f7a', fg: '#ffffff', font: 'bold 32px Arial' });
  // the scoop on its hook on the side
  const [sx, sz] = at(f, w / 2 + 0.01, d / 2);
  c.K.add(X.chrome, boxG(0.04, 0.04, 0.02), sx, 1.0, sz, [0, f.yaw, 0]);
  A(c, f, X.pale, rbox(0.06, 0.2, 0.1, 0.03), w / 2 + 0.05, 0.88, d / 2);
  col(c, f, -w / 2, 0, w / 2, d + 0.04, 0, 1.65);
}
/** a stainless hand-wash sink on the wall at (x, z) facing `face`: knee valves, a gooseneck, soap, a towel dispenser, the sign */
export function handSink(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.stainless, 0, 0.8, 0.2, 0.46, 0.16, 0.38, 0.02);
  B(c, f, M.dark, -0.17, 0.879, 0.07, 0.17, 0.881, 0.33, 't');
  B(c, f, X.stainless, -0.23, 0.88, 0, 0.23, 1.1, 0.03, 'flrt');
  Cy(c, f, X.chrome, 0, 0.88, 0.06, 0.012, 0.012, 0.3, 6);
  A(c, f, X.chrome, torG(0.06, 0.01, 4, 8, PI), 0, 1.18, 0.12, 0, PI / 2);
  for (const s of [-1, 1]) B(c, f, X.chrome, s * 0.08 - 0.03, 0.55, 0.3, s * 0.08 + 0.03, 0.62, 0.38, 'flrt');
  Cy(c, f, X.chrome, 0, 0.36, 0.14, 0.02, 0.02, 0.36, 6);
  R(c, f, X.pale, -0.33, 1.3, 0.06, 0.1, 0.2, 0.1, 0.02);
  Fac.paperTowelDispenser(c, ...atY(f, 0.42, 1.35, 0), face, { bin: false });
  lbl(c, f, ['EMPLOYEES MUST', 'WASH HANDS'], 0, 1.68, 0.003, 0.36, 0.2, { bg: '#ffffff', fg: '#1f5fa6', border: '#1f5fa6', font: 'bold 36px Arial' });
  col(c, f, -0.23, 0, 0.23, 0.39, 0.72, 0.88);
}
/** a big round kitchen bin (grey, a bag liner over the rim) on a castor dolly at (x, z); tipped: on its side, rubbish out */
export function kitchenBin(c, x, z, { tipped = false, yaw = 0, mat = null } = {}) {
  const { K, X, rnd } = c;
  const m = mat ?? X.f2_binGrey;
  const prof = latheG('brute', [[0, 0], [0.24, 0], [0.27, 0.66], [0.285, 0.68]], 14);
  if (tipped) {
    const f = fr(x, z, yaw);
    A(c, f, m, prof, 0, 0.3, -0.34, PI / 2);
    A(c, f, X.f2_binBag, torG(0.27, 0.02, 4, 14), 0, 0.3, 0.33);
    for (let i = 0; i < 6; i++) K.add(pick(c, [X.f2_binBag, X.paper, X.food, X.kraft]), sphG(0.08 + rnd() * 0.06, 6, 4), ...atY(f, jit(c, 0.35), 0.09, 0.45 + rnd() * 0.6), [rnd(), rnd(), 0], [1, 0.6, 1.2]);
    c.decal?.('stain', ...at(f, 0, 0.7), 1.0, rnd() * 6);
    col(c, f, -0.29, -0.34, 0.29, 0.34, 0, 0.6, SURF.cardboard);
    return;
  }
  K.add(X.charcoal, cylG(0.3, 0.3, 0.05, 14), x, 0.06, z);
  for (let i = 0; i < 4; i++) K.add(X.rubber, cylG(0.03, 0.03, 0.03, 6), x + Math.sin(i * PI / 2 + 0.8) * 0.24, 0.03, z + Math.cos(i * PI / 2 + 0.8) * 0.24, [0, 0, PI / 2]);
  K.add(m, prof, x, 0.11, z);
  K.add(X.f2_binBag, torG(0.275, 0.02, 4, 14), x, 0.78, z, [PI / 2, 0, 0]);
  K.add(X.f2_binBag, cylG(0.26, 0.26, 0.01, 12), x, 0.68, z);
  for (const s of [-1, 1]) K.add(m, boxG(0.12, 0.04, 0.05), x + Math.sin(yaw) * s * 0.29, 0.74, z + Math.cos(yaw) * s * 0.29, [0, yaw, 0]);
  c.col(x - 0.3, 0, z - 0.3, x + 0.3, 0.8, z + 0.3, SURF.cardboard);
}
/** a stock pot dropped on its side at (x, z) turned `yaw`, the lid rolled off, a ladle, the soup across the floor */
export function spilledPot(c, x, z, yaw = 0) {
  const { X, M, rnd } = c;
  const f = fr(x, z, yaw);
  A(c, f, X.stainless, cylG(0.2, 0.2, 0.34, 14, true), 0, 0.2, 0, PI / 2);
  A(c, f, X.stainless, cylG(0.2, 0.2, 0.01, 14), 0, 0.2, -0.17, PI / 2);
  A(c, f, X.stainless, latheG('potIn', [[0.19, 0.17], [0.19, -0.16]], 14), 0, 0.2, 0, PI / 2);
  for (const s of [-1, 1]) A(c, f, X.stainless, torG(0.035, 0.008, 3, 6, PI), s * 0.21, 0.2, 0.1, 0, 0, s * PI / 2);
  A(c, f, X.stainless, cylG(0.21, 0.19, 0.025, 14), 0.5, 0.024, 0.75, 0.04, 0, 0.03);
  Cy(c, f, M.black, 0.5, 0.025, 0.75, 0.03, 0.03, 0.03, 6);
  c.K.rod(X.stainless, V(...atY(f, -0.45, 0.01, 0.5)), V(...atY(f, -0.2, 0.03, 0.9)), 0.008, 4);
  A(c, f, X.stainless, sphG(0.05, 8, 4), -0.48, 0.05, 0.45, 0, 0, 0, [1, 0.5, 1]);
  c.decal?.('puddle', ...at(f, 0, 0.75), 1.5, rnd() * 6);
  c.decal?.('oil', ...at(f, 0.3, 1.2), 1.0, rnd() * 6);
  col(c, f, -0.2, -0.2, 0.2, 0.2, 0, 0.4);
}
/** a hood-type dish machine against the wall at (x, z) facing `face`: the hood up, a rack of plates in it, the control box */
export function dishwasher(c, x, z, face, { w = 0.72, d = 0.72 } = {}) {
  const { X, M, G, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.stainless, -w / 2, 0.15, 0, w / 2, 0.85, d, 'flrt');
  for (const [s, t] of [[-1, 0.06], [1, 0.06], [-1, d - 0.06], [1, d - 0.06]]) Cy(c, f, X.stainless, s * (w / 2 - 0.05), 0, t, 0.022, 0.022, 0.15, 6);
  // the hood, raised: three walls round the rack
  const hy = 1.32;
  B(c, f, X.stainless, -w / 2, hy, 0.02, w / 2, hy + 0.62, 0.05, 'flrt');
  for (const s of [-1, 1]) B(c, f, X.stainless, s > 0 ? w / 2 - 0.03 : -w / 2, hy, 0.05, s > 0 ? w / 2 : -w / 2 + 0.03, hy + 0.62, d, 'flrt');
  B(c, f, X.stainless, -w / 2, hy + 0.62, 0, w / 2, hy + 0.65, d, 'flrtd');
  B(c, f, X.stainless, -w / 2, hy - 0.03, d - 0.04, w / 2, hy + 0.04, d, 'flrtd');
  Ca(c, f, X.chrome, 0, hy - 0.06, d + 0.06, 0.014, w - 0.1, 6);
  for (const s of [-1, 1]) Cy(c, f, X.chrome, s * (w / 2 - 0.08), 0.85, 0.1, 0.02, 0.02, hy - 0.85, 6);
  // the rack on the wash deck
  B(c, f, X.chrome, -w / 2 + 0.08, 0.86, 0.1, w / 2 - 0.08, 0.95, d - 0.1, 'flrb');
  for (let i = 0; i < 7; i++) if (rnd() < 0.8) A(c, f, M.white, cylG(0.11, 0.11, 0.012, 12), -0.21 + i * 0.07, 0.98, d / 2, 0, PI / 2, PI / 2);
  R(c, f, X.charcoal, w / 2 - 0.12, hy + 0.85, 0.08, 0.2, 0.26, 0.12, 0.015);
  B(c, f, G.f2_dial, w / 2 - 0.18, hy + 0.9, 0.14, w / 2 - 0.06, hy + 0.94, 0.141, 'f');
  lbl(c, f, ['WASH 60° · RINSE 82°', 'CHECK TEMP EVERY CYCLE'], 0, 0.6, d + 0.003, 0.4, 0.12, { bg: '#ffffff', fg: '#1b2127', border: '#c63a2e', font: 'bold 28px Arial' });
  // the wash and rinse thermometers
  for (const s of [-1, 1]) {
    Cb(c, f, X.chrome, s * 0.12, 0.76, d + 0.004, 0.045, 0.008, 12);
    c.K.plane(M.signs, 0.075, 0.075, ...atY(f, s * 0.12, 0.76, d + 0.009), [0, f.yaw, 0], SIGN.gauge, 1024, 1024);
  }
  col(c, f, -w / 2, 0, w / 2, d + 0.08, 0, hy + 0.65);
}

// ---------------------------------------------------------------- restrooms and lockers
/** a wall-hung urinal at (x, z) facing `face`: the vitreous bowl, a flush valve, a blue cake, a privacy divider on its right (divider) */
export function urinal(c, x, z, face, { divider = true } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.f2_china, 0, 0.76, 0.16, 0.36, 0.64, 0.3, 0.07);
  B(c, f, X.f2_solid, -0.12, 0.52, 0.305, 0.12, 0.96, 0.311, 'f');
  B(c, f, M.blue, -0.05, 0.47, 0.18, 0.05, 0.49, 0.27, 'flrt');
  Cy(c, f, X.chrome, 0, 1.08, 0.08, 0.017, 0.017, 0.28, 6);
  Cb(c, f, X.chrome, 0, 1.25, 0.06, 0.03, 0.1, 8);
  A(c, f, X.chrome, boxG(0.012, 0.08, 0.012), 0.04, 1.25, 0.11, 0, 0, 0.6);
  Cy(c, f, X.chrome, 0, 0.3, 0.1, 0.02, 0.02, 0.15, 6);
  if (divider) {
    B(c, f, X.partition, 0.4, 0.45, 0.02, 0.425, 1.6, 0.52, 'flrt');
    B(c, f, X.alu, 0.395, 1.0, 0, 0.43, 1.1, 0.04, 'flrt');
    col(c, f, 0.39, 0.02, 0.435, 0.52, 0.45, 1.6, SURF.wood);
  }
  col(c, f, -0.18, 0, 0.18, 0.32, 0.44, 1.08, SURF.glass);
}
/**
 * A washroom vanity on the wall at (x, z) facing `face`, w long: a solid-surface top with `basins` sunk basins, taps,
 * soap pumps, the traps under it, one long mirror over it (cracked).
 */
export function vanity(c, x, z, face, { w = 2.0, basins = 2, cracked = false } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.f2_solid, -w / 2, 0.84, 0, w / 2, 0.88, 0.55, 'flrtd');
  B(c, f, X.f2_solid, -w / 2, 0.74, 0.52, w / 2, 0.84, 0.55, 'flrtd');
  B(c, f, X.f2_solid, -w / 2, 0.88, 0, w / 2, 0.98, 0.02, 'flrt');
  for (let i = 0; i <= basins; i++) B(c, f, X.alu, -w / 2 + 0.05 + (i * (w - 0.1)) / basins - 0.015, 0.6, 0.02, -w / 2 + 0.05 + (i * (w - 0.1)) / basins + 0.015, 0.84, 0.45, 'lrd');
  for (let i = 0; i < basins; i++) {
    const a = -w / 2 + (w * (i + 0.5)) / basins;
    A(c, f, X.f2_china, cylG(0.2, 0.2, 0.004, 16), a, 0.881, 0.3, 0, 0, 0, [1, 1, 0.7]);
    Cy(c, f, M.dark, a, 0.883, 0.32, 0.025, 0.025, 0.002, 8);
    Cy(c, f, X.chrome, a, 0.88, 0.07, 0.018, 0.015, 0.16, 6);
    Cb(c, f, X.chrome, a, 1.02, 0.12, 0.011, 0.11, 6);
    Cy(c, f, X.chrome, a + 0.22, 0.88, 0.1, 0.025, 0.025, 0.08, 8);
    Cy(c, f, X.charcoal, a + 0.22, 0.96, 0.1, 0.008, 0.008, 0.05, 4);
    Cy(c, f, X.chrome, a, 0.4, 0.3, 0.02, 0.02, 0.44, 6);
    Cb(c, f, X.chrome, a, 0.42, 0.15, 0.02, 0.3, 6);
    if (rnd() < 0.4) A(c, f, X.paper, sphG(0.05, 6, 4), a + jit(c, 0.1), 0.9, 0.3, rnd(), rnd(), 0, [1, 0.6, 1.2]);
  }
  Fac.mirror(c, x, 1.55, z, face, { w: w - 0.1, h: 0.85, cracked });
  col(c, f, -w / 2, 0, w / 2, 0.55, 0.74, 0.88, SURF.concrete);
}
/** a janitor's floor sink in the corner at (x, z) facing `face`: a low china basin, a tap with a hose, a tool rack with mop and broom */
export function mopSink(c, x, z, face) {
  const { K, X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.f2_china, -0.3, 0, 0, 0.3, 0.3, 0.6, 'flrt');
  B(c, f, M.dark, -0.25, 0.301, 0.05, 0.25, 0.302, 0.55, 't');
  B(c, f, X.stainless, -0.3, 0.27, 0.57, 0.3, 0.31, 0.62, 'flrt');
  for (const s of [-1, 1]) Cb(c, f, X.chrome, s * 0.1, 0.9, 0.04, 0.012, 0.08, 6);
  Ca(c, f, X.chrome, 0, 0.9, 0.08, 0.016, 0.26, 6);
  Cb(c, f, X.chrome, 0, 0.86, 0.12, 0.015, 0.1, 6);
  for (let i = 0; i < 4; i++) K.rod(M.red, V(...atY(f, 0.02 * i, 0.84 - i * 0.16, 0.16 + i * 0.03)), V(...atY(f, 0.02 * (i + 1), 0.68 - i * 0.16, 0.19 + i * 0.03)), 0.014, 5);
  B(c, f, X.alu, -0.45, 1.45, 0, 0.45, 1.5, 0.05, 'flrtd');
  for (const [a, m, head] of [[-0.35, X.alu, X.cream], [0.36, X.f2_cherry, M.dark]]) {
    K.rod(m, V(...atY(f, a, 0.08, 0.14)), V(...atY(f, a + 0.02, 1.55, 0.05)), 0.012, 5);
    A(c, f, head, head === X.cream ? cylG(0.05, 0.09, 0.18, 7) : boxG(0.28, 0.06, 0.06), a, head === X.cream ? 0.09 : 0.03, 0.14);
  }
  Cy(c, f, X.pale, 0.2, 0.31, 0.45, 0.05, 0.05, 0.25, 8);
  Cy(c, f, M.red, 0.2, 0.56, 0.45, 0.02, 0.02, 0.04, 6);
  col(c, f, -0.3, 0, 0.3, 0.62, 0, 0.31, SURF.concrete);
}
/** a janitor's cart at (x, z) turned `yaw`: yellow shelves, a bin bag on its frame, sprays, toilet rolls, a bucket, gloves */
export function janitorCart(c, x, z, yaw = 0) {
  const { X, M, rnd } = c;
  const f = fr(x, z, yaw);
  for (const y of [0.12, 0.5, 0.86]) R(c, f, X.f2_jcart, 0.2, y, 0, 0.62, 0.04, 0.46, 0.015);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    Cy(c, f, X.f2_jcart, 0.2 + s * 0.28, 0.1, t * 0.2, 0.018, 0.018, 0.78, 6);
    A(c, f, X.rubber, cylG(0.035, 0.035, 0.025, 6), 0.2 + s * 0.28, 0.035, t * 0.2, 0, 0, PI / 2);
  }
  // the bag frame and its bag at the -a end
  for (const t of [-1, 1]) Cy(c, f, X.charcoal, -0.12, 0.1, t * 0.18, 0.012, 0.012, 0.85, 5);
  R(c, f, X.f2_binBag, -0.3, 0.52, 0, 0.36, 0.78, 0.36, 0.1);
  Cu(c, f, X.charcoal, -0.3, 0.935, 0, 0.36, 0.03, 0.36);
  for (let i = 0; i < 4; i++) {
    const a = 0.0 + i * 0.12, m = pick(c, [M.blue, M.green, M.yellow, X.pale]);
    Cy(c, f, m, a, 0.88, -0.1, 0.035, 0.035, 0.2, 7);
    Cu(c, f, M.white, a, 1.12, -0.1, 0.03, 0.06, 0.06);
  }
  for (let i = 0; i < 3; i++) Ca(c, f, X.paper, 0.1 + i * 0.16, 0.6, 0.1, 0.055, 0.1, 8);
  Cy(c, f, M.blue, 0.38, 0.14, 0.06, 0.13, 0.15, 0.25, 10);
  if (rnd() < 0.7) R(c, f, X.f2_glove, 0.3, 0.92, 0.12, 0.12, 0.06, 0.16, 0.01);
  col(c, f, -0.48, -0.24, 0.5, 0.24, 0, 0.95, SURF.cardboard);
}
/** a PPE dispenser on the wall at (x, y, z) facing `face`: an acrylic rack of glove boxes (S M L), shoe covers under it */
export function ppeDispenser(c, x, y, z, face) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  B(c, f, U.glass, -0.42, y - 0.08, 0, 0.42, y + 0.08, 0.11, 'flrt');
  ['S', 'M', 'L'].forEach((s, i) => {
    const a = -0.27 + i * 0.27;
    B(c, f, X.paper, a - 0.125, y - 0.065, 0.01, a + 0.125, y + 0.065, 0.1, 'flrt');
    B(c, f, X.f2_glove, a - 0.126, y - 0.02, 0.01, a + 0.126, y + 0.02, 0.101, 'f');
    lbl(c, f, `NITRILE  ${s}`, a, y + 0.04, 0.102, 0.2, 0.035, { bg: '#ffffff', fg: '#1f5fa6', font: 'bold 30px Arial' });
    A(c, f, X.f2_glove, boxG(0.06, 0.05, 0.01), a, y - 0.09, 0.08, 0.3, 0, (i - 1) * 0.3);
  });
  B(c, f, M.blue, -0.2, y - 0.4, 0, 0.2, y - 0.2, 0.18, 'flrt');
  lbl(c, f, 'SHOE COVERS', 0, y - 0.3, 0.182, 0.3, 0.06, { bg: '#ffffff', fg: '#1d2b3a', font: 'bold 30px Arial' });
}
/** a rolling garment rail at (x, z) along the `face` side's width (w), `n` clean lab coats on it, a tag */
export function garmentRail(c, x, z, face, { w = 1.4, n = 6 } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, face);
  for (const s of [-1, 1]) {
    Cy(c, f, X.chrome, s * w / 2, 0.08, 0, 0.016, 0.016, 1.68, 6);
    B(c, f, X.chrome, s * w / 2 - 0.02, 0.05, -0.28, s * w / 2 + 0.02, 0.08, 0.28, 'flrbt');
    for (const t of [-1, 1]) A(c, f, X.rubber, cylG(0.03, 0.03, 0.025, 6), s * w / 2, 0.03, t * 0.26, 0, 0, PI / 2);
  }
  Ca(c, f, X.chrome, 0, 1.76, 0, 0.014, w, 6);
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + 0.15 + (i * (w - 0.3)) / Math.max(1, n - 1) + jit(c, 0.03);
    const [hx, hz] = at(f, a, 0);
    Fac.coat(c, hx, 1.74, hz, f.yaw + PI / 2 + jit(c, 0.15), rnd() < 0.85 ? X.labcoat : X.navy, { long: true });
  }
  lbl(c, f, 'CLEAN · SIZE M/L', -w / 2 + 0.12, 1.62, 0.02, 0.16, 0.06, { bg: '#fdfcf4', fg: '#1d2b3a', font: 'bold 26px Arial' });
  col(c, f, -w / 2 - 0.03, -0.28, w / 2 + 0.03, 0.28, 0, 1.78, SURF.cardboard);
}

// ---------------------------------------------------------------- the sleeping quarters
/** a steel folding chair at (x, z), its sitter looking toward `yaw` (down: on its side) */
export function foldingChair(c, x, z, yaw, { down = false, mat = null } = {}) {
  const { X } = c;
  const m = mat ?? X.f2_khaki;
  const g = down ? grp(c, x, 0.22, z, yaw, jit(c, 0.1), PI / 2) : grp(c, x, 0, z, yaw);
  g(m, rbox(0.42, 0.03, 0.4, 0.012), 0, 0.46, 0.02);
  g(m, rbox(0.4, 0.2, 0.025, 0.01), 0, 0.78, -0.2, -0.08);
  for (const s of [-1, 1]) {
    g(m, cylG(0.011, 0.011, 0.9, 5), s * 0.2, 0.45, -0.19, -0.08);
    g(m, cylG(0.011, 0.011, 0.5, 5), s * 0.19, 0.24, 0.12, -0.35);
    g(X.rubber, cylG(0.014, 0.014, 0.012, 5), s * 0.2, 0.006, -0.15);
  }
  g(m, cylG(0.008, 0.008, 0.38, 4), 0, 0.12, 0.2, 0, 0, PI / 2);
}
/** a folding card table at (x, z): a felt top, cards mid-game, chips, an ashtray, mugs; folding chairs round it */
export function cardTable(c, x, z, { chairs = 3, s = 0.8 } = {}) {
  const { K, X, M, rnd } = c;
  const f = fr(x, z, 's');
  R(c, f, X.f2_cherry, 0, 0.725, 0, s, 0.03, s, 0.012);
  B(c, f, X.f2_felt, -s / 2 + 0.04, 0.74, -s / 2 + 0.04, s / 2 - 0.04, 0.742, s / 2 - 0.04, 't');
  for (const [p, q] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) Cy(c, f, X.charcoal, p * (s / 2 - 0.05), 0, q * (s / 2 - 0.05), 0.012, 0.012, 0.71, 5);
  // cards: a deck, hands put down, a few face up in the middle
  R(c, f, X.f2_cardBack, 0.18, 0.76, -0.2, 0.065, 0.03, 0.09, 0.004);
  for (let i = 0; i < 9; i++) A(c, f, i < 4 ? X.paper : X.f2_cardBack, boxG(0.065, 0.002, 0.09), jit(c, 0.25), 0.744 + i * 0.002, jit(c, 0.25), 0, rnd() * 3, 0);
  for (let i = 0; i < 5; i++) {
    const n = 2 + Math.floor(rnd() * 5);
    Cy(c, f, pick(c, [M.red, M.blue, M.white, X.charcoal]), jit(c, 0.28), 0.742, jit(c, 0.28), 0.019, 0.019, n * 0.004, 8);
  }
  Cy(c, f, X.alu, -0.25, 0.742, 0.22, 0.06, 0.07, 0.025, 10);
  for (let i = 0; i < 3; i++) A(c, f, X.paper, cylG(0.004, 0.004, 0.04, 4), -0.25 + jit(c, 0.03), 0.765, 0.22 + jit(c, 0.03), PI / 2, rnd() * 6, 0);
  for (let i = 0; i < 2; i++) Fac.mug(c, ...atY(f, jit(c, 0.3), 0.742, jit(c, 0.3)));
  if (rnd() < 0.7) K.add(X.f2_can, cylG(0.033, 0.033, 0.12, 8), ...atY(f, 0.3, 0.742 + 0.033, -0.05), [PI / 2, rnd() * 6, 0, 'YXZ']);
  for (let i = 0; i < chairs; i++) {
    const a = (i / chairs) * PI * 2 + jit(c, 0.3) + 0.4, dd = s / 2 + 0.25 + rnd() * 0.15;
    foldingChair(c, x + Math.sin(a) * dd, z + Math.cos(a) * dd, a + PI + jit(c, 0.3), { down: i === 0 && rnd() < 0.6 });
  }
  c.col(x - s / 2, 0, z - s / 2, x + s / 2, 0.75, z + s / 2, SURF.wood);
}
/** a portable radio on a surface at (x, y, z) facing `yaw`: two speaker cones, a lit dial, a handle, the aerial up */
export function radio(c, x, y, z, yaw = 0) {
  const { K, X, M, G } = c;
  const f = fr(x, z, yaw);
  R(c, f, X.charcoal, 0, y + 0.1, 0, 0.36, 0.2, 0.1, 0.02);
  for (const s of [-1, 1]) {
    Cb(c, f, X.chrome, s * 0.11, y + 0.09, 0.05, 0.062, 0.004, 12);
    Cb(c, f, M.black, s * 0.11, y + 0.09, 0.053, 0.055, 0.004, 12);
  }
  Cu(c, f, G.f2_dial, 0, y + 0.17, 0.0505, 0.1, 0.02, 0.002);
  A(c, f, X.charcoal, torG(0.1, 0.01, 3, 8, PI), 0, y + 0.2, 0);
  K.rod(X.chrome, V(...atY(f, 0.15, y + 0.2, -0.03)), V(...atY(f, 0.27, y + 0.55, -0.06)), 0.004, 3);
}
/** a short wooden wall shelf at (x, y, z) facing `face` with someone's things: books, a framed photo, a mug, a can */
export function wallShelf(c, x, y, z, face, { w = 0.8, photo = null } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.f2_cherry, -w / 2, y - 0.025, 0, w / 2, y, 0.22, 'flrtd');
  for (const s of [-1, 1]) A(c, f, X.charcoal, boxG(0.02, 0.15, 0.15), s * (w / 2 - 0.08), y - 0.1, 0.08, 0.6);
  let a = -w / 2 + 0.04;
  for (let i = 0; i < 4 + Math.floor(rnd() * 3); i++) {
    const t = 0.025 + rnd() * 0.03, hh = 0.16 + rnd() * 0.07;
    B(c, f, pick(c, [M.red, M.blue, X.navy, X.olive, X.cream, M.green]), a, y, 0.03, a + t, y + hh, 0.19, 'flrt');
    a += t + 0.004;
  }
  A(c, f, X.walnut, boxG(0.16, 0.2, 0.015), w / 2 - 0.2, y + 0.1, 0.08);
  lbl(c, f, photo ?? ['♥'], w / 2 - 0.2, y + 0.1, 0.0885, 0.12, 0.15, { bg: '#c9b48e', fg: '#5a3d22', font: 'bold 40px Georgia, serif' });
  Fac.mug(c, ...atY(f, a + 0.08, y, 0.11));
}

// ---------------------------------------------------------------- the rooms
/** a round canteen table (hiveFacility's) with `n` moulded chairs round it, one maybe knocked over */
function roundSet(c, x, z, { r = 0.45, n = 4, mat = null } = {}) {
  const { X, rnd } = c;
  Fac.roundTable(c, x, z, { r, chairs: 0, messy: true });
  const m = mat ?? pick(c, [X.f2_shellRed, X.f2_shellTeal, X.f2_shellGrey]);
  const spin = rnd() * PI;
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * PI * 2 + jit(c, 0.3), dd = r + 0.22 + rnd() * 0.3;
    shellChair(c, x + Math.sin(a) * dd, z + Math.cos(a) * dd, a + PI + jit(c, 0.4), { down: rnd() < 0.15, mat: m });
  }
}
/** a meal tray dropped on the floor at (x, z): upside down or spilled, the plate beside it, food smeared */
function droppedTray(c, x, z) {
  const { K, M, X, rnd } = c;
  const yaw = rnd() * 6;
  K.add(M.tray, rbox(0.44, 0.02, 0.32, 0.008), x, 0.012, z, [jit(c, 0.04), yaw, jit(c, 0.04), 'YXZ']);
  const px = x + Math.sin(yaw) * 0.35, pz = z + Math.cos(yaw) * 0.35;
  K.add(M.white, cylG(0.1, 0.11, 0.018, 12), px, 0.009, pz);
  K.add(pick(c, [X.food, X.foodGreen, X.foodPale]), sphG(0.06, 6, 4), px + jit(c, 0.2), 0.012, pz + jit(c, 0.2), [0, rnd() * 6, 0], [1, 0.25, 1.3]);
  if (rnd() < 0.6) K.add(M.white, cylG(0.04, 0.035, 0.1, 10), x - Math.sin(yaw) * 0.4, 0.04, z - Math.cos(yaw) * 0.4, [PI / 2, rnd() * 6, 0, 'YXZ']);
  c.decal?.('stain', px, pz, 0.6 + rnd() * 0.4, rnd() * 6);
}
/**
 * The cafeteria: the serving line along the south wall (its bare west end holds a pickup, the kitchen door's
 * pass-through west of it), the menu and a lockdown notice on the TV; long tables down the west side, round tables
 * north, and across the middle a barricade of tipped tables where the staff made a stand: trays and food dropped
 * behind it, a blood trail to the kitchen. The condiment station, coolers and vending machines round the walls.
 */
export function dressCafe(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the serving line (the pickup lies on its bare west end, x 17.6..18.4), the tray return at its exit
  Fac.servingCounter(c, 17.6, 12.7, 24.0, 13.4, 'n', { clear: 0.8 });
  Fac.trayReturn(c, 24.6, 12.95, 'n');
  Fac.menuBoard(c, 20.8, 2.45, z1, 'n', { w: 2.6, h: 0.95, lines: ['TODAY  ·  SUBLEVEL 4 CANTEEN', 'Chicken & rice ........ 4.20', 'Lentil soup ........... 2.10', 'Veg lasagne ........... 3.80', 'Fruit cup · yoghurt ... 1.20', 'Coffee / tea .......... 0.90'] });
  c.label('NOX CAFÉ', 20.8, 3.22, z1 - 0.01, 'n', 1.6, 0.3, { bg: '#1b2127', fg: '#f3efe0', border: '#2f7ad0', font: 'bold 64px Arial' });
  // vending (one dead), the condiment station, two coolers in the west corner
  P.vending(c, x1 - 0.5, 11.5, 'w');
  P.vending(c, x1 - 0.5, 12.6, 'w', false);
  condimentStation(c, x1, 9.4, 'w');
  drinksCooler(c, 12.6, z1, 'n', { brand: 'NOX REFRESH' });
  drinksCooler(c, x0, 12.7, 'e', { lit: false, mat: X.f2_shellTeal, brand: 'JUICE BAR' });
  // long tables west, round tables north, the barricade, the last table behind it
  canteenTable(c, 13.55, 5.2, false);
  canteenTable(c, 13.55, 8.6, false);
  roundSet(c, 20.0, 5.0);
  roundSet(c, 22.8, 5.4, { n: 3 });
  roundSet(c, 25.2, 6.1, { n: 3 });
  tableBarricade(c, 21.3, 8.6, 'n', { w: 4.8 });
  roundSet(c, 21.0, 10.45, { n: 3, r: 0.4 });
  Fac.chairStack(c, 14.4, 12.2, 0.3, 5, X.f2_shellGrey);
  Fac.recycleBin(c, x0 + 0.22, 10.6, 'e');
  Fac.trashCan(c, 16.9, 10.6, { tipped: true });
  Fac.wetFloorSign(c, 16.4, 9.0, 0.6, { down: rnd() < 0.5 });
  // the stand: trays on the floor, blood behind the tables, a trail into the kitchen, papers
  for (const [x, z] of [[19.6, 9.85], [22.6, 9.7], [17.2, 7.2], [24.3, 10.7], [15.6, 4.6]]) droppedTray(c, x, z);
  c.decal('blood', 20.0, 9.9, 1.1, rnd() * 6);
  c.decal('bloodDrag', 18.4, 11.5, 2.6, -0.9);
  c.decal('footprints', 16.3, 12.3, 1.8, PI);
  c.decal('puddle', 23.3, 10.1, 1.2, rnd() * 6);
  c.decal('paper', 15.4, 6.6, 1.3, 0.4);
  c.decal('glass', 22.0, 7.7, 0.7, rnd() * 6);
  c.decal('blood', 15.9, 13.5, 0.6, rnd() * 6);
  // walls: the TV, the clock, notices and posters, first aid, the extinguisher and a call point, plates, a camera
  Fac.tvOnWall(c, 21.25, 2.8, z0, 's', { w: 1.0, lines: ['NOX BIOSYSTEMS', 'SUBLEVEL 4 LOCKDOWN', 'REMAIN IN YOUR SECTOR'], bg: '#7a1010' });
  Fac.wallClock(c, 13.4, 2.6, z0, 's');
  P.extinguisher(c, 21.25, z0, 's');
  c.K.box(M.red, 21.62, 1.32, z0, 21.76, 1.46, z0 + 0.05);
  c.label('FIRE', 21.69, 1.5, z0 + 0.003, 's', 0.12, 0.04, { bg: '#b3141a', fg: '#ffffff', font: 'bold 30px Arial' });
  Fac.noticeBoard(c, x0, 7.0, 'e', { w: 1.3, pages: [['CANTEEN HOURS', '07:00-19:30'], ['LOST: blue', 'thermos, Lab 4-B'], ['FAMILY DAY', 'CANCELLED']] });
  Fac.poster(c, x0, 1.6, 4.3, 'e', { lines: ['EAT WELL', 'WORK WELL', 'NOX WELLNESS'], bg: '#3f8f5a' });
  Fac.poster(c, x0, 1.6, 9.9, 'e', { lines: ['WASH', 'YOUR', 'HANDS'], bg: '#1f5fa6' });
  Fac.poster(c, x1, 1.6, 5.2, 'w', { lines: ['NOX FAMILY DAY', 'JUNE 14', 'BOUNCY CASTLE!'], bg: '#c6602e' });
  HL.firstAidBox(c, x1, 1.5, 7.4, 'w');
  HL.cctvCam(c, x1, 3.2, 3.2, 'w', 0.5);
  Fac.wallPlate(c, 14.3, 1.15, z0, 's', 'switch');
  Fac.wallPlate(c, x0, 0.3, 9.1, 'e');
  Fac.wallPlate(c, x1, 0.3, 6.6, 'w');
  Fac.wallPlate(c, x1, 0.3, 10.5, 'w');
}
/**
 * The kitchen behind the counter: the cook line along the south wall under its hood (combi oven, fryer, the range,
 * the tilt kettle with its landing table, a reach-in, the mixer), the walk-in cool room and freezer doors west, the
 * dish station east (the three-bowl sink, the hood machine, the clean landing, a speed rack), the ice machine and a
 * hand sink by the pass door, a double prep island under the pot rack. A pot went over by the line, soup across the
 * floor; the blood from the cafeteria goes to the freezer, whose door someone has written on.
 */
export function dressKitchen(c, s, ctx) {
  const { X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // the cook line (backs on the south wall), its hood carried over the oven and the fryer
  combiOven(c, 12.5, z1, 'n');
  deepFryer(c, 13.45, z1, 'n');
  Fac.kitchenRange(c, 14.8, z1, 'n', { w: 1.8, ceil: h });
  c.K.box(X.stainless, x0, 2.0, z1 - 1.05, 13.8, 2.5, z1);
  c.K.box(X.stainless, 12.6, 2.5, z1 - 0.55, 13.1, h, z1 - 0.15);
  c.K.box(c.G.lamp, x0 + 0.1, 1.999, z1 - 0.95, 13.7, 2.0, z1 - 0.8);
  tiltKettle(c, 16.95, z1 - 0.55, 'n');
  Fac.steelPrepTable(c, 18.75, z1 - 0.4, 'n', { w: 1.4, items: false, lip: true });
  Fac.stockPot(c, 18.5, 0.9, z1 - 0.4, { r: 0.18, h: 0.3 });
  Fac.reachInFridge(c, 20.3, z1 - 0.42, 'n', { w: 1.2, d: 0.8, h: 2.0 });
  Fac.mixer(c, 21.75, z1 - 0.5, 'n');
  HL.hazardPlacard(c, 18.75, 1.65, z1, 'n', 'hot', { w: 0.45 });
  // west: the walk-in doors (the freezer's written on), first aid; the ice machine and the ticket rail in the corner
  Fac.walkInDoor(c, x0, 19.0, 'e', { label: 'COOL ROOM', temp: '+3°C', ajar: 0.25 });
  Fac.walkInDoor(c, x0, 17.0, 'e', { label: 'FREEZER', temp: '-18°C', note: ['DO NOT', 'OPEN', 'they got in'] });
  HL.firstAidBox(c, x0, 1.5, 15.8, 'e');
  iceMachine(c, 12.45, z0, 's');
  Fac.ticketRail(c, 12.75, 1.95, z0, 's', { w: 1.0, tickets: [['T4', '2 soup', '1 lasag'], ['T9', '3 chkn'], ['T2', 'tea x4'], ['STAFF', '6 trays']] });
  // north, east of the door: the hand sink, dry stores, the extinguisher
  handSink(c, 19.6, z0, 's');
  Fac.canShelf(c, 20.95, z0, 's', { w: 1.4, h: 1.85, d: 0.5 });
  P.extinguisher(c, 22.0, z0, 's');
  // the dish station along the east wall
  Fac.dishSink(c, x1, 16.4, 'w', { w: 2.0 });
  dishwasher(c, x1, 17.8, 'w');
  Fac.steelPrepTable(c, x1 - 0.375, 18.95, 'w', { w: 1.2, items: false });
  Fac.dishRack(c, x1 - 0.375, 0.9, 18.8, 'w');
  Fac.trayStack(c, x1 - 0.32, 0.9, 19.35, 7, PI / 2);
  Fac.speedRack(c, x1 - 0.35, 20.0, 'w');
  // the prep island under the pot rack
  Fac.steelPrepTable(c, 15.2, 17.55, 'n');
  Fac.steelPrepTable(c, 17.0, 17.55, 'n', { items: false });
  Fac.steelPrepTable(c, 15.2, 18.3, 's', { items: false });
  Fac.steelPrepTable(c, 17.0, 18.3, 's');
  Fac.hangingPots(c, 16.1, 17.925, true, { len: 3.0, y: 2.25, ceil: h });
  Fac.stockPot(c, 17.4, 0.9, 17.5, { r: 0.16, h: 0.26 });
  // bins, the spill, the drains, grease, the trail to the freezer
  kitchenBin(c, 20.4, 17.4);
  kitchenBin(c, 13.4, 16.3, { tipped: true, yaw: -2.2 });
  spilledPot(c, 18.9, 19.55, 2.6);
  Fac.mopBucket(c, 20.5, 19.3, 0.8);
  Fac.wetFloorSign(c, 19.6, 18.9, 0.3, { down: true });
  for (const [x, z] of [[13.6, 19.7], [19.9, 15.9], [14.5, 16.3]]) Fac.floorDrain(c, x, z, 0.3);
  c.decal('oil', 13.6, 20.2, 1.1, rnd() * 6);
  c.decal('stain', 14.9, 20.1, 1.3, rnd() * 6);
  c.decal('bloodDrag', 14.0, 16.0, 2.6, 0.7);
  c.decal('blood', 12.6, 17.1, 0.9, rnd() * 6);
  c.decal('footprints', 16.2, 15.6, 1.5, 0.4);
  c.wallDecal('bloodSmear', x0, 1.2, 17.98, 'e', 0.45, 0.7);
  // walls: the clock over the door, HACCP notices, sockets
  Fac.wallClock(c, 16.25, 2.85, z0, 's');
  c.label('FOOD SAFETY · HACCP', x1, 1.7, 19.0, 'w', 0.9, 0.12, { bg: '#1d4f7a', fg: '#ffffff', font: 'bold 40px Arial' });
  c.label(['FRIDGE  ≤ 5°C', 'FREEZER  ≤ -18°C', 'HOT HOLD  ≥ 63°C', 'LOG EVERY 2 h'].join(' / '), x1, 1.4, 19.0, 'w', 0.9, 0.42, { lines: ['FRIDGE  ≤ 5°C', 'FREEZER  ≤ -18°C', 'HOT HOLD  ≥ 63°C', 'LOG EVERY 2 h'], bg: '#fbfbf4', fg: '#1b2127', font: 'bold 36px Arial', align: 'left' });
  for (const [x, z, face] of [[18.2, z1, 'n'], [x1, 15.2, 'w'], [x0, 20.3, 'e']]) Fac.wallPlate(c, x, 1.15, z, face);
}
/** a coat dropped on the floor at (x, z): crumpled body, a sleeve flung out */
function droppedCoat(c, x, z, yaw, mat) {
  const f = fr(x, z, yaw);
  A(c, f, mat, rbox(0.55, 0.06, 0.8, 0.03), 0, 0.045, 0, 0, 0, 0.05);
  A(c, f, mat, rbox(0.3, 0.1, 0.35, 0.04), 0.05, 0.08, -0.2, 0.2, 0.4, 0);
  A(c, f, mat, rbox(0.11, 0.06, 0.5, 0.03), 0.35, 0.03, 0.15, 0, -0.7, 0);
}
/**
 * The staff lockers: banks along the north and south walls and a back-to-back island with benches either side
 * (a share of the doors jemmied open, things left in them), hooks of coats and a boot bench by the corridor door,
 * the washbasins, an eyewash, a rail of clean lab coats, the PPE dispenser and the soiled-coat cart down the west
 * wall; a dropped bag, a coat on the floor, a torn-off door, footprints from the restrooms out to the corridor.
 */
export function dressLockers(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the locker banks: north wall east of the door's leaf, the south wall east of the restroom door, the island
  Fac.lockerBank(c, [34.2, z0 + 0.06, x1, z0 + 0.51], 's', { first: 101, forced: 0.2 });
  Fac.lockerBank(c, [32.2, z1 - 0.51, x1, z1 - 0.06], 'n', { first: 201, forced: 0.25 });
  Fac.lockerBank(c, [33.4, 5.8, 36.6, 6.25], 'n', { first: 301, tiers: 2, forced: 0.2 });
  Fac.lockerBank(c, [33.4, 6.25, 36.6, 6.7], 's', { first: 321, forced: 0.3, mat: X.partition });
  Fac.lockerBench(c, [33.8, 4.2, 36.2, 4.55]);
  Fac.lockerBench(c, [33.8, 7.9, 36.2, 8.25]);
  // north-west: coat hooks over a boot bench
  Fac.coatHooks(c, 28.45, z0, 's', { w: 1.6, coats: 0.75 });
  Fac.lockerBench(c, [27.7, 2.8, 29.2, 3.12]);
  for (let i = 0; i < 3; i++) Cy(c, fr(27.95 + i * 0.4, 3.35, 's'), X.rubber, 0, 0, 0, 0.05, 0.045, 0.32, 8);
  // the west wall: eyewash, basins and mirrors, the dryer, the clean coats, PPE, the soiled-coat cart
  HL.eyewash(c, x0, 3.7, 'e');
  Fac.washbasin(c, x0, 4.6, 'e');
  Fac.washbasin(c, x0, 5.6, 'e', { cracked: true });
  Fac.handDryer(c, x0, 1.25, 6.35, 'e');
  garmentRail(c, 27.85, 7.6, 'e', { w: 1.4, n: 5 });
  ppeDispenser(c, x0, 1.45, 8.9, 'e');
  Fac.laundryCart(c, 28.15, 9.2, 's'); // (its frame needs a face letter)
  // the east end: a long mirror, the extinguisher, the rota
  Fac.mirror(c, x1, 1.15, 4.4, 'w', { w: 0.5, h: 1.5 });
  P.extinguisher(c, x1, 6.25, 'w');
  Fac.noticeBoard(c, x1, 8.2, 'w', { w: 0.9, h: 0.7, pages: [['ROTA', 'WK 41'], ['LOCKER', 'AUDIT FRI'], ['MISSING', 'S. OKAFOR', 'LAB 4-B']] });
  // signs, the clock, plates
  c.label('STAFF LOCKERS · L4', 36.1, 2.62, z0 + 0.01, 's', 1.6, 0.24, { bg: '#1b2127', fg: '#e8edf0', border: '#8a949c', font: 'bold 56px Arial' });
  c.label(['LAB COATS & GLOVES OFF', 'BEFORE THE CANTEEN'].join(' / '), 30.1, 2.72, z0 + 0.01, 's', 1.0, 0.24, { lines: ['LAB COATS & GLOVES OFF', 'BEFORE THE CANTEEN'], bg: '#1f5fa6', fg: '#ffffff', font: 'bold 34px Arial' });
  Fac.wallClock(c, 31.75, 2.72, z0, 's');
  Fac.wallPlate(c, 29.3, 1.15, z0, 's', 'switch');
  Fac.wallPlate(c, x0, 0.3, 6.9, 'e');
  Fac.wallPlate(c, x1, 0.3, 5.0, 'w');
  // left behind: a bag, a coat, a locker door torn off, clothes, footprints out to the corridor
  Fac.duffelBag(c, 31.3, 5.4, 0.7);
  droppedCoat(c, 30.4, 7.5, 2.2, X.labcoat);
  droppedCoat(c, 35.0, 3.5, -0.4, X.denim);
  c.K.add(M.lockerBlue, boxG(0.37, 0.02, 1.65), 33.1, 0.012, 8.85, [0, 0.35 + rnd() * 0.2, 0]);
  droppedCoat(c, 34.7, 8.95, 1.2, X.navy);
  c.decal('footprints', 30.6, 6.2, 2.4, 0.15);
  boots(c, 36.9, 4.0, 1.3);
  boots(c, 33.2, 7.6, -0.4);
  c.decal('blood', 35.6, 5.3, 0.7, rnd() * 6);
  c.decal('paper', 34.4, 8.9, 0.9, rnd() * 6);
  c.wallDecal('bloodSmear', x1, 1.0, 9.2, 'w', 0.4, 0.6);
}
/**
 * The restrooms: three cubicles along the south wall (one locked with something seeping under it, one door hanging
 * off its hinge, one open), urinals with dividers down the east wall, the vanity with its long cracked mirror, the
 * dryer and towels, the cleaner's corner (mop sink, cart, spare rolls); a leak by the urinals, a trail of paper.
 */
export function dressWc(c, s, ctx) {
  const { K, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the cubicles: their fronts on z 14.5, partitions shared, the east one against the wall
  Fac.toiletStall(c, 32.525, z1 - 0.75, 'n', { door: 'locked', walls: '' });
  Fac.toiletStall(c, 31.575, z1 - 0.75, 'n', { door: 'broken', walls: 'l' });
  Fac.toiletStall(c, 30.625, z1 - 0.75, 'n', { door: 'open', walls: 'lr' });
  c.label(['OUT OF', 'ORDER'].join(' / '), 32.37, 1.45, z1 - 1.53, 'n', 0.22, 0.16, { lines: ['OUT OF', 'ORDER'], bg: '#fdfcf4', fg: '#b3141a', font: 'bold 40px Arial' });
  for (let i = 0; i < 3; i++) Fac.wallPlate(c, 30.625 + i * 0.95, 0.9, z1, 'n', 'data');
  // urinals down the east wall, a leak under them
  for (const z of [11.3, 12.1, 12.9]) urinal(c, x1, z, 'w');
  c.decal('puddle', 32.3, 12.3, 1.3, rnd() * 6);
  // the vanity on the west wall, the dryer, towels by the door, the switch
  vanity(c, x0, 12.3, 'e', { w: 2.0, basins: 2, cracked: true });
  Fac.handDryer(c, x0, 1.2, 13.85, 'e');
  Fac.paperTowelDispenser(c, 32.55, 1.35, z0, 's');
  Fac.wallPlate(c, x0, 1.15, 10.9, 'e', 'switch');
  Fac.wallPlate(c, x0, 1.3, 13.45, 'e');
  c.wallDecal('blood', x0, 1.6, 11.8, 'e', 0.3, 0.35);
  // the cleaner's corner: the mop sink, a shelf of rolls, the cart, a bucket out on the floor
  mopSink(c, 27.95, z1, 'n');
  K.box(X.alu, x0, 1.75, 14.6, x0 + 0.3, 1.78, 15.5);
  for (let i = 0; i < 6; i++) K.add(X.paper, cylG(0.055, 0.055, 0.1, 8), x0 + 0.08 + (i % 2) * 0.13, 1.83 + Math.floor(i / 4) * 0.1, 14.75 + (i % 3) * 0.3, [PI / 2, 0, 0]);
  janitorCart(c, 29.3, 15.45, 0);
  Fac.mopBucket(c, 31.0, 13.7, 0.8);
  Fac.wetFloorSign(c, 29.2, 12.6, 1.0, { down: rnd() < 0.5 });
  Fac.floorDrain(c, 30.2, 12.9, 0.3);
  // a roll unspooled out of the open cubicle, wet paper, footprints
  K.add(X.paper, boxG(0.1, 0.004, 1.5), 30.4, 0.003, 13.85, [0, 0.25, 0]);
  K.add(X.paper, cylG(0.055, 0.055, 0.1, 8), 30.25, 0.055, 13.15, [0, 0, PI / 2]);
  c.decal('paper', 29.6, 13.8, 0.8, rnd() * 6);
  c.decal('footprints', 29.8, 11.6, 1.6, PI);
  // signs
  c.label('RESTROOMS · STAFF', 31.3, 2.62, z0 + 0.01, 's', 1.2, 0.2, { bg: '#1b2127', fg: '#e8edf0', border: '#8a949c', font: 'bold 56px Arial' });
  c.label(['NOW WASH', 'YOUR HANDS'].join(' / '), x0 + 0.01, 2.2, 13.85, 'e', 0.4, 0.22, { lines: ['NOW WASH', 'YOUR HANDS'], bg: '#ffffff', fg: '#1f5fa6', border: '#1f5fa6', font: 'bold 36px Arial' });
  HL.wallVent(c, 29.0, 2.45, z1, 'n', 0.5, 0.25);
  const log = ['CLEANING LOG', '08:00  ✓  JR', '12:00  ✓  JR', '16:00  —', '20:00  —'];
  c.label(log.join(' / '), x0 + 0.01, 1.45, 14.35, 'e', 0.3, 0.4, { lines: log, bg: '#fbfbf4', fg: '#1b2127', font: 'bold 30px monospace', align: 'left' });
}
/** a pair of boots on the floor at (x, z) turned `yaw` (one fallen over) */
function boots(c, x, z, yaw) {
  const f = fr(x, z, yaw);
  for (const s of [-1, 1]) {
    const down = s > 0 && c.rnd() < 0.5;
    A(c, f, c.X.charcoal, rbox(0.11, 0.06, 0.28, 0.025), s * 0.08, down ? 0.055 : 0.03, 0.04, 0, 0, down ? PI / 2 : 0);
    A(c, f, c.X.charcoal, rbox(0.11, 0.2, 0.12, 0.03), s * 0.08 + (down ? 0.1 : 0), down ? 0.055 : 0.14, -0.04, 0, 0, down ? PI / 2 : 0);
  }
}
/**
 * The sleeping quarters for the on-call staff (8.5 x 4 m): three steel bunks round the walls (unmade, a towel on a
 * rail), footlockers, a tall locker, the mini fridge with the kettle and mugs on it, a card table mid-game under a
 * desk lamp, a clothesline in the corner, posters, a calendar, photos, a guitar, boots; the lanes between the two
 * office doors and the blast door to operations are kept clear.
 */
export function dressQuarters(c, s, ctx) {
  const { K, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the bunks: west wall, north wall east of the blast door, east wall
  Fac.bunkBed(c, 16.97, -13.45, 'e');
  Fac.bunkBed(c, 22.15, -14.03, 's');
  Fac.bunkBed(c, 24.53, -12.85, 'w');
  K.add(X.f2_towel, boxG(0.5, 0.35, 0.02), 22.9, 1.62, -13.56, [0, 0, 0.05]);
  K.add(X.f2_towel, boxG(0.5, 0.012, 0.12), 22.9, 1.795, -13.6);
  // footlockers, the tall locker, the fridge in the north-east corner, the kettle and mugs on it
  Fac.footlocker(c, 16.75, -12.0, 'e', { name: 'VASQUEZ' });
  Fac.footlocker(c, 22.15, -13.3, 's', { name: 'R. HALE' });
  Fac.footlocker(c, 23.85, -12.85, 'w', { open: true, name: 'OKAFOR' });
  P.lockers(c, [17.5, z0, 17.95, z0 + 0.5], 's');
  Fac.officeFridge(c, 23.75, -14.2, 's');
  Fac.kettle(c, 23.62, 0.85, -14.27, 0.4);
  Fac.mug(c, 23.9, 0.85, -14.05);
  Fac.mug(c, 23.95, 0.85, -14.3);
  radio(c, 22.3, 0.4, -13.32, 0.2);
  // the card table under a lamp, mid-game
  cardTable(c, 20.6, -12.55, { chairs: 3 });
  Fac.deskLamp(c, 20.88, 0.742, -12.82, -2.4, { on: true, light: true });
  // the clothesline from the north bunk's post to the east bunk's, the guitar, the boots, a bag
  Fac.clothesline(c, 23.1, -13.6, 24.1, -11.95, 1.72, { n: 4 });
  Fac.guitar(c, x1 - 0.1, -11.4, 'w');
  boots(c, 17.65, -12.3, 0.3);
  boots(c, 21.6, -13.3, 2.9);
  Fac.duffelBag(c, 17.75, -13.25, 1.4);
  // walls: posters over the bunks, a calendar, photos, a shelf, the rota, the switch and sockets
  Fac.poster(c, 22.15, 2.2, z0, 's', { w: 0.5, h: 0.7, lines: ['THE', 'STATIC', 'TOUR 09'], bg: '#2a2a2a', fg: '#f2c94c' });
  Fac.poster(c, x0, 2.2, -13.4, 'e', { w: 0.6, h: 0.45, lines: ['SURF\'S UP', 'LOMBOK'], bg: '#2f8fb0' });
  Fac.poster(c, x1, 2.25, -12.85, 'w', { w: 0.45, h: 0.6, lines: ['MOTOGP', '2026'], bg: '#b3141a' });
  const cal = ['OCTOBER', 'X X X X X X X', 'X X X X X', 'shift swap Fri?'];
  c.label(cal.join(' / '), 20.9, 1.6, z0 + 0.01, 's', 0.36, 0.42, { lines: cal, bg: '#fbfbf4', fg: '#1b2127', font: 'bold 30px Arial' });
  c.label('♥ MIA & JO', x0 + 0.01, 1.35, -12.9, 'e', 0.14, 0.1, { bg: '#c9b48e', fg: '#5a3d22', font: 'bold 30px Georgia, serif' });
  wallShelf(c, x0, 1.55, -11.6, 'e', { w: 0.7, photo: ['MOM'] });
  const rota = ['ON-CALL ROTA', 'MON  HALE', 'TUE  OKAFOR', 'WED  VASQUEZ', 'QUIET 22-06'];
  c.label(rota.join(' / '), x1 - 0.01, 1.5, -11.2 - 0.62, 'w', 0.32, 0.42, { lines: rota, bg: '#fbfbf4', fg: '#1b2127', font: 'bold 28px Arial', align: 'left' });
  c.label('QUARTERS · QUIET PLEASE', 21.0, 2.62, z1 - 0.01, 'n', 1.4, 0.2, { bg: '#1b2127', fg: '#e8edf0', border: '#2f7ad0', font: 'bold 52px Arial' });
  Fac.wallPlate(c, x0, 1.15, -10.95, 'e', 'switch');
  Fac.wallPlate(c, 20.9, 0.3, z0, 's');
  Fac.wallPlate(c, x1, 0.3, -13.9, 'w');
  // left in a hurry: papers, a spilled drink, footprints to the blast door
  c.decal('paper', 19.6, -12.0, 0.9, rnd() * 6);
  c.decal('stain', 23.2, -13.6, 0.7, rnd() * 6);
  c.decal('footprints', 19.2, -12.6, 1.8, PI);
}
