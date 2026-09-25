// Resilient access to the prop library: falls back to simple placeholders for unknown types.
import * as THREE from 'three';
import * as P from './props.js';
import { getMaterial } from './materials.js';

const SIZES = {
  table: [1.6, 0.78, 0.9], chair: [0.45, 0.95, 0.45], shelfUnit: [1.0, 2.0, 0.4], cabinet: [0.9, 1.9, 0.45],
  dresser: [1.1, 1.0, 0.5], bed: [1.0, 0.6, 2.0], bathtub: [0.8, 0.65, 1.6], toilet: [0.4, 0.8, 0.65],
  sink: [0.55, 0.9, 0.45], stove: [0.8, 0.9, 0.7], fridge: [0.75, 1.65, 0.7], counter: [2.0, 0.92, 0.6],
  sofa: [2.0, 0.9, 0.9], crate: [0.8, 0.8, 0.8], crateLong: [1.3, 0.4, 0.45], cardboardBox: [0.5, 0.4, 0.4],
  cardboardStack: [0.9, 1.1, 0.7], barrel: [0.6, 0.9, 0.6], generator: [1.2, 0.9, 0.7], workbench: [1.8, 0.92, 0.7],
  bookshelf: [0.9, 1.9, 0.35], radio: [0.35, 0.25, 0.2], lantern: [0.15, 0.3, 0.15], bucket: [0.3, 0.3, 0.3],
  sandbags: [2.0, 0.6, 0.5], ammoCrate: [0.6, 0.5, 0.4], woodPile: [2.0, 1.0, 0.8], hayBale: [1.1, 0.45, 0.5],
  well: [1.4, 1.0, 1.4], tireStack: [0.8, 1.0, 0.8], wheelbarrow: [0.7, 0.6, 1.4], oilDrumFire: [0.6, 0.9, 0.6],
  carWreck: [2.0, 1.8, 5.2], powerPole: [0.3, 8, 0.3], fence: [3.0, 1.2, 0.1], sign: [0.8, 1.6, 0.1],
  pineTreeDead: [0.5, 11, 0.5], deadTree: [0.5, 7, 0.5], supplyBoxGreen: [0.45, 0.3, 0.35],
  supplyBoxRed: [0.45, 0.3, 0.35], supplyBoxWhite: [0.45, 0.3, 0.35],
};
const NO_COLLIDE = new Set(['wallShelfToolbox', 'hangingLamp', 'wireCable', 'boardedWindow', 'windowFrame', 'debrisPile', 'mattressFloor', 'bottles', 'papers', 'railing', 'cellarDoors', 'supplyBoxGreen', 'supplyBoxRed', 'supplyBoxWhite']);

function placeholder(type, opts = {}) {
  const g = new THREE.Group();
  if (type === 'hangingLamp') {
    const len = opts.cableLength ?? 0.8;
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, len, 4), getMaterial('rubber'));
    cable.position.y = -len / 2;
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.14, 16, 1, true), getMaterial('metalDark', { color: 0x2f4a36 }));
    shade.position.y = -len - 0.05;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), getMaterial('bulb'));
    bulb.position.y = -len - 0.12;
    g.add(cable, shade, bulb);
    return { object: g, colliders: [], anchors: { bulb: new THREE.Vector3(0, -len - 0.12, 0) } };
  }
  if (NO_COLLIDE.has(type) && !SIZES[type]) return { object: g, colliders: [] };
  const [w, h, d] = SIZES[type] || [0.6, 0.6, 0.6];
  const mat = type.startsWith('supplyBox') ? getMaterial('paintGreen', { color: type.endsWith('Red') ? 0x8a2018 : type.endsWith('White') ? 0xcfd2d4 : 0x2f6a30 }) : type.includes('Tree') ? getMaterial('bark') : getMaterial('crateWood');
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.y = h / 2;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return {
    object: g,
    colliders: NO_COLLIDE.has(type) ? [] : [{ min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] }],
  };
}

export function buildProp(type, opts = {}) {
  if (typeof P.buildProp === 'function') {
    try {
      const r = P.buildProp(type, opts);
      if (r && r.object) return r;
    } catch (e) {
      console.warn('prop fallback for', type, e.message);
    }
  }
  return placeholder(type, opts);
}

export function clearPropCache() {
  if (typeof P.clearPropCache === 'function') P.clearPropCache();
}
