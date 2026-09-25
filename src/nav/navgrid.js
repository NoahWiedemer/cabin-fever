// Multi-level navigation grid rasterized from the collision world, with stair "portals"
// between levels and a multi-source Dijkstra flow field toward the living team members.
import { FLAG_STAIR, FLAG_NAVIGNORE } from '../world/collision.js';

const LEVEL_REF = [-3.2, 0.0, 3.45];

export class NavGrid {
  constructor(world, portals, navBlocks, opts = {}) {
    this.world = world;
    this.cell = opts.cell ?? 0.5;
    this.minX = opts.minX ?? -38;
    this.minZ = opts.minZ ?? -38;
    this.nx = Math.ceil(((opts.maxX ?? 38) - this.minX) / this.cell);
    this.nz = Math.ceil(((opts.maxZ ?? 38) - this.minZ) / this.cell);
    this.levels = 3;
    this.per = this.nx * this.nz;
    this.N = this.per * this.levels;
    this.walk = new Uint8Array(this.N);
    this.floorY = new Float32Array(this.N);
    this.dist = new Float32Array(this.N);
    this.portals = portals;
    this.navBlocks = navBlocks;
    this.agentR = opts.agentRadius ?? 0.3;
    this.maxStep = opts.maxStep ?? 0.5;
    this.rasterize();
    // portal lookup
    this.portalAt = new Map();
    for (const p of portals) {
      p.ia = this.index(p.a.level, p.a.x, p.a.z);
      p.ib = this.index(p.b.level, p.b.x, p.b.z);
      if (!this.walk[p.ia] || !this.walk[p.ib]) console.warn('portal endpoint not walkable', p.id, this.walk[p.ia], this.walk[p.ib]);
      this.walk[p.ia] = 1;
      this.walk[p.ib] = 1;
      if (!this.portalAt.has(p.ia)) this.portalAt.set(p.ia, []);
      if (!this.portalAt.has(p.ib)) this.portalAt.set(p.ib, []);
      this.portalAt.get(p.ia).push(p);
      this.portalAt.get(p.ib).push(p);
    }
    // heap storage
    this.heapIdx = new Int32Array(this.N * 2);
    this.heapKey = new Float32Array(this.N * 2);
    this.heapSize = 0;
    this.dist.fill(Infinity);
  }

