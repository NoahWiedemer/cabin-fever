// The Hive's waste & incineration room, the specimen hall and Nadja's lab outside her clean room (world/hive.js):
// props in the idiom of hiveProps.js (world-space geometry for the Kit, one mesh per material, baked light, a collider
// for whatever you'd bump into) and one dress function per room. Built on hiveProps.js and hiveLabs.js.
//
// c: hiveProps.js's build context plus X (EXTRA_MATS, baked), G (EXTRA_GLOW, emissive), label(text, x, y, z, face,
//    w, h, opts) (face 'up': lying on the floor, opts.yaw), decal(kind, x, z, size, rot), wallDecal(kind, x, y, z, face,
//    w, h), screen(x, y, z, yaw, w, h, on).
// Wall props take (x, z) = the middle of their back edge on the wall line and `face`, the side they open toward
// ('n' -z, 's' +z, 'w' -x, 'e' +x). Free-standing ones take their centre and a yaw (radians, 0 = front toward +z).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import { SIGN, atlasPlane } from './lab.js';
import * as P from './hiveProps.js';
import * as L from './hiveLabs.js';
import * as Fac from './hiveFacility.js';

/** baked materials this module adds (c.X) */
export const EXTRA_MATS = {
  c_ss: { color: 0xc3c8cb, metalness: 0.75, roughness: 0.34 }, // brushed stainless
  c_galv: { color: 0x8f979a, metalness: 0.6, roughness: 0.6 }, // galvanised steel, pallets of drums, the tipper
  c_rubber: { color: 0x161718, roughness: 0.95 },
  c_pallet: { color: 0xa4855a, roughness: 0.88 }, // pallet pine
  c_binBox: { color: 0xe0b232, roughness: 0.8 }, // yellow clinical-waste cartons
  c_bagYellow: { color: 0xe8c21a, roughness: 0.32 },
  c_bagOrange: { color: 0xe2701c, roughness: 0.32 },
  c_ash: { color: 0x57534f, roughness: 0.98 },
  c_tipper: { color: 0x2d6a3c, metalness: 0.3, roughness: 0.5 }, // RAL green machine paint
  c_orange: { color: 0xdc5e1c, roughness: 0.5 }, // safety orange
  c_formalin: { color: 0xd9d39c, roughness: 0.18 }, // the jars' fixative, straw yellow
  c_tissue: { color: 0xc69a8a, roughness: 0.6 },
  c_enamel: { color: 0xe7ebe8, roughness: 0.38 }, // fridge / cabinet enamel
  c_olive: { color: 0x4d5435, roughness: 0.9 }, // the squad's canvas and webbing
  c_caseBlack: { color: 0x1e2022, roughness: 0.5 },
  c_foam: { color: 0x2b2d2f, roughness: 1.0 },
  c_wool: { color: 0x666a6d, roughness: 0.98 }, // army blankets
  c_scrubs: { color: 0x5d9a8b, roughness: 0.9 },
  c_brass: { color: 0xae8b3a, metalness: 0.8, roughness: 0.35 },
  c_paper: { color: 0xf2f0e6, roughness: 0.9 },
  c_board: { color: 0x6c4a2c, roughness: 0.7 }, // clipboards, the tool board's masonite
  c_coffee: { color: 0x2a170c, roughness: 0.2 },
  c_hivis: { color: 0xd8e021, roughness: 0.7 }, // a hi-vis vest
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  c_fridge: [0xdcefff, 1.35], // the sample wall's lit cabinets
  c_lcd: [0x7dffb0, 1.3], // scale and controller read-outs
  c_jar: [0x7cff9a, 1.1], // a specimen jar under its own UV strip
  c_warm: [0xffd08a, 1.6], // the squad's clamp lamp
  c_cyan: [0x52d8ff, 1.3], // status bars
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const YAW = P.FACE_YAW;
const RIGHT = { s: 'e', e: 'n', n: 'w', w: 's' }; // the +u side of a thing facing `face`
const LEFT = { s: 'w', e: 's', n: 'e', w: 'n' };
const BACK = { s: 'n', n: 's', e: 'w', w: 'e' };
const COOL = [0.93, 0.97, 1.0];
const nearFace = (yaw) => ['s', 'e', 'n', 'w'][((Math.round(yaw / (PI / 2)) % 4) + 4) % 4];
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];

// geometry made once and cloned by the Kit (K.add clones: the cache is never mutated)
const _geo = new Map();
const cached = (key, make) => {
  let g = _geo.get(key);
  if (!g) _geo.set(key, (g = make()));
  return g;
};
const k3 = (...a) => a.map((v) => Math.round(v * 1000)).join(',');
/** a w × h × d box, centred; rounded edges of radius r when r > 0 */
function rbox(w, h, d, r = 0) {
  if (r > 0) return cached('r' + k3(w, h, d, r), () => new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2) * 0.999));
  return cached('b' + k3(w, h, d), () => new THREE.BoxGeometry(w, h, d));
}
const cylG = (r0, r1, h, seg = 12, open = false) => cached('c' + k3(r0, r1, h) + ':' + seg + open, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(0, h / 2, 0));
const cylC = (r0, r1, h, seg = 12) => cached('cc' + k3(r0, r1, h) + ':' + seg, () => new THREE.CylinderGeometry(r1, r0, h, seg));
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const capG = (r, l, cs = 3, rs = 8) => cached('p' + k3(r, l) + ':' + cs + ':' + rs, () => new THREE.CapsuleGeometry(r, l, cs, rs));
const planeG = (w, h) => cached('q' + k3(w, h), () => new THREE.PlaneGeometry(w, h));

// ---------------------------------------------------------------- the local frame
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = V(), _s = V(1, 1, 1);
/**
 * A prop's local frame (as in hiveLabs.js): u across (to the right of someone looking at its front), y up, v out from
 * its back toward its front. At (x, y, z) turned by `face` (a letter or a yaw), optionally tilted ([rx, rz] before the yaw).
 */
class Frame {
  constructor(c, x, z, face, { y = 0, tilt = null } = {}) {
    this.c = c;
    this.yaw = typeof face === 'number' ? face : YAW[face];
    this.face = typeof face === 'number' ? nearFace(face) : face;
    _e.set(tilt?.[0] ?? 0, this.yaw, tilt?.[1] ?? 0, 'YXZ');
    this.m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(_e), V(1, 1, 1));
  }
  p(u, y, v) {
    return V(u, y, v).applyMatrix4(this.m);
  }
  add(mat, g, u, y, v, r = null, s = null) {
    _e.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0, r?.[3] ?? 'YXZ');
    _m.compose(_p.set(u, y, v), _q.setFromEuler(_e), s ? _s.set(s[0], s[1], s[2]) : _s.set(1, 1, 1));
    return this.c.K.addMatrix(mat, g, _m2.multiplyMatrices(this.m, _m));
  }
  box(mat, u, y, v, w, h, d, r = 0, rot = null) {
    return this.add(mat, rbox(w, h, d, r), u, y, v, rot);
  }
  span(mat, u0, y0, v0, u1, y1, v1, r = 0) {
    return this.box(mat, (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2, Math.abs(u1 - u0), Math.abs(y1 - y0), Math.abs(v1 - v0), r);
  }
  cyl(mat, u, y, v, r0, r1, h, seg = 12, open = false) {
    return this.add(mat, cylG(r0, r1, h, seg, open), u, y, v);
  }
  /** a lying cylinder centred at (u, y, v), along 'u' or 'v' */
  hcyl(mat, u, y, v, r, len, seg = 12, axis = 'u') {
    return this.add(mat, cylC(r, r, len, seg), u, y, v, axis === 'u' ? [0, 0, PI / 2] : [PI / 2, 0, 0]);
  }
  rod(mat, a, b, r, seg = 6) {
    return this.c.K.rod(mat, this.p(a[0], a[1], a[2]), this.p(b[0], b[1], b[2]), r, seg);
  }
  /** a flat picture facing the front, `rect` an atlas region of the signs atlas */
  plane(mat, w, h, u, y, v, rect = null, turn = 0) {
    if (!rect) return this.add(mat, planeG(w, h), u, y, v, [0, turn, 0]);
    return this.add(mat, cached('ap' + k3(w, h, ...rect), () => atlasPlane(w, h, rect)), u, y, v, [0, turn, 0]);
  }
  /** a gauge dial facing the front */
  gauge(u, y, v, s = 0.1) {
    this.add(this.c.M.dark, cylC(s * 0.56, s * 0.56, 0.025, 12), u, y, v + 0.0125, [PI / 2, 0, 0]);
    this.plane(this.c.M.signs, s, s, u, y, v + 0.026, SIGN.gauge);
  }
  /** text on the front plane at depth v (or a side: 'left' / 'right' / 'back' / a face letter / 'up') */
  label(text, u, y, v, w, h, opts = {}, side = 'front') {
    const f = side === 'front' ? this.face : side === 'right' ? RIGHT[this.face] : side === 'left' ? LEFT[this.face] : side === 'back' ? BACK[this.face] : side;
    const p = this.p(u, y, v);
    // (c.label pushes the plane 0.02 out along its normal: pull it back so it sits on the surface)
    const n = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[f];
    if (n) this.c.label(text, p.x - n[0] * 0.018, p.y, p.z - n[1] * 0.018, f, w, h, opts);
    else this.c.label(text, p.x, p.y, p.z, f, w, h, { ...opts, yaw: (opts.yaw ?? 0) + this.yaw });
  }
  screen(u, y, v, w, h, on = true) {
    const p = this.p(u, y, v);
    this.c.screen(p.x, p.y, p.z, this.yaw, w, h, on);
  }
  light(u, y, v, i, r, rgb = COOL, dir = null, range = null) {
    const p = this.p(u, y, v);
    this.c.light(p.x, p.y, p.z, i, r, rgb, dir, range);
  }
  /** the collider of a local box (its world AABB) */
  col(u0, v0, u1, v1, y1, surf = SURF.metal, flags = 0, y0 = 0) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const u of [u0, u1]) {
      for (const v of [v0, v1]) {
        const p = this.p(u, 0, v);
        x0 = Math.min(x0, p.x);
        x1 = Math.max(x1, p.x);
        z0 = Math.min(z0, p.z);
        z1 = Math.max(z1, p.z);
      }
    }
    this.c.col(x0, y0, z0, x1, y1, z1, surf, flags);
  }
}

