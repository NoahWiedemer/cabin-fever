// Builds public/maps/appenweier.json, the geodata behind the Appenweier map (src/world/appenweier.js):
//   * buildings: LGL Baden-Württemberg LoD2 (CityGML, "3D-Gebäudemodelle LoD2", Datenlizenz Deutschland
//     Namensnennung 2.0): roof and wall polygons, triangulated, each building set down on flat ground (y = 0)
//   * everything else from OpenStreetMap (© OpenStreetMap contributors, ODbL): streets with their widths,
//     cycle lanes and sidewalks, parking, kerbs, fences, hedges, trees, street lamps, land use, the railway
// Coordinates: metres, x = east, z = south (three.js: -z is north), y = up; the origin is ORIGIN below
// (on Sander Straße, between the Sanderstraße 13 plots and the fire station).
//
// Inputs (gitignored, see README): assets/source/appenweier/osm.json (Overpass `out geom` for the bbox
// 48.5330,7.9690,48.5380,7.9780) and assets/source/appenweier/lod2/*.gml (tiles 423_5376 / 424_5376 from
// https://opengeodata.lgl-bw.de/data/lod2/LoD2_32_423_5376_2_bw.zip).
//   node tools/appenweier-data.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'assets/source/appenweier');
const OUT = path.join(ROOT, 'public/maps/appenweier.json');
const ORIGIN = { lat: 48.5354, lon: 7.9734 };
const R_BUILD = 260; // buildings kept within this radius (m) of the origin (the backdrop beyond the fog)
const R_OSM = 300;
// The map is turned by ROT (degrees, about the origin) so the fire station's walls run along x / z (the game's
// walls and the gun shop are axis-aligned); Sander Straße then runs roughly along +x.
const ROT = -15.75;

// ------------------------------------------------------------------ WGS84 / ETRS89 -> UTM 32N (Krüger series)
function toUTM32(lat, lon) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + (n * n) / 4 + n ** 4 / 64);
  const al = [0, n / 2 - (2 / 3) * n * n + (5 / 16) * n ** 3, (13 / 48) * n * n - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
  const phi = (lat * Math.PI) / 180, lam = ((lon - 9) * Math.PI) / 180;
  const s = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - s * Math.atanh(s * Math.sin(phi)));
  const xi = Math.atan(t / Math.cos(lam));
  const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) {
    E += al[j] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    N += al[j] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return [500000 + k0 * A * E, k0 * A * N];
}
const [E0, N0] = toUTM32(ORIGIN.lat, ORIGIN.lon);
const r2 = (v) => Math.round(v * 100) / 100;
const RC = Math.cos((ROT * Math.PI) / 180), RS = Math.sin((ROT * Math.PI) / 180);
const local = (E, N) => {
  const x = E - E0, z = -(N - N0);
  return [x * RC - z * RS, x * RS + z * RC];
};
const ll = (lat, lon) => {
  const [E, N] = toUTM32(lat, lon);
  return local(E, N);
};

// ------------------------------------------------------------------ geometry helpers
function newell(pts) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
function dropDup(ring) {
  const r = ring.slice();
  const eq = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6 && Math.abs(p[2] - q[2]) < 1e-6;
  if (r.length > 1 && eq(r[0], r[r.length - 1])) r.pop();
  for (let i = r.length - 1; i > 0; i--) if (eq(r[i], r[i - 1])) r.splice(i, 1);
  return r;
}
/** a planar 3D polygon (outer ring + holes, local x/y/z) -> flat triangle list wound like its normal */
function triangulate(outer, holes) {
  const n = newell(outer);
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  // drop the dominant axis
  const proj = ax >= ay && ax >= az ? (p) => new THREE.Vector2(p[1], p[2]) : ay >= az ? (p) => new THREE.Vector2(p[2], p[0]) : (p) => new THREE.Vector2(p[0], p[1]);
  const all = [...outer, ...holes.flat()];
  let faces;
  try {
    faces = THREE.ShapeUtils.triangulateShape(outer.map(proj), holes.map((h) => h.map(proj)));
  } catch {
    return [];
  }
  const out = [];
  for (const [a, b, c] of faces) {
    const A = all[a], B = all[b], C = all[c];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const cx = u[1] * v[2] - u[2] * v[1], cy = u[2] * v[0] - u[0] * v[2], cz = u[0] * v[1] - u[1] * v[0];
    if (Math.hypot(cx, cy, cz) < 1e-5) continue; // degenerate
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    for (const P of flip ? [A, C, B] : [A, B, C]) out.push(r2(P[0]), r2(P[1]), r2(P[2]));
  }
  return out;
}
function centroid2(pts) {
  let x = 0, z = 0;
  for (const p of pts) (x += p[0]), (z += p[1]);
  return [x / pts.length, z / pts.length];
}
function inPoly(x, z, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function area2(poly) {
  let s = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) s += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  return s / 2;
}

