// The Cabin Fever farmhouse: two stories + basement, porch, balcony, muddy yard.
//
// Layout (meters). House footprint x ∈ [-12, 12], z ∈ [-8, 8]. Front (porch) faces +Z.
//   Ground floor (y=0):  Living room  x[-12,-1] z[-1,8]   (front door)
//                        Storage room x[-12,-1] z[-8,-1]  (basement door + stairwell)
//                        Long hallway x[-1,2.4] z[-8,8]   (stairs up, torn-off back door)
//                        Kitchen      x[2.4,12] z[1,8]    ("the Alamo", hole in the wall)
//                        Back room    x[2.4,12] z[-8,1]
//   Basement (y=-3.2):   x[-12,2.4] z[-8,4], interior stairs + outside cellar stairwell (west)
//   Upper floor (y=3.45): bedrooms, bathroom, balcony
import * as THREE from 'three';
import { LevelBuilder } from './levelBuilder.js';
import { CollisionWorld, SURF, FLAG_NOBULLET, FLAG_NAVIGNORE } from './collision.js';
import { buildProp, clearPropCache } from './propsSafe.js';
import { getMaterial } from './materials.js';

export const FLOOR = { basement: -3.2, ground: 0, upper: 3.45, outside: -0.5 };
// ruined chapel on the horizon (src/world/landmarks.js); the porch keeps a clear view of it
export const CHURCH_POS = [-18, 50];
const CHURCH_VIEW = [-4, 9.6];
const CEIL1 = 3.2; // ground floor ceiling
const CEIL2 = 6.2; // upper floor ceiling
const BCEIL = -0.25; // basement ceiling
const TE = 0.3; // exterior wall thickness
const TI = 0.18; // interior wall thickness
const DOOR_H = 2.25;
const WIN = { y0: 0.95, y1: 2.2 };

export const HOUSE = { minX: -12, maxX: 12, minZ: -8, maxZ: 8 };

