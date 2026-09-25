// Procedural, detailed props for the Cabin Fever remake.
//
//   buildProp(type, opts) -> { object: THREE.Group, colliders: [{min,max}], anchors?: {name: Vector3} }
//
// Conventions
//   * origin = footprint centre on the floor (y = 0), front faces +Z, meters.
//     Exceptions (documented per type): hangingLamp (ceiling point), wireCable (absolute from/to),
//     boardedWindow / windowFrame (opening centre), door (hinge-side bottom corner, extends +X),
//     railing (start point, extends +X), wallShelfToolbox (wall point, shelf top at y = opts.height ?? 0),
//     cellarDoors (centre; low entry end at -Z, high end / stair direction at +Z).
//   * every sub-part is merged into ONE mesh per material per prop (geometry is cached per
//     type+opts, meshes share geometry + the cached materials from materials.js).
//   * all geometry is non-indexed with exactly position/normal/uv (batchStatic-friendly).
//   * UVs are in world meters / material.userData.metersPerRepeat; wood grain follows each
//     part's longest axis along U (flip GRAIN_ALONG_U if the textures run the other way).
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from './materials.js';

const V3 = THREE.Vector3;
const V2 = THREE.Vector2;
const PI = Math.PI;
const TAU = Math.PI * 2;
const HP = Math.PI / 2;
const GRAIN_ALONG_U = true;

