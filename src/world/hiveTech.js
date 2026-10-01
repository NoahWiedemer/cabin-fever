// The Hive's technical and security rooms (world/hive.js): the server room, operations, the security office, the
// maintenance plant room, the stores and the archive. Props in the idiom of hiveProps.js (world-space geometry for the
// Kit, one mesh per material, baked light, a collider for whatever you'd bump into) and one dress function per room.
//
// c: hiveProps.js's build context plus X (EXTRA_MATS, baked), G (EXTRA_GLOW, emissive), label(text, x, y, z, face,
//    w, h, opts), decal(kind, x, z, size, rot), wallDecal(kind, x, y, z, face, w, h), screen(x, y, z, yaw, w, h, on).
// Wall props take (x, z) = the middle of their back edge on the wall line and `face`, the side they open toward
// ('n' -z, 's' +z, 'w' -x, 'e' +x). Free-standing ones take their centre and a face or a yaw (radians, 0 = front
// toward +z). Things that stand on a surface take its height y as well.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { SIGN } from './lab.js';
import * as P from './hiveProps.js';
import * as L from './hiveLabs.js';
import * as Fac from './hiveFacility.js';

/** baked materials this module adds (c.X) */
export const EXTRA_MATS = {
  t_rack: { color: 0x17191c, roughness: 0.55, metalness: 0.4 }, // server cabinets' powder coat
  t_perf: { color: 0x2c3034, roughness: 0.75, metalness: 0.35 }, // perforated doors, grilles
  t_cream: { color: 0xd8d3c2, roughness: 0.6 }, // CRAC units, old kit
  t_ivory: { color: 0xe4e0d3, roughness: 0.5 }, // phones, the fiche reader
  t_upsGrey: { color: 0x5a6067, roughness: 0.5, metalness: 0.3 },
  t_fireRed: { color: 0xb11f1a, roughness: 0.35, metalness: 0.2 },
  t_brass: { color: 0xb08a3e, roughness: 0.35, metalness: 0.8 },
  t_chrome: { color: 0xc9ced3, roughness: 0.2, metalness: 0.9 },
  t_rubber: { color: 0x1a1a1a, roughness: 0.92 },
  t_cBlue: { color: 0x2f6fd0, roughness: 0.6 }, // patch cables
  t_cYellow: { color: 0xe0b81e, roughness: 0.6 },
  t_cRed: { color: 0xc8322a, roughness: 0.6 },
  t_cGreen: { color: 0x2e9a4c, roughness: 0.6 },
  t_cGrey: { color: 0x8c9094, roughness: 0.6 },
  t_gun: { color: 0x2a2d31, roughness: 0.4, metalness: 0.75 }, // receivers, barrels
  t_polymer: { color: 0x23251f, roughness: 0.8 }, // rifle furniture, radios
  t_safe: { color: 0x3c4146, roughness: 0.5, metalness: 0.5 }, // gun lockers
  t_console: { color: 0x6d737a, roughness: 0.55, metalness: 0.2 },
  t_consoleTop: { color: 0x2b2f34, roughness: 0.6 },
  t_carpet: { color: 0x283040, roughness: 0.96 },
  t_genYellow: { color: 0xd6a31b, roughness: 0.55, metalness: 0.2 },
  t_engine: { color: 0x3a3e43, roughness: 0.5, metalness: 0.6 },
  t_pumpBlue: { color: 0x2c5a99, roughness: 0.45, metalness: 0.3 },
  t_pumpGreen: { color: 0x3e7849, roughness: 0.45, metalness: 0.3 },
  t_pipe: { color: 0x8a9096, roughness: 0.5, metalness: 0.5 },
  t_butcher: { color: 0x8c6b44, roughness: 0.8 }, // workbench tops
  t_peg: { color: 0xb39872, roughness: 0.85 }, // pegboard hardboard
  t_machine: { color: 0x50705d, roughness: 0.5, metalness: 0.3 }, // drill press
  t_binRed: { color: 0xc4392f, roughness: 0.6 },
  t_binBlue: { color: 0x2f62b8, roughness: 0.6 },
  t_binYellow: { color: 0xe2b524, roughness: 0.6 },
  t_beam: { color: 0xdf651b, roughness: 0.5, metalness: 0.3 }, // pallet-rack beams
  t_upright: { color: 0x234f8e, roughness: 0.5, metalness: 0.3 },
  t_pallet: { color: 0xa88a5b, roughness: 0.9 },
  t_wrap: { color: 0xcdd5d9, roughness: 0.22 }, // stretch wrap
  t_galv: { color: 0x9aa0a6, roughness: 0.45, metalness: 0.7 }, // cage mesh
  t_kraft: { color: 0xb38d5a, roughness: 0.9 },
  t_box: { color: 0xd7ceb6, roughness: 0.85 }, // archive boxes
  t_wet: { color: 0x7a6245, roughness: 0.95 }, // soaked card
  t_bBlack: { color: 0x1f2226, roughness: 0.6 }, // binders
  t_bBlue: { color: 0x2b4a8a, roughness: 0.6 },
  t_bRed: { color: 0x8f2a26, roughness: 0.6 },
  t_bGreen: { color: 0x2f6a45, roughness: 0.6 },
  t_shelf: { color: 0xb6babd, roughness: 0.5, metalness: 0.4 }, // archive shelving enamel
  t_walnut: { color: 0x5b3e29, roughness: 0.6 },
  t_paper: { color: 0xf0eee5, roughness: 0.9 },
  t_board: { color: 0x11171d, roughness: 0.7 }, // the wall map's backing
};
/** emissive materials this module adds (c.G): [colour, intensity] */
export const EXTRA_GLOW = {
  t_lcd: [0x7fe3ff, 1.4], // CRAC / UPS / panel displays
  t_lcdGreen: [0x8cff9a, 1.3], // scale, generator panel
  t_mapRoom: [0x2a8fa6, 0.8], // the wall map's rooms
  t_mapHot: [0xff4a2a, 1.6], // breached sectors
  t_ticker: [0xffb020, 1.5],
  t_fiche: [0xf3f0d8, 1.4], // the microfiche screen
  t_lamp: [0xffe2a8, 1.8], // work lights, desk lamps
  t_alarm: [0xff2a1a, 2.0], // red phone / alarm lamps
  t_feed: [0x6f8f7c, 0.55], // a CCTV picture's grey-green
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const PI = Math.PI;
const YAW = P.FACE_YAW;
const RIGHT = { s: 'e', e: 'n', n: 'w', w: 's' }; // the +u side of a thing facing `face`
const LEFT = { s: 'w', e: 's', n: 'e', w: 'n' };
const BACK = { s: 'n', n: 's', e: 'w', w: 'e' };
const COOL = [0.93, 0.97, 1.0];
const WARM = [1.0, 0.86, 0.62];
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
const cylG = (r0, r1, h, seg = 12, open = false) => cached('c' + k3(r0, r1, h) + ':' + seg + open, () => new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(0, h / 2, 0));
const cylC = (r0, r1, h, seg = 12) => cached('cc' + k3(r0, r1, h) + ':' + seg, () => new THREE.CylinderGeometry(r1, r0, h, seg));
const sphG = (r, ws = 10, hs = 8) => cached('s' + k3(r) + ':' + ws + ':' + hs, () => new THREE.SphereGeometry(r, ws, hs));
const domeG = (r, ws = 14) => cached('d' + k3(r) + ':' + ws, () => new THREE.SphereGeometry(r, ws, 4, 0, PI * 2, 0, PI / 2));
const torG = (R, r, rs = 6, ts = 16, arc = PI * 2) => cached('t' + k3(R, r, arc) + ':' + rs + ':' + ts, () => new THREE.TorusGeometry(R, r, rs, ts, arc));
const planeG = (w, h) => cached('q' + k3(w, h), () => new THREE.PlaneGeometry(w, h));
/** a tube along local points (a cable, a hose) */
const tubeG = (key, pts, r, seg = 16, rs = 5) => cached('u' + key, () => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(([a, b, d]) => V(a, b, d))), seg, r, rs));

// ---------------------------------------------------------------- the local frame
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _p = V(), _s = V(1, 1, 1);
/**
 * A prop's local frame (as hiveLabs.js's): u across, y up, v out from its back toward its front. Built at (x, y, z)
 * turned by `face` (a face letter or a yaw); everything it adds goes to the Kit in world space.
 */
class Frame {
  constructor(c, x, z, face, y = 0) {
    this.c = c;
    this.yaw = typeof face === 'number' ? face : YAW[face];
    this.face = typeof face === 'number' ? nearFace(face) : face;
    _e.set(0, this.yaw, 0, 'YXZ');
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
  /** a flat front-facing rectangle (2 triangles) from (u0, y0) to (u1, y1) at depth v: recessed fronts, LEDs, slots */
  quad(mat, u0, y0, u1, y1, v) {
    return this.add(mat, planeG(Math.abs(u1 - u0), Math.abs(y1 - y0)), (u0 + u1) / 2, (y0 + y1) / 2, v);
  }
  /** a box between two corners */
  span(mat, u0, y0, v0, u1, y1, v1, r = 0) {
    return this.box(mat, (u0 + u1) / 2, (y0 + y1) / 2, (v0 + v1) / 2, Math.abs(u1 - u0), Math.abs(y1 - y0), Math.abs(v1 - v0), r);
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
  /** text on the front plane at depth v (or a side: 'left' / 'right' / 'back' / a face letter / 'up') */
  label(text, u, y, v, w, h, opts = {}, side = 'front') {
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
/** the lab atlas' gauge face as a plane */
const gaugeG = (s) => cached('g' + k3(s), () => {
  const g = new THREE.PlaneGeometry(s, s);
  const [rx, ry, rw, rh] = SIGN.gauge;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (rx + uv.getX(i) * rw) / 1024, 1 - (ry + rh) / 1024 + (uv.getY(i) * rh) / 1024);
  return g;
});

// ---------------------------------------------------------------- small shared bits
/** a room title plate on the wall (a dark plate, the room's name, a coloured edge) */
function roomTitle(c, text, x, y, z, face, w = 1.6, col = '#e0b81e') {
  c.label(text, x, y, z, face, w, 0.15, { bg: '#1b2127', fg: '#e8edf0', border: col, font: 'bold 48px Arial' });
}
/** a small sticker / notice: dark text on a pale ground (or opts) */
const NOTE = { bg: '#f4f1e6', fg: '#1d2b3a', border: '#f4f1e6', font: 'bold 34px Arial' };
const WARN = { bg: '#f2c618', fg: '#111111', border: '#111111', font: 'bold 40px Arial' };
const DANGER = { bg: '#c62a22', fg: '#ffffff', border: '#ffffff', font: 'bold 40px Arial' };
const PLATE = { bg: '#20262c', fg: '#dfe6ea', border: '#20262c', font: 'bold 36px Arial' };

const MANDATORY = { bg: '#1f5fa6', fg: '#ffffff', border: '#ffffff', font: 'bold 40px Arial' };
/** a printed wall sign of a few lines in one of the styles above, w × h centred at (x, y) on the wall line (x, z) */
function sign(c, lines, x, y, z, face, w, h, style = WARN) {
  c.label(lines.join(' · '), x, y, z, face, w, h, { ...style, lines });
}

/** loose sheets on the floor round (x, z) and a paper decal under them */
function floorPapers(c, x, z, n = 5, spread = 0.8) {
  const { X, rnd } = c;
  for (let i = 0; i < n; i++) c.K.add(X.t_paper, planeG(0.21, 0.29), x + jit(c, spread), 0.002 + i * 0.0004, z + jit(c, spread), [-PI / 2, 0, rnd() * 3]);
  c.decal('paper', x, z, spread * 1.6, rnd() * 3);
}
/** spent brass on the floor round (x, z) */
function casings(c, x, z, n = 8, spread = 0.6) {
  const { X, rnd } = c;
  for (let i = 0; i < n; i++) c.K.add(X.t_brass, cylC(0.0055, 0.0055, 0.045, 5), x + jit(c, spread), 0.006, z + jit(c, spread), [PI / 2, rnd() * 6, 0, 'YXZ']);
}
/** a wall socket and a data point, the light switch: the fittings every room has */
function plate(c, x, y, z, face, kind = 'socket') {
  Fac.wallPlate(c, x, y, z, face, kind);
}

// ---------------------------------------------------------------- the server room
/**
 * A row of server cabinets over the rect, fronts toward `face`: framed doors, the kit inside (1U-4U units with their
 * LED strips, blanking plates), cable brushes on top, a row label on its end. opts: open (rack indices whose door hangs
 * open), dead (share of racks gone dark), name (the row's label, e.g. 'ROW A'), first (the first rack number).
 */
export function rackRow(c, [x0, z0, x1, z1], face, { open = [], dead = 0.1, name = null, first = 1, h = 2.1 } = {}) {
  const { M, U, X, rnd } = c;
  const alongX = face === 'n' || face === 's';
  const L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const n = Math.max(1, Math.round(L / 0.6)), wr = L / n;
  const leds = [U.ledG, U.ledG, U.ledG, U.ledB, U.ledA];
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + wr * (i + 0.5);
    const off = rnd() < dead;
    f.span(X.t_rack, u - wr / 2 + 0.004, 0.06, -D / 2, u + wr / 2 - 0.004, h, D / 2 - 0.035);
    f.span(M.dark, u - wr / 2 + 0.03, 0, -D / 2 + 0.04, u + wr / 2 - 0.03, 0.06, D / 2 - 0.06); // plinth
    // the equipment face, recessed behind the door frame
    const fv = D / 2 - 0.045;
    f.quad(M.black, u - wr / 2 + 0.03, 0.13, u + wr / 2 - 0.03, h - 0.08, fv - 0.01); // the rack's dark depth
    let y = 0.14;
    while (y < h - 0.25) {
      const uh = pick(c, [0.044, 0.089, 0.089, 0.133, 0.178, 0.178]);
      if (y + uh > h - 0.2) break;
      if (rnd() < 0.18) f.quad(M.dark, u - 0.24, y, u + 0.24, y + uh - 0.004, fv); // blanking plate
      else if (rnd() < 0.85) {
        f.quad(rnd() < 0.5 ? M.grey : X.t_upsGrey, u - 0.235, y, u + 0.235, y + uh - 0.004, fv);
        if (!off) f.quad(pick(c, leds), u - 0.2, y + uh / 2 - 0.006, u - 0.18 + rnd() * 0.12, y + uh / 2 + 0.006, fv + 0.002);
        else if (rnd() < 0.2) f.quad(U.ledR, u - 0.2, y + uh / 2 - 0.006, u - 0.185, y + uh / 2 + 0.006, fv + 0.002);
      }
      y += uh + (rnd() < 0.3 ? 0.044 : 0.002);
    }
    // the door: a frame round a perforated (see-through) panel, or swung open on its hinge
    if (open.includes(i)) {
      f.add(X.t_perf, rbox(wr - 0.02, h - 0.12, 0.02).clone().translate(-(wr - 0.02) / 2, 0, 0), u + wr / 2 - 0.01, h / 2 + 0.03, D / 2 - 0.02, [0, -1.9, 0]);
      for (let k = 0; k < 3; k++) f.add(pick(c, [X.t_cBlue, X.t_cYellow, X.t_cGrey]), tubeG('rackDrop' + k, [[0, 0, 0], [0.04 * k, -0.3, 0.12], [0.1, -0.7 - 0.1 * k, 0.05], [0.05, -0.95 - 0.05 * k, 0.16]], 0.012, 10, 4), u - 0.1 + k * 0.08, 1.6 - k * 0.15, D / 2 - 0.04);
    } else {
      for (const s of [-1, 1]) f.span(X.t_rack, u + s * (wr / 2 - 0.035) - 0.025, 0.06, D / 2 - 0.04, u + s * (wr / 2 - 0.035) + 0.025, h, D / 2 - 0.005);
      f.span(X.t_rack, u - wr / 2 + 0.01, h - 0.08, D / 2 - 0.04, u + wr / 2 - 0.01, h, D / 2 - 0.005);
      f.span(X.t_rack, u - wr / 2 + 0.01, 0.06, D / 2 - 0.04, u + wr / 2 - 0.01, 0.13, D / 2 - 0.005);
      f.box(X.t_chrome, u + wr / 2 - 0.08, 1.15, D / 2 + 0.01, 0.025, 0.2, 0.025, 0.008);
    }
    f.span(M.black, u - wr / 2 + 0.08, h, -D / 2 + 0.1, u + wr / 2 - 0.08, h + 0.04, -D / 2 + 0.3); // cable brush on top
    f.label(`R${String(first + i).padStart(2, '0')}`, u, h - 0.04, open.includes(i) ? D / 2 - 0.035 : D / 2 - 0.004, 0.09, 0.035, PLATE);
  }
  if (name) for (const s of [-1, 1]) f.label(name, s * L / 2, 1.85, 0, 0.3, 0.12, { ...PLATE, border: '#e0b81e' }, s > 0 ? 'right' : 'left');
  f.col(-L / 2, -D / 2, L / 2, D / 2, h, SURF.metal);
}

/**
 * A computer-room air conditioner against the wall at (x, z): a tall cream cabinet, three louvred door panels, the
 * controller's LCD and buttons, a top return grille, the refrigerant lines up to the ceiling, a condensate hose.
 */
export function crac(c, x, z, face, { w = 1.8, h = 1.95, d = 0.88, name = 'CRAC-01', temp = '18.4 °C', alarm = false, ceil = 3.6 } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.dark, -w / 2 + 0.03, 0, 0.03, w / 2 - 0.03, 0.08, d - 0.04);
  f.span(X.t_cream, -w / 2, 0.08, 0, w / 2, h, d, 0.02);
  for (let i = 0; i < 3; i++) {
    const u = -w / 2 + (w * (i + 0.5)) / 3;
    if (i) f.span(M.dark, u - w / 6 - 0.004, 0.12, d - 0.002, u - w / 6 + 0.004, h - 0.05, d + 0.004);
    for (let k = 0; k < 7; k++) f.box(X.t_perf, u, h - 0.42 - k * 0.075, d + 0.012, w / 3 - 0.12, 0.022, 0.03, 0, [0.5, 0, 0]);
    f.box(X.t_chrome, u + w / 6 - 0.07, 0.95, d + 0.012, 0.02, 0.16, 0.02);
  }
  // the controller: bezel, LCD, buttons, alarm lamp
  f.span(M.dark, -w / 2 + 0.1, 1.08, d, -w / 2 + 0.46, 1.32, d + 0.012);
  f.span(G.t_lcd, -w / 2 + 0.13, 1.17, d + 0.012, -w / 2 + 0.33, 1.29, d + 0.014);
  for (let k = 0; k < 4; k++) f.box(M.grey, -w / 2 + 0.15 + k * 0.05, 1.12, d + 0.016, 0.03, 0.02, 0.01);
  f.box(alarm ? U.ledR : U.ledG, -w / 2 + 0.41, 1.25, d + 0.016, 0.025, 0.025, 0.012);
  f.label(`${name} · SUPPLY ${temp}`, -w / 2 + 0.28, 1.4, d, 0.42, 0.06, PLATE);
  f.label('STANDBY UNIT · DO NOT SWITCH OFF', w / 6, 1.4, d, 0.4, 0.05, WARN);
  // the return grille on top, the refrigerant lines and a condensate hose
  f.span(X.t_perf, -w / 2 + 0.08, h, 0.08, w / 2 - 0.08, h + 0.03, d - 0.08);
  for (const [u, r] of [[-w / 2 + 0.2, 0.022], [-w / 2 + 0.3, 0.014]]) f.rod(X.t_brass, [u, h + 0.03, 0.1], [u, ceil, 0.1], r, 8);
  f.span(M.dark, w / 2 - 0.4, h, 0.04, w / 2 - 0.12, ceil, 0.24);
  f.add(M.black, tubeG('cracHose', [[0, 0, 0], [0.12, -0.05, 0.06], [0.18, -0.3, 0.02], [0.3, -0.36, 0.04]], 0.012, 8, 4), w / 2 - 0.05, 0.4, 0.05);
  f.col(-w / 2, 0, w / 2, d, h, SURF.metal);
}

/**
 * A UPS line-up against the wall at (x, z), `n` cabinets: the UPS module (its mimic LCD, buttons, status lamps, the
 * bypass switch), then battery cabinets (vent slots, DC warnings); `open`: the index of one whose door stands open on
 * its rows of battery blocks.
 */
export function upsBank(c, x, z, face, { n = 4, open = 2, load = '62 %', onBattery = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const w = 0.6, d = 0.8, h = 1.9, L = n * w;
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + w * (i + 0.5);
    f.span(M.dark, u - w / 2 + 0.02, 0, 0.02, u + w / 2 - 0.02, 0.08, d - 0.04);
    f.span(X.t_upsGrey, u - w / 2 + 0.003, 0.08, 0, u + w / 2 - 0.003, h, d, 0.012);
    if (i === 0) {
      f.span(M.black, u - 0.2, 1.3, d, u + 0.2, 1.6, d + 0.01);
      f.span(G.t_lcd, u - 0.17, 1.36, d + 0.01, u + 0.17, 1.56, d + 0.012);
      f.label(`UPS-A · ${onBattery ? 'ON BATTERY' : 'ONLINE'} · LOAD ${load}`, u, 1.21, d, 0.42, 0.06, onBattery ? WARN : PLATE);
      for (let k = 0; k < 4; k++) f.box([U.ledG, onBattery ? U.ledA : U.ledG, U.ledG, M.grey][k], u - 0.12 + k * 0.08, 1.1, d + 0.008, 0.035, 0.035, 0.012);
      // the maintenance bypass: a big rotary handle on its plate
      f.span(M.yellow, u - 0.09, 0.66, d, u + 0.09, 0.84, d + 0.006);
      f.box(M.black, u, 0.75, d + 0.03, 0.03, 0.15, 0.04, 0.01, [0, 0, 0.6]);
      f.label('BYPASS', u, 0.6, d, 0.16, 0.035, PLATE);
    } else if (i === open) {
      // the door swung open: battery blocks on three shelves, red and black posts
      f.add(X.t_upsGrey, rbox(w - 0.02, h - 0.14, 0.02).clone().translate((w - 0.02) / 2, 0, 0), u - w / 2 + 0.01, h / 2 + 0.06, d + 0.01, [0, -1.7, 0]);
      f.span(M.black, u - w / 2 + 0.03, 0.1, 0.05, u + w / 2 - 0.03, h - 0.04, d - 0.02);
      for (let s = 0; s < 3; s++) {
        const y = 0.2 + s * 0.55;
        f.span(M.steel, u - w / 2 + 0.03, y - 0.02, 0.06, u + w / 2 - 0.03, y, d - 0.04);
        for (let b = 0; b < 3; b++) {
          const bu = u - 0.18 + b * 0.18;
          f.span(M.dark, bu - 0.08, y, 0.15, bu + 0.08, y + 0.2, d - 0.08);
          f.cyl(M.red, bu - 0.04, y + 0.2, d - 0.14, 0.012, 0.012, 0.02, 6);
          f.cyl(M.black, bu + 0.04, y + 0.2, d - 0.14, 0.012, 0.012, 0.02, 6);
        }
      }
    } else {
      for (let k = 0; k < 5; k++) f.span(M.black, u - 0.2, 1.45 + k * 0.06, d, u + 0.2, 1.47 + k * 0.06, d + 0.004);
      f.box(X.t_chrome, u + 0.24, 1.0, d + 0.012, 0.02, 0.16, 0.02);
      f.label('BATTERY · 480 V DC', u, 1.25, d, 0.3, 0.05, WARN);
    }
  }
  f.label('DANGER · STORED ENERGY · ISOLATE BEFORE WORK', 0, h + 0.12, 0.004, Math.min(L, 1.5), 0.08, DANGER);
  f.col(-L / 2, 0, L / 2, d, h, SURF.metal);
}

/**
 * Clean-agent fire suppression against the wall at (x, z): `n` red cylinders in their floor bracket and wall strap,
 * valve heads, gauges, discharge hoses to a manifold that rises to the ceiling, the agent's placards.
 */
export function suppressionTanks(c, x, z, face, { n = 3, ceil = 3.6, agent = 'FM-200' } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const r = 0.17, th = 1.42, gap = 0.42, L = n * gap;
  f.span(M.dark, -L / 2, 0, 0.02, L / 2, 0.06, 0.42);
  for (const y of [0.55, 1.15]) f.span(M.steel, -L / 2, y, 0.02, L / 2, y + 0.05, 0.04);
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + gap * (i + 0.5), v = 0.22;
    f.cyl(X.t_fireRed, u, 0.06, v, r, r, th - 0.12, 14);
    f.add(X.t_fireRed, domeG(r, 12), u, th - 0.06, v, null, [1, 0.55, 1]);
    for (const y of [0.55, 1.15]) f.add(M.steel, torG(r + 0.008, 0.012, 3, 8, PI), u, y + 0.025, v, [PI / 2, 0, 0]);
    f.cyl(X.t_brass, u, th + 0.02, v, 0.05, 0.045, 0.1, 8);
    f.box(M.black, u, th + 0.17, v, 0.12, 0.1, 0.1, 0.01);
    f.gauge(u + 0.075, th + 0.17, v + 0.04, 0.07);
    f.add(M.black, tubeG('fireHose', [[0, 0, 0], [0, 0.12, -0.04], [0.02, 0.24, -0.12], [0.02, 0.3, -0.18]], 0.016, 6, 4), u, th + 0.22, v);
    f.label(`${agent} · 82 kg`, u, 0.85, v + r - 0.02, 0.2, 0.05, { ...NOTE, bg: '#ffffff' });
  }
  // the manifold along the wall, up to the ceiling, a pressure switch
  f.hcyl(M.red, 0, th + 0.52, 0.06, 0.035, L + 0.1, 10, 'u');
  f.rod(M.red, [L / 2 + 0.05, th + 0.52, 0.06], [L / 2 + 0.05, ceil, 0.06], 0.035, 10);
  f.box(M.grey, -L / 2 + 0.1, th + 0.42, 0.06, 0.1, 0.12, 0.08, 0.01);
  f.label(`FIRE SUPPRESSION · ${agent}`, 0, th + 0.85, 0.004, 0.9, 0.12, DANGER);
  f.label('DO NOT DISCHARGE WITH PERSONNEL PRESENT', 0, th + 0.72, 0.004, 0.9, 0.07, WARN);
  f.col(-L / 2, 0, L / 2, 0.42, th + 0.25, SURF.metal);
}

