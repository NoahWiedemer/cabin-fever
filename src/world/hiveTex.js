// The Hive's surfaces: procedurally painted albedo / normal / roughness maps for the walls, floors and ceilings of each
// kind of room, the decal atlas (blood, grime, paper, glass …), the label atlas (text signs made on demand) and the
// baked-light material that lets a normal map shade the baked light (cavity shading: grout, mortar and grain read as relief
// even though the light itself is per vertex).
import * as THREE from 'three';
import { canvas, mulberry } from './lab.js';

const TAU = Math.PI * 2;

// ---------------------------------------------------------------- the baked-light material
const bakeShader = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBake;')
    .replace(
      '#include <emissivemap_fragment>',
      // the baked light is per vertex: a bump-mapped normal that leans away from the surface's own gets less of it
      '#include <emissivemap_fragment>\nfloat cav = clamp(dot(normal, nonPerturbedNormal), 0.0, 1.0);\ntotalEmissiveRadiance += diffuseColor.rgb * vBake * (0.35 + 0.65 * cav * cav);'
    );
};
/** MeshStandardMaterial that adds the baked light (vertex attribute `bake`) as emission; normal maps shade it */
export function hiveMat(params, cast = false) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = bakeShader;
  m.customProgramCacheKey = () => 'hiveBake';
  m.userData.bake = true;
  m.userData.cast = cast;
  return m;
}

// ---------------------------------------------------------------- noise and painting helpers
/** tileable value noise 0..1 (w x h), `cells` lattice cells across, `oct` octaves */
function field(w, h, cells, rnd, oct = 4, persist = 0.5) {
  const out = new Float32Array(w * h);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const cx = Math.max(1, Math.round(cells * 2 ** o)), cy = cx;
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * cy, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * cx, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = lat[(y0 % cy) * cx + (x0 % cx)], b = lat[(y0 % cy) * cx + ((x0 + 1) % cx)];
        const c = lat[((y0 + 1) % cy) * cx + (x0 % cx)], d = lat[((y0 + 1) % cy) * cx + ((x0 + 1) % cx)];
        out[y * w + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    tot += amp;
    amp *= persist;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hex = (s) => {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** a canvas from a per-pixel function (x, y) → [r, g, b, a?] 0..255 */
function pixels(w, h, fn) {
  return canvas(w, h, (g) => {
    const im = g.createImageData(w, h);
    const d = im.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = fn(x, y), i = (y * w + x) * 4;
        d[i] = p[0];
        d[i + 1] = p[1];
        d[i + 2] = p[2];
        d[i + 3] = p[3] ?? 255;
      }
    }
    g.putImageData(im, 0, 0);
  });
}
/** a height canvas (R channel) → a tangent-space normal map canvas (wraps: the textures tile) */
function toNormal(hc, strength = 2) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  return pixels(w, h, (x, y) => {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}
const grey = (c) => canvas(c.width, c.height, (g) => g.drawImage(c, 0, 0));
function tex(c, { srgb = false, rep = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (rep) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** draw `n` soft grime blobs / streaks over the canvas (multiply-ish dark), used to break up every surface */
function grimeOver(g, w, h, rnd, { n = 18, vertical = 0.7, alpha = 0.06, tint = '20,22,20' } = {}) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, y = rnd() * h;
    const rw = 6 + rnd() * 40, rh = rnd() < vertical ? 60 + rnd() * h * 0.5 : 10 + rnd() * 50;
    for (const dx of [-w, 0, w]) {
      const grd = g.createLinearGradient(0, y, 0, y + rh);
      grd.addColorStop(0, `rgba(${tint},0)`);
      grd.addColorStop(0.3, `rgba(${tint},${alpha * (0.5 + rnd())})`);
      grd.addColorStop(1, `rgba(${tint},0)`);
      g.fillStyle = grd;
      g.fillRect(x + dx - rw / 2, y, rw, rh);
    }
  }
}
function hairCracks(g, w, h, rnd, n, alpha = 0.35, len = 90) {
  g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = rnd() * w, y = rnd() * h, a = rnd() * TAU;
    g.strokeStyle = `rgba(20,20,20,${alpha * (0.4 + rnd() * 0.6)})`;
    g.beginPath();
    g.moveTo(x, y);
    for (let s = 0; s < len / 6; s++) {
      a += (rnd() - 0.5) * 0.9;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

// ---------------------------------------------------------------- walls
/** painted cinder block, 40 x 20 cm courses, running bond (2.4 m per repeat); `paint` the wall colour */
function blockWall(seed, paint = '#c9ccc9') {
  const rnd = mulberry(seed);
  const S = 1024, BW = S / 6, BH = S / 12; // 0.4 x 0.2 m
  const n1 = field(S, S, 6, rnd, 5), n2 = field(S, S, 24, rnd, 3, 0.55);
  const base = hex(paint);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const row = Math.floor(y / BH), off = row % 2 ? BW / 2 : 0;
    const bx = (x + off) % BW, by = y % BH;
    const joint = Math.min(bx, BW - bx, by, BH - by);
    const j = joint < 4 ? 1 - joint / 4 : 0; // 0 block face .. 1 in the joint
    const rough = n2[y * S + x];
    const dirt = n1[y * S + x];
    // paint over block: an orange-peel texture, joints darker, a slow tone mottle
    const bt = 0.955 + (((row * 7 + Math.floor((x + off) / BW) * 13) % 11) / 11) * 0.09; // each block a touch different
    const v = bt * (0.94 + (dirt - 0.5) * 0.16 + (rough - 0.5) * 0.06) - j * 0.2;
    hgt[y * S + x] = clamp01(0.62 + (rough - 0.5) * 0.3 - j * 0.55);
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 26, alpha: 0.05 });
  hairCracks(g, S, S, rnd, 5, 0.18, 120);
  const hc = pixels(S, S, (x, y) => {
    const v = hgt[y * S + x] * 255;
    return [v, v, v];
  });
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 3.2)) };
}
/** glazed wall tiles (1.2 m per repeat): kind 'white' 15 x 15 cm, 'subway' 10 x 20; returns the maps + a roughness map */
function tileWall(seed, { paint = '#e6eae8', kind = 'white', grout = '#8d9290', chip = 0.03 } = {}) {
  const rnd = mulberry(seed);
  const S = 512;
  const tw = kind === 'subway' ? S / 12 : S / 8, th = kind === 'subway' ? S / 6 : S / 8;
  const base = hex(paint), gr = hex(grout);
  const n1 = field(S, S, 4, rnd, 4);
  const hgt = new Float32Array(S * S), rgh = new Float32Array(S * S);
  const tint = {};
  const map = pixels(S, S, (x, y) => {
    const row = Math.floor(y / th);
    const off = kind === 'subway' && row % 2 ? tw / 2 : 0;
    const col = Math.floor((x + off) / tw);
    const bx = (x + off) % tw, by = y % th;
    const e = Math.min(bx, tw - bx, by, th - by);
    const key = row * 31 + (col % (S / tw + 1));
    const t = (tint[key] ??= (rnd() - 0.5) * 0.06);
    let v = 1 + t + (n1[y * S + x] - 0.5) * 0.06;
    let c;
    if (e < 1.6) {
      c = mix(gr, base, 0.15);
      hgt[y * S + x] = 0;
      rgh[y * S + x] = 0.9;
    } else {
      // bevelled edge: lighter top-left, darker bottom-right, then a soft gloss falloff
      const bev = e < 4 ? (e - 1.6) / 2.4 : 1;
      const dir = bx < 4 || by < 4 ? 1.06 : bx > tw - 4 || by > th - 4 ? 0.9 : 1;
      c = [base[0] * v * dir, base[1] * v * dir, base[2] * v * dir];
      hgt[y * S + x] = 0.55 + 0.4 * bev;
      rgh[y * S + x] = 0.2 + n1[y * S + x] * 0.18;
    }
    return c;
  });
  const g = map.getContext('2d');
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(30,34,32,${0.25 + rnd() * 0.3})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2); // chips
  }
  grimeOver(g, S, S, rnd, { n: 12, alpha: 0.07, tint: '40,38,30' });
  void chip;
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, (x, y) => [0, rgh[y * S + x] * 255, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 3)), roughnessMap: tex(rc) };
}
/** vertical wood panelling, 30 cm boards with V-grooves (1.2 m per repeat) */
function woodWall(seed, tone = '#6a5038') {
  const rnd = mulberry(seed);
  const S = 512, BW = S / 4;
  const base = hex(tone);
  const grain = field(S, S, 3, rnd, 3);
  const stretch = (x, y) => grain[((y * 0.08) | 0) * S + x] ?? 0.5;
  const hgt = new Float32Array(S * S);
  const bt = [0, 1, 2, 3, 4].map(() => 0.88 + rnd() * 0.24);
  const map = pixels(S, S, (x, y) => {
    const b = Math.floor(x / BW), bx = x % BW;
    const line = 0.5 + 0.5 * Math.sin((bx * 0.9 + Math.sin(y * 0.01 + b * 2) * 1.4 + stretch(x, y) * 9) * 2);
    const groove = Math.min(bx, BW - bx);
    const gd = groove < 4 ? 1 - groove / 4 : 0;
    const v = bt[b] * (0.9 + line * 0.1 + (grain[y * S + x] - 0.5) * 0.12) * (1 - gd * 0.55);
    hgt[y * S + x] = clamp01(0.7 - gd * 0.7 + line * 0.03);
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, () => [0, 150, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 2.4)), roughnessMap: tex(rc) };
}
/** riveted steel wall panels, 60 cm (a plant / atrium base), brushed */
function steelWall(seed, paint = '#6f7a82') {
  const rnd = mulberry(seed);
  const S = 512, P = S / 2;
  const base = hex(paint);
  const n1 = field(S, S, 16, rnd, 3, 0.6);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const px = x % P, py = y % P;
    const e = Math.min(px, P - px, py, P - py);
    const seam = e < 3 ? 1 - e / 3 : 0;
    const brush = 0.5 + ((rnd() - 0.5) * 0.05 + (n1[(y * S + ((x * 0.05) | 0)) % (S * S)] - 0.5) * 0.14);
    let v = 0.86 + brush * 0.22 - seam * 0.42;
    // rivets on a 6 cm grid near the seam
    const rx = ((px + P / 20) % (P / 5)) - P / 10, ry = e > 9 && e < 15 ? 0 : 99;
    const dr = Math.hypot(rx, ry);
    if (dr < 3.2) v += 0.12 - dr * 0.03;
    hgt[y * S + x] = clamp01(0.7 - seam * 0.6 + (dr < 3.2 ? 0.25 : 0));
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 14, alpha: 0.08 });
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, (x, y) => [0, 110 + n1[y * S + x] * 80, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 2.6)), roughnessMap: tex(rc) };
}
/** poured concrete with formwork joints and tie holes (2.4 m per repeat) */
function concreteWall(seed, tone = '#8f918f') {
  const rnd = mulberry(seed);
  const S = 1024;
  const base = hex(tone);
  const n1 = field(S, S, 3, rnd, 6, 0.55), n2 = field(S, S, 40, rnd, 2);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const pj = Math.min(x % (S / 2), (S / 2) - (x % (S / 2)), y % (S / 2), (S / 2) - (y % (S / 2)));
    const seam = pj < 3 ? 1 - pj / 3 : 0;
    // tie holes on a 0.6 m grid
    const tx = ((x + S / 8) % (S / 4)) - S / 8, ty = ((y + S / 8) % (S / 4)) - S / 8;
    const th = Math.hypot(tx, ty) < 6 ? 1 : 0;
    const bug = n2[y * S + x] > 0.86 ? 0.55 : 1; // bug holes
    const v = (0.78 + n1[y * S + x] * 0.42) * (1 - seam * 0.3) * (1 - th * 0.55) * (bug < 1 ? 0.75 : 1);
    hgt[y * S + x] = clamp01(0.6 + (n2[y * S + x] - 0.5) * 0.25 - seam * 0.5 - th * 0.5 - (bug < 1 ? 0.3 : 0));
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 30, alpha: 0.07 });
  hairCracks(g, S, S, rnd, 8, 0.28, 140);
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 3)) };
}

