// Props of the Appenweier map (world/appenweier.js) and furnish(): where the street furniture, the trees, the
// hedges, the fence, the parked cars and the corn go. Built with the prop kit (world/props.js registerProp).
// The cars carry no number plates.
import * as THREE from 'three';
import { registerProp, PropKit } from './props.js';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { getMaterial, registerMaterial } from './materials.js';
import { AW_GROUND as G, HALL, GARAGE } from './appenweierLayout.js';
import { signTexture } from './appenweierTextures.js';
import { inHall, inGarage, inDM, inPoly } from './appenweierGeo.js';

const { M, PI, TAU, HP, lerp, smoothPts } = PropKit;
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- vehicles
const tireProf = (R, rim, W) => [[rim * 0.98, -W / 2], [R * 0.93, -W / 2], [R, -W * 0.32], [R, W * 0.32], [R * 0.93, W / 2], [rim * 0.98, W / 2]];
function wheels(b, xs, zs, R, W, rimMat = 'awGalv') {
  const tire = tireProf(R, R * 0.62, W);
  for (const x of xs)
    for (const z of zs)
      b.grp([x, R, z], [0, 0, -Math.sign(x) * HP, 'XZY'], () => {
        b.lathe('rubber', tire, 18);
        b.lathe(rimMat, [[0, W / 2 - 0.01], [R * 0.6, W / 2 - 0.02], [R * 0.62, W / 2 - 0.05], [R * 0.62, -W / 2 + 0.03]], 14);
      });
}
/** a car body: sill-to-beltline box, the glasshouse (tapered), lights; len along z, the nose at +z */
function carBody(b, o) {
  const { w, len, h, belt, paint, glass = 'awGlass', noseZ = len / 2, roofLen, roofShift = 0 } = o;
  const clear = 0.18;
  b.box(paint, w, belt - clear, len, [0, clear + (belt - clear) / 2, 0], null, { c: 0.06 });
  // the glasshouse: pillars as a slightly smaller box, glass on its sides
  const gh = h - belt, rl = roofLen ?? len * 0.5;
  b.box(glass, w - 0.12, gh * 0.92, rl, [0, belt + gh * 0.46, roofShift], null, { c: 0.08 });
  b.box(paint, w - 0.2, 0.06, rl - 0.1, [0, h - 0.03, roofShift], null, { c: 0.02 });
  // bonnet slope and the tail
  b.box(paint, w - 0.06, 0.12, len * 0.26, [0, belt + 0.02, noseZ - len * 0.14], [-0.12, 0, 0], { c: 0.03 });
  for (const s of [-1, 1]) {
    b.box(M('awGlassLit', { color: 0xe8e8e0 }), 0.34, 0.1, 0.05, [s * (w / 2 - 0.26), belt - 0.12, noseZ + 0.005], null, { c: 0.01 }); // headlights
    b.box(M('awRedDoor', { color: 0x9a1510 }), 0.3, 0.12, 0.05, [s * (w / 2 - 0.2), belt - 0.1, -len / 2 - 0.005], null, { c: 0.01 }); // tail lights
  }
  b.box('awAnthracite', w - 0.1, 0.16, 0.12, [0, clear + 0.12, noseZ - 0.02], null, { c: 0.02 }); // bumpers
  b.box('awAnthracite', w - 0.1, 0.16, 0.12, [0, clear + 0.12, -len / 2 + 0.02], null, { c: 0.02 });
  b.col([-w / 2, 0, -len / 2], [w / 2, h, len / 2]);
}
registerProp('awCar', (b, o) => {
  const kind = o.kind ?? 'hatch';
  const paint = M('awSteel', { color: o.color ?? 0x55595e });
  if (kind === 'van') {
    // the red camper van (a panel van with a high roof)
    const w = 2.05, len = 5.99, h = 2.62;
    b.box(paint, w, 1.9, len - 0.9, [0, 0.2 + 0.95, -0.45], null, { c: 0.08 });
    b.box(paint, w, 1.0, 0.95, [0, 0.2 + 0.5, len / 2 - 0.47], null, { c: 0.12 });
    b.box('awGlass', w - 0.1, 0.62, 0.7, [0, 1.52, len / 2 - 1.05], [-0.35, 0, 0], { c: 0.04 });
    b.box(M('awSteel', { color: 0xe8e4de }), w - 0.1, 0.45, len - 1.6, [0, 2.36, -0.7], null, { c: 0.1 }); // the high roof
    for (const s of [-1, 1]) b.box('awGlass', 0.03, 0.42, 1.1, [s * (w / 2 + 0.005), 1.62, -0.9], null, { c: 0 });
    b.box('awGlass', w - 0.4, 0.5, 0.03, [0, 1.6, -len / 2 - 0.005], null, { c: 0 });
    wheels(b, [-0.86, 0.86], [1.85, -1.95], 0.36, 0.22);
    b.col([-w / 2, 0, -len / 2], [w / 2, h, len / 2]);
    return;
  }
  const spec = { estate: { w: 1.8, len: 4.84, h: 1.46, belt: 0.92, roofLen: 2.9, roofShift: -0.5 }, hatch: { w: 1.8, len: 4.1, h: 1.5, belt: 0.93, roofLen: 2.1, roofShift: -0.3 }, suv: { w: 1.85, len: 4.5, h: 1.64, belt: 1.02, roofLen: 2.4, roofShift: -0.35 } }[kind];
  carBody(b, { ...spec, paint });
  wheels(b, [-spec.w / 2 + 0.12, spec.w / 2 - 0.12], [spec.len / 2 - 0.9, -spec.len / 2 + 0.85], kind === 'suv' ? 0.36 : 0.33, 0.22);
});

