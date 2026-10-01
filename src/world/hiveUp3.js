// The Hive's level 5, east and north (world/hive.js): the directors' offices over the open-plan offices, the isolation
// ward over the server room, and the elevator hall at the end of the upper west corridor, where the crashed car's
// shaft was pried open. Built like hiveProps.js / hiveFacility.js: world-space geometry for the Kit (one mesh per
// material, baked light) and a collider for whatever you'd bump into.
//
// c: hiveProps.js's context plus X (EXTRA_MATS of this module and of hiveLabs.js / hiveFacility.js / hiveDressD.js,
//    baked), G (their EXTRA_GLOW, emissive), label(text, x, y, z, face, w, h, opts), decal(kind, x, z, size, rot),
//    wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on). The dress functions get a context already
//    moved up to level 5: y 0 is the room's floor.
// Floor props take the centre of their footprint (x, z) and the `face` their front looks toward ('n' -z, 's' +z,
// 'w' -x, 'e' +x) or a yaw; wall props take the point on the wall line (the room rect's edge) and the face into the
// room. Nothing here is random but c.rnd().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import { SIGN } from './lab.js';
import * as P from './hiveProps.js';
import * as L from './hiveLabs.js';
import * as Fac from './hiveFacility.js';
import * as DA from './hiveDressA.js';
import * as DB from './hiveDressB.js';
import * as DD from './hiveDressD.js';
import * as TK from './hiveTech.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const FY = P.FACE_YAW;
const SICK = [0.75, 1.0, 0.6];

/** baked materials this module adds (hive.js builds them as c.X.<name>) */
export const EXTRA_MATS = {
  i_mahogany: { color: 0x4b2216, roughness: 0.36 }, // the partner desk, the credenza
  i_tan: { color: 0x84532f, roughness: 0.46 }, // tan leather (the club chairs, the chesterfield)
  i_inlay: { color: 0x1f3a2a, roughness: 0.55 }, // the desk's green leather writing surface
  i_sage: { color: 0x6c8574, roughness: 0.88 }, // the meeting chairs' wool
  i_cream: { color: 0xece6d6, roughness: 0.7 }, // model card, the safe's interior
  i_safe: { color: 0x2f3b34, metalness: 0.45, roughness: 0.5 }, // the old safe's green-black enamel
  i_gilt: { color: 0xc8a24e, metalness: 0.8, roughness: 0.3 },
  i_whisky: { color: 0x7e3f0e, roughness: 0.15 },
  i_cash: { color: 0x8fa287, roughness: 0.85 },
  i_dusk: { color: 0x25385a, roughness: 0.9 }, // the skyline print's sky
  i_sunset: { color: 0xd27a43, roughness: 0.9 },
  i_cellLam: { color: 0xcfdbcf, roughness: 0.5 }, // the ward's sickly pale-green laminate
  i_cellTrim: { color: 0x6d7d74, metalness: 0.5, roughness: 0.42 }, // painted steel of the cell fronts
  i_mattress: { color: 0x8ea6ad, roughness: 0.6 }, // blue-grey wipe-clean vinyl
  i_foam: { color: 0xd9cf9c, roughness: 0.95 }, // mattress foam where it's torn
  i_steelWC: { color: 0xb9c0c4, metalness: 0.85, roughness: 0.25 }, // the cells' stainless toilet-basins
  i_barrierRed: { color: 0xd23a1f, roughness: 0.55 },
  i_barrierWhite: { color: 0xeeeeea, roughness: 0.55 },
  i_rescue: { color: 0xe2621b, roughness: 0.5 }, // the rescue basket, the rope bag
  i_toolRed: { color: 0xa3231b, metalness: 0.35, roughness: 0.42 },
  i_turnout: { color: 0x48442f, roughness: 0.9 }, // a firefighter's coat
  i_hiVis: { color: 0xd7e330, roughness: 0.6 },
  i_rope: { color: 0x2f6fb0, roughness: 0.85 },
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  i_night: [0x9dffb0, 1.2], // the cells' night lights, the ward's green
  i_call: [0xff3a2a, 1.7], // nurse-call lamps, the lit call button
  i_floor: [0xff9a30, 1.5], // the elevator's floor indicator
  i_banker: [0xbfffc9, 1.2], // the banker's lamp's green shade, lit through
  i_bulb: [0xffd9a0, 1.8],
};

// ---------------------------------------------------------------- shared geometry and the local frame
const GEO = new Map();
const cached = (key, make) => {
  let g = GEO.get(key);
  if (!g) GEO.set(key, (g = make()));
  return g;
};
const r3 = (v) => Math.round(v * 1000) / 1000;
const rbox = (w, h, d, r = 0.02) => cached(`rb${r3(w)},${r3(h)},${r3(d)},${r3(r)}`, () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2.02, h / 2.02, d / 2.02)));
const boxG = (w, h, d) => cached(`bx${r3(w)},${r3(h)},${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
/** a centred cylinder along y: r0 at the bottom, r1 at the top */
const cylG = (r0, r1, h, seg = 10, open = false) => cached(`cy${r3(r0)},${r3(r1)},${r3(h)},${seg},${open}`, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open));
const sphG = (r, w = 10, h = 6) => cached(`sp${r3(r)},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const torG = (R, r, rs = 4, ts = 12, arc = PI * 2) => cached(`to${r3(R)},${r3(r)},${rs},${ts},${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const coneG = (r, h, seg = 3) => cached(`co${r3(r)},${r3(h)},${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];
const jit = (c, k) => (c.rnd() - 0.5) * 2 * k;

/** a local frame at (x, z) looking toward `face` (a letter, or a yaw in radians): `a` runs across it, `b` toward its front */
function fr(x, z, face) {
  const yaw = typeof face === 'number' ? face : FY[face];
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { x, z, yaw, cs: Math.abs(cs) < 1e-9 ? 0 : cs, sn: Math.abs(sn) < 1e-9 ? 0 : sn, face: typeof face === 'string' ? face : null };
}
const at = (f, a, b) => [f.x + a * f.cs + b * f.sn, f.z - a * f.sn + b * f.cs];
/** an axis-aligned box between two local corners (cardinal frames) */
function B(c, f, m, a0, y0, b0, a1, y1, b1) {
  const [x0, z0] = at(f, a0, b0), [x1, z1] = at(f, a1, b1);
  return c.K.box(m, Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1));
}
/** a geometry at local (a, y, b), turned rx (about a), ry (about y), rz (about b) in the frame */
function A(c, f, m, g, a, y, b, rx = 0, ry = 0, rz = 0, s = null) {
  const [x, z] = at(f, a, b);
  return c.K.add(m, g, x, y, z, [rx, f.yaw + ry, rz, 'YXZ'], s);
}
const R = (c, f, m, a, y, b, w, h, d, r = 0.02, ry = 0) => A(c, f, m, rbox(w, h, d, r), a, y, b, 0, ry);
const Cu = (c, f, m, a, y, b, w, h, d, ry = 0) => A(c, f, m, boxG(w, h, d), a, y, b, 0, ry);
/** a vertical cylinder standing on y0 */
const Cy = (c, f, m, a, y0, b, r0, r1, h, seg = 10) => A(c, f, m, cylG(r0, r1, h, seg), a, y0 + h / 2, b);
/** a cylinder lying along a / along b, centred */
const Ca = (c, f, m, a, y, b, r, len, seg = 8) => A(c, f, m, cylG(r, r, len, seg), a, y, b, 0, 0, PI / 2);
const Cb = (c, f, m, a, y, b, r, len, seg = 8) => A(c, f, m, cylG(r, r, len, seg), a, y, b, PI / 2);
/** a rod between two local points (a, y, b) */
function rodL(c, f, m, a0, y0, b0, a1, y1, b1, r, seg = 5) {
  const [x0, z0] = at(f, a0, b0), [x1, z1] = at(f, a1, b1);
  c.K.rod(m, V(x0, y0, z0), V(x1, y1, z1), r, seg);
}
/** a collider over the local rect (any yaw: its bounding box) */
function col(c, f, a0, b0, a1, b1, y0, y1, surf = SURF.metal) {
  const p = [at(f, a0, b0), at(f, a1, b0), at(f, a0, b1), at(f, a1, b1)];
  c.col(Math.min(...p.map((q) => q[0])), y0, Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), y1, Math.max(...p.map((q) => q[1])), surf);
}
/** a text label lying 2 mm proud of the surface at local depth b, facing the frame's front (cardinal frames) */
function lbl(c, f, text, a, y, b, w, h, opts = {}) {
  const [x, z] = at(f, a, b - 0.018); // (c.label puts it 0.02 out along its normal)
  c.label?.(opts.lines ? opts.lines.join(' / ') : text, x, y, z, f.face, w, h, opts);
}
const _E = new THREE.Euler(), _Q = new THREE.Quaternion(), _Pv = new THREE.Vector3(), _Sv = new THREE.Vector3(), _Lm = new THREE.Matrix4(), _Mm = new THREE.Matrix4();
/** parts of a thing that may lie tipped: given in its own space (u across, y up, v forward), placed by (x, y, z), yaw, a tilt rx / rz */
function grp(c, x, y, z, yaw, rx = 0, rz = 0) {
  const base = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), V(1, 1, 1));
  return (m, g, u, py, v, ax = 0, ay = 0, az = 0, s = null) => {
    _Lm.compose(_Pv.set(u, py, v), _Q.setFromEuler(_E.set(ax, ay, az, 'YXZ')), s ? _Sv.set(s[0], s[1], s[2]) : _Sv.set(1, 1, 1));
    return c.K.addMatrix(m, g, _Mm.multiplyMatrices(base, _Lm));
  };
}
/** label styles */
const WARN = { bg: '#e2b31a', fg: '#16181a', border: '#16181a', font: 'bold 48px Arial' };

// ---------------------------------------------------------------- the directors' offices
/**
 * A mahogany partner desk at (x, z), its front (the visitors' side) toward `face`: two pedestals of three drawers
 * opening toward the sitter, a modesty panel, the green leather writing surface with a brass edge, a banker's lamp
 * (lit: its shade glows), the blotter, a pen stand, a desk phone and a name block. `out`: the drawers (0..5, left
 * pedestal 0-2 from the top) left pulled out with files in them; `dropped`: one drawer lies upside down on the floor
 * behind, its papers spilled; `name` / `name2`: the brass name blocks on the front / back edge. w × d, top at 0.78.
 */
export function partnerDesk(c, x, z, face, { w = 2.0, d = 1.0, out = [1, 3], dropped = true, name = null, name2 = null, lamp = true } = {}) {
  const { M, X, G, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.78, pw = 0.46, ph = 0.68, b0 = -d / 2;
  R(c, f, X.i_mahogany, 0, T - 0.02, 0, w, 0.04, d, 0.012);
  Cu(c, f, X.i_inlay, 0, T + 0.0015, -0.02, w - 0.24, 0.003, d - 0.26);
  for (const s of [-1, 1]) Cu(c, f, X.brass, 0, T + 0.002, s * (d / 2 - 0.13) - 0.02, w - 0.22, 0.003, 0.008);
  for (const s of [-1, 1]) {
    const pa = s * (w / 2 - pw / 2 - 0.04);
    B(c, f, X.i_mahogany, pa - pw / 2, 0.06, b0 + 0.03, pa + pw / 2, T - 0.04, d / 2 - 0.03);
    B(c, f, M.dark, pa - pw / 2 + 0.02, 0, b0 + 0.05, pa + pw / 2 - 0.02, 0.06, d / 2 - 0.05);
    for (let k = 0; k < 3; k++) {
      const i = (s < 0 ? 0 : 3) + k, yc = T - 0.04 - (k + 0.5) * (ph / 3) + 0.03;
      if (out.includes(i) || (dropped && i === 5)) {
        const pull = out.includes(i) ? 0.26 + rnd() * 0.12 : 0;
        if (pull) {
          // pulled out toward the sitter: the box, its files riffled
          B(c, f, X.i_mahogany, pa - pw / 2 + 0.03, yc - 0.09, b0 - pull, pa - pw / 2 + 0.045, yc + 0.07, b0 + 0.25);
          B(c, f, X.i_mahogany, pa + pw / 2 - 0.045, yc - 0.09, b0 - pull, pa + pw / 2 - 0.03, yc + 0.07, b0 + 0.25);
          B(c, f, X.i_mahogany, pa - pw / 2 + 0.03, yc - 0.1, b0 - pull, pa + pw / 2 - 0.03, yc - 0.09, b0 + 0.25);
          for (let q = 0; q < 4; q++) Cu(c, f, pick(c, [X.paper, X.kraft, M.card]), pa + jit(c, 0.05), yc - 0.02, b0 - pull + 0.05 + q * 0.06, 0.32, 0.15, 0.008, jit(c, 0.08));
        }
        Cu(c, f, X.i_mahogany, pa, yc, b0 - pull - 0.01, pw - 0.04, ph / 3 - 0.03, 0.025);
        Cu(c, f, X.brass, pa, yc + 0.02, b0 - pull - 0.03, 0.1, 0.015, 0.018);
        if (!pull) B(c, f, M.black, pa - pw / 2 + 0.03, yc - 0.09, b0 - 0.004, pa + pw / 2 - 0.03, yc + 0.09, b0 + 0.01); // (the empty slot)
        continue;
      }
      Cu(c, f, X.i_mahogany, pa, yc, b0 - 0.005, pw - 0.04, ph / 3 - 0.03, 0.025);
      Cu(c, f, X.brass, pa, yc + 0.02, b0 - 0.025, 0.1, 0.015, 0.018);
    }
  }
  B(c, f, X.i_mahogany, -w / 2 + pw + 0.04, 0.28, d / 2 - 0.08, w / 2 - pw - 0.04, T - 0.04, d / 2 - 0.05);
  if (dropped) {
    // the bottom right drawer yanked out and dropped upside down behind the desk, its papers fanned out
    const pa = w / 2 - pw / 2 - 0.04;
    const [dx, dz] = at(f, pa + 0.25, b0 - 0.55);
    const g = grp(c, dx, 0.1, dz, f.yaw + 0.5, PI);
    g(X.i_mahogany, boxG(pw - 0.06, 0.012, 0.5), 0, -0.095, 0);
    for (const s of [-1, 1]) g(X.i_mahogany, boxG(0.015, 0.18, 0.5), s * (pw / 2 - 0.04), 0, 0);
    g(X.i_mahogany, boxG(pw - 0.04, 0.2, 0.025), 0, 0, 0.26);
    for (let q = 0; q < 4; q++) {
      const [px, pz] = at(f, pa + jit(c, 0.6), b0 - 0.6 + jit(c, 0.35));
      c.decal?.('paper', px, pz, 0.5 + rnd() * 0.3, rnd() * 6);
    }
  }
  // on the top: the banker's lamp, the blotter, pens, the phone, the name block
  const la = -w / 2 + 0.3, lb = -0.18;
  if (lamp) {
    Cy(c, f, X.brass, la, T, lb, 0.075, 0.07, 0.025, 12);
    Cy(c, f, X.brass, la, T + 0.025, lb, 0.011, 0.011, 0.3, 6);
    // the green glass shade, lit through (an oval tube lying across), its brass end caps
    A(c, f, G.i_banker, cylG(0.07, 0.07, 0.26, 10), la, T + 0.36, lb + 0.04, 0, 0, PI / 2, [0.6, 1, 1]);
    for (const s of [-1, 1]) A(c, f, X.brass, cylG(0.045, 0.045, 0.01, 8), la + s * 0.13, T + 0.355, lb + 0.04, 0, 0, PI / 2);
  }
  Cu(c, f, M.black, 0.1, T + 0.004, 0.02, 0.62, 0.006, 0.42);
  Cu(c, f, X.paper, 0.1, T + 0.008, 0.02, 0.58, 0.002, 0.38);
  Cy(c, f, X.brass, w / 2 - 0.4, T, -0.05, 0.035, 0.035, 0.09, 8);
  for (const da of [-0.012, 0.012]) A(c, f, M.black, cylG(0.005, 0.005, 0.14, 4), w / 2 - 0.4 + da, T + 0.12, -0.05, 0.12, 0, da * 15);
  R(c, f, M.black, w / 2 - 0.3, T + 0.03, -0.3, 0.2, 0.06, 0.22, 0.015, 0.3);
  A(c, f, M.black, rbox(0.2, 0.035, 0.05, 0.015), w / 2 - 0.3, T + 0.08, -0.34, 0, 0.3);
  if (name) {
    Cu(c, f, X.brass, -0.2, T + 0.035, d / 2 - 0.18, 0.4, 0.07, 0.03);
    lbl(c, f, name, -0.2, T + 0.035, d / 2 - 0.165 + 0.018, 0.38, 0.055, { bg: '#2a1a12', fg: '#e3c47a', border: '#c8a24e', font: 'bold 40px Georgia, serif' });
  }
  if (name2 && f.face) {
    const fb = fr(...at(f, 0.3, -d / 2 + 0.18), { s: 'n', n: 's', e: 'w', w: 'e' }[f.face]);
    Cu(c, fb, X.brass, 0, T + 0.035, 0, 0.4, 0.07, 0.03);
    lbl(c, fb, name2, 0, T + 0.035, 0.015 + 0.018, 0.38, 0.055, { bg: '#2a1a12', fg: '#e3c47a', border: '#c8a24e', font: 'bold 40px Georgia, serif' });
  }
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, T, SURF.wood);
}

