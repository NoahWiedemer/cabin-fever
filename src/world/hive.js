// The Hive (MAPS.hive): NOX Biosystems' research complex, sublevel 4, where Nadja's lab really is. The story's
// part two plays here (it comes later: for now the 15 waves). One floor at y 0 (nav level 1):
//   - the atrium in the middle, 7 m tall round a specimen column: the fireteam holds it (the bots' posts)
//   - long corridors west (the labs, cryo storage, stores) and east (offices, the conference room, the cafeteria,
//     the lockers)
//   - the north corridor to the specimen hall and the server room, behind a blast door until round 4
//   - the outer ring round it all (security, maintenance, the morgue, the archive), sealed until round 10
//   - south of the atrium, behind the safe door: the airlock, Nadja's lab (she works in a glass clean room, like in
//     the farm lab: actors/labTech.js) and the armory (the gun shop, its clerk: actors/shopkeeper.js). It opens in
//     the buy phase; a round start shuts it and puts everyone left inside out in the atrium.
//
// Built like the farm lab (world/lab.js): world-space geometry merged per material, light baked into a vertex
// attribute from the ceiling panels, plus pooled real lamps (lighting.js) for the fight. The walls come from the
// plan: spaces (rooms, corridors) and doors are rectangles on a 0.25 m grid, every closed cell within 0.5 m of an
// open one is wall, and the baked light only reaches what it can see across the plan (no light through walls).
import * as THREE from 'three';
import { CollisionWorld, SURF, FLAG_NAVIGNORE } from './collision.js';
import { Kit, bakeMat, glow, hazardCanvas, texOf, canvas, mulberry, SCREEN, screenCanvas, signCanvas, buildNadjaStation, offsetStation } from './lab.js';
import { levelOf, FLOOR } from './level.js';
import { UPSTAIRS_ROUND, BASEMENT_ROUND } from '../game/modes.js';
import { createShopkeeper } from '../actors/shopkeeper.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { WEAPONS } from '../player/weaponDefs.js';
import * as P from './hiveProps.js';
import { makeTanks, causticsDisc, tankFloorTexture } from './hiveTank.js';
import { shellFittings, doorLeaves, ceilingFixtures, grimePass } from './hiveShell.js';
import { atriumDress } from './hiveHub.js';
import { makeCuller } from './hiveCull.js';
import { dressArmory, dressVestibule } from './hiveSafe.js';
import * as PL from './hiveLabs.js';
import * as PF from './hiveFacility.js';
import * as DA from './hiveDressA.js';
import * as DB from './hiveDressB.js';
import * as DC from './hiveDressC.js';
import * as F2 from './hiveFacility2.js';
import * as DD from './hiveDressD.js';
import * as TK from './hiveTech.js';
import { shellMaterials, pegboardMaterial, hiveMat, decalAtlas, decalUV, blobTexture, stripTexture, LabelAtlas } from './hiveTex.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const COOL = [0.93, 0.97, 1.0];
const RED = [1.0, 0.16, 0.1];
const DOWN = [0, -1, 0];

// ---------------------------------------------------------------- the plan
const C = 0.25; // grid cell (m)
const PX0 = -46, PZ0 = -42, PX1 = 46, PZ1 = 29;
const NX = Math.round((PX1 - PX0) / C), NZ = Math.round((PZ1 - PZ0) / C);
const WALL = 2; // cells of wall round every open cell (0.5 m)

// The spaces (their open floor; neighbours sit 0.5 m apart: the wall between them). zone: 'hub' (the fireteam's),
// 'safe' (the safe zone), 'start' (open from round 1), 'north' (round 4), 'ring' (round 10). stripe: the guide line's
// colour on corridor walls.
const SPACES = [
  { id: 'hub', x0: -10, z0: -10, x1: 10, z1: 10, h: 7, kind: 'hub', zone: 'hub' },
  { id: 'vest', x0: -2.5, z0: 10.5, x1: 2.5, z1: 14.5, h: 3.0, kind: 'vest', zone: 'safe' },
  { id: 'nadja', x0: -12, z0: 15, x1: 8, z1: 27, h: 4.2, kind: 'nadja', zone: 'safe' },
  { id: 'shop', x0: -20, z0: 15, x1: -12.5, z1: 27, h: 3.6, kind: 'shop', zone: 'safe' },
  // west: the labs
  { id: 'w1', x0: -40, z0: -2, x1: -10.5, z1: 2, h: 3.4, kind: 'corridor', zone: 'start', stripe: 'red' },
  { id: 'labA', x0: -34, z0: -12, x1: -25, z1: -2.5, h: 4.0, kind: 'lab', zone: 'start' },
  { id: 'labB', x0: -24.5, z0: -12, x1: -15, z1: -2.5, h: 4.0, kind: 'lab', zone: 'start' },
  { id: 'decon', x0: -14.5, z0: -8, x1: -10.5, z1: -2.5, h: 3.2, kind: 'decon', zone: 'start' },
  { id: 'cryo', x0: -34, z0: 2.5, x1: -22.5, z1: 13, h: 4.0, kind: 'cryo', zone: 'start' },
  { id: 'stores', x0: -22, z0: 2.5, x1: -15, z1: 11, h: 3.2, kind: 'stores', zone: 'start' },
  // east: the offices
  { id: 'e1', x0: 10.5, z0: -2, x1: 40, z1: 2, h: 3.4, kind: 'corridor', zone: 'start', stripe: 'blue' },
  { id: 'office1', x0: 12, z0: -10, x1: 20, z1: -2.5, h: 3.0, kind: 'office', zone: 'start' },
  { id: 'office2', x0: 20.5, z0: -10, x1: 28.5, z1: -2.5, h: 3.0, kind: 'office', zone: 'start' },
  { id: 'conf', x0: 29, z0: -12, x1: 40, z1: -2.5, h: 3.2, kind: 'conf', zone: 'start' },
  { id: 'cafe', x0: 12, z0: 2.5, x1: 27, z1: 14, h: 3.6, kind: 'cafe', zone: 'start' },
  { id: 'lockers', x0: 27.5, z0: 2.5, x1: 38, z1: 10, h: 3.0, kind: 'lockers', zone: 'start' },
  // north: round 4
  { id: 'n1', x0: -2, z0: -36, x1: 2, z1: -10.5, h: 3.4, kind: 'corridor', zone: 'north', stripe: 'yellow' },
  { id: 'specimen', x0: -18, z0: -31, x1: -2.5, z1: -14, h: 6, kind: 'specimen', zone: 'north' },
  { id: 'server', x0: 2.5, z0: -30, x1: 16, z1: -15, h: 3.6, kind: 'server', zone: 'north' },
  // the ring: round 10
  { id: 'w2', x0: -44, z0: -40, x1: -40.5, z1: 2, h: 3.4, kind: 'corridor', zone: 'ring', stripe: 'yellow' },
  { id: 'e2', x0: 40.5, z0: -40, x1: 44, z1: 2, h: 3.4, kind: 'corridor', zone: 'ring', stripe: 'yellow' },
  { id: 'n2', x0: -44, z0: -40, x1: 44, z1: -36.5, h: 3.4, kind: 'corridor', zone: 'ring', stripe: 'yellow' },
  { id: 'security', x0: -34, z0: -36, x1: -24, z1: -29, h: 3.2, kind: 'security', zone: 'ring' },
  { id: 'maint', x0: 20, z0: -36, x1: 34, z1: -26, h: 4.0, kind: 'maint', zone: 'ring' },
  { id: 'morgue', x0: -40, z0: -30, x1: -34.5, z1: -12.5, h: 3.2, kind: 'morgue', zone: 'ring' },
  { id: 'archive', x0: 34.5, z0: -30, x1: 40, z1: -12.5, h: 3.2, kind: 'archive', zone: 'ring' },
  // behind the labs: sequencing, the infirmary, the isolation ward and the containment cells (round 4, from the specimen hall)
  { id: 'genomics', x0: -34, z0: -20.5, x1: -26.5, z1: -12.5, h: 3.6, kind: 'genomics', zone: 'start' },
  { id: 'holding', x0: -34, z0: -28.5, x1: -26.5, z1: -21, h: 4.0, kind: 'holding', zone: 'north' },
  { id: 'infirmary', x0: -26, z0: -21, x1: -18.5, z1: -12.5, h: 3.2, kind: 'infirmary', zone: 'start' },
  { id: 'isolation', x0: -26, z0: -28.5, x1: -18.5, z1: -21.5, h: 3.0, kind: 'isolation', zone: 'start' },
  // behind the offices: the director, the sleeping quarters, operations (round 4, from the server room)
  { id: 'director', x0: 25.5, z0: -22.5, x1: 34, z1: -12.5, h: 3.0, kind: 'director', zone: 'start' },
  { id: 'quarters', x0: 16.5, z0: -14.5, x1: 25, z1: -10.5, h: 2.8, kind: 'quarters', zone: 'start' },
  { id: 'ops', x0: 16.5, z0: -25.5, x1: 25, z1: -15, h: 3.4, kind: 'ops', zone: 'north' },
  // south of the cafeteria and the lockers, south of cryo
  { id: 'kitchen', x0: 12, z0: 14.5, x1: 22.5, z1: 21.5, h: 3.2, kind: 'kitchen', zone: 'start' },
  { id: 'wc', x0: 27.5, z0: 10.5, x1: 33, z1: 16, h: 2.8, kind: 'wc', zone: 'start' },
  { id: 'waste', x0: -34, z0: 13.5, x1: -20.5, z1: 22, h: 3.6, kind: 'waste', zone: 'start' },
];
const SPACE = Object.fromEntries(SPACES.map((s) => [s.id, s]));