/** world (x, z) → the frame's (u, v) */
function toLocal(f, x, z) {
  const o = f.p(0, 0, 0), dx = x - o.x, dz = z - o.z, cy = Math.cos(f.yaw), sy = Math.sin(f.yaw);
  return [dx * cy - dz * sy, dx * sy + dz * cy];
}

/**
 * An open two-post network rack centred at (x, z), facing `face`: patch panels and switches with their LEDs, vertical
 * cable managers, patch leads looping from the ports into the managers, a bundle rising to the ceiling tray.
 */
export function patchRack(c, x, z, face, { h = 2.0, ceil = 0, mess = true } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.dark, -0.32, 0, -0.22, 0.32, 0.05, 0.22);
  for (const s of [-1, 1]) {
    f.span(M.black, s * 0.25 - 0.02, 0.05, -0.04, s * 0.25 + 0.02, h, 0.04);
    f.span(M.black, s * 0.36 - 0.06, 0.05, -0.09, s * 0.36 + 0.06, h, -0.05); // the cable manager's spine
    for (let k = 0; k < 5; k++) f.span(M.black, s * 0.36 - 0.06, 0.4 + k * 0.32, -0.05, s * 0.36 - 0.05, 0.42 + k * 0.32, 0.08);
    f.cyl(pick(c, [X.t_cBlue, X.t_cGrey]), s * 0.36, 0.05, 0, 0.035, 0.035, h - 0.05, 8);
  }
  f.span(M.black, -0.29, h - 0.04, -0.04, 0.29, h, 0.04);
  const cols = [X.t_cBlue, X.t_cBlue, X.t_cYellow, X.t_cRed, X.t_cGreen, X.t_cGrey];
  let y = 0.45, k = 0;
  while (y < h - 0.2) {
    const sw = k % 3 === 1, uh = sw ? 0.089 : 0.044;
    f.quad(sw ? M.grey : M.black, -0.24, y, 0.24, y + uh - 0.004, 0.02);
    if (sw) f.quad(U.ledG, -0.2, y + 0.02, 0.12, y + 0.03, 0.022);
    else f.quad(X.t_paper, -0.22, y + uh - 0.014, 0.22, y + uh - 0.006, 0.022);
    // leads from the ports, looping down into a side manager
    if (mess && rnd() < 0.85) {
      const s = rnd() < 0.5 ? -1 : 1, v = Math.floor(rnd() * 3);
      const t = tubeG(`patch${s}${v}`, [[0, 0, 0], [0, -0.06, 0.08 + v * 0.02], [s * 0.14, -0.14 - v * 0.05, 0.08], [s * 0.3, -0.1, 0.02], [s * 0.34, 0.0, -0.02]], 0.006, 7, 3);
      for (let j = 0; j < 2; j++) f.add(pick(c, cols), t, -0.15 * s + j * 0.05 * s, y + uh / 2, 0.02);
    }
    y += uh + 0.03;
    k++;
  }
  if (ceil > h) for (const s of [-1, 1]) f.rod(M.steel, [s * 0.2, h, -0.12], [s * 0.2, ceil, -0.12], 0.015, 6);
  if (ceil > h) f.cyl(X.t_cBlue, 0, h, -0.12, 0.05, 0.05, ceil - h, 8);
  f.col(-0.42, -0.22, 0.42, 0.22, h, SURF.metal);
}

/**
 * A technician's console desk over the rect, its sitter on the `face` side (like hiveProps.desk): a dark laminate top
 * on a steel frame, twin monitors on an arm, a KVM switch, keyboard, runbook binders, a stack of pulled drives; `keep`
 * [x0, z0, x1, z1] stays clear on the top (a pickup floats there); `purge`: the degausser and its note.
 */
export function techDesk(c, r, face, { keep = null, purge = true, chair = true, T = 0.75 } = {}) {
  const { M, U, X, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const alongX = face === 'n' || face === 's';
  const W = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  f.span(X.t_consoleTop, -W / 2, T - 0.03, -D / 2, W / 2, T, D / 2, 0.006);
  f.span(X.t_chrome, -W / 2, T - 0.03, D / 2 - 0.004, W / 2, T - 0.004, D / 2 + 0.002);
  for (const s of [-1, 1]) {
    f.span(M.steel, s * (W / 2 - 0.05) - 0.025, 0, -D / 2 + 0.05, s * (W / 2 - 0.05) + 0.025, T - 0.03, -D / 2 + 0.1);
    f.span(M.steel, s * (W / 2 - 0.05) - 0.025, 0, D / 2 - 0.1, s * (W / 2 - 0.05) + 0.025, T - 0.03, D / 2 - 0.05);
    f.span(M.steel, s * (W / 2 - 0.05) - 0.02, 0.02, -D / 2 + 0.05, s * (W / 2 - 0.05) + 0.02, 0.06, D / 2 - 0.05);
  }
  f.span(X.t_upsGrey, -W / 2 + 0.08, 0.28, -D / 2 + 0.04, W / 2 - 0.08, T - 0.03, -D / 2 + 0.06);
  f.span(M.black, -W / 2 + 0.1, T - 0.14, -D / 2 + 0.08, W / 2 - 0.1, T - 0.1, -D / 2 + 0.24); // cable tray under the top
  // where the gear goes: away from the kept spot
  const [ku] = keep ? toLocal(f, (keep[0] + keep[2]) / 2, (keep[1] + keep[3]) / 2) : [-W];
  const side = ku < 0 ? 1 : -1;
  const mu = side * (W / 2 - 0.55);
  f.cyl(M.dark, mu, T, -D / 2 + 0.1, 0.06, 0.06, 0.02, 10);
  f.cyl(M.steel, mu, T + 0.02, -D / 2 + 0.1, 0.018, 0.018, 0.42, 8);
  for (const s of [-1, 1]) {
    f.span(M.dark, mu + s * 0.02, T + 0.33, -D / 2 + 0.09, mu + s * 0.2, T + 0.35, -D / 2 + 0.12);
    f.box(M.black, mu + s * 0.27, T + 0.34, -D / 2 + 0.15, 0.5, 0.31, 0.03, 0.006, [0, -s * 0.15, 0]);
    const p = f.p(mu + s * 0.27 + s * 0.0, T + 0.34, -D / 2 + 0.167);
    c.screen(p.x, p.y, p.z, f.yaw - s * 0.15, 0.46, 0.27, rnd() < 0.7);
  }
  f.span(X.t_rack, mu - 0.22, T + 0.012, -D / 2 + 0.3, mu + 0.22, T + 0.034, -D / 2 + 0.45); // keyboard
  f.span(M.grey, mu - 0.2, T + 0.034, -D / 2 + 0.31, mu + 0.2, T + 0.038, -D / 2 + 0.44);
  f.box(X.t_rack, mu + 0.32, T + 0.012, -D / 2 + 0.38, 0.06, 0.025, 0.1, 0.01);
  f.box(M.black, mu - side * 0.42, T + 0.03, -D / 2 + 0.12, 0.24, 0.05, 0.12, 0.008); // the KVM switch
  for (let k = 0; k < 4; k++) f.box(k === 1 ? U.ledG : M.grey, mu - side * 0.42 - 0.08 + k * 0.05, T + 0.04, -D / 2 + 0.181, 0.02, 0.012, 0.004);
  // runbooks between bookends at the far end, a mug, papers
  const bu = -side * (W / 2 - 0.25);
  for (let k = 0; k < 5; k++) f.box(pick(c, [X.t_bRed, X.t_bBlue, X.t_bBlack]), bu - 0.12 + k * 0.055, T + 0.15, -D / 2 + 0.17, 0.05, 0.29, 0.25, 0, [0, 0, k === 4 ? -0.35 : 0]);
  if (purge) {
    // somebody was wiping the drives: the degausser, a stack of pulled disks, the note
    f.box(X.t_upsGrey, mu + side * 0.1, T + 0.07, -D / 2 + 0.62, 0.3, 0.14, 0.24, 0.015);
    f.label('DEGAUSSER', mu + side * 0.1, T + 0.08, -D / 2 + 0.74, 0.18, 0.04, PLATE);
    for (let k = 0; k < 4; k++) f.box(M.grey, mu + side * 0.4 + jit(c, 0.01), T + 0.012 + k * 0.026, -D / 2 + 0.62 + jit(c, 0.01), 0.1, 0.025, 0.146, 0, [0, jit(c, 0.2), 0]);
    f.label('PURGE ALL ARRAYS · AUTH. DIR.', mu, T + 0.002, -D / 2 + 0.6, 0.21, 0.15, { ...NOTE, lines: ['PURGE ALL', 'ARRAYS', 'AUTH. DIR.'] }, 'up');
  }
  const mp = f.p(mu - side * 0.15, 0, -D / 2 + 0.6);
  Fac.mug(c, mp.x, T, mp.z);
  if (chair) {
    const p = f.p(mu + jit(c, 0.15), 0, D / 2 + 0.38);
    Fac.officeChair(c, p.x, p.z, f.yaw + PI + jit(c, 0.4));
  }
  f.col(-W / 2, -D / 2, W / 2, D / 2, T, SURF.metal);
}

// ---------------------------------------------------------------- the security office
/**
 * A wall of monitors at (x, z) facing `face`: `cols` × `rows` screens on unistrut rails from height y0, each a bezel
 * with its status LED and a picture: a CCTV feed card (`feeds[i]`: [camera, place]), a live UI screen, or dark;
 * `smashed` screens took a round. A header plate over it.
 */
export function monitorWall(c, x, z, face, { cols = 3, rows = 3, mw = 0.64, mh = 0.38, y0 = 1.1, feeds = [], dark = [], smashed = [], title = null } = {}) {
  const { M, U, X, G, rnd } = c;
  const f = new Frame(c, x, z, face);
  const gw = mw + 0.04, gh = mh + 0.04, W = cols * gw;
  for (const y of [y0 + 0.1, y0 + rows * gh - 0.1]) f.span(X.t_upsGrey, -W / 2 - 0.05, y - 0.02, 0, W / 2 + 0.05, y + 0.02, 0.04);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const u = -W / 2 + gw * (i + 0.5), y = y0 + gh * (j + 0.5);
      f.box(M.black, u, y, 0.07, mw, mh, 0.05, 0.008);
      f.quad(M.dark, u - mw / 2 + 0.02, y - mh / 2 - 0.0, u + mw / 2 - 0.02, y - mh / 2 + 0.018, 0.0955);
      const off = dark.includes(k) || smashed.includes(k);
      f.quad(off ? U.ledR : U.ledG, u + mw / 2 - 0.05, y - mh / 2 + 0.006, u + mw / 2 - 0.04, y - mh / 2 + 0.012, 0.0965);
      const sw = mw - 0.04, sh = mh - 0.05;
      if (off) {
        f.quad(M.black, u - sw / 2, y - sh / 2 + 0.01, u + sw / 2, y + sh / 2 + 0.01, 0.0955);
        if (smashed.includes(k)) {
          const p = f.p(u + jit(c, 0.08), y + jit(c, 0.05), 0.083);
          c.wallDecal('bullet', p.x, p.y, p.z, f.face, 0.22, 0.22);
        }
      } else if (feeds[k]) {
        // a camera picture: the grey-green feed, the dark floor and a doorway in it, the caption and the REC dot
        const [cam, place] = feeds[k];
        const yb = y - sh / 2 + 0.01;
        f.quad(G.t_feed, u - sw / 2, yb, u + sw / 2, yb + sh, 0.0955);
        f.quad(M.dark, u - sw / 2, yb, u + sw / 2, yb + sh * (0.25 + rnd() * 0.15), 0.096);
        const du = jit(c, sw * 0.3);
        f.quad(M.black, u + du - 0.04, yb + sh * 0.3, u + du + 0.04, yb + sh * 0.7, 0.096);
        f.label(`${cam} · ${place}`, u - sw / 2 + 0.15, yb + sh - 0.03, 0.0965, 0.28, 0.04, { bg: '#26332d', fg: '#c9e6d2', border: '#26332d', font: 'bold 28px Courier New' });
        f.quad(U.ledR, u + sw / 2 - 0.05, yb + sh - 0.04, u + sw / 2 - 0.03, yb + sh - 0.02, 0.0965);
      } else f.screen(u, y + 0.01, 0.0965, sw, sh, true);
    }
  }
  if (title) f.label(title, 0, y0 + rows * gh + 0.1, 0.004, Math.min(W, 1.2), 0.09, { ...PLATE, border: '#e0b81e' });
}

/** an upright rifle standing on its butt at (u, y, v) of the frame, its side to the front; kind 'rifle' | 'shotgun' */
function rifle(c, f, u, y, v, kind = 'rifle', lean = 0) {
  const { X } = c;
  const r = lean ? [0, 0, lean] : null;
  const at = (du, dy) => [u + du * Math.cos(lean) - dy * Math.sin(lean), y + dy * Math.cos(lean) + du * Math.sin(lean)];
  const part = (mat, du, dy, w, h, d, rz = 0) => {
    const [pu, py] = at(du, dy);
    f.box(mat, pu, py, v, w, h, d, 0, [0, 0, lean + rz]);
  };
  part(X.t_polymer, 0, 0.16, 0.11, 0.3, 0.045);
  part(X.t_gun, -0.005, 0.45, 0.07, 0.3, 0.04);
  part(X.t_polymer, 0.06, 0.34, 0.07, 0.05, 0.035, 0.4);
  if (kind === 'rifle') {
    part(X.t_polymer, 0.1, 0.53, 0.16, 0.065, 0.028, -0.25);
    part(X.t_gun, -0.045, 0.55, 0.02, 0.16, 0.026);
    part(X.t_polymer, 0, 0.72, 0.055, 0.26, 0.05);
    const [bu, by] = at(0, 0.85);
    f.add(X.t_gun, cylG(0.011, 0.011, 0.18, 6), bu, by, v, r);
  } else {
    part(X.t_polymer, 0.02, 0.72, 0.05, 0.2, 0.05);
    const [bu, by] = at(-0.005, 0.6);
    f.add(X.t_gun, cylG(0.014, 0.014, 0.42, 6), bu, by, v, r);
  }
}

/**
 * A wall rifle rack at (x, z) facing `face`: a steel back, the butt trough, `n` slots, a lock bar and padlock across;
 * `guns`: per slot 'rifle' | 'shotgun' | null (signed out). Slot numbers, the sign-out sheet beside it.
 */
export function weaponRack(c, x, z, face, { n = 6, guns = null, locked = false } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const gap = 0.24, L = n * gap + 0.1;
  f.span(X.t_safe, -L / 2, 0.3, 0, L / 2, 1.75, 0.03);
  f.span(X.t_safe, -L / 2, 0.3, 0.03, L / 2, 0.45, 0.3, 0.01); // the butt trough
  f.span(X.t_safe, -L / 2, 1.18, 0.03, L / 2, 1.22, 0.2); // the barrel rest
  for (let i = 0; i <= n; i++) f.span(M.dark, -L / 2 + 0.05 + i * gap - 0.008, 1.12, 0.12, -L / 2 + 0.05 + i * gap + 0.008, 1.22, 0.2);
  const g = guns ?? Array.from({ length: n }, (_, i) => (i % 3 === 2 ? 'shotgun' : 'rifle'));
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + 0.05 + gap * (i + 0.5);
    f.label(String(i + 1).padStart(2, '0'), u, 0.38, 0.3, 0.07, 0.05, PLATE);
    if (g[i]) rifle(c, f, u, 0.45, 0.16, g[i]);
  }
  // the lock bar: across when locked, else swung up on its hinge
  if (locked) f.span(M.steel, -L / 2, 0.98, 0.24, L / 2, 1.02, 0.27);
  else f.add(M.steel, rbox(L, 0.03, 0.03).clone().translate(L / 2, 0, 0), -L / 2 + 0.02, 1.0, 0.26, [0, 0, 0.32]);
  f.box(X.t_brass, -L / 2 + 0.04, 0.92, 0.27, 0.05, 0.06, 0.02);
  f.label('ARMS RACK B · SIGN OUT EVERY WEAPON', 0, 1.88, 0.004, 1.0, 0.08, { ...PLATE, border: '#c62a22' });
  f.label('SIGN-OUT', L / 2 + 0.17, 1.3, 0.004, 0.2, 0.28, { ...NOTE, font: 'bold 26px Courier New', lines: ['SIGN-OUT', '01 KOVAC', '02 REYES', '04 OKAFOR', '05 ?? ', '06 MILLER'], align: 'left' });
  f.col(-L / 2, 0, L / 2, 0.32, 1.75, SURF.metal);
}

/**
 * A tall gun safe against the wall at (x, z) facing `face`: keypad and spoked handle, hinges, the safe's plate;
 * `open` (radians): the door swung on its left hinge, the interior on show (a shelf of ammo cans, `rifles` left in it).
 */
export function gunLocker(c, x, z, face, { w = 0.62, d = 0.52, h = 1.8, open = 0, rifles = 0, name = 'SAFE 2' } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.dark, -w / 2 + 0.02, 0, 0.02, w / 2 - 0.02, 0.05, d - 0.02);
  f.span(X.t_safe, -w / 2, 0.05, 0, w / 2, h, d - 0.05, 0.015);
  for (const y of [0.4, h - 0.35]) f.cyl(M.steel, -w / 2 + 0.01, y, d - 0.03, 0.018, 0.018, 0.14, 8);
  // the door, its keypad and handle (in the door's own frame: hinged on the left edge)
  const hp = f.p(-w / 2 + 0.01, 0, d - 0.03);
  const g = new Frame(c, hp.x, hp.z, f.yaw - open);
  g.span(X.t_safe, 0, 0.07, 0, w - 0.02, h - 0.02, 0.05, 0.01);
  g.span(M.black, w / 2 + 0.07, 1.12, 0.05, w / 2 + 0.19, 1.3, 0.06);
  for (let k = 0; k < 6; k++) g.quad(M.grey, w / 2 + 0.085 + (k % 3) * 0.035, 1.14 + Math.floor(k / 3) * 0.04, w / 2 + 0.11 + (k % 3) * 0.035, 1.17 + Math.floor(k / 3) * 0.04, 0.0605);
  g.quad(open ? U.ledG : U.ledR, w / 2 + 0.17, 1.27, w / 2 + 0.18, 1.28, 0.0605);
  g.add(X.t_chrome, cylC(0.03, 0.03, 0.05, 10), w / 2 - 0.02, 0.95, 0.075, [PI / 2, 0, 0]);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2 + 0.3;
    g.rod(X.t_chrome, [w / 2 - 0.02, 0.95, 0.09], [w / 2 - 0.02 + Math.cos(a) * 0.11, 0.95 + Math.sin(a) * 0.11, 0.1], 0.009, 5);
  }
  g.label(name, w / 2 - 0.01, 1.55, 0.05, 0.22, 0.06, PLATE);
  if (open) {
    f.quad(M.black, -w / 2 + 0.04, 0.1, w / 2 - 0.04, h - 0.05, d - 0.05);
    f.span(M.steel, -w / 2 + 0.03, h - 0.42, 0.04, w / 2 - 0.03, h - 0.4, d - 0.06);
    for (let k = 0; k < 2; k++) f.box(X.t_upsGrey, -0.14 + k * 0.27, h - 0.3, d / 2, 0.24, 0.17, 0.13, 0.01);
    for (let k = 0; k < rifles; k++) rifle(c, f, -0.15 + k * 0.16, 0.06, d / 2 - 0.05, 'rifle', 0.05);
  }
  f.col(-w / 2, 0, w / 2, d, h, SURF.metal);
}