// ---------------------------------------------------------------- small shared bits
/** a room title plate on the wall (dark plate, the room's name, a coloured bar) */
function roomTitle(c, text, x, y, z, face, w = 2.6, col = '#d6a31a') {
  c.label(text, x, y, z, face, w, 0.26, { bg: '#1b2127', fg: '#e8edf0', border: col, font: 'bold 60px Arial' });
}
/** a printed notice on the wall (white sheet, a coloured header line) */
function notice(c, x, y, z, face, lines, { w = 0.42, h = 0.56, head = '#b3141a' } = {}) {
  c.label(lines[0], x, y + h * 0.36, z, face, w, h * 0.2, { bg: head, fg: '#ffffff', border: head, font: 'bold 44px Arial' });
  c.label(lines.slice(1).join(' '), x, y - h * 0.12, z, face, w, h * 0.7, { bg: '#f7f5ec', fg: '#1d2328', border: '#f7f5ec', font: 'bold 28px Arial', lines: lines.slice(1) });
}
/** a painted floor line (paint a few mm proud of the floor) from (x0, z0) to (x1, z1), w wide */
function floorLine(c, x0, z0, x1, z1, w = 0.08, mat = null) {
  const m = mat ?? c.M.yellow;
  if (Math.abs(x1 - x0) > Math.abs(z1 - z0)) c.K.box(m, Math.min(x0, x1), 0.001, z0 - w / 2, Math.max(x0, x1), 0.004, z0 + w / 2, { faces: ['py'] });
  else c.K.box(m, x0 - w / 2, 0.001, Math.min(z0, z1), x0 + w / 2, 0.004, Math.max(z0, z1), { faces: ['py'] });
}
/** loose sheets round (x, z) and a paper decal under them */
function sheets(c, x, z, n = 4, spread = 0.6) {
  const { X, rnd } = c;
  for (let i = 0; i < n; i++) c.K.add(X.c_paper, planeG(0.21, 0.297), x + (rnd() - 0.5) * spread * 2, 0.003 + i * 0.0005, z + (rnd() - 0.5) * spread * 2, [-PI / 2, 0, rnd() * 3]);
  c.decal('paper', x, z, spread * 1.5, rnd() * 3);
}

// ---------------------------------------------------------------- waste & incineration
/**
 * A hydraulic bin tipper at (x, z), its back toward the end of a conveyor and its front toward `face`: base frame,
 * two masts, the comb cradle (a 660 L cart parked in it unless `cart` is false), the ram, a hopper hood over the
 * conveyor behind, the two-hand control box on a post, a guard chain, hazard paint.
 */
export function binTipper(c, x, z, face, { cart = true } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  const W = 1.5, D = 1.15;
  f.span(X.c_tipper, -W / 2, 0, 0.05, W / 2, 0.12, D);
  f.span(M.hazard, -W / 2 + 0.02, 0.12, D - 0.06, W / 2 - 0.02, 0.125, D - 0.01);
  for (const s of [-1, 1]) {
    f.span(X.c_tipper, s * 0.62 - 0.07, 0.12, 0.08, s * 0.62 + 0.07, 2.05, 0.24);
    f.span(M.dark, s * 0.62 - 0.03, 0.2, 0.24, s * 0.62 + 0.03, 1.95, 0.26);
    f.rod(X.c_ss, [s * 0.42, 0.14, 0.22], [s * 0.42, 1.25, 0.2], 0.04, 10); // the rams
    f.rod(M.dark, [s * 0.42, 1.25, 0.2], [s * 0.42, 1.55, 0.2], 0.025, 8);
  }
  f.span(X.c_tipper, -0.66, 1.95, 0.06, 0.66, 2.1, 0.26);
  // the comb (the cart's lip hooks on it) and the lower clamp bar
  f.span(X.c_ss, -0.55, 0.92, 0.26, 0.55, 1.02, 0.34);
  for (let i = 0; i < 5; i++) f.box(X.c_ss, -0.4 + i * 0.2, 1.05, 0.34, 0.04, 0.06, 0.06);
  f.span(M.dark, -0.5, 0.38, 0.26, 0.5, 0.44, 0.3);
  // the hopper hood leaning back over the conveyor's end
  f.add(X.c_ss, rbox(1.3, 0.5, 0.8, 0.02), 0, 2.0, -0.32, [0.35, 0, 0]);
  f.add(M.dark, rbox(1.32, 0.04, 0.82), 0, 1.73, -0.4, [0.35, 0, 0]);
  // the two-hand control box on a post at the front corner
  const cu = W / 2 + 0.12;
  f.cyl(M.dark, cu, 0, D - 0.1, 0.03, 0.03, 1.0, 8);
  f.box(M.yellow, cu, 1.12, D - 0.1, 0.24, 0.26, 0.14, 0.015);
  for (const s of [-1, 1]) f.add(M.green, cylC(0.025, 0.025, 0.03, 10), cu + s * 0.06, 1.1, D - 0.02, [PI / 2, 0, 0]);
  f.add(M.red, cylC(0.032, 0.032, 0.04, 12), cu, 1.2, D - 0.01, [PI / 2, 0, 0]);
  f.box(U.ledG, cu + 0.08, 1.21, D - 0.025, 0.02, 0.02, 0.01);
  f.label('LIFT  ·  HOLD BOTH', cu, 1.03, D - 0.025, 0.2, 0.04, { bg: '#e6b81b', fg: '#16181a', border: '#e6b81b', font: 'bold 30px Arial' });
  // the guard chain between the masts and the post, its sign
  f.rod(M.yellow, [-W / 2 - 0.05, 0.9, D], [-W / 2 - 0.05, 0.7, D - 0.5], 0.01, 4);
  f.label('DANGER · KEEP CLEAR WHEN LIFTING', 0, 1.7, 0.27, 0.9, 0.12, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 44px Arial' });
  if (cart) {
    const p = f.p(0, 0, 0.75);
    L.wasteCart(c, p.x, p.z, f.yaw + PI, { kind: 'bio', open: true });
  }
  f.col(-W / 2, 0.05, W / 2 + 0.2, D, 2.1, SURF.metal);
}

/** a platform scale at (x, z) turned yaw: the low tread plate and its ramp, a column with the weight read-out and printer */
export function platformScale(c, x, z, yaw = 0, { reading = '  212.4 kg' } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, yaw);
  f.span(M.dark, -0.6, 0, -0.6, 0.6, 0.07, 0.6);
  f.span(X.c_galv, -0.57, 0.07, -0.57, 0.57, 0.08, 0.57);
  for (let i = -4; i <= 4; i++) f.box(M.dark, 0, 0.082, i * 0.12, 1.1, 0.004, 0.02);
  f.add(X.c_galv, rbox(1.2, 0.02, 0.36, 0), 0, 0.035, 0.76, [0.2, 0, 0]);
  f.span(M.hazard, -0.6, 0.071, -0.6, 0.6, 0.082, -0.56);
  // the column at the back left, the indicator head, the ticket printer
  f.cyl(M.steel, -0.5, 0, -0.75, 0.035, 0.035, 1.2, 10);
  f.box(M.grey, -0.5, 1.33, -0.73, 0.36, 0.26, 0.12, 0.02);
  f.box(M.black, -0.5, 1.36, -0.665, 0.28, 0.08, 0.004);
  f.label(reading, -0.5, 1.36, -0.662, 0.26, 0.06, { bg: '#06120c', fg: '#7dffb0', border: '#06120c', font: 'bold 52px monospace' });
  f.box(G.c_lcd, -0.39, 1.27, -0.665, 0.02, 0.02, 0.006);
  for (let i = 0; i < 4; i++) f.box(M.dark, -0.59 + i * 0.05, 1.26, -0.665, 0.035, 0.025, 0.008);
  f.box(M.white, -0.5, 1.12, -0.72, 0.2, 0.1, 0.14);
  f.box(X.c_paper, -0.5, 1.06, -0.645, 0.06, 0.1, 0.002);
}

/**
 * The weigh-in / log station on the wall at (x, z): a steel stand-up desk at 1.05 m, the terminal on an arm, a
 * keyboard, the open load log, a barcode gun in its cradle, a label printer, a clipboard on a hook, binders above.
 */
