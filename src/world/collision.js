// Axis-aligned box collision world with a uniform XZ grid for queries,
// DDA raycasts and capsule-style character movement with step-up.
import * as THREE from 'three';

export const SURF = {
  wood: 0,
  plaster: 1,
  concrete: 2,
  metal: 3,
  mud: 4,
  flesh: 5,
  glass: 6,
  cardboard: 7,
};
export const SURF_NAMES = Object.keys(SURF);

export const FLAG_STAIR = 1; // excluded from nav rasterization
export const FLAG_NOBULLET = 2; // bullets pass through
export const FLAG_NOWALK = 4; // not a walkable surface for nav (e.g. tables are fine, but roofs)
export const FLAG_NAVIGNORE = 8; // ignored completely for nav (e.g. dynamic doors)

export class CollisionWorld {
  constructor(minX = -80, minZ = -80, maxX = 80, maxZ = 80, cell = 2) {
    this.minX = minX;
    this.minZ = minZ;
    this.cell = cell;
    this.nx = Math.ceil((maxX - minX) / cell);
    this.nz = Math.ceil((maxZ - minZ) / cell);
    this.boxes = [];
    this.grid = new Array(this.nx * this.nz);
    for (let i = 0; i < this.grid.length; i++) this.grid[i] = [];
    this.stamp = 1;
    this.marks = new Uint32Array(0);
  }

  add(minX, minY, minZ, maxX, maxY, maxZ, surface = SURF.wood, flags = 0, tag = null) {
    const b = {
      id: this.boxes.length,
      minX: Math.min(minX, maxX),
      minY: Math.min(minY, maxY),
      minZ: Math.min(minZ, maxZ),
      maxX: Math.max(minX, maxX),
      maxY: Math.max(minY, maxY),
      maxZ: Math.max(minZ, maxZ),
      surface,
      flags,
      tag,
      enabled: true,
    };
    this.boxes.push(b);
    const x0 = this._cx(b.minX), x1 = this._cx(b.maxX);
    const z0 = this._cz(b.minZ), z1 = this._cz(b.maxZ);
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.grid[z * this.nx + x].push(b);
    if (this.marks.length < this.boxes.length) {
      const m = new Uint32Array(Math.max(256, this.boxes.length * 2));
      m.set(this.marks);
      this.marks = m;
    }
    return b;
  }

