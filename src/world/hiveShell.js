// The Hive's fittings that belong to the building rather than to a room's furniture: door leaves and card readers, the
// ceiling's sprinklers, vents, ducts and smoke detectors, exit signs, and the grime pass (traffic scuffs, leaks, mold,
// blood trails, dropped papers) laid over floors and walls from the plan. Everything goes into the level's Kit.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { hiveMat } from './hiveTex.js';
import { FACE_YAW } from './hiveProps.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const hashOf = (a, b) => {
  let h = Math.imul(Math.round(a * 37) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.round(b * 41) + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  return (Math.imul(h, 0x2c1b3c6d) >>> 0) / 4294967296;
};

/** materials of the fittings (baked-lit) */
export function shellFittings() {
  const m = (color, rough = 0.6, metal = 0, extra = {}) => hiveMat({ color, roughness: rough, metalness: metal, ...extra });
  return {
    doorWood: m(0x7d5634, 0.55),
    doorWoodDark: m(0x4f3220, 0.5),
    doorWhite: m(0xdfe2e3, 0.5),
    doorSteel: m(0x8d959b, 0.4, 0.6),
    doorGreen: m(0x4b6d5b, 0.5, 0.2),
    doorGrey: m(0x6f777d, 0.5, 0.35),
    duct: m(0xa5adb2, 0.42, 0.65),
    ductDark: m(0x5a6268, 0.5, 0.5),
    plastic: m(0xe6e7e2, 0.5),
    rubber: m(0x1c1d1e, 0.85),
    brass: m(0xb18f45, 0.35, 0.8),
  };
}

// ---------------------------------------------------------------- doors
/**
 * A door leaf standing open flat against the wall beside each doorway (they have no collider: the opening stays clear),
 * a lever, hinges, a kick plate, a vision panel, a card reader with its LED; a few doors have lost their leaf.
 */
