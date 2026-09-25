/**
 * textures.js — procedural PBR texture sets for Cabin Fever (night / rain / abandoned farmhouse).
 *
 * Everything is synthesized in code from seeded, tileable noise (no image files, no network).
 *
 * API
 *   await generateAllTextures(onProgress?)   // (fraction 0..1, label) => void ; yields between textures
 *   tex(name) -> { map, normalMap, roughnessMap, aoMap?, metalnessMap?, alphaMap?, metersPerRepeat, size }
 *   TEXTURE_NAMES
 *
 * Conventions
 *   - All maps are THREE.DataTexture (RGBA8). Row 0 of the data is v = 0 (bottom), so "+y" in the
 *     generators is "up" on a wall. Normal maps are OpenGL style (+Y = +V), tangent space.
 *   - Surface sets pack AO/roughness/metalness into one "ORM" texture: R = AO, G = roughness,
 *     B = metalness. roughnessMap and aoMap point at it; metalnessMap is only set for metal sets.
 *   - Only `map` is sRGB. Surfaces use RepeatWrapping, decals/sprites ClampToEdgeWrapping.
 *   - `metersPerRepeat` = real-world size of one tile (scale UVs by worldSize / metersPerRepeat).
 *   - Atlases ('bloodDecals', 'smoke', 'fire', 'muzzleFlash') are 2x2: cell (col,row) spans
 *     u ∈ [col/2, col/2+0.5], v ∈ [row/2, row/2+0.5]. Each cell has transparent margins.
 *       bloodDecals: (0,0) big impact splat · (1,0) directional spray · (0,1) drag smear · (1,1) splats + drip trail
 *       fire:        (0,0),(1,0) upright flames (tip towards +v) · (0,1),(1,1) round fireballs
 *       muzzleFlash: (0,0) 4-point star, (1,0) 6-point star (seen from behind) ·
 *                    (0,1),(1,1) side views, muzzle at the left (-u) edge, flame towards +u
 *       smoke:       four puff variations
 *   - Sprites (smoke/fire/spark/glow/muzzleFlash/dust/fogPuff/acidPuff) carry colour in RGB and
 *     coverage in alpha; normalMap/roughnessMap are null. 'spark' is a streak along U.
 *   - Decals (bloodDecals/bloodPool/bulletHole/scorch) have alpha in map.a plus normal & roughness.
 *   - 'foliage' is a branch card (alpha in map.a and alphaMap): base at bottom-center (v = 0).
 *   - 'woodFloor', 'ceilingBoards', 'crateWood': boards run along U. 'woodBeam', 'woodPainted',
 *     'bark': grain runs along V.
 *   - Fine grain layers are computed on a smaller periodic tile and repeated (cheap, invisible);
 *     generation takes ~2.5 s on an M3 Pro (≈3.5 s on an M1) and yields between sets.
 */
import * as THREE from 'three';
import { makeRng, tileableNoiseField, tileableWorleyField, sampleFieldWrap, upsampleWrap } from '../core/noise.js';

const TAU = Math.PI * 2;

// ===========================================================================
// Small math helpers
// ===========================================================================

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function sstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
/** Approximately normal distributed random number (mean 0, sd 1). */
function gauss(rng) {
  return (rng() + rng() + rng() + rng() - 2) * 1.7320508;
}

// ===========================================================================
// Scratch buffer pool (Float32Array, reused between generators)
// ===========================================================================

const _free = new Map();
let _used = [];

/** Zeroed Float32Array of length n from the pool. Released after each generator. */
function F(n) {
  const list = _free.get(n);
  let a;
  if (list && list.length) {
    a = list.pop();
    a.fill(0);
  } else {
    a = new Float32Array(n);
  }
  _used.push(a);
  return a;
}
function releaseScratch() {
  for (const a of _used) {
    let l = _free.get(a.length);
    if (!l) {
      l = [];
      _free.set(a.length, l);
    }
    l.push(a);
  }
  _used = [];
}
function clearScratch() {
  _free.clear();
  _used = [];
}

// ===========================================================================
// Field helpers
// ===========================================================================

function fbm(size, cx, cy, octaves, seed, gain = 0.5, lowRes = 0, tileRes = 0) {
  // Tileable fBm field ≈[-1,1]. cx/cy = lattice cells across the tile.
  // lowRes: compute smaller + upsample (smooth, low-frequency fields).
  // tileRes: compute on a smaller periodic tile and repeat it (fine grain layers only).
  if (lowRes >= size) lowRes = 0;
  if (tileRes >= size) tileRes = 0;
  return tileableNoiseField(size, { cellsX: cx, cellsY: cy, octaves, gain, seed, lowRes, tileRes }, F(size * size));
}

function eqfbm(size, cx, cy, octaves, seed, gain = 0.5, lowRes = 0) {
  // Histogram-equalized fBm mask (uniform [0,1]); equalized at lowRes before upsampling (cheaper).
  if (!lowRes || lowRes >= size) return equalize(fbm(size, cx, cy, octaves, seed, gain));
  const lr = equalize(fbm(lowRes, cx, cy, octaves, seed, gain));
  return upsampleWrap(lr, lowRes, size, F(size * size));
}

function worley(size, cx, cy, seed, o = {}) {
  // Tileable Worley field → { f1, f2, id }. o: { jitter, warpX, warpY, warpAmp, lowRes, tileRes }
  const n = size * size;
  return tileableWorleyField(
    size,
    {
      cellsX: cx,
      cellsY: cy,
      seed,
      jitter: o.jitter ?? 1,
      warpX: o.warpX || null,
      warpY: o.warpY || null,
      warpAmp: o.warpAmp ?? 0,
      lowRes: o.lowRes && o.lowRes < size ? o.lowRes : 0,
      tileRes: o.tileRes && o.tileRes < size ? o.tileRes : 0,
    },
    { f1: F(n), f2: F(n), id: F(n) },
  );
}

/** In-place histogram equalization → uniform [0,1]. Thresholds then equal coverage fractions. */
function equalize(f, bins = 4096) {
  const n = f.length;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = f[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;
  const k = (bins * (1 - 1e-6)) / range;
  const hist = new Uint32Array(bins);
  for (let i = 0; i < n; i++) hist[((f[i] - mn) * k) | 0]++;
  const cdf = new Float64Array(bins + 1);
  for (let b = 0; b < bins; b++) cdf[b + 1] = cdf[b] + hist[b];
  const inv = 1 / n;
  for (let i = 0; i < n; i++) {
    const t = (f[i] - mn) * k;
    const b = t | 0;
    f[i] = (cdf[b] + (t - b) * hist[b]) * inv;
  }
  return f;
}

/** Value below which a fraction q of the samples lie. */
function quantile(f, q, bins = 4096) {
  const n = f.length;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = f[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;
  const k = (bins * (1 - 1e-6)) / range;
  const hist = new Uint32Array(bins);
  for (let i = 0; i < n; i++) hist[((f[i] - mn) * k) | 0]++;
  const target = q * n;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    if (acc + hist[b] >= target) {
      const fr = hist[b] ? (target - acc) / hist[b] : 0;
      return mn + ((b + fr) / bins) * range;
    }
    acc += hist[b];
  }
  return mx;
}

/** Separable wrapped box blur (running sums). dst may alias src. */
function boxBlurWrap(src, dst, tmp, size, r) {
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + (((k % size) + size) % size)];
    for (let x = 0; x < size; x++) {
      tmp[row + x] = s * inv;
      let xa = x + r + 1;
      if (xa >= size) xa -= size;
      let xr = x - r;
      if (xr < 0) xr += size;
      s += src[row + xa] - src[row + xr];
    }
  }
  const sums = new Float64Array(size);
  for (let k = -r; k <= r; k++) {
    const row = (((k % size) + size) % size) * size;
    for (let x = 0; x < size; x++) sums[x] += tmp[row + x];
  }
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let ya = y + r + 1;
    if (ya >= size) ya -= size;
    let yr = y - r;
    if (yr < 0) yr += size;
    const ra = ya * size;
    const rr = yr * size;
    for (let x = 0; x < size; x++) {
      dst[row + x] = sums[x] * inv;
      sums[x] += tmp[ra + x] - tmp[rr + x];
    }
  }
}

/** Wrapped blur (box, `passes` iterations ≈ gaussian). Returns a new scratch field. */
function blur(src, size, r, passes = 2) {
  const out = F(size * size);
  const tmp = F(size * size);
  r = Math.max(1, Math.round(r));
  boxBlurWrap(src, out, tmp, size, r);
  for (let p = 1; p < passes; p++) boxBlurWrap(out, out, tmp, size, r);
  return out;
}

/** Streaks running "down" (towards v = 0): out = max(src, carry * decay), wrapped. */
function smearDown(src, size, decay) {
  const out = F(size * size);
  const carry = new Float32Array(size);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = size - 1; y >= 0; y--) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const c = carry[x] * decay;
        const s = src[row + x];
        const v = s > c ? s : c;
        carry[x] = v;
        out[row + x] = v;
      }
    }
  }
  return out;
}

/** Domain-warp a tileable field by two tileable offset fields (pixels). */
function warpField(src, size, wx, wy, amp) {
  const out = F(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      out[i] = sampleFieldWrap(src, size, x + wx[i] * amp, y + wy[i] * amp);
    }
  }
  return out;
}

function wrapIndex(size, x, y) {
  let xi = Math.floor(x) % size;
  if (xi < 0) xi += size;
  let yi = Math.floor(y) % size;
  if (yi < 0) yi += size;
  return yi * size + xi;
}

// ===========================================================================
// Stamping / rasterizing helpers
// ===========================================================================

/**
 * Visit pixels of the rectangle centered at (cx,cy) with half extents (rx,ry).
 * clip = null → wrap around (tileable); clip = [x0,y0,x1,y1] → clipped, no wrap.
 * cb(index, dx, dy) with dx/dy = pixel-center offset from (cx,cy).
 */
function forRect(size, cx, cy, rx, ry, clip, cb) {
  const x0 = Math.floor(cx - rx);
  const x1 = Math.floor(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.floor(cy + ry);
  if (clip) {
    const X0 = Math.max(x0, clip[0]);
    const X1 = Math.min(x1, clip[2] - 1);
    const Y0 = Math.max(y0, clip[1]);
    const Y1 = Math.min(y1, clip[3] - 1);
    for (let y = Y0; y <= Y1; y++) {
      const row = y * size;
      const dy = y + 0.5 - cy;
      for (let x = X0; x <= X1; x++) cb(row + x, x + 0.5 - cx, dy);
    }
    return;
  }
  for (let y = y0; y <= y1; y++) {
    let yy = y % size;
    if (yy < 0) yy += size;
    const row = yy * size;
    const dy = y + 0.5 - cy;
    for (let x = x0; x <= x1; x++) {
      let xx = x % size;
      if (xx < 0) xx += size;
      cb(row + xx, x + 0.5 - cx, dy);
    }
  }
}

/**
 * Visit pixels within r(+1) of segment p0→p1.
 * cb(index, dist, t, side) — t ∈ [0,1] along the segment, side = signed perpendicular offset.
 */
function forSegment(size, x0, y0, x1, y1, r, clip, cb) {
  const cx = (x0 + x1) * 0.5;
  const cy = (y0 + y1) * 0.5;
  const rx = Math.abs(x1 - x0) * 0.5 + r + 1;
  const ry = Math.abs(y1 - y0) * 0.5 + r + 1;
  const vx = x1 - x0;
  const vy = y1 - y0;
  const L2 = vx * vx + vy * vy || 1e-9;
  const invL = 1 / Math.sqrt(L2);
  const lim = r + 1;
  forRect(size, cx, cy, rx, ry, clip, (i, dx, dy) => {
    const px = dx + cx - x0;
    const py = dy + cy - y0;
    let t = (px * vx + py * vy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = px - vx * t;
    const ey = py - vy * t;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d <= lim) cb(i, d, t, (vx * py - vy * px) * invL);
  });
}

/** Random thin scratch strokes accumulated (max) into `field`. */
function drawScratches(size, field, rng, count, o) {
  for (let k = 0; k < count; k++) {
    const x0 = rng() * size;
    const y0 = rng() * size;
    const a =
      rng() < (o.alongProb ?? 0)
        ? (o.angle ?? 0) + (rng() * 2 - 1) * (o.spread ?? 0.3) + (rng() < 0.5 ? 0 : Math.PI)
        : rng() * TAU;
    const len = lerp(o.lenMin, o.lenMax, rng() * rng());
    const w = lerp(o.wMin, o.wMax, rng());
    const inten = lerp(o.iMin ?? 0.4, o.iMax ?? 1, rng());
    const bend = (rng() * 2 - 1) * 0.3;
    const xm = x0 + Math.cos(a) * len * 0.5;
    const ym = y0 + Math.sin(a) * len * 0.5;
    const x1 = xm + Math.cos(a + bend) * len * 0.5;
    const y1 = ym + Math.sin(a + bend) * len * 0.5;
    const seg = (ax, ay, bx, by, t0) => {
      forSegment(size, ax, ay, bx, by, w + 0.8, null, (i, d, t) => {
        const T = t0 + t * 0.5;
        const c = sstep(w + 0.7, w - 0.3, d) * inten * sstep(0, 0.12, T) * sstep(1, 0.82, T);
        if (c > field[i]) field[i] = c;
      });
    };
    seg(x0, y0, xm, ym, 0);
    seg(xm, ym, x1, y1, 0.5);
  }
}

function angularTable(rng, jag, nSpikes, spikeLen, spikeW = 0.06, hmax = 9) {
  // Angular radius table for irregular splats: 1 + harmonics*jag + gaussian spikes.
  const N = 512;
  const t = new Float32Array(N);
  const hs = [];
  for (let k = 2; k <= hmax; k++) hs.push([k, rng() * TAU, (0.3 + rng() * 0.7) / k]);
  const sp = [];
  for (let k = 0; k < nSpikes; k++) sp.push([rng() * TAU, spikeW * (0.4 + rng()), spikeLen * (0.25 + rng() * 0.75)]);
  let mx = 0;
  for (let a = 0; a < N; a++) {
    const th = (a / N) * TAU;
    let v = 1;
    for (const h of hs) v += jag * h[2] * Math.sin(h[0] * th + h[1]);
    for (const s of sp) {
      let d = th - s[0];
      d -= TAU * Math.round(d / TAU);
      v += s[2] * Math.exp(-(d * d) / (s[1] * s[1]));
    }
    t[a] = v;
    if (v > mx) mx = v;
  }
  return { t, spikes: sp, max: mx };
}
function tableAt(tb, th) {
  const N = tb.t.length;
  let u = (th / TAU) * N;
  u %= N;
  if (u < 0) u += N;
  const i0 = u | 0;
  const f = u - i0;
  const i1 = i0 + 1 === N ? 0 : i0 + 1;
  return tb.t[i0] + (tb.t[i1] - tb.t[i0]) * f;
}

function drawBlob(D, size, clip, cx, cy, R, tb, dens, dirX = 1, dirY = 0, stretch = 1, nz = null, nzAmp = 0) {
  // Irregular blob (splat) into density field D (max-combined).
  // Optional stretch along (dirX, dirY); optional edge breakup by noise field nz.
  const ext = R * tb.max * Math.max(1, stretch) * (1 + nzAmp) + 3;
  const inv = 1 / stretch;
  forRect(size, cx, cy, ext, ext, clip, (i, dx, dy) => {
    let ex = dx;
    let ey = dy;
    if (stretch !== 1) {
      ex = (dx * dirX + dy * dirY) * inv;
      ey = -dx * dirY + dy * dirX;
    }
    const r = Math.sqrt(ex * ex + ey * ey);
    let Re = R * tableAt(tb, Math.atan2(ey, ex));
    if (nz) Re *= 1 + nz[i] * nzAmp;
    if (r > Re + 1.5) return;
    const c = sstep(Re + 1.2, Re - 1.2, r);
    const v = c * dens * (0.62 + 0.5 * (1 - r / Math.max(Re, 1e-3)));
    if (v > D[i]) D[i] = v;
  });
}

/** Tapered capsule (droplet with tail) into density field D. */
function drawTaper(D, size, clip, x0, y0, r0, x1, y1, r1, dens) {
  const rm = Math.max(r0, r1);
  forSegment(size, x0, y0, x1, y1, rm + 1, clip, (i, d, t) => {
    const rr = r0 + (r1 - r0) * t;
    let c = sstep(rr + 0.9, rr - 0.9, d);
    if (rr < 0.9) c *= rr / 0.9;
    const v = c * dens * (0.65 + 0.45 * (1 - Math.min(1, d / Math.max(rr, 0.5))));
    if (v > D[i]) D[i] = v;
  });
}

// ===========================================================================
// Canvas (only used for stencil lettering; optional)
// ===========================================================================

function makeCanvas(w, h) {
  try {
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    }
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  } catch (e) {
    /* no canvas available */
  }
  return null;
}

/** Draw with a 2D context and return the alpha as a field in texture orientation (row 0 = v 0). */
function canvasMask(size, draw) {
  try {
    const cv = makeCanvas(size, size);
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;
    draw(ctx);
    const img = ctx.getImageData(0, 0, size, size).data;
    const m = F(size * size);
    for (let y = 0; y < size; y++) {
      const src = (size - 1 - y) * size;
      const dst = y * size;
      for (let x = 0; x < size; x++) m[dst + x] = img[(src + x) * 4 + 3] / 255;
    }
    return m;
  } catch (e) {
    return null;
  }
}

// ===========================================================================
// Output: height → normal, packing, THREE textures
// ===========================================================================

/** Sobel normal map (OpenGL / +Y = +V) from height; scale converts height units/pixel to slope. */
function normalFromHeight(H, size, scale, wrap = true) {
  const out = new Uint8Array(size * size * 4);
  const s = scale / 8;
  for (let y = 0; y < size; y++) {
    const ym = (y === 0 ? (wrap ? size - 1 : 0) : y - 1) * size;
    const y0 = y * size;
    const yp = (y === size - 1 ? (wrap ? 0 : size - 1) : y + 1) * size;
    for (let x = 0; x < size; x++) {
      const xm = x === 0 ? (wrap ? size - 1 : 0) : x - 1;
      const xp = x === size - 1 ? (wrap ? 0 : size - 1) : x + 1;
      const tl = H[yp + xm];
      const tc = H[yp + x];
      const tr = H[yp + xp];
      const ml = H[y0 + xm];
      const mr = H[y0 + xp];
      const bl = H[ym + xm];
      const bc = H[ym + x];
      const br = H[ym + xp];
      const dx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const dy = tl + 2 * tc + tr - (bl + 2 * bc + br);
      const nx = -dx * s;
      const ny = -dy * s;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      const o = (y0 + x) * 4;
      out[o] = ((nx * inv * 0.5 + 0.5) * 255 + 0.5) | 0;
      out[o + 1] = ((ny * inv * 0.5 + 0.5) * 255 + 0.5) | 0;
      out[o + 2] = ((inv * 0.5 + 0.5) * 255 + 0.5) | 0;
      out[o + 3] = 255;
    }
  }
  return out;
}

function makeTex(data, size, srgb, repeat) {
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.flipY = false;
  t.unpackAlignment = 4;
  t.needsUpdate = true;
  return t;
}