// The doors: the rect across the wall gap, the opening's height. kind: 'door' (a doorway with a frame), 'arch' (the
// atrium's wide ways), 'blast' (sealed until its `unlock`), 'safe' (the safe zone's: the gun shop runtime works it).
const DOORS = [
  { x0: -10.5, z0: -2, x1: -10, z1: 2, h: 3.2, kind: 'arch', sign: ['labs', 'e'] },
  { x0: 10, z0: -2, x1: 10.5, z1: 2, h: 3.2, kind: 'arch', sign: ['offices', 'w'] },
  { x0: -2, z0: -10.5, x1: 2, z1: -10, h: 3.2, kind: 'blast', unlock: 'north', sign: ['north', 's'] },
  { x0: -2, z0: 10, x1: 2, z1: 10.5, h: 3.0, kind: 'safe', sign: ['secure', 'n'] },
  { x0: -1.5, z0: 14.5, x1: 1.5, z1: 15, h: 2.6, kind: 'door' },
  { x0: -12.5, z0: 16, x1: -12, z1: 19, h: 2.6, kind: 'door', sign: ['armory', 'e'] },
  { x0: -31, z0: -2.5, x1: -28.5, z1: -2, h: 2.6, kind: 'door', sign: ['labA', 's'] },
  { x0: -21, z0: -2.5, x1: -18.5, z1: -2, h: 2.6, kind: 'door', sign: ['labB', 's'] },
  { x0: -13.5, z0: -2.5, x1: -12, z1: -2, h: 2.4, kind: 'door', sign: ['decon', 's'] },
  { x0: -30, z0: 2, x1: -27.5, z1: 2.5, h: 2.6, kind: 'door', sign: ['cryo', 'n'] },
  { x0: -19, z0: 2, x1: -17.5, z1: 2.5, h: 2.4, kind: 'door', sign: ['stores', 'n'] },
  { x0: -25, z0: -9, x1: -24.5, z1: -7, h: 2.4, kind: 'door' },
  { x0: 14, z0: -2.5, x1: 15.5, z1: -2, h: 2.4, kind: 'door', sign: ['office', 's'] },
  { x0: 23, z0: -2.5, x1: 24.5, z1: -2, h: 2.4, kind: 'door', sign: ['office', 's'] },
  { x0: 33, z0: -2.5, x1: 35, z1: -2, h: 2.4, kind: 'door', sign: ['conf', 's'] },
  { x0: 20, z0: -8, x1: 20.5, z1: -6.5, h: 2.4, kind: 'door' },
  { x0: 16, z0: 2, x1: 19, z1: 2.5, h: 2.6, kind: 'door', sign: ['cafe', 'n'] },
  { x0: 23.5, z0: 2, x1: 25.5, z1: 2.5, h: 2.6, kind: 'door' },
  { x0: 31, z0: 2, x1: 32.5, z1: 2.5, h: 2.4, kind: 'door', sign: ['lockers', 'n'] },
  { x0: -2.5, z0: -20, x1: -2, z1: -17, h: 3.0, kind: 'door', sign: ['specimen', 'e'] },
  { x0: -2.5, z0: -28, x1: -2, z1: -26, h: 3.0, kind: 'door' },
  { x0: 2, z0: -19, x1: 2.5, z1: -17, h: 2.6, kind: 'door', sign: ['server', 'w'] },
  { x0: -40.5, z0: -2, x1: -40, z1: 2, h: 3.2, kind: 'blast', unlock: 'ring', sign: ['ring', 'e'] },
  { x0: 40, z0: -2, x1: 40.5, z1: 2, h: 3.2, kind: 'blast', unlock: 'ring', sign: ['ring', 'w'] },
  { x0: -2, z0: -36.5, x1: 2, z1: -36, h: 3.2, kind: 'blast', unlock: 'ring', sign: ['ring', 's'] },
  { x0: -30, z0: -36.5, x1: -28, z1: -36, h: 2.4, kind: 'door', sign: ['security', 'n'] },
  { x0: 25, z0: -36.5, x1: 28, z1: -36, h: 2.8, kind: 'door', sign: ['maint', 'n'] },
  { x0: -40.5, z0: -22, x1: -40, z1: -20, h: 2.4, kind: 'door', sign: ['morgue', 'w'] },
  { x0: 40, z0: -22, x1: 40.5, z1: -20, h: 2.4, kind: 'door', sign: ['archive', 'e'] },
  // the new rooms
  { x0: -31, z0: -12.5, x1: -28.5, z1: -12, h: 2.6, kind: 'door', sign: ['genomics', 's'] },
  { x0: -23.5, z0: -12.5, x1: -21, z1: -12, h: 2.6, kind: 'door', sign: ['infirmary', 's'] },
  { x0: -31, z0: -21, x1: -29, z1: -20.5, h: 2.6, kind: 'blast', unlock: 'north', sign: ['holding', 's'] },
  { x0: -26.5, z0: -27, x1: -26, z1: -24.5, h: 2.6, kind: 'blast', unlock: 'north' },
  { x0: -23.5, z0: -21.5, x1: -21, z1: -21, h: 2.6, kind: 'door', sign: ['isolation', 's'] },
  { x0: -18.5, z0: -26, x1: -18, z1: -23.5, h: 2.6, kind: 'blast', unlock: 'north' },
  { x0: 16, z0: -22, x1: 16.5, z1: -19.5, h: 2.6, kind: 'door', sign: ['ops', 'w'] },
  { x0: 17, z0: -10.5, x1: 19, z1: -10, h: 2.4, kind: 'door', sign: ['quarters', 's'] },
  { x0: 22, z0: -10.5, x1: 24, z1: -10, h: 2.4, kind: 'door' },
  { x0: 18, z0: -15, x1: 20.5, z1: -14.5, h: 2.6, kind: 'blast', unlock: 'north' },
  { x0: 31, z0: -12.5, x1: 33, z1: -12, h: 2.6, kind: 'door', sign: ['director', 's'] },
  { x0: 25, z0: -20, x1: 25.5, z1: -18, h: 2.6, kind: 'blast', unlock: 'north' },
  { x0: 15, z0: 14, x1: 17.5, z1: 14.5, h: 2.6, kind: 'door', sign: ['kitchen', 'n'] },
  { x0: 29, z0: 10, x1: 30.5, z1: 10.5, h: 2.4, kind: 'door', sign: ['wc', 'n'] },
  { x0: -28, z0: 13, x1: -25.5, z1: 13.5, h: 2.6, kind: 'door', sign: ['waste', 'n'] },
];

// the safe zone (navBlocked: neither the infected nor the bots ever path in), the airlock's way out
const SAFE = { x0: -20.5, z0: 9.9, x1: 8.5, z1: 27.5 };
const inSafe = (p) => p.x > SAFE.x0 && p.x < SAFE.x1 && p.z > SAFE.z0 && p.z < SAFE.z1;
// Nadja's clean room (glass front at z 22.6), her station moved there from the farm lab's frame
const BOOTH = { x0: -3.5, x1: 3.5, z0: 22.6, z1: 27 };
const STATION_OFF = V(4.6, 3.2, BOOTH.z0 - 3.85); // lab.js frame → here: her station C at (0, 0, 23.81)
// the armory's clerk and counter (she faces +x, like the farm's)
const KEEPER = V(-18.6, 0, 21);
const COUNTER = { x0: -18.4, x1: -17.6, z0: 18.8, z1: 23.2, top: 1.005 };

function makePlan() {
  const N = NX * NZ;
  const open = new Uint8Array(N); // 1 space, 2 door
  const sid = new Int16Array(N).fill(-1); // the (tallest) space of an open cell
  const did = new Int16Array(N).fill(-1); // the door of a door cell
  const ix = (x) => Math.round((x - PX0) / C), iz = (z) => Math.round((z - PZ0) / C);
  SPACES.forEach((s, k) => {
    for (let j = iz(s.z0); j < iz(s.z1); j++) {
      for (let i = ix(s.x0); i < ix(s.x1); i++) {
        const c = j * NX + i;
        open[c] = 1;
        if (sid[c] < 0 || SPACES[sid[c]].h < s.h) sid[c] = k;
      }
    }
  });
  DOORS.forEach((d, k) => {
    for (let j = iz(d.z0); j < iz(d.z1); j++) {
      for (let i = ix(d.x0); i < ix(d.x1); i++) {
        const c = j * NX + i;
        if (!open[c]) open[c] = 2;
        did[c] = k;
      }
    }
  });
  const wall = new Uint8Array(N);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      if (!open[j * NX + i]) continue;
      for (let dj = -WALL; dj <= WALL; dj++) {
        for (let di = -WALL; di <= WALL; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
          const c = b * NX + a;
          if (!open[c]) wall[c] = 1;
        }
      }
    }
  }
  // a wall cell's height: the tallest ceiling round it (it has to reach every ceiling it borders)
  const wallH = new Float32Array(N);
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      if (!wall[c]) continue;
      let h = 0;
      for (let dj = -3; dj <= 3; dj++) {
        for (let di = -3; di <= 3; di++) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= NX || b >= NZ) continue;
          const k = sid[b * NX + a];
          if (k >= 0) h = Math.max(h, SPACES[k].h);
        }
      }
      wallH[c] = h || 3.2;
    }
  }
  const cellX = (i) => PX0 + i * C, cellZ = (j) => PZ0 + j * C;
  const at = (x, z) => {
    const i = Math.floor((x - PX0) / C), j = Math.floor((z - PZ0) / C);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1;
    return j * NX + i;
  };
  /** can light (or a look) cross the plan from a to b? (open and door cells pass, walls don't) */
  const clear = (ax, az, bx, bz) => {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 1; k < n; k++) {
      const c = at(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
      if (c < 0 || !open[c]) return false;
    }
    return true;
  };
  return { open, sid, did, wall, wallH, cellX, cellZ, at, clear, ix, iz };
}

/** greedy rectangles over the cells where key(c) is truthy and equal: [i0, j0, i1, j1 (exclusive), key] */
function rects(test) {
  const used = new Uint8Array(NX * NZ);
  const out = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      const k = test(c);
      if (!k || used[c]) continue;
      let i1 = i + 1;
      while (i1 < NX && !used[j * NX + i1] && test(j * NX + i1) === k) i1++;
      let j1 = j + 1;
      grow: while (j1 < NZ) {
        for (let a = i; a < i1; a++) if (used[j1 * NX + a] || test(j1 * NX + a) !== k) break grow;
        j1++;
      }
      for (let b = j; b < j1; b++) for (let a = i; a < i1; a++) used[b * NX + a] = 1;
      out.push([i, j, i1, j1, k]);
    }
  }
  return out;
}

// ---------------------------------------------------------------- signs
const SIGN_LIST = [
  ['atrium', 'SECTOR 4  ·  CENTRAL ATRIUM', 1024, '#2f7ad0'],
  ['labs', '◄  LABORATORIES  ·  CRYO', 512, '#c63a2e'],
  ['offices', 'OFFICES  ·  CAFETERIA  ►', 512, '#2f7ad0'],
  ['north', '▲  SPECIMEN HALL  ·  SERVERS', 512, '#d6a31a'],
  ['secure', 'SECURE LAB  ·  AUTHORIZED ONLY', 512, '#d6a31a', 'hazard'],
  ['logo', 'NOX BIOSYSTEMS', 512, '#3fbf6a', 'logo'],
  ['sub4', 'SUBLEVEL 4', 512, '#8a949c'],
  ['nadja', 'VIROLOGY  ·  CLEAN ROOM', 512, '#3fbf6a'],
  ['labA', 'LAB 4-A', 256, '#c63a2e'],
  ['labB', 'LAB 4-B', 256, '#c63a2e'],
  ['cryo', 'CRYO STORAGE', 256, '#3aa6d6'],
  ['stores', 'STORES', 256, '#8a949c'],
  ['decon', 'DECON', 256, '#d6a31a'],
  ['office', 'OFFICES', 256, '#2f7ad0'],
  ['conf', 'CONFERENCE', 256, '#2f7ad0'],
  ['cafe', 'CAFETERIA', 256, '#2f7ad0'],
  ['lockers', 'LOCKERS', 256, '#8a949c'],
  ['specimen', 'SPECIMEN HALL', 256, '#3fbf6a'],
  ['server', 'SERVER ROOM', 256, '#3aa6d6'],
  ['security', 'SECURITY', 256, '#c63a2e'],
  ['maint', 'MAINTENANCE', 256, '#d6a31a'],
  ['morgue', 'MORGUE', 256, '#8a949c'],
  ['archive', 'ARCHIVE', 256, '#8a949c'],
  ['genomics', 'SEQUENCING', 256, '#3fbf6a'],
  ['holding', 'CONTAINMENT', 256, '#c63a2e'],
  ['infirmary', 'INFIRMARY', 256, '#3fbf6a'],
  ['isolation', 'ISOLATION WARD', 256, '#d6a31a'],
  ['director', 'DIRECTOR', 256, '#2f7ad0'],
  ['quarters', 'QUARTERS', 256, '#2f7ad0'],
  ['ops', 'OPERATIONS', 256, '#3aa6d6'],
  ['kitchen', 'KITCHEN', 256, '#2f7ad0'],
  ['wc', 'RESTROOMS', 256, '#8a949c'],
  ['waste', 'WASTE  ·  INCINERATION', 256, '#d6a31a', 'hazard'],
  ['armory', 'ARMORY', 256, '#c63a2e'],
  ['ring', 'OUTER RING', 256, '#d6a31a', 'hazard'],
  ['lockdown', 'LOCKDOWN', 256, '#c63a2e'],
];

