// Resilient access to the gun model library with simple fallbacks.
import * as THREE from 'three';
import * as G from './gunModels.js';
import { buildGltfWeapon, hasGltfWeapon } from './gltfGuns.js';
import { buildGltfArms, hasGltfArms } from './gltfArms.js';

const fbMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.6 });

function fallbackWeapon(id) {
  const root = new THREE.Group();
  const len = id === 'm9' ? 0.2 : id === 'knife' ? 0.3 : id === 'm67' ? 0.08 : 0.75;
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, len), fbMat);
  body.position.set(0, 0.04, -len / 2 + 0.1);
  root.add(body);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, -len + 0.1);
  root.add(muzzle);
  const rightHand = new THREE.Object3D();
  root.add(rightHand);
  const leftHand = new THREE.Object3D();
  leftHand.position.set(0, 0.0, -len * 0.55);
  root.add(leftHand);
  const ejectPort = new THREE.Object3D();
  ejectPort.position.set(0.03, 0.06, -0.05);
  root.add(ejectPort);
  return { root, muzzle, ejectPort, rightHand, leftHand: id === 'knife' ? null : leftHand, sight: { eye: new THREE.Vector3(0, 0.1, 0.12) }, parts: {}, shellType: 'rifle' };
}

// GLB weapons borrow a procedural model when their file is missing or broken
const STAND_IN = { m16a2: 'm4a1', spas12: 'm4super90', r201: 'm4a1', devotion: 'm4a1', sigma: 'm4a1', mozambique: 'm9', softball: 'm32', molotov: 'm67' };

export function buildWeaponModel(id) {
  if (hasGltfWeapon(id)) {
    try {
      return buildGltfWeapon(id);
    } catch (e) {
      console.warn('GLB weapon model failed', id, e);
    }
  }
  if (typeof G.buildWeaponModel === 'function') {
    try {
      return G.buildWeaponModel(STAND_IN[id] ?? id);
    } catch (e) {
      console.warn('weapon model fallback', id, e.message);
    }
  }
  return fallbackWeapon(id);
}

export function buildArms() {
  if (hasGltfArms()) {
    try {
      return buildGltfArms();
    } catch (e) {
      console.warn('GLB arms failed, using procedural arms', e);
    }
  }
  if (typeof G.buildArms === 'function') return G.buildArms();
  return { root: new THREE.Group(), update() {}, setFingerCurl() {} };
}

export function buildShellCasing(type) {
  if (typeof G.buildShellCasing === 'function') {
    try {
      return G.buildShellCasing(type);
    } catch (e) {
      /* fall through */
    }
  }
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, type === 'shotgun' ? 0.07 : 0.045, 8), new THREE.MeshStandardMaterial({ color: type === 'shotgun' ? 0x991a12 : 0xb08a4e, metalness: 0.8, roughness: 0.35 }));
  return m;
}

export function buildThirdPersonWeapon(id) {
  if (typeof G.buildThirdPersonWeapon === 'function') {
    try {
      return G.buildThirdPersonWeapon(id);
    } catch (e) {
      /* fall through */
    }
  }
  return fallbackWeapon(id).root;
}