function finishSurface(size, mpr, ch, opts = {}) {
  // Tiling PBR surface. ch = { R,G,B (sRGB 0..1), H (height, mm), Ro (roughness), M? (metalness) }
  // opts: bump (normal exaggeration), aoRadius (px), aoStrength (per mm of cavity), aoAlbedo (0..1)
  const n = size * size;
  const { R, G, B, H, Ro, M } = ch;
  const scale = ((opts.bump ?? 1.5) * size) / (1000 * mpr);
  const normal = normalFromHeight(H, size, scale, true);
  const aoR = Math.max(1, Math.round(opts.aoRadius ?? size / 256));
  const aoK = opts.aoStrength ?? 0.15;
  const aoAlb = opts.aoAlbedo ?? 0.45;
  const bl = blur(H, size, aoR, 1);
  const col = new Uint8Array(n * 4);
  const orm = new Uint8Array(n * 4);
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    let ao = 1 - (bl[i] - H[i]) * aoK;
    ao = ao < 0.3 ? 0.3 : ao > 1 ? 1 : ao;
    const am = 1 - (1 - ao) * aoAlb;
    col[o] = to8(R[i] * am);
    col[o + 1] = to8(G[i] * am);
    col[o + 2] = to8(B[i] * am);
    col[o + 3] = 255;
    const r = Ro[i];
    orm[o] = to8(ao);
    orm[o + 1] = to8(r < 0.03 ? 0.03 : r);
    orm[o + 2] = M ? to8(M[i]) : 0;
    orm[o + 3] = 255;
  }
  const map = makeTex(col, size, true, true);
  const normalMap = makeTex(normal, size, false, true);
  const ormTex = makeTex(orm, size, false, true);
  const set = { map, normalMap, roughnessMap: ormTex, aoMap: ormTex, metersPerRepeat: mpr, size };
  if (M) set.metalnessMap = ormTex;
  return set;
}

function finishDecal(size, ch, opts = {}) {
  // Non-tiling decal (alpha in map.a). ch = { R,G,B,A, H?, Ro? }.
  // roughnessMap is grayscale in all channels (three.js reads G).
  const n = size * size;
  const { R, G, B, A, H, Ro } = ch;
  const col = new Uint8Array(n * 4);
  const rough = Ro ? new Uint8Array(n * 4) : null;
  for (let i = 0, o = 0; i < n; i++, o += 4) {
    col[o] = to8(R[i]);
    col[o + 1] = to8(G[i]);
    col[o + 2] = to8(B[i]);
    col[o + 3] = to8(A[i]);
    if (rough) {
      const r = to8(Ro[i]);
      rough[o] = r;
      rough[o + 1] = r;
      rough[o + 2] = r;
      rough[o + 3] = 255;
    }
  }
  const set = {
    map: makeTex(col, size, true, false),
    normalMap: H ? makeTex(normalFromHeight(H, size, opts.bump ?? 1, false), size, false, false) : null,
    roughnessMap: rough ? makeTex(rough, size, false, false) : null,
    metersPerRepeat: 1,
    size,
  };
  if (opts.alphaMap) {
    const am = new Uint8Array(n * 4);
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const a = to8(A[i]);
      am[o] = a;
      am[o + 1] = a;
      am[o + 2] = a;
      am[o + 3] = 255;
    }
    set.alphaMap = makeTex(am, size, false, false);
  }
  return set;
}

/** Particle sprite: color + alpha only. */
function finishSprite(size, R, G, B, A) {
  const set = finishDecal(size, { R, G, B, A });
  set.normalMap = null;
  set.roughnessMap = null;
  return set;
}

// ===========================================================================
// Shared wood plank synthesis (boards along U)
// ===========================================================================

function plankSurface(size, rng, c) {
  // Generic weathered plank surface, boards along U. Returns channel fields plus layout info;
  // E = distance (px) to the nearest gap edge (negative inside gaps).
  const n = size * size;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const E = F(n);
  const boards = c.boards;
  const bw = size / boards;
  const maxP = c.noJoints ? 1 : c.pieces[1];
  const seed = c.seed;
  const fine = fbm(size, 4, Math.max(8, size >> 3), 3, seed + 1, 0.5, 0, size >> 1);
  const pores = fbm(size, 8, size >> 2, 2, seed + 2, 0.5, 0, size >> 1);
  const warpF = fbm(size, 3, 10, 3, seed + 3, 0.5, size >> 2);
  const chipN = fbm(size, 32, 32, 2, seed + 4, 0.5, size >> 1);
  const KP = F(n);
  const KD = F(n);
  const archK = 2 * (size / (TAU * bw)) ** 2;
  const poreAmp = c.poreAmp ?? 0.06;
  const poreColor = c.poreColor ?? 0.06;

  // --- layout: per board row, plank pieces with staggered butt joints
  const rows = [];
  const params = [];
  for (let b = 0; b < boards; b++) {
    const noJ = c.noJoints || rng() > (c.jointProb ?? 1);
    const cnt = noJ ? 1 : c.pieces[0] + Math.floor(rng() * (c.pieces[1] - c.pieces[0] + 1));
    const w = [];
    let wsum = 0;
    for (let k = 0; k < cnt; k++) {
      const v = 0.6 + rng();
      w.push(v);
      wsum += v;
    }
    const cum = [0];
    for (let k = 0; k < cnt; k++) cum.push(cum[k] + (w[k] / wsum) * size);
    cum[cnt] = size;
    const off = rng() * size;
    const sg = new Uint8Array(size);
    const jd = new Float32Array(size);
    const lx = new Float32Array(size);
    for (let x = 0; x < size; x++) {
      let p = (x + 0.5 - off) % size;
      if (p < 0) p += size;
      let k = 0;
      while (k < cnt - 1 && p >= cum[k + 1]) k++;
      sg[x] = k;
      lx[x] = p - cum[k];
      jd[x] = noJ ? 1e6 : Math.min(p - cum[k], cum[k + 1] - p);
    }
    rows.push({ sg, jd, lx, off, cum, cnt: noJ ? 0 : cnt, noJ, gapMul: 0.7 + rng() * 0.7 });
    for (let k = 0; k < maxP; k++) {
      const len = k < cnt ? cum[k + 1] - cum[k] : size;
      params.push({
        grey: rng(),
        val: 1 + (rng() * 2 - 1) * c.valueVar,
        ringPx: lerp(c.ringPx[0], c.ringPx[1], rng()),
        ringOff: rng() * 100,
        arch: lerp(c.arch[0], c.arch[1], rng()) * (rng() < 0.5 ? -1 : 1),
        archX: len * (0.2 + rng() * 0.6),
        ox: Math.floor(rng() * size),
        oy: Math.floor(rng() * size),
        h0: (rng() * 2 - 1) * (c.h0 ?? 0.3),
        tilt: (rng() * 2 - 1) * (c.tilt ?? 0.3),
        warpAmp: 1.2 + rng() * 2.5,
        rough: (rng() * 2 - 1) * 0.04,
        hs: (rng() * 1e9) | 0,
      });
    }
  }

  // --- knots: phase warp (grain flows around) + dark core, limited to their board
  for (let k = 0; k < (c.knots || 0); k++) {
    const b = Math.floor(rng() * boards);
    const kx = rng() * size;
    const ky = b * bw + bw * (0.25 + rng() * 0.5);
    const rx = bw * (0.06 + rng() * 0.08);
    const ry = rx * (0.55 + rng() * 0.3);
    const sign = rng() < 0.5 ? -1 : 1;
    forRect(size, kx, ky, rx * 6, Math.min(ry * 5, bw * 0.5), null, (i, dx, dy) => {
      const yy = (i / size) | 0;
      const bb = Math.min(boards - 1, Math.floor((yy + 0.5) / bw));
      if (bb !== b) return;
      const ex = dx / rx;
      const ey = dy / ry;
      const e2 = ex * ex + ey * ey;
      KP[i] += sign * 2.2 * Math.exp(-e2 * 0.12);
      const e = Math.sqrt(e2);
      const core = sstep(1.15, 0.8, e) * (0.75 + 0.25 * Math.cos(e * 9));
      if (core > KD[i]) KD[i] = core;
    });
  }

  // --- main pass
  const gc = c.gapColor;
  const ca = c.colA;
  const cb = c.colB;
  const lt = c.lateTint || [1, 1, 1];
  const jHalf = (c.jointGapPx ?? c.gapPx) * 0.5;
  for (let y = 0; y < size; y++) {
    const yc = y + 0.5;
    let b = Math.floor(yc / bw);
    if (b >= boards) b = boards - 1;
    const ty = yc - b * bw;
    const edgeY = Math.min(ty, bw - ty);
    const row = rows[b];
    const gapHalf = c.gapPx * 0.5 * row.gapMul;
    const lyN = (ty - bw * 0.5) / bw;
    const pbase = b * maxP;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const P = params[pbase + row.sg[x]];
      let sx = x + P.ox;
      if (sx >= size) sx -= size;
      let sy = y + P.oy;
      if (sy >= size) sy -= size;
      const si = sy * size + sx;
      const fn = fine[si];
      const po = pores[si];
      const d = Math.min(edgeY - gapHalf, row.jd[x] - jHalf) + chipN[i] * c.chip;
      E[i] = d;
      const prof = d <= 0 ? 0 : d >= c.bevelPx ? 1 : sstep(0, c.bevelPx, d);
      const lxv = row.lx[x] - P.archX;
      // arch (cathedral) term; periodic along the board when the row has no butt joint
      const archT = row.noJ
        ? P.arch * 0.25 * archK * (1 - Math.cos((TAU * lxv) / size))
        : P.arch * 0.25 * (lxv / bw) * (lxv / bw);
      const phase = (ty + P.ringOff) / P.ringPx + warpF[si] * P.warpAmp + archT + KP[i] + fn * 0.35;
      const ri = Math.floor(phase);
      const rf = phase - ri;
      const st = 0.45 + hash01(ri, P.hs) * 0.3;
      const late = sstep(st, st + 0.25, rf) * (1 - sstep(0.94, 1.0, rf)) * (0.35 + 0.65 * hash01(ri + 7919, P.hs));
      const kd = KD[i];
      const gm = (1 - late * (1 - c.lateDark)) * (1 + fn * c.fineColor + po * poreColor) * P.val;
      let r = lerp(ca[0], cb[0], P.grey) * gm * lerp(1, lt[0], late);
      let g = lerp(ca[1], cb[1], P.grey) * gm * lerp(1, lt[1], late);
      let bl = lerp(ca[2], cb[2], P.grey) * gm * lerp(1, lt[2], late);
      if (kd > 0) {
        const kk = kd * 0.6;
        r *= 1 - kk;
        g *= 1 - kk * 1.05;
        bl *= 1 - kk * 1.1;
      }
      R[i] = lerp(gc[0], r, prof);
      G[i] = lerp(gc[1], g, prof);
      B[i] = lerp(gc[2], bl, prof);
      const top =
        P.h0 + P.tilt * lyN + c.cup * 4 * lyN * lyN + late * c.lateRelief + fn * c.fineAmp + po * poreAmp + kd * 0.15;
      H[i] = lerp(-c.gapDepth, top, prof);
      Ro[i] = lerp(0.95, c.baseRough + P.rough + fn * 0.05 - late * 0.04, prof);
    }
  }
  return { R, G, B, H, Ro, E, rows, bw, fine };
}

function crackField(size, cells, seed, warpPx, warpRes = 0) {
  // Distance-to-cell-edge field (F2 - F1, cell units) of a domain-warped Worley pattern.
  // Thin crack lines = 1 - sstep(0, width, e). The (smooth) warp may be computed at warpRes.
  const wr = warpRes && warpRes < size ? warpRes : size;
  let wx = fbm(wr, 5, 5, 4, seed + 11);
  let wy = fbm(wr, 5, 5, 4, seed + 12);
  if (wr !== size) {
    wx = upsampleWrap(wx, wr, size, F(size * size));
    wy = upsampleWrap(wy, wr, size, F(size * size));
  }
  const w = worley(size, cells, cells, seed, { warpX: wx, warpY: wy, warpAmp: warpPx });
  const e = F(size * size);
  for (let i = 0; i < size * size; i++) e[i] = w.f2[i] - w.f1[i];
  return e;
}

function hash01(a, b) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}


function to8(v) {
  v = v * 255 + 0.5;
  return v <= 0 ? 0 : v >= 255 ? 255 : v | 0;
}


// ===========================================================================
// SURFACES
// ===========================================================================

function genWoodFloor(size, mpr) {
  const n = size * size;
  const s = size / 1024;
  const rng = makeRng(1001);
  const boards = 11;
  const P = plankSurface(size, rng, {
    boards,
    pieces: [1, 3],
    gapPx: 2.4 * s,
    jointGapPx: 1.6 * s,
    bevelPx: 2.6 * s,
    chip: 1.2 * s,
    gapDepth: 5,
    cup: 0.45,
    h0: 0.35,
    tilt: 0.3,
    ringPx: [5 * s, 10 * s],
    arch: [0.15, 1.6],
    colA: [0.43, 0.35, 0.27],
    colB: [0.42, 0.395, 0.36],
    valueVar: 0.17,
    knots: 8,
    seed: 1100,
    lateDark: 0.66,
    lateTint: [1.0, 0.95, 0.9],
    lateRelief: 0.55,
    fineAmp: 0.25,
    poreAmp: 0.12,
    fineColor: 0.3,
    poreColor: 0.14,
    gapColor: [0.04, 0.034, 0.03],
    baseRough: 0.72,
  });
  const { R, G, B, H, Ro, E, bw } = P;
  const grime = fbm(size, 4, 4, 5, 1201, 0.55, size >> 1);
  const wear = fbm(size, 2, 3, 4, 1202, 0.5, size >> 2);
  const spots = fbm(size, 40, 40, 3, 1203, 0.6, size >> 1);
  const spill = eqfbm(size, 3, 3, 4, 1204, 0.5, size >> 2);
  const scr = F(n);
  drawScratches(size, scr, rng, 320, {
    alongProb: 0.7,
    angle: 0,
    spread: 0.35,
    lenMin: 10 * s,
    lenMax: 150 * s,
    wMin: 0.35 * s,
    wMax: 0.9 * s,
    iMin: 0.3,
    iMax: 1,
  });
  const gcol = [0.13, 0.105, 0.085];
  for (let i = 0; i < n; i++) {
    const e = E[i];
    const onB = sstep(0, 1.5 * s, e);
    const wr = sstep(0.0, 0.45, wear[i]);
    const edgeDirt = (1 - sstep(0.5 * s, 16 * s, e)) * 0.5;
    const gr = sstep(-0.15, 0.55, grime[i]);
    const sp = sstep(0.2, 0.6, spots[i]);
    const dirt = clamp01((gr * 0.6 + edgeDirt + sp * gr * 0.5) * (1 - wr * 0.65));
    const t = dirt * 0.72;
    let r = lerp(R[i], gcol[0], t);
    let g = lerp(G[i], gcol[1], t);
    let b = lerp(B[i], gcol[2], t);
    const lift = 1 + wr * 0.13 * onB;
    const sl = sstep(0.9, 0.96, spill[i]) * onB;
    const k = lift * (1 - sl * 0.32);
    r *= k;
    g *= k;
    b *= k;
    const sc = scr[i] * onB;
    r = lerp(r, 0.56, sc * 0.45);
    g = lerp(g, 0.47, sc * 0.45);
    b = lerp(b, 0.38, sc * 0.45);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] -= sc * 0.25 + wr * 0.1 * onB;
    Ro[i] = clamp(Ro[i] + dirt * 0.1 * onB - wr * 0.1 * onB - sc * 0.12 - sl * 0.15, 0.3, 1);
  }
  // nails: two per board over each joist, plus pairs at the butt ends
  const nail = (x, y) => {
    const r = 2.1 * s;
    forRect(size, x, y, r * 4, r * 4, null, (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      const head = sstep(1.12, 0.85, d);
      const halo = Math.exp(-d * d * 0.22) * (1 - head) * 0.5;
      R[i] = lerp(lerp(R[i], 0.24, halo * 0.6), 0.085, head);
      G[i] = lerp(lerp(G[i], 0.13, halo * 0.6), 0.08, head);
      B[i] = lerp(lerp(B[i], 0.07, halo * 0.6), 0.075, head);
      H[i] += head * 0.25 * (1 - d * d * 0.8) - halo * 0.05;
      Ro[i] = lerp(Ro[i], 0.5, head);
    });
  };
  const joists = 5;
  for (let b = 0; b < boards; b++) {
    const row = P.rows[b];
    for (let j = 0; j < joists; j++) {
      const jx = ((j + 0.5) * size) / joists;
      for (let side = -1; side <= 1; side += 2) {
        if (rng() < 0.12) continue;
        const nx = jx + (rng() * 2 - 1) * 2.5 * s;
        const ny = (b + 0.5) * bw + side * bw * 0.3 + (rng() * 2 - 1) * 1.5 * s;
        if (E[wrapIndex(size, nx, ny)] < 6 * s) continue;
        nail(nx, ny);
      }
    }
    for (let k = 0; k < row.cnt; k++) {
      const jxw = row.off + row.cum[k];
      for (let dir = -1; dir <= 1; dir += 2) {
        for (let side = -1; side <= 1; side += 2) {
          if (rng() < 0.2) continue;
          nail(jxw + dir * 8 * s, (b + 0.5) * bw + side * bw * 0.3);
        }
      }
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.7, aoStrength: 0.13, aoRadius: 4 * s });
}

