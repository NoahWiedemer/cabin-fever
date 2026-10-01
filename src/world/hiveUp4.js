// The Hive's east wing after v3 (world/hive.js): the double-height mess hall (the cafeteria) and the narrow staff
// locker room next to it. The serving line runs along the mess hall's south wall (tray start, salad bar, the hot
// counter, the till), the kitchen beyond it only shows through its pass (a roller shutter half down) and the dish
// return hatch; vinyl booths line the west wall, long tables and round ones fill the floor, the staff's barricade of
// tipped tables faces the corridor doors. Everything is world-space geometry for the Kit (one mesh per material,
// baked light) and a collider for whatever you'd bump into, like hiveProps.js.
//
// c: hiveProps.js's context plus X (EXTRA_MATS of this module and of hiveFacility.js, hiveFacility2.js, hiveLabs.js,
//    hiveDressD.js, baked), G (their EXTRA_GLOW), label(text, x, y, z, face, w, h, opts), decal(kind, x, z, size, rot),
//    wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on).
// Floor props take the centre of their footprint (x, z) and the `face` their front looks toward ('n' -z, 's' +z,
// 'w' -x, 'e' +x); wall props take the point on the wall line (the room rect's edge) and the face into the room.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import * as P from './hiveProps.js';
import * as Fac from './hiveFacility.js';
import * as F2 from './hiveFacility2.js';
import * as HL from './hiveLabs.js';
import * as DD from './hiveDressD.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const FACE_YAW = P.FACE_YAW;
const DOWN = [0, -1, 0];

/** baked materials this module adds (c.X.<name>) */
export const EXTRA_MATS = {
  j_vinyl: { color: 0x2c5a6e, roughness: 0.45 }, // booth upholstery
  j_vinylRed: { color: 0x8a2c26, roughness: 0.45 }, // bar-stool seats
  j_veneer: { color: 0x9c7650, roughness: 0.5 }, // booth frames, counter cladding
  j_boothTop: { color: 0x3a2b22, roughness: 0.35 }, // dark walnut laminate
  j_foam: { color: 0xd9c46a, roughness: 1 }, // a slashed cushion's foam
  j_quartz: { color: 0x6f6d6a, roughness: 0.3 }, // the serving line's stone tops
  j_front: { color: 0x285d86, roughness: 0.45 }, // NOX-blue counter fronts
  j_shutter: { color: 0xa9afb3, metalness: 0.5, roughness: 0.45 }, // galvanised roller shutter
  j_shutterDark: { color: 0x5d6368, metalness: 0.4, roughness: 0.6 },
  j_felt1: { color: 0x3e6e73, roughness: 1 }, // acoustic panels
  j_felt2: { color: 0xb68a3c, roughness: 1 },
  j_felt3: { color: 0x5a6470, roughness: 1 },
  j_lettuce: { color: 0x6a9e3c, roughness: 0.7 },
  j_tomato: { color: 0xc23a22, roughness: 0.4 },
  j_carrot: { color: 0xe07a24, roughness: 0.6 },
  j_bread: { color: 0xc8955a, roughness: 0.8 },
  j_choc: { color: 0x4a2a18, roughness: 0.5 },
  j_purple: { color: 0x6d2f86, roughness: 0.4 }, // snack wrappers
  j_vendBody: { color: 0x1d2c44, metalness: 0.3, roughness: 0.5 }, // the snack machines
  j_vendGrey: { color: 0x8d9296, metalness: 0.4, roughness: 0.5 },
  j_pad: { color: 0x3b6f9e, roughness: 0.5 }, // the gurney's mattress
  j_sheet: { color: 0xe4e8ea, roughness: 0.9 },
  j_ash: { color: 0xc9a77a, roughness: 0.6 }, // the locker room's bench slats
  j_towel: { color: 0xd6d2c4, roughness: 1 },
  j_mat: { color: 0x26292b, roughness: 0.95 }, // rubber boot trays
};
/** emissive materials this module adds (c.G.<name>): colour, intensity */
export const EXTRA_GLOW = {
  j_vend: [0xf4f8ff, 1.3], // a snack machine's lit inside
  j_vendHead: [0x3aa4ff, 1.25], // its header
  j_keypad: [0x7dff9a, 1.2], // keypad / till displays
  j_strip: [0xfff2d6, 1.1], // the salad bar's LED strip
  j_heat: [0xff7a2a, 1.5], // the pass's heat lamps
};

// ---------------------------------------------------------------- shared geometry and the local frame
const GEO = new Map();
const cached = (key, make) => {
  let g = GEO.get(key);
  if (!g) GEO.set(key, (g = make()));
  return g;
};
const r3 = (v) => Math.round(v * 1000) / 1000;
/** a rounded box (created once per size, the Kit clones it): about 108 triangles, use it where it shows */
const rbox = (w, h, d, r = 0.02) => cached(`rb${r3(w)},${r3(h)},${r3(d)},${r3(r)}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.02, h / 2.02, d / 2.02)));
const boxG = (w, h, d) => cached(`bx${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
/** a centred cylinder along y: r0 at the bottom, r1 at the top */
const cylG = (r0, r1, h, seg = 12, open = false) => cached(`cy${r3(r0)},${r3(r1)},${r3(h)},${seg},${open}`, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open));
const sphG = (r, w = 8, h = 6) => cached(`sp${r3(r)},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const torG = (R, r, rs = 4, ts = 10, arc = PI * 2) => cached(`to${r3(R)},${r3(r)},${rs},${ts},${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
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
/** a collider over the local rect (any yaw: its bounding box) */
function col(c, f, a0, b0, a1, b1, y0, y1, surf = SURF.metal) {
  const p = [at(f, a0, b0), at(f, a1, b0), at(f, a0, b1), at(f, a1, b1)];
  c.col(Math.min(...p.map((q) => q[0])), y0, Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), y1, Math.max(...p.map((q) => q[1])), surf);
}
/** a text label facing the frame's front (cardinal frames) lying at depth b (c.label stands it 0.02 m off: undone here); an array: a multi-line one */
function lbl(c, f, text, a, y, b, w, h, opts = {}) {
  const [x, z] = at(f, a, b - 0.02);
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

// ---------------------------------------------------------------- the mess hall: seating
/** a booth bench's upholstered profile (seat curving up into a raked back), extruded `len` along +z: about 44 triangles */
const benchG = (len) => cached(`bench${r3(len)}`, () => {
  const s = new THREE.Shape();
  const pts = [[0, 0.37], [0, 1.1], [0.03, 1.135], [0.09, 1.135], [0.12, 1.1], [0.15, 0.62], [0.17, 0.5], [0.2, 0.47], [0.52, 0.47], [0.555, 0.45], [0.56, 0.41], [0.53, 0.37]];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  return new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, curveSegments: 1 });
});
/**
 * A diner booth against the wall: (x, z) the point on the wall line under the table's middle, `face` into the room.
 * Two vinyl benches face each other across a pedestal table fixed to the wall (len: how far it reaches into the room,
 * gap: the table's width); booths pitched 1.86 m apart sit back to back. mess: what was left on the table; slashed:
 * one cushion cut open.
 */
export function booth(c, x, z, face, { len = 1.3, gap = 0.76, mess = true, slashed = false, mat = null } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  const m = mat ?? X.j_vinyl;
  const ab = gap / 2 + 0.52; // the benches' back planes
  for (const s of [-1, 1]) {
    // the upholstery (its profile mirrored by turning it round), the veneer plinth, the kick, the end cap
    if (s < 0) A(c, f, m, benchG(len - 0.05), -ab, 0, 0.02);
    else A(c, f, m, benchG(len - 0.05), ab, 0, len - 0.03, 0, PI);
    B(c, f, X.j_veneer, s < 0 ? -ab : gap / 2 - 0.02, 0.06, 0.02, s < 0 ? -gap / 2 + 0.02 : ab, 0.37, len - 0.03, 'flrt');
    B(c, f, M.black, s < 0 ? -ab + 0.02 : gap / 2, 0, 0.02, s < 0 ? -gap / 2 : ab - 0.02, 0.06, len - 0.05, 'flr');
    // (the end cap follows the profile: full height behind the back, seat height in front, so you can slide in)
    B(c, f, X.j_veneer, s < 0 ? -ab - 0.005 : ab - 0.15, 0, len - 0.03, s < 0 ? -ab + 0.15 : ab + 0.005, 1.15, len, 'fblrt');
    B(c, f, X.j_veneer, s < 0 ? -ab + 0.15 : gap / 2 - 0.05, 0, len - 0.03, s < 0 ? -gap / 2 + 0.05 : ab - 0.15, 0.49, len, 'fblrt');
    col(c, f, s < 0 ? -ab : gap / 2 - 0.05, 0, s < 0 ? -gap / 2 + 0.05 : ab, len, 0, 1.14, SURF.wood);
  }
  if (slashed) {
    const s = rnd() < 0.5 ? -1 : 1;
    A(c, f, X.j_foam, boxG(0.05, 0.012, 0.42), s * (gap / 2 + 0.2), 0.47, len * 0.45, 0, jit(c, 0.3));
    A(c, f, X.j_foam, boxG(0.03, 0.2, 0.012), s * (ab - 0.13), 0.8, len * 0.5, 0, 0, s * 0.12);
  }
  // the table: a dark laminate top with a chrome edge, a wall cleat, one pedestal on a cross foot
  const T = 0.74, tl = len - 0.12;
  B(c, f, X.j_boothTop, -gap / 2 + 0.01, T, 0.01, gap / 2 - 0.01, T + 0.03, tl + 0.01, 'flrt');
  B(c, f, X.chrome, -gap / 2 + 0.01, T - 0.002, tl + 0.01, gap / 2 - 0.01, T + 0.03, tl + 0.018, 'flrt');
  B(c, f, X.charcoal, -0.2, T - 0.06, 0, 0.2, T, 0.05, 'flrd');
  Cy(c, f, X.charcoal, 0, 0.04, tl * 0.62, 0.035, 0.035, T - 0.04, 8);
  Cu(c, f, X.charcoal, 0, 0.02, tl * 0.62, 0.5, 0.04, 0.06);
  Cu(c, f, X.charcoal, 0, 0.02, tl * 0.62, 0.06, 0.04, 0.5);
  col(c, f, -gap / 2 + 0.05, 0, gap / 2 - 0.05, tl, 0, T + 0.03, SURF.wood);
  // the wall end: napkins, salt and pepper, a sauce bottle
  const y = T + 0.03;
  B(c, f, X.chrome, -0.18, y, 0.06, -0.06, y + 0.12, 0.14, 'flrt');
  B(c, f, X.paper, -0.17, y + 0.06, 0.142, -0.07, y + 0.1, 0.143, 'f');
  Cy(c, f, M.white, 0.05, y, 0.1, 0.018, 0.016, 0.08, 5);
  Cy(c, f, X.charcoal, 0.1, y, 0.1, 0.018, 0.016, 0.08, 5);
  Cy(c, f, X.f2_sauce, 0.19, y, 0.11, 0.026, 0.028, 0.16, 6);
  if (!mess) return;
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = jit(c, gap / 2 - 0.2), b = 0.4 + rnd() * (tl - 0.6), k = rnd();
    const [px, pz] = at(f, a, b);
    if (k < 0.35) trayLite(c, px, y, pz, f.yaw + jit(c, 0.3));
    else if (k < 0.65) Fac.mug(c, px, y, pz, null, rnd() * 6);
    else if (k < 0.82) A(c, f, X.paper, boxG(0.3, 0.008, 0.42), a, y + 0.004, b, 0, jit(c, 0.5)); // a paper
    else A(c, f, M.black, boxG(0.075, 0.009, 0.155), a, y + 0.005, b, 0, rnd() * 6); // a phone left behind
  }
}
/** a chrome bar stool at (x, z): a red vinyl seat on a pole, a foot ring, a round base (down: on its side, turned yaw) */
export function barStool(c, x, z, { down = false, yaw = 0, h = 0.76, collide = true } = {}) {
  const { X } = c;
  const g = down ? grp(c, x, 0.2, z, yaw, 0, PI / 2 - 0.12) : grp(c, x, 0, z, yaw);
  g(X.j_vinylRed, cylG(0.18, 0.175, 0.07, 10), 0, h - 0.035, 0);
  g(X.charcoal, cylG(0.12, 0.14, 0.03, 8, true), 0, h - 0.085, 0);
  g(X.chrome, cylG(0.025, 0.025, h - 0.1, 6, true), 0, (h - 0.1) / 2 + 0.01, 0);
  g(X.chrome, torG(0.16, 0.011, 3, 8), 0, 0.3, 0, PI / 2);
  g(X.chrome, boxG(0.32, 0.012, 0.012), 0, 0.3, 0);
  g(X.charcoal, cylG(0.2, 0.21, 0.025, 10), 0, 0.0125, 0);
  if (!down && collide) c.col(x - 0.18, 0, z - 0.18, x + 0.18, h, z + 0.18, SURF.metal);
}
/**
 * A standing ledge along the wall at (x, z) facing `face`, w long: a laminate shelf at 1.05 m on steel brackets, a
 * chrome foot rail, bar stools in front (one knocked over), a mug or a tray left on it.
 */
