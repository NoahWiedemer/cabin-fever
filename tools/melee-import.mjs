// First-person melee weapons from the user's models (assets/source/<key>.glb: AI scans, long axis on Y), normalized
// into the melee contract that player/gltfGuns.js reads (MELEE specs): meters; the handle along -Z with the head at -Z;
// the striking side down (-Y), like the machete's blade space; origin at the web of the top hand; marker nodes
// <key>_web / _rightHand / _leftHand (the second hand on a two-handed one) / _muzzle (the striking point) /
// _ejectPort / _rearSight (unused, at the striking point). Seam-aware simplification to `tris`. Writes
// assets/source/<key>_raw.glb; then `node tools/optimize-assets.mjs weapons/<key>` as for the guns.
//   node tools/melee-import.mjs          # all
//   node tools/melee-import.mjs bat      # one
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';

const SRC = 'assets/source';

// Points in the model's own units. `axes`: model (x, y, z) -> target (x, y, z) (a proper rotation).
export const MELEE = {
  // the head at +Y: a long bearded blade toward -X (its edge ~x -0.51), the spike toward +X; the handle is chunky
  // (paracord) and a little curved, x ~0.1 along its length
  tomahawk: {
    src: 'tomahawk.glb', prefix: 'tomahawk', length: 0.48, tris: 40000, material: 'tomahawk_blade',
    axes: (x, y, z) => [-z, x, -y], // +Y (head) -> -Z, -X (edge) -> -Y
    web: [0.105, -0.555, 0], right: [0.094, -0.714, 0], left: null, strike: [-0.51, 0.64, 0],
  },
  // round: the knob at -Y, the barrel toward +Y (thickest ~y 0.4); two hands, the left one by the knob
  bat: {
    src: 'bat.glb', prefix: 'bat', length: 0.84, tris: 0, material: 'bat_wood',
    axes: (x, y, z) => [x, z, -y], // +Y (barrel) -> -Z
    web: [0, -0.502, 0], right: [0, -0.593, 0], left: [0, -0.798, 0], strike: [0, 0.616, 0],
  },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
await MeshoptSimplifier.ready;
const only = process.argv[2];

for (const [key, M] of Object.entries(MELEE)) {
  if (only && key !== only) continue;
  const doc = await io.read(`${SRC}/${M.src}`);
  const root = doc.getRoot();
  // model units -> meters, around the web
  let y0 = Infinity, y1 = -Infinity;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION').getArray();
    for (let i = 1; i < a.length; i += 3) (y0 = Math.min(y0, a[i])), (y1 = Math.max(y1, a[i]));
  }
  const s = M.length / (y1 - y0);
  const to = (p) => M.axes(...p.map((v, i) => (v - M.web[i]) * s));
  // the rotation as a matrix (columns = where the model's axes go), scaled, after moving the web to the origin
  const cx = M.axes(1, 0, 0), cy = M.axes(0, 1, 0), cz = M.axes(0, 0, 1);
  const t = to([0, 0, 0]);
  const mat = [cx[0] * s, cx[1] * s, cx[2] * s, 0, cy[0] * s, cy[1] * s, cy[2] * s, 0, cz[0] * s, cz[1] * s, cz[2] * s, 0, t[0], t[1], t[2], 1];
  for (const mesh of root.listMeshes()) transformMesh(mesh, mat);
  for (const m of root.listMaterials()) m.setName(M.material);
  await doc.transform(weld());
  if (M.tris) {
    let n = 0;
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) n += p.getIndices().getCount() / 3;
    if (n > M.tris) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: M.tris / n, error: 0.0015 }));
  }
  // the scene: one root node over the mesh node(s) and the markers
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  const top = doc.createNode(key.toUpperCase());
  for (const n of scene.listChildren()) {
    scene.removeChild(n);
    n.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
    top.addChild(n);
  }
  const marks = { web: M.web, rightHand: M.right, leftHand: M.left ?? M.right, muzzle: M.strike, ejectPort: M.strike, rearSight: M.strike };
  for (const [name, p] of Object.entries(marks)) top.addChild(doc.createNode(`${M.prefix}_${name}`).setTranslation(to(p)));
  scene.addChild(top);
  for (const a of root.listAnimations()) a.dispose();
  const out = `${SRC}/${key}_raw.glb`;
  await io.write(out, doc);
  let tris = 0;
  for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) tris += p.getIndices().getCount() / 3;
  console.log(`${key}: ${out}, ${tris} tris, scale ${s.toFixed(4)}, ` + Object.entries(marks).map(([k, p]) => `${k} ${to(p).map((v) => v.toFixed(3)).join(',')}`).join(' | '));
}
void Document;
