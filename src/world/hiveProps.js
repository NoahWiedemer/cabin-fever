// The Hive's furniture and fittings (world/hive.js): lab benches, fume hoods, shelving, desks, lockers, vats,
// specimen tubes, server racks, cafeteria tables, the morgue's cold chambers, the maintenance plant, pipes, signs
// and the ceiling panels (their light is baked, see hive.js). Everything is world-space geometry for the Kit (one
// mesh per material, baked light), plus a collider for whatever you'd bump into.
//
// c: { K (Kit), M (baked materials), U (glowing / glass ones), rnd, col(x0, y0, z0, x1, y1, z1, surf, flags, tag),
//      light(x, y, z, i, r, rgb, dir, range) (a baked light), lamp(opts) (a pooled real one), sign(key, ...) }
// Rects are [x0, z0, x1, z1]; `face` is the side a thing opens / looks toward: 'n' (-z), 's' (+z), 'w' (-x), 'e' (+x).
import * as THREE from 'three';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { bottleShape, testTube, erlenmeyer, erlenLiquid } from './lab.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const FACE_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 };
const COOL = [0.93, 0.97, 1.0];
const DOWN = [0, -1, 0];

/** the rect's front edge line for `face`: { x, z } of its middle, the unit normal (nx, nz) and the along-axis */
function frontOf([x0, z0, x1, z1], face) {
  if (face === 'n') return { x: (x0 + x1) / 2, z: z0, nx: 0, nz: -1, alongX: true, len: x1 - x0 };
  if (face === 's') return { x: (x0 + x1) / 2, z: z1, nx: 0, nz: 1, alongX: true, len: x1 - x0 };
  if (face === 'w') return { x: x0, z: (z0 + z1) / 2, nx: -1, nz: 0, alongX: false, len: z1 - z0 };
  return { x: x1, z: (z0 + z1) / 2, nx: 1, nz: 0, alongX: false, len: z1 - z0 };
}

/** glassware on a surface at height y over the rect (a few bottles, a flask, a tube rack) */
export function glassware(c, [x0, z0, x1, z1], y, n = 4) {
  const { K, M, U, rnd } = c;
  const liquids = [U.blue, U.green, U.amber, U.magenta, U.cyan];
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.12 + rnd() * (x1 - x0 - 0.24), z = z0 + 0.12 + rnd() * (z1 - z0 - 0.24);
    const k = rnd();
    if (k < 0.45) {
      const r = 0.03 + rnd() * 0.025, h = 0.12 + rnd() * 0.12;
      K.add(rnd() < 0.5 ? M.amber : M.white, bottleShape(r, h), x, y, z);
      K.cyl(M.black, x, y + h, z, r * 0.42, r * 0.42, 0.02, 10);
    } else if (k < 0.75) {
      K.add(U.glass, erlenmeyer(), x, y, z);
      K.add(liquids[Math.floor(rnd() * liquids.length)], erlenLiquid(), x, y + 0.002, z);
    } else {
      // a tube rack
      const ry = rnd() < 0.5 ? 0 : Math.PI / 2;
      K.cube(M.white, x, y + 0.02, z, 0.24, 0.01, 0.07, ry);
      K.cube(M.white, x, y + 0.075, z, 0.24, 0.01, 0.07, ry);
      for (let t = 0; t < 6; t++) {
        const o = -0.09 + t * 0.036;
        const tx = x + (ry ? 0 : o), tz = z + (ry ? o : 0);
        K.add(U.glass, testTube(), tx, y + 0.01, tz);
        K.cyl(liquids[(t + i) % liquids.length], tx, y + 0.013, tz, 0.0068, 0.0068, 0.025 + (t % 3) * 0.01, 8);
      }
    }
  }
}

/** a lab bench over the rect: white cabinets, a black top, a reagent shelf down its middle, glassware */
export function bench(c, r, { riser = true, gear = 5 } = {}) {
  const { K, M } = c;
  const [x0, z0, x1, z1] = r;
  const T = 0.92;
  K.box(M.white, x0 + 0.05, 0.1, z0 + 0.05, x1 - 0.05, 0.86, z1 - 0.05);
  K.box(M.dark, x0 + 0.08, 0, z0 + 0.08, x1 - 0.08, 0.1, z1 - 0.08);
  K.box(M.top, x0, 0.86, z0, x1, T, z1);
  const alongX = x1 - x0 >= z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.max(1, Math.round(len / 0.8));
  for (let i = 0; i < n; i++) {
    const u = (alongX ? x0 : z0) + (len * (i + 0.5)) / n;
    for (const s of [0, 1]) {
      if (alongX) K.cube(M.steel, u, 0.76, s ? z1 - 0.035 : z0 + 0.035, 0.26, 0.02, 0.02);
      else K.cube(M.steel, s ? x1 - 0.035 : x0 + 0.035, 0.76, u, 0.02, 0.02, 0.26);
    }
  }
  if (riser) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (alongX) {
      K.box(M.steel, x0 + 0.1, T, cz - 0.02, x0 + 0.13, T + 0.62, cz + 0.02);
      K.box(M.steel, x1 - 0.13, T, cz - 0.02, x1 - 0.1, T + 0.62, cz + 0.02);
      K.box(M.white, x0 + 0.1, T + 0.6, cz - 0.14, x1 - 0.1, T + 0.63, cz + 0.14);
      glassware(c, [x0 + 0.2, cz - 0.12, x1 - 0.2, cz + 0.12], T + 0.63, Math.round(len * 1.5));
    } else {
      K.box(M.steel, cx - 0.02, T, z0 + 0.1, cx + 0.02, T + 0.62, z0 + 0.13);
      K.box(M.steel, cx - 0.02, T, z1 - 0.13, cx + 0.02, T + 0.62, z1 - 0.1);
      K.box(M.white, cx - 0.14, T + 0.6, z0 + 0.1, cx + 0.14, T + 0.63, z1 - 0.1);
      glassware(c, [cx - 0.12, z0 + 0.2, cx + 0.12, z1 - 0.2], T + 0.63, Math.round(len * 1.5));
    }
  }
  glassware(c, r, T, gear);
  c.col(x0, 0, z0, x1, T, z1, SURF.metal);
}

/** a fume hood against a wall, open toward `face`: cabinet, the hood with its sash glass, a light in it */
export function fumeHood(c, r, face) {
  const { K, M, U } = c;
  const [x0, z0, x1, z1] = r;
  const f = frontOf(r, face);
  K.box(M.white, x0, 0, z0, x1, 0.86, z1);
  K.box(M.top, x0, 0.86, z0, x1, 0.92, z1);
  // back and sides of the hood
  const t = 0.05;
  const inset = (d) => (f.alongX ? [x0, f.nz > 0 ? z0 : z1 - d, x1, f.nz > 0 ? z0 + d : z1] : [f.nx > 0 ? x0 : x1 - d, z0, f.nx > 0 ? x0 + d : x1, z1]);
  const [bx0, bz0, bx1, bz1] = inset(t);
  K.box(M.white, bx0, 0.92, bz0, bx1, 2.3, bz1);
  if (f.alongX) {
    K.box(M.white, x0, 0.92, z0, x0 + t, 2.3, z1);
    K.box(M.white, x1 - t, 0.92, z0, x1, 2.3, z1);
  } else {
    K.box(M.white, x0, 0.92, z0, x1, 2.3, z0 + t);
    K.box(M.white, x0, 0.92, z1 - t, x1, 2.3, z1);
  }
  K.box(M.white, x0, 2.0, z0, x1, 2.3, z1); // the hood's top box
  // the sash: glass half down, a steel handle bar
  const sx = f.x + f.nx * -0.02, sz = f.z + f.nz * -0.02;
  if (f.alongX) {
    K.box(U.glass, x0 + t, 1.35, sz - 0.01, x1 - t, 1.98, sz + 0.01);
    K.box(M.steel, x0 + t, 1.33, sz - 0.02, x1 - t, 1.36, sz + 0.02);
  } else {
    K.box(U.glass, sx - 0.01, 1.35, z0 + t, sx + 0.01, 1.98, z1 - t);
    K.box(M.steel, sx - 0.02, 1.33, z0 + t, sx + 0.02, 1.36, z1 - t);
  }
  const cx = (x0 + x1) / 2 - f.nx * 0.1, cz = (z0 + z1) / 2 - f.nz * 0.1;
  K.cube(U.panel, cx, 1.99, cz, f.alongX ? x1 - x0 - 0.2 : 0.2, 0.01, f.alongX ? 0.2 : z1 - z0 - 0.2);
  c.light(cx, 1.9, cz, 0.35, 1.2, COOL, DOWN, 3);
  glassware(c, [x0 + 0.15, z0 + 0.15, x1 - 0.15, z1 - 0.15], 0.92, 3);
  c.col(x0, 0, z0, x1, 2.3, z1, SURF.metal);
}