function genPlaster(size, mpr) {
  const n = size * size;
  const s = size / 1024;
  const rng = makeRng(2001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const mottle = fbm(size, 3, 3, 5, 2101, 0.5, size >> 1);
  const blot = fbm(size, 9, 9, 4, 2102, 0.55, size >> 1);
  const fine = fbm(size, 96, 96, 3, 2103, 0.5, 0, size >> 2);
  const dirtN = fbm(size, 5, 5, 4, 2111, 0.5, size >> 2);
  const trowel = fbm(size, 14, 8, 4, 2112, 0.55, size >> 1);
  const stain = eqfbm(size, 4, 2, 4, 2104, 0.5, size >> 1);
  const streakN = fbm(size, 48, 3, 3, 2105, 0.5, size >> 1);
  const crackMask = eqfbm(size, 3, 3, 3, 2106, 0.5, size >> 2);
  const ce = crackField(size, 6, 2109, 40 * s, size >> 1);
  const hair = fbm(size, 8, 8, 3, 2110, 0.5, size >> 1);
  // dirty runs trailing down from the water stains
  const SM = F(n);
  for (let i = 0; i < n; i++) SM[i] = sstep(0.8, 0.86, stain[i]) * sstep(0.0, 0.45, streakN[i]);
  const runs = smearDown(SM, size, 0.994);

  // dirt speckles & mildew dots
  const SP = F(n);
  const dot = (x, y, r, v) => {
    forRect(size, x, y, r + 1.5, r + 1.5, null, (i, dx, dy) => {
      const c = sstep(r + 0.7, r - 0.3, Math.sqrt(dx * dx + dy * dy)) * v;
      if (c > SP[i]) SP[i] = c;
    });
  };
  for (let k = 0; k < 900; k++) dot(rng() * size, rng() * size, (0.4 + Math.pow(rng(), 3) * 1.8) * s, 0.2 + rng() * 0.5);
  for (let k = 0; k < 25; k++) {
    const cx = rng() * size;
    const cy = rng() * size;
    for (let j = 0; j < 20; j++) {
      const a = rng() * TAU;
      const d = Math.pow(rng(), 0.7) * 26 * s;
      dot(cx + Math.cos(a) * d, cy + Math.sin(a) * d, (0.4 + rng() * 1.1) * s, 0.3 + rng() * 0.45);
    }
  }

  // spalled patches (plaster fallen off): brick or lath behind
  const PM = F(n).fill(-1);
  const PT = F(n);
  for (let k = 0; k < 3; k++) {
    const px = rng() * size;
    const py = rng() * size;
    const pr = (35 + rng() * 45) * s;
    const type = k === 1 ? 1 : 0;
    forRect(size, px, py, pr * 1.8, pr * 1.8, null, (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy);
      const rr = pr * (1 + 0.6 * blot[i] + 0.3 * fine[i]);
      const v = 1 - d / Math.max(rr, 1);
      if (v > PM[i]) {
        PM[i] = v;
        PT[i] = type;
      }
    });
  }

  const brickRows = 36;
  const brickCols = 11;
  const brh = size / brickRows;
  const brl = size / brickCols;
  const lathN = 51;
  const lathP = size / lathN;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const m = mottle[i] * 0.5 + 0.5;
      const bl = blot[i];
      const fn = fine[i];
      const t1 = sstep(0.3, 0.72, m);
      let r = lerp(0.68, 0.55, t1);
      let g = lerp(0.675, 0.585, t1);
      let b = lerp(0.62, 0.52, t1);
      const t2 = sstep(0.1, 0.5, bl) * 0.45;
      r = lerp(r, 0.62, t2);
      g = lerp(g, 0.585, t2);
      b = lerp(b, 0.49, t2);
      const dd = sstep(-0.2, 0.6, dirtN[i]) * 0.22;
      const fm = (0.94 + fn * 0.1 + trowel[i] * 0.04) * (1 - dd);
      r *= fm;
      g *= fm * 0.99;
      b *= fm * 0.96;
      // water stains with tide lines, dirty runs below
      const sv = stain[i];
      const inS = sstep(0.8, 0.86, sv);
      const band = Math.exp(-(((sv - 0.82) / 0.022) ** 2)) * inS;
      const st = inS * 0.45 + band * 0.55;
      r *= 1 - 0.07 * st;
      g *= 1 - 0.12 * st;
      b *= 1 - 0.24 * st;
      const tide = Math.exp(-(((sv - 0.805) / 0.007) ** 2)) * 0.4 + Math.exp(-(((sv - 0.92) / 0.006) ** 2)) * 0.22;
      r = lerp(r, 0.5, tide);
      g = lerp(g, 0.4, tide);
      b = lerp(b, 0.27, tide);
      const rn = runs[i] * 0.55;
      r *= 1 - 0.1 * rn;
      g *= 1 - 0.16 * rn;
      b *= 1 - 0.28 * rn;
      // sparse cracks: warped cell edges + noise zero-crossing hairlines
      const cm = crackMask[i];
      const cmk = sstep(0.82, 0.9, cm);
      const e = ce[i];
      const cr = (1 - sstep(0.0, 0.012, e)) * cmk;
      const halo = (1 - sstep(0, 0.05, e)) * cmk * 0.15;
      const hl = (1 - sstep(0, 0.012, Math.abs(hair[i]))) * sstep(0.86, 0.93, 1 - cm) * 0.6;
      const crack = Math.max(cr, hl);
      const cd = (1 - crack * 0.6) * (1 - halo);
      r *= cd;
      g *= cd;
      b *= cd;
      // speckles
      const sp = SP[i];
      r = lerp(r, 0.16, sp * 0.8);
      g = lerp(g, 0.15, sp * 0.8);
      b = lerp(b, 0.12, sp * 0.8);
      let h = mottle[i] * 1.2 + bl * 0.6 + trowel[i] * 1.2 + fn * 0.55 - crack * 1.3 + sp * 0.05;
      let ro = 0.9 + fn * 0.04 - inS * 0.04 + crack * 0.05;

      // spalled patch
      const pm = PM[i];
      if (pm > -0.1) {
        const inside = sstep(-0.004, 0.012, pm);
        const edge = sstep(-0.1, -0.015, pm) * (1 - inside);
        if (edge > 0) {
          const ev = edge * 0.4;
          r = lerp(r, 0.7 * (0.9 + fn * 0.2), ev);
          g = lerp(g, 0.69 * (0.9 + fn * 0.2), ev);
          b = lerp(b, 0.65 * (0.9 + fn * 0.2), ev);
          h -= edge * (0.6 + 0.5 * fn);
          ro = lerp(ro, 0.95, edge);
        }
        if (inside > 0) {
          let sr;
          let sg;
          let sb;
          let shh;
          let sro;
          if (PT[i] < 0.5) {
            // old brick with dirty mortar and plaster residue
            const yc = y + 0.5;
            const rowI = Math.floor(yc / brh);
            const ly = yc - rowI * brh;
            const xx = x + 0.5 + (rowI & 1 ? brl * 0.5 : 0);
            const colI = Math.floor(xx / brl);
            const lx = xx - colI * brl;
            const dd2 = Math.min(Math.min(lx, brl - lx), Math.min(ly, brh - ly)) - 2 * s + fn * 1.2 * s;
            const bm = sstep(0, 1.5 * s, dd2);
            const kk = hash01(rowI, colI % brickCols);
            const tone = 0.75 + kk * 0.4;
            sr = lerp(0.4, 0.31 * tone, bm);
            sg = lerp(0.38, 0.19 * tone, bm);
            sb = lerp(0.34, 0.15 * tone, bm);
            const res = sstep(0.0, 0.45, bl + fn * 0.3) * 0.6;
            sr = lerp(sr, 0.58, res);
            sg = lerp(sg, 0.56, res);
            sb = lerp(sb, 0.51, res);
            shh = -8 + bm * 1.8 + fn * 0.4 + res * 0.6;
            sro = lerp(0.95, 0.86, bm);
          } else {
            // wood lath strips with plaster keys squeezed through the gaps
            const yc = y + 0.5;
            const li = Math.floor(yc / lathP);
            const ly = yc - li * lathP;
            const gh = (1.6 + hash01(li, 3) * 1.6 + fn * 0.8) * s;
            const dd2 = Math.min(ly, lathP - ly) - gh;
            const lm = sstep(0, 1.2 * s, dd2);
            const key = sstep(0.2, 0.45, bl + fn * 0.3) * (1 - lm);
            const wt = 0.8 + streakN[i] * 0.15 + fn * 0.15 + hash01(li, 11) * 0.25;
            sr = lerp(0.05, 0.3 * wt, lm);
            sg = lerp(0.045, 0.24 * wt, lm);
            sb = lerp(0.04, 0.17 * wt, lm);
            sr = lerp(sr, 0.42, key * 0.8);
            sg = lerp(sg, 0.4, key * 0.8);
            sb = lerp(sb, 0.37, key * 0.8);
            shh = -12 + lm * 4 + key * 3 + fn * 0.3;
            sro = 0.86;
          }
          r = lerp(r, sr, inside);
          g = lerp(g, sg, inside);
          b = lerp(b, sb, inside);
          h = lerp(h, shh, inside);
          ro = lerp(ro, sro, inside);
        }
      }
      R[i] = r;
      G[i] = g;
      B[i] = b;
      H[i] = h;
      Ro[i] = ro;
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 2.2, aoStrength: 0.08, aoRadius: 5 * s });
}

function genPlasterExterior(size, mpr) {
  const n = size * size;
  const s = size / 1024;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const stucco = worley(size, 152, 152, 3101, { tileRes: size >> 2 });
  const fine = fbm(size, 128, 128, 2, 3102, 0.5, 0, size >> 2);
  const mid = fbm(size, 14, 14, 4, 3103, 0.5, size >> 1);
  const mottle = fbm(size, 3, 3, 5, 3104, 0.55, size >> 1);
  const streak = fbm(size, 28, 2, 3, 3105, 0.5, size >> 1);
  const streakF = fbm(size, 90, 3, 2, 3112, 0.5, size >> 1);
  const streakMask = fbm(size, 7, 2, 3, 3106, 0.5, size >> 2);
  const moss = eqfbm(size, 5, 4, 5, 3107, 0.55, size >> 1);
  const ce = crackField(size, 5, 3110, 40 * s, size >> 1);
  const cMask = eqfbm(size, 3, 3, 3, 3111, 0.5, size >> 2);
  const patchN = eqfbm(size, 4, 4, 4, 3113, 0.5, size >> 2);
  for (let i = 0; i < n; i++) {
    const st = 1 - stucco.f1[i];
    const rp = sstep(0.86, 0.875, patchN[i]);
    const rpEdge = Math.exp(-(((patchN[i] - 0.868) / 0.004) ** 2)) * 0.3;
    const stH = st * st * (1 - rp * 0.6);
    const gtone = (stucco.id[i] - 0.5) * 0.07 * (1 - rp * 0.5);
    const t1 = sstep(-0.3, 0.35, mottle[i]);
    let r = lerp(0.47, 0.56, t1);
    let g = lerp(0.475, 0.55, t1);
    let b = lerp(0.465, 0.515, t1);
    r = lerp(r, 0.58, rp * 0.25);
    g = lerp(g, 0.58, rp * 0.25);
    b = lerp(b, 0.56, rp * 0.25);
    const fm = (1 + gtone + fine[i] * 0.1 + mid[i] * 0.08) * (1 - rpEdge * 0.25);
    r *= fm;
    g *= fm;
    b *= fm;
    // vertical rain streaks (broad soft ones + a few sharper runs)
    const sm = streakMask[i];
    const sv = clamp01(
      sstep(0.05, 0.55, streak[i]) * sstep(-0.15, 0.45, sm) * 0.6 + sstep(0.2, 0.6, streakF[i]) * 0.25 * sstep(-0.3, 0.3, sm),
    );
    r = lerp(r, 0.25, sv * 0.7);
    g = lerp(g, 0.245, sv * 0.7);
    b = lerp(b, 0.23, sv * 0.7);
    // sparse moss / mildew
    const mv = sstep(0.925, 0.975, moss[i] + fine[i] * 0.05) * 0.8;
    const f01 = fine[i] * 0.5 + 0.5;
    r = lerp(r, lerp(0.19, 0.27, f01), mv * 0.85);
    g = lerp(g, lerp(0.22, 0.26, f01), mv * 0.85);
    b = lerp(b, lerp(0.13, 0.17, f01), mv * 0.85);
    const mdw = sstep(0.25, 0.6, fine[i]) * sstep(0.8, 0.9, moss[i]) * 0.35;
    r = lerp(r, 0.17, mdw);
    g = lerp(g, 0.17, mdw);
    b = lerp(b, 0.15, mdw);
    // cracks with a dirty halo
    const e = ce[i];
    const cm = sstep(0.72, 0.8, cMask[i]);
    const crack = (1 - sstep(0, 0.012, e)) * cm;
    const halo = (1 - sstep(0, 0.05, e)) * cm * 0.2;
    const cd = 1 - crack * 0.6 - halo * 0.3;
    R[i] = r * cd;
    G[i] = g * cd;
    B[i] = b * cd;
    H[i] = mid[i] * 1.8 + mottle[i] * 1.4 + stH * 1.3 + fine[i] * 0.35 - crack * 2.5 + mv * 0.5 + rp * 0.3;
    Ro[i] = clamp(0.86 + fine[i] * 0.05 - sv * 0.3 - mv * 0.08 + crack * 0.05 - rp * 0.06, 0.3, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 2.2, aoStrength: 0.12, aoRadius: 3 * s });
}

function genWoodBeam(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(4001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const grain = fbm(size, 96, 3, 2, 4101);
  const grain2 = fbm(size, 36, 2, 3, 4102);
  const warpF = fbm(size, 8, 2, 3, 4103);
  const scoop = fbm(size, 3, 5, 4, 4104, 0.5, size >> 1);
  const mottle = fbm(size, 3, 3, 4, 4105, 0.5, size >> 1);
  const fine = fbm(size, 128, 64, 2, 4106);
  const soot = fbm(size, 4, 2, 4, 4107, 0.5, size >> 1);
  const CK = F(n);
  // checking cracks along V (lens shaped, nearly straight, following the grain)
  for (let k = 0; k < 8; k++) {
    const x0 = rng() * size;
    const y0 = rng() * size;
    const L = (0.2 + rng() * 0.6) * size;
    const wmax = (0.9 + rng() * 2.2) * s;
    const A = (0.5 + rng() * 1.5) * s;
    const fq = 0.3 + rng() * 0.7;
    const ph = rng() * TAU;
    const drift = (rng() * 2 - 1) * 5 * s;
    const Li = Math.ceil(L);
    for (let yy = 0; yy <= Li; yy++) {
      const t = Math.min(1, yy / L);
      const w = wmax * Math.pow(Math.sin(Math.PI * t), 0.6);
      const yw = Math.floor(y0 + yy) % size;
      const xc0 = x0 + A * Math.sin(t * TAU * fq + ph) + drift * t;
      const xc = xc0 + grain2[yw * size + (((Math.floor(xc0) % size) + size) % size)] * 3 * s;
      const row = yw * size;
      const xa = Math.floor(xc - w - 2);
      const xb = Math.ceil(xc + w + 2);
      for (let x = xa; x <= xb; x++) {
        let c = sstep(w + 0.7, w - 0.3, Math.abs(x + 0.5 - xc));
        if (w < 0.6) c *= w / 0.6;
        let xi = x % size;
        if (xi < 0) xi += size;
        const i = row + xi;
        if (c > CK[i]) CK[i] = c;
      }
    }
  }
  const rings = Math.round(size / (7 * s));
  for (let y = 0; y < size; y++) {
    const ys = Math.sin((y / size) * TAU * 2 + 1.3) * 0.4;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const phase = (x / size) * rings + warpF[i] * 1.6 + grain2[i] * 0.6 + ys + fine[i] * 0.2;
      const ri = Math.floor(phase);
      const rf = phase - ri;
      const late = sstep(0.6, 0.88, rf) * (1 - sstep(0.95, 1, rf)) * (0.4 + 0.6 * hash01(ri, 77));
      const g0 = grain[i];
      const greyT = sstep(-0.25, 0.35, mottle[i]);
      let r = lerp(0.285, 0.3, greyT);
      let g = lerp(0.222, 0.28, greyT);
      let b = lerp(0.168, 0.25, greyT);
      const mul = (1 - late * 0.3) * (1 + g0 * 0.35 + fine[i] * 0.1) * (0.92 + scoop[i] * 0.2);
      const so = sstep(0.0, 0.6, soot[i]) * 0.3;
      const k = mul * (1 - so);
      r *= k;
      g *= k;
      b *= k;
      const ck = CK[i];
      R[i] = lerp(r, 0.03, ck);
      G[i] = lerp(g, 0.026, ck);
      B[i] = lerp(b, 0.022, ck);
      H[i] = scoop[i] * 2.2 + late * 0.6 + g0 * 0.55 + fine[i] * 0.12 - ck * 7;
      Ro[i] = clamp(0.84 + g0 * 0.05 - late * 0.04 + ck * 0.1 + so * 0.05, 0.4, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.6, aoStrength: 0.12, aoRadius: 3 * s });
}

function genCeilingBoards(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(5001);
  const P = plankSurface(size, rng, {
    boards: 20,
    pieces: [1, 1],
    jointProb: 0.55,
    gapPx: 0.9 * s,
    jointGapPx: 0.9 * s,
    bevelPx: 2.4 * s,
    chip: 0.5 * s,
    gapDepth: 3.5,
    cup: 0.15,
    h0: 0.2,
    tilt: 0.15,
    ringPx: [3 * s, 6 * s],
    arch: [0.2, 1.2],
    colA: [0.27, 0.2, 0.14],
    colB: [0.245, 0.2, 0.16],
    valueVar: 0.2,
    knots: 6,
    seed: 5100,
    lateDark: 0.72,
    lateRelief: 0.25,
    fineAmp: 0.15,
    fineColor: 0.25,
    poreColor: 0.1,
    gapColor: [0.03, 0.025, 0.02],
    baseRough: 0.78,
  });
  const { R, G, B, H, Ro, E } = P;
  const stain = eqfbm(size, 3, 3, 4, 5201, 0.45, size >> 1);
  const soot = fbm(size, 4, 4, 4, 5202, 0.5, size >> 1);
  const speck = fbm(size, 64, 64, 2, 5203);
  for (let i = 0; i < n; i++) {
    const v = stain[i];
    const inside = sstep(0.72, 0.8, v);
    const ring = Math.exp(-(((v - 0.735) / 0.008) ** 2));
    const ring2 = Math.exp(-(((v - 0.87) / 0.007) ** 2)) * 0.7;
    const mold = inside * sstep(0.3, 0.6, speck[i]) * 0.45;
    const so = sstep(0, 0.6, soot[i]) * 0.3;
    const onB = sstep(0, 1.2 * s, E[i]);
    const dk = (1 - inside * 0.25) * (1 - so);
    let r = R[i] * dk;
    let g = G[i] * dk;
    let b = B[i] * dk;
    const rv = clamp01(ring * 0.35 + ring2 * 0.25) * onB;
    r = lerp(r, 0.4, rv);
    g = lerp(g, 0.35, rv);
    b = lerp(b, 0.28, rv);
    r = lerp(r, 0.05, mold);
    g = lerp(g, 0.05, mold);
    b = lerp(b, 0.04, mold);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] += inside * 0.15 + ring * 0.05;
    Ro[i] = clamp(Ro[i] - inside * 0.06 + rv * 0.05, 0.3, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.4, aoStrength: 0.15, aoRadius: 2 * s });
}

function genWoodPainted(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const grain = fbm(size, 96, 3, 2, 6101);
  const warpF = fbm(size, 8, 2, 3, 6102);
  const pn = fbm(size, 10, 3, 6, 6103, 0.6);
  for (let i = 0; i < n; i++) pn[i] += grain[i] * 0.25;
  equalize(pn);
  const craq = worley(size, 40, 12, 6104, { jitter: 0.9 });
  const craqMask = fbm(size, 4, 4, 3, 6107, 0.5, size >> 1);
  const dirt = fbm(size, 4, 4, 4, 6105, 0.5, size >> 1);
  const fine = fbm(size, 128, 128, 2, 6106);
  const rings = Math.round(size / (6 * s));
  const topT = 0.7;
  const grT = 0.82;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const phase = (x / size) * rings + warpF[i] * 2.5 + grain[i] * 0.8;
      const rf = phase - Math.floor(phase);
      const late = sstep(0.6, 0.88, rf) * (1 - sstep(0.95, 1, rf));
      const fn = fine[i];
      const wm = (1 - late * 0.3) * (1 + grain[i] * 0.3 + fn * 0.08);
      let r = 0.45 * wm;
      let g = 0.42 * wm;
      let b = 0.37 * wm;
      const woodH = late * 0.5 + grain[i] * 0.45 + fn * 0.1;
      const v = pn[i];
      const top = sstep(topT + 0.004, topT - 0.004, v);
      const gre = sstep(grT + 0.004, grT - 0.004, v);
      const topEdge = Math.exp(-(((v - topT) / 0.006) ** 2));
      const greEdge = Math.exp(-(((v - grT) / 0.006) ** 2));
      const gm = 0.9 + fn * 0.15 + dirt[i] * 0.1;
      const wmul = 0.92 + fn * 0.08 + dirt[i] * 0.1;
      r = lerp(r, 0.4 * gm, gre);
      g = lerp(g, 0.48 * gm, gre);
      b = lerp(b, 0.39 * gm, gre);
      r = lerp(r, 0.74 * wmul, top);
      g = lerp(g, 0.72 * wmul, top);
      b = lerp(b, 0.64 * wmul, top);
      const crackP = (1 - sstep(0.0, 0.06, craq.f2[i] - craq.f1[i])) * top * sstep(0.0, 0.4, craqMask[i]);
      const dd = sstep(-0.1, 0.5, dirt[i]) * 0.18;
      const k = (1 - crackP * 0.4) * (1 - 0.28 * clamp01(topEdge + greEdge * 0.6)) * (1 - dd);
      R[i] = r * k;
      G[i] = g * k;
      B[i] = b * k;
      H[i] = woodH * 1.4 * (1 - 0.55 * gre) + gre * 0.5 + top * 0.6 + topEdge * 0.15 - crackP * 0.25;
      Ro[i] = clamp(lerp(lerp(0.86, 0.68, gre), 0.52, top) + dd * 0.15 + crackP * 0.15, 0.3, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 2.2, aoStrength: 0.2, aoRadius: 2 * s });
}

