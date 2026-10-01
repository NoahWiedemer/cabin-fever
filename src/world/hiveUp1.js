// The Hive's level-5 research labs (world/hive.js): lab 5-C (cell culture), lab 5-D (chemistry & prep, where it went
// wrong) and virology 5-E. Older, warmer and dirtier than the sublevel-4 labs: timber benches with slate tops, cream
// enamel instruments, brass taps. Room-specific props in the idiom of hiveProps.js / hiveLabs.js (world-space geometry
// for the Kit, one mesh per material, baked light, a collider for whatever you'd bump into) and one dress function per
// room, composed with the shared lab props of hiveLabs.js and the others' modules.
//
// c: hiveProps.js's build context plus X (EXTRA_MATS, baked), G (EXTRA_GLOW, emissive), label(text, x, y, z, face,
//    w, h, opts), decal(kind, x, z, size, rot), wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on).
//    The dress functions get it already moved up to level 5's floor: y 0 is the room's floor.
// Wall props take (x, z) = the middle of their back edge on the wall line and `face`, the side they open toward
// ('n' -z, 's' +z, 'w' -x, 'e' +x). Free-standing ones take their centre and a yaw (radians, 0 = front toward +z).
// Bench-top items take the surface height y as well.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import { SIGN, SCREEN, atlasPlane } from './lab.js';
import * as P from './hiveProps.js';
import * as L from './hiveLabs.js';
import * as Fac from './hiveFacility.js';
import * as A from './hiveDressA.js';
import * as B from './hiveDressB.js';
import * as C from './hiveDressC.js';

/** baked materials this module adds (c.X) */
export const EXTRA_MATS = {
  g_oak: { color: 0x8a5d36, roughness: 0.62 }, // old timber bench carcasses, veneer
  g_teak: { color: 0x5e3b22, roughness: 0.55 }, // reagent shelves, upstands, drawer fronts
  g_slate: { color: 0x2a2c2e, roughness: 0.48 }, // worn slate / epoxy bench tops
  g_enamel: { color: 0xe6dbc1, roughness: 0.42 }, // cream enamel instrument cases (the older kit)
  g_hammer: { color: 0x5d6b62, metalness: 0.35, roughness: 0.55 }, // hammer-finish green-grey frames
  g_steel: { color: 0xbcc3c8, metalness: 0.75, roughness: 0.3 }, // the isolator's brushed stainless
  g_neoprene: { color: 0x151617, roughness: 0.8 }, // glove-box gloves
  g_acrylic: { color: 0x9fb4bc, roughness: 0.1 }, // the anaerobic chamber's frame edges (tinted acrylic)
  g_ptfe: { color: 0xeeede6, roughness: 0.5 }, // PTFE stirrer shafts, valves, stoppers
  g_hdpe: { color: 0xe4e0d2, roughness: 0.6 }, // carboys, wash bottles
  g_hdpeBlue: { color: 0x2f6aa8, roughness: 0.55 },
  g_trayYellow: { color: 0xd9ab1f, roughness: 0.6 }, // spill trays, the spill kit
  g_pad: { color: 0xd3d4ce, roughness: 0.95 }, // absorbent pads and booms
  g_redPaint: { color: 0xb3201a, roughness: 0.45 }, // extinguishers, the fire blanket pouch
  g_brownGlass: { color: 0x4a2a10, roughness: 0.2 }, // reagent bottles
  g_capRed: { color: 0xc4352a, roughness: 0.5 },
  g_capBlue: { color: 0x2b55b5, roughness: 0.5 },
  g_bread: { color: 0xd9b27a, roughness: 0.85 },
  g_crust: { color: 0x94622f, roughness: 0.8 },
  g_apple: { color: 0xc9b98a, roughness: 0.7 }, // a browned apple core
  g_can: { color: 0x2e7d4f, roughness: 0.35, metalness: 0.4 }, // a soda can
  g_mattress: { color: 0x3f6f8c, roughness: 0.75 }, // the gurney's vinyl mattress
  g_soot: { color: 0x17130f, roughness: 0.95 }, // charred bench tops, the burnt hood
  g_vial: { color: 0xf3f1ea, roughness: 0.35 }, // cryo vials
  g_beige: { color: 0xcdc3a6, roughness: 0.55 }, // yellowed old plastics (monitor, controller)
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  g_lcd: [0x8ff2c4, 1.25], // controller displays (O₂ ppm, temperatures)
  g_pilot: [0xff3a22, 1.8], // red pilot lamps, alarm LEDs
  g_heat: [0xff7a2a, 1.7], // a hotplate / heating bath left on
  g_cool: [0x9fdcff, 1.3], // chiller readouts
  g_warm: [0xffd9a0, 1.5], // an old desk lamp's shade glow
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
const jit = (c, a) => (c.rnd() - 0.5) * 2 * a;

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
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const planeG = (w, h) => cached('q' + k3(w, h), () => new THREE.PlaneGeometry(w, h));

// ---------------------------------------------------------------- the local frame (as hiveLabs.js')
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
    _e.set(tilt?.[0] ?? 0, this.yaw, tilt?.[1] ?? 0, 'YXZ');
    this.m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(_e), V(1, 1, 1));
  }
  p(u, y, v) {
    return V(u, y, v).applyMatrix4(this.m);
  }
  /** any geometry at local (u, y, v), rotated [rx, ry, rz] (YXZ unless given) and scaled */
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
  /** a flat picture facing the front, `rect` an atlas region */
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
  /** the collider of a local box (its world AABB) */
  col(u0, v0, u1, v1, y1, surf = SURF.metal, flags = 0, y0 = 0) {
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
    this.c.col(x0, Math.max(0, ya), z0, x1, yb, z1, surf, flags);
  }
}

// ---------------------------------------------------------------- small shared bits
const LED = (c) => [c.U.ledG, c.U.ledG, c.U.ledA, c.U.ledB];
/** a row of small status LEDs along u on the front plane v */
function leds(f, u, y, v, n, du = 0.025, mats = null) {
  const c = f.c;
  for (let i = 0; i < n; i++) f.box(mats ? mats[i % mats.length] : pick(c, LED(c)), u + i * du, y, v, 0.008, 0.008, 0.004);
}
/** four rubber feet under a w × d footprint centred at (u, v) */
function feet(f, u, v, w, d, mat) {
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.cyl(mat, u + su * (w / 2 - 0.04), 0, v + sv * (d / 2 - 0.04), 0.018, 0.018, 0.012, 6);
}
/** a stencilled room title on the wall (as the other wings' rooms have) */
function roomTitle(c, text, x, y, z, face, w = 2.4, col = '#3fbf6a') {
  c.label(text, x, y, z, face, w, w * 0.11, { bg: '#1b2127', fg: '#e8edf0', border: col, font: 'bold 60px Arial' });
}
/** loose sheets on the floor round (x, z) */
function floorPapers(c, x, z, n = 5, spread = 0.8) {
  for (let i = 0; i < n; i++) c.K.cube(c.M.white, x + jit(c, spread), 0.002 + i * 0.0008, z + jit(c, spread), 0.21, 0.002, 0.297, c.rnd() * PI);
  c.decal('paper', x, z, spread * 1.6, c.rnd() * PI);
}
/** a row of reagent bottles along u on a shelf at height y, depth v: brown glass, white HDPE, blue-capped */
function bottles(f, u0, u1, y, v, n, { gaps = 0.15, r = 0.035 } = {}) {
  const { X, M, rnd } = f.c;
  const step = (u1 - u0) / n;
  for (let i = 0; i < n; i++) {
    if (rnd() < gaps) continue; // (taken, never put back)
    const u = u0 + step * (i + 0.3 + rnd() * 0.4), rr = r * (0.7 + rnd() * 0.5), h = rr * (3 + rnd() * 2.2);
    const kind = rnd();
    const body = kind < 0.5 ? X.g_brownGlass : kind < 0.8 ? X.g_hdpe : M.white;
    f.cyl(body, u, y, v + jit(f.c, 0.02), rr, rr, h, 6);
    f.box(kind < 0.5 ? M.black : pick(f.c, [X.g_capRed, X.g_capBlue, M.black]), u, y + h + 0.012, v, rr * 1.1, 0.024, rr * 1.1);
  }
}
/** a brass gas turret (a cock with its lever and a hose nozzle) standing at local (u, y, v) */
function gasCock(f, u, y, v, lever = 0, metal = null) {
  const { X, M } = f.c;
  f.cyl(metal ?? X.brass, u, y, v, 0.016, 0.012, 0.09, 8);
  f.hcyl(metal ?? X.brass, u, y + 0.075, v + 0.035, 0.007, 0.07, 6, 'v');
  f.box(M.black, u, y + 0.1, v, 0.07, 0.01, 0.014, 0, [0, lever, 0]);
}

/**
 * An old timber lab bench along a wall (the level-5 labs predate the white ones downstairs): an oak-veneer carcass
 * on a kick plinth, cupboard pairs and drawer stacks with brass handles, a worn slate top with a teak upstand, brass gas
 * cocks, a teak reagent shelf on steel uprights stocked with bottles, an optional cream ceramic sink with a swan-neck
 * tap. (x, z) the middle of its back edge, len along the wall. opts: depth, sink (its u offset or null), shelf, gear
 * (glassware on the top), burnt (a charred stretch of top), open (a cupboard door left swung open: its unit index),
 * spine (no upstand: the back half of an island), modern (white laminate, chrome, an epoxy top, a steel sink)
 */