/** steel shelving over the rect, `levels` shelves, stocked with boxes, bottles and drums */
export function shelf(c, r, { h = 2.1, levels = 4, fill = 'boxes' } = {}) {
  const { K, M, rnd } = c;
  const [x0, z0, x1, z1] = r;
  for (const [x, z] of [[x0 + 0.02, z0 + 0.02], [x1 - 0.02, z0 + 0.02], [x0 + 0.02, z1 - 0.02], [x1 - 0.02, z1 - 0.02]]) K.box(M.steel, x - 0.02, 0, z - 0.02, x + 0.02, h, z + 0.02);
  const alongX = x1 - x0 >= z1 - z0;
  for (let i = 0; i < levels; i++) {
    const y = 0.12 + (i * (h - 0.25)) / (levels - 1);
    K.box(M.steel, x0, y - 0.025, z0, x1, y, z1);
    // stock
    const len = alongX ? x1 - x0 : z1 - z0, dep = alongX ? z1 - z0 : x1 - x0;
    let u = 0.06;
    while (u < len - 0.2) {
      const w = 0.18 + rnd() * 0.35;
      if (u + w > len - 0.05) break;
      if (rnd() < 0.8) {
        const hh = Math.min(0.1 + rnd() * 0.3, (h - 0.25) / (levels - 1) - 0.06);
        const d = dep * (0.55 + rnd() * 0.35);
        const mat = fill === 'boxes' ? (rnd() < 0.7 ? M.card : M.white) : fill === 'bottles' ? (rnd() < 0.6 ? M.amber : M.white) : rnd() < 0.5 ? M.blue : M.dark;
        const cx = (alongX ? x0 : z0) + u + w / 2, cd = (alongX ? z0 : x0) + dep / 2;
        if (fill === 'bottles' && rnd() < 0.7) {
          const br = Math.min(w, d) * 0.3, bh = Math.max(0.1, hh);
          const bx = alongX ? cx : cd, bz = alongX ? cd : cx;
          K.add(mat, bottleShape(br, bh), bx, y, bz);
          K.cyl(M.black, bx, y + bh, bz, br * 0.42, br * 0.42, 0.02, 10);
        } else if (alongX) K.box(mat, cx - w / 2, y, cd - d / 2, cx + w / 2, y + hh, cd + d / 2);
        else K.box(mat, cd - d / 2, y, cx - w / 2, cd + d / 2, y + hh, cx + w / 2);
      }
      u += w + 0.04 + rnd() * 0.1;
    }
  }
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
}