export function doorLeaves(ctxOf, { doorInfo, spaceAt, F }) {
  const T = 0.045;
  for (const d of doorInfo) {
    if (d.kind !== 'door') continue;
    const c = ctxOf(d.f ?? 0); // (the floor it stands on: the context is moved up to it)
    const { K, M, U, rnd } = c;
    const y = (d.f ?? 0) + 0.5;
    const A = d.alongX ? spaceAt(d.cx, d.z0 - 0.3, y) : spaceAt(d.x0 - 0.3, d.cz, y);
    const B = d.alongX ? spaceAt(d.cx, d.z1 + 0.3, y) : spaceAt(d.x1 + 0.3, d.cz, y);
    if (!A || !B) continue;
    const public_ = (s) => s.kind === 'corridor' || s.kind === 'hub';
    // which room the door swings into (a room, not the corridor)
    const intoB = public_(A) && !public_(B) ? true : public_(B) && !public_(A) ? false : rnd() < 0.5;
    const room = intoB ? B : A;
    const other = intoB ? A : B;
    const hingeMin = rnd() < 0.5;
    const w = (d.alongX ? d.x1 - d.x0 : d.z1 - d.z0) - 0.14; // between the frame's jambs
    const h = d.h - 0.09;
    const kind = room.kind;
    const mat = ['office', 'quarters', 'conf'].includes(kind) ? F.doorWood : kind === 'director' ? F.doorWoodDark : ['lab', 'genomics', 'infirmary', 'isolation', 'decon', 'wc', 'lockers', 'kitchen', 'cafe', 'nadja'].includes(kind) ? F.doorWhite : ['morgue', 'specimen'].includes(kind) ? F.doorGreen : ['holding', 'server', 'ops', 'security', 'maint', 'waste', 'archive', 'stores', 'cryo'].includes(kind) ? F.doorSteel : F.doorGrey;
    const angle = THREE.MathUtils.degToRad(166 + rnd() * 12); // (nearly flat against the wall)
    const gone = rnd() < 0.12;
    // pivot on the room-facing wall plane, in the room
    const plane = d.alongX ? (intoB ? d.z1 + 0.05 : d.z0 - 0.05) : intoB ? d.x1 + 0.05 : d.x0 - 0.05;
    const hinge = d.alongX ? (hingeMin ? d.x0 + 0.07 : d.x1 - 0.07) : hingeMin ? d.z0 + 0.07 : d.z1 - 0.07;
    // the leaf direction in (a = along the opening, b = into the room)
    const sa = hingeMin ? 1 : -1, sb = intoB ? 1 : -1;
    const da = Math.cos(angle) * sa, db = Math.sin(angle) * sb;
    const dx = d.alongX ? da : db, dz = d.alongX ? db : da;
    const yaw = Math.atan2(-dz, dx);
    const px = d.alongX ? hinge : plane, pz = d.alongX ? plane : hinge;
    if (!gone) {
      const body = new THREE.BoxGeometry(w, h, T).translate(w / 2, h / 2, 0);
      c.K.add(mat, body, px, 0.02, pz, [0, yaw, 0]);
      // kick plate, vision panel, lever, hinges
      c.K.add(F.doorSteel, new THREE.BoxGeometry(w - 0.06, 0.24, T + 0.006).translate(w / 2, 0.16, 0), px, 0.02, pz, [0, yaw, 0]);
      const glassy = ['lab', 'genomics', 'infirmary', 'isolation', 'morgue', 'decon', 'holding', 'specimen', 'server', 'ops', 'nadja', 'waste'].includes(kind);
      if (glassy) {
        c.K.add(F.rubber, new THREE.BoxGeometry(0.3, 0.55, T + 0.008).translate(w * 0.55, 1.65, 0), px, 0.02, pz, [0, yaw, 0]);
        c.K.add(U.glass, new THREE.BoxGeometry(0.24, 0.49, T + 0.012).translate(w * 0.55, 1.65, 0), px, 0.02, pz, [0, yaw, 0]);
      }
      const lx = w * 0.9;
      c.K.add(F.brass, new THREE.BoxGeometry(0.13, 0.022, 0.05).translate(lx, 1.02, 0), px, 0.02, pz, [0, yaw, 0]);
      c.K.add(F.rubber, new THREE.CylinderGeometry(0.02, 0.02, T + 0.05, 8).rotateX(Math.PI / 2).translate(lx + 0.06, 1.02, 0), px, 0.02, pz, [0, yaw, 0]);
      for (const y of [0.25, 1.0, 1.85]) c.K.add(M.dark, new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6).translate(0, y, 0), px, 0.02, pz, [0, yaw, 0]);
      // a door closer arm
      if (rnd() < 0.5) c.K.add(M.dark, new THREE.BoxGeometry(0.42, 0.04, 0.03).translate(w * 0.3, h - 0.08, T / 2 + 0.02), px, 0.02, pz, [0, yaw, 0]);
    }
    // the card reader on the wall on the latch side of the frame, on the corridor side
    const spot = (s, side) => {
      // side: the space the reader faces into
      const off = 0.32;
      const latchMin = !hingeMin;
      const a = d.alongX ? (latchMin ? d.x0 - off : d.x1 + off) : latchMin ? d.z0 - off : d.z1 + off;
      const wallPlane = d.alongX ? (side === 'B' ? d.z1 : d.z0) : side === 'B' ? d.x1 : d.x0;
      const dir = side === 'B' ? 1 : -1;
      return { a, wallPlane, dir };
    };
    for (const side of ['A', 'B']) {
      if (rnd() < 0.35) continue;
      const { a, wallPlane, dir } = spot(null, side);
      const led = rnd() < 0.7 ? U.ledR : U.ledG;
      if (d.alongX) {
        K.box(F.plastic, a - 0.04, 1.15, wallPlane + dir * 0.006, a + 0.04, 1.29, wallPlane + dir * 0.034);
        K.box(led, a - 0.012, 1.26, wallPlane + dir * 0.034, a + 0.012, 1.275, wallPlane + dir * 0.038);
        K.box(M.black, a - 0.03, 1.17, wallPlane + dir * 0.034, a + 0.03, 1.22, wallPlane + dir * 0.037);
      } else {
        K.box(F.plastic, wallPlane + dir * 0.006, 1.15, a - 0.04, wallPlane + dir * 0.034, 1.29, a + 0.04);
        K.box(led, wallPlane + dir * 0.034, 1.26, a - 0.012, wallPlane + dir * 0.038, 1.275, a + 0.012);
        K.box(M.black, wallPlane + dir * 0.034, 1.17, a - 0.03, wallPlane + dir * 0.037, 1.22, a + 0.03);
      }
    }
    void other;
  }
}