/**
 * A key cabinet on the wall at (x, y = its centre height, z) facing `face`: steel box, rows of hooks with tagged keys
 * (a share of them `taken`), the glazed door swung open, the control plate.
 */
export function keyCabinet(c, x, y, z, face, { w = 0.46, h = 0.56, open = 1.6, taken = 0.35 } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const d = 0.09;
  f.span(X.t_upsGrey, -w / 2, y - h / 2, 0, w / 2, y + h / 2, d, 0.008);
  f.quad(M.dark, -w / 2 + 0.02, y - h / 2 + 0.02, w / 2 - 0.02, y + h / 2 - 0.06, d + 0.001);
  const tags = [U.ledR, M.yellow, M.blue, M.green, M.white];
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 6; i++) {
      const u = -w / 2 + 0.05 + i * ((w - 0.1) / 5), yy = y + h / 2 - 0.12 - j * 0.11;
      f.box(M.steel, u, yy, d + 0.01, 0.006, 0.006, 0.02);
      if (rnd() < taken) continue;
      f.box(X.t_brass, u, yy - 0.03, d + 0.012, 0.012, 0.04, 0.003, 0, [0, 0, jit(c, 0.2)]);
      f.quad(pick(c, tags), u - 0.012, yy - 0.075, u + 0.012, yy - 0.05, d + 0.016);
    }
  }
  f.label('KEY CONTROL', 0, y + h / 2 - 0.035, d + 0.002, w - 0.06, 0.045, PLATE);
  // the door: an aluminium frame round a pane, swung on its left edge
  const p = f.p(-w / 2, 0, d);
  const g = new Frame(c, p.x, p.z, f.yaw - open);
  for (const [u0, u1, y0, y1] of [[0, 0.02, -h / 2, h / 2], [w - 0.02, w, -h / 2, h / 2], [0, w, -h / 2, -h / 2 + 0.02], [0, w, h / 2 - 0.02, h / 2]]) g.span(X.t_chrome, u0, y + y0, 0, u1, y + y1, 0.015);
  g.quad(c.U.glass, 0.02, y - h / 2 + 0.02, w - 0.02, y + h / 2 - 0.02, 0.008);
}

/**
 * A multi-bay radio charger on a surface at (x, y, z) turned `yaw`: `n` cups with their LEDs, handheld radios in the
 * ones not `taken` (antenna, knob, a belt clip), the unit's label.
 */
export function radioCharger(c, x, y, z, yaw = 0, { n = 6, taken = [1, 2, 4] } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, yaw, y);
  const gap = 0.085, L = n * gap + 0.04;
  f.box(X.t_polymer, 0, 0.03, 0, L, 0.06, 0.14, 0.01);
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + 0.02 + gap * (i + 0.5);
    f.box(M.black, u, 0.07, -0.01, 0.07, 0.04, 0.06);
    const has = !taken.includes(i);
    f.quad(has ? (i % 3 ? U.ledG : U.ledA) : U.ledR, u - 0.006, 0.035, u + 0.006, 0.045, 0.0705);
    if (!has) continue;
    f.box(X.t_polymer, u, 0.15, -0.01, 0.058, 0.16, 0.036, 0.008);
    f.quad(M.dark, u - 0.02, 0.12, u + 0.02, 0.17, 0.0085);
    f.cyl(M.black, u + 0.018, 0.23, -0.01, 0.006, 0.004, 0.12, 5);
    f.cyl(M.dark, u - 0.015, 0.23, -0.01, 0.009, 0.009, 0.015, 6);
  }
  f.label(`RADIOS · CH 1-${n} · RETURN TO CHARGE`, 0, 0.03, 0.0705, L - 0.04, 0.03, PLATE);
}

/**
 * A detainee bench bolted to the wall at (x, z) facing `face`, `len` long: a steel seat on wall brackets, the cuff rail
 * along the wall with its rings; `cuffs`: a pair left locked to the rail, the other bracelet open (whoever wore it got out).
 */
export function holdingBench(c, x, z, face, { len = 1.8, cuffs = true } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.span(M.steel, -len / 2, 0.42, 0.02, len / 2, 0.46, 0.42, 0.008);
  f.span(M.steel, -len / 2, 0.36, 0.38, len / 2, 0.46, 0.42);
  for (const u of [-len / 2 + 0.12, 0, len / 2 - 0.12]) {
    f.span(M.dark, u - 0.02, 0.1, 0, u + 0.02, 0.42, 0.06);
    f.rod(M.dark, [u, 0.12, 0.03], [u, 0.42, 0.36], 0.015, 5);
    f.cyl(X.t_chrome, u, 0.46, 0.2, 0.012, 0.012, 0.004, 6);
  }
  // the cuff rail: a bar on standoffs, rings along it
  f.hcyl(X.t_chrome, 0, 0.72, 0.07, 0.016, len - 0.1, 8, 'u');
  for (const u of [-len / 2 + 0.1, len / 2 - 0.1]) f.span(M.dark, u - 0.03, 0.68, 0, u + 0.03, 0.76, 0.07);
  for (let k = 0; k < 3; k++) f.add(X.t_chrome, torG(0.035, 0.007, 4, 10), -len / 3 + k * (len / 3), 0.68, 0.075, [0, PI / 2, 0]);
  if (cuffs) {
    f.add(X.t_chrome, torG(0.032, 0.006, 4, 10), -len / 3 + 0.04, 0.64, 0.085, [0.3, 0.2, 0]);
    f.rod(X.t_chrome, [-len / 3 + 0.04, 0.61, 0.09], [-len / 3 + 0.08, 0.52, 0.12], 0.003, 3);
    f.add(X.t_chrome, torG(0.032, 0.006, 4, 10, PI * 1.4), -len / 3 + 0.09, 0.49, 0.14, [1.2, 0.4, 0]);
  }
  f.label('DETAINEES · DO NOT LEAVE UNATTENDED', 0, 1.25, 0.004, 0.9, 0.08, WARN);
  f.col(-len / 2, 0, len / 2, 0.42, 0.46, SURF.metal);
}

/**
 * A walk-through metal detector centred at (x, z), its passage running along `face`: two zoned side panels with LED
 * bars, the header with its display and alarm lamp, floor plates, the queue notice. A collider per side panel.
 */
export function metalDetector(c, x, z, face, { w = 0.82, h = 2.12, d = 0.56, on = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  for (const s of [-1, 1]) {
    const u = s * (w / 2 + 0.06);
    f.box(X.t_ivory, u, (h - 0.14) / 2, 0, 0.12, h - 0.14, d, 0.02);
    f.box(M.dark, u, 0.02, 0, 0.2, 0.04, d + 0.12, 0.01);
    for (let k = 0; k < 6; k++) f.add(on && k < 2 ? U.ledG : M.dark, planeG(0.02, 0.1), u - s * 0.061, 0.35 + k * 0.24, d / 2 - 0.08, [0, -s * PI / 2, 0]);
    f.label('ZONE', u, 1.95, d / 2, 0.1, 0.04, PLATE);
  }
  f.box(X.t_ivory, 0, h - 0.07, 0, w + 0.24, 0.14, d, 0.02);
  f.span(M.black, -0.22, h - 0.12, d / 2, 0.22, h - 0.03, d / 2 + 0.01);
  f.span(on ? G.t_lcdGreen : M.dark, -0.18, h - 0.105, d / 2 + 0.01, 0.05, h - 0.045, d / 2 + 0.012);
  f.box(on ? U.ledR : M.dark, 0.14, h - 0.075, d / 2 + 0.012, 0.04, 0.04, 0.01);
  f.label('WALK THROUGH · ONE AT A TIME', 0, h - 0.07, -d / 2, 0.62, 0.08, PLATE, 'back');
  for (const s of [-1, 1]) {
    const u = s * (w / 2 + 0.06);
    f.col(u - 0.06, -d / 2, u + 0.06, d / 2, h, SURF.metal);
  }
}

// ---------------------------------------------------------------- operations
/** the plan of `spaces` drawn into a w × h rect of the frame at (u, y) on the front plane v (one box per space) */
function drawPlan(f, spaces, u, y, v, w, h, mat, hotMat, hot = [], here = null, hereMat = null) {
  let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
  for (const s of spaces) {
    ax0 = Math.min(ax0, s.x0);
    az0 = Math.min(az0, s.z0);
    ax1 = Math.max(ax1, s.x1);
    az1 = Math.max(az1, s.z1);
  }
  const k = Math.min(w / (ax1 - ax0), h / (az1 - az0));
  const mx = (ax0 + ax1) / 2, mz = (az0 + az1) / 2;
  // (north, -z, at the top of the picture)
  for (const s of spaces) {
    const m = s.id === here && hereMat ? hereMat : hot.includes(s.id) ? hotMat : mat;
    f.quad(m, u + (s.x0 - mx) * k + 0.004, y - (s.z1 - mz) * k + 0.004, u + (s.x1 - mx) * k - 0.004, y - (s.z0 - mz) * k - 0.004, v);
  }
  return { k, mx, mz };
}

/**
 * The operations room's situation wall at (x, z) facing `face`, `w` wide: the big plan display of the complex
 * (`spaces`, the `hot` ones flashing red, `here` marked), monitor banks either side (live screens, feeds, an alert),
 * the alert ticker under it, a row of clocks, the header, an equipment credenza along its foot.
 */
export function situationWall(c, x, z, face, { w = 6.0, spaces = [], hot = [], here = null, ceil = 3.4 } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const y0 = 0.95, H = Math.min(2.05, ceil - 1.25);
  f.span(X.t_rack, -w / 2, y0 - 0.05, 0, w / 2, y0 + H + 0.05, 0.06);
  // the plan display in the middle
  const pw = Math.min(2.7, w * 0.45), ph = H - 0.32;
  f.span(M.black, -pw / 2 - 0.03, y0 + 0.27, 0.06, pw / 2 + 0.03, y0 + H, 0.09);
  f.quad(X.t_board, -pw / 2, y0 + 0.3, pw / 2, y0 + H - 0.03, 0.0905);
  if (spaces.length) drawPlan(f, spaces, 0, y0 + 0.3 + (ph - 0.03) / 2, 0.0915, pw - 0.16, ph - 0.16, G.t_mapRoom, G.t_mapHot, hot, here, U.ledA);
  for (const t of [0.25, 0.5, 0.75]) {
    f.quad(M.dark, -pw / 2, y0 + 0.3 + (ph - 0.03) * t - 0.003, pw / 2, y0 + 0.3 + (ph - 0.03) * t + 0.003, 0.092);
    f.quad(M.dark, -pw / 2 + pw * t - 0.003, y0 + 0.3, -pw / 2 + pw * t + 0.003, y0 + H - 0.03, 0.092);
  }
  // the ticker
  f.span(M.black, -pw / 2 - 0.03, y0 + 0.04, 0.06, pw / 2 + 0.03, y0 + 0.24, 0.09);
  f.label('ALERT ▸ CONTAINMENT BREACH · SECTOR 4 · NORTH WING SEALED · SURFACE LINK LOST', 0, y0 + 0.14, 0.09, Math.min(2.1, pw - 0.04), 0.09, { bg: '#120c06', fg: '#ffb020', border: '#120c06', font: 'bold 34px Courier New' });
  // the monitor banks either side
  const bw = (w - pw) / 2 - 0.12;
  const cols = Math.max(1, Math.floor(bw / 0.68));
  for (const s of [-1, 1]) {
    const p = f.p(s * (pw / 2 + 0.06 + bw / 2), 0, 0.06);
    monitorWall(c, p.x, p.z, face, {
      cols, rows: 3, mw: 0.62, mh: 0.36, y0: y0 + 0.08,
      feeds: s < 0 ? [null, ['CAM 11', 'HOLDING'], null, ['CAM 14', 'SPECIMEN'], null, null] : [['CAM 02', 'ATRIUM'], null, null, ['CAM 21', 'N2 RING'], null, null],
      dark: s < 0 ? [4] : [2, 2 * cols], smashed: [],
    });
  }
  // the alert: the right bank's top-left screen given over to it
  const au = pw / 2 + 0.06 + bw / 2 - ((cols - 1) * 0.66) / 2;
  f.label('LOCKDOWN', au, y0 + 0.08 + 0.4 * 2.5, 0.17, 0.52, 0.27, { bg: '#7a0d0a', fg: '#ffffff', border: '#ff3b2a', lines: ['LOCKDOWN', 'PROTOCOL 7'], font: 'bold 54px Arial' });
  // clocks, the header
  const names = ['LOCAL', 'UTC', 'SURFACE'];
  for (let i = 0; i < 3; i++) {
    const u = -0.7 + i * 0.7;
    const p = f.p(u, 0, 0.06), cy = Math.min(ceil - 0.14, y0 + H + 0.16);
    L.wallClock(c, p.x, cy, p.z, face, 0.1);
    f.label(names[i], u + 0.2, cy, 0.064, 0.2, 0.05, PLATE);
  }
  f.label('OPERATIONS · SUBLEVEL 4', -w / 2 + 0.6, Math.min(ceil - 0.14, y0 + H + 0.16), 0.064, 1.0, 0.1, { ...PLATE, border: '#2fb8c8' });
  // the credenza under it: rack units behind vented doors
  f.span(X.t_console, -w / 2 + 0.1, 0.06, 0.06, w / 2 - 0.1, y0 - 0.12, 0.5, 0.01);
  f.span(M.dark, -w / 2 + 0.12, 0, 0.08, w / 2 - 0.12, 0.06, 0.46);
  f.span(X.t_consoleTop, -w / 2 + 0.08, y0 - 0.12, 0.06, w / 2 - 0.08, y0 - 0.09, 0.52);
  const nd = Math.round((w - 0.2) / 0.6);
  for (let i = 0; i < nd; i++) {
    const u = -w / 2 + 0.1 + ((w - 0.2) * (i + 0.5)) / nd;
    f.quad(X.t_perf, u - 0.27, 0.14, u + 0.27, y0 - 0.2, 0.501);
    f.quad(i % 3 ? U.ledG : U.ledA, u + 0.2, y0 - 0.26, u + 0.22, y0 - 0.24, 0.502);
  }
  f.light(0, y0 + H * 0.6, 0.6, 0.45, 2.4, [0.45, 0.75, 1.0], null, 5.5);
  f.col(-w / 2 + 0.1, 0, w / 2 - 0.1, 0.52, y0 - 0.09, SURF.metal);
}

/** a raised floor platform over the rect, `y` high: a carpet top, a hazard nosing and a blue step light along `face` */
export function riser(c, [x0, z0, x1, z1], face, { y = 0.2 } = {}) {
  const { M, U, X } = c;
  c.K.box(X.t_console, x0, 0, z0, x1, y - 0.01, z1, { faces: ['px', 'nx', 'pz', 'nz'] });
  c.K.box(X.t_carpet, x0, y - 0.01, z0, x1, y, z1, { faces: ['py', 'px', 'nx', 'pz', 'nz'] });
  const alongX = face === 'n' || face === 's';
  const e = face === 'n' ? z0 : face === 's' ? z1 : face === 'w' ? x0 : x1, s = face === 'n' || face === 'w' ? -1 : 1;
  if (alongX) {
    c.K.box(M.hazard, x0, y - 0.004, e - s * 0.06, x1, y + 0.002, e, { faces: ['py'] });
    c.K.box(U.ledB, x0 + 0.05, y * 0.25, e - 0.004, x1 - 0.05, y * 0.25 + 0.012, e + 0.004, { faces: [s > 0 ? 'pz' : 'nz'] });
  } else {
    c.K.box(M.hazard, e - s * 0.06, y - 0.004, z0, e, y + 0.002, z1, { faces: ['py'] });
    c.K.box(U.ledB, e - 0.004, y * 0.25, z0 + 0.05, e + 0.004, y * 0.25 + 0.012, z1 - 0.05, { faces: [s > 0 ? 'px' : 'nx'] });
  }
  c.col(x0, 0, z0, x1, y, z1, SURF.wood);
}

/** a task chair at (x, y, z), its sitter looking toward `yaw` (`down`: knocked over on its back); y: a riser's top */
export function opsChair(c, x, y, z, yaw, { down = false, mat = null } = {}) {
  const { M, X } = c;
  const m = mat ?? X.t_carpet;
  const f = new Frame(c, x, z, yaw, y);
  if (down) {
    // tipped over backward: the back flat on the floor, the seat on edge, the star base standing up
    f.box(m, 0, 0.04, -1.16, 0.44, 0.06, 0.58, 0.02);
    f.box(m, 0, 0.3, -0.77, 0.48, 0.46, 0.07, 0.02);
    f.hcyl(M.steel, 0, 0.3, -0.55, 0.022, 0.36, 6, 'v');
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2 + 0.3;
      f.box(M.black, Math.sin(a) * 0.15, 0.3 + Math.cos(a) * 0.14, -0.35, 0.04, 0.28, 0.03, 0, [0, 0, -a]);
    }
    return;
  }
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * PI * 2;
    f.box(M.black, Math.sin(a) * 0.15, 0.06, Math.cos(a) * 0.15, 0.04, 0.03, 0.3, 0, [0, a, 0]);
    f.box(X.t_rubber, Math.sin(a) * 0.29, 0.025, Math.cos(a) * 0.29, 0.04, 0.05, 0.04);
  }
  f.cyl(M.steel, 0, 0.07, 0, 0.022, 0.022, 0.36, 8);
  f.box(m, 0, 0.47, 0.02, 0.48, 0.07, 0.46, 0.02);
  f.box(m, 0, 0.86, -0.24, 0.44, 0.58, 0.06, 0.02, [-0.12, 0, 0]);
  for (const s of [-1, 1]) f.box(M.black, s * 0.25, 0.64, 0.02, 0.05, 0.03, 0.26);
}

/**
 * The red hotline phone on a surface at (x, y, z) turned `yaw`: no dial, the handset in its cradle (or `off` it, lying
 * beside), the coiled cord, the line lamp, its plate.
 */
export function redPhone(c, x, y, z, yaw = 0, { off = false, lit = true } = {}) {
  const { M, G } = c;
  const f = new Frame(c, x, z, yaw, y);
  f.box(M.red, 0, 0.035, 0, 0.2, 0.07, 0.22, 0.02);
  f.box(M.red, 0, 0.075, -0.03, 0.17, 0.03, 0.12);
  for (const s of [-1, 1]) f.box(M.dark, s * 0.07, 0.095, -0.03, 0.025, 0.02, 0.05);
  const hu = off ? 0.2 : 0, hv = off ? 0.12 : -0.03, hy = off ? 0.02 : 0.115, hr = off ? 0.9 : 0;
  f.box(M.red, hu, hy, hv, 0.05, 0.035, 0.24, 0.015, [0, PI / 2 + hr, 0]);
  for (const e of [-1, 1]) f.box(M.red, hu + Math.cos(hr) * e * 0.1, hy - 0.012, hv - Math.sin(hr) * e * 0.1, 0.07, 0.04, 0.06, 0, [0, hr, 0]);
  const helix = [];
  for (let i = 0; i <= 32; i++) {
    const t = i / 32, a = t * PI * 2 * 7;
    helix.push([-0.1 - t * 0.12 + Math.cos(a) * 0.012, 0.03 + Math.sin(a) * 0.012 - Math.sin(t * PI) * 0.02, -0.02 + t * 0.14]);
  }
  f.add(M.black, tubeG('phoneCord', helix, 0.0035, 42, 3), 0, 0, 0);
  f.add(lit ? G.t_alarm : M.dark, domeG(0.014, 8), 0.07, 0.07, 0.07);
  f.label('SURFACE · DIRECT', -0.02, 0.035, 0.1105, 0.13, 0.03, { ...PLATE, bg: '#f4f1e6', fg: '#8a1410', border: '#f4f1e6' });
}

/**
 * A console desk row centred at (x, z), its operators on the `face` side, `len` long, standing on a riser of height y:
 * the cabinet with its knee space, a rounded top with a rubber edge, the raised back with status buttons, per station
 * two monitors, a keyboard, a phone (or the red phone at station `red`), a headset, mugs and papers, its chair.
 */
