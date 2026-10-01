// The Hive (MAPS.hive): NOX Biosystems' research complex, where Nadja's lab really is. The story's part two plays
// here (it comes later: for now the 15 waves). Three floors, the nav's levels (FLOORS):
//   - sublevel 4 (y 0): the atrium in the middle, 7 m tall round a specimen column: the fireteam holds it. Long
//     corridors west (labs, decon, cryo, stores) and east (offices, conference, the big cafeteria, lockers); the north
//     wing (the specimen hall, the server room) behind a blast door until round 4; the outer ring round it all
//     (security, maintenance, the morgue, the archive) under red emergency light, sealed until round 10.
//   - level 5 (y 3.45): a gallery round the atrium (a flight up on each side) and past it the upper floor: labs 5-C and
//     5-D, the monitoring room (a window on the gallery), the biobank, records, the directors' offices, virology 5-E,
//     the upper archive, the elevator hall; over the north wing (round 4) the isolation ward, its corridor looking down
//     into the specimen hall. The infected come from up there too, and jump down off the gallery where its railing is
//     torn away (drops: one-way portals).
//   - the crashed elevator: its car lies wrecked at the bottom of the shaft from the elevator hall down to sublevel 5;
//     a maintenance ladder runs up the shaft, you can also just jump; its door into sublevel 5 opens with it.
//   - Nadja's lab (the safe zone): the farm lab of part one itself (world/lab.js buildLab, moved here whole), seen from
//     inside: its gallery at the main floor behind the vault door and the armored window, the farm's basement beyond
//     them (the way the fireteam came in: the door stands open, the house above has come down), the hall 2.8 m down,
//     where Nadja works at a counter standing free in the room; past the hall's far door the armory (the gun shop, its
//     clerk: actors/shopkeeper.js). A corridor leads from the gallery's east end to the atrium; its safe door opens in
//     the buy phase, a round start shuts it and puts everyone left inside out in the atrium. Nadja's requests: from
//     round 2 she wants something from somewhere in the complex, marked on the map; bring it to the sample hatch by the
//     safe door for cash, xp and a supply box.
//   - sublevel 5 (y -3.2, round 7): stairs down off both wings, the flooded wing (a long corridor between labs full of
//     water behind glass, the drowned in them) and the pump hall, 12 m tall, its catwalks and a bridge a floor up.
// Toxic gas comes and goes (gasZones: other rooms every round, a leak mid-round, now and then a corner of the atrium);
// the horde comes from other sides every round, and now and then out of a vent near you (spawnAt).
//
// Built like the farm lab (world/lab.js): world-space geometry merged per material, light baked into a vertex
// attribute from the ceiling panels, plus pooled real lamps (lighting.js) for the fight. The shell comes from the
// plan: spaces and doors are boxes on a 0.25 m grid, each grid cell a column of open intervals (every floor's rooms,
// the doors' openings, a catwalk's deck cut out of a hall), and everything else is solid: floors, ceilings, walls and
// colliders are the boundaries between open and solid. The baked light only reaches what it can see through the
// columns (no light through walls or floors). The lab and the basement are their own builds (EXT: the plan leaves
// their insides alone).
import * as THREE from 'three';
import { CollisionWorld, SURF, FLAG_NAVIGNORE, FLAG_NOBULLET, FLAG_STAIR } from './collision.js';
import { Kit, bakeMat, glow, panelTex, floorTex, ceilTex, hazardCanvas, texOf, canvas, speckle, mulberry, SCREEN, screenCanvas, signCanvas, buildLab, LAB_OPENINGS } from './lab.js';
import { LevelBuilder } from './levelBuilder.js';
import { buildProp } from './propsSafe.js';
import { levelOf, FLOOR } from './level.js';
import { UPSTAIRS_ROUND, BASEMENT_ROUND } from '../game/modes.js';
import { createShopkeeper } from '../actors/shopkeeper.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { SpriteParticles } from '../fx/particles.js';
import * as Progress from '../game/progress.js';
import * as P from './hiveProps.js';
import { makeTanks, causticsDisc, tankFloorTexture } from './hiveTank.js';
import { shellMaterials, hiveMat, decalAtlas, decalUV, blobTexture, stripTexture, LabelAtlas } from './hiveTex.js';
import { shellFittings, doorLeaves, ceilingFixtures, grimePass } from './hiveShell.js';
import { atriumDress } from './hiveHub.js';
import { makeCuller } from './hiveCull.js';
import * as PL from './hiveLabs.js';
import * as PF from './hiveFacility.js';
import * as DA from './hiveDressA.js';
import * as DB from './hiveDressB.js';
import * as DC from './hiveDressC.js';
import * as F2 from './hiveFacility2.js';
import * as DD from './hiveDressD.js';
import * as TK from './hiveTech.js';
import * as UP1 from './hiveUp1.js';
import * as UP2 from './hiveUp2.js';
import * as UP3 from './hiveUp3.js';
import * as UP4 from './hiveUp4.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const COOL = [0.93, 0.97, 1.0];
const WARM = [1.0, 0.78, 0.5];
const RED = [1.0, 0.16, 0.1];
const AMBER = [1.0, 0.55, 0.15];
const DOWN = [0, -1, 0];
const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- the plan
export const FLOORS = [-3.2, 0, 3.45]; // nav levels 0 / 1 / 2 (nav/navgrid.js LEVEL_REF)
const C = 0.25; // grid cell (m)
const PX0 = -46, PZ0 = -42, PX1 = 46, PZ1 = 76;
const NX = Math.round((PX1 - PX0) / C), NZ = Math.round((PZ1 - PZ0) / C);
export const DEEP_ROUND = 7;
// Nadja's lab: the farm lab (world/lab.js frame) moved here whole: its gallery at the main floor, the hall 2.8 m down
const LAB_OFF = V(4.8, 3.2, 14.8);
// her counter moved off the window into the hall (farm frame): it stands free, you walk round her
const ISLAND = V(2.8, -2.8, 4.8);
// the insides the plan leaves alone (world/lab.js and buildBasement build them): the lab, the farm's basement
const EXT = [
  [-7.1, 18.95, 7.1, 33.8],
  [-6.9, 10.8, 7.05, 18.65],
];

// The spaces: their open box (level: the floor it stands on, f: another floor height; h: its height over that floor).
// zone: who may come in when ('hub' the fireteam's, 'safe' Nadja's lab, 'start' from round 1, 'north' round 4, 'deep'
// round 7, 'ring' round 10); sector: the side the horde comes from; style: the look ('white', 'dark', 'hall',
// 'flooded'); deck: a floor laid into a taller space below (a catwalk, the atrium's gallery); sealed: behind glass.
const S = (id, level, x0, z0, x1, z1, h, kind, zone, o = {}) => ({ id, level, x0, z0, x1, z1, h, kind, zone, ...o });
const SPACES = [
  S('hub', 1, -10, -10, 10, 10, 7, 'hub', 'hub', { sector: 'hub', name: 'the atrium' }),
  S('galN', 2, -10, -10, 10, -7, 3.55, 'gallery', 'hub', { deck: true, name: 'the gallery' }),
  S('galS', 2, -10, 7, 10, 10, 3.55, 'gallery', 'hub', { deck: true, name: 'the gallery' }),
  S('galW', 2, -10, -7, -7, 7, 3.55, 'gallery', 'hub', { deck: true, name: 'the gallery' }),
  S('galE', 2, 7, -7, 10, 7, 3.55, 'gallery', 'hub', { deck: true, name: 'the gallery' }),
  // west: the labs
  S('w1', 1, -40, -2, -10.5, 2, 3.2, 'corridor', 'start', { sector: 'west', stripe: 'red', name: 'the west corridor' }),
  S('labA', 1, -34, -12, -25, -2.5, 3.2, 'lab', 'start', { sector: 'west', name: 'lab 4-A' }),
  S('labB', 1, -24.5, -12, -15, -2.5, 3.2, 'lab', 'start', { sector: 'west', name: 'lab 4-B' }),
  S('decon', 1, -14.5, -8, -10.5, -2.5, 3.2, 'decon', 'start', { sector: 'west', name: 'decon' }),
  S('cryo', 1, -34, 2.5, -22.5, 13, 3.2, 'cryo', 'start', { sector: 'west', name: 'cryo storage' }),
  S('stores', 1, -22, 2.5, -15, 11, 3.2, 'stores', 'start', { sector: 'west', name: 'the stores' }),
  // east: the offices
  S('e1', 1, 10.5, -2, 40, 2, 3.2, 'corridor', 'start', { sector: 'east', stripe: 'blue', name: 'the east corridor' }),
  S('office1', 1, 12, -10, 20, -2.5, 3.0, 'office', 'start', { sector: 'east', name: 'the offices' }),
  S('office2', 1, 20.5, -10, 28.5, -2.5, 3.0, 'office', 'start', { sector: 'east', name: 'the offices' }),
  S('conf', 1, 29, -12, 40, -2.5, 3.2, 'conf', 'start', { sector: 'east', name: 'the conference room' }),
  S('cafe', 1, 12, 2.5, 30, 18, 5.0, 'cafe', 'start', { sector: 'east', name: 'the cafeteria' }),
  S('lockers', 1, 30.5, 2.5, 35, 10, 3.0, 'lockers', 'start', { sector: 'east', name: 'the lockers' }),
  // level 5, up the gallery: labs, the monitoring room, the biobank, records, offices, the elevator hall
  S('uw', 2, -40, -2, -10.5, 2, 3.2, 'corridor', 'start', { sector: 'upper', stripe: 'green', name: 'the upper west corridor' }),
  S('ulabC', 2, -34, -12, -25, -2.5, 3.2, 'ulab', 'start', { sector: 'upper', name: 'lab 5-C' }),
  S('ulabD', 2, -24.5, -12, -15, -2.5, 3.2, 'ulab', 'start', { sector: 'upper', name: 'lab 5-D' }),
  S('umon', 2, -14.5, -8, -10.5, -2.5, 3.2, 'monitor', 'start', { sector: 'upper', name: 'the monitoring room' }),
  S('uws', 2, -31.5, 2, -28.5, 17.5, 3.2, 'corridor', 'start', { sector: 'upper', stripe: 'green', name: 'the elevator hall' }),
  S('ubio', 2, -28, 2.5, -22.5, 13, 3.2, 'biobank', 'start', { sector: 'upper', name: 'the biobank' }),
  S('urec', 2, -22, 2.5, -15, 11, 3.2, 'records', 'start', { sector: 'upper', name: 'the records office' }),
  S('ue', 2, 10.5, -2, 40, 2, 3.2, 'corridor', 'start', { sector: 'upper', stripe: 'green', name: 'the upper east corridor' }),
  S('uoff', 2, 12, -10, 20, -2.5, 3.2, 'office', 'start', { sector: 'upper', name: 'the directors’ offices' }),
  S('uvir', 2, 20.5, -10, 28.5, -2.5, 3.2, 'ulab', 'start', { sector: 'upper', name: 'virology 5-E' }),
  S('uarch', 2, 29, -12, 40, -2.5, 3.2, 'records', 'start', { sector: 'upper', name: 'the upper archive' }),
  // the crashed elevator's shaft, from sublevel 5 up to level 5
  S('shaft', 0, -35, 14, -32, 17, 9.85, 'shaft', 'start', { style: 'hall', noSpawn: true, name: 'the elevator shaft' }),
  // north: round 4
  S('n1', 1, -2, -36, 2, -10.5, 3.2, 'corridor', 'north', { sector: 'north', stripe: 'yellow', name: 'the north corridor' }),
  S('specimen', 1, -18, -31, -2.5, -14, 6, 'specimen', 'north', { sector: 'north', name: 'the specimen hall' }),
  S('server', 1, 2.5, -30, 16, -15, 3.2, 'server', 'north', { sector: 'north', name: 'the server room' }),
  S('un', 2, -2, -36, 2, -10.5, 3.2, 'corridor', 'north', { sector: 'upper', stripe: 'yellow', name: 'the upper north corridor' }),
  S('uward', 2, 2.5, -30, 16, -15, 3.2, 'ward', 'north', { sector: 'upper', name: 'the isolation ward' }),
  // the ring: round 10
  S('w2', 1, -44, -40, -40.5, 2, 3.2, 'corridor', 'ring', { sector: 'ring', stripe: 'yellow', name: 'the outer ring' }),
  S('e2', 1, 40.5, -40, 44, 2, 3.2, 'corridor', 'ring', { sector: 'ring', stripe: 'yellow', name: 'the outer ring' }),
  S('n2', 1, -44, -40, 44, -36.5, 3.2, 'corridor', 'ring', { sector: 'ring', stripe: 'yellow', name: 'the outer ring' }),
  S('security', 1, -34, -36, -24, -29, 3.2, 'security', 'ring', { sector: 'ring', name: 'security' }),
  S('maint', 1, 20, -36, 34, -26, 4.0, 'maint', 'ring', { sector: 'ring', name: 'maintenance' }),
  S('morgue', 1, -40, -30, -34.5, -12.5, 3.2, 'morgue', 'ring', { sector: 'ring', name: 'the morgue' }),
  S('archive', 1, 34.5, -30, 40, -12.5, 3.2, 'archive', 'ring', { sector: 'ring', name: 'the archive' }),
  // behind the labs and the offices: sequencing, the infirmary, the isolation ward, the containment cells (round 4, from the
  // specimen hall), the director's office, the sleeping quarters and operations (round 4, from the server room)
  S('genomics', 1, -34, -20.5, -26.5, -12.5, 3.4, 'genomics', 'start', { sector: 'west', name: 'the sequencing lab' }),
  S('holding', 1, -34, -28.5, -26.5, -21, 4.0, 'holding', 'north', { sector: 'north', name: 'the containment cells' }),
  S('infirmary', 1, -26, -21, -18.5, -12.5, 3.2, 'infirmary', 'start', { sector: 'west', name: 'the infirmary' }),
  S('isolation', 1, -26, -28.5, -18.5, -21.5, 3.0, 'isolation', 'start', { sector: 'west', name: 'the isolation wing' }),
  S('director', 1, 25.5, -22.5, 34, -12.5, 3.0, 'director', 'start', { sector: 'east', name: 'the director’s office' }),
  S('quarters', 1, 16.5, -14.5, 25, -10.5, 2.8, 'quarters', 'start', { sector: 'east', name: 'the sleeping quarters' }),
  S('ops', 1, 16.5, -25.5, 25, -15, 3.4, 'ops', 'north', { sector: 'north', name: 'operations' }),
  // Nadja's lab (the safe zone): the corridor from the atrium to its gallery, the armory past its far door
  S('labc', 1, 7.5, 10.5, 10, 21, 3.0, 'labCorridor', 'safe', { name: 'the lab corridor' }),
  S('armory', 0, -13.5, 28, -7.75, 35, 3.4, 'armory', 'safe', { f: -2.8, name: 'the armory' }),
  // sublevel 5: round 7
  S('stairW', 0, -38.5, 2.5, -35.5, 9.25, 6.6, 'stair', 'deep', { sector: 'deep' }),
  S('dW', 0, -38.5, 9.25, -35.5, 40, 3.0, 'deepcorr', 'deep', { sector: 'deep', name: 'the west shaft' }),
  S('stairE', 0, 35.5, 2.5, 38.5, 9.25, 6.6, 'stair', 'deep', { sector: 'deep' }),
  S('dE', 0, 35.5, 9.25, 38.5, 40, 3.0, 'deepcorr', 'deep', { sector: 'deep', name: 'the east shaft' }),
  S('fc', 0, -38.5, 40, 38.5, 44, 3.0, 'fcorr', 'deep', { sector: 'deep', name: 'the flooded wing' }),
  S('ps', 0, -3, 44.5, 3, 49.5, 3.0, 'deepcorr', 'deep', { sector: 'deep', name: 'the flooded wing' }),
  S('hall', 0, -16, 50, 16, 72, 12, 'bighall', 'deep', { sector: 'deep', style: 'hall', name: 'the pump hall' }),
  S('cwN', 1, -16, 50, 16, 52.5, 8.8, 'catwalk', 'deep', { deck: true, style: 'hall' }),
  S('cwS', 1, -16, 69.5, 16, 72, 8.8, 'catwalk', 'deep', { deck: true, style: 'hall' }),
  S('cwB', 1, -1.5, 52.5, 1.5, 69.5, 8.8, 'catwalk', 'deep', { deck: true, style: 'hall' }),
  // the flooded labs off the flooded wing: sealed, their windows on the corridor
  ...[[-34, -26], [-25.5, -17.5], [-17, -9], [-8.5, -0.5], [0, 8], [8.5, 16.5], [17, 25], [25.5, 33.5]].map(([x0, x1], i) => S('fN' + i, 0, x0, 36.5, x1, 39.5, 3.0, 'flooded', 'deep', { sealed: true, style: 'flooded', face: 's' })),
  ...[[-34, -26], [-25.5, -17.5], [-17, -9], [-8.5, -3.5], [3.5, 8.5], [9, 17], [17.5, 25.5], [26, 34]].map(([x0, x1], i) => S('fS' + i, 0, x0, 44.5, x1, 48.5, 3.0, 'flooded', 'deep', { sealed: true, style: 'flooded', face: 'n' })),
];
const SPACE = Object.fromEntries(SPACES.map((s) => [s.id, s]));
/** a space's (or a door's) floor height */
const floorOf = (s) => s.f ?? FLOORS[s.level];

