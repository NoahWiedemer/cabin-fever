// Cuts the painted details of Sanderstraße 13 / 13a / 13c out of the site photos (assets/source/appenweier/
// photos, gitignored) into public/maps/appenweier/*.webp for src/world/appenweier.js: the Lüftlmalerei
// scenes on 13a's gable, its vine border and medallions, the sun over the door, the tile panels, the scroll
// sign, the dog on the garage, 13c's star door. The daylight (sun, tree shadows) is flattened out of the
// murals so the game's own lights do the shading; edges fade out to blend into the plaster.
//   node tools/appenweier-photos.mjs
// No licence plates, names or people are cut out (the murals are paintings).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/source/appenweier/photos/Appenweier');
const OUT = path.join(ROOT, 'public/maps/appenweier');
const K = 2.04; // the crop boxes below are in 2000-px-wide preview pixels; the photos are 4080 wide

// name: [photo, x0, y0, x1, y1 (preview px), options]
//   flat: flatten the lighting (murals); feather: px of edge fade (0: keep the rectangle); max: longest side
const CROPS = {
  sceneLeft: ['IMG_20260929_082850801.jpg', 0, 455, 690, 832, { flat: true, feather: 60, max: 1024 }],
  sceneCenter: ['IMG_20260929_082850801.jpg', 905, 420, 1540, 770, { flat: true, feather: 55, max: 1024 }],
  sceneRight: ['IMG_20260929_082850801.jpg', 1620, 520, 1990, 865, { flat: true, feather: 45, max: 768 }],
  vine: ['IMG_20260929_082850801.jpg', 0, 138, 1235, 242, { flat: true, feather: 0, featherY: 18, max: 2048 }],
  cherubs: ['IMG_20260929_082850801.jpg', 1160, 125, 1420, 292, { flat: true, feather: 30, max: 512 }],
  birds: ['IMG_20260929_082847719.jpg', 700, 398, 797, 497, { flat: false, feather: 0, round: true, max: 256 }],
  sun: ['IMG_20260929_082850801.jpg', 1085, 772, 1468, 862, { flat: false, feather: 0, max: 512 }],
  tilesL: ['IMG_20260929_082850801.jpg', 968, 893, 1042, 988, { flat: false, feather: 0, max: 256 }],
  tilesR: ['IMG_20260929_082850801.jpg', 1436, 888, 1493, 1052, { flat: false, feather: 0, max: 256 }],
  scroll: ['IMG_20260929_082901364.jpg', 1084, 630, 1264, 742, { flat: true, feather: 14, max: 512 }],
  madonna: ['IMG_20260929_082901364.jpg', 1156, 706, 1221, 806, { flat: false, feather: 0, max: 256 }],
  dog: ['IMG_20260929_082847719.jpg', 1122, 786, 1172, 872, { flat: true, feather: 10, max: 256 }],
  starDoor: ['IMG_20260929_082857199.jpg', 1090, 690, 1152, 872, { flat: false, feather: 0, max: 512 }],
};

/** divide out the low-frequency brightness (sun / shade) so the plaster comes out one even cream */
function flatten(data, w, h, ch) {
  // luminance, heavily blurred (box blur x3 on a downscaled copy)
  const s = 8, sw = Math.ceil(w / s), sh = Math.ceil(h / s);
  const small = new Float32Array(sw * sh), cnt = new Float32Array(sw * sh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const L = 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2];
      const j = ((y / s) | 0) * sw + ((x / s) | 0);
      small[j] += L;
      cnt[j]++;
    }
  for (let j = 0; j < small.length; j++) small[j] /= cnt[j] || 1;
  let a = small, b = new Float32Array(small.length);
  const R = Math.max(2, Math.round(Math.min(sw, sh) * 0.18));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let t = 0, n = 0;
        for (let k = -R; k <= R; k++) {
          const xx = Math.min(sw - 1, Math.max(0, x + k));
          t += a[y * sw + xx];
          n++;
        }
        b[y * sw + x] = t / n;
      }
    [a, b] = [b, a];
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        let t = 0, n = 0;
        for (let k = -R; k <= R; k++) {
          const yy = Math.min(sh - 1, Math.max(0, y + k));
          t += a[yy * sw + x];
          n++;
        }
        b[y * sw + x] = t / n;
      }
    [a, b] = [b, a];
  }
  const target = 205;
  const sample = (x, y) => {
    const fx = Math.min(sw - 1.001, Math.max(0, x / s - 0.5)), fy = Math.min(sh - 1.001, Math.max(0, y / s - 0.5));
    const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
    const i = y0 * sw + x0;
    return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + sw] * (1 - tx) + a[i + sw + 1] * tx) * ty;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch;
      const g = Math.min(2.2, target / Math.max(30, sample(x, y)));
      // warm the plaster a touch toward the cream it is (the morning sun turned it yellow in places)
      data[i] = Math.min(255, data[i] * g * 0.97);
      data[i + 1] = Math.min(255, data[i + 1] * g * 0.98);
      data[i + 2] = Math.min(255, data[i + 2] * g * 1.02);
    }
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, [file, x0, y0, x1, y1, o]] of Object.entries(CROPS)) {
  const left = Math.round(x0 * K), top = Math.round(y0 * K);
  const width = Math.round((x1 - x0) * K), height = Math.round((y1 - y0) * K);
  let img = sharp(path.join(SRC, file)).rotate().extract({ left, top, width, height });
  const scale = Math.min(1, o.max / Math.max(width, height));
  const w = Math.round(width * scale), h = Math.round(height * scale);
  img = img.resize(w, h);
  const { data } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (o.flat) flatten(data, w, h, 4);
  const fx = o.feather ? o.feather * K * scale : 0, fy = (o.featherY ?? o.feather ?? 0) * K * scale;
  if (fx || fy || o.round) {
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let al = 1;
        if (o.round) {
          const r = Math.hypot(x - w / 2, y - h / 2) / (Math.min(w, h) / 2);
          al = Math.min(1, Math.max(0, (1 - r) * 12));
        } else {
          const e = (d, f) => (f ? Math.min(1, Math.max(0, d / f)) : 1);
          const sm = (t) => t * t * (3 - 2 * t);
          al = sm(e(x, fx)) * sm(e(w - 1 - x, fx)) * sm(e(y, fy)) * sm(e(h - 1 - y, fy));
        }
        data[(y * w + x) * 4 + 3] = Math.round(al * 255);
      }
  }
  const out = path.join(OUT, name + '.webp');
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp({ quality: 88, alphaQuality: 90 }).toFile(out);
  console.log(name.padEnd(12), `${w}x${h}`, (fs.statSync(out).size / 1024).toFixed(0) + ' KB');
}