export function consoleRow(c, x, z, face, len, { y = 0, stations = 3, red = -1, down = -1, name = 'OPS' } = {}) {
  const { M, U, X, rnd } = c;
  const f = new Frame(c, x, z, face, y);
  const T = 0.76, D = 0.9;
  f.span(X.t_console, -len / 2 + 0.02, 0.06, -D / 2, len / 2 - 0.02, T - 0.04, -0.02, 0.01);
  f.span(M.dark, -len / 2 + 0.05, 0, -D / 2 + 0.03, len / 2 - 0.05, 0.06, -0.05);
  for (const s of [-1, 1]) {
    f.span(X.t_console, s * len / 2 - 0.03, 0, -D / 2, s * len / 2 + 0.03, T - 0.04, D / 2 - 0.05);
    f.label(`${name}-${s < 0 ? 1 : stations}`, s * len / 2, 0.55, D / 4, 0.16, 0.05, PLATE, s > 0 ? 'right' : 'left');
  }
  f.span(X.t_consoleTop, -len / 2 - 0.02, T - 0.04, -D / 2, len / 2 + 0.02, T, D / 2, 0.012);
  f.span(X.t_rubber, -len / 2 - 0.02, T - 0.035, D / 2, len / 2 + 0.02, T - 0.005, D / 2 + 0.02);
  f.span(X.t_console, -len / 2, T, -D / 2, len / 2, T + 0.2, -D / 2 + 0.16, 0.01);
  const sw = len / stations;
  for (let i = 0; i < stations; i++) {
    const u = -len / 2 + sw * (i + 0.5);
    for (let k = 0; k < 6; k++) f.quad(k === 2 ? U.ledA : k % 2 ? U.ledG : M.grey, u - 0.25 + k * 0.1, T + 0.12, u - 0.22 + k * 0.1, T + 0.15, -D / 2 + 0.161);
    for (const s of [-1, 1]) {
      const mu = u + s * 0.27;
      f.box(M.dark, mu, T + 0.21, -D / 2 + 0.08, 0.06, 0.02, 0.1);
      f.box(M.dark, mu, T + 0.3, -D / 2 + 0.09, 0.03, 0.18, 0.02);
      f.box(M.black, mu, T + 0.47, -D / 2 + 0.11, 0.52, 0.31, 0.03, 0, [0, -s * 0.12, 0]);
      const p = f.p(mu + s * 0.002, T + 0.47, -D / 2 + 0.127);
      c.screen(p.x, p.y, p.z, f.yaw - s * 0.12, 0.48, 0.27, rnd() < 0.8);
    }
    f.box(X.t_rack, u + jit(c, 0.05), T + 0.012, 0.08, 0.44, 0.024, 0.15, 0, [0, jit(c, 0.08), 0]);
    f.box(X.t_rack, u + 0.32, T + 0.012, 0.1, 0.06, 0.025, 0.1, 0.01);
    if (i === red) {
      const p = f.p(u - 0.45, 0, -0.12);
      redPhone(c, p.x, y + T, p.z, f.yaw + 0.3, { off: true });
    } else {
      f.box(M.black, u - 0.48, T + 0.035, -0.1, 0.19, 0.07, 0.2, 0.015);
      f.box(M.black, u - 0.48, T + 0.08, -0.12, 0.05, 0.03, 0.2, 0.01, [0, PI / 2, 0]);
    }
    // a headset hung on the monitor, or dropped on the desk
    f.add(M.black, torG(0.08, 0.008, 3, 10, PI), u + 0.42, T + 0.12, 0.22, [PI / 2, 0, 0.3]);
    for (const s of [-1, 1]) f.cyl(M.black, u + 0.42 + s * 0.08, T, 0.22, 0.035, 0.035, 0.02, 8);
    if (rnd() < 0.8) {
      const p = f.p(u + 0.15 + jit(c, 0.1), 0, 0.28 + jit(c, 0.06));
      Fac.mug(c, p.x, y + T, p.z, null, rnd() * 6);
    }
    if (rnd() < 0.6) {
      const p = f.p(u - 0.2 + jit(c, 0.1), 0, 0.25);
      Fac.papers(c, p.x, y + T, p.z, f.yaw + jit(c, 0.6), 1 + Math.floor(rnd() * 3));
    }
    const p = f.p(u + jit(c, 0.15), 0, D / 2 + 0.42 + rnd() * 0.12);
    opsChair(c, p.x, y, p.z, f.yaw + PI + jit(c, 0.6), { down: i === down });
  }
  f.col(-len / 2 - 0.02, -D / 2, len / 2 + 0.02, D / 2 + 0.02, T, SURF.metal);
}

const ROOM_NAMES = {
  hub: 'ATRIUM', labA: 'LAB 4-A', labB: 'LAB 4-B', cryo: 'CRYO', stores: 'STORES', office1: 'OFFICES', office2: 'OFFICES', conf: 'CONF.',
  cafe: 'CAFETERIA', lockers: 'LOCKERS', specimen: 'SPECIMEN HALL', server: 'SERVERS', security: 'SECURITY', maint: 'PLANT', morgue: 'MORGUE',
  archive: 'ARCHIVE', genomics: 'GENOMICS', holding: 'HOLDING', infirmary: 'INFIRMARY', isolation: 'ISOLATION', director: 'DIRECTOR',
  quarters: 'QUARTERS', ops: 'OPS', kitchen: 'KITCHEN', waste: 'WASTE', nadja: 'LAB 1', shop: 'ARMORY',
};

/**
 * The printed site plan on the wall at (x, y = its centre, z) facing `face`, w × h: an aluminium frame, every space of
 * `spaces` (corridors green, rooms white, outlined), the room names that fit, YOU ARE HERE at `here`, red pins and
 * scrawled notes on `pins` ([id, note]), the title.
 */
export function wallMap(c, x, y, z, face, { w = 2.2, h = 1.4, spaces = [], here = null, pins = [] } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  for (const [u0, y0, u1, y1] of [[-w / 2 - 0.03, -h / 2 - 0.03, w / 2 + 0.03, -h / 2], [-w / 2 - 0.03, h / 2, w / 2 + 0.03, h / 2 + 0.03], [-w / 2 - 0.03, -h / 2, -w / 2, h / 2], [w / 2, -h / 2, w / 2 + 0.03, h / 2]]) f.span(M.steel, u0, y + y0, 0, u1, y + y1, 0.025);
  f.quad(X.t_paper, -w / 2, y - h / 2, w / 2, y + h / 2, 0.012);
  f.label('NOX BIOSYSTEMS · SUBLEVEL 4 · EMERGENCY EVACUATION PLAN', 0, y + h / 2 - 0.07, 0.013, Math.min(1.6, w * 0.8), 0.07, { bg: '#f0eee5', fg: '#1d2b3a', border: '#f0eee5', font: 'bold 40px Arial' });
  if (!spaces.length) return;
  let ax0 = Infinity, az0 = Infinity, ax1 = -Infinity, az1 = -Infinity;
  for (const s of spaces) {
    ax0 = Math.min(ax0, s.x0);
    az0 = Math.min(az0, s.z0);
    ax1 = Math.max(ax1, s.x1);
    az1 = Math.max(az1, s.z1);
  }
  const k = Math.min((w - 0.2) / (ax1 - ax0), (h - 0.3) / (az1 - az0));
  const mx = (ax0 + ax1) / 2, mz = (az0 + az1) / 2, cy = y - 0.05;
  const at = (px, pz) => [(px - mx) * k, cy - (pz - mz) * k];
  for (const s of spaces) {
    const [u0, y1] = at(s.x0, s.z0), [u1, y0] = at(s.x1, s.z1);
    f.quad(M.black, u0 - 0.004, y0 - 0.004, u1 + 0.004, y1 + 0.004, 0.0125);
    f.quad(s.kind === 'corridor' ? M.green : s.zone === 'safe' ? M.blue : M.white, u0, y0, u1, y1, 0.013);
    const name = ROOM_NAMES[s.id];
    if (name && u1 - u0 > 0.17 && y1 - y0 > 0.06) f.label(name, (u0 + u1) / 2, (y0 + y1) / 2, 0.0135, Math.min(0.24, u1 - u0 - 0.02), 0.035, { bg: '#ffffff', fg: '#1d2b3a', border: '#ffffff', font: 'bold 30px Arial' });
  }
  const hs = spaces.find((s) => s.id === here);
  if (hs) {
    const [hu, hy] = at((hs.x0 + hs.x1) / 2, (hs.z0 + hs.z1) / 2);
    f.add(M.red, cylC(0.025, 0.025, 0.004, 12), hu, hy - 0.035, 0.016, [PI / 2, 0, 0]);
    f.label('YOU ARE HERE', hu, hy - 0.075, 0.0145, 0.18, 0.035, { bg: '#c62a22', fg: '#ffffff', border: '#c62a22', font: 'bold 30px Arial' });
  }
  for (const [id, note] of pins) {
    const s = spaces.find((o) => o.id === id);
    if (!s) continue;
    const [pu, py] = at((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
    f.add(M.red, sphG(0.012, 6, 4), pu, py, 0.03);
    f.cyl(M.steel, pu, py, 0.013, 0.002, 0.002, 0.017, 4);
    if (note) f.label(note, pu + 0.09, py + 0.05, 0.016, 0.18, 0.05, { bg: '#f2d64b', fg: '#7a1410', border: '#f2d64b', font: 'bold 30px "Comic Sans MS", Arial' });
  }
}

/**
 * A lit status board on the wall at (x, y = its centre, z) facing `face`: a dark panel, a lamp per row of `rows`
 * ([system, state, 'ok' | 'warn' | 'bad']), the systems and their states in two printed columns, the title.
 */
export function statusBoard(c, x, y, z, face, { w = 1.1, rows = [], title = 'SITE STATUS' } = {}) {
  const { U, X } = c;
  const f = new Frame(c, x, z, face);
  const rh = 0.085, h = rows.length * rh + 0.2;
  f.box(X.t_rack, 0, y, 0.03, w, h, 0.06, 0.01);
  f.label(title, 0, y + h / 2 - 0.06, 0.06, w - 0.1, 0.07, { ...PLATE, border: '#2fb8c8' });
  const top = y + h / 2 - 0.13, nw = w * 0.55, sw = w * 0.3;
  rows.forEach(([name, state, st], i) => {
    const yy = top - rh * (i + 0.5);
    f.quad(st === 'bad' ? U.ledR : st === 'warn' ? U.ledA : U.ledG, -w / 2 + 0.05, yy - 0.02, -w / 2 + 0.09, yy + 0.02, 0.061);
    f.label(name, -w / 2 + 0.11 + nw / 2, yy, 0.06, nw, 0.05, { bg: '#16191c', fg: '#e8edf0', border: '#16191c', font: 'bold 30px Arial', align: 'left' });
    f.label(state, w / 2 - 0.05 - sw / 2, yy, 0.06, sw, 0.05, { bg: '#16191c', fg: st === 'bad' ? '#ff5a3c' : st === 'warn' ? '#ffb020' : '#8cff9a', border: '#16191c', font: 'bold 30px Arial', align: 'left' });
  });
}

// ---------------------------------------------------------------- the plant room
/**
 * A diesel generator set centred at (x, z), its long axis across `face` and its control panel toward it: the skid with
 * its belly tank and mounts, the engine (rocker covers, air filter, turbo, belts, oil filter, dipstick), the radiator
 * and its grille at one end, the alternator drum at the other, the control panel (gauges, LCD, key, E-stop), start
 * batteries, the exhaust's bellows, silencer and stack up to the ceiling; `service`: a side panel off, leant on the skid.
 */
export function generator(c, x, z, face, { len = 3.8, wid = 1.5, ceil = 4.0, service = true, name = 'GEN-1 · 500 kVA · 400 V' } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const B = 0.22;
  f.span(X.t_engine, -len / 2, 0, -wid / 2, len / 2, B, wid / 2, 0.01);
  f.span(M.dark, -len / 2 + 0.1, 0.06, -wid / 2 - 0.01, len / 2 - 0.1, 0.16, wid / 2 + 0.01);
  for (const s of [-1, 1]) for (const e of [-1, 1]) f.add(M.steel, torG(0.04, 0.01, 4, 8), e * (len / 2 - 0.15), B + 0.03, s * (wid / 2 - 0.03), [0, PI / 2, 0]);
  // the engine
  const e0 = -len / 2 + 0.7, e1 = len / 2 - 1.35;
  for (const [u, v] of [[e0 + 0.1, -0.35], [e0 + 0.1, 0.35], [e1 - 0.1, -0.35], [e1 - 0.1, 0.35]]) f.cyl(X.t_rubber, u, B, v, 0.06, 0.06, 0.06, 8);
  f.span(X.t_genYellow, e0, B + 0.06, -0.4, e1, 1.15, 0.4, 0.03);
  f.span(X.t_engine, e0 + 0.08, 1.15, -0.26, e1 - 0.08, 1.32, 0.26, 0.02);
  for (let i = 0; i < 6; i++) f.cyl(M.steel, e0 + 0.18 + (i * (e1 - e0 - 0.36)) / 5, 1.32, 0, 0.018, 0.018, 0.02, 6);
  f.add(X.t_engine, cylC(0.17, 0.17, 0.5, 12), e1 - 0.35, 1.48, -0.1, [0, 0, PI / 2]);
  f.cyl(X.t_pipe, e0 + 0.35, 1.15, 0.32, 0.12, 0.12, 0.18, 10);
  f.cyl(M.white, e0 + 0.6, 0.45, 0.42, 0.055, 0.055, 0.16, 10);
  f.rod(M.yellow, [e0 + 0.9, 0.9, 0.41], [e0 + 0.92, 1.25, 0.43], 0.008, 4);
  f.add(M.dark, cylC(0.16, 0.16, 0.06, 12), e0 - 0.03, 0.6, 0.0, [0, 0, PI / 2]);
  f.add(M.black, torG(0.15, 0.012, 3, 14), e0 - 0.07, 0.75, 0.0, [0, PI / 2, 0], [1, 1.6, 1]);
  // the radiator and its grille (on the end face)
  const r1 = -len / 2 + 0.6;
  f.span(X.t_genYellow, -len / 2, B, -wid / 2 + 0.05, r1, 1.8, wid / 2 - 0.05, 0.02);
  f.add(M.dark, planeG(wid - 0.3, 1.3), -len / 2 - 0.002, B + 0.82, 0, [0, -PI / 2, 0]);
  for (let k = 0; k < 9; k++) f.add(X.t_genYellow, rbox(0.03, 0.025, wid - 0.3), -len / 2 - 0.012, B + 0.24 + k * 0.145, 0, [0, 0, 0.6]);
  f.cyl(M.steel, r1 - 0.2, 1.8, -0.4, 0.05, 0.05, 0.06, 8);
  // the alternator drum and its end vents
  const a0 = len / 2 - 1.35;
  f.add(X.t_genYellow, cylC(0.5, 0.5, 0.95, 16), a0 + 0.47, B + 0.62, 0, [0, 0, PI / 2]);
  f.add(M.dark, cylC(0.42, 0.42, 0.03, 16), a0 + 0.96, B + 0.62, 0, [0, 0, PI / 2]);
  for (let k = 0; k < 5; k++) f.add(M.black, planeG(0.03, 0.4), len / 2 - 0.37, B + 0.62, -0.15 + k * 0.075, [0, PI / 2, 0]);
  f.span(X.t_genYellow, a0 + 0.1, B, -0.45, len / 2 - 0.05, B + 0.15, 0.45);
  // the control panel on its stand, toward the front
  const pu = len / 2 - 0.4, pv = wid / 2 - 0.05, py = 1.27;
  f.span(X.t_engine, pu - 0.04, B, pv - 0.4, pu + 0.04, py, pv - 0.32);
  f.span(X.t_genYellow, pu - 0.33, py, pv - 0.4, pu + 0.33, py + 0.7, pv, 0.015);
  f.quad(M.black, pu - 0.3, py + 0.05, pu + 0.3, py + 0.65, pv + 0.001);
  for (let k = 0; k < 3; k++) f.gauge(pu - 0.2 + k * 0.2, py + 0.51, pv, 0.1);
  f.quad(G.t_lcdGreen, pu - 0.22, py + 0.28, pu + 0.05, py + 0.38, pv + 0.002);
  f.add(M.red, cylC(0.035, 0.035, 0.04, 12), pu + 0.2, py + 0.2, pv + 0.02, [PI / 2, 0, 0]);
  f.quad(M.yellow, pu + 0.15, py + 0.15, pu + 0.25, py + 0.25, pv + 0.0015);
  f.add(X.t_chrome, cylC(0.015, 0.015, 0.03, 8), pu - 0.1, py + 0.15, pv + 0.015, [PI / 2, 0, 0]);
  f.quad(U.ledA, pu + 0.08, py + 0.31, pu + 0.1, py + 0.33, pv + 0.002);
  f.label(name, pu, py + 0.1, pv + 0.002, 0.42, 0.05, PLATE);
  f.label('DANGER · MAY START AUTOMATICALLY', (e0 + e1) / 2, 0.75, 0.4, 0.75, 0.09, WARN);
  // start batteries on the skid
  for (let k = 0; k < 2; k++) {
    f.span(M.black, a0 - 0.55 + k * 0.28, B, 0.48, a0 - 0.32 + k * 0.28, B + 0.24, 0.7);
    f.cyl(M.red, a0 - 0.5 + k * 0.28, B + 0.24, 0.55, 0.012, 0.012, 0.02, 6);
  }
  // the exhaust: bellows, a silencer under the ceiling, the stack through it
  const xu = e1 - 0.35, top = ceil - 0.55;
  f.cyl(X.t_pipe, xu, 1.32, 0.1, 0.07, 0.07, 0.25, 10);
  for (let k = 0; k < 5; k++) f.add(X.t_chrome, torG(0.08, 0.014, 4, 10), xu, 1.6 + k * 0.05, 0.1, [PI / 2, 0, 0]);
  f.cyl(X.t_pipe, xu, 1.83, 0.1, 0.07, 0.07, top - 0.25 - 1.83, 10);
  f.add(X.t_pipe, cylC(0.24, 0.24, 1.6, 14), xu - 0.5, top, 0.1, [0, 0, PI / 2]);
  f.cyl(X.t_pipe, xu - 1.25, top, 0.1, 0.08, 0.08, ceil - top, 10);
  for (const s of [-1, 1]) f.rod(M.dark, [xu - 0.5 + s * 0.6, top + 0.2, 0.1], [xu - 0.5 + s * 0.6, ceil, 0.1], 0.012, 4);
  if (service) {
    const p = f.p(e0 + 0.6, 0, -wid / 2 - 0.12);
    c.K.add(X.t_genYellow, rbox(1.0, 0.7, 0.03, 0.01), p.x, 0.36, p.z, [0.28, f.yaw, 0, 'YXZ']);
    f.add(M.dark, planeG(0.9, 0.8), e0 + 0.75, B + 0.55, -0.401, [0, PI, 0]);
  }
  f.col(-len / 2, -wid / 2 - (service ? 0.2 : 0), len / 2, wid / 2, py + 0.7, SURF.metal);
}

/**
 * The plant room's electrics on the wall at (x, z) facing `face`: the floor-standing main LV board (rotary isolator,
 * ammeters, its plates) and `n` wall distribution boards beside it, `open` one standing open on its rows of breakers
 * with a lockout tag; conduits up to the ceiling from each.
 */
export function breakerPanel(c, x, z, face, { n = 3, open = 1, ceil = 4.0 } = {}) {
  const { M, U, X } = c;
  const f = new Frame(c, x, z, face);
  const mw = 0.9, md = 0.45, mh = 2.0, dw = 0.56, dh = 0.86, dd = 0.2, gap = 0.12;
  const L = mw + n * (dw + gap);
  const m0 = -L / 2 + mw / 2;
  f.span(M.dark, m0 - mw / 2 + 0.02, 0, 0.02, m0 + mw / 2 - 0.02, 0.08, md - 0.02);
  f.span(M.grey, m0 - mw / 2, 0.08, 0, m0 + mw / 2, mh, md, 0.01);
  f.span(M.dark, m0 - 0.004, 0.12, md, m0 + 0.004, mh - 0.04, md + 0.004);
  for (let k = 0; k < 3; k++) f.gauge(m0 - 0.25 + k * 0.14, 1.72, md, 0.1);
  f.span(M.yellow, m0 + 0.12, 1.05, md, m0 + 0.36, 1.29, md + 0.006);
  f.box(M.red, m0 + 0.24, 1.17, md + 0.03, 0.04, 0.2, 0.05, 0.01, [0, 0, -0.7]);
  f.label('MAIN LV BOARD · 400 V', m0, 1.92, md, 0.6, 0.07, PLATE);
  f.label('DANGER · 400 VOLTS', m0 - 0.2, 1.2, md, 0.3, 0.16, { ...DANGER, lines: ['DANGER', '400 VOLTS'] });
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + mw + gap + dw / 2 + i * (dw + gap), y = 0.75;
    f.span(M.grey, u - dw / 2, y, 0, u + dw / 2, y + dh, dd, 0.008);
    f.label(`DB-4${'ABCD'[i]}`, u, y + dh + 0.06, 0.004, 0.2, 0.06, PLATE);
    f.cyl(X.t_pipe, u - 0.15, y + dh, dd / 2, 0.025, 0.025, ceil - y - dh, 6);
    f.cyl(X.t_pipe, u + 0.1, y + dh, dd / 2, 0.02, 0.02, ceil - y - dh, 6);
    if (i === open) {
      f.quad(M.black, u - dw / 2 + 0.03, y + 0.03, u + dw / 2 - 0.03, y + dh - 0.03, dd + 0.001);
      for (let r = 0; r < 4; r++) {
        const ry = y + 0.15 + r * 0.17;
        f.quad(M.dark, u - dw / 2 + 0.06, ry, u + dw / 2 - 0.06, ry + 0.1, dd + 0.002);
        for (let b = 0; b < 8; b++) f.quad(b === 5 && r === 1 ? M.red : M.white, u - dw / 2 + 0.08 + b * 0.052, ry + 0.035, u - dw / 2 + 0.1 + b * 0.052, ry + 0.065, dd + 0.003);
      }
      f.add(M.grey, rbox(dw - 0.02, dh - 0.02, 0.02).clone().translate(-(dw - 0.02) / 2, 0, 0), u + dw / 2, y + dh / 2, dd + 0.01, [0, 1.9, 0]);
      // the lockout: a padlock on the isolator and the tag hanging off it
      f.box(M.red, u + 0.12, y + 0.56, dd + 0.02, 0.04, 0.05, 0.02);
      f.label('DANGER · DO NOT OPERATE · R. OKAFOR', u + 0.12, y + 0.44, dd + 0.02, 0.08, 0.16, { ...DANGER, lines: ['DANGER', 'DO NOT', 'OPERATE', 'OKAFOR'], font: 'bold 30px Arial' });
    } else {
      f.box(X.t_chrome, u + dw / 2 - 0.06, y + dh / 2, dd + 0.012, 0.02, 0.1, 0.02);
      f.quad(U.ledG, u - dw / 2 + 0.05, y + dh - 0.07, u - dw / 2 + 0.07, y + dh - 0.05, dd + 0.001);
      f.label('400 V', u, y + dh / 2 + 0.15, dd, 0.12, 0.06, WARN);
    }
  }
  f.col(m0 - mw / 2, 0, m0 + mw / 2, md, mh, SURF.metal);
  f.col(m0 + mw / 2 + gap, 0, L / 2, dd, 0.75 + dh, SURF.metal, 0, 0.75);
}

/**
 * Pumps on their plinth against the wall at (x, z) facing `face`: `n` end-suction sets (volute, coupling guard, motor
 * with its fan cowl) fed from a suction header along the wall, discharge risers with check valves, gate valves (hand
 * wheels) and gauges up to the discharge header, which turns up into the ceiling; duty / standby plates.
 */
export function pumpSet(c, x, z, face, { n = 2, ceil = 4.0, name = 'CHILLED WATER' } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const gap = 1.3, L = n * gap + 0.4, hy = Math.min(2.4, ceil - 0.8);
  f.span(M.grey, -L / 2, 0, 0.02, L / 2, 0.15, 1.15, 0.02);
  f.hcyl(X.t_pipe, 0, 0.55, 0.12, 0.08, L + 0.1, 12, 'u');
  f.hcyl(X.t_pipe, 0.1, hy, 0.15, 0.07, L - 0.1, 12, 'u');
  f.rod(X.t_pipe, [L / 2 - 0.05, hy, 0.15], [L / 2 - 0.05, ceil, 0.15], 0.07, 12);
  f.rod(X.t_pipe, [-L / 2 - 0.05, 0.55, 0.12], [-L / 2 - 0.05, ceil, 0.12], 0.08, 12);
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + 0.2 + gap * (i + 0.5);
    const mat = i % 2 ? X.t_pumpGreen : X.t_pumpBlue;
    f.add(X.t_pipe, cylC(0.06, 0.06, 0.14, 10), u, 0.55, 0.24, [PI / 2, 0, 0]);
    f.add(mat, cylC(0.21, 0.21, 0.15, 14), u, 0.55, 0.38, [PI / 2, 0, 0]);
    f.span(M.yellow, u - 0.09, 0.42, 0.46, u + 0.09, 0.62, 0.56);
    f.add(mat, cylC(0.17, 0.17, 0.42, 14), u, 0.5, 0.78, [PI / 2, 0, 0]);
    for (let k = 0; k < 4; k++) f.add(M.dark, torG(0.172, 0.008, 3, 14), u, 0.5, 0.62 + k * 0.1);
    f.add(M.dark, cylC(0.15, 0.15, 0.08, 12), u, 0.5, 1.03, [PI / 2, 0, 0]);
    f.span(M.dark, u - 0.16, 0.15, 0.62, u + 0.16, 0.35, 0.95);
    f.span(M.grey, u + 0.17, 0.55, 0.7, u + 0.27, 0.7, 0.85);
    // the discharge riser: flange, check valve, gate valve and its wheel, a gauge, the elbow into the header
    f.cyl(X.t_pipe, u, 0.76, 0.38, 0.055, 0.055, hy - 0.76, 10);
    f.add(X.t_pipe, cylC(0.09, 0.09, 0.2, 10), u, 1.15, 0.38);
    f.add(M.dark, cylC(0.08, 0.08, 0.16, 8), u, 1.55, 0.38);
    f.rod(M.steel, [u, 1.63, 0.38], [u, 1.78, 0.38], 0.012, 5);
    f.add(M.red, torG(0.11, 0.012, 4, 14), u, 1.8, 0.38, [PI / 2, 0, 0]);
    for (let k = 0; k < 3; k++) f.rod(M.red, [u, 1.8, 0.38], [u + Math.cos((k * 2 * PI) / 3) * 0.11, 1.8, 0.38 + Math.sin((k * 2 * PI) / 3) * 0.11], 0.006, 3);
    f.rod(X.t_pipe, [u, hy, 0.38], [u, hy, 0.15], 0.055, 10);
    f.rod(M.steel, [u, 1.0, 0.43], [u + 0.1, 1.0, 0.43], 0.008, 4);
    f.gauge(u + 0.1, 1.0, 0.43, 0.11);
    f.label(`P-${i + 1} · ${i ? 'STANDBY' : 'DUTY'}`, u, 0.32, 1.15, 0.3, 0.06, PLATE);
  }
  f.label(`${name} · FLOW →`, 0.1, hy + 0.15, 0.22, 0.6, 0.06, { ...PLATE, bg: '#1d4f7a' });
  f.col(-L / 2, 0.02, L / 2, 1.15, 1.1, SURF.metal);
}