// The doors: the box across the wall gap, the opening from y0 to h over its floor. kind: 'door' (a doorway with a
// frame), 'arch' (a wide way), 'opening' (no frame: another build has it), 'blast' (sealed until its `unlock`), 'safe'
// (Nadja's lab: the gun shop runtime works it), 'balcony' (an opening over a sill: look and shoot down through it),
// 'elevator' (the shaft's pried doors), 'fwindow' (a flooded lab's window).
const D = (level, x0, z0, x1, z1, h, kind, o = {}) => ({ level, x0, z0, x1, z1, h, kind, y0: 0, ...o });
const DOORS = [
  // the atrium: its ways out, on the floor and off the gallery
  D(1, -10.5, -2, -10, 2, 2.8, 'arch', { sign: ['labs', 'e'] }),
  D(1, 10, -2, 10.5, 2, 2.8, 'arch', { sign: ['offices', 'w'] }),
  D(1, -2, -10.5, 2, -10, 2.8, 'blast', { unlock: 'north', sign: ['north', 's'] }),
  D(2, -10.5, -2, -10, 2, 2.6, 'arch', { sign: ['upperW', 'e'] }),
  D(2, 10, -2, 10.5, 2, 2.6, 'arch', { sign: ['upperE', 'w'] }),
  D(2, -2, -10.5, 2, -10, 2.6, 'blast', { unlock: 'north', sign: ['upperN', 's'] }),
  D(2, -10.5, -7, -10, -3.5, 2.3, 'balcony', { y0: 0.9 }), // (the monitoring room's window on the gallery)
  // Nadja's lab: the safe door, the corridor's door into the lab's gallery, the lab's far door to the armory
  D(1, 7.5, 10, 10, 10.5, 2.6, 'safe', { sign: ['secure', 'n'] }),
  D(1, 7.1, 19.15, 7.5, 20.75, 2.1, 'opening'),
  D(0, -7.75, 31.4, -7.1, 33.0, 2.48, 'opening', { f: -2.8 }),
  // west
  D(1, -31, -2.5, -28.5, -2, 2.6, 'door', { sign: ['labA', 's'] }),
  D(1, -21, -2.5, -18.5, -2, 2.6, 'door', { sign: ['labB', 's'] }),
  D(1, -13.5, -2.5, -12, -2, 2.4, 'door', { sign: ['decon', 's'] }),
  D(1, -30, 2, -27.5, 2.5, 2.6, 'door', { sign: ['cryo', 'n'] }),
  D(1, -19, 2, -17.5, 2.5, 2.4, 'door', { sign: ['stores', 'n'] }),
  D(1, -25, -9, -24.5, -7, 2.4, 'door'),
  // east
  D(1, 14, -2.5, 15.5, -2, 2.4, 'door', { sign: ['office', 's'] }),
  D(1, 23, -2.5, 24.5, -2, 2.4, 'door', { sign: ['office', 's'] }),
  D(1, 33, -2.5, 35, -2, 2.4, 'door', { sign: ['conf', 's'] }),
  D(1, 20, -8, 20.5, -6.5, 2.4, 'door'),
  D(1, 16, 2, 19.5, 2.5, 2.8, 'door', { sign: ['cafe', 'n'] }),
  D(1, 23.5, 2, 26, 2.5, 2.8, 'door'),
  D(1, 31, 2, 32.5, 2.5, 2.4, 'door', { sign: ['lockers', 'n'] }),
  // level 5
  D(2, -31, -2.5, -28.5, -2, 2.4, 'door', { sign: ['lab5c', 's'] }),
  D(2, -21, -2.5, -18.5, -2, 2.4, 'door', { sign: ['lab5d', 's'] }),
  D(2, -13.5, -2.5, -12, -2, 2.3, 'door', { sign: ['monitor', 's'] }),
  D(2, -26.5, 2, -25, 2.5, 2.4, 'door', { sign: ['biobank', 'n'] }),
  D(2, -19, 2, -17.5, 2.5, 2.4, 'door', { sign: ['records', 'n'] }),
  D(2, -25, -8.5, -24.5, -6.5, 2.3, 'door'),
  D(2, 14, -2.5, 15.5, -2, 2.4, 'door', { sign: ['office', 's'] }),
  D(2, 23, -2.5, 24.5, -2, 2.4, 'door', { sign: ['lab5e', 's'] }),
  D(2, 33, -2.5, 35, -2, 2.4, 'door', { sign: ['archive', 's'] }),
  D(2, 14, 2, 28, 2.5, 1.5, 'balcony', { y0: 0.9 }), // (the upper east corridor looks down into the cafeteria)
  D(2, 2, -24, 2.5, -21.5, 2.4, 'door', { sign: ['ward', 'e'] }),
  D(2, -2.5, -29, -2, -16, 1.6, 'balcony', { y0: 0.8, unlockView: 'north' }), // (the upper north corridor over the specimen hall)
  // the elevator: its pried doors up here, its door into sublevel 5 (with it, round 7)
  D(2, -32, 14.6, -31.5, 16.4, 2.4, 'elevator', { sign: ['elevator', 'e'] }),
  D(0, -35.5, 14.6, -35, 16.4, 2.4, 'blast', { unlock: 'deep', sign: ['elevator', 'w'] }),
  // north
  D(1, -2.5, -20, -2, -17, 3.0, 'door', { sign: ['specimen', 'e'] }),
  D(1, -2.5, -28, -2, -26, 3.0, 'door'),
  D(1, 2, -19, 2.5, -17, 2.6, 'door', { sign: ['server', 'w'] }),
  // the ring
  D(1, -40.5, -2, -40, 2, 2.8, 'blast', { unlock: 'ring', sign: ['ring', 'e'] }),
  D(1, 40, -2, 40.5, 2, 2.8, 'blast', { unlock: 'ring', sign: ['ring', 'w'] }),
  D(1, -2, -36.5, 2, -36, 2.8, 'blast', { unlock: 'ring', sign: ['ring', 's'] }),
  D(1, -30, -36.5, -28, -36, 2.4, 'door', { sign: ['security', 'n'] }),
  D(1, 25, -36.5, 28, -36, 2.8, 'door', { sign: ['maint', 'n'] }),
  D(1, -40.5, -22, -40, -20, 2.4, 'door', { sign: ['morgue', 'w'] }),
  D(1, 40, -22, 40.5, -20, 2.4, 'door', { sign: ['archive', 'e'] }),
  // the rooms behind the labs and the offices
  D(1, -31, -12.5, -28.5, -12, 2.6, 'door', { sign: ['genomics', 's'] }),
  D(1, -23.5, -12.5, -21, -12, 2.6, 'door', { sign: ['infirmary', 's'] }),
  D(1, -31, -21, -29, -20.5, 2.6, 'blast', { unlock: 'north', sign: ['holding', 's'] }),
  D(1, -26.5, -27, -26, -24.5, 2.6, 'blast', { unlock: 'north' }),
  D(1, -23.5, -21.5, -21, -21, 2.6, 'door', { sign: ['isolation', 's'] }),
  D(1, -18.5, -26, -18, -23.5, 2.6, 'blast', { unlock: 'north' }),
  D(1, 16, -22, 16.5, -19.5, 2.6, 'door', { sign: ['ops', 'w'] }),
  D(1, 17, -10.5, 19, -10, 2.4, 'door', { sign: ['quarters', 's'] }),
  D(1, 22, -10.5, 24, -10, 2.4, 'door'),
  D(1, 18, -15, 20.5, -14.5, 2.6, 'blast', { unlock: 'north' }),
  D(1, 31, -12.5, 33, -12, 2.6, 'door', { sign: ['director', 's'] }),
  D(1, 25, -20, 25.5, -18, 2.6, 'blast', { unlock: 'north' }),
  // the stairs down to sublevel 5 (round 7), off both wings
  D(1, -38.5, 2, -35.5, 2.5, 2.8, 'blast', { unlock: 'deep', sign: ['deep', 'n'] }),
  D(1, 35.5, 2, 38.5, 2.5, 2.8, 'blast', { unlock: 'deep', sign: ['deep', 'n'] }),
  // sublevel 5
  D(0, -3, 44, 3, 44.5, 2.5, 'arch', { sign: ['pump', 'n'] }),
  D(0, -1.75, 49.5, 1.75, 50, 2.5, 'door'),
  ...SPACES.filter((s) => s.kind === 'flooded').map((s) => (s.face === 's' ? D(0, s.x0 + 1, 39.5, s.x1 - 1, 40, 2.55, 'fwindow', { y0: 0.4 }) : D(0, s.x0 + 1, 44, s.x1 - 1, 44.5, 2.55, 'fwindow', { y0: 0.4 }))),
];

// The stair flights: x0..x1 × z0..z1, climbing along `along` from the `low` end (lo level → hi level); a / b: the nav
// portal's foot and top, `always`: open from round 1, else opened by its unlock.
const STAIRS = [
  { id: 'galW', x0: -6.9, x1: -5.5, z0: 1, z1: 7, along: 'z', low: 'z0', lo: 1, hi: 2, n: 17, always: true, a: [-6.2, 0.4], b: [-6.2, 7.8], rail: 'x1' },
  { id: 'galE', x0: 5.5, x1: 6.9, z0: -7, z1: -1, along: 'z', low: 'z1', lo: 1, hi: 2, n: 17, always: true, a: [6.2, -0.4], b: [6.2, -7.8], rail: 'x0' },
  { id: 'deepW', x0: -38.5, x1: -35.5, z0: 2.5, z1: 8.9, along: 'z', low: 'z1', lo: 0, hi: 1, n: 16, a: [-37, 9.7], b: [-37, 1.2] },
  { id: 'deepE', x0: 35.5, x1: 38.5, z0: 2.5, z1: 8.9, along: 'z', low: 'z1', lo: 0, hi: 1, n: 16, a: [37, 9.7], b: [37, 1.2] },
  { id: 'hallW', x0: -15.9, x1: -14.4, z0: 52.5, z1: 58.9, along: 'z', low: 'z1', lo: 0, hi: 1, n: 16, always: true, a: [-15.15, 59.7], b: [-15.15, 51.6], rail: 'x1' },
  { id: 'hallE', x0: 14.4, x1: 15.9, z0: 52.5, z1: 58.9, along: 'z', low: 'z1', lo: 0, hi: 1, n: 16, always: true, a: [15.15, 59.7], b: [15.15, 51.6], rail: 'x0' },
];
const stairTop = (s) => (s.low === 'z0' ? [s.x0, s.z1] : s.low === 'z1' ? [s.x0, s.z0] : s.low === 'x0' ? [s.x1, s.z0] : [s.x0, s.z0]);

// Where the gallery's railing is torn away: the infected jump down into the atrium (one-way nav portals, a → b), so
// what comes from level 5 doesn't have to go round by the stairs. gap: the stretch of edge without its railing.
const DROPS = [
  { id: 'dropN', gap: [-4.6, -7, -3.0, -7], a: [-3.8, -7.9], b: [-3.8, -5.4] },
  { id: 'dropS', gap: [3.0, 7, 4.6, 7], a: [3.8, 7.9], b: [3.8, 5.4] },
  { id: 'dropW', gap: [-7, -4.6, -7, -3.0], a: [-7.9, -3.8], b: [-5.4, -3.8] },
  { id: 'dropE', gap: [7, 3.0, 7, 4.6], a: [7.9, 3.8], b: [5.4, 3.8] },
];

// the crashed elevator's maintenance ladder (actors/ladders.js): up the shaft's east wall, off at the top into the
// elevator hall through the pried doors
const SHAFT_LADDER = { id: 'shaftLadder', x: -32.06, z: 15.5, nx: -1, nz: 0, width: 0.56, yBottom: FLOORS[0], yTop: FLOORS[2], stand: 0.4 };

// the safe zone: Nadja's lab, its basement, the corridor, the armory (navBlocked: nobody paths in)
const SAFE = { x0: -13.8, z0: 10.2, x1: 10.2, z1: 35.3 };
const inSafe = (p) => p.x > SAFE.x0 && p.x < SAFE.x1 && p.z > SAFE.z0 && p.z < SAFE.z1;
// the armory past the lab's far door: the clerk behind her counter, facing +x (actors/shopkeeper.js)
const ARMORY_F = -2.8;
const KEEPER = V(-12.9, ARMORY_F, 31.5);
const COUNTER = { x0: -12.65, x1: -11.9, z0: 29.5, z1: 33.5, top: ARMORY_F + 1.005 };
// the sample hatch by the safe door (Nadja's requests go in there)
const HATCH = V(5.8, 0, 9.96);

// vents the infected sometimes burst out of (spawnAt): on a wall at floor level, `face` into the room
const VENTS = [
  [1, -32.5, -2, 's', 'start'], [1, -23, 2, 'n', 'start'], [1, -16.3, -2, 's', 'start'], [1, 16.8, -2, 's', 'start'], [1, 27.5, 2, 'n', 'start'],
  [1, 37, -2, 's', 'start'], [1, -34, -6.5, 'e', 'start'], [1, -34, 8, 'e', 'start'], [1, -15, 7, 'w', 'start'], [1, 28.5, -8.5, 'w', 'start'],
  [1, 30, 12, 'w', 'start'], [1, 12, 15, 'e', 'start'], [1, 35, 6, 'w', 'start'],
  [2, -28, -2, 's', 'start'], [2, -19.8, 2, 'n', 'start'], [2, -34, -7, 'e', 'start'], [2, -15, -6, 'w', 'start'], [2, -22.5, 8, 'w', 'start'],
  [2, 20, 2, 'n', 'start'], [2, 37, -2, 's', 'start'], [2, 20, -5, 'w', 'start'], [2, -28.5, 10, 'e', 'start'],
  [1, -2, -33, 'e', 'north'], [1, 2, -22.5, 'w', 'north'], [1, -18, -22, 'e', 'north'], [1, 16, -24, 'w', 'north'], [2, 2.5, -27, 'e', 'north'],
  [1, -44, -20, 'e', 'ring'], [1, 44, -10, 'w', 'ring'], [1, -10, -40, 's', 'ring'], [1, 20, -40, 's', 'ring'],
  [0, -38.5, 22, 'e', 'deep'], [0, 38.5, 18, 'w', 'deep'], [0, -16, 62, 'e', 'deep'], [0, 16, 60, 'w', 'deep'], [0, 6, 72, 'n', 'deep'],
].map(([level, x, z, face, zone]) => ({ level, x, z, face, zone }));
const VENT_TYPES = new Set(['mauler', 'worker', 'biter', 'dog', 'striker']);

// Nadja's requests: what she sends you for (the case you carry looks the same; the name and her line differ)
const REQUESTS = [
  { name: 'A SAMPLE CASE', thanks: 'That’s the right strain. Good.' },
  { name: 'A DATA DRIVE', thanks: 'The sequence data. Now I can work.' },
  { name: 'A REAGENT CANISTER', thanks: 'Enough reagent for a week. Thank you.' },
  { name: 'A CENTRIFUGE ROTOR', thanks: 'Mine cracked yesterday. Perfect.' },
  { name: 'A CULTURE TRAY', thanks: 'Still alive. Careful with it.' },
  { name: 'THE ANTIVIRAL VIALS', thanks: 'You might need these one day.' },
];
// the rooms her things lie about in (not the corridors, the atrium or her lab)
const REQUEST_KINDS = new Set(['genomics', 'infirmary', 'director', 'ops', 'lab', 'ulab', 'cryo', 'stores', 'office', 'conf', 'cafe', 'lockers', 'specimen', 'server', 'security', 'maint', 'morgue', 'archive', 'monitor', 'biobank', 'records', 'ward', 'decon', 'bighall']);

// ---------------------------------------------------------------- the columns
function makePlan() {
  const N = NX * NZ;
  const ix = (x) => Math.round((x - PX0) / C), iz = (z) => Math.round((z - PZ0) / C);
  const each = (r, fn) => {
    const i0 = ix(r.x0), i1 = ix(r.x1), j0 = iz(r.z0), j1 = iz(r.z1);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) fn(j * NX + i);
  };
  // raw open intervals: a space's (owner = its index) or a door's (owner = -2 - its index)
  const RAW = 6;
  const rc = new Uint8Array(N), ry0 = new Float32Array(N * RAW), ry1 = new Float32Array(N * RAW), ro = new Int16Array(N * RAW);
  const addRaw = (c, y0, y1, o) => {
    if (rc[c] >= RAW) return;
    const k = c * RAW + rc[c]++;
    ry0[k] = y0;
    ry1[k] = y1;
    ro[k] = o;
  };
  SPACES.forEach((s, k) => {
    const f = floorOf(s);
    each(s, (c) => addRaw(c, f, f + s.h, k));
  });
  DOORS.forEach((d, k) => {
    const f = floorOf(d);
    each(d, (c) => addRaw(c, f + d.y0, f + d.h, -2 - k));
  });
  const deck = new Float32Array(N).fill(NaN);
  const deckOwner = new Int16Array(N).fill(-1);
  SPACES.forEach((s, k) => {
    if (s.deck) each(s, (c) => ((deck[c] = floorOf(s)), (deckOwner[c] = k)));
  });
  // the insides other builds own (the lab, the basement): solid here, but no faces or colliders from them
  const ext = new Uint8Array(N);
  for (const [x0, z0, x1, z1] of EXT) {
    for (let j = 0; j < NZ; j++) {
      const z = PZ0 + (j + 0.5) * C;
      if (z < z0 || z > z1) continue;
      for (let i = 0; i < NX; i++) {
        const x = PX0 + (i + 0.5) * C;
        if (x >= x0 && x <= x1) ext[j * NX + i] = 1;
      }
    }
  }
  // merged open segments (sorted): a..b, the owners of its floor (fo) and its ceiling (co); fl: 1 its floor is a deck,
  // 2 its ceiling is a deck's underside
  const SEG = 5;
  const sc = new Uint8Array(N), sa = new Float32Array(N * SEG), sb = new Float32Array(N * SEG);
  const sfo = new Int16Array(N * SEG), sco = new Int16Array(N * SEG), sfl = new Uint8Array(N * SEG);
  const idx = [];
  for (let c = 0; c < N; c++) {
    const n = rc[c];
    if (!n) continue;
    idx.length = 0;
    for (let k = 0; k < n; k++) idx.push(c * RAW + k);
    idx.sort((p, q) => ry0[p] - ry0[q]);
    const segs = [];
    for (const k of idx) {
      const a = ry0[k], b = ry1[k], o = ro[k];
      const last = segs[segs.length - 1];
      if (last && a <= last.b + 0.01) {
        if (b > last.b + 0.001) {
          last.b = b;
          last.co = o;
        }
      } else segs.push({ a, b, fo: o, co: o, fl: 0 });
    }
    const d = deck[c];
    if (!Number.isNaN(d)) {
      for (let k = 0; k < segs.length; k++) {
        const g = segs[k];
        if (d - 0.2 > g.a + 0.05 && d < g.b - 0.05) {
          segs.splice(k + 1, 0, { a: d, b: g.b, fo: deckOwner[c], co: g.co, fl: 1 });
          g.b = d - 0.2;
          g.co = g.fo;
          g.fl |= 2;
          break;
        }
      }
    }
    sc[c] = Math.min(SEG, segs.length);
    for (let k = 0; k < sc[c]; k++) {
      const g = segs[k], q = c * SEG + k;
      sa[q] = g.a;
      sb[q] = g.b;
      sfo[q] = g.fo;
      sco[q] = g.co;
      sfl[q] = g.fl;
    }
  }
  const at = (x, z) => {
    const i = Math.floor((x - PX0) / C), j = Math.floor((z - PZ0) / C);
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return -1;
    return j * NX + i;
  };
  const openAt = (c, y) => {
    if (c < 0) return false;
    for (let k = 0; k < sc[c]; k++) {
      const q = c * SEG + k;
      if (y > sa[q] && y < sb[q]) return true;
    }
    return false;
  };
  /** the open segment of cell c containing y: [a, b] or null */
  const segAt = (c, y) => {
    if (c < 0) return null;
    for (let k = 0; k < sc[c]; k++) {
      const q = c * SEG + k;
      if (y > sa[q] && y < sb[q]) return [sa[q], sb[q]];
    }
    return null;
  };
  /** whose is the space at height y in cell c: the raw interval there with the highest floor */
  const ownerAt = (c, y) => {
    let best = -9999, by = -Infinity;
    for (let k = 0; k < rc[c]; k++) {
      const q = c * RAW + k;
      if (y >= ry0[q] - 1e-3 && y <= ry1[q] + 1e-3 && ry0[q] > by) {
        by = ry0[q];
        best = ro[q];
      }
    }
    return best;
  };
  /** can light (or a look) get from a to b through the open columns? */
  const clear3 = (ax, ay, az, bx, by, bz) => {
    const d = Math.hypot(bx - ax, by - ay, bz - az);
    const n = Math.max(1, Math.ceil(d / 0.2));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (!openAt(at(ax + (bx - ax) * t, az + (bz - az) * t), ay + (by - ay) * t)) return false;
    }
    return true;
  };
  return { N, sc, sa, sb, sfo, sco, sfl, SEG, rc, deck, ext, at, openAt, segAt, ownerAt, clear3, ix, iz, each };
}

