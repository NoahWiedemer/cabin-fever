// Desert Thunder (MAPS.desert): Combat Arms' first Fireteam map, remade. Mogadishu at noon, the Sand Hog militia's
// quarter; the mission (game/desertMission.js) runs through it in four sectors, south to north:
//   1 the insertion route  the landing zone on the south edge (a lot between the ruins), the main street north (a side
//                          alley and a back yard off it), the cross street east: the burnt bus, the market stalls, the
//                          machine-gun nest at its end
//   2 the temple           the plaza before it; the anteroom, the courtyard between two arcades, the gates into the
//                          wings on either side (one of them locked), the wings with their stairs up, the great hall
//                          with its gallery, the room up there where they hold the officer; its front door is barred
//   3 the road             out through the hall's back door onto the back street; the ramp climbs to the old town on
//                          its terrace, the armoured car sits at the top of it; the way round: the alley east, a yard,
//                          the stairs up the terrace wall
//   4 the town             on the terrace: the square with its market, the office where the intel is hidden (the GPS
//                          mark), the compound wall with the gate, and behind it the crash site
// Two floors for the nav: the lower town at y 0 (level 1), the terrace, the hall's gallery and the wings' upper rooms at
// 3.4 (level 2); stairs and the ramp are portals. Houses are solid blocks dressed with windows, doors, shop shutters,
// signs, balconies (where the snipers stand), roof tanks and dishes; the temple's rooms are built wall by wall.
// Daylight: level.daylight (world/lighting.js turns the moon into the sun), the map's own sky dome, a dusty haze.
import * as THREE from 'three';
import { CollisionWorld, SURF, FLAG_NOBULLET } from './collision.js';
import { getMaterial } from './materials.js';
import { LevelBuilder } from './levelBuilder.js';
import { buildProp } from './propsSafe.js';
import { buildHelicopter } from './helicopter.js';
import { levelOf, FLOOR } from './level.js';
import { makeDesertMaterials, PLASTER } from './desertTextures.js';
import { Apc } from './apc.js';
import { DesertMission } from '../game/desertMission.js';

export const G = 0; // the lower town
export const U = 3.4; // the terrace (the old town), the gallery, the wings' upper floors
const STORY = 3.4; // m a floor (a roof never lands inside a nav level's walkable band: see block)
const BX0 = -72, BX1 = 72, BZ0 = -134, BZ1 = 96; // the playable bounds
const TERRACE_Z = -66; // the terrace wall (the old town north of it)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const FACE_YAW = { s: 0, e: Math.PI / 2, n: Math.PI, w: -Math.PI / 2 }; // (a thing facing +z has yaw 0)

// ---------------------------------------------------------------- the temple (sector 2)
export const TEMPLE = {
  x0: 22, x1: 62, z0: -30, z1: 32,
  ante: { x0: 22, x1: 32, z0: 18, z1: 32, door: [22, 28], arch: [21, 29], h: 6.6 },
  court: { x0: 32, x1: 56, z0: 0, z1: 32 },
  hall: { x0: 32, x1: 56, z0: -30, z1: 0, h: 9, door: [42, 46], back: [42, 46] },
  mezz: { z1: -14 }, // the gallery: z0 .. -14 at U
  room: { x0: 38, x1: 50, z0: -30, z1: -20, door: [43, 45] }, // the officer's room on the gallery
  wingW: { x0: 22, x1: 32 },
  wingE: { x0: 56, x1: 62 },
  gate: [4, 7], // the wings' gates off the courtyard (z)
  upper: -14, // the wings' upper floor: z0 .. -14 at U
  wingDoor: [-26, -24], // (z) the gallery's doors into the wings' upper rooms
};