// ---------------------------------------------------------------- ceilings
/**
 * Sprinkler heads, return-air grilles, smoke detectors, speakers; exposed ducts under the concrete ceilings;
 * exit signs over the corridor ends. `spaces` with their finish, `panelGrid(s)` the light panels' lattice.
 */
export function ceilingFixtures(ctxOf, { spaces, finOf, F, floorOf = () => 0, skip = () => false }) {
  for (const s of spaces) {
    if (skip(s)) continue;
    fixturesOf(ctxOf(floorOf(s)), s, finOf, F);
  }
}
function fixturesOf(c, s, finOf, F) {
  const { K, M, U, rnd } = c;
  const sprinkler = (x, y, z) => {
    K.cyl(M.steel, x, y - 0.035, z, 0.011, 0.011, 0.035, 6);
    K.cyl(M.steel, x, y - 0.047, z, 0.028, 0.028, 0.006, 10);
    K.cyl(M.red, x, y - 0.058, z, 0.007, 0.007, 0.012, 6);
  };
  const smoke = (x, y, z) => {
    K.cyl(F.plastic, x, y - 0.045, z, 0.06, 0.06, 0.045, 12);
    K.cyl(M.dark, x, y - 0.052, z, 0.03, 0.03, 0.008, 10);
    K.cyl(U.ledR, x + 0.045, y - 0.05, z, 0.006, 0.006, 0.006, 6);
  };
  const grille = (x, y, z, alongX = true) => {
    const w = 0.6;
    K.box(M.dark, x - w / 2, y - 0.03, z - w / 2, x + w / 2, y, z + w / 2);
    for (let i = 0; i < 6; i++) {
      const o = -w / 2 + 0.06 + i * 0.096;
      if (alongX) K.box(F.plastic, x - w / 2 + 0.03, y - 0.05, z + o - 0.012, x + w / 2 - 0.03, y - 0.03, z + o + 0.012);
      else K.box(F.plastic, x + o - 0.012, y - 0.05, z - w / 2 + 0.03, x + o + 0.012, y - 0.03, z + w / 2 - 0.03);
    }
  };
  const duct = (x0, z0, x1, z1, y, wd, ht, mat) => {
    const alongX = Math.abs(x1 - x0) >= Math.abs(z1 - z0);
    const len = alongX ? x1 - x0 : z1 - z0;
    const bx0 = alongX ? Math.min(x0, x1) : x0 - wd / 2, bx1 = alongX ? Math.max(x0, x1) : x0 + wd / 2;
    const bz0 = alongX ? z0 - wd / 2 : Math.min(z0, z1), bz1 = alongX ? z0 + wd / 2 : Math.max(z0, z1);
    K.box(mat, bx0, y - ht, bz0, bx1, y, bz1);
    const n = Math.max(1, Math.round(Math.abs(len) / 1.5));
    for (let i = 0; i <= n; i++) {
      const u = (alongX ? bx0 : bz0) + (Math.abs(len) * i) / n;
      // flanges and a pair of hangers
      if (alongX) {
        K.box(F.ductDark, u - 0.02, y - ht - 0.02, bz0 - 0.03, u + 0.02, y + 0.02, bz1 + 0.03);
        for (const zz of [bz0 - 0.02, bz1 + 0.02]) K.cyl(M.steel, u, y, zz, 0.008, 0.008, 0.4, 5);
      } else {
        K.box(F.ductDark, bx0 - 0.03, y - ht - 0.02, u - 0.02, bx1 + 0.03, y + 0.02, u + 0.02);
        for (const xx of [bx0 - 0.02, bx1 + 0.02]) K.cyl(M.steel, xx, y, u, 0.008, 0.008, 0.4, 5);
      }
    }
  };
  {
    const fin = finOf(s);
    const w = s.x1 - s.x0, d = s.z1 - s.z0, corridor = s.kind === 'corridor';
    const exposed = fin.ceil === 'concrete' || fin.ceil === 'concreteDark';
    if (corridor) {
      const alongX = w > d;
      const L = alongX ? w : d;
      const n = Math.max(1, Math.round(L / 4));
      for (let i = 1; i < n; i++) {
        const u = (alongX ? s.x0 : s.z0) + (L * i) / n;
        const off = i % 2 ? 0.7 : -0.7;
        const x = alongX ? u : (s.x0 + s.x1) / 2 + off, z = alongX ? (s.z0 + s.z1) / 2 + off : u;
        sprinkler(x, s.h, z);
        if (i % 3 === 0) grille(x + (alongX ? 0 : -off * 2), s.h, z + (alongX ? -off * 2 : 0), alongX);
      }
      // smoke detectors every ~9 m, a speaker at the ends
      for (let i = 0; i < Math.floor(L / 9); i++) {
        const u = (alongX ? s.x0 : s.z0) + 4.5 + i * 9;
        smoke(alongX ? u : (s.x0 + s.x1) / 2 + 0.9, s.h, alongX ? (s.z0 + s.z1) / 2 + 0.9 : u);
      }
      if (s.zone !== 'ring' && exposed) {
        // a duct along one side of the corridor
        const dz = alongX ? s.z0 + 0.7 : s.x0 + 0.7;
        if (alongX) duct(s.x0 + 0.3, dz, s.x1 - 0.3, dz, s.h - 0.2, 0.55, 0.38, F.duct);
        else duct(dz, s.z0 + 0.3, dz, s.z1 - 0.3, s.h - 0.2, 0.55, 0.38, F.duct);
      }
      return;
    }
    const nx = Math.max(1, Math.round(w / 3.6)), nz = Math.max(1, Math.round(d / 3.6));
    let k = 0;
    for (let a = 1; a < nx; a++) {
      for (let b = 1; b < nz; b++) {
        const x = s.x0 + (w * a) / nx, z = s.z0 + (d * b) / nz;
        if (k++ % 2) grille(x, s.h, z);
        else sprinkler(x, s.h, z);
      }
    }
    if (nx === 1 || nz === 1) {
      // a single row of panels: sprinklers midway between them and on the ends
      const alongX = nz === 1;
      const n = alongX ? nx : nz;
      for (let i = 0; i <= n; i++) {
        const u = alongX ? s.x0 + (w * i) / nx : s.z0 + (d * i) / nz;
        if (i === 0 || i === n) continue;
        sprinkler(alongX ? u : (s.x0 + s.x1) / 2, s.h, alongX ? (s.z0 + s.z1) / 2 : u);
      }
      sprinkler((s.x0 + s.x1) / 2, s.h, (s.z0 + s.z1) / 2);
    }
    smoke((s.x0 + s.x1) / 2 + 0.6, s.h, (s.z0 + s.z1) / 2 - 0.9);
    // rooms with an exposed concrete ceiling get their ductwork
    if (exposed && s.h >= 3.2) {
      const alongX = w >= d;
      const y = s.h - 0.15;
      if (alongX) {
        duct(s.x0 + 0.4, s.z0 + 1.0, s.x1 - 0.4, s.z0 + 1.0, y, 0.6, 0.42, F.duct);
        if (d > 7) duct(s.x0 + 0.4, s.z1 - 1.0, s.x1 - 0.4, s.z1 - 1.0, y, 0.45, 0.32, F.ductDark);
      } else {
        duct(s.x0 + 1.0, s.z0 + 0.4, s.x0 + 1.0, s.z1 - 0.4, y, 0.6, 0.42, F.duct);
        if (w > 7) duct(s.x1 - 1.0, s.z0 + 0.4, s.x1 - 1.0, s.z1 - 0.4, y, 0.45, 0.32, F.ductDark);
      }
    }
  }
  void rnd;
}