function signAtlas() {
  const W = 1024, RH = 128;
  const rects = {};
  let x = 0, y = 0;
  for (const [k, , w] of SIGN_LIST) {
    if (x + w > W) {
      x = 0;
      y += RH;
    }
    rects[k] = [x, y, w, RH];
    x += w;
  }
  const H = y + RH;
  const cv = canvas(W, H, (g) => {
    g.fillStyle = '#101316';
    g.fillRect(0, 0, W, H);
    for (const [k, text, , col, style] of SIGN_LIST) {
      const [rx, ry, rw, rh] = rects[k];
      g.save();
      g.beginPath();
      g.rect(rx, ry, rw, rh);
      g.clip();
      g.fillStyle = '#1b2127';
      g.fillRect(rx + 3, ry + 3, rw - 6, rh - 6);
      if (style === 'hazard') {
        g.fillStyle = '#d6a31a';
        g.fillRect(rx + 3, ry + 3, rw - 6, rh - 6);
        g.fillStyle = '#16181a';
        for (let s = -rh; s < rw; s += 36) {
          g.beginPath();
          g.moveTo(rx + s, ry + rh);
          g.lineTo(rx + s + 18, ry + rh);
          g.lineTo(rx + s + 18 + rh, ry);
          g.lineTo(rx + s + rh, ry);
          g.fill();
        }
        g.fillStyle = '#16181a';
        g.fillRect(rx + 16, ry + 26, rw - 32, rh - 52);
      } else {
        g.fillStyle = col;
        g.fillRect(rx + 3, ry + rh - 16, rw - 6, 10);
      }
      let tx = rx + rw / 2;
      if (style === 'logo') {
        // a hexagon with a stylised N in it
        const cx = rx + 64, cy = ry + rh / 2 - 4, R = 38;
        g.strokeStyle = col;
        g.lineWidth = 7;
        g.beginPath();
        for (let i = 0; i <= 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          g[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * R, cy + Math.sin(a) * R);
        }
        g.stroke();
        g.lineWidth = 8;
        g.beginPath();
        g.moveTo(cx - 14, cy + 18);
        g.lineTo(cx - 14, cy - 18);
        g.lineTo(cx + 14, cy + 18);
        g.lineTo(cx + 14, cy - 18);
        g.stroke();
        tx = rx + 64 + (rw - 64) / 2 + 10;
      }
      g.fillStyle = style === 'hazard' ? '#f0c030' : '#e8edf0';
      let fs = 64;
      g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
      const maxW = rw - (style === 'logo' ? 150 : 40);
      while (g.measureText(text).width > maxW && fs > 18) {
        fs -= 2;
        g.font = `bold ${fs}px Arial, Helvetica, sans-serif`;
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, tx, ry + rh / 2 - 5);
      g.restore();
    }
  });
  return { tex: texOf(cv), rects, W, H };
}

