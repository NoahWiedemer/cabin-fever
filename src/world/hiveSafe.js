// The safe zone's dressing (world/hive.js calls these): the airlock's fittings and the armory, the gun shop the squad
// buys from between rounds (the counter, the clerk and the weapons wall belong to the runtime, hive.js safeZoneShop).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SURF } from './collision.js';

const rbox = (w, h, d, r = 0.01) => new RoundedBoxGeometry(w, h, d, 2, r);

/** a glass display case over the rect (front toward `face`), guns and knives on velvet, an LED strip inside */
function showcase(c, [x0, z0, x1, z1], face, F) {
  const { K, M, U, rnd } = c;
  const alongX = x1 - x0 >= z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  // the base cabinet, the glass box on top, the frame
  K.box(M.dark, x0, 0, z0, x1, 0.86, z1);
  K.box(F.rubber, x0 - 0.01, 0.86, z0 - 0.01, x1 + 0.01, 0.9, z1 + 0.01);
  K.box(U.glass, x0 + 0.02, 0.9, z0 + 0.02, x1 - 0.02, 1.32, z1 - 0.02);
  K.box(M.steel, x0, 1.32, z0, x1, 1.35, z1);
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) K.box(M.steel, x - 0.015, 0.9, z - 0.015, x + 0.015, 1.35, z + 0.015);
  const back = { s: [x0, 0.9, z0, x1, 1.32, z0 + 0.02], n: [x0, 0.9, z1 - 0.02, x1, 1.32, z1], e: [x0, 0.9, z0, x0 + 0.02, 1.32, z1], w: [x1 - 0.02, 0.9, z0, x1, 1.32, z1] }[face];
  K.box(M.black, ...back);
  // velvet and the goods
  K.box(M.red, x0 + 0.04, 0.9, z0 + 0.04, x1 - 0.04, 0.93, z1 - 0.04);
  const n = Math.max(2, Math.round(len / 0.55));
  for (let i = 0; i < n; i++) {
    const u = (alongX ? x0 : z0) + (len * (i + 0.5)) / n;
    const cx = alongX ? u : (x0 + x1) / 2, cz = alongX ? (z0 + z1) / 2 : u;
    const k = rnd();
    const yaw = alongX ? 0 : Math.PI / 2;
    if (k < 0.5) {
      // a handgun
      K.add(M.black, rbox(0.2, 0.05, 0.03), cx, 0.98, cz, [0, yaw, 0]);
      K.add(M.black, rbox(0.04, 0.1, 0.03), cx - (alongX ? 0.07 : 0), 0.94, cz - (alongX ? 0 : 0.07), [0, yaw, -0.2]);
    } else if (k < 0.8) {
      // a knife in a sheath
      K.add(F.rubber, new THREE.BoxGeometry(0.22, 0.012, 0.04), cx, 0.94, cz, [0, yaw, 0]);
      K.add(M.steel, new THREE.BoxGeometry(0.14, 0.006, 0.03), cx + (alongX ? 0.04 : 0), 0.949, cz + (alongX ? 0 : 0.04), [0, yaw, 0]);
    } else {
      // a box of ammunition
      K.add(M.yellow, new THREE.BoxGeometry(0.11, 0.06, 0.07), cx, 0.96, cz, [0, yaw, 0]);
      K.add(M.card, new THREE.BoxGeometry(0.11, 0.06, 0.07), cx + 0.13 * (alongX ? 1 : 0), 0.96, cz + 0.13 * (alongX ? 0 : 1), [0, yaw, 0.05]);
    }
  }
  // the LED strip under the roof and a price card on the front
  K.box(U.panel, x0 + 0.06, 1.3, z0 + 0.06, x1 - 0.06, 1.315, z1 - 0.06);
  c.light((x0 + x1) / 2, 1.2, (z0 + z1) / 2, 0.35, 1.4, [1, 0.96, 0.9], null, 3);
  const fx = { s: (x0 + x1) / 2, n: (x0 + x1) / 2, e: x1 + 0.006, w: x0 - 0.006 }[face];
  const fz = { s: z1 + 0.006, n: z0 - 0.006, e: (z0 + z1) / 2, w: (z0 + z1) / 2 }[face];
  c.label(['ALL SALES FINAL', 'NO REFUNDS'], fx, 0.55, fz, face, Math.min(0.6, len * 0.6), 0.16, { bg: '#e8dfc0', fg: '#2a2418', size: 40 });
  c.col(x0, 0, z0, x1, 1.35, z1, SURF.glass);
}

