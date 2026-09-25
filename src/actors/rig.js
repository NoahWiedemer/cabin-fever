// Procedural skinned humanoids: a shared bone layout, detailed body parts built from primitives,
// rigidly (with soft joint blending) skinned into ONE SkinnedMesh per character (2-3 draw calls).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { tex } from '../world/textures.js';
import { GLB_BODIES, createGLBCharacter, prebuildGLBCharacters } from './gltfCharacter.js';

// ---------------------------------------------------------------- skeleton definition
export const BONES = [
  // name, parent, local offset (bind pose, all rotations identity)
  ['hips', -1, [0, 0.98, 0]],
  ['spine', 0, [0, 0.12, 0]],
  ['chest', 1, [0, 0.2, 0]],
  ['neck', 2, [0, 0.27, 0]],
  ['head', 3, [0, 0.09, 0]],
  ['shoulderL', 2, [0.08, 0.2, 0]],
  ['upperArmL', 5, [0.12, 0, 0]],
  ['foreArmL', 6, [0, -0.29, 0]],
  ['handL', 7, [0, -0.26, 0]],
  ['shoulderR', 2, [-0.08, 0.2, 0]],
  ['upperArmR', 9, [-0.12, 0, 0]],
  ['foreArmR', 10, [0, -0.29, 0]],
  ['handR', 11, [0, -0.26, 0]],
  ['thighL', 0, [0.1, -0.05, 0]],
  ['shinL', 13, [0, -0.43, 0]],
  ['footL', 14, [0, -0.42, 0]],
  ['thighR', 0, [-0.1, -0.05, 0]],
  ['shinR', 16, [0, -0.43, 0]],
  ['footR', 17, [0, -0.42, 0]],
];
export const B = Object.fromEntries(BONES.map((b, i) => [b[0], i]));