// ---------------------------------------------------------------- floors
/** speckled grey-blue epoxy screed with expansion joints every 1.5 m (3 m per repeat), wear paths and scuffs */
function epoxyFloor(seed, tone = '#7d868b') {
  const rnd = mulberry(seed);
  const S = 1024;
  const base = hex(tone);
  const n1 = field(S, S, 5, rnd, 5), n2 = field(S, S, 60, rnd, 2);
  const map = pixels(S, S, (x, y) => {
    const j = Math.min(x % (S / 2), (S / 2) - (x % (S / 2)), y % (S / 2), (S / 2) - (y % (S / 2)));
    const seam = j < 2.5 ? 1 - j / 2.5 : 0;
    const chip = n2[y * S + x];
    const v = 0.86 + n1[y * S + x] * 0.24 + (chip > 0.84 ? 0.14 : chip < 0.12 ? -0.1 : 0) - seam * 0.45;
    return [base[0] * v, base[1] * v, base[2] * v * 1.02];
  });
  const g = map.getContext('2d');
  // wear: long faint scuff paths, tyre tracks, a few stains
  for (let i = 0; i < 90; i++) {
    g.strokeStyle = `rgba(20,24,26,${0.03 + rnd() * 0.06})`;
    g.lineWidth = 1 + rnd() * 5;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 200, x + (rnd() - 0.5) * 320, y + (rnd() - 0.5) * 320);
    g.stroke();
  }
  for (let i = 0; i < 6; i++) {
    const x = rnd() * S, y = rnd() * S, r = 20 + rnd() * 50;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(40,36,28,0.22)');
    grd.addColorStop(1, 'rgba(40,36,28,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const rc = pixels(S, S, (x, y) => [0, (0.3 + n1[y * S + x] * 0.35) * 255, 0]);
  const hc = pixels(S, S, (x, y) => [(0.5 + (n2[y * S + x] - 0.5) * 0.3) * 255, 0, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 1.4)), roughnessMap: tex(rc) };
}
/** vinyl floor tiles 30 cm in two greys, speckled (1.2 m per repeat) */
function vinylFloor(seed, a = '#a4a9a8', b = '#959b9a', line = '#585d5d') {
  const rnd = mulberry(seed);
  const S = 512, T = S / 4;
  const ca = hex(a), cb = hex(b), cl = hex(line);
  const n1 = field(S, S, 8, rnd, 3);
  const tone = [];
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const tx = Math.floor(x / T), ty = Math.floor(y / T);
    const e = Math.min(x % T, T - (x % T), y % T, T - (y % T));
    const k = ty * 4 + tx;
    const t = (tone[k] ??= 0.94 + rnd() * 0.12);
    const flake = rnd() < 0.05 ? 0.14 : 0;
    const c = (tx + ty) % 2 ? ca : cb;
    hgt[y * S + x] = e < 2 ? 0.1 : 0.7;
    if (e < 2) return cl;
    const v = t * (0.94 + n1[y * S + x] * 0.12 + flake);
    return [c[0] * v, c[1] * v, c[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 10, alpha: 0.06, vertical: 0.2 });
  for (let i = 0; i < 20; i++) {
    g.strokeStyle = 'rgba(15,15,15,0.12)';
    g.lineWidth = 1.5;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 30, y + (rnd() - 0.5) * 30);
    g.stroke();
  }
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, (x, y) => [0, (0.32 + n1[y * S + x] * 0.25) * 255, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 2)), roughnessMap: tex(rc) };
}
/** cream / brown checker vinyl, 45 cm (1.8 m per repeat), scuffed and dirty in the seams */
function checkerFloor(seed) {
  const rnd = mulberry(seed);
  const S = 512, T = S / 4;
  const n1 = field(S, S, 6, rnd, 4);
  const cA = hex('#d9cdb0'), cB = hex('#6d4f3a');
  const map = pixels(S, S, (x, y) => {
    const dark = (Math.floor(x / T) + Math.floor(y / T)) % 2;
    const e = Math.min(x % T, T - (x % T), y % T, T - (y % T));
    const c = dark ? cB : cA;
    const v = 0.9 + n1[y * S + x] * 0.2 - (e < 3 ? 0.18 : 0);
    return [c[0] * v, c[1] * v, c[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 16, alpha: 0.08, vertical: 0.3, tint: '40,30,20' });
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = 'rgba(25,20,15,0.14)';
    g.lineWidth = 1 + rnd() * 2;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + rnd() * 40 - 20, y + rnd() * 30 - 15, x + rnd() * 60 - 30, y + rnd() * 60 - 30);
    g.stroke();
  }
  const rc = pixels(S, S, (x, y) => [0, (0.25 + n1[y * S + x] * 0.3) * 255, 0]);
  return { map: tex(map, { srgb: true }), roughnessMap: tex(rc) };
}
/** carpet tiles 50 cm (1 m per repeat), a neutral grey to be tinted; per-pixel fibre noise */
function carpetFloor(seed) {
  const rnd = mulberry(seed);
  const S = 512, T = S / 2;
  const n1 = field(S, S, 8, rnd, 4);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const e = Math.min(x % T, T - (x % T), y % T, T - (y % T));
    const fibre = rnd();
    const tile = ((Math.floor(x / T) * 3 + Math.floor(y / T) * 5) % 4) * 0.012;
    const v = 0.62 + n1[y * S + x] * 0.14 + (fibre - 0.5) * 0.2 + tile - (e < 2 ? 0.14 : 0);
    hgt[y * S + x] = clamp01(0.5 + (fibre - 0.5) * 0.7 - (e < 2 ? 0.3 : 0));
    return [v * 255, v * 255, v * 255];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 10, alpha: 0.1, vertical: 0.1, tint: '30,25,20' });
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, () => [0, 235, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 1.6)), roughnessMap: tex(rc) };
}
/** sealed concrete slab with saw cuts (3 m per repeat), aggregate, oil stains and hairline cracks */
function concreteFloor(seed, tone = '#6d706e') {
  const rnd = mulberry(seed);
  const S = 1024;
  const base = hex(tone);
  const n1 = field(S, S, 4, rnd, 6, 0.55), n2 = field(S, S, 90, rnd, 2);
  const map = pixels(S, S, (x, y) => {
    const j = Math.min(x % (S / 1), S - (x % S), y % S, S - (y % S));
    const seam = j < 2.5 ? 1 - j / 2.5 : 0;
    const v = 0.72 + n1[y * S + x] * 0.5 + (n2[y * S + x] > 0.88 ? 0.1 : 0) - seam * 0.5;
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const g = map.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const x = rnd() * S, y = rnd() * S, r = 25 + rnd() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(18,16,12,${0.25 + rnd() * 0.25})`);
    grd.addColorStop(0.7, 'rgba(18,16,12,0.08)');
    grd.addColorStop(1, 'rgba(18,16,12,0)');
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 14; i++) {
    g.strokeStyle = `rgba(20,20,20,${0.04 + rnd() * 0.05})`;
    g.lineWidth = 2 + rnd() * 7;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + (rnd() - 0.5) * 300, y + (rnd() - 0.5) * 300, x + (rnd() - 0.5) * 400, y + (rnd() - 0.5) * 400);
    g.stroke();
  }
  hairCracks(g, S, S, rnd, 10, 0.4, 260);
  const rc = pixels(S, S, (x, y) => [0, (0.4 + n1[y * S + x] * 0.4) * 255, 0]);
  const hc = pixels(S, S, (x, y) => [(0.5 + (n2[y * S + x] - 0.5) * 0.4 + (n1[y * S + x] - 0.5) * 0.3) * 255, 0, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 1.8)), roughnessMap: tex(rc) };
}
/** dark polished terrazzo with pale chips and brass divider strips every 1.5 m (3 m per repeat) */
function terrazzoFloor(seed) {
  const rnd = mulberry(seed);
  const S = 1024;
  const n1 = field(S, S, 6, rnd, 4);
  const chips = [];
  for (let i = 0; i < 2600; i++) chips.push([rnd() * S, rnd() * S, 1.5 + rnd() * 4.5, rnd()]);
  const map = pixels(S, S, (x, y) => {
    const v = 0.85 + n1[y * S + x] * 0.3;
    return [46 * v, 50 * v, 52 * v];
  });
  const g = map.getContext('2d');
  for (const [x, y, r, k] of chips) {
    g.fillStyle = k < 0.5 ? 'rgba(150,158,160,0.55)' : k < 0.8 ? 'rgba(210,214,212,0.5)' : 'rgba(96,110,120,0.55)';
    g.beginPath();
    g.ellipse(x, y, r, r * (0.6 + rnd() * 0.4), rnd() * TAU, 0, TAU);
    g.fill();
  }
  // brass strips
  for (const p of [0, S / 2]) {
    for (const [x, y, w, h] of [[p - 2, 0, 4, S], [0, p - 2, S, 4]]) {
      const grd = g.createLinearGradient(x, y, x + (w > h ? 0 : w), y + (h > w ? 0 : h));
      grd.addColorStop(0, '#5c4a22');
      grd.addColorStop(0.5, '#c7a552');
      grd.addColorStop(1, '#5c4a22');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
    }
  }
  grimeOver(g, S, S, rnd, { n: 16, alpha: 0.08, vertical: 0.2 });
  for (let i = 0; i < 60; i++) {
    g.strokeStyle = 'rgba(200,205,205,0.05)';
    g.lineWidth = 1;
    const x = rnd() * S, y = rnd() * S;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rnd() - 0.5) * 70, y + (rnd() - 0.5) * 30);
    g.stroke();
  }
  const rc = pixels(S, S, (x, y) => [0, (0.16 + n1[y * S + x] * 0.22) * 255, 0]);
  return { map: tex(map, { srgb: true }), roughnessMap: tex(rc) };
}
/** raised access floor, 60 cm panels with a steel edge; every 3rd panel perforated (1.2 m per repeat) */
function raisedFloor(seed) {
  const rnd = mulberry(seed);
  const S = 512, P = S / 2;
  const n1 = field(S, S, 6, rnd, 3);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const px = x % P, py = y % P;
    const e = Math.min(px, P - px, py, P - py);
    const perf = (Math.floor(x / P) + Math.floor(y / P) * 2) % 3 === 0;
    let v = 0.8 + n1[y * S + x] * 0.16;
    let h = 0.7;
    if (e < 4) {
      v = e < 1.6 ? 0.36 : 0.98;
      h = e < 1.6 ? 0.05 : 0.8;
    } else if (perf) {
      const hx = ((px % 12) - 6), hy = ((py % 12) - 6);
      if (Math.hypot(hx, hy) < 3.1) {
        v *= 0.32;
        h = 0.05;
      }
    }
    hgt[y * S + x] = h;
    return [92 * v, 100 * v, 106 * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 8, alpha: 0.07, vertical: 0.3 });
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, (x, y) => [0, (0.3 + n1[y * S + x] * 0.3) * 255, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 3)), roughnessMap: tex(rc) };
}
/** diamond plate (60 cm per repeat) */
function diamondPlate(seed, tone = '#7b8288') {
  const rnd = mulberry(seed);
  const S = 512;
  const base = hex(tone);
  const n1 = field(S, S, 8, rnd, 3);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    // lozenges 24 px, alternating orientation
    const cx = Math.floor(x / 32), cy = Math.floor(y / 32);
    const lx = (x % 32) - 16, ly = (y % 32) - 16;
    const [u, v2] = (cx + cy) % 2 ? [lx, ly] : [ly, -lx];
    const d = Math.hypot(u / 11, v2 / 3.6);
    const on = d < 1 ? 1 - d : 0;
    hgt[y * S + x] = 0.3 + on * 0.7;
    const v = 0.72 + n1[y * S + x] * 0.25 + on * 0.24;
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 14, alpha: 0.12, vertical: 0.2, tint: '30,24,16' });
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, (x, y) => [0, (0.35 + n1[y * S + x] * 0.3) * 255, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 4)), roughnessMap: tex(rc) };
}
/** parquet: 6 cm x 30 cm boards in a herringbone-ish bond, a dark stain (1.2 m per repeat) */
function parquetFloor(seed) {
  const rnd = mulberry(seed);
  const S = 512, BW = S / 20, BL = BW * 5;
  const n1 = field(S, S, 6, rnd, 3);
  const tones = [];
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const row = Math.floor(y / BL);
    const flip = row % 2;
    const [u, v] = flip ? [x, y] : [y, x];
    const bx = Math.floor(v / BW), by = Math.floor(u / BL);
    const e = Math.min(v % BW, BW - (v % BW));
    const k = (bx * 7 + by * 13 + row * 5) % 40;
    const t = (tones[k] ??= 0.82 + rnd() * 0.36);
    const grain = 0.5 + 0.5 * Math.sin(u * 0.4 + Math.sin(v * 0.2 + k) * 3);
    hgt[y * S + x] = e < 1.5 ? 0.1 : 0.7;
    if (e < 1.5) return [30, 20, 12];
    const w = t * (0.85 + grain * 0.12 + (n1[y * S + x] - 0.5) * 0.12);
    return [126 * w, 84 * w, 50 * w];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 8, alpha: 0.08, vertical: 0.2 });
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  const rc = pixels(S, S, (x, y) => [0, (0.22 + n1[y * S + x] * 0.2) * 255, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 2)), roughnessMap: tex(rc) };
}

// ---------------------------------------------------------------- ceilings
/** 60 cm fissured mineral-fibre tiles in a T-bar grid (2.4 m per repeat); stains, sagging edges */
function ceilingTile(seed) {
  const rnd = mulberry(seed);
  const S = 1024, T = S / 4;
  const n1 = field(S, S, 6, rnd, 4), n2 = field(S, S, 90, rnd, 2, 0.6);
  const hgt = new Float32Array(S * S);
  const map = pixels(S, S, (x, y) => {
    const e = Math.min(x % T, T - (x % T), y % T, T - (y % T));
    if (e < 5) {
      hgt[y * S + x] = 0.95;
      return [e < 1.8 ? 120 : 196, e < 1.8 ? 124 : 200, e < 1.8 ? 126 : 202]; // the grid: shadow line, then the T-bar
    }
    const fis = n2[y * S + x] < 0.3 ? 0.9 : 1; // fissures
    const v = (0.9 + n1[y * S + x] * 0.14) * fis;
    hgt[y * S + x] = 0.55 + (n2[y * S + x] - 0.5) * 0.3 - (e < 12 ? (12 - e) * 0.012 : 0);
    return [232 * v, 234 * v, 230 * v];
  });
  const g = map.getContext('2d');
  // water stains on a few tiles
  for (let i = 0; i < 3; i++) {
    const tx = Math.floor(rnd() * 4), ty = Math.floor(rnd() * 4);
    const x = tx * T + T / 2 + (rnd() - 0.5) * T * 0.5, y = ty * T + T / 2 + (rnd() - 0.5) * T * 0.5, r = 30 + rnd() * 70;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(120,96,50,0.0)');
    grd.addColorStop(0.5, 'rgba(120,96,50,0.09)');
    grd.addColorStop(0.85, 'rgba(90,70,36,0.16)');
    grd.addColorStop(1, 'rgba(90,70,36,0)');
    g.save();
    g.beginPath();
    g.rect(tx * T + 6, ty * T + 6, T - 12, T - 12);
    g.clip();
    g.fillStyle = grd;
    g.fillRect(x - r, y - r, r * 2, r * 2);
    g.restore();
  }
  const hc = pixels(S, S, (x, y) => [hgt[y * S + x] * 255, 0, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 2.2)) };
}
/** painted concrete soffit with beam lines every 1.2 m (2.4 m per repeat) */
function ceilingConcrete(seed, tone = '#b8bbba') {
  const rnd = mulberry(seed);
  const S = 1024;
  const base = hex(tone);
  const n1 = field(S, S, 4, rnd, 5), n2 = field(S, S, 60, rnd, 2);
  const map = pixels(S, S, (x, y) => {
    const j = Math.min(x % (S / 2), S / 2 - (x % (S / 2)));
    const seam = j < 6 ? 1 - j / 6 : 0;
    const v = 0.82 + n1[y * S + x] * 0.24 - seam * 0.24 + (n2[y * S + x] > 0.9 ? -0.1 : 0);
    return [base[0] * v, base[1] * v, base[2] * v];
  });
  const g = map.getContext('2d');
  grimeOver(g, S, S, rnd, { n: 20, alpha: 0.09 });
  const hc = pixels(S, S, (x, y) => [(0.55 + (n2[y * S + x] - 0.5) * 0.3) * 255, 0, 0]);
  return { map: tex(map, { srgb: true }), normalMap: tex(toNormal(hc, 2)) };
}

// ---------------------------------------------------------------- the decal atlas
// 4 x 4 cells of 256 px, alpha-blended things that lie on floors and walls
export const DECALS = ['blood', 'bloodDrag', 'puddle', 'stain', 'scuff', 'crack', 'leak', 'paper', 'burn', 'glass', 'slime', 'footprints', 'oil', 'mold', 'bullet', 'grime'];
export function decalAtlas() {
  const rnd = mulberry(4242);
  const CELL = 256;
  return tex(canvas(CELL * 4, CELL * 4, (g) => {
    DECALS.forEach((kind, i) => {
      const cx = (i % 4) * CELL + CELL / 2, cy = Math.floor(i / 4) * CELL + CELL / 2;
      g.save();
      g.beginPath();
      g.rect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
      g.clip();
      g.translate(cx, cy);
      const blob = (x, y, r, fill, squash = 1, rot = 0) => {
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        g.scale(1, squash);
        const grd = g.createRadialGradient(0, 0, r * 0.05, 0, 0, r);
        grd.addColorStop(0, fill[0]);
        grd.addColorStop(0.7, fill[1]);
        grd.addColorStop(1, fill[2]);
        g.fillStyle = grd;
        g.beginPath();
        for (let a = 0; a <= 24; a++) {
          const t = (a / 24) * TAU;
          const rr = r * (0.78 + 0.22 * Math.sin(t * 3 + x) * Math.cos(t * 5 + y) + (rnd() - 0.5) * 0.14);
          g[a ? 'lineTo' : 'moveTo'](Math.cos(t) * rr, Math.sin(t) * rr);
        }
        g.closePath();
        g.fill();
        g.restore();
      };
      const BL = ['rgba(176,22,24,0.97)', 'rgba(128,12,14,0.92)', 'rgba(90,8,10,0)'];
      if (kind === 'blood') {
        blob(0, 0, 70, BL, 0.85, 0.4);
        for (let k = 0; k < 9; k++) {
          const a = rnd() * TAU, d = 55 + rnd() * 60;
          blob(Math.cos(a) * d, Math.sin(a) * d, 4 + rnd() * 12, BL, 1, 0);
          g.strokeStyle = 'rgba(140,14,16,0.75)';
          g.lineWidth = 2 + rnd() * 3;
          g.beginPath();
          g.moveTo(Math.cos(a) * 40, Math.sin(a) * 40);
          g.lineTo(Math.cos(a) * d, Math.sin(a) * d);
          g.stroke();
        }
        g.fillStyle = 'rgba(255,200,200,0.28)';
        g.beginPath();
        g.ellipse(-22, -24, 24, 7, -0.6, 0, TAU);
        g.fill();
      } else if (kind === 'bloodDrag') {
        for (let k = 0; k < 5; k++) {
          const w = 8 + rnd() * 10, off = (k - 2) * 12;
          const grd = g.createLinearGradient(-115, 0, 115, 0);
          grd.addColorStop(0, 'rgba(120,10,12,0)');
          grd.addColorStop(0.25, 'rgba(160,18,20,0.85)');
          grd.addColorStop(0.85, 'rgba(140,14,16,0.9)');
          grd.addColorStop(1, 'rgba(100,8,10,0)');
          g.fillStyle = grd;
          g.beginPath();
          g.moveTo(-115, off);
          g.bezierCurveTo(-40, off - 10 + rnd() * 20, 40, off + 10 - rnd() * 20, 115, off + (rnd() - 0.5) * 14);
          g.lineTo(115, off + w);
          g.bezierCurveTo(40, off + w + 10, -40, off + w - 10, -115, off + w);
          g.fill();
        }
        blob(100, 0, 20, BL, 0.8, 0);
      } else if (kind === 'puddle') {
        blob(0, 0, 100, ['rgba(70,90,96,0.55)', 'rgba(46,60,66,0.5)', 'rgba(30,40,44,0)'], 0.8, 0.3);
        g.fillStyle = 'rgba(220,235,240,0.3)';
        g.beginPath();
        g.ellipse(-25, -20, 40, 10, -0.5, 0, TAU);
        g.fill();
      } else if (kind === 'stain') {
        blob(0, 0, 100, ['rgba(70,50,28,0.35)', 'rgba(60,44,24,0.3)', 'rgba(50,36,20,0)'], 0.85, 0.6);
        blob(-20, 10, 55, ['rgba(50,34,18,0.35)', 'rgba(50,34,18,0.2)', 'rgba(50,34,18,0)'], 0.9, 1.2);
      } else if (kind === 'scuff') {
        for (let k = 0; k < 14; k++) {
          g.strokeStyle = `rgba(14,14,14,${0.15 + rnd() * 0.3})`;
          g.lineWidth = 1.5 + rnd() * 5;
          g.lineCap = 'round';
          const y = -80 + rnd() * 160, x = -100 + rnd() * 60;
          g.beginPath();
          g.moveTo(x, y);
          g.quadraticCurveTo(x + 60 + rnd() * 40, y + (rnd() - 0.5) * 50, x + 130 + rnd() * 50, y + (rnd() - 0.5) * 60);
          g.stroke();
        }
      } else if (kind === 'crack') {
        const branch = (x, y, a, len, wd) => {
          g.lineWidth = wd;
          g.strokeStyle = 'rgba(12,12,12,0.85)';
          g.beginPath();
          g.moveTo(x, y);
          for (let s = 0; s < len; s++) {
            a += (rnd() - 0.5) * 0.7;
            x += Math.cos(a) * 9;
            y += Math.sin(a) * 9;
            g.lineTo(x, y);
            if (rnd() < 0.09 && wd > 1) branch(x, y, a + (rnd() - 0.5) * 2, len - s - 3, wd * 0.6);
          }
          g.stroke();
        };
        branch(-110, -20, 0.2, 24, 3);
      } else if (kind === 'leak') {
        // a vertical wet run with a rust tint, darker at the drip end
        for (let k = 0; k < 4; k++) {
          const x = -30 + k * 20 + (rnd() - 0.5) * 8, w = 6 + rnd() * 12;
          const grd = g.createLinearGradient(0, -120, 0, 120);
          grd.addColorStop(0, 'rgba(90,60,30,0)');
          grd.addColorStop(0.3, 'rgba(90,60,30,0.36)');
          grd.addColorStop(1, 'rgba(50,34,20,0.5)');
          g.fillStyle = grd;
          g.fillRect(x - w / 2, -120, w, 240 - rnd() * 60);
        }
        blob(0, 108, 40, ['rgba(60,50,40,0.45)', 'rgba(60,50,40,0.3)', 'rgba(60,50,40,0)'], 0.4, 0);
      } else if (kind === 'paper') {
        for (let k = 0; k < 5; k++) {
          g.save();
          g.translate((rnd() - 0.5) * 120, (rnd() - 0.5) * 120);
          g.rotate(rnd() * TAU);
          g.fillStyle = 'rgba(0,0,0,0.25)';
          g.fillRect(-42, -58, 88, 118);
          g.fillStyle = `rgb(${226 + (rnd() * 22) | 0},${228 + (rnd() * 20) | 0},${222 + (rnd() * 20) | 0})`;
          g.fillRect(-44, -60, 88, 118);
          g.fillStyle = 'rgba(40,44,50,0.55)';
          for (let l = 0; l < 10; l++) g.fillRect(-36, -50 + l * 10, 60 + rnd() * 16, 2);
          g.restore();
        }
      } else if (kind === 'burn') {
        blob(0, 0, 100, ['rgba(30,28,26,0.85)', 'rgba(36,32,28,0.55)', 'rgba(40,36,30,0)'], 0.9, 0);
      } else if (kind === 'glass') {
        for (let k = 0; k < 26; k++) {
          const a = rnd() * TAU, d = rnd() * 100, s = 5 + rnd() * 18;
          g.save();
          g.translate(Math.cos(a) * d, Math.sin(a) * d);
          g.rotate(rnd() * TAU);
          g.fillStyle = `rgba(${150 + (rnd() * 60) | 0},${200 + (rnd() * 40) | 0},${215 + (rnd() * 30) | 0},${0.35 + rnd() * 0.3})`;
          g.beginPath();
          g.moveTo(-s, -s * 0.4);
          g.lineTo(s * 0.4, -s);
          g.lineTo(s, s * 0.6);
          g.closePath();
          g.fill();
          g.strokeStyle = 'rgba(255,255,255,0.7)';
          g.lineWidth = 1;
          g.stroke();
          g.restore();
        }
      } else if (kind === 'slime') {
        blob(0, 0, 90, ['rgba(90,190,70,0.75)', 'rgba(50,130,40,0.6)', 'rgba(30,90,30,0)'], 0.8, 0.5);
        blob(-25, -18, 26, ['rgba(220,255,200,0.55)', 'rgba(150,230,120,0.28)', 'rgba(120,200,90,0)'], 0.6, 0);
      } else if (kind === 'footprints') {
        for (let k = 0; k < 6; k++) {
          const x = -95 + k * 38, y = (k % 2 ? 22 : -22) + (rnd() - 0.5) * 6, a = (rnd() - 0.5) * 0.3;
          g.save();
          g.translate(x, y);
          g.rotate(a + Math.PI / 2);
          g.fillStyle = `rgba(150,16,18,${0.9 - k * 0.1})`;
          g.beginPath();
          g.ellipse(0, 0, 12, 24, 0, 0, TAU);
          g.fill();
          g.beginPath();
          g.ellipse(0, 26, 10, 12, 0, 0, TAU);
          g.fill();
          g.restore();
        }
      } else if (kind === 'oil') {
        blob(0, 0, 100, ['rgba(46,48,54,0.7)', 'rgba(38,40,46,0.55)', 'rgba(38,40,46,0)'], 0.75, 0.2);
        g.fillStyle = 'rgba(90,120,200,0.18)';
        g.beginPath();
        g.ellipse(-20, -10, 40, 12, 0.2, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(200,110,90,0.14)';
        g.beginPath();
        g.ellipse(15, 12, 30, 9, 0.3, 0, TAU);
        g.fill();
      } else if (kind === 'mold') {
        for (let k = 0; k < 600; k++) {
          const a = rnd() * TAU, d = Math.pow(rnd(), 0.7) * 105;
          g.fillStyle = `rgba(${28 + (rnd() * 20) | 0},${40 + (rnd() * 30) | 0},${24 + (rnd() * 10) | 0},${0.03 + rnd() * 0.12})`;
          g.beginPath();
          g.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + rnd() * 5, 0, TAU);
          g.fill();
        }
      } else if (kind === 'bullet') {
        for (let k = 0; k < 9; k++) {
          const x = (rnd() - 0.5) * 150, y = (rnd() - 0.5) * 150;
          g.fillStyle = 'rgba(10,10,10,0.92)';
          g.beginPath();
          g.arc(x, y, 3 + rnd() * 2, 0, TAU);
          g.fill();
          g.strokeStyle = 'rgba(30,30,30,0.45)';
          g.lineWidth = 1;
          for (let r = 0; r < 6; r++) {
            const a = rnd() * TAU;
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + Math.cos(a) * (8 + rnd() * 14), y + Math.sin(a) * (8 + rnd() * 14));
            g.stroke();
          }
        }
      } else if (kind === 'grime') {
        for (let k = 0; k < 40; k++) blob((rnd() - 0.5) * 200, (rnd() - 0.5) * 200, 8 + rnd() * 34, ['rgba(20,20,16,0.12)', 'rgba(20,20,16,0.06)', 'rgba(20,20,16,0)'], 1, 0);
      }
      g.restore();
    });
  }), { srgb: true, rep: false, aniso: 4 });
}
/** the atlas rect of a decal kind: [u0, v0, u1, v1] (v up) */
const DECAL_ALIAS = { bloodSmear: 'bloodDrag', splatter: 'blood', water: 'puddle', soot: 'burn', shards: 'glass', dirt: 'grime', rust: 'stain' };
export function decalUV(kind) {
  const i = Math.max(0, DECALS.indexOf(DECAL_ALIAS[kind] ?? kind));
  const cx = i % 4, cy = Math.floor(i / 4);
  return [cx / 4, 1 - (cy + 1) / 4, (cx + 1) / 4, 1 - cy / 4];
}

// ---------------------------------------------------------------- soft shadow / AO textures
export function blobTexture() {
  return tex(canvas(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,0.9)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  }), { rep: false, aniso: 1 });
}
export function stripTexture() {
  return tex(canvas(16, 128, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(0,0,0,0.75)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.3)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 128);
  }), { rep: false, aniso: 1 });
}

// ---------------------------------------------------------------- the label atlas
/** text signs on demand: `label(text-or-lines, opts, w, h)` draws into a shared atlas and returns its rect */
export class LabelAtlas {
  constructor(W = 4096, H = 2048) {
    this.W = W;
    this.H = H;
    this.cv = document.createElement('canvas');
    this.cv.width = W;
    this.cv.height = H;
    this.g = this.cv.getContext('2d');
    this.g.fillStyle = '#1b2127';
    this.g.fillRect(0, 0, W, H);
    this.x = 0;
    this.y = 0;
    this.rowH = 0;
    this.cache = new Map();
    this.texture = tex(this.cv, { srgb: true, rep: false });
    this.overflow = false;
  }
  rect(text, o, w, h) {
    const key = JSON.stringify([text, o, Math.round(w * 100), Math.round(h * 100)]);
    if (this.cache.has(key)) return this.cache.get(key);
    const pw = Math.max(24, Math.min(1024, Math.round(w * 300))), ph = Math.max(16, Math.min(512, Math.round(h * 300)));
    if (this.x + pw > this.W) {
      this.x = 0;
      this.y += this.rowH;
      this.rowH = 0;
    }
    if (this.y + ph > this.H) {
      if (!this.overflow) console.warn('[hive] label atlas full');
      this.overflow = true;
      return [0, 0, 8, 8];
    }
    const r = [this.x, this.y, pw, ph];
    this.x += pw;
    this.rowH = Math.max(this.rowH, ph);
    this.paint(r, text, o);
    this.cache.set(key, r);
    this.texture.needsUpdate = true;
    return r;
  }
  paint([x, y, w, h], text, o = {}) {
    const g = this.g;
    const lines = Array.isArray(text) ? text : [text];
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.fillStyle = o.bg ?? '#1b2127';
    g.fillRect(x, y, w, h);
    if (o.border) {
      g.strokeStyle = o.border;
      g.lineWidth = Math.max(2, h * 0.05);
      g.strokeRect(x + g.lineWidth / 2, y + g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
    }
    // o.font may be a CSS font ('bold 64px Arial'): its family / weight are kept, its size is only the largest allowed
    let family = 'Arial, Helvetica, sans-serif', weight = o.weight ?? 'bold', maxSize = o.size ?? 999;
    if (o.font) {
      const m = /^\s*(?:(bold|italic|normal|lighter|bolder|\d{3})\s+)?(?:(\d+(?:\.\d+)?)px\s+)?(.+)$/.exec(o.font);
      if (m) {
        if (m[1]) weight = m[1];
        if (m[2]) maxSize = Math.min(maxSize, +m[2]);
        family = m[3];
      }
    }
    const lh = (h - 6) / lines.length;
    let fs = Math.min(lh * 0.78, maxSize);
    const fit = () => lines.reduce((m, s) => Math.max(m, g.measureText(s).width), 0);
    g.font = `${weight} ${fs}px ${family}`;
    while (fit() > w - 12 && fs > 6) {
      fs -= 1;
      g.font = `${weight} ${fs}px ${family}`;
    }
    g.fillStyle = o.fg ?? '#e8edf0';
    g.textBaseline = 'middle';
    g.textAlign = o.align ?? 'center';
    const tx = g.textAlign === 'left' ? x + 8 : g.textAlign === 'right' ? x + w - 8 : x + w / 2;
    lines.forEach((s, i) => g.fillText(s, tx, y + 3 + lh * (i + 0.5)));
    g.restore();
  }
}

// ---------------------------------------------------------------- the surface catalogue
/**
 * All the shell materials: walls (paint colours, wainscots), floors, ceilings. `mat(params, cast)` is hiveMat.
 * Returns { wallBase, paints: {name: mat}, wains: {name: mat}, floors: {name: mat}, ceils: {name: mat} }.
 */
export function shellMaterials() {
  const block = blockWall(101);
  const concW = concreteWall(102);
  const tile = tileWall(103, { paint: '#e4e9e6' });
  const tileGreen = tileWall(104, { paint: '#a9c7b6', grout: '#7c8a83' });
  const tileBlue = tileWall(105, { paint: '#a9c1d6', grout: '#7b8791', kind: 'subway' });
  const tileCream = tileWall(106, { paint: '#e0d6bc', grout: '#8a8272', kind: 'subway' });
  const wood = woodWall(107);
  const steel = steelWall(108);
  const steelDark = steelWall(109, '#6a757d');

  const wallMat = (maps, color, rough = 0.9, extra = {}) => hiveMat({ map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: maps.roughnessMap ?? null, roughness: maps.roughnessMap ? 1 : rough, color, ...extra }, true);
  const paints = {
    concrete: wallMat(concW, 0xd8d8d6),
    white: wallMat(block, 0xf1f1ee),
    cream: wallMat(block, 0xf0e3c4),
    grey: wallMat(block, 0xb9c0c4),
    green: wallMat(block, 0xb4d6c0),
    blue: wallMat(block, 0xa9c4e2),
    yellow: wallMat(block, 0xf0d888),
    sand: wallMat(block, 0xd8c8a4),
    dark: wallMat(block, 0x6f767c),
    red: wallMat(block, 0xc99a94),
    salmon: wallMat(block, 0xe8b9a6),
  };
  const wains = {
    tile: wallMat(tile, 0xffffff, 0.3),
    tileGreen: wallMat(tileGreen, 0xffffff, 0.3),
    tileBlue: wallMat(tileBlue, 0xffffff, 0.3),
    tileCream: wallMat(tileCream, 0xffffff, 0.3),
    wood: wallMat(wood, 0xffffff, 0.5),
    steel: wallMat(steel, 0xffffff, 0.4, { metalness: 0.35 }),
    steelDark: wallMat(steelDark, 0xd8dde0, 0.4, { metalness: 0.35 }),
    band: wallMat(block, 0x8d97a2),
    bandGreen: wallMat(block, 0x6f957f),
    bandBlue: wallMat(block, 0x5f86b8),
  };
  const fl = (maps, color = 0xffffff, rough = 0.5, extra = {}) => hiveMat({ map: maps.map, normalMap: maps.normalMap ?? null, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: maps.roughnessMap ?? null, roughness: maps.roughnessMap ? 1 : rough, color, envMapIntensity: 0.9, ...extra });
  const epoxy = epoxyFloor(201), epoxyD = epoxyFloor(202, '#5b6468');
  const vinyl = vinylFloor(203), vinylG = vinylFloor(204, '#9fb5aa', '#90a79c', '#4f6058');
  const carpet = carpetFloor(205);
  const floors = {
    epoxy: fl(epoxy),
    epoxyDark: fl(epoxyD),
    vinyl: fl(vinyl),
    vinylGreen: fl(vinylG),
    checker: fl(checkerFloor(206)),
    carpetBlue: fl(carpet, 0x6f8bb0),
    carpetGrey: fl(carpet, 0x9ba0a6),
    carpetBrown: fl(carpet, 0x84664c),
    carpetRed: fl(carpet, 0x93504a),
    concrete: fl(concreteFloor(207)),
    concreteDark: fl(concreteFloor(208, '#4d504f')),
    terrazzo: fl(terrazzoFloor(209), 0xffffff, 0.3),
    raised: fl(raisedFloor(210)),
    plate: fl(diamondPlate(211), 0xffffff, 0.5, { metalness: 0.5 }),
    parquet: fl(parquetFloor(212)),
  };
  const tileC = ceilingTile(301), concC = ceilingConcrete(302);
  const cl = (maps, color = 0xffffff) => hiveMat({ map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(0.7, 0.7), roughness: 0.92, color }, true);
  const ceils = { tile: cl(tileC), tileWarm: cl(tileC, 0xf3ead6), concrete: cl(concC), concreteDark: cl(concC, 0x8a8e8e) };
  // untextured wall (the slab's raw sides, hidden behind the cladding)
  const wallBase = hiveMat({ map: concW.map, normalMap: concW.normalMap, roughness: 0.95, color: 0xaeb0ae }, true);
  return { wallBase, paints, wains, floors, ceils };
}

// ---------------------------------------------------------------- what is behind the atrium's observation windows
/** 4 views (2 x 2 in a 512 x 256 canvas): a lit office, a dark room with monitors, half-drawn blinds, red emergency light */
export function windowViews() {
  const rnd = mulberry(606);
  const cv = canvas(512, 256, (g) => {
    const cell = (i, draw) => {
      const x = (i % 2) * 256, y = Math.floor(i / 2) * 128;
      g.save();
      g.beginPath();
      g.rect(x, y, 256, 128);
      g.clip();
      g.translate(x, y);
      draw();
      g.restore();
    };
    const desks = (col) => {
      g.fillStyle = col;
      for (let k = 0; k < 4; k++) {
        const dx = 12 + k * 62 + rnd() * 10;
        g.fillRect(dx, 84, 44, 6); // desk top
        g.fillRect(dx + 3, 90, 3, 30);
        g.fillRect(dx + 38, 90, 3, 30);
        g.fillRect(dx + 14, 66 + rnd() * 6, 18, 14); // monitor
        g.fillRect(dx + 21, 80, 4, 4);
      }
    };
    cell(0, () => {
      const wall = g.createLinearGradient(0, 0, 0, 128);
      wall.addColorStop(0, '#9a9078');
      wall.addColorStop(1, '#5f584a');
      g.fillStyle = wall;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#fff6d8';
      g.fillRect(24, 6, 90, 6);
      g.fillRect(140, 6, 90, 6);
      const glow = g.createRadialGradient(128, 6, 4, 128, 6, 140);
      glow.addColorStop(0, 'rgba(255,240,200,0.5)');
      glow.addColorStop(1, 'rgba(255,240,200,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, 256, 128);
      desks('#1e1a14');
      g.fillStyle = '#2c4a30';
      g.fillRect(225, 60, 14, 40);
    });
    cell(1, () => {
      g.fillStyle = '#080c12';
      g.fillRect(0, 0, 256, 128);
      desks('#04060a');
      for (let k = 0; k < 4; k++) {
        g.fillStyle = `rgba(80,${140 + (rnd() * 60) | 0},255,0.85)`;
        g.fillRect(26 + k * 62, 68, 14, 9);
        const gl = g.createRadialGradient(33 + k * 62, 72, 1, 33 + k * 62, 72, 34);
        gl.addColorStop(0, 'rgba(70,130,255,0.35)');
        gl.addColorStop(1, 'rgba(70,130,255,0)');
        g.fillStyle = gl;
        g.fillRect(0, 30, 256, 90);
      }
    });
    cell(2, () => {
      const wall = g.createLinearGradient(0, 0, 0, 128);
      wall.addColorStop(0, '#d9d2b0');
      wall.addColorStop(1, '#8b826a');
      g.fillStyle = wall;
      g.fillRect(0, 0, 256, 128);
      desks('#2a2418');
      // blinds: horizontal slats over the top two thirds, some bent
      for (let y = 0; y < 90; y += 7) {
        g.fillStyle = `rgba(${170 + (rnd() * 30) | 0},${160 + (rnd() * 30) | 0},${130},${0.9})`;
        g.fillRect(0, y, 256, 5);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, y + 5, 256, 2);
      }
      g.fillStyle = 'rgba(30,26,18,0.9)';
      g.fillRect(90, 0, 40, 60 + rnd() * 20); // a slat cluster hanging
    });
    cell(3, () => {
      g.fillStyle = '#1a0606';
      g.fillRect(0, 0, 256, 128);
      const em = g.createRadialGradient(128, 8, 2, 128, 8, 120);
      em.addColorStop(0, 'rgba(255,40,30,0.55)');
      em.addColorStop(1, 'rgba(255,40,30,0)');
      g.fillStyle = em;
      g.fillRect(0, 0, 256, 128);
      desks('#0a0202');
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 1.5;
      g.beginPath(); // a crack across the pane
      g.moveTo(120, 0); g.lineTo(150, 40); g.lineTo(130, 70); g.lineTo(170, 128);
      g.stroke();
    });
  });
  return { texture: tex(cv, { srgb: true, rep: false, aniso: 4 }), rect: (i) => [(i % 2) / 2, 1 - (Math.floor(i / 2) + 1) / 2, (i % 2) / 2 + 0.5, 1 - Math.floor(i / 2) / 2] };
}

/** a pegboard: perforated hardboard, 25 mm hole pitch (0.5 m per repeat), the holes dark, a soft shadow under each */
export function pegboardMaterial() {
  const rnd = mulberry(808);
  const S = 512, P = S / 20;
  const n1 = field(S, S, 4, rnd, 3);
  const map = pixels(S, S, (x, y) => {
    const v = 0.9 + n1[y * S + x] * 0.16;
    return [150 * v, 158 * v, 160 * v];
  });
  const g = map.getContext('2d');
  for (let j = 0; j < 20; j++) {
    for (let i = 0; i < 20; i++) {
      const x = i * P + P / 2, y = j * P + P / 2;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.arc(x + 1, y + 1.5, 3.4, 0, TAU);
      g.fill();
      g.fillStyle = '#15181a';
      g.beginPath();
      g.arc(x, y, 3, 0, TAU);
      g.fill();
    }
  }
  return hiveMat({ map: tex(map, { srgb: true }), roughness: 0.85 });
}
