// Rigged GLB characters (L4D2 survivors + infected, Meshy / auto-rigged infected) driven by the
// procedural animation code. Joints are found by name (Valve Bip01, Mixamo, Meshy; the models rigged
// with tools/blender/autorig.py carry Mixamo names) or, for UniRig's numbered joints, by topology.
// Each instance gets a proxy skeleton with rig.js's bone names and axes. The proxies' identity rest
// pose is the model's "canonical" pose (limbs straight down, feet flat on the ground, facing +Z), so
// zombie.js / teammate.js animate them exactly like procedural bones. sync() then retargets onto
// the GLB joints: local = inv(C_parent) * proxyLocal * C_joint (two quaternion muls per joint).
// Unmapped joints (spine twists, fingers, Valve helpers) keep their canonical local transform.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { Jiggle } from './jiggle.js';

export const HIP_Y = 0.98; // procedural hip height the animation code writes around

// proxy bones: same names / parents as rig.js BONES
const PROXY = [
  ['hips', null], ['spine', 'hips'], ['chest', 'spine'], ['neck', 'chest'], ['head', 'neck'],
  ['shoulderL', 'chest'], ['upperArmL', 'shoulderL'], ['foreArmL', 'upperArmL'], ['handL', 'foreArmL'],
  ['shoulderR', 'chest'], ['upperArmR', 'shoulderR'], ['foreArmR', 'upperArmR'], ['handR', 'foreArmR'],
  ['thighL', 'hips'], ['shinL', 'thighL'], ['footL', 'shinL'],
  ['thighR', 'hips'], ['shinR', 'thighR'], ['footR', 'shinR'],
];
const PROXY_PARENT = Object.fromEntries(PROXY);

// joint names after normName() (separators, prefixes and numeric suffixes stripped)
const RIGS = {
  valve: {
    hips: 'bip01pelvis', spine: 'bip01spine', chest: 'bip01spine2', neck: 'bip01neck1', head: 'bip01head1',
    shoulderL: 'bip01lclavicle', upperArmL: 'bip01lupperarm', foreArmL: 'bip01lforearm', handL: 'bip01lhand',
    shoulderR: 'bip01rclavicle', upperArmR: 'bip01rupperarm', foreArmR: 'bip01rforearm', handR: 'bip01rhand',
    thighL: 'bip01lthigh', shinL: 'bip01lcalf', footL: 'bip01lfoot', toeL: 'bip01ltoe0',
    thighR: 'bip01rthigh', shinR: 'bip01rcalf', footR: 'bip01rfoot', toeR: 'bip01rtoe0',
  },
  mixamo: {
    hips: 'hips', spine: 'spine', chest: 'spine2', neck: 'neck', head: 'head',
    shoulderL: 'leftshoulder', upperArmL: 'leftarm', foreArmL: 'leftforearm', handL: 'lefthand',
    shoulderR: 'rightshoulder', upperArmR: 'rightarm', foreArmR: 'rightforearm', handR: 'righthand',
    thighL: 'leftupleg', shinL: 'leftleg', footL: 'leftfoot', toeL: 'lefttoebase',
    thighR: 'rightupleg', shinR: 'rightleg', footR: 'rightfoot', toeR: 'righttoebase',
  },
  // Meshy's biped rig: Mixamo-like names, but the spine counts down from the neck (Hips → Spine02 → Spine01 → Spine)
  meshy: {
    hips: 'hips', spine: 'spine02', chest: 'spine', neck: 'neck', head: 'head',
    shoulderL: 'leftshoulder', upperArmL: 'leftarm', foreArmL: 'leftforearm', handL: 'lefthand',
    shoulderR: 'rightshoulder', upperArmR: 'rightarm', foreArmR: 'rightforearm', handR: 'righthand',
    thighL: 'leftupleg', shinL: 'leftleg', footL: 'leftfoot', toeL: 'lefttoebase',
    thighR: 'rightupleg', shinR: 'rightleg', footR: 'rightfoot', toeR: 'righttoebase',
  },
};

// kind -> model + sizing. height in meters; armSpread tilts the canonical arms away from the body.
// Valve / Mixamo / Meshy skeletons are mapped by joint name, anything else (the `meshy` body: UniRig "Bone_NNN")
// by topology.
export const GLB_BODIES = {
  coach: { url: MODELS.coach, height: 1.84, armSpread: 0.16, fallback: 'soldier' },
  ellis: { url: MODELS.ellis, height: 1.79, armSpread: 0.12, fallback: 'soldier2' },
  meshy: { url: MODELS.meshy, height: 1.78, armSpread: 0.12, fallback: 'soldier' },
  // bust: breast region enlarged by `enlarge` and re-skinned to two spring-driven jiggle bones (jiggle.js)
  viper: { url: MODELS.viper, height: 1.72, armSpread: 0.12, fallback: 'soldier2', bust: { enlarge: 0.3 } },
  // UniRig zombie (assets/source/zombie.glb) in the smoker slot: a bit taller than a survivor
  smoker: { url: MODELS.smoker, height: 1.86, armSpread: 0.12, fallback: 'mauler2' },
  // UniRig zombie in a gas mask and fatigues: another Mauler body
  gasmask: { url: MODELS.gasmask, height: 1.78, armSpread: 0.12, fallback: 'mauler' },
  // the Biter: a feral kid (UniRig, modeled hunched; its canonical pose straightens it, biter.js crouches it again)
  biter: { url: MODELS.biter, height: 1.1, armSpread: 0.16, fallback: 'mauler2' },
  // the Stalker: a gaunt UniRig mutant, taller than a survivor (actors/stalker.js hunches it)
  stalker: { url: MODELS.stalker, height: 1.95, armSpread: 0.12, fallback: 'mauler2' },
  // the Crusher boss (zombie type scale 1.4 on top): heavy UniRig tank, arms held clear of the gut
  // the Striker: gas-mask bomber that scatters three charges when it dies
  bomber: { url: MODELS.bomber, height: 1.76, armSpread: 0.14, fallback: 'striker' },
  // zombie woman in the Mauler rotation (replaced the procedural mauler / mauler2 bodies)
  woman: { url: MODELS.woman, height: 1.68, armSpread: 0.12, fallback: 'mauler2' },
  // auto-rigged (tools/blender/autorig.py: Mixamo joint names): a plain zombie in the Mauler rotation, the Worker in
  // a hard hat, the Survivalist with a big pack
  normal: { url: MODELS.normal, height: 1.8, armSpread: 0.1, fallback: 'mauler' },
  worker: { url: MODELS.worker, height: 1.82, armSpread: 0.12, fallback: 'mauler' },
  survivor: { url: MODELS.survivor, height: 1.82, armSpread: 0.14, fallback: 'mauler2' },
  // glow: its own materials with an emissive skin, lit up while it rages (crusher.js)
  tank: { url: MODELS.tank, height: 1.8, armSpread: 0.3, fallback: 'crusher', glow: 0x3a7cff },
  // the Boomer (Meshy "Fat Zombie"): glow = its skin going livid, blood showing through, as it swells to burst (zombie.js)
  boomer: { url: MODELS.boomer, height: 1.8, armSpread: 0.42, fallback: 'charger', belly: true, glow: 0xc8242c },
  // quadruped: sized by body length (nose to tail); no procedural dog exists, so the fallback is a mauler body
  dog: { url: MODELS.dog, quad: true, length: 1.3, fallback: 'mauler' },
  // gun shop clerk (actors/shopkeeper.js): never a bot or a target
  shopkeeper: { url: MODELS.shopkeeper, height: 1.76, armSpread: 0.1, fallback: 'soldier' },
  // lab tech behind the basement's armored glass (actors/labTech.js): never a bot or a target
  nadja: { url: MODELS.nadja, height: 1.7, armSpread: 0.1, fallback: 'soldier' },
};
// finger curl per joint (rad): a rifle grip for the survivors, a loose claw for the infected
const CURL = { coach: 0.5, ellis: 0.5, meshy: 0.45, viper: 0.45, smoker: 0.3, boomer: 0.3, woman: 0.3, tank: 0.35, bomber: 0.3, gasmask: 0.3, biter: 0.4, stalker: 0.5, normal: 0.3, worker: 0.3, survivor: 0.3, shopkeeper: 0.28, nadja: 0.3 };