/**
 * A brass bar cart at (x, z) turned yaw (long along its a): two glass-topped tiers, a big wheel pair at one end and the
 * push bar over them, a crystal decanter of whisky, bottles, tumblers, the ice bucket and tongs, a soda siphon;
 * `spilled`: a tumbler knocked off, smashed on the floor in a whisky stain.
 */
export function barCart(c, x, z, yaw = 0, { spilled = true } = {}) {
  const { M, U, X, rnd } = c;
  const f = fr(x, z, yaw);
  const W = 0.8, D = 0.45;
  for (const y of [0.3, 0.8]) {
    Cu(c, f, U.glass, 0, y, 0, W - 0.04, 0.008, D - 0.04);
    for (const s of [-1, 1]) {
      Cu(c, f, X.brass, 0, y + 0.015, s * (D / 2 - 0.01), W, 0.035, 0.012);
      Cu(c, f, X.brass, s * (W / 2 - 0.01), y + 0.015, 0, 0.012, 0.035, D);
    }
  }
  for (const [s, t] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) Cy(c, f, X.brass, s * (W / 2 - 0.01), 0.06, t * (D / 2 - 0.01), 0.011, 0.011, 0.78, 6);
  for (const t of [-1, 1]) {
    A(c, f, X.brass, torG(0.11, 0.012, 3, 12), W / 2 + 0.01, 0.12, t * (D / 2 + 0.02));
    A(c, f, M.black, cylG(0.1, 0.1, 0.012, 12), W / 2 + 0.01, 0.12, t * (D / 2 + 0.02), PI / 2);
    Cy(c, f, X.brass, -W / 2 + 0.01, 0, t * (D / 2 - 0.01), 0.02, 0.014, 0.06, 6);
  }
  A(c, f, X.brass, torG(D / 2, 0.011, 3, 8, PI), W / 2 - 0.05, 0.84, 0, PI / 2, PI / 2); // (the push handle, bowed out past the wheels)
  // the top tier: the decanter, bottles, glasses, the ice bucket
  Cy(c, f, U.glass, -0.22, 0.81, 0.05, 0.075, 0.07, 0.17, 10);
  Cy(c, f, X.i_whisky, -0.22, 0.815, 0.05, 0.066, 0.064, 0.09, 10);
  A(c, f, U.glass, sphG(0.032, 8, 5), -0.22, 1.01, 0.05);
  for (const [a, b, m, h] of [[-0.02, -0.12, X.i_whisky, 0.24], [0.06, -0.1, M.green, 0.27], [0.13, -0.13, X.cream, 0.22]]) {
    Cy(c, f, m, a, 0.81, b, 0.038, 0.038, h * 0.68, 8);
    Cy(c, f, m, a, 0.81 + h * 0.68, b, 0.038, 0.014, h * 0.14, 8);
    Cy(c, f, m, a, 0.81 + h * 0.82, b, 0.014, 0.014, h * 0.18, 6);
  }
  for (let i = 0; i < 3; i++) Cy(c, f, U.glass, 0.02 + i * 0.075, 0.81, 0.11, 0.032, 0.035, 0.085, 8);
  Cy(c, f, X.chrome, 0.27, 0.81, 0.06, 0.07, 0.085, 0.16, 10);
  Cy(c, f, U.glass, 0.27, 0.95, 0.06, 0.06, 0.06, 0.012, 8);
  // the lower tier: spare bottles lying, the soda siphon
  for (let i = 0; i < 3; i++) Ca(c, f, pick(c, [M.green, X.i_whisky, M.amber]), -0.15 + i * 0.05, 0.345, 0.04 * (i - 1) * 3, 0.036, 0.3, 8);
  Cy(c, f, M.blue, 0.24, 0.31, 0, 0.045, 0.045, 0.24, 8);
  Cy(c, f, X.chrome, 0.24, 0.55, 0, 0.03, 0.02, 0.06, 8);
  if (spilled) {
    const [px, pz] = at(f, jit(c, 0.3), D / 2 + 0.45);
    c.decal?.('stain', px, pz, 0.7, rnd() * 6);
    c.decal?.('glass', px + 0.1, pz, 0.5, rnd() * 6);
    for (let k = 0; k < 4; k++) c.K.add(U.glass, coneG(0.02, 0.05), px + jit(c, 0.2), 0.01, pz + jit(c, 0.2), [PI / 2, rnd() * 6, 0]);
  }
  col(c, f, -W / 2, -D / 2 - 0.04, W / 2 + 0.18, D / 2 + 0.04, 0, 0.9, SURF.metal);
}

/**
 * An old free-standing safe at (x, z), its door toward `face`: green-black enamel on a plinth, the gilt maker's
 * plate, combination dial and three-spoke handle; `open` (radians) swings the heavy door out on its +a hinge, showing
 * the cream lining, the shelf and the dark inside (emptied), a few banded bundles of cash dropped in front of it.
 */
export function floorSafe(c, x, z, face, { w = 0.64, d = 0.62, h = 0.98, open = 1.9, cash = 4 } = {}) {
  const { M, X, rnd } = c;
  const f = fr(x, z, face);
  B(c, f, M.dark, -w / 2 + 0.03, 0, -d / 2 + 0.03, w / 2 - 0.03, 0.07, d / 2 - 0.03);
  R(c, f, X.i_safe, 0, 0.07 + (h - 0.07) / 2, 0, w, h - 0.07, d, 0.03);
  const ow = w - 0.12, oh = h - 0.22, oy = 0.07 + (h - 0.07) / 2;
  const door = (fd, m) => {
    // the door slab (in its own frame: hinge at a 0, the slab toward -a)
    R(c, fd, X.i_safe, -ow / 2 - 0.01, oy, 0.05, ow + 0.04, oh + 0.04, 0.1, 0.02);
    Cb(c, fd, M.steel, -ow / 2, oy + 0.12, 0.11, 0.07, 0.025, 16);
    Cb(c, fd, M.black, -ow / 2, oy + 0.12, 0.125, 0.05, 0.01, 12);
    Cb(c, fd, X.chrome, -ow / 2, oy - 0.12, 0.12, 0.025, 0.04, 8);
    for (let k = 0; k < 3; k++) {
      const t = (k * 2 * PI) / 3 + 0.4;
      A(c, fd, X.chrome, cylG(0.008, 0.008, 0.11, 5), -ow / 2 + Math.cos(t) * 0.055, oy - 0.12 + Math.sin(t) * 0.055, 0.14, 0, 0, t - PI / 2);
    }
    Cu(c, fd, X.i_gilt, -ow / 2, oy + 0.3, 0.101, 0.26, 0.06, 0.004);
    B(c, fd, m, -ow + 0.03, oy - oh / 2 + 0.03, -0.002, -0.03, oy + oh / 2 - 0.03, 0.0);
  };
  if (open > 0.05) {
    // the opening: dark inside, the cream shelf edge and lining lip, one bundle left on the bottom
    B(c, f, M.black, -ow / 2, oy - oh / 2, d / 2 - 0.004, ow / 2, oy + oh / 2, d / 2 + 0.002);
    B(c, f, X.i_cream, -ow / 2, oy - 0.01, d / 2 - 0.05, ow / 2, oy + 0.01, d / 2 + 0.004);
    B(c, f, X.i_cream, -ow / 2, oy - oh / 2, d / 2 - 0.05, ow / 2, oy - oh / 2 + 0.015, d / 2 + 0.004);
    Cu(c, f, X.i_cash, 0.08, oy - oh / 2 + 0.04, d / 2 - 0.02, 0.16, 0.04, 0.07, 0.2);
    const [hx, hz] = at(f, w / 2 - 0.02, d / 2);
    const fd = fr(hx, hz, f.yaw + open);
    door(fd, X.i_cream);
    col(c, fd, -ow - 0.03, 0, 0, 0.1, 0.07, oy + oh / 2 + 0.02, SURF.metal);
  } else {
    const [hx, hz] = at(f, w / 2 - 0.02, d / 2);
    door(fr(hx, hz, f.yaw), X.i_safe);
  }
  for (let k = 0; k < cash; k++) {
    const [px, pz] = at(f, jit(c, 0.4), d / 2 + 0.25 + rnd() * 0.5);
    c.K.add(X.i_cash, boxG(0.16, 0.035 + (k % 2) * 0.02, 0.07), px, 0.022, pz, [0, rnd() * 3, 0]);
    c.K.add(X.paper, boxG(0.03, 0.04 + (k % 2) * 0.02, 0.072), px, 0.023, pz, [0, rnd() * 3, 0]);
  }
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, h, SURF.metal);
}

/**
 * The architect's model of the complex on its display table at (x, z), its front toward `face`: a walnut cabinet, the
 * site in white card on a concrete-grey board (the atrium's ring with its tank in green resin, the four corridors, the
 * wings of rooms, the pump hall down below as a cut-away block), red pins stuck where the outbreak spread, the brass
 * plaque; the acrylic hood shoved askew (`hood` 0..1).
 */
