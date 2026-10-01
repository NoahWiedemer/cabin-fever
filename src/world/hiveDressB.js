// The Hive's isolation ward, the containment block and the morgue (world/hive.js). Room-specific props in the idiom of
// hiveProps.js / hiveLabs.js (world-space geometry for the Kit, one mesh per material, baked light, a collider for
// whatever you'd bump into) and one dress function per room, composed with the shared lab / medical / containment
// props of hiveLabs.js and the office ones of hiveFacility.js.
//
// c: hiveProps.js's build context plus X (EXTRA_MATS, baked), G (EXTRA_GLOW, emissive), label(text, x, y, z, face,
//    w, h, opts), decal(kind, x, z, size, rot), wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on).
// Wall props take (x, z) = the middle of their back edge on the wall line and `face`, the side they open toward
// ('n' -z, 's' +z, 'w' -x, 'e' +x). Free-standing ones take their centre and a yaw (radians, 0 = front toward +z).
// Bench-top items take the surface height y as well.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { SIGN, SCREEN, atlasPlane } from './lab.js';
import * as P from './hiveProps.js';
import * as L from './hiveLabs.js';
import * as Fac from './hiveFacility.js';

/** baked materials this module adds (c.X) */
export const EXTRA_MATS = {
  b_alu: { color: 0xa7aeb3, metalness: 0.7, roughness: 0.34 }, // glazing frames, sliding-door tracks
  b_chrome: { color: 0xd0d5da, metalness: 0.9, roughness: 0.2 }, // handles, levers, taps
  b_stainless: { color: 0xb4bbc0, metalness: 0.78, roughness: 0.3 }, // brushed stainless: cooler fronts, counters, trays
  b_steelDark: { color: 0x4b5157, metalness: 0.6, roughness: 0.5 }, // castors' forks, brackets, frames
  b_laminate: { color: 0xd9ddd6, roughness: 0.48 }, // the isolation cells' partition panels, pale grey-green
  b_mint: { color: 0x8fbfae, roughness: 0.55 }, // hospital trims, kick plates, bed-head trunking accents
  b_plastic: { color: 0xe9e7df, roughness: 0.45 }, // instrument housings, dispensers
  b_rubber: { color: 0x19191b, roughness: 0.92 }, // gaskets, wheels, mats
  b_sheet: { color: 0xdfe4e3, roughness: 0.95 }, // mortuary sheets, a shade bluer than the beds' linen
  b_sheetStain: { color: 0x7d5040, roughness: 0.9 }, // old brown stains through a sheet
  b_blood: { color: 0x4a0a07, roughness: 0.3 }, // wet blood on steel and glass
  b_skin: { color: 0xb3a598, roughness: 0.72 }, // a dead man's foot and hand, grey-pale
  b_bagWhite: { color: 0xd5d8d2, roughness: 0.45 }, // white PEVA body bags
  b_zip: { color: 0x2a2c2e, metalness: 0.4, roughness: 0.5 },
  b_tag: { color: 0xd9c792, roughness: 0.85 }, // manila toe tags, name cards
  b_apron: { color: 0x2d4a39, roughness: 0.5 }, // green rubber aprons
  b_apronY: { color: 0xd8bd34, roughness: 0.5 }, // yellow isolation gowns and aprons
  b_boot: { color: 0x22382a, roughness: 0.6 }, // wellingtons
  b_formalin: { color: 0xd8d29a, roughness: 0.12 }, // the jars' pale fixative
  b_organ: { color: 0x6b2b2a, roughness: 0.38 },
  b_meat: { color: 0x7c2a24, roughness: 0.4 }, // the containment block's feeding trays
  b_bone: { color: 0xe3dccb, roughness: 0.6 },
  b_hazYellow: { color: 0xe2b31a, roughness: 0.5 }, // control boxes, riot gear trims
  b_shield: { color: 0x1d2024, roughness: 0.5 }, // black polymer: riot shield rim, helmet
  b_suit: { color: 0xc89e22, roughness: 0.68 }, // a torn containment suit
  b_ledger: { color: 0x3b2a22, roughness: 0.7 }, // the mortuary register's cover
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  b_lcdGreen: [0x7dffb0, 1.4], // pressure monitors, scale readouts
  b_lcdRed: [0xff4a36, 1.7], // alarms
  b_lcdAmber: [0xffb440, 1.5],
  b_cooler: [0x9fd6ff, 1.3], // the cooler bank's temperature displays
  b_inUse: [0xff3b2a, 1.9], // the ROOM IN USE lamps over the isolation doors
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const YAW = P.FACE_YAW;
const RIGHT = { s: 'e', e: 'n', n: 'w', w: 's' }; // the +u side of a thing facing `face`
const LEFT = { s: 'w', e: 's', n: 'e', w: 'n' };
const BACK = { s: 'n', n: 's', e: 'w', w: 'e' };
const nearFace = (yaw) => ['s', 'e', 'n', 'w'][((Math.round(yaw / (PI / 2)) % 4) + 4) % 4];
/** label colours: a filled tag (bg = border) */
const tag = (bg, fg, font = 'bold 44px Arial') => ({ bg, fg, border: bg, font });

// ---------------------------------------------------------------- shared geometry (built once, cloned by the Kit)
const _geo = new Map();
const cached = (key, make) => {
  let g = _geo.get(key);
  if (!g) _geo.set(key, (g = make()));
  return g;
};
const k3 = (...a) => a.map((v) => Math.round(v * 1000)).join(',');
/** a w × h × d box geometry, centred; rounded edges of radius r when r ≥ 0.015 (a rounded box is ~9× the triangles: below that it wouldn't show) */
function rbox(w, h, d, r = 0) {
  if (r >= 0.015) return cached('r' + k3(w, h, d, r), () => new RoundedBoxGeometry(w, h, d, 1, r));
  return cached('b' + k3(w, h, d), () => new THREE.BoxGeometry(w, h, d));
}
/** a cylinder standing on y 0 (r0 bottom, r1 top) */
const cylG = (r0, r1, h, seg = 12, open = false) => cached('c' + k3(r0, r1, h) + ':' + seg + open, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(0, h / 2, 0));
/** a centred cylinder along y */
const cylC = (r0, r1, h, seg = 12) => cached('cc' + k3(r0, r1, h) + ':' + seg, () => new THREE.CylinderGeometry(r1, r0, h, seg));
const sphG = (r, ws = 10, hs = 8) => cached('s' + k3(r) + ':' + ws + ':' + hs, () => new THREE.SphereGeometry(r, ws, hs));
const domeG = (r, ws = 12) => cached('d' + k3(r) + ':' + ws, () => new THREE.SphereGeometry(r, ws, 5, 0, PI * 2, 0, PI / 2));
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const capG = (r, l, cs = 4, rs = 8) => cached('p' + k3(r, l) + ':' + cs + ':' + rs, () => new THREE.CapsuleGeometry(r, l, cs, rs));
const planeG = (w, h) => cached('q' + k3(w, h), () => new THREE.PlaneGeometry(w, h));
const tube = (pts, seg = 8, r = 0.01, rs = 5) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => V(x, y, z))), seg, r, rs);

// ---------------------------------------------------------------- the local frame
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = V(), _s = V(1, 1, 1);
/**
 * A prop's local frame (as in hiveLabs.js): u across (to the right of someone looking at its front), y up, v out from
 * its back toward its front. Built at (x, y, z) turned by `face` (a face letter or a yaw), optionally tilted ([rx, rz],
 * applied before the yaw). Everything it adds goes to the Kit in world space.
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
  /** any geometry at local (u, y, v), rotated [rx, ry, rz(, order)] and scaled */
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
  hcyl(mat, u, y, v, r, len, seg = 12, axis = 'u') {
    return this.add(mat, cylC(r, r, len, seg), u, y, v, axis === 'u' ? [0, 0, PI / 2] : [PI / 2, 0, 0]);
  }
  rod(mat, a, b, r, seg = 6) {
    return this.c.K.rod(mat, this.p(a[0], a[1], a[2]), this.p(b[0], b[1], b[2]), r, seg);
  }
  /** a flat picture facing the front, `rect` an atlas region */
  plane(mat, w, h, u, y, v, rect = null, W = 1024, H = 1024) {
    return this.add(mat, rect ? atlasPlane(w, h, rect, W, H) : planeG(w, h), u, y, v);
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
  light(u, y, v, i, r, rgb = [0.93, 0.97, 1.0], dir = null, range = null) {
    const p = this.p(u, y, v);
    this.c.light(p.x, p.y, p.z, i, r, rgb, dir, range);
  }
  /** the collider of a local box (its world AABB) */
  col(u0, v0, u1, v1, y1, surf = SURF.metal, flags = 0, y0 = 0, tag = null) {
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
    this.c.col(x0, Math.max(0, y0), z0, x1, y1, z1, surf, flags, tag);
  }
}

/** a label lying 2 mm proud of the frame's front plane v (c.label floats its text 2 cm out on its own) */
const txt = (f, text, u, y, v, w, h, opts) => f.label(text, u, y, v - 0.018, w, h, opts);
/** a power socket face (n gangs) on the frame's front plane v */
function socketAt(f, u, y, v, n = 2, mat = null) {
  const { M } = f.c;
  const w = 0.085 * n;
  f.box(mat ?? M.white, u, y, v + 0.006, w, 0.085, 0.012);
  for (let i = 0; i < n; i++) {
    const a = u - w / 2 + 0.0425 + i * 0.085;
    for (const s of [-0.012, 0.012]) f.box(M.black, a + s, y + 0.006, v + 0.0125, 0.005, 0.014, 0.002);
  }
}

// ---------------------------------------------------------------- the isolation ward
/** a room-pressure monitor on the wall at centre height y: the LCD reading `pa`, three status LEDs, the mute key; state 'ok' | 'warn' | 'alarm' */
export function pressureMonitor(c, x, y, z, face, { pa = '−12.4 Pa', state = 'ok' } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.b_plastic, 0, y, 0.02, 0.17, 0.25, 0.04, 0.008);
  f.box(M.black, 0, y + 0.045, 0.041, 0.135, 0.07, 0.004);
  f.box(state === 'alarm' ? G.b_lcdRed : state === 'warn' ? G.b_lcdAmber : G.b_lcdGreen, 0, y + 0.045, 0.0435, 0.12, 0.055, 0.002);
  txt(f, pa, 0, y + 0.045, 0.045, 0.11, 0.045, tag('#08100c', state === 'alarm' ? '#ff6a50' : state === 'warn' ? '#ffc060' : '#8dffb8', 'bold 60px Arial'));
  ['ok', 'warn', 'alarm'].forEach((k, i) => f.box(k === state ? [U.ledG, U.ledA, U.ledR][i] : M.dark, -0.045 + i * 0.045, y - 0.035, 0.042, 0.016, 0.016, 0.006));
  f.box(M.grey, 0, y - 0.085, 0.043, 0.05, 0.022, 0.008, 0.004);
  txt(f, 'ROOM PRESSURE', 0, y + 0.105, 0.041, 0.15, 0.026, tag('#e9e7df', '#1d2b3a', 'bold 40px Arial'));
}

