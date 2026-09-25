// Reviving a teammate in first person (game/revive.js): no weapon, both hands reach down onto the body
// and press in a steady rhythm. Same contract as the gun builders (root at the right hand, hand empties
// for the IK arms); `press` is the part the viewmodel pumps.
import * as THREE from 'three';
import { handTarget } from './gunModels.js';

export function buildReviveHands() {
  const root = new THREE.Group();
  root.name = 'hands';
  const press = new THREE.Group();
  press.name = 'press';
  root.add(press);
  // heel of the right hand on the chest, the left laid over it (fingers laced, mostly open)
  const rightHand = handTarget('rightHand', press, [0.03, 0, 0.01], [0.15, -1, 0.2], [-1, 0, 0.1], false, { rx: 0.02, rz: 0.03, curl: 0.35, thumb: 0.3 });
  const leftHand = handTarget('leftHand', press, [-0.035, 0.03, -0.02], [-0.15, -1, 0.2], [1, 0, 0.1], true, { rx: 0.02, rz: 0.03, curl: 0.5, thumb: 0.35 });
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  root.add(muzzle);
  root.updateMatrixWorld(true);
  return { root, muzzle, ejectPort: null, rightHand, leftHand, sight: { eye: new THREE.Vector3(0, 0.08, 0.1) }, parts: { press }, shellType: null };
}