/** a fitting for the counter top: a till, a card reader, a lamp, a bell, a tray of coins, a cleaning kit */
function counterTop(c, F, x0, z0, x1, z1, y) {
  const { K, M, U, rnd } = c;
  const cx = (x0 + x1) / 2;
  // the till (a box with a slanted display) at the customers' end
  K.add(M.dark, rbox(0.34, 0.16, 0.3, 0.02), cx, y + 0.08, z0 + 0.5);
  K.add(M.black, new THREE.BoxGeometry(0.22, 0.14, 0.02), cx, y + 0.24, z0 + 0.42, [-0.35, 0, 0]);
  c.screen(cx, y + 0.24, z0 + 0.43, 0, 0.2, 0.12, true);
  K.add(M.steel, new THREE.BoxGeometry(0.3, 0.02, 0.1), cx, y + 0.17, z0 + 0.62);
  // a card reader, a bell, a lamp, a tray with coins
  K.add(F.plastic, rbox(0.07, 0.13, 0.05, 0.01), cx + 0.13, y + 0.065, z0 + 1.05);
  K.add(U.ledG, new THREE.BoxGeometry(0.03, 0.008, 0.02), cx + 0.13, y + 0.135, z0 + 1.06);
  K.add(F.brass, new THREE.SphereGeometry(0.045, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), cx - 0.05, y, z0 + 1.4);
  K.add(M.steel, new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6), cx - 0.05, y + 0.045, z0 + 1.4);
  K.add(F.rubber, new THREE.BoxGeometry(0.22, 0.02, 0.15), cx + 0.05, y + 0.01, z1 - 0.9);
  for (let i = 0; i < 6; i++) K.add(F.brass, new THREE.CylinderGeometry(0.012, 0.012, 0.004, 8), cx + 0.05 + (rnd() - 0.5) * 0.15, y + 0.024, z1 - 0.9 + (rnd() - 0.5) * 0.08);
  // a gun-cleaning kit: a mat, a rod, a bottle
  K.add(M.green, new THREE.BoxGeometry(0.4, 0.008, 0.25), cx, y + 0.004, z1 - 0.45, [0, 0.3, 0]);
  K.add(M.steel, new THREE.CylinderGeometry(0.006, 0.006, 0.36, 6), cx, y + 0.014, z1 - 0.45, [0, 0.3, Math.PI / 2]);
  K.add(M.amber, new THREE.CylinderGeometry(0.02, 0.02, 0.07, 8), cx + 0.15, y + 0.04, z1 - 0.4);
}

