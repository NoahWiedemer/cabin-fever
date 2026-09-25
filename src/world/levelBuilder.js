// Builds static level geometry from boxes into per-material merged meshes
// (world-space UVs, baked vertex-color grime/AO) and registers colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from './materials.js';
import { SURF } from './collision.js';

const FACE_DIRS = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

// simple hash for deterministic per-box variation
function hash3(x, y, z) {
  let h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return h - Math.floor(h);
}

class Bucket {
  constructor(material) {
    this.material = material;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
    this.castShadow = true;
  }
  quad(p0, p1, p2, p3, n, uvs, cols) {
    const base = this.pos.length / 3;
    const ps = [p0, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      this.pos.push(ps[i][0], ps[i][1], ps[i][2]);
      this.nor.push(n[0], n[1], n[2]);
      this.uv.push(uvs[i][0], uvs[i][1]);
      const c = cols[i];
      this.col.push(c, c, c);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

export class LevelBuilder {
  constructor(world) {
    this.world = world; // CollisionWorld
    this.buckets = new Map();
    this.staticGroup = new THREE.Group(); // props etc. for static batching
    this.staticGroup.name = 'staticProps';
  }

  bucket(matName, castShadow = true) {
    const key = matName + (castShadow ? '' : '|ns');
    let b = this.buckets.get(key);
    if (!b) {
      b = new Bucket(getMaterial(matName, { vertexColors: true }));
      b.castShadow = castShadow;
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Add a box. opts:
   *  mat: material name (default for all faces), mats: {px,nx,py,ny,pz,nz} overrides,
   *  skip: ['py', ...] faces to omit, collide (default true), surface (SURF), flags,
   *  floorY: level floor height for grime gradient (default: box minY), ceilY: ceiling height,
   *  grime: 0..1 strength (default 1), shade: constant multiplier, castShadow (default true),
   *  uvOffset: [u,v]
   */
  box(x0, y0, z0, x1, y1, z1, opts = {}) {
    const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
    const minZ = Math.min(z0, z1), maxZ = Math.max(z0, z1);
    if (maxX - minX < 1e-4 || maxY - minY < 1e-4 || maxZ - minZ < 1e-4) return null;
    const mat = opts.mat || 'plaster';
    const mats = opts.mats || {};
    const skip = opts.skip || [];
    const floorY = opts.floorY ?? minY;
    const ceilY = opts.ceilY ?? floorY + 3.2;
    const grime = opts.grime ?? 1;
    const shadeBase = (opts.shade ?? 1) * (0.9 + 0.12 * hash3(minX, minY, minZ));
    const castShadow = opts.castShadow ?? true;
    const uvo = opts.uvOffset || [0, 0];

    for (const f of ['px', 'nx', 'py', 'ny', 'pz', 'nz']) {
      if (skip.includes(f)) continue;
      const mname = mats[f] || mat;
      if (!mname) continue;
      const b = this.bucket(mname, castShadow);
      const mpr = b.material.userData.metersPerRepeat || 1;
      const n = FACE_DIRS[f];
      if (f === 'py' || f === 'ny') {
        const y = f === 'py' ? maxY : minY;
        const c = shadeBase * (f === 'ny' ? 0.85 : 1);
        const cols = [c, c, c, c];
        let p0, p1, p2, p3;
        if (f === 'py') {
          p0 = [minX, y, maxZ]; p1 = [maxX, y, maxZ]; p2 = [maxX, y, minZ]; p3 = [minX, y, minZ];
        } else {
          p0 = [minX, y, minZ]; p1 = [maxX, y, minZ]; p2 = [maxX, y, maxZ]; p3 = [minX, y, maxZ];
        }
        const uv = [p0, p1, p2, p3].map((p) => [p[0] / mpr + uvo[0], -p[2] / mpr + uvo[1]]);
        b.quad(p0, p1, p2, p3, n, uv, cols);
        continue;
      }
      // vertical faces: split into horizontal strips for the grime gradient
      const cuts = [minY, maxY];
      const rel = [0.03, 0.14, 0.45, 1.15, ceilY - floorY - 0.45];
      for (const r of rel) {
        const y = floorY + r;
        if (y > minY + 0.01 && y < maxY - 0.01) cuts.push(y);
      }
      cuts.sort((a, b2) => a - b2);
      const shadeAt = (y) => {
        const h = y - floorY;
        let s = 1;
        if (h < 1.15) {
          const t = Math.max(0, h) / 1.15;
          s = 0.62 + 0.38 * Math.pow(t, 0.6);
        }
        const toCeil = ceilY - y;
        if (toCeil < 0.45) s *= 0.8 + 0.2 * Math.max(0, toCeil) / 0.45;
        return shadeBase * (1 - grime + grime * s);
      };
      for (let i = 0; i < cuts.length - 1; i++) {
        const ya = cuts[i], yb = cuts[i + 1];
        let p0, p1, p2, p3, ua, ub;
        if (f === 'px') {
          p0 = [maxX, ya, maxZ]; p1 = [maxX, ya, minZ]; p2 = [maxX, yb, minZ]; p3 = [maxX, yb, maxZ];
          ua = -maxZ; ub = -minZ;
        } else if (f === 'nx') {
          p0 = [minX, ya, minZ]; p1 = [minX, ya, maxZ]; p2 = [minX, yb, maxZ]; p3 = [minX, yb, minZ];
          ua = minZ; ub = maxZ;
        } else if (f === 'pz') {
          p0 = [minX, ya, maxZ]; p1 = [maxX, ya, maxZ]; p2 = [maxX, yb, maxZ]; p3 = [minX, yb, maxZ];
          ua = minX; ub = maxX;
        } else {
          p0 = [maxX, ya, minZ]; p1 = [minX, ya, minZ]; p2 = [minX, yb, minZ]; p3 = [maxX, yb, minZ];
          ua = -maxX; ub = -minX;
        }
        const uv = [
          [ua / mpr + uvo[0], ya / mpr + uvo[1]],
          [ub / mpr + uvo[0], ya / mpr + uvo[1]],
          [ub / mpr + uvo[0], yb / mpr + uvo[1]],
          [ua / mpr + uvo[0], yb / mpr + uvo[1]],
        ];
        const ca = shadeAt(ya), cb = shadeAt(yb);
        b.quad(p0, p1, p2, p3, n, uv, [ca, ca, cb, cb]);
      }
    }

    if (opts.collide !== false) {
      return this.world.add(minX, minY, minZ, maxX, maxY, maxZ, opts.surface ?? SURF.plaster, opts.flags ?? 0, opts.tag ?? null);
    }
    return null;
  }

  /**
   * Wall along X (at z = zc) or along Z (at x = xc).
   * axis: 'x' => runs along x from a to b at z = c. 'z' => runs along z from a to b at x = c.
   * openings: [{ a, b, y0, y1 }] positions along the wall's axis (absolute), y relative to world.
   * sides: { pos: matName, neg: matName } (faces +Z/-Z for axis x; +X/-X for axis z), jamb mat.
   */
  wall(axis, c, a, b, y0, y1, thick, openings = [], opts = {}) {
    const h = thick / 2;
    const ops = [...openings].sort((p, q) => p.a - q.a);
    const segs = [];
    let cur = a;
    for (const o of ops) {
      if (o.a > cur) segs.push([cur, o.a, y0, y1]);
      if (o.y0 > y0) segs.push([o.a, o.b, y0, o.y0, 'sill']);
      if (o.y1 < y1) segs.push([o.a, o.b, o.y1, y1, 'lintel']);
      cur = Math.max(cur, o.b);
    }
    if (cur < b) segs.push([cur, b, y0, y1]);
    const sidePos = opts.sides?.pos ?? opts.mat ?? 'plaster';
    const sideNeg = opts.sides?.neg ?? opts.mat ?? 'plaster';
    const jamb = opts.jamb ?? 'woodPainted';
    const top = opts.top ?? sidePos;
    for (const [s0, s1, sy0, sy1, kind] of segs) {
      const mats = {};
      let bx0, bx1, bz0, bz1;
      if (axis === 'x') {
        bx0 = s0; bx1 = s1; bz0 = c - h; bz1 = c + h;
        mats.pz = sidePos; mats.nz = sideNeg;
        mats.px = kind ? jamb : (s1 < b - 1e-3 ? jamb : opts.endMat ?? sidePos);
        mats.nx = kind ? jamb : (s0 > a + 1e-3 ? jamb : opts.endMat ?? sidePos);
      } else {
        bz0 = s0; bz1 = s1; bx0 = c - h; bx1 = c + h;
        mats.px = sidePos; mats.nx = sideNeg;
        mats.pz = kind ? jamb : (s1 < b - 1e-3 ? jamb : opts.endMat ?? sidePos);
        mats.nz = kind ? jamb : (s0 > a + 1e-3 ? jamb : opts.endMat ?? sidePos);
      }
      mats.py = kind === 'sill' ? jamb : top;
      mats.ny = kind === 'lintel' ? jamb : top;
      this.box(bx0, sy0, bz0, bx1, sy1, bz1, {
        mats,
        floorY: opts.floorY ?? y0,
        ceilY: opts.ceilY ?? y1,
        surface: opts.surface ?? SURF.plaster,
        grime: opts.grime,
        castShadow: opts.castShadow,
      });
    }
  }

  /** Horizontal slab with rectangular holes: rect [x0,x1,z0,z1], holes [[x0,x1,z0,z1],...] */
  slab(x0, x1, z0, z1, ya, yb, holes = [], opts = {}) {
    const xs = new Set([x0, x1]);
    const zs = new Set([z0, z1]);
    for (const h of holes) {
      if (h[0] > x0 && h[0] < x1) xs.add(h[0]);
      if (h[1] > x0 && h[1] < x1) xs.add(h[1]);
      if (h[2] > z0 && h[2] < z1) zs.add(h[2]);
      if (h[3] > z0 && h[3] < z1) zs.add(h[3]);
    }
    const X = [...xs].sort((a, b) => a - b);
    const Z = [...zs].sort((a, b) => a - b);
    const inHole = (cx, cz) => holes.some((h) => cx > h[0] && cx < h[1] && cz > h[2] && cz < h[3]);
    // greedy: merge runs along x per z-row
    for (let j = 0; j < Z.length - 1; j++) {
      let runStart = null;
      for (let i = 0; i < X.length - 1; i++) {
        const cx = (X[i] + X[i + 1]) / 2, cz = (Z[j] + Z[j + 1]) / 2;
        const solid = !inHole(cx, cz);
        if (solid && runStart === null) runStart = X[i];
        if ((!solid || i === X.length - 2) && runStart !== null) {
          const end = solid ? X[i + 1] : X[i];
          this.box(runStart, ya, Z[j], end, yb, Z[j + 1], opts);
          runStart = null;
        }
      }
    }
  }

  /** Straight stairs rising from (start) to (end) along axis 'z' or 'x'. */
  stairs({ axis = 'z', x0, x1, s0, s1, yBottom, yTop, steps, mat = 'woodBeam', riser = 'woodPainted', side = null, solid = false, stringer = true, surface = SURF.wood }) {
    const dir = Math.sign(s1 - s0);
    const run = Math.abs(s1 - s0) / steps;
    const rise = (yTop - yBottom) / steps;
    const boxes = [];
    for (let i = 0; i < steps; i++) {
      const top = yBottom + rise * (i + 1);
      const sa = s0 + dir * run * i;
      const sb = s0 + dir * run * (i + 1);
      const bottom = solid ? yBottom : top - Math.max(0.08, rise) - 0.02;
      let b;
      const mats = { py: mat, ny: solid ? mat : 'woodBeam' };
      if (axis === 'z') {
        mats.px = side ?? riser; mats.nx = side ?? riser;
        mats[dir > 0 ? 'nz' : 'pz'] = riser;
        mats[dir > 0 ? 'pz' : 'nz'] = riser;
        b = this.box(x0, bottom, Math.min(sa, sb), x1, top, Math.max(sa, sb), { mats, surface, flags: 1, floorY: yBottom, grime: 0.3 });
      } else {
        mats.pz = side ?? riser; mats.nz = side ?? riser;
        mats[dir > 0 ? 'nx' : 'px'] = riser;
        mats[dir > 0 ? 'px' : 'nx'] = riser;
        b = this.box(Math.min(sa, sb), bottom, x0, Math.max(sa, sb), top, x1, { mats, surface, flags: 1, floorY: yBottom, grime: 0.3 });
      }
      boxes.push(b);
    }
    if (stringer && !solid) {
      // diagonal stringers approximated by visual-only slanted boxes
      const len = Math.hypot(Math.abs(s1 - s0), yTop - yBottom);
      const ang = Math.atan2(yTop - yBottom, Math.abs(s1 - s0));
      const geo = new THREE.BoxGeometry(0.06, 0.28, len);
      const m = getMaterial('woodBeam');
      for (const xx of [x0 + 0.03, x1 - 0.03]) {
        const mesh = new THREE.Mesh(geo, m);
        const mid = (s0 + s1) / 2;
        const midY = (yBottom + yTop) / 2 - 0.12;
        if (axis === 'z') {
          mesh.position.set(xx, midY, mid);
          mesh.rotation.x = dir > 0 ? -ang : ang;
        } else {
          mesh.position.set(mid, midY, xx);
          mesh.rotation.order = 'YXZ';
          mesh.rotation.y = Math.PI / 2;
          mesh.rotation.x = dir > 0 ? -ang : ang;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.staticGroup.add(mesh);
      }
    }
    return boxes;
  }

  /** Place a prop result ({object, colliders}) at position with rotation (multiples of 90° for colliders). */
  placeProp(prop, x, y, z, rotY = 0, opts = {}) {
    const o = prop.object;
    o.position.set(x, y, z);
    o.rotation.y = rotY;
    if (opts.scale) o.scale.setScalar(opts.scale);
    o.updateMatrixWorld(true);
    if (opts.dynamic) {
      // not batched
    } else {
      this.staticGroup.add(o);
    }
    const cos = Math.round(Math.cos(rotY) * 1000) / 1000;
    const sin = Math.round(Math.sin(rotY) * 1000) / 1000;
    const s = opts.scale ?? 1;
    const added = [];
    if (opts.collide !== false) {
      for (const c of prop.colliders || []) {
        // rotate corners around Y (object rotation.y: x' = x cos + z sin, z' = -x sin + z cos)
        const pts = [
          [c.min[0], c.min[2]],
          [c.max[0], c.min[2]],
          [c.min[0], c.max[2]],
          [c.max[0], c.max[2]],
        ].map(([px, pz]) => [px * cos + pz * sin, -px * sin + pz * cos]);
        const xs = pts.map((p) => p[0] * s + x);
        const zs = pts.map((p) => p[1] * s + z);
        added.push(
          this.world.add(
            Math.min(...xs),
            c.min[1] * s + y,
            Math.min(...zs),
            Math.max(...xs),
            c.max[1] * s + y,
            Math.max(...zs),
            opts.surface ?? SURF.wood,
            opts.flags ?? 0,
            opts.tag ?? null
          )
        );
      }
    }
    return added;
  }

  /** Build final meshes. Returns a THREE.Group with merged level meshes + batched props. */
  finish() {
    const group = new THREE.Group();
    group.name = 'level';
    for (const b of this.buckets.values()) {
      if (b.pos.length === 0) continue;
      const mesh = new THREE.Mesh(b.toGeometry(), b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    group.add(batchStatic(this.staticGroup));
    return group;
  }
}

/**
 * Merge all meshes under root that share a material (and shadow flags) into single meshes,
 * baking world transforms. Meshes with userData.noBatch are kept as-is.
 */
export function batchStatic(root, chunk = 10) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const keep = [];
  const _c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData.noBatch || o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material)) {
      keep.push(o);
      return;
    }
    // spatial chunk so frustum culling (camera + shadow cameras) still works after merging
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    _c.copy(o.geometry.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const ck = Math.floor(_c.x / chunk) + ',' + Math.floor(_c.z / chunk);
    const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + (o.geometry.index ? 'i' : 'n') + '|' + ck;
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(o);
  });
  const out = new THREE.Group();
  out.name = 'batched';
  for (const arr of groups.values()) {
    const geos = [];
    for (const m of arr) {
      let g = m.geometry.clone();
      // normalize attributes to position/normal/uv
      for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      if (!g.attributes.uv) {
        g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      }
      g.morphAttributes = {};
      g.applyMatrix4(m.matrixWorld);
      // mirrored transforms flip winding
      if (m.matrixWorld.determinant() < 0) flipWinding(g);
      geos.push(g);
    }
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!merged) {
      console.warn('batchStatic: merge failed, keeping separate meshes');
      for (const m of arr) keep.push(m);
      continue;
    }
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, arr[0].material);
    mesh.castShadow = arr[0].castShadow;
    mesh.receiveShadow = arr[0].receiveShadow;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  for (const m of keep) {
    m.updateMatrixWorld(true);
    const clone = m.clone();
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(m.matrixWorld);
    clone.matrixWorld.copy(m.matrixWorld);
    out.add(clone);
  }
  return out;
}

function flipWinding(g) {
  if (g.index) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) {
      const t = ix[i + 1];
      ix[i + 1] = ix[i + 2];
      ix[i + 2] = t;
    }
    return;
  }
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    for (const a of [pos, nor, uv]) {
      if (!a) continue;
      const s = a.itemSize;
      for (let k = 0; k < s; k++) {
        const t = a.array[(i + 1) * s + k];
        a.array[(i + 1) * s + k] = a.array[(i + 2) * s + k];
        a.array[(i + 2) * s + k] = t;
      }
    }
  }
}
