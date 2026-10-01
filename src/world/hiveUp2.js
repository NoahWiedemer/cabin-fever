// The Hive's level-5 support rooms (world/hive.js, floor y 3.45): the monitoring room over the atrium, the biobank,
// the records office and the upper archive. Props in the idiom of hiveProps.js / hiveTech.js (world-space geometry for
// the Kit, one mesh per material, baked light, a collider for whatever you'd bump into) and one dress function per room.
//
// c: hiveProps.js's build context (already moved up to the room's floor: build on y 0) plus X (EXTRA_MATS, baked), G
//    (EXTRA_GLOW, emissive), label(text, x, y, z, face, w, h, opts), decal(kind, x, z, size, rot), wallDecal(kind, x,
//    y, z, face, w, h), screen(x, y, z, yaw, w, h, on).
// Wall props take (x, z) = the middle of their back edge on the wall line and `face`, the side they open toward
// ('n' -z, 's' +z, 'w' -x, 'e' +x). Free-standing ones take their centre and a face or a yaw (radians, 0 = front
// toward +z). Things that stand on a surface take its height y as well. Nothing here is random but c.rnd().
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';
import { SIGN } from './lab.js';
import * as P from './hiveProps.js';
import * as L from './hiveLabs.js';
import * as Fac from './hiveFacility.js';
import * as TK from './hiveTech.js';
import * as DA from './hiveDressA.js';
import * as DD from './hiveDressD.js';

/** baked materials this module adds (c.X) */
export const EXTRA_MATS = {
  h_ultWhite: { color: 0xe7eaec, roughness: 0.45 }, // ultra-low freezers' enamel
  h_ultBlue: { color: 0x2c5a86, roughness: 0.5, metalness: 0.1 }, // their trim and control heads
  h_steel: { color: 0xa7aeb3, roughness: 0.34, metalness: 0.65 }, // brushed stainless
  h_alu: { color: 0xc3c8cc, roughness: 0.32, metalness: 0.55 }, // anodised extrusion, dewars
  h_chrome: { color: 0xd4d9dd, roughness: 0.16, metalness: 0.9 },
  h_brass: { color: 0xb3893c, roughness: 0.32, metalness: 0.85 },
  h_rubber: { color: 0x161718, roughness: 0.92 },
  h_charcoal: { color: 0x2a2d31, roughness: 0.55 },
  h_beige: { color: 0xcfc5aa, roughness: 0.55 }, // the old computer's casing
  h_console: { color: 0x56616c, roughness: 0.5, metalness: 0.15 }, // control-room console steel
  h_consoleTop: { color: 0x26292d, roughness: 0.45 },
  h_fabric: { color: 0x2d4560, roughness: 0.95 }, // operator chairs
  h_paper: { color: 0xf1eee4, roughness: 0.88 },
  h_kraft: { color: 0xa17f55, roughness: 0.9 },
  h_box: { color: 0xd9cfb6, roughness: 0.85 }, // archive boxes
  h_wet: { color: 0x76603f, roughness: 0.8 }, // soaked cardboard
  h_bBlue: { color: 0x284b86, roughness: 0.6 }, // binders
  h_bRed: { color: 0x8e2b25, roughness: 0.6 },
  h_bGreen: { color: 0x2f6845, roughness: 0.6 },
  h_bBlack: { color: 0x1d1f22, roughness: 0.55 },
  h_bYellow: { color: 0xc8a12a, roughness: 0.6 },
  h_shelf: { color: 0xcac6b9, roughness: 0.5, metalness: 0.3 }, // shelving enamel
  h_endPanel: { color: 0x4e6a5b, roughness: 0.45, metalness: 0.2 }, // compact shelving end panels
  h_oak: { color: 0x9b7149, roughness: 0.5 },
  h_drawer: { color: 0xb58b5b, roughness: 0.55 }, // the card-catalogue oak
  h_safe: { color: 0x2e3b33, roughness: 0.4, metalness: 0.45 }, // the document safe's green
  h_robot: { color: 0xe6e4de, roughness: 0.4 }, // the retrieval robot's covers
  h_robotOrange: { color: 0xdc6d1e, roughness: 0.42 },
  h_tarp: { color: 0x2f5c9a, roughness: 0.7 },
  h_plastic: { color: 0xdedcd3, roughness: 0.45 }, // pale casings
  h_felt: { color: 0x2c553a, roughness: 0.95 }, // desk pads
  h_olive: { color: 0x4a5543, roughness: 0.45, metalness: 0.2 }, // the typewriter
  h_key: { color: 0xe2dccb, roughness: 0.5 }, // keycaps
  h_crt: { color: 0x17201c, roughness: 0.12 }, // a dead tube's glass
  h_cork: { color: 0xb08758, roughness: 0.95 },
  h_sack: { color: 0xe6e7e1, roughness: 0.75 }, // shred sacks
  h_cryoBox: { color: 0x3f7fc0, roughness: 0.5 }, // cryo boxes (blue polycarbonate)
  h_cryoBoxR: { color: 0xc8403a, roughness: 0.5 },
  h_tube: { color: 0xf4f2ea, roughness: 0.3 }, // cryovials
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  h_feed: [0x7a9786, 0.6], // a CCTV picture's grey-green
  h_feedIR: [0x9aa6b0, 0.5], // a night camera's grey
  h_lcd: [0x8fe6ff, 1.35], // panel displays
  h_crt: [0x6dff8f, 1.25], // green phosphor
  h_amber: [0xffa63a, 1.7], // warning lamps
  h_red: [0xff2d1c, 2.0], // alarm lamps
  h_lamp: [0xffe0a6, 1.7], // reading lamps
  h_fiche: [0xf3eed2, 1.3], // the film reader's screen
  h_inv: [0x4fa8ff, 1.1], // the inventory UI's blue
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const YAW = P.FACE_YAW;
const RIGHT = { s: 'e', e: 'n', n: 'w', w: 's' }; // the +u side of a thing facing `face`
const LEFT = { s: 'w', e: 's', n: 'e', w: 'n' };
const BACK = { s: 'n', n: 's', e: 'w', w: 'e' };
const COOL = [0.93, 0.97, 1.0];
const WARM = [1.0, 0.84, 0.6];
const nearFace = (yaw) => ['s', 'e', 'n', 'w'][((Math.round(yaw / (PI / 2)) % 4) + 4) % 4];
const pick = (c, a) => a[Math.floor(c.rnd() * a.length)];
const jit = (c, s) => (c.rnd() - 0.5) * 2 * s;

// ---------------------------------------------------------------- shared geometry (built once, cloned by the Kit)
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
/** a cylinder standing on its base (y 0 .. h) */
const cylG = (r0, r1, h, seg = 12, open = false) => cached('c' + k3(r0, r1, h) + ':' + seg + open, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(0, h / 2, 0));
/** a centred cylinder */
const cylC = (r0, r1, h, seg = 12) => cached('cc' + k3(r0, r1, h) + ':' + seg, () => new THREE.CylinderGeometry(r1, r0, h, seg));
const sphG = (r, ws = 10, hs = 8) => cached('s' + k3(r) + ':' + ws + ':' + hs, () => new THREE.SphereGeometry(r, ws, hs));
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const planeG = (w, h) => cached('q' + k3(w, h), () => new THREE.PlaneGeometry(w, h));
/** a tube along local points (a cable, a hose, a coiled cord) */
const tubeG = (key, pts, r, seg = 16, rs = 5) => cached('u' + key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([a, b, d]) => V(a, b, d))), seg, r, rs));
/** the lab atlas' gauge face as a plane */
const gaugeG = (s) => cached('g' + k3(s), () => {
  const g = new THREE.PlaneGeometry(s, s);
  const [rx, ry, rw, rh] = SIGN.gauge;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (rx + uv.getX(i) * rw) / 1024, 1 - (ry + rh) / 1024 + (uv.getY(i) * rh) / 1024);
  return g;
});

// ---------------------------------------------------------------- the local frame
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = V(), _s = V(1, 1, 1);
const WFACE = { s: 'pz', n: 'nz', e: 'px', w: 'nx' };
/**
 * A prop's local frame (as hiveTech.js's): u across, y up, v out from its back toward its front. Built at (x, y, z)
 * turned by `face` (a face letter or a yaw); `tilt` [rx, rz] tips it (a thing knocked over: colliders by hand then).
 */
class Frame {
  constructor(c, x, z, face, y = 0, tilt = null) {
    this.c = c;
    this.yaw = typeof face === 'number' ? face : YAW[face];
    this.face = typeof face === 'number' ? nearFace(face) : face;
    // (how far it is turned off the nearest wall direction: labels and face-culled slabs need it square)
    this.skew = tilt ? 1 : Math.abs(Math.atan2(Math.sin(4 * this.yaw), Math.cos(4 * this.yaw))) / 4;
    _e.set(tilt?.[0] ?? 0, this.yaw, tilt?.[1] ?? 0, 'YXZ');
    this.m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(_e), V(1, 1, 1));
  }
  p(u, y, v) {
    return V(u, y, v).applyMatrix4(this.m);
  }
  /** any geometry at local (u, y, v), rotated [rx, ry, rz] (YXZ) and scaled */
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
  /**
   * Only some faces of a box between two corners (an untilted, cardinal frame): 'f' front, 'b' back, 'l' / 'r' the
   * sides, 't' top, 'd' bottom. Books, boxes and drawer fronts nobody sees the backs of: 2 triangles a face.
   */
  slab(mat, u0, y0, v0, u1, y1, v1, faces = 'ft') {
    if (this.skew > 1e-4) return this.span(mat, u0, y0, v0, u1, y1, v1); // (turned: a whole box)
    const a = this.p(u0, y0, v0), b = this.p(u1, y1, v1);
    const map = { f: WFACE[this.face], b: WFACE[BACK[this.face]], r: WFACE[RIGHT[this.face]], l: WFACE[LEFT[this.face]], t: 'py', d: 'ny' };
    return this.c.K.box(mat, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z), Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z), { faces: [...faces].map((k) => map[k]) });
  }
  /** a flat front-facing rectangle (2 triangles) from (u0, y0) to (u1, y1) at depth v: recessed fronts, LEDs, slots */
  quad(mat, u0, y0, u1, y1, v) {
    return this.add(mat, planeG(Math.abs(u1 - u0), Math.abs(y1 - y0)), (u0 + u1) / 2, (y0 + y1) / 2, v);
  }
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
  /** a round dial facing the front: the lab atlas' gauge in a dark bezel */
  gauge(u, y, v, s = 0.1) {
    this.add(this.c.M.dark, cylC(s * 0.56, s * 0.56, 0.025, 12), u, y, v + 0.0125, [PI / 2, 0, 0]);
    this.add(this.c.M.signs, gaugeG(s), u, y, v + 0.026);
  }
  /** text on the front plane at depth v (or a side: 'left' / 'right' / 'back' / 'up') */
  label(text, u, y, v, w, h, opts = {}, side = 'front') {
    if (side !== 'up' && this.skew > 0.06) return; // (c.label only faces the four walls: a skewed thing goes without)
    const f = side === 'front' ? this.face : side === 'right' ? RIGHT[this.face] : side === 'left' ? LEFT[this.face] : side === 'back' ? BACK[this.face] : side;
    const p = this.p(u, y, v);
    // (c.label pushes the plane 0.02 out along its face; pull it back so it sits on the surface)
    const o = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] }[f];
    if (f === 'up') return this.c.label(text, p.x, p.y, p.z, 'up', w, h, { ...opts, yaw: this.yaw });
    this.c.label(text, p.x - o[0] * 0.018, p.y, p.z - o[1] * 0.018, f, w, h, opts);
  }
  /** a monitor picture on the front plane (a random lab screen, or off) */
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
    const b = this.m.elements[13];
    this.c.col(x0, Math.max(0, b + y0), z0, x1, b + y1, z1, surf, flags);
  }
}

// ---------------------------------------------------------------- small shared bits
const NOTE = { bg: '#f4f1e6', fg: '#1d2b3a', border: '#f4f1e6', font: 'bold 34px Arial' };
const WARN = { bg: '#f2c618', fg: '#111111', border: '#111111', font: 'bold 40px Arial' };
const DANGER = { bg: '#c62a22', fg: '#ffffff', border: '#ffffff', font: 'bold 40px Arial' };
const PLATE = { bg: '#20262c', fg: '#dfe6ea', border: '#20262c', font: 'bold 36px Arial' };
const MANDATORY = { bg: '#1f5fa6', fg: '#ffffff', border: '#ffffff', font: 'bold 40px Arial' };
const SCREEN = { bg: '#06121c', fg: '#7fd8ff', border: '#06121c', font: 'bold 30px Courier New' };
/** a room title plate on the wall (a dark plate, the room's name, a coloured edge) */
function roomTitle(c, text, x, y, z, face, w = 1.8, col = '#3fa36a') {
  c.label(text, x, y, z, face, w, 0.15, { bg: '#1b2127', fg: '#e8edf0', border: col, font: 'bold 48px Arial' });
}
/** a printed wall sign of a few lines in one of the styles above, w × h centred at (x, y) on the wall line (x, z) */
function sign(c, lines, x, y, z, face, w, h, style = WARN) {
  c.label(lines.join(' · '), x, y, z, face, w, h, { ...style, lines });
}
/** loose sheets on the floor round (x, z) and a paper decal under them */
function floorPapers(c, x, z, n = 5, spread = 0.8, decal = true) {
  const { X, rnd } = c;
  for (let i = 0; i < n; i++) c.K.add(X.h_paper, planeG(0.21, 0.29), x + jit(c, spread), 0.002 + i * 0.0004, z + jit(c, spread), [-PI / 2, 0, rnd() * 3]);
  if (decal) c.decal('paper', x, z, spread * 1.6, rnd() * 3);
}
const plate = (c, x, y, z, face, kind = 'socket') => Fac.wallPlate(c, x, y, z, face, kind);

/**
 * Stock one shelf of a frame (its front toward +v): binders and archive boxes from u0 to u1 standing on y, their backs
 * at v0 and spines / fronts at v1, at most hMax tall. kind 'binders' | 'boxes' | 'mixed'; `wet`: the boxes soaked and
 * slumped; `gaps`: the share of the shelf left empty (taken out, never put back). Front and top faces only.
 */
function stock(c, f, u0, u1, y, v0, v1, hMax, { kind = 'mixed', wet = false, gaps = 0.12, tags = null } = {}) {
  const { X, rnd } = c;
  const binders = [X.h_bBlue, X.h_bBlue, X.h_bRed, X.h_bGreen, X.h_bBlack, X.h_bYellow];
  const dep = Math.abs(v1 - v0);
  let u = u0 + 0.01, n = 0;
  while (u < u1 - 0.06) {
    const r = rnd();
    if (r < gaps) {
      // a gap, sometimes with the last binder leaning into it
      const gw = 0.12 + rnd() * 0.25;
      if (kind !== 'boxes' && rnd() < 0.5 && u + gw < u1 - 0.05) f.add(pick(c, binders), rbox(0.06, Math.min(hMax, 0.31), dep * 0.9), u + 0.12, y + Math.min(hMax, 0.31) / 2 + 0.01, (v0 + v1) / 2, [0, 0, -0.35]);
      u += gw;
      continue;
    }
    if (kind === 'boxes' || (kind === 'mixed' && r > 0.62)) {
      const w = 0.32 + rnd() * 0.06, h = Math.min(hMax, 0.25 + rnd() * 0.03);
      if (u + w > u1) break;
      const m = wet ? X.h_wet : rnd() < 0.15 ? X.h_kraft : X.h_box;
      const slump = wet ? 0.04 + rnd() * 0.05 : 0;
      f.slab(m, u, y, v0, u + w - 0.01, y + h - slump, v1 - rnd() * 0.04, 'ftlr');
      f.quad(c.M.dark, u + w / 2 - 0.05, y + h - slump - 0.07, u + w / 2 + 0.05, y + h - slump - 0.04, v1 + 0.002); // the hand hole
      f.quad(X.h_paper, u + 0.05, y + 0.06, u + w - 0.06, y + 0.14, v1 + 0.002);
      if (tags && n % 4 === 0) f.label(tags[(n / 4) % tags.length], u + w / 2, y + 0.1, v1 + 0.003, w - 0.12, 0.07, NOTE);
      u += w;
    } else {
      // a run of lever-arch files of one colour, a printed spine label each
      // (one block for the run, a label and a ring pull per file: the spines read as separate files)
      const m = pick(c, binders), k = 3 + Math.floor(rnd() * 6), h = Math.min(hMax, 0.3 + rnd() * 0.02), w = 0.055 + rnd() * 0.02;
      const n2 = Math.max(1, Math.min(k, Math.floor((u1 - 0.02 - u) / w)));
      const vv = v1 - rnd() * 0.02;
      f.slab(m, u, y, v0 + 0.02, u + n2 * w - 0.003, y + h, vv, 'ftlr');
      for (let i = 0; i < n2; i++) {
        const ui = u + i * w;
        f.quad(X.h_paper, ui + 0.008, y + h * 0.62, ui + w - 0.012, y + h * 0.82, vv + 0.0015);
        f.quad(c.M.black, ui + w / 2 - 0.01, y + h * 0.3, ui + w / 2 + 0.006, y + h * 0.36, vv + 0.0015); // the ring pull
      }
      u += n2 * w;
    }
    n++;
  }
}

/** a sheet of paper lying on a surface at (x, y, z), turned yaw */
function sheet(c, x, y, z, yaw = 0, mat = null) {
  c.K.add(mat ?? c.X.h_paper, planeG(0.21, 0.297), x, y + 0.001, z, [-PI / 2, 0, yaw, 'YXZ']);
}
/** a cardboard archive box at (x, y, z) turned yaw (lid on), `wet` slumped; the label and the hand hole on its end */
function archiveBox(c, x, y, z, yaw = 0, { wet = false, lidOff = false, tilt = null } = {}) {
  const { X, M } = c;
  const f = new Frame(c, x, z, yaw, y, tilt);
  const m = wet ? X.h_wet : X.h_box;
  const h = wet ? 0.22 : 0.26;
  f.box(m, 0, h / 2, 0, 0.32, h, 0.4, wet ? 0.03 : 0);
  if (!lidOff) f.box(m, 0, h + 0.012, 0, 0.335, 0.03, 0.415);
  else f.span(X.h_paper, -0.13, h - 0.02, -0.17, 0.13, h - 0.01, 0.16);
  f.quad(M.dark, -0.05, h - 0.08, 0.05, h - 0.05, 0.201);
  f.quad(X.h_paper, -0.11, 0.06, 0.11, 0.15, 0.201);
}

