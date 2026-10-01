// The Hive's office wing and its corridors (world/hive.js): the two open-plan offices, the conference room, the
// director's office behind it, and the wall fittings of the six corridors. Built like hiveProps.js / hiveFacility.js:
// world-space geometry for the Kit (one mesh per material, baked light) and a collider for whatever you'd bump into.
//
// c: hiveProps.js's context plus X (EXTRA_MATS of this module and of hiveFacility.js / hiveLabs.js, baked), G (their
//    EXTRA_GLOW, emissive), label(text, x, y, z, face, w, h, opts), decal(kind, x, z, size, rot), wallDecal(kind, x,
//    y, z, face, w, h), screen(x, y, z, yaw, w, h, on), dyn, updates.
// Floor props take the centre of their footprint (x, z) and the `face` their front looks toward ('n' -z, 's' +z,
// 'w' -x, 'e' +x); wall props take the point on the wall line (the room rect's edge) and the face into the room.
// Rects are [x0, z0, x1, z1]. Nothing here is random but c.rnd().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import * as P from './hiveProps.js';
import * as Fac from './hiveFacility.js';
import * as L from './hiveLabs.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const FY = P.FACE_YAW;
const WARM = [1.0, 0.82, 0.58];

/** baked materials this module adds (hive.js builds them as c.X.<name>) */
export const EXTRA_MATS = {
  d_walnut: { color: 0x5a3a25, roughness: 0.42 },
  d_oak: { color: 0xa47c53, roughness: 0.55 },
  d_ash: { color: 0xc9b493, roughness: 0.6 },
  d_oxblood: { color: 0x4a1d16, roughness: 0.38 }, // the director's leather
  d_leatherBlack: { color: 0x1d1b1a, roughness: 0.4 },
  d_chrome: { color: 0xd2d8dd, metalness: 0.9, roughness: 0.16 },
  d_brass: { color: 0xb68f45, metalness: 0.85, roughness: 0.3 },
  d_steel: { color: 0x9aa2a8, metalness: 0.6, roughness: 0.38 },
  d_fireRed: { color: 0xb3231b, roughness: 0.35, metalness: 0.15 },
  d_hose: { color: 0x9a2219, roughness: 0.7 },
  d_rubber: { color: 0x161718, roughness: 0.92 },
  d_plastic: { color: 0xdedcd3, roughness: 0.45 }, // pale casings
  d_plasticGrey: { color: 0x878c90, roughness: 0.5 },
  d_charcoal: { color: 0x2a2d30, roughness: 0.55 },
  d_gloss: { color: 0x0d0e0f, roughness: 0.22 }, // TV bezels, piano black
  d_paper: { color: 0xf2efe6, roughness: 0.85 },
  d_kraft: { color: 0x9e7c52, roughness: 0.9 },
  d_bankerBox: { color: 0xe2dccc, roughness: 0.85 },
  d_teal: { color: 0x2d5b60, roughness: 0.95 }, // conference chair fabric
  d_mustard: { color: 0xa8842e, roughness: 0.95 },
  d_slate: { color: 0x4a5462, roughness: 0.95 },
  d_mesh: { color: 0x2e3234, roughness: 0.8 },
  d_cork: { color: 0xb08758, roughness: 0.95 },
  d_safety: { color: 0x1c8a4a, roughness: 0.45 }, // AED / first-aid green
  d_janitor: { color: 0xd9a91c, roughness: 0.5 },
  d_ocean: { color: 0x2c5a85, roughness: 0.35 },
  d_land: { color: 0xb59a5e, roughness: 0.6 },
  d_gravel: { color: 0x8e8270, roughness: 1 },
  d_weed: { color: 0x3c6b38, roughness: 0.75 },
  d_ceramic: { color: 0xf4f2ec, roughness: 0.15 },
  d_coffee: { color: 0x3a2313, roughness: 0.2 },
  d_pastry: { color: 0xc68a45, roughness: 0.8 },
  d_shade: { color: 0xe8dcc0, roughness: 0.9 }, // lamp shade fabric (outside)
  d_board: { color: 0xf3f5f6, roughness: 0.2 }, // whiteboard / flip chart paper
  d_tile: { color: 0xc7c9c4, roughness: 0.6 }, // fallen ceiling tile
};
/** emissive materials this module adds (c.G.<name>): colour, intensity */
export const EXTRA_GLOW = {
  d_exit: [0x35ff7a, 1.3],
  d_tank: [0x4fc6c0, 0.85],
  d_warm: [0xffd9a0, 1.4],
  d_lens: [0xe6eeff, 1.8],
  d_slide: [0xdfe8f5, 0.75],
  d_bulb: [0xfff1c8, 1.6],
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
const cylG = (r0, r1, h, seg = 12, open = false) => cached(`cy${r3(r0)},${r3(r1)},${r3(h)},${seg},${open}`, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open));
const sphG = (r, w = 10, h = 6) => cached(`sp${r3(r)},${w},${h}`, () => new THREE.SphereGeometry(r, w, h));
const torG = (R, r, rs = 4, ts = 12, arc = PI * 2) => cached(`to${r3(R)},${r3(r)},${rs},${ts},${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const latheG = (key, pts, seg = 12) => cached(`la${key},${seg}`, () => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg));
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];
const jit = (c, k) => (c.rnd() - 0.5) * 2 * k;

/** a local frame at (x, z) looking toward `face` (a letter, or a yaw in radians): `a` runs across it, `b` toward its front */
function fr(x, z, face) {
  const yaw = typeof face === 'number' ? face : FY[face];
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  return { x, z, yaw, cs: Math.abs(cs) < 1e-9 ? 0 : cs, sn: Math.abs(sn) < 1e-9 ? 0 : sn, face: typeof face === 'string' ? face : null };
}
const at = (f, a, b) => [f.x + a * f.cs + b * f.sn, f.z - a * f.sn + b * f.cs];
const atY = (f, a, y, b) => {
  const [x, z] = at(f, a, b);
  return [x, y, z];
};
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
const Cy = (c, f, m, a, y0, b, r0, r1, h, seg = 12) => A(c, f, m, cylG(r0, r1, h, seg), a, y0 + h / 2, b);
/** a cylinder lying along a / along b, centred */
const Ca = (c, f, m, a, y, b, r, len, seg = 10) => A(c, f, m, cylG(r, r, len, seg), a, y, b, 0, 0, PI / 2);
const Cb = (c, f, m, a, y, b, r, len, seg = 10) => A(c, f, m, cylG(r, r, len, seg), a, y, b, PI / 2);
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

// ---------------------------------------------------------------- small things on desks, walls and floors
/** a standing photo frame on a surface at y, facing yaw (a picture of someone's family: just colour) */
export function photoFrame(c, x, y, z, yaw = 0, { w = 0.13, h = 0.18, down = false } = {}) {
  const { X, M } = c;
  const f = fr(x, z, yaw);
  if (down) {
    // knocked flat on its face
    A(c, f, pick(c, [X.d_walnut, X.d_brass, M.black]), rbox(w, 0.012, h, 0.004), 0, y + 0.006, 0);
    return;
  }
  A(c, f, pick(c, [X.d_walnut, X.d_brass, X.d_chrome, M.black]), rbox(w, h, 0.014, 0.004), 0, y + h / 2 - 0.005, 0, -0.17);
  A(c, f, pick(c, [M.blue, X.d_weed, X.d_pastry, X.d_ocean, X.d_land]), boxG(w - 0.03, h - 0.03, 0.002), 0, y + h / 2 - 0.004, 0.009, -0.17);
  A(c, f, X.d_charcoal, boxG(0.012, h * 0.7, 0.008), 0, y + h * 0.35, -0.04, 0.35);
}
/** a desk fan on a surface at y turned `yaw`: weighted base, stem, motor, a wire cage round three blades */
export function deskFan(c, x, y, z, yaw = 0) {
  const { X } = c;
  const f = fr(x, z, yaw);
  R(c, f, X.d_plastic, 0, y + 0.015, 0, 0.16, 0.03, 0.14, 0.01);
  Cy(c, f, X.d_plastic, 0, y + 0.03, -0.01, 0.014, 0.014, 0.17, 6);
  A(c, f, X.d_plastic, sphG(0.05, 8, 6), 0, y + 0.22, -0.02, 0, 0, 0, [1, 1, 1.3]);
  for (const b of [0.05, 0.075]) A(c, f, X.d_chrome, torG(0.12, 0.003, 3, 16), 0, y + 0.22, b);
  for (let k = 0; k < 6; k++) A(c, f, X.d_chrome, boxG(0.24, 0.003, 0.003), 0, y + 0.22, 0.078, 0, 0, (k * PI) / 6);
  for (let k = 0; k < 3; k++) A(c, f, X.d_plasticGrey, boxG(0.09, 0.05, 0.004), Math.cos((k * 2 * PI) / 3) * 0.05, y + 0.22 + Math.sin((k * 2 * PI) / 3) * 0.05, 0.062, 0.25, 0, (k * 2 * PI) / 3);
}
/** a hanging wall calendar at (x, y, z) facing `face`: a picture page over the month's grid, the days gone crossed out */
export function wallCalendar(c, x, y, z, face, { month = 'OCTOBER 2026', first = 3, days = 31, crossed = 0, pic = 'ALPINE LAKES', bg = '#3b6e8f', w = 0.34 } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const h = w * 0.72;
  B(c, f, X.d_paper, -w / 2, y - h, 0.004, w / 2, y + h, 0.008);
  B(c, f, M.black, -w / 2 + 0.02, y - 0.006, 0.008, w / 2 - 0.02, y + 0.006, 0.014); // the wire binding
  Cb(c, f, X.d_steel, 0, y + h + 0.015, 0.01, 0.004, 0.02, 6); // the nail
  lbl(c, f, pic, 0, y + h / 2, 0.009, w - 0.03, h - 0.04, { bg, fg: '#f4f1e8', font: 'bold 34px Georgia, serif' });
  // the grid: first = the weekday (0 Mon) of the 1st
  const rows = ['MO TU WE TH FR SA SU'];
  let row = '   '.repeat(first);
  for (let d = 1; d <= days; d++) {
    row += (d <= crossed ? ' X' : String(d).padStart(2, ' ')) + ' ';
    if ((first + d) % 7 === 0 || d === days) {
      rows.push(row.trimEnd());
      row = '';
    }
  }
  lbl(c, f, month, 0, y - h / 2, 0.009, w - 0.03, h - 0.03, { bg: '#fbfaf5', fg: '#1d2329', font: 'bold 26px Courier New, monospace', lines: [month, ...rows], align: 'left' });
}
/** a few spent cartridge cases on the floor round (x, z): somebody fired here */
export function casings(c, x, z, n = 8, spread = 0.6) {
  const { X, rnd } = c;
  for (let i = 0; i < n; i++) c.K.add(X.d_brass, cylG(0.0045, 0.0045, 0.019, 6), x + jit(c, spread), 0.0046, z + jit(c, spread), [0, rnd() * 6, PI / 2, 'YXZ']);
}
/** a briefcase on a surface at y turned `yaw` (open: lid up, files and bundles of cash inside) */
export function briefcase(c, x, y, z, yaw = 0, { open = false, cash = false, mat = null } = {}) {
  const { X, M } = c;
  const m = mat ?? X.d_leatherBlack;
  const f = fr(x, z, yaw);
  if (!open) {
    R(c, f, m, 0, y + 0.06, 0, 0.46, 0.12, 0.34, 0.02);
    A(c, f, m, torG(0.05, 0.01, 4, 8, PI), 0, y + 0.12, -0.17, PI / 2, 0, 0);
    for (const s of [-1, 1]) Cu(c, f, X.d_brass, s * 0.13, y + 0.1, -0.172, 0.04, 0.025, 0.008);
    return;
  }
  // base and the lid hinged up at the back
  R(c, f, m, 0, y + 0.045, 0, 0.46, 0.09, 0.34, 0.015);
  B(c, f, M.dark, -0.21, y + 0.085, -0.15, 0.21, y + 0.09, 0.15);
  A(c, f, m, rbox(0.46, 0.34, 0.03, 0.012), 0, y + 0.25, -0.2, -0.25);
  for (let i = 0; i < 3; i++) Cu(c, f, X.d_paper, -0.1 + i * 0.01, y + 0.095 + i * 0.004, 0.02, 0.21, 0.004, 0.28, jit(c, 0.1));
  if (cash) for (let i = 0; i < 6; i++) Cu(c, f, M.green, 0.06 + (i % 3) * 0.055, y + 0.1 + Math.floor(i / 3) * 0.022, -0.06 + jit(c, 0.01), 0.05, 0.02, 0.12);
}
/**
 * Banker's boxes of files at (x, z) facing `face` (their labelled ends): stacked `n` high, a little askew;
 * spill: the top one knocked off, its lid gone, files fanned out on the floor
 */
export function archiveBoxes(c, x, z, face, { n = 3, spill = false, tag = 'FINANCE 2025', col: hasCol = true } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  const w = 0.32, h = 0.26, d = 0.42;
  const k = spill ? n - 1 : n;
  for (let i = 0; i < k; i++) {
    const ry = jit(c, 0.08), y = i * h;
    A(c, f, X.d_bankerBox, boxG(w, h - 0.01, d), jit(c, 0.02), y + (h - 0.01) / 2, jit(c, 0.02), 0, ry);
    A(c, f, X.d_bankerBox, boxG(w + 0.01, 0.04, d + 0.01), 0, y + h - 0.02, 0, 0, ry);
    A(c, f, M.dark, boxG(0.08, 0.025, 0.004), 0, y + h * 0.62, d / 2 + 0.002, 0, ry);
    if (f.face && Math.abs(ry) < 0.05) lbl(c, f, tag, 0, y + h * 0.35, d / 2 + 0.003, 0.2, 0.06, { bg: '#fbfaf2', fg: '#1d2329', font: 'bold 28px Arial' });
  }
  if (spill) {
    // the top box on its side by the stack, files slid out
    const g = grp(c, ...atY(f, 0.45, h / 2, 0.15), f.yaw + 0.5, 0, PI / 2);
    g(X.d_bankerBox, boxG(w, h - 0.01, d), 0, 0, 0);
    for (let i = 0; i < 5; i++) c.K.add(pick(c, [X.d_paper, X.d_kraft, M.card]), boxG(0.24, 0.006, 0.31), ...atY(f, 0.55 + rnd() * 0.5, 0.004 + i * 0.002, 0.3 + jit(c, 0.3)), [0, rnd() * 6, 0]);
  }
  if (hasCol && k > 0) col(c, f, -w / 2 - 0.02, -d / 2 - 0.02, w / 2 + 0.02, d / 2 + 0.02, 0, k * h, SURF.cardboard);
}
/** an office paper shredder at (x, z) facing `face`: its bin, the cutting head, strips everywhere, a full sack beside it (jam: a sheet stuck, red LED) */
export function paperShredder(c, x, z, face, { jam = true } = {}) {
  const { X, M, U, rnd } = c;
  const f = fr(x, z, face);
  R(c, f, X.d_charcoal, 0, 0.3, 0, 0.44, 0.6, 0.32, 0.02);
  B(c, f, X.d_paper, -0.115, 0.1, 0.152, 0.115, 0.42, 0.158); // the shreds seen through its window
  B(c, f, U.glass, -0.125, 0.09, 0.158, 0.125, 0.47, 0.162);
  R(c, f, X.d_plasticGrey, 0, 0.65, 0, 0.46, 0.1, 0.34, 0.025);
  B(c, f, M.black, -0.16, 0.698, -0.012, 0.16, 0.702, 0.012);
  Cu(c, f, jam ? U.ledR : U.ledG, 0.18, 0.701, 0.12, 0.02, 0.004, 0.02);
  Cu(c, f, X.d_charcoal, 0.12, 0.703, 0.12, 0.05, 0.006, 0.03);
  if (jam) A(c, f, X.d_paper, boxG(0.21, 0.16, 0.002), -0.02, 0.78, 0, 0.12, 0, 0.06);
  for (let i = 0; i < 16; i++) c.K.add(X.d_paper, boxG(0.007, 0.002, 0.16 + rnd() * 0.14), ...atY(f, jit(c, 0.45), 0.002 + i * 0.0003, 0.28 + rnd() * 0.4), [0, rnd() * 6, 0]);
  // the sack: clear plastic stuffed with shreds, tied off
  const [sx, sz] = at(f, 0.52, 0.02);
  c.K.add(X.d_paper, cached('sack', () => new THREE.IcosahedronGeometry(1, 1)), sx, 0.27, sz, [0.1, rnd() * 3, 0.05], [0.22, 0.27, 0.2]);
  c.K.cyl(X.d_paper, sx, 0.5, sz, 0.05, 0.02, 0.1, 6);
  c.K.cyl(M.yellow, sx, 0.55, sz, 0.022, 0.022, 0.015, 6);
  col(c, f, -0.22, -0.17, 0.74, 0.2, 0, 0.7, SURF.metal);
}
/**
 * An office desk thrown on its side at (x, z), its top toward `face`: waist-high cover somebody hid behind. The legs
 * and drawers stick out behind it, a drawer fallen out, the monitor face down on the floor.
 */
export function tippedDesk(c, x, z, face, { w = 1.4, d = 0.75, top = null, debris = true } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  const T = 0.74;
  // parts in the upright desk's space (u across, py up, v toward its sitter), tipped so py points to `face`
  const g = grp(c, ...atY(f, 0, d / 2, -T / 2), f.yaw, PI / 2);
  g(top ?? pick(c, [X.d_ash, M.white, X.d_oak]), rbox(w, 0.03, d, 0.01), 0, T - 0.015, 0);
  for (const s of [-1, 1]) g(X.d_charcoal, boxG(0.036, T - 0.03, d - 0.08), s * (w / 2 - 0.03), (T - 0.03) / 2, 0);
  g(X.d_charcoal, boxG(w - 0.1, T - 0.35, 0.018), 0, 0.32 + (T - 0.35) / 2, -d / 2 + 0.06);
  g(M.grey, boxG(0.4, T - 0.08, d - 0.16), w / 2 - 0.27, 0.04 + (T - 0.08) / 2, 0.02);
  for (let i = 0; i < 2; i++) g(X.d_steel, boxG(0.12, 0.015, 0.015), w / 2 - 0.27, 0.22 + i * 0.21, d / 2 - 0.06);
  col(c, f, -w / 2, -T / 2 - 0.02, w / 2, T / 2 + 0.02, 0, d, SURF.wood);
  if (!debris) return;
  // the bottom drawer lies on the floor behind it, files out; the monitor face down, glass round it
  A(c, f, M.grey, boxG(0.38, 0.19, 0.5), w / 2 - 0.1, 0.095, -T / 2 - 0.42, 0, 0.4);
  for (let i = 0; i < 4; i++) A(c, f, pick(c, [X.d_paper, X.d_kraft]), boxG(0.22, 0.004, 0.3), jit(c, 0.6), 0.003 + i * 0.002, -T / 2 - 0.5 + jit(c, 0.2), 0, rnd() * 6);
  A(c, f, M.black, rbox(0.52, 0.035, 0.32, 0.01), -w / 2 + 0.35, 0.018, -T / 2 - 0.35, 0, 0.3);
  c.decal?.('glass', ...at(f, -w / 2 + 0.3, -T / 2 - 0.4), 0.6, rnd() * 6);
}
/** a mail sorting unit against the wall at (x, z) (back on the wall line) facing `face`: a cupboard, pigeonholes over it, names, post */
export function pigeonholes(c, x, z, face, { cols = 5, rows = 4, w = 1.2, names = ['ABRAMS', 'BECK', 'CHO', 'DIAZ', 'ELLIS', 'FOLEY', 'GRANT', 'HALE', 'IVES', 'JUNG'] } = {}) {
  const { X, M, rnd } = c;
  const f = fr(x, z, face);
  const d = 0.4, T = 0.9, top = 1.74, dd = 0.32;
  B(c, f, X.d_ash, -w / 2, 0.08, 0.03, w / 2, T, 0.03 + d);
  B(c, f, X.d_charcoal, -w / 2 + 0.02, 0, 0.05, w / 2 - 0.02, 0.08, 0.03 + d - 0.03);
  for (const s of [-1, 1]) {
    B(c, f, X.d_ash, s * 0.005, 0.1, 0.03 + d, s * (w / 2 - 0.006), T - 0.02, 0.03 + d + 0.015);
    B(c, f, X.d_steel, s * 0.06 - 0.008, 0.6, 0.045 + d, s * 0.06 + 0.008, 0.78, 0.06 + d);
  }
  // the pigeonholes: back, sides, shelves and dividers
  B(c, f, X.d_ash, -w / 2, T, 0.03, w / 2, top, 0.045);
  for (let i = 0; i <= cols; i++) {
    const a = -w / 2 + (w * i) / cols;
    B(c, f, X.d_ash, Math.max(-w / 2, a - 0.009), T, 0.045, Math.min(w / 2, a + 0.009), top, 0.03 + dd);
  }
  for (let j = 0; j <= rows; j++) {
    const y = T + ((top - T) * j) / rows;
    B(c, f, X.d_ash, -w / 2, Math.max(T, y - 0.009), 0.045, w / 2, Math.min(top, y + 0.009), 0.03 + dd);
  }
  for (let j = 0; j < rows; j++) {
    const y = T + ((top - T) * j) / rows + 0.01;
    for (let i = 0; i < cols; i++) {
      if (rnd() < 0.35) continue;
      const a = -w / 2 + (w * (i + 0.5)) / cols;
      A(c, f, pick(c, [X.d_paper, X.d_paper, X.d_kraft, M.white]), boxG(w / cols - 0.05, 0.01 + rnd() * 0.04, 0.24), a, y + 0.02, 0.2, 0, jit(c, 0.1));
    }
    if (f.face) lbl(c, f, names.slice(j * 2, j * 2 + 3).join('   '), 0, y - 0.004, 0.03 + dd + 0.001, w - 0.1, 0.022, { bg: '#f4f1e6', fg: '#1d2329', font: 'bold 22px Arial' });
  }
  col(c, f, -w / 2, 0.03, w / 2, 0.03 + d + 0.02, 0, top, SURF.wood);
}

// ---------------------------------------------------------------- the conference room's things
/** a pump-pot coffee thermos on a surface at y, its spout toward `yaw` */
export function thermos(c, x, y, z, yaw = 0, { mat = null } = {}) {
  const { X, M } = c;
  const f = fr(x, z, yaw);
  A(c, f, mat ?? pick(c, [X.d_steel, M.black, X.d_fireRed]), latheG('thermos', [[0, 0], [0.08, 0], [0.085, 0.02], [0.085, 0.27], [0.07, 0.3], [0, 0.3]], 12), 0, y, 0);
  Cy(c, f, X.d_charcoal, 0, y + 0.3, 0, 0.068, 0.062, 0.05, 12);
  R(c, f, X.d_charcoal, 0, y + 0.365, -0.01, 0.08, 0.03, 0.13, 0.012);
  A(c, f, X.d_charcoal, cylG(0.016, 0.012, 0.09, 6), 0, y + 0.33, 0.1, PI / 2 - 0.25);
  A(c, f, X.d_charcoal, torG(0.08, 0.012, 4, 8, PI), 0, y + 0.17, -0.085, 0, -PI / 2, PI / 2);
}
/** a cup on its saucer on a surface at y (full: cold coffee left in it) */
export function cupSaucer(c, x, y, z, yaw = 0, { full = true } = {}) {
  const { X } = c;
  c.K.add(X.d_ceramic, cylG(0.065, 0.07, 0.008, 12), x, y + 0.004, z);
  c.K.add(X.d_ceramic, cylG(0.034, 0.042, 0.07, 10, true), x, y + 0.043, z);
  c.K.add(X.d_ceramic, cylG(0.034, 0.034, 0.004, 8), x, y + 0.01, z);
  if (full) c.K.add(X.d_coffee, cylG(0.04, 0.04, 0.003, 8), x, y + 0.06, z);
  c.K.add(X.d_ceramic, torG(0.022, 0.006, 3, 6, PI), x + Math.cos(yaw) * 0.045, y + 0.045, z - Math.sin(yaw) * 0.045, [0, yaw, -PI / 2, 'YXZ']);
}
/** a three-armed conference speakerphone on a table at y, its cable run to (cx, cz) */
export function speakerPhone(c, x, y, z, yaw = 0, { cx = null, cz = null } = {}) {
  const { X, U, M } = c;
  const f = fr(x, z, yaw);
  Cy(c, f, X.d_charcoal, 0, y, 0, 0.075, 0.06, 0.035, 12);
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * PI) / 3;
    A(c, f, X.d_charcoal, rbox(0.07, 0.024, 0.17, 0.011), Math.sin(a) * 0.1, y + 0.012, Math.cos(a) * 0.1, -0.06, a);
    A(c, f, U.ledG, boxG(0.012, 0.004, 0.012), Math.sin(a) * 0.17, y + 0.022, Math.cos(a) * 0.17, 0, a);
  }
  Cu(c, f, M.black, 0, y + 0.036, 0.02, 0.06, 0.002, 0.03);
  Cu(c, f, X.d_plasticGrey, 0, y + 0.036, -0.03, 0.05, 0.003, 0.015);
  if (cx !== null) c.K.rod(M.black, V(x, y + 0.006, z), V(cx, y + 0.006, cz), 0.004, 4);
}
/**
 * A credenza against the wall at (x, z) (back on the wall line) facing `face`: sliding doors, a plinth, a top; with
 * catering: two thermoses, cups on saucers, a plate of pastries, a water jug and glasses, napkins
 */
export function sideboard(c, x, z, face, { w = 2.4, d = 0.48, h = 0.78, mat = null, catering = true } = {}) {
  const { X, M, U, rnd } = c;
  const m = mat ?? X.d_walnut;
  const f = fr(x, z, face);
  const b0 = 0.035, b1 = b0 + d;
  B(c, f, X.d_charcoal, -w / 2 + 0.04, 0, b0 + 0.03, w / 2 - 0.04, 0.08, b1 - 0.04);
  B(c, f, m, -w / 2, 0.08, b0, w / 2, h - 0.03, b1 - 0.02);
  R(c, f, m, 0, h - 0.015, (b0 + b1) / 2, w + 0.02, 0.03, d + 0.02, 0.008);
  const n = Math.max(2, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    const a0 = -w / 2 + (w * i) / n + 0.006, a1 = -w / 2 + (w * (i + 1)) / n - 0.006;
    const bb = b1 - 0.02 + (i % 2) * 0.012; // the sliding doors run in two tracks
    B(c, f, m, a0, 0.1, bb - 0.012, a1, h - 0.05, bb);
    B(c, f, X.d_brass, (i % 2 ? a0 + 0.04 : a1 - 0.06), 0.4, bb, (i % 2 ? a0 + 0.06 : a1 - 0.04), 0.56, bb + 0.006);
  }
  col(c, f, -w / 2, b0, w / 2, b1, 0, h, SURF.wood);
  if (!catering) return;
  const T = h, bm = (b0 + b1) / 2;
  thermos(c, ...atY(f, -w / 2 + 0.2, T, bm - 0.05), f.yaw);
  thermos(c, ...atY(f, -w / 2 + 0.42, T, bm - 0.04), f.yaw + 0.3, { mat: M.black });
  for (let i = 0; i < 6; i++) {
    if (rnd() < 0.25) continue;
    cupSaucer(c, ...atY(f, -w / 2 + 0.7 + (i % 3) * 0.16, T, bm - 0.08 + Math.floor(i / 3) * 0.16), rnd() * 6, { full: rnd() < 0.4 });
  }
  // the pastry plate (half eaten), napkins
  const [px, pz] = at(f, 0.25, bm);
  c.K.add(X.d_ceramic, cylG(0.15, 0.16, 0.012, 16), px, T + 0.006, pz);
  for (let i = 0; i < 5; i++) c.K.add(X.d_pastry, rbox(0.07, 0.035, 0.05, 0.015), px + jit(c, 0.08), T + 0.03, pz + jit(c, 0.08), [0, rnd() * 3, 0]);
  B(c, f, X.d_paper, 0.5, T, bm - 0.1, 0.66, T + 0.02, bm + 0.06);
  // a jug of water and glasses on a tray
  const ja = w / 2 - 0.35;
  R(c, f, X.d_steel, ja, T + 0.005, bm, 0.45, 0.01, 0.3, 0.004);
  A(c, f, U.glass, latheG('jug', [[0, 0], [0.06, 0], [0.065, 0.14], [0.05, 0.2], [0.055, 0.23]], 10), ja - 0.12, T + 0.01, bm);
  for (let i = 0; i < 4; i++) A(c, f, U.glass, cylG(0.03, 0.034, 0.1, 8, true), ja + 0.02 + (i % 2) * 0.09, T + 0.06, bm - 0.06 + Math.floor(i / 2) * 0.12);
}
/** the boardroom table top: a long slab with big rounded corners (extruded once per size) */
const tableTop = (L, D, rc) => cached(`tt${r3(L)},${r3(D)},${r3(rc)}`, () => {
  const s = new THREE.Shape(), hx = L / 2, hz = D / 2;
  s.moveTo(-hx + rc, -hz);
  s.lineTo(hx - rc, -hz);
  s.absarc(hx - rc, -hz + rc, rc, -PI / 2, 0, false);
  s.lineTo(hx, hz - rc);
  s.absarc(hx - rc, hz - rc, rc, 0, PI / 2, false);
  s.lineTo(-hx + rc, hz);
  s.absarc(-hx + rc, hz - rc, rc, PI / 2, PI, false);
  s.lineTo(-hx, -hz + rc);
  s.absarc(-hx + rc, -hz + rc, rc, PI, PI * 1.5, false);
  return new THREE.ExtrudeGeometry(s, { depth: 0.045, bevelEnabled: false, curveSegments: 5 }).rotateX(-PI / 2);
});
/**
 * The boardroom table over the rect: a long oak slab with rounded corners on dark pedestal bases, a cable box with its
 * lid up; each seat's notepad and pen, a glass or a bottle, a cup, now and then a laptop. Returns the chair spots
 * [{ x, z, yaw }] (`seats` a side, yaw: looking at the table), the chairs are the caller's.
 */
export function boardTable(c, [x0, z0, x1, z1], { seats = 4, mat = null, items = true } = {}) {
  const { X, M, U, rnd } = c;
  const alongX = x1 - x0 >= z1 - z0;
  const f = fr((x0 + x1) / 2, (z0 + z1) / 2, alongX ? 's' : 'e');
  const Lg = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const T = 0.77;
  A(c, f, mat ?? X.d_oak, tableTop(Lg, D, Math.min(0.45, D / 2 - 0.05)), 0, T - 0.045, 0);
  A(c, f, X.d_charcoal, tableTop(Lg - 0.3, D - 0.3, Math.min(0.35, D / 2 - 0.2)), 0, T - 0.065, 0, 0, 0, 0, [1, 0.45, 1]);
  const bases = Lg > 4.5 ? [-Lg * 0.3, 0, Lg * 0.3] : [-Lg * 0.25, Lg * 0.25];
  for (const u of bases) {
    R(c, f, X.d_charcoal, u, 0.37, 0, 0.24, 0.68, D * 0.5, 0.02);
    R(c, f, X.d_steel, u, 0.012, 0, 0.4, 0.024, D * 0.62, 0.008);
  }
  // the cable box in the middle, lid up, leads out to whoever presented
  B(c, f, X.d_steel, -0.2, T, -0.08, 0.2, T + 0.004, 0.08);
  B(c, f, M.black, -0.18, T + 0.004, -0.065, 0.18, T + 0.005, 0.065);
  B(c, f, X.d_steel, -0.2, T, -0.09, 0.2, T + 0.15, -0.084);
  const spots = [];
  for (let i = 0; i < seats; i++) {
    const u = -Lg / 2 + (Lg * (i + 0.5)) / seats;
    for (const s of [-1, 1]) {
      const [sx, sz] = at(f, u, s * (D / 2 + 0.42));
      spots.push({ x: sx, z: sz, yaw: f.yaw + (s > 0 ? PI : 0) });
      if (!items) continue;
      const b = s * (D / 2 - 0.22), sf = fr(...at(f, u, b), f.yaw + (s > 0 ? 0 : PI));
      if (rnd() < 0.8) {
        A(c, sf, X.d_paper, boxG(0.15, 0.006, 0.21), jit(c, 0.05), T + 0.003, 0.02, 0, jit(c, 0.2));
        c.K.rod(pick(c, [M.blue, M.black, X.d_chrome]), V(...atY(sf, 0.1, T + 0.004, -0.05)), V(...atY(sf, 0.12 + jit(c, 0.03), T + 0.004, 0.09)), 0.004, 4);
      }
      const r = rnd();
      if (r < 0.35) A(c, sf, U.glass, cylG(0.03, 0.034, 0.1, 8, true), -0.2, T + 0.05, -0.05);
      else if (r < 0.6) {
        A(c, sf, U.glass, latheG('pet', [[0, 0], [0.032, 0], [0.032, 0.16], [0.012, 0.2], [0.012, 0.215]], 8), -0.2, T, -0.06);
        A(c, sf, M.blue, cylG(0.014, 0.014, 0.015, 6), -0.2, T + 0.222, -0.06);
      } else if (r < 0.8) cupSaucer(c, ...atY(sf, -0.22, T, -0.04), rnd() * 6, { full: rnd() < 0.6 });
      if (rnd() < 0.18) {
        // a laptop left open, its lead to the cable box
        A(c, sf, X.d_steel, rbox(0.33, 0.018, 0.23, 0.006), 0.2, T + 0.009, -0.05);
        A(c, sf, X.d_steel, boxG(0.33, 0.22, 0.008), 0.2, T + 0.12, -0.17, -0.22);
        const [lx, lz] = at(sf, 0.2, -0.163);
        c.screen?.(lx, T + 0.12, lz, sf.yaw, 0.29, 0.18, rnd() < 0.6);
        c.K.rod(M.black, V(...atY(sf, 0.36, T + 0.004, -0.1)), V(...atY(f, 0, T + 0.004, 0)), 0.004, 4);
      }
    }
  }
  col(c, f, -Lg / 2, -D / 2, Lg / 2, D / 2, 0, T, SURF.wood);
  return spots;
}
/** a flip chart on its easel at (x, z) facing `face`: the pad (lines: what's written on it), pages flipped over the back, markers */
export function flipChart(c, x, z, face, { lines = null } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  for (const s of [-1, 1]) c.K.rod(X.d_steel, V(...atY(f, s * 0.36, 0, 0.1)), V(...atY(f, s * 0.33, 1.98, -0.01)), 0.012, 6);
  c.K.rod(X.d_steel, V(...atY(f, 0, 0, -0.55)), V(...atY(f, 0, 1.55, -0.03)), 0.012, 6);
  B(c, f, X.d_plasticGrey, -0.37, 0.96, -0.02, 0.37, 1.99, 0.0);
  B(c, f, X.d_board, -0.35, 0.98, 0.0, 0.35, 1.95, 0.004);
  for (let i = 0; i < 3; i++) A(c, f, X.d_board, boxG(0.7, 0.5 - i * 0.08, 0.003), 0, 1.98 - (0.25 - i * 0.04), -0.03 - i * 0.006, -0.05 - i * 0.04);
  Ca(c, f, X.d_steel, 0, 1.975, 0.008, 0.012, 0.76, 8);
  B(c, f, X.d_plasticGrey, -0.36, 0.93, 0.0, 0.36, 0.95, 0.08);
  [M.red, M.blue, M.black].forEach((m, i) => Ca(c, f, m, -0.15 + i * 0.1, 0.958, 0.04, 0.009, 0.12, 6));
  if (lines && f.face) lbl(c, f, '', 0, 1.47, 0.004, 0.64, 0.9, { lines, bg: '#f4f6f7', fg: '#1c3f8f', font: 'bold 30px "Comic Sans MS", Arial', align: 'left' });
  col(c, f, -0.38, -0.56, 0.38, 0.12, 0, 1.99, SURF.wood);
}
/**
 * A low AV cabinet against the wall at (x, z) facing `face` (vented doors, a codec with its LEDs, the remote), the
 * video-conference screen on the wall over it and the camera bar on top of the screen
 */
export function avCabinet(c, x, z, face, { w = 1.2, tvY = 1.55, tvW = 1.4, tvLines = null } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  const b0 = 0.035, b1 = 0.5;
  B(c, f, X.d_charcoal, -w / 2, 0.06, b0, w / 2, 0.6, b1);
  R(c, f, X.d_walnut, 0, 0.615, (b0 + b1) / 2, w + 0.02, 0.03, b1 - b0 + 0.02, 0.006);
  for (const s of [-1, 1]) {
    B(c, f, M.black, s * 0.008, 0.09, b1, s * (w / 2 - 0.02), 0.57, b1 + 0.004);
    for (let i = 0; i < 6; i++) B(c, f, X.d_charcoal, s * 0.04, 0.16 + i * 0.06, b1 + 0.004, s * (w / 2 - 0.06), 0.175 + i * 0.06, b1 + 0.008);
  }
  R(c, f, X.d_charcoal, -0.2, 0.655, 0.25, 0.32, 0.05, 0.22, 0.01);
  Cu(c, f, U.ledG, -0.1, 0.66, 0.361, 0.01, 0.008, 0.004);
  Cu(c, f, U.ledB, -0.08, 0.66, 0.361, 0.01, 0.008, 0.004);
  R(c, f, M.black, 0.25, 0.64, 0.3, 0.05, 0.018, 0.18, 0.008, 0.3);
  c.K.rod(M.black, V(...atY(f, -0.3, 0.65, 0.14)), V(...atY(f, -0.1, tvY - tvW * 0.25, 0.1)), 0.008, 4);
  Fac.tvOnWall(c, x, tvY, z, face, { w: tvW, on: !tvLines, lines: tvLines, bg: '#0b1f3a', fg: '#e8f0ff' });
  const ty = tvY + tvW * 0.29 + 0.045;
  R(c, f, X.d_gloss, 0, ty, 0.11, 0.56, 0.06, 0.08, 0.02);
  Cb(c, f, M.black, -0.05, ty, 0.152, 0.022, 0.006, 12);
  Cu(c, f, U.ledR, 0.2, ty, 0.152, 0.008, 0.008, 0.004);
  col(c, f, -w / 2, b0, w / 2, b1, 0, 0.63, SURF.wood);
}

// ---------------------------------------------------------------- the director's things
/** a high-backed executive chair at (x, z), its sitter looking toward `yaw`: chrome star base, tufted leather, padded arms */
export function execChair(c, x, z, yaw, { mat = null, down = false } = {}) {
  const { X } = c;
  const m = mat ?? X.d_oxblood;
  const g = down ? grp(c, x, 0.32, z, yaw, -PI / 2 + 0.1, jit(c, 0.25)) : grp(c, x, 0, z, yaw);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2;
    g(X.d_chrome, boxG(0.32, 0.03, 0.05), Math.sin(a) * 0.16, 0.08, Math.cos(a) * 0.16, 0, a + PI / 2, 0);
    g(X.d_rubber, cylG(0.03, 0.03, 0.03, 6), Math.sin(a) * 0.31, 0.03, Math.cos(a) * 0.31, 0, a, PI / 2);
  }
  g(X.d_chrome, cylG(0.026, 0.026, 0.32, 8), 0, 0.25, 0);
  g(X.d_charcoal, boxG(0.3, 0.04, 0.3), 0, 0.42, 0);
  g(m, rbox(0.56, 0.12, 0.54, 0.05), 0, 0.5, 0.02);
  // the back in three tufted rolls, a headrest, all raked back a little
  for (let i = 0; i < 3; i++) g(m, rbox(0.52 - i * 0.02, 0.26, 0.12, 0.05), 0, 0.72 + i * 0.25, -0.27 - i * 0.03, -0.12);
  g(m, rbox(0.4, 0.18, 0.12, 0.05), 0, 1.42, -0.37, -0.16);
  for (const s of [-1, 1]) {
    g(X.d_chrome, boxG(0.03, 0.2, 0.04), s * 0.28, 0.62, 0.02);
    g(m, rbox(0.1, 0.07, 0.42, 0.03), s * 0.29, 0.74, 0.0);
  }
}
/** a floor-standing globe at (x, z): a walnut tripod, the brass meridian, the world tilted on its axis */
export function globe(c, x, z, { r = 0.27 } = {}) {
  const { X, rnd } = c;
  const y = 0.92;
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * PI) / 3;
    c.K.rod(X.d_walnut, V(x + Math.sin(a) * 0.3, 0, z + Math.cos(a) * 0.3), V(x + Math.sin(a) * 0.12, y - r * 0.6, z + Math.cos(a) * 0.12), 0.02, 6);
  }
  c.K.add(X.d_walnut, torG(r + 0.04, 0.02, 4, 24), x, y - r * 0.55, z, [PI / 2, 0, 0]);
  c.K.add(X.d_walnut, cylG(0.05, 0.03, 0.12, 8), x, y - r - 0.04, z);
  c.K.add(X.d_ocean, sphG(r, 16, 12), x, y, z);
  c.K.add(X.d_brass, torG(r + 0.025, 0.008, 3, 24), x, y, z, [0, 0.6, 0.41, 'YXZ']);
  // the continents: a few flattened lumps on the sphere
  for (let i = 0; i < 9; i++) {
    const th = rnd() * PI * 2, ph = 0.5 + rnd() * 2.1;
    const n = V(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), n);
    const e = new THREE.Euler().setFromQuaternion(q);
    c.K.add(X.d_land, cached('land', () => new THREE.IcosahedronGeometry(1, 0)), x + n.x * r * 0.97, y + n.y * r * 0.97, z + n.z * r * 0.97, [e.x, e.y, e.z], [0.07 + rnd() * 0.06, 0.012, 0.05 + rnd() * 0.07]);
  }
  c.col(x - 0.32, 0, z - 0.32, x + 0.32, y + r, z + 0.32, SURF.wood);
}
/**
 * A fish tank on its walnut stand against the wall at (x, z) facing `face`: gravel, weed, a rock, the hood's light
 * still on (a baked glow), the fish dead at the top
 */
export function aquarium(c, x, z, face, { w = 1.2, d = 0.45, h = 0.55, light = true } = {}) {
  const { X, M, U, G, rnd } = c;
  const f = fr(x, z, face);
  const S = 0.76, b0 = 0.04, b1 = b0 + d, bm = (b0 + b1) / 2;
  B(c, f, X.d_walnut, -w / 2, 0.06, b0, w / 2, S - 0.03, b1);
  B(c, f, X.d_charcoal, -w / 2 + 0.03, 0, b0 + 0.03, w / 2 - 0.03, 0.06, b1 - 0.03);
  R(c, f, X.d_walnut, 0, S - 0.015, bm, w + 0.03, 0.03, d + 0.03, 0.008);
  for (const s of [-1, 1]) B(c, f, X.d_brass, s * 0.05 - 0.006, 0.35, b1, s * 0.05 + 0.006, 0.5, b1 + 0.012);
  // the tank: water (lit from the hood), gravel, the glass round it
  B(c, f, X.d_gravel, -w / 2 + 0.02, S, b0 + 0.02, w / 2 - 0.02, S + 0.06, b1 - 0.02);
  B(c, f, G.d_tank, -w / 2 + 0.015, S + 0.06, b0 + 0.015, w / 2 - 0.015, S + h - 0.06, b1 - 0.015);
  B(c, f, U.glass, -w / 2, S, b1 - 0.008, w / 2, S + h, b1);
  for (const s of [-1, 1]) B(c, f, U.glass, s * w / 2 - (s > 0 ? 0.008 : 0), S, b0, s * w / 2 + (s < 0 ? 0.008 : 0), S + h, b1);
  B(c, f, X.d_charcoal, -w / 2 - 0.01, S + h, b0 - 0.005, w / 2 + 0.01, S + h + 0.05, b1 + 0.01);
  B(c, f, X.d_charcoal, -w / 2 - 0.01, S, b1, w / 2 + 0.01, S + 0.03, b1 + 0.008);
  A(c, f, M.dark, cached('rock', () => new THREE.IcosahedronGeometry(1, 0)), 0.25, S + 0.1, bm, 0.3, 0.7, 0, [0.12, 0.08, 0.09]);
  for (let i = 0; i < 9; i++) {
    const a = -w / 2 + 0.1 + rnd() * (w - 0.2), bb = b0 + 0.06 + rnd() * (d - 0.14), hh = 0.15 + rnd() * 0.25;
    c.K.rod(X.d_weed, V(...atY(f, a, S + 0.06, bb)), V(...atY(f, a + jit(c, 0.05), S + 0.06 + hh, bb + jit(c, 0.04))), 0.01, 3);
  }
  for (let i = 0; i < 3; i++) A(c, f, X.d_pastry, sphG(0.025, 6, 4), -0.3 + i * 0.22, S + h - 0.075, bm + jit(c, 0.1), PI / 2, rnd() * 6, 0, [1.6, 0.5, 0.8]);
  if (light) c.light(...atY(f, 0, S + h * 0.5, b1 + 0.35), 0.3, 1.4, [0.45, 0.85, 0.85], null, 3.2);
  col(c, f, -w / 2, b0, w / 2, b1 + 0.01, 0, S + h + 0.05, SURF.glass);
}
/** a standing lamp at (x, z): a brass foot and pole, a drum shade glowing warm (light: a baked glow round it) */
export function floorLamp(c, x, z, { on = true, light = true, h = 1.55 } = {}) {
  const { X, M, G } = c;
  c.K.add(X.d_brass, cylG(0.17, 0.15, 0.03, 16), x, 0.015, z);
  c.K.add(X.d_brass, cylG(0.014, 0.014, h - 0.03, 8), x, 0.03 + (h - 0.03) / 2, z);
  c.K.add(X.d_shade, cylG(0.24, 0.19, 0.3, 14, true), x, h + 0.05, z);
  // the diffusers top and bottom glow (the shade's inside would not show)
  for (const y of [h - 0.098, h + 0.196]) c.K.add(on ? G.d_warm ?? M.white : X.d_shade, cylG(0.18, 0.18, 0.004, 14), x, y, z);
  c.K.add(X.d_brass, torG(0.19, 0.006, 3, 14), x, h + 0.2, z, [PI / 2, 0, 0]);
  if (on && light) c.light(x, h - 0.1, z, 0.4, 1.6, WARM, null, 4);
  c.col(x - 0.17, 0, z - 0.17, x + 0.17, h + 0.2, z + 0.17, SURF.metal);
}
/** a gilt-framed painting taken down and left leaning against the wall at (x, z) facing `face` (what hung over the safe) */
export function pictureLeaning(c, x, z, face, { w = 0.8, h = 0.6 } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const H = h + 0.1, tilt = Math.atan2(0.12, H);
  const yc = (H / 2) * Math.cos(tilt), bc = 0.15 - (H / 2) * Math.sin(tilt);
  A(c, f, X.d_brass, rbox(w + 0.1, H, 0.045, 0.012), 0, yc, bc, -tilt);
  // a lake under mountains, in oils
  A(c, f, X.d_ocean, boxG(w, h * 0.55, 0.006), 0, yc + h * 0.22 * Math.cos(tilt), bc + 0.024 - h * 0.22 * Math.sin(tilt), -tilt);
  A(c, f, X.d_weed, boxG(w, h * 0.45, 0.006), 0, yc - h * 0.27 * Math.cos(tilt), bc + 0.024 + h * 0.27 * Math.sin(tilt), -tilt);
  A(c, f, M.dark, cached('peak', () => new THREE.ConeGeometry(0.2, 0.22, 3)), -0.08, yc + h * 0.06, bc + 0.03 - h * 0.06 * Math.sin(tilt), -tilt, 0, 0, [1.4, 1, 0.05]);
  col(c, f, -w / 2 - 0.05, 0.02, w / 2 + 0.05, 0.2, 0, H, SURF.wood);
}
/** a display plinth at (x, z): a white column with a walnut cap (the caller puts something on top, at `h`) */
export function plinth(c, x, z, { h = 1.0, w = 0.36, mat = null } = {}) {
  const { X, M } = c;
  c.K.add(mat ?? M.white, rbox(w, h - 0.04, w, 0.01), x, (h - 0.04) / 2, z);
  c.K.add(X.d_walnut, rbox(w + 0.04, 0.04, w + 0.04, 0.008), x, h - 0.02, z);
  c.K.add(X.d_charcoal, boxG(w - 0.02, 0.03, w - 0.02), x, 0.015, z);
  c.col(x - w / 2 - 0.02, 0, z - w / 2 - 0.02, x + w / 2 + 0.02, h, z + w / 2 + 0.02, SURF.wood);
}
/** a glass award (an obelisk on a black base) on a surface at y */
export function award(c, x, y, z, yaw = 0) {
  const { X, U } = c;
  c.K.add(X.d_gloss, rbox(0.1, 0.04, 0.1, 0.006), x, y + 0.02, z, [0, yaw, 0]);
  c.K.add(U.glass, cylG(0.045, 0.028, 0.22, 4), x, y + 0.15, z, [0, yaw + PI / 4, 0]);
  c.K.add(X.d_brass, boxG(0.06, 0.015, 0.002), x + Math.sin(yaw) * 0.051, y + 0.02, z + Math.cos(yaw) * 0.051, [0, yaw, 0]);
}

// ---------------------------------------------------------------- the corridors' wall fittings
/** a fire hose cabinet on the wall at (x, z) facing `face`: red steel, a glazed door (open: swung out), the hose coiled inside */
export function hoseCabinet(c, x, z, face, { open = false, y = 0.75, w = 0.7, h = 0.85 } = {}) {
  const { X, U } = c;
  const f = fr(x, z, face);
  const d = 0.2;
  B(c, f, X.d_fireRed, -w / 2, y, 0.01, w / 2, y + h, 0.03);
  for (const s of [-1, 1]) B(c, f, X.d_fireRed, s * (w / 2) - (s > 0 ? 0.02 : 0), y, 0.03, s * (w / 2) + (s < 0 ? 0.02 : 0), y + h, d);
  for (const yy of [y, y + h - 0.02]) B(c, f, X.d_fireRed, -w / 2, yy, 0.03, w / 2, yy + 0.02, d);
  // the reel and the coiled hose, the branch pipe clipped beside it
  Cb(c, f, X.d_steel, 0, y + h * 0.45, 0.06, 0.06, 0.06, 10);
  for (let i = 0; i < 3; i++) A(c, f, X.d_hose, torG(0.17 + i * 0.035, 0.022, 4, 16), 0, y + h * 0.45, 0.08 + i * 0.035);
  A(c, f, X.d_brass, cylG(0.02, 0.012, 0.22, 8), w / 2 - 0.08, y + h * 0.45, 0.1, 0, 0, 0.1);
  lbl(c, f, 'FIRE HOSE', 0, y + h - 0.08, 0.03, w - 0.1, 0.08, { bg: '#b3231b', fg: '#ffffff', font: 'bold 44px Arial' });
  // the door: a red frame round a pane
  const hinge = at(f, -w / 2, d);
  const g = grp(c, hinge[0], y, hinge[1], f.yaw + (open ? -1.6 : 0));
  g(X.d_fireRed, boxG(w, 0.04, 0.02), w / 2, 0.02, 0.01);
  g(X.d_fireRed, boxG(w, 0.04, 0.02), w / 2, h - 0.02, 0.01);
  for (const u of [0.02, w - 0.02]) g(X.d_fireRed, boxG(0.04, h, 0.02), u, h / 2, 0.01);
  if (!open) g(U.glass, boxG(w - 0.08, h - 0.08, 0.006), w / 2, h / 2, 0.01);
  g(X.d_chrome, boxG(0.02, 0.1, 0.03), w - 0.05, h / 2, 0.03);
  col(c, f, -w / 2, 0, w / 2, d, 0, y + h, SURF.metal);
}
/** a stainless drinking fountain on the wall at (x, z) facing `face`: bowl, bubbler, push button, the trap under it */
export function drinkingFountain(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.d_steel, -0.2, 0.6, 0.01, 0.2, 1.05, 0.03);
  R(c, f, X.d_steel, 0, 0.88, 0.2, 0.4, 0.12, 0.34, 0.03);
  A(c, f, M.dark, cylG(0.12, 0.12, 0.004, 12), 0, 0.941, 0.2);
  A(c, f, M.black, cylG(0.02, 0.02, 0.004, 8), 0, 0.944, 0.22);
  Cy(c, f, X.d_chrome, 0.08, 0.94, 0.12, 0.012, 0.01, 0.06, 8);
  A(c, f, X.d_chrome, cylG(0.008, 0.008, 0.05, 6), 0.06, 1.0, 0.13, 0, 0, 1.1);
  Cb(c, f, X.d_chrome, 0, 0.88, 0.375, 0.025, 0.02, 10);
  c.K.rod(X.d_chrome, V(...atY(f, 0, 0.82, 0.2)), V(...atY(f, 0, 0.6, 0.2)), 0.018, 8);
  c.K.rod(X.d_chrome, V(...atY(f, 0, 0.6, 0.2)), V(...atY(f, 0, 0.55, 0.02)), 0.018, 8);
  c.wallDecal?.('stain', ...atY(f, 0, 0.45, 0), face, 0.5, 0.6);
  col(c, f, -0.2, 0, 0.2, 0.38, 0, 0.95, SURF.metal);
}
/** a wall AED cabinet (green, a window onto the defibrillator) at centre height y */
export function aedCabinet(c, x, y, z, face, { open = false } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  R(c, f, X.d_safety, 0, y, 0.07, 0.4, 0.48, 0.13, 0.02);
  R(c, f, M.yellow, 0, y - 0.05, 0.08, 0.26, 0.24, 0.1, 0.03);
  Cu(c, f, X.d_charcoal, 0, y + 0.0, 0.132, 0.12, 0.06, 0.004);
  if (!open) B(c, f, U.glass, -0.15, y - 0.2, 0.135, 0.15, y + 0.1, 0.14);
  else A(c, f, U.glass, boxG(0.3, 0.3, 0.005), -0.3, y - 0.05, 0.25, 0, 1.4);
  lbl(c, f, 'AED', 0, y + 0.17, 0.135, 0.3, 0.09, { bg: '#1c8a4a', fg: '#ffffff', font: 'bold 60px Arial', lines: ['AED  DEFIBRILLATOR'] });
  Cy(c, f, U.red, 0, y + 0.24, 0.07, 0.03, 0.03, 0.04, 8);
}
/** a fire alarm on the wall: the red break-glass call point at y, its sounder and strobe above */
export function fireAlarm(c, x, y, z, face) {
  const { X, U } = c;
  const f = fr(x, z, face);
  R(c, f, X.d_fireRed, 0, y, 0.025, 0.1, 0.1, 0.05, 0.008);
  B(c, f, X.d_paper, -0.035, y - 0.035, 0.05, 0.035, y + 0.035, 0.052);
  lbl(c, f, 'FIRE', 0, y + 0.005, 0.052, 0.06, 0.03, { bg: '#f2f0ea', fg: '#b3231b', font: 'bold 40px Arial' });
  Cb(c, f, X.d_fireRed, 0, y + 0.62, 0.03, 0.07, 0.06, 14);
  Cb(c, f, X.d_charcoal, 0, y + 0.62, 0.063, 0.045, 0.006, 12);
  Cu(c, f, U.red, 0, y + 0.72, 0.03, 0.05, 0.04, 0.05);
}
/** a framed evacuation plan on the wall at centre height y: the floor's outline, a red you-are-here, green ways out */
export function evacPlan(c, x, y, z, face, { title = 'EVACUATION PLAN · SUBLEVEL 4', here = [0, 0], w = 0.6 } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  const h = w * 0.72;
  B(c, f, X.d_steel, -w / 2 - 0.02, y - h / 2 - 0.02, 0.005, w / 2 + 0.02, y + h / 2 + 0.02, 0.02);
  B(c, f, X.d_paper, -w / 2, y - h / 2, 0.02, w / 2, y + h / 2, 0.022);
  lbl(c, f, title, 0, y + h / 2 - 0.035, 0.022, w - 0.02, 0.05, { bg: '#1c8a4a', fg: '#ffffff', font: 'bold 34px Arial' });
  // the plan: an outline, a corridor spine, rooms off it
  const pw = w - 0.08, ph = h - 0.16, py = y - 0.02;
  const ln = (a0, y0, a1, y1) => B(c, f, M.black, a0, y0, 0.022, a1, y1, 0.0235);
  ln(-pw / 2, py - ph / 2, pw / 2, py - ph / 2 + 0.004);
  ln(-pw / 2, py + ph / 2 - 0.004, pw / 2, py + ph / 2);
  ln(-pw / 2, py - ph / 2, -pw / 2 + 0.004, py + ph / 2);
  ln(pw / 2 - 0.004, py - ph / 2, pw / 2, py + ph / 2);
  ln(-pw / 2, py - 0.03, pw / 2, py - 0.027);
  ln(-pw / 2, py + 0.03, pw / 2, py + 0.033);
  for (let i = 1; i < 5; i++) {
    const a = -pw / 2 + (pw * i) / 5 + jit(c, 0.02);
    ln(a, py + 0.03, a + 0.003, py + ph / 2);
    ln(a + jit(c, 0.03), py - ph / 2, a + 0.003, py - 0.03);
  }
  for (const s of [-1, 1]) B(c, f, X.d_safety, s > 0 ? 0.05 : -pw / 2 + 0.02, py - 0.008, 0.0235, s > 0 ? pw / 2 - 0.02 : -0.05, py + 0.008, 0.024);
  Cb(c, f, U.red, here[0] * pw * 0.5, py + here[1] * ph * 0.5, 0.024, 0.012, 0.003, 8);
  lbl(c, f, 'YOU ARE HERE', 0, y - h / 2 + 0.03, 0.022, w * 0.5, 0.035, { bg: '#f2efe6', fg: '#b3231b', font: 'bold 30px Arial' });
}
/** a lit exit sign on the wall at centre height y (arrow: '→' / '←' / '' after EXIT) */
export function exitSign(c, x, y, z, face, { arrow = '→', w = 0.42 } = {}) {
  const { X, G, M } = c;
  const f = fr(x, z, face);
  R(c, f, X.d_plastic, 0, y, 0.03, w, 0.17, 0.06, 0.01);
  B(c, f, G.d_exit ?? M.green, -w / 2 + 0.015, y - 0.07, 0.06, w / 2 - 0.015, y + 0.07, 0.062);
  lbl(c, f, `EXIT ${arrow}`.trim(), 0, y, 0.062, w * 0.62, 0.09, { bg: '#1fd65f', fg: '#ffffff', font: 'bold 60px Arial' });
}
/** a room plate beside a door at centre height y: number and name on brushed aluminium */
export function doorPlate(c, x, y, z, face, num, name) {
  const { X } = c;
  const f = fr(x, z, face);
  B(c, f, X.d_steel, -0.17, y - 0.07, 0.005, 0.17, y + 0.07, 0.013);
  lbl(c, f, '', 0, y, 0.013, 0.3, 0.11, { lines: [num, name], bg: '#d7dbde', fg: '#1d2329', font: 'bold 36px Arial' });
}
/**
 * A row of beam seats against the wall at (x, z) (backs on the wall line) facing `face`: perforated steel seats on a
 * beam, two T-feet, arms between the seats (`gone`: a seat missing)
 */
export function corridorBench(c, x, z, face, { seats = 3, gone = -1 } = {}) {
  const { X } = c;
  const f = fr(x, z, face);
  const sw = 0.54, Lb = seats * sw;
  Ca(c, f, X.d_charcoal, 0, 0.36, 0.3, 0.035, Lb - 0.1, 8);
  for (const s of [-1, 1]) {
    const a = s * (Lb / 2 - 0.25);
    B(c, f, X.d_charcoal, a - 0.03, 0, 0.27, a + 0.03, 0.36, 0.33);
    B(c, f, X.d_charcoal, a - 0.03, 0, 0.06, a + 0.03, 0.04, 0.58);
    for (const b of [0.08, 0.56]) Cy(c, f, X.d_rubber, a, 0, b, 0.025, 0.025, 0.015, 6);
  }
  for (let i = 0; i < seats; i++) {
    const a = -Lb / 2 + sw * (i + 0.5);
    if (i !== gone) {
      A(c, f, X.d_steel, rbox(sw - 0.04, 0.025, 0.44, 0.01), a, 0.44, 0.33, -0.06);
      A(c, f, X.d_steel, rbox(sw - 0.04, 0.4, 0.025, 0.01), a, 0.68, 0.1, -0.18);
      B(c, f, X.d_charcoal, a - 0.03, 0.38, 0.28, a + 0.03, 0.43, 0.36);
    }
    if (i > 0) {
      const aa = -Lb / 2 + sw * i;
      B(c, f, X.d_charcoal, aa - 0.015, 0.42, 0.3, aa + 0.015, 0.62, 0.34);
      R(c, f, X.d_rubber, aa, 0.635, 0.36, 0.05, 0.03, 0.34, 0.01);
    }
  }
  col(c, f, -Lb / 2, 0.04, Lb / 2, 0.6, 0, 0.85, SURF.metal);
}
/** a janitor's cart at (x, z) turned `yaw`: a yellow frame, shelves of cleaning stuff, the bin bag hoop, a mop bucket and its mop */
export function janitorCart(c, x, z, yaw = 0) {
  const { X, M, U } = c;
  const f = fr(x, z, yaw);
  // the body (a = along it, b = its front)
  for (const y of [0.12, 0.5, 0.92]) R(c, f, X.d_janitor, 0, y, 0, 0.62, 0.04, 0.44, 0.015);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    Cy(c, f, X.d_plasticGrey, s * 0.29, 0.12, t * 0.2, 0.016, 0.016, 0.8, 6);
    A(c, f, X.d_rubber, cylG(0.04, 0.04, 0.03, 8), s * 0.27, 0.04, t * 0.18, 0, 0, PI / 2);
  }
  for (let i = 0; i < 5; i++) {
    const a = -0.22 + i * 0.1, m = pick(c, [M.blue, M.green, X.d_janitor, M.red, M.white]);
    A(c, f, m, latheG('spray', [[0, 0], [0.035, 0], [0.035, 0.16], [0.015, 0.2], [0.015, 0.23]], 8), a, 0.94, -0.08 + jit(c, 0.04));
    if (i % 2) A(c, f, X.d_charcoal, boxG(0.02, 0.05, 0.06), a, 1.18, -0.06);
  }
  for (let i = 0; i < 4; i++) A(c, f, M.white, cylG(0.055, 0.055, 0.1, 8), -0.15 + (i % 2) * 0.12, 0.57 + Math.floor(i / 2) * 0.1, 0.05);
  // the bag hoop on one end, its bag half full
  Ca(c, f, X.d_plasticGrey, 0.48, 0.85, 0, 0.012, 0.36, 6);
  A(c, f, X.d_plasticGrey, torG(0.2, 0.012, 3, 14), 0.52, 0.86, 0, PI / 2, 0, 0);
  A(c, f, M.black, cylG(0.17, 0.19, 0.74, 10), 0.52, 0.48, 0, 0, 0, 0, [1, 1, 0.95]);
  // the bucket and the mop, the other end
  const ba = -0.55;
  R(c, f, M.yellow, ba, 0.2, 0, 0.36, 0.3, 0.32, 0.04);
  B(c, f, U.murk, ba - 0.15, 0.3, -0.13, ba + 0.15, 0.302, 0.13);
  R(c, f, X.d_charcoal, ba + 0.1, 0.44, 0, 0.12, 0.2, 0.26, 0.02);
  c.K.rod(X.d_steel, V(...atY(f, ba - 0.05, 0.1, 0)), V(...atY(f, ba - 0.2, 1.4, 0.08)), 0.012, 5);
  A(c, f, X.d_plastic, cylG(0.05, 0.09, 0.2, 7), ba - 0.05, 0.2, 0);
  col(c, f, -0.75, -0.24, 0.74, 0.24, 0, 1.2, SURF.metal);
}
/** a flatbed trolley at (x, z) turned `yaw`: steel deck on castors, a push handle; load 'boxes' | 'crates' | 'none' */
export function platformTrolley(c, x, z, yaw = 0, { load = 'boxes', tipped = false } = {}) {
  const { X, M } = c;
  const g = tipped ? grp(c, x, 0.32, z, yaw, 0, PI / 2 - 0.05) : grp(c, x, 0, z, yaw);
  g(X.d_steel, rbox(0.95, 0.04, 0.6, 0.01), 0, 0.2, 0);
  g(X.d_rubber, boxG(0.97, 0.02, 0.62), 0, 0.225, 0);
  for (const [s, t] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g(X.d_charcoal, boxG(0.05, 0.08, 0.05), s * 0.4, 0.14, t * 0.24);
    g(X.d_rubber, cylG(0.065, 0.065, 0.04, 10), s * 0.4, 0.065, t * 0.24, 0, 0, PI / 2);
  }
  for (const t of [-1, 1]) g(X.d_charcoal, cylG(0.014, 0.014, 0.82, 6), -0.46, 0.62, t * 0.26);
  g(X.d_charcoal, cylG(0.016, 0.016, 0.56, 6), -0.46, 1.02, 0, PI / 2);
  if (!tipped && load === 'boxes') {
    for (let i = 0; i < 3; i++) g(M.card, rbox(0.4 + jit(c, 0.05), 0.3, 0.36, 0.01), (i % 2 ? 0.2 : -0.18) + jit(c, 0.03), 0.39 + (i > 1 ? 0.3 : 0), jit(c, 0.05), 0, jit(c, 0.2), 0);
    g(X.d_janitor, boxG(0.05, 0.31, 0.37), 0.2, 0.39, 0, 0, 0, 0);
  } else if (!tipped && load === 'crates') {
    for (let i = 0; i < 2; i++) g(M.crate, rbox(0.42, 0.34, 0.5, 0.02), -0.2 + i * 0.44, 0.41, 0);
  }
  const sw = Math.abs(Math.sin(yaw)) > 0.7; // (turned across: the long side along z)
  const hx = tipped ? 0.6 : sw ? 0.35 : 0.55, hz = tipped ? 0.6 : sw ? 0.55 : 0.35;
  c.col(x - hx, 0, z - hz, x + hx, tipped ? 0.65 : 0.9, z + hz, SURF.metal);
}
/** a caged bulkhead lamp on the wall at centre height y (lit: a weak baked glow; broken: lens gone, dark) */
export function bulkheadLight(c, x, y, z, face, { lit = true, broken = false } = {}) {
  const { X, M, G } = c;
  const f = fr(x, z, face);
  R(c, f, X.d_charcoal, 0, y, 0.03, 0.3, 0.18, 0.06, 0.02);
  if (!broken) A(c, f, lit ? G.d_bulb ?? M.white : X.d_plastic, sphG(0.08, 10, 6), 0, y, 0.06, 0, 0, 0, [1.4, 0.8, 0.45]);
  else Cb(c, f, M.dark, 0, y, 0.065, 0.03, 0.02, 8);
  for (let i = -1; i <= 1; i++) A(c, f, X.d_charcoal, torG(0.11, 0.006, 3, 10, PI), i * 0.05, y, 0.06, 0, PI / 2 + (broken && i > 0 ? 0.4 : 0), PI / 2, [1, 0.75, 1]);
  A(c, f, X.d_charcoal, torG(0.12, 0.007, 3, 14), 0, y, 0.06, 0, 0, 0, [1.25, 0.8, 1]);
  if (lit && !broken) c.light(...atY(f, 0, y, 0.35), 0.35, 1.6, [1.0, 0.86, 0.62], null, 3.6);
}
/** a steel distribution board on the wall at centre height y: conduits up from it, a 400 V warning (open: door ajar, breakers, one tripped) */
export function electricalBox(c, x, y, z, face, { w = 0.5, h = 0.7, open = false } = {}) {
  const { X, M, U } = c;
  const f = fr(x, z, face);
  const d = 0.2;
  B(c, f, M.grey, -w / 2, y - h / 2, 0.01, w / 2, y + h / 2, d);
  for (const s of [-0.15, 0, 0.15]) Cy(c, f, X.d_steel, s * w, y + h / 2, 0.08, 0.022, 0.022, 2.9 - y - h / 2, 8);
  if (open) {
    B(c, f, M.dark, -w / 2 + 0.03, y - h / 2 + 0.03, d, w / 2 - 0.03, y + h / 2 - 0.03, d + 0.001);
    for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) Cu(c, f, i === 4 && r === 1 ? M.red : M.black, -w / 2 + 0.08 + i * ((w - 0.16) / 5), y + 0.18 - r * 0.18, d + 0.01, 0.03, 0.08, 0.02);
    const [hx, hz] = at(f, -w / 2, d);
    c.K.add(M.grey, boxG(w, h, 0.02).clone().translate(w / 2, 0, 0.01), hx, y, hz, [0, f.yaw - 1.9, 0]);
  } else {
    B(c, f, M.grey, -w / 2 + 0.01, y - h / 2 + 0.01, d, w / 2 - 0.01, y + h / 2 - 0.01, d + 0.012);
    Cu(c, f, X.d_charcoal, w / 2 - 0.06, y, d + 0.02, 0.03, 0.1, 0.02);
    lbl(c, f, 'DANGER · 400 V', 0, y + h / 2 - 0.1, d + 0.012, w * 0.7, 0.09, { bg: '#e0b31b', fg: '#16181a', font: 'bold 40px Arial' });
  }
  Cu(c, f, U.ledG, -w / 2 + 0.05, y - h / 2 + 0.05, d + 0.013, 0.012, 0.012, 0.004);
  col(c, f, -w / 2, 0, w / 2, d + 0.02, 0, y + h / 2, SURF.metal);
}

// ---------------------------------------------------------------- office fittings (whole units)
/**
 * A coffee counter against the wall at (x, z) (back on the wall line) facing `face`: base cupboards, a laminate
 * worktop with a small sink, the coffee machine, a microwave, the kettle, mugs; wall cupboards over it (one ajar)
 */
export function coffeeCounter(c, x, z, face, { w = 1.8, micro = true } = {}) {
  const { X, M } = c;
  const f = fr(x, z, face);
  const d = 0.6, T = 0.9, b0 = 0.03;
  B(c, f, X.d_plastic, -w / 2, 0.1, b0, w / 2, T - 0.04, b0 + d - 0.02);
  B(c, f, X.d_charcoal, -w / 2 + 0.02, 0, b0, w / 2 - 0.02, 0.1, b0 + d - 0.07);
  const n = Math.max(1, Math.round(w / 0.6));
  for (let i = 0; i < n; i++) {
    const a0 = -w / 2 + (w * i) / n, a1 = a0 + w / n;
    B(c, f, X.d_plastic, a0 + 0.006, 0.11, b0 + d - 0.02, a1 - 0.006, T - 0.05, b0 + d);
    B(c, f, X.d_steel, a1 - 0.06, 0.62, b0 + d, a1 - 0.045, 0.8, b0 + d + 0.02);
  }
  B(c, f, X.d_ash, -w / 2, T - 0.04, b0, w / 2, T, b0 + d + 0.02);
  // the sink and its tap at the left end
  B(c, f, X.d_steel, -w / 2 + 0.12, T, b0 + 0.12, -w / 2 + 0.55, T + 0.003, b0 + 0.5);
  B(c, f, M.dark, -w / 2 + 0.15, T + 0.003, b0 + 0.15, -w / 2 + 0.52, T + 0.004, b0 + 0.47);
  const [tx, tz] = at(f, -w / 2 + 0.335, b0 + 0.05);
  c.K.cyl(X.d_chrome, tx, T, tz, 0.018, 0.015, 0.28, 8);
  A(c, f, X.d_chrome, torG(0.09, 0.012, 4, 8, PI), -w / 2 + 0.335, T + 0.28, b0 + 0.14, 0, PI / 2, 0);
  if (micro) Fac.microwave(c, ...atY(f, w / 2 - 0.3, T, b0 + 0.26), face, { open: c.rnd() < 0.5 });
  Fac.coffeeMachine(c, ...atY(f, micro ? w / 2 - 0.8 : w / 2 - 0.3, T, b0 + 0.24), face);
  Fac.kettle(c, ...atY(f, -0.2, T, b0 + 0.28), f.yaw);
  for (let i = 0; i < 3; i++) Fac.mug(c, ...atY(f, -0.3 + i * 0.1 + jit(c, 0.02), T, b0 + 0.45), null, c.rnd() * 6);
  // the wall cupboards, the second one left open
  B(c, f, X.d_plastic, -w / 2, 1.5, b0, w / 2, 2.2, b0 + 0.33);
  for (let i = 0; i < n; i++) {
    const a0 = -w / 2 + (w * i) / n, a1 = a0 + w / n;
    if (i === 1) {
      const [hx, hz] = at(f, a1 - 0.006, b0 + 0.33);
      c.K.add(X.d_plastic, boxG(a1 - a0 - 0.012, 0.68, 0.02).clone().translate(-(a1 - a0 - 0.012) / 2, 0, 0.01), hx, 1.85, hz, [0, f.yaw + 1.7, 0]);
      for (let k = 0; k < 4; k++) Fac.mug(c, ...atY(f, a0 + 0.1 + k * 0.1, 1.52, b0 + 0.18), null, c.rnd() * 6);
      continue;
    }
    B(c, f, X.d_plastic, a0 + 0.006, 1.51, b0 + 0.33, a1 - 0.006, 2.19, b0 + 0.35);
    B(c, f, X.d_steel, a1 - 0.06, 1.55, b0 + 0.35, a1 - 0.045, 1.7, b0 + 0.37);
  }
  col(c, f, -w / 2, b0, w / 2, b0 + d + 0.02, 0, T, SURF.wood);
}
/** a printer on its own little cabinet at (x, z) facing `face`: reams of paper inside, a jam's worth of sheets on top */
export function printerCabinet(c, x, z, face) {
  const { X, M } = c;
  const f = fr(x, z, face);
  B(c, f, X.d_charcoal, -0.3, 0, -0.24, 0.3, 0.7, 0.24);
  B(c, f, M.black, -0.27, 0.05, 0.24, 0.27, 0.4, 0.245);
  for (let i = 0; i < 3; i++) B(c, f, X.d_paper, -0.22 + i * 0.01, 0.06 + i * 0.055, -0.15, 0.0 + i * 0.01, 0.11 + i * 0.055, 0.2);
  Fac.printer(c, x, 0.7, z, face);
  col(c, f, -0.3, -0.24, 0.3, 0.3, 0, 0.94, SURF.metal);
}

// ---------------------------------------------------------------- the rooms
/** a room title plate high on the wall (dark plate, the room's name, a coloured edge) */
function roomTitle(c, text, x, y, z, face, w = 2.2, col = '#2f7ad0') {
  c.label?.(text, x, y, z, face, w, 0.24, { bg: '#1b2127', fg: '#e8edf0', border: col, font: 'bold 56px Arial' });
}
/** a coat dropped on the floor at (x, z): a crumpled body and a sleeve */
function droppedCoat(c, x, z, yaw, mat) {
  c.K.add(mat, rbox(0.55, 0.06, 0.7, 0.03), x, 0.045, z, [0.03, yaw, 0.04, 'YXZ']);
  c.K.add(mat, rbox(0.12, 0.05, 0.5, 0.025), x + Math.cos(yaw) * 0.35, 0.025, z - Math.sin(yaw) * 0.35, [0, yaw + 0.5, 0, 'YXZ']);
}
/** a few shards of a dropped mug and the coffee round them */
function brokenMug(c, x, z) {
  for (let i = 0; i < 4; i++) c.K.add(c.X.d_ceramic, boxG(0.04 + c.rnd() * 0.03, 0.006, 0.03), x + jit(c, 0.15), 0.003, z + jit(c, 0.15), [0, c.rnd() * 6, 0]);
  c.K.add(c.X.d_ceramic, torG(0.022, 0.006, 3, 6, PI), x + 0.1, 0.006, z - 0.05, [PI / 2, 0.4, 0, 'YXZ']);
  c.decal?.('puddle', x, z, 0.8, c.rnd() * 6);
}

/**
 * Office 4-E-01, open plan: three cubicles down the west wall (boards, a calendar, a poster over them), a cluster of
 * four desks in the middle as cover between the corridor door and the doors to the quarters and office 2, a filing
 * cabinet and the printer on the north wall, the post pigeonholes, an extinguisher and the water cooler on the west
 * wall, the coffee corner (kitchenette, fridge, a plant) south-east, a whiteboard and the clock east. Left in a
 * hurry but not trashed: a chair over, a coat on the floor, a mug dropped in its coffee, monitors still on.
 */
export function dressOffice1(c, s, ctx) {
  const { X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // west wall: the cubicles
  [-9.12, -7.64, -6.16].forEach((z, i) => {
    Fac.officeDesk(c, x0 + 0.43, z, 'e', { w: 1.4, d: 0.75, pedestal: i % 2 ? 'l' : 'r', down: i === 1, on: i !== 2 });
    Fac.wallPlate(c, x0, 0.3, z + 0.45, 'e', 'socket');
    Fac.wallPlate(c, x0, 0.3, z + 0.3, 'e', 'data');
  });
  for (const z of [-8.38, -6.9, -5.42]) Fac.cubiclePartition(c, x0 + 0.03, z, x0 + 1.3, z, { mat: X.d_slate });
  Fac.noticeBoard(c, x0, -9.12, 'e', { y: 1.62, w: 1.0, h: 0.6, pages: [['TEAM MEETING', 'MON 09:00'], ['IT: change your', 'password', 'every 30 days!'], ['LOST: blue', 'NOX lanyard'], ['5-a-side', 'THURSDAYS']] });
  wallCalendar(c, x0, 1.66, -7.64, 'e', { month: 'SEPTEMBER 2026', first: 1, days: 30, crossed: 17, pic: 'NOX · LAKE LUCERNE', bg: '#4b7a9c' });
  Fac.poster(c, x0, 1.62, -6.16, 'e', { w: 0.5, h: 0.7, lines: ['NOX', 'SAFETY FIRST', '214 DAYS', 'without a', 'lost-time', 'incident'], bg: '#1d4f7a' });
  Fac.trashCan(c, x0 + 0.62, -8.7);
  Fac.trashCan(c, 13.5, -5.0, { tipped: true });
  // the post, the extinguisher, the water cooler, the coat stand by the door
  pigeonholes(c, x0, -4.75, 'e', { cols: 4, rows: 4, w: 1.0 });
  P.extinguisher(c, x0, -3.95, 'e');
  Fac.waterCooler(c, x0 + 0.24, -3.3, 'e');
  Fac.coatRack(c, 13.2, -3.35, { coats: 1 });
  droppedCoat(c, 13.65, -4.05, 0.7, X.d_slate);
  // north wall, west of the door to the quarters (its leaf may lie on the rest of that wall)
  Fac.filingCabinet(c, 14.0, z0 + 0.34, 's', { open: 2 });
  deskFan(c, 14.0, 1.32, z0 + 0.3, 0.2);
  printerCabinet(c, 14.6, z0 + 0.27, 's');
  wallCalendar(c, 16.2, 1.6, z0, 's', { month: 'ON CALL · SEPT', first: 1, days: 30, pic: 'ROTA', bg: '#7a3b2e', w: 0.3 });
  // the cluster in the middle, a screen down it
  const cx = 16.5, cz = -6.1, w = 1.4, d = 0.75;
  [[-0.7, -1], [0.7, -1], [-0.7, 1], [0.7, 1]].forEach(([u, sd], i) => Fac.officeDesk(c, cx + u, cz + (sd * d) / 2, sd < 0 ? 'n' : 's', { w, d, pedestal: u < 0 ? 'l' : 'r', down: i === 2, on: i !== 1 }));
  Fac.cubiclePartition(c, cx - w, cz, cx + w, cz, { y0: 0.74, y1: 1.28, mat: X.d_slate, collide: false });
  c.col(cx - w, 0.74, cz - 0.04, cx + w, 1.28, cz + 0.04, SURF.cardboard);
  Fac.trashCan(c, 18.3, -5.0);
  // the coffee corner
  coffeeCounter(c, 19.1, z1, 'n', { w: 1.75 });
  Fac.officeFridge(c, 17.88, z1 - 0.32, 'n', { h: 0.85 });
  Fac.kettle(c, 17.78, 0.85, z1 - 0.3, 0.4);
  Fac.plantPot(c, 17.25, z1 - 0.45, { size: 0.85, kind: 'tall' });
  evacPlan(c, 17.5, 1.6, z1, 'n', { here: [0.1, -0.4] });
  brokenMug(c, 18.7, -3.6);
  // east: the whiteboard and the clock (the door to office 2 is north of them)
  Fac.whiteboardPlan(c, x1, -3.9, 'w', { w: 1.6, lines: ['SPRINT 14 · SUBLEVEL 4 IT', '- badge readers B-wing: DONE', '- N corridor cams offline?!', '- K-7 data -> cold store', 'ask facilities re: the smell'] });
  Fac.wallClock(c, x1, 2.45, -3.9, 'w');
  Fac.wallPlate(c, x1, 0.3, -5.6, 'w');
  // by the corridor door: the light switch, the room's plate
  Fac.wallPlate(c, 13.72, 1.15, z1, 'n', 'switch');
  roomTitle(c, 'OFFICE 4-E-01 · RESEARCH ADMIN', x0 + 0.01, 2.5, -7.64, 'e', 2.4, '#2f7ad0');
  // papers off the desks, a trail of them toward the door
  for (let i = 0; i < 4; i++) c.decal?.('paper', 15.2 + rnd() * 2.6, -4.6 + jit(c, 0.3), 0.9, rnd() * 6);
  Fac.papers(c, 14.9, 0, -4.2, 0.5, 2);
}

/**
 * Office 4-E-02, open plan, where somebody made a stand: a desk thrown on its side as a barricade facing the door to
 * the quarters, spent cases behind it, bullet holes round that door, blood dragged toward office 1. A cluster of four
 * desks (chairs over, a monitor on the floor), the team lead's glass cubicle in the north-east (a pane shot out), and
 * in the south-east the copier, a jammed shredder and the files that were waiting for it, a toppled filing cabinet.
 */
export function dressOffice2(c, s, ctx) {
  const { X, M, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the team lead's glass cubicle
  Fac.glassOffice(c, [26.0, z0, x1, -6.0], { sides: 'ws', door: ['s', 26.15, 27.05], smash: ['w', -8.9, -7.8], name: 'J. MERCER · TEAM LEAD' });
  Fac.officeDesk(c, 27.15, -8.1, 'e', { w: 1.5, d: 0.75, pedestal: 'l', on: true, down: false });
  Fac.guestChair(c, 26.42, -7.9, PI / 2 + 0.35, { mat: X.d_slate });
  Fac.filingCabinet(c, 26.3, z0 + 0.34, 's');
  Fac.filingCabinet(c, 26.8, z0 + 0.34, 's', { open: 1 });
  Fac.plantPot(c, 27.95, z0 + 0.65, { dead: true, kind: 'tall' });
  Fac.coat(c, 27.45, 1.78, z0 + 0.1, 0, X.d_mustard);
  B(c, fr(27.45, z0, 's'), X.d_brass, -0.015, 1.76, 0, 0.015, 1.8, 0.1);
  Fac.framed(c, x1, 1.75, -9.25, 'w', { w: 0.46, h: 0.34, lines: ['EMPLOYEE OF THE QUARTER', 'Q2 2026', 'J. MERCER'] });
  Fac.whiteboardPlan(c, x1, -7.0, 'w', { w: 1.1, lines: ['1:1s THIS WEEK', 'Beck - Weds', 'Cho - CANCELLED', 'who has the', 'B-wing key??'] });
  // the cluster, a screen down its middle; one monitor knocked to the floor
  const cx = 23.6, cz = -5.5, w = 1.2, d = 0.75;
  [[-0.6, -1], [0.6, -1], [-0.6, 1], [0.6, 1]].forEach(([u, sd], i) => Fac.officeDesk(c, cx + u, cz + (sd * d) / 2, sd < 0 ? 'n' : 's', { w, d, pedestal: u < 0 ? 'l' : 'r', down: i === 0 || i === 3, on: i === 2, pc: i !== 1 }));
  Fac.cubiclePartition(c, cx - w, cz, cx + w, cz, { y0: 0.74, y1: 1.28, mat: X.d_teal, collide: false });
  c.col(cx - w, 0.74, cz - 0.04, cx + w, 1.28, cz + 0.04, SURF.cardboard);
  c.K.add(M.black, rbox(0.52, 0.035, 0.32, 0.01), 24.6, 0.018, -7.0, [0, 0.5, 0]);
  c.decal?.('glass', 24.5, -7.05, 0.7, rnd() * 6);
  Fac.trashCan(c, 22.15, -4.55, { tipped: true });
  // the barricade facing the door to the quarters, the fight round it
  tippedDesk(c, 23.2, -8.2, 'n', { w: 1.4, debris: false });
  A(c, fr(21.75, -8.85, 0.5), M.grey, boxG(0.38, 0.19, 0.5), 0, 0.095, 0); // (its drawer, flung off)
  casings(c, 23.3, -7.6, 14, 0.45);
  for (const [x, y] of [[21.3, 1.25], [21.6, 2.05], [24.5, 1.6], [24.9, 1.05], [25.3, 2.2], [22.6, 2.55]]) c.wallDecal?.('bullet', x, y, z0, 's', 0.16, 0.16);
  c.decal?.('blood', 23.7, -7.45, 0.9, rnd() * 6);
  c.decal?.('bloodDrag', 22.3, -7.15, 1.6, PI / 2 + 0.15);
  c.decal?.('blood', 21.2, -7.0, 0.6, rnd() * 6);
  droppedCoat(c, 21.6, -5.5, 2.1, X.d_mustard);
  // the west wall south of the door to office 1: the water cooler leaking, a notice board, the extinguisher
  Fac.waterCooler(c, x0 + 0.24, -3.0, 'e');
  c.decal?.('puddle', 21.25, -3.1, 1.0, rnd() * 6);
  Fac.noticeBoard(c, x0, -3.95, 'e', { y: 1.5, w: 0.9, h: 0.6, pages: [['DATA PROTECTION', 'lock your screen'], ['K-7 TRIAL', 'case files', 'room 4-E-02'], ['BAKE SALE FRI']] });
  P.extinguisher(c, x0, -4.75, 'e');
  Fac.wallPhone(c, 21.1, 1.45, z1, 'n', { off: true, number: 'SECURITY  2200' });
  // the south-east: copier, the shredder and its backlog, a filing cabinet pulled over, the recycling
  Fac.copier(c, 28.15, -5.3, 'w', { broken: true });
  paperShredder(c, 28.18, -3.9, 'w', { jam: true });
  archiveBoxes(c, 28.2, -2.8, 'w', { n: 2, tag: 'K-7 CASE FILES' });
  Fac.filingCabinet(c, 27.0, -3.6, 'w', { down: true });
  Fac.recycleBin(c, 26.75, z1 - 0.26, 'n');
  Fac.wallClock(c, x1, 2.4, -4.3, 'w');
  Fac.wallPlate(c, x1, 0.3, -3.3, 'w');
  // papers everywhere, the room's plate inside over the corridor door
  for (let i = 0; i < 7; i++) c.decal?.('paper', 21.2 + rnd() * 6.4, -7.5 + rnd() * 4.6, 0.8 + rnd() * 0.5, rnd() * 6);
  for (let i = 0; i < 4; i++) Fac.papers(c, 21.4 + rnd() * 4.4, 0, -7.2 + rnd() * 3.5, rnd() * 6, 1);
  wallCalendar(c, 25.2, 1.6, z0, 's', { month: 'SEPTEMBER 2026', first: 1, days: 30, crossed: 19, pic: 'NOX · ALETSCH', bg: '#5d7f9a', w: 0.3 });
  roomTitle(c, 'OFFICE 4-E-02 · CLINICAL DATA', 23.75, 2.62, z1 - 0.01, 'n', 2.2, '#2f7ad0');
  Fac.wallPlate(c, 22.72, 1.15, z1, 'n', 'switch');
}

/**
 * Conference 4-E-05, a meeting broken off: the long oak table with ten chairs (pushed back, two over, a jacket left on
 * one), notepads, cups and a laptop still on, the projector throwing the last slide onto the screen on the east wall;
 * the evacuation plan scrawled on the whiteboard west; catering on the credenza north; the in-house broadcast on the TV
 * over the AV cabinet and the flip chart in the south-east; a coat stand and plants in the corners.
 */
export function dressConf(c, s, ctx) {
  const { X, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  const spots = boardTable(c, [31.8, -7.9, 38.0, -6.5], { seats: 5 });
  spots.push({ x: 31.35, z: -7.2, yaw: PI / 2 });
  spots.forEach((p, i) => {
    const back = rnd() * 0.35, k = (rnd() - 0.5) * 0.7;
    const x = p.x - Math.sin(p.yaw) * back, z = p.z - Math.cos(p.yaw) * back;
    const down = i === 3 || i === 8;
    Fac.officeChair(c, x, z, p.yaw + k, { down, mat: i % 4 === 1 ? X.d_slate : X.d_teal });
    if (i === 6) Fac.coat(c, x - Math.sin(p.yaw + k) * 0.36, 1.1, z - Math.cos(p.yaw + k) * 0.36, p.yaw + k, X.d_mustard); // a jacket left on its chair
  });
  speakerPhone(c, 35.9, 0.77, -7.2, 0.4, { cx: 35.1, cz: -7.2 });
  Fac.projector(c, 37.3, 0.77, -7.2, 'e', { on: true });
  // the screen and the last slide on it
  Fac.projectorScreen(c, x1, -7.2, 'w', { w: 2.6, top: 2.95, drop: 1.95 });
  lbl(c, fr(x1, -7.2, 'w'), '', 0, 1.82, 0.075, 2.44, 1.5, { lines: ['PROJECT K-7 · Q3 REVIEW', 'subjects enrolled: 41 · active: 12', 'containment incidents: 3  (+2)', 'serum titre: falling after passage 3', 'budget: +18 % over plan', 'NEXT: sublevel 5, phase 2'], bg: '#eef2f6', fg: '#14304f', font: 'bold 40px Arial', align: 'left' });
  c.light(x1 - 0.6, 1.8, -7.2, 0.3, 1.6, [0.86, 0.9, 1.0], null, 3.2);
  // west: the whiteboard and the clock over it
  Fac.whiteboardPlan(c, x0, -7.2, 'e', { w: 2.4, lines: ['IF THE ALARM GOES (again):', '1. labs -> W ring, blast doors', '2. offices -> E ring', '3. NOBODY into the N corridor', '4. K-7 stocks: Dr. Hale ONLY', 'muster: atrium. Do NOT wait.'], fg: '#a01818' });
  Fac.wallClock(c, x0, 2.62, -7.2, 'e');
  Fac.wallPlate(c, x0, 0.3, -9.0, 'e');
  Fac.coatRack(c, 29.45, -11.05, { coats: 1 });
  Fac.plantPot(c, 29.45, z1 - 0.45, { kind: 'leafy', size: 1 });
  // north: the credenza with the catering, pictures of the campus over it
  sideboard(c, 37.4, z0, 's', { w: 2.4 });
  Fac.framed(c, 36.75, 1.75, z0, 's', { w: 0.7, h: 0.45, lines: ['NOX BIOSYSTEMS', 'campus Zug · 2019'], bg: '#2b4a63', fg: '#e9eef2' });
  Fac.framed(c, 38.15, 1.75, z0, 's', { w: 0.7, h: 0.45, lines: ['SUBLEVEL 4', 'opening day'], bg: '#5a4b3a', fg: '#f1e6d2' });
  roomTitle(c, 'CONFERENCE 4-E-05', 37.4, 2.6, z0 + 0.01, 's', 2.0, '#2f7ad0');
  Fac.plantPot(c, 39.55, z0 + 0.45, { kind: 'tall', size: 1.1 });
  Fac.wallPlate(c, 35.6, 0.3, z0, 's');
  // south-east: the AV cabinet and the broadcast, the flip chart
  avCabinet(c, 38.6, z1, 'n', { w: 1.2, tvY: 1.62, tvW: 1.3, tvLines: ['NOX INTERNAL BROADCAST', 'CONTAINMENT IN PROGRESS', 'REMAIN IN YOUR SECTION', 'AWAIT INSTRUCTIONS'] });
  flipChart(c, 39.35, -4.6, 'w', { lines: ['SUBLEVEL 5 ·', 'PHASE 2', '- 12 more cells', '- 2nd incinerator', '- budget ??', 'ASK THE BOARD'] });
  Fac.wallPlate(c, 37.25, 1.15, z1, 'n', 'switch');
  // left as it was: papers off the table, a cup dropped, footprints out
  for (let i = 0; i < 4; i++) c.decal?.('paper', 32.5 + rnd() * 4.5, -5.2 + jit(c, 0.4), 0.8, rnd() * 6);
  brokenMug(c, 33.2, -5.3);
  c.decal?.('footprints', 34.0, -4.2, 1.6, PI);
  Fac.papers(c, 31.9, 0, -9.4, 1.2, 3);
}

/**
 * The director's office, left by a man in a hurry: the walnut desk facing the door, his leather chair pushed back, two
 * visitors' chairs (one over); behind him a credenza of photos and an award under a backlit skyline of Zürich between
 * bookshelves; the wall safe east hanging open, emptied, the painting that hid it leaning below; the bar, a molecule
 * on a plinth, the fish tank still lit (the fish not); a leather sofa corner west with an open briefcase of cash on the
 * coffee table, a standing lamp, diplomas; a globe by the blast door to operations (its way kept clear).
 */
export function dressDirector(c, s, ctx) {
  const { X, U, rnd } = c;
  const { x0, z0, x1, z1 } = s;
  // the desk, the chairs
  Fac.rug(c, 30.2, -19.4, 4.0, 3.2);
  Fac.bigDesk(c, 30.2, -19.6, 'n', { w: 2.2, d: 1.0, name: 'DR. A. VOSS · DIRECTOR' });
  execChair(c, 30.35, -20.85, 0.4);
  Fac.guestChair(c, 29.55, -18.5, PI + 0.15, { mat: X.d_oxblood, frame: X.d_brass });
  Fac.guestChair(c, 31.05, -18.15, PI - 0.9, { mat: X.d_oxblood, frame: X.d_brass }); // (shoved back as he got up)
  // the north wall: shelves, the credenza and the skyline over it
  Fac.bookshelf(c, 27.95, z0 + 0.03, 's', { w: 0.9, h: 2.1, mat: X.d_walnut, fill: 'books' });
  Fac.bookshelf(c, 32.45, z0 + 0.03, 's', { w: 0.9, h: 2.1, mat: X.d_walnut, fill: 'mixed' });
  sideboard(c, 30.2, z0, 's', { w: 2.0, catering: false, mat: X.d_walnut });
  const T = 0.78, bz = z0 + 0.27;
  photoFrame(c, 29.45, T, bz, 0.25, { w: 0.18, h: 0.24 });
  photoFrame(c, 29.75, T, bz + 0.05, -0.15);
  photoFrame(c, 30.55, T, bz + 0.08, 0, { down: true });
  award(c, 30.95, T, bz, 0.1);
  for (let i = 0; i < 9; i++) c.K.add(pick(c, [X.d_oxblood, X.d_walnut, X.d_slate, X.d_teal]), boxG(0.04, 0.24 + rnd() * 0.05, 0.17), 29.92 + i * 0.045, T + 0.125, bz - 0.04);
  for (const x of [29.88, 30.33]) c.K.add(X.d_brass, boxG(0.015, 0.16, 0.12), x, T + 0.08, bz - 0.04);
  Fac.skylineBox(c, 30.2, z0, 's', { w: 2.4, h: 1.05, y: 1.85, caption: 'ZÜRICH · FROM THE BOARD ROOM' });
  Fac.plantPot(c, 33.6, z0 + 0.4, { kind: 'tall', size: 1.1 });
  globe(c, 26.35, -21.65);
  // the east wall: the fish tank, the safe and its painting, the bar, the molecule
  aquarium(c, x1, -21.2, 'w', { w: 1.2 });
  Fac.wallSafe(c, x1, 1.0, -19.2, 'w', { open: 1.5 });
  pictureLeaning(c, x1, -18.05, 'w', { w: 0.8, h: 0.6 });
  c.wallDecal?.('stain', x1, 1.3, -19.2, 'w', 0.9, 0.75); // (the clean patch where the painting hung, dirt round it)
  Fac.bar(c, x1 - 0.03, -15.6, 'w', { w: 1.4 });
  c.decal?.('glass', 32.9, -15.3, 0.6, rnd() * 6);
  c.K.add(U.glass, cylG(0.032, 0.036, 0.09, 8, true), 32.95, 0.035, -15.4, [PI / 2, 0.7, 0, 'YXZ']);
  plinth(c, 33.55, -13.65, { h: 1.0 });
  Fac.moleculeModel(c, 33.55, 1.0, -13.65, { yaw: -PI / 2 });
  // the sofa corner west, its rug, the lamp, the diplomas over it
  Fac.rug(c, 27.1, -14.6, 3.0, 2.6);
  Fac.sofa(c, x0 + 0.46, -14.6, 'e', { w: 2.0, mat: X.d_leatherBlack });
  Fac.coffeeTable(c, 27.2, -14.6, 'e', { w: 1.1, d: 0.6 });
  briefcase(c, 27.2, 0.44, -14.8, PI / 2 + 0.2, { open: true, cash: true });
  Fac.armchair(c, 28.35, -15.55, -PI / 2 + 0.5, { mat: X.d_oxblood });
  Fac.armchair(c, 28.35, -13.65, -PI / 2 - 0.5, { mat: X.d_oxblood });
  floorLamp(c, 26.0, -16.15);
  Fac.framed(c, x0, 1.95, -14.05, 'e', { w: 0.5, h: 0.38, lines: ['DOCTOR OF PHILOSOPHY', 'Molecular Virology', 'ETH ZÜRICH · 1998'] });
  Fac.framed(c, x0, 1.95, -15.15, 'e', { w: 0.6, h: 0.42, lines: ['NOX', 'BIOSYSTEMS', 'founded 2009'], bg: '#10243a', fg: '#7fd0ff', font: 'bold 40px Arial' });
  Fac.framed(c, x0, 1.92, -16.2, 'e', { w: 0.42, h: 0.32, frame: X.d_brass });
  Fac.wallClock(c, x0, 2.55, -14.6, 'e');
  // by the door: the switch, the plate over it; papers from the safe and the desk
  Fac.wallPlate(c, 30.7, 1.15, z1, 'n', 'switch');
  Fac.wallPlate(c, 28.0, 0.3, z1, 'n');
  roomTitle(c, 'DIRECTOR · DR. A. VOSS', 32.0, 2.74, z1 - 0.01, 'n', 1.8, '#b8964e');
  for (let i = 0; i < 3; i++) c.decal?.('paper', 31.8 + rnd() * 1.5, -19.8 + rnd() * 2.2, 0.8, rnd() * 6);
}

// ---------------------------------------------------------------- the corridors
// how far along each corridor its fittings may go (clear of the blast doors / arches at the ends and of the ring's
// corners, which belong to the turn)
const CORRIDOR_SPAN = { w1: [-38.5, -12], e1: [12, 38.5], n1: [-34.5, -12], w2: [-35, 0.5], e2: [-35, 0.5], n2: [-39, 39] };
/**
 * The corridor's walls as a placing kit: put(side, u, half, tall, fn) calls fn(x, z, face, nx, nz) with the point on
 * that wall's line at `u` along the corridor, the face into the corridor and its inward normal, unless the item (u ±
 * half) comes within 1.5 m (tall: anything standing out from the wall) or 0.45 m (flat) of a doorway on that wall, or
 * beyond the corridor's span. Sides: 'n' / 's' for corridors along x, 'w' / 'e' for those along z.
 */
function corridorKit(c, s, ctx) {
  const along = s.x1 - s.x0 > s.z1 - s.z0;
  const WALL = along ? { n: [s.z0, 's', 0, 1], s: [s.z1, 'n', 0, -1] } : { w: [s.x0, 'e', 1, 0], e: [s.x1, 'w', -1, 0] };
  const doors = (ctx.doorsOf?.(s.id) ?? ctx.doors ?? []).map((d) => ({ ...d, ax: d.x1 - d.x0 > d.z1 - d.z0 }));
  const spans = {};
  for (const side of Object.keys(WALL)) {
    const v = WALL[side][0];
    spans[side] = doors
      .filter((d) => (along ? d.ax && Math.abs((side === 'n' ? d.z1 : d.z0) - v) < 0.02 : !d.ax && Math.abs((side === 'w' ? d.x1 : d.x0) - v) < 0.02))
      .map((d) => (along ? [d.x0, d.x1] : [d.z0, d.z1]));
  }
  const lim = CORRIDOR_SPAN[s.id] ?? (along ? [s.x0 + 1.5, s.x1 - 1.5] : [s.z0 + 1.5, s.z1 - 1.5]);
  const put = (side, u, half, tall, fn) => {
    const m = tall ? 1.5 : 0.45;
    const ok = u - half >= lim[0] && u + half <= lim[1] && spans[side].every(([a, b]) => u + half <= a - m || u - half >= b + m);
    if (!ok) {
      ctx.skipped?.push(`${s.id} ${side} ${u}`);
      return false;
    }
    const [v, face, nx, nz] = WALL[side];
    fn(along ? u : v, along ? v : u, face, nx, nz);
    return true;
  };
  /** a door's room plate on the wall beside it (flat), `u` its centre */
  const plate = (side, u, num, name) => put(side, u, 0.17, false, (x, z, face) => doorPlate(c, x, 1.55, z, face, num, name));
  return { along, put, plate };
}
/** a painted stencil on a corridor wall (yellow on the ring's concrete, red / blue on the white of the others) */
function stencil(c, text, x, y, z, face, w, ring, col = '#b3231b') {
  c.label?.(text, x, y, z, face, w, 0.3, ring ? { bg: '#5b5d5b', fg: '#e0b31b', font: 'bold 64px Courier New, monospace' } : { bg: '#e8eae6', fg: col, font: 'bold 64px Arial' });
}

/**
 * A corridor's wall fittings (call once per corridor space: w1 e1 n1 w2 e2 n2): extinguishers, hose cabinets,
 * first-aid and AED boxes, alarms, phones, notice boards, evacuation plans, exit signs, room plates by the doors,
 * vents, cameras; benches, vending machines, trolleys, a gurney left behind; in the ring (round 10): bulkhead lamps
 * (some dead), distribution boards, hose reels, crates, stencils, claw marks. The middle 2.4 m stays clear, and
 * nothing tall stands within 1.5 m of a doorway.
 */
export function dressCorridor(c, s, ctx) {
  const k = corridorKit(c, s, ctx);
  if (s.id === 'w1') corridorW1(c, s, k);
  else if (s.id === 'e1') corridorE1(c, s, k);
  else if (s.id === 'n1') corridorN1(c, s, k);
  else if (s.id === 'w2' || s.id === 'e2') corridorRingSide(c, s, k);
  else if (s.id === 'n2') corridorRingNorth(c, s, k);
}
/** w1, the labs' corridor: clinical; a gurney left with its bag outside the stores, blood dragged off toward cryo */
function corridorW1(c, s, { put, plate }) {
  const { rnd } = c;
  // north wall: labs 4-A, 4-B, the decon airlock
  put('n', -38.0, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.75, z, f, 0.6));
  put('n', -37.3, 0.06, false, (x, z, f) => fireAlarm(c, x, 1.4, z, f));
  put('n', -37.0, 0.21, false, (x, z, f) => exitSign(c, x, 2.45, z, f, { arrow: '→' }));
  put('n', -35.6, 0.35, true, (x, z, f) => hoseCabinet(c, x, z, f));
  put('n', -34.6, 1.2, false, (x, z, f) => stencil(c, 'SUBLEVEL 4 · WEST · LABORATORIES', x, 2.35, z, f, 2.4, false, '#b3231b'));
  put('n', -26.2, 0.3, false, (x, z, f) => L.wallVent(c, x, 0.35, z, f, 0.6, 0.3));
  put('n', -24.75, 0.81, true, (x, z, f) => corridorBench(c, x, z, f, { gone: rnd() < 0.5 ? 1 : -1 }));
  put('n', -24.75, 0.6, false, (x, z, f) => Fac.noticeBoard(c, x, z, f, { y: 1.55, w: 1.2, h: 0.7, pages: [['FIRE DRILL', 'THURSDAY 10:00'], ['HOOD 2 SASH', 'STICKS!', 'do not use'], ['BSL-3 induction', 'sign up at 4-B'], ['LOST: pipette', 'P200, blue']] }));
  put('n', -23.55, 0.16, true, (x, z, f, nx, nz) => Fac.trashCan(c, x + nx * 0.2, z + nz * 0.2));
  put('n', -16.0, 0.2, true, (x, z, f) => drinkingFountain(c, x, z, f));
  plate('n', -31.65, 'LAB 4-A', 'CHEMISTRY & PREP');
  plate('n', -21.65, 'LAB 4-B', 'BSL-3 · CULTURE');
  plate('n', -14.12, 'DECON 4-W-03', 'AIRLOCK');
  // south wall: cryo, the stores
  put('s', -36.8, 0.2, true, (x, z, f) => aedCabinet(c, x, 1.45, z, f));
  put('s', -35.3, 0.32, false, (x, z, f) => evacPlan(c, x, 1.55, z, f, { here: [-0.5, 0] }));
  put('s', -34.2, 0.1, true, (x, z, f) => P.extinguisher(c, x, z, f));
  put('s', -33.2, 0.2, true, (x, z, f) => L.firstAidBox(c, x, 1.45, z, f));
  put('s', -23.5, 1.0, true, (x, z, f, nx, nz) => P.gurney(c, x + nx * 0.36, z + nz * 0.36, PI / 2 + 0.04, { bag: true }));
  put('s', -21.3, 0.48, true, (x, z, f, nx, nz) => P.vending(c, x + nx * 0.4, z + nz * 0.4, f, true));
  put('s', -14.6, 0.2, true, (x, z, f, nx, nz) => Fac.wetFloorSign(c, x + nx * 0.45, z + nz * 0.45, 0.3));
  put('s', -13.5, 0.25, true, (x, z, f, nx, nz) => Fac.mopBucket(c, x + nx * 0.3, z + nz * 0.3, 0.4));
  put('s', -12.6, 0.07, false, (x, z, f) => Fac.wallPhone(c, x, 1.45, z, f));
  plate('s', -30.65, 'CRYO 4-W-05', 'COLD STORAGE');
  plate('s', -19.65, 'STORES 4-W-06', 'GENERAL SUPPLIES');
  // the floor: blood from under the gurney toward cryo, the mopped patch, papers
  c.decal?.('blood', -23.2, 1.45, 0.7, rnd() * 6);
  c.decal?.('bloodDrag', -25.6, 1.15, 1.8, 0.25);
  c.decal?.('puddle', -14.0, 0.8, 1.3, 0.5);
  for (let i = 0; i < 3; i++) c.decal?.('paper', -32 + rnd() * 14, jit(c, 1.2), 0.8, rnd() * 6);
}
/** e1, the offices' corridor: the vending corner, a bench under the notices, the cafeteria's menu, the cleaner's cart */
function corridorE1(c, s, { put, plate }) {
  const { X, rnd } = c;
  // north wall: offices 1 and 2, the conference room
  put('n', 17.6, 0.48, true, (x, z, f, nx, nz) => P.vending(c, x + nx * 0.4, z + nz * 0.4, f, true));
  put('n', 18.65, 0.48, true, (x, z, f, nx, nz) => P.vending(c, x + nx * 0.4, z + nz * 0.4, f, false));
  put('n', 20.4, 0.55, true, (x, z, f, nx, nz) => Fac.recycleBin(c, x + nx * 0.25, z + nz * 0.25, f));
  put('n', 25.8, 0.3, false, (x, z, f) => L.wallVent(c, x, 0.35, z, f));
  put('n', 26.6, 0.2, true, (x, z, f, nx, nz) => Fac.plantPot(c, x + nx * 0.4, z + nz * 0.4, { kind: 'tall' }));
  put('n', 28.0, 0.81, true, (x, z, f) => corridorBench(c, x, z, f));
  put('n', 28.0, 0.7, false, (x, z, f) => Fac.noticeBoard(c, x, z, f, { y: 1.5, w: 1.4, h: 0.7, pages: [['ALL STAFF', 'town hall FRI', 'atrium 16:00'], ['CAR SHARE', 'Zug - Baar'], ['NEW: badge', 'readers on', 'every door'], ['flat to let', 'call Ines']] }));
  put('n', 28.0, 1.3, false, (x, z, f) => stencil(c, 'SUBLEVEL 4 · EAST · ADMINISTRATION', x, 2.45, z, f, 2.6, false, '#2f7ad0'));
  put('n', 29.0, 0.16, true, (x, z, f, nx, nz) => Fac.trashCan(c, x + nx * 0.2, z + nz * 0.2));
  put('n', 30.9, 0.35, true, (x, z, f) => hoseCabinet(c, x, z, f));
  put('n', 37.0, 0.2, true, (x, z, f) => aedCabinet(c, x, 1.45, z, f));
  put('n', 37.55, 0.21, false, (x, z, f) => exitSign(c, x, 2.5, z, f, { arrow: '←' }));
  put('n', 38.0, 0.06, false, (x, z, f) => fireAlarm(c, x, 1.4, z, f));
  put('n', 38.3, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.8, z, f, -0.6));
  plate('n', 13.35, 'OFFICE 4-E-01', 'RESEARCH ADMIN');
  plate('n', 22.35, 'OFFICE 4-E-02', 'CLINICAL DATA');
  plate('n', 32.35, 'CONF. 4-E-05', 'BOOK AT RECEPTION');
  // south wall: the cafeteria, the lockers
  put('s', 12.4, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.75, z, f, 0.6));
  put('s', 12.6, 0.32, false, (x, z, f) => evacPlan(c, x, 1.55, z, f, { here: [0.4, 0.1] }));
  put('s', 13.3, 0.2, true, (x, z, f) => drinkingFountain(c, x, z, f));
  put('s', 20.3, 0.5, false, (x, z, f) => Fac.noticeBoard(c, x, z, f, { y: 1.5, w: 1.0, h: 0.7, pages: [['CAFETERIA', 'open 07-19'], ['NO TRAYS', 'past this point'], ['5-a-side', 'tonight 19:00']] }));
  put('s', 21.2, 0.07, false, (x, z, f) => Fac.wallPhone(c, x, 1.45, z, f));
  put('s', 21.65, 0.1, true, (x, z, f) => P.extinguisher(c, x, z, f));
  put('s', 22.65, 0.25, false, (x, z, f) => Fac.poster(c, x, 1.6, z, f, { w: 0.5, h: 0.72, lines: ['TODAY', 'goulash', 'veg. lasagne', 'apple crumble', '- NOX catering'], bg: '#2a5a3a' }));
  put('s', 27.6, 0.25, true, (x, z, f, nx, nz) => Fac.chairStack(c, x + nx * 0.3, z + nz * 0.3, 0.1, 7, X.d_teal));
  put('s', 28.85, 0.6, true, (x, z, f, nx, nz) => platformTrolley(c, x + nx * 0.4, z + nz * 0.4, 0.04));
  put('s', 34.4, 0.2, true, (x, z, f, nx, nz) => Fac.wetFloorSign(c, x + nx * 0.5, z + nz * 0.5, 0.5));
  put('s', 35.6, 0.75, true, (x, z, f, nx, nz) => janitorCart(c, x + nx * 0.3, z + nz * 0.3, 0.03));
  put('s', 37.6, 0.2, true, (x, z, f) => L.firstAidBox(c, x, 1.45, z, f));
  plate('s', 15.35, 'CAFETERIA', '4-E-10');
  plate('s', 30.35, 'LOCKERS 4-E-12', 'STAFF ONLY');
  c.decal?.('puddle', 35.0, 0.7, 1.4, 0.4);
  for (let i = 0; i < 3; i++) c.decal?.('paper', 14 + rnd() * 22, jit(c, 1.2), 0.8, rnd() * 6);
}
/** n1, the north corridor (round 4): the research wing's, grimmer; a gurney with its bag, a hose run out to the specimen hall, a red beacon */
function corridorN1(c, s, { put, plate }) {
  const { X, rnd } = c;
  // west wall: the specimen hall's two doors
  put('w', -33.8, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.75, z, f, -0.5));
  put('w', -32.6, 0.3, true, (x, z, f, nx, nz) => P.crates(c, x + nx * 0.33, z + nz * 0.33, 0.6, 2));
  put('w', -31.0, 0.35, false, (x, z, f) => L.clawMarks(c, x, 1.35, z, f, { n: 4, len: 0.8 }));
  put('w', -23.0, 0.25, false, (x, z, f) => L.hazardPlacard(c, x, 1.65, z, f, 'bsl3', { w: 0.5 }));
  put('w', -22.0, 0.2, true, (x, z, f) => L.firstAidBox(c, x, 1.45, z, f));
  put('w', -14.5, 0.1, true, (x, z, f) => P.extinguisher(c, x, z, f));
  put('w', -13.5, 0.06, false, (x, z, f) => fireAlarm(c, x, 1.4, z, f));
  put('w', -12.8, 0.21, false, (x, z, f) => exitSign(c, x, 2.45, z, f, { arrow: '←' }));
  plate('w', -16.35, 'SPECIMEN HALL', '4-N-01');
  plate('w', -25.35, 'SPECIMEN HALL', '4-N-01 · B');
  // east wall: the server room
  put('e', -31.0, 1.0, true, (x, z, f, nx, nz) => P.gurney(c, x + nx * 0.36, z + nz * 0.36, 0.05, { bag: true }));
  put('e', -28.0, 1.2, false, (x, z, f) => stencil(c, 'NORTH WING · AUTHORIZED STAFF ONLY', x, 2.3, z, f, 2.4, false, '#b3231b'));
  put('e', -27.5, 0.1, true, (x, z, f) => L.warningBeacon(c, x, 2.62, z, f, { red: true }));
  const hosed = put('e', -25.0, 0.35, true, (x, z, f) => hoseCabinet(c, x, z, f, { open: true }));
  put('e', -22.4, 0.6, true, (x, z, f, nx, nz) => platformTrolley(c, x + nx * 0.4, z + nz * 0.4, PI / 2 + 0.03, { load: 'crates' }));
  put('e', -14.0, 0.25, true, (x, z, f) => electricalBox(c, x, 1.3, z, f));
  put('e', -12.8, 0.32, false, (x, z, f) => evacPlan(c, x, 1.55, z, f, { here: [0, 0.6] }));
  plate('e', -16.35, 'SERVER ROOM', '4-N-03');
  // the hose run out across the floor to the hall's second door, shots fired, blood
  if (hosed) {
    const pts = [[1.84, 1.05, -24.85], [1.72, 0.35, -24.78], [1.6, 0.04, -24.7], [0.8, 0.03, -24.9], [0.1, 0.03, -25.6], [-0.6, 0.03, -26.4], [-1.45, 0.03, -26.9]];
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V(x, y, z))), 24, 0.025, 5);
    const pa = tube.attributes.position;
    for (let i = 0; i < pa.count; i++) pa.setY(i, Math.max(pa.getY(i), 0.002)); // (lying flat where the curve dips)
    c.K.put(X.d_hose, tube);
    c.K.add(X.d_brass, cylG(0.024, 0.014, 0.2, 8), -1.55, 0.03, -27.0, [PI / 2, -0.9, 0, 'YXZ']);
  }
  casings(c, 0.6, -23.6, 12, 0.6);
  for (const [z, y] of [[-23.2, 1.3], [-23.9, 1.7], [-22.6, 1.05], [-24.4, 2.1], [-21.9, 1.5]]) c.wallDecal?.('bullet', s.x1, y, z, 'w', 0.16, 0.16);
  c.decal?.('bloodDrag', 0.6, -29.4, 1.8, 0.7);
  c.decal?.('blood', -0.9, -27.6, 0.8, rnd() * 6);
  for (let i = 0; i < 2; i++) c.decal?.('paper', jit(c, 1), -32 + rnd() * 18, 0.8, rnd() * 6);
}
/** w2 / e2, the ring's sides (round 10): half dark, grimy; lamps on the outer wall (some dead), boards, a hose reel, a body bag, claw marks */
function corridorRingSide(c, s, { put, plate }) {
  const { X, rnd } = c;
  const west = s.id === 'w2';
  const out = west ? 'w' : 'e', inn = west ? 'e' : 'w';
  // the outer wall
  [[-31, true], [-24, !west], [-17, false], [-6, true]].forEach(([u, lit]) => put(out, u, 0.15, false, (x, z, f) => bulkheadLight(c, x, 2.25, z, f, { lit, broken: !lit && rnd() < 0.7 })));
  put(out, -33.0, 0.25, true, (x, z, f, nx, nz) => P.crates(c, x + nx * 0.28, z + nz * 0.28, 0.5, west ? 2 : 3));
  put(out, -27.0, 0.3, true, (x, z, f) => L.hoseReel(c, x, 1.3, z, f));
  put(out, -19.5, 0.35, false, (x, z, f) => L.clawMarks(c, x, 1.3, z, f, { n: 4, len: 0.75, a: west ? 0.5 : -0.4 }));
  put(out, -13.0, 1.0, false, (x, z, f) => stencil(c, west ? 'RING W · SECTOR 7' : 'RING E · SECTOR 3', x, 2.0, z, f, 1.9, true));
  put(out, -10.0, 0.3, false, (x, z, f) => L.wallVent(c, x, 0.35, z, f));
  if (west) put(out, -8.0, 0.9, true, (x, z, f, nx, nz) => L.bodyBag(c, x + nx * 0.28, z + nz * 0.28, 0.02));
  else put(out, -8.0, 0.25, true, (x, z, f, nx, nz) => Fac.chairStack(c, x + nx * 0.27, z + nz * 0.27, PI / 2, 5, X.d_slate));
  put(out, -2.5, 0.25, true, (x, z, f) => electricalBox(c, x, 1.3, z, f, { open: !west }));
  if (!west) {
    put(out, -21.0, 0.1, true, (x, z, f) => L.warningBeacon(c, x, 2.5, z, f));
    put(out, -22.5, 0.25, true, (x, z, f, nx, nz) => Fac.mopBucket(c, x + nx * 0.3, z + nz * 0.3, 0.3));
    Fac.wetFloorSign(c, 42.3, -21.4, 1.1, { down: true });
  }
  // the inner wall: the way in from the start corridor, the morgue / the archive
  put(inn, -33.5, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.75, z, f, west ? -0.5 : 0.5));
  put(inn, -27.0, 0.25, true, (x, z, f) => electricalBox(c, x, 1.3, z, f));
  put(inn, -25.0, 0.1, true, (x, z, f) => P.extinguisher(c, x, z, f));
  put(inn, -24.2, 0.06, false, (x, z, f) => fireAlarm(c, x, 1.4, z, f));
  plate(inn, -19.35, west ? 'MORGUE' : 'ARCHIVE', west ? '4-R-07' : '4-R-08');
  put(inn, -16.0, 0.25, false, (x, z, f) => L.hazardPlacard(c, x, 1.6, z, f, west ? 'MORGUE · STAFF ONLY' : 'RECORDS · NO NAKED FLAMES', { w: 0.5 }));
  put(inn, -12.5, 0.3, false, (x, z, f) => L.wallVent(c, x, 0.35, z, f));
  put(inn, -10.0, 0.07, false, (x, z, f) => Fac.wallPhone(c, x, 1.45, z, f, { off: true }));
  put(inn, -6.0, 0.21, false, (x, z, f) => exitSign(c, x, 2.4, z, f, { arrow: west ? '→' : '←' }));
  // the floor: oil, a trail into the morgue / spent cases by the archive
  const cx = (s.x0 + s.x1) / 2;
  for (let i = 0; i < 3; i++) c.decal?.('oil', cx + jit(c, 1), -34 + rnd() * 32, 1.0 + rnd() * 0.6, rnd() * 6);
  if (west) c.decal?.('bloodDrag', cx + 0.6, -21.0, 1.8, PI / 2);
  else casings(c, cx - 0.4, -18.5, 10, 0.7);
}
/** n2, the ring's north side (round 10): 88 m of it; lamps (two dead), boards, hose reels, a body bag, sector stencils */
function corridorRingNorth(c, s, { put, plate }) {
  const { rnd } = c;
  // the outer (north) wall
  [[-34, true], [-21, false], [-7, true], [7, true], [21, false], [34, true]].forEach(([u, lit]) => put('n', u, 0.15, false, (x, z, f) => bulkheadLight(c, x, 2.25, z, f, { lit, broken: !lit })));
  put('n', -37.0, 0.25, true, (x, z, f, nx, nz) => P.crates(c, x + nx * 0.28, z + nz * 0.28, 0.5, 2));
  put('n', -30.0, 1.0, false, (x, z, f) => stencil(c, 'RING N · SECTOR 1', x, 2.0, z, f, 1.9, true));
  put('n', -26.0, 0.35, false, (x, z, f) => L.clawMarks(c, x, 1.25, z, f, { n: 5, len: 0.9, a: 0.3 }));
  put('n', -24.0, 0.3, true, (x, z, f) => L.hoseReel(c, x, 1.3, z, f));
  put('n', -15.5, 0.9, true, (x, z, f, nx, nz) => L.bodyBag(c, x + nx * 0.28, z + nz * 0.28, PI / 2 + 0.03));
  put('n', -10.0, 0.25, true, (x, z, f) => electricalBox(c, x, 1.3, z, f));
  put('n', -2.0, 0.3, false, (x, z, f) => L.wallVent(c, x, 0.35, z, f));
  put('n', 0.0, 1.0, false, (x, z, f) => stencil(c, 'RING N · SECTOR 2', x, 2.0, z, f, 1.9, true));
  put('n', 10.0, 0.25, true, (x, z, f, nx, nz) => Fac.mopBucket(c, x + nx * 0.3, z + nz * 0.3, 0.2));
  Fac.wetFloorSign(c, 11.0, -38.4, 1.0, { down: true });
  put('n', 16.0, 0.3, true, (x, z, f) => L.hoseReel(c, x, 1.3, z, f));
  put('n', 24.0, 0.3, false, (x, z, f) => L.wallVent(c, x, 0.35, z, f));
  put('n', 29.0, 0.25, true, (x, z, f) => electricalBox(c, x, 1.3, z, f, { open: true }));
  put('n', 30.6, 1.0, false, (x, z, f) => stencil(c, 'RING N · SECTOR 3', x, 2.0, z, f, 1.9, true));
  put('n', 37.5, 0.25, true, (x, z, f, nx, nz) => P.crates(c, x + nx * 0.28, z + nz * 0.28, 0.5, 1));
  // the inner (south) wall: security, the north corridor's blast door, maintenance
  put('s', -38.0, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.75, z, f, 0.5));
  put('s', -33.0, 0.1, true, (x, z, f) => P.extinguisher(c, x, z, f));
  put('s', -32.2, 0.06, false, (x, z, f) => fireAlarm(c, x, 1.4, z, f));
  plate('s', -27.35, 'SECURITY', '4-R-02');
  put('s', -18.0, 0.2, true, (x, z, f) => L.firstAidBox(c, x, 1.45, z, f));
  put('s', -12.0, 0.07, false, (x, z, f) => Fac.wallPhone(c, x, 1.45, z, f, { off: rnd() < 0.5 }));
  put('s', -5.0, 0.21, false, (x, z, f) => exitSign(c, x, 2.4, z, f, { arrow: '←' }));
  put('s', 5.0, 0.21, false, (x, z, f) => exitSign(c, x, 2.4, z, f, { arrow: '→' }));
  put('s', 12.0, 0.25, true, (x, z, f) => electricalBox(c, x, 1.3, z, f));
  put('s', 22.0, 0.06, true, (x, z, f) => L.cctvCam(c, x, 2.75, z, f, -0.5));
  plate('s', 28.65, 'MAINTENANCE', '4-R-04');
  put('s', 31.0, 0.25, false, (x, z, f) => L.hazardPlacard(c, x, 1.6, z, f, 'o2', { w: 0.5 }));
  put('s', 32.2, 0.1, true, (x, z, f) => P.extinguisher(c, x, z, f));
  // the floor
  for (let i = 0; i < 4; i++) c.decal?.('oil', -36 + rnd() * 72, -38.25 + jit(c, 0.8), 1.0 + rnd() * 0.6, rnd() * 6);
  c.decal?.('bloodDrag', -25.6, -37.6, 1.8, 0.3);
  casings(c, -20.5, -38.2, 9, 0.7);
  for (let i = 0; i < 3; i++) c.decal?.('paper', -30 + rnd() * 60, -38.25 + jit(c, 0.8), 0.8, rnd() * 6);
}
