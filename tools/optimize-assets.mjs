// Converts the source GLBs in assets/source into web-ready files under public/models:
// spec/gloss -> metal/rough, textures resized + WebP, meshopt geometry compression.
// Hierarchy is left intact (bone and node names are looked up at runtime).
//   node tools/optimize-assets.mjs            # all
//   node tools/optimize-assets.mjs smoker     # only outputs whose name contains "smoker"
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = 'assets/source';
const OUT = 'public/models';

/** texels of a w x h texture that the primitives' TEXCOORD_0 triangles cover (1), conservatively, pinholes closed */
function uvCoverage(prims, w, h) {
  const cover = new Uint8Array(w * h);
  const mark = (x, y) => (cover[Math.min(h - 1, Math.max(0, Math.floor(y))) * w + Math.min(w - 1, Math.max(0, Math.floor(x)))] = 1);
  for (const prim of prims) {
    const uv = prim.getAttribute('TEXCOORD_0').getArray(), idx = prim.getIndices().getArray();
    for (let i = 0; i < idx.length; i += 3) {
      const x0 = uv[idx[i] * 2] * w, y0 = uv[idx[i] * 2 + 1] * h;
      const x1 = uv[idx[i + 1] * 2] * w, y1 = uv[idx[i + 1] * 2 + 1] * h;
      const x2 = uv[idx[i + 2] * 2] * w, y2 = uv[idx[i + 2] * 2 + 1] * h;
      // corners, edge midpoints and centre always count (triangles smaller than a texel), then the texel centres inside
      mark(x0, y0), mark(x1, y1), mark(x2, y2), mark((x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3);
      mark((x0 + x1) / 2, (y0 + y1) / 2), mark((x1 + x2) / 2, (y1 + y2) / 2), mark((x0 + x2) / 2, (y0 + y2) / 2);
      const d = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(d) < 1e-9) continue;
      const maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2))), maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
      for (let y = Math.max(0, Math.floor(Math.min(y0, y1, y2))); y <= maxY; y++) {
        for (let x = Math.max(0, Math.floor(Math.min(x0, x1, x2))); x <= maxX; x++) {
          const px = x + 0.5, py = y + 0.5;
          const a = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) / d, b = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) / d;
          if (a >= -0.02 && b >= -0.02 && 1 - a - b >= -0.02) cover[y * w + x] = 1;
        }
      }
    }
  }
  const closed = cover.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (cover[y * w + x]) continue;
      let s = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += cover[(y + dy) * w + x + dx];
      if (s >= 5) closed[y * w + x] = 1;
    }
  }
  return closed;
}

/**
 * Pull-push hole filling: coverage-weighted averages up a pyramid (pull), then every uncovered texel takes the
 * colour of the level above it (push), so the gaps between islands carry the islands' own rim colours outward.
 * data: interleaved 8-bit texels (c channels), rewritten in place outside `cover`.
 */
function pullPush(data, cover, w, h, c) {
  const levels = [{ w, h, C: null, W: null }];
  // level 1 straight from the 8-bit texels
  let lw = w, lh = h;
  for (;;) {
    const pw = Math.max(1, Math.ceil(lw / 2)), ph = Math.max(1, Math.ceil(lh / 2));
    const C = new Float32Array(pw * ph * c), W = new Float32Array(pw * ph);
    const prev = levels[levels.length - 1];
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        let ws = 0;
        const o = (y * pw + x) * c;
        for (let k = 0; k < 4; k++) {
          const cx = Math.min(lw - 1, x * 2 + (k & 1)), cy = Math.min(lh - 1, y * 2 + (k >> 1)), ci = cy * lw + cx;
          const wt = prev.W ? prev.W[ci] : cover[ci];
          if (!wt) continue;
          ws += wt;
          for (let j = 0; j < c; j++) C[o + j] += wt * (prev.C ? prev.C[ci * c + j] : data[ci * c + j]);
        }
        if (ws > 0) for (let j = 0; j < c; j++) C[o + j] /= ws;
        W[y * pw + x] = Math.min(1, ws);
      }
    }
    levels.push({ w: pw, h: ph, C, W });
    lw = pw, lh = ph;
    if (pw === 1 && ph === 1) break;
  }
  for (let l = levels.length - 2; l >= 0; l--) {
    const L = levels[l], U = levels[l + 1];
    for (let y = 0; y < L.h; y++) {
      for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x, pi = (y >> 1) * U.w + (x >> 1);
        if (l === 0) {
          if (cover[i]) continue;
          for (let j = 0; j < c; j++) data[i * c + j] = Math.round(U.C[pi * c + j]);
        } else if (L.W[i] < 1) {
          const k = L.W[i];
          for (let j = 0; j < c; j++) L.C[i * c + j] = k * L.C[i * c + j] + (1 - k) * U.C[pi * c + j];
          L.W[i] = 1;
        }
      }
    }
  }
}

