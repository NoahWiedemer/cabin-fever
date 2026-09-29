// Geometry helpers of the Appenweier map (world/appenweier.js, world/appenweierBuildings.js, world/appenweierProps.js):
// triangle batches per material, boxes and walls turned about y (with oriented colliders), street ribbons and
// markings, flat polygons, the LoD2 surfaces with metre uvs, and where things are (the hall, the garage, the store).
import * as THREE from 'three';
import { SURF } from './collision.js';
import { getMaterial } from './materials.js';
import { HALL, GARAGE, DM, DM_CENTER } from './appenweierLayout.js';

// ---------------------------------------------------------------- geometry helpers (shared with the buildings)
/**
 * Collects triangles per material name and per CHUNK x CHUNK m square (by centroid); meshes() makes one mesh each,
 * so the camera and the shadow cameras cull what they don't see (the map is ~200 m across).
 */
const CHUNK = 24;
export class TriBatch {
  constructor() {
    this.parts = new Map();
  }
  list(mat, x = 0, z = 0) {
    const key = mat + '|' + Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK);
    let p = this.parts.get(key);
    if (!p) this.parts.set(key, (p = { mat, pos: [], uv: [], nor: [] }));
    return p;
  }
  /** a triangle a, b, c ([x, y, z]) with uvs ua, ub, uc; normal from the winding (counter-clockwise = front) */
  tri(mat, a, b, c, ua, ub, uc) {
    const p = this.list(mat, (a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    p.pos.push(...a, ...b, ...c);
    p.uv.push(...ua, ...ub, ...uc);
    for (let k = 0; k < 3; k++) p.nor.push(nx, ny, nz);
  }
  quad(mat, a, b, c, d, ua, ub, uc, ud) {
    this.tri(mat, a, b, c, ua, ub, uc);
    this.tri(mat, a, c, d, ua, uc, ud);
  }
  meshes(opts = {}) {
    const out = [];
    for (const p of this.parts.values()) {
      const mat = p.mat;
      if (!p.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, typeof mat === 'string' ? getMaterial(mat) : mat);
      m.castShadow = opts.cast?.(mat) ?? true;
      m.receiveShadow = true;
      out.push(m);
    }
    return out;
  }
}

/** a box turned about y: centre (cx, cz), half extents hx (along the edge angle ang, x -> z) and hz, y0..y1 */
export function oBox(T, world, cx, cz, hx, hz, ang, y0, y1, mat, o = {}) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (lx, y, lz) => [cx + lx * c - lz * s, y, cz + lx * s + lz * c];
  const mpr = typeof mat === 'string' ? getMaterial(mat).userData.metersPerRepeat || 1 : 1;
  const mats = o.mats ?? {};
  const face = (name, a, b, cc, d, w, h) => {
    const m = mats[name] ?? mat;
    if (!m || o.skip?.includes(name)) return;
    const k = typeof m === 'string' ? getMaterial(m).userData.metersPerRepeat || 1 : mpr;
    T.quad(m, a, b, cc, d, [0, 0], [w / k, 0], [w / k, h / k], [0, h / k]);
  };
  const W = 2 * hx, D = 2 * hz, H = y1 - y0;
  // +lz face (the "front" when hz is the depth), -lz, +lx, -lx, top, bottom
  face('pz', P(-hx, y0, hz), P(hx, y0, hz), P(hx, y1, hz), P(-hx, y1, hz), W, H);
  face('nz', P(hx, y0, -hz), P(-hx, y0, -hz), P(-hx, y1, -hz), P(hx, y1, -hz), W, H);
  face('px', P(hx, y0, hz), P(hx, y0, -hz), P(hx, y1, -hz), P(hx, y1, hz), D, H);
  face('nx', P(-hx, y0, -hz), P(-hx, y0, hz), P(-hx, y1, hz), P(-hx, y1, -hz), D, H);
  face('py', P(-hx, y1, hz), P(hx, y1, hz), P(hx, y1, -hz), P(-hx, y1, -hz), W, D);
  face('ny', P(-hx, y0, -hz), P(hx, y0, -hz), P(hx, y0, hz), P(-hx, y0, hz), W, D);
  if (o.collide !== false && world) return world.addOBB(cx, cz, hx, hz, -ang, y0, y1, o.surface ?? SURF.plaster, o.flags ?? 0, o.tag ?? null);
  return null;
}

/**
 * A wall from p0 to p1 ([x, z]) of thickness t (centred on the line, or shifted by o.offset toward the left of
 * p0 -> p1), y0..y1, with openings [{ a, b, y0, y1 }] (m along the wall from p0). Sides: o.left / o.right materials.
 */