  index(level, x, z) {
    const ix = Math.floor((x - this.minX) / this.cell);
    const iz = Math.floor((z - this.minZ) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return -1;
    return level * this.per + iz * this.nx + ix;
  }
  cellCenter(i, out) {
    const l = Math.floor(i / this.per);
    const r = i - l * this.per;
    const iz = Math.floor(r / this.nx);
    const ix = r - iz * this.nx;
    out.x = this.minX + (ix + 0.5) * this.cell;
    out.z = this.minZ + (iz + 0.5) * this.cell;
    out.level = l;
    out.y = this.floorY[i];
    return out;
  }

  rasterize() {
    const w = this.world;
    const c = this.cell;
    const r = this.agentR;
    for (let l = 0; l < this.levels; l++) {
      const ref = LEVEL_REF[l];
      for (let iz = 0; iz < this.nz; iz++) {
        for (let ix = 0; ix < this.nx; ix++) {
          const x = this.minX + (ix + 0.5) * c;
          const z = this.minZ + (iz + 0.5) * c;
          const i = l * this.per + iz * this.nx + ix;
          // floor: highest non-stair top within [ref-1.0, ref+0.2] at the cell center
          let floor = -Infinity;
          w.query(x - 0.05, z - 0.05, x + 0.05, z + 0.05, (b) => {
            if (b.flags & (FLAG_STAIR | FLAG_NAVIGNORE)) return;
            if (b.maxY <= ref + 0.2 && b.maxY >= ref - 1.0 && b.maxY > floor) {
              if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) floor = b.maxY;
            }
          });
          if (floor === -Infinity) continue;
          // blocked if any box intersects the body volume (inflated by agent radius)
          let blocked = false;
          const lo = floor + 0.36, hi = floor + 1.7;
          w.query(x - r, z - r, x + r, z + r, (b) => {
            if (b.flags & (FLAG_STAIR | FLAG_NAVIGNORE)) return;
            if (b.maxY <= lo || b.minY >= hi) return;
            const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
            const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
            if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) {
              blocked = true;
              return true;
            }
          });
          if (blocked) continue;
          this.walk[i] = 1;
          this.floorY[i] = floor;
        }
      }
    }
    for (const nb of this.navBlocks) {
      const [x0, x1, z0, z1] = nb.rect;
      for (let z = z0 + c * 0.5; z < z1; z += c * 0.5) {
        for (let x = x0 + c * 0.5; x < x1; x += c * 0.5) {
          const i = this.index(nb.level, x, z);
          if (i >= 0) this.walk[i] = 0;
        }
      }
    }
  }

  // ------------------------------------------------------------------ heap
  _push(i, k) {
    let n = this.heapSize++;
    const hi = this.heapIdx, hk = this.heapKey;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (hk[p] <= k) break;
      hi[n] = hi[p];
      hk[n] = hk[p];
      n = p;
    }
    hi[n] = i;
    hk[n] = k;
  }
  _pop() {
    const hi = this.heapIdx, hk = this.heapKey;
    const top = hi[0];
    this._popKey = hk[0];
    const size = --this.heapSize;
    if (size > 0) {
      const li = hi[size], lk = hk[size];
      let n = 0;
      for (;;) {
        let ch = n * 2 + 1;
        if (ch >= size) break;
        if (ch + 1 < size && hk[ch + 1] < hk[ch]) ch++;
        if (hk[ch] >= lk) break;
        hi[n] = hi[ch];
        hk[n] = hk[ch];
        n = ch;
      }
      hi[n] = li;
      hk[n] = lk;
    }
    return top;
  }

  /** Find nearest walkable cell to (level, x, z) within a few cells; may search other levels. */
  nearestWalkable(level, x, z, maxR = 6) {
    const i0 = this.index(level, x, z);
    if (i0 >= 0 && this.walk[i0]) return i0;
    const ix0 = Math.floor((x - this.minX) / this.cell);
    const iz0 = Math.floor((z - this.minZ) / this.cell);
    for (let rr = 1; rr <= maxR; rr++) {
      let best = -1, bd = Infinity;
      for (let dz = -rr; dz <= rr; dz++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (Math.abs(dx) !== rr && Math.abs(dz) !== rr) continue;
          const ix = ix0 + dx, iz = iz0 + dz;
          if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) continue;
          const i = level * this.per + iz * this.nx + ix;
          if (this.walk[i]) {
            const d = dx * dx + dz * dz;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** sources: [{level, x, z, y}] — compute distance field from all of them. */
  compute(sources, distArr = null) {
    const dist = distArr || this.dist;
    dist.fill(Infinity);
    this.heapSize = 0;
    for (const s of sources) {
      let i = this.nearestWalkable(s.level, s.x, s.z);
      if (i < 0) {
        // on stairs: try adjacent levels
        for (const l of [s.level - 1, s.level + 1]) {
          if (l < 0 || l > 2) continue;
          i = this.nearestWalkable(l, s.x, s.z, 8);
          if (i >= 0) break;
        }
      }
      if (i < 0) continue;
      dist[i] = 0;
      this._push(i, 0);
    }
    const nx = this.nx, per = this.per, walk = this.walk;
    const D = Math.SQRT2;
    while (this.heapSize > 0) {
      const i = this._pop();
      const d = dist[i];
      if (this._popKey > d + 1e-4) continue; // stale entry
      const l = (i / per) | 0;
      const r = i - l * per;
      const iz = (r / nx) | 0;
      const ix = r - iz * nx;
      // 4-neighbors (only if the height step between the cells is climbable)
      const fy = this.floorY[i];
      const FY = this.floorY;
      const MS = this.maxStep;
      const W = ix > 0 && walk[i - 1] && Math.abs(FY[i - 1] - fy) < MS;
      const E = ix < nx - 1 && walk[i + 1] && Math.abs(FY[i + 1] - fy) < MS;
      const S = iz > 0 && walk[i - nx] && Math.abs(FY[i - nx] - fy) < MS;
      const Nn = iz < this.nz - 1 && walk[i + nx] && Math.abs(FY[i + nx] - fy) < MS;
      if (W && d + 1 < dist[i - 1]) { dist[i - 1] = d + 1; this._push(i - 1, d + 1); }
      if (E && d + 1 < dist[i + 1]) { dist[i + 1] = d + 1; this._push(i + 1, d + 1); }
      if (S && d + 1 < dist[i - nx]) { dist[i - nx] = d + 1; this._push(i - nx, d + 1); }
      if (Nn && d + 1 < dist[i + nx]) { dist[i + nx] = d + 1; this._push(i + nx, d + 1); }
      // diagonals (no corner cutting)
      if (W && S && walk[i - nx - 1] && Math.abs(FY[i - nx - 1] - fy) < MS && d + D < dist[i - nx - 1]) { dist[i - nx - 1] = d + D; this._push(i - nx - 1, d + D); }
      if (E && S && walk[i - nx + 1] && Math.abs(FY[i - nx + 1] - fy) < MS && d + D < dist[i - nx + 1]) { dist[i - nx + 1] = d + D; this._push(i - nx + 1, d + D); }
      if (W && Nn && walk[i + nx - 1] && Math.abs(FY[i + nx - 1] - fy) < MS && d + D < dist[i + nx - 1]) { dist[i + nx - 1] = d + D; this._push(i + nx - 1, d + D); }
      if (E && Nn && walk[i + nx + 1] && Math.abs(FY[i + nx + 1] - fy) < MS && d + D < dist[i + nx + 1]) { dist[i + nx + 1] = d + D; this._push(i + nx + 1, d + D); }
      // portals
      const ps = this.portalAt.get(i);
      if (ps) {
        for (const p of ps) {
          if (!p.enabled) continue;
          const j = p.ia === i ? p.ib : p.ia;
          const nd = d + p.cost / this.cell;
          if (nd < dist[j]) {
            dist[j] = nd;
            this._push(j, nd);
          }
        }
      }
    }
  }

  /**
   * Steering query. Returns { dirX, dirZ, portal } where portal (if not null) means the agent should
   * traverse that portal toward its other endpoint. Returns null if no path.
   */
  steer(level, x, z, out, distArr = null) {
    const dist = distArr || this.dist;
    let i = this.index(level, x, z);
    if (i < 0) return null;
    if (!this.walk[i] || dist[i] === Infinity) {
      i = this.nearestWalkable(level, x, z, 3);
      if (i < 0 || dist[i] === Infinity) return null;
      // move toward that cell first
      this.cellCenter(i, _c);
      out.dirX = _c.x - x;
      out.dirZ = _c.z - z;
      out.portal = null;
      out.dist = dist[i];
      return out;
    }
    const nx = this.nx;
    let best = dist[i];
    let bestJ = -1;
    const l = (i / this.per) | 0;
    const r = i - l * this.per;
    const iz = (r / nx) | 0;
    const ix = r - iz * nx;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nx || jz >= this.nz) continue;
        const j = i + dz * nx + dx;
        if (!this.walk[j]) continue;
        if (Math.abs(this.floorY[j] - this.floorY[i]) >= this.maxStep) continue;
        if (dx && dz && (!this.walk[i + dx] || !this.walk[i + dz * nx])) continue;
        const dj = dist[j] + (dx && dz ? 0.02 : 0);
        if (dj < best) {
          best = dj;
          bestJ = j;
        }
      }
    }
    out.portal = null;
    out.dist = dist[i];
    const ps = this.portalAt.get(i);
    if (ps) {
      for (const p of ps) {
        if (!p.enabled) continue;
        const j = p.ia === i ? p.ib : p.ia;
        if (dist[j] + p.cost / this.cell < best + 0.01) {
          out.portal = p;
          out.portalTo = p.ia === i ? p.b : p.a;
          out.dirX = out.portalTo.x - x;
          out.dirZ = out.portalTo.z - z;
          return out;
        }
      }
    }
    if (bestJ < 0) {
      // at a local minimum (target cell)
      out.dirX = 0;
      out.dirZ = 0;
      return out;
    }
    // look one more step ahead for smoother paths
    this.cellCenter(bestJ, _c);
    let tx = _c.x, tz = _c.z;
    const bj = bestJ;
    const r2 = bj - l * this.per;
    const jz = (r2 / nx) | 0;
    const jx = r2 - jz * nx;
    let best2 = dist[bj], bestK = -1;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const kx = jx + dx, kz = jz + dz;
        if (kx < 0 || kz < 0 || kx >= nx || kz >= this.nz) continue;
        const k = bj + dz * nx + dx;
        if (!this.walk[k]) continue;
        if (dx && dz && (!this.walk[bj + dx] || !this.walk[bj + dz * nx])) continue;
        if (dist[k] < best2) {
          best2 = dist[k];
          bestK = k;
        }
      }
    }
    if (bestK >= 0) {
      this.cellCenter(bestK, _c);
      tx = (tx + _c.x) * 0.5;
      tz = (tz + _c.z) * 0.5;
    }
    out.dirX = tx - x;
    out.dirZ = tz - z;
    return out;
  }

  distanceAt(level, x, z) {
    const i = this.index(level, x, z);
    return i >= 0 ? this.dist[i] : Infinity;
  }

  /** Separate distance field toward fixed sources (e.g. a defensive post). */
  makeField(sources) {
    const arr = new Float32Array(this.N);
    this.compute(sources, arr);
    return {
      dist: arr,
      steer: (level, x, z, out) => this.steer(level, x, z, out, arr),
      recompute: () => this.compute(sources, arr),
    };
  }
}

const _c = { x: 0, z: 0, level: 0, y: 0 };