/**
 * A heavy workbench against the wall at (x, z) facing `face`, `len` long: a butcher-block top on a steel frame, a
 * drawer unit, the lower shelf with a toolbox, a bench vise on the right end, a clamp lamp, and the job left half done
 * (a pump's impeller and parts on a rag, a hammer, a spanner, an oil can, a tin of bolts).
 */
export function workbench(c, x, z, face, { len = 2.2, d = 0.75, vise = true, lamp = true } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.9;
  for (const u of [-len / 2 + 0.06, len / 2 - 0.06]) for (const v of [0.06, d - 0.06]) f.span(M.dark, u - 0.025, 0, v - 0.025, u + 0.025, T - 0.05, v + 0.025);
  f.span(M.steel, -len / 2 + 0.04, 0.18, 0.04, len / 2 - 0.04, 0.2, d - 0.04);
  f.span(X.t_butcher, -len / 2, T - 0.05, 0, len / 2, T, d, 0.008);
  // the drawer unit under the left end, the toolbox on the shelf
  f.span(M.grey, -len / 2 + 0.1, 0.2, 0.05, -len / 2 + 0.6, T - 0.05, d - 0.04);
  for (let k = 0; k < 3; k++) {
    f.quad(M.dark, -len / 2 + 0.12, 0.25 + k * 0.2 - 0.003, -len / 2 + 0.58, 0.25 + k * 0.2 + 0.003, d - 0.039);
    f.box(X.t_chrome, -len / 2 + 0.35, 0.33 + k * 0.2, d - 0.03, 0.14, 0.015, 0.02);
  }
  f.box(M.red, 0.2, 0.32, 0.4, 0.55, 0.24, 0.26, 0.015);
  f.box(M.black, 0.2, 0.46, 0.4, 0.3, 0.025, 0.03);
  f.box(M.dark, 0.75, 0.3, 0.35, 0.4, 0.2, 0.3);
  // the vise on the right end, at the front edge
  if (vise) {
    const vu = len / 2 - 0.25;
    f.box(X.t_pumpBlue, vu, T + 0.07, d - 0.12, 0.16, 0.14, 0.3, 0.01);
    f.box(M.dark, vu, T + 0.15, d - 0.2, 0.22, 0.07, 0.04);
    f.box(M.dark, vu, T + 0.15, d + 0.01, 0.22, 0.07, 0.04);
    f.box(X.t_pumpBlue, vu, T + 0.1, d + 0.03, 0.14, 0.1, 0.06, 0.01);
    f.rod(X.t_chrome, [vu, T + 0.08, d + 0.05], [vu, T + 0.08, d + 0.16], 0.012, 6);
    f.rod(X.t_chrome, [vu - 0.12, T + 0.08, d + 0.16], [vu + 0.12, T + 0.08, d + 0.16], 0.008, 5);
    f.cyl(X.t_pumpBlue, vu, T, d - 0.12, 0.08, 0.08, 0.02, 10);
  }
  // the job on the bench: a rag, the impeller and bolts laid out, tools, the oil can, a tin of bolts
  f.box(M.red, -0.25, T + 0.003, 0.4, 0.5, 0.006, 0.35, 0, [0, 0.2, 0]);
  f.cyl(X.t_brass, -0.3, T + 0.006, 0.4, 0.13, 0.11, 0.05, 12);
  f.cyl(M.dark, -0.3, T + 0.056, 0.4, 0.03, 0.03, 0.02, 8);
  for (let k = 0; k < 6; k++) f.cyl(M.steel, -0.08 + (k % 3) * 0.05, T + 0.006, 0.3 + Math.floor(k / 3) * 0.06, 0.012, 0.012, 0.03, 6);
  f.box(X.t_butcher, 0.25, T + 0.015, 0.55, 0.3, 0.025, 0.03, 0, [0, 0.4, 0]);
  f.box(M.dark, 0.11, T + 0.025, 0.49, 0.04, 0.045, 0.11, 0, [0, 0.4, 0]);
  f.box(M.steel, 0.5, T + 0.006, 0.25, 0.24, 0.012, 0.035, 0, [0, -0.3, 0]);
  f.cyl(M.green, 0.7, T, 0.2, 0.06, 0.06, 0.12, 10);
  f.rod(M.green, [0.7, T + 0.12, 0.2], [0.78, T + 0.24, 0.24], 0.006, 4);
  f.cyl(X.t_pipe, -0.7, T, 0.25, 0.07, 0.07, 0.11, 10);
  if (lamp) {
    // a clamp lamp on the back edge, its arm over the job
    f.box(M.dark, -0.55, T + 0.03, 0.04, 0.06, 0.06, 0.06);
    f.rod(M.dark, [-0.55, T + 0.06, 0.04], [-0.5, T + 0.5, 0.1], 0.01, 5);
    f.rod(M.dark, [-0.5, T + 0.5, 0.1], [-0.35, T + 0.55, 0.35], 0.01, 5);
    f.add(M.dark, cylG(0.04, 0.09, 0.12, 10, true), -0.33, T + 0.44, 0.37);
    f.add(G.t_lamp, sphG(0.03, 6, 4), -0.33, T + 0.49, 0.37);
  }
  f.col(-len / 2, 0, len / 2, d, T, SURF.wood);
}

/**
 * A pegboard tool wall at (x, z) facing `face`, w × h from height y0: hardboard in a timber frame, hooks, a shadow
 * outline painted behind every tool, the tools (spanners, hammers, screwdrivers, pliers, a saw, a pipe wrench); a
 * share are `missing` (their outlines left bare).
 */
export function toolWall(c, x, z, face, { w = 2.0, h = 1.0, y0 = 1.1, missing = 0.25 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  f.span(X.t_peg, -w / 2, y0, 0.0, w / 2, y0 + h, 0.012);
  for (const [u0, ya, u1, yb] of [[-w / 2 - 0.03, y0 - 0.03, w / 2 + 0.03, y0], [-w / 2 - 0.03, y0 + h, w / 2 + 0.03, y0 + h + 0.03], [-w / 2 - 0.03, y0, -w / 2, y0 + h], [w / 2, y0, w / 2 + 0.03, y0 + h]]) f.span(X.t_butcher, u0, ya, 0, u1, yb, 0.03);
  const tools = ['spanner', 'spanner', 'spanner', 'spanner', 'hammer', 'driver', 'driver', 'driver', 'pliers', 'saw', 'pipe', 'driver', 'hammer', 'spanner'];
  const cols = 7, cw = (w - 0.16) / cols;
  tools.forEach((t, i) => {
    const u = -w / 2 + 0.08 + cw * ((i % cols) + 0.5), yy = y0 + h * (Math.floor(i / cols) ? 0.3 : 0.72);
    const big = t === 'saw' || t === 'pipe' || t === 'hammer';
    const L = big ? 0.34 : t === 'spanner' ? 0.16 + (i % 4) * 0.03 : 0.2, wd = t === 'saw' ? 0.1 : t === 'hammer' ? 0.08 : 0.035;
    f.quad(M.dark, u - wd / 2 - 0.012, yy - L / 2 - 0.012, u + wd / 2 + 0.012, yy + L / 2 + 0.012, 0.0125);
    f.rod(M.steel, [u, yy + L / 2 - 0.03, 0.012], [u, yy + L / 2 - 0.02, 0.06], 0.004, 3);
    if (rnd() < missing) return;
    const v = 0.03;
    if (t === 'spanner') {
      f.box(X.t_chrome, u, yy, v, 0.022, L, 0.008);
      f.cyl(X.t_chrome, u, yy + L / 2 - 0.015, v - 0.004, 0.022, 0.022, 0.008, 8);
    } else if (t === 'hammer') {
      f.box(X.t_butcher, u, yy - 0.04, v, 0.03, L - 0.08, 0.025);
      f.box(M.dark, u, yy + L / 2 - 0.03, v, 0.12, 0.035, 0.035);
    } else if (t === 'driver') {
      f.box(pick(c, [M.red, M.yellow, M.blue]), u, yy - 0.05, v, 0.03, 0.1, 0.03, 0.008);
      f.rod(X.t_chrome, [u, yy, v], [u, yy + L / 2, v], 0.004, 4);
    } else if (t === 'pliers') {
      for (const s of [-1, 1]) f.box(M.red, u + s * 0.012, yy - 0.04, v, 0.015, 0.12, 0.012, 0, [0, 0, s * 0.12]);
      f.box(M.dark, u, yy + 0.06, v, 0.02, 0.07, 0.012);
    } else if (t === 'saw') {
      f.box(X.t_chrome, u, yy + 0.04, v, 0.08, L - 0.1, 0.004);
      f.box(M.red, u, yy - L / 2 + 0.05, v, 0.09, 0.1, 0.03, 0.01);
    } else {
      f.box(M.red, u, yy - 0.03, v, 0.035, L - 0.08, 0.025);
      f.box(M.dark, u + 0.02, yy + L / 2 - 0.05, v, 0.07, 0.06, 0.03);
    }
  });
  f.label('RETURN TOOLS AFTER USE', 0, y0 + h + 0.1, 0.004, 0.8, 0.07, WARN);
}

/** a pillar drill centred at (x, z) facing `face`: base, column, table, head with motor and belt guard, quill, feed handles, switch box */
export function drillPress(c, x, z, face) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  f.box(X.t_machine, 0, 0.05, 0, 0.42, 0.1, 0.58, 0.015);
  f.cyl(X.t_chrome, 0, 0.1, -0.16, 0.04, 0.04, 1.55, 10);
  f.box(X.t_machine, 0, 0.82, -0.06, 0.12, 0.1, 0.24, 0.01);
  f.cyl(X.t_machine, 0, 0.87, 0.08, 0.16, 0.16, 0.03, 14);
  f.box(X.t_machine, 0, 1.52, -0.02, 0.26, 0.24, 0.42, 0.03);
  f.add(X.t_machine, cylC(0.09, 0.09, 0.22, 12), 0, 1.5, -0.3, [PI / 2, 0, 0]);
  f.box(X.t_machine, 0, 1.7, -0.08, 0.24, 0.12, 0.5, 0.04);
  f.cyl(X.t_chrome, 0, 1.25, 0.1, 0.03, 0.03, 0.17, 8);
  f.cyl(M.dark, 0, 1.17, 0.1, 0.022, 0.03, 0.08, 8);
  f.cyl(M.steel, 0, 1.06, 0.1, 0.004, 0.004, 0.11, 4);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2 + 0.4;
    f.rod(X.t_chrome, [0.14, 1.48, 0.0], [0.14, 1.48 + Math.cos(a) * 0.2, Math.sin(a) * 0.2], 0.008, 4);
    f.add(M.black, sphG(0.022, 6, 4), 0.14, 1.48 + Math.cos(a) * 0.2, Math.sin(a) * 0.2);
  }
  f.box(M.yellow, -0.15, 1.5, 0.15, 0.06, 0.1, 0.07);
  f.cyl(M.red, -0.18, 1.53, 0.15, 0.015, 0.015, 0.01, 6);
  f.label('EYE PROTECTION', 0, 1.62, 0.19, 0.2, 0.05, WARN);
  f.col(-0.21, -0.29, 0.21, 0.29, 1.76, SURF.metal);
}

/** a louvred bin rack against the wall at (x, z) facing `face`: rows of open-fronted stacking bins, a few labelled, one pulled out on the floor */
export function partsBins(c, x, z, face, { w = 1.2, h = 1.6, rows = 6, cols = 5 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  const D = 0.32;
  for (const s of [-1, 1]) f.span(M.steel, s * w / 2 - 0.02, 0, 0.0, s * w / 2 + 0.02, h, D);
  f.span(M.steel, -w / 2, 0.15, 0, w / 2, h, 0.015);
  const mats = [X.t_binBlue, X.t_binBlue, X.t_binRed, X.t_binYellow];
  const bw = (w - 0.04) / cols, bh = (h - 0.25) / rows;
  const names = ['M8 BOLTS', 'WASHERS', 'FUSES 10A', 'O-RINGS', 'CABLE TIES', 'M6 NUTS'];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const u = -w / 2 + 0.02 + bw * (i + 0.5), y = 0.2 + bh * j;
      if (j === 1 && i === 3) continue;
      const m = mats[(i + j * 2) % mats.length];
      f.span(m, u - bw / 2 + 0.01, y, 0.03, u + bw / 2 - 0.01, y + bh * 0.62, D - 0.02);
      f.span(m, u - bw / 2 + 0.01, y, D - 0.02, u + bw / 2 - 0.01, y + bh * 0.35, D);
      if (rnd() < 0.3) f.label(pick(c, names), u, y + bh * 0.2, D, bw - 0.04, 0.035, NOTE);
    }
  }
  // the missing bin: on the floor in front, its washers spilled
  const p = f.p(0.3, 0, D + 0.35);
  c.K.add(X.t_binRed, rbox(bw - 0.02, bh * 0.62, D - 0.05), p.x, bh * 0.31, p.z, [0, f.yaw + 0.5, 0]);
  for (let k = 0; k < 7; k++) c.K.add(M.steel, cylC(0.012, 0.012, 0.003, 6), p.x + jit(c, 0.35), 0.002, p.z + jit(c, 0.3));
  f.col(-w / 2 - 0.02, 0, w / 2 + 0.02, D, h, SURF.metal);
}

/** a hand pallet truck centred at (x, z) turned `yaw` (its forks toward +v): forks, rollers, the pump unit, the tow handle */
export function palletJack(c, x, z, yaw = 0, { handle = 0.4 } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  for (const s of [-1, 1]) {
    f.span(M.red, s * 0.27 - 0.08, 0.03, -0.25, s * 0.27 + 0.08, 0.085, 0.9, 0.006);
    f.add(X.t_rubber, cylC(0.035, 0.035, 0.07, 8), s * 0.27, 0.035, 0.82, [0, 0, PI / 2]);
  }
  f.span(M.red, -0.35, 0.03, -0.42, 0.35, 0.14, -0.25, 0.01);
  f.box(M.red, 0, 0.3, -0.38, 0.2, 0.3, 0.18, 0.02);
  f.cyl(X.t_chrome, 0, 0.14, -0.38, 0.045, 0.045, 0.32, 8);
  for (const s of [-1, 1]) f.add(X.t_rubber, cylC(0.08, 0.08, 0.05, 12), s * 0.08, 0.08, -0.42, [0, 0, PI / 2]);
  // the handle, tipped back by `handle` radians, its loop and the lever
  const hy = 0.42, hx = Math.sin(handle) * 1.0, ht = hy + Math.cos(handle) * 1.0;
  f.rod(M.red, [0, hy, -0.4], [0, ht, -0.4 - hx], 0.02, 6);
  f.add(M.dark, torG(0.12, 0.016, 4, 12), 0, ht + Math.cos(handle) * 0.1, -0.4 - hx - Math.sin(handle) * 0.1, [-handle, 0, 0]);
  f.box(M.black, 0.05, ht - 0.04, -0.4 - hx + 0.02, 0.03, 0.12, 0.02, 0, [-handle, 0, 0]);
  f.col(-0.3, -0.52, 0.3, -0.24, 0.6, SURF.metal);
}

/**
 * A traction-battery charger on the wall at (x, z) facing `face`: the charger cabinet with its display and charge LEDs,
 * the lead down to a forklift battery on the floor in front (its cell caps and lifting eyes), the charging notice.
 */
export function batteryCharger(c, x, z, face, { charging = true } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  f.box(M.grey, 0, 1.25, 0.14, 0.5, 0.6, 0.28, 0.015);
  f.quad(M.black, -0.16, 1.38, 0.08, 1.48, 0.281);
  f.quad(charging ? G.t_lcdGreen : M.dark, -0.15, 1.39, 0.07, 1.47, 0.282);
  for (let k = 0; k < 4; k++) f.quad(k < 3 && charging ? U.ledG : U.ledA, -0.15 + k * 0.05, 1.3, -0.13 + k * 0.05, 1.32, 0.282);
  for (let k = 0; k < 6; k++) f.quad(M.dark, -0.2, 1.05 + k * 0.025, 0.2, 1.06 + k * 0.025, 0.281);
  f.label('CHARGING AREA · NO NAKED FLAMES', 0, 1.7, 0.004, 0.62, 0.08, WARN);
  // the battery on the floor and the lead to it
  f.box(X.t_engine, 0, 0.3, 0.75, 0.98, 0.6, 0.5, 0.01);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) f.cyl(i % 2 ? M.red : M.black, -0.4 + i * 0.16, 0.6, 0.6 + j * 0.15, 0.025, 0.025, 0.02, 6);
  for (const s of [-1, 1]) f.add(M.steel, torG(0.035, 0.008, 3, 8), s * 0.42, 0.62, 0.75);
  f.add(M.black, tubeG('chargeLead', [[0, 0, 0], [0.05, -0.4, 0.05], [0.1, -0.95, 0.25], [0.15, -0.6, 0.48], [0.18, -0.38, 0.52]], 0.016, 14, 4), 0.12, 0.98, 0.18);
  f.box(M.grey, 0.3, 0.6, 0.62, 0.1, 0.06, 0.08);
  f.col(-0.49, 0.5, 0.49, 1.0, 0.62, SURF.metal);
}

/** an aluminium A-frame step ladder centred at (x, z) turned `yaw` (`folded`: closed, leant on the wall at (x, z) behind it) */
export function stepLadder(c, x, z, yaw = 0, { h = 1.8, folded = false } = {}) {
  const { M } = c;
  const f = new Frame(c, x, z, yaw);
  // front stiles from vb at the floor to vt at the top (toward +v), the rear legs behind them, treads, the top cap
  const vb = folded ? 0.5 : 0.32, vt = folded ? 0.14 : 0.0, vr = folded ? 0.42 : -0.32;
  for (const s of [-1, 1]) {
    f.rod(M.steel, [s * 0.24, 0, vb], [s * 0.2, h, vt], 0.016, 5);
    f.rod(M.steel, [s * 0.24, 0, vr], [s * 0.2, h - 0.05, vt - 0.03], 0.014, 5);
  }
  for (let k = 1; k <= 5; k++) {
    const t = k / 6;
    f.box(M.steel, 0, h * t, vb * (1 - t) + vt * t + 0.02, 0.44 - t * 0.06, 0.02, 0.1);
  }
  f.box(M.grey, 0, h + 0.04, vt, 0.46, 0.08, 0.16, 0.01);
  if (!folded) for (const s of [-1, 1]) f.rod(M.dark, [s * 0.22, h * 0.45, vb * 0.55], [s * 0.22, h * 0.45, vr * 0.55], 0.006, 3);
  if (!folded) f.col(-0.27, vr, 0.27, vb, h, SURF.metal, FLAG_NOBULLET);
}

/** a tripod work light centred at (x, z), its twin halogen heads aimed toward `yaw`: legs, mast, the lit heads (a baked light), its lead */
export function workLight(c, x, z, yaw = 0, { lit = true, h = 1.7 } = {}) {
  const { M, U } = c;
  const f = new Frame(c, x, z, yaw);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2 + 0.5;
    f.rod(M.yellow, [Math.sin(a) * 0.42, 0, Math.cos(a) * 0.42], [0, 0.55, 0], 0.012, 4);
  }
  f.cyl(M.yellow, 0, 0.5, 0, 0.018, 0.018, h - 0.5, 6);
  f.span(M.yellow, -0.3, h, -0.02, 0.3, h + 0.03, 0.02);
  for (const s of [-1, 1]) {
    f.box(M.yellow, s * 0.17, h + 0.14, 0.02, 0.24, 0.2, 0.1, 0.01, [-0.35, 0, 0]);
    f.add(lit ? U.panel : M.grey, planeG(0.2, 0.15), s * 0.17, h + 0.155, 0.075, [-0.35, 0, 0]);
  }
  f.add(M.black, tubeG('workLead', [[0, 0, 0], [0.05, -0.6, 0.05], [0.25, -1.15, 0.2], [0.8, -1.18, 0.5]], 0.008, 10, 3), 0.02, h - 0.02, 0.03);
  if (lit) f.light(0, h, 0.5, 0.7, 2.8, [1.0, 0.93, 0.78], [Math.sin(f.yaw) * 0.94, -0.34, Math.cos(f.yaw) * 0.94], 7);
  f.col(-0.15, -0.15, 0.15, 0.15, h + 0.25, SURF.metal, FLAG_NOBULLET);
}