// ------------------------------------------------------------------ LoD2 buildings
const ROOF_TYPES = { 1000: 'flat', 2100: 'shed', 2200: 'shed2', 3100: 'gable', 3200: 'hip', 3300: 'halfhip', 3400: 'mansard', 3500: 'pyramid', 4000: 'dome', 5000: 'mixed', 9999: 'other' };
const posList = (s) => {
  const v = s.trim().split(/\s+/).map(Number);
  const out = [];
  for (let i = 0; i + 2 < v.length; i += 3) out.push([v[i], v[i + 1], v[i + 2]]);
  return out;
};
function parseGml(file) {
  const xml = fs.readFileSync(file, 'utf8');
  const out = [];
  const memberRe = /<core:cityObjectMember>([\s\S]*?)<\/core:cityObjectMember>/g;
  let m;
  while ((m = memberRe.exec(xml))) {
    const body = m[1];
    const id = /<bldg:Building gml:id="([^"]+)"/.exec(body)?.[1];
    if (!id) continue;
    const fns = [...body.matchAll(/<bldg:function>([^<]+)</g)].map((x) => x[1]);
    const roofs = [...body.matchAll(/<bldg:roofType>([^<]+)</g)].map((x) => +x[1]);
    const heights = [...body.matchAll(/<bldg:measuredHeight[^>]*>([^<]+)</g)].map((x) => +x[1]);
    const surfaces = { RoofSurface: [], WallSurface: [], GroundSurface: [], ClosureSurface: [] };
    const surfRe = /<bldg:(RoofSurface|WallSurface|GroundSurface|ClosureSurface)\b[\s\S]*?<\/bldg:\1>/g;
    let s;
    while ((s = surfRe.exec(body))) {
      const polyRe = /<gml:Polygon\b[\s\S]*?<\/gml:Polygon>/g;
      let p;
      while ((p = polyRe.exec(s[0]))) {
        const ext = /<gml:exterior>[\s\S]*?<gml:posList[^>]*>([^<]*)<\/gml:posList>/.exec(p[0]);
        if (!ext) continue;
        const holes = [...p[0].matchAll(/<gml:interior>[\s\S]*?<gml:posList[^>]*>([^<]*)<\/gml:posList>/g)].map((h) => posList(h[1]));
        surfaces[s[1]].push({ outer: posList(ext[1]), holes });
      }
    }
    out.push({ id, fn: fns[0] ?? null, roofType: roofs[0] ?? null, roofTypes: roofs, height: heights.length ? Math.max(...heights) : null, surfaces });
  }
  return out;
}

const gmlDir = path.join(SRC, 'lod2');
const gmlFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.gml$/i.test(f)) gmlFiles.push(p);
  }
})(gmlDir);