export function wallLedge(c, x, z, face, { w = 3.6, stools = 4, mess = true } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, X.j_boothTop, -w / 2, 1.03, 0, w / 2, 1.07, 0.38, 'flrtd');
  B(c, f, X.chrome, -w / 2 + 0.01, 1.028, 0.378, w / 2 - 0.01, 1.072, 0.386, 'flrt');
  const nb = Math.max(2, Math.round(w / 1.1) + 1);
  for (let i = 0; i < nb; i++) {
    const a = -w / 2 + 0.12 + ((w - 0.24) * i) / (nb - 1);
    B(c, f, X.charcoal, a - 0.015, 0.8, 0, a + 0.015, 1.03, 0.03, 'flrt');
    A(c, f, X.charcoal, boxG(0.02, 0.3, 0.025), a, 0.92, 0.14, 0.9);
    // the foot rail's standoffs
    B(c, f, X.chrome, a - 0.012, 0.2, 0, a + 0.012, 0.23, 0.3, 'lrt');
  }
  Ca(c, f, X.chrome, 0, 0.22, 0.3, 0.022, w - 0.16, 8);
  const sp = w / stools;
  for (let i = 0; i < stools; i++) {
    const a = -w / 2 + sp * (i + 0.5) + jit(c, 0.08), down = i === stools - 1 && rnd() < 0.7;
    const [sx, sz] = at(f, a + (down ? 0.2 : 0), down ? 0.95 : 0.66 + jit(c, 0.06));
    barStool(c, sx, sz, { down, yaw: rnd() * 6, h: 0.76 });
  }
  if (mess) {
    for (let i = 0; i < 3; i++) {
      const [px, pz] = at(f, jit(c, w / 2 - 0.3), 0.2);
      if (rnd() < 0.4) trayLite(c, px, 1.07, pz, f.yaw + jit(c, 0.2));
      else Fac.mug(c, px, 1.07, pz, null, rnd() * 6);
    }
  }
  col(c, f, -w / 2, 0, w / 2, 0.38, 0, 1.07, SURF.wood);
}

// ---------------------------------------------------------------- the mess hall: the serving line
/** a serving-line counter body over the local rect (a: -w/2..w/2, b: -d/2..d/2): blue fronts, a veneer kick, a stone top at T, the tray slide */
function lineBody(c, f, w, d, T, { slide = true } = {}) {
  const { X, M } = c;
  B(c, f, X.j_veneer, -w / 2, 0.1, -d / 2, w / 2, T - 0.03, d / 2 - 0.02, 'lr');
  B(c, f, M.black, -w / 2 + 0.02, 0, -d / 2 + 0.04, w / 2 - 0.02, 0.1, d / 2 - 0.06, 'fb');
  const n = Math.max(1, Math.round(w / 0.8));
  for (let i = 0; i < n; i++) {
    const a0 = -w / 2 + (w * i) / n, a1 = a0 + w / n;
    B(c, f, X.j_front, a0 + 0.005, 0.1, d / 2 - 0.02, a1 - 0.005, T - 0.04, d / 2, 'f');
    B(c, f, X.stainless, a0 + 0.06, 0.2, d / 2, a1 - 0.06, 0.215, d / 2 + 0.004, 'ft');
  }
  B(c, f, X.stainless, -w / 2, 0.1, -d / 2, w / 2, T - 0.03, -d / 2 + 0.01, 'b');
  B(c, f, X.j_quartz, -w / 2 - 0.01, T - 0.03, -d / 2, w / 2 + 0.01, T, d / 2 + 0.03, 'flrtb');
  if (!slide) return;
  for (const k of [0, 1, 2]) Ca(c, f, X.chrome, 0, T - 0.1, d / 2 + 0.12 + k * 0.07, 0.013, w, 8);
  for (let i = 0; i <= Math.round(w / 1.2); i++) {
    const a = -w / 2 + 0.05 + ((w - 0.1) * i) / Math.round(w / 1.2);
    B(c, f, X.chrome, a - 0.015, T - 0.25, d / 2, a + 0.015, T - 0.09, d / 2 + 0.28, 'lrt');
  }
}
/**
 * Where the serving line starts, at (x, z) facing `face` (the queue): a short counter with two stacks of trays, the
 * cutlery cassette, napkins and a 'START HERE' card on a stand. T: the line's top height.
 */
export function trayStart(c, x, z, face, { w = 1.3, d = 0.7, T = 0.95 } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  lineBody(c, f, w, d, T);
  trayPile(c, ...atY(f, -w / 2 + 0.3, T, 0.17), 6 + Math.floor(rnd() * 6), f.yaw);
  trayPile(c, ...atY(f, -w / 2 + 0.3, T, -0.17), 12, f.yaw);
  // the cutlery cassette: four wells of knives, forks, spoons, teaspoons, handles up
  const a0 = 0.02;
  B(c, f, X.stainless, a0, T, -0.05, a0 + 0.46, T + 0.1, 0.17, 'flrtb');
  for (let i = 0; i < 4; i++) {
    const a = a0 + 0.06 + i * 0.113;
    B(c, f, M.dark, a - 0.045, T + 0.1, -0.03, a + 0.045, T + 0.101, 0.15, 't');
    const k = rnd() < 0.2 ? 0 : 3;
    for (let j = 0; j < k; j++) A(c, f, X.chrome, boxG(0.012, 0.11, 0.004), a + jit(c, 0.025), T + 0.12, 0.06 + jit(c, 0.05), jit(c, 0.25), jit(c, 0.6), jit(c, 0.25));
  }
  lbl(c, f, 'KNIVES · FORKS · SPOONS', a0 + 0.23, T + 0.05, 0.172, 0.4, 0.05, { bg: '#e9ecef', fg: '#1d2b3a', font: 'bold 28px Arial' });
  B(c, f, X.chrome, w / 2 - 0.195, T, -0.17, w / 2 - 0.065, T + 0.14, -0.07, 'flrt');
  B(c, f, X.paper, w / 2 - 0.18, T + 0.1, -0.069, w / 2 - 0.08, T + 0.12, -0.068, 'f');
  // the card on its stand, and a fork on the floor
  B(c, f, X.chrome, w / 2 - 0.16, T, 0.22, w / 2 - 0.1, T + 0.01, 0.28, 't');
  Cy(c, f, X.chrome, w / 2 - 0.13, T, 0.25, 0.006, 0.006, 0.22, 4);
  A(c, f, X.charcoal, boxG(0.3, 0.2, 0.006), w / 2 - 0.13, T + 0.31, 0.25);
  lbl(c, f, ['START HERE ▸', 'TRAYS · CUTLERY'], w / 2 - 0.13, T + 0.31, 0.2535, 0.28, 0.18, { bg: '#285d86', fg: '#ffffff', font: 'bold 34px Arial' });
  A(c, f, X.chrome, boxG(0.012, 0.004, 0.18), jit(c, 0.3), 0.003, d / 2 + 0.6, 0, rnd() * 6);
  col(c, f, -w / 2, -d / 2, w / 2, d / 2 + 0.3, 0, T, SURF.metal);
}
/**
 * A waist-high stainless swing gate on two posts across the local width w at (x, z), its 'STAFF ONLY' side toward
 * `face` (closes the staff side of a counter); open: swung back by that angle (no collider then).
 */
export function staffGate(c, x, z, face, { w = 0.7, open = 0 } = {}) {
  const { X } = c;
  const f = fr(x, z, face);
  for (const s of [-1, 1]) Cy(c, f, X.stainless, s * (w / 2 - 0.03), 0, 0, 0.025, 0.025, 1.0, 8);
  const [hx, hz] = at(f, -w / 2 + 0.06, 0);
  const g = grp(c, hx, 0, hz, f.yaw + open);
  g(X.stainless, boxG(w - 0.13, 0.55, 0.025), (w - 0.13) / 2, 0.62, 0);
  g(X.chrome, boxG(w - 0.13, 0.03, 0.035), (w - 0.13) / 2, 0.92, 0);
  if (!open) {
    lbl(c, f, 'STAFF ONLY', 0, 0.68, 0.014, 0.4, 0.1, { bg: '#c0392b', fg: '#ffffff', font: 'bold 40px Arial' });
    col(c, f, -w / 2, -0.03, w / 2, 0.03, 0, 1.0, SURF.metal);
  }
}
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
/**
 * The salad bar at (x, z) facing `face` (the queue), w long: the line's counter with a cold well of crushed ice and
 * two rows of pans (one taken away, a couple scraped bare), tongs, a glass sneeze guard on chrome posts with a lit
 * top shelf of dressings, bread rolls and fruit, little name cards; a pan of pasta salad went over on the floor.
 */