const normName = (n) => n.replace(/(_\d+)+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase().replace(/^(valvebiped|mixamorig)/, '');

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _dq = new THREE.Quaternion();
const _v4 = new THREE.Vector4();
const _w4 = new THREE.Vector4();

function setWorldQuat(bone, q) {
  bone.parent.getWorldQuaternion(_pq);
  bone.quaternion.copy(_pq.invert().multiply(q));
}

/** rotate `bone` (in world space, minimal arc) so the direction to `child` becomes `dir` */
function aimBone(bone, child, dir) {
  bone.getWorldPosition(_a);
  child.getWorldPosition(_b).sub(_a).normalize();
  _dq.setFromUnitVectors(_b, dir);
  bone.getWorldQuaternion(_q);
  setWorldQuat(bone, _dq.multiply(_q));
}

/** Skinned vertex positions in holder space: overall box + a box per driving proxy key (+ head points). */
function skinnedBounds(holder, meshes, keyOf) {
  holder.updateMatrixWorld(true);
  const all = new THREE.Box3();
  const per = {};
  const headPts = [];
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const pos = m.geometry.attributes.position;
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      all.expandByPoint(v);
      if (!keyOf) continue;
      _v4.fromBufferAttribute(si, i);
      _w4.fromBufferAttribute(sw, i);
      let best = 0;
      for (let c = 1; c < 4; c++) if (_w4.getComponent(c) > _w4.getComponent(best)) best = c;
      const key = keyOf.get(m.skeleton.bones[_v4.getComponent(best)]) ?? 'hips';
      (per[key] ??= new THREE.Box3()).expandByPoint(v);
      if (key === 'head') headPts.push(v.clone());
    }
  }
  return { all, per, headPts };
}

const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
/** named finger chains (base → tip) of one hand: { chains: [[b0, b1, b2], ...], thumb } */
function namedFingers(byNorm, valve, s) {
  const out = { chains: [], thumb: null };
  FINGERS.forEach((nm, n) => {
    const chain = [];
    for (let j = 0; j < 3; j++) {
      const b = byNorm.get(valve ? `bip01${s}finger${n}${j || ''}` : `${s === 'l' ? 'left' : 'right'}hand${nm}${j + 1}`);
      if (b) chain.push(b);
    }
    if (!chain.length) return;
    out.chains.push(chain);
    if (nm === 'thumb') out.thumb = chain;
  });
  return out;
}

function namedRig(byNorm) {
  const rig = byNorm.has('bip01pelvis') ? RIGS.valve : byNorm.has('spine02') ? RIGS.meshy : byNorm.has('hips') ? RIGS.mixamo : null;
  if (!rig) return null;
  const J = {};
  for (const k in rig) {
    J[k] = byNorm.get(rig[k]);
    if (!J[k]) throw new Error('missing joint ' + rig[k]);
  }
  const valve = rig === RIGS.valve;
  return { J, fingers: { L: namedFingers(byNorm, valve, 'l'), R: namedFingers(byNorm, valve, 'r') } };
}

/**
 * Map an unnamed skeleton (e.g. UniRig "Bone_NNN") from topology + rest positions. Turns the model to
 * face +Z first, then: feet = lowest leaf per side (x sign), legs branch at their common ancestor;
 * hands = most lateral leaves, arms branch at the chest; head = the upward chain's most-weighted bone.
 * Keys the skeleton lacks (neck, clavicles, spine) stay null and become virtual proxies.
 */
/** Rest-pose skeleton queries shared by the topology mappers (positions in holder space). */
function skeletonTools(holder, meshes) {
  const bones = [...new Set(meshes.flatMap((m) => m.skeleton.bones))];
  const set = new Set(bones);
  const T = {
    bones,
    P: new Map(),
    lo: 0,
    hi: 0,
    kids: (b) => b.children.filter((c) => set.has(c)),
    y: (b) => T.P.get(b).y,
    measure() {
      holder.updateMatrixWorld(true);
      T.lo = Infinity;
      T.hi = -Infinity;
      for (const b of bones) {
        const p = b.getWorldPosition(new THREE.Vector3());
        T.P.set(b, p);
        T.lo = Math.min(T.lo, p.y);
        T.hi = Math.max(T.hi, p.y);
      }
    },
    path(b) {
      const out = [];
      for (let p = b; p && set.has(p); p = p.parent) out.unshift(p);
      return out;
    },
    common(a, b) {
      const pa = T.path(a), pb = T.path(b);
      let c = null;
      for (let i = 0; i < Math.min(pa.length, pb.length) && pa[i] === pb[i]; i++) c = pa[i];
      if (!c) throw new Error('disjoint skeleton');
      return c;
    },
    below(anc, b) {
      const p = T.path(b);
      return p.slice(p.indexOf(anc) + 1);
    },
  };
  T.leaves = bones.filter((b) => !T.kids(b).length);
  T.measure();
  return T;
}

