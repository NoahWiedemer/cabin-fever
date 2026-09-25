// First-person weapons whose geometry comes from preloaded GLBs, adapted to the same contract as
// the procedural builders in gunModels.js (root at the grip web, forward -Z, parts, hand empties).
// All GLBs follow the tools/blender contract (node names `${prefix}_${name}`: web, muzzle, ejectPort,
// rightHand, leftHand, rearSight markers + part empties). `baked` models (built in Blender, `wear_ao`
// vertex colors) are re-materialed with the procedural gun materials; imported ones keep theirs.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { adoptBakedGeometry, BAKED_MATERIALS, gunMaterial, handTarget } from './gunModels.js';

const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const _m = new THREE.Matrix4();

const BAKED = {
  m16a2: {
    prefix: 'm16',
    parts: ['mag', 'bolt', 'chargingHandle', 'trigger'],
    shellType: 'rifle',
    // same A2 grip as the M4A1; the left hand wraps the round handguard
    right: { palm: [-1, 0, 0], index: [0, Math.cos(20 * DEG), -Math.sin(20 * DEG)], data: { rx: 0.0145, rz: 0.021, curl: 1, trigger: true, thumb: 0.75 } },
    left: { palm: [0.3, 1, 0], index: [0, 0, -1], data: { rx: 0.026, rz: 0.028, curl: 0.85, thumb: 0.2 } },
    eyeBack: 0.045, // camera distance behind the rear aperture when aiming
    baked: true,
  },
  r201: {
    prefix: 'r201',
    parts: ['mag'],
    shellType: 'rifle',
    right: { palm: [-1, 0, 0], index: [0, Math.cos(20 * DEG), -Math.sin(20 * DEG)], data: { rx: 0.015, rz: 0.022, curl: 1, trigger: true, thumb: 0.75 } },
    left: { palm: [0.25, 1, 0], index: [0, 0, -1], data: { rx: 0.024, rz: 0.03, curl: 0.85, thumb: 0.2 } },
    eyeBack: 0.085,
  },
  spas12: {
    prefix: 'spas12',
    parts: ['pump', 'bolt'],
    shellType: 'shotgun',
    right: { palm: [-1, 0, 0], index: [0, Math.cos(12 * DEG), -Math.sin(12 * DEG)], data: { rx: 0.016, rz: 0.022, curl: 1, trigger: true, thumb: 0.75 } },
    left: { palm: [0.3, 1, 0], index: [0, 0, -1], data: { rx: 0.03, rz: 0.03, curl: 0.85, thumb: 0.25 } },
    eyeBack: 0.12, // no rear sight: look down the receiver over the folded stock
    pumpStroke: 0.075,
  },
  devotion: {
    prefix: 'devotion',
    parts: ['mag'],
    shellType: 'rifle',
    right: { palm: [-1, 0, 0], index: [0, Math.cos(21 * DEG), -Math.sin(21 * DEG)], data: { rx: 0.016, rz: 0.022, curl: 1, trigger: true, thumb: 0.75 } },
    left: { palm: [0.3, 1, 0], index: [0, 0, -1], data: { rx: 0.028, rz: 0.03, curl: 0.85, thumb: 0.2 } },
    eyeBack: 0.07,
  },
  sigma: {
    prefix: 'sigma',
    parts: ['mag'], // the drum
    shellType: 'rifle',
    // raked pistol grip; the left hand wraps the wide slab under the barrel shroud
    right: { palm: [-1, 0, 0], index: [0, Math.cos(20 * DEG), -Math.sin(20 * DEG)], data: { rx: 0.0165, rz: 0.022, curl: 1, trigger: true, thumb: 0.75 } },
    left: { palm: [0.25, 1, 0], index: [0, 0, -1], data: { rx: 0.036, rz: 0.03, curl: 0.8, thumb: 0.15 } },
    eyeBack: 0.075, // behind the peep; the top spike of the brake is the front post
  },
  p90: {
    prefix: 'p90',
    parts: ['mag'], // lies on top of the receiver under the rail
    magTop: true, // reload lifts it up and off instead of dropping it out of a well
    shellType: 'pistol',
    // near-vertical grip bar in front of the thumbhole; the support hand wraps the curved front grip
    right: { palm: [-1, 0, 0], index: [0, Math.cos(10 * DEG), -Math.sin(10 * DEG)], data: { rx: 0.017, rz: 0.02, curl: 1, trigger: true, thumb: 0.7 } },
    left: { palm: [1, 0, 0], index: [0, Math.cos(15 * DEG), -Math.sin(15 * DEG)], data: { rx: 0.016, rz: 0.013, curl: 1.05, thumb: 0.55 } },
    eyeBack: 0.1, // the sight line clears the solid rear sight block: the front post sits in its notch
  },
  mozambique: {
    prefix: 'mozambique',
    parts: [],
    shellType: 'shotgun',
    // two-handed pistol grip like the M9: the support hand cups the firing hand
    right: { palm: [-1, 0, 0], index: [0, Math.cos(25 * DEG), -Math.sin(25 * DEG)], data: { rx: 0.0185, rz: 0.021, curl: 1, trigger: true, thumb: 0.55 } },
    left: { palm: [1, 0, 0.12], index: [0, Math.cos(25 * DEG), -Math.sin(25 * DEG)], data: { rx: 0.031, rz: 0.035, curl: 0.95, thumb: 0.3, gy: 0.03 } },
    eyeBack: 0.12,
  },
  softball: {
    prefix: 'softball',
    parts: ['cylinder'],
    shellType: 'grenade40',
    right: { palm: [-1, 0, 0], index: [0, Math.cos(25 * DEG), -Math.sin(25 * DEG)], data: { rx: 0.016, rz: 0.022, curl: 1, trigger: true, thumb: 0.75 } },
    // vertical foregrip
    left: { palm: [1, 0, 0], index: [0, Math.cos(8 * DEG), Math.sin(8 * DEG)], data: { rx: 0.0165, rz: 0.0165, curl: 1.05, thumb: 0.65 } },
    eyeBack: 0.08,
  },
  molotov: {
    prefix: 'molotov',
    parts: [],
    shellType: null,
    right: { palm: [-1, 0, 0], index: [0, Math.cos(12 * DEG), -Math.sin(12 * DEG)], data: { rx: 0.034, rz: 0.034, curl: 0.78, thumb: 0.5, gy: 0.02 } },
    left: null,
    eyeBack: 0.1,
  },
};