export function oldBench(c, x, z, face, len, { depth = 0.75, sink = null, shelf = true, gear = 3, burnt = false, open = -1, spine = false, modern = false } = {}) {
  const { M, X, rnd } = c;
  // (modern: the same bench in white laminate, chrome and epoxy, as virology has it)
  const body = modern ? M.white : X.g_oak, front = modern ? M.white : X.g_teak, metal = modern ? X.chrome : X.brass;
  const f = new Frame(c, x, z, face);
  const Lh = len / 2, D = depth, T = 0.92, fv = D - 0.05;
  f.span(M.dark, -Lh + 0.04, 0, 0.04, Lh - 0.04, 0.1, D - 0.1);
  f.span(body, -Lh + 0.01, 0.1, 0.0, Lh - 0.01, 0.86, fv);
  const n = Math.max(1, Math.round(len / 0.6)), w = len / n;
  for (let i = 0; i < n; i++) {
    const u = -Lh + w * (i + 0.5);
    const underSink = sink !== null && Math.abs(u - sink) < w * 0.7;
    if (!underSink && (i + (rnd() < 0.3 ? 1 : 0)) % 3 === 1) {
      // a drawer stack: teak fronts, brass cup handles, one pulled out now and then
      for (let k = 0; k < 3; k++) {
        const y0 = 0.13 + k * 0.245, dv = rnd() < 0.12 ? 0.18 + rnd() * 0.12 : 0;
        f.span(front, u - w / 2 + 0.02, y0, fv + dv, u + w / 2 - 0.02, y0 + 0.225, fv + 0.02 + dv);
        f.box(metal, u, y0 + 0.17, fv + 0.03 + dv, 0.09, 0.022, 0.016);
        if (dv) f.span(body, u - w / 2 + 0.04, y0 + 0.02, fv, u + w / 2 - 0.04, y0 + 0.2, fv + dv);
      }
    } else {
      for (const s of [-1, 1]) {
        const du = u + (s * w) / 4;
        if (i === open && s > 0) {
          // swung wide on its hinge, the dark cupboard behind it
          f.add(front, rbox(w / 2 - 0.02, 0.7, 0.02), u + w / 2 - 0.01 - 0.06 * w, 0.48, fv + 0.02 + 0.24 * w, [0, PI / 2 - 0.25, 0]);
          f.span(M.black, du - w / 4 + 0.012, 0.13, fv, du + w / 4 - 0.012, 0.83, fv + 0.003);
          f.span(body, du - w / 4 + 0.012, 0.47, fv, du + w / 4 - 0.012, 0.49, fv + 0.006);
          continue;
        }
        f.span(front, du - w / 4 + 0.012, 0.13, fv, du + w / 4 - 0.012, 0.83, fv + 0.02);
        f.cyl(metal, u + s * 0.04, 0.7, fv + 0.02, 0.012, 0.012, 0.03, 6);
      }
    }
  }
  // the top (cut round the sink), the upstand, the gas cocks
  const top = burnt ? X.g_soot : modern ? M.top : X.g_slate;
  if (sink === null) f.span(top, -Lh, 0.86, 0, Lh, T, D, 0.008);
  else {
    f.span(top, -Lh, 0.86, 0, sink - 0.31, T, D, 0.008);
    f.span(top, sink + 0.31, 0.86, 0, Lh, T, D, 0.008);
    f.span(top, sink - 0.31, 0.86, 0, sink + 0.31, T, 0.1);
    f.span(top, sink - 0.31, 0.86, D - 0.07, sink + 0.31, T, D);
    f.span(modern ? M.steel : X.g_enamel, sink - 0.3, 0.68, 0.1, sink + 0.3, T + 0.012, D - 0.07, 0.02);
    f.span(M.dark, sink - 0.26, T + 0.008, 0.14, sink + 0.26, T + 0.014, D - 0.11);
    // the swan-neck tap and its two brass handles
    f.cyl(metal, sink, T, 0.06, 0.014, 0.012, 0.32, 8);
    f.rod(metal, [sink, T + 0.32, 0.06], [sink, T + 0.36, 0.16], 0.012, 6);
    f.rod(metal, [sink, T + 0.36, 0.16], [sink, T + 0.26, 0.26], 0.011, 6);
    for (const s of [-1, 1]) f.box(metal, sink + s * 0.09, T + 0.05, 0.06, 0.06, 0.012, 0.012);
  }
  if (!spine) f.span(front, -Lh, T, 0, Lh, T + 0.1, 0.022);
  const nc = Math.max(1, Math.floor(len / 1.1));
  for (let i = 0; i < nc; i++) {
    const u = -Lh + (len * (i + 0.5)) / nc;
    if (sink !== null && Math.abs(u - sink) < 0.4) continue;
    gasCock(f, u, T, 0.07, rnd() < 0.2 ? 1.2 : 0, metal);
  }
  if (burnt) {
    // charring spreads up the upstand; a scorched tray of melted bottles
    f.span(X.g_soot, -Lh * 0.3, T, 0.0, Lh * 0.4, T + 0.11, 0.025);
    for (let i = 0; i < 4; i++) f.add(X.g_soot, cylG(0.03, 0.02, 0.06 + rnd() * 0.06, 6), jit(c, Lh * 0.3), T, 0.3 + rnd() * 0.25, [jit(c, 0.6), 0, jit(c, 0.6)]);
  }
  if (shelf) {
    // the reagent shelf: two steel uprights, two teak boards, bottles on both
    for (const s of [-1, 1]) f.span(M.steel, s * (Lh - 0.12) - 0.015, T, 0.03, s * (Lh - 0.12) + 0.015, 1.78, 0.06);
    for (const y of [1.36, 1.72]) {
      f.span(front, -Lh + 0.06, y, 0.02, Lh - 0.06, y + 0.025, 0.25);
      bottles(f, -Lh + 0.12, Lh - 0.12, y + 0.025, 0.13, Math.round(len * 1.8));
    }
  }
  if (gear > 0) {
    const a = f.p(-Lh + 0.15, 0, 0.3), b = f.p(Lh - 0.15, 0, D - 0.12);
    P.glassware(c, [Math.min(a.x, b.x), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.z, b.z)], T, gear);
  }
  f.col(-Lh, 0, Lh, D, T, modern ? SURF.metal : SURF.wood);
  return f;
}

/** a glove port on a front plane at local (u, y, v): the clamp ring and the neoprene sleeve reaching in (or torn out) */
function glovePort(f, u, y, v, { torn = false, mat = null } = {}) {
  const { M, X } = f.c;
  f.add(mat ?? M.dark, torG(0.105, 0.02, 6, 14), u, y, v + 0.01);
  if (!torn) {
    f.add(X.g_neoprene, cylG(0.085, 0.055, 0.44, 8, true), u, y, v, [-PI / 2 - 0.3, 0, 0]);
    f.add(X.g_neoprene, rbox(0.1, 0.05, 0.13, 0.02), u, y - 0.17, v - 0.47, [0.3, 0, 0]); // the hand, limp
  } else {
    // ripped out through the port: the sleeve hangs outside, split at the cuff
    f.add(X.g_neoprene, cylG(0.085, 0.07, 0.3, 8, true), u, y, v + 0.01, [PI / 2 + 0.95, 0, 0.1]);
    f.add(X.g_neoprene, rbox(0.12, 0.03, 0.16, 0.012), u + 0.03, y - 0.27, v + 0.22, [1.1, 0.4, 0]);
  }
}

/**
 * A glove box against the wall (the hero of lab 5-C and virology). kind 'anaerobic': a clear acrylic chamber on a
 * hammer-finish stand, the round interchange lock on its +u side, a beige controller (O₂ ppm), a vacuum pump below,
 * petri stacks inside. kind 'isolator': a line of `n` stainless chambers with sloped glazed fronts, HEPA housings and
 * ducts to the ceiling, a pressure gauge per chamber, a pass box at the +u end, the control panel at the -u end.
 * `torn`: the chamber index whose glove was ripped out (its alarm lit). len: overall length (u), ceil: room height.
 */