// ---------------------------------------------------------------- 0..1-UV quads, merged per material
class Quads {
  constructor() {
    this.parts = new Map();
  }
  /** a w x h quad centred on (cx, cy, cz), facing `face` ('n' -z, 's' +z, 'e' +x, 'w' -x), its top tipped `tilt` rad out (negative: in, toward the wall) */
  add(mat, cx, cy, cz, face, w, h, tilt = 0) {
    const n = { s: [0, 0, 1], n: [0, 0, -1], e: [1, 0, 0], w: [-1, 0, 0] }[face];
    const r = { s: [1, 0, 0], n: [-1, 0, 0], e: [0, 0, -1], w: [0, 0, 1] }[face]; // (the viewer's right)
    const up = [n[0] * Math.sin(tilt), Math.cos(tilt), n[2] * Math.sin(tilt)];
    let a = this.parts.get(mat);
    if (!a) this.parts.set(mat, (a = { pos: [], nor: [], uv: [], idx: [] }));
    const base = a.pos.length / 3;
    const hw = w / 2, hh = h / 2;
    const nn = [n[0] * Math.cos(tilt), -Math.sin(tilt), n[2] * Math.cos(tilt)]; // (n cos - y sin)
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      a.pos.push(cx + r[0] * hw * su + up[0] * hh * sv, cy + up[1] * hh * sv, cz + r[2] * hw * su + up[2] * hh * sv);
      a.nor.push(nn[0], nn[1], nn[2]);
      a.uv.push((su + 1) / 2, (sv + 1) / 2);
    }
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(group) {
    for (const [mat, a] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(a.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(a.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(a.uv, 2));
      g.setIndex(a.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      m.matrixAutoUpdate = false;
      group.add(m);
    }
  }
}

// ---------------------------------------------------------------- the sky
function buildSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir.clone().normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * p;
        gl_Position.z = gl_Position.w * 0.99999; // (at the far plane)
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, -0.2, 1.0);
        // (deep and saturated: the tone mapping and the grade's warm highlights wash a sky out a lot)
        vec3 zenith = vec3(0.06, 0.20, 0.62);
        vec3 horizon = vec3(0.62, 0.62, 0.58);
        vec3 c = mix(horizon, zenith, pow(max(h, 0.0), 0.5));
        c = mix(c, horizon * 0.9, smoothstep(0.02, -0.2, h)); // (the dust below the horizon line)
        float s = max(dot(vDir, uSun), 0.0);
        c += vec3(1.0, 0.86, 0.6) * pow(s, 12.0) * 0.3 + vec3(1.0, 0.95, 0.85) * pow(s, 900.0) * 8.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false, // (drawn first, everything over it)
    fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// ---------------------------------------------------------------- the build
export function buildDesert(progress) {
  const { quads: QM } = makeDesertMaterials();
  const world = new CollisionWorld(BX0 - 10, BZ0 - 10, BX1 + 10, BZ1 + 10, 2);
  const B = new LevelBuilder(world);
  const Q = new Quads();
  const group = new THREE.Group();
  group.name = 'desert';
  const dyn = new THREE.Group(); // doors, the gate, the wreck's fire: things that move or change
  dyn.name = 'desertDynamic';
  group.add(dyn);
  let seed = 7771;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const rr = (a, b) => a + rnd() * (b - a);
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const radar = [];
  const nests = {}; // id -> { pos, yaw }: balconies and roofs the snipers stand on (game/desertMission.js)
  const updates = [];

  const prop = (type, x, y, z, rot = 0, o = {}, place = {}) => {
    let p = null;
    try {
      p = buildProp(type, { seed: Math.floor(rnd() * 1e5), ...o });
    } catch (e) {
      return null;
    }
    if (!p) return null;
    B.placeProp(p, x, y, z, rot, place);
    return p;
  };

  // ------------------------------------------------ helpers: the houses
  /**
   * A house: a solid block on (x0..x1, z0..z1) standing on y, `st` floors, `mat` its plaster, dressed on the faces
   * in `win` ('nsew'): windows per floor and bay, doors / shop fronts on the ground floor (doors / shops: [{ f, at }]
   * at 0..1 along the face), balconies (bal: [{ f, s (floor 1..), at, id }] where a sniper can stand), the roof's
   * parapet, a water tank, a dish, rebar where the next floor never got built.
   */
  const block = (o) => {
    const { x0, z0, x1, z1, y = G, st = 2 } = o;
    const mat = o.mat ?? pick(PLASTER);
    const h = STORY * st + 0.8;
    B.box(x0, y, z0, x1, y + h, z1, { mats: { py: 'dtRoof' }, mat, surface: SURF.concrete, floorY: y, ceilY: y + h, grime: 0.6 });
    // the parapet round the roof
    const t = 0.25, ph = 0.7, top = y + h;
    B.box(x0, top, z0, x1, top + ph, z0 + t, { mat, surface: SURF.concrete, grime: 0.3 });
    B.box(x0, top, z1 - t, x1, top + ph, z1, { mat, surface: SURF.concrete, grime: 0.3 });
    B.box(x0, top, z0 + t, x0 + t, top + ph, z1 - t, { mat, surface: SURF.concrete, grime: 0.3 });
    B.box(x1 - t, top, z0 + t, x1, top + ph, z1 - t, { mat, surface: SURF.concrete, grime: 0.3 });
    radar.push([x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
    const faces = o.win ?? 'nsew';
    const doors = o.doors ?? [], shops = o.shops ?? [], bals = o.bal ?? [];
    for (const f of faces) {
      const alongX = f === 's' || f === 'n';
      const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1, L = a1 - a0;
      const fixed = f === 's' ? z1 : f === 'n' ? z0 : f === 'e' ? x1 : x0;
      const out = f === 's' || f === 'e' ? 1 : -1;
      const n = Math.max(1, Math.floor(L / 3.2));
      const at = (u) => a0 + L * u;
      const P = (u, yy, off = 0.03) => (alongX ? [at(u), yy, fixed + out * off] : [fixed + out * off, yy, at(u)]);
      const busy = (s, u) => (s === 0 && [...doors, ...shops].some((d) => d.f === f && Math.abs(d.at - u) * L < 2.2)) || bals.some((b) => b.f === f && b.s === s && Math.abs(b.at - u) * L < 1.8);
      for (let s = 0; s < st; s++) {
        for (let b = 0; b < n; b++) {
          const u = (b + 0.5) / n;
          if (busy(s, u)) continue;
          if (rnd() < 0.12) continue; // (a blank stretch of wall)
          const [cx, cy, cz] = P(u, y + s * STORY + 1.75);
          Q.add(pick(QM.window), cx, cy, cz, f, 1.05, 1.45);
          // the sill
          const [sx, sy, sz] = P(u, y + s * STORY + 0.98, 0.1);
          if (alongX) B.box(sx - 0.62, sy - 0.05, sz - 0.1, sx + 0.62, sy + 0.03, sz + 0.1, { mat, collide: false, grime: 0.2 });
          else B.box(sx - 0.1, sy - 0.05, sz - 0.62, sx + 0.1, sy + 0.03, sz + 0.62, { mat, collide: false, grime: 0.2 });
          // an air conditioner now and then, up high
          if (s > 0 && rnd() < 0.18) {
            const [ax, ay, az] = P(u + 0.55 / L, y + s * STORY + 1.15, 0.28);
            const unit = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.75 : 0.5, 0.5, alongX ? 0.5 : 0.75), getMaterial('metalDark'));
            unit.position.set(ax, ay, az);
            B.staticGroup.add(unit);
          }
        }
      }
      for (const d of doors.filter((d) => d.f === f)) {
        const [cx, , cz] = P(d.at, 0);
        Q.add(pick(QM.door), cx, y + 1.12, cz, f, 1.15, 2.2);
        const [sx, , sz] = P(d.at, 0, 0.25);
        if (alongX) B.box(sx - 0.8, y, sz - 0.25, sx + 0.8, y + 0.12, sz + 0.25, { mat: 'dtConcrete', collide: false });
        else B.box(sx - 0.25, y, sz - 0.8, sx + 0.25, y + 0.12, sz + 0.8, { mat: 'dtConcrete', collide: false });
      }
      for (const d of shops.filter((d) => d.f === f)) {
        const [cx, , cz] = P(d.at, 0);
        Q.add(pick(QM.shutter), cx, y + 1.25, cz, f, 2.9, 2.5);
        const [gx, , gz] = P(d.at, 0, 0.06);
        Q.add(pick(QM.sign), gx, y + 2.95, gz, f, 3.0, 0.75);
        if (d.awning !== false) {
          const [wx, , wz] = P(d.at, 0, 0.7);
          Q.add(pick(QM.awning), wx, y + 2.55, wz, f, 3.1, 1.5, -1.05); // (high at the wall, low out front)
        }
      }
      for (const b of bals.filter((b) => b.f === f)) {
        // a balcony: its slab, a low wall round three sides, the door behind: where a sniper stands
        const by = y + b.s * STORY + 0.1, w = b.w ?? 2.6, dep = 1.15;
        const [cx, , cz] = P(b.at, 0, 0);
        const fx = alongX ? 0 : out, fz = alongX ? out : 0;
        const ox = cx + fx * dep / 2, oz = cz + fz * dep / 2;
        const hx = alongX ? w / 2 : dep / 2, hz = alongX ? dep / 2 : w / 2;
        B.box(ox - hx, by - 0.18, oz - hz, ox + hx, by, oz + hz, { mat, surface: SURF.concrete, grime: 0.4 });
        const wt = 0.12, wh = 1.0;
        const ex = cx + fx * dep, ez = cz + fz * dep; // (the front edge)
        if (alongX) {
          B.box(ox - hx, by, ez - (out > 0 ? wt : 0), ox + hx, by + wh, ez + (out > 0 ? 0 : wt), { mat, surface: SURF.concrete, grime: 0.3 });
          for (const sx of [-1, 1]) B.box(ox + sx * hx - (sx > 0 ? wt : 0), by, Math.min(cz, ez), ox + sx * hx + (sx > 0 ? 0 : wt), by + wh, Math.max(cz, ez), { mat, surface: SURF.concrete, grime: 0.3 });
        } else {
          B.box(ex - (out > 0 ? wt : 0), by, oz - hz, ex + (out > 0 ? 0 : wt), by + wh, oz + hz, { mat, surface: SURF.concrete, grime: 0.3 });
          for (const sz of [-1, 1]) B.box(Math.min(cx, ex), by, oz + sz * hz - (sz > 0 ? wt : 0), Math.max(cx, ex), by + wh, oz + sz * hz + (sz > 0 ? 0 : wt), { mat, surface: SURF.concrete, grime: 0.3 });
        }
        const [dx, , dz] = P(b.at, 0);
        Q.add(pick(QM.door), dx, by + 1.1, dz, f, 1.1, 2.2);
        if (b.id) nests[b.id] = { pos: V(cx + fx * 0.55, by, cz + fz * 0.55), yaw: FACE_YAW[f] };
      }
    }
    // the roof: a water tank on legs, a dish, rebar where the next floor was never built
    const rx = (x0 + x1) / 2, rz = (z0 + z1) / 2;
    if (o.tank ?? rnd() < 0.5) {
      const tx = x0 + 1.5 + rnd() * Math.max(0.1, x1 - x0 - 3), tz = z0 + 1.5 + rnd() * Math.max(0.1, z1 - z0 - 3);
      const legM = getMaterial('metalDark');
      for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), legM);
        l.position.set(tx + lx, top + 0.55, tz + lz);
        B.staticGroup.add(l);
      }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.4, 16), getMaterial(rnd() < 0.5 ? 'blackPlastic' : 'dtTinBlue'));
      tank.position.set(tx, top + 1.8, tz);
      tank.castShadow = true;
      B.staticGroup.add(tank);
    }
    if (o.dish ?? rnd() < 0.35) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8, 0, Math.PI * 2, 0, 0.9), getMaterial('chrome'));
      d.position.set(rx + rr(-1, 1), top + 0.9, rz + rr(-1, 1));
      d.rotation.set(-0.9, rr(0, 6), 0);
      B.staticGroup.add(d);
    }
    if (o.rebar ?? rnd() < 0.3) {
      const m = getMaterial('rustyMetal');
      for (const [cx, cz] of [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x0 + 0.4, z1 - 0.4], [x1 - 0.4, z1 - 0.4]]) {
        for (let k = 0; k < 4; k++) {
          const r = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.2, 4), m);
          r.position.set(cx + (k % 2) * 0.12 - 0.06, top + 0.6, cz + Math.floor(k / 2) * 0.12 - 0.06);
          r.rotation.set(rr(-0.15, 0.15), 0, rr(-0.15, 0.15));
          B.staticGroup.add(r);
        }
      }
    }
    if (o.roofPost) for (const [id, px, pz, yaw] of o.roofPost) nests[id] = { pos: V(px, top, pz), yaw };
    return { top, h };
  };

  /** a low wall (compound walls, the lot's broken edge): x/z extents, height, material */
  const wall = (x0, z0, x1, z1, h, mat = 'dtConcrete', y = G) => {
    B.box(x0, y, z0, x1, y + h, z1, { mat, surface: SURF.concrete, grime: 0.5, floorY: y, ceilY: y + h });
    radar.push([x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
  };

  /** rubble: a heap of broken concrete (a blocked gap, a collapse) */
  const rubble = (x, z, r, h = 1.2, y = G, collide = true) => {
    const m = getMaterial('dtConcrete');
    for (let i = 0; i < 9; i++) {
      const s = rr(0.4, 1.1);
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s * rr(0.4, 0.8), s * rr(0.6, 1)), m);
      const a = rnd() * 6.28, d = rnd() * r;
      c.position.set(x + Math.cos(a) * d, y + rr(0.1, h * 0.7) * (1 - d / (r + 0.01)), z + Math.sin(a) * d);
      c.rotation.set(rnd(), rnd() * 6, rnd());
      c.castShadow = true;
      B.staticGroup.add(c);
    }
    if (collide) world.add(x - r * 0.8, y, z - r * 0.8, x + r * 0.8, y + h * 0.8, z + r * 0.8, SURF.concrete);
  };

  /** a palm: a leaning, ringed trunk and a crown of fronds */
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6e5a42, roughness: 0.95 });
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x4f6a2a, roughness: 0.8, side: THREE.DoubleSide });
  const palm = (x, z, y = G, h = rr(6, 9)) => {
    const lean = rr(-0.25, 0.25), dir = rr(0, 6.28);
    const tip = V(x + Math.cos(dir) * Math.sin(lean) * h, y + h, z + Math.sin(dir) * Math.sin(lean) * h);
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const a = V(x, y, z).lerp(tip, i / segs), b = V(x, y, z).lerp(tip, (i + 1) / segs);
      const r0 = 0.24 - i * 0.012;
      const g = new THREE.CylinderGeometry(r0 - 0.02, r0, a.distanceTo(b) * 1.02, 8);
      const m = new THREE.Mesh(g, trunkMat);
      m.position.copy(a).lerp(b, 0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      m.castShadow = true;
      B.staticGroup.add(m);
    }
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * 6.28 + rr(-0.2, 0.2), len = rr(2.6, 3.6), droop = rr(0.35, 0.8);
      const g = new THREE.PlaneGeometry(0.7, len, 1, 4);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = Math.min(1, Math.max(0, (p.getY(i) + len / 2) / len)); // 0 at the crown .. 1 at the tip (clamped: pow of -0 is NaN)
        p.setZ(i, -Math.pow(v, 1.6) * droop * len * 0.45);
        p.setX(i, p.getX(i) * (1 - v * 0.8));
      }
      g.computeVertexNormals();
      g.translate(0, len / 2, 0);
      const m = new THREE.Mesh(g, frondMat);
      m.position.copy(tip);
      m.rotation.set(-1.15 + rr(-0.2, 0.25), a, 0, 'YXZ');
      m.castShadow = true;
      B.staticGroup.add(m);
    }
    world.add(x - 0.3, y, z - 0.3, x + 0.3, y + 2.5, z + 0.3, SURF.wood);
  };

  // ------------------------------------------------ the ground
  // the lower town: sand everywhere, the streets packed dirt a hair above it
  B.box(BX0 - 30, G - 0.6, TERRACE_Z, BX1 + 30, G, BZ1 + 30, { mat: 'dtSand', surface: SURF.mud, grime: 0 });
  const street = (x0, z0, x1, z1) => B.box(x0, G, z0, x1, G + 0.012, z1, { mat: 'dtDirt', surface: SURF.mud, grime: 0, castShadow: false });
  street(-36, 36, -26, 72); // the main street
  street(-40, 26, 6, 38); // the cross street
  street(-26, 54, -10, 58); // the side alley
  street(-10, 38, 2, 60); // the back yard
  street(6, 8, 22, 44); // the plaza
  street(14, -40, 62, -30); // the back street
  street(48, -60, 52, -40); // the east alley
  street(52, -66, 72, -54); // the yard under the terrace wall
  // the terrace: the old town's ground, its wall (the retaining wall) on the south
  B.box(BX0 - 30, G, BZ0 - 30, BX1 + 30, U, TERRACE_Z, { mats: { py: 'dtSand', pz: 'dtStone' }, mat: 'dtStone', surface: SURF.concrete, grime: 0.6, floorY: G, ceilY: U });
  radar.push([BX0, TERRACE_Z, 24, TERRACE_Z], [34, TERRACE_Z, BX1, TERRACE_Z]);
  const ustreet = (x0, z0, x1, z1) => B.box(x0, U, z0, x1, U + 0.012, z1, { mat: 'dtDirt', surface: SURF.mud, grime: 0, castShadow: false });
  ustreet(20, -86, 38, -66); // the ramp's top (the armoured car's square)
  ustreet(-40, -112, 10, -78); // the town square
  ustreet(10, -92, 20, -78); // the street between them
  ustreet(38, -72, 58, -66); // the lane along the terrace edge (from the stairs)
  ustreet(-40, -134, 10, -112); // the crash site

  // ------------------------------------------------ sector 1: the landing zone, the main street, the cross street
  // the lot: sand, a broken wall along its south edge (a gap in it), a car wreck, a burnt-out truck, drums
  wall(-50, 93.6, -34, 94.2, 2.1, 'dtPlasterSand');
  wall(-30, 93.6, -14, 94.2, 2.1, 'dtPlasterSand');
  rubble(-32, 94.4, 1.6, 0.9);
  prop('carWreck', -43, G, 86, 0.5, {}, { surface: SURF.metal });
  prop('carWreck', -18, G, 79, -1.2, {}, { surface: SURF.metal });
  prop('oilDrumFire', -24, G, 88);
  prop('barrel', -46, G, 76, 0);
  prop('barrel', -45.3, G, 76.6, 0.4);
  prop('tireStack', -16, G, 90, 0);
  prop('debrisPile', -38, G, 91, 1, {}, { collide: false });
  palm(-47, 91, G, 7.5);
  // the houses round it
  block({ x0: -62, z0: 60, x1: -50, z1: 96, st: 2, win: 'e', doors: [{ f: 'e', at: 0.3 }], bal: [{ f: 'e', s: 1, at: 0.7, id: 'lzW' }] });
  block({ x0: -14, z0: 72, x1: 4, z1: 96, st: 2, win: 'w', doors: [{ f: 'w', at: 0.5 }], roofPost: [['lzE', -12.8, 80, -Math.PI / 2]] });
  block({ x0: -52, z0: 58, x1: -36, z1: 72, st: 2, win: 'se', shops: [{ f: 'e', at: 0.45 }], bal: [{ f: 's', s: 1, at: 0.6, id: 'mainW1' }] });
  block({ x0: -26, z0: 58, x1: -12, z1: 72, st: 2, win: 'sw', doors: [{ f: 'w', at: 0.7 }], shops: [{ f: 's', at: 0.4 }] });
  // the dead-end alley west of the main street (junk), the side alley east to the back yard
  prop('crate', -45, G, 56, 0.3);
  prop('cardboardStack', -41, G, 55.5, 1.2);
  rubble(-51, 56, 1.4, 1.6);
  block({ x0: -52, z0: 38, x1: -36, z1: 54, st: 3, win: 'nse', shops: [{ f: 'e', at: 0.3 }], bal: [{ f: 'e', s: 2, at: 0.75, id: 'mainW2' }] });
  block({ x0: -26, z0: 38, x1: -10, z1: 54, st: 2, win: 'nsw', doors: [{ f: 'w', at: 0.35 }], roofPost: [['mainE', -24.8, 46, -Math.PI / 2]] });
  // the main street's clutter
  prop('carWreck', -29, G, 64, 0.08, {}, { surface: SURF.metal });
  prop('sandbags', -31, G, 48, 0);
  prop('sandbags', -33.5, G, 44, 0.2);
  prop('barrel', -35.2, G, 60, 0);
  prop('woodPile', -27, G, 52, 1.57);
  // the back yard: a well, laundry, a shed, junk
  prop('well', -4, G, 49, 0);
  prop('crate', -8.6, G, 42, 0.1);
  prop('crate', -8.4, G, 43.2, 0.5);
  prop('wheelbarrow', 0.5, G, 55, 2.2);
  prop('carWreck', -3, G, 41, 1.9, {}, { surface: SURF.metal });
  block({ x0: -12, z0: 60, x1: 2, z1: 72, st: 1, win: 'sw', doors: [{ f: 's', at: 0.5 }], roofPost: [['yardN', -5, 61.2, 0]] });
  block({ x0: 2, z0: 44, x1: 22, z1: 72, st: 2, win: 'nw', doors: [{ f: 'w', at: 0.6 }], bal: [{ f: 'n', s: 1, at: 0.7, id: 'plazaS' }] });
  // laundry lines across the yard
  {
    const m = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 });
    const cloth = [0xc8b89a, 0x8a3a30, 0x3a5a7a, 0xd8d0c0, 0x6a7a4a];
    for (const [ax, az, bx, bz, y] of [[-10, 46, 2, 47, 3.1], [-10, 52, 2, 51, 3.3]]) {
      const a = V(ax, y, az), b = V(bx, y, bz);
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, a.distanceTo(b), 4), m);
      line.position.copy(a).lerp(b, 0.5);
      line.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      B.staticGroup.add(line);
      for (let k = 1; k < 7; k++) {
        const p = a.clone().lerp(b, k / 7);
        const c = new THREE.Mesh(new THREE.PlaneGeometry(rr(0.5, 0.9), rr(0.6, 1.0)), new THREE.MeshStandardMaterial({ color: pick(cloth), roughness: 0.9, side: THREE.DoubleSide }));
        c.position.set(p.x, y - 0.45, p.z);
        c.rotation.y = Math.atan2(bx - ax, bz - az) + Math.PI / 2;
        c.castShadow = true;
        B.staticGroup.add(c);
      }
    }
  }
  // the cross street: its north side (shops, the stalls), the west end closed off
  block({ x0: -56, z0: 26, x1: -40, z1: 38, st: 2, win: 'e', roofPost: [['crossW', -41.2, 32, Math.PI / 2]] });
  block({ x0: -56, z0: 8, x1: -40, z1: 26, st: 3, win: 'e' });
  block({ x0: -40, z0: 8, x1: -22, z1: 26, st: 2, win: 's', shops: [{ f: 's', at: 0.3 }, { f: 's', at: 0.72 }], bal: [{ f: 's', s: 1, at: 0.5, id: 'crossN1' }] });
  rubble(-21, 24, 1.3, 2.4);
  block({ x0: -20, z0: 8, x1: -6, z1: 26, st: 3, win: 's', shops: [{ f: 's', at: 0.5 }], roofPost: [['crossN2', -13, 24.8, 0]] });
  rubble(-5, 24, 1.2, 2.4);
  block({ x0: -4, z0: 8, x1: 6, z1: 26, st: 2, win: 'se', shops: [{ f: 's', at: 0.5, awning: false }] });
  // the burnt bus across the street (cover), the market stalls before the shops
  buildBus(B, world, -15.5, 31, 0.18);
  for (const [sx, sz] of [[-33, 24.2], [-29, 24.2], [-13, 24.2]]) stall(B, Q, QM, sx, sz, pick);
  prop('sandbags', -3.5, G, 34, 1.57);
  prop('barrel', -38.6, G, 36.4, 0);
  prop('carWreck', -36.5, G, 29.5, 1.4, {}, { surface: SURF.metal });
  // the machine gun's nest at the plaza's mouth: sandbags in an L round it, facing down the street
  for (const [x, z, r] of [[8.4, 29.2, 1.57], [8.4, 31.6, 1.57], [8.4, 34.0, 1.57], [9.8, 35.4, 0]]) prop('sandbags', x, G, z, r);
  nests.mgCross = { pos: V(10.2, G, 31.6), yaw: -Math.PI / 2 };

  // ------------------------------------------------ the plaza before the temple
  prop('carWreck', 13, G, 38, 2.6, {}, { surface: SURF.metal });
  prop('carWreck', 18, G, 12, 0.3, {}, { surface: SURF.metal });
  palm(9, 11, G, 8);
  palm(19.5, 41, G, 6.8);
  {
    // a dry fountain in the middle
    B.box(12.2, G, 20.2, 15.8, G + 0.7, 23.8, { mat: 'dtStone', surface: SURF.concrete, grime: 0.4 });
    B.box(13.4, G + 0.7, 21.4, 14.6, G + 1.6, 22.6, { mat: 'dtStone', surface: SURF.concrete, grime: 0.3 });
  }
  block({ x0: 6, z0: -30, x1: 22, z1: 8, st: 2, win: 's', bal: [{ f: 's', s: 1, at: 0.4, id: 'plazaN' }] });
  block({ x0: -22, z0: -30, x1: 6, z1: 6, st: 2, win: 's' });
  block({ x0: -56, z0: -30, x1: -24, z1: 8, st: 3, win: '' });
  // (the west edge, filled: the town goes on, the fight doesn't)
  block({ x0: -72, z0: -66, x1: -56, z1: 60, st: 2, win: '' });
  block({ x0: -56, z0: 38, x1: -52, z1: 60, st: 2, win: '' });

  // ------------------------------------------------ sector 2: the temple
  const temple = buildTemple(B, Q, QM, world, dyn, radar, nests, { rnd, rr, pick, prop, palm });
  block({ x0: 22, z0: 32, x1: 62, z1: 44, st: 2, win: 'w' });
  block({ x0: 62, z0: -30, x1: 72, z1: 44, st: 2, win: '' });
  block({ x0: 22, z0: 44, x1: 44, z1: 72, st: 2, win: 'w' });
  block({ x0: 44, z0: 44, x1: 72, z1: 96, st: 3, win: '' });
  block({ x0: 4, z0: 72, x1: 44, z1: 96, st: 2, win: 'w' });

  // ------------------------------------------------ sector 3: the back street, the ramp, the way round
  // the ramp up to the terrace (x 24..34, z -66..-40): steps for the feet, a smooth deck to look at, walls on its sides
  const RAMP = { x0: 24, x1: 34, z0: TERRACE_Z, z1: -40 };
  {
    const n = 20;
    for (let i = 0; i < n; i++) {
      const za = RAMP.z1 - ((RAMP.z1 - RAMP.z0) * i) / n, zb = RAMP.z1 - ((RAMP.z1 - RAMP.z0) * (i + 1)) / n;
      world.add(RAMP.x0, G, zb, RAMP.x1, G + (U * (i + 1)) / n, za, SURF.mud, 1); // (FLAG_STAIR: the nav takes it by a portal)
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(RAMP.x1 - RAMP.x0, 0.3, Math.hypot(RAMP.z1 - RAMP.z0, U)), getMaterial('dtDirt'));
    deck.position.set((RAMP.x0 + RAMP.x1) / 2, U / 2 - 0.13, (RAMP.z0 + RAMP.z1) / 2);
    deck.rotation.x = Math.atan2(U, RAMP.z1 - RAMP.z0);
    deck.receiveShadow = true;
    B.staticGroup.add(deck);
  }
  block({ x0: -56, z0: -66, x1: -10, z1: -40, st: 2, win: 's' });
  block({ x0: -56, z0: -40, x1: 14, z1: -30, st: 2, win: 'n' }); // (closes the back street's west end)
  block({ x0: -10, z0: -66, x1: 10, z1: -40, st: 2, win: 's', bal: [{ f: 's', s: 1, at: 0.5, id: 'backW' }] });
  block({ x0: 10, z0: -66, x1: 24, z1: -40, st: 2, win: 'se', doors: [{ f: 's', at: 0.5 }] });
  block({ x0: 34, z0: -66, x1: 48, z1: -44, st: 2, win: 'sw', roofPost: [['rampE', 35.2, -50, -Math.PI / 2]] });
  block({ x0: 52, z0: -54, x1: 64, z1: -40, st: 2, win: 'nsw', doors: [{ f: 'w', at: 0.5 }], bal: [{ f: 'n', s: 1, at: 0.3, id: 'yardS' }] });
  block({ x0: 64, z0: -54, x1: 72, z1: -30, st: 2, win: 'n' });
  rubble(61, -35, 1.5, 2.2); // (the back street's east end: blocked)
  prop('carWreck', 40, G, -35, 1.6, {}, { surface: SURF.metal });
  prop('sandbags', 22, G, -36, 0);
  prop('barrel', 49, G, -58, 0);
  prop('crate', 50.8, G, -47, 0.2);
  prop('tireStack', 60, G, -60, 0);
  prop('woodPile', 68, G, -58.5, 0);
  // the stairs up the terrace wall, from the yard (x 62 -> 56, against the wall), a landing, onto the terrace
  const STAIR = { x0: 56, x1: 62, z0: -66, z1: -64.2 };
  B.stairs({ axis: 'x', x0: STAIR.z0 + 0.02, x1: STAIR.z1, s0: STAIR.x1, s1: STAIR.x0, yBottom: G, yTop: U, steps: 18, solid: true, mat: 'dtConcrete', riser: 'dtConcrete', surface: SURF.concrete });
  B.box(52, G, -66, 56, U, -64.2, { mat: 'dtConcrete', surface: SURF.concrete, grime: 0.5 }); // the landing (on a block)
  B.box(52, U, -64.4, 62, U + 1.0, -64.2, { mat: 'dtConcrete', surface: SURF.concrete, collide: false }); // (a low rail along it)
  world.add(52, U, -64.4, 56, U + 1.0, -64.2, SURF.concrete, FLAG_NOBULLET);

  // ------------------------------------------------ sector 4: the old town on the terrace
  block({ x0: 58, z0: -92, x1: 72, z1: -72, y: U, st: 2, win: 'wn' });
  block({ x0: 40, z0: -88, x1: 52, z1: -74, y: U, st: 2, win: 'nsw', roofPost: [['apcE', 41, -80, -Math.PI / 2]] });
  block({ x0: 58, z0: -72, x1: 72, z1: -66, y: U, st: 1, win: 'w' });
  block({ x0: 20, z0: -112, x1: 38, z1: -92, y: U, st: 2, win: 'sw', bal: [{ f: 's', s: 1, at: 0.3, id: 'apcN' }] });
  block({ x0: 38, z0: -134, x1: 72, z1: -92, y: U, st: 2, win: 'sw' });
  block({ x0: -40, z0: -78, x1: 10, z1: -66, y: U, st: 2, win: 'n', shops: [{ f: 'n', at: 0.25 }, { f: 'n', at: 0.6 }], bal: [{ f: 'n', s: 1, at: 0.82, id: 'sqS' }] });
  block({ x0: 10, z0: -78, x1: 20, z1: -66, y: U, st: 2, win: 'ne' });
  block({ x0: 10, z0: -112, x1: 20, z1: -92, y: U, st: 3, win: 'sw', roofPost: [['sqE', 11.2, -100, -Math.PI / 2]] });
  block({ x0: -72, z0: -78, x1: -40, z1: -66, y: U, st: 2, win: 'n' });
  // the office (the intel): enterable; its front on the square
  const office = buildOffice(B, Q, QM, world, radar, { x0: -60, x1: -40, z0: -108, z1: -84, y: U });
  block({ x0: -72, z0: -108, x1: -60, z1: -78, y: U, st: 2, win: 'e' });
  block({ x0: -60, z0: -84, x1: -40, z1: -78, y: U, st: 2, win: 'n' });
  block({ x0: -72, z0: -134, x1: -40, z1: -108, y: U, st: 2, win: 'e', bal: [{ f: 'e', s: 1, at: 0.8, id: 'crashW' }] });
  block({ x0: 10, z0: -134, x1: 38, z1: -112, y: U, st: 2, win: 'w' });
  // the square: the market (stalls, awnings), a water tower, cars, a dry trough
  for (const [sx, sz] of [[-30, -84], [-24, -84], [-18, -84], [-30, -98], [-24, -98]]) stall(B, Q, QM, sx, sz, pick, U);
  waterTower(B, world, 2, -104, U);
  prop('carWreck', -8, U, -90, 0.9, {}, { surface: SURF.metal });
  prop('carWreck', -36, U, -106, 2.2, {}, { surface: SURF.metal });
  prop('sandbags', -12, U, -80.5, 0);
  prop('sandbags', 4, U, -95, 1.57);
  prop('barrel', 8, U, -83, 0);
  prop('barrel', 8.6, U, -83.7, 0.5);
  palm(-38, -80, U, 7);
  // the armoured car's square: sandbags, a burnt car
  prop('sandbags', 22, U, -70, 1.57);
  prop('carWreck', 36, U, -84, 0.4, {}, { surface: SURF.metal });
  // the compound wall with the gate, the crash site behind it
  wall(-40, -112.4, -16, -111.6, 4.2, 'dtConcrete', U);
  wall(-8, -112.4, 10, -111.6, 4.2, 'dtConcrete', U);
  const gate = buildGate(B, world, dyn, -16, -8, -112, U);
  // the armoured car at the top of the ramp, facing down it (world/apc.js; the mission wakes it)
  const apc = new Apc(group, world, 29, U, -75, 0);
  updates.push((dt) => {
    for (const d of [temple.doors.front, temple.doors.back, temple.doors.gateW, temple.doors.gateE, gate]) d.update(dt);
  });
  const wreck = buildWreck(B, world, dyn, updates, -14, -124, U);

  // ------------------------------------------------ the bounds: the city goes on out there (and a wall keeps you in)
  for (const [x0, z0, x1, z1] of [[BX0 - 40, BZ0 - 40, BX1 + 40, BZ0], [BX0 - 40, BZ1, BX1 + 40, BZ1 + 40], [BX0 - 40, BZ0, BX0, BZ1], [BX1, BZ0, BX1 + 40, BZ1]]) world.add(x0, -5, z0, x1, 40, z1, SURF.concrete);
  {
    const r2 = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 70; i++) {
      const side = i % 4, w = 8 + r2() * 14, d = 8 + r2() * 12, h = 4 + r2() * 12;
      let x, z;
      if (side === 0) (x = BX0 - 8 - r2() * 40), (z = BZ0 + r2() * (BZ1 - BZ0));
      else if (side === 1) (x = BX1 + 8 + r2() * 40), (z = BZ0 + r2() * (BZ1 - BZ0));
      else if (side === 2) (x = BX0 + r2() * (BX1 - BX0)), (z = BZ1 + 8 + r2() * 40);
      else (x = BX0 + r2() * (BX1 - BX0)), (z = BZ0 - 8 - r2() * 40);
      const y = z < TERRACE_Z ? U : G;
      B.box(x - w / 2, y, z - d / 2, x + w / 2, y + h, z + d / 2, { mat: PLASTER[i % PLASTER.length], mats: { py: 'dtRoof' }, collide: false, grime: 0.4 });
    }
  }

  // ------------------------------------------------ finish
  const built = B.finish();
  group.add(built);
  Q.build(group);
  const sunDir = V(-0.45, 0.82, 0.35);
  const sky = buildSky(sunDir);
  group.add(sky);
  group.add(temple.group);

  // ------------------------------------------------ nav: portals (stairs, the ramp) and blocks
  const portals = [
    { id: 'ramp', a: { level: 1, x: 29, z: -38.6 }, b: { level: 2, x: 29, z: -68 }, cost: 10, enabled: true, always: true, path: [[29, -38.6], [29, -68]] },
    { id: 'terraceStairs', a: { level: 1, x: 63.4, z: -65.1 }, b: { level: 2, x: 54, z: -67.2 }, cost: 9, enabled: true, always: true, path: [[63.4, -65.1], [55.5, -65.1], [54, -67.2]] },
    ...temple.portals,
  ];
  const navBlocks = [
    { level: 1, rect: [RAMP.x0 - 0.1, RAMP.x1 + 0.1, RAMP.z0 - 0.1, RAMP.z1 + 0.1] },
    { level: 2, rect: [RAMP.x0 - 0.1, RAMP.x1 + 0.1, RAMP.z0 - 0.1, RAMP.z1 + 0.1] },
    { level: 1, rect: [STAIR.x0 - 0.1, STAIR.x1 + 0.1, STAIR.z0 - 0.1, STAIR.z1 + 0.1] },
    ...temple.navBlocks,
  ];

  // ------------------------------------------------ gameplay data
  const playerSpawn = V(-32, G, 82);
  const defensePosts = [
    { pos: V(-32, G, 82), face: 0, level: 1 },
    { pos: V(-29.5, G, 84.5), face: 0, level: 1 },
    { pos: V(-34.5, G, 84.5), face: 0, level: 1 },
    { pos: V(-32, G, 87), face: 0, level: 1 },
  ];
  const isSheltered = (x, y, z) => (temple.inside(x, y, z) || office.inside(x, y, z) ? 1 : 0);
  const refs = { nests, temple, office, gate, wreck, apc, ramp: RAMP, stair: STAIR, sunDir };
  const mission = new DesertMission(refs);
  const level = {
    id: 'desert',
    group,
    world,
    lamps: [],
    windows: [],
    spawnPoints: [],
    spawnBand: [20, 60],
    portals,
    navBlocks,
    navOpts: { minX: BX0, maxX: BX1, minZ: BZ0, maxZ: BZ1 },
    entrances: [],
    barricadeSpots: [],
    breachSpots: [],
    radarSegments: radar,
    specialSpots: {},
    generator: null,
    defensePosts,
    lab: null,
    shaft: null,
    playerSpawn,
    playerYaw: 0, // (north, up the lot toward the main street)
    shop: false,
    unlocks: [],
    story: false,
    stalker: false,
    landmarks: false,
    stalkerHouse: null,
    bigMap: true,
    events: [],
    squad: false,
    eventCenter: 'team',
    eventClear: () => true,
    powerPole: V(0, 8, 0),
    inHouse: () => false,
    // noon (world/lighting.js, core/renderer.js grade, game.js fog): the sun high in the south-west, a hazy sky
    daylight: { sunDir: [sunDir.x, sunDir.y, sunDir.z], sun: 3.4, sunColor: 0xfff0d6, sky: 0xa6c4e6, ground: 0xc8a878, hemi: 0.85, shadeSky: 0x8e95a2, shadeGround: 0xa2825c, fog: 0xcbbfa6, fogOut: 0.0015, exposure: 0.92, saturation: 1.02, contrast: 1.1, vignette: 0.4, env: 0.75 },
    campaign: mission,
    drips: [],
    decor: { rooms: [], pools: [] },
    menuShots: {
      title: { fov: 56, period: 90, fog: 0.0015, a: [14, 1.7, 12, 44, 3.5, 18], b: [16, 1.8, 18, 44, 3.2, 16] },
      porch: { fov: 58, period: 70, fog: 0.0015, a: [-31, 1.7, 70, -31, 3.5, 40], b: [-30, 1.8, 64, -32, 3.4, 36] },
      interior: { fov: 60, period: 80, fog: 0.0015, a: [44, 1.6, 28, 44, 3.8, 2], b: [40, 1.7, 24, 46, 3.6, 4] },
      lobby: {
        fov: 40,
        period: 60,
        fog: 0.0015,
        hemi: 1,
        moon: 1,
        torch: 0,
        a: [-32, 1.5, 70.8, -32, 1.25, 81],
        b: [-31.7, 1.55, 70.4, -32, 1.25, 81],
        cast: { spots: [[-30.65, 77, Math.PI + 0.22], [-31.55, 77, Math.PI + 0.08], [-32.45, 77, Math.PI - 0.08], [-33.35, 77, Math.PI - 0.22]] },
      },
    },
    attach(game) {
      level.game = game;
      mission.attach(game, level);
    },
    // the mission's marks: the HUD waypoint, the radar (game.js asks the level)
    waypoint: (player) => mission.waypoint(player),
    prewarm: () => mission.prewarmList(),
    radarList: () => mission.radarList(),
    // the helicopters here (game.chopper(), the wreck): desert paint, the same as the one that comes down
    chopper: { livery: { base: '#6f6246', tint: 0xd8c8a0 } },
    unlock: () => {},
    update(dt) {
      for (const u of updates) u(dt);
      if (level.game) sky.position.copy(level.game.camera.position); // (the dome stays round you)
    },
    isSheltered,
    inGasZone: () => false,
    ladders: [],
    barn: null,
    levelOf,
    FLOOR,
  };
  return level;
}