export function saladBar(c, x, z, face, { w = 3.2, d = 0.7, T = 0.95 } = {}) {
  const { X, M, G, U, rnd } = c;
  const f = fr(x, z, face);
  lineBody(c, f, w, d, T);
  B(c, f, M.dark, -w / 2 + 0.1, T, -d / 2 + 0.08, w / 2 - 0.1, T + 0.004, d / 2 - 0.06, 't');
  B(c, f, X.f2_ice, -w / 2 + 0.12, T + 0.004, -d / 2 + 0.1, w / 2 - 0.12, T + 0.03, d / 2 - 0.08, 't');
  const fills = [X.j_lettuce, X.j_tomato, X.j_carrot, X.foodPale, X.foodGreen, X.f2_mustard, X.j_purple, X.j_lettuce];
  const names = ['GREEN LEAF', 'TOMATO', 'CARROT', 'PASTA', 'BEANS', 'SWEETCORN', 'RED CABBAGE', 'ROCKET'];
  const n = Math.floor((w - 0.3) / 0.36), a0 = -((n - 1) * 0.36) / 2;
  let gone = Math.floor(rnd() * n);
  for (let i = 0; i < n; i++) {
    const a = a0 + i * 0.36;
    for (const [r, b] of [[0, 0.13], [1, -0.13]]) {
      if (r === 0 && i === gone) continue; // the pan that went on the floor
      B(c, f, X.stainless, a - 0.16, T + 0.03, b - 0.12, a + 0.16, T + 0.042, b + 0.12, 't');
      if (rnd() < 0.18) continue; // scraped bare
      const k = (i * 2 + r * 3) % fills.length;
      B(c, f, fills[k], a - 0.145, T + 0.042, b - 0.105, a + 0.145, T + 0.05 + rnd() * 0.025, b + 0.105, 'tfb');
      if (rnd() < 0.4) A(c, f, X.chrome, boxG(0.02, 0.012, 0.22), a + jit(c, 0.08), T + 0.08, b, 0.35, jit(c, 0.5));
    }
    lbl(c, f, names[i % names.length], a, T - 0.06, d / 2 + 0.003, 0.22, 0.05, { bg: '#fbfbf4', fg: '#2c5a2e', font: 'bold 28px Arial' });
  }
  // the sneeze guard: posts, the angled glass, a lit glass shelf with things on it
  const H = T + 0.55;
  for (const a of [-w / 2 + 0.08, 0, w / 2 - 0.08]) for (const b of [-d / 2 + 0.06, d / 2 - 0.08]) Cy(c, f, X.chrome, a, T, b, 0.014, 0.014, 0.56, 6);
  A(c, f, U.glass, boxG(w - 0.14, 0.34, 0.008), 0, T + 0.38, d / 2 - 0.1, -0.5);
  B(c, f, U.glass, -w / 2 + 0.06, H, -d / 2 + 0.03, w / 2 - 0.06, H + 0.012, d / 2 - 0.04, 'tfd');
  B(c, f, X.chrome, -w / 2 + 0.06, H - 0.03, -d / 2 + 0.03, w / 2 - 0.06, H, -d / 2 + 0.06, 'fd');
  B(c, f, G.j_strip, -w / 2 + 0.1, H - 0.032, -d / 2 + 0.06, w / 2 - 0.1, H - 0.026, d / 2 - 0.1, 'd');
  for (let i = 0; i < 4; i++) {
    const a = -w / 2 + 0.3 + i * 0.12;
    Cy(c, f, i % 2 ? X.foodPale : X.f2_sauce, a, H + 0.012, 0, 0.03, 0.03, 0.15, 6);
    Cy(c, f, M.white, a, H + 0.162, 0, 0.02, 0.008, 0.04, 4);
  }
  Cy(c, f, X.kraft, 0.15, H + 0.012, -0.02, 0.15, 0.17, 0.08, 10);
  for (let i = 0; i < 5; i++) A(c, f, X.j_bread, sphG(0.045, 5, 3), 0.15 + jit(c, 0.08), H + 0.09, -0.02 + jit(c, 0.08), 0, rnd() * 3, 0, [1.3, 0.75, 1]);
  Cy(c, f, M.white, w / 2 - 0.4, H + 0.012, 0, 0.16, 0.12, 0.07, 12);
  for (let i = 0; i < 4; i++) A(c, f, pick(c, [X.f2_sauce, X.j_lettuce, M.yellow]), sphG(0.04, 5, 3), w / 2 - 0.4 + jit(c, 0.07), H + 0.1, jit(c, 0.07));
  B(c, f, X.j_front, -0.5, H - 0.13, d / 2 - 0.05, 0.5, H, d / 2 - 0.04, 'fblrt');
  lbl(c, f, 'SALAD BAR · DAILY', 0, H - 0.065, d / 2 - 0.037, 0.9, 0.11, { bg: '#2c5a2e', fg: '#f3efe0', font: 'bold 44px Arial' });
  // the dropped pan: upside down in front of the line, the salad round it
  const ag = a0 + gone * 0.36;
  const [px, pz] = at(f, ag + jit(c, 0.3), d / 2 + 0.75);
  c.K.add(X.stainless, boxG(0.32, 0.065, 0.24), px, 0.033, pz, [0, rnd() * 6, 0]);
  for (let i = 0; i < 5; i++) c.K.add(fills[(gone * 2) % fills.length], sphG(0.05, 5, 3), px + jit(c, 0.35), 0.01, pz + jit(c, 0.35), [0, rnd() * 6, 0], [1.2, 0.3, 0.9]);
  c.decal?.('stain', px, pz, 0.8, rnd() * 6);
  col(c, f, -w / 2, -d / 2, w / 2, d / 2 + 0.3, 0, T, SURF.metal);
}
/**
 * The till at the end of the line, at (x, z) facing `face` (the queue): the counter, a POS terminal turned to the
 * cashier with its drawer pulled out and emptied, a card reader on a stand for the customer, the receipt printer, a
 * candy rack, a tip jar, a 'PAY HERE' sign on a pole; coins on the floor, the cashier's stool knocked over behind.
 */
export function cashierStation(c, x, z, face, { w = 1.4, d = 0.7, T = 0.95 } = {}) {
  const { X, M, G, U, rnd } = c;
  const f = fr(x, z, face);
  const fb = fr(x, z, OPP[face]); // (the cashier's side)
  lineBody(c, f, w, d, T);
  // the POS: a base, a screen turned to the cashier, the drawer out
  const ap = 0.15;
  R(c, f, X.charcoal, ap, T + 0.05, -0.12, 0.38, 0.1, 0.32, 0.015);
  B(c, f, X.charcoal, ap - 0.17, T + 0.0, -0.32, ap + 0.17, T + 0.08, -0.16, 'fblr');
  B(c, f, X.stainless, ap - 0.15, T + 0.075, -0.33, ap + 0.15, T + 0.08, -0.17, 't');
  for (let i = 0; i < 4; i++) B(c, f, M.dark, ap - 0.14 + i * 0.07, T + 0.08, -0.32, ap - 0.08 + i * 0.07, T + 0.081, -0.25, 't');
  Cy(c, f, X.charcoal, ap, T + 0.1, -0.1, 0.02, 0.02, 0.14, 6);
  A(c, f, X.charcoal, boxG(0.3, 0.22, 0.03), ap, T + 0.33, -0.08);
  lbl(c, fb, ['NOX CAFÉ · TILL 1', 'TOTAL  0.00', 'SESSION LOCKED'], -ap, T + 0.33, 0.098, 0.26, 0.17, { bg: '#0d2436', fg: '#8fd3ff', font: 'bold 30px monospace' });
  // the customer's card reader on its stand, the receipt printer with a long receipt hanging off the edge
  Cy(c, f, X.charcoal, -0.15, T, 0.2, 0.04, 0.03, 0.1, 8);
  A(c, f, X.charcoal, boxG(0.09, 0.16, 0.04), -0.15, T + 0.17, 0.2, -0.4);
  A(c, f, G.j_keypad, boxG(0.06, 0.04, 0.002), -0.15, T + 0.21, 0.222, -0.4);
  B(c, f, X.pale, -0.5, T, -0.25, -0.34, T + 0.12, -0.05, 'flrtb');
  A(c, f, X.paper, boxG(0.07, 0.003, 0.3), -0.42, T + 0.11, 0.07, 0.12);
  B(c, f, X.paper, -0.455, T, 0.2, -0.385, T + 0.002, d / 2 + 0.038, 't');
  B(c, f, X.paper, -0.455, T - 0.28, d / 2 + 0.035, -0.385, T, d / 2 + 0.038, 'f');
  // the candy rack on the front edge: three steps of bars
  for (let k = 0; k < 3; k++) {
    B(c, f, X.chrome, w / 2 - 0.42, T + k * 0.07, 0.12 - k * 0.09, w / 2 - 0.06, T + k * 0.07 + 0.01, 0.3 - k * 0.09, 't');
    for (let i = 0; i < 5; i++) if (rnd() < 0.75) B(c, f, pick(c, [M.red, M.blue, X.j_purple, X.j_choc, M.yellow]), w / 2 - 0.41 + i * 0.07, T + k * 0.07 + 0.01, 0.14 - k * 0.09, w / 2 - 0.36 + i * 0.07, T + k * 0.07 + 0.03, 0.27 - k * 0.09, 'tf');
  }
  A(c, f, U.glass, cylG(0.06, 0.06, 0.14, 10, true), -w / 2 + 0.12, T + 0.07, 0.15);
  lbl(c, f, 'TIPS ♥', -w / 2 + 0.12, T + 0.08, 0.215, 0.1, 0.04, { bg: '#fbfbf4', fg: '#b3392f', font: 'bold 30px Arial' });
  // the sign on its pole
  Cy(c, f, X.chrome, -w / 2 + 0.06, T, -d / 2 + 0.08, 0.015, 0.015, 1.0, 6);
  A(c, f, X.j_front, boxG(0.5, 0.18, 0.02), -w / 2 + 0.06, T + 1.06, -d / 2 + 0.08);
  lbl(c, f, 'PAY HERE', -w / 2 + 0.06, T + 1.06, -d / 2 + 0.091, 0.46, 0.15, { bg: '#285d86', fg: '#ffffff', font: 'bold 52px Arial' });
  // coins on the counter and the floor; the stool on its side behind
  for (let i = 0; i < 9; i++) {
    const onTop = i < 3, [cx, cz] = at(f, jit(c, w / 2), onTop ? jit(c, 0.25) : -d / 2 - 0.25 + jit(c, 0.2));
    c.K.add(X.brass, cylG(0.012, 0.012, 0.003, 5, true), cx, (onTop ? T : 0) + 0.002, cz);
  }
  barStool(c, ...at(f, -0.2, -d / 2 - 0.35), { down: true, yaw: f.yaw + 0.4 + jit(c, 0.3) });
  col(c, f, -w / 2, -d / 2, w / 2, d / 2 + 0.3, 0, T, SURF.metal);
}

// ---------------------------------------------------------------- the mess hall: the kitchen's openings
/**
 * The kitchen's pass on the wall at (x, z) facing `face`: a stainless surround round a dark opening (y0..y1, w wide),
 * the pass shelf with plates still waiting under a heat-lamp gantry, a ticket rail, and the roller shutter in its
 * guides pulled `down` of the way (0..1) and left there; a bloody hand dragged down the slats. 'PICK-UP' on the box.
 */