export function gloveBox(c, x, z, face, { kind = 'isolator', n = 3, len = 3.0, torn = -1, ceil = 3.2, name = null } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const Lh = len / 2, iso = kind === 'isolator';
  const D = iso ? 0.85 : 0.8, y0 = iso ? 0.78 : 0.82, y1 = iso ? 1.72 : 1.6, vf = D - 0.04;
  const frame = iso ? X.g_steel : X.g_hammer;
  const lock = iso ? 0.5 : 0.42; // the pass box / interchange at the +u end
  const cu1 = Lh - lock; // the chambers' +u end
  // the stand: legs on levelling feet, a rail, a shelf
  for (const u of [-Lh + 0.05, cu1 - 0.05, Lh - 0.05]) {
    for (const v of [0.08, D - 0.1]) {
      f.span(frame, u - 0.025, 0.04, v - 0.025, u + 0.025, y0, v + 0.025);
      f.cyl(M.black, u, 0, v, 0.03, 0.03, 0.04, 8);
    }
  }
  f.span(frame, -Lh + 0.03, 0.22, 0.06, Lh - 0.03, 0.25, D - 0.08);
  f.span(frame, -Lh, y0 - 0.06, 0.02, Lh, y0, D);
  const nc = iso ? n : 1, cw = (cu1 + Lh) / nc;
  for (let i = 0; i < nc; i++) {
    const u0 = -Lh + i * cw, um = u0 + cw / 2;
    if (iso) {
      // the body: back, roof, side walls; the glazed front leans back toward the top
      f.span(X.g_steel, u0, y0, 0.02, u0 + cw, y1, 0.06);
      f.span(X.g_steel, u0, y1 - 0.04, 0.02, u0 + cw, y1, D - 0.22);
      f.span(X.g_steel, u0, y0, 0.02, u0 + 0.025, y1, D);
      if (i === nc - 1) f.span(X.g_steel, u0 + cw - 0.025, y0, 0.02, u0 + cw, y1, D);
      f.span(X.g_steel, u0, y0, D - 0.08, u0 + cw, y0 + 0.12, D); // the front sill
      f.add(U.glass, rbox(cw - 0.05, y1 - y0 - 0.12, 0.012), um, (y0 + 0.12 + y1) / 2, D - 0.15, [-0.16, 0, 0]);
      f.span(M.dark, u0 + 0.03, y0, 0.06, u0 + cw - 0.03, y0 + 0.004, D - 0.1); // the work tray, its grime
      // the HEPA housing, its duct to the ceiling, the gauge and the chamber number
      f.span(X.g_steel, um - 0.28, y1, 0.08, um + 0.28, y1 + 0.26, 0.5, 0.015);
      f.cyl(M.steel, um, y1 + 0.26, 0.29, 0.09, 0.09, Math.max(0.1, ceil - y1 - 0.26), 10);
      f.gauge(um + 0.18, y1 + 0.13, 0.5, 0.1);
      f.label(String(i + 1), um - 0.15, y1 + 0.13, 0.502, 0.14, 0.14, { bg: '#e8edf0', fg: '#1b2127', font: 'bold 90px Arial' });
      f.box(i === torn ? G.g_pilot : U.ledG, um, y0 + 0.06, D + 0.002, 0.03, 0.02, 0.004);
      for (const s of [-1, 1]) glovePort(f, um + s * 0.23, y0 + 0.42, D - 0.14, { torn: i === torn && s < 0, mat: X.g_steel });
      // what was being worked on: plates, a rack, a flask
      for (let k = 0; k < 3; k++) f.cyl(pick(c, [M.white, U.amber, X.g_vial]), u0 + 0.18 + k * (cw - 0.36) / 2, y0 + 0.004, 0.3 + rnd() * 0.2, 0.045, 0.045, 0.02 + rnd() * 0.05, 10);
    } else {
      // the clear chamber: acrylic walls (one glass skin) with tinted edges, a sloped front
      f.add(U.glass, rbox(cw - 0.02, y1 - y0, D - 0.12, 0.02), um, (y0 + y1) / 2, D / 2 - 0.02);
      for (const [a, b] of [[u0, 0.04], [u0 + cw, 0.04], [u0, D - 0.08], [u0 + cw, D - 0.08]]) f.span(X.g_acrylic, a - 0.015, y0, b - 0.015, a + 0.015, y1, b + 0.015);
      f.span(X.g_acrylic, u0, y1 - 0.03, 0.04, u0 + cw, y1, D - 0.08);
      for (const s of [-1, 1]) glovePort(f, um + s * 0.26, y0 + 0.36, D - 0.08, { torn: torn === 0 && s > 0, mat: X.g_acrylic });
      // inside: stacked plates, the catalyst box, a small incubator, a loop rack
      for (let k = 0; k < 4; k++) {
        const pu = um - 0.4 + k * 0.18 + jit(c, 0.03), h = 0.04 + Math.floor(rnd() * 5) * 0.014;
        f.cyl(M.white, pu, y0, 0.36 + jit(c, 0.08), 0.045, 0.045, h, 10);
        f.cyl(U.magenta, pu, y0 + 0.002, 0.36, 0.04, 0.04, h - 0.006, 8);
      }
      f.span(X.g_beige, um + 0.15, y0, 0.08, um + 0.45, y0 + 0.22, 0.32, 0.01);
      f.span(M.grey, um - 0.6, y0, 0.08, um - 0.32, y0 + 0.16, 0.3, 0.01);
    }
  }
  // the lock at the +u end: a pass box (isolator) or the round interchange cylinder (anaerobic)
  if (iso) {
    f.span(X.g_steel, cu1, y0, 0.1, Lh, y0 + 0.55, D - 0.1, 0.02);
    f.hcyl(M.steel, cu1 + lock / 2, y0 + 0.28, D - 0.09, 0.17, 0.02, 16, 'v');
    f.box(M.dark, cu1 + lock / 2 + 0.1, y0 + 0.28, D - 0.07, 0.05, 0.12, 0.03);
    f.label('PASS BOX · INTERLOCK', cu1 + lock / 2, y0 + 0.5, D - 0.09, 0.4, 0.05, { bg: '#1b2127', fg: '#ffd23a', font: 'bold 40px Arial' });
  } else {
    f.hcyl(X.g_acrylic, cu1 + lock / 2, y0 + 0.3, D / 2, 0.22, lock, 14, 'u');
    f.hcyl(X.g_hammer, Lh - 0.01, y0 + 0.3, D / 2, 0.23, 0.03, 14, 'u');
    f.box(M.dark, Lh + 0.01, y0 + 0.3, D / 2, 0.02, 0.05, 0.18);
    f.gauge(cu1 + lock / 2, y0 + 0.65, D / 2 + 0.05, 0.09);
  }
  // the controller (a display, LEDs) and its sticker
  const cu = iso ? -Lh + 0.3 : cu1 - 0.35, cy = iso ? y1 : y1 + 0.02;
  f.span(iso ? M.white : X.g_beige, cu - 0.22, cy, iso ? 0.55 : 0.1, cu + 0.22, cy + 0.2, iso ? 0.75 : 0.32, 0.012);
  f.box(G.g_lcd, cu - 0.05, cy + 0.12, iso ? 0.752 : 0.322, 0.2, 0.06, 0.004);
  leds(f, cu + 0.09, cy + 0.12, iso ? 0.752 : 0.322, 3, 0.03, torn >= 0 ? [G.g_pilot, U.ledA, U.ledG] : null);
  f.label(iso ? (torn >= 0 ? 'ΔP ALARM · CH ' + (torn + 1) : '−120 Pa · OK') : 'O₂ 0.0 ppm · H₂ 2.9 %', cu, cy + 0.05, iso ? 0.752 : 0.322, 0.36, 0.05, { bg: '#0d1a14', fg: torn >= 0 ? '#ff5a3a' : '#8ff2c4', font: 'bold 38px monospace' });
  if (name) f.label(name, iso ? 0 : -Lh * 0.4, y0 - 0.03, D + 0.003, Math.min(1.6, len * 0.5), 0.07, { bg: '#e8edf0', fg: '#1b2127', border: '#c63a2e', font: 'bold 44px Arial' });
  if (!iso) {
    // below: the vacuum pump on the shelf, its hose up to the lock
    f.span(M.grey, -Lh + 0.2, 0.25, 0.15, -Lh + 0.6, 0.48, 0.45, 0.02);
    f.hcyl(M.dark, -Lh + 0.4, 0.37, 0.45, 0.07, 0.02, 10, 'v');
    f.rod(M.black, [-Lh + 0.6, 0.4, 0.3], [cu1 + 0.1, y0 - 0.05, 0.3], 0.012, 6);
  }
  if (iso && ceil > y1 + 0.6) f.light(0, y1 - 0.15, D * 0.45, 0.28, 1.2, COOL, DOWN, 2.6);
  f.col(-Lh, 0, Lh, D, y1 + 0.2, SURF.metal);
  return f;
}

/** the jacketed reactor vessel's lathe (round bottom, straight wall, a flange); `broken` leaves a wedge smashed out */
const vesselG = (broken) => cached('vessel' + broken, () => {
  const pts = [[0.02, 0], [0.12, 0.03], [0.2, 0.09], [0.24, 0.18], [0.245, 0.85], [0.275, 0.86], [0.275, 0.9]].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 18, broken ? 1.1 : 0, broken ? PI * 1.45 : PI * 2);
});

/**
 * A 50 L jacketed glass reactor in its steel frame (lab 5-D's hero): the vessel on a ring clamp, the PTFE lid with its
 * necks, the overhead stirrer and its shaft, a coil condenser, the bottom valve over a catch can, a recirculating
 * chiller on the floor beside it (hoses to the jacket, its readout), the control box with an E-stop. `broken`: a wedge
 * of the vessel blown out, shards and the spill on the floor, the chiller alarming. (x, z) the middle of its back
 * edge (1.6 m wide, 0.85 deep).
 */