// ---------------------------------------------------------------- the stores
/**
 * A wooden pallet centred at (x, z) turned `yaw`, w × d, standing at height y, with its `load`: 'boxes' (taped cartons,
 * a layer short), 'wrap' (a stretch-wrapped block with its label), 'water' (shrink-wrapped bottle packs), 'sacks', or
 * null. `col`: its own collider (off on a rack).
 */
export function pallet(c, x, z, yaw = 0, { w = 1.2, d = 0.8, y = 0, load = 'boxes', h = 0.9, col = true, label = 'MEDICAL CONSUMABLES' } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, yaw, y);
  for (const v of [-d / 2 + 0.05, 0, d / 2 - 0.05]) f.span(X.t_pallet, -w / 2, 0, v - 0.05, w / 2, 0.022, v + 0.05);
  for (const u of [-w / 2 + 0.05, 0, w / 2 - 0.05]) f.span(X.t_pallet, u - 0.05, 0.022, -d / 2, u + 0.05, 0.122, d / 2);
  for (let k = 0; k < 5; k++) {
    const v = -d / 2 + 0.05 + (k * (d - 0.1)) / 4;
    f.span(X.t_pallet, -w / 2, 0.122, v - 0.05, w / 2, 0.144, v + 0.05);
  }
  const P0 = 0.144;
  if (load === 'wrap') {
    f.box(X.t_wrap, 0, P0 + h / 2, 0, w - 0.04, h, d - 0.02, 0.03);
    for (let k = 0; k < 3; k++) f.quad(M.dark, -w / 2 + 0.02, P0 + 0.29 + k * 0.29, w / 2 - 0.02, P0 + 0.3 + k * 0.29, d / 2 - 0.009);
    f.label(label, 0, P0 + h * 0.6, d / 2 - 0.01, 0.4, 0.16, { ...NOTE, lines: label.split(' ') });
  } else if (load === 'water') {
    const lay = Math.max(1, Math.min(3, Math.floor(h / 0.27)));
    for (let j = 0; j < lay; j++) for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
      if (j === lay - 1 && lay > 1 && i + k > 2) continue;
      f.box(M.blue, -w / 2 + 0.2 + i * 0.4, P0 + 0.13 + j * 0.27, -d / 4 + k * (d / 2), 0.38, 0.26, d / 2 - 0.02);
    }
  } else if (load === 'sacks') {
    for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) f.box(j % 2 ? M.white : X.t_kraft, -w / 4 + i * (w / 2) + jit(c, 0.03), P0 + 0.08 + j * 0.15, jit(c, 0.04), w / 2 - 0.04, 0.15, d - 0.06, 0.06, [0, jit(c, 0.08), 0]);
  } else if (load === 'boxes') {
    const lay = Math.max(1, Math.round(h / 0.3));
    for (let j = 0; j < lay; j++) {
      for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) {
        if (j === lay - 1 && rnd() < 0.4) continue;
        const bu = -w / 2 + w / 6 + i * (w / 3) + jit(c, 0.02), bv = -d / 4 + k * (d / 2) + jit(c, 0.02);
        f.box(rnd() < 0.7 ? X.t_kraft : M.card, bu, P0 + 0.145 + j * 0.3, bv, w / 3 - 0.03, 0.29, d / 2 - 0.03, 0, [0, jit(c, 0.05), 0]);
        f.quad(X.t_wrap, bu - 0.03, P0 + 0.28 + j * 0.3 - 0.0, bu + 0.03, P0 + 0.29 + j * 0.3, bv + d / 4 - 0.014);
      }
    }
  }
  const top = load ? P0 + (load === 'sacks' ? 0.45 : load === 'water' ? Math.max(1, Math.min(3, Math.floor(h / 0.27))) * 0.27 : h) : P0;
  if (col && top > 0.25) f.col(-w / 2, -d / 2, w / 2, d / 2, top, load === 'boxes' || load === 'sacks' ? SURF.cardboard : SURF.wood);
  return top;
}

/**
 * Pallet racking over the rect, fronts toward `face`: blue uprights with bracing, orange beams at `levels` heights,
 * wire decks, loaded pallets per bay (`empty`: [bay, level] pairs gone), column guards, bay and load-limit plates.
 */
export function palletRack(c, [x0, z0, x1, z1], face, { levels = [1.25, 2.4], h = 3.0, bays = 2, empty = [], loads = null } = {}) {
  const { M, X } = c;
  const alongX = face === 'n' || face === 's';
  const L = alongX ? x1 - x0 : z1 - z0, D = alongX ? z1 - z0 : x1 - x0;
  const f = new Frame(c, (x0 + x1) / 2, (z0 + z1) / 2, face);
  const bw = L / bays;
  for (let b = 0; b <= bays; b++) {
    const u = -L / 2 + b * bw + (b === 0 ? 0.04 : b === bays ? -0.04 : 0);
    for (const v of [-D / 2 + 0.04, D / 2 - 0.04]) f.span(X.t_upright, u - 0.04, 0, v - 0.035, u + 0.04, h, v + 0.035);
    for (let k = 0; k < 4; k++) f.rod(X.t_upright, [u, 0.15 + k * 0.7, -D / 2 + 0.07], [u, 0.5 + k * 0.7, D / 2 - 0.07], 0.012, 4);
    f.span(M.yellow, u - 0.07, 0, D / 2 - 0.12, u + 0.07, 0.4, D / 2 + 0.02);
    f.label(`${'ABC'[Math.min(b, 2)]}`, u, 0.3, D / 2 + 0.02, 0.06, 0.06, PLATE);
  }
  const lv = [0, ...levels];
  const labels = ['MEDICAL CONSUMABLES', 'RATIONS · 24 H PACKS', 'DISINFECTANT 5 L', 'FILTERS · HEPA H14'];
  for (let b = 0; b < bays; b++) {
    const u = -L / 2 + bw * (b + 0.5);
    for (let k = 0; k < lv.length; k++) {
      const y = lv[k];
      if (k) {
        for (const v of [-D / 2 + 0.04, D / 2 - 0.04]) f.span(X.t_beam, u - bw / 2 + 0.04, y - 0.11, v - 0.03, u + bw / 2 - 0.04, y, v + 0.03);
        f.span(X.t_galv, u - bw / 2 + 0.05, y - 0.005, -D / 2 + 0.07, u + bw / 2 - 0.05, y, D / 2 - 0.07);
      }
      if (empty.some(([eb, el]) => eb === b && el === k)) continue;
      const ld = loads?.[(b + k) % loads.length] ?? pick(c, ['boxes', 'boxes', 'wrap', 'water']);
      const room = (k < lv.length - 1 ? lv[k + 1] - 0.15 : h - 0.1) - y - 0.2;
      const p = f.p(u + jit(c, 0.04), 0, jit(c, 0.03));
      pallet(c, p.x, p.z, f.yaw, { w: Math.min(1.1, bw - 0.25), d: Math.min(1.0, D - 0.05), y, load: ld, h: Math.min(0.9, room), col: false, label: pick(c, labels) });
    }
  }
  f.label('MAX 1000 KG PER LEVEL · UDL', 0, levels[0] - 0.06, D / 2 + 0.03, 0.5, 0.06, WARN);
  f.col(-L / 2, -D / 2, L / 2, D / 2, h, SURF.metal);
}

/** a welded-mesh panel along a line (alongX at fixed coordinate `at`, from a0 to a1): posts, rails, bars, a collider bullets pass */
function meshPanel(c, alongX, at, a0, a1, h) {
  const { K, X } = c;
  const B = (u0, y0, u1, y1, t, faces) => (alongX ? K.box(X.t_galv, u0, y0, at - t, u1, y1, at + t, { faces }) : K.box(X.t_galv, at - t, y0, u0, at + t, y1, u1, { faces }));
  const L = a1 - a0, np = Math.max(1, Math.round(L / 1.4));
  for (let i = 0; i <= np; i++) B(a0 + (i * L) / np - 0.02, 0, a0 + (i * L) / np + 0.02, h, 0.02);
  for (const y of [0.06, h - 0.04]) B(a0, y - 0.015, a1, y + 0.015, 0.015, alongX ? ['py', 'ny', 'pz', 'nz'] : ['py', 'ny', 'px', 'nx']);
  for (let u = a0 + 0.1; u < a1 - 0.05; u += 0.1) B(u - 0.003, 0.08, u + 0.003, h - 0.05, 0.003, ['px', 'nx', 'pz', 'nz']);
  for (let y = 0.3; y < h - 0.1; y += 0.25) B(a0, y - 0.003, a1, y + 0.003, 0.003, alongX ? ['py', 'ny', 'pz', 'nz'] : ['py', 'ny', 'px', 'nx']);
  // (trimmed at the ends so two panels meeting in a corner don't stack colliders)
  if (alongX) c.col(a0 + 0.03, 0, at - 0.03, a1 - 0.03, h, at + 0.03, SURF.metal, FLAG_NOBULLET);
  else c.col(at - 0.03, 0, a0 + 0.03, at + 0.03, h, a1 - 0.03, SURF.metal, FLAG_NOBULLET);
}

/**
 * A wire stock cage on the rect's `sides` ('n' its z0 edge, 's' z1, 'w' x0, 'e' x1; the others are the room's walls),
 * h tall: mesh panels on posts, a doorway `door` = [side, a0, a1, open] (the range along that side, the swung mesh
 * door's angle), a hasp and an open padlock, the controlled-stock notice.
 */
export function wireCage(c, [x0, z0, x1, z1], { h = 2.4, sides = 'nw', door = null } = {}) {
  const { M, X } = c;
  for (const sd of sides) {
    const alongX = sd === 'n' || sd === 's';
    const at = sd === 'n' ? z0 : sd === 's' ? z1 : sd === 'w' ? x0 : x1;
    const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1;
    if (door && door[0] === sd) {
      if (door[1] - a0 > 0.1) meshPanel(c, alongX, at, a0, door[1], h);
      if (a1 - door[2] > 0.1) meshPanel(c, alongX, at, door[2], a1, h);
      // the door: a mesh leaf hinged at a0 of the gap, swung `open` out of the cage
      const hx = alongX ? door[1] : at, hz = alongX ? at : door[1];
      const out = sd === 'n' || sd === 'w' ? -1 : 1;
      const g = new Frame(c, hx, hz, alongX ? -out * door[3] : -PI / 2 + out * door[3]);
      const w = door[2] - door[1] - 0.04;
      for (const u of [0.02, w]) g.span(X.t_galv, u - 0.02, 0.02, -0.02, u + 0.02, h - 0.1, 0.02);
      for (const y of [0.05, h - 0.12]) g.span(X.t_galv, 0, y - 0.015, -0.015, w, y + 0.015, 0.015);
      for (let u = 0.15; u < w - 0.05; u += 0.13) g.span(X.t_galv, u - 0.003, 0.06, -0.003, u + 0.003, h - 0.13, 0.003);
      for (let y = 0.35; y < h - 0.2; y += 0.3) g.span(X.t_galv, 0, y - 0.003, -0.003, w, y + 0.003, 0.003);
      g.box(M.steel, w - 0.05, 1.05, 0.03, 0.06, 0.1, 0.02);
      g.add(X.t_brass, torG(0.02, 0.005, 3, 8, PI), w - 0.05, 1.12, 0.05);
      g.box(M.white, w / 2, 1.5, 0.012, 0.42, 0.24, 0.004);
      g.label('CONTROLLED STOCK', w / 2, 1.5, 0.014, 0.4, 0.22, { ...DANGER, lines: ['CONTROLLED STOCK', 'SIGN OUT REQUIRED'], font: 'bold 34px Arial' });
    } else meshPanel(c, alongX, at, a0, a1, h);
  }
}

/**
 * The goods-in / dispatch counter against the wall at (x, z) facing `face`, `len` long: a packing bench on a steel
 * frame with flat-packed cartons below, a bench scale with its display, a tape gun, a label printer, the stock
 * terminal, a manifest on a clipboard, a carton half packed, a roll of wrap on its holder.
 */
export function shippingCounter(c, x, z, face, { len = 2.4, d = 0.8, weight = '4.72 kg' } = {}) {
  const { M, U, X, G } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.92;
  for (const u of [-len / 2 + 0.05, len / 2 - 0.05]) for (const v of [0.05, d - 0.05]) f.span(M.steel, u - 0.025, 0, v - 0.025, u + 0.025, T - 0.04, v + 0.025);
  f.span(M.steel, -len / 2 + 0.03, 0.15, 0.03, len / 2 - 0.03, 0.17, d - 0.03);
  for (let k = 0; k < 5; k++) f.box(M.card, -0.3 + k * 0.012, 0.18 + k * 0.012, d / 2, 0.9, 0.01, 0.6, 0, [0, k * 0.03, 0]);
  f.span(X.t_butcher, -len / 2, T - 0.04, 0, len / 2, T, d, 0.006);
  // the bench scale: platter, base, the display on its column
  const su = len / 2 - 0.35;
  f.box(M.dark, su, T + 0.03, d / 2 + 0.05, 0.42, 0.05, 0.42, 0.01);
  f.box(X.t_chrome, su, T + 0.062, d / 2 + 0.05, 0.4, 0.012, 0.4);
  f.cyl(M.dark, su, T, 0.08, 0.02, 0.02, 0.35, 6);
  f.box(M.dark, su, T + 0.38, 0.1, 0.24, 0.12, 0.06, 0.01);
  f.quad(G.t_lcdGreen, su - 0.1, T + 0.35, su + 0.05, T + 0.41, 0.131);
  f.label(weight, su - 0.025, T + 0.38, 0.132, 0.14, 0.05, { bg: '#0d1a10', fg: '#8cff9a', border: '#0d1a10', font: 'bold 34px Courier New' });
  f.box(U.ledG, su + 0.09, T + 0.38, 0.131, 0.01, 0.01, 0.004);
  // the half-packed carton on the scale, flaps up
  f.span(M.card, su - 0.16, T + 0.068, d / 2 - 0.08, su + 0.16, T + 0.078, d / 2 + 0.18);
  for (const [a, b, c0, d0] of [[-0.16, -0.155, -0.08, 0.18], [0.155, 0.16, -0.08, 0.18]]) f.span(M.card, su + a, T + 0.068, d / 2 + c0, su + b, T + 0.3, d / 2 + d0);
  for (const [v0, v1] of [[-0.08, -0.075], [0.175, 0.18]]) f.span(M.card, su - 0.16, T + 0.068, d / 2 + v0, su + 0.16, T + 0.3, d / 2 + v1);
  for (const s of [-1, 1]) f.box(M.card, su, T + 0.39, d / 2 + 0.05 + s * 0.175, 0.3, 0.005, 0.2, 0, [-s * 1.1, 0, 0]);
  f.box(X.t_wrap, su, T + 0.12, d / 2 + 0.05, 0.25, 0.1, 0.2, 0.03);
  // the stock terminal, the label printer, tape gun, clipboard
  f.box(M.black, -0.2, T + 0.26, 0.12, 0.48, 0.3, 0.03, 0.006);
  f.cyl(M.dark, -0.2, T, 0.08, 0.07, 0.07, 0.11, 8);
  f.screen(-0.2, T + 0.26, 0.136, 0.44, 0.26, true);
  f.box(M.black, -0.2, T + 0.012, 0.42, 0.42, 0.024, 0.14);
  f.box(X.t_ivory, -len / 2 + 0.35, T + 0.09, 0.2, 0.22, 0.18, 0.25, 0.02);
  f.box(M.white, -len / 2 + 0.35, T + 0.14, 0.34, 0.08, 0.004, 0.06, 0, [-0.4, 0, 0]);
  f.box(M.red, 0.25, T + 0.05, 0.5, 0.06, 0.1, 0.2, 0.01, [0, 0.5, 0]);
  f.add(X.t_kraft, torG(0.04, 0.015, 4, 10), 0.25, T + 0.11, 0.54, [0, 0.5, 0]);
  f.box(X.t_walnut, -len / 2 + 0.6, T + 0.006, 0.6, 0.23, 0.01, 0.32, 0, [0, -0.25, 0]);
  f.label('MANIFEST 0417 · OUTBOUND · HOLD', -len / 2 + 0.6, T + 0.012, 0.61, 0.2, 0.27, { ...NOTE, lines: ['MANIFEST 0417', 'OUTBOUND', 'K-7 SAMPLES ×4', 'DRY ICE', 'HOLD — DO NOT', 'DISPATCH'], font: 'bold 26px Courier New', align: 'left' }, 'up');
  // the wrap roll on its holder at the far end
  f.hcyl(X.t_wrap, -len / 2 + 0.15, T + 0.45, 0.25, 0.08, 0.5, 10, 'v');
  for (const v of [0, 0.5]) f.span(M.steel, -len / 2 + 0.13, T, v - 0.01 + 0.0, -len / 2 + 0.17, T + 0.47, v + 0.01);
  f.col(-len / 2, 0, len / 2, d, T, SURF.wood);
}

/**
 * Steel shelving against the wall at (x, z) facing `face`, w wide: `levels` shelves of labelled totes and boxed stock
 * of one `kind` ('ppe' | 'med' | 'tools' | 'it'); a share `looted` (gaps, a box torn open and left on its side).
 */
export function binShelf(c, x, z, face, { w = 1.8, d = 0.5, h = 2.0, levels = 5, kind = 'ppe', looted = 0.3 } = {}) {
  const { M, X, rnd } = c;
  const f = new Frame(c, x, z, face);
  for (const u of [-w / 2 + 0.02, w / 2 - 0.02]) for (const v of [0.03, d - 0.03]) f.span(M.steel, u - 0.02, 0, v - 0.02, u + 0.02, h, v + 0.02);
  const names = {
    ppe: [['NITRILE GLOVES · M', M.blue], ['FFP3 MASKS', M.white], ['TYVEK SUITS · L', X.t_paper], ['OVERSHOES', M.blue], ['GOGGLES', X.t_bBlack]],
    med: [['SALINE 0.9 %', M.white], ['DRESSINGS', M.white], ['SYRINGES 10 ML', X.t_paper], ['SHARPS BINS', M.yellow], ['BODY BAGS', X.t_bBlack]],
    tools: [['FILTERS', X.t_paper], ['FUSES', M.red], ['GASKETS', X.t_bBlack], ['TAPE', M.yellow], ['BULBS', M.white]],
    it: [['HDD 2 TB SAS', M.dark], ['PATCH LEADS', X.t_cBlue], ['SFP MODULES', X.t_paper], ['PSU SPARES', X.t_upsGrey], ['TAPES LTO-6', M.black]],
  }[kind];
  for (let i = 0; i < levels; i++) {
    const y = 0.1 + (i * (h - 0.25)) / (levels - 1), gap = (h - 0.25) / (levels - 1);
    f.span(M.steel, -w / 2, y - 0.025, 0, w / 2, y, d);
    if (i === levels - 1) continue;
    const [name, mat] = names[i % names.length];
    f.label(name, -w / 2 + 0.25, y - 0.0125, d, 0.36, 0.035, NOTE);
    let u = -w / 2 + 0.06;
    while (u < w / 2 - 0.25) {
      const bw = 0.22 + rnd() * 0.12;
      if (u + bw > w / 2 - 0.05) break;
      if (rnd() > looted) {
        const bh = Math.min(gap - 0.06, 0.12 + rnd() * 0.18);
        f.span(mat, u, y, 0.06, u + bw, y + bh, d - 0.04 - rnd() * 0.06);
        if (rnd() < 0.3) f.quad(X.t_paper, u + 0.03, y + bh * 0.4, u + bw - 0.03, y + bh * 0.7, d - 0.039);
      }
      u += bw + 0.03;
    }
  }
  // a torn box on its side at the foot
  if (looted > 0.2) {
    const p = f.p(0.3, 0, d + 0.25);
    c.K.add(names[0][1], rbox(0.3, 0.14, 0.22), p.x, 0.07, p.z, [0, f.yaw + 0.7, 0]);
  }
  f.col(-w / 2, 0, w / 2, d, h, SURF.metal);
}

// ---------------------------------------------------------------- the archive
/**
 * Stock one shelf of the frame from u0 to u1 at height y: archive boxes (label strip, hand hole) and runs of binders
 * (spine labels), items `hMax` tall at most, reaching from depth vIn to the visible edge vOut (vOut < vIn: the back
 * face). `wet`: soaked, slumped card.
 */
function stockShelf(c, f, u0, u1, y, vIn, vOut, hMax, { wet = false, gaps = 0.12 } = {}) {
  const { X, rnd } = c;
  const s = Math.sign(vOut - vIn), turn = s > 0 ? null : [0, PI, 0];
  const binders = [X.t_bBlack, X.t_bBlue, X.t_bRed, X.t_bGreen];
  let u = u0 + 0.02;
  while (u < u1 - 0.1) {
    if (rnd() < gaps) {
      u += 0.1 + rnd() * 0.25;
      continue;
    }
    if (rnd() < 0.62 || wet) {
      const w = 0.33, h = Math.min(hMax, 0.26) * (wet ? 0.8 + rnd() * 0.15 : 1);
      if (u + w > u1) break;
      const slump = wet ? jit(c, 0.08) : 0;
      f.box(wet ? X.t_wet : rnd() < 0.85 ? X.t_box : X.t_kraft, u + w / 2, y + h / 2, (vIn + vOut) / 2, w - 0.01, h, Math.abs(vOut - vIn), 0, slump ? [0, 0, slump] : null);
      f.add(X.t_paper, planeG(0.12, 0.05), u + w / 2, y + h * 0.62, vOut + s * 0.001, turn);
      f.add(c.M.black, planeG(0.07, 0.022), u + w / 2, y + h * 0.3, vOut + s * 0.001, turn);
      u += w + 0.005;
    } else {
      const n = 4 + Math.floor(rnd() * 7), bw = 0.055, h = Math.min(hMax, 0.31);
      if (u + n * bw > u1) break;
      const m = pick(c, binders), lean = rnd() < 0.25 ? 0.25 : 0;
      f.box(m, u + (n * bw) / 2, y + h / 2, (vIn + vOut) / 2 - s * 0.03, n * bw, h, Math.abs(vOut - vIn) - 0.06);
      for (let k = 0; k < n; k++) f.add(X.t_paper, planeG(0.03, 0.08), u + bw * (k + 0.5), y + h * 0.7, vOut - s * 0.029, turn);
      if (lean) f.box(m, u + n * bw + 0.08, y + h / 2 - 0.02, (vIn + vOut) / 2 - s * 0.03, bw, h, Math.abs(vOut - vIn) - 0.06, 0, [0, 0, -lean]);
      u += n * bw + (lean ? 0.2 : 0.02);
    }
  }
}