function topologyRig(holder, model, meshes) {
  const T = skeletonTools(holder, meshes);
  const { P, y, kids, path, common, below, leaves } = T;
  const lowest = (sx) => leaves.filter((b) => P.get(b).x * sx > 0).sort((a, b) => y(a) - y(b))[0];
  // face +Z: toes ahead of the feet (foot = the first joint of the leg chain near the floor, toe = the next
  // one; the Biter's tip joint curls back up behind its toe, so the leaf alone can point the wrong way)
  let toeL = lowest(1), toeR = lowest(-1);
  if (!toeL || !toeR) throw new Error('no legs');
  const toeAhead = (t) => {
    const c = below(common(toeL, toeR), t);
    const fi = c.findIndex((b) => y(b) < T.lo + 0.12 * (T.hi - T.lo));
    return fi >= 0 && c[fi + 1] ? P.get(c[fi + 1]).z - P.get(c[fi]).z : P.get(t).z - P.get(t.parent).z;
  };
  if (toeAhead(toeL) + toeAhead(toeR) < 0) {
    model.rotation.y = Math.PI;
    T.measure();
    [toeL, toeR] = [lowest(1), lowest(-1)];
  }
  const lo = T.lo, hi = T.hi;
  const H = hi - lo;
  const J = {};
  // legs: thigh = first bone below the branch, foot = first near the floor, shin = the one halfway between
  const legRoot = common(toeL, toeR);
  for (const [s, toe] of [['L', toeL], ['R', toeR]]) {
    const c = below(legRoot, toe);
    const fi = c.findIndex((b) => y(b) < lo + 0.12 * H);
    if (fi < 2) throw new Error('leg chain');
    const mid = (y(c[0]) + y(c[fi])) / 2;
    J['thigh' + s] = c[0];
    J['shin' + s] = c.slice(1, fi).sort((a, b) => Math.abs(y(a) - mid) - Math.abs(y(b) - mid))[0];
    J['foot' + s] = c[fi];
    J['toe' + s] = c[fi + 1] ?? toe;
  }
  // arms: from the chest (common ancestor of both hands) out to the most lateral leaf on each side
  const tip = (sx) => leaves.filter((b) => y(b) > lo + 0.35 * H).sort((a, b) => (P.get(b).x - P.get(a).x) * sx)[0];
  const tipL = tip(1), tipR = tip(-1);
  const chestRoot = common(tipL, tipR);
  const fingers = {};
  // clavicles: decided for both sides at once (the Biter's right one sits a little further out than its left)
  const hasClav = [tipL, tipR].some((t) => Math.abs(P.get(below(chestRoot, t)[0]).x - P.get(chestRoot).x) < 0.045 * H);
  for (const [s, t] of [['L', tipL], ['R', tipR]]) {
    const c = below(chestRoot, t);
    let i = 0;
    const clav = hasClav ? c[i++] : null;
    const far = (from, k) => c.findIndex((b, j) => j >= k && P.get(b).distanceTo(P.get(c[from])) > 0.09 * H);
    const fi = far(i, i + 1), hi2 = fi < 0 ? -1 : far(fi, fi + 1);
    if (hi2 < 0) throw new Error('arm chain');
    J['shoulder' + s] = clav;
    J['upperArm' + s] = c[i];
    J['foreArm' + s] = c[fi];
    J['hand' + s] = c[hi2];
    // fingers: the first bone from the hand on that branches 3+ ways; each branch is one finger
    let palm = c[hi2];
    while (palm && kids(palm).length === 1) palm = kids(palm)[0];
    const chains = [];
    for (const f of palm && kids(palm).length >= 3 ? kids(palm) : []) {
      const ch = [];
      for (let b = f; b; b = kids(b)[0]) ch.push(b);
      chains.push(ch);
    }
    // thumb: the finger rooted closest to the wrist
    const wrist = P.get(c[hi2]);
    const thumb = chains.slice().sort((a, b) => P.get(a[0]).distanceTo(wrist) - P.get(b[0]).distanceTo(wrist))[0] ?? null;
    fingers[s] = { chains, thumb };
  }
  // head: the upward branch of the chest; the bone driving the most vertices is the skull
  const armBones = new Set([...below(chestRoot, tipL), ...below(chestRoot, tipR)]);
  const top = (b) => Math.max(y(b), ...kids(b).map(top));
  const highest = (arr) => arr.sort((a, b) => top(b) - top(a))[0];
  const hc = [];
  for (let b = highest(kids(chestRoot).filter((k) => !armBones.has(k))); b; b = highest(kids(b))) hc.push(b);
  if (!hc.length) throw new Error('no head');
  const count = new Map();
  for (const m of meshes) {
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight;
    for (let i = 0; i < si.count; i++) {
      _v4.fromBufferAttribute(si, i);
      _w4.fromBufferAttribute(sw, i);
      let best = 0;
      for (let k = 1; k < 4; k++) if (_w4.getComponent(k) > _w4.getComponent(best)) best = k;
      const b = m.skeleton.bones[_v4.getComponent(best)];
      count.set(b, (count.get(b) ?? 0) + 1);
    }
  }
  const hi3 = hc.reduce((bi, b, i) => ((count.get(b) ?? 0) > (count.get(hc[bi]) ?? 0) ? i : bi), 0);
  J.head = hc[hi3];
  J.neck = hi3 > 0 ? hc[hi3 - 1] : null;
  // trunk: hips = first bone of the chain above the floor, spine = first above the leg branch,
  // chest = the trunk bone nearest 45% of the way from hips to shoulders
  const trunk = path(chestRoot);
  // legs usually branch off the trunk itself; some rigs (shopkeeper) hang them off a pelvis side chain
  const li = trunk.indexOf(trunk.includes(legRoot) ? legRoot : common(legRoot, chestRoot));
  if (li < 0) throw new Error('legs do not branch off the trunk');
  J.hips = trunk.slice(0, li + 1).find((b) => y(b) > lo + 0.3 * H) ?? legRoot;
  const upper = trunk.slice(li + 1);
  if (!upper.length) throw new Error('no spine');
  const want = y(J.hips) + 0.45 * (y(chestRoot) - y(J.hips));
  J.spine = upper.length > 1 ? upper[0] : null;
  J.chest = (upper.length > 1 ? upper.slice(1) : upper).sort((a, b) => Math.abs(y(a) - want) - Math.abs(y(b) - want))[0];
  return { J, fingers };
}

/**
 * Map an unnamed quadruped skeleton (e.g. the UniRig dog) from topology + rest positions: paws = the four
 * lowest leaves; they pair up along the longer horizontal axis and the pair branching deeper in the
 * hierarchy is the front. Turns the model to face +Z. Keys: root, spine, chest, neck, head, jaw,
 * tail0-2, extra0-3 (other dangling chains) and per leg (f/h + L/R) Upper, Mid, Low, Paw.
 */