// ---------------------------------------------------------------- pieces
/** the burnt-out bus: a long rusted box on its rims, window holes, a slab of cover (x, z its centre, turned rot) */
function buildBus(B, world, x, z, rot) {
  const g = new THREE.Group();
  const body = getMaterial('rustyMetal');
  const dark = getMaterial('metalDark');
  const L = 10, W = 2.5, H = 2.8;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(L, H - 0.6, W), body);
  shell.position.y = 0.6 + (H - 0.6) / 2;
  g.add(shell);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(L - 0.2, 0.12, W - 0.1), dark);
  roof.position.y = H + 0.06;
  g.add(roof);
  const holeM = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1 });
  for (let i = 0; i < 7; i++) {
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.8), holeM);
      w.position.set(-L / 2 + 1.1 + i * 1.3, 2.1, s * (W / 2 + 0.01));
      w.rotation.y = s > 0 ? 0 : Math.PI;
      g.add(w);
    }
  }
  for (const [wx, wz] of [[-3.2, 1], [-3.2, -1], [3.4, 1], [3.4, -1]]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.25, 14), dark);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(wx, 0.42, wz * (W / 2 - 0.1));
    g.add(rim);
  }
  g.position.set(x, G, z);
  g.rotation.y = rot;
  g.rotation.z = 0.03; // (a flat on one side)
  g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  B.staticGroup.add(g);
  // its collider: an oriented box
  world.addOBB(x, z, L / 2, W / 2, rot, G, G + H, SURF.metal, 0, 'bus');
}

