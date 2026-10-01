// The Hive's west-wing clinical and sample rooms (world/hive.js): sequencing (genomics), the decon airlock, cryo
// storage and the infirmary. Room-specific props in the idiom of hiveProps.js / hiveLabs.js (world-space geometry for
// the Kit, one mesh per material, baked light, a collider for whatever you'd bump into) and one dress function per room,
// composed with the shared lab / medical props of hiveLabs.js and the office ones of hiveFacility.js.
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
  a_robot: { color: 0xd7dadd, roughness: 0.38 }, // liquid handler / instrument shells, cool pale grey
  a_anodised: { color: 0x2a2e33, metalness: 0.45, roughness: 0.45 }, // robot decks, gantry rails
  a_ups: { color: 0x1f2226, roughness: 0.62 }, // UPS / rack enclosures, textured black
  a_brushed: { color: 0xb7bec4, metalness: 0.78, roughness: 0.34 }, // brushed stainless panels
  a_grating: { color: 0x666c72, metalness: 0.7, roughness: 0.42 }, // floor grating bars
  a_bootYellow: { color: 0xe0b31b, roughness: 0.55 }, // PVC decon boots
  a_bootBlack: { color: 0x17181a, roughness: 0.85 },
  a_gloveBlue: { color: 0x4a78d6, roughness: 0.6 }, // nitrile glove boxes / spilled gloves
  a_glovePurple: { color: 0x7a52c2, roughness: 0.6 },
  a_carton: { color: 0xf0eee6, roughness: 0.85 }, // dispenser boxes, white board
  a_hdpe: { color: 0xe6e1cf, roughness: 0.6 }, // the dosing tank's translucent-white plastic
  a_chemBlue: { color: 0x2a64b0, roughness: 0.5 }, // the disinfectant drum
  a_suit: { color: 0xd9a81a, roughness: 0.65 }, // a dropped hazmat suit (a shade darker than the hanging ones)
  a_ice: { color: 0xd9ebf4, roughness: 0.08 }, // glossy ice on the floor
  a_rime: { color: 0xf1f6f9, roughness: 0.92 }, // matte frost on cold lines and valves
  a_foam: { color: 0x8c949a, roughness: 0.9 }, // insulation jackets
  a_cryoGlove: { color: 0x2f5fa6, roughness: 0.88 },
  a_apron: { color: 0x2b3035, roughness: 0.7 },
  a_brass: { color: 0xb08d3e, metalness: 0.85, roughness: 0.35 },
  a_mint: { color: 0xa6d6c6, roughness: 0.55 }, // the infirmary's pale green trims and furniture
  a_bedside: { color: 0xe7eae4, roughness: 0.45 }, // bedside lockers, overbed tables
  a_beech: { color: 0xc9a273, roughness: 0.6 }, // laminate tops
  a_screenCloth: { color: 0x9dbcc6, roughness: 0.95 }, // folding screen fabric
  a_tray: { color: 0x8796a3, roughness: 0.5 }, // food trays, kidney dishes (plastic)
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  a_uv: [0x8c5cff, 1.6], // the PCR cabinet's UV tube
  a_status: [0x4dff9a, 1.4], // big green status bars
  a_amber: [0xffb020, 1.6],
  a_o2: [0x7dffb0, 1.3], // the O₂ monitor's display
  a_cold: [0x8fd8ff, 1.4], // cryo readouts
  a_alarm: [0xff3a2a, 1.8],
  a_reading: [0xfff1d6, 1.5], // bed-head reading lights
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
const domeG = (r, ws = 16) => cached('d' + k3(r) + ':' + ws, () => new THREE.SphereGeometry(r, ws, 6, 0, PI * 2, 0, PI / 2));
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const capG = (r, l, cs = 4, rs = 8) => cached('p' + k3(r, l) + ':' + cs + ':' + rs, () => new THREE.CapsuleGeometry(r, l, cs, rs));
const discG = (r, seg = 16) => cached('o' + k3(r) + ':' + seg, () => new THREE.CircleGeometry(r, seg));
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

// ---------------------------------------------------------------- sequencing
/** a 96-well plate / tip box / trough on a deck at local (u, y, v) of the frame */
function deckItem(f, kind, u, y, v) {
  const { M, X, U, rnd } = f.c;
  if (kind === 'tips') {
    f.box(pick(f.c, [M.blue, M.yellow, X.a_robot]), u, y + 0.03, v, 0.125, 0.06, 0.085);
    f.box(M.black, u, y + 0.061, v, 0.11, 0.002, 0.075);
    for (let i = 0; i < 4; i++) f.box(M.white, u - 0.045 + i * 0.03, y + 0.064, v, 0.006, 0.006, 0.07); // a few tip rows left
  } else if (kind === 'trough') {
    f.box(M.white, u, y + 0.02, v, 0.125, 0.04, 0.085);
    f.box(pick(f.c, [U.blue, U.magenta, U.amber]), u, y + 0.034, v, 0.1, 0.006, 0.065);
  } else if (kind === 'empty') {
    f.box(M.dark, u, y + 0.002, v, 0.13, 0.004, 0.09);
  } else {
    f.box(pick(f.c, [M.white, X.a_robot, M.white]), u, y + 0.008, v, 0.128, 0.016, 0.086);
    f.box(rnd() < 0.5 ? M.dark : X.a_carton, u, y + 0.0165, v, 0.12, 0.002, 0.078); // the seal or the wells
  }
}

/**
 * A liquid-handling robot on a surface at (x, y, z) turned yaw (front toward +v): a plinth, the anodised deck laid
 * out with plates, tip boxes and troughs, four posts carrying the canopy, glass side and front shields (the front
 * raised), the gantry with its 8-channel head parked mid-run, a cable chain, the status light bar, its label.
 */
export function liquidHandler(c, x, y, z, yaw = 0, { running = false } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, yaw, { y });
  const W = 1.0, D = 0.66, H = 0.78;
  feet(f, 0, 0, W - 0.04, D - 0.04, M.black);
  f.box(X.a_robot, 0, 0.07, 0, W, 0.13, D, 0.02);
  f.span(M.dark, -W / 2 + 0.04, 0.03, D / 2, W / 2 - 0.04, 0.035, D / 2 + 0.002);
  f.box(X.a_anodised, 0, 0.145, 0.02, W - 0.08, 0.02, D - 0.12);
  // the deck: 4 × 3 positions
  const kinds = ['tips', 'plate', 'plate', 'trough', 'tips', 'plate', 'empty', 'plate', 'tips', 'trough', 'plate', 'plate'];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) deckItem(f, kinds[i * 3 + k], -0.3 + i * 0.19, 0.155, -0.12 + k * 0.13);
  f.box(M.dark, 0.42, 0.2, 0.0, 0.08, 0.09, 0.3); // the tip-eject chute
  // posts, the canopy, shields
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.box(X.a_robot, su * (W / 2 - 0.03), 0.13 + (H - 0.13) / 2, sv * (D / 2 - 0.03), 0.05, H - 0.13, 0.05);
  f.box(X.a_robot, 0, H + 0.04, 0, W, 0.09, D, 0.025);
  f.span(G.a_status, -W / 2 + 0.08, H + 0.004, D / 2 - 0.002, W / 2 - 0.08, H + 0.016, D / 2 + 0.003);
  for (const su of [-1, 1]) f.span(U.glass, su * (W / 2 - 0.012), 0.15, -D / 2 + 0.05, su * (W / 2 - 0.004), H - 0.01, D / 2 - 0.05);
  f.span(U.glass, -W / 2 + 0.05, 0.15, -D / 2 + 0.004, W / 2 - 0.05, H - 0.01, -D / 2 + 0.012);
  // the front shield raised up under the canopy
  f.span(U.glass, -W / 2 + 0.05, H - 0.32, D / 2 - 0.012, W / 2 - 0.05, H - 0.02, D / 2 - 0.004);
  f.span(M.dark, -W / 2 + 0.05, H - 0.34, D / 2 - 0.014, W / 2 - 0.05, H - 0.32, D / 2 - 0.002);
  // the gantry: the x beam under the canopy, the y carriage, the 8-channel head
  f.box(X.a_anodised, 0, H - 0.07, -0.05, W - 0.1, 0.05, 0.06);
  const hu = running ? -0.1 : 0.12;
  f.box(X.a_anodised, hu, H - 0.12, 0.02, 0.1, 0.06, 0.22);
  f.box(X.a_robot, hu, H - 0.26, 0.1, 0.12, 0.2, 0.09, 0.012);
  for (let i = 0; i < 8; i++) f.cyl(M.white, hu - 0.042 + i * 0.012, H - 0.42, 0.1, 0.0015, 0.004, 0.06, 5);
  f.cyl(M.steel, hu, H - 0.37, 0.1, 0.045, 0.045, 0.01, 10);
  f.box(M.dark, -W / 2 + 0.2, H - 0.04, -0.2, 0.3, 0.025, 0.04); // the cable chain
  f.box(M.black, W / 2 - 0.15, 0.07, D / 2 + 0.001, 0.12, 0.05, 0.004);
  f.box(running ? U.ledG : U.ledA, W / 2 - 0.06, 0.07, D / 2 + 0.003, 0.012, 0.012, 0.004);
  f.label('NOX LH-8 · LIBRARY PREP', -0.15, 0.07, D / 2 + 0.002, 0.42, 0.05, { bg: '#d7dadd', fg: '#22344a', border: '#d7dadd', font: 'bold 40px Arial' });
  f.label(running ? 'RUN PAUSED · LID OPEN' : 'IDLE · DECK NOT CLEARED', 0, H + 0.04, D / 2 + 0.002, 0.42, 0.05, { bg: '#1b2127', fg: running ? '#ffb020' : '#7dffa0', border: '#1b2127', font: 'bold 38px monospace' });
}

/**
 * A PCR workstation on a surface at (x, y, z) turned yaw: a white tray base, acrylic sides and back, the canopy with
 * its UV tube (lit: the decontamination cycle left running) and white lamp, a front sash half up; tubes and a rack
 * inside, its sticker.
 */
