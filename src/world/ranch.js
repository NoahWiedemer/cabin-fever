// The ranch around the farmhouse: the barn (barn.js, turned 35° north-east of the house so the house's east
// side, the back door and the barn's big doors share one farmyard), gravel paths across that yard, the old
// tractor and a hay wagon, a fenced paddock with a scarecrow, round bales and troughs south-east of the barn,
// a windmill water pump with a stock tank and a chicken coop behind the house.
// Called from buildLevel() after the tree ring. Returns nav / fog / gas / radar metadata and update(dt)
// (the windmill turns in the wind).
import * as THREE from 'three';
import './ranchProps.js';
import { getMaterial } from './materials.js';
import { buildBarn } from './barn.js';
import { BARN, BARN_XF, PADDOCK, RANCH_BLOCKS, TREE_CLEAR, BARN_CLEAR_PAD, BARN_INSIDE, barnToWorld, inBarn, inRect } from './ranchLayout.js';

const Y0 = -0.5; // yard mud

/** True where no tree may stand (level.js tree ring). */
export function ranchClear(x, z) {
  return inBarn(x, z, BARN_CLEAR_PAD) || TREE_CLEAR.some((r) => inRect(r, x, z));
}

/** Zombie spawn points that land on the ranch are moved to free spots nearby (kept deterministic). */
const SPAWN_FALLBACK = [[37.6, -2.0], [21.5, -23.5], [36.5, -19.5], [37.4, 14.5]];
export function adjustSpawns(points) {
  let k = 0;
  for (const p of points) {
    if ((inBarn(p.x, p.z, 2.5) || RANCH_BLOCKS.some((r) => inRect(r, p.x, p.z, 2.5))) && k < SPAWN_FALLBACK.length) {
      const [x, z] = SPAWN_FALLBACK[k++];
      p.x = x;
      p.z = z;
    }
  }
  return points;
}

// ---------------------------------------------------------------- gravel path ribbon
function hash(i, s) {
  const v = Math.sin(i * 127.1 + s * 311.7) * 43758.5453;
  return v - Math.floor(v);
}
function noise1(t, s) {
  const i = Math.floor(t), f = t - i;
  const u = f * f * (3 - 2 * f);
  return hash(i, s) * (1 - u) + hash(i + 1, s) * u;
}
let pathMat = null;
function gravelMaterial() {
  if (pathMat) return pathMat;
  pathMat = getMaterial('gravel').clone();
  pathMat.userData = { ...getMaterial('gravel').userData };
  pathMat.vertexColors = true;
  // ragged edge: the vertex alpha fades out over the rim band and alphaTest cuts it at a noisy contour
  // (a blended ribbon washed out in the post chain, and opaque keeps it in the depth prepass for AO)
  pathMat.alphaTest = 0.5;
  pathMat.polygonOffset = true;
  pathMat.polygonOffsetFactor = -2;
  pathMat.polygonOffsetUnits = -4;
  pathMat.name = 'gravelPath';
  return pathMat;
}

/**
 * Worn gravel track along a Catmull-Rom curve through pts [[x,z],..]: ragged edges that fade into the mud
 * (vertex alpha), darker and wetter toward the rims. width(u) = half width at u 0..1.
 */