// ---------------------------------------------------------------- the monitoring room
/** a flat-panel monitor standing on y at local (u, v) of frame f, its screen toward +v (tilted back a little) */
function monitor(c, f, u, y, v, { w = 0.56, h = 0.34, on = true, turn = 0 } = {}) {
  const { M, X } = c;
  f.box(X.h_charcoal, u, y + 0.006, v - 0.03, 0.22, 0.012, 0.16);
  f.box(X.h_charcoal, u, y + 0.1, v - 0.07, 0.05, 0.19, 0.025);
  f.box(M.black, u, y + 0.12 + h / 2, v - 0.04, w, h, 0.035, 0, [-0.06, turn, 0]);
  if (on === null) return;
  const s = f.p(u + Math.sin(turn) * 0.019, y + 0.12 + h / 2, v - 0.04 + Math.cos(turn) * 0.019);
  c.screen(s.x, s.y, s.z, f.yaw + turn, w - 0.035, h - 0.035, on);
}
/** a keyboard and mouse on y at local (u, v), keys toward +v */
function keyboard(c, f, u, y, v, { mouse = 0.3, beige = false } = {}) {
  const { M, X } = c;
  f.box(beige ? X.h_beige : M.black, u, y + 0.012, v, 0.44, 0.022, 0.15, 0, [0.06, 0, 0]);
  f.span(beige ? X.h_key : X.h_charcoal, u - 0.2, y + 0.022, v - 0.06, u + 0.2, y + 0.027, v + 0.055);
  if (mouse) f.box(beige ? X.h_beige : M.black, u + mouse, y + 0.015, v + 0.02, 0.06, 0.03, 0.1);
}

/**
 * The surveillance console over the rect, its operators on the `face` side and its back to the window: a steel cabinet
 * with equipment bays (vents, key locks; one door hanging open, its cables torn out) and knee wells, a dark top with a
 * padded armrest, the raised monitor turret along the back with `monitors` screens per station, a keyboard, the PTZ
 * joystick, the gooseneck paging mic, a desk phone; mugs, the log, binoculars. opts: stations, down (a station index
 * whose chair lies knocked over), on (share of screens lit), chairs.
 */
export function operatorConsole(c, [x0, z0, x1, z1], face, { stations = 2, monitors = 3, down = -1, on = 0.75, chairs = true } = {}) {
  const { M, U, X, G, rnd } = c;
  const alongX = face === 'n' || face === 's';
  const Ln = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const T = 0.74, bay = 0.42, ws = (Ln - bay * (stations + 1)) / stations;
  // plinth, the back panel the length of it, the turret
  f.span(M.black, -Ln / 2 + 0.03, 0, -D / 2 + 0.03, Ln / 2 - 0.03, 0.08, D / 2 - 0.1);
  f.span(X.h_console, -Ln / 2, 0.08, -D / 2, Ln / 2, T - 0.03, -D / 2 + 0.06);
  f.span(X.h_console, -Ln / 2, T, -D / 2, Ln / 2, T + 0.14, -D / 2 + 0.24, 0.015);
  f.span(X.h_charcoal, -Ln / 2 + 0.02, T + 0.14, -D / 2 + 0.02, Ln / 2 - 0.02, T + 0.15, -D / 2 + 0.06); // the cable trough's lid
  for (let i = 0; i < 8; i++) f.quad(M.black, -Ln / 2 + 0.2 + i * ((Ln - 0.4) / 7) - 0.05, T + 0.05, -Ln / 2 + 0.2 + i * ((Ln - 0.4) / 7) + 0.05, T + 0.09, -D / 2 + 0.2405);
  // the top, its padded armrest
  f.span(X.h_consoleTop, -Ln / 2, T - 0.03, -D / 2 + 0.24, Ln / 2, T, D / 2 - 0.04, 0.01);
  f.hcyl(X.h_charcoal, 0, T - 0.02, D / 2 - 0.045, 0.035, Ln, 8, 'u');
  for (let b = 0; b <= stations; b++) {
    // the equipment bays between the knee wells: a door with vents, a lock, a label
    const u = -Ln / 2 + bay / 2 + b * (bay + ws);
    f.span(X.h_console, u - bay / 2, 0.08, -D / 2 + 0.06, u + bay / 2, T - 0.03, D / 2 - 0.1);
    const open = b === Math.min(1, stations);
    if (open) {
      const hinge = f.p(u - bay / 2 + 0.01, 0, D / 2 - 0.08);
      const g = new Frame(c, hinge.x, hinge.z, f.yaw - 1.9);
      g.span(X.h_console, 0, 0.12, -0.01, bay - 0.02, T - 0.07, 0.01);
      f.span(M.dark, u - bay / 2 + 0.02, 0.1, D / 2 - 0.1, u + bay / 2 - 0.02, T - 0.05, D / 2 - 0.099);
      for (let k = 0; k < 3; k++) f.span(X.h_charcoal, u - 0.17, 0.2 + k * 0.14, -D / 2 + 0.1, u + 0.17, 0.27 + k * 0.14, D / 2 - 0.14); // the recorders inside
      for (let k = 0; k < 3; k++) f.quad(k === 1 ? U.ledA : U.ledG, u + 0.1, 0.25 + k * 0.14, u + 0.115, 0.26 + k * 0.14, D / 2 - 0.139);
      // the cables someone ripped out, hanging to the floor
      for (let k = 0; k < 4; k++) {
        const du = -0.12 + k * 0.08, dv = D / 2 - 0.13;
        f.add(k % 2 ? M.black : M.blue, tubeG('rip' + k, [[du, 0.5 - k * 0.04, dv], [du + 0.03, 0.3, dv + 0.12], [du + 0.08 * (k - 1.5), 0.02, dv + 0.3 + k * 0.05]], 0.006, 8, 4), u, 0, 0);
      }
    } else {
      for (let k = 0; k < 6; k++) f.quad(M.black, u - 0.12, 0.42 + k * 0.03, u + 0.12, 0.433 + k * 0.03, D / 2 - 0.099);
      f.add(X.h_chrome, cylC(0.012, 0.012, 0.01, 8), u + bay / 2 - 0.06, T - 0.12, D / 2 - 0.095, [PI / 2, 0, 0]);
      f.label(`BAY ${b + 1}`, u, T - 0.1, D / 2 - 0.1, 0.12, 0.04, PLATE);
    }
  }
  for (let st = 0; st < stations; st++) {
    const uc = -Ln / 2 + bay + ws / 2 + st * (bay + ws);
    // the knee well: its modesty panel, a foot rest
    f.span(X.h_charcoal, uc - ws / 2, 0.1, -D / 2 + 0.06, uc + ws / 2, 0.14, -D / 2 + 0.35, 0.01);
    // the screens on the turret, the middle one straight, the others toed in
    const mw = Math.min(0.56, (ws + bay * 0.8) / monitors - 0.03);
    for (let k = 0; k < monitors; k++) {
      const o = k - (monitors - 1) / 2;
      monitor(c, f, uc + o * (mw + 0.025), T + 0.15, -D / 2 + 0.17, { w: mw, h: mw * 0.6, on: rnd() < on, turn: -o * 0.22 });
    }
    keyboard(c, f, uc - 0.08, T, -D / 2 + 0.52, { mouse: 0.3 });
    // the PTZ joystick: its housing, the stick, the zoom rocker, an LCD
    const ju = uc + ws / 2 - 0.12;
    f.box(X.h_charcoal, ju, T + 0.03, -D / 2 + 0.5, 0.26, 0.06, 0.2, 0.012, [0.12, 0, 0]);
    f.cyl(M.black, ju + 0.05, T + 0.06, -D / 2 + 0.52, 0.012, 0.009, 0.1, 8);
    f.add(M.black, sphG(0.022, 8, 6), ju + 0.05, T + 0.17, -D / 2 + 0.52);
    f.box(G.h_lcd, ju - 0.06, T + 0.066, -D / 2 + 0.47, 0.09, 0.004, 0.035, 0, [0.12, 0, 0]);
    // the gooseneck paging mic on its base, its push-to-talk button
    const mu = uc - ws / 2 + 0.12;
    f.box(M.black, mu, T + 0.02, -D / 2 + 0.4, 0.12, 0.04, 0.14, 0.01);
    f.box(M.red, mu + 0.03, T + 0.045, -D / 2 + 0.44, 0.03, 0.01, 0.03, 0.004);
    f.add(X.h_chrome, tubeG('goose', [[0, 0, 0], [0, 0.15, 0.02], [0, 0.27, 0.1], [0, 0.3, 0.2]], 0.006, 10, 4), mu, T + 0.04, -D / 2 + 0.38);
    f.hcyl(M.black, mu, T + 0.34, -D / 2 + 0.6, 0.016, 0.07, 8, 'v');
    // the day's leftovers
    Fac.mug(c, ...xyz(f, uc + 0.28, T, -D / 2 + 0.62), null, rnd() * 6);
    if (st === 0) Fac.papers(c, ...xyz(f, uc - 0.35, T, -D / 2 + 0.68), f.yaw + 0.3, 4);
    if (chairs) {
      const cp = f.p(uc + jit(c, 0.15), 0, D / 2 + (st === down ? 0.55 : 0.32 + rnd() * 0.15));
      TK.opsChair(c, cp.x, 0, cp.z, f.yaw + PI + (st === down ? 0.5 : jit(c, 0.5)), { down: st === down, mat: X.h_fabric });
    }
    f.light(uc, T + 0.45, -D / 2 + 0.25, 0.42, 1.5, [0.62, 0.8, 1.0]);
  }
  f.col(-Ln / 2, -D / 2, Ln / 2, D / 2, T + 0.15, SURF.metal);
}
/** world (x, y, z) of a frame's local point, as an argument list */
const xyz = (f, u, y, v) => {
  const p = f.p(u, y, v);
  return [p.x, p.y, p.z];
};

/**
 * The CCTV video wall on the wall at (x, z) facing `face`, w wide: a black steel frame on wall rails holding cols ×
 * rows monitors from y0 up, each a camera picture (`feeds[i]`: [camera, place]; the grey-green day tint or the grey of
 * an IR camera, a dark floor, a doorway, a caption and the REC dot), a quad split, NO SIGNAL blue, dark or `smashed`
 * by a round; the header plate; under it the recorder credenza (sliding doors, one open on the DVR stack, the matrix
 * keyboard, the camera schedule binder). `figure`: a screen index showing someone standing in a corridor.
 */
export function videoWall(c, x, z, face, { w = 3.0, cols = 4, rows = 3, y0 = 1.0, feeds = [], dark = [], smashed = [], nosignal = [], quad = [], figure = -1, title = 'CCTV · LEVEL 5 / SUBLEVEL 4', credenza = true } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const gw = (w - 0.1) / cols, mw = gw - 0.04, mh = Math.min(mw * 0.6, 0.46), gh = mh + 0.05, H = rows * gh;
  // the frame: two wall rails, uprights between the columns
  for (const y of [y0 + 0.08, y0 + H - 0.08]) f.span(X.h_charcoal, -w / 2, y - 0.025, 0, w / 2, y + 0.025, 0.04);
  for (let i = 0; i <= cols; i++) f.span(M.black, -w / 2 + 0.05 + i * gw - 0.012, y0, 0.04, -w / 2 + 0.05 + i * gw + 0.012, y0 + H, 0.06);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const u = -w / 2 + 0.05 + gw * (i + 0.5), y = y0 + gh * (j + 0.5), v = 0.105;
      f.slab(M.black, u - mw / 2, y - mh / 2, 0.06, u + mw / 2, y + mh / 2, v, 'ftlrd');
      const sw = mw - 0.035, sh = mh - 0.035, vs = v + 0.001;
      if (dark.includes(k) || smashed.includes(k)) {
        f.quad(M.dark, u - sw / 2, y - sh / 2, u + sw / 2, y + sh / 2, vs);
        f.quad(U.ledR, u + mw / 2 - 0.04, y - mh / 2 + 0.006, u + mw / 2 - 0.028, y - mh / 2 + 0.014, vs + 0.0005);
        if (smashed.includes(k)) {
          const p = f.p(u + jit(c, sw * 0.25), y + jit(c, sh * 0.2), vs);
          c.wallDecal('bullet', p.x, p.y, p.z, f.face, 0.2, 0.2);
          c.wallDecal('crack', p.x, p.y, p.z, f.face, sw * 0.9, sh * 0.9);
        }
        continue;
      }
      f.quad(U.ledG, u + mw / 2 - 0.04, y - mh / 2 + 0.006, u + mw / 2 - 0.028, y - mh / 2 + 0.014, vs + 0.0005);
      if (nosignal.includes(k)) {
        f.label('NO SIGNAL', u, y, vs, sw, sh, { bg: '#1d3fb5', fg: '#ffffff', border: '#1d3fb5', font: 'bold 40px Arial' });
        continue;
      }
      if (quad.includes(k)) {
        // a quad split: four small pictures
        for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const qu = u + (a * sw) / 4, qy = y + (b * sh) / 4;
          f.quad(rnd() < 0.5 ? G.h_feed : G.h_feedIR, qu - sw / 4 + 0.004, qy - sh / 4 + 0.004, qu + sw / 4 - 0.004, qy + sh / 4 - 0.004, vs);
          f.quad(M.dark, qu - sw / 4 + 0.004, qy - sh / 4 + 0.004, qu + sw / 4 - 0.004, qy - sh / 4 + sh * 0.18, vs + 0.0004);
        }
        continue;
      }
      const [cam, place] = feeds[k] ?? [`CAM ${String(10 + k).padStart(2, '0')}`, 'CORRIDOR'];
      const yb = y - sh / 2;
      f.quad(k % 3 === 2 ? G.h_feedIR : G.h_feed, u - sw / 2, yb, u + sw / 2, yb + sh, vs);
      f.quad(M.dark, u - sw / 2, yb, u + sw / 2, yb + sh * (0.22 + rnd() * 0.16), vs + 0.0004);
      const du = jit(c, sw * 0.3);
      f.quad(M.black, u + du - 0.035, yb + sh * 0.3, u + du + 0.035, yb + sh * 0.68, vs + 0.0004);
      if (k === figure) {
        // somebody standing in the corridor, facing the camera
        f.quad(M.black, u - du * 0.5 - 0.012, yb + sh * 0.24, u - du * 0.5 + 0.012, yb + sh * 0.5, vs + 0.0008);
        f.quad(M.black, u - du * 0.5 - 0.007, yb + sh * 0.5, u - du * 0.5 + 0.007, yb + sh * 0.56, vs + 0.0008);
      }
      f.label(`${cam} · ${place}`, u - sw / 2 + 0.14, yb + sh - 0.025, vs + 0.0006, 0.26, 0.035, { bg: '#26332d', fg: '#c9e6d2', border: '#26332d', font: 'bold 26px Courier New' });
      f.quad(U.ledR, u + sw / 2 - 0.04, yb + sh - 0.035, u + sw / 2 - 0.022, yb + sh - 0.017, vs + 0.0006);
    }
  }
  f.label(title, 0, y0 + H + 0.1, 0.004, Math.min(w * 0.6, 1.6), 0.1, { ...PLATE, border: '#2fb8c8' });
  f.light(0, y0 + H / 2, 0.5, 0.55, 2.2, [0.66, 0.82, 0.74]);
  if (!credenza) return;
  // the recorder credenza: carcass, top, sliding doors (the right one pushed open on the DVR stack)
  const d = 0.46, T = 0.72;
  f.span(M.black, -w / 2 + 0.04, 0, 0.03, w / 2 - 0.04, 0.06, d - 0.04);
  f.span(X.h_console, -w / 2, 0.06, 0, w / 2, T - 0.03, d - 0.03);
  f.span(X.h_consoleTop, -w / 2 - 0.01, T - 0.03, 0, w / 2 + 0.01, T, d, 0.008);
  const nd = Math.max(2, Math.round(w / 0.75)), dw = w / nd;
  for (let i = 0; i < nd; i++) {
    const u = -w / 2 + dw * (i + 0.5);
    if (i === nd - 1) {
      f.span(M.dark, u - dw / 2 + 0.02, 0.08, d - 0.031, u + dw / 2 - 0.02, T - 0.05, d - 0.03);
      for (let k = 0; k < 4; k++) {
        f.span(X.h_charcoal, u - dw / 2 + 0.05, 0.12 + k * 0.13, 0.04, u + dw / 2 - 0.05, 0.2 + k * 0.13, d - 0.05);
        f.quad(G.h_lcd, u - 0.1, 0.15 + k * 0.13, u - 0.02, 0.17 + k * 0.13, d - 0.049);
        f.quad(k === 2 ? U.ledR : U.ledG, u + 0.1, 0.155 + k * 0.13, u + 0.112, 0.165 + k * 0.13, d - 0.049);
      }
      continue;
    }
    f.span(X.h_console, u - dw / 2 + 0.005, 0.08, d - 0.03, u + dw / 2 - 0.005, T - 0.05, d - 0.016);
    f.span(X.h_chrome, u + dw / 2 - 0.06, 0.4, d - 0.016, u + dw / 2 - 0.04, 0.55, d - 0.006);
    // (the open bay's door, slid across in front of its neighbour)
    if (i === nd - 2) f.span(X.h_console, u - dw / 2 + 0.08, 0.08, d - 0.014, u + dw / 2 - 0.02, T - 0.05, d - 0.001);
  }
  // on top: the matrix keyboard, the camera schedule, a mug, a dead radio in its charger
  f.box(X.h_charcoal, -w / 4, T + 0.03, d / 2 + 0.05, 0.42, 0.06, 0.2, 0.01, [0.1, 0, 0]);
  for (let i = 0; i < 12; i++) f.box(X.h_key, -w / 4 - 0.15 + (i % 6) * 0.06, T + 0.065, d / 2 + 0.02 + Math.floor(i / 6) * 0.05, 0.04, 0.01, 0.035);
  f.box(G.h_lcd, -w / 4 + 0.12, T + 0.066, d / 2 + 0.1, 0.12, 0.004, 0.04);
  f.box(X.h_bBlue, w / 4, T + 0.02, d / 2, 0.3, 0.04, 0.24, 0.005, [0, 0.2, 0]);
  f.label('CAMERA SCHEDULE', w / 4, T + 0.042, d / 2, 0.2, 0.05, NOTE, 'up');
  Fac.mug(c, ...xyz(f, 0.05, T, d / 2 + 0.08), null, 1.2);
  f.col(-w / 2, 0, w / 2, d, T, SURF.metal);
}

/**
 * The fire / intruder alarm panel on the wall at (x, y = its centre, z) facing `face`: a grey steel box with a window
 * door, two columns of zone lamps with their names (`zones`, the `active` ones lit red), the LCD reading the first
 * active zone, the silence and reset keys, the key switch, a sounder with a red strobe over it.
 */