export function pcrCabinet(c, x, y, z, yaw = 0, { uv = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, yaw, { y });
  const W = 0.82, D = 0.58, H = 0.66;
  f.box(M.white, 0, 0.02, 0, W, 0.04, D, 0.012);
  f.box(X.a_robot, 0, H + 0.04, 0, W, 0.08, D, 0.02);
  for (const su of [-1, 1]) f.span(U.glass, su * (W / 2 - 0.012), 0.04, -D / 2 + 0.02, su * (W / 2 - 0.004), H, D / 2 - 0.01);
  f.span(U.glass, -W / 2 + 0.01, 0.04, -D / 2 + 0.004, W / 2 - 0.01, H, -D / 2 + 0.012);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.box(M.white, su * (W / 2 - 0.01), 0.04 + H / 2, sv * (D / 2 - 0.01), 0.02, H - 0.04, 0.02);
  f.span(U.glass, -W / 2 + 0.02, 0.32, D / 2 - 0.015, W / 2 - 0.02, H - 0.01, D / 2 - 0.007);
  f.span(M.white, -W / 2 + 0.02, 0.3, D / 2 - 0.02, W / 2 - 0.02, 0.33, D / 2 - 0.002);
  f.hcyl(uv ? G.a_uv : M.white, 0, H - 0.015, -0.08, 0.012, W - 0.12, 8, 'u');
  f.span(M.white, -W / 2 + 0.06, H - 0.006, 0.02, W / 2 - 0.06, H, 0.12);
  if (uv) f.light(0, H - 0.08, 0, 0.22, 0.7, [0.6, 0.4, 1.0], null, 1.6);
  // inside: a tube rack, a minifuge, loose tubes
  f.box(M.white, -0.18, 0.06, -0.05, 0.2, 0.04, 0.07);
  for (let i = 0; i < 5; i++) f.cyl(pick(c, [M.white, U.blue, U.amber]), -0.26 + i * 0.04, 0.07, -0.05, 0.006, 0.006, 0.05, 6);
  f.cyl(X.a_robot, 0.17, 0.04, -0.06, 0.07, 0.07, 0.08, 14);
  f.cyl(M.dark, 0.17, 0.12, -0.06, 0.065, 0.06, 0.02, 14);
  f.label('UV 15 MIN BEFORE & AFTER USE', 0, H + 0.04, D / 2 + 0.002, 0.5, 0.05, { bg: '#ffffff', fg: '#5a3ab0', border: '#ffffff', font: 'bold 34px Arial' });
}

/** a floor-standing UPS tower against the wall at (x, z): textured black case, the LCD, LEDs, vent slots, a cable */
export function ups(c, x, z, face, { on = true } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  const W = 0.24, H = 0.56, D = 0.62;
  f.span(X.a_ups, -W / 2, 0.01, 0.02, W / 2, H, D, 0.015);
  f.span(M.dark, -W / 2 + 0.02, 0.05, D, W / 2 - 0.02, H - 0.05, D + 0.004);
  f.box(M.black, 0, H - 0.12, D + 0.006, 0.12, 0.06, 0.004);
  f.label(on ? 'ON BATTERY 23 %' : 'OFF', 0, H - 0.12, D + 0.009, 0.11, 0.05, { bg: '#0a1410', fg: on ? '#ffb020' : '#334', border: '#0a1410', font: 'bold 30px monospace' });
  leds(f, -0.04, H - 0.2, D + 0.006, 4, 0.025, on ? [U.ledG, U.ledA, U.ledA, U.ledR] : [M.black]);
  for (let i = 0; i < 6; i++) f.box(M.black, 0, 0.1 + i * 0.035, D + 0.005, 0.15, 0.012, 0.004);
  f.rod(M.black, [0.05, 0.1, 0.03], [0.05, 0.02, -0.0], 0.008, 4);
  f.col(-W / 2, 0, W / 2, D, H, SURF.metal);
}

/**
 * A sequencing data cabinet against the wall at (x, z): a tall black rack, a perforated door (dark mesh, glass panel)
 * with the drive shelves showing through, their LED rows, a door handle, the asset label, the cooling vent on top.
 */
export function dataRack(c, x, z, face, { h = 2.0, w = 0.6, d = 0.9, name = 'SEQ-STORE 01 · 1.2 PB' } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.a_ups, -w / 2, 0.04, 0, w / 2, h, d - 0.03, 0.012);
  for (const su of [-1, 1]) for (const v of [0.08, d - 0.1]) f.cyl(M.black, su * (w / 2 - 0.06), 0, v, 0.025, 0.025, 0.04, 8);
  f.span(M.dark, -w / 2 + 0.02, 0.1, d - 0.03, w / 2 - 0.02, h - 0.06, d - 0.02);
  // the drive shelves seen through the door
  const n = Math.floor((h - 0.3) / 0.13);
  for (let i = 0; i < n; i++) {
    const y = 0.18 + i * 0.13;
    f.span(i % 4 === 3 ? M.black : X.a_anodised, -w / 2 + 0.05, y, d - 0.035, w / 2 - 0.05, y + 0.1, d - 0.02);
    leds(f, -w / 2 + 0.08, y + 0.05, d - 0.016, 3, 0.12);
  }
  f.span(U.glass, -w / 2 + 0.03, 0.12, d - 0.016, w / 2 - 0.03, h - 0.08, d - 0.008);
  f.box(X.a_brushed, w / 2 - 0.05, h / 2, d - 0.003, 0.02, 0.22, 0.02, 0.006);
  f.box(M.dark, 0, h + 0.002, d / 2, w - 0.1, 0.004, d * 0.6);
  f.label(name, 0, h - 0.04, d - 0.004, w - 0.1, 0.05, { bg: '#1f2226', fg: '#e8edf0', border: '#1f2226', font: 'bold 34px Arial' });
  f.col(-w / 2, 0, w / 2, d, h, SURF.metal);
}

/**
 * A −20 °C chest freezer against the wall at (x, z): white cabinet on feet, the lid (proud, a gasket line), the
 * recessed handle and lock, the control strip with its display; boxes, an ice bucket or a lab book on the lid.
 */
export function chestFreezer(c, x, z, face, { w = 1.3, d = 0.72, temp = '−20 °C', top = 'boxes', note = null } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const H = 0.86;
  feet(f, 0, d / 2, w, d, M.black);
  f.span(M.white, -w / 2, 0.02, 0.0, w / 2, H - 0.08, d, 0.02);
  f.span(M.dark, -w / 2 + 0.01, H - 0.085, 0.01, w / 2 - 0.01, H - 0.075, d - 0.01);
  f.span(M.white, -w / 2 - 0.005, H - 0.075, -0.005, w / 2 + 0.005, H, d + 0.012, 0.015);
  f.span(X.a_robot, -0.2, H - 0.06, d + 0.012, 0.2, H - 0.025, d + 0.03, 0.006);
  f.cyl(M.steel, 0.32, H - 0.05, d + 0.012, 0.012, 0.012, 0.01, 8);
  f.span(M.dark, -w / 2 + 0.06, 0.08, d, -w / 2 + 0.36, 0.2, d + 0.004);
  f.box(M.black, -w / 2 + 0.2, 0.32, d + 0.004, 0.16, 0.06, 0.004);
  f.label(temp, -w / 2 + 0.2, 0.32, d + 0.007, 0.14, 0.05, { bg: '#08121a', fg: '#ff8a5a', border: '#08121a', font: 'bold 44px monospace' });
  f.box(rnd() < 0.5 ? U.ledG : U.ledA, -w / 2 + 0.32, 0.32, d + 0.005, 0.012, 0.012, 0.004);
  for (let i = 0; i < 5; i++) f.box(M.dark, w / 2 - 0.3 + i * 0.05, 0.14, d + 0.002, 0.02, 0.1, 0.004); // compressor grille
  if (note) {
    const lines = Array.isArray(note) ? note : [note];
    f.label(lines.join(' / '), w / 4, H - 0.2, d + 0.004, 0.36, 0.14, { bg: '#fff59a', fg: '#2a2a2a', border: '#fff59a', font: 'bold 34px "Comic Sans MS", Arial', lines });
  }
  if (top === 'boxes') {
    for (let i = 0; i < 3; i++) f.box(pick(c, [M.card, M.white, M.blue]), -0.35 + i * 0.16, H + 0.03, d / 2 + jit(c, 0.08), 0.14, 0.06, 0.14, 0, [0, jit(c, 0.3), 0]);
    f.box(M.card, -0.35, H + 0.085, d / 2, 0.14, 0.05, 0.14, 0, [0, 0.4, 0]);
  } else if (top === 'ice') {
    f.box(M.white, 0.1, H + 0.09, d / 2, 0.32, 0.18, 0.24, 0.02);
    f.box(X.a_ice, 0.1, H + 0.18, d / 2, 0.28, 0.004, 0.2);
    f.box(X.a_carton, -0.35, H + 0.012, d / 2 + 0.05, 0.22, 0.02, 0.3, 0, [0, 0.2, 0]);
  }
  f.col(-w / 2, 0, w / 2, d + 0.03, H, SURF.metal);
}

/** a printer on a small steel cabinet at (x, z) (centre) facing `face`: paper reams on its shelf, a printout hanging out */
export function printerCart(c, x, z, face) {
  const { M } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.grey, -0.28, 0.06, -0.22, 0.28, 0.7, 0.22, 0.01);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.cyl(M.black, su * 0.22, 0, sv * 0.16, 0.03, 0.03, 0.06, 8);
  f.span(M.dark, -0.25, 0.1, 0.22, 0.25, 0.4, 0.224);
  for (let i = 0; i < 3; i++) f.box(M.white, -0.1 + i * 0.012, 0.12 + i * 0.05, 0.1, 0.21, 0.048, 0.297);
  L.labPrinter(c, x, 0.7, z, f.yaw);
  f.box(M.white, 0.0, 0.64, 0.27, 0.21, 0.002, 0.2, 0, [1.1, 0, 0]);
  f.col(-0.28, -0.22, 0.28, 0.24, 0.98, SURF.metal);
}

/**
 * Sequencing (the genomics core): the production sequencers on the west wall under their trunking, their data cabinet
 * and UPS; the pre-PCR bench (the UV cabinet, thermal cyclers, pipettes) south of them; the liquid handler on its bench
 * beside the sealed blast door to containment; the post-PCR island in the middle (cover between the two doors); the
 * −20 bank (two uprights and a chest freezer under the box map) and the analysts' workstations under the big gel /
 * read-map display on the east wall. Left mid-run: a run paused, a plate dropped, printouts, blood at the blast door.
 */