export function kitchenPass(c, x, z, face, { w = 2.8, y0 = 1.0, y1 = 2.25, down = 0.5, blood = true } = {}) {
  const { X, M, G, rnd } = c;
  const f = fr(x, z, face);
  // the opening (the dark kitchen) and its surround, the pass shelf
  B(c, f, M.black, -w / 2, y0, 0, w / 2, y1, 0.003, 'f');
  for (const s of [-1, 1]) B(c, f, X.stainless, s < 0 ? -w / 2 - 0.07 : w / 2, y0 - 0.04, 0, s < 0 ? -w / 2 : w / 2 + 0.07, y1 + 0.06, 0.05, 'flrt');
  B(c, f, X.stainless, -w / 2 - 0.07, y0 - 0.04, 0, w / 2 + 0.07, y0, 0.34, 'flrtd');
  for (const s of [-1, 1]) A(c, f, X.stainless, boxG(0.025, 0.2, 0.025), s * (w / 2 - 0.15), y0 - 0.13, 0.15, -0.8);
  // the roller shutter: its box over the opening, the guides, the curtain of slats, the bottom bar with two pulls
  const ys = y1 - down * (y1 - y0);
  B(c, f, X.j_shutter, -w / 2 - 0.12, y1 + 0.06, 0, w / 2 + 0.12, y1 + 0.34, 0.26, 'flrtd');
  lbl(c, f, 'PICK-UP · HOT PASS', 0, y1 + 0.2, 0.262, 1.1, 0.14, { bg: '#1b2127', fg: '#ffd27a', font: 'bold 46px Arial' });
  for (const s of [-1, 1]) B(c, f, X.j_shutterDark, s < 0 ? -w / 2 - 0.06 : w / 2 + 0.01, y0, 0.05, s < 0 ? -w / 2 - 0.01 : w / 2 + 0.06, y1 + 0.06, 0.1, 'flrt');
  B(c, f, X.j_shutter, -w / 2 - 0.02, ys, 0.065, w / 2 + 0.02, y1 + 0.06, 0.075, 'f');
  for (let y = ys + 0.07; y < y1 + 0.04; y += 0.075) B(c, f, X.j_shutterDark, -w / 2 - 0.02, y, 0.075, w / 2 + 0.02, y + 0.008, 0.077, 'ft');
  B(c, f, X.j_shutterDark, -w / 2 - 0.02, ys - 0.045, 0.06, w / 2 + 0.02, ys, 0.085, 'fdt');
  for (const s of [-1, 1]) B(c, f, X.chrome, s * w * 0.3 - 0.04, ys - 0.07, 0.085, s * w * 0.3 + 0.04, ys - 0.055, 0.1, 'flrtd');
  // the heat-lamp gantry in front of the shutter, over the shelf; a ticket rail on its front edge
  const yg = Math.min(ys - 0.1, y0 + 0.6);
  for (const s of [-1, 1]) Cy(c, f, X.chrome, s * (w / 2 - 0.1), y0, 0.26, 0.014, 0.014, yg - y0, 6);
  B(c, f, X.stainless, -w / 2 + 0.06, yg, 0.1, w / 2 - 0.06, yg + 0.07, 0.3, 'fblrtd');
  B(c, f, G.j_heat, -w / 2 + 0.1, yg - 0.002, 0.13, w / 2 - 0.1, yg, 0.27, 'd');
  Fac.ticketRail(c, ...atY(f, -0.25, yg + 0.015, 0.3), face, { w: 1.5, tickets: [['#41', 'CHK RICE', 'x2'], ['#42', 'LASAGNE', 'NO CHS'], ['#43', 'SOUP x3'], ['#44', 'CHK RICE'], ['#45', '???']] });
  // plates that never went out, one with a cloche
  for (let i = 0; i < 4; i++) {
    if (rnd() < 0.2) continue;
    const a = -w / 2 + 0.35 + i * ((w - 0.7) / 3) + jit(c, 0.05);
    const [px, pz] = at(f, a, 0.17);
    c.K.add(M.white, cylG(0.12, 0.13, 0.02, 12), px, y0 + 0.01, pz);
    if (i === 2) c.K.add(X.stainless, cached('dome', () => new THREE.SphereGeometry(0.12, 10, 3, 0, PI * 2, 0, PI / 2)), px, y0 + 0.02, pz, null, [1, 0.7, 1]);
    else c.K.add(pick(c, [X.food, X.foodPale, X.foodGreen]), sphG(0.07, 5, 3), px + jit(c, 0.03), y0 + 0.025, pz, [0, rnd() * 6, 0], [1.2, 0.35, 1]);
  }
  c.light(...atY(f, 0, y0 + 0.2, 0.25), 0.32, 1.1, [1.0, 0.55, 0.25], DOWN, 2.4);
  if (blood) c.wallDecal?.('bloodSmear', ...atY(f, w * 0.18, (ys + y1) / 2, 0.08), face, 0.35, Math.min(0.8, y1 - ys));
}
/**
 * The dish-return hatch on the wall at (x, z) facing `face`: a low opening (from y0, h high) behind a curtain of PVC
 * strips, a roller conveyor on its sill with trays still on it, a cabinet under it, 'RETURN' over it and the scraping
 * notice beside it.
 */
export function returnHatch(c, x, z, face, { w = 1.4, y0 = 0.9, h = 0.7 } = {}) {
  const { X, M, U, rnd } = c;
  const f = fr(x, z, face);
  // the cabinet and the sill
  B(c, f, X.j_front, -w / 2, 0.1, 0, w / 2, y0 - 0.03, 0.4, 'flrt');
  B(c, f, M.black, -w / 2 + 0.02, 0, 0, w / 2 - 0.02, 0.1, 0.36, 'flr');
  B(c, f, X.stainless, -w / 2 - 0.04, y0 - 0.03, 0, w / 2 + 0.04, y0, 0.43, 'flrt');
  // the opening, its surround, the strip curtain
  B(c, f, M.black, -w / 2 + 0.05, y0, 0, w / 2 - 0.05, y0 + h, 0.003, 'f');
  for (const s of [-1, 1]) B(c, f, X.stainless, s < 0 ? -w / 2 - 0.04 : w / 2 - 0.05, y0, 0, s < 0 ? -w / 2 + 0.05 : w / 2 + 0.04, y0 + h + 0.06, 0.05, 'flrt');
  B(c, f, X.stainless, -w / 2 - 0.04, y0 + h, 0, w / 2 + 0.04, y0 + h + 0.06, 0.06, 'flrtd');
  const ns = Math.round((w - 0.1) / 0.11);
  for (let i = 0; i < ns; i++) {
    const a = -w / 2 + 0.05 + (i + 0.5) * ((w - 0.1) / ns);
    A(c, f, U.glass, boxG(0.1, h - 0.04, 0.004), a, y0 + h / 2 + 0.02, 0.03 + (i % 2) * 0.006, jit(c, 0.03), 0, 0);
  }
  // the conveyor's rollers on the sill, trays on them (one half through the curtain)
  for (let i = 0; i < 4; i++) Ca(c, f, X.chrome, 0, y0 + 0.02, 0.07 + i * 0.09, 0.018, w - 0.12, 8);
  for (let i = 0; i < 2; i++) {
    const [tx, tz] = at(f, -0.3 + i * 0.55 + jit(c, 0.03), 0.23);
    c.K.add(M.tray, boxG(0.44, 0.02, 0.32), tx, y0 + 0.05, tz, [0, f.yaw + PI / 2 + jit(c, 0.05), 0]);
    c.K.add(M.white, cylG(0.1, 0.11, 0.018, 10), tx + jit(c, 0.06), y0 + 0.07, tz);
    if (rnd() < 0.7) c.K.add(X.food, sphG(0.04, 5, 3), tx, y0 + 0.08, tz, [0, rnd() * 6, 0], [1.4, 0.3, 1]);
  }
  lbl(c, f, 'RETURN', 0, y0 + h + 0.24, 0.012, 0.9, 0.24, { bg: '#285d86', fg: '#ffffff', font: 'bold 72px Arial' });
  lbl(c, f, ['PLEASE SCRAPE', 'YOUR PLATE', 'STACK TRAYS', 'CUPS ▸ RACK'], w / 2 + 0.3, y0 + h - 0.2, 0.012, 0.36, 0.42, { bg: '#fbfbf4', fg: '#1d4f7a', border: '#1d4f7a', font: 'bold 34px Arial' });
  col(c, f, -w / 2 - 0.04, 0, w / 2 + 0.04, 0.43, 0, y0, SURF.metal);
}

// ---------------------------------------------------------------- the mess hall: machines, the casualty, the walls
/**
 * A snack machine against the wall at (x, z) facing `face`: a navy cabinet with a lit window onto five shelves of
 * chocolate, crisps and biscuits (some sold), the keypad column (display, keys, coin slot, note reader), the pickup
 * flap, a lit header. smashed: the window put in, the stock looted, wrappers and glass on the floor, the light dead.
 */
export function snackMachine(c, x, z, face, { w = 0.9, d = 0.8, h = 1.85, lit = true, smashed = false, brand = 'SNACKS' } = {}) {
  const { X, M, G, U, rnd } = c;
  const f = fr(x, z, face);
  const on = lit && !smashed, aw = w / 2 - 0.3; // the window's right edge (the keypad column beyond)
  for (const s of [-1, 1]) B(c, f, X.j_vendBody, s < 0 ? -w / 2 : w / 2 - 0.04, 0.05, 0, s < 0 ? -w / 2 + 0.04 : w / 2, h, d, 'flrt');
  B(c, f, X.j_vendBody, -w / 2 + 0.04, h - 0.22, 0, w / 2 - 0.04, h, d, 'fdt');
  B(c, f, X.j_vendBody, -w / 2 + 0.04, 0.05, 0, w / 2 - 0.04, 0.5, d, 'ft');
  B(c, f, M.black, -w / 2 + 0.03, 0, 0.03, w / 2 - 0.03, 0.05, d - 0.05, 'flr');
  B(c, f, on ? G.j_vendHead : X.charcoal, -w / 2 + 0.06, h - 0.19, d, w / 2 - 0.06, h - 0.04, d + 0.004, 'f');
  lbl(c, f, brand, 0, h - 0.115, d + 0.005, w - 0.16, 0.13, { bg: on ? '#1f6fd0' : '#22324a', fg: '#ffffff', font: 'bold italic 56px Arial' });
  // the pickup flap
  B(c, f, M.black, -w / 2 + 0.08, 0.12, d, aw - 0.04, 0.34, d + 0.006, 'f');
  B(c, f, X.j_vendGrey, -w / 2 + 0.08, 0.32, d + 0.006, aw - 0.04, 0.34, d + 0.03, 'fdt');
  lbl(c, f, 'PUSH', (-w / 2 + aw) / 2 + 0.02, 0.27, d + 0.007, 0.12, 0.04, { bg: '#111111', fg: '#e8edf0', font: 'bold 30px Arial' });
  // the keypad column: a display, the keys, the coin slot and return, the note reader, a sticker
  B(c, f, X.j_vendGrey, aw, 0.5, 0.06, w / 2 - 0.04, h - 0.22, d, 'fl');
  B(c, f, on ? G.j_keypad : M.dark, aw + 0.04, 1.42, d, w / 2 - 0.08, 1.5, d + 0.004, 'f');
  B(c, f, M.dark, aw + 0.05, 1.08, d, w / 2 - 0.09, 1.36, d + 0.006, 'f');
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) B(c, f, X.chrome, aw + 0.065 + k * 0.05, 1.1 + r * 0.065, d + 0.006, aw + 0.1 + k * 0.05, 1.14 + r * 0.065, d + 0.014, 'ft');
  B(c, f, X.chrome, aw + 0.08, 0.92, d, aw + 0.17, 1.0, d + 0.012, 'flrt');
  B(c, f, M.black, aw + 0.11, 0.95, d + 0.012, aw + 0.14, 0.99, d + 0.013, 'f');
  B(c, f, M.black, aw + 0.07, 0.72, d, aw + 0.2, 0.82, d + 0.02, 'flrt');
  B(c, f, M.black, aw + 0.09, 0.56, d, aw + 0.19, 0.64, d + 0.03, 'flrtd');
  lbl(c, f, ['EXACT CHANGE', 'ONLY'], aw + 0.13, 1.6, d + 0.002, 0.18, 0.08, { bg: '#ffd23a', fg: '#1b2127', font: 'bold 30px Arial' });
  // inside the window: the lit back, five shelves of stock
  B(c, f, on ? G.j_vend : M.dark, -w / 2 + 0.04, 0.5, 0.06, aw, h - 0.22, 0.07, 'f');
  const stock = [M.red, M.blue, X.j_purple, X.j_choc, M.yellow, M.green, X.f2_mustard];
  const ns = 6, sw = (aw + w / 2 - 0.1) / ns;
  for (let i = 0; i < 5; i++) {
    const y = 0.56 + i * 0.235;
    B(c, f, X.chrome, -w / 2 + 0.04, y, 0.08, aw, y + 0.012, d - 0.08, 'td');
    const m = pick(c, stock);
    for (let k = 0; k < ns; k++) {
      if (rnd() < (smashed ? 0.75 : 0.18)) continue;
      const a = -w / 2 + 0.07 + sw * (k + 0.5), hh = 0.12 + ((i * 7 + k * 3) % 5) * 0.012;
      B(c, f, k % 2 ? m : stock[(i + k) % stock.length], a - sw * 0.36, y + 0.012, d - 0.24, a + sw * 0.36, y + 0.012 + hh, d - 0.1, 'flrt');
    }
    B(c, f, X.chrome, -w / 2 + 0.05, y + 0.02, d - 0.09, aw - 0.01, y + 0.035, d - 0.085, 'ft'); // the coil ends
  }
  // the window: glass in a frame, or put in
  for (const [a0, a1, y0, y1] of [[-w / 2 + 0.04, aw, 0.48, 0.52], [-w / 2 + 0.04, aw, h - 0.24, h - 0.2], [-w / 2 + 0.04, -w / 2 + 0.07, 0.5, h - 0.22], [aw - 0.03, aw, 0.5, h - 0.22]]) B(c, f, X.charcoal, a0, y0, d - 0.04, a1, y1, d, 'flrt');
  if (!smashed) B(c, f, U.glass, -w / 2 + 0.07, 0.52, d - 0.03, aw - 0.03, h - 0.24, d - 0.02, 'f');
  else {
    for (const [a, y, r] of [[-w / 2 + 0.1, 0.7, 0.4], [aw - 0.07, 1.5, -0.6], [-w / 2 + 0.12, 1.45, 2.4]]) A(c, f, U.glass, boxG(0.08, 0.2, 0.004), a, y, d - 0.025, 0, 0, r);
    for (let i = 0; i < 10; i++) {
      const [px, pz] = at(f, jit(c, 0.7), d + 0.2 + rnd() * 0.9);
      c.K.add(pick(c, stock), boxG(0.07, 0.025, 0.14), px, 0.013, pz, [0, rnd() * 6, 0]);
    }
    c.decal?.('glass', ...at(f, 0, d + 0.45), 1.1, rnd() * 6);
  }
  if (on) c.light(...atY(f, -0.1, 1.2, d + 0.45), 0.28, 1.1, [0.9, 0.95, 1.0], null, 2.6);
  col(c, f, -w / 2, 0, w / 2, d, 0, h, SURF.metal);
}
/**
 * A wheeled stretcher gone over on its side at (x, z), its length along `yaw`: the steel deck, rails and the raised
 * backrest stand up like a wall, the castors in the air; the mattress slid off beside it with a sheet, the IV pole
 * down across the floor, blood under it all and dragged away (toward `yaw` + PI/2 + drag).
 */