/**
 * A bed-head service panel on the wall at (x, z): the trunking at height y with the medical gas outlets (O₂, AIR, VAC),
 * sockets (one red: the backed-up circuit), the nurse-call handset hanging on its cord at the +u end, a reading light
 * on a swing arm at the -u end; a vitals monitor on an arm above (`monitor`, lit `on`).
 */
export function bedheadPanel(c, x, z, face, { w = 1.3, y = 1.45, monitor = true, on = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.b_plastic, 0, y, 0.04, w, 0.26, 0.08, 0.015);
  f.box(X.b_mint, 0, y - 0.115, 0.081, w - 0.02, 0.02, 0.004);
  [['O₂', M.white, '#ffffff'], ['AIR', M.black, '#16181a'], ['VAC', M.yellow, '#e6c21b']].forEach(([t, ring, bg], i) => {
    const u = -w / 2 + 0.2 + i * 0.13;
    f.hcyl(X.b_chrome, u, y + 0.03, 0.09, 0.03, 0.02, 8, 'v');
    f.hcyl(ring, u, y + 0.03, 0.101, 0.024, 0.004, 8, 'v');
    f.hcyl(M.dark, u, y + 0.03, 0.104, 0.01, 0.004, 6, 'v');
    txt(f, t, u, y - 0.055, 0.081, 0.08, 0.035, tag(bg, i === 1 ? '#ffffff' : '#16181a', 'bold 50px Arial'));
  });
  socketAt(f, w / 2 - 0.42, y + 0.02, 0.08);
  socketAt(f, w / 2 - 0.22, y + 0.02, 0.08, 2, M.red);
  // the nurse call: cord down from the trunking, the handset with its red button
  f.add(M.grey, cached('callCord', () => tube([[0, 0, 0], [0.03, -0.25, 0.05], [0.06, -0.55, 0.12], [0.04, -0.72, 0.16]], 10, 0.005, 4)), w / 2 - 0.06, y - 0.1, 0.06);
  f.box(X.b_plastic, w / 2 - 0.02, y - 0.9, 0.22, 0.05, 0.15, 0.035, 0.012, [0.15, 0, 0]);
  f.box(M.red, w / 2 - 0.02, y - 0.86, 0.24, 0.025, 0.025, 0.008, 0, [0.15, 0, 0]);
  // the reading light
  f.cyl(M.grey, -w / 2 + 0.07, y + 0.13, 0.05, 0.02, 0.02, 0.03, 8);
  f.rod(M.grey, [-w / 2 + 0.07, y + 0.16, 0.05], [-w / 2 + 0.12, y + 0.42, 0.2], 0.008, 4);
  f.add(M.grey, cylC(0.03, 0.05, 0.08, 10), -w / 2 + 0.13, y + 0.4, 0.24, [0.9, 0, 0]);
  if (!monitor) return;
  // the vitals monitor on its arm, turned a little toward the door side
  const mu = w / 2 - 0.12;
  f.box(M.dark, mu, y + 0.2, 0.06, 0.06, 0.12, 0.06, 0.01);
  f.rod(M.dark, [mu, y + 0.25, 0.06], [mu, y + 0.48, 0.12], 0.012, 6);
  f.box(M.dark, mu, y + 0.62, 0.17, 0.36, 0.27, 0.06, 0.012);
  f.screen(mu, y + 0.62, 0.201, 0.32, 0.21, on, 'vitals');
}

/**
 * An isolation room over the rect, glazed toward `face`: full-height laminate partitions (`sides` [-u, +u] drawn; a
 * row of rooms shares them), a glazed front with a frosted band, a sliding glass door (middle at u `door`) on its
 * track, the transom with the room's name, its precautions and the ROOM IN USE lamp, a service column with the
 * pass-through hatch, the intercom and a pressure monitor; a low extract grille and a floor drain inside (the bed goes
 * in separately). state 'sealed' (door shut, the room a no-spawn void), 'open' (the door off its track, leant against
 * the front, on the `lean` side: the room open) or 'smashed'
 * (the glass burst outward, the door torn off its track and down on the floor, blood).
 */
export function isoCell(c, x0, z0, x1, z1, face, { n = 'ISOLATION 1', state = 'sealed', door = -0.36, sides = [true, true], h = 3.0, pa = null, lean = 1 } = {}) {
  const { M, U, X, G, rnd } = c;
  const alongX = face === 's' || face === 'n';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const bx = face === 'e' ? x0 : face === 'w' ? x1 : (x0 + x1) / 2, bz = face === 's' ? z0 : face === 'n' ? z1 : (z0 + z1) / 2;
  const f = new Frame(c, bx, bz, face);
  const t = 0.1, H = h - 0.005, fv0 = D - 0.12, fv1 = D - 0.06, top = 2.25, dw = 0.95;
  const smashed = state === 'smashed', open = state === 'open';
  // the partitions: laminate on a mint kick strip
  for (const s of [-1, 1]) {
    if (!sides[s < 0 ? 0 : 1]) continue;
    const ua = Math.min(s * (W / 2), s * (W / 2 - t)), ub = Math.max(s * (W / 2), s * (W / 2 - t));
    f.span(X.b_laminate, ua, 0.12, 0, ub, H, fv0);
    f.span(X.b_mint, ua - 0.003, 0, 0, ub + 0.003, 0.12, fv0);
    f.col(ua, 0, ub, fv0, H, SURF.plaster);
  }
  // the front: the transom, posts and jambs, the fixed pane, the service column
  const du0 = door - dw / 2, du1 = door + dw / 2, col0 = W / 2 - 0.42, cu = (col0 + W / 2) / 2;
  f.span(X.b_laminate, -W / 2, top, fv0, W / 2, H, fv1);
  f.span(X.b_alu, -W / 2, top - 0.04, fv0 - 0.004, col0, top, fv1 + 0.004);
  f.col(-W / 2, fv0, W / 2, fv1, H, SURF.plaster, 0, top);
  for (const [a, b] of [[-W / 2, du0], [du1, du1 + 0.05]]) {
    f.span(X.b_alu, a, 0, fv0, b, top, fv1);
    f.col(a, fv0, b, fv1, top, SURF.metal);
  }
  f.span(X.b_alu, du0, 0, fv0, du1, 0.015, fv1);
  const g0 = du1 + 0.05, g1 = col0;
  f.span(X.b_alu, g0, 0, fv0, g1, 0.1, fv1);
  if (!smashed) {
    f.span(U.glass, g0, 0.1, D - 0.1, g1, top - 0.04, D - 0.08);
    f.span(M.frost, g0, 1.42, D - 0.079, g1, 1.5, D - 0.077);
    f.col(g0, fv0, g1, fv1, top, SURF.glass);
  } else {
    for (let k = 0; k < 3; k++) f.add(U.glass, new THREE.ConeGeometry(0.04, 0.12 + rnd() * 0.22, 3), g0 + ((k + 0.5) * (g1 - g0)) / 3, 0.16, D - 0.09, [0, rnd() * 3, (rnd() - 0.5) * 0.4]);
    for (let k = 0; k < 2; k++) f.add(U.glass, new THREE.ConeGeometry(0.04, 0.1 + rnd() * 0.18, 3), g0 + ((k + 0.5) * (g1 - g0)) / 2, top - 0.1, D - 0.09, [PI, rnd() * 3, 0]);
  }
  f.span(X.b_laminate, col0, 0.12, fv0, W / 2, top, fv1);
  f.span(X.b_mint, col0, 0, fv0 - 0.003, W / 2, 0.12, fv1 + 0.003);
  f.col(col0, fv0, W / 2, fv1, top, SURF.plaster);
  f.span(X.b_stainless, cu - 0.15, 0.98, fv0 - 0.05, cu + 0.15, 1.26, fv1 + 0.04, 0.01);
  f.span(M.dark, cu - 0.12, 1.0, fv1 + 0.04, cu + 0.12, 1.24, fv1 + 0.042);
  f.box(X.b_chrome, cu + 0.08, 1.12, fv1 + 0.05, 0.02, 0.1, 0.016);
  txt(f, 'PASS-THROUGH', cu, 1.3, fv1, 0.3, 0.04, tag('#e9e7df', '#1d2b3a', 'bold 40px Arial'));
  f.box(M.grey, cu, 1.45, fv1 + 0.01, 0.12, 0.15, 0.02, 0.006);
  for (let i = 0; i < 4; i++) f.box(M.black, cu, 1.48 + i * 0.016, fv1 + 0.021, 0.08, 0.006, 0.002);
  f.hcyl(M.black, cu, 1.405, fv1 + 0.024, 0.014, 0.01, 8, 'v');
  const pp = f.p(cu, 0, fv1);
  const ps = state === 'sealed' ? 'ok' : open ? 'warn' : 'alarm';
  pressureMonitor(c, pp.x, 1.72, pp.z, face, { pa: pa ?? (ps === 'ok' ? '−12.4 Pa' : ps === 'warn' ? '−1.1 Pa' : '+0.2 Pa'), state: ps });
  // the transom: the room's name, the precautions, the IN USE lamp
  txt(f, n, -0.1, 2.62, fv1, Math.min(W - 0.5, 1.2), 0.17, tag('#1f5fa6', '#ffffff', 'bold 64px Arial'));
  txt(f, 'AIRBORNE PRECAUTIONS · FFP3', -0.1, 2.43, fv1, Math.min(W - 0.4, 1.3), 0.08, tag('#e2b31a', '#16181a', 'bold 40px Arial'));
  f.box(M.dark, W / 2 - 0.22, 2.84, fv1 + 0.012, 0.3, 0.09, 0.024, 0.008);
  f.box(state === 'sealed' ? G.b_inUse : M.grey, W / 2 - 0.22, 2.84, fv1 + 0.025, 0.26, 0.06, 0.004);
  // the sliding door on its track (it runs outside the front, toward the service column)
  f.span(X.b_alu, du0 - 0.04, top - 0.02, fv1, col0, top + 0.08, D - 0.005);
  const leaf = (fr, u, y, v, glass = true) => {
    if (glass) {
      fr.box(U.glass, u, y, v, dw - 0.08, 2.0, 0.014);
      fr.box(M.frost, u, y + 0.35, v + 0.008, dw - 0.08, 0.08, 0.002);
    }
    for (const s of [-1, 1]) fr.box(X.b_alu, u + s * (dw / 2 - 0.025), y, v, 0.05, 2.1, 0.04);
    for (const s of [-1, 1]) fr.box(X.b_alu, u, y + s * 1.02, v, dw, 0.06, 0.04);
    fr.box(X.b_chrome, u - dw / 2 + 0.1, y, v + 0.032, 0.022, 0.6, 0.016, 0.006);
    for (const s of [-1, 1]) fr.box(X.b_chrome, u - dw / 2 + 0.1, y + s * 0.27, v + 0.02, 0.018, 0.018, 0.024);
  };
  const vd = D - 0.035;
  if (state === 'sealed') {
    leaf(f, door, 1.1, vd);
    f.col(du0, fv1, du1, D, top, SURF.glass);
  } else if (open) {
    // lifted off its track (it couldn't slide past the service column) and leant against the front beside the
    // opening, on its +u side or (lean -1) out over the neighbour's front on its -u side
    const lu = lean > 0 ? du1 + dw / 2 - 0.05 : du0 - dw / 2 + 0.05;
    const p = f.p(lu, 0, D + 0.17);
    leaf(new Frame(c, p.x, p.z, f.yaw, { tilt: [-0.07, 0] }), 0, 1.07, 0);
    f.col(lu - dw / 2, D, lu + dw / 2, D + 0.2, 2.15, SURF.glass);
  } else {
    // torn off its track and down on its face in front of the room, the glass gone to crumbs
    const p = f.p(door + 0.15, 0, D + 0.12);
    const fl = new Frame(c, p.x, p.z, f.yaw + 0.22, { y: 0.05, tilt: [PI / 2, 0] });
    leaf(fl, 0, 1.06, 0, false);
    for (let k = 0; k < 14; k++) f.box(U.glass, du0 + rnd() * (g1 - du0 + 0.4), 0.004, D + 0.15 + rnd() * 1.5, 0.04 + rnd() * 0.07, 0.004, 0.03 + rnd() * 0.06, 0, [0, rnd() * 3, 0]);
    const q = f.p((g0 + g1) / 2, 0, D + 0.8);
    c.decal('glass', q.x, q.z, 1.4, rnd() * 3);
    const b = f.p(door, 0, D - 0.7);
    c.decal('blood', b.x, b.z, 0.9, rnd() * 3);
    const w = f.p(cu, 0, fv1);
    c.wallDecal('bloodSmear', w.x, 0.55, w.z, face, 0.3, 0.6);
  }
  // inside: the extract grille low on the back wall (negative pressure pulls the air down and out), the floor drain
  const ev = f.p(-W / 2 + 0.3, 0, 0);
  L.wallVent(c, ev.x, 0.32, ev.z, face, 0.28, 0.22);
  const dp = f.p(-W / 2 + 0.3, 0, D - 0.5);
  L.drainGrate(c, dp.x, dp.z, 0.22, 0.22);
  if (state === 'sealed') f.col(-W / 2 + t, 0.02, W / 2 - t, fv0, H, SURF.metal, FLAG_NOBULLET, 0.02, 'cellVoid');
  return f;
}