/**
 * Fixed archive shelving against the wall at (x, z) facing `face`, w long: pale enamel uprights and `levels` shelves
 * of boxes and binders; `wet`: the bottom `wet` shelves soaked, a box slumped off onto the floor.
 */
export function archiveShelf(c, x, z, face, { w = 3.0, d = 0.4, h = 2.3, levels = 6, wet = 0 } = {}) {
  const { X } = c;
  const f = new Frame(c, x, z, face);
  const nb = Math.max(1, Math.round(w / 1.0));
  for (let b = 0; b <= nb; b++) {
    const u = -w / 2 + (b * w) / nb + (b === 0 ? 0.02 : b === nb ? -0.02 : 0);
    f.span(X.t_shelf, u - 0.015, 0, 0.01, u + 0.015, h, d);
  }
  const gap = (h - 0.1) / levels;
  for (let i = 0; i < levels; i++) {
    const y = 0.08 + i * gap;
    f.span(X.t_shelf, -w / 2, y - 0.02, 0, w / 2, y, d);
    if (i < levels - 1 || gap > 0.3) stockShelf(c, f, -w / 2 + 0.02, w / 2 - 0.02, y, 0.02, d - 0.02, gap - 0.05, { wet: i < wet });
  }
  f.span(X.t_shelf, -w / 2, h - 0.02, 0, w / 2, h, d);
  if (wet) {
    const p = f.p(jit(c, w / 3), 0, d + 0.3);
    c.K.add(X.t_wet, rbox(0.38, 0.2, 0.33, 0.03), p.x, 0.1, p.z, [0.15, f.yaw + 0.6, 0.2]);
    c.decal('puddle', p.x, p.z, 1.1, c.rnd() * 3);
  }
  f.col(-w / 2, 0, w / 2, d, h, SURF.cardboard);
}

/**
 * A block of mobile (rolling) archive shelving over the rect: `n` double-sided units running along x, carriages on
 * floor rails, packed tight except one aisle opened after unit `openAt`; painted end panels with a hand wheel and the
 * unit's label toward `face` ('e' | 'w', the side the block is worked from). Only the faces that can be seen are stocked:
 * the aisle's and the block's `show` sides ('n' its z0 side, 's' its z1 side) when they face open floor.
 */
export function mobileShelving(c, [x0, z0, x1, z1], face, { n = 8, openAt = 3, aisle = 0.9, h = 2.3, levels = 6, labels = null, wet = [], show = 's' } = {}) {
  const { M, X } = c;
  const L = x1 - x0, ud = (z1 - z0 - aisle - 0.02 * (n - 1)) / n;
  const endX = face === 'e' ? x1 : x0;
  for (const t of [0.15, 0.5, 0.85]) c.K.box(M.dark, x0 + L * t - 0.03, 0, z0, x0 + L * t + 0.03, 0.012, z1, { faces: ['py', 'px', 'nx'] });
  let z = z0;
  for (let i = 0; i < n; i++) {
    const za = z, zb = z + ud;
    const f = new Frame(c, (x0 + x1) / 2, (za + zb) / 2, 's');
    f.span(X.t_shelf, -L / 2 + 0.03, 0.012, -ud / 2 + 0.02, L / 2 - 0.03, 0.1, ud / 2 - 0.02);
    for (const u of [-L / 2 + 0.03, 0, L / 2 - 0.03]) f.span(X.t_shelf, u - 0.015, 0.1, -ud / 2, u + 0.015, h, ud / 2);
    const gap = (h - 0.2) / levels;
    const openN = (i === 0 && show.includes('n')) || i === openAt + 1, openS = (i === n - 1 && show.includes('s')) || i === openAt;
    for (let k = 0; k <= levels; k++) {
      const y = 0.1 + k * gap;
      f.span(X.t_shelf, -L / 2 + 0.03, y, -ud / 2, L / 2 - 0.03, y + 0.02, ud / 2);
      if (k === levels) continue;
      const w = wet.includes(i) && k < 2;
      if (openS) stockShelf(c, f, -L / 2 + 0.05, L / 2 - 0.05, y + 0.02, 0.0, ud / 2 - 0.01, gap - 0.05, { wet: w });
      if (openN) stockShelf(c, f, -L / 2 + 0.05, L / 2 - 0.05, y + 0.02, 0.0, -ud / 2 + 0.01, gap - 0.05, { wet: w });
    }
    // the end panel, its label holder and the hand wheel
    const e = new Frame(c, endX, (za + zb) / 2, face);
    e.span(X.t_bBlue, -ud / 2, 0.02, -0.02, ud / 2, h + 0.04, 0.012);
    e.label(labels?.[i] ?? `A-${String(i + 1).padStart(2, '0')}`, 0, 1.75, 0.012, 0.16, 0.1, { ...NOTE, lines: [labels?.[i] ?? `A-${String(i + 1).padStart(2, '0')}`, `${1981 + i * 3}-${1983 + i * 3}`] });
    e.add(X.t_chrome, cylC(0.03, 0.03, 0.08, 6), 0, 1.15, 0.05, [PI / 2, 0, 0]);
    e.add(X.t_chrome, torG(0.15, 0.012, 3, 10), 0, 1.15, 0.09);
    for (let k = 0; k < 3; k++) e.rod(X.t_chrome, [0, 1.15, 0.09], [Math.cos((k * 2 * PI) / 3 + 0.4) * 0.15, 1.15 + Math.sin((k * 2 * PI) / 3 + 0.4) * 0.15, 0.09], 0.008, 3);
    e.box(M.black, Math.cos(0.4) * 0.15, 1.15 + Math.sin(0.4) * 0.15, 0.12, 0.025, 0.025, 0.06);
    c.col(x0, 0, za, x1, h + 0.04, zb, SURF.cardboard);
    z = zb + (i === openAt ? aisle : 0.02);
  }
}

/**
 * A reading desk centred at (x, z), its reader on the `face` side: a walnut top on turned legs, the banker's lamp, a
 * ledger open under a magnifier, folders, the request slip, a chair pushed back; `light`: the lamp's baked glow.
 */
export function readingDesk(c, x, z, face, { w = 1.4, d = 0.75, light = true, slip = 'K-7 TRIAL · 1994-97' } = {}) {
  const { M, X } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.76;
  f.span(X.t_walnut, -w / 2, T - 0.035, -d / 2, w / 2, T, d / 2, 0.01);
  f.span(X.t_walnut, -w / 2 + 0.05, T - 0.13, -d / 2 + 0.05, w / 2 - 0.05, T - 0.035, d / 2 - 0.05);
  for (const su of [-1, 1]) for (const sv of [-1, 1]) f.cyl(X.t_walnut, su * (w / 2 - 0.07), 0, sv * (d / 2 - 0.07), 0.025, 0.035, T - 0.035, 8);
  const p = f.p(-w / 2 + 0.22, 0, -d / 2 + 0.18);
  Fac.deskLamp(c, p.x, T, p.z, f.yaw + 0.3, { on: true, light: false });
  if (light) f.light(-w / 2 + 0.25, T + 0.35, -0.1, 0.4, 1.4, WARM, null, 3.2);
  // the ledger, open, under the magnifier; folders; the slip
  for (const s of [-1, 1]) {
    f.box(X.t_bGreen, s * 0.17, T + 0.012, 0.05, 0.34, 0.02, 0.44, 0, [0, 0, -s * 0.06]);
    f.box(X.t_paper, s * 0.165, T + 0.026, 0.05, 0.32, 0.012, 0.42, 0, [0, 0, -s * 0.06]);
  }
  f.add(X.t_brass, torG(0.05, 0.007, 4, 12), 0.18, T + 0.04, 0.12, [PI / 2, 0, 0]);
  f.box(M.black, 0.27, T + 0.04, 0.2, 0.12, 0.015, 0.02, 0, [0, -0.7, 0]);
  for (let k = 0; k < 3; k++) f.box(pick(c, [M.yellow, X.t_kraft, M.card]), w / 2 - 0.25 + jit(c, 0.02), T + 0.006 + k * 0.012, -0.12 + jit(c, 0.02), 0.32, 0.01, 0.24, 0, [0, jit(c, 0.15), 0]);
  f.label('REQUEST SLIP', -0.42, T + 0.002, 0.2, 0.15, 0.1, { ...NOTE, lines: ['REQUEST', slip, 'RESTRICTED'], font: 'bold 26px Courier New' }, 'up');
  f.box(M.yellow, 0.42, T + 0.005, 0.22, 0.15, 0.008, 0.008, 0, [0, 0.4, 0]);
  const q = f.p(0.1, 0, d / 2 + 0.45);
  Fac.guestChair(c, q.x, q.z, f.yaw + PI + 0.4);
  f.col(-w / 2, -d / 2, w / 2, d / 2, T, SURF.wood);
}

/**
 * A microfiche station against the wall at (x, z) facing `face`: a small table, the beige reader (its hood, the lit
 * angled screen with a page on it, the fiche carrier under the lens, a focus knob), a fiche drawer cabinet, jackets
 * fanned out beside it, a stool.
 */
export function microficheReader(c, x, z, face, { w = 1.1, d = 0.65, on = true } = {}) {
  const { M, X, G } = c;
  const f = new Frame(c, x, z, face);
  const T = 0.74;
  f.span(M.grey, -w / 2, T - 0.03, 0, w / 2, T, d, 0.006);
  for (const u of [-w / 2 + 0.04, w / 2 - 0.04]) for (const v of [0.04, d - 0.04]) f.span(M.steel, u - 0.02, 0, v - 0.02, u + 0.02, T - 0.03, v + 0.02);
  // the reader
  const ru = -0.12;
  f.box(X.t_ivory, ru, T + 0.06, 0.32, 0.46, 0.12, 0.46, 0.02);
  f.box(X.t_ivory, ru, T + 0.38, 0.2, 0.5, 0.56, 0.24, 0.03);
  f.add(X.t_ivory, rbox(0.48, 0.42, 0.06, 0.015), ru, T + 0.44, 0.33, [-0.2, 0, 0]);
  f.add(on ? G.t_fiche : M.dark, planeG(0.4, 0.32), ru, T + 0.45, 0.364, [-0.2, 0, 0]);
  if (on) for (let k = 0; k < 6; k++) f.add(M.dark, planeG(0.26 - (k % 3) * 0.05, 0.012), ru - 0.04 + (k % 3) * 0.02, T + 0.56 - k * 0.04, 0.367 - k * 0.008, [-0.2, 0, 0]);
  f.cyl(M.dark, ru, T + 0.12, 0.42, 0.05, 0.04, 0.06, 10);
  f.box(c.U.glass, ru, T + 0.125, 0.48, 0.3, 0.01, 0.16);
  f.box(M.blue, ru + 0.04, T + 0.132, 0.48, 0.15, 0.002, 0.1);
  f.add(M.black, cylC(0.03, 0.03, 0.03, 10), ru + 0.27, T + 0.2, 0.3, [0, 0, PI / 2]);
  f.label('FICHE READER · LIFT CARRIER GENTLY', ru, T + 0.1, 0.551, 0.36, 0.04, PLATE);
  // the fiche cabinet, jackets fanned out
  f.box(M.grey, w / 2 - 0.18, T + 0.1, 0.2, 0.3, 0.2, 0.36, 0.01);
  for (let k = 0; k < 3; k++) f.quad(M.dark, w / 2 - 0.3, T + 0.04 + k * 0.06, w / 2 - 0.06, T + 0.045 + k * 0.06, 0.381);
  for (let k = 0; k < 5; k++) f.box(k % 2 ? M.white : M.blue, w / 2 - 0.25 + k * 0.03, T + 0.002 + k * 0.001, 0.52, 0.15, 0.002, 0.11, 0, [0, 0.2 + k * 0.15, 0]);
  if (on) f.light(ru, T + 0.45, 0.6, 0.18, 1.0, [1.0, 0.97, 0.85], null, 2.2);
  const p = f.p(ru + 0.05, 0, d + 0.4);
  L.labStool(c, p.x, p.z, { yaw: 0.6 });
  f.col(-w / 2, 0, w / 2, d, T, SURF.metal);
}

/** a three-tier archive trolley centred at (x, z) turned `yaw`: castors, push handle, boxes and binders, a box on the floor beside it */
export function bookTrolley(c, x, z, yaw = 0) {
  const { M, X } = c;
  const f = new Frame(c, x, z, yaw);
  const w = 0.85, d = 0.45;
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    f.span(M.steel, su * (w / 2 - 0.02) - 0.012, 0.08, sv * (d / 2 - 0.02) - 0.012, su * (w / 2 - 0.02) + 0.012, 1.0, sv * (d / 2 - 0.02) + 0.012);
    f.add(X.t_rubber, cylC(0.04, 0.04, 0.03, 8), su * (w / 2 - 0.04), 0.045, sv * (d / 2 - 0.04), [0, 0, PI / 2]);
  }
  for (const y of [0.15, 0.5, 0.85]) {
    f.span(M.steel, -w / 2, y - 0.015, -d / 2, w / 2, y, d / 2);
    stockShelf(c, f, -w / 2 + 0.02, w / 2 - 0.02, y, 0, d / 2 - 0.03, 0.3, { gaps: 0.3 });
  }
  f.rod(M.steel, [w / 2, 0.95, -d / 2 + 0.02], [w / 2 + 0.12, 1.02, -d / 2 + 0.02], 0.012, 5);
  f.rod(M.steel, [w / 2, 0.95, d / 2 - 0.02], [w / 2 + 0.12, 1.02, d / 2 - 0.02], 0.012, 5);
  f.rod(X.t_rubber, [w / 2 + 0.12, 1.02, -d / 2 + 0.02], [w / 2 + 0.12, 1.02, d / 2 - 0.02], 0.018, 6);
  f.box(X.t_box, -w / 2 - 0.25, 0.13, 0.1, 0.33, 0.26, 0.38, 0, [0, 0.35, 0]);
  f.col(-w / 2, -d / 2, w / 2 + 0.12, d / 2, 1.0, SURF.metal);
}

// ---------------------------------------------------------------- the rooms
/**
 * The server room: three rows of racks (a cold aisle between A and B under perforated tiles, a hot aisle between B and
 * C) split by a cross aisle, a row on the east wall north of the operations door; CRACs and the FM-200 bank on the
 * north wall, the UPS line-up in the north-west, network racks, overhead cable trays; the NOC desk by the corridor door
 * (the pickup's surface), spares shelving. Someone was purging the arrays when it went wrong.
 */
export function dressServer(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  // the rows (A fronts east, B west, C east), north and south of the cross aisle
  const rows = [[5.5, 'e', 'A'], [8.5, 'w', 'B'], [11.5, 'e', 'C']];
  rows.forEach(([x, face, n], i) => {
    rackRow(c, [x, -27.0, x + 0.9, -23.4], face, { name: `ROW ${n}`, first: 1, dead: 0.15, open: i === 1 ? [3] : [] });
    rackRow(c, [x, -22.0, x + 0.9, -19.0], face, { name: `ROW ${n}`, first: 7, dead: 0.1, open: i === 0 ? [2] : [] });
    P.cableTray(c, x + 0.45, -27.2, x + 0.45, -18.8, h - 0.85);
  });
  rackRow(c, [x1 - 0.9, -29.5, x1, -25.9], 'w', { name: 'ROW D', first: 1, dead: 0.3 });
  P.cableTray(c, 3.4, -28.4, x1 - 0.5, -28.4, h - 0.6);
  P.cableTray(c, 11.95, -18.8, x1 - 0.4, -18.8, h - 0.85);
  P.cableTray(c, x1 - 0.4, -18.8, x1 - 0.4, -16.3, h - 0.85);
  // the cold aisle's perforated tiles, the hot aisle's warning
  for (let z = -26.7; z < -19.2; z += 1.2) if (z < -23.5 || z > -22.0) c.K.box(X.t_perf, 7.15, 0, z, 7.75, 0.006, z + 0.6, { faces: ['py'] });
  // (a plate hung from the ceiling over the hot aisle's mouth)
  c.K.box(M.white, 10.2, 2.36, -23.42, 10.7, 2.5, -23.38);
  for (const x of [10.25, 10.65]) c.K.rod(M.steel, V(x, 2.5, -23.4), V(x, h, -23.4), 0.004, 3);
  for (const f of ['s', 'n']) c.label('HOT AISLE · 45 °C', 10.45, 2.43, f === 's' ? -23.395 : -23.405, f, 0.48, 0.12, WARN);
  // the server pulled out of A-09 on its rails, cables hanging, a drive carrier dropped
  c.K.box(M.grey, 6.4, 1.08, -20.72, 6.98, 1.17, -20.28);
  for (const zz of [-20.74, -20.26]) c.K.box(M.steel, 6.4, 1.06, zz - 0.01, 6.98, 1.08, zz + 0.01);
  c.K.box(M.black, 6.98, 1.08, -20.72, 6.99, 1.17, -20.28);
  c.K.add(X.t_cBlue, tubeG('pulled', [[0, 0, 0], [0.15, -0.3, 0.05], [0.25, -0.8, -0.02], [0.4, -1.05, 0.1]], 0.008, 10, 3), 6.42, 1.1, -20.4);
  c.K.cube(M.grey, 7.4, 0.02, -19.6, 0.1, 0.03, 0.15, 0.8);
  c.K.cube(M.grey, 7.0, 0.02, -18.8, 0.1, 0.03, 0.15, 2.1);
  // the north wall: CRACs at the aisle ends, the FM-200 bank, the IT spares
  crac(c, 7.45, z0, 's', { name: 'CRAC-01', temp: '17.9 °C', ceil: h });
  crac(c, 13.6, z0, 's', { name: 'CRAC-02', temp: '31.6 °C', alarm: true, ceil: h });
  suppressionTanks(c, 10.45, z0, 's', { n: 3, ceil: h });
  binShelf(c, 4.6, z0, 's', { w: 1.6, kind: 'it', looted: 0.25 });
  // the north-west: the UPS line-up, its isolator plate
  upsBank(c, x0, -28.5, 'e', { n: 4, open: 2, load: '61 %' });
  sign(c, ['NO SMOKING', 'BATTERY ROOM'], x0, 2.3, -26.6, 'e', 0.46, 0.2, DANGER);
  // network racks: the end of row B, beside the operations door
  patchRack(c, 8.95, -28.05, 'w', { ceil: h - 0.6 });
  patchRack(c, x1 - 0.4, -16.05, 'w', { ceil: h - 0.85 });
  // the NOC desk by the corridor door (the pickup sits on its left end), spares, the extinguisher
  techDesk(c, [4, -16.6, 6.4, -15.8], 's', { keep: [4.4, -16.55, 5.4, -15.85] });
  binShelf(c, 8.9, z1, 'n', { w: 1.8, kind: 'it', looted: 0.4 });
  P.extinguisher(c, x0, -21.3, 'e');
  c.label('CO₂ ONLY', x0, 1.25, -21.3, 'e', 0.18, 0.06, DANGER);
  // the fire panel by the corridor door, the room's plates and fittings
  c.K.box(M.red, x0, 1.3, -22.2, x0 + 0.1, 1.75, -21.75);
  c.label('FM-200 · MANUAL RELEASE', x0, 1.84, -21.97, 'e', 0.42, 0.06, DANGER);
  c.K.box(M.yellow, x0 + 0.1, 1.45, -22.08, x0 + 0.112, 1.6, -21.87);
  L.lightSwitch(c, x0, -16.85, 'e');
  for (const [x, z, f] of [[x0, -24.0, 'e'], [10.8, z1, 'n'], [12.0, z1, 'n'], [x1, -24.8, 'w']]) plate(c, x, 0.3, z, f, 'socket');
  L.wallClock(c, 10.45, 3.15, z1, 'n');
  roomTitle(c, 'SERVER ROOM · DATA HALL 4', 5.2, 2.75, z1, 'n', 1.6, '#2f6fd0');
  L.hazardPlacard(c, 3.6, 2.15, z1, 'n', 'nofood', { w: 0.45 });
  // what happened: the printouts, a bloody hand on C-08, the drag to the operations door
  floorPapers(c, 10.4, -17.6, 6, 0.7);
  c.wallDecal('blood', 12.4, 1.2, -20.2, 'e', 0.35, 0.4);
  c.decal('bloodDrag', 13.6, -21.0, 1.6, 1.6);
  c.decal('blood', 12.9, -19.8, 0.7, 0.4);
  c.decal('footprints', 6.6, -17.6, 1.4, PI / 2);
  // the racks' glow on the aisles
  c.light(7.45, 1.2, -21.0, 0.22, 2.2, [0.45, 0.7, 1.0], null, 4);
  c.light(13.6, 1.2, -22.0, 0.22, 2.2, [0.45, 0.7, 1.0], null, 4);
}

/**
 * Operations: the situation wall across the north (the plan display, monitor banks, ticker, clocks), the front console
 * row and the supervisors' row on a riser behind it (the red phone off its hook), the printed site plan on the east
 * wall, the status board over the radio cupboard, the situation table by the quarters' blast door, coffee and water in
 * the south-west, a comms rack in the corner. Left mid-lockdown: chairs shoved back, a headset on the floor, a smear
 * at the director's door.
 */