export function alarmPanel(c, x, y, z, face, { zones = [], active = [], title = 'FIRE ALARM · LEVEL 5' } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const rows = Math.ceil(zones.length / 2), h = 0.32 + rows * 0.05, w = 0.5;
  f.box(X.h_plastic, 0, y, 0.055, w, h, 0.11, 0.012);
  f.span(X.h_charcoal, -w / 2 + 0.03, y + h / 2 - 0.13, 0.11, w / 2 - 0.03, y + h / 2 - 0.03, 0.112);
  const msg = active.length ? `FIRE · ${zones[active[0]] ?? 'ZONE ' + active[0]}` : 'SYSTEM NORMAL';
  f.label(msg, 0, y + h / 2 - 0.08, 0.113, w - 0.1, 0.07, { bg: '#062a14', fg: active.length ? '#ff6b4a' : '#7dffb0', border: '#062a14', font: 'bold 30px Courier New' });
  zones.forEach((name, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const u = -w / 2 + 0.04 + col * (w / 2), yy = y + h / 2 - 0.17 - row * 0.05;
    f.quad(active.includes(i) ? G.h_red : M.dark, u, yy - 0.01, u + 0.02, yy + 0.01, 0.1105);
    f.label(name, u + 0.115, yy, 0.111, 0.18, 0.035, { bg: '#e9e7df', fg: '#1d2b3a', border: '#e9e7df', font: 'bold 26px Arial', align: 'left' });
  });
  for (let k = 0; k < 3; k++) f.box(k === 0 ? M.yellow : k === 1 ? M.red : M.green, -0.12 + k * 0.08, y - h / 2 + 0.05, 0.112, 0.05, 0.03, 0.012, 0.004);
  f.add(X.h_chrome, cylC(0.014, 0.014, 0.012, 8), w / 2 - 0.07, y - h / 2 + 0.05, 0.115, [PI / 2, 0, 0]);
  f.label(title, 0, y + h / 2 + 0.05, 0.003, w, 0.06, DANGER);
  // the sounder and its strobe
  f.add(M.red, cylC(0.08, 0.08, 0.08, 14), 0, y + h / 2 + 0.2, 0.04, [PI / 2, 0, 0]);
  f.add(active.length ? G.h_red : U.red, sphG(0.035, 10, 6), 0, y + h / 2 + 0.2, 0.09);
  if (active.length) f.light(0, y + h / 2 + 0.2, 0.25, 0.35, 1.3, [1.0, 0.25, 0.15]);
}

/**
 * The emergency telephone on the wall at (x, y = the box's centre, z) facing `face`: a yellow cabinet with a hood, the
 * red handset hanging off the hook on its coiled cord when `off` (someone was cut off mid-call), the number plate, an
 * amber beacon on top.
 */
export function emergencyPhone(c, x, y, z, face, { off = true, number = 'EMERGENCY · 5555', lit = true } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.yellow, 0, y, 0.07, 0.32, 0.44, 0.14, 0.02);
  f.span(M.yellow, -0.17, y + 0.22, 0.0, 0.17, y + 0.245, 0.2); // the hood
  f.span(X.h_charcoal, -0.13, y - 0.18, 0.14, 0.13, y + 0.2, 0.142);
  f.box(X.h_steel, -0.06, y + 0.02, 0.15, 0.07, 0.03, 0.02); // the hook
  for (let i = 0; i < 12; i++) f.slab(X.h_steel, 0.017 + (i % 3) * 0.035, y + 0.057 - Math.floor(i / 3) * 0.035, 0.142, 0.043 + (i % 3) * 0.035, y + 0.083 - Math.floor(i / 3) * 0.035, 0.152, 'ftd');
  const hu = -0.06, hv = 0.17;
  if (off) {
    // the handset dangling below the box on its cord, turning a little
    const hy = y - 0.62;
    f.box(M.red, hu + 0.02, hy, hv + 0.03, 0.055, 0.24, 0.05, 0.02, [0.12, 0.4, 0.08]);
    const helix = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30, a = t * PI * 2 * 8;
      helix.push([hu - 0.01 + Math.cos(a) * 0.012 + t * 0.03, y - 0.16 - t * 0.34, hv - 0.02 + Math.sin(a) * 0.012 + t * 0.05]);
    }
    f.add(M.black, tubeG('ephone', helix, 0.0035, 40, 3), 0, 0, 0);
  } else f.box(M.red, hu, y + 0.0, hv - 0.01, 0.06, 0.24, 0.05, 0.02);
  f.label(number, 0, y + 0.45, 0.003, 0.34, 0.07, DANGER);
  f.add(X.h_charcoal, cylC(0.05, 0.05, 0.04, 12), 0, y + 0.27, 0.12);
  f.add(lit ? G.h_amber : M.amber, sphG(0.045, 12, 6), 0, y + 0.31, 0.12);
  if (lit) f.light(0, y + 0.35, 0.35, 0.3, 1.2, [1.0, 0.6, 0.2]);
}

/** a clipboard on a hook at (x, y, z) on the wall facing `face`: the board, its clip and a printed sheet (`lines`) */
export function clipboard(c, x, y, z, face, { lines = ['SHIFT LOG'], w = 0.23, h = 0.32, tilt = 0 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.h_kraft, 0, y, 0.008, w, h, 0.006, 0, [0, 0, tilt]);
  f.box(X.h_chrome, 0, y + h / 2 - 0.02, 0.016, 0.09, 0.03, 0.01, 0.004);
  f.label(lines.join(' / '), 0, y - 0.02, 0.012, w - 0.03, h - 0.07, { bg: '#f7f5ec', fg: '#222222', border: '#f7f5ec', font: 'bold 26px Courier New', lines, align: 'left' });
  f.cyl(M.dark, 0, y + h / 2 + 0.01, 0.0, 0.005, 0.005, 0.012, 6);
}

/** a rubber cable protector on the floor from (ax, az) to (bx, bz) (axis aligned): black ramps, the yellow lid, the cables at its ends */
export function cableRamp(c, ax, az, bx, bz, { w = 0.22 } = {}) {
  const { K, M, X } = c;
  const alongX = Math.abs(bx - ax) >= Math.abs(bz - az);
  const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), z0 = Math.min(az, bz), z1 = Math.max(az, bz);
  if (alongX) {
    K.box(X.h_rubber, x0, 0, az - w / 2, x1, 0.02, az + w / 2, { faces: ['py', 'pz', 'nz', 'px', 'nx'] });
    K.box(M.yellow, x0, 0.02, az - w / 4, x1, 0.032, az + w / 4, { faces: ['py', 'pz', 'nz'] });
  } else {
    K.box(X.h_rubber, ax - w / 2, 0, z0, ax + w / 2, 0.02, z1, { faces: ['py', 'px', 'nx', 'pz', 'nz'] });
    K.box(M.yellow, ax - w / 4, 0.02, z0, ax + w / 4, 0.032, z1, { faces: ['py', 'px', 'nx'] });
  }
  for (const [x, z, s] of [[ax, az, -1], [bx, bz, 1]]) {
    for (let k = 0; k < 3; k++) {
      const o = (k - 1) * 0.04, d = s * 0.25;
      const p = alongX ? [[0, 0.012, o], [d * 0.5, 0.01, o * 1.4], [d, 0.01, o * 2.2]] : [[o, 0.012, 0], [o * 1.4, 0.01, d * 0.5], [o * 2.2, 0.01, d]];
      K.add(k === 1 ? M.blue : M.black, tubeG(`ramp${alongX}${s}${k}`, p, 0.008, 6, 4), x, 0, z);
    }
  }
}

/**
 * The monitoring room (level 5, over the atrium): the surveillance console across the window on the gallery (two
 * stations, a chair knocked over), the CCTV wall on the west wall with its recorder credenza and a chair turned to it,
 * the NVR racks and a UPS in the north-west, the status board, the emergency phone off its hook, the alarm panel in
 * the north-east; cups, the log, papers on the floor. Whoever sat here watched it come up the gallery.
 */
export function dressMonitor(c, s, ctx) {
  const { K, M, X } = c;
  const { x0, z0, x1, z1 } = s;
  // the console across the window (its back to it, the operators facing the atrium)
  operatorConsole(c, [x1 - 1.05, -7.2, x1 - 0.25, -3.5], 'w', { stations: 2, monitors: 3, down: 1, on: 0.8 });
  K.add(X.h_charcoal, rbox(0.11, 0.06, 0.16, 0.02), x1 - 0.42, 0.79, -5.4, [0, 0.4, 0]); // binoculars on the turret
  for (const s2 of [-1, 1]) K.add(M.black, cylC(0.03, 0.03, 0.12, 10), x1 - 0.42 + s2 * 0.02, 0.8, -5.4 + s2 * 0.03, [PI / 2, 0.4, 0, 'YXZ']);
  // the headset dropped by the knocked-over chair, a spilled cup, the shift log on the floor
  K.add(M.black, torG(0.08, 0.008, 4, 12, PI), x1 - 2.5, 0.01, -3.75, [-PI / 2, 0, 0.6, 'YXZ']);
  K.add(X.h_paper, cylG(0.04, 0.045, 0.1, 10, true), x1 - 1.6, 0.04, -4.7, [0, 0, PI / 2]);
  c.decal('stain', x1 - 1.45, -4.75, 0.5, 0.8);
  floorPapers(c, x1 - 2.1, -5.6, 5, 0.5);
  // the CCTV wall on the west wall, a chair turned to it
  const feeds = [['CAM 12', 'ATRIUM N'], ['CAM 13', 'ATRIUM S'], ['CAM 21', 'SPECIMEN HALL'], ['CAM 07', 'LAB 4-A'], ['CAM 03', 'CRYO'], ['CAM 15', 'SERVER ROOM'], ['CAM 30', 'BIOBANK'], ['CAM 31', 'RECORDS'], ['CAM 09', 'CAFETERIA'], ['CAM 18', 'MORGUE'], ['CAM 40', 'UPPER E CORR.'], ['CAM 26', 'ISOLATION WARD']];
  videoWall(c, x0, -5.4, 'e', { w: 3.0, cols: 4, rows: 3, y0: 1.05, feeds, dark: [2], smashed: [9], nosignal: [5], quad: [7], figure: 10 });
  TK.opsChair(c, x0 + 1.05, 0, -4.9, -PI / 2 + 0.4, { mat: X.h_fabric });
  TK.radioCharger(c, x0 + 0.23, 0.72, -4.15, PI / 2, { n: 6, taken: [0, 1, 2, 4] }); // (four radios signed out)
  DD.deskFan(c, x1 - 0.87, 0.89, -7.0, -PI / 2 - 0.5);
  // the trunking from the racks along the north wall and down to the console's end
  K.box(M.white, x0 + 1.86, 2.3, z0, x1 - 0.38, 2.4, z0 + 0.06);
  K.box(M.white, x1 - 0.5, 0.92, z0, x1 - 0.38, 2.3, z0 + 0.06);
  // the NVR racks on the north wall, the UPS in the corner beside them, a cable ramp to the console
  TK.rackRow(c, [x0 + 0.66, z0, x0 + 1.86, z0 + 1.0], 's', { name: 'NVR · CCTV', first: 1, open: [1], dead: 0.3 });
  DA.ups(c, x0, z0 + 0.45, 'e', { on: true });
  cableRamp(c, x0 + 1.9, z0 + 0.6, x1 - 1.1, z0 + 0.6);
  // the north wall: the emergency phone (off the hook), the status board
  emergencyPhone(c, x0 + 2.15, 1.45, z0, 's', { off: true });
  TK.statusBoard(c, x1 - 1.1, 1.75, z0, 's', {
    w: 1.1, title: 'SITE STATUS · 14:52',
    rows: [['CONTAINMENT SL4', 'BREACH', 'bad'], ['SPECIMEN HALL', 'NO CONTACT', 'bad'], ['ATRIUM DOORS', 'LOCKED', 'warn'], ['BLAST DOOR N', 'SEALED', 'ok'], ['ELEVATOR 2', 'FAULT', 'bad'], ['MAINS POWER', '61 %', 'warn'], ['AIR HANDLING', 'RECIRC', 'warn']],
  });
  plate(c, x1 - 0.4, 0.3, z0, 's');
  plate(c, x0 + 2.6, 0.3, z0, 's', 'data');
  // the east wall north of the window: the alarm panel; over the window the clock
  alarmPanel(c, x1, 1.55, -7.6, 'w', { zones: ['5-01 MONITORING', '5-02 BIOBANK', '5-03 RECORDS', '5-04 ARCHIVE', '5-05 LAB 5-C', '5-06 LAB 5-D', '4-11 SPECIMEN', '4-02 CRYO'], active: [1, 6] });
  L.wallClock(c, x1, 2.7, -5.25, 'w');
  P.extinguisher(c, x1, -3.2, 'w');
  c.label('CO₂ · ELECTRICAL FIRES', x1 + 0.01, 1.25, -3.2, 'w', 0.26, 0.06, DANGER);
  // the west wall by the door: first aid, a socket; the south wall: switch, exit sign, the rota
  L.firstAidBox(c, x0, 1.5, -3.35, 'e');
  plate(c, x0, 0.3, -3.75, 'e');
  L.lightSwitch(c, -13.75, z1, 'n');
  DD.exitSign(c, -12.75, 2.55, z1, 'n', { arrow: '' });
  clipboard(c, x1 - 1.0, 1.5, z1, 'n', { lines: ['SHIFT ROTA · WK 41', 'EARLY  KOWALSKI / ADEYEMI', 'LATE   REYES / BRANDT', 'NIGHT  — VACANT —'], w: 0.28, h: 0.36 });
  sign(c, ['NO FOOD OR DRINK AT THE CONSOLE'], x1 - 1.0, 2.05, z1, 'n', 0.5, 0.08, MANDATORY);
  roomTitle(c, 'MONITORING · SURVEILLANCE', x0 + 1.5, 2.95, z0, 's', 1.8, '#2fb8c8');
  // a smear on the west wall by the door, drag marks out of it: somebody pulled out of here
  c.wallDecal('bloodSmear', x0, 1.1, -3.05, 'e', 0.35, 0.7);
  c.decal('bloodDrag', -13.2, -3.4, 0.9, 0.3);
  c.decal('footprints', -12.6, -4.6, 1.2, 0.2);
  Fac.trashCan(c, x0 + 1.6, -5.9, { tipped: true });
}

// ---------------------------------------------------------------- the biobank
/**
 * An ultra-low (−80 °C) upright freezer against the wall at (x, z) facing `face`: white enamel on castors, a blue
 * control band (the temperature readout, keypad, alarm LED), a full-height lever handle with its lock, frost at the
 * door seal, the kick grille; `chart`: a round chart recorder on the door; `open`: the door swung wide on the inner
 * compartment doors (two open on racks of blue cryo boxes) and the frosted back; `note`: a sticker on the door.
 */
export function ultFreezer(c, x, z, face, { w = 0.84, h = 1.98, d = 0.88, temp = '−80', alarm = false, open = false, chart = false, note = null } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const dd = d - 0.08; // the cabinet's front (the door in front of it)
  f.span(X.h_ultWhite, -w / 2, 0.1, 0, w / 2, h, dd, 0.012);
  f.span(M.dark, -w / 2 + 0.03, 0.02, 0.05, w / 2 - 0.03, 0.1, dd - 0.02);
  for (let i = 0; i < 5; i++) f.quad(M.black, -w / 2 + 0.08, 0.035 + i * 0.012, w / 2 - 0.08, 0.041 + i * 0.012, dd - 0.019);
  for (const su of [-1, 1]) f.cyl(M.black, su * (w / 2 - 0.08), 0, dd - 0.1, 0.03, 0.03, 0.06, 8);
  // the control band over the door: readout, keypad, LEDs
  f.span(X.h_ultBlue, -w / 2, h - 0.2, dd, w / 2, h - 0.02, dd + 0.02);
  f.label(`${temp} °C`, -w / 4, h - 0.11, dd + 0.021, 0.2, 0.08, { bg: '#04121a', fg: alarm ? '#ff6b4a' : '#7fe3ff', border: '#04121a', font: 'bold 60px monospace' });
  for (let i = 0; i < 6; i++) f.quad(X.h_key, w / 8 + (i % 3) * 0.04, h - 0.09 - Math.floor(i / 3) * 0.04, w / 8 + (i % 3) * 0.04 + 0.028, h - 0.065 - Math.floor(i / 3) * 0.04, dd + 0.021);
  f.quad(U.ledG, w / 2 - 0.08, h - 0.07, w / 2 - 0.06, h - 0.05, dd + 0.021);
  f.quad(alarm ? G.h_red : M.dark, w / 2 - 0.08, h - 0.13, w / 2 - 0.06, h - 0.11, dd + 0.021);
  if (!open) {
    f.span(X.h_ultWhite, -w / 2 + 0.008, 0.12, dd, w / 2 - 0.008, h - 0.21, d, 0.012);
    f.span(M.frost, -w / 2 + 0.01, h - 0.225, dd - 0.004, w / 2 - 0.01, h - 0.208, dd + 0.004);
    f.span(M.frost, w / 2 - 0.02, 0.14, dd - 0.004, w / 2 - 0.006, h - 0.23, dd + 0.006);
    f.span(X.h_chrome, w / 2 - 0.09, 0.85, d, w / 2 - 0.05, 1.45, d + 0.045, 0.01);
    f.add(X.h_chrome, cylC(0.014, 0.014, 0.02, 8), w / 2 - 0.07, 1.55, d + 0.01, [PI / 2, 0, 0]);
    if (chart) {
      f.add(X.h_ultBlue, cylC(0.13, 0.13, 0.03, 16), -0.12, 1.45, d + 0.015, [PI / 2, 0, 0]);
      f.add(M.signs, gaugeG(0.2), -0.12, 1.45, d + 0.031);
    }
    if (note) {
      const lines = Array.isArray(note) ? note : [note];
      f.label(lines.join(' · '), -0.1, 1.05, d + 0.001, 0.4, 0.24, { ...NOTE, lines });
    }
    f.col(-w / 2, 0, w / 2, d + 0.05, h, SURF.metal);
    return;
  }
  // open: the frosted inside, five compartments behind their own small doors, two of them open on the racks
  f.span(M.frost, -w / 2 + 0.05, 0.16, 0.06, w / 2 - 0.05, h - 0.24, 0.08);
  const ch = (h - 0.42) / 5;
  for (let k = 0; k < 5; k++) {
    const y = 0.18 + k * ch;
    f.span(X.h_steel, -w / 2 + 0.05, y - 0.012, 0.06, w / 2 - 0.05, y, dd - 0.02);
    if (k === 1 || k === 3) {
      for (let r = 0; r < 4; r++) f.span(r % 2 ? X.h_cryoBox : X.h_cryoBoxR, -w / 2 + 0.07 + r * ((w - 0.14) / 4), y + 0.005, 0.12, -w / 2 + 0.06 + (r + 1) * ((w - 0.14) / 4), y + ch * 0.8, dd - 0.06);
      f.span(M.frost, -w / 2 + 0.06, y + ch * 0.8, 0.1, w / 2 - 0.06, y + ch * 0.83, dd - 0.06);
      continue;
    }
    f.span(M.white, -w / 2 + 0.05, y + 0.005, dd - 0.04, w / 2 - 0.05, y + ch - 0.008, dd - 0.02);
    f.span(X.h_steel, -0.06, y + ch / 2 - 0.01, dd - 0.02, 0.06, y + ch / 2 + 0.01, dd - 0.005);
  }
  // the outer door swung ~100° on its left hinge, its gasket frosted, the lever on its outside
  const hp = f.p(-w / 2 + 0.01, 0, d);
  const g = new Frame(c, hp.x, hp.z, f.yaw - 1.75);
  g.span(X.h_ultWhite, 0, 0.12, -0.08, w - 0.02, h - 0.21, 0, 0.012);
  g.span(M.frost, 0.04, 0.16, -0.085, w - 0.06, h - 0.25, -0.08);
  g.span(X.h_chrome, w - 0.1, 0.85, 0, w - 0.06, 1.45, 0.045, 0.01);
  g.col(0, -0.08, w - 0.02, 0.05, h - 0.21, SURF.metal);
  f.col(-w / 2, 0, w / 2, dd, h, SURF.metal);
  c.decal('puddle', ...xz(f, 0, dd + 0.35), 0.7, c.rnd() * 3); // (it has been defrosting onto the floor)
}
/** world (x, z) of a frame's local floor point, as an argument list */
const xz = (f, u, v) => {
  const p = f.p(u, 0, v);
  return [p.x, p.z];
};