export function levelOf(y) {
  if (y < -1.4) return 0;
  if (y > 2.2) return 2;
  return 1;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLevel() {
  const world = new CollisionWorld(-80, -80, 80, 80, 2);
  const B = new LevelBuilder(world);
  const rnd = mulberry(1337);
  const lamps = [];
  const windows = []; // {axis, c, a, b, y0, y1, outwardSign}
  const radarSegments = [];
  const dynamic = new THREE.Group(); // non-batched animated stuff (doors, barricades)
  dynamic.name = 'dynamicLevel';
  const unlockables = {};

  const prop = (type, x, y, z, rot = 0, opts = {}, placeOpts = {}) => {
    let p;
    try {
      p = buildProp(type, { seed: Math.floor(rnd() * 100000), ...opts });
    } catch (e) {
      console.warn('prop failed', type, e);
      return null;
    }
    if (!p) return null;
    B.placeProp(p, x, y, z, rot, placeOpts);
    return p;
  };

  // ------------------------------------------------------------------ ground / terrain
  // Big mud slab (top at -0.5) with holes for the basement, the gun shop and the cellar stairwell.
  B.slab(-75, 75, -75, 75, -1.5, FLOOR.outside, [
    [-12, 2.4, -8, 4], // basement footprint
    [2.4, 12, -8, 1], // gun shop cellar footprint (its stairs come down from the back room)
    [-17.4, -12, -3.25, -1.35], // cellar stairwell
  ], { mat: 'mud', surface: SURF.mud, grime: 0, skip: ['ny'], castShadow: false });

  // invisible world boundary
  const WB = 40;
  for (const [x0, z0, x1, z1] of [
    [-WB - 1, -WB - 1, WB + 1, -WB],
    [-WB - 1, WB, WB + 1, WB + 1],
    [-WB - 1, -WB, -WB, WB],
    [WB, -WB, WB + 1, WB],
  ]) {
    world.add(x0, -2, z0, x1, 12, z1, SURF.mud, FLAG_NOBULLET);
  }

  // ------------------------------------------------------------------ foundation + floors
  const WALLX0 = -12 + TE, WALLX1 = 12 - TE, WALLZ0 = -8 + TE, WALLZ1 = 8 - TE;
  // ground floor slab (with the basement stair hole)
  const basementStairHole = [-9.2, -3.8, -7.7, -6.3];
  const shopStairHole = [4.0, 9.4, -7.7, -6.4]; // gun shop cellar under the back room
  const upStairHole = [0.96, 2.31, -4.2, 1.8];
  B.slab(WALLX0, WALLX1, WALLZ0, WALLZ1, -0.25, FLOOR.ground, [basementStairHole, shopStairHole], {
    mats: { py: 'woodFloor', ny: 'ceilingBoards', px: 'woodBeam', nx: 'woodBeam', pz: 'woodBeam', nz: 'woodBeam' },
    surface: SURF.wood,
    grime: 0,
  });
  // upper floor slab
  B.slab(WALLX0, WALLX1, WALLZ0, WALLZ1, CEIL1, FLOOR.upper, [upStairHole], {
    mats: { py: 'woodFloor', ny: 'ceilingBoards', px: 'woodBeam', nx: 'woodBeam', pz: 'woodBeam', nz: 'woodBeam' },
    surface: SURF.wood,
    grime: 0,
  });
  // upper ceiling
  B.box(-12, CEIL2, -8, 12, CEIL2 + 0.2, 8, { mats: { ny: 'ceilingBoards', py: 'woodBeam' }, surface: SURF.wood, grime: 0 });
  // basement floor
  B.box(-12, FLOOR.basement - 0.3, -8, 2.4, FLOOR.basement, 4, { mat: 'concrete', surface: SURF.concrete, grime: 0 });

  // ------------------------------------------------------------------ exterior walls
  const extSides = (inwardIsPos) => (inwardIsPos ? { pos: 'plaster', neg: 'plasterExterior' } : { pos: 'plasterExterior', neg: 'plaster' });
  // South (front) wall, z = 8 - TE/2; inward is -Z => neg side is interior
  const southC = 8 - TE / 2, northC = -8 + TE / 2, westC = -12 + TE / 2, eastC = 12 - TE / 2;

  // foundation band outside (-0.5..0) all around
  B.box(-12.05, -0.5, 7.95, 12.05, 0.02, 8.05, { mats: { pz: 'concrete', py: 'concrete' }, skip: ['nz', 'ny'], surface: SURF.concrete, collide: false });
  B.box(-12.05, -0.5, -8.05, 12.05, 0.02, -7.95, { mats: { nz: 'concrete', py: 'concrete' }, skip: ['pz', 'ny'], surface: SURF.concrete, collide: false });
  B.box(-12.05, -0.5, -8.05, -11.95, 0.02, 8.05, { mats: { nx: 'concrete', py: 'concrete' }, skip: ['px', 'ny'], surface: SURF.concrete, collide: false });
  B.box(11.95, -0.5, -8.05, 12.05, 0.02, 8.05, { mats: { px: 'concrete', py: 'concrete' }, skip: ['nx', 'ny'], surface: SURF.concrete, collide: false });

  // Ground floor
  const gSouthOpen = [
    { a: -11.0, b: -9.6, ...WIN, win: true },
    { a: -7.15, b: -5.85, y0: 0, y1: DOOR_H, door: 'front' },
    { a: -3.4, b: -2.0, ...WIN, win: true },
    { a: -0.2, b: 1.1, ...WIN, win: true },
    { a: 4.0, b: 5.4, ...WIN, win: true },
    { a: 8.6, b: 10.0, ...WIN, win: true },
  ];
  B.wall('x', southC, -12, 12, 0, CEIL1 + 0.25, TE, gSouthOpen, { sides: extSides(false), floorY: 0, ceilY: CEIL1 });
  const gNorthOpen = [
    { a: -10.8, b: -9.6, ...WIN, win: true },
    { a: -0.6, b: 0.75, y0: 0, y1: DOOR_H, door: 'back' },
    { a: 5.0, b: 6.4, ...WIN, win: true },
    { a: 9.0, b: 10.4, ...WIN, win: true },
  ];
  B.wall('x', northC, -12, 12, 0, CEIL1 + 0.25, TE, gNorthOpen, { sides: extSides(true), floorY: 0, ceilY: CEIL1 });
  const gWestOpen = [
    { a: 2.8, b: 4.2, ...WIN, win: true },
    { a: -5.0, b: -3.6, ...WIN, win: true },
  ];
  B.wall('z', westC, -8 + TE, 8 - TE, 0, CEIL1 + 0.25, TE, gWestOpen, { sides: extSides(true), floorY: 0, ceilY: CEIL1 });
  const gEastOpen = [
    { a: 3.4, b: 5.6, y0: 0, y1: 2.05, hole: true },
    { a: -5.0, b: -3.6, ...WIN, win: true },
  ];
  B.wall('z', eastC, -8 + TE, 8 - TE, 0, CEIL1 + 0.25, TE, gEastOpen, { sides: extSides(false), floorY: 0, ceilY: CEIL1 });

  // Upper floor exterior walls
  const uSouthOpen = [
    { a: -10.6, b: -9.4, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
    { a: -4.2, b: -3.0, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
    { a: 3.2, b: 4.4, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
    { a: 6.4, b: 7.5, y0: FLOOR.upper, y1: FLOOR.upper + 2.15, door: 'balcony' },
    { a: 9.2, b: 10.4, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
  ];
  B.wall('x', southC, -12, 12, FLOOR.upper, CEIL2, TE, uSouthOpen, { sides: extSides(false), floorY: FLOOR.upper, ceilY: CEIL2 });
  const uNorthOpen = [
    { a: -9.0, b: -7.8, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
    { a: -0.3, b: 0.8, y0: FLOOR.upper + 1.1, y1: FLOOR.upper + 2.0, win: true },
    { a: 4.0, b: 4.9, y0: FLOOR.upper + 1.2, y1: FLOOR.upper + 2.0, win: true },
    { a: 9.0, b: 10.2, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
  ];
  B.wall('x', northC, -12, 12, FLOOR.upper, CEIL2, TE, uNorthOpen, { sides: extSides(true), floorY: FLOOR.upper, ceilY: CEIL2 });
  B.wall('z', westC, -8 + TE, 8 - TE, FLOOR.upper, CEIL2, TE, [
    { a: 3.0, b: 4.2, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
    { a: -4.8, b: -3.6, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
  ], { sides: extSides(true), floorY: FLOOR.upper, ceilY: CEIL2 });
  B.wall('z', eastC, -8 + TE, 8 - TE, FLOOR.upper, CEIL2, TE, [
    { a: 4.0, b: 5.2, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
    { a: -4.8, b: -3.6, y0: FLOOR.upper + 0.9, y1: FLOOR.upper + 2.1, win: true },
  ], { sides: extSides(false), floorY: FLOOR.upper, ceilY: CEIL2 });

  // record windows for frames/boards
  const recordWindows = (axis, c, list, outward) => {
    for (const o of list) if (o.win) windows.push({ axis, c, a: o.a, b: o.b, y0: o.y0, y1: o.y1, outward });
  };
  recordWindows('x', southC, gSouthOpen, 1);
  recordWindows('x', northC, gNorthOpen, -1);
  recordWindows('z', westC, gWestOpen, -1);
  recordWindows('z', eastC, gEastOpen, 1);
  recordWindows('x', southC, uSouthOpen, 1);
  recordWindows('x', northC, uNorthOpen, -1);

  // Gable ends + roof
  buildRoof(B);

  // ------------------------------------------------------------------ basement walls
  const bWallOpts = { mat: 'concrete', surface: SURF.concrete, floorY: FLOOR.basement, ceilY: BCEIL, jamb: 'concrete' };
  B.wall('z', -12 + TE / 2, -8, 4, FLOOR.basement, 0, TE, [{ a: -3.0, b: -1.6, y0: FLOOR.basement, y1: FLOOR.basement + 2.6 }], bWallOpts);
  B.wall('x', -8 + TE / 2, -12, 2.4, FLOOR.basement, 0, TE, [], bWallOpts);
  B.wall('z', 2.4, -8, 4, FLOOR.basement, 0, TE, [], bWallOpts);
  B.wall('x', 4, -12, 2.55, FLOOR.basement, 0, TE, [], bWallOpts);
  // basement pillars
  for (const [px, pz] of [[-7, -2.8], [-3, -2.8], [-7, 1.4], [-3, 1.4]]) {
    B.box(px - 0.2, FLOOR.basement, pz - 0.2, px + 0.2, BCEIL, pz + 0.2, { mat: 'concrete', surface: SURF.concrete, floorY: FLOOR.basement, ceilY: BCEIL });
  }
  // basement ceiling beams (along x) + joists
  for (const bz of [-4.6, -1.0, 2.2]) {
    B.box(-11.7, BCEIL - 0.3, bz - 0.13, 2.25, BCEIL, bz + 0.13, { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
  }
  for (let jx = -11.2; jx < 2.2; jx += 1.1) {
    if (jx > basementStairHole[0] - 0.1 && jx < basementStairHole[1] + 0.1) {
      B.box(jx - 0.05, BCEIL - 0.18, -6.2, jx + 0.05, BCEIL, 3.85, { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
    } else {
      B.box(jx - 0.05, BCEIL - 0.18, -7.7, jx + 0.05, BCEIL, 3.85, { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
    }
  }

  // basement interior stairs (rising toward +x, from x=-9.2 (bottom) to x=-3.8 (top))
  B.stairs({ axis: 'x', x0: -7.7, x1: -6.3, s0: -9.2, s1: -3.8, yBottom: FLOOR.basement, yTop: 0, steps: 16, solid: true, mat: 'woodBeam', riser: 'concrete' });
  // stairwell enclosure on the ground floor (wall along z=-6.2 from x=-9.3 to -3.8, door at east end x=-3.8)
  B.wall('x', -6.2, -9.3, -3.7, 0, CEIL1, TI, [], { sides: { pos: 'plaster', neg: 'plaster' }, floorY: 0, ceilY: CEIL1 });
  B.box(-9.4, 0, -7.7, -9.2, CEIL1, -6.1, { mat: 'plaster', floorY: 0, ceilY: CEIL1 });
  B.wall('z', -3.75, -7.7, -6.1, 0, CEIL1, TI, [{ a: -7.62, b: -6.28, y0: 0, y1: 2.15 }], { sides: { pos: 'plaster', neg: 'plaster' }, floorY: 0, ceilY: CEIL1 });

  // Basement door (locked until the basement opens)
  {
    const pivot = new THREE.Group();
    pivot.position.set(-3.7, 0, -6.3);
    const d = buildProp('door', { seed: 7 });
    d.object.rotation.y = Math.PI / 2; // door extends toward -z from the hinge
    d.object.scale.set(1.34 / 0.95, 1, 1);
    pivot.add(d.object);
    dynamic.add(pivot);
    const col = world.add(-3.8, 0, -7.7, -3.62, 2.15, -6.28, SURF.wood, FLAG_NAVIGNORE, 'basementDoor');
    unlockables.basementDoor = { pivot, colliders: [col], openRot: Math.PI / 2 * 0.92, closedRot: 0, t: 0, open: false };
  }

  // cellar stairwell outside (west): rising toward -x from x=-12 (basement) to x=-17.4 (yard)
  B.stairs({ axis: 'x', x0: -3.0, x1: -1.6, s0: -12.0, s1: -17.4, yBottom: FLOOR.basement, yTop: FLOOR.outside, steps: 14, solid: true, mat: 'concrete', riser: 'concrete', surface: SURF.concrete });
  B.box(-17.4, FLOOR.basement - 0.2, -3.25, -12, -0.35, -3.0, { mat: 'concrete', surface: SURF.concrete, floorY: FLOOR.basement, ceilY: 0 });
  B.box(-17.4, FLOOR.basement - 0.2, -1.6, -12, -0.35, -1.35, { mat: 'concrete', surface: SURF.concrete, floorY: FLOOR.basement, ceilY: 0 });
  prop('cellarDoors', -17.9, FLOOR.outside, -2.3, Math.PI / 2, { void: false, open: 'both' }, { collide: false });
  // barricade planks across the basement-side cellar doorway
  {
    const g = new THREE.Group();
    const bw = buildProp('boardedWindow', { w: 1.4, h: 2.6, seed: 99 });
    bw.object.rotation.y = Math.PI / 2;
    bw.object.position.set(-11.72, FLOOR.basement + 1.3, -2.3);
    g.add(bw.object);
    dynamic.add(g);
    const col = world.add(-12.0, FLOOR.basement, -3.0, -11.7, FLOOR.basement + 2.6, -1.6, SURF.wood, FLAG_NAVIGNORE, 'cellarBarricade');
    unlockables.cellarBarricade = { group: g, colliders: [col], open: false, t: 0 };
  }

  // ------------------------------------------------------------------ gun shop cellar (east, under the back room)
  // Brick room x 2.4..12, z -8..1 with its own stairs along the north wall (top at x = 4, bottom at
  // x = 9.4). A gate at the top of the stairs opens only between rounds (src/world/gunshop.js).
  const shopWallOpts = { mat: 'brick', surface: SURF.concrete, floorY: FLOOR.basement, ceilY: BCEIL, jamb: 'concrete' };
  B.box(2.4, FLOOR.basement - 0.3, -8, 12, FLOOR.basement, 1, { mats: { py: 'woodFloor' }, mat: 'concrete', surface: SURF.wood, grime: 0 });
  B.wall('x', -8 + TE / 2, 2.4, 12, FLOOR.basement, 0, TE, [], shopWallOpts);
  B.wall('z', 12 - TE / 2, -8, 1, FLOOR.basement, 0, TE, [], shopWallOpts);
  B.wall('x', 1, 2.4, 12, FLOOR.basement, 0, TE, [], shopWallOpts);
  for (const bz of [-4.6, -1.0]) {
    B.box(2.6, BCEIL - 0.3, bz - 0.13, 11.8, BCEIL, bz + 0.13, { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
  }
  B.stairs({ axis: 'x', x0: -7.7, x1: -6.4, s0: 9.4, s1: 4.0, yBottom: FLOOR.basement, yTop: 0, steps: 16, solid: true, mat: 'woodBeam', riser: 'concrete', side: 'brick' });
  // railings around the open stairwell on the ground floor (south side + east end)
  prop('railing', 4.0, 0, -6.34, 0, { length: 5.4 }, { collide: false });
  prop('railing', 9.46, 0, -7.7, -Math.PI / 2, { length: 1.36 }, { collide: false });
  world.add(4.0, 0, -6.42, 9.5, 1.0, -6.28, SURF.wood, FLAG_NOBULLET | FLAG_NAVIGNORE);
  world.add(9.4, 0, -7.7, 9.52, 1.0, -6.3, SURF.wood, FLAG_NOBULLET | FLAG_NAVIGNORE);
  // the gate itself is animated by gunshop.js; this collider is its closed state
  const shopGate = world.add(3.86, 0, -7.7, 4.02, 2.3, -6.4, SURF.metal, FLAG_NAVIGNORE, 'shopGate');

  // ------------------------------------------------------------------ ground floor interior walls
  const intOpts = { sides: { pos: 'plaster', neg: 'plaster' }, floorY: 0, ceilY: CEIL1 };
  // living/storage | hallway (x = -1)
  B.wall('z', -1, WALLZ0, WALLZ1, 0, CEIL1, TI, [
    { a: 3.0, b: 4.6, y0: 0, y1: 2.3 },
    { a: -4.6, b: -3.2, y0: 0, y1: 2.2 },
  ], intOpts);
  // living | storage (z = -1)
  B.wall('x', -1, WALLX0, -1.09, 0, CEIL1, TI, [{ a: -9.0, b: -7.6, y0: 0, y1: 2.2 }], intOpts);
  // hallway | kitchen & back room (x = 2.4)
  B.wall('z', 2.4, WALLZ0, WALLZ1, 0, CEIL1, TI, [
    { a: 4.2, b: 5.6, y0: 0, y1: 2.2 },
    { a: -6.8, b: -5.4, y0: 0, y1: 2.2 },
  ], intOpts);
  // kitchen | back room (z = 1)
  B.wall('x', 1, 2.49, WALLX1, 0, CEIL1, TI, [{ a: 7.8, b: 9.3, y0: 0, y1: 2.2 }, { a: 10.4, b: 11.1, y0: 0.9, y1: 1.9 }], intOpts);

  // hallway stairs up (rising toward -z from z=1.8 to z=-4.2)
  B.stairs({ axis: 'z', x0: 0.96, x1: 2.31, s0: 1.8, s1: -4.2, yBottom: 0, yTop: FLOOR.upper, steps: 17, solid: true, mat: 'woodBeam', riser: 'woodPainted', side: 'plaster' });
  // stair handrail + newel posts
  {
    const len = Math.hypot(6.0, FLOOR.upper);
    const ang = Math.atan2(FLOOR.upper, 6.0);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, len), getMaterial('woodBeam'));
    rail.position.set(0.93, FLOOR.upper / 2 + 0.95, -1.2);
    rail.rotation.x = ang;
    rail.castShadow = true;
    rail.receiveShadow = true;
    B.staticGroup.add(rail);
    const postGeo = new THREE.BoxGeometry(0.035, 0.9, 0.035);
    const pmat = getMaterial('woodPainted');
    for (let i = 0; i < 17; i++) {
      if (i % 2 === 1) continue;
      const z = 1.8 - (i + 0.5) * (6.0 / 17);
      const y = (i + 1) * (FLOOR.upper / 17);
      const p = new THREE.Mesh(postGeo, pmat);
      p.position.set(0.93, y + 0.45, z);
      p.castShadow = true;
      B.staticGroup.add(p);
    }
    B.box(0.86, 0, 1.72, 1.02, 1.2, 1.88, { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
    // thin collider along the rail so nobody falls off the open side
    world.add(0.9, 0, -4.2, 0.96, FLOOR.upper + 1.0, 1.6, SURF.wood, FLAG_NOBULLET | FLAG_NAVIGNORE);
  }
  // Upstairs barricade on the lower stairs (removed when upstairs opens)
  {
    const g = new THREE.Group();
    const bw = buildProp('boardedWindow', { w: 1.35, h: 1.9, seed: 42 });
    bw.object.position.set(1.63, 0.95 + 0.4, 1.2);
    g.add(bw.object);
    const deb = buildProp('debrisPile', { seed: 5 });
    deb.object.position.set(1.6, 0.4, 1.35);
    deb.object.scale.setScalar(0.7);
    g.add(deb.object);
    dynamic.add(g);
    const col = world.add(0.96, 0, 0.9, 2.31, 2.6, 1.5, SURF.wood, FLAG_NAVIGNORE, 'upstairsBarricade');
    unlockables.upstairsBarricade = { group: g, colliders: [col], open: false, t: 0 };
  }

  // Ground floor posts & beams (living room girder with posts like the reference screenshots)
  for (const [px, pz] of [[-8.2, 3.5], [-4.6, 3.5], [7.0, 4.6]]) {
    B.box(px - 0.12, 0, pz - 0.12, px + 0.12, CEIL1 - 0.3, pz + 0.12, { mat: 'woodBeam', surface: SURF.wood, grime: 0.4 });
  }
  const beam = (x0, z0, x1, z1, depth, w) => {
    B.box(x0, CEIL1 - depth, z0, x1, CEIL1, z1, { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
  };
  beam(WALLX0, 3.5 - 0.14, -1.09, 3.5 + 0.14, 0.32);
  beam(2.49, 4.6 - 0.14, WALLX1, 4.6 + 0.14, 0.32);
  beam(WALLX0, -4.4 - 0.13, -1.09, -4.4 + 0.13, 0.3);
  beam(2.49, -3.5 - 0.13, WALLX1, -3.5 + 0.13, 0.3);
  // joists along z every ~1.05m, skipping the stairwell
  for (let jx = -11.3; jx < 11.6; jx += 1.05) {
    if (Math.abs(jx + 1) < 0.2 || Math.abs(jx - 2.4) < 0.2) continue;
    if (jx > upStairHole[0] - 0.1 && jx < upStairHole[1] + 0.1) {
      beam(jx - 0.055, WALLZ0, jx + 0.055, upStairHole[2] - 0.05, 0.2);
      beam(jx - 0.055, upStairHole[3] + 0.05, jx + 0.055, WALLZ1, 0.2);
    } else {
      beam(jx - 0.055, WALLZ0, jx + 0.055, WALLZ1, 0.2);
    }
  }

  // ------------------------------------------------------------------ upper floor interior walls
  const uOpts = { sides: { pos: 'plaster', neg: 'plaster' }, floorY: FLOOR.upper, ceilY: CEIL2 };
  B.wall('z', -1, WALLZ0, WALLZ1, FLOOR.upper, CEIL2, TI, [
    { a: 3.4, b: 4.6, y0: FLOOR.upper, y1: FLOOR.upper + 2.15 },
    { a: -4.6, b: -3.4, y0: FLOOR.upper, y1: FLOOR.upper + 2.15 },
  ], uOpts);
  B.wall('x', -1, WALLX0, -1.09, FLOOR.upper, CEIL2, TI, [], uOpts);
  B.wall('z', 2.4, WALLZ0, WALLZ1, FLOOR.upper, CEIL2, TI, [
    { a: 4.2, b: 5.3, y0: FLOOR.upper, y1: FLOOR.upper + 2.15 },
    { a: -6.6, b: -5.5, y0: FLOOR.upper, y1: FLOOR.upper + 2.15 },
  ], uOpts);
  B.wall('x', 1, 2.49, WALLX1, FLOOR.upper, CEIL2, TI, [{ a: 8.0, b: 9.1, y0: FLOOR.upper, y1: FLOOR.upper + 2.15 }], uOpts);
  B.wall('z', 6.5, WALLZ0, 0.91, FLOOR.upper, CEIL2, TI, [], uOpts);
  // stairwell railing upstairs (west + south side of the hole)
  prop('railing', 0.9, FLOOR.upper, -4.2, -Math.PI / 2, { length: 6.0 }, { collide: false });
  prop('railing', 0.96, FLOOR.upper, 1.86, 0, { length: 1.35 }, { collide: false });
  world.add(0.86, FLOOR.upper, -4.2, 0.96, FLOOR.upper + 1.0, 1.9, SURF.wood, FLAG_NOBULLET);
  world.add(0.96, FLOOR.upper, 1.8, 2.31, FLOOR.upper + 1.0, 1.92, SURF.wood, FLAG_NOBULLET);

  // ------------------------------------------------------------------ porch, balcony, stoops
  // porch deck
  B.box(-9.6, FLOOR.outside, 8.0, -3.4, FLOOR.ground, 10.4, { mats: { py: 'woodFloor', pz: 'woodBeam', px: 'woodBeam', nx: 'woodBeam' }, surface: SURF.wood, grime: 0.2 });
  // porch steps down toward +z
  for (let i = 0; i < 3; i++) {
    const top = FLOOR.ground - (i + 1) * 0.125;
    B.box(-7.6, FLOOR.outside, 10.4 + i * 0.32, -5.4, top, 10.4 + (i + 1) * 0.32, { mats: { py: 'woodFloor', pz: 'woodBeam', px: 'woodBeam', nx: 'woodBeam' }, surface: SURF.wood, grime: 0.2 });
  }
  // porch roof + posts
  B.box(-9.8, 2.95, 8.0, -3.2, 3.1, 10.8, { mats: { py: 'roof', ny: 'ceilingBoards', px: 'woodBeam', nx: 'woodBeam', pz: 'woodBeam' }, surface: SURF.wood, grime: 0 });
  for (const px of [-9.4, -3.6]) {
    B.box(px - 0.1, 0, 10.2, px + 0.1, 2.95, 10.4, { mat: 'woodPainted', surface: SURF.wood, grime: 0.3 });
  }
  prop('railing', -9.5, FLOOR.ground, 10.3, 0, { length: 1.8 }, { collide: false });
  prop('railing', -5.3, FLOOR.ground, 10.3, 0, { length: 1.6 }, { collide: false });
  world.add(-9.5, 0, 10.25, -7.7, 1.0, 10.35, SURF.wood, 0);
  world.add(-5.3, 0, 10.25, -3.6, 1.0, 10.35, SURF.wood, 0);

  // back door stoop (hallway north, toward -z)
  B.box(-0.9, FLOOR.outside, -9.0, 1.05, FLOOR.ground, -8.0, { mats: { py: 'concrete' }, mat: 'concrete', surface: SURF.concrete, grime: 0.2 });
  for (let i = 0; i < 2; i++) {
    const top = FLOOR.ground - (i + 1) * 0.17;
    B.box(-0.9, FLOOR.outside, -9.0 - (i + 1) * 0.34, 1.05, top, -9.0 - i * 0.34, { mat: 'concrete', surface: SURF.concrete, grime: 0.2 });
  }
  // the torn-off back door lying in the mud
  const tornDoor = prop('door', 2.6, FLOOR.outside + 0.04, -10.8, 0.4, { seed: 3 }, { collide: false });
  if (tornDoor) tornDoor.object.rotation.set(-Math.PI / 2, 0.4, 0);

  // hole in the wall rubble ramp (east, kitchen)
  for (let i = 0; i < 3; i++) {
    const top = FLOOR.ground - (i + 1) * 0.16;
    B.box(12.0 + i * 0.4, FLOOR.outside, 3.3, 12.4 + i * 0.4, top, 5.7, { mat: 'brick', surface: SURF.concrete, grime: 0 });
  }
  prop('debrisPile', 13.0, FLOOR.outside, 4.5, 0.3, {}, { collide: false });
  prop('debrisPile', 10.9, FLOOR.ground, 4.3, 2.1, {}, { collide: false });

  // balcony (upper floor, front right)
  B.box(3.8, CEIL1 + 0.05, 8.0, 11.2, FLOOR.upper, 9.7, { mats: { py: 'woodFloor', ny: 'ceilingBoards' }, mat: 'woodBeam', surface: SURF.wood, grime: 0 });
  for (const px of [4.0, 7.5, 11.0]) {
    B.box(px - 0.1, FLOOR.outside, 9.45, px + 0.1, CEIL1 + 0.05, 9.65, { mat: 'woodPainted', surface: SURF.wood, grime: 0.3, floorY: FLOOR.outside });
  }
  prop('railing', 3.8, FLOOR.upper, 9.62, 0, { length: 7.4 }, { collide: false });
  prop('railing', 3.85, FLOOR.upper, 8.0, -Math.PI / 2, { length: 1.6 }, { collide: false });
  prop('railing', 11.15, FLOOR.upper, 8.0, -Math.PI / 2, { length: 1.6 }, { collide: false });
  world.add(3.8, FLOOR.upper, 9.55, 11.2, FLOOR.upper + 1.0, 9.7, SURF.wood, FLAG_NOBULLET);
  world.add(3.75, FLOOR.upper, 8.0, 3.9, FLOOR.upper + 1.0, 9.7, SURF.wood, FLAG_NOBULLET);
  world.add(11.1, FLOOR.upper, 8.0, 11.25, FLOOR.upper + 1.0, 9.7, SURF.wood, FLAG_NOBULLET);

  // ------------------------------------------------------------------ windows (frames + boards)
  for (const w of windows) {
    const cx = (w.a + w.b) / 2;
    const cy = (w.y0 + w.y1) / 2;
    const ww = w.b - w.a, wh = w.y1 - w.y0;
    const rot = w.axis === 'x' ? 0 : Math.PI / 2;
    const fx = w.axis === 'x' ? cx : w.c;
    const fz = w.axis === 'x' ? w.c : cx;
    try {
      const fr = buildProp('windowFrame', { w: ww, h: wh, seed: Math.floor(rnd() * 1000) });
      B.placeProp(fr, fx, cy, fz, rot, { collide: false });
      const upper = w.y0 > 3;
      if (!upper || rnd() < 0.5) {
        const bw = buildProp('boardedWindow', { w: ww + 0.1, h: wh + 0.1, seed: Math.floor(rnd() * 1000) });
        const off = (TE / 2 + 0.02) * w.outward;
        B.placeProp(bw, w.axis === 'x' ? fx : fx + off, cy, w.axis === 'x' ? fz + off : fz, rot + (w.outward < 0 ? Math.PI : 0), { collide: false });
      }
    } catch (e) {
      console.warn('window prop failed', e);
    }
    // block movement (bullets pass through gaps)
    if (w.axis === 'x') world.add(w.a, w.y0, w.c - TE / 2, w.b, w.y1, w.c + TE / 2, SURF.wood, FLAG_NOBULLET);
    else world.add(w.c - TE / 2, w.y0, w.a, w.c + TE / 2, w.y1, w.b, SURF.wood, FLAG_NOBULLET);
  }

  // ------------------------------------------------------------------ lamps
  const lamp = (x, ceilY, z, level, opts = {}) => {
    const cable = opts.cable ?? 0.7;
    const p = prop('hangingLamp', x, ceilY, z, rnd() * Math.PI, { cableLength: cable }, { collide: false });
    const bulbY = ceilY - cable - 0.12;
    const bulb = p?.anchors?.bulb ? p.anchors.bulb.clone().applyMatrix4(p.object.matrixWorld) : new THREE.Vector3(x, bulbY, z);
    lamps.push({
      pos: bulb,
      level,
      color: opts.color ?? 0xffb46b,
      intensity: (opts.intensity ?? 34) * 2.3,
      angle: opts.angle ?? 1.2,
      distance: opts.distance ?? 16,
      flicker: opts.flicker ?? 0,
      broken: !!opts.broken,
      spot: opts.spot ?? true,
    });
  };
  // ground floor
  lamp(-8.4, CEIL1, 1.4, 1, { cable: 0.55 });
  lamp(-4.0, CEIL1, 5.8, 1, { cable: 0.55, flicker: 0.35 });
  lamp(-6.2, CEIL1, -3.6, 1, { cable: 0.5, intensity: 26 });
  lamp(0.3, CEIL1, 5.6, 1, { cable: 0.5 });
  lamp(0.0, CEIL1, -6.0, 1, { cable: 0.5, flicker: 0.6, intensity: 28 });
  lamp(7.4, CEIL1, 3.2, 1, { cable: 0.55 });
  lamp(7.2, CEIL1, -4.6, 1, { cable: 0.5, intensity: 26 });
  // basement
  lamp(-8.6, BCEIL, -4.2, 0, { cable: 0.35, intensity: 22 });
  lamp(-4.6, BCEIL, 0.4, 0, { cable: 0.35, intensity: 22, flicker: 0.5 });
  lamp(-0.3, BCEIL, -5.6, 0, { cable: 0.35, intensity: 26 });
  // gun shop
  lamp(5.3, BCEIL, -3.0, 0, { cable: 0.4, intensity: 30, color: 0xffc98f });
  lamp(9.2, BCEIL, -2.8, 0, { cable: 0.4, intensity: 26, color: 0xffc98f });
  lamp(7.0, BCEIL, -5.4, 0, { cable: 0.3, intensity: 18, color: 0xffb46b, flicker: 0.25 });
  // upper
  lamp(-6.4, CEIL2, 3.6, 2, { cable: 0.6, intensity: 20 });
  lamp(0.6, CEIL2, -6.1, 2, { cable: 0.6, intensity: 18, flicker: 0.8 });
  lamp(4.5, CEIL2, -4.4, 2, { cable: 0.5, intensity: 18 });
  lamp(7.4, CEIL2, 4.4, 2, { cable: 0.6, intensity: 20 });
  // porch lamp above the front door (wall mounted)
  lamps.push({ pos: new THREE.Vector3(-6.5, 2.55, 8.35), level: 1, color: 0xffc78a, intensity: 45, angle: 1.3, distance: 18, flicker: 0.15, spot: true, porch: true });
  {
    const p = buildProp('hangingLamp', { cableLength: 0.12, seed: 4 });
    B.placeProp(p, -6.5, 2.8, 8.38, 0, { collide: false });
  }

  // wires between lamps along the ceiling (visual)
  const wire = (a, b) => {
    try {
      const p = buildProp('wireCable', { from: a, to: b, seed: Math.floor(rnd() * 1000) });
      B.placeProp(p, 0, 0, 0, 0, { collide: false });
    } catch (e) {
      /* ignore */
    }
  };
  wire([-8.4, CEIL1 - 0.05, 1.4], [-4.0, CEIL1 - 0.05, 5.8]);
  wire([-4.0, CEIL1 - 0.05, 5.8], [-1.2, CEIL1 - 0.4, 5.8]);
  wire([0.3, CEIL1 - 0.05, 5.6], [0.0, CEIL1 - 0.05, -6.0]);
  wire([7.4, CEIL1 - 0.05, 3.2], [2.6, CEIL1 - 0.3, 3.0]);
  wire([7.2, CEIL1 - 0.05, -4.6], [11.6, CEIL1 - 0.6, -2.0]);
  wire([-8.6, BCEIL - 0.02, -4.2], [-4.6, BCEIL - 0.02, 0.4]);
  wire([-4.6, BCEIL - 0.02, 0.4], [-0.3, BCEIL - 0.02, -5.6]);

  // ------------------------------------------------------------------ interior props
  // Living room
  prop('sofa', -10.9, 0, 5.2, Math.PI / 2);
  prop('table', -6.4, 0, 1.6, 0.12);
  prop('chair', -7.4, 0, 1.3, 1.3);
  prop('chair', -5.5, 0, 2.3, -2.2, { broken: true });
  prop('cardboardStack', -10.6, 0, -0.1, 0.3);
  prop('bookshelf', -1.35, 0, 0.6, -Math.PI / 2);
  prop('wallShelfToolbox', -1.09, 1.55, 6.3, -Math.PI / 2);
  prop('debrisPile', -2.4, 0, 7.0, 0.6);
  prop('papers', -5.0, 0.005, 4.4, 0.2);
  prop('bottles', -10.2, 0, 7.0, 0);
  prop('crate', -2.0, 0, -0.1, 0.1);
  prop('crate', -11.05, 0, 2.3, 0.25, { variant: 1 });
  prop('cardboardBox', -10.95, 0, 3.25, 0.5);
  prop('barrel', -3.3, 0, 7.15, 0);
  prop('mattressFloor', -8.9, 0, 6.9, 0.25);
  prop('chair', -4.6, 0, 6.3, 2.6, { broken: true });
  prop('lantern', -6.1, 0.79, 1.45, 0);
  prop('papers', -8.3, 0.005, 3.9, 2.0);
  prop('debrisPile', -11.0, 0, 0.9, 1.3);
  // Storage room
  prop('shelfUnit', -11.2, 0, -3.8, Math.PI / 2);
  prop('shelfUnit', -5.4, 0, -1.5, Math.PI); // along the living-room wall, clear of the door (x -9.0..-7.6)
  prop('crate', -2.2, 0, -2.2, 0.3);
  prop('crate', -2.1, 0.8, -2.25, 0.8, { variant: 1 });
  prop('barrel', -1.8, 0, -5.4, 0);
  prop('cardboardBox', -10.9, 0, -5.4, 0.4);
  prop('papers', -6.0, 0.005, -3.8, 1.2);
  // Hallway (kept open)
  prop('papers', -0.1, 0.005, 2.0, 0.4);
  prop('bucket', -0.5, 0, 7.2, 0);
  // Kitchen ("the Alamo")
  prop('counter', 6.5, 0, 1.45, Math.PI);
  prop('stove', 3.3, 0, 7.2, Math.PI);
  prop('fridge', 11.1, 0, 7.1, -Math.PI / 2);
  prop('table', 7.4, 0, 4.9, 0.05);
  prop('chair', 6.4, 0, 5.4, 1.6);
  prop('chair', 8.6, 0, 4.2, -0.9, { broken: true });
  prop('cabinet', 11.3, 0, 1.9, -Math.PI / 2);
  prop('bottles', 4.6, 0.92, 1.55, 0);
  // Back room (fortified workshop)
  prop('workbench', 11.1, 0, -5.8, -Math.PI / 2);
  prop('sandbags', 5.6, 0, -1.5, 0);
  prop('ammoCrate', 3.3, 0, -3.7, 0.2);
  prop('crate', 10.8, 0, -1.0, 0.2);
  prop('barrel', 3.2, 0, -1.6, 0);
  prop('radio', 11.1, 0.92, -5.4, -1.7);
  prop('mattressFloor', 8.2, 0, -4.4, 0.1);
  // Basement
  prop('generator', -9.8, FLOOR.basement, 2.6, 0.2);
  prop('shelfUnit', 1.8, FLOOR.basement, -1.5, -Math.PI / 2);
  prop('shelfUnit', -11.2, FLOOR.basement, 0.4, Math.PI / 2);
  prop('workbench', -5.0, FLOOR.basement, 3.55, Math.PI);
  prop('barrel', -11.0, FLOOR.basement, -5.8, 0);
  prop('barrel', -10.3, FLOOR.basement, -5.2, 0);
  prop('crate', 1.4, FLOOR.basement, 3.2, 0.2);
  prop('cardboardStack', -1.4, FLOOR.basement, 3.3, 0.5);
  prop('crateLong', 0.4, FLOOR.basement, -6.9, 0);
  prop('lantern', -5.2, FLOOR.basement + 0.92, 3.5, 0);
  // Upper floor
  prop('bed', -9.8, FLOOR.upper, 5.8, Math.PI / 2);
  prop('dresser', -3.2, FLOOR.upper, 7.35, Math.PI);
  prop('bed', -10.0, FLOOR.upper, -5.0, Math.PI / 2, { variant: 1 });
  prop('cabinet', -2.0, FLOOR.upper, -7.3, 0);
  prop('bathtub', 4.3, FLOOR.upper, -6.9, 0);
  prop('toilet', 6.0, FLOOR.upper, -3.4, -Math.PI / 2);
  prop('sink', 3.0, FLOOR.upper, -3.0, Math.PI / 2);
  prop('mattressFloor', 9.5, FLOOR.upper, -5.0, 0.4);
  prop('sofa', 10.9, FLOOR.upper, 4.0, -Math.PI / 2);
  prop('cardboardStack', 3.4, FLOOR.upper, 7.1, 0.2);
  prop('papers', 5.0, FLOOR.upper + 0.005, 3.5, 0.3);
  // Porch
  prop('chair', -8.6, 0, 9.3, 0.7);
  prop('bucket', -4.3, 0, 9.5, 0);
  prop('lantern', -4.2, 0, 8.6, 0);

  // ------------------------------------------------------------------ yard / outside
  const outsideProps = [
    ['carWreck', 17.5, 11.0, 2.4],
    ['carWreck', -22.0, 14.0, -0.6],
    ['woodPile', -13.6, 5.0, Math.PI / 2],
    ['hayBale', 14.8, -6.0, 0.3],
    ['hayBale', 15.9, -5.1, 1.2],
    ['hayBale', -15.5, 9.8, 0.4],
    ['well', -20.0, -12.0, 0.0],
    ['powerPole', -14.0, 14.5, 0.1],
    ['powerPole', 16.0, -16.0, 0.4],
    ['tireStack', 13.4, 9.2, 0],
    ['wheelbarrow', -14.8, -6.5, 1.1],
    ['barrel', 13.2, -2.1, 0],
    ['barrel', 13.8, -1.4, 0],
    ['oilDrumFire', 11.0, 14.0, 0],
    ['sign', -3.0, 16.0, 0.2],
    ['sandbags', -5.5, 12.5, 0],
    ['sandbags', 5.0, -11.8, Math.PI],
    ['fence', -30.0, 20.0, 0.1],
    ['fence', -27.0, 20.4, 0.05],
    ['fence', 22.0, -20.0, -0.3],
    ['fence', 25.0, -21.0, -0.2],
    ['fence', 26.0, 8.0, Math.PI / 2],
    ['fence', 26.2, 5.0, Math.PI / 2],
    ['fence', -28.0, -8.0, Math.PI / 2 + 0.1],
  ];
  for (const [t, x, z, r] of outsideProps) prop(t, x, FLOOR.outside, z, r);
  lamps.push({ pos: new THREE.Vector3(11.0, FLOOR.outside + 1.2, 14.0), level: 1, color: 0xff7a2a, intensity: 30, angle: 0, distance: 14, flicker: 1, spot: false, fire: true });

  // trees in a ring, away from spawn lanes
  const spawnPoints = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + 0.2;
    const r = 29 + (i % 3) * 2.5;
    spawnPoints.push(new THREE.Vector3(Math.cos(a) * r, FLOOR.outside, Math.sin(a) * r * 0.9));
  }
  const treeSpots = [];
  for (let i = 0; i < 48; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 17 + rnd() * 22;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (Math.abs(x) < 16 && Math.abs(z) < 12) continue;
    if (spawnPoints.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < 16)) continue;
    if (treeSpots.some((t) => (t[0] - x) ** 2 + (t[1] - z) ** 2 < 9)) continue;
    if (outsideProps.some((p) => (p[1] - x) ** 2 + (p[2] - z) ** 2 < 12)) continue;
    {
      // keep the sightline from the porch to the chapel free of trees
      const [ax, az] = CHURCH_VIEW, dx = CHURCH_POS[0] - ax, dz = CHURCH_POS[1] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      if (Math.hypot(x - ax - dx * t, z - az - dz * t) < 5) continue;
    }
    treeSpots.push([x, z]);
    prop(rnd() < 0.7 ? 'pineTreeDead' : 'deadTree', x, FLOOR.outside, z, rnd() * Math.PI * 2);
  }

  // ------------------------------------------------------------------ nav metadata
  const portals = [
    { id: 'upstairs', a: { level: 1, x: 1.63, z: 2.35 }, b: { level: 2, x: 1.63, z: -4.75 }, cost: 7.5, enabled: false, path: [[1.63, 2.35], [1.63, -4.75]] },
    { id: 'basementInterior', a: { level: 1, x: -3.25, z: -7.0 }, b: { level: 0, x: -9.75, z: -7.0 }, cost: 7.5, enabled: false },
    { id: 'cellar', a: { level: 1, x: -17.95, z: -2.3 }, b: { level: 0, x: -11.2, z: -2.3 }, cost: 7.5, enabled: false },
  ];
  const navBlocks = [
    { level: 1, rect: [0.9, 2.35, -4.25, 1.95] },
    { level: 2, rect: [0.9, 2.35, -4.25, 1.95] },
    { level: 0, rect: [-9.25, -3.7, -7.75, -6.2] },
    { level: 1, rect: [-9.25, -3.7, -7.75, -6.2] },
    { level: 0, rect: [-17.4, -11.7, -3.0, -1.6] },
    { level: 1, rect: [-17.45, -11.7, -3.3, -1.3] },
    { level: 1, rect: [3.85, 9.55, -7.8, -6.25] }, // gun shop stairwell
    { level: 0, rect: [4.0, 9.5, -7.8, -6.3] },
  ];

  // Doorways the store's barricade kit can board up (src/world/barricades.js). The openings of the
  // walls above: axis = the wall's run ('x': wall along x, normal ±z), c = wall centre line, t = wall
  // thickness, a..b = opening along the wall, y0..y1 = sill / top. `requires`: only after that unlock;
  // `portal`: reached via that stair portal (the doorway itself is inside a nav block); `side`: the
  // face the planks always go on (+1 = +normal). The balcony door is left out: the infected never
  // come in that way.
  const barricadeSpots = [
    { id: 'front', name: 'FRONT DOOR', level: 1, axis: 'x', c: southC, t: TE, a: -7.15, b: -5.85, y0: 0, y1: DOOR_H },
    { id: 'back', name: 'BACK DOOR', level: 1, axis: 'x', c: northC, t: TE, a: -0.6, b: 0.75, y0: 0, y1: DOOR_H },
    { id: 'kitchenHole', name: 'KITCHEN WALL HOLE', level: 1, axis: 'z', c: eastC, t: TE, a: 3.4, b: 5.6, y0: 0, y1: 2.05 },
    { id: 'livingHall', name: 'LIVING ROOM DOOR', level: 1, axis: 'z', c: -1, t: TI, a: 3.0, b: 4.6, y0: 0, y1: 2.3 },
    { id: 'storageHall', name: 'STORAGE ROOM DOOR', level: 1, axis: 'z', c: -1, t: TI, a: -4.6, b: -3.2, y0: 0, y1: 2.2 },
    { id: 'livingStorage', name: 'STORAGE PASSAGE', level: 1, axis: 'x', c: -1, t: TI, a: -9.0, b: -7.6, y0: 0, y1: 2.2 },
    { id: 'hallKitchen', name: 'KITCHEN DOOR', level: 1, axis: 'z', c: 2.4, t: TI, a: 4.2, b: 5.6, y0: 0, y1: 2.2 },
    { id: 'hallBack', name: 'BACK ROOM DOOR', level: 1, axis: 'z', c: 2.4, t: TI, a: -6.8, b: -5.4, y0: 0, y1: 2.2 },
    { id: 'kitchenBack', name: 'PANTRY DOOR', level: 1, axis: 'x', c: 1, t: TI, a: 7.8, b: 9.3, y0: 0, y1: 2.2 },
    { id: 'basementDoor', name: 'BASEMENT DOOR', level: 1, axis: 'z', c: -3.75, t: TI, a: -7.62, b: -6.28, y0: 0, y1: 2.15, requires: 'basement', portal: 'basementInterior', side: 1 },
    { id: 'cellar', name: 'CELLAR DOOR', level: 0, axis: 'z', c: -12 + TE / 2, t: TE, a: -3.0, b: -1.6, y0: FLOOR.basement, y1: FLOOR.basement + 2.6, requires: 'basement', portal: 'cellar', side: 1 },
  ];

  // radar outline (ground floor walls)
  radarSegments.push(
    [-12, -8, 12, -8], [12, -8, 12, 8], [12, 8, -12, 8], [-12, 8, -12, -8],
    [-1, -8, -1, 8], [2.4, -8, 2.4, 8], [-12, -1, -1, -1], [2.4, 1, 12, 1],
    [-9.6, 8, -9.6, 10.4], [-9.6, 10.4, -3.4, 10.4], [-3.4, 10.4, -3.4, 8]
  );

  const group = B.finish();
  group.add(dynamic);
  clearPropCache();

  const specialSpots = {
    l96a1: new THREE.Vector3(0.4, FLOOR.basement + 0.48, -6.9),
    m32: new THREE.Vector3(7.4, 0.84, 4.9),
    goldenPunisher: new THREE.Vector3(5.6, FLOOR.upper + 0.05, -6.0),
    chaingun: new THREE.Vector3(-6.0, 0.05, 4.2),
  };

  const defensePosts = [
    { pos: new THREE.Vector3(0.1, 0, 6.3), face: 0, level: 1 },
    { pos: new THREE.Vector3(-0.2, 0, -5.8), face: Math.PI, level: 1 },
    { pos: new THREE.Vector3(-6.5, 0, 5.8), face: 0, level: 1 },
    { pos: new THREE.Vector3(5.6, 0, 4.4), face: -Math.PI / 2, level: 1 },
    { pos: new THREE.Vector3(7.0, 0, -3.0), face: Math.PI, level: 1 },
    { pos: new THREE.Vector3(-4.5, 0, -3.5), face: Math.PI / 2, level: 1 },
    { pos: new THREE.Vector3(0.2, 0, -1.5), face: Math.PI, level: 1 },
  ];

  // unlock handling (animated in update)
  const unlock = (name) => {
    const u = unlockables[name];
    if (!u || u.open) return;
    u.open = true;
    for (const c of u.colliders) c.enabled = false;
  };
  const update = (dt) => {
    for (const u of Object.values(unlockables)) {
      if (!u.open || u.t >= 1) continue;
      u.t = Math.min(1, u.t + dt * 0.9);
      const e = 1 - Math.pow(1 - u.t, 3);
      if (u.pivot) u.pivot.rotation.y = u.closedRot + (u.openRot - u.closedRot) * e;
      if (u.group) {
        u.group.position.y = -e * 0.3;
        u.group.traverse((o) => {
          if (o.material && !o.userData._fadeClone) {
            o.material = o.material.clone();
            o.material.transparent = true;
            o.userData._fadeClone = true;
          }
          if (o.material) o.material.opacity = 1 - e;
        });
        if (u.t >= 1) u.group.visible = false;
      }
    }
  };

  const isSheltered = (x, y, z) => {
    if (x > -12 && x < 12 && z > -8 && z < 8 && y < CEIL2 + 1) return 1;
    if (x > -9.8 && x < -3.2 && z > 8 && z < 10.8 && y < 3) return 1;
    if (x > 3.8 && x < 11.2 && z > 8 && z < 9.7 && y < CEIL1) return 1;
    return 0;
  };
  const inGasZone = (x, y, z) => {
    if (x > -13.3 && x < 13.6 && z > -9.9 && z < 9.0) return false;
    if (x > -9.8 && x < -3.2 && z > 8 && z < 11.4) return false;
    if (x > 3.7 && x < 11.3 && z > 7.9 && z < 9.8 && y > 3.0) return false; // balcony: a clean-air firing spot over the yard
    if (x > -17.5 && x < -11 && z > -3.3 && z < -1.3 && y < -0.3) return false; // cellar stairwell
    return true;
  };

  return {
    group,
    world,
    lamps,
    windows,
    spawnPoints,
    portals,
    navBlocks,
    barricadeSpots,
    radarSegments,
    specialSpots,
    defensePosts,
    playerSpawn: new THREE.Vector3(0.2, 0, -0.8),
    shop: {
      bounds: [2.55, 11.85, -7.85, 0.85], // x0, x1, z0, z1 of the cellar
      floorY: FLOOR.basement,
      gate: shopGate,
      entrance: new THREE.Vector3(3.3, 0, -7.05), // ground floor, in front of the gate
      exit: new THREE.Vector3(3.2, 0, -5.4), // where anyone still downstairs is put when a round starts
    },
    unlock,
    update,
    isSheltered,
    inGasZone,
    levelOf,
    FLOOR,
  };
}

function buildRoof(B) {
  const eaveY = CEIL2 + 0.2;
  const ridgeY = 8.9;
  const overhang = 0.7;
  const halfDepth = 8 + overhang;
  const slopeLen = Math.hypot(halfDepth, ridgeY - eaveY);
  const ang = Math.atan2(ridgeY - eaveY, halfDepth);
  const mat = getMaterial('roof');
  const under = getMaterial('ceilingBoards');
  const geo = new THREE.BoxGeometry(24 + overhang * 2, 0.16, slopeLen);
  // scale UVs to world meters (roof texture repeats every metersPerRepeat)
  const mpr = mat.userData.metersPerRepeat || 2;
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (24 + overhang * 2) / mpr, uv.getY(i) * slopeLen / mpr);
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(geo, [mat, mat, mat, under, mat, mat]);
    m.userData.noBatch = true;
    m.position.set(0, (eaveY + ridgeY) / 2 + 0.08, (side * halfDepth) / 2);
    m.rotation.x = side * ang;
    m.castShadow = true;
    m.receiveShadow = true;
    B.staticGroup.add(m);
  }
  // gable triangles
  const tri = new THREE.BufferGeometry();
  const h = ridgeY - eaveY;
  const pos = new Float32Array([0, 0, -8, 0, 0, 8, 0, h, 0]);
  tri.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mprE = getMaterial('plasterExterior').userData.metersPerRepeat || 3;
  tri.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([-8 / mprE, 0, 8 / mprE, 0, 0, h / mprE]), 2));
  tri.computeVertexNormals();
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(tri, getMaterial('plasterExterior'));
    m.material = getMaterial('plasterExterior');
    m.position.set(side * 11.9, eaveY, 0);
    if (side < 0) m.rotation.y = Math.PI;
    m.castShadow = true;
    m.receiveShadow = true;
    B.staticGroup.add(m);
    const back = m.clone();
    back.rotation.y += Math.PI;
    back.position.x -= side * 0.25;
    B.staticGroup.add(back);
  }
  // chimney
  B.box(-9.4, 4.0, -3.4, -8.4, 10.0, -2.4, { mat: 'brick', surface: SURF.concrete, grime: 0, collide: false });
  B.box(-9.55, 9.9, -3.55, -8.25, 10.15, -2.25, { mat: 'concrete', surface: SURF.concrete, grime: 0, collide: false });
}