export function dressOps(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  const spaces = Object.values(ctx.S);
  const hot = ['holding', 'isolation', 'specimen'];
  situationWall(c, 20.75, z0, 's', { w: 6.0, spaces, hot, here: 'ops', ceil: h });
  L.warningBeacon(c, 17.45, 3.05, z0, 's', { red: true });
  L.warningBeacon(c, 24.05, 3.05, z0, 's', { red: true });
  // the front row, then the supervisors' row up on the riser
  consoleRow(c, 20.75, -22.9, 's', 5.4, { stations: 3, down: 2, name: 'OPS' });
  riser(c, [18.3, -21.0, 23.2, -18.7], 's', { y: 0.2 });
  c.K.box(M.hazard, 18.3, 0.196, -21.0, 23.2, 0.202, -20.94, { faces: ['py'] });
  consoleRow(c, 20.75, -20.4, 's', 4.4, { y: 0.2, stations: 2, red: 1, name: 'SUP' });
  c.label('SHIFT SUPERVISOR', 20.75, 0.135, -18.7, 's', 0.6, 0.07, PLATE);
  // the printed plan on the east wall, pinned where it went wrong
  wallMap(c, x1, 1.65, -23.0, 'w', { w: 2.6, h: 1.5, spaces, here: 'ops', pins: [['holding', 'C-02 OPEN'], ['isolation', 'NO CONTACT'], ['specimen', null], ['server', 'PURGE?']] });
  // the radio cupboard, its chargers, the status board over it
  c.K.box(X.t_upsGrey, x1 - 0.48, 0, -17.3, x1, 0.9, -15.6);
  c.K.box(M.dark, x1 - 0.485, 0.06, -16.46, x1 - 0.48, 0.84, -16.44);
  for (const z of [-16.9, -16.0]) c.K.box(X.t_chrome, x1 - 0.5, 0.75, z - 0.06, x1 - 0.48, 0.77, z + 0.06);
  c.col(x1 - 0.48, 0, -17.3, x1, 0.9, -15.6, SURF.metal);
  radioCharger(c, x1 - 0.26, 0.9, -16.45, -PI / 2, { n: 8, taken: [0, 1, 3, 4, 6] });
  statusBoard(c, x1, 1.75, -16.45, 'w', {
    w: 1.15, title: 'SITE STATUS · 03:14',
    rows: [['MAIN POWER', 'GENERATOR', 'warn'], ['CONTAINMENT C-01', 'SEALED', 'ok'], ['CONTAINMENT C-02', 'BREACH', 'bad'], ['ISOLATION WARD', 'NO RESPONSE', 'bad'], ['VENTILATION', 'REDUCED', 'warn'], ['LIFTS · SURFACE', 'LOCKED OUT', 'bad'], ['NORTH WING', 'SEALED', 'ok']],
  });
  // the situation table by the quarters' door: the lit plan, radios, a procedures binder
  L.briefingTable(c, 21.6, -16.9, 2.0, 1.0, { spaces, here: 'ops', light: true });
  c.K.box(M.red, 21.0, 0.95, -17.2, 21.32, 0.99, -16.98);
  c.label('EMERGENCY PROCEDURES · PROTOCOL 7', 21.16, 0.992, -17.09, 'up', 0.28, 0.18, { ...DANGER, lines: ['PROTOCOL 7', 'LOCKDOWN', 'PROCEDURES'] });
  radioCharger(c, 22.3, 0.95, -16.6, 0.4, { n: 1, taken: [] });
  // the south-west: coffee, water, the switch by the server-room door
  L.coffeeStation(c, 17.1, z1, 'n', 1.2);
  L.waterCooler(c, x0, -16.3, 'e');
  L.lightSwitch(c, x0, -22.3, 'e');
  // the south wall east of the blast door: a printer, the log cabinet
  Fac.printerStand(c, 23.9, -15.3, 'n');
  Fac.filingCabinet(c, 22.85, -15.33, 'n', { open: 1 });
  // the north-west corner: a comms rack
  rackRow(c, [x0, -25.4, x0 + 0.9, -24.8], 'e', { first: 1, dead: 0 });
  c.label('COMMS · SURFACE LINK', x0 + 0.45, 1.85, -24.8, 's', 0.6, 0.08, PLATE);
  for (const [x, z, f] of [[x0, -15.6, 'e'], [x1, -17.6, 'w'], [22.0, z1, 'n']]) plate(c, x, 0.3, z, f, 'socket');
  roomTitle(c, 'OPERATIONS · CONTROL ROOM', x0, 2.75, -16.0, 'e', 1.6, '#2fb8c8');
  // left mid-lockdown
  floorPapers(c, 19.2, -18.1, 6, 0.7);
  c.K.add(M.black, torG(0.08, 0.008, 3, 10, PI), 23.9, 0.02, -21.8, [PI / 2, 0, 0.4]);
  c.decal('bloodDrag', 24.3, -19.1, 1.4, PI / 2);
  c.wallDecal('bloodSmear', x1, 1.1, -18.3, 'w', 0.5, 0.7);
  c.decal('footprints', 22.3, -19.0, 1.6, -PI / 2);
}

/**
 * The security office (the ring: dim, half wrecked): the CCTV wall over its control desk on the west wall, the duty
 * desk facing the door (the pickup's surface, a raised counter ledge on its door side), the arms rack and gun safes on
 * the south wall (signed out in a hurry, one safe forced), radios on charge, the key cabinet, a screening gate and the
 * detainee bench in the east. Somebody was held on that bench when it started.
 */
export function dressSecurity(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  // the CCTV wall and its desk (west)
  L.controlDesk(c, x0, -32.6, 'e', 2.8, { channels: ['N2 W', 'N2 E', 'ATRIUM', 'LABS', 'CELLS'], bad: ['CELLS', 'N2 E'], chairs: 2 });
  monitorWall(c, x0, -32.6, 'e', {
    cols: 4, rows: 3, mw: 0.62, mh: 0.36, y0: 1.52, title: 'CCTV · SECTOR 4 RING',
    feeds: [['CAM 04', 'N2 WEST'], null, ['CAM 07', 'ARMORY'], ['CAM 09', 'N2 EAST'], null, ['CAM 12', 'MORGUE'], ['CAM 16', 'CELLS'], null, ['CAM 18', 'LIFT LOBBY'], null, ['CAM 22', 'SECURITY']],
    dark: [6, 10], smashed: [4],
  });
  c.light(x0 + 0.5, 2.1, -32.6, 0.3, 2.2, [0.6, 0.85, 0.75], null, 4);
  // the duty desk, a raised counter ledge on its door side, the incident log
  techDesk(c, [-31, -33.4, -28, -32.4], 's', { keep: [-29.85, -33.3, -29.15, -32.5], purge: false });
  c.K.box(X.t_console, -31, 0.75, -33.4, -28, 1.08, -33.36);
  c.K.box(X.t_consoleTop, -31.04, 1.08, -33.47, -27.96, 1.11, -33.35);
  c.label('INCIDENT LOG · 03:02 CELLS ALARM · 03:05 C-02 · 03:09 ALL UNITS ARMED', -28.7, 0.752, -32.75, 'up', 0.3, 0.2, { ...NOTE, lines: ['INCIDENT LOG', '03:02 CELLS ALARM', '03:05 C-02 OPEN', '03:09 ALL UNITS', '   DRAW ARMS'], font: 'bold 24px Courier New', align: 'left' });
  // the south wall: coffee, the gun safes, the arms rack, radios on charge
  L.coffeeStation(c, -33.3, z1, 'n', 1.2);
  gunLocker(c, -31.6, z1, 'n', { open: 1.75, rifles: 0, name: 'SAFE 1' });
  gunLocker(c, -30.92, z1, 'n', { name: 'SAFE 2' });
  c.decal('scuff', -31.6, -29.9, 0.6, 0.3);
  weaponRack(c, -28.85, z1, 'n', { guns: [null, null, 'shotgun', null, null, 'rifle'] });
  P.cabinet(c, [-27.5, z1 - 0.5, -26.3, z1], 'n', { h: 0.9, mat: X.t_upsGrey, drawers: 2 });
  radioCharger(c, -26.9, 0.9, -29.25, PI, { n: 6, taken: [0, 1, 2, 4] });
  casings(c, -28.7, -30.3, 9, 0.5);
  // the east: the key cabinet, the screening gate, the detainee bench and what's left of the detainee's escort
  keyCabinet(c, x1, 1.55, -35.0, 'w', { open: 1.7, taken: 0.5 });
  metalDetector(c, -26.0, -34.3, 's', { on: false });
  holdingBench(c, x1, -32.6, 'w', { len: 1.8 });
  c.wallDecal('bloodSmear', x1, 0.95, -32.1, 'w', 0.7, 0.8);
  c.decal('blood', -24.9, -32.0, 1.1, 0.6);
  c.decal('bloodDrag', -25.6, -31.0, 1.6, 2.4);
  c.wallDecal('bullet', x1, 1.4, -33.6, 'w', 0.3, 0.3);
  c.wallDecal('bullet', -26.6, 1.7, z0, 's', 0.3, 0.3);
  // the north wall: first aid and an extinguisher west of the door, the notice board east of it
  L.firstAidBox(c, -33.2, 1.5, z0, 's');
  P.extinguisher(c, -32.4, z0, 's');
  L.noticeBoard(c, -25.0, 1.55, z0, 's', { w: 1.0, h: 0.7, notes: ['SHIFT ROTA', 'CODE 7 = LOCKDOWN'] });
  L.lightSwitch(c, -30.2, z0, 's');
  L.wallClock(c, -26.6, 2.55, z1, 'n');
  for (const [x, z, f] of [[x0, -30.4, 'e'], [-25.6, z1, 'n'], [x1, -30.2, 'w']]) plate(c, x, 0.3, z, f, 'socket');
  roomTitle(c, 'SECURITY · SECTOR 4', -30.2, 2.55, z1, 'n', 1.4, '#c63a2e');
  // the wreck: a chair over, papers, a dead radio, a monitor's glass
  opsChair(c, -27.3, 0, -31.4, 2.2, { down: true, mat: M.black });
  floorPapers(c, -29.6, -34.2, 5, 0.6);
  c.K.cube(X.t_polymer, -27.9, 0.02, -33.9, 0.06, 0.035, 0.16, 1.1);
  c.decal('glass', x0 + 0.95, -32.9, 0.7, 0.4);
  c.decal('footprints', -29.0, -35.2, 1.4, 0);
}

/**
 * The maintenance workshop and plant room: the standby generator mid-service in the middle (a panel off, a work light
 * on it, oil under it), the pumps and their manifold on the east wall, the LV board and distribution boards north-east,
 * the battery charging bay with its eyewash north-west, the workbench, tool wall, drill press, bins and spares along the
 * south wall, drums in the south-east corner, a caged ladder to the roof hatch, pipe runs overhead.
 */
export function dressMaint(c, s, ctx) {
  const { M, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  // the generator, its oil, the work light on it, a toolbox open beside it
  generator(c, 23.4, -31.0, 'n', { len: 3.8, ceil: h });
  c.decal('oil', 23.0, -30.0, 1.3, 0.4);
  c.decal('oil', 24.6, -29.6, 0.7, 1.9);
  workLight(c, 23.0, -28.9, PI + 0.25);
  c.K.box(M.red, 21.75, 0, -29.55, 22.3, 0.22, -29.2);
  c.K.box(M.red, 21.75, 0.22, -29.6, 22.3, 0.25, -29.42);
  c.col(21.75, 0, -29.55, 22.3, 0.25, -29.2, SURF.metal);
  for (let k = 0; k < 3; k++) c.K.cube(M.steel, 22.5 + k * 0.12, 0.01, -29.1 - k * 0.07, 0.2, 0.015, 0.03, rnd() * 3);
  // the pumps (east wall), pipe runs over them and along the south wall
  pumpSet(c, x1, -31.0, 'w', { n: 2, ceil: h, name: 'CHILLED WATER' });
  P.pipeRun(c, x1 - 0.3, z0 + 0.6, x1 - 0.3, z1 - 0.4, h - 0.45, 3, 0);
  P.pipeRun(c, x1 - 0.6, z1 - 0.12, x0 + 0.4, z1 - 0.12, h - 0.6, 4, 0); // (run westward: the bundle stacks off the wall)
  stepLadder(c, 32.0, -33.7, 0.4);
  // the electrics north-east of the door
  breakerPanel(c, 32.6, z0, 's', { n: 2, open: 1, ceil: h });
  sign(c, ['HEARING', 'PROTECTION', 'REQUIRED'], 31.15, 2.3, z0, 's', 0.32, 0.3, MANDATORY);
  // the battery bay north-west: charger, eyewash, the pallet truck parked
  batteryCharger(c, 21.0, z0, 's');
  L.eyewash(c, x0, -33.2, 'e');
  palletJack(c, 21.0, -33.5, PI / 2 + 0.15);
  P.extinguisher(c, x0, -35.4, 'e');
  L.firstAidBox(c, x0, 1.5, -34.5, 'e');
  // the south wall: bench and tool wall, drill press, bins, spares; drums in the corner
  workbench(c, 22.3, z1, 'n', { len: 2.2 });
  toolWall(c, 22.3, z1, 'n', { w: 2.0, y0: 1.15, h: 0.95 });
  drillPress(c, 24.3, -26.4, 'n');
  partsBins(c, 25.8, z1, 'n', { w: 1.2 });
  binShelf(c, 27.9, z1, 'n', { w: 1.8, kind: 'tools', looted: 0.2 });
  P.drum(c, 33.3, -26.4, { mat: M.blue });
  P.drum(c, 32.65, -26.45, { mat: M.yellow });
  P.drum(c, 33.35, -27.05, { mat: M.red });
  P.drum(c, 31.75, -27.1, { down: true, mat: M.yellow });
  c.decal('oil', 31.2, -27.5, 1.2, 0.8);
  c.decal('puddle', 31.6, -27.9, 0.9, 0.3);
  // the caged ladder to the roof hatch (west wall), the hatch frame
  L.ladder(c, x0, -28.4, 'e', h - 1.05, { w: 0.5, cageFrom: 2.3 });
  c.K.box(M.dark, x0, h - 0.04, -28.9, x0 + 0.9, h, -27.9);
  c.K.box(M.yellow, x0 + 0.05, h - 0.06, -28.85, x0 + 0.85, h - 0.04, -27.95, { faces: ['ny'] });
  // signs, fittings
  roomTitle(c, 'PLANT ROOM B4 · AUTHORISED ONLY', 26.3, 3.0, z1, 'n', 1.7, '#e0b81e');
  L.wallClock(c, 29.6, 3.0, z1, 'n');
  L.lightSwitch(c, 24.8, z0, 's');
  sign(c, ['DANGER', 'PLANT MAY START', 'WITHOUT WARNING'], 29.3, 3.05, z0, 's', 0.5, 0.26);
  for (const [x, z, f] of [[x0, -31.0, 'e'], [29.5, z1, 'n'], [x1, -34.4, 'w']]) plate(c, x, 0.4, z, f, 'socket');
  floorPapers(c, 26.4, -32.8, 3, 0.4);
  c.decal('footprints', 26.6, -33.5, 1.5, 0.1);
}

/**
 * The stores: pallet racking down the west wall, the wire cage of controlled stock in the south-east (its door hanging
 * open, its shelves picked over), the goods-in counter with its scale on the east wall, PPE shelving on the south
 * wall, a pallet left on its truck in the aisle. People came for supplies in a hurry: gaps, torn cartons, a stack over.
 */
export function dressStores(c, s, ctx) {
  const { M, X, rnd } = c;
  const { x0, z0, x1, z1, h } = s;
  palletRack(c, [x0, 3.3, x0 + 1.1, z1 - 0.1], 'e', { levels: [1.2, 2.3], h: 3.0, bays: 5, empty: [[1, 0], [3, 1], [4, 0]] });
  // the cage: shelves of the controlled stock inside, its door open
  wireCage(c, [-17.8, 7.6, x1, z1], { h: 2.4, sides: 'nw', door: ['w', 8.3, 9.3, 1.2] });
  binShelf(c, x1, 8.9, 'w', { w: 1.8, d: 0.5, kind: 'med', looted: 0.55 });
  binShelf(c, -16.6, z1, 'n', { w: 1.6, d: 0.5, kind: 'ppe', looted: 0.6 });
  c.label('CONTROLLED STOCK · MEDICAL', -16.4, 2.25, 7.6, 'n', 0.7, 0.09, DANGER);
  // the goods-in counter, the pallet waiting for it
  shippingCounter(c, x1, 4.9, 'w', { len: 2.4, d: 0.8 });
  pallet(c, -16.3, 6.75, 0, { w: 1.1, d: 0.75, load: 'wrap', h: 0.8, label: 'K-7 MEDIA · KEEP COOL' });
  // the PPE shelving (south wall), a step ladder against it
  binShelf(c, -19.4, z1, 'n', { w: 1.8, d: 0.5, kind: 'ppe', looted: 0.45 });
  stepLadder(c, -18.05, z1, PI, { folded: true });
  // a pallet of water left on its truck in the aisle
  pallet(c, -20.2, 7.0, PI / 2, { w: 1.2, d: 0.8, load: 'water' });
  palletJack(c, -19.75, 7.0, -PI / 2, { handle: 0.15 });
  // the grab: a stack knocked over, a carton torn open, ration packs spilled
  for (const [x, z, a, y] of [[-18.9, 9.6, 0.4, 0.15], [-18.4, 10.0, 1.3, 0.15], [-18.75, 9.85, 0.2, 0.45]]) c.K.add(X.t_kraft, rbox(0.42, 0.3, 0.34), x, y, z, [0, a, y > 0.2 ? 0.3 : 0]);
  c.col(-19.15, 0, 9.35, -18.15, 0.3, 10.25, SURF.cardboard);
  for (let k = 0; k < 8; k++) c.K.add(pick(c, [M.green, X.t_kraft, M.yellow]), rbox(0.12, 0.03, 0.18), -18.3 + jit(c, 0.4), 0.015, 9.2 + jit(c, 0.35), [0, rnd() * 3, 0]);
  floorPapers(c, -17.4, 5.2, 4, 0.5);
  c.decal('footprints', -18.3, 4.2, 1.4, PI);
  c.decal('scuff', -19.4, 6.0, 1.6, 0.2);
  // the walls: the stock board, extinguisher, switch, clock, sockets, the title
  L.noticeBoard(c, -21.3, 1.6, z0, 's', { w: 1.0, h: 0.7, notes: ['STOCK TAKE FRI', 'K-7 MEDIA → COLD'] });
  P.extinguisher(c, -15.95, z0, 's');
  L.lightSwitch(c, -19.25, z0, 's');
  L.wallClock(c, x1, 2.6, 3.3, 'w');
  for (const [x, z, f] of [[x1, 6.4, 'w'], [-17.0, z1, 'n']]) plate(c, x, 0.3, z, f, 'socket');
  roomTitle(c, 'STORES · GOODS IN', x1, 2.55, 5.0, 'w', 1.3, '#e0661c');
  sign(c, ['PALLET TRUCKS', 'KEEP AISLES CLEAR'], -20.1, 2.65, z0, 's', 0.46, 0.18);
}

/**
 * The archive (long and narrow): two blocks of rolling shelving worked from the central aisle, each with one aisle
 * wound open; fixed shelving down the east wall either side of the door; in the middle, filing cabinets (one over),
 * the microfiche station and the reading desk under its lamp, a book trolley. Water has got in at the north end:
 * soaked, slumped boxes, a bucket under the drip, mould; files dropped all the way to the door.
 */
export function dressArchive(c, s, ctx) {
  const { M, X } = c;
  const { x0, z0, x1, z1, h } = s;
  // the rolling blocks (north: open after unit 5, wet at the leak; south: open after unit 3)
  mobileShelving(c, [x0 + 0.1, z0 + 0.1, 37.4, -24.2], 'e', { n: 8, openAt: 4, aisle: 0.9, show: 's', wet: [4, 5, 7], labels: ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'R-06', 'R-07', 'R-08'] });
  mobileShelving(c, [x0 + 0.1, -18.2, 37.4, z1 - 0.1], 'e', { n: 8, openAt: 2, aisle: 0.9, show: 'n', labels: ['K-01', 'K-02', 'K-03', 'K-04', 'K-05', 'K-06', 'K-07', 'K-08'] });
  for (const z of [-24.18, -18.22]) c.K.box(M.yellow, x0 + 0.1, 0, z - 0.03, 37.4, 0.004, z + 0.03, { faces: ['py'] });
  stepLadder(c, 35.9, -26.47, PI / 2);
  // the east wall's fixed shelving either side of the door
  archiveShelf(c, x1, -27.0, 'w', { w: 5.8, wet: 2 });
  archiveShelf(c, x1, -15.3, 'w', { w: 5.4 });
  // the middle: filing cabinets (one fallen), the fiche station, the reading desk, a trolley
  [-23.75, -23.25, -22.75].forEach((z, i) => Fac.filingCabinet(c, x0 + 0.31, z, 'e', { open: i === 1 ? 2 : -1 }));
  Fac.filingCabinet(c, 35.65, -22.1, 'e', { down: true });
  microficheReader(c, x0, -19.6, 'e');
  readingDesk(c, 36.4, -21.0, 's', { slip: 'K-7 TRIAL · 1994-97' });
  bookTrolley(c, 36.65, -23.55, 0.15);
  // the leak at the north end: drip, bucket, puddles, soaked boxes, mould
  c.decal('puddle', 38.3, -26.3, 1.6, 0.4);
  c.decal('puddle', 36.9, -26.5, 1.0, 1.4);
  c.decal('stain', 38.8, -28.4, 1.4, 0.9);
  c.K.add(M.grey, cylG(0.13, 0.15, 0.28, 12, true), 38.25, 0.14, -26.25);
  c.K.add(c.U.glass, cylG(0.125, 0.125, 0.004, 12), 38.25, 0.2, -26.25);
  for (const [x, z, a] of [[38.6, -27.2, 0.5], [38.1, -27.6, 1.7], [38.9, -25.6, 2.6]]) c.K.add(X.t_wet, rbox(0.38, 0.2, 0.33, 0.03), x, 0.1, z, [0.12, a, -0.1]);
  floorPapers(c, 38.4, -27.0, 6, 0.6);
  c.wallDecal('mold', x1, 2.6, -28.6, 'w', 1.2, 0.9);
  c.wallDecal('stain', x1, 2.4, -26.0, 'w', 0.8, 1.2);
  c.wallDecal('mold', 36.0, 2.7, z0, 's', 1.4, 0.8);
  // files dropped on the way out
  floorPapers(c, 37.6, -21.6, 5, 0.6);
  floorPapers(c, 38.9, -20.4, 4, 0.5);
  c.decal('footprints', 38.2, -21.0, 1.4, -PI / 2);
  c.K.add(X.t_box, rbox(0.33, 0.26, 0.38), 37.95, 0.13, -20.2, [0, 0.7, 0]);
  // the walls: title, notices, clock, switch, sockets
  roomTitle(c, 'RECORDS ARCHIVE · RESTRICTED', x0, 2.55, -21.6, 'e', 1.6, '#8a6b44');
  sign(c, ['NO NAKED FLAMES', 'NO SMOKING'], x0, 1.95, -21.0, 'e', 0.36, 0.14, DANGER);
  L.wallClock(c, x0, 2.35, -19.6, 'e');
  L.noticeBoard(c, x0, 1.4, -20.95, 'e', { w: 0.7, h: 0.45, notes: ['RETENTION 25 Y'] });
  L.lightSwitch(c, x1, -22.25, 'w');
  for (const [x, z, f] of [[x0, -22.3, 'e'], [x0, -18.6, 'e']]) plate(c, x, 0.3, z, f, 'socket');
  P.extinguisher(c, x1, -23.95, 'w');
}