export function logDesk(c, x, z, face, { w = 1.3, page = ['LOAD LOG · 14/10', 'B-2231  41.0 kg  BIO', 'B-2232  38.5 kg  BIO', 'P-0117  12.2 kg  PATH', 'P-0118  ———  ???'] } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  const T = 1.05, D = 0.5;
  f.span(X.c_ss, -w / 2, T - 0.03, 0, w / 2, T, D);
  f.span(X.c_ss, -w / 2, T - 0.13, D - 0.03, w / 2, T - 0.03, D);
  for (const s of [-1, 1]) {
    f.span(M.steel, s * (w / 2 - 0.05) - 0.025, 0, 0.03, s * (w / 2 - 0.05) + 0.025, T - 0.03, 0.08);
    f.span(M.steel, s * (w / 2 - 0.05) - 0.025, 0, 0.08, s * (w / 2 - 0.05) + 0.025, 0.04, D - 0.04);
    f.rod(M.steel, [s * (w / 2 - 0.05), 0.04, D - 0.06], [s * (w / 2 - 0.05), T - 0.15, 0.1], 0.015, 6);
  }
  f.span(M.steel, -w / 2 + 0.05, 0.25, 0.04, w / 2 - 0.05, 0.27, D - 0.08); // the bottom shelf
  for (let i = 0; i < 3; i++) f.box(X.c_binBox, -w / 2 + 0.3 + i * 0.36, 0.42, 0.25, 0.32, 0.3, 0.32);
  // the terminal on its wall arm
  f.span(M.dark, -0.33, 1.38, 0.0, -0.23, 1.5, 0.03);
  f.rod(M.dark, [-0.28, 1.44, 0.02], [-0.28, 1.44, 0.22], 0.015, 6);
  f.box(M.black, -0.28, 1.44, 0.25, 0.5, 0.32, 0.04, 0.01, [-0.15, 0, 0]);
  f.screen(-0.28, 1.445, 0.274, 0.46, 0.27, true);
  f.box(M.dark, -0.28, T + 0.012, D - 0.17, 0.42, 0.02, 0.14);
  // the log book open on the right, a pen, the barcode gun's cradle, the label printer
  f.box(X.c_board, 0.25, T + 0.008, 0.3, 0.42, 0.012, 0.3);
  f.label(page[0], 0.25, T + 0.016, 0.3, 0.38, 0.27, { bg: '#f4f1e4', fg: '#20242a', border: '#f4f1e4', font: 'bold 28px Arial', lines: page, yaw: 0 }, 'up');
  f.rod(M.blue, [0.42, T + 0.02, 0.4], [0.52, T + 0.02, 0.33], 0.005, 5);
  f.box(M.dark, w / 2 - 0.1, T + 0.05, 0.1, 0.1, 0.1, 0.1);
  f.add(M.yellow, rbox(0.06, 0.16, 0.05), w / 2 - 0.1, T + 0.15, 0.1, [0.4, 0, 0]);
  f.box(U.ledG, w / 2 - 0.1, T + 0.08, 0.152, 0.015, 0.015, 0.004);
  f.box(M.white, 0.05, T + 0.07, 0.08, 0.18, 0.14, 0.14);
  f.box(X.c_paper, 0.05, T + 0.1, 0.152, 0.08, 0.06, 0.002);
  // binders on a shelf above, a clipboard on its hook
  f.span(M.steel, -w / 2, 1.88, 0, w / 2, 1.9, 0.26);
  for (let i = 0; i < 7; i++) f.box(pick(c, [M.blue, M.red, M.dark, M.yellow]), -w / 2 + 0.12 + i * 0.075, 2.04, 0.13, 0.06, 0.28, 0.22);
  f.box(X.c_board, w / 2 - 0.2, 1.55, 0.012, 0.23, 0.32, 0.008);
  f.box(X.c_paper, w / 2 - 0.2, 1.53, 0.017, 0.2, 0.26, 0.002);
  f.label('WEIGH · SCAN · LOG EVERY LOAD', 0.25, 1.72, 0.004, 0.7, 0.09, { bg: '#1b2127', fg: '#e8edf0', border: '#d6a31a', font: 'bold 40px Arial' });
  f.col(-w / 2, 0, w / 2, D, T, SURF.metal);
}

/**
 * A pallet at (x, z) turned yaw (1.2 × 1.0): deck boards, blocks; `load` 'boxes' (yellow clinical-waste cartons,
 * labelled, strapped), 'drums' (four, the `gap` one missing: it is still on the hoist) or 'none'. `toppled`: the top
 * cartons knocked onto the floor.
 */
export function pallet(c, x, z, yaw = 0, { load = 'boxes', gap = -1, toppled = false } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const W = 1.2, D = 1.0;
  for (let i = 0; i < 7; i++) f.box(X.c_pallet, -W / 2 + 0.07 + i * ((W - 0.14) / 6), 0.13, 0, 0.1, 0.022, D);
  for (const v of [-D / 2 + 0.05, 0, D / 2 - 0.05]) f.box(X.c_pallet, 0, 0.1, v, W, 0.022, 0.1);
  for (const u of [-W / 2 + 0.05, 0, W / 2 - 0.05]) for (const v of [-D / 2 + 0.05, 0, D / 2 - 0.05]) f.box(X.c_pallet, u, 0.045, v, 0.1, 0.09, 0.1);
  let h = 0.14;
  if (load === 'boxes') {
    const layers = toppled ? 2 : 3;
    for (let l = 0; l < layers; l++) {
      for (const [u, v] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) {
        const y = 0.14 + l * 0.36 + 0.18;
        f.box(X.c_binBox, u + (rnd() - 0.5) * 0.03, y, v + (rnd() - 0.5) * 0.03, 0.58, 0.35, 0.48, 0, [0, (rnd() - 0.5) * 0.06, 0]);
        if (v > 0) {
          f.plane(M.signs, 0.16, 0.16, u - 0.12, y + 0.04, v + 0.241, SIGN.bio);
          f.label('UN3291', u + 0.12, y + 0.04, v + 0.241, 0.2, 0.06, { bg: '#e0b232', fg: '#16181a', border: '#e0b232', font: 'bold 40px Arial' });
        }
      }
    }
    h = 0.14 + layers * 0.36;
    for (const u of [-0.15, 0.15]) f.span(M.black, u - 0.008, 0.14, D / 2 - 0.005, u + 0.008, h + 0.005, D / 2 + 0.005);
    if (toppled) {
      for (let i = 0; i < 3; i++) {
        const p = f.p(-0.5 + i * 0.5 + rnd() * 0.2, 0, D / 2 + 0.45 + rnd() * 0.4);
        c.K.add(X.c_binBox, rbox(0.58, 0.35, 0.48), p.x, i === 1 ? 0.29 : 0.175, p.z, [0, rnd() * PI, i === 1 ? PI / 2 : 0]);
      }
      const p = f.p(0.2, 0, D / 2 + 0.9);
      c.decal('stain', p.x, p.z, 0.9, rnd() * 3);
    }
  } else if (load === 'drums') {
    let k = 0;
    for (const [u, v] of [[-0.3, -0.25], [0.3, -0.25], [-0.3, 0.25], [0.3, 0.25]]) {
      if (k++ === gap) continue;
      f.cyl(X.c_galv, u, 0.14, v, 0.28, 0.28, 0.88, 14);
      for (const y of [0.42, 0.72]) f.add(M.dark, torG(0.283, 0.012, 3, 12), u, 0.14 + y, v, [PI / 2, 0, 0]);
      f.cyl(M.dark, u + 0.12, 1.02, v, 0.03, 0.03, 0.015, 8);
      f.label('ASH · UN3077', u, 0.7, v + 0.281, 0.24, 0.07, { bg: '#ffffff', fg: '#16181a', border: '#16181a', font: 'bold 36px Arial' });
    }
    h = 1.02;
  }
  f.col(-W / 2, -D / 2, W / 2, D / 2, h, load === 'boxes' ? SURF.cardboard : SURF.metal);
}

/** a wheeled steel ash bin at (x, z) turned yaw: tapered galvanised body, the lid (shut or `open`, grey ash heaped in), handles */
export function ashBin(c, x, z, yaw = 0, { open = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  f.add(X.c_galv, cached('ashBody', () => new THREE.CylinderGeometry(0.3, 0.26, 0.72, 14, 1, true).translate(0, 0.46, 0)), 0, 0, 0);
  f.cyl(M.dark, 0, 0.09, 0, 0.26, 0.26, 0.02, 14);
  for (const y of [0.35, 0.7]) f.add(M.dark, cached('ashBand', () => new THREE.CylinderGeometry(0.296, 0.296, 0.025, 14, 1, true)), 0, y, 0);
  for (const s of [-1, 1]) {
    f.add(M.dark, torG(0.06, 0.012, 3, 6, PI), s * 0.31, 0.72, 0, [0, PI / 2, 0]);
    f.add(X.c_rubber, cylC(0.05, 0.05, 0.035, 8), s * 0.18, 0.05, s * 0.12, [0, 0, PI / 2]);
  }
  if (open) {
    f.add(X.c_ash, cached('ashHeap', () => new THREE.SphereGeometry(0.29, 10, 3, 0, PI * 2, 0, PI / 2).scale(1, 0.35, 1)), 0, 0.78, 0);
    f.add(X.c_galv, cylC(0.32, 0.32, 0.03, 14), 0.1, 0.42, 0.33, [1.35, 0, 0]);
  } else {
    f.cyl(X.c_galv, 0, 0.82, 0, 0.32, 0.3, 0.04, 14);
    f.box(M.dark, 0, 0.88, 0, 0.16, 0.03, 0.04, 0.01);
  }
  f.col(-0.32, -0.32, 0.32, 0.32, 0.86, SURF.metal);
}

/** an autoclave loading cart at (x, z) turned yaw: a stainless deck on castors, a wire basket, bags with indicator tape */
export function autoclaveBasket(c, x, z, yaw = 0) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const W = 0.9, D = 0.6;
  f.span(X.c_ss, -W / 2, 0.16, -D / 2, W / 2, 0.2, D / 2);
  for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    f.box(M.dark, u * (W / 2 - 0.06), 0.12, v * (D / 2 - 0.06), 0.05, 0.06, 0.05);
    f.add(X.c_rubber, cylC(0.05, 0.05, 0.03, 8), u * (W / 2 - 0.06), 0.05, v * (D / 2 - 0.06), [0, 0, PI / 2]);
  }
  // the basket: a rim, corner posts, wires on the long sides
  f.span(X.c_ss, -W / 2 + 0.03, 0.62, -D / 2 + 0.03, W / 2 - 0.03, 0.64, -D / 2 + 0.05);
  f.span(X.c_ss, -W / 2 + 0.03, 0.62, D / 2 - 0.05, W / 2 - 0.03, 0.64, D / 2 - 0.03);
  for (const u of [-1, 1]) f.span(X.c_ss, u * (W / 2 - 0.04) - 0.01, 0.62, -D / 2 + 0.03, u * (W / 2 - 0.04) + 0.01, 0.64, D / 2 - 0.03);
  for (let i = 0; i <= 6; i++) for (const v of [-D / 2 + 0.04, D / 2 - 0.04]) f.box(X.c_ss, -W / 2 + 0.04 + (i * (W - 0.08)) / 6, 0.41, v, 0.008, 0.42, 0.008);
  f.rod(X.c_ss, [-W / 2 - 0.08, 0.95, -0.2], [-W / 2 - 0.08, 0.95, 0.2], 0.014, 6);
  for (const v of [-0.2, 0.2]) f.rod(X.c_ss, [-W / 2 - 0.08, 0.95, v], [-W / 2, 0.62, v], 0.012, 6);
  for (let i = 0; i < 3; i++) {
    f.add(i === 1 ? X.c_bagOrange : X.c_bagYellow, capG(0.17, 0.18), -0.26 + i * 0.26, 0.4 + (i % 2) * 0.05, (rnd() - 0.5) * 0.1, [PI / 2, rnd() * 0.6, 0], [1, 1, 0.8]);
    f.box(M.white, -0.26 + i * 0.26, 0.55 + (i % 2) * 0.05, 0.0, 0.05, 0.015, 0.25); // the indicator tape
  }
  f.col(-W / 2 - 0.1, -D / 2, W / 2, D / 2, 0.95, SURF.metal);
}