const buildings = [];
const seen = new Set();
for (const file of gmlFiles) {
  for (const b of parseGml(file)) {
    if (seen.has(b.id)) continue;
    const ground = b.surfaces.GroundSurface.flatMap((g) => g.outer);
    const anyPts = ground.length ? ground : [...b.surfaces.WallSurface, ...b.surfaces.RoofSurface].flatMap((g) => g.outer);
    if (!anyPts.length) continue;
    const [cx, cz] = centroid2(anyPts.map((p) => local(p[0], p[1])));
    if (Math.hypot(cx, cz) > R_BUILD) continue;
    seen.add(b.id);
    // ground altitude: the lowest ground-surface corner (else the lowest wall corner)
    const gz = ground.length ? Math.min(...ground.map((p) => p[2])) : Math.min(...anyPts.map((p) => p[2]));
    const toL = (ring) => dropDup(ring).map((p) => {
      const [x, z] = local(p[0], p[1]);
      return [x, p[2] - gz, z];
    });
    const roof = [], wall = [], closure = [];
    for (const poly of b.surfaces.RoofSurface) roof.push(...triangulate(toL(poly.outer), poly.holes.map(toL)));
    for (const poly of b.surfaces.WallSurface) wall.push(...triangulate(toL(poly.outer), poly.holes.map(toL)));
    for (const poly of b.surfaces.ClosureSurface) closure.push(...triangulate(toL(poly.outer), poly.holes.map(toL)));
    const foot = b.surfaces.GroundSurface.map((g) => {
      const ring = dropDup(g.outer).map((p) => local(p[0], p[1]).map(r2));
      return area2(ring) < 0 ? ring.reverse() : ring; // counter-clockwise in x/z (seen from above: clockwise, z points south)
    }).filter((r) => r.length >= 3);
    let top = 0, eave = Infinity;
    for (let i = 1; i < roof.length; i += 3) {
      top = Math.max(top, roof[i]);
      eave = Math.min(eave, roof[i]);
    }
    if (!roof.length) {
      for (let i = 1; i < wall.length; i += 3) top = Math.max(top, wall[i]);
      eave = top;
    }
    buildings.push({
      id: b.id,
      fn: b.fn,
      roof: ROOF_TYPES[b.roofType] ?? String(b.roofType),
      h: b.height != null ? r2(b.height) : r2(top),
      top: r2(top),
      eave: r2(eave),
      alt: r2(gz),
      c: [r2(cx), r2(cz)],
      foot,
      roofTris: roof,
      wallTris: wall,
      closureTris: closure.length ? closure : undefined,
    });
  }
}

// ------------------------------------------------------------------ OpenStreetMap
const osm = JSON.parse(fs.readFileSync(path.join(SRC, 'osm.json'), 'utf8'));
const nodes = new Map();
for (const e of osm.elements) if (e.type === 'node') nodes.set(e.id, e);
const wayPts = (w) => (w.geometry ? w.geometry.map((g) => ll(g.lat, g.lon)) : (w.nodes || []).map((id) => nodes.get(id)).filter(Boolean).map((n) => ll(n.lat, n.lon)));
const rpts = (pts) => pts.map((p) => [r2(p[0]), r2(p[1])]);
const near = (pts, R) => pts.some((p) => Math.hypot(p[0], p[1]) < R);
const closed = (w) => w.nodes && w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1];

const roads = [], areas = [], lines = [], trees = [], lamps = [], pois = [], osmBuildings = [];
const KEEP_TAGS = ['name', 'highway', 'service', 'lanes', 'width', 'surface', 'cycleway', 'cycleway:right', 'cycleway:left', 'cycleway:both', 'sidewalk', 'sidewalk:right', 'sidewalk:left', 'sidewalk:both', 'oneway', 'layer', 'bridge', 'tunnel', 'footway', 'lit', 'maxspeed'];
const pickTags = (t, keys) => {
  const o = {};
  for (const k of keys) if (t[k] != null) o[k] = t[k];
  return o;
};

for (const e of osm.elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    const p = ll(e.lat, e.lon);
    if (Math.hypot(p[0], p[1]) > R_OSM) continue;
    if (t.natural === 'tree') trees.push([r2(p[0]), r2(p[1])]);
    else if (t.highway === 'street_lamp') lamps.push([r2(p[0]), r2(p[1])]);
    else if (Object.keys(t).length) pois.push({ p: rpts([p])[0], tags: t });
    continue;
  }
  if (e.type !== 'way') continue;
  const pts = wayPts(e);
  if (pts.length < 2 || !near(pts, R_OSM)) continue;
  const ring = closed(e) ? pts.slice(0, -1) : null;
  if (t.building) {
    if (ring) osmBuildings.push({ id: e.id, pts: rpts(ring), tags: t });
    continue;
  }
  if (t.highway && !t['area:highway']) {
    if (t.area === 'yes' && ring) areas.push({ kind: 'pedestrian', pts: rpts(ring), tags: pickTags(t, KEEP_TAGS) });
    else roads.push({ id: e.id, kind: t.highway, pts: rpts(pts), tags: pickTags(t, KEEP_TAGS) });
    continue;
  }
  if (t['area:highway'] && ring) {
    areas.push({ kind: 'island:' + t['area:highway'], pts: rpts(ring), tags: t });
    continue;
  }
  if (t.railway) {
    lines.push({ kind: 'rail:' + t.railway, pts: rpts(pts), tags: pickTags(t, ['layer', 'bridge', 'tunnel', 'embankment', 'name', 'usage', 'service']) });
    continue;
  }
  if (t.barrier) {
    lines.push({ kind: t.barrier, pts: rpts(pts), closed: !!ring, tags: t });
    continue;
  }
  if (t.natural === 'tree_row') {
    lines.push({ kind: 'tree_row', pts: rpts(pts), tags: t });
    continue;
  }
  if (ring && (t.amenity === 'parking' || t.amenity === 'parking_space' || t.landuse || t.natural || t.leisure || t.amenity || t.surface || t.man_made)) {
    const kind = t.amenity === 'parking' ? 'parking' : t.amenity === 'parking_space' ? 'parking_space' : t.landuse ? 'landuse:' + t.landuse : t.natural ? 'natural:' + t.natural : t.leisure ? 'leisure:' + t.leisure : t.amenity ? 'amenity:' + t.amenity : t.man_made ? 'man_made:' + t.man_made : 'surface';
    areas.push({ id: e.id, kind, pts: rpts(ring), tags: t });
    continue;
  }
  if (!ring && Object.keys(t).length) lines.push({ kind: 'other', pts: rpts(pts), tags: t });
}