// ---------------------------------------------------------------- grime
/**
 * Wear and story on floors and walls, from the plan: traffic scuffs in every doorway, dirt in the corners, leaks and mold
 * (more in the ring and the plant rooms), blood trails through doors, dropped papers and glass.
 */
export function grimePass(ctxOf, { spaces, doorInfo, spaceAt, floorOf = () => 0, skip = () => false }) {
  const rnd = ctxOf(0).rnd;
  const ring = (s) => s.zone === 'ring';
  // doorways: scuffs on both sides, a dirty threshold
  for (const d of doorInfo) {
    if (d.kind === 'balcony' || d.kind === 'fwindow' || d.kind === 'opening') continue;
    const c = ctxOf(d.f ?? 0);
    const along = d.alongX ? d.x1 - d.x0 : d.z1 - d.z0;
    for (const t of [-1, 1]) {
      const x = d.alongX ? d.cx : d.cx + t * 0.9, z = d.alongX ? d.cz + t * 0.9 : d.cz;
      c.decal('scuff', x, z, Math.min(2.4, along * 1.2 + 0.6), d.alongX ? 0 : Math.PI / 2, { aspect: 0.6 });
    }
    if (rnd() < 0.35) c.decal('grime', d.cx + (rnd() - 0.5) * 0.8, d.cz + (rnd() - 0.5) * 0.8, 1.6, rnd() * 6);
  }
  for (const s of spaces) {
    if (skip(s)) continue;
    const c = ctxOf(floorOf(s));
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    const wear = ring(s) ? 1.8 : s.kind === 'maint' || s.kind === 'waste' || s.kind === 'stores' || s.kind === 'holding' ? 1.4 : 0.9;
    const area = w * d;
    // floors: grime at the wall foot, oil and stains, cracks in the ring
    const n = Math.round((area / 30) * wear) + 1;
    for (let i = 0; i < n; i++) {
      const x = s.x0 + 0.5 + rnd() * (w - 1), z = s.z0 + 0.5 + rnd() * (d - 1);
      const r = rnd();
      if (r < 0.4) c.decal('stain', x, z, 0.8 + rnd() * 1.2, rnd() * 6);
      else if (r < 0.6) c.decal('scuff', x, z, 1.2 + rnd(), rnd() * 6, { aspect: 0.7 });
      else if (r < 0.75 && (s.kind === 'maint' || s.kind === 'waste' || s.kind === 'stores' || ring(s))) c.decal('oil', x, z, 0.8 + rnd(), rnd() * 6);
      else if (r < 0.9 && (ring(s) || wear > 1)) c.decal('crack', x, z, 1.6 + rnd() * 1.4, rnd() * 6, { aspect: 0.5 });
      else c.decal('grime', x, z, 1.5 + rnd(), rnd() * 6);
    }
    // walls: leaks and mold on the high end of the scale
    const nw = Math.round((w + d) / 6 * wear * 0.8);
    for (let i = 0; i < nw; i++) {
      const side = ['n', 's', 'e', 'w'][Math.floor(rnd() * 4)];
      const along = rnd();
      const x = side === 'w' ? s.x0 : side === 'e' ? s.x1 : s.x0 + 0.6 + along * (w - 1.2);
      const z = side === 'n' ? s.z0 : side === 's' ? s.z1 : s.z0 + 0.6 + along * (d - 1.2);
      const face = { n: 's', s: 'n', e: 'w', w: 'e' }[side];
      const kind = rnd() < (ring(s) ? 0.4 : 0.15) ? 'mold' : rnd() < 0.7 ? 'leak' : 'stain';
      const hh = kind === 'leak' ? 1.8 : 0.9;
      if (kind === 'leak') c.wallDecal('leak', x, Math.min(s.h - 1.0, 1.9 + rnd() * 0.4), z, face, 0.6 + rnd() * 0.5, 1.9);
      else c.wallDecal(kind, x, hh + rnd() * 1.0, z, face, 1 + rnd() * 1.4, 1 + rnd() * 1.2);
    }
  }
}
export { FACE_YAW };