export function complexModel(c, x, z, face, { w = 1.7, d = 1.1, hood = 0.6, pins = 7 } = {}) {
  const { M, U, X, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.84;
  R(c, f, X.walnut, 0, T / 2, 0, w, T, d, 0.02);
  B(c, f, M.dark, -w / 2 + 0.04, 0, -d / 2 + 0.04, w / 2 - 0.04, 0.06, d / 2 - 0.04);
  for (const s of [-1, 1]) B(c, f, X.i_gilt, -w / 2 + 0.06, 0.2, s * (d / 2) - 0.003, w / 2 - 0.06, 0.212, s * (d / 2) + 0.003);
  B(c, f, M.grey, -w / 2 + 0.04, T, -d / 2 + 0.04, w / 2 - 0.04, T + 0.02, d / 2 - 0.04);
  const y0 = T + 0.02, s = Math.min((w - 0.16) / 92, (d - 0.16) / 60); // (the plan: 92 m across, the north 60 m of it)
  const P2 = (px, pz) => [px * s, (pz + 12) * s]; // (plan x / z → frame a / b: north at the back)
  const room = (x0, z0, x1, z1, hh = 0.035, m = X.i_cream) => {
    const [a0, b0] = P2(x0, z0), [a1, b1] = P2(x1, z1);
    B(c, f, m, Math.min(a0, a1), y0, Math.min(b0, b1), Math.max(a0, a1), y0 + hh, Math.max(b0, b1));
  };
  // the atrium: its four walls round the floor, the tank in the middle
  const [ca, cb] = P2(0, 0);
  room(-10, -10, 10, 10, 0.006, M.white);
  for (const r of [[-10, -10, 10, -9.4], [-10, 9.4, 10, 10], [-10, -10, -9.4, 10], [9.4, -10, 10, 10]]) room(...r, 0.06);
  Cy(c, f, U.green, ca, y0, cb, 2.6 * s, 2.6 * s, 0.07, 12);
  Cy(c, f, U.glass, ca, y0, cb, 3.0 * s, 3.0 * s, 0.075, 12);
  // the corridors, the rooms of the wings, the north wing, the ring
  for (const r of [[-40, -2, -10.5, 2], [10.5, -2, 40, 2], [-2, -36, 2, -10.5]]) room(...r, 0.008, M.white);
  for (const r of [[-34, -12, -25, -2.5], [-24.5, -12, -15, -2.5], [-34, 2.5, -22.5, 13], [-22, 2.5, -15, 11], [12, -10, 20, -2.5], [20.5, -10, 28.5, -2.5], [29, -12, 40, -2.5], [12, 2.5, 30, 18], [-18, -31, -2.5, -14], [2.5, -30, 16, -15], [-34, -36, -24, -29], [20, -36, 34, -26], [-40, -30, -34.5, -12.5], [34.5, -30, 40, -12.5], [-34, -28.5, -26.5, -21], [25.5, -22.5, 34, -12.5], [16.5, -25.5, 25, -15]]) room(...r, 0.03 + rnd() * 0.012);
  for (const r of [[-44, -40, -40.5, 2], [40.5, -40, 44, 2], [-44, -40, 44, -36.5]]) room(...r, 0.008, M.white);
  // where it spread: red pins, a thread between two of them
  const hot = [[-10, -22], [9, -22], [-29, -32], [-37, -21], [27, -31], [-29, -16], [22, -20], [-12, -5], [16, -6]];
  let last = null;
  for (let i = 0; i < Math.min(pins, hot.length); i++) {
    const [a, b] = P2(...hot[i]);
    Cy(c, f, X.chrome, a, y0 + 0.03, b, 0.002, 0.002, 0.05, 4);
    A(c, f, M.red, sphG(0.008, 6, 4), a, y0 + 0.082, b);
    if (last) rodL(c, f, M.red, last[0], y0 + 0.08, last[1], a, y0 + 0.08, b, 0.0012, 3);
    last = i < 3 ? [a, b] : null;
  }
  // the plaque on the front
  Cu(c, f, X.brass, 0, T - 0.12, d / 2 + 0.004, 0.62, 0.11, 0.008);
  lbl(c, f, 'SITE 4', 0, T - 0.12, d / 2 + 0.008 + 0.018, 0.6, 0.1, { lines: ['NOX BIOSYSTEMS · SITE 4', 'SUBLEVELS 4–5 · LEVEL 5 · 1 : 250'], bg: '#3a2a12', fg: '#e8cf8a', border: '#c8a24e', font: 'bold 34px Georgia, serif' });
  // the hood, lifted and shoved half off its corner
  const [gx, gz] = at(f, hood * 0.28, hood * 0.18);
  const g = grp(c, gx, y0 + 0.17, gz, f.yaw + hood * 0.22);
  g(U.glass, boxG(w - 0.06, 0.32, d - 0.06), 0, 0.01, 0);
  col(c, f, -w / 2, -d / 2, w / 2, d / 2, 0, T + 0.02, SURF.wood);
  col(c, f, -w / 2 + 0.03 + hood * 0.1, -d / 2 + 0.03, w / 2 + hood * 0.25, d / 2 + hood * 0.15, T + 0.02, T + 0.36, SURF.glass);
}

/**
 * A framed photograph of a city skyline at dusk on the wall at (x, z), centre height y: the gilt frame, the sky going
 * from navy to a sunset band, towers in silhouette (a few windows lit, a needle mast), the dark harbour, the glass,
 * the little brass caption plate under it.
 */
export function skylinePrint(c, x, y, z, face, { w = 1.6, h = 0.86, caption = 'SINGAPORE · NOX ASIA-PACIFIC · 2019' } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = fr(x, z, face);
  const y0 = y - h / 2 + 0.05, ih = h - 0.1, iw = w - 0.1;
  B(c, f, M.black, -w / 2, y - h / 2, 0, w / 2, y + h / 2, 0.02);
  B(c, f, X.navy, -iw / 2, y0, 0.02, iw / 2, y0 + ih * 0.16, 0.022);
  B(c, f, X.i_sunset, -iw / 2, y0 + ih * 0.16, 0.02, iw / 2, y0 + ih * 0.4, 0.022);
  B(c, f, X.i_dusk, -iw / 2, y0 + ih * 0.4, 0.02, iw / 2, y0 + ih, 0.022);
  let a = -iw / 2 + 0.02;
  const lit = [];
  while (a < iw / 2 - 0.06) {
    const bw = 0.04 + rnd() * 0.07, bh = ih * (0.12 + rnd() * rnd() * 0.5);
    B(c, f, pick(c, [M.black, X.charcoal]), a, y0 + ih * 0.16, 0.022, a + bw, y0 + ih * 0.16 + bh, 0.025);
    if (rnd() < 0.7) lit.push([a + bw * (0.2 + rnd() * 0.6), y0 + ih * 0.16 + bh * (0.3 + rnd() * 0.6)]);
    a += bw + rnd() * 0.012;
  }
  Cy(c, f, M.black, iw * 0.18, y0 + ih * 0.16, 0.024, 0.006, 0.002, ih * 0.72, 4);
  for (const [la, ly] of lit) Cu(c, f, G.i_bulb, la, ly, 0.0255, 0.008, 0.01, 0.002);
  for (const [la, ly] of lit.slice(0, 6)) Cu(c, f, X.i_sunset, la, y0 + ih * 0.16 - (ly - y0 - ih * 0.16) * 0.3, 0.0225, 0.004, 0.03, 0.001); // (their reflections)
  for (const s of [-1, 1]) {
    B(c, f, X.i_gilt, -w / 2, s > 0 ? y + h / 2 - 0.05 : y - h / 2, 0, w / 2, s > 0 ? y + h / 2 : y - h / 2 + 0.05, 0.04);
    B(c, f, X.i_gilt, s > 0 ? w / 2 - 0.05 : -w / 2, y - h / 2 + 0.05, 0, s > 0 ? w / 2 : -w / 2 + 0.05, y + h / 2 - 0.05, 0.04);
  }
  Cu(c, f, U.glass, 0, y, 0.034, iw, ih, 0.002);
  Cu(c, f, X.brass, 0, y - h / 2 - 0.06, 0.006, 0.42, 0.05, 0.008);
  lbl(c, f, caption, 0, y - h / 2 - 0.06, 0.01 + 0.018, 0.4, 0.04, { bg: '#3a2a12', fg: '#e8cf8a', border: '#3a2a12', font: 'bold 28px Georgia, serif' });
}

/** a coat flung over the top of a sofa back at (x, y, z) (that point on its top edge), the sofa facing yaw: the shoulders folded over, the body down the cushion, a sleeve across the seat */
export function drapedCoat(c, x, y, z, yaw, { mat = null } = {}) {
  const { X } = c;
  const m = mat ?? X.navy;
  const g = grp(c, x, y, z, yaw);
  g(m, rbox(0.46, 0.07, 0.2, 0.03), 0, 0.03, 0.0, -0.12);
  g(m, rbox(0.44, 0.52, 0.06, 0.03), 0.02, -0.22, 0.14, 0.28, 0.05);
  g(m, boxG(0.11, 0.1, 0.48), 0.27, -0.36, 0.36, 0.12, 0.35);
  g(m, boxG(0.1, 0.42, 0.09), -0.26, -0.18, 0.12, 0.2, 0, 0.1);
  g(X.charcoal, boxG(0.3, 0.05, 0.06), 0, 0.07, -0.02, -0.2);
}

/** a round pedestal meeting table at (x, z), radius r: a cast base, the column, a mahogany top; a pad, a cup, a speakerphone */
export function nookTable(c, x, z, { r = 0.6, items = true } = {}) {
  const { M, X, rnd } = c;
  c.K.cyl(M.dark, x, 0, z, 0.3, 0.26, 0.04, 14);
  c.K.cyl(X.chrome, x, 0.04, z, 0.045, 0.045, 0.66, 8);
  c.K.cyl(X.i_mahogany, x, 0.7, z, r, r, 0.04, 20);
  c.K.cyl(X.i_mahogany, x, 0.68, z, r * 0.4, r * 0.4, 0.02, 10);
  if (items) {
    c.K.cyl(M.dark, x + 0.05, 0.74, z - 0.04, 0.11, 0.12, 0.03, 3, [0, rnd() * 2, 0]);
    for (let k = 0; k < 3; k++) c.K.add(X.paper, boxG(0.21, 0.003, 0.3), x + jit(c, r * 0.6), 0.742 + k * 0.002, z + jit(c, r * 0.6), [0, rnd() * 3, 0]);
    Fac.mug(c, x - r * 0.5, 0.74, z + r * 0.3);
  }
  c.col(x - r * 0.75, 0, z - r * 0.75, x + r * 0.75, 0.74, z + r * 0.75, SURF.wood);
}

/** a wool tub chair at (x, z) turned yaw (its sitter looking that way): a curved back wrapping the seat, splayed walnut legs; `down` tipped on its back */
export function tubChair(c, x, z, yaw, { down = false, mat = null } = {}) {
  const { X } = c;
  const m = mat ?? X.i_sage;
  const g = down ? grp(c, x, 0.3, z, yaw, -1.45) : grp(c, x, 0, z, yaw);
  g(m, rbox(0.5, 0.12, 0.48, 0.04), 0, 0.42, 0.02);
  g(m, cached('tubBack', () => new THREE.CylinderGeometry(0.28, 0.27, 0.36, 12, 1, true, 0.9, 2 * PI - 1.8)), 0, 0.62, 0.02);
  g(m, cached('tubBackIn', () => new THREE.CylinderGeometry(0.26, 0.25, 0.34, 12, 1, true, 0.9, 2 * PI - 1.8).scale(-1, 1, 1)), 0, 0.62, 0.02);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g(X.walnut, cylG(0.016, 0.022, 0.38, 5), s * 0.19, 0.18, t * 0.17, t * 0.12, 0, -s * 0.12);
  if (!down) c.col(x - 0.3, 0, z - 0.3, x + 0.3, 0.8, z + 0.3, SURF.wood);
}

// ---------------------------------------------------------------- the isolation ward
/**
 * An isolation cell over the rect, glazed toward `face`: pale-green laminate partitions to the ceiling on a steel
 * kick strip (`sides` [-a, +a] drawn), the steel front: the head transom with the cell's number and its precautions,
 * the posts, the fixed pane, the sliding glass door on its track (`door` -1 / 1: the side it's on); the bed-head
 * trunking on the back wall (O₂ / air / vacuum, the nurse-call lamp: `alarm` lit), an extract grille, a floor drain,
 * the night light; `curtain` (0..1) draws a privacy curtain across the inside of the glass.
 * state: 'open' (the door slid back, the pane intact) or 'smashed' (the pane burst out, shards hanging in the frame
 * and on the floor, the door leaf torn off its track and leant inside, blood). The interior is left free for a bed.
 */
export function wardCell(c, x0, z0, x1, z1, face, { n = 'ISO 5-01', state = 'open', door = 1, sides = [true, true], h = 3.2, curtain = 0, alarm = false } = {}) {
  const { M, U, X, G, rnd } = c;
  const alongX = face === 's' || face === 'n';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const bx = face === 'e' ? x0 : face === 'w' ? x1 : (x0 + x1) / 2, bz = face === 's' ? z0 : face === 'n' ? z1 : (z0 + z1) / 2;
  const f = fr(bx, bz, face);
  const t = 0.1, H = h - 0.005, top = 2.2, fb0 = D - 0.1, fb1 = D - 0.04, dw = 1.0;
  const smashed = state === 'smashed';
  for (const s of [-1, 1]) {
    if (!sides[s < 0 ? 0 : 1]) continue;
    const a0 = s < 0 ? -W / 2 : W / 2 - t, a1 = a0 + t;
    B(c, f, X.i_cellLam, a0, 0.12, 0, a1, H, D);
    B(c, f, X.i_cellTrim, a0 - 0.003, 0, 0, a1 + 0.003, 0.12, D);
    col(c, f, a0, 0, a1, D, 0, H, SURF.plaster);
  }
  // the front: the transom, the posts, the sill, the door opening at the `door` end
  const ia0 = -W / 2 + t, ia1 = W / 2 - t;
  const d0 = door > 0 ? ia1 - dw : ia0, d1 = d0 + dw;
  const p0 = door > 0 ? ia0 : d1 + 0.06, p1 = door > 0 ? d0 - 0.06 : ia1;
  B(c, f, X.i_cellLam, ia0, top, fb0, ia1, H, fb1);
  B(c, f, X.i_cellTrim, ia0, top - 0.06, fb0 - 0.005, ia1, top, fb1 + 0.005);
  col(c, f, ia0, fb0, ia1, fb1, top, H, SURF.plaster);
  for (const [a, b] of door > 0 ? [[d0 - 0.06, d0]] : [[d1, d1 + 0.06]]) {
    B(c, f, X.i_cellTrim, a, 0, fb0, b, top, fb1);
    col(c, f, a, fb0, b, fb1, 0, top, SURF.metal);
  }
  B(c, f, X.i_cellTrim, p0, 0, fb0, p1, 0.1, fb1);
  lbl(c, f, n, -0.25 * door, 2.62, fb1 + 0.001, 0.9, 0.2, { bg: '#2e6b4f', fg: '#ffffff', border: '#2e6b4f', font: 'bold 64px Arial' });
  lbl(c, f, 'CONTACT + AIRBORNE', -0.25 * door, 2.4, fb1 + 0.001, 0.9, 0.09, WARN);
  Cu(c, f, M.dark, door * (W / 2 - 0.35), 2.85, fb1 + 0.012, 0.3, 0.09, 0.024);
  Cu(c, f, alarm ? G.i_call : M.grey, door * (W / 2 - 0.35), 2.85, fb1 + 0.025, 0.26, 0.06, 0.004);
  // the door leaf (aluminium frame, glass, the vision band, the pull)
  const leaf = (g) => {
    g(U.glass, boxG(dw - 0.08, 2.0, 0.014), 0, 0, 0);
    g(M.frost, boxG(dw - 0.08, 0.08, 0.004), 0, 0.35, 0.01);
    for (const s of [-1, 1]) g(X.i_cellTrim, boxG(0.05, 2.1, 0.04), s * (dw / 2 - 0.025), 0, 0);
    for (const s of [-1, 1]) g(X.i_cellTrim, boxG(dw, 0.06, 0.04), 0, s * 1.02, 0);
    g(X.chrome, boxG(0.022, 0.6, 0.016), -door * (dw / 2 - 0.1), 0, 0.032);
  };
  B(c, f, X.i_cellTrim, -W / 2 + t, top - 0.02, fb1, W / 2 - t, top + 0.07, D - 0.005);
  if (!smashed) {
    // the pane, a frosted band; the door slid back over it on its outer track
    B(c, f, U.glass, p0, 0.1, fb0 + 0.025, p1, top - 0.06, fb0 + 0.04);
    B(c, f, M.frost, p0, 1.42, fb0 + 0.041, p1, 1.5, fb0 + 0.043);
    col(c, f, p0, fb0, p1, fb1, 0, top, SURF.glass);
    const [lx, lz] = at(f, door > 0 ? d0 - dw / 2 - 0.02 : d1 + dw / 2 + 0.02, D - 0.02);
    leaf(grp(c, lx, 1.1, lz, f.yaw));
  } else {
    // the pane burst outward: shards left in the frame, glass all over the floor, the door torn off and leant inside
    for (let k = 0; k < 4; k++) A(c, f, U.glass, coneG(0.05, 0.14 + rnd() * 0.24), p0 + ((k + 0.5) * (p1 - p0)) / 4, 0.17, fb0 + 0.03, 0, rnd() * 3, jit(c, 0.4), [1, 1, 0.12]);
    for (let k = 0; k < 3; k++) A(c, f, U.glass, coneG(0.05, 0.1 + rnd() * 0.2), p0 + ((k + 0.5) * (p1 - p0)) / 3, top - 0.13, fb0 + 0.03, PI, rnd() * 3, 0, [1, 1, 0.12]);
    for (let k = 0; k < 6; k++) {
      const [gx, gz] = at(f, p0 + rnd() * (p1 - p0 + 0.6), D + 0.1 + rnd() * 1.3);
      c.K.add(U.glass, boxG(0.04 + rnd() * 0.07, 0.004, 0.03 + rnd() * 0.06), gx, 0.004, gz, [0, rnd() * 3, 0]);
    }
    const [gx, gz] = at(f, (p0 + p1) / 2, D + 0.7);
    c.decal?.('glass', gx, gz, 1.5, rnd() * 3);
    const [lx, lz] = at(f, -door * (W / 2 - t - 0.09), D * 0.55);
    leaf(grp(c, lx, 1.08, lz, f.yaw - door * PI / 2, 0.06)); // (its top resting on the partition)
    const [bx2, bz2] = at(f, (d0 + d1) / 2, D - 0.6);
    c.decal?.('bloodDrag', bx2, bz2, 1.1, f.yaw + rnd() * 0.6);
  }
  // inside: the trunking on the back wall, the grille, the drain, the night light
  B(c, f, X.labGrey, -0.7, 1.38, 0, 0.7, 1.62, 0.08);
  for (const [a, m] of [[-0.45, M.green], [-0.3, M.white], [-0.15, M.yellow], [0.2, M.white], [0.32, M.white]]) Cu(c, f, m, a, 1.5, 0.085, 0.07, 0.07, 0.012);
  Cu(c, f, alarm ? G.i_call : M.red, 0.5, 1.5, 0.087, 0.05, 0.05, 0.012);
  const [vx, vz] = at(f, -door * (W / 2 - t - 0.35), 0);
  L.wallVent(c, vx, 0.3, vz, f.face, 0.3, 0.2);
  // the floor drain: a dark sump under a steel grate of four bars
  B(c, f, M.black, -door * 0.5 - 0.11, 0.001, D - 0.81, -door * 0.5 + 0.11, 0.004, D - 0.59);
  for (let k = 0; k < 4; k++) Cu(c, f, X.i_cellTrim, -door * 0.5 - 0.075 + k * 0.05, 0.006, D - 0.7, 0.018, 0.006, 0.2);
  Cu(c, f, G.i_night, door * (W / 2 - t - 0.002), 0.4, D - 0.4, 0.004, 0.06, 0.14);
  if (curtain > 0) {
    const ca = door > 0 ? ia1 - 0.05 : ia0 + 0.05, cb = door > 0 ? ia0 + 0.05 : ia1 - 0.05;
    L.privacyCurtain(c, [at(f, ca, D - 0.35), at(f, cb, D - 0.35)], top + 0.05, { drawn: [curtain], bottom: 0.3, mat: X.curtain });
  }
  return f;
}

/**
 * The service pier between two cells over the rect, its front toward `face`: a laminate-clad chase to the ceiling;
 * on its front the stainless pass-through hatch, the intercom (its LED), the pressure gauge, the clipboard holder
 * with the patient card (`card` lines).
 */
export function cellPier(c, x0, z0, x1, z1, face, { h = 3.2, card = ['SUBJECT 2231', 'DO NOT ENTER'], open = false } = {}) {
  const { M, X, U } = c;
  const alongX = face === 's' || face === 'n';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const f = fr(face === 'e' ? x0 : face === 'w' ? x1 : (x0 + x1) / 2, face === 's' ? z0 : face === 'n' ? z1 : (z0 + z1) / 2, face);
  B(c, f, X.i_cellLam, -W / 2, 0.12, 0, W / 2, h - 0.005, D);
  B(c, f, X.i_cellTrim, -W / 2 - 0.003, 0, 0, W / 2 + 0.003, 0.12, D + 0.003);
  col(c, f, -W / 2, 0, W / 2, D, 0, h, SURF.plaster);
  const w = Math.min(0.24, W - 0.05);
  // the pass-through hatch (its door dropped open: `open`)
  Cu(c, f, X.stainless, 0, 1.05, D + 0.02, w, 0.26, 0.05);
  if (open) {
    B(c, f, M.black, -w / 2 + 0.02, 0.95, D + 0.044, w / 2 - 0.02, 1.15, D + 0.046);
    A(c, f, X.stainless, boxG(w - 0.03, 0.2, 0.012), 0, 0.89, D + 0.14, PI / 2 - 0.1);
  } else Cu(c, f, X.chrome, 0.08, 1.05, D + 0.05, 0.02, 0.1, 0.014);
  // the intercom, the gauge, the card holder
  Cu(c, f, M.grey, 0, 1.42, D + 0.012, 0.13, 0.17, 0.024);
  for (let i = 0; i < 4; i++) Cu(c, f, M.black, 0, 1.46 + i * 0.016, D + 0.025, 0.08, 0.006, 0.002);
  Cu(c, f, U.green, 0.04, 1.375, D + 0.025, 0.012, 0.012, 0.004);
  Cb(c, f, M.dark, 0, 1.75, D + 0.02, 0.055, 0.04, 8);
  const [gx, gz] = at(f, 0, D + 0.041);
  c.K.plane(M.signs, 0.09, 0.09, gx, 1.75, gz, [0, f.yaw, 0], SIGN.gauge, 1024, 1024);
  Cu(c, f, X.chrome, 0, 2.1, D + 0.008, w - 0.02, 0.03, 0.016);
  lbl(c, f, card[0], 0, 1.98, D + 0.006 + 0.018, w - 0.03, 0.2, { lines: card, bg: '#f3f1e7', fg: '#1d2b3a', border: '#c63a2e', font: 'bold 30px Arial' });
}

/** a stainless combination toilet-basin against the wall at (x, z) facing `face`: the cabinet, the basin and push tap on top, the bowl out front, the flush button */
export function steelWC(c, x, z, face) {
  const { M, X } = c;
  const f = fr(x, z, face);
  Cu(c, f, X.i_steelWC, 0, 0.5, 0.17, 0.5, 1.0, 0.34);
  Cu(c, f, M.dark, 0, 0.98, 0.2, 0.32, 0.02, 0.18);
  A(c, f, X.i_steelWC, cylG(0.12, 0.1, 0.06, 8, true), 0, 0.965, 0.2, 0, 0, 0, [1, 1, 0.65]);
  Cb(c, f, X.chrome, 0, 1.03, 0.06, 0.018, 0.05, 8);
  A(c, f, X.i_steelWC, cylG(0.17, 0.2, 0.4, 10), 0, 0.2, 0.44, 0, 0, 0, [1, 1, 1.3]);
  A(c, f, M.black, cylG(0.14, 0.14, 0.01, 10), 0, 0.402, 0.45, 0, 0, 0, [1, 1, 1.3]);
  A(c, f, X.i_steelWC, torG(0.155, 0.022, 3, 12), 0, 0.405, 0.44, PI / 2, 0, 0, [1, 1.3, 1]);
  Cb(c, f, X.chrome, 0.18, 0.7, 0.345, 0.025, 0.012, 8);
  col(c, f, -0.25, 0, 0.25, 0.7, 0, 0.6, SURF.metal);
}

/**
 * A pharmacy fridge at (x, z) (its back on the wall line) facing `face`: the white cabinet, the glass door hanging
 * open `ajar` (radians) on its hinge (`hinge` 1: the +a side, -1: the -a side), the lit inside (wire shelves of vial boxes, insulin pens, IV bags, a gap where
 * someone cleared a shelf), the temperature display in alarm, the lock and the 'MEDICATION ONLY' notice.
 */
export function medFridge(c, x, z, face, { w = 0.62, h = 1.82, d = 0.62, ajar = 0.6, hinge = 1, display = '+11.4 °C  HIGH' } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = fr(x, z, face);
  R(c, f, M.white, 0, h / 2, d / 2, w, h, d, 0.02);
  B(c, f, G.fridge, -w / 2 + 0.04, 0.16, d - 0.004, w / 2 - 0.04, h - 0.2, d + 0.001);
  for (let k = 0; k < 4; k++) {
    const y = 0.32 + k * 0.33;
    B(c, f, X.chrome, -w / 2 + 0.05, y, d - 0.012, w / 2 - 0.05, y + 0.012, d + 0.003);
    if (k === 2) continue; // (cleared)
    for (let i = 0; i < 4; i++) {
      const m = k === 0 ? X.ivBag : pick(c, [M.white, X.cream, M.blue, M.amber]);
      if (rnd() < 0.8) Cu(c, f, m, -w / 2 + 0.11 + i * 0.13, y + 0.06, d + 0.006, 0.1, k === 0 ? 0.14 : 0.08 + rnd() * 0.05, 0.004);
    }
  }
  Cu(c, f, M.black, -0.12, h - 0.1, d + 0.004, 0.24, 0.07, 0.006);
  lbl(c, f, display, -0.12, h - 0.1, d + 0.008 + 0.018, 0.22, 0.05, { bg: '#1a0b08', fg: '#ff5a3a', border: '#1a0b08', font: 'bold 34px Courier New, monospace' });
  Cu(c, f, M.red, 0.16, h - 0.1, d + 0.006, 0.02, 0.02, 0.006);
  lbl(c, f, 'MEDICATION ONLY', 0, 0.09, d + 0.004 + 0.018, 0.4, 0.06, { bg: '#1f5fa6', fg: '#ffffff', border: '#1f5fa6', font: 'bold 34px Arial' });
  // the glass door on its hinge
  const hs = hinge < 0 ? -1 : 1, um = -hs * (w / 2 - 0.01); // (the door's middle, from its hinge)
  const [hx, hz] = at(f, hs * (w / 2 - 0.01), d + 0.01);
  const g = grp(c, hx, 0, hz, f.yaw + hs * ajar);
  g(U.glass, boxG(w - 0.08, h - 0.36, 0.012), um, h / 2 - 0.02, 0.02);
  for (const s of [-1, 1]) g(M.white, boxG(w - 0.02, 0.07, 0.04), um, h / 2 - 0.02 + s * (h / 2 - 0.2), 0.02);
  for (const s of [-1, 1]) g(M.white, boxG(0.04, h - 0.3, 0.04), um + s * (w / 2 - 0.03), h / 2 - 0.02, 0.02);
  g(X.chrome, boxG(0.02, 0.4, 0.02), -hs * (w - 0.06), h / 2, 0.06);
  col(c, f, -w / 2, 0, w / 2, d, 0, h, SURF.metal);
}

/**
 * What's left of a nurses' station's glass screen, standing on its ledge at height y0 along the line through (x, z)
 * (facing `face`, `len` long): the aluminium posts and the head rail (one post bent), jagged shards still in the
 * frames, one pane whole but starred by a bullet and smeared, the speaking grille, glass all over the ledge and the
 * floor in front.
 */
export function ruinedGlazing(c, x, z, face, len, { y0 = 1.08, top = 2.05, whole = 1 } = {}) {
  const { U, X, rnd } = c;
  const f = fr(x, z, face);
  const n = Math.max(2, Math.round(len / 1.0)), pw = len / n, hh = top - y0;
  for (let i = 0; i <= n; i++) {
    const a = -len / 2 + i * pw;
    if (i === 1 && n > 2) A(c, f, X.alu, boxG(0.04, hh, 0.05), a + 0.08, y0 + hh / 2, 0.03, 0.12, 0, -0.18); // (bent where something hit it)
    else Cu(c, f, X.alu, a, y0 + hh / 2, 0, 0.04, hh, 0.05);
  }
  Cu(c, f, X.alu, 0, top + 0.02, 0, len + 0.04, 0.04, 0.06);
  for (let i = 0; i < n; i++) {
    const a = -len / 2 + (i + 0.5) * pw;
    if (i === whole) {
      Cu(c, f, U.glass, a, y0 + hh / 2, 0, pw - 0.04, hh, 0.01);
      const [px, pz] = at(f, a + 0.15, 0.007);
      c.wallDecal?.('bullet', px, y0 + hh * 0.6, pz, f.face, 0.32, 0.32);
      c.wallDecal?.('bloodSmear', px - 0.1 * f.cs, y0 + hh * 0.35, pz + 0.1 * f.sn, f.face, 0.25, 0.5);
      Cu(c, f, X.chrome, a - pw * 0.25, y0 + 0.32, 0.007, 0.14, 0.1, 0.004);
      continue;
    }
    for (let k = 0; k < 3; k++) A(c, f, U.glass, coneG(0.06, 0.12 + rnd() * 0.25), a - pw / 2 + 0.06 + rnd() * (pw - 0.12), y0 + 0.08, 0, 0, rnd() * 0.4, jit(c, 0.35), [1, 1, 0.1]);
    for (let k = 0; k < 2; k++) A(c, f, U.glass, coneG(0.05, 0.1 + rnd() * 0.18), a - pw / 2 + 0.08 + rnd() * (pw - 0.16), top - 0.08, 0, PI, rnd() * 0.4, 0, [1, 1, 0.1]);
    for (let k = 0; k < 3; k++) A(c, f, U.glass, boxG(0.04 + rnd() * 0.06, 0.004, 0.03 + rnd() * 0.05), a + jit(c, pw * 0.4), y0 + 0.002, -0.15 + rnd() * 0.3, 0, rnd() * 3);
    const [gx, gz] = at(f, a, 0.9);
    c.decal?.('glass', gx, gz, 1.2, rnd() * 3);
  }
}

/** a vinyl mattress dragged off its bed onto the floor at (x, z) turned yaw: one end folded up, slashed open (the foam showing), stuffing pulled out */
export function tornMattress(c, x, z, yaw, { blood = true } = {}) {
  const { X, rnd } = c;
  const g = grp(c, x, 0, z, yaw);
  g(X.i_mattress, rbox(0.86, 0.13, 1.3, 0.04), 0, 0.065, 0.3);
  g(X.i_mattress, rbox(0.86, 0.13, 0.62, 0.04), 0.03, 0.2, -0.55, -0.55, 0.06);
  g(X.i_foam, boxG(0.5, 0.012, 0.08), 0.05, 0.131, 0.25, 0, 0.5);
  g(X.i_foam, boxG(0.3, 0.012, 0.06), -0.15, 0.131, 0.6, 0, -0.3);
  for (let k = 0; k < 4; k++) g(X.i_foam, sphG(0.05 + rnd() * 0.04, 6, 4), jit(c, 0.6), 0.03, 0.2 + rnd() * 0.9, 0, 0, 0, [1, 0.5, 1]);
  if (blood) c.decal?.('blood', x + Math.sin(yaw) * 0.3, z + Math.cos(yaw) * 0.3, 0.9, rnd() * 6);
}

/**
 * Something dropped on the floor at (x, z) turned yaw: 'helmet' (a ballistic helmet on its side, the strap), 'mags'
 * (two rifle magazines), 'torch' (a flashlight, still lit), 'radio' (a handheld radio, its antenna), 'syringe' (a
 * syringe and a broken vial), 'clipboard' (a chart on a clipboard), 'clog' (a nurse's clog), 'vest' (a plate carrier),
 * 'turnout' (a firefighter's coat shrugged off, its hi-vis bands), 'firehelmet' (a firefighter's helmet, its visor up),
 * 'wrench' (a big adjustable spanner), 'hammer' (a club hammer).
 */
export function gearDrop(c, x, z, yaw, kind) {
  const { M, U, X, G, rnd } = c;
  const g = grp(c, x, 0, z, yaw);
  if (kind === 'helmet') {
    g(X.olive, cached('helmet', () => new THREE.SphereGeometry(0.15, 10, 5, 0, PI * 2, 0, PI / 2)), 0, 0.15, 0, 0, 0, PI / 2 + 0.3, [1, 1.05, 1.15]);
    g(M.black, torG(0.12, 0.008, 3, 10, PI), 0.03, 0.08, 0, 0, PI / 2, 0.3);
    g(M.black, boxG(0.06, 0.04, 0.04), 0.0, 0.25, 0.1, 0.3);
  } else if (kind === 'mags') {
    for (let k = 0; k < 2; k++) g(M.black, boxG(0.03, 0.2, 0.07), k * 0.12, 0.015, k * 0.05, PI / 2, rnd() * 2, 0.15);
  } else if (kind === 'torch') {
    g(M.black, cylG(0.02, 0.02, 0.24, 8), 0, 0.022, 0, PI / 2);
    g(M.black, cylG(0.028, 0.034, 0.05, 8), 0, 0.034, 0.14, PI / 2);
    g(G.i_bulb, cylG(0.03, 0.03, 0.004, 8), 0, 0.034, 0.167, PI / 2);
  } else if (kind === 'radio') {
    g(M.black, boxG(0.065, 0.17, 0.04), 0, 0.02, 0, -PI / 2);
    g(M.black, cylG(0.006, 0.004, 0.16, 4), 0.02, 0.012, -0.16, -PI / 2);
    g(U.red, boxG(0.012, 0.004, 0.012), -0.015, 0.042, 0.05);
  } else if (kind === 'syringe') {
    g(U.glass, cylG(0.008, 0.008, 0.11, 6), 0, 0.009, 0, PI / 2);
    g(M.white, cylG(0.004, 0.004, 0.06, 4), 0, 0.009, -0.08, PI / 2);
    g(X.chrome, cylG(0.001, 0.001, 0.035, 3), 0, 0.009, 0.072, PI / 2);
    g(U.glass, cylG(0.012, 0.012, 0.03, 6), 0.12, 0.012, 0.05, PI / 2, 0.8);
  } else if (kind === 'clipboard') {
    g(X.kraft, boxG(0.23, 0.006, 0.32), 0, 0.003, 0);
    g(X.paper, boxG(0.21, 0.002, 0.28), 0, 0.007, 0.01);
    g(X.chrome, boxG(0.09, 0.012, 0.03), 0, 0.01, -0.14);
  } else if (kind === 'turnout') {
    g(X.i_turnout, rbox(0.62, 0.08, 0.5, 0.03), 0, 0.04, 0, 0, 0.1);
    g(X.i_turnout, boxG(0.5, 0.06, 0.13), 0.12, 0.03, 0.36, 0, 0.5);
    g(X.i_turnout, boxG(0.14, 0.06, 0.5), -0.42, 0.03, -0.05, 0, -0.35);
    for (const v of [-0.12, 0.12]) g(X.i_hiVis, boxG(0.63, 0.084, 0.05), 0, 0.04, v, 0, 0.1);
    g(X.i_hiVis, boxG(0.15, 0.064, 0.05), -0.44, 0.03, 0.08, 0, -0.35);
  } else if (kind === 'firehelmet') {
    g(M.yellow, cached('fhelm', () => new THREE.SphereGeometry(0.14, 10, 5, 0, PI * 2, 0, PI / 2)), 0, 0.02, 0, 0, 0, 0.25, [1, 0.9, 1.15]);
    g(M.yellow, cylG(0.2, 0.2, 0.012, 12), 0, 0.02, 0.02, 0, 0, 0.25, [1, 1, 1.25]);
    g(U.glass, boxG(0.22, 0.09, 0.01), 0, 0.12, 0.13, -0.9, 0, 0.25);
  } else if (kind === 'wrench') {
    g(X.chrome, boxG(0.035, 0.012, 0.36), 0, 0.006, 0);
    g(X.chrome, boxG(0.09, 0.016, 0.06), 0.015, 0.008, 0.2);
    g(M.red, boxG(0.04, 0.016, 0.14), 0, 0.008, -0.12);
  } else if (kind === 'hammer') {
    g(X.oak, cylG(0.014, 0.014, 0.3, 6), 0, 0.016, 0, PI / 2);
    g(M.dark, boxG(0.11, 0.045, 0.045), 0, 0.024, 0.17);
  } else if (kind === 'clog') {
    g(X.labGrey, boxG(0.1, 0.07, 0.27), 0, 0.05, 0, 0, 0, PI / 2 - 0.2);
    g(X.labGrey, boxG(0.11, 0.03, 0.1), 0.0, 0.03, -0.1, 0, 0, PI / 2 - 0.2);
  } else {
    g(X.olive, rbox(0.36, 0.06, 0.44, 0.02), 0, 0.03, 0, 0, 0, 0.05);
    for (let k = 0; k < 3; k++) g(X.olive, boxG(0.09, 0.05, 0.14), -0.11 + k * 0.11, 0.08, 0.12);
    g(M.black, boxG(0.05, 0.01, 0.4), 0.2, 0.01, -0.05, 0, 0.4);
  }
}

/**
 * A resuscitation trolley against the wall at (x, z) (its back on the wall line) facing `face`: the red drawer stack
 * on casters (the second drawer hanging open, the seal tag snapped), the defibrillator on top (its screen dead, the
 * paddles pulled, one on the floor on its cable), the CPR board on the side, the oxygen bottle in its sleeve.
 */
export function resusTrolley(c, x, z, face, { open = true } = {}) {
  const { M, X, U } = c;
  const f = fr(x, z, face);
  const W = 0.62, D = 0.48, b0 = 0.06, bc = b0 + D / 2;
  R(c, f, X.cartRed, 0, 0.5, bc, W, 0.8, D, 0.015);
  Cu(c, f, X.labGrey, 0, 0.92, bc, W + 0.04, 0.04, D + 0.04);
  for (let i = 0; i < 4; i++) {
    const y = 0.8 - i * 0.18, pull = open && i === 1 ? 0.22 : 0;
    Cu(c, f, X.cartRed, 0, y, b0 + D + 0.008 + pull, W - 0.05, 0.15, 0.015);
    Cu(c, f, X.chrome, 0, y + 0.04, b0 + D + 0.022 + pull, 0.22, 0.015, 0.012);
    if (pull) {
      Cu(c, f, X.cartRed, 0, y - 0.03, b0 + D - 0.1 + pull, W - 0.08, 0.1, 0.2);
      for (let k = 0; k < 4; k++) Cu(c, f, pick(c, [X.ivBag, M.white, M.blue]), -0.2 + k * 0.13, y + 0.03, b0 + D - 0.08 + pull, 0.1, 0.06, 0.12);
    }
  }
  Cu(c, f, M.yellow, W / 2 - 0.06, 0.88, b0 + D + 0.014, 0.025, 0.05, 0.004);
  for (const [s, t] of [[-1, 0], [1, 0], [-1, 1], [1, 1]]) Ca(c, f, X.rubber, s * (W / 2 - 0.06), 0.05, b0 + 0.06 + t * (D - 0.12), 0.05, 0.03, 8);
  // the defibrillator, its paddles out
  R(c, f, X.labGrey, -0.08, 1.04, bc, 0.36, 0.2, 0.3, 0.02);
  Cu(c, f, M.black, -0.12, 1.08, bc + 0.152, 0.16, 0.1, 0.004);
  Cu(c, f, U.ledR, 0.04, 1.06, bc + 0.152, 0.02, 0.02, 0.004);
  Cu(c, f, M.dark, 0.18, 0.99, bc + 0.06, 0.1, 0.06, 0.16);
  const [px, pz] = at(f, 0.25, b0 + D + 0.55);
  c.K.add(M.dark, boxG(0.08, 0.05, 0.14), px, 0.025, pz, [0, f.yaw + 0.7, 0]);
  rodL(c, f, M.black, 0.15, 1.0, bc + 0.12, 0.3, 0.45, b0 + D + 0.2, 0.006, 4);
  rodL(c, f, M.black, 0.3, 0.45, b0 + D + 0.2, 0.25, 0.02, b0 + D + 0.5, 0.006, 4);
  // the CPR board on the -a side, the O₂ bottle in its sleeve on the +a side
  Cu(c, f, M.yellow, -W / 2 - 0.02, 0.62, bc, 0.02, 0.6, 0.42);
  Cy(c, f, M.green, W / 2 + 0.06, 0.3, bc, 0.05, 0.05, 0.5, 8);
  Cy(c, f, X.chrome, W / 2 + 0.06, 0.8, bc, 0.02, 0.02, 0.08, 6);
  col(c, f, -W / 2 - 0.04, b0, W / 2 + 0.12, b0 + D + 0.06, 0, 1.15, SURF.metal);
}

// ---------------------------------------------------------------- the elevator hall
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
/** a strip's box, its UVs in metres (a striped texture repeats along it at its own scale, as on K.box) */
const stripG = (len, w, t) => cached(`st${r3(len)},${r3(w)},${r3(t)}`, () => {
  const g = new THREE.BoxGeometry(t, w, len);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len, uv.getY(i) * w);
  return g;
});
/** a flat strip of `mat` from point p to q (THREE vectors), w wide (its width kept upright), a few mm thick */
function strip(c, mat, p, q, w = 0.05, t = 0.002) {
  _a.subVectors(q, p);
  const len = _a.length();
  _Q.setFromUnitVectors(_z, _a.normalize());
  _Mm.compose(_b.addVectors(p, q).multiplyScalar(0.5), _Q, _Sv.set(1, 1, 1));
  c.K.addMatrix(mat, stripG(len, w, t), _Mm);
}