export function toppledGurney(c, x, z, yaw = 0, { drag = 0 } = {}) {
  const { X, M, rnd } = c;
  const g = grp(c, x, 0.33, z, yaw, 0, PI / 2);
  g(X.stainless, boxG(0.6, 0.03, 1.9), 0, 0.68, 0);
  for (const s of [-1, 1]) g(X.chrome, cylG(0.016, 0.016, 1.9, 6), s * 0.31, 0.74, 0, PI / 2);
  g(X.stainless, boxG(0.58, 0.03, 0.6), 0, 0.84, 0.62, -0.5);
  g(X.chrome, torG(0.25, 0.013, 4, 10, PI), 0, 0.74, -0.97);
  g(X.charcoal, boxG(0.5, 0.05, 1.5), 0, 0.22, 0);
  for (const v of [-0.5, 0.5]) g(X.stainless, cylG(0.045, 0.045, 0.44, 8), 0, 0.45, v);
  for (const [s, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g(M.black, cylG(0.06, 0.06, 0.04, 6), s * 0.24, 0.07, v * 0.7, 0, 0, PI / 2);
    g(X.chrome, boxG(0.05, 0.1, 0.03), s * 0.24, 0.15, v * 0.7);
  }
  g(X.j_mat, boxG(0.05, 0.5, 0.004), 0.31, 0.5, 0.2, 0, 0, 0.1); // a strap hanging
  const f = fr(x, z, yaw);
  // the mattress and the sheet beside it (on the deck's side), the IV pole down
  A(c, f, X.j_pad, rbox(0.6, 0.1, 1.85, 0.04), -1.15, 0.05, 0.1, 0, 0.18);
  A(c, f, X.j_sheet, boxG(1.1, 0.01, 0.9), -1.35, 0.11, -0.2, 0.05, -0.3, 0.06);
  A(c, f, X.j_sheet, boxG(0.7, 0.012, 0.5), -0.95, 0.006, -0.95, 0, 0.5);
  const [p0x, p0z] = at(f, 0.5, -0.6), [p1x, p1z] = at(f, 1.6, 0.9);
  c.K.rod(X.chrome, V(p0x, 0.03, p0z), V(p1x, 0.03, p1z), 0.012, 6);
  for (let k = 0; k < 4; k++) c.K.add(X.charcoal, boxG(0.3, 0.025, 0.03), p0x, 0.03, p0z, [0, k * PI / 2 + 0.3, 0]);
  c.K.add(X.bottle, boxG(0.12, 0.04, 0.2), p1x + 0.2, 0.02, p1z + 0.1, [0, rnd() * 6, 0]);
  c.decal?.('blood', ...at(f, -1.0, 0.3), 1.4, rnd() * 6);
  c.decal?.('bloodDrag', ...at(f, -1.9, 0.5 + drag), 2.2, yaw + PI / 2 + drag);
  col(c, f, -0.78, -0.98, 0.02, 0.98, 0, 0.66, SURF.metal);
}
/** a fabric-wrapped acoustic panel on the wall at (x, y, z) facing `face` (w × h, 5 cm thick) */
export function acousticPanel(c, x, y, z, face, { w = 1.2, h = 0.6, mat = null } = {}) {
  const f = fr(x, z, face);
  B(c, f, mat ?? c.X.j_felt1, -w / 2, y - h / 2, 0, w / 2, y + h / 2, 0.05, 'flrtd');
  B(c, f, c.M.dark, -w / 2 + 0.02, y - h / 2 - 0.01, 0, w / 2 - 0.02, y - h / 2, 0.035, 'd');
}
/** a wall horn speaker for the PA at (x, y, z) facing `face`, angled down on its bracket */
export function paSpeaker(c, x, y, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.charcoal, -0.05, y - 0.08, 0, 0.05, y + 0.08, 0.02, 'flrtd');
  A(c, f, X.charcoal, boxG(0.03, 0.03, 0.14), 0, y, 0.08);
  A(c, f, X.pale, cylG(0.05, 0.05, 0.12, 10), 0, y - 0.02, 0.17, PI / 2 + 0.35);
  A(c, f, X.pale, cylG(0.05, 0.13, 0.16, 12, true), 0, y - 0.07, 0.3, PI / 2 + 0.35);
  A(c, f, M.dark, cylG(0.12, 0.12, 0.004, 12), 0, y - 0.096, 0.375, PI / 2 + 0.35);
}
/** a hand-sanitizer dispenser on the wall at (x, y, z) facing `face`, a drip tray under it, the 'use on entry' card */
export function sanitizerStation(c, x, y, z, face) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  R(c, f, X.pale, 0, y, 0.055, 0.13, 0.26, 0.11, 0.02);
  B(c, f, U.glass, -0.035, y - 0.04, 0.11, 0.035, y + 0.06, 0.112, 'f');
  B(c, f, X.charcoal, -0.05, y - 0.13, 0.04, 0.05, y - 0.1, 0.12, 'fdt');
  B(c, f, X.pale, -0.07, y - 0.36, 0, 0.07, y - 0.33, 0.12, 'flrt');
  B(c, f, M.dark, -0.06, y - 0.33, 0.01, 0.06, y - 0.329, 0.11, 't');
  lbl(c, f, ['HAND SANITIZER', 'USE ON ENTRY'], 0, y + 0.3, 0.004, 0.22, 0.13, { bg: '#ffffff', fg: '#1f7a4a', border: '#1f7a4a', font: 'bold 30px Arial' });
}
/** spent brass round (x, z) (n cases within `spread`), mags: dropped pistol magazines among them */
export function spentCases(c, x, z, { n = 24, spread = 0.8, mags = 1 } = {}) {
  const { K, X, M, rnd } = c;
  for (let i = 0; i < n; i++) {
    const a = rnd() * PI * 2, r = Math.sqrt(rnd()) * spread;
    K.add(X.brass, cylG(0.0055, 0.0055, 0.02, 4, true), x + Math.sin(a) * r, 0.0055, z + Math.cos(a) * r, [PI / 2, rnd() * 6, 0, 'YXZ']);
  }
  for (let i = 0; i < mags; i++) K.add(M.black, boxG(0.032, 0.022, 0.13), x + jit(c, spread), 0.011, z + jit(c, spread), [0, rnd() * 6, 0]);
}

// ---------------------------------------------------------------- the locker room
/** a coat dropped on the floor at (x, z) turned `yaw`: the crumpled body, a sleeve flung out (mat: its cloth) */
export function floorCoat(c, x, z, yaw, mat = null) {
  const f = fr(x, z, yaw);
  const m = mat ?? c.X.labcoat;
  A(c, f, m, rbox(0.55, 0.06, 0.8, 0.03), 0, 0.045, 0, 0, 0, 0.05);
  A(c, f, m, rbox(0.3, 0.1, 0.35, 0.04), 0.05, 0.08, -0.2, 0.2, 0.4, 0);
  A(c, f, m, rbox(0.11, 0.06, 0.5, 0.03), 0.35, 0.03, 0.15, 0, -0.7, 0);
}
/** a pair of work boots at (x, y, z) turned `yaw` (fallen: the right one on its side) */
export function bootPair(c, x, z, yaw, { y = 0, fallen = null, mat = null } = {}) {
  const f = fr(x, z, yaw);
  const m = mat ?? c.X.charcoal;
  for (const s of [-1, 1]) {
    const down = s > 0 && (fallen ?? c.rnd() < 0.4);
    A(c, f, m, boxG(0.11, 0.06, 0.28), s * 0.08, y + (down ? 0.055 : 0.03), 0.04, 0, 0, down ? PI / 2 : 0);
    A(c, f, m, rbox(0.11, 0.2, 0.12, 0.03), s * 0.08 + (down ? 0.1 : 0), y + (down ? 0.055 : 0.14), -0.04, 0, 0, down ? PI / 2 : 0);
  }
}
/** a rubber boot tray on the floor against the wall at (x, z) facing `face`, w long, n pairs of boots on it */
export function bootTray(c, x, z, face, { w = 1.2, n = 2 } = {}) {
  const f = fr(x, z, face);
  B(c, f, c.X.j_mat, -w / 2, 0, 0.02, w / 2, 0.025, 0.38, 'flrt');
  for (let i = 0; i < n; i++) {
    const [bx, bz] = at(f, -w / 2 + (w * (i + 0.5)) / n + jit(c, 0.05), 0.2);
    bootPair(c, bx, bz, f.yaw + PI + jit(c, 0.25), { y: 0.025, fallen: i === n - 1 });
  }
}
/**
 * The changing room's centre bench at (x, z), len long (alongX, else along z): ash slats both sides of a spine of
 * steel posts with a hook rail on top and a hardboard panel, a wire shoe shelf under each seat; coats on a few hooks,
 * a towel and a bag left on the seat, boots under it.
 */
