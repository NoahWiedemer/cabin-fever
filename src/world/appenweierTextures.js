// Canvas-painted textures and materials of the Appenweier map (world/appenweier.js), made when that map loads
// (the farm never pays for them): street asphalt, the dry lawn, the hexagon pavers of the Sanderstraße 13
// yard, 13c's lap siding, clay roof tiles, plaster, the industrial panels next door, background facades with
// windows, corn plants, lime-tree leaves, laurel, the privacy-strip fence, signs. Materials are registered with
// world/materials.js (registerMaterial) under 'aw*' names so LevelBuilder boxes and props can use them.
import * as THREE from 'three';
import { registerMaterial, getMaterial } from './materials.js';

const TEX = new Map();

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
/** tileable value noise, `cells` cells across a size x size field (0..1) */
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
/** paint per-pixel RGB(A) from fn(x, y, i) -> [r, g, b, a?] (0..255) */
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
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}
/** normal map from a height field (0..1, size x size, tiling) */
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

// ---------------------------------------------------------------- the texture sets
const GEN = {
  // street asphalt: dark with light and dark grit, big faint patches, a few cracks (4 m a tile)
  asphalt() {
    const S = 512;
    const big = fbm(S, 4, 3, 11), fine = fbm(S, 64, 2, 12), r = rng(13);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const grit = new Float32Array(S * S);
    for (let i = 0; i < 9000; i++) {
      const x = Math.floor(r() * S), y = Math.floor(r() * S), v = r();
      grit[y * S + x] = v < 0.55 ? 0.9 + r() * 0.5 : -(0.4 + r() * 0.4);
      if (r() < 0.3) grit[y * S + ((x + 1) % S)] = grit[y * S + x] * 0.6;
    }
    const ctx = paint(c, (x, y, i) => {
      const b = 58 + (big[i] - 0.5) * 22 + (fine[i] - 0.5) * 14 + grit[i] * 26;
      H[i] = fine[i] * 0.4 + Math.max(0, grit[i]) * 0.6;
      return [cl(b), cl(b + 1), cl(b + 3)];
    });
    ctx.strokeStyle = 'rgba(18,18,20,0.55)';
    for (let k = 0; k < 5; k++) {
      ctx.lineWidth = 0.8 + r() * 1.2;
      ctx.beginPath();
      let x = r() * S, y = r() * S;
      ctx.moveTo(x, y);
      for (let s = 0; s < 14; s++) {
        x += (r() - 0.5) * 34;
        y += (r() - 0.3) * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 2.2), mpr: 4, rough: 0.92 };
  },
  // the dry, patchy September lawn (3 m a tile)
  grass() {
    const S = 512;
    const n1 = fbm(S, 6, 3, 21), n2 = fbm(S, 24, 2, 22), n3 = fbm(S, 96, 1, 23), r = rng(24);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ctx = paint(c, (x, y, i) => {
      const dry = Math.min(1, Math.max(0, (n1[i] - 0.42) * 2.6 + (n2[i] - 0.5) * 0.8));
      const g = 0.75 + n3[i] * 0.5;
      H[i] = n3[i];
      return [cl((62 + dry * 70) * g), cl((88 + dry * 42) * g), cl((38 + dry * 22) * g)];
    });
    for (let k = 0; k < 7000; k++) {
      const x = r() * S, y = r() * S, dry = r() < 0.35;
      ctx.strokeStyle = dry ? `rgba(${160 + r() * 40},${140 + r() * 30},${80 + r() * 20},0.55)` : `rgba(${50 + r() * 30},${90 + r() * 40},${30 + r() * 20},0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 5, y - 3 - r() * 5);
      ctx.stroke();
    }
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 1.2), mpr: 3, rough: 1 };
  },
  // hexagon concrete pavers ("Wabenpflaster") of the yard in front of the garage (2.4 m a tile)
  pavers() {
    const S = 512;
    const H = new Float32Array(S * S);
    const n = fbm(S, 16, 3, 31), r = rng(32);
    const tone = new Float32Array(256).map(() => r());
    const c = makeCanvas(S);
    // a hexagonal lattice that tiles the square: 7 across, 8 rows (a hair off regular); the joints are where
    // the nearest and second-nearest centres are about as far (Voronoi edges)
    const w = S / 7, rowH = S / 8;
    paint(c, (x, y, i) => {
      const row = Math.round(y / rowH);
      let best = 1e9, second = 1e9, id = 0;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = row + dr, off = (((rr % 2) + 2) % 2) * w * 0.5;
        const col = Math.round((x - off) / w);
        for (let dc = -1; dc <= 1; dc++) {
          const cx = (col + dc) * w + off, cy = rr * rowH;
          const d = Math.hypot(x - cx, y - cy);
          if (d < best) {
            second = best;
            best = d;
            id = (((rr % 8) + 8) % 8) * 7 + ((((col + dc) % 7) + 7) % 7);
          } else if (d < second) second = d;
        }
      }
      const edge = Math.min(1, Math.max(0, (second - best - 2) / 4));
      H[i] = edge * 0.8 + n[i] * 0.2;
      const b = (118 + tone[id] * 26 + (n[i] - 0.5) * 30) * (0.35 + 0.65 * edge);
      return [cl(b + 4), cl(b + 1), cl(b - 4)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 3), mpr: 2.4, rough: 0.95 };
  },
  // white horizontal lap siding (13c): 16 cm boards (2 m a tile)
  siding() {
    const S = 512;
    const board = S / 12.5;
    const n = fbm(S, 32, 2, 41);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    paint(c, (x, y, i) => {
      const f = (y % board) / board; // 0 top of a board .. 1 its lower edge
      const lip = f > 0.9 ? 0.55 : 1 - (1 - f) * 0.06;
      H[i] = f < 0.9 ? f * 0.8 : 0;
      const b = (224 + (n[i] - 0.5) * 16) * lip;
      return [cl(b), cl(b + 2), cl(b + 5)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 2.5), mpr: 2, rough: 0.8 };
  },
  // clean rough plaster ("Rauputz"), tinted by the material colour (2 m a tile)
  plaster() {
    const S = 512;
    const n = fbm(S, 128, 2, 51), m = fbm(S, 8, 3, 52);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    paint(c, (x, y, i) => {
      H[i] = n[i];
      const b = 226 + (n[i] - 0.5) * 30 + (m[i] - 0.5) * 12;
      return [cl(b), cl(b), cl(b)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 1.8), mpr: 2, rough: 0.95 };
  },
  // clay roof tiles ("Frankfurter Pfanne"), tinted by the material (2 m a tile: 6 rows x 6 tiles)
  roofTiles() {
    const S = 512;
    const rows = 6, cols = 6, rh = S / rows, cw = S / cols;
    const n = fbm(S, 16, 3, 61), r = rng(62);
    const tone = new Float32Array(rows * cols).map(() => 0.85 + r() * 0.3);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    paint(c, (x, y, i) => {
      const row = Math.floor(y / rh), fy = (y % rh) / rh;
      const off = (row % 2) * cw * 0.5;
      const col = Math.floor(((x + off) % S) / cw), fx = (((x + off) % S) % cw) / cw;
      const wave = 0.5 + 0.5 * Math.cos(fx * Math.PI * 2); // two rolls per tile
      const lap = fy > 0.88 ? 0.45 : 0.75 + 0.25 * fy;
      H[i] = wave * 0.6 + fy * 0.4;
      const b = (0.62 + 0.38 * wave) * lap * tone[row * cols + col] * (0.9 + n[i] * 0.2);
      return [cl(230 * b), cl(225 * b), cl(220 * b)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 3.5), mpr: 2, rough: 0.85 };
  },
  // light metal wall cassettes (the industrial buildings; 3 m a tile, 4 panels)
  panels() {
    const S = 512;
    const n = fbm(S, 16, 2, 71);
    const H = new Float32Array(S * S);
    const c = makeCanvas(S);
    const ph = S / 4;
    paint(c, (x, y, i) => {
      const f = (y % ph) / ph, seam = f < 0.02 || f > 0.98 ? 0.55 : 1;
      const vs = x % (S / 2) < 2 ? 0.7 : 1;
      H[i] = seam * vs;
      const b = (206 + (n[i] - 0.5) * 18 - f * 10) * seam * vs;
      return [cl(b), cl(b + 2), cl(b + 4)];
    });
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 2), mpr: 3, rough: 0.55, metal: 0.35 };
  },
  // a background facade: plaster with one window a storey (3 m wide, 3 m storey; the window 0.9..2.2 m up)
  facade() {
    const S = 512;
    const c = makeCanvas(S);
    const n = fbm(S, 64, 2, 81);
    const ctx = paint(c, (x, y, i) => {
      const b = 222 + (n[i] - 0.5) * 24;
      return [cl(b), cl(b), cl(b - 4)];
    });
    const px = S / 3; // px per m
    // (v runs up: canvas y = S - height)
    const wx = 0.9 * px, ww = 1.2 * px, y0 = S - 2.2 * px, wh = 1.3 * px;
    ctx.fillStyle = '#e9e7e2';
    ctx.fillRect(wx - 6, y0 - 22, ww + 12, wh + 30); // frame + shutter box
    ctx.fillStyle = '#6d6f72';
    ctx.fillRect(wx, y0 - 18, ww, 14); // roller shutter box
    const g = ctx.createLinearGradient(0, y0, 0, y0 + wh);
    g.addColorStop(0, '#2c3a44');
    g.addColorStop(1, '#10161b');
    ctx.fillStyle = g;
    ctx.fillRect(wx + 5, y0, ww - 10, wh - 4);
    ctx.fillStyle = '#e4e2dd';
    ctx.fillRect(wx + ww / 2 - 3, y0, 6, wh - 4); // mullion
    ctx.fillStyle = '#b8b4ac';
    ctx.fillRect(wx - 10, y0 + wh - 2, ww + 20, 8); // sill
    const H = new Float32Array(S * S);
    const d = ctx.getImageData(0, 0, S, S).data;
    for (let i = 0; i < S * S; i++) H[i] = d[i * 4] / 255;
    return { map: canvasTex(c), normalMap: normalTex(H, S, S, 1.2), mpr: 3, rough: 0.9, windows: true };
  },
  // a corn plant (alpha card, 1 x 2.6 m): stalk, long drooping dry leaves, a cob
  corn() {
    const W = 256, Hh = 640;
    const c = makeCanvas(W, Hh);
    const ctx = c.getContext('2d');
    const r = rng(91);
    // late September: dried out, pale gold to tan, a little green left low on the stalk
    const ink = (a, low = false) => (low && r() < 0.35 ? `rgba(${110 + r() * 40},${125 + r() * 30},${60 + r() * 20},${a})` : `rgba(${188 + r() * 40},${160 + r() * 32},${108 + r() * 30},${a})`);
    ctx.lineCap = 'round';
    ctx.strokeStyle = ink(1);
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(W / 2, Hh);
    ctx.quadraticCurveTo(W / 2 + 6, Hh * 0.5, W / 2 - 4, 30);
    ctx.stroke();
    for (let k = 0; k < 11; k++) {
      const y = Hh * (0.92 - k * 0.075);
      const side = k % 2 ? 1 : -1;
      const len = (0.5 + r() * 0.45) * W * 0.55;
      ctx.fillStyle = ink(0.95, k < 3);
      ctx.beginPath();
      ctx.moveTo(W / 2, y);
      const tx = W / 2 + side * len, ty = y + 20 + r() * 90;
      ctx.quadraticCurveTo(W / 2 + side * len * 0.6, y - 40 - r() * 30, tx, ty);
      ctx.quadraticCurveTo(W / 2 + side * len * 0.5, y - 20, W / 2, y + 10);
      ctx.fill();
    }
    // the cob in its husk and the tassel
    ctx.fillStyle = 'rgba(200,170,105,1)';
    ctx.beginPath();
    ctx.ellipse(W / 2 + 12, Hh * 0.55, 10, 34, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,160,100,0.9)';
    ctx.lineWidth = 2;
    for (let k = 0; k < 7; k++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 - 4, 34);
      ctx.lineTo(W / 2 - 4 + (r() - 0.5) * 50, 4 + r() * 20);
      ctx.stroke();
    }
    return { map: canvasTex(c, { repeat: false }), mpr: 1, alpha: true };
  },
  // a spray of lime-tree leaves (alpha card)
  leaves() {
    const S = 512;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = rng(101);
    for (let k = 0; k < 150; k++) {
      const a = r() * Math.PI * 2, rad = Math.sqrt(r()) * S * 0.42;
      const x = S / 2 + Math.cos(a) * rad, y = S / 2 + Math.sin(a) * rad;
      const s = 16 + r() * 16;
      const yel = r() < 0.2;
      const g = 0.7 + r() * 0.4;
      ctx.fillStyle = yel ? `rgb(${170 * g},${160 * g},${60 * g})` : `rgb(${70 * g},${105 * g},${40 * g})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI * 2);
      ctx.beginPath(); // a heart-ish lime leaf
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.9, -s * 0.9, s * 0.8, s * 0.4, 0, s);
      ctx.bezierCurveTo(-s * 0.8, s * 0.4, -s * 0.9, -s * 0.9, 0, -s);
      ctx.fill();
      ctx.restore();
    }
    return { map: canvasTex(c, { repeat: false }), mpr: 1, alpha: true };
  },
  // cherry laurel: big glossy dark leaves (the hedges along the fence)
  laurel() {
    const S = 256;
    const c = makeCanvas(S);
    const ctx = c.getContext('2d');
    const r = rng(111);
    ctx.fillStyle = 'rgb(22,38,20)';
    ctx.fillRect(0, 0, S, S);
    for (let k = 0; k < 170; k++) {
      const x = r() * S, y = r() * S, s = 12 + r() * 12, g = 0.6 + r() * 0.6;
      ctx.fillStyle = `rgb(${38 * g},${72 * g},${30 * g})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r() * Math.PI * 2);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.42, s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(200,230,190,${0.08 + r() * 0.1})`; // the gloss
      ctx.beginPath();
      ctx.ellipse(-s * 0.1, -s * 0.2, s * 0.12, s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    return { map: canvasTex(c), mpr: 1.2 };
  },
  // the double-rod mesh fence with woven privacy strips (a 2.5 x 1.6 m panel: strips teal and anthracite)
  fence() {
    const W = 512, Hh = 328;
    const c = makeCanvas(W, Hh);
    const ctx = c.getContext('2d');
    const strip = Hh / 8.2; // 8 strips a panel
    for (let k = 0; k < 8; k++) {
      const y = Hh - (k + 1) * strip;
      ctx.fillStyle = k % 3 === 1 ? '#3d4144' : '#2f6d6a';
      ctx.fillRect(0, y + 3, W, strip - 6);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      for (let x = 0; x < W; x += 20) ctx.fillRect(x, y + 3, 10, strip - 6); // the weave
    }
    ctx.fillStyle = '#26292c';
    for (let x = 2; x < W; x += 10.24) ctx.fillRect(x, 0, 2.2, Hh); // vertical wires (5 cm)
    for (let k = 0; k <= 8; k++) ctx.fillRect(0, Hh - k * strip - 3, W, 4); // double horizontal wires
    return { map: canvasTex(c), mpr: 2.5, alpha: true };
  },
};

/** the texture set `name` (made on first use) */
export function awTex(name) {
  let t = TEX.get(name);
  if (!t) {
    t = GEN[name]();
    TEX.set(name, t);
  }
  return t;
}

/**
 * Register the map's materials with materials.js (names 'aw…'): call once before building. Colours are the
 * site's: cream plaster of 13a, the white render of 13, 13c's white siding, the fire station's white walls and
 * brown tiles, the red fascias.
 */
export function registerAppenweierMaterials() {
  const std = (name, set, o = {}) => {
    const t = set ? awTex(set) : null;
    const m = new THREE.MeshStandardMaterial({
      color: o.color ?? 0xffffff,
      map: t?.map ?? null,
      normalMap: t?.normalMap ?? null,
      roughness: o.rough ?? t?.rough ?? 0.9,
      metalness: o.metal ?? t?.metal ?? 0,
      alphaTest: t?.alpha || o.alphaTest ? o.alphaTest ?? 0.45 : 0,
      side: o.side ?? THREE.FrontSide,
      transparent: !!o.transparent,
      opacity: o.opacity ?? 1,
      emissive: o.emissive ?? 0x000000,
      emissiveIntensity: o.emissiveIntensity ?? 1,
    });
    if (t?.normalMap) m.normalScale = new THREE.Vector2(o.normal ?? 1, o.normal ?? 1);
    m.userData.metersPerRepeat = o.mpr ?? t?.mpr ?? 1;
    return registerMaterial(name, m);
  };
  std('awAsphalt', 'asphalt');
  std('awAsphaltLight', 'asphalt', { color: 0xb8b8b4 }); // footways
  std('awRedLane', 'asphalt', { color: 0xd46b58 }); // the cycle lanes
  std('awGrass', 'grass');
  std('awPavers', 'pavers');
  std('awSiding', 'siding', { color: 0xf4f6f8 });
  std('awPlasterCream', 'plaster', { color: 0xf3e3b3 }); // 13a
  std('awPlasterWhite', 'plaster', { color: 0xf1efe8 }); // 13, the fire station
  std('awPlasterWarm', 'plaster', { color: 0xeadfcd });
  std('awPlasterGrey', 'plaster', { color: 0xc9c8c3 });
  std('awRoofRed', 'roofTiles', { color: 0xb25a3c });
  std('awRoofBrown', 'roofTiles', { color: 0x7a4632 }); // the fire station
  std('awRoofDark', 'roofTiles', { color: 0x4a4644 }); // 13
  std('awRoofMetal', 'panels', { color: 0x8d9296, rough: 0.5, metal: 0.5 });
  std('awRoofFlat', 'asphalt', { color: 0x9a9894 }); // bitumen / gravel roofs
  std('awPanels', 'panels');
  std('awPanelsGrey', 'panels', { color: 0xa9adb0 });
  std('awFacade', 'facade');
  std('awFacadeWarm', 'facade', { color: 0xf0e6d2 });
  std('awCorn', 'corn', { side: THREE.DoubleSide, alphaTest: 0.5 });
  std('awLeaves', 'leaves', { side: THREE.DoubleSide, alphaTest: 0.5, rough: 0.85 });
  std('awLaurel', 'laurel', { rough: 0.55 });
  std('awFence', 'fence', { side: THREE.DoubleSide, alphaTest: 0.35, rough: 0.6 });
  std('awFascia', null, { color: 0x9b2c22, rough: 0.6 }); // the red fascias of 13a and the garage
  std('awPaint', null, { color: 0xf2f2ee, rough: 0.7 }); // road markings, trims
  std('awGlass', null, { color: 0x1c2730, rough: 0.12, metal: 0.4 });
  std('awGlassLit', null, { color: 0x3a3226, rough: 0.2, emissive: 0xffc27a, emissiveIntensity: 0.9 });
  std('awShutter', 'panels', { color: 0xc8c6c0, rough: 0.6, mpr: 0.6 });
  std('awFrame', null, { color: 0xf4f4f1, rough: 0.5 });
  std('awRedDoor', 'panels', { color: 0xb3261e, rough: 0.45, metal: 0.3, mpr: 0.9 }); // the fire station's doors
  std('awSteel', null, { color: 0x6f7478, rough: 0.45, metal: 0.8 });
  std('awGalv', null, { color: 0xb9bec2, rough: 0.35, metal: 0.9 }); // gutters, poles
  std('awAnthracite', null, { color: 0x2e3134, rough: 0.5, metal: 0.4 });
  std('awConcrete', null, { color: 0x9a978f, rough: 0.95 });
  return getMaterial('awAsphalt');
}

/** a sign / lettering texture: lines of text on a colour (canvas), w x h px */
export function signTexture(lines, { w = 512, h = 128, bg = '#ffffff', fg = '#111111', font = 'bold 72px Arial', align = 'center', border = null, pad = 0 } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(4, h * 0.05);
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
  }
  ctx.fillStyle = fg;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const list = Array.isArray(lines) ? lines : [lines];
  list.forEach((l, i) => {
    const t = typeof l === 'string' ? { text: l } : l;
    ctx.font = t.font ?? font;
    ctx.fillStyle = t.color ?? fg;
    const x = align === 'center' ? w / 2 : align === 'left' ? pad : w - pad;
    ctx.fillText(t.text, x, t.y ?? ((i + 0.5) / list.length) * h);
  });
  return canvasTex(c, { repeat: false });
}