export function dressGenomics(c, s, ctx) {
  const { K, M } = c;
  const { x0, z0, x1, z1, h } = s;
  // west wall: the data cabinet in the corner, three sequencers, the UPS, the pre-PCR bench
  dataRack(c, -33.6, z0, 's', { h: 2.0 });
  L.sequencer(c, x0, -19.0, 'e', { status: 'RUN 0412 · PAUSED 73 %' });
  L.sequencer(c, x0, -18.0, 'e', { status: 'ERR · FLOW CELL TEMP' });
  L.sequencer(c, x0, -17.0, 'e', { status: 'IDLE', on: false });
  ups(c, x0, -16.35, 'e');
  L.socket(c, x0, 0.8, -16.35, 'e');
  // wall trunking over the instruments, a drop to each
  K.box(M.white, x0, 2.3, -20.0, x0 + 0.07, 2.42, -13.3);
  for (const z of [-19.0, -18.0, -17.0]) K.box(M.white, x0, 1.62, z - 0.03, x0 + 0.05, 2.3, z + 0.03);
  L.wallBench(c, x0, -14.6, 'e', 3.0, { shelf: false, gear: 0, knee: 3 });
  pcrCabinet(c, -33.62, 0.92, -15.6, PI / 2);
  L.benchKit(c, -33.55, 0.92, -14.95, PI / 2, 'tips');
  for (const [z, open] of [[-14.55, false], [-14.15, true]]) L.pcrCycler(c, -33.6, 0.92, z, PI / 2, { open });
  L.pipetteRack(c, -33.48, 0.92, -13.42, 0);
  c.label('PRE-PCR · CLEAN AREA · NO AMPLICONS', x0 + 0.01, 2.0, -14.6, 'e', 1.3, 0.13, { bg: '#1f5fa6', fg: '#ffffff', border: '#1f5fa6', font: 'bold 40px Arial' });
  L.labStool(c, -32.75, -15.2, { yaw: 0.5 });
  // the south-west corner: hand sink, the light switch (clear of the door leaf)
  L.sinkUnit(c, -33.55, z1, 'n', { kind: 'hand' });
  L.lightSwitch(c, -32.65, z1, 'n');
  L.wallClock(c, -29.75, 3.05, z1, 'n');
  // north wall: the liquid handler on its bench, the room title, a blood smear beside the blast door
  L.wallBench(c, -32.2, z0, 's', 1.6, { depth: 0.75, shelf: false, gear: 0 });
  liquidHandler(c, -32.3, 0.92, -20.1, 0, { running: true });
  L.benchKit(c, -31.6, 0.92, -19.95, 0, 'laptop');
  roomTitle(c, 'GENOMICS CORE · SEQUENCING', -32.2, 3.2, z0 + 0.01, 's', 2.2);
  c.wallDecal('bloodSmear', -31.28, 1.45, z0, 's', 0.42, 0.9);
  c.decal('blood', -30.3, -19.75, 0.45, 0.6);
  c.decal('blood', -29.6, -19.2, 0.3, 2.1);
  // north wall east of the blast door: extinguisher, notice board, the BSL-3 placard, a camera
  P.extinguisher(c, -28.75, z0, 's');
  L.noticeBoard(c, -27.95, 1.5, z0, 's', { w: 0.9, h: 0.65, notes: ['FLOW CELL ORDER #4471', 'SEQ ROTA · WK 39'] });
  L.hazardPlacard(c, -27.95, 2.3, z0, 's', 'bsl3', { w: 0.5 });
  L.cctvCam(c, -27.0, 3.0, z0, 's', -0.6);
  // east wall: the −20 bank, the box map, the workstations under the display, the printer
  L.freezerUpright(c, x1, -20.0, 'w', { temp: -20, note: ['PRIMERS · ADAPTERS', 'A–C'] });
  L.freezerUpright(c, x1, -19.12, 'w', { temp: -20, alarm: true, note: ['LIBRARIES', 'PLATES 1–40'] });
  chestFreezer(c, x1, -17.85, 'w', { note: ['ENZYMES', "DON'T DEFROST"] });
  L.whiteboardFormula(c, x1, -17.85, 'w', {
    w: 1.2, y: 1.7, h: 0.8, title: '−20 BANK · BOX MAP',
    lines: ['F1  primers / adapters', 'F2  library preps 1–40', 'CHEST  enzymes, master mix', 'run 0412 → K-7 isolates ×96 !!'],
    note: 'AMPLICONS NEVER INTO PRE-PCR',
  });
  L.computerBench(c, x1, -15.4, 'w', 3.2, { stations: 2, monitors: [3, 2] });
  L.dnaGelDisplay(c, x1, 2.15, -15.4, 'w', { w: 2.6, h: 1.25 });
  printerCart(c, -26.78, -13.45, 'w');
  P.extinguisher(c, x1, -12.85, 'w');
  floorPapers(c, -27.9, -14.1, 5, 0.5);
  // the post-PCR island between the doors, its gear, stools round it
  L.islandBench(c, -30.1, -16.6, 2.8, false, { depth: 1.2, gear: 0, shelf: false });
  L.sampleRack(c, -30.45, 0.92, -16.7, -PI / 2, { kind: 'plates' });
  L.pcrCycler(c, -30.45, 0.92, -15.6, -PI / 2, { open: true });
  L.sampleRack(c, -29.75, 0.92, -17.3, PI / 2, { kind: 'plates' });
  L.benchKit(c, -29.75, 0.92, -16.65, PI / 2, 'gel');
  L.benchKit(c, -29.75, 0.92, -15.9, PI / 2, 'tips');
  L.labStool(c, -31.15, -15.8, { yaw: 0.6 });
  L.labStool(c, -32.5, -13.7, { down: true, yaw: 2.4 });
  // left mid-run: a dropped plate and its spill, footprints out, a bin knocked over
  const f = new Frame(c, -32.3, -16.75, 0.7);
  f.box(M.white, 0, 0.008, 0, 0.128, 0.016, 0.086, 0.002, [0.05, 0, 0.1]);
  c.decal('stain', -32.2, -16.65, 0.55, 1.1);
  c.decal('footprints', -29.9, -13.9, 1.3, 0.1);
  Fac.trashCan(c, -28.0, -13.05, { tipped: true });
  floorPapers(c, -28.3, -12.95, 3, 0.35);
}

// ---------------------------------------------------------------- decon
/**
 * A raised drain grating over the rect [x0, z0, x1, z1] (the spray bay's floor): the dark sump under it, a steel
 * angle frame, bearing bars across the short side and the cross bars, a sump hatch with its lifting ring. Walkable.
 */
export function floorGrating(c, x0, z0, x1, z1, { y = 0.03 } = {}) {
  const { K, M, X } = c;
  K.box(M.black, x0, 0.001, z0, x1, 0.003, z1, { faces: ['py'] });
  const t = 0.04;
  K.box(X.a_grating, x0, 0, z0, x1, y, z0 + t);
  K.box(X.a_grating, x0, 0, z1 - t, x1, y, z1);
  K.box(X.a_grating, x0, 0, z0 + t, x0 + t, y, z1 - t);
  K.box(X.a_grating, x1 - t, 0, z0 + t, x1, y, z1 - t);
  const alongX = x1 - x0 >= z1 - z0; // bars span the short way, spaced along the long one
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.floor((len - 2 * t) / 0.05);
  for (let i = 1; i < n; i++) {
    const a = (alongX ? x0 : z0) + t + i * 0.05;
    if (alongX) K.box(X.a_grating, a - 0.004, 0.004, z0 + t, a + 0.004, y - 0.002, z1 - t);
    else K.box(X.a_grating, x0 + t, 0.004, a - 0.004, x1 - t, y - 0.002, a + 0.004);
  }
  const m = Math.max(1, Math.round((alongX ? z1 - z0 : x1 - x0) / 0.4));
  for (let k = 1; k < m; k++) {
    const b = (alongX ? z0 : x0) + (k * (alongX ? z1 - z0 : x1 - x0)) / m;
    if (alongX) K.box(X.a_grating, x0 + t, y - 0.006, b - 0.003, x1 - t, y - 0.001, b + 0.003);
    else K.box(X.a_grating, b - 0.003, y - 0.006, z0 + t, b + 0.003, y - 0.001, z1 - t);
  }
  // the sump hatch in one corner, its ring
  const hx = x1 - 0.32, hz = z1 - 0.32;
  K.box(M.steel, hx - 0.22, y - 0.004, hz - 0.22, hx + 0.22, y + 0.002, hz + 0.22);
  K.add(M.dark, torG(0.035, 0.006, 4, 10), hx, y + 0.004, hz, [PI / 2, 0, 0]);
}