/** a market stall before a shop front: four poles, an awning, a table with its goods (x, z its middle) */
function stall(B, Q, QM, x, z, pick, y = G) {
  const wood = getMaterial('woodBeam');
  const g = new THREE.Group();
  for (const [px, pz] of [[-1.3, -0.8], [1.3, -0.8], [-1.3, 0.8], [1.3, 0.8]]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.3, 0.07), wood);
    p.position.set(px, 1.15, pz);
    g.add(p);
  }
  const top = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.08, 1.4), wood);
  top.position.set(0, 0.85, 0);
  g.add(top);
  const goods = [0xb8322a, 0xd8a030, 0x6a8a3a, 0xe0d8c0, 0x3a6a8a];
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, 0.25), new THREE.MeshStandardMaterial({ color: goods[i % goods.length], roughness: 0.8 }));
    c.position.set(-1.05 + (i % 5) * 0.52, 0.98, -0.35 + Math.floor(i / 5) * 0.6);
    g.add(c);
  }
  g.position.set(x, y, z);
  g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  B.staticGroup.add(g);
  Q.add(pick(QM.awning), x, y + 2.35, z, 's', 2.9, 1.7, -(Math.PI / 2 - 0.12)); // (a roof, dipping toward the street)
  B.world.add(x - 1.3, y, z - 0.7, x + 1.3, y + 0.95, z + 0.7, SURF.wood);
}

