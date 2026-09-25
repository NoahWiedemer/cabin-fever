// Shared PBR materials built on top of the procedural texture sets.
import * as THREE from 'three';
import { tex } from './textures.js';

// name -> definition
const DEFS = {
  woodFloor: { tex: 'woodFloor', roughness: 1, normalScale: 1.1 },
  plaster: { tex: 'plaster', roughness: 1, normalScale: 0.9, mprScale: 1.7 },
  plasterExterior: { tex: 'plasterExterior', roughness: 1, normalScale: 1.0, mprScale: 1.4 },
  woodBeam: { tex: 'woodBeam', roughness: 1, normalScale: 1.3 },
  ceilingBoards: { tex: 'ceilingBoards', roughness: 1, normalScale: 1.0 },
  woodPainted: { tex: 'woodPainted', roughness: 1, normalScale: 1.0 },
  concrete: { tex: 'concrete', roughness: 1, normalScale: 1.0 },
  roof: { tex: 'roof', roughness: 1, normalScale: 1.2 },
  mud: { tex: 'mud', roughness: 1, normalScale: 1.2, envMapIntensity: 1.6 },
  brick: { tex: 'brick', roughness: 1, normalScale: 1.2 },
  rustyMetal: { tex: 'rustyMetal', roughness: 1, metalness: 1, normalScale: 1.0 },
  metalDark: { tex: 'metalDark', roughness: 1, metalness: 1, normalScale: 0.8 },
  crateWood: { tex: 'crateWood', roughness: 1, normalScale: 1.0 },
  cardboard: { tex: 'cardboard', roughness: 1, normalScale: 0.8 },
  fabric: { tex: 'fabric', roughness: 1, normalScale: 0.8 },
  cloth: { tex: 'clothDetail', roughness: 1, normalScale: 0.7 },
  porcelain: { tex: 'porcelain', roughness: 1, normalScale: 0.6 },
  bark: { tex: 'bark', roughness: 1, normalScale: 1.4 },
  foliage: { tex: 'foliage', roughness: 0.9, alphaTest: 0.45, side: THREE.DoubleSide },
  flesh: { tex: 'flesh', roughness: 1, normalScale: 1.0 },
  gunMetal: { tex: 'gunMetal', roughness: 1, metalness: 1, normalScale: 0.6 },
  paintRed: { tex: 'metalDark', useMap: false, color: 0x7a1510, roughness: 1, metalness: 0.0, normalScale: 0.8 },
  paintGreen: { tex: 'metalDark', useMap: false, color: 0x3a4128, roughness: 1, metalness: 0.0, normalScale: 0.8 },
  // ranch (src/world/barn.js, ranch.js)
  barnSiding: { tex: 'barnSiding', roughness: 1, normalScale: 1.25 },
  barnPlanks: { tex: 'barnPlanks', roughness: 1, normalScale: 1.2 },
  barnTrim: { tex: 'woodPainted', color: 0xd8d2c4, roughness: 1, normalScale: 1.0 },
  tinRoof: { tex: 'tinRoof', roughness: 1, metalness: 1, normalScale: 1.1 },
  barnFloor: { tex: 'concrete', color: 0xa3927c, roughness: 1, normalScale: 1.1 },
  gravel: { tex: 'gravel', roughness: 1, normalScale: 1.3 },
  straw: { tex: 'straw', roughness: 1, normalScale: 1.3 },
  // the barn's own instances of the above (world/barnFire.js chars them without touching the rest)
  barnTin: { tex: 'tinRoof', roughness: 1, metalness: 1, normalScale: 1.1 },
  barnSheathing: { tex: 'barnPlanks', roughness: 1, normalScale: 1.2 },
  barnGable: { tex: 'barnSiding', roughness: 1, normalScale: 1.25 },
  barnGableIn: { tex: 'barnPlanks', roughness: 1, normalScale: 1.2 },
  barnTimber: { tex: 'woodBeam', roughness: 1, normalScale: 1.3 },
  barnBarge: { tex: 'woodPainted', color: 0xd8d2c4, roughness: 1, normalScale: 1.0 },
  barnStraw: { tex: 'straw', roughness: 1, normalScale: 1.3 },
  glass: { custom: 'glass' },
  bulb: { custom: 'bulb' },
  rubber: { color: 0x0d0d0d, roughness: 0.92, metalness: 0 },
  blackPlastic: { color: 0x141414, roughness: 0.55, metalness: 0 },
  brass: { color: 0xb08a4e, roughness: 0.35, metalness: 1 },
  chrome: { color: 0xd0d0d0, roughness: 0.18, metalness: 1 },
};

