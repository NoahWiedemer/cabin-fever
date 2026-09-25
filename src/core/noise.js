/**
 * noise.js — deterministic, allocation-free noise utilities.
 *
 * Point samplers (usable anywhere in game code):
 *   makeRng, hash2i, hash2, valueNoise2D, perlin2D, tileablePerlin2D, fbm2D,
 *   tileableFbm2D, worley2D, tileableWorley2D, worleyF1F2, perlin3D
 *
 * Whole-field generators (fast, used for procedural texture synthesis):
 *   tileableNoiseField, tileableWorleyField, upsampleWrap, sampleFieldWrap
 *
 * All "tileable" variants are exactly periodic: a field of `size` pixels whose
 * lattice has an integer number of cells repeats seamlessly at the image edges.
 */

const TAU = 6.283185307179586;

// ---------------------------------------------------------------------------
// Seeding / hashing
// ---------------------------------------------------------------------------

/** FNV-1a 32-bit string hash. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seedToU32(seed) {
  if (typeof seed === 'string') return hashString(seed);
  if (typeof seed !== 'number' || !Number.isFinite(seed)) return 0x9e3779b9;
  if (Number.isInteger(seed)) return seed >>> 0;
  const ip = Math.floor(seed);
  return (ip ^ Math.floor((seed - ip) * 4294967296)) >>> 0;
}

/** Deterministic PRNG (mulberry32). Returns () => float in [0, 1). */
export function makeRng(seed = 1) {
  let a = seedToU32(seed);
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer lattice hash → uint32. */
export function hash2i(x, y, seed = 0) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul((seed | 0) + 0x3c6ef372, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Integer lattice hash → float in [0, 1). */
export function hash2(x, y, seed = 0) {
  return hash2i(x, y, seed) / 4294967296;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

const PERM = new Uint8Array(512);
{
  const r = makeRng(0x5eed1337);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}

// 16 unit gradient directions (less axis bias than the classic 8)
const G2X = new Float64Array(16);
const G2Y = new Float64Array(16);
for (let i = 0; i < 16; i++) {
  const a = ((i + 0.5) * TAU) / 16;
  G2X[i] = Math.cos(a);
  G2Y[i] = Math.sin(a);
}

const P2_SCALE = 1.4142135623730951; // 2D Perlin with unit gradients peaks at ~1/sqrt(2)

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function grad2(h, x, y) {
  h &= 15;
  return G2X[h] * x + G2Y[h] * y;
}

// ---------------------------------------------------------------------------
// Point samplers
// ---------------------------------------------------------------------------

/** Value noise, range [-1, 1]. */
export function valueNoise2D(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = fade(x - x0);
  const v = fade(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const ab = a + (b - a) * u;
  const cd = c + (d - c) * u;
  return (ab + (cd - ab) * v) * 2 - 1;
}

/** Classic gradient (Perlin) noise, range ~[-1, 1]. Period 256. */
export function perlin2D(x, y) {
  const x0f = Math.floor(x);
  const y0f = Math.floor(y);
  const xf = x - x0f;
  const yf = y - y0f;
  const xi = x0f & 255;
  const yi = y0f & 255;
  const u = fade(xf);
  const v = fade(yf);
  const a = PERM[xi] + yi;
  const b = PERM[xi + 1] + yi;
  const n00 = grad2(PERM[a], xf, yf);
  const n01 = grad2(PERM[a + 1], xf, yf - 1);
  const n10 = grad2(PERM[b], xf - 1, yf);
  const n11 = grad2(PERM[b + 1], xf - 1, yf - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * P2_SCALE;
}

/** Perlin noise that repeats exactly every (periodX, periodY) units (integers). */
export function tileablePerlin2D(x, y, periodX, periodY = periodX) {
  const px = Math.max(1, Math.round(periodX));
  const py = Math.max(1, Math.round(periodY));
  const x0f = Math.floor(x);
  const y0f = Math.floor(y);
  const xf = x - x0f;
  const yf = y - y0f;
  let xi0 = x0f % px;
  if (xi0 < 0) xi0 += px;
  let yi0 = y0f % py;
  if (yi0 < 0) yi0 += py;
  const xi1 = xi0 + 1 >= px ? 0 : xi0 + 1;
  const yi1 = yi0 + 1 >= py ? 0 : yi0 + 1;
  const u = fade(xf);
  const v = fade(yf);
  const ha = PERM[xi0 & 255];
  const hb = PERM[xi1 & 255];
  const n00 = grad2(PERM[ha + (yi0 & 255)], xf, yf);
  const n01 = grad2(PERM[ha + (yi1 & 255)], xf, yf - 1);
  const n10 = grad2(PERM[hb + (yi0 & 255)], xf - 1, yf);
  const n11 = grad2(PERM[hb + (yi1 & 255)], xf - 1, yf - 1);
  const nx0 = n00 + (n10 - n00) * u;
  const nx1 = n01 + (n11 - n01) * u;
  return (nx0 + (nx1 - nx0) * v) * P2_SCALE;
}

/** Fractal Brownian motion of perlin2D, normalized to ~[-1, 1]. */
export function fbm2D(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * perlin2D(x * f + o * 31.7, y * f + o * 17.3);
    norm += amp;
    amp *= gain;
    f *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Tileable fBm: base period (periodX, periodY); each octave doubles frequency and period. */
export function tileableFbm2D(x, y, periodX, periodY = periodX, octaves = 5, gain = 0.5) {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  const px = Math.max(1, Math.round(periodX));
  const py = Math.max(1, Math.round(periodY));
  for (let o = 0; o < octaves; o++) {
    // offsets keep periodicity (shift inside a periodic function) but decorrelate octaves
    sum += amp * tileablePerlin2D(x * f + o * 7.31, y * f + o * 3.77, px * f, py * f);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

function worleyCore(x, y, periodX, periodY, seed, out) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let d1 = 1e9;
  let d2 = 1e9;
  let id = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      let hx = cx;
      let hy = cy;
      if (periodX > 0) {
        hx %= periodX;
        if (hx < 0) hx += periodX;
        hy %= periodY;
        if (hy < 0) hy += periodY;
      }
      const h = hash2i(hx, hy, seed);
      const dx = cx + (h & 0xffff) / 65536 - x;
      const dy = cy + (h >>> 16) / 65536 - y;
      const d = dx * dx + dy * dy;
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = h;
      } else if (d < d2) {
        d2 = d;
      }
    }
  }
  if (out) {
    out[0] = Math.sqrt(d1);
    out[1] = Math.sqrt(d2);
    out[2] = id / 4294967296;
  }
  return Math.sqrt(d1);
}

/** Worley / cellular noise, F1 distance in cell units (~[0, 1.2]). */
export function worley2D(x, y, seed = 0) {
  return worleyCore(x, y, 0, 0, seed, null);
}

/** Tileable Worley F1 with integer period (cells). Optional separate periodY. */
export function tileableWorley2D(x, y, period, seed = 0, periodY = period) {
  const px = Math.max(1, Math.round(period));
  const py = Math.max(1, Math.round(periodY));
  return worleyCore(x, y, px, py, seed, null);
}

/**
 * Worley F1/F2 + cell id. period 0 = non-tiling.
 * Writes [F1, F2, cellId01] into `out` and returns it.
 */
export function worleyF1F2(x, y, period = 0, seed = 0, out = [0, 0, 0]) {
  const p = period > 0 ? Math.max(1, Math.round(period)) : 0;
  worleyCore(x, y, p, p, seed, out);
  return out;
}

function grad3(h, x, y, z) {
  const hh = h & 15;
  const u = hh < 8 ? x : y;
  const v = hh < 4 ? y : hh === 12 || hh === 14 ? x : z;
  return ((hh & 1) === 0 ? u : -u) + ((hh & 2) === 0 ? v : -v);
}

/** Improved Perlin noise in 3D, range ~[-1, 1]. */
export function perlin3D(x, y, z) {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const Z = Math.floor(z);
  x -= X;
  y -= Y;
  z -= Z;
  const xi = X & 255;
  const yi = Y & 255;
  const zi = Z & 255;
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[xi] + yi;
  const AA = PERM[A] + zi;
  const AB = PERM[A + 1] + zi;
  const B = PERM[xi + 1] + yi;
  const BA = PERM[B] + zi;
  const BB = PERM[B + 1] + zi;
  const l1 = grad3(PERM[AA], x, y, z);
  const l2 = grad3(PERM[BA], x - 1, y, z);
  const l3 = grad3(PERM[AB], x, y - 1, z);
  const l4 = grad3(PERM[BB], x - 1, y - 1, z);
  const l5 = grad3(PERM[AA + 1], x, y, z - 1);
  const l6 = grad3(PERM[BA + 1], x - 1, y, z - 1);
  const l7 = grad3(PERM[AB + 1], x, y - 1, z - 1);
  const l8 = grad3(PERM[BB + 1], x - 1, y - 1, z - 1);
  const x1 = l1 + (l2 - l1) * u;
  const x2 = l3 + (l4 - l3) * u;
  const x3 = l5 + (l6 - l5) * u;
  const x4 = l7 + (l8 - l7) * u;
  const y1 = x1 + (x2 - x1) * v;
  const y2 = x3 + (x4 - x3) * v;
  return y1 + (y2 - y1) * w;
}

// ---------------------------------------------------------------------------
// Whole-field generators (square, tileable)
// ---------------------------------------------------------------------------

/**
 * Adds one octave of tileable gradient noise over a size×size field.
 * The lattice has cx×cy cells across the image, so the result repeats exactly.
 * mode: 0 = signed, 1 = |n| (turbulence), 2 = (1-|n|)^2 (ridged)
 *
 * Within one lattice cell on a given row, 2D gradient noise reduces to
 *   n(fx) = α + β·fx + fade(fx)·(γ + δ·fx)
 * so the four corner gradients are only touched when the row enters a new cell.
 */
function addGradientOctave(out, size, cx, cy, amp, mode, rng) {
  const nc = cx * cy;
  const gx = new Float32Array(nc);
  const gy = new Float32Array(nc);
  for (let i = 0; i < nc; i++) {
    const a = rng() * TAU;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  // Random phase offsets (any real shift keeps periodicity) decorrelate the octaves' lattices.
  const ox = rng() * size;
  const oy = rng() * size;
  const X0 = new Int32Array(size);
  const FX = new Float64Array(size);
  const SX = new Float64Array(size);
  const kx = cx / size;
  const ky = cy / size;
  for (let x = 0; x < size; x++) {
    const u = (x + ox) * kx;
    let i0 = Math.floor(u);
    const f = u - i0;
    i0 %= cx;
    X0[x] = i0;
    FX[x] = f;
    SX[x] = fade(f);
  }
  const sc = mode === 0 ? amp * P2_SCALE : P2_SCALE;
  for (let y = 0; y < size; y++) {
    const v = (y + oy) * ky;
    let j0 = Math.floor(v);
    const fy = v - j0;
    j0 %= cy;
    const j1 = j0 + 1 === cy ? 0 : j0 + 1;
    const sy = fade(fy);
    const ty = 1 - sy;
    const fy1 = fy - 1;
    const r0 = j0 * cx;
    const r1 = j1 * cx;
    const row = y * size;
    let cur = -1;
    let al = 0;
    let be = 0;
    let ga = 0;
    let de = 0;
    for (let x = 0; x < size; x++) {
      const i0 = X0[x];
      if (i0 !== cur) {
        cur = i0;
        const i1 = i0 + 1 === cx ? 0 : i0 + 1;
        const gx00 = gx[r0 + i0];
        const gy00 = gy[r0 + i0];
        const gx10 = gx[r0 + i1];
        const gy10 = gy[r0 + i1];
        const gx01 = gx[r1 + i0];
        const gy01 = gy[r1 + i0];
        const gx11 = gx[r1 + i1];
        const gy11 = gy[r1 + i1];
        al = (ty * gy00 * fy + sy * gy01 * fy1) * sc;
        be = (ty * gx00 + sy * gx01) * sc;
        ga = (ty * ((gy10 - gy00) * fy - gx10) + sy * ((gy11 - gy01) * fy1 - gx11)) * sc;
        de = (ty * (gx10 - gx00) + sy * (gx11 - gx01)) * sc;
      }
      const fx = FX[x];
      const val = al + be * fx + SX[x] * (ga + de * fx);
      if (mode === 0) {
        out[row + x] += val;
      } else {
        let a = val < 0 ? -val : val;
        if (mode === 2) {
          a = 1 - a;
          a *= a;
        }
        out[row + x] += amp * a;
      }
    }
  }
}

/** Bilinear, wrapped upsample of a square field (srcSize → dstSize). */
export function upsampleWrap(src, srcSize, dstSize, out = null) {
  out = out || new Float32Array(dstSize * dstSize);
  if (dstSize === srcSize * 2) return upsample2x(src, srcSize, out);
  if (dstSize > srcSize && dstSize % srcSize === 0) {
    const f = dstSize / srcSize;
    if ((f & (f - 1)) === 0) {
      // power-of-two factor: chain exact 2x steps (same result as direct bilinear, cheaper)
      let cur = src;
      let cs = srcSize;
      while (cs * 2 < dstSize) {
        const nxt = new Float32Array(cs * 2 * cs * 2);
        upsample2x(cur, cs, nxt);
        cur = nxt;
        cs *= 2;
      }
      return upsample2x(cur, cs, out);
    }
  }
  const k = srcSize / dstSize;
  const X0 = new Int32Array(dstSize);
  const X1 = new Int32Array(dstSize);
  const FX = new Float32Array(dstSize);
  for (let x = 0; x < dstSize; x++) {
    const u = x * k;
    let i0 = Math.floor(u);
    FX[x] = u - i0;
    i0 %= srcSize;
    X0[x] = i0;
    X1[x] = i0 + 1 === srcSize ? 0 : i0 + 1;
  }
  for (let y = 0; y < dstSize; y++) {
    const v = y * k;
    let j0 = Math.floor(v);
    const fy = v - j0;
    j0 %= srcSize;
    const j1 = j0 + 1 === srcSize ? 0 : j0 + 1;
    const r0 = j0 * srcSize;
    const r1 = j1 * srcSize;
    const row = y * dstSize;
    for (let x = 0; x < dstSize; x++) {
      const fx = FX[x];
      const a = src[r0 + X0[x]];
      const b = src[r0 + X1[x]];
      const c = src[r1 + X0[x]];
      const d = src[r1 + X1[x]];
      const top = a + (b - a) * fx;
      const bot = c + (d - c) * fx;
      out[row + x] = top + (bot - top) * fy;
    }
  }
  return out;
}

/** Exact 2x wrapped bilinear upsample (same sampling as upsampleWrap with k = 1/2, but faster). */
function upsample2x(src, sSize, out) {
  const d = sSize * 2;
  for (let j = 0; j < sSize; j++) {
    const r0 = j * sSize;
    const r1 = (j + 1 === sSize ? 0 : j + 1) * sSize;
    const o0 = 2 * j * d;
    const o1 = o0 + d;
    for (let i = 0; i < sSize; i++) {
      const i1 = i + 1 === sSize ? 0 : i + 1;
      const a = src[r0 + i];
      const b = src[r0 + i1];
      const c = src[r1 + i];
      const e = src[r1 + i1];
      const x = 2 * i;
      out[o0 + x] = a;
      out[o0 + x + 1] = (a + b) * 0.5;
      out[o1 + x] = (a + c) * 0.5;
      out[o1 + x + 1] = (a + b + c + e) * 0.25;
    }
  }
  return out;
}

/** Bilinear sample of a square field with wrap-around (pixel coordinates). */
export function sampleFieldWrap(f, size, x, y) {
  let x0 = Math.floor(x);
  let y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  x0 %= size;
  if (x0 < 0) x0 += size;
  y0 %= size;
  if (y0 < 0) y0 += size;
  const x1 = x0 + 1 === size ? 0 : x0 + 1;
  const y1 = y0 + 1 === size ? 0 : y0 + 1;
  const a = f[y0 * size + x0];
  const b = f[y0 * size + x1];
  const c = f[y1 * size + x0];
  const d = f[y1 * size + x1];
  const top = a + (b - a) * fx;
  const bot = c + (d - c) * fx;
  return top + (bot - top) * fy;
}

/** Repeat a small square periodic tile across a larger square field. */
function replicateTile(src, tileSize, size, out) {
  for (let y = 0; y < size; y++) {
    const srow = (y % tileSize) * tileSize;
    const drow = y * size;
    for (let x = 0; x < size; x += tileSize) {
      const len = Math.min(tileSize, size - x);
      out.set(len === tileSize ? src.subarray(srow, srow + tileSize) : src.subarray(srow, srow + len), drow + x);
    }
  }
  return out;
}

/**
 * Seamless fBm field.
 * opts: { cells | cellsX, cellsY (integers: lattice cells across the image),
 *         octaves=4, gain=0.5, seed=1, mode: 'fbm'|'turbulence'|'ridged',
 *         lowRes: compute at this resolution and upsample (for low-frequency fields),
 *         tileRes: compute on a smaller periodic tile and repeat it (for fine detail layers;
 *                  cells are scaled by tileRes/size, so the feature size is unchanged) }
 * Output: 'fbm' ≈ [-1,1] (std ≈ 0.25), 'turbulence'/'ridged' ≈ [0,1].
 * Octaves stop once the lattice gets finer than 2 px per cell.
 */
export function tileableNoiseField(size, opts = {}, out = null) {
  const cellsX = Math.max(1, Math.round(opts.cellsX ?? opts.cells ?? 4));
  const cellsY = Math.max(1, Math.round(opts.cellsY ?? opts.cells ?? 4));
  const octaves = opts.octaves ?? 4;
  const gain = opts.gain ?? 0.5;
  const seed = opts.seed ?? 1;
  const mode = opts.mode === 'ridged' ? 2 : opts.mode === 'turbulence' ? 1 : 0;
  const lowRes = opts.lowRes | 0;
  const tileRes = opts.tileRes | 0;
  const n = size * size;
  if (!out) out = new Float32Array(n);
  if (tileRes > 0 && tileRes < size) {
    const k = tileRes / size;
    const small = tileableNoiseField(tileRes, {
      ...opts,
      cellsX: Math.max(1, Math.round(cellsX * k)),
      cellsY: Math.max(1, Math.round(cellsY * k)),
      tileRes: 0,
      lowRes: 0,
    });
    return replicateTile(small, tileRes, size, out);
  }
  if (lowRes > 0 && lowRes < size) {
    const lr = tileableNoiseField(lowRes, { ...opts, lowRes: 0, tileRes: 0 });
    upsampleWrap(lr, lowRes, size, out);
    return out;
  }
  // Octave list (stop once the lattice is finer than 2 px per cell); normalization is folded
  // into the amplitudes.
  const oct = [];
  {
    let cx = cellsX;
    let cy = cellsY;
    let amp = 1;
    const maxCells = Math.max(1, size >> 1);
    for (let o = 0; o < octaves; o++) {
      if (cx > maxCells || cy > maxCells) break;
      oct.push([cx, cy, amp]);
      amp *= gain;
      cx *= 2;
      cy *= 2;
    }
  }
  if (!oct.length) {
    out.fill(0);
    return out;
  }
  let norm = 0;
  for (const o of oct) norm += o[2];
  const rng = makeRng(seed);
  // Resolution pyramid: each octave is evaluated at the smallest size/2^k resolution that still
  // gives >= 8 samples per lattice cell, accumulated coarse → fine with 2x wrapped upsampling.
  const resFor = (c) => {
    let r = size;
    while ((r & 1) === 0 && r / 2 >= c * 8 && r / 2 >= 16) r >>= 1;
    return r;
  };
  let res = resFor(Math.max(oct[0][0], oct[0][1]));
  let acc = res === size ? out : new Float32Array(res * res);
  acc.fill(0);
  for (const [cx, cy, amp] of oct) {
    const need = resFor(Math.max(cx, cy));
    while (res < need) {
      const nres = res * 2;
      const next = nres === size ? out : new Float32Array(nres * nres);
      upsampleWrap(acc, res, nres, next);
      acc = next;
      res = nres;
    }
    addGradientOctave(acc, res, cx, cy, amp / norm, mode, rng);
  }
  if (res < size) upsampleWrap(acc, res, size, out);
  return out;
}

/**
 * Seamless Worley (cellular) field.
 * opts: { cells | cellsX, cellsY, seed=1, jitter=1,
 *         warpX, warpY (Float32Array, tileable, same resolution the field is computed at),
 *         warpAmp (pixels at that resolution),
 *         lowRes: compute at this resolution and upsample F1/F2 (id nearest),
 *         tileRes: compute on a smaller periodic tile (cells scaled) and repeat it }
 * Returns { f1, f2, id } Float32Arrays: F1/F2 distances in cell units, id = random [0,1) per cell.
 */
export function tileableWorleyField(size, opts = {}, out = null) {
  const cx = Math.max(1, Math.round(opts.cellsX ?? opts.cells ?? 8));
  const cy = Math.max(1, Math.round(opts.cellsY ?? opts.cells ?? 8));
  const n = size * size;
  out = out || {};
  const f1 = out.f1 || new Float32Array(n);
  const f2 = out.f2 || new Float32Array(n);
  const idf = out.id || new Float32Array(n);
  const tileRes = opts.tileRes | 0;
  const lowRes = opts.lowRes | 0;
  if (tileRes > 0 && tileRes < size) {
    const k = tileRes / size;
    const w = tileableWorleyField(tileRes, {
      ...opts,
      cellsX: Math.max(1, Math.round(cx * k)),
      cellsY: Math.max(1, Math.round(cy * k)),
      tileRes: 0,
      lowRes: 0,
    });
    replicateTile(w.f1, tileRes, size, f1);
    replicateTile(w.f2, tileRes, size, f2);
    replicateTile(w.id, tileRes, size, idf);
    return { f1, f2, id: idf };
  }
  if (lowRes > 0 && lowRes < size) {
    const w = tileableWorleyField(lowRes, { ...opts, tileRes: 0, lowRes: 0 });
    upsampleWrap(w.f1, lowRes, size, f1);
    upsampleWrap(w.f2, lowRes, size, f2);
    const k = lowRes / size;
    for (let y = 0; y < size; y++) {
      const sr = Math.min(lowRes - 1, Math.floor((y + 0.5) * k)) * lowRes;
      for (let x = 0; x < size; x++) idf[y * size + x] = w.id[sr + Math.min(lowRes - 1, Math.floor((x + 0.5) * k))];
    }
    return { f1, f2, id: idf };
  }
  const jitter = opts.jitter ?? 1;
  const warpX = opts.warpX || null;
  const warpY = opts.warpY || null;
  const warpAmp = opts.warpAmp ?? 0;
  const rng = makeRng(opts.seed ?? 1);
  const nc = cx * cy;
  const PX = new Float32Array(nc);
  const PY = new Float32Array(nc);
  const PID = new Float32Array(nc);
  for (let i = 0; i < nc; i++) {
    PX[i] = 0.5 + (rng() - 0.5) * jitter;
    PY[i] = 0.5 + (rng() - 0.5) * jitter;
    PID[i] = rng();
  }
  // Padded grid (one ring of wrapped neighbours) holding absolute feature positions, so the
  // inner loop needs no modulo / branches.
  const pw = cx + 2;
  const ph = cy + 2;
  const QX = new Float32Array(pw * ph);
  const QY = new Float32Array(pw * ph);
  const QI = new Int32Array(pw * ph);
  for (let pj = 0; pj < ph; pj++) {
    const sj = (pj - 1 + cy) % cy;
    for (let pi = 0; pi < pw; pi++) {
      const si = (pi - 1 + cx) % cx;
      const c = sj * cx + si;
      const q = pj * pw + pi;
      QX[q] = pi - 1 + PX[c];
      QY[q] = pj - 1 + PY[c];
      QI[q] = c;
    }
  }
  const kx = cx / size;
  const ky = cy / size;
  const useWarp = !!(warpX && warpY && warpAmp !== 0);
  // Branchless F1/F2 update (min/max) — the classic if/else chain mispredicts constantly.
  if (!useWarp) {
    // Unwarped: the 9 candidate points only change when the row enters a new cell.
    const CX = new Float64Array(9);
    const CY = new Float64Array(9);
    const CI = new Float64Array(9);
    for (let y = 0; y < size; y++) {
      const row = y * size;
      const v = y * ky;
      let v0 = v | 0;
      if (v0 >= cy) v0 = cy - 1;
      let cur = -1;
      for (let x = 0; x < size; x++) {
        const u = x * kx;
        let u0 = u | 0;
        if (u0 >= cx) u0 = cx - 1;
        if (u0 !== cur) {
          cur = u0;
          const base = (v0 + 1) * pw + u0 + 1;
          let k = 0;
          for (let dj = -1; dj <= 1; dj++) {
            for (let di = -1; di <= 1; di++) {
              const q = base + dj * pw + di;
              CX[k] = QX[q];
              CY[k] = QY[q];
              CI[k] = PID[QI[q]];
              k++;
            }
          }
        }
        let d1 = 1e9;
        let d2 = 1e9;
        let id = 0;
        for (let k = 0; k < 9; k++) {
          const dx = CX[k] - u;
          const dy = CY[k] - v;
          const d = dx * dx + dy * dy;
          id = d < d1 ? CI[k] : id;
          d2 = Math.min(d2, Math.max(d, d1));
          d1 = Math.min(d1, d);
        }
        const i = row + x;
        f1[i] = Math.sqrt(d1);
        f2[i] = Math.sqrt(d2);
        idf[i] = id;
      }
    }
    return { f1, f2, id: idf };
  }
  const wkx = warpAmp * kx;
  const wky = warpAmp * ky;
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      const i = row + x;
      let u = x * kx + warpX[i] * wkx;
      let v = y * ky + warpY[i] * wky;
      while (u < 0) u += cx;
      while (u >= cx) u -= cx;
      while (v < 0) v += cy;
      while (v >= cy) v -= cy;
      let u0 = u | 0;
      let v0 = v | 0;
      if (u0 >= cx) u0 = cx - 1;
      if (v0 >= cy) v0 = cy - 1;
      const base = (v0 + 1) * pw + u0 + 1;
      let d1 = 1e9;
      let d2 = 1e9;
      let best = base;
      for (let dj = -1; dj <= 1; dj++) {
        const rb = base + dj * pw;
        for (let di = -1; di <= 1; di++) {
          const q = rb + di;
          const dx = QX[q] - u;
          const dy = QY[q] - v;
          const d = dx * dx + dy * dy;
          best = d < d1 ? q : best;
          d2 = Math.min(d2, Math.max(d, d1));
          d1 = Math.min(d1, d);
        }
      }
      f1[i] = Math.sqrt(d1);
      f2[i] = Math.sqrt(d2);
      idf[i] = PID[QI[best]];
    }
  }
  return { f1, f2, id: idf };
}