// ============================================================================ RNG / noise
function hashSeed(s) {
  s = (s | 0) ^ 0x5bd1e995;
  s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d);
  s = Math.imul(s ^ (s >>> 12), 0x297a2d39);
  return (s ^ (s >>> 15)) >>> 0;
}
class RNG {
  constructor(seed) {
    this.a = hashSeed(seed) || 1;
  }
  next() {
    let a = (this.a = (this.a + 0x6d2b79f5) | 0);
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) {
    return a + (b - a) * this.next();
  }
  jit(a) {
    return (this.next() * 2 - 1) * a;
  }
  int(a, b) {
    return a + Math.floor(this.next() * (b - a + 1));
  }
  chance(p) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length) % arr.length];
  }
}
function hash3i(x, y, z) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const L = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3i(xi + dx, yi + dy, zi + dz);
  return (
    L(
      L(L(c(0, 0, 0), c(1, 0, 0), u), L(c(0, 1, 0), c(1, 1, 0), u), v),
      L(L(c(0, 0, 1), c(1, 0, 1), u), L(c(0, 1, 1), c(1, 1, 1), u), v),
      w
    ) * 2 - 1
  );
}
function fbm(x, y, z) {
  return vnoise(x, y, z) * 0.6 + vnoise(x * 2.07 + 11.3, y * 2.07 + 1.7, z * 2.07) * 0.3 + vnoise(x * 4.3 + 3.1, y * 4.3, z * 4.3 + 7.7) * 0.1;
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// ============================================================================ material specs
// A material "key" is a string; M() registers tinted / emissive / no-shadow variants.
const MATSPEC = new Map();
const NO_SHADOW = new Set(['glass', 'bulb']);
function M(name, opts = null, cast) {
  if (cast === undefined) cast = !NO_SHADOW.has(name);
  const key = name + (opts ? JSON.stringify(opts) : '') + (cast ? '' : '#ns');
  if (!MATSPEC.has(key)) MATSPEC.set(key, { name, opts: opts || undefined, cast });
  return key;
}
// custom (non materials.js) material, e.g. the painted sign lettering
function MC(key, material, cast = false) {
  if (!MATSPEC.has(key)) MATSPEC.set(key, { name: key, custom: material, cast });
  return key;
}
function specOf(key) {
  let s = MATSPEC.get(key);
  if (!s) {
    s = { name: key, opts: undefined, cast: !NO_SHADOW.has(key) };
    MATSPEC.set(key, s);
  }
  return s;
}
function resolveMat(spec) {
  if (spec.custom) return spec.custom;
  return spec.opts ? getMaterial(spec.name, spec.opts) : getMaterial(spec.name);
}
const NAIL = M('rustyMetal', null, false);
const VOID = M('metalDark', { color: 0x060606 });

// ============================================================================ geometry primitives
/** Box with 45° chamfered edges (44 tris, flat shaded). */
function chamferBoxGeo(w, h, d, c) {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  c = Math.min(c, hx * 0.9, hy * 0.9, hz * 0.9);
  const V = (t, sx, sy, sz) => [sx * (t === 0 ? hx : hx - c), sy * (t === 1 ? hy : hy - c), sz * (t === 2 ? hz : hz - c)];
  const pos = [];
  const tri = (a, b, e) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = e[0] - a[0], vy = e[1] - a[1], vz = e[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = a[0] + b[0] + e[0], cy = a[1] + b[1] + e[1], cz = a[2] + b[2] + e[2];
    if (nx * cx + ny * cy + nz * cz < 0) pos.push(...a, ...e, ...b);
    else pos.push(...a, ...b, ...e);
  };
  const quad = (a, b, e, f) => {
    tri(a, b, e);
    tri(a, e, f);
  };
  const S = [-1, 1];
  for (const s of S) {
    quad(V(0, s, -1, -1), V(0, s, 1, -1), V(0, s, 1, 1), V(0, s, -1, 1));
    quad(V(1, -1, s, -1), V(1, 1, s, -1), V(1, 1, s, 1), V(1, -1, s, 1));
    quad(V(2, -1, -1, s), V(2, 1, -1, s), V(2, 1, 1, s), V(2, -1, 1, s));
  }
  for (const a of S)
    for (const e of S) {
      quad(V(1, -1, a, e), V(1, 1, a, e), V(2, 1, a, e), V(2, -1, a, e));
      quad(V(0, a, -1, e), V(0, a, 1, e), V(2, a, 1, e), V(2, a, -1, e));
      quad(V(0, a, e, -1), V(0, a, e, 1), V(1, a, e, 1), V(1, a, e, -1));
    }
  for (const sx of S) for (const sy of S) for (const sz of S) tri(V(0, sx, sy, sz), V(1, sx, sy, sz), V(2, sx, sy, sz));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Rounded ("soft") box with arbitrary subdivisions, welded + smooth normals (for cushions, bags). */
function softBoxGeo(w, h, d, rad, kx = 4, ky = 4, kz = 4) {
  rad = Math.min(rad, w * 0.49, h * 0.49, d * 0.49);
  kx = Math.max(2, kx | 0);
  ky = Math.max(2, ky | 0);
  kz = Math.max(2, kz | 0);
  const g = new THREE.BoxGeometry(1, 1, 1, kx, ky, kz);
  const map = (u, k, half) => {
    const i = Math.round((u + 0.5) * k);
    if (i <= 0) return -half;
    if (i >= k) return half;
    const t = k > 2 ? (i - 1) / (k - 2) : 0.5;
    return -half + rad + t * (2 * half - 2 * rad);
  };
  const pa = g.attributes.position;
  const hx = w / 2 - rad, hy = h / 2 - rad, hz = d / 2 - rad;
  for (let i = 0; i < pa.count; i++) {
    const x = map(pa.getX(i), kx, w / 2), y = map(pa.getY(i), ky, h / 2), z = map(pa.getZ(i), kz, d / 2);
    const ix = clamp(x, -hx, hx), iy = clamp(y, -hy, hy), iz = clamp(z, -hz, hz);
    let dx = x - ix, dy = y - iy, dz = z - iz;
    const l = Math.hypot(dx, dy, dz);
    if (l > 1e-9) {
      dx /= l;
      dy /= l;
      dz /= l;
      pa.setXYZ(i, ix + dx * rad, iy + dy * rad, iz + dz * rad);
    } else pa.setXYZ(i, x, y, z);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const m = mergeVertices(g, 1e-5);
  m.computeVertexNormals();
  return m;
}

/** Lathe around Y with welded seam. prof: [[r,y],...] (CCW in r/y => outward normals).
 *  skip(i, j, y0, y1) may omit quads (holes). Repeat a profile point for a hard crease. */
function latheGeo(prof, seg = 12, skip = null) {
  const pos = [];
  const idx = [];
  const n = prof.length;
  const start = [], pole = [];
  for (let i = 0; i < n; i++) {
    const [r, y] = prof[i];
    start.push(pos.length / 3);
    pole.push(r < 1e-6);
    if (r < 1e-6) {
      pos.push(0, y, 0);
      continue;
    }
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      pos.push(r * Math.cos(a), y, r * Math.sin(a));
    }
  }
  const vi = (i, j) => (pole[i] ? start[i] : start[i] + (j % seg));
  for (let i = 0; i < n - 1; i++) {
    if (pole[i] && pole[i + 1]) continue;
    for (let j = 0; j < seg; j++) {
      if (skip && skip(i, j, prof[i][1], prof[i + 1][1])) continue;
      const A = vi(i, j), B = vi(i, j + 1), C = vi(i + 1, j + 1), D = vi(i + 1, j);
      if (pole[i]) idx.push(A, D, C);
      else if (pole[i + 1]) idx.push(A, C, B);
      else idx.push(A, C, B, A, D, C);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Loft through closed rings (arrays of [x,y,z], same length, ordered x=cos / z=sin).
 *  Ascending rings => outward normals. cap: +1 facing up, -1 facing down, 0 none. */
function loftGeo(rings, capFirst = 0, capLast = 0) {
  const pos = [];
  const idx = [];
  const N = rings[0].length;
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      const A = i * N + j, B = i * N + j1, C = (i + 1) * N + j1, D = (i + 1) * N + j;
      idx.push(A, C, B, A, D, C);
    }
  }
  const cap = (ri, dir) => {
    if (!dir) return;
    const ring = rings[ri];
    let cx = 0, cy = 0, cz = 0;
    for (const p of ring) {
      cx += p[0];
      cy += p[1];
      cz += p[2];
    }
    const c = pos.length / 3;
    pos.push(cx / N, cy / N, cz / N);
    for (let j = 0; j < N; j++) {
      const a = ri * N + j, b = ri * N + ((j + 1) % N);
      if (dir > 0) idx.push(c, b, a);
      else idx.push(c, a, b);
    }
  };
  cap(0, capFirst);
  cap(rings.length - 1, capLast);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Rounded-rectangle ring (x = w, z = d) at height y, k segments per corner. */
function rrRing(w, d, r, y, k = 4, cx = 0, cz = 0) {
  r = Math.min(r, w * 0.49, d * 0.49);
  const pts = [];
  const corners = [
    [1, 1, 0],
    [-1, 1, HP],
    [-1, -1, PI],
    [1, -1, PI * 1.5],
  ];
  for (const [sx, sz, a0] of corners) {
    for (let i = 0; i <= k; i++) {
      const a = a0 + (i / k) * HP;
      pts.push([cx + sx * (w / 2 - r) + r * Math.cos(a), y, cz + sz * (d / 2 - r) + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Tapered tube along points (parallel-transport frames). radius: number | array | fn(i,n).
 *  UVs in meters: u along the length (grain), v around. */
function tubeGeo(points, radius, radial = 6, capEnd = true, capStart = false) {
  const P = points.map((p) => (p.isVector3 ? p.clone() : new V3(p[0], p[1], p[2])));
  const n = P.length;
  const rad = typeof radius === 'function' ? radius : Array.isArray(radius) ? (i) => radius[Math.min(i, radius.length - 1)] : () => radius;
  const T = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    const t = new V3().subVectors(b, a);
    if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
    T.push(t.normalize());
  }
  const ax = Math.abs(T[0].y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
  let N = new V3().crossVectors(T[0], ax).normalize();
  const Ns = [N.clone()];
  const qt = new THREE.Quaternion();
  for (let i = 1; i < n; i++) {
    qt.setFromUnitVectors(T[i - 1], T[i]);
    N = N.clone().applyQuaternion(qt);
    N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize();
    Ns.push(N);
  }
  const pos = [], nor = [], uv = [], idx = [];
  let s = 0;
  const B = new V3();
  for (let i = 0; i < n; i++) {
    if (i > 0) s += P[i].distanceTo(P[i - 1]);
    B.crossVectors(T[i], Ns[i]);
    const r = rad(i, n);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const c = Math.cos(a), sn = Math.sin(a);
      const nx = Ns[i].x * c + B.x * sn, ny = Ns[i].y * c + B.y * sn, nz = Ns[i].z * c + B.z * sn;
      pos.push(P[i].x + r * nx, P[i].y + r * ny, P[i].z + r * nz);
      nor.push(nx, ny, nz);
      uv.push(s, a * Math.max(r, 0.004));
    }
  }
  const R1 = radial + 1;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * R1 + j, b = a + R1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const cap = (i, dir) => {
    const c = pos.length / 3;
    pos.push(P[i].x, P[i].y, P[i].z);
    const t = T[i];
    nor.push(t.x * dir, t.y * dir, t.z * dir);
    uv.push(s, 0);
    for (let j = 0; j < radial; j++) {
      const a = i * R1 + j;
      if (dir > 0) idx.push(c, a, a + 1);
      else idx.push(c, a + 1, a);
    }
  };
  if (capEnd && rad(n - 1, n) > 0.0005) cap(n - 1, 1);
  if (capStart && rad(0, n) > 0.0005) cap(0, -1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Catmull-Rom resample of control points -> smooth point list. */
function smoothPts(ctrl, count) {
  const c = new THREE.CatmullRomCurve3(ctrl.map((p) => (p.isVector3 ? p : new V3(p[0], p[1], p[2]))), false, 'centripetal');
  return c.getPoints(count);
}

/** Extrude a 2D outline (optionally with holes) by thick, centred on z. */
function extrudeGeo(pts, holes, thick, bevel = 0.004) {
  const shape = new THREE.Shape(pts.map((p) => new V2(p[0], p[1])));
  for (const h of holes || []) shape.holes.push(new THREE.Path(h.map((p) => new V2(p[0], p[1]))));
  const depth = Math.max(0.0005, thick - 2 * bevel);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 1,
    steps: 1,
    curveSegments: 4,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}
/** Same, but the outline is given in (z, y) and extruded along X. */
function sideGeo(pts, holes, thick, bevel = 0.004) {
  const g = extrudeGeo(pts, holes, thick, bevel);
  g.rotateY(-HP);
  return g;
}
function shapeGeo(pts, holes) {
  const shape = new THREE.Shape(pts.map((p) => new V2(p[0], p[1])));
  for (const h of holes || []) shape.holes.push(new THREE.Path(h.map((p) => new V2(p[0], p[1]))));
  return new THREE.ShapeGeometry(shape, 2);
}
/** Rounded rect outline points (CCW), x centred, y from y0 to y0+h. */
function rrPoints(w, h, rb, rt, seg = 5, y0 = 0) {
  const pts = [];
  const arc = (cx, cy, r, a0, a1) => {
    if (r <= 0.0001) {
      pts.push([cx, cy]);
      return;
    }
    for (let i = 0; i <= seg; i++) {
      const a = a0 + ((a1 - a0) * i) / seg;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  arc(-w / 2 + rb, y0 + rb, rb, PI, PI * 1.5);
  arc(w / 2 - rb, y0 + rb, rb, PI * 1.5, TAU);
  arc(w / 2 - rt, y0 + h - rt, rt, 0, HP);
  arc(-w / 2 + rt, y0 + h - rt, rt, HP, PI);
  return pts;
}

// ============================================================================ UV projection
const _a = new V3(), _b = new V3(), _c = new V3(), _n = new V3();
function faceNormal(p, t) {
  _a.fromArray(p, t * 3);
  _b.fromArray(p, t * 3 + 3);
  _c.fromArray(p, t * 3 + 6);
  _b.sub(_a);
  _c.sub(_a);
  return _n.crossVectors(_b, _c);
}
function setUV(uv, i, u, v) {
  if (GRAIN_ALONG_U) {
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  } else {
    uv[i * 2] = v;
    uv[i * 2 + 1] = u;
  }
}
/** Box projection in the part's local space; U runs along the grain axis (longest by default). */
function projectBox(g, grain, ou, ov) {
  const p = g.attributes.position.array;
  const n = p.length / 3;
  g.computeBoundingBox();
  const s = g.boundingBox.getSize(new V3());
  const L = grain ?? (s.x >= s.y && s.x >= s.z ? 0 : s.y >= s.z ? 1 : 2);
  const uv = new Float32Array(n * 2);
  for (let t = 0; t + 2 < n; t += 3) {
    const f = faceNormal(p, t);
    const ax = Math.abs(f.x), ay = Math.abs(f.y), az = Math.abs(f.z);
    const N = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    let ua, va;
    if (N === L) {
      ua = (L + 1) % 3;
      va = (L + 2) % 3;
    } else {
      ua = L;
      va = 3 - N - L;
    }
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      setUV(uv, i, p[i * 3 + ua] + ou, p[i * 3 + va] + ov);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
/** Cylindrical projection around local Y (u along the axis, v around); caps planar. */
function projectCyl(g, ou, ov) {
  const p = g.attributes.position.array;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  const ang = [0, 0, 0];
  for (let t = 0; t + 2 < n; t += 3) {
    const f = faceNormal(p, t);
    const l = f.length();
    const ny = l > 1e-14 ? Math.abs(f.y) / l : 0;
    if (ny > 0.8) {
      for (let k = 0; k < 3; k++) {
        const i = t + k;
        setUV(uv, i, p[i * 3] + ou, p[i * 3 + 2] + ov);
      }
      continue;
    }
    let mn = 9, mx = -9;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      ang[k] = Math.atan2(p[i * 3], p[i * 3 + 2]);
      mn = Math.min(mn, ang[k]);
      mx = Math.max(mx, ang[k]);
    }
    if (mx - mn > PI) for (let k = 0; k < 3; k++) if (ang[k] < 0) ang[k] += TAU;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const r = Math.hypot(p[i * 3], p[i * 3 + 2]);
      setUV(uv, i, p[i * 3 + 1] + ou, ang[k] * r + ov);
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function flipWinding(g) {
  for (const name of Object.keys(g.attributes)) {
    const at = g.attributes[name];
    const a = at.array, s = at.itemSize;
    for (let t = 0; t + 2 < at.count; t += 3) {
      for (let k = 0; k < s; k++) {
        const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k;
        const tmp = a[i1];
        a[i1] = a[i2];
        a[i2] = tmp;
      }
    }
    at.needsUpdate = true;
  }
}

// ============================================================================ builder
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function mat4(pos, rot, scl) {
  const m = new THREE.Matrix4();
  _e.set(rot ? rot[0] : 0, rot ? rot[1] : 0, rot ? rot[2] : 0, (rot && rot[3]) || 'YXZ');
  _q.setFromEuler(_e);
  m.compose(
    new V3(pos ? pos[0] : 0, pos ? pos[1] : 0, pos ? pos[2] : 0),
    _q,
    scl ? new V3(scl[0], scl[1], scl[2]) : new V3(1, 1, 1)
  );
  return m;
}

class PB {
  constructor(seed, type) {
    this.r = new RNG(seed);
    this.type = type;
    this.parts = new Map();
    this.stack = [new THREE.Matrix4()];
    this.cols = [];
    this.anchors = {};
    this.noShadow = false;
    this.alignGround = false;
  }
  get top() {
    return this.stack[this.stack.length - 1];
  }
  push(pos, rot, scl) {
    this.stack.push(this.top.clone().multiply(mat4(pos, rot, scl)));
    return this;
  }
  pushM(m) {
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }
  pop() {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }
  grp(pos, rot, fn, scl) {
    this.push(pos, rot, scl);
    try {
      fn();
    } finally {
      this.pop();
    }
  }
  /** current-space point -> prop space */
  pt(x, y, z) {
    return new V3(x, y, z).applyMatrix4(this.top);
  }
  col(min, max) {
    this.cols.push({
      min: [Math.min(min[0], max[0]), Math.min(min[1], max[1]), Math.min(min[2], max[2])],
      max: [Math.max(min[0], max[0]), Math.max(min[1], max[1]), Math.max(min[2], max[2])],
    });
  }
  anchor(name, v) {
    this.anchors[name] = v.isVector3 ? v.clone() : new V3(v[0], v[1], v[2]);
  }

  /** Add a geometry part. o: { uv:'box'|'cyl'|'keepM'|'keep', grain, deform(v,i), weld, invert, scl, matrix } */
  add(mat, geo, pos, rot, o = {}) {
    let g = geo;
    if (o.deform) {
      g = g.clone();
      if (o.weld !== false) {
        if (g.attributes.normal) g.deleteAttribute('normal');
        if (g.attributes.uv) g.deleteAttribute('uv');
        g = mergeVertices(g, 1e-5);
      }
      const pa = g.attributes.position;
      const v = new V3();
      for (let i = 0; i < pa.count; i++) {
        v.fromBufferAttribute(pa, i);
        o.deform(v, i);
        pa.setXYZ(i, v.x, v.y, v.z);
      }
      if (g.attributes.normal) g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    g = g.index ? g.toNonIndexed() : g === geo ? g.clone() : g;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.morphAttributes = {};
    g.clearGroups();
    const mode = o.uv || 'box';
    const ou = this.r.range(0, 7), ov = this.r.range(0, 7);
    if (mode === 'box') projectBox(g, o.grain, ou, ov);
    else if (mode === 'cyl') projectCyl(g, ou, ov);
    else {
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      if (mode === 'keepM') {
        const uv = g.attributes.uv.array;
        for (let i = 0; i < uv.length; i += 2) {
          uv[i] += ou;
          uv[i + 1] += ov;
        }
      }
    }
    if (o.invert) {
      flipWinding(g);
      const nn = g.attributes.normal.array;
      for (let i = 0; i < nn.length; i++) nn[i] = -nn[i];
    }
    g.userData = { scaleUV: mode !== 'keep' };
    const m = this.top.clone();
    if (o.matrix) m.multiply(o.matrix);
    if (pos || rot || o.scl) m.multiply(mat4(pos, rot, o.scl));
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    let key = mat;
    if (this.noShadow) {
      const s = specOf(mat);
      if (s.cast) key = s.custom ? MC(mat + '#ns', s.custom, false) : M(s.name, s.opts || null, false);
    }
    let list = this.parts.get(key);
    if (!list) this.parts.set(key, (list = []));
    list.push(g);
    return g;
  }
  box(mat, w, h, d, pos, rot, o = {}) {
    const c = o.c ?? Math.min(0.01, Math.min(w, h, d) * 0.18);
    const geo = c > 0.0006 ? chamferBoxGeo(w, h, d, c) : new THREE.BoxGeometry(w, h, d, o.sx || 1, o.sy || 1, o.sz || 1);
    return this.add(mat, geo, pos, rot, o);
  }
  cyl(mat, rt, rb, h, seg, pos, rot, o = {}) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg, o.hs || 1, !!o.open, o.ts || 0, o.tl || TAU);
    return this.add(mat, geo, pos, rot, { uv: 'cyl', ...o });
  }
  sph(mat, r, pos, rot, o = {}) {
    const geo = new THREE.SphereGeometry(r, o.ws || 10, o.hs || 7);
    return this.add(mat, geo, pos, rot, o);
  }
  lathe(mat, prof, seg, pos, rot, o = {}) {
    return this.add(mat, latheGeo(prof, seg, o.skip), pos, rot, { uv: 'cyl', weld: false, ...o });
  }
  tube(mat, pts, radius, radial = 6, o = {}) {
    const geo = tubeGeo(pts, radius, radial, o.capEnd ?? true, o.capStart ?? false);
    return this.add(mat, geo, o.pos, o.rot, { uv: 'keepM', weld: false, ...o });
  }
  soft(mat, w, h, d, rad, k, pos, rot, o = {}) {
    const geo = softBoxGeo(w, h, d, rad, k[0], k[1], k[2]);
    return this.add(mat, geo, pos, rot, { weld: false, ...o });
  }

  finish() {
    if (this.alignGround) {
      let minY = Infinity;
      for (const list of this.parts.values())
        for (const g of list) {
          const a = g.attributes.position.array;
          for (let i = 1; i < a.length; i += 3) if (a[i] < minY) minY = a[i];
        }
      if (isFinite(minY) && Math.abs(minY) > 1e-5) for (const list of this.parts.values()) for (const g of list) g.translate(0, -minY, 0);
    }
    const meshes = [];
    for (const [key, list] of this.parts) {
      const spec = specOf(key);
      const mat = resolveMat(spec);
      const mpr = (mat && mat.userData && mat.userData.metersPerRepeat) || 1;
      for (const g of list) {
        if (g.userData.scaleUV && mpr !== 1) {
          const uv = g.attributes.uv.array;
          for (let i = 0; i < uv.length; i++) uv[i] /= mpr;
        }
      }
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) throw new Error(`props: mergeGeometries failed for ${this.type} / ${key}`);
      merged.userData = {};
      merged.computeBoundingBox();
      merged.computeBoundingSphere();
      meshes.push({ key, geo: merged, cast: spec.cast });
    }
    return { meshes, colliders: this.cols, anchors: this.anchors };
  }
}

// ============================================================================ shared sub-parts
const P = (...a) => a; // tiny helper for readability of point lists

function paintTint(r) {
  const c = r.pick([null, null, 0xc4bcaa, 0xaeb8aa, 0xb0b6be, 0xb8a894]);
  return c ? M('woodPainted', { color: c }) : 'woodPainted';
}
function nailZ(b, x, y, z, mat = NAIL) {
  b.cyl(mat, 0.0055, 0.005, 0.004, 5, [x, y, z + 0.002], [HP, 0, 0]);
}
function nailY(b, x, y, z, mat = NAIL) {
  b.cyl(mat, 0.0055, 0.005, 0.004, 5, [x, y + 0.002, z]);
}
function boltZ(b, mat, x, y, z, r = 0.007) {
  b.cyl(mat, r, r, r * 0.8, 6, [x, y, z + r * 0.4], [HP, 0, 0]);
}
/** Board lying in the XY plane (length X, width Y, thickness Z), optionally with splintered ends. */
function plankGeo(len, w, t, r, breakL = false, breakR = false) {
  if (!breakL && !breakR) return chamferBoxGeo(len, w, t, Math.min(0.004, t * 0.25));
  const hl = len / 2, hw = w / 2;
  const pts = [[-hl, -hw]];
  const n = 4;
  if (breakR) {
    const base = hl - r.range(0.03, 0.08);
    pts.push([base + r.range(-0.01, 0.03), -hw]);
    for (let i = 1; i < n; i++) pts.push([base + r.range(-0.03, 0.08), -hw + (w * i) / n]);
    pts.push([base + r.range(-0.01, 0.04), hw]);
  } else {
    pts.push([hl, -hw], [hl, hw]);
  }
  if (breakL) {
    const base = -hl + r.range(0.03, 0.08);
    pts.push([base - r.range(-0.01, 0.04), hw]);
    for (let i = n - 1; i > 0; i--) pts.push([base - r.range(-0.03, 0.08), -hw + (w * i) / n]);
    pts.push([base - r.range(-0.01, 0.03), -hw]);
  } else {
    pts.push([-hl, hw]);
  }
  return extrudeGeo(pts, null, t, Math.min(0.0025, t * 0.2));
}
function plank(b, mat, len, w, t, pos, rot, o = {}) {
  return b.add(mat, plankGeo(len, w, t, b.r, o.breakL, o.breakR), pos, rot, { grain: 0, ...o });
}

function turnedProfile(h, R) {
  return [
    [0, 0],
    [R * 0.6, 0],
    [R * 0.66, h * 0.015],
    [R * 0.7, h * 0.06],
    [R * 0.84, h * 0.085],
    [R * 0.66, h * 0.11],
    [R * 0.74, h * 0.16],
    [R * 0.55, h * 0.6],
    [R * 0.6, h * 0.7],
    [R * 0.88, h * 0.76],
    [R * 0.62, h * 0.82],
    [R * 0.74, h * 0.88],
    [R * 0.9, h * 0.95],
    [R * 0.9, h],
    [0, h],
  ];
}
function bottleProfile(kind) {
  switch (kind) {
    case 'wine':
      return [[0, 0.006], [0.03, 0], [0.036, 0.008], [0.036, 0.19], [0.03, 0.212], [0.016, 0.244], [0.014, 0.285], [0.017, 0.29], [0.016, 0.3], [0, 0.3]];
    case 'jug':
      return [[0, 0.004], [0.055, 0], [0.062, 0.02], [0.064, 0.12], [0.05, 0.17], [0.022, 0.2], [0.018, 0.225], [0.021, 0.232], [0, 0.236]];
    case 'flask':
      return [[0, 0.004], [0.028, 0], [0.034, 0.01], [0.034, 0.1], [0.03, 0.125], [0.012, 0.15], [0.012, 0.17], [0.014, 0.175], [0, 0.176]];
    default: // beer
      return [[0, 0.004], [0.026, 0], [0.031, 0.01], [0.031, 0.135], [0.022, 0.165], [0.012, 0.2], [0.012, 0.222], [0.015, 0.226], [0.014, 0.233], [0, 0.233]];
  }
}
function jarProfile(R, h) {
  return [[0, 0], [R * 0.9, 0], [R, R * 0.2], [R, h * 0.84], [R * 0.84, h * 0.93], [R * 0.84, h], [0, h]];
}
/** tyre cross-section loop (CCW in r/y), y centred */
function tireProfile(R, rim, W) {
  const hw = W / 2;
  const s = R - rim;
  return [
    [rim, -hw * 0.82],
    [rim + s * 0.3, -hw],
    [R - s * 0.22, -hw * 0.97],
    [R - 0.008, -hw * 0.84],
    [R, -hw * 0.66],
    [R, -hw * 0.3],
    [R - 0.007, -hw * 0.24],
    [R - 0.007, -hw * 0.12],
    [R, -hw * 0.06],
    [R, hw * 0.06],
    [R - 0.007, hw * 0.12],
    [R - 0.007, hw * 0.24],
    [R, hw * 0.3],
    [R, hw * 0.66],
    [R - 0.008, hw * 0.84],
    [R - s * 0.22, hw * 0.97],
    [rim + s * 0.3, hw],
    [rim, hw * 0.82],
    [rim - 0.012, 0],
    [rim, -hw * 0.82],
  ];
}
function bucketProfile(R = 0.145, H = 0.3) {
  const rb = R * 0.78;
  return [
    [0, 0.006],
    [rb - 0.01, 0.006],
    [rb, 0],
    [rb + 0.004, 0.012],
    [rb + 0.002, 0.02],
    [lerp(rb, R, 0.35), H * 0.35],
    [lerp(rb, R, 0.35) + 0.004, H * 0.37],
    [lerp(rb, R, 0.39), H * 0.39],
    [lerp(rb, R, 0.7), H * 0.7],
    [lerp(rb, R, 0.7) + 0.004, H * 0.72],
    [lerp(rb, R, 0.74), H * 0.74],
    [R, H - 0.012],
    [R + 0.007, H - 0.008],
    [R + 0.007, H],
    [R - 0.002, H + 0.002],
    [R - 0.005, H - 0.006],
    [rb - 0.004, 0.014],
    [0, 0.012],
  ];
}
/** Cloth drape path (x,y) across an edge: flat on top until e0, bend down, hang, bend out onto the floor.
 *  d = distance past e0 along the cloth. Returns [x, y, nx, ny] (normal = cloth's upper side). */
function drapePath(d, top, e0, floorY = 0.008, rb = 0.05) {
  if (d <= 0) return [e0 + d, top, 0, 1];
  const q = (PI / 2) * rb;
  if (d <= q) {
    const f = d / rb;
    return [e0 + rb * Math.sin(f), top - rb + rb * Math.cos(f), Math.sin(f), Math.cos(f)];
  }
  const V = Math.max(0, top - floorY - 2 * rb);
  const d2 = d - q;
  if (d2 <= V) return [e0 + rb, top - rb - d2, 1, 0];
  const d3 = d2 - V;
  if (d3 <= q) {
    const f = d3 / rb;
    return [e0 + 2 * rb - rb * Math.cos(f), floorY + rb - rb * Math.sin(f), Math.cos(f), Math.sin(f)];
  }
  return [e0 + 2 * rb + (d3 - q), floorY, 0, 1];
}

/** Thin glass pane in XY (w x h) as a shape, optionally broken. mode: 'full' | 'hole' | 'shard' | 'none' */
function paneGeo(w, h, r, mode) {
  const hw = w / 2, hh = h / 2;
  const rect = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  if (mode === 'full') return shapeGeo(rect);
  if (mode === 'hole') {
    const cx = r.jit(hw * 0.25), cy = r.jit(hh * 0.25);
    const n = 9;
    const hole = [];
    for (let i = 0; i < n; i++) {
      const a = -(i / n) * TAU;
      const rr = (i % 2 ? 0.35 : 0.75) * r.range(0.6, 1);
      hole.push([cx + Math.cos(a) * hw * rr * 0.9, cy + Math.sin(a) * hh * rr * 0.9]);
    }
    return shapeGeo(rect, [hole.map(([x, y]) => [clamp(x, -hw * 0.92, hw * 0.92), clamp(y, -hh * 0.92, hh * 0.92)])]);
  }
  // shard: jagged remnant along the bottom (and a sliver up one side)
  const pts = [[-hw, -hh], [hw, -hh]];
  const side = r.chance(0.5) ? 1 : -1;
  const k = 6;
  const top = [];
  for (let i = 0; i <= k; i++) {
    const x = lerp(hw, -hw, i / k);
    const nearSide = side > 0 ? (hw - x) / w : (x + hw) / w;
    top.push([x, -hh + h * (nearSide < 0.2 ? r.range(0.4, 0.8) : r.range(0.05, 0.3)) * (i % 2 ? 1 : 0.6)]);
  }
  return shapeGeo(pts.concat(top.slice(0, -1)).concat([[-hw, top[top.length - 1][1]]]));
}

// ============================================================================ props: interior furniture
const BUILDERS = {};

/** Frame-and-panel door/front in local space: x ∈ [0,w] (hinge side at 0), y ∈ [0,h], z centred, front +Z. */
function frameDoor(b, mat, w, h, t, o = {}) {
  const sw = o.stile ?? Math.min(0.07, w * 0.14);
  const rt = o.rail ?? sw, rb = o.bottomRail ?? sw * 1.3, mid = o.mid ?? sw;
  const cols = o.cols ?? 1, rows = o.rows ?? 1;
  const c = Math.min(0.004, t * 0.2);
  b.box(mat, sw, h, t, [sw / 2, h / 2, 0], null, { c });
  b.box(mat, sw, h, t, [w - sw / 2, h / 2, 0], null, { c });
  const iw = w - 2 * sw;
  b.box(mat, iw, rt, t, [w / 2, h - rt / 2, 0], null, { c });
  b.box(mat, iw, rb, t, [w / 2, rb / 2, 0], null, { c });
  const ih = h - rt - rb - (rows - 1) * mid;
  const wts = o.rowWeights || new Array(rows).fill(1);
  const wsum = wts.reduce((a, c) => a + c, 0);
  const pw = (iw - (cols - 1) * mid) / cols;
  const panels = [];
  let py = rb;
  for (let ri = 0; ri < rows; ri++) {
    const ph = (ih * wts[ri]) / wsum;
    if (ri > 0) py += mid;
    if (ri > 0) b.box(mat, iw, mid, t * (o.glass ? 0.8 : 1), [w / 2, py - mid / 2, 0], null, { c });
    for (let ci = 0; ci < cols; ci++) {
      const px = sw + ci * (pw + mid);
      if (ci > 0) b.box(mat, mid, ph, t * (o.glass ? 0.8 : 1), [px - mid / 2, py + ph / 2, 0], null, { c });
      const pn = { x: px + pw / 2, y: py + ph / 2, w: pw, h: ph, row: ri, col: ci };
      panels.push(pn);
      if (!o.glass && !(o.skip && o.skip(pn)))
        b.box(mat, pw + 0.014, ph + 0.014, t * 0.55, [pn.x, pn.y, -t * 0.08], null, { c: Math.min(0.014, t * 0.26, pw * 0.2) });
    }
    py += ph;
  }
  return panels;
}

function can(b, mat, R, h, pos, seg = 10) {
  b.cyl(mat, R, R, h - 0.008, seg, [pos[0], pos[1] + h / 2, pos[2]]);
  b.cyl(mat, R + 0.0022, R + 0.0022, 0.005, seg, [pos[0], pos[1] + 0.0025, pos[2]], null, { open: true });
  b.cyl(mat, R + 0.0022, R + 0.0022, 0.005, seg, [pos[0], pos[1] + h - 0.0025, pos[2]], null, { open: true });
}

/** Fill a shelf strip with jars / cans / bottles / boxes. mats: {metal, glass, box?, contents?} */
function clutter(b, x0, x1, y, z0, z1, maxH, mats, density = 1) {
  const r = b.r;
  let x = x0 + r.range(0, 0.05);
  let guard = 0;
  while (x < x1 - 0.04 && guard++ < 60) {
    const k = r.next();
    const zc = lerp(z0, z1, r.range(0.3, 0.7));
    if (k < 0.1 + (1 - density) * 0.5) {
      x += r.range(0.05, 0.18);
      continue;
    }
    if (k < 0.34) {
      const R = r.range(0.034, 0.048), h = Math.min(maxH - 0.03, r.range(0.1, 0.17));
      if (x + 2 * R > x1 || h < 0.06) {
        x += 0.05;
        continue;
      }
      const cx = x + R;
      b.lathe(mats.glass, jarProfile(R, h), 8, [cx, y, zc]);
      b.cyl(mats.metal, R * 0.9, R * 0.9, 0.016, 8, [cx, y + h + 0.006, zc]);
      if (mats.contents) {
        const ch = h * r.range(0.3, 0.75);
        b.cyl(mats.contents, R * 0.82, R * 0.82, ch, 7, [cx, y + 0.004 + ch / 2, zc], null, { open: true });
      }
      x = cx + R + r.range(0.01, 0.04);
    } else if (k < 0.58) {
      const R = r.range(0.033, 0.042), h = r.range(0.095, 0.12);
      if (x + 2 * R > x1 || h > maxH) {
        x += 0.05;
        continue;
      }
      const cx = x + R;
      if (r.chance(0.12)) {
        // tipped can
        b.grp([cx, y + R + 0.002, zc], [0, r.range(0, PI), HP], () => can(b, mats.metal, R, h, [0, -h / 2, 0], 10));
      } else {
        const stack = maxH > 2 * h + 0.03 && r.chance(0.35) ? 2 : 1;
        for (let s = 0; s < stack; s++) can(b, mats.metal, R, h, [cx + r.jit(0.004), y + s * (h + 0.001), zc + r.jit(0.01)], 10);
      }
      x = cx + R + r.range(0.004, 0.03);
    } else if (k < 0.72 && maxH > 0.32) {
      const kind = r.pick(['wine', 'beer', 'jug', 'flask']);
      const R = kind === 'jug' ? 0.064 : 0.037;
      if (x + 2 * R > x1) {
        x += 0.05;
        continue;
      }
      b.lathe(mats.glass, bottleProfile(kind), 8, [x + R, y, zc]);
      x += 2 * R + r.range(0.005, 0.03);
    } else if (k < 0.82 && maxH > 0.24) {
      const R = 0.084, h = 0.19;
      if (x + 2 * R > x1) {
        x += 0.05;
        continue;
      }
      const cx = x + R;
      can(b, mats.metal, R, h, [cx, y, zc], 14);
      const hp = [];
      const tilt = r.range(0.2, 1.2);
      for (let i = 0; i <= 8; i++) {
        const a = (i / 8) * PI;
        hp.push([cx + Math.cos(a) * R, y + h - 0.02 + Math.sin(a) * 0.08 * Math.cos(tilt), zc + Math.sin(a) * 0.08 * Math.sin(tilt)]);
      }
      b.tube(mats.metal, hp, 0.0022, 3, { capEnd: false });
      x = cx + R + r.range(0.01, 0.03);
    } else if (mats.box) {
      const w = r.range(0.14, 0.32), h = Math.min(maxH - 0.03, r.range(0.1, 0.3)), d = Math.min(z1 - z0 - 0.01, r.range(0.18, 0.32));
      if (x + w > x1 || h < 0.06) {
        x += 0.05;
        continue;
      }
      b.box(mats.box, w, h, d, [x + w / 2, y + h / 2, (z0 + z1) / 2 + r.jit(0.02)], [0, r.jit(0.08), 0], { c: 0.004 });
      x += w + r.range(0.01, 0.04);
    } else x += 0.05;
  }
}

// ---------------------------------------------------------------- table
BUILDERS.table = (b) => {
  const r = b.r;
  const W = 1.6, D = 0.9, H = 0.78, T = 0.036;
  const legM = paintTint(r);
  const topM = 'woodFloor';
  const n = 4, pw = D / n;
  for (let i = 0; i < n; i++) {
    const z = -D / 2 + pw * (i + 0.5);
    b.box(topM, W - r.range(0, 0.025), T, pw - 0.005, [r.jit(0.008), H - T / 2 + r.jit(0.0015), z], [r.jit(0.004), r.jit(0.004), r.jit(0.004)], { c: 0.005 });
  }
  for (const x of [-0.6, 0.6]) b.box(topM, 0.06, 0.022, D - 0.12, [x, H - T - 0.011, 0], null, { c: 0.004 });
  const legS = 0.068, inset = 0.05;
  const lx = W / 2 - inset - legS / 2, lz = D / 2 - inset - legS / 2;
  const apH = 0.1, apT = 0.022, legTop = H - T, apY = legTop - apH / 2;
  for (const s of [-1, 1]) {
    b.box(legM, 2 * lx, apH, apT, [0, apY, s * (lz + legS / 2 - apT / 2 - 0.006)], null, { c: 0.004 });
    b.box(legM, apT, apH, 2 * lz, [s * (lx + legS / 2 - apT / 2 - 0.006), apY, 0], null, { c: 0.004 });
  }
  const blockH = apH + 0.03;
  const prof = turnedProfile(legTop - blockH, legS * 0.5);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.box(legM, legS, blockH, legS, [sx * lx, legTop - blockH / 2, sz * lz], null, { c: 0.006 });
      b.lathe(legM, prof, 10, [sx * lx, 0, sz * lz]);
    }
  const sy = 0.15;
  for (const sx of [-1, 1]) b.cyl(legM, 0.014, 0.014, 2 * lz, 8, [sx * lx, sy, 0], [HP, 0, 0]);
  b.cyl(legM, 0.016, 0.016, 2 * lx, 8, [0, sy + 0.035, 0], [0, 0, HP]);
  for (let i = 0; i < n; i++) for (const x of [-0.6, 0.6]) nailY(b, x + r.jit(0.012), H - 0.001, -D / 2 + pw * (i + 0.5) + r.jit(0.03));
  b.col([-W / 2, 0, -D / 2], [W / 2, H, D / 2]);
};

// ---------------------------------------------------------------- chair (opts.broken)
BUILDERS.chair = (b, o) => {
  const r = b.r, broken = !!o.broken;
  const m = paintTint(r);
  const seatY = 0.45, sw = 0.44, sd = 0.42, st = 0.03;
  b.col([-0.24, 0, -0.24], [0.24, seatY + 0.02, 0.24]);
  b.col([-0.24, seatY + 0.02, -0.32], [0.24, 0.97, -0.14]);
  if (broken) {
    b.push(null, [0.075, 0, 0.065]);
    b.alignGround = true;
  }
  for (let i = 0; i < 2; i++)
    b.box(m, sw - r.range(0, 0.01), st, sd / 2 - 0.004, [r.jit(0.004), seatY - st / 2, -sd / 4 + (i * sd) / 2], [r.jit(0.008), 0, r.jit(0.008)], { c: 0.006 });
  const fx = sw / 2 - 0.035, fz = sd / 2 - 0.035, bz = -sd / 2 + 0.03;
  const legProf = turnedProfile(seatY - st, 0.021);
  for (const s of [-1, 1]) b.box(m, 0.018, 0.055, fz - bz, [s * fx, seatY - st - 0.0275, (fz + bz) / 2], null, { c: 0.003 });
  b.box(m, 2 * fx, 0.055, 0.018, [0, seatY - st - 0.0275, fz], null, { c: 0.003 });
  for (const sx of [-1, 1]) {
    if (broken && sx < 0) {
      b.cyl(m, 0.017, 0.02, 0.11, 7, [sx * fx, seatY - st - 0.055, fz], [r.jit(0.15), 0, r.jit(0.15)]);
      b.cyl(m, 0.001, 0.008, 0.07, 4, [sx * fx + 0.006, seatY - st - 0.13, fz + 0.004], [0.25, 0, -0.12]);
    } else b.lathe(m, legProf, 8, [sx * fx, 0, fz]);
  }
  for (const sx of [-1, 1])
    b.tube(
      m,
      smoothPts([[sx * fx, 0, bz + 0.012], [sx * fx, seatY - 0.02, bz], [sx * (fx - 0.006), 0.72, bz - 0.035], [sx * (fx - 0.012), 0.96, bz - 0.075]], 8),
      (i, n) => lerp(0.019, 0.015, i / (n - 1)),
      7,
      { capStart: true }
    );
  const topY = 0.9, topZ = bz - 0.07;
  const bow = (x) => 0.035 * (1 - (x / (fx + 0.015)) ** 2);
  if (broken) {
    const len = fx + 0.03;
    plank(b, m, len, 0.065, 0.022, [-fx - 0.012 + len / 2, topY, topZ - bow(-fx / 2) * 0.6], [0, 0.08, 0], { breakR: true });
  } else {
    b.add(m, new THREE.BoxGeometry(2 * fx + 0.03, 0.065, 0.022, 8, 1, 1), [0, topY, topZ], null, {
      weld: false,
      deform: (v) => {
        v.z -= bow(v.x);
      },
    });
  }
  for (let k = 0; k < 5; k++) {
    const x = lerp(-fx * 0.72, fx * 0.72, k / 4);
    if (broken && (k === 1 || k === 3)) continue;
    const yTop = broken && k === 4 ? 0.64 : topY - 0.03;
    const t = (yTop - seatY) / (topY - 0.03 - seatY);
    b.tube(m, [[x, seatY - 0.005, bz + 0.004], [x, yTop, lerp(bz + 0.004, topZ + 0.006 - bow(x), t)]], [0.0095, 0.0075], 5);
  }
  b.cyl(m, 0.011, 0.011, 2 * fx, 7, [0, 0.15, fz], [0, 0, HP]);
  b.cyl(m, 0.011, 0.011, 2 * fx, 7, [0, 0.2, bz + 0.004], [0, 0, HP]);
  for (const sx of [-1, 1]) {
    if (broken && sx < 0) continue;
    b.cyl(m, 0.011, 0.011, fz - bz, 7, [sx * fx, 0.21, (fz + bz) / 2], [HP, 0, 0]);
  }
};

// ---------------------------------------------------------------- shelfUnit (metal angle shelving, cluttered)
BUILDERS.shelfUnit = (b) => {
  const r = b.r;
  const W = 1.0, D = 0.4, H = 2.0;
  const metal = 'rustyMetal', wood = 'crateWood';
  const fl = 0.035, th = 0.003;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.box(metal, fl, H, th, [sx * (W / 2 - fl / 2), H / 2, sz * (D / 2 - th / 2)], null, { c: 0 });
      b.box(metal, th, H, fl, [sx * (W / 2 - th / 2), H / 2, sz * (D / 2 - fl / 2)], null, { c: 0 });
      b.box(metal, 0.05, 0.004, 0.05, [sx * (W / 2 - 0.025), 0.002, sz * (D / 2 - 0.025)], null, { c: 0 });
    }
  const levels = [0.09, 0.5, 0.91, 1.32, 1.73, 1.98];
  const mats = { metal, glass: 'glass', box: 'cardboard', contents: 'cardboard' };
  for (let li = 0; li < levels.length; li++) {
    const y = levels[li];
    for (const sz of [-1, 1]) {
      b.box(metal, W + 0.004, 0.032, th, [0, y - 0.016, sz * (D / 2 + th / 2)], null, { c: 0 });
      for (const sx of [-1, 1]) b.cyl(metal, 0.006, 0.006, 0.005, 6, [sx * (W / 2 - 0.015), y - 0.016, sz * (D / 2 + 0.004)], [HP, 0, 0], { open: true });
    }
    for (const sx of [-1, 1]) b.box(metal, th, 0.032, D, [sx * (W / 2 + th / 2), y - 0.016, 0], null, { c: 0 });
    for (let k = 0; k < 3; k++)
      b.box(wood, W - 0.01, 0.018, D / 3 - 0.006, [r.jit(0.004), y - 0.009 + r.jit(0.002), -D / 2 + (k + 0.5) * (D / 3)], [0, r.jit(0.012), r.jit(0.004)], { c: 0.003 });
    if (li < levels.length - 1) {
      if (r.chance(0.93)) clutter(b, -W / 2 + 0.02, W / 2 - 0.02, y, -D / 2 + 0.03, D / 2 - 0.03, levels[li + 1] - y - 0.04, mats, li === 0 ? 0.6 : 1);
    } else clutter(b, -W / 2 + 0.05, W / 2 - 0.05, y, -D / 2 + 0.03, D / 2 - 0.03, 0.34, { metal, glass: 'glass', box: 'cardboard' }, 0.5);
  }
  for (const [y0, y1] of [
    [0.09, 0.91],
    [0.91, 1.73],
  ]) {
    const len = Math.hypot(W - 0.06, y1 - y0), ang = Math.atan2(y1 - y0, W - 0.06);
    for (const s of [-1, 1]) b.box(metal, len, 0.022, 0.002, [0, (y0 + y1) / 2, -D / 2 - 0.005 - (s > 0 ? 0.002 : 0)], [0, 0, s * ang], { c: 0 });
  }
  b.col([-W / 2, 0, -D / 2], [W / 2, H, D / 2]);
};

// ---------------------------------------------------------------- wallShelfToolbox (origin on the wall, shelf top at y = opts.height ?? 0)
BUILDERS.wallShelfToolbox = (b, o) => {
  const r = b.r;
  const y0 = o.height ?? 0;
  const L = 0.95, D = 0.26, T = 0.028;
  b.box('crateWood', L, T, D, [0, y0 - T / 2, D / 2 + 0.004], [0, 0, r.jit(0.008)], { c: 0.004 });
  for (const bx of [-0.32, 0.32]) {
    const x = bx + r.jit(0.01);
    const bh = 0.22, bd = 0.2, yb = y0 - T;
    b.box('rustyMetal', 0.032, bh, 0.005, [x, yb - bh / 2, 0.0025], null, { c: 0 });
    b.box('rustyMetal', 0.032, 0.005, bd, [x, yb - 0.0025, bd / 2], null, { c: 0 });
    const dy = bh - 0.035, dz = bd - 0.035;
    b.box('rustyMetal', 0.018, 0.005, Math.hypot(dy, dz), [x, yb - 0.02 - dy / 2, 0.02 + dz / 2 - 0.004], [-Math.atan2(dy, dz), 0, 0], { c: 0 });
    for (const yy of [yb - 0.05, yb - bh + 0.03]) b.cyl('rustyMetal', 0.0065, 0.0065, 0.004, 6, [x, yy, 0.007], [HP, 0, 0]);
    b.cyl('rustyMetal', 0.0065, 0.0065, 0.004, 6, [x, yb - 0.007, bd - 0.04]);
  }
  // red toolbox
  const tw = 0.5, th = 0.19, td = 0.2;
  b.grp([-0.14 + r.jit(0.06), y0, 0.13], [0, r.jit(0.12), 0], () => {
    b.box('paintRed', tw, th, td, [0, th / 2, 0], null, { c: 0.01 });
    b.box('paintRed', tw + 0.006, 0.05, td + 0.006, [0, th + 0.027, 0], null, { c: 0.012 });
    b.box('paintRed', tw - 0.05, 0.012, td - 0.06, [0, th + 0.055, 0], null, { c: 0.005 });
    b.box('metalDark', tw + 0.009, 0.007, td + 0.009, [0, th + 0.002, 0], null, { c: 0.002 });
    for (const s of [-1, 1]) {
      b.box('metalDark', 0.03, 0.012, 0.03, [s * 0.1, th + 0.066, 0], null, { c: 0.003 });
      b.cyl('metalDark', 0.0055, 0.0055, 0.035, 6, [s * 0.1, th + 0.085, 0]);
      b.box('metalDark', 0.03, 0.045, 0.006, [s * 0.17, th + 0.004, td / 2 + 0.004], null, { c: 0.002 });
      b.box('metalDark', 0.016, 0.02, 0.006, [s * 0.17, th + 0.036, td / 2 + 0.006], null, { c: 0.002 });
      b.box('metalDark', 0.006, 0.05, 0.06, [s * (tw / 2 + 0.004), th * 0.72, 0], null, { c: 0.002 });
    }
    b.cyl('metalDark', 0.011, 0.011, 0.23, 8, [0, th + 0.103, 0], [0, 0, HP]);
    b.cyl('metalDark', 0.005, 0.005, tw - 0.06, 6, [0, th + 0.004, -td / 2 - 0.004], [0, 0, HP]);
    // rust streak dents
    b.box('paintRed', 0.12, 0.004, 0.004, [0.1, th * 0.4, td / 2 + 0.001], [0, 0, 0.1], { c: 0 });
  });
  // oil can + coffee can with brushes
  const ox = 0.3 + r.jit(0.04);
  b.lathe('rustyMetal', [[0, 0], [0.05, 0], [0.052, 0.008], [0.052, 0.08], [0.04, 0.1], [0.012, 0.115], [0, 0.118]], 10, [ox, y0, 0.12]);
  b.tube('rustyMetal', [[ox, y0 + 0.11, 0.12], [ox + 0.03, y0 + 0.16, 0.13], [ox + 0.07, y0 + 0.21, 0.14]], [0.006, 0.004, 0.0025], 5);
  const cx = 0.42 + r.jit(0.02);
  can(b, 'rustyMetal', 0.045, 0.13, [cx, y0, 0.19], 10);
  for (let i = 0; i < 3; i++) {
    const a = r.range(0, TAU);
    b.cyl('crateWood', 0.006, 0.008, 0.2, 5, [cx + Math.cos(a) * 0.02, y0 + 0.14, 0.19 + Math.sin(a) * 0.02], [r.jit(0.25), 0, r.jit(0.25)]);
  }
};

// ---------------------------------------------------------------- cabinet (farmhouse kitchen hutch)
BUILDERS.cabinet = (b) => {
  const r = b.r;
  const m = paintTint(r), dark = 'woodBeam', hw = 'metalDark';
  const W = 1.0, D = 0.45, H1 = 0.9, Hup0 = 1.22, H = 1.95, upD = 0.3, t = 0.02, gap = 0.005;
  const zf = D / 2;
  for (const s of [-1, 1]) b.box(m, t, H1, D, [s * (W / 2 - t / 2), H1 / 2, 0], null, { c: 0.004 });
  b.box(m, W - 2 * t, 0.08, 0.018, [0, 0.04, zf - 0.05]);
  b.box(m, W - 2 * t, 0.018, D - 0.02, [0, 0.089, 0]);
  b.box(dark, W - 2 * t, 0.012, D - 0.04, [0, 0.42, -0.01]);
  b.box(dark, W - 2 * t, H - 0.1, 0.01, [0, 0.08 + (H - 0.1) / 2, -D / 2 + 0.005]);
  b.box(m, W - 2 * t, 0.018, D - 0.03, [0, 0.725, -0.01]);
  b.box(m, 0.02, 0.62, D - 0.03, [0, 0.41, -0.01]);
  b.box(dark, W + 0.04, 0.032, D + 0.035, [0, H1 + 0.016, 0.012], null, { c: 0.006 });
  const fz = zf + 0.011;
  const dw = (W - 3 * gap) / 2;
  for (const s of [-1, 1]) {
    const cx = s * (gap / 2 + dw / 2);
    const out = r.chance(0.2) ? r.range(0.02, 0.12) : 0;
    b.box(m, dw, 0.14, 0.022, [cx, 0.81, fz + out], [0, 0, r.jit(0.006)], { c: 0.005 });
    b.box(hw, 0.09, 0.012, 0.012, [cx, 0.815, fz + out + 0.026], null, { c: 0.003 });
    for (const q of [-1, 1]) b.box(hw, 0.01, 0.01, 0.016, [cx + q * 0.04, 0.815, fz + out + 0.017], null, { c: 0 });
    if (out > 0) {
      // drawer box pulled out
      b.box(m, dw - 0.04, 0.1, 0.012, [cx, 0.8, fz - 0.3 + out], null, { c: 0 });
      for (const q of [-1, 1]) b.box(m, 0.012, 0.1, 0.3, [cx + q * (dw / 2 - 0.026), 0.8, fz - 0.16 + out], null, { c: 0 });
      b.box(m, dw - 0.05, 0.008, 0.3, [cx, 0.754, fz - 0.16 + out], null, { c: 0 });
    }
  }
  const doorH = 0.6, doorY = 0.1;
  const openIdx = r.chance(0.55) ? r.int(0, 1) : -1;
  const openA = r.range(0.35, 1.3);
  for (const s of [-1, 1]) {
    const idx = s < 0 ? 0 : 1;
    const a = idx === openIdx ? openA : r.range(0, 0.03);
    b.grp(
      [s * (W / 2 - gap / 2), doorY, fz],
      [0, s < 0 ? -a : a, 0],
      () => {
        frameDoor(b, m, dw, doorH, 0.022, { stile: 0.06 });
        b.sph(hw, 0.013, [dw - 0.045, doorH - 0.08, 0.03], null, { ws: 8, hs: 6 });
        b.cyl(hw, 0.005, 0.005, 0.02, 6, [dw - 0.045, doorH - 0.08, 0.018], [HP, 0, 0]);
        for (const hy of [0.08, doorH - 0.08]) b.cyl(hw, 0.006, 0.006, 0.06, 6, [0.001, hy, 0.013]);
      },
      s < 0 ? null : [-1, 1, 1]
    );
  }
  // upper section
  const upH = H - Hup0, uz = -D / 2 + upD / 2;
  for (const s of [-1, 1]) b.box(m, t, upH, upD, [s * (W / 2 - t / 2), Hup0 + upH / 2, uz], null, { c: 0.004 });
  b.box(m, W - 2 * t, 0.018, upD - 0.01, [0, Hup0 + 0.009, uz]);
  b.box(m, W - 2 * t, 0.018, upD - 0.01, [0, H - 0.03, uz]);
  const shelfY = Hup0 + upH * 0.5;
  b.box(dark, W - 2 * t, 0.012, upD - 0.03, [0, shelfY, uz - 0.01]);
  b.box(m, W + 0.05, 0.05, upD + 0.04, [0, H, uz + 0.015], null, { c: 0.012 });
  b.box(m, W + 0.02, 0.025, upD + 0.02, [0, H - 0.035, uz + 0.008], null, { c: 0.008 });
  for (const s of [-1, 1]) b.box(m, 0.03, Hup0 - H1 - 0.032, 0.03, [s * (W / 2 - 0.03), (H1 + 0.032 + Hup0) / 2, uz + upD / 2 - 0.025], null, { c: 0.004 });
  const ufz = uz + upD / 2 + 0.011;
  const udh = upH - 0.075;
  for (const s of [-1, 1]) {
    const open = r.chance(0.22) ? r.range(0.2, 0.9) : r.range(0, 0.02);
    b.grp(
      [s * (W / 2 - gap / 2), Hup0 + 0.03, ufz],
      [0, s < 0 ? -open : open, 0],
      () => {
        const panes = frameDoor(b, m, dw, udh, 0.022, { stile: 0.05, rows: 2, glass: true, mid: 0.025 });
        for (const pn of panes) {
          const mode = r.pick(['full', 'full', 'full', 'hole', 'shard', 'none']);
          if (mode !== 'none') b.add('glass', paneGeo(pn.w + 0.008, pn.h + 0.008, r, mode), [pn.x, pn.y, -0.002]);
        }
        b.sph(hw, 0.011, [dw - 0.035, 0.12, 0.026], null, { ws: 8, hs: 6 });
        for (const hy of [0.07, udh - 0.07]) b.cyl(hw, 0.006, 0.006, 0.05, 6, [0.001, hy, 0.013]);
      },
      s < 0 ? null : [-1, 1, 1]
    );
  }
  const cm = { metal: hw, glass: 'glass' };
  clutter(b, -W / 2 + 0.04, W / 2 - 0.04, shelfY + 0.006, uz - upD / 2 + 0.03, uz + upD / 2 - 0.05, upH * 0.5 - 0.08, cm);
  clutter(b, -W / 2 + 0.04, W / 2 - 0.04, Hup0 + 0.018, uz - upD / 2 + 0.03, uz + upD / 2 - 0.05, upH * 0.5 - 0.06, cm, 0.7);
  clutter(b, -W / 2 + 0.06, W / 2 - 0.06, H1 + 0.032, -D / 2 + 0.05, D / 2 - 0.06, Hup0 - H1 - 0.06, cm, 0.35);
  b.col([-W / 2, 0, -D / 2], [W / 2, H1 + 0.035, D / 2 + 0.03]);
  b.col([-W / 2, H1 + 0.035, -D / 2], [W / 2, H + 0.03, uz + upD / 2 + 0.03]);
};

// ---------------------------------------------------------------- dresser (one drawer pulled out)
BUILDERS.dresser = (b) => {
  const r = b.r;
  const W = 1.1, D = 0.5, H = 0.95, feetH = 0.09;
  const wood = 'woodBeam', hw = 'brass';
  const t = 0.022;
  const cy0 = feetH, cy1 = H - 0.03;
  for (const s of [-1, 1]) b.box(wood, t, cy1 - cy0, D, [s * (W / 2 - t / 2), (cy0 + cy1) / 2, 0], null, { c: 0.004 });
  b.box(wood, W + 0.04, 0.03, D + 0.03, [0, H - 0.015, 0.01], null, { c: 0.008 });
  b.box(wood, W + 0.02, 0.012, D + 0.02, [0, H - 0.036, 0.008], null, { c: 0.004 });
  b.box(wood, W - 2 * t, cy1 - cy0, 0.01, [0, (cy0 + cy1) / 2, -D / 2 + 0.005]);
  b.box(wood, W + 0.012, 0.055, D + 0.012, [0, cy0 + 0.0275, 0.004], null, { c: 0.008 });
  const foot = [[0, 0], [0.028, 0], [0.034, 0.02], [0.036, 0.045], [0.03, 0.07], [0.034, feetH], [0, feetH]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lathe(wood, foot, 8, [sx * (W / 2 - 0.05), 0, sz * (D / 2 - 0.05)]);
  const yBase = cy0 + 0.055, yTop = cy1;
  const dv = 0.016;
  const rowsH = [0.19, 0.19, 0.19];
  const topRowH = yTop - yBase - rowsH.reduce((a, c) => a + c, 0) - 4 * dv;
  const rows = [...rowsH, topRowH];
  const pulled = r.int(0, 3);
  const pullDist = r.range(0.16, 0.3);
  let y = yBase;
  for (let ri = 0; ri < rows.length; ri++) {
    const rh = rows[ri];
    b.box(wood, W - 2 * t, dv, D - 0.02, [0, y + dv / 2, -0.005], null, { c: 0.002 });
    y += dv;
    const cells = ri === rows.length - 1 ? [-1, 1] : [0];
    if (cells.length === 2) b.box(wood, dv, rh, D - 0.02, [0, y + rh / 2, -0.005], null, { c: 0 });
    for (const cc of cells) {
      const cw = cc === 0 ? W - 2 * t - 0.006 : (W - 2 * t - dv) / 2 - 0.006;
      const cx = cc === 0 ? 0 : cc * ((W - 2 * t - dv) / 4 + dv / 4);
      const isPulled = ri === pulled && cc >= 0;
      const dz = isPulled ? pullDist : r.range(0, 0.006);
      b.grp([cx, y + rh / 2, D / 2 - 0.011 + dz], [0, 0, r.jit(0.006)], () => {
        b.box(wood, cw, rh - 0.006, 0.022, [0, 0, 0], null, { c: 0.005 });
        b.box(wood, cw - 0.03, rh - 0.03, 0.006, [0, 0, 0.012], null, { c: 0.003 });
        if (isPulled) {
          const dd = D - 0.06;
          for (const q of [-1, 1]) b.box(wood, 0.012, rh - 0.03, dd, [q * (cw / 2 - 0.02), -0.004, -dd / 2], null, { c: 0 });
          b.box(wood, cw - 0.03, 0.008, dd, [0, -rh / 2 + 0.018, -dd / 2], null, { c: 0 });
          b.box(wood, cw - 0.04, rh - 0.04, 0.012, [0, -0.008, -dd + 0.006], null, { c: 0 });
        }
        const handles = cc === 0 ? [-cw * 0.28, cw * 0.28] : [0];
        for (const hx of handles) {
          if (r.chance(0.08)) continue;
          if (cc === 0) {
            b.box(hw, 0.06, 0.032, 0.003, [hx, 0.012, 0.0125], null, { c: 0 });
            for (const q of [-1, 1]) b.cyl(hw, 0.004, 0.004, 0.012, 5, [hx + q * 0.022, 0.012, 0.018], [HP, 0, 0]);
            b.add(hw, new THREE.TorusGeometry(0.022, 0.0028, 4, 8, PI), [hx, 0.012, 0.024], [r.range(-0.3, 0.1), 0, PI]);
          } else {
            b.cyl(hw, 0.006, 0.008, 0.016, 6, [hx, 0, 0.02], [HP, 0, 0]);
            b.sph(hw, 0.013, [hx, 0, 0.032], null, { ws: 8, hs: 6, scl: [1, 1, 0.7] });
          }
        }
      });
    }
    y += rh;
  }
  b.col([-W / 2, 0, -D / 2], [W / 2, H, D / 2]);
  b.col([-W / 2 + 0.03, 0.1, D / 2], [W / 2 - 0.03, 0.8, D / 2 + pullDist + 0.02]);
};

// ---------------------------------------------------------------- bed (iron frame, stained mattress; variant 1 = trashed)
BUILDERS.bed = (b, o) => {
  const r = b.r;
  const trashed = (o.variant | 0) === 1;
  const W = 1.0, L = 2.0, hz = -L / 2, fz = L / 2;
  const iron = 'rustyMetal';
  const mattM = M('fabric', { color: 0x9c9078 });
  const blanketM = M('cloth', { color: r.pick([0x4a4b3c, 0x3f3a36, 0x4c4338]) });
  const pr = 0.018;
  const post = (x, z, h) => {
    b.cyl(iron, pr, pr, h, 8, [x, h / 2, z]);
    b.sph(iron, 0.028, [x, h + 0.02, z], null, { ws: 8, hs: 6 });
    b.cyl(iron, 0.024, 0.024, 0.025, 8, [x, h - 0.012, z]);
    b.cyl(iron, 0.024, 0.02, 0.03, 8, [x, 0.015, z]);
  };
  const spindles = (z, y0, yTopFn, n) => {
    for (let i = 1; i <= n; i++) {
      const x = lerp(-W / 2, W / 2, i / (n + 1));
      const yt = yTopFn(x);
      b.cyl(iron, 0.0075, 0.0075, yt - y0, 6, [x, (y0 + yt) / 2, z]);
      b.cyl(iron, 0.012, 0.012, 0.018, 6, [x, y0 + (yt - y0) * 0.5, z]);
    }
  };
  // head
  post(-W / 2, hz, 1.1);
  post(W / 2, hz, 1.1);
  const headTop = (x) => 1.0 + 0.07 * (1 - (x / (W / 2)) ** 2);
  const hp = [];
  for (let i = 0; i <= 10; i++) {
    const x = lerp(-W / 2, W / 2, i / 10);
    hp.push([x, headTop(x), hz]);
  }
  b.tube(iron, hp, 0.013, 6);
  b.cyl(iron, 0.012, 0.012, W, 6, [0, 0.42, hz], [0, 0, HP]);
  spindles(hz, 0.42, headTop, 7);
  // foot
  post(-W / 2, fz, 0.84);
  post(W / 2, fz, 0.84);
  b.cyl(iron, 0.013, 0.013, W, 6, [0, 0.78, fz], [0, 0, HP]);
  b.cyl(iron, 0.012, 0.012, W, 6, [0, 0.4, fz], [0, 0, HP]);
  spindles(fz, 0.4, () => 0.78, 5);
  // side rails (angle iron) + springs
  for (const s of [-1, 1]) {
    b.box(iron, 0.035, 0.004, L, [s * (W / 2 - 0.0175), 0.36, 0], null, { c: 0 });
    b.box(iron, 0.004, 0.035, L, [s * (W / 2 - 0.002), 0.342, 0], null, { c: 0 });
  }
  for (let i = 0; i < 11; i++) {
    const z = lerp(hz + 0.1, fz - 0.1, i / 10);
    b.box(iron, W - 0.04, 0.004, 0.03, [0, 0.362 - 0.012 * Math.sin((i / 10) * PI), z], null, { c: 0 });
  }
  // mattress
  const mw = W - 0.07, ml = L - 0.08, mh = 0.14;
  const mTop = 0.37 + mh;
  const mOff = trashed ? [0.1, 0, 0.08] : [0, 0, 0];
  const mRot = trashed ? [0, 0.1, 0.035] : [0, r.jit(0.02), 0];
  const seedN = r.range(0, 50);
  b.soft(mattM, mw, mh, ml, 0.045, [6, 3, 12], [mOff[0], 0.37 + mh / 2 + 0.005, mOff[2]], mRot, {
    deform: (v) => {
      const sag = 0.035 * (1 - (2 * v.z / ml) ** 2) * (1 - 0.6 * (2 * v.x / mw) ** 2);
      const top = (v.y + mh / 2) / mh;
      v.y -= sag * (0.35 + 0.65 * top);
      v.y += 0.012 * fbm(v.x * 5 + seedN, 0, v.z * 5) * top;
      if (trashed && v.y > 0 && Math.hypot(v.x - 0.1, v.z - 0.2) < 0.18) v.y -= 0.04 * (1 - Math.hypot(v.x - 0.1, v.z - 0.2) / 0.18);
    },
  });
  if (trashed) {
    for (let i = 0; i < 4; i++)
      b.add(mattM, new THREE.IcosahedronGeometry(r.range(0.04, 0.07), 1), [0.18 + r.jit(0.12), mTop - 0.01, 0.28 + r.jit(0.12)], [r.next(), r.next(), 0], {
        scl: [1, 0.55, 1],
        deform: (v) => v.multiplyScalar(1 + 0.25 * vnoise(v.x * 40, v.y * 40, v.z * 40 + i)),
      });
  } else {
    b.soft(mattM, 0.56, 0.12, 0.34, 0.05, [6, 3, 4], [r.jit(0.06), mTop + 0.035, hz + 0.26], [r.jit(0.08), r.jit(0.15), r.jit(0.06)], {
      deform: (v) => {
        v.y *= 0.8 - 0.35 * Math.abs(v.x / 0.28) ** 2;
        v.y += 0.01 * vnoise(v.x * 12, v.y * 12, v.z * 12 + seedN);
      },
    });
  }
  if (!trashed) {
    // folded blanket on the foot end
    b.soft(blanketM, 0.84, 0.06, 0.42, 0.025, [8, 2, 4], [r.jit(0.04), mTop + 0.025, fz - 0.32], [0, r.jit(0.12), 0], {
      deform: (v) => {
        v.y += 0.012 * fbm(v.x * 8, 3, v.z * 8 + seedN);
      },
    });
  } else {
    // blanket half dragged off the side, hanging down and pooling on the floor
    const e0 = W / 2 - 0.02;
    const cx = 0.22, cz = 0.2;
    b.add(blanketM, new THREE.BoxGeometry(1.5, 0.012, 1.1, 22, 1, 12), null, null, {
      deform: (v) => {
        const X = v.x + cx, Z = v.z + cz;
        const wr = 0.014 * fbm(X * 6 + seedN, 0, Z * 6);
        const [px, py, nx, ny] = drapePath(X - e0, mTop + 0.03, e0, 0.008, 0.06);
        const off = v.y + wr + 0.008;
        v.set(px + nx * off + 0.02 * vnoise(Z * 5, py * 4, seedN) * nx, py + ny * off, Z);
      },
    });
  }
  b.col([-W / 2 - 0.02, 0, hz - 0.03], [W / 2 + 0.02, mTop + 0.03, fz + 0.03]);
  b.col([-W / 2 - 0.02, mTop + 0.03, hz - 0.03], [W / 2 + 0.02, 1.13, hz + 0.03]);
};

// ---------------------------------------------------------------- bathtub (clawfoot, grimy)
BUILDERS.bathtub = (b) => {
  const r = b.r;
  const por = 'porcelain', iron = 'rustyMetal';
  const k = 5;
  const spec = [
    [1.22, 0.46, 0.2, 0.15],
    [1.36, 0.58, 0.26, 0.2],
    [1.48, 0.67, 0.3, 0.32],
    [1.56, 0.73, 0.33, 0.48],
    [1.6, 0.76, 0.35, 0.58],
    [1.63, 0.79, 0.37, 0.606],
    [1.62, 0.78, 0.37, 0.632],
    [1.58, 0.74, 0.35, 0.64],
    [1.54, 0.7, 0.33, 0.628],
    [1.52, 0.68, 0.32, 0.6],
    [1.46, 0.62, 0.3, 0.45],
    [1.38, 0.55, 0.26, 0.3],
    [1.26, 0.45, 0.2, 0.225],
    [1.16, 0.38, 0.17, 0.205],
  ];
  b.add(por, loftGeo(spec.map(([w, d, rr, y]) => rrRing(w, d, rr, y, k)), -1, 1), null, null, { weld: false });
  // claw feet
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 0.5, z = sz * 0.16;
      const fx = x * 1.1, fzz = z * 1.4;
      b.tube(iron, smoothPts([[x, 0.2, z], [x * 1.05, 0.14, z * 1.2], [fx, 0.07, fzz]], 6), [0.038, 0.034, 0.03, 0.026, 0.028, 0.03, 0.03], 7, { capStart: true });
      b.sph(iron, 0.034, [fx, 0.034, fzz], null, { ws: 8, hs: 6 });
      for (let c = 0; c < 3; c++) {
        const a = Math.atan2(fzz, fx) + (c - 1) * 0.7;
        b.cyl(iron, 0.004, 0.011, 0.05, 5, [fx + Math.cos(a) * 0.028, 0.028, fzz + Math.sin(a) * 0.028], [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9]);
      }
    }
  // faucet at the -X end
  const fx0 = -0.86;
  for (const s of [-1, 1]) {
    b.cyl(iron, 0.012, 0.012, 0.7, 8, [fx0, 0.35, s * 0.07]);
    b.cyl(iron, 0.018, 0.018, 0.04, 8, [fx0, 0.72, s * 0.07]);
    b.box(iron, 0.07, 0.01, 0.01, [fx0, 0.75, s * 0.07], [0, 0.6, 0], { c: 0 });
    b.box(iron, 0.07, 0.01, 0.01, [fx0, 0.75, s * 0.07], [0, -0.97, 0], { c: 0 });
    b.cyl(iron, 0.02, 0.02, 0.008, 8, [fx0, 0.004, s * 0.07]);
  }
  b.cyl(iron, 0.013, 0.013, 0.14, 8, [fx0, 0.7, 0], [HP, 0, 0]);
  b.tube(iron, smoothPts([[fx0, 0.7, 0], [fx0 + 0.02, 0.8, 0], [fx0 + 0.12, 0.82, 0], [fx0 + 0.17, 0.74, 0]], 10), 0.012, 7);
  // drain + chain
  b.cyl(iron, 0.024, 0.024, 0.004, 10, [-0.45, 0.207, 0]);
  const ch = smoothPts([[-0.45, 0.21, 0.02], [-0.55, 0.22, 0.06], [-0.66, 0.35, 0.1], [-0.72, 0.56, 0.09], [-0.745, 0.64, 0.05]], 10);
  b.tube(iron, ch, 0.0025, 3);
  b.col([-0.82, 0, -0.4], [0.82, 0.64, 0.4]);
};

// ---------------------------------------------------------------- toilet
BUILDERS.toilet = (b) => {
  const r = b.r;
  const por = 'porcelain', seatM = 'woodBeam', iron = 'rustyMetal';
  const water = M('glass', { color: 0x4a4028 });
  const ring = (w, d, rr, y, cz) => rrRing(w, d, rr, y, 4, 0, cz);
  b.add(
    por,
    loftGeo(
      [
        ring(0.25, 0.37, 0.11, 0.0, 0.02),
        ring(0.24, 0.35, 0.1, 0.03, 0.02),
        ring(0.2, 0.3, 0.09, 0.14, 0.03),
        ring(0.22, 0.32, 0.1, 0.24, 0.05),
        ring(0.32, 0.42, 0.15, 0.33, 0.08),
        ring(0.36, 0.47, 0.17, 0.39, 0.09),
        ring(0.365, 0.48, 0.175, 0.41, 0.09),
        ring(0.34, 0.45, 0.165, 0.418, 0.09),
        ring(0.3, 0.4, 0.14, 0.4, 0.095),
        ring(0.22, 0.3, 0.1, 0.32, 0.1),
        ring(0.12, 0.16, 0.05, 0.24, 0.07),
      ],
      -1,
      1
    ),
    null,
    null,
    { weld: false }
  );
  b.add(water, new THREE.CircleGeometry(1, 16), [0, 0.3, 0.095], [-HP, 0, 0], { scl: [0.125, 0.165, 1] });
  // bolt caps
  for (const s of [-1, 1]) b.sph(por, 0.016, [s * 0.1, 0.021, 0.12], null, { ws: 8, hs: 5, scl: [1, 1.3, 1] });
  // tank
  b.box(por, 0.44, 0.34, 0.19, [0, 0.6, -0.25], null, { c: 0.02 });
  b.box(por, 0.46, 0.03, 0.21, [0, 0.785, -0.25], [0, r.jit(0.05), 0], { c: 0.01 });
  b.box(por, 0.14, 0.06, 0.12, [0, 0.42, -0.17], null, { c: 0.02 });
  b.box(iron, 0.05, 0.012, 0.01, [-0.16, 0.73, -0.15], [0, 0, 0.3], { c: 0.002 });
  b.cyl(iron, 0.01, 0.01, 0.015, 8, [-0.18, 0.735, -0.152], [HP, 0, 0]);
  b.tube(iron, smoothPts([[-0.15, 0.44, -0.26], [-0.15, 0.3, -0.28], [-0.15, 0.22, -0.34], [-0.15, 0.21, -0.36]], 8), 0.009, 6);
  b.cyl(iron, 0.02, 0.02, 0.03, 8, [-0.15, 0.25, -0.31], [0.6, 0, 0]);
  // seat + lid (sometimes missing)
  const ell = (a, c, n = 20) => {
    const p = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * TAU;
      p.push([Math.cos(t) * a, Math.sin(t) * c]);
    }
    return p;
  };
  if (r.chance(0.75)) {
    b.add(seatM, extrudeGeo(ell(0.18, 0.225), [ell(0.12, 0.15).reverse()], 0.022, 0.005), [0, 0.428, 0.1], [HP, 0, 0]);
    const lidA = r.chance(0.7) ? -1.72 : -0.05;
    b.grp([0, 0.44, -0.125], [lidA, 0, 0], () => {
      b.add(seatM, extrudeGeo(ell(0.185, 0.23), null, 0.018, 0.005), [0, 0.012, 0.225], [HP, 0, 0]);
    });
    for (const s of [-1, 1]) b.cyl(iron, 0.008, 0.008, 0.04, 6, [s * 0.08, 0.44, -0.12], [0, 0, HP]);
  }
  b.col([-0.2, 0, -0.16], [0.2, 0.44, 0.34]);
  b.col([-0.24, 0, -0.36], [0.24, 0.8, -0.14]);
};

// ---------------------------------------------------------------- sink (pedestal)
BUILDERS.sink = (b) => {
  const r = b.r;
  const por = 'porcelain', iron = 'rustyMetal';
  b.lathe(por, [[0, 0], [0.14, 0], [0.142, 0.018], [0.11, 0.06], [0.082, 0.22], [0.075, 0.45], [0.09, 0.6], [0.12, 0.67], [0, 0.67]], 14, [0, 0, -0.1]);
  const ring = (w, d, rr, y) => rrRing(w, d, rr, y, 4, 0, -0.02);
  b.add(
    por,
    loftGeo(
      [ring(0.4, 0.3, 0.12, 0.64), ring(0.52, 0.4, 0.16, 0.74), ring(0.58, 0.45, 0.18, 0.82), ring(0.6, 0.47, 0.19, 0.855), ring(0.595, 0.465, 0.19, 0.872), ring(0.55, 0.42, 0.17, 0.87), ring(0.5, 0.37, 0.15, 0.84), ring(0.42, 0.3, 0.13, 0.78), ring(0.3, 0.2, 0.08, 0.745)],
      -1,
      1
    ),
    null,
    null,
    { weld: false }
  );
  b.box(por, 0.6, 0.09, 0.07, [0, 0.9, -0.225], null, { c: 0.02 });
  for (const s of [-1, 1]) {
    const x = s * 0.14;
    b.cyl(iron, 0.015, 0.018, 0.05, 8, [x, 0.97, -0.215]);
    b.tube(iron, smoothPts([[x, 0.975, -0.21], [x, 0.985, -0.17], [x, 0.965, -0.135]], 6), 0.008, 6);
    b.box(iron, 0.07, 0.01, 0.01, [x, 1.0, -0.215], [0, 0.7 + r.jit(0.3), 0], { c: 0 });
    b.box(iron, 0.07, 0.01, 0.01, [x, 1.0, -0.215], [0, -0.87 + r.jit(0.3), 0], { c: 0 });
    b.sph(iron, 0.01, [x, 1.008, -0.215], null, { ws: 6, hs: 4 });
    b.tube(iron, smoothPts([[s * 0.1, 0.5, -0.25], [s * 0.1, 0.5, -0.2], [s * 0.09, 0.6, -0.17], [s * 0.06, 0.64, -0.12]], 8), 0.007, 5);
    b.cyl(iron, 0.018, 0.018, 0.025, 8, [s * 0.1, 0.5, -0.225], [HP, 0, 0]);
  }
  b.cyl(iron, 0.02, 0.02, 0.004, 10, [0, 0.747, -0.02]);
  b.tube(iron, smoothPts([[0, 0.64, -0.02], [0, 0.56, -0.02], [0.0, 0.5, -0.07], [0, 0.55, -0.14], [0, 0.55, -0.25]], 10), 0.018, 8);
  b.col([-0.3, 0, -0.26], [0.3, 0.9, 0.23]);
};

// ---------------------------------------------------------------- stove (cast iron wood stove + pipe)
BUILDERS.stove = (b, o) => {
  const r = b.r;
  const iron = 'metalDark', pipe = 'rustyMetal', nick = 'chrome';
  const pipeLen = o.pipeLength ?? 2.2;
  b.box(iron, 0.62, 0.5, 0.5, [0, 0.47, 0], null, { c: 0.015 });
  b.box(iron, 0.66, 0.03, 0.54, [0, 0.235, 0], null, { c: 0.008 });
  b.box(iron, 0.7, 0.036, 0.58, [0, 0.738, 0], null, { c: 0.01 });
  b.box(iron, 0.64, 0.02, 0.52, [0, 0.71, 0], null, { c: 0.006 });
  for (const x of [-0.15, 0.15]) {
    b.cyl(iron, 0.095, 0.095, 0.012, 16, [x, 0.762, 0.04]);
    b.add(iron, new THREE.TorusGeometry(0.097, 0.005, 4, 16), [x, 0.757, 0.04], [HP, 0, 0]);
    b.box(iron, 0.045, 0.006, 0.014, [x, 0.77, 0.04], null, { c: 0 });
  }
  for (const s of [-1, 1]) for (const yy of [0.35, 0.47, 0.59]) b.box(iron, 0.014, 0.02, 0.44, [s * 0.316, yy, 0], null, { c: 0.004 });
  // fire door
  b.box(iron, 0.35, 0.27, 0.02, [-0.05, 0.485, 0.26], null, { c: 0.006 });
  b.box(iron, 0.27, 0.19, 0.01, [-0.05, 0.485, 0.272], null, { c: 0.004 });
  for (const yy of [0.4, 0.57]) b.cyl(iron, 0.012, 0.012, 0.045, 8, [-0.235, yy, 0.265]);
  b.cyl(iron, 0.05, 0.05, 0.012, 14, [-0.05, 0.485, 0.281], [HP, 0, 0]);
  for (let i = 0; i < 4; i++) b.box(iron, 0.09, 0.008, 0.006, [-0.05, 0.485, 0.29], [0, 0, (i * PI) / 4 + 0.3], { c: 0 });
  b.cyl(nick, 0.008, 0.008, 0.024, 6, [0.11, 0.5, 0.282], [HP, 0, 0]);
  b.cyl(nick, 0.011, 0.011, 0.075, 8, [0.14, 0.5, 0.296], [0, 0, HP]);
  // ash door
  b.box(iron, 0.4, 0.07, 0.018, [0, 0.29, 0.258], null, { c: 0.004 });
  b.box(nick, 0.06, 0.012, 0.012, [0, 0.29, 0.274], null, { c: 0.003 });
  const lit = !!o.lit;
  if (lit) {
    const glow = M('metalDark', { color: 0x222222, emissive: 0xff5a1a, emissiveIntensity: 2.5 }, false);
    for (let i = 0; i < 4; i++) b.box(glow, 0.06, 0.01, 0.004, [-0.12 + i * 0.08, 0.3, 0.268], null, { c: 0 });
  }
  // cabriole legs
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      b.tube(iron, smoothPts([[sx * 0.27, 0.235, sz * 0.2], [sx * 0.285, 0.15, sz * 0.215], [sx * 0.3, 0.06, sz * 0.235], [sx * 0.325, 0.014, sz * 0.255]], 7), [0.03, 0.024, 0.019, 0.017, 0.016, 0.018, 0.021], 7, { capStart: true });
      b.cyl(iron, 0.032, 0.035, 0.014, 8, [sx * 0.325, 0.007, sz * 0.255]);
    }
  // nickel towel rail
  b.cyl(nick, 0.009, 0.009, 0.72, 8, [0, 0.64, 0.34], [0, 0, HP]);
  for (const s of [-1, 1]) b.tube(nick, [[s * 0.34, 0.64, 0.34], [s * 0.33, 0.64, 0.28], [s * 0.31, 0.64, 0.25]], 0.007, 6);
  // flue collar + pipe
  const pz = -0.13;
  b.cyl(iron, 0.085, 0.085, 0.06, 14, [0, 0.786, pz]);
  const segL = 0.6;
  let y = 0.81;
  const top = 0.81 + pipeLen;
  while (y < top - 0.01) {
    const l = Math.min(segL, top - y);
    b.cyl(pipe, 0.076, 0.076, l, 14, [0, y + l / 2, pz], [0, r.range(0, TAU), 0], { open: true });
    b.cyl(pipe, 0.08, 0.08, 0.03, 14, [0, y + 0.015, pz], null, { open: true });
    y += l;
  }
  b.cyl(pipe, 0.003, 0.003, 0.2, 5, [0, 1.12, pz], [0, 0.5, HP]);
  b.cyl(nick, 0.012, 0.012, 0.05, 6, [Math.cos(0.5) * 0.11, 1.12, pz - Math.sin(0.5) * 0.11], [0, 0.5, HP]);
  b.anchor('fire', [0, 0.46, 0.05]);
  b.anchor('pipeTop', [0, top, pz]);
  b.col([-0.35, 0, -0.29], [0.35, 0.78, 0.31]);
  b.col([-0.09, 0.78, pz - 0.09], [0.09, top, pz + 0.09]);
};

// ---------------------------------------------------------------- fridge (1950s, rounded; opts.ajar)
BUILDERS.fridge = (b, o) => {
  const r = b.r;
  const W = 0.74, D = 0.7, H = 1.62, base = 0.1, doorT = 0.06, back = 0.025, bev = 0.018;
  const body = 'porcelain', trim = 'chrome', dk = 'metalDark', rust = 'rustyMetal';
  const outline = rrPoints(W - 2 * bev, H - base - 2 * bev, 0.02, 0.12, 5, base + bev);
  const holePts = rrPoints(W - 0.1, H - base - 0.2, 0.015, 0.06, 4, base + 0.06).reverse();
  const bodyDepth = D - doorT - back;
  b.add(body, extrudeGeo(outline, [holePts], bodyDepth, bev), [0, 0, D / 2 - doorT - bodyDepth / 2], null, { grain: 1 });
  b.add(body, extrudeGeo(outline, null, back + 0.01, bev), [0, 0, -D / 2 + (back + 0.01) / 2]);
  b.box(rust, W - 0.07, base - 0.015, 0.02, [0, base / 2 + 0.004, D / 2 - doorT - 0.06], null, { c: 0.003 });
  for (let i = 0; i < 4; i++) b.box(dk, W - 0.13, 0.008, 0.012, [0, 0.03 + i * 0.016, D / 2 - doorT - 0.046], null, { c: 0 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(dk, 0.02, 0.024, base, 8, [sx * (W / 2 - 0.07), base / 2, sz * (D / 2 - 0.12)]);
  // interior: wire shelves, freezer box, a few cans
  const zi0 = -D / 2 + back + 0.01, zi1 = D / 2 - doorT - 0.02;
  for (const sy of [0.6, 0.98]) {
    for (let i = 0; i < 8; i++) b.cyl(trim, 0.003, 0.003, zi1 - zi0, 4, [lerp(-0.29, 0.29, i / 7), sy, (zi0 + zi1) / 2], [HP, 0, 0]);
    for (const zz of [zi0 + 0.01, zi1 - 0.01]) b.cyl(trim, 0.004, 0.004, 0.6, 4, [0, sy - 0.004, zz], [0, 0, HP]);
    if (r.chance(0.7)) can(b, dk, 0.034, 0.11, [r.range(-0.2, 0.2), sy + 0.004, r.range(-0.1, 0.1)], 10);
  }
  b.box(body, 0.42, 0.17, 0.4, [-0.08, 1.335, -0.02], null, { c: 0.01 });
  b.box(dk, 0.4, 0.15, 0.012, [-0.08, 1.335, 0.186], null, { c: 0.003 });
  // door
  const aj = o.ajar === true ? 0.55 : typeof o.ajar === 'number' ? o.ajar : o.ajar === false ? 0 : r.chance(0.5) ? r.range(0.25, 0.9) : 0;
  const hingeX = W / 2, hingeZ = D / 2 - doorT;
  b.grp([hingeX, 0, hingeZ], [0, aj, 0], () => {
    const dOut = rrPoints(W - 0.012 - 2 * bev, H - base - 0.02 - 2 * bev, 0.02, 0.114, 5, base + 0.01 + bev);
    b.add(body, extrudeGeo(dOut, null, doorT, bev), [-W / 2, 0, doorT / 2], null, { grain: 1 });
    const hx = -W + 0.07;
    b.box(trim, 0.04, 0.2, 0.014, [hx, 1.08, doorT + 0.006], null, { c: 0.006 });
    b.box(trim, 0.032, 0.14, 0.03, [hx, 1.06, doorT + 0.03], [0.14, 0, 0], { c: 0.01 });
    b.box(trim, 0.2, 0.028, 0.004, [-W / 2, 1.42, doorT + 0.002], null, { c: 0.001 });
    b.box(trim, W - 0.1, 0.012, 0.004, [-W / 2, base + 0.08, doorT + 0.002], null, { c: 0.001 });
    b.box(dk, W - 0.09, H - base - 0.19, 0.01, [-W / 2, base + 0.055 + (H - base - 0.19) / 2, -0.004], null, { c: 0.004 });
    for (const yy of [0.45, 0.8, 1.15]) {
      b.box(body, W - 0.16, 0.06, 0.006, [-W / 2, yy, -0.07], null, { c: 0 });
      b.box(body, W - 0.16, 0.006, 0.06, [-W / 2, yy - 0.03, -0.04], null, { c: 0 });
    }
  });
  for (const hy of [0.2, 1.5]) b.cyl(trim, 0.012, 0.012, 0.07, 8, [W / 2 - 0.004, hy, hingeZ + 0.012]);
  b.col([-W / 2, 0, -D / 2], [W / 2, H, D / 2 - (aj > 0.05 ? doorT : 0)]);
  if (aj > 0.05) {
    const pts = [[-W, 0], [0, 0], [-W, doorT], [0, doorT]].map(([x, z]) => [hingeX + x * Math.cos(aj) + z * Math.sin(aj), hingeZ - x * Math.sin(aj) + z * Math.cos(aj)]);
    const xs = pts.map((p) => p[0]), zs = pts.map((p) => p[1]);
    b.col([Math.min(...xs), 0, Math.min(...zs)], [Math.max(...xs), H, Math.max(...zs)]);
  }
};

// ---------------------------------------------------------------- counter (2m kitchen counter with basin)
BUILDERS.counter = (b) => {
  const r = b.r;
  const L = 2.0, D = 0.6, H = 0.92;
  const m = paintTint(r), top = 'woodBeam', por = 'porcelain', hw = 'metalDark';
  const t = 0.02, kick = 0.1, topT = 0.035, cH = H - topT;
  for (const s of [-1, 1]) b.box(m, t, cH, D - 0.02, [s * (L / 2 - t / 2), cH / 2, -0.01], null, { c: 0.004 });
  b.box(m, L - 2 * t, kick, 0.018, [0, kick / 2, D / 2 - 0.08]);
  b.box(m, L - 2 * t, 0.018, D - 0.05, [0, kick + 0.009, -0.02]);
  b.box(top, L - 2 * t, cH - kick, 0.01, [0, kick + (cH - kick) / 2, -D / 2 + 0.005]);
  for (const x of [-0.5, 0]) b.box(m, 0.018, cH - kick - 0.02, D - 0.06, [x, kick + (cH - kick) / 2, -0.02], null, { c: 0 });
  b.box(m, L - 2 * t, 0.018, D - 0.05, [0, 0.7, -0.02], null, { c: 0 });
  b.box(m, L, 0.03, 0.02, [0, cH - 0.015, D / 2 - 0.01], null, { c: 0.004 });
  b.box(m, 0.4, 0.012, D - 0.08, [-0.75, 0.42, -0.02], null, { c: 0 });
  // top with basin cut-out
  const bx = 0.5 + r.jit(0.02), bz = 0.0, hwid = 0.56, hdep = 0.4;
  const zF = D / 2 + 0.03, zB = -D / 2 - 0.005, x0 = -L / 2 - 0.02, x1 = L / 2 + 0.02, ty = H - topT / 2;
  const tb = (xa, xb, za, zb) => b.box(top, xb - xa, topT, zb - za, [(xa + xb) / 2, ty, (za + zb) / 2], [0, 0, r.jit(0.002)], { c: 0.005 });
  tb(x0, bx - hwid / 2, zB, zF);
  tb(bx + hwid / 2, x1, zB, zF);
  tb(bx - hwid / 2, bx + hwid / 2, bz + hdep / 2, zF);
  tb(bx - hwid / 2, bx + hwid / 2, zB, bz - hdep / 2);
  const rg = (w, d, rr, y) => rrRing(w, d, rr, y, 4, bx, bz);
  b.add(
    por,
    loftGeo(
      [rg(hwid - 0.02, hdep - 0.02, 0.05, H - 0.06), rg(hwid + 0.03, hdep + 0.03, 0.06, H + 0.004), rg(hwid + 0.03, hdep + 0.03, 0.06, H + 0.012), rg(hwid - 0.01, hdep - 0.01, 0.05, H + 0.016), rg(hwid - 0.04, hdep - 0.04, 0.045, H + 0.004), rg(hwid - 0.06, hdep - 0.06, 0.04, H - 0.12), rg(hwid - 0.1, hdep - 0.1, 0.035, H - 0.17)],
      0,
      1
    ),
    null,
    null,
    { weld: false }
  );
  b.cyl(hw, 0.024, 0.024, 0.004, 10, [bx, H - 0.168, bz]);
  b.box(top, L, 0.12, 0.02, [0, H + 0.06, -D / 2 + 0.005], null, { c: 0.004 });
  b.box(top, L, 0.02, 0.05, [0, H + 0.125, -D / 2 + 0.02], null, { c: 0.004 });
  b.cyl(hw, 0.024, 0.03, 0.03, 8, [bx, H + 0.015, -0.26]);
  b.tube(hw, smoothPts([[bx, H + 0.02, -0.26], [bx, H + 0.2, -0.26], [bx, H + 0.27, -0.2], [bx, H + 0.24, -0.12], [bx, H + 0.19, -0.1]], 12), 0.011, 7);
  for (const s of [-1, 1]) {
    b.cyl(hw, 0.012, 0.015, 0.05, 8, [bx + s * 0.13, H + 0.025, -0.26]);
    b.box(hw, 0.06, 0.009, 0.009, [bx + s * 0.13, H + 0.055, -0.26], [0, 0.78, 0], { c: 0 });
    b.box(hw, 0.06, 0.009, 0.009, [bx + s * 0.13, H + 0.055, -0.26], [0, -0.78, 0], { c: 0 });
  }
  // fronts
  const gap = 0.005, bayW = 0.5 - gap;
  const bays = [-0.75, -0.25, 0.25, 0.75];
  const openBay = r.int(0, 3), openMode = r.pick(['ajar', 'ajar', 'missing', 'closed']);
  for (let i = 0; i < 4; i++) {
    const cx = bays[i];
    const out = r.chance(0.15) ? r.range(0.03, 0.15) : r.range(0, 0.006);
    b.box(m, bayW, 0.15, 0.022, [cx, 0.795, D / 2 + 0.011 + out], [0, 0, r.jit(0.005)], { c: 0.005 });
    b.box(hw, 0.1, 0.012, 0.012, [cx, 0.8, D / 2 + 0.036 + out], null, { c: 0.003 });
    for (const q of [-1, 1]) b.box(hw, 0.01, 0.01, 0.018, [cx + q * 0.045, 0.8, D / 2 + 0.027 + out], null, { c: 0 });
    const hingeLeft = i % 2 === 0;
    const dh = 0.57, dy = kick + 0.012;
    let a = r.range(0, 0.02);
    if (i === openBay) {
      if (openMode === 'missing') continue;
      if (openMode === 'ajar') a = r.range(0.4, 1.4);
    }
    b.grp(
      [hingeLeft ? cx - bayW / 2 : cx + bayW / 2, dy, D / 2 + 0.011],
      [0, hingeLeft ? -a : a, 0],
      () => {
        frameDoor(b, m, bayW, dh, 0.022, { stile: 0.055 });
        b.sph(hw, 0.014, [bayW - 0.04, dh - 0.07, 0.03], null, { ws: 8, hs: 6 });
        b.cyl(hw, 0.005, 0.005, 0.02, 6, [bayW - 0.04, dh - 0.07, 0.017], [HP, 0, 0]);
      },
      hingeLeft ? null : [-1, 1, 1]
    );
  }
  b.tube(hw, smoothPts([[bx, H - 0.17, bz], [bx, 0.56, bz], [bx, 0.47, bz - 0.06], [bx, 0.52, bz - 0.14], [bx, 0.5, -D / 2 + 0.01]], 12), 0.02, 8);
  can(b, hw, 0.13, 0.3, [bx + 0.22, kick + 0.018, 0.02], 14);
  b.col([-L / 2 - 0.02, 0, -D / 2], [L / 2 + 0.02, H + 0.02, D / 2 + 0.035]);
};

// ---------------------------------------------------------------- sofa (torn, stuffing showing)
BUILDERS.sofa = (b) => {
  const r = b.r;
  const fab = M('fabric', { color: r.pick([0x5c5444, 0x4e5446, 0x5a4a44, 0x4a4a52]) });
  const stuff = M('fabric', { color: 0xb0a07c });
  const wood = 'woodBeam', spring = 'rustyMetal';
  const sd = r.range(0, 40);
  const lumpy = (amp, f = 7) => (v) => {
    v.x += amp * vnoise(v.x * f + sd, v.y * f, v.z * f);
    v.y += amp * vnoise(v.x * f, v.y * f + sd, v.z * f + 3);
    v.z += amp * vnoise(v.x * f + 5, v.y * f, v.z * f + sd);
  };
  b.soft(fab, 1.84, 0.26, 0.8, 0.04, [10, 3, 6], [0, 0.23, 0.02], null, { deform: lumpy(0.006) });
  for (const s of [-1, 1])
    b.soft(fab, 0.2, 0.47, 0.86, 0.075, [3, 6, 8], [s * 0.9, 0.335, 0.02], [0, 0, s * r.jit(0.03)], {
      deform: (v) => {
        v.x += s * 0.025 * smooth(0.05, 0.23, v.y);
        lumpy(0.007)(v);
      },
    });
  b.soft(fab, 1.82, 0.52, 0.2, 0.06, [10, 5, 3], [0, 0.6, -0.33], [-0.12, 0, 0], { deform: lumpy(0.008) });
  const missing = r.chance(0.4) ? r.int(0, 2) : -1;
  const torn = r.int(0, 2);
  for (let i = 0; i < 3; i++) {
    const cx = (i - 1) * 0.6;
    if (i === missing) {
      for (let k = 0; k < 4; k++) {
        const pts = [];
        const sx = cx + r.jit(0.18), sz = 0.05 + r.jit(0.2);
        for (let q = 0; q <= 18; q++) {
          const a = (q / 18) * TAU * 3;
          pts.push([sx + Math.cos(a) * 0.035, 0.34 + (q / 18) * r.range(0.06, 0.1), sz + Math.sin(a) * 0.035]);
        }
        b.tube(spring, pts, 0.0025, 3, { capEnd: false });
      }
      continue;
    }
    b.soft(fab, 0.6, 0.14, 0.64, 0.05, [6, 3, 6], [cx + r.jit(0.02), 0.43, 0.06 + r.jit(0.02)], [r.jit(0.03), r.jit(0.06), r.jit(0.03)], {
      deform: (v) => {
        if (v.y > 0) v.y -= 0.028 * (1 - (v.x / 0.3) ** 2) * (1 - (v.z / 0.32) ** 2);
        lumpy(0.006, 9)(v);
      },
    });
    if (i === torn) {
      for (let k = 0; k < 3; k++)
        b.add(stuff, new THREE.IcosahedronGeometry(r.range(0.045, 0.07), 1), [cx + r.jit(0.12), 0.49, 0.1 + r.jit(0.14)], [r.next(), r.next(), 0], {
          scl: [1, 0.6, 1],
          deform: (v) => v.multiplyScalar(1 + 0.3 * vnoise(v.x * 35 + k, v.y * 35, v.z * 35)),
        });
      b.add(fab, new THREE.BoxGeometry(0.16, 0.006, 0.1, 4, 1, 3), [cx + 0.1, 0.51, 0.2], [0.5, 0.4, 0.2], {
        deform: (v) => {
          v.y += 0.02 * Math.sin(v.x * 20) + 0.01 * vnoise(v.x * 40, 0, v.z * 40);
        },
      });
    }
  }
  const slump = r.int(0, 2);
  for (let i = 0; i < 3; i++) {
    const cx = (i - 1) * 0.6;
    const rx = i === slump ? 0.35 : -0.2 + r.jit(0.05);
    b.soft(fab, 0.58, 0.42, 0.16, 0.05, [6, 5, 3], [cx, 0.72 - (i === slump ? 0.06 : 0), -0.2 + (i === slump ? 0.06 : 0)], [rx, r.jit(0.06), r.jit(0.05)], {
      deform: (v) => {
        v.z += 0.02 * (1 - (v.x / 0.29) ** 2) * (1 - (v.y / 0.21) ** 2);
        lumpy(0.006, 8)(v);
      },
    });
  }
  const foot = [[0, 0], [0.022, 0], [0.028, 0.03], [0.034, 0.07], [0.04, 0.1], [0, 0.1]];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.lathe(wood, foot, 8, [sx * 0.86, 0, sz * 0.34]);
  b.col([-1.0, 0, -0.45], [1.0, 0.5, 0.45]);
  b.col([-1.0, 0.5, -0.45], [1.0, 0.86, -0.2]);
};

// ============================================================================ props: storage, junk, small items
// ---------------------------------------------------------------- crate (0.8m; variant 1 = plywood panel crate)
BUILDERS.crate = (b, o) => {
  const r = b.r;
  const S = 0.8, h = S / 2, bt = 0.02, wood = 'crateWood';
  const v1 = (o.variant | 0) === 1;
  const nB = 3, gapB = 0.012, bw = (S - (nB - 1) * gapB) / nB;
  // side boards
  for (const s of [-1, 1]) {
    if (v1) {
      b.box(wood, S - 0.004, S - 0.004, bt * 0.6, [0, h, s * (h - bt * 0.3)], null, { c: 0.002, grain: 0 });
      b.box(wood, bt * 0.6, S - 0.004, S - 2 * bt, [s * (h - bt * 0.3), h, 0], null, { c: 0.002, grain: 2 });
      continue;
    }
    for (let i = 0; i < nB; i++) {
      const y = bw / 2 + i * (bw + gapB);
      b.box(wood, S, bw, bt, [r.jit(0.003), y, s * (h - bt / 2)], [0, 0, r.jit(0.006)], { c: 0.003, grain: 0 });
      b.box(wood, bt, bw, S - 2 * bt, [s * (h - bt / 2), y, r.jit(0.003)], [r.jit(0.006), 0, 0], { c: 0.003, grain: 2 });
    }
  }
  // bottom + top boards (one top board may be pried up)
  const pried = !v1 && r.chance(0.3) ? r.int(0, nB - 1) : -1;
  for (let i = 0; i < nB; i++) {
    const z = -h + bw / 2 + i * (bw + gapB);
    b.box(wood, S, bt, bw, [0, bt / 2, z], null, { c: 0.003, grain: 0 });
    if (i === pried) {
      b.grp([-h, S - bt / 2, z], [0, 0, 0.12 + r.range(0, 0.1)], () => {
        b.box(wood, S, bt, bw, [h, 0, 0], [0, r.jit(0.03), 0], { c: 0.003, grain: 0 });
        for (const q of [-1, 1]) b.cyl(NAIL, 0.0018, 0.0018, 0.05, 4, [S - 0.03, -0.025, q * 0.05]);
      });
    } else b.box(wood, S, bt, bw, [0, S - bt / 2, z], [r.jit(0.004), 0, 0], { c: 0.003, grain: 0 });
  }
  // battens on front/back (+ diagonal brace) and sides
  const bb = 0.07;
  for (const s of [-1, 1]) {
    const zf = s * (h + bt / 2);
    for (const q of [-1, 1]) b.box(wood, bb, S, bt, [q * (h - bb / 2), h, zf], null, { c: 0.004, grain: 1 });
    for (const yy of [bb / 2, S - bb / 2]) b.box(wood, S - 2 * bb, bb, bt, [0, yy, zf], null, { c: 0.004, grain: 0 });
    if (!v1) {
      const span = S - 2 * bb, len = Math.hypot(span, span) - 0.02;
      b.box(wood, len, bb * 0.9, bt, [0, h, zf + s * 0.001], [0, 0, s * PI * 0.25], { c: 0.004, grain: 0 });
    }
    const xf = s * (h + bt / 2);
    for (const q of [-1, 1]) b.box(wood, bt, S, bb, [xf, h, q * (h - bb / 2 - bt)], null, { c: 0.004, grain: 1 });
    if (v1) for (const yy of [bb / 2, S - bb / 2]) b.box(wood, bt, bb, S - 2 * bb - 2 * bt, [xf, yy, 0], null, { c: 0.004, grain: 2 });
    // nails
    for (const q of [-1, 1])
      for (const yy of [0.035, h, S - 0.035]) {
        nailZ(b, q * (h - bb / 2) + r.jit(0.008), yy + r.jit(0.008), s > 0 ? zf + bt / 2 : zf - bt / 2 - 0.004);
      }
    for (const q of [-1, 1]) for (const yy of [0.035, S - 0.035]) b.cyl(NAIL, 0.0055, 0.005, 0.004, 5, [xf + s * (bt / 2 + 0.002), yy, q * (h - bb / 2 - bt)], [0, 0, HP]);
  }
  for (let i = 0; i < nB; i++) for (const q of [-1, 1]) nailY(b, q * (h - 0.03), S, -h + bw / 2 + i * (bw + gapB) + r.jit(0.02));
  b.col([-h - bt, 0, -h - bt], [h + bt, S, h + bt]);
};

// ---------------------------------------------------------------- crateLong (military weapon crate, special spawn)
BUILDERS.crateLong = (b) => {
  const r = b.r;
  const wood = M('crateWood', { color: 0x7a8256 }), metal = 'metalDark', rope = M('cloth', { color: 0x8c7c5a });
  const L = 1.3, W = 0.45, H = 0.4, lidH = 0.08, bodyH = H - lidH - 0.004;
  b.box(wood, L - 0.04, bodyH, W - 0.03, [0, bodyH / 2, 0], null, { c: 0.008 });
  b.box(wood, L - 0.03, lidH, W - 0.02, [0, bodyH + 0.004 + lidH / 2, 0], null, { c: 0.01 });
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) b.box(wood, L - 0.24, bodyH / 3 - 0.008, 0.008, [0, (i + 0.5) * (bodyH / 3), s * ((W - 0.03) / 2 + 0.003)], null, { c: 0.002 });
    b.box(wood, L - 0.24, 0.008, W - 0.12, [0, H - 0.001, 0], null, { c: 0.002 });
  }
  for (const bx of [-0.44, 0.44]) {
    for (const s of [-1, 1]) {
      b.box(wood, 0.07, bodyH, 0.022, [bx, bodyH / 2, s * (W / 2 - 0.004)], null, { c: 0.004 });
      b.box(wood, 0.07, lidH, 0.022, [bx, bodyH + 0.004 + lidH / 2, s * (W / 2 + 0.001)], null, { c: 0.004 });
    }
    b.box(wood, 0.07, 0.022, W + 0.02, [bx, H + 0.006, 0], null, { c: 0.004 });
    b.box(wood, 0.09, 0.03, W + 0.02, [bx, 0.015, 0], null, { c: 0.004 });
  }
  for (const sx of [-1, 1]) {
    const ex = sx * (L / 2 - 0.015);
    b.box(wood, 0.03, H - 0.02, 0.06, [ex, H / 2, W / 2 - 0.04], null, { c: 0.004 });
    b.box(wood, 0.03, H - 0.02, 0.06, [ex, H / 2, -W / 2 + 0.04], null, { c: 0.004 });
    b.box(wood, 0.03, 0.06, W - 0.12, [ex, H - 0.04, 0], null, { c: 0.004 });
    b.box(wood, 0.03, 0.06, W - 0.12, [ex, 0.04, 0], null, { c: 0.004 });
    for (const sy of [0, 1])
      for (const sz of [-1, 1]) {
        const y = sy ? H - 0.02 : 0.02;
        b.box(metal, 0.05, 0.045, 0.004, [sx * (L / 2 - 0.02), y, sz * (W / 2 + 0.008)], null, { c: 0 });
        b.box(metal, 0.004, 0.045, 0.05, [sx * (L / 2 + 0.002), y, sz * (W / 2 - 0.02)], null, { c: 0 });
        b.box(metal, 0.05, 0.004, 0.05, [sx * (L / 2 - 0.02), sy ? H + 0.018 : -0.0, sz * (W / 2 - 0.02)], null, { c: 0 });
      }
    // rope handle
    const rx = sx * (L / 2 + 0.018);
    for (const q of [-1, 1]) b.box(wood, 0.03, 0.05, 0.04, [sx * (L / 2 + 0.005), 0.27, q * 0.1], null, { c: 0.005 });
    b.tube(rope, smoothPts([[rx, 0.27, -0.12], [rx + sx * 0.012, 0.2, -0.08], [rx + sx * 0.018, 0.175, 0], [rx + sx * 0.012, 0.2, 0.08], [rx, 0.27, 0.12]], 14), 0.011, 6, { capStart: true });
  }
  for (const lx of [-0.28, 0.28]) {
    b.box(metal, 0.06, 0.07, 0.006, [lx, bodyH + 0.03, W / 2 - 0.004], null, { c: 0.002 });
    b.box(metal, 0.07, 0.045, 0.008, [lx, bodyH - 0.035, W / 2 - 0.004], null, { c: 0.002 });
    b.box(metal, 0.02, 0.06, 0.012, [lx, bodyH - 0.005, W / 2 + 0.006], [0.2 + r.jit(0.1), 0, 0], { c: 0.002 });
    b.add(metal, new THREE.TorusGeometry(0.012, 0.003, 4, 8), [lx, bodyH - 0.045, W / 2 + 0.006]);
    b.box(metal, 0.07, 0.12, 0.005, [lx * 1.2, bodyH, -W / 2 - 0.003], null, { c: 0.001 });
  }
  b.cyl(metal, 0.006, 0.006, L - 0.2, 6, [0, bodyH + 0.002, -W / 2 - 0.006], [0, 0, HP]);
  b.anchor('top', [0, H + 0.02, 0]);
  b.col([-L / 2 - 0.03, 0, -W / 2 - 0.01], [L / 2 + 0.03, H + 0.02, W / 2 + 0.01]);
};

// ---------------------------------------------------------------- cardboard boxes
function cardboardBoxAt(b, size, pos, rotY, open) {
  const r = b.r;
  const [w, h, d] = size;
  const mat = r.pick(['cardboard', M('cardboard', { color: 0xb8ae9c }), M('cardboard', { color: 0x9e9282 })]);
  const tape = M('fabric', { color: 0x8e7c54 });
  const bulge = r.range(0.004, 0.014), sag = r.range(0, 0.018), sd = r.range(0, 40);
  b.grp(pos, [0, rotY, 0], () => {
    if (!open) {
      const deform = (v) => {
        const tx = Math.max(0, 1 - (2 * v.x / w) ** 2), ty = Math.max(0, 1 - (2 * (v.y - h / 2) / h) ** 2), tz = Math.max(0, 1 - (2 * v.z / d) ** 2);
        v.x += Math.sign(v.x) * bulge * ty * tz;
        v.z += Math.sign(v.z) * bulge * ty * tx;
        if (v.y > h * 0.5) v.y -= sag * tx * tz;
        v.y += 0.002 * vnoise(v.x * 9 + sd, v.y * 9, v.z * 9);
      };
      const g = new THREE.BoxGeometry(w, h, d, 3, 3, 3);
      g.translate(0, h / 2, 0);
      b.add(mat, g, null, null, { weld: false, deform });
      // flap seam + tape
      const tg = new THREE.BoxGeometry(w + 0.004, 0.002, 0.05, 6, 1, 1);
      tg.translate(0, h + 0.001, 0);
      b.add(tape, tg, null, null, { weld: false, deform });
      for (const s of [-1, 1]) b.box(tape, 0.002, 0.07, 0.05, [s * (w / 2 + bulge * 0.2 + 0.001), h - 0.035, 0], null, { c: 0 });
      b.box(mat, w * 0.96, 0.002, 0.003, [0, h + 0.0005 - sag * 0.5, 0.027], null, { c: 0 });
    } else {
      const t = 0.005;
      b.box(mat, w, t, d, [0, t / 2, 0], null, { c: 0 });
      for (const s of [-1, 1]) {
        b.box(mat, w, h, t, [0, h / 2, s * (d / 2 - t / 2)], [r.jit(0.02) * s, 0, 0], { c: 0 });
        b.box(mat, t, h, d - 2 * t, [s * (w / 2 - t / 2), h / 2, 0], [0, 0, r.jit(0.02)], { c: 0 });
      }
      const fl = Math.min(w, d) / 2 - 0.005;
      for (const s of [-1, 1]) {
        const a = r.range(1.8, 2.7);
        b.grp([0, h, s * (d / 2)], [s * a, 0, 0], () => b.box(mat, w - 0.004, t, fl, [0, 0, -s * fl / 2], null, { c: 0 }));
        const a2 = r.range(1.6, 2.5);
        b.grp([s * (w / 2), h, 0], [0, 0, -s * a2], () => b.box(mat, fl, t, d - 0.01, [-s * fl / 2, 0, 0], null, { c: 0 }));
      }
    }
  });
}
function boxFootprint(size, pos, rotY) {
  const [w, h, d] = size;
  const c = Math.abs(Math.cos(rotY)), s = Math.abs(Math.sin(rotY));
  const ex = c * w / 2 + s * d / 2 + 0.02, ez = s * w / 2 + c * d / 2 + 0.02;
  return { min: [pos[0] - ex, pos[1], pos[2] - ez], max: [pos[0] + ex, pos[1] + h, pos[2] + ez] };
}
const BOX_SIZES = [
  [0.5, 0.38, 0.4],
  [0.42, 0.3, 0.32],
  [0.6, 0.42, 0.45],
  [0.35, 0.28, 0.35],
  [0.55, 0.3, 0.4],
];
BUILDERS.cardboardBox = (b, o) => {
  const r = b.r;
  let size = o.size;
  if (typeof size === 'number') size = [size, size * 0.78, size * 0.85];
  if (!Array.isArray(size)) size = r.pick(BOX_SIZES);
  const open = o.open ?? r.chance(0.3);
  cardboardBoxAt(b, size, [0, 0, 0], 0, open);
  b.col([-size[0] / 2, 0, -size[2] / 2], [size[0] / 2, size[1], size[2] / 2]);
};
BUILDERS.cardboardStack = (b) => {
  const r = b.r;
  const n = r.int(3, 5);
  const placed = [];
  const layer = [[], [], []];
  const c0 = Math.min(n, r.int(2, 3));
  let x = 0;
  for (let i = 0; i < c0; i++) {
    const s = r.pick(BOX_SIZES);
    const rot = r.jit(0.25);
    const p = [x + s[0] / 2, 0, r.jit(0.08)];
    x += s[0] + r.range(0.0, 0.06);
    layer[0].push({ s, p, rot });
  }
  for (const bx of layer[0]) bx.p[0] -= x / 2;
  let left = n - c0;
  for (let li = 1; li < 3 && left > 0; li++) {
    const base = layer[li - 1];
    const cnt = Math.min(left, li === 1 ? r.int(1, Math.min(2, base.length)) : 1);
    for (let i = 0; i < cnt; i++) {
      const under = base[Math.min(base.length - 1, i + r.int(0, Math.max(0, base.length - cnt)))];
      let s = r.pick(BOX_SIZES);
      s = [Math.min(s[0], under.s[0] + 0.06), s[1] * r.range(0.8, 1), Math.min(s[2], under.s[2] + 0.06)];
      layer[li].push({ s, p: [under.p[0] + r.jit(0.07), under.p[1] + under.s[1] - 0.004, under.p[2] + r.jit(0.06)], rot: under.rot + r.jit(0.3) });
      left--;
    }
  }
  for (let li = 0; li < 3; li++) {
    if (!layer[li].length) continue;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const bx of layer[li]) {
      cardboardBoxAt(b, bx.s, bx.p, bx.rot, li === 2 ? false : r.chance(0.15));
      const f = boxFootprint(bx.s, bx.p, bx.rot);
      for (let k = 0; k < 3; k++) {
        mn[k] = Math.min(mn[k], f.min[k]);
        mx[k] = Math.max(mx[k], f.max[k]);
      }
      placed.push(bx);
    }
    b.col(mn, mx);
  }
};

// ---------------------------------------------------------------- barrel (55 gal drum, dents)
function drumProfile(openTop = false) {
  const R = 0.286;
  const p = [[0, 0.014], [0.25, 0.014], [0.262, 0.01], [0.276, 0.0], [0.289, 0.006], [0.291, 0.02], [0.289, 0.032], [0.281, 0.036], [0.281, 0.1]];
  const hoop = (y) => {
    p.push([R - 0.005, y - 0.022], [R + 0.006, y - 0.01], [R + 0.008, y], [R + 0.006, y + 0.01], [R - 0.005, y + 0.022]);
  };
  const ribs = (y0, y1) => {
    for (let i = 1; i < 3; i++) {
      const y = lerp(y0, y1, i / 3);
      p.push([R - 0.005, y - 0.012], [R - 0.001, y], [R - 0.005, y + 0.012]);
    }
  };
  ribs(0.1, 0.27);
  hoop(0.295);
  ribs(0.32, 0.56);
  hoop(0.585);
  ribs(0.61, 0.83);
  p.push([R - 0.005, 0.84], [0.289, 0.852], [0.291, 0.866], [0.289, 0.878], [0.276, 0.884]);
  if (openTop) p.push([0.272, 0.878], [0.276, 0.86], [0.276, 0.6], [0.276, 0.3], [0.276, 0.17], [0.276, 0.1], [0.276, 0.04], [0, 0.04]);
  else p.push([0.262, 0.876], [0.25, 0.868], [0.12, 0.866], [0, 0.866]);
  return p;
}
function dentDeform(r, n, depthMax = 0.03) {
  const dents = [];
  for (let i = 0; i < n; i++) dents.push({ a: r.range(-PI, PI), y: r.range(0.12, 0.8), rad: r.range(0.08, 0.16), d: r.range(0.008, depthMax) });
  return (v) => {
    const rr = Math.hypot(v.x, v.z);
    if (rr < 0.2) return;
    const a = Math.atan2(v.z, v.x);
    for (const dn of dents) {
      let da = a - dn.a;
      if (da > PI) da -= TAU;
      if (da < -PI) da += TAU;
      const q = ((da * rr) ** 2 + (v.y - dn.y) ** 2) / (dn.rad * dn.rad);
      if (q < 1) {
        const k = 1 - (dn.d * (1 - q) ** 2) / rr;
        v.x *= k;
        v.z *= k;
      }
    }
  };
}
BUILDERS.barrel = (b, o) => {
  const r = b.r;
  const v = o.variant ?? r.pick(['rust', 'rust', 'blue', 'red', 'green']);
  const mat = v === 'blue' ? M('rustyMetal', { color: 0x8a9aaa }) : v === 'red' ? M('rustyMetal', { color: 0xb07a68 }) : v === 'green' ? M('rustyMetal', { color: 0x8e9a7a }) : 'rustyMetal';
  b.lathe(mat, drumProfile(false), 20, null, null, { deform: dentDeform(r, r.int(1, 3)), weld: false });
  b.cyl(mat, 0.03, 0.03, 0.014, 8, [0.17, 0.872, 0.04]);
  b.cyl(mat, 0.018, 0.018, 0.012, 6, [-0.17, 0.871, -0.05]);
  b.col([-0.29, 0, -0.29], [0.29, 0.885, 0.29]);
};

// ---------------------------------------------------------------- generator (basement diesel set on skid)
// opts.live: THE generator (world/generator.js adds the animated pull-start, gauges and the cables to
// the fuse panel), so the static pull handle and the loose floor cables are left out
BUILDERS.generator = (b, o) => {
  const r = b.r;
  const paint = 'paintGreen', dk = 'metalDark', rust = 'rustyMetal', rub = 'rubber';
  for (const s of [-1, 1]) {
    b.box(dk, 1.36, 0.1, 0.012, [0, 0.05, s * 0.33], null, { c: 0.002 });
    b.box(dk, 1.36, 0.012, 0.055, [0, 0.006, s * (0.33 - 0.022)], null, { c: 0.002 });
    b.box(dk, 1.36, 0.012, 0.055, [0, 0.094, s * (0.33 - 0.022)], null, { c: 0.002 });
    for (const x of [-0.6, 0.6]) b.cyl(dk, 0.018, 0.018, 0.02, 8, [x, 0.05, s * 0.34], [HP, 0, 0]);
  }
  for (const x of [-0.55, 0, 0.55]) b.box(dk, 0.06, 0.05, 0.62, [x, 0.075, 0], null, { c: 0.003 });
  // engine
  for (const x of [-0.5, -0.16]) for (const z of [-0.15, 0.15]) b.box(rub, 0.05, 0.05, 0.05, [x, 0.125, z], null, { c: 0.006 });
  b.box(dk, 0.38, 0.05, 0.34, [-0.33, 0.175, 0], null, { c: 0.008 });
  b.box(paint, 0.46, 0.3, 0.42, [-0.33, 0.35, 0], null, { c: 0.02 });
  b.box(dk, 0.27, 0.12, 0.3, [-0.35, 0.56, 0], null, { c: 0.01 });
  for (let i = 0; i < 6; i++) b.box(dk, 0.31, 0.007, 0.37, [-0.35, 0.51 + i * 0.019, 0], null, { c: 0 });
  b.box(paint, 0.24, 0.05, 0.22, [-0.35, 0.645, 0], null, { c: 0.015 });
  for (const x of [-0.45, -0.25]) for (const z of [-0.09, 0.09]) b.cyl(dk, 0.007, 0.007, 0.01, 6, [x, 0.672, z]);
  b.cyl(paint, 0.135, 0.135, 0.07, 18, [-0.595, 0.36, 0], [0, 0, HP]);
  b.cyl(dk, 0.11, 0.11, 0.012, 18, [-0.634, 0.36, 0], [0, 0, HP]);
  for (let i = 0; i < 5; i++) b.box(paint, 0.004, 0.012, 0.2, [-0.642, 0.3 + i * 0.03, 0], null, { c: 0 });
  if (!o.live) {
    b.box(rub, 0.02, 0.09, 0.02, [-0.66, 0.48, 0.05], [0, 0, 0.1], { c: 0.005 });
    b.tube(rub, [[-0.64, 0.4, 0.03], [-0.655, 0.44, 0.045], [-0.66, 0.475, 0.05]], 0.003, 3);
  }
  b.cyl(dk, 0.07, 0.07, 0.13, 14, [-0.3, 0.44, 0.27], [HP, 0, 0]);
  b.cyl(dk, 0.02, 0.02, 0.03, 8, [-0.3, 0.44, 0.345], [HP, 0, 0]);
  b.box(dk, 0.07, 0.012, 0.01, [-0.3, 0.44, 0.36], null, { c: 0 });
  // exhaust
  b.cyl(rust, 0.08, 0.08, 0.32, 14, [-0.33, 0.45, -0.3], [0, 0, HP]);
  for (const x of [-0.49, -0.17]) b.cyl(rust, 0.084, 0.084, 0.012, 14, [x, 0.45, -0.3], [0, 0, HP], { open: true });
  const ex = smoothPts([[-0.17, 0.45, -0.3], [-0.12, 0.47, -0.32], [-0.1, 0.62, -0.33], [-0.1, 0.9, -0.33], [-0.1, 1.08, -0.3]], 12);
  b.tube(rust, ex, 0.022, 8, { capEnd: false });
  b.cyl(rust, 0.035, 0.035, 0.004, 10, [-0.1, 1.1, -0.29], [0.5, 0, 0]);
  // coupling + alternator
  b.cyl(dk, 0.17, 0.2, 0.08, 16, [-0.06, 0.33, 0], [0, 0, HP]);
  b.cyl(paint, 0.19, 0.19, 0.42, 18, [0.19, 0.33, 0], [0, 0, HP]);
  for (const x of [0.02, 0.36]) b.add(dk, new THREE.TorusGeometry(0.19, 0.012, 5, 18), [x, 0.33, 0], [0, HP, 0]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    b.box(dk, 0.1, 0.02, 0.006, [0.1, 0.33 + Math.sin(a) * 0.192, Math.cos(a) * 0.192], [HP - a, 0, 0], { c: 0 });
  }
  b.lathe(dk, [[0.19, 0], [0.17, 0.03], [0.12, 0.05], [0, 0.056]], 16, [0.4, 0.33, 0], [0, 0, -HP]);
  b.box(dk, 0.3, 0.1, 0.3, [0.2, 0.15, 0], null, { c: 0.006 });
  // control panel
  b.box(paint, 0.12, 0.34, 0.46, [0.56, 0.44, 0], null, { c: 0.012 });
  b.box(dk, 0.01, 0.26, 0.38, [0.62, 0.45, 0], null, { c: 0.002 });
  for (const z of [-0.1, 0.06]) {
    b.add(dk, new THREE.TorusGeometry(0.035, 0.006, 5, 14), [0.628, 0.52, z], [0, HP, 0]);
    b.cyl(rub, 0.033, 0.033, 0.004, 14, [0.626, 0.52, z], [0, 0, HP]);
  }
  for (let i = 0; i < 3; i++) b.cyl(dk, 0.004, 0.006, 0.025, 6, [0.635, 0.42, -0.12 + i * 0.05], [0, 0, -HP + 0.4]);
  for (const z of [0.1, 0.16]) b.cyl(rub, 0.022, 0.022, 0.02, 10, [0.63, 0.36, z], [0, 0, HP]);
  // fuel tank
  b.box(paint, 0.95, 0.2, 0.46, [-0.05, 0.87, 0], null, { c: 0.03 });
  b.cyl(dk, 0.025, 0.025, 0.04, 10, [-0.35, 0.985, 0.1]);
  b.cyl(dk, 0.042, 0.042, 0.025, 12, [-0.35, 1.01, 0.1]);
  b.add(dk, new THREE.TorusGeometry(0.03, 0.005, 4, 12), [0.2, 0.972, -0.08], [HP, 0, 0]);
  b.tube(rub, smoothPts([[-0.4, 0.77, -0.15], [-0.45, 0.7, -0.18], [-0.46, 0.6, -0.2], [-0.42, 0.52, -0.22]], 8), 0.006, 5);
  // roll frame
  for (const s of [-1, 1]) {
    const f = smoothPts([[-0.62, 0.1, s * 0.3], [-0.62, 0.7, s * 0.3], [-0.6, 0.755, s * 0.3], [-0.5, 0.765, s * 0.3], [0.5, 0.765, s * 0.3], [0.6, 0.755, s * 0.3], [0.62, 0.7, s * 0.3], [0.62, 0.1, s * 0.3]], 24);
    b.tube(rust, f, 0.02, 7, { capStart: true });
  }
  for (const x of [-0.62, 0.62]) b.cyl(rust, 0.018, 0.018, 0.6, 7, [x, 0.72, 0], [HP, 0, 0]);
  for (const x of [-0.4, 0.3]) b.box(rust, 0.05, 0.01, 0.62, [x, 0.765, 0], null, { c: 0 });
  // power cables snaking over the floor
  for (let k = 0; k < (o.live ? 0 : 2); k++) {
    const z0 = k ? 0.16 : 0.1;
    const pts = [[0.64, 0.36, z0], [0.7, 0.34, z0 + 0.02], [0.76, 0.18, z0 + 0.06], [0.82, 0.018, z0 + 0.12]];
    let cx = 0.82, cz = z0 + 0.12;
    for (let i = 0; i < 4; i++) {
      cx += r.range(0.25, 0.4);
      cz += r.jit(0.25) + (k ? 0.12 : -0.05);
      pts.push([cx, 0.018, cz]);
    }
    const sp = smoothPts(pts, 28);
    for (const q of sp) q.y = Math.max(q.y, 0.016);
    b.tube(rub, sp, 0.013, 6);
  }
  b.anchor('exhaust', [-0.1, 1.1, -0.3]);
  b.anchor('panel', [0.63, 0.52, 0]);
  b.col([-0.7, 0, -0.4], [0.7, 1.0, 0.4]);
};

// ---------------------------------------------------------------- workbench (vise, tools, clutter)
BUILDERS.workbench = (b) => {
  const r = b.r;
  const L = 2.0, D = 0.7, H = 0.92, tt = 0.05;
  const wood = 'woodBeam', dk = 'metalDark', rust = 'rustyMetal';
  for (let i = 0; i < 3; i++) b.box(wood, L + r.jit(0.01), tt, D / 3 - 0.004, [r.jit(0.005), H - tt / 2 + r.jit(0.002), -D / 2 + (i + 0.5) * (D / 3)], [0, r.jit(0.004), r.jit(0.003)], { c: 0.006 });
  const lx = L / 2 - 0.1, lz = D / 2 - 0.07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box(wood, 0.085, H - tt, 0.085, [sx * lx, (H - tt) / 2, sz * lz], [0, r.jit(0.02), 0], { c: 0.006 });
  for (const s of [-1, 1]) {
    b.box(wood, 2 * lx - 0.085, 0.1, 0.03, [0, H - tt - 0.05, s * (lz + 0.0575 - 0.015)], null, { c: 0.004 });
    b.box(wood, 0.03, 0.1, 2 * lz - 0.085, [s * (lx + 0.0575 - 0.015), H - tt - 0.05, 0], null, { c: 0.004 });
    b.box(wood, 2 * lx - 0.085, 0.06, 0.03, [0, 0.14, s * (lz + 0.0575 - 0.015)], null, { c: 0.004 });
  }
  for (let i = 0; i < 4; i++) b.box(wood, 2 * lx + 0.05, 0.022, 0.12, [r.jit(0.01), 0.181, -0.24 + i * 0.16], [0, r.jit(0.01), 0], { c: 0.004 });
  // tool wall
  const bz = -D / 2 + 0.01;
  for (let i = 0; i < 3; i++) b.box(wood, L - 0.02, 0.2, 0.02, [0, H + 0.1 + i * 0.205, bz], [0, 0, r.jit(0.004)], { c: 0.004 });
  for (const s of [-1, 1]) b.box(wood, 0.05, 0.66, 0.04, [s * lx, H + 0.3, bz - 0.03], null, { c: 0.005 });
  const wz = bz + 0.012;
  // saw
  b.grp([-0.55, H + 0.4, wz + 0.003], [0, 0, 0.08 + r.jit(0.05)], () => {
    b.add(dk, extrudeGeo([[0, -0.02], [0.52, -0.01], [0.52, 0.04], [0, 0.12]], null, 0.002, 0), null, null, {});
    b.add(wood, extrudeGeo([[-0.14, -0.03], [0.01, -0.03], [0.01, 0.13], [-0.1, 0.14], [-0.16, 0.06]], [[[-0.11, 0.02], [-0.03, 0.02], [-0.03, 0.09], [-0.1, 0.09]]], 0.025, 0.004), null, null, {});
  });
  // hammer on wall
  b.grp([-0.1, H + 0.42, wz + 0.02], [0, 0, 0.05], () => {
    b.cyl(wood, 0.013, 0.015, 0.32, 7, [0, -0.1, 0]);
    b.box(dk, 0.11, 0.028, 0.026, [0.015, 0.07, 0], null, { c: 0.004 });
  });
  // wrenches
  for (let i = 0; i < 3; i++) {
    const len = 0.16 + i * 0.05;
    b.grp([0.2 + i * 0.07, H + 0.5, wz + 0.004], [0, 0, r.jit(0.08)], () => {
      b.box(dk, 0.018, len, 0.006, [0, -len / 2, 0], null, { c: 0.001 });
      b.add(dk, new THREE.TorusGeometry(0.016, 0.006, 4, 8), [0, 0, 0]);
      b.add(dk, new THREE.TorusGeometry(0.018, 0.006, 4, 8, PI * 1.4), [0, -len, 0], [0, 0, -HP * 0.2]);
    });
    nailZ(b, 0.2 + i * 0.07, H + 0.5, wz, rust);
  }
  b.add(rust, new THREE.TorusGeometry(0.1, 0.012, 5, 14), [0.62, H + 0.42, wz + 0.014], [0, 0, 0], { scl: [1, 1.15, 0.8] });
  nailZ(b, 0.62, H + 0.535, wz, rust);
  // vise (front-left corner)
  const vx = -L / 2 + 0.28, vz = D / 2;
  b.box(dk, 0.15, 0.04, 0.14, [vx, H + 0.02, vz - 0.07], null, { c: 0.006 });
  b.box(dk, 0.1, 0.08, 0.17, [vx, H + 0.08, vz - 0.02], null, { c: 0.01 });
  b.box(dk, 0.15, 0.06, 0.035, [vx, H + 0.135, vz + 0.07], null, { c: 0.006 });
  b.box(dk, 0.15, 0.06, 0.035, [vx, H + 0.135, vz + 0.125], null, { c: 0.006 });
  b.box(dk, 0.08, 0.05, 0.06, [vx, H + 0.1, vz + 0.155], null, { c: 0.006 });
  b.cyl(dk, 0.012, 0.012, 0.16, 8, [vx, H + 0.09, vz + 0.12], [HP, 0, 0]);
  b.cyl(rust, 0.007, 0.007, 0.24, 6, [vx + r.jit(0.06), H + 0.09, vz + 0.2], [0, 0, HP]);
  for (const s of [-1, 1]) b.sph(rust, 0.012, [vx + s * 0.12, H + 0.09, vz + 0.2], null, { ws: 6, hs: 4 });
  // tools on top (kept away from the middle-right where radios / lanterns get placed)
  b.grp([-0.35, H, -0.1], [0, r.range(0, TAU), 0], () => {
    b.cyl(wood, 0.013, 0.015, 0.3, 7, [0, 0.015, 0], [0, 0, HP]);
    b.box(dk, 0.03, 0.11, 0.026, [0.16, 0.03, 0], null, { c: 0.004 });
  });
  for (let i = 0; i < 2; i++)
    b.grp([-0.5 + i * 0.08, H, 0.1 + r.jit(0.05)], [0, r.range(0, TAU), 0], () => {
      b.cyl(wood, 0.012, 0.012, 0.1, 6, [0, 0.012, 0], [0, 0, HP]);
      b.cyl(dk, 0.003, 0.003, 0.12, 4, [0.11, 0.012, 0], [0, 0, HP]);
    });
  can(b, rust, 0.06, 0.14, [0.8, H, -0.2], 12);
  for (let i = 0; i < 6; i++) b.cyl(dk, 0.002, 0.002, 0.06, 3, [0.8 + r.jit(0.03), H + 0.15, -0.2 + r.jit(0.03)], [r.jit(0.4), 0, r.jit(0.4)]);
  b.lathe(rust, [[0, 0], [0.05, 0], [0.052, 0.008], [0.052, 0.08], [0.04, 0.1], [0.012, 0.115], [0, 0.118]], 10, [0.85, H, 0.12]);
  b.tube(rust, [[0.85, H + 0.11, 0.12], [0.87, H + 0.16, 0.14], [0.89, H + 0.21, 0.17]], [0.006, 0.004, 0.0025], 5);
  for (let i = 0; i < 5; i++) b.cyl(dk, 0.007, 0.007, 0.006, 6, [r.range(-0.7, -0.1), H + 0.003, r.range(-0.2, 0.25)]);
  // lower shelf junk
  can(b, rust, 0.085, 0.19, [-0.6, 0.192, 0.05], 14);
  can(b, rust, 0.085, 0.19, [-0.4, 0.192, -0.1], 14);
  b.box(dk, 0.3, 0.2, 0.18, [0.3, 0.292, 0.0], [0, r.jit(0.2), 0], { c: 0.01 });
  for (const s of [-1, 1]) b.cyl(rust, 0.012, 0.012, 0.025, 8, [0.3 + s * 0.09, 0.405, 0.0]);
  b.box(wood, 0.35, 0.18, 0.25, [0.72, 0.282, -0.05], [0, r.jit(0.3), 0], { c: 0.008 });
  b.col([-L / 2 - 0.01, 0, -D / 2], [L / 2 + 0.01, H + 0.02, D / 2]);
  b.col([-L / 2 + 0.1, H, vz - 0.14], [-L / 2 + 0.44, H + 0.17, vz + 0.24]);
};

// ---------------------------------------------------------------- bookshelf
BUILDERS.bookshelf = (b) => {
  const r = b.r;
  const W = 0.9, D = 0.3, H = 1.9, t = 0.02;
  const wood = 'woodBeam';
  const books = [M('cloth', { color: 0x5e2a24 }), M('cloth', { color: 0x34402e }), M('cloth', { color: 0x6e5c40 })];
  for (const s of [-1, 1]) b.box(wood, t, H, D, [s * (W / 2 - t / 2), H / 2, 0], null, { c: 0.004 });
  b.box(wood, W + 0.03, 0.03, D + 0.025, [0, H - 0.015, 0.008], null, { c: 0.008 });
  b.box(wood, W + 0.05, 0.03, D + 0.035, [0, H + 0.012, 0.012], null, { c: 0.01 });
  b.box(wood, W - 2 * t, 0.07, 0.02, [0, 0.035, D / 2 - 0.02]);
  b.box(wood, W - 2 * t, H - 0.03, 0.01, [0, (H - 0.03) / 2, -D / 2 + 0.005]);
  const ys = [0.08, 0.44, 0.8, 1.16, 1.52, H - 0.03];
  for (let i = 0; i < ys.length - 1; i++) b.box(wood, W - 2 * t, t, D - 0.012, [0, ys[i] - t / 2, 0.004], [0, 0, r.jit(0.004)], { c: 0.003 });
  for (let si = 0; si < ys.length - 1; si++) {
    const y = ys[si];
    const clear = ys[si + 1] - y - t - 0.01;
    const density = r.chance(0.3) ? 0.45 : 1;
    let x = -W / 2 + t + 0.004;
    const xEnd = W / 2 - t - 0.01;
    let guard = 0;
    while (x < xEnd - 0.02 && guard++ < 80) {
      const k = r.next();
      if (k > density) {
        x += r.range(0.04, 0.14);
        continue;
      }
      const mat = r.pick(books);
      const bd = r.range(0.15, 0.23);
      const zc = -D / 2 + 0.012 + bd / 2 + r.range(0, 0.03);
      if (k < 0.08 * density && x < xEnd - 0.26) {
        let yy = y;
        const n = r.int(2, 4);
        for (let q = 0; q < n; q++) {
          const bw = r.range(0.15, 0.24), bh = r.range(0.022, 0.04);
          b.box(mat === books[0] && q % 2 ? books[1] : r.pick(books), bw, bh, bd, [x + 0.13 + r.jit(0.01), yy + bh / 2, zc], [0, r.jit(0.1), 0], { c: 0.003 });
          yy += bh;
        }
        x += 0.27;
        continue;
      }
      const bw = r.range(0.018, 0.05), bh = r.range(0.17, Math.min(0.31, clear));
      if (x + bw > xEnd) break;
      if (k < 0.14 * density && x > -W / 2 + 0.1) {
        const a = r.range(0.2, 0.45);
        b.box(mat, bw, bh, bd, [x + (bh * Math.sin(a)) / 2 + (bw * Math.cos(a)) / 2, y + (bh * Math.cos(a)) / 2 + (bw * Math.sin(a)) / 2, zc], [0, 0, -a], { c: 0.003 });
        x += bh * Math.sin(a) + bw + r.range(0.03, 0.1);
        continue;
      }
      b.box(mat, bw, bh, bd, [x + bw / 2, y + bh / 2, zc], [0, r.jit(0.03), 0], { c: 0.003 });
      x += bw + r.range(0, 0.004);
    }
  }
  b.col([-W / 2, 0, -D / 2], [W / 2, H + 0.03, D / 2]);
};

// ---------------------------------------------------------------- radio (field radio set)
BUILDERS.radio = (b) => {
  const r = b.r;
  const case_ = 'paintGreen', dk = 'metalDark', pl = 'blackPlastic', ch = 'chrome';
  const W = 0.38, H = 0.24, D = 0.26;
  b.box(case_, W, H, D, [0, H / 2, 0], null, { c: 0.012 });
  for (const s of [-1, 1]) b.box(case_, W + 0.008, 0.02, D + 0.008, [0, s > 0 ? H - 0.03 : 0.03, 0], null, { c: 0.006 });
  const fz = D / 2;
  b.box(dk, W - 0.04, H - 0.07, 0.01, [0, H / 2, fz + 0.002], null, { c: 0.003 });
  const knobs = [[-0.13, 0.15, 0.02], [-0.06, 0.15, 0.016], [0.1, 0.08, 0.022], [0.15, 0.08, 0.014], [-0.13, 0.07, 0.014]];
  for (const [x, y, kr] of knobs) {
    b.cyl(pl, kr, kr * 1.1, 0.018, 10, [x, y, fz + 0.016], [HP, 0, 0]);
    b.box(ch, 0.003, kr * 0.8, 0.003, [x, y + kr * 0.4, fz + 0.026], null, { c: 0 });
  }
  b.box(ch, 0.13, 0.05, 0.006, [0.08, 0.16, fz + 0.009], null, { c: 0.002 });
  b.box(pl, 0.115, 0.036, 0.004, [0.08, 0.16, fz + 0.012], null, { c: 0 });
  for (let i = 0; i < 3; i++) {
    b.cyl(ch, 0.007, 0.007, 0.006, 8, [-0.01 + i * 0.03, 0.075, fz + 0.01], [HP, 0, 0]);
    b.cyl(ch, 0.002, 0.003, 0.022, 5, [-0.01 + i * 0.03, 0.08, fz + 0.02], [HP - 0.5, 0, 0]);
  }
  for (const s of [-1, 1]) {
    b.tube(dk, [[s * (W / 2), 0.08, -0.07], [s * (W / 2 + 0.03), 0.09, -0.06], [s * (W / 2 + 0.03), 0.09, 0.06], [s * (W / 2), 0.08, 0.07]], 0.006, 5);
    b.box(dk, 0.012, 0.04, 0.03, [s * (W / 2 + 0.004), H - 0.06, 0], null, { c: 0.002 });
  }
  b.cyl(dk, 0.014, 0.018, 0.03, 8, [0.14, H + 0.015, -0.08]);
  const bend = r.range(0.05, 0.25);
  b.tube(dk, [[0.14, H + 0.02, -0.08], [0.15, H + 0.4, -0.08 - bend * 0.2], [0.17, H + 0.75, -0.08 - bend]], [0.004, 0.003, 0.0022], 4);
  b.sph(dk, 0.006, [0.17, H + 0.755, -0.08 - bend], null, { ws: 6, hs: 4 });
  // handset + coiled cord
  const hx = W / 2 + 0.1;
  b.grp([hx, 0.03, 0.02], [0, r.jit(0.4), 0], () => {
    b.tube(pl, smoothPts([[-0.09, 0, 0], [-0.05, 0.01, 0], [0.05, 0.01, 0], [0.09, 0, 0]], 6), 0.017, 7, { capStart: true });
    b.cyl(pl, 0.028, 0.022, 0.03, 10, [-0.095, 0.0, 0], [0, 0, HP]);
    b.cyl(pl, 0.028, 0.022, 0.03, 10, [0.095, 0.0, 0], [0, 0, -HP]);
    b.box(dk, 0.03, 0.012, 0.012, [0, 0.03, 0], null, { c: 0.002 });
  });
  const coil = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    const a = t * TAU * 9;
    const cx = lerp(W / 2 - 0.02, hx - 0.07, t), cy = 0.05 + Math.sin(t * PI) * 0.03;
    coil.push([cx, cy + Math.cos(a) * 0.012, 0.05 + Math.sin(a) * 0.012]);
  }
  b.tube(pl, coil, 0.0025, 3, { capEnd: false });
};

// ---------------------------------------------------------------- lantern (kerosene hurricane lantern, anchors.flame)
BUILDERS.lantern = (b, o) => {
  const r = b.r;
  const red = 'paintRed', dk = 'metalDark';
  b.lathe(red, [[0, 0], [0.07, 0], [0.078, 0.006], [0.08, 0.02], [0.078, 0.045], [0.06, 0.058], [0.035, 0.064], [0, 0.066]], 14);
  b.cyl(dk, 0.012, 0.012, 0.016, 8, [0.05, 0.065, 0.02]);
  b.cyl(dk, 0.032, 0.036, 0.022, 10, [0, 0.075, 0]);
  b.cyl(dk, 0.004, 0.004, 0.03, 5, [0.03, 0.078, 0], [0, 0, HP]);
  b.cyl(dk, 0.008, 0.008, 0.004, 8, [0.046, 0.078, 0], [0, 0, HP]);
  b.lathe('glass', [[0.03, 0.084], [0.047, 0.1], [0.057, 0.13], [0.054, 0.165], [0.04, 0.19], [0.029, 0.2]], 12);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + 0.4;
    const pts = [[0.034, 0.084], [0.06, 0.1], [0.069, 0.13], [0.066, 0.165], [0.05, 0.19], [0.036, 0.203]].map(([rr, y]) => [Math.cos(a) * rr, y, Math.sin(a) * rr]);
    b.tube(dk, pts, 0.0022, 3, { capEnd: false });
  }
  b.add(dk, new THREE.TorusGeometry(0.068, 0.0025, 3, 16), [0, 0.13, 0], [HP, 0, 0]);
  b.add(dk, new THREE.TorusGeometry(0.05, 0.0025, 3, 14), [0, 0.19, 0], [HP, 0, 0]);
  b.lathe(red, [[0.03, 0.2], [0.05, 0.205], [0.053, 0.214], [0.042, 0.228], [0.024, 0.246], [0.022, 0.258], [0.026, 0.262], [0, 0.266]], 12);
  for (const s of [-1, 1]) b.tube(red, smoothPts([[s * 0.068, 0.05, 0], [s * 0.086, 0.09, 0], [s * 0.088, 0.18, 0], [s * 0.052, 0.214, 0]], 8), 0.0055, 5);
  const fold = r.chance(0.5) ? r.range(-1.2, 1.2) : 0;
  const bail = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * PI;
    bail.push([Math.cos(a) * 0.088, 0.2 + Math.sin(a) * 0.12 * Math.cos(fold), Math.sin(a) * 0.12 * Math.sin(fold)]);
  }
  b.tube(dk, bail, 0.0022, 3, { capEnd: false });
  // the flame: its own variant of the bulb material, so kerosene keeps burning when the generator dies
  if (o.lit !== false) b.lathe(M('bulb', { emissive: 0xffa84e }), [[0, 0.086], [0.007, 0.095], [0.009, 0.108], [0.005, 0.125], [0, 0.138]], 6);
  b.anchor('flame', [0, 0.115, 0]);
};

// ---------------------------------------------------------------- bucket
BUILDERS.bucket = (b, o) => {
  const r = b.r;
  const m = 'rustyMetal';
  const tipped = o.tipped ?? r.chance(0.3);
  const H = 0.3, R = 0.145;
  const build = () => {
    b.lathe(m, bucketProfile(R, H), 16, null, null, { deform: dentDeform(r, 1, 0.012), weld: false });
    for (const s of [-1, 1]) b.box(m, 0.006, 0.035, 0.03, [s * (R + 0.006), H - 0.03, 0], null, { c: 0.001 });
    const fold = r.range(-1.3, 1.3);
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * PI;
      pts.push([Math.cos(a) * (R + 0.01), H - 0.025 + Math.sin(a) * 0.15 * Math.cos(fold), Math.sin(a) * 0.15 * Math.sin(fold)]);
    }
    b.tube(m, pts, 0.0028, 4, { capEnd: false });
  };
  if (tipped) {
    b.alignGround = true;
    b.grp(null, [0, r.range(0, TAU), 0], () => b.grp([0, 0, 0], [HP - 0.12, 0, 0], build));
  } else build();
};

// ---------------------------------------------------------------- sandbags (low curved wall, convex toward +Z)
BUILDERS.sandbags = (b) => {
  const r = b.r;
  const burlap = M('cloth', { color: r.pick([0x8a7a58, 0x7e7256, 0x857a60]) });
  const R = 2.2, bagL = 0.56, bagW = 0.33, bagH = 0.175;
  const step = (bagL - 0.03) / R;
  const counts = [6, 5, r.int(0, 1)];
  const groups = [[], [], []];
  for (let li = 0; li < 3; li++) {
    const n = counts[li];
    for (let k = 0; k < n; k++) {
      const a = (k - (n - 1) / 2) * step + r.jit(0.02);
      const x = R * Math.sin(a), z = R * Math.cos(a) - R + r.jit(0.02) + (li === 2 ? -0.02 : 0);
      const y = li * (bagH - 0.035);
      const len = bagL * r.range(0.93, 1.05);
      const sd = r.range(0, 50);
      const tieSide = r.chance(0.5) ? 1 : -1;
      b.soft(burlap, len, bagH, bagW, 0.07, [6, 4, 4], [x, y + bagH / 2, z], [r.jit(0.04), a + r.jit(0.07), r.jit(0.04)], {
        deform: (v) => {
          const u = v.x / (len / 2);
          const te = smooth(0.55, 1.0, Math.abs(u));
          v.y *= 1 - 0.3 * te;
          v.z *= 1 - 0.22 * te;
          if (u * tieSide > 0.85) {
            v.y *= 0.55;
            v.z *= 0.55;
          }
          if (v.y > 0) v.y *= 1 + 0.18 * (1 - u * u);
          v.y = Math.max(v.y, -bagH / 2 + 0.004 + 0.02 * te);
          v.x += 0.006 * vnoise(v.x * 14 + sd, v.y * 14, v.z * 14);
          v.y += 0.006 * vnoise(v.x * 14, v.y * 14 + sd, v.z * 14);
          v.z += 0.006 * vnoise(v.x * 14, v.y * 14, v.z * 14 + sd);
        },
      });
      const gi = a < -0.25 ? 0 : a > 0.25 ? 2 : 1;
      groups[gi].push([x, z, y + bagH]);
    }
  }
  for (const g of groups) {
    if (!g.length) continue;
    const xs = g.map((p) => p[0]), zs = g.map((p) => p[1]), ys = g.map((p) => p[2]);
    b.col([Math.min(...xs) - 0.3, 0, Math.min(...zs) - 0.2], [Math.max(...xs) + 0.3, Math.max(...ys), Math.max(...zs) + 0.2]);
  }
};

// ---------------------------------------------------------------- ammoCrate (stack of olive ammo cans)
function ammoCan(b, pos, yaw, open) {
  const L = 0.3, Hc = 0.19, Wc = 0.15;
  const g = 'paintGreen', dk = 'metalDark';
  b.grp(pos, [0, yaw, 0], () => {
    b.box(g, L, Hc - 0.02, Wc, [0, (Hc - 0.02) / 2, 0], null, { c: 0.006 });
    b.box(g, L + 0.006, 0.012, Wc + 0.006, [0, Hc - 0.026, 0], null, { c: 0.003 });
    for (const s of [-1, 1]) b.box(g, 0.006, Hc - 0.06, Wc - 0.03, [s * (L / 2 + 0.002), (Hc - 0.02) / 2, 0], null, { c: 0.002 });
    if (!open) {
      b.box(g, L + 0.004, 0.028, Wc + 0.004, [0, Hc - 0.006, 0], null, { c: 0.006 });
      b.box(g, L - 0.04, 0.006, Wc - 0.04, [0, Hc + 0.009, 0], null, { c: 0.002 });
      b.tube(dk, [[-0.07, Hc + 0.012, -0.01], [-0.07, Hc + 0.014, 0.035], [0.07, Hc + 0.014, 0.035], [0.07, Hc + 0.012, -0.01]], 0.004, 4);
      for (const s of [-1, 1]) b.box(dk, 0.016, 0.012, 0.014, [s * 0.07, Hc + 0.012, -0.012], null, { c: 0.002 });
      b.box(dk, 0.01, 0.07, 0.05, [L / 2 + 0.008, Hc - 0.03, 0], [0, 0, 0.12], { c: 0.002 });
    } else {
      b.grp([0, Hc - 0.02, -Wc / 2], [-1.95, 0, 0], () => b.box(g, L + 0.004, 0.028, Wc + 0.004, [0, 0.014, Wc / 2], null, { c: 0.006 }));
      for (let i = 0; i < 10; i++) {
        const x = -0.126 + i * 0.028;
        b.cyl('brass', 0.0065, 0.0065, 0.058, 6, [x, Hc - 0.035, -0.006], [HP, 0, 0]);
        b.cyl(dk, 0.0005, 0.006, 0.02, 6, [x, Hc - 0.035, 0.032], [HP, 0, 0]);
      }
      b.box(dk, 0.29, 0.012, 0.02, [0, Hc - 0.042, -0.01], null, { c: 0 });
    }
  });
}
BUILDERS.ammoCrate = (b) => {
  const r = b.r;
  for (let i = 0; i < 3; i++) ammoCan(b, [r.jit(0.01), 0, (i - 1) * 0.16], r.jit(0.03), false);
  const n1 = r.int(1, 2);
  for (let i = 0; i < n1; i++) ammoCan(b, [(i - (n1 - 1) / 2) * 0.165 + r.jit(0.01), 0.19, r.jit(0.02)], HP + r.jit(0.06), false);
  let top = 0.38;
  if (r.chance(0.4)) {
    ammoCan(b, [r.jit(0.02), 0.38, r.jit(0.03)], r.jit(0.3), false);
    top = 0.57;
  }
  const loose = r.chance(0.6);
  if (loose) ammoCan(b, [0.36, 0, 0.1 + r.jit(0.05)], HP + r.jit(0.4), true);
  b.col([-0.17, 0, -0.25], [0.17, top, 0.25]);
  if (loose) b.col([0.26, 0, -0.1], [0.46, 0.2, 0.3]);
};

// ---------------------------------------------------------------- debrisPile (broken planks, lath & plaster chunks) — no colliders
BUILDERS.debrisPile = (b) => {
  const r = b.r;
  const wood = 'woodFloor', pl = 'plaster';
  b.add(pl, new THREE.SphereGeometry(0.62, 14, 5, 0, TAU, 0, HP), [0, -0.01, 0], null, {
    scl: [1, 0.16, 0.85],
    deform: (v) => {
      const k = 1 + 0.25 * fbm(v.x * 3, 0, v.z * 3);
      v.x *= k;
      v.z *= k;
      v.y *= 0.7 + 0.5 * vnoise(v.x * 4, 1, v.z * 4);
    },
  });
  const nP = r.int(5, 8);
  for (let i = 0; i < nP; i++) {
    const len = r.range(0.4, 1.3), w = r.range(0.08, 0.16), t = r.range(0.018, 0.026);
    const a = r.range(0, TAU), d = r.range(0, 0.45);
    const lean = r.chance(0.4) ? r.range(0.1, 0.35) : r.jit(0.04);
    b.add(wood, plankGeo(len, w, t, r, r.chance(0.6), r.chance(0.8)), [Math.cos(a) * d, t / 2 + 0.02 + (lean > 0.05 ? (len / 2) * Math.sin(lean) * 0.8 : i * 0.012), Math.sin(a) * d], [HP + r.jit(0.08), r.range(0, TAU), lean, 'YZX'], { grain: 0 });
  }
  for (let i = 0; i < r.int(5, 9); i++) {
    const a = r.range(0, TAU), d = r.range(0, 0.55);
    b.box('woodBeam', r.range(0.3, 0.9), 0.008, 0.035, [Math.cos(a) * d, 0.03 + r.range(0, 0.06), Math.sin(a) * d], [r.jit(0.15), r.range(0, TAU), r.jit(0.15)], { c: 0.002 });
  }
  const nC = r.int(9, 15);
  for (let i = 0; i < nC; i++) {
    const s = r.range(0.04, 0.14);
    const a = r.range(0, TAU), d = r.range(0.05, 0.75);
    const sd = r.range(0, 30);
    b.add(pl, new THREE.IcosahedronGeometry(s, 0), [Math.cos(a) * d, s * 0.25 + (d < 0.4 ? 0.04 : 0), Math.sin(a) * d], [r.jit(0.3), r.range(0, TAU), r.jit(0.3)], {
      scl: [1, r.range(0.25, 0.5), r.range(0.6, 1)],
      deform: (v) => v.multiplyScalar(1 + 0.3 * vnoise(v.x * 30 + sd, v.y * 30, v.z * 30)),
    });
  }
};

// ---------------------------------------------------------------- mattressFloor — no colliders
BUILDERS.mattressFloor = (b) => {
  const r = b.r;
  const mat = M('fabric', { color: r.pick([0x958a72, 0x8a8068, 0x9a8c74]) });
  const blanket = M('cloth', { color: r.pick([0x4a4b3c, 0x453d36, 0x3c4040]) });
  const L = 1.9, W = 0.9, H = 0.15;
  const sd = r.range(0, 40);
  b.soft(mat, L, H, W, 0.05, [12, 3, 6], [0, H / 2, 0], null, {
    deform: (v) => {
      const top = (v.y + H / 2) / H;
      v.y -= 0.03 * (1 - (2 * v.x / L) ** 2) * (1 - (2 * v.z / W) ** 2) * top;
      v.y += 0.015 * fbm(v.x * 4 + sd, 0, v.z * 4) * top;
      const cu = smooth(0.7, 1, Math.abs(v.x) / (L / 2)) * smooth(0.6, 1, Math.abs(v.z) / (W / 2));
      v.y += 0.03 * cu * top;
      v.y = Math.max(v.y, -H / 2);
    },
  });
  if (r.chance(0.75)) {
    // blanket lying across, one part slid over the long edge onto the floor
    const side = r.chance(0.5) ? 1 : -1;
    const cx = r.jit(0.35), cz = side * 0.22, bl = r.range(1.0, 1.3);
    const e0 = W / 2 - 0.04;
    b.add(blanket, new THREE.BoxGeometry(bl, 0.01, 1.05, 16, 1, 16), null, null, {
      deform: (v) => {
        const X = cx + v.x, Zs = side * (cz + v.z);
        const hump = 0.03 * Math.max(0, fbm(X * 3 + sd, 5, Zs * 3)) + 0.012 * vnoise(X * 9, 1, Zs * 9 + sd);
        const [pz, py, nz, ny] = drapePath(Zs - e0, H + 0.012, e0, 0.008, 0.05);
        const off = v.y + 0.006 + hump;
        v.set(X + 0.01 * vnoise(Zs * 6, 2, sd), py + ny * off, side * (pz + nz * off));
      },
    });
  }
};

// ---------------------------------------------------------------- bottles (cluster) — no colliders
BUILDERS.bottles = (b) => {
  const r = b.r;
  const glass = M('glass', { color: r.pick([0x5a3a1a, 0x2f4a22, 0x6a6a5a]) });
  const n = r.int(4, 8);
  for (let i = 0; i < n; i++) {
    const kind = r.pick(['wine', 'beer', 'beer', 'flask', 'jug']);
    const prof = bottleProfile(kind);
    const a = r.range(0, TAU), d = r.range(0, 0.22);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const mode = r.next();
    if (mode < 0.25) {
      const R = kind === 'jug' ? 0.064 : kind === 'wine' ? 0.036 : 0.031;
      b.grp([x, R, z], [0, r.range(0, TAU), HP], () => b.lathe(glass, prof, 10, [0, -0.12, 0]));
    } else if (mode < 0.38) {
      const cut = r.range(0.06, 0.12);
      const p2 = prof.filter((p) => p[1] < cut);
      p2.push([p2[p2.length - 1][0], cut]);
      b.lathe(glass, p2, 10, [x, 0, z], null, {
        deform: (v) => {
          if (v.y > cut - 0.001) v.y -= 0.03 * Math.max(0, vnoise(v.x * 60, 0, v.z * 60));
        },
      });
      for (let k = 0; k < 3; k++) b.add(glass, new THREE.CircleGeometry(0.02, 3), [x + r.jit(0.12), 0.002, z + r.jit(0.12)], [-HP, 0, r.range(0, TAU), 'XYZ']);
    } else b.lathe(glass, prof, 10, [x, 0, z]);
  }
  const cx = r.range(-0.25, 0.25), cz = r.range(-0.25, 0.25);
  b.cyl('rustyMetal', 0.033, 0.033, 0.115, 10, [cx, 0.035, cz], [HP, r.range(0, TAU), 0], {
    deform: (v) => {
      v.y *= 0.55 + 0.45 * Math.abs(v.y) / 0.06;
      v.x *= 1 + 0.2 * vnoise(v.x * 50, v.y * 50, v.z * 50);
    },
    weld: false,
  });
};

// ---------------------------------------------------------------- papers (scattered on the floor) — no colliders
BUILDERS.papers = (b) => {
  const r = b.r;
  const paper = M('fabric', { color: 0xc4bca6 }, false);
  const news = M('fabric', { color: 0xa8a290 }, false);
  const n = r.int(6, 11);
  for (let i = 0; i < n; i++) {
    const big = r.chance(0.2);
    const w = big ? 0.38 : 0.21, h = big ? 0.29 : 0.297;
    const a = r.range(0, TAU), d = r.range(0, 0.6);
    const curl = r.range(-0.08, 0.12), ca = r.range(0, TAU), sd = r.range(0, 30);
    b.add(big ? news : paper, new THREE.PlaneGeometry(w, h, 4, 4), [Math.cos(a) * d, 0.003 + i * 0.0012, Math.sin(a) * d], [-HP, 0, r.range(0, TAU), 'XYZ'], {
      deform: (v) => {
        const k = v.x * Math.cos(ca) + v.y * Math.sin(ca);
        v.z += Math.max(0, curl * k * k * 6 + 0.006 * vnoise(v.x * 20 + sd, v.y * 20, 0));
      },
    });
  }
  for (let i = 0; i < r.int(1, 3); i++) {
    const a = r.range(0, TAU), d = r.range(0.1, 0.7), s = r.range(0.035, 0.05), sd = r.range(0, 30);
    b.add(paper, new THREE.IcosahedronGeometry(s, 1), [Math.cos(a) * d, s * 1.15, Math.sin(a) * d], [r.next(), r.next(), 0], {
      deform: (v) => v.multiplyScalar(1 + 0.35 * vnoise(v.x * 60 + sd, v.y * 60, v.z * 60)),
    });
  }
};

// ============================================================================ props: architecture-ish
// ---------------------------------------------------------------- hangingLamp (origin = ceiling point, cable down -Y; anchors.bulb)
BUILDERS.hangingLamp = (b, o) => {
  b.noShadow = true;
  const L = Math.max(0.05, o.cableLength ?? 0.8);
  const pl = 'blackPlastic', outer = 'paintGreen', inner = 'porcelain';
  b.lathe(pl, [[0, -0.024], [0.012, -0.024], [0.03, -0.012], [0.04, -0.004], [0.04, 0], [0, 0]], 12);
  const y0 = -0.02, y1 = -L;
  const turns = Math.max(1, (y0 - y1) / 0.05);
  const nS = Math.max(6, Math.ceil(turns * 5));
  for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let i = 0; i <= nS; i++) {
      const t = i / nS;
      const a = t * turns * TAU + k * PI;
      pts.push([Math.cos(a) * 0.0027, lerp(y0, y1, t), Math.sin(a) * 0.0027]);
    }
    b.tube(pl, pts, 0.0025, 3, { capEnd: false });
  }
  const sy = y1;
  b.lathe(pl, [[0, sy - 0.07], [0.017, sy - 0.07], [0.019, sy - 0.062], [0.019, sy - 0.022], [0.016, sy - 0.012], [0.008, sy - 0.004], [0.005, sy + 0.003], [0, sy + 0.003]], 12);
  b.cyl(pl, 0.003, 0.003, 0.02, 5, [0.024, sy - 0.03, 0], [0, 0, HP]);
  b.box(pl, 0.004, 0.014, 0.008, [0.036, sy - 0.03, 0], null, { c: 0 });
  const ny = sy - 0.035;
  const prof = [[0.17, -0.12], [0.158, -0.108], [0.124, -0.083], [0.082, -0.052], [0.048, -0.024], [0.03, -0.008], [0.022, 0.002], [0.02, 0.012]];
  b.lathe(outer, prof.map(([rr, y]) => [rr, ny + y]), 18);
  b.lathe(inner, prof.slice().reverse().map(([rr, y]) => [Math.max(0, rr - 0.003), ny + y - 0.003]), 18);
  b.add(outer, new THREE.TorusGeometry(0.171, 0.0045, 4, 18), [0, ny - 0.12, 0], [HP, 0, 0]);
  const by = ny - 0.028;
  b.cyl(pl, 0.0135, 0.0135, 0.026, 10, [0, by - 0.012, 0]);
  const bulbProf = [[0, -0.125], [0.012, -0.123], [0.024, -0.113], [0.0305, -0.096], [0.03, -0.078], [0.024, -0.058], [0.016, -0.041], [0.013, -0.027], [0, -0.025]];
  b.lathe('bulb', bulbProf.map(([rr, y]) => [rr, by + y]), 12);
  for (const s of [-1, 1]) b.tube('bulb', [[s * 0.004, by - 0.028, 0], [s * 0.006, by - 0.06, 0], [s * 0.009, by - 0.078, 0]], 0.0008, 3);
  const fil = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    fil.push([lerp(-0.009, 0.009, t), by - 0.078 - Math.sin(t * PI) * 0.006 + (i % 2 ? 0.0015 : 0), (i % 2 ? 0.0015 : -0.0015)]);
  }
  b.tube('bulb', fil, 0.0009, 3);
  b.anchor('bulb', [0, by - 0.078, 0]);
};

// ---------------------------------------------------------------- wireCable (opts.from / opts.to in local space, catenary sag)
BUILDERS.wireCable = (b, o) => {
  const r = b.r;
  b.noShadow = true;
  const toV = (p, d) => (!p ? new V3(...d) : p.isVector3 ? p.clone() : new V3(p[0], p[1], p[2]));
  const A = toV(o.from, [0, 3, 0]), B = toV(o.to, [3, 3, 0]);
  const len = A.distanceTo(B);
  const sag = o.sag ?? (0.03 + 0.035 * len) * r.range(0.75, 1.3);
  const n = Math.max(8, Math.ceil(len * 6));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = A.clone().lerp(B, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  b.tube(o.material ?? 'rubber', pts, o.radius ?? 0.005, 5, { capEnd: false });
};

// ---------------------------------------------------------------- boardedWindow (origin = opening centre, planks in XY at z≈0.03)
BUILDERS.boardedWindow = (b, o) => {
  const r = b.r;
  const w = o.w ?? 1.0, h = o.h ?? 1.2;
  const wood = 'woodFloor', t = 0.024;
  const nailPair = (cx, cy, ang, lx, pw, zf) => {
    const c = Math.cos(ang), s = Math.sin(ang);
    for (const ly of [-pw * 0.25, pw * 0.25]) nailZ(b, cx + lx * c - ly * s + r.jit(0.006), cy + lx * s + ly * c + r.jit(0.006), zf);
  };
  let y = -h / 2 - 0.03 + r.range(0, 0.05);
  let i = 0;
  while (y < h / 2 - 0.02 && i < 24) {
    const pw = r.range(0.11, 0.17);
    const gap = r.chance(0.35) ? r.range(0.04, 0.13) : r.range(0.0, 0.02);
    const cy = y + pw / 2;
    const ang = r.jit(0.09);
    const len = w + r.range(0.22, 0.42);
    const cx = r.jit(0.05);
    const z = 0.03 + (i % 2) * 0.026;
    const mode = r.next();
    if (mode < 0.1) {
      const side = r.chance(0.5) ? -1 : 1;
      const l2 = r.range(0.14, 0.3);
      plank(b, wood, l2, pw, t, [side * (w / 2 + 0.15 - l2 / 2), cy, z], [0, 0, r.jit(0.08)], { breakL: side > 0, breakR: side < 0 });
      nailPair(side * (w / 2 + 0.08), cy, 0, 0, pw, z + t / 2);
    } else if (mode < 0.27) {
      const side = r.chance(0.5) ? -1 : 1;
      const l2 = len * r.range(0.45, 0.72);
      const hang = r.range(0.25, 0.9);
      const px = side * (w / 2 + 0.1);
      b.grp([px, cy, z], [0, 0, side * hang], () => plank(b, wood, l2, pw, t, [-side * (l2 / 2 - 0.06), 0, 0], null, { breakL: side > 0, breakR: side < 0 }));
      nailZ(b, px, cy, z + t / 2);
    } else {
      const brk = r.chance(0.2);
      plank(b, wood, len, pw, t, [cx, cy, z], [0, 0, ang], { breakL: brk && r.chance(0.5), breakR: brk });
      for (const sx of [-1, 1]) nailPair(cx, cy, ang, sx * (w / 2 + 0.07), pw, z + t / 2);
    }
    y += pw + gap;
    i++;
  }
  if (r.chance(0.35)) {
    const sgn = r.chance(0.5) ? 1 : -1;
    const ww = w + 0.16;
    const len = Math.hypot(ww, h * 0.9);
    const a = sgn * Math.atan2(h * 0.9, ww);
    plank(b, wood, len, 0.13, t, [0, 0, 0.085], [0, 0, a], {});
    for (const e of [-1, 1]) nailPair(0, 0, a, e * (len / 2 - 0.08), 0.13, 0.085 + t / 2);
  }
};

// ---------------------------------------------------------------- windowFrame (origin = opening centre; double-hung sashes, broken glass)
BUILDERS.windowFrame = (b, o) => {
  const r = b.r;
  const w = o.w ?? 1.0, h = o.h ?? 1.2, depth = o.depth ?? 0.3;
  const m = paintTint(r);
  const jt = 0.03;
  for (const s of [-1, 1]) b.box(m, jt, h, depth, [s * (w / 2 - jt / 2), 0, 0], null, { c: 0.004, grain: 1 });
  b.box(m, w - 2 * jt, jt, depth, [0, h / 2 - jt / 2, 0], null, { c: 0.004 });
  b.box(m, w + 0.08, 0.035, depth + 0.07, [0, -h / 2 + 0.0175, 0.035], [0.05, 0, 0], { c: 0.006 });
  const iw = w - 2 * jt, y0 = -h / 2 + 0.035, y1 = h / 2 - jt;
  const ih = y1 - y0;
  for (const s of [-1, 1]) for (const zz of [-0.055, 0, 0.055]) b.box(m, 0.012, ih, 0.014, [s * (iw / 2 - 0.006), (y0 + y1) / 2, zz], null, { c: 0.002 });
  const sashH = ih / 2 + 0.018;
  const cols = iw > 0.95 ? 3 : 2;
  const raise = r.chance(0.35) ? r.range(0.05, sashH * 0.55) : 0;
  const sash = (yb, zc) => {
    b.grp([-iw / 2 + 0.013, yb, zc], [0, 0, r.jit(0.004)], () => {
      const panes = frameDoor(b, m, iw - 0.026, sashH, 0.034, { stile: 0.045, rail: 0.04, bottomRail: 0.06, rows: 2, cols, mid: 0.018, glass: true });
      for (const pn of panes) {
        const mode = r.pick(['full', 'full', 'hole', 'shard', 'shard', 'none', 'none']);
        if (mode !== 'none') b.add('glass', paneGeo(pn.w + 0.01, pn.h + 0.01, r, mode), [pn.x, pn.y, 0]);
      }
    });
  };
  sash(y1 - sashH, -0.027);
  sash(y0 + raise, 0.027);
  b.box('metalDark', 0.07, 0.012, 0.025, [0, y0 + sashH + raise + 0.006, 0.03], null, { c: 0.002 });
};

// ---------------------------------------------------------------- door (origin = hinge-side bottom corner, extends +X; opts.broken)
BUILDERS.door = (b, o) => {
  const r = b.r;
  const W = 0.95, H = 2.1, T = 0.045;
  const m = paintTint(r);
  const broken = !!o.broken;
  const bcol = r.int(0, 1);
  const panels = frameDoor(b, m, W, H, T, {
    stile: 0.115,
    rail: 0.11,
    bottomRail: 0.22,
    mid: 0.1,
    rows: 3,
    cols: 2,
    rowWeights: [1, 1.45, 0.62],
    skip: (pn) => broken && pn.row === 0 && pn.col === bcol,
  });
  if (broken) {
    const pn = panels.find((p) => p.row === 0 && p.col === bcol);
    for (let k = 0; k < 3; k++) {
      const l = pn.w * r.range(0.25, 0.5);
      plank(b, m, l, r.range(0.04, 0.08), T * 0.5, [pn.x + (k - 1) * pn.w * 0.3, pn.y + (k % 2 ? 0.3 : -0.3) * pn.h, -T * 0.08], [0, 0, HP + r.jit(0.5)], { breakR: true, breakL: k === 1 });
    }
  }
  const hw = 'brass';
  const kx = W - 0.065, ky = 0.95;
  for (const s of [-1, 1]) {
    const z = s * T / 2;
    b.cyl(hw, 0.026, 0.028, 0.008, 12, [kx, ky, z + s * 0.004], [HP, 0, 0]);
    b.cyl(hw, 0.008, 0.009, 0.045, 8, [kx, ky, z + s * 0.028], [HP, 0, 0]);
    b.sph(hw, 0.027, [kx, ky, z + s * 0.058], null, { ws: 10, hs: 7, scl: [1, 1, 0.85] });
    b.box(hw, 0.034, 0.1, 0.004, [kx, ky - 0.085, z + s * 0.002], null, { c: 0.001 });
  }
  for (const hy of [0.24, 1.05, 1.86]) {
    b.cyl('metalDark', 0.0085, 0.0085, 0.1, 8, [-0.004, hy, T / 2 - 0.004]);
    b.cyl('metalDark', 0.0045, 0.0045, 0.012, 6, [-0.004, hy + 0.056, T / 2 - 0.004]);
    b.box('metalDark', 0.03, 0.1, 0.003, [0.012, hy, T / 2 + 0.0015], null, { c: 0 });
  }
  b.anchor('knob', [kx, ky, T / 2 + 0.058]);
  b.col([0, 0, -0.03], [W, H, 0.03]);
};

// ---------------------------------------------------------------- railing (balustrade along +X from origin; opts.length)
BUILDERS.railing = (b, o) => {
  const r = b.r;
  const Lr = Math.max(0.3, o.length ?? 2.0), H = 0.95;
  const wood = 'woodBeam', bal = paintTint(r);
  const postS = 0.09;
  const nSeg = Math.max(1, Math.round(Lr / 1.7));
  const posts = [];
  for (let k = 0; k <= nSeg; k++) posts.push(clamp((k * Lr) / nSeg, postS / 2, Lr - postS / 2));
  for (const x of posts) {
    b.box(wood, postS, H + 0.05, postS, [x, (H + 0.05) / 2, 0], [0, r.jit(0.02), 0], { c: 0.008 });
    b.box(wood, postS + 0.03, 0.03, postS + 0.03, [x, H + 0.065, 0], null, { c: 0.008 });
    b.sph(wood, 0.035, [x, H + 0.1, 0], null, { ws: 8, hs: 6 });
    b.box(wood, postS + 0.02, 0.05, postS + 0.02, [x, 0.025, 0], null, { c: 0.006 });
  }
  const snap = Lr > 1.2 && r.chance(0.2) ? r.int(0, nSeg - 1) : -1;
  for (let k = 0; k < nSeg; k++) {
    const xa = posts[k] + postS / 2, xb = posts[k + 1] - postS / 2;
    const sl = xb - xa;
    if (k === snap) {
      const cut = sl * r.range(0.35, 0.65);
      b.grp([xa, H - 0.03, 0], [0, 0, -r.range(0.1, 0.35)], () => plank(b, wood, cut, 0.06, 0.07, [cut / 2, 0, 0], [HP, 0, 0], { breakR: true }));
      b.grp([xb, H - 0.03, 0], [0, 0, r.range(0.1, 0.35)], () => plank(b, wood, sl - cut, 0.06, 0.07, [-(sl - cut) / 2, 0, 0], [HP, 0, 0], { breakL: true }));
    } else b.box(wood, sl + 0.01, 0.06, 0.075, [(xa + xb) / 2, H - 0.03, 0], null, { c: 0.012 });
    b.box(wood, sl + 0.01, 0.045, 0.05, [(xa + xb) / 2, 0.075, 0], null, { c: 0.006 });
    const nB = Math.max(1, Math.floor(sl / 0.13));
    const sp = sl / (nB + 1);
    const bh = H - 0.06 - 0.0975;
    for (let i = 1; i <= nB; i++) {
      const x = xa + i * sp;
      const q = r.next();
      if (q < 0.1 || (k === snap && q < 0.5)) continue;
      if (q < 0.18) {
        const l = bh * r.range(0.3, 0.6);
        plank(b, bal, l, 0.035, 0.035, [x + r.jit(0.01), H - 0.06 - l / 2, 0], [0, 0, HP + r.jit(0.12)], { breakL: true });
      } else b.box(bal, 0.035, bh, 0.035, [x, 0.0975 + bh / 2, 0], [0, r.jit(0.1), q < 0.26 ? r.jit(0.08) : 0], { c: 0.005 });
    }
  }
  b.col([0, 0, -0.06], [Lr, H + 0.08, 0.06]);
};

// ---------------------------------------------------------------- supply boxes (Combat Arms style drop cases)
function supplyBox(b, kind) {
  const body = kind === 'green' ? 'paintGreen' : kind === 'red' ? 'paintRed' : M('porcelain', { color: 0xbcbeb8 });
  const glow = kind === 'green' ? 0x3dff6e : kind === 'red' ? 0xff3a22 : 0xcfe6ff;
  const TRIM = M('blackPlastic', { color: 0x333333, emissive: glow, emissiveIntensity: 1.6 }, false);
  const EMB = M('porcelain', { color: 0xd8d4c8, emissive: kind === 'red' ? 0xffd8a0 : 0xffffff, emissiveIntensity: 0.35 }, false);
  const pl = 'blackPlastic';
  const W = 0.45, D = 0.35, lowH = 0.19, lidH = 0.085, ft = 0.012;
  b.box(body, W, lowH, D, [0, ft + lowH / 2, 0], null, { c: 0.02 });
  b.box(body, W + 0.004, lidH, D + 0.004, [0, ft + lowH + 0.006 + lidH / 2, 0], null, { c: 0.024 });
  b.box(body, W - 0.08, 0.01, D - 0.08, [0, ft + lowH + 0.006 + lidH + 0.004, 0], null, { c: 0.004 });
  const sy = ft + lowH + 0.003;
  b.box(pl, W - 0.012, 0.008, D - 0.012, [0, sy, 0], null, { c: 0 });
  for (const s of [-1, 1]) {
    b.box(TRIM, W - 0.06, 0.007, 0.004, [0, sy, s * (D / 2 + 0.001)], null, { c: 0 });
    b.box(TRIM, 0.004, 0.007, D - 0.06, [s * (W / 2 + 0.001), sy, 0], null, { c: 0 });
  }
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) b.box(pl, 0.06, ft, 0.06, [sx * (W / 2 - 0.035), ft / 2, sz * (D / 2 - 0.035)], null, { c: 0.004 });
    for (const sz of [-1, 1]) b.box(body, 0.03, lowH + lidH - 0.02, 0.012, [sx * 0.19, ft + (lowH + lidH) / 2 + 0.004, sz * (D / 2 + 0.004)], null, { c: 0.004 });
    // latches
    const lx = sx * 0.11;
    b.box(pl, 0.045, 0.03, 0.01, [lx, sy - 0.025, D / 2 + 0.006], null, { c: 0.003 });
    b.box(pl, 0.04, 0.05, 0.012, [lx, sy + 0.008, D / 2 + 0.012], [0.12, 0, 0], { c: 0.004 });
    b.box(pl, 0.03, 0.012, 0.012, [lx, sy + 0.03, D / 2 + 0.004], null, { c: 0.003 });
    // side handles
    b.tube(pl, [[sx * (W / 2 + 0.003), 0.14, -0.06], [sx * (W / 2 + 0.018), 0.13, -0.05], [sx * (W / 2 + 0.018), 0.13, 0.05], [sx * (W / 2 + 0.003), 0.14, 0.06]], 0.006, 5);
  }
  const top = ft + lowH + 0.006 + lidH + 0.009;
  for (const s of [-1, 1]) b.box(pl, 0.025, 0.02, 0.03, [s * 0.075, top + 0.01, 0], null, { c: 0.004 });
  b.cyl(pl, 0.011, 0.011, 0.16, 8, [0, top + 0.022, 0], [0, 0, HP]);
  if (kind === 'green') {
    b.box(EMB, 0.13, 0.004, 0.042, [0, top + 0.001, -0.09], null, { c: 0 });
    b.box(EMB, 0.042, 0.004, 0.13, [0, top + 0.001, -0.09], null, { c: 0 });
    b.box(EMB, 0.09, 0.03, 0.004, [0, ft + lowH * 0.5, D / 2 + 0.002], null, { c: 0 });
    b.box(EMB, 0.03, 0.09, 0.004, [0, ft + lowH * 0.5, D / 2 + 0.002], null, { c: 0 });
  } else {
    const em = kind === 'red' ? EMB : pl;
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.035;
      b.cyl(em, 0.009, 0.009, 0.06, 8, [x, ft + lowH * 0.42, D / 2 + 0.01]);
      b.cyl(em, 0.0005, 0.009, 0.025, 8, [x, ft + lowH * 0.42 + 0.042, D / 2 + 0.01]);
    }
    if (kind === 'red') b.box(em, 0.16, 0.012, 0.004, [0, ft + lowH * 0.12 + 0.01, D / 2 + 0.002], null, { c: 0 });
  }
  b.anchor('top', [0, top + 0.04, 0]);
}
BUILDERS.supplyBoxGreen = (b) => supplyBox(b, 'green');
BUILDERS.supplyBoxRed = (b) => supplyBox(b, 'red');
BUILDERS.supplyBoxWhite = (b) => supplyBox(b, 'white');