/**
 * Hazard tape from (ax, ay, az) to (bx, by, bz), sagging by `sag` in the middle; `torn`: snapped near b, the loose end
 * hanging from a and the other lying in a curl on the floor.
 */
export function hazardTape(c, ax, ay, az, bx, by, bz, { sag = 0.06, torn = false } = {}) {
  const { M } = c;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2, my = (ay + by) / 2 - sag;
  if (!torn) {
    strip(c, M.hazard, V(ax, ay, az), V(mx, my, mz));
    strip(c, M.hazard, V(mx, my, mz), V(bx, by, bz));
    return;
  }
  const hx = ax + (bx - ax) * 0.18, hz = az + (bz - az) * 0.18;
  strip(c, M.hazard, V(ax, ay, az), V(hx, ay * 0.55, hz));
  strip(c, M.hazard, V(hx, ay * 0.55, hz), V(hx + (bx - ax) * 0.05, 0.003, hz + (bz - az) * 0.05));
  strip(c, M.hazard, V(bx, by, bz), V(bx + (ax - bx) * 0.12, 0.003, bz + (az - bz) * 0.12));
  strip(c, M.hazard, V(bx + (ax - bx) * 0.12, 0.003, bz + (az - bz) * 0.12), V(bx + (ax - bx) * 0.3, 0.003, bz + (az - bz) * 0.3 + 0.12));
}

