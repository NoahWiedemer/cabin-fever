// Steel cage around the hallway stairs to the upper floor (level.js): a welded bar grille along the
// open side of the flight up to the ground-floor ceiling, a matching railing round the stairwell on
// the upper floor, and a hinged grille door at the foot of the stairs that stays locked until the
// upstairs opens (unlockables.upstairsBarricade; level.update swings it open).
//
// Stair geometry (level.js): x 0.96..2.31, bottom at z 1.8 (y 0), top at z -4.2 (y FLOOR.upper).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getMaterial } from './materials.js';
import { SURF, FLAG_NOBULLET, FLAG_NAVIGNORE } from './collision.js';

const X0 = 0.96, X1 = 2.31; // stair width
const Z_BOT = 1.8, Z_TOP = -4.2; // flight, bottom → top
const SIDE_X = 0.93; // grille plane on the open (west) side
const DOOR_Z = 1.84; // door plane at the foot of the stairs
const DOOR_H = 2.25;
const BAR = 0.12; // bar spacing
const BAR_W = 0.014; // flat bar section (across x depth 0.03)

export function buildStairCage({ staticGroup, dynamic, world, floorUpper, ceil1 }) {
  const steel = getMaterial('metalDark');
  const parts = [];
  const box = (w, h, d, x, y, z) => {
    if (w <= 0 || h <= 0 || d <= 0) return;
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  // tread line of the flight: height of the stairs at z (0 at the bottom, floorUpper at the top)
  const treadY = (z) => THREE.MathUtils.clamp(((Z_BOT - z) / (Z_BOT - Z_TOP)) * floorUpper, 0, floorUpper);

  // ---- side grille: vertical flat bars from the stair line to the ceiling, square posts + rails
  for (let z = Z_BOT - 0.04; z > Z_TOP; z -= BAR) {
    const y0 = treadY(z) + 0.02;
    if (y0 > ceil1 - 0.15) continue;
    box(0.03, ceil1 - y0, BAR_W, SIDE_X, (y0 + ceil1) / 2, z);
  }
  const posts = [Z_BOT - 0.02, 0.2, -1.4, -3.0];
  for (const z of posts) {
    const y0 = treadY(z);
    if (y0 < ceil1 - 0.1) box(0.06, ceil1 - y0, 0.06, SIDE_X, (y0 + ceil1) / 2, z);
  }
  // rails along the slope (handrail height, knee height) and a flat header under the ceiling
  const slope = Math.atan2(floorUpper, Z_BOT - Z_TOP);
  const railLen = Math.hypot(floorUpper, Z_BOT - Z_TOP);
  for (const h of [0.45, 0.95]) {
    const g = new THREE.BoxGeometry(0.05, 0.05, railLen);
    g.rotateX(slope);
    g.translate(SIDE_X, floorUpper / 2 + h, (Z_BOT + Z_TOP) / 2);
    parts.push(g);
  }
  box(0.06, 0.06, Z_BOT - Z_TOP, SIDE_X, ceil1 - 0.03, (Z_BOT + Z_TOP) / 2);
  // mid header across the grille (reads as a welded panel seam)
  box(0.04, 0.04, Z_BOT - Z_TOP, SIDE_X, 2.2, (Z_BOT + Z_TOP) / 2);

  // ---- transom above the door, up to the ceiling
  for (let x = X0 + 0.06; x < X1; x += BAR) box(BAR_W, ceil1 - DOOR_H, 0.03, x, (DOOR_H + ceil1) / 2, DOOR_Z);
  box(X1 - X0, 0.06, 0.06, (X0 + X1) / 2, DOOR_H + 0.03, DOOR_Z); // door head
  box(X1 - X0, 0.06, 0.06, (X0 + X1) / 2, ceil1 - 0.03, DOOR_Z);
  box(0.06, ceil1, 0.06, X0 - 0.03, ceil1 / 2, DOOR_Z); // jambs
  box(0.06, ceil1, 0.06, X1 + 0.02, ceil1 / 2, DOOR_Z);

  // ---- upper floor: railing round the stairwell hole (west side + the short south end)
  const RY = floorUpper, RH = 1.0;
  for (let z = Z_BOT; z > Z_TOP; z -= BAR) box(0.03, RH, BAR_W, 0.9, RY + RH / 2, z);
  for (let x = X0 + 0.06; x < X1; x += BAR) box(BAR_W, RH, 0.03, x, RY + RH / 2, 1.86);
  for (const z of [Z_BOT + 0.06, 0.0, -2.1, Z_TOP + 0.03]) box(0.06, RH + 0.04, 0.06, 0.9, RY + (RH + 0.04) / 2, z);
  box(0.06, RH + 0.04, 0.06, X1 + 0.02, RY + (RH + 0.04) / 2, 1.86);
  box(0.07, 0.05, Z_BOT - Z_TOP + 0.1, 0.9, RY + RH, (Z_BOT + Z_TOP) / 2 + 0.03); // top rails
  box(X1 - 0.9 + 0.06, 0.05, 0.07, (0.9 + X1) / 2, RY + RH, 1.86);
  box(0.05, 0.04, Z_BOT - Z_TOP, 0.9, RY + 0.12, (Z_BOT + Z_TOP) / 2); // kick rail
  box(X1 - X0, 0.04, 0.05, (X0 + X1) / 2, RY + 0.12, 1.86);

  const cage = new THREE.Mesh(mergeGeometries(parts), steel);
  cage.name = 'stairCage';
  cage.castShadow = true;
  cage.receiveShadow = true;
  cage.matrixAutoUpdate = false;
  staticGroup.add(cage);
  for (const g of parts) g.dispose();

  // colliders: the side grille (bullets pass between the bars) and the upstairs railing
  world.add(0.9, 0, Z_TOP, 0.96, floorUpper + 1.0, Z_BOT, SURF.metal, FLAG_NOBULLET | FLAG_NAVIGNORE);
  world.add(0.86, floorUpper, Z_TOP, 0.96, floorUpper + 1.0, 1.9, SURF.metal, FLAG_NOBULLET);
  world.add(0.96, floorUpper, 1.8, X1, floorUpper + 1.0, 1.92, SURF.metal, FLAG_NOBULLET);

  // ---- the grille door: hinged against the kitchen wall (east), swings out into the hallway
  const pivot = new THREE.Group();
  pivot.position.set(X1, 0, DOOR_Z);
  const leaf = [];
  const W = X1 - X0 - 0.02;
  const lb = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    leaf.push(g);
  };
  lb(0.045, DOOR_H - 0.02, 0.045, -0.03, (DOOR_H - 0.02) / 2, 0); // hinge stile
  lb(0.045, DOOR_H - 0.02, 0.045, -W + 0.03, (DOOR_H - 0.02) / 2, 0); // lock stile
  for (const y of [0.06, 1.05, DOOR_H - 0.06]) lb(W, 0.045, 0.045, -W / 2, y, 0); // rails
  for (let x = -0.03 - BAR; x > -W + 0.06; x -= BAR) lb(BAR_W, DOOR_H - 0.1, 0.028, x, DOOR_H / 2, 0);
  // diagonal brace (keeps a grille gate from sagging)
  {
    const len = Math.hypot(W - 0.08, 0.95);
    const g = new THREE.BoxGeometry(0.035, len, 0.03);
    g.rotateZ(Math.atan2(W - 0.08, 0.95));
    g.translate(-W / 2, 0.58, 0);
    leaf.push(g);
  }
  // lock box, handle and hinge knuckles
  lb(0.14, 0.2, 0.07, -W + 0.1, 1.05, 0.01);
  lb(0.025, 0.025, 0.12, -W + 0.16, 1.02, 0.08);
  for (const y of [0.3, 1.2, DOOR_H - 0.3]) lb(0.06, 0.14, 0.06, 0.0, y, 0);
  const door = new THREE.Mesh(mergeGeometries(leaf), steel);
  for (const g of leaf) g.dispose();
  door.castShadow = true;
  door.receiveShadow = true;
  pivot.add(door);
  // padlock on the lock box
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.03), new THREE.MeshStandardMaterial({ color: 0x8a7a3a, metalness: 0.9, roughness: 0.35 }));
  lock.position.set(-W + 0.1, 0.92, 0.06);
  pivot.add(lock);
  dynamic.add(pivot);

  const col = world.add(X0, 0, 1.8, X1, DOOR_H, 1.88, SURF.metal, FLAG_NOBULLET | FLAG_NAVIGNORE, 'upstairsBarricade');
  // closedRot 0 → about 90° out into the hallway, flat against the kitchen wall
  return { pivot, lock, colliders: [col], openRot: Math.PI / 2 * 0.96, closedRot: 0 };
}