/** an office desk over the rect with a monitor, a keyboard and a chair on the `face` side */
export function desk(c, r, face, { mess = true } = {}) {
  const { K, M, U, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const f = frontOf(r, face);
  const T = 0.75;
  K.box(M.wood, x0, T - 0.04, z0, x1, T, z1);
  // legs / modesty panel
  for (const [x, z] of [[x0 + 0.04, z0 + 0.04], [x1 - 0.04, z0 + 0.04], [x0 + 0.04, z1 - 0.04], [x1 - 0.04, z1 - 0.04]]) K.box(M.dark, x - 0.025, 0, z - 0.025, x + 0.025, T - 0.04, z + 0.025);
  const bk = frontOf(r, { n: 's', s: 'n', w: 'e', e: 'w' }[face]);
  if (bk.alongX) K.box(M.dark, x0 + 0.05, 0.25, bk.z - 0.015 - bk.nz * 0.05, x1 - 0.05, T - 0.04, bk.z + 0.015 - bk.nz * 0.05);
  else K.box(M.dark, bk.x - 0.015 - bk.nx * 0.05, 0.25, z0 + 0.05, bk.x + 0.015 - bk.nx * 0.05, T - 0.04, z1 - 0.05);
  // the monitor toward the back edge, facing the chair side
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const mx = cx - f.nx * 0.18, mz = cz - f.nz * 0.18;
  const yaw = FACE_YAW[face];
  K.cube(M.dark, mx, T + 0.01, mz, 0.2, 0.02, 0.16, yaw);
  K.cube(M.dark, mx, T + 0.13, mz, 0.04, 0.22, 0.03, yaw);
  K.cube(M.black, mx, T + 0.3, mz, 0.5, 0.3, 0.03, yaw);
  const on = rnd() < 0.55;
  c.screen?.(mx + f.nx * 0.017, T + 0.3, mz + f.nz * 0.017, yaw, 0.46, 0.26, on);
  K.cube(M.black, cx + f.nx * 0.12, T + 0.01, cz + f.nz * 0.12, 0.42, 0.02, 0.14, yaw);
  if (mess) {
    for (let i = 0; i < 3; i++) K.cube(M.white, cx + (rnd() - 0.5) * (x1 - x0 - 0.4), T + 0.002 + i * 0.001, cz + (rnd() - 0.5) * (z1 - z0 - 0.3), 0.21, 0.002, 0.29, rnd() * 3);
    if (rnd() < 0.5) K.cyl(M.white, cx + (rnd() - 0.5) * 0.6, T, cz + (rnd() - 0.5) * 0.2, 0.04, 0.035, 0.1, 12);
  }
  // the chair, pushed back or knocked over
  chair(c, cx + f.nx * 0.75, cz + f.nz * 0.75, yaw + Math.PI + (rnd() - 0.5) * 0.8, rnd() < 0.2);
  c.col(x0, 0, z0, x1, T, z1, SURF.wood);
}

/** an office chair at (x, z) turned `yaw`; `down`: knocked over */
export function chair(c, x, z, yaw, down = false) {
  const { K, M } = c;
  if (down) {
    K.cube(M.black, x, 0.28, z, 0.46, 0.08, 0.46, yaw);
    K.add(M.black, new THREE.BoxGeometry(0.44, 0.5, 0.06), x - Math.sin(yaw) * 0.3, 0.12, z - Math.cos(yaw) * 0.3, [Math.PI / 2 - 0.2, yaw, 0, 'YXZ']);
    return;
  }
  K.cyl(M.dark, x, 0, z, 0.3, 0.3, 0.04, 10);
  K.cyl(M.steel, x, 0.04, z, 0.025, 0.025, 0.4, 8);
  K.cube(M.black, x, 0.47, z, 0.46, 0.07, 0.46, yaw);
  const bx = x + Math.sin(yaw) * -0.21, bz = z + Math.cos(yaw) * -0.21;
  K.cube(M.black, bx, 0.8, bz, 0.44, 0.55, 0.06, yaw);
}

/** a filing cabinet / tall cupboard over the rect, drawers on the `face` side */
export function cabinet(c, r, face, { h = 1.3, mat = null, drawers = 4 } = {}) {
  const { K, M } = c;
  const [x0, z0, x1, z1] = r;
  K.box(mat ?? M.grey, x0, 0, z0, x1, h, z1);
  const f = frontOf(r, face);
  for (let i = 0; i < drawers; i++) {
    const y = ((i + 0.5) * h) / drawers;
    if (f.alongX) K.box(M.steel, f.x - 0.08, y - 0.01, f.z - (f.nz < 0 ? 0.015 : 0), f.x + 0.08, y + 0.01, f.z + (f.nz > 0 ? 0.015 : 0));
    else K.box(M.steel, f.x - (f.nx < 0 ? 0.015 : 0), y - 0.01, f.z - 0.08, f.x + (f.nx > 0 ? 0.015 : 0), y + 0.01, f.z + 0.08);
    if (f.alongX) K.box(M.dark, x0 + 0.02, (i * h) / drawers - 0.004, f.z - (f.nz < 0 ? 0.004 : 0), x1 - 0.02, (i * h) / drawers + 0.004, f.z + (f.nz > 0 ? 0.004 : 0));
    else K.box(M.dark, f.x - (f.nx < 0 ? 0.004 : 0), (i * h) / drawers - 0.004, z0 + 0.02, f.x + (f.nx > 0 ? 0.004 : 0), (i * h) / drawers + 0.004, z1 - 0.02);
  }
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
}

/** a row of lockers along the rect, doors on the `face` side (a few hang open) */
export function lockers(c, r, face) {
  const { K, M, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const f = frontOf(r, face);
  const h = 1.95;
  K.box(M.lockerBlue, x0, 0.1, z0, x1, h, z1);
  K.box(M.dark, x0, 0, z0, x1, 0.1, z1);
  const n = Math.max(1, Math.round(f.len / 0.4));
  for (let i = 0; i < n; i++) {
    const u = (f.alongX ? x0 : z0) + (f.len * (i + 0.5)) / n;
    const w = f.len / n;
    const open = rnd() < 0.15;
    const px = f.alongX ? u : f.x, pz = f.alongX ? f.z : u;
    // the door seam, vents, a handle
    if (f.alongX) K.box(M.dark, u - w / 2 - 0.005, 0.12, pz - 0.006, u - w / 2 + 0.005, h - 0.02, pz + 0.006);
    else K.box(M.dark, px - 0.006, 0.12, u - w / 2 - 0.005, px + 0.006, h - 0.02, u - w / 2 + 0.005);
    for (let k = 0; k < 3; k++) {
      const y = h - 0.25 - k * 0.05;
      if (f.alongX) K.box(M.dark, u - 0.1, y, pz - 0.004, u + 0.1, y + 0.015, pz + 0.004);
      else K.box(M.dark, px - 0.004, y, u - 0.1, px + 0.004, y + 0.015, u + 0.1);
    }
    if (open) {
      // a door swung out
      const yaw = FACE_YAW[face] + 1.2;
      const hx = f.alongX ? u - w / 2 : px, hz = f.alongX ? pz : u - w / 2;
      K.add(M.lockerBlue, new THREE.BoxGeometry(w - 0.02, h - 0.15, 0.02).translate((w - 0.02) / 2, 0, 0), hx + f.nx * 0.01, (h + 0.1) / 2, hz + f.nz * 0.01, [0, yaw, 0]);
    } else if (f.alongX) K.cube(M.steel, u + w / 2 - 0.06, 1.05, pz + f.nz * 0.012, 0.02, 0.1, 0.02);
    else K.cube(M.steel, px + f.nx * 0.012, 1.05, u + w / 2 - 0.06, 0.02, 0.1, 0.02);
  }
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
}

/** a stack of crates (plastic or wooden) at (x, z): s = size, n = height in crates */
export function crates(c, x, z, s = 0.8, n = 2, { wood = false, ry = 0 } = {}) {
  const { K, M, rnd } = c;
  for (let i = 0; i < n; i++) {
    const w = s * (0.85 + rnd() * 0.15), y = i * s * 0.75;
    const a = ry + (rnd() - 0.5) * 0.3;
    K.cube(wood ? M.card : M.crate, x + (rnd() - 0.5) * 0.08, y + (s * 0.75) / 2, z + (rnd() - 0.5) * 0.08, w, s * 0.75, w, a);
    K.cube(M.dark, x, y + s * 0.75 - 0.01, z, w * 0.9, 0.025, w * 0.9, a);
  }
  const h = s * 0.75 * n;
  c.col(x - s / 2, 0, z - s / 2, x + s / 2, h, z + s / 2, wood ? SURF.wood : SURF.cardboard);
}

/** a steel drum at (x, z) (knocked over: `down`) */
export function drum(c, x, z, { down = false, mat = null } = {}) {
  const { K, M, rnd } = c;
  const m = mat ?? (rnd() < 0.5 ? M.blue : M.yellow);
  if (down) {
    const a = rnd() * Math.PI;
    K.cyl(m, x - Math.sin(a) * 0.44, 0.29, z - Math.cos(a) * 0.44, 0.29, 0.29, 0.88, 18, [Math.PI / 2, a, 0, 'YXZ']); // (lying along its yaw, centred)
    c.col(x - 0.45, 0, z - 0.45, x + 0.45, 0.58, z + 0.45, SURF.metal);
    return;
  }
  K.cyl(m, x, 0, z, 0.29, 0.29, 0.88, 18);
  for (const y of [0.3, 0.6]) K.cyl(M.dark, x, y, z, 0.295, 0.295, 0.025, 18);
  c.col(x - 0.3, 0, z - 0.3, x + 0.3, 0.88, z + 0.3, SURF.metal);
}

/** a big steel vat at (x, z), radius R: the farm lab's profile scaled, bands, a ladder, a pipe up to the ceiling */
export function vat(c, x, z, R = 1.05, ceil = 6) {
  const { K, M } = c;
  const s = R / 1.05;
  const prof = [[0, 0.6], [0.35, 0.63], [0.7, 0.72], [0.95, 0.84], [1.05, 0.98], [1.05, 4.05], [0.99, 4.2], [0.87, 4.35], [0.63, 4.47], [0.3, 4.53], [0, 4.55]];
  K.add(M.steel, new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r * s, y * s)), 40), x, 0, z);
  for (const y of [1.8, 3.1]) K.add(M.dark, new THREE.TorusGeometry(R + 0.004, 0.014, 6, 48), x, y * s, z, [Math.PI / 2, 0, 0]);
  // legs
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    K.cyl(M.dark, x + Math.cos(a) * R * 0.75, 0, z + Math.sin(a) * R * 0.75, 0.06, 0.06, 0.75 * s, 10);
  }
  // a pipe from the dome to the ceiling
  K.cyl(M.steel, x, 4.5 * s, z, 0.09, 0.09, Math.max(0.1, ceil - 4.5 * s), 12);
  c.col(x - R * 0.9, 0, z - R * 0.9, x + R * 0.9, 4.55 * s, z + R * 0.9, SURF.metal);
}