/**
 * A red-and-white plastic barrier at (x, z) turned yaw (`len` long across it): two posts on rubber feet, the striped
 * panels, a reflector; `down`: knocked flat on the floor. Returns the top of its +a post [x, y, z] (to tie tape to).
 */
export function barrier(c, x, z, yaw = 0, { down = false, len = 1.0 } = {}) {
  const { M, X } = c;
  const g = down ? grp(c, x, 0.2, z, yaw, PI / 2 - 0.12) : grp(c, x, 0, z, yaw);
  for (const s of [-1, 1]) {
    g(X.i_barrierRed, rbox(0.06, 1.0, 0.06, 0.015), s * (len / 2 - 0.03), 0.5, 0);
    g(M.black, rbox(0.1, 0.06, 0.42, 0.02), s * (len / 2 - 0.03), 0.03, 0);
  }
  const n = 5;
  for (const [y, hh] of [[0.86, 0.16], [0.52, 0.22]]) {
    for (let i = 0; i < n; i++) g(i % 2 ? X.i_barrierWhite : X.i_barrierRed, boxG((len - 0.12) / n, hh, 0.03), -len / 2 + 0.06 + ((i + 0.5) * (len - 0.12)) / n, y, 0);
  }
  g(M.amber, boxG(0.07, 0.07, 0.034), 0, 0.86, 0);
  if (!down) {
    const c0 = Math.abs(Math.cos(yaw)), s0 = Math.abs(Math.sin(yaw));
    const hx = (len / 2) * c0 + 0.21 * s0, hz = (len / 2) * s0 + 0.21 * c0;
    c.col(x - hx, 0, z - hz, x + hx, 1.0, z + hz, SURF.wood);
  }
  return [x + Math.cos(yaw) * (len / 2 - 0.03), down ? 0.2 : 0.98, z - Math.sin(yaw) * (len / 2 - 0.03)];
}