// the fire engine (an HLF: red, white band, roller shutters, a ladder on the roof, blue lights)
registerProp('fireEngine', (b) => {
  const red = M('awRedDoor', { color: 0xb3161a }), w = 2.5, len = 8.4;
  const band = M('awPaint', { color: 0xf2f2ee });
  // the cab at the front (-z faces the doors: the nose is at -z)
  const cz = -len / 2 + 1.15;
  b.box(red, w, 2.2, 2.3, [0, 0.55 + 1.1, cz], null, { c: 0.08 });
  b.box('awGlass', w - 0.1, 0.9, 0.05, [0, 2.1, -len / 2 - 0.005], [0.08, 0, 0], { c: 0 });
  for (const s of [-1, 1]) b.box('awGlass', 0.05, 0.75, 1.5, [s * (w / 2 + 0.005), 2.05, cz + 0.2], null, { c: 0 });
  // the body with its shutters (alu) and the white band
  b.box(red, w, 2.6, len - 2.4, [0, 0.55 + 1.3, cz + 1.15 + (len - 2.4) / 2], null, { c: 0.06 });
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) b.box(M('awShutter', { color: 0xd8dadc }), 0.04, 1.8, 1.7, [s * (w / 2 + 0.01), 1.55, cz + 1.9 + k * 1.95], null, { c: 0 });
    b.box(band, 0.03, 0.14, len - 0.2, [s * (w / 2 + 0.02), 0.85, 0], null, { c: 0 });
  }
  b.box(band, w - 0.2, 0.14, 0.03, [0, 0.85, -len / 2 - 0.02], null, { c: 0 });
  // the blue lights on the cab, the ladder on the roof
  for (const s of [-1, 1]) b.box(M('awGlassLit', { color: 0x2040ff, emissive: 0x1030ff, emissiveIntensity: 2 }), 0.35, 0.12, 0.25, [s * 0.75, 2.84, cz - 0.6], null, { c: 0.02 });
  for (const s of [-1, 1]) b.box('awGalv', 0.06, 0.08, len - 3, [s * 0.3, 3.22, 1.0], null, { c: 0 });
  for (let z = -2.2; z < 4.3; z += 0.3) b.box('awGalv', 0.6, 0.04, 0.04, [0, 3.22, z], null, { c: 0 });
  // FEUERWEHR over the windscreen
  const t = signTexture([{ text: 'FEUERWEHR', font: 'bold 64px Arial', color: '#ffffff' }], { w: 512, h: 96, bg: '#b3161a' });
  const mat = registerMaterial('awFireSign', new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }));
  void mat;
  const g = new THREE.PlaneGeometry(1.8, 0.33);
  b.add('awFireSign', g, [0, 2.7, -len / 2 - 0.012], [0, PI, 0], { uv: 'keep' });
  wheels(b, [-1.02, 1.02], [cz + 0.1, 1.9, 3.3], 0.52, 0.34, 'awAnthracite');
  b.col([-w / 2, 0, -len / 2], [w / 2, 3.3, len / 2]);
});
registerProp('crewVan', (b) => {
  const red = M('awRedDoor', { color: 0xb3161a }), w = 2.04, len = 5.9;
  b.box(red, w, 1.95, len - 0.95, [0, 0.2 + 0.98, -0.47 + 0.47 * 2 - 0.47], null, { c: 0.08 });
  b.box(red, w, 1.0, 0.95, [0, 0.7, -len / 2 + 0.47], null, { c: 0.12 });
  b.box('awGlass', w - 0.1, 0.65, 0.65, [0, 1.5, -len / 2 + 1.0], [0.35, 0, 0], { c: 0.03 });
  for (const s of [-1, 1]) b.box(M('awPaint', { color: 0xf2f2ee }), 0.03, 0.13, len - 0.6, [s * (w / 2 + 0.01), 0.9, 0], null, { c: 0 });
  b.box(M('awGlassLit', { color: 0x2040ff, emissive: 0x1030ff, emissiveIntensity: 2 }), 1.2, 0.1, 0.25, [0, 2.2, -len / 2 + 1.5], null, { c: 0.02 });
  wheels(b, [-0.86, 0.86], [-len / 2 + 1.0, len / 2 - 1.1], 0.35, 0.22);
  b.col([-w / 2, 0, -len / 2], [w / 2, 2.2, len / 2]);
});

