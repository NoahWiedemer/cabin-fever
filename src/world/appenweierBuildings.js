// The places of the Appenweier map built by hand on top of the LoD2 shells (world/appenweier.js):
//   * Sanderstraße 13a: the painted east gable (Lüftlmalerei cut from the site photos: the peasant scenes, the
//     vine border, the cherubs at the peak, the painted satellite dish, the "Sanderstrasse 13a" scroll and the
//     Madonna tile), its windows with roller shutters and lace curtains, the arched metal awning with the sun
//   * 13c: the white-and-blue boarded bungalow with the star door and its tiled "13C" sign; 13: the white house
//   * the double garage with the solar panels and the painted dog: its left door rolls up between rounds on the
//     gun shop (garageShop: the game's gun shop interface, like world/gunshop.js)
//   * the fire station (Sander Straße 22): the vehicle hall with its three red roller doors (they go up with
//     round 4), the fire engine, the hose tower with FEUERWEHR 112, the recruiting banner
//   * the drugstore (Im See 18): the glass front, the sliding doors (open with round 10), shelves, checkouts
import * as THREE from 'three';
import { SURF, FLAG_NOBULLET, FLAG_NAVIGNORE } from './collision.js';
import { getMaterial, registerMaterial } from './materials.js';
import { AW_GROUND as G, AW_FLOOR, HALL, GARAGE, DM, DM_CENTER } from './appenweierLayout.js';
import { oBox, oWall, lod2Tris, B_ID, inTurned, polygon } from './appenweierGeo.js';
import { signTexture } from './appenweierTextures.js';
import { buildProp } from './propsSafe.js';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const smooth = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- walls of a footprint
/** a wall line p -> q ([x, z]) with its outward normal (away from the footprint centre c) */
function wallLine(p, q, c) {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const ux = (q[0] - p[0]) / L, uz = (q[1] - p[1]) / L;
  let nx = -uz, nz = ux;
  if ((c[0] - p[0]) * nx + (c[1] - p[1]) * nz > 0) (nx = -nx), (nz = -nz);
  return { p, q, L, ux, uz, nx, nz, ang: Math.atan2(uz, ux) };
}
const centre = (f) => f.reduce((a, p) => [a[0] + p[0] / f.length, a[1] + p[1] / f.length], [0, 0]);
/** the point s m along wall w, d m out from its face */
const at = (w, s, d = 0) => [w.p[0] + w.ux * s + w.nx * d, w.p[1] + w.uz * s + w.nz * d];

/** a thin panel on the face of wall w: s0..s1 along it, y0..y1, d out from the face; uvs 0..1 (or metres) */
function panel(T, mat, w, s0, s1, y0, y1, d, uv = null) {
  const a = at(w, s0, d), b = at(w, s1, d);
  // outward normal = the winding's front: a -> b -> top with the normal (nx, nz) ... pick the order that faces out
  const P0 = [a[0], y0, a[1]], P1 = [b[0], y0, b[1]], P2 = [b[0], y1, b[1]], P3 = [a[0], y1, a[1]];
  const u = uv ?? [[0, 0], [1, 0], [1, 1], [0, 1]];
  // the quad's normal for this order is (−uz, 0, ux) × sign: compare with the outward normal
  const front = -w.uz * w.nx + w.ux * w.nz > 0;
  if (front) T.quad(mat, P0, P1, P2, P3, u[0], u[1], u[2], u[3]);
  else T.quad(mat, P1, P0, P3, P2, u[1], u[0], u[3], u[2]);
}

/** a window on wall w: frame, glass (lit or dark), roller shutter box and (part) closed shutter, sill, lace */
function windowOn(T, w, s0, s1, y0, y1, o = {}) {
  const mid = (s0 + s1) / 2, hw = (s1 - s0) / 2, fr = 0.07;
  const box = (s, y, d, hs, hy, hd, mat) => {
    const c = at(w, s, d);
    oBox(T, null, c[0], c[1], hs, hd, w.ang, y - hy, y + hy, mat, { collide: false });
  };
  const glass = o.lit ? 'awGlassLit' : 'awGlass';
  panel(T, glass, w, s0 + fr, s1 - fr, y0 + fr, y1 - fr, 0.015);
  if (o.lace) panel(T, 'awLace', w, s0 + fr, s1 - fr, y0 + fr, y0 + (y1 - y0) * 0.62, 0.02);
  if (o.shut) panel(T, 'awShutter', w, s0 + fr * 0.5, s1 - fr * 0.5, y1 - (y1 - y0) * o.shut, y1, 0.035, [[0, 0], [(s1 - s0) / 0.6, 0], [(s1 - s0) / 0.6, ((y1 - y0) * o.shut) / 0.6], [0, ((y1 - y0) * o.shut) / 0.6]]);
  const fm = o.frame ?? 'awFrame';
  box(mid, y1 - fr / 2, 0.04, hw, fr / 2, 0.04, fm);
  box(mid, y0 + fr / 2, 0.04, hw, fr / 2, 0.04, fm);
  box(s0 + fr / 2, (y0 + y1) / 2, 0.04, fr / 2, (y1 - y0) / 2, 0.04, fm);
  box(s1 - fr / 2, (y0 + y1) / 2, 0.04, fr / 2, (y1 - y0) / 2, 0.04, fm);
  if (hw > 0.5) box(mid, (y0 + y1) / 2, 0.04, 0.03, (y1 - y0) / 2, 0.035, fm); // the two wings
  if (o.box !== false) box(mid, y1 + 0.12, 0.05, hw + 0.04, 0.12, 0.08, 'awShutter'); // roller shutter box
  box(mid, y0 - 0.03, 0.08, hw + 0.08, 0.03, 0.1, o.sill ?? 'awGalv');
  if (o.surround) {
    // the reddish-brown surround 13a's windows have
    const m = o.surround;
    box(mid, y1 + 0.3, 0.01, hw + 0.18, 0.05, 0.012, m);
    box(mid, y0 - 0.12, 0.01, hw + 0.18, 0.05, 0.012, m);
    box(s0 - 0.13, (y0 + y1) / 2 + 0.09, 0.01, 0.05, (y1 - y0) / 2 + 0.26, 0.012, m);
    box(s1 + 0.13, (y0 + y1) / 2 + 0.09, 0.01, 0.05, (y1 - y0) / 2 + 0.26, 0.012, m);
  }
}

/** a downspout at wall w's position s: from the eave down, with the elbow onto the gutter */
function downspout(T, w, s, top, d = 0.12) {
  const c = at(w, s, d);
  oBox(T, null, c[0], c[1], 0.045, 0.045, w.ang, G, top, 'awGalv', { collide: false });
}

// ---------------------------------------------------------------- lace curtain (13a's windows: geese and cats)
function laceMaterial() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(245,242,232,0.9)';
  ctx.fillRect(0, 0, 256, 160);
  ctx.strokeStyle = 'rgba(200,196,186,0.9)';
  ctx.lineWidth = 1;
  for (let x = 0; x < 256; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 3, 160);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(170,165,152,0.85)';
  for (let k = 0; k < 5; k++) {
    // little geese and cats in the pattern
    const x = 20 + k * 48, y = 70 + (k % 2) * 30;
    ctx.beginPath();
    ctx.ellipse(x, y, 12, 8, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 11, y - 12, 4, 9, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // the scalloped hem
  ctx.globalCompositeOperation = 'destination-out';
  for (let x = 0; x < 256; x += 16) {
    ctx.beginPath();
    ctx.arc(x + 8, 0, 7, 0, Math.PI);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.2, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffd9a0, emissiveIntensity: 0.18, emissiveMap: t });
  return registerMaterial('awLace', m);
}