/**
 * opts.pad: fill the empty background of every texture (black, outside the UV islands) with the islands' colours
 * (pullPush). Meshy bakes onto black between thousands of tiny islands; resized and mipmapped, that black crept into
 * the islands (a dark cast over the whole body at a distance). The margin Meshy paints round each island (its own
 * colours, a few texels) stays as it is: it is what a simplified triangle cutting a corner off its island lands on
 * (filled by averaging, that rim took the black of the clothes' islands next door: dark dots all over the hair).
 */
async function pad(doc) {
  const root = doc.getRoot();
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  for (const mat of root.listMaterials()) {
    const own = prims.filter((p) => p.getMaterial() === mat && p.getAttribute('TEXCOORD_0') && p.getIndices());
    const texs = new Set([mat.getBaseColorTexture(), mat.getMetallicRoughnessTexture(), mat.getNormalTexture(), mat.getOcclusionTexture(), mat.getEmissiveTexture()].filter(Boolean));
    for (const tex of texs) {
      const { data, info } = await sharp(Buffer.from(tex.getImage())).raw().toBuffer({ resolveWithObject: true });
      const c = info.channels, cover = uvCoverage(own, info.width, info.height);
      // anything painted counts as covered: only the (near) black background gets filled
      for (let i = 0; i < cover.length; i++) if (!cover[i] && Math.max(data[i * c], data[i * c + 1], data[i * c + 2]) > 10) cover[i] = 1;
      pullPush(data, cover, info.width, info.height, c);
      const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: c } }).png().toBuffer();
      tex.setImage(new Uint8Array(png)).setMimeType('image/png');
    }
  }
}

/**
 * opts.reduce { ratio, error }: meshoptimizer's attribute-aware simplifier (normals and UVs weigh in). UV seams are
 * kept: Meshy's "unwrapped" meshes are all seams, and collapsing across them (the 'Permissive' flag) drew texels
 * from between the islands onto Raven's face. Seam-aware it stops higher (Raven: 258k -> 68k tris), and what's left
 * (collapses along an island's rim cut a corner a few texels deep) is what opts.pad covers. Tangents go too when
 * there's no normal map.
 */
async function reduce(doc, { ratio, error }) {
  await MeshoptSimplifier.ready;
  await doc.transform(weld()); // (vertices split with equal attributes would count as seams too)
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (!prim.getMaterial()?.getNormalTexture()) prim.setAttribute('TANGENT', null);
      const idx = prim.getIndices(), pos = prim.getAttribute('POSITION');
      if (prim.getMode() !== 4 || !idx || !pos) continue; // (triangles only)
      const nrm = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
      const n = pos.getCount();
      const P = new Float32Array(n * 3), A = new Float32Array(n * 5), e3 = [0, 0, 0], e2 = [0, 0];
      for (let i = 0; i < n; i++) {
        P.set(pos.getElement(i, e3), i * 3);
        if (nrm) A.set(nrm.getElement(i, e3), i * 5);
        if (uv) A.set(uv.getElement(i, e2), i * 5 + 3);
      }
      const target = Math.floor((idx.getCount() * ratio) / 3) * 3;
      const [out] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(idx.getArray()), P, 3, A, 5, [0.5, 0.5, 0.5, 1, 1], null, target, error);
      idx.setArray(out);
      compactPrimitive(prim);
    }
  }
}