function quadTopology(holder, model, meshes) {
  const T = skeletonTools(holder, meshes);
  const { P, y, kids, path, common, below } = T;
  const paws = T.leaves.slice().sort((a, b) => y(a) - y(b)).slice(0, 4);
  if (paws.length < 4 || y(paws[3]) > T.lo + 0.15 * (T.hi - T.lo)) throw new Error('need four feet');
  const spread = (c) => Math.max(...paws.map((b) => P.get(b)[c])) - Math.min(...paws.map((b) => P.get(b)[c]));
  const ax = spread('z') >= spread('x') ? 'z' : 'x';
  paws.sort((a, b) => P.get(a)[ax] - P.get(b)[ax]);
  const lowRoot = common(paws[0], paws[1]), highRoot = common(paws[2], paws[3]);
  const highFront = path(highRoot).length >= path(lowRoot).length;
  model.rotation.y = ax === 'z' ? (highFront ? 0 : Math.PI) : highFront ? -Math.PI / 2 : Math.PI / 2;
  T.measure();
  const fRoot = highFront ? highRoot : lowRoot, hRoot = highFront ? lowRoot : highRoot;
  const front = highFront ? paws.slice(2) : paws.slice(0, 2), hind = highFront ? paws.slice(0, 2) : paws.slice(2);
  const J = {};
  const used = new Set();
  for (const [pair, pre, lr] of [[front, 'f', fRoot], [hind, 'h', hRoot]]) {
    for (const paw of pair) {
      const s = P.get(paw).x >= P.get(pair[0] === paw ? pair[1] : pair[0]).x ? 'L' : 'R';
      const c = below(lr, paw);
      c.forEach((b) => used.add(b));
      // upper = the hip / shoulder joint: last bone high up the leg
      const top = y(c[0]);
      let ui = -1;
      c.forEach((b, i) => {
        if (y(b) > T.lo + 0.75 * (top - T.lo)) ui = i;
      });
      if (ui < 0 || ui + 3 >= c.length) throw new Error('leg chain');
      J[pre + 'Upper' + s] = c[ui];
      J[pre + 'Mid' + s] = c[ui + 1];
      J[pre + 'Low' + s] = c[ui + 2];
      J[pre + 'Paw' + s] = c[ui + 3];
    }
  }
  // trunk from the hind-leg branch to the front-leg branch: spine ≈ 35 %, chest ≈ 70 % of the way
  const trunk = path(fRoot);
  const hi = trunk.indexOf(hRoot);
  if (hi < 0) throw new Error('front legs do not branch off the trunk');
  trunk.forEach((b) => used.add(b));
  J.root = trunk.slice(0, hi + 1).find((b) => y(b) > T.lo + 0.3 * (T.hi - T.lo)) ?? hRoot;
  const mids = trunk.slice(hi + 1, -1);
  const zAt = (f) => P.get(hRoot).z + f * (P.get(fRoot).z - P.get(hRoot).z);
  const near = (arr, z) => arr.slice().sort((a, b) => Math.abs(P.get(a).z - z) - Math.abs(P.get(b).z - z))[0];
  J.spine = mids.length > 1 ? near(mids, zAt(0.35)) : null;
  J.chest = J.spine ? near(mids.slice(mids.indexOf(J.spine) + 1), zAt(0.7)) ?? fRoot : fRoot;
  // head: the branch of the front-leg root reaching furthest forward; neck → head → jaw/snout
  const reach = (b, sgn) => Math.max(sgn * P.get(b).z, ...kids(b).map((k) => reach(k, sgn)));
  const chain = (first, sgn) => {
    const out = [];
    for (let b = first; b; b = kids(b).sort((p, q) => reach(q, sgn) - reach(p, sgn))[0]) out.push(b);
    return out;
  };
  const hc = chain(kids(fRoot).filter((k) => !used.has(k)).sort((p, q) => reach(q, 1) - reach(p, 1))[0], 1);
  if (!hc.length) throw new Error('no head');
  hc.forEach((b) => used.add(b));
  [J.neck, J.head, J.jaw] = hc.length >= 3 ? hc : hc.length === 2 ? [hc[0], hc[1], null] : [null, hc[0], null];
  // tail: the unused branch of the hind end reaching furthest back
  const tailStart = trunk.slice(0, hi + 1).flatMap(kids).filter((k) => !used.has(k)).sort((p, q) => reach(q, -1) - reach(p, -1))[0];
  const tc = tailStart ? chain(tailStart, -1) : [];
  tc.forEach((b) => used.add(b));
  tc.slice(0, 3).forEach((b, i) => (J['tail' + i] = b));
  // anything else hanging off the trunk (flaps, extra limbs) sways as a whole
  trunk.flatMap(kids).filter((k) => !used.has(k)).slice(0, 4).forEach((b, i) => (J['extra' + i] = b));
  return J;
}

/** palm frame from the wrist and the finger roots; palms face inward (-x on the left) in canonical pose */
function palmFrame(wrist, bases, sx, def) {
  const inward = new THREE.Vector3(-sx, 0, 0);
  if (bases.length < 2) return { along: new THREE.Vector3(sx * Math.sin(def.armSpread), -Math.cos(def.armSpread), 0), palm: inward };
  const along = bases.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(bases.length).sub(wrist).normalize();
  let across = null, d = 0;
  for (const a of bases) for (const b of bases) if (a.distanceTo(b) > d) (d = a.distanceTo(b)), (across = b.clone().sub(a));
  const palm = across.cross(along).normalize();
  if (palm.dot(inward) < 0) palm.negate();
  return { along, palm };
}

/** box of the points within r of an iteratively re-centered guess (ignores tongues, hoods, hair tails) */
function clusterBox(pts, guess, r) {
  const c = guess.clone();
  const box = new THREE.Box3();
  for (let it = 0; it < 4; it++) {
    box.makeEmpty();
    for (const p of pts) if (p.distanceToSquared(c) < r * r) box.expandByPoint(p);
    if (box.isEmpty()) break;
    box.getCenter(c);
  }
  return box;
}

// ---------------------------------------------------------------- templates
const templates = new Map(); // kind -> template | null (broken model → procedural fallback)