/** a glass specimen tube at (x, z): steel base and cap, green murk, a pale shape curled up inside */
export function specimenTube(c, x, z, { r = 0.55, h = 2.6, broken = false } = {}) {
  const { K, M, U } = c;
  K.cyl(M.steel, x, 0, z, r + 0.12, r + 0.12, 0.35, 28);
  K.cyl(M.dark, x, 0.35, z, r + 0.05, r + 0.05, 0.05, 28);
  K.cyl(M.steel, x, h + 0.35, z, r + 0.1, r + 0.12, 0.3, 28);
  if (!broken) {
    K.cyl(U.glass, x, 0.4, z, r, r, h - 0.05, 28, null, true);
    K.cyl(U.murk, x, 0.4, z, r - 0.02, r - 0.02, h * 0.92, 24);
    // the shape: a hunched body, arms folded up (dark, through the murk)
    K.add(U.skin, new THREE.SphereGeometry(0.2, 12, 10), x, 0.4 + h * 0.62, z, null, [0.9, 1.1, 0.85]);
    K.add(U.skin, new THREE.CapsuleGeometry(0.17, 0.5, 4, 10), x, 0.4 + h * 0.4, z, [0.2, 0, 0.05]);
    K.add(U.skin, new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), x + 0.14, 0.4 + h * 0.2, z, [0.15, 0, 0.1]);
    K.add(U.skin, new THREE.CapsuleGeometry(0.08, 0.55, 4, 8), x - 0.14, 0.4 + h * 0.2, z, [0.15, 0, -0.1]);
    c.light(x, 0.4 + h * 0.5, z, 0.45, 1.6, [0.35, 1.0, 0.5], null, 4.5);
  } else {
    // smashed: jagged shards at the base, the murk drained onto the floor
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      K.add(U.glass, new THREE.ConeGeometry(0.06, 0.3 + (k % 3) * 0.2, 3), x + Math.cos(a) * r, 0.5, z + Math.sin(a) * r, [0, a, 0]);
    }
    K.add(U.murk, new THREE.CircleGeometry(r * 2.2, 20).rotateX(-Math.PI / 2), x + 0.3, 0.004, z + 0.2);
  }
  // cables and a pipe up from the cap
  K.cyl(M.dark, x, h + 0.65, z, 0.05, 0.05, 0.6, 8);
  c.col(x - r - 0.12, 0, z - r - 0.12, x + r + 0.12, broken ? 0.4 : h + 0.65, z + r + 0.12, broken ? SURF.metal : SURF.glass);
}