// ---------------------------------------------------------------- the build
export function buildHive() {
  const world = new CollisionWorld(-50, -46, 50, 33, 2);
  const group = new THREE.Group();
  group.name = 'hive';
  const dyn = new THREE.Group(); // moving things: doors, Nadja's props
  dyn.name = 'hiveDynamic';
  group.add(dyn);
  const lamps = [];
  const rnd = mulberry(4404);
  const K = new Kit();
  const plan = makePlan();
  const { open, sid, did, wall, wallH, cellX, cellZ } = plan;

  // ------------------------------------------------ materials
  const sg = signAtlas();
  const labSignTex = texOf(signCanvas()); // (Nadja's station labels come from the farm lab's atlas)
  const screenTex = texOf(screenCanvas());
  const M = {
    steel: bakeMat({ color: 0xa9b0b6, metalness: 0.75, roughness: 0.3 }),
    dark: bakeMat({ color: 0x3a4046, metalness: 0.45, roughness: 0.5 }),
    white: bakeMat({ color: 0xe4e7ea, roughness: 0.45 }),
    top: bakeMat({ color: 0x24272a, roughness: 0.3 }),
    black: bakeMat({ color: 0x141618, roughness: 0.55 }),
    yellow: bakeMat({ color: 0xd9a916, roughness: 0.6 }),
    red: bakeMat({ color: 0xa11d19, roughness: 0.5 }),
    blue: bakeMat({ color: 0x2f5da8, roughness: 0.5 }),
    green: bakeMat({ color: 0x2e6e40, roughness: 0.5 }),
    amber: bakeMat({ color: 0x5a2f0c, roughness: 0.15 }),
    card: bakeMat({ color: 0xb08a5c, roughness: 0.9 }),
    hazard: bakeMat({ map: texOf(hazardCanvas(0.35, 57), true), roughness: 0.6 }, true),
    signs: bakeMat({ map: labSignTex, roughness: 0.55 }),
    hsigns: bakeMat({ map: sg.tex, roughness: 0.5 }),
    wood: bakeMat({ color: 0x6b5238, roughness: 0.75 }),
    grey: bakeMat({ color: 0x7a838b, metalness: 0.3, roughness: 0.55 }),
    lockerBlue: bakeMat({ color: 0x3d5570, metalness: 0.4, roughness: 0.5 }),
    crate: bakeMat({ color: 0x4d5a4a, roughness: 0.7 }),
    tray: bakeMat({ color: 0x7a3c2a, roughness: 0.6 }),
    bag: bakeMat({ color: 0x1c1f22, roughness: 0.4 }),
    frost: bakeMat({ color: 0xcfdde6, roughness: 0.25 }),
    board: bakeMat({ color: 0xf2f4f5, roughness: 0.25 }),
    door: bakeMat({ color: 0x6d757c, metalness: 0.55, roughness: 0.45 }, true),
    tankFloor: bakeMat({ map: tankFloorTexture(), roughness: 0.45, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  };
  // the shell: painted / tiled / carpeted per kind of room (hiveTex.js), decals, text labels, soft shadows
  const SH = shellMaterials();
  SH.peg = pegboardMaterial();
  const F = shellFittings(); // (door leaves, ducts, plastic, rubber, brass)
  M.wall = SH.wallBase;
  const labels = new LabelAtlas();
  M.decal = hiveMat({ map: decalAtlas(), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.label = hiveMat({ map: labels.texture, roughness: 0.55 });
  M.aoBlob = new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  M.aoStrip = new THREE.MeshBasicMaterial({ map: stripTexture(), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  M.aoStrip.map.wrapS = THREE.RepeatWrapping;
  const U = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0xe6f3ff, roughness: 0.05, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.8, side: THREE.DoubleSide }),
    blue: glow(0x2aa8ff, 1.1),
    green: glow(0x52ff6a, 1.0),
    amber: glow(0xffa22a, 1.0),
    magenta: glow(0xff3ad2, 1.0),
    cyan: glow(0x3affe2, 0.9),
    red: glow(0xff3024, 1.0),
    panel: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.4, 4.6, 5.0) }),
    dimPanel: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.85) }),
    deadPanel: new THREE.MeshStandardMaterial({ color: 0x9aa1a6, roughness: 0.3 }),
    bigPanel: new THREE.MeshBasicMaterial({ color: new THREE.Color(5.0, 5.2, 5.6) }),
    screen: new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.5, 1.5, 1.5) }),
    murk: new THREE.MeshStandardMaterial({ color: 0x3f7a2a, emissive: 0x2c7a1c, emissiveIntensity: 1.1, transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.2 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x27332a, roughness: 0.65, emissive: 0x0c1f0e, emissiveIntensity: 1 }),
    ledG: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3.2, 0.6) }),
    ledA: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.2) }),
    ledB: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 3.4) }),
    ledR: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 0.25, 0.2) }),
    vend: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 1.2) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.05, 0.04) }),
    neon: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.5, 0.35) }),
  };
  // three circuits of guttering ceiling tubes: their emissive stutters (the baked light stays)
  U.flick = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(4.4, 4.6, 5.0) }));
  const liquids = [U.blue, U.green, U.amber, U.magenta, U.cyan];

  // ------------------------------------------------ the build context (hiveProps.js)
  const lights = [];
  const updates = [];
  updates.push((dt, t) => {
    U.flick.forEach((m, i) => {
      const x = t * (6 + i * 2.7) + i * 9.1;
      const v = Math.sin(x) * Math.sin(x * 2.3 + 1) * Math.sin(x * 5.1);
      const f = v > 0.32 ? 0.06 + (v - 0.32) * 0.5 : 1;
      m.color.setRGB(4.4 * f, 4.6 * f, 5.0 * f);
    });
  });
  const c = {
    K,
    M,
    U,
    rnd,
    col: (x0, y0, z0, x1, y1, z1, surf = SURF.metal, flags = 0, tag = null) => world.add(x0, y0, z0, x1, y1, z1, surf, flags, tag),
    light: (x, y, z, i, r, rgb = COOL, dir = null, range = null) => lights.push({ x, y, z, i, r, c: rgb, dir, range: range ?? r * 3.4 }),
    lamp: (o) => lamps.push({ level: 1, color: 0xdde6ff, intensity: 26, angle: 1.15, distance: 11, flicker: 0, spot: true, fx: false, ...o }),
    X: {}, // the props' extra materials (their modules' EXTRA_MATS / EXTRA_GLOW)
    G: {},
    dyn,
    updates,
    screen: (x, y, z, yaw, w, h, on) => {
      const keys = Object.keys(SCREEN);
      if (on) K.plane(U.screen, w, h, x, y, z, [0, yaw, 0], SCREEN[keys[Math.floor(rnd() * keys.length)]], 1024, 512);
      else K.plane(M.black, w, h, x, y, z, [0, yaw, 0]);
    },
  };
  const T = makeTanks({ group, updates, K, M, U, c });
  // the furniture modules bring their own materials (EXTRA_MATS: plain params; EXTRA_GLOW: [colour, intensity])
  const FURN = [PL, PF, DA, DB, DC, F2, DD, TK];
  for (const m of FURN) {
    for (const [k, v] of Object.entries(m.EXTRA_MATS ?? {})) c.X[k] ??= hiveMat(v);
    for (const [k, v] of Object.entries(m.EXTRA_GLOW ?? {})) c.G[k] ??= glow(v[0], v[1]);
  }
  /** a sign from the atlas: centre (x, y, z), facing `face`, w m wide (its height follows the atlas region) */
  const sign = (key, x, y, z, face, w = null) => {
    const r = sg.rects[key];
    const ww = w ?? r[2] / 256 * 0.9;
    const hh = (ww * r[3]) / r[2];
    K.plane(M.hsigns, ww, hh, x, y, z, [0, P.FACE_YAW[face], 0], r, sg.W, sg.H);
  };
  const roomRect = (s, m = 0.6) => (p) => p.x > s.x0 - m && p.x < s.x1 + m && p.z > s.z0 - m && p.z < s.z1 + m;

  // decals (blood, grime, paper …), text labels and soft shadows: flat planes the props can drop anywhere
  const NORM = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
  const uvRect = (g, [u0, v0, u1, v1]) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
    return g;
  };
  let decalN = 0;
  c.decal = (kind, x, z, size, rot = 0, o = {}) => {
    const g = uvRect(new THREE.PlaneGeometry(size, size * (o.aspect ?? 1)), decalUV(kind));
    g.rotateX(-Math.PI / 2);
    g.rotateY(rot);
    g.translate(x, 0.004 + (decalN++ % 6) * 0.0003, z);
    K.put(M.decal, g);
  };
  c.wallDecal = (kind, x, y, z, face, w, h) => {
    const g = uvRect(new THREE.PlaneGeometry(w, h), decalUV(kind));
    g.rotateY(P.FACE_YAW[face]);
    const [nx, nz] = NORM[face];
    g.translate(x + nx * (0.014 + (decalN++ % 6) * 0.0003), y, z + nz * (0.014 + (decalN % 6) * 0.0003));
    K.put(M.decal, g);
  };
  c.label = (text, x, y, z, face, w, h, o = {}) => {
    const r = labels.rect(o.lines ?? text, o, w, h);
    if (face === 'up') return K.plane(M.label, w, h, x, y, z, [-Math.PI / 2, o.yaw ?? 0, 0, 'YXZ'], r, labels.W, labels.H); // (lying on the floor)
    const [nx, nz] = NORM[face];
    K.plane(M.label, w, h, x + nx * 0.02, y, z + nz * 0.02, [0, P.FACE_YAW[face], 0], r, labels.W, labels.H);
  };
  /** a soft shadow strip along a wall / round a footprint (AO): (x0,z0)-(x1,z1) run along its long axis, `side` the way it fades */
  const strip = (mat, len, wd, cx, y, cz, yaw, up) => {
    const g = new THREE.PlaneGeometry(len, wd);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.rotateY(yaw);
    g.translate(cx, y, cz);
    K.put(mat, g);
  };

  // ------------------------------------------------ the shell: floors, ceilings, walls, lintels
  const X = (i) => cellX(i), Z = (j) => cellZ(j);
  // finishes per kind of room: the wall paint, the wainscot (its height), the floor, the ceiling
  const RING = { paint: 'concrete', wain: 'steelDark', wh: 1.2, floor: 'concreteDark', ceil: 'concreteDark' };
  const FIN = {
    hub: { paint: 'concrete', wain: 'steel', wh: 1.2, floor: 'terrazzo', ceil: 'concrete' },
    corridor: { paint: 'white', wain: 'band', wh: 1.1, floor: 'epoxy', ceil: 'tile' },
    vest: { paint: 'white', wain: 'steel', wh: 1.2, floor: 'epoxy', ceil: 'tile' },
    nadja: { paint: 'white', wain: 'tile', wh: 1.4, floor: 'epoxy', ceil: 'tile' },
    shop: { paint: 'sand', wain: 'wood', wh: 1.1, floor: 'epoxyDark', ceil: 'tile' },
    lab: { paint: 'white', wain: 'tile', wh: 1.4, floor: 'epoxy', ceil: 'tile' },
    genomics: { paint: 'white', wain: 'tileBlue', wh: 1.3, floor: 'vinyl', ceil: 'tile' },
    decon: { paint: 'green', wain: 'tileGreen', wh: 3.0, floor: 'vinylGreen', ceil: 'concrete' },
    cryo: { paint: 'blue', wain: 'steel', wh: 1.3, floor: 'epoxyDark', ceil: 'concrete' },
    stores: { paint: 'sand', wain: 'band', wh: 1.1, floor: 'concrete', ceil: 'concrete' },
    office: { paint: 'cream', wain: 'band', wh: 0.95, floor: 'carpetGrey', ceil: 'tile' },
    conf: { paint: 'grey', wain: 'wood', wh: 1.2, floor: 'carpetBlue', ceil: 'tileWarm' },
    cafe: { paint: 'yellow', wain: 'tileCream', wh: 1.3, floor: 'checker', ceil: 'tile' },
    kitchen: { paint: 'white', wain: 'tileCream', wh: 2.0, floor: 'vinyl', ceil: 'tile' },
    lockers: { paint: 'grey', wain: 'band', wh: 1.1, floor: 'vinyl', ceil: 'tile' },
    wc: { paint: 'blue', wain: 'tileBlue', wh: 2.0, floor: 'vinyl', ceil: 'tile' },
    quarters: { paint: 'sand', wain: 'wood', wh: 1.0, floor: 'carpetBrown', ceil: 'tileWarm' },
    director: { paint: 'cream', wain: 'wood', wh: 1.6, floor: 'parquet', ceil: 'tileWarm' },
    ops: { paint: 'dark', wain: 'steelDark', wh: 1.0, floor: 'carpetBlue', ceil: 'concreteDark' },
    server: { paint: 'blue', wain: 'steelDark', wh: 1.1, floor: 'raised', ceil: 'concreteDark' },
    security: { paint: 'grey', wain: 'band', wh: 1.1, floor: 'epoxyDark', ceil: 'tile' },
    maint: { paint: 'yellow', wain: 'steelDark', wh: 1.2, floor: 'concreteDark', ceil: 'concreteDark' },
    morgue: { paint: 'green', wain: 'tileGreen', wh: 2.2, floor: 'vinylGreen', ceil: 'tile' },
    archive: { paint: 'sand', wain: 'band', wh: 1.0, floor: 'carpetGrey', ceil: 'tile' },
    specimen: { paint: 'green', wain: 'steelDark', wh: 1.4, floor: 'epoxyDark', ceil: 'concreteDark' },
    holding: { paint: 'concrete', wain: 'steelDark', wh: 1.2, floor: 'concreteDark', ceil: 'concreteDark' },
    infirmary: { paint: 'white', wain: 'tileGreen', wh: 1.3, floor: 'vinylGreen', ceil: 'tile' },
    isolation: { paint: 'cream', wain: 'tileCream', wh: 1.3, floor: 'vinyl', ceil: 'tileWarm' },
    waste: { paint: 'concrete', wain: 'steelDark', wh: 1.3, floor: 'concreteDark', ceil: 'concreteDark' },
  };
  const finOf = (sp) => (sp.zone === 'ring' && sp.kind === 'corridor' ? RING : FIN[sp.kind] ?? FIN.lab);
  const FLOOR_MPR = { epoxy: 3, epoxyDark: 3, vinyl: 1.2, vinylGreen: 1.2, checker: 1.8, carpetBlue: 1, carpetGrey: 1, carpetBrown: 1, carpetRed: 1, concrete: 3, concreteDark: 3, terrazzo: 3, raised: 1.2, plate: 0.6, parquet: 1.2 };
  // floors: one material per space (its finish), a steel threshold in every door
  const floorKey = (cc) => (open[cc] === 1 ? sid[cc] + 1 : open[cc] === 2 ? 999 : 0);
  for (const [i0, j0, i1, j1, k] of rects(floorKey)) {
    const name = k === 999 ? 'plate' : finOf(SPACES[k - 1]).floor;
    K.box(SH.floors[name], X(i0), -0.2, Z(j0), X(i1), 0, Z(j1), { faces: ['py'], seg: 1.0, mpr: FLOOR_MPR[name] });
  }
  // ceilings (per space; not over doors: the lintels close those)
  const ceilKey = (cc) => (open[cc] === 1 ? sid[cc] + 1 : 0);
  const ceilings = rects(ceilKey);
  for (const [i0, j0, i1, j1, k] of ceilings) {
    const h = SPACES[k - 1].h;
    K.box(SH.ceils[finOf(SPACES[k - 1]).ceil], X(i0), h, Z(j0), X(i1), h + 0.25, Z(j1), { faces: ['ny'], seg: 1.2, mpr: 2.4 });
    world.add(X(i0), h, Z(j0), X(i1), h + 0.25, Z(j1), SURF.concrete);
  }
  // walls, by height
  const wKey = (cc) => (wall[cc] ? Math.round(wallH[cc] * 100) : 0);
  const walls = rects(wKey);
  for (const [i0, j0, i1, j1, k] of walls) {
    const h = k / 100;
    const x0 = X(i0), x1 = X(i1), z0 = Z(j0), z1 = Z(j1);
    K.box(M.wall, x0, 0, z0, x1, h, z1, { faces: ['px', 'nx', 'pz', 'nz'], seg: 1.0, mpr: 2.4 });
    world.add(x0, 0, z0, x1, h, z1, SURF.concrete);
  }
  // the floor slab under everything
  world.add(PX0, -0.3, PZ0, PX1, 0, PZ1, SURF.concrete);
  // lintels over the doors
  const doorInfo = DOORS.map((d) => {
    const alongX = d.x1 - d.x0 > d.z1 - d.z0; // the opening runs along x (a wall along x)
    let top = d.h;
    // the ceilings on both sides
    const probe = (x, z) => {
      const cc = plan.at(x, z);
      return cc >= 0 && sid[cc] >= 0 ? SPACES[sid[cc]].h : 0;
    };
    const cx = (d.x0 + d.x1) / 2, cz = (d.z0 + d.z1) / 2;
    const hA = alongX ? probe(cx, d.z0 - 0.3) : probe(d.x0 - 0.3, cz);
    const hB = alongX ? probe(cx, d.z1 + 0.3) : probe(d.x1 + 0.3, cz);
    top = Math.max(hA, hB, d.h + 0.3);
    return { ...d, alongX, cx, cz, top };
  });
  for (const d of doorInfo) {
    K.box(M.wall, d.x0, d.h, d.z0, d.x1, d.top, d.z1, { faces: ['ny', ...(d.alongX ? ['pz', 'nz'] : ['px', 'nx'])], seg: 1.0, mpr: 2.4 });
    world.add(d.x0, d.h, d.z0, d.x1, d.top, d.z1, SURF.concrete);
  }

  // ------------------------------------------------ skirting, guide stripes, door frames
  const isWallAt = (x, z) => {
    const cc = plan.at(x, z);
    return cc >= 0 && !!wall[cc];
  };
  const CAP = { tile: M.white, tileGreen: M.white, tileBlue: M.white, tileCream: M.white, wood: M.wood, steel: M.dark, steelDark: M.dark, band: M.dark, bandGreen: M.dark, bandBlue: M.dark };
  const WAIN_MPR = { tile: 1.2, tileGreen: 1.2, tileBlue: 1.2, tileCream: 1.2, wood: 1.2, steel: 1.2, steelDark: 1.2, band: 2.4, bandGreen: 2.4, bandBlue: 2.4 };
  const YAW_FLOOR = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };
  const YAW_CEIL = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 };
  /** the room's own finish along one run [b0, b1] of one of its edges: paint above, wainscot below, a cap rail, soft shadows */
  const clad = (sp, e, b0, b1) => {
    const fin = finOf(sp);
    const paint = SH.paints[fin.paint], wain = SH.wains[fin.wain];
    const wh = Math.min(fin.wh, sp.h - 0.2), top = sp.h;
    const inward = -e.out;
    const face = e.alongX ? (e.out < 0 ? 'pz' : 'nz') : e.out < 0 ? 'px' : 'nx';
    const side = e.alongX ? (e.out < 0 ? 'n' : 's') : e.out < 0 ? 'w' : 'e';
    const plane = (mat, y0, y1, off, mpr) => {
      const o = e.fixed + off * inward;
      if (e.alongX) K.box(mat, b0, y0, o, b1, y1, o, { faces: [face], seg: 1.0, mpr });
      else K.box(mat, o, y0, b0, o, y1, b1, { faces: [face], seg: 1.0, mpr });
    };
    plane(paint, wh, top, 0.004, 2.4);
    plane(wain, 0.1, wh, 0.008, WAIN_MPR[fin.wain]);
    if (wh < 2.6) {
      const t = 0.028 * inward, rail = CAP[fin.wain];
      if (e.alongX) K.box(rail, b0, wh - 0.014, Math.min(e.fixed, e.fixed + t), b1, wh + 0.024, Math.max(e.fixed, e.fixed + t), { faces: [face, 'py', 'ny'] });
      else K.box(rail, Math.min(e.fixed, e.fixed + t), wh - 0.014, b0, Math.max(e.fixed, e.fixed + t), wh + 0.024, b1, { faces: [face, 'py', 'ny'] });
    }
    // contact shadows: on the floor along the wall and on the ceiling
    const len = b1 - b0, mid = (b0 + b1) / 2;
    const cx = e.alongX ? mid : e.fixed + inward * 0.3, cz = e.alongX ? e.fixed + inward * 0.3 : mid;
    strip(M.aoStrip, len, 0.6, cx, 0.007, cz, YAW_FLOOR[side], true);
    strip(M.aoStrip, len, 0.5, e.alongX ? mid : e.fixed + inward * 0.25, top - 0.006, e.alongX ? e.fixed + inward * 0.25 : mid, YAW_CEIL[side], false);
  };
  const STRIPE = { red: M.red, blue: M.blue, yellow: M.yellow, green: M.green };
  for (const s of SPACES) {
    const stripe = s.stripe ? STRIPE[s.stripe] : s.kind === 'hub' ? M.blue : null;
    const edges = [
      { a0: s.x0, a1: s.x1, fixed: s.z0, out: -1, alongX: true },
      { a0: s.x0, a1: s.x1, fixed: s.z1, out: 1, alongX: true },
      { a0: s.z0, a1: s.z1, fixed: s.x0, out: -1, alongX: false },
      { a0: s.z0, a1: s.z1, fixed: s.x1, out: 1, alongX: false },
    ];
    for (const e of edges) {
      let run0 = null;
      const flush = (a) => {
        if (run0 === null) return;
        const b0 = run0, b1 = a;
        run0 = null;
        if (b1 - b0 < 0.2) return;
        clad(s, e, b0, b1);
        const t = 0.018 * e.out; // proud of the wall, into the room
        if (e.alongX) {
          const z = e.fixed;
          K.box(M.dark, b0, 0, Math.min(z, z - t), b1, 0.12, Math.max(z, z - t), { faces: [e.out < 0 ? 'pz' : 'nz', 'py'] });
          if (stripe) K.box(stripe, b0, 1.02, Math.min(z, z - t * 0.6), b1, 1.14, Math.max(z, z - t * 0.6), { faces: [e.out < 0 ? 'pz' : 'nz', 'py', 'ny'] });
        } else {
          const x = e.fixed;
          K.box(M.dark, Math.min(x, x - t), 0, b0, Math.max(x, x - t), 0.12, b1, { faces: [e.out < 0 ? 'px' : 'nx', 'py'] });
          if (stripe) K.box(stripe, Math.min(x, x - t * 0.6), 1.02, b0, Math.max(x, x - t * 0.6), 1.14, b1, { faces: [e.out < 0 ? 'px' : 'nx', 'py', 'ny'] });
        }
      };
      for (let a = e.a0; a < e.a1 - 1e-6; a += C) {
        const m = a + C / 2;
        const px = e.alongX ? m : e.fixed + e.out * 0.1, pz = e.alongX ? e.fixed + e.out * 0.1 : m;
        if (isWallAt(px, pz)) {
          if (run0 === null) run0 = a;
        } else flush(a);
      }
      flush(e.a1);
    }
  }
  // door frames (steel jambs and a header through the wall), signs over them
  for (const d of doorInfo) {
    if (d.kind === 'blast' || d.kind === 'safe') continue;
    const fw = d.kind === 'arch' ? 0.16 : 0.08;
    const mat = d.kind === 'arch' ? M.hazard : M.steel;
    if (d.alongX) {
      K.box(mat, d.x0, 0, d.z0 - 0.04, d.x0 + fw, d.h, d.z1 + 0.04);
      K.box(mat, d.x1 - fw, 0, d.z0 - 0.04, d.x1, d.h, d.z1 + 0.04);
      K.box(mat, d.x0, d.h - fw, d.z0 - 0.04, d.x1, d.h, d.z1 + 0.04);
    } else {
      K.box(mat, d.x0 - 0.04, 0, d.z0, d.x1 + 0.04, d.h, d.z0 + fw);
      K.box(mat, d.x0 - 0.04, 0, d.z1 - fw, d.x1 + 0.04, d.h, d.z1);
      K.box(mat, d.x0 - 0.04, d.h - fw, d.z0, d.x1 + 0.04, d.h, d.z1);
    }
  }
  for (const d of doorInfo) {
    if (!d.sign) continue;
    const [key, face] = d.sign;
    const off = 0.03;
    const x = face === 'e' ? d.x1 + off : face === 'w' ? d.x0 - off : d.cx;
    const z = face === 's' ? d.z1 + off : face === 'n' ? d.z0 - off : d.cz;
    sign(key, x, d.h + 0.32, z, face, key === 'atrium' ? 4 : null);
  }

  // the walls above the doors get each side's own paint
  const spaceAt = (x, z) => {
    const cc = plan.at(x, z);
    return cc >= 0 && sid[cc] >= 0 ? SPACES[sid[cc]] : null;
  };
  for (const d of doorInfo) {
    const A = d.alongX ? spaceAt(d.cx, d.z0 - 0.3) : spaceAt(d.x0 - 0.3, d.cz);
    const B = d.alongX ? spaceAt(d.cx, d.z1 + 0.3) : spaceAt(d.x1 + 0.3, d.cz);
    for (const [sp, sideMin] of [[A, true], [B, false]]) {
      if (!sp) continue;
      const mat = SH.paints[finOf(sp).paint];
      if (d.alongX) {
        const z = sideMin ? d.z0 - 0.004 : d.z1 + 0.004;
        K.box(mat, d.x0, d.h, z, d.x1, sp.h, z, { faces: [sideMin ? 'nz' : 'pz'], seg: 1.0, mpr: 2.4 });
      } else {
        const x = sideMin ? d.x0 - 0.004 : d.x1 + 0.004;
        K.box(mat, x, d.h, d.z0, x, sp.h, d.z1, { faces: [sideMin ? 'nx' : 'px'], seg: 1.0, mpr: 2.4 });
      }
    }
  }

  // ------------------------------------------------ ceiling panels (baked light) and the pooled lamps
  // Each part of the complex has its mood: the safe zone and the labs clinical and bright, the offices dimmer with
  // more dead panels, the server room blue, maintenance under sodium lamps, the morgue cold and half dark, and the
  // outer ring (the containment failure, round 10) on red emergency lights with most of its panels dead.
  // i: panel strength, broken / dim: the share of dead / weak panels, rgb: the light's colour, lamp: the pooled
  // lamp's colour and strength, emergency: red emergency lights along the walls instead
  const WARM = [1.0, 0.78, 0.5], BLUE = [0.62, 0.78, 1.0], COLD = [0.85, 0.93, 1.0];
  const MOOD = {
    corridor: { i: 0.72, broken: 0.1, dim: 0.14, rgb: COOL, lamp: 0xdde6ff },
    ring: { i: 0.45, broken: 0.82, dim: 0.1, rgb: COOL, lamp: 0xff3522, emergency: true },
    lab: { i: 0.66, broken: 0.07, rgb: COOL, lamp: 0xdde6ff },
    decon: { i: 0.55, broken: 0.1, rgb: [0.9, 1.0, 0.8], lamp: 0xe8ffd0 },
    cryo: { i: 0.6, broken: 0.1, rgb: [0.8, 0.92, 1.0], lamp: 0xcfe6ff },
    stores: { i: 0.5, broken: 0.2, rgb: WARM, lamp: 0xffd2a0 },
    office: { i: 0.62, broken: 0.2, dim: 0.16, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    conf: { i: 0.48, broken: 0.25, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    cafe: { i: 0.58, broken: 0.14, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    lockers: { i: 0.45, broken: 0.3, rgb: COOL, lamp: 0xdde6ff },
    specimen: { i: 0.7, broken: 0.15, rgb: [0.8, 1.0, 0.86], lamp: 0xc8ffd6 },
    server: { i: 0.38, broken: 0.2, rgb: BLUE, lamp: 0x9cc0ff },
    security: { i: 0.5, broken: 0.25, rgb: COOL, lamp: 0xdde6ff },
    maint: { i: 0.6, broken: 0.2, rgb: WARM, lamp: 0xffb060 },
    morgue: { i: 0.45, broken: 0.35, rgb: COLD, lamp: 0xc0d8ff },
    archive: { i: 0.42, broken: 0.3, rgb: WARM, lamp: 0xffd2a0 },
    genomics: { i: 0.66, broken: 0.06, rgb: [0.85, 1.0, 0.95], lamp: 0xd8fff0 },
    holding: { i: 0.5, broken: 0.35, rgb: [0.8, 1.0, 0.8], lamp: 0xb8ffc0 },
    infirmary: { i: 0.7, broken: 0.1, rgb: [0.95, 1.0, 0.98], lamp: 0xeafff4 },
    isolation: { i: 0.5, broken: 0.25, rgb: [1.0, 0.9, 0.7], lamp: 0xffe0b0 },
    director: { i: 0.42, broken: 0.15, rgb: [1.0, 0.86, 0.66], lamp: 0xffd8a8 },
    quarters: { i: 0.36, broken: 0.3, dim: 0.3, rgb: [1.0, 0.88, 0.7], lamp: 0xffd6a0 },
    ops: { i: 0.36, broken: 0.2, rgb: BLUE, lamp: 0x9cc0ff },
    kitchen: { i: 0.66, broken: 0.1, rgb: [1.0, 0.97, 0.9], lamp: 0xfff4e0 },
    wc: { i: 0.5, broken: 0.3, rgb: COLD, lamp: 0xdde8ff },
    waste: { i: 0.5, broken: 0.25, rgb: [1.0, 0.8, 0.5], lamp: 0xffb868 },
    safe: { i: 0.66, broken: 0, rgb: COOL, lamp: 0xdde6ff },
  };
  const moodOf = (s) => (s.zone === 'safe' ? MOOD.safe : s.zone === 'ring' && s.kind === 'corridor' ? MOOD.ring : MOOD[s.kind] ?? MOOD.lab);
  for (const s of SPACES) {
    const corridor = s.kind === 'corridor';
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    if (s.kind === 'hub') continue; // (its own, below)
    const md = moodOf(s);
    if (corridor) {
      const alongX = w > d;
      const L = alongX ? w : d;
      const n = Math.max(1, Math.round(L / 4));
      for (let i = 0; i < n; i++) {
        const u = (alongX ? s.x0 : s.z0) + (L * (i + 0.5)) / n;
        const x = alongX ? u : (s.x0 + s.x1) / 2, z = alongX ? (s.z0 + s.z1) / 2 : u;
        const r = rnd();
        const broken = r < md.broken, dim = !broken && r < md.broken + (md.dim ?? 0);
        P.panel(c, x, z, s.h, { len: 1.3, alongX, broken, dim, flick: !broken && !dim && rnd() < md.broken * 0.4 ? 1 + Math.floor(rnd() * 3) : 0, i: md.i, r: 3.0, color: md.rgb });
        // a pooled lamp every 3rd panel (a flicker on some)
        if (!broken && i % 3 === 1 && !md.emergency) c.lamp({ pos: V(x, s.h - 0.12, z), color: md.lamp, flicker: rnd() < 0.3 ? 0.35 : 0, room: roomRect(s, 1.5) });
      }
      if (md.emergency) {
        // red emergency lights on alternate walls every 7 m, a flickering red lamp every 3rd
        const m = Math.max(1, Math.round(L / 7));
        for (let i = 0; i < m; i++) {
          const u = (alongX ? s.x0 : s.z0) + (L * (i + 0.5)) / m;
          const side = i % 2 ? 1 : -1;
          const x = alongX ? u : side < 0 ? s.x0 + 0.06 : s.x1 - 0.06, z = alongX ? (side < 0 ? s.z0 + 0.06 : s.z1 - 0.06) : u;
          const y = s.h - 0.7;
          K.box(M.dark, x - 0.16, y - 0.07, z - 0.16, x + 0.16, y + 0.07, z + 0.16);
          K.box(U.red, x - 0.13, y - 0.1, z - 0.13, x + 0.13, y - 0.07, z + 0.13);
          c.light(x + (alongX ? 0 : -side * 0.3), y - 0.2, z + (alongX ? -side * 0.3 : 0), 0.9, 2.6, RED, null, 8);
          if (i % 3 === 1) c.lamp({ pos: V(x + (alongX ? 0 : -side * 0.3), y - 0.2, z + (alongX ? -side * 0.3 : 0)), color: 0xff2a18, intensity: 16, angle: 1.3, distance: 9, flicker: 0.25, room: roomRect(s, 1.5) });
        }
      }
    } else {
      const nx = Math.max(1, Math.round(w / 3.6)), nz = Math.max(1, Math.round(d / 3.6));
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const x = s.x0 + (w * (a + 0.5)) / nx, z = s.z0 + (d * (b + 0.5)) / nz;
          const r = rnd();
          const broken = r < md.broken, dim = !broken && r < md.broken + (md.dim ?? 0);
          P.panel(c, x, z, s.h, { len: 1.2, alongX: true, broken, dim, flick: !broken && !dim && rnd() < md.broken * 0.4 ? 1 + Math.floor(rnd() * 3) : 0, i: md.i, r: s.h > 5 ? 4.4 : 3.0, color: md.rgb });
        }
      }
      c.lamp({ pos: V((s.x0 + s.x1) / 2, s.h - 0.12, (s.z0 + s.z1) / 2), color: md.lamp, intensity: s.h > 5 ? 55 : 24, distance: s.h > 5 ? 14 : 10, flicker: md.broken > 0.2 ? 0.3 : 0, room: roomRect(s) });
    }
  }

  // ------------------------------------------------ the atrium: the specimen column, consoles, cover, the gallery band
  {
    const H = SPACE.hub.h;
    // big ceiling panels, 3 x 3
    for (const x of [-6, 0, 6]) {
      for (const z of [-6, 0, 6]) {
        if (x === 0 && z === 0) continue;
        K.cube(M.dark, x, H - 0.03, z, 2.7, 0.06, 0.7);
        K.cube(U.bigPanel, x, H - 0.065, z, 2.5, 0.012, 0.5);
        for (const s of [-0.8, 0, 0.8]) c.light(x + s, H - 0.15, z, 0.46, 5.0, COOL, DOWN, 17);
      }
    }
    for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) c.lamp({ pos: V(x, H - 0.2, z), intensity: 48, distance: 15, angle: 1.2, room: roomRect(SPACE.hub, 1) });
    // the tank: a Crusher adrift in green murk, bubbles rising, a lit inlay in the floor and rippling caustics round it
    T.tank({ x: 0, z: 0, H });
    {
      const ring = new THREE.RingGeometry(3.12, 6.4, 96, 3);
      ring.rotateX(-Math.PI / 2);
      ring.translate(0, 0.004, 0);
      K.put(M.tankFloor, ring);
      group.add(causticsDisc(0, 0, 6.6));
    }
    for (const [y, k] of [[0.8, 0.9], [1.9, 0.9], [3.0, 0.75], [4.1, 0.4]]) c.light(0, y, 0, k, 3.2, [0.3, 1.0, 0.5], null, 11);
    c.light(0, 0.9, 0, 1.4, 4.5, [0.25, 0.9, 0.5], DOWN.map((v) => -v), 9);
    // consoles round the column, facing out
    for (const [x, z, face] of [[0, -3.2, 'n'], [0, 3.2, 's'], [-3.2, 0, 'w'], [3.2, 0, 'e']]) {
      const alongX = face === 'n' || face === 's';
      const r = alongX ? [x - 0.9, z - 0.35, x + 0.9, z + 0.35] : [x - 0.35, z - 0.9, x + 0.35, z + 0.9];
      P.desk(c, r, face, { mess: false });
    }
    // cover near the ways in: crates, sandbags of supply cases, a toppled gurney
    P.crates(c, -7.2, -3.6, 0.9, 2);
    P.crates(c, -7.8, 3.8, 0.8, 1, { wood: true });
    P.crates(c, 7.4, 3.4, 0.9, 2);
    P.crates(c, 7.9, -4.2, 0.8, 1, { wood: true });
    P.drum(c, -8.6, -7.8);
    P.drum(c, 8.7, 7.9, { mat: M.red });
    P.gurney(c, 5.6, -7.2, 0.4, { tipped: true });
    P.gurney(c, -5.8, 7.5, 1.3, { bag: true });
    P.clutter(c, -3, -7, 8, 2.5);
    P.clutter(c, 4, 6.5, 6, 2);
    // the architecture (pilasters, gallery windows, roof beams, wayfinding, directory boards …)
    atriumDress(c, { SH, F, H, P, sign });
    sign('atrium', 0, 6.2, -9.96, 's', 5.2);
    sign('logo', 0, 6.2, 9.96, 'n', 3.6);
    sign('sub4', -9.96, 6.2, 0, 'e', 3.2);
    sign('sub4', 9.96, 6.2, 0, 'w', 3.2);
    // pipes round the top of the atrium
    P.pipeRun(c, -9.6, -9.6, 9.6, -9.6, H - 0.4, 3, 0.1);
    P.pipeRun(c, -9.6, 9.6, 9.6, 9.6, H - 0.4, 2, -0.3);
  }

  // ------------------------------------------------ the corridors' fittings
  for (const id of ['w1', 'e1', 'n1', 'w2', 'e2', 'n2']) {
    const s = SPACE[id];
    const alongX = s.x1 - s.x0 > s.z1 - s.z0;
    const y = s.h - 0.35;
    if (alongX) {
      P.pipeRun(c, s.x0 + 0.2, s.z0 + 0.25, s.x1 - 0.2, s.z0 + 0.25, y, 3, 0);
      P.cableTray(c, s.x0 + 0.2, s.z1 - 0.35, s.x1 - 0.2, s.z1 - 0.35, s.h - 0.3);
    } else {
      P.pipeRun(c, s.x0 + 0.25, s.z0 + 0.2, s.x0 + 0.25, s.z1 - 0.2, y, 3, 0);
      P.cableTray(c, s.x1 - 0.35, s.z0 + 0.2, s.x1 - 0.35, s.z1 - 0.2, s.h - 0.3);
    }
  }

  // ------------------------------------------------ the rooms
  // the specimen hall's tubes (a zombie in each; one smashed): the rest of the hall is dressSpecimen's
  for (const [x, z, o] of [
    [-15.5, -17.5, { kind: 'normal', pose: 'limp', yaw: 2.6 }],
    [-12.5, -17.5, { broken: true }],
    [-9.5, -17.5, { kind: 'woman', pose: 'curl', yaw: 3.3 }],
    [-6.5, -17.5, { kind: 'worker', pose: 'reach', yaw: 2.9 }],
  ]) T.tube({ x, z, r: 0.62, h: 2.9, ceil: SPACE.specimen.h, ...o });

  // ------------------------------------------------ the furniture: each room's dress function
  const doorsOf = (id) => {
    const sp = SPACE[id];
    return doorInfo.filter((d) => d.x1 >= sp.x0 - 0.01 && d.x0 <= sp.x1 + 0.01 && d.z1 >= sp.z0 - 0.01 && d.z0 <= sp.z1 + 0.01);
  };
  const ctx = { S: SPACE, doors: doorInfo, doorsOf, V, anchor: {} };
  const DRESS = {
    labA: PL.dressLabA,
    labB: PL.dressLabB,
    genomics: DA.dressGenomics,
    decon: DA.dressDecon,
    cryo: DA.dressCryo,
    infirmary: DA.dressInfirmary,
    isolation: DB.dressIsolation,
    holding: DB.dressHolding,
    morgue: DB.dressMorgue,
    waste: DC.dressWaste,
    specimen: DC.dressSpecimen,
    nadja: DC.dressNadjaHall,
    cafe: F2.dressCafe,
    kitchen: F2.dressKitchen,
    lockers: F2.dressLockers,
    wc: F2.dressWc,
    quarters: F2.dressQuarters,
    office1: DD.dressOffice1,
    office2: DD.dressOffice2,
    conf: DD.dressConf,
    director: DD.dressDirector,
    server: TK.dressServer,
    ops: TK.dressOps,
    security: TK.dressSecurity,
    maint: TK.dressMaint,
    stores: TK.dressStores,
    archive: TK.dressArchive,
  };
  for (const sp of SPACES) (sp.kind === 'corridor' ? DD.dressCorridor : DRESS[sp.id])?.(c, sp, ctx);

  // ------------------------------------------------ emergency beacons over the blast doors (red), the safe door (amber)
  const beacons = [];
  for (const d of doorInfo) {
    if (d.kind !== 'blast' && d.kind !== 'safe') continue;
    const mat = new THREE.MeshBasicMaterial({ color: d.kind === 'safe' ? new THREE.Color(0.6, 0.35, 0.05) : new THREE.Color(0.5, 0.05, 0.04) });
    const sides = d.alongX ? [[d.cx - (d.x1 - d.x0) / 2 - 0.35, d.z0 - 0.08], [d.cx + (d.x1 - d.x0) / 2 + 0.35, d.z0 - 0.08], [d.cx - (d.x1 - d.x0) / 2 - 0.35, d.z1 + 0.08], [d.cx + (d.x1 - d.x0) / 2 + 0.35, d.z1 + 0.08]] : [[d.x0 - 0.08, d.cz - (d.z1 - d.z0) / 2 - 0.35], [d.x0 - 0.08, d.cz + (d.z1 - d.z0) / 2 + 0.35], [d.x1 + 0.08, d.cz - (d.z1 - d.z0) / 2 - 0.35], [d.x1 + 0.08, d.cz + (d.z1 - d.z0) / 2 + 0.35]];
    for (const [x, z] of sides) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      m.position.set(x, d.h + 0.12, z);
      m.rotation.x = Math.PI; // (the dome hangs down)
      dyn.add(m);
    }
    beacons.push({ d, mat, t: 0 });
    c.light(d.cx, d.h + 0.1, d.cz, 0.18, 1.6, d.kind === 'safe' ? [1, 0.6, 0.15] : RED, null, 4);
  }

  // ------------------------------------------------ the safe zone: the airlock, Nadja's lab, the armory
  let station = null; // (Nadja's, built below: the lab runtime's work contract)
  {
    const v = SPACE.vest;
    // the airlock: decon nozzles on both walls, hazard stripes on the floor at the doors
    for (const z of [11.5, 12.8]) {
      for (const x of [v.x0 + 0.05, v.x1 - 0.05]) K.cyl(M.steel, x, 2.7, z, 0.05, 0.05, 0.08, 10, [0, 0, Math.PI / 2]);
    }
    K.box(M.hazard, -2, 0.001, 10.5, 2, 0.004, 10.9, { faces: ['py'] });
    K.box(M.hazard, -1.5, 0.001, 14.1, 1.5, 0.004, 14.5, { faces: ['py'] });
    sign('secure', 0, 2.55, 14.46, 'n', 2.4);
  }
  {
    const s = SPACE.nadja;
    // her clean room: a glass front, white side walls, a steel band up to the ceiling
    const gz = BOOTH.z0;
    K.box(U.glass, BOOTH.x0, 0.05, gz - 0.03, BOOTH.x1, 2.95, gz + 0.03);
    K.box(M.steel, BOOTH.x0, 0, gz - 0.06, BOOTH.x1, 0.08, gz + 0.06);
    K.box(M.steel, BOOTH.x0, 2.95, gz - 0.06, BOOTH.x1, 3.05, gz + 0.06);
    K.box(M.white, BOOTH.x0, 3.05, gz - 0.05, BOOTH.x1, s.h, gz + 0.05, { faces: ['nz', 'pz', 'ny'] });
    for (const x of [BOOTH.x0 + 0.03, -1.18, 1.18, BOOTH.x1 - 0.03]) K.box(M.steel, x - 0.03, 0, gz - 0.05, x + 0.03, 2.95, gz + 0.05);
    for (const x of [BOOTH.x0, BOOTH.x1]) {
      K.box(M.white, x - 0.1, 0, gz, x + 0.1, s.h, BOOTH.z1, { faces: ['px', 'nx', 'nz'] });
      world.add(x - 0.1, 0, gz, x + 0.1, s.h, BOOTH.z1, SURF.metal, 0, 'labWall');
    }
    world.add(BOOTH.x0, 0, gz - 0.05, BOOTH.x1, 3.05, gz + 0.05, SURF.glass, FLAG_NAVIGNORE, 'labGlass');
    world.add(BOOTH.x0, 3.05, gz - 0.05, BOOTH.x1, s.h, gz + 0.05, SURF.metal, 0, 'labWall');
    sign('nadja', 0, 3.55, gz - 0.06, 'n', 3.0);
    // inside: shelving and a fridge behind her, monitors on the back wall
    P.shelf(c, [-3.3, 26.45, -1.2, 27], { fill: 'bottles' });
    P.freezer(c, [1.6, 26.1, 3.3, 27], 'n');
    for (const x of [-0.8, 0.4]) c.screen(x, 2.1, 26.97, Math.PI, 1.0, 0.56, true);
    K.box(M.black, -1.35, 1.78, 26.96, 0.95, 2.42, 26.99);
    // the station (world/lab.js buildNadjaStation, moved from the farm lab's frame)
    const Ks = new Kit();
    const dynS = new THREE.Group();
    const st0 = buildNadjaStation(Ks, M, U, dynS, labSignTex, liquids);
    station = offsetStation(st0, Ks.parts, STATION_OFF);
    for (const [mat, geos] of Ks.parts) for (const g of geos) K.put(mat, g);
    Ks.parts.clear();
    while (dynS.children.length) dyn.add(dynS.children[0]);
    // her lamp: a spot over the counter, aimed away from the glass
    c.lamp({ pos: V(0, s.h - 0.25, 24.3), aim: V(0, -0.8, 0.45).multiplyScalar(3), intensity: 7, angle: 0.8, distance: 7, mains: false, room: roomRect(s, 2) });
    c.light(0, 2.95, 24.0, 0.7, 2.2, COOL, DOWN, 5);
    // the lab outside the booth is dressNadjaHall's; the specimen tubes stand in it
    T.tube({ x: -9.5, z: 24.8, r: 0.6, h: 2.8, kind: 'gasmask', pose: 'spread', yaw: Math.PI });
    T.tube({ x: 6, z: 24.6, r: 0.55, h: 2.7, kind: 'smoker', pose: 'limp', yaw: Math.PI });
  }
  {
    const s = SPACE.shop;
    // the counter (the clerk's back edge at COUNTER.x0), racks of guns on the wall behind her, ammo cases
    K.box(M.wood, COUNTER.x0, 0.95, COUNTER.z0, COUNTER.x1 + 0.05, COUNTER.top, COUNTER.z1);
    K.box(M.dark, COUNTER.x0 + 0.05, 0, COUNTER.z0 + 0.05, COUNTER.x1, 0.95, COUNTER.z1 - 0.05);
    K.box(M.hazard, COUNTER.x1 - 0.01, 0.1, COUNTER.z0 + 0.1, COUNTER.x1 + 0.005, 0.25, COUNTER.z1 - 0.1, { faces: ['px'] });
    world.add(COUNTER.x0, 0, COUNTER.z0, COUNTER.x1 + 0.05, COUNTER.top, COUNTER.z1, SURF.wood);
    K.box(SH.peg, s.x0 + 0.02, 1.0, 16.5, s.x0 + 0.06, 3.0, 25.5, { faces: ['px', 'py', 'ny', 'pz', 'nz'], mpr: 0.5, seg: 1 }); // the pegboard
    P.shelf(c, [s.x0 + 1, s.z0, s.x0 + 5, s.z0 + 0.6], { fill: 'boxes' });
    P.cabinet(c, [s.x0, 25.6, s.x0 + 0.6, 27], 'e', { h: 1.9, mat: M.dark, drawers: 2 });
    // the neon over the counter
    K.box(U.neon, -17.62, 2.55, 19.6, -17.6, 2.62, 22.4);
    c.light(-17.2, 2.6, 21, 0.5, 2.0, [1, 0.3, 0.2], null, 4);
    sign('armory', -17.58, 2.85, 21, 'e', 1.6);
    c.lamp({ pos: V(-17.4, s.h - 0.2, 21), intensity: 22, angle: 1.0, distance: 8, room: roomRect(s, 1) });
    dressArmory(c, s, { F, P, COUNTER });
  }
  dressVestibule(c, SPACE.vest, { F, P });

  // ------------------------------------------------ blast doors and the safe door: the leaves (their own Kit: they move)
  const leaves = [];
  const unlockables = {};
  for (const d of doorInfo) {
    if (d.kind !== 'blast' && d.kind !== 'safe') continue;
    const KL = new Kit();
    const t = 0.18;
    const w = d.alongX ? d.x1 - d.x0 : d.z1 - d.z0;
    // the leaf in local coords: across `w`, up to the opening's height, t thick (built at the closed spot, then shifted
    // up as it opens)
    const cx = d.cx, cz = d.cz;
    const bx0 = d.alongX ? d.x0 : cx - t / 2, bx1 = d.alongX ? d.x1 : cx + t / 2;
    const bz0 = d.alongX ? cz - t / 2 : d.z0, bz1 = d.alongX ? cz + t / 2 : d.z1;
    KL.box(M.door, bx0, 0, bz0, bx1, d.h, bz1, { seg: 0.8 });
    // hazard bands top and bottom, ribs
    const band = (y0, y1) => (d.alongX ? KL.box(M.hazard, bx0, y0, bz0 - 0.01, bx1, y1, bz1 + 0.01) : KL.box(M.hazard, bx0 - 0.01, y0, bz0, bx1 + 0.01, y1, bz1));
    band(0.05, 0.4);
    band(d.h - 0.4, d.h - 0.05);
    for (let k = 1; k < 4; k++) {
      const y = 0.4 + ((d.h - 0.8) * k) / 4;
      if (d.alongX) KL.box(M.dark, bx0, y - 0.04, bz0 - 0.025, bx1, y + 0.04, bz1 + 0.025);
      else KL.box(M.dark, bx0 - 0.025, y - 0.04, bz0, bx1 + 0.025, y + 0.04, bz1);
    }
    const leaf = new THREE.Group();
    dyn.add(leaf);
    const flags = d.kind === 'safe' ? FLAG_NAVIGNORE : 0;
    const box = world.add(bx0, 0, bz0, bx1, d.h, bz1, SURF.metal, flags, d.kind === 'safe' ? 'safeDoor' : 'blastDoor');
    const L = { d, leaf, KL, box, open: false, t: 0, w, sound: 0 };
    leaves.push(L);
    if (d.unlock) (unlockables[d.unlock] ??= []).push(L);
    if (d.kind === 'safe') leaves.safe = L;
  }

  // ------------------------------------------------ the building's own fittings: doors, ceilings, grime
  {
    doorLeaves(c, { doorInfo, spaceAt, F });
    ceilingFixtures(c, { spaces: SPACES, finOf, F });
    grimePass(c, { spaces: SPACES, doorInfo, spaceAt });
  }

  // ------------------------------------------------ contact shadows under everything that stands on the floor
  {
    const pad = 0.3;
    for (const b of world.boxes) {
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      if (b.surface === SURF.concrete || b.tag || b.minY > 0.05 || b.maxY < 0.3 || w > 7 || d > 7 || w < 0.2 || d < 0.2) continue;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
      // four fading strips round the footprint
      strip(M.aoStrip, w + pad * 2, pad, cx, 0.0065, b.minZ - pad / 2, YAW_FLOOR.s, true);
      strip(M.aoStrip, w + pad * 2, pad, cx, 0.0065, b.maxZ + pad / 2, YAW_FLOOR.n, true);
      strip(M.aoStrip, d, pad, b.minX - pad / 2, 0.0065, cz, YAW_FLOOR.e, true);
      strip(M.aoStrip, d, pad, b.maxX + pad / 2, 0.0065, cz, YAW_FLOOR.w, true);
    }
  }

  // ------------------------------------------------ bake and build
  const bake = makeHiveBaker(lights, plan);
  T.finish();
  K.build(group, bake, 12);
  for (const L of leaves) {
    L.KL.build(L.leaf, bake);
    L.KL = null;
  }
  group.traverse((o) => {
    if (o.isMesh) o.userData.noBatch = true;
  });
  // rooms behind walls are not drawn (hiveCull.js); a probe that renders nothing hands the culler the camera
  const culler = makeCuller(group, { open, NX, NZ, PX0, PZ0, C });
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const probe = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    probe.frustumCulled = false;
    probe.onBeforeRender = (renderer, scene, camera) => culler.update(camera.position);
    group.add(probe);
  }

  // ------------------------------------------------ gameplay data
  // where the infected come from: every space but the atrium and the safe zone, clear of furniture
  const spawnPoints = [];
  const clearAt = (x, z) => {
    let blocked = false;
    world.query(x - 0.55, z - 0.55, x + 0.55, z + 0.55, (bx) => {
      if (bx.enabled && bx.maxY > 0.25 && bx.minY < 1.8) return (blocked = true);
    });
    return !blocked;
  };
  for (const s of SPACES) {
    if (s.zone === 'hub' || s.zone === 'safe') continue;
    for (let x = s.x0 + 1.1; x < s.x1 - 1.0; x += 2.4) {
      for (let z = s.z0 + 1.1; z < s.z1 - 1.0; z += 2.4) {
        const px = x + (rnd() - 0.5) * 0.8, pz = z + (rnd() - 0.5) * 0.8;
        if (clearAt(px, pz)) spawnPoints.push(V(px, 0, pz));
      }
    }
  }
  const defensePosts = [
    { pos: V(0, 0, 6.8), face: 0, level: 1 },
    { pos: V(-6.4, 0, 1.9), face: -Math.PI / 2, level: 1 },
    { pos: V(6.4, 0, -1.9), face: Math.PI / 2, level: 1 },
    { pos: V(2.8, 0, -6.6), face: Math.PI, level: 1 },
    { pos: V(-6.6, 0, -6.2), face: -Math.PI * 0.75, level: 1 },
    { pos: V(6.6, 0, 6.2), face: Math.PI * 0.4, level: 1 },
    { pos: V(-3.4, 0, 6.6), face: -Math.PI / 2, level: 1 },
  ];
  // the radar: the walls' centre lines
  const radarSegments = [];
  for (const [i0, j0, i1, j1] of walls) {
    const x0 = X(i0), x1 = X(i1), z0 = Z(j0), z1 = Z(j1);
    if (x1 - x0 >= z1 - z0) radarSegments.push([x0, (z0 + z1) / 2, x1, (z0 + z1) / 2]);
    else radarSegments.push([(x0 + x1) / 2, z0, (x0 + x1) / 2, z1]);
  }
  const specialSpots = {
    goldenPunisher: { pos: V(-13, 0.98, -23), where: 'in the specimen hall', requires: 'north' },
    chaingun: { pos: V(4.9, 0.8, -16.2), where: 'in the server room', requires: 'north' },
    l96a1: { pos: V(-29.5, 0.8, -32.9), where: 'in the security office', requires: 'ring' },
    m32: { pos: V(18, 1.0, 13.05), where: 'on the cafeteria counter' },
  };
  const navBlocks = [{ level: 1, rect: [SAFE.x0, SAFE.x1, SAFE.z0, SAFE.z1] }];

  // ------------------------------------------------ runtime
  let time = 0;
  const flick = []; // (none yet: the dying panels are dark)
  const update = (dt) => {
    time += dt;
    for (const L of leaves) {
      const goal = L.open ? 1 : 0;
      if (L.t !== goal) {
        L.t = THREE.MathUtils.clamp(L.t + (goal > L.t ? dt / 2.4 : -dt / 1.1), 0, 1);
        const e = L.t * L.t * (3 - 2 * L.t);
        L.leaf.position.y = e * (L.d.h - 0.12);
      }
    }
    for (const b of beacons) {
      const moving = b.d === leaves.safe?.d ? leaves.safe.t > 0 && leaves.safe.t < 1 : (unlockables[b.d.unlock] ?? []).some((L) => L.t > 0 && L.t < 1);
      const k = moving ? (Math.sin(time * 9) > 0 ? 1 : 0.15) : 0.35 + 0.15 * Math.sin(time * 1.3);
      if (b.d.kind === 'safe') b.mat.color.setRGB(3.2 * k, 1.8 * k, 0.25 * k);
      else b.mat.color.setRGB(4 * k, 0.35 * k, 0.25 * k);
    }
    for (const f of flick) f(dt, time);
    for (const u of updates) u(dt, time);
  };
  /** the main menu's shots run only the animations (the tank's zombie, its bubbles), not the doors */
  const menuUpdate = (dt) => {
    time += dt;
    for (const u of updates) u(dt, time);
  };
  /** unlock(name): the blast doors that belong to it slide up; the nav opens there (game.js _endRound) */
  const unlock = (name, game) => {
    for (const L of unlockables[name] ?? []) {
      if (L.open) continue;
      L.open = true;
      L.box.enabled = false;
      const d = L.d;
      game?.nav?.refreshRect(d.x0 - 0.6, d.x1 + 0.6, d.z0 - 0.6, d.z1 + 0.6);
      game?.audio?.play('vault_open', { position: V(d.cx, 1.5, d.cz), volume: 1 });
    }
  };
  const resetDoors = (game) => {
    for (const L of leaves) {
      if (L.d.kind !== 'blast' || !L.open) continue;
      L.open = false;
      L.t = 0;
      L.leaf.position.y = 0;
      L.box.enabled = true;
      const d = L.d;
      game?.nav?.refreshRect(d.x0 - 0.6, d.x1 + 0.6, d.z0 - 0.6, d.z1 + 0.6);
    }
  };

  // Nadja (the farm lab's runtime contract, game.lab): she works, glances at whoever is at the glass, flinches at hits
  const work = {
    ...station,
    light: V(0, 3.9, 24.3),
    glass: V(0, 1.65, BOOTH.z0),
    focus: V(0, 1.6, BOOTH.z0 - 1.7),
    hall: V(0, 1.1, 26.9),
    lookZ: 4.6 + STATION_OFF.z,
  };
  let tech = null;
  const _cam = V();
  const lab = {
    group,
    work,
    door: null,
    hackMount: null,
    forceVisible: false,
    setLock() {},
    openDoor() {},
    get doorOpen() {
      return 0;
    },
    get tech() {
      return tech;
    },
    spawnTech(create) {
      if (!tech) tech = create(dyn, work);
      return tech;
    },
    onGlassHit(p) {
      tech?.startle(p);
    },
    update(dt, game) {
      const cam = game?.camera?.position;
      if (!tech || !cam) return;
      // only while someone can see her: the camera in the safe zone or at its open door
      if (cam.z < 8 || cam.x < -21 || cam.x > 9) return;
      tech.update(dt, { cam: _cam.copy(cam) });
    },
  };

  // the gun shop: the safe zone's door and the armory's clerk (game.gunshop)
  const shop = {
    custom: (scene, game) => safeZoneShop(scene, game, { leaves, world, dyn }),
    entrance: V(0, 0, 8.4),
  };

  const isSheltered = () => 1;
  const inGasZone = () => false;

  return {
    id: 'hive',
    group,
    world,
    lamps,
    windows: [],
    spawnPoints,
    spawnBand: [14, 32],
    portals: [],
    navBlocks,
    navOpts: { minX: PX0, maxX: PX1, minZ: PZ0, maxZ: PZ1 },
    entrances: [],
    barricadeSpots: [],
    breachSpots: [],
    radarSegments,
    specialSpots,
    generator: null,
    defensePosts,
    lab,
    shaft: null,
    playerSpawn: V(0, 0, 18.6),
    playerYaw: Math.PI, // facing the airlock and the atrium
    shop,
    unlocks: [
      {
        id: 'north', round: UPSTAIRS_ROUND, open: ['north'], portals: [], news: 'THE NORTH WING IS OPEN', sound: 'vault_unlock',
        banners: [['THE NORTH WING IS OPEN', 'The specimen hall, the server room, operations and the containment cells · a special weapon waits in there · so does whatever got loose', 'danger', 3300, 3.5]],
      },
      {
        id: 'ring', round: BASEMENT_ROUND, open: ['ring'], portals: [], news: 'THE OUTER RING IS OPEN', sound: 'vault_unlock',
        banners: [['CONTAINMENT FAILURE', 'The outer ring’s blast doors are up · they can come round behind you now', 'danger', 3300, 3.5]],
      },
    ],
    resetDoors,
    menuUpdate,
    culler,
    story: false,
    landmarks: false,
    stalkerHouse: null,
    bigMap: false,
    indoor: { sky: 0x4a525c, ground: 0x56605a, hemi: 0.45 }, // (lighting.js: the hemisphere indoors (weak: the light is baked), no moon, no lightning)
    events: [], // (game/events.js: none of the outdoor events down here)
    squad: false, // (no NOX drop: they'd need the sky)
    eventCenter: 'team',
    eventClear: () => false,
    powerPole: V(0, 6, 0),
    inHouse: () => false,
    drips: [],
    decor: {
      density: 0.16, // (the rooms carry their own grime and stories: a few of the game's splats on top)
      walls: 7,
      rooms: [
        [-38, -12, -1.6, 1.6, 0],
        [12, 38, -1.6, 1.6, 0],
        [-33, -26, -11, -4, 0],
        [13, 19, -9.5, -3, 0],
        [13, 26, 3.5, 12.5, 0],
        [-9, 9, -9, -6, 0],
        [-17, -9, -30, -22, 0],
        [-1.6, 1.6, -34, -12, 0],
        [-33, -27, -20, -13, 0], // the new rooms
        [-25, -19, -20, -13, 0],
        [-25, -19, -28, -22, 0],
        [-33, -27, -28, -22, 0],
        [17, 24, -25, -16, 0],
        [26, 33, -22, -13, 0],
        [17, 24, -14, -11, 0],
        [13, 21, 15, 21, 0],
        [-33, -21, 14, 21, 0],
        [28, 32, 11, 15, 0],
      ],
      pools: [[-9, 9, -9, 9, 0.02, 4], [-38, -12, -1.5, 1.5, 0.02, 3], [12, 38, -1.5, 1.5, 0.02, 3]],
    },
    menuShots: {
      title: { fov: 56, period: 90, a: [-7.6, 1.6, 8.4, 0, 3.2, 0], b: [-5.8, 2.3, 8.8, 0, 3.4, 0] }, // the specimen column
      porch: { fov: 58, period: 70, a: [-11.4, 1.6, 0.8, -40, 1.5, 0], b: [-11.8, 1.7, -0.9, -40, 1.6, 0] }, // down the west corridor
      interior: { fov: 60, period: 80, a: [11.6, 1.6, -0.8, 40, 1.5, 0], b: [11.2, 1.7, 0.9, 40, 1.6, 0] }, // down the east corridor
      // the PLAY screen (ui/lobbyStage.js): in the atrium before the column, the squad facing the camera (looking toward
      // -z, screen left is -x: the first seat has the smallest x)
      lobby: {
        fov: 40,
        period: 60,
        fog: 0.1,
        hemi: 0.9,
        moon: 0,
        torch: 1.15,
        a: [0, 1.5, 9.4, 0, 1.25, -1],
        b: [0.3, 1.55, 9.1, 0, 1.25, -1],
        cast: { spots: [[-1.35, 5.0, 0.22], [-0.45, 5.0, 0.08], [0.45, 5.0, -0.08], [1.35, 5.0, -0.22]] },
      },
    },
    unlock,
    update,
    isSheltered,
    inGasZone,
    ladders: [],
    barn: null,
    levelOf,
    FLOOR,
  };
}