// ============================================================================ props: exterior
function boxBetween(b, mat, p0, p1, w, h, o = {}) {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dx, dz), pitch = -Math.asin(clamp(dy / len, -1, 1));
  return b.box(mat, w, h, len, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2], [pitch, yaw, 0], o);
}
function pointAlong(pts, s) {
  const f = clamp(s, 0, 1) * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  return pts[i].clone().lerp(pts[i + 1], f - i);
}

// ---------------------------------------------------------------- pineTreeDead (9-14 m, sparse drooping needle cards)
BUILDERS.pineTreeDead = (b) => {
  const r = b.r;
  const bark = 'bark', fol = 'foliage';
  const H = r.range(9, 14);
  const baseR = r.range(0.2, 0.28) * (H / 11);
  const lx = r.jit(0.3), lz = r.jit(0.3), sd = r.range(0, 50);
  const nT = 16;
  const trunk = [];
  for (let i = 0; i <= nT; i++) {
    const t = i / nT;
    trunk.push(new V3(lx * t * t + 0.07 * vnoise(t * 5 + sd, 1, 0), i === 0 ? -0.25 : t * H, lz * t * t + 0.07 * vnoise(t * 5 + sd, 2, 0)));
  }
  const radAt = (t) => baseR * Math.pow(Math.max(0, 1 - t), 0.85) + 0.012 + (t < 0.06 ? baseR * 0.5 * (1 - t / 0.06) ** 2 : 0);
  b.tube(bark, trunk, (i) => radAt(i / nT), 10);
  const trunkAt = (y) => pointAlong(trunk, y / H);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + r.jit(0.4);
    const c = Math.cos(a), s = Math.sin(a);
    const d = r.range(0.5, 0.9);
    b.tube(bark, smoothPts([[c * baseR * 0.5, 0.5, s * baseR * 0.5], [c * (baseR + 0.12), 0.16, s * (baseR + 0.12)], [c * (baseR + d * 0.6), 0.02, s * (baseR + d * 0.6)], [c * (baseR + d), -0.08, s * (baseR + d)]], 6), (i, n) => lerp(baseR * 0.45, 0.02, i / (n - 1)), 6);
  }
  const card = (p, dir, w, h) => {
    const X = dir.clone();
    X.y -= 0.35;
    X.normalize();
    const up = new V3(0, 1, 0);
    const Y = up.clone().sub(X.clone().multiplyScalar(X.dot(up))).normalize();
    Y.applyAxisAngle(X, r.jit(0.7));
    const Z = new V3().crossVectors(X, Y);
    const g = new THREE.PlaneGeometry(w, h);
    g.translate(w / 2 - 0.1, -h * 0.35, 0);
    b.add(fol, g, null, null, { uv: 'keep', matrix: new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(p) });
    const Y2 = Y.clone().applyAxisAngle(X, HP), Z2 = new V3().crossVectors(X, Y2);
    const g2 = new THREE.PlaneGeometry(w, h * 0.8);
    g2.translate(w / 2 - 0.1, 0, 0);
    b.add(fol, g2, null, null, { uv: 'keep', matrix: new THREE.Matrix4().makeBasis(X, Y2, Z2).setPosition(p) });
  };
  let y = r.range(1.6, 2.4);
  let guard = 0;
  while (y < H - 0.7 && guard++ < 40) {
    const t = y / H;
    const nb = r.int(3, 5);
    const a0 = r.range(0, TAU);
    for (let k = 0; k < nb; k++) {
      const a = a0 + (k / nb) * TAU + r.jit(0.4);
      const dead = t < 0.45 ? r.chance(0.75) : t < 0.7 ? r.chance(0.3) : r.chance(0.12);
      let L = ((1 - t) * 3.0 + 0.35) * r.range(0.7, 1.15);
      if (dead) L *= r.range(0.15, 0.55);
      const dir = new V3(Math.cos(a), 0, Math.sin(a));
      const p0 = trunkAt(y).addScaledVector(dir, radAt(t) * 0.5);
      const up = dead ? r.range(-0.25, 0.12) : r.range(0.05, 0.3);
      const droop = dead ? 0.05 : r.range(0.2, 0.45);
      const pts = [];
      for (let q = 0; q <= 4; q++) {
        const s = q / 4;
        pts.push(p0.clone().addScaledVector(dir, L * s).add(new V3(r.jit(0.05) * s, (up * s - droop * s * s) * L, r.jit(0.05) * s)));
      }
      const r0 = Math.min(radAt(t) * 0.45, 0.018 + L * 0.016);
      b.tube(bark, pts, (i, n) => lerp(r0, 0.004, i / (n - 1)), 5);
      if (dead || L < 0.3) continue;
      for (let q = 0; q < 2; q++) {
        const s0 = r.range(0.3, 0.8);
        const tp = pointAlong(pts, s0);
        const td = dir.clone().applyAxisAngle(new V3(0, 1, 0), r.jit(1.2));
        const tl = r.range(0.2, 0.5) * Math.min(1, L);
        b.tube(bark, [tp, tp.clone().addScaledVector(td, tl * 0.5).add(new V3(0, -0.05, 0)), tp.clone().addScaledVector(td, tl).add(new V3(0, -0.15 * tl, 0))], [0.008, 0.005, 0.002], 3);
      }
      const nC = Math.max(2, Math.round(L * 2 + 0.5));
      for (let c = 0; c < nC; c++) {
        const s = r.range(0.25, 0.95);
        const cw = r.range(0.7, 1.2) * Math.min(1, 0.45 + L * 0.3);
        card(pointAlong(pts, s), dir.clone().applyAxisAngle(new V3(0, 1, 0), r.jit(0.3)), cw, cw * r.range(0.5, 0.75));
      }
    }
    y += r.range(0.45, 0.8);
  }
  const top = trunk[nT];
  b.tube(bark, [top, top.clone().add(new V3(r.jit(0.1), 0.6, r.jit(0.1)))], [0.014, 0.003], 4);
  const cr = baseR + 0.06;
  b.col([-cr, 0, -cr], [cr, Math.min(H, 6), cr]);
};