/** greedy rectangles over the cells where key(c) is truthy and equal: [i0, j0, i1, j1 (exclusive), key] */
function rects(key) {
  const used = new Uint8Array(NX * NZ);
  const out = [];
  for (let j = 0; j < NZ; j++) {
    for (let i = 0; i < NX; i++) {
      const c = j * NX + i;
      const k = key(c);
      if (!k || used[c]) continue;
      let i1 = i + 1;
      while (i1 < NX && !used[j * NX + i1] && key(j * NX + i1) === k) i1++;
      let j1 = j + 1;
      grow: while (j1 < NZ) {
        for (let a = i; a < i1; a++) if (used[j1 * NX + a] || key(j1 * NX + a) !== k) break grow;
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
  ['upperW', '◄  LABS 5-C · 5-D  ·  BIOBANK', 512, '#3fbf6a'],
  ['upperE', 'OFFICES  ·  VIROLOGY 5-E  ►', 512, '#3fbf6a'],
  ['upperN', '▲  ISOLATION WARD', 512, '#d6a31a'],
  ['deep', '▼  SUBLEVEL 5  ·  PUMP STATION', 512, '#d6a31a', 'hazard'],
  ['flooded', 'FLOODED  ·  SEALED  ·  DO NOT OPEN', 512, '#3aa6d6'],
  ['elevator', 'ELEVATOR  ·  OUT OF ORDER', 512, '#c63a2e', 'hazard'],
  ['hatch', 'SAMPLE HATCH  ·  LAB DELIVERIES', 512, '#3fbf6a'],
  ['level5', 'LEVEL 5  ·  RESEARCH', 512, '#8a949c'],
  ['labA', 'LAB 4-A', 256, '#c63a2e'],
  ['labB', 'LAB 4-B', 256, '#c63a2e'],
  ['lab5c', 'LAB 5-C', 256, '#3fbf6a'],
  ['lab5d', 'LAB 5-D', 256, '#3fbf6a'],
  ['lab5e', 'VIROLOGY 5-E', 256, '#3fbf6a'],
  ['monitor', 'MONITORING', 256, '#3aa6d6'],
  ['biobank', 'BIOBANK', 256, '#3aa6d6'],
  ['records', 'RECORDS', 256, '#8a949c'],
  ['ward', 'ISOLATION', 256, '#d6a31a'],
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
  ['isolation', 'ISOLATION WING', 256, '#d6a31a'],
  ['director', 'DIRECTOR', 256, '#2f7ad0'],
  ['quarters', 'QUARTERS', 256, '#2f7ad0'],
  ['ops', 'OPERATIONS', 256, '#3aa6d6'],
  ['armory', 'ARMORY', 256, '#c63a2e'],
  ['ring', 'OUTER RING', 256, '#d6a31a', 'hazard'],
  ['pump', 'PUMP HALL', 256, '#d6a31a'],
  ['sub5', 'SUBLEVEL 5', 256, '#8a949c'],
  ['danger', 'DANGER · DROP', 256, '#d6a31a', 'hazard'],
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

/** steel grating (the catwalks, the gallery, the stairs) */
function grateTex() {
  return texOf(
    canvas(128, 128, (g) => {
      g.fillStyle = '#15181b';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#555c63';
      g.lineWidth = 5;
      for (let i = -128; i <= 256; i += 16) {
        g.beginPath();
        g.moveTo(i, 0);
        g.lineTo(i + 128, 128);
        g.stroke();
        g.beginPath();
        g.moveTo(i + 128, 0);
        g.lineTo(i, 128);
        g.stroke();
      }
      g.strokeStyle = '#7c848c';
      g.lineWidth = 1.5;
      for (let i = -128; i <= 256; i += 16) {
        g.beginPath();
        g.moveTo(i + 1, 0);
        g.lineTo(i + 129, 128);
        g.stroke();
      }
    }),
    true,
  );
}

/** cast concrete (the pump hall, the shaft): form-panel seams, tie holes, stains */
function concreteTex() {
  const r = mulberry(77);
  return texOf(
    canvas(512, 512, (g) => {
      g.fillStyle = '#80837f';
      g.fillRect(0, 0, 512, 512);
      speckle(g, 512, 512, r, 9000, ['#737671', '#8c8f8a', '#6a6d69', '#949791'], 2);
      for (let i = 0; i < 14; i++) {
        const x = r() * 512, y = r() * 512, w = 30 + r() * 120;
        const gr = g.createRadialGradient(x, y, 0, x, y, w);
        gr.addColorStop(0, 'rgba(40,36,30,0.28)');
        gr.addColorStop(1, 'rgba(40,36,30,0)');
        g.fillStyle = gr;
        g.fillRect(x - w, y - w, w * 2, w * 2);
      }
      g.fillStyle = 'rgba(30,30,28,0.55)';
      g.fillRect(0, 0, 512, 3);
      g.fillRect(0, 0, 3, 512);
      for (const [x, y] of [[128, 128], [384, 128], [128, 384], [384, 384]]) {
        g.beginPath();
        g.arc(x, y, 7, 0, Math.PI * 2);
        g.fill();
      }
    }),
    true,
  );
}

// ---------------------------------------------------------------- the build
export function buildHive() {
  const world = new CollisionWorld(-50, -46, 50, 80, 2);
  const group = new THREE.Group();
  group.name = 'hive';
  const dyn = new THREE.Group(); // moving things: doors, vents
  dyn.name = 'hiveDynamic';
  group.add(dyn);
  const lamps = [];
  const rnd = mulberry(4404);
  const K = new Kit();
  const plan = makePlan();
  const { N, sc, sa, sb, sfo, sco, sfl, SEG, deck, ext, openAt, segAt, ownerAt } = plan;
  const X = (i) => PX0 + i * C, Z = (j) => PZ0 + j * C;

  // ------------------------------------------------ materials
  const sg = signAtlas();
  const labSignTex = texOf(signCanvas()); // (the farm lab's label atlas, for props' labels)
  const screenTex = texOf(screenCanvas());
  const pTex = panelTex(), fTex = floorTex(), cTex = ceilTex(), gTex = grateTex(), kTex = concreteTex();
  const M = {
    wall: bakeMat({ map: pTex, roughness: 0.6 }, true),
    floor: bakeMat({ map: fTex, roughness: 0.34, envMapIntensity: 0.8 }),
    ceil: bakeMat({ map: cTex, roughness: 0.9 }, true),
    wallDark: bakeMat({ map: pTex, color: 0x7b8187, roughness: 0.7 }, true),
    floorDark: bakeMat({ map: fTex, color: 0x656a6f, roughness: 0.4, envMapIntensity: 0.9 }),
    ceilDark: bakeMat({ map: cTex, color: 0x555a5f, roughness: 0.9 }, true),
    wallOld: bakeMat({ map: pTex, color: 0xcfcab8, roughness: 0.65 }, true),
    concrete: bakeMat({ map: kTex, roughness: 0.92 }, true),
    wallTeal: bakeMat({ map: pTex, color: 0x9cc3bd, roughness: 0.55 }, true),
    grate: bakeMat({ map: gTex, color: 0xb9c0c6, metalness: 0.6, roughness: 0.45 }, true),
    grateUnder: bakeMat({ map: gTex, color: 0x6c7278, metalness: 0.5, roughness: 0.55 }, true),
    stairs: bakeMat({ map: gTex, color: 0xa0a8ae, metalness: 0.6, roughness: 0.45 }, true),
    steel: bakeMat({ color: 0xa9b0b6, metalness: 0.75, roughness: 0.3 }),
    steelDark: bakeMat({ color: 0x5c6369, metalness: 0.7, roughness: 0.4 }, true),
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
    rust: bakeMat({ color: 0x6e4a32, metalness: 0.35, roughness: 0.8 }),
    puddle: bakeMat({ color: 0x14181b, metalness: 0.2, roughness: 0.04, envMapIntensity: 2.2 }),
  };
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
    drowned: new THREE.MeshStandardMaterial({ color: 0x3e4a44, roughness: 0.7, emissive: 0x0b2426, emissiveIntensity: 1 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2c6f6a, emissive: 0x0f3f3c, emissiveIntensity: 1, transparent: true, opacity: 0.55, depthWrite: false, roughness: 0.15, side: THREE.DoubleSide }),
    waterTop: new THREE.MeshStandardMaterial({ color: 0x3f8f88, emissive: 0x1a5a55, emissiveIntensity: 1, transparent: true, opacity: 0.7, depthWrite: false, roughness: 0.05, side: THREE.DoubleSide }),
    paperWet: new THREE.MeshStandardMaterial({ color: 0x9fb8b4, emissive: 0x16332f, emissiveIntensity: 1, roughness: 0.8, side: THREE.DoubleSide }),
    ledG: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3.2, 0.6) }),
    ledA: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.2) }),
    ledB: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 3.4) }),
    ledR: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 0.25, 0.2) }),
    vend: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 1.2) }),
    neon: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.5, 0.35) }),
    emAmber: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.4, 0.3) }),
    sickGreen: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 2.6, 0.9) }),
  };
  const liquids = [U.blue, U.green, U.amber, U.magenta, U.cyan];
  // The surfaces: painted / tiled / carpeted per kind of room (hiveTex.js), decals, text labels, soft shadows.
  const SH = shellMaterials();
  const F = shellFittings(); // (door leaves, ducts, plastic, rubber, brass)
  const labels = new LabelAtlas();
  if (/[?&]dbg\b/.test(location.search)) window.__labels = labels;
  M.decal = hiveMat({ map: decalAtlas(), transparent: true, depthWrite: false, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  M.label = hiveMat({ map: labels.texture, roughness: 0.55 });
  M.aoStrip = new THREE.MeshBasicMaterial({ map: stripTexture(), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  M.aoStrip.map.wrapS = THREE.RepeatWrapping;
  M.tankFloor = bakeMat({ map: tankFloorTexture(), roughness: 0.45, metalness: 0.25, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // three circuits of guttering ceiling tubes: their emissive stutters (the baked light stays)
  U.flick = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(4.4, 4.6, 5.0) }));
  // finishes per kind of room: the wall paint, the wainscot (and its height), the floor, the ceiling
  const FIN_RING = { paint: 'concrete', wain: 'steelDark', wh: 1.2, floor: 'concreteDark', ceil: 'concreteDark' };
  const FIN_DEEP = { paint: 'concrete', wain: 'steelDark', wh: 1.2, floor: 'concreteDark', ceil: 'concreteDark' };
  const FIN_FLOODED = { paint: 'green', wain: 'tileGreen', wh: 2.1, floor: 'vinylGreen', ceil: 'concreteDark' };
  const FIN_HALL = { paint: 'concrete', wain: 'steelDark', wh: 1.6, floor: 'concreteDark', ceil: 'concreteDark' };
  const FIN = {
    hub: { paint: 'concrete', wain: 'steel', wh: 1.2, floor: 'terrazzo', ceil: 'concrete' },
    gallery: { paint: 'concrete', wain: 'steel', wh: 1.0, floor: 'epoxyDark', ceil: 'concrete' },
    corridor: { paint: 'white', wain: 'band', wh: 1.1, floor: 'epoxy', ceil: 'tile' },
    labCorridor: { paint: 'white', wain: 'steel', wh: 1.2, floor: 'epoxy', ceil: 'tile' },
    armory: { paint: 'sand', wain: 'wood', wh: 1.1, floor: 'epoxyDark', ceil: 'tile' },
    lab: { paint: 'white', wain: 'tile', wh: 1.4, floor: 'epoxy', ceil: 'tile' },
    genomics: { paint: 'white', wain: 'tileBlue', wh: 1.3, floor: 'vinyl', ceil: 'tile' },
    decon: { paint: 'green', wain: 'tileGreen', wh: 3.0, floor: 'vinylGreen', ceil: 'concrete' },
    cryo: { paint: 'blue', wain: 'steel', wh: 1.3, floor: 'epoxyDark', ceil: 'concrete' },
    stores: { paint: 'sand', wain: 'band', wh: 1.1, floor: 'concrete', ceil: 'concrete' },
    office: { paint: 'cream', wain: 'band', wh: 0.95, floor: 'carpetGrey', ceil: 'tile' },
    conf: { paint: 'grey', wain: 'wood', wh: 1.2, floor: 'carpetBlue', ceil: 'tileWarm' },
    cafe: { paint: 'yellow', wain: 'tileCream', wh: 1.3, floor: 'checker', ceil: 'tile' },
    lockers: { paint: 'grey', wain: 'band', wh: 1.1, floor: 'vinyl', ceil: 'tile' },
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
    // level 5: older, warmer
    ulab: { paint: 'sand', wain: 'tileCream', wh: 1.3, floor: 'vinyl', ceil: 'tileWarm' },
    monitor: { paint: 'dark', wain: 'steelDark', wh: 1.0, floor: 'carpetBlue', ceil: 'concreteDark' },
    biobank: { paint: 'blue', wain: 'steel', wh: 1.3, floor: 'epoxyDark', ceil: 'concrete' },
    records: { paint: 'sand', wain: 'band', wh: 1.0, floor: 'carpetGrey', ceil: 'tileWarm' },
    ward: { paint: 'cream', wain: 'tileGreen', wh: 1.3, floor: 'vinylGreen', ceil: 'tile' },
    shaft: { paint: 'concrete', wain: 'steelDark', wh: 1.0, floor: 'concreteDark', ceil: 'concreteDark' },
    stair: { paint: 'concrete', wain: 'steelDark', wh: 1.0, floor: 'concreteDark', ceil: 'concreteDark' },
  };
  const finOf = (s) => {
    if (s.style === 'flooded') return FIN_FLOODED;
    if (s.style === 'hall') return FIN_HALL;
    if (s.kind === 'corridor') {
      if (s.zone === 'ring') return FIN_RING;
      if (s.level === 2) return { paint: 'sand', wain: 'bandGreen', wh: 1.1, floor: 'vinyl', ceil: 'tileWarm' };
    }
    if (s.level === 2 && s.kind === 'office') return { paint: 'cream', wain: 'wood', wh: 1.4, floor: 'carpetBrown', ceil: 'tileWarm' };
    if (s.kind === 'deepcorr') return FIN_DEEP;
    if (s.kind === 'fcorr') return FIN_FLOODED;
    return FIN[s.kind] ?? (s.level === 0 ? FIN_DEEP : FIN.lab);
  };
  const FLOOR_MPR = { epoxy: 3, epoxyDark: 3, vinyl: 1.2, vinylGreen: 1.2, checker: 1.8, carpetBlue: 1, carpetGrey: 1, carpetBrown: 1, carpetRed: 1, concrete: 3, concreteDark: 3, terrazzo: 3, raised: 1.2, plate: 0.6, parquet: 1.2 };
  const MPR = new Map([[M.grate, 0.6], [M.grateUnder, 0.6], [M.stairs, 0.6], [M.concrete, 3.0]]);
  for (const [k, m] of Object.entries(SH.floors)) MPR.set(m, FLOOR_MPR[k] ?? 2);
  const mprOf = (m) => MPR.get(m) ?? 2.4;
  const ownerFin = (o) => (o >= 0 ? finOf(SPACES[o]) : FIN_RING);
  const isWindow = (o) => o < -1 && (DOORS[-2 - o].y0 > 0.1);
  const wallMat = (o) => SH.paints[ownerFin(o).paint];
  const floorMat = (o, deckTop) => (deckTop ? M.grate : isWindow(o) ? wallMat(o) : o < 0 ? SH.floors.plate : SH.floors[ownerFin(o).floor]);
  const ceilMat = (o, deckUnder) => (deckUnder ? M.grateUnder : o < -1 ? wallMat(o) : SH.ceils[ownerFin(o).ceil]);

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
    X: {}, // the furniture modules' extra materials (their EXTRA_MATS / EXTRA_GLOW)
    G: {},
    dyn,
    updates,
    col: (x0, y0, z0, x1, y1, z1, surf = SURF.metal, flags = 0, tag = null) => world.add(x0, y0, z0, x1, y1, z1, surf, flags, tag),
    light: (x, y, z, i, r, rgb = COOL, dir = null, range = null) => lights.push({ x, y, z, i, r, c: rgb, dir, range: range ?? r * 3.4 }),
    // (level: the floor it lights, for the slot choice: lighting.js prefers the camera's floor)
    lamp: (o) => lamps.push({ level: 1, color: 0xdde6ff, intensity: 26, angle: 1.15, distance: 11, flicker: 0, spot: true, fx: false, ...o }),
    screen: (x, y, z, yaw, w, h, on) => {
      const keys = Object.keys(SCREEN);
      if (on) K.plane(U.screen, w, h, x, y, z, [0, yaw, 0], SCREEN[keys[Math.floor(rnd() * keys.length)]], 1024, 512);
      else K.plane(M.black, w, h, x, y, z, [0, yaw, 0]);
    },
  };
  // decals (blood, grime, paper …), text labels and soft shadow strips: flat planes the props drop anywhere; dy: the floor
  const NORM = { s: [0, 1], n: [0, -1], e: [1, 0], w: [-1, 0] };
  const uvRect = (g, [u0, v0, u1, v1]) => {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + (u1 - u0) * uv.getX(i), v0 + (v1 - v0) * uv.getY(i));
    return g;
  };
  let decalN = 0;
  const mkDeco = (dy) => ({
    decal: (kind, x, z, size, rot = 0, o = {}) => {
      const g = uvRect(new THREE.PlaneGeometry(size, size * (o.aspect ?? 1)), decalUV(kind));
      g.rotateX(-Math.PI / 2);
      g.rotateY(rot);
      g.translate(x, dy + 0.004 + (decalN++ % 6) * 0.0003, z);
      K.put(M.decal, g);
    },
    wallDecal: (kind, x, y, z, face, w, h) => {
      const g = uvRect(new THREE.PlaneGeometry(w, h), decalUV(kind));
      g.rotateY(P.FACE_YAW[face]);
      const [nx, nz] = NORM[face];
      g.translate(x + nx * (0.014 + (decalN++ % 6) * 0.0003), y + dy, z + nz * (0.014 + (decalN % 6) * 0.0003));
      K.put(M.decal, g);
    },
    label: (text, x, y, z, face, w, h, o = {}) => {
      const r = labels.rect(o.lines ?? text, o, w, h);
      if (face === 'up') return K.plane(M.label, w, h, x, y + dy, z, [-Math.PI / 2, o.yaw ?? 0, 0, 'YXZ'], r, labels.W, labels.H); // (lying on the floor)
      const [nx, nz] = NORM[face];
      K.plane(M.label, w, h, x + nx * 0.02, y + dy, z + nz * 0.02, [0, P.FACE_YAW[face], 0], r, labels.W, labels.H);
    },
  });
  Object.assign(c, mkDeco(0));
  /** the context moved dy up (the props build on y 0: a lower or upper floor) */
  const ctxCache = new Map();
  const at = (dy) => {
    if (!dy) return c;
    if (ctxCache.has(dy)) return ctxCache.get(dy);
    const KK = {
      box: (m, x0, y0, z0, x1, y1, z1, o) => K.box(m, x0, y0 + dy, z0, x1, y1 + dy, z1, o),
      cube: (m, x, y, z, sx, sy, sz, ry) => K.cube(m, x, y + dy, z, sx, sy, sz, ry),
      cyl: (m, x, y, z, r0, r1, h, seg, r, open) => K.cyl(m, x, y + dy, z, r0, r1, h, seg, r, open),
      add: (m, geo, x, y, z, r, s) => K.add(m, geo, x, y + dy, z, r, s),
      addMatrix: (m, geo, mx) => K.addMatrix(m, geo, new THREE.Matrix4().makeTranslation(0, dy, 0).multiply(mx)),
      rod: (m, a, b, r, seg) => K.rod(m, a.clone().setY(a.y + dy), b.clone().setY(b.y + dy), r, seg),
      plane: (m, w, h, x, y, z, r, rect, W, H) => K.plane(m, w, h, x, y + dy, z, r, rect, W, H),
      put: (m, g) => K.put(m, g.translate(0, dy, 0)),
    };
    const cc = {
      ...c,
      K: KK,
      col: (x0, y0, z0, x1, y1, z1, s, f, t) => c.col(x0, y0 + dy, z0, x1, y1 + dy, z1, s, f, t),
      light: (x, y, z, ...r) => c.light(x, y + dy, z, ...r),
      lamp: (o) => c.lamp({ level: levelOf(dy + 0.3), ...o, pos: o.pos.clone().setY(o.pos.y + dy) }),
      screen: (x, y, z, ...r) => c.screen(x, y + dy, z, ...r),
      ...mkDeco(dy),
    };
    ctxCache.set(dy, cc);
    return cc;
  };
  const c0 = at(FLOORS[0]), c2 = at(FLOORS[2]);
  const ctxOfFloor = (f) => (f === 0 ? c : at(f));
  // the furniture modules bring their own materials (EXTRA_MATS: plain params; EXTRA_GLOW: [colour, intensity])
  const FURN = [PL, PF, DA, DB, DC, F2, DD, TK, UP1, UP2, UP3, UP4];
  for (const m of FURN) {
    for (const [k, v] of Object.entries(m.EXTRA_MATS ?? {})) c.X[k] ??= hiveMat(v);
    for (const [k, v] of Object.entries(m.EXTRA_GLOW ?? {})) c.G[k] ??= glow(v[0], v[1]);
  }
  /** a soft shadow strip (AO): len x wd, centred (cx, y, cz), turned yaw, facing up (floor) or down (ceiling) */
  const strip = (mat, len, wd, cx, y, cz, yaw, up) => {
    const g = new THREE.PlaneGeometry(len, wd);
    g.rotateX(up ? -Math.PI / 2 : Math.PI / 2);
    g.rotateY(yaw);
    g.translate(cx, y, cz);
    K.put(mat, g);
  };
  const YAW_FLOOR = { n: 0, s: Math.PI, w: Math.PI / 2, e: -Math.PI / 2 };
  const YAW_CEIL = { n: Math.PI, s: 0, w: -Math.PI / 2, e: Math.PI / 2 };
  const T = makeTanks({ group, updates, K, M, U, c });
  /** a sign from the atlas: centre (x, y, z), facing `face`, w m wide (its height follows the atlas region) */
  const sign = (key, x, y, z, face, w = null) => {
    const r = sg.rects[key];
    const ww = w ?? (r[2] / 256) * 0.9;
    const hh = (ww * r[3]) / r[2];
    K.plane(M.hsigns, ww, hh, x, y, z, [0, P.FACE_YAW[face], 0], r, sg.W, sg.H);
  };
  const roomRect = (s, m = 0.6) => {
    const f = floorOf(s);
    return (p) => p.x > s.x0 - m && p.x < s.x1 + m && p.z > s.z0 - m && p.z < s.z1 + m && p.y > f - 0.6 && p.y < f + s.h + 0.6;
  };

  // ------------------------------------------------ the shell: floors, ceilings, walls (the columns' boundaries)
  {
    // floors and ceilings, merged per height and material
    const horiz = new Map(); // key -> { y, mat, face, mask }
    const mark = (y, mat, face, cell) => {
      const key = `${face}|${y.toFixed(3)}|${mat.uuid}`;
      let h = horiz.get(key);
      if (!h) horiz.set(key, (h = { y, mat, face, mask: new Uint8Array(N) }));
      h.mask[cell] = 1;
    };
    for (let cell = 0; cell < N; cell++) {
      for (let k = 0; k < sc[cell]; k++) {
        const q = cell * SEG + k;
        mark(sa[q], floorMat(sfo[q], sfl[q] & 1), 'py', cell);
        mark(sb[q], ceilMat(sco[q], sfl[q] & 2), 'ny', cell);
      }
    }
    for (const { y, mat, face, mask } of horiz.values()) {
      for (const [i0, j0, i1, j1] of rects((cell) => mask[cell])) {
        if (face === 'py') K.box(mat, X(i0), y - 0.02, Z(j0), X(i1), y, Z(j1), { faces: ['py'], seg: 1.0, mpr: mprOf(mat) });
        else K.box(mat, X(i0), y, Z(j0), X(i1), y + 0.02, Z(j1), { faces: ['ny'], seg: 1.2, mpr: mprOf(mat) });
      }
    }
    // walls: where a column is solid beside an open one, merged along each grid line
    const pieces = [];
    const between = (a, b) => {
      // the heights where b is open and a is solid: faces on a's side, looking into b
      pieces.length = 0;
      for (let k = 0; k < sc[b]; k++) {
        const q = b * SEG + k;
        let cur = sa[q];
        const top = sb[q];
        for (let m = 0; m < sc[a] && cur < top; m++) {
          const r = a * SEG + m;
          if (sb[r] <= cur) continue;
          if (sa[r] >= top) break;
          if (sa[r] > cur + 0.02) pieces.push([cur, Math.min(sa[r], top)]);
          cur = Math.max(cur, sb[r]);
        }
        if (top > cur + 0.02) pieces.push([cur, top]);
      }
      return pieces;
    };
    const emitRuns = (lineAt, span, cellsOf, faceName, place) => {
      // along one grid line: runs of identical faces (y0, y1, material) over consecutive cells
      let runs = new Map();
      for (let t = 0; t <= span; t++) {
        const now = new Map();
        if (t < span) {
          const [a, b] = cellsOf(t);
          if (!ext[a]) {
            for (const [y0, y1] of between(a, b)) {
              // (a deck's edge over the drop: steel, not the hall's wall)
              const mat = y1 - y0 < 0.25 && Math.abs(deck[a] - y1) < 0.01 ? M.steelDark : wallMat(ownerAt(b, (y0 + y1) / 2));
              const key = `${y0.toFixed(3)}|${y1.toFixed(3)}|${mat.uuid}`;
              now.set(key, runs.get(key) ?? { t0: t, y0, y1, mat });
            }
          }
        }
        for (const [key, r] of runs) if (!now.has(key)) place(r, t, faceName, lineAt);
        runs = now;
      }
    };
    const radarSegs = [];
    const placeX = (r, t, face, xb) => {
      const z0 = Z(r.t0), z1 = Z(t);
      if (face === 'px') K.box(r.mat, xb - 0.01, r.y0, z0, xb, r.y1, z1, { faces: ['px'], seg: 1.0, mpr: mprOf(r.mat) });
      else K.box(r.mat, xb, r.y0, z0, xb + 0.01, r.y1, z1, { faces: ['nx'], seg: 1.0, mpr: mprOf(r.mat) });
      if ((r.y0 < 1.2 && r.y1 > 1.2) || (r.y0 < -2 && r.y1 > -2)) radarSegs.push([xb, z0, xb, z1]);
    };
    const placeZ = (r, t, face, zb) => {
      const x0 = X(r.t0), x1 = X(t);
      if (face === 'pz') K.box(r.mat, x0, r.y0, zb - 0.01, x1, r.y1, zb, { faces: ['pz'], seg: 1.0, mpr: mprOf(r.mat) });
      else K.box(r.mat, x0, r.y0, zb, x1, r.y1, zb + 0.01, { faces: ['nz'], seg: 1.0, mpr: mprOf(r.mat) });
      if ((r.y0 < 1.2 && r.y1 > 1.2) || (r.y0 < -2 && r.y1 > -2)) radarSegs.push([x0, zb, x1, zb]);
    };
    for (let i = 0; i < NX - 1; i++) {
      const xb = X(i + 1);
      emitRuns(xb, NZ, (j) => [j * NX + i, j * NX + i + 1], 'px', placeX); // (solid at i, open at i+1: faces +x)
      emitRuns(xb, NZ, (j) => [j * NX + i + 1, j * NX + i], 'nx', placeX);
    }
    for (let j = 0; j < NZ - 1; j++) {
      const zb = Z(j + 1);
      emitRuns(zb, NX, (i) => [j * NX + i, (j + 1) * NX + i], 'pz', placeZ);
      emitRuns(zb, NX, (i) => [(j + 1) * NX + i, j * NX + i], 'nz', placeZ);
    }
    // colliders: the solid round every open column (its own slabs, the walls beside it); not in the others' insides
    const YLO = -3.6, YHI = 9.3;
    const nearOpen = new Uint8Array(N);
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        if (!sc[j * NX + i]) continue;
        for (let b = Math.max(0, j - 2); b <= Math.min(NZ - 1, j + 2); b++) for (let a = Math.max(0, i - 2); a <= Math.min(NX - 1, i + 2); a++) nearOpen[b * NX + a] = 1;
      }
    }
    const solidKey = new Array(N).fill(0);
    for (let cell = 0; cell < N; cell++) {
      if (!nearOpen[cell] || ext[cell]) continue;
      const parts = [];
      let cur = YLO;
      for (let k = 0; k < sc[cell]; k++) {
        const q = cell * SEG + k;
        if (sa[q] > cur + 0.01) parts.push(`${cur.toFixed(3)},${sa[q].toFixed(3)}`);
        cur = Math.max(cur, sb[q]);
      }
      if (YHI > cur + 0.01) parts.push(`${cur.toFixed(3)},${YHI.toFixed(3)}`);
      solidKey[cell] = parts.join(';') || 0;
    }
    for (const [i0, j0, i1, j1, key] of rects((cell) => solidKey[cell])) {
      for (const part of String(key).split(';')) {
        const [y0, y1] = part.split(',').map(Number);
        // (a thin slab between two open spaces is a deck: the gallery's, a catwalk's grating: steel underfoot)
        world.add(X(i0), y0, Z(j0), X(i1), y1, Z(j1), y1 - y0 < 0.22 ? SURF.metal : SURF.concrete);
      }
    }
    // (the radar: this map's walls, the main floor's and sublevel 5's; the lab's own)
    radarSegs.push([-7.1, 18.95, -7.1, 33.8], [7.1, 18.95, 7.1, 33.8], [-7.1, 33.8, 7.1, 33.8], [-7.1, 18.95, 7.1, 18.95], [-6.9, 10.8, -6.9, 18.65], [7.05, 10.8, 7.05, 18.65]);
    c.radarSegs = radarSegs;
  }

  // ------------------------------------------------ railings along every drop-off (decks, stairwells), stairs' tops and
  // the gallery's torn stretches left open
  {
    const gaps = STAIRS.map((s) => {
      const [tx, tz] = stairTop(s);
      return s.along === 'z' ? [s.x0 - 0.12, tz - 0.3, s.x1 + 0.12, tz + 0.3] : [tx - 0.3, s.z0 - 0.12, tx + 0.3, s.z1 + 0.12];
    });
    for (const d of DROPS) {
      const [x0, z0, x1, z1] = d.gap;
      gaps.push([Math.min(x0, x1) - 0.3, Math.min(z0, z1) - 0.3, Math.max(x0, x1) + 0.3, Math.max(z0, z1) + 0.3]);
    }
    const inGap = (x, z) => gaps.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);
    const dropAt = (a, b) => {
      // a's floors that end at b in a drop (b open just above them, its floor far below): their heights
      const out = [];
      for (let k = 0; k < sc[a]; k++) {
        if (sfo[a * SEG + k] < 0) continue; // (a door's or a window's sill: no railing)
        const y = sa[a * SEG + k];
        const s = segAt(b, y + 0.3);
        if (s && s[0] < y - 0.6) out.push(y);
      }
      return out;
    };
    const runLine = (span, cellsOf, place) => {
      let runs = new Map();
      for (let t = 0; t <= span; t++) {
        const now = new Map();
        if (t < span) {
          const [a, b, gx, gz] = cellsOf(t);
          if (!inGap(gx, gz)) for (const y of dropAt(a, b)) now.set(y.toFixed(3), runs.get(y.toFixed(3)) ?? { t0: t, y });
        }
        for (const [key, r] of runs) if (!now.has(key)) place(r, t);
        runs = now;
      }
    };
    for (let i = 0; i < NX - 1; i++) {
      const xb = X(i + 1);
      runLine(NZ, (j) => [j * NX + i, j * NX + i + 1, xb, Z(j) + C / 2], (r, t) => P.railing(c, xb - 0.06, Z(r.t0), xb - 0.06, Z(t), r.y));
      runLine(NZ, (j) => [j * NX + i + 1, j * NX + i, xb, Z(j) + C / 2], (r, t) => P.railing(c, xb + 0.06, Z(r.t0), xb + 0.06, Z(t), r.y));
    }
    for (let j = 0; j < NZ - 1; j++) {
      const zb = Z(j + 1);
      runLine(NX, (i) => [j * NX + i, (j + 1) * NX + i, X(i) + C / 2, zb], (r, t) => P.railing(c, X(r.t0), zb - 0.06, X(t), zb - 0.06, r.y));
      runLine(NX, (i) => [(j + 1) * NX + i, j * NX + i, X(i) + C / 2, zb], (r, t) => P.railing(c, X(r.t0), zb + 0.06, X(t), zb + 0.06, r.y));
    }
    // the torn stretches: bent railing stubs at both ends, the hazard stripe on the edge, a sign on the gallery
    for (const d of DROPS) {
      const [x0, z0, x1, z1] = d.gap;
      const y = FLOORS[2];
      const alongX = z0 === z1;
      const inward = alongX ? Math.sign(d.a[1] - z0) : Math.sign(d.a[0] - x0); // (toward the deck)
      const ends = alongX ? [[x0, z0, -1], [x1, z0, 1]] : [[x0, z0, -1], [x0, z1, 1]];
      for (const [ex, ez, s] of ends) {
        const tipX = alongX ? ex - s * 0.55 : ex + 0.35 * -inward, tipZ = alongX ? ez + 0.35 * -inward : ez - s * 0.55;
        K.rod(M.steel, V(ex, y + 1.05, ez), V(tipX, y + 0.62, tipZ), 0.024, 8);
        K.rod(M.steel, V(ex, y + 0.55, ez), V(alongX ? ex - s * 0.4 : ex - inward * 0.5, y + 0.1, alongX ? ez - inward * 0.5 : ez - s * 0.4), 0.014, 6);
        K.cyl(M.steel, ex, y, ez, 0.02, 0.02, 1.05, 8);
      }
      if (alongX) K.box(M.hazard, Math.min(x0, x1), y + 0.001, z0 + inward * 0.25 - 0.12, Math.max(x0, x1), y + 0.005, z0 + inward * 0.25 + 0.12, { faces: ['py'] });
      else K.box(M.hazard, x0 + inward * 0.25 - 0.12, y + 0.001, Math.min(z0, z1), x0 + inward * 0.25 + 0.12, y + 0.005, Math.max(z0, z1), { faces: ['py'] });
      // a bent plate of grating hanging off the torn edge
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      K.add(M.grateUnder, new THREE.BoxGeometry(alongX ? 0.9 : 0.04, 0.55, alongX ? 0.04 : 0.9), mx - (alongX ? 0 : inward * 0.03), y - 0.45, mz - (alongX ? inward * 0.03 : 0), [alongX ? inward * 0.35 : 0, 0.2, alongX ? 0 : -inward * 0.35]);
    }
  }

  // ------------------------------------------------ stairs: the flights, a rail on each open side
  for (const s of STAIRS) {
    const yb = FLOORS[s.lo], yt = FLOORS[s.hi];
    P.stairFlight(c, { x0: s.x0, x1: s.x1, z0: s.z0, z1: s.z1, along: s.along, low: s.low, yb, yt, n: s.n }, FLAG_STAIR);
    if (s.rail) {
      // a hand rail up the open side, a stop along it
      const x = s.rail === 'x0' ? s.x0 - 0.05 : s.x1 + 0.05;
      const zLow = s.low === 'z0' ? s.z0 : s.z1, zHigh = s.low === 'z0' ? s.z1 : s.z0;
      K.rod(M.steel, V(x, yb + 1.0, zLow), V(x, yt + 1.0, zHigh), 0.024, 8);
      K.rod(M.steel, V(x, yb + 0.5, zLow), V(x, yt + 0.5, zHigh), 0.014, 6);
      for (let i = 0; i <= 4; i++) {
        const t = i / 4;
        K.cyl(M.steel, x, yb + (yt - yb) * t, zLow + (zHigh - zLow) * t, 0.02, 0.02, 1.0, 8);
      }
      world.add(x - 0.05, yb, Math.min(s.z0, s.z1), x + 0.05, yt + 1.1, Math.max(s.z0, s.z1), SURF.metal, FLAG_NOBULLET | FLAG_STAIR);
    }
  }

  // ------------------------------------------------ skirting and guide stripes along the corridors' and rooms' walls
  {
    const STRIPE = { red: M.red, blue: M.blue, yellow: M.yellow, green: M.green, amber: M.yellow };
    for (const s of SPACES) {
      if (s.sealed || s.kind === 'stair' || s.kind === 'shaft') continue;
      const f = floorOf(s);
      const stripe = s.deck ? null : s.stripe ? STRIPE[s.stripe] : s.kind === 'hub' ? M.blue : s.kind === 'deepcorr' || s.kind === 'fcorr' ? M.yellow : null;
      const skirt = s.level === 0 ? M.black : M.dark;
      const edges = [
        { a0: s.x0, a1: s.x1, fixed: s.z0, out: -1, alongX: true },
        { a0: s.x0, a1: s.x1, fixed: s.z1, out: 1, alongX: true },
        { a0: s.z0, a1: s.z1, fixed: s.x0, out: -1, alongX: false },
        { a0: s.z0, a1: s.z1, fixed: s.x1, out: 1, alongX: false },
      ];
      // a skirting board wherever the wall comes down to the floor, the guide stripe wherever it's there at 1.1 m
      for (const [mat, y0, y1, t] of [[skirt, 0, 0.12, 0.018], [stripe, 1.02, 1.14, 0.011]]) {
        if (!mat) continue;
        for (const e of edges) {
          let run0 = null;
          const flush = (a) => {
            if (run0 === null) return;
            const b0 = run0, b1 = a;
            run0 = null;
            if (b1 - b0 < 0.2) return;
            const d = t * e.out;
            const faces = e.alongX ? [e.out < 0 ? 'pz' : 'nz', 'py', 'ny'] : [e.out < 0 ? 'px' : 'nx', 'py', 'ny'];
            if (e.alongX) K.box(mat, b0, f + y0, Math.min(e.fixed, e.fixed - d), b1, f + y1, Math.max(e.fixed, e.fixed - d), { faces });
            else K.box(mat, Math.min(e.fixed, e.fixed - d), f + y0, b0, Math.max(e.fixed, e.fixed - d), f + y1, b1, { faces });
          };
          for (let a = e.a0; a < e.a1 - 1e-6; a += C) {
            const m = a + C / 2;
            const px = e.alongX ? m : e.fixed + e.out * 0.1, pz = e.alongX ? e.fixed + e.out * 0.1 : m;
            const inner = plan.at(e.alongX ? m : e.fixed - e.out * 0.1, e.alongX ? e.fixed - e.out * 0.1 : m);
            const outer = plan.at(px, pz);
            const solid = !openAt(outer, f + y0 + 0.06) && !openAt(outer, f + y1 - 0.02) && openAt(inner, f + y0 + 0.06) && !(outer >= 0 && ext[outer]);
            if (solid) {
              if (run0 === null) run0 = a;
            } else flush(a);
          }
          flush(e.a1);
        }
      }
    }
  }

  // ------------------------------------------------ wainscots, cap rails and soft shadows along every room's walls
  {
    const CAP = { tile: M.white, tileGreen: M.white, tileBlue: M.white, tileCream: M.white, wood: M.wood, steel: M.dark, steelDark: M.dark, band: M.dark, bandGreen: M.dark, bandBlue: M.dark };
    const WAIN_MPR = { tile: 1.2, tileGreen: 1.2, tileBlue: 1.2, tileCream: 1.2, wood: 1.2, steel: 1.2, steelDark: 1.2, band: 2.4, bandGreen: 2.4, bandBlue: 2.4 };
    for (const s of SPACES) {
      if (s.sealed || s.kind === 'stair' || s.kind === 'shaft' || s.style === 'hall' || s.kind === 'catwalk' || s.kind === 'flooded') continue;
      const f = floorOf(s), fin = finOf(s);
      const wain = SH.wains[fin.wain], cap = CAP[fin.wain];
      const edges = [
        { a0: s.x0, a1: s.x1, fixed: s.z0, out: -1, alongX: true, side: 'n' },
        { a0: s.x0, a1: s.x1, fixed: s.z1, out: 1, alongX: true, side: 's' },
        { a0: s.z0, a1: s.z1, fixed: s.x0, out: -1, alongX: false, side: 'w' },
        { a0: s.z0, a1: s.z1, fixed: s.x1, out: 1, alongX: false, side: 'e' },
      ];
      for (const e of edges) {
        let run0 = null, top = 0;
        const inward = -e.out;
        const face = e.alongX ? (e.out < 0 ? 'pz' : 'nz') : e.out < 0 ? 'px' : 'nx';
        const flush = (a) => {
          if (run0 === null) return;
          const b0 = run0, b1 = a;
          run0 = null;
          if (b1 - b0 < 0.2) return;
          const wh = Math.min(fin.wh, top - f - 0.15);
          const plane = (mat, y0, y1, off, mpr) => {
            const o = e.fixed + off * inward;
            if (e.alongX) K.box(mat, b0, f + y0, o, b1, f + y1, o, { faces: [face], seg: 1.0, mpr });
            else K.box(mat, o, f + y0, b0, o, f + y1, b1, { faces: [face], seg: 1.0, mpr });
          };
          if (wh > 0.4) {
            plane(wain, 0.1, wh, 0.008, WAIN_MPR[fin.wain]);
            if (wh < 2.6) {
              const t = 0.028 * inward;
              if (e.alongX) K.box(cap, b0, f + wh - 0.014, Math.min(e.fixed, e.fixed + t), b1, f + wh + 0.024, Math.max(e.fixed, e.fixed + t), { faces: [face, 'py', 'ny'] });
              else K.box(cap, Math.min(e.fixed, e.fixed + t), f + wh - 0.014, b0, Math.max(e.fixed, e.fixed + t), f + wh + 0.024, b1, { faces: [face, 'py', 'ny'] });
            }
          }
          // contact shadows on the floor along the wall and on the ceiling
          const len = b1 - b0, mid = (b0 + b1) / 2;
          strip(M.aoStrip, len, 0.6, e.alongX ? mid : e.fixed + inward * 0.3, f + 0.007, e.alongX ? e.fixed + inward * 0.3 : mid, YAW_FLOOR[e.side], true);
          if (!s.deck) strip(M.aoStrip, len, 0.5, e.alongX ? mid : e.fixed + inward * 0.25, top - 0.006, e.alongX ? e.fixed + inward * 0.25 : mid, YAW_CEIL[e.side], false);
        };
        for (let a = e.a0; a < e.a1 - 1e-6; a += C) {
          const m = a + C / 2;
          const px = e.alongX ? m : e.fixed + e.out * 0.1, pz = e.alongX ? e.fixed + e.out * 0.1 : m;
          const inner = plan.at(e.alongX ? m : e.fixed - e.out * 0.1, e.alongX ? e.fixed - e.out * 0.1 : m);
          const outer = plan.at(px, pz);
          const seg = segAt(inner, f + 0.2);
          const wh = Math.min(fin.wh, (seg ? seg[1] : f + s.h) - f - 0.15);
          const solid = seg && !openAt(outer, f + 0.2) && !openAt(outer, f + wh - 0.05) && !(outer >= 0 && ext[outer]);
          if (solid) {
            if (run0 === null) {
              run0 = a;
              top = seg[1];
            }
          } else flush(a);
        }
        flush(e.a1);
      }
    }
  }

  // ------------------------------------------------ door frames and the signs over them
  const doorInfo = DOORS.map((d) => ({ ...d, alongX: d.x1 - d.x0 > d.z1 - d.z0, cx: (d.x0 + d.x1) / 2, cz: (d.z0 + d.z1) / 2, f: floorOf(d) }));
  for (const d of doorInfo) {
    if (d.kind !== 'door' && d.kind !== 'arch') continue;
    const fw = d.kind === 'arch' ? 0.16 : 0.08;
    const mat = d.kind === 'arch' ? M.hazard : M.steel;
    const y0 = d.f, y1 = d.f + d.h;
    if (d.alongX) {
      K.box(mat, d.x0, y0, d.z0 - 0.04, d.x0 + fw, y1, d.z1 + 0.04);
      K.box(mat, d.x1 - fw, y0, d.z0 - 0.04, d.x1, y1, d.z1 + 0.04);
      K.box(mat, d.x0, y1 - fw, d.z0 - 0.04, d.x1, y1, d.z1 + 0.04);
    } else {
      K.box(mat, d.x0 - 0.04, y0, d.z0, d.x1 + 0.04, y1, d.z0 + fw);
      K.box(mat, d.x0 - 0.04, y0, d.z1 - fw, d.x1 + 0.04, y1, d.z1);
      K.box(mat, d.x0 - 0.04, y1 - fw, d.z0, d.x1 + 0.04, y1, d.z1);
    }
  }
  // balconies and windows: a steel sill cap and trims round the opening
  for (const d of doorInfo) {
    if (d.kind !== 'balcony') continue;
    const y0 = d.f + d.y0, y1 = d.f + d.h;
    if (d.alongX) {
      K.box(M.steelDark, d.x0, y0 - 0.02, d.z0 - 0.05, d.x1, y0 + 0.04, d.z1 + 0.05);
      K.box(M.steelDark, d.x0, y1 - 0.04, d.z0 - 0.03, d.x1, y1, d.z1 + 0.03);
    } else {
      K.box(M.steelDark, d.x0 - 0.05, y0 - 0.02, d.z0, d.x1 + 0.05, y0 + 0.04, d.z1);
      K.box(M.steelDark, d.x0 - 0.03, y1 - 0.04, d.z0, d.x1 + 0.03, y1, d.z1);
    }
  }
  for (const d of doorInfo) {
    if (!d.sign) continue;
    const [key, face] = d.sign;
    const off = 0.03;
    const x = face === 'e' ? d.x1 + off : face === 'w' ? d.x0 - off : d.cx;
    const z = face === 's' ? d.z1 + off : face === 'n' ? d.z0 - off : d.cz;
    // (as big as the wall over the door allows: a gallery or a low ceiling over it)
    const r = sg.rects[key];
    const top = d.f + d.h;
    const room = (segAt(plan.at(x + (face === 'e' ? 0.1 : face === 'w' ? -0.1 : 0), z + (face === 's' ? 0.1 : face === 'n' ? -0.1 : 0)), top + 0.02)?.[1] ?? top) - top - 0.08;
    let w = (r[2] / 256) * 0.9, hh = (w * r[3]) / r[2];
    if (hh > room) {
      hh = room;
      w = (hh * r[2]) / r[3];
    }
    if (hh >= 0.18) sign(key, x, top + 0.04 + hh / 2, z, face, w);
  }

  // ------------------------------------------------ ceiling panels (baked light) and the pooled lamps
  // Each part of the complex has its mood: the labs clinical and bright, the offices dimmer with more dead panels, the
  // server room blue, maintenance under sodium lamps, the morgue cold and half dark, the outer ring on red emergency
  // lights, level 5 older and dimmer, sublevel 5 darker still under amber ones. i: panel strength; broken / dim: the
  // share of dead / weak panels; rgb: the light's colour; lamp: the pooled lamp's colour; emergency: coloured
  // emergency lights along the walls.
  const BLUE = [0.62, 0.78, 1.0], COLD = [0.85, 0.93, 1.0], SICK = [0.75, 1.0, 0.6];
  const MOOD = {
    corridor: { i: 0.72, broken: 0.1, dim: 0.14, rgb: COOL, lamp: 0xdde6ff },
    upper: { i: 0.55, broken: 0.28, dim: 0.2, rgb: [1.0, 0.95, 0.85], lamp: 0xfff0dc },
    ring: { i: 0.45, broken: 0.82, dim: 0.1, rgb: COOL, lamp: 0xff3522, emergency: 'red' },
    lab: { i: 0.66, broken: 0.07, rgb: COOL, lamp: 0xdde6ff },
    ulab: { i: 0.58, broken: 0.22, dim: 0.15, rgb: [0.9, 1.0, 0.92], lamp: 0xe8ffe8 },
    decon: { i: 0.55, broken: 0.1, rgb: [0.9, 1.0, 0.8], lamp: 0xe8ffd0 },
    cryo: { i: 0.6, broken: 0.1, rgb: [0.8, 0.92, 1.0], lamp: 0xcfe6ff },
    stores: { i: 0.5, broken: 0.2, rgb: WARM, lamp: 0xffd2a0 },
    office: { i: 0.62, broken: 0.2, dim: 0.16, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    conf: { i: 0.48, broken: 0.25, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    cafe: { i: 0.62, broken: 0.14, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    lockers: { i: 0.45, broken: 0.3, rgb: COOL, lamp: 0xdde6ff },
    specimen: { i: 0.7, broken: 0.15, rgb: [0.8, 1.0, 0.86], lamp: 0xc8ffd6 },
    server: { i: 0.38, broken: 0.2, rgb: BLUE, lamp: 0x9cc0ff },
    monitor: { i: 0.3, broken: 0.3, rgb: BLUE, lamp: 0x9cc0ff },
    biobank: { i: 0.5, broken: 0.2, rgb: [0.78, 0.9, 1.0], lamp: 0xcfe6ff },
    records: { i: 0.42, broken: 0.35, rgb: WARM, lamp: 0xffd2a0 },
    ward: { i: 0.45, broken: 0.35, dim: 0.25, rgb: SICK, lamp: 0xd6ffb8 },
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
    labCorridor: { i: 0.75, broken: 0, rgb: COOL, lamp: 0xdde6ff },
    armory: { i: 0.55, broken: 0, rgb: WARM, lamp: 0xffd2a0 },
    stair: { i: 0.45, broken: 0.2, rgb: WARM, lamp: 0xffa860, emergency: 'amber' },
    deepcorr: { i: 0.36, broken: 0.45, dim: 0.25, rgb: COOL, lamp: 0xffa050, emergency: 'amber' },
    fcorr: { i: 0.3, broken: 0.5, dim: 0.25, rgb: [0.8, 0.95, 1.0], lamp: 0xa8e8e0, emergency: 'amber' },
  };
  const moodOf = (s) => (s.zone === 'ring' && s.kind === 'corridor' ? MOOD.ring : s.level === 2 && s.kind === 'corridor' ? MOOD.upper : MOOD[s.kind]);
  const emergencyLight = (cs, x, y, z, side, alongX, color) => {
    const rgb = color === 'red' ? RED : AMBER;
    cs.K.box(M.dark, x - 0.16, y - 0.07, z - 0.16, x + 0.16, y + 0.07, z + 0.16);
    cs.K.box(color === 'red' ? U.red : U.emAmber, x - 0.13, y - 0.1, z - 0.13, x + 0.13, y - 0.07, z + 0.13);
    cs.light(x + (alongX ? 0 : -side * 0.3), y - 0.2, z + (alongX ? -side * 0.3 : 0), color === 'red' ? 0.9 : 0.7, 2.6, rgb, null, 8);
  };
  for (const s of SPACES) {
    const md = moodOf(s);
    if (!md) continue;
    const cs = at(floorOf(s));
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    if (s.kind === 'corridor' || s.kind === 'deepcorr' || s.kind === 'fcorr' || s.kind === 'stair' || s.kind === 'labCorridor') {
      const alongX = w > d;
      const L = alongX ? w : d;
      const n = Math.max(1, Math.round(L / 4));
      for (let i = 0; i < n; i++) {
        const u = (alongX ? s.x0 : s.z0) + (L * (i + 0.5)) / n;
        const x = alongX ? u : (s.x0 + s.x1) / 2, z = alongX ? (s.z0 + s.z1) / 2 : u;
        const r = rnd();
        const broken = r < md.broken, dim = !broken && r < md.broken + (md.dim ?? 0);
        P.panel(cs, x, z, s.h, { len: 1.3, alongX, broken, dim, flick: !broken && !dim && rnd() < md.broken * 0.4 ? 1 + Math.floor(rnd() * 3) : 0, i: md.i, r: 3.0, color: md.rgb });
        if (!broken && i % 3 === 1 && !md.emergency) cs.lamp({ pos: V(x, s.h - 0.12, z), color: md.lamp, flicker: rnd() < 0.3 ? 0.35 : 0, room: roomRect(s, 1.5) });
      }
      if (md.emergency) {
        const m = Math.max(1, Math.round(L / 7));
        for (let i = 0; i < m; i++) {
          const u = (alongX ? s.x0 : s.z0) + (L * (i + 0.5)) / m;
          const side = i % 2 ? 1 : -1;
          const x = alongX ? u : side < 0 ? s.x0 + 0.06 : s.x1 - 0.06, z = alongX ? (side < 0 ? s.z0 + 0.06 : s.z1 - 0.06) : u;
          const ey = s.kind === 'fcorr' ? s.h - 0.3 : s.h - 0.7; // (the flooded wing's windows reach up to 2.6 m)
          emergencyLight(cs, x, ey, z, side, alongX, md.emergency);
          if (i % 3 === 1) cs.lamp({ pos: V(x + (alongX ? 0 : -side * 0.3), ey - 0.2, z + (alongX ? -side * 0.3 : 0)), color: md.emergency === 'red' ? 0xff2a18 : 0xff8a28, intensity: 16, angle: 1.3, distance: 9, flicker: 0.25, room: roomRect(s, 1.5) });
        }
      }
    } else {
      const nx = Math.max(1, Math.round(w / 3.6)), nz = Math.max(1, Math.round(d / 3.6));
      for (let a = 0; a < nx; a++) {
        for (let b = 0; b < nz; b++) {
          const x = s.x0 + (w * (a + 0.5)) / nx, z = s.z0 + (d * (b + 0.5)) / nz;
          const r = rnd();
          const broken = r < md.broken, dim = !broken && r < md.broken + (md.dim ?? 0);
          P.panel(cs, x, z, s.h, { len: 1.2, alongX: true, broken, dim, flick: !broken && !dim && rnd() < md.broken * 0.4 ? 1 + Math.floor(rnd() * 3) : 0, i: md.i, r: s.h > 4.5 ? 4.4 : 3.0, color: md.rgb });
        }
      }
      cs.lamp({ pos: V((s.x0 + s.x1) / 2, s.h - 0.12, (s.z0 + s.z1) / 2), color: md.lamp, intensity: s.h > 4.5 ? 50 : 24, distance: s.h > 4.5 ? 14 : 10, flicker: md.broken > 0.2 ? 0.3 : 0, room: roomRect(s) });
    }
  }

  // ------------------------------------------------ the atrium: the specimen column, consoles, cover, the gallery
  {
    const H = SPACE.hub.h;
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
    c.light(0, 0.9, 0, 1.4, 4.5, [0.25, 0.9, 0.5], [0, 1, 0], 9);
    for (const [x, z, face] of [[0, -3.2, 'n'], [0, 3.2, 's'], [-3.2, 0, 'w'], [3.2, 0, 'e']]) {
      const alongX = face === 'n' || face === 's';
      const r = alongX ? [x - 0.9, z - 0.35, x + 0.9, z + 0.35] : [x - 0.35, z - 0.9, x + 0.35, z + 0.9];
      P.desk(c, r, face, { mess: false });
    }
    // cover under the gallery (clear of the drops' landing spots and the stairs)
    P.crates(c, -8.4, 1.8, 0.9, 2);
    P.crates(c, 8.4, -1.8, 0.9, 2);
    P.crates(c, -1.8, -8.4, 0.8, 1, { wood: true });
    P.crates(c, 1.8, 8.5, 0.8, 1, { wood: true });
    P.drum(c, -8.6, -8.6);
    P.drum(c, -8.7, 8.7, { mat: M.red });
    P.gurney(c, 8.0, 4.8, 1.2, { tipped: true });
    P.clutter(c, -3, -6.5, 8, 2.5);
    P.clutter(c, 4, 6.5, 6, 2);
    // the gallery: cover up there (a sniper's nest over the ways in), dark observation windows round its walls
    P.crates(c2, -8.8, -8.8, 0.9, 1);
    P.crates(c2, 8.8, 8.9, 0.9, 1, { wood: true });
    P.crates(c2, 8.8, -8.8, 0.8, 1);
    P.crates(c2, -8.8, 8.8, 0.8, 1, { wood: true });
    // the observation windows above the gallery, pilasters under it, the roof's beams and ducts, wayfinding (hiveHub.js)
    const strips = [
      [-9, -9.99, -2.8, -9.97], [2.8, -9.99, 9, -9.97], // north (the blast door between)
      [-9, 9.97, 9, 9.99], // south
      [-9.99, 2.8, -9.97, 9], // west (the monitoring room's window and the door in the rest)
      [9.97, -9, 9.99, -2.8], [9.97, 2.8, 9.99, 9], // east
    ];
    atriumDress(c, { SH, F, H, P, strips, deckTop: FLOORS[2] });
    sign('atrium', 0, 6.2, -9.96, 's', 5.2);
    sign('logo', 0, 6.2, 9.96, 'n', 3.6);
    sign('sub4', -9.96, 6.4, 5.8, 'e', 2.4);
    sign('level5', 9.96, 6.4, -5.8, 'w', 2.4);
    P.pipeRun(c, -9.6, -9.6, 9.6, -9.6, H - 0.4, 3, 0.1);
    P.pipeRun(c, -9.6, 9.6, 9.6, 9.6, H - 0.4, 2, -0.3);
    // the sample hatch by the safe door: a steel box in the wall, its flap, a green light, the sign over it
    K.box(M.steelDark, HATCH.x - 0.55, 0.85, 9.9, HATCH.x + 0.55, 1.55, 10.02);
    K.box(M.dark, HATCH.x - 0.45, 0.95, 9.88, HATCH.x + 0.45, 1.45, 9.9);
    K.box(M.hazard, HATCH.x - 0.55, 0.8, 9.88, HATCH.x + 0.55, 0.85, 10.0);
    K.cube(U.ledG, HATCH.x + 0.38, 1.5, 9.88, 0.05, 0.05, 0.02);
    K.cube(M.steel, HATCH.x, 1.2, 9.86, 0.3, 0.04, 0.03);
    sign('hatch', HATCH.x, 2.0, 9.96, 'n', 1.9);
    c.light(HATCH.x, 1.6, 9.5, 0.35, 1.2, [0.4, 1, 0.5], null, 3);
  }

  // ------------------------------------------------ the corridors' fittings (the main floor and level 5)
  for (const id of ['w1', 'e1', 'n1', 'w2', 'e2', 'n2', 'uw', 'ue', 'un', 'uws']) {
    const s = SPACE[id];
    const cs = at(floorOf(s));
    const alongX = s.x1 - s.x0 > s.z1 - s.z0;
    const y = s.h - 0.35;
    if (alongX) {
      P.pipeRun(cs, s.x0 + 0.2, s.z0 + 0.25, s.x1 - 0.2, s.z0 + 0.25, y, 3, 0);
      P.cableTray(cs, s.x0 + 0.2, s.z1 - 0.35, s.x1 - 0.2, s.z1 - 0.35, s.h - 0.3);
    } else {
      P.pipeRun(cs, s.x0 + 0.25, s.z0 + 0.2, s.x0 + 0.25, s.z1 - 0.2, y, 3, 0);
      P.cableTray(cs, s.x1 - 0.35, s.z0 + 0.2, s.x1 - 0.35, s.z1 - 0.2, s.h - 0.3);
    }
  }

  // ------------------------------------------------ the rooms of the main floor
  // the cafeteria and the locker room are dressCafe2 / dressLockers2's (hiveUp4.js); the cafeteria's sign stays here
  sign('cafe', SPACE.cafe.x0 + 9, 3.9, SPACE.cafe.z1 - 0.04, 'n', 2.6);
  // the specimen hall's tubes (a zombie in each; one smashed): the rest of the hall is dressSpecimen's
  for (const [x, z, o] of [
    [-15.5, -17.5, { kind: 'normal', pose: 'limp', yaw: 2.6 }],
    [-12.5, -17.5, { broken: true }],
    [-9.5, -17.5, { kind: 'woman', pose: 'curl', yaw: 3.3 }],
    [-6.5, -17.5, { kind: 'worker', pose: 'reach', yaw: 2.9 }],
  ]) T.tube({ x, z, r: 0.62, h: 2.9, ceil: SPACE.specimen.h, ...o });

  // ------------------------------------------------ every room's dress function (hiveLabs.js, hiveDress*.js, hiveFacility2.js, hiveTech.js)
  {
    const doorsAt = (level) => doorInfo.filter((d) => d.level === level);
    const ctxFor = (level) => {
      const doors = doorsAt(level);
      return {
        S: SPACE,
        doors,
        doorsOf: (id) => {
          const sp = SPACE[id];
          return doors.filter((d) => d.x1 >= sp.x0 - 0.01 && d.x0 <= sp.x1 + 0.01 && d.z1 >= sp.z0 - 0.01 && d.z0 <= sp.z1 + 0.01);
        },
        V,
        anchor: {},
      };
    };
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
      specimen: DC.dressSpecimen,
      office1: DD.dressOffice1,
      office2: DD.dressOffice2,
      conf: DD.dressConf,
      director: DD.dressDirector,
      quarters: F2.dressQuarters,
      server: TK.dressServer,
      ops: TK.dressOps,
      security: TK.dressSecurity,
      maint: TK.dressMaint,
      stores: TK.dressStores,
      archive: TK.dressArchive,
      cafe: UP4.dressCafe2,
      lockers: UP4.dressLockers2,
      ulabC: UP1.dressUlab,
      ulabD: UP1.dressUlab,
      uvir: UP1.dressVirology,
      umon: UP2.dressMonitor,
      ubio: UP2.dressBiobank,
      urec: UP2.dressRecords,
      uarch: UP2.dressUarch,
      uoff: UP3.dressUoff,
      uward: UP3.dressWard,
      uws: UP3.dressElevatorHall,
    };
    const dbg = /[?&]dbg\b/.test(location.search);
    for (const sp of SPACES) {
      const fn = DRESS[sp.id] ?? (sp.kind === 'corridor' && sp.level !== 0 ? DD.dressCorridor : null);
      if (!fn) continue;
      const f = floorOf(sp);
      const cs = ctxOfFloor(f);
      // (?dbg: check what the dress function built against the room: nothing over the ceiling, under the floor or outside)
      let box = null;
      const put = K.put.bind(K);
      if (dbg) {
        box = new THREE.Box3();
        const bb = new THREE.Box3();
        K.put = (m, g) => {
          g.computeBoundingBox();
          if (m !== M.decal && m !== M.label && m !== M.aoStrip) {
            bb.copy(g.boundingBox);
            if (bb.max.y - bb.min.y < 6 && !m.transparent) box.union(bb);
          }
          return put(m, g);
        };
      }
      fn(cs, sp, ctxFor(sp.level));
      if (dbg) {
        K.put = put;
        const e = 0.06;
        const bad = [];
        if (box.max.y > f + sp.h + e) bad.push('over the ceiling by ' + (box.max.y - f - sp.h).toFixed(2));
        if (box.min.y < f - 0.05) bad.push('under the floor by ' + (f - box.min.y).toFixed(2));
        if (box.min.x < sp.x0 - e || box.max.x > sp.x1 + e || box.min.z < sp.z0 - e || box.max.z > sp.z1 + e) bad.push(`outside the room: x ${box.min.x.toFixed(2)}..${box.max.x.toFixed(2)} z ${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`);
        if (bad.length) console.warn('[hive dress] ' + sp.id + ': ' + bad.join('; '));
      }
    }
  }

  // ------------------------------------------------ level 5's tubes (the rest of the rooms is dressUlab, dressMonitor ... in hiveUp1-3.js)
  for (const id of ['ulabC', 'ulabD']) {
    const s = SPACE[id];
    const cx = (s.x0 + s.x1) / 2;
    T.tube({ x: cx + 2.2, z: -5.0, r: 0.45, h: 2.2, floor: FLOORS[2], kind: id === 'ulabC' ? 'worker' : 'woman', pose: 'limp', yaw: 1.2, broken: id === 'ulabD', ceil: s.h });
  }
  for (const [x, broken, kind, pose] of [[21.8, false, 'gasmask', 'spread'], [23.6, true, 'normal', 'limp'], [25.4, false, 'smoker', 'curl'], [27.2, false, 'survivor', 'reach']]) T.tube({ x, z: -8.9, r: 0.5, h: 2.4, floor: FLOORS[2], kind, pose, yaw: 2.9, broken, ceil: SPACE.uvir.h });

  // ------------------------------------------------ Nadja's lab: the farm lab of part one itself, from inside
  // (world/lab.js buildLab: moved whole, walkable, her counter standing free in the hall, the vault door open on the
  // basement the fireteam came through; its basement side into `side`, which sits at the lab's offset)
  const side = new THREE.Group();
  side.name = 'labBasementSide';
  side.position.copy(LAB_OFF);
  group.add(side);
  const farmLab = buildLab({ staticGroup: side }, world, lamps, { off: LAB_OFF, walkable: true, island: ISLAND, doorOpen: true, lampLevel: 1 });
  group.add(farmLab.group);
  side.add(farmLab.door.pivot);
  group.add(buildBasement(world, lamps, LAB_OFF));
  {
    // the lab corridor: the way from the atrium to the lab's gallery (its safe door: safeZoneShop)
    const s = SPACE.labc;
    P.lockers(c, [s.x1 - 0.5, 13.0, s.x1, 16.4], 'w');
    P.extinguisher(c, s.x0 + 0.01, 12.2, 'e');
    K.box(M.hazard, s.x0, 0.002, 10.5, s.x1, 0.006, 11.1, { faces: ['py'] });
    sign('secure', (s.x0 + s.x1) / 2, 2.55, 20.97, 'n', 2.2);
    // the armory past the lab's far door: her counter, a pegboard of guns (safeZoneShop hangs them), ammo cases
    const a = SPACE.armory, ac = at(ARMORY_F);
    ac.K.box(M.wood, COUNTER.x0, 0.95, COUNTER.z0, COUNTER.x1 + 0.05, 1.005, COUNTER.z1);
    ac.K.box(M.dark, COUNTER.x0 + 0.05, 0, COUNTER.z0 + 0.05, COUNTER.x1, 0.95, COUNTER.z1 - 0.05);
    ac.K.box(M.hazard, COUNTER.x1 - 0.01, 0.1, COUNTER.z0 + 0.1, COUNTER.x1 + 0.005, 0.25, COUNTER.z1 - 0.1, { faces: ['px'] });
    world.add(COUNTER.x0, ARMORY_F, COUNTER.z0, COUNTER.x1 + 0.05, COUNTER.top, COUNTER.z1, SURF.wood);
    ac.K.box(M.dark, a.x0 + 0.02, 1.0, 29.0, a.x0 + 0.06, 3.0, 34.0);
    P.crates(ac, -8.6, 28.8, 0.8, 2);
    P.crates(ac, -9.6, 28.7, 0.7, 1, { wood: true });
    P.crates(ac, -8.4, 34.2, 0.9, 2);
    P.shelf(ac, [-11.2, a.z1 - 0.6, -8.6, a.z1], { fill: 'boxes' });
    ac.K.box(U.neon, COUNTER.x1 - 0.02, 2.35, 30.0, COUNTER.x1, 2.42, 33.0);
    for (const z of [30.2, 32.8]) ac.K.rod(M.steel, V(COUNTER.x1 - 0.01, 2.42, z), V(COUNTER.x1 - 0.01, a.h, z), 0.006, 5);
    ac.light(COUNTER.x1 + 0.4, 2.4, 31.5, 0.5, 2.0, [1, 0.3, 0.2], null, 4);
    sign('armory', COUNTER.x1 + 0.02, ARMORY_F + 2.7, 31.5, 'e', 1.6);
    ac.lamp({ pos: V(-10.2, a.h - 0.3, 31.5), intensity: 22, angle: 1.0, distance: 9, room: (p) => p.x > a.x0 - 0.5 && p.x < a.x1 + 0.6 && p.z > a.z0 - 0.5 && p.z < a.z1 + 0.5 && p.y < -1 });
  }

  // ------------------------------------------------ the crashed elevator: the wreck at the bottom, the ladder, the doors
  {
    const s = SPACE.shaft, f0 = FLOORS[0], top = f0 + s.h;
    // the car: crumpled, tipped against the west wall, its roof hatch torn open
    const carM = new THREE.Matrix4().compose(V(-34.35, f0 + 1.05, 15.5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.06, 0.05, 0.16)), V(1, 1, 1));
    K.addMatrix(M.steelDark, new THREE.BoxGeometry(1.3, 2.2, 2.6), carM);
    K.addMatrix(M.dark, new THREE.BoxGeometry(1.36, 0.08, 2.66).translate(0, 1.12, 0), carM);
    K.addMatrix(M.black, new THREE.BoxGeometry(0.62, 0.02, 0.62).translate(0.1, 1.17, -0.4), carM);
    K.addMatrix(M.steel, new THREE.BoxGeometry(0.64, 0.03, 0.64).translate(0.55, 1.35, -0.4).rotateZ(0.9), carM);
    K.addMatrix(M.hazard, new THREE.BoxGeometry(1.32, 0.18, 0.02).translate(0, -0.9, 1.31), carM);
    world.add(-35, f0, 14.1, -33.6, f0 + 2.3, 16.9, SURF.metal);
    // its cables, down from the top of the shaft, one snapped and coiled on the roof
    for (const [x, z] of [[-33.6, 15.0], [-33.4, 16.0]]) K.rod(M.black, V(x, top - 0.1, z), V(x - 0.4, f0 + 2.4, z), 0.02, 6);
    K.add(M.black, new THREE.TorusGeometry(0.28, 0.02, 6, 20), -34.3, f0 + 2.33, 15.2, [Math.PI / 2, 0, 0]);
    // the ladder up the east wall (actors/ladders.js climbs it), rails a metre past the top
    const lx = SHAFT_LADDER.x, lz = SHAFT_LADDER.z, hw = SHAFT_LADDER.width / 2;
    for (const dz of [-hw, hw]) K.rod(M.yellow, V(lx, f0, lz + dz), V(lx, FLOORS[2] + 1.05, lz + dz), 0.022, 6);
    for (let y = f0 + 0.3; y < FLOORS[2] + 0.1; y += 0.3) K.rod(M.steel, V(lx, y, lz - hw), V(lx, y, lz + hw), 0.014, 5);
    for (let y = f0 + 1.5; y < FLOORS[2]; y += 1.8) K.box(M.dark, lx, y - 0.04, lz - 0.05, -32.0, y + 0.04, lz + 0.05);
    // the pried doors up at level 5: the two leaves forced apart, bent
    const dz0 = 14.6, dz1 = 16.4;
    K.box(M.door, -32.04, FLOORS[2], dz0 - 0.55, -31.94, FLOORS[2] + 2.4, dz0 + 0.02);
    K.box(M.door, -32.04, FLOORS[2], dz1 - 0.02, -31.94, FLOORS[2] + 2.4, dz1 + 0.55);
    K.add(M.door, new THREE.BoxGeometry(0.1, 0.9, 0.5), -31.9, FLOORS[2] + 0.45, dz1 + 0.1, [0, 0, 0.25]);
    K.box(M.hazard, -31.5, FLOORS[2] + 0.001, dz0, -30.9, FLOORS[2] + 0.004, dz1, { faces: ['py'] });
    // a red warning light at the top, a weak one at the bottom
    K.box(M.dark, -34.8, top - 0.5, 15.35, -34.6, top - 0.3, 15.65);
    K.box(U.red, -34.62, top - 0.48, 15.38, -34.58, top - 0.32, 15.62);
    c.light(-34.2, top - 0.6, 15.5, 0.8, 2.5, RED, null, 9);
    c.light(-33.2, f0 + 2.2, 15.5, 0.35, 2.0, AMBER, null, 5);
    c.lamp({ pos: V(-33.5, top - 0.4, 15.5), level: 0, color: 0xff3020, intensity: 14, angle: 1.3, distance: 11, flicker: 0.3, room: roomRect(s, 0.6) });
  }

  // ------------------------------------------------ sublevel 5: the shafts down, the flooded wing, the pump hall
  {
    for (const id of ['dW', 'dE']) {
      const s = SPACE[id];
      P.pipeRun(c0, s.x0 + 0.25, s.z0 + 0.2, s.x0 + 0.25, s.z1 - 0.2, s.h - 0.3, 3, 0);
      P.cableTray(c0, s.x1 - 0.35, s.z0 + 0.2, s.x1 - 0.35, s.z1 - 0.2, s.h - 0.25);
      for (let k = 0; k < 5; k++) P.puddle(c0, (s.x0 + s.x1) / 2 + (rnd() - 0.5) * 1.6, s.z0 + 2 + rnd() * (s.z1 - s.z0 - 4), 0.5 + rnd() * 0.8);
    }
    P.gurney(c0, -37.2, 20, 0.1, { bag: true });
    P.crates(c0, -38, 30.5, 0.8, 2);
    P.drum(c0, 36.4, 13.5, { down: true });
    P.crates(c0, 37.8, 25.4, 0.8, 1, { wood: true });
    P.clutter(c0, -37, 26, 6, 1);
    P.clutter(c0, 37, 18, 6, 1);
    sign('sub5', -37, FLOORS[0] + 3.45, 9.22, 'n', 1.4);
    sign('sub5', 37, FLOORS[0] + 3.45, 9.22, 'n', 1.4);
    // the flooded wing: the corridor between the labs full of water, their windows, the drowned in them
    const fc = SPACE.fc;
    P.pipeRun(c0, fc.x0 + 0.2, fc.z0 + 0.3, fc.x1 - 0.2, fc.z0 + 0.3, fc.h - 0.3, 3, 0);
    P.pipeRun(c0, fc.x0 + 0.2, fc.z1 - 0.3, fc.x1 - 0.2, fc.z1 - 0.3, fc.h - 0.3, 2, -0.1);
    for (let k = 0; k < 14; k++) P.puddle(c0, fc.x0 + 2 + rnd() * (fc.x1 - fc.x0 - 4), fc.z0 + 0.8 + rnd() * 2.4, 0.4 + rnd() * 1.0);
    for (const s of SPACES) {
      if (s.kind !== 'flooded') continue;
      P.floodedLab(c0, [s.x0, s.z0, s.x1, s.z1], s.h - 0.35, s.face);
    }
    for (const d of doorInfo) {
      if (d.kind !== 'fwindow') continue;
      const y0 = d.f + d.y0, y1 = d.f + d.h, zc = d.cz;
      K.box(U.glass, d.x0, y0, zc - 0.03, d.x1, y1, zc + 0.03);
      for (const [x0, a, x1, b] of [[d.x0 - 0.08, y0 - 0.08, d.x1 + 0.08, y0], [d.x0 - 0.08, y1, d.x1 + 0.08, y1 + 0.08], [d.x0 - 0.08, y0, d.x0, y1], [d.x1, y0, d.x1 + 0.08, y1]]) K.box(M.steelDark, x0, a, d.z0 - 0.04, x1, b, d.z1 + 0.04);
      world.add(d.x0, y0, zc - 0.05, d.x1, y1, zc + 0.05, SURF.glass, FLAG_NAVIGNORE, 'glass');
      const face = zc < 42 ? 's' : 'n';
      sign('flooded', d.cx, y1 + 0.25, face === 's' ? d.z1 + 0.05 : d.z0 - 0.05, face, 1.2);
    }
    const ps = SPACE.ps;
    K.box(M.hazard, ps.x0, FLOORS[0] + 0.002, ps.z1 - 0.5, ps.x1, FLOORS[0] + 0.006, ps.z1, { faces: ['py'] });
    P.puddle(c0, 0.6, 46.4, 1.2);
    // the pump hall: four giant vessels, pumps, pipe risers, the catwalks a floor up (their stairs: STAIRS)
    const hl = SPACE.hall;
    for (const [x, z, face] of [[-8, 57.2, 's'], [8, 57.2, 's'], [-8, 65.2, 'n'], [8, 65.2, 'n']]) P.reactor(c0, x, z, 2.8, 9, hl.h, face);
    P.plant(c0, [-14.4, 62, -11.4, 66], 'pump');
    P.plant(c0, [11.4, 62, 14.4, 66], 'pump');
    P.plant(c0, [-4.5, 66.5, -2.2, 69], 'gen');
    for (const [x, z] of [[-15.6, 63.5], [15.6, 63.5], [-15.6, 67.2], [15.6, 67.2]]) P.pipeRiser(c0, x, z, hl.h, 3, false);
    for (let k = 0; k < 10; k++) P.puddle(c0, -12 + rnd() * 24, 53 + rnd() * 16, 0.6 + rnd() * 1.4);
    P.crates(c0, -12.5, 70.2, 0.9, 2);
    P.drum(c0, 12.8, 70.4, { down: true });
    P.drum(c0, 11.9, 70.8);
    P.gurney(c0, 4.4, 61, 1.1, { bag: true });
    P.clutter(c0, 0, 60, 10, 4);
    // lights: high panels, sodium lamps hung under the catwalks and the bridge, floodlights, big spots, amber lights
    for (const x of [-12, -4, 4, 12]) for (const z of [54, 61, 68]) P.panel(c0, x, z, hl.h, { len: 1.6, alongX: true, broken: rnd() < 0.35, dim: rnd() < 0.5, i: 1.2, r: 8, color: COOL, range: 24 });
    const SODIUM = [1.0, 0.62, 0.3];
    for (const [x, z, real] of [[-1.2, 55, false], [1.2, 60, true], [-1.2, 65, false], [-12, 52.2, false], [-6, 52.2, true], [6, 52.2, false], [12, 52.2, false], [-12, 69.8, true], [-6, 69.8, false], [6, 69.8, true], [12, 69.8, false]]) {
      K.cyl(M.dark, x, -0.52, z, 0.22, 0.07, 0.3, 16, null, true);
      K.add(U.emAmber, new THREE.SphereGeometry(0.07, 10, 8), x, -0.49, z);
      c.light(x, -0.62, z, 1.1, 3.4, SODIUM, null, 11);
      if (real) c.lamp({ level: 0, pos: V(x, -0.66, z), color: 0xffb060, intensity: 18, angle: 1.25, distance: 10, flicker: rnd() < 0.3 ? 0.3 : 0, room: roomRect(hl, 1) });
    }
    for (const z of [57, 65]) {
      for (const s of [-1, 1]) {
        const x = s * 15.98;
        K.box(M.dark, Math.min(x, x - s * 0.34), 2.2, z - 0.36, Math.max(x, x - s * 0.34), 2.62, z + 0.36);
        K.box(U.panel, Math.min(x - s * 0.34, x - s * 0.37), 2.25, z - 0.3, Math.max(x - s * 0.34, x - s * 0.37), 2.57, z + 0.3);
        c.light(x - s * 0.6, 2.3, z, 1.5, 7, COOL, [-s * 0.72, -0.7, 0], 24);
      }
    }
    for (const [x, z] of [[-8, 53.5], [8, 53.5], [-8, 68.5], [8, 68.5]]) c0.lamp({ pos: V(x, hl.h - 0.4, z), color: 0xdfe8ff, intensity: 70, angle: 0.9, distance: 20, flicker: rnd() < 0.5 ? 0.25 : 0, shadow: true, room: roomRect(hl, 1) });
    for (const [x, z, sd, alongX] of [[-15.94, 60, -1, false], [15.94, 60, 1, false], [-15.94, 68, -1, false], [15.94, 54, 1, false], [-8, 71.94, 1, true], [8, 50.06, -1, true]]) emergencyLight(c0, x, 4.5, z, sd, alongX, 'amber');
    c0.light(0, 4, 61, 0.5, 8, [0.9, 0.6, 0.35], null, 18);
    sign('sub5', -12, FLOORS[1] + 2.4, 50.03, 's', 1.6);
  }

  // ------------------------------------------------ drips from the ceilings of sublevel 5 (world/weather.js)
  const drips = [];
  for (const [x, z, h] of [[-37, 13, 3.0], [-36.6, 26, 3.0], [37.3, 15, 3.0], [36.8, 30, 3.0], [-24, 41.5, 3.0], [-9, 42.6, 3.0], [6, 41.2, 3.0], [21, 42.8, 3.0], [31, 41.6, 3.0], [0.8, 46.4, 3.0], [1.2, 57, 2.95], [-1.1, 63, 2.95], [0.9, 67.6, 2.95], [-33.2, 15.9, 9.7]]) drips.push([x, FLOORS[0] + h - 0.05, z, FLOORS[0]]);

  // ------------------------------------------------ the building's own fittings: doors, ceilings, grime
  const spaceAt = (x, z, y) => {
    const cc = plan.at(x, z);
    if (cc < 0) return null;
    const o = ownerAt(cc, y);
    return o >= 0 ? SPACES[o] : null;
  };
  {
    // (not the atrium, the decks, the sealed labs, the stairs, the shaft, the catwalks, the pump hall)
    const noFit = (s) => s.kind === 'hub' || s.deck || s.sealed || s.kind === 'stair' || s.kind === 'shaft' || s.kind === 'catwalk' || s.style === 'hall' || s.kind === 'flooded';
    doorLeaves(ctxOfFloor, { doorInfo, spaceAt, F });
    ceilingFixtures(ctxOfFloor, { spaces: SPACES, finOf, F, floorOf, skip: noFit });
    grimePass(ctxOfFloor, { spaces: SPACES, doorInfo, spaceAt, floorOf, skip: (s) => noFit(s) && s.kind !== 'hub' });
  }

  // ------------------------------------------------ contact shadows under everything that stands on a floor
  {
    const pad = 0.3;
    const onFloor = (y) => FLOORS.some((f) => Math.abs(y - f) < 0.07) || Math.abs(y - ARMORY_F) < 0.07;
    for (const b of world.boxes) {
      const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
      if (b.surface === SURF.concrete || b.tag || b.flags & (FLAG_STAIR | FLAG_NOBULLET) || !onFloor(b.minY) || b.maxY - b.minY < 0.3 || w > 7 || d > 7 || w < 0.2 || d < 0.2) continue;
      const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, y = b.minY + 0.0065;
      strip(M.aoStrip, w + pad * 2, pad, cx, y, b.minZ - pad / 2, YAW_FLOOR.s, true);
      strip(M.aoStrip, w + pad * 2, pad, cx, y, b.maxZ + pad / 2, YAW_FLOOR.n, true);
      strip(M.aoStrip, d, pad, b.minX - pad / 2, y, cz, YAW_FLOOR.e, true);
      strip(M.aoStrip, d, pad, b.maxX + pad / 2, y, cz, YAW_FLOOR.w, true);
    }
  }

  // ------------------------------------------------ blast doors and the safe door: the leaves (their own Kit: they move)
  const leaves = [];
  const unlockables = {};
  const beacons = [];
  let safeLeaf = null;
  for (const d of doorInfo) {
    if (d.kind !== 'blast' && d.kind !== 'safe') continue;
    const KL = new Kit();
    const t = 0.18;
    const bx0 = d.alongX ? d.x0 : d.cx - t / 2, bx1 = d.alongX ? d.x1 : d.cx + t / 2;
    const bz0 = d.alongX ? d.cz - t / 2 : d.z0, bz1 = d.alongX ? d.cz + t / 2 : d.z1;
    const y0 = d.f, y1 = d.f + d.h;
    KL.box(M.door, bx0, y0, bz0, bx1, y1, bz1, { seg: 0.8 });
    const band = (a, b) => (d.alongX ? KL.box(M.hazard, bx0, a, bz0 - 0.01, bx1, b, bz1 + 0.01) : KL.box(M.hazard, bx0 - 0.01, a, bz0, bx1 + 0.01, b, bz1));
    band(y0 + 0.05, y0 + 0.4);
    band(y1 - 0.4, y1 - 0.05);
    for (let k = 1; k < 4; k++) {
      const y = y0 + 0.4 + ((d.h - 0.8) * k) / 4;
      if (d.alongX) KL.box(M.dark, bx0, y - 0.04, bz0 - 0.025, bx1, y + 0.04, bz1 + 0.025);
      else KL.box(M.dark, bx0 - 0.025, y - 0.04, bz0, bx1 + 0.025, y + 0.04, bz1);
    }
    const leaf = new THREE.Group();
    dyn.add(leaf);
    const safe = d.kind === 'safe';
    const box = world.add(bx0, y0, bz0, bx1, y1, bz1, SURF.metal, safe ? FLAG_NAVIGNORE : 0, safe ? 'safeDoor' : 'blastDoor');
    const L = { d, leaf, KL, box, open: false, t: 0 };
    leaves.push(L);
    if (safe) safeLeaf = L;
    else (unlockables[d.unlock] ??= []).push(L);
    // beacons either side (red; the safe door's amber), a glow on the wall
    const mat = new THREE.MeshBasicMaterial({ color: safe ? new THREE.Color(0.6, 0.35, 0.05) : new THREE.Color(0.5, 0.05, 0.04) });
    const hw = (d.alongX ? d.x1 - d.x0 : d.z1 - d.z0) / 2 + 0.35;
    const spots = d.alongX ? [[d.cx - hw, d.z0 - 0.08], [d.cx + hw, d.z0 - 0.08], [d.cx - hw, d.z1 + 0.08], [d.cx + hw, d.z1 + 0.08]] : [[d.x0 - 0.08, d.cz - hw], [d.x0 - 0.08, d.cz + hw], [d.x1 + 0.08, d.cz - hw], [d.x1 + 0.08, d.cz + hw]];
    for (const [x, z] of spots) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      m.position.set(x, y1 + 0.12, z);
      m.rotation.x = Math.PI;
      dyn.add(m);
    }
    beacons.push({ d, mat, L });
    c.light(d.cx, y1 + 0.1, d.cz, 0.18, 1.6, safe ? [1, 0.6, 0.15] : RED, null, 4);
  }

  // ------------------------------------------------ vents (spawnAt): grates at the foot of walls
  const ventGeo = (() => {
    const parts = [new THREE.BoxGeometry(0.72, 0.05, 0.04).translate(0, 0.2, 0), new THREE.BoxGeometry(0.72, 0.05, 0.04).translate(0, -0.2, 0), new THREE.BoxGeometry(0.05, 0.45, 0.04).translate(-0.34, 0, 0), new THREE.BoxGeometry(0.05, 0.45, 0.04).translate(0.34, 0, 0)];
    for (let k = 0; k < 6; k++) parts.push(new THREE.BoxGeometry(0.02, 0.36, 0.025).translate(-0.25 + k * 0.1, 0, 0));
    return mergeGeos(parts);
  })();
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x4a5056, metalness: 0.6, roughness: 0.45 });
  const holeMat = new THREE.MeshBasicMaterial({ color: 0x050607 });
  const vents = [];
  for (const v of VENTS) {
    const f = FLOORS[v.level];
    const yaw = P.FACE_YAW[v.face];
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    // on a wall: solid behind the spot, open in front of it
    if (openAt(plan.at(v.x - fx * 0.15, v.z - fz * 0.15), f + 0.3) || !openAt(plan.at(v.x + fx * 0.3, v.z + fz * 0.3), f + 0.3)) continue;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.4), holeMat);
    hole.position.set(v.x + fx * 0.004, f + 0.3, v.z + fz * 0.004);
    hole.rotation.y = yaw;
    dyn.add(hole);
    const grate = new THREE.Mesh(ventGeo, ventMat);
    grate.position.set(v.x + fx * 0.025, f + 0.3, v.z + fz * 0.025);
    grate.rotation.y = yaw;
    grate.castShadow = true;
    dyn.add(grate);
    vents.push({ ...v, f, fx, fz, grate, home: grate.position.clone(), yaw, burst: false, fly: null, usedT: -1e9 });
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
  // rooms behind walls are not drawn (hiveCull.js): the plan seen from above, any floor open, the other builds' insides
  // (the lab, the basement) open too; a probe that renders nothing hands the culler the camera
  const flatOpen = new Uint8Array(NX * NZ);
  for (let cell = 0; cell < NX * NZ; cell++) flatOpen[cell] = sc[cell] > 0 || ext[cell] ? 1 : 0;
  const culler = makeCuller(group, { open: flatOpen, NX, NZ, PX0, PZ0, C });
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    const probe = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    probe.frustumCulled = false;
    probe.onBeforeRender = (renderer, scene, camera) => culler.update(camera.position);
    group.add(probe);
  }

  // ------------------------------------------------ gameplay data
  // where the infected come from: every open space but the atrium, the safe zone, the stairs, the decks, the sealed
  // labs, the shaft; clear of furniture; each point knows its side (spawn sectors) and when it opens
  const allSpawns = [];
  const reqSpots = [];
  const clearAt = (x, y, z) => {
    let blocked = false;
    world.query(x - 0.6, z - 0.6, x + 0.6, z + 0.6, (bx) => {
      if (bx.enabled && bx.maxY > y + 0.25 && bx.minY < y + 1.8) return (blocked = true);
    });
    return !blocked;
  };
  for (const s of SPACES) {
    if (s.zone === 'hub' || s.zone === 'safe' || s.deck || s.sealed || s.kind === 'stair' || s.noSpawn) continue;
    const f = floorOf(s);
    for (let x = s.x0 + 1.1; x < s.x1 - 1.0; x += 2.4) {
      for (let z = s.z0 + 1.1; z < s.z1 - 1.0; z += 2.4) {
        const px = x + (rnd() - 0.5) * 0.8, pz = z + (rnd() - 0.5) * 0.8;
        if (!clearAt(px, f, pz) || !openAt(plan.at(px, pz), f + 1)) continue;
        allSpawns.push({ p: V(px, f, pz), sector: s.sector, zone: s.zone });
        if (REQUEST_KINDS.has(s.kind)) reqSpots.push({ p: V(px, f, pz), zone: s.zone, sector: s.sector, name: s.name ?? s.id });
      }
    }
  }
  const spawnPoints = allSpawns.map((s) => s.p);
  const defensePosts = [
    { pos: V(0, 0, 6.4), face: 0, level: 1 },
    { pos: V(-4.8, 0, 1.2), face: -Math.PI / 2, level: 1 },
    { pos: V(4.8, 0, -1.2), face: Math.PI / 2, level: 1 },
    { pos: V(2.8, 0, -6.4), face: Math.PI, level: 1 },
    { pos: V(-5.6, 0, -6.4), face: -Math.PI * 0.75, level: 1 },
    { pos: V(5.4, 0, 6.6), face: Math.PI * 0.4, level: 1 },
    { pos: V(-3.4, 0, 6.4), face: -Math.PI / 2, level: 1 },
  ];
  const specialSpots = {
    goldenPunisher: { pos: V(-13, 0.98, -23), where: 'in the specimen hall', requires: 'north' },
    chaingun: { pos: V(4.9, 0.8, -16.2), where: 'in the server room', requires: 'north' },
    l96a1: { pos: V(-6, 0.25, 51.2), where: 'on the pump hall’s catwalk', requires: 'deep' },
    m32: { pos: V(20, 1.0, 16.95), where: 'on the cafeteria counter' },
  };
  const navBlocks = [
    { level: 0, rect: [SAFE.x0, SAFE.x1, SAFE.z0, SAFE.z1] },
    { level: 1, rect: [SAFE.x0, SAFE.x1, SAFE.z0, SAFE.z1] },
    // (the flooded labs: behind glass, nobody's ground; the wreck in the shaft)
    ...SPACES.filter((s) => s.sealed).map((s) => ({ level: s.level, rect: [s.x0, s.x1, s.z0, s.z1] })),
    { level: 0, rect: [-35, -33.55, 14, 17] },
  ];
  const portals = [];
  for (const s of STAIRS) {
    navBlocks.push({ level: s.lo, rect: [s.x0 - 0.05, s.x1 + 0.05, Math.min(s.z0, s.z1) - 0.05, Math.max(s.z0, s.z1) + 0.05] });
    navBlocks.push({ level: s.hi, rect: [s.x0 - 0.05, s.x1 + 0.05, Math.min(s.z0, s.z1) - 0.05, Math.max(s.z0, s.z1) + 0.05] });
    portals.push({ id: s.id, a: { level: s.lo, x: s.a[0], z: s.a[1] }, b: { level: s.hi, x: s.b[0], z: s.b[1] }, cost: 8, enabled: !!s.always, always: !!s.always, path: [s.a, s.b] });
  }
  for (const d of DROPS) portals.push({ id: d.id, a: { level: 2, x: d.a[0], z: d.a[1] }, b: { level: 1, x: d.b[0], z: d.b[1] }, cost: 3, enabled: true, always: true, oneway: true, drop: true, path: [d.a, d.b] });
  portals.push({ id: SHAFT_LADDER.id, ladder: SHAFT_LADDER, a: { level: 0, x: -33.3, z: SHAFT_LADDER.z }, b: { level: 2, x: -30.9, z: SHAFT_LADDER.z }, cost: 9, enabled: true, always: true, path: [[-33.3, SHAFT_LADDER.z], [-30.9, SHAFT_LADDER.z]] });

  // the gas: other rooms every round, a leak mid-round, now and then a corner of the atrium (gasZones below)
  const gasZones = [];
  for (const s of SPACES) {
    if (s.zone === 'safe' || s.deck || s.sealed || s.kind === 'stair' || s.kind === 'shaft') continue;
    const f = floorOf(s);
    if (s.kind === 'hub') {
      for (const [x0, z0, x1, z1, q] of [[-10, -10, 0, 0, 'north-west'], [0, -10, 10, 0, 'north-east'], [-10, 0, 0, 10, 'south-west'], [0, 0, 10, 10, 'south-east']]) gasZones.push({ name: `the atrium’s ${q} corner`, level: 1, y0: f, x0, z0, x1, z1, zone: 'hub', hub: true, k: 0, goal: 0, emit: 0 });
      continue;
    }
    const w = s.x1 - s.x0, d = s.z1 - s.z0;
    const nx = Math.max(1, Math.round(w / 12)), nz = Math.max(1, Math.round(d / 12));
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) gasZones.push({ name: s.name ?? s.id, level: s.level, y0: f, x0: s.x0 + (w * a) / nx, x1: s.x0 + (w * (a + 1)) / nx, z0: s.z0 + (d * b) / nz, z1: s.z0 + (d * (b + 1)) / nz, zone: s.zone, sector: s.sector, k: 0, goal: 0, emit: 0 });
  }

  // ------------------------------------------------ Nadja's requests: the case she sends you for
  const caseObj = new THREE.Group();
  {
    const shell = new THREE.MeshStandardMaterial({ color: 0x2a3036, metalness: 0.5, roughness: 0.4 });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd9a916, roughness: 0.5 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.34), shell);
    body.position.y = 0.1;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.505, 0.04, 0.345), trim);
    band.position.y = 0.12;
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 14, Math.PI), shell);
    handle.position.set(0, 0.2, 0);
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3.4, 0.8) }));
    led.position.set(0.18, 0.15, 0.172);
    caseObj.add(body, band, handle, led);
    // a beam of light up from it, so it's found across a room
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.28, 3.2, 12, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.1, 0.5), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    beam.position.y = 1.7;
    caseObj.add(beam);
    caseObj.visible = false;
    dyn.add(caseObj);
  }
  const request = { active: false, carried: false, spot: null, def: null, t: 0, due: Infinity, count: 0 };

  // ------------------------------------------------ runtime
  let game = null;
  let time = 0;
  let gasFx = null;
  let leakAt = Infinity, roundT = 0;
  let ventNext = 0, burst = null;
  const openZone = (zone) => zone === 'start' || zone === 'hub' || !!game?.unlocked?.[zone];
  const nearest = (p) => {
    let d = Infinity;
    for (const m of game?.team ?? []) if (m.alive) d = Math.min(d, m.pos.distanceTo(p));
    return d;
  };
  const gasBanner = (title, zones) => {
    const names = [...new Set(zones.map((z) => z.name))].slice(0, 3);
    if (names.length) game?.hud?.banner(title, `${names.join(' · ')} · a mask, or stay out`, 3.2, 'danger');
  };
  /** a new request from Nadja: somewhere open, far from the hatch, often up on level 5 or down in sublevel 5 */
  const newRequest = () => {
    const pool = [];
    for (const s of reqSpots) {
      if (!openZone(s.zone) || s.p.distanceTo(HATCH) < 22) continue;
      const w = s.sector === 'upper' || s.sector === 'deep' ? 3 : s.sector === 'ring' || s.sector === 'north' ? 2 : 1;
      for (let k = 0; k < w; k++) pool.push(s);
    }
    if (!pool.length) return;
    const s = pool[Math.floor(Math.random() * pool.length)];
    request.active = true;
    request.carried = false;
    request.spot = s;
    request.def = REQUESTS[request.count++ % REQUESTS.length];
    caseObj.position.copy(s.p);
    caseObj.visible = true;
    game?.audio?.play('radio_on', { volume: 0.7 });
    game?.hud?.banner(`NADJA NEEDS ${request.def.name}`, `In ${s.name} · bring it to the sample hatch by the lab door`, 4, 'normal');
  };
  const dropCase = (p) => {
    request.carried = false;
    caseObj.position.set(p.x, Math.max(FLOORS[0], p.y), p.z);
    caseObj.visible = true;
  };
  const updateRequest = (dt) => {
    if (!request.active || !game) return;
    const pl = game.player;
    if (!request.carried) {
      caseObj.rotation.y += dt * 0.8;
      caseObj.children[4].material.opacity = 0.12 + 0.06 * Math.sin(time * 3);
      if (pl?.alive && pl.pos.distanceTo(caseObj.position) < 1.3) {
        request.carried = true;
        caseObj.visible = false;
        game.audio?.play('pickup_weapon', { volume: 0.8 });
        game.hud?.banner(`GOT ${request.def.name}`, 'Bring it to the sample hatch by the lab door (south side of the atrium)', 2.8, 'success');
      }
      return;
    }
    if (!pl?.alive) {
      dropCase(pl.pos);
      return;
    }
    if (Math.hypot(pl.pos.x - HATCH.x, pl.pos.z - (HATCH.z - 0.6)) < 1.8 && Math.abs(pl.pos.y) < 1) {
      // delivered: cash for everyone, xp, a supply box out of the hatch, Nadja's thanks
      request.active = false;
      request.carried = false;
      const round = Math.max(1, game.round);
      const cash = 300 + 60 * round;
      game.economy?.payAll(cash, 'nadja');
      game._career?.(Progress.objective(80 + 10 * round));
      game.pickups?.spawnSupply(Math.random() < 0.5 ? 'red' : 'green', V(HATCH.x - 1.2, 0.1, HATCH.z - 1.6), { life: 90 });
      game.audio?.play('crate_land', { position: HATCH, volume: 0.9 });
      game.audio?.play('radio_off', { volume: 0.7 });
      game.hud?.banner('NADJA: ' + request.def.thanks, `+$${cash} for everyone · a supply box out of the hatch`, 3.6, 'success');
    }
  };
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
      const moving = b.L === safeLeaf ? b.L.t > 0 && b.L.t < 1 : (unlockables[b.d.unlock] ?? []).some((L) => L.t > 0 && L.t < 1);
      const k = moving ? (Math.sin(time * 9) > 0 ? 1 : 0.15) : 0.35 + 0.15 * Math.sin(time * 1.3);
      if (b.L === safeLeaf) b.mat.color.setRGB(3.2 * k, 1.8 * k, 0.25 * k);
      else b.mat.color.setRGB(4 * k, 0.35 * k, 0.25 * k);
    }
    // vents knocked out: the grate flies, then lies
    for (const v of vents) {
      const fl = v.fly;
      if (!fl) continue;
      fl.vy -= 9.8 * dt;
      v.grate.position.x += fl.vx * dt;
      v.grate.position.y += fl.vy * dt;
      v.grate.position.z += fl.vz * dt;
      v.grate.rotation.x += fl.spin * dt;
      if (v.grate.position.y <= v.f + 0.03) {
        v.grate.position.y = v.f + 0.03;
        v.grate.rotation.set(-Math.PI / 2, v.yaw + fl.turn, 0);
        v.fly = null;
      }
    }
    if (!game) return;
    // Nadja's lab: drawn (and she works) while you're in or near it
    const cam = game.camera?.position;
    if (cam) farmLab.forceVisible = cam.x > -15 && cam.x < 12 && cam.z > 6 && cam.z < 37 && cam.y < 3.4;
    updateRequest(dt);
    // the gas: fading in / out, puffs where it hangs (near the camera only), a leak's clock
    const inRound = game.state === 'combat';
    if (inRound) roundT += dt;
    if (inRound && roundT >= leakAt) {
      leakAt = Infinity;
      const pp = game.player?.pos;
      const cands = gasZones.filter((z) => !z.hub && z.goal === 0 && openZone(z.zone) && pp && Math.abs(z.y0 - pp.y) < 2 && Math.hypot((z.x0 + z.x1) / 2 - pp.x, (z.z0 + z.z1) / 2 - pp.z) < 28 && Math.hypot((z.x0 + z.x1) / 2 - pp.x, (z.z0 + z.z1) / 2 - pp.z) > 6);
      const z = cands[Math.floor(Math.random() * cands.length)];
      if (z) {
        z.goal = 1;
        z.leak = true;
        z.until = time + rand(35, 65);
        gasBanner('GAS LEAK', [z]);
        const at3 = V((z.x0 + z.x1) / 2, z.y0 + 2.2, (z.z0 + z.z1) / 2);
        game.audio?.play('acid_hiss', { position: at3, volume: 1 });
        setTimeout(() => game?.audio?.play('acid_hiss', { position: at3, volume: 0.9 }), 900);
        setTimeout(() => game?.audio?.play('power_zap', { position: at3, volume: 0.6 }), 400);
      }
    }
    for (const z of gasZones) {
      if (z.leak && time > z.until) {
        z.goal = 0;
        z.leak = false;
      }
      if (z.k !== z.goal) z.k = THREE.MathUtils.clamp(z.k + (z.goal - z.k) * Math.min(1, dt * 0.55) + Math.sign(z.goal - z.k) * dt * 0.02, 0, 1);
      if (z.k < 0.02 || !gasFx || !cam) continue;
      const cx = (z.x0 + z.x1) / 2, cz = (z.z0 + z.z1) / 2;
      if (Math.hypot(cx - cam.x, cz - cam.z) > 42 || Math.abs(z.y0 - cam.y) > 6) continue;
      // (a thick layer on the floor, thinner billows up to head height: you see it from afar, and over it up close)
      const area = Math.min(90, (z.x1 - z.x0) * (z.z1 - z.z0));
      z.emit += dt * area * 0.28 * z.k;
      while (z.emit >= 1) {
        z.emit -= 1;
        const low = Math.random() < 0.6;
        gasFx.emit(z.x0 + Math.random() * (z.x1 - z.x0), z.y0 + (low ? 0.1 + Math.random() * 0.5 : 0.6 + Math.random() * 1.4), z.z0 + Math.random() * (z.z1 - z.z0), rand(-0.25, 0.25), rand(-0.01, 0.05), rand(-0.25, 0.25), {
          life: rand(4, 6.5),
          size: low ? rand(2.4, 3.6) : rand(1.8, 2.8),
          grow: 1.3,
          drag: 0.8,
          gravity: 0,
          color: [0.44, 0.86, 0.1],
          alpha: (low ? 0.5 : 0.32) * z.k,
          fadeIn: 0.4,
        });
      }
    }
    for (const u of updates) u(dt, time);
  };
  /** unlock(name): the blast doors that belong to it slide up; the nav opens there (game.js _endRound) */
  const unlock = (name, g) => {
    for (const L of unlockables[name] ?? []) {
      if (L.open) continue;
      L.open = true;
      L.box.enabled = false;
      const d = L.d;
      g?.nav?.refreshRect(d.x0 - 0.6, d.x1 + 0.6, d.z0 - 0.6, d.z1 + 0.6);
      g?.audio?.play('vault_open', { position: V(d.cx, d.f + 1.5, d.cz), volume: 1 });
    }
  };
  /** the main menu's shots run only the animations (the tank's zombie and bubbles, the flickering tubes), not the doors */
  const menuUpdate = (dt) => {
    time += dt;
    for (const u of updates) u(dt, time);
  };
  const resetDoors = (g) => {
    for (const L of leaves) {
      if (L === safeLeaf || !L.open) continue;
      L.open = false;
      L.t = 0;
      L.leaf.position.y = 0;
      L.box.enabled = true;
      const d = L.d;
      g?.nav?.refreshRect(d.x0 - 0.6, d.x1 + 0.6, d.z0 - 0.6, d.z1 + 0.6);
    }
    for (const v of vents) {
      v.burst = false;
      v.fly = null;
      v.usedT = -1e9;
      v.grate.position.copy(v.home);
      v.grate.rotation.set(0, v.yaw, 0);
    }
    for (const z of gasZones) {
      z.k = 0;
      z.goal = 0;
      z.leak = false;
    }
    leakAt = Infinity;
    burst = null;
    ventNext = 0;
    request.active = false;
    request.carried = false;
    request.count = 0;
    caseObj.visible = false;
    level.spawnPoints = spawnPoints;
  };
  /** a new round: other rooms gassed, another side the horde comes from, maybe a leak later on, Nadja's request */
  const onRoundStart = (g, round) => {
    roundT = 0;
    for (const z of gasZones) {
      z.goal = 0;
      z.leak = false;
    }
    const lit = [];
    if (round >= 2) {
      const pool = gasZones.filter((z) => !z.hub && openZone(z.zone));
      const n = Math.min(5, 1 + Math.floor(round / 4));
      for (let i = 0; i < n && pool.length; i++) {
        const z = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        z.goal = 1;
        lit.push(z);
      }
      if (round >= 3 && Math.random() < 0.4) {
        const quads = gasZones.filter((z) => z.hub);
        const z = quads[Math.floor(Math.random() * quads.length)];
        z.goal = 1;
        lit.unshift(z);
      }
    }
    if (lit.length) setTimeout(() => gasBanner('TOXIC GAS', lit), 2600);
    leakAt = round >= 3 && Math.random() < 0.5 ? rand(15, 55) : Infinity;
    // the side(s) the horde comes from this round: every open side gets the same share of the points (a big side
    // like sublevel 5 doesn't swamp the rest), drawn anew each round; the hot side(s) three shares
    const bySector = new Map();
    for (const s of allSpawns) if (openZone(s.zone)) (bySector.get(s.sector) ?? bySector.set(s.sector, []).get(s.sector)).push(s.p);
    const sectors = [...bySector.keys()];
    const hot = new Set();
    for (let i = 0; i < (round >= 8 ? 2 : 1) && sectors.length; i++) hot.add(sectors.splice(Math.floor(Math.random() * sectors.length), 1)[0]);
    const pts = [];
    for (const [sec, list] of bySector) for (let i = 0, n = 45 * (hot.has(sec) ? 3 : 1); i < n; i++) pts.push(list[Math.floor(Math.random() * list.length)]);
    level.spawnPoints = pts.length ? pts : spawnPoints;
    ventNext = g.time + rand(5, 14);
    burst = null;
    // Nadja's request (one at a time, from round 2)
    if (round >= 2 && !request.active) setTimeout(() => game?.state === 'combat' && !request.active && newRequest(), 7000);
  };
  const onRoundEnd = () => {
    for (const z of gasZones) {
      z.goal = 0;
      z.leak = false;
    }
    leakAt = Infinity;
    burst = null;
    // her request lasts the round it came in (what you carry you may still bring in the buy phase)
    if (request.active && !request.carried) {
      request.active = false;
      caseObj.visible = false;
      game?.hud?.banner('NADJA: Too late. Forget it.', 'Her requests only keep while the round lasts', 2.6, 'normal');
    }
  };
  /**
   * game.js _spawnOne: now and then a vent near the fireteam bursts open (the grate flies off with a clang) and a
   * few of the wave crawl out of it; null: spawn as usual.
   */
  const spawnAt = (g, type) => {
    if (!VENT_TYPES.has(type) || g.round < 2) return null;
    if (burst && burst.n > 0 && g.time - burst.t < 8) {
      burst.n--;
      return burst.pos.clone();
    }
    burst = null;
    if (g.time < ventNext) return null;
    ventNext = g.time + rand(12, 26);
    const cam = g.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    let best = null, bs = -Infinity;
    for (const v of vents) {
      if (!openZone(v.zone)) continue;
      const pos = V(v.x + v.fx * 0.65, v.f, v.z + v.fz * 0.65);
      const d = nearest(pos);
      if (d < 8 || d > 24) continue;
      if (!(g.nav.distanceAt(v.level, pos.x, pos.z) < 1e6)) continue;
      const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z, dl = Math.hypot(dx, dz) || 1;
      const s = -Math.abs(d - 14) - ((dx * fwd.x + dz * fwd.z) / dl) * 6 + Math.random() * 5 - (g.time - v.usedT < 60 ? 20 : 0);
      if (s > bs) {
        bs = s;
        best = { v, pos };
      }
    }
    if (!best) return null;
    const { v, pos } = best;
    v.usedT = g.time;
    const at3 = V(v.x, v.f + 0.4, v.z);
    if (!v.burst) {
      v.burst = true;
      v.fly = { vx: v.fx * rand(2.5, 4), vy: rand(1.5, 2.6), vz: v.fz * rand(2.5, 4), spin: rand(-8, 8), turn: rand(-1, 1) };
      g.audio?.play('metal_crash', { position: at3, volume: 0.9 });
    } else g.audio?.play('impact_metal', { position: at3, volume: 0.9 });
    setTimeout(() => game?.audio?.play('zombie_alert', { position: at3, volume: 1 }), 300);
    for (let i = 0; i < 12; i++) g.fx?.smoke.emit(at3.x + v.fx * 0.2, at3.y, at3.z + v.fz * 0.2, v.fx * rand(0.6, 2) + rand(-0.5, 0.5), rand(0.1, 0.8), v.fz * rand(0.6, 2) + rand(-0.5, 0.5), { life: rand(0.8, 1.6), size: rand(0.4, 0.8), grow: 1.6, drag: 2.5, gravity: 0, color: [0.42, 0.4, 0.38], alpha: 0.4 });
    burst = { pos, n: 1 + Math.floor(Math.random() * 3), t: g.time };
    return pos.clone();
  };
  const attach = (g) => {
    game = g;
    // the gas's own puffs (the smoke's texture), sized and stepped with the game's other particles (fx.systems)
    const map = g.fx?.smoke?.material?.uniforms?.uMap?.value;
    if (map && g.fx.systems) {
      gasFx = new SpriteParticles(g.scene, map, { max: 1400, additive: false, atlas: 2, renderOrder: 9 });
      g.fx.systems.push(gasFx);
    }
  };
  const inGasZone = (x, y, z) => {
    for (const gz of gasZones) {
      if (gz.k < 0.45) continue;
      if (x > gz.x0 && x < gz.x1 && z > gz.z0 && z < gz.z1 && y > gz.y0 - 0.4 && y < gz.y0 + 2.6) return true;
    }
    return false;
  };
  /** game.js: the HUD's waypoint while Nadja's request is on (the case, then the hatch) */
  const waypoint = () => {
    if (!request.active) return null;
    if (request.carried) return { pos: V(HATCH.x, 1.1, HATCH.z - 0.1), label: 'SAMPLE HATCH' };
    return { pos: caseObj.position.clone().setY(caseObj.position.y + 0.4), label: 'NADJA · ' + request.def.name.replace(/^(A|THE) /, '') };
  };
  const radarList = () => (request.active ? [request.carried ? { x: HATCH.x, z: HATCH.z, kind: 'objective' } : { x: caseObj.position.x, z: caseObj.position.z, kind: 'objective' }] : []);

  // Nadja (the farm lab's runtime, game.lab): the farm lab's own, her look targets set for the hall she works in now
  const w = farmLab.work;
  w.focus = V(3.0, -1.3, 23.2);
  w.hall = V(-1.0, -1.4, 29.5);
  w.lookZ = 9.4 + LAB_OFF.z;
  const shop = {
    custom: (scene, g) => safeZoneShop(scene, g, { leaf: () => safeLeaf, world, dyn }),
    entrance: V(8.75, 0, 8.6),
  };
  const isSheltered = () => 1;

  const level = {
    id: 'hive',
    group,
    world,
    lamps,
    windows: [],
    spawnPoints,
    spawnBand: [14, 32],
    portals,
    navBlocks,
    navOpts: { minX: PX0, maxX: PX1, minZ: PZ0, maxZ: PZ1 },
    entrances: [],
    barricadeSpots: [],
    breachSpots: [],
    radarSegments: c.radarSegs,
    specialSpots,
    generator: null,
    defensePosts,
    lab: farmLab,
    shaft: null,
    playerSpawn: V(0.5, 0, 20.3),
    playerYaw: 0, // (on Nadja's gallery, facing the window and the vault door, the basement past them)
    shop,
    unlocks: [
      {
        id: 'north', round: UPSTAIRS_ROUND, open: ['north'], portals: [], news: 'THE NORTH WING IS OPEN', sound: 'vault_unlock',
        banners: [['THE NORTH WING IS OPEN', 'The specimen hall, the server room, the isolation ward up on level 5 · a special weapon waits in there', 'danger', 3300, 3.5]],
      },
      {
        id: 'deep', round: DEEP_ROUND, open: ['deep'], portals: ['deepW', 'deepE'], news: 'SUBLEVEL 5 IS OPEN', sound: 'vault_unlock',
        banners: [['SUBLEVEL 5 IS OPEN', 'Stairs down off both wings, the elevator shaft from level 5 · the flooded wing, the pump hall · it’s darker down there', 'danger', 3300, 3.5]],
      },
      {
        id: 'ring', round: BASEMENT_ROUND, open: ['ring'], portals: [], news: 'THE OUTER RING IS OPEN', sound: 'vault_unlock',
        banners: [['CONTAINMENT FAILURE', 'The outer ring’s blast doors are up · they can come round behind you now', 'danger', 3300, 3.5]],
      },
    ],
    resetDoors,
    menuUpdate,
    culler,
    onRoundStart,
    onRoundEnd,
    spawnAt,
    attach,
    waypoint,
    radarList,
    gasZones,
    story: false,
    stalker: false, // (actors/stalker.js: it doesn't belong down here)
    landmarks: false,
    stalkerHouse: null,
    bigMap: true,
    indoor: { sky: 0x4a525c, ground: 0x56605a, hemi: 0.45 },
    events: [],
    squad: false,
    eventCenter: 'team',
    eventClear: () => false,
    powerPole: V(0, 6, 0),
    inHouse: () => false,
    drips,
    decor: {
      density: 0.16, // (the rooms carry their own grime and stories: a few of the game's splats on top)
      walls: 7,
      rooms: [
        [-38, -12, -1.6, 1.6, 0],
        [12, 38, -1.6, 1.6, 0],
        [-33, -26, -11, -4, 0],
        [13, 19, -9.5, -3, 0],
        [15, 27, 5, 11, 0],
        [-9, 9, -9, -6, 0],
        [-33, -27, -20, -13, 0], // the rooms behind the labs and the offices
        [-25, -19, -20, -13, 0],
        [-25, -19, -28, -22, 0],
        [-33, -27, -28, -22, 0],
        [17, 24, -25, -16, 0],
        [26, 33, -22, -13, 0],
        [17, 24, -14, -11, 0],
        [-17, -9, -30, -22, 0],
        [-1.6, 1.6, -34, -12, 0],
        [-5.5, 5.5, 11.5, 17.5, 0],
        [-38, -12, -1.6, 1.6, 3.45],
        [-20, 20, 41.2, 42.8, -3.2],
        [-6, 6, 57, 65, -3.2],
      ],
      pools: [[-9, 9, -9, 9, 0.02, 4], [-38, -12, -1.5, 1.5, 0.02, 3], [12, 38, -1.5, 1.5, 0.02, 3], [-5, 5, 12, 17, 0.02, 3], [-30, 30, 40.6, 43.4, -3.18, 5], [-12, 12, 53, 68, -3.18, 5]],
    },
    menuShots: {
      title: { fov: 56, period: 90, a: [7.8, 1.6, -8.2, 0, 3.2, 0], b: [5.9, 2.3, -8.6, 0, 3.4, 0] },
      porch: { fov: 58, period: 70, a: [-11.4, 1.6, 0.8, -40, 1.5, 0], b: [-11.8, 1.7, -0.9, -40, 1.6, 0] },
      interior: { fov: 60, period: 80, a: [-30, -1.7, 41.2, 30, -1.8, 42.6], b: [-26, -1.6, 42.6, 34, -1.8, 41.2] },
      lobby: {
        fov: 40,
        period: 60,
        fog: 0.1,
        hemi: 0.9,
        moon: 0,
        torch: 1.15,
        a: [0, 1.5, 8.9, 0, 1.25, -1],
        b: [0.3, 1.55, 8.6, 0, 1.25, -1],
        cast: { spots: [[-1.35, 4.6, 0.22], [-0.45, 4.6, 0.08], [0.45, 4.6, -0.08], [1.35, 4.6, -0.22]] },
      },
    },
    unlock,
    update,
    isSheltered,
    inGasZone,
    ladders: [SHAFT_LADDER],
    barn: null,
    levelOf,
    FLOOR,
  };
  return level;
}