function bindPositions(scale = [1, 1, 1]) {
  // world-space bind position of each bone
  const out = [];
  for (let i = 0; i < BONES.length; i++) {
    const [, p, o] = BONES[i];
    const v = new THREE.Vector3(o[0] * scale[0], o[1] * scale[1], o[2] * scale[2]);
    if (p >= 0) v.add(out[p]);
    out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------- part builder
class PartSet {
  constructor(bindPos) {
    this.bindPos = bindPos;
    this.groups = [[], [], []]; // 0 cloth/gear, 1 flesh, 2 emissive
  }
  /**
   * geo: geometry in bone-local space; bone: bone index; color: THREE.Color; mat: group index;
   * blend: { parent: boneIndex, len: meters (along +y of local, i.e. near the joint at y=0), axis: 'y' }
   */
  add(geo, bone, color, mat = 0, opts = {}) {
    let g = geo.clone();
    if (opts.matrix) g.applyMatrix4(opts.matrix);
    if (!g.index) g = mergeVertices(g, 1e-5);
    const n = g.attributes.position.count;
    if (!g.index) {
      const ix = new Uint32Array(n);
      for (let i = 0; i < n; i++) ix[i] = i;
      g.setIndex(new THREE.BufferAttribute(ix, 1));
    }
    // strip unrelated attributes
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
    if (opts.uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < n; i++) uv.setXY(i, uv.getX(i) * opts.uvScale, uv.getY(i) * opts.uvScale);
    }
    const bp = this.bindPos[bone];
    const pos = g.attributes.position;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    const colors = new Float32Array(n * 3);
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const ly = pos.getY(i);
      let wParent = 0;
      if (opts.blend) {
        const d = opts.blend.fromTop ? -ly : ly;
        wParent = 0.5 * (1 - Math.min(1, Math.max(0, d / opts.blend.len)));
        if (opts.blend.fromTop && ly > 0) wParent = 0.5;
      }
      skinIndex[i * 4] = bone;
      skinWeight[i * 4] = 1 - wParent;
      if (wParent > 0) {
        skinIndex[i * 4 + 1] = opts.blend.parent;
        skinWeight[i * 4 + 1] = wParent;
      }
      // color with optional grime/blood noise
      let r = c.r, gg = c.g, b = c.b;
      if (opts.dirt !== 0) {
        const wx = pos.getX(i) + bp.x, wy = ly + bp.y, wz = pos.getZ(i) + bp.z;
        const nse = Math.sin(wx * 23.1 + wy * 17.3) * Math.sin(wz * 19.7 - wy * 11.9) * Math.sin(wx * 7.1 + wz * 5.3);
        const dirt = 1 - (opts.dirt ?? 0.12) * (this.dirtMul ?? 1) * (0.5 + 0.5 * nse);
        r *= dirt; gg *= dirt; b *= dirt;
        if (opts.blood) {
          const bn = Math.sin(wx * 9.3 + wz * 4.1 + wy * 3.3) * Math.sin(wy * 13.7 - wx * 6.2) + Math.sin(wz * 8.9 + wy * 21.0) * 0.5;
          const bm = Math.max(0, Math.min(1, (bn - (1 - opts.blood)) * 3.0));
          r = r * (1 - bm) + 0.16 * bm;
          gg = gg * (1 - bm) + 0.012 * bm;
          b = b * (1 - bm) + 0.01 * bm;
        }
      }
      colors[i * 3] = r;
      colors[i * 3 + 1] = gg;
      colors[i * 3 + 2] = b;
      // move into bind (world) space
      pos.setXYZ(i, pos.getX(i) + bp.x, ly + bp.y, pos.getZ(i) + bp.z);
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.groups[mat].push(g);
  }
  build() {
    const geos = [];
    const groups = [];
    let start = 0;
    for (let m = 0; m < this.groups.length; m++) {
      if (!this.groups[m].length) continue;
      const merged = mergeGeometries(this.groups[m], false);
      geos.push(merged);
      const count = merged.index.count;
      groups.push({ start, count, materialIndex: m });
      start += count;
    }
    const g = mergeGeometries(geos, false);
    g.clearGroups();
    for (const gr of groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.computeBoundingSphere();
    return g;
  }
}

// geometry helpers (all centered, in local space)
const caps = (r, len, rs = 10, cs = 3) => new THREE.CapsuleGeometry(r, len, cs, rs);
const rbox = (w, h, d, r = 0.02, s = 1) => new RoundedBoxGeometry(w, h, d, s, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
const sph = (r, ws = 12, hs = 8) => new THREE.SphereGeometry(r, ws, hs);
const cyl = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const M = () => new THREE.Matrix4();
const T = (x, y, z) => M().makeTranslation(x, y, z);
const TRS = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  M().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

// ---------------------------------------------------------------- body construction
/**
 * spec: {
 *  build: 'male'|'female'|'brute', shirt, pants, vest, boots, gloves (color or null for bare hands),
 *  skin (color for flesh tint), head: 'zombie'|'soldier'|'striker'|'crusher', blood (0..1), dynamite, scale
 * }
 */
function buildBody(spec) {
  const female = spec.build === 'female';
  const brute = spec.build === 'brute';
  const bindPos = bindPositions();
  const P = new PartSet(bindPos);
  P.dirtMul = spec.dirtAmt ? spec.dirtAmt / 0.12 : 1;
  const C = (h) => new THREE.Color(h);
  const shirt = C(spec.shirt), pants = C(spec.pants), vest = C(spec.vest ?? spec.shirt), boots = C(spec.boots ?? 0x141414);
  const skin = C(spec.skin ?? 0xffffff);
  const blood = spec.blood ?? 0.35;
  const w = female ? 0.86 : brute ? 1.25 : 1; // girth multiplier
  const dark = C(0x151618);
  const strap = C(0x1c1d1f);
  const topMat = spec.shirtless ? 1 : 0;
  const top = spec.shirtless ? skin : shirt;

  // ---- hips / pelvis
  P.add(rbox(0.34 * w, 0.2, 0.22 * w, 0.06), B.hips, pants, 0, { matrix: T(0, -0.02, 0), blood: blood * 0.6, dirt: 0.2 });
  if (!female) {
    // belt with buckle + pouches
    P.add(rbox(0.37 * w, 0.055, 0.25 * w, 0.02), B.hips, dark, 0, { matrix: T(0, 0.08, 0) });
    P.add(rbox(0.05, 0.04, 0.01, 0.005), B.hips, C(0x6b5a3a), 0, { matrix: T(0, 0.08, 0.128 * w) });
    for (const sx of [-1, 1]) {
      P.add(rbox(0.07, 0.1, 0.06, 0.012), B.hips, vest, 0, { matrix: T(sx * 0.17 * w, 0.02, -0.04) });
      P.add(rbox(0.06, 0.09, 0.05, 0.012), B.hips, vest, 0, { matrix: T(sx * 0.1 * w, 0.02, -0.13 * w) });
    }
  } else {
    P.add(rbox(0.34 * w, 0.05, 0.23 * w, 0.02), B.hips, C(0x2a2a2a), 0, { matrix: T(0, 0.08, 0) });
  }

  // ---- abdomen
  P.add(rbox(0.3 * w, 0.22, 0.2 * w, 0.07, 3), B.spine, top, topMat, { matrix: T(0, 0.1, 0), blend: { parent: B.hips, len: 0.08 }, blood, dirt: 0.15 });
  if (brute) {
    // bloated belly + hunched back hump
    P.add(sph(0.2, 16, 12), B.spine, top, topMat, { matrix: TRS(0, 0.06, 0.07, 0, 0, 0, 1.15, 1.0, 0.95), blend: { parent: B.hips, len: 0.1 }, blood, uvScale: 2 });
    P.add(sph(0.22, 16, 12), B.chest, top, topMat, { matrix: TRS(0, 0.26, -0.1, 0, 0, 0, 1.3, 0.9, 1.0), blood, uvScale: 2 });
    for (let i = 0; i < 9; i++) {
      const a = i * 2.39;
      P.add(sph(0.025 + (i % 3) * 0.012, 8, 6), B.chest, C(0x6fa0d8), 1, { matrix: T(Math.cos(a) * 0.22, 0.2 + (i % 4) * 0.05, Math.sin(a) * 0.15 - 0.05), uvScale: 2 });
    }
    // tattered pants belt rope
    P.add(new THREE.TorusGeometry(0.2, 0.02, 6, 18), B.hips, C(0x3a2a1a), 0, { matrix: TRS(0, 0.07, 0, Math.PI / 2, 0, 0, 1.25, 1.0, 1) });
  }

  // ---- chest
  const chestW = female ? 0.34 : brute ? 0.5 : 0.4;
  P.add(rbox(chestW, 0.32, 0.23 * w, 0.08, 3), B.chest, top, topMat, { matrix: T(0, 0.13, 0), blend: { parent: B.spine, len: 0.07 }, blood, dirt: 0.15, uvScale: spec.shirtless ? 2 : undefined });
  if (female) {
    P.add(sph(0.075, 12, 8), B.chest, shirt, 0, { matrix: TRS(0.065, 0.13, 0.1, 0, 0, 0, 1, 0.9, 0.8), blood });
    P.add(sph(0.075, 12, 8), B.chest, shirt, 0, { matrix: TRS(-0.065, 0.13, 0.1, 0, 0, 0, 1, 0.9, 0.8), blood });
  }
  if (spec.vest) {
    const vw = chestW + 0.04;
    // plate carrier front/back
    P.add(rbox(vw * 0.86, 0.3, 0.05, 0.015), B.chest, vest, 0, { matrix: T(0, 0.12, 0.125 * w), blood: blood * 0.7, dirt: 0.2 });
    P.add(rbox(vw * 0.86, 0.32, 0.05, 0.015), B.chest, vest, 0, { matrix: T(0, 0.13, -0.125 * w), blood: blood * 0.4, dirt: 0.2 });
    // cummerbund
    P.add(rbox(vw + 0.01, 0.13, 0.26 * w, 0.03), B.chest, vest, 0, { matrix: T(0, 0.02, 0), dirt: 0.2 });
    // shoulder straps
    for (const sx of [-1, 1]) P.add(rbox(0.06, 0.04, 0.26 * w, 0.012), B.chest, vest, 0, { matrix: T(sx * 0.12 * (chestW / 0.4), 0.29, 0) });
    // mag pouches (front)
    if (!spec.dynamite) {
      for (let i = -1; i <= 1; i++) {
        P.add(rbox(0.075, 0.13, 0.045, 0.01), B.chest, vest, 0, { matrix: T(i * 0.085, 0.02, 0.16 * w), blood: blood * 0.5, dirt: 0.25 });
        P.add(rbox(0.075, 0.03, 0.05, 0.008), B.chest, strap, 0, { matrix: T(i * 0.085, 0.09, 0.162 * w) });
      }
    }
    // radio pouch + antenna (back)
    P.add(rbox(0.08, 0.16, 0.06, 0.012), B.chest, vest, 0, { matrix: T(0.1, 0.12, -0.17 * w) });
    P.add(cyl(0.004, 0.004, 0.35, 4), B.chest, dark, 0, { matrix: TRS(0.12, 0.33, -0.17 * w, 0.2, 0, -0.15) });
    // hydration pack
    P.add(rbox(0.18, 0.22, 0.06, 0.03), B.chest, vest, 0, { matrix: T(-0.04, 0.12, -0.18 * w) });
  }
  if (spec.dynamite) {
    // bundles of dynamite strapped to the chest and back, with tape and wires
    const red = C(0x8a1c10);
    const tape = C(0x1a1a1a);
    for (const side of [1, -1]) {
      for (let i = 0; i < 6; i++) {
        const x = (i - 2.5) * 0.058;
        P.add(cyl(0.024, 0.024, 0.22, 10), B.chest, red, 0, { matrix: T(x, 0.08, side * 0.155 * w), dirt: 0.3 });
      }
      P.add(rbox(0.38, 0.03, 0.06, 0.01), B.chest, tape, 0, { matrix: T(0, 0.14, side * 0.158 * w) });
      P.add(rbox(0.38, 0.03, 0.06, 0.01), B.chest, tape, 0, { matrix: T(0, 0.02, side * 0.158 * w) });
      // detonator box
      P.add(rbox(0.07, 0.05, 0.03, 0.008), B.chest, C(0x2b2b2b), 0, { matrix: T(0.05, 0.2, side * 0.18 * w) });
    }
    // wires
    for (let i = 0; i < 3; i++) {
      P.add(cyl(0.004, 0.004, 0.3, 4), B.chest, C([0xaa2222, 0x2244aa, 0xcccc22][i]), 0, { matrix: TRS(-0.08 + i * 0.03, 0.12, 0.19 * w, 0, 0, 1.2 + i * 0.2) });
    }
  }

  // ---- neck & head
  if (spec.head === 'soldier') {
    P.add(cyl(0.055, 0.062, 0.12, 12), B.neck, C(0x16171a), 0, { matrix: T(0, 0.04, 0), blend: { parent: B.chest, len: 0.05 }, dirt: 0 });
  } else {
    P.add(cyl(0.052 * (brute ? 1.5 : 1), 0.06 * (brute ? 1.5 : 1), 0.12, 12), B.neck, skin, 1, { matrix: T(0, 0.04, 0), blend: { parent: B.chest, len: 0.05 }, dirt: 0 });
  }
  buildHead(P, spec, skin, C);

  // ---- arms
  const armR = (female ? 0.046 : brute ? 0.075 : 0.054);
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const ua = B['upperArm' + side], fa = B['foreArm' + side], hd = B['hand' + side], sh = B['shoulder' + side];
    // deltoid
    P.add(sph(armR * 1.35, 12, 8), ua, top, topMat, { matrix: TRS(0, -0.02, 0, 0, 0, 0, 1.05, 1.1, 1), blend: { parent: B.chest, len: 0.06, fromTop: true }, blood: blood * 0.5 });
    P.add(caps(armR, 0.22), ua, top, topMat, { matrix: T(0, -0.145, 0), blood: blood * 0.6, dirt: 0.15 });
    if (brute) P.add(sph(armR * 1.2, 10, 8), ua, top, topMat, { matrix: TRS(0, -0.12, 0.02, 0, 0, 0, 1, 1.4, 1), blood });
    // elbow
    P.add(sph(armR * 0.95, 10, 8), fa, top, topMat, { matrix: T(0, 0, 0), blend: { parent: ua, len: 0.05, fromTop: true } });
    const sleeve = spec.rolledSleeves ? skin : shirt;
    const sleeveMat = spec.rolledSleeves ? 1 : 0;
    P.add(caps(armR * 0.85, 0.2), fa, sleeve, sleeveMat, { matrix: T(0, -0.13, 0), blend: { parent: ua, len: 0.06, fromTop: true }, blood, dirt: 0.1 });
    if (!spec.rolledSleeves) P.add(cyl(armR * 0.95, armR * 0.95, 0.04, 12), fa, dark, 0, { matrix: T(0, -0.22, 0) });
    // hand
    const gloves = spec.gloves != null;
    const hc = gloves ? C(spec.gloves) : skin;
    const hm = gloves ? 0 : 1;
    const hs = brute ? 1.5 : female ? 0.9 : 1;
    P.add(rbox(0.075 * hs, 0.09 * hs, 0.035 * hs, 0.015), hd, hc, hm, { matrix: T(0, -0.045 * hs, 0), blend: { parent: fa, len: 0.03, fromTop: true }, blood: blood * 0.8 });
    // fingers (4) curled slightly + thumb
    for (let f = 0; f < 4; f++) {
      const fx = (f - 1.5) * 0.018 * hs;
      P.add(caps(0.009 * hs, 0.055 * hs, 6, 2), hd, hc, hm, { matrix: TRS(fx, -0.115 * hs, 0.006, 0.35, 0, 0), blood });
    }
    P.add(caps(0.011 * hs, 0.04 * hs, 6, 2), hd, hc, hm, { matrix: TRS(sx * 0.04 * hs, -0.05 * hs, 0.02, 0.4, 0, sx * 0.7) });
    // shoulder yoke
    P.add(sph(armR * 1.1, 10, 6), sh, top, topMat, { matrix: TRS(0, 0, 0, 0, 0, 0, 1.5, 0.8, 1), blend: { parent: B.chest, len: 0.08, fromTop: true } });
  }

  // ---- legs
  const legR = female ? 0.066 : brute ? 0.125 : 0.075;
  for (const side of ['L', 'R']) {
    const sx = side === 'L' ? 1 : -1;
    const th = B['thigh' + side], sn = B['shin' + side], ft = B['foot' + side];
    P.add(caps(legR, 0.34), th, pants, 0, { matrix: T(0, -0.21, 0), blend: { parent: B.hips, len: 0.1, fromTop: true }, blood: blood * 0.7, dirt: 0.2 });
    if (!female) {
      // cargo pocket
      P.add(rbox(0.035, 0.14, 0.1, 0.012), th, pants, 0, { matrix: T(sx * (legR + 0.01), -0.22, 0.0), dirt: 0.25 });
      // thigh holster / strap on the right
      if (sx < 0 && spec.vest) {
        P.add(rbox(0.04, 0.16, 0.09, 0.01), th, dark, 0, { matrix: T(sx * (legR + 0.02), -0.12, 0.0) });
      }
    }
    // knee
    P.add(sph(legR * 0.85, 10, 8), sn, pants, 0, { matrix: T(0, 0, 0), blend: { parent: th, len: 0.06, fromTop: true } });
    if (!female && spec.vest) P.add(rbox(0.1, 0.1, 0.05, 0.02), sn, C(0x111213), 0, { matrix: TRS(0, -0.03, legR * 0.8, -0.1, 0, 0) });
    P.add(caps(legR * 0.78, 0.32), sn, pants, 0, { matrix: T(0, -0.2, 0), blend: { parent: th, len: 0.07, fromTop: true }, blood: blood * 0.5, dirt: 0.3 });
    // boot
    const bs = brute ? 1.35 : female ? 0.88 : 1;
    P.add(cyl(legR * 0.8, legR * 0.85, 0.16, 12), ft, boots, 0, { matrix: T(0, 0.02, 0), blend: { parent: sn, len: 0.05, fromTop: true }, dirt: 0.3 });
    P.add(rbox(0.1 * bs, 0.09, 0.27 * bs, 0.03), ft, boots, 0, { matrix: T(0, -0.035, 0.05 * bs), dirt: 0.35 });
    P.add(rbox(0.105 * bs, 0.025, 0.28 * bs, 0.01), ft, C(0x0a0a0a), 0, { matrix: T(0, -0.07, 0.05 * bs) });
  }

  return { geometry: P.build(), bindPos };
}

function buildHead(P, spec, skin, C) {
  const h = spec.head;
  const blood = spec.blood ?? 0.35;
  const white = C(0xd8d2b8);
  if (h === 'soldier') {
    // balaclava face + helmet + goggles
    const bal = C(0x16171a);
    P.add(sph(0.105, 16, 12), B.head, bal, 0, { matrix: TRS(0, 0.1, 0.01, 0, 0, 0, 0.98, 1.15, 1.05) });
    // eyes window with skin
    P.add(rbox(0.12, 0.035, 0.03, 0.012), B.head, skin, 0, { matrix: T(0, 0.12, 0.1), dirt: 0 });
    // goggles
    P.add(rbox(0.15, 0.045, 0.035, 0.015), B.head, C(0x0c0c0c), 0, { matrix: T(0, 0.13, 0.108) });
    for (const sx of [-1, 1]) P.add(sph(0.022, 10, 6), B.head, C(0x2a3a3a), 0, { matrix: TRS(sx * 0.035, 0.13, 0.126, 0, 0, 0, 1, 0.8, 0.4) });
    // helmet
    const helm = C(spec.helmet ?? 0x3a3f33);
    P.add(new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), B.head, helm, 0, { matrix: T(0, 0.14, 0), dirt: 0.25 });
    P.add(cyl(0.137, 0.14, 0.02, 18), B.head, helm, 0, { matrix: T(0, 0.12, 0) });
    P.add(rbox(0.05, 0.035, 0.03, 0.01), B.head, C(0x1b1b1b), 0, { matrix: T(0, 0.2, 0.12) }); // NVG mount
    // ears (covered) + comms
    for (const sx of [-1, 1]) P.add(cyl(0.035, 0.035, 0.03, 12), B.head, C(0x1b1c1e), 0, { matrix: TRS(sx * 0.11, 0.1, 0, 0, 0, Math.PI / 2) });
    return;
  }
  const fleshScale = 1.6;
  if (h === 'striker') {
    // hood + goggles + oxygen mask over a pale bloody face
    const suit = C(spec.shirt);
    P.add(sph(0.1, 16, 12), B.head, skin, 1, { matrix: TRS(0, 0.1, 0.01, 0, 0, 0, 0.95, 1.12, 1.02), uvScale: fleshScale });
    P.add(new THREE.SphereGeometry(0.125, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.72), B.head, suit, 0, { matrix: TRS(0, 0.1, -0.015, -0.25, 0, 0, 1, 1.12, 1.05), blood, dirt: 0.2 });
    // hair strands falling out
    for (let i = 0; i < 5; i++) P.add(caps(0.012, 0.09, 5, 2), B.head, C(0x1a120c), 0, { matrix: TRS(-0.06 + i * 0.03, 0.05, 0.09, 0.3, 0, (i - 2) * 0.12) });
    // goggles
    P.add(rbox(0.14, 0.04, 0.03, 0.015), B.head, C(0x151515), 0, { matrix: T(0, 0.13, 0.1) });
    for (const sx of [-1, 1]) P.add(cyl(0.024, 0.024, 0.02, 12), B.head, C(0x6b7a4a), 0, { matrix: TRS(sx * 0.035, 0.13, 0.118, Math.PI / 2, 0, 0) });
    // oxygen mask + hose
    P.add(cyl(0.03, 0.045, 0.06, 12), B.head, C(0x2a2a2a), 0, { matrix: TRS(0, 0.045, 0.11, Math.PI / 2 - 0.2, 0, 0) });
    P.add(cyl(0.012, 0.012, 0.25, 6), B.head, C(0x1a1a1a), 0, { matrix: TRS(0.04, -0.05, 0.08, 0.6, 0, 0.5) });
    return;
  }
  // zombie (mauler / charger / crusher): bald blood-red head, sunken eyes, exposed teeth
  const scale = h === 'crusher' ? 1.25 : 1;
  const s = (v) => v * scale;
  P.add(sph(s(0.1), 18, 14), B.head, skin, 1, { matrix: TRS(0, s(0.1), s(0.005), 0, 0, 0, 1.0, 1.18, 1.08), uvScale: fleshScale, dirt: 0.2 });
  // brow ridge
  P.add(caps(s(0.018), s(0.1), 6, 2), B.head, skin, 1, { matrix: TRS(0, s(0.14), s(0.095), 0, 0, Math.PI / 2), uvScale: fleshScale });
  // cheekbones
  for (const sx of [-1, 1]) P.add(sph(s(0.03), 10, 6), B.head, skin, 1, { matrix: T(sx * s(0.05), s(0.085), s(0.085)), uvScale: fleshScale });
  // nose (ragged)
  P.add(new THREE.ConeGeometry(s(0.018), s(0.04), 6), B.head, skin, 1, { matrix: TRS(0, s(0.105), s(0.115), Math.PI / 2 + 0.3, 0, 0), uvScale: fleshScale });
  // jaw hanging open
  P.add(rbox(s(0.085), s(0.04), s(0.08), s(0.018)), B.head, skin, 1, { matrix: TRS(0, s(0.025), s(0.06), 0.35, 0, 0), uvScale: fleshScale });
  // teeth (upper + lower rows)
  for (let i = 0; i < 6; i++) {
    const x = (i - 2.5) * s(0.012);
    P.add(rbox(s(0.01), s(0.016), s(0.008), s(0.002), 1), B.head, white, 0, { matrix: T(x, s(0.058), s(0.1)), dirt: 0.25 });
    P.add(rbox(s(0.01), s(0.014), s(0.008), s(0.002), 1), B.head, white, 0, { matrix: TRS(x, s(0.042), s(0.093), 0.35, 0, 0), dirt: 0.3 });
  }
  // eyes: pale, bloodshot
  for (const sx of [-1, 1]) {
    P.add(sph(s(0.019), 10, 8), B.head, C(0x1a0505), 0, { matrix: T(sx * s(0.036), s(0.122), s(0.084)) });
    P.add(sph(s(0.014), 10, 8), B.head, C(0xe8e0b8), 0, { matrix: T(sx * s(0.036), s(0.122), s(0.093)) });
  }
  // ears (torn)
  for (const sx of [-1, 1]) P.add(sph(s(0.025), 8, 6), B.head, skin, 1, { matrix: TRS(sx * s(0.1), s(0.1), 0, 0, 0, 0, 0.4, 1.1, 0.8), uvScale: fleshScale });
  if (h === 'crusher') {
    // pustules / tumors
    for (let i = 0; i < 7; i++) {
      const a = i * 1.7;
      P.add(sph(s(0.022 + (i % 3) * 0.008), 8, 6), B.head, skin, 1, { matrix: T(Math.cos(a) * s(0.07), s(0.16 + (i % 2) * 0.03), Math.sin(a) * s(0.07) - s(0.02)), uvScale: fleshScale });
    }
  }
}

// ---------------------------------------------------------------- materials
let MATS = null;
function materials() {
  if (MATS) return MATS;
  let cloth = null, flesh = null;
  try {
    cloth = tex('clothDetail');
  } catch (e) {
    /* optional */
  }
  try {
    flesh = tex('flesh');
  } catch (e) {
    /* optional */
  }
  const clothMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
    map: cloth?.map ?? null,
    normalMap: cloth?.normalMap ?? null,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  const fleshMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    map: flesh?.map ?? null,
    normalMap: flesh?.normalMap ?? null,
    roughnessMap: flesh?.roughnessMap ?? null,
    normalScale: new THREE.Vector2(1.2, 1.2),
  });
  const ledMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff1100, emissiveIntensity: 0 });
  MATS = { clothMat, fleshMat, ledMat };
  return MATS;
}

