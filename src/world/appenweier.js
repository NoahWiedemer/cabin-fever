// The Appenweier map: Sander Straße in Appenweier (Ortenau, Baden-Württemberg) at night. Sanderstraße 13 / 13a /
// 13c with the painted gable, the double garage (the gun shop), the fire station across the road, the corn
// field, the drugstore at Im See 18. Round based like the farm: the fire station opens with round 4, the
// drugstore with round 10.
//
// Geometry: public/maps/appenweier.json (tools/appenweier-data.mjs): the LGL's LoD2 building models (roofs and
// walls as measured) and OpenStreetMap (streets, parking, trees, lamps); the photos of the site
// (tools/appenweier-photos.mjs) for the murals and the details; the rest by hand (world/appenweierBuildings.js,
// world/appenweierProps.js). The street level is the farm's yard level (y = -0.5), floors are at -0.45.
import * as THREE from 'three';
import { CollisionWorld, SURF, FLAG_NOBULLET } from './collision.js';
import { LevelBuilder } from './levelBuilder.js';
import { getMaterial } from './materials.js';
import { buildProp, clearPropCache } from './propsSafe.js';
import { levelOf } from './level.js';
import { AW_GROUND, AW_FLOOR, AW_BOUNDS, HALL, GARAGE, DM, DM_CENTER } from './appenweierLayout.js';
import { registerAppenweierMaterials } from './appenweierTextures.js';
import { buildSanderstrasse13, buildFireStation, buildDrugstore, garageShop } from './appenweierBuildings.js';
import { TriBatch, ribbon, dashes, polygon, inPoly, inHall, inGarage, inDM, B_ID, lod2Tris } from './appenweierGeo.js';
import { furnish } from './appenweierProps.js';
import { UPSTAIRS_ROUND, BASEMENT_ROUND } from '../game/modes.js';

const FLOOR = { basement: -3.2, ground: 0, upper: 3.45, outside: AW_GROUND };
const G = AW_GROUND;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function styleOf(b) {
  switch (b.id) {
    case B_ID.h13a:
      return { wall: 'awPlasterCream', roof: 'awRoofDark' };
    case B_ID.h13:
      return { wall: 'awPlasterWhite', roof: 'awRoofDark' };
    case B_ID.h13c:
      return { wall: 'awSiding', roof: 'awRoofRed' };
    case B_ID.garageW:
    case B_ID.garageE:
      return { wall: 'awPlasterWhite', roof: 'awRoofFlat' };
    case B_ID.fire:
      return { wall: 'awPlasterWhite', roof: 'awRoofBrown' };
    case B_ID.dm:
      return { wall: 'awPanels', roof: 'awRoofMetal' };
    case B_ID.works:
      return { wall: 'awPanelsGrey', roof: 'awRoofFlat' };
    case B_ID.h13b:
      return { wall: 'awFacadeWarm', roof: 'awRoofRed' };
  }
  const fn = b.fn ?? '';
  const industrial = /_(1[0-9]{3}|2[0-4][0-9]{2}|2[6-9][0-9]{2}|3[0-9]{3})$/.test(fn) && !fn.endsWith('_1010') && !fn.endsWith('_1123');
  const garage = fn.endsWith('_2463') || fn.endsWith('_2523') || fn.endsWith('_2140');
  if (garage) return { wall: 'awPlasterGrey', roof: b.roof === 'flat' ? 'awRoofFlat' : 'awRoofRed' };
  if (b.osm?.building === 'retail' || b.osm?.building === 'warehouse' || b.osm?.building === 'commercial' || b.osm?.building === 'industrial' || (industrial && b.roof === 'flat'))
    return { wall: 'awPanels', roof: b.roof === 'flat' ? 'awRoofFlat' : 'awRoofMetal' };
  const warm = (b.id.charCodeAt(b.id.length - 1) + b.id.charCodeAt(b.id.length - 2)) % 3;
  return { wall: warm === 0 ? 'awFacadeWarm' : 'awFacade', roof: b.roof === 'flat' ? 'awRoofFlat' : warm === 2 ? 'awRoofDark' : 'awRoofRed' };
}