// [source, output, max texture size, opts?]
export const ASSETS = [
  ['coach_l4d2_with_rigging.glb', 'characters/coach.glb', 1024],
  ['ellis_l4d2.glb', 'characters/ellis.glb', 1024],
  ['fat_zombie.glb', 'zombies/boomer.glb', 1024], // Meshy "Fat Zombie" (Meshy biped rig, joints mapped by name): the Boomer (replaced the L4D2 one)
  ['striker.glb', 'zombies/bomber.glb', 1024], // UniRig gas-mask bomber: the Striker body (bursts into 3 flesh pods on death)
  ['zombie_woman.glb', 'zombies/woman.glb', 1024], // UniRig zombie woman: replaced the procedural Mauler bodies
  ['tank.glb', 'zombies/tank.glb', 1024], // UniRig blue tank: the Crusher boss body
  ['zombie.glb', 'zombies/smoker.glb', 1024], // UniRig zombie (replaced the L4D2 smoker), bones mapped by topology
  ['gasmask_zombie.glb', 'zombies/gasmask.glb', 1024], // UniRig gas-mask zombie: a Mauler body variant (weights: fix-viper-weights)
  ['biter.glb', 'zombies/biter.glb', 1024], // UniRig "smallbiterzombie" kid: the Biter (weights: fix-viper-weights)
  ['stalker.glb', 'zombies/stalker.glb', 2048, { simplify: 0.45 }], // UniRig mutant: the Stalker (weights: fix-viper-weights; 197k tris simplified; seen up close, so 2K textures)
  // unrigged models, rigged by tools/blender/autorig.py (<name>_raw.glb -> <name>.glb: 30k tris, Mixamo joint names)
  ['worker.glb', 'zombies/worker.glb', 1024], // construction worker in a hard hat: the Worker (weights: fix-viper-weights)
  ['normal_zombie.glb', 'zombies/normal.glb', 1024], // plain zombie in a torn shirt: a Mauler body variant (weights: fix-viper-weights)
  ['survival_zombie.glb', 'zombies/survivor.glb', 1024], // survivalist with a big pack: the Survivalist (drops loot)
  ['emosquad.glb', 'characters/emosquad.glb', 2048], // your own character (1.1M-tri scan, rigged at 40k tris): cutscenes + the store paperdoll, seen up close
  ['left_4_dead_2_-_charger_with_rig.glb', 'zombies/charger.glb', 1024],
  ['Mutant_dog.glb', 'zombies/dog.glb', 1024], // UniRig quadruped, bones mapped by topology
  ['Meshy_AI_Character_output.glb', 'characters/meshy.glb', 1024], // UniRig skeleton, bones mapped by topology
  ['Viper.glb', 'characters/viper.glb', 1024], // UniRig skeleton, bones mapped by topology
  // Meshy "Merc" (biped rig: Mixamo joint names). Meshy ships it once per clip (walking, running, run and shoot); the
  // game animates its characters itself (actors/gltfCharacter.js), so the clip goes and 258k tris become ~68k. 2K
  // textures: she is an operator skin too (seen up close in the store and the cutscenes)
  ['raven_Walking.glb', 'characters/raven.glb', 2048, { noAnims: true, pad: true, reduce: { ratio: 0.15, error: 0.003 } }],
  ['shopkeeper.glb', 'characters/shopkeeper.glb', 1024], // gun shop clerk (UniRig), bones mapped by topology
  ['nadja.glb', 'characters/nadja.glb', 2048], // lab tech behind the basement's armored glass: 2.2M-tri scan simplified to 100k (meshopt), old UniRig skeleton + weights transferred, fix-viper-weights
  ['kirche2.glb', 'environment/church.glb', 1024],
  // built in Blender (tools/blender/m16a2.py -> Kit.export)
  ['m16a2_raw.glb', 'weapons/m16a2.glb', 1024],
  // normalized in Blender (tools/blender/weapons_import.py): gun space, parts, markers
  ['r201_raw.glb', 'weapons/r201.glb', 2048],
  ['spas12_raw.glb', 'weapons/spas12.glb', 1024],
  ['devotion_raw.glb', 'weapons/devotion.glb', 1024], // 10 textures
  ['mozambique_raw.glb', 'weapons/mozambique.glb', 2048],
  ['softball_raw.glb', 'weapons/softball.glb', 2048],
  ['molotov_raw.glb', 'weapons/molotov.glb', 1024],
  ['sigma_raw.glb', 'weapons/sigma.glb', 2048], // AI scan decimated to 90k tris
  ['p90_raw.glb', 'weapons/p90.glb', 2048], // textured scan decimated to 190k tris, normals re-projected
  ['mg42_raw.glb', 'weapons/mg42.glb', 2048], // AI scan decimated to 75k tris + its ammo box (30k); cover, cocking handle and box split out
  ['g36c_raw.glb', 'weapons/g36c.glb', 2048, { reduce: { ratio: 0.232, error: 0.01 } }], // AI scan, 388k tris -> 90k (meshopt: far fewer dents than Blender's collapse), mag split out
  ['awm_raw.glb', 'weapons/awm.glb', 2048], // AI scan (38.5k tris kept, base colour only), levelled on its barrel; mag and the deployed bipod split out
  ['axmc_raw.glb', 'weapons/axmc.glb', 2048, { reduce: { ratio: 0.778, error: 0.01 } }], // AI scan, 116k tris -> 90k (meshopt), mag split out
  ['ak47_raw.glb', 'weapons/ak47.glb', 2048, { reduce: { ratio: 0.72, error: 0.01 } }], // AI scan (base colour only), 97k tris -> 70k (meshopt); mag and charging handle split out
  ['minigun_raw.glb', 'weapons/minigun.glb', 2048, { reduce: { ratio: 0.22, error: 0.01 } }], // AI scan, 362k tris -> 80k (meshopt); the 7-barrel cluster split out on its rotation axis
  // melee, normalized by tools/melee-import.mjs (no Blender needed)
  ['tomahawk_raw.glb', 'weapons/tomahawk.glb', 1024], // AI scan, 195k tris -> 40k
  ['bat_raw.glb', 'weapons/bat.glb', 1024],
  // first-person arms (tools/blender/arms.py)
  ['arms_raw.glb', 'arms/arms.glb', 1024, { meshopt: false }], // skinned: keep float positions (UVs are projected at runtime)
];