/** a boot rack on the wall at (x, z): two steel rails of angled pegs, `n` pairs of PVC boots upside down, a drip tray */
export function bootRack(c, x, z, face, { len = 0.9, n = 3, missing = 1 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  for (const y of [0.55, 1.2]) f.span(X.a_brushed, -len / 2, y - 0.02, 0.0, len / 2, y + 0.02, 0.03);
  f.span(X.a_grating, -len / 2, 0.02, 0.0, len / 2, 0.05, 0.36);
  f.span(M.black, -len / 2 + 0.02, 0.05, 0.02, len / 2 - 0.02, 0.052, 0.34);
  const pw = len / n;
  for (let i = 0; i < n; i++) {
    for (const [row, y] of [[0, 0.55], [1, 1.2]]) {
      const u0 = -len / 2 + pw * (i + 0.5);
      for (const s of [-1, 1]) {
        const u = u0 + s * pw * 0.22;
        f.rod(X.a_brushed, [u, y, 0.03], [u, y + 0.08, 0.16], 0.008, 4);
        if (row === 1 && i === missing) continue;
        const boot = (i + row) % 3 === 2 ? X.a_bootBlack : X.a_bootYellow;
        // the shaft hanging upside down on the peg, the foot sticking out at the bottom
        f.add(boot, cylC(0.06, 0.055, 0.36, 8), u, y - 0.12, 0.16, [0.12, 0, 0]);
        f.box(boot, u, y - 0.32, 0.23, 0.1, 0.09, 0.24, 0, [0.12, 0, 0]);
        f.box(M.black, u, y - 0.37, 0.25, 0.1, 0.012, 0.26, 0, [0.12, 0, 0]);
      }
    }
  }
  f.label('BOOTS · SPRAY & HANG TO DRY', 0, 1.42, 0.004, 0.6, 0.07, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 34px Arial' });
  f.col(-len / 2, 0, len / 2, 0.38, 1.3, SURF.cardboard, FLAG_NOBULLET);
}

/** a wall holder of `n` nitrile glove boxes at centre height y (sizes S / M / L / XL), a glove pulled half out of one */
export function gloveDispenser(c, x, y, z, face, { n = 3 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const bw = 0.13, W = n * bw + 0.04;
  f.box(X.a_brushed, 0, y, 0.01, W, 0.27, 0.02);
  f.span(X.a_brushed, -W / 2, y - 0.135, 0.02, W / 2, y - 0.125, 0.11);
  const sizes = ['S', 'M', 'L', 'XL'];
  for (let i = 0; i < n; i++) {
    const u = -W / 2 + 0.02 + bw * (i + 0.5);
    f.box(X.a_carton, u, y, 0.065, bw - 0.01, 0.25, 0.09);
    f.box(i % 2 ? X.a_glovePurple : X.a_gloveBlue, u, y + 0.07, 0.111, bw - 0.012, 0.05, 0.002);
    f.box(M.black, u, y - 0.04, 0.111, 0.07, 0.03, 0.002);
    f.label(sizes[i % 4], u, y + 0.07, 0.113, 0.05, 0.04, { bg: '#4a78d6', fg: '#ffffff', border: '#4a78d6', font: 'bold 60px Arial' });
  }
  f.box(X.a_gloveBlue, -W / 2 + 0.02 + bw * 0.5, y - 0.1, 0.13, 0.07, 0.12, 0.008, 0, [0.3, 0, 0.2]);
}

/**
 * The decon cycle's control panel on the wall at (x, z): a stainless enclosure (centre height 1.4), the cycle display,
 * lit push buttons, a key switch, the mushroom e-stop in its yellow collar, the buzzer, conduit up to the ceiling.
 */
export function deconPanel(c, x, z, face, { ceil = 3.2, stage = 'CYCLE 3/5 · RINSE · 02:41' } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const y = 1.4;
  f.box(X.a_brushed, 0, y, 0.06, 0.5, 0.66, 0.12, 0.015);
  f.span(M.dark, -0.24, y + 0.33, 0.115, 0.24, y + 0.335, 0.122);
  f.box(M.black, 0, y + 0.18, 0.121, 0.4, 0.16, 0.004);
  f.label(stage, 0, y + 0.18, 0.124, 0.38, 0.14, { bg: '#06140c', fg: '#62ff9a', border: '#06140c', font: 'bold 34px monospace', lines: [stage.split(' · ')[0], stage.split(' · ').slice(1).join(' · ')] });
  const btn = [G.a_status, G.a_amber, U.ledR];
  for (let i = 0; i < 3; i++) {
    f.hcyl(M.dark, -0.14 + i * 0.14, y - 0.02, 0.125, 0.034, 0.012, 12, 'v');
    f.hcyl(btn[i], -0.14 + i * 0.14, y - 0.02, 0.135, 0.026, 0.012, 12, 'v');
  }
  f.label('START   HOLD   ABORT', 0, y + 0.04, 0.122, 0.4, 0.04, { bg: '#b7bec4', fg: '#16181a', border: '#b7bec4', font: 'bold 34px Arial' });
  // the e-stop and the key switch
  f.hcyl(M.yellow, -0.1, y - 0.2, 0.124, 0.06, 0.008, 14, 'v');
  f.hcyl(M.red, -0.1, y - 0.2, 0.14, 0.022, 0.03, 10, 'v');
  f.add(M.red, domeG(0.045, 12), -0.1, y - 0.2, 0.155, [PI / 2, 0, 0]);
  f.hcyl(X.a_brushed, 0.12, y - 0.2, 0.128, 0.025, 0.016, 10, 'v');
  f.box(M.black, 0.12, y - 0.2, 0.137, 0.008, 0.03, 0.006, 0, [0, 0, 0.6]);
  for (let i = 0; i < 4; i++) f.box(M.black, 0.16, y - 0.27 + i * 0.012, 0.121, 0.06, 0.004, 0.002);
  // conduit to the ceiling, a gland under the box
  f.box(M.grey, -0.22, (y + 0.33 + ceil) / 2, 0.025, 0.04, ceil - y - 0.33, 0.04);
  f.cyl(M.dark, 0, y - 0.36, 0.06, 0.02, 0.02, 0.03, 8);
  f.label('DECON CONTROL', 0, y + 0.42, 0.004, 0.36, 0.07, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 40px Arial' });
}

/**
 * The disinfectant dosing station on the floor against the wall at (x, z): a yellow bund tray, the blue drum with its
 * suction lance, the dosing pump on a wall plate with its stroke dial, tubing to it and on up to the spray header.
 */
export function dosingUnit(c, x, z, face, { ceil = 3.2, up = 2.3 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.yellow, -0.32, 0, 0.04, 0.32, 0.12, 0.6, 0.01);
  f.span(M.dark, -0.29, 0.1, 0.07, 0.29, 0.121, 0.57);
  f.cyl(X.a_chemBlue, -0.08, 0.12, 0.32, 0.21, 0.21, 0.62, 16);
  for (const y of [0.3, 0.58]) f.add(X.a_chemBlue, torG(0.212, 0.01, 4, 16), -0.08, y, 0.32, [PI / 2, 0, 0]);
  f.cyl(X.a_hdpe, -0.08, 0.74, 0.32, 0.05, 0.05, 0.03, 10);
  f.cyl(X.a_hdpe, 0.06, 0.74, 0.25, 0.03, 0.03, 0.025, 8);
  f.label('PERACETIC ACID 5 % · CORROSIVE', -0.08, 0.36, 0.532, 0.3, 0.1, { bg: '#ffffff', fg: '#b3141a', border: '#b3141a', font: 'bold 30px Arial', lines: ['PERACETIC ACID 5 %', 'CORROSIVE · OXIDIZER'] });
  // the pump on its wall plate
  f.box(X.a_hdpe, 0.12, 1.1, 0.01, 0.34, 0.4, 0.02);
  f.box(M.white, 0.12, 1.1, 0.08, 0.2, 0.22, 0.12, 0.02);
  f.hcyl(M.red, 0.12, 1.16, 0.15, 0.04, 0.02, 12, 'v');
  f.box(M.black, 0.12, 1.04, 0.141, 0.1, 0.04, 0.004);
  f.box(U.ledG, 0.19, 1.04, 0.142, 0.012, 0.012, 0.004);
  const tube = cached('doseTube', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.06, 0.76, 0.32), V(-0.02, 0.95, 0.3), V(0.06, 1.0, 0.14), V(0.06, 0.98, 0.08)]), 10, 0.007, 5));
  f.add(U.glass, tube, 0, 0, 0);
  f.rod(M.white, [0.2, 1.2, 0.06], [0.2, up, 0.06], 0.008, 5);
  f.rod(M.white, [0.2, up, 0.06], [0.2, Math.min(ceil - 0.05, up + 0.3), 0.03], 0.008, 5);
  f.col(-0.32, 0.04, 0.32, 0.6, 0.76, SURF.metal);
}

/** a hazmat suit torn off and dropped on the floor at (x, z) turned yaw: torso, splayed arms and legs, the hood */
export function droppedSuit(c, x, z, yaw = 0) {
  const { U, X } = c;
  const f = new Frame(c, x, z, yaw);
  const s = X.a_suit;
  f.add(s, capG(0.17, 0.4, 3, 8), 0, 0.07, 0, [PI / 2, 0.15, 0], [1.25, 1, 0.42]);
  f.add(s, capG(0.07, 0.42, 2, 6), -0.33, 0.045, -0.12, [PI / 2, 1.1, 0], [1, 1, 0.6]);
  f.add(s, capG(0.07, 0.4, 2, 6), 0.32, 0.045, -0.3, [PI / 2, -0.5, 0], [1, 1, 0.6]);
  f.add(s, capG(0.085, 0.55, 2, 6), -0.13, 0.05, 0.6, [PI / 2, 0.25, 0], [1, 1, 0.55]);
  f.add(s, capG(0.085, 0.5, 2, 6), 0.16, 0.05, 0.55, [PI / 2, -0.35, 0], [1, 1, 0.55]);
  // the hood crumpled up by the collar, the visor face up, a glove still in a sleeve
  f.add(s, sphG(0.16, 10, 6), 0.05, 0.09, -0.48, null, [1.1, 0.55, 1]);
  f.box(U.glass, 0.05, 0.16, -0.5, 0.22, 0.008, 0.16, 0, [0.15, 0.2, 0]);
  f.add(X.a_gloveBlue, sphG(0.05, 8, 6), -0.62, 0.04, 0.08, null, [1, 0.5, 1.4]);
  f.add(X.a_bootYellow, rbox(0.11, 0.1, 0.27), 0.25, 0.05, 0.95, [0, 0.4, PI / 2]);
}

/** a half-face respirator on a surface at (x, y, z) turned yaw: the rubber mask, two magenta filter cartridges, its strap */
export function respirator(c, x, y, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, { y });
  f.add(X.a_bootBlack, sphG(0.06, 10, 6), 0, 0.04, 0, null, [1, 0.75, 1.1]);
  for (const s of [-1, 1]) {
    f.add(X.a_glovePurple, cylC(0.035, 0.035, 0.025, 10), s * 0.07, 0.035, 0.02, [0, 0, PI / 2 + s * 0.3]);
    f.add(M.dark, cylC(0.02, 0.02, 0.028, 8), s * 0.065, 0.035, 0.02, [0, 0, PI / 2 + s * 0.3]);
  }
  f.add(M.black, torG(0.08, 0.005, 3, 12), 0, 0.01, -0.03, [PI / 2, 0, 0]);
}

/**
 * The decon airlock: the spray bay at the back (the wall spray manifold over a raised drain grating, its valve box,
 * the cycle panel and the disinfectant dosing station), two chemical shower stalls on the north wall, the hose reel;
 * the suit-up side by the door (hazmat suits on the east wall, boots and gloves, the PPE bench west). Left in a
 * hurry: one suit torn off on the floor, its hanger empty, blood in a shower, water everywhere, wet prints to the door.
 */
