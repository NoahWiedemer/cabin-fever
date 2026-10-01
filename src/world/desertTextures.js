// Canvas-painted textures and materials of Desert Thunder (world/desert.js), made when that map loads: the fine sand of
// the lots, the packed dirt of the streets, lime-washed plaster in four tones (stained, cracked, pocked by old fire),
// the temple's sandstone blocks and floor slabs, the grey concrete of the retaining wall, flat roofs, the corrugated
// steel of shop shutters and roofs, striped awnings, and the quads the houses are dressed with (windows with shutters
// and bars, doors, signs). Box materials are registered with world/materials.js (registerMaterial) under 'dt*' names
// for LevelBuilder boxes; the quads are plain materials with 0..1 UVs (DESERT_QUADS).
import * as THREE from 'three';
import { registerMaterial } from './materials.js';

// ---------------------------------------------------------------- noise
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** tileable value noise: `cells` cells across a size x size field (0..1) */
function vnoise(size, cells, seed) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
    const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
      const c0 = x0 % cells, c1 = (x0 + 1) % cells;
      const a = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx;
      const b = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  }
  return out;
}
function fbm(size, cells, oct, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = vnoise(size, cells << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    tot += amp;
    amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

// ---------------------------------------------------------------- canvas helpers
function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
/** per-pixel RGB(A) from fn(x, y, i) -> [r, g, b, a?] (0..255) */
function paint(c, fn) {
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  for (let y = 0, i = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++, i++) {
      const p = fn(x, y, i);
      d[i * 4] = p[0];
      d[i * 4 + 1] = p[1];
      d[i * 4 + 2] = p[2];
      d[i * 4 + 3] = p[3] ?? 255;
    }
  ctx.putImageData(img, 0, 0);
  return ctx;
}
function canvasTex(c, { srgb = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}
/** a normal map from a (tiling) height field */
function normalTex(H, w, h, strength) {
  const c = makeCanvas(w, h);
  paint(c, (x, y) => {
    const xl = (x - 1 + w) % w, xr = (x + 1) % w, yu = (y - 1 + h) % h, yd = (y + 1) % h;
    const dx = (H[y * w + xr] - H[y * w + xl]) * strength;
    const dy = (H[yd * w + x] - H[yu * w + x]) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l) * 127.5 + 127.5, (dy / l) * 127.5 + 127.5, (1 / l) * 127.5 + 127.5];
  });
  return canvasTex(c, { srgb: false });
}
const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
/** a crooked line on ctx (cracks, stains' edges) */
function crack(ctx, r, x, y, steps, len, w, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let s = 0; s < steps; s++) {
    a += (r() - 0.5) * 1.1;
    x += Math.cos(a) * len * (0.5 + r());
    y += Math.sin(a) * len * (0.5 + r());
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}
/** bullet pocks: a dark hole in a pale chipped ring */
function pocks(ctx, r, n, S, x0 = 0, y0 = 0, w = S, h = S) {
  for (let i = 0; i < n; i++) {
    const x = x0 + r() * w, y = y0 + r() * h, s = 2 + r() * 4;
    ctx.fillStyle = 'rgba(255,248,230,0.35)';
    ctx.beginPath();
    ctx.arc(x, y, s * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(40,30,22,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- the tiling surfaces
const GEN = {
  // the fine sand of the lots and the edges: pale, rippled by the wind, darker grit and a few stones (4 m a tile)
  sand() {
    const S = 1024;
    const big = fbm(S, 5, 3, 31), fine = fbm(S, 96, 2, 32), rip = fbm(S, 12, 2, 33), r = rng(34);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ctx = paint(c, (x, y, i) => {
      const ripple = Math.sin((y + rip[i] * 90) * 0.19 + x * 0.02) * 0.5 + 0.5;
      const v = (big[i] - 0.5) * 0.9 + (fine[i] - 0.5) * 0.5 + (ripple - 0.5) * 0.18;
      H[i] = ripple * 0.35 + fine[i] * 0.45 + big[i] * 0.2;
      return [cl(214 + v * 42), cl(190 + v * 40), cl(150 + v * 36)];
    });
    for (let i = 0; i < 2600; i++) {
      const x = r() * S, y = r() * S, s = 0.6 + r() * 2.2;
      ctx.fillStyle = r() < 0.6 ? `rgba(120,96,66,${0.25 + r() * 0.35})` : `rgba(250,240,220,${0.2 + r() * 0.3})`;
      ctx.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, s = 2 + r() * 6;
      ctx.fillStyle = `rgba(${130 + r() * 40},${116 + r() * 30},${96 + r() * 30},0.9)`;
      ctx.beginPath();
      ctx.ellipse(x, y, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 2.4), mpr: 4, rough: 0.97 };
  },
  // the streets: packed reddish dirt, wheel ruts, gravel, dark oil stains, tyre prints (5 m a tile)
  dirt() {
    const S = 1024;
    const big = fbm(S, 4, 3, 41), fine = fbm(S, 128, 2, 42), mid = fbm(S, 20, 2, 43), r = rng(44);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ctx = paint(c, (x, y, i) => {
      const rut = Math.exp(-Math.pow(((x + mid[i] * 60) % 512) - 170, 2) / 900) + Math.exp(-Math.pow(((x + mid[i] * 60) % 512) - 350, 2) / 900);
      const v = (big[i] - 0.5) * 0.8 + (fine[i] - 0.5) * 0.7 + (mid[i] - 0.5) * 0.3 - rut * 0.12;
      H[i] = fine[i] * 0.6 + mid[i] * 0.4 - rut * 0.3;
      return [cl(176 + v * 48), cl(140 + v * 40), cl(104 + v * 34)];
    });
    for (let i = 0; i < 5000; i++) {
      const x = r() * S, y = r() * S, s = 0.8 + r() * 2.4;
      ctx.fillStyle = r() < 0.5 ? `rgba(90,70,52,${0.3 + r() * 0.4})` : `rgba(230,214,190,${0.2 + r() * 0.3})`;
      ctx.fillRect(x, y, s, s);
    }
    for (let i = 0; i < 9; i++) {
      const x = r() * S, y = r() * S, s = 20 + r() * 60;
      const g = ctx.createRadialGradient(x, y, 0, x, y, s);
      g.addColorStop(0, 'rgba(40,32,26,0.4)');
      g.addColorStop(1, 'rgba(40,32,26,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 2.0), mpr: 5, rough: 0.95 };
  },
  /**
   * lime-washed plaster (3 m a tile): `base` its colour, painted over now and then (a darker band along the foot),
   * stained by rain from the roof edges, cracked, the wash flaking to bare render, pocked by old gunfire
   */
  plaster(seed, base, stain = [120, 96, 70]) {
    const S = 512;
    const big = fbm(S, 4, 3, seed), fine = fbm(S, 64, 2, seed + 1), mottle = fbm(S, 16, 2, seed + 2), r = rng(seed + 3);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ctx = paint(c, (x, y, i) => {
      const flake = mottle[i] > 0.7 ? (mottle[i] - 0.7) * 3 : 0; // the wash gone: the render under it
      const v = (big[i] - 0.5) * 0.35 + (fine[i] - 0.5) * 0.25;
      H[i] = fine[i] * 0.5 + big[i] * 0.2 - flake * 0.4;
      const k = 1 + v * 0.3;
      return [cl(base[0] * k - flake * 40), cl(base[1] * k - flake * 44), cl(base[2] * k - flake * 50)];
    });
    // streaks running down from the top
    for (let i = 0; i < 26; i++) {
      const x = r() * S, w = 3 + r() * 12, len = 40 + r() * 200;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, `rgba(${stain[0]},${stain[1]},${stain[2]},${0.18 + r() * 0.2})`);
      g.addColorStop(1, `rgba(${stain[0]},${stain[1]},${stain[2]},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, len);
    }
    for (let i = 0; i < 6; i++) crack(ctx, r, r() * S, r() * S, 8 + Math.floor(r() * 8), 9, 1 + r(), 'rgba(70,56,42,0.55)');
    pocks(ctx, r, 10, S);
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 1.6), mpr: 3, rough: 0.94 };
  },
  // the temple: sandstone ashlar, courses of long blocks, worn edges, joints of darker mortar (2.4 m a tile)
  stone() {
    const S = 512;
    const fine = fbm(S, 64, 2, 51), big = fbm(S, 6, 2, 52), r = rng(53);
    const H = new Float32Array(S * S);
    const rows = 6, rowH = S / rows;
    const offs = Array.from({ length: rows }, () => r() * S);
    const joints = Array.from({ length: rows }, () => {
      const out = [];
      let x = 0;
      while (x < S) {
        out.push(x);
        x += S / (2 + Math.floor(r() * 2));
      }
      return out;
    });
    const tint = Array.from({ length: 40 }, () => 0.9 + r() * 0.2);
    const c = makeCanvas(S);
    paint(c, (x, y, i) => {
      const row = Math.floor(y / rowH), yy = y - row * rowH;
      const xx = (x + offs[row]) % S;
      let jd = Math.min(yy, rowH - yy);
      let bi = 0;
      for (let k = 0; k < joints[row].length; k++) {
        const jx = joints[row][k];
        jd = Math.min(jd, Math.abs(xx - jx), Math.abs(xx - jx - S));
        if (xx >= jx) bi = k;
      }
      const t = tint[(row * 7 + bi) % tint.length];
      const joint = jd < 3 ? 1 - jd / 3 : 0;
      const edge = jd < 9 ? (1 - jd / 9) * 0.3 : 0;
      const v = (fine[i] - 0.5) * 0.3 + (big[i] - 0.5) * 0.2;
      H[i] = 0.8 - joint * 0.8 - edge * 0.3 + fine[i] * 0.2;
      const k = t * (1 + v) * (1 - joint * 0.45) * (1 - edge * 0.25);
      return [cl(206 * k), cl(176 * k), cl(132 * k)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 3.2), mpr: 2.4, rough: 0.9 };
  },
  // the temple's floor: big square slabs, worn smooth in the middle, sand in the joints (2 m a tile)
  stoneFloor() {
    const S = 512;
    const fine = fbm(S, 64, 2, 61), big = fbm(S, 5, 2, 62), r = rng(63);
    const H = new Float32Array(S * S);
    const tint = Array.from({ length: 16 }, () => 0.88 + r() * 0.2);
    const c = makeCanvas(S);
    paint(c, (x, y, i) => {
      const n = 2, cs = S / n;
      const cx = Math.floor(x / cs), cy = Math.floor(y / cs);
      const jx = Math.min(x % cs, cs - (x % cs)), jy = Math.min(y % cs, cs - (y % cs));
      const jd = Math.min(jx, jy);
      const joint = jd < 3 ? 1 - jd / 3 : 0;
      const t = tint[(cy * n + cx) % tint.length];
      const v = (fine[i] - 0.5) * 0.25 + (big[i] - 0.5) * 0.25;
      H[i] = 0.7 - joint * 0.7 + fine[i] * 0.2;
      const k = t * (1 + v) * (1 - joint * 0.4);
      return [cl(196 * k), cl(170 * k), cl(134 * k)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 2.4), mpr: 2, rough: 0.8 };
  },
  // cast concrete: the retaining wall, the bunkers, the gate posts (3 m a tile)
  concrete() {
    const S = 512;
    const fine = fbm(S, 64, 2, 71), big = fbm(S, 6, 3, 72), r = rng(73);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ctx = paint(c, (x, y, i) => {
      const v = (fine[i] - 0.5) * 0.3 + (big[i] - 0.5) * 0.35;
      H[i] = fine[i] * 0.6 + big[i] * 0.4;
      return [cl(168 * (1 + v)), cl(160 * (1 + v)), cl(148 * (1 + v))];
    });
    ctx.fillStyle = 'rgba(60,54,46,0.35)';
    ctx.fillRect(0, S / 2 - 1, S, 2); // the formwork's seam
    for (let i = 0; i < 4; i++) crack(ctx, r, r() * S, r() * S, 10, 10, 1.2, 'rgba(60,52,44,0.5)');
    pocks(ctx, r, 16, S);
    for (let i = 0; i < 20; i++) {
      const x = r() * S, w = 4 + r() * 18, len = 60 + r() * 300;
      const g = ctx.createLinearGradient(0, 0, 0, len);
      g.addColorStop(0, 'rgba(70,58,44,0.25)');
      g.addColorStop(1, 'rgba(70,58,44,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, w, len);
    }
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 1.8), mpr: 3, rough: 0.95 };
  },
  // flat roofs: patched tar and screed, dust in the low spots (4 m a tile)
  roof() {
    const S = 512;
    const fine = fbm(S, 64, 2, 81), big = fbm(S, 5, 3, 82), r = rng(83);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ctx = paint(c, (x, y, i) => {
      const dust = big[i] > 0.55 ? (big[i] - 0.55) * 2.2 : 0;
      const v = (fine[i] - 0.5) * 0.3;
      H[i] = fine[i];
      return [cl((120 + dust * 80) * (1 + v)), cl((108 + dust * 70) * (1 + v)), cl((96 + dust * 50) * (1 + v))];
    });
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = `rgba(${60 + r() * 30},${56 + r() * 26},${52 + r() * 20},0.6)`;
      ctx.fillRect(r() * S, r() * S, 30 + r() * 90, 20 + r() * 70);
    }
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 1.4), mpr: 4, rough: 0.9 };
  },
  // corrugated steel: the ribs, rust bleeding from the rivets and the edges, faded paint (2 m a tile)
  corrugated(seed, paint0) {
    const S = 512;
    const fine = fbm(S, 64, 2, seed), rust = fbm(S, 8, 3, seed + 1);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    paint(c, (x, y, i) => {
      const rib = Math.sin((x / S) * Math.PI * 2 * 16) * 0.5 + 0.5;
      const rr = rust[i] > 0.55 ? Math.min(1, (rust[i] - 0.55) * 3.5) : 0;
      H[i] = rib * 0.9 + fine[i] * 0.1;
      const shade = 0.8 + rib * 0.3 + (fine[i] - 0.5) * 0.2;
      return [cl((paint0[0] * (1 - rr) + 120 * rr) * shade), cl((paint0[1] * (1 - rr) + 62 * rr) * shade), cl((paint0[2] * (1 - rr) + 34 * rr) * shade)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 4), mpr: 2, rough: 0.7, metal: 0.4 };
  },
};

// ---------------------------------------------------------------- the quads (0..1 UVs, no tiling)
const QGEN = {
  /** a window: the dark room behind, the frame, sometimes shutters half open, sometimes bars */
  window(seed, frame, shutter) {
    const W = 128, Hh = 192, r = rng(seed);
    const c = makeCanvas(W, Hh);
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${frame[0]},${frame[1]},${frame[2]})`;
    ctx.fillRect(0, 0, W, Hh);
    const g = ctx.createLinearGradient(0, 14, 0, Hh - 14);
    g.addColorStop(0, '#15120f');
    g.addColorStop(1, '#2a221a');
    ctx.fillStyle = g;
    ctx.fillRect(12, 12, W - 24, Hh - 24);
    ctx.fillStyle = `rgba(${frame[0] * 0.8},${frame[1] * 0.8},${frame[2] * 0.8},1)`;
    ctx.fillRect(W / 2 - 3, 12, 6, Hh - 24); // the mullion
    if (shutter) {
      ctx.fillStyle = `rgb(${shutter[0]},${shutter[1]},${shutter[2]})`;
      ctx.fillRect(0, 0, 30, Hh);
      ctx.fillRect(W - 30, 0, 30, Hh);
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      for (let y = 10; y < Hh; y += 9) {
        ctx.beginPath();
        ctx.moveTo(2, y);
        ctx.lineTo(28, y + 3);
        ctx.moveTo(W - 28, y);
        ctx.lineTo(W - 2, y + 3);
        ctx.stroke();
      }
    }
    if (r() < 0.5) {
      ctx.strokeStyle = 'rgba(30,28,26,0.95)';
      ctx.lineWidth = 3;
      for (let x = 22; x < W - 12; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 12);
        ctx.lineTo(x, Hh - 12);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, Hh - 10, W, 10); // the sill's shadow
    return canvasTex(c, { repeat: false });
  },
  /** a door: planks or sheet steel, paint worn at the handle, a dark gap under it */
  door(seed, col, steel) {
    const W = 128, Hh = 256, r = rng(seed);
    const c = makeCanvas(W, Hh);
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.fillRect(0, 0, W, Hh);
    if (steel) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 3;
      ctx.strokeRect(10, 10, W - 20, Hh / 2 - 14);
      ctx.strokeRect(10, Hh / 2 + 4, W - 20, Hh / 2 - 14);
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      for (let x = 16; x < W; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, Hh);
        ctx.stroke();
      }
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = `rgba(${200 + r() * 40},${190 + r() * 40},${170 + r() * 40},${0.1 + r() * 0.2})`;
      ctx.fillRect(r() * W, r() * Hh, 2 + r() * 10, 1 + r() * 4);
    }
    ctx.fillStyle = '#2b2622';
    ctx.fillRect(W - 26, Hh * 0.5, 8, 16); // the handle
    return canvasTex(c, { repeat: false });
  },
  /** a shop's rolled-down shutter: the slats, rust, a sprayed mark */
  shutter(seed, col) {
    const W = 256, Hh = 256, r = rng(seed);
    const c = makeCanvas(W, Hh);
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${col[0]},${col[1]},${col[2]})`;
    ctx.fillRect(0, 0, W, Hh);
    for (let y = 0; y < Hh; y += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, y, W, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, y + 2, W, 1);
    }
    for (let i = 0; i < 14; i++) {
      const x = r() * W, y = r() * Hh;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 20 + r() * 30);
      g.addColorStop(0, 'rgba(110,56,28,0.55)');
      g.addColorStop(1, 'rgba(110,56,28,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 50, y - 50, 100, 100);
    }
    // a sprayed mark: loops and a stroke, no letters
    ctx.strokeStyle = r() < 0.5 ? 'rgba(20,20,22,0.7)' : 'rgba(140,24,20,0.7)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    const x0 = 60 + r() * 100, y0 = 80 + r() * 80;
    ctx.moveTo(x0, y0);
    for (let k = 0; k < 6; k++) ctx.quadraticCurveTo(x0 + k * 18 + r() * 20, y0 - 30 + r() * 60, x0 + k * 22 + 20, y0 + r() * 20 - 10);
    ctx.stroke();
    return canvasTex(c, { repeat: false });
  },
  /** a shop sign: a painted board, a band of colour, pseudo-script strokes (no real words), a drawn product */
  sign(seed) {
    const W = 512, Hh = 128, r = rng(seed);
    const pal = [[196, 44, 36], [34, 96, 150], [40, 120, 70], [210, 160, 40], [120, 40, 110]];
    const bg = pal[Math.floor(r() * pal.length)];
    const c = makeCanvas(W, Hh);
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
    ctx.fillRect(0, 0, W, Hh);
    ctx.fillStyle = 'rgba(240,236,224,0.95)';
    ctx.fillRect(8, 8, W - 16, 8);
    ctx.fillRect(8, Hh - 16, W - 16, 8);
    ctx.strokeStyle = 'rgba(250,246,236,0.95)';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    let x = W - 40;
    while (x > 150) {
      ctx.beginPath();
      const y = 64 + (r() - 0.5) * 14;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x - 14, y - 22 - r() * 10, x - 28 - r() * 20, y + (r() - 0.5) * 8);
      ctx.stroke();
      if (r() < 0.5) {
        ctx.beginPath();
        ctx.arc(x - 12, y - 30, 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      x -= 36 + r() * 30;
    }
    ctx.fillStyle = 'rgba(250,246,236,0.9)';
    ctx.beginPath();
    ctx.arc(80, 64, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = `rgb(${bg[0] * 0.6},${bg[1] * 0.6},${bg[2] * 0.6})`;
    ctx.fillRect(62, 46, 36, 36);
    // sun and grime
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(230,210,170,${r() * 0.18})`;
      ctx.fillRect(r() * W, r() * Hh, 6 + r() * 30, 2 + r() * 6);
    }
    return canvasTex(c, { repeat: false });
  },
  /** a striped awning's cloth */
  awning(seed) {
    const W = 256, Hh = 128, r = rng(seed);
    const pal = [[[190, 60, 40], [230, 220, 196]], [[40, 110, 140], [226, 216, 190]], [[60, 120, 60], [220, 210, 180]], [[200, 150, 40], [236, 226, 200]]];
    const [a, b] = pal[Math.floor(r() * pal.length)];
    const c = makeCanvas(W, Hh);
    paint(c, (x, y) => {
      const s = Math.floor(x / 32) % 2 ? a : b;
      const v = 0.85 + 0.15 * Math.sin(y * 0.3) + (r() - 0.5) * 0.08;
      return [cl(s[0] * v), cl(s[1] * v), cl(s[2] * v)];
    });
    return canvasTex(c, { repeat: false });
  },
};

// ---------------------------------------------------------------- materials
let MADE = null;

/** plaster tones of the houses (world/desert.js picks one per house) */
export const PLASTER = ['dtPlasterWhite', 'dtPlasterSand', 'dtPlasterOchre', 'dtPlasterBlue', 'dtPlasterPink'];

/**
 * Make and register the map's materials (once). Returns { quads: { window: [..], door: [..], shutter, sign: [..],
 * awning: [..] } } for world/desert.js's dressing.
 */
export function makeDesertMaterials() {
  if (MADE) return MADE;
  const reg = (name, t, extra = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: t.rough ?? 0.95, metalness: t.metal ?? 0, ...extra });
    m.userData.metersPerRepeat = t.mpr ?? 3;
    registerMaterial(name, m);
    return m;
  };
  reg('dtSand', GEN.sand());
  reg('dtDirt', GEN.dirt());
  reg('dtPlasterWhite', GEN.plaster(101, [232, 226, 212]));
  reg('dtPlasterSand', GEN.plaster(111, [214, 190, 150]));
  reg('dtPlasterOchre', GEN.plaster(121, [210, 164, 100]));
  reg('dtPlasterBlue', GEN.plaster(131, [170, 196, 204], [90, 100, 96]));
  reg('dtPlasterPink', GEN.plaster(141, [214, 170, 150]));
  reg('dtStone', GEN.stone());
  reg('dtStoneFloor', GEN.stoneFloor());
  reg('dtConcrete', GEN.concrete());
  reg('dtRoof', GEN.roof());
  reg('dtTin', GEN.corrugated(151, [150, 150, 146]));
  reg('dtTinBlue', GEN.corrugated(161, [70, 110, 140]));
  const quad = (t, o = {}) => new THREE.MeshStandardMaterial({ map: t, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0, side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, alphaTest: o.alphaTest ?? 0 });
  const frames = [[188, 176, 150], [70, 90, 110], [120, 72, 46], [60, 96, 70]];
  const shutters = [null, [60, 110, 130], [120, 150, 90], [150, 70, 50], null];
  MADE = {
    quads: {
      window: frames.flatMap((f, i) => [quad(QGEN.window(200 + i, f, shutters[i])), quad(QGEN.window(210 + i, f, shutters[(i + 2) % shutters.length]))]),
      door: [quad(QGEN.door(301, [88, 62, 40], false)), quad(QGEN.door(302, [46, 90, 110], true)), quad(QGEN.door(303, [120, 44, 36], true)), quad(QGEN.door(304, [70, 74, 70], true))],
      shutter: [quad(QGEN.shutter(401, [128, 134, 132]), { metal: 0.3, rough: 0.6 }), quad(QGEN.shutter(402, [58, 96, 118]), { metal: 0.3, rough: 0.6 }), quad(QGEN.shutter(403, [150, 120, 70]), { metal: 0.3, rough: 0.6 })],
      sign: [501, 502, 503, 504, 505, 506].map((s) => quad(QGEN.sign(s), { rough: 0.7 })),
      awning: [601, 602, 603, 604].map((s) => quad(QGEN.awning(s), { side: THREE.DoubleSide })),
    },
  };
  return MADE;
}