/**
 * The cart-wash unit against the wall at (x, z): a steel cabinet on feet with the pump, a dosing canister of
 * disinfectant, the hose drum on top, the lance on its hook, a pressure gauge, the start / stop buttons.
 */
export function pressureWasher(c, x, z, face) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.steel, -0.3, 0.06, 0.03, 0.3, 0.9, 0.48, 0.02);
  for (const u of [-0.25, 0.25]) for (const v of [0.08, 0.43]) f.cyl(X.c_rubber, u, 0, v, 0.03, 0.03, 0.06, 8);
  for (let i = 0; i < 6; i++) f.box(M.dark, 0, 0.2 + i * 0.05, 0.483, 0.4, 0.015, 0.006);
  f.gauge(0.17, 0.75, 0.48, 0.09);
  f.add(M.green, cylC(0.025, 0.025, 0.03, 10), -0.18, 0.78, 0.49, [PI / 2, 0, 0]);
  f.add(M.red, cylC(0.025, 0.025, 0.03, 10), -0.1, 0.78, 0.49, [PI / 2, 0, 0]);
  f.box(U.ledA, -0.02, 0.79, 0.482, 0.02, 0.02, 0.01);
  f.label('CART WASH · 80 bar · 60 °C', 0, 0.62, 0.483, 0.44, 0.07, { bg: '#1b2127', fg: '#e8edf0', border: '#1b2127', font: 'bold 36px Arial' });
  // the hose drum on top, the dosing canister beside the cabinet
  for (const s of [-1, 1]) f.add(M.dark, cylC(0.2, 0.2, 0.02, 16), s * 0.12, 1.12, 0.25, [0, 0, PI / 2]);
  f.add(M.black, cylC(0.15, 0.15, 0.22, 14), 0, 1.12, 0.25, [0, 0, PI / 2]);
  f.span(M.dark, -0.2, 0.9, 0.2, 0.2, 0.95, 0.3);
  f.box(M.blue, 0.42, 0.25, 0.25, 0.22, 0.5, 0.18);
  f.cyl(M.white, 0.42, 0.5, 0.25, 0.04, 0.04, 0.04, 8);
  f.label('DISINFECTANT · 2 %', 0.42, 0.3, 0.341, 0.16, 0.06, { bg: '#ffffff', fg: '#1d4f7a', border: '#ffffff', font: 'bold 30px Arial' });
  // the lance hanging on its hook, the hose looping down to it
  f.box(M.dark, -0.42, 1.35, 0.03, 0.04, 0.08, 0.06);
  f.rod(M.yellow, [-0.42, 1.3, 0.06], [-0.4, 0.45, 0.08], 0.012, 6);
  f.box(M.dark, -0.42, 1.25, 0.08, 0.05, 0.14, 0.04);
  f.add(M.black, cached('pwHose', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 1.12, 0.4), V(-0.15, 0.6, 0.55), V(-0.35, 0.25, 0.4), V(-0.42, 0.9, 0.12), V(-0.42, 1.18, 0.09)]), 14, 0.012, 4)), 0, 0, 0);
  f.col(-0.3, 0, 0.53, 0.5, 1.3, SURF.metal);
}

/**
 * A shadow board on the wall at (x, z), centre height y: masonite panel, painted tool outlines, the tools on hooks
 * (`tools`: 'rake' 'poker' 'shovel' 'tongs' 'gloves' 'shield' 'wrench' 'pole' 'bar'); the `missing` ones show only
 * their outline.
 */
export function toolBoard(c, x, z, face, { y = 1.45, w = 1.6, tools = ['rake', 'poker', 'shovel', 'tongs', 'gloves', 'shield'], missing = [] } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.c_board, -w / 2, y - 0.55, 0, w / 2, y + 0.55, 0.018);
  f.span(M.steel, -w / 2 - 0.02, y + 0.55, 0, w / 2 + 0.02, y + 0.58, 0.03);
  const n = tools.length, du = (w - 0.2) / n;
  tools.forEach((t, i) => {
    const u = -w / 2 + 0.1 + du * (i + 0.5);
    const long = ['rake', 'poker', 'shovel', 'pole', 'bar'].includes(t);
    f.span(M.white, u - 0.025, y - (long ? 0.5 : 0.2), 0.0185, u + 0.025, y + 0.42, 0.019); // the outline paint
    f.box(M.dark, u, y + 0.45, 0.04, 0.015, 0.015, 0.05);
    if (missing.includes(i)) return;
    if (long) {
      f.box(t === 'pole' ? M.yellow : M.dark, u, y - 0.04, 0.035, 0.03, 0.9, 0.03);
      if (t === 'rake') f.box(M.dark, u, y - 0.5, 0.04, 0.22, 0.05, 0.02);
      if (t === 'shovel') f.box(M.steel, u, y - 0.48, 0.04, 0.18, 0.24, 0.01, 0.01);
      if (t === 'poker') f.box(M.dark, u + 0.04, y - 0.47, 0.04, 0.09, 0.025, 0.02);
      if (t === 'pole') f.add(M.dark, torG(0.08, 0.01, 3, 12), u, y - 0.56, 0.05);
      if (t === 'bar') f.box(M.red, u + 0.03, y - 0.46, 0.04, 0.08, 0.03, 0.02);
    } else if (t === 'tongs') {
      for (const s of [-1, 1]) f.rod(M.steel, [u, y + 0.4, 0.04], [u + s * 0.04, y - 0.15, 0.04], 0.01, 5);
    } else if (t === 'gloves') {
      for (const s of [-1, 1]) f.box(X.c_orange, u + s * 0.05, y + 0.12, 0.05, 0.1, 0.36, 0.04);
    } else if (t === 'shield') {
      f.box(M.dark, u, y + 0.32, 0.05, 0.22, 0.08, 0.06);
      f.box(M.green, u, y + 0.1, 0.07, 0.24, 0.3, 0.008, 0.004, [-0.2, 0, 0]);
    } else if (t === 'wrench') {
      f.box(M.steel, u, y + 0.05, 0.035, 0.035, 0.5, 0.012);
      f.add(M.steel, torG(0.035, 0.012, 3, 10, PI * 1.4), u, y + 0.32, 0.035);
    }
  });
}

/** a red fire-blanket tube and a CO₂ extinguisher on the wall at (x, z): the room's fire point */
function firePoint(c, x, z, face) {
  const f = new Frame(c, x, z, face);
  f.box(c.M.red, 0.42, 1.55, 0.05, 0.26, 0.32, 0.09, 0.02);
  f.box(c.M.white, 0.42, 1.43, 0.096, 0.06, 0.05, 0.004);
  f.label('FIRE BLANKET', 0.42, 1.6, 0.097, 0.22, 0.06, { bg: '#c0231d', fg: '#ffffff', border: '#c0231d', font: 'bold 36px Arial' });
  const p = f.p(0, 0, 0);
  P.extinguisher(c, p.x, p.z, f.face);
  f.label('FIRE POINT', 0.2, 2.0, 0.004, 0.62, 0.12, { bg: '#c0231d', fg: '#ffffff', border: '#c0231d', font: 'bold 52px Arial' });
}

/**
 * Waste & incineration (the dead end off cryo, its door in the north wall): the incinerator on the west wall with the
 * box-feed conveyor and the bin tipper along the south wall in front of its loading door; the ash pallet and its
 * hoist, the pathological cold store in the north-west corner; the autoclave bay south-east; receiving north-east
 * (the waiting carts, the platform scale, the weigh-in desk, the hazmat rack); the cart wash on the east wall.
 * Left mid-shift: a cart over and its bags split, a pallet knocked, a body bag dragged from the cold store.
 */
