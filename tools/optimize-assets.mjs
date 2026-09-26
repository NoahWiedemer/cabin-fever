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

// [source, output, max texture size, opts?]
export const ASSETS = [
  ['coach_l4d2_with_rigging.glb', 'characters/coach.glb', 1024],
  ['ellis_l4d2.glb', 'characters/ellis.glb', 1024],
  ['fat_zombie.glb', 'zombies/boomer.glb', 1024], // Meshy "Fat Zombie" (Meshy biped rig, joints mapped by name): the Boomer (replaced the L4D2 one)
  ['striker.glb', 'zombies/bomber.glb', 1024], // UniRig gas-mask bomber: the Striker body (drops 3 charges on death)
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
  cli('metalrough', input, tmp);
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
