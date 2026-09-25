// Repairs the auto-rig (UniRig) skin weights of assets/source/Viper.glb.
//
// In the bind pose Viper's hands hang right beside her thighs, and the auto-rigger bled forearm / hand /
// finger weights onto the back and outer side of both thighs (a few vertices there were even >90 % hand).
// Whenever an arm moved, that patch of thigh was dragged along with the hand. This script:
//   1. maps the skeleton by topology (legs = chains to the lowest leaves, arms = chains to the most lateral
//      leaves; same idea as the runtime mapper in src/actors/gltfCharacter.js),
//   2. labels every vertex "arm" or "leg" by geodesic distance over the welded mesh surface (nearest palm vs.
//      nearest knee): the surface path from a hand to its thigh runs up through the armpit, so the two are
//      far apart even where they touch in space,
//   3. strips forearm / hand / finger influences from leg vertices (and pelvis / leg influences from arm
//      vertices, the reverse case), fills the stripped share from the surrounding clean weights (harmonic
//      blend, so the thigh / pelvis / shin mix stays smooth) and renormalizes.
// Skeleton, bone names, materials, textures and all other vertices stay untouched; influences stay sorted
// by weight, so three.js (which reads only JOINTS_0 / WEIGHTS_0) gets the 4 strongest.
//
//   node tools/fix-viper-weights.mjs          # reads Viper_orig.glb (backs up Viper.glb on first run), writes Viper.glb
//   node tools/fix-viper-weights.mjs --dry    # report only
// then: node tools/optimize-assets.mjs viper
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { copyFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';

const SRC = 'assets/source/Viper.glb';
const ORIG = 'assets/source/Viper_orig.glb';
const dry = process.argv.includes('--dry');

if (!existsSync(ORIG) && !dry) {
  copyFileSync(SRC, ORIG);
  console.log(`backup: ${SRC} -> ${ORIG}`);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(existsSync(ORIG) ? ORIG : SRC);
const root = doc.getRoot();
const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
if (!meshNode) throw new Error('no skinned mesh');
const skin = meshNode.getSkin();
const joints = skin.listJoints();
const jointIndex = new Map(joints.map((j, i) => [j, i]));

// ---- skeleton by topology (rest positions in world space)
const JP = joints.map((j) => new THREE.Vector3().fromArray(j.getWorldMatrix(), 12));
const kids = (i) => joints[i].listChildren().filter((c) => jointIndex.has(c)).map((c) => jointIndex.get(c));
const parent = (i) => {
  const p = joints[i].getParentNode();
  return p && jointIndex.has(p) ? jointIndex.get(p) : -1;
};
const path = (i) => {
  const out = [];
  for (let p = i; p >= 0; p = parent(p)) out.unshift(p);
  return out;
};
const common = (a, b) => {
  const pa = path(a), pb = path(b);
  let c = -1;
  for (let k = 0; k < Math.min(pa.length, pb.length) && pa[k] === pb[k]; k++) c = pa[k];
  if (c < 0) throw new Error('disjoint skeleton');
  return c;
};
const below = (anc, i) => {
  const p = path(i);
  return p.slice(p.indexOf(anc) + 1);
};
const subtree = (i) => [i, ...kids(i).flatMap(subtree)];
const leaves = joints.map((_, i) => i).filter((i) => !kids(i).length);
const lo = Math.min(...JP.map((p) => p.y)), hi = Math.max(...JP.map((p) => p.y)), H = hi - lo;

const legBones = new Set(), armLow = new Set(), knees = [], palms = [];
const lowest = (sx) => leaves.filter((i) => JP[i].x * sx > 0).sort((a, b) => JP[a].y - JP[b].y)[0];
const legRoot = common(lowest(1), lowest(-1));
for (const sx of [1, -1]) {
  const c = below(legRoot, lowest(sx));
  const fi = c.findIndex((i) => JP[i].y < lo + 0.12 * H);
  if (fi < 2) throw new Error('leg chain');
  const mid = (JP[c[0]].y + JP[c[fi]].y) / 2;
  knees.push(c.slice(1, fi).sort((a, b) => Math.abs(JP[a].y - mid) - Math.abs(JP[b].y - mid))[0]);
  subtree(c[0]).forEach((i) => legBones.add(i));
}
path(legRoot).forEach((i) => legBones.add(i)); // pelvis: never drives a hand
const tip = (sx) => leaves.filter((i) => JP[i].y > lo + 0.35 * H).sort((a, b) => (JP[b].x - JP[a].x) * sx)[0];
const chestRoot = common(tip(1), tip(-1));
for (const sx of [1, -1]) {
  const c = below(chestRoot, tip(sx));
  let k = 0;
  if (Math.abs(JP[c[0]].x - JP[chestRoot].x) < 0.045 * H) k++; // clavicle
  const far = (from, s) => c.findIndex((i, j) => j >= s && JP[i].distanceTo(JP[c[from]]) > 0.09 * H);
  const fore = far(k, k + 1), hand = fore < 0 ? -1 : far(fore, fore + 1);
  if (hand < 0) throw new Error('arm chain');
  subtree(c[fore]).forEach((i) => armLow.add(i)); // forearm, hand, palm, fingers
  let palm = c[hand];
  while (kids(palm).length === 1) palm = kids(palm)[0];
  palms.push(palm);
}
const nm = (i) => joints[i].getName();
console.log('knees', knees.map(nm).join(' '), '· palms', palms.map(nm).join(' '), `· ${armLow.size} forearm/hand/finger bones · ${legBones.size} pelvis/leg bones`);

// ---- mesh: skinned rest positions, influences, welded surface graph
const prim = meshNode.getMesh().listPrimitives()[0];
const posA = prim.getAttribute('POSITION');
const sets = [];
for (let k = 0; prim.getAttribute('JOINTS_' + k); k++) sets.push([prim.getAttribute('JOINTS_' + k), prim.getAttribute('WEIGHTS_' + k)]);
const n = posA.getCount();
const ibm = skin.getInverseBindMatrices();
const S = joints.map((j, i) => new THREE.Matrix4().fromArray(j.getWorldMatrix()).multiply(new THREE.Matrix4().fromArray(ibm.getElement(i, []))));
const tmp = [], tw = [];
const influences = (i) => {
  const m = new Map();
  for (const [J, W] of sets) {
    J.getElement(i, tmp);
    W.getElement(i, tw);
    for (let c = 0; c < 4; c++) if (tw[c] > 0) m.set(tmp[c], (m.get(tmp[c]) ?? 0) + tw[c]);
  }
  return m;
};
const P = [], v = new THREE.Vector3(), t = new THREE.Vector3();
for (let i = 0; i < n; i++) {
  v.fromArray(posA.getElement(i, []));
  const acc = new THREE.Vector3();
  let ws = 0;
  for (const [j, w] of influences(i)) {
    acc.addScaledVector(t.copy(v).applyMatrix4(S[j]), w);
    ws += w;
  }
  P.push(acc.divideScalar(ws || 1));
}
// weld UV-seam duplicates (they carry identical weights)
const rep = new Int32Array(n);
const byKey = new Map();
for (let i = 0; i < n; i++) {
  const key = P[i].toArray().map((x) => Math.round(x * 1e5)).join(',');
  if (!byKey.has(key)) byKey.set(key, i);
  rep[i] = byKey.get(key);
}
const verts = [...byKey.values()];
const adj = new Map(verts.map((i) => [i, new Map()]));
const idx = prim.getIndices().getArray();
const link = (a, b) => {
  a = rep[a];
  b = rep[b];
  if (a === b) return;
  const d = P[a].distanceTo(P[b]);
  adj.get(a).set(b, d);
  adj.get(b).set(a, d);
};
for (let k = 0; k < idx.length; k += 3) {
  link(idx[k], idx[k + 1]);
  link(idx[k + 1], idx[k + 2]);
  link(idx[k + 2], idx[k]);
}

function geodesic(seeds) {
  const D = new Map(), heap = [];
  const push = (e) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  for (const s of seeds) {
    D.set(s, 0);
    push([0, s]);
  }
  while (heap.length) {
    const [d, u] = pop();
    if (d > D.get(u)) continue;
    for (const [w, e] of adj.get(u)) {
      if (d + e < (D.get(w) ?? Infinity)) {
        D.set(w, d + e);
        push([d + e, w]);
      }
    }
  }
  return D;
}
const seedsNear = (bones, r) => verts.filter((i) => bones.some((b) => P[i].distanceTo(JP[b]) < r));
const dPalm = geodesic(seedsNear(palms, 0.018 * H));
const dKnee = geodesic(seedsNear(knees, 0.06 * H));

// ---- strip + fill
const W0 = new Map(verts.map((i) => [i, influences(i)]));
const forbidden = new Map(); // welded vertex -> Set of joints it must not use
const frac = new Map(); // share of its weight that was forbidden
const stats = { legVerts: 0, armVerts: 0, cut: {}, maxCut: 0, box: new THREE.Box3() };
for (const i of verts) {
  const dp = dPalm.get(i) ?? Infinity, dk = dKnee.get(i) ?? Infinity;
  // leg side of the palm / knee divide: pelvis, buttocks, legs (and the waist, which no forearm drives
  // either). Arm side: only the hand and forearm, so the chest keeps whatever pelvis weight it has.
  const arm = dp < dk;
  if (arm && dp > 0.25 * H) continue;
  const bad = arm ? legBones : armLow;
  let f = 0;
  for (const [j, w] of W0.get(i)) if (bad.has(j)) f += w;
  if (f <= 0) continue;
  forbidden.set(i, bad);
  frac.set(i, Math.min(1, f));
  arm ? stats.armVerts++ : stats.legVerts++;
  stats.box.expandByPoint(P[i]);
  stats.maxCut = Math.max(stats.maxCut, f);
  for (const [j, w] of W0.get(i)) if (bad.has(j)) stats.cut[nm(j)] = (stats.cut[nm(j)] ?? 0) + 1;
}
const strip = (m, bad) => {
  const out = new Map();
  let s = 0;
  for (const [j, w] of m) if (!bad.has(j)) out.set(j, w), (s += w);
  if (s > 0) for (const [j, w] of out) out.set(j, w / s);
  return out;
};
// x = (1 - f) * own clean weights + f * mean of the neighbours: vertices that were mostly arm take their
// weights from the surrounding thigh / pelvis, lightly touched ones keep their own mix (Gauss-Seidel)
const own = new Map([...forbidden].map(([i, bad]) => [i, strip(W0.get(i), bad)]));
const X = new Map(own);
const weightsOf = (i) => X.get(i) ?? W0.get(i);
for (let it = 0; it < 300; it++) {
  for (const [i, bad] of forbidden) {
    const f = frac.get(i), avg = new Map();
    let cnt = 0;
    for (const nb of adj.get(i).keys()) {
      cnt++;
      for (const [j, w] of weightsOf(nb)) if (!bad.has(j)) avg.set(j, (avg.get(j) ?? 0) + w);
    }
    const next = new Map();
    for (const [j, w] of own.get(i)) next.set(j, (1 - f) * w);
    if (cnt) for (const [j, w] of avg) next.set(j, (next.get(j) ?? 0) + (f * w) / cnt);
    X.set(i, strip(next, bad));
  }
}

// ---- write back: all duplicates of a welded vertex, influences sorted by weight, tiny ones dropped
const slots = sets.length * 4;
let changed = 0;
for (let i = 0; i < n; i++) {
  const r = rep[i];
  if (!forbidden.has(r)) continue;
  const bad = forbidden.get(r);
  let list = [...X.get(r)].filter(([j, w]) => !bad.has(j) && w > 1e-3).sort((a, b) => b[1] - a[1]).slice(0, slots);
  if (!list.length) throw new Error(`vertex ${i}: no weights left`);
  const s = list.reduce((a, b) => a + b[1], 0);
  list = list.map(([j, w]) => [j, w / s]);
  sets.forEach(([J, W], k) => {
    const jj = [0, 0, 0, 0], ww = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const e = list[k * 4 + c];
      if (e) [jj[c], ww[c]] = e;
    }
    J.setElement(i, jj);
    W.setElement(i, ww);
  });
  changed++;
}

console.log(`leg vertices with forearm/hand/finger weight: ${stats.legVerts} · arm vertices with pelvis/leg weight: ${stats.armVerts} (welded)`);
console.log(`largest stripped share ${(stats.maxCut * 100).toFixed(0)} % · ${changed} vertex records rewritten`);
console.log('affected region (bind pose, m):', ['min', 'max'].map((k) => stats.box[k].toArray().map((x) => x.toFixed(2)).join(' ')).join(' .. '));
console.log('stripped influences per bone:', Object.entries(stats.cut).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k}×${c}`).join(' '));
if (dry) console.log('--dry: nothing written');
else {
  await io.write(SRC, doc);
  console.log(`wrote ${SRC}`);
}
