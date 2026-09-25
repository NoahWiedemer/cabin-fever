// The barn: a red board-and-batten gambrel barn north-east of the farmhouse, turned 35° to face it across the
// farmyard (layout + transform in ranchLayout.js).
//   Ground floor (y -0.38): big sliding doors in the west gable (facing the house) and the east gable, a side
//   door in the north wall, three horse stalls along the south wall, workbench / tools / feed on the north side.
//   Hayloft (level 2, y 3.1) over the west end x 21..26.6: hay stacks, a loft door in the west gable over the
//   main doors (a sniping perch over the yard, barred at hip height), railing along its open edge, and a vertical
//   ladder (src/actors/ladders.js) as the only way up.
// Built in the barn's LOCAL frame (the old axis-aligned coordinates: x 21..35, z -8..4) with its own
// LevelBuilder (merged per material, local UVs, vertex grime) and props batched in local space; the result
// hangs under a rotated root group (BARN_XF). Every collider goes through col(): the local box becomes an
// oriented box in the world (collision.js addOBB), exact for movement, ground, ceilings and bullets.
import * as THREE from 'three';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { getMaterial } from './materials.js';
import { LevelBuilder } from './levelBuilder.js';
import { buildProp } from './propsSafe.js';
import { BARN, LOFT, LADDER, LADDER_LOCAL, LADDER_A, LADDER_B, BARN_XF, barnToWorld, barnDir } from './ranchLayout.js';

const T = BARN.t;
const FL = BARN.floor;
const HALF = (BARN.z1 - BARN.z0) / 2;

/** gambrel profile of one side (s = +1 south, -1 north): [eave, knee, ridge] as [z, y] */
function profile(s) {
  return [
    [BARN.zc + s * HALF, BARN.eave],
    [BARN.zc + s * (HALF - BARN.knee_in), BARN.knee],
    [BARN.zc, BARN.ridge],
  ];
}

const DOOR_MATS = { siding: 'barnGable', trim: 'barnBarge', planks: 'barnGableIn' }; // charrable (barnFire.js)