/** a yellow A-frame warning board at (x, z) turned yaw: the two leaves hinged at the top, the notice on both, rubber feet */
export function aBoard(c, x, z, yaw = 0, { lines = ['DANGER', 'OPEN SHAFT', 'NO ENTRY'] } = {}) {
  const { M, X } = c;
  const f = fr(x, z, yaw);
  for (const s of [-1, 1]) {
    A(c, f, M.yellow, rbox(0.6, 0.95, 0.025, 0.01), 0, 0.48, s * 0.07, -s * 0.14);
    Cu(c, f, M.black, 0, 0.012, s * 0.14, 0.56, 0.024, 0.05);
  }
  Cu(c, f, M.dark, 0, 0.95, 0, 0.6, 0.04, 0.04);
  // the notice, flat on each leaf's face (labels stand upright: one per side, on the leaf's middle)
  const card = (face, b) => {
    const [lx, lz] = at(f, 0, b);
    c.label?.(lines.join(' / '), lx, 0.55, lz, face, 0.48, 0.36, { lines, bg: '#e2b31a', fg: '#16181a', border: '#16181a', font: 'bold 52px Arial' });
  };
  if (f.face || Math.abs(Math.sin(yaw * 2)) < 0.01) {
    const fc = { 0: 's', 1: 'e', 2: 'n', 3: 'w' }[((Math.round(yaw / (PI / 2)) % 4) + 4) % 4];
    const bk = { s: 'n', n: 's', e: 'w', w: 'e' }[fc];
    card(fc, 0.08);
    card(bk, -0.08);
  }
  col(c, f, -0.3, -0.16, 0.3, 0.16, 0, 0.95, SURF.wood);
}

/**
 * A lift engineer's service trolley at (x, z) turned yaw (long across it): two steel shelves on casters, the push
 * handle; on top a red toolbox with its lid up and tray out, a multimeter, a pry bar across it all, a coil of cable;
 * below the hydraulic door spreader, a box of cable ties, the rope bag.
 */
export function maintTrolley(c, x, z, yaw = 0) {
  const { M, X, rnd } = c;
  const f = fr(x, z, yaw);
  const W = 0.95, D = 0.55;
  for (const y of [0.22, 0.82]) {
    B(c, f, X.stainless, -W / 2, y, -D / 2, W / 2, y + 0.025, D / 2);
    for (const s of [-1, 1]) Cu(c, f, X.stainless, 0, y + 0.04, s * (D / 2 - 0.005), W, 0.05, 0.01);
  }
  for (const [s, t] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    Cy(c, f, X.stainless, s * (W / 2 - 0.02), 0.1, t * (D / 2 - 0.02), 0.014, 0.014, 0.76, 6);
    Cu(c, f, M.dark, s * (W / 2 - 0.03), 0.08, t * (D / 2 - 0.03), 0.03, 0.04, 0.05);
    Ca(c, f, X.rubber, s * (W / 2 - 0.03), 0.045, t * (D / 2 - 0.03), 0.045, 0.03, 8);
  }
  for (const t of [-1, 1]) rodL(c, f, X.stainless, -W / 2 - 0.02, 0.84, t * 0.2, -W / 2 - 0.02, 1.0, t * 0.2, 0.012);
  rodL(c, f, X.rubber, -W / 2 - 0.02, 1.0, -0.22, -W / 2 - 0.02, 1.0, 0.22, 0.016, 6);
  // the toolbox, open: the lid up, the cantilever tray out
  R(c, f, X.i_toolRed, -0.12, 0.96, 0, 0.48, 0.25, 0.26, 0.015);
  A(c, f, X.i_toolRed, rbox(0.48, 0.03, 0.26, 0.01), -0.12, 1.16, -0.18, -1.2);
  B(c, f, M.black, -0.34, 1.085, -0.11, 0.1, 1.09, 0.11);
  Cu(c, f, X.i_toolRed, -0.12, 1.12, 0.17, 0.44, 0.04, 0.12);
  for (let i = 0; i < 5; i++) Cu(c, f, pick(c, [X.chrome, M.yellow, M.black, X.i_toolRed]), -0.3 + i * 0.08, 1.15, 0.17, 0.02, 0.02, 0.1, jit(c, 0.6));
  R(c, f, M.yellow, 0.28, 0.87, -0.1, 0.09, 0.03, 0.17, 0.01, 0.4);
  Cu(c, f, M.black, 0.28, 0.886, -0.11, 0.06, 0.004, 0.06, 0.4);
  A(c, f, M.dark, torG(0.12, 0.012, 3, 12), 0.28, 0.85, 0.13, PI / 2);
  A(c, f, M.dark, torG(0.1, 0.012, 3, 12), 0.28, 0.875, 0.13, PI / 2);
  // the pry bar, laid across the top
  rodL(c, f, M.black, -0.45, 1.13, 0.2, 0.35, 0.86, -0.22, 0.012, 6);
  rodL(c, f, M.black, 0.35, 0.86, -0.22, 0.42, 0.85, -0.25, 0.012, 6);
  // below: the spreader, ties, the rope bag
  Cy(c, f, M.red, -0.2, 0.25, 0, 0.06, 0.06, 0.12, 10);
  A(c, f, M.dark, cylG(0.035, 0.035, 0.45, 8), 0.02, 0.31, 0, 0, 0, PI / 2);
  for (const s of [-1, 1]) A(c, f, X.chrome, boxG(0.18, 0.02, 0.05), 0.33, 0.31, s * 0.035, 0, s * 0.25);
  R(c, f, X.cream, 0.3, 0.3, -0.16, 0.18, 0.12, 0.12, 0.01);
  Cy(c, f, X.i_rescue, -0.35, 0.245, 0.12, 0.11, 0.1, 0.32, 10);
  Cy(c, f, X.i_rope, -0.35, 0.565, 0.12, 0.07, 0.07, 0.03, 8);
  col(c, f, -W / 2 - 0.05, -D / 2, W / 2, D / 2, 0, 0.88, SURF.metal);
}

/**
 * The landing call station by the elevator at (x, z) on the wall, centre height y: the brushed steel plate, the up
 * and down buttons, the fire-service key switch and its label, the dead floor indicator above (its segments dark but
 * one); `smashed`: the plate pried off and hanging by its cable, the wires out.
 */
export function callPanel(c, x, y, z, face, { smashed = true } = {}) {
  const { M, X, G } = c;
  const f = fr(x, z, face);
  // the indicator, over the panel
  R(c, f, M.black, 0, y + 0.55, 0.012, 0.3, 0.12, 0.024, 0.008);
  for (let i = 0; i < 2; i++) Cu(c, f, i ? M.dark : G.i_floor, -0.05 + i * 0.1, y + 0.55, 0.025, 0.05, 0.016, 0.004);
  lbl(c, f, 'FIRE SERVICE', 0, y - 0.25, 0.004 + 0.018, 0.14, 0.03, { bg: '#c63a2e', fg: '#ffffff', border: '#c63a2e', font: 'bold 30px Arial' });
  if (!smashed) {
    R(c, f, X.stainless, 0, y, 0.006, 0.14, 0.34, 0.012, 0.004);
    for (const s of [-1, 1]) Cb(c, f, M.dark, 0, y + s * 0.06, 0.012, 0.022, 0.012, 10);
    Cb(c, f, M.dark, 0, y - 0.13, 0.012, 0.016, 0.012, 8);
    return;
  }
  // the hole: the back box and its wires, the plate hanging under it
  B(c, f, M.black, -0.06, y - 0.15, 0, 0.06, y + 0.15, 0.004);
  for (const [a, m] of [[-0.03, M.red], [0, M.yellow], [0.03, M.blue]]) rodL(c, f, m, a, y - 0.05, 0.005, a + 0.02, y - 0.22, 0.04, 0.004, 4);
  A(c, f, X.stainless, rbox(0.14, 0.34, 0.012, 0.004), 0.03, y - 0.42, 0.05, 0.25, 0, 0.18);
  for (const s of [-1, 1]) A(c, f, M.dark, cylG(0.022, 0.022, 0.012, 10), 0.03 + s * 0.01, y - 0.42 + s * 0.06, 0.058, PI / 2 + 0.25);
}

/**
 * A rescue basket stretcher at (x, z) turned yaw (long along its b): the orange tub with the steel rim rail, the
 * patient straps, the four-leg rope bridle gathered at its ring for the haul; `lean`: stood up on end against a wall
 * behind it (-b), tipped `lean` radians from upright.
 */
export function stokes(c, x, z, yaw = 0, { lean = 0 } = {}) {
  const { M, X } = c;
  const Lh = 1.05, Wd = 0.3;
  const g = lean ? grp(c, x, Lh, z, yaw, -PI / 2 - lean) : grp(c, x, 0, z, yaw);
  g(X.i_rescue, boxG(Wd * 2 - 0.06, 0.012, Lh * 2 - 0.06), 0, 0.03, 0);
  for (const s of [-1, 1]) {
    g(X.i_rescue, boxG(0.01, 0.2, Lh * 2 - 0.08), s * (Wd - 0.03), 0.12, 0, 0, 0, s * -0.12);
    g(X.i_rescue, boxG(Wd * 2 - 0.08, 0.2, 0.01), 0, 0.12, s * (Lh - 0.03), s * 0.15);
    g(X.chrome, cylG(0.012, 0.012, Lh * 2, 6), s * Wd, 0.22, 0, PI / 2);
    g(X.chrome, cylG(0.012, 0.012, Wd * 2, 6), 0, 0.22, s * Lh, 0, 0, PI / 2);
  }
  for (const v of [-0.6, 0, 0.55]) g(M.black, boxG(Wd * 2 + 0.02, 0.006, 0.05), 0, 0.12, v);
  const c0 = Math.abs(Math.cos(yaw)), s0 = Math.abs(Math.sin(yaw));
  if (!lean) {
    // the bridle lying slack over the bed, gathered at its ring
    const W3 = (u, py, v) => V(x + u * Math.cos(yaw) + v * Math.sin(yaw), py, z - u * Math.sin(yaw) + v * Math.cos(yaw));
    for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) strip(c, X.i_rope, W3(s * Wd, 0.22, t * 0.8), W3(s * 0.03, 0.05, t * 0.05), 0.012);
    g(X.chrome, torG(0.04, 0.008, 4, 10), 0, 0.05, 0, PI / 2);
    c.col(x - Wd * c0 - Lh * s0, 0, z - Wd * s0 - Lh * c0, x + Wd * c0 + Lh * s0, 0.25, z + Wd * s0 + Lh * c0, SURF.wood);
  } else c.col(x - Wd * c0 - 0.25 * s0, 0, z - Wd * s0 - 0.25 * c0, x + Wd * c0 + 0.25 * s0, 2.0, z + Wd * s0 + 0.25 * c0, SURF.wood);
}