function makeTemplate(kind, def, gltf) {
  const model = cloneSkinned(gltf.scene);
  const holder = new THREE.Group();
  holder.add(model);
  const byNorm = new Map();
  model.traverse((o) => {
    if (o.isBone && !byNorm.has(normName(o.name))) byNorm.set(normName(o.name), o);
  });
  const meshes = [];
  model.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  // three.js skins with 4 influences: renormalize when the file carries 8 (JOINTS_1 is dropped)
  for (const m of meshes) m.normalizeSkinWeights();

  // ---- joints: by name for Valve / Mixamo, else by topology (which also turns the model to +Z)
  const { J, fingers } = namedRig(byNorm) ?? topologyRig(holder, model, meshes);
  holder.updateMatrixWorld(true);
  // named rigs: face +Z (toes ahead of the ankles)
  const fwd = J.toeL.getWorldPosition(new THREE.Vector3()).sub(J.footL.getWorldPosition(_a));
  fwd.add(J.toeR.getWorldPosition(_b)).sub(J.footR.getWorldPosition(_a));
  if (fwd.z < 0) model.rotation.y += Math.PI;
  holder.updateMatrixWorld(true);
  if (J.thighL.getWorldPosition(_a).x < J.thighR.getWorldPosition(_b).x) console.warn(`[glb] ${kind}: left/right look mirrored`);

  // ---- canonical pose: arms + legs straight down (arms spread a little), feet keep their rest (flat) orientation
  const footRest = { L: J.footL.getWorldQuaternion(new THREE.Quaternion()), R: J.footR.getWorldQuaternion(new THREE.Quaternion()) };
  const down = new THREE.Vector3(0, -1, 0);
  for (const s of ['L', 'R']) {
    const sx = s === 'L' ? 1 : -1;
    const arm = new THREE.Vector3(sx * Math.sin(def.armSpread), -Math.cos(def.armSpread), 0);
    aimBone(J['upperArm' + s], J['foreArm' + s], arm);
    aimBone(J['foreArm' + s], J['hand' + s], arm);
    aimBone(J['thigh' + s], J['shin' + s], down);
    aimBone(J['shin' + s], J['foot' + s], down);
    setWorldQuat(J['foot' + s], footRest[s]);
  }

  // ---- hands: palm frame in canonical space (for IK grips), then curl the fingers toward the palm
  const hands = {};
  for (const s of ['L', 'R']) {
    const f = fingers[s];
    const wrist = J['hand' + s].getWorldPosition(new THREE.Vector3());
    const bases = f.chains.filter((c) => c !== f.thumb).map((c) => c[0].getWorldPosition(new THREE.Vector3()));
    const { along, palm } = (hands[s] = palmFrame(wrist, bases, s === 'L' ? 1 : -1, def));
    const axis = along.clone().cross(palm).normalize();
    const curl = new THREE.Quaternion();
    for (const c of f.chains) {
      curl.setFromAxisAngle(axis, (CURL[kind] ?? 0.3) * (c === f.thumb ? 0.4 : 1));
      for (const b of c) setWorldQuat(b, curl.clone().multiply(b.getWorldQuaternion(_q)));
    }
  }

  // ---- normalize: height in meters, feet on y=0, hips over the origin
  const h0 = skinnedBounds(holder, meshes).all;
  model.scale.setScalar(def.height / Math.max(1e-6, h0.max.y - h0.min.y));
  holder.updateMatrixWorld(true);
  const box = skinnedBounds(holder, meshes).all;
  const hp = J.hips.getWorldPosition(new THREE.Vector3());
  model.position.set(-hp.x, -box.min.y, -hp.z);
  holder.updateMatrixWorld(true);

  // ---- retarget tables. A key the skeleton lacks (J[k] null) is virtual: its rotation is folded into the
  // mapped proxy below it. The GLB parent of a mapped joint must be driven by its nearest mapped proxy ancestor.
  const keys = PROXY.map((p) => p[0]);
  const mapped = new Map(keys.filter((k) => J[k]).map((k) => [J[k], k]));
  const driverOf = (o) => {
    for (let p = o; p && p !== model; p = p.parent) if (mapped.has(p)) return mapped.get(p);
    return null;
  };
  const proxyPos = {};
  const maps = [];
  for (const k of keys) {
    const bone = J[k];
    if (!bone) continue;
    const chain = [k];
    let a = PROXY_PARENT[k];
    for (; a && !J[a]; a = PROXY_PARENT[a]) chain.unshift(a);
    if (driverOf(bone.parent) !== a) throw new Error(`hierarchy mismatch at ${k}`);
    proxyPos[k] = bone.getWorldPosition(new THREE.Vector3());
    maps.push({
      chain,
      name: bone.name,
      pre: bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(),
      post: bone.getWorldQuaternion(new THREE.Quaternion()),
    });
  }
  // virtual proxies sit on their mapped child (neck on the head joint, clavicle on the shoulder joint)
  for (const k of keys) if (!J[k]) proxyPos[k] = proxyPos[keys.find((c) => PROXY_PARENT[c] === k && J[c])].clone();
  const hipsY = proxyPos.hips.y;
  const hipsParentInv = J.hips.parent.matrixWorld.clone().invert();
  // proxies have identity rest rotation → local offset = difference of canonical joint positions
  const proxyLocal = {};
  for (const [k, p] of PROXY) {
    proxyLocal[k] = p ? proxyPos[k].clone().sub(proxyPos[p]) : new THREE.Vector3(proxyPos.hips.x, HIP_Y, proxyPos.hips.z);
  }

  const bust = def.bust ? addBust(meshes, J.chest, driverOf, def) : null;

  // ---- hit volumes from the skinned vertices each proxy drives (holder space == proxy space at rest)
  const keyOf = new Map();
  model.traverse((o) => {
    if (o.isBone) keyOf.set(o, driverOf(o) ?? 'hips');
  });
  const { per, headPts } = skinnedBounds(holder, meshes, keyOf);
  const k = def.height / 1.8;
  per.head = clusterBox(headPts, proxyPos.head.clone().add(new THREE.Vector3(0, 0.09 * k, 0.02 * k)), 0.16 * k);
  const hit = hitShape(per, proxyPos, def);

  finishModel(holder, model, meshes, mapped, def.height * 0.5, def.height * 0.9);
  return { kind, def, model, maps, proxies: PROXY, proxyLocal, rootKey: 'hips', baseY: hipsY - HIP_Y, rootName: J.hips.name, rootParentInv: hipsParentInv, hit, hands, bust };
}

/** materials, shadows, a fixed culling sphere (center height cy, radius r) and static nodes */
function finishModel(holder, model, meshes, mapped, cy, r) {
  const matCache = new Map();
  const center = new THREE.Vector3(0, cy, 0);
  for (const m of meshes) {
    const big = m.geometry.attributes.position.count > 1500;
    const src = m.material;
    const key = src.uuid + big;
    if (!matCache.has(key)) matCache.set(key, gameMaterial(src, big));
    m.material = matCache.get(key);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = true;
    // generous fixed sphere in mesh space (covers raised arms and the death fall; never recomputed)
    const inv = m.matrixWorld.clone().invert();
    m.boundingSphere = new THREE.Sphere(center.clone().applyMatrix4(inv), r / m.matrixWorld.getMaxScaleOnAxis());
  }
  // static nodes: skip the per-frame matrix compose (only mapped joints are animated)
  model.traverse((o) => {
    o.updateMatrix();
    if (!mapped.has(o) && !o.userData.jiggle) o.matrixAutoUpdate = false;
  });
  holder.remove(model);
}