export function dressWaste(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  // the incinerator, its feed line and the tipper (the hero: straight ahead and right from the door)
  L.incinerator(c, x0, 20.35, 'e', { w: 3.0, d: 2.3, ceil: h, lit: true });
  L.conveyor(c, -31.45, 20.45, -27.9, 21.15, { h: 0.82, load: true });
  binTipper(c, -27.85, 20.8, 'e', { cart: false }); // (its cart lies on its side mid-room)
  c.K.box(M.hazard, -31.58, 0.001, 18.45, -31.4, 0.005, 20.2, { faces: ['py'] });
  c.label('HOT ZONE · NO STORAGE', -30.95, 0.006, 19.3, 'up', 1.0, 0.16, { bg: '#d6a31a', fg: '#16181a', border: '#16181a', font: 'bold 48px Arial', yaw: PI / 2 });
  c.K.add(X.c_bagYellow, capG(0.18, 0.22), -29.6, 0.16, 21.6, [PI / 2, 0.4, 0], [1, 1, 0.7]);
  c.decal('oil', -27.0, 20.7, 1.1, 0.6);
  // the ash pallet and the hoist lowering the last drum onto it, the ash bins by the burner side
  pallet(c, -32.9, 17.4, PI / 2, { load: 'drums', gap: 1 });
  L.hoist(c, -33.15, 15.3, -33.15, 19.1, 3.3, h, { t: 1.8 / 3.8, drop: 0.3, load: 'drum' });
  c.col(-33.45, 1.2, 16.8, -32.85, 2.08, 17.4, SURF.metal);
  const pf = new Frame(c, -33.15, 17.1, 0);
  pf.rod(M.black, [0.1, 3.1, 0], [0.45, 1.45, 0.3], 0.006, 4); // (the pendant, left hanging beside the drum)
  pf.box(M.yellow, 0.45, 1.38, 0.3, 0.08, 0.16, 0.06, 0.01);
  pf.box(M.red, 0.45, 1.42, 0.332, 0.03, 0.03, 0.01);
  ashBin(c, -31.3, 18.0, 0.3, { open: true });
  ashBin(c, -31.75, 17.05, 1.1);
  c.decal('footprints', -30.4, 17.6, 1.4, 2.3);
  c.decal('stain', -31.2, 18.6, 0.8, 0.4);
  // the pathological cold store, a body bag dragged out of it toward the door
  L.coldRoom(c, x0, z0, -31.4, 15.9, 'e', { door: 0.2, temp: '+4 °C', name: 'PATHOLOGICAL WASTE' });
  floorLine(c, -31.38, 14.32, -30.1, 14.32, 0.05);
  floorLine(c, -31.38, 15.48, -30.1, 15.48, 0.05);
  floorLine(c, -30.12, 14.3, -30.12, 15.5, 0.05);
  c.label('KEEP CLEAR', -30.75, 0.006, 14.9, 'up', 0.9, 0.2, { bg: '#2b2e31', fg: '#e6b81b', border: '#2b2e31', font: 'bold 56px Arial', yaw: PI / 2 });
  c.wallDecal('bloodSmear', -31.4, 1.15, 15.15, 'e', 0.5, 0.7);
  L.bodyBag(c, -29.9, 16.7, 1.2);
  c.decal('bloodDrag', -30.6, 15.9, 1.5, 0.7);
  c.decal('blood', -29.6, 16.9, 0.7, 2.0);
  // north wall west of the door: the shadow board (the poker missing), the clock, the switch
  toolBoard(c, -30.45, z0, 's', { w: 1.5, y: 1.45, missing: [1] });
  L.wallClock(c, -30.45, 2.75, z0, 's');
  L.lightSwitch(c, -29.62, z0, 's');
  c.label('CLINICAL WASTE · AUTHORISED STAFF ONLY', -26.75, 2.95, z0, 's', 2.2, 0.18, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 44px Arial' });
  // the poker, dropped where it was swung
  c.K.add(M.dark, cylC(0.015, 0.015, 1.3, 6), -28.9, 0.02, 18.9, [0, 0.5, PI / 2]);
  // the middle: the cart route painted from the door to the tipper, the cart that never got there (its bags split),
  // the pallet of cartons knocked over
  for (const x of [-28.05, -25.55]) floorLine(c, x, 14.95, x, 19.75, 0.08);
  L.wasteCart(c, -28.7, 17.3, 1.25, { kind: 'bio', tipped: true });
  c.decal('stain', -27.9, 17.9, 1.2, 1.1);
  pallet(c, -24.9, 17.9, 0.1, { load: 'boxes', toppled: true });
  L.drainGrate(c, -27.2, 19.4);
  L.drainGrate(c, -25.6, 20.4);
  // receiving (north-east): the waiting carts, the scale, the weigh-in desk, the hazmat rack
  L.wasteCart(c, -23.3, 14.0, 0, { kind: 'bio' });
  pallet(c, -21.75, 14.15, 0, { load: 'boxes' });
  platformScale(c, -23.0, 16.2, -PI / 2, { reading: 'P-0118  96.0 kg' });
  c.label('WEIGH ALL LOADS', -23.95, 0.006, 16.2, 'up', 0.9, 0.16, { bg: '#2b2e31', fg: '#e6b81b', border: '#2b2e31', font: 'bold 52px Arial', yaw: -PI / 2 });
  logDesk(c, x1, 16.2, 'w');
  L.hazmatRack(c, x1, 14.45, 'w', { len: 1.4, n: 2, empty: [1] });
  L.socket(c, x1, 1.25, 17.1, 'w');
  L.cctvCam(c, -20.8, 3.1, z0, 's', 0.7);
  sheets(c, -22.2, 17.4, 4, 0.45);
  // the cart wash on the east wall: the washer, the drain channel, a cart drying with its lid up, the shower
  pressureWasher(c, x1, 18.75, 'w');
  L.drainChannel(c, -21.75, 17.2, -21.75, 19.3, 0.2);
  L.wasteCart(c, -22.45, 18.2, PI / 2, { kind: 'general' });
  c.decal('puddle', -21.9, 18.4, 1.4, 0.3);
  L.eyewash(c, x1, 19.75, 'w');
  L.hazardPlacard(c, x1, 1.75, 19.75, 'w', 'eyewash', { w: 0.42 });
  c.label('CART WASH · DISINFECT AFTER EVERY EMPTYING', x1, 2.5, 18.2, 'w', 1.9, 0.16, { bg: '#1d4f7a', fg: '#ffffff', border: '#1d4f7a', font: 'bold 40px Arial' });
  // the autoclave bay (south-east), sharps drums in the corner
  L.autoclave(c, -23.6, z1, 'n', { size: 'bulk', len: 1.5, ceil: h, label: 'WASTE CYCLE · 134 °C · 45 min' });
  autoclaveBasket(c, -23.6, 19.6, 0.05);
  L.sharpsDrum(c, -22.2, 21.6);
  L.sharpsDrum(c, -21.6, 21.62, { lid: false });
  P.drum(c, -20.9, 21.5, { mat: M.yellow });
  notice(c, -22.8, 2.6, z1, 'n', ['AUTOCLAVE BAY', 'HEAT GLOVES & FACE SHIELD', 'NEVER OPEN UNDER PRESSURE'], { w: 0.7, h: 0.5, head: '#d6a31a' });
  roomTitle(c, 'WASTE TREATMENT · INCINERATION', -27.4, 3.2, z1, 'n', 3.0);
  // the south wall between the tipper and the autoclaves: the fire point, the hose reel, sockets
  firePoint(c, -26.3, z1, 'n');
  L.hoseReel(c, -25.0, 1.2, z1, 'n');
  L.socket(c, -24.6, 0.35, z1, 'n');
  L.wallVent(c, -29.6, 3.15, z1, 'n', 0.8, 0.3);
  L.warningBeacon(c, x0, 3.25, 21.2, 'e', { lit: true });
  L.hazardPlacard(c, x0, 2.95, 17.35, 'e', 'hot', { w: 0.6 });
  c.decal('footprints', -26.6, 15.2, 1.6, PI); // (out through the door)
}

// ---------------------------------------------------------------- the specimen hall
/**
 * The specimen store: a run of `bays` glass-door cold cabinets against the wall at (x, z) (the middle of the run),
 * fronts toward `face`: enamel carcasses, a lit back panel, three glass shelves of formalin jars (pale tissue in
 * some), handles, a read-out per bay, a cornice with the store's name. `open`: bays standing ajar; `smashed`: a bay
 * whose door is gone (its jars on the floor in front).
 */
export function specimenWall(c, x, z, face, { bays = 8, bw = 0.9, h = 2.15, d = 0.66, open = [], smashed = [], name = 'SPECIMEN STORE  ·  +4 °C  ·  FIXED TISSUE' } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const len = bays * bw;
  f.span(M.dark, -len / 2, 0, 0.02, len / 2, 0.12, d - 0.03);
  f.span(X.c_enamel, -len / 2, h - 0.04, 0, len / 2, h + 0.28, d + 0.02);
  f.label(name, 0, h + 0.12, d + 0.021, Math.min(len - 0.4, 4.2), 0.17, { bg: '#e7ebe8', fg: '#1d4f7a', border: '#e7ebe8', font: 'bold 52px Arial' });
  const jar = cylG(0.055, 0.055, 0.17, 6, true), lid = cached('jarLid', () => new THREE.CircleGeometry(0.058, 6).rotateX(-PI / 2)), blob = cached('jarBlob', () => new THREE.SphereGeometry(0.035, 5, 3));
  for (let b = 0; b < bays; b++) {
    const u0 = -len / 2 + b * bw, uc = u0 + bw / 2;
    for (const s of [0, 1]) f.span(X.c_enamel, u0 + s * (bw - 0.04), 0.12, 0, u0 + s * (bw - 0.04) + 0.04, h - 0.04, d);
    f.span(G.c_fridge, u0 + 0.04, 0.16, 0.01, u0 + bw - 0.04, h - 0.08, 0.02);
    const broken = smashed.includes(b);
    for (let k = 0; k < 3; k++) {
      const y = 0.45 + k * 0.52;
      f.span(U.glass, u0 + 0.05, y - 0.012, 0.03, u0 + bw - 0.05, y, d - 0.08);
      for (let j = 0; j < 3; j++) {
        if (broken && rnd() < 0.6) continue;
        const ju = u0 + 0.2 + j * 0.25 + (rnd() - 0.5) * 0.04, jv = 0.2 + rnd() * 0.25;
        f.add(rnd() < 0.15 ? G.c_jar : X.c_formalin, jar, ju, y, jv);
        f.add(M.white, lid, ju, y + 0.175, jv);
        if (rnd() < 0.4) f.add(X.c_tissue, blob, ju, y + 0.07, jv, null, [1, 1.4, 0.9]);
      }
    }
    // the door: a steel frame round the glass, its handle; ajar ones swung out, smashed ones gone
    if (broken) {
      const p = f.p(uc, 0, d + 0.6);
      c.decal('glass', p.x, p.z, 1.2, rnd() * 3);
      c.decal('puddle', p.x, p.z, 1.3, rnd() * 3);
      for (let i = 0; i < 4; i++) {
        const q = f.p(uc + (rnd() - 0.5) * 0.9, 0, d + 0.3 + rnd() * 0.8);
        c.K.add(X.c_formalin, jar, q.x, 0.055, q.z, [PI / 2, rnd() * 3, 0]);
        if (i < 2) c.K.add(X.c_tissue, blob, q.x + 0.1, 0.03, q.z, null, [1.4, 0.8, 1.2]);
      }
    } else {
      const a = open.includes(b) ? 1.1 + rnd() * 0.5 : 0;
      const g = cached('swDoor' + k3(bw, h), () => {
        const parts = [];
        for (const [w0, h0, x0, y0] of [[bw - 0.04, 0.04, (bw - 0.04) / 2, 0.14], [bw - 0.04, 0.04, (bw - 0.04) / 2, h - 0.06], [0.04, h - 0.2, 0.02, h / 2 + 0.04], [0.04, h - 0.2, bw - 0.06, h / 2 + 0.04]]) parts.push(new THREE.BoxGeometry(w0, h0, 0.03).translate(x0, y0, 0));
        return parts;
      });
      const hu = u0 + 0.02;
      for (const pg of g) f.add(M.steel, pg, hu, 0, d + 0.015, [0, -a, 0]);
      f.add(U.glass, cached('swGlass' + k3(bw, h), () => new THREE.BoxGeometry(bw - 0.12, h - 0.26, 0.008).translate((bw - 0.04) / 2, h / 2 + 0.04, 0)), hu, 0, d + 0.015, [0, -a, 0]);
      const hp = f.p(hu + Math.cos(a) * (bw - 0.12), 0, d + 0.05 + Math.sin(a) * (bw - 0.12));
      c.K.add(X.c_ss, cylG(0.012, 0.012, 0.5, 6), hp.x, 0.9, hp.z);
    }
    f.box(M.black, uc, h - 0.18, d + 0.035, 0.16, 0.06, 0.02);
    f.box(b % 4 === 3 ? U.ledR : U.ledG, uc + 0.11, h - 0.18, d + 0.035, 0.015, 0.015, 0.02);
    f.label(broken ? '+19.6' : (3 + rnd()).toFixed(1), uc, h - 0.18, d + 0.046, 0.14, 0.05, { bg: '#08121a', fg: broken ? '#ff5040' : '#5ee0ff', border: '#08121a', font: 'bold 44px monospace' });
  }
  f.light(0, h - 0.4, d + 0.3, 0.45, Math.max(2.5, len * 0.45), [0.85, 0.95, 1.0], null, len * 0.7);
  f.col(-len / 2, 0, len / 2, d + 0.05, h + 0.28, SURF.metal);
}

/**
 * A two-tier steel rack of animal cages against the wall at (x, z), fronts toward `face`: hiveLabs' wire cages on the
 * top tier (the `broken` one forced from inside, its door bent out), plastic transport kennels with vent slots below,
 * tags, a feed bin, a hose tap.
 */
export function cageRack(c, x, z, face, { len = 2.0, broken = 0, tags = ['K7-14', 'K7-15'] } = {}) {
  const { M } = c;
  const f = new Frame(c, x, z, face);
  const D = 0.7, y1 = 0.78;
  for (const u of [-len / 2 + 0.02, len / 2 - 0.02]) for (const v of [0.04, D - 0.03]) f.box(M.steel, u, 0.85, v, 0.04, 1.7, 0.04);
  for (const y of [0.1, y1]) f.span(M.steel, -len / 2, y - 0.03, 0.02, len / 2, y, D);
  f.span(M.steel, -len / 2, 1.68, 0.02, len / 2, 1.7, D);
  const n = Math.max(1, Math.floor(len / 0.95));
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.5)) / n;
    const p = f.p(u, 0, D / 2);
    L.cage(c, p.x, p.z, f.yaw, { w: 0.86, d: 0.6, h: 0.7, y: y1, broken: i === broken, open: false, tag: tags[i] ?? null, col: false });
    // the kennel below: a rounded shell, a dark grille door, vent slots
    f.box(M.white, u, 0.36, D / 2, 0.8, 0.5, 0.58, 0.04);
    f.box(M.dark, u, 0.35, D / 2 + 0.292, 0.36, 0.34, 0.01);
    for (let k = 0; k < 3; k++) f.box(M.black, u - 0.3, 0.45 - k * 0.06, D / 2 + 0.292, 0.12, 0.02, 0.006);
    f.label(i === broken ? 'EMPTY' : 'RHESUS · NO CONTACT', u + 0.28, 0.48, D / 2 + 0.291, 0.18, 0.07, { bg: '#f7f5ec', fg: '#1d2b3a', border: '#b3141a', font: 'bold 28px Arial' });
  }
  if (broken >= 0) {
    const p = f.p(-len / 2 + (len * (broken + 0.5)) / n, 0, D + 0.4);
    c.decal('blood', p.x, p.z, 0.6, 1.0);
  }
  f.label('PRIMATE HOLDING · GLOVES & VISOR', 0, 1.82, 0.004, 1.2, 0.12, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 40px Arial' });
  f.col(-len / 2, 0, len / 2, D, 1.7, SURF.metal);
}