function mergeGeos(list) {
  const pos = [], nor = [], idx = [];
  let base = 0;
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    const p = ng.attributes.position, n = ng.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      idx.push(base + i);
    }
    base += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

// ---------------------------------------------------------------- the farm's basement
/**
 * The farm's basement (world/level.js) behind the lab's vault door, as part one left it: its south half with the
 * farm's own LevelBuilder, materials and props (the dead generator, the shelves, the workbench, the boarded cellar
 * door, a flickering bulb), cut off at the north where the house above came down (rubble to the ceiling). `off`: the
 * lab's offset (the basement stands where it stood beside the lab).
 */
function buildBasement(world, lamps, off) {
  const B = new LevelBuilder(world);
  const X = (x) => x + off.x, Y = (y) => y + off.y, Zf = (z) => z + off.z;
  const FB = -3.2, BC = -0.25; // (the farm's basement floor and ceiling)
  const rnd = mulberry(1977);
  const prop = (type, x, y, z, rot = 0, o = {}, place = {}) => {
    let p = null;
    try {
      p = buildProp(type, { seed: Math.floor(rnd() * 1e5), ...o });
    } catch (e) {
      return null;
    }
    if (!p) return null;
    B.placeProp(p, X(x), Y(y), Zf(z), rot, place);
    return p;
  };
  const wo = { mat: 'concrete', surface: SURF.concrete, floorY: Y(FB), ceilY: Y(BC), jamb: 'concrete' };
  // floor, ceiling (the house's ground floor slab), walls: the lab's (its door and window), the east with the coal
  // tunnel's mouth, the west with the boarded cellar door, the cut wall at the north
  B.box(X(-12), Y(FB - 0.3), Zf(-4.3), X(2.55), Y(FB), Zf(3.85), { mat: 'concrete', surface: SURF.concrete, grime: 0 });
  B.box(X(-12), Y(BC), Zf(-4.3), X(2.55), Y(0), Zf(3.85), { mats: { ny: 'ceilingBoards' }, mat: 'woodBeam', skip: ['py'], surface: SURF.wood, grime: 0 });
  B.wall('x', Zf(4), X(-12), X(2.55), Y(FB), Y(0), 0.3, LAB_OPENINGS.map((o) => ({ a: X(o.a), b: X(o.b), y0: Y(o.y0), y1: Y(o.y1) })), wo);
  B.wall('z', X(2.4), Zf(-4.3), Zf(3.85), Y(FB), Y(0), 0.3, [{ a: Zf(2.3), b: Zf(3.6), y0: Y(FB), y1: Y(FB + 2.05) }], wo);
  B.wall('z', X(-11.85), Zf(-4.3), Zf(3.85), Y(FB), Y(0), 0.3, [{ a: Zf(-3.0), b: Zf(-1.6), y0: Y(FB), y1: Y(FB + 2.6) }], wo);
  B.wall('x', Zf(-4.15), X(-12), X(2.55), Y(FB), Y(0), 0.3, [], wo);
  // pockets behind the two openings: the coal tunnel (caved in: rubble heaped in its mouth, the lab corridor right
  // behind it) and the outside stairwell
  B.box(X(2.55), Y(FB), Zf(2.1), X(2.68), Y(FB + 2.3), Zf(3.8), { mat: 'concrete', surface: SURF.concrete });
  world.add(X(1.95), Y(FB), Zf(2.3), X(2.55), Y(FB + 1.3), Zf(3.6), SURF.concrete);
  B.box(X(-12.6), Y(FB), Zf(-3.1), X(-12.0), Y(FB + 2.7), Zf(-1.5), { mat: 'concrete', surface: SURF.concrete });
  // pillars, beams, joists
  for (const [px, pz] of [[-7, -2.8], [-3, -2.8], [-7, 1.4], [-3, 1.4]]) B.box(X(px - 0.2), Y(FB), Zf(pz - 0.2), X(px + 0.2), Y(BC), Zf(pz + 0.2), { mat: 'concrete', surface: SURF.concrete, floorY: Y(FB), ceilY: Y(BC) });
  for (const bz of [-1.0, 2.2]) B.box(X(-11.7), Y(BC - 0.3), Zf(bz - 0.13), X(2.25), Y(BC), Zf(bz + 0.13), { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
  for (let jx = -11.2; jx < 2.2; jx += 1.1) B.box(X(jx - 0.05), Y(BC - 0.18), Zf(-4.0), X(jx + 0.05), Y(BC), Zf(3.85), { mat: 'woodBeam', surface: SURF.wood, grime: 0 });
  // the farm's things, where they stood
  prop('generator', -10.0, FB, 2.95, Math.PI + 0.1, {}, { surface: SURF.metal });
  prop('shelfUnit', 1.8, FB, -1.5, -Math.PI / 2);
  prop('shelfUnit', -11.2, FB, 0.4, Math.PI / 2);
  prop('workbench', 1.9, FB, 1.3, -Math.PI / 2);
  prop('lantern', 1.95, FB + 0.92, 1.6, 0, {}, { collide: false });
  prop('cardboardStack', -8.3, FB, 3.35, 0.3);
  prop('barrel', -10.9, FB, -3.3, 0);
  prop('barrel', -10.2, FB, -3.7, 0);
  prop('crate', 1.3, FB, -3.5, 0.2);
  // the boarded cellar door (the planks the fireteam nailed up)
  try {
    const bw = buildProp('boardedWindow', { w: 1.4, h: 2.6, seed: 99 });
    bw.object.rotation.y = Math.PI / 2;
    bw.object.position.set(X(-11.72), Y(FB + 1.3), Zf(-2.3));
    B.staticGroup.add(bw.object);
  } catch (e) {
    /* no planks: the pocket behind is dark */
  }
  world.add(X(-12.0), Y(FB), Zf(-3.0), X(-11.7), Y(FB + 2.6), Zf(-1.6), SURF.wood);
  // the collapse at the north: concrete chunks and a broken beam against the cut wall, rubble in the coal tunnel
  const conc = B.bucket('concrete').material;
  const chunk = (x, y, z, s, r) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s[0], s[1], s[2]), conc);
    m.position.set(X(x), Y(y), Zf(z));
    m.rotation.set(r[0], r[1], r[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    B.staticGroup.add(m);
  };
  for (let i = 0; i < 26; i++) {
    const x = -11.5 + rnd() * 13.5, h = 0.3 + rnd() * 0.9;
    chunk(x, FB + h * 0.4 + rnd() * 1.4 * Math.max(0, 1 - Math.abs(x + 5) / 9), -3.7 + rnd() * 0.9, [0.4 + rnd() * 0.9, h, 0.4 + rnd() * 0.7], [rnd() * 0.6, rnd() * 3, rnd() * 0.6]);
  }
  // (kept west of x 2.45: the lab corridor is right behind that wall)
  for (let i = 0; i < 9; i++) chunk(1.75 + rnd() * 0.35, FB + 0.2 + rnd() * 1.5 * (1 - i / 12), 2.45 + rnd() * 1.0, [0.45, 0.35 + rnd() * 0.3, 0.4], [rnd() * 0.5, rnd() * 3, rnd() * 0.5]);
  const beamM = B.bucket('woodBeam').material;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.26, 0.26), beamM);
  beam.position.set(X(-6.5), Y(FB + 1.2), Zf(-3.3));
  beam.rotation.set(0, 0.12, -0.38);
  beam.castShadow = true;
  B.staticGroup.add(beam);
  world.add(X(-12), Y(FB), Zf(-4.0), X(2.4), Y(FB + 1.2), Zf(-3.0), SURF.concrete);
  // a bulb on its cable, flickering (the farm's hanging lamp), and a dim one in the far corner
  const lamp = (x, z, o = {}) => {
    const p = prop('hangingLamp', x, BC, z, rnd() * Math.PI, { cableLength: 0.35 }, { collide: false });
    const bulb = p?.anchors?.bulb ? p.anchors.bulb.clone().applyMatrix4(p.object.matrixWorld) : V(X(x), Y(BC - 0.47), Zf(z));
    lamps.push({ pos: bulb, level: 1, ceil: Y(BC), color: 0xffb46b, intensity: (o.intensity ?? 22) * 2.3, angle: 1.2, distance: 12, flicker: o.flicker ?? 0, spot: true, room: (q) => q.x > X(-12.2) && q.x < X(2.7) && q.z > Zf(-4.4) && q.z < Zf(4.3) && q.y < Y(0) + 0.2 });
  };
  lamp(-4.6, 0.4, { flicker: 0.5 });
  lamp(-9.0, -2.0, { intensity: 12 });
  lamp(0.2, 1.8, { intensity: 18 });
  return B.finish();
}