// ---------------------------------------------------------------- the fire station's kit
registerProp('turnoutLocker', (b, o) => {
  const r = b.r;
  const frame = M('awSteel', { color: 0xb8bcc0 });
  b.box(frame, 0.95, 0.04, 0.5, [0, 1.9, 0], null, { c: 0 });
  b.box(frame, 0.95, 0.04, 0.5, [0, 0.35, 0], null, { c: 0 });
  b.box(frame, 0.95, 1.9, 0.03, [0, 0.95, -0.24], null, { c: 0 });
  for (const s of [-1, 1]) b.box(frame, 0.03, 1.92, 0.5, [s * 0.46, 0.96, 0], null, { c: 0 });
  // the jacket (navy, yellow-silver reflective bands), the trousers under it, the helmet on top, boots
  const navy = M('fabric', { color: 0x1d2433 }), refl = M('awPaint', { color: 0xd8d27a });
  b.box(navy, 0.62, 0.8, 0.26, [0, 1.35, 0.02], [0, r.jit(0.1), 0], { c: 0.05 });
  for (const y of [1.08, 1.5]) b.box(refl, 0.64, 0.05, 0.27, [0, y, 0.02], null, { c: 0 });
  b.box(navy, 0.5, 0.55, 0.2, [0, 0.66, 0.02], null, { c: 0.04 });
  b.sph(M('awPaint', { color: o.seed % 3 ? 0xe8e4d8 : 0xd8b21a }), 0.17, [0, 2.07, 0.02], null, { scl: [1, 0.85, 1.15] });
  for (const s of [-1, 1]) b.box('rubber', 0.12, 0.3, 0.3, [s * 0.12, 0.15, 0.05], null, { c: 0.03 });
  b.col([-0.48, 0, -0.26], [0.48, 1.95, 0.26]);
});
registerProp('hoseRack', (b) => {
  const frame = M('awSteel', { color: 0x9aa0a4 });
  for (const s of [-1, 1]) b.box(frame, 0.05, 1.8, 0.4, [s * 0.9, 0.9, 0], null, { c: 0 });
  for (const y of [0.35, 0.95, 1.55]) {
    b.box(frame, 1.85, 0.04, 0.4, [0, y - 0.18, 0], null, { c: 0 });
    for (let k = 0; k < 4; k++) b.cyl(M('awPaint', { color: 0xecebe4 }), 0.2, 0.2, 0.08, 18, [-0.66 + k * 0.44, y + 0.05, 0], [HP, 0, 0]);
  }
  b.col([-0.95, 0, -0.22], [0.95, 1.85, 0.22]);
});
registerProp('banner', (b, o) => {
  const lines = o.text ?? ['WERDE AUCH DU', 'TEIL DER FEUERWEHR!'];
  const t = signTexture(
    [
      { text: lines[0], font: 'bold 70px Arial', color: '#ffe066', y: 90 },
      { text: lines[1], font: 'bold 64px Arial', color: '#ffffff', y: 190 },
      { text: '112 · FREIWILLIGE FEUERWEHR', font: 'bold 30px Arial', color: '#ffb46b', y: 262 },
    ],
    { w: 768, h: 300, bg: '#3a2410' }
  );
  registerMaterial('awBanner', new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
  b.add('awBanner', new THREE.PlaneGeometry(2.5, 1.0), [0, 1.2, 0], null, { uv: 'keep' });
  const frame = M('awGalv');
  for (const s of [-1, 1]) {
    b.cyl(frame, 0.02, 0.02, 1.75, 6, [s * 1.27, 0.87, 0]);
    b.box('awConcrete', 0.3, 0.12, 0.5, [s * 1.27, 0.06, 0], null, { c: 0.02 });
  }
  b.box(frame, 2.56, 0.03, 0.03, [0, 1.72, 0], null, { c: 0 });
  b.box(frame, 2.56, 0.03, 0.03, [0, 0.69, 0], null, { c: 0 });
  b.col([-1.3, 0, -0.25], [1.3, 1.75, 0.25]);
});
registerProp('boulder', (b) => {
  const r = b.r;
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = V3(p.getX(i), p.getY(i), p.getZ(i));
    const k = 1 + PropKit.fbm(v.x * 1.3 + 3, v.y * 1.3, v.z * 1.3) * 0.25;
    p.setXYZ(i, v.x * 0.95 * k, Math.max(-0.2, v.y) * 0.62 * k, v.z * 0.75 * k);
  }
  g.computeVertexNormals();
  b.add(M('awConcrete', { color: 0x8c8a84 }), g, [0, 0.35, 0], [0, r.range(0, TAU), 0]);
  b.col([-0.9, 0, -0.7], [0.9, 0.95, 0.7]);
});