// ---------------------------------------------------------------- baked light
/**
 * Per-vertex light from the panels (the farm lab's model, world/lab.js makeBaker): Lambertian panels with a soft wrap,
 * a 1 / (1 + d²/r²) falloff faded out to zero at `range`, a small hemispherical ambient, and no light through walls:
 * a light only reaches a vertex it can see across the plan (hive.js makePlan clear()).
 */
function makeHiveBaker(lights, plan) {
  const B = 4;
  const bnx = Math.ceil((PX1 - PX0) / B), bnz = Math.ceil((PZ1 - PZ0) / B);
  const buckets = Array.from({ length: bnx * bnz }, () => []);
  for (const L of lights) {
    const r = L.range;
    const i0 = Math.max(0, Math.floor((L.x - r - PX0) / B)), i1 = Math.min(bnx - 1, Math.floor((L.x + r - PX0) / B));
    const j0 = Math.max(0, Math.floor((L.z - r - PZ0) / B)), j1 = Math.min(bnz - 1, Math.floor((L.z + r - PZ0) / B));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * bnx + i].push(L);
  }
  return (geo) => {
    const Pa = geo.attributes.position.array, N = geo.attributes.normal.array;
    const n = Pa.length / 3;
    const out = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const px = Pa[v * 3], py = Pa[v * 3 + 1], pz = Pa[v * 3 + 2];
      const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
      const up = ny > 0 ? ny : 0, down = ny < 0 ? -ny : 0;
      let r = 0.035 + 0.015 * up + 0.04 * down, g = r * 1.02, b = r * 1.07;
      const bi = Math.floor((px - PX0) / B), bj = Math.floor((pz - PZ0) / B);
      const list = bi >= 0 && bj >= 0 && bi < bnx && bj < bnz ? buckets[bj * bnx + bi] : [];
      const sx = px + nx * 0.2, sz = pz + nz * 0.2;
      for (const L of list) {
        const dx = L.x - px, dy = L.y - py, dz = L.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const R2 = L.range * L.range;
        if (d2 >= R2) continue;
        const d = Math.sqrt(d2) + 1e-6;
        const ndl = (nx * dx + ny * dy + nz * dz) / d;
        if (ndl <= -0.2) continue;
        const emit = L.dir ? -(L.dir[0] * dx + L.dir[1] * dy + L.dir[2] * dz) / d : 1;
        if (emit <= 0) continue;
        const win = 1 - d2 / R2;
        const k = ((L.i * (L.dir ? 0.25 + 0.75 * emit : 1) * Math.min(1, (ndl + 0.2) / 1.2)) / (1 + d2 / (L.r * L.r))) * win * win;
        if (k < 0.002) continue;
        if (d > 0.7 && !plan.clear(sx, sz, L.x, L.z)) continue;
        r += k * L.c[0];
        g += k * L.c[1];
        b += k * L.c[2];
      }
      out[v * 3] = r;
      out[v * 3 + 1] = g;
      out[v * 3 + 2] = b;
    }
    geo.setAttribute('bake', new THREE.BufferAttribute(out, 3));
  };
}