export function oWall(T, world, p0, p1, y0, y1, t, openings, o = {}) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const L = Math.hypot(dx, dz), ang = Math.atan2(dz, dx);
  const ux = dx / L, uz = dz / L;
  const off = o.offset ?? 0; // + = to the left (the side +lz faces: (-uz, ux)... see below)
  const segs = [];
  let cur = 0;
  for (const op of [...openings].sort((p, q) => p.a - q.a)) {
    if (op.a > cur) segs.push([cur, op.a, y0, y1]);
    if (op.y0 > y0) segs.push([op.a, op.b, y0, op.y0]);
    if (op.y1 < y1) segs.push([op.a, op.b, op.y1, y1]);
    cur = Math.max(cur, op.b);
  }
  if (cur < L) segs.push([cur, L, y0, y1]);
  const out = [];
  for (const [a, b, sy0, sy1] of segs) {
    if (b - a < 1e-3 || sy1 - sy0 < 1e-3) continue;
    const m = (a + b) / 2;
    // local +lz of oBox is (−sin, cos) of ang: the wall's left side
    const cx = p0[0] + ux * m - uz * off, cz = p0[1] + uz * m + ux * off;
    out.push(oBox(T, world, cx, cz, (b - a) / 2, t / 2, ang, sy0, sy1, o.mat ?? 'awPlasterWhite', {
      mats: { pz: o.left, nz: o.right, px: o.jamb, nx: o.jamb, py: o.top, ny: o.jamb },
      surface: o.surface,
      flags: o.flags,
      tag: o.tag,
      collide: o.collide,
    }));
  }
  return out;
}

/** a strip along a polyline pts [[x, z], ...] between lateral offsets o0..o1 (m, + = left), world-planar uvs */
export function ribbon(T, mat, pts, o0, o1, y, mprOverride) {
  const mpr = mprOverride ?? (getMaterial(mat).userData.metersPerRepeat || 1);
  const n = pts.length;
  if (n < 2) return;
  const side = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(n - 1, i + 1)];
    let d0x = b[0] - a[0], d0z = b[1] - a[1], d1x = c[0] - b[0], d1z = c[1] - b[1];
    const l0 = Math.hypot(d0x, d0z) || 1, l1 = Math.hypot(d1x, d1z) || 1;
    d0x /= l0;
    d0z /= l0;
    d1x /= l1;
    d1z /= l1;
    if (i === 0) (d0x = d1x), (d0z = d1z);
    if (i === n - 1) (d1x = d0x), (d1z = d0z);
    let tx = d0x + d1x, tz = d0z + d1z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // left normal of the mean direction, lengthened by the miter (capped)
    const cosHalf = Math.max(0.5, tx * d1x + tz * d1z);
    side.push([-tz / cosHalf, tx / cosHalf]);
  }
  const P = (i, o) => [pts[i][0] + side[i][0] * o, y, pts[i][1] + side[i][1] * o];
  const U = (p) => [p[0] / mpr, -p[2] / mpr];
  for (let i = 0; i < n - 1; i++) {
    const a = P(i, o0), b = P(i + 1, o0), c = P(i + 1, o1), d = P(i, o1);
    // up-facing: wind so the normal is +y whichever side o0 / o1 is
    const cross = (b[0] - a[0]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[0] - a[0]);
    if (cross < 0) T.quad(mat, a, b, c, d, U(a), U(b), U(c), U(d));
    else T.quad(mat, a, d, c, b, U(a), U(d), U(c), U(b));
  }
}

/** dashes along a polyline at lateral offset o: dash / gap lengths (m), width w */
export function dashes(T, mat, pts, o, w, dash, gap, y, phase = 0) {
  let acc = -phase;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-3) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L;
    const nx = -uz, nz = ux;
    let s = 0;
    while (s < L) {
      const period = dash + gap;
      const into = ((acc % period) + period) % period;
      if (into < dash) {
        const run = Math.min(dash - into, L - s);
        const s0 = s, s1 = s + run;
        const q = (t, k) => [a[0] + ux * t + nx * (o + k), y, a[1] + uz * t + nz * (o + k)];
        const p0 = q(s0, -w / 2), p1 = q(s1, -w / 2), p2 = q(s1, w / 2), p3 = q(s0, w / 2);
        const cross = (p1[0] - p0[0]) * (p3[2] - p0[2]) - (p1[2] - p0[2]) * (p3[0] - p0[0]);
        if (cross < 0) T.quad(mat, p0, p1, p2, p3, [0, 0], [1, 0], [1, 1], [0, 1]);
        else T.quad(mat, p0, p3, p2, p1, [0, 0], [0, 1], [1, 1], [1, 0]);
        s += run;
        acc += run;
      } else {
        const run = Math.min(period - into, L - s);
        s += run;
        acc += run;
      }
    }
  }
}