/** true when the frame is turned to a whole quarter (its labels can face a compass side) */
const axial = (f) => Math.abs(f.yaw - Math.round(f.yaw / (PI / 2)) * (PI / 2)) < 0.01;

/**
 * A wall PPE station at (x, z), its shelves round height y: glove boxes in three sizes (a glove pulled half out of
 * each), a mask box, a roll of yellow isolation gowns on its bar, the hand-rub pump on a bracket, the instruction sign.
 */
export function ppeStation(c, x, z, face, { w = 0.95, y = 1.3 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.b_alu, 0, y, 0.006, w, 0.78, 0.012, 0.004);
  for (const yy of [y + 0.12, y - 0.2]) {
    f.box(X.b_alu, 0, yy, 0.08, w - 0.04, 0.012, 0.15);
    f.box(X.b_alu, 0, yy + 0.03, 0.152, w - 0.04, 0.05, 0.006);
  }
  [M.blue, X.b_mint, M.yellow].forEach((stripe, i) => {
    const u = -w / 2 + 0.17 + i * 0.25;
    f.box(M.white, u, y + 0.185, 0.08, 0.22, 0.12, 0.12, 0.006);
    f.box(stripe, u, y + 0.235, 0.08, 0.222, 0.02, 0.122);
    f.box(M.dark, u, y + 0.19, 0.141, 0.1, 0.03, 0.002);
    f.add(M.blue, sphG(0.035, 6, 4), u + 0.01, y + 0.19, 0.15, null, [1.3, 0.5, 0.8]);
    txt(f, ['S', 'M', 'L'][i], u + 0.08, y + 0.15, 0.14, 0.03, 0.03, tag('#ffffff', '#1d2b3a', 'bold 60px Arial'));
  });
  f.box(M.white, -w / 2 + 0.2, y - 0.12, 0.08, 0.26, 0.15, 0.13, 0.006);
  txt(f, 'FFP3 MASKS', -w / 2 + 0.2, y - 0.12, 0.145, 0.2, 0.04, tag('#ffffff', '#1f5fa6', 'bold 44px Arial'));
  // the gown roll: a bar between two brackets, the loose end hanging
  for (const s of [-1, 1]) f.box(X.b_alu, 0.18 + s * 0.2, y - 0.26, 0.09, 0.012, 0.1, 0.1);
  f.hcyl(X.b_chrome, 0.18, y - 0.29, 0.12, 0.008, 0.42, 6, 'u');
  f.hcyl(X.b_apronY, 0.18, y - 0.29, 0.12, 0.055, 0.34, 12, 'u');
  f.box(X.b_apronY, 0.18, y - 0.42, 0.175, 0.3, 0.24, 0.004, 0, [0.12, 0, 0]);
  // hand rub on its bracket, the drip tray under it
  f.box(X.b_alu, w / 2 + 0.12, y - 0.05, 0.03, 0.12, 0.26, 0.012);
  f.box(X.b_plastic, w / 2 + 0.12, y - 0.05, 0.075, 0.09, 0.2, 0.07, 0.02);
  f.cyl(M.white, w / 2 + 0.12, y + 0.05, 0.075, 0.012, 0.012, 0.05, 6);
  f.box(M.white, w / 2 + 0.12, y + 0.1, 0.095, 0.022, 0.016, 0.06);
  f.box(M.grey, w / 2 + 0.12, y - 0.2, 0.08, 0.1, 0.012, 0.09);
  txt(f, 'PPE · PUT ON BEFORE ENTRY', 0, y + 0.47, 0.012, w, 0.09, tag('#1f5fa6', '#ffffff', 'bold 44px Arial'));
}

/**
 * The glazed screen of a nurses' station, standing on its ledge at height y0 along the line through (x, z) (it faces
 * `face`): aluminium posts and head rail, a frosted band, a speaking grille, the sliding pane pushed back over its
 * neighbour (the opening `slide` wide right of the middle), the deal tray under it, a bell.
 */