export function glassReactor(c, x, z, face, { broken = true, ceil = 3.2 } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const fu = -0.35, fv = 0.45; // the frame's centre
  // the frame: four uprights on feet, rails top and bottom, a cross beam carrying the stirrer
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      f.span(X.g_hammer, fu + su * 0.45 - 0.025, 0, fv + sv * 0.34 - 0.025, fu + su * 0.45 + 0.025, 2.3, fv + sv * 0.34 + 0.025);
      f.cyl(M.black, fu + su * 0.45, 0, fv + sv * 0.34, 0.035, 0.035, 0.03, 8);
    }
    f.span(X.g_hammer, fu + su * 0.45 - 0.02, 0.12, fv - 0.34, fu + su * 0.45 + 0.02, 0.16, fv + 0.34);
    f.span(X.g_hammer, fu + su * 0.45 - 0.02, 2.24, fv - 0.34, fu + su * 0.45 + 0.02, 2.28, fv + 0.34);
  }
  f.span(X.g_hammer, fu - 0.45, 1.86, fv - 0.03, fu + 0.45, 1.92, fv + 0.03);
  f.span(X.g_hammer, fu - 0.45, 1.36, fv - 0.03, fu + 0.45, 1.4, fv + 0.03); // the clamp beam
  f.add(M.steel, torG(0.285, 0.02, 6, 18), fu, 1.38, fv, [PI / 2, 0, 0]);
  // the vessel (its liquid when whole), the lid and necks
  f.add(U.glass, vesselG(broken), fu, 0.6, fv);
  if (!broken) f.cyl(U.amber, fu, 0.66, fv, 0.2, 0.23, 0.5, 14);
  else f.cyl(U.amber, fu, 0.63, fv, 0.12, 0.17, 0.05, 12);
  f.cyl(X.g_ptfe, fu, 1.5, fv, 0.285, 0.285, 0.05, 18);
  for (const [du, dv, h] of [[0.15, 0.05, 0.12], [-0.14, 0.08, 0.1], [0.02, -0.17, 0.08]]) f.cyl(U.glass, fu + du, 1.55, fv + dv, 0.035, 0.03, h, 8);
  // the stirrer: motor, chuck, shaft, the anchor blade
  f.cyl(M.dark, fu, 1.92, fv, 0.08, 0.08, 0.26, 12);
  f.cyl(M.grey, fu, 2.18, fv, 0.05, 0.03, 0.05, 10);
  f.box(G.g_lcd, fu, 2.05, fv + 0.08, 0.06, 0.03, 0.004);
  f.cyl(X.g_ptfe, fu, 0.68, fv, 0.012, 0.012, 1.24, 6);
  f.span(X.g_ptfe, fu - 0.16, 0.68, fv - 0.01, fu + 0.16, 0.74, fv + 0.01);
  // the coil condenser, its hoses
  f.cyl(U.glass, fu + 0.15, 1.67, fv + 0.05, 0.04, 0.04, 0.5, 8);
  for (let k = 0; k < 4; k++) f.add(U.glass, torG(0.026, 0.006, 4, 8), fu + 0.15, 1.75 + k * 0.1, fv + 0.05, [PI / 2, 0, 0]);
  f.rod(M.black, [fu + 0.19, 2.1, fv + 0.05], [fu + 0.45, 2.2, fv + 0.2], 0.01, 6);
  // the bottom valve, the catch can
  f.cyl(X.g_ptfe, fu, 0.48, fv, 0.03, 0.03, 0.12, 8);
  f.box(X.g_ptfe, fu + 0.06, 0.53, fv, 0.1, 0.015, 0.02);
  f.cyl(M.steel, fu, 0.16, fv, 0.14, 0.15, 0.24, 12);
  // the chiller on the floor, hoses up to the jacket
  const cu = 0.42;
  f.span(X.g_enamel, cu - 0.27, 0, 0.1, cu + 0.27, 0.62, 0.7, 0.02);
  f.span(M.dark, cu - 0.22, 0.05, 0.69, cu + 0.22, 0.25, 0.705);
  f.box(broken ? G.g_pilot : G.g_cool, cu - 0.08, 0.5, 0.705, 0.18, 0.06, 0.004);
  leds(f, cu + 0.08, 0.5, 0.705, 3, 0.03, broken ? [G.g_pilot, U.ledA, U.ledA] : null);
  f.label(broken ? 'FLOW FAULT · −18.0 °C' : 'SET −10.0 · ACT −9.8 °C', cu, 0.4, 0.705, 0.42, 0.05, { bg: '#10161a', fg: broken ? '#ff5a3a' : '#9fdcff', font: 'bold 34px monospace' });
  for (const [dy, s] of [[0.68, 1], [1.25, -1]]) {
    f.rod(M.black, [cu - 0.1 * s, 0.62, 0.35], [cu - 0.1 * s, 0.75 + dy * 0.2, 0.35], 0.016, 6);
    f.rod(M.black, [cu - 0.1 * s, 0.75 + dy * 0.2, 0.35], [fu + 0.2, dy, fv + 0.12], 0.016, 6);
  }
  // the control box on the front-right upright: the E-stop, the warning
  f.span(M.grey, fu + 0.48, 1.0, fv + 0.25, fu + 0.6, 1.3, fv + 0.38, 0.01);
  f.hcyl(M.red, fu + 0.62, 1.2, fv + 0.31, 0.03, 0.03, 10, 'u');
  f.label('R-2 · 50 L · NEVER LEAVE A RUN UNATTENDED', fu, 0.3, fv + 0.36, 0.86, 0.06, { bg: '#ffd23a', fg: '#1b1b1b', font: 'bold 34px Arial' });
  if (broken) {
    // the vessel blew: shards, the spill, scorching
    for (let i = 0; i < 9; i++) f.add(U.glass, rbox(0.05 + rnd() * 0.12, 0.004, 0.04 + rnd() * 0.08), fu + jit(c, 0.7), 0.004, fv + 0.5 + rnd() * 0.7, [jit(c, 0.2), rnd() * PI, 0]);
    const p = f.p(fu, 0, fv + 0.9);
    c.decal('puddle', p.x, p.z, 1.5, rnd() * PI);
    c.decal('stain', p.x, p.z, 1.1, rnd() * PI);
    c.decal('glass', p.x, p.z, 1.2, rnd() * PI);
  }
  f.col(fu - 0.48, 0, cu + 0.27, 0.82, 2.3, SURF.metal);
  return f;
}

/**
 * Open steel reagent shelving against the wall: grey uprights, lipped shelves with edge labels, rows of bottles (gaps
 * where they were taken); `fallen`: a few knocked off, lying broken on the floor in front with their spill. w across.
 */
export function reagentShelf(c, x, z, face, { w = 1.8, h = 2.0, d = 0.42, levels = 5, looted = 0.2, fallen = true, tags = ['ACIDS', 'BASES', 'SOLVENTS', 'SALTS', 'INDICATORS'] } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const wh = w / 2;
  for (const su of [-1, 1]) for (const v of [0.03, d - 0.03]) f.span(M.grey, su * wh - (su > 0 ? 0.035 : 0), 0, v - 0.015, su * wh + (su < 0 ? 0.035 : 0), h, v + 0.015);
  for (let k = 0; k < levels; k++) {
    const y = 0.12 + k * ((h - 0.25) / (levels - 1));
    f.span(M.grey, -wh, y, 0.02, wh, y + 0.025, d);
    f.span(M.grey, -wh, y + 0.025, d - 0.012, wh, y + 0.06, d); // the lip
    if (k < levels - 1 && tags[k]) f.label(tags[k], -wh + 0.22, y + 0.042, d + 0.002, 0.3, 0.032, { bg: '#f4f1e6', fg: '#1b2127', font: 'bold 40px Arial' });
    if (k > 0 || rnd() < 0.5) bottles(f, -wh + 0.06, wh - 0.06, y + 0.025, d * 0.5, Math.round(w * (k === 0 ? 3 : 4.2)), { gaps: looted, r: k === 0 ? 0.06 : 0.035 });
  }
  if (fallen) {
    // knocked off in the scramble: bottles on their sides, one shattered and spreading
    for (let i = 0; i < 3; i++) {
      const u = jit(c, wh * 0.8), v = d + 0.15 + rnd() * 0.4;
      f.add(i ? X.g_brownGlass : X.g_hdpe, cylC(0.035, 0.035, 0.16, 6), u, 0.035, v, [PI / 2, rnd() * PI, 0, 'YXZ']);
    }
    const p = f.p(jit(c, wh * 0.5), 0, d + 0.45);
    c.decal('stain', p.x, p.z, 0.9, rnd() * PI);
    c.decal('glass', p.x, p.z, 0.6, rnd() * PI);
  }
  f.col(-wh, 0, wh, d, h, SURF.metal);
  return f;
}

/** a yellow spill tray against the wall with `n` 20 L waste carboys (taps, caps, labels) and a funnel in one */
export function carboyTray(c, x, z, face, { n = 3, w = 1.2, names = ['HALOGENATED', 'NON-HALOGEN.', 'AQUEOUS · pH 2'] } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const wh = w / 2, d = 0.5;
  f.span(X.g_trayYellow, -wh, 0, 0.02, wh, 0.12, d, 0.01);
  f.span(M.dark, -wh + 0.04, 0.1, 0.06, wh - 0.04, 0.121, d - 0.04);
  for (let i = 0; i < n; i++) {
    const u = -wh + (w * (i + 0.5)) / n;
    const body = i === 1 ? X.g_hdpeBlue : X.g_hdpe;
    f.add(body, rbox(0.3, 0.42, 0.26, 0.04), u, 0.33, 0.27, [0, jit(c, 0.15), 0]);
    f.cyl(body, u + 0.06, 0.54, 0.27, 0.04, 0.035, 0.05, 8);
    f.cyl(pick(c, [X.g_capRed, X.g_capBlue, M.black]), u + 0.06, 0.59, 0.27, 0.042, 0.042, 0.025, 8);
    f.box(body, u - 0.07, 0.56, 0.27, 0.08, 0.03, 0.04); // the handle
    f.hcyl(X.g_ptfe, u, 0.17, 0.41, 0.012, 0.05, 6, 'v');
    f.label(names[i % names.length], u, 0.36, 0.402, 0.24, 0.1, { bg: '#ffffff', fg: '#1b1b1b', border: '#d18a1a', lines: ['WASTE', names[i % names.length]], font: 'bold 30px Arial' });
  }
  if (n > 1) f.cyl(M.dark, -wh + w / (2 * n) + 0.06, 0.6, 0.27, 0.025, 0.08, 0.1, 8, true);
  f.col(-wh, 0, wh, d, 0.62, SURF.metal);
  return f;
}