/**
 * Quadruped template: the rest pose is already a standing pose, so the proxies rest at identity on it
 * directly. Their hierarchy mirrors the mapped joints (parent = nearest mapped ancestor). Scaled to
 * def.length (nose to tail), paws on y = 0, origin at 55 % of the length so the collision circle sits
 * on the chest rather than the rump.
 */
function makeQuadTemplate(kind, def, gltf) {
  const model = cloneSkinned(gltf.scene);
  const holder = new THREE.Group();
  holder.add(model);
  const meshes = [];
  model.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  for (const m of meshes) m.normalizeSkinWeights();
  const J = quadTopology(holder, model, meshes);
  const b0 = skinnedBounds(holder, meshes).all;
  model.scale.setScalar(def.length / Math.max(1e-6, b0.max.z - b0.min.z));
  const b1 = skinnedBounds(holder, meshes).all;
  const rp = J.root.getWorldPosition(new THREE.Vector3());
  const oz = b1.min.z + (b1.max.z - b1.min.z) * 0.55;
  model.position.set(-rp.x, -b1.min.y, -oz);
  const extent = { front: b1.max.z - oz, rear: oz - b1.min.z }; // nose / tail reach past the origin
  holder.updateMatrixWorld(true);

  const depth = (o) => {
    let d = 0;
    for (let p = o; p; p = p.parent) d++;
    return d;
  };
  const keys = Object.keys(J).filter((k) => J[k]).sort((a, b) => depth(J[a]) - depth(J[b]));
  const mapped = new Map(keys.map((k) => [J[k], k]));
  const driverOf = (o) => {
    for (let p = o; p && p !== model; p = p.parent) if (mapped.has(p)) return mapped.get(p);
    return null;
  };
  const proxies = [], P = {}, maps = [];
  for (const k of keys) {
    const bone = J[k];
    const parent = driverOf(bone.parent);
    if (!parent && k !== 'root') throw new Error(`${k} is not below the root`);
    proxies.push([k, parent]);
    P[k] = bone.getWorldPosition(new THREE.Vector3());
    maps.push({ chain: [k], name: bone.name, pre: bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert(), post: bone.getWorldQuaternion(new THREE.Quaternion()) });
  }
  const proxyLocal = {};
  for (const [k, p] of proxies) proxyLocal[k] = p ? P[k].clone().sub(P[p]) : P[k].clone();

  // hit volumes from the vertices each proxy drives
  const keyOf = new Map();
  model.traverse((o) => {
    if (o.isBone) keyOf.set(o, driverOf(o) ?? 'root');
  });
  const { per, all } = skinnedBounds(holder, meshes, keyOf);
  const hit = quadHitShape(per, P, J);
  finishModel(holder, model, meshes, mapped, (all.max.y + all.min.y) * 0.5, def.length * 0.8);
  return { kind, def, model, maps, proxies, proxyLocal, rootKey: 'root', baseY: 0, rootName: J.root.name, rootParentInv: J.root.parent.matrixWorld.clone().invert(), hit, extent };
}

/** generic part list { name, kind, key, off, key2?, off2?, r } in proxy space for a quadruped */
function quadHitShape(boxes, P, J) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const box = (k) => (boxes[k] && !boxes[k].isEmpty() ? boxes[k] : new THREE.Box3().setFromCenterAndSize(P[k] ?? P.root, V(0.1, 0.1, 0.1)));
  const half = (b) => b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const mid = (b) => b.getCenter(new THREE.Vector3());
  const clamp = THREE.MathUtils.clamp;
  const parts = [];
  // skull (+ snout): headshots
  for (const k of ['head', 'jaw']) {
    if (!J[k]) continue;
    const b = box(k), h = half(b);
    parts.push({ name: 'head', kind: 'sphere', key: k, off: mid(b).sub(P[k]), r: clamp(Math.max(h.x, h.y, h.z) * 0.95, 0.06, 0.17) });
  }
  // neck
  if (J.neck) {
    const h = half(box('neck'));
    parts.push({ name: 'torso', kind: 'capsule', key: 'neck', off: V(0, 0, 0), key2: 'head', off2: V(0, 0, 0), r: clamp((h.x + h.y) / 2, 0.06, 0.14) });
  }
  // trunk: rump → withers along the body's vertical middle
  const rear = box('root').clone(), fore = box('chest').clone();
  if (J.spine) rear.union(box('spine'));
  const tb = rear.clone().union(fore), th = half(tb);
  const r = clamp(Math.min(th.x, th.y) * 0.95, 0.08, 0.3);
  // the front cap stops behind the neck so the head stays exposed to frontal shots
  const A = V(mid(tb).x, mid(rear).y, tb.min.z + r * 0.9);
  const B = V(mid(tb).x, mid(fore).y, Math.max(A.z, Math.min(fore.max.z, P[J.neck ? 'neck' : 'head'].z) - r));
  parts.push({ name: 'torso', kind: 'capsule', key: 'root', off: A.sub(P.root), key2: 'chest', off2: B.sub(P.chest), r });
  // legs
  for (const leg of ['fL', 'fR', 'hL', 'hR']) {
    const [pre, s] = leg;
    const k = (n) => pre + n + s;
    const lr = (n) => {
      const h = half(box(k(n)));
      return clamp((h.x + h.z) / 2, 0.03, 0.1);
    };
    parts.push({ name: 'leg', kind: 'capsule', key: k('Upper'), off: V(0, 0, 0), key2: k('Mid'), off2: V(0, 0, 0), r: lr('Upper') });
    parts.push({ name: 'leg', kind: 'capsule', key: k('Mid'), off: V(0, 0, 0), key2: k('Low'), off2: V(0, 0, 0), r: lr('Mid') });
    parts.push({ name: 'leg', kind: 'capsule', key: k('Low'), off: V(0, 0, 0), key2: k('Paw'), off2: V(0, 0, 0), r: lr('Low') });
  }
  return { parts };
}