function genConcrete(size, mpr) {
  const n = size * size;
  const s = size / 1024;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const mottle = fbm(size, 4, 4, 5, 7101, 0.5, size >> 1);
  const mid = fbm(size, 16, 16, 4, 7102, 0.5, size >> 1);
  const fine = fbm(size, 128, 128, 2, 7103, 0.5, 0, size >> 2);
  const agg = worley(size, 112, 112, 7104, { tileRes: size >> 2 });
  const pits = worley(size, 40, 40, 7105, { tileRes: size >> 1 });
  const stain = eqfbm(size, 3, 3, 5, 7106, 0.55, size >> 1);
  const eff = eqfbm(size, 5, 3, 5, 7107, 0.6, size >> 1);
  const cr1 = crackField(size, 4, 7110, 36 * s, size >> 1);
  const cr2 = crackField(size, 10, 7111, 22 * s, size >> 1);
  const cm1 = eqfbm(size, 3, 3, 3, 7112, 0.5, size >> 2);
  const cm2 = eqfbm(size, 4, 4, 3, 7113, 0.5, size >> 2);
  const oil = eqfbm(size, 6, 6, 4, 7114, 0.55, size >> 1);
  for (let i = 0; i < n; i++) {
    const t1 = sstep(-0.3, 0.3, mottle[i]);
    let r = lerp(0.41, 0.49, t1);
    let g = lerp(0.405, 0.48, t1);
    let b = lerp(0.395, 0.455, t1);
    const warm = sstep(0.1, 0.5, mid[i]) * 0.5;
    r = lerp(r, r * 1.05, warm);
    b = lerp(b, b * 0.96, warm);
    const fm = 1 + fine[i] * 0.08 + mid[i] * 0.06;
    r *= fm;
    g *= fm;
    b *= fm;
    // aggregate (sparse, low contrast)
    const ag = agg.id[i];
    const stone = (ag > 0.9 ? 1 : 0) * sstep(0.34, 0.26, agg.f1[i]) * 0.6;
    const st = ag > 0.95 ? 0.85 : 1.1;
    r = lerp(r, r * st, stone);
    g = lerp(g, g * st, stone);
    b = lerp(b, b * st * 0.98, stone);
    // pits (small air holes)
    const pit = Math.max(
      (pits.id[i] < 0.035 ? 1 : 0) * sstep(0.14, 0.07, pits.f1[i]) * 0.8,
      (ag < 0.02 ? 1 : 0) * sstep(0.2, 0.12, agg.f1[i]) * 0.55,
    );
    // damp stains with faint tide lines
    const sv = stain[i];
    const damp = sstep(0.72, 0.94, sv);
    const dk = 1 - damp * 0.16;
    r *= dk;
    g *= dk;
    b *= dk * 0.98;
    const tide = Math.exp(-(((sv - 0.74) / 0.01) ** 2)) * 0.12;
    r *= 1 - tide;
    g *= 1 - tide;
    b *= 1 - tide * 1.05;
    // oil / dirt spots
    const ol = sstep(0.94, 0.98, oil[i]) * 0.35;
    r = lerp(r, 0.14, ol);
    g = lerp(g, 0.13, ol);
    b = lerp(b, 0.12, ol);
    // efflorescence (streaky, whitish, powdery)
    const ef = sstep(0.9, 0.97, eff[i] + fine[i] * 0.06) * (1 - damp * 0.5) * 0.36 * (0.5 + 0.5 * sstep(-0.2, 0.3, fine[i]));
    r = lerp(r, 0.74, ef);
    g = lerp(g, 0.73, ef);
    b = lerp(b, 0.69, ef);
    // cracks
    const c1 = (1 - sstep(0, 0.012, cr1[i])) * sstep(0.75, 0.82, cm1[i]);
    const c2 = (1 - sstep(0, 0.02, cr2[i])) * sstep(0.88, 0.93, cm2[i]) * 0.8;
    const crack = Math.max(c1, c2);
    const cd = 1 - crack * 0.7 - pit * 0.5;
    R[i] = r * cd;
    G[i] = g * cd;
    B[i] = b * cd;
    H[i] = mottle[i] * 1.5 + mid[i] * 1.0 + fine[i] * 0.45 + stone * 0.3 - pit * 1.6 - crack * 3 + ef * 0.15;
    Ro[i] = clamp(0.87 + fine[i] * 0.05 - damp * 0.3 - ol * 0.4 + ef * 0.08 + pit * 0.05, 0.3, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 2.0, aoStrength: 0.12, aoRadius: 3 * s });
}

function genRoof(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(8001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const courses = 16;
  const ch = size / courses;
  const tabs = 6;
  const tw = size / tabs;
  const slotHalf = 1.5 * s;
  const slotLen = 0.62;
  const tp = new Float32Array(courses * tabs * 4);
  for (let k = 0; k < courses * tabs; k++) {
    tp[k * 4] = 0.85 + rng() * 0.3; // tone
    tp[k * 4 + 1] = rng() < 0.22 ? 0.08 + rng() * 0.12 : 0; // brownish hue
    tp[k * 4 + 2] = (rng() * 2 - 1) * 0.8; // curl (mm)
    tp[k * 4 + 3] = rng(); // granule loss
  }
  const gran = worley(size, 150, 150, 8101, { tileRes: size >> 1 });
  const fine = fbm(size, 128, 128, 1, 8102);
  const mossN = eqfbm(size, 4, 4, 5, 8103, 0.55, size >> 1);
  const mossD = fbm(size, 64, 64, 2, 8104);
  const streak = fbm(size, 36, 2, 3, 8105);
  const wear = fbm(size, 8, 8, 4, 8106);
  for (let y = 0; y < size; y++) {
    const yc = y + 0.5;
    const c = Math.floor(yc / ch);
    const lv = (yc - c * ch) / ch;
    const off = c & 1 ? tw * 0.5 : 0;
    const shadow = sstep(0.84, 1.0, lv) * 0.45; // under the next course's butt edge
    const butt = 1 - sstep(0, 0.06, lv);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xx = x + 0.5 + off;
      let t = Math.floor(xx / tw);
      const lx = xx - t * tw;
      t %= tabs;
      const k = (c * tabs + t) * 4;
      const ds = Math.min(lx, tw - lx);
      const slot = sstep(slotHalf + 0.8, slotHalf - 0.3, ds) * sstep(slotLen + 0.04, slotLen - 0.02, lv);
      const g1 = 1 - gran.f1[i];
      const gid = gran.id[i];
      const speck = gid > 0.97 ? 1.3 : gid < 0.04 ? 0.7 : 0.9 + gid * 0.2;
      const loss = sstep(0.2, 0.6, wear[i] + tp[k + 3] * 0.4) * 0.3;
      const base = 0.175 * tp[k] * lerp(speck, 1, loss) * (1 + loss * 0.4);
      let r = base;
      let g = base;
      let b = base * 1.03;
      const hue = tp[k + 1];
      r *= 1 + hue * 1.2;
      g *= 1 + hue * 0.55;
      b *= 1 - hue * 0.3;
      const dk = (1 - shadow) * (1 - butt * 0.2);
      r *= dk;
      g *= dk;
      b *= dk;
      r = lerp(r, 0.04, slot);
      g = lerp(g, 0.04, slot);
      b = lerp(b, 0.04, slot);
      const sv = sstep(0.1, 0.5, streak[i]) * 0.3;
      r *= 1 - sv;
      g *= 1 - sv * 0.95;
      b *= 1 - sv;
      // moss clumps near butts and in slots
      const md = mossD[i];
      const mv = sstep(0.84, 0.95, mossN[i] + slot * 0.12 + md * 0.12) * Math.max(sstep(0.55, 0.12, lv), slot);
      const mc = 0.75 + md * 0.4;
      r = lerp(r, 0.2 * mc, mv);
      g = lerp(g, 0.23 * mc, mv);
      b = lerp(b, 0.1 * mc, mv);
      R[i] = r;
      G[i] = g;
      B[i] = b;
      let h = 3.2 * (1 - lv) + tp[k + 2] * (1 - lv) * (1 - lv) + g1 * g1 * 0.35 * (1 - loss) + fine[i] * 0.05;
      h = lerp(h, 0.2, slot);
      h += mv * (0.6 + 0.8 * md);
      H[i] = h;
      Ro[i] = clamp(0.8 + gid * 0.08 + slot * 0.08 + mv * 0.08 - loss * 0.05, 0.3, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.3, aoStrength: 0.15, aoRadius: 3 * s });
}

function genMud(size, mpr) {
  const n = size * size;
  const s = size / 1024;
  const pxm = size / mpr;
  const mmpp = (1000 * mpr) / size;
  const rng = makeRng(9001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const big = fbm(size, 3, 3, 6, 9101, 0.5, size >> 1);
  const mid = fbm(size, 10, 10, 4, 9102, 0.5, size >> 1);
  const fine = fbm(size, 96, 96, 3, 9103, 0.5, 0, size >> 1);
  const clump = worley(size, 60, 60, 9104, { lowRes: size >> 1 });
  const tone = fbm(size, 5, 5, 4, 9105, 0.5, size >> 2);
  for (let i = 0; i < n; i++) {
    const c = 1 - clump.f1[i];
    H[i] = big[i] * 38 + mid[i] * 9 + fine[i] * 1.4 + c * c * 2.5;
  }
  // tire ruts (appear over part of the tile, periodic in x)
  const r0 = rng() * size;
  const gauge = 1.55 * pxm;
  const halfW = 0.11 * pxm;
  const ph1 = rng() * TAU;
  const ph2 = rng() * TAU;
  const phm = rng() * TAU;
  const phd = rng() * TAU;
  const treadN = Math.round(size / (9 * s));
  for (let x = 0; x < size; x++) {
    const xn = x / size;
    const m = sstep(-0.35, 0.25, Math.sin(xn * TAU + phm));
    if (m <= 0) continue;
    const depth = 20 * (0.6 + 0.4 * Math.sin(xn * TAU * 2 + phd));
    const wob = Math.sin(xn * TAU + ph1) * 18 * s + Math.sin(xn * TAU * 3 + ph2) * 5 * s;
    for (let k = 0; k < 2; k++) {
      const yc = r0 + k * gauge + wob;
      const y0 = Math.floor(yc - halfW * 2);
      const y1 = Math.ceil(yc + halfW * 2);
      for (let y = y0; y <= y1; y++) {
        const d = Math.abs(y + 0.5 - yc);
        const q = d / halfW;
        let prof = 6 * Math.exp(-(((q - 1.3) / 0.35) ** 2));
        if (q < 1) prof -= depth * (0.5 + 0.5 * Math.cos(Math.PI * q));
        if (q < 0.85) {
          const tph = xn * treadN + d / (halfW * 0.5);
          prof += 1.8 * sstep(0.2, 0.6, Math.sin(tph * TAU) * 0.5 + 0.5) * sstep(0.85, 0.5, q);
        }
        let yy = y % size;
        if (yy < 0) yy += size;
        H[yy * size + x] += prof * m;
      }
    }
  }
  // boot prints along a wandering path
  {
    let px = rng() * size;
    let py = rng() * size;
    let dir = rng() * TAU;
    const L = 0.29 * pxm;
    const W = 0.105 * pxm;
    const lug = 5 * s;
    for (let k = 0; k < 14; k++) {
      dir += (rng() * 2 - 1) * 0.25;
      px += Math.cos(dir) * 0.36 * pxm;
      py += Math.sin(dir) * 0.36 * pxm;
      const side = k & 1 ? 1 : -1;
      const fx = px + Math.cos(dir + Math.PI / 2) * side * 0.09 * pxm;
      const fy = py + Math.sin(dir + Math.PI / 2) * side * 0.09 * pxm;
      const ca = Math.cos(dir);
      const sa = Math.sin(dir);
      const dpt = 4 + rng() * 5;
      forRect(size, fx, fy, L * 0.7, L * 0.7, null, (i, dx, dy) => {
        const u = (dx * ca + dy * sa) / L;
        const v = (-dx * sa + dy * ca) / W;
        const es = ((u - 0.12) / 0.36) ** 2 + (v / 0.5) ** 2;
        const eh = ((u + 0.33) / 0.17) ** 2 + (v / 0.42) ** 2;
        const e = Math.min(es, eh);
        if (e > 2.2) return;
        const inside = sstep(1.08, 0.9, e);
        const rim = Math.exp(-(((e - 1.2) / 0.2) ** 2));
        const tread = inside * sstep(0.3, 0.7, 0.5 + 0.5 * Math.sin(((u * L) / lug) * TAU));
        H[i] += -dpt * inside + tread * 1.5 + rim * 2.5;
      });
    }
  }
  // stones (partly embedded)
  const SC = F(n);
  const ST = F(n);
  const SD = F(n);
  for (let k = 0; k < 220; k++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (1.4 + 6 * Math.pow(rng(), 2.3)) * s * 1.3;
    const asp = 0.6 + rng() * 0.4;
    const ang = rng() * TAU;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    const hs = r * mmpp * 0.4;
    const tn = rng();
    forRect(size, x, y, r + 2, r + 2, null, (i, dx, dy) => {
      const u = (dx * ca + dy * sa) / r;
      const v = (-dx * sa + dy * ca) / (r * asp);
      const e = u * u + v * v;
      if (e > 1.3) return;
      const c = sstep(1.1, 0.75, e);
      if (c <= 0) return;
      const dome = Math.sqrt(Math.max(0, 1 - e));
      H[i] += c * (dome * hs + 0.3);
      if (c > SC[i]) {
        SC[i] = c;
        ST[i] = tn;
        SD[i] = dome;
      }
    });
  }
  // dead straw grass: flattened clumps + loose strands
  const GC = F(n);
  const GT = F(n);
  const strand = (x0, y0, ang, len, w, tn, curve) => {
    let x = x0;
    let y = y0;
    let a = ang;
    const segL = len / 3;
    for (let sgi = 0; sgi < 3; sgi++) {
      const x1 = x + Math.cos(a) * segL;
      const y1 = y + Math.sin(a) * segL;
      forSegment(size, x, y, x1, y1, w + 1, null, (i, d, t) => {
        const T = (sgi + t) / 3;
        const c = sstep(w + 0.6, w - 0.3, d) * (1 - T * 0.35);
        if (c > GC[i]) {
          GC[i] = c;
          GT[i] = tn + T * 0.12;
        }
      });
      x = x1;
      y = y1;
      a += curve;
    }
  };
  for (let k = 0; k < 40; k++) {
    const bx = rng() * size;
    const by = rng() * size;
    const main = rng() * TAU;
    const cnt = 6 + Math.floor(rng() * 10);
    for (let j = 0; j < cnt; j++) {
      const a = main + (rng() * 2 - 1) * 0.6 + (rng() < 0.2 ? Math.PI : 0);
      const oa = rng() * TAU;
      const o = Math.sqrt(rng()) * 16 * s;
      strand(
        bx + Math.cos(oa) * o,
        by + Math.sin(oa) * o,
        a,
        (14 + rng() * 42) * s,
        (0.45 + rng() * 0.4) * s,
        rng() * 0.8,
        (rng() * 2 - 1) * 0.2,
      );
    }
  }
  for (let k = 0; k < 150; k++) {
    strand(rng() * size, rng() * size, rng() * TAU, (10 + rng() * 45) * s, (0.4 + rng() * 0.35) * s, rng() * 0.8, (rng() * 2 - 1) * 0.2);
  }
  // puddles fill the lowest ~18% (shoreline from a smoothed height → smooth water edges)
  const Hs = blur(H, size, Math.round(5 * s), 2);
  const level = quantile(Hs, 0.18);
  for (let i = 0; i < n; i++) {
    const h = H[i];
    const dw = level - Hs[i];
    const pud = sstep(0.0, 1.5, dw) * (1 - sstep(0.5, 2.5, h - level));
    const wetE = sstep(-7, 0, dw);
    const hi = sstep(-10, 25, h - level);
    const md = mid[i];
    let r = lerp(0.23, 0.33, hi);
    let g = lerp(0.19, 0.27, hi);
    let b = lerp(0.15, 0.215, hi);
    const cl = sstep(0.1, 0.5, tone[i]) * 0.5;
    r = lerp(r, 0.31, cl);
    g = lerp(g, 0.29, cl);
    b = lerp(b, 0.27, cl);
    const rel = clamp((h - Hs[i]) * 0.05, -0.25, 0.25);
    const fm = (1 + fine[i] * 0.2 + (clump.id[i] - 0.5) * 0.1 + md * 0.08 + rel) * (1 - 0.35 * wetE);
    r *= fm;
    g *= fm;
    b *= fm;
    let ro = lerp(0.42, 0.72, hi) - wetE * 0.18 + fine[i] * 0.06 + md * 0.05;
    const sc = SC[i];
    if (sc > 0) {
      const t = ST[i];
      const lit = 0.85 + SD[i] * 0.3;
      const sd = (1 - 0.3 * wetE) * lit;
      const coat = sstep(0.75, 0.3, SD[i]) * 0.5; // mud-coated lower rim
      r = lerp(r, lerp(lerp(0.22, 0.34, t) * sd, r, coat), sc);
      g = lerp(g, lerp(lerp(0.205, 0.315, t) * sd, g, coat), sc);
      b = lerp(b, lerp(lerp(0.19, 0.28, t) * sd, b, coat), sc);
      ro = lerp(ro, 0.38, sc);
    }
    let hh = h;
    const gcv = GC[i] * (1 - sstep(0.3, 2.5, dw));
    if (gcv > 0) {
      const t = GT[i];
      r = lerp(r, lerp(0.47, 0.3, t), gcv);
      g = lerp(g, lerp(0.41, 0.26, t), gcv);
      b = lerp(b, lerp(0.28, 0.18, t), gcv);
      ro = lerp(ro, 0.72, gcv);
      hh += gcv * 1.2;
    }
    if (pud > 0) {
      const pd = lerp(1, 0.6, pud);
      r *= pd;
      g *= pd;
      b *= pd * 1.02;
      ro = lerp(ro, 0.05 + (fine[i] * 0.5 + 0.5) * 0.04, pud);
      hh = lerp(hh, level, pud);
    }
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] = hh;
    Ro[i] = clamp(ro, 0.03, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.2, aoStrength: 0.03, aoRadius: 5 * s });
}

function genBrick(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(10001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const rows = 20;
  const cols = 7;
  const rh = size / rows;
  const bwd = size / cols;
  const mh = 1.7 * s;
  const rr = 1.5 * s;
  const bp = new Float32Array(rows * cols * 6);
  for (let k = 0; k < rows * cols; k++) {
    const r = rng();
    let c;
    if (r < 0.55) c = [0.44, 0.21, 0.15];
    else if (r < 0.8) c = [0.33, 0.16, 0.12];
    else if (r < 0.93) c = [0.5, 0.28, 0.18];
    else c = [0.25, 0.145, 0.12];
    const v = 0.85 + rng() * 0.3;
    bp[k * 6] = c[0] * v;
    bp[k * 6 + 1] = c[1] * v;
    bp[k * 6 + 2] = c[2] * v;
    bp[k * 6 + 3] = rng(); // chip amount
    bp[k * 6 + 4] = (rng() * 2 - 1) * 0.25; // end-to-end gradient ("flashed" end)
    bp[k * 6 + 5] = (rng() * 2 - 1) * 0.5; // height offset (mm)
  }
  const face = fbm(size, 24, 24, 4, 10101);
  const chip = fbm(size, 40, 40, 3, 10102);
  const speck = worley(size, 90, 90, 10103, { tileRes: size >> 1 });
  const soot = fbm(size, 3, 3, 5, 10104, 0.55, size >> 1);
  const sootV = fbm(size, 30, 2, 3, 10105);
  const mortN = fbm(size, 128, 128, 2, 10106);
  const eff = fbm(size, 5, 5, 4, 10107, 0.5, size >> 1);
  const hx = bwd / 2 - mh - rr;
  const hy = rh / 2 - mh - rr;
  for (let y = 0; y < size; y++) {
    const yc = y + 0.5;
    const row = Math.floor(yc / rh);
    const ly = yc - row * rh;
    const off = row & 1 ? bwd * 0.5 : 0;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xx = x + 0.5 + off;
      const cf = Math.floor(xx / bwd);
      const lx = xx - cf * bwd;
      const col = cf % cols;
      const k = (row * cols + col) * 6;
      // rounded-rect SDF (positive inside the brick) with chipped edges
      const qx = Math.abs(lx - bwd / 2) - hx;
      const qy = Math.abs(ly - rh / 2) - hy;
      const ox = Math.max(qx, 0);
      const oy = Math.max(qy, 0);
      const sd = Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - rr;
      const d = -sd + chip[i] * 2.2 * s * (0.6 + bp[k + 3] * 0.8);
      const bm = sstep(-0.6, 0.6, d);
      const bevel = sstep(0, 3 * s, d);
      const fc = face[i];
      const sp = speck.id[i];
      const spk = sp > 0.97 ? 0.72 : sp < 0.025 ? 1.2 : 1;
      const grad = 1 + bp[k + 4] * (lx / bwd - 0.5) * 2;
      const fm = (1 + fc * 0.16) * lerp(1, spk, sstep(0.3, 0.18, speck.f1[i])) * grad;
      const br = bp[k] * fm;
      const bg = bp[k + 1] * fm;
      const bb = bp[k + 2] * fm;
      const mn = mortN[i];
      const mr = 0.5 * (0.9 + mn * 0.2);
      const mg = 0.47 * (0.9 + mn * 0.2);
      const mb = 0.42 * (0.9 + mn * 0.2);
      let r = lerp(mr, br, bm);
      let g = lerp(mg, bg, bm);
      let b = lerp(mb, bb, bm);
      const so = clamp01(sstep(-0.1, 0.55, soot[i]) * 0.5 + sstep(0.2, 0.6, sootV[i]) * 0.25);
      const sk = 1 - so * 0.55;
      r *= sk;
      g *= sk;
      b *= sk * 1.02;
      const ef = sstep(0.35, 0.6, eff[i]) * (1 - bevel * 0.7) * 0.3;
      r = lerp(r, 0.62, ef);
      g = lerp(g, 0.6, ef);
      b = lerp(b, 0.56, ef);
      R[i] = r;
      G[i] = g;
      B[i] = b;
      H[i] = lerp(-4 + mn * 0.5, -1.5 + bevel * 1.5 + fc * 0.6 + bp[k + 5], bm);
      Ro[i] = clamp(lerp(0.94, 0.83 + fc * 0.05, bm) + so * 0.04, 0.3, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.4, aoStrength: 0.18, aoRadius: 3 * s });
}

function genRustyMetal(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(11001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const M = F(n);
  const rustN = fbm(size, 5, 5, 6, 11101, 0.55);
  const streakN = fbm(size, 40, 3, 3, 11102);
  for (let i = 0; i < n; i++) rustN[i] += streakN[i] * 0.15;
  equalize(rustN);
  const rustT = 0.5;
  const RM = F(n);
  for (let i = 0; i < n; i++) RM[i] = sstep(rustT - 0.02, rustT + 0.02, rustN[i]);
  const smear = smearDown(RM, size, 0.988);
  const bubbles = worley(size, 70, 70, 11103, { tileRes: size >> 1 });
  const rd = fbm(size, 24, 24, 4, 11104);
  const rf = fbm(size, 128, 128, 2, 11105);
  const flake = worley(size, 30, 30, 11106);
  const pitsW = worley(size, 60, 60, 11107, { tileRes: size >> 1 });
  const chalk = fbm(size, 4, 4, 4, 11108, 0.5, size >> 1);
  const pdirt = fbm(size, 10, 10, 3, 11109);
  const SC = F(n);
  drawScratches(size, SC, rng, 50, {
    alongProb: 0.3,
    angle: 0,
    spread: 0.4,
    lenMin: 8 * s,
    lenMax: 60 * s,
    wMin: 0.3 * s,
    wMax: 0.6 * s,
    iMin: 0.4,
    iMax: 0.9,
  });
  for (let i = 0; i < n; i++) {
    const v = rustN[i];
    const rust = RM[i];
    const bl = Math.exp(-(((v - rustT + 0.035) / 0.022) ** 2)) * (1 - rust);
    const bub = sstep(0.45, 0.1, bubbles.f1[i]) * bl;
    // faded paint with grime
    const ck = sstep(-0.1, 0.5, chalk[i]);
    const pd = 1 + pdirt[i] * 0.12;
    let r = lerp(0.29, 0.42, ck) * pd;
    let g = lerp(0.35, 0.46, ck) * pd;
    let b = lerp(0.33, 0.43, ck) * pd;
    const stv = smear[i] * (0.35 + 0.65 * sstep(-0.2, 0.4, streakN[i])) * (1 - rust);
    r = lerp(r, 0.36, stv * 0.7);
    g = lerp(g, 0.2, stv * 0.7);
    b = lerp(b, 0.11, stv * 0.7);
    r = lerp(r, 0.36, bl * 0.35);
    g = lerp(g, 0.23, bl * 0.35);
    b = lerp(b, 0.15, bl * 0.35);
    // rust: dark brown base with orange cores
    const rdv = rd[i];
    const ta = sstep(-0.3, 0.1, rdv);
    const tb = sstep(0.15, 0.5, rdv);
    let rr = lerp(lerp(0.14, 0.26, ta), 0.39, tb);
    let rg = lerp(lerp(0.085, 0.145, ta), 0.215, tb);
    let rb = lerp(lerp(0.06, 0.08, ta), 0.11, tb);
    const fe = 1 - sstep(0, 0.06, flake.f2[i] - flake.f1[i]);
    const rm = (1 + rf[i] * 0.2) * (1 - fe * 0.25);
    rr *= rm;
    rg *= rm;
    rb *= rm;
    const pit = rust * (pitsW.id[i] < 0.2 ? 1 : 0) * sstep(0.2, 0.1, pitsW.f1[i]);
    r = lerp(r, rr, rust) * (1 - pit * 0.35);
    g = lerp(g, rg, rust) * (1 - pit * 0.35);
    b = lerp(b, rb, rust) * (1 - pit * 0.35);
    const sc = SC[i] * (1 - rust);
    r = lerp(r, 0.5, sc);
    g = lerp(g, 0.5, sc);
    b = lerp(b, 0.52, sc);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] =
      lerp(0.6 + bub * 0.5 + pdirt[i] * 0.08, rdv * 0.9 + rf[i] * 0.5 - fe * 0.4 - pit * 0.8, rust) - sc * 0.2;
    M[i] = clamp01(rust * 0.3 + sc * 0.9);
    Ro[i] = clamp(lerp(0.6 + ck * 0.15, 0.87 + rf[i] * 0.06, rust) - sc * 0.3, 0.2, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro, M }, { bump: 2.0, aoStrength: 0.25, aoRadius: 2 * s });
}

function genMetalDark(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(12501);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const M = F(n);
  const mottle = fbm(size, 4, 4, 4, 12601, 0.5, size >> 1);
  const fine = fbm(size, 128, 128, 2, 12602);
  const cast = worley(size, 90, 90, 12603, { tileRes: size >> 1 });
  const wear = eqfbm(size, 6, 6, 5, 12604, 0.6);
  const SC = F(n);
  const MS = F(n);
  drawScratches(size, SC, rng, 90, {
    alongProb: 0.4,
    angle: 0.3,
    spread: 0.5,
    lenMin: 8 * s,
    lenMax: 60 * s,
    wMin: 0.3 * s,
    wMax: 0.6 * s,
    iMin: 0.3,
    iMax: 0.9,
  });
  drawScratches(size, MS, rng, 400, {
    alongProb: 0.5,
    angle: 0,
    spread: 0.3,
    lenMin: 6 * s,
    lenMax: 50 * s,
    wMin: 0.3 * s,
    wMax: 0.5 * s,
    iMin: 0.2,
    iMax: 0.6,
  });
  const RS = F(n);
  for (let k = 0; k < 12; k++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (2 + rng() * 5) * s;
    forRect(size, x, y, r * 2, r * 2, null, (i, dx, dy) => {
      const d = Math.sqrt(dx * dx + dy * dy) / (r * (1 + fine[i] * 0.8 + mottle[i] * 0.5));
      const c = sstep(1.2, 0.4, d);
      if (c > RS[i]) RS[i] = c;
    });
  }
  for (let i = 0; i < n; i++) {
    const mo = mottle[i];
    const pit = (cast.id[i] < 0.2 ? 1 : 0) * sstep(0.25, 0.12, cast.f1[i]);
    const base = 0.078 * (1 + mo * 0.25 + fine[i] * 0.1) * (1 - pit * 0.3);
    let r = base;
    let g = base * 1.02;
    let b = base * 1.08;
    const worn = sstep(0.955, 0.985, wear[i] + fine[i] * 0.04) * 0.7;
    r = lerp(r, 0.3, worn);
    g = lerp(g, 0.3, worn);
    b = lerp(b, 0.31, worn);
    const sc = SC[i] * 0.8;
    r = lerp(r, 0.42, sc);
    g = lerp(g, 0.42, sc);
    b = lerp(b, 0.43, sc);
    const rs = RS[i] * (1 - worn);
    r = lerp(r, 0.22, rs);
    g = lerp(g, 0.12, rs);
    b = lerp(b, 0.07, rs);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] = fine[i] * 0.05 + mo * 0.1 - pit * 0.15 - sc * 0.05 - worn * 0.05 + rs * 0.08;
    M[i] = clamp01(0.1 + worn * 0.8 + sc * 0.85 - rs * 0.1);
    Ro[i] = clamp(0.52 + mo * 0.08 + fine[i] * 0.05 - worn * 0.14 - sc * 0.22 - MS[i] * 0.12 + rs * 0.35, 0.15, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro, M }, { bump: 2.0, aoStrength: 0.3, aoRadius: 2 * s });
}

function genCrateWood(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(13001);
  const boards = 8;
  const P = plankSurface(size, rng, {
    boards,
    noJoints: true,
    pieces: [1, 1],
    gapPx: 2.2 * s,
    bevelPx: 1.8 * s,
    chip: 0.6 * s,
    gapDepth: 4,
    cup: 0.2,
    h0: 0.25,
    tilt: 0.2,
    ringPx: [4 * s, 9 * s],
    arch: [0.3, 2.2],
    colA: [0.66, 0.51, 0.33],
    colB: [0.6, 0.47, 0.3],
    valueVar: 0.1,
    knots: 5,
    seed: 13100,
    lateDark: 0.62,
    lateTint: [1, 0.9, 0.8],
    lateRelief: 0.2,
    fineAmp: 0.12,
    fineColor: 0.18,
    gapColor: [0.06, 0.045, 0.03],
    baseRough: 0.7,
  });
  const { R, G, B, H, Ro, E, bw } = P;
  const dirt = fbm(size, 4, 4, 4, 13201, 0.5, size >> 1);
  const fine = fbm(size, 64, 64, 2, 13202);
  const stencil = canvasMask(size, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(58 * s)}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LOT 27', size * 0.5, size * 0.4);
    ctx.font = `bold ${Math.round(30 * s)}px "Arial Black", Impact, Arial, sans-serif`;
    ctx.fillText('KEEP DRY', size * 0.5, size * 0.53);
    // two up arrows
    for (const ax of [0.3, 0.7]) {
      const cx = size * ax;
      const cy = size * 0.7;
      const a = 26 * s;
      ctx.beginPath();
      ctx.moveTo(cx, cy - a);
      ctx.lineTo(cx + a * 0.8, cy);
      ctx.lineTo(cx + a * 0.3, cy);
      ctx.lineTo(cx + a * 0.3, cy + a);
      ctx.lineTo(cx - a * 0.3, cy + a);
      ctx.lineTo(cx - a * 0.3, cy);
      ctx.lineTo(cx - a * 0.8, cy);
      ctx.closePath();
      ctx.fill();
    }
    // stencil bridges
    ctx.globalCompositeOperation = 'destination-out';
    for (let x = 0; x < size; x += 17 * s) ctx.fillRect(x, 0, 2 * s, size);
  });
  for (let i = 0; i < n; i++) {
    const e = E[i];
    const onB = sstep(0, 1.2 * s, e);
    const dd = clamp01(sstep(-0.1, 0.6, dirt[i]) * 0.35 + (1 - sstep(0, 8 * s, e)) * 0.25);
    let r = R[i] * (1 - dd);
    let g = G[i] * (1 - dd);
    let b = B[i] * (1 - dd * 1.1);
    let ro = Ro[i] + dd * 0.08;
    if (stencil) {
      const st = stencil[i] * onB * (0.45 + 0.35 * sstep(-0.3, 0.4, fine[i] + dirt[i] * 0.5));
      r = lerp(r, 0.1, st);
      g = lerp(g, 0.095, st);
      b = lerp(b, 0.09, st);
      ro = lerp(ro, 0.6, st);
    }
    R[i] = r;
    G[i] = g;
    B[i] = b;
    Ro[i] = clamp(ro, 0.3, 1);
  }
  // nails near both ends of every board
  for (let b = 0; b < boards; b++) {
    for (const nx of [14 * s, size - 14 * s]) {
      for (let side = -1; side <= 1; side += 2) {
        const x = nx + (rng() * 2 - 1) * 1.5 * s;
        const y = (b + 0.5) * bw + side * bw * 0.22;
        const r = 2 * s;
        forRect(size, x, y, r * 3.5, r * 3.5, null, (i, dx, dy) => {
          const d = Math.sqrt(dx * dx + dy * dy) / r;
          const head = sstep(1.12, 0.85, d);
          const halo = Math.exp(-d * d * 0.3) * (1 - head) * 0.4;
          R[i] = lerp(lerp(R[i], 0.3, halo), 0.16, head);
          G[i] = lerp(lerp(G[i], 0.17, halo), 0.155, head);
          B[i] = lerp(lerp(B[i], 0.09, halo), 0.15, head);
          H[i] += head * 0.3 * (1 - d * d * 0.8);
          Ro[i] = lerp(Ro[i], 0.45, head);
        });
      }
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.4, aoStrength: 0.15, aoRadius: 2 * s });
}