/** a water tower: four legs, cross braces, the tank (x, z its middle) */
function waterTower(B, world, x, z, y) {
  const m = getMaterial('rustyMetal');
  const g = new THREE.Group();
  for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.18, 7, 0.18), m);
    l.position.set(lx, 3.5, lz);
    g.add(l);
  }
  for (const yy of [2.3, 4.6]) {
    for (const [ax, az, bx, bz] of [[-1.4, -1.4, 1.4, -1.4], [-1.4, 1.4, 1.4, 1.4], [-1.4, -1.4, -1.4, 1.4], [1.4, -1.4, 1.4, 1.4]]) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(bx - ax) + 0.1, 0.1, Math.abs(bz - az) + 0.1), m);
      b.position.set((ax + bx) / 2, yy, (az + bz) / 2);
      g.add(b);
    }
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3, 20), getMaterial('dtTinBlue'));
  tank.position.y = 8.5;
  g.add(tank);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 0.8, 20), m);
  cap.position.y = 10.4;
  g.add(cap);
  g.position.set(x, y, z);
  g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  B.staticGroup.add(g);
  for (const [lx, lz] of [[-1.4, -1.4], [1.4, -1.4], [-1.4, 1.4], [1.4, 1.4]]) world.add(x + lx - 0.12, y, z + lz - 0.12, x + lx + 0.12, y + 7, z + lz + 0.12, SURF.metal);
}

/**
 * The temple (sector 2): the anteroom off the plaza, the courtyard with its arcades and fountain, the two wings with
 * their gates (one locked: game/desertMission.js picks), the stairs up in each, the great hall (its front door barred,
 * its back door shut until the officer is found), the gallery and the officer's room up there. Returns
 * { group, portals, navBlocks, inside(x, y, z), doors: { front, back, gateW, gateE }, hostage, memo, spots }.
 */