function gravelPath(pts, width, seed) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const len = curve.getLength();
  const n = Math.max(8, Math.ceil(len / 0.3));
  const mat = gravelMaterial();
  const mpr = mat.userData.metersPerRepeat || 1.4;
  const offs = [-1.35, -1, -0.4, 0, 0.4, 1, 1.35]; // across (x half width); outer ring = fade band
  const alpha = [0, 0.95, 1, 1, 1, 0.95, 0];
  const pos = [], col = [], uv = [], idx = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  const cols = offs.length;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    curve.getPointAt(u, p);
    curve.getTangentAt(u, t);
    const nx = -t.z, nz = t.x;
    const w = width(u) * (0.85 + 0.3 * noise1(i * 0.35, seed));
    for (let k = 0; k < cols; k++) {
      let o = offs[k];
      if (Math.abs(o) > 1.2) o = Math.sign(o) * (1 + (0.2 + 0.7 * noise1(i * 0.6 + k * 7, seed + 3)) / Math.max(0.6, w));
      else if (Math.abs(o) > 0.9) o = Math.sign(o) * (0.85 + 0.3 * noise1(i * 0.9 + k * 3, seed + 5));
      const x = p.x + nx * o * w, z = p.z + nz * o * w;
      pos.push(x, Y0 + 0.012 + 0.004 * noise1(i * 1.3 + k, seed + 9), z);
      uv.push(x / mpr, -z / mpr);
      const edge = Math.min(1, Math.abs(o) / 1.1);
      const shade = (0.78 + 0.22 * noise1(i * 0.5 + k * 2, seed + 11)) * (1 - 0.35 * edge * edge);
      col.push(shade, shade, shade, alpha[k] * (0.7 + 0.3 * noise1(i * 1.7 + k, seed + 13)));
    }
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < cols - 1; k++) {
      const a = i * cols + k, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the ribbon is flat: force straight-up normals (computeVertexNormals may flip on the winding)
  const nrm = g.attributes.normal;
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
  // winding so the top faces up
  const ia = g.index.array;
  const A = new THREE.Vector3(), Bv = new THREE.Vector3(), C = new THREE.Vector3();
  A.fromArray(pos, ia[0] * 3);
  Bv.fromArray(pos, ia[1] * 3);
  C.fromArray(pos, ia[2] * 3);
  if (Bv.sub(A).cross(C.sub(A)).y < 0) for (let i = 0; i < ia.length; i += 3) [ia[i + 1], ia[i + 2]] = [ia[i + 2], ia[i + 1]];
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.userData.noBatch = true;
  return mesh;
}