// the CLI's own entry point under node (spawning `npx` directly fails on Windows, where it is a .cmd)
const CLI = 'node_modules/@gltf-transform/cli/bin/cli.js';
const cli = (...args) => execFileSync(process.execPath, [CLI, ...args], { stdio: 'pipe' });
const filter = process.argv[2];

for (const [src, out, size, opts = {}] of ASSETS) {
  if (filter && !out.includes(filter)) continue;
  const input = join(SRC, src);
  const output = join(OUT, out);
  const tmp = output.replace(/\.glb$/, '.tmp.glb');
  mkdirSync(dirname(output), { recursive: true });
  let first = input;
  if (opts.noAnims || opts.pad || opts.reduce) {
    // a pass over the source before the CLI steps: opts.noAnims drops the file's animation clips, opts.pad and
    // opts.reduce above (padding first: it maps the islands with the full-detail UVs)
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
    const doc = await io.read(input);
    if (opts.noAnims) for (const a of doc.getRoot().listAnimations()) a.dispose();
    if (opts.pad) await pad(doc);
    if (opts.reduce) await reduce(doc, opts.reduce);
    await io.write(tmp, doc);
    first = tmp;
  }
  cli('metalrough', first, tmp);
  cli('resize', tmp, tmp, '--width', String(size), '--height', String(size));
  cli('webp', tmp, tmp, '--quality', '88');
  cli('prune', tmp, tmp, '--keep-leaves', 'true', '--keep-attributes', 'true'); // leaves = marker empties
  // opts.simplify: keep about this share of the triangles (meshoptimizer; skin weights ride along on the kept vertices)
  if (opts.simplify) cli('simplify', tmp, tmp, '--ratio', String(opts.simplify), '--error', '0.0008');
  if (opts.meshopt === false) renameSync(tmp, output);
  else {
    cli('meshopt', tmp, output, '--level', 'medium');
    rmSync(tmp);
  }
  const kb = (f) => Math.round(statSync(f).size / 1024);
  console.log(`${out.padEnd(26)} ${String(kb(input)).padStart(6)} KB -> ${String(kb(output)).padStart(5)} KB`);
}