export function stationGlazing(c, x, z, face, len, { y0 = 1.08, top = 2.05, slide = 0.5 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  const h = top - y0, ym = (y0 + top) / 2;
  f.box(X.b_alu, 0, y0 + 0.015, 0, len, 0.03, 0.06);
  f.box(X.b_alu, 0, top - 0.025, 0, len, 0.05, 0.06);
  for (const u of [-len / 2 + 0.02, 0, len / 2 - 0.02]) f.box(X.b_alu, u, ym, 0, 0.04, h, 0.05);
  const o0 = 0.02, o1 = 0.02 + slide;
  for (const [a, b] of [[-len / 2 + 0.04, -0.02], [o1, len / 2 - 0.04]]) {
    if (b - a < 0.05) continue;
    f.span(U.glass, a, y0 + 0.03, -0.006, b, top - 0.05, 0.006);
    f.span(M.frost, a, y0 + 0.42, 0.006, b, y0 + 0.5, 0.008);
    f.col(a, -0.03, b, 0.03, top, SURF.glass, 0, y0);
  }
  // the sliding pane, pushed back over the left one, its finger pull
  f.span(U.glass, o0 - slide - 0.02, y0 + 0.04, -0.03, o0 - 0.02, top - 0.06, -0.018);
  f.box(X.b_chrome, o0 - 0.06, ym, -0.03, 0.015, 0.12, 0.02);
  f.add(M.grey, cylC(0.06, 0.06, 0.014, 14), -len / 4, y0 + 0.32, 0.01, [PI / 2, 0, 0]);
  for (let i = 0; i < 4; i++) f.box(M.dark, -len / 4, y0 + 0.29 + i * 0.02, 0.018, 0.08, 0.005, 0.002);
  f.span(X.b_stainless, o0 + 0.05, y0 - 0.025, -0.15, o1 - 0.05, y0 + 0.005, 0.15);
  f.cyl(X.b_chrome, len / 2 - 0.25, y0 + 0.002, 0.15, 0.04, 0.035, 0.02, 12);
  f.add(X.b_chrome, domeG(0.035, 10), len / 2 - 0.25, y0 + 0.022, 0.15);
  if (axial(f)) txt(f, 'RING FOR ATTENTION', -len / 4, top - 0.12, 0.01, 0.4, 0.06, tag('#1f5fa6', '#ffffff', 'bold 40px Arial'));
}

/** a linen hamper trolley at (x, z) turned yaw: chrome frame on castors, the bag (red for infectious, `soiled`), the lid flipped up, sheets spilling */
export function linenCart(c, x, z, yaw, { soiled = false } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const W = 0.62, D = 0.46, H = 0.92;
  for (const [u, v] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    f.cyl(X.b_chrome, u, 0.09, v, 0.012, 0.012, H - 0.09, 6);
    f.box(X.b_steelDark, u, 0.07, v, 0.03, 0.04, 0.03);
    f.hcyl(X.b_rubber, u, 0.04, v, 0.04, 0.025, 8, 'u');
  }
  for (const y of [0.12, H]) {
    for (const s of [-1, 1]) {
      f.hcyl(X.b_chrome, 0, y, s * D / 2, 0.011, W, 6, 'u');
      f.hcyl(X.b_chrome, s * W / 2, y, 0, 0.011, D, 6, 'v');
    }
  }
  const bag = soiled ? M.red : X.b_bagWhite;
  f.box(bag, 0, 0.56, 0, W - 0.05, 0.66, D - 0.04, 0.06);
  f.box(bag, 0, H - 0.01, 0, W + 0.02, 0.04, D + 0.02, 0.015);
  f.box(X.b_plastic, 0, H + 0.2, -D / 2 - 0.02, W, 0.02, 0.42, 0.01, [-1.4, 0, 0]);
  for (let i = 0; i < (soiled ? 3 : 1); i++) f.add(X.b_sheet, capG(0.07, 0.4, 2, 6), (rnd() - 0.5) * 0.3, H + 0.02, 0.1 + i * 0.08, [PI / 2, rnd() * 3, 0.3], [1.4, 1, 0.35]);
  if (soiled) f.add(X.b_sheet, capG(0.06, 0.5, 2, 6), 0.1, H - 0.25, D / 2 + 0.05, [0.2, 0, 0.1], [1.6, 1, 0.3]);
  if (axial(f)) txt(f, soiled ? 'INFECTIOUS LINEN' : 'CLEAN LINEN', 0, 0.62, D / 2 - 0.02 + 0.02, 0.4, 0.07, tag(soiled ? '#b3141a' : '#1f5fa6', '#ffffff', 'bold 44px Arial'));
  f.col(-W / 2 - 0.03, -D / 2 - 0.03, W / 2 + 0.03, D / 2 + 0.03, H + 0.05, SURF.metal);
}

/**
 * A door control box on the wall at centre height y, beside an airlock or a cell-block door: a hazard-striped
 * backplate, the steel box with its status display (`status`, red when `alarm`), the two lamps, a key switch and the
 * red emergency release under its flip cover; the title plate over it.
 */
export function doorControl(c, x, y, z, face, { title = 'AIRLOCK CONTROL', status = 'HOLD · OTHER DOOR OPEN', alarm = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.hazard, 0, y, 0.005, 0.42, 0.56, 0.01);
  f.box(M.grey, 0, y, 0.045, 0.34, 0.48, 0.07, 0.012);
  f.box(M.black, 0, y + 0.14, 0.081, 0.26, 0.08, 0.004);
  f.box(alarm ? G.b_lcdRed : G.b_lcdGreen, 0, y + 0.14, 0.083, 0.24, 0.06, 0.002);
  txt(f, status, 0, y + 0.14, 0.085, 0.23, 0.05, tag('#140808', alarm ? '#ff6a50' : '#8dffb8', 'bold 36px Arial'));
  f.hcyl(alarm ? U.ledR : M.dark, -0.1, y + 0.04, 0.085, 0.018, 0.02, 10, 'v');
  f.hcyl(alarm ? M.dark : U.ledG, -0.04, y + 0.04, 0.085, 0.018, 0.02, 10, 'v');
  f.hcyl(X.b_chrome, 0.08, y + 0.04, 0.085, 0.025, 0.02, 12, 'v');
  f.box(X.b_steelDark, 0.08, y + 0.04, 0.1, 0.008, 0.04, 0.012, 0, [0, 0, 0.7]);
  // the release: a red mushroom in a yellow collar, the clear cover flipped up
  f.hcyl(X.b_hazYellow, 0, y - 0.11, 0.085, 0.06, 0.02, 14, 'v');
  f.hcyl(M.red, 0, y - 0.11, 0.105, 0.045, 0.03, 14, 'v');
  f.box(U.glass, 0, y - 0.02, 0.13, 0.13, 0.01, 0.12, 0, [-0.9, 0, 0]);
  txt(f, 'EMERGENCY RELEASE', 0, y - 0.2, 0.081, 0.26, 0.04, tag('#b3141a', '#ffffff', 'bold 36px Arial'));
  txt(f, title, 0, y + 0.33, 0.01, 0.42, 0.07, tag('#16181a', '#f0c030', 'bold 44px Arial'));
}

// ---------------------------------------------------------------- the morgue
/** a toe tag on its string at (u, y, v) of a frame (lying at `a` about the frame's y) */
function toeTag(f, u, y, v, a = 0) {
  const { X, M } = f.c;
  f.box(X.b_tag, u, y, v, 0.045, 0.002, 0.08, 0, [0.25, a, 0]);
  f.box(M.dark, u, y + 0.001, v - 0.03, 0.006, 0.002, 0.006, 0, [0.25, a, 0]);
}
/** a bare foot (toes toward +v, the sole toward +v too: the body lies on its back) at (u, y, v) of a frame, its ankle trailing back */
function foot(f, u, y, v, s = 1) {
  const { X } = f.c;
  f.add(X.b_skin, capG(0.04 * s, 0.14 * s, 2, 6), u, y, v - 0.08 * s, [PI / 2, 0, 0]);
  f.add(X.b_skin, rbox(0.09 * s, 0.2 * s, 0.07 * s, 0.03 * s), u, y + 0.07 * s, v + 0.02 * s, [-0.25, 0, 0]);
  f.add(X.b_skin, rbox(0.08 * s, 0.04 * s, 0.05 * s, 0.018 * s), u, y + 0.18 * s, v + 0.03 * s, [-0.25, 0, 0]);
}

/**
 * A body bag at (x, z) turned yaw (long along v, the feet toward +v), lying at height y: zipped, a handle each side,
 * or (`foot`) unzipped at the foot end with the flaps peeled back and a bare foot sticking out, a toe tag on it;
 * `white` for the white PEVA kind.
 */
export function openBag(c, x, z, yaw, { y = 0, foot: out = true, white = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  const mat = white ? X.b_bagWhite : M.bag;
  const len = out ? 1.05 : 1.3;
  f.add(mat, capG(0.25, len, 3, 8), 0, 0.13, out ? -0.12 : 0, [PI / 2, 0, 0], [1.05, 1, 0.5]);
  f.box(X.b_zip, 0.05, 0.255, out ? -0.15 : 0, 0.012, 0.008, len + 0.1);
  for (const s of [-1, 1]) for (const vv of [-0.5, 0.4]) f.box(mat, s * 0.27, 0.1, vv, 0.03, 0.025, 0.12);
  if (!out) {
    f.box(X.b_tag, 0.2, 0.2, 0.85, 0.05, 0.002, 0.08, 0, [0.3, 0, 0]);
    return;
  }
  // the foot end: the flaps peeled back off a bare foot
  for (const s of [-1, 1]) f.box(mat, s * 0.2, 0.06, 0.62, 0.2, 0.012, 0.3, 0.004, [0, s * 0.35, s * 0.5]);
  foot(f, 0.08, 0.1, 0.7);
  f.add(X.b_skin, capG(0.04, 0.12, 2, 6), -0.08, 0.08, 0.6, [PI / 2, 0, 0.1]);
  toeTag(f, 0.12, 0.3, 0.86, 0.4);
}

/**
 * A body under a sheet at (x, z) turned yaw (long along v, the head toward -v), lying at height y: the shape of a
 * man, the sheet's edges hanging over the sides, a foot with its tag poking out at +v; `sit` (0..1) raises the torso a
 * little under the sheet, `slip` drags the sheet toward +u (a corner down to the floor, an arm hanging out), `stain`
 * puts old blood through it.
 */
export function sheetedBody(c, x, z, yaw, { y = 0.9, sit = 0, slip = 0, stain = true } = {}) {
  const { X, rnd } = c;
  const f = new Frame(c, x, z, yaw, { y });
  const a = sit * 0.35;
  // the legs, the torso (tipped up by `sit` about the hips), the head
  f.add(X.b_sheet, capG(0.16, 0.7, 2, 8), slip * 0.05, 0.1, 0.4, [PI / 2, 0, 0], [1.35, 1, 0.55]);
  f.add(X.b_sheet, capG(0.2, 0.45, 2, 8), slip * 0.05, 0.13 + a * 0.4, -0.25, [PI / 2 + a, 0, 0], [1.25, 1, 0.6]);
  f.add(X.b_sheet, sphG(0.13, 8, 6), slip * 0.05, 0.16 + a * 0.9, -0.72 + a * 0.1, null, [1, 0.85, 1.15]);
  // the hanging edges: draped down both sides and over the head, the slipped corner further down
  f.box(X.b_sheet, slip * 0.04, 0.012, 0, 0.76, 0.008, 1.95);
  for (const s of [-1, 1]) {
    const drop = s > 0 ? 0.3 + slip * (y - 0.3) : 0.3 - slip * 0.2;
    f.box(X.b_sheet, s * (0.385 + (s > 0 ? slip * 0.06 : 0)), 0.016 - drop / 2, 0, 0.012, drop, 1.95, 0.004, [0, 0, s * 0.1]);
  }
  f.box(X.b_sheet, 0, -0.08, -1.0, 0.75, 0.3, 0.012, 0.004, [-0.15, 0, 0]);
  foot(f, -0.06, 0.04, 0.95);
  toeTag(f, -0.02, 0.15, 1.08, 0.3);
  if (slip > 0.3) {
    // the arm slid out from under the sheet, hanging over the edge
    f.add(X.b_skin, capG(0.035, 0.42, 2, 6), 0.42, -0.12, -0.15, [0, 0, -0.25]);
    f.add(X.b_skin, rbox(0.04, 0.12, 0.08, 0.018), 0.47, -0.42, -0.15, [0, 0, -0.2]);
  }
  if (stain) {
    for (let i = 0; i < 3; i++) f.add(i ? X.b_sheetStain : X.b_blood, planeG(0.12 + rnd() * 0.12, 0.1 + rnd() * 0.14), (rnd() - 0.5) * 0.2, i < 2 ? 0.256 + a * (i ? 0.3 : 0.6) : 0.193, -0.4 + i * 0.4, [-PI / 2, 0, rnd() * 3]);
  }
}

/**
 * The morgue's cooler bank over the rect, its doors toward `face` (the hero): a brushed-steel front of three rows of
 * insulated doors (lever latch, hinge, name cards on the occupied ones), the plinth, the refrigeration plant above
 * behind its louvres with a temperature display per bank (one alarming), the store's notice. `open` lists doors left
 * open: [column, row, load] with load 'empty' | 'bag' | 'foot' | 'sheet' (the tray slid out a metre with what's on
 * it). `names`: cards on the doors, [column, row, text].
 */
export function morgueCooler(c, x0, z0, x1, z1, face, { open = [], names = [], h = 2.45, alarm = 1 } = {}) {
  const { M, X, G, U, rnd } = c;
  const alongX = face === 's' || face === 'n';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const bx = face === 'e' ? x0 : face === 'w' ? x1 : (x0 + x1) / 2, bz = face === 's' ? z0 : face === 'n' ? z1 : (z0 + z1) / 2;
  const f = new Frame(c, bx, bz, face);
  const n = Math.max(1, Math.round(W / 0.78)), cw = W / n;
  const rows = [0.17, 0.81, 1.45], dh = 0.58, fv = D - 0.03;
  f.span(X.b_stainless, -W / 2, 0.12, 0, W / 2, h, fv);
  f.span(M.dark, -W / 2 + 0.02, 0, 0, W / 2 - 0.02, 0.12, fv - 0.06);
  f.span(M.black, -W / 2 + 0.03, 0.15, fv, W / 2 - 0.03, 2.07, fv + 0.004);
  const isOpen = (i, k) => open.find((o) => o[0] === i && o[1] === k);
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + cw * (i + 0.5);
    // the bay's mullion and its number
    if (i > 0) f.box(X.b_stainless, u - cw / 2, 1.11, fv + 0.012, 0.03, 1.94, 0.02);
    txt(f, `${i + 1}`, u, 2.115, fv, 0.1, 0.06, tag('#16181a', '#e8edf0', 'bold 60px Arial'));
    for (let k = 0; k < 3; k++) {
      const y = rows[k] + dh / 2, dw = cw - 0.06;
      const o = isOpen(i, k);
      if (!o) {
        f.box(X.b_stainless, u, y, fv + 0.016, dw, dh, 0.024, 0.006);
        f.box(X.b_chrome, u + dw / 2 - 0.07, y, fv + 0.04, 0.035, 0.16, 0.025, 0.008);
        f.box(X.b_steelDark, u - dw / 2 + 0.015, y, fv + 0.03, 0.02, dh - 0.12, 0.022);
        continue;
      }
      // open: the door swung back against its hinge, the dark mouth, the tray run out with its load
      const hu = u - dw / 2;
      f.box(X.b_stainless, hu - 0.012, y, fv + dw / 2 + 0.02, 0.024, dh, dw, 0.006, [0, -0.12, 0]);
      f.box(X.b_chrome, hu - 0.04, y, fv + dw - 0.05, 0.025, 0.16, 0.035, 0.008, [0, -0.12, 0]);
      f.box(M.black, u, y, fv + 0.006, dw, dh, 0.004);
      const ty = rows[k] + 0.06, out = o[2] === 'sheet' ? 1.25 : 1.0;
      f.span(X.b_stainless, u - dw / 2 + 0.04, ty, fv - 0.3, u + dw / 2 - 0.04, ty + 0.025, fv + out);
      for (const s of [-1, 1]) f.span(X.b_stainless, u + s * (dw / 2 - 0.04) - 0.012, ty + 0.025, fv - 0.3, u + s * (dw / 2 - 0.04) + 0.012, ty + 0.06, fv + out);
      f.box(X.b_chrome, u, ty + 0.01, fv + out + 0.015, dw - 0.2, 0.025, 0.03, 0.01);
      const load = o[2];
      const lp = f.p(u, 0, fv + out - (load === 'sheet' ? 1.1 : 0.95));
      if (load === 'bag' || load === 'foot') openBag(c, lp.x, lp.z, f.yaw, { y: ty + 0.025, foot: load === 'foot', white: rnd() < 0.4 });
      else if (load === 'sheet') sheetedBody(c, lp.x, lp.z, f.yaw, { y: ty + 0.05, stain: true });
      if (ty < 1.0) f.col(u - dw / 2, fv, u + dw / 2, fv + out + 0.03, ty + (load === 'empty' ? 0.08 : 0.35), SURF.metal);
    }
  }
  for (const [i, k, t] of names) {
    if (isOpen(i, k)) continue;
    const u = -W / 2 + cw * (i + 0.5), y = rows[k] + dh - 0.1;
    f.box(M.dark, u - 0.06, y, fv + 0.03, 0.15, 0.075, 0.006);
    txt(f, t, u - 0.06, y, fv + 0.034, 0.13, 0.06, tag('#d9c792', '#1d1b18', 'bold 34px Arial'));
  }
  // the plant above: louvres, a display per bank, the notice
  f.span(X.b_steelDark, -W / 2, 2.24, fv - 0.02, W / 2, h - 0.03, fv + 0.005);
  for (let j = 0; j < 4; j++) f.box(M.dark, 0, 2.28 + j * 0.035, fv + 0.012, W - 0.1, 0.012, 0.016, 0, [0.6, 0, 0]);
  const banks = Math.max(1, Math.round(n / 4));
  for (let b = 0; b < banks; b++) {
    const u = -W / 2 + (W * (b + 0.5)) / banks, bad = b === alarm;
    f.box(M.black, u, 2.195, fv + 0.016, 0.24, 0.07, 0.02);
    f.box(bad ? G.b_lcdRed : G.b_cooler, u - 0.02, 2.195, fv + 0.027, 0.14, 0.048, 0.002);
    txt(f, bad ? '+11.6 °C' : `+${(3.6 + rnd()).toFixed(1)} °C`, u - 0.02, 2.195, fv + 0.029, 0.13, 0.044, tag('#081018', bad ? '#ff6a50' : '#bfe6ff', 'bold 54px Arial'));
    f.box(bad ? U.ledR : U.ledG, u + 0.09, 2.195, fv + 0.027, 0.018, 0.018, 0.006);
  }
  txt(f, 'BODY STORE · +4 °C · KEEP DOORS SHUT · LOG EVERY TRANSFER', 0, h - 0.07, fv + 0.005, Math.min(W - 0.4, 3.4), 0.08, tag('#1b2127', '#e8edf0', 'bold 40px Arial'));
  f.col(-W / 2, 0, W / 2, D, h, SURF.metal);
}

/**
 * A mortuary trolley at (x, z) turned yaw (long along v): the dished steel tray on its frame, a lower shelf, push
 * handles at both ends, castors; load 'sheet' (a body under a sheet: `sit`, `slip` as sheetedBody), 'bag', 'foot'
 * (a bag unzipped at the foot) or 'none'.
 */
export function bodyTrolley(c, x, z, yaw, { load = 'sheet', sit = 0, slip = 0 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  const W = 0.64, L = 1.95, T = 0.84;
  f.span(X.b_stainless, -W / 2, T - 0.03, -L / 2, W / 2, T, L / 2, 0.01);
  for (const s of [-1, 1]) {
    f.span(X.b_stainless, s * W / 2 - 0.012, T, -L / 2, s * W / 2 + 0.012, T + 0.05, L / 2);
    f.span(X.b_stainless, -W / 2, T, s * L / 2 - 0.012, W / 2, T + 0.05, s * L / 2 + 0.012);
    // the end frame, its handle, the castors
    for (const su of [-1, 1]) {
      f.cyl(X.b_chrome, su * (W / 2 - 0.06), 0.13, s * (L / 2 - 0.12), 0.016, 0.016, T - 0.16, 6);
      f.box(X.b_steelDark, su * (W / 2 - 0.06), 0.1, s * (L / 2 - 0.12), 0.035, 0.06, 0.035);
      f.hcyl(X.b_rubber, su * (W / 2 - 0.06), 0.05, s * (L / 2 - 0.12), 0.05, 0.03, 8, 'u');
      f.rod(X.b_chrome, [su * 0.22, T - 0.02, s * L / 2], [su * 0.22, T + 0.06, s * (L / 2 + 0.12)], 0.012, 6);
    }
    f.hcyl(X.b_chrome, 0, T + 0.06, s * (L / 2 + 0.12), 0.014, 0.46, 6, 'u');
    f.hcyl(X.b_chrome, 0, 0.3, s * (L / 2 - 0.12), 0.013, W - 0.12, 6, 'u');
  }
  f.span(X.b_stainless, -W / 2 + 0.07, 0.29, -L / 2 + 0.15, W / 2 - 0.07, 0.31, L / 2 - 0.15);
  f.box(M.red, W / 2 - 0.06, 0.16, L / 2 - 0.2, 0.05, 0.015, 0.08);
  const p = f.p(0, 0, 0);
  if (load === 'sheet') sheetedBody(c, p.x, p.z, f.yaw, { y: T + 0.04, sit, slip }); // (the sheet over the tray's rims)
  else if (load === 'bag' || load === 'foot') openBag(c, p.x, p.z, f.yaw, { y: T, foot: load === 'foot' });
  f.col(-W / 2, -L / 2 - 0.12, W / 2, L / 2 + 0.12, T + 0.05, SURF.metal);
}

/** rubber aprons on a steel rail at (x, z) (height y), `n` hooks, `empty` ones bare, wellington boots paired on the floor under them */
export function apronHooks(c, x, z, face, { n = 3, len = 1.3, y = 1.75, empty = [], boots = true } = {}) {
  const { X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.b_stainless, 0, y, 0.02, len, 0.05, 0.03, 0.006);
  for (const s of [-1, 1]) f.box(X.b_steelDark, s * (len / 2 - 0.03), y, 0.012, 0.04, 0.1, 0.024);
  for (let i = 0; i < n; i++) {
    const u = -len / 2 + (len * (i + 0.5)) / n;
    f.rod(X.b_chrome, [u, y, 0.03], [u, y + 0.04, 0.09], 0.007, 4);
    if (!empty.includes(i)) {
      const m = i % 2 ? X.b_apronY : X.b_apron, a = (rnd() - 0.5) * 0.06;
      f.add(m, torG(0.1, 0.006, 3, 10, PI), u, y - 0.08, 0.09, [0, 0, PI]);
      f.box(m, u, y - 0.32, 0.1, 0.3, 0.3, 0.012, 0.004, [0.05, 0, a]);
      f.box(m, u, y - 0.82, 0.115, 0.52, 0.72, 0.012, 0.004, [0.03, 0, a]);
    }
    if (!boots || i === n - 1) continue;
    // a pair of wellingtons, one slumped
    for (const s of [-1, 1]) {
      const bu = u + s * 0.08, slump = s > 0 && rnd() < 0.5;
      f.cyl(X.b_boot, bu, 0.06, 0.2, 0.055, 0.06, slump ? 0.22 : 0.32, 10);
      f.box(X.b_boot, bu, 0.045, 0.27, 0.1, 0.09, 0.28, 0.035);
      f.box(X.b_rubber, bu, 0.008, 0.27, 0.105, 0.016, 0.29);
    }
  }
}

/**
 * A stainless counter along the wall at (x, z), len long, `depth` deep: cupboard doors with bar pulls on a dark
 * plinth, a worktop with a marine edge and a back upstand; a sink (`sink`: its u, or null) with a tall pre-rinse spray
 * on its spring; a wall shelf (`shelf`) of specimen jars in fixative. Returns its top height.
 */
export function steelCounter(c, x, z, face, len, { depth = 0.68, sink = null, shelf = true, jars = 5 } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const Lh = len / 2, D = depth, T = 0.9;
  f.span(M.dark, -Lh + 0.03, 0, 0.03, Lh - 0.03, 0.1, D - 0.07);
  const n = Math.max(1, Math.round(len / 0.6)), w = len / n;
  for (let i = 0; i < n; i++) {
    const u = -Lh + w * (i + 0.5);
    f.span(X.b_stainless, u - w / 2 + 0.004, 0.1, 0.02, u + w / 2 - 0.004, T - 0.04, D - 0.03);
    f.box(X.b_chrome, u + w / 2 - 0.08, T - 0.18, D - 0.015, 0.014, 0.16, 0.02, 0.006);
  }
  f.span(X.b_stainless, -Lh, T - 0.04, 0, Lh, T, D, 0.006);
  f.span(X.b_stainless, -Lh, T, D - 0.015, Lh, T + 0.012, D);
  f.span(X.b_stainless, -Lh, T, 0, Lh, T + 0.12, 0.015);
  if (sink !== null) {
    for (const [a, b, c0, d] of [[sink - 0.25, sink + 0.25, 0.12, 0.15], [sink - 0.25, sink + 0.25, 0.55, 0.58], [sink - 0.25, sink - 0.22, 0.12, 0.58], [sink + 0.22, sink + 0.25, 0.12, 0.58]]) f.span(X.b_stainless, a, T, c0, b, T + 0.006, d);
    f.span(M.black, sink - 0.22, T + 0.001, 0.15, sink + 0.22, T + 0.003, 0.55);
    f.cyl(X.b_chrome, sink, T, 0.07, 0.022, 0.02, 0.62, 8);
    for (let k = 0; k < 5; k++) f.add(X.b_chrome, torG(0.03, 0.004, 3, 8), sink, T + 0.66 + k * 0.04, 0.07, [PI / 2, 0, 0]);
    f.rod(X.b_chrome, [sink, T + 0.86, 0.07], [sink + 0.05, T + 0.95, 0.2], 0.01, 6);
    f.add(X.b_chrome, cylC(0.025, 0.02, 0.1, 8), sink + 0.06, T + 0.6, 0.25, [0.1, 0, 0]);
    f.add(M.dark, tube([[0, T + 0.95, 0.2], [0.04, T + 0.85, 0.28], [0.06, T + 0.66, 0.25]], 8, 0.007, 4), sink, 0, 0);
  }
  if (shelf) {
    f.span(X.b_stainless, -Lh + 0.1, 1.58, 0, Lh - 0.1, 1.6, 0.3);
    for (const s of [-1, 1]) f.box(X.b_steelDark, s * (Lh - 0.2), 1.5, 0.12, 0.02, 0.16, 0.22, 0, [-0.5, 0, 0]);
    for (let j = 0; j < jars; j++) {
      const u = -Lh + 0.25 + ((len - 0.5) * (j + 0.3 * rnd())) / jars, r = 0.06 + rnd() * 0.04, hh = 0.14 + rnd() * 0.12;
      f.cyl(U.glass, u, 1.6, 0.15, r, r, hh, 8);
      f.cyl(X.b_formalin, u, 1.605, 0.15, r - 0.006, r - 0.006, hh * 0.8, 8);
      f.cyl(M.white, u, 1.6 + hh, 0.15, r + 0.004, r + 0.004, 0.025, 8);
      if (rnd() < 0.7) f.add(X.b_organ, sphG(r * 0.6, 8, 6), u, 1.6 + hh * 0.38, 0.15, null, [1, 1.4, 0.8]);
    }
  }
  f.col(-Lh, 0, Lh, D, T + 0.02, SURF.metal);
  return T;
}

/** a bench organ scale on a surface at (x, y, z) turned yaw: the base, the steel pan (something on it, `load`), the readout */
export function organScale(c, x, y, z, yaw = 0, { load = true } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(X.b_plastic, 0, 0.04, 0, 0.3, 0.08, 0.32, 0.015);
  f.box(M.black, 0, 0.045, 0.161, 0.16, 0.045, 0.004);
  f.box(G.b_lcdGreen, 0, 0.045, 0.163, 0.13, 0.03, 0.002);
  if (axial(f)) txt(f, load ? '1.412 kg' : '0.000 kg', 0, 0.045, 0.166, 0.12, 0.028, tag('#08100c', '#8dffb8', 'bold 60px Arial'));
  f.cyl(X.b_chrome, 0, 0.08, 0, 0.03, 0.03, 0.02, 8);
  f.box(X.b_stainless, 0, 0.11, -0.01, 0.34, 0.02, 0.28, 0.008);
  for (const s of [-1, 1]) f.box(X.b_stainless, s * 0.165, 0.13, -0.01, 0.012, 0.03, 0.28);
  if (load) f.add(X.b_organ, sphG(0.1, 10, 6), 0.02, 0.15, -0.01, [0, 0.4, 0], [1.4, 0.35, 0.9]);
}

/** an instrument tray on a surface at (x, y, z) turned yaw: kidney dish, scalpels, forceps, rib shears, a bone saw; `bloody` */
export function instrumentTray(c, x, y, z, yaw = 0, { bloody = false } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.box(X.b_stainless, 0, 0.008, 0, 0.44, 0.016, 0.32, 0.006);
  for (const s of [-1, 1]) {
    f.box(X.b_stainless, s * 0.215, 0.022, 0, 0.01, 0.02, 0.32);
    f.box(X.b_stainless, 0, 0.022, s * 0.155, 0.44, 0.02, 0.01);
  }
  f.add(X.b_stainless, cylC(0.08, 0.06, 0.035, 12), -0.1, 0.034, -0.06, null, [1.5, 1, 0.75]);
  for (let k = 0; k < 3; k++) {
    const u = 0.04 + k * 0.035, a = (rnd() - 0.5) * 0.15;
    f.box(X.b_chrome, u, 0.02, 0.02, 0.012, 0.006, 0.11, 0, [0, a, 0]);
    f.box(X.b_chrome, u, 0.02, -0.06, 0.008, 0.003, 0.04, 0, [0, a, 0]);
  }
  for (const s of [-1, 1]) f.box(X.b_chrome, 0.16, 0.02, 0.0, 0.01, 0.005, 0.18, 0, [0, s * 0.08, 0]);
  f.box(X.b_chrome, -0.08, 0.024, 0.09, 0.2, 0.006, 0.016, 0, [0, 0.35, 0]);
  f.box(X.b_chrome, -0.08, 0.026, 0.09, 0.2, 0.006, 0.016, 0, [0, -0.35, 0]);
  f.box(X.b_chrome, 0.02, 0.025, -0.11, 0.24, 0.004, 0.05);
  f.box(M.black, 0.17, 0.035, -0.11, 0.09, 0.03, 0.04, 0.008);
  if (bloody) for (let k = 0; k < 2; k++) f.add(X.b_blood, planeG(0.12 + rnd() * 0.1, 0.08 + rnd() * 0.08), (rnd() - 0.5) * 0.25, 0.0175, (rnd() - 0.5) * 0.18, [-PI / 2, 0, rnd() * 3]);
}

// ---------------------------------------------------------------- the containment block
/**
 * A feeding trolley at (x, z) turned yaw: two steel shelves, a row of steel bowls of raw meat, a bucket, the feeding
 * log on a clipboard; `tipped`: over on its side, the bowls and meat across the floor.
 */
export function feedCart(c, x, z, yaw, { tipped = false } = {}) {
  const { M, X, rnd } = c;
  const W = 0.9, D = 0.55, T = 0.88;
  const f = new Frame(c, x, z, yaw, tipped ? { y: W / 2 + 0.03, tilt: [0, PI / 2] } : {});
  for (const y of [0.3, T]) {
    f.box(X.b_stainless, 0, y, 0, W, 0.025, D, 0.006);
    for (const s of [-1, 1]) f.box(X.b_stainless, 0, y + 0.025, s * (D / 2 - 0.006), W, 0.03, 0.012);
  }
  for (const su of [-1, 1]) {
    for (const sv of [-1, 1]) {
      f.cyl(X.b_stainless, su * (W / 2 - 0.03), 0.08, sv * (D / 2 - 0.03), 0.014, 0.014, T - 0.08, 6);
      f.hcyl(X.b_rubber, su * (W / 2 - 0.03), 0.045, sv * (D / 2 - 0.03), 0.045, 0.025, 8, 'u');
    }
  }
  if (!tipped) {
    for (let i = 0; i < 4; i++) {
      const u = -0.32 + i * 0.21;
      f.add(X.b_stainless, cylG(0.07, 0.09, 0.06, 12, true), u, T + 0.012, 0.08);
      if (i !== 2) for (let k = 0; k < 3; k++) f.add(X.b_meat, rbox(0.07, 0.04, 0.06), u + (rnd() - 0.5) * 0.06, T + 0.05 + k * 0.012, 0.08 + (rnd() - 0.5) * 0.06, [0, rnd() * 3, 0]);
    }
    f.cyl(X.b_stainless, 0.2, 0.312, -0.05, 0.13, 0.15, 0.3, 12);
    f.box(M.dark, -0.3, T + 0.02, -0.15, 0.24, 0.012, 0.32, 0, [0, 0.2, 0]);
    f.box(M.white, -0.3, T + 0.027, -0.15, 0.21, 0.002, 0.29, 0, [0, 0.2, 0]);
    if (axial(f)) txt(f, 'FEED · RAW PROTEIN ONLY', 0, 0.6, D / 2, 0.5, 0.07, tag('#b3141a', '#ffffff', 'bold 40px Arial'));
    f.col(-W / 2, -D / 2, W / 2, D / 2, T + 0.08, SURF.metal);
    return;
  }
  // over on its side: bowls rolled away, the meat on the floor
  for (let i = 0; i < 3; i++) {
    const p = new Frame(c, x + (rnd() - 0.5) * 1.0, z + (rnd() - 0.5) * 1.0, rnd() * 3);
    p.add(X.b_stainless, cylG(0.07, 0.09, 0.06, 12, true), 0, 0.09, 0, [PI / 2 - 0.3, 0, 0]);
    for (let k = 0; k < 2; k++) p.add(X.b_meat, rbox(0.08, 0.04, 0.07), 0.15 + k * 0.12, 0.02, 0.1 * k, [0, rnd() * 3, 0]);
  }
  c.decal('blood', x + 0.3, z + 0.2, 1.0, rnd() * 3);
  new Frame(c, x, z, yaw).col(-T - 0.05, -D / 2, 0.05, D / 2, W + 0.05, SURF.metal);
}

/**
 * Where a containment team went down at (x, z): a riot shield on the floor, a dropped shock prod, a helmet on its
 * side, a torn sleeve of a containment suit, a trail of blood dragged off toward `yaw`.
 */
export function teamDown(c, x, z, yaw = 0) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const s = new Frame(c, x - 0.3, z + 0.1, yaw + 0.6, { y: 0.03, tilt: [PI / 2, 0] });
  s.box(U.glass, 0, 0, 0, 0.55, 0.9, 0.012, 0.03);
  s.box(X.b_shield, 0, 0, -0.012, 0.58, 0.93, 0.012, 0.03);
  s.box(X.b_shield, 0, 0.1, -0.035, 0.12, 0.2, 0.03, 0.01);
  f.add(M.black, cylC(0.014, 0.014, 0.75, 6), 0.45, 0.02, -0.2, [PI / 2, 0.5, 0]);
  f.add(M.yellow, cylC(0.022, 0.022, 0.26, 8), 0.3, 0.025, 0.05, [PI / 2, 0.5, 0]);
  f.add(X.b_shield, sphG(0.14, 12, 8), -0.55, 0.13, -0.45, [0.3, 0, 1.4], [1, 1.1, 1.15]);
  f.box(U.glass, -0.45, 0.13, -0.38, 0.16, 0.08, 0.012, 0, [0.3, 0.5, 1.4]);
  f.add(X.b_suit, capG(0.07, 0.42, 3, 8), 0.25, 0.05, 0.45, [PI / 2, 1.1, 0.2], [1.2, 1, 0.6]);
  f.add(X.b_suit, rbox(0.15, 0.04, 0.2, 0.02), 0.05, 0.02, 0.6, [0, 0.7, 0]);
  const p = f.p(0.4, 0, 0.9);
  c.decal('bloodDrag', p.x, p.z, 2.2, yaw + (rnd() - 0.5) * 0.3, { aspect: 0.6 });
  c.decal('blood', x, z, 1.1, rnd() * 3);
}

// ---------------------------------------------------------------- the rooms
/**
 * The isolation ward: three glazed negative-pressure rooms along the north wall (1 sealed, its bed's restraints
 * buckled on nobody; 2 burst open from the inside, the bed bloody, the straps torn, the glass across the floor and a
 * trail out toward the specimen hall; 3 evacuated, the bed stripped), each with its bed-head panel, pressure monitor
 * and pass-through hatch. The nurses' station with its glazed screen on the west wall, the crash cart left at it;
 * PPE and clinical waste by the cells, the airlock controls at both blast doors, a hand basin by the east door.
 */
export function dressIsolation(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // the three rooms, 1.8 m each, the row ending clear of both blast doors' approaches
  const cw = 1.8, cd = 2.45, cx0 = -24.55;
  const rooms = [
    { n: 'ISOLATION 1', state: 'sealed', bed: { restraints: true, torn: false, rails: 'up', tilt: 0.3, chart: 'PATIENT 0-14 · SEDATED · OBS 1-HOURLY' } },
    { n: 'ISOLATION 2', state: 'smashed', bed: { restraints: true, torn: true, blood: true, rails: 'down', tilt: 0.5, blanket: false, chart: 'PATIENT 0-17 · DO NOT REMOVE RESTRAINTS' } },
    { n: 'ISOLATION 3', state: 'open', lean: -1, bed: { rails: 'down', tilt: 0.1, blanket: false, chart: 'BED 3 · TERMINAL CLEAN REQUIRED' } },
  ];
  rooms.forEach((r, i) => {
    const a = cx0 + i * cw, b = a + cw, mid = (a + b) / 2;
    isoCell(c, a, z0, b, z0 + cd, 's', { n: r.n, state: r.state, lean: r.lean ?? 1, sides: [i === 0, true], h });
    L.hospitalBed(c, mid + 0.1, z0, 's', r.bed);
    bedheadPanel(c, mid + 0.1, z0, 's', { w: 1.2, on: r.state !== 'open' });
  });
  // room 2: the pane gone, the pressure alarm, the IV stand down in the ward, the trail out east
  L.warningBeacon(c, cx0 + cw * 1.5 - 0.55, 2.86, z0 + cd - 0.06, 's', { red: true });
  // the IV pole knocked flat: the pole along the floor, its five-legged base standing on edge, the bag burst beside it
  const iv = new Frame(c, -21.0, -24.75, 1.6);
  iv.rod(X.b_chrome, [0, 0.16, 0.05], [0, 0.03, 1.7], 0.014, 6);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2 + 0.3;
    iv.rod(X.b_chrome, [0, 0.16, 0.05], [Math.cos(a) * 0.15, 0.16 + Math.sin(a) * 0.15, 0.03], 0.012, 4);
    iv.add(M.black, sphG(0.025, 6, 4), Math.cos(a) * 0.15, 0.16 + Math.sin(a) * 0.15, 0.0);
  }
  iv.box(X.b_bagWhite, 0.25, 0.02, 1.45, 0.14, 0.03, 0.22, 0, [0, 0.4, 0]);
  c.decal('puddle', -19.75, -24.55, 0.6, 0.5);
  c.decal('bloodDrag', -21.3, -25.2, 1.8, 1.25, { aspect: 0.55 });
  c.decal('footprints', -20.3, -24.9, 1.4, 1.35);
  c.wallDecal('blood', cx0 + cw * 1.5 + 0.1, 2.45, z0, 's', 0.5, 0.45);
  // room 3: the linen pulled off the bed and left on the floor, a gown dropped by the door
  const m3 = cx0 + cw * 2.5;
  for (let k = 0; k < 2; k++) c.K.add(X.b_sheet, capG(0.12, 0.6, 2, 6), m3 - 0.55 + k * 0.15, 0.04, z0 + 1.2 + k * 0.5, [PI / 2, 0.4 + k, 0, 'YXZ'], [1.6, 1, 0.3]);
  c.K.add(X.b_apronY, rbox(0.5, 0.012, 0.7), m3 - 0.4, 0.008, z0 + 2.75, [0, 0.6, 0]);
  // a note on room 1's glass
  c.label('DO NOT ENTER · SEDATED 03:10 · DR. HALE', cx0 + 0.7, 1.25, z0 + cd - 0.033, 's', 0.3, 0.2, { bg: '#f2e27a', fg: '#2a2410', border: '#f2e27a', font: 'bold 30px Arial', lines: ['DO NOT ENTER', 'SEDATED 03:10', '— DR. HALE'] });
  // the north-west nook by the holding door: PPE on room 1's side wall, clinical waste under it, the airlock control
  ppeStation(c, cx0, -27.5, 'w', { w: 0.75 });
  L.wasteBin(c, cx0 - 0.25, -28.15, { kind: 'bio', yaw: -PI / 2 });
  L.sharpsBox(c, cx0, 0.95, -26.75, 'w');
  doorControl(c, x0, 1.35, -27.6, 'e', { title: 'AIRLOCK · CONTAINMENT', status: 'SEALED · NORTH LOCKDOWN' });
  L.hazardPlacard(c, x0, 2.2, -27.75, 'e', 'neg', { w: 0.5 });
  // the nurses' station: back to the west wall, its glazed screen, the crash cart left at its counter
  L.nurseStation(c, x0, -23.25, 'e', 1.9, { depth: 1.7 });
  stationGlazing(c, x0 + 1.57, -23.25, 'e', 1.9, { y0: 1.08, top: 2.08 });
  L.crashCart(c, x0 + 1.75, -23.0, 'e');
  L.wallClock(c, x0, 2.55, -23.25, 'e');
  P.extinguisher(c, x0, -24.32, 'e');
  L.hazardPlacard(c, x0, 2.2, -24.15, 'e', 'neg', { w: 0.42 });
  Fac.trashCan(c, x0 + 0.3, -22.6, { r: 0.15 });
  // the east side: the airlock control, the hand basin, the soiled linen, a socket, the camera
  doorControl(c, x1, 1.35, -26.62, 'w', { title: 'AIRLOCK · SPECIMEN HALL', status: 'SEALED · NORTH LOCKDOWN' });
  L.sinkUnit(c, x1, -22.95, 'w', { kind: 'hand' });
  L.hazardPlacard(c, x1, 2.25, -22.95, 'w', 'ppe', { w: 0.5 });
  L.socket(c, x1, 0.3, -22.3, 'w');
  linenCart(c, -20.65, -23.3, 0.15, { soiled: true });
  L.cctvCam(c, x1, 2.7, z1 - 0.3, 'w', -0.5);
  // the south door: the switch, the ward's name over it
  L.lightSwitch(c, -24.05, z1, 'n');
  c.label('ISOLATION WARD · NEGATIVE PRESSURE ZONE', -22.25, 2.78, z1, 'n', 2.4, 0.16, { bg: '#1b2127', fg: '#e8edf0', border: '#d6a31a', font: 'bold 44px Arial' });
  // left in a hurry: chart pages on the floor by the station, a dropped glove box
  for (let k = 0; k < 4; k++) c.K.add(k % 2 ? X.b_tag : M.white, planeG(0.21, 0.29), -23.6 + rnd() * 0.9, 0.002 + k * 0.0004, -24.4 + rnd() * 0.6, [-PI / 2, 0, rnd() * 3]);
  c.decal('paper', -23.4, -24.2, 1.1, rnd() * 3);
  c.K.add(M.white, rbox(0.22, 0.11, 0.12), -22.9, 0.055, -24.9, [0, 0.7, 0]);
}