// ---------------------------------------------------------------- build
export function buildRanch(ctx) {
  const { B, prop, dynamic } = ctx;
  const barn = buildBarn(ctx);
  dynamic.add(barn.root); // its own merged meshes, turned: kept out of the level's world-space batching
  const sg = B.staticGroup;
  const yaw = BARN_XF.yaw;
  /** a prop placed in the barn's frame (next to its walls): local position, rotation relative to the barn */
  const byBarn = (type, lx, y, lz, rot = 0, opts = {}, placeOpts = {}) => {
    const [x, z] = barnToWorld(lx, lz);
    return prop(type, x, y, z, yaw + rot, opts, placeOpts);
  };
  const door = barnToWorld(BARN.x0, BARN.zc); // main doors (west gable), facing the house
  const f = [-BARN_XF.cos, BARN_XF.sin], t = [BARN_XF.sin, BARN_XF.cos]; // out of the doors / along the gable
  const at = (k, j) => [door[0] + f[0] * k + t[0] * j, door[1] + f[1] * k + t[1] * j];

  // ---- the farmyard: paths from the kitchen wall hole and the back door meet on a gravel apron at the doors
  sg.add(gravelPath([[13.3, 4.55], [14.9, 2.6], [16.3, -0.6], [17.8, -3.7], [19.2, -5.8], at(0.4, 0.2)], (u) => 0.75 + 0.7 * Math.max(0, (u - 0.75) / 0.25) ** 2, 1));
  sg.add(gravelPath([[0.1, -10.2], [4.5, -11.3], [9.5, -11.5], [13.6, -10.6], [16.8, -9.3], at(1.6, -1.0), at(0.4, -0.3)], (u) => 0.55 + 0.4 * Math.max(0, (u - 0.8) / 0.2) ** 2, 2));
  sg.add(gravelPath([at(1.3, -2.6), at(1.3, 0), at(1.3, 2.6)], () => 1.15, 3)); // apron along the gable
  {
    // a narrow track from the barn's side door round to the windmill
    const sd = barnToWorld(28.3, BARN.z0 - 0.8);
    sg.add(gravelPath([sd, [19.5, -18.0], [14.8, -18.6], [11.0, -18.4]], () => 0.45, 4));
  }

  // tractor, hay, wagon, barrels and cans round the yard
  prop('tractor', 14.0, Y0, -14.3, 2.75);
  prop('hayBale', 12.6, Y0, -13.0, 0.4);
  prop('hayWagon', 19.8, Y0, 1.2, yaw, { bales: 5 });
  byBarn('barrel', 20.1, Y0, 3.1);
  byBarn('barrel', 19.6, Y0, 2.4);
  byBarn('milkCans', 20.1, Y0, -8.8, 1.1, { n: 3 });

  // hay stacked against the barn's south wall outside, a round bale by its corner
  for (let i = 0; i < 3; i++) byBarn('hayBale', 29.4 + i * 1.03, Y0, BARN.z1 + 0.3, 0.02 * i);
  for (let i = 0; i < 2; i++) byBarn('hayBale', 29.9 + i * 1.03, Y0 + 0.4, BARN.z1 + 0.32, -0.03);
  byBarn('roundBale', 26.3, Y0, BARN.z1 + 1.0, 0.1, { r: 0.7 });

  // ---- paddock south-east of the barn: post-and-rail fence, a gate on the yard side, gaps north and south
  const P = PADDOCK;
  const fence = (x, z, rot, length, o = {}) => prop('postRailFence', x, Y0, z, rot, { length, ...o });
  fence(P.x0, P.z0, 0, 4.0); // north, gap x 27..29.4
  fence(29.4, P.z0, 0, P.x1 - 29.4);
  fence(P.x0, P.z1, 0, 6.2, { broken: 0.25 }); // south, broken stretch left open x 29.2..31.6
  fence(31.6, P.z1, 0, P.x1 - 31.6, { broken: 0.2 });
  fence(P.x1, P.z0, -Math.PI / 2, P.z1 - P.z0); // east (rot -PI/2 runs along +z)
  fence(P.x0, P.z0, -Math.PI / 2, 2.5); // west: rail, the gate swung open inwards, rail
  prop('fenceGate', P.x0, Y0, P.z0 + 2.6, -Math.PI / 2, { w: 3.0, open: Math.PI / 2, latchPost: true });
  fence(P.x0, P.z0 + 5.8, -Math.PI / 2, P.z1 - P.z0 - 5.8);
  prop('scarecrow', 29.5, Y0, 8.0, -Math.PI / 2 + 0.25);
  prop('roundBale', 25.2, Y0, 10.3, 0.35, { r: 0.72 });
  prop('roundBale', 27.0, Y0, 10.8, 1.4, { r: 0.72 });
  prop('roundBale', 32.3, Y0, 10.6, -0.3, { r: 0.7 });
  prop('stockTank', 25.3, Y0, 3.9, 0, { r: 0.75, h: 0.55 });
  prop('feedTrough', 32.2, Y0, 3.6, 0.1, { length: 1.8 });
  prop('hayPile', 30.8, Y0, 4.6, 0.4, { r: 0.8, h: 0.35 }, { collide: false });

  // ---- windmill water pump + stock tank and the chicken coop behind the house
  const WM = { x: 8.8, z: -18.6, rot: 0.4 };
  const mill = prop('windmill', WM.x, Y0, WM.z, WM.rot);
  let wheel = null;
  if (mill) {
    const hub = mill.anchors?.hub ? mill.anchors.hub.clone().applyMatrix4(mill.object.matrixWorld) : new THREE.Vector3(WM.x, Y0 + 9.5, WM.z);
    const w = prop('windmillWheel', hub.x, hub.y, hub.z, WM.rot, {}, { collide: false, dynamic: true });
    if (w) {
      dynamic.add(w.object);
      wheel = w.object;
      wheel.rotation.order = 'YXZ';
    }
  }
  {
    const c = Math.cos(WM.rot), s = Math.sin(WM.rot);
    const lx = 1.78, lz = 0.25; // tank beside the pump spout (local +x)
    prop('stockTank', WM.x + lx * c + lz * s, Y0, WM.z - lx * s + lz * c, 0, { r: 1.05 });
  }
  prop('chickenCoop', 3.4, Y0, -14.8, 0.1);
  prop('bucket', 5.0, Y0, -13.6, 0);
  fence(0.2, -19.6, 0, 6.6, { broken: 0.3 }); // the back yard's edge

  // ---- windmill: turns in the gusts, never quite stops
  let tt = Math.random() * 100;
  const update = (dt) => {
    if (!wheel) return;
    tt += dt;
    const gust = 0.55 + 0.35 * Math.sin(tt * 0.21) + 0.2 * Math.sin(tt * 0.53 + 1.3) + 0.1 * Math.sin(tt * 1.7);
    wheel.rotation.z -= dt * Math.max(0.12, gust) * 1.6;
  };

  return {
    ...barn,
    update,
    insideRects: [BARN_INSIDE],
  };
}