// ---------------------------------------------------------------- templates
export const BODY_SPECS = {
  mauler: { build: 'male', head: 'zombie', shirt: 0x17181a, pants: 0x3d3f35, vest: 0x1b1c1d, boots: 0x121212, skin: 0xffc8c0, blood: 0.45 },
  mauler2: { build: 'male', head: 'zombie', shirt: 0x1d1f1b, pants: 0x2c2e2a, vest: 0x262a22, boots: 0x161310, skin: 0xf0b4ac, blood: 0.5, rolledSleeves: true },
  charger: { build: 'male', head: 'zombie', shirt: 0x141414, pants: 0x8a7a58, vest: null, boots: 0x2a2018, skin: 0xffd0c4, blood: 0.35, dynamite: true },
  striker: { build: 'female', head: 'striker', shirt: 0xb9b3a5, pants: 0xaea897, vest: null, boots: 0x1a1a1a, skin: 0xe0b0a0, blood: 0.85, gloves: 0x202020, dirtAmt: 0.35 },
  crusher: { build: 'brute', head: 'crusher', shirt: 0x2a4a6e, pants: 0x2c3646, vest: null, boots: 0x101418, skin: 0x5a86b8, blood: 0.25, rolledSleeves: true, shirtless: true },
  soldier: { build: 'male', head: 'soldier', shirt: 0x2a2d28, pants: 0x3b3d33, vest: 0x44463a, boots: 0x1a1612, skin: 0xb08068, blood: 0, gloves: 0x111111, helmet: 0x3e4236 },
  soldier2: { build: 'male', head: 'soldier', shirt: 0x1d2024, pants: 0x25282c, vest: 0x2b2e33, boots: 0x121212, skin: 0x8a5a40, blood: 0, gloves: 0x0e0e0e, helmet: 0x23262a },
};