/** the armory (the gun shop): display cases, an ammunition wall, a gunsmith's bench, a till, posters, a camera */
export function dressArmory(c, s, { F, P, COUNTER }) {
  const { K, M, U, rnd } = c;
  // display cases: the north wall by the door, and a long one along the south wall
  showcase(c, [-14.9, 15.05, -12.7, 15.75], 's', F);
  showcase(c, [-16.9, 26.25, -14.3, 26.95], 'n', F);
  // the ammunition wall on the east wall, south of the door: rows of boxes labelled by calibre
  const ax = -12.5, az0 = 20.2, az1 = 25.4;
  K.box(M.steel, ax - 0.5, 0, az0, ax - 0.03, 0.05, az1);
  for (const y of [0.35, 0.8, 1.25, 1.7]) {
    K.box(M.steel, ax - 0.48, y - 0.02, az0, ax, y, az1);
    let z = az0 + 0.06;
    while (z < az1 - 0.25) {
      const w = 0.16 + rnd() * 0.12;
      const mat = rnd() < 0.5 ? M.card : rnd() < 0.5 ? M.green : M.yellow;
      K.box(mat, ax - 0.44, y, z, ax - 0.06, y + 0.11 + rnd() * 0.05, z + w);
      z += w + 0.03;
    }
  }
  for (const z of [az0, az1]) K.box(M.steel, ax - 0.5, 0, z - 0.02, ax, 1.9, z + 0.02);
  c.col(ax - 0.5, 0, az0, ax, 1.9, az1, SURF.metal);
  const cal = ['5.56 × 45', '9 × 19', '7.62 × 39', '12 GAUGE', '.338 MAG'];
  cal.forEach((t, i) => c.label(t, ax - 0.008, 0.28 + (i % 4) * 0.45, az0 + 0.6 + i * 0.95, 'w', 0.7, 0.09, { bg: '#e8dfc0', fg: '#2a2418', size: 36 }));
  // a gunsmith's bench under the west end of the south wall: vise, a parts tray, a lamp
  const bx0 = -19.3, bx1 = -17.4, bz0 = 26.2, bz1 = 26.95;
  K.box(M.wood, bx0, 0.86, bz0, bx1, 0.92, bz1);
  K.box(M.dark, bx0 + 0.04, 0, bz0 + 0.04, bx1 - 0.04, 0.86, bz1 - 0.04);
  K.add(M.steel, rbox(0.14, 0.1, 0.1, 0.01), bx0 + 0.3, 0.97, bz0 + 0.14);
  K.add(M.steel, new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), bx0 + 0.3, 1.04, bz0 + 0.08, [Math.PI / 2, 0, 0]);
  K.add(M.dark, new THREE.BoxGeometry(0.3, 0.03, 0.2), bx0 + 0.95, 0.935, bz0 + 0.3);
  for (let i = 0; i < 9; i++) K.add(M.steel, new THREE.CylinderGeometry(0.008, 0.008, 0.03, 6), bx0 + 0.85 + (i % 5) * 0.05, 0.955, bz0 + 0.25 + Math.floor(i / 5) * 0.06);
  K.add(U.panel, new THREE.BoxGeometry(0.4, 0.02, 0.06), bx0 + 1.3, 1.6, bz1 - 0.1);
  K.add(M.steel, new THREE.BoxGeometry(0.02, 0.7, 0.02), bx0 + 1.3, 1.25, bz1 - 0.1);
  c.col(bx0, 0, bz0, bx1, 0.92, bz1, SURF.wood);
  // the counter's top
  counterTop(c, F, COUNTER.x0, COUNTER.z0, COUNTER.x1, COUNTER.z1, COUNTER.top);
  // a rubber mat and a boot tray by the door, a sandbag wall by the south-east corner
  K.box(F.rubber, -13.6, 0, 16.4, -12.55, 0.012, 18.6);
  for (let i = 0; i < 6; i++) K.add(M.card, rbox(0.5, 0.16, 0.28, 0.06), -13.7 + (i % 3) * 0.5, 0.09 + Math.floor(i / 3) * 0.16, 26.7, [0, (rnd() - 0.5) * 0.15, 0]);
  c.col(-13.98, 0, 26.55, -12.5, 0.34, 26.95, SURF.cardboard);
  // wall stuff: licence, house rules, a target sheet, a camera, a first-aid box
  c.label(['FEDERAL ARMS LICENCE', 'NOX ARMORY · SUBLEVEL 4', 'No. 4471 · valid'], -12.53, 1.75, 17.5, 'w', 0.9, 0.55, { bg: '#e8dfc0', fg: '#2a2418', border: '#7a5a20', size: 34 });
  c.label(['HOUSE RULES', '1. No firearms in the clean room', '2. Cash or credit', '3. The clerk is not armed', '4. Do not point it at the clerk'], -12.53, 2.1, 22.5, 'w', 1.5, 0.95, { bg: '#c9c2a4', fg: '#2a2418', align: 'left', size: 40 });
  c.label(['TODAY', 'M4A1 · $2,100', 'AK-47 · $2,600', 'MG 42 · $4,800'], -15.2, 2.2, 15.02, 's', 1.5, 0.8, { bg: '#111', fg: '#ffd060', align: 'left', size: 40 });
  c.wallDecal('bullet', -13.0, 1.5, 15.0, 's', 0.9, 0.9);
  K.add(F.plastic, new THREE.SphereGeometry(0.09, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), -12.7, s.h - 0.02, 16.1, [Math.PI, 0, 0]);
  K.add(M.black, new THREE.SphereGeometry(0.055, 8, 6), -12.7, s.h - 0.06, 16.1);
  P.extinguisher(c, -12.53, 19.6, 'w');
}