/**
 * Containment block C: three steel-and-glass cells along the north wall (C-02 broken open from inside, its door torn
 * off and thrown across the floor; C-03 barred), a deep cell C-04 on the west wall, the guard cage in the middle of
 * the floor; drain channels along the cell fronts, hose reels, the prod rack and a disinfectant drum in the north-east
 * pocket, cameras and lockdown beacons, the subject status board, the lockdown controls at both blast doors; a feeding
 * trolley over on its side, and where the handlers went down: a shield, a helmet, a prod, a trail to the south door.
 */
export function dressHolding(c, s, ctx) {
  const { M, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // the north row: 2.03 m cells, 2.4 deep; the pocket east of them stays clear of the east door's approach
  const cd = 2.4, cxs = [-34, -31.97, -29.93, -27.9];
  const north = [
    { n: 'C-01', state: 'closed', subject: true },
    { n: 'C-02', state: 'broken', door: -0.4 },
    { n: 'C-03', state: 'closed', glass: false, subject: true },
  ];
  north.forEach((o, i) => L.holdingCell(c, cxs[i], z0, cxs[i + 1], z0 + cd, 's', { state: o.state, door: o.door ?? 0, glass: o.glass ?? true, n: o.n, subject: o.subject ?? null, sides: [i === 0, true] }));
  // the deep cell on the west wall, its south side the room's own wall
  L.holdingCell(c, x0, -24.3, x0 + cd, z1, 'e', { state: 'closed', door: 0.4, n: 'C-04', subject: true, sides: [false, true] });
  // C-02 from the inside: gouges down its back, blood
  L.clawMarks(c, -30.75, 1.45, z0 + 0.02, 's', { n: 4, len: 0.8, a: 0.3 });
  L.clawMarks(c, -31.35, 0.9, z0 + 0.02, 's', { n: 3, len: 0.5, a: -0.4, blood: false });
  c.decal('blood', -31.1, -27.4, 1.0, rnd() * 3);
  // the guard cage in the middle, its door toward the south door
  L.controlCage(c, -29.7, -24.4, -27.7, -22.8, 's', { door: 0.4, cells: ['C-01', 'C-02', 'C-03', 'C-04'], breached: ['C-02'] });
  // the floor: drain channels along the cell fronts (the cells are hosed out), the handlers' last stand, the trolley
  L.drainChannel(c, x0 + 0.3, z0 + cd + 0.3, -28.1, z0 + cd + 0.3, 0.2);
  L.drainChannel(c, x0 + cd + 0.3, -24.0, x0 + cd + 0.3, z1 - 0.3, 0.2);
  teamDown(c, -30.5, -22.95, 0.15);
  feedCart(c, -33.0, -25.5, PI / 2, { tipped: true });
  c.decal('footprints', -28.6, -25.4, 1.6, 2.2);
  // the north-east pocket: the prod rack, a hose reel, the disinfectant drum
  L.prodRack(c, x1, -27.9, 'w', { n: 4, empty: [1, 2] });
  L.hoseReel(c, -27.25, 1.25, z0, 's');
  P.drum(c, -27.45, -27.6, { mat: M.blue });
  c.label('VIRKON S · 1 %', -27.45, 0.6, -27.29, 's', 0.3, 0.08, { bg: '#ffffff', fg: '#1f5fa6', border: '#ffffff', font: 'bold 40px Arial' });
  // the east wall: the lockdown control by the door, the status board, first aid and the extinguisher by the corner
  doorControl(c, x1, 1.35, -24.0, 'w', { title: 'BLOCK C · LOCKDOWN', status: 'LOCKDOWN ACTIVE · C-02 BREACH' });
  L.whiteboardFormula(c, x1, -22.75, 'w', {
    w: 1.4, y: 1.65, h: 0.9, title: 'SUBJECT STATUS · BLOCK C',
    lines: ['C-01  sedated 02:40 · no feed', 'C-02  AGGRESSIVE · 2 handlers min.', 'C-03  stable · bars only (glass ✗)', 'C-04  isolated · DO NOT OPEN'],
    note: 'PRODS SIGNED OUT: P-2, P-3',
  });
  L.firstAidBox(c, x1, 1.55, -21.55, 'w');
  P.extinguisher(c, x1, -21.45, 'w');
  // the south wall: the other lockdown control, the hose reel, a socket, the gouges by the door
  doorControl(c, -28.45, 1.35, z1, 'n', { title: 'BLOCK C · LOCKDOWN', status: 'DOOR SEALED · NORTH' });
  L.hoseReel(c, -27.45, 1.25, z1, 'n');
  L.socket(c, -26.95, 0.3, z1, 'n');
  L.clawMarks(c, -31.3, 1.25, z1, 'n', { n: 3, len: 0.6, a: 0.2 });
  // high up: cameras, the lockdown beacons, a flood over the cell fronts, the block's name
  L.cctvCam(c, x1, 3.35, z0 + 0.35, 'w', 0.5);
  L.cctvCam(c, x0, 3.35, -25.2, 'e', 0.2);
  L.cctvCam(c, -27.0, 3.35, z1, 'n', -0.4);
  L.warningBeacon(c, -30.95, 3.45, z0, 's', { red: true });
  L.warningBeacon(c, x0, 3.0, -22.65, 'e', { red: true });
  L.floodLight(c, -29.8, 3.5, z1, 'n', { i: 0.55, r: 3.0, tilt: 0.5 });
  c.label('CONTAINMENT BLOCK C · AUTHORISED HANDLERS ONLY', -30.95, 3.05, z0, 's', 3.4, 0.2, { bg: '#16181a', fg: '#f0c030', border: '#c63a2e', font: 'bold 44px Arial' });
  L.hazardPlacard(c, -33.3, 3.1, z0, 's', 'bio', { w: 0.45 });
}

/**
 * The morgue, a long cold room off the west ring corridor: the cooler bank down the east wall (the hero: one bay open
 * and empty straight across from the door, wet bare footprints from it toward the way out; a foot out of a bag on
 * another tray), two autopsy stations down the middle with their lamps, scales and instrument stands (the north one
 * bloody, the south one with its body still under the sheet), and in the aisle between them a trolley left askew whose
 * sheeted body seems to have shifted. Stainless counters with sinks, jars and scales along the west wall, rubber
 * aprons and boots, the X-ray light box, the clerk's desk with the register in the south-west corner, formalin and
 * the eyewash in the south-east, supplies and a parked trolley at the north end.
 */
export function dressMorgue(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // the cooler bank (13 bays) on the east wall
  morgueCooler(c, x1 - 0.9, -26.4, x1, -16.4, 'w', {
    open: [[4, 0, 'foot'], [6, 1, 'empty'], [9, 2, 'bag']],
    names: [[0, 0, 'J. DOE 0398'], [1, 1, 'M. OKAFOR'], [2, 0, 'UNKNOWN M'], [3, 2, 'NOX-S 11'], [5, 0, 'T. MARSH'], [7, 1, 'UNKNOWN F'], [8, 0, 'R. HALE ?'], [10, 1, 'NOX-S 14'], [11, 0, 'J. DOE 0412'], [12, 2, 'P. VASQUEZ']],
    alarm: 1,
  });
  c.label('BAYS 5–9 WARM · MOVE TO 1–4', x1 - 0.9 + 0.018, 1.95, -20.63, 'w', 0.22, 0.16, { bg: '#f2e27a', fg: '#2a2410', border: '#f2e27a', font: 'bold 30px Arial', lines: ['BAYS 5–9 WARM', 'MOVE TO 1–4', '— K.'] });
  c.wallDecal('bloodSmear', x1 - 0.9, 1.2, -23.7, 'w', 0.4, 0.6);
  c.decal('footprints', -37.4, -21.2, 2.0, -PI / 2);
  c.decal('footprints', -38.5, -21.0, 1.4, -PI / 2 - 0.2);
  // the north station: the bloody table, its scale, the instrument stand
  L.dissectionTable(c, -37.6, -26.2, PI, { ceil: h, blood: true });
  L.hangingScale(c, -37.3, -25.55, h, 'w', { y: 1.65 });
  L.mayoStand(c, -36.95, -26.75, -PI / 2);
  // the south station: a body still under its sheet
  L.dissectionTable(c, -37.6, -16.4, 0, { ceil: h, body: true });
  L.mayoStand(c, -36.95, -15.7, PI / 2, { tipped: rnd() < 0.5 });
  // the aisle: the trolley left askew, its body shifted under the sheet, a sheet on the floor, a bag dropped by the bays
  bodyTrolley(c, -37.45, -19.3, 0.4, { load: 'sheet', sit: 0.55, slip: 0.75 });
  c.K.add(X.b_sheet, capG(0.14, 0.7, 2, 6), -36.45, 0.035, -18.3, [PI / 2, 2.1, 0, 'YXZ'], [1.7, 1, 0.25]);
  openBag(c, -36.6, -24.4, 1.4, { foot: true, white: true });
  L.drainGrate(c, -37.5, -22.6, 0.3, 0.3);
  L.drainGrate(c, -36.6, -13.7, 0.3, 0.3);
  // the west wall, north of the door: the dissection counter with its sink, scale and tray; aprons and boots
  steelCounter(c, x0, -28.2, 'e', 3.4, { sink: 0.9, jars: 6 });
  organScale(c, -39.62, 0.9, -27.15, PI / 2);
  instrumentTray(c, -39.66, 0.9, -28.15, PI / 2 + 0.1, { bloody: true });
  apronHooks(c, x0, -25.5, 'e', { n: 3, empty: [2] });
  P.extinguisher(c, x0, -24.4, 'e');
  L.lightSwitch(c, x0, -22.55, 'e');
  // south of the door: the specimen counter
  steelCounter(c, x0, -16.4, 'e', 3.0, { sink: -0.8, jars: 4 });
  instrumentTray(c, -39.66, 0.9, -16.9, PI / 2 - 0.15);
  for (let k = 0; k < 4; k++) {
    const pz = -17.55 + k * 0.11;
    c.K.add(M.white, cylG(0.04, 0.04, 0.09, 8), -39.75, 0.9, pz);
    c.K.add(k % 2 ? M.red : M.blue, cylG(0.043, 0.043, 0.015, 8), -39.75, 0.99, pz);
  }
  // the clerk's corner: the desk and the register, the phone, the board
  Fac.officeDesk(c, -39.2, z1 - 0.4, 'n', { w: 1.3, d: 0.7, mess: true, chair: true, pc: false });
  c.K.add(X.b_ledger, rbox(0.32, 0.05, 0.42), -39.05, 0.766, -12.95, [0, 0.25, 0]);
  c.K.add(X.b_tag, rbox(0.3, 0.012, 0.4), -39.05, 0.797, -12.95, [0, 0.25, 0]);
  c.K.add(M.black, cylC(0.006, 0.006, 0.14, 6), -38.9, 0.81, -13.05, [PI / 2, 0.9, 0, 'YXZ']);
  Fac.wallPhone(c, x0, 1.45, -13.7, 'e', { number: 'CORONER  2210' });
  Fac.noticeBoard(c, -37.9, z1, 'n', { y: 1.5, w: 1.0, h: 0.7, pages: [['RELEASE OF REMAINS', 'SIGN THE REGISTER'], ['BAY 7 COMPRESSOR', 'FAULT · REPORTED ×3'], ['NO VIEWINGS', 'BY ORDER · DIR.']] });
  // the south-east: formalin, the eyewash
  L.chemCabinet(c, x1, -13.8, 'w', { kind: 'tox', w: 1.0 });
  L.hazardPlacard(c, x1, 2.0, -13.8, 'w', 'FORMALIN 10 % · CARCINOGEN', { w: 0.7 });
  L.eyewash(c, x1, -15.5, 'w', 1.0);
  L.hazardPlacard(c, x1, 1.75, -15.5, 'w', 'eyewash', { w: 0.42 });
  // the north end: the X-ray light box over a parked trolley, the clock, supplies and clinical waste in the corner
  L.wallLightBox(c, -37.6, 1.6, z0, 's', { w: 0.9, h: 0.5, films: 2 });
  bodyTrolley(c, -37.3, -29.35, PI / 2, { load: 'bag' });
  L.wallClock(c, -39.0, 2.6, z0, 's');
  c.label('MORTUARY · AUTHORISED STAFF ONLY', -37.4, 2.85, z0, 's', 2.4, 0.2, { bg: '#1b2127', fg: '#e8edf0', border: '#8a949c', font: 'bold 48px Arial' });
  P.shelf(c, [x1 - 0.6, z0 + 0.05, x1, -27.2], { fill: 'boxes', h: 2.0, levels: 4 });
  L.wasteBin(c, -35.55, -29.6, { kind: 'bio', yaw: PI });
  L.hazardPlacard(c, -35.95, 1.7, z0, 's', 'bio', { w: 0.4 });
}