/** server racks over the rect, fronts toward `face`: black cabinets, blinking LEDs (their material flickers in c.updates) */
export function serverRacks(c, r, face) {
  const { K, M, U, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const f = frontOf(r, face);
  const h = 2.1;
  K.box(M.black, x0, 0, z0, x1, h, z1);
  const n = Math.max(1, Math.round(f.len / 0.62));
  for (let i = 0; i < n; i++) {
    const u = (f.alongX ? x0 : z0) + (f.len * (i + 0.5)) / n;
    const w = f.len / n - 0.03;
    // the rack's door frame, then rows of units with LEDs
    const px = f.alongX ? u : f.x + f.nx * 0.005, pz = f.alongX ? f.z + f.nz * 0.005 : u;
    for (let k = 0; k < 14; k++) {
      const y = 0.2 + k * 0.13;
      if (f.alongX) K.box(M.dark, u - w / 2 + 0.03, y, pz - 0.004, u + w / 2 - 0.03, y + 0.1, pz + 0.004);
      else K.box(M.dark, px - 0.004, y, u - w / 2 + 0.03, px + 0.004, y + 0.1, u + w / 2 - 0.03);
      for (let l = 0; l < 3; l++) {
        if (rnd() < 0.35) continue;
        const led = [U.ledG, U.ledG, U.ledA, U.ledB][Math.floor(rnd() * 4)];
        const o = -w / 2 + 0.08 + l * 0.035;
        if (f.alongX) K.box(led, u + o, y + 0.04, pz - 0.006, u + o + 0.012, y + 0.052, pz + 0.006);
        else K.box(led, px - 0.006, y + 0.04, u + o, px + 0.006, y + 0.052, u + o + 0.012);
      }
    }
  }
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
}

/** a cafeteria table with two benches, over the rect (long along its longer side) */
export function cafeTable(c, r, { messy = true } = {}) {
  const { K, M, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const alongX = x1 - x0 >= z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const L = alongX ? x1 - x0 : z1 - z0;
  const tw = 0.8;
  if (alongX) {
    K.box(M.white, x0, 0.72, cz - tw / 2, x1, 0.76, cz + tw / 2);
    for (const s of [-1, 1]) K.box(M.steel, x0 + 0.05, 0.43, cz + s * 0.62 - 0.14, x1 - 0.05, 0.47, cz + s * 0.62 + 0.14);
    for (const x of [x0 + 0.2, x1 - 0.2]) K.box(M.steel, x - 0.03, 0, cz - 0.78, x + 0.03, 0.72, cz + 0.78);
  } else {
    K.box(M.white, cx - tw / 2, 0.72, z0, cx + tw / 2, 0.76, z1);
    for (const s of [-1, 1]) K.box(M.steel, cx + s * 0.62 - 0.14, 0.43, z0 + 0.05, cx + s * 0.62 + 0.14, 0.47, z1 - 0.05);
    for (const z of [z0 + 0.2, z1 - 0.2]) K.box(M.steel, cx - 0.78, 0, z - 0.03, cx + 0.78, 0.72, z + 0.03);
  }
  if (messy) {
    for (let i = 0; i < 4; i++) {
      const u = (rnd() - 0.5) * (L - 0.5), v = (rnd() - 0.5) * 0.5;
      const x = alongX ? cx + u : cx + v, z = alongX ? cz + v : cz + u;
      const k = rnd();
      if (k < 0.4) K.cube(M.tray, x, 0.77, z, 0.42, 0.02, 0.3, rnd() * 3);
      else if (k < 0.7) K.cyl(M.white, x, 0.76, z, 0.04, 0.035, 0.1, 12);
      else K.cyl(M.white, x, 0.76, z, 0.11, 0.1, 0.03, 16);
    }
  }
  if (alongX) c.col(x0, 0, cz - 0.8, x1, 0.76, cz + 0.8, SURF.metal);
  else c.col(cx - 0.8, 0, z0, cx + 0.8, 0.76, z1, SURF.metal);
}

/** a vending machine against a wall at (x, z), facing `face`: its lit front glows */
export function vending(c, x, z, face, lit = true) {
  const { K, M, U } = c;
  const f = FACE_YAW[face];
  const w = 0.95, d = 0.8, h = 1.9;
  K.cube(M.red, x, h / 2, z, w, h, d, f);
  const fx = Math.sin(f), fz = Math.cos(f);
  K.cube(lit ? U.vend : M.black, x + fx * (d / 2 + 0.005), 1.15, z + fz * (d / 2 + 0.005), w * 0.62, 1.2, 0.01, f);
  K.cube(M.dark, x + fx * (d / 2 + 0.01) - Math.cos(f) * 0.33, 1.0, z + fz * (d / 2 + 0.01) + Math.sin(f) * 0.33, 0.15, 0.5, 0.02, f);
  if (lit) c.light(x + fx * 0.8, 1.2, z + fz * 0.8, 0.3, 1.2, [1.0, 0.55, 0.45], null, 3.2);
  const hx = Math.abs(fx) > 0.5 ? d / 2 : w / 2, hz = Math.abs(fx) > 0.5 ? w / 2 : d / 2;
  c.col(x - hx, 0, z - hz, x + hx, h, z + hz, SURF.metal);
}

/** a hospital gurney at (x, z), turned `yaw` (a body bag on it, maybe) */
export function gurney(c, x, z, yaw, { bag = false, tipped = false } = {}) {
  const { K, M } = c;
  if (tipped) {
    K.cube(M.steel, x, 0.35, z, 0.65, 0.7, 0.04, yaw);
    K.cube(M.white, x + Math.sin(yaw) * 0.1, 0.35, z + Math.cos(yaw) * 0.1, 0.6, 0.66, 0.1, yaw);
    c.col(x - 0.5, 0, z - 0.5, x + 0.5, 0.7, z + 0.5, SURF.metal);
    return;
  }
  K.add(M.steel, new THREE.BoxGeometry(0.65, 0.04, 1.95), x, 0.78, z, [0, yaw, 0]);
  K.add(M.white, new THREE.BoxGeometry(0.6, 0.08, 1.9), x, 0.84, z, [0, yaw, 0]);
  for (const [a, b] of [[-0.28, -0.9], [0.28, -0.9], [-0.28, 0.9], [0.28, 0.9]]) {
    const px = x + Math.cos(yaw) * a + Math.sin(yaw) * b, pz = z - Math.sin(yaw) * a + Math.cos(yaw) * b;
    K.cyl(M.steel, px, 0.08, pz, 0.018, 0.018, 0.7, 6);
    K.add(M.black, new THREE.SphereGeometry(0.05, 8, 6), px, 0.05, pz);
  }
  if (bag) K.add(M.bag, new THREE.CapsuleGeometry(0.22, 1.3, 4, 10), x, 1.02, z, [Math.PI / 2, yaw, 0, 'YXZ'], [1.05, 1, 0.55]);
  const c0 = Math.abs(Math.cos(yaw)), s0 = Math.abs(Math.sin(yaw));
  const hx = 0.33 * c0 + 0.98 * s0, hz = 0.33 * s0 + 0.98 * c0;
  c.col(x - hx, 0, z - hz, x + hx, 0.88, z + hz, SURF.metal);
}

/** a morgue's wall of cold chambers over the rect, doors toward `face` (3 high) */
export function coldChambers(c, r, face) {
  const { K, M, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const f = frontOf(r, face);
  const h = 2.2;
  K.box(M.steel, x0, 0, z0, x1, h, z1);
  const n = Math.max(1, Math.round(f.len / 0.75));
  for (let i = 0; i < n; i++) {
    const u = (f.alongX ? x0 : z0) + (f.len * (i + 0.5)) / n;
    const w = f.len / n - 0.06;
    for (let k = 0; k < 3; k++) {
      const y = 0.25 + k * 0.66;
      const open = rnd() < 0.12;
      const px = f.alongX ? u : f.x + f.nx * 0.01, pz = f.alongX ? f.z + f.nz * 0.01 : u;
      if (open) {
        // a door hanging open, the tray slid out
        if (f.alongX) K.box(M.dark, u - w / 2, y, pz - 0.01, u + w / 2, y + 0.58, pz + 0.01);
        else K.box(M.dark, px - 0.01, y, u - w / 2, px + 0.01, y + 0.58, u + w / 2);
        if (f.alongX) K.box(M.steel, u - w / 2 + 0.05, y + 0.08, f.z, u + w / 2 - 0.05, y + 0.1, f.z + f.nz * 0.9);
        else K.box(M.steel, f.x, y + 0.08, u - w / 2 + 0.05, f.x + f.nx * 0.9, y + 0.1, u + w / 2 - 0.05);
      } else {
        if (f.alongX) K.box(M.frost, u - w / 2, y, pz - 0.012, u + w / 2, y + 0.58, pz + 0.012);
        else K.box(M.frost, px - 0.012, y, u - w / 2, px + 0.012, y + 0.58, u + w / 2);
        if (f.alongX) K.box(M.dark, u - 0.08, y + 0.25, pz - 0.03, u + 0.08, y + 0.3, pz + 0.03);
        else K.box(M.dark, px - 0.03, y + 0.25, u - 0.08, px + 0.03, y + 0.3, u + 0.08);
      }
    }
  }
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
}

/** a cryo freezer cabinet over the rect: white, frosted door window, a status light */
export function freezer(c, r, face) {
  const { K, M, U } = c;
  const [x0, z0, x1, z1] = r;
  const f = frontOf(r, face);
  const h = 2.0;
  K.box(M.white, x0, 0, z0, x1, h, z1);
  const px = f.x + f.nx * 0.01, pz = f.z + f.nz * 0.01;
  if (f.alongX) {
    K.box(M.frost, x0 + 0.1, 0.9, pz - 0.012, x1 - 0.1, 1.8, pz + 0.012);
    K.box(M.steel, x1 - 0.14, 0.6, pz - 0.03, x1 - 0.1, 1.2, pz + 0.03);
    K.box(U.cyan, x0 + 0.12, 1.85, pz - 0.014, x0 + 0.2, 1.9, pz + 0.014);
  } else {
    K.box(M.frost, px - 0.012, 0.9, z0 + 0.1, px + 0.012, 1.8, z1 - 0.1);
    K.box(M.steel, px - 0.03, 0.6, z1 - 0.14, px + 0.03, 1.2, z1 - 0.1);
    K.box(U.cyan, px - 0.014, 1.85, z0 + 0.12, px + 0.014, 1.9, z0 + 0.2);
  }
  c.col(x0, 0, z0, x1, h, z1, SURF.metal);
}

/** a liquid-nitrogen dewar at (x, z) */
export function dewar(c, x, z, r = 0.32) {
  const { K, M } = c;
  K.cyl(M.steel, x, 0, z, r, r, 1.0, 20);
  K.add(M.steel, new THREE.SphereGeometry(r, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 1.0, z);
  K.cyl(M.dark, x, 1.0 + r * 0.8, z, 0.08, 0.08, 0.14, 12);
  for (const s of [-1, 1]) K.rod(M.steel, V(x + s * r, 0.85, z), V(x + s * (r + 0.08), 0.95, z), 0.015, 6);
  c.col(x - r, 0, z - r, x + r, 1.2, z + r, SURF.metal);
}

/** a gas cylinder at (x, z), chained upright */
export function gasCylinder(c, x, z, mat) {
  const { K, M } = c;
  K.cyl(mat, x, 0, z, 0.12, 0.12, 1.3, 16);
  K.add(mat, new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, 1.3, z);
  K.cyl(M.steel, x, 1.38, z, 0.03, 0.03, 0.12, 8);
  c.col(x - 0.13, 0, z - 0.13, x + 0.13, 1.45, z + 0.13, SURF.metal);
}

/** a long conference table over the rect with chairs down both sides */
export function confTable(c, r) {
  const { K, M, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const alongX = x1 - x0 >= z1 - z0;
  K.box(M.wood, x0, 0.72, z0, x1, 0.77, z1);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (alongX) for (const x of [x0 + 0.5, cx, x1 - 0.5]) K.box(M.dark, x - 0.06, 0, cz - 0.3, x + 0.06, 0.72, cz + 0.3);
  else for (const z of [z0 + 0.5, cz, z1 - 0.5]) K.box(M.dark, cx - 0.3, 0, z - 0.06, cx + 0.3, 0.72, z + 0.06);
  const L = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.floor(L / 0.9));
  for (let i = 0; i < n; i++) {
    const u = (alongX ? x0 : z0) + (L * (i + 0.5)) / n;
    for (const s of [-1, 1]) {
      const off = (alongX ? z1 - z0 : x1 - x0) / 2 + 0.35;
      const x = alongX ? u : cx + s * off, z = alongX ? cz + s * off : u;
      chair(c, x + (rnd() - 0.5) * 0.2, z + (rnd() - 0.5) * 0.2, (alongX ? (s > 0 ? Math.PI : 0) : s > 0 ? -Math.PI / 2 : Math.PI / 2) + (rnd() - 0.5) * 0.6, rnd() < 0.12);
    }
  }
  c.col(x0, 0, z0, x1, 0.77, z1, SURF.wood);
}

/** a steel autopsy table at (x, z) turned `yaw` */
export function autopsyTable(c, x, z, yaw) {
  const { K, M } = c;
  K.add(M.steel, new THREE.BoxGeometry(0.8, 0.06, 2.1), x, 0.85, z, [0, yaw, 0]);
  K.add(M.steel, new THREE.BoxGeometry(0.72, 0.04, 2.0), x, 0.9, z, [0, yaw, 0]);
  K.cyl(M.steel, x, 0, z, 0.1, 0.12, 0.82, 12);
  K.cyl(M.dark, x, 0, z, 0.3, 0.3, 0.04, 16);
  // the lamp over it
  K.cyl(M.dark, x, 2.35, z, 0.25, 0.35, 0.15, 16);
  const c0 = Math.abs(Math.cos(yaw)), s0 = Math.abs(Math.sin(yaw));
  c.col(x - (0.4 * c0 + 1.05 * s0), 0, z - (0.4 * s0 + 1.05 * c0), x + (0.4 * c0 + 1.05 * s0), 0.92, z + (0.4 * s0 + 1.05 * c0), SURF.metal);
}

/** a generator / pump skid over the rect: the engine block, the tank, pipes, a panel */
export function plant(c, r, kind = 'gen') {
  const { K, M, U, rnd } = c;
  const [x0, z0, x1, z1] = r;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  K.box(M.dark, x0, 0, z0, x1, 0.2, z1);
  if (kind === 'gen') {
    K.box(M.yellow, x0 + 0.2, 0.2, z0 + 0.2, x1 - 0.2, 1.5, z1 - 0.2);
    K.box(M.dark, x0 + 0.3, 1.5, z0 + 0.3, x1 - 0.3, 1.6, z1 - 0.3);
    for (let i = 0; i < 6; i++) K.box(M.dark, x0 + 0.25, 0.4 + i * 0.16, z0 + 0.19, x1 - 0.25, 0.44 + i * 0.16, z0 + 0.2);
    K.cyl(M.steel, x1 - 0.5, 1.6, cz, 0.12, 0.12, 1.0, 12);
    K.box(M.grey, x0 - 0.02, 0.8, cz - 0.3, x0 + 0.02, 1.4, cz + 0.3);
    K.box(rnd() < 0.5 ? U.ledG : U.ledR, x0 - 0.03, 1.3, cz - 0.2, x0, 1.33, cz - 0.17);
  } else {
    // a pump: two horizontal tanks and a motor
    const alongX = x1 - x0 >= z1 - z0;
    const L = alongX ? x1 - x0 - 0.4 : z1 - z0 - 0.4;
    for (const s of [-0.3, 0.3]) {
      if (alongX) K.cyl(M.steel, cx + L / 2, 0.65, cz + s * (z1 - z0) * 0.8, 0.38, 0.38, L, 20, [0, 0, Math.PI / 2]);
      else K.cyl(M.steel, cx + s * (x1 - x0) * 0.8, 0.65, cz - L / 2, 0.38, 0.38, L, 20, [Math.PI / 2, 0, 0]);
    }
    K.box(M.blue, cx - 0.35, 0.2, cz - 0.35, cx + 0.35, 0.9, cz + 0.35);
  }
  c.col(x0, 0, z0, x1, kind === 'gen' ? 1.6 : 1.1, z1, SURF.metal);
}

/** pipes along a wall line from a to b at height y (a bundle of `n`, colours mixed), with brackets */
export function pipeRun(c, ax, az, bx, bz, y, n = 3, side = 0) {
  const { K, M } = c;
  const mats = [M.steel, M.blue, M.green, M.yellow, M.red];
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const px = -uz, pz = ux;
  for (let i = 0; i < n; i++) {
    const o = side + i * 0.14, r = 0.035 + (i % 2) * 0.02;
    K.rod(mats[(((i + Math.round(ax + az)) % mats.length) + mats.length) % mats.length], V(ax + px * o, y - i * 0.03, az + pz * o), V(bx + px * o, y - i * 0.03, bz + pz * o), r, 10);
  }
  const k = Math.max(1, Math.floor(L / 3));
  for (let i = 0; i <= k; i++) {
    const t = i / k;
    K.cube(M.dark, ax + (bx - ax) * t + px * (side + (n - 1) * 0.07), y + 0.08, az + (bz - az) * t + pz * (side + (n - 1) * 0.07), Math.abs(ux) > 0.5 ? 0.05 : n * 0.14 + 0.1, 0.04, Math.abs(ux) > 0.5 ? n * 0.14 + 0.1 : 0.05);
  }
}

/** a cable tray from a to b at height y */
export function cableTray(c, ax, az, bx, bz, y) {
  const { K, M } = c;
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  if (alongX) {
    K.box(M.steel, Math.min(ax, bx), y, az - 0.2, Math.max(ax, bx), y + 0.02, az + 0.2);
    for (const s of [-1, 1]) K.box(M.steel, Math.min(ax, bx), y, az + s * 0.2 - 0.01, Math.max(ax, bx), y + 0.08, az + s * 0.2 + 0.01);
    K.box(M.black, Math.min(ax, bx), y + 0.02, az - 0.15, Math.max(ax, bx), y + 0.06, az + 0.12);
  } else {
    K.box(M.steel, ax - 0.2, y, Math.min(az, bz), ax + 0.2, y + 0.02, Math.max(az, bz));
    for (const s of [-1, 1]) K.box(M.steel, ax + s * 0.2 - 0.01, y, Math.min(az, bz), ax + s * 0.2 + 0.01, y + 0.08, Math.max(az, bz));
    K.box(M.black, ax - 0.15, y + 0.02, Math.min(az, bz), ax + 0.12, y + 0.06, Math.max(az, bz));
  }
}

/**
 * A ceiling light panel at (x, z) under the ceiling h: `len` long along x (alongX) or z. Its light is baked
 * (two points along it); `broken`: dark, no light; `dim`: a weaker glow; `flick`: 1..3, a tube on the guttering circuit (hive.js animates U.flick).
 */
export function panel(c, x, z, h, { len = 1.2, alongX = true, broken = false, dim = false, flick = 0, i = 0.9, r = 3.4, color = COOL, range = null } = {}) {
  const { K, M, U } = c;
  const sx = alongX ? len : 0.34, sz = alongX ? 0.34 : len;
  K.cube(M.dark, x, h - 0.02, z, sx + 0.08, 0.04, sz + 0.08);
  K.cube(broken ? U.deadPanel : flick && U.flick ? U.flick[flick - 1] : dim ? U.dimPanel : U.panel, x, h - 0.045, z, sx, 0.012, sz);
  if (broken) return;
  const k = dim ? 0.45 : 1;
  for (const s of [-0.3, 0.3]) c.light(x + (alongX ? s * len : 0), h - 0.12, z + (alongX ? 0 : s * len), i * k * 0.5, r, color, DOWN, range);
}

/** a wall-mounted fire extinguisher at (x, z) on the wall facing `face` */
export function extinguisher(c, x, z, face) {
  const { K, M } = c;
  const f = FACE_YAW[face];
  const fx = Math.sin(f), fz = Math.cos(f);
  K.cyl(M.red, x + fx * 0.12, 0.55, z + fz * 0.12, 0.08, 0.08, 0.5, 14);
  K.add(M.red, new THREE.SphereGeometry(0.08, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), x + fx * 0.12, 1.05, z + fz * 0.12);
  K.cyl(M.black, x + fx * 0.12, 1.1, z + fz * 0.12, 0.02, 0.02, 0.08, 8);
  K.cube(M.dark, x + fx * 0.02, 0.9, z + fz * 0.02, Math.abs(fx) > 0.5 ? 0.04 : 0.16, 0.08, Math.abs(fx) > 0.5 ? 0.16 : 0.04);
}

/** papers, a spilled box, a knocked-over bin: floor clutter round (x, z) */
export function clutter(c, x, z, n = 6, spread = 1.5) {
  const { K, M, rnd } = c;
  for (let i = 0; i < n; i++) {
    const px = x + (rnd() - 0.5) * spread * 2, pz = z + (rnd() - 0.5) * spread * 2;
    const k = rnd();
    if (k < 0.6) K.cube(M.white, px, 0.002 + i * 0.0004, pz, 0.21, 0.002, 0.29, rnd() * 3);
    else if (k < 0.8) K.cube(M.card, px, 0.12, pz, 0.3 + rnd() * 0.2, 0.24, 0.25 + rnd() * 0.2, rnd() * 3);
    else K.cyl(M.grey, px, 0.18, pz, 0.14, 0.12, 0.34, 12, [Math.PI / 2, rnd() * 3, 0]);
  }
}

/** a whiteboard on the wall at (x, z) facing `face`, scribbled */
export function whiteboard(c, x, z, face, w = 1.8) {
  const { K, M } = c;
  const f = FACE_YAW[face];
  const fx = Math.sin(f), fz = Math.cos(f);
  const along = Math.abs(fx) > 0.5;
  K.cube(M.steel, x + fx * 0.015, 1.5, z + fz * 0.015, along ? 0.03 : w + 0.06, 1.06, along ? w + 0.06 : 0.03);
  K.cube(M.board, x + fx * 0.032, 1.5, z + fz * 0.032, along ? 0.004 : w, 1.0, along ? w : 0.004);
}

// ---------------------------------------------------------------- sublevel 5 and the rest of the multi-level Hive

/**
 * A giant pressure vessel in the pump hall: on its plinth, banded, a dome, a caged service ladder, a pipe up to the
 * ceiling (ceil: the ceiling over the floor) and elbows to the wall side, a status panel. Round-ish collider.
 */
export function reactor(c, x, z, R, H, ceil, face = 's') {
  const { K, M, U, rnd } = c;
  const top = H - R * 0.45;
  K.cyl(M.dark, x, 0, z, R + 0.45, R + 0.5, 0.45, 40);
  K.cyl(M.hazard, x, 0.45, z, R + 0.02, R + 0.02, 0.35, 40, null, true);
  K.cyl(M.steelDark, x, 0.45, z, R, R, top - 0.45, 44);
  K.add(M.steelDark, new THREE.SphereGeometry(R, 44, 12, 0, Math.PI * 2, 0, Math.PI / 2), x, top, z, null, [1, 0.45, 1]);
  for (let y = 1.4; y < top - 0.3; y += 1.7) K.add(M.dark, new THREE.TorusGeometry(R + 0.025, 0.06, 6, 56), x, y, z, [Math.PI / 2, 0, 0]);
  // rivet seams
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    K.box(M.dark, x + Math.cos(a) * (R + 0.005) - 0.015, 0.8, z + Math.sin(a) * (R + 0.005) - 0.015, x + Math.cos(a) * (R + 0.005) + 0.015, top - 0.2, z + Math.sin(a) * (R + 0.005) + 0.015);
  }
  // the pipe up from the dome, a manifold ring
  K.cyl(M.steel, x, H - 0.1, z, 0.42, 0.42, Math.max(0.2, ceil - H + 0.1), 18);
  K.add(M.dark, new THREE.TorusGeometry(0.55, 0.08, 8, 24), x, H + 0.6, z, [Math.PI / 2, 0, 0]);
  // two side outlets with flanges, down into the floor
  for (const s of [-1, 1]) {
    const ox = x + s * (R + 0.6);
    K.rod(M.steel, V(x + s * (R - 0.1), 2.2, z), V(ox, 2.2, z), 0.22, 14);
    K.cyl(M.dark, ox - s * 0.06, 2.2, z, 0.3, 0.3, 0.12, 16, [0, 0, Math.PI / 2]);
    K.cyl(M.steel, ox, 0, z, 0.22, 0.22, 2.2, 14);
  }
  // service ladder on the front with its cage
  const f = FACE_YAW[face], fx = Math.sin(f), fz = Math.cos(f), px = Math.cos(f), pz = -Math.sin(f);
  const lx = x + fx * (R + 0.18), lz = z + fz * (R + 0.18);
  for (const s of [-0.22, 0.22]) K.rod(M.steel, V(lx + px * s, 0.45, lz + pz * s), V(lx + px * s, top - 0.2, lz + pz * s), 0.025, 6);
  for (let y = 0.7; y < top - 0.3; y += 0.3) K.rod(M.steel, V(lx - px * 0.22, y, lz - pz * 0.22), V(lx + px * 0.22, y, lz + pz * 0.22), 0.018, 6);
  // the status panel
  const sx = x + fx * (R + 0.04), sz = z + fz * (R + 0.04);
  K.cube(M.black, sx + px * 0.8, 1.5, sz + pz * 0.8, Math.abs(px) > 0.5 ? 0.5 : 0.06, 0.5, Math.abs(px) > 0.5 ? 0.06 : 0.5, 0);
  const led = rnd() < 0.5 ? U.ledR : U.ledA;
  K.cube(led, sx + px * 0.8 + fx * 0.04, 1.62, sz + pz * 0.8 + fz * 0.04, 0.08, 0.08, 0.08);
  c.light(sx + px * 0.8 + fx * 0.4, 1.6, sz + pz * 0.8 + fz * 0.4, 0.25, 1.2, led === U.ledR ? [1, 0.2, 0.1] : [1, 0.6, 0.2], null, 3);
  c.col(x - R, 0, z - R * 0.72, x + R, H, z + R * 0.72, SURF.metal);
  c.col(x - R * 0.72, 0, z - R, x + R * 0.72, H, z + R, SURF.metal);
}

/**
 * A railing along a drop-off edge from (ax, az) to (bx, bz) at floor height y: posts, a top and a mid rail, a yellow
 * toe board. Its collider stops bodies (and the nav) but not bullets (FLAG_NOBULLET).
 */
export function railing(c, ax, az, bx, bz, y) {
  const { K, M } = c;
  const L = Math.hypot(bx - ax, bz - az);
  if (L < 0.2) return;
  K.rod(M.steel, V(ax, y + 1.05, az), V(bx, y + 1.05, bz), 0.024, 8);
  K.rod(M.steel, V(ax, y + 0.55, az), V(bx, y + 0.55, bz), 0.014, 6);
  const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
  if (alongX) K.box(M.yellow, Math.min(ax, bx), y, az - 0.006, Math.max(ax, bx), y + 0.1, az + 0.006);
  else K.box(M.yellow, ax - 0.006, y, Math.min(az, bz), ax + 0.006, y + 0.1, Math.max(az, bz));
  const n = Math.max(1, Math.round(L / 1.25));
  for (let i = 0; i <= n; i++) K.cyl(M.steel, ax + ((bx - ax) * i) / n, y, az + ((bz - az) * i) / n, 0.02, 0.02, 1.05, 8);
  if (alongX) c.col(Math.min(ax, bx), y, az - 0.05, Math.max(ax, bx), y + 1.1, az + 0.05, SURF.metal, FLAG_NOBULLET);
  else c.col(ax - 0.05, y, Math.min(az, bz), ax + 0.05, y + 1.1, Math.max(az, bz), SURF.metal, FLAG_NOBULLET);
}

/**
 * A straight flight of steel stairs over x0..x1 × z0..z1, climbing along `along` ('x' | 'z') from the `low` end
 * ('x0' | 'x1' | 'z0' | 'z1') at yb to yt in n steps: solid steps (FLAG_STAIR colliders: the nav takes the flight by a
 * portal), yellow nosing, side stringers.
 */
export function stairFlight(c, { x0, x1, z0, z1, along, low, yb, yt, n }, FLAG_STAIR = 1) {
  const { K, M } = c;
  const L = along === 'x' ? x1 - x0 : z1 - z0;
  const run = L / n, rise = (yt - yb) / n;
  const start = low === 'x0' ? x0 : low === 'x1' ? x1 : low === 'z0' ? z0 : z1;
  const dir = low === 'x0' || low === 'z0' ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a = start + dir * run * i, b = start + dir * run * (i + 1);
    const s0 = Math.min(a, b), s1 = Math.max(a, b);
    const top = yb + rise * (i + 1);
    const riser = dir > 0 ? (along === 'x' ? 'nx' : 'nz') : along === 'x' ? 'px' : 'pz';
    if (along === 'x') {
      K.box(M.stairs, s0, yb, z0, s1, top, z1, { faces: ['py', riser] });
      K.box(M.steelDark, s0, yb, z0, s1, top, z1, { faces: ['pz', 'nz'] });
      const e = dir > 0 ? s0 : s1;
      K.box(M.yellow, e - 0.03, top - 0.004, z0, e + 0.03, top + 0.002, z1, { faces: ['py'] });
      c.col(s0, yb, z0, s1, top, z1, SURF.metal, FLAG_STAIR);
    } else {
      K.box(M.stairs, x0, yb, s0, x1, top, s1, { faces: ['py', riser] });
      K.box(M.steelDark, x0, yb, s0, x1, top, s1, { faces: ['px', 'nx'] });
      const e = dir > 0 ? s0 : s1;
      K.box(M.yellow, x0, top - 0.004, e - 0.03, x1, top + 0.002, e + 0.03, { faces: ['py'] });
      c.col(x0, yb, s0, x1, top, s1, SURF.metal, FLAG_STAIR);
    }
  }
  // the back of the top step, down to the floor (seen from under the landing the flight meets)
  const back = dir > 0 ? (along === 'x' ? 'px' : 'pz') : along === 'x' ? 'nx' : 'nz';
  K.box(M.steelDark, x0, yb, z0, x1, yt, z1, { faces: [back] });
}

/** a drowned body floating at (x, y, z), turned yaw, tipped `pitch` (face down: ~pi/2), limbs adrift */
export function drowned(c, x, y, z, yaw, pitch = 1.4) {
  const { K, U, rnd } = c;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, rnd() * 0.6 - 0.3, 'YXZ'));
  const at = (lx, ly, lz) => new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(x, y, z));
  const put = (geo, lx, ly, lz, rx = 0, rz = 0) => {
    const p = at(lx, ly, lz);
    const m = new THREE.Matrix4().compose(p, q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz))), new THREE.Vector3(1, 1, 1));
    K.addMatrix(U.drowned, geo, m);
  };
  put(new THREE.CapsuleGeometry(0.17, 0.5, 4, 10), 0, 0, 0);
  put(new THREE.SphereGeometry(0.12, 10, 8), 0, 0.46, 0.02);
  for (const s of [-1, 1]) {
    put(new THREE.CapsuleGeometry(0.055, 0.5, 4, 8), s * 0.24, 0.12, 0, 0, s * (0.9 + rnd() * 0.8));
    put(new THREE.CapsuleGeometry(0.07, 0.62, 4, 8), s * 0.1, -0.6, 0, rnd() * 0.5 - 0.25, s * 0.15);
  }
}