// ---------------------------------------------------------------- deadTree (gnarled leafless deciduous tree)
BUILDERS.deadTree = (b) => {
  const r = b.r;
  const bark = 'bark';
  const trunkH = r.range(2.2, 3.4), R0 = r.range(0.24, 0.36);
  let count = 0;
  const branch = (p0, dir, len, rad0, depth) => {
    if (count++ > 170) return;
    const nSeg = depth === 0 ? 7 : depth < 3 ? 5 : 3;
    const pts = [p0.clone()];
    const d = dir.clone();
    let p = p0.clone();
    for (let i = 1; i <= nSeg; i++) {
      d.add(new V3(r.jit(0.35), r.jit(0.2) + (depth === 0 ? 0.05 : depth < 3 ? 0.06 : -0.08), r.jit(0.35))).normalize();
      p = p.clone().addScaledVector(d, len / nSeg);
      pts.push(p);
    }
    const rad1 = rad0 * (depth === 0 ? 0.72 : 0.55);
    const radial = [9, 7, 5, 4, 3, 3][Math.min(depth, 5)];
    b.tube(bark, pts, (i, n) => lerp(rad0, rad1, i / (n - 1)) * (depth === 0 && i === 0 ? 1.25 : 1), radial, { capEnd: depth >= 3 });
    if (depth >= 4 || rad1 < 0.012) {
      for (let q = 0; q < 2; q++) {
        const td = d.clone().add(new V3(r.jit(0.8), r.jit(0.5), r.jit(0.8))).normalize();
        b.tube(bark, [p, p.clone().addScaledVector(td, len * 0.35)], [Math.max(0.004, rad1 * 0.8), 0.002], 3);
      }
      return;
    }
    const nc = depth === 0 ? r.int(3, 4) : r.int(2, 3);
    for (let c = 0; c < nc; c++) {
      const cd = d.clone();
      const axis = new V3().crossVectors(cd, new V3(r.jit(1), r.jit(1), r.jit(1)).normalize());
      if (axis.lengthSq() < 1e-4) axis.set(1, 0, 0);
      axis.normalize();
      cd.applyAxisAngle(axis, r.range(0.35, 0.85) * (c === 0 ? 0.5 : 1));
      cd.y += depth === 0 ? 0.3 : 0.12;
      cd.normalize();
      branch(p.clone(), cd, len * r.range(0.62, 0.8), rad1 * (c === 0 ? 0.9 : 0.72), depth + 1);
    }
    if (depth <= 2 && r.chance(0.5)) {
      const mid = pts[Math.floor(pts.length / 2)];
      const sdir = new V3(r.jit(1), r.range(0.1, 0.6), r.jit(1)).normalize();
      branch(mid.clone(), sdir, len * 0.45, rad0 * 0.4, depth + 2);
    }
  };
  branch(new V3(0, -0.2, 0), new V3(r.jit(0.12), 1, r.jit(0.12)).normalize(), trunkH, R0, 0);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * TAU + r.jit(0.5);
    const c = Math.cos(a), s = Math.sin(a), d = r.range(0.5, 1.0);
    b.tube(bark, smoothPts([[c * R0 * 0.4, 0.55, s * R0 * 0.4], [c * (R0 + 0.12), 0.15, s * (R0 + 0.12)], [c * (R0 + d * 0.6), 0.0, s * (R0 + d * 0.6)], [c * (R0 + d), -0.1, s * (R0 + d)]], 6), (i, n) => lerp(R0 * 0.5, 0.025, i / (n - 1)), 6);
  }
  b.col([-R0 - 0.05, 0, -R0 - 0.05], [R0 + 0.05, trunkH, R0 + 0.05]);
};