/** triangles [x,y,z]*3 of a LoD2 surface list -> the batch, uvs in metres (walls: along x height; roofs: slope) */

// ---------------------------------------------------------------- the build
async function loadJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}
function loadImage(url) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}
export const PHOTO_NAMES = ['sceneLeft', 'sceneCenter', 'sceneRight', 'vine', 'cherubs', 'birds', 'sun', 'tilesL', 'tilesR', 'scroll', 'madonna', 'dog', 'starDoor'];

export async function buildAppenweier(progress) {
  const base = import.meta.env.BASE_URL;
  progress?.(0, 'Fetching Appenweier');
  const [data, ...imgs] = await Promise.all([loadJSON(base + 'maps/appenweier.json'), ...PHOTO_NAMES.map((n) => loadImage(`${base}maps/appenweier/${n}.webp`))]);
  const photos = Object.fromEntries(PHOTO_NAMES.map((n, i) => [n, imgs[i]]));
  progress?.(0.25, 'Painting Appenweier');
  registerAppenweierMaterials();

  const { minX, maxX, minZ, maxZ } = AW_BOUNDS;
  const world = new CollisionWorld(minX - 14, minZ - 14, maxX + 14, maxZ + 14, 2);
  const B = new LevelBuilder(world);
  const T = new TriBatch(); // static triangles (roads, LoD2, facades)
  const rnd = mulberry(4242);
  const lamps = [];
  const windows = [];
  const dynamic = new THREE.Group();
  dynamic.name = 'dynamicLevel';
  const ctx = { B, T, world, rnd, lamps, windows, dynamic, photos, data, prop: null, updates: [], unlockables: {}, specialSpots: {}, entrances: [], barricadeSpots: [], defensePosts: [], radarSegments: [], navBlocks: [] };
  const prop = (ctx.prop = (type, x, y, z, rot = 0, opts = {}, placeOpts = {}) => {
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
  });

  // ------------------------------------------------------------ ground, bounds
  world.add(minX - 12, G - 1, minZ - 12, maxX + 12, G, maxZ + 12, SURF.concrete, 0);
  {
    const S = 900;
    const g = new THREE.PlaneGeometry(S, S, 1, 1);
    g.rotateX(-Math.PI / 2);
    const mpr = getMaterial('awGrass').userData.metersPerRepeat;
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * S) / mpr, (uv.getY(i) * S) / mpr);
    const m = new THREE.Mesh(g, getMaterial('awGrass'));
    m.position.set((minX + maxX) / 2, G, (minZ + maxZ) / 2);
    m.receiveShadow = true;
    m.userData.noBatch = true;
    B.staticGroup.add(m);
  }
  const WB = [
    [minX - 1, minZ - 1, maxX + 1, minZ],
    [minX - 1, maxZ, maxX + 1, maxZ + 1],
    [minX - 1, minZ, minX, maxZ],
    [maxX, minZ, maxX + 1, maxZ],
  ];
  for (const [x0, z0, x1, z1] of WB) world.add(x0, G - 1, z0, x1, 14, z1, SURF.concrete, FLAG_NOBULLET);

  // ------------------------------------------------------------ streets (OpenStreetMap)
  progress?.(0.35, 'Laying Sander Straße');
  const yA = G + 0.012, yM = G + 0.02;
  const ROAD = {
    unclassified: { w: 7.4, mat: 'awAsphalt' },
    residential: { w: 6.2, mat: 'awAsphalt' },
    service: { w: 4.0, mat: 'awAsphalt' },
    living_street: { w: 4.5, mat: 'awAsphalt' },
    track: { w: 3.0, mat: 'gravel' },
    footway: { w: 2.2, mat: 'awAsphaltLight' },
    path: { w: 1.6, mat: 'awAsphaltLight' },
    cycleway: { w: 2.4, mat: 'awRedLane' },
  };
  for (const r of data.roads) {
    const spec = ROAD[r.kind];
    if (!spec) continue;
    let w = spec.w, mat = spec.mat;
    if (r.tags?.service === 'parking_aisle') w = 6;
    if (r.tags?.service === 'driveway') w = 3.2;
    if (r.tags?.surface === 'paving_stones') mat = 'awPavers';
    if (r.tags?.surface === 'gravel' || r.tags?.surface === 'compacted') mat = 'gravel';
    const y = mat === 'awAsphalt' ? yA : yA - 0.004;
    ribbon(T, mat, r.pts, -w / 2, w / 2, y);
    // Sander Straße: red cycle lanes both sides (Schutzstreifen), their dashed lines, the edge lines
    if (r.tags?.name === 'Sander Straße' && r.kind === 'unclassified') {
      const hw = w / 2;
      ribbon(T, 'awRedLane', r.pts, hw - 1.55, hw - 0.18, yA + 0.003);
      ribbon(T, 'awRedLane', r.pts, -hw + 0.18, -hw + 1.55, yA + 0.003);
      dashes(T, 'awPaint', r.pts, hw - 1.62, 0.12, 1.0, 1.0, yM);
      dashes(T, 'awPaint', r.pts, -hw + 1.62, 0.12, 1.0, 1.0, yM);
      ribbon(T, 'awPaint', r.pts, hw - 0.18, hw - 0.06, yM, 1);
      ribbon(T, 'awPaint', r.pts, -hw + 0.06, -hw + 0.18, yM, 1);
    } else if (r.kind === 'residential') {
      dashes(T, 'awPaint', r.pts, 0, 0.1, 3, 6, yM);
    }
  }
  // parking lots and their bays, traffic islands
  for (const a of data.areas) {
    if (a.kind === 'parking') polygon(T, 'awAsphalt', a.pts, yA - 0.002);
    else if (a.kind.startsWith('island')) polygon(T, 'awGrass', a.pts, yA + 0.01);
  }
  for (const a of data.areas) {
    if (a.kind !== 'parking_space') continue;
    const P = a.pts;
    for (let i = 0; i < P.length; i++) {
      const p = P[i], q = P[(i + 1) % P.length];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) > 3.8) ribbon(T, 'awPaint', [p, q], -0.06, 0.06, yM, 1); // the long sides
    }
  }

  // ------------------------------------------------------------ yards, the field (by hand, from the photos)
  const AREAS = {
    // Sanderstraße 13: gravel from the gate up the drive, hexagon pavers before the garage and the gable
    yardGravel: [[-31.5, -12.4], [-23.4, -11.6], [-12.4, -12.6], [-11.6, 8.6], [-24, 7.6], [-31.8, 4.2]],
    lane: [[-43.3, -15.6], [-23.6, -13.9], [-23.2, -10.4], [-43, -12.2]],
    pavers: [[-23.4, -35.95], [-9.6, -34.75], [-9.6, -24.4], [-12.4, -12.6], [-23.4, -13.9]],
    // the fire station's forecourt and the drive round its east side
    forecourt: [[-60, 23.4], [-30, 23.8], [-28.4, 43.4], [-29, 72], [-36, 72], [-36.5, 43.6], [-60, 43.6]],
  };
  polygon(T, 'gravel', AREAS.yardGravel, yA - 0.004);
  polygon(T, 'gravel', AREAS.lane, yA - 0.004);
  polygon(T, 'awPavers', AREAS.pavers, yA + 0.002);
  polygon(T, 'awAsphalt', AREAS.forecourt, yA - 0.001);
  // the corn field across the road (dry, ready for the harvest): soil under the stalks
  const CORN = [[-25.5, 29.5], [28, 31.8], [29, 88], [-25.5, 88]];
  polygon(T, 'mud', CORN, yA - 0.006);
  // and the dirt track along its edge, between the road's grass verge and the first stalks (the PLAY screen's
  // squad stands on it; the asphalt is drawn over its road side)
  polygon(T, 'mud', [[-25.5, 23], [28, 24.5], [28, 31.8], [-25.5, 29.5]], yA - 0.005);

  // ------------------------------------------------------------ LoD2 buildings
  progress?.(0.45, 'Raising the houses');
  const hallWall = (a, b, c) => {
    // the vehicle hall's own walls replace the LoD2 ones below its eaves (world/appenweierBuildings.js)
    const cx = (a[0] + b[0] + c[0]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
    return inHall(cx, cz, 0.6);
  };
  for (const b of data.buildings) {
    const st = styleOf(b);
    const inPlay = b.c[0] > minX - 6 && b.c[0] < maxX + 6 && b.c[1] > minZ - 6 && b.c[1] < maxZ + 6;
    // walls: the hall keeps only what is above its own walls; the drugstore's front is rebuilt with its glass
    if (b.id === B_ID.garageW || b.id === B_ID.garageE) continue; // the double garage is built whole (the gun shop)
    let skipWall = null, clip = null;
    if (b.id === B_ID.fire) clip = (a, bb, c) => (hallWall(a, bb, c) ? G + HALL.wallTop : null);
    if (b.id === B_ID.dm) skipWall = (a, bb, c, nx, ny, nz) => nx * DM.v[0] + nz * DM.v[1] < -0.9; // the shop front faces -v
    if (b.id !== B_ID.h13a) lod2Tris(T, st.wall, b.wallTris, G, skipWall, null, clip); // (13a: its painted gable, appenweierBuildings.js)
    lod2Tris(T, st.roof, b.roofTris, G);
    if (b.closureTris) lod2Tris(T, st.wall, b.closureTris, G);
    if (!inPlay) continue;
    // colliders: every footprint edge a turned wall (the hall and the drugstore bring their own)
    const top = G + Math.max(2.4, b.top);
    for (const f of b.foot) {
      for (let i = 0; i < f.length; i++) {
        const p = f[i], q = f[(i + 1) % f.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.2) continue;
        const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
        if (b.id === B_ID.fire && inHall(mx, mz, 0.4)) continue;
        if (b.id === B_ID.dm && inDM(mx, mz, 0.6)) continue;
        // (tag 'clean': no pre-seeded blood on Sanderstraße 13 and its murals, game.js _decorate)
        const clean = b.id === B_ID.h13a || b.id === B_ID.h13 || b.id === B_ID.h13c;
        world.addOBB(mx, mz, L / 2 + 0.12, 0.2, -Math.atan2(q[1] - p[1], q[0] - p[0]), G, top, SURF.concrete, 0, clean ? 'clean' : 'building');
      }
    }
    for (const f of b.foot) for (let i = 0; i < f.length; i++) ctx.radarSegments.push([f[i][0], f[i][1], f[(i + 1) % f.length][0], f[(i + 1) % f.length][1]]);
  }
  // footprints from OSM only (built after the survey): a plain box
  for (const o of data.extraBuildings) {
    const c = o.pts.reduce((a, p) => [a[0] + p[0] / o.pts.length, a[1] + p[1] / o.pts.length], [0, 0]);
    if (Math.hypot(c[0] - 10, c[1] - 10) > 240 || o.tags?.building === 'roof') continue;
    if (data.buildings.some((b) => b.foot.some((f) => inPoly(c[0], c[1], f)))) continue; // (the same house, outlined twice)
    const h = 3 * (+o.tags?.['building:levels'] || 1) + 0.4;
    for (let i = 0; i < o.pts.length; i++) {
      const p = o.pts[i], q = o.pts[(i + 1) % o.pts.length];
      T.quad('awFacade', [p[0], G, p[1]], [q[0], G, q[1]], [q[0], G + h, q[1]], [p[0], G + h, p[1]], [0, 0], [Math.hypot(q[0] - p[0], q[1] - p[1]) / 3, 0], [Math.hypot(q[0] - p[0], q[1] - p[1]) / 3, h / 3], [0, h / 3]);
    }
    polygon(T, 'awRoofFlat', o.pts, G + h);
  }

  // ------------------------------------------------------------ the detailed places
  progress?.(0.6, 'Painting Sanderstraße 13a');
  buildSanderstrasse13(ctx);
  progress?.(0.7, 'Opening the fire station');
  buildFireStation(ctx);
  buildDrugstore(ctx);

  // ------------------------------------------------------------ street furniture, trees, the corn
  progress?.(0.8, 'Planting the corn');
  furnish(ctx, { corn: CORN, areas: AREAS });

  // ------------------------------------------------------------ finish
  for (const m of T.meshes({ cast: (mat) => !/Paint|RedLane|Asphalt|Pavers|gravel|mud|awGrass/.test(mat) })) {
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    B.staticGroup.add(m);
  }
  const group = B.finish();
  group.add(dynamic);
  clearPropCache();

  // spawn points: open ground all over the map (the corn, the streets, behind the houses); a round's picks keep
  // a band of distance from the fireteam (game.js _spawnOne) and need a way to it (the nav grid)
  const spawnPoints = [];
  // (never inside a house: the LoD2 shells are hollow, and one spawned in there would never get out)
  const feet = [];
  for (const b of data.buildings) for (const f of b.foot) {
    const xs = f.map((p) => p[0]), zs = f.map((p) => p[1]);
    if (Math.max(...xs) < minX || Math.min(...xs) > maxX || Math.max(...zs) < minZ || Math.min(...zs) > maxZ) continue;
    feet.push({ f, x0: Math.min(...xs) - 1.5, x1: Math.max(...xs) + 1.5, z0: Math.min(...zs) - 1.5, z1: Math.max(...zs) + 1.5 });
  }
  const inHouseFoot = (x, z) => feet.some((q) => x > q.x0 && x < q.x1 && z > q.z0 && z < q.z1 && (inPoly(x, z, q.f) || [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].some(([dx, dz]) => inPoly(x + dx, z + dz, q.f))));
  for (let x = minX + 4; x < maxX - 4; x += 5) {
    for (let z = minZ + 4; z < maxZ - 4; z += 5) {
      const px = x + (rnd() - 0.5) * 3, pz = z + (rnd() - 0.5) * 3;
      if (inHall(px, pz, 2) || inDM(px, pz, 2) || inGarage(px, pz, 2) || inHouseFoot(px, pz)) continue;
      if (world.groundHeight(px, pz, 0.45, G + 0.3) > G + 0.05) continue;
      let blocked = false;
      world.query(px - 0.6, pz - 0.6, px + 0.6, pz + 0.6, (bx) => {
        if (bx.maxY > G + 0.25 && bx.minY < G + 1.8) {
          blocked = true;
          return true;
        }
      });
      if (!blocked) spawnPoints.push(new THREE.Vector3(px, G, pz));
    }
  }

  const isSheltered = (x, y, z) => {
    if (y < G + HALL.ceil + 0.3 && inHall(x, z)) return 1;
    if (y < G + 3 && inGarage(x, z)) return 1;
    if (y < G + DM.ceil + 0.5 && inDM(x, z)) return 1;
    return 0;
  };
  // the toxic haze only thickens out at the edges of the map (the farm's whole yard is gassed; here the fight is outside)
  const inGasZone = (x, y, z) => x < minX + 7 || x > maxX - 7 || z < minZ + 7 || z > maxZ - 7;
  const inHouse = (p) => inHall(p.x, p.z, -0.2) || inDM(p.x, p.z, -0.2);

  const update = (dt) => {
    for (const u of ctx.updates) u(dt);
  };
  const unlock = (name, game) => ctx.unlockables[name]?.open?.(game);

  const spawn = new THREE.Vector3(-13.2, G, -22.5); // the yard, before the painted gable
  return {
    id: 'appenweier',
    group,
    world,
    lamps,
    windows,
    spawnPoints,
    spawnBand: [30, 62],
    portals: [],
    navBlocks: ctx.navBlocks,
    navOpts: { minX, maxX, minZ, maxZ },
    entrances: ctx.entrances,
    barricadeSpots: ctx.barricadeSpots,
    breachSpots: [],
    radarSegments: ctx.radarSegments,
    specialSpots: ctx.specialSpots,
    generator: null,
    defensePosts: ctx.defensePosts,
    lab: null,
    shaft: null,
    playerSpawn: spawn,
    playerYaw: Math.PI / 2 - 0.1, // facing the mural
    shop: { custom: (scene, game) => garageShop(ctx, scene, game), entrance: new THREE.Vector3(GARAGE.x - 2.2, G, GARAGE.z + GARAGE.hz + 1.2) },
    unlocks: [
      {
        id: 'firestation', round: UPSTAIRS_ROUND, open: ['hallDoors'], portals: [], news: 'THE FIRE STATION IS OPEN', sound: 'wood_creak',
        banners: [['THE FIRE STATION IS OPEN', 'The hall doors are up · a special weapon waits inside · the infected can get in too', 'danger', 3300, 3.5]],
      },
      {
        id: 'drugstore', round: BASEMENT_ROUND, open: ['dmDoors'], portals: [], news: 'THE DRUGSTORE IS OPEN',
        banners: [['THE DRUGSTORE IS OPEN', 'Its doors slid open · supplies and a special weapon · watch the aisles', 'danger', 3300, 3.5]],
      },
    ],
    story: false,
    landmarks: false,
    stalkerHouse: null, // (no house runs: it watches from the corn and the dark, dashes, attacks)
    bigMap: true,
    eventCenter: 'team',
    eventClear: (x, z, m) => x < minX + 6 || x > maxX - 6 || z < minZ + 6 || z > maxZ - 6 || inHall(x, z, 2) || inDM(x, z, 2),
    powerPole: new THREE.Vector3(-26, G + 7.8, 12.6),
    inHouse,
    rain: {
      roofs: [[HALL.x0 - 0.3, HALL.z0 - 0.4, HALL.x1 + 0.3, HALL.z1 + 0.3, G + 7.5], [GARAGE.x - GARAGE.hx - 0.3, GARAGE.z - GARAGE.hz - 0.5, GARAGE.x + GARAGE.hx + 0.3, GARAGE.z + GARAGE.hz + 0.6, G + 2.8]],
      turned: { x: DM_CENTER[0], z: DM_CENTER[1], cos: Math.cos(-DM.ang), sin: Math.sin(-DM.ang), hx: DM.w / 2 + 0.3, hz: DM.d / 2 + 0.3, top: G + 8.2 },
      splash: [HALL.x0 - 0.2, HALL.z0 - 0.2, HALL.x1 + 0.2, HALL.z1 + 0.2],
      banks: [(minX + maxX) / 2, (minZ + maxZ) / 2, (maxX - minX) / 2 + 20, (maxZ - minZ) / 2 + 20],
      house: [HALL.x0, HALL.z0, HALL.x1, HALL.z1],
    },
    drips: [],
    decor: {
      rooms: [
        [-22, -12, -33, -24, G], // the yard before the garage
        [HALL.x0 + 0.6, HALL.x1 - 0.6, HALL.z0 + 0.8, HALL.z0 + 10, AW_FLOOR],
      ],
      pools: [[-24, 6, -30, 20, G + 0.2, 6]],
    },
    menuShots: {
      title: { fov: 56, period: 90, a: [-6.5, 1.75, -17.5, -22.6, 3.4, -24.2], b: [-8.2, 1.9, -27.5, -22.6, 3.5, -24.6] }, // the painted gable
      porch: { fov: 58, period: 70, a: [-27, 1.7, 14.5, -49, 3.2, 44], b: [-33, 1.8, 13.4, -50, 3.4, 44] }, // across the road: the fire station
      interior: { fov: 60, period: 80, a: [8, 1.6, 17.2, 10, 1.4, 44], b: [-4, 1.7, 18.2, 2, 1.5, 46] }, // the corn field in the fog
      // the PLAY screen (ui/lobbyStage.js): from the road over the dirt track at the corn field's edge, where the
      // squad stands in the dark and the mist and faces the camera (looking toward +z, screen left is +x, so the
      // first seat has the largest x). fog / hemi / moon / torch: how dark it is (the mist's density; the sky
      // light, the moon and the torch beam as shares of the game's own)
      lobby: {
        fov: 40,
        period: 60,
        fog: 0.12,
        hemi: 0.9,
        moon: 0.5,
        torch: 1.15,
        a: [0, 1.5, 19.2, 0, 1.25, 29.4],
        b: [0.3, 1.55, 18.8, 0, 1.25, 29.4],
        cast: { spots: [[1.35, 25.4, Math.PI + 0.22], [0.45, 25.4, Math.PI + 0.08], [-0.45, 25.4, Math.PI - 0.08], [-1.35, 25.4, Math.PI - 0.22]] },
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