export function buildBarn({ world, lamp, lamps, rnd }) {
  // local box -> oriented collider in the world
  const col = (x0, y0, z0, x1, y1, z1, surface = SURF.wood, flags = 0, tag = null) => {
    const [wx, wz] = barnToWorld((x0 + x1) / 2, (z0 + z1) / 2);
    return world.addOBB(wx, wz, Math.abs(x1 - x0) / 2, Math.abs(z1 - z0) / 2, BARN_XF.yaw, Math.min(y0, y1), Math.max(y0, y1), surface, flags, tag);
  };
  const B = new LevelBuilder({ add: col });
  const sg = B.staticGroup;
  const prop = (type, x, y, z, rot = 0, opts = {}, placeOpts = {}) => {
    let p;
    try {
      p = buildProp(type, { seed: Math.floor(rnd() * 100000), ...opts });
    } catch (e) {
      console.warn('barn prop failed', type, e);
      return null;
    }
    if (!p) return null;
    B.placeProp(p, x, y, z, rot, placeOpts);
    return p;
  };
  const lampW = (x, ceilY, z, level, opts) => {
    const [wx, wz] = barnToWorld(x, z);
    lamp(wx, ceilY, wz, level, opts);
  };
  const windows = [];
  const wood = { surface: SURF.wood };

  // ------------------------------------------------------------------ helpers for sloped / free-form parts
  const _y = new THREE.Vector3(0, 1, 0);
  /** timber from p0 to p1 (length along local Y so the woodBeam grain (V) runs along it) */
  const beam = (p0, p1, w, d, mat = 'barnTimber', cast = true) => {
    const a = new THREE.Vector3(...p0), b = new THREE.Vector3(...p1);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const m = getMaterial(mat);
    const mpr = m.userData.metersPerRepeat || 1;
    const g = new THREE.BoxGeometry(w, len, d);
    const uv = g.attributes.uv;
    const dims = [[d, len], [d, len], [w, d], [w, d], [w, len], [w, len]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / mpr + a.x * 0.37, (uv.getY(i) * dims[f][1]) / mpr + a.z * 0.23);
    }
    const mesh = new THREE.Mesh(g, m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(_y, dir.normalize());
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    sg.add(mesh);
    return mesh;
  };
  /** flat polygon (convex, CCW seen from the front) with world-meter UVs from uvOf(p) */
  const poly = (pts, mat, uvOf, cast = true) => {
    const m = getMaterial(mat);
    const mpr = m.userData.metersPerRepeat || 1;
    const pos = [], uvs = [];
    const n = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0])).normalize();
    for (let i = 1; i < pts.length - 1; i++) {
      for (const p of [pts[0], pts[i], pts[i + 1]]) {
        pos.push(p.x, p.y, p.z);
        const [u, v] = uvOf(p);
        uvs.push(u / mpr, v / mpr);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [n.x, n.y, n.z]), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    sg.add(mesh);
    return mesh;
  };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  /** roof slab along X between two eave-parallel lines (z,y): tin on top, sheathing boards below */
  const slab = (x0, x1, pa, pb, th = 0.07) => {
    const dz = pb[0] - pa[0], dy = pb[1] - pa[1];
    const L = Math.hypot(dz, dy);
    // outward normal of the slope (points up / out)
    let nz = -dy / L, ny = dz / L;
    if (ny < 0) (nz = -nz), (ny = -ny);
    const up = (p, k) => V(p.x, p.y + ny * k, p.z + nz * k);
    const A = V(x0, pa[1], pa[0]), Bp = V(x1, pa[1], pa[0]), C = V(x1, pb[1], pb[0]), D = V(x0, pb[1], pb[0]);
    const along = (p) => ((p.y - pa[1]) * dy + (p.z - pa[0]) * dz) / L; // distance up the slope from pa
    const top = [up(A, th), up(Bp, th), up(C, th), up(D, th)];
    const front = new THREE.Vector3().subVectors(top[1], top[0]).cross(new THREE.Vector3().subVectors(top[2], top[0]));
    const tq = front.y > 0 ? top : top.slice().reverse();
    poly(tq, 'barnTin', (p) => [p.x, along(p) + (pa[1] > 6 ? 0.9 : 0)]);
    const bot = [A, Bp, C, D];
    const f2 = new THREE.Vector3().subVectors(bot[1], bot[0]).cross(new THREE.Vector3().subVectors(bot[2], bot[0]));
    poly(f2.y < 0 ? bot : bot.slice().reverse(), 'barnSheathing', (p) => [p.x, along(p)]);
    return { nz, ny };
  };

  // ------------------------------------------------------------------ floor
  B.box(BARN.x0, -0.5, BARN.z0, BARN.x1, FL, BARN.z1, { mat: 'barnFloor', surface: SURF.concrete, grime: 0, castShadow: false });

  // ------------------------------------------------------------------ walls
  const xW = BARN.x0 + T / 2, xE = BARN.x1 - T / 2, zN = BARN.z0 + T / 2, zS = BARN.z1 - T / 2;
  const grimeLow = { floorY: -0.5, ceilY: 99 };
  const outIn = (outwardPositive) => (outwardPositive ? { pos: 'barnSiding', neg: 'barnPlanks' } : { pos: 'barnPlanks', neg: 'barnSiding' });
  const W = (axis, c, a, b, y0, y1, open, outwardPositive, g = grimeLow) =>
    B.wall(axis, c, a, b, y0, y1, T, open, { sides: outIn(outwardPositive), jamb: 'barnTrim', top: 'barnPlanks', surface: SURF.wood, grime: 0.8, ...g });
  const win = (axis, c, o, outward) => {
    const cx = (o.a + o.b) / 2, cy = (o.y0 + o.y1) / 2;
    // moonlight shafts (weather.js) take explicit world vectors for the turned barn
    const [wx, wz] = axis === 'x' ? barnToWorld(cx, c) : barnToWorld(c, cx);
    const n = axis === 'x' ? barnDir(0, outward) : barnDir(outward, 0), al = axis === 'x' ? barnDir(1, 0) : barnDir(0, 1);
    windows.push({ a: o.a, b: o.b, y0: o.y0, y1: o.y1, center: new THREE.Vector3(wx, cy, wz), n: new THREE.Vector3(n[0], 0, n[1]), along: new THREE.Vector3(al[0], 0, al[1]) });
    const rot = axis === 'x' ? (outward > 0 ? 0 : Math.PI) : outward > 0 ? Math.PI / 2 : -Math.PI / 2;
    prop('barnWindow', axis === 'x' ? cx : c, cy, axis === 'x' ? c : cx, rot, { w: o.b - o.a, h: o.y1 - o.y0, depth: T, boards: rnd() < 0.4, trim: 'barnBarge' }, { collide: false });
    if (axis === 'x') col(o.a, o.y0, c - T / 2, o.b, o.y1, c + T / 2, SURF.wood, FLAG_NOBULLET);
    else col(c - T / 2, o.y0, o.a, c + T / 2, o.y1, o.b, SURF.wood, FLAG_NOBULLET);
  };
  const WIN = (a, b, y0 = 0.85, y1 = 1.75) => ({ a, b, y0, y1 });

  // west gable wall (faces the house): big doors below the loft, the loft door above them
  const westLow = [{ a: -4, b: 0, y0: -0.5, y1: 2.72 }, WIN(-6.95, -6.05), WIN(1.95, 2.85)];
  W('z', xW, BARN.z0, BARN.z1, -0.5, LOFT.under, westLow, false);
  const loftDoor = { a: -3.0, b: -1.0, y0: LOFT.y, y1: 4.95 };
  W('z', xW, BARN.z0, BARN.z1, LOFT.under, BARN.eave, [loftDoor], false, { floorY: -0.5, ceilY: BARN.eave });
  for (const o of westLow.slice(1)) win('z', xW, o, -1);
  // east gable wall: tall doors, a high window
  const eastOpen = [{ a: -4, b: 0, y0: -0.5, y1: 3.7 }, WIN(1.7, 2.6, 3.3, 4.2)];
  W('z', xE, BARN.z0, BARN.z1, -0.5, BARN.eave, eastOpen, true);
  win('z', xE, eastOpen[1], 1);
  // north wall: windows, a side door by the ladder, a loft window
  const northOpen = [WIN(22.9, 23.8), WIN(24.3, 25.2, 3.75, 4.5), { a: 27.7, b: 28.9, y0: -0.5, y1: 1.95 }, WIN(30.9, 31.8), WIN(33.1, 34.0)];
  W('x', zN, BARN.x0 + T, BARN.x1 - T, -0.5, BARN.eave, northOpen, false);
  // south wall: windows under the loft, loft window, stall windows
  const southOpen = [WIN(23.2, 24.1), WIN(24.6, 25.5, 3.75, 4.5), WIN(28.1, 28.9, 1.15, 1.8), WIN(30.6, 31.4, 1.15, 1.8), WIN(33.2, 34.0, 1.15, 1.8)];
  W('x', zS, BARN.x0 + T, BARN.x1 - T, -0.5, BARN.eave, southOpen, true);
  for (const o of southOpen) win('x', zS, o, 1);
  for (const o of [northOpen[0], northOpen[1], northOpen[3], northOpen[4]]) win('x', zN, o, -1);

  // corner trim boards (white), door head trim
  for (const [x, z, sx, sz] of [[BARN.x0, BARN.z0, -1, -1], [BARN.x1, BARN.z0, 1, -1], [BARN.x0, BARN.z1, -1, 1], [BARN.x1, BARN.z1, 1, 1]]) {
    B.box(x + sx * 0.05, -0.45, z - sz * 0.2, x, BARN.eave, z + sz * 0.05, { mat: 'barnTrim', collide: false, grime: 0.5, floorY: -0.5 });
    B.box(x - sx * 0.2, -0.45, z, x + sx * 0.05, BARN.eave, z + sz * 0.05, { mat: 'barnTrim', collide: false, grime: 0.5, floorY: -0.5 });
  }
  B.box(BARN.x0 - 0.06, 2.72, -4.15, BARN.x0, 2.9, 0.15, { mat: 'barnTrim', collide: false, grime: 0 });
  B.box(BARN.x1, 3.7, -4.15, BARN.x1 + 0.06, 3.88, 0.15, { mat: 'barnTrim', collide: false, grime: 0 });

  // ------------------------------------------------------------------ gable ends (pentagons above the eave) + roof
  const N = profile(-1), S = profile(1);
  const gablePts = [N[0], S[0], S[1], S[2], N[1]]; // [z, y]
  for (const [x0, x1, outward] of [[BARN.x0, BARN.x0 + T, -1], [BARN.x1 - T, BARN.x1, 1]]) {
    const xo = outward < 0 ? x0 : x1, xi = outward < 0 ? x1 : x0;
    // exterior face: CCW seen from outside
    const ext = gablePts.map(([z, y]) => V(xo, y, z));
    poly(outward < 0 ? ext : ext.slice().reverse(), 'barnGable', (p) => [outward < 0 ? p.z : -p.z, p.y]);
    const int = gablePts.map(([z, y]) => V(xi, y, z));
    poly(outward < 0 ? int.slice().reverse() : int, 'barnGableIn', (p) => [outward < 0 ? -p.z : p.z, p.y]);
  }
  const OVX = 0.42; // gable overhang
  const rx0 = BARN.x0 - OVX, rx1 = BARN.x1 + OVX;
  for (const s of [-1, 1]) {
    const [E, K, R] = profile(s);
    // lower slope runs out past the wall as the eave
    const dz = E[0] - K[0], dy = E[1] - K[1], l = Math.hypot(dz, dy);
    const Eo = [E[0] + (dz / l) * 0.45, E[1] + (dy / l) * 0.45];
    slab(rx0, rx1, Eo, K);
    slab(rx0, rx1, K, [R[0] + s * 0.02, R[1]]);
    // barge boards (white) along both gables, fascia along the eave
    for (const x of [rx0 + 0.03, rx1 - 0.03]) {
      beam([x, Eo[1] + 0.02, Eo[0]], [x, K[1] + 0.02, K[0]], 0.05, 0.22, 'barnBarge');
      beam([x, K[1] + 0.02, K[0]], [x, R[1] + 0.02, R[0]], 0.05, 0.22, 'barnBarge');
    }
    B.box(rx0, Eo[1] - 0.2, Eo[0] - (s > 0 ? 0 : 0.05), rx1, Eo[1] + 0.02, Eo[0] + (s > 0 ? 0.05 : 0), { mat: 'barnTrim', collide: false, grime: 0 });
    // inner frieze closing the gap between the wall top and the roof sheathing
    const zi = s > 0 ? BARN.z1 - T : BARN.z0 + T;
    B.box(BARN.x0 + T, BARN.eave, Math.min(zi, zi - s * 0.02), BARN.x1 - T, BARN.eave + 0.34, Math.max(zi, zi - s * 0.02), { mat: 'barnPlanks', collide: false, grime: 0 });
    // rafters
    for (let x = BARN.x0 + 0.35; x < BARN.x1 - 0.2; x += 1.75) {
      beam([x, E[1] - 0.12, E[0] - s * 0.1], [x, K[1] - 0.12, K[0]], 0.08, 0.18);
      beam([x, K[1] - 0.12, K[0]], [x, R[1] - 0.12, R[0]], 0.08, 0.16);
    }
    // purlin at the knee
    B.box(BARN.x0 + T, K[1] - 0.32, K[0] - 0.08, BARN.x1 - T, K[1] - 0.12, K[0] + 0.08, { mat: 'woodBeam', collide: false, grime: 0 });
  }
  // ridge cap + ridge beam
  B.box(rx0, BARN.ridge + 0.02, BARN.zc - 0.18, rx1, BARN.ridge + 0.1, BARN.zc + 0.18, { mat: 'tinRoof', collide: false, grime: 0 });
  B.box(BARN.x0 + T, BARN.ridge - 0.34, BARN.zc - 0.09, BARN.x1 - T, BARN.ridge - 0.1, BARN.zc + 0.09, { mat: 'woodBeam', collide: false, grime: 0 });

  // ------------------------------------------------------------------ timber frame
  const kn = (s) => profile(s)[1];
  for (const x of [24.85, 28.35, 31.85]) {
    // wall posts
    for (const [z0, z1] of [[BARN.z0 + T, BARN.z0 + T + 0.22], [BARN.z1 - T - 0.22, BARN.z1 - T]]) {
      B.box(x - 0.11, FL, z0, x + 0.11, BARN.eave, z1, { mat: 'woodBeam', ...wood, grime: 0.5, floorY: FL });
    }
    // collar tie at the knee
    B.box(x - 0.05, kn(1)[1] - 0.4, kn(-1)[0] + 0.1, x + 0.05, kn(1)[1] - 0.22, kn(1)[0] - 0.1, { mat: 'woodBeam', collide: false, grime: 0 });
  }
  for (const x of [28.35, 31.85]) {
    // tie beam over the open floor + knee braces
    B.box(x - 0.1, 4.62, BARN.z0 + T, x + 0.1, 4.92, BARN.z1 - T, { mat: 'woodBeam', collide: false, grime: 0 });
    for (const s of [-1, 1]) {
      const zw = s > 0 ? BARN.z1 - T - 0.11 : BARN.z0 + T + 0.11;
      beam([x, 3.7, zw], [x, 4.66, zw - s * 1.0], 0.12, 0.12);
    }
    // king post + struts up to the ridge
    beam([x, 4.92, BARN.zc], [x, BARN.ridge - 0.34, BARN.zc], 0.14, 0.14);
  }
  // wall plates
  for (const s of [-1, 1]) {
    const z = s > 0 ? BARN.z1 - T : BARN.z0 + T;
    B.box(BARN.x0 + T, BARN.eave - 0.22, Math.min(z, z - s * 0.2), BARN.x1 - T, BARN.eave, Math.max(z, z - s * 0.2), { mat: 'woodBeam', collide: false, grime: 0 });
  }
  // girt (horizontal nailer) along the side walls, between the ground windows and the loft windows
  for (const s of [-1, 1]) {
    const z = s > 0 ? BARN.z1 - T : BARN.z0 + T;
    B.box(BARN.x0 + T, 2.3, Math.min(z, z - s * 0.06), BARN.x1 - T, 2.42, Math.max(z, z - s * 0.06), { mat: 'woodBeam', collide: false, grime: 0 });
  }

  // ------------------------------------------------------------------ hayloft
  B.box(LOFT.x0, LOFT.under, LOFT.z0, LOFT.x1, LOFT.y, LOFT.z1, {
    mats: { py: 'woodFloor', ny: 'barnPlanks', px: 'woodBeam', nx: 'woodBeam', pz: 'woodBeam', nz: 'woodBeam' },
    surface: SURF.wood,
    grime: 0,
  });
  // edge girder, posts, joists
  B.box(LOFT.x1 - 0.2, LOFT.under - 0.34, LOFT.z0, LOFT.x1, LOFT.under, LOFT.z1, { mat: 'woodBeam', ...wood, grime: 0 });
  for (const z of [-3.6, 0.4]) B.box(LOFT.x1 - 0.21, FL, z - 0.11, LOFT.x1 + 0.01, LOFT.under - 0.34, z + 0.11, { mat: 'woodBeam', ...wood, grime: 0.5, floorY: FL });
  for (let z = LOFT.z0 + 0.35; z < LOFT.z1 - 0.2; z += 0.62) B.box(LOFT.x0, LOFT.under - 0.18, z - 0.05, LOFT.x1 - 0.2, LOFT.under, z + 0.05, { mat: 'woodBeam', collide: false, grime: 0 });
  // railing on the open edge, gap for the ladder
  const [g0, g1] = LADDER_LOCAL.gap;
  const railX0 = LOFT.x1 - 0.14, railX1 = LOFT.x1 - 0.02;
  for (const [za, zb] of [[LOFT.z0, g0], [g1, LOFT.z1]]) {
    const n = Math.max(1, Math.round((zb - za) / 1.9));
    for (let k = 0; k <= n; k++) {
      const z = za + ((zb - za) * k) / n;
      const tall = Math.abs(z - g0) < 0.01 || Math.abs(z - g1) < 0.01;
      B.box(railX0, LOFT.y, z - 0.05, railX1, LOFT.y + (tall ? 1.35 : 1.1), z + 0.05, { mat: 'woodBeam', collide: false, grime: 0.3, floorY: LOFT.y });
    }
    B.box(railX0 - 0.01, LOFT.y + 0.98, za, railX1 + 0.01, LOFT.y + 1.08, zb, { mat: 'woodBeam', collide: false, grime: 0 });
    B.box(railX0, LOFT.y + 0.5, za, railX1, LOFT.y + 0.58, zb, { mat: 'woodBeam', collide: false, grime: 0 });
    col(railX0 - 0.03, LOFT.y, za, railX1 + 0.02, LOFT.y + 1.1, zb, SURF.wood, FLAG_NOBULLET);
  }
  // ladder: rails run a metre past the loft floor as hand holds; collider only up to the floor
  const ladH = LOFT.y + 1.05 - FL;
  const LL = LADDER_LOCAL;
  prop('ladder', LL.x, FL, LL.z, Math.PI / 2, { h: ladH, w: LADDER.width, top: LOFT.y - FL - 0.12 }, { collide: false });
  col(LL.x - 0.07, FL, LL.z - LADDER.width / 2 - 0.04, LL.x + 0.05, LOFT.y - 0.02, LL.z + LADDER.width / 2 + 0.04, SURF.wood, FLAG_NOBULLET);
  // loft door: two leaves swung flat against the gable, a bar across at hip height
  prop('barnDoor', BARN.x0 - 0.05, LOFT.y, -3.52, -Math.PI / 2, { w: 1.0, h: 1.7, rails: [0.07, 1.63], mats: DOOR_MATS }, { collide: false });
  prop('barnDoor', BARN.x0 - 0.05, LOFT.y, -0.48, -Math.PI / 2, { w: 1.0, h: 1.7, rails: [0.07, 1.63], single: true, mats: DOOR_MATS }, { collide: false });
  B.box(BARN.x0 + 0.02, LOFT.y + 0.98, -3.05, BARN.x0 + 0.12, LOFT.y + 1.08, -0.95, { mat: 'woodBeam', collide: false, grime: 0 });
  col(BARN.x0 - 0.02, LOFT.y, loftDoor.a, BARN.x0 + T, LOFT.y + 1.08, loftDoor.b, SURF.wood, FLAG_NOBULLET);
  // hay hood over the loft door: little gable roof, hay beam, pulley
  {
    const hx0 = BARN.x0 - 1.15, hx1 = BARN.x0;
    const zc = -2.0, hw = 1.3, ey = BARN.eave + 0.2, ry = BARN.eave + 1.05;
    for (const s of [-1, 1]) {
      const pa = [zc + s * (hw + 0.1), ey - 0.07], pb = [zc, ry];
      // slab() builds along x between two z/y lines
      slab(hx0, hx1, pa, pb, 0.05);
    }
    const tri = [V(hx0 + 0.02, ey, zc - hw), V(hx0 + 0.02, ey, zc + hw), V(hx0 + 0.02, ry, zc)]; // faces -x
    poly(tri, 'barnGable', (p) => [p.z, p.y]);
    poly(tri.slice().reverse(), 'barnGableIn', (p) => [-p.z, p.y]);
    for (const s of [-1, 1]) beam([hx0 - 0.02, ey - 0.08, zc + s * (hw + 0.1)], [hx0 - 0.02, ry + 0.02, zc], 0.05, 0.18, 'barnBarge');
    B.box(hx0 - 0.55, ey + 0.28, zc - 0.08, hx1, ey + 0.44, zc + 0.08, { mat: 'woodBeam', collide: false, grime: 0 });
    prop('pulley', hx0 - 0.42, ey + 0.28, zc, 0, { drop: 1.3 }, { collide: false });
  }
  // east gable vent
  B.box(BARN.x1, 6.3, -2.55, BARN.x1 + 0.05, 7.4, -1.45, { mat: 'barnTrim', collide: false, grime: 0 });
  for (let y = 6.42; y < 7.3; y += 0.14) B.box(BARN.x1 + 0.03, y, -2.45, BARN.x1 + 0.1, y + 0.06, -1.55, { mat: 'barnPlanks', collide: false, grime: 0 });

  // ------------------------------------------------------------------ doors
  // west: two leaves slid open along the outside track
  B.box(BARN.x0 - 0.12, 2.72, -6.4, BARN.x0 - 0.04, 2.8, 2.4, { mat: 'metalDark', collide: false, grime: 0 });
  prop('barnDoor', BARN.x0 - 0.13, -0.47, -5.12, -Math.PI / 2, { w: 2.1, h: 3.1, slider: true, mats: DOOR_MATS }, { collide: false });
  prop('barnDoor', BARN.x0 - 0.13, -0.47, 1.12, -Math.PI / 2, { w: 2.1, h: 3.1, slider: true, mats: DOOR_MATS }, { collide: false });
  // east: one leaf open, the other stuck half shut
  B.box(BARN.x1 + 0.04, 3.7, -4.4, BARN.x1 + 0.12, 3.78, 2.4, { mat: 'metalDark', collide: false, grime: 0 });
  prop('barnDoor', BARN.x1 + 0.13, -0.47, 1.12, Math.PI / 2, { w: 2.1, h: 4.1, slider: true, mats: DOOR_MATS }, { collide: false });
  prop('barnDoor', BARN.x1 + 0.13, -0.47, -3.15, Math.PI / 2, { w: 2.1, h: 4.1, slider: true, mats: DOOR_MATS }, { collide: false });
  col(BARN.x1 + 0.03, -0.5, -4.2, BARN.x1 + 0.2, 3.7, -2.1, SURF.wood, 0);
  // north side door: a plain board leaf hanging open outside, hinged at the east jamb (x 28.9)
  prop('barnDoor', 29.1, FL, BARN.z0 - 0.56, 1.22, { w: 1.2, h: 2.3, rails: [0.07, 1.15, 2.23], mats: DOOR_MATS }, { collide: false });

  // ------------------------------------------------------------------ stalls (south side of the open floor)
  const stallX = [27.2, 29.75, 32.3];
  const sz0 = 0.9, sz1 = BARN.z1 - T;
  for (const x of stallX) {
    B.box(x - 0.08, FL, sz0 - 0.08, x + 0.08, 2.3, sz0 + 0.08, { mat: 'woodBeam', ...wood, grime: 0.5, floorY: FL });
    B.box(x - 0.04, FL, sz0 + 0.08, x + 0.04, 0.95, sz1, { mat: 'barnPlanks', ...wood, grime: 0.7, floorY: FL });
    B.box(x - 0.05, 1.85, sz0 + 0.08, x + 0.05, 1.95, sz1, { mat: 'woodBeam', collide: false, grime: 0 });
    for (let z = sz0 + 0.3; z < sz1 - 0.05; z += 0.24) B.box(x - 0.015, 0.95, z - 0.013, x + 0.015, 1.85, z + 0.013, { mat: 'metalDark', collide: false, grime: 0 });
    col(x - 0.05, 0.95, sz0 + 0.08, x + 0.05, 1.95, sz1, SURF.metal, FLAG_NOBULLET);
  }
  B.box(stallX[0], 2.18, sz0 - 0.07, BARN.x1 - T, 2.34, sz0 + 0.07, { mat: 'woodBeam', collide: false, grime: 0 });
  const ends = [...stallX, BARN.x1 - T];
  for (let i = 0; i < 3; i++) {
    const xa = ends[i] + 0.08, xb = ends[i + 1] - (i === 2 ? 0 : 0.08);
    // fixed front panel, open gate swung back against the next partition
    B.box(xa, FL, sz0 - 0.04, xa + 0.95, 1.05, sz0 + 0.04, { mat: 'barnPlanks', ...wood, grime: 0.7, floorY: FL });
    B.box(xa, 1.05, sz0 - 0.05, xa + 0.95, 1.13, sz0 + 0.05, { mat: 'woodBeam', collide: false, grime: 0 });
    B.box(xb - 0.13, FL + 0.1, sz0 + 0.12, xb - 0.08, 1.1, sz0 + 1.38, { mat: 'barnPlanks', ...wood, grime: 0.5, floorY: FL });
    prop('feedTrough', (xa + xb) / 2, FL, sz1 - 0.3, 0, { length: 1.4 });
    prop('hayPile', (xa + xb) / 2 + (rnd() - 0.5) * 0.6, FL, 2.3, rnd() * 6, { r: 0.7, h: 0.22, straw: 'barnStraw' }, { collide: false });
  }
  prop('bucket', 28.9, FL, 1.35, 0.3);

  // ------------------------------------------------------------------ props: ground floor
  const HAY = 'barnStraw'; // the barn's own straw material (barnFire.js chars it)
  const bale = (x, y, z, r, lite = true) => prop('hayBale', x, y, z, r, { lite, straw: HAY });
  const stack = (x0, z, y0, nx, layers, rot = 0, dz = 0) => {
    for (let l = 0; l < layers; l++) for (let i = 0; i < nx - (l > 0 && rnd() < 0.5 ? 1 : 0); i++) bale(x0 + i * 1.02 + (l % 2) * 0.3 + (rnd() - 0.5) * 0.06, y0 + l * 0.4, z + (rnd() - 0.5) * 0.05 + dz * l, rot + (rnd() - 0.5) * 0.06);
  };
  // under the loft: bale stacks along the north wall, round bale + sacks in the south corner
  stack(21.8, -7.45, FL, 3, 3);
  stack(21.8, -6.92, FL, 3, 2);
  prop('roundBale', 22.5, FL, 2.95, 0, { r: 0.72, straw: HAY });
  prop('feedSacks', 24.35, FL, 3.3, 0.1, { n: 6 });
  prop('barrel', 25.75, FL, 3.25, 0);
  prop('barrel', 25.1, FL, 3.45, 0);
  prop('crate', 25.6, FL, 1.6, 0.2);
  // open floor, north side: workbench, tools, feed, cans
  prop('workbench', 30.9, FL, BARN.z0 + T + 0.36, 0);
  prop('lantern', 30.4, FL + 0.92, BARN.z0 + T + 0.3, 0.4);
  prop('toolRack', 33.05, FL, BARN.z0 + T + 0.01, 0, {}, { collide: false });
  prop('feedSacks', 34.1, FL, -6.9, Math.PI / 2, { n: 5 });
  prop('barrel', 34.3, FL, -5.3, 0);
  prop('barrel', 33.65, FL, -5.0, 0);
  prop('milkCans', 29.55, FL, -7.3, 0.4, { n: 3 });
  prop('wheelbarrow', 31.2, FL, -5.6, 1.9);
  prop('hayPile', 33.4, FL, -3.9, 0.7, { r: 0.8, h: 0.35, straw: HAY });
  prop('pitchfork', 27.05, FL, -3.45, 0.2, {}, { collide: false })?.object.rotation.set(0.28, 0.2, 0.05);

  // ------------------------------------------------------------------ props: hayloft
  const ly = LOFT.y;
  stack(21.6, -7.45, ly, 4, 3);
  stack(21.6, -6.92, ly, 3, 2);
  stack(21.9, -6.4, ly, 2, 1);
  bale(24.6, ly, -6.0, 0.6);
  stack(23.2, 3.45, ly, 2, 3);
  stack(23.5, 2.93, ly, 2, 1);
  bale(25.3, ly, 0.2, 1.2); // loose cover out on the floor
  bale(23.4, ly, -2.2, Math.PI / 2 - 0.2);
  prop('roundBale', 22.3, ly, 2.85, 0.05, { r: 0.7, straw: HAY });
  prop('hayPile', 24.4, ly, 1.1, 0.4, { r: 1.0, h: 0.55, straw: HAY });
  prop('hayPile', 22.2, ly, -5.2, 1.7, { r: 0.8, h: 0.3, straw: HAY }, { collide: false });
  prop('pitchfork', 24.0, ly + 0.25, 1.35, 0.9, {}, { collide: false })?.object.rotation.set(0.35, 0.9, -0.2);
  prop('crate', 25.8, ly, 3.3, 0.35);
  prop('lantern', 25.8, ly + 0.8, 3.3, 0.2);
  bale(22.3, ly, -4.1, Math.PI / 2 + 0.1); // low cover by the loft door

  // loose straw on the floors
  for (const [x, z, r] of [[23.2, -1.2, 0.9], [25.4, -5.2, 0.7], [28.4, -2.6, 1.0], [30.2, 2.2, 0.8], [32.6, 2.4, 0.8], [33.4, -1.2, 0.7], [29.4, -6.3, 0.6], [22.6, 1.4, 0.8]]) {
    prop('strawPatch', x, FL, z, rnd() * 6, { r, straw: HAY }, { collide: false });
  }
  for (const [x, z, r] of [[23.6, -4.6, 1.0], [25.2, -2.8, 0.8], [22.2, -0.4, 0.7], [24.7, 2.1, 0.9], [22.6, -5.6, 0.7]]) {
    prop('strawPatch', x, LOFT.y, z, rnd() * 6, { r, straw: HAY }, { collide: false });
  }

  // ------------------------------------------------------------------ lights
  lampW(23.9, LOFT.under, -2.0, 1, { cable: 0.45, intensity: 26 });
  lampW(31.85, 4.62, -1.8, 1, { cable: 1.45, intensity: 36, flicker: 0.25 });
  lampW(28.35, 4.62, -5.3, 1, { cable: 1.3, intensity: 28 });
  lampW(24.85, kn(1)[1] - 0.4, -4.4, 2, { cable: 1.8, intensity: 24 });
  lampW(22.7, BARN.ridge - 0.34, -1.3, 2, { cable: 3.25, intensity: 22, flicker: 0.4 });
  const flood = (x, y, z, rot, aim) => {
    const p = prop('floodLamp', x, y, z, rot, { reach: 0.55 }, { collide: false });
    const b = p?.anchors?.bulb ? p.anchors.bulb.clone().applyMatrix4(p.object.matrixWorld) : new THREE.Vector3(x, y - 0.1, z);
    const [wx, wz] = barnToWorld(b.x, b.z), [ax, az] = barnDir(aim[0], aim[2]);
    // an ordinary level.lamps entry: the generator circuit (world/power.js) picks it up like any lamp
    lamps.push({ pos: new THREE.Vector3(wx, b.y, wz), level: 1, color: 0xffd9a0, intensity: 62, angle: 1.05, distance: 22, flicker: 0.08, spot: true, porch: true, shadow: false, aim: new THREE.Vector3(ax, aim[1], az) });
  };
  flood(BARN.x0, 3.4, -5.15, -Math.PI / 2, [-4.5, -3.2, 0.6]);
  flood(BARN.x0, 3.4, 1.15, -Math.PI / 2, [-4.5, -3.2, -0.6]);
  flood(BARN.x1, 4.25, -2.0, Math.PI / 2, [4, -3.4, 0]);

  // ------------------------------------------------------------------ nav + ladder metadata
  const portals = [
    {
      id: LADDER.id,
      ladder: LADDER,
      always: true,
      enabled: true,
      a: { ...LADDER_A },
      b: { ...LADDER_B },
      cost: 8,
      path: [[LADDER_A.x, LADDER_A.z], [LADDER_B.x, LADDER_B.z]],
    },
  ];
  const cs = [[BARN.x0, BARN.z0], [BARN.x1, BARN.z0], [BARN.x1, BARN.z1], [BARN.x0, BARN.z1]].map(([x, z]) => barnToWorld(x, z));
  const radarSegments = cs.map((a, i) => [a[0], a[1], cs[(i + 1) % 4][0], cs[(i + 1) % 4][1]]);

  // the finished barn: local meshes under the turned root
  const local = B.finish();
  local.name = 'barnLocal';
  local.position.set(-BARN_XF.px, 0, -BARN_XF.pz);
  const root = new THREE.Group();
  root.name = 'barn';
  root.position.set(BARN_XF.wx, 0, BARN_XF.wz);
  root.rotation.y = BARN_XF.yaw;
  root.add(local);
  root.updateMatrixWorld(true);
  // the merged static boxes (vertex colours: barnFire.js chars them behind the fire front)
  const buckets = local.children.filter((m) => m.isMesh && m.geometry?.attributes?.color);
  return { root, buckets, portals, navBlocks: [], windows, radarSegments, ladders: [LADDER] };
}