export function hasGltfWeapon(id) {
  return id in BAKED && !!getGLB(MODELS[id]);
}

export function buildGltfWeapon(id) {
  const gltf = getGLB(MODELS[id]);
  if (!gltf || !BAKED[id]) throw new Error('gltfGuns: no model for ' + id);
  return buildBaked(id, BAKED[id], gltf);
}

/** Quantized (meshopt / KHR_mesh_quantization) attributes -> float32, so transforms don't clamp or round. */
export function dequantize(geo) {
  for (const name of ['position', 'normal', 'uv', 'uv1']) {
    const a = geo.attributes[name];
    if (!a || a.array instanceof Float32Array) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    geo.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return geo;
}

function underAny(o, set) {
  for (let p = o.parent; p; p = p.parent) if (set.has(p)) return true;
  return false;
}

/** Merge meshes per material into `parent`. `space` = node whose frame the geometry is expressed in. */
function mergeInto(parent, meshes, space, offset, baked) {
  const inv = new THREE.Matrix4().copy(space.matrixWorld).invert();
  const groups = new Map(); // material -> geometries
  for (const mesh of meshes) {
    const geo = dequantize(mesh.geometry.clone());
    geo.applyMatrix4(_m.multiplyMatrices(inv, mesh.matrixWorld));
    if (offset) geo.translate(offset.x, offset.y, offset.z);
    let mat = mesh.material;
    let g = geo;
    if (baked) {
      const [key, tint] = BAKED_MATERIALS[mesh.material.name] ?? ['park'];
      g = adoptBakedGeometry(geo, key, tint);
      geo.dispose();
      mat = gunMaterial(key);
    }
    if (!groups.has(mat)) groups.set(mat, []);
    groups.get(mat).push(g);
  }
  for (const [mat, list] of groups) {
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    for (const geo of merged ? [merged] : list) {
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = parent.name + '_' + mat.name;
      mesh.castShadow = !mat.transparent;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
  }
}

function buildBaked(id, spec, gltf) {
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const find = (n) => {
    const o = src.getObjectByName(`${spec.prefix}_${n}`);
    if (!o) throw new Error(`gltfGuns: ${id} is missing node ${spec.prefix}_${n}`);
    return o;
  };
  const off = find('web').getWorldPosition(new V3()).negate();
  const at = (n) => find(n).getWorldPosition(new V3()).add(off);

  const root = new THREE.Group();
  root.name = id;
  const parts = {};
  const partNodes = new Set();
  for (const p of spec.parts) {
    const node = find(p);
    const g = new THREE.Group();
    g.name = p;
    g.position.copy(at(p));
    root.add(g);
    parts[p] = g;
    partNodes.add(node);
    const meshes = [];
    node.traverse((o) => o.isMesh && meshes.push(o));
    mergeInto(g, meshes, node, null, spec.baked);
  }
  const statics = [];
  src.traverse((o) => o.isMesh && !underAny(o, partNodes) && statics.push(o));
  mergeInto(root, statics, src, off, spec.baked);

  const toArr = (v) => [v.x, v.y, v.z];
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.copy(at('muzzle'));
  const ejectPort = new THREE.Object3D();
  ejectPort.name = 'ejectPort';
  ejectPort.position.copy(at('ejectPort'));
  root.add(muzzle, ejectPort);
  const rightHand = handTarget('rightHand', root, toArr(at('rightHand')), spec.right.palm, spec.right.index, false, spec.right.data);
  const leftHand = spec.left ? handTarget('leftHand', root, toArr(at('leftHand')), spec.left.palm, spec.left.index, true, spec.left.data) : null;
  const eye = at('rearSight').add(new V3(0, 0, spec.eyeBack));
  root.updateMatrixWorld(true);
  const res = { root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts, shellType: spec.shellType };
  if (spec.pumpStroke) res.pumpStroke = spec.pumpStroke;
  if (spec.magTop) res.magTop = true;
  if (src.getObjectByName(`${spec.prefix}_loadPort`)) res.loadPort = at('loadPort');
  if (src.getObjectByName(`${spec.prefix}_rag`)) {
    res.rag = new THREE.Object3D();
    res.rag.name = 'rag';
    res.rag.position.copy(at('rag'));
    root.add(res.rag);
  }
  if (parts.mag) {
    res.magazineModel = () => {
      const g = parts.mag.clone(true);
      g.position.set(0, 0, 0);
      return g;
    };
  }
  return res;
}