export function dressDecon(c, s, ctx) {
  const { K, M } = c;
  const { x0, z0, x1, z1, h } = s;
  // the spray bay: manifold, grating, the hazard line at its edge, the warning light
  L.sprayManifold(c, x0, -6.2, 'e', { w: 1.8, ceil: h });
  floorGrating(c, x0 + 0.05, -7.3, -12.75, -4.92);
  K.box(M.hazard, x0, 0.001, -4.9, -12.7, 0.006, -4.8, { faces: ['py'] });
  L.warningBeacon(c, x0, 2.7, -6.2, 'e');
  // north wall: the cycle panel, the dosing station, two shower stalls (blood in the first)
  deconPanel(c, -14.05, z0, 's', { ceil: h });
  dosingUnit(c, -13.35, z0, 's', { ceil: h });
  L.showerStall(c, -12.04, z0, 's', { w: 0.98, d: 1.0, curtain: 0.3, blood: true });
  L.showerStall(c, -11.0, z0, 's', { w: 0.98, d: 1.0, curtain: 0.85, left: false });
  c.label('DECON SEQUENCE', -11.52, 2.72, z0 + 0.01, 's', 1.7, 0.5, {
    bg: '#f4f1e6', fg: '#16181a', border: '#d6a31a', font: 'bold 30px Arial', align: 'left',
    lines: ['DECON SEQUENCE', '1  SPRAY 30 s · ARMS UP, TURN', '2  SCRUB BOOTS & GLOVES', '3  DOFF SUIT · BAG IT', '4  SHOWER 3 min'],
  });
  roomTitle(c, 'DECON · PERSONNEL', -13.25, 2.95, z0 + 0.01, 's', 1.55, '#d6a31a');
  // east wall: the hose reel, the suits (one hanger bare), boots, gloves
  L.hoseReel(c, x1, 1.25, -6.7, 'w', { hose: M.yellow });
  L.hazmatRack(c, x1, -5.25, 'w', { len: 2.1, n: 3, empty: [1] });
  bootRack(c, x1, -3.65, 'w', { len: 0.8, n: 2, missing: 0 });
  gloveDispenser(c, x1, 1.75, -3.65, 'w');
  // west wall: the PPE bench with a respirator left on it, the clock, the light switch
  L.ppeBench(c, x0, -4.1, 'e', 1.6);
  respirator(c, -14.25, 0.47, -3.75, 0.8);
  L.wallClock(c, x0, 2.6, -4.1, 'e');
  L.lightSwitch(c, x0, -2.9, 'e');
  // the door wall, inside: the red cycle light over the door, its notice
  L.warningBeacon(c, -12.75, 2.68, z1, 'n', { red: true, lit: false });
  c.label('DECON IN PROGRESS · DO NOT ENTER', -12.75, 2.98, z1 - 0.01, 'n', 1.3, 0.12, { bg: '#b3141a', fg: '#ffffff', border: '#b3141a', font: 'bold 40px Arial' });
  // the mess: the dropped suit, a mop bucket, the tipped wet-floor sign, a bin, water and prints to the door
  droppedSuit(c, -12.15, -5.2, 2.0);
  Fac.mopBucket(c, -11.45, -6.6, 0.6);
  Fac.wetFloorSign(c, -12.55, -4.25, 0.5, { down: true });
  L.wasteBin(c, -11.3, -3.4, { kind: 'bio', open: true });
  c.decal('puddle', -13.3, -6.1, 1.5, 0.4);
  c.decal('puddle', -12.0, -6.55, 1.0, 1.9);
  c.decal('blood', -12.25, -6.8, 0.35, 0.4);
  c.decal('footprints', -12.85, -4.0, 1.5, 0.15);
  c.decal('footprints', -12.6, -3.0, 1.0, 0.0);
}

// ---------------------------------------------------------------- cryo
/** an oxygen-depletion monitor on the wall at centre height y: the display, the red strobe on top, the sensor head, its notice */
export function o2Monitor(c, x, y, z, face, { level = '20.9' } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.yellow, 0, y, 0.045, 0.22, 0.28, 0.09, 0.015);
  f.box(M.black, 0, y + 0.04, 0.091, 0.16, 0.08, 0.004);
  f.label(`O₂ ${level} %`, 0, y + 0.04, 0.094, 0.15, 0.06, { bg: '#06140c', fg: '#7dffb0', border: '#06140c', font: 'bold 44px monospace' });
  f.box(G.a_o2, -0.06, y - 0.05, 0.092, 0.02, 0.012, 0.004);
  f.box(U.ledA, 0.0, y - 0.05, 0.092, 0.02, 0.012, 0.004);
  f.box(M.dark, 0.06, y - 0.05, 0.092, 0.02, 0.012, 0.004);
  f.cyl(M.dark, 0, y + 0.14, 0.05, 0.035, 0.035, 0.02, 10);
  f.add(U.red, domeG(0.035, 10), 0, y + 0.16, 0.05);
  f.cyl(X.a_robot, 0, y - 0.32, 0.05, 0.03, 0.03, 0.12, 10);
  f.cyl(M.dark, 0, y - 0.335, 0.05, 0.025, 0.025, 0.015, 10);
  f.rod(M.grey, [0, y - 0.2, 0.05], [0, y - 0.14, 0.05], 0.01, 5);
  f.label('O₂ MONITOR · LEAVE IF ALARM SOUNDS', 0, y + 0.26, 0.003, 0.4, 0.07, { bg: '#d6a31a', fg: '#16181a', border: '#d6a31a', font: 'bold 32px Arial' });
}

/**
 * Cryo PPE on the wall at (x, z): a white pegboard (centre height 1.5), face shields on hooks, gauntlet cryo gloves,
 * a long black apron hanging below, the notice over it (hook `empty` left bare).
 */
export function cryoPPEBoard(c, x, z, face, { w = 1.0, empty = -1 } = {}) {
  const { U, X } = c;
  const f = new Frame(c, x, z, face);
  const y = 1.5;
  f.box(X.a_carton, 0, y, 0.01, w, 0.7, 0.02);
  for (let i = 0; i < 4; i++) {
    const u = -w / 2 + 0.14 + i * ((w - 0.28) / 3);
    f.rod(X.a_brushed, [u, y + 0.25, 0.02], [u, y + 0.27, 0.08], 0.006, 4);
    if (i === empty) continue;
    if (i < 2) {
      // a face shield: the headband, the visor hanging down
      f.add(X.a_robot, torG(0.09, 0.012, 4, 12, PI), u, y + 0.22, 0.09, [PI / 2, 0, 0]);
      f.box(U.glass, u, y + 0.08, 0.13, 0.22, 0.24, 0.004, 0, [-0.12, 0, 0]);
    } else {
      // a pair of gauntlets
      for (const s of [-1, 1]) {
        f.box(X.a_cryoGlove, u + s * 0.05, y + 0.08, 0.06, 0.1, 0.32, 0.04, 0, [0, 0, s * 0.08]);
        f.box(X.a_cryoGlove, u + s * 0.05, y - 0.1, 0.06, 0.09, 0.08, 0.035, 0, [0, 0, s * 0.08]);
      }
    }
  }
  // the apron on its own hook at the end
  const au = w / 2 + 0.22;
  f.rod(X.a_brushed, [au, 1.9, 0.0], [au, 1.92, 0.07], 0.007, 4);
  f.box(X.a_apron, au, 1.38, 0.05, 0.42, 1.0, 0.02, 0, [0.03, 0, 0]);
  f.rod(X.a_apron, [au - 0.1, 1.86, 0.06], [au, 1.92, 0.07], 0.008, 4);
  f.rod(X.a_apron, [au + 0.1, 1.86, 0.06], [au, 1.92, 0.07], 0.008, 4);
  f.label('CRYO PPE · FACE SHIELD · GLOVES · APRON', 0.1, y + 0.45, 0.004, w + 0.2, 0.09, { bg: '#1d4f7a', fg: '#ffffff', border: '#1d4f7a', font: 'bold 36px Arial' });
}

/** an irregular patch of ice on the floor at (x, z), about `size` across, turned rot: glossy ice, a rime rim inside */
export function icePatch(c, x, z, size = 1.0, rot = 0) {
  const { X } = c;
  const mk = (k) => {
    const sh = new THREE.Shape();
    const n = 11;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2, r = (size / 2) * k * (0.65 + c.rnd() * 0.45);
      const px = Math.cos(a) * r * 1.2, pz = Math.sin(a) * r * 0.8;
      if (i === 0) sh.moveTo(px, pz);
      else sh.lineTo(px, pz);
    }
    return new THREE.ShapeGeometry(sh);
  };
  c.K.add(X.a_ice, mk(1), x, 0.003, z, [-PI / 2, rot, 0, 'YXZ']);
  c.K.add(X.a_rime, mk(0.45), x + jit(c, size * 0.1), 0.005, z + jit(c, size * 0.1), [-PI / 2, rot + 0.7, 0, 'YXZ']);
}

/**
 * A vacuum-jacketed cryogen line through the 3D points `pts` ([[x, y, z], ...]): the insulated run, rime collars at
 * the joints, frost bands along it, a bracket stub to the wall every 1.2 m when `wall` names the wall's side.
 */
export function coldLine(c, pts, { r = 0.045, wall = null } = {}) {
  const { K, X, M } = c;
  const band = torG(r * 1.12, r * 0.25, 4, 12);
  const off = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[wall] ?? null; // toward the wall
  for (let i = 0; i < pts.length - 1; i++) {
    const a = V(...pts[i]), b = V(...pts[i + 1]);
    K.rod(X.a_foam, a, b, r, 10);
    const d = b.clone().sub(a), L0 = d.length();
    d.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d);
    const e = new THREE.Euler().setFromQuaternion(q);
    for (let t = 0.35; t < L0 - 0.2; t += 0.7) {
      const p = a.clone().addScaledVector(d, t);
      K.add(X.a_rime, band, p.x, p.y, p.z, [e.x, e.y, e.z]);
      if (off && Math.abs(d.y) < 0.5 && ((t - 0.35) / 0.7) % 2 === 0) K.rod(M.dark, p, V(p.x + off[0] * 0.12, p.y, p.z + off[1] * 0.12), 0.012, 4);
    }
  }
  for (const p of pts.slice(1, -1)) K.add(X.a_rime, sphG(r * 1.35, 10, 6), p[0], p[1], p[2]);
}

/**
 * An LN₂ fill point on the wall at (x, z): the frosted drop from the line above (top y `from`), the cryogenic valve
 * with its long bonnet and hand wheel, a gauge, the braided fill hose with its phase separator down into a 50 L
 * dewar standing on a platform scale (its readout), ice under it all; the notices.
 */