/** the airlock: benches, PPE hooks, status lights, intercom, decontamination signage, grating */
export function dressVestibule(c, s, { F, P }) {
  const { K, M, U } = c;
  // grating in the middle, hazard-edged
  K.box(M.dark, -1.2, 0.002, 11.2, 1.2, 0.02, 13.8);
  for (let i = 0; i < 12; i++) K.box(M.steel, -1.15 + i * 0.2, 0.02, 11.25, -1.03 + i * 0.2, 0.03, 13.75);
  // benches on both walls with hooks above: coats, a helmet, a respirator
  for (const side of [-1, 1]) {
    const x = side < 0 ? s.x0 : s.x1 - 0.4;
    K.box(M.wood, x, 0.44, 11.1, x + 0.4, 0.48, 13.6);
    K.box(M.dark, x + (side < 0 ? 0.02 : 0.32), 0, 11.15, x + (side < 0 ? 0.08 : 0.38), 0.44, 11.3);
    K.box(M.dark, x + (side < 0 ? 0.02 : 0.32), 0, 13.4, x + (side < 0 ? 0.08 : 0.38), 0.44, 13.55);
    c.col(x, 0, 11.1, x + 0.4, 0.48, 13.6, SURF.wood);
    const wallX = side < 0 ? s.x0 : s.x1;
    const dir = side < 0 ? 1 : -1;
    K.box(M.steel, wallX, 1.6, 11.3, wallX + dir * 0.06, 1.66, 13.4);
    for (let i = 0; i < 5; i++) {
      const z = 11.5 + i * 0.45;
      K.add(M.steel, new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), wallX + dir * 0.06, 1.63, z, [0, 0, Math.PI / 2]);
      if (i % 2 === 0) K.add(i === 2 ? M.green : M.tray, new THREE.BoxGeometry(0.1, 0.6, 0.28), wallX + dir * 0.12, 1.3, z, [0, 0, 0.05]);
    }
    K.add(F.rubber, new THREE.SphereGeometry(0.11, 10, 8), wallX + dir * 0.16, 1.78, 12.9);
    K.add(U.glass, new THREE.BoxGeometry(0.02, 0.07, 0.16), wallX + dir * 0.23, 1.78, 12.9);
  }
  // the interlock: a status panel on each door's frame (red = shut, green = cycled), an intercom
  for (const [z, face] of [[10.53, 's'], [14.47, 'n']]) {
    const dir = face === 's' ? 1 : -1;
    K.box(M.dark, 2.0, 1.2, z, 2.42, 1.75, z + dir * 0.05);
    K.box(z < 12 ? U.ledR : U.ledG, 2.06, 1.6, z + dir * 0.05, 2.16, 1.66, z + dir * 0.058);
    K.box(z < 12 ? U.ledG : U.ledR, 2.06, 1.5, z + dir * 0.05, 2.16, 1.56, z + dir * 0.058);
    K.box(M.black, 2.22, 1.45, z + dir * 0.05, 2.38, 1.66, z + dir * 0.055);
    c.light(2.2, 1.6, z + dir * 0.3, 0.25, 1.2, z < 12 ? [1, 0.2, 0.15] : [0.2, 1, 0.3], null, 2.5);
  }
  c.label(['DECONTAMINATION CYCLE', 'Both doors interlocked', 'Remove contaminated gear before entry'], -2.49, 2.05, 12.6, 'e', 1.9, 0.75, { bg: '#0a5a28', fg: '#eaffef', border: '#eaffef', size: 40 });
  c.label(['AUTHORISED PERSONNEL', 'SECURE LAB BEYOND'], 2.49, 2.05, 12.6, 'w', 1.6, 0.55, { bg: '#7a1410', fg: '#fff0ee', border: '#ffd0c8', size: 40 });
  // UV strips on the ceiling
  K.box(U.blue, -1.6, s.h - 0.03, 11.4, -1.5, s.h - 0.02, 13.6);
  K.box(U.blue, 1.5, s.h - 0.03, 11.4, 1.6, s.h - 0.02, 13.6);
  c.light(0, s.h - 0.2, 12.5, 0.5, 2.5, [0.55, 0.65, 1], null, 5);
  P.extinguisher(c, -2.49, 10.9, 'e');
}