/**
 * The automated sample store over the rect, worked from the `face` side: a long −80 °C store bed (white insulated
 * body, blue band, kick grille) with two rows of access hatches on its steel deck, a portal gantry over it (anodised
 * posts, a rail along each side, the drag chain, the orange bridge at `t` of its travel, the carriage, the Z mast and
 * the gripper lifting a frosted rack out of an open hatch), a perspex safety fence on the open side with its gate
 * hanging open between the light-curtain posts (the robot halted: the amber stack light), the E-stop, its signs.
 */
export function retrievalGantry(c, [x0, z0, x1, z1], face, { t = 0.42, ceil = 3.2, name = 'SAMPLE STORE 2 · −80 °C · 21 600 POSITIONS', status = 'GATE OPEN · ROBOT HALTED' } = {}) {
  const { M, U, X, G } = c;
  const alongX = face === 'n' || face === 's';
  const Ln = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const vb0 = -D / 2 + 0.05, vb1 = D / 2 - 0.45, vf = D / 2 - 0.04, Hg = Math.min(2.55, ceil - 0.6), T = 0.95;
  // the store bed
  f.span(M.dark, -Ln / 2 + 0.08, 0, vb0 + 0.03, Ln / 2 - 0.08, 0.1, vb1 - 0.03);
  f.span(X.h_ultWhite, -Ln / 2 + 0.05, 0.1, vb0, Ln / 2 - 0.05, T - 0.03, vb1, 0.01);
  f.span(X.h_steel, -Ln / 2 + 0.05, T - 0.03, vb0, Ln / 2 - 0.05, T, vb1);
  f.span(X.h_ultBlue, -Ln / 2 + 0.05, T - 0.16, vb1, Ln / 2 - 0.05, T - 0.08, vb1 + 0.008);
  for (let i = 0; i < 4; i++) f.quad(M.black, -Ln / 2 + 0.2, 0.13 + i * 0.03, Ln / 2 - 0.2, 0.145 + i * 0.03, vb1 + 0.002);
  // the hatches: two rows, the one under the gripper open
  const nU = Math.max(2, Math.round((Ln - 0.3) / 0.56)), hw = (Ln - 0.3) / nU, vr = [vb0 + (vb1 - vb0) * 0.27, vb0 + (vb1 - vb0) * 0.73];
  const ut = -Ln / 2 + 0.25 + t * (Ln - 0.5);
  const iu = Math.min(nU - 1, Math.max(0, Math.floor((ut + Ln / 2 - 0.15) / hw)));
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < 2; j++) {
      const u = -Ln / 2 + 0.15 + hw * (i + 0.5), v = vr[j], a = hw / 2 - 0.04, b = (vb1 - vb0) * 0.2;
      f.slab(M.frost, u - a - 0.01, T, v - b - 0.01, u + a + 0.01, T + 0.002, v + b + 0.01, 't');
      if (i === iu && j === 1) {
        f.slab(M.black, u - a + 0.02, T + 0.003, v - b + 0.02, u + a - 0.02, T + 0.004, v + b - 0.02, 't');
        f.box(X.h_ultWhite, u, T + 0.013 + Math.sin(1.25) * b, v - b + Math.cos(1.25) * b, a * 2, 0.025, b * 2, 0, [-1.25, 0, 0]);
        continue;
      }
      f.slab(X.h_ultWhite, u - a, T + 0.002, v - b, u + a, T + 0.027, v + b, 'tflrb');
      f.slab(X.h_charcoal, u - 0.06, T + 0.027, v + b - 0.05, u + 0.06, T + 0.04, v + b - 0.02, 'tf');
    }
  }
  // the portal: posts, rails, the drag chain, the bridge, carriage, mast and gripper with its rack
  for (const u of [-Ln / 2 + 0.04, Ln / 2 - 0.04]) {
    for (const v of [vb0 + 0.04, vf]) {
      f.span(X.h_alu, u - 0.04, 0, v - 0.04, u + 0.04, Hg, v + 0.04);
      f.slab(M.dark, u - 0.07, 0, v - 0.07, u + 0.07, 0.012, v + 0.07, 'tflrb');
    }
  }
  for (const v of [vb0 + 0.04, vf]) f.span(X.h_alu, -Ln / 2, Hg - 0.12, v - 0.045, Ln / 2, Hg, v + 0.045);
  f.span(M.black, -Ln / 2 + 0.1, Hg, vb0 + 0.01, ut, Hg + 0.05, vb0 + 0.07);
  f.add(M.black, torG(0.05, 0.025, 4, 8, PI), ut, Hg + 0.075, vb0 + 0.04, [0, 0, -PI / 2]);
  f.span(M.black, ut - 0.5, Hg + 0.1, vb0 + 0.01, ut, Hg + 0.15, vb0 + 0.07);
  f.span(X.h_robotOrange, ut - 0.07, Hg - 0.03, vb0 - 0.0, ut + 0.07, Hg + 0.09, vf + 0.04);
  const vc = vr[1], yg = 1.55;
  f.box(X.h_robot, ut, Hg - 0.1, vc, 0.28, 0.22, 0.3, 0.015);
  f.span(X.h_alu, ut - 0.045, yg, vc - 0.045, ut + 0.045, Hg - 0.2, vc + 0.045);
  f.box(X.h_robotOrange, ut, yg - 0.06, vc, 0.18, 0.13, 0.18, 0.015);
  for (const s of [-1, 1]) f.span(X.h_steel, ut + s * 0.075 - 0.01, yg - 0.32, vc - 0.04, ut + s * 0.075 + 0.01, yg - 0.12, vc + 0.04);
  f.span(X.h_steel, ut - 0.06, T - 0.2, vc - 0.06, ut + 0.06, yg - 0.14, vc + 0.06);
  for (let k = 0; k < 4; k++) f.quad(k % 2 ? X.h_cryoBox : X.h_cryoBoxR, ut - 0.05, T + 0.02 + k * 0.12, ut + 0.05, T + 0.11 + k * 0.12, vc + 0.061);
  f.span(M.frost, ut - 0.063, T - 0.05, vc - 0.063, ut + 0.063, T + 0.12, vc + 0.063);
  f.add(M.black, tubeG('gantryCable', [[0, 0, 0], [0.12, -0.2, 0.02], [0.06, -0.5, 0.03], [0.02, -0.75, 0]], 0.012, 10, 5), ut + 0.06, Hg - 0.2, vc + 0.04);
  // the fence: posts and rails on the open side, perspex panels, the gate swung open at the -u end
  const np = Math.max(2, Math.round(Ln / 1.25)), pw = Ln / np;
  for (let i = 0; i <= np; i++) f.span(X.h_alu, -Ln / 2 + i * pw - 0.02, 0, vf + 0.04, -Ln / 2 + i * pw + 0.02, 2.05, vf + 0.08);
  for (const y of [0.1, 1.0, 2.03]) f.span(X.h_alu, -Ln / 2 + pw, y - 0.02, vf + 0.045, Ln / 2, y + 0.02, vf + 0.075);
  f.span(U.glass, -Ln / 2 + pw, 0.12, vf + 0.056, Ln / 2, 2.0, vf + 0.064);
  const hp = f.p(-Ln / 2 + pw - 0.03, 0, vf + 0.08);
  const g = new Frame(c, hp.x, hp.z, f.yaw + PI + 1.25);
  g.span(X.h_alu, 0, 0.1, -0.015, pw - 0.06, 0.14, 0.015);
  g.span(X.h_alu, 0, 1.96, -0.015, pw - 0.06, 2.0, 0.015);
  g.span(X.h_alu, pw - 0.1, 0.1, -0.015, pw - 0.06, 2.0, 0.015);
  g.span(U.glass, 0.02, 0.14, -0.004, pw - 0.1, 1.96, 0.004);
  g.col(0, -0.02, pw - 0.06, 0.02, 2.0, SURF.glass);
  for (const u of [-Ln / 2 + 0.06, -Ln / 2 + pw - 0.08]) {
    f.span(M.yellow, u - 0.025, 0, vf + 0.09, u + 0.025, 1.75, vf + 0.14);
    f.quad(M.black, u - 0.012, 0.2, u + 0.012, 1.6, vf + 0.141);
  }
  // the stack light, the E-stop, the signs
  const us = Ln / 2 - 0.04;
  f.cyl(M.dark, us, 2.05, vf + 0.06, 0.012, 0.012, 0.1, 6);
  [[M.green, 0], [G.h_amber, 1], [U.red, 2]].forEach(([m, k]) => f.cyl(m, us, 2.15 + k * 0.07, vf + 0.06, 0.035, 0.035, 0.065, 10));
  f.light(us, 2.25, vf + 0.3, 0.45, 1.8, [1.0, 0.62, 0.22]);
  f.span(M.yellow, us - 0.06, 1.12, vf + 0.08, us + 0.06, 1.28, vf + 0.15, 0.01);
  f.add(M.red, cylC(0.035, 0.03, 0.04, 12), us, 1.2, vf + 0.17, [PI / 2, 0, 0]);
  f.label(name, 0, 2.2, vf + 0.06, Math.min(2.4, Ln * 0.5), 0.1, { ...PLATE, border: '#dc6d1e' });
  f.label(status, Ln / 4, 1.55, vf + 0.065, 0.5, 0.1, WARN);
  f.label('ROBOT MAY MOVE WITHOUT WARNING', -Ln / 4 + 0.4, 1.55, vf + 0.065, 0.6, 0.1, WARN);
  // colliders: the bed, the fence (perspex) with the gate's gap
  f.col(-Ln / 2 + 0.05, vb0, Ln / 2 - 0.05, vb1, T, SURF.metal);
  f.col(-Ln / 2 + pw, vf + 0.03, Ln / 2, vf + 0.09, 2.05, SURF.glass);
  f.col(-Ln / 2, vb1, -Ln / 2 + pw, vf + 0.09, 1.2, SURF.metal); // (the gate's end: the light curtain, nobody walks into the robot)
}

/**
 * The store's inventory terminal standing at (x, z) facing `face`: a weighted base plate, a steel column, the screen
 * in its pale housing (the LIMS page: `lines`), a shelf with the barcode scanner in its holster and a label printer.
 */
export function inventoryKiosk(c, x, z, face, { lines = ['BIOBANK LIMS · STORE 2', 'RETRIEVAL QUEUE  3', 'RACK 14-C  96 / 96', '!! F-06 TEMP EXCURSION'] } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.h_charcoal, -0.25, 0, -0.2, 0.25, 0.03, 0.2, 0.01);
  f.span(X.h_steel, -0.05, 0.03, -0.08, 0.05, 1.1, 0.02);
  f.box(X.h_plastic, 0, 1.32, 0.0, 0.58, 0.4, 0.07, 0.012);
  f.quad(G.h_inv, -0.27, 1.14, 0.27, 1.5, 0.036);
  f.label(lines[0], 0, 1.44, 0.037, 0.5, 0.25, { ...SCREEN, lines, align: 'left' });
  f.span(X.h_plastic, -0.24, 0.95, -0.02, 0.24, 0.97, 0.2);
  f.box(M.black, -0.13, 1.0, 0.1, 0.06, 0.06, 0.11, 0.01);
  f.box(M.black, -0.13, 1.06, 0.07, 0.05, 0.12, 0.05, 0.01, [0.4, 0, 0]);
  f.quad(M.red, -0.15, 1.025, -0.11, 1.035, 0.156);
  f.box(X.h_plastic, 0.1, 1.04, 0.07, 0.17, 0.14, 0.18, 0.012);
  f.span(X.h_paper, 0.05, 1.0, 0.16, 0.15, 1.05, 0.17);
  f.add(M.black, tubeG('scanCord', [[-0.13, 1.0, 0.04], [-0.12, 0.9, 0.02], [-0.06, 0.95, -0.03], [0, 1.0, -0.06]], 0.005, 8, 4), 0, 0, 0);
  f.light(0, 1.3, 0.35, 0.3, 1.2, [0.45, 0.7, 1.0]);
  f.col(-0.25, -0.2, 0.25, 0.2, 1.52, SURF.metal);
}

/** a tube of cryovials: a white vial with its coloured cap, lying (`down`) or standing at (x, y, z) */
function vial(c, x, y, z, cap, down = false, yaw = 0) {
  const { X } = c;
  if (down) {
    c.K.add(X.h_tube, cylC(0.006, 0.006, 0.045, 6), x, y + 0.006, z, [PI / 2, yaw, 0, 'YXZ']);
    c.K.add(cap, cylC(0.0065, 0.0065, 0.012, 6), x + Math.sin(yaw) * 0.027, y + 0.006, z + Math.cos(yaw) * 0.027, [PI / 2, yaw, 0, 'YXZ']);
    return;
  }
  c.K.add(X.h_tube, cylG(0.006, 0.006, 0.045, 6), x, y, z);
  c.K.add(cap, cylG(0.0065, 0.0065, 0.012, 6), x, y + 0.045, z);
}
/** a cryo box (13 × 13 cm) on y at (x, z) turned yaw: blue / red polycarbonate, lid on or off (a grid of caps) */
function cryoBox(c, x, y, z, yaw = 0, { open = false, red = false, tilt = null } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, y, tilt);
  const m = red ? X.h_cryoBoxR : X.h_cryoBox;
  f.box(m, 0, 0.026, 0, 0.133, 0.052, 0.133);
  if (!open) {
    f.box(m, 0, 0.056, 0, 0.136, 0.012, 0.136);
    if (!tilt) f.label('K7', 0, 0.063, 0, 0.08, 0.04, NOTE, 'up');
    return;
  }
  f.span(X.h_tube, -0.06, 0.052, -0.06, 0.06, 0.054, 0.06);
  for (let i = 0; i < 3; i++) f.span(i % 2 ? M.red : M.yellow, -0.055, 0.0545, -0.05 + i * 0.04, 0.055, 0.056, -0.035 + i * 0.04);
}

/**
 * The sample sorting bench against the wall at (x, z) facing `face`, `len` long: a stainless top and splashback on a
 * steel frame with an undershelf (a dry-ice shipper, a sack of gloves), on top a frosted cold plate with cryo boxes
 * (one open on its vials), a decapper, the barcode reader, a bench dewar, a label printer, the LIMS screen and its
 * keyboard, blue cryo gauntlets dropped beside the work; a stool pushed back.
 */