/**
 * A flooded lab's contents (sealed behind the glass): benches and shelves under water, chairs on their side, the
 * drowned floating, papers adrift, the water up to `wl` over the floor, a cold teal glow from inside.
 */
export function floodedLab(c, [x0, z0, x1, z1], wl, face) {
  const { K, U, rnd } = c;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const w = x1 - x0;
  // face: the side its window is on ('n': z0, 's': z1); a bench down the middle, a shelf and a freezer at the back
  const north = face === 'n';
  const win = north ? z0 : z1;
  bench(c, [cx - w * 0.3, cz - 0.35, cx + w * 0.3, cz + 0.35], { riser: rnd() < 0.5, gear: 3 });
  shelf(c, [x0 + 0.3, north ? z1 - 0.5 : z0, x0 + 2.2, north ? z1 : z0 + 0.5], { fill: 'bottles' });
  if (rnd() < 0.7) freezer(c, [x1 - 1.4, north ? z1 - 0.9 : z0, x1 - 0.2, north ? z1 : z0 + 0.9], face);
  for (let i = 0; i < 3; i++) chair(c, cx + (rnd() - 0.5) * w * 0.6, cz + (rnd() - 0.5) * 1.6, rnd() * 6, rnd() < 0.6);
  // the drowned
  const nb = 1 + Math.floor(rnd() * 2.2);
  for (let i = 0; i < nb; i++) drowned(c, cx + (rnd() - 0.5) * (w - 2), 0.6 + rnd() * (wl - 1.2), cz + (rnd() - 0.5) * 1.2, rnd() * 6, 0.6 + rnd() * 1.4);
  // papers adrift
  for (let i = 0; i < 10; i++) K.cube(U.paperWet, x0 + 0.4 + rnd() * (w - 0.8), 0.3 + rnd() * (wl - 0.4), z0 + 0.4 + rnd() * (z1 - z0 - 0.8), 0.21, 0.004, 0.29, rnd() * 3);
  // the water: a murky volume and its surface
  K.box(U.water, x0 + 0.02, 0.02, z0 + 0.02, x1 - 0.02, wl, z1 - 0.02);
  K.box(U.waterTop, x0 + 0.02, wl - 0.005, z0 + 0.02, x1 - 0.02, wl, z1 - 0.02, { faces: ['py', 'ny'] });
  // the cold glow through it (it spills out of the window into the corridor)
  c.light(cx, wl * 0.55, cz, 0.9, 2.6, [0.25, 0.85, 0.8], null, 8);
  c.light(cx, wl * 0.55, win + (north ? 0.3 : -0.3), 0.5, 2.0, [0.25, 0.85, 0.8], null, 6);
}