// ---------------------------------------------------------------- fence (3 m broken farm fence along +X)
BUILDERS.fence = (b, o) => {
  const r = b.r;
  const L = o.length ?? 3.0;
  const wood = 'woodFloor';
  const posts = [0.06, L / 2, L - 0.06];
  for (const x of posts) {
    const ph = r.range(1.15, 1.3);
    b.box(wood, 0.11, ph + 0.3, 0.11, [x, (ph + 0.3) / 2 - 0.3, 0], [r.jit(0.05), r.jit(0.3), r.jit(0.05)], { c: 0.014, grain: 1 });
  }
  const ys = [0.35, 0.7, 1.05];
  const z = 0.07;
  for (let s = 0; s < 2; s++) {
    const xa = posts[s], xb = posts[s + 1];
    const len = xb - xa + 0.1;
    for (const y of ys) {
      const q = r.next();
      if (q < 0.1) continue;
      const fromA = r.chance(0.5);
      const px = fromA ? xa : xb;
      const dirS = fromA ? 1 : -1;
      if (q < 0.3) {
        const drop = Math.asin(clamp((y - 0.03) / (len - 0.06), 0, 0.99));
        b.grp([px, y, z], [0, 0, -dirS * drop], () => plank(b, wood, len, 0.12, 0.028, [dirS * (len / 2 - 0.05), 0, 0], null, {}));
        nailZ(b, px, y, z + 0.014);
      } else if (q < 0.42) {
        const l2 = len * r.range(0.4, 0.7);
        b.grp([px, y, z], [0, 0, -dirS * r.range(0.05, 0.3)], () => plank(b, wood, l2, 0.12, 0.028, [dirS * (l2 / 2 - 0.05), 0, 0], null, { breakL: !fromA, breakR: fromA }));
        nailZ(b, px, y, z + 0.014);
      } else {
        plank(b, wood, len, 0.12, 0.028, [(xa + xb) / 2, y + r.jit(0.02), z], [0, 0, r.jit(0.02)], {});
        for (const nx of [xa, xb]) for (const dy of [-0.03, 0.03]) nailZ(b, nx + r.jit(0.01), y + dy, z + 0.014);
      }
    }
  }
  b.col([0, 0, -0.08], [L, 1.2, 0.1]);
};