export function sortingBench(c, x, z, face, { len = 3.0, d = 0.75 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.9;
  for (const u of [-len / 2 + 0.05, -len / 2 + len / 3, len / 2 - len / 3, len / 2 - 0.05]) for (const v of [0.06, d - 0.06]) f.span(X.h_steel, u - 0.02, 0, v - 0.02, u + 0.02, T - 0.04, v + 0.02);
  f.span(X.h_steel, -len / 2 + 0.03, 0.2, 0.04, len / 2 - 0.03, 0.225, d - 0.04);
  f.span(X.h_steel, -len / 2, T - 0.04, 0, len / 2, T, d, 0.008);
  f.span(X.h_steel, -len / 2, T, 0, len / 2, T + 0.18, 0.015);
  // the undershelf: a polystyrene dry-ice shipper, a carton of gloves
  f.box(M.white, -len / 4, 0.4, d / 2, 0.55, 0.35, 0.42, 0.01);
  f.label('DRY ICE · UN 1845', -len / 4, 0.42, d / 2 + 0.211, 0.3, 0.07, WARN);
  f.box(M.card, len / 4, 0.32, d / 2, 0.35, 0.19, 0.25);
  // the cold plate and its boxes
  const cu = -len / 2 + 0.55;
  f.span(M.dark, cu - 0.35, T, 0.15, cu + 0.35, T + 0.04, 0.6, 0.008);
  f.span(M.frost, cu - 0.33, T + 0.04, 0.17, cu + 0.33, T + 0.045, 0.58);
  for (let i = 0; i < 4; i++) cryoBox(c, ...xyz(f, cu - 0.22 + (i % 2) * 0.17, T + 0.045, 0.27 + Math.floor(i / 2) * 0.2), f.yaw + jit(c, 0.1), { open: i === 1, red: i === 3 });
  // the decapper, the barcode reader, a bench dewar, the label printer
  const du = cu + 0.6;
  f.box(X.h_plastic, du, T + 0.09, 0.3, 0.22, 0.18, 0.26, 0.015);
  f.cyl(X.h_steel, du, T + 0.18, 0.36, 0.05, 0.05, 0.06, 12);
  f.box(M.black, du + 0.28, T + 0.035, 0.32, 0.12, 0.07, 0.16, 0.01);
  f.quad(M.red, du + 0.24, T + 0.05, du + 0.32, T + 0.06, 0.401);
  f.cyl(X.h_alu, du + 0.52, T, 0.3, 0.1, 0.1, 0.28, 14);
  f.cyl(M.dark, du + 0.52, T + 0.28, 0.3, 0.07, 0.07, 0.04, 12);
  f.box(X.h_plastic, du + 0.85, T + 0.07, 0.25, 0.2, 0.14, 0.22, 0.012);
  f.span(X.h_paper, du + 0.78, T + 0.1, 0.36, du + 0.92, T + 0.101, 0.48);
  // the LIMS screen on its arm, the keyboard, a sheet of box maps
  const mu = len / 2 - 0.5;
  monitor(c, f, mu, T, 0.2, { w: 0.5, h: 0.3, on: true });
  keyboard(c, f, mu, T, 0.5, { mouse: 0.27 });
  sheet(c, ...xyz(f, mu - 0.42, T, 0.5), f.yaw + 0.2);
  sheet(c, ...xyz(f, mu - 0.36, T + 0.002, 0.46), f.yaw - 0.15);
  // blue cryo gauntlets dropped beside the cold plate
  for (const [u, a] of [[cu + 0.38, 0.4], [cu + 0.45, -0.3]]) f.box(M.blue, u, T + 0.025, 0.62, 0.11, 0.05, 0.3, 0.02, [0, a, 0]);
  L.labStool(c, ...xz(f, -0.2 + jit(c, 0.3), d + 0.75), { yaw: rnd() * 6 });
  f.light(mu, T + 0.4, 0.5, 0.3, 1.2, [0.6, 0.8, 1.0]);
  f.col(-len / 2, 0, len / 2, d, T, SURF.metal);
}

/**
 * A mobile LN₂ supply dewar at (x, z) turned yaw: a squat stainless vessel on a castor dolly, the guard ring and its
 * handles, the head with gauges, the vent and fill valves, the withdrawal hose curling down to a frosted end, the
 * hazard band.
 */
export function ln2Dewar(c, x, z, { yaw = 0, r = 0.27, h = 1.0, hose = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  f.cyl(M.dark, 0, 0.04, 0, r + 0.04, r + 0.04, 0.04, 14);
  for (let k = 0; k < 4; k++) f.cyl(M.black, Math.cos(k * PI / 2 + 0.78) * (r - 0.02), 0, Math.sin(k * PI / 2 + 0.78) * (r - 0.02), 0.03, 0.03, 0.04, 6);
  f.cyl(X.h_steel, 0, 0.08, 0, r, r, h - 0.2, 16);
  f.cyl(X.h_steel, 0, h - 0.12, 0, r, r * 0.55, 0.1, 16);
  f.add(X.h_alu, torG(r * 0.75, 0.014, 5, 16), 0, h + 0.08, 0, [PI / 2, 0, 0]);
  for (let k = 0; k < 3; k++) f.rod(X.h_alu, [Math.cos(k * 2.09) * r * 0.75, h + 0.08, Math.sin(k * 2.09) * r * 0.75], [Math.cos(k * 2.09) * r * 0.55, h - 0.03, Math.sin(k * 2.09) * r * 0.55], 0.01, 5);
  f.cyl(X.h_brass, 0, h - 0.02, 0, 0.04, 0.04, 0.08, 8);
  f.cyl(X.h_brass, 0.1, h - 0.06, 0.06, 0.008, 0.008, 0.07, 6);
  f.gauge(0.1, h + 0.04, 0.06, 0.07);
  f.cyl(M.green, -0.08, h + 0.02, 0.0, 0.025, 0.025, 0.03, 8);
  f.span(M.yellow, -r * 0.7, h * 0.55, r - 0.02, r * 0.7, h * 0.55 + 0.12, r + 0.005);
  f.label('LIQUID NITROGEN · ASPHYXIANT', 0, h * 0.55 + 0.06, r + 0.006, r * 1.3, 0.08, WARN);
  if (hose) {
    f.add(X.h_steel, tubeG('ln2hose', [[0.05, h + 0.05, 0.02], [0.2, h + 0.1, 0.12], [r + 0.15, h - 0.3, 0.2], [r + 0.2, 0.25, 0.25], [r + 0.3, 0.03, 0.4]], 0.016, 14, 6), 0, 0, 0);
    f.add(M.frost, sphG(0.04, 8, 6), r + 0.3, 0.04, 0.4);
  }
  f.col(-r - 0.04, -r - 0.04, r + 0.04, r + 0.04, h + 0.1, SURF.metal);
}

/**
 * A sample tray dropped on the floor at (x, z), turned yaw: the steel tray on its edge, its cryo boxes tumbled (one
 * burst open, its vials scattered and rolling), frost and a thawed stain spreading under them.
 */
export function droppedTray(c, x, z, yaw = 0) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  f.box(X.h_steel, 0, 0.045, 0, 0.5, 0.02, 0.36, 0, [0.04, 0, 0.1]);
  f.span(X.h_steel, -0.25, 0.02, -0.19, 0.25, 0.05, -0.17);
  cryoBox(c, ...xyz(f, 0.38, 0.03, 0.12), yaw + 0.7, { tilt: [0, 0.4] });
  cryoBox(c, ...xyz(f, -0.32, 0, 0.3), yaw - 0.4, { red: true });
  cryoBox(c, ...xyz(f, 0.12, 0.02, 0.0), yaw + 0.2, { open: true });
  const caps = [M.red, M.yellow, M.blue, M.green, M.white];
  for (let i = 0; i < 16; i++) {
    const p = f.p(jit(c, 0.6), 0, 0.15 + rnd() * 0.75);
    vial(c, p.x, 0, p.z, pick(c, caps), true, rnd() * 6);
  }
  for (let i = 0; i < 4; i++) {
    const p = f.p(jit(c, 0.4), 0, 0.3 + rnd() * 0.4);
    c.K.add(U.glass, cylC(0.006, 0.006, 0.02, 6), p.x, 0.006, p.z, [PI / 2, rnd() * 6, 0, 'YXZ']); // (broken ones)
  }
  DA.icePatch(c, ...xz(f, 0.05, 0.3), 1.0, yaw);
  c.decal('stain', ...xz(f, 0.1, 0.45), 0.9, rnd() * 3);
}

/**
 * A two-tier stainless sample trolley centred at (x, z) turned yaw: tube frame, castors, a push handle; on top a
 * polystyrene dry-ice shipper with its lid off and cryo boxes, a clipboard; on the lower tier a rack and a sack.
 */
export function sampleCart(c, x, z, yaw = 0, { w = 0.85, d = 0.52 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    f.span(X.h_steel, su * (w / 2 - 0.03) - 0.012, 0.1, sv * (d / 2 - 0.03) - 0.012, su * (w / 2 - 0.03) + 0.012, 0.9, sv * (d / 2 - 0.03) + 0.012);
    f.cyl(M.black, su * (w / 2 - 0.05), 0, sv * (d / 2 - 0.05), 0.045, 0.045, 0.06, 8);
    f.span(M.dark, su * (w / 2 - 0.05) - 0.01, 0.06, sv * (d / 2 - 0.05) - 0.01, su * (w / 2 - 0.05) + 0.01, 0.1, sv * (d / 2 - 0.05) + 0.01);
  }
  for (const y of [0.25, 0.86]) {
    f.span(X.h_steel, -w / 2, y, -d / 2, w / 2, y + 0.025, d / 2);
    for (const sv of [-1, 1]) f.span(X.h_steel, -w / 2, y + 0.025, sv * d / 2 - 0.01, w / 2, y + 0.05, sv * d / 2 + 0.01);
  }
  f.hcyl(X.h_steel, w / 2 + 0.06, 0.95, 0, 0.014, d - 0.06, 8, 'v');
  for (const sv of [-1, 1]) f.rod(X.h_steel, [w / 2 - 0.03, 0.88, sv * (d / 2 - 0.06)], [w / 2 + 0.06, 0.95, sv * (d / 2 - 0.06)], 0.012, 6);
  // the shipper, its lid off, the boxes on the dry ice
  f.span(M.white, -w / 2 + 0.05, 0.885, -0.2, 0.15, 1.18, 0.2, 0.012);
  f.span(M.frost, -w / 2 + 0.09, 1.17, -0.16, 0.11, 1.181, 0.16);
  f.box(M.white, 0.28, 0.9, 0.0, 0.3, 0.04, 0.42, 0, [0, 0.3, 0.12]);
  f.label('DRY ICE · UN 1845 · BIOLOGICAL SUBSTANCE CAT. B', -0.12, 1.03, 0.201, 0.35, 0.12, { ...WARN, lines: ['DRY ICE · UN 1845', 'UN 3373 BIOLOGICAL B'] });
  cryoBox(c, ...xyz(f, -0.2, 1.181, -0.05), yaw + 0.1);
  cryoBox(c, ...xyz(f, 0.0, 1.181, 0.06), yaw - 0.2, { red: true });
  f.box(X.h_kraft, 0.25, 0.9, 0.12, 0.23, 0.012, 0.32, 0, [0, 0.4, 0]);
  f.box(M.white, 0.15, 0.35, 0.0, 0.35, 0.18, 0.3);
  f.col(-w / 2, -d / 2, w / 2 + 0.08, d / 2, 1.18, SURF.metal);
}

/**
 * The biobank (level 5): seven −80 freezers down the west wall (F-04 standing open and thawing, F-03 alarming), the
 * automated sample store with its gantry robot along the east wall (halted, gate open) and its inventory terminal,
 * LN₂ supply dewars in the north-east and south-east, the dewar rack, the sorting bench and its freezer map on the
 * south wall, a chest freezer, the PPE board; a sample trolley in the aisle, a tray dropped by the open freezer and
 * footprints in the frost out to the door.
 */
export function dressBiobank(c, s, ctx) {
  const { K, M } = c;
  const { x0, z0, x1, z1 } = s;
  // the freezer row on the west wall
  const F = [
    { note: ['F-01 · TISSUE', 'PATIENTS 0-01 – 0-24'], chart: true },
    { note: ['F-02 · SERUM', 'K-7 COHORT A'] },
    { note: ['F-03 · CSF', 'DO NOT OPEN · CALL x2240'], temp: '−41', alarm: true },
    { note: ['F-04 · PLASMA', 'K-7 COHORT B'] },
    { note: ['F-05 · K-7 ISOLATES', 'BSL-3 · LOG EVERY ACCESS'], chart: true },
    { open: true, temp: '−12', alarm: true },
    { note: ['F-07 · DONOR LINES', 'FULL'] },
  ];
  F.forEach((o, i) => {
    const z = z0 + 1.34 + i * 0.88;
    ultFreezer(c, x0, z, 'e', o);
    c.label(`F-0${i + 1}`, x0, 2.18, z, 'e', 0.24, 0.1, PLATE);
  });
  DA.icePatch(c, x0 + 1.5, z0 + 5.6, 0.9, 0.4);
  K.box(M.white, x0, 2.4, z0 + 0.9, x0 + 0.06, 2.5, z0 + 7.2); // the trunking over the freezers, their plugs dropping to it
  for (let i = 0; i < 7; i++) K.box(M.black, x0, 1.98, z0 + 1.32 + i * 0.88, x0 + 0.03, 2.4, z0 + 1.35 + i * 0.88);
  // the store along the east wall, its terminal at the north end, a trolley in the aisle
  retrievalGantry(c, [x1 - 1.9, z0 + 1.9, x1, z0 + 7.4], 'w', { t: 0.42 });
  inventoryKiosk(c, x1 - 1.35, z0 + 1.2, 'w');
  sampleCart(c, x1 - 2.05, z0 + 8.45, -PI / 2);
  droppedTray(c, x0 + 1.95, z0 + 4.6, 0.5);
  c.decal('footprints', x0 + 2.2, z0 + 3.3, 1.2, PI + 0.2);
  c.decal('footprints', x0 + 2.35, z0 + 2.1, 1.2, PI + 0.3);
  c.decal('footprints', x0 + 2.45, z0 + 1.1, 1.0, PI);
  // LN₂: the supply dewar in the north-east corner under the O₂ monitor, two more in the south-east, the rack
  ln2Dewar(c, x1 - 0.45, z0 + 0.6, { yaw: -PI / 2 });
  DA.o2Monitor(c, x1 - 0.5, 1.6, z0, 's', { level: '19.2' });
  ln2Dewar(c, x1 - 0.42, z0 + 8.05, { yaw: PI, hose: false, r: 0.3, h: 1.1 });
  ln2Dewar(c, x1 - 0.4, z0 + 8.9, { yaw: PI, hose: false, r: 0.24, h: 0.85 });
  L.dewarRack(c, x0, z0 + 8.6, 'e', { len: 1.8, n: 4 });
  L.hazardPlacard(c, x1, 1.7, z0 + 9.05, 'w', 'cryo', { w: 0.45 });
  // the south wall: the sorting bench, its freezer map; the chest freezer and the PPE board in the corner
  sortingBench(c, x0 + 1.6, z1, 'n', { len: 3.0 });
  L.whiteboardFormula(c, x0 + 1.6, z1, 'n', {
    w: 1.7, y: 1.95, h: 0.8, title: 'FREEZER MAP · ROOM 5-02',
    lines: ['F1 tissue · F2 serum · F3 CSF', 'F6 K-7 SERUM SET B (!!)', 'F5 isolates — BSL-3 log', 'STORE 2: racks 1–36 by robot only'],
    note: 'F6 alarm 03:12 — move set B to F7??',
  });
  DA.chestFreezer(c, x1 - 0.85, z1, 'n', { note: ['DRY ICE', 'KEEP SHUT'] });
  DA.cryoPPEBoard(c, x1 - 0.85, z1, 'n', { w: 0.95, empty: 1 });
  plate(c, x0 + 2.75, 1.2, z1, 'n');
  plate(c, x1, 0.3, z0 + 9.6, 'w');
  // the north wall: title, placard, switch; the clock, extinguisher, a camera
  roomTitle(c, 'BIOBANK · −80 °C STORE', -25.75, 2.75, z0, 's', 1.9, '#2f7ad0');
  L.hazardPlacard(c, x0 + 0.55, 1.75, z0, 's', 'bio', { w: 0.36 });
  L.lightSwitch(c, -24.75, z0, 's');
  L.wallClock(c, x1, 2.75, z0 + 1.2, 'w');
  P.extinguisher(c, x0, z0 + 0.75, 'e');
  L.cctvCam(c, x0, 2.75, z1 - 0.3, 'e', -0.6);
  sign(c, ['COLD GLOVES & FACE SHIELD', 'BEYOND THIS POINT'], x0 + 0.01, 2.35, z0 + 4.0, 'e', 0.7, 0.14, MANDATORY);
}

// ---------------------------------------------------------------- the records office
/**
 * Open steel shelving against the wall at (x, z) facing `face`, w long: angle uprights with cross-bracing at the ends,
 * `levels` shelves with year tickets, stocked with lever-arch files and archive boxes (kind 'binders' | 'boxes' |
 * 'mixed'); `wet`: the bottom shelves soaked (slumped boxes, one fallen out onto a puddle); `tarp`: a blue sheet thrown
 * over the top and hanging down the front of one end.
 */
export function binderShelf(c, x, z, face, { w = 2.3, d = 0.4, h = 2.25, levels = 6, kind = 'binders', wet = 0, gaps = 0.12, tags = null, tarp = false, year = 1994 } = {}) {
  const { X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const nb = Math.max(1, Math.round(w / 1.0));
  for (let b = 0; b <= nb; b++) {
    const u = -w / 2 + (b * w) / nb + (b === 0 ? 0.02 : b === nb ? -0.02 : 0);
    for (const v of [0.03, d - 0.02]) f.span(X.h_shelf, u - 0.016, 0, v - 0.016, u + 0.016, h, v + 0.016);
  }
  for (const u of [-w / 2 + 0.02, w / 2 - 0.02]) {
    f.rod(X.h_shelf, [u, 0.15, 0.03], [u, h * 0.55, d - 0.02], 0.006, 4);
    f.rod(X.h_shelf, [u, h * 0.55, 0.03], [u, h - 0.1, d - 0.02], 0.006, 4);
  }
  const gap = (h - 0.12) / levels;
  for (let i = 0; i <= levels; i++) {
    const y = 0.08 + i * gap;
    f.slab(X.h_shelf, -w / 2, y - 0.025, 0.01, w / 2, y, d, 'ftd');
    if (i === levels) continue;
    for (let b = 0; b < nb; b++) f.quad(X.h_paper, -w / 2 + ((b + 0.5) * w) / nb - 0.05, y - 0.022, -w / 2 + ((b + 0.5) * w) / nb + 0.05, y - 0.004, d + 0.001);
    const k = i < wet ? 'boxes' : kind;
    stock(c, f, -w / 2 + 0.03, w / 2 - 0.03, y, 0.03, d - 0.01, gap - 0.04, { kind: k, wet: i < wet, gaps, tags });
  }
  if (tags) f.label(`${year} – ${year + 3}`, 0, h - 0.06, d + 0.002, 0.3, 0.08, PLATE);
  if (wet) {
    const p = f.p(jit(c, w / 4), 0, d + 0.35);
    archiveBox(c, p.x, 0.05, p.z, f.yaw + 0.5 + rnd(), { wet: true, tilt: [0.1, 0.15] });
    c.decal('puddle', p.x, p.z, 1.2, rnd() * 3);
  }
  if (tarp) {
    f.span(X.h_tarp, -w / 2 - 0.02, h, -0.01, w / 2 + 0.02, h + 0.012, d + 0.03);
    f.box(X.h_tarp, -w / 4, h - 0.45, d + 0.04, w / 2 + 0.04, 0.9, 0.012, 0, [0.05, 0, 0.03]);
  }
  f.col(-w / 2, 0, w / 2, d, h, SURF.cardboard);
}

/** an electric typewriter on a surface at (x, y, z), its keys toward yaw: olive body, keys, platen with a sheet in it */
export function typewriter(c, x, y, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw, y);
  f.box(X.h_olive, 0, 0.055, -0.03, 0.46, 0.11, 0.3, 0.02);
  f.box(X.h_olive, 0, 0.035, 0.14, 0.42, 0.06, 0.14, 0.015, [0.25, 0, 0]);
  for (let r = 0; r < 4; r++) f.slab(X.h_key, -0.17 + r * 0.01, 0.07 + r * 0.012, 0.19 - r * 0.03, 0.17 + r * 0.01, 0.078 + r * 0.012, 0.21 - r * 0.03, 'tf');
  f.slab(X.h_key, -0.1, 0.06, 0.215, 0.1, 0.067, 0.228, 'tf'); // the space bar
  f.hcyl(M.black, 0, 0.13, -0.1, 0.03, 0.5, 10, 'u');
  for (const s of [-1, 1]) f.cyl(X.h_charcoal, s * 0.26, 0.11, -0.1, 0.025, 0.025, 0.04, 8);
  f.box(X.h_paper, 0, 0.24, -0.13, 0.21, 0.2, 0.003, 0, [-0.25, 0, 0]);
  f.span(X.h_chrome, -0.32, 0.15, -0.11, -0.25, 0.16, -0.1);
  f.label('NOX · ELECTRIC 12', 0.1, 0.07, 0.05, 0.14, 0.03, PLATE, 'up');
}

/**
 * A typewriter-era computer on a surface at (x, y, z) facing yaw: the beige desktop case (floppy slots, the turbo
 * LED), the deep CRT on it with its green-phosphor text (`lines`, or dark), the beige keyboard and mouse in front.
 */
export function crtComputer(c, x, y, z, yaw = 0, { on = true, lines = ['RECORDS INDEX v2.1', 'SEARCH: K-7*', '> 1 412 FILES FOUND', '> PRINT ALL? Y/N _'] } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, yaw, y);
  f.box(X.h_beige, 0, 0.075, -0.02, 0.44, 0.15, 0.4, 0.008);
  for (let i = 0; i < 2; i++) f.quad(M.black, 0.03, 0.05 + i * 0.045, 0.17, 0.062 + i * 0.045, 0.181);
  f.quad(U.ledG, -0.17, 0.03, -0.16, 0.04, 0.181);
  f.quad(on ? U.ledA : M.dark, -0.15, 0.03, -0.14, 0.04, 0.181);
  // the tube: the bezel and its deep back, the screen
  f.box(X.h_beige, 0, 0.33, 0.06, 0.4, 0.34, 0.06, 0.02);
  f.add(X.h_beige, cylC(0.15, 0.22, 0.3, 4), 0, 0.33, -0.12, [PI / 2, PI / 4, 0, 'XYZ']);
  f.box(X.h_beige, 0, 0.16, -0.02, 0.24, 0.02, 0.2);
  f.quad(on ? G.h_crt : X.h_crt, -0.16, 0.2, 0.16, 0.45, 0.091);
  if (on) f.label(lines[0], 0, 0.325, 0.092, 0.28, 0.21, { bg: '#031208', fg: '#6dff8f', border: '#031208', font: 'bold 30px Courier New', lines, align: 'left' });
  f.quad(U.ledG, 0.15, 0.175, 0.16, 0.185, 0.091);
  keyboard(c, f, -0.03, 0, 0.36, { mouse: 0.32, beige: true });
  f.add(M.black, tubeG('crtKb', [[0, 0.02, 0.29], [0.02, 0.01, 0.22], [0.05, 0.02, 0.18]], 0.004, 6, 3), 0, 0, 0);
  if (on) f.light(0, 0.33, 0.35, 0.28, 1.1, [0.45, 1.0, 0.55]);
}