// ---------------------------------------------------------------- baked light
/**
 * Per-vertex light from the panels (the farm lab's model, world/lab.js makeBaker): Lambertian panels with a soft wrap,
 * a 1 / (1 + d²/r²) falloff faded out to zero at `range`, a small hemispherical ambient, and nothing through walls or
 * floors: a light only reaches a vertex it can see through the open columns (makePlan clear3).
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
    const Pa = geo.attributes.position.array, Na = geo.attributes.normal.array;
    const n = Pa.length / 3;
    const out = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) {
      const px = Pa[v * 3], py = Pa[v * 3 + 1], pz = Pa[v * 3 + 2];
      const nx = Na[v * 3], ny = Na[v * 3 + 1], nz = Na[v * 3 + 2];
      const up = ny > 0 ? ny : 0, down = ny < 0 ? -ny : 0;
      let r = 0.035 + 0.015 * up + 0.04 * down, g = r * 1.02, b = r * 1.07;
      if (py < -0.6) {
        // sublevel 5: darker still
        r *= 0.6;
        g *= 0.62;
        b *= 0.66;
      }
      const bi = Math.floor((px - PX0) / B), bj = Math.floor((pz - PZ0) / B);
      const list = bi >= 0 && bj >= 0 && bi < bnx && bj < bnz ? buckets[bj * bnx + bi] : [];
      const sx = px + nx * 0.15, sy = py + ny * 0.15, sz = pz + nz * 0.15;
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
        if (d > 0.6 && !plan.clear3(sx, sy, sz, L.x, L.y, L.z)) continue;
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

// ---------------------------------------------------------------- Nadja's lab as the gun shop
/**
 * game.gunshop for the Hive: the safe door between the atrium and the lab corridor slides up in the buy phase (and for
 * the first countdown: the fireteam starts in Nadja's lab) and down when a round starts; evacuate() puts anyone still
 * inside (the player, a bot) out in the atrium before it. The armory's clerk works her counter past the lab's far
 * door; the store opens there (tap F).
 */