/**
 * Bust secondary motion, done once on the template in canonical pose (torso joints are still in bind
 * pose, so a torso vertex's holder position is chest.matrixWorld * IBM(chest) * bindMatrix * v):
 * find each breast's apex (front-most torso vertices in the chest band, mirrored to be symmetric),
 * weight the surface around it (footprint around the apex in the frontal plane × closeness to the
 * front), enlarge that region around a center behind the apex, and re-skin it to a new jiggle bone
 * on the chest joint (4 influences, renormalized).
 */
function addBust(meshes, chest, driverOf, def) {
  const k = def.height / 1.7;
  const R = 0.08 * k; // bust radius: center depth and spring travel scale with it
  const RF = 0.09 * k; // footprint radius around the apex
  const torso = new Set(['chest', 'spine', 'neck', 'hips']);
  const ss = THREE.MathUtils.smoothstep;
  const V = () => new THREE.Vector3();
  const v = V(), p = V();
  const vi = new THREE.Vector4(), vw = new THREE.Vector4();
  const setup = meshes
    .map((m) => {
      const ci = m.skeleton.bones.indexOf(chest);
      if (ci < 0) return null;
      const M = chest.matrixWorld.clone().multiply(m.skeleton.boneInverses[ci]).multiply(m.bindMatrix);
      return { m, ci, M, Minv: M.clone().invert() };
    })
    .filter(Boolean);
  const isTorso = (m, i) => {
    vi.fromBufferAttribute(m.geometry.attributes.skinIndex, i);
    vw.fromBufferAttribute(m.geometry.attributes.skinWeight, i);
    let best = 0;
    for (let c = 1; c < 4; c++) if (vw.getComponent(c) > vw.getComponent(best)) best = c;
    return torso.has(driverOf(m.skeleton.bones[vi.getComponent(best)]));
  };
  // apex per side: mean of the 12 front-most torso vertices in the chest band
  const front = { L: [], R: [] };
  for (const { m, M } of setup) {
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(M);
      const ax = Math.abs(p.x);
      if (p.y < 0.68 * def.height || p.y > 0.82 * def.height || ax < 0.025 * k || ax > 0.14 * k || !isTorso(m, i)) continue;
      front[p.x > 0 ? 'L' : 'R'].push(p.clone());
    }
  }
  const apex = (arr) => arr.sort((a, b) => b.z - a.z).slice(0, 12).reduce((a, b) => a.add(b), V()).divideScalar(Math.min(12, arr.length));
  if (front.L.length < 12 || front.R.length < 12) return null;
  const aL = apex(front.L), aR = apex(front.R);
  const ax = (aL.x - aR.x) / 2, ay = (aL.y + aR.y) / 2, az = (aL.z + aR.z) / 2;
  const centers = [new THREE.Vector3(ax, ay, az - 0.8 * R), new THREE.Vector3(-ax, ay, az - 0.8 * R)];
  // jiggle bones on the chest joint, at the centers
  const bones = centers.map((c, i) => {
    const b = new THREE.Bone();
    b.name = i ? 'jiggleR' : 'jiggleL';
    b.userData.jiggle = true;
    chest.add(b);
    b.position.copy(chest.worldToLocal(c.clone()));
    b.updateMatrix();
    return b;
  });
  const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0];
  for (const { m, ci, M, Minv } of setup) {
    const g = m.geometry;
    const pos = g.attributes.position, si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const n0 = m.skeleton.bones.length;
    const ibm = m.skeleton.boneInverses[ci];
    // new joint at chest * L: inverse bind = inv(L) * IBM(chest), so it rests exactly on the chest's skinning
    m.bind(new THREE.Skeleton([...m.skeleton.bones, ...bones], [...m.skeleton.boneInverses, ...bones.map((b) => b.matrix.clone().invert().multiply(ibm))]), m.bindMatrix);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(M);
      const side = p.x > 0 ? 0 : 1;
      const c = centers[side];
      const t = Math.hypot(p.x - c.x, (p.y - ay) * 1.1) / RF;
      if (t >= 1 || !isTorso(m, i)) continue;
      const w = (1 - ss(t, 0.45, 1)) * ss(p.z, az - 0.06 * k, az - 0.02 * k);
      if (w < 0.01) continue;
      // enlarge around the center, back into bind space
      p.sub(c).multiplyScalar(1 + def.bust.enlarge * w).add(c);
      v.copy(p).applyMatrix4(Minv);
      pos.setXYZ(i, v.x, v.y, v.z);
      // blend the jiggle bone in against the existing weights, keep the 4 largest
      const wj = 0.95 * w;
      vi.fromBufferAttribute(si, i);
      vw.fromBufferAttribute(sw, i);
      const inf = [0, 1, 2, 3].map((q) => [vi.getComponent(q), vw.getComponent(q) * (1 - wj)]);
      inf.push([n0 + side, wj]);
      inf.sort((a, b) => b[1] - a[1]);
      let sum = 0;
      for (let q = 0; q < 4; q++) sum += inf[q][1];
      for (let q = 0; q < 4; q++) {
        idx[q] = inf[q][1] > 0 ? inf[q][0] : 0;
        wt[q] = inf[q][1] / sum;
      }
      si.setXYZW(i, idx[0], idx[1], idx[2], idx[3]);
      sw.setXYZW(i, wt[0], wt[1], wt[2], wt[3]);
    }
    pos.needsUpdate = si.needsUpdate = sw.needsUpdate = true;
  }
  return { chestName: chest.name, rests: bones.map((b) => b.position.clone()), size: R };
}