/**
 * The records clerk's L-shaped desk centred at (x, z), its clerk on the `face` side: an oak top on grey steel pedestals
 * (a drawer left open), the return on the clerk's right running back toward them with the typewriter; the CRT
 * computer, in / out trays, a rubber-stamp carousel, the card index, a lamp, the phone, a nameplate, mug and papers.
 */
export function clerkDesk(c, x, z, face, { w = 1.55, d = 0.75, retLen = 1.6, name = 'R. OKAFOR · RECORDS' } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.74, rw = 0.6, ru = w / 2 + rw / 2, rv = -d / 2 + retLen / 2;
  // the main top and its pedestal (left), the modesty panel; the return's top on its own pedestal
  f.span(X.h_oak, -w / 2, T - 0.035, -d / 2, w / 2 + rw, T, d / 2, 0.006);
  f.span(X.h_oak, w / 2, T - 0.035, d / 2, w / 2 + rw, T, -d / 2 + retLen, 0.006);
  f.span(M.grey, -w / 2 + 0.02, 0, -d / 2 + 0.03, -w / 2 + 0.45, T - 0.035, d / 2 - 0.03);
  f.span(M.grey, -w / 2 + 0.45, 0.25, -d / 2 + 0.02, w / 2, T - 0.035, -d / 2 + 0.04);
  for (let i = 0; i < 3; i++) {
    const y0 = 0.05 + i * 0.22, pull = i === 1 ? 0.3 : 0;
    f.span(M.grey, -w / 2 + 0.03, y0, d / 2 - 0.03 + pull - 0.02, -w / 2 + 0.44, y0 + 0.2, d / 2 - 0.02 + pull);
    f.span(X.h_chrome, -w / 2 + 0.18, y0 + 0.14, d / 2 - 0.02 + pull, -w / 2 + 0.29, y0 + 0.155, d / 2 - 0.005 + pull);
    if (pull) for (let k = 0; k < 5; k++) f.box(pick(c, [X.h_kraft, X.h_paper, M.card]), -w / 2 + 0.235, y0 + 0.12, d / 2 - 0.25 + k * 0.05, 0.36, 0.14, 0.01, 0, [jit(c, 0.2), 0, 0]);
  }
  f.span(M.grey, ru - rw / 2 + 0.02, 0, -d / 2 + retLen - 0.5, ru + rw / 2 - 0.02, T - 0.035, -d / 2 + retLen - 0.03);
  f.span(M.grey, w / 2 + rw - 0.04, 0, -d / 2 + 0.03, w / 2 + rw - 0.02, T - 0.035, -d / 2 + retLen - 0.5);
  // on the main top: the computer in the back corner, trays, stamps, card index, lamp, phone, nameplate
  crtComputer(c, ...xyz(f, -w / 2 + 0.38, T, -0.12), f.yaw, { on: true });
  for (let k = 0; k < 2; k++) {
    f.span(M.dark, 0.2, T + k * 0.07, -d / 2 + 0.05, 0.55, T + 0.01 + k * 0.07, -d / 2 + 0.33);
    f.span(X.h_paper, 0.23, T + 0.01 + k * 0.07, -d / 2 + 0.08, 0.53, T + 0.03 + k * 0.07 - k * 0.015, -d / 2 + 0.3);
  }
  // the rubber-stamp carousel, the card index
  const su = 0.66, sv = -d / 2 + 0.17;
  f.cyl(M.black, su, T, sv, 0.08, 0.08, 0.02, 10);
  f.cyl(M.black, su, T + 0.02, sv, 0.008, 0.008, 0.14, 6);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * PI * 2;
    f.add(M.dark, cylG(0.01, 0.01, 0.07, 6), su + Math.cos(a) * 0.05, T + 0.07, sv + Math.sin(a) * 0.05);
    f.add(X.h_oak, sphG(0.016, 6, 4), su + Math.cos(a) * 0.05, T + 0.15, sv + Math.sin(a) * 0.05);
  }
  f.box(X.h_charcoal, -0.02, T + 0.06, -0.2, 0.2, 0.12, 0.14, 0.01);
  for (let k = 0; k < 9; k++) f.box(X.h_paper, -0.02, T + 0.13, -0.25 + k * 0.012, 0.16, 0.07, 0.002, 0, [0.3, 0, 0]);
  // the lamp and the nameplate on the corner, the phone, a mug, the papers
  Fac.deskLamp(c, ...xyz(f, w / 2 + 0.5, T, -d / 2 + 0.15), f.yaw + PI + 0.6, { on: true, light: true });
  f.box(M.dark, w / 2 + 0.2, T + 0.035, -d / 2 + 0.07, 0.3, 0.07, 0.05);
  f.label(name, w / 2 + 0.2, T + 0.035, -d / 2 + 0.045, 0.28, 0.05, PLATE, 'back');
  f.box(X.h_beige, 0.3, T + 0.035, 0.12, 0.2, 0.07, 0.22, 0.015);
  f.box(X.h_beige, 0.3, T + 0.085, 0.09, 0.06, 0.04, 0.22, 0.015, [0, PI / 2, 0]);
  f.add(M.black, tubeG('clerkCord', [[0.2, T + 0.03, 0.12], [0.15, T + 0.005, 0.22], [0.2, T + 0.005, 0.3]], 0.004, 6, 3), 0, 0, 0);
  Fac.mug(c, ...xyz(f, 0.62, T, 0.2), null, rnd() * 6);
  Fac.papers(c, ...xyz(f, 0.08, T, 0.2), f.yaw + 0.2, 5);
  // the return: the typewriter facing the clerk, a ream beside it
  typewriter(c, ...xyz(f, ru, T, -d / 2 + retLen - 0.45), f.yaw - PI / 2);
  f.box(M.white, ru + 0.05, T + 0.03, -d / 2 + 0.55, 0.3, 0.06, 0.22);
  Fac.officeChair(c, ...xz(f, 0.15, d / 2 + 0.45), f.yaw + PI + 0.4, { mat: X.h_fabric });
  f.col(-w / 2, -d / 2, w / 2 + rw, d / 2, T, SURF.wood);
  f.col(w / 2, d / 2, w / 2 + rw, -d / 2 + retLen, T, SURF.wood);
}

/**
 * A big office shredder against the wall at (x, z) facing `face`: the charcoal cabinet on castors, the cutting head
 * with its feed slot, the control strip; `jam`: a wad of paper stuck in the slot, the red JAM lamp, the bin door hanging
 * open on an overflowing sack and strips spilled on the floor.
 */
export function industrialShredder(c, x, z, face, { jam = true, w = 0.6, d = 0.48 } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const H = 0.98;
  f.span(X.h_charcoal, -w / 2, 0.06, 0, w / 2, H - 0.16, d, 0.012);
  for (const su of [-1, 1]) f.cyl(M.black, su * (w / 2 - 0.07), 0, d - 0.08, 0.03, 0.03, 0.06, 8);
  f.span(X.h_plastic, -w / 2 - 0.01, H - 0.16, -0.01, w / 2 + 0.01, H, d + 0.01, 0.02);
  f.slab(M.black, -0.2, H, d / 2 - 0.02, 0.2, H + 0.002, d / 2 + 0.01, 't');
  f.span(X.h_charcoal, w / 2 - 0.2, H - 0.06, d + 0.01, w / 2 - 0.04, H - 0.02, d + 0.012);
  f.quad(U.ledG, w / 2 - 0.17, H - 0.045, w / 2 - 0.15, H - 0.035, d + 0.013);
  f.quad(jam ? G.h_red : M.dark, w / 2 - 0.12, H - 0.045, w / 2 - 0.1, H - 0.035, d + 0.013);
  f.label('CONFIDENTIAL WASTE ONLY · P-4', -0.08, H - 0.08, d + 0.011, 0.36, 0.05, PLATE);
  if (!jam) {
    f.span(X.h_charcoal, -w / 2 + 0.01, 0.08, d, w / 2 - 0.01, H - 0.18, d + 0.015);
    f.col(-w / 2, 0, w / 2, d + 0.02, H, SURF.metal);
    return;
  }
  // the wad in the slot: sheets crumpled and fanned up out of it
  for (let k = 0; k < 6; k++) f.box(X.h_paper, -0.14 + k * 0.055, H + 0.07, d / 2 + jit(c, 0.01), 0.18, 0.15, 0.002, 0, [jit(c, 0.5), jit(c, 0.3), jit(c, 0.4)]);
  f.add(X.h_paper, sphG(0.06, 6, 4), 0.05, H + 0.03, d / 2, null, [1.4, 0.6, 1]);
  f.label('JAMMED AGAIN!! DO NOT FORCE · CALL FACILITIES x2210', -0.14, H + 0.003, d / 2 + 0.13, 0.22, 0.12, { ...NOTE, bg: '#fdf6a8', lines: ['JAMMED AGAIN!!', 'DO NOT FORCE', 'facilities x2210'] }, 'up');
  // the bin door hanging open, the sack bulging out of it, strips on the floor
  const hp = f.p(-w / 2 + 0.01, 0, d);
  const g = new Frame(c, hp.x, hp.z, f.yaw - 1.6);
  g.span(X.h_charcoal, 0, 0.08, -0.015, w - 0.02, H - 0.18, 0);
  f.span(M.black, -w / 2 + 0.03, 0.08, d - 0.005, w / 2 - 0.03, H - 0.2, d - 0.004);
  f.add(X.h_sack, sphG(0.26, 10, 8), 0, 0.33, d - 0.15, null, [1, 1.1, 0.9]);
  for (let k = 0; k < 40; k++) {
    const p = f.p(jit(c, 0.55), 0, d + 0.1 + rnd() * 0.5);
    c.K.add(X.h_paper, planeG(0.006, 0.12 + rnd() * 0.15), p.x, 0.003 + k * 0.0002, p.z, [-PI / 2, 0, rnd() * 6]);
  }
  f.col(-w / 2, 0, w / 2, d + 0.02, H, SURF.metal);
}

/** clear sacks of shredded paper standing at (x, z) in a row along yaw: bulging, their necks tied, a tag on each */
export function shredSacks(c, x, z, yaw = 0, { n = 2 } = {}) {
  const { X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  for (let i = 0; i < n; i++) {
    const u = (i - (n - 1) / 2) * 0.5 + jit(c, 0.04), s = 0.85 + rnd() * 0.25;
    f.add(X.h_sack, sphG(0.25, 10, 8), u, 0.31 * s, 0, [0, rnd() * 3, jit(c, 0.05)], [1, 1.25 * s, 0.9]);
    f.cyl(X.h_sack, u, 0.6 * s, 0, 0.03, 0.05, 0.1, 6);
    f.label('CONFIDENTIAL · INCINERATE', u, 0.3 * s, 0.24, 0.2, 0.06, WARN);
  }
  f.col(-n * 0.25, -0.24, n * 0.25, 0.24, 0.65, SURF.cardboard);
}

/**
 * Cartons of copy paper stacked at (x, z) turned yaw: `cols` × `rows` stacks `layers` high (white cartons, the printed
 * band), the top one open on its wrapped reams; `wet`: the bottom layer soaked brown and the stack leaning.
 */
export function paperBoxes(c, x, z, yaw = 0, { cols = 2, rows = 1, layers = 3, wet = false, open = true } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const bw = 0.45, bd = 0.3, bh = 0.24, W = cols * bw, D = rows * bd;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const n = layers - (rnd() < 0.3 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const u = -W / 2 + bw * (i + 0.5) + jit(c, 0.02), v = -D / 2 + bd * (j + 0.5) + jit(c, 0.02);
        const soaked = wet && k === 0;
        const lean = wet && k > 0 ? 0.04 * k : 0;
        f.box(soaked ? X.h_wet : M.white, u + lean * 0.5, bh * (k + 0.5) - (soaked ? 0.02 : 0), v, bw - 0.01, bh - (soaked ? 0.04 : 0), bd - 0.01, 0, [0, jit(c, 0.05), lean]);
        f.quad(M.blue, u - bw / 2 + 0.02, bh * (k + 0.5) - 0.03, u + bw / 2 - 0.02, bh * (k + 0.5) + 0.01, v + bd / 2 - 0.004);
        if (open && k === n - 1 && i === 0 && j === rows - 1) {
          // the open top: the lid off beside it, reams in their wrappers
          f.slab(M.dark, u - bw / 2 + 0.02, bh * (k + 1) - 0.005, v - bd / 2 + 0.02, u + bw / 2 - 0.02, bh * (k + 1), v + bd / 2 - 0.02, 't');
          for (let r = 0; r < 2; r++) f.span(r ? X.h_paper : M.white, u - bw / 2 + 0.025 + r * 0.205, bh * (k + 1) - 0.06, v - bd / 2 + 0.03, u - bw / 2 + 0.225 + r * 0.205, bh * (k + 1) - 0.005, v + bd / 2 - 0.03);
        }
      }
    }
  }
  f.label('COPY PAPER · A4 · 80 g · 5 × 500', 0, bh * 0.5, D / 2 + 0.002, Math.min(0.4, W - 0.05), 0.06, NOTE);
  f.col(-W / 2, -D / 2, W / 2, D / 2, bh * layers, SURF.cardboard);
}

/**
 * A microfilm reader-printer on its table against the wall at (x, z) facing `face`: the beige base and tall screen hood
 * with a lit page of an old document (`page`), the film carrier with a reel on each spindle, the focus and advance
 * knobs, the print slot and a few prints; a carton of reels on the table, the drawer cabinet of film under it, a chair.
 */
