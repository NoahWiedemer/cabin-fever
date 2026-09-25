// Multi-level navigation grid rasterized from the collision world, with stair "portals"
// between levels and a multi-source Dijkstra flow field toward the living team members.
//   * 8-connected costs, no corner cutting, and a clearance cost (cells next to walls / furniture cost
//     extra), so routes run down the middle of corridors and doorways instead of scraping the frames
//   * owner labels: the default field also records WHICH source (team member) is nearest by path
//   * a team member on a stair flight seeds both of its portal ends (the horde follows up / down)
//   * steer() walks the gradient a few cells ahead and "string-pulls" to the farthest cell in a clear,
//     walkable straight line, so agents move at any angle instead of in 45° grid steps
//   * lineClear(): walkable straight line on the grid (direct pursuit, smoothing, leaps)
import { FLAG_STAIR, FLAG_NAVIGNORE } from '../world/collision.js';

const LEVEL_REF = [-3.2, 0.0, 3.45];
// extra cost (x the step length) of entering a cell by its clearance: 1 = next to an obstacle cell
const CLEAR_COST = [0, 0.8, 0.25, 0.05];
const FLOOR_R = 0.15; // floor probe radius: bridges the wall-thick gaps under doorways (moveBody does too)
const LOOK = 12; // string pulling: cells of the route looked ahead

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
    this.clear = new Uint8Array(this.N); // Chebyshev distance (cells) to the nearest blocked cell, capped
    this.baseCost = new Float32Array(this.N); // clearance cost, see CLEAR_COST
    this.dist = new Float32Array(this.N);
    this.owner = new Int8Array(this.N); // default field: index of the nearest source by path (-1: none)
    this.ownerRef = []; // source index -> its `ref` (a team member)
    this.portals = portals;
    this.navBlocks = navBlocks;
    this.agentR = opts.agentRadius ?? 0.3;
    this.maxStep = opts.maxStep ?? 0.5;
    // optional extra cost (in cells) of entering a cell, Infinity = closed (world/barricades.js):
    // `cost` for the default field the infected follow, `fieldCost` for makeField fields (bots)
    this.cost = null;
    this.fieldCost = null;
    this.version = 0; // bumped whenever the walkable cells change (refreshRect, addPortal)
    this.rasterize();
    // portal lookup
    this.portalAt = new Map();
    for (const p of portals) this._linkPortal(p);
    this.computeClearance();
    // heap storage
    this.heapIdx = new Int32Array(this.N * 2);
    this.heapKey = new Float32Array(this.N * 2);
    this.heapSize = 0;
    this._chain = new Int32Array(LOOK);
    this.dist.fill(Infinity);
    this.owner.fill(-1);
  }

  _linkPortal(p) {
    p.ia = this.index(p.a.level, p.a.x, p.a.z);
    p.ib = this.index(p.b.level, p.b.x, p.b.z);
    if (!this.walk[p.ia] || !this.walk[p.ib]) console.warn('portal endpoint not walkable', p.id, this.walk[p.ia], this.walk[p.ib]);
    this.walk[p.ia] = 1;
    this.walk[p.ib] = 1;
    for (const i of [p.ia, p.ib]) {
      if (!this.portalAt.has(i)) this.portalAt.set(i, []);
      this.portalAt.get(i).push(p);
    }
  }

  /**
   * A portal added after construction (e.g. a ladder): { id, a: {level, x, z}, b: {level, x, z}, cost (m),
   * enabled, traverse?(zombie, dt, ctx) → true when done }. See Zombie._portalMove for `traverse`.
   */
  addPortal(p) {
    if (!this.portals.includes(p)) this.portals.push(p);
    this._linkPortal(p);
    this.computeClearance();
    this.version++;
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
    this._rasterRect(0, this.nx - 1, 0, this.nz - 1);
  }

  /** (Re)rasterize the cells ix0..ix1 × iz0..iz1 on every level, then apply the nav blocks there. */
  _rasterRect(ix0, ix1, iz0, iz1) {
    const w = this.world;
    const c = this.cell;
    const r = this.agentR;
    const fr = FLOOR_R;
    for (let l = 0; l < this.levels; l++) {
      const ref = LEVEL_REF[l];
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const x = this.minX + (ix + 0.5) * c;
          const z = this.minZ + (iz + 0.5) * c;
          const i = l * this.per + iz * this.nx + ix;
          this.walk[i] = 0;
          this.floorY[i] = 0;
          // floor: highest non-stair top within [ref-1.0, ref+0.2] within FLOOR_R of the cell center
          let floor = -Infinity;
          w.query(x - fr, z - fr, x + fr, z + fr, (b) => {
            if (b.flags & (FLAG_STAIR | FLAG_NAVIGNORE)) return;
            if (b.maxY <= ref + 0.2 && b.maxY >= ref - 1.0 && b.maxY > floor) {
              const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
              const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
              if ((x - cx) ** 2 + (z - cz) ** 2 <= fr * fr) floor = b.maxY;
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
    const x0 = this.minX + ix0 * c, x1 = this.minX + (ix1 + 1) * c, z0 = this.minZ + iz0 * c, z1 = this.minZ + (iz1 + 1) * c;
    for (const nb of this.navBlocks) {
      const [bx0, bx1, bz0, bz1] = nb.rect;
      if (bx1 < x0 || bx0 > x1 || bz1 < z0 || bz0 > z1) continue;
      for (let z = bz0 + c * 0.5; z < bz1; z += c * 0.5) {
        for (let x = bx0 + c * 0.5; x < bx1; x += c * 0.5) {
          const i = this.index(nb.level, x, z);
          if (i >= 0) this.walk[i] = 0;
        }
      }
    }
  }

  /**
   * Re-rasterize a world rect [x0, x1, z0, z1] after the geometry there changed (e.g. a wall blown open),
   * keeping portal endpoints walkable, and refresh the clearance. Fields must be recomputed afterwards.
   */
  refreshRect(x0, x1, z0, z1) {
    const c = this.cell;
    const ix0 = Math.max(0, Math.floor((x0 - this.minX) / c)), ix1 = Math.min(this.nx - 1, Math.floor((x1 - this.minX) / c));
    const iz0 = Math.max(0, Math.floor((z0 - this.minZ) / c)), iz1 = Math.min(this.nz - 1, Math.floor((z1 - this.minZ) / c));
    this._rasterRect(ix0, ix1, iz0, iz1);
    for (const p of this.portals) {
      this.walk[p.ia] = 1;
      this.walk[p.ib] = 1;
    }
    this.computeClearance();
    this.version++;
  }

  /** clearance (8-connected BFS distance to a blocked cell, per level) and the static cost it implies */
  computeClearance() {
    const { nx, nz, per, walk, clear } = this;
    const CAP = 6;
    const q = (this._bfs ??= new Int32Array(this.N));
    let head = 0, tail = 0;
    for (let i = 0; i < this.N; i++) {
      if (!walk[i]) {
        clear[i] = 0;
        q[tail++] = i;
      } else {
        const r = i % per;
        const iz = (r / nx) | 0, ix = r - iz * nx;
        // the grid border counts as blocked
        if (ix === 0 || iz === 0 || ix === nx - 1 || iz === nz - 1) {
          clear[i] = 1;
          q[tail++] = i;
        } else clear[i] = CAP;
      }
    }
    while (head < tail) {
      const i = q[head++];
      const d = clear[i] + 1;
      if (d >= CAP) continue;
      const r = i % per;
      const iz = (r / nx) | 0, ix = r - iz * nx;
      for (let dz = -1; dz <= 1; dz++) {
        const jz = iz + dz;
        if (jz < 0 || jz >= nz) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const jx = ix + dx;
          if ((!dx && !dz) || jx < 0 || jx >= nx) continue;
          const j = i + dz * nx + dx;
          if (clear[j] > d) {
            clear[j] = d;
            q[tail++] = j;
          }
        }
      }
    }
    const B = this.baseCost;
    for (let i = 0; i < this.N; i++) B[i] = walk[i] ? CLEAR_COST[clear[i]] ?? 0 : 0;
    // portal endpoints sit in stairwells (narrow by design): no clearance cost there
    for (const p of this.portals) {
      if (p.ia >= 0) B[p.ia] = 0;
      if (p.ib >= 0) B[p.ib] = 0;
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

  /** Find nearest walkable cell to (level, x, z) within a few cells (with a finite `dist` if given). */
  nearestWalkable(level, x, z, maxR = 6, dist = null) {
    const i0 = this.index(level, x, z);
    if (i0 >= 0 && this.walk[i0] && (!dist || dist[i0] < Infinity)) return i0;
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
          if (this.walk[i] && (!dist || dist[i] < Infinity)) {
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

  /**
   * A source standing on a stair flight (its cells are nav-blocked): seed both ends of that portal,
   * each with the share of the portal cost still to climb. Returns true if it did.
   */
  _seedOnPortal(s, dist, owner, id) {
    for (const p of this.portals) {
      if (!p.enabled) continue;
      const ax = p.a.x, az = p.a.z, bx = p.b.x, bz = p.b.z;
      const vx = bx - ax, vz = bz - az;
      const L2 = vx * vx + vz * vz;
      if (L2 < 1e-6) continue;
      const t = ((s.x - ax) * vx + (s.z - az) * vz) / L2;
      if (t < -0.05 || t > 1.05) continue;
      const px = ax + vx * t - s.x, pz = az + vz * t - s.z;
      if (px * px + pz * pz > 0.9 * 0.9) continue;
      const k = Math.min(1, Math.max(0, t));
      const c = p.cost / this.cell;
      for (const [i, d] of [[p.ia, k * c], [p.ib, (1 - k) * c]]) {
        if (d < dist[i]) {
          dist[i] = d;
          if (owner) owner[i] = id;
          this._push(i, d);
        }
      }
      return true;
    }
    return false;
  }

  /**
   * sources: [{level, x, z, ref?}] — compute distance field from all of them. The default field (no
   * distArr) also labels every cell with the index of its nearest source (this.owner / this.ownerRef).
   */
  compute(sources, distArr = null, cost = this.cost) {
    const dist = distArr || this.dist;
    const owner = distArr ? null : this.owner;
    const C = cost || (this._zero ??= new Float32Array(this.N));
    const B = this.baseCost;
    dist.fill(Infinity);
    if (owner) {
      owner.fill(-1);
      this.ownerRef.length = 0;
    }
    this.heapSize = 0;
    for (let si = 0; si < sources.length; si++) {
      const s = sources[si];
      if (owner) this.ownerRef[si] = s.ref ?? null;
      let i = this.index(s.level, s.x, s.z);
      if (i < 0 || !this.walk[i]) {
        if (this._seedOnPortal(s, dist, owner, si)) continue;
        i = this.nearestWalkable(s.level, s.x, s.z);
      }
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
      if (owner) owner[i] = si;
      this._push(i, 0);
    }
    const nx = this.nx, per = this.per, walk = this.walk;
    const D = Math.SQRT2;
    const FY = this.floorY;
    const MS = this.maxStep;
    while (this.heapSize > 0) {
      const i = this._pop();
      const d = dist[i];
      if (this._popKey > d + 1e-4) continue; // stale entry
      const l = (i / per) | 0;
      const r = i - l * per;
      const iz = (r / nx) | 0;
      const ix = r - iz * nx;
      const o = owner ? owner[i] : 0;
      // 4-neighbors (only if the height step between the cells is climbable)
      const fy = FY[i];
      const W = ix > 0 && walk[i - 1] && Math.abs(FY[i - 1] - fy) < MS;
      const E = ix < nx - 1 && walk[i + 1] && Math.abs(FY[i + 1] - fy) < MS;
      const S = iz > 0 && walk[i - nx] && Math.abs(FY[i - nx] - fy) < MS;
      const Nn = iz < this.nz - 1 && walk[i + nx] && Math.abs(FY[i + nx] - fy) < MS;
      let j, nd;
      if (W && (nd = d + 1 + B[(j = i - 1)] + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      if (E && (nd = d + 1 + B[(j = i + 1)] + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      if (S && (nd = d + 1 + B[(j = i - nx)] + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      if (Nn && (nd = d + 1 + B[(j = i + nx)] + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      // diagonals (no corner cutting)
      if (W && S && walk[(j = i - nx - 1)] && Math.abs(FY[j] - fy) < MS && (nd = d + D * (1 + B[j]) + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      if (E && S && walk[(j = i - nx + 1)] && Math.abs(FY[j] - fy) < MS && (nd = d + D * (1 + B[j]) + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      if (W && Nn && walk[(j = i + nx - 1)] && Math.abs(FY[j] - fy) < MS && (nd = d + D * (1 + B[j]) + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      if (E && Nn && walk[(j = i + nx + 1)] && Math.abs(FY[j] - fy) < MS && (nd = d + D * (1 + B[j]) + C[j]) < dist[j]) {
        dist[j] = nd;
        if (owner) owner[j] = o;
        this._push(j, nd);
      }
      // portals
      const ps = this.portalAt.get(i);
      if (ps) {
        for (const p of ps) {
          if (!p.enabled) continue;
          j = p.ia === i ? p.ib : p.ia;
          nd = d + p.cost / this.cell;
          if (nd < dist[j]) {
            dist[j] = nd;
            if (owner) owner[j] = o;
            this._push(j, nd);
          }
        }
      }
    }
  }

  /** The downhill neighbour of cell i (lowest dist, climbable, no corner cutting), or -1 at a minimum. */
  _next(i, dist) {
    const nx = this.nx, walk = this.walk, FY = this.floorY;
    const l = (i / this.per) | 0;
    const r = i - l * this.per;
    const iz = (r / nx) | 0;
    const ix = r - iz * nx;
    let best = dist[i], bestJ = -1;
    for (let dz = -1; dz <= 1; dz++) {
      const jz = iz + dz;
      if (jz < 0 || jz >= this.nz) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx;
        if (jx < 0 || jx >= nx) continue;
        const j = i + dz * nx + dx;
        if (!walk[j]) continue;
        if (Math.abs(FY[j] - FY[i]) >= this.maxStep) continue;
        if (dx && dz && (!walk[i + dx] || !walk[i + dz * nx])) continue;
        const dj = dist[j] + (dx && dz ? 0.02 : 0);
        if (dj < best) {
          best = dj;
          bestJ = j;
        }
      }
    }
    this._nextD = best;
    return bestJ;
  }

  /** An enabled portal at cell i that beats walking on (best = the downhill neighbour's dist), or null. */
  _portalHere(i, dist, best) {
    const ps = this.portalAt.get(i);
    if (!ps) return null;
    for (const p of ps) {
      if (!p.enabled) continue;
      const j = p.ia === i ? p.ib : p.ia;
      if (dist[j] + p.cost / this.cell < best + 0.01) return p;
    }
    return null;
  }

  /**
   * Walkable straight line on the grid from (x0, z0) to (x1, z1) on one level: every cell it crosses is
   * walkable with clearance >= need, climbable from the one before, reachable in `dist` (if given) and
   * free of extra `cost` (barricades). The start and end cells themselves aren't checked.
   */
  lineClear(level, x0, z0, x1, z1, need = 1, dist = null, cost = null) {
    const c = this.cell, nx = this.nx;
    let ix = Math.floor((x0 - this.minX) / c), iz = Math.floor((z0 - this.minZ) / c);
    const ex = Math.floor((x1 - this.minX) / c), ez = Math.floor((z1 - this.minZ) / c);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= this.nz || ex < 0 || ez < 0 || ex >= nx || ez >= this.nz) return false;
    const dx = x1 - x0, dz = z1 - z0;
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(c / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(c / dz) : Infinity;
    let tmx = dx !== 0 ? (this.minX + (ix + (sx > 0 ? 1 : 0)) * c - x0) / dx : Infinity;
    let tmz = dz !== 0 ? (this.minZ + (iz + (sz > 0 ? 1 : 0)) * c - z0) / dz : Infinity;
    const base = level * this.per;
    const end = base + ez * nx + ex;
    let prev = base + iz * nx + ix;
    let prevOk = this.walk[prev] === 1;
    const steps = Math.abs(ex - ix) + Math.abs(ez - iz);
    const W = this.walk, CL = this.clear, FY = this.floorY;
    for (let k = 0; k < steps; k++) {
      if (tmx < tmz) {
        ix += sx;
        tmx += tdx;
      } else {
        iz += sz;
        tmz += tdz;
      }
      if (ix < 0 || iz < 0 || ix >= nx || iz >= this.nz) return false;
      const i = base + iz * nx + ix;
      if (i === end && k === steps - 1) break; // the end cell itself may be tight (someone against a wall)
      if (!W[i] || CL[i] < need) return false;
      if (dist && dist[i] === Infinity) return false;
      if (cost && cost[i] > 0) return false;
      if (prevOk && Math.abs(FY[i] - FY[prev]) >= this.maxStep) return false;
      prev = i;
      prevOk = true;
    }
    return true;
  }

  /**
   * Steering query. Returns { dirX, dirZ, portal, portalTo, dist, wx, wz, fx, fz } or null if no path. The
   * direction points at the farthest cell of the downhill route (up to LOOK cells) that a straight
   * walkable line reaches (clearance need + 1, relaxed to `need` if nothing passes). `portal` (if not null)
   * means the agent stands at a portal and should traverse it toward `portalTo`. (wx, wz): the waypoint;
   * (fx, fz): the next cell of the route, unsmoothed.
   * opts: { need, cost } (cost: extra-cost cells a straight line may not cross; default: this.cost for
   * the default field).
   */
  steer(level, x, z, out, distArr = null, opts = null) {
    const dist = distArr || this.dist;
    const cost = opts?.cost !== undefined ? opts.cost : distArr ? null : this.cost;
    let i = this.index(level, x, z);
    if (i < 0) return null;
    out.portal = null;
    if (!this.walk[i] || dist[i] === Infinity) {
      i = this.nearestWalkable(level, x, z, 3, dist);
      if (i < 0) return null;
      // move toward that cell first
      this.cellCenter(i, _c);
      out.dirX = _c.x - x;
      out.dirZ = _c.z - z;
      out.wx = out.fx = _c.x;
      out.wz = out.fz = _c.z;
      out.dist = dist[i];
      return out;
    }
    out.dist = dist[i];
    const first = this._next(i, dist);
    // a local minimum that isn't a source (dist > 0) is a stair end seeded for someone on the flight:
    // go up / down it
    const p = this._portalHere(i, dist, first < 0 && dist[i] > 0.05 ? Infinity : this._nextD);
    if (p) {
      out.portal = p;
      out.portalTo = p.ia === i ? p.b : p.a;
      out.dirX = out.portalTo.x - x;
      out.dirZ = out.portalTo.z - z;
      out.wx = out.fx = out.portalTo.x;
      out.wz = out.fz = out.portalTo.z;
      return out;
    }
    if (first < 0) {
      // at a local minimum (target cell)
      out.dirX = 0;
      out.dirZ = 0;
      out.wx = out.fx = x;
      out.wz = out.fz = z;
      return out;
    }
    // the downhill route a few cells ahead (stops at a portal it should take)
    const chain = this._chain;
    let n = 0, cur = first;
    chain[n++] = cur;
    while (n < LOOK && !this._portalHere(cur, dist, dist[cur] - 1e-3)) {
      const nxt = this._next(cur, dist);
      if (nxt < 0) break;
      chain[n++] = cur = nxt;
    }
    // string pulling: the farthest of them a straight line reaches with a cell of room to spare (so it
    // doesn't shave corners and door frames), else with just the agent's own clearance
    const need = opts?.need ?? 1;
    let pick = chain[0];
    for (let pass = 0; pass < 2 && pick === chain[0]; pass++) {
      const nd = pass === 0 ? need + 1 : need;
      for (let k = n - 1; k >= 1; k--) {
        this.cellCenter(chain[k], _c);
        if (this.lineClear(level, x, z, _c.x, _c.z, nd, dist, cost)) {
          pick = chain[k];
          break;
        }
      }
    }
    this.cellCenter(chain[0], _c);
    out.fx = _c.x; // the next cell of the route (unsmoothed)
    out.fz = _c.z;
    this.cellCenter(pick, _c);
    out.dirX = _c.x - x;
    out.dirZ = _c.z - z;
    out.wx = _c.x;
    out.wz = _c.z;
    return out;
  }

  distanceAt(level, x, z) {
    const i = this.index(level, x, z);
    return i >= 0 ? this.dist[i] : Infinity;
  }

  /** The source (its `ref`) nearest by path to (level, x, z) in the default field, or null. */
  ownerAt(level, x, z) {
    let i = this.index(level, x, z);
    if (i < 0) return null;
    if (this.owner[i] < 0) i = this.nearestWalkable(level, x, z, 2, this.dist);
    return i >= 0 && this.owner[i] >= 0 ? this.ownerRef[this.owner[i]] ?? null : null;
  }

  /**
   * Separate distance field toward fixed sources (e.g. a defensive post). The bots' fields treat
   * barricades as closed (fieldCost); opts.infected: use the infected's costs instead (route fields).
   */
  makeField(sources, opts = {}) {
    const arr = new Float32Array(this.N);
    const costOf = () => (opts.infected ? this.cost : this.fieldCost);
    const steerOpts = { cost: null, need: 1 };
    this.compute(sources, arr, costOf());
    return {
      dist: arr,
      steer: (level, x, z, out, o = null) => {
        steerOpts.cost = opts.infected ? this.cost : null;
        steerOpts.need = o?.need ?? 1;
        return this.steer(level, x, z, out, arr, steerOpts);
      },
      recompute: () => this.compute(sources, arr, costOf()),
    };
  }
}

const _c = { x: 0, z: 0, level: 0, y: 0 };