// ---------------------------------------------------------------- the drugstore's shelves and checkouts
const PRODUCT = [0xd7263d, 0xf4d35e, 0x3a86ff, 0xffffff, 0x2ec4b6, 0xff9f1c, 0xe0aaff, 0x8ac926, 0xf15bb5, 0x1b998b];
registerProp('storeShelf', (b, o) => {
  const r = b.r, L = o.length ?? 8, depth = o.wall ? 0.5 : 1.0, H = o.wall ? 1.95 : 1.6;
  const frame = M('awSteel', { color: 0xe1e2e0 });
  b.box(frame, L, H, 0.05, [0, H / 2, 0], null, { c: 0 }); // the back panel
  for (let x = -L / 2; x <= L / 2 + 1e-3; x += L / Math.round(L / 1.25)) b.box(frame, 0.04, H, depth, [x, H / 2, 0], null, { c: 0 });
  const sides = o.wall ? [1] : [-1, 1];
  for (const s of sides) {
    for (let k = 0; k < 4; k++) {
      const y = 0.12 + k * (H - 0.25) / 3.6;
      b.box(frame, L, 0.025, depth / 2 - 0.03, [0, y, (s * depth) / 4], null, { c: 0 });
      // the goods: little boxes and bottles in a colour per run
      let x = -L / 2 + 0.08;
      while (x < L / 2 - 0.12) {
        const run = r.range(0.4, 1.1), col = r.pick(PRODUCT), bottle = r.chance(0.35);
        const mat = M('awPaint', { color: col });
        const hh = bottle ? r.range(0.16, 0.26) : r.range(0.12, 0.3);
        for (let q = x; q < Math.min(L / 2 - 0.1, x + run); q += bottle ? 0.09 : 0.14) {
          if (bottle) b.cyl(mat, 0.035, 0.04, hh, 8, [q, y + hh / 2 + 0.013, s * (depth / 4)], null, { c: 0 });
          else b.box(mat, 0.11, hh, depth / 2 - 0.12, [q, y + hh / 2 + 0.013, s * (depth / 4)], null, { c: 0.004 });
        }
        x += run + 0.05;
      }
    }
  }
});
registerProp('checkout', (b) => {
  const body = M('awSteel', { color: 0xd9dadd });
  b.box(body, 0.85, 0.9, 2.5, [0, 0.45, 0], null, { c: 0.02 });
  b.box('rubber', 0.55, 0.03, 1.5, [0, 0.915, 0.35], null, { c: 0 }); // the belt
  b.box('awAnthracite', 0.35, 0.3, 0.3, [0, 1.05, -0.9], null, { c: 0.02 }); // the till
  b.box(M('awGlassLit', { color: 0x223344, emissive: 0x66aaff, emissiveIntensity: 0.6 }), 0.3, 0.2, 0.02, [0, 1.3, -0.95], [0.3, 0, 0], { c: 0 });
});