// ---------------------------------------------------------------- carWreck (rusted 1970s pickup; hero prop)
BUILDERS.carWreck = (b) => {
  const r = b.r;
  const body = 'rustyMetal', dk = 'metalDark', chrome = 'chrome', rub = 'rubber', glass = 'glass', seat = M('fabric', { color: 0x4c3c2e });
  const tireR = 0.37, rimR = 0.21, tireW = 0.24;
  const wheels = [[-1, 1.62], [1, 1.62], [-1, -1.62], [1, -1.62]];
  const flats = wheels.map(() => (r.chance(0.5) ? r.range(0.05, 0.1) : r.range(0.0, 0.03)));
  flats[0] = Math.max(flats[0], 0.06);
  const tProf = tireProfile(tireR, rimR, tireW);
  const rimProf = [[0, -0.02], [0.2, -0.1], [0.213, -0.1], [0.216, -0.09], [0.216, 0.095], [0.212, 0.105], [0.198, 0.1], [0.18, 0.06], [0.1, 0.045], [0.07, 0.058], [0.06, 0.075], [0, 0.082]];
  wheels.forEach(([sx, z], i) => {
    const flat = flats[i];
    b.grp([sx * 0.8, tireR - flat, z], [0, r.range(0, TAU), -sx * HP, 'XZY'], () => {
      const lim = tireR - flat;
      b.lathe(rub, tProf, 20, null, null, {
        deform: (v) => {
          const d = sx > 0 ? v.x : -v.x;
          if (d > lim) {
            const ex = d - lim;
            v.x = sx > 0 ? lim : -lim;
            v.y *= 1 + ex * 2.5;
          }
        },
      });
      b.lathe(dk, rimProf, 18);
      if (i !== 1 && r.chance(0.6)) b.lathe(chrome, [[0.13, 0.085], [0.12, 0.1], [0.08, 0.112], [0, 0.118]], 14);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU;
        b.cyl(chrome, 0.008, 0.008, 0.02, 6, [Math.cos(a) * 0.05, 0.085, Math.sin(a) * 0.05]);
      }
    });
  });
  const avgF = (flats[0] + flats[1] + flats[2] + flats[3]) / 4;
  const pitch = Math.atan((flats[0] + flats[1] - flats[2] - flats[3]) / 2 / 3.24);
  const roll = Math.atan((flats[0] + flats[2] - flats[1] - flats[3]) / 2 / 1.6);
  b.push([0, -avgF, 0], [pitch, 0, roll]);
  // chassis
  for (const s of [-1, 1]) {
    b.box(dk, 0.08, 0.16, 4.9, [s * 0.46, 0.46, 0], null, { c: 0.01 });
    b.box(dk, 0.07, 0.06, 1.2, [s * 0.46, 0.34, -1.62], null, { c: 0.01 });
    b.box(dk, 0.07, 0.06, 1.0, [s * 0.46, 0.34, 1.62], null, { c: 0.01 });
  }
  for (const z of [1.62, -1.62]) b.cyl(dk, 0.045, 0.045, 1.5, 8, [0, 0.37, z], [0, 0, HP]);
  b.sph(dk, 0.14, [0, 0.37, -1.62], null, { ws: 10, hs: 7, scl: [1, 1, 0.8] });
  b.cyl(dk, 0.035, 0.035, 1.5, 6, [0, 0.4, 0.05], [HP, 0, 0]);
  b.tube(body, smoothPts([[0.3, 0.45, 1.1], [0.35, 0.33, 0.4], [0.36, 0.32, -1.0], [0.36, 0.32, -2.3], [0.36, 0.35, -2.58]], 10), 0.028, 6, { capEnd: false });
  // front fenders
  const arch = (zc, from, to, out) => {
    const R = 0.47, a0 = Math.asin((0.5 - 0.37) / R);
    for (let i = 0; i <= 10; i++) {
      const a = lerp(PI - a0, a0, i / 10);
      out.push([zc + R * Math.cos(a), 0.37 + R * Math.sin(a)]);
    }
  };
  const fr = [[0.97, 0.5]];
  arch(1.62, 0, 0, fr);
  fr.push([2.46, 0.52], [2.52, 0.62], [2.53, 0.95], [2.49, 1.03], [2.3, 1.06], [1.4, 1.075], [0.97, 1.08]);
  for (const s of [-1, 1]) {
    b.add(body, sideGeo(fr, null, 0.2, 0.014), [s * 0.87, 0, 0]);
    b.cyl(dk, 0.48, 0.48, 0.2, 12, [s * 0.87, 0.37, 1.62], [0, 0, HP], { open: true, ts: 0, tl: PI, invert: true });
  }
  // grille / headlights / bumper
  const gz = 2.49;
  b.box(chrome, 1.52, 0.05, 0.05, [0, 1.0, gz], null, { c: 0.01 });
  b.box(chrome, 1.52, 0.05, 0.05, [0, 0.56, gz], null, { c: 0.01 });
  for (const s of [-1, 1]) b.box(chrome, 0.05, 0.47, 0.05, [s * 0.74, 0.78, gz], null, { c: 0.01 });
  for (let i = 0; i < 6; i++) b.box(dk, 0.95, 0.018, 0.03, [0, 0.62 + i * 0.065, gz - 0.01], null, { c: 0 });
  b.box(dk, 1.44, 0.42, 0.04, [0, 0.78, gz - 0.06], null, { c: 0 });
  const brokenLamp = r.int(0, 1);
  [-1, 1].forEach((s, i) => {
    b.add(chrome, new THREE.TorusGeometry(0.085, 0.016, 5, 16), [s * 0.6, 0.8, gz + 0.03]);
    b.lathe(dk, [[0.085, 0], [0.07, -0.045], [0.035, -0.075], [0, -0.082]], 14, [s * 0.6, 0.8, gz + 0.03], [HP, 0, 0]);
    if (i !== brokenLamp) b.add(glass, new THREE.CircleGeometry(0.082, 14), [s * 0.6, 0.8, gz + 0.036]);
    else b.add(glass, new THREE.CircleGeometry(0.082, 5, r.range(0, TAU), r.range(1.2, 2.2)), [s * 0.6, 0.8, gz + 0.036]);
  });
  b.box(chrome, 2.0, 0.17, 0.12, [0, 0.52, 2.63], [0, r.jit(0.04), r.jit(0.05)], { c: 0.02 });
  for (const s of [-1, 1]) b.box(dk, 0.08, 0.08, 0.2, [s * 0.46, 0.5, 2.5], null, { c: 0.005 });
  // hood (maybe open) + engine bay
  const hoodOpen = r.chance(0.6);
  const hoodA = hoodOpen ? r.range(0.8, 1.05) : r.range(0, 0.03);
  b.grp([0, 1.075, 0.99], [-hoodA, 0, 0], () => {
    const hg = new THREE.BoxGeometry(1.56, 0.035, 1.5, 6, 1, 6);
    hg.translate(0, 0, 0.75);
    b.add(body, hg, null, null, { weld: false, deform: (v) => (v.y += 0.03 * (1 - (v.x / 0.78) ** 2) - 0.02 * Math.max(0, vnoise(v.x * 4, 0, v.z * 4))) });
  });
  if (hoodOpen) {
    const fy = 1.075 + 1.5 * Math.sin(hoodA), fz = 0.99 + 1.5 * Math.cos(hoodA);
    b.cyl(dk, 0.006, 0.006, Math.hypot(fy - 1.0, fz - 2.3), 5, [0.66, (fy + 1.0) / 2, (fz + 2.3) / 2], [Math.atan2(fz - 2.3, fy - 1.0), 0, 0, 'XYZ']);
    for (const s of [-1, 1]) b.box(dk, 0.02, 0.45, 1.35, [s * 0.76, 0.78, 1.68], null, { c: 0 });
    b.box(dk, 1.5, 0.55, 0.03, [0, 0.8, 0.98], null, { c: 0 });
    b.box(dk, 0.55, 0.4, 0.75, [0, 0.74, 1.62], null, { c: 0.03 });
    for (const s of [-1, 1]) b.box(chrome, 0.12, 0.07, 0.68, [s * 0.2, 0.97, 1.62], [0, 0, s * 0.45], { c: 0.02 });
    b.box(dk, 0.2, 0.08, 0.5, [0, 0.98, 1.62], null, { c: 0.01 });
    b.cyl(chrome, 0.19, 0.19, 0.07, 16, [0, 1.06, 1.6]);
    b.cyl(dk, 0.02, 0.02, 0.04, 6, [0, 1.1, 1.6]);
    b.box(dk, 1.2, 0.5, 0.07, [0, 0.78, 2.36], null, { c: 0.01 });
    b.cyl(dk, 0.05, 0.05, 0.05, 8, [0, 0.78, 2.26], [HP, 0, 0]);
    for (let k = 0; k < 4; k++) b.box(dk, 0.36, 0.08, 0.006, [0, 0.78, 2.24], [0.3, 0, (k * PI) / 4 + r.jit(0.1)], { c: 0 });
    b.box(rub, 0.25, 0.2, 0.17, [0.52, 0.88, 2.1], [0, 0.1, 0], { c: 0.01 });
    b.tube(rub, smoothPts([[0.2, 0.96, 2.32], [0.2, 1.0, 2.15], [0.15, 0.95, 1.98]], 8), 0.024, 6);
    b.tube(rub, smoothPts([[-0.25, 0.62, 2.32], [-0.3, 0.6, 2.1], [-0.22, 0.62, 1.98]], 8), 0.024, 6);
  }
  // cab
  const cab = [[-0.55, 0.5], [0.97, 0.5], [0.97, 1.1], [0.62, 1.78], [-0.42, 1.8], [-0.55, 1.72]];
  const win = [[0.8, 1.16], [0.56, 1.72], [-0.36, 1.73], [-0.46, 1.66], [-0.46, 1.16]];
  const mirrorLost = r.int(-1, 1);
  for (const s of [-1, 1]) {
    b.add(body, sideGeo(cab, [win], 0.05, 0.008), [s * 0.945, 0, 0]);
    for (const zz of [-0.36, 0.92]) b.box(dk, 0.004, 0.6, 0.006, [s * 0.972, 0.8, zz], null, { c: 0 });
    b.box(dk, 0.004, 0.006, 1.28, [s * 0.972, 0.52, 0.28], null, { c: 0 });
    b.box(chrome, 0.012, 0.025, 0.12, [s * 0.976, 1.04, -0.26], null, { c: 0.004 });
    if (mirrorLost !== s) {
      b.cyl(chrome, 0.008, 0.008, 0.2, 5, [s * 1.03, 1.2, 0.85], [0, 0, s * 1.2]);
      b.box(chrome, 0.025, 0.17, 0.11, [s * 1.12, 1.27, 0.85], null, { c: 0.008 });
    }
    // side glass
    const mode = s < 0 ? 'shard' : r.pick(['none', 'shard', 'hole']);
    if (mode !== 'none') {
      let g;
      if (mode === 'shard') {
        const pts = [[-0.46, 1.16], [0.8, 1.16]];
        for (let k = 0; k <= 6; k++) pts.push([lerp(0.72, -0.46, k / 6), 1.16 + r.range(0.03, 0.3) * (k % 2 ? 1 : 0.5)]);
        g = shapeGeo(pts);
      } else {
        const cz = 0.15 + r.jit(0.1), cy = 1.42 + r.jit(0.05);
        const hole = [];
        for (let k = 0; k < 9; k++) {
          const a = -(k / 9) * TAU;
          const rr = (k % 2 ? 0.08 : 0.2) * r.range(0.6, 1);
          hole.push([cz + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.9]);
        }
        g = shapeGeo(win, [hole]);
      }
      g.rotateY(-HP);
      b.add(glass, g, [s * 0.935, 0, 0]);
    }
  }
  b.box(body, 1.94, 0.05, 1.07, [0, 1.8, 0.1], null, { c: 0.03 });
  const rearHole = rrPoints(1.1, 0.38, 0.06, 0.06, 3, 1.24).reverse();
  b.add(body, extrudeGeo([[-0.95, 0.5], [0.95, 0.5], [0.95, 1.73], [-0.95, 1.73]], [rearHole], 0.04, 0.006), [0, 0, -0.53]);
  const rm = r.pick(['full', 'hole', 'shard', 'none']);
  if (rm !== 'none') b.add(glass, paneGeo(1.12, 0.4, r, rm), [0, 1.43, -0.53]);
  b.box(body, 1.9, 0.04, 0.3, [0, 1.1, 0.83], [-0.08, 0, 0], { c: 0.008 });
  b.box(dk, 1.8, 0.18, 0.3, [0, 1.0, 0.72], null, { c: 0.03 });
  b.box(dk, 1.88, 0.03, 1.48, [0, 0.52, 0.2], null, { c: 0 });
  b.cyl(dk, 0.025, 0.025, 0.36, 6, [-0.4, 1.1, 0.585], [-0.93, 0, 0]);
  b.grp([-0.4, 1.2, 0.45], [0.6435, 0, 0], () => {
    b.add(rub, new THREE.TorusGeometry(0.2, 0.015, 5, 18));
    b.box(rub, 0.38, 0.025, 0.012, [0, 0, 0], null, { c: 0 });
  });
  b.soft(seat, 1.7, 0.16, 0.5, 0.05, [8, 2, 4], [0, 0.72, -0.2], null, {
    deform: (v) => {
      if (v.y > 0) v.y -= 0.03 * Math.max(0, 1 - Math.hypot(v.x + 0.4, v.z) / 0.35);
      v.y += 0.008 * vnoise(v.x * 10, v.y * 10, v.z * 10);
    },
  });
  b.soft(seat, 1.7, 0.55, 0.14, 0.05, [8, 4, 2], [0, 1.02, -0.42], [-0.15, 0, 0], { deform: (v) => (v.z += 0.008 * vnoise(v.x * 10, v.y * 10, v.z * 10)) });
  // windshield
  b.grp([0, 1.1, 0.965], [-0.475, 0, 0], () => {
    b.add(glass, paneGeo(1.78, 0.7, r, r.pick(['hole', 'hole', 'shard', 'full'])), [0, 0.37, 0]);
    b.box(rub, 1.82, 0.022, 0.022, [0, 0.012, 0], null, { c: 0 });
    b.box(rub, 1.82, 0.022, 0.022, [0, 0.73, 0], null, { c: 0 });
    for (const s of [-1, 1]) b.box(dk, 0.45, 0.012, 0.01, [s * 0.35, 0.06, 0.015], [0, 0, s * 0.25 + r.jit(0.1)], { c: 0 });
  });
  // bed
  b.box(body, 1.8, 0.04, 1.88, [0, 0.62, -1.56], null, { c: 0.005 });
  for (let i = 0; i < 6; i++) b.box(body, 0.04, 0.012, 1.84, [-0.7 + i * 0.28, 0.645, -1.56], null, { c: 0.003 });
  const bed = [[-2.5, 0.5]];
  arch(-1.62, 0, 0, bed);
  bed.push([-0.6, 0.5], [-0.6, 1.08], [-2.5, 1.08]);
  for (const s of [-1, 1]) {
    b.add(body, sideGeo(bed, null, 0.05, 0.008), [s * 0.945, 0, 0]);
    b.box(body, 0.1, 0.035, 1.92, [s * 0.925, 1.095, -1.55], null, { c: 0.01 });
    b.cyl(body, 0.42, 0.42, 0.26, 12, [s * 0.78, 0.64, -1.62], [0, 0, HP], { ts: 0, tl: PI });
    b.cyl(dk, 0.48, 0.48, 0.05, 12, [s * 0.92, 0.37, -1.62], [0, 0, HP], { open: true, ts: 0, tl: PI, invert: true });
    b.box(dk, 0.06, 0.18, 0.05, [s * 0.92, 0.88, -2.52], null, { c: 0.005 });
    b.add(glass, new THREE.PlaneGeometry(0.05, 0.16), [s * 0.92, 0.88, -2.548], [0, PI, 0]);
  }
  b.box(body, 1.84, 0.46, 0.05, [0, 0.85, -0.63], null, { c: 0.006 });
  const tg = r.pick(['closed', 'open', 'open', 'missing']);
  if (tg === 'closed') b.box(body, 1.84, 0.46, 0.05, [0, 0.85, -2.5], null, { c: 0.006 });
  else if (tg === 'open') b.grp([0, 0.62, -2.5], [-(HP + r.range(0, 0.25)), 0, 0], () => b.box(body, 1.84, 0.46, 0.05, [0, 0.23, 0], null, { c: 0.006 }));
  b.box(chrome, 1.9, 0.14, 0.12, [0, 0.47, -2.63], [0, r.jit(0.03), r.jit(0.03)], { c: 0.015 });
  b.box(body, 0.3, 0.15, 0.006, [0, 0.66, -2.53], [0.1, 0, r.jit(0.1)], { c: 0 });
  // junk in the bed
  b.lathe(rub, tireProfile(tireR, rimR, tireW), 16, [0.3 + r.jit(0.1), 0.64 + tireW / 2 * 0.82, -1.95], [r.jit(0.1), 0, r.jit(0.1)]);
  b.box(body, 0.3, 0.35, 0.18, [-0.55, 0.82, -0.9], [0, r.jit(0.4), 0], { c: 0.02 });
  b.pop();
  b.col([-1.0, 0, 0.95], [1.0, 1.15, 2.72]);
  b.col([-1.0, 0, -0.56], [1.0, 1.85, 0.95]);
  b.col([-1.0, 0, -2.72], [1.0, 1.12, -0.56]);
};