export function fillStation(c, x, z, face, { from = 3.1, kg = '41.3 kg' } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.a_brushed, 0, 1.45, 0.01, 0.5, 0.75, 0.02);
  const top = f.p(0, from, 0.09), mid = f.p(0, 1.62, 0.09);
  coldLine(c, [[top.x, top.y, top.z], [mid.x, mid.y, mid.z]], { r: 0.04 });
  // the valve: body, bonnet, wheel, rime
  f.box(X.a_brushed, 0, 1.55, 0.1, 0.1, 0.12, 0.1, 0.01);
  f.hcyl(X.a_brushed, 0, 1.55, 0.22, 0.02, 0.2, 8, 'v');
  f.add(M.blue, torG(0.07, 0.01, 4, 14), 0, 1.55, 0.33);
  for (let k = 0; k < 3; k++) f.add(M.blue, rbox(0.13, 0.012, 0.012), 0, 1.55, 0.33, [0, 0, (k * PI) / 3]);
  f.add(X.a_rime, sphG(0.075, 10, 6), 0, 1.52, 0.1, null, [1, 1.2, 1]);
  f.gauge(0.16, 1.62, 0.02, 0.09);
  f.hcyl(X.a_brushed, 0, 1.43, 0.1, 0.025, 0.08, 8, 'v');
  // the hose down to the phase separator, standing in the dewar's neck
  const hose = cached('fillHose', () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 1.43, 0.14), V(0.05, 1.38, 0.3), V(0.12, 1.18, 0.42), V(0.12, 1.02, 0.45)]), 12, 0.016, 6));
  f.add(X.a_brushed, hose, 0, 0, 0);
  f.cyl(M.steel, 0.12, 0.88, 0.45, 0.04, 0.04, 0.14, 10);
  f.cyl(X.a_rime, 0.12, 0.86, 0.45, 0.045, 0.045, 0.03, 10);
  // the dewar on its scale
  f.span(X.a_brushed, -0.18, 0, 0.2, 0.42, 0.06, 0.72, 0.01);
  f.cyl(X.a_brushed, 0.12, 0.06, 0.45, 0.22, 0.22, 0.6, 16);
  f.add(X.a_brushed, domeG(0.22, 16), 0.12, 0.66, 0.45);
  f.cyl(M.dark, 0.12, 0.8, 0.45, 0.055, 0.05, 0.06, 10);
  for (const y of [0.2, 0.55]) f.add(X.a_rime, torG(0.222, 0.012, 4, 16), 0.12, y, 0.45, [PI / 2, 0, 0]);
  f.box(M.dark, -0.15, 0.5, 0.25, 0.04, 0.9, 0.04);
  f.box(M.black, -0.15, 0.98, 0.27, 0.16, 0.1, 0.05, 0.01);
  f.label(kg, -0.15, 0.98, 0.296, 0.13, 0.05, { bg: '#08121a', fg: '#5ee0ff', border: '#08121a', font: 'bold 44px monospace' });
  f.label('LN₂ FILL POINT · FACE SHIELD ON · NEVER SEAL A DEWAR', 0, 1.95, 0.004, 0.5, 0.12, { bg: '#1d4f7a', fg: '#ffffff', border: '#1d4f7a', font: 'bold 30px Arial', lines: ['LN₂ FILL POINT', 'FACE SHIELD ON · NEVER SEAL A DEWAR'] });
  const g = f.p(0.12, 0, 0.45);
  icePatch(c, g.x, g.z, 0.6, 0.4);
  f.col(-0.18, 0.2, 0.42, 0.72, 1.0, SURF.metal);
}

/**
 * The cryo monitoring console on the wall at (x, z), len long: a steel desk with a drawer pedestal, two monitors,
 * keyboard, phone, the temperature logbook and a mug; on the wall over it the status board of every unit (one in
 * alarm) and a circular chart recorder; a chair. The board glows (one baked light).
 */
export function cryoConsole(c, x, z, face, len = 2.0, { units = null, alarm = 3 } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, face);
  const D = 0.75, T = 0.75;
  f.span(X.a_brushed, -len / 2, T - 0.03, 0, len / 2, T, D, 0.006);
  for (const su of [-1, 1]) f.span(M.grey, su * (len / 2 - 0.04) - 0.025, 0, 0.05, su * (len / 2 - 0.04) + 0.025, T - 0.03, D - 0.05);
  f.span(M.grey, len / 2 - 0.5, 0, 0.05, len / 2 - 0.08, T - 0.03, D - 0.05);
  for (let i = 0; i < 3; i++) {
    f.span(M.dark, len / 2 - 0.48, 0.05 + i * 0.22, D - 0.05, len / 2 - 0.1, 0.06 + i * 0.22, D - 0.045);
    f.box(X.a_brushed, len / 2 - 0.29, 0.17 + i * 0.22, D - 0.035, 0.12, 0.015, 0.02);
  }
  // two monitors, keyboard, phone, the logbook, a mug
  for (const [u, a] of [[-0.35, 0.12], [0.15, -0.12]]) {
    f.box(M.dark, u, T + 0.008, 0.22, 0.2, 0.016, 0.15);
    f.box(M.dark, u, T + 0.13, 0.2, 0.04, 0.24, 0.03);
    f.box(M.black, u, T + 0.31, 0.22, 0.54, 0.32, 0.03, 0, [0, a, 0]);
    const p = f.p(u + Math.sin(a) * 0.017, 0, 0.22 + Math.cos(a) * 0.017);
    c.screen(p.x, T + 0.31, p.z, f.yaw + a, 0.5, 0.28, true);
  }
  f.box(M.black, -0.1, T + 0.012, 0.5, 0.44, 0.02, 0.14);
  f.box(M.black, -0.75, T + 0.03, 0.35, 0.18, 0.06, 0.2, 0.01);
  f.box(M.dark, -0.75, T + 0.07, 0.3, 0.05, 0.03, 0.2, 0.01, [0, 0.2, 0]);
  f.box(M.blue, 0.55, T + 0.012, 0.45, 0.42, 0.02, 0.3, 0, [0, -0.15, 0]);
  f.box(X.a_carton, 0.55, T + 0.024, 0.45, 0.4, 0.004, 0.28, 0, [0, -0.15, 0]);
  f.cyl(M.white, 0.25, T, 0.55, 0.04, 0.038, 0.1, 10);
  // the status board and the chart recorder over the desk
  const list = units ?? ['F-01 −79.6', 'F-02 −80.1', 'F-03 −78.9', 'F-04 −41.2', 'F-05 −80.4', 'LN₂-A 18 %', 'LN₂-B 61 %', 'COLD RM −19.8'];
  f.box(M.black, -0.25, 1.75, 0.03, 1.3, 0.62, 0.05, 0.01);
  f.span(G.a_cold, -0.88, 2.04, 0.056, 0.38, 2.055, 0.058);
  list.forEach((t, i) => {
    const bad = i === alarm;
    f.label(bad ? `${t} ALARM` : t, -0.88 + 0.33 + (i % 2) * 0.63, 1.93 - Math.floor(i / 2) * 0.13, 0.057, 0.58, 0.11, { bg: bad ? '#5a0a08' : '#06121a', fg: bad ? '#ff5a4a' : '#8fd8ff', border: bad ? '#ff3a2a' : '#06121a', font: 'bold 40px monospace' });
  });
  f.box(X.a_robot, 0.72, 1.7, 0.06, 0.4, 0.42, 0.12, 0.015);
  f.add(M.white, discG(0.15, 20), 0.72, 1.72, 0.121);
  f.add(M.red, rbox(0.12, 0.004, 0.002), 0.78, 1.74, 0.123, [0, 0, 0.5]);
  f.cyl(M.dark, 0.72, 1.72, 0.121, 0.012, 0.012, 0.004, 8);
  f.label('7-DAY TEMP LOG', 0.72, 1.53, 0.121, 0.3, 0.04, { bg: '#d7dadd', fg: '#22344a', border: '#d7dadd', font: 'bold 34px Arial' });
  f.light(-0.25, 1.75, 0.4, 0.3, 1.4, [0.6, 0.85, 1.0], null, 3);
  const cp = f.p(-0.2, 0, D + 0.45);
  P.chair(c, cp.x, cp.z, f.yaw + PI + jit(c, 0.6), false);
  f.col(-len / 2, 0, len / 2, D, T, SURF.metal);
}

/**
 * The sample sorting table at (x, z) turned yaw (long along u): a steel top on legs with an undershelf (a polystyrene
 * shipper on it), a dry-ice cooler with its lid off, cryo-box towers, loose boxes and vials, gauntlets, a clipboard.
 */