// ---------------------------------------------------------------- street furniture
registerProp('streetLamp', (b) => {
  const pole = M('awGalv', { color: 0x9aa2a8 });
  b.cyl(pole, 0.06, 0.1, 8.2, 10, [0, 4.1, 0]);
  b.cyl(pole, 0.05, 0.05, 1.1, 8, [0, 8.1, 0.45], [HP, 0, 0]);
  b.box(M('awAnthracite'), 0.3, 0.1, 0.7, [0, 8.1, 1.1], null, { c: 0.03 });
  b.box(M('awGlassLit', { color: 0xfff4dc, emissive: 0xfff0d0, emissiveIntensity: 3 }), 0.24, 0.02, 0.56, [0, 8.04, 1.1], null, { c: 0 });
  b.anchor('bulb', V3(0, 7.95, 1.1));
  b.col([-0.12, 0, -0.12], [0.12, 8, 0.12]);
});
registerProp('trafficLight', (b, o) => {
  const pole = M('awGalv', { color: 0x9aa2a8 });
  b.cyl(pole, 0.06, 0.07, 3.6, 10, [0, 1.8, 0]);
  const head = (x, y, z) => {
    b.box('awAnthracite', 0.3, 0.9, 0.2, [x, y, z], null, { c: 0.03 });
    [[0.3, 0x3a0a08], [0, 0x3a2a08], [-0.3, 0x0a3a14]].forEach(([dy, c], i) => {
      const lit = (o.state ?? 2) === i;
      b.cyl(M('awGlassLit', { color: lit ? [0xff3020, 0xffb020, 0x30ff70][i] : c, emissive: lit ? [0xff2010, 0xff9010, 0x20ff60][i] : 0x000000, emissiveIntensity: lit ? 2.5 : 0 }), 0.1, 0.1, 0.03, 12, [x, y + dy, z + 0.11], [HP, 0, 0]);
    });
  };
  if (o.arm) {
    b.cyl(pole, 0.05, 0.05, o.arm, 8, [0, 5.2, o.arm / 2], [HP, 0, 0]);
    b.cyl(pole, 0.06, 0.06, 1.8, 8, [0, 4.4, 0]);
    head(0, 4.6, o.arm);
  }
  head(0, 2.9, 0.1);
  b.col([-0.1, 0, -0.1], [0.1, 3.6, 0.1]);
});
registerProp('warningSign', (b) => {
  const t = signTexture([{ text: '!', font: 'bold 150px Arial', color: '#111111', y: 150 }], { w: 256, h: 220, bg: null });
  const tri = document.createElement('canvas');
  tri.width = 256;
  tri.height = 224;
  const g = tri.getContext('2d');
  g.fillStyle = '#d0141a';
  g.beginPath();
  g.moveTo(128, 4);
  g.lineTo(252, 220);
  g.lineTo(4, 220);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(128, 40);
  g.lineTo(220, 202);
  g.lineTo(36, 202);
  g.fill();
  g.drawImage(t.image, 0, 0);
  const tt = new THREE.CanvasTexture(tri);
  tt.colorSpace = THREE.SRGBColorSpace;
  registerMaterial('awWarnSign', new THREE.MeshStandardMaterial({ map: tt, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide }));
  const plate = signTexture(['bei Nässe', 'Überschwemmungs-', 'gefahr'], { w: 256, h: 150, bg: '#ffffff', font: 'bold 34px Arial', border: '#111111' });
  registerMaterial('awWarnPlate', new THREE.MeshStandardMaterial({ map: plate, side: THREE.DoubleSide }));
  b.cyl(M('awGalv'), 0.035, 0.035, 2.9, 8, [0, 1.45, 0]);
  b.add('awWarnSign', new THREE.PlaneGeometry(0.9, 0.79), [0, 2.55, 0.04], null, { uv: 'keep' });
  b.add('awWarnPlate', new THREE.PlaneGeometry(0.6, 0.35), [0, 1.9, 0.04], null, { uv: 'keep' });
  b.col([-0.05, 0, -0.05], [0.05, 2.9, 0.05]);
});