/** a wheeled chemical spill kit at (x, z) turned yaw: the yellow drum, its lid off beside it, pads and a boom strewn about */
export function spillKit(c, x, z, yaw = 0, { open = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  f.cyl(X.g_trayYellow, 0, 0.04, 0, 0.27, 0.3, 0.72, 14);
  f.cyl(M.dark, 0, 0.0, 0, 0.27, 0.27, 0.04, 14);
  for (const s of [-1, 1]) f.hcyl(M.black, s * 0.2, 0.06, -0.2, 0.06, 0.05, 10, 'u');
  f.span(X.g_trayYellow, -0.12, 0.62, -0.33, 0.12, 0.66, -0.29);
  f.label('CHEMICAL SPILL KIT', 0, 0.48, 0.301, 0.42, 0.1, { bg: '#1b1b1b', fg: '#ffd23a', font: 'bold 40px Arial', lines: ['CHEMICAL', 'SPILL KIT'] });
  if (open) {
    f.add(X.g_trayYellow, cylG(0.31, 0.31, 0.05, 14), 0.55, 0.045, 0.25, [0.12, 0, 0.08]);
    f.cyl(X.g_pad, 0, 0.7, 0, 0.24, 0.24, 0.02, 12);
    for (let i = 0; i < 5; i++) f.add(X.g_pad, rbox(0.4, 0.006, 0.4), jit(c, 0.9), 0.003 + i * 0.002, 0.5 + rnd() * 0.6, [0, rnd() * PI, 0]);
    // the sock boom, laid in an arc to hold the spill back
    const pts = [];
    for (let k = 0; k <= 6; k++) pts.push(V(-0.8 + k * 0.27, 0.04, 0.9 + Math.sin(k / 6 * PI) * 0.35));
    f.add(X.g_pad, cached('boom', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.04, 6)), 0, 0, 0);
  }
  f.col(-0.3, -0.3, 0.3, 0.3, 0.72, SURF.metal);
  return f;
}

/** an emptied extinguisher lying on the floor at (x, z) turned yaw: CO₂ (black horn) or powder (a hose), its pin out */
export function spentExtinguisher(c, x, z, yaw = 0, { co2 = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  f.hcyl(X.g_redPaint, 0, 0.09, 0, 0.085, 0.5, 12, 'u');
  f.add(X.g_redPaint, sphG(0.085, 10, 6), 0.25, 0.09, 0);
  f.hcyl(M.dark, 0.32, 0.09, 0, 0.025, 0.1, 8, 'u');
  f.box(M.steel, 0.38, 0.13, 0, 0.1, 0.02, 0.03, 0, [0, 0, 0.3]);
  if (co2) {
    f.rod(M.black, [0.36, 0.09, 0], [0.42, 0.04, 0.25], 0.012, 6);
    f.add(M.black, cylG(0.02, 0.06, 0.22, 8, true), 0.42, 0.06, 0.25, [PI / 2 - 0.1, 0.6, 0]);
  } else f.rod(M.black, [0.36, 0.09, 0], [0.2, 0.02, 0.35], 0.012, 6);
  f.label(co2 ? 'CO₂ · 5 kg' : 'POWDER · 6 kg', -0.05, 0.09, 0.087, 0.2, 0.08, { bg: '#f4f1e6', fg: '#b3201a', font: 'bold 34px Arial' });
}

/** a fire blanket pouch on the wall at height y; `pulled`: emptied, its tapes hanging, the blanket crumpled on the floor below */
export function fireBlanket(c, x, y, z, face, { pulled = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.g_redPaint, -0.15, y - 0.17, 0, 0.15, y + 0.17, 0.06, 0.01);
  f.label('FIRE BLANKET', 0, y + 0.07, 0.062, 0.24, 0.06, { bg: '#b3201a', fg: '#ffffff', font: 'bold 40px Arial' });
  for (const s of [-1, 1]) f.span(M.white, s * 0.06 - 0.012, pulled ? y - 0.42 : y - 0.2, 0.06, s * 0.06 + 0.012, y - 0.15, 0.065);
  if (pulled) {
    f.add(X.g_pad, rbox(0.9, 0.03, 0.7, 0.012), 0.2, 0.06, 0.75, [0.05, rnd() * 0.5, 0.06]);
    f.add(X.g_pad, rbox(0.4, 0.05, 0.3, 0.02), 0.05, 0.1, 0.6, [0.2, 0.3, -0.15]);
  }
}

// ---------------------------------------------------------------- bench-top things
/** a rotary evaporator on a surface at (x, y, z) turned yaw: heating bath (left on), the tilted flask, motor, coil condenser, receiver */
export function rotovap(c, x, y, z, yaw = 0, { on = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.span(X.g_enamel, -0.3, 0, -0.17, 0.25, 0.03, 0.17, 0.008);
  f.cyl(X.g_enamel, -0.14, 0.03, 0.02, 0.14, 0.13, 0.12, 14);
  f.cyl(U.cyan, -0.14, 0.03, 0.02, 0.125, 0.125, 0.1, 12);
  f.box(on ? G.g_heat : M.dark, -0.14, 0.09, 0.15, 0.04, 0.02, 0.004);
  f.add(U.glass, sphG(0.075, 8, 6), -0.12, 0.17, 0.02);
  f.rod(U.glass, [-0.12, 0.2, 0.02], [0.0, 0.32, 0.02], 0.015, 6);
  // the lift column, the motor head (angled), the condenser and the receiving flask
  f.cyl(M.steel, 0.1, 0.03, -0.1, 0.018, 0.018, 0.55, 8);
  f.add(M.grey, rbox(0.14, 0.1, 0.12, 0.02), 0.03, 0.34, 0.02, [0, 0, 0.5]);
  f.box(G.g_lcd, 0.06, 0.37, 0.081, 0.05, 0.02, 0.004);
  f.cyl(U.glass, 0.13, 0.36, 0.02, 0.035, 0.035, 0.36, 8);
  for (let k = 0; k < 3; k++) f.add(U.glass, torG(0.022, 0.005, 4, 8), 0.13, 0.44 + k * 0.09, 0.02, [PI / 2, 0, 0]);
  f.add(U.glass, sphG(0.06, 8, 6), 0.13, 0.25, 0.02);
  f.rod(M.black, [0.13, 0.7, 0.02], [0.24, 0.6, -0.15], 0.008, 5);
}

/** an inverted (cell-culture) microscope on a surface at (x, y, z), eyepieces toward yaw's front: the light pillar arching over the stage */
export function invertedMicroscope(c, x, y, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.span(X.g_enamel, -0.13, 0, -0.2, 0.13, 0.1, 0.18);
  f.span(X.g_enamel, -0.04, 0.1, -0.2, 0.04, 0.55, -0.13);
  f.span(X.g_enamel, -0.04, 0.48, -0.2, 0.04, 0.55, 0.0);
  f.cyl(M.dark, 0, 0.4, -0.03, 0.03, 0.04, 0.08, 10);
  f.span(M.dark, -0.13, 0.19, -0.1, 0.13, 0.21, 0.08);
  for (const du of [-0.025, 0.025]) f.cyl(M.steel, du, 0.12, -0.02, 0.008, 0.008, 0.06, 6);
  f.span(M.black, -0.05, 0.1, 0.1, 0.05, 0.16, 0.2);
  for (const du of [-0.03, 0.03]) f.add(M.black, cylC(0.014, 0.014, 0.1, 8), du, 0.2, 0.24, [0.7, 0, 0]);
  f.cyl(M.white, 0.02, 0.21, -0.02, 0.04, 0.04, 0.012, 12); // a flask on the stage, left under the scope
}

/** a meal abandoned on a desk at (x, y, z): a half sandwich, noodles with the fork in, an apple core, a can, a napkin */
export function deskMeal(c, x, y, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.span(M.white, -0.2, 0, -0.05, 0.0, 0.05, 0.1, 0.01);
  f.span(X.g_bread, -0.19, 0.035, -0.04, -0.01, 0.045, 0.09);
  f.box(M.steel, -0.08, 0.07, 0.02, 0.012, 0.004, 0.16, 0, [0.6, 0.4, 0]);
  f.span(M.white, -0.24, 0, 0.12, -0.02, 0.004, 0.27);
  f.add(X.g_crust, cylG(0.075, 0.075, 0.012, 3), 0.1, 0, 0.05, [0, 0.5, 0]);
  f.add(M.green, cylG(0.068, 0.068, 0.008, 3), 0.1, 0.012, 0.05, [0, 0.5, 0]);
  f.add(X.g_bread, cylG(0.075, 0.075, 0.012, 3), 0.1, 0.02, 0.05, [0, 0.5, 0]);
  f.cyl(X.g_can, 0.2, 0, -0.08, 0.033, 0.033, 0.12, 10);
  f.add(X.g_apple, cylC(0.012, 0.012, 0.06, 6), 0.24, 0.025, 0.1, [0, 0, PI / 2]);
  for (const s of [-1, 1]) f.add(X.g_apple, sphG(0.026, 6, 4), 0.24 + s * 0.03, 0.025, 0.1);
  f.add(M.white, sphG(0.035, 6, 4), 0.02, 0.02, 0.15, null, [1, 0.5, 1]);
}

/** a stack of T-75 culture flasks (pink medium) on a surface at (x, y, z) */
export function cultureFlasks(c, x, y, z, yaw = 0, n = 4) {
  const { U, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  for (let i = 0; i < n; i++) {
    const yy = i * 0.042, du = jit(c, 0.01);
    f.box(U.glass, du, yy + 0.02, 0, 0.12, 0.04, 0.2);
    f.box(U.magenta, du, yy + 0.008, 0.01, 0.11, 0.014, 0.17);
    f.add(X.g_hdpeBlue, cylC(0.018, 0.018, 0.03, 8), du + 0.03, yy + 0.022, 0.115, [PI / 2 - 0.4, 0, 0]);
  }
}

/** samples dropped on the floor at (x, z): a cryo box face down, its lid, vials scattered, a cracked rack, the spill */
export function droppedSamples(c, x, z, rot = 0, { spill = 'slime', n = 9 } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, rot);
  f.span(M.white, -0.07, 0, -0.07, 0.07, 0.05, 0.07, 0.006);
  f.add(X.g_hdpeBlue, rbox(0.14, 0.012, 0.14, 0.004), 0.3, 0.006, 0.12, [0, 0.6, 0]);
  for (let i = 0; i < n; i++) {
    const u = jit(c, 0.5), v = jit(c, 0.45), a = rnd() * PI;
    f.add(X.g_vial, cylC(0.007, 0.007, 0.045, 6), u, 0.007, v, [PI / 2, a, 0, 'YXZ']);
    f.add(pick(c, [X.g_capRed, X.g_capBlue, M.yellow, M.green]), cylC(0.008, 0.008, 0.012, 4), u + Math.sin(a) * 0.028, 0.008, v + Math.cos(a) * 0.028, [PI / 2, a, 0, 'YXZ']);
  }
  f.add(M.white, rbox(0.22, 0.03, 0.08, 0.004), -0.32, 0.045, -0.2, [0, 0.3, 0.25]);
  f.add(U.glass, rbox(0.03, 0.002, 0.02), 0.15, 0.002, -0.15, [0, 1.0, 0]);
  const p = f.p(0.1, 0, 0.05);
  c.decal(spill, p.x, p.z, 0.8 + rnd() * 0.4, rnd() * PI);
}

/** a pegboard glassware drying rack on the wall at height y over a drip tray: flasks and cylinders upside down on the pegs */
export function dryingRack(c, x, y, z, face, { w = 0.7, h = 0.55 } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.g_hdpe, -w / 2, y, 0, w / 2, y + h, 0.025, 0.01);
  f.span(M.steel, -w / 2, y - 0.04, 0, w / 2, y, 0.12);
  for (let r = 0; r < 3; r++) {
    for (let k = 0; k < 5; k++) {
      const u = -w / 2 + 0.07 + k * ((w - 0.14) / 4), yy = y + 0.08 + r * ((h - 0.14) / 2);
      f.add(M.white, cylC(0.005, 0.005, 0.09, 4), u, yy + 0.02, 0.065, [PI / 2 - 0.35, 0, 0]);
      if (rnd() < 0.45) f.add(U.glass, cylG(0.012, 0.045 + rnd() * 0.02, 0.1 + rnd() * 0.06, 8), u, yy + 0.06, 0.1, [PI, 0, 0]);
    }
  }
}

// ---------------------------------------------------------------- furniture, fallen and standing
/**
 * A mobile steel lab table centred at (x, z) turned yaw: square legs on casters, apron rails, a lower shelf, a slate
 * (or `top`) top. `tipped`: shoved over onto its long side, the top toward the front (a barricade face), legs behind.
 */
export function labTable(c, x, z, yaw = 0, { w = 1.5, d = 0.75, tipped = false, top = null, shelf = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, tipped ? { y: d / 2, tilt: [PI / 2, 0] } : {});
  const wh = w / 2 - 0.03, dh = d / 2 - 0.03;
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      f.span(X.g_hammer, su * wh - 0.02, 0.07, sv * dh - 0.02, su * wh + 0.02, 0.88, sv * dh + 0.02);
      f.cyl(M.black, su * wh, 0, sv * dh, 0.03, 0.03, 0.07, 8);
    }
    f.span(X.g_hammer, su * wh - 0.015, 0.78, -dh, su * wh + 0.015, 0.84, dh);
  }
  for (const sv of [-1, 1]) f.span(X.g_hammer, -wh, 0.78, sv * dh - 0.015, wh, 0.84, sv * dh + 0.015);
  if (shelf) f.span(M.grey, -wh, 0.2, -dh, wh, 0.22, dh);
  f.span(top ?? X.g_slate, -w / 2, 0.88, -d / 2, w / 2, 0.92, d / 2, 0.006);
  f.col(-w / 2, -d / 2, w / 2, d / 2, 0.92, SURF.metal);
  return f;
}