function buildTemple(B, Q, QM, world, dyn, radar, nests, H) {
  const T = TEMPLE;
  const group = new THREE.Group();
  group.name = 'temple';
  const stoneW = { mat: 'dtStone', surface: SURF.concrete, jamb: 'dtStone', grime: 0.5 };
  const wallT = 0.6;
  const top = 7.2; // the outer walls
  // ---- the outer shell and the inner walls (x/z: the wall's centre line)
  // west wall (x 22): the anteroom's door (z 22..28), the west wing's back wall
  B.wall('z', T.x0 + wallT / 2, T.z0, T.z1, G, top, wallT, [{ a: T.ante.door[0], b: T.ante.door[1], y0: G, y1: G + 4.2 }], { ...stoneW, floorY: G, ceilY: top });
  // east wall (x 62)
  B.wall('z', T.x1 - wallT / 2, T.z0, T.z1, G, top, wallT, [], { ...stoneW, floorY: G, ceilY: top });
  // south wall (z 32)
  B.wall('x', T.z1 - wallT / 2, T.x0, T.x1, G, top, wallT, [], { ...stoneW, floorY: G, ceilY: top });
  // north wall (z -30): the hall's back door (x 42..46)
  B.wall('x', T.z0 + wallT / 2, T.x0, T.x1, G, T.hall.h, wallT, [{ a: T.hall.back[0], b: T.hall.back[1], y0: G, y1: G + 3.6 }], { ...stoneW, floorY: G, ceilY: T.hall.h });
  radar.push([T.x0, T.z0, T.x1, T.z0], [T.x1, T.z0, T.x1, T.z1], [T.x1, T.z1, T.x0, T.z1], [T.x0, T.z1, T.x0, T.z0]);
  // the anteroom: its north wall (z 18) shared with the west wing, its east wall (x 32) with the arch into the court
  B.wall('x', T.ante.z0 + 0.25, T.x0 + wallT, T.court.x0, G, top, 0.5, [], { ...stoneW, floorY: G, ceilY: top });
  B.wall('z', T.court.x0 + 0.25, T.ante.z0, T.z1 - wallT, G, top, 0.5, [{ a: T.ante.arch[0], b: T.ante.arch[1], y0: G, y1: G + 4.6 }], { ...stoneW, floorY: G, ceilY: top });
  radar.push([T.court.x0, T.ante.z0, T.court.x0, T.ante.arch[0]], [T.court.x0, T.ante.arch[1], T.court.x0, T.z1]);
  // the anteroom's roof, a light well in it; its floor; its columns
  B.slab(T.x0 + wallT, T.court.x0, T.ante.z0, T.z1 - wallT, T.ante.h, T.ante.h + 0.4, [[26, 28, 24, 26]], { mats: { ny: 'dtPlasterWhite', py: 'dtRoof' }, surface: SURF.concrete, grime: 0.2 });
  B.box(T.x0 + wallT, G, T.ante.z0, T.court.x0, G + 0.02, T.z1 - wallT, { mat: 'dtStoneFloor', surface: SURF.concrete, grime: 0, castShadow: false });
  for (const [cx, cz] of [[25.2, 20.8], [28.8, 20.8], [25.2, 29.2], [28.8, 29.2]]) column(B, world, cx, cz, G, T.ante.h);
  // the west wing (x 22..32, z -30..18): its east wall on the court (the gate), the north part's wall on the hall
  B.wall('z', T.court.x0 + 0.25, T.court.z0, T.ante.z0, G, top, 0.5, [{ a: T.gate[0], b: T.gate[1], y0: G, y1: G + 2.8 }], { ...stoneW, floorY: G, ceilY: top });
  B.wall('z', T.hall.x0 + 0.25, T.z0 + wallT, T.court.z0, G, T.hall.h, 0.5, [{ a: T.wingDoor[0], b: T.wingDoor[1], y0: U, y1: U + 2.3 }], { ...stoneW, floorY: G, ceilY: T.hall.h });
  // the east wing (x 56..62): its west wall on the court (the gate) and on the hall
  B.wall('z', T.court.x1 - 0.25, T.court.z0, T.z1 - wallT, G, top, 0.5, [{ a: T.gate[0], b: T.gate[1], y0: G, y1: G + 2.8 }], { ...stoneW, floorY: G, ceilY: top });
  B.wall('z', T.hall.x1 - 0.25, T.z0 + wallT, T.court.z0, G, T.hall.h, 0.5, [{ a: T.wingDoor[0], b: T.wingDoor[1], y0: U, y1: U + 2.3 }], { ...stoneW, floorY: G, ceilY: T.hall.h });
  radar.push([T.court.x0, T.z0, T.court.x0, T.ante.z0], [T.court.x1, T.z0, T.court.x1, T.z1]);
  // the hall's front wall on the court (z 0): the barred door (x 42..46)
  B.wall('x', T.hall.z1 - 0.25, T.hall.x0, T.hall.x1, G, T.hall.h, 0.5, [{ a: T.hall.door[0], b: T.hall.door[1], y0: G, y1: G + 3.8 }], { ...stoneW, floorY: G, ceilY: T.hall.h });
  radar.push([T.hall.x0, T.hall.z1, T.hall.x1, T.hall.z1]);
  // the wings' roofs, the hall's roof
  for (const [x0, x1] of [[T.wingW.x0 + wallT, T.wingW.x1], [T.wingE.x0, T.wingE.x1 - wallT]]) B.slab(x0, x1, T.z0 + wallT, T.court.z1 - (x0 < 40 ? 14 : 0), top - 0.4, top, [], { mats: { ny: 'dtPlasterWhite', py: 'dtRoof' }, surface: SURF.concrete, grime: 0.2 });
  B.slab(T.hall.x0, T.hall.x1, T.z0 + wallT, T.hall.z1, T.hall.h - 0.4, T.hall.h, [], { mats: { ny: 'dtPlasterWhite', py: 'dtRoof' }, surface: SURF.concrete, grime: 0.2 });
  // floors: the courtyard, the hall, the wings
  B.box(T.court.x0, G, T.court.z0, T.court.x1, G + 0.02, T.court.z1 - wallT, { mat: 'dtStoneFloor', surface: SURF.concrete, grime: 0, castShadow: false });
  B.box(T.hall.x0, G, T.z0 + wallT, T.hall.x1, G + 0.02, T.hall.z1, { mat: 'dtStoneFloor', surface: SURF.concrete, grime: 0, castShadow: false });
  for (const [x0, x1] of [[T.wingW.x0 + wallT, T.wingW.x1], [T.wingE.x0, T.wingE.x1 - wallT]]) B.box(x0, G, T.z0 + wallT, x1, G + 0.02, x0 < 40 ? T.ante.z0 : T.z1 - wallT, { mat: 'dtStoneFloor', surface: SURF.concrete, grime: 0, castShadow: false });
  // ---- the arcades along the court (columns, the roof over the walk)
  for (let z = T.court.z0 + 2; z < T.ante.z0 - 0.5; z += 4) column(B, world, T.court.x0 + 3.2, z, G, 5);
  for (let z = T.court.z0 + 2; z < T.court.z1 - 1; z += 4) column(B, world, T.court.x1 - 3.2, z, G, 5);
  B.box(T.court.x0 + 0.5, 5, T.court.z0, T.court.x0 + 3.6, 5.4, T.ante.z0, { mat: 'dtStone', mats: { py: 'dtRoof' }, surface: SURF.concrete, grime: 0.3 });
  B.box(T.court.x1 - 3.6, 5, T.court.z0, T.court.x1 - 0.5, 5.4, T.court.z1 - wallT, { mat: 'dtStone', mats: { py: 'dtRoof' }, surface: SURF.concrete, grime: 0.3 });
  // the fountain in the court, palms, jars, a cart
  B.box(41.5, G, 13.5, 46.5, G + 0.75, 18.5, { mat: 'dtStone', surface: SURF.concrete, grime: 0.4 });
  B.box(43.3, G + 0.75, 15.3, 44.7, G + 1.9, 16.7, { mat: 'dtStone', surface: SURF.concrete, grime: 0.3 });
  H.palm(38, 27, G, 7.5);
  H.palm(50.5, 5.5, G, 8.5);
  H.prop('crate', 36.5, G, 10, 0.3);
  H.prop('crateLong', 49, G, 24, 1.2);
  H.prop('sandbags', 44, G, 5.5, 0);
  H.prop('barrel', 52, G, 29, 0);
  // ---- the gates into the wings: iron grilles (the one that's locked stays shut: game/desertMission.js)
  const gateW = grilleGate(B, world, dyn, T.court.x0 + 0.25, T.gate, 'z', G);
  const gateE = grilleGate(B, world, dyn, T.court.x1 - 0.25, T.gate, 'z', G);
  // ---- inside the wings: partitions (with doorways), the stairs up at the north end, the upper room
  // west wing: stairs against the west wall (x 22.6..25.4), rising north from z -13 (G) to z -23 (U); the upper floor
  // z -30..-14 at U. The stairwell is a little wider than the stairs on its open side (WELL): a head going up at the
  // stairs' edge never meets the floor above; a rail along that side
  const WELL = 0.35;
  const WS = { x0: 22.6, x1: 25.4, zb: -13, zt: -23 };
  B.stairs({ axis: 'z', x0: WS.x0, x1: WS.x1, s0: WS.zb, s1: WS.zt, yBottom: G, yTop: U, steps: 18, solid: true, mat: 'dtStone', riser: 'dtStone', surface: SURF.concrete });
  B.slab(T.wingW.x0 + wallT, T.wingW.x1, T.z0 + wallT, T.upper, U - 0.3, U, [[WS.x0, WS.x1 + WELL, WS.zt, T.upper]], { mats: { py: 'dtStoneFloor', ny: 'dtPlasterWhite' }, surface: SURF.concrete, grime: 0.2 });
  B.box(WS.x1 + WELL, U, WS.zt, WS.x1 + WELL + 0.1, U + 1.0, T.upper, { mat: 'dtStone', surface: SURF.concrete, collide: false });
  world.add(WS.x1 + WELL, U, WS.zt, WS.x1 + WELL + 0.1, U + 1.0, T.upper, SURF.concrete, FLAG_NOBULLET);
  B.wall('x', 2.2, T.wingW.x0 + wallT, T.wingW.x1, G, top - 0.4, 0.3, [{ a: 26.5, b: 28.3, y0: G, y1: G + 2.4 }], { mat: 'dtPlasterWhite', surface: SURF.plaster, jamb: 'dtPlasterWhite' });
  B.wall('x', -8, T.wingW.x0 + wallT, T.wingW.x1, G, U - 0.3, 0.3, [{ a: 27, b: 29, y0: G, y1: G + 2.4 }], { mat: 'dtPlasterWhite', surface: SURF.plaster, jamb: 'dtPlasterWhite' });
  // the rail at the upper floor's edge (z -14), the stairwell's opening left free
  B.box(WS.x1 + WELL, U, T.upper - 0.08, T.wingW.x1, U + 1.0, T.upper + 0.02, { mat: 'dtStone', surface: SURF.concrete, collide: false });
  world.add(WS.x1 + WELL, U, T.upper - 0.08, T.wingW.x1, U + 1.0, T.upper + 0.02, SURF.concrete, FLAG_NOBULLET);
  // east wing: stairs against the east wall (x 59.2..61.4) rising north from z -13 to z -23, the same wider well
  const ES = { x0: 59.2, x1: 61.4, zb: -13, zt: -23 };
  B.stairs({ axis: 'z', x0: ES.x0, x1: ES.x1, s0: ES.zb, s1: ES.zt, yBottom: G, yTop: U, steps: 18, solid: true, mat: 'dtStone', riser: 'dtStone', surface: SURF.concrete });
  B.slab(T.wingE.x0, T.wingE.x1 - wallT, T.z0 + wallT, T.upper, U - 0.3, U, [[ES.x0 - WELL, ES.x1, ES.zt, T.upper]], { mats: { py: 'dtStoneFloor', ny: 'dtPlasterWhite' }, surface: SURF.concrete, grime: 0.2 });
  B.box(ES.x0 - WELL - 0.1, U, ES.zt, ES.x0 - WELL, U + 1.0, T.upper, { mat: 'dtStone', surface: SURF.concrete, collide: false });
  world.add(ES.x0 - WELL - 0.1, U, ES.zt, ES.x0 - WELL, U + 1.0, T.upper, SURF.concrete, FLAG_NOBULLET);
  B.wall('x', 12, T.wingE.x0, T.wingE.x1 - wallT, G, top - 0.4, 0.3, [{ a: 57, b: 59, y0: G, y1: G + 2.4 }], { mat: 'dtPlasterWhite', surface: SURF.plaster, jamb: 'dtPlasterWhite' });
  B.box(T.wingE.x0, U, T.upper - 0.08, ES.x0 - WELL, U + 1.0, T.upper + 0.02, { mat: 'dtStone', surface: SURF.concrete, collide: false });
  world.add(T.wingE.x0, U, T.upper - 0.08, ES.x0 - WELL, U + 1.0, T.upper + 0.02, SURF.concrete, FLAG_NOBULLET);
  // ---- the hall: columns, the gallery (at U over z -30..-14) with its rail, the stairs down in the hall, the room
  for (const cx of [37, 43, 49]) for (const cz of [-6, -22]) column(B, world, cx + (cz < -14 ? 0 : 0), cz, G, cz < -14 ? U : T.hall.h - 0.4);
  const HS = { x0: 51, x1: 53.4, zb: -3, zt: -14 }; // (up to the gallery's edge at z -14)
  B.stairs({ axis: 'z', x0: HS.x0, x1: HS.x1, s0: HS.zb, s1: HS.zt, yBottom: G, yTop: U, steps: 18, solid: true, mat: 'dtStone', riser: 'dtStone', surface: SURF.concrete });
  B.slab(T.hall.x0 + 0.5, T.hall.x1 - 0.5, T.z0 + wallT, T.mezz.z1, U - 0.35, U, [], { mats: { py: 'dtStoneFloor', ny: 'dtPlasterWhite' }, surface: SURF.concrete, grime: 0.2 });
  for (const [x0, x1] of [[T.hall.x0 + 0.5, HS.x0], [HS.x1, T.hall.x1 - 0.5]]) {
    B.box(x0, U, T.mezz.z1 - 0.1, x1, U + 1.05, T.mezz.z1, { mat: 'dtStone', surface: SURF.concrete, collide: false });
    world.add(x0, U, T.mezz.z1 - 0.1, x1, U + 1.05, T.mezz.z1, SURF.concrete, FLAG_NOBULLET);
  }
  // the officer's room on the gallery: walls up to the hall's roof, its door
  const R = T.room;
  B.wall('x', R.z1 + 0.15, R.x0, R.x1, U, T.hall.h - 0.4, 0.3, [{ a: R.door[0], b: R.door[1], y0: U, y1: U + 2.3 }], { mat: 'dtPlasterWhite', surface: SURF.plaster, jamb: 'dtPlasterWhite' });
  B.wall('z', R.x0 - 0.15, T.z0 + wallT, R.z1, U, T.hall.h - 0.4, 0.3, [], { mat: 'dtPlasterWhite', surface: SURF.plaster });
  B.wall('z', R.x1 + 0.15, T.z0 + wallT, R.z1, U, T.hall.h - 0.4, 0.3, [], { mat: 'dtPlasterWhite', surface: SURF.plaster });
  // the officer (tied to a chair; the scene: game/desertMission.js), a table with the memo, a lamp, a camera tripod
  H.prop('chair', 44, U, -25, Math.PI);
  H.prop('table', 41, U, -27.5, 0);
  H.prop('papers', 41, U + 0.78, -27.5, 0.3, {}, { collide: false });
  H.prop('radio', 40.2, U + 0.78, -27.2, 0.2, {}, { collide: false });
  H.prop('mattressFloor', 48, U, -28, 0.1, {}, { collide: false });
  H.prop('lantern', 42, U + 0.78, -27.8, 0, {}, { collide: false });
  const hostageAt = V(44, U, -25.1);
  const memoAt = V(41, U + 0.8, -27.5);
  // the front door (barred: two heavy wooden leaves, a beam across) and the back door (shut until the scene)
  const front = woodDoor(B, world, dyn, T.hall.door, T.hall.z1 - 0.25, 3.8, true);
  const back = woodDoor(B, world, dyn, T.hall.back, T.z0 + wallT / 2, 3.6, false);
  // ---- the wings' booby traps: tripwires across the corridors (game/desertMission.js arms them)
  const traps = [
    { x0: 23.4, x1: 31.6, z: 9, y: 0.25 },
    { x0: 23.4, x1: 31.6, z: -4, y: 0.3 },
    { x0: 56.4, x1: 61.4, z: 18, y: 0.25 },
    { x0: 56.4, x1: 61.4, z: 2, y: 0.28 },
  ];
  // ---- the inside test (for the light: indoors, in the shade)
  const inside = (x, y, z) => {
    if (x < T.x0 || x > T.x1 || z < T.z0 || z > T.z1) return false;
    if (x > T.court.x0 && x < T.court.x1 && z > T.court.z0 && z < T.court.z1 && !(x < T.court.x0 + 3.6 || x > T.court.x1 - 3.6)) return false;
    return y < T.hall.h;
  };
  // ---- nav: the three stairs
  const portals = [
    { id: 'wingWStairs', a: { level: 1, x: 24, z: -11.8 }, b: { level: 2, x: 24, z: -24.4 }, cost: 8, enabled: true, always: true, path: [[24, -11.8], [24, -24.4]] },
    { id: 'wingEStairs', a: { level: 1, x: 60.3, z: -11.8 }, b: { level: 2, x: 60.3, z: -24.4 }, cost: 8, enabled: true, always: true, path: [[60.3, -11.8], [60.3, -24.4]] },
    { id: 'hallStairs', a: { level: 1, x: 52.2, z: -1.8 }, b: { level: 2, x: 52.2, z: -14.6 }, cost: 8, enabled: true, always: true, path: [[52.2, -1.8], [52.2, -14.6]] },
  ];
  const navBlocks = [];
  for (const s of [WS, ES, HS]) {
    navBlocks.push({ level: 1, rect: [s.x0 - 0.1, s.x1 + 0.1, Math.min(s.zb, s.zt) - 0.1, Math.max(s.zb, s.zt) + 0.1] });
    navBlocks.push({ level: 2, rect: [s.x0 - 0.1, s.x1 + 0.1, Math.min(s.zb, s.zt) - 0.1, Math.max(s.zb, s.zt) + 0.1] });
  }
  nests.templeRoof = { pos: V(30.6, 7.2, 2), yaw: Math.PI / 2 }; // (on the west wing's roof, over the courtyard)
  return { group, portals, navBlocks, inside, doors: { front, back, gateW, gateE }, hostageAt, memoAt, traps };
}