// ---------------------------------------------------------------- trees and bushes (leaf cards on branches)
/** a deciduous crown: trunk, a few limbs, leaf clusters (crossed cards) all round the crown's ellipsoid */
function leafyTree(b, o) {
  const r = b.r;
  const H = o.h, trunkH = o.trunk, R = o.r;
  b.tube('bark', smoothPts([[0, -0.2, 0], [r.jit(0.15), trunkH * 0.5, r.jit(0.15)], [r.jit(0.3), trunkH, r.jit(0.3)]], 6), (i, n) => lerp(o.girth, o.girth * 0.7, i / (n - 1)), 9);
  const cy = trunkH + (H - trunkH) * 0.5, ry = (H - trunkH) * 0.55;
  for (let k = 0; k < o.limbs; k++) {
    const a = (k / o.limbs) * TAU + r.jit(0.4);
    const d = V3(Math.cos(a), r.range(0.35, 0.8), Math.sin(a)).normalize();
    const p0 = V3(0, trunkH * r.range(0.8, 1.0), 0);
    const p1 = p0.clone().addScaledVector(d, R * r.range(0.55, 0.85));
    b.tube('bark', [p0, p0.clone().lerp(p1, 0.5).add(V3(0, 0.3, 0)), p1], (i, n) => lerp(o.girth * 0.55, 0.03, i / (n - 1)), 6);
  }
  const card = (p, s) => {
    for (let q = 0; q < 2; q++) {
      const g = new THREE.PlaneGeometry(s, s);
      b.add(o.leaf ?? 'awLeaves', g, [p.x, p.y, p.z], [r.range(-0.5, 0.5), (q * PI) / 2 + r.range(0, PI), r.range(-0.4, 0.4)], { uv: 'keep' });
    }
  };
  for (let k = 0; k < o.clusters; k++) {
    // points biased to the crown's surface
    const u = r.range(0, TAU), v = Math.acos(r.range(-0.85, 1)), rr = Math.pow(r.range(0.45, 1), 0.5);
    const p = V3(Math.sin(v) * Math.cos(u) * R * rr, cy + Math.cos(v) * ry * rr, Math.sin(v) * Math.sin(u) * R * rr);
    card(p, o.card * r.range(0.8, 1.2));
  }
  b.col([-o.girth - 0.05, 0, -o.girth - 0.05], [o.girth + 0.05, trunkH, o.girth + 0.05]);
}
registerProp('linden', (b, o) => leafyTree(b, { h: o.h ?? 13, trunk: 3.2, r: o.r ?? 4.2, girth: 0.3, limbs: 6, clusters: 150, card: 2.2 }));
registerProp('walnut', (b) => leafyTree(b, { h: 11, trunk: 2.4, r: 6.2, girth: 0.38, limbs: 7, clusters: 190, card: 2.4 }));
registerProp('hazel', (b) => {
  const r = b.r;
  for (let k = 0; k < 9; k++) {
    const a = r.range(0, TAU), lean = r.range(0.1, 0.35);
    const top = V3(Math.cos(a) * lean * 3, r.range(2.6, 4.2), Math.sin(a) * lean * 3);
    b.tube('bark', [V3(Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15), top.clone().multiplyScalar(0.5), top], [0.035, 0.025, 0.01], 5);
    for (let q = 0; q < 5; q++) {
      const p = top.clone().multiplyScalar(r.range(0.45, 1)).add(V3(r.jit(0.6), r.jit(0.4), r.jit(0.6)));
      b.add('awLeaves', new THREE.PlaneGeometry(1.3, 1.3), [p.x, p.y, p.z], [r.jit(0.6), r.range(0, PI), r.jit(0.6)], { uv: 'keep' });
    }
  }
});
registerProp('spruce', (b, o) => {
  const r = b.r, H = o.h ?? 16;
  b.cyl('bark', 0.05, 0.3, H, 9, [0, H / 2, 0]);
  for (let y = 1.5; y < H - 0.3; y += 0.45) {
    const R = (1 - y / H) * H * 0.26 + 0.25;
    const n = Math.max(4, Math.round(R * 4));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + r.jit(0.3) + y;
      const g = new THREE.PlaneGeometry(R, R * 0.6);
      g.translate(R / 2, 0, 0);
      b.add('foliage', g, [0, y, 0], [r.jit(0.2), -a, -0.35], { uv: 'keep' });
    }
  }
  b.col([-0.35, 0, -0.35], [0.35, 3, 0.35]);
});
/** a clipped hedge: a box of glossy leaves (laurel) or the dark thuja, length along x */
registerProp('hedge', (b, o) => {
  const L = o.length ?? 4, H = o.height ?? 2.2, D = o.depth ?? 1.2;
  const mat = o.kind === 'thuja' ? M('awLaurel', { color: 0x5d7a55 }) : 'awLaurel';
  b.soft(mat, L, H, D, 0.35, [Math.max(2, Math.round(L)), 3, 2], [0, H / 2, 0], null, { deform: (v) => v.multiplyScalar(1 + (PropKit.vnoise(v.x * 1.7, v.y * 1.7, v.z * 1.7) * 0.06)) });
  b.col([-L / 2, 0, -D / 2], [L / 2, H, D / 2]);
});