const templates = new Map();

function makeTemplate(kind) {
  const spec = BODY_SPECS[kind];
  const { geometry, bindPos } = buildBody(spec);
  const bones = [];
  for (let i = 0; i < BONES.length; i++) {
    const [name, parent, off] = BONES[i];
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(off[0], off[1], off[2]);
    if (parent >= 0) bones[parent].add(b);
    bones.push(b);
  }
  const skeleton = new THREE.Skeleton(bones);
  const { clothMat, fleshMat, ledMat } = materials();
  let fm = fleshMat;
  if (spec.head === 'crusher') {
    // blue, bloated skin: keep the flesh relief but drop the red albedo
    if (!MATS.blueFlesh) {
      MATS.blueFlesh = fleshMat.clone();
      MATS.blueFlesh.map = null;
      MATS.blueFlesh.roughness = 0.45;
      MATS.blueFlesh.emissive = new THREE.Color(0x0a2240);
      MATS.blueFlesh.emissiveIntensity = 0.6;
    }
    fm = MATS.blueFlesh;
  }
  const mesh = new THREE.SkinnedMesh(geometry, [clothMat, fm, ledMat]);
  mesh.add(bones[0]);
  mesh.bind(skeleton);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return { mesh, bindPos, spec };
}

/**
 * Create a new character instance of the given body kind. Returns { root, mesh, bones: {name: Bone}, spec, led? }.
 * GLB kinds (gltfCharacter.js) also return rig (call rig.sync() after posing the bones), hit and glow;
 * if their model is missing they fall back to a procedural body.
 */
export function createCharacter(kind, scale = 1, opts) {
  if (GLB_BODIES[kind]) {
    const c = createGLBCharacter(kind, scale, opts);
    if (c) return c;
    kind = GLB_BODIES[kind].fallback;
  }
  if (!templates.has(kind)) templates.set(kind, makeTemplate(kind));
  const t = templates.get(kind);
  const root = new THREE.Group();
  const mesh = cloneSkinned(t.mesh);
  mesh.material = t.mesh.material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 2.1);
  root.add(mesh);
  root.scale.setScalar(scale);
  const bones = {};
  mesh.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
  });
  const out = { root, mesh, bones, spec: t.spec };
  if (t.spec.dynamite) {
    const { ledMat } = materials();
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), ledMat.clone());
    led.position.set(0.05, 0.225, 0.2);
    bones.chest.add(led);
    out.led = led;
  }
  return out;
}

/** Warm up: build all templates (so first spawn doesn't hitch). */
export function prebuildCharacters() {
  for (const k of Object.keys(BODY_SPECS)) if (!templates.has(k)) templates.set(k, makeTemplate(k));
  prebuildGLBCharacters();
}

export function characterMaterials() {
  return materials();
}