function genCardboard(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const fibers = fbm(size, 128, 128, 2, 14101);
  const fibS = fbm(size, 20, 160, 2, 14107);
  const mottle = fbm(size, 4, 4, 5, 14102, 0.5, size >> 1);
  const crush = fbm(size, 6, 6, 3, 14103, 0.5, size >> 1);
  const stain = eqfbm(size, 3, 3, 4, 14104, 0.5, size >> 1);
  const wrinkle = fbm(size, 24, 3, 3, 14105);
  const tapeN = fbm(size, 40, 8, 2, 14106);
  const flutes = Math.round(size / (4 * s));
  const tapeY0 = 0.62 * size;
  const tapeW = 25 * s;
  for (let y = 0; y < size; y++) {
    const fl = Math.sin(((y + 0.5) / size) * flutes * TAU);
    const ty = y + 0.5 - tapeY0;
    const te = Math.min(ty, tapeW - ty);
    const tape = sstep(-0.5, 0.5, te);
    const tapeEdge = Math.exp(-((te / 0.9) ** 2));
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const fb = fibers[i];
      const mo = mottle[i];
      const cr = sstep(0.1, 0.5, crush[i]);
      const k = (1 + fb * 0.08 + fibS[i] * 0.05 + mo * 0.12) * (1 + fl * 0.025 * (1 - cr));
      let r = 0.58 * k;
      let g = 0.445 * k;
      let b = 0.3 * k;
      const sv = stain[i];
      const inS = sstep(0.8, 0.85, sv);
      const tide = Math.exp(-(((sv - 0.805) / 0.006) ** 2));
      const dk = 1 - inS * 0.16 - tide * 0.2;
      r *= dk;
      g *= dk * 0.98;
      b *= dk * 0.93;
      let h = fl * 0.1 * (1 - cr * 0.7) + fb * 0.06 + mo * 0.3 + inS * 0.1 + cr * 0.2;
      let ro = 0.88 + fb * 0.05 - inS * 0.05;
      if (tape > 0) {
        const tn = tapeN[i];
        r = lerp(r, r * 0.92 + 0.07, tape);
        g = lerp(g, g * 0.92 + 0.055, tape);
        b = lerp(b, b * 0.9 + 0.02, tape);
        const tl = tapeEdge * 0.08 + tn * 0.02;
        r += tl * tape;
        g += tl * tape;
        b += tl * tape * 0.9;
        h += tape * (0.08 + wrinkle[i] * 0.12 + tapeEdge * 0.06);
        ro = lerp(ro, 0.24 + tn * 0.05, tape);
      }
      R[i] = r;
      G[i] = g;
      B[i] = b;
      H[i] = h;
      Ro[i] = clamp(ro, 0.1, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 2.0, aoStrength: 0.3, aoRadius: 2 * s });
}

function genFabric(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const fuzz = fbm(size, 64, 64, 2, 15101);
  const mottle = fbm(size, 5, 5, 4, 15102, 0.5, size >> 1);
  const stain = eqfbm(size, 3, 3, 4, 15103, 0.5, size >> 1);
  const stain2 = eqfbm(size, 5, 5, 4, 15104, 0.5, size >> 1);
  const grime = fbm(size, 6, 6, 4, 15105, 0.5, size >> 1);
  const per = 4 * s; // twill thread period (px)
  const threads = Math.round(size / per);
  const q = 8; // quilting lines across the tile per family
  const qp = size / q;
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) / size) * threads;
    const j = Math.floor(v);
    const fv = v - j;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = ((x + 0.5) / size) * threads;
      const ii = Math.floor(u);
      const fu = u - ii;
      // 2/2 twill: warp on top where ((i - j) mod 4) < 2
      const topWarp = (((ii - j) % 4) + 4) % 4 < 2;
      const hw = Math.sin(Math.PI * fu);
      const hf = Math.sin(Math.PI * fv);
      const wv = topWarp ? 0.35 + 0.65 * hw : 0.35 + 0.65 * hf;
      // quilting: diagonal stitch lines
      const a = (((x + y + 1) % qp) + qp) % qp;
      const c = (((x - y) % qp) + qp) % qp;
      const da = Math.min(a, qp - a) * 0.7071;
      const dc = Math.min(c, qp - c) * 0.7071;
      const dq = Math.min(da, dc);
      const puff = Math.sqrt(sstep(0, qp * 0.3, dq));
      const along = da < dc ? (x - y) * 0.7071 : (x + y) * 0.7071;
      const dash = dq < 1.3 * s ? sstep(0.2, 0.6, Math.sin((along / (5 * s)) * TAU) * 0.5 + 0.5) : 0;
      const fz = fuzz[i];
      const k = (0.84 + 0.16 * wv) * (0.9 + 0.1 * puff) * (1 + fz * 0.06 + mottle[i] * 0.05);
      let r = 0.8 * k;
      let g = 0.8 * k;
      let b = 0.78 * k;
      const gv = clamp01(sstep(0, 0.6, grime[i]) * 0.3 + (1 - puff) * 0.25);
      r *= 1 - gv * 0.5;
      g *= 1 - gv * 0.5;
      b *= 1 - gv * 0.55;
      const sv = stain[i];
      const inS = sstep(0.82, 0.86, sv);
      const tide = Math.exp(-(((sv - 0.825) / 0.008) ** 2));
      r *= 1 - inS * 0.1 - tide * 0.15;
      g *= 1 - inS * 0.14 - tide * 0.2;
      b *= 1 - inS * 0.22 - tide * 0.28;
      const s2 = sstep(0.9, 0.94, stain2[i]);
      r *= 1 - s2 * 0.2;
      g *= 1 - s2 * 0.22;
      b *= 1 - s2 * 0.25;
      r = lerp(r, 0.35, dash * 0.5);
      g = lerp(g, 0.35, dash * 0.5);
      b = lerp(b, 0.34, dash * 0.5);
      R[i] = r;
      G[i] = g;
      B[i] = b;
      H[i] = puff * 2.2 + wv * 0.35 + fz * 0.08 - dash * 0.2;
      Ro[i] = clamp(0.93 + fz * 0.04 - inS * 0.03, 0.5, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.2, aoStrength: 0.12, aoRadius: 3 * s });
}