// ---------------------------------------------------------------- the fence: double rods with privacy strips
registerProp('meshFence', (b, o) => {
  const L = o.length ?? 2.5, H = 1.63;
  const g = new THREE.PlaneGeometry(L, H);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (L / 2.5));
  b.add('awFence', g, [0, H / 2 + 0.04, 0], null, { uv: 'keep' });
  for (const x of [-L / 2, L / 2]) b.box(M('awAnthracite'), 0.06, H + 0.12, 0.06, [x, (H + 0.12) / 2, 0], null, { c: 0.005 });
  b.col([-L / 2, 0, -0.06], [L / 2, H, 0.06]);
});

// ---------------------------------------------------------------- the corn (instanced: thousands of stalks)
function cornField(ctx, poly) {
  const { rnd } = ctx;
  const mat = getMaterial('awCorn');
  const g = new THREE.BufferGeometry();
  // one clump: three plants on crossed cards
  const pos = [], uv = [], nor = [];
  const card = (x, z, a, h) => {
    const c = Math.cos(a) * 0.5, s = Math.sin(a) * 0.5;
    const P = [[x - c, 0, z - s], [x + c, 0, z + s], [x + c, h, z + s], [x - c, h, z - s]];
    const U = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...P[i]);
      uv.push(...U[i]);
      nor.push(-s * 2, 0.3, c * 2);
    }
  };
  for (let k = 0; k < 3; k++) {
    const x = (k - 1) * 0.28, z = (k % 2) * 0.08;
    card(x, z, 0.4 + k * 1.1, 2.35 + k * 0.15);
    card(x, z, 0.4 + k * 1.1 + HP, 2.3 + k * 0.1);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const spots = [];
  for (let z = Math.min(...zs) + 0.5; z < Math.max(...zs); z += 0.78) {
    for (let x = Math.min(...xs) + 0.4; x < Math.max(...xs); x += 0.95) {
      const px = x + (rnd() - 0.5) * 0.3, pz = z + (rnd() - 0.5) * 0.12;
      if (!inPoly(px, pz, poly)) continue;
      spots.push([px, pz]);
    }
  }
  const im = new THREE.InstancedMesh(g, mat, spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  spots.forEach(([x, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 0.5 - 0.25 + (rnd() < 0.5 ? 0 : PI));
    const k = 1.05 + rnd() * 0.25; // 2.5-3 m, ready for the harvest
    s.set(1, k, 1);
    m.compose(new THREE.Vector3(x, G, z), q, s);
    im.setMatrixAt(i, m);
  });
  im.castShadow = false; // (thousands of cards in every shadow map: it takes the light, it doesn't cast)
  im.receiveShadow = true;
  im.name = 'cornField';
  im.userData.noBatch = true;
  im.computeBoundingSphere();
  ctx.B.staticGroup.add(im);
}

// ---------------------------------------------------------------- where it all goes
export function furnish(ctx, { corn }) {
  const { prop, lamps, world, data, rnd } = ctx;
  const place = (type, x, z, rot = 0, opts = {}, po = {}) => prop(type, x, G, z, rot, opts, po);

  // street lamps along Sander Straße (the footway side), round the forecourt and the store's car park
  const lampAt = (x, z, rot) => {
    const p = place('streetLamp', x, z, rot, { seed: 5 });
    const b = p?.anchors?.bulb ? p.anchors.bulb.clone().applyMatrix4(p.object.matrixWorld) : new THREE.Vector3(x, G + 7.95, z);
    lamps.push({ pos: b, level: 1, color: 0xffe2b8, intensity: 900, angle: 0.95, distance: 30, flicker: 0, spot: true, shadow: false, floorY: G });
  };
  for (const x of [-88, -60, -32, -4, 24, 52]) lampAt(x, 12.2, 0);
  for (const [x, z, r] of [[-62, 33, PI / 2], [-30.6, 55, -PI / 2], [44, 0, PI], [58, -18, PI], [30, -18, 0.6], [74, 20, PI], [94, 24, PI]]) lampAt(x, z, r);
  // the fire station's traffic lights at its exit, the warning sign
  place('trafficLight', -32.5, 24.6, 0, { arm: 3.2, state: 0 });
  place('trafficLight', -27.8, 13.4, PI, { state: 2 });
  place('warningSign', -24.5, 13.8, PI + 0.3);

  // Sanderstraße 13's fence along the path and the track, the gate gap by the walnut, the hedges
  const fence = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.round(L / 2.5));
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
      const p = place('meshFence', x, z, -ang, { length: L / n }, { collide: false });
      void p;
      world.addOBB(x, z, L / n / 2, 0.06, -ang, G, G + 1.65, SURF.metal, FLAG_NOBULLET, 'fence');
    }
  };
  fence([-46.5, 1.9], [-25.5, 4.6]);
  fence([-20.2, 5.4], [-6.5, 4.0]);
  fence([-6.5, 4.0], [8.0, -5.8]);
  // hedges: turned boxes of leaves (they hide you, bullets go through)
  const hedge = (x, z, rot, o) => {
    place('hedge', x, z, rot, o, { collide: false });
    world.addOBB(x, z, o.length / 2, o.depth / 2, rot, G, G + o.height, SURF.wood, FLAG_NOBULLET, 'hedge');
  };
  hedge(-42.2, 0.9, -0.13, { length: 8, height: 2.6, depth: 1.4 });
  hedge(-12.9, -1.8, -PI / 2 + 0.08, { length: 10.4, height: 2.4, depth: 1.1, kind: 'thuja' });
  hedge(-7.5, -40, 0.08, { length: 5, height: 3.2, depth: 1.6, kind: 'thuja' });

  // trees: the walnut by the gate, the spruce past the garage, hazel in the garden; the limes along the road
  // and round the fire station; OpenStreetMap's (the store car parks)
  place('walnut', -25.8, 1.2, 0.3);
  place('spruce', -9.2, -44.6, 0, { h: 17 });
  place('spruce', 9.5, -14, 0, { h: 14 });
  for (const [x, z] of [[-4.5, -7], [0.5, -2.5], [3.8, -11], [-8, -15.5]]) place('hazel', x, z, rnd() * TAU);
  for (const x of [-21, -7.5, 6, 19.5]) place('linden', x, 27.6, rnd() * TAU, { h: 12 + rnd() * 2 });
  for (const [x, z] of [[-63, 29.5], [-66, 40], [-27, 36], [-27.5, 50], [-27.8, 64], [-86, 44], [-72.5, 76], [-90, 60]]) place('linden', x, z, rnd() * TAU, { h: 11 + rnd() * 4, r: 3.6 + rnd() });
  for (const [x, z] of data.trees) {
    if (x < -95 || x > 110 || z < -75 || z > 95) continue;
    if (inHall(x, z, 2) || inDM(x, z, 2) || inGarage(x, z, 2)) continue;
    place('linden', x, z, rnd() * TAU, { h: 9 + rnd() * 3, r: 3 + rnd() });
  }

  // parked cars (no plates): the estate and the camper in the lane by 13c, the grey hatchback before the gable,
  // one at the fire station, a few at the store
  place('awCar', -33.5, -12.1, HP + 0.08, { kind: 'estate', color: 0x14161c });
  place('awCar', -40.2, -12.7, HP + 0.08, { kind: 'van', color: 0xa4181c });
  place('awCar', -19.6, -21.8, -0.05, { kind: 'hatch', color: 0x5f6368 });
  place('awCar', -36, 38.5, HP, { kind: 'suv', color: 0x1f3f8f });
  for (const [x, z, r, kind, c] of [[48, 2, 0.3, 'hatch', 0xc9c9c4], [52.5, 4, 0.3, 'estate', 0x2c2f33], [41, -12, 0.3 + PI, 'suv', 0x7b1e1e], [66, 16, PI / 2, 'hatch', 0x355c7d]]) place('awCar', x, z, r, { kind, color: c });

  // the corn
  cornField(ctx, ctx.cornPoly ?? corn);
}