export function hookBench(c, x, z, alongX, { len = 3.8, coats = 4 } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, alongX ? 's' : 'e');
  const hl = len / 2;
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const b0 = s * (0.08 + k * 0.11);
      B(c, f, X.j_ash, -hl, 0.42, Math.min(b0, b0 + s * 0.09), hl, 0.45, Math.max(b0, b0 + s * 0.09), 'flrtd');
    }
    for (let k = 0; k < 2; k++) Ca(c, f, X.chrome, 0, 0.12, s * (0.15 + k * 0.17), 0.006, len - 0.2, 4);
  }
  const posts = [-hl + 0.1, 0, hl - 0.1];
  for (const a of posts) {
    B(c, f, X.charcoal, a - 0.025, 0, -0.025, a + 0.025, 1.75, 0.025, 'flrtb');
    B(c, f, X.charcoal, a - 0.02, 0.38, -0.4, a + 0.02, 0.42, 0.4, 'flrtbd');
    B(c, f, X.charcoal, a - 0.03, 0, -0.38, a + 0.03, 0.02, 0.38, 'flrtb');
    for (const s of [-1, 1]) B(c, f, X.charcoal, a - 0.015, 0.02, s > 0 ? 0.34 : -0.36, a + 0.015, 0.38, s > 0 ? 0.36 : -0.34, 'flrtb');
  }
  B(c, f, X.j_ash, -hl, 1.68, -0.03, hl, 1.75, 0.03, 'flrtbd');
  B(c, f, X.partition, -hl + 0.13, 0.55, -0.008, hl - 0.13, 1.3, 0.008, 'fb');
  // hooks both sides; coats on some
  const nh = Math.round(len / 0.38);
  let left = coats;
  for (let i = 0; i < nh; i++) {
    const a = -hl + (len * (i + 0.5)) / nh;
    for (const s of [-1, 1]) {
      A(c, f, X.chrome, boxG(0.012, 0.012, 0.07), a, 1.66, s * 0.06, s * 0.5);
      if (left > 0 && rnd() < coats / (nh * 2) * 1.6) {
        left--;
        const [hx, hz] = at(f, a, s * 0.1);
        Fac.coat(c, hx, 1.64, hz, f.yaw + (s > 0 ? 0 : PI) + jit(c, 0.15), pick(c, [X.labcoat, X.navy, X.denim, X.olive]), { long: rnd() < 0.5 });
      }
    }
  }
  // left on the bench and under it
  const [tx, tz] = at(f, -hl + 0.6 + rnd() * 0.4, 0.25);
  c.K.add(X.j_towel, rbox(0.32, 0.06, 0.24, 0.025), tx, 0.48, tz, [0, rnd() * 6, 0]);
  const [bx, bz] = at(f, hl - 0.7, -0.24);
  c.K.add(pick(c, [X.olive, X.navy, M.black]), cylG(0.14, 0.14, 0.55, 10), bx, 0.59, bz, [0, f.yaw, PI / 2, 'YXZ'], [1, 1, 0.8]);
  c.K.add(X.bottle, cylG(0.035, 0.035, 0.2, 8), ...atY(f, 0.3, 0.55, 0.3));
  bootPair(c, ...at(f, -0.5, 0.25), f.yaw, { y: 0.13 });
  bootPair(c, ...at(f, 0.9, -0.25), f.yaw + PI, { y: 0.13, fallen: false });
  col(c, f, -hl, -0.4, hl, 0.4, 0, 0.45, SURF.wood);
  col(c, f, -hl + 0.08, -0.03, hl - 0.08, 0.03, 0.45, 1.75, SURF.wood);
}

// ---------------------------------------------------------------- the mess hall: light tables and chairs (a hall seats 40)
/** the moulded chair shell's profile (seat curving up into the back), extruded across: about 36 triangles */
const shellG = () => cached('jshell', () => {
  const s = new THREE.Shape();
  const pts = [[0.22, 0.455], [-0.11, 0.465], [-0.16, 0.5], [-0.195, 0.62], [-0.22, 0.86], [-0.245, 0.858], [-0.22, 0.62], [-0.185, 0.485], [-0.125, 0.437], [0.215, 0.428]];
  s.moveTo(...pts[0]);
  for (const p of pts.slice(1)) s.lineTo(...p);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.44, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.22);
  g.rotateY(-PI / 2);
  return g;
});
/** the mess hall's stacking chair (about 70 triangles): a moulded shell on four steel legs at (x, z), its sitter looking toward `yaw`; down: on its side */
export function messChair(c, x, z, yaw, { down = false, mat = null } = {}) {
  const { X } = c;
  const m = mat ?? pick(c, [X.f2_shellRed, X.f2_shellTeal, X.f2_shellGrey]);
  const g = down ? grp(c, x, 0.25, z, yaw, jit(c, 0.15), c.rnd() < 0.5 ? PI / 2 : -PI / 2) : grp(c, x, 0, z, yaw);
  g(m, shellG(), 0, 0, 0);
  for (const [s, t] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) g(X.charcoal, cylG(0.011, 0.011, 0.44, 4, true), s * 0.19, 0.215, t * 0.16, t * -0.1, 0, s * 0.05);
}
/** a meal on a tray at (x, y, z) turned `yaw`, about 90 triangles: the plate of food, a cup or a can */
export function trayLite(c, x, y, z, yaw = 0) {
  const { K, M, X, rnd } = c;
  K.add(M.tray, boxG(0.44, 0.02, 0.32), x, y + 0.01, z, [0, yaw, 0]);
  const f = fr(x, z, yaw);
  A(c, f, M.white, cylG(0.1, 0.11, 0.018, 10), -0.08, y + 0.029, 0);
  A(c, f, pick(c, [X.food, X.foodGreen, X.foodPale]), sphG(0.06, 5, 3), -0.08 + jit(c, 0.02), y + 0.04, jit(c, 0.02), 0, rnd() * 3, 0, [1, 0.35, 0.9]);
  if (rnd() < 0.6) A(c, f, pick(c, [X.bottle, M.white, X.f2_can]), cylG(0.032, 0.035, 0.11, 6), 0.14, y + 0.075, -0.07);
}
/** a stack of n trays at (x, y, z) as one block with dark seams (cheap: the serving line has several) */
export function trayPile(c, x, y, z, n = 10, yaw = 0) {
  const { K, M } = c;
  const h = n * 0.021;
  K.add(M.tray, boxG(0.44, h, 0.32), x, y + h / 2, z, [0, yaw + jit(c, 0.02), 0]);
  for (let i = 1; i < n; i += 3) K.add(M.dark, boxG(0.442, 0.003, 0.322), x, y + i * 0.021, z, [0, yaw, 0]);
}
/**
 * A long mess table at (x, z) (alongX: its length along x, else z): a laminate top with a dark edge band on two
 * T-legs, `chairs` stacking chairs a side (some pushed back, one knocked over, a few gone), trays and cups left.
 */
export function messTable(c, x, z, alongX, { len = 2.4, chairs = 3, mess = 2, mat = null } = {}) {
  const { K, X, rnd } = c;
  const f = fr(x, z, alongX ? 's' : 'e');
  B(c, f, rnd() < 0.7 ? X.f2_laminate : X.f2_mint, -len / 2, 0.735, -0.4, len / 2, 0.76, 0.4, 'flrt');
  B(c, f, X.f2_edge, -len / 2 - 0.006, 0.715, -0.406, len / 2 + 0.006, 0.737, 0.406, 'flrtd');
  for (const s of [-1, 1]) {
    const a = s * (len / 2 - 0.32);
    Cy(c, f, X.f2_edge, a, 0.04, 0, 0.035, 0.03, 0.68, 6);
    B(c, f, X.f2_edge, a - 0.035, 0, -0.34, a + 0.035, 0.04, 0.34, 'flrt');
    B(c, f, X.f2_edge, a - 0.025, 0.68, -0.32, a + 0.025, 0.715, 0.32, 'flrd');
  }
  const cm = pick(c, [X.f2_shellRed, X.f2_shellTeal, X.f2_shellGrey]);
  for (const side of [-1, 1]) {
    for (let i = 0; i < chairs; i++) {
      if (rnd() < 0.15) continue;
      const a = -len / 2 + (len * (i + 0.5)) / chairs + jit(c, 0.06);
      const out = rnd() < 0.3 ? 0.25 + rnd() * 0.3 : 0;
      const [cx, cz] = at(f, a, side * (0.6 + out));
      messChair(c, cx, cz, f.yaw + (side > 0 ? PI : 0) + jit(c, out ? 0.6 : 0.1), { down: rnd() < 0.1, mat: cm });
    }
  }
  for (let i = 0; i < mess; i++) {
    const [px, pz] = at(f, jit(c, len / 2 - 0.3), jit(c, 0.2));
    const k = rnd();
    if (k < 0.5) trayLite(c, px, 0.76, pz, rnd() * 6);
    else if (k < 0.75) Fac.mug(c, px, 0.76, pz, null, rnd() * 6);
    else if (k < 0.88) K.add(X.f2_can, cylG(0.033, 0.033, 0.12, 8), px, 0.82, pz);
    else K.add(X.f2_can, cylG(0.033, 0.033, 0.12, 8), px, 0.793, pz, [PI / 2, rnd() * 6, 0, 'YXZ']);
  }
  col(c, f, -len / 2, -0.4, len / 2, 0.4, 0, 0.76, SURF.wood);
}

/** a stack of n mess chairs at (x, z) turned `yaw` (the spares, by the wall) */
export function chairStack(c, x, z, yaw = 0, n = 6, mat = null) {
  const { X } = c;
  const m = mat ?? X.f2_shellGrey;
  const g = grp(c, x, 0, z, yaw);
  for (let i = 0; i < n; i++) g(m, shellG(), 0, i * 0.06, i * 0.012);
  for (const [s, t] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) g(X.charcoal, cylG(0.011, 0.011, 0.44, 4, true), s * 0.19, 0.215, t * 0.16, t * -0.1, 0, s * 0.05);
  col(c, fr(x, z, yaw), -0.24, -0.26, 0.24, 0.26, 0, 0.9 + n * 0.06, SURF.metal);
}
/**
 * A barricade of mess tables at (x, z), w wide, knocked onto their sides with their tops toward `face` (where the
 * threat came from), chairs thrown against the front and dropped behind it.
 */
export function messBarricade(c, x, z, face, { w = 4.8 } = {}) {
  const { X, rnd } = c;
  const f = fr(x, z, face);
  const n = Math.max(1, Math.round(w / 2.45));
  for (let i = 0; i < n; i++) {
    const a = -w / 2 + (w * (i + 0.5)) / n;
    const [tx, tz] = at(f, a, jit(c, 0.06));
    Fac.tippedTable(c, tx, tz, face, { w: w / n - 0.08, mat: rnd() < 0.6 ? X.f2_laminate : X.f2_mint });
    for (let k = 0; k < 2; k++) {
      const [cx, cz] = at(f, a + jit(c, w / n / 2 - 0.3), 0.3 + rnd() * 0.15);
      messChair(c, cx, cz, rnd() * 6, { down: true });
    }
    const [bx, bz] = at(f, a + jit(c, 0.6), -1.05 - rnd() * 0.3);
    messChair(c, bx, bz, f.yaw + PI + jit(c, 0.8), { down: rnd() < 0.5 });
  }
}
/**
 * The hot-drinks station against the wall at (x, z) facing `face`: a counter with the cold-drinks dispenser, a coffee
 * urn with its tap and drip tray, stacks of paper cups and lids, a sugar caddy, the 'HOT DRINKS' card on the wall.
 */