export function microfilmReader(c, x, z, face, { w = 1.2, d = 0.7, page = ['NOX BIOSYSTEMS · MEMO 1997-114', 'RE: K-7 ADVERSE EVENTS', 'SUBJECTS 4, 9, 11: SEE ANNEX', 'DESTROY AFTER READING'] } = {}) {
  const { M, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.74;
  for (const u of [-w / 2 + 0.04, w / 2 - 0.04]) for (const v of [0.05, d - 0.05]) f.span(M.grey, u - 0.02, 0, v - 0.02, u + 0.02, T - 0.03, v + 0.02);
  f.span(X.h_oak, -w / 2, T - 0.03, 0, w / 2, T, d, 0.006);
  // the film cabinet under the table: shallow drawers with card slots
  f.span(M.grey, 0.1, 0, 0.04, w / 2 - 0.08, T - 0.05, d - 0.08);
  for (let i = 0; i < 6; i++) {
    f.quad(M.dark, 0.13, 0.04 + i * 0.105, w / 2 - 0.11, 0.045 + i * 0.105, d - 0.079);
    f.quad(X.h_paper, (0.1 + w / 2 - 0.08) / 2 - 0.04, 0.09 + i * 0.105, (0.1 + w / 2 - 0.08) / 2 + 0.04, 0.115 + i * 0.105, d - 0.079);
  }
  // the reader: base, hood, the screen and its page, the carrier and reels, the knobs, the print slot
  const ru = -0.2;
  f.box(X.h_beige, ru, T + 0.08, 0.35, 0.6, 0.16, 0.5, 0.015);
  f.box(X.h_beige, ru, T + 0.5, 0.22, 0.58, 0.7, 0.3, 0.02);
  f.quad(G.h_fiche, ru - 0.24, T + 0.27, ru + 0.24, T + 0.75, 0.371);
  f.label(page[0], ru, T + 0.55, 0.372, 0.42, 0.34, { bg: '#ece6c8', fg: '#2a2a22', border: '#ece6c8', font: 'bold 26px Courier New', lines: page, align: 'left' });
  f.span(X.h_beige, ru - 0.3, T + 0.84, 0.07, ru + 0.3, T + 0.88, 0.4);
  f.span(c.U.glass, ru - 0.2, T + 0.161, 0.42, ru + 0.2, T + 0.165, 0.58);
  for (const s of [-1, 1]) {
    f.cyl(X.h_steel, ru + s * 0.24, T + 0.16, 0.5, 0.01, 0.01, 0.04, 6);
    f.add(M.dark, cylC(0.07, 0.07, 0.025, 14), ru + s * 0.24, T + 0.2, 0.5);
    f.add(X.h_kraft, cylC(0.045, 0.045, 0.026, 10), ru + s * 0.24, T + 0.2, 0.5);
  }
  for (const s of [-1, 1]) f.add(M.black, cylC(0.025, 0.025, 0.03, 10), ru + s * 0.18, T + 0.1, 0.61, [PI / 2, 0, 0]);
  f.quad(M.black, ru + 0.12, T + 0.04, ru + 0.28, T + 0.055, 0.601);
  for (let k = 0; k < 3; k++) sheet(c, ...xyz(f, ru + 0.45 + jit(c, 0.04), T + k * 0.002, 0.45 + jit(c, 0.04)), f.yaw + jit(c, 0.3));
  // a carton of reels, a few out on the table
  f.box(M.card, w / 2 - 0.22, T + 0.06, 0.18, 0.3, 0.12, 0.2);
  for (let k = 0; k < 3; k++) f.add(M.dark, cylC(0.05, 0.05, 0.02, 12), w / 2 - 0.3 + k * 0.11, T + 0.01, 0.42 + jit(c, 0.04));
  Fac.officeChair(c, ...xz(f, ru + jit(c, 0.1), d + 0.4), f.yaw + PI + jit(c, 0.6), { mat: X.h_fabric });
  f.light(ru, T + 0.55, 0.6, 0.3, 1.3, [1.0, 0.95, 0.8]);
  f.col(-w / 2, 0, w / 2, d, T, SURF.wood);
}

/** a bucket set under a ceiling drip at (x, z): yellow plastic, half full of brown water, the puddle it missed */
export function dripBucket(c, x, z, { r = 0.15, h = 0.3 } = {}) {
  const { K, M, U } = c;
  K.add(M.yellow, cylG(r * 0.85, r, h, 12, true), x, 0, z);
  K.add(M.yellow, cylG(r * 0.85, r * 0.85, 0.005, 12), x, 0.002, z);
  K.add(M.dark, torG(r * 0.6, 0.004, 3, 10, PI), x, h * 0.75, z, [0, 0.4, 0]);
  K.add(U.murk, cylG(r * 0.93, r * 0.93, 0.004, 12), x, h * 0.55, z);
  c.decal('puddle', x + 0.25, z + 0.1, 1.1, c.rnd() * 3);
}

/**
 * The records office (level 5): binder shelving the length of the west wall, two filing cabinets in the north-west
 * corner, back-to-back rows of filing cabinets in the middle (one rifled, one pulled over), the clerk's L-desk by the
 * door (the old computer, the typewriter), the copier, the jammed shredder and its sacks, the microfilm reader on the
 * east wall; box shelving on the south wall soaked by a leak (a bucket under it, a tarp), cartons of copy paper.
 */
export function dressRecords(c, s, ctx) {
  const { K, M, X } = c;
  const { x0, z0, x1, z1 } = s;
  // the west wall: binders, 1981 onwards
  [4.65, 6.95, 9.25].forEach((z, i) => binderShelf(c, x0, z, 'e', { w: 2.3, kind: i === 2 ? 'mixed' : 'binders', tags: ['TRIALS', 'PERSONNEL', 'SAFETY'], year: 1985 + i * 4 }));
  // the north-west corner: two cabinets, the clock, a calendar
  Fac.filingCabinet(c, x0 + 0.3, z0 + 0.32, 's', { drawers: 4, mat: M.grey });
  Fac.filingCabinet(c, x0 + 0.8, z0 + 0.32, 's', { drawers: 4, mat: M.grey, open: 1 });
  L.wallClock(c, x0 + 0.55, 2.5, z0, 's');
  DD.wallCalendar(c, x1 - 0.55, 1.75, z0, 's', { month: 'OCTOBER 2026', first: 3, days: 31, crossed: 13 });
  // the middle: two rows of cabinets back to back, one rifled, one pulled over into the aisle
  for (let i = 0; i < 5; i++) {
    const z = 5.45 + i * 0.48;
    Fac.filingCabinet(c, -19.55, z, 'w', { drawers: 4, mat: i % 2 ? M.grey : X.h_shelf, open: i === 1 ? 2 : -1 });
    Fac.filingCabinet(c, -18.91, z, 'e', { drawers: 4, mat: i % 2 ? X.h_shelf : M.grey, open: i === 3 ? 0 : -1 });
  }
  c.label('A – K', -19.23, 1.45, 5.21, 'n', 0.3, 0.1, PLATE);
  c.label('L – Z', -19.23, 1.45, 7.65, 's', 0.3, 0.1, PLATE);
  Fac.filingCabinet(c, -18.6, 8.75, 's', { down: true });
  floorPapers(c, -17.9, 8.2, 8, 0.7);
  floorPapers(c, -20.4, 6.6, 4, 0.5);
  // the clerk's desk by the door, facing it
  clerkDesk(c, -16.4, z0 + 1.23, 's', { w: 1.5, retLen: 1.6 });
  P.extinguisher(c, x1, z0 + 0.4, 'w');
  // the east wall: copier, the jammed shredder and its sacks, the microfilm reader
  Fac.copier(c, x1 - 0.36, 5.75, 'w', { broken: true });
  L.noticeBoard(c, x1, 1.65, 5.9, 'w', { w: 0.9, h: 0.6, notes: ['RETENTION SCHEDULE 2026', 'SHRED BIN · COLLECT FRI'] });
  industrialShredder(c, x1, 6.95, 'w');
  shredSacks(c, x1 - 0.3, 7.75, PI / 2, { n: 2 });
  microfilmReader(c, x1, 9.4, 'w');
  plate(c, x1, 0.3, 6.45, 'w');
  plate(c, x1, 0.3, 8.6, 'w');
  // the south wall: the box shelving, soaked under the leak; a bucket, a tarp; cartons of paper in the corner
  binderShelf(c, -19.7, z1, 'n', { w: 2.6, kind: 'boxes', wet: 2, tarp: true, h: 2.25, levels: 5, gaps: 0.05 });
  dripBucket(c, -19.2, z1 - 0.95);
  c.wallDecal('mold', -20.5, 2.75, z1, 'n', 1.1, 0.7);
  c.wallDecal('stain', -19.3, 2.6, z1, 'n', 0.9, 1.2);
  c.decal('puddle', -18.4, z1 - 1.3, 1.3, 0.6);
  paperBoxes(c, x0 + 0.5, z1 - 0.2, 0, { cols: 2, rows: 1, layers: 3 });
  paperBoxes(c, -17.4, z1 - 0.4, 0.05, { cols: 2, rows: 1, layers: 2, wet: true, open: false });
  archiveBox(c, -16.9, 0, z1 - 1.1, 0.7, { wet: true });
  // the door wall: title, switch, the alarm call point; a retention notice
  roomTitle(c, 'RECORDS · DOCUMENT CONTROL', -18.25, 2.75, z0, 's', 1.9, '#c8a12a');
  L.lightSwitch(c, -17.25, z0, 's');
  DD.fireAlarm(c, -20.65, 1.35, z0, 's');
  DD.evacPlan(c, x1 - 0.75, 1.55, z1, 'n', { title: 'EVACUATION PLAN · LEVEL 5', here: [-0.1, 0.2] });
  sign(c, ['ALL FILES SIGNED OUT', 'MUST BE LOGGED'], -20.0, 1.6, z0, 's', 0.42, 0.13, NOTE);
}

// ---------------------------------------------------------------- the upper archive
/**
 * A block of powered compact shelving over the rect, its end panels toward `face`: `n` double-sided units running from
 * the back to the front, stacked side by side on carriages over floor rails, packed tight except one aisle opened after
 * unit `openAt`. Each end panel carries the unit's label, the drive panel (arrow buttons, a status LED: amber AISLE IN
 * USE on the open aisle) and the yellow safety sweep at its foot. Only the faces that can be seen are stocked: the
 * aisle's and the two outer sides (`show`: 'l' | 'r' | 'lr' of the block, looking at its end panels). `wet`: units
 * whose bottom shelves took the water.
 */
export function compactShelving(c, [x0, z0, x1, z1], face, { n = 7, openAt = 3, aisle = 0.9, h = 2.3, levels = 6, labels = null, wet = [], show = 'lr', years = 1981 } = {}) {
  const { K, M, U, X, G } = c;
  const alongX = face === 'n' || face === 's';
  const Lu = alongX ? x1 - x0 : z1 - z0, Lv = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const ud = (Lu - aisle - 0.02 * (n - 1)) / n;
  // the floor rails across the block
  for (const t of [0.12, 0.5, 0.88]) f.slab(M.dark, -Lu / 2, 0, -Lv / 2 + Lv * t - 0.03, Lu / 2, 0.012, -Lv / 2 + Lv * t + 0.03, 'tfb');
  let ua = -Lu / 2;
  for (let i = 0; i < n; i++) {
    const ub = ua + ud, um = (ua + ub) / 2;
    f.span(M.dark, ua + 0.02, 0.012, -Lv / 2 + 0.02, ub - 0.02, 0.1, Lv / 2 - 0.02);
    for (const v of [-Lv / 2 + 0.02, 0, Lv / 2 - 0.03]) f.span(X.h_shelf, um - 0.015, 0.1, v - 0.015, um + 0.015, h, v + 0.015);
    const gap = (h - 0.2) / levels;
    const sideL = (i === 0 && show.includes('l')) || i === openAt + 1, sideR = (i === n - 1 && show.includes('r')) || i === openAt;
    for (let k = 0; k <= levels; k++) {
      const y = 0.1 + k * gap;
      f.slab(X.h_shelf, ua, y, -Lv / 2 + 0.01, ub, y + 0.02, Lv / 2 - 0.02, k === levels ? 'tlr' : 'tlrd');
      if (k === levels) continue;
      const w = wet.includes(i) && k < 2;
      for (const [on, sd] of [[sideR, RIGHT[face]], [sideL, LEFT[face]]]) {
        if (!on) continue;
        // a frame on the unit's middle line, facing out of that side: its u runs along the unit
        const p = f.p(um, 0, 0);
        const g = new Frame(c, p.x, p.z, sd);
        stock(c, g, -Lv / 2 + 0.05, Lv / 2 - 0.06, y + 0.02, 0.0, ud / 2 - 0.01, gap - 0.05, { kind: (i + k) % 3 ? 'boxes' : 'mixed', wet: w, gaps: 0.1 });
      }
    }
    // the end panel: label, the drive panel and its LED, the safety sweep
    const ve = Lv / 2 - 0.02;
    f.span(X.h_endPanel, ua + 0.005, 0.03, ve, ub - 0.005, h + 0.05, ve + 0.014);
    const tag = labels?.[i] ?? `U-${String(i + 1).padStart(2, '0')}`;
    f.label(tag, um, 1.85, ve + 0.015, 0.2, 0.12, { ...NOTE, lines: [tag, `${years + i * 3} – ${years + i * 3 + 2}`] });
    f.box(X.h_charcoal, um, 1.25, ve + 0.03, 0.14, 0.2, 0.03, 0.006);
    f.quad(M.green, um - 0.04, 1.27, um - 0.01, 1.3, ve + 0.046);
    f.quad(M.green, um + 0.01, 1.27, um + 0.04, 1.3, ve + 0.046);
    const lit = i === openAt || i === openAt + 1;
    f.quad(lit ? G.h_amber : U.ledG, um - 0.012, 1.2, um + 0.012, 1.215, ve + 0.046);
    f.span(M.hazard, ua + 0.01, 0.03, ve + 0.014, ub - 0.01, 0.1, ve + 0.05);
    if (lit) f.label('AISLE IN USE', um, 2.12, ve + 0.015, ud - 0.08, 0.08, WARN);
    f.col(ua, -Lv / 2, ub, ve + 0.05, h + 0.05, SURF.cardboard);
    ua = ub + (i === openAt ? aisle : 0.02);
  }
  // the open aisle's warning, its light in the aisle
  const au = -Lu / 2 + (openAt + 1) * ud + openAt * 0.02 + aisle / 2;
  f.light(au, 2.2, 0.0, 0.32, 1.6, [1.0, 0.75, 0.4]);
}

/**
 * A wall of drawers against the wall at (x, z) facing `face`, w long: oak plan chests below (wide shallow drawers for
 * drawings, their top a work surface) and card-catalogue cabinets above (rows × 5 small drawers per metre with brass
 * pulls and label frames). `open`: catalogue drawers pulled out (cards showing); `out`: one lying on the floor, its
 * cards fanned across it; `plan`: a plan-chest drawer left half open with drawings in it.
 */
export function drawerWall(c, x, z, face, { w = 4.6, rows = 11, open = [7, 23, 41], out = 30, plan = 2 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const Hp = 0.86, Dp = 0.8, Hc = 2.25, Dc = 0.45;
  const nm = Math.max(1, Math.round(w / 1.0)), mw = w / nm;
  // the plan chests: carcass, plinth, five drawers each, the top
  f.span(X.h_drawer, -w / 2, 0.08, 0, w / 2, Hp - 0.03, Dp - 0.02);
  f.span(M.dark, -w / 2 + 0.02, 0, 0.02, w / 2 - 0.02, 0.08, Dp - 0.05);
  f.span(X.h_oak, -w / 2 - 0.01, Hp - 0.03, 0, w / 2 + 0.01, Hp, Dp + 0.01);
  for (let m = 0; m < nm; m++) {
    const u0 = -w / 2 + m * mw;
    for (let k = 0; k < 5; k++) {
      const y0 = 0.1 + k * 0.145, pull = m === plan && k === 3 ? 0.22 : 0;
      f.slab(X.h_drawer, u0 + 0.015, y0, Dp - 0.04 + pull, u0 + mw - 0.015, y0 + 0.13, Dp - 0.02 + pull, pull ? 'ftlr' : 'f');
      f.slab(X.h_brass, u0 + mw / 2 - 0.1, y0 + 0.08, Dp - 0.02 + pull, u0 + mw / 2 + 0.1, y0 + 0.095, Dp + pull, 'ftd');
      f.quad(X.h_paper, u0 + mw / 2 - 0.05, y0 + 0.03, u0 + mw / 2 + 0.05, y0 + 0.06, Dp - 0.019 + pull);
      if (pull) for (let s2 = 0; s2 < 4; s2++) f.slab(X.h_paper, u0 + 0.05, y0 + 0.02 + s2 * 0.01, Dp - 0.5 + pull, u0 + mw - 0.06, y0 + 0.023 + s2 * 0.01, Dp - 0.05 + pull, 't');
    }
  }
  // the catalogue cabinets over them
  f.span(X.h_drawer, -w / 2, Hp, 0, w / 2, Hc, Dc - 0.02);
  f.span(X.h_oak, -w / 2 - 0.01, Hc, 0, w / 2 + 0.01, Hc + 0.04, Dc + 0.01);
  const cols = Math.round(mw / 0.19), dw = mw / cols, dh = (Hc - Hp - 0.06) / rows;
  let idx = 0;
  for (let m = 0; m < nm; m++) {
    const u0 = -w / 2 + m * mw;
    f.slab(X.h_oak, u0 - 0.006, Hp, Dc - 0.02, u0 + 0.006, Hc, Dc, 'f');
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++, idx++) {
        const ua = u0 + k * dw + 0.012, ub = u0 + (k + 1) * dw - 0.012, y0 = Hp + 0.03 + r * dh + 0.008, y1 = y0 + dh - 0.016;
        if (idx === out) {
          f.slab(M.black, ua, y0, Dc - 0.025, ub, y1, Dc - 0.02, 'f');
          continue;
        }
        const pull = open.includes(idx) ? 0.22 + rnd() * 0.1 : 0;
        f.slab(X.h_drawer, ua, y0, Dc - 0.02 + pull, ub, y1, Dc + pull, pull ? 'ftlr' : 'f');
        f.slab(X.h_brass, (ua + ub) / 2 - 0.025, y0 + 0.012, Dc + pull, (ua + ub) / 2 + 0.025, y0 + 0.022, Dc + 0.012 + pull, 'ftd');
        f.quad(X.h_paper, (ua + ub) / 2 - 0.03, y1 - 0.035, (ua + ub) / 2 + 0.03, y1 - 0.012, Dc + 0.001 + pull);
        if (pull) for (let s2 = 0; s2 < 5; s2++) f.slab(X.h_paper, ua + 0.01, y0 + 0.01, Dc - 0.06 + pull - s2 * 0.035, ub - 0.01, y1 + 0.02, Dc - 0.058 + pull - s2 * 0.035, 'f');
      }
    }
  }
  // the drawer that came out: on the floor, its cards fanned out
  const p = f.p(-w / 2 + mw * 1.6, 0, Dp + 0.45);
  c.K.add(X.h_drawer, rbox(0.17, 0.11, 0.42), p.x, 0.07, p.z, [0, f.yaw + 0.7, 0.15]);
  for (let i = 0; i < 14; i++) c.K.add(X.h_paper, planeG(0.125, 0.075), p.x + jit(c, 0.45), 0.002 + i * 0.0004, p.z + jit(c, 0.35), [-PI / 2, 0, rnd() * 6]);
  f.label('CARD INDEX · SUBJECTS A–Z · 1979–2004', 0, Hc + 0.12, 0.004, Math.min(1.8, w * 0.5), 0.12, PLATE);
  f.col(-w / 2, 0, w / 2, Dp + (plan >= 0 ? 0.22 : 0.02), Hp, SURF.wood);
  f.col(-w / 2, 0, w / 2, Dc, Hc + 0.04, SURF.wood);
}

/**
 * A sealed document safe against the wall at (x, z) facing `face`: a heavy green body with rounded edges on a steel
 * plinth bolted down, the recessed door with its brass hinges, the combination dial and the three-spoke handle, a key
 * escutcheon and the maker's plate; `sealed`: red-and-white tape across the door seam, a wax seal and a tag on wire.
 */