/**
 * A vat's fittings toward its front at angle `a` (radians from +z) for P.vat(x, z, R): a sight-glass tube showing
 * the culture's level, a bottom outlet with its handwheel valve and a pipe down into the floor, a sample port, a
 * pressure gauge, the name plate.
 */
export function vatKit(c, x, z, R, name, { a = 0, level = 0.6, h = 5.2 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x + Math.sin(a) * R, z + Math.cos(a) * R, a);
  // the sight glass: two elbows off the shell, a glass tube between them, the culture in it
  const top = 1.0 + (h - 2.2) * 0.85;
  for (const y of [1.1, top]) f.hcyl(M.steel, 0.25, y, 0.08, 0.025, 0.16, 6, 'v');
  f.cyl(U.glass, 0.25, 1.1, 0.16, 0.03, 0.03, top - 1.1, 6, true);
  f.cyl(U.murk, 0.25, 1.1, 0.16, 0.02, 0.02, (top - 1.1) * level, 5);
  // the bottom outlet, the valve with its wheel, the pipe down to the floor drain
  f.hcyl(X.c_ss, 0, 0.72, 0.02, 0.05, 0.64, 8, 'v'); // (reaching back to the tapered bottom)
  f.box(M.dark, 0, 0.72, 0.34, 0.14, 0.14, 0.1);
  f.add(M.red, torG(0.1, 0.012, 3, 10), 0, 0.88, 0.34, [PI / 2, 0, 0]);
  f.cyl(M.dark, 0, 0.72, 0.34, 0.012, 0.012, 0.16, 6);
  f.hcyl(X.c_ss, 0, 0.72, 0.52, 0.045, 0.3, 8, 'v');
  f.box(X.c_ss, 0, 0.67, 0.7, 0.1, 0.1, 0.12); // (the elbow)
  f.cyl(X.c_ss, 0, 0.0, 0.7, 0.045, 0.045, 0.62, 8);
  // the sample port and the gauge on a stub, the name plate
  f.hcyl(M.steel, -0.3, 1.4, 0.08, 0.018, 0.16, 6, 'v');
  f.box(M.yellow, -0.3, 1.4, 0.17, 0.05, 0.05, 0.03);
  f.hcyl(M.steel, -0.2, 1.75, 0.06, 0.015, 0.12, 6, 'v');
  f.gauge(-0.2, 1.75, 0.12, 0.12);
  f.span(X.c_ss, -0.32, 2.05, 0.045, 0.32, 2.3, 0.065);
  f.label(name, 0, 2.175, 0.066, 0.6, 0.22, { bg: '#c3c8cb', fg: '#16181a', border: '#16181a', font: 'bold 36px Arial', lines: name.split('|') });
}

/**
 * The prep bench over the rect (the gold weapon's bench: top 0.92): stainless top with a raised edge, a square-leg
 * frame with an undershelf, a drain sink at one end with its tap, instrument trays and a dissecting board; nothing
 * on the top over `keep` (the pickup floats there).
 */
export function prepBench(c, [x0, z0, x1, z1], { keep = null } = {}) {
  const { M, X, rnd } = c;
  const T = 0.92;
  c.K.box(X.c_ss, x0, T - 0.04, z0, x1, T, z1);
  for (const [a0, b0, a1, b1] of [[x0, z0, x1, z0 + 0.025], [x0, z1 - 0.025, x1, z1], [x0, z0, x0 + 0.025, z1], [x1 - 0.025, z0, x1, z1]]) c.K.box(X.c_ss, a0, T, b0, a1, T + 0.025, b1);
  const n = Math.max(2, Math.round((x1 - x0) / 1.6) + 1);
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.06 + (i * (x1 - x0 - 0.12)) / (n - 1);
    for (const z of [z0 + 0.06, z1 - 0.06]) {
      c.K.box(M.steel, x - 0.025, 0.03, z - 0.025, x + 0.025, T - 0.04, z + 0.025);
      c.K.cyl(X.c_rubber, x, 0, z, 0.03, 0.03, 0.03, 6);
    }
  }
  c.K.box(X.c_ss, x0 + 0.05, 0.22, z0 + 0.05, x1 - 0.05, 0.24, z1 - 0.05);
  for (let i = 0; i < 3; i++) c.K.cube(pick(c, [M.white, X.c_binBox, M.blue]), x0 + 0.5 + i * 0.5, 0.36, (z0 + z1) / 2, 0.36, 0.22, 0.3, (rnd() - 0.5) * 0.2);
  // the sink at the west end, its gooseneck tap, the drain hose under it
  c.K.box(M.dark, x0 + 0.12, T - 0.03, z0 + 0.15, x0 + 0.62, T - 0.005, z1 - 0.15);
  c.K.cyl(X.c_ss, x0 + 0.37, T, z0 + 0.06, 0.015, 0.015, 0.35, 6);
  c.K.add(X.c_ss, torG(0.08, 0.012, 4, 8, PI), x0 + 0.37, T + 0.35, z0 + 0.14, [0, PI / 2, 0]);
  c.K.cyl(M.dark, x0 + 0.37, 0.24, (z0 + z1) / 2, 0.025, 0.025, T - 0.27, 6);
  // instruments: a tray of tools, a dissecting board with a covered specimen, a jar, a clipboard (kept off `keep`)
  const free = (xa, xb) => !keep || xb < keep[0] || xa > keep[2];
  if (free(x0 + 0.8, x0 + 1.25)) {
    c.K.box(X.c_ss, x0 + 0.8, T, z0 + 0.15, x0 + 1.25, T + 0.025, z0 + 0.45);
    for (let i = 0; i < 5; i++) c.K.cube(M.steel, x0 + 0.88 + i * 0.07, T + 0.03, z0 + 0.3, 0.012, 0.006, 0.18, (rnd() - 0.5) * 0.2);
  }
  if (free(x1 - 1.4, x1 - 0.7)) {
    c.K.box(M.white, x1 - 1.4, T, z0 + 0.12, x1 - 0.7, T + 0.02, z1 - 0.12);
    c.K.add(M.green, rbox(0.5, 0.08, 0.36, 0.03), x1 - 1.05, T + 0.06, (z0 + z1) / 2);
    c.K.add(X.c_formalin, cylG(0.06, 0.06, 0.16, 8), x1 - 0.5, T, z0 + 0.25);
    c.K.cyl(M.white, x1 - 0.5, T + 0.16, z0 + 0.25, 0.063, 0.063, 0.025, 8);
    c.K.cube(X.c_board, x1 - 0.35, T + 0.006, z1 - 0.3, 0.23, 0.01, 0.32, 0.3);
    c.K.cube(X.c_paper, x1 - 0.35, T + 0.012, z1 - 0.3, 0.2, 0.002, 0.27, 0.3);
  }
  c.col(x0, 0, z0, x1, T, z1, SURF.metal);
}