export function drinksStation(c, x, z, face, { w = 1.6, d = 0.6, T = 0.92 } = {}) {
  const { X, M } = c;
  const f0 = fr(x, z, face);
  const [cx, cz] = at(f0, 0, d / 2);
  const f = fr(cx, cz, face);
  lineBody(c, f, w, d, T, { slide: false });
  Fac.drinkDispenser(c, ...atY(f, -w / 2 + 0.4, T, 0), face, { names: ['COLA', 'LEMON', 'WATER'] });
  // the urn: a steel drum on legs, a sight glass, the tap over a drip tray
  const au = 0.2;
  Cy(c, f, X.stainless, au, T + 0.06, -0.08, 0.15, 0.15, 0.42, 12);
  A(c, f, X.stainless, sphG(0.15, 12, 3, 0, PI * 2, 0, PI / 2), au, T + 0.48, -0.08, 0, 0, 0, [1, 0.35, 1]);
  Cy(c, f, X.charcoal, au, T + 0.53, -0.08, 0.03, 0.02, 0.04, 6);
  for (let k = 0; k < 3; k++) Cy(c, f, X.charcoal, au + Math.sin(k * 2.1) * 0.12, T, -0.08 + Math.cos(k * 2.1) * 0.12, 0.012, 0.012, 0.06, 4);
  B(c, f, c.U.glass, au - 0.012, T + 0.12, 0.068, au + 0.012, T + 0.4, 0.075, 'f');
  B(c, f, X.charcoal, au - 0.025, T + 0.1, 0.06, au + 0.025, T + 0.16, 0.12, 'flrt');
  B(c, f, X.stainless, au - 0.08, T, 0.08, au + 0.08, T + 0.015, 0.2, 'flrt');
  lbl(c, f, 'HOT WATER · COFFEE', au, T + 0.36, 0.152, 0.2, 0.05, { bg: '#1b2127', fg: '#ffd27a', font: 'bold 26px Arial' });
  // cups, lids, sugar
  for (let i = 0; i < 2; i++) A(c, f, M.white, cylG(0.034, 0.045, 0.32, 8, true), w / 2 - 0.3 + i * 0.1, T + 0.16, 0.12, PI);
  Cy(c, f, X.charcoal, w / 2 - 0.12, T, 0.15, 0.05, 0.05, 0.1, 8);
  B(c, f, X.chrome, w / 2 - 0.3, T, -0.21, w / 2 - 0.1, T + 0.1, -0.09, 'flrtb');
  for (let i = 0; i < 6; i++) B(c, f, i % 2 ? M.white : X.kraft, w / 2 - 0.29 + i * 0.03, T + 0.1, -0.18, w / 2 - 0.27 + i * 0.03, T + 0.14, -0.12, 'ft');
  lbl(c, f0, ['HOT DRINKS', 'TEA · COFFEE · SOUP'], 0.3, T + 0.75, 0.012, 0.5, 0.24, { bg: '#7a3b2e', fg: '#ffffff', font: 'bold 40px Arial' });
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, T, SURF.wood);
}

// ---------------------------------------------------------------- the rooms
/**
 * A queue line of chrome stanchions from (ax, az) to (bx, bz), n posts with black belts between them; down: the
 * indices of posts knocked over (their belts slack on the floor).
 */
export function queueStanchions(c, ax, az, bx, bz, { n = 4, down = [] } = {}) {
  const { K, X, M } = c;
  const dx = bx - ax, dz = bz - az, L0 = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), px = ax + dx * t, pz = az + dz * t;
    pts.push([px, pz]);
    if (down.includes(i)) {
      const a = yaw + PI / 2 + jit(c, 0.5);
      K.add(X.chrome, cylG(0.025, 0.025, 0.95, 8), px + Math.sin(a) * 0.48, 0.03, pz + Math.cos(a) * 0.48, [PI / 2, a, 0, 'YXZ']);
      K.add(X.charcoal, cylG(0.16, 0.17, 0.03, 8), px, 0.17, pz, [PI / 2, a, 0, 'YXZ']);
      continue;
    }
    K.add(X.charcoal, cylG(0.16, 0.17, 0.03, 8), px, 0.015, pz);
    K.add(X.chrome, cylG(0.025, 0.025, 0.92, 6, true), px, 0.49, pz);
    K.add(X.chrome, sphG(0.032, 6, 3), px, 0.96, pz);
  }
  const seg = L0 / (n - 1);
  for (let i = 0; i < n - 1; i++) {
    const [px, pz] = pts[i], [qx, qz] = pts[i + 1];
    const slack = down.includes(i) || down.includes(i + 1);
    K.add(M.black, boxG(0.004, 0.05, seg - 0.06), (px + qx) / 2, slack ? 0.01 : 0.9, (pz + qz) / 2, slack ? [0, yaw + jit(c, 0.2), PI / 2, 'YXZ'] : [0, yaw, 0]);
  }
}
/** a round canteen table (hiveFacility's) with `n` moulded chairs round it, one maybe knocked over */
function roundSet(c, x, z, { r = 0.45, n = 4, mat = null } = {}) {
  const { X, rnd } = c;
  Fac.roundTable(c, x, z, { r, chairs: 0, messy: false });
  const m = mat ?? pick(c, [X.f2_shellRed, X.f2_shellTeal, X.f2_shellGrey]);
  const spin = rnd() * PI;
  for (let i = 0; i < n; i++) {
    const a = spin + (i / n) * PI * 2 + jit(c, 0.3), dd = r + 0.22 + rnd() * 0.3;
    messChair(c, x + Math.sin(a) * dd, z + Math.cos(a) * dd, a + PI + jit(c, 0.4), { down: rnd() < 0.2, mat: m });
  }
  for (let i = 0; i < 2; i++) {
    const a = rnd() * 6, dd = rnd() * (r - 0.22);
    if (i === 0) trayLite(c, x + Math.sin(a) * dd, 0.75, z + Math.cos(a) * dd, rnd() * 6);
    else Fac.mug(c, x + Math.sin(a) * dd, 0.75, z + Math.cos(a) * dd, null, rnd() * 6);
  }
}
/** a meal tray dropped on the floor at (x, z): the plate beside it, food smeared, the cup rolled away */
function droppedTray(c, x, z) {
  const { K, M, X, rnd } = c;
  const yaw = rnd() * 6;
  K.add(M.tray, boxG(0.44, 0.02, 0.32), x, 0.012, z, [jit(c, 0.04), yaw, jit(c, 0.04), 'YXZ']);
  const px = x + Math.sin(yaw) * 0.35, pz = z + Math.cos(yaw) * 0.35;
  K.add(M.white, cylG(0.1, 0.11, 0.018, 12), px, 0.009, pz);
  K.add(pick(c, [X.food, X.foodGreen, X.foodPale]), sphG(0.06, 6, 4), px + jit(c, 0.2), 0.012, pz + jit(c, 0.2), [0, rnd() * 6, 0], [1, 0.25, 1.3]);
  if (rnd() < 0.6) K.add(M.white, cylG(0.04, 0.035, 0.1, 10), x - Math.sin(yaw) * 0.4, 0.04, z - Math.cos(yaw) * 0.4, [PI / 2, rnd() * 6, 0, 'YXZ']);
  c.decal?.('stain', px, pz, 0.6 + rnd() * 0.4, rnd() * 6);
}
/** a blood trail of drag decals along the points [[x, z], ...] */
function dragTrail(c, pts) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    c.decal?.('bloodDrag', (ax + bx) / 2, (az + bz) / 2, Math.min(2.6, Math.hypot(bx - ax, bz - az) + 0.3), Math.atan2(bx - ax, bz - az));
  }
}
/**
 * The mess hall (18 x 15.5 m, 5 m high, the upper east corridor looking down through the north wall): the serving
 * line along the south wall from the dish return to the till (tray start, salad bar, the hot counter whose bare west
 * end holds the M32, the till), the kitchen only showing through its pass, shutter pulled half down, a bloody hand
 * dragged down it; vinyl booths down the west wall, long tables in two columns, round tables behind the barricade of
 * tipped tables the staff threw up facing the corridor doors (spent brass behind it), the casualty's gurney gone over
 * in the east; snack machines (one smashed and looted) and a drinks cooler, a standing ledge with bar stools.
 */