export function documentSafe(c, x, z, face, { w = 1.0, h = 1.55, d = 0.75, sealed = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.dark, -w / 2 - 0.03, 0, -0.0, w / 2 + 0.03, 0.08, d + 0.03);
  for (const su of [-1, 1]) f.cyl(X.h_steel, su * (w / 2 - 0.03), 0.08, d - 0.05, 0.018, 0.018, 0.012, 6);
  f.span(X.h_safe, -w / 2, 0.08, 0, w / 2, h, d - 0.04, 0.03);
  f.span(X.h_safe, -w / 2 + 0.07, 0.15, d - 0.05, w / 2 - 0.07, h - 0.07, d, 0.015);
  for (const y of [0.4, h - 0.32]) f.cyl(X.h_brass, -w / 2 + 0.06, y, d - 0.01, 0.025, 0.025, 0.16, 10);
  f.add(M.black, cylC(0.09, 0.09, 0.04, 20), 0.0, h * 0.62, d + 0.02, [PI / 2, 0, 0]);
  f.add(M.signs, gaugeG(0.14), 0.0, h * 0.62, d + 0.041);
  f.add(X.h_chrome, cylC(0.03, 0.03, 0.06, 10), 0.0, h * 0.4, d + 0.03, [PI / 2, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * PI) / 3 + 0.3;
    f.rod(X.h_chrome, [0, h * 0.4, d + 0.05], [Math.cos(a) * 0.15, h * 0.4 + Math.sin(a) * 0.15, d + 0.05], 0.012, 6);
    f.add(M.black, sphG(0.022, 8, 6), Math.cos(a) * 0.15, h * 0.4 + Math.sin(a) * 0.15, d + 0.05);
  }
  f.add(X.h_brass, cylC(0.025, 0.025, 0.012, 10), w / 2 - 0.18, h * 0.62, d + 0.006, [PI / 2, 0, 0]);
  f.label('NOX · DOCUMENT SAFE · CLASS III', 0, h - 0.17, d + 0.001, 0.36, 0.06, { bg: '#b3893c', fg: '#1d1b16', border: '#b3893c', font: 'bold 30px Georgia, serif' });
  if (sealed) {
    for (const y of [h * 0.52, h * 0.72]) f.label('SEALED · DO NOT OPEN', -w / 2 + 0.2, y, d + 0.012, 0.42, 0.06, { bg: '#f4f1e6', fg: '#c62a22', border: '#c62a22', font: 'bold 34px Arial' });
    f.add(M.red, cylC(0.03, 0.03, 0.012, 12), -w / 2 + 0.07, h * 0.62, d + 0.012, [PI / 2, 0, 0]);
    f.rod(X.h_steel, [-w / 2 + 0.07, h * 0.62, d + 0.02], [-w / 2 + 0.09, h * 0.5, d + 0.03], 0.002, 3);
    f.label('BY ORDER OF THE DIRECTOR · 14/10', -w / 2 + 0.12, h * 0.44, d + 0.03, 0.12, 0.08, { ...NOTE, lines: ['BY ORDER OF', 'THE DIRECTOR', '14/10'] });
  }
  f.col(-w / 2 - 0.03, 0, w / 2 + 0.03, d + 0.06, h, SURF.metal);
}

/**
 * A mobile safety step ladder centred at (x, z), climbing toward yaw: two tube side frames, perforated treads, the top
 * platform with its handrails, castors at the back and rubber feet at the front (they bite when someone stands on it).
 */
export function rollingLadder(c, x, z, yaw = 0, { steps = 4, w = 0.6 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  const rise = 0.24, run = 0.22, top = steps * rise, L = steps * run + 0.3;
  for (const s of [-1, 1]) {
    const u = s * (w / 2);
    f.rod(X.h_alu, [u, 0.05, L / 2], [u, top, -L / 2 + 0.3], 0.016, 6); // the stringer
    f.rod(X.h_alu, [u, 0.05, -L / 2], [u, top, -L / 2], 0.016, 6); // the back leg
    f.rod(X.h_alu, [u, top, L / 2 - 0.25], [u, top + 0.9, -L / 2 + 0.1], 0.014, 6); // the handrail
    f.rod(X.h_alu, [u, top + 0.9, -L / 2 + 0.1], [u, top, -L / 2 + 0.02], 0.014, 6);
    f.cyl(M.black, u, 0, -L / 2, 0.035, 0.035, 0.05, 8);
    f.box(X.h_rubber, u, 0.025, L / 2 - 0.01, 0.05, 0.05, 0.07);
  }
  for (let k = 1; k <= steps; k++) {
    const v = L / 2 - k * run + 0.02;
    f.span(k === steps ? X.h_steel : X.h_alu, -w / 2, k * rise - 0.03, v - (k === steps ? 0.25 : 0.11), w / 2, k * rise, v + 0.11);
    f.quad(M.yellow, -w / 2 + 0.02, k * rise - 0.03, w / 2 - 0.02, k * rise - 0.01, v + 0.111);
  }
  f.hcyl(X.h_alu, 0, top + 0.9, -L / 2 + 0.1, 0.014, w, 6, 'u');
  f.col(-w / 2 - 0.04, -L / 2 - 0.04, w / 2 + 0.04, L / 2 + 0.04, top + 0.9, SURF.metal);
}

/** a wooden library chair at (x, z), its sitter looking toward yaw (`down`: knocked over on its back) */
export function woodChair(c, x, z, yaw, { down = false } = {}) {
  const { X } = c;
  const f = down ? new Frame(c, x, z, yaw, 0.22, [-PI / 2 + 0.1, 0.1]) : new Frame(c, x, z, yaw);
  f.span(X.h_oak, -0.22, 0.43, -0.2, 0.22, 0.46, 0.22, 0.008);
  for (const su of [-1, 1]) {
    f.span(X.h_oak, su * 0.19 - 0.02, 0, 0.17, su * 0.19 + 0.02, 0.43, 0.21);
    f.span(X.h_oak, su * 0.19 - 0.02, 0, -0.2, su * 0.19 + 0.02, 0.9, -0.16);
  }
  for (const y of [0.62, 0.84]) f.span(X.h_oak, -0.19, y - 0.04, -0.2, 0.19, y + 0.04, -0.18);
  for (const u of [-0.08, 0, 0.08]) f.span(X.h_oak, u - 0.015, 0.46, -0.195, u + 0.015, 0.8, -0.185);
  f.span(X.h_oak, -0.17, 0.15, -0.0, 0.17, 0.17, 0.02);
}

/**
 * The long reading table centred at (x, z), along x or z, `len` long: an oak top on turned legs with an apron, two
 * green banker's lamps (one lit), foam book cradles holding an open ledger, archive boxes with their lids off and
 * folders out, white cotton gloves, a magnifier, pencils; wooden chairs round it (one knocked over).
 */
export function readingTable(c, x, z, alongX, { len = 2.4, d = 1.0, chairs = 4, down = 1 } = {}) {
  const { M, X, G, rnd } = c;
  const f = new Frame(c, x, z, alongX ? 's' : 'e');
  const T = 0.76;
  f.span(X.h_oak, -len / 2, T - 0.04, -d / 2, len / 2, T, d / 2, 0.01);
  f.span(X.h_oak, -len / 2 + 0.08, T - 0.14, -d / 2 + 0.08, len / 2 - 0.08, T - 0.04, d / 2 - 0.08);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    f.cyl(X.h_oak, su * (len / 2 - 0.1), 0, sv * (d / 2 - 0.1), 0.035, 0.045, T - 0.04, 8);
    f.add(X.h_oak, sphG(0.05, 8, 5), su * (len / 2 - 0.1), 0.42, sv * (d / 2 - 0.1), null, [1, 0.6, 1]);
  }
  // the lamps down the middle
  for (const [u, on] of [[-len / 4, true], [len / 4, false]]) {
    f.cyl(X.h_brass, u, T, 0, 0.07, 0.06, 0.02, 12);
    f.cyl(X.h_brass, u, T + 0.02, 0, 0.01, 0.01, 0.3, 6);
    f.add(M.green, cylC(0.065, 0.065, 0.24, 12, false), u, T + 0.36, 0.0, [0, 0, PI / 2], [1, 1, 0.65]);
    f.add(on ? G.h_lamp : M.white, rbox(0.2, 0.004, 0.06), u, T + 0.32, 0.0);
    if (on) f.light(u, T + 0.25, 0, 0.42, 1.8, WARM);
  }
  // the work: cradles and a ledger, boxes with their lids off, folders, gloves, a magnifier, pencils
  const lu = -len / 4 + 0.05;
  for (const s of [-1, 1]) f.box(X.h_charcoal, lu + s * 0.17, T + 0.04, 0.27, 0.3, 0.08, 0.28, 0, [0, 0, s * 0.25]);
  for (const s of [-1, 1]) f.box(X.h_paper, lu + s * 0.17, T + 0.1, 0.27, 0.32, 0.025, 0.26, 0, [0, 0, s * 0.2]);
  f.box(X.h_bRed, lu, T + 0.07, 0.27, 0.06, 0.05, 0.27);
  archiveBox(c, ...xyz(f, len / 4 - 0.1, T, -0.25), f.yaw + 0.1, { lidOff: true });
  f.box(X.h_box, len / 4 + 0.35, T + 0.015, -0.25, 0.34, 0.03, 0.42, 0, [0, 0.4, 0]);
  for (let k = 0; k < 4; k++) f.box(pick(c, [X.h_kraft, M.card, X.h_bBlue]), len / 4 - 0.2 + k * 0.12, T + 0.004 + k * 0.004, 0.2 + jit(c, 0.05), 0.24, 0.006, 0.32, 0, [0, jit(c, 0.4), 0]);
  for (const s of [-1, 1]) f.box(M.white, -0.05 + s * 0.07, T + 0.012, -0.3, 0.09, 0.02, 0.18, 0.008, [0, s * 0.3, 0]);
  f.add(X.h_chrome, torG(0.045, 0.006, 4, 14), 0.15, T + 0.008, 0.05, [PI / 2, 0, 0]);
  f.add(c.U.glass, cylC(0.042, 0.042, 0.004, 14), 0.15, T + 0.008, 0.05);
  f.box(M.black, 0.26, T + 0.01, 0.05, 0.13, 0.016, 0.02, 0, [0, 0.4, 0]);
  for (let k = 0; k < 3; k++) f.hcyl(M.yellow, -0.3 + k * 0.03, T + 0.004, -0.05 + k * 0.02, 0.004, 0.17, 6, 'u');
  thermoHygrograph(c, ...xyz(f, -len / 2 + 0.25, T, -0.3), f.yaw);
  // the chairs: down the two long sides
  for (let i = 0; i < chairs; i++) {
    const side = i % 2 ? 1 : -1, u = (Math.floor(i / 2) - (Math.ceil(chairs / 2) - 1) / 2) * 0.8 + jit(c, 0.1);
    const p = f.p(u, 0, side * (d / 2 + 0.25 + rnd() * 0.15));
    woodChair(c, p.x, p.z, f.yaw + (side > 0 ? PI : 0) + jit(c, 0.3), { down: i === down });
  }
  f.col(-len / 2, -d / 2, len / 2, d / 2, T, SURF.wood);
}

/** a thermo-hygrograph on a surface at (x, y, z) facing yaw: the case and its window, the chart drum, the two pen arms */
export function thermoHygrograph(c, x, y, z, yaw = 0) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, yaw, y);
  f.box(X.h_charcoal, 0, 0.03, 0, 0.3, 0.06, 0.16, 0.008);
  f.cyl(X.h_paper, -0.04, 0.06, 0, 0.05, 0.05, 0.1, 12);
  for (const [yy, m] of [[0.12, M.red], [0.09, M.blue]]) {
    f.rod(X.h_steel, [0.12, yy, 0.0], [0.0, yy, 0.05], 0.002, 3);
    f.box(m, 0.0, yy, 0.05, 0.006, 0.01, 0.006);
  }
  f.span(U.glass, -0.15, 0.06, -0.08, 0.15, 0.18, 0.08);
  f.label('RH 81 % · 19 °C', 0.08, 0.03, 0.081, 0.12, 0.03, PLATE);
}

/**
 * Archive boxes stacked on a wooden pallet at (x, z) turned yaw, `cols` × `rows` × `layers`; `wet`: the bottom layers
 * soaked dark and slumped, the stack leaning, the top boxes fallen off onto the floor with their files spilled.
 */
export function boxStack(c, x, z, yaw = 0, { cols = 3, rows = 2, layers = 3, wet = 0, fallen = 0 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw);
  const bw = 0.34, bd = 0.42, bh = 0.285, W = cols * bw, D = rows * bd;
  // the pallet: top boards, three bearers
  for (let i = 0; i < 5; i++) f.slab(X.h_kraft, -W / 2 + (i * (W - 0.1)) / 4, 0.11, -D / 2, -W / 2 + (i * (W - 0.1)) / 4 + 0.1, 0.13, D / 2, 'tflr');
  for (const v of [-D / 2 + 0.05, 0, D / 2 - 0.05]) f.span(X.h_kraft, -W / 2, 0, v - 0.045, W / 2, 0.11, v + 0.045);
  let top = 0.13;
  for (let k = 0; k < layers; k++) {
    const soaked = k < wet, lean = wet ? 0.025 * k : 0, hh = soaked ? bh - 0.05 : bh;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (k === layers - 1 && i * rows + j < fallen) continue;
        archiveBox(c, ...xyz(f, -W / 2 + bw * (i + 0.5) + lean, top, -D / 2 + bd * (j + 0.5)), f.yaw + PI / 2 * (j % 2 ? 1 : 0) + jit(c, 0.04), { wet: soaked });
      }
    }
    top += hh + 0.03;
  }
  for (let i = 0; i < fallen; i++) {
    const p = f.p(jit(c, W / 2) + W * 0.6, 0, jit(c, D / 2));
    archiveBox(c, p.x, 0.21, p.z, rnd() * 6, { tilt: [PI / 2 - 0.1, jit(c, 0.1)], lidOff: true });
    floorPapers(c, p.x + jit(c, 0.3), p.z + jit(c, 0.3), 4, 0.45, i === 0);
  }
  f.col(-W / 2, -D / 2, W / 2 + (wet ? 0.08 : 0), D / 2, top, SURF.cardboard);
}

/**
 * A portable dehumidifier at (x, z) facing yaw: a pale rounded casing on castors, the intake grille, the display (RH
 * reading), a carry handle, the drain hose run off into a bucket beside it.
 */
export function dehumidifier(c, x, z, yaw = 0, { rh = '78 %' } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, yaw);
  f.box(X.h_plastic, 0, 0.38, 0, 0.42, 0.66, 0.3, 0.03);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.cyl(M.black, su * 0.16, 0, sv * 0.1, 0.025, 0.025, 0.05, 6);
  for (let i = 0; i < 8; i++) f.quad(M.dark, -0.16, 0.12 + i * 0.035, 0.16, 0.135 + i * 0.035, 0.151);
  f.box(X.h_charcoal, 0, 0.62, 0.15, 0.2, 0.08, 0.01);
  f.quad(G.h_lcd, -0.07, 0.6, 0.0, 0.64, 0.156);
  f.label(`RH ${rh}`, 0.05, 0.62, 0.156, 0.08, 0.04, PLATE);
  f.span(X.h_charcoal, -0.08, 0.71, -0.03, 0.08, 0.74, 0.03, 0.01);
  f.add(M.dark, tubeG('dehumHose', [[0.21, 0.1, -0.05], [0.35, 0.04, -0.1], [0.45, 0.02, 0.05], [0.52, 0.28, 0.12]], 0.01, 10, 5), 0, 0, 0);
  const p = f.p(0.55, 0, 0.12);
  dripBucket(c, p.x, p.z, { r: 0.14, h: 0.28 });
  f.col(-0.21, -0.15, 0.21, 0.15, 0.71, SURF.metal);
}

/**
 * The upper archive (level 5): a block of powered compact shelving in the north (its aisle open, a ladder left in it),
 * the wall of drawers on the west wall (a drawer pulled out and dropped), the sealed document safe and box shelving on
 * the east wall, the reading table in the south-west; in the south-east the leak: soaked boxes slumped on a pallet, a
 * tarp, a dehumidifier running into a bucket, puddles; box stacks in the open, files dropped on the way to the door.
 */
export function dressUarch(c, s, ctx) {
  const { x0, z0, x1, z1 } = s;
  // the compact shelving and the ladder in its aisle
  compactShelving(c, [x0 + 2.6, z0 + 0.1, x0 + 7.8, z0 + 5.0], 's', { n: 7, openAt: 3, aisle: 0.9, wet: [6], years: 1979, labels: ['A-01', 'A-02', 'A-03', 'K-7 / 1', 'K-7 / 2', 'K-7 / 3', 'P-01'] });
  rollingLadder(c, 34.5, -9.4, PI);
  floorPapers(c, 34.5, -7.9, 5, 0.3, false);
  // the west wall: drawers; the reading table in the south-west
  drawerWall(c, x0, -9.3, 'e', { w: 4.6 });
  readingTable(c, 31.1, -4.9, true, { len: 2.4, d: 1.0, chairs: 4, down: 1 });
  L.noticeBoard(c, x0, 1.6, -4.9, 'e', { w: 1.0, h: 0.6, notes: ['HANDLING: GLOVES ONLY', 'NO ITEM LEAVES THIS ROOM'] });
  sign(c, ['NO FOOD · NO DRINK', 'PENCILS ONLY'], x0, 1.75, -6.5, 'e', 0.36, 0.14, MANDATORY);
  L.wallClock(c, x0, 2.45, -3.4, 'e');
  plate(c, x0, 0.3, -6.2, 'e');
  // the east wall: the safe in the corner, box shelving under a tarp
  documentSafe(c, x1, -11.2, 'w');
  binderShelf(c, x1, -8.55, 'w', { w: 3.0, kind: 'boxes', levels: 6, wet: 1, tarp: true, gaps: 0.08 });
  L.cctvCam(c, x1 - 0.4, 2.8, z0, 's', 0.6);
  sign(c, ['NO NAKED FLAMES', 'HALON FLOODED AREA'], 38.0, 1.8, z0, 's', 0.42, 0.14, WARN);
  // the leak in the south-east: a soaked stack, puddles, mould, the dehumidifier
  boxStack(c, 38.9, -5.85, 0, { cols: 3, rows: 2, layers: 3, wet: 2, fallen: 2 });
  dehumidifier(c, 38.2, -3.75, PI + 0.3, { rh: '81 %' });
  c.decal('puddle', 38.7, -4.7, 1.8, 0.4);
  c.decal('puddle', 37.5, -6.1, 1.1, 1.9);
  c.decal('stain', 39.4, -6.8, 1.4, 0.7);
  c.wallDecal('mold', x1, 2.5, -5.4, 'w', 1.4, 1.1);
  c.wallDecal('stain', x1, 1.0, -4.6, 'w', 1.2, 0.8);
  c.wallDecal('mold', 38.6, 2.7, z1, 'n', 1.2, 0.7);
  // in the open: a stack of boxes, the book trolley by the box shelving, files dropped toward the door
  boxStack(c, 36.05, -5.55, 0.1, { cols: 2, rows: 2, layers: 2 });
  TK.bookTrolley(c, 38.6, -7.25, PI / 2 + 0.2);
  floorPapers(c, 34.4, -6.2, 5, 0.5);
  floorPapers(c, 33.8, -4.7, 4, 0.5);
  floorPapers(c, 34.3, -3.4, 3, 0.4, false);
  c.decal('footprints', 34.1, -5.2, 1.4, 0.1);
  // the door wall: title, switch, extinguisher, the call point
  roomTitle(c, 'UPPER ARCHIVE · RESTRICTED', 34, 2.75, z1, 'n', 1.9, '#8a6b44');
  L.lightSwitch(c, 32.75, z1, 'n');
  P.extinguisher(c, 30.6, z1, 'n');
  DD.fireAlarm(c, 37.3, 1.35, z1, 'n');
  plate(c, 38.2, 0.3, z1, 'n');
}