/** a breathing apparatus set dropped at (x, z) turned yaw: the composite cylinder on its backplate, the harness, the gauge on its hose, the full-face mask beside it */
export function scba(c, x, z, yaw = 0) {
  const { M, U, X } = c;
  const g = grp(c, x, 0, z, yaw);
  g(M.black, rbox(0.3, 0.035, 0.62, 0.015), 0, 0.02, 0);
  g(M.yellow, cylG(0.085, 0.085, 0.52, 12), 0, 0.125, 0.02, PI / 2);
  g(X.chrome, cylG(0.03, 0.03, 0.08, 8), 0, 0.125, -0.28, PI / 2);
  for (const s of [-1, 1]) g(M.black, boxG(0.05, 0.01, 0.5), s * 0.12, 0.045, 0.05, 0, s * 0.08);
  g(M.black, boxG(0.32, 0.012, 0.06), 0, 0.045, 0.27);
  g(M.black, cylG(0.012, 0.012, 0.42, 5), 0.24, 0.02, -0.1, PI / 2, 0.5);
  g(M.dark, cylG(0.035, 0.035, 0.03, 10), 0.36, 0.03, 0.08, 0, 0, 0);
  // the mask, face down beside it
  g(M.black, rbox(0.2, 0.07, 0.24, 0.04), -0.34, 0.035, 0.18, 0, 0.6);
  g(U.glass, rbox(0.17, 0.02, 0.2, 0.02), -0.34, 0.075, 0.18, 0, 0.6);
  g(M.dark, cylG(0.035, 0.03, 0.04, 8), -0.4, 0.06, 0.29, PI / 2, 0.6);
}

/**
 * A fire point on the wall at (x, z) facing `face`: the red backboard and its sign, two extinguishers (CO₂ and
 * water) on their hooks, the fire axe on its brackets (gone: `axe` false leaves the painted outline), the fire blanket
 * pouch, the manual call point and its sounder beside the board (+a).
 */
export function firePoint(c, x, z, face, { axe = false } = {}) {
  const { M, X } = c;
  const f = fr(x, z, face);
  B(c, f, X.d_fireRed, -0.55, 0.35, 0, 0.55, 1.95, 0.015);
  lbl(c, f, 'FIRE POINT', 0, 1.85, 0.015 + 0.018, 0.9, 0.14, { bg: '#b3231b', fg: '#ffffff', border: '#ffffff', font: 'bold 64px Arial' });
  for (const [a, m, tag] of [[-0.3, M.black, 'CO₂'], [0.05, X.d_fireRed, 'WATER']]) {
    Cy(c, f, m === M.black ? X.d_fireRed : m, a, 0.4, 0.11, 0.08, 0.08, 0.52, 12);
    Cy(c, f, M.black, a, 0.92, 0.11, 0.025, 0.02, 0.06, 8);
    rodL(c, f, M.black, a, 0.95, 0.11, a + 0.09, 0.9, 0.2, 0.012, 5);
    if (m === M.black) Cy(c, f, M.black, a, 0.5, 0.11, 0.081, 0.081, 0.12, 12); // (the CO₂ one's black band)
    lbl(c, f, tag, a, 0.68, 0.19 + 0.018, 0.12, 0.06, { bg: '#f3f1e7', fg: '#16181a', border: '#16181a', font: 'bold 40px Arial' });
  }
  // the axe brackets; the axe, or the outline where it hung
  for (const y of [1.15, 1.6]) Cu(c, f, M.black, 0.36, y, 0.03, 0.06, 0.03, 0.04);
  if (axe) {
    Cu(c, f, X.oak, 0.36, 1.35, 0.06, 0.04, 0.8, 0.03);
    Cu(c, f, X.d_fireRed, 0.4, 1.7, 0.06, 0.2, 0.1, 0.015);
  } else {
    Cu(c, f, M.white, 0.36, 1.35, 0.016, 0.05, 0.8, 0.002);
    Cu(c, f, M.white, 0.4, 1.7, 0.016, 0.21, 0.11, 0.002);
  }
  R(c, f, X.d_fireRed, -0.3, 1.45, 0.05, 0.3, 0.3, 0.08, 0.02);
  lbl(c, f, 'FIRE BLANKET', -0.3, 1.45, 0.09 + 0.018, 0.26, 0.08, { bg: '#ffffff', fg: '#b3231b', border: '#b3231b', font: 'bold 36px Arial' });
  for (const s of [-1, 1]) Cu(c, f, M.white, -0.3 + s * 0.06, 1.24, 0.08, 0.03, 0.12, 0.006);
  const [ax, az] = at(f, 0.72, 0);
  DD.fireAlarm(c, ax, 1.18, az, face);
}

/**
 * A security post's desk at (x, z) facing `face` (the guard sat at its back, looking out): grey steel, the raised
 * front panel with the NOX shield, a dead monitor turned to the guard, the visitors' log open on its chain pen, the
 * radio in its charger, a cold coffee; the guard's chair shoved away.
 */