function genClothDetail(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const mottle = fbm(size, 4, 4, 4, 16101, 0.5, size >> 1);
  const fuzz = fbm(size, 128, 128, 2, 16102);
  const wrink = fbm(size, 3, 6, 3, 16103, 0.5, size >> 1);
  const threads = Math.round(size / (4 * s));
  const grid = 4; // ripstop reinforcement every 4 threads
  for (let y = 0; y < size; y++) {
    const v = ((y + 0.5) / size) * threads;
    const j = Math.floor(v);
    const fv = v - j;
    const gy = j % grid === 0;
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = ((x + 0.5) / size) * threads;
      const ii = Math.floor(u);
      const fu = u - ii;
      const gx = ii % grid === 0;
      // plain weave: warp over where (i + j) even
      const hwe = 0.5 + 0.5 * Math.cos(Math.PI * (v - 0.5 + ii));
      const hfe = 0.5 + 0.5 * Math.cos(Math.PI * (u - 0.5 + j + 1));
      const pw = Math.sqrt(Math.max(0, Math.sin(Math.PI * fu)));
      const pf = Math.sqrt(Math.max(0, Math.sin(Math.PI * fv)));
      const warpH = pw * (0.45 + 0.55 * hwe) + (gx ? 0.35 * pw : 0);
      const weftH = pf * (0.45 + 0.55 * hfe) + (gy ? 0.35 * pf : 0);
      const h = Math.max(warpH, weftH);
      const k = (0.8 + 0.2 * h) * (1 + mottle[i] * 0.05 + fuzz[i] * 0.04) + ((gx && warpH > weftH) || (gy && weftH >= warpH) ? 0.04 : 0);
      R[i] = 0.9 * k;
      G[i] = 0.9 * k;
      B[i] = 0.9 * k;
      H[i] = h * 0.35 + wrink[i] * 1.5 + fuzz[i] * 0.03;
      Ro[i] = clamp(0.86 + (1 - h) * 0.08 + fuzz[i] * 0.03, 0.5, 1);
    }
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.0, aoStrength: 0.5, aoRadius: 1, aoAlbedo: 0.3 });
}

function genFlesh(size, mpr) {
  const n = size * size;
  const s = size / 1024;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const twx = fbm(size >> 1, 4, 4, 3, 17118);
  const twy = fbm(size >> 1, 4, 4, 3, 17119);
  const tissue = worley(size, 22, 22, 17101, { lowRes: size >> 1, warpX: twx, warpY: twy, warpAmp: 24 * s });
  const mottle = fbm(size, 4, 4, 5, 17102, 0.55, size >> 1);
  const mottle2 = fbm(size, 12, 12, 4, 17117, 0.5, size >> 1);
  const bruise = eqfbm(size, 3, 3, 4, 17103, 0.5, size >> 2);
  const wa = fbm(size, 3, 3, 3, 17104, 0.5, size >> 2);
  const wb = fbm(size, 3, 3, 3, 17105, 0.5, size >> 2);
  const fibRaw = fbm(size, 5, 90, 3, 17106, 0.5, 0, size >> 1);
  const fib = warpField(fibRaw, size, wa, wb, 60 * s);
  const muscle = eqfbm(size, 4, 4, 4, 17107, 0.5, size >> 2);
  const fatN = fbm(size, 8, 8, 4, 17108, 0.5, size >> 1);
  const veinN = fbm(size, 5, 5, 4, 17109, 0.5, size >> 1);
  const capN = fbm(size, 16, 16, 3, 17110, 0.5, size >> 1);
  const clot = eqfbm(size, 6, 6, 5, 17111, 0.55, size >> 1);
  const clumpW = worley(size, 64, 64, 17112, { tileRes: size >> 1 });
  const pores = worley(size, 128, 128, 17113, { tileRes: size >> 2 });
  const wet = fbm(size, 3, 3, 4, 17114, 0.5, size >> 2);
  const fine = fbm(size, 128, 128, 2, 17115, 0.5, 0, size >> 2);
  const boneN = eqfbm(size, 14, 14, 5, 17116, 0.6, size >> 1);
  for (let i = 0; i < n; i++) {
    const f1 = tissue.f1[i];
    const e = tissue.f2[i] - f1;
    const lump = Math.pow(clamp01(1 - f1), 1.5);
    const crev = 1 - sstep(0.0, 0.25, e);
    const mo = mottle[i];
    const lt = clamp01(0.4 + mo * 0.42 + mottle2[i] * 0.26);
    let r = lerp(0.32, 0.62, lt);
    let g = lerp(0.045, 0.13, lt);
    let b = lerp(0.04, 0.11, lt);
    // muscle striation zones vs fatty/marbled zones
    const mz = sstep(0.4, 0.7, muscle[i]);
    const f01 = fib[i] * 0.5 + 0.5;
    const fk = lerp(1, 0.78 + 0.44 * f01, mz);
    r *= fk;
    g *= fk;
    b *= fk;
    const fat = (1 - sstep(0.0, 0.018, Math.abs(fatN[i]))) * (1 - mz) * 0.35;
    r = lerp(r, 0.78, fat);
    g = lerp(g, 0.45, fat);
    b = lerp(b, 0.4, fat);
    // bruising
    const br = sstep(0.75, 0.95, bruise[i]) * 0.5;
    r = lerp(r, 0.27, br);
    g = lerp(g, 0.06, br);
    b = lerp(b, 0.1, br);
    // veins & capillaries
    const vn = (1 - sstep(0, 0.025, Math.abs(veinN[i]))) * sstep(-0.3, 0.2, mo);
    const cp = (1 - sstep(0, 0.015, Math.abs(capN[i]))) * 0.3;
    r = lerp(lerp(r, 0.36, cp), 0.25, vn * 0.7);
    g = lerp(lerp(g, 0.03, cp), 0.05, vn * 0.7);
    b = lerp(lerp(b, 0.06, cp), 0.14, vn * 0.7);
    // clotted blood: dark glossy red, lumpy
    const cl = sstep(0.82, 0.9, clot[i]);
    const cc = 1 - clumpW.f1[i];
    const clt = 0.85 + cc * 0.3;
    r = lerp(r, 0.2 * clt, cl);
    g = lerp(g, 0.015 * clt, cl);
    b = lerp(b, 0.015 * clt, cl);
    // bone fragments: small irregular pale bits with a dark blood rim
    const bv = boneN[i];
    const bn = sstep(0.9935, 0.9965, bv);
    const brim = sstep(0.986, 0.9935, bv) * (1 - bn);
    r = lerp(r, 0.14, brim * 0.8);
    g = lerp(g, 0.02, brim * 0.8);
    b = lerp(b, 0.02, brim * 0.8);
    const bt = 0.85 + fine[i] * 0.2;
    r = lerp(r, 0.8 * bt, bn);
    g = lerp(g, 0.73 * bt, bn);
    b = lerp(b, 0.6 * bt, bn);
    const pz = 1 - pores.f1[i];
    const wv = sstep(-0.2, 0.3, wet[i]);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] =
      lump * 0.5 +
      mo * 0.8 +
      mottle2[i] * 0.3 +
      fib[i] * 0.2 * mz -
      crev * 0.1 +
      vn * 0.3 +
      cp * 0.1 +
      cl * (0.5 + cc * 0.7) +
      bn * 0.9 +
      pz * pz * 0.08 +
      fine[i] * 0.05;
    let ro = 0.45 - 0.28 * wv + 0.08 * fine[i] - crev * 0.1;
    ro = lerp(ro, 0.14, cl);
    ro = lerp(ro, 0.5, bn);
    Ro[i] = clamp(ro, 0.08, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.0, aoStrength: 0.25, aoRadius: 4 * s });
}

function genBark(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const furN = fbm(size, 9, 2, 4, 18101, 0.5); // long, vertically meandering zero-crossings = furrows
  const furW = fbm(size, 6, 3, 3, 18102);
  const wx = fbm(size, 4, 2, 3, 18109);
  const wy = fbm(size, 4, 2, 3, 18110);
  const plates = worley(size, 10, 3, 18103, { jitter: 0.9, warpX: wx, warpY: wy, warpAmp: 20 * s });
  const flakes = worley(size, 36, 12, 18104);
  const fib = fbm(size, 96, 4, 2, 18105);
  const mottle = fbm(size, 4, 3, 4, 18106);
  const lich = eqfbm(size, 6, 5, 4, 18107, 0.6);
  const fine = fbm(size, 128, 128, 2, 18108);
  for (let i = 0; i < n; i++) {
    const fw = 0.05 + 0.045 * (furW[i] * 0.5 + 0.5);
    const fv = Math.abs(furN[i]);
    const furrow = 1 - sstep(fw * 0.6, fw, fv);
    const cross = (1 - sstep(0, 0.045, plates.f2[i] - plates.f1[i])) * 0.55;
    const plateM = 1 - Math.max(furrow, cross);
    const fe = flakes.f2[i] - flakes.f1[i];
    const flakeEdge = 1 - sstep(0, 0.08, fe);
    const fid = flakes.id[i];
    const fresh = sstep(0.82, 0.94, fid) * 0.7;
    const fk = 0.85 + fib[i] * 0.22 + mottle[i] * 0.2 + fine[i] * 0.06;
    let r = lerp(0.3, 0.39, fresh) * fk;
    let g = lerp(0.25, 0.235, fresh) * fk;
    let b = lerp(0.21, 0.17, fresh) * fk;
    const ed = 1 - flakeEdge * 0.15;
    r *= ed;
    g *= ed;
    b *= ed;
    const lv = sstep(0.9, 0.96, lich[i] + fine[i] * 0.06) * plateM * 0.7;
    r = lerp(r, 0.38, lv);
    g = lerp(g, 0.4, lv);
    b = lerp(b, 0.33, lv);
    const fu = 1 - plateM;
    r = lerp(r, 0.075, fu);
    g = lerp(g, 0.06, fu);
    b = lerp(b, 0.048, fu);
    const wetK = 0.85;
    R[i] = r * wetK;
    G[i] = g * wetK;
    B[i] = b * wetK;
    const top = 6 + plates.id[i] * 4 - flakeEdge * 1.0 + fid * 1.5 + fib[i] * 0.7 + fine[i] * 0.3 + lv * 0.4;
    H[i] = lerp(-8 + fine[i], top, plateM);
    Ro[i] = clamp(lerp(0.78, 0.58 + fine[i] * 0.08, plateM) + lv * 0.25, 0.3, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 1.0, aoStrength: 0.05, aoRadius: 4 * s });
}

function genFoliage(size) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(19001);
  const A = F(n);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const clip = [0, 0, size, size];
  // premultiplied "over" compositing of anti-aliased strokes
  const stroke = (x0, y0, x1, y1, w0, w1, col, hgt, tint) => {
    forSegment(size, x0, y0, x1, y1, Math.max(w0, w1) + 1, clip, (i, d, t) => {
      const w = w0 + (w1 - w0) * t;
      let c = sstep(w + 0.6, w - 0.4, d);
      if (w < 0.6) c *= Math.max(0.3, w / 0.6);
      if (c <= 0) return;
      const prof = Math.sqrt(Math.max(0, 1 - (d / (w + 0.5)) ** 2));
      const sh = (0.75 + 0.25 * prof) * (1 + t * tint);
      R[i] = lerp(R[i], col[0] * sh, c);
      G[i] = lerp(G[i], col[1] * sh, c);
      B[i] = lerp(B[i], col[2] * sh, c);
      A[i] = A[i] + c * (1 - A[i]);
      H[i] = lerp(H[i], hgt + prof * (w + 0.5) * 0.6, c);
    });
  };
  const needleCol = () => {
    const t = rng();
    if (t < 0.45) return [0.25 + rng() * 0.05, 0.24 + rng() * 0.04, 0.11 + rng() * 0.03];
    if (t < 0.8) return [0.36 + rng() * 0.06, 0.25 + rng() * 0.04, 0.12 + rng() * 0.03];
    return [0.29, 0.27, 0.2];
  };
  const needles = (x0, y0, x1, y1, density, lenMul, layer) => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    const step = 2.4 * s;
    for (let d = 2 * s; d < L; d += step) {
      const px = x0 + ux * d;
      const py = y0 + uy * d;
      const tpos = d / L;
      for (let side = -1; side <= 1; side += 2) {
        if (rng() > density) continue;
        const ang = Math.atan2(uy, ux) + side * (0.55 + rng() * 0.6) + (rng() * 2 - 1) * 0.15;
        const len = (18 + rng() * 14) * s * lenMul * (1 - tpos * 0.3);
        const droop = (rng() * 2 - 1) * 0.2;
        const mx = px + Math.cos(ang) * len * 0.5;
        const my = py + Math.sin(ang) * len * 0.5;
        const ex = mx + Math.cos(ang + droop) * len * 0.5;
        const ey = my + Math.sin(ang + droop) * len * 0.5;
        const col = needleCol();
        const w = (0.65 + rng() * 0.3) * s;
        stroke(px, py, mx, my, w, w * 0.9, col, layer + 1, 0.1);
        stroke(mx, my, ex, ey, w * 0.9, w * 0.35, col, layer + 1, 0.2);
      }
    }
  };
  // main stem from bottom-center upwards
  const stem = [];
  {
    let x = size * 0.5 + (rng() * 2 - 1) * 10 * s;
    let y = 3 * s;
    let a = Math.PI / 2 + (rng() * 2 - 1) * 0.1;
    const segs = 12;
    const segL = (size * 0.9) / segs;
    for (let k = 0; k <= segs; k++) {
      stem.push([x, y]);
      a += (rng() * 2 - 1) * 0.12;
      a = clamp(a, Math.PI / 2 - 0.3, Math.PI / 2 + 0.3);
      x += Math.cos(a) * segL;
      y += Math.sin(a) * segL;
    }
  }
  const stemAt = (t) => {
    const k = Math.min(stem.length - 2, Math.floor(t * (stem.length - 1)));
    const f = t * (stem.length - 1) - k;
    return [
      lerp(stem[k][0], stem[k + 1][0], f),
      lerp(stem[k][1], stem[k + 1][1], f),
      Math.atan2(stem[k + 1][1] - stem[k][1], stem[k + 1][0] - stem[k][0]),
    ];
  };
  const stemCol = [0.2, 0.16, 0.12];
  for (let k = 0; k < stem.length - 1; k++) {
    const t0 = k / (stem.length - 1);
    const t1 = (k + 1) / (stem.length - 1);
    stroke(stem[k][0], stem[k][1], stem[k + 1][0], stem[k + 1][1], lerp(4.5, 1.4, t0) * s, lerp(4.5, 1.4, t1) * s, stemCol, 0, 0);
  }
  // side twigs (with small sub-twigs), kept inside the card
  const twigs = [];
  const inside = (x, y) => [clamp(x, 6 * s, size - 6 * s), clamp(y, 6 * s, size - 6 * s)];
  {
    let side = rng() < 0.5 ? -1 : 1;
    for (let t = 0.07; t < 0.95; t += (0.035 + rng() * 0.03) * (1 - t * 0.3)) {
      const [bx, by, baseA] = stemAt(t);
      const ang = baseA - side * (0.75 + rng() * 0.45);
      const len = (110 + rng() * 90) * s * (1 - 0.6 * t);
      const bend = side * (rng() * 0.35);
      const [mx, my] = inside(bx + Math.cos(ang) * len * 0.55, by + Math.sin(ang) * len * 0.55);
      const [ex, ey] = inside(mx + Math.cos(ang + bend) * len * 0.45, my + Math.sin(ang + bend) * len * 0.45);
      twigs.push([bx, by, mx, my, ex, ey, 1]);
      // sub-twigs
      const subs = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < subs; k++) {
        const f = 0.3 + rng() * 0.5;
        const sx = lerp(bx, ex, f);
        const sy = lerp(by, ey, f);
        const sa = ang + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.4);
        const sl = (30 + rng() * 40) * s * (1 - 0.4 * t);
        const [tx, ty] = inside(sx + Math.cos(sa) * sl, sy + Math.sin(sa) * sl);
        twigs.push([sx, sy, (sx + tx) / 2, (sy + ty) / 2, tx, ty, 0.6]);
      }
      side = -side;
    }
  }
  const twigCol = [0.23, 0.18, 0.13];
  for (const tw of twigs) {
    stroke(tw[0], tw[1], tw[2], tw[3], 2.2 * s * tw[6], 1.5 * s * tw[6], twigCol, 0.5, 0);
    stroke(tw[2], tw[3], tw[4], tw[5], 1.5 * s * tw[6], 0.7 * s, twigCol, 0.5, 0);
  }
  for (const tw of twigs) {
    needles(tw[0], tw[1], tw[2], tw[3], 0.7, tw[6] < 1 ? 0.8 : 1, 1);
    needles(tw[2], tw[3], tw[4], tw[5], 0.75, tw[6] < 1 ? 0.75 : 0.9, 1.5);
  }
  for (let k = Math.floor(stem.length * 0.4); k < stem.length - 1; k++) {
    needles(stem[k][0], stem[k][1], stem[k + 1][0], stem[k + 1][1], 0.7, 1.1, 2);
  }
  // un-premultiply; fully transparent texels get an average needle colour (no dark mip fringes)
  const Ro = F(n);
  for (let i = 0; i < n; i++) {
    const a = A[i];
    if (a > 1e-3) {
      const inv = 1 / a;
      R[i] = clamp01(R[i] * inv);
      G[i] = clamp01(G[i] * inv);
      B[i] = clamp01(B[i] * inv);
      H[i] *= inv;
    } else {
      R[i] = 0.27;
      G[i] = 0.22;
      B[i] = 0.12;
    }
    A[i] = sstep(0.05, 0.65, a);
    Ro[i] = 0.78;
  }
  return finishDecal(size, { R, G, B, A, H, Ro }, { bump: 1.2, alphaMap: true });
}