/** a column: a square base, the round shaft, a capital (x, z, from y, h tall) */
function column(B, world, x, z, y, h) {
  B.box(x - 0.45, y, z - 0.45, x + 0.45, y + 0.4, z + 0.45, { mat: 'dtStone', surface: SURF.concrete, grime: 0.4, collide: false });
  B.box(x - 0.45, y + h - 0.35, z - 0.45, x + 0.45, y + h, z + 0.45, { mat: 'dtStone', surface: SURF.concrete, grime: 0.2, collide: false });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, h - 0.75, 14), getMaterial('dtStone'));
  m.position.set(x, y + 0.4 + (h - 0.75) / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  B.staticGroup.add(m);
  world.add(x - 0.4, y, z - 0.4, x + 0.4, y + h, z + 0.4, SURF.concrete);
}

/**
 * An iron grille gate in a wall (axis 'z': the wall runs along z at x; span [a, b] of z): two leaves of bars. Returns
 * { open(game), lock(game), box, open: bool } (game/desertMission.js decides which of the two is locked).
 */
function grilleGate(B, world, dyn, x, span, axis, y) {
  const [a, b] = span;
  const H = 2.8, w = (b - a) / 2;
  const m = new THREE.MeshStandardMaterial({ color: 0x2a2826, metalness: 0.7, roughness: 0.5 });
  const leaves = [];
  for (const [hinge, dir] of [[a, 1], [b, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, hinge);
    for (let k = 0; k <= 6; k++) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.04, H, 0.04), m);
      bar.position.set(0, H / 2, dir * (k / 6) * (w - 0.02));
      pivot.add(bar);
    }
    for (const yy of [0.15, H / 2, H - 0.15]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, w), m);
      r.position.set(0, yy, (dir * w) / 2);
      pivot.add(r);
    }
    pivot.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    dyn.add(pivot);
    leaves.push({ pivot, dir });
  }
  // a chain and a padlock where the leaves meet (shown while it's locked)
  const lockM = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.18, 0.1), new THREE.MeshStandardMaterial({ color: 0x6a5a30, metalness: 0.8, roughness: 0.35 }));
  lockM.position.set(x - 0.08, y + 1.2, (a + b) / 2);
  dyn.add(lockM);
  const box = world.add(x - 0.1, y, a, x + 0.1, y + H, b, SURF.metal, FLAG_NOBULLET, 'gate'); // (bullets go through the bars)
  const g = {
    box,
    isOpen: false,
    open(game) {
      g.isOpen = true;
      box.enabled = false;
      lockM.visible = false;
      g.t = 0;
      game?.nav?.refreshRect(x - 1, x + 1, a - 1, b + 1);
    },
    lock(game) {
      g.isOpen = false;
      box.enabled = true;
      lockM.visible = true;
      g.t = null;
      for (const l of leaves) l.pivot.rotation.y = 0;
      game?.nav?.refreshRect(x - 1, x + 1, a - 1, b + 1);
    },
    update(dt) {
      if (g.t == null) return;
      g.t = Math.min(1, g.t + dt / 1.2);
      const e = g.t * g.t * (3 - 2 * g.t);
      for (const l of leaves) l.pivot.rotation.y = -l.dir * e * 1.5; // (both swing into the wing)
    },
  };
  return g;
}