const cache = new Map();

function build(name) {
  const def = DEFS[name];
  if (!def) throw new Error('Unknown material ' + name);
  if (def.custom === 'glass') {
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x8a9a96,
      roughness: 0.25,
      metalness: 0,
      transmission: 0,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
      side: THREE.DoubleSide,
      envMapIntensity: 1.5,
    });
    m.userData.metersPerRepeat = 1;
    return m;
  }
  if (def.custom === 'bulb') {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffe2b0,
      emissive: 0xffb866,
      emissiveIntensity: 14,
      roughness: 0.2,
    });
    m.userData.metersPerRepeat = 1;
    return m;
  }
  const params = {
    color: def.color ?? 0xffffff,
    roughness: def.roughness ?? 1,
    metalness: def.metalness ?? 0,
  };
  let metersPerRepeat = 1;
  if (def.tex) {
    const t = tex(def.tex);
    metersPerRepeat = (t.metersPerRepeat ?? 1) * (def.mprScale ?? 1);
    if (t.map && def.useMap !== false) params.map = t.map;
    if (t.normalMap) {
      params.normalMap = t.normalMap;
      const s = def.normalScale ?? 1;
      params.normalScale = new THREE.Vector2(s, s);
    }
    if (t.roughnessMap) params.roughnessMap = t.roughnessMap;
    if (t.metalnessMap && def.metalness) params.metalnessMap = t.metalnessMap;
    if (t.aoMap) {
      params.aoMap = t.aoMap;
      params.aoMapIntensity = 0.8;
    }
    if (t.alphaMap) params.alphaMap = t.alphaMap;
  }
  if (def.alphaTest) params.alphaTest = def.alphaTest;
  if (def.side) params.side = def.side;
  if (def.envMapIntensity) params.envMapIntensity = def.envMapIntensity;
  const m = new THREE.MeshStandardMaterial(params);
  m.userData.metersPerRepeat = metersPerRepeat;
  m.name = name;
  return m;
}

/**
 * Returns a shared cached material.
 * opts: { color, emissive, emissiveIntensity, vertexColors, roughness, metalness }
 */
export function getMaterial(name, opts = {}) {
  const key =
    name +
    '|' +
    (opts.color ?? '') +
    '|' +
    (opts.emissive ?? '') +
    '|' +
    (opts.emissiveIntensity ?? '') +
    '|' +
    (opts.vertexColors ? 'vc' : '') +
    '|' +
    (opts.roughness ?? '') +
    '|' +
    (opts.metalness ?? '');
  let m = cache.get(key);
  if (m) return m;
  const base = cache.get(name + '||||||') || build(name);
  if (!cache.has(name + '||||||')) cache.set(name + '||||||', base);
  if (key === name + '||||||') return base;
  m = base.clone();
  m.userData = { ...base.userData };
  if (opts.color !== undefined) m.color = new THREE.Color(opts.color);
  if (opts.emissive !== undefined) m.emissive = new THREE.Color(opts.emissive);
  if (opts.emissiveIntensity !== undefined) m.emissiveIntensity = opts.emissiveIntensity;
  if (opts.vertexColors) m.vertexColors = true;
  if (opts.roughness !== undefined) m.roughness = opts.roughness;
  if (opts.metalness !== undefined) m.metalness = opts.metalness;
  cache.set(key, m);
  return m;
}

export function allMaterials() {
  return [...cache.values()];
}
