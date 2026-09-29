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
import { Kit, bakeMat, glow, panelTex, floorTex, ceilTex, hazardCanvas, texOf, canvas, mulberry, SCREEN, screenCanvas, signCanvas, buildNadjaStation, offsetStation } from './lab.js';
import { levelOf, FLOOR } from './level.js';
import { UPSTAIRS_ROUND, BASEMENT_ROUND } from '../game/modes.js';
import { createShopkeeper } from '../actors/shopkeeper.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { WEAPONS } from '../player/weaponDefs.js';
import * as P from './hiveProps.js';

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
    wall: bakeMat({ map: panelTex(), roughness: 0.6 }, true),
    floor: bakeMat({ map: floorTex(), roughness: 0.34, envMapIntensity: 0.8 }),
    ceil: bakeMat({ map: ceilTex(), roughness: 0.9 }, true),
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
    ledG: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 3.2, 0.6) }),
    ledA: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.2) }),
    ledB: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 3.4) }),
    ledR: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.6, 0.25, 0.2) }),
    vend: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.4, 1.2) }),
    beacon: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.05, 0.04) }),
    neon: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.5, 0.35) }),
  };
  const liquids = [U.blue, U.green, U.amber, U.magenta, U.cyan];

  // ------------------------------------------------ the build context (hiveProps.js)
  const lights = [];
  const updates = [];
  const c = {
    K,
    M,
    U,
    rnd,
    col: (x0, y0, z0, x1, y1, z1, surf = SURF.metal, flags = 0, tag = null) => world.add(x0, y0, z0, x1, y1, z1, surf, flags, tag),
    light: (x, y, z, i, r, rgb = COOL, dir = null, range = null) => lights.push({ x, y, z, i, r, c: rgb, dir, range: range ?? r * 3.4 }),
    lamp: (o) => lamps.push({ level: 1, color: 0xdde6ff, intensity: 26, angle: 1.15, distance: 11, flicker: 0, spot: true, fx: false, ...o }),
    screen: (x, y, z, yaw, w, h, on) => {
      const keys = Object.keys(SCREEN);
      if (on) K.plane(U.screen, w, h, x, y, z, [0, yaw, 0], SCREEN[keys[Math.floor(rnd() * keys.length)]], 1024, 512);
      else K.plane(M.black, w, h, x, y, z, [0, yaw, 0]);
    },
  };
  /** a sign from the atlas: centre (x, y, z), facing `face`, w m wide (its height follows the atlas region) */
  const sign = (key, x, y, z, face, w = null) => {
    const r = sg.rects[key];
    const ww = w ?? r[2] / 256 * 0.9;
    const hh = (ww * r[3]) / r[2];
    K.plane(M.hsigns, ww, hh, x, y, z, [0, P.FACE_YAW[face], 0], r, sg.W, sg.H);
  };
  const roomRect = (s, m = 0.6) => (p) => p.x > s.x0 - m && p.x < s.x1 + m && p.z > s.z0 - m && p.z < s.z1 + m;

  // ------------------------------------------------ the shell: floors, ceilings, walls, lintels
  const X = (i) => cellX(i), Z = (j) => cellZ(j);
  // floors (every open cell, doors too)
  for (const [i0, j0, i1, j1] of rects((cc) => (open[cc] ? 1 : 0))) K.box(M.floor, X(i0), -0.2, Z(j0), X(i1), 0, Z(j1), { faces: ['py'], seg: 1.0, mpr: 2 });
  // ceilings (by height; not over doors: the lintels close those)
  const hKey = (cc) => (open[cc] === 1 ? Math.round(SPACES[sid[cc]].h * 100) : 0);
  const ceilings = rects(hKey);
  for (const [i0, j0, i1, j1, k] of ceilings) {
    const h = k / 100;
    K.box(M.ceil, X(i0), h, Z(j0), X(i1), h + 0.25, Z(j1), { faces: ['ny'], seg: 1.2, mpr: 2.4 });
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
    office: { i: 0.5, broken: 0.22, dim: 0.2, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    conf: { i: 0.48, broken: 0.25, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    cafe: { i: 0.58, broken: 0.14, rgb: [1.0, 0.95, 0.86], lamp: 0xfff0dc },
    lockers: { i: 0.45, broken: 0.3, rgb: COOL, lamp: 0xdde6ff },
    specimen: { i: 0.7, broken: 0.15, rgb: [0.8, 1.0, 0.86], lamp: 0xc8ffd6 },
    server: { i: 0.38, broken: 0.2, rgb: BLUE, lamp: 0x9cc0ff },
    security: { i: 0.5, broken: 0.25, rgb: COOL, lamp: 0xdde6ff },
    maint: { i: 0.6, broken: 0.2, rgb: WARM, lamp: 0xffb060 },
    morgue: { i: 0.45, broken: 0.35, rgb: COLD, lamp: 0xc0d8ff },
    archive: { i: 0.42, broken: 0.3, rgb: WARM, lamp: 0xffd2a0 },
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
        P.panel(c, x, z, s.h, { len: 1.3, alongX, broken, dim, i: md.i, r: 3.0, color: md.rgb });
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
          P.panel(c, x, z, s.h, { len: 1.2, alongX: true, broken, dim, i: md.i, r: s.h > 5 ? 4.4 : 3.0, color: md.rgb });
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
    // the column: a steel plinth, a glass tube of green murk with a shape in it, a cap with pipes to the ceiling
    const R = 1.6;
    K.cyl(M.steel, 0, 0, 0, 2.3, 2.3, 0.5, 40);
    K.cyl(M.dark, 0, 0.5, 0, 2.0, 2.0, 0.08, 40);
    K.cyl(U.glass, 0, 0.58, 0, R, R, 4.2, 40, null, true);
    K.cyl(U.murk, 0, 0.58, 0, R - 0.03, R - 0.03, 3.9, 32);
    K.cyl(M.steel, 0, 4.78, 0, R + 0.2, R + 0.25, 0.5, 40);
    K.cyl(M.dark, 0, 5.28, 0, 0.9, 1.2, 0.3, 24);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      K.cyl(k % 2 ? M.steel : M.blue, Math.cos(a) * 0.7, 5.5, Math.sin(a) * 0.7, 0.09, 0.09, H - 5.5, 10);
    }
    // the specimen: a hunched giant, arms hanging, curled in the murk
    K.add(U.skin, new THREE.SphereGeometry(0.34, 14, 10), 0.15, 3.55, 0.1, null, [0.9, 1.1, 0.85]);
    K.add(U.skin, new THREE.CapsuleGeometry(0.42, 1.0, 4, 12), 0, 2.6, 0, [0.25, 0.3, 0.05]);
    for (const s of [-1, 1]) {
      K.add(U.skin, new THREE.CapsuleGeometry(0.13, 1.1, 4, 8), s * 0.52, 2.2, 0.15, [0.1, 0, s * 0.18]);
      K.add(U.skin, new THREE.CapsuleGeometry(0.16, 0.9, 4, 8), s * 0.25, 1.35, -0.05, [-0.25, 0, s * 0.08]);
    }
    for (const y of [1.2, 2.5, 3.8]) c.light(0, y, 0, 0.7, 2.6, [0.3, 1.0, 0.45], null, 9);
    world.add(-2.3, 0, -1.65, 2.3, 5.3, 1.65, SURF.glass);
    world.add(-1.65, 0, -2.3, 1.65, 5.3, 2.3, SURF.glass);
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
    // the gallery band: a ledge and dark observation windows round the walls, 4.4..5.9
    const g0 = 4.4;
    for (const [x0, z0, x1, z1] of [[-10, -10, 10, -9.7], [-10, 9.7, 10, 10], [-10, -10, -9.7, 10], [9.7, -10, 10, 10]]) {
      K.box(M.steel, x0, g0 - 0.12, z0, x1, g0, z1);
    }
    for (const [x0, z0, x1, z1, face] of [[-9, -9.99, 9, -9.97, 's'], [-9, 9.97, 9, 9.99, 'n'], [-9.99, -9, -9.97, 9, 'e'], [9.97, -9, 9.99, 9, 'w']]) {
      const n = 5;
      for (let i = 0; i < n; i++) {
        const t0 = i / n + 0.02, t1 = (i + 1) / n - 0.02;
        if (face === 's' || face === 'n') K.box(M.black, x0 + (x1 - x0) * t0, g0 + 0.3, z0, x0 + (x1 - x0) * t1, g0 + 1.4, z1);
        else K.box(M.black, x0, g0 + 0.3, z0 + (z1 - z0) * t0, x1, g0 + 1.4, z0 + (z1 - z0) * t1);
      }
    }
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
  // the west corridor: an abandoned gurney, crates, an extinguisher, a vending machine by the stores
  P.gurney(c, -24, 1.2, Math.PI / 2 + 0.2, { bag: true });
  P.crates(c, -35.5, -1.2, 0.8, 2);
  P.drum(c, -38.6, 1.3, { down: true });
  P.extinguisher(c, -16, -1.99, 's');
  P.vending(c, -21.3, 1.55, 'n');
  P.clutter(c, -30, 0, 7, 1.6);
  // the east corridor
  P.vending(c, 20.3, -1.55, 's');
  P.vending(c, 21.4, -1.55, 's', false);
  P.crates(c, 36.5, 1.1, 0.8, 1, { wood: true });
  P.gurney(c, 29.5, -0.6, -Math.PI / 2 + 0.3, { tipped: true });
  P.extinguisher(c, 26.5, 1.99, 'n');
  P.clutter(c, 18, 0, 6, 1.5);
  // the north corridor
  P.extinguisher(c, 1.99, -24, 'w');
  P.crates(c, -1.1, -31.5, 0.8, 2);
  P.clutter(c, 0, -22, 6, 1.4);
  // the ring
  P.drum(c, -42.6, -24, { down: true });
  P.crates(c, -42.3, -8, 0.8, 1);
  P.crates(c, 42.4, -30, 0.9, 2);
  P.gurney(c, 12, -38.2, Math.PI / 2, { bag: true });
  P.clutter(c, -20, -38.2, 8, 1.5);
  P.clutter(c, 30, -38.2, 6, 1.5);

  // ------------------------------------------------ the rooms
  // lab A / lab B: benches down the middle, fume hoods on the back wall, shelving
  for (const id of ['labA', 'labB']) {
    const s = SPACE[id];
    const cx = (s.x0 + s.x1) / 2;
    P.bench(c, [cx - 2.6, -8.2, cx - 0.8, -6.6]);
    P.bench(c, [cx + 0.8, -8.2, cx + 2.6, -6.6]);
    P.bench(c, [cx - 2.6, -5.4, cx + 2.6, -4.6], { riser: false });
    P.fumeHood(c, [s.x0 + 0.7, s.z0, s.x0 + 2.5, s.z0 + 0.85], 's');
    P.fumeHood(c, [s.x1 - 2.5, s.z0, s.x1 - 0.7, s.z0 + 0.85], 's');
    P.shelf(c, [cx - 1.2, s.z0, cx + 1.2, s.z0 + 0.5], { fill: 'bottles' });
    P.gasCylinder(c, s.x0 + 0.3, s.z1 - 0.5, M.green);
    P.gasCylinder(c, s.x0 + 0.6, s.z1 - 0.45, M.blue);
    P.cabinet(c, [s.x1 - 0.5, s.z1 - 2.4, s.x1, s.z1 - 1.2], 'w', { h: 1.9, mat: M.white, drawers: 3 });
    P.whiteboard(c, s.x1 - 0.01, -8.6, 'w', 2.2);
    P.clutter(c, cx, -3.4, 6, 1.5);
  }
  // decon: showers, benches
  {
    const s = SPACE.decon;
    for (const z of [-7, -5.5, -4]) {
      K.cyl(M.steel, s.x0 + 0.1, 2.2, z, 0.02, 0.02, 0.6, 8, [0, 0, Math.PI / 2]);
      K.cyl(M.steel, s.x0 + 0.6, 2.1, z, 0.08, 0.1, 0.06, 12);
    }
    K.box(M.steel, s.x1 - 0.6, 0.42, s.z0 + 0.4, s.x1 - 0.2, 0.46, s.z1 - 0.8);
    world.add(s.x1 - 0.6, 0, s.z0 + 0.4, s.x1 - 0.2, 0.46, s.z1 - 0.8, SURF.metal);
    K.box(M.yellow, s.x0 + 1.4, 1.0, s.z0 + 0.02, s.x0 + 2.0, 1.9, s.z0 + 0.12); // a hazmat suit on its hook
  }
  // cryo storage: freezers along the walls, dewars, a frosted floor
  {
    const s = SPACE.cryo;
    for (let i = 0; i < 6; i++) P.freezer(c, [s.x0 + 0.6 + i * 1.5, s.z1 - 0.9, s.x0 + 1.9 + i * 1.5, s.z1], 'n');
    for (let i = 0; i < 4; i++) P.freezer(c, [s.x0, s.z0 + 2.2 + i * 1.5, s.x0 + 0.9, s.z0 + 3.5 + i * 1.5], 'e');
    for (const [x, z] of [[-27.5, 6], [-26.6, 6.8], [-25.5, 5.8], [-27.2, 8.6]]) P.dewar(c, x, z);
    P.bench(c, [-31.5, 5.2, -29.8, 8.8], { riser: false, gear: 3 });
  }
  // stores: shelving rows, crates, drums
  {
    const s = SPACE.stores;
    for (const z of [5, 7.6]) P.shelf(c, [s.x0 + 0.8, z, s.x1 - 1.8, z + 0.7], { fill: 'boxes' });
    P.shelf(c, [s.x0, s.z1 - 0.7, s.x1 - 1.5, s.z1], { fill: 'boxes' });
    P.crates(c, s.x1 - 0.8, 4, 0.9, 2, { wood: true });
    P.crates(c, s.x1 - 0.9, 9.8, 0.8, 3);
    P.drum(c, s.x0 + 0.5, 3.2);
    P.drum(c, s.x0 + 1.2, 3.1, { mat: M.red });
  }
  // offices: desks in pairs, cabinets, whiteboards
  for (const id of ['office1', 'office2']) {
    const s = SPACE[id];
    const cx = (s.x0 + s.x1) / 2;
    P.desk(c, [cx - 2.6, -8.9, cx - 1.0, -8.1], 's');
    P.desk(c, [cx + 1.0, -8.9, cx + 2.6, -8.1], 's');
    P.desk(c, [cx - 2.6, -6.0, cx - 1.0, -5.2], 'n');
    P.desk(c, [cx + 1.0, -6.0, cx + 2.6, -5.2], 'n');
    P.cabinet(c, [s.x0, -4.4, s.x0 + 0.5, -3.2], 'e');
    P.cabinet(c, [s.x1 - 0.5, -4.4, s.x1, -3.2], 'w');
    P.whiteboard(c, cx, s.z0 + 0.01, 's', 2.0);
    P.clutter(c, cx, -4, 8, 2);
  }
  // the conference room
  {
    const s = SPACE.conf;
    P.confTable(c, [31, -8.4, 38, -6.2]);
    K.box(M.white, 30.5, 0.9, s.z0 + 0.03, 38.5, 2.6, s.z0 + 0.06); // the projection screen
    P.cabinet(c, [s.x1 - 0.5, -5, s.x1, -3.2], 'w', { h: 0.9 });
    P.clutter(c, 34, -4.2, 6, 1.6);
  }
  // the cafeteria: tables, the serving counter, vending machines
  {
    const s = SPACE.cafe;
    for (const [x, z] of [[15, 5.6], [15, 9.6], [19.5, 5.6], [19.5, 9.6], [24, 7.6]]) P.cafeTable(c, [x - 1.4, z - 0.4, x + 1.4, z + 0.4], { messy: rnd() < 0.8 });
    // the counter along the back wall
    K.box(M.steel, s.x0 + 1, 0, s.z1 - 1.3, s.x1 - 3.5, 0.95, s.z1 - 0.6);
    K.box(M.white, s.x0 + 1, 1.3, s.z1 - 1.3, s.x1 - 3.5, 1.34, s.z1 - 0.6);
    world.add(s.x0 + 1, 0, s.z1 - 1.3, s.x1 - 3.5, 0.95, s.z1 - 0.6, SURF.metal);
    P.vending(c, s.x1 - 0.5, 11.5, 'w');
    P.vending(c, s.x1 - 0.5, 12.6, 'w', false);
    P.clutter(c, 19, 8, 10, 3);
  }
  // the lockers
  {
    const s = SPACE.lockers;
    P.lockers(c, [s.x0 + 0.5, s.z1 - 0.5, s.x1 - 0.5, s.z1], 'n');
    P.lockers(c, [s.x0 + 2, 5.2, s.x1 - 2, 5.7], 's');
    P.lockers(c, [s.x0 + 2, 5.7, s.x1 - 2, 6.2], 'n');
    K.box(M.wood, s.x0 + 2, 0.42, 3.6, s.x1 - 2, 0.47, 3.95);
    world.add(s.x0 + 2, 0, 3.6, s.x1 - 2, 0.47, 3.95, SURF.wood);
  }
  // the specimen hall: vats, specimen tubes (one smashed), catwalk pipes, benches
  {
    const s = SPACE.specimen;
    for (const [x, z] of [[-15.2, -28.2], [-11.2, -28.2], [-7.2, -28.2]]) P.vat(c, x, z, 1.2, s.h);
    for (const [x, z, broken] of [[-15.5, -17.5, false], [-12.5, -17.5, true], [-9.5, -17.5, false], [-6.5, -17.5, false]]) P.specimenTube(c, x, z, { broken });
    P.bench(c, [-15.5, -23.4, -10.5, -22.6], { riser: true });
    P.bench(c, [-9, -23.4, -5, -22.6], { riser: false });
    P.shelf(c, [s.x0, -26, s.x0 + 0.6, -20], { fill: 'bottles', h: 2.4 });
    P.pipeRun(c, s.x0 + 0.3, -30.6, s.x1 - 0.3, -30.6, s.h - 0.5, 4, 0);
    P.gurney(c, -4.4, -24.5, 0.3, { bag: true });
    P.clutter(c, -10, -20, 8, 3);
  }
  // the server room: rows of racks, a console
  {
    const s = SPACE.server;
    for (const x of [5.5, 8.5, 11.5]) P.serverRacks(c, [x, -27.5, x + 0.9, -18.5], 'e');
    P.serverRacks(c, [14.4, -27.5, 15.5, -18.5], 'w');
    P.desk(c, [4, -16.6, 6.4, -15.8], 's', { mess: false });
    P.cableTray(c, 4, -29.5, 4, -15.5, s.h - 0.3);
  }
  // security: desks with CCTV monitors, gun lockers
  {
    const s = SPACE.security;
    P.desk(c, [-31, -33.4, -28, -32.4], 'n', { mess: true });
    P.desk(c, [-27, -33.4, -25, -32.4], 'n', { mess: true });
    for (let i = 0; i < 6; i++) c.screen(-32.9 + i * 1.05, 2.0, s.z0 + 0.03, 0, 0.95, 0.55, rnd() < 0.7);
    for (let i = 0; i < 6; i++) K.box(M.black, -33.4 + i * 1.05, 1.68, s.z0, -32.4 + i * 1.05, 2.32, s.z0 + 0.02);
    P.cabinet(c, [s.x1 - 0.6, -35, s.x1, -31.5], 'w', { h: 2.0, mat: M.dark, drawers: 2 });
    P.lockers(c, [s.x0, -34, s.x0 + 0.5, -30.4], 'e');
  }
  // maintenance: the plant
  {
    const s = SPACE.maint;
    P.plant(c, [22, -34, 25.5, -31], 'gen');
    P.plant(c, [28, -34.5, 32.5, -31.5], 'pump');
    P.plant(c, [28.5, -29.5, 33, -27], 'pump');
    P.pipeRun(c, s.x0 + 0.3, s.z1 - 0.4, s.x1 - 0.3, s.z1 - 0.4, s.h - 0.6, 5, 0);
    P.drum(c, 21, -27.5);
    P.drum(c, 21.8, -27.2, { mat: M.red });
    P.drum(c, 23.5, -27.4, { down: true });
    P.shelf(c, [s.x0, -33, s.x0 + 0.6, -28], { fill: 'boxes' });
  }
  // the morgue
  {
    const s = SPACE.morgue;
    P.coldChambers(c, [s.x0, s.z0 + 1, s.x0 + 0.9, s.z1 - 2], 'e');
    P.autopsyTable(c, -36.2, -24, 0);
    P.autopsyTable(c, -36.2, -17.5, 0);
    P.gurney(c, -35.4, -28, 0.8, { bag: true });
    P.clutter(c, -36.5, -21, 5, 1.2);
  }
  // the archive
  {
    const s = SPACE.archive;
    for (const x of [35.8, 37.5]) P.shelf(c, [x, -28.5, x + 0.8, -15], { fill: 'boxes', h: 2.4, levels: 5 });
    P.shelf(c, [s.x1 - 0.7, -28.5, s.x1, -14.5], { fill: 'boxes', h: 2.4, levels: 5 });
    P.clutter(c, 36.5, -13.5, 8, 1.2);
  }

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
      for (const x of [v.x0 + 0.05, v.x1 - 0.05]) K.cyl(M.steel, x, 2.3, z, 0.05, 0.05, 0.08, 10, [0, 0, Math.PI / 2]);
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
    // the lab outside the booth: benches, a specimen tube, computers, supply cases
    P.bench(c, [-10.6, 17, -6.2, 17.8]);
    P.bench(c, [-10.6, 20.2, -6.2, 21], { riser: false });
    P.bench(c, [3.4, 17, 6.8, 17.8]);
    P.specimenTube(c, -9.5, 24.8, { r: 0.6, h: 2.8 });
    P.specimenTube(c, 6, 24.6, { r: 0.5, h: 2.6 });
    for (const z of [18.5, 20.5]) P.desk(c, [7.2, z - 0.8, 8, z + 0.8], 'w', { mess: true });
    P.crates(c, -10.9, 15.8, 0.8, 2);
    P.crates(c, 7.1, 15.9, 0.7, 1, { wood: true });
    P.gasCylinder(c, -11.7, 26.4, M.blue);
    P.gasCylinder(c, -11.3, 26.6, M.green);
    P.whiteboard(c, -11.99, 22.5, 'e', 2.4);
  }
  {
    const s = SPACE.shop;
    // the counter (the clerk's back edge at COUNTER.x0), racks of guns on the wall behind her, ammo cases
    K.box(M.wood, COUNTER.x0, 0.95, COUNTER.z0, COUNTER.x1 + 0.05, COUNTER.top, COUNTER.z1);
    K.box(M.dark, COUNTER.x0 + 0.05, 0, COUNTER.z0 + 0.05, COUNTER.x1, 0.95, COUNTER.z1 - 0.05);
    K.box(M.hazard, COUNTER.x1 - 0.01, 0.1, COUNTER.z0 + 0.1, COUNTER.x1 + 0.005, 0.25, COUNTER.z1 - 0.1, { faces: ['px'] });
    world.add(COUNTER.x0, 0, COUNTER.z0, COUNTER.x1 + 0.05, COUNTER.top, COUNTER.z1, SURF.wood);
    K.box(M.dark, s.x0 + 0.02, 1.0, 16.5, s.x0 + 0.06, 3.0, 25.5); // the pegboard
    P.crates(c, -13.4, 26.2, 0.8, 2);
    P.crates(c, -14.4, 26.3, 0.7, 1, { wood: true });
    P.shelf(c, [s.x0 + 1, s.z0, s.x0 + 5, s.z0 + 0.6], { fill: 'boxes' });
    P.cabinet(c, [s.x0, 25.6, s.x0 + 0.6, 27], 'e', { h: 1.9, mat: M.dark, drawers: 2 });
    // the neon over the counter
    K.box(U.neon, -17.62, 2.55, 19.6, -17.6, 2.62, 22.4);
    c.light(-17.2, 2.6, 21, 0.5, 2.0, [1, 0.3, 0.2], null, 4);
    sign('armory', -17.58, 2.85, 21, 'e', 1.6);
    c.lamp({ pos: V(-17.4, s.h - 0.2, 21), intensity: 22, angle: 1.0, distance: 8, room: roomRect(s, 1) });
  }

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

  // ------------------------------------------------ bake and build
  const bake = makeHiveBaker(lights, plan);
  K.build(group, bake);
  for (const L of leaves) {
    L.KL.build(L.leaf, bake);
    L.KL = null;
  }
  group.traverse((o) => {
    if (o.isMesh) o.userData.noBatch = true;
  });

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
        banners: [['THE NORTH WING IS OPEN', 'The specimen hall and the server room · a special weapon waits in there · so does whatever got loose', 'danger', 3300, 3.5]],
      },
      {
        id: 'ring', round: BASEMENT_ROUND, open: ['ring'], portals: [], news: 'THE OUTER RING IS OPEN', sound: 'vault_unlock',
        banners: [['CONTAINMENT FAILURE', 'The outer ring’s blast doors are up · they can come round behind you now', 'danger', 3300, 3.5]],
      },
    ],
    resetDoors,
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
      rooms: [
        [-38, -12, -1.6, 1.6, 0],
        [12, 38, -1.6, 1.6, 0],
        [-33, -26, -11, -4, 0],
        [13, 19, -9.5, -3, 0],
        [13, 26, 3.5, 12.5, 0],
        [-9, 9, -9, -6, 0],
        [-17, -9, -30, -22, 0],
        [-1.6, 1.6, -34, -12, 0],
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