  /**
   * Oriented box (rotated about Y by `yaw`, three.js rotation.y convention: local +X -> world (cos, -sin),
   * local +Z -> world (sin, cos)), centre (cx, cz), half extents (hx, hz) along its local axes, y0..y1.
   * Stored as a chain of AABB pieces (the grid index, nav rasterization and ragdolls see those); the
   * movement / ground / ceiling / ray queries test the exact oriented box through `piece.obb`.
   * opts.step: piece length along each local axis. Returns the obb (its `pieces` toggle `enabled`).
   */
  addOBB(cx, cz, hx, hz, yaw, y0, y1, surface = SURF.wood, flags = 0, tag = null, opts = {}) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const obb = { cx, cz, ux: c, uz: -s, vx: s, vz: c, hx, hz, minY: Math.min(y0, y1), maxY: Math.max(y0, y1), mark: 0, pieces: [] };
    const big = Math.min(hx, hz) > 0.3;
    const step = opts.step ?? (big ? (Math.min(hx, hz) > 3 ? 2.5 : 0.8) : 0.4);
    const nx = Math.max(1, Math.ceil((2 * hx) / step - 1e-6)), nz = Math.max(1, Math.ceil((2 * hz) / step - 1e-6));
    const px = hx / nx, pz = hz / nz;
    const ex = px * Math.abs(c) + pz * Math.abs(s), ez = px * Math.abs(s) + pz * Math.abs(c);
    for (let i = 0; i < nx; i++) {
      for (let k = 0; k < nz; k++) {
        const lx = -hx + px * (2 * i + 1), lz = -hz + pz * (2 * k + 1);
        const wx = cx + lx * c + lz * s, wz = cz - lx * s + lz * c;
        const b = this.add(wx - ex, obb.minY, wz - ez, wx + ex, obb.maxY, wz + ez, surface, flags, tag);
        b.obb = obb;
        obb.pieces.push(b);
      }
    }
    return obb;
  }

  _cx(x) {
    return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell)));
  }
  _cz(z) {
    return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell)));
  }

  // Calls fn(box) for each enabled box whose cell range overlaps the XZ rect (deduped).
  query(minX, minZ, maxX, maxZ, fn) {
    const s = ++this.stamp;
    const marks = this.marks;
    const x0 = this._cx(minX), x1 = this._cx(maxX);
    const z0 = this._cz(minZ), z1 = this._cz(maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.grid[z * this.nx + x];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (marks[b.id] === s) continue;
          marks[b.id] = s;
          if (!b.enabled) continue;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          if (fn(b) === true) return;
        }
      }
    }
  }

  // Highest walkable top at (x,z) within radius r that is <= maxY. Returns -Infinity if none.
  groundHeight(x, z, r, maxY) {
    let best = -Infinity;
    this.query(x - r, z - r, x + r, z + r, (b) => {
      if (b.maxY <= maxY && b.maxY > best) {
        // circle vs rect overlap
        if (b.obb) {
          if (obbDist2(b.obb, x, z) <= r * r) best = b.maxY;
          return;
        }
        const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
        const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz <= r * r) best = b.maxY;
      }
    });
    return best;
  }

  // Lowest box bottom above y at (x,z) within radius r. Infinity if none.
  ceilingHeight(x, z, r, y) {
    let best = Infinity;
    this.query(x - r, z - r, x + r, z + r, (b) => {
      if (b.minY >= y && b.minY < best) {
        if (b.obb) {
          if (obbDist2(b.obb, x, z) <= r * r) best = b.minY;
          return;
        }
        const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
        const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
        const dx = x - cx, dz = z - cz;
        if (dx * dx + dz * dz <= r * r) best = b.minY;
      }
    });
    return best;
  }

  // Push a vertical cylinder (feet y, height h, radius r) out of boxes horizontally.
  // Boxes whose top is within stepHeight of the feet are ignored (they are stepped on).
  resolveHorizontal(pos, r, h, stepHeight) {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const feet = pos.y + stepHeight;
      const head = pos.y + h;
      this.query(pos.x - r, pos.z - r, pos.x + r, pos.z + r, (b) => {
        if (b.maxY <= feet || b.minY >= head) return;
        if (b.obb) {
          const o = b.obb;
          if (o.mark === this.stamp) return; // one test per oriented box, not per piece
          o.mark = this.stamp;
          if (pushOutOBB(o, pos, r)) (moved = true), (hit = true);
          return;
        }
        const cx = pos.x < b.minX ? b.minX : pos.x > b.maxX ? b.maxX : pos.x;
        const cz = pos.z < b.minZ ? b.minZ : pos.z > b.maxZ ? b.maxZ : pos.z;
        let dx = pos.x - cx, dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) return;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          const push = r - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // center inside the box: push out along the smallest axis
          const pl = pos.x - b.minX + r, pr = b.maxX - pos.x + r;
          const pb = pos.z - b.minZ + r, pf = b.maxZ - pos.z + r;
          const m = Math.min(pl, pr, pb, pf);
          if (m === pl) pos.x -= pl;
          else if (m === pr) pos.x += pr;
          else if (m === pb) pos.z -= pb;
          else pos.z += pf;
        }
        moved = true;
        hit = true;
      });
      if (!moved) break;
    }
    return hit;
  }

  /**
   * Move a character. body = { pos: Vector3 (feet), vel: Vector3, radius, height, stepHeight, onGround, gravity }
   * Returns the landing impact speed if it landed this frame (else 0).
   */
  moveBody(body, dt) {
    const pos = body.pos;
    const vel = body.vel;
    const r = body.radius;
    const stepH = body.stepHeight ?? 0.4;
    let landed = 0;
    const hx = vel.x * dt, hz = vel.z * dt;
    const dist = Math.sqrt(hx * hx + hz * hz);
    const sub = Math.max(1, Math.min(8, Math.ceil(dist / (r * 0.5))));
    const bx = pos.x, bz = pos.z;
    for (let i = 0; i < sub; i++) {
      pos.x += hx / sub;
      pos.z += hz / sub;
      this.resolveHorizontal(pos, r, body.height, stepH);
    }
    body.blocked = Math.abs(pos.x - bx - hx) + Math.abs(pos.z - bz - hz) > 0.001 * Math.max(1, dist * 10);

    // vertical
    vel.y -= (body.gravity ?? 18) * dt;
    const wasOnGround = body.onGround;
    const prevY = pos.y;
    pos.y += vel.y * dt;
    const ground = this.groundHeight(pos.x, pos.z, r * 0.65, Math.max(prevY, pos.y) + stepH);
    if (pos.y <= ground + 0.001) {
      if (!wasOnGround && vel.y < -2) landed = -vel.y;
      pos.y = ground;
      vel.y = 0;
      body.onGround = true;
    } else if (wasOnGround && vel.y <= 0 && pos.y - ground < 0.5) {
      // walking down steps / slopes: stick to the ground
      pos.y = ground;
      vel.y = 0;
      body.onGround = true;
    } else {
      body.onGround = false;
    }
    if (vel.y > 0) {
      const ceil = this.ceilingHeight(pos.x, pos.z, r * 0.65, prevY + body.height - 0.05);
      if (pos.y + body.height > ceil) {
        pos.y = ceil - body.height;
        vel.y = 0;
      }
    }
    return landed;
  }

  /**
   * Raycast against boxes. dir must be normalized.
   * Returns { t, box, nx, ny, nz } or null. `filter(box)` may reject boxes.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, filter = null, out = {}) {
    const cell = this.cell;
    let cx = this._cx(ox), cz = this._cz(oz);
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const invDx = dx !== 0 ? 1 / dx : Infinity;
    const invDz = dz !== 0 ? 1 / dz : Infinity;
    const nextBX = this.minX + (cx + (stepX > 0 ? 1 : 0)) * cell;
    const nextBZ = this.minZ + (cz + (stepZ > 0 ? 1 : 0)) * cell;
    let tMaxX = dx !== 0 ? (nextBX - ox) * invDx : Infinity;
    let tMaxZ = dz !== 0 ? (nextBZ - oz) * invDz : Infinity;
    const tDeltaX = Math.abs(cell * invDx);
    const tDeltaZ = Math.abs(cell * invDz);
    const s = ++this.stamp;
    const marks = this.marks;
    let bestT = maxT;
    let best = null;
    let bnx = 0, bny = 0, bnz = 0;
    let tCell = 0;
    for (let guard = 0; guard < 512; guard++) {
      if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) break;
      const list = this.grid[cz * this.nx + cx];
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (marks[b.id] === s) continue;
        marks[b.id] = s;
        if (!b.enabled) continue;
        if (filter && !filter(b)) continue;
        if (b.obb) {
          // oriented box: the exact test, once per ray (any of its pieces may be the first one met)
          const o = b.obb;
          if (o.mark === s) continue;
          o.mark = s;
          if (!rayOBB(o, ox, oy, oz, dx, dy, dz, bestT, _ob)) continue;
          bestT = _ob.t;
          best = b;
          bnx = _ob.nx;
          bny = _ob.ny;
          bnz = _ob.nz;
          continue;
        }
        // slab test
        let t0 = 0, t1 = bestT;
        let nx = 0, ny = 0, nz = 0;
        // X
        if (dx !== 0) {
          let ta = (b.minX - ox) * invDx, tb = (b.maxX - ox) * invDx;
          let n = -stepX;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) { t0 = ta; nx = n; ny = 0; nz = 0; }
          if (tb < t1) t1 = tb;
        } else if (ox < b.minX || ox > b.maxX) continue;
        if (t0 > t1) continue;
        if (dy !== 0) {
          const inv = 1 / dy;
          let ta = (b.minY - oy) * inv, tb = (b.maxY - oy) * inv;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) { t0 = ta; nx = 0; ny = dy > 0 ? -1 : 1; nz = 0; }
          if (tb < t1) t1 = tb;
        } else if (oy < b.minY || oy > b.maxY) continue;
        if (t0 > t1) continue;
        if (dz !== 0) {
          let ta = (b.minZ - oz) * invDz, tb = (b.maxZ - oz) * invDz;
          if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
          if (ta > t0) { t0 = ta; nx = 0; ny = 0; nz = -stepZ; }
          if (tb < t1) t1 = tb;
        } else if (oz < b.minZ || oz > b.maxZ) continue;
        if (t0 > t1) continue;
        if (t0 < bestT) {
          if (t0 === 0 && nx === 0 && ny === 0 && nz === 0) continue; // origin inside box: ignore
          bestT = t0;
          best = b;
          bnx = nx; bny = ny; bnz = nz;
        }
      }
      // advance
      if (tMaxX < tMaxZ) {
        tCell = tMaxX;
        tMaxX += tDeltaX;
        cx += stepX;
      } else {
        tCell = tMaxZ;
        tMaxZ += tDeltaZ;
        cz += stepZ;
      }
      if (tCell > bestT) break;
    }
    if (!best) return null;
    out.t = bestT;
    out.box = best;
    out.nx = bnx;
    out.ny = bny;
    out.nz = bnz;
    return out;
  }

  lineOfSight(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-4) return true;
    const hit = this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len, losFilter, _losOut);
    return hit === null;
  }
}

const _losOut = {};
const _ob = { t: 0, nx: 0, ny: 0, nz: 0 };

/** squared xz distance from (x, z) to an oriented box */
function obbDist2(o, x, z) {
  const dx = x - o.cx, dz = z - o.cz;
  const u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz;
  const eu = Math.abs(u) - o.hx, ev = Math.abs(v) - o.hz;
  const a = eu > 0 ? eu : 0, c = ev > 0 ? ev : 0;
  return a * a + c * c;
}