function genPorcelain(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(20001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const yell = fbm(size, 3, 3, 4, 20101, 0.5, size >> 1);
  const grime = fbm(size, 5, 5, 5, 20102, 0.55, size >> 1);
  const peel = fbm(size, 24, 24, 3, 20103);
  const fine = fbm(size, 96, 96, 2, 20104);
  const ce = crackField(size, 14, 20107, 18 * s);
  const cMask = eqfbm(size, 3, 3, 3, 20108, 0.5, size >> 2);
  const streakN = fbm(size, 60, 3, 3, 20109);
  const SRC = F(n);
  const CH = F(n);
  for (let k = 0; k < 4; k++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (3 + rng() * 4) * s;
    forRect(size, x, y, r * 2, r * 2, null, (i, dx, dy) => {
      const c = sstep(1.4, 0.4, Math.sqrt(dx * dx + dy * dy) / (r * (1 + fine[i] * 0.6)));
      if (c > SRC[i]) SRC[i] = c;
    });
  }
  for (let k = 0; k < 8; k++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = (2 + rng() * 5) * s;
    forRect(size, x, y, r * 2.4, r * 2.4, null, (i, dx, dy) => {
      const e = Math.sqrt(dx * dx + dy * dy) / (r * (1 + 0.45 * peel[i] + 0.25 * fine[i]));
      const c = sstep(1.05, 0.95, e);
      if (c > CH[i]) CH[i] = c;
      const rim = Math.exp(-(((e - 1.15) / 0.2) ** 2)) * 0.8;
      if (rim > SRC[i]) SRC[i] = rim;
    });
  }
  // rust drips: vertical smear below sources, broken into thin runs
  const dwx = fbm(size, 3, 10, 3, 20110);
  const smear = warpField(blur(smearDown(SRC, size, 0.986), size, Math.max(1, Math.round(2 * s)), 1), size, dwx, peel, 7 * s);
  for (let i = 0; i < n; i++) {
    let r = 0.87;
    let g = 0.86;
    let b = 0.82;
    const yv = sstep(-0.2, 0.4, yell[i]) * 0.5;
    r = lerp(r, 0.83, yv);
    g = lerp(g, 0.8, yv);
    b = lerp(b, 0.7, yv);
    const gv = sstep(0.0, 0.55, grime[i] + fine[i] * 0.1) * 0.4;
    r = lerp(r, 0.55, gv);
    g = lerp(g, 0.5, gv);
    b = lerp(b, 0.42, gv);
    const crack = (1 - sstep(0, 0.025, ce[i])) * sstep(0.5, 0.62, cMask[i]);
    r = lerp(r, 0.4, crack * 0.75);
    g = lerp(g, 0.35, crack * 0.75);
    b = lerp(b, 0.3, crack * 0.75);
    const sm = smear[i];
    const rust = clamp01(Math.max(SRC[i], sm * 1.6 * (0.35 + 0.65 * sstep(-0.1, 0.35, streakN[i]))));
    const rt = sstep(0.4, 0.95, rust);
    r = lerp(r, lerp(0.62, 0.4, rt), rust * 0.8);
    g = lerp(g, lerp(0.4, 0.2, rt), rust * 0.8);
    b = lerp(b, lerp(0.2, 0.09, rt), rust * 0.8);
    const ch = CH[i];
    r = lerp(r, 0.09, ch);
    g = lerp(g, 0.08, ch);
    b = lerp(b, 0.075, ch);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    H[i] = peel[i] * 0.04 + fine[i] * 0.01 - crack * 0.12 - ch * 0.6 + rust * 0.03;
    Ro[i] = clamp(0.1 + gv * 0.8 + rust * 0.55 + ch * 0.6 + crack * 0.3 + fine[i] * 0.02, 0.05, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro }, { bump: 2.0, aoStrength: 1.0, aoRadius: 2 * s });
}

function genGunMetal(size, mpr) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(21001);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const H = F(n);
  const Ro = F(n);
  const M = F(n);
  const cryst = worley(size, 200, 200, 21101, { tileRes: size >> 1 });
  const fine = fbm(size, 160, 160, 1, 21102);
  const mottle = fbm(size, 4, 4, 4, 21103, 0.5, size >> 1);
  const wear = eqfbm(size, 7, 7, 5, 21104, 0.6);
  const SC = F(n);
  drawScratches(size, SC, rng, 120, {
    alongProb: 0.8,
    angle: 0,
    spread: 0.2,
    lenMin: 10 * s,
    lenMax: 90 * s,
    wMin: 0.3 * s,
    wMax: 0.55 * s,
    iMin: 0.15,
    iMax: 0.55,
  });
  for (let i = 0; i < n; i++) {
    const cv = cryst.id[i] - 0.5;
    const mo = mottle[i];
    const base = 0.075 + cv * 0.018 + mo * 0.012;
    const worn = sstep(0.965, 0.99, wear[i] + fine[i] * 0.03) * 0.7;
    const sc = SC[i] * 0.5;
    let r = lerp(base, 0.26, worn);
    let g = lerp(base, 0.26, worn);
    let b = lerp(base * 1.06, 0.28, worn);
    r = lerp(r, 0.35, sc);
    g = lerp(g, 0.35, sc);
    b = lerp(b, 0.37, sc);
    R[i] = r;
    G[i] = g;
    B[i] = b;
    const c1 = 1 - cryst.f1[i];
    H[i] = c1 * c1 * 0.06 + fine[i] * 0.012 + mo * 0.02 - sc * 0.02 - worn * 0.01;
    M[i] = clamp01(0.35 + worn * 0.8 + sc * 0.8);
    Ro[i] = clamp(0.58 + cv * 0.12 + mo * 0.05 - worn * 0.35 - sc * 0.3, 0.15, 1);
  }
  return finishSurface(size, mpr, { R, G, B, H, Ro, M }, { bump: 1.2, aoStrength: 2.0, aoRadius: 2 * s, aoAlbedo: 0.3 });
}

// ===========================================================================
// DECALS
// ===========================================================================

function composeBlood(size, D, noise, cell) {
  const n = size * size;
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const A = F(n);
  const H = F(n);
  const Ro = F(n);
  const edge = 12 * (size / 1024);
  for (let y = 0; y < size; y++) {
    const ly = y % cell;
    const wy = Math.min(ly, cell - 1 - ly);
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const lx = x % cell;
      const wnd = sstep(0, edge, Math.min(lx, cell - 1 - lx, wy));
      const d = D[i] * wnd;
      const nz = noise[i];
      const a = sstep(0.06, 0.26, d + nz * 0.04);
      const thick = sstep(0.25, 1.1, d);
      const nk = 1 + nz * 0.14;
      let r = lerp(0.45, 0.2, thick) * nk;
      let g = lerp(0.035, 0.013, thick) * nk;
      let b = lerp(0.03, 0.013, thick) * nk;
      const rim = a * (1 - sstep(0.26, 0.5, d));
      const rk = 1 - rim * 0.3;
      R[i] = r * rk;
      G[i] = g * rk;
      B[i] = b * rk;
      A[i] = a;
      H[i] = Math.sqrt(Math.min(d, 1.4));
      Ro[i] = clamp(0.1 + 0.28 * (1 - thick) + rim * 0.15 + nz * 0.03, 0.05, 1);
    }
  }
  const Hs = blur(H, size, 2, 1);
  return { R, G, B, A, H: Hs, Ro };
}

function genBloodDecals(size) {
  const n = size * size;
  const cell = size >> 1;
  const cs = cell / 512;
  const rng = makeRng(22001);
  const D = F(n);
  const noise = fbm(size, 16, 16, 4, 22101);
  const edgeN = fbm(size, 48, 48, 3, 22102);
  const cellClip = (k) => {
    const ox = (k & 1) * cell;
    const oy = (k >> 1) * cell;
    return { ox, oy, clip: [ox + 4, oy + 4, ox + cell - 4, oy + cell - 4] };
  };
  const blob = (clip, cx, cy, R, tb, dirX = 1, dirY = 0, st = 1) =>
    drawBlob(D, size, clip, cx, cy, R, tb, 1.0, dirX, dirY, st, edgeN, 0.12);
  const drop = (clip, x, y, r, a, len) =>
    drawTaper(D, size, clip, x, y, r, x + Math.cos(a) * len, y + Math.sin(a) * len, r * 0.4, 1);
  const satellites = (clip, cx, cy, R, count, spread) => {
    for (let k = 0; k < count; k++) {
      const a = rng() * TAU;
      const dist = Math.min(R * (1.35 + Math.pow(rng(), 1.6) * spread), cell * 0.44);
      const rd = Math.max(1.0 * cs, R * 0.07 * Math.max(0.25, 1.2 - (dist / R - 1.3) / 2.2) * (0.35 + rng() * 0.9));
      drop(clip, cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, rd, a, rd * (0.3 + rng() * 1.4));
    }
  };
  const crown = (clip, cx, cy, R, tb, count) => {
    for (let k = 0; k < count; k++) {
      const a = rng() * TAU;
      const dist = R * tableAt(tb, a) * (1.05 + rng() * 0.4);
      const rd = (0.8 + rng() * 1.6) * cs;
      drop(clip, cx + Math.cos(a) * dist, cy + Math.sin(a) * dist, rd, a, rd * rng());
    }
  };
  const spikeDrops = (clip, cx, cy, R, tb) => {
    for (const sp of tb.spikes) {
      if (sp[2] < 0.25 || rng() > 0.85) continue;
      const rd = R * (0.04 + rng() * 0.05);
      const dist = R * (1 + sp[2]) + rd * (0.5 + rng() * 1.5);
      drop(clip, cx + Math.cos(sp[0]) * dist, cy + Math.sin(sp[0]) * dist, rd, sp[0], rd * 1.2);
    }
  };

  // cell 0: big impact splat with lobes, tendrils ending in droplets, crown & satellites
  {
    const { ox, oy, clip } = cellClip(0);
    const cx = ox + cell * 0.5 + (rng() - 0.5) * 20 * cs;
    const cy = oy + cell * 0.5 + (rng() - 0.5) * 20 * cs;
    const R = 82 * cs;
    const tb = angularTable(rng, 0.5, 14, 0.38, 0.09, 16);
    blob(clip, cx, cy, R, tb);
    for (let k = 0; k < 3; k++) {
      const a = rng() * TAU;
      blob(clip, cx + Math.cos(a) * R * 0.55, cy + Math.sin(a) * R * 0.55, R * (0.35 + rng() * 0.15), angularTable(rng, 0.45, 5, 0.4, 0.12, 12));
    }
    spikeDrops(clip, cx, cy, R, tb);
    crown(clip, cx, cy, R, tb, 40);
    satellites(clip, cx, cy, R, 55, 1.7);
  }
  // cell 1: directional spray
  {
    const { ox, oy, clip } = cellClip(1);
    const x0 = ox + 110 * cs;
    const y0 = oy + 120 * cs;
    const a0 = 0.62;
    const dx = Math.cos(a0);
    const dy = Math.sin(a0);
    blob(clip, x0, y0, 36 * cs, angularTable(rng, 0.45, 8, 0.45, 0.1, 14), dx, dy, 1.5);
    for (let k = 0; k < 170; k++) {
      const a = a0 + gauss(rng) * 0.26;
      const dist = (45 + Math.pow(rng(), 0.8) * 330) * cs;
      const rd = Math.max(0.9 * cs, (1 + 6 * Math.pow(rng(), 2.2)) * cs * (1 - (0.5 * dist) / (400 * cs)));
      const len = rd * (1.0 + dist / (80 * cs));
      drawTaper(D, size, clip, x0 + Math.cos(a) * dist, y0 + Math.sin(a) * dist, rd, x0 + Math.cos(a) * (dist + len), y0 + Math.sin(a) * (dist + len), rd * 0.3, 1);
    }
    for (let k = 0; k < 5; k++) {
      const a = a0 + gauss(rng) * 0.15;
      const st = (30 + rng() * 20) * cs;
      const L = (60 + rng() * 100) * cs;
      const w = (1.5 + rng() * 1.5) * cs;
      drawTaper(D, size, clip, x0 + Math.cos(a) * st, y0 + Math.sin(a) * st, w, x0 + Math.cos(a) * (st + L), y0 + Math.sin(a) * (st + L), 0.3 * cs, 0.8);
    }
  }
  // cell 2: drag smear with streaks, pool at the start, drips at the end
  {
    const { ox, oy, clip } = cellClip(2);
    const P0 = [ox + 90 * cs, oy + 390 * cs];
    const P1 = [ox + 270 * cs, oy + 330 * cs];
    const P2 = [ox + 430 * cs, oy + 120 * cs];
    const N = 48;
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const u = 1 - t;
      pts.push([u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]]);
    }
    const stT = new Float32Array(65);
    for (let k = 0; k < 65; k++) stT[k] = rng();
    for (let k = 1; k < 64; k++) stT[k] = (stT[k - 1] + stT[k] * 2 + stT[k + 1]) * 0.25;
    for (let k = 0; k < 65; k++) stT[k] = sstep(0.3, 0.7, stT[k]);
    const streakAt = (sv) => {
      const u = (clamp(sv, -1, 1) * 0.5 + 0.5) * 64;
      const i0 = Math.min(63, u | 0);
      return lerp(stT[i0], stT[i0 + 1], u - i0);
    };
    const wAt = (t) => (58 - 30 * t) * cs;
    const dAt = (t) => 1.0 - 0.75 * Math.pow(t, 0.8);
    for (let k = 0; k < N; k++) {
      const wa = wAt(k / N);
      const wb = wAt((k + 1) / N);
      forSegment(size, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], Math.max(wa, wb) + 4, clip, (i, d, t, side) => {
        const tt = (k + t) / N;
        const ww = lerp(wa, wb, t) * (1 + edgeN[i] * 0.12);
        if (d > ww + 1.5) return;
        const edgeS = sstep(ww + 1, ww - 3, d);
        const st = streakAt(side / ww);
        const v = edgeS * dAt(tt) * (0.25 + 0.95 * st) * (0.8 + 0.25 * noise[i]);
        if (v > D[i]) D[i] = v;
      });
    }
    blob(clip, P0[0], P0[1], 46 * cs, angularTable(rng, 0.4, 5, 0.35, 0.12, 12));
    satellites(clip, P0[0], P0[1], 46 * cs, 14, 1.2);
    for (let k = 0; k < 10; k++) {
      const t = 0.75 + rng() * 0.35;
      const u = 1 - t;
      const x = u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0] + (rng() * 2 - 1) * 20 * cs;
      const y = u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1] + (rng() * 2 - 1) * 20 * cs;
      blob(clip, x, y, (3 + rng() * 5) * cs, angularTable(rng, 0.3, 7, 0.4, 0.12, 10));
    }
  }
  // cell 3: medium splats + a drip trail
  {
    const { ox, oy, clip } = cellClip(3);
    const spots = [
      [0.3, 0.68],
      [0.7, 0.72],
      [0.62, 0.36],
      [0.26, 0.3],
    ];
    for (const sp of spots) {
      const cx = ox + (sp[0] + (rng() - 0.5) * 0.08) * cell;
      const cy = oy + (sp[1] + (rng() - 0.5) * 0.08) * cell;
      const R = (22 + rng() * 26) * cs;
      const tb = angularTable(rng, 0.45, 6 + Math.floor(rng() * 6), 0.5, 0.1, 14);
      blob(clip, cx, cy, R, tb);
      spikeDrops(clip, cx, cy, R, tb);
      crown(clip, cx, cy, R, tb, 12);
      satellites(clip, cx, cy, R, 8 + Math.floor(rng() * 10), 1.6);
    }
    for (let k = 0; k < 16; k++) {
      const t = k / 15;
      const x = ox + (40 + t * 430) * cs + (rng() * 2 - 1) * 6 * cs;
      const y = oy + (60 + t * 140 + Math.sin(t * 5) * 25) * cs;
      blob(clip, x, y, (3 + rng() * 5) * cs, angularTable(rng, 0.3, 9, 0.45, 0.1, 10));
    }
  }
  const out = composeBlood(size, D, noise, cell);
  return finishDecal(size, out, { bump: 1.2 });
}

function genBloodPool(size) {
  const n = size * size;
  const s = size / 512;
  const rng = makeRng(23001);
  const D = F(n);
  const clip = [4, 4, size - 4, size - 4];
  const c = size / 2;
  const noise = fbm(size, 12, 12, 4, 23101);
  const edgeN = fbm(size, 40, 40, 3, 23102);
  const R0 = 118 * s;
  drawBlob(D, size, clip, c, c, R0, angularTable(rng, 0.3, 0, 0, 0.1, 12), 1.2, 1, 0, 1, edgeN, 0.05);
  for (let k = 0; k < 7; k++) {
    const a = rng() * TAU;
    const d = R0 * (0.5 + rng() * 0.35);
    drawBlob(D, size, clip, c + Math.cos(a) * d, c + Math.sin(a) * d, R0 * (0.3 + rng() * 0.2), angularTable(rng, 0.3, 0, 0, 0.1, 10), 1.2, 1, 0, 1, edgeN, 0.05);
  }
  // a few rounded runs flowing out of the pool
  for (let k = 0; k < 3; k++) {
    const a = rng() * TAU;
    const d = R0 * (1.0 + rng() * 0.15);
    drawBlob(D, size, clip, c + Math.cos(a) * d, c + Math.sin(a) * d, R0 * (0.14 + rng() * 0.08), angularTable(rng, 0.25, 0, 0, 0.1, 8), 1.1, Math.cos(a), Math.sin(a), 2.2);
  }
  for (let k = 0; k < 10; k++) {
    const a = rng() * TAU;
    const d = Math.min(R0 * (1.45 + rng() * 0.5), size * 0.46);
    const r = (2 + rng() * 5) * s;
    drawBlob(D, size, clip, c + Math.cos(a) * d, c + Math.sin(a) * d, r, angularTable(rng, 0.3, 6, 0.35, 0.12, 8), 1.0);
  }
  const Mk = F(n);
  for (let i = 0; i < n; i++) Mk[i] = sstep(0.05, 0.3, D[i] + noise[i] * 0.03);
  const bm = blur(Mk, size, Math.round(5 * s), 2);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const A = F(n);
  const H = F(n);
  const Ro = F(n);
  for (let i = 0; i < n; i++) {
    const a = Mk[i];
    const inner = sstep(0.3, 0.95, bm[i]);
    const nk = 1 + noise[i] * 0.1;
    R[i] = lerp(0.4, 0.24, inner) * nk;
    G[i] = lerp(0.03, 0.014, inner) * nk;
    B[i] = lerp(0.025, 0.013, inner) * nk;
    A[i] = a;
    H[i] = Math.sqrt(bm[i]) * 1.5;
    Ro[i] = clamp(lerp(0.3, 0.03, sstep(0.15, 0.8, bm[i])) + noise[i] * 0.02, 0.02, 1);
  }
  return finishDecal(size, { R, G, B, A, H, Ro }, { bump: 1.0 });
}

function genBulletHole(size) {
  const n = size * size;
  const s = size / 256;
  const rng = makeRng(24001);
  const c = size / 2;
  const noise = fbm(size, 16, 16, 3, 24101);
  const crater = angularTable(rng, 0.45, 7, 0.35, 0.12);
  const holeT = angularTable(rng, 0.15, 0, 0);
  const CR = F(n);
  const clip = [0, 0, size, size];
  const r0 = 15 * s;
  const r1 = 40 * s;
  for (let k = 0; k < 9; k++) {
    let a = rng() * TAU;
    let x = c + Math.cos(a) * r1 * 0.9;
    let y = c + Math.sin(a) * r1 * 0.9;
    const L = (30 + rng() * 60) * s;
    const w = (0.5 + rng() * 0.6) * s;
    for (let d = 0; d < L; d += 4 * s) {
      a += (rng() * 2 - 1) * 0.35;
      const nx = x + Math.cos(a) * 4 * s;
      const ny = y + Math.sin(a) * 4 * s;
      const ww = w * (1 - d / L) + 0.25;
      forSegment(size, x, y, nx, ny, ww + 1, clip, (i, dd) => {
        const v = sstep(ww + 0.7, ww - 0.3, dd) * (1 - (d / L) * 0.6);
        if (v > CR[i]) CR[i] = v;
      });
      x = nx;
      y = ny;
      a = lerp(a, Math.atan2(y - c, x - c), 0.3);
    }
  }
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const A = F(n);
  const H = F(n);
  const Ro = F(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.sqrt(dx * dx + dy * dy);
      const th = Math.atan2(dy, dx);
      const nz = noise[i];
      const rh = r0 * tableAt(holeT, th);
      const re = r1 * tableAt(crater, th) * (1 + nz * 0.1);
      const hole = sstep(rh + 1, rh - 1, r);
      const cr = sstep(re + 1.5, re - 1.5, r);
      const soot = Math.exp(-(((r - rh) / (20 * s)) ** 2)) * (0.8 + nz * 0.3);
      const ck = CR[i] * (1 - cr);
      const wnd = 1 - sstep(size * 0.42, size * 0.5, r);
      const a = clamp01(Math.max(hole, cr * 0.9, soot * 0.55, ck * 0.75)) * wnd;
      let cr0 = 0.36 * (0.75 + nz * 0.3);
      let cg0 = 0.33 * (0.75 + nz * 0.3);
      let cb0 = 0.3 * (0.75 + nz * 0.3);
      const sv = clamp01(soot * 0.7 * (1 - hole));
      cr0 = lerp(cr0, 0.08, sv);
      cg0 = lerp(cg0, 0.07, sv);
      cb0 = lerp(cb0, 0.06, sv);
      cr0 = lerp(cr0, 0.1, ck);
      cg0 = lerp(cg0, 0.09, ck);
      cb0 = lerp(cb0, 0.08, ck);
      R[i] = lerp(cr0, 0.015, hole);
      G[i] = lerp(cg0, 0.013, hole);
      B[i] = lerp(cb0, 0.012, hole);
      A[i] = a;
      const cone = cr > 0 ? -3 * (1 - clamp01((r - rh) / Math.max(re - rh, 1))) : 0;
      H[i] = (cone + nz * 0.6 * cr - ck * 1.0) * (1 - hole) - hole * 8;
      Ro[i] = lerp(0.85, 0.95, hole);
    }
  }
  return finishDecal(size, { R, G, B, A, H, Ro }, { bump: 1.2 });
}