// OSM building tags (address, name, use) onto the LoD2 buildings they cover
const OSM_KEYS = ['addr:street', 'addr:housenumber', 'name', 'building', 'building:levels', 'shop', 'amenity', 'emergency', 'operator', 'brand', 'roof:shape'];
for (const b of buildings) {
  const pts = b.foot.flat();
  const probe = pts.length ? centroid2(pts) : b.c;
  let hit = osmBuildings.find((o) => inPoly(probe[0], probe[1], o.pts));
  if (!hit) hit = osmBuildings.find((o) => b.foot.some((f) => inPoly(...centroid2(o.pts), f)));
  if (hit) {
    b.osm = pickTags(hit.tags, OSM_KEYS);
    b.osmId = hit.id;
    hit.used = true;
  }
}
// OSM buildings without a LoD2 model (newer than the survey): kept as footprints with a level count
const extraBuildings = osmBuildings.filter((o) => !o.used).map((o) => ({ osmId: o.id, pts: o.pts, tags: pickTags(o.tags, OSM_KEYS) }));

const data = {
  about: {
    origin: { ...ORIGIN, E: r2(E0), N: r2(N0), crs: 'ETRS89 / UTM 32N' },
    axes: 'x east, z south, y up (m), then turned by rot degrees about the origin (map north is rot degrees off -z); every building stands on y = 0 at its lowest ground corner',
    rot: ROT,
    sources: [
      'Buildings: LGL Baden-Württemberg, 3D-Gebäudemodelle LoD2 (www.lgl-bw.de), dl-de/by-2-0',
      'Streets, trees, lamps, land use: © OpenStreetMap contributors, ODbL 1.0',
    ],
    generated: new Date().toISOString().slice(0, 10),
  },
  buildings,
  extraBuildings,
  roads,
  areas,
  lines,
  trees,
  lamps,
  pois,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`origin E ${E0.toFixed(2)} N ${N0.toFixed(2)}`);
console.log(`${buildings.length} LoD2 buildings (${buildings.filter((b) => b.osm).length} with OSM tags), ${extraBuildings.length} OSM-only buildings`);
console.log(`${roads.length} roads, ${areas.length} areas, ${lines.length} lines, ${trees.length} trees, ${lamps.length} lamps, ${pois.length} pois -> ${path.relative(ROOT, OUT)} (${kb} KB)`);
for (const b of buildings.filter((b) => b.osm && (b.osm['addr:housenumber'] || b.osm.name)).sort((a, b) => Math.hypot(...a.c) - Math.hypot(...b.c)).slice(0, 40)) {
  console.log(`  ${b.id} ${(b.osm['addr:street'] ?? '').padEnd(14)} ${(b.osm['addr:housenumber'] ?? '').padEnd(4)} ${(b.osm.name ?? b.osm.building ?? '').slice(0, 28).padEnd(28)} c ${b.c.join(',').padEnd(14)} ${b.roof.padEnd(6)} h ${b.h} eave ${b.eave} top ${b.top} fn ${b.fn} tris ${b.roofTris.length / 9}+${b.wallTris.length / 9}`);
}
