// Resilient access to the gun model library with simple fallbacks.
import * as THREE from 'three';
import * as G from './gunModels.js';
import { buildGltfWeapon, hasGltfWeapon } from './gltfGuns.js';
import { buildGltfArms, hasGltfArms } from './gltfArms.js';
import { buildBarricadeKit } from './barricadeKit.js';
import { buildMachete } from './machete.js';

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
const STAND_IN = { m16a2: 'm4a1', spas12: 'm4super90', r201: 'm4a1', devotion: 'm4a1', sigma: 'm4a1', p90: 'm4a1', mozambique: 'm9', softball: 'm32', molotov: 'm67' };

export function buildWeaponModel(id) {
  if (id === 'barricade') return buildBarricadeKit();
  if (id === 'machete') return buildMachete(); // store gear (game/gear.js)
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

// Grip markers of the light third-person models (same gun space as the first-person ones: root at the
// grip web, muzzle along -Z). m4a1 matches the procedural first-person M4A1's markers.
const TP_MARKERS = {
  // eye: where the shooter's eye sits when aiming down the sights (gun space)
  m4a1: { muzzle: [0, 0.047, -0.59], rightHand: [0, -0.005, -0.018], leftHand: [0, 0.049, -0.331], eye: [0, 0.11, 0.13] },
  m4super90: { muzzle: [0, 0.05, -0.74], rightHand: [0, -0.006, -0.016], leftHand: [0, 0.012, -0.39], eye: [0, 0.1, 0.12] },
};

/**
 * A gun for an AI teammate's hands: { root, muzzle, rightHand, leftHand, eye (Vector3s in gun space; eye =
 * the shooter's eye when aiming down the sights), stock (z of the butt), shellType, glb }. GLB guns bring their own markers; anything else is the
 * cheap third-person model (its stand-in for a missing GLB) with the M4A1 markers.
 */
export function buildBotWeapon(id) {
  if (hasGltfWeapon(id)) {
    try {
      const m = buildGltfWeapon(id);
      m.root.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m.root);
      const R = m.rightHand.position.clone();
      const eye = m.sight?.eye ? m.sight.eye.clone() : new THREE.Vector3(0, 0.11, box.max.z * 0.5);
      return { root: m.root, muzzle: m.muzzle.position.clone(), rightHand: R, leftHand: m.leftHand ? m.leftHand.position.clone() : R.clone(), eye, stock: box.max.z, shellType: m.shellType, glb: true };
    } catch (e) {
      console.warn('GLB bot weapon failed', id, e);
    }
  }
  const tp = STAND_IN[id] ?? id;
  const root = buildThirdPersonWeapon(tp);
  root.updateMatrixWorld(true);
  const mk = TP_MARKERS[tp] ?? TP_MARKERS.m4a1;
  const box = new THREE.Box3().setFromObject(root);
  const v = (a) => new THREE.Vector3(a[0], a[1], a[2]);
  return { root, muzzle: v(mk.muzzle), rightHand: v(mk.rightHand), leftHand: v(mk.leftHand), eye: v(mk.eye ?? [0, 0.11, 0.13]), stock: box.isEmpty() ? 0.25 : box.max.z, shellType: tp === 'm4super90' ? 'shotgun' : 'rifle', glb: false };
}