function genScorch(size) {
  const n = size * size;
  const rng = makeRng(25001);
  const c = size / 2;
  const R0 = size * 0.4;
  const noise = fbm(size, 8, 8, 5, 25101, 0.55);
  const grain = fbm(size, 64, 64, 2, 25102);
  const rays = angularTable(rng, 0.5, 60, 0.35, 0.03);
  const R = F(n);
  const G = F(n);
  const B = F(n);
  const A = F(n);
  const H = F(n);
  const Ro = F(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const r = Math.sqrt(dx * dx + dy * dy);
      const Re = R0 * (0.62 + 0.3 * tableAt(rays, Math.atan2(dy, dx)));
      const q = r / Re;
      const nz = noise[i];
      let dens = (1 - sstep(0.15, 1.0, q + nz * 0.15)) * (0.78 + 0.3 * (nz * 0.5 + 0.5) + grain[i] * 0.1);
      dens *= 1 - sstep(size * 0.44, size * 0.5, r);
      const a = clamp01(dens * 1.15);
      const t = sstep(0.1, 0.9, q);
      R[i] = lerp(0.02, 0.13, t) * (1 + grain[i] * 0.2);
      G[i] = lerp(0.018, 0.085, t) * (1 + grain[i] * 0.2);
      B[i] = lerp(0.016, 0.05, t) * (1 + grain[i] * 0.2);
      A[i] = a;
      H[i] = (grain[i] * 0.4 + nz * 0.3) * a;
      Ro[i] = 0.95;
    }
  }
  return finishDecal(size, { R, G, B, A, H, Ro }, { bump: 1.0 });
}

// ===========================================================================
// PARTICLE SPRITES
// ===========================================================================

function spriteBuffers(n) {
  return { R: F(n), G: F(n), B: F(n), A: F(n) };
}

function genSmoke(size) {
  const n = size * size;
  const cell = size >> 1;
  const half = cell / 2;
  const rng = makeRng(26001);
  const nz = fbm(size, 6, 6, 5, 26101, 0.55);
  const nz2 = fbm(size, 14, 14, 3, 26102);
  const { R, G, B, A } = spriteBuffers(n);
  for (let k = 0; k < 4; k++) {
    const ox = (k & 1) * cell;
    const oy = (k >> 1) * cell;
    const lobes = [];
    const cnt = 4 + Math.floor(rng() * 3);
    for (let j = 0; j < cnt; j++) lobes.push([(rng() - 0.5) * 0.6, (rng() - 0.5) * 0.55, 0.46 + rng() * 0.2]);
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = (oy + y) * size + ox + x;
        const u = (x + 0.5 - half) / half;
        const v = (y + 0.5 - half) / half;
        let shape = 0;
        for (const l of lobes) {
          const du = u - l[0];
          const dv = v - l[1];
          const e = 1 - (du * du + dv * dv) / (l[2] * l[2]);
          if (e > shape) shape = e;
        }
        const wnd = 1 - sstep(0.8, 0.99, Math.sqrt(u * u + v * v));
        const nn = nz[i] * 0.5 + 0.5;
        const dens = clamp01(shape * 1.4 - (1 - nn) * 0.3) * (0.45 + 0.75 * nn);
        A[i] = sstep(0.02, 0.85, dens) * wnd * 0.95;
        const sh = clamp01(0.55 + 0.22 * v + 0.18 * nz2[i] + 0.1 * shape);
        R[i] = sh;
        G[i] = sh;
        B[i] = sh * 1.02;
      }
    }
  }
  return finishSprite(size, R, G, B, A);
}

function fireRamp(T, out) {
  if (T < 0.35) {
    const t = T / 0.35;
    out[0] = lerp(0.75, 1.0, t);
    out[1] = lerp(0.14, 0.45, t);
    out[2] = lerp(0.03, 0.08, t);
  } else if (T < 0.7) {
    const t = (T - 0.35) / 0.35;
    out[0] = 1.0;
    out[1] = lerp(0.45, 0.8, t);
    out[2] = lerp(0.08, 0.3, t);
  } else {
    const t = clamp01((T - 0.7) / 0.3);
    out[0] = 1.0;
    out[1] = lerp(0.8, 0.97, t);
    out[2] = lerp(0.3, 0.88, t);
  }
  return out;
}

function genFire(size) {
  const n = size * size;
  const cell = size >> 1;
  const half = cell / 2;
  const nz = fbm(size, 8, 8, 5, 27101, 0.55);
  const nz2 = fbm(size, 12, 5, 4, 27102);
  const { R, G, B, A } = spriteBuffers(n);
  const col = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const ox = (k & 1) * cell;
    const oy = (k >> 1) * cell;
    const flame = k < 2;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = (oy + y) * size + ox + x;
        const u = (x + 0.5 - half) / half;
        const v = (y + 0.5 - half) / half;
        const nn = nz[i] * 0.5 + 0.5;
        let T;
        if (flame) {
          const ud = u + 0.3 * nz2[i] * clamp01((v + 1) * 0.5);
          const vd = v + 0.12 * nz[i];
          const t = (vd + 0.65) / 1.55;
          const wv = 0.42 * Math.pow(Math.max(0, 1 - t), 0.7) * sstep(-0.12, 0.1, t) + 1e-4;
          const q = Math.abs(ud) / wv;
          T = clamp01(1 - q * q) * (t < 0 ? sstep(-0.15, 0, t) : 1);
          T *= sstep(1.02, 0.7, t + (1 - nn) * 0.25);
          T = clamp01(T * (0.75 + 0.5 * nn));
        } else {
          const r = Math.sqrt(u * u + v * v);
          const Rr = 0.7 * (1 + 0.2 * nz[i] + 0.1 * nz2[i]);
          T = Math.pow(clamp01(1 - r / Rr), 0.8) * (0.7 + 0.6 * nn);
          T = clamp01(T);
        }
        const wnd = 1 - sstep(0.85, 1.0, Math.max(Math.abs(u), Math.abs(v)));
        fireRamp(T, col);
        R[i] = col[0];
        G[i] = col[1];
        B[i] = col[2];
        A[i] = sstep(0.02, 0.35, T) * wnd;
      }
    }
  }
  return finishSprite(size, R, G, B, A);
}

function genSpark(size) {
  const n = size * size;
  const h = size / 2;
  const { R, G, B, A } = spriteBuffers(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5 - h) / h;
      const v = (y + 0.5 - h) / h;
      const core = Math.exp(-((u / 0.18) ** 2) - (v / 0.05) ** 2);
      const I = clamp01(Math.exp(-((u / 0.55) ** 2) - (v / 0.09) ** 2) * 0.8 + core) * (1 - sstep(0.85, 1, Math.sqrt(u * u + v * v)));
      const t = clamp01(I * 1.2 - 0.2);
      R[i] = 1;
      G[i] = lerp(0.62, 0.95, t);
      B[i] = lerp(0.25, 0.85, t);
      A[i] = I;
    }
  }
  return finishSprite(size, R, G, B, A);
}

function genGlow(size) {
  const n = size * size;
  const h = size / 2;
  const { R, G, B, A } = spriteBuffers(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5 - h) / h;
      const v = (y + 0.5 - h) / h;
      const r = Math.sqrt(u * u + v * v);
      const I = (0.55 * Math.exp(-((r / 0.42) ** 2)) + 0.45 * Math.exp(-((r / 0.13) ** 2))) * (1 - sstep(0.75, 1.0, r));
      R[i] = 1;
      G[i] = 1;
      B[i] = 1;
      A[i] = clamp01(I);
    }
  }
  return finishSprite(size, R, G, B, A);
}

function genMuzzleFlash(size) {
  const n = size * size;
  const cell = size >> 1;
  const half = cell / 2;
  const rng = makeRng(28001);
  const nz = fbm(size, 10, 10, 4, 28101);
  const { R, G, B, A } = spriteBuffers(n);
  const spike = (u, v, a, L, w) => {
    const al = u * Math.cos(a) + v * Math.sin(a);
    if (al <= 0 || al >= L) return 0;
    const pe = -u * Math.sin(a) + v * Math.cos(a);
    const f = 1 - al / L;
    return Math.pow(f, 1.4) * Math.exp(-((pe / (w * (0.25 + f))) ** 2));
  };
  const cfg = [];
  // front views (seen from behind the gun): star shapes
  {
    const sp = [];
    const r0 = rng() * 0.3;
    for (let k = 0; k < 4; k++) sp.push([r0 + (k * TAU) / 4 + (rng() - 0.5) * 0.1, 0.8 + rng() * 0.15, 0.09]);
    for (let k = 0; k < 4; k++) sp.push([r0 + ((k + 0.5) * TAU) / 4 + (rng() - 0.5) * 0.2, 0.35 + rng() * 0.2, 0.05]);
    cfg.push({ type: 0, sp });
  }
  {
    const sp = [];
    const cnt = 6;
    for (let k = 0; k < cnt; k++) sp.push([(k * TAU) / cnt + (rng() - 0.5) * 0.35, 0.6 + rng() * 0.35, 0.07 + rng() * 0.03]);
    cfg.push({ type: 0, sp });
  }
  // side views: long cone flame with side prongs
  cfg.push({ type: 1, len: 1.7, width: 0.28, prong: 0.55 });
  cfg.push({ type: 1, len: 1.25, width: 0.36, prong: 0.75 });
  const col = [0, 0, 0];
  for (let k = 0; k < 4; k++) {
    const ox = (k & 1) * cell;
    const oy = (k >> 1) * cell;
    const c = cfg[k];
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const i = (oy + y) * size + ox + x;
        const u = (x + 0.5 - half) / half;
        const v = (y + 0.5 - half) / half;
        const nn = nz[i] * 0.5 + 0.5;
        let I;
        if (c.type === 0) {
          const r = Math.sqrt(u * u + v * v);
          I = 1.1 * Math.exp(-((r / 0.2) ** 2));
          for (const s of c.sp) I += 0.9 * spike(u, v, s[0], s[1], s[2]);
          I *= 0.8 + 0.4 * nn;
        } else {
          const uu = u + 0.85;
          const along = uu / c.len;
          let core = 0;
          if (along > 0 && along < 1) {
            const w = c.width * Math.sin(Math.PI * Math.pow(along, 0.6)) + 0.03;
            core = Math.exp(-((v / w) ** 2)) * Math.pow(1 - along, 0.6);
          }
          const base = Math.exp(-((uu / 0.12) ** 2) - (v / 0.14) ** 2) * 1.2;
          const pr = spike(uu - 0.12, v, 0.85, c.prong, 0.1) + spike(uu - 0.12, v, -0.85, c.prong, 0.1);
          I = (core * 1.1 + base + pr * 0.8) * (0.7 + 0.5 * nn);
        }
        const wnd = 1 - sstep(0.88, 1.0, Math.max(Math.abs(u), Math.abs(v)));
        I = clamp01(I) * wnd;
        const T = clamp01(I);
        if (T > 0.8) {
          const t = (T - 0.8) / 0.2;
          col[0] = 1;
          col[1] = lerp(0.85, 0.97, t);
          col[2] = lerp(0.5, 0.85, t);
        } else if (T > 0.4) {
          const t = (T - 0.4) / 0.4;
          col[0] = 1;
          col[1] = lerp(0.55, 0.85, t);
          col[2] = lerp(0.15, 0.5, t);
        } else {
          const t = T / 0.4;
          col[0] = 1;
          col[1] = lerp(0.35, 0.55, t);
          col[2] = lerp(0.06, 0.15, t);
        }
        R[i] = col[0];
        G[i] = col[1];
        B[i] = col[2];
        A[i] = clamp01(I * 1.2);
      }
    }
  }
  return finishSprite(size, R, G, B, A);
}

function genDust(size) {
  const n = size * size;
  const h = size / 2;
  const { R, G, B, A } = spriteBuffers(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5 - h) / h;
      const v = (y + 0.5 - h) / h;
      const r = Math.sqrt(u * u + v * v);
      R[i] = 0.92;
      G[i] = 0.9;
      B[i] = 0.86;
      A[i] = clamp01((Math.exp(-((r / 0.4) ** 2)) * 0.85 + Math.exp(-((r / 0.15) ** 2)) * 0.15) * (1 - sstep(0.8, 1, r)));
    }
  }
  return finishSprite(size, R, G, B, A);
}

function genFogPuff(size) {
  const n = size * size;
  const h = size / 2;
  const base = fbm(size, 4, 4, 5, 29101, 0.55);
  const wx = fbm(size, 3, 3, 3, 29102);
  const wy = fbm(size, 3, 3, 3, 29103);
  const nz = warpField(base, size, wx, wy, size * 0.12);
  const { R, G, B, A } = spriteBuffers(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5 - h) / h;
      const v = (y + 0.5 - h) / h;
      const r = Math.sqrt(u * u + v * v);
      const fall = 1 - sstep(0.25, 0.98, r);
      const e = nz[i] * 0.5 + 0.5;
      const dens = fall * sstep(0.25, 0.85, e + 0.25 * fall - 0.05);
      A[i] = clamp01(dens * 0.85);
      const g = 0.8 + 0.12 * e;
      R[i] = g;
      G[i] = g;
      B[i] = g;
    }
  }
  return finishSprite(size, R, G, B, A);
}

function genAcidPuff(size) {
  const n = size * size;
  const h = size / 2;
  const cloud = fbm(size, 5, 5, 4, 30101);
  const cloud2 = fbm(size, 12, 12, 3, 30104);
  const bub = worley(size, 7, 7, 30102);
  const bub2 = worley(size, 14, 14, 30103);
  const { R, G, B, A } = spriteBuffers(n);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const u = (x + 0.5 - h) / h;
      const v = (y + 0.5 - h) / h;
      const r = Math.sqrt(u * u + v * v);
      const fall = 1 - sstep(0.3, 0.97, r + cloud[i] * 0.12);
      const cl = cloud[i] * 0.5 + 0.5;
      const on1 = bub.id[i] < 0.45 ? 1 : 0;
      const on2 = bub2.id[i] < 0.3 ? 1 : 0;
      const f1 = bub.f1[i];
      const inside = sstep(0.42, 0.34, f1) * on1;
      const rim = Math.exp(-(((f1 - 0.37) / 0.045) ** 2)) * on1;
      const f2 = bub2.f1[i];
      const inside2 = sstep(0.4, 0.3, f2) * on2;
      const rim2 = Math.exp(-(((f2 - 0.35) / 0.05) ** 2)) * on2;
      const bright = clamp01(rim * 0.6 + rim2 * 0.4 + inside * 0.15 + cl * 0.35 + cloud2[i] * 0.15);
      R[i] = lerp(0.1, 0.5, bright);
      G[i] = lerp(0.42, 0.98, bright);
      B[i] = lerp(0.33, 0.7, bright);
      const dens = fall * (0.4 + 0.45 * cl + 0.15 * cloud2[i] + 0.35 * Math.max(inside * 0.5 + rim, inside2 * 0.4 + rim2 * 0.7));
      A[i] = clamp01(dens);
    }
  }
  return finishSprite(size, R, G, B, A);
}

// ===========================================================================
// Registry / API
// ===========================================================================

// [name, size, metersPerRepeat, generator, tiling]
const GENERATORS = [
  ['woodFloor', 1024, 2.0, genWoodFloor, true],
  ['plaster', 1024, 2.5, genPlaster, true],
  ['plasterExterior', 1024, 3.0, genPlasterExterior, true],
  ['woodBeam', 512, 1.5, genWoodBeam, true],
  ['ceilingBoards', 512, 2.0, genCeilingBoards, true],
  ['woodPainted', 512, 1.5, genWoodPainted, true],
  ['concrete', 1024, 3.0, genConcrete, true],
  ['roof', 512, 2.0, genRoof, true],
  ['mud', 1024, 4.0, genMud, true],
  ['brick', 512, 1.5, genBrick, true],
  ['rustyMetal', 512, 1.5, genRustyMetal, true],
  ['metalDark', 512, 1.0, genMetalDark, true],
  ['crateWood', 512, 1.2, genCrateWood, true],
  ['cardboard', 512, 1.0, genCardboard, true],
  ['fabric', 512, 1.0, genFabric, true],
  ['clothDetail', 512, 0.4, genClothDetail, true],
  ['flesh', 1024, 0.5, genFlesh, true],
  ['bark', 512, 2.0, genBark, true],
  ['foliage', 512, 1.0, genFoliage, false],
  ['porcelain', 512, 1.0, genPorcelain, true],
  ['gunMetal', 512, 0.3, genGunMetal, true],
  ['bloodDecals', 1024, 1, genBloodDecals, false],
  ['bloodPool', 512, 1, genBloodPool, false],
  ['bulletHole', 256, 1, genBulletHole, false],
  ['scorch', 512, 1, genScorch, false],
  ['smoke', 256, 1, genSmoke, false],
  ['fire', 256, 1, genFire, false],
  ['spark', 64, 1, genSpark, false],
  ['glow', 128, 1, genGlow, false],
  ['muzzleFlash', 256, 1, genMuzzleFlash, false],
  ['dust', 64, 1, genDust, false],
  ['fogPuff', 256, 1, genFogPuff, false],
  ['acidPuff', 256, 1, genAcidPuff, false],
];

export const TEXTURE_NAMES = GENERATORS.map((g) => g[0]);

const registry = new Map();
let generating = null;

/** Tiny neutral set used if a generator throws (keeps the game running). */
function fallbackSet(mpr, repeat) {
  const size = 4;
  const n = size * size;
  const c = new Uint8Array(n * 4);
  const nm = new Uint8Array(n * 4);
  const r = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    c.set([128, 128, 128, 255], i * 4);
    nm.set([128, 128, 255, 255], i * 4);
    r.set([255, 204, 0, 255], i * 4);
  }
  const rt = makeTex(r, size, false, repeat);
  return {
    map: makeTex(c, size, true, repeat),
    normalMap: makeTex(nm, size, false, repeat),
    roughnessMap: rt,
    aoMap: rt,
    metersPerRepeat: mpr,
    size,
  };
}

const yieldToEventLoop = () => new Promise((r) => setTimeout(r, 0));

async function runGeneration(onProgress) {
  const total = GENERATORS.reduce((a, g) => a + g[1] * g[1], 0);
  let done = 0;
  const report = (f, label) => {
    if (onProgress) {
      try {
        onProgress(f, label);
      } catch (e) {
        /* ignore UI errors */
      }
    }
  };
  for (const [name, size, mpr, fn, tiling] of GENERATORS) {
    report(done / total, name);
    await yieldToEventLoop();
    if (!registry.has(name)) {
      let set;
      try {
        set = fn(size, mpr);
        set.metersPerRepeat = mpr;
      } catch (e) {
        console.error(`[textures] generator '${name}' failed:`, e);
        set = fallbackSet(mpr, tiling);
      }
      set.name = name;
      registry.set(name, set);
      releaseScratch();
    }
    done += size * size;
  }
  clearScratch();
  report(1, 'done');
  return registry;
}

/**
 * Generate every texture set once. Subsequent calls return the same promise.
 * @param {(fraction:number, label:string)=>void} [onProgress]
 */
export async function generateAllTextures(onProgress) {
  if (!generating) {
    generating = runGeneration(onProgress);
  } else if (onProgress) {
    generating.then(() => {
      try {
        onProgress(1, 'done');
      } catch (e) {
        /* ignore UI errors */
      }
    });
  }
  return generating;
}

/** Texture set for `name`. Throws if the name is unknown or not generated yet. */
export function tex(name) {
  const set = registry.get(name);
  if (!set) {
    if (!TEXTURE_NAMES.includes(name)) throw new Error(`[textures] unknown texture set '${name}'`);
    throw new Error(`[textures] texture set '${name}' not generated yet — await generateAllTextures() first`);
  }
  return set;
}

/** True once `name` has been generated. */
export function hasTexture(name) {
  return registry.has(name);
}