function safeZoneShop(scene, game, { leaf, world, dyn }) {
  const keeper = createShopkeeper(scene, {
    pos: KEEPER,
    yaw: Math.PI / 2,
    counter: { edge: COUNTER.x0, top: COUNTER.top },
    glances: [V(-9.5, ARMORY_F + 1.4, 30), V(-8.5, ARMORY_F + 1.2, 33.5), V(-10.5, ARMORY_F + 1.6, 31.5), V(-7.6, ARMORY_F + 1.5, 32.2)],
  });
  if (keeper) world.add(KEEPER.x - 0.22, ARMORY_F, KEEPER.z - 0.26, COUNTER.x0, ARMORY_F + 1.75, KEEPER.z + 0.26, SURF.flesh, FLAG_NAVIGNORE, 'shopkeeper');
  // the guns on the pegboard behind her (the store's own models)
  for (const [i, id] of ['m4a1', 'ak47', 'spas12', 'p90', 'awm', 'mg42'].entries()) {
    if (!WEAPONS[id]) continue;
    try {
      const m = buildWeaponModel(WEAPONS[id].model).root;
      m.position.set(-13.36, ARMORY_F + 1.35 + (i % 3) * 0.55, 29.6 + Math.floor(i / 3) * 2.6 + (i % 3) * 0.2);
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
  const inArmory = (p) => p.x > -13.5 && p.x < -7.4 && p.z > 28 && p.z < 35 && p.y < -1.5;
  const outside = V(8.75, 0, 8.6), counter = V(-11.2, ARMORY_F, 31.5);
  const shop = {
    root: dyn,
    keeper,
    /** where the buy phase's GUN SHOP marker points: the safe door, then (inside) the armory's counter */
    get entrance() {
      const p = game.player?.pos;
      return p && inSafe(p) ? counter : outside;
    },
    get isOpen() {
      return open;
    },
    /** in the armory, at the counter, while it's open */
    canInteract(player) {
      return open && !!player?.alive && inArmory(player.pos) && player.pos.x > COUNTER.x1 - 0.1 && player.pos.distanceTo(KEEPER) < 3.4;
    },
    setOpen(v) {
      // (the run's first countdown: the fireteam starts in Nadja's lab and walks out)
      open = !!v || (game.round === 0 && game.state === 'intermission');
      const L = leaf();
      if (L) {
        L.open = open;
        L.box.enabled = !open;
      }
    },
    evacuate(p) {
      if (!p?.pos || !inSafe(p.pos)) return false;
      const k = p.isPlayer ? 0 : 1 + Math.max(0, game.bots.indexOf(p));
      p.pos.set(8.2 - (k % 2) * 1.4, 0, 8.4 - Math.floor(k / 2) % 3 * 1.2);
      p.body?.vel?.set(0, 0, 0);
      p.vel?.set?.(0, 0, 0);
      return true;
    },
    update(dt) {
      if (keeper) {
        const cam = game?.camera?.position;
        const active = !!cam && cam.x < -6.8 && cam.z > 27 && cam.z < 36 && cam.y < 0;
        keeper.root.visible = active;
        if (active) {
          const p = game.player;
          const buy = game.state === 'shop' && p?.alive;
          const near = buy && inArmory(p.pos) && p.pos.distanceTo(KEEPER) < 6;
          const engaged = !!buy && (!!game.shopOpen || (near && shop.canInteract(p)));
          keeper.update(dt, { cam: cam.clone(), engaged, storeOpen: !!game.shopOpen });
        }
      }
    },
  };
  shop.setOpen(false);
  return shop;
}