// ---------------------------------------------------------------- woodPile (stacked firewood + chopping block with axe)
BUILDERS.woodPile = (b) => {
  const r = b.r;
  const bark = 'bark', end = 'crateWood', dk = 'metalDark';
  const L = 1.6, len = 0.45;
  const log = (x, y, z, rad, l, rot) => {
    b.grp([x, y, z], rot, () => {
      if (r.chance(0.4)) {
        b.cyl(bark, rad, rad * 0.97, l, 7, null, [HP, 0, 0], { open: true, ts: 0, tl: PI });
        b.box(end, 0.003, 2 * rad, l, [0, 0, 0], null, { c: 0 });
        for (const s of [-1, 1]) b.add(end, new THREE.CircleGeometry(rad, 5, -HP, PI), [0, 0, (s * l) / 2], [0, s > 0 ? 0 : PI, 0]);
      } else {
        b.cyl(bark, rad, rad * 0.97, l, 9, null, [HP, 0, 0], { open: true });
        for (const s of [-1, 1]) b.add(end, new THREE.CircleGeometry(rad, 9), [0, 0, (s * l) / 2], [0, s > 0 ? 0 : PI, 0]);
      }
    });
  };
  let y = 0;
  for (let row = 0; row < 5; row++) {
    let x = -L / 2 + r.range(0, 0.04);
    let maxR = 0.05;
    while (x < L / 2 - 0.05) {
      const rad = r.range(0.055, 0.09);
      if (x + 2 * rad > L / 2) break;
      log(x + rad, y + rad, r.jit(0.03), rad, len * r.range(0.9, 1.1), [r.jit(0.03), r.jit(0.06), r.range(0, TAU)]);
      x += 2 * rad + r.range(0, 0.012);
      maxR = Math.max(maxR, rad);
    }
    y += maxR * 1.7;
  }
  for (const s of [-1, 1]) b.cyl(bark, 0.04, 0.045, y + 0.3, 7, [s * (L / 2 + 0.06), (y + 0.3) / 2 - 0.2, 0]);
  for (let i = 0; i < 3; i++) {
    const rad = r.range(0.05, 0.08);
    log(r.range(-0.6, 0.4), rad, r.range(0.35, 0.7), rad, len, [0, r.range(0, TAU), 0, 'YXZ']);
  }
  const bx = 1.0, bz = 0.55;
  b.cyl(bark, 0.22, 0.24, 0.45, 12, [bx, 0.225, bz], null, { open: true });
  b.add(end, new THREE.CircleGeometry(0.22, 12), [bx, 0.45, bz], [-HP, 0, 0]);
  b.grp([bx + 0.05, 0.45, bz], [0, r.range(0, TAU), 0], () => {
    b.box(dk, 0.03, 0.12, 0.17, [0, 0.03, 0], [0.25, 0, 0], { c: 0.004 });
    b.cyl(end, 0.017, 0.02, 0.75, 7, [0, 0.2, -0.33], [-1.1, 0, 0]);
  });
  b.col([-L / 2 - 0.1, 0, -0.28], [L / 2 + 0.1, y, 0.28]);
  b.col([bx - 0.25, 0, bz - 0.25], [bx + 0.25, 0.46, bz + 0.25]);
};