/** tools dropped on the floor round (x, z): a wrench, a crowbar, a torch still on, a scalpel tray spilled, safety glasses */
export function droppedTools(c, x, z, { torch = true } = {}) {
  const { M, X, rnd } = c;
  const r = () => (rnd() - 0.5) * 1.2;
  c.K.add(M.steel, rbox(0.04, 0.012, 0.35), x + r(), 0.008, z + r(), [0, rnd() * 3, 0]);
  const a = rnd() * 3;
  c.K.add(M.red, cylC(0.014, 0.014, 0.75, 6), x + r(), 0.015, z + r(), [0, a, PI / 2]);
  const tx = x + r(), tz = z + r();
  c.K.box(X.c_ss, tx - 0.15, 0.002, tz - 0.1, tx + 0.15, 0.014, tz + 0.1);
  for (let i = 0; i < 4; i++) c.K.cube(M.steel, tx + r() * 0.6, 0.004, tz + r() * 0.6, 0.012, 0.004, 0.15, rnd() * 3);
  c.K.add(M.black, rbox(0.14, 0.03, 0.05), x + r(), 0.025, z + r(), [0, rnd() * 3, 0.3]);
  if (torch) {
    const px = x + r(), pz = z + r(), ay = rnd() * PI * 2;
    c.K.add(M.dark, cylC(0.022, 0.022, 0.2, 8), px, 0.022, pz, [0, ay, PI / 2, 'YXZ']);
    c.K.add(c.U.panel, cylC(0.026, 0.026, 0.006, 8), px + Math.cos(ay) * 0.1, 0.026, pz - Math.sin(ay) * 0.1, [0, ay, PI / 2, 'YXZ']);
  }
}

/**
 * The specimen hall (two storeys; the four tubes are hive.js's): the culture vats along the north wall with their
 * sight glasses and valves, a gantry behind them at 4.4 m with bridges onto the domes and a caged ladder; the
 * prep bench (the gold weapon's) and the monitoring console facing the tubes; the specimen store glowing behind the
 * tubes; primate cages and a jar shelf on the west wall; gurneys by the east doors; a hoist rail over the tube row
 * with a body bag still on the hook. The breach: S-02 smashed, the store's glass broken behind it, claw marks, a
 * gurney over, tools dropped, a blood trail out of the east door.
 */
export function dressSpecimen(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  // the vats (kept where the old hall had them) and their fittings, a grate under each outlet
  const vats = [[-15.2, 'VAT A|K-7 MEDIUM|2 400 L', 0.72], [-11.2, 'VAT B|K-7 MEDIUM|2 400 L', 0.35], [-7.2, 'VAT C|GROWTH SERUM|2 400 L', 0.86]];
  for (const [x, name, level] of vats) {
    P.vat(c, x, -28.2, 1.2, h);
    vatKit(c, x, -28.2, 1.2, name, { level });
    L.drainGrate(c, x, -26.3, 0.36, 0.36);
  }
  // the gantry behind them: the catwalk along the north wall, a short wing on the west wall, the ladder, bridges
  L.catwalk(c, x0, z0, x1, z0 + 1.0, 4.4, 'n');
  L.catwalk(c, x0, z0 + 1.0, x0 + 1.0, z0 + 2.0, 4.4, 'w', { rail: false });
  L.ladder(c, x0, z0 + 2.4, 'e', 4.4, { cageFrom: 3.0 });
  for (const [x] of vats) {
    c.K.box(X.grate, x - 0.35, 4.37, z0 + 1.0, x + 0.35, 4.4, -29.42);
    for (const sx of [-0.35, 0.35]) {
      // (a handrail out over the dome, its end post down onto the shell)
      c.K.rod(M.yellow, V(x + sx, 4.4, z0 + 1.0), V(x + sx, 5.25, z0 + 1.0), 0.02, 6);
      c.K.rod(M.yellow, V(x + sx, 5.25, z0 + 1.0), V(x + sx, 5.25, -29.2), 0.02, 6);
      c.K.rod(M.yellow, V(x + sx, 5.25, -29.2), V(x + sx, 4.92, -29.2), 0.02, 6);
    }
  }
  P.pipeRun(c, x0 + 0.3, z0 + 0.4, x1 - 0.3, z0 + 0.4, h - 0.4, 4, 0);
  L.hazardPlacard(c, x0, 5.0, -29.5, 'e', 'bio', { w: 0.6 });
  // the prep bench (the pickup floats over its middle: nothing on the top there) and the monitoring console
  prepBench(c, [-15.5, -23.4, -10.5, -22.6], { keep: [-13.7, -23.4, -12.3, -22.6] });
  L.controlDesk(c, -7.3, -23.4, 's', 2.4, { channels: ['S-01', 'S-02', 'S-03', 'S-04', 'VAT A', 'VAT B', 'VAT C'], bad: ['S-02'], chairs: 2 });
  // the specimen store behind the tubes (the bay behind S-02 smashed), the tubes' plaques, the hall's name
  specimenWall(c, -11.0, z1, 'n', { bays: 7, open: [1], smashed: [5] }); // (bay 5 behind S-02, bay 1 ajar)
  const plaque = [['S-01 · HOST K7-09 · STABLE', '#1d4f7a'], ['S-02 · BREACH · 03:12 · CONTAINMENT LOST', '#b3141a'], ['S-03 · HOST K7-11 · STABLE', '#1d4f7a'], ['S-04 · HOST K7-12 · SEDATED', '#1d4f7a']];
  [-15.5, -12.5, -9.5, -6.5].forEach((x, i) => c.label(plaque[i][0], x, 2.75, z1, 'n', 1.5, 0.16, { bg: '#e8edf0', fg: plaque[i][1], border: plaque[i][1], font: 'bold 38px Arial' }));
  roomTitle(c, 'SPECIMEN HALL · SUBLEVEL 4 · BSL-4', -11.0, 3.45, z1, 'n', 3.6, '#c63a2e');
  L.clawMarks(c, -11.75, 1.5, z1 - 0.72, 'n', { n: 4, len: 0.8, a: 0.4 }); // (on the next bay's glass)
  // the west wall: the primate cages south of the blast door, the jar shelf, the hose reel and bins in the corner
  cageRack(c, x0, -21.6, 'e', { len: 1.1, broken: 0, tags: ['K7-14'] });
  P.cabinet(c, [x0, -19.6, x0 + 0.6, -18.1], 'e', { h: 1.9, mat: X.c_enamel, drawers: 8 });
  P.cabinet(c, [x0, -18.0, x0 + 0.6, -16.8], 'e', { h: 1.9, mat: M.grey, drawers: 3 });
  c.label('TISSUE BLOCKS · K-7 SERIES · LOG EVERY DRAWER', x0, 2.1, -18.3, 'e', 1.6, 0.13, { bg: '#1b2127', fg: '#e8edf0', border: '#1d4f7a', font: 'bold 36px Arial' });
  L.wasteBin(c, -17.55, -14.45, { kind: 'bio' });
  L.floodLight(c, x0, 4.6, -20.0, 'e', { i: 0.55, r: 3.0, tilt: 0.75 });
  L.hazardPlacard(c, x0, 2.9, -21.6, 'e', 'bsl3', { w: 0.7 });
  // the east wall between its doors: a gurney with a bag, the status screen, the clock, the floodlight
  P.gurney(c, -3.4, -23.0, 0, { bag: true });
  Fac.tvOnWall(c, x1, 2.55, -23.0, 'w', { w: 1.3, lines: ['CONTAINMENT · SUBLEVEL 4', 'S-01  OK    S-03  OK', 'S-02  ██ BREACH ██', 'S-04  SEDATED', 'LOCKDOWN: MANUAL'], bg: '#3a0b0b', fg: '#ffd7d0' });
  L.wallClock(c, x1, 3.45, -23.0, 'w');
  L.floodLight(c, x1, 4.6, -23.0, 'w', { i: 0.55, r: 3.0, tilt: 0.7 });
  L.socket(c, x1, 0.35, -22.2, 'w');
  L.lightSwitch(c, x1, -15.35, 'w');
  P.extinguisher(c, x1, -29.8, 'w');
  L.firstAidBox(c, -3.2, 1.5, z1, 'n');
  L.cctvCam(c, x1, 4.3, -14.6, 'w', -0.6);
  // the hoist rail over the tube row (clear of their feed pipes), a body bag left on the hook over S-02
  L.hoist(c, -17.0, -19.4, -4.0, -19.4, 5.4, h, { t: 5.2 / 13, drop: 0.9, load: 'bag' });
  // the breach: a gurney over, tools, the drain, slime and blood out through the east door
  P.gurney(c, -10.3, -20.4, 0.9, { tipped: true });
  droppedTools(c, -11.4, -20.6);
  L.drainGrate(c, -12.4, -19.7, 0.4, 0.4);
  c.decal('slime', -12.4, -19.4, 2.0, 0.3);
  c.decal('glass', -12.2, -19.0, 1.4, 1.2);
  for (const [x, z, r] of [[-9.6, -19.9, 0.1], [-7.4, -19.7, -0.1], [-5.3, -19.2, -0.3], [-3.6, -18.6, -0.4]]) c.decal('bloodDrag', x, z, 1.8, PI / 2 + r);
  c.decal('blood', -12.0, -20.6, 0.9, 0.4);
  c.decal('footprints', -6.0, -20.6, 1.5, PI / 2);
  L.clawMarks(c, x1, 1.35, -21.85, 'w', { n: 3, len: 0.6, a: -0.3 });
  sheets(c, -13.2, -21.6, 5, 0.6);
  L.bodyBag(c, -16.4, -24.9, 1.4);
  c.decal('blood', -16.2, -24.6, 0.8, 2.2);
}