/** a heavy wooden double door in a wall along x at z (span [a, b] of x): barred ones have a beam across */
function woodDoor(B, world, dyn, span, z, H, barred) {
  const [a, b] = span;
  const w = (b - a) / 2;
  const m = new THREE.MeshStandardMaterial({ color: 0x5a3a22, roughness: 0.75 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x2a2624, metalness: 0.7, roughness: 0.5 });
  const leaves = [];
  for (const [hinge, dir] of [[a, 1], [b, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(hinge, G, z);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.02, H, 0.14), m);
    leaf.position.set((dir * w) / 2, H / 2, 0);
    pivot.add(leaf);
    for (const yy of [0.5, H / 2, H - 0.5]) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.1, 0.16), iron);
      s.position.set((dir * w) / 2, yy, 0);
      pivot.add(s);
    }
    pivot.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    dyn.add(pivot);
    leaves.push({ pivot, dir });
  }
  if (barred) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(b - a + 0.6, 0.22, 0.2), m);
    beam.position.set((a + b) / 2, G + 1.8, z + 0.2);
    beam.castShadow = true;
    dyn.add(beam);
  }
  const box = world.add(a, G, z - 0.15, b, G + H, z + 0.15, SURF.wood, 0, 'door');
  const d = {
    box,
    isOpen: false,
    open(game, out = 1) {
      d.isOpen = true;
      box.enabled = false;
      d.t = 0;
      d.out = out;
      game?.nav?.refreshRect(a - 1, b + 1, z - 1.5, z + 1.5);
    },
    close(game) {
      d.isOpen = false;
      box.enabled = true;
      d.t = null;
      for (const l of leaves) l.pivot.rotation.y = 0;
      game?.nav?.refreshRect(a - 1, b + 1, z - 1.5, z + 1.5);
    },
    update(dt) {
      if (d.t == null) return;
      d.t = Math.min(1, d.t + dt / 1.6);
      const e = d.t * d.t * (3 - 2 * d.t);
      for (const l of leaves) l.pivot.rotation.y = l.dir * d.out * e * 1.45;
    },
  };
  return d;
}

/**
 * The office on the square (sector 4): the intel is in there. One room (an enterable ground floor at y), its door on
 * the square's side (east), a window each side of it, a desk, filing cabinets, crates of rifles. Returns
 * { inside, intelAt, door }.
 */
function buildOffice(B, Q, QM, world, radar, { x0, x1, z0, z1, y }) {
  const h = 3.6, t = 0.4, top = y + 2 * STORY + 0.8;
  const W = { mat: 'dtPlasterOchre', surface: SURF.concrete, jamb: 'dtPlasterOchre', grime: 0.5, floorY: y, ceilY: top };
  B.wall('z', x1 - t / 2, z0, z1, y, top, t, [{ a: -97, b: -95, y0: y, y1: y + 2.4 }, { a: -101, b: -99, y0: y + 1, y1: y + 2.2 }, { a: -93, b: -91, y0: y + 1, y1: y + 2.2 }], W);
  B.wall('z', x0 + t / 2, z0, z1, y, top, t, [], W);
  B.wall('x', z0 + t / 2, x0, x1, y, top, t, [], W);
  B.wall('x', z1 - t / 2, x0, x1, y, top, t, [], W);
  B.slab(x0 + t, x1 - t, z0 + t, z1 - t, y + h, y + h + 0.3, [], { mats: { ny: 'dtPlasterWhite', py: 'dtRoof' }, surface: SURF.concrete });
  B.box(x0 + t, y + h + 0.3, z0 + t, x1 - t, top, z1 - t, { mat: 'dtPlasterOchre', mats: { py: 'dtRoof' }, surface: SURF.concrete, grime: 0.4 }); // (the floor above: solid)
  B.box(x0 + t, y, z0 + t, x1 - t, y + 0.02, z1 - t, { mat: 'dtConcrete', surface: SURF.concrete, grime: 0, castShadow: false });
  radar.push([x0, z0, x1, z0], [x1, z0, x1, -97], [x1, -95, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
  // a sign over the door, the room's things
  Q.add(QM.sign[2], x1 + 0.06, y + 3.1, -96, 'e', 3.4, 0.8);
  const P = (type, px, pz, rot, o = {}, place = {}) => {
    try {
      const p = buildProp(type, { seed: Math.floor(Math.random() * 1e5), ...o });
      if (p) B.placeProp(p, px, y, pz, rot, place);
    } catch (e) {
      /* skip */
    }
  };
  P('table', -48, -96, 0);
  P('chair', -48, -94.8, Math.PI);
  P('cabinet', -58.8, -100, Math.PI / 2);
  P('cabinet', -58.8, -98.9, Math.PI / 2);
  P('ammoCrate', -44, -104, 0.2);
  P('ammoCrate', -43, -104.4, 0.5);
  P('crateLong', -52, -105.5, 0);
  P('crateLong', -52, -104.7, 0.05);
  P('papers', -48, -96, 0.2, {}, { collide: false });
  P('radio', -46.2, -103, 0);
  const intelAt = V(-48, y + 0.8, -96.2);
  const inside = (x, yy, z) => x > x0 && x < x1 && z > z0 && z < z1 && yy > y - 0.5 && yy < y + h;
  return { inside, intelAt, door: V(x1 + 1.2, y, -96) };
}

/**
 * The compound gate (sector 4): two steel leaves between concrete posts (x a..b at z, on y). Blown open by the charge
 * (game/desertMission.js): the leaves torn back, the way to the crash site free. Returns { plantAt, blow(game), box }.
 */
function buildGate(B, world, dyn, a, b, z, y) {
  const H = 4.4;
  B.box(a - 0.8, y, z - 0.6, a, y + H + 0.4, z + 0.6, { mat: 'dtConcrete', surface: SURF.concrete, grime: 0.5 });
  B.box(b, y, z - 0.6, b + 0.8, y + H + 0.4, z + 0.6, { mat: 'dtConcrete', surface: SURF.concrete, grime: 0.5 });
  const m = getMaterial('dtTin');
  const leaves = [];
  const w = (b - a) / 2;
  for (const [hinge, dir] of [[a, 1], [b, -1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(hinge, y, z);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w - 0.04, H, 0.12), m);
    leaf.position.set((dir * w) / 2, H / 2, 0);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    pivot.add(leaf);
    dyn.add(pivot);
    leaves.push({ pivot, dir, leaf });
  }
  const box = world.add(a, y, z - 0.2, b, y + H, z + 0.2, SURF.metal, 0, 'compoundGate');
  const g = {
    plantAt: V((a + b) / 2, y, z + 0.9),
    box,
    blown: false,
    blow(game) {
      g.blown = true;
      box.enabled = false;
      g.t = 0;
      game?.nav?.refreshRect(a - 1, b + 1, z - 2, z + 2);
    },
    reset(game) {
      g.blown = false;
      box.enabled = true;
      g.t = null;
      for (const l of leaves) {
        l.pivot.rotation.set(0, 0, 0);
        l.leaf.rotation.set(0, 0, 0);
      }
      game?.nav?.refreshRect(a - 1, b + 1, z - 2, z + 2);
    },
    update(dt) {
      if (g.t == null) return;
      g.t = Math.min(1, g.t + dt * 3);
      const e = 1 - Math.pow(1 - g.t, 3);
      for (const l of leaves) {
        l.pivot.rotation.y = -l.dir * e * 1.9; // (torn back, north, into the site)
        l.leaf.rotation.z = l.dir * e * 0.18;
      }
    },
  };
  return g;
}

/**
 * The crash site: a helicopter down on its side, fire and smoke from the engines. Not there until the end: the
 * mission's last scene brings it down (game/desertScenes.js); show(on, game) puts it there (or takes it away).
 */
function buildWreck(B, world, dyn, updates, x, z, y) {
  const heli = buildHelicopter({ livery: { base: '#6f6246', tint: 0xd8c8a0 } });
  heli.rotor = 0;
  heli.lights = false;
  heli.root.position.set(x, y + 1.3, z);
  heli.root.rotation.set(0, 0.7, 0);
  heli.body.rotation.set(0.12, 0, 1.15); // (on its side)
  heli.root.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  dyn.add(heli.root);
  const obb = world.addOBB(x, z, 6.5, 1.8, 0.7, y, y + 3, SURF.metal, 0, 'wreck');
  const w = {
    heli,
    pos: V(x, y, z),
    smokeAt: V(x + 1, y + 2.6, z - 0.5),
    shown: true,
    show(on, game) {
      w.shown = on;
      heli.root.visible = on;
      for (const p of obb.pieces) p.enabled = on;
      game?.nav?.refreshRect(x - 8, x + 8, z - 8, z + 8);
    },
  };
  return w;
}