/** a puddle on the floor at (x, z), r m across (a dark mirror) */
export function puddle(c, x, z, r) {
  const { K, M, rnd } = c;
  const g = new THREE.CircleGeometry(r, 18);
  const pos = g.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const k = 0.7 + rnd() * 0.5;
    pos.setX(i, pos.getX(i) * k);
    pos.setY(i, pos.getY(i) * (0.6 + rnd() * 0.5));
  }
  g.rotateX(-Math.PI / 2);
  K.add(M.puddle, g, x, 0.004, z, [0, rnd() * 6, 0]);
}

/** a rack of pipes up a wall from the floor to height h at (x, z), `n` pipes spaced along the wall (alongX) */
export function pipeRiser(c, x, z, h, n = 3, alongX = true) {
  const { K, M } = c;
  const mats = [M.steel, M.rust, M.steelDark, M.rust];
  for (let i = 0; i < n; i++) {
    const o = (i - (n - 1) / 2) * 0.32;
    K.cyl(mats[i % mats.length], x + (alongX ? o : 0), 0, z + (alongX ? 0 : o), 0.1 + (i % 2) * 0.04, 0.1 + (i % 2) * 0.04, h, 12);
    for (let y = 1.2; y < h; y += 2.2) K.cyl(M.dark, x + (alongX ? o : 0), y, z + (alongX ? 0 : o), 0.17, 0.17, 0.1, 12);
  }
}