export function cryoSortTable(c, x, z, yaw = 0, { w = 1.6, d = 0.8 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  const T = 0.9;
  f.span(X.a_brushed, -w / 2, T - 0.04, -d / 2, w / 2, T, d / 2, 0.006);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.box(M.steel, su * (w / 2 - 0.05), (T - 0.04) / 2, sv * (d / 2 - 0.05), 0.04, T - 0.04, 0.04);
  f.span(M.steel, -w / 2 + 0.05, 0.2, -d / 2 + 0.05, w / 2 - 0.05, 0.22, d / 2 - 0.05);
  f.box(M.white, -0.3, 0.38, 0, 0.5, 0.32, 0.4, 0.01);
  f.box(M.card, 0.3, 0.32, 0.02, 0.4, 0.2, 0.35);
  // the dry-ice cooler, lid off and leant against it, rime on the pellets
  f.box(M.white, -0.45, T + 0.14, -0.1, 0.42, 0.28, 0.34, 0.02);
  f.span(X.a_rime, -0.63, T + 0.2, -0.24, -0.27, T + 0.27, 0.04);
  f.box(M.white, -0.45, T + 0.03, 0.17, 0.42, 0.05, 0.34, 0.01, [0, 0.25, 0]);
  // cryo-box towers, loose boxes, vials, gloves, a clipboard
  for (const [u, v, a] of [[0.05, -0.2, 0], [0.25, -0.22, 0.2]]) {
    const [sx, sz] = xz(f, u, v);
    L.sampleRack(c, sx, T, sz, f.yaw + a, { kind: 'cryo' });
  }
  for (let i = 0; i < 4; i++) f.box(pick(c, [M.card, M.white, M.blue, M.red]), 0.15 + i * 0.15, T + 0.026, 0.15 + jit(c, 0.04), 0.13, 0.052, 0.13, 0, [0, jit(c, 0.3), 0]);
  for (let i = 0; i < 6; i++) f.cyl(pick(c, [M.white, M.yellow, M.red]), 0.6 + jit(c, 0.1), T, -0.15 + jit(c, 0.1), 0.007, 0.007, 0.045, 6);
  for (const s of [-1, 1]) f.box(X.a_cryoGlove, -0.05 + s * 0.08, T + 0.02, 0.25, 0.11, 0.04, 0.34, 0, [0, s * 0.3, 0]);
  f.box(M.dark, 0.62, T + 0.006, 0.18, 0.24, 0.012, 0.32, 0, [0, 0.2, 0]);
  f.box(X.a_carton, 0.62, T + 0.013, 0.19, 0.21, 0.002, 0.28, 0, [0, 0.2, 0]);
  f.col(-w / 2, -d / 2, w / 2, d / 2, T, SURF.metal);
}
/** a frame's local (u, v) as world [x, z] */
function xz(f, u, v) {
  const p = f.p(u, 0, v);
  return [p.x, p.z];
}

/**
 * Cryo storage: the −80 row down the west wall and the walk-in cold room in its south corner; the bulk LN₂ tank in the
 * north-east corner feeding a frosted line along the wall to the fill point; the gas manifold, the monitoring console
 * (one freezer in alarm) and the dewar rack down the east wall; LN₂ vessels and the sorting table as cover in the
 * west half, the transfer trolley in the east; ice on the floor. Left: a vessel open, a box rack spilled beside it,
 * a smeared hand on the cold room door, frosted prints to the waste door.
 */
export function dressCryo(c, s, ctx) {
  const { K, M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  // north-west corner: the O₂ monitor, placards, extinguisher, switch
  o2Monitor(c, -33.5, 1.7, z0, 's');
  L.hazardPlacard(c, -33.45, 2.4, z0, 's', 'o2', { w: 0.5 });
  L.hazardPlacard(c, -32.85, 2.4, z0, 's', 'cryo', { w: 0.5 });
  L.lightSwitch(c, -32.75, z0, 's');
  L.socket(c, -33.0, 0.3, z0, 's');
  P.extinguisher(c, x0, 3.12, 'e');
  roomTitle(c, 'CRYO STORAGE · LN₂', -28.75, 3.3, z0 + 0.01, 's', 2.4, '#3aa6d6');
  // west wall: the −80 row (F-04 in alarm), the PPE board, the cold room
  const notes = [['F-01', 'K-7 SERUM'], ['F-02', 'TISSUE BANK'], ['F-03', 'PLASMA 0-12'], ['F-04', 'ISOLATES · DO NOT OPEN'], ['F-05', 'BACKUP']];
  notes.forEach((n, i) => L.freezerUpright(c, x0, 3.95 + i * 0.87, 'e', { alarm: i === 3, note: n, temp: i === 3 ? -41 : -80 }));
  cryoPPEBoard(c, x0, 8.75, 'e', { w: 0.8, empty: 3 });
  L.coldRoom(c, x0, 9.3, -31.3, z1, 'e', { door: 0.1, temp: '−19.8 °C', name: 'COLD ROOM 2' });
  c.wallDecal('bloodSmear', -31.29, 1.15, 12.05, 'e', 0.28, 0.5);
  icePatch(c, -30.85, 11.25, 0.9, 0.3);
  // north-east: the LN₂ tank, its line along the east wall to the fill point
  L.ln2Tank(c, -23.62, 4.0, 'w', { r: 0.75, h: 2.6, ceil: h });
  coldLine(c, [[-23.65, 3.3, 3.9], [-22.6, 3.3, 3.9], [-22.6, 3.3, 5.75]], { wall: 'e' });
  fillStation(c, x1, 5.75, 'w', { from: 3.3 });
  icePatch(c, -24.5, 4.6, 1.3, 1.1);
  c.decal('puddle', -24.9, 5.4, 1.1, 0.5);
  // east wall: gas manifold, the console, the dewar rack
  L.gasManifold(c, x1, 7.3, 'w', { w: 1.6, gases: ['N₂', 'CO₂', 'Ar'], ceil: h });
  cryoConsole(c, x1, 9.4, 'w', 2.0, { alarm: 3 });
  L.dewarRack(c, x1, 11.6, 'w', { len: 1.4, n: 3 });
  L.cctvCam(c, x1, 3.3, 12.6, 'w', 0.7);
  L.wallClock(c, -26.75, 3.05, z1, 'n');
  // the vessels (one left open, its box rack pulled out and dropped) and the sorting table
  L.cryoVessel(c, -31.25, 4.95, { yaw: 0.3, level: 64 });
  L.cryoVessel(c, -30.2, 5.0, { yaw: 2.2, open: true, level: 18 });
  L.cryoVessel(c, -31.2, 6.0, { yaw: 4.1, level: 51 });
  icePatch(c, -29.6, 5.6, 0.9, 0.2);
  const f = new Frame(c, -29.35, 6.05, 1.2, { y: 0.07, tilt: [PI / 2 - 0.15, 0] });
  f.span(M.steel, -0.07, 0, -0.07, 0.07, 0.62, 0.07);
  for (let i = 0; i < 3; i++) K.cube(pick(c, [M.card, M.white, M.blue]), -29.0 + i * 0.22, 0.03, 6.35 + jit(c, 0.15), 0.13, 0.05, 0.13, c.rnd() * 3);
  for (let i = 0; i < 5; i++) K.cyl(pick(c, [M.white, M.yellow]), -28.8 + jit(c, 0.3), 0.007, 6.1 + jit(c, 0.3), 0.007, 0.007, 0.045, 6, [PI / 2, c.rnd() * 3, 0]);
  K.cube(X.a_cryoGlove, -28.6, 0.02, 5.7, 0.11, 0.04, 0.34, 0.8);
  cryoSortTable(c, -30.4, 8.3, 0);
  // the transfer trolley, a dewar on it; frosted prints out to the waste door
  L.labTrolley(c, -26.4, 7.4, 0.5, { load: 'dewar' });
  c.decal('footprints', -27.4, 9.6, 1.6, 0.3);
  c.decal('footprints', -26.9, 11.6, 1.2, 0.1);
  c.decal('puddle', -23.6, 11.5, 0.8, 1.2);
}

// ---------------------------------------------------------------- the infirmary
/**
 * A bed-head services panel on the wall at (x, z): the pale trunking (1.45–1.7 m), O₂ and suction outlets with the
 * flowmeter and the suction jar (`jar`) plugged in, sockets, the nurse-call handset on its cord, the reading light
 * under it (`lit`: a baked glow), the bed number.
 */
export function bedHeadPanel(c, x, z, face, { w = 1.4, bed = 'BED 1', lit = false, jar = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const y = 1.58;
  f.box(X.a_mint, 0, y, 0.045, w, 0.26, 0.09, 0.015);
  f.box(M.white, 0, y + 0.135, 0.05, w - 0.04, 0.012, 0.08);
  f.box(lit ? G.a_reading : M.white, 0, y - 0.135, 0.06, w * 0.5, 0.012, 0.05);
  // gas outlets: O₂ (green ring, flowmeter), vacuum (yellow ring, the jar below)
  for (const [u, ring] of [[-w / 2 + 0.18, M.green], [-w / 2 + 0.38, M.yellow]]) {
    f.box(M.white, u, y, 0.093, 0.12, 0.12, 0.008);
    f.hcyl(ring, u, y, 0.1, 0.035, 0.012, 10, 'v');
    f.hcyl(M.steel, u, y, 0.108, 0.018, 0.01, 6, 'v');
  }
  const ou = -w / 2 + 0.18;
  f.hcyl(M.steel, ou, y, 0.13, 0.012, 0.05, 6, 'v');
  f.cyl(U.glass, ou, y - 0.02, 0.17, 0.025, 0.025, 0.2, 10);
  f.cyl(M.green, ou, y + 0.18, 0.17, 0.018, 0.018, 0.03, 8);
  f.cyl(M.white, ou, y - 0.05, 0.17, 0.006, 0.006, 0.02, 6);
  const vu = -w / 2 + 0.38;
  if (jar) {
    f.box(M.steel, vu, y - 0.22, 0.12, 0.03, 0.2, 0.03);
    f.cyl(U.glass, vu, y - 0.52, 0.16, 0.06, 0.06, 0.24, 10, true);
    f.cyl(M.white, vu, y - 0.29, 0.16, 0.063, 0.063, 0.025, 10);
    f.cyl(U.amber, vu, y - 0.52, 0.16, 0.055, 0.055, 0.05, 10); // some fluid in it
  }
  // sockets, the nurse call on its cord, the label
  for (let i = 0; i < 2; i++) {
    const u = w / 2 - 0.16 - i * 0.14;
    f.box(M.white, u, y, 0.093, 0.1, 0.1, 0.008);
    for (const s of [-0.012, 0.012]) f.box(M.black, u + s, y + 0.005, 0.098, 0.005, 0.014, 0.002);
  }
  f.box(M.white, w / 2 - 0.45, y - 0.35, 0.11, 0.05, 0.14, 0.03);
  f.box(M.red, w / 2 - 0.45, y - 0.31, 0.127, 0.025, 0.025, 0.004);
  f.rod(M.white, [w / 2 - 0.45, y - 0.28, 0.11], [w / 2 - 0.42, y - 0.13, 0.095], 0.004, 4);
  f.label(bed, 0.05, y + 0.06, 0.091, 0.22, 0.07, { bg: '#a6d6c6', fg: '#16302a', border: '#a6d6c6', font: 'bold 50px Arial' });
  if (lit) f.light(0, y - 0.2, 0.3, 0.28, 1.2, [1.0, 0.95, 0.85], DOWN, 2.4);
}

/** a bedside locker at (x, z) (centre) facing `face`: a drawer, an open shelf with a towel, a jug, a cup, a kidney dish */
export function bedsideLocker(c, x, z, face, { mess = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const W = 0.46, D = 0.44, H = 0.8;
  f.box(M.dark, 0, 0.02, 0, W - 0.06, 0.04, D - 0.06);
  f.box(X.a_bedside, 0, 0.04 + (H - 0.04) / 2, 0, W, H - 0.04, D, 0.015);
  f.box(X.a_beech, 0, H + 0.012, 0, W + 0.02, 0.025, D + 0.02);
  f.span(M.dark, -W / 2 + 0.03, 0.42, D / 2, W / 2 - 0.03, 0.43, D / 2 + 0.002);
  f.box(X.a_brushed, 0, 0.62, D / 2 + 0.012, 0.16, 0.02, 0.02);
  f.span(M.dark, -W / 2 + 0.03, 0.08, D / 2 - 0.01, W / 2 - 0.03, 0.4, D / 2 + 0.001);
  f.box(pick(c, [M.white, X.a_mint]), 0, 0.2, 0.05, 0.36, 0.12, 0.3);
  // on top
  f.cyl(M.white, -0.12, H + 0.025, -0.06, 0.055, 0.045, 0.2, 10);
  f.cyl(cupMat(c), 0.04, H + 0.025, -0.08, 0.035, 0.03, 0.09, 10);
  f.add(X.a_tray, cached('kidney', () => {
    const sh = new THREE.Shape();
    sh.absellipse(0, 0, 0.12, 0.06, 0, PI * 2, false, 0);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: false, curveSegments: 10 }).rotateX(-PI / 2);
  }), 0.1, H + 0.025, 0.1, [0, 0.4, 0]);
  if (mess) f.box(M.white, -0.05, H + 0.03, 0.12, 0.12, 0.01, 0.12, 0, [0.2, 0.6, 0]);
  f.col(-W / 2, -D / 2, W / 2, D / 2, H, SURF.wood);
}
/** a drinking cup's material: clear glass mostly, sometimes a pale beaker */
const cupMat = (c) => (c.rnd() < 0.7 ? c.U.glass : c.M.white);

/** an overbed table at (x, z) turned yaw: an H base on casters, the steel column, a beech top with a meal tray */
export function overbedTable(c, x, z, yaw = 0, { tray = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  f.box(M.grey, -0.32, 0.05, 0, 0.05, 0.03, 0.5);
  f.box(M.grey, -0.32, 0.05, 0, 0.12, 0.03, 0.05);
  for (const sv of [-1, 1]) f.cyl(M.black, -0.32, 0, sv * 0.22, 0.025, 0.025, 0.04, 6);
  f.box(X.a_brushed, -0.32, 0.45, 0, 0.04, 0.8, 0.04);
  f.box(X.a_beech, 0, 0.86, 0, 0.8, 0.025, 0.4, 0.008);
  f.box(M.grey, -0.2, 0.84, 0, 0.3, 0.02, 0.06);
  if (tray) {
    f.box(X.a_tray, 0.05, 0.882, 0, 0.42, 0.016, 0.3, 0.004);
    f.add(M.white, discG(0.1, 14), -0.03, 0.892, 0, [-PI / 2, 0, 0]);
    f.cyl(M.white, 0.18, 0.89, -0.07, 0.035, 0.03, 0.08, 8);
  }
  f.col(-0.4, -0.26, 0.4, 0.26, 0.88, SURF.wood);
}

/**
 * A three-leaf folding privacy screen at (x, z) turned yaw: steel tube frames on casters, pale fabric panels, the
 * leaves zigzagged at `fold`; soft (bullets pass through).
 */
export function foldingScreen(c, x, z, yaw = 0, { fold = 0.5, w = 0.6, h = 1.7 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  // the leaves' hinge lines along u, alternately folded back by `fold`
  const pts = [[-w * Math.cos(fold) - w / 2, -w * Math.sin(fold)], [-w / 2, 0], [w / 2, 0], [w / 2 + w * Math.cos(fold), -w * Math.sin(fold)]];
  for (let i = 0; i < 3; i++) {
    const [ua, va] = pts[i], [ub, vb] = pts[i + 1];
    const a = Math.atan2(vb - va, ub - ua);
    const L0 = Math.hypot(ub - ua, vb - va);
    const um = (ua + ub) / 2, vm = (va + vb) / 2;
    f.add(X.a_screenCloth, rbox(L0 - 0.05, h - 0.25, 0.008), um, 0.15 + (h - 0.25) / 2 + 0.03, vm, [0, -a, 0]);
    for (const k of [0.15, h - 0.04]) f.add(X.a_brushed, cylC(0.012, 0.012, L0, 6), um, k, vm, [0, -a, PI / 2]);
  }
  for (const [u, v] of pts) {
    f.cyl(X.a_brushed, u, 0.06, v, 0.014, 0.014, h - 0.06, 6);
    f.cyl(M.black, u, 0, v, 0.025, 0.025, 0.06, 6);
  }
  f.col(pts[0][0], -w * Math.sin(fold) - 0.03, pts[3][0], 0.03, h, SURF.cardboard, FLAG_NOBULLET);
}

/** a column scale against the wall at (x, z): platform, the column with its beam and poises, the height rod and its head piece */
export function columnScale(c, x, z, face) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.a_brushed, -0.18, 0, 0.12, 0.18, 0.07, 0.56, 0.012);
  f.span(X.a_bootBlack, -0.16, 0.07, 0.16, 0.16, 0.075, 0.52);
  f.box(M.white, 0, 0.75, 0.1, 0.08, 1.4, 0.06, 0.012);
  f.box(M.white, 0, 1.45, 0.11, 0.16, 0.12, 0.1, 0.012);
  f.box(X.a_brushed, 0, 1.43, 0.17, 0.42, 0.025, 0.02);
  f.box(X.a_brushed, 0, 1.38, 0.17, 0.36, 0.02, 0.02);
  f.box(M.dark, -0.05, 1.43, 0.18, 0.03, 0.04, 0.03);
  f.box(M.dark, 0.12, 1.38, 0.18, 0.025, 0.035, 0.03);
  f.box(X.a_brushed, 0, 1.75, 0.08, 0.025, 0.55, 0.025);
  f.box(X.a_brushed, 0, 1.98, 0.17, 0.02, 0.012, 0.2);
  f.label('kg', 0.2, 1.43, 0.172, 0.04, 0.03, { bg: '#b7bec4', fg: '#16181a', border: '#b7bec4', font: 'bold 40px Arial' });
  f.col(-0.18, 0.05, 0.18, 0.56, 1.5, SURF.metal);
}

/** an alcohol hand-rub dispenser on the wall at height y: the white housing, the bottle window, the push lever, its sticker */
export function handGel(c, x, y, z, face) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.white, 0, y, 0.055, 0.12, 0.24, 0.11, 0.02);
  f.box(U.glass, 0, y + 0.03, 0.111, 0.06, 0.1, 0.004);
  f.box(X.a_mint, 0, y - 0.08, 0.1, 0.1, 0.05, 0.04, 0.01);
  f.cyl(M.dark, 0, y - 0.13, 0.08, 0.008, 0.008, 0.015, 6);
  f.label('HAND HYGIENE', 0, y + 0.2, 0.003, 0.22, 0.06, { bg: '#1d9a4d', fg: '#ffffff', border: '#1d9a4d', font: 'bold 40px Arial' });
}