export function dressCafe2(c, s, ctx) {
  const { X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  const zl = z1 - 1.05; // the serving line's counters: z 16.6..17.3, the staff behind them, the wall at z1
  // ---- the serving line, west to east
  returnHatch(c, 13.6, z1, 'n', { w: 1.4 });
  F2.kitchenBin(c, 14.75, z1 - 0.4);
  staffGate(c, 15.2, z1 - 0.35, 'w', { w: 0.7 });
  trayStart(c, 15.9, zl, 'n', { w: 1.3 });
  saladBar(c, 18.15, zl, 'n', { w: 3.1 });
  Fac.servingCounter(c, 19.75, zl - 0.35, 25.4, zl + 0.35, 'n', { clear: 1.0 }); // (the M32 lies on its bare x 19.75..20.75)
  cashierStation(c, 26.15, zl, 'n', { w: 1.4 });
  drinksStation(c, 28.65, z1, 'n', { w: 1.6 }); // (a metre's gap to the staff's side of the line east of the till)
  queueStanchions(c, 15.4, 15.2, 19.4, 15.2, { n: 5, down: [3] });
  // the south wall over the line: the pass with its shutter, menu boards, the clock, the staff's side
  kitchenPass(c, 23.1, z1, 'n', { w: 2.8, y0: 1.05, y1: 2.3, down: 0.55 });
  Fac.menuBoard(c, 17.3, 2.75, z1, 'n', { w: 2.4, h: 0.9, lines: ['TODAY · SUBLEVEL 4 MESS', 'Chicken & rice ......... 4.20', 'Lentil soup ............ 2.10', 'Veg lasagne ............ 3.80', 'Salad bar (per bowl) ... 2.50'] });
  Fac.menuBoard(c, 26.5, 2.75, z1, 'n', { w: 2.0, h: 0.9, lines: ['DRINKS · SNACKS', 'Coffee / tea ...... 0.90', 'Soft drinks ....... 1.20', 'Fruit cup ......... 1.20', 'STAFF CARD ONLY'] });
  Fac.wallClock(c, 13.8, 3.4, z1, 'n', { r: 0.3 });
  F2.handSink(c, 15.75, z1, 'n');
  Fac.wallPhone(c, 24.95, 1.5, z1, 'n', { number: 'KITCHEN  2210' });
  c.label(['ALLERGENS: ask staff', 'GLUTEN · NUTS · DAIRY', 'SOY · EGG · FISH'].join(' / '), 20.4, 1.65, z1 - 0.01, 'n', 0.5, 0.3, { lines: ['ALLERGENS: ask staff', 'GLUTEN · NUTS · DAIRY', 'SOY · EGG · FISH'], bg: '#fbfbf4', fg: '#7a1010', border: '#7a1010', font: 'bold 30px Arial' });
  for (const x of [17.1, 21.2, 25.3]) Fac.wallPlate(c, x, 1.15, z1, 'n');
  // ---- the east wall: the machines, the ledge, the notices
  snackMachine(c, x1, 14.65, 'w', { brand: 'SNACKS' });
  F2.drinksCooler(c, x1, 15.65, 'w', { w: 0.75, brand: 'NOX REFRESH' });
  snackMachine(c, x1, 16.6, 'w', { smashed: true, brand: 'CHOC · CRISPS' });
  wallLedge(c, x1, 7.0, 'w', { w: 4.0, stools: 3 });
  Fac.noticeBoard(c, x1, 10.3, 'w', { y: 1.8, w: 1.3, h: 0.8, pages: [['MESS HOURS', '06:30-20:00'], ['LOST: blue', 'thermos, Lab 4-B'], ['FAMILY DAY', 'CANCELLED'], ['5-a-side', 'THURSDAYS'], ['NO TRAYS', 'PAST THE DOORS']] });
  DD.aedCabinet(c, x1, 1.45, 11.6, 'w');
  HL.firstAidBox(c, x1, 1.55, 12.35, 'w');
  Fac.trashCan(c, x1 - 0.3, 13.6, { r: 0.2, h: 0.6 });
  Fac.wallPlate(c, x1, 0.3, 9.6, 'w');
  Fac.wallPlate(c, x1, 1.15, 4.6, 'w', 'switch');
  // ---- the west wall: the booths, a print over each; the fountain and the bins in the south-west corner
  [5.0, 6.86, 8.72, 10.58, 12.44].forEach((z, i) => {
    booth(c, x0, z, 'e', { len: 1.3, slashed: i === 3, mess: rnd() < 0.85 });
    Fac.wallPlate(c, x0, 0.95, z + 0.22, 'e');
    Fac.framed(c, x0, 1.82, z, 'e', { w: 0.62, h: 0.42, lines: [['ALPINE LAKES'], ['NOX · EST. 1998'], ['CORAL REEF'], ['THE FIRST ISOLATE'], ['DUNES']][i], bg: ['#5d88a6', '#285d86', '#2f8a8a', '#3b4a3a', '#c6a26a'][i], fg: '#ffffff' });
  });
  DD.drinkingFountain(c, x0, 14.3, 'e');
  Fac.recycleBin(c, x0 + 0.21, 15.65, 'e', { kinds: ['PAPER', 'GENERAL'] });
  Fac.plantPot(c, 12.5, 3.3, { size: 1.3, kind: 'tall' });
  // ---- the north wall (the corridor doors' leaves lie flat beside them): sanitizers, spare chairs, the TV, a mop
  sanitizerStation(c, 14.15, 1.3, z0, 's');
  sanitizerStation(c, 21.5, 1.3, z0, 's');
  chairStack(c, 13.4, 2.85, 0, 6, X.f2_shellGrey);
  Fac.tvOnWall(c, 21.5, 3.15, z0, 's', { w: 1.3, lines: ['NOX BIOSYSTEMS', 'SUBLEVEL 4 LOCKDOWN', 'REMAIN IN YOUR SECTOR'], bg: '#7a1010' });
  P.extinguisher(c, 27.9, z0, 's');
  Fac.mopBucket(c, 28.6, 3.0, 0.5);
  Fac.wetFloorSign(c, 28.9, 3.9, 0.3, { down: true });
  Fac.wallPlate(c, 13.85, 1.15, z0, 's', 'switch');
  // ---- high up, the double height: acoustic panels, the big lettering, PA horns, a camera
  for (const [i, z] of [4.6, 7.3, 10.0, 12.7].entries()) {
    acousticPanel(c, x0, 3.3, z, 'e', { w: 1.8, h: 1.0, mat: [X.j_felt1, X.j_felt2, X.j_felt3, X.j_felt1][i] });
    acousticPanel(c, x1, 3.3, z, 'w', { w: 1.8, h: 1.0, mat: [X.j_felt3, X.j_felt1, X.j_felt2, X.j_felt3][i] });
  }
  c.label('EAT · REST · RECHARGE', x0 + 0.01, 4.35, 8.65, 'e', 6.4, 0.55, { bg: '#e9dcae', fg: '#285d86', font: 'bold 72px Arial' });
  c.label('NOX BIOSYSTEMS · ONE TEAM', x1 - 0.01, 4.35, 8.65, 'w', 6.4, 0.55, { bg: '#e9dcae', fg: '#285d86', font: 'bold 72px Arial' });
  paSpeaker(c, x0, 4.0, 3.2, 'e');
  paSpeaker(c, x1, 4.0, 14.0, 'w');
  HL.cctvCam(c, x1, 4.1, 3.0, 'w', 0.5);
  Fac.wallClock(c, x1, 2.6, 4.1, 'w');
  // ---- the floor: two columns of long tables, the barricade between them facing the doors, round tables behind it
  for (const z of [5.9, 9.3, 12.7]) messTable(c, 16.3, z, true, { len: 2.4 });
  for (const z of [5.9, 9.3]) messTable(c, 26.2, z, true, { len: 2.4 });
  messBarricade(c, 21.3, 8.4, 'n', { w: 4.9 });
  roundSet(c, 19.9, 12.0, { n: 4 });
  roundSet(c, 22.9, 12.4, { n: 3 });
  toppledGurney(c, 26.3, 12.7, 0.3, { drag: -0.4 });
  // in front of the barricade: where the first of them came through the doors
  messChair(c, 19.2, 6.3, 1.1, { down: true });
  messChair(c, 22.7, 5.3, -2.0, { down: true });
  messChair(c, 20.9, 7.2, 0.4, { down: true });
  for (const [x, z] of [[20.2, 5.0], [23.1, 6.9], [18.6, 4.6]]) droppedTray(c, x, z);
  Fac.trashCan(c, 18.4, 7.5, { tipped: true });
  c.decal('blood', 21.4, 6.3, 1.3, rnd() * 6);
  c.decal('blood', 23.6, 4.6, 0.7, rnd() * 6);
  c.decal('footprints', 24.6, 5.2, 2.2, PI + 0.3);
  c.decal('footprints', 18.2, 5.0, 2.0, PI - 0.2);
  c.decal('paper', 19.6, 7.6, 1.2, rnd() * 6);
  for (const x of [17.6, 25.1]) c.wallDecal('bullet', x, 3.0 + jit(c, 0.2), z0, 's', 0.7, 0.5);
  // behind it: the brass, a tray or two, the blood, and the drag to the staff's side of the line
  spentCases(c, 21.0, 9.95, { n: 26, spread: 1.3, mags: 2 });
  for (const [x, z] of [[19.1, 10.3], [23.6, 10.4]]) droppedTray(c, x, z);
  c.decal('blood', 22.6, 10.0, 1.1, rnd() * 6);
  dragTrail(c, [[23.0, 10.2], [24.3, 11.3], [24.5, 13.6], [25.8, 15.4], [27.2, 16.6], [26.5, z1 - 0.35]]);
  c.decal('blood', 25.7, z1 - 0.35, 0.9, rnd() * 6);
  c.decal('puddle', 28.6, 16.4, 1.0, rnd() * 6); // (the drinks station's cola, run across the floor)
  c.decal('paper', 14.6, 9.2, 1.1, rnd() * 6);
  c.decal('stain', 16.9, 15.6, 0.9, rnd() * 6);
  c.decal('footprints', 14.2, 14.6, 1.8, 0.6);
  c.K.add(X.f2_can, cylG(0.033, 0.033, 0.12, 8), 13.9, 0.033, 14.9, [PI / 2, 1.2, 0, 'YXZ']);
  messChair(c, 14.4, 11.1, 2.2, { down: true });
}
/**
 * The staff locker room (4.5 x 7.5 m, the door from the corridor in the north-west): a bank of tall lockers down the
 * east wall and a two-tier bank along the south (a share jemmied open, a coat or a bag left in them), the hook bench
 * down the middle; on the west wall the PPE dispenser by the door, the basin and its mirror, towels, coat hooks over a
 * boot tray, the rail of clean lab coats and the soiled-coat cart; a full-length mirror and the first-aid box by the
 * door. Left behind: a lab coat on the floor, an open bag, a locker door torn off, boots, a smear of blood on a locker.
 */
export function dressLockers2(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the lockers and the bench (lanes of 1.3 m either side of it, 1.35 m past its south end)
  Fac.lockerBank(c, [x1 - 0.5, 3.0, x1 - 0.05, z1 - 0.45], 'w', { first: 101, forced: 0.3 }); // (5 cm off the wall: coats hang in the open ones)
  Fac.lockerBank(c, [31.6, z1 - 0.45, x1 - 0.5, z1], 'n', { first: 201, tiers: 2, forced: 0.25 });
  hookBench(c, 32.85, 6.3, false, { len: 3.8, coats: 4 });
  c.label(['LOCKER AUDIT FRIDAY', 'CLEAR OUT ALL FOOD'].join(' / '), x1 - 0.275, 1.5, 3.0, 'n', 0.38, 0.22, { lines: ['LOCKER AUDIT FRIDAY', 'CLEAR OUT ALL FOOD'], bg: '#fbfbf4', fg: '#1b2127', border: '#c63a2e', font: 'bold 28px Arial' });
  // the west wall, door to back: PPE, extinguisher, basin, towels, hooks over the boots, clean coats, the cart
  F2.ppeDispenser(c, x0, 1.45, 3.35, 'e');
  c.label(['LAB COATS & GLOVES OFF', 'BEFORE THE CANTEEN'].join(' / '), x0 + 0.01, 1.9, 3.35, 'e', 0.8, 0.2, { lines: ['LAB COATS & GLOVES OFF', 'BEFORE THE CANTEEN'], bg: '#1f5fa6', fg: '#ffffff', font: 'bold 32px Arial' });
  P.extinguisher(c, x0, 3.97, 'e');
  Fac.washbasin(c, x0, 4.6, 'e', { cracked: rnd() < 0.5 });
  Fac.paperTowelDispenser(c, x0, 1.35, 5.3, 'e');
  Fac.coatHooks(c, x0, 6.45, 'e', { w: 1.4, coats: 0.8 });
  bootTray(c, x0, 6.45, 'e', { w: 1.2, n: 2 });
  F2.garmentRail(c, 30.83, 8.15, 'e', { w: 1.3, n: 5 });
  Fac.laundryCart(c, 31.0, 9.45, 's');
  Fac.wallPlate(c, x0, 1.15, 2.85, 'e', 'switch');
  Fac.wallPlate(c, x0, 0.3, 7.3, 'e');
  // the north-east corner: a full-length mirror (proud of the cap rail), the clock, the first-aid box, the sign
  const fm = fr(34.6, z0, 's');
  B(c, fm, X.alu, -0.27, 0.43, 0, 0.27, 1.97, 0.04, 'flrtd');
  B(c, fm, X.mirror, -0.25, 0.45, 0.04, 0.25, 1.95, 0.043, 'f');
  if (rnd() < 0.6) c.wallDecal('crack', 34.65, 1.4, z0 + 0.046, 's', 0.35, 0.5);
  Fac.wallClock(c, 34.6, 2.45, z0, 's');
  HL.firstAidBox(c, x1, 1.55, 2.78, 'w');
  c.label('STAFF LOCKERS · L4', 33.3, 2.75, z0 + 0.01, 's', 1.4, 0.22, { bg: '#1b2127', fg: '#e8edf0', border: '#8a949c', font: 'bold 56px Arial' });
  // left behind
  floorCoat(c, 33.9, 3.75, 0.7, X.labcoat);
  Fac.duffelBag(c, 31.75, 5.25, 0.4);
  for (let i = 0; i < 3; i++) c.K.add(pick(c, [X.denim, X.j_towel, X.navy]), rbox(0.3, 0.04, 0.25, 0.02), 31.9 + jit(c, 0.35), 0.02, 5.75 + jit(c, 0.3), [0, rnd() * 6, 0]);
  c.K.add(M.lockerBlue, boxG(0.37, 0.02, 1.6), 33.6, 0.012, 8.85, [0, 1.2, 0]);
  bootPair(c, 31.95, 7.7, 2.0);
  bootPair(c, 34.15, 5.0, -0.5);
  c.K.add(X.j_towel, rbox(0.5, 0.03, 0.35, 0.015), 33.95, 0.015, 7.3, [0, 0.8, 0]);
  c.decal('footprints', 31.8, 4.4, 2.2, 0.1);
  c.decal('blood', 34.2, 6.5, 0.6, rnd() * 6);
  c.decal('paper', 33.2, 9.1, 0.9, rnd() * 6);
  c.wallDecal('bloodSmear', x1 - 0.5, 1.1, 6.7, 'w', 0.4, 0.7);
}