// ---------------------------------------------------------------- the safe zone as the gun shop
/**
 * game.gunshop for the Hive: the safe door opens in the buy phase (and for the first countdown, when the fireteam
 * starts in Nadja's lab) and shuts when a round starts; evacuate() puts anyone still inside (the player, a bot) out
 * in the atrium before the door. The clerk works the armory's counter; the store opens there (tap F).
 */
function safeZoneShop(scene, game, { leaves, world, dyn }) {
  const L = leaves.safe;
  const keeper = createShopkeeper(scene, {
    pos: KEEPER,
    yaw: Math.PI / 2,
    counter: { edge: COUNTER.x0, top: COUNTER.top },
    glances: [V(-13, 1.4, 17.5), V(-14.5, 1.2, 25), V(-16.5, 1.6, 21), V(-12.4, 1.5, 21)],
  });
  if (keeper) world.add(KEEPER.x - 0.22, 0, KEEPER.z - 0.26, COUNTER.x0, 1.75, KEEPER.z + 0.26, SURF.flesh, FLAG_NAVIGNORE, 'shopkeeper');
  // the guns on the pegboard behind her (the store's own models)
  for (const [i, id] of ['m4a1', 'ak47', 'spas12', 'p90', 'awm', 'mg42'].entries()) {
    if (!WEAPONS[id]) continue;
    try {
      const m = buildWeaponModel(WEAPONS[id].model).root;
      // (as built: the muzzle toward -z, along the wall, its right side toward the room)
      m.position.set(-19.86, 1.35 + (i % 3) * 0.55, 17.6 + Math.floor(i / 3) * 4.6 + (i % 3) * 0.2);
      m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = true;
        }
      });
      dyn.add(m);
    } catch (e) {
      /* a missing model: the peg stays empty */
    }
  }
  let open = false;
  const inShop = (p) => p.x > -20 && p.x < -12.5 && p.z > 15 && p.z < 27;
  const shop = {
    root: dyn,
    keeper,
    entrance: V(0, 0, 8.4),
    get isOpen() {
      return open;
    },
    /** in the armory, at the counter, while it's open */
    canInteract(player) {
      return open && !!player?.alive && inShop(player.pos) && player.pos.x > COUNTER.x1 - 0.1 && player.pos.distanceTo(KEEPER) < 3.4;
    },
    setOpen(v) {
      // (the run's first countdown: the fireteam starts in Nadja's lab and walks out)
      open = !!v || (game.round === 0 && game.state === 'intermission');
      L.open = open;
      L.box.enabled = !open;
    },
    evacuate(p) {
      if (!p?.pos || !inSafe(p.pos)) return false;
      const k = (p.isPlayer ? 0 : 1 + game.bots.indexOf(p)) % 4;
      p.pos.set(-1.5 + k, 0, 8.2 - (k % 2) * 0.6);
      p.body?.vel?.set(0, 0, 0);
      p.vel?.set?.(0, 0, 0);
      return true;
    },
    update(dt) {
      if (keeper) {
        const cam = game?.camera?.position;
        const active = !!cam && cam.x < -11.8 && cam.z > 14.4;
        keeper.root.visible = active;
        if (active) {
          const p = game.player;
          const buy = game.state === 'shop' && p?.alive;
          const near = buy && inShop(p.pos) && p.pos.distanceTo(KEEPER) < 6;
          const engaged = !!buy && (!!game.shopOpen || (near && shop.canInteract(p)));
          keeper.update(dt, { cam: cam.clone(), engaged, storeOpen: !!game.shopOpen });
        }
      }
    },
  };
  shop.setOpen(false);
  return shop;
}