export function guardDesk(c, x, z, face, { w = 1.3, d = 0.62, chair = true } = {}) {
  const { M, X, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.76;
  R(c, f, M.grey, 0, T - 0.02, 0, w, 0.04, d, 0.01);
  B(c, f, M.grey, -w / 2, 0, d / 2 - 0.04, w / 2, 1.08, d / 2);
  B(c, f, M.dark, -w / 2 - 0.02, 1.08, d / 2 - 0.14, w / 2 + 0.02, 1.11, d / 2 + 0.02);
  for (const s of [-1, 1]) B(c, f, M.grey, s * (w / 2) - 0.02, 0, -d / 2, s * (w / 2) + 0.02, T - 0.04, d / 2 - 0.04);
  lbl(c, f, 'SECURITY · LEVEL 5', 0, 0.84, d / 2 + 0.018, 0.7, 0.12, { bg: '#1b2127', fg: '#e8edf0', border: '#2f6fb0', font: 'bold 44px Arial' });
  // the monitor, dead, toward the guard
  const ma = -w * 0.2;
  R(c, f, M.black, ma, T + 0.2, -0.05, 0.42, 0.3, 0.06, 0.01);
  Cu(c, f, M.dark, ma, T + 0.02, -0.03, 0.18, 0.02, 0.14);
  Cu(c, f, M.dark, ma, T + 0.08, -0.02, 0.04, 0.12, 0.03);
  const [mx, mz] = at(f, ma, -0.081);
  c.screen?.(mx, T + 0.2, mz, f.yaw + PI, 0.38, 0.24, false);
  c.wallDecal?.('crack', mx, T + 0.2, mz, { s: 'n', n: 's', e: 'w', w: 'e' }[f.face] ?? 'n', 0.3, 0.22);
  // the log on its chain, the radio, the coffee
  const la = w * 0.2;
  Cu(c, f, X.navy, la, T + 0.008, -0.08, 0.42, 0.012, 0.3, 0.1);
  Cu(c, f, X.paper, la, T + 0.016, -0.08, 0.4, 0.004, 0.28, 0.1);
  rodL(c, f, X.chrome, la + 0.2, T + 0.01, 0.0, la + 0.16, T + 0.012, -0.18, 0.003, 3);
  R(c, f, M.dark, -w / 2 + 0.09, T + 0.03, 0.12, 0.12, 0.06, 0.1, 0.01);
  R(c, f, M.black, -w / 2 + 0.09, T + 0.12, 0.12, 0.06, 0.14, 0.035, 0.01);
  const [gx, gz] = at(f, w / 2 - 0.09, 0.15);
  Fac.mug(c, gx, T, gz);
  if (chair) {
    const [cx, cz] = at(f, 0.15 + jit(c, 0.2), -d / 2 - 0.6);
    P.chair(c, cx, cz, f.yaw + PI + 0.7 + rnd() * 0.4);
  }
  col(c, f, -w / 2 - 0.02, -d / 2, w / 2 + 0.02, d / 2 + 0.02, 0, 1.11, SURF.metal);
}

// ---------------------------------------------------------------- the rooms
/**
 * The directors' offices on level 5 (uoff, x 12…20, z -10…-2.5; the door in the south wall at x 14…15.5, a vent low on
 * the east wall at z -5): the two directors' partner desk on its rug under the skyline print, flanked by the credenza
 * and the old safe in the corner (emptied, cash dropped, a briefcase half packed beside it); the conference nook of
 * tub chairs under the wall screen and the bookshelves; the architect's model of the site in the middle, its hood
 * shoved off (the red pins where it spread); the lounge by the door: the tan chesterfield with a coat flung over it,
 * the club chair, the bar cart, the floor lamp; diplomas; the shredder that jammed while they fed it the K-7 files.
 */
export function dressUoff(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the desk zone: the rug, the partner desk, two chairs (one shoved back, the other knocked over)
  Fac.rug(c, 17.3, -7.85, 3.4, 2.7, { mat: X.d_oxblood, border: X.d_brass });
  partnerDesk(c, 17.3, -7.9, 's', { w: 2.0, d: 1.0, out: [0, 4], dropped: true, name: 'DR. M. KESSLER', name2: 'DR. H. OYELARAN' });
  DD.execChair(c, 17.55, -8.95, 0.55, { mat: X.i_tan });
  DD.execChair(c, 16.7, -6.75, PI + 0.3, { mat: X.d_leatherBlack, down: true });
  DD.photoFrame(c, 16.65, 0.78, -7.62, 2.6, { w: 0.15, h: 0.2 });
  Fac.mug(c, 18.05, 0.78, -7.6);
  Fac.papers(c, 17.55, 0.78, -7.55, 0.4, 4);
  // the north wall: bookshelves west, the credenza with the print over it, the plant, the safe in the corner
  for (const [x, fill] of [[12.55, 'books'], [13.5, 'mixed']]) Fac.bookshelf(c, x, z0, 's', { w: 0.9, h: 2.1, mat: X.i_mahogany, fill, sparse: 0.3 });
  DD.sideboard(c, 17.3, z0, 's', { w: 1.8, mat: X.i_mahogany, catering: false });
  DD.photoFrame(c, 16.6, 0.78, z0 + 0.3, 0.2, { w: 0.18, h: 0.24 });
  DD.photoFrame(c, 16.95, 0.78, z0 + 0.32, -0.1, { down: true });
  DD.award(c, 17.9, 0.78, z0 + 0.28, 0.1);
  for (let i = 0; i < 7; i++) c.K.add(pick(c, [X.d_oxblood, X.i_inlay, X.d_slate, X.navy]), boxG(0.04, 0.24 + rnd() * 0.04, 0.17), 17.35 + i * 0.046, 0.905, z0 + 0.25, [0, 0, i === 6 ? 0.3 : 0]);
  skylinePrint(c, 17.3, 1.78, z0, 's', { w: 1.7, h: 0.9, caption: 'SINGAPORE · NOX ASIA-PACIFIC · 2019' });
  Fac.plantPot(c, 18.75, z0 + 0.4, { kind: 'tall', size: 1.1 });
  floorSafe(c, 19.56, -9.56, 'w', { open: 1.75, cash: 5 });
  DD.briefcase(c, 18.85, 0, -8.55, 0.5, { open: true, cash: true });
  for (let k = 0; k < 4; k++) c.decal('paper', 18.4 + rnd() * 1.2, -8.8 + rnd() * 1.4, 0.5 + rnd() * 0.3, rnd() * 6);
  // the conference nook: the table, its tub chairs, the screen on the west wall
  nookTable(c, 13.65, -7.55, { r: 0.6 });
  tubChair(c, 13.6, -8.5, 0.1);
  tubChair(c, 12.72, -7.45, PI / 2 - 0.2);
  tubChair(c, 14.3, -6.75, -2.4, { down: true });
  Fac.tvOnWall(c, x0, 1.55, -7.55, 'e', { w: 1.2, lines: ['Q3 BOARD · SITE 4', 'K-7 PROGRAMME: SUSPENDED', 'LIABILITY REVIEW 14:00'], bg: '#10243a', fg: '#9fd0ff' });
  Fac.wallPlate(c, x0, 0.3, -6.6, 'e');
  // the model of the site, its hood shoved off a corner
  complexModel(c, 13.25, -4.95, 'e', { w: 1.7, d: 1.1, hood: 0.7, pins: 8 });
  // the lounge by the door: the chesterfield, the coat, the club chair, the table, the lamp
  Fac.rug(c, 18.25, -3.75, 2.6, 2.0, { mat: X.navy, border: X.d_brass });
  Fac.sofa(c, 18.3, z1 - 0.45, 'n', { w: 2.0, d: 0.86, mat: X.i_tan, seats: 3 });
  drapedCoat(c, 17.75, 0.87, z1 - 0.13, PI, { mat: X.charcoal });
  Fac.coffeeTable(c, 18.3, -4.05, 'n', { w: 1.0, d: 0.55, mat: X.i_mahogany });
  Fac.armchair(c, 16.75, -3.85, PI / 2 + 0.25, { mat: X.i_tan });
  DD.floorLamp(c, 19.65, z1 - 0.3, { on: true, light: true });
  barCart(c, 19.62, -6.75, -PI / 2, { spilled: true });
  // the walls: diplomas over the bar cart, the clock, the switch and sockets, the coat rack and the shredder by the door
  Fac.framed(c, x1, 1.72, -7.5, 'w', { w: 0.46, h: 0.36, lines: ['NOX BIOSYSTEMS', 'DIRECTOR OF RESEARCH', 'Dr. Mara Kessler'], frame: X.d_brass });
  Fac.framed(c, x1, 1.72, -6.75, 'w', { w: 0.46, h: 0.36, lines: ['DOCTOR OF MEDICINE', 'Karolinska Institutet', 'H. Oyelaran · 2004'], frame: M.black });
  Fac.framed(c, x1, 1.72, -6.0, 'w', { w: 0.46, h: 0.36, lines: ['SITE 4 · SAFETY AWARD', '1000 DAYS', 'WITHOUT AN INCIDENT'], bg: '#10243a', fg: '#9fd0ff', frame: X.d_brass, font: 'bold 34px Arial' });
  Fac.wallClock(c, x1, 2.5, -5.0, 'w');
  Fac.wallPlate(c, 15.8, 1.15, z1, 'n', 'switch');
  Fac.wallPlate(c, 16.5, 0.3, z1, 'n');
  Fac.wallPlate(c, x1, 0.3, -8.0, 'w');
  Fac.coatRack(c, 13.35, z1 - 0.35, { coats: 1 });
  DD.paperShredder(c, 14.6, z0 + 0.22, 's', { jam: true });
  DD.archiveBoxes(c, 15.65, z0 + 0.25, 's', { n: 3, spill: true, tag: 'K-7 · BOARD' });
  Fac.plantPot(c, 12.65, z1 - 0.65, { kind: 'leafy', size: 0.9, dead: true }); // (its dropped leaves lie up to 0.57 m round it)
  for (let k = 0; k < 5; k++) c.decal('paper', 14.3 + rnd() * 1.8, -9.3 + rnd() * 1.2, 0.45 + rnd() * 0.3, rnd() * 6);
  c.wallDecal('bloodSmear', 13.75, 1.05, z1, 'n', 0.28, 0.6);
  c.decal('bloodDrag', 14.75, -3.4, 1.1, 0.3);
  c.light(16.6, 1.2, -8.1, 0.3, 1.4, [0.75, 1.0, 0.8], null, 3);
}

/**
 * The isolation ward on level 5 (uward, x 2.5…16, z -30…-15; the door in the west wall at z -24…-21.5, a vent low on
 * that wall at z -27): four glass-fronted cells along each long side (x 3.2 + 3.1 i, 2.8 wide, 3.2 deep), every
 * other front burst outward, with the service piers between them (hatches, intercoms, patient cards); the cells as
 * they were left: a restrained bed torn loose, a bagged body on a gurney, a slashed mattress, a patient who died on
 * the drip, a body bag unzipped on the floor, one behind its drawn curtain left empty. The central lane (~4 m) runs from the door to the nurses' station at the east end, its
 * glass screen shot out, the med fridge in alarm and the crash cart beside it; a containment team's last stand and
 * their gear dropped along the lane, a blood trail from the first smashed cell to the door. Dark and green.
 */
export function dressWard(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  const N = (i) => [3.2 + i * 3.1, z0, 6.0 + i * 3.1, z0 + 3.2];
  const So = (i) => [3.2 + i * 3.1, z1 - 3.2, 6.0 + i * 3.1, z1];
  const cells = [
    // [rect, face, state, door side, number, curtain, alarm]
    [N(0), 's', 'smashed', -1, 'ISO 5-01', 0, true],
    [N(1), 's', 'open', 1, 'ISO 5-02', 0.6, false],
    [N(2), 's', 'smashed', -1, 'ISO 5-03', 0, false],
    [N(3), 's', 'open', 1, 'ISO 5-04', 0, true],
    [So(0), 'n', 'open', 1, 'ISO 5-08', 0, false],
    [So(1), 'n', 'smashed', 1, 'ISO 5-07', 0, true],
    [So(2), 'n', 'open', -1, 'ISO 5-06', 0.8, false],
    [So(3), 'n', 'smashed', -1, 'ISO 5-05', 0, false],
  ];
  for (const [[a0, b0, a1, b1], face, state, door, n, curtain, alarm] of cells) wardCell(c, a0, b0, a1, b1, face, { n, state, door, curtain, alarm, h: s.h });
  // the piers between the cells, their cards
  const cards = [['SUBJECT 2231', 'NIL BY MOUTH'], ['SUBJECT 2236', 'SEDATE Q4H'], ['SUBJECT 2240', 'DO NOT ENTER'], ['SUBJECT 2219', 'OBS Q1H'], ['SUBJECT 2244', 'RESTRAIN'], ['SUBJECT 2247', 'BARRIER NURSING']];
  for (let i = 0; i < 3; i++) {
    const px = 6.0 + i * 3.1;
    cellPier(c, px, z0, px + 0.3, z0 + 3.2, 's', { h: s.h, card: cards[i], open: i === 1 });
    cellPier(c, px, z1 - 3.2, px + 0.3, z1, 'n', { h: s.h, card: cards[3 + i], open: i === 0 });
  }
  // inside the cells (north row: heads on the north wall; south row: on the south wall)
  L.hospitalBed(c, 4.95, z0, 's', { restraints: true, torn: true, blood: true, rails: 'down', blanket: false, chart: 'SUBJECT 2231 · RESTRAINED' });
  c.decal('blood', 4.4, -27.4, 1.0, 0.4);
  P.gurney(c, 7.2, -28.45, 0.08, { bag: true });
  steelWC(c, 8.55, z0, 's');
  tornMattress(c, 10.9, -28.3, 0.5);
  L.clawMarks(c, 10.6, 1.5, z0, 's', { n: 4, len: 0.8 });
  L.hospitalBed(c, 13.45, z0, 's', { blanket: true, blood: true, rails: 'up', chart: 'SUBJECT 2250 · DECEASED 03:12' });
  L.ivStand(c, 14.4, -29.45, { bags: 1 });
  DB.openBag(c, 4.75, -16.35, 1.75);
  steelWC(c, 3.65, z1, 'n');
  P.gurney(c, 8.3, -16.5, 1.25, { tipped: true });
  c.decal('blood', 7.6, -17.3, 1.1, 2.2);
  steelWC(c, 11.65, z1, 'n');
  c.decal('footprints', 10.6, -17.3, 0.9, 0.2);
  tornMattress(c, 13.6, -16.4, 2.6, { blood: true });
  gearDrop(c, 14.6, -15.8, 0.7, 'syringe');
  c.wallDecal('bloodSmear', 12.6, 0.9, -16.6, 'e', 0.35, 0.8);
  // the strips in front of the cells: cover, things dropped
  DB.linenCart(c, 6.7, -25.65, 0.25, { soiled: true });
  L.wasteBin(c, 12.35, -26.25, { kind: 'bio', open: true });
  P.gurney(c, 9.0, -19.55, PI / 2, { bag: true });
  L.wasteBin(c, 12.95, -19.0, { kind: 'general', yaw: 0.4 });
  // the nurses' station at the east end: the counter, its shot-out glass, the board of patients, the fridge, the cart
  L.nurseStation(c, x1, -22.5, 'w', 4.2, { depth: 1.7 });
  ruinedGlazing(c, x1 - 1.55, -22.5, 'w', 4.0, { y0: 1.08, top: 2.05, whole: 2 });
  c.label('PATIENT BOARD', x1, 2.4, -22.5, 'w', 2.6, 0.62, { lines: ['ISO 5-01  2231  RESTRAINED', 'ISO 5-02  2236  SEDATE Q4H', 'ISO 5-03  2240  ——', 'ISO 5-04  2250  † 03:12', 'ISO 5-05 … 5-08  SEE NIGHT LOG'], bg: '#f3f5f6', fg: '#1c3f8f', border: '#9aa2a8', font: 'bold 30px Arial', align: 'left' });
  medFridge(c, x1, -26.25, 'w', { ajar: 0.9, hinge: -1 });
  resusTrolley(c, x1, -19.35, 'w', { open: true });
  c.decal('glass', 13.9, -23.0, 1.4, 0.3);
  // the west wall by the door: PPE, hand rub, extinguisher, placards, the switch, the clock; bins in the niches
  DB.ppeStation(c, x0, -20.15, 'e', { y: 1.3 });
  DA.handGel(c, x0, 1.2, -21.15, 'e');
  P.extinguisher(c, x0, -24.6, 'e');
  L.hazardPlacard(c, x0, 1.75, -25.4, 'e', 'bio');
  L.hazardPlacard(c, x0, 1.75, -26.05, 'e', 'neg');
  L.lightSwitch(c, x0, -24.3, 'e');
  L.wallClock(c, x0, 2.35, -20.15, 'e'); // (over the PPE station: the door's sign has the wall over the door)
  L.sharpsDrum(c, 2.85, -15.6);
  P.cabinet(c, [15.35, z0 + 0.05, 15.95, z0 + 1.45], 'w', { h: 2.0, mat: M.white, drawers: 2 });
  L.cctvCam(c, x1, 2.75, -18.4, 'w', -0.5);
  // the lane: the last stand by the station, the gear dropped toward the door, the blood trail out of 5-01
  DB.teamDown(c, 11.6, -22.3, -PI / 2 - 0.3);
  const drops = [['helmet', 9.4, -21.4], ['mags', 8.6, -23.6], ['torch', 7.3, -22.0], ['radio', 6.2, -23.3], ['syringe', 5.3, -21.6], ['clipboard', 4.6, -23.9], ['clog', 3.9, -20.9], ['vest', 10.3, -23.9]];
  for (const [k, x, z] of drops) gearDrop(c, x, z, rnd() * 6, k);
  DD.casings(c, 12.4, -22.6, 9, 0.9);
  for (const [x, z, r] of [[4.6, -26.0, 1.9], [4.1, -24.6, 2.3], [3.4, -23.4, 2.6]]) c.decal('bloodDrag', x, z, 1.2, r);
  c.wallDecal('blood', x0, 1.0, -18.9, 'e', 0.4, 0.5);
  // the light: sick green over the lane, the station's screen, the cells' alarm
  for (const x of [5.8, 10.6]) c.light(x, 2.7, -22.6, 0.45, 3.2, SICK, null, 8);
  c.light(14.6, 1.4, -22.5, 0.3, 1.5, [0.6, 1.0, 0.75], null, 3);
  c.light(4.6, 2.9, -26.6, 0.3, 1.4, [1.0, 0.2, 0.15], null, 3);
}

/**
 * The elevator hall on level 5 (uws, x -31.5…-28.5, z 2…17.5: the west wing's upper corridor opens into its north end;
 * the elevator's pried doors in the west wall at z 14.6…16.4, the crashed car's shaft beyond): the security post by
 * the junction (its monitor dead, the log open), the fire point, the hose cabinet and the evacuation plan; the rescue
 * that never went down: a basket stretcher stood against the wall, a breathing set and a firefighter's coat dropped,
 * the engineers' trolley with the spreader that forced the doors, a rope tied off over the sill; at the doors the
 * barriers shoved aside and the tape torn, the warning board and the notice, the call panel ripped out, the amber
 * beacon still turning, bloody footprints coming out of the shaft. The middle metre (x -30.5…-29.5) and 1.4 m in
 * front of the doors stay clear.
 */
export function dressElevatorHall(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the security post by the junction: the desk facing the corridor, the guard's chair shoved back
  guardDesk(c, -28.99, 4.3, 'n', { w: 0.98, d: 0.55 });
  DD.evacPlan(c, x0, 1.5, 3.6, 'e', { title: 'EVACUATION PLAN · LEVEL 5', here: [0.15, 0.4], w: 0.55 });
  L.cctvCam(c, x1, 2.7, 2.6, 'w', 0.5);
  DD.exitSign(c, x1, 2.45, 6.2, 'w', { arrow: '↑' });
  Fac.wallPlate(c, x1, 0.3, 6.9, 'w');
  TK.keyCabinet(c, x1, 1.55, 5.35, 'w', { open: 1.5, taken: 0.55 });
  // the west wall: the fire point, the hose cabinet, the rescue kit left behind
  firePoint(c, x0, 6.9, 'e', { axe: false });
  DD.hoseCabinet(c, x0, 8.85, 'e', { open: true });
  gearDrop(c, -30.85, 7.85, 1.1, 'turnout');
  gearDrop(c, -30.95, 9.7, 0.4, 'firehelmet');
  scba(c, -30.85, 10.6, 2.6);
  stokes(c, -31.1, 12.0, PI / 2, { lean: 0.15 });
  // east wall: the notices, a socket; the warning board facing up the hall
  c.label('NOTICE', x1, 1.75, 10.2, 'w', 1.0, 0.7, { lines: ['ELEVATOR 2', 'OUT OF SERVICE', 'CAR AT SUB-5 · CABLES FAILED', 'NO RESCUE WITHOUT', 'SITE ENGINEER'], ...WARN, font: 'bold 40px Arial' });
  aBoard(c, -28.95, 12.7, PI, { lines: ['DANGER', 'OPEN SHAFT', 'NO ENTRY'] });
  // at the doors: a barrier shoved aside, another down, the tape torn; the call panel ripped out; the beacon
  const post = barrier(c, -31.0, 13.95, 0.25, { len: 0.8 });
  barrier(c, -30.6, 17.3, PI + 0.15, { down: true, len: 0.8 });
  hazardTape(c, post[0], post[1], post[2], x0 + 0.02, 0.95, 16.55, { torn: true });
  hazardTape(c, x0 + 0.03, 1.2, 14.6, x0 + 0.03, 0.4, 16.4, { torn: true });
  callPanel(c, x0, 1.2, 14.05, 'e', { smashed: true });
  L.warningBeacon(c, x0, 2.45, 13.9, 'e', { red: false, lit: true });
  L.clawMarks(c, x0, 1.1, 13.75, 'e', { n: 4, len: 0.6 });
  // the engineers' trolley, the work light aimed at the doors, the rope tied off to the trolley and over the sill
  maintTrolley(c, -28.86, 15.05, PI / 2);
  TK.workLight(c, -28.95, 16.95, -PI / 2 - 0.5, { lit: true, h: 1.6 });
  c.K.rod(M.black, V(-29.05, 0.25, 14.7), V(-30.4, 0.01, 15.2), 0.008, 4);
  c.K.rod(X.i_rope, V(-29.05, 0.25, 14.7), V(-30.4, 0.01, 15.2), 0.012, 5);
  c.K.rod(X.i_rope, V(-30.4, 0.01, 15.2), V(x0 - 0.02, 0.02, 15.45), 0.012, 5);
  c.K.rod(M.black, V(-31.2, 0.012, 15.7), V(-30.45, 0.012, 16.05), 0.012, 6); // (the pry bar)
  gearDrop(c, -30.15, 14.25, 2.3, 'torch');
  gearDrop(c, -29.85, 16.3, 0.6, 'wrench');
  gearDrop(c, -30.35, 16.95, 1.9, 'hammer');
  // what came out of the shaft: the blood at the sill, prints up the hall
  c.decal('blood', -31.1, 15.4, 0.9, 0.4);
  for (let k = 0; k < 4; k++) c.decal('footprints', -30.4 + jit(c, 0.25), 14.2 - k * 2.6, 1.0, PI + jit(c, 0.3));
  for (let k = 0; k < 3; k++) c.decal('paper', -29.4 + jit(c, 0.3), 5.2 + rnd() * 1.6, 0.4, rnd() * 6);
}