/** flat polygon pts [[x, z], ...] at height y, world-planar uvs */
export function polygon(T, mat, pts, y) {
  const mpr = getMaterial(mat).userData.metersPerRepeat || 1;
  const faces = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of faces) {
    const a = [pts[i][0], y, pts[i][1]], b = [pts[j][0], y, pts[j][1]], c = [pts[k][0], y, pts[k][1]];
    const cross = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
    const U = (p) => [p[0] / mpr, -p[2] / mpr];
    if (cross < 0) T.tri(mat, a, b, c, U(a), U(b), U(c));
    else T.tri(mat, a, c, b, U(a), U(c), U(b));
  }
}

export const inPoly = (x, z, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/** in the turned rect (centre, half extents along the edge angle ang) */
export function inTurned(x, z, cx, cz, hx, hz, ang, pad = 0) {
  const dx = x - cx, dz = z - cz, c = Math.cos(ang), s = Math.sin(ang);
  return Math.abs(dx * c + dz * s) < hx + pad && Math.abs(-dx * s + dz * c) < hz + pad;
}
export const inHall = (x, z, pad = 0) => x > HALL.x0 - pad && x < HALL.x1 + pad && z > HALL.z0 - pad && z < HALL.z1 + pad;
export const inGarage = (x, z, pad = 0) => inTurned(x, z, GARAGE.x, GARAGE.z, GARAGE.hx, GARAGE.hz, GARAGE.ang, pad);
export const inDM = (x, z, pad = 0) => inTurned(x, z, DM_CENTER[0], DM_CENTER[1], DM.w / 2, DM.d / 2, DM.ang, pad);

// ---------------------------------------------------------------- LoD2 buildings
// Which LoD2 buildings get which look (ids from public/maps/appenweier.json); the rest by use / height.
export const B_ID = {
  h13: 'DEBW_00100021g1T',
  h13a: 'DEBW_00100021g1U',
  h13c: 'DEBW_00100021g1V', // (13d in OSM; the sign on it says 13c)
  garageW: 'DEBW_00100021g1W',
  garageE: 'DEBW_00100021g1S',
  fire: 'DEBW_00100021g1Y',
  dm: 'DEBW_001000oRj1I',
  works: 'DEBW_00100021g1R', // the gate and door maker next door (13a leans on it)
  h13b: 'DEBW_00100021g1Q',
};
export function lod2Tris(T, mat, tris, yBase, skip = null, matFor = null, clipBelow = null) {
  const mpr = getMaterial(mat).userData.metersPerRepeat || 1;
  const list = [];
  for (let i = 0; i < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1] + yBase, tris[i + 2]];
    const b = [tris[i + 3], tris[i + 4] + yBase, tris[i + 5]];
    const c = [tris[i + 6], tris[i + 7] + yBase, tris[i + 8]];
    const cut = clipBelow?.(a, b, c);
    if (cut == null) list.push([a, b, c]);
    else for (const t of clipAbove(a, b, c, cut)) list.push(t);
  }
  for (const [a, b, c] of list) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    if (skip?.(a, b, c, nx, ny, nz)) continue;
    const m = matFor?.(a, b, c, nx, ny, nz) ?? mat;
    const k = m === mat ? mpr : getMaterial(m).userData.metersPerRepeat || 1;
    // tangent: horizontal, along the face (for a flat roof: x)
    let tx = -nz, tz = nx;
    const tl = Math.hypot(tx, tz);
    let uv;
    if (tl < 0.15) uv = (p) => [p[0] / k, -p[2] / k];
    else {
      tx /= tl;
      tz /= tl;
      if (Math.abs(ny) < 0.3) uv = (p) => [(p[0] * tx + p[2] * tz) / k, (p[1] - yBase) / k];
      else {
        // up the slope: bitangent = n x t
        const bx = ny * tz, by = nz * tx - nx * tz, bz = -ny * tx;
        uv = (p) => [(p[0] * tx + p[2] * tz) / k, (p[0] * bx + p[1] * by + p[2] * bz) / k];
      }
    }
    T.tri(m, a, b, c, uv(a), uv(b), uv(c));
  }
}

/** the part of triangle a, b, c at or above y (0-2 triangles, same winding) */
function clipAbove(a, b, c, y) {
  const P = [a, b, c];
  const out = [];
  for (let i = 0; i < 3; i++) {
    const p = P[i], q = P[(i + 1) % 3];
    const pin = p[1] >= y, qin = q[1] >= y;
    if (pin) out.push(p);
    if (pin !== qin) {
      const t = (y - p[1]) / (q[1] - p[1]);
      out.push([p[0] + (q[0] - p[0]) * t, y, p[2] + (q[2] - p[2]) * t]);
    }
  }
  if (out.length < 3) return [];
  const tris = [[out[0], out[1], out[2]]];
  if (out.length === 4) tris.push([out[0], out[2], out[3]]);
  return tris;
}