/**
 * The infirmary: three beds head-on to the west wall, each with its bed-head services, locker and curtained cubicle
 * (bed 2 strapped down, its restraints cut, blood up the wall, a drag to the isolation ward); the clinical side east:
 * the exam table under its lamp and X-ray box behind a folding screen, the scale, the sink and medicine cabinet, the
 * crash cart, the nurses' station and its patient board by the door, a wheelchair. The lane between the two doors
 * stays open down the middle.
 */
export function dressInfirmary(c, s, ctx) {
  const { M } = c;
  const { x0, z0, x1, z1, h } = s;
  const top = h - 0.6; // (the curtain track hangs on 0.6 m drop rods)
  // the beds, their services and lockers
  const beds = [
    { z: -19.4, name: 'BED 1', chart: 'K. OSEI · OBS 2-HOURLY · NBM', opts: { tilt: 0.5 } },
    { z: -16.75, name: 'BED 2', chart: 'SUBJECT 0-17 · RESTRAIN AT ALL TIMES', opts: { tilt: 0.15, blood: true, restraints: true, torn: true, rails: 'down', blanket: false } },
    { z: -14.1, name: 'BED 3', chart: 'M. VARGA · FOR DISCHARGE', opts: { tilt: 0.3, rails: 'down' } },
  ];
  beds.forEach((b, i) => {
    L.hospitalBed(c, x0, b.z, 'e', { ...b.opts, chart: b.chart });
    bedHeadPanel(c, x0, b.z, 'e', { bed: b.name, lit: i === 0, jar: i < 2 });
    bedsideLocker(c, -25.62, b.z - 0.8, 'e', { mess: i === 1 });
  });
  // bed 1: monitor and table; bed 2: monitor still on, its drip pulled over; bed 3: a drip
  overbedTable(c, -24.45, -18.5, 0);
  L.vitalsMonitor(c, -25.45, -15.85, { yaw: 2.0 });
  L.ivStand(c, -24.25, -15.05, { yaw: 0.4, bags: 2 });
  c.decal('puddle', -23.9, -15.9, 0.6, 0.8); // bed 2's drip, torn out and leaking
  // the cubicle curtains (bed 2's drawn round it)
  L.privacyCurtain(c, [[x0 + 0.02, -18.1], [-23.65, -18.1]], top, { drawn: [1] });
  L.privacyCurtain(c, [[x0 + 0.02, -15.45], [-23.65, -15.45], [-23.65, -18.1]], top, { drawn: [0.9, 0.85] });
  // bed 2's story: blood on the bed, up the wall, dragged out toward the isolation ward
  c.wallDecal('blood', x0, 1.35, -16.4, 'e', 0.7, 0.8);
  c.decal('blood', -24.1, -16.3, 0.8, 0.6);
  c.decal('bloodDrag', -23.0, -17.6, 2.2, 0.35);
  c.decal('bloodDrag', -22.5, -19.6, 1.8, 0.1);
  c.decal('footprints', -22.0, -18.4, 1.4, 0.1);
  // west wall by the south door: hand rub, the extinguisher
  handGel(c, x0, 1.35, -13.15, 'e');
  P.extinguisher(c, x0, -13.3, 'e');
  // the clinical side, north to south: scale, exam table with lamp, light box, the screen
  columnScale(c, x1, -20.15, 'w');
  L.examTable(c, x1, -19.2, 'w');
  L.wallLightBox(c, x1, 1.65, -19.2, 'w', { w: 0.9, h: 0.5, films: 1 });
  L.surgicalLamp(c, -19.4, -20.05, h, { y: 1.95, arm: 0.55, yaw: -PI / 2 });
  foldingScreen(c, -20.62, -19.2, PI / 2, { fold: 0.45 });
  // the sink, the medicine cabinet (ajar), sharps, the crash cart
  L.sinkUnit(c, x1, -17.9, 'w', { kind: 'lab', w: 0.9 });
  L.medCabinet(c, x1, 1.5, -16.95, 'w', { w: 0.8, h: 0.9, ajar: true });
  L.sharpsBox(c, x1, 1.55, -16.3, 'w');
  L.crashCart(c, x1, -16.0, 'w', { open: true });
  // the nurses' station by the door, its board, the wheelchair parked at it
  L.nurseStation(c, x1, -14.35, 'w', 1.8, { depth: 1.45 });
  c.label('PATIENT BOARD', x1 - 0.01, 2.25, -14.35, 'w', 1.5, 0.5, {
    bg: '#f2f4f5', fg: '#1d3f8f', border: '#bfc5ca', font: 'bold 30px "Comic Sans MS", Arial', align: 'left',
    lines: ['BED 1  K. OSEI · obs 2-hrly', 'BED 2  SUBJ 0-17 · SEDATE IF AGITATED', 'BED 3  M. VARGA · d/c Thu', 'DR HALE ON CALL · EXT 5512'],
  });
  L.wheelchair(c, -20.45, -13.95, 0.9);
  L.lightSwitch(c, -19.35, z1, 'n');
  L.wallClock(c, -22.25, 2.88, z0, 's');
  L.wasteBin(c, -20.85, -17.3, { kind: 'bio' });
  roomTitle(c, 'INFIRMARY · TREATMENT', -22.25, 2.95, z1 - 0.01, 'n', 2.0);
  // dropped dressings and a chart by the station
  Fac.papers(c, -21.1, 0.003, -15.2, 0.7, 3);
  c.decal('stain', -20.4, -16.6, 0.5, 0.3);
}