/** a hospital gurney knocked over at (x, z) turned yaw (its length along the frame's v): frame on its side, wheels in the air, the mattress slid off */
export function gurneyOver(c, x, z, yaw = 0, { sheet = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw, { y: 0.33, tilt: [0, PI / 2] });
  // (built standing, then laid on its side: its up runs along the world -u, the platform faces that way)
  f.span(M.steel, -0.3, 0.6, -0.95, 0.3, 0.64, 0.95);
  for (const s of [-1, 1]) f.span(M.steel, s * 0.31 - 0.012, 0.64, -0.7, s * 0.31 + 0.012, 0.88, 0.6);
  f.span(M.grey, -0.22, 0.12, -0.75, 0.22, 0.2, 0.75);
  f.span(M.steel, -0.05, 0.2, -0.3, 0.05, 0.6, -0.2);
  f.span(M.steel, -0.05, 0.2, 0.2, 0.05, 0.6, 0.3);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    f.cyl(M.steel, su * 0.2, 0.06, sv * 0.7, 0.012, 0.012, 0.07, 6);
    f.hcyl(M.black, su * 0.2, 0.05, sv * 0.7, 0.05, 0.035, 10, 'u');
  }
  f.rod(M.steel, [0.25, 0.64, 0.95], [0.25, 1.4, 1.0], 0.012, 6); // the IV pole, bent
  // the mattress where it landed, the sheet dragged off it
  const g = new Frame(c, x, z, yaw);
  g.add(X.g_mattress, rbox(0.62, 0.09, 1.85, 0.03), -1.3, 0.06, 0.1, [0, 0.12, 0.05]);
  if (sheet) g.add(M.white, rbox(0.8, 0.012, 1.2, 0.004), -1.75, 0.008, 0.5 + rnd() * 0.2, [0, 0.5, 0]);
  f.col(-0.3, -0.98, 0.3, 0.98, 0.9, SURF.metal);
}

/**
 * A BSL step-over bench at (x, z) turned yaw (its length along u): a low stainless bench on four legs, the hazard
 * line on the floor under it, CLEAN / DIRTY stencilled either side, a pair of boots left behind. len across.
 */