/** push a circle (pos.xz, r) out of an oriented box; true if it moved */
function pushOutOBB(o, pos, r) {
  const dx = pos.x - o.cx, dz = pos.z - o.cz;
  const u = dx * o.ux + dz * o.uz, v = dx * o.vx + dz * o.vz;
  const cu = u < -o.hx ? -o.hx : u > o.hx ? o.hx : u;
  const cv = v < -o.hz ? -o.hz : v > o.hz ? o.hz : v;
  let pu = u - cu, pv = v - cv;
  const d2 = pu * pu + pv * pv;
  if (d2 >= r * r) return false;
  let mu, mv;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    mu = pu * k;
    mv = pv * k;
  } else {
    // centre inside: out through the nearest side
    const su = o.hx - Math.abs(u) + r, sv = o.hz - Math.abs(v) + r;
    if (su < sv) (mu = (u < 0 ? -1 : 1) * su), (mv = 0);
    else (mu = 0), (mv = (v < 0 ? -1 : 1) * sv);
  }
  pos.x += mu * o.ux + mv * o.vx;
  pos.z += mu * o.uz + mv * o.vz;
  return true;
}

/** ray vs oriented box (slabs in its frame); fills out {t, nx, ny, nz}; ignores rays starting inside */
function rayOBB(o, ox, oy, oz, dx, dy, dz, maxT, out) {
  const rx = ox - o.cx, rz = oz - o.cz;
  const ou = rx * o.ux + rz * o.uz, ov = rx * o.vx + rz * o.vz;
  const du = dx * o.ux + dz * o.uz, dv = dx * o.vx + dz * o.vz;
  _sl.t0 = -Infinity;
  _sl.t1 = maxT;
  _sl.ax = -1;
  if (!slab(ou, du, -o.hx, o.hx, 0) || !slab(oy, dy, o.minY, o.maxY, 1) || !slab(ov, dv, -o.hz, o.hz, 2)) return false;
  const t0 = _sl.t0;
  if (t0 <= 0 || _sl.ax < 0 || t0 >= maxT) return false;
  const sg = _sl.sg;
  out.t = t0;
  if (_sl.ax === 1) (out.nx = 0), (out.ny = sg), (out.nz = 0);
  else if (_sl.ax === 0) (out.nx = sg * o.ux), (out.ny = 0), (out.nz = sg * o.uz);
  else (out.nx = sg * o.vx), (out.ny = 0), (out.nz = sg * o.vz);
  return true;
}
const _sl = { t0: 0, t1: 0, ax: -1, sg: 0 };
function slab(o, d, lo, hi, axis) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  const inv = 1 / d;
  let ta = (lo - o) * inv, tb = (hi - o) * inv;
  if (ta > tb) {
    const t = ta;
    ta = tb;
    tb = t;
  }
  if (ta > _sl.t0) (_sl.t0 = ta), (_sl.ax = axis), (_sl.sg = d > 0 ? -1 : 1);
  if (tb < _sl.t1) _sl.t1 = tb;
  return _sl.t0 <= _sl.t1;
}
const losFilter = (b) => (b.flags & FLAG_NOBULLET) === 0;

export const _v = new THREE.Vector3();