// ---------------------------------------------------------------- hayBale (square bale, straw)
BUILDERS.hayBale = (b, o) => {
  const r = b.r;
  const lite = !!o?.lite; // stacked bales (barn.js): fewer loose stalks, coarser mesh
  const straw = o?.straw ?? 'straw', twine = M('cloth', { color: 0x6e6040 }); // straw texture (textures.js genStraw)
  const L = 1.0, H = 0.4, D = 0.48, sd = r.range(0, 40);
  b.soft(straw, L, H, D, 0.06, lite ? [5, 3, 3] : [8, 4, 4], [0, H / 2, 0], [0, 0, 0], {
    deform: (v) => {
      const n = 0.012 * fbm(v.x * 9 + sd, v.y * 9, v.z * 9);
      v.x += n;
      v.z += n;
      v.y += n * 0.6 + (v.y > 0 ? 0.012 * (1 - (2 * v.x / L) ** 2) : 0);
      v.y = Math.max(v.y, -H / 2);
    },
  });
  for (const x of [-0.25, 0.25]) {
    const ring = rrRing(D + 0.01, H + 0.01, 0.07, 0, 3).map((p) => [x + r.jit(0.01), H / 2 + p[2], p[0]]);
    ring.push(ring[0]);
    b.tube(twine, ring, 0.0045, 4, { capEnd: false });
  }
  for (let i = 0, n = lite ? 8 : 26; i < n; i++) {
    const face = r.int(0, 2);
    const p = face === 0 ? [r.jit(L / 2 - 0.05), H + 0.005, r.jit(D / 2 - 0.03)] : face === 1 ? [r.jit(L / 2 - 0.05), r.range(0.05, H - 0.03), (r.chance(0.5) ? 1 : -1) * (D / 2 + 0.005)] : [(r.chance(0.5) ? 1 : -1) * (L / 2 + 0.005), r.range(0.05, H - 0.03), r.jit(D / 2 - 0.05)];
    b.cyl(straw, 0.0015, 0.0025, r.range(0.06, 0.16), 3, p, [r.range(0.5, 1.4) * (r.chance(0.5) ? 1 : -1), r.range(0, TAU), r.jit(1.2)]);
  }
  b.col([-L / 2, 0, -D / 2], [L / 2, H, D / 2]);
};

// ---------------------------------------------------------------- wheelbarrow
BUILDERS.wheelbarrow = (b, o) => {
  const r = b.r;
  const rust = 'rustyMetal', wood = 'woodBeam', rub = 'rubber';
  const tipped = o.tipped ?? r.chance(0.25);
  if (tipped) {
    b.alignGround = true;
    b.push([0, 0.35, 0], [0, 0, HP * 0.92]);
  }
  const T = (w, d, rr, y, cz) => rrRing(w, d, rr, y, 3, 0, cz);
  const rings = [T(0.4, 0.46, 0.12, 0.34, 0.02), T(0.58, 0.7, 0.18, 0.5, 0.08), T(0.68, 0.84, 0.2, 0.62, 0.12), T(0.7, 0.86, 0.21, 0.635, 0.12), T(0.68, 0.84, 0.2, 0.647, 0.12), T(0.65, 0.81, 0.19, 0.628, 0.12), T(0.55, 0.66, 0.17, 0.5, 0.08), T(0.37, 0.43, 0.11, 0.357, 0.02)];
  b.add(rust, loftGeo(rings, -1, 1), null, null, { weld: false, deform: dentDeform(r, 2, 0.02) });
  for (const s of [-1, 1]) {
    boxBetween(b, wood, [s * 0.19, 0.25, 0.55], [s * 0.29, 0.6, -0.85], 0.045, 0.045, { c: 0.008 });
    b.cyl(wood, 0.022, 0.02, 0.13, 7, [s * 0.295, 0.61, -0.9], [HP - 0.33, 0, 0]);
    boxBetween(b, rust, [s * 0.24, 0.45, -0.3], [s * 0.27, 0.0, -0.38], 0.03, 0.012, { c: 0.002 });
    boxBetween(b, rust, [s * 0.24, 0.4, -0.3], [s * 0.15, 0.33, 0.05], 0.025, 0.01, { c: 0.002 });
    boxBetween(b, rust, [s * 0.08, 0.205, 0.62], [s * 0.2, 0.35, 0.3], 0.03, 0.012, { c: 0.002 });
    b.box(rust, 0.05, 0.012, 0.08, [s * 0.275, 0.006, -0.39], null, { c: 0.002 });
  }
  b.add(rub, new THREE.TorusGeometry(0.16, 0.045, 8, 18), [0, 0.205, 0.62], [0, HP, 0]);
  b.cyl(rust, 0.12, 0.12, 0.05, 14, [0, 0.205, 0.62], [0, 0, HP]);
  b.cyl(rust, 0.035, 0.035, 0.1, 8, [0, 0.205, 0.62], [0, 0, HP]);
  b.cyl(rust, 0.01, 0.01, 0.2, 6, [0, 0.205, 0.62], [0, 0, HP]);
  if (tipped) b.pop();
  b.col([-0.36, 0, -0.95], [0.36, tipped ? 0.8 : 0.66, 0.8]);
};

// ---------------------------------------------------------------- tireStack
BUILDERS.tireStack = (b) => {
  const r = b.r;
  const n = r.int(3, 5);
  const prof = tireProfile(0.33, 0.2, 0.2);
  let y = 0.1;
  for (let i = 0; i < n; i++) {
    const sd = r.range(0, 50);
    b.lathe('rubber', prof, 18, [r.jit(0.04), y, r.jit(0.04)], [r.jit(0.04), r.range(0, TAU), r.jit(0.04)], {
      deform: (v) => {
        const k = 1 + 0.012 * vnoise(v.x * 8 + sd, v.y * 8, v.z * 8);
        v.x *= k;
        v.z *= k;
      },
    });
    y += 0.2;
  }
  const lean = r.range(0.25, 0.4);
  b.lathe('rubber', prof, 18, [0.56, 0.33 * Math.cos(lean) + 0.1 * Math.sin(lean), r.jit(0.1)], [0, r.jit(0.3), HP + lean, 'YXZ']);
  b.col([-0.38, 0, -0.38], [0.38, y - 0.1, 0.38]);
  b.col([0.38, 0, -0.35], [0.72, 0.62, 0.35]);
};

// ---------------------------------------------------------------- powerPole (anchors.wire0..2 = insulator tops)
BUILDERS.powerPole = (b) => {
  const r = b.r;
  const wood = 'woodBeam', dk = 'metalDark', ins = M('porcelain', { color: 0x7a5a44 }), wire = 'rubber';
  const H = 8.2 + r.jit(0.3);
  b.push(null, [r.jit(0.03), 0, r.jit(0.03)]);
  b.cyl(wood, 0.11, 0.15, H + 0.3, 10, [0, (H - 0.3) / 2, 0], null, { hs: 3 });
  b.cyl(wood, 0.03, 0.11, 0.06, 10, [0, H + 0.03, 0]);
  const ay = H - 0.55;
  b.box(wood, 2.3, 0.1, 0.09, [0, ay, 0.155], null, { c: 0.01 });
  b.cyl(dk, 0.01, 0.01, 0.4, 6, [0, ay, 0.06], [HP, 0, 0]);
  for (const s of [-1, 1]) boxBetween(b, dk, [0, ay - 0.62, 0.12], [s * 0.62, ay - 0.05, 0.155], 0.04, 0.006, { c: 0 });
  const insProf = [[0, 0], [0.04, 0], [0.05, 0.015], [0.046, 0.03], [0.036, 0.04], [0.04, 0.055], [0.03, 0.07], [0.026, 0.09], [0.032, 0.1], [0.026, 0.115], [0, 0.12]];
  const xs = [-1.05, -0.4, 1.05];
  xs.forEach((x, i) => {
    b.cyl(dk, 0.012, 0.012, 0.1, 6, [x, ay + 0.1, 0.155]);
    b.lathe(ins, insProf, 12, [x, ay + 0.1, 0.155]);
    b.anchor('wire' + i, b.pt(x, ay + 0.2, 0.155));
  });
  if (r.chance(0.5)) {
    const ty = ay - 1.5;
    b.cyl(dk, 0.2, 0.2, 0.55, 14, [0, ty, 0.36]);
    b.cyl(dk, 0.21, 0.21, 0.04, 14, [0, ty + 0.29, 0.36]);
    b.box(dk, 0.08, 0.5, 0.14, [0, ty, 0.2], null, { c: 0.005 });
    for (const s of [-1, 1]) {
      b.lathe(ins, insProf.map(([rr, yy]) => [rr * 0.7, yy * 0.8]), 10, [s * 0.1, ty + 0.31, 0.36]);
      b.tube(wire, smoothPts([[s * 0.1, ty + 0.4, 0.36], [s * 0.3, ty + 0.9, 0.3], [xs[s > 0 ? 2 : 1], ay + 0.18, 0.155]], 10), 0.005, 4);
    }
  }
  for (let y = 2.4, k = 0; y < ay - 0.4; y += 0.42, k++) b.cyl(dk, 0.009, 0.009, 0.2, 5, [(k % 2 ? 1 : -1) * 0.17, y, 0], [0, 0, HP]);
  b.cyl(dk, 0.004, 0.004, ay - 0.2, 4, [0, (ay - 0.2) / 2, -0.13]);
  b.box(dk, 0.08, 0.1, 0.004, [0, 1.8, 0.14], null, { c: 0 });
  if (r.chance(0.6)) b.tube(wire, smoothPts([[1.05, ay + 0.18, 0.155], [1.25, ay - 1.2, 0.35], [1.15, ay - 3.5, 0.6], [1.0, 1.2, 0.9], [1.3, 0.03, 1.5], [2.0, 0.03, 1.9]], 32), 0.006, 4);
  b.pop();
  b.col([-0.17, 0, -0.17], [0.17, H, 0.17]);
};

// ---------------------------------------------------------------- well (stone well, wooden roof, windlass, bucket)
BUILDERS.well = (b) => {
  const r = b.r;
  const stone = M('concrete', { color: 0x9a9488 }), wood = 'woodBeam', roof = 'roof', iron = 'rustyMetal', dark = M('metalDark', { color: 0x0a0a0a });
  const R = 0.72, depth = 0.22, ch = 0.17;
  for (let c = 0; c < 4; c++) {
    const n = 12;
    for (let k = 0; k < n; k++) {
      const a = ((k + (c % 2) * 0.5 + r.jit(0.12)) / n) * TAU;
      const arc = (TAU * R) / n - 0.025;
      const sd = r.range(0, 99);
      b.box(stone, arc * r.range(0.88, 1.0), ch - 0.015, depth * r.range(0.9, 1.1), [Math.cos(a) * R, c * ch + ch / 2, Math.sin(a) * R], [r.jit(0.03), -a - HP, r.jit(0.03)], {
        c: 0.025,
        weld: false,
        deform: (v) => {
          v.x += 0.01 * vnoise(v.x * 20 + sd, v.y * 20, v.z * 20);
          v.y += 0.008 * vnoise(v.x * 20, v.y * 20 + sd, v.z * 20);
          v.z += 0.01 * vnoise(v.x * 20, v.y * 20, v.z * 20 + sd);
        },
      });
    }
  }
  for (let k = 0; k < 10; k++) {
    const a = ((k + r.jit(0.1)) / 10) * TAU;
    b.box(stone, (TAU * R) / 10 - 0.02, 0.07, 0.3, [Math.cos(a) * R, 4 * ch + 0.035, Math.sin(a) * R], [r.jit(0.03), -a - HP, r.jit(0.03)], { c: 0.02 });
  }
  b.cyl(stone, R + 0.06, R + 0.06, 4 * ch, 16, [0, 2 * ch, 0], null, { open: true });
  b.cyl(stone, R - 0.08, R - 0.08, 4 * ch + 0.1, 16, [0, 2 * ch + 0.02, 0], null, { open: true, invert: true });
  b.add(dark, new THREE.CircleGeometry(R - 0.08, 16), [0, 0.12, 0], [-HP, 0, 0]);
  for (const s of [-1, 1]) {
    const x = s * 0.92;
    b.box(wood, 0.1, 2.05, 0.1, [x, 1.025, 0], [0, 0, r.jit(0.02)], { c: 0.01 });
    b.box(wood, 0.07, 0.09, 1.72, [x, 2.02, 0], null, { c: 0.008 });
    for (const q of [-1, 1]) boxBetween(b, wood, [x, 2.0, q * 0.84], [x, 2.3, 0], 0.06, 0.09, { c: 0.008 });
  }
  const pitch = Math.atan2(0.42, 0.86), pl = Math.hypot(0.86, 0.42) + 0.06;
  for (const s of [-1, 1]) b.box(roof, 2.2, 0.03, pl, [0, 2.12 + 0.03, s * 0.42], [s * pitch, 0, 0], { c: 0.005 });
  b.box(wood, 2.25, 0.07, 0.07, [0, 2.36, 0], [PI / 4, 0, 0], { c: 0.008 });
  b.cyl(wood, 0.06, 0.06, 1.74, 10, [0, 1.3, 0], [0, 0, HP]);
  for (let i = 0; i < 6; i++) b.add(wood, new THREE.TorusGeometry(0.068, 0.012, 4, 10), [-0.15 + i * 0.026, 1.3, 0], [0, HP, 0]);
  b.box(iron, 0.02, 0.24, 0.035, [0.99, 1.2, 0], [0, 0, 0.2], { c: 0.003 });
  b.cyl(iron, 0.014, 0.014, 0.12, 6, [1.06, 1.09, 0], [0, 0, HP]);
  const onRim = r.chance(0.5);
  const bp = onRim ? [0.5, 4 * ch + 0.07, 0.45] : [0.02, 0.4, 0.05];
  const brope = onRim ? [[-0.02, 1.24, 0.06], [0.1, 1.0, 0.25], [0.45, bp[1] + 0.35, 0.45]] : [[0.0, 1.24, 0.06], [0.01, 0.9, 0.06], [0.02, bp[1] + 0.33, 0.05]];
  b.tube(wood, brope, 0.009, 5);
  b.lathe(iron, bucketProfile(0.13, 0.27), 14, bp, [0, r.range(0, TAU), 0], { deform: dentDeform(r, 1, 0.012), weld: false });
  const bail = [];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * PI;
    bail.push([bp[0] + Math.cos(a) * 0.14, bp[1] + 0.245 + Math.sin(a) * 0.09, bp[2]]);
  }
  b.tube(iron, bail, 0.003, 4, { capEnd: false });
  b.col([-0.98, 0, -0.86], [0.98, 0.82, 0.86]);
};

// ---------------------------------------------------------------- oilDrumFire (burn barrel; anchors.fire = top centre)
BUILDERS.oilDrumFire = (b) => {
  const r = b.r;
  const drum = M('rustyMetal', { color: 0x6e5a4c }), char = M('woodBeam', { color: 0x221c18 });
  const ember = M('woodBeam', { color: 0x301a10, emissive: 0xff4a12, emissiveIntensity: 2.4 }, false);
  const seg = 20;
  const burnt = new Set();
  for (let i = 0; i < 3; i++) burnt.add(r.int(0, seg - 1));
  b.lathe(drum, drumProfile(true), seg, null, null, {
    skip: (i, j, y0, y1) => {
      const ym = (y0 + y1) / 2;
      return ym > 0.1 && ym < 0.17 && (j % 3 === 0 || burnt.has(j));
    },
    deform: dentDeform(r, 2, 0.02),
    weld: false,
  });
  b.cyl(char, 0.27, 0.27, 0.06, 16, [0, 0.07, 0]);
  for (let i = 0; i < 6; i++) {
    const a = r.range(0, TAU);
    b.cyl(char, r.range(0.025, 0.045), r.range(0.035, 0.05), r.range(0.45, 0.7), 7, [Math.cos(a) * 0.1, r.range(0.55, 0.7), Math.sin(a) * 0.1], [r.jit(0.5), r.range(0, TAU), r.jit(0.5)]);
  }
  for (let i = 0; i < 14; i++) {
    const low = i < 5;
    const a = r.range(0, TAU), d = r.range(0.02, low ? 0.24 : 0.18);
    b.add(ember, new THREE.IcosahedronGeometry(r.range(0.02, 0.045), 0), [Math.cos(a) * d, low ? r.range(0.1, 0.14) : r.range(0.72, 0.88), Math.sin(a) * d], [r.next(), r.next(), 0]);
  }
  b.anchor('fire', [0, 0.95, 0]);
  b.col([-0.29, 0, -0.29], [0.29, 0.885, 0.29]);
};

// ---------------------------------------------------------------- cellarDoors (origin centre; low entry end at -Z, high end/stairs at +Z)
// opts.open: 'left' | 'right' | 'both' | 'none' (default: seeded left/right); opts.void: false to omit the black opening quad.
BUILDERS.cellarDoors = (b, o) => {
  const r = b.r;
  const conc = 'concrete', wood = 'woodFloor', iron = 'rustyMetal';
  const W = 1.9, Lz = 1.7, yLow = 0.2, yHigh = 0.78, wt = 0.15;
  const z0 = -Lz / 2, z1 = Lz / 2;
  const trap = [[z0, -0.3], [z1, -0.3], [z1, yHigh], [z0, yLow]];
  for (const s of [-1, 1]) b.add(conc, sideGeo(trap, null, wt, 0.012), [s * (W / 2 + wt / 2), 0, 0]);
  b.box(conc, W + 2 * wt, yLow + 0.3, wt, [0, (yLow - 0.3) / 2, z0 - wt / 2], null, { c: 0.012 });
  b.box(conc, W + 2 * wt, 0.14, 0.16, [0, yHigh - 0.07, z1 + 0.08], null, { c: 0.012 });
  if (o.void !== false) b.add(VOID, new THREE.PlaneGeometry(W, Lz), [0, 0.015, 0], [-HP, 0, 0]);
  const slope = Math.atan2(yHigh - yLow, Lz), Ls = Math.hypot(Lz, yHigh - yLow) + 0.02;
  const openMode = o.open ?? r.pick(['left', 'right']);
  const leafW = W / 2;
  for (const side of [-1, 1]) {
    const isOpen = openMode === 'both' || (openMode === 'left' && side < 0) || (openMode === 'right' && side > 0);
    const ang = isOpen ? r.range(1.95, 2.45) : r.jit(0.01);
    b.grp([(side * W) / 2, yLow + 0.005, z0 - 0.02], [-slope, 0, 0], () => {
      b.grp(null, [0, 0, -side * ang], () => {
        const pw = leafW / 4;
        for (let k = 0; k < 4; k++) b.box(wood, pw - 0.006, 0.035, Ls, [-side * (k + 0.5) * pw, 0.0175, Ls / 2], [0, r.jit(0.006), 0], { c: 0.004, grain: 2 });
        for (const zz of [0.2, Ls / 2, Ls - 0.2]) b.box(wood, leafW - 0.06, 0.03, 0.09, [(-side * leafW) / 2, -0.015, zz], null, { c: 0.004 });
        for (const zz of [0.3, Ls - 0.3]) {
          b.box(iron, 0.42, 0.006, 0.05, [-side * 0.21, 0.038, zz], null, { c: 0 });
          b.cyl(iron, 0.012, 0.012, 0.08, 6, [0, 0.02, zz], [HP, 0, 0]);
        }
        const hx = -side * (leafW - 0.09);
        b.tube(iron, [[hx, 0.036, Ls * 0.42], [hx, 0.07, Ls * 0.44], [hx, 0.07, Ls * 0.56], [hx, 0.036, Ls * 0.58]], 0.007, 5);
      });
    });
  }
  b.col([-W / 2 - wt, 0, z0 - wt], [-W / 2, yHigh, z1]);
  b.col([W / 2, 0, z0 - wt], [W / 2 + wt, yHigh, z1]);
};

// ---------------------------------------------------------------- sign (hand-painted warning sign on a post)
const SIGN_MATS = new Map();
function signMaterial(text, text2, seed) {
  if (typeof document === 'undefined') return null;
  const key = text + '|' + text2 + '|' + (seed % 4);
  if (SIGN_MATS.has(key)) return SIGN_MATS.get(key);
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 512;
  const g = cv.getContext('2d');
  const rr = new RNG(seed);
  g.clearRect(0, 0, cv.width, cv.height);
  const paint = 'rgb(122,24,16)';
  g.fillStyle = paint;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const line1Y = text2 ? 190 : 256;
  const draw = (t, y, size) => {
    g.font = `bold ${size}px Impact, "Arial Black", "Helvetica Neue", sans-serif`;
    const w = g.measureText(t).width;
    const sx = Math.min(1, 900 / Math.max(1, w));
    g.save();
    g.translate(512, y);
    g.scale(sx, 1);
    for (let p = 0; p < 4; p++) {
      g.globalAlpha = 0.55 + 0.15 * p;
      g.fillText(t, rr.jit(3), rr.jit(3));
    }
    g.restore();
    g.globalAlpha = 1;
    const n = Math.floor(t.length * 1.4);
    for (let i = 0; i < n; i++) {
      const x = 512 + rr.jit((w * sx) / 2);
      const len = rr.range(15, 70);
      const dw = rr.range(3, 7);
      g.fillRect(x, y + size * 0.3, dw, len);
      g.beginPath();
      g.arc(x + dw / 2, y + size * 0.3 + len, dw * 0.75, 0, TAU);
      g.fill();
    }
  };
  draw(text, line1Y, 190);
  if (text2) draw(text2, 360, 110);
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    g.arc(rr.range(40, 984), rr.range(40, 472), rr.range(1, 5), 0, TAU);
    g.fill();
  }
  // scrape paint away in spots
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 220; i++) {
    g.globalAlpha = rr.range(0.3, 1);
    g.fillRect(rr.range(0, 1024), rr.range(0, 512), rr.range(2, 14), rr.range(1, 4));
  }
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.35, roughness: 0.85, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.userData.metersPerRepeat = 1;
  mat.name = 'signPaint';
  SIGN_MATS.set(key, mat);
  return mat;
}
BUILDERS.sign = (b, o) => {
  const r = b.r;
  const text = o.text ?? 'KEEP OUT';
  const text2 = o.text2 ?? (r.chance(0.5) ? 'TURN BACK' : '');
  b.push(null, [r.jit(0.06), 0, r.jit(0.06)]);
  b.box('woodBeam', 0.09, 1.95, 0.09, [0, 1.95 / 2 - 0.25, 0], [0, r.jit(0.2), 0], { c: 0.01 });
  const bw = 1.0, bh = 0.46;
  b.push([0, 1.36, 0.058], [0, 0, r.jit(0.05)]);
  for (const s of [-1, 1]) {
    const brk = r.chance(0.3);
    plank(b, 'woodFloor', bw + r.jit(0.03), bh / 2 - 0.004, 0.025, [r.jit(0.01), (s * bh) / 4, 0], [0, 0, r.jit(0.012)], { breakR: brk && s < 0 });
    for (const x of [-0.02, 0.02]) nailZ(b, x, (s * bh) / 4 + r.jit(0.03), 0.0125);
  }
  const sm = signMaterial(text, text2, (o.seed | 0) >>> 0);
  if (sm) b.add(MC('signPaint|' + text + '|' + text2 + '|' + (((o.seed | 0) >>> 0) % 4), sm, false), new THREE.PlaneGeometry(bw * 0.96, bh * 0.92), [0, 0, 0.0135], null, { uv: 'keep' });
  b.pop();
  b.pop();
  b.col([-0.06, 0, -0.06], [0.06, 1.7, 0.06]);
};

// ============================================================================ public API
/** Every supported prop type. */
export const PROP_TYPES = [
  'table', 'chair', 'shelfUnit', 'wallShelfToolbox', 'cabinet', 'dresser', 'bed', 'bathtub', 'toilet', 'sink', 'stove', 'fridge',
  'counter', 'sofa', 'crate', 'crateLong', 'cardboardBox', 'cardboardStack', 'barrel', 'generator', 'workbench', 'bookshelf',
  'radio', 'lantern', 'bucket', 'sandbags', 'ammoCrate', 'debrisPile', 'mattressFloor', 'bottles', 'papers', 'hangingLamp',
  'wireCable', 'boardedWindow', 'windowFrame', 'door', 'railing', 'supplyBoxGreen', 'supplyBoxRed', 'supplyBoxWhite',
  'pineTreeDead', 'deadTree', 'fence', 'carWreck', 'woodPile', 'hayBale', 'wheelbarrow', 'tireStack', 'powerPole', 'well',
  'oilDrumFire', 'cellarDoors', 'sign',
];

const PROP_CACHE = new Map();
function stableKey(o) {
  return Object.keys(o)
    .sort()
    .map((k) => k + ':' + JSON.stringify(o[k]))
    .join(',');
}

/**
 * Build a prop. Geometry is cached per (type, opts) — repeated calls return new meshes sharing
 * geometry and materials, so treat the returned geometry as read-only.
 * @returns {{ object: THREE.Group, colliders: Array<{min:number[],max:number[]}>, anchors: Object<string, THREE.Vector3> }}
 */
export function buildProp(type, opts = {}) {
  const fn = BUILDERS[type];
  if (!fn) throw new Error('buildProp: unknown prop type "' + type + '"');
  opts = opts || {};
  const key = type + '|' + stableKey(opts);
  let rec = PROP_CACHE.get(key);
  if (!rec) {
    const b = new PB(opts.seed ?? 1, type);
    fn(b, opts);
    rec = b.finish();
    PROP_CACHE.set(key, rec);
  }
  const root = new THREE.Group();
  root.name = 'prop:' + type;
  root.userData.propType = type;
  for (const m of rec.meshes) {
    const spec = specOf(m.key);
    const mesh = new THREE.Mesh(m.geo, resolveMat(spec));
    mesh.name = type + ':' + spec.name;
    mesh.castShadow = m.cast;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const anchors = {};
  for (const k in rec.anchors) anchors[k] = rec.anchors[k].clone();
  return {
    object: root,
    colliders: rec.colliders.map((c) => ({ min: c.min.slice(), max: c.max.slice() })),
    anchors,
  };
}

/** Drop cached geometry (e.g. when leaving a level). Does not dispose geometry still in use. */
export function clearPropCache(dispose = false) {
  if (dispose) for (const rec of PROP_CACHE.values()) for (const m of rec.meshes) m.geo.dispose();
  PROP_CACHE.clear();
}

// ---------------------------------------------------------------- extension API
// Other modules (src/world/ranchProps.js) register their own builders with the same PB toolkit.
export const PropKit = { PB, M, RNG, V3, PI, TAU, HP, lerp, clamp, smooth, fbm, vnoise, plank, plankGeo, boxBetween, tireProfile, drumProfile, dentDeform, bucketProfile, smoothPts, rrRing, loftGeo, nailZ, nailY, paintTint };
export function registerProp(type, fn) {
  BUILDERS[type] = fn;
  if (!PROP_TYPES.includes(type)) PROP_TYPES.push(type);
}
