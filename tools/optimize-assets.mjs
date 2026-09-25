// Converts the source GLBs in assets/source into web-ready files under public/models:
// spec/gloss -> metal/rough, textures resized + WebP, meshopt geometry compression.
// Hierarchy is left intact (bone and node names are looked up at runtime).
//   node tools/optimize-assets.mjs            # all
//   node tools/optimize-assets.mjs smoker     # only outputs whose name contains "smoker"
import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, rmSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SRC = 'assets/source';
const OUT = 'public/models';

// [source, output, max texture size]
export const ASSETS = [
  ['coach_l4d2_with_rigging.glb', 'characters/coach.glb', 1024],
  ['ellis_l4d2.glb', 'characters/ellis.glb', 1024],
  ['left_4_dead_2_-_boomer_with_rig.glb', 'zombies/boomer.glb', 1024],
  ['striker.glb', 'zombies/bomber.glb', 1024], // UniRig gas-mask bomber: the Striker body (drops 3 charges on death)
  ['zombie_woman.glb', 'zombies/woman.glb', 1024], // UniRig zombie woman: replaced the procedural Mauler bodies
  ['tank.glb', 'zombies/tank.glb', 1024], // UniRig blue tank: the Crusher boss body
  ['zombie.glb', 'zombies/smoker.glb', 1024], // UniRig zombie (replaced the L4D2 smoker), bones mapped by topology
  ['gasmask_zombie.glb', 'zombies/gasmask.glb', 1024], // UniRig gas-mask zombie: a Mauler body variant (weights: fix-viper-weights)
  ['biter.glb', 'zombies/biter.glb', 1024], // UniRig "smallbiterzombie" kid: the Biter (weights: fix-viper-weights)
  ['left_4_dead_2_-_charger_with_rig.glb', 'zombies/charger.glb', 1024],
  ['Mutant_dog.glb', 'zombies/dog.glb', 1024], // UniRig quadruped, bones mapped by topology
  ['Meshy_AI_Character_output.glb', 'characters/meshy.glb', 1024], // UniRig skeleton, bones mapped by topology
  ['Viper.glb', 'characters/viper.glb', 1024], // UniRig skeleton, bones mapped by topology
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
  // first-person arms (tools/blender/arms.py)
  ['arms_raw.glb', 'arms/arms.glb', 1024, { meshopt: false }], // skinned: keep float positions (UVs are projected at runtime)
];

const cli = (...args) => execFileSync('npx', ['gltf-transform', ...args], { stdio: 'pipe' });
const filter = process.argv[2];

for (const [src, out, size, opts = {}] of ASSETS) {
  if (filter && !out.includes(filter)) continue;
  const input = join(SRC, src);
  const output = join(OUT, out);
  const tmp = output.replace(/\.glb$/, '.tmp.glb');
  mkdirSync(dirname(output), { recursive: true });
  cli('metalrough', input, tmp);
  cli('resize', tmp, tmp, '--width', String(size), '--height', String(size));
  cli('webp', tmp, tmp, '--quality', '88');
  cli('prune', tmp, tmp, '--keep-leaves', 'true', '--keep-attributes', 'true'); // leaves = marker empties
  if (opts.meshopt === false) renameSync(tmp, output);
  else {
    cli('meshopt', tmp, output, '--level', 'medium');
    rmSync(tmp);
  }
  const kb = (f) => Math.round(statSync(f).size / 1024);
  console.log(`${out.padEnd(26)} ${String(kb(input)).padStart(6)} KB -> ${String(kb(output)).padStart(5)} KB`);
}