export function stepOverBench(c, x, z, yaw = 0, { len = 1.6 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const lh = len / 2;
  f.span(X.g_steel, -lh, 0.42, -0.17, lh, 0.45, 0.17, 0.01);
  for (const s of [-1, 1]) {
    f.span(X.g_steel, s * (lh - 0.1) - 0.02, 0, -0.14, s * (lh - 0.1) + 0.02, 0.42, -0.1);
    f.span(X.g_steel, s * (lh - 0.1) - 0.02, 0, 0.1, s * (lh - 0.1) + 0.02, 0.42, 0.14);
    f.span(X.g_steel, s * (lh - 0.1) - 0.02, 0.1, -0.12, s * (lh - 0.1) + 0.02, 0.13, 0.12);
  }
  f.span(M.hazard, -lh - 0.3, 0, -0.05, lh + 0.3, 0.006, 0.05);
  for (const [v, t, a] of [[-0.55, 'DIRTY', PI], [0.55, 'CLEAN', 0]]) {
    const p = f.p(0, 0.008, v);
    c.label(t + ' SIDE', p.x, 0.008, p.z, 'up', 0.9, 0.2, { bg: '#1b2127', fg: '#ffd23a', font: 'bold 64px Arial', yaw: f.yaw + a });
  }
  for (const s of [-1, 1]) f.add(X.g_neoprene, rbox(0.1, 0.32, 0.26, 0.03), 0.3 + s * 0.07, 0.16, 0.32 + rnd() * 0.05, [0, rnd() * 0.3, 0]);
  f.col(-lh, -0.17, lh, 0.17, 0.45, SURF.metal);
}

/**
 * A double-sided island of two oldBench halves back to back, centred at (x, z), len along x (alongX) or z, a service
 * upstand down the spine carrying a two-tier reagent shelf (bottles both faces). opts: depth (overall), gear (per
 * side), shelf, modern, open (a cupboard left open on the front half), burnt (the back half charred)
 */
export function oldIsland(c, x, z, len, alongX, { depth = 1.3, gear = 2, shelf = true, modern = false, open = -1, burnt = false } = {}) {
  const { M, X } = c;
  const face = alongX ? 's' : 'e';
  oldBench(c, x, z, face, len, { depth: depth / 2, shelf: false, spine: true, gear, modern, open });
  oldBench(c, x, z, BACK[face], len, { depth: depth / 2, shelf: false, spine: true, gear, modern, burnt });
  const f = new Frame(c, x, z, face);
  const Lh = len / 2, T = 0.92, front = modern ? M.white : X.g_teak;
  f.span(front, -Lh, T, -0.035, Lh, T + 0.14, 0.035);
  const ns = Math.max(1, Math.floor(len / 1.2));
  for (let i = 0; i < ns; i++) {
    const p = f.p(-Lh + (len * (i + 0.5)) / ns, 0, 0.036);
    L.socket(c, p.x, T + 0.07, p.z, face, 2);
  }
  if (!shelf) return f;
  const nu = len > 3 ? 3 : 2;
  for (let i = 0; i < nu; i++) {
    const u = -Lh + 0.12 + (i * (len - 0.24)) / (nu - 1);
    f.span(M.steel, u - 0.015, T + 0.14, -0.015, u + 0.015, 1.7, 0.015);
  }
  for (const y of [1.3, 1.64]) {
    f.span(modern ? M.grey : X.g_teak, -Lh + 0.06, y, -0.15, Lh - 0.06, y + 0.025, 0.15);
    bottles(f, -Lh + 0.1, Lh - 0.1, y + 0.025, -0.07, Math.round(len * 1.3), { gaps: 0.25 });
    bottles(f, -Lh + 0.1, Lh - 0.1, y + 0.025, 0.07, Math.round(len * 1.3), { gaps: 0.25 });
  }
  return f;
}

// ---------------------------------------------------------------- the rooms
/**
 * Lab 5-C, cell culture (the older, warmer floor): two biosafety cabinets, the CO₂ incubators and their cylinders, the
 * anaerobic chamber and a −80 along the north wall; the centrifuge bench (timber, with the sink), the floor centrifuge,
 * the media fridge and the −20 chest down the west; the culture island with its microscopes; someone's lunch on the
 * write-up desk under the passage log; the gurney knocked over, a blood trail from 5-D's door to the corridor.
 */
function lab5C(c, s, ctx) {
  const { K, M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // north wall: the cabinets, the incubators and their CO₂, the anaerobic chamber, the −80 in the corner
  L.biosafetyCabinet(c, x0 + 0.9, z0, 's', { w: 1.5, uv: false, light: true, mess: true });
  L.biosafetyCabinet(c, x0 + 2.5, z0, 's', { w: 1.5, uv: true, light: true, mess: false });
  L.incubator(c, x0 + 3.75, z0, 's', { stack: 2, open: 1 });
  L.incubator(c, x0 + 4.55, z0, 's', { stack: 2 });
  P.gasCylinder(c, x0 + 5.1, z0 + 0.2, M.grey);
  P.gasCylinder(c, x0 + 5.45, z0 + 0.18, M.grey);
  K.box(M.dark, x0 + 4.95, 1.05, z0, x0 + 5.6, 1.09, z0 + 0.32);
  // the CO₂ line: copper up from the regulators, along the wall, down into the incubator stacks
  for (const [a, b] of [[[x0 + 5.28, 1.5], [x0 + 5.28, 2.3]], [[x0 + 5.28, 2.3], [x0 + 3.75, 2.3]], [[x0 + 3.75, 2.3], [x0 + 3.75, 1.95]], [[x0 + 4.55, 2.3], [x0 + 4.55, 1.95]]]) K.rod(X.copper, V(a[0], a[1], z0 + 0.05), V(b[0], b[1], z0 + 0.05), 0.008, 6);
  gloveBox(c, x0 + 6.9, z0, 's', { kind: 'anaerobic', len: 2.2, name: 'ANAEROBIC CHAMBER 1' });
  L.freezerUpright(c, x1, z0 + 1.0, 'w', { alarm: true, note: ['PRIMARY LINES', 'K-7 · HEK · VERO'] });
  L.noticeBoard(c, x0 + 4.15, 2.45, z0, 's', { w: 1.3, h: 0.55, notes: ['MYCOPLASMA TEST · FRI', 'WHO TOOK MY P200s?', 'HOOD 1 UV TUBE DEAD'] });
  roomTitle(c, 'LAB 5-C · CELL CULTURE', x0 + 3.9, 2.95, z0 + 0.01, 's', 2.4, '#3fbf6a');
  L.hazardPlacard(c, x0 + 0.9, 2.75, z0, 's', 'bio', { w: 0.42 });
  L.wallClock(c, x0 + 6.9, 2.7, z0, 's');
  L.wasteBin(c, x0 + 2.5, z0 + 1.2, { kind: 'bio' });
  // west wall: the centrifuge bench (its sink at the north end), the floor centrifuge, media fridge, the −20 chest
  oldBench(c, x0, -9.35, 'e', 3.4, { sink: 1.1, gear: 1, shelf: true, open: 3 });
  L.centrifuge(c, x0 + 0.4, 0.92, -8.3, PI / 2, { open: true });
  invertedMicroscope(c, x0 + 0.42, 0.92, -9.7, PI / 2);
  cultureFlasks(c, x0 + 0.45, 0.92, -7.88, PI / 2 + 0.2, 3);
  L.floorCentrifuge(c, x0, -7.15, 'e');
  L.labFridge(c, x0, -6.2, 'e', { stock: 'media', display: '+4 °C' });
  A.chestFreezer(c, x0, -4.8, 'e', { w: 1.3, temp: '−20 °C', top: 'boxes', note: ['FBS · TRYPSIN', 'DO NOT DEFROST'] });
  L.eyewash(c, x0, -3.75, 'e');
  P.extinguisher(c, x0, -3.25, 'e');
  L.socket(c, x0, 0.3, -6.75, 'e');
  // south wall: the hand basin by the way out; the lab phone, its receiver left hanging
  L.sinkUnit(c, x0 + 0.6, z1, 'n', { kind: 'hand' });
  Fac.wallPhone(c, x1 - 1.0, 1.45, z1, 'n', { number: 'LAB 5-C · 4471', off: true });
  L.hazardPlacard(c, x1 - 1.0, 2.55, z1, 'n', 'nofood', { w: 0.45 });
  // east wall, south of 5-D's door: the write-up desk (lunch half eaten), its lamp, the passage log above it
  Fac.officeDesk(c, x1 - 0.4, -3.85, 'w', { w: 1.4, d: 0.75, mess: true, top: X.g_oak, chair: true, pc: false });
  deskMeal(c, x1 - 0.45, 0.74, -3.45, -PI / 2);
  Fac.deskLamp(c, x1 - 0.2, 0.74, -4.35, -PI / 2 - 0.4, { on: true, light: true });
  L.whiteboardFormula(c, x1, -3.85, 'w', {
    w: 1.5, y: 1.95, h: 0.75, title: 'K-7 · PASSAGE LOG',
    lines: ['P12  confl. 80 %  split 1:4', 'P13  CPE at 36 h (!!)', 'P14  → incubator 2, top', 'titre ↑ 3 log — tell Hale'],
    note: 'MEDIA CHANGE 06:00 · M.',
  });
  L.firstAidBox(c, x1, 1.55, -2.85, 'w');
  L.socket(c, x1, 0.3, -4.9, 'w');
  // the culture island: microscopes and flasks one side, the water bath and vortex the other
  oldIsland(c, -30.2, -8.0, 3.4, true, { depth: 1.3, gear: 0, open: 3 });
  invertedMicroscope(c, -30.9, 0.92, -7.62, 0);
  cultureFlasks(c, -31.5, 0.92, -7.7, 0.2, 3);
  L.benchKit(c, -30.0, 0.92, -8.4, PI, 'waterbath');
  L.labStool(c, -30.9, -6.9);
  // what happened: the gurney over, a trail from 5-D's door past the tube to the corridor, papers dropped
  gurneyOver(c, -32.2, -6.5, PI / 2);
  c.wallDecal('bloodSmear', x1, 1.15, -6.15, 'w', 0.45, 0.7);
  c.decal('bloodDrag', -26.0, -7.5, 1.4, PI / 2 + 0.2);
  c.decal('blood', -27.6, -7.0, 0.7, rnd() * PI);
  c.decal('bloodDrag', -29.2, -6.3, 1.5, 2.3);
  c.decal('footprints', -29.8, -4.6, 1.4, PI + 0.2);
  floorPapers(c, -26.7, -3.2, 4, 0.45);
  c.decal('stain', -27.0, -10.3, 0.8, rnd() * PI);
}

/** labs 5-C and 5-D (one plan, `s.id` picks the personality): see lab5C / lab5D */
export function dressUlab(c, s, ctx) {
  if (s.id === 'ulabD') lab5D(c, s, ctx);
  else lab5C(c, s, ctx);
}

/**
 * Lab 5-D, chemistry & prep, where it went wrong: two fume hoods (the second burnt out), the 50 L reactor blown open
 * under its red beacon, the solvent cabinets; the prep bench with the rotovap and the drying rack, the safety shower,
 * the pulled fire blanket, the reagent shelving (bottles knocked off) and the waste carboys down the east; a timber
 * island, scorched on the reactor side; the benches they barricaded 5-C's door with, shoved in from the other side;
 * a hazmat suit dropped on the floor, the extinguisher bracket empty, the spill kit emptied, the spent extinguisher, trails to the corridor.
 */
function lab5D(c, s, ctx) {
  const { K, M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // north wall: the hoods (the second one burnt), the reactor and its N₂, the solvent cabinets
  L.chemHood(c, x0 + 0.85, z0, 's', { w: 1.5, ceil: h, base: 'flam' });
  L.chemHood(c, x0 + 2.45, z0, 's', { w: 1.5, ceil: h, base: 'acid', light: false, gear: 1 });
  for (let i = 0; i < 4; i++) K.add(X.g_soot, rbox(0.25 + rnd() * 0.45, 0.2 + rnd() * 0.4, 0.004), x0 + 2.45 + jit(c, 0.4), 1.2 + rnd() * 0.6, z0 + 0.905 + i * 0.002, [0, 0, jit(c, 0.5)]);
  c.wallDecal('burn', x0 + 2.45, 2.75, z0, 's', 1.7, 0.9);
  L.hazardPlacard(c, x0 + 2.45, 2.62, z0, 's', 'HOOD 2 · OUT OF SERVICE', { w: 0.62 });
  glassReactor(c, x0 + 4.75, z0, 's', { broken: true, ceil: h });
  L.warningBeacon(c, x0 + 4.6, 2.7, z0, 's', { red: true, lit: true });
  P.gasCylinder(c, x0 + 5.85, z0 + 0.2, M.green);
  K.box(M.dark, x0 + 5.7, 1.05, z0, x0 + 6.3, 1.09, z0 + 0.32);
  K.rod(X.copper, V(x0 + 6.0, 1.55, z0 + 0.05), V(x0 + 5.35, 1.55, z0 + 0.05), 0.008, 6);
  L.chemCabinet(c, x1 - 2.45, z0, 's', { kind: 'flam', w: 1.1, ajar: true });
  L.chemCabinet(c, x1 - 1.25, z0, 's', { kind: 'acid', w: 1.1 });
  L.hazardPlacard(c, x1 - 1.85, 2.2, z0, 's', 'FLAMMABLES · NO IGNITION SOURCES', { w: 0.7 });
  roomTitle(c, 'LAB 5-D · CHEMISTRY & PREP', x1 - 1.85, 2.95, z0 + 0.01, 's', 2.4, '#c63a2e');
  // east wall: the prep bench (rotovap, stirrer, balance), the drying rack over its sink, the scale-up plan
  oldBench(c, x1, -9.4, 'w', 3.2, { sink: 1.0, shelf: false, gear: 0 });
  rotovap(c, x1 - 0.42, 0.92, -10.4, -PI / 2);
  L.benchKit(c, x1 - 0.4, 0.92, -9.55, -PI / 2, 'stirrer');
  L.benchKit(c, x1 - 0.4, 0.92, -9.05, -PI / 2, 'balance');
  dryingRack(c, x1, 1.15, -8.4, 'w');
  L.whiteboardFormula(c, x1, -10.1, 'w', {
    w: 1.6, y: 1.9, h: 0.75, title: 'R-2 SCALE-UP · K-7 PRECURSOR',
    lines: ['charge 38 L THF, N₂ purge ×3', 'add B over 2 h, T < −5 °C (!)', 'exotherm @ 40 % — chiller?', 'quench ONLY at 0 °C — D.'],
    note: 'NO ONE RUNS R-2 ALONE',
  });
  L.safetyShower(c, x1, -7.3, 'w');
  fireBlanket(c, x1, 1.5, -6.75, 'w', { pulled: true });
  reagentShelf(c, x1, -5.55, 'w', { w: 1.5 });
  carboyTray(c, x1, -3.55, 'w', { n: 3, w: 1.2 });
  L.wallClock(c, x1, 2.7, -5.55, 'w');
  L.socket(c, x1, 0.3, -7.85, 'w');
  // the south-west: the extinguisher's bracket, empty (it lies spent by hood 2), the eyewash; a waste drum by the door
  K.box(M.dark, x0, 0.55, -4.0, x0 + 0.06, 0.6, -3.84);
  L.hazardPlacard(c, x0, 1.45, -3.92, 'e', 'FIRE EXTINGUISHER', { w: 0.3 });
  L.eyewash(c, x0 + 1.4, z1, 'n');
  L.firstAidBox(c, x0 + 0.6, 1.6, z1, 'n');
  P.drum(c, x1 - 1.4, z1 - 0.5, { mat: M.blue });
  L.hazardPlacard(c, x0 + 0.9, 2.55, z1, 'n', 'ppe', { w: 0.5 });
  // the island, scorched on the reactor side
  oldIsland(c, -20.2, -8.0, 3.4, true, { depth: 1.3, gear: 0, burnt: true });
  L.labStool(c, -19.4, -6.85, { yaw: 0.8 });
  // the barricade they built against 5-C's door, shoved in from the other side: tables flung back either side
  labTable(c, x0 + 1.15, -9.45, -PI / 2, { tipped: true, w: 1.3 });
  L.clawMarks(c, x0 + 0.22, 0.45, -9.45, 'w', { n: 4, len: 0.5 });
  labTable(c, x0 + 1.3, -5.6, 0.35, { w: 1.4, d: 0.7 });
  L.labStool(c, -22.6, -10.3, { down: true, yaw: 2.4 });
  // what happened: the burns, the spill kit emptied at the shelf, the extinguisher dropped, the suit, the trails
  c.decal('burn', x0 + 2.45, -10.6, 1.8, rnd() * PI);
  c.decal('burn', x0 + 4.75, -10.5, 1.3, rnd() * PI);
  spentExtinguisher(c, -21.1, -10.0, 0.7);
  c.decal('stain', -21.0, -10.4, 1.2, rnd() * PI);
  spillKit(c, -16.75, -7.45, -0.9);
  A.droppedSuit(c, -22.4, -4.3, 0.7);
  c.decal('bloodDrag', -23.0, -7.1, 1.5, 0.9);
  c.decal('blood', -21.9, -6.2, 0.8, rnd() * PI);
  c.decal('footprints', -19.3, -6.3, 1.5, 0.5);
  c.decal('slime', -18.9, -6.9, 0.9, rnd() * PI);
  floorPapers(c, -19.0, -9.3, 5, 0.6);
}

/**
 * Virology 5-E, the BSL-3 lab: the four specimen tubes (hive.js builds them) along the north wall with their placards;
 * the stainless isolator line down the west wall (chamber 2's glove ripped out, its alarm on); the airlock corner by
 * the corridor door (the PPE bench, the step-over bench with CLEAN / DIRTY either side, the door controller); a white
 * island down the middle (PCR, cryo racks, a sharps bin); east, the autoclave, the fume hood and a small biosafety
 * cabinet (UV on); another cabinet in the south-east corner by the room's pressure gauge; samples dropped, footprints out of the murk.
 */
export function dressVirology(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // the tubes' wall: placards between them, the room title over them
  L.hazardPlacard(c, x0 + 2.2, 2.6, z0, 's', 'bio', { w: 0.42 });
  L.hazardPlacard(c, x0 + 4.0, 2.6, z0, 's', 'neg', { w: 0.5 });
  L.hazardPlacard(c, x0 + 5.8, 2.6, z0, 's', 'bsl3', { w: 0.5 });
  roomTitle(c, 'VIROLOGY 5-E · BSL-3', x0 + 4.0, 3.0, z0 + 0.01, 's', 2.4, '#c63a2e');
  // west wall: the isolator line (pass box north, controller south), the blood under chamber 2's torn glove
  gloveBox(c, x0, -5.85, 'e', { kind: 'isolator', n: 3, len: 3.0, torn: 1, ceil: h, name: 'ISOLATOR LINE 5-E · NEGATIVE PRESSURE' });
  c.decal('blood', x0 + 1.25, -5.85, 0.8, rnd() * PI);
  c.decal('bloodDrag', x0 + 1.9, -5.0, 1.3, 0.4);
  // the airlock corner: the PPE bench, the entry log over it, the step-over bench, the door controller
  L.ppeBench(c, x0, -3.25, 'e', 1.4);
  L.noticeBoard(c, x0, 2.1, -3.25, 'e', { w: 1.0, h: 0.5, notes: ['ENTRY LOG · SIGN IN', 'N95 FIT TEST DUE', 'TWO-PERSON RULE'] });
  stepOverBench(c, x0 + 1.2, -4.05, 0, { len: 1.3 });
  B.doorControl(c, x0 + 0.65, 1.4, z1, 'n', { title: 'BSL-3 AIRLOCK', status: 'HOLD · INNER DOOR OPEN', alarm: true });
  L.hazardPlacard(c, x0 + 0.65, 2.3, z1, 'n', 'ppe', { w: 0.45 });
  // the south-east: the biosafety cabinet, the room's pressure gauge (gone positive), a waste bin
  L.biosafetyCabinet(c, x1 - 1.25, z1, 'n', { w: 1.5, uv: false, light: true, mess: true });
  B.pressureMonitor(c, x1 - 2.2, 1.6, z1, 'n', { pa: '+3.1 Pa', state: 'alarm' });
  L.hazardPlacard(c, x1 - 1.25, 2.75, z1, 'n', 'sharps', { w: 0.42 });
  L.wasteBin(c, x1 - 2.4, z1 - 0.5, { kind: 'bio', open: true });
  L.wasteBin(c, x1 - 0.25, z1 - 0.55, { kind: 'bio', s: 0.8 });
  // east wall: the autoclave, the fume hood, a second (smaller) cabinet, its UV left on, the clock
  L.autoclave(c, x1, -6.85, 'w', { ceil: h, label: 'BSL-3 WASTE · 134 °C · CYCLE ABORTED' });
  L.chemHood(c, x1, -5.4, 'w', { w: 1.5, ceil: h, base: 'acid', gear: 2 });
  L.biosafetyCabinet(c, x1, -3.95, 'w', { w: 1.2, uv: true, light: true, mess: false });
  L.wallClock(c, x1, 2.7, -4.1, 'w');
  L.socket(c, x1, 0.3, -7.6, 'w');
  // the island: the PCR, cryo racks, centrifuges, the culture scope and flasks, the sharps bin
  oldIsland(c, 24.5, -5.6, 3.0, true, { depth: 1.3, gear: 1, modern: true });
  L.pcrCycler(c, 23.9, 0.92, -5.28, 0, { open: true });
  L.sampleRack(c, 25.1, 0.92, -5.3, 0.3, { kind: 'cryo' });
  L.sharpsBox(c, 25.7, 0.92, -5.25, 's', { wall: false });
  L.benchKit(c, 23.7, 0.92, -5.95, PI, 'minifuge');
  L.sampleRack(c, 25.0, 0.92, -5.95, PI, { kind: 'plates' });
  invertedMicroscope(c, 24.35, 0.92, -6.0, PI);
  L.centrifuge(c, 25.6, 0.92, -5.95, PI);
  cultureFlasks(c, 23.3, 0.92, -5.95, PI + 0.3, 3);
  // what happened: samples dropped by the island, the carrier left open, footprints from the smashed tube to the door
  droppedSamples(c, 24.8, -6.95, 0.4, { spill: 'slime' });
  C.sampleCarrier(c, 22.3, 0, -7.15, 0.8);
  c.decal('footprints', 24.0, -7.3, 1.3, 1.4);
  c.decal('footprints', 26.6, -6.4, 1.4, 0.3);
  c.decal('footprints', 26.4, -4.2, 1.4, -0.4);
  floorPapers(c, 24.1, -3.4, 3, 0.4);
}