// ---------------------------------------------------------------- 13a's painted gable
// The east gable: 20.02 m from its south corner to its north corner, eaves 4.97 m, the peak 7.68 m up in the middle.
// Positions along it (s, m from the south corner) and heights as in the photos.
const GABLE = { S: [-23.59, -13.8], N: [-21.9, -33.75], W: 20.02, eave: 4.97, peak: 7.68 };
const GABLE_WIN = [
  { s0: 3.0, s1: 4.9, y0: 0.95, y1: 2.25, lit: true },
  { s0: 6.9, s1: 9.6, y0: 0.9, y1: 2.3, lit: false },
  { s0: 15.9, s1: 17.6, y0: 1.0, y1: 2.12, lit: true },
];
const DOOR13A = { s0: 12.3, s1: 13.5, y1: 2.2 };

function muralMaterial(photos) {
  const PX = 102.4, W = 2048, H = 786; // 20 m x 7.68 m
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const X = (s) => s * PX, Y = (y) => H - y * PX;
  // the cream plaster with a little life in it
  ctx.fillStyle = '#f2e3b6';
  ctx.fillRect(0, 0, W, H);
  for (let k = 0; k < 2600; k++) {
    const x = Math.random() * W, y = Math.random() * H, r = 2 + Math.random() * 16;
    ctx.fillStyle = `rgba(${Math.random() < 0.5 ? '255,250,230' : '200,180,130'},${0.03 + Math.random() * 0.05})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // a darker plinth where the rain splashes up
  const pl = ctx.createLinearGradient(0, Y(0.5), 0, Y(0));
  pl.addColorStop(0, 'rgba(120,100,70,0)');
  pl.addColorStop(1, 'rgba(120,100,70,0.35)');
  ctx.fillStyle = pl;
  ctx.fillRect(0, Y(0.5), W, 0.5 * PX);
  const img = (name, s0, y0, w, h = null) => {
    const im = photos[name];
    if (!im) return;
    const hh = h ?? (w * im.height) / im.width;
    ctx.drawImage(im, X(s0), Y(y0 + hh), w * PX, hh * PX);
  };
  // the three peasant scenes over the windows and the door
  img('sceneLeft', 2.7, 2.45, 4.9);
  img('sceneCenter', 9.5, 2.95, 5.0);
  img('sceneRight', 15.6, 2.25, 2.75);
  // the vine border under both roof edges (4.97 m at the corners, 7.68 m at the peak)
  const vine = photos.vine;
  if (vine) {
    const band = 0.5, below = 0.18;
    const slope = (GABLE.peak - GABLE.eave) / (GABLE.W / 2);
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 0 : GABLE.W, x1 = GABLE.W / 2;
      const len = Math.hypot(x1 - x0, GABLE.peak - GABLE.eave);
      ctx.save();
      ctx.translate(X(x0), Y(GABLE.eave - below));
      ctx.rotate(side < 0 ? -Math.atan(slope) : Math.PI + Math.atan(slope));
      if (side > 0) ctx.scale(1, -1);
      const segW = band * (vine.width / vine.height);
      for (let t = 0; t < len; t += segW) ctx.drawImage(vine, 0, 0, vine.width * Math.min(1, (len - t) / segW), vine.height, t * PX, 0, Math.min(segW, len - t) * PX, band * PX);
      ctx.restore();
    }
  }
  img('cherubs', GABLE.W / 2 - 1.05, 5.85, 2.1);
  img('birds', 18.95, 3.95, 0.72, 0.72);
  img('scroll', 1.25, 2.35, 1.1);
  img('madonna', 1.62, 1.5, 0.3, 0.45);
  img('tilesL', DOOR13A.s0 - 0.62, 0.95, 0.36, 0.46);
  img('tilesR', DOOR13A.s1 + 0.28, 0.85, 0.3, 0.86);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  // (a faint glow of its own: the paintings stay readable at night, the flood light on the garage does the rest)
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, normalMap: getMaterial('awPlasterCream').normalMap ?? null, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.16 });
  if (m.normalMap) m.normalScale = new THREE.Vector2(0.5, 0.5);
  return registerMaterial('awMural13a', m);
}

/** the texture of a photo crop on its own (the sun under the awning, the star door) */
function photoMaterial(name, img, o = {}) {
  if (!img) return registerMaterial(name, new THREE.MeshStandardMaterial({ color: o.color ?? 0x888888, roughness: 0.8 }));
  const t = new THREE.Texture(img);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return registerMaterial(name, new THREE.MeshStandardMaterial({ map: t, roughness: o.rough ?? 0.7, metalness: o.metal ?? 0, transparent: !!o.alpha, alphaTest: o.alpha ? 0.3 : 0 }));
}

// ---------------------------------------------------------------- Sanderstraße 13, 13a, 13c
export function buildSanderstrasse13(ctx) {
  const { T, world, data, photos, lamps } = ctx;
  registerMaterial('awSurround', new THREE.MeshStandardMaterial({ color: 0xa8745a, roughness: 0.8 }));
  registerMaterial('awDoorRed', new THREE.MeshStandardMaterial({ color: 0x7c1d18, roughness: 0.55 }));
  registerMaterial('awTileYellow', new THREE.MeshStandardMaterial({ color: 0xe0b425, roughness: 0.35 }));
  laceMaterial();
  muralMaterial(photos);
  photoMaterial('awSunFan', photos.sun, { metal: 0.4, rough: 0.4 });
  photoMaterial('awStarDoor', photos.starDoor);
  photoMaterial('awDog', photos.dog, { alpha: true });
  const bld = (id) => data.buildings.find((b) => b.id === id);

  // ---- 13a: the walls but the east gable from LoD2, the gable painted
  const b13a = bld(B_ID.h13a);
  const eastN = [0.9965, 0.0844];
  lod2Tris(T, 'awPlasterCream', b13a.wallTris, G, (a, b, c, nx, ny, nz) => nx * eastN[0] + nz * eastN[1] > 0.95);
  {
    const S = GABLE.S, N = GABLE.N;
    const w = wallLine(S, N, centre(b13a.foot[0]));
    const pk = at(w, GABLE.W / 2);
    const P = (p, y) => [p[0] + w.nx * 0.002, G + y, p[1] + w.nz * 0.002];
    const U = (s, y) => [s / GABLE.W, y / GABLE.peak];
    const pS0 = P(S, 0), pN0 = P(N, 0), pNe = P(N, GABLE.eave), pSe = P(S, GABLE.eave), pPk = P(pk, GABLE.peak);
    const front = -w.uz * w.nx + w.ux * w.nz > 0;
    const quad = (a, b, c, d, ua, ub, uc, ud) => (front ? T.quad('awMural13a', a, b, c, d, ua, ub, uc, ud) : T.quad('awMural13a', b, a, d, c, ub, ua, ud, uc));
    quad(pS0, pN0, pNe, pSe, U(0, 0), U(GABLE.W, 0), U(GABLE.W, GABLE.eave), U(0, GABLE.eave));
    if (front) T.tri('awMural13a', pSe, pNe, pPk, U(0, GABLE.eave), U(GABLE.W, GABLE.eave), U(GABLE.W / 2, GABLE.peak));
    else T.tri('awMural13a', pNe, pSe, pPk, U(GABLE.W, GABLE.eave), U(0, GABLE.eave), U(GABLE.W / 2, GABLE.peak));
    // windows with lace, the door, the arched awning with the sun in its fanlight, the lamp by the door
    for (const g of GABLE_WIN) windowOn(T, w, g.s0, g.s1, G + g.y0, G + g.y1, { lit: g.lit, lace: true, surround: 'awSurround', shut: g.lit ? 0.18 : 0.45 });
    panel(T, 'awDoorRed', w, DOOR13A.s0, DOOR13A.s1, G, G + DOOR13A.y1, 0.02);
    panel(T, 'awGlassLit', w, DOOR13A.s0 + 0.35, DOOR13A.s1 - 0.35, G + 1.2, G + 1.9, 0.03);
    panel(T, 'awSunFan', w, DOOR13A.s0 - 0.55, DOOR13A.s1 + 0.55, G + 2.25, G + 2.95, 0.03);
    // the arched metal-and-glass awning over it (a curved roof on two brackets)
    const aw0 = DOOR13A.s0 - 0.7, aw1 = DOOR13A.s1 + 0.7, depth = 1.0, yb = G + 2.3;
    const segs = 10;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const r = (t) => [Math.sin(t * Math.PI) * 0.55, (t - 0.5) * (aw1 - aw0)];
      const [h0, s0] = r(t0), [h1, s1] = r(t1);
      const m0 = (aw0 + aw1) / 2;
      const q = (s, d, h) => {
        const p = at(w, m0 + s, d);
        return [p[0], yb + h, p[1]];
      };
      T.quad('awGalv', q(s0, 0.05, h0), q(s1, 0.05, h1), q(s1, depth, h1 * 0.85), q(s0, depth, h0 * 0.85), [0, 0], [1, 0], [1, 1], [0, 1]);
      T.quad('awGalv', q(s1, 0.05, h1 - 0.01), q(s0, 0.05, h0 - 0.01), q(s0, depth, h0 * 0.85 - 0.01), q(s1, depth, h1 * 0.85 - 0.01), [0, 0], [1, 0], [1, 1], [0, 1]);
    }
    const lampP = at(w, DOOR13A.s1 + 0.45, 0.2);
    lamps.push({ pos: V3(lampP[0], G + 1.95, lampP[1]), level: 1, color: 0xffd08a, intensity: 30, angle: 1.3, distance: 11, flicker: 0, spot: true, porch: true, floorY: G });
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), getMaterial('bulb'));
    globe.position.set(lampP[0], G + 1.95, lampP[1]);
    globe.castShadow = false;
    ctx.B.staticGroup.add(globe);
    downspout(T, w, 0.25, G + GABLE.eave);
    downspout(T, w, GABLE.W - 0.25, G + GABLE.eave);
    // the red fascia boards under the roof's edges on this gable (the roof overhangs a little)
    const fascia = (s0, y0, s1, y1) => {
      const a = at(w, s0, 0.25), b = at(w, s1, 0.25);
      T.quad('awFascia', [a[0], y0 - 0.26, a[1]], [b[0], y1 - 0.26, b[1]], [b[0], y1 + 0.04, b[1]], [a[0], y0 + 0.04, a[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
      T.quad('awFascia', [b[0], y1 - 0.26, b[1]], [a[0], y0 - 0.26, a[1]], [a[0], y0 + 0.04, a[1]], [b[0], y1 + 0.04, b[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    };
    fascia(-0.3, G + GABLE.eave - 0.08, GABLE.W / 2, G + GABLE.peak + 0.02);
    fascia(GABLE.W / 2, G + GABLE.peak + 0.02, GABLE.W + 0.3, G + GABLE.eave - 0.08);
    // pebbles along the foot of the wall
    for (let s = 0.3; s < GABLE.W - 0.3; s += 0.21) {
      if (s > DOOR13A.s0 - 0.2 && s < DOOR13A.s1 + 0.2) continue;
      const p = at(w, s, 0.18 + Math.random() * 0.12);
      const r = 0.05 + Math.random() * 0.05;
      const m = new THREE.Mesh(PEBBLE, getMaterial('awConcrete', { color: 0xb8b2a6 }));
      m.position.set(p[0], G + r * 0.4, p[1]);
      m.scale.set(r * 1.4, r, r * 1.2);
      m.rotation.y = Math.random() * 6;
      ctx.B.staticGroup.add(m);
    }
  }
  // 13a's long south side along the lane: windows under the roller shutter boxes, two small high windows
  {
    const f = b13a.foot[0], c = centre(f);
    const w = wallLine([-23.59, -13.8], [-43.51, -15.5], c);
    for (const [s, lit] of [[2.6, false], [6.2, true], [10.4, false], [14.6, false]]) windowOn(T, w, s, s + 1.4, G + 1.0, G + 2.25, { lit, lace: true, shut: lit ? 0.2 : 0.7 });
    for (const s of [4.6, 12.6]) windowOn(T, w, s, s + 0.55, G + 3.7, G + 4.25, { box: false });
    for (const s of [1.2, 8.4, 16.6]) {
      const p = at(w, s, 0.03);
      oBox(T, null, p[0], p[1], 0.22, 0.03, w.ang, G, G + 4.9, 'awPlasterWarm', { collide: false }); // the pilasters
    }
    downspout(T, w, 19.7, G + 4.97);
    const a = at(w, -0.3, 0.3), b = at(w, 20.3, 0.3);
    T.quad('awFascia', [a[0], G + 4.7, a[1]], [b[0], G + 4.7, b[1]], [b[0], G + 5.0, b[1]], [a[0], G + 5.0, a[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    T.quad('awFascia', [b[0], G + 4.7, b[1]], [a[0], G + 4.7, a[1]], [a[0], G + 5.0, a[1]], [b[0], G + 5.0, b[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
  }

  // ---- 13c: the boarded bungalow (13d in OSM) with the blue star door and the "13C" tiles
  {
    const b = bld(B_ID.h13c), f = b.foot[0], c = centre(f);
    lod2Tris(T, 'awSiding', b.wallTris, G);
    // the east long side (toward the drive): the door, two windows
    let best = null;
    for (let i = 0; i < f.length; i++) {
      const w = wallLine(f[i], f[(i + 1) % f.length], c);
      if (w.L > 8 && w.nx > 0.8) best = w;
    }
    if (best) {
      const w = best;
      const door = w.L * 0.55;
      panel(T, 'awStarDoor', w, door - 0.5, door + 0.5, G, G + 2.1, 0.02);
      oBox(T, null, ...at(w, door, 0.03), 0.58, 0.03, w.ang, G + 2.1, G + 2.18, 'awFrame', { collide: false });
      windowOn(T, w, 1.2, 2.4, G + 1.0, G + 2.2, { lit: true, shut: 0.35, frame: 'awAnthracite' });
      windowOn(T, w, w.L - 2.4, w.L - 1.2, G + 1.0, G + 2.2, { shut: 0.8, frame: 'awAnthracite' });
      // "13C" between blue-and-yellow tiles, right of the door
      const sign = signTexture([{ text: '13C', font: 'bold 64px Georgia', color: '#1d3f8a' }], { w: 256, h: 96, bg: '#f4f1e6', border: '#1d3f8a' });
      const m = registerMaterial('awSign13c', new THREE.MeshStandardMaterial({ map: sign, roughness: 0.4 }));
      void m;
      panel(T, 'awSign13c', w, door + 1.3, door + 1.62, G + 1.65, G + 1.77, 0.03);
      for (const ds of [1.2, 1.72]) panel(T, 'awTileYellow', w, door + ds, door + ds + 0.1, G + 1.66, G + 1.76, 0.03);
      lamps.push({ pos: V3(...insertY(at(w, door + 0.8, 0.25), G + 2.25)), level: 1, color: 0xffcf8a, intensity: 18, angle: 1.3, distance: 9, flicker: 0.1, spot: true, porch: true, floorY: G });
    }
    for (let i = 0; i < f.length; i++) {
      const w = wallLine(f[i], f[(i + 1) % f.length], c);
      if (w.L < 8) windowOn(T, w, w.L / 2 - 0.7, w.L / 2 + 0.7, G + 1.0, G + 2.1, { shut: 0.5, frame: 'awAnthracite' });
    }
  }

  // ---- 13: the white rendered house (two storeys, the balcony on the south wing)
  {
    const b = bld(B_ID.h13);
    lod2Tris(T, 'awPlasterWhite', b.wallTris, G);
    const f = b.foot[0], c = centre(f);
    for (let i = 0; i < f.length; i++) {
      const w = wallLine(f[i], f[(i + 1) % f.length], c);
      if (w.L < 4) continue;
      const n = Math.max(1, Math.floor(w.L / 3.4));
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * w.L;
        windowOn(T, w, s - 0.6, s + 0.6, G + 1.05, G + 2.3, { lit: (i + k) % 4 === 1, shut: (i + k) % 3 === 0 ? 0.9 : 0.3, frame: 'awAnthracite' });
        windowOn(T, w, s - 0.6, s + 0.6, G + 3.8, G + 5.0, { lit: (i + k) % 5 === 2, shut: (i + k) % 2 ? 0.6 : 0.15, frame: 'awAnthracite' });
      }
    }
    // the balcony along the wing's south face: a slab, grey slats
    const wing = b.foot[1];
    if (wing) {
      const wc = centre(wing);
      let south = null;
      for (let i = 0; i < wing.length; i++) {
        const w = wallLine(wing[i], wing[(i + 1) % wing.length], wc);
        if (w.nz > 0.8) south = w;
      }
      if (south) {
        const mid = at(south, south.L / 2, 0.75);
        oBox(T, world, mid[0], mid[1], south.L / 2, 0.75, south.ang, G + 2.95, G + 3.12, 'awConcrete', { collide: true, surface: SURF.concrete });
        for (let s = 0.1; s < south.L; s += 0.14) {
          const p = at(south, s, 1.47);
          oBox(T, null, p[0], p[1], 0.035, 0.012, south.ang, G + 3.12, G + 4.1, 'awAnthracite', { collide: false });
        }
      }
    }
  }
  // ---- the double garage (the gun shop is built with the shop: garageShop)
  buildGarage(ctx);

  // where the fireteam's bots hold (they pick the free ones nearest you): the yard first (0 is yours), the gate,
  // the lane; the fire station's forecourt and, once open, its hall; the store (face: yaw, 0 = toward +z)
  const post = (x, z, face, requires = null, y = G) => ctx.defensePosts.push({ pos: V3(x, y, z), face, level: 1, requires });
  post(-13.5, -22.5, 0);
  post(-18.5, -31, 0.2);
  post(-11.2, -13.5, 0);
  post(-25.5, -12.2, 0.6);
  post(-16.5, -4.5, 0);
  post(-5.5, -28.5, Math.PI / 2);
  post(-30, -18.5, -Math.PI / 2);
  post(-48, 37.5, Math.PI);
  post(-38.5, 33, Math.PI * 0.8);
  post(-60, 36, Math.PI * 1.2);
  post(-48.2, 46.5, Math.PI, 'firestation', AW_FLOOR);
  post(-43, 52, Math.PI * 0.6, 'firestation', AW_FLOOR);
  post(-52.8, 56, Math.PI, 'firestation', AW_FLOOR);
}
const PEBBLE = new THREE.IcosahedronGeometry(1, 0);
const insertY = (p, y) => [p[0], y, p[1]];

// ---------------------------------------------------------------- the double garage
function gLocal(lx, lz) {
  const c = Math.cos(GARAGE.ang), s = Math.sin(GARAGE.ang);
  return [GARAGE.x + lx * c - lz * s, GARAGE.z + lx * s + lz * c];
}
// its two doors on the south face (+lz), local x ranges
const GDOOR = { west: [-3.95, -1.05], east: [0.75, 3.95] };

function buildGarage(ctx) {
  const { T, world } = ctx;
  const { hx, hz, ang, wall, door } = GARAGE;
  const wt = 0.24;
  // walls (outer faces on the footprint), the front with both door openings, the middle wall between the bays
  const corners = [gLocal(-hx, -hz), gLocal(hx, -hz), gLocal(hx, hz), gLocal(-hx, hz)];
  const wallMat = { mat: 'awPlasterWhite', left: 'awPlasterWhite', right: 'awPlasterWhite', surface: SURF.concrete };
  // (oWall's offset shifts the wall to the left of p0 -> p1: going round clockwise in x/z the left is inside)
  oWall(T, world, corners[0], corners[1], G, G + wall, wt, [], { ...wallMat, offset: wt / 2 });
  oWall(T, world, corners[1], corners[2], G, G + wall, wt, [], { ...wallMat, offset: wt / 2 });
  oWall(T, world, corners[2], corners[3], G, G + wall, wt, [
    { a: hx - GDOOR.east[1], b: hx - GDOOR.east[0], y0: G, y1: G + door },
    { a: hx - GDOOR.west[1], b: hx - GDOOR.west[0], y0: G, y1: G + door },
  ], { ...wallMat, offset: wt / 2 });
  oWall(T, world, corners[3], corners[0], G, G + wall, wt, [], { ...wallMat, offset: wt / 2 });
  oWall(T, world, gLocal(-0.15, -hz + wt), gLocal(-0.15, hz - wt), G, G + wall, 0.2, [], wallMat);
  // flat roof with the red fascia all round; floor
  const rc = gLocal(0, 0);
  oBox(T, world, rc[0], rc[1], hx + 0.1, hz + 0.1, ang, G + wall, G + wall + 0.14, 'awRoofFlat', { surface: SURF.concrete, mats: { ny: 'awPlasterWhite' } });
  oBox(T, null, rc[0], rc[1], hx + 0.2, hz + 0.2, ang, G + wall - 0.12, G + wall + 0.26, 'awFascia', { collide: false, skip: ['py', 'ny'] });
  oBox(T, world, rc[0], rc[1], hx - 0.1, hz - 0.1, ang, G, AW_FLOOR, 'awConcrete', { surface: SURF.concrete, skip: ['ny'] });
  // the bulb over the bench in the left bay (the gun shop)
  {
    const lampPos = V3(...insertY(gLocal(-2.5, -0.9), G + 2.35));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), getMaterial('bulb'));
    bulb.position.copy(lampPos);
    ctx.B.staticGroup.add(bulb);
    ctx.lamps.push({ pos: lampPos, level: 1, color: 0xffc98f, intensity: 42, angle: 1.3, distance: 9, flicker: 0.05, spot: true, ceil: G + GARAGE.wall, floorY: AW_FLOOR, shadow: false });
  }
  // a flood light on 13's west wall, aimed across the yard at 13a's painted gable
  {
    const lp = V3(-9.32, G + 3.1, -27.5);
    const target = V3(-22.7, G + 3.6, -24.2);
    const fix = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.14), getMaterial('awAnthracite'));
    fix.position.copy(lp);
    fix.lookAt(target);
    ctx.B.staticGroup.add(fix);
    const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.14), getMaterial('bulb'));
    lens.position.copy(lp).addScaledVector(target.clone().sub(lp).normalize(), 0.075);
    lens.lookAt(target);
    ctx.B.staticGroup.add(lens);
    ctx.lamps.push({ pos: lp, aim: target.clone().sub(lp), level: 1, color: 0xffe0b0, intensity: 170, angle: 0.62, distance: 30, flicker: 0, spot: true, porch: true, shadow: false, floorY: G });
  }
  // the solar panels on the roof (two rows, tilted), the painted dog by the right door
  const pm = registerMaterial('awSolar', new THREE.MeshStandardMaterial({ color: 0x1a2332, roughness: 0.25, metalness: 0.6 }));
  void pm;
  for (let i = 0; i < 4; i++) {
    const p = gLocal(-1.2 + i * 1.3, -0.6);
    const g = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.04, 1.8), getMaterial('awSolar'));
    g.position.set(p[0], G + wall + 0.45, p[1]);
    g.rotation.set(-0.35, -ang, 0, 'YXZ');
    ctx.B.staticGroup.add(g);
  }
  {
    const a = gLocal(GDOOR.east[0] - 0.62, hz + 0.01), b = gLocal(GDOOR.east[0] - 0.12, hz + 0.01);
    T.quad('awDog', [a[0], G + 0.05, a[1]], [b[0], G + 0.05, b[1]], [b[0], G + 0.95, b[1]], [a[0], G + 0.95, a[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // the right (east) door: closed, white sectional door with its grooves
  {
    const a = gLocal(GDOOR.east[0], hz - 0.1), b = gLocal(GDOOR.east[1], hz - 0.1);
    const m = registerMaterial('awGarageDoor', new THREE.MeshStandardMaterial({ color: 0xdadcdc, roughness: 0.5, metalness: 0.3, map: grooves() }));
    void m;
    T.quad('awGarageDoor', [a[0], G, a[1]], [b[0], G, b[1]], [b[0], G + door, b[1]], [a[0], G + door, a[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    const c = gLocal((GDOOR.east[0] + GDOOR.east[1]) / 2, hz - 0.1);
    world.addOBB(c[0], c[1], (GDOOR.east[1] - GDOOR.east[0]) / 2, 0.08, -ang, G, G + door, SURF.metal, 0, 'garageDoor');
  }
}
function grooves() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e8eaea';
  ctx.fillRect(0, 0, 64, 256);
  ctx.fillStyle = '#9da2a4';
  for (let x = 0; x < 64; x += 8) ctx.fillRect(x, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 1);
  return t;
}

/**
 * The gun shop in the garage's left bay: its door rolls up in the buy phase. The interface world/gunshop.js has:
 * canInteract (in the bay while it is open), setOpen, evacuate (anyone inside when a round starts), update,
 * entrance (the HUD's way there), keeper (none: nobody minds this shop).
 */
export function garageShop(ctx, scene, game) {
  const { hz, ang, door } = GARAGE;
  const world = game.world;
  const root = new THREE.Group();
  root.name = 'garageShop';
  scene.add(root);
  // the roll-up door of the left bay
  const dw = GDOOR.west[1] - GDOOR.west[0];
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(dw, door, 0.05), getMaterial('awGarageDoor'));
  const dc = gLocal((GDOOR.west[0] + GDOOR.west[1]) / 2, hz - 0.1);
  leaf.position.set(dc[0], G + door / 2, dc[1]);
  leaf.rotation.y = -ang;
  leaf.castShadow = true;
  root.add(leaf);
  const col = world.addOBB(dc[0], dc[1], dw / 2, 0.08, -ang, G, G + door, SURF.metal, FLAG_NAVIGNORE, 'shopGate');
  // inside: a workbench of guns, a pegboard with the rifles on it, ammo crates, a lamp over the bench, the neon
  const put = (type, lx, lz, rot, opts = {}) => {
    try {
      const p = buildProp(type, { seed: 7, ...opts });
      const q = gLocal(lx, lz);
      p.object.position.set(q[0], AW_FLOOR, q[1]);
      p.object.rotation.y = -ang + rot;
      root.add(p.object);
      for (const c of p.colliders ?? []) {
        const cx = (c.min[0] + c.max[0]) / 2, cz = (c.min[2] + c.max[2]) / 2;
        const w = gLocal(lx + cx * Math.cos(rot) + cz * Math.sin(rot), lz - cx * Math.sin(rot) + cz * Math.cos(rot));
        world.addOBB(w[0], w[1], (c.max[0] - c.min[0]) / 2, (c.max[2] - c.min[2]) / 2, -ang + rot, AW_FLOOR + c.min[1], AW_FLOOR + c.max[1], SURF.wood, 0, 'shop');
      }
      return p;
    } catch (e) {
      return null;
    }
  };
  put('workbench', -2.5, -2.2, 0);
  put('ammoCrate', -3.9, -1.9, 0.3);
  put('ammoCrate', -3.8, -1.0, -0.2);
  put('crate', -0.8, -2.05, 0.1);
  put('barrel', -0.75, -0.9, 0);
  // the pegboard of guns on the back wall (painted outlines + the rifles themselves as dark shapes)
  const peg = document.createElement('canvas');
  peg.width = 512;
  peg.height = 256;
  const g2 = peg.getContext('2d');
  g2.fillStyle = '#8a6e4c';
  g2.fillRect(0, 0, 512, 256);
  g2.fillStyle = 'rgba(40,30,20,0.55)';
  for (let x = 8; x < 512; x += 16) for (let y = 8; y < 256; y += 16) g2.fillRect(x, y, 3, 3);
  g2.fillStyle = '#1b1c1e';
  const gun = (x, y, l, s = 1) => {
    g2.fillRect(x, y, l * s, 14 * s);
    g2.fillRect(x + l * 0.62 * s, y + 12 * s, 16 * s, 26 * s);
    g2.fillRect(x - 40 * s, y + 4 * s, 44 * s, 22 * s);
    g2.fillRect(x + l * 0.3 * s, y + 12 * s, 18 * s, 34 * s);
  };
  gun(70, 40, 300);
  gun(90, 120, 260, 0.9);
  gun(300, 190, 150, 0.7);
  const pegT = new THREE.CanvasTexture(peg);
  pegT.colorSpace = THREE.SRGBColorSpace;
  const pegM = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 1.5), new THREE.MeshStandardMaterial({ map: pegT, roughness: 0.8 }));
  const pc = gLocal(-2.5, -GARAGE.hz + 0.26);
  pegM.position.set(pc[0], G + 1.55, pc[1]);
  pegM.rotation.y = -ang;
  root.add(pegM);
  // the neon over the door (GUNS) and OPEN in the corner: lit while the shop is open
  const neonT = signTexture([{ text: 'GUNS · AMMO', font: 'bold 70px Arial' }], { w: 512, h: 110, bg: null, fg: '#ff5a2a' });
  const neonMat = new THREE.MeshBasicMaterial({ map: neonT, transparent: true, color: new THREE.Color(2.2, 2.2, 2.2), toneMapped: false, fog: false });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.47), neonMat);
  const nc = gLocal((GDOOR.west[0] + GDOOR.west[1]) / 2, GARAGE.hz + 0.03);
  neon.position.set(nc[0], G + door + 0.24, nc[1]);
  neon.rotation.y = -ang + Math.PI;
  neon.rotateY(Math.PI);
  root.add(neon);
  const entrance = V3(...insertY(gLocal((GDOOR.west[0] + GDOOR.west[1]) / 2, GARAGE.hz + 1.3), G));
  const exit = entrance.clone();
  const inBay = (p) => inTurned(p.x, p.z, ...gLocal(-2.1, 0.1), 2.0, 2.8, ang, 0);
  let open = false, openT = 0;
  const shop = {
    root,
    keeper: null,
    entrance,
    get isOpen() {
      return open;
    },
    canInteract(player) {
      return open && !!player?.alive && inBay(player.pos) && player.pos.y < G + 1.5;
    },
    setOpen(v) {
      open = !!v;
      col.pieces.forEach((p) => (p.enabled = !open));
    },
    evacuate(player) {
      if (!player || !inTurned(player.pos.x, player.pos.z, GARAGE.x, GARAGE.z, GARAGE.hx, GARAGE.hz, ang, 0)) return false;
      player.pos.copy(exit);
      player.body?.vel?.set(0, 0, 0);
      return true;
    },
    update(dt) {
      openT = THREE.MathUtils.clamp(openT + (open ? dt : -dt) * 0.8, 0, 1);
      const e = smooth(openT);
      leaf.position.y = G + door / 2 + e * (door - 0.25);
      leaf.scale.y = 1 - e * 0.85;
      const flick = Math.random() < 0.02 ? 0.3 : 1;
      neonMat.color.setScalar((open ? 2.4 : 0.35) * flick);
    },
  };
  shop.setOpen(false);
  return shop;
}

// ---------------------------------------------------------------- the fire station
const HALL_DOORS = [
  [-54.2, -50.9],
  [-49.8, -46.5],
  [-45.4, -42.1],
];
const SIDE_DOOR = [46.2, 47.4]; // on the east wall (z)

export function buildFireStation(ctx) {
  const { B, T, world, lamps, dynamic, data } = ctx;
  const { x0, x1, z0, z1 } = HALL;
  const top = G + HALL.wallTop, t = 0.3;
  const opts = () => ({ sides: { pos: 'awPlasterWhite', neg: 'awPlasterWhite' }, floorY: AW_FLOOR, ceilY: G + HALL.ceil, jamb: 'awPlasterWhite', surface: SURF.concrete, grime: 0.35 });
  // north wall with the three doors; the east wall with the side door; south and west solid
  B.wall('x', z0 + t / 2, x0, x1, G, top, t, HALL_DOORS.map(([a, b]) => ({ a, b, y0: G, y1: G + HALL.doorTop })), opts(false));
  B.wall('x', z1 - t / 2, x0, x1, G, top, t, [], opts(true));
  B.wall('z', x1 - t / 2, z0 + t, z1 - t, G, top, t, [{ a: SIDE_DOOR[0], b: SIDE_DOOR[1], y0: G, y1: G + 2.15 }], opts(true));
  B.wall('z', x0 + t / 2, z0 + t, z1 - t, G, top, t, [], opts(false));
  // floor, ceiling
  B.box(x0 + t, G, z0 + t, x1 - t, AW_FLOOR, z1 - t, { mat: 'concrete', surface: SURF.concrete, grime: 0.2 });
  B.box(x0 + t, G + HALL.ceil, z0 + t, x1 - t, G + HALL.ceil + 0.12, z1 - t, { mats: { ny: 'awPlasterWhite', py: 'awRoofFlat' }, mat: 'awPlasterWhite', surface: SURF.concrete, grime: 0 });
  // the parking bays' yellow lines, the drain
  const yl = registerMaterial('awYellowPaint', new THREE.MeshStandardMaterial({ color: 0xd9a41f, roughness: 0.7 }));
  void yl;
  for (const x of [-50.35, -45.95]) B.box(x - 0.06, AW_FLOOR, z0 + 1.2, x + 0.06, AW_FLOOR + 0.004, z0 + 13.5, { mat: 'awYellowPaint', collide: false, grime: 0, castShadow: false });

  // the three red roller doors: closed until the hall opens (round 4), then they roll up into their boxes
  const doors = [];
  const doorMat = getMaterial('awRedDoor');
  const winMat = getMaterial('awGlass');
  for (const [a, b] of HALL_DOORS) {
    const w = b - a, h = HALL.doorTop;
    const g = new THREE.Group();
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), doorMat);
    leaf.position.y = h / 2;
    leaf.castShadow = true;
    g.add(leaf);
    for (let k = 0; k < 4; k++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w / 5.2, 0.32), winMat);
      win.position.set(-w / 2 + (k + 0.75) * (w / 4.3), h * 0.66, -0.045);
      win.rotation.y = Math.PI;
      g.add(win);
    }
    g.position.set((a + b) / 2, G, z0 - 0.05);
    dynamic.add(g);
    const col = world.add(a, G, z0 - 0.1, b, G + h, z0 + 0.3, SURF.metal, 0, 'hallDoor');
    doors.push({ g, leaf, col, h });
    // the roller box over it (outside)
    B.box(a - 0.1, G + h, z0 - 0.35, b + 0.1, G + h + 0.4, z0, { mat: 'awRedDoor', collide: false, grime: 0 });
  }
  // the side door (a steel door) and its leaf
  const side = new THREE.Group();
  const sideLeaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.12, SIDE_DOOR[1] - SIDE_DOOR[0]), getMaterial('awRedDoor'));
  sideLeaf.position.set(0, 1.06, (SIDE_DOOR[1] - SIDE_DOOR[0]) / 2);
  side.add(sideLeaf);
  side.position.set(x1 + 0.02, G, SIDE_DOOR[0]);
  dynamic.add(side);
  const sideCol = world.add(x1 - 0.3, G, SIDE_DOOR[0], x1 + 0.05, G + 2.15, SIDE_DOOR[1], SURF.metal, 0, 'hallSideDoor');
  const hall = { open: false, t: 0 };
  ctx.unlockables.hallDoors = {
    open(game) {
      if (hall.open) return;
      hall.open = true;
      for (const d of doors) d.col.enabled = false;
      sideCol.enabled = false;
      game?.nav?.refreshRect(x0 - 1, x1 + 1, z0 - 1, z0 + 1.5);
      game?.nav?.refreshRect(x1 - 1.5, x1 + 1, SIDE_DOOR[0] - 1, SIDE_DOOR[1] + 1);
    },
  };
  ctx.updates.push((dt) => {
    if (!hall.open || hall.t >= 1) return;
    hall.t = Math.min(1, hall.t + dt * 0.28);
    const e = smooth(hall.t);
    for (const d of doors) {
      d.g.scale.y = 1 - e * 0.93;
      d.g.position.y = G + e * d.h * 0.93;
    }
    side.rotation.y = -e * 1.9;
  });

  // the vehicles: the fire engine in the west bay, the crew van in the east bay; kit along the walls
  const P = ctx.prop;
  P('fireEngine', -52.55, AW_FLOOR, z0 + 6.6, 0, {}, { surface: SURF.metal });
  P('crewVan', -43.75, AW_FLOOR, z0 + 5.4, 0, {}, { surface: SURF.metal });
  for (let i = 0; i < 6; i++) P('turnoutLocker', x0 + 1.2 + i * 1.05, AW_FLOOR, z1 - 0.62, Math.PI, { seed: i + 3 });
  P('shelfUnit', x1 - 0.55, AW_FLOOR, z0 + 16, -Math.PI / 2);
  P('shelfUnit', x1 - 0.55, AW_FLOOR, z0 + 18.2, -Math.PI / 2);
  P('workbench', x1 - 0.7, AW_FLOOR, z0 + 22.5, -Math.PI / 2);
  P('hoseRack', x0 + 0.45, AW_FLOOR, z0 + 18, Math.PI / 2);
  P('hoseRack', x0 + 0.45, AW_FLOOR, z0 + 21, Math.PI / 2);
  P('crate', -48.2, AW_FLOOR, z0 + 20.5, 0.3);
  P('table', -48.2, AW_FLOOR, z0 + 9.5, 0);
  // hall lights (on the ceiling, fluorescent)
  for (const [x, z] of [[-52.5, z0 + 5], [-48.2, z0 + 5], [-43.9, z0 + 5], [-52.5, z0 + 15], [-43.9, z0 + 15], [-48.2, z0 + 23]]) {
    lamps.push({ pos: V3(x, G + HALL.ceil - 0.08, z), level: 1, color: 0xe8f0ff, intensity: 34, angle: 1.35, distance: 13, flicker: z > z0 + 20 ? 0.4 : 0, spot: true, ceil: G + HALL.ceil, floorY: AW_FLOOR, room: (p) => p.x > x0 - 3 && p.x < x1 + 3 && p.z > z0 - 4 && p.z < z1 + 1 });
    B.box(x - 0.7, G + HALL.ceil - 0.08, z - 0.09, x + 0.7, G + HALL.ceil, z + 0.09, { mat: 'awFrame', collide: false, grime: 0, castShadow: false });
  }
  // the flood light over the doors (the forecourt), no shadow
  lamps.push({ pos: V3(-48.2, G + 3.95, z0 - 0.6), level: 1, color: 0xfff1d6, intensity: 75, angle: 1.15, distance: 24, flicker: 0, spot: true, porch: true, shadow: false, floorY: G });
  ctx.specialSpots.goldenPunisher = { pos: V3(-48.2, AW_FLOOR + 0.84, z0 + 9.5), where: 'in the fire station', requires: 'firestation' };
  ctx.specialSpots.chaingun = { pos: V3(-40, G + 0.05, 36), where: 'on the fire station forecourt' };

  // ways in for the horde (the doors, once open) and barricade spots
  for (const [a, b] of HALL_DOORS) {
    ctx.entrances.push({ id: 'hall' + a, level: 1, x: (a + b) / 2, z: z0 + 1.2, requires: 'firestation', enabled: false, barricade: 'hall' + a });
    ctx.barricadeSpots.push({ id: 'hall' + a, name: 'FIRE STATION DOOR', level: 1, axis: 'x', c: z0 + t / 2, t, a, b, y0: G, y1: G + HALL.doorTop, requires: 'firestation' });
  }
  ctx.entrances.push({ id: 'hallSide', level: 1, x: x1 - 1.2, z: (SIDE_DOOR[0] + SIDE_DOOR[1]) / 2, requires: 'firestation', enabled: false, barricade: 'hallSide' });
  ctx.barricadeSpots.push({ id: 'hallSide', name: 'FIRE STATION SIDE DOOR', level: 1, axis: 'z', c: x1 - t / 2, t, a: SIDE_DOOR[0], b: SIDE_DOOR[1], y0: G, y1: G + 2.15, requires: 'firestation' });
  const openEntrances = ctx.unlockables.hallDoors.open;
  ctx.unlockables.hallDoors.open = (game) => {
    openEntrances(game);
    for (const e of ctx.entrances) if (e.requires === 'firestation') e.enabled = true;
  };

  // ---- the hose tower in the notch west of the hall: FEUERWEHR · 112, the antenna
  {
    const tx0 = -58.7, tx1 = -55.25, tz0 = 48.1, tz1 = 52.8, th = 11.6;
    B.box(tx0, G, tz0, tx1, G + th, tz1, { mat: 'awPlasterWhite', surface: SURF.concrete, grime: 0.15, floorY: G, ceilY: G + th });
    const band = signTexture([{ text: 'FEUERWEHR', font: 'bold 60px Arial', color: '#ffffff' }], { w: 512, h: 96, bg: '#c8261e' });
    const band112 = signTexture([{ text: '112', font: 'bold 72px Arial', color: '#ffffff' }], { w: 256, h: 96, bg: '#c8261e' });
    // (lit a little from within, like the lettering on the tower at night)
    registerMaterial('awFwBand', new THREE.MeshStandardMaterial({ map: band, roughness: 0.6, emissive: 0xffffff, emissiveMap: band, emissiveIntensity: 0.35 }));
    registerMaterial('awFw112', new THREE.MeshStandardMaterial({ map: band112, roughness: 0.6, emissive: 0xffffff, emissiveMap: band112, emissiveIntensity: 0.35 }));
    const by0 = G + 8.1, by1 = G + 8.85;
    T.quad('awFwBand', [tx0, by0, tz0 - 0.01], [tx1, by0, tz0 - 0.01], [tx1, by1, tz0 - 0.01], [tx0, by1, tz0 - 0.01], [1, 0], [0, 0], [0, 1], [1, 1]);
    T.quad('awFw112', [tx1 + 0.01, by0, tz0], [tx1 + 0.01, by0, tz1], [tx1 + 0.01, by1, tz1], [tx1 + 0.01, by1, tz0], [0, 0], [1, 0], [1, 1], [0, 1]);
    T.quad('awFw112', [tx0 - 0.01, by0, tz1], [tx0 - 0.01, by0, tz0], [tx0 - 0.01, by1, tz0], [tx0 - 0.01, by1, tz1], [0, 0], [1, 0], [1, 1], [0, 1]);
    // the dark opening near the top, the hip cap, the antennas
    T.quad('awGlass', [tx0 + 0.6, G + 9.6, tz0 - 0.012], [tx1 - 0.6, G + 9.6, tz0 - 0.012], [tx1 - 0.6, G + 10.9, tz0 - 0.012], [tx0 + 0.6, G + 10.9, tz0 - 0.012], [0, 0], [1, 0], [1, 1], [0, 1]);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(Math.hypot(tx1 - tx0, tz1 - tz0) / 2 + 0.45, 1.7, 4, 1), getMaterial('awRoofDark'));
    cap.position.set((tx0 + tx1) / 2, G + th + 0.85, (tz0 + tz1) / 2);
    cap.rotation.y = Math.PI / 4;
    cap.scale.set((tx1 - tx0 + 0.9) / (tz1 - tz0 + 0.9), 1, 1);
    cap.castShadow = true;
    B.staticGroup.add(cap);
    for (const [dx, h] of [[-0.4, 3.2], [0.5, 2.4]]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, h, 6), getMaterial('awGalv'));
      ant.position.set((tx0 + tx1) / 2 + dx, G + th + 1.4 + h / 2, (tz0 + tz1) / 2);
      B.staticGroup.add(ant);
    }
    ctx.radarSegments.push([tx0, tz0, tx1, tz0], [tx1, tz0, tx1, tz1], [tx1, tz1, tx0, tz1], [tx0, tz1, tx0, tz0]);
  }
  // the west wing's windows toward the road (roller shutters mostly down) and the banner in front
  {
    const b = data.buildings.find((q) => q.id === B_ID.fire);
    const f = b.foot[0], c = centre(f);
    for (let i = 0; i < f.length; i++) {
      const w = wallLine(f[i], f[(i + 1) % f.length], c);
      if (w.L < 9) continue;
      const mx = (w.p[0] + w.q[0]) / 2, mz = (w.p[1] + w.q[1]) / 2;
      if (mx > x0 - 0.5 && mx < x1 + 0.5 && mz > z0 - 0.5 && mz < z1 + 0.5) continue; // (the hall: own walls)
      const n = Math.floor(w.L / 2.8);
      for (let k = 0; k < n; k++) {
        const s = ((k + 0.5) / n) * w.L;
        windowOn(T, w, s - 0.62, s + 0.62, G + 1.0, G + 2.25, { lit: k === 2 && w.nz < 0, shut: k % 3 === 0 ? 0.25 : 0.95, frame: 'awFrame' });
      }
    }
    ctx.prop('banner', -66.5, G, 47.8, Math.PI, { text: ['WERDE AUCH DU', 'TEIL DER FEUERWEHR!'] });
    ctx.prop('boulder', -56.4, G, 41.8, 0.6);
  }
  ctx.radarSegments.push([x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
}

// ---------------------------------------------------------------- the drugstore (Im See 18)
/** a point on the sales floor: u along the front (0..w), v into the store (0..d) from its south-west corner */
function dmP(u, v) {
  return [DM.ax + DM.u[0] * u + DM.v[0] * v, DM.az + DM.u[1] * u + DM.v[1] * v];
}
const DM_DOOR = [4.4, 7.4]; // the sliding doors along the front (u)

export function buildDrugstore(ctx) {
  const { T, world, lamps, dynamic } = ctx;
  const W = DM.w, D = DM.d, top = G + 4.95, ang = DM.ang;
  const wt = 0.2;
  const c0 = dmP(0, 0), c1 = dmP(W, 0), c2 = dmP(W, D), c3 = dmP(0, D);
  // the glass front (A -> B): a low plinth, glass up to 3.2 m, the fascia with the sign above
  const glassOpen = [{ a: DM_DOOR[0], b: DM_DOOR[1], y0: G, y1: G + 2.45 }];
  // collide: the glass stops the infected and you, not the bullets (FLAG_NOBULLET)
  const segs = [[0.25, DM_DOOR[0]], [DM_DOOR[1], W - 0.25]];
  for (const [a, b] of segs) {
    const m = dmP((a + b) / 2, 0.1);
    oBox(T, world, m[0], m[1], (b - a) / 2, 0.04, ang, G + 0.3, G + 3.2, 'glass', { surface: SURF.glass, flags: FLAG_NOBULLET, mats: { py: 'awGalv', ny: 'awGalv' } });
    oBox(T, world, m[0], m[1], (b - a) / 2, 0.12, ang, G, G + 0.3, 'awAnthracite', { surface: SURF.concrete });
    for (let u = a; u <= b + 1e-3; u += (b - a) / Math.max(1, Math.round((b - a) / 2.4))) {
      const p = dmP(u, 0.1);
      oBox(T, null, p[0], p[1], 0.05, 0.07, ang, G, G + 3.25, 'awGalv', { collide: false });
    }
  }
  oWall(T, world, c0, c1, G + 3.2, top, 0.3, [], { mat: 'awPanels', left: 'awPlasterWhite', right: 'awPanels', offset: -0.15 });
  // the sign: a generic drugstore sign (no brand): DROGERIE on the dark fascia
  {
    const sign = signTexture([{ text: 'DROGERIE', font: 'bold 92px Arial', color: '#ffffff' }], { w: 1024, h: 160, bg: '#20355f' });
    registerMaterial('awDmSign', new THREE.MeshStandardMaterial({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.9, roughness: 0.4 }));
    const a = dmP(W * 0.5 - 4, -0.2), b = dmP(W * 0.5 + 4, -0.2);
    T.quad('awDmSign', [b[0], G + 3.5, b[1]], [a[0], G + 3.5, a[1]], [a[0], G + 4.55, a[1]], [b[0], G + 4.55, b[1]], [0, 0], [1, 0], [1, 1], [0, 1]);
    lamps.push({ pos: V3(...insertY(dmP(W * 0.5, -1.2), G + 4.9)), level: 1, color: 0xd8e6ff, intensity: 40, angle: 1.2, distance: 16, flicker: 0, spot: true, porch: true, shadow: false, floorY: G });
  }
  // the inner faces of the other three walls (the LoD2 shell outside) and their colliders
  const inner = { mat: 'awPlasterWhite', left: 'awPlasterWhite', right: 'awPlasterWhite', surface: SURF.concrete };
  oWall(T, world, c1, c2, G, top, wt, [], { ...inner, offset: -(0.06 + wt / 2) });
  oWall(T, world, c2, c3, G, top, wt, [], { ...inner, offset: -(0.06 + wt / 2) });
  oWall(T, world, c3, c0, G, top, wt, [], { ...inner, offset: -(0.06 + wt / 2) });
  // floor and ceiling
  const cc = dmP(W / 2, D / 2);
  const fl = registerMaterial('awDmFloor', new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.35, map: tiles() }));
  void fl;
  oBox(T, world, cc[0], cc[1], W / 2 - 0.1, D / 2 - 0.1, ang, G, AW_FLOOR, 'awDmFloor', { surface: SURF.concrete, skip: ['ny'] });
  oBox(T, null, cc[0], cc[1], W / 2, D / 2, ang, G + DM.ceil, G + DM.ceil + 0.1, 'awPlasterWhite', { collide: false, mats: { py: 'awRoofFlat' } });
  // shelves in rows into the store, the checkouts by the door, wall shelves; lights
  const P = ctx.prop;
  const rot = -ang - Math.PI / 2; // a prop's +x along v
  for (const u of [5.2, 8.6, 12.0, 15.4]) {
    for (const v0 of [9, 20.5]) {
      const p = dmP(u, v0 + 5);
      P('storeShelf', p[0], AW_FLOOR, p[1], rot, { length: 9.5, seed: Math.round(u * 10 + v0) }, { collide: false });
      world.addOBB(p[0], p[1], 0.55, 4.8, -ang, AW_FLOOR, AW_FLOOR + 1.75, SURF.wood, 0, 'shelf');
    }
  }
  for (const v0 of [8, 18, 28]) {
    const p = dmP(W - 0.6, v0 + 4);
    P('storeShelf', p[0], AW_FLOOR, p[1], rot, { length: 8, wall: true, seed: v0 }, { collide: false });
    world.addOBB(p[0], p[1], 0.4, 4.1, -ang, AW_FLOOR, AW_FLOOR + 2.0, SURF.wood, 0, 'shelf');
  }
  for (const u of [10.5, 14.2]) {
    const p = dmP(u, 3.4);
    P('checkout', p[0], AW_FLOOR, p[1], -ang, { seed: Math.round(u) }, { collide: false });
    world.addOBB(p[0], p[1], 0.45, 1.3, -ang, AW_FLOOR, AW_FLOOR + 1.0, SURF.wood, 0, 'checkout');
  }
  // (room: lights inside only get one of the few real lights when you are in here too: world/lighting.js)
  const inStore = (p) => inTurned(p.x, p.z, DM_CENTER[0], DM_CENTER[1], DM.w / 2 + 1, DM.d / 2 + 1, DM.ang);
  for (const [u, v] of [[5, 6], [14.5, 6], [5, 18], [14.5, 18], [5, 29], [14.5, 29]]) {
    const p = dmP(u, v);
    lamps.push({ pos: V3(p[0], G + DM.ceil - 0.06, p[1]), level: 1, color: 0xeef4ff, intensity: 34, angle: 1.45, distance: 13, flicker: v > 20 && u < 6 ? 0.6 : 0, spot: true, ceil: G + DM.ceil, floorY: AW_FLOOR, room: inStore });
  }
  // the sliding glass doors: shut until round 10
  const dd = DM_DOOR[1] - DM_DOOR[0];
  const leaves = [0, 1].map((k) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(dd / 2, 2.4, 0.04), getMaterial('glass'));
    const p = dmP(DM_DOOR[0] + dd * (0.25 + 0.5 * k), 0.1);
    m.position.set(p[0], G + 1.2, p[1]);
    m.rotation.y = -ang;
    m.userData.base = p;
    dynamic.add(m);
    return m;
  });
  const dc = dmP((DM_DOOR[0] + DM_DOOR[1]) / 2, 0.1);
  const col = world.addOBB(dc[0], dc[1], dd / 2, 0.06, -ang, G, G + 2.45, SURF.glass, FLAG_NOBULLET, 'dmDoor');
  const st = { open: false, t: 0 };
  ctx.unlockables.dmDoors = {
    open(game) {
      if (st.open) return;
      st.open = true;
      col.pieces.forEach((p) => (p.enabled = false));
      game?.nav?.refreshRect(dc[0] - 3, dc[0] + 3, dc[1] - 3, dc[1] + 3);
      for (const e of ctx.entrances) if (e.requires === 'drugstore') e.enabled = true;
    },
  };
  ctx.updates.push((dt) => {
    if (!st.open || st.t >= 1) return;
    st.t = Math.min(1, st.t + dt * 0.7);
    const e = smooth(st.t);
    leaves.forEach((m, k) => {
      const s = (k ? 1 : -1) * e * dd * 0.45;
      m.position.set(m.userData.base[0] + DM.u[0] * s, G + 1.2, m.userData.base[1] + DM.u[1] * s);
    });
  });
  const inside = dmP((DM_DOOR[0] + DM_DOOR[1]) / 2, 1.4);
  ctx.entrances.push({ id: 'dmDoor', level: 1, x: inside[0], z: inside[1], requires: 'drugstore', enabled: false });
  const sp = dmP(12.3, 3.4);
  ctx.specialSpots.l96a1 = { pos: V3(sp[0], AW_FLOOR + 1.02, sp[1]), where: 'on a drugstore checkout', requires: 'drugstore' };
  ctx.specialSpots.m32 = { pos: V3(-19.4, G + 0.05, -33.9), where: 'by the gun garage' };
  for (let i = 0; i < 4; i++) {
    const a = [c0, c1, c2, c3][i], b = [c0, c1, c2, c3][(i + 1) % 4];
    ctx.radarSegments.push([a[0], a[1], b[0], b[1]]);
  }
  // bots' posts: in the store once it is open (facing the front), on its car park
  const front = Math.atan2(-DM.v[0], -DM.v[1]);
  for (const [u, v] of [[6, 4.5], [12.5, 8.5], [16.5, 15]]) {
    const p = dmP(u, v);
    ctx.defensePosts.push({ pos: V3(p[0], AW_FLOOR, p[1]), face: front, level: 1, requires: 'drugstore' });
  }
  for (const [x, z] of [[50, 0], [40.5, -13.5]]) ctx.defensePosts.push({ pos: V3(x, G, z), face: Math.PI * 0.75, level: 1 });
}
function tiles() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#e4e0d8';
  ctx.fillRect(0, 0, 128, 128);
  ctx.fillStyle = '#b8b3a9';
  ctx.fillRect(0, 0, 128, 2);
  ctx.fillRect(0, 0, 2, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