// Hit volumes in proxy-local space (proxies rest with identity rotation, so offsets are plain
// holder-space differences). Mirrors the procedural parts in zombie.js.
function hitShape(boxes, P, def) {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // a joint without vertices gets a small box around itself
  const box = (k) => (boxes[k] && !boxes[k].isEmpty() ? boxes[k] : new THREE.Box3().setFromCenterAndSize(P[k] ?? P.hips, V(0.2, 0.2, 0.2)));
  const size = (b) => b.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const mid = (b) => b.getCenter(new THREE.Vector3());
  const limb = (a, b) => {
    const s = size(a).add(size(b ?? a));
    return THREE.MathUtils.clamp((s.x + s.z) / 4, 0.04, 0.2);
  };
  const out = {};
  // head: sphere around the head-driven vertices (a bit generous like the procedural 0.125)
  const hb = box('head'), hs = size(hb), hc = mid(hb);
  out.head = { off: hc.clone().sub(P.head), r: THREE.MathUtils.clamp(Math.max(hs.x, hs.z, hs.y * 0.85) * 1.05, 0.1, 0.16) };
  // torso capsule: spine → chest, radius from the trunk width/depth
  const tb = box('spine').clone().union(box('chest'));
  const ts = size(tb), tc = mid(tb);
  const tr = THREE.MathUtils.clamp((ts.x * 0.8 + ts.z) / 2, 0.12, 0.42);
  const y0 = Math.min(tb.min.y + tr, P.chest.y);
  const y1 = Math.max(y0, Math.min(tb.max.y - tr * 0.7, P.neck.y - 0.02));
  out.torso = { off: V(tc.x - P.spine.x, y0 - P.spine.y, tc.z - P.spine.z), off2: V(tc.x - P.chest.x, y1 - P.chest.y, tc.z - P.chest.z), r: tr };
  const pb = box('hips'), ps = size(pb);
  out.pelvis = { off: mid(pb).sub(P.hips), r: THREE.MathUtils.clamp(Math.max(ps.x * 0.75, ps.z), 0.12, 0.36) };
  out.upperArm = limb(box('upperArmL'), box('upperArmR'));
  out.foreArm = limb(box('foreArmL'), box('foreArmR'));
  out.thigh = limb(box('thighL'), box('thighR'));
  out.shin = limb(box('shinL'), box('shinR'));
  if (def.belly) {
    // the Boomer's gut: a big sphere bulging out of the front of the lower trunk (wins over torso/pelvis)
    const bb = box('spine');
    const r = THREE.MathUtils.clamp(size(bb).x * 0.65, 0.14, 0.3);
    const front = Math.max(bb.max.z, box('hips').max.z);
    out.belly = { off: V(mid(bb).x - P.spine.x, mid(bb).y - r * 0.3 - P.spine.y, front - r * 0.75 - P.spine.z), r };
  }
  return out;
}

// The GLBs come with metalness 0 / roughness ~0.9 and sRGB WebP albedo; keep them matte, and use
// single-sided rendering for the closed body meshes (hair / small cards stay double-sided).
function gameMaterial(src, closed) {
  const m = src.clone();
  m.metalness = 0;
  m.roughness = THREE.MathUtils.clamp(m.roughness ?? 0.85, 0.72, 0.95);
  m.side = closed ? THREE.FrontSide : THREE.DoubleSide;
  if (m.map) m.map.anisotropy = 4;
  return m;
}

function buildTemplate(kind) {
  const def = GLB_BODIES[kind];
  try {
    return (def.quad ? makeQuadTemplate : makeTemplate)(kind, def, getGLB(def.url));
  } catch (e) {
    console.warn(`[glb] ${kind}: falling back to the procedural body`, e);
    return null;
  }
}

function template(kind) {
  if (templates.has(kind)) return templates.get(kind);
  const def = GLB_BODIES[kind];
  if (!def?.url || !getGLB(def.url)) return null; // not loaded (yet): procedural body, retry next time
  const t = buildTemplate(kind);
  templates.set(kind, t);
  return t;
}

// ---------------------------------------------------------------- instances
const _hp = new THREE.Vector3();
const noop = () => {};

class GLBRig {
  constructor(t, model, bones, base) {
    const byName = new Map();
    model.traverse((o) => {
      if (o.isBone && !byName.has(o.name)) byName.set(o.name, o);
    });
    this.maps = t.maps.map((m) => ({ bone: byName.get(m.name), proxies: m.chain.map((k) => bones[k]), pre: m.pre, post: m.post }));
    // nothing reads these joints' Euler rotation: skip the quaternion → Euler sync on every write
    for (const m of this.maps) m.bone.quaternion._onChange(noop);
    this.rootBone = byName.get(t.rootName);
    this.rootProxy = bones[t.rootKey];
    this.base = base;
    this.rootParentInv = t.rootParentInv;
  }
  /** copy the proxy pose onto the GLB joints (call after the animation wrote the proxies) */
  sync() {
    const maps = this.maps;
    for (let i = 0; i < maps.length; i++) {
      const m = maps[i];
      const q = m.bone.quaternion.copy(m.pre);
      for (let j = 0; j < m.proxies.length; j++) q.multiply(m.proxies[j].quaternion);
      q.multiply(m.post);
    }
    _hp.copy(this.rootProxy.position).add(this.base.position).applyMatrix4(this.rootParentInv);
    this.rootBone.position.copy(_hp);
  }
}

/**
 * Same contract as rig.js createCharacter: { root, mesh, bones, spec, led } plus
 * rig (call rig.sync() after animating), hit (hit volumes), hands ({L, R}: finger direction + palm
 * normal in proxy-hand space), glow (per-instance materials or null).
 * opts.tint: color multiplier for a variation. Returns null when the GLB is unavailable.
 */
export function createGLBCharacter(kind, scale = 1, opts = {}) {
  const t = template(kind);
  if (!t) return null;
  const root = new THREE.Group();
  const mesh = new THREE.Group(); // stands in for the SkinnedMesh: death code offsets it
  root.add(mesh);
  const model = cloneSkinned(t.model);
  mesh.add(model);
  const base = new THREE.Object3D(); // humanoids: shifts the procedural hip height onto the model's
  base.position.set(0, t.baseY, 0);
  mesh.add(base);
  const bones = {};
  for (const [name, parent] of t.proxies) {
    const b = new THREE.Bone();
    b.name = name;
    b.position.copy(t.proxyLocal[name]);
    (parent ? bones[parent] : base).add(b);
    bones[name] = b;
  }
  // per-instance materials only when something needs to change them
  let glow = null;
  if (t.def.glow || opts.tint != null) {
    const own = new Map();
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      if (!own.has(o.material)) {
        const m = o.material.clone();
        if (opts.tint != null) m.color.multiply(new THREE.Color(opts.tint));
        if (t.def.glow) {
          m.emissive.set(t.def.glow);
          m.emissiveMap = m.map;
          m.emissiveIntensity = 0;
        }
        own.set(o.material, m);
      }
      o.material = own.get(o.material);
    });
    if (t.def.glow) glow = [...own.values()];
  }
  root.scale.setScalar(scale);
  const rig = new GLBRig(t, model, bones, base);
  rig.sync();
  let jiggle = null;
  if (t.bust) {
    const find = (n) => model.getObjectByName(n);
    jiggle = new Jiggle(find(t.bust.chestName), [find('jiggleL'), find('jiggleR')], t.bust.rests, t.bust.size);
  }
  // rest: proxy rest offsets (quadruped animation adds to the root's), quad: which animation to run
  return { root, mesh, bones, spec: t.def, led: null, rig, hit: t.hit, hands: t.hands, glow, glb: kind, rest: t.proxyLocal, quad: !!t.def.quad, extent: t.extent, jiggle };
}

/** Build the GLB templates up front (after preloadGLBs) so the first spawn doesn't hitch. */
export function prebuildGLBCharacters() {
  for (const k of Object.keys(GLB_BODIES)) template(k);
}
