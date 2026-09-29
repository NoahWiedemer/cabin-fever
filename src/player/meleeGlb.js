// First-person melee weapons from GLBs (store gear on the belt, game/gear.js: the tomahawk, the baseball bat), in the
// contract tools/melee-import.mjs writes: the handle along -Z with the head at -Z, the striking side down, the origin
// at the top hand's web, marker nodes <prefix>_rightHand / _leftHand / _muzzle. Held like the machete (player/
// machete.js): the weapon forward and up out of the fist; the bat in two hands, the left one below the right.
// batSwing: the bat's viewmodel swing (the tomahawk chops like the machete: macheteSwing).
import * as THREE from 'three';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { gunKit } from './gunModels.js';
import { dequantize } from './gltfGuns.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';

const V3 = THREE.Vector3;

// dir: the handle's way out of the fist (root space); palm: the right palm's normal; grip: the fist round the
// handle (handTarget data: rx / rz half sizes of the grip, curl, thumb); left: the second hand, or null
export const MELEE_GLB = {
  tomahawk: {
    prefix: 'tomahawk',
    dir: [-0.2, 0.62, -0.76],
    palm: [-1, -0.3, 0.12],
    grip: { rx: 0.0175, rz: 0.021, curl: 1.0, thumb: 0.9, gy: 0.024 },
    left: null,
  },
  bat: {
    prefix: 'bat',
    dir: [0.25, 0.85, -0.45], // upright on the right, the barrel up past the view's edge (the machete's lean would fill the screen)
    palm: [-1, -0.2, 0.1],
    grip: { rx: 0.0165, rz: 0.0165, curl: 1.05, thumb: 0.8, gy: 0.02 },
    left: { palm: [1, -0.2, 0.1], grip: { rx: 0.0165, rz: 0.0165, curl: 1.05, thumb: 0.8, gy: 0.02 } },
  },
};

export const hasMeleeGlb = (id) => id in MELEE_GLB && !!getGLB(MODELS[id]);

export function buildMeleeGlb(id) {
  const spec = MELEE_GLB[id];
  const gltf = getGLB(MODELS[id]);
  if (!spec || !gltf) throw new Error('meleeGlb: no model for ' + id);
  const K = gunKit;
  const src = gltf.scene;
  src.updateMatrixWorld(true);
  const node = (n) => src.getObjectByName(`${spec.prefix}_${n}`);
  const at = (n) => node(n).getWorldPosition(new V3());

  const root = K.grp(id);
  // the body: the model in its own (contract) frame, turned like the machete's blade so the handle runs along `dir`
  const body = K.grp('body', root);
  const dir = new V3(...spec.dir).normalize();
  const hq = K.handQuat(spec.palm, dir.toArray(), false);
  const Xh = new V3(1, 0, 0).applyQuaternion(hq), Yh = new V3(0, 1, 0).applyQuaternion(hq), Zh = new V3(0, 0, 1).applyQuaternion(hq);
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xh, Zh, Yh.clone().negate()));
  // the right fist's centre on the root's origin (where the viewmodel holds it)
  const right = at('rightHand');
  body.position.copy(right.clone().applyQuaternion(body.quaternion).negate());
  const meshes = [];
  src.traverse((o) => o.isMesh && meshes.push(o));
  for (const m of meshes) {
    const geo = dequantize(m.geometry.clone());
    geo.applyMatrix4(m.matrixWorld);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m.material);
    mesh.name = `${id}_${m.material.name || 'body'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    body.add(mesh);
  }
  const toRoot = (p) => p.clone().applyQuaternion(body.quaternion).add(body.position);
  const muzzle = K.empty('muzzle', root, toRoot(at('muzzle')).toArray());
  const rightHand = K.handTarget('rightHand', root, [0, 0, 0], spec.palm, dir.toArray(), false, spec.grip);
  const leftHand = spec.left ? K.handTarget('leftHand', root, toRoot(at('leftHand')).toArray(), spec.left.palm, dir.toArray(), true, spec.left.grip) : null;
  return K.finishWeapon({ root, muzzle, ejectPort: null, rightHand, leftHand, sight: { eye: new V3(0, 0.07, 0.12) }, parts: { body }, shellType: null });
}

/** A product shot for the store (the head to the right, laid flat): the contract frame as it is. */
export function buildMeleeProduct(id) {
  const gltf = getGLB(MODELS[id]);
  if (!gltf) return null;
  const g = gltf.scene.clone(true);
  g.traverse((o) => {
    if (o.isMesh) o.geometry = dequantize(o.geometry.clone());
  });
  return g;
}

// keyframes [f, rx, ry, rz, x, y, z] of the holder (Euler XYZ round the hands): angles solved so the bat, which rests
// upright (dir above), points where each pose wants it: cocked back over the shoulder, level out to the right, straight
// ahead at contact, level to the left on the follow-through; the smash raises it back overhead and brings it down
const SWING = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.24, 1.0, 0, -0.65, 0.04, 0.04, 0.03],
  [0.34, 0, 0, -1.7, 0.06, 0.02, -0.02],
  [0.42, -1.0, 0, 0, -0.06, 0.03, -0.1], // contact (weaponDefs bat: hitAt 0.2 of swingTime 0.5)
  [0.52, 0, 0, 1.25, -0.2, 0.02, -0.04],
  [0.72, 0.3, 0, 0.6, -0.05, 0, 0],
  [1, 0, 0, 0, 0, 0, 0],
];
const SMASH = [
  [0, 0, 0, 0, 0, 0, 0],
  [0.38, 1.15, 0, -0.3, 0.02, 0.1, 0.04],
  [0.44, 1.2, 0, -0.3, 0.02, 0.11, 0.05],
  [0.52, -1.1, 0, -0.1, 0.02, -0.08, -0.06], // it lands (heavyHitAt 0.46 of heavyTime 0.9); the hands stay low, or the arms hide it
  [0.75, -0.9, 0, -0.1, 0.02, -0.06, -0.05],
  [1, 0, 0, 0, 0, 0, 0],
];
const KEYS = ['rx', 'ry', 'rz', 'x', 'y', 'z'];

/**
 * The bat's viewmodel swing offsets (Viewmodel.update): a flat sweep from right to left across the front (Mouse1),
 * an overhead smash (Mouse2). `f` = 0..1 through the swing; adds into `o` { x, y, z, rx, ry, rz }.
 */
export function batSwing(f, heavy, o) {
  const K = heavy ? SMASH : SWING;
  let i = 0;
  while (i < K.length - 2 && f > K[i + 1][0]) i++;
  const a = K[i], b = K[i + 1];
  const t = smoothstep(a[0], b[0], clamp(f, 0, 1));
  KEYS.forEach((k, j) => (o[k] += lerp(a[j + 1], b[j + 1], t)));
  return o;
}