// ---------------------------------------------------------------- the squad's corner of Nadja's lab
/** a hard rifle case on the floor at (x, z) turned yaw: black shell, latches, handle; `open`: the lid up, foam and the cut-out empty */
export function rifleCase(c, x, z, yaw = 0, { open = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  const W = 1.22, D = 0.4;
  f.box(X.c_caseBlack, 0, 0.065, 0, W, 0.13, D, 0.025);
  if (open) {
    f.span(X.c_foam, -W / 2 + 0.04, 0.12, -D / 2 + 0.04, W / 2 - 0.04, 0.131, D / 2 - 0.04);
    f.span(M.black, -0.45, 0.1305, -0.06, 0.4, 0.1315, 0.05); // the empty cut-out
    f.span(M.black, -0.1, 0.1305, 0.05, 0.02, 0.1315, 0.12);
    f.add(X.c_caseBlack, rbox(W, 0.1, D, 0.025).clone().translate(0, 0.05, D / 2), 0, 0.13, -D / 2, [-1.75, 0, 0]);
  } else {
    f.box(X.c_caseBlack, 0, 0.18, 0, W, 0.1, D, 0.025);
    for (const u of [-0.4, 0, 0.4]) f.box(M.dark, u, 0.13, D / 2 + 0.008, 0.06, 0.05, 0.02);
    f.box(M.dark, 0, 0.2, D / 2 + 0.03, 0.2, 0.03, 0.04);
  }
  f.col(-W / 2, -D / 2, W / 2, D / 2, open ? 0.2 : 0.24, SURF.metal);
}

/** an olive ammo can at (x, y, z) turned yaw: body, the clamped lid, its handle, stencil */
export function ammoCan(c, x, y, z, yaw = 0, { big = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  const W = big ? 0.43 : 0.3, H = big ? 0.24 : 0.19, D = 0.16;
  f.box(X.c_olive, 0, H / 2, 0, W, H, D, 0.008);
  f.box(X.c_olive, 0, H + 0.012, 0, W + 0.01, 0.025, D + 0.012);
  f.box(M.dark, 0, H + 0.03, 0, 0.12, 0.012, 0.025);
  f.box(M.dark, W / 2 + 0.005, H - 0.03, 0, 0.012, 0.06, 0.05);
  f.label(big ? '7.62 MM · 400' : '5.56 MM · 840', 0, H * 0.5, D / 2 + 0.002, W * 0.8, 0.05, { bg: '#4d5435', fg: '#e6dfb0', border: '#4d5435', font: 'bold 36px Arial' });
}

/** a clamp work lamp at (x, y, z) on an edge facing `face`, its warm glow (`light`: a baked light as well) */
export function clampLamp(c, x, y, z, face, { light = true } = {}) {
  const { M, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.dark, 0, y - 0.02, 0.0, 0.05, 0.08, 0.06);
  f.rod(M.dark, [0, y + 0.02, 0], [0, y + 0.32, 0.08], 0.008, 5);
  // the shade: narrow at the pivot, its mouth forward and down (axis 0, -0.33, 0.94), the lit disc in the mouth
  f.add(M.dark, cylG(0.03, 0.07, 0.1, 10, true), 0, y + 0.32, 0.08, [1.9, 0, 0]);
  f.add(G.c_warm, cached('lampDisc', () => new THREE.CircleGeometry(0.064, 10)), 0, y + 0.288, 0.172, [0.336, 0, 0]);
  if (light) f.light(0, y + 0.15, 0.35, 0.4, 1.8, [1.0, 0.82, 0.55], null, 3.2);
}

/** a sample transport carrier at (x, y, z) turned yaw: a white cool box, the blue lid, a biohazard label, a seal tag */
export function sampleCarrier(c, x, y, z, yaw = 0) {
  const { M } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(M.white, 0, 0.13, 0, 0.42, 0.26, 0.3, 0.02);
  f.box(M.blue, 0, 0.275, 0, 0.44, 0.04, 0.32, 0.015);
  f.box(M.dark, 0, 0.31, 0, 0.18, 0.025, 0.04);
  f.plane(M.signs, 0.12, 0.12, -0.1, 0.14, 0.151, SIGN.bio);
  f.label('UN3373 · CAT B', 0.08, 0.14, 0.151, 0.16, 0.05, { bg: '#ffffff', fg: '#16181a', border: '#16181a', font: 'bold 30px Arial' });
  f.box(M.red, 0.22, 0.26, 0.05, 0.01, 0.06, 0.02);
}

/**
 * Nadja's lab outside her clean room (the safe zone: the squad waits here between rounds). Clean and lived in: the
 * monitoring bench under the gel display and the briefing table by the armory door, the plan on the whiteboard; the
 * fridge, the −80, coffee and water on the north wall; the wet bench down the east wall; two cots, a footlocker and
 * a small med corner between the west tube and the booth. The middle (x −6…4, z 16…22) stays empty for the squad.
 */
export function dressNadjaHall(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1 } = s;
  // north-west: the monitoring bench, the gel display over it, the armory-side switch
  L.computerBench(c, -8.5, z0, 's', 3.4, { stations: 2, monitors: [2, 2], chairs: true });
  L.dnaGelDisplay(c, -8.5, 2.6, z0, 's', { w: 2.4, h: 1.2 });
  L.socket(c, -10.6, 1.0, z0, 's');
  L.lightSwitch(c, x0, 20.62, 'e');
  L.lightSwitch(c, -3.12, z0, 's');
  L.wallClock(c, 0, 3.15, z0, 's');
  // the briefing table (the complex lit on its top), the open rifle case, ammo, a sample carrier
  L.briefingTable(c, -8.6, 20.5, 2.4, 1.2, { spaces: Object.values(ctx.S), here: 'nadja' });
  ammoCan(c, -9.45, 0.95, 20.25, 0.25);
  ammoCan(c, -9.1, 0.95, 20.85, -0.1, { big: true });
  sampleCarrier(c, -7.85, 0.95, 20.7, -0.35);
  rifleCase(c, -8.5, 21.7, 0.05, { open: true });
  // the west wall: the plan, the rota, the gas bottles in the corner
  L.whiteboardFormula(c, x0, 22.3, 'e', {
    w: 2.4, y: 1.55, h: 1.05, title: 'THE PLAN · SUBLEVEL 4',
    lines: ['R1-3  hold labs + offices, blast doors shut', 'R4  NORTH WING opens → specimen hall', '      gold weapon on the prep bench (!)', 'R10  the RING: security, maint, morgue', 'K-7 samples → Nadja ONLY. Do not open.'],
    note: 'MEDS: 2 LEFT · ASK BEFORE TAKING',
  });
  L.noticeBoard(c, x0, 1.6, 25.6, 'e', { w: 1.0, h: 0.7, notes: ['WATCH ROTA · 2 ON', 'NO FOOD IN THE LAB — N.'] });
  P.gasCylinder(c, -11.65, 26.55, M.blue);
  P.gasCylinder(c, -11.2, 26.65, M.green);
  c.K.box(M.dark, -11.85, 1.15, z1 - 0.06, -10.95, 1.2, z1); // (their chain bracket)
  // north-east: the sample fridge, the −80, coffee, the water cooler
  L.labFridge(c, 3.65, z0, 's', { glow: true, stock: 'samples', display: '+4 °C' });
  L.freezerUpright(c, 4.55, z0, 's', { note: ['K-7 REFERENCE', 'N. KOVAC ONLY'] });
  L.coffeeStation(c, 5.95, z0, 's', 1.5);
  L.waterCooler(c, 7.55, z0, 's');
  // the east wall: the wet bench with its sink, the lamp the squad clamped on, a stool, the status screen
  L.wallBench(c, x1, 18.75, 'w', 4.6, { sink: 1.6, shelf: false, gear: 2 });
  L.centrifuge(c, 7.62, 0.92, 17.0, -PI / 2);
  L.benchKit(c, 7.58, 0.92, 17.85, -PI / 2, 'laptop');
  sampleCarrier(c, 7.6, 0.92, 18.75, -PI / 2);
  Fac.mug(c, 7.45, 0.92, 19.3, null, 0.4);
  clampLamp(c, 7.3, 0.92, 18.3, 'w');
  L.labStool(c, 6.75, 17.6, { yaw: 0.6 });
  Fac.rug(c, 6.75, 18.75, 0.8, 3.0, { mat: X.c_rubber });
  Fac.tvOnWall(c, x1, 2.35, 18.75, 'w', { w: 1.1, lines: ['SUBLEVEL 4 · AIR OK', 'NORTH WING  SEALED', 'THE RING  SEALED', 'POWER  GRID B', 'CLEAN ROOM  +12 Pa'], bg: '#0b2a2a', fg: '#c8fff0' });
  for (const z of [16.9, 20.6]) L.socket(c, x1, 1.12, z, 'w');
  L.eyewash(c, x1, 22.55, 'w');
  L.wasteBin(c, 7.65, 21.45, { kind: 'bio' });
  // the south-east corner beside the east tube: a supply crate, a dewar
  P.crates(c, 4.3, 26.5, 0.7, 1, { wood: true });
  P.dewar(c, 7.55, 26.55, 0.26);
  // the south-west: two cots, a footlocker, the kit, a guitar; the med corner against the booth
  L.cot(c, -7.35, 25.95, 0, { made: false, stuff: true });
  L.cot(c, -5.95, 25.95, 0.04, { made: true, stuff: false });
  L.footLocker(c, -7.35, 24.5, 0, { name: 'KOWALSKI' });
  Fac.duffelBag(c, -5.85, 24.55, 0.3, X.c_olive);
  ammoCan(c, -6.65, 0, 26.55, PI / 2, { big: true });
  Fac.mug(c, -6.62, 0.265, 26.5, M.white, 1.2);
  Fac.guitar(c, -6.65, z1 - 0.09, 'n'); // (its headstock leans back to the wall)
  rifleCase(c, -4.65, 26.62, 0.03);
  L.vitalsMonitor(c, -4.75, 25.3, { yaw: -2.2, on: true });
  L.ivStand(c, -5.05, 24.3, { bags: 1 });
  L.firstAidBox(c, -4.9, 1.6, z1, 'n');
  L.sharpsBox(c, -4.25, 1.3, z1, 'n');
  sheets(c, -6.6, 24.0, 2, 0.3);
}
