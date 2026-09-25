// The lab behind the basement's south wall (the basement unlocks at round 10). Basement side: a vault
// door in a hazard-striped steel frame (hinges, locking wheel, bolts, keypad with a red LED) and a
// two-pane armored window; both block the player, and bullets chip the glass without breaking it.
// Behind the glass, at basement floor level, a gallery with Nadja's lab counter (actors/labTech.js);
// past its railing the hall drops to y -6 and runs under the front yard: vats, a specimen tank,
// benches, fume hoods, freezers, shelving.
//
// Nothing in the lab is walkable: no colliders inside. The static interior is merged per material with
// light baked into a vertex attribute (virtual ceiling panels, see bakeGeometry()) that the materials
// add as emission; one pooled lamp spot (lighting.js, `fx: false`, aimed away from the glass) adds real
// light and shadows at the counter. The interior is only drawn and animated while the camera is down in
// the basement (update()).
//
// Layout (m): basement wall z 3.85..4.15 · window x -6.6..-2.6, y -2.35..-0.85 · door x -1.4..0.1
//   gallery x -11.9..2.3, z 4.15..6.6, floor -3.2 (under the living room)
//   hall x -11.9..2.3, z 6.6..19, floor -6.0 (under the front yard)
//   one ceiling over both at -0.85 (below -0.8, where the fog shader's underground exemption starts).
//   The yard's mud slab (-1.5..-0.5) gets a hole over the lab (its faces would show through the glass);
//   a thinner mud cap (-0.8..-0.5) closes the yard again with the same UVs, collider and shade.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF, FLAG_NAVIGNORE } from './collision.js';
import { hash3 } from './levelBuilder.js';

export const LAB = {
  window: { x0: -6.6, x1: -2.6, y0: -2.35, y1: -0.85 },
  door: { x0: -1.4, x1: 0.1, y0: -3.2, y1: -0.95 },
  rect: [-12.5, 3.8, 2.9, 19.6], // xz; keep in sync with installFogShader's labRect default
  // hole in the yard's mud slab (level.js): continues the basement's hole to past the lab's far wall.
  // The far edge 19.73 is picked so the slab row that now starts there keeps (within 0.1 %) the per-box
  // shade of the row it replaces (LevelBuilder hash3), so the yard shows no new seam.
  mudHole: [-12, 2.4, 4, 19.73],
};
/** openings of the basement's south wall (B.wall format) */
export const LAB_OPENINGS = [
  { a: LAB.window.x0, b: LAB.window.x1, y0: LAB.window.y0, y1: LAB.window.y1 },
  { a: LAB.door.x0, b: LAB.door.x1, y0: LAB.door.y0, y1: LAB.door.y1 },
];

const FB = -3.2; // basement + gallery floor
const WZ = 4.15; // lab face of the basement wall
const BZ = 3.85; // basement face
const GZ = 6.6; // gallery edge / railing
const HC = -0.85; // ceiling (gallery and hall)
const GC = HC;
const HF = -6.0; // hall floor
const HZ = 19.0; // hall far wall
const X0 = -11.9, X1 = 2.3; // side walls
const T = FB + 0.92; // Nadja's counter top
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- canvas textures
function canvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function texOf(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function speckle(g, w, h, rnd, n, cols, size = 2) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = cols[Math.floor(rnd() * cols.length)];
    g.fillRect(rnd() * w, rnd() * h, 1 + rnd() * size, 1 + rnd() * size);
  }
}

/** white wall panels 1.2 m wide, 2.4 m tall (512 px = 2.4 m) */
function panelTex() {
  const rnd = mulberry(11);
  return texOf(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#dde2e5';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rnd, 2500, ['rgba(0,0,0,0.025)', 'rgba(255,255,255,0.05)'], 3);
    for (const x of [0, 256]) {
      g.fillStyle = '#9aa2a8';
      g.fillRect(x, 0, 2, h);
      g.fillStyle = '#f4f6f7';
      g.fillRect(x + 2, 0, 1, h);
    }
    g.fillStyle = '#9aa2a8';
    g.fillRect(0, 0, w, 2);
    g.fillStyle = '#f4f6f7';
    g.fillRect(0, 2, w, 1);
    g.fillStyle = '#8a9298';
    for (const x of [14, 242, 270, 498]) for (const y of [14, 250, 498]) g.fillRect(x - 1.5, y - 1.5, 3, 3);
  }), true);
}
/** grey epoxy floor, faint 1 m seams (512 px = 2 m) */
function floorTex() {
  const rnd = mulberry(12);
  return texOf(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#8b9296';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rnd, 9000, ['rgba(255,255,255,0.10)', 'rgba(0,0,0,0.10)', 'rgba(40,50,60,0.12)'], 1.5);
    for (let i = 0; i < 40; i++) {
      g.strokeStyle = `rgba(0,0,0,${0.02 + rnd() * 0.03})`;
      g.lineWidth = 1 + rnd() * 3;
      g.beginPath();
      const x = rnd() * w, y = rnd() * h;
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 80, y + (rnd() - 0.5) * 30);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,46,50,0.35)';
    for (const p of [0, 256]) {
      g.fillRect(p, 0, 1, h);
      g.fillRect(0, p, w, 1);
    }
  }), true);
}
/** 0.6 m ceiling tiles in a T-bar grid (512 px = 2.4 m) */
function ceilTex() {
  const rnd = mulberry(13);
  return texOf(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#e7eaeb';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rnd, 5000, ['rgba(0,0,0,0.06)'], 1);
    g.fillStyle = '#b3b9bd';
    for (let p = 0; p < 512; p += 128) {
      g.fillRect(p, 0, 3, h);
      g.fillRect(0, p, w, 3);
    }
  }), true);
}
/** yellow / black diagonal stripes, `wear` 0..1 (256 px = 0.5 m) */
function hazardCanvas(wear, seed, alpha = false) {
  const rnd = mulberry(seed);
  return canvas(256, 256, (g, w, h) => {
    g.fillStyle = '#e0ae17';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#1a1a1a';
    for (let k = -4; k < 8; k++) {
      g.beginPath();
      g.moveTo(k * 64, 0);
      g.lineTo(k * 64 + 32, 0);
      g.lineTo(k * 64 + 32 + 256, 256);
      g.lineTo(k * 64 + 256, 256);
      g.closePath();
      g.fill();
    }
    // grime and scuffs
    for (let i = 0; i < 260 * wear; i++) {
      g.fillStyle = `rgba(${30 + rnd() * 40},${26 + rnd() * 30},${20 + rnd() * 20},${0.08 + rnd() * 0.25 * wear})`;
      const r = 2 + rnd() * 14;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 90 * wear; i++) {
      g.strokeStyle = `rgba(150,150,145,${0.2 + rnd() * 0.4})`;
      g.lineWidth = 0.5 + rnd();
      g.beginPath();
      const x = rnd() * w, y = rnd() * h;
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 40, y + (rnd() - 0.5) * 12);
      g.stroke();
    }
    if (alpha) {
      // worn floor paint: holes where the concrete shows through
      g.globalCompositeOperation = 'destination-out';
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(0,0,0,${0.3 + rnd() * 0.7})`;
        g.beginPath();
        g.arc(rnd() * w, rnd() * h, 1 + rnd() * 9, 0, Math.PI * 2);
        g.fill();
      }
      g.globalCompositeOperation = 'source-over';
    }
  });
}
/** painted steel of the door leaf: grey-blue paint, scratches and chips down to bare metal (512 px = 1.5 m) */
function doorPaintTex() {
  const rnd = mulberry(21);
  return texOf(canvas(512, 512, (g, w, h) => {
    g.fillStyle = '#56626b';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rnd, 6000, ['rgba(0,0,0,0.05)', 'rgba(255,255,255,0.04)'], 3);
    for (let i = 0; i < 160; i++) {
      g.strokeStyle = `rgba(170,176,180,${0.15 + rnd() * 0.45})`;
      g.lineWidth = 0.4 + rnd() * 1.2;
      g.beginPath();
      const x = rnd() * w, y = rnd() * h;
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 70, y + (rnd() - 0.5) * 20);
      g.stroke();
    }
    for (let i = 0; i < 50; i++) {
      g.fillStyle = `rgba(140,146,150,${0.4 + rnd() * 0.4})`;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 1 + rnd() * 4, 0, Math.PI * 2);
      g.fill();
    }
    // rust streaks from the bottom edge
    for (let i = 0; i < 30; i++) {
      const x = rnd() * w;
      const gr = g.createLinearGradient(0, h, 0, h - 60 - rnd() * 90);
      gr.addColorStop(0, 'rgba(110,60,25,0.35)');
      gr.addColorStop(1, 'rgba(110,60,25,0)');
      g.fillStyle = gr;
      g.fillRect(x, h - 150, 2 + rnd() * 5, 150);
    }
  }), true);
}
/** armored glass face: faint tint, dark green edges (the thickness), scratches and smudges */
function glassCanvas(seed, W = 512, H = 384) {
  const rnd = mulberry(seed);
  return canvas(W, H, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(170,215,205,0.10)';
    g.fillRect(0, 0, w, h);
    const band = 22;
    for (let i = 0; i < band; i++) {
      const a = 0.5 * Math.pow(1 - i / band, 2);
      g.strokeStyle = `rgba(28,78,62,${a})`;
      g.lineWidth = 1;
      g.strokeRect(i + 0.5, i + 0.5, w - 2 * i - 1, h - 2 * i - 1);
    }
    for (let i = 0; i < (26 * w) / 512; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, 'rgba(255,255,255,0.05)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.save();
      g.translate(rnd() * w, rnd() * h);
      g.scale(20 + rnd() * 60, 10 + rnd() * 30);
      g.fillStyle = gr;
      g.beginPath();
      g.arc(0, 0, 1, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    for (let i = 0; i < (70 * w) / 512; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.08 + rnd() * 0.22})`;
      g.lineWidth = 0.5 + rnd() * 0.7;
      g.beginPath();
      const x = rnd() * w, y = rnd() * h, a = rnd() * Math.PI, l = 8 + rnd() * 70;
      g.moveTo(x, y);
      g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 8, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  });
}

function biohazard(g, cx, cy, R, color) {
  const c = canvas(256, 256, (q) => {
    q.translate(128, 128);
    q.fillStyle = '#000';
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
      q.beginPath();
      q.arc(Math.cos(a) * 44, Math.sin(a) * 44, 58, 0, Math.PI * 2);
      q.fill();
    }
    q.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 3;
      q.beginPath();
      q.arc(Math.cos(a) * 58, Math.sin(a) * 58, 42, 0, Math.PI * 2);
      q.fill();
      q.lineWidth = 9; // the gaps in the ring
      q.beginPath();
      q.moveTo(0, 0);
      q.lineTo(Math.cos(a + Math.PI / 3) * 128, Math.sin(a + Math.PI / 3) * 128);
      q.stroke();
    }
    q.beginPath();
    q.arc(0, 0, 16, 0, Math.PI * 2);
    q.fill();
    q.globalCompositeOperation = 'source-over';
    q.lineWidth = 12;
    q.beginPath();
    q.arc(0, 0, 38, 0, Math.PI * 2);
    q.stroke();
    q.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 3; k++) {
      const a = -Math.PI / 2 + (k * Math.PI * 2) / 3 + Math.PI / 3;
      q.beginPath();
      q.arc(Math.cos(a) * 38, Math.sin(a) * 38, 6, 0, Math.PI * 2);
      q.fill();
    }
    q.globalCompositeOperation = 'source-in';
    q.fillStyle = color;
    q.fillRect(-128, -128, 256, 256);
  });
  g.drawImage(c, cx - R, cy - R, R * 2, R * 2);
}

// sign / label atlas (1024²): region name -> [x, y, w, h] in pixels
const SIGN = {
  door: [0, 0, 512, 360],
  bio: [512, 0, 256, 256],
  glass: [768, 0, 256, 96],
  keypad: [768, 96, 128, 192],
  stencil: [0, 360, 1024, 160],
  vat0: [0, 520, 256, 96],
  vat1: [256, 520, 256, 96],
  vat2: [512, 520, 256, 96],
  subject: [768, 520, 256, 96],
  gauge: [0, 616, 128, 128],
  level: [128, 616, 512, 96],
  label: [640, 616, 128, 64],
  paper: [768, 616, 256, 320],
  clock: [0, 744, 128, 128],
  b2: [128, 712, 256, 160],
  corridor: [384, 712, 256, 64],
  freezer: [384, 776, 128, 64],
};
function signCanvas() {
  return canvas(1024, 1024, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 1024, 1024);
    const text = (s, x, y, font, col, align = 'center') => {
      g.font = font;
      g.fillStyle = col;
      g.textAlign = align;
      g.textBaseline = 'middle';
      g.fillText(s, x, y);
    };
    // door sign
    {
      const [x, y, w, h] = SIGN.door;
      g.fillStyle = '#f2f0e8';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#b3141a';
      g.fillRect(x, y, w, 96);
      text('RESTRICTED AREA', x + w / 2, y + 50, 'bold 44px "Arial Black", Arial, sans-serif', '#ffffff');
      biohazard(g, x + 92, y + 210, 70, '#111111');
      text('BIOHAZARD', x + 330, y + 160, 'bold 50px Impact, "Arial Black", sans-serif', '#111');
      text('AUTHORIZED', x + 330, y + 218, 'bold 30px Arial, sans-serif', '#222');
      text('PERSONNEL ONLY', x + 330, y + 252, 'bold 30px Arial, sans-serif', '#222');
      g.fillStyle = '#111';
      g.fillRect(x, y + h - 58, w, 58);
      text('B-2 CONTAINMENT LAB', x + w / 2, y + h - 29, 'bold 34px Arial, sans-serif', '#e0ae17');
      g.strokeStyle = '#111';
      g.lineWidth = 8;
      g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    }
    // biohazard warning triangle
    {
      const [x, y, w, h] = SIGN.bio;
      g.fillStyle = '#ffffff';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#e8b417';
      g.strokeStyle = '#111';
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(x + w / 2, y + 16);
      g.lineTo(x + w - 14, y + h - 22);
      g.lineTo(x + 14, y + h - 22);
      g.closePath();
      g.fill();
      g.stroke();
      biohazard(g, x + w / 2, y + 150, 58, '#111');
    }
    // armored glass sticker
    {
      const [x, y, w, h] = SIGN.glass;
      g.fillStyle = '#e0ae17';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#111';
      g.fillRect(x + 6, y + 6, w - 12, h - 12);
      text('ARMORED GLASS', x + w / 2, y + 30, 'bold 26px Arial, sans-serif', '#e0ae17');
      text('BR7-NS · 140 mm · DO NOT TAP', x + w / 2, y + 64, 'bold 16px Arial, sans-serif', '#eeeeee');
    }
    // keypad face
    {
      const [x, y, w, h] = SIGN.keypad;
      g.fillStyle = '#26292c';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#0c1a10';
      g.fillRect(x + 12, y + 12, w - 24, 30);
      text('LOCKED', x + w / 2, y + 28, 'bold 17px monospace', '#ff3b2a');
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
      keys.forEach((k, i) => {
        const cx = x + 26 + (i % 3) * 38, cy = y + 64 + Math.floor(i / 3) * 26;
        g.fillStyle = '#8d9398';
        g.fillRect(cx - 14, cy - 10, 28, 20);
        text(k, cx, cy + 1, 'bold 14px Arial', '#1b1b1b');
      });
      g.fillStyle = '#0a0a0a';
      g.fillRect(x + 20, y + h - 18, w - 40, 6); // card slot
    }
    // "BIOLAB B-2" stencil
    {
      const [x, y, w, h] = SIGN.stencil;
      g.fillStyle = '#dde2e5';
      g.fillRect(x, y, w, h);
      text('BIOLAB  B-2', x + w / 2, y + h / 2 + 6, 'bold 130px Impact, "Arial Black", sans-serif', '#2b5f8a');
    }
    // vat plates
    ['R-101', 'R-102', 'R-103'].forEach((s, i) => {
      const [x, y, w, h] = SIGN['vat' + i];
      g.fillStyle = '#1d4f7a';
      g.fillRect(x, y, w, h);
      g.strokeStyle = '#e8eef2';
      g.lineWidth = 5;
      g.strokeRect(x + 6, y + 6, w - 12, h - 12);
      text(s, x + w / 2, y + 40, 'bold 44px Arial, sans-serif', '#ffffff');
      text(['CULTURE MEDIUM', 'REAGENT B', 'NUTRIENT FEED'][i], x + w / 2, y + 74, 'bold 16px Arial', '#cfe3f2');
    });
    // specimen plate
    {
      const [x, y, w, h] = SIGN.subject;
      g.fillStyle = '#111';
      g.fillRect(x, y, w, h);
      text('SUBJECT 07', x + w / 2, y + 38, 'bold 40px "Arial Black", Arial', '#e0ae17');
      text('DO NOT OPEN · STAGE III', x + w / 2, y + 74, 'bold 16px Arial', '#ff5a3c');
    }
    // pressure gauge
    {
      const [x, y, w] = SIGN.gauge;
      const cx = x + w / 2, cy = y + w / 2;
      g.fillStyle = '#222';
      g.fillRect(x, y, w, w);
      g.fillStyle = '#f4f2ea';
      g.beginPath();
      g.arc(cx, cy, 58, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#222';
      g.lineWidth = 2;
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI * 0.75 + (i / 10) * Math.PI * 1.5;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
        g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54);
        g.stroke();
      }
      g.strokeStyle = '#c21e1e';
      g.lineWidth = 7;
      g.beginPath();
      g.arc(cx, cy, 50, Math.PI * 1.95, Math.PI * 2.25);
      g.stroke();
      g.strokeStyle = '#111';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(Math.PI * 1.55) * 46, cy + Math.sin(Math.PI * 1.55) * 46);
      g.stroke();
    }
    // bulkhead sign
    {
      const [x, y, w, h] = SIGN.level;
      g.fillStyle = '#1d4f7a';
      g.fillRect(x, y, w, h);
      text('CONTAINMENT LEVEL 3', x + w / 2, y + 36, 'bold 38px Arial, sans-serif', '#ffffff');
      text('NEGATIVE PRESSURE · PPE REQUIRED', x + w / 2, y + 74, 'bold 20px Arial', '#cfe3f2');
    }
    // generic bottle label
    {
      const [x, y, w, h] = SIGN.label;
      g.fillStyle = '#f1efe6';
      g.fillRect(x, y, w, h);
      g.fillStyle = '#b3141a';
      g.fillRect(x, y, w, 12);
      g.fillStyle = '#555';
      for (let i = 0; i < 3; i++) g.fillRect(x + 10, y + 24 + i * 11, w - 20 - i * 18, 4);
    }
    // clipboard paper: a data table
    {
      const [x, y, w, h] = SIGN.paper;
      g.fillStyle = '#fbfaf5';
      g.fillRect(x, y, w, h);
      text('SAMPLE LOG · B-2', x + w / 2, y + 22, 'bold 18px Arial', '#1d2b3a');
      g.strokeStyle = '#9fb4c8';
      g.lineWidth = 1;
      for (let r = 0; r < 12; r++) {
        g.beginPath();
        g.moveTo(x + 12, y + 46 + r * 22);
        g.lineTo(x + w - 12, y + 46 + r * 22);
        g.stroke();
      }
      g.strokeStyle = '#2b3b8a';
      g.lineWidth = 1.5;
      const rnd = mulberry(5);
      for (let r = 0; r < 9; r++) {
        let px = x + 16;
        g.beginPath();
        g.moveTo(px, y + 60 + r * 22);
        while (px < x + 60 + rnd() * 160) {
          px += 4 + rnd() * 6;
          g.lineTo(px, y + 56 + r * 22 + rnd() * 8);
        }
        g.stroke();
      }
    }
    // wall clock
    {
      const [x, y, w] = SIGN.clock;
      const cx = x + w / 2, cy = y + w / 2;
      g.fillStyle = '#dde2e5';
      g.fillRect(x, y, w, w);
      g.fillStyle = '#fbfbfb';
      g.beginPath();
      g.arc(cx, cy, 60, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#222';
      g.lineWidth = 5;
      g.stroke();
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.lineWidth = i % 3 ? 2 : 4;
        g.beginPath();
        g.moveTo(cx + Math.cos(a) * 46, cy + Math.sin(a) * 46);
        g.lineTo(cx + Math.cos(a) * 54, cy + Math.sin(a) * 54);
        g.stroke();
      }
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + 28, cy - 18);
      g.moveTo(cx, cy);
      g.lineTo(cx - 8, cy - 44);
      g.stroke();
    }
    // big "B-2" wall number
    {
      const [x, y, w, h] = SIGN.b2;
      g.fillStyle = '#dde2e5';
      g.fillRect(x, y, w, h);
      text('B-2', x + w / 2, y + h / 2 + 8, 'bold 140px Impact, "Arial Black", sans-serif', '#b3141a');
    }
    // corridor sign over the far door
    {
      const [x, y, w, h] = SIGN.corridor;
      g.fillStyle = '#157a3c';
      g.fillRect(x, y, w, h);
      text('CORRIDOR C  ›', x + w / 2, y + h / 2 + 2, 'bold 34px Arial', '#ffffff');
    }
    // freezer display
    {
      const [x, y, w, h] = SIGN.freezer;
      g.fillStyle = '#0b1418';
      g.fillRect(x, y, w, h);
      text('-80°C', x + w / 2, y + h / 2 + 2, 'bold 34px monospace', '#5ee0ff');
    }
  });
}

// monitor screens (1024 x 512, four 512 x 256 screens)
const SCREEN = { vitals: [0, 0, 512, 256], helix: [512, 0, 512, 256], seq: [0, 256, 512, 256], spectrum: [512, 256, 512, 256] };
function screenCanvas() {
  const rnd = mulberry(77);
  return canvas(1024, 512, (g) => {
    const text = (s, x, y, font, col, align = 'left') => {
      g.font = font;
      g.fillStyle = col;
      g.textAlign = align;
      g.textBaseline = 'middle';
      g.fillText(s, x, y);
    };
    // vitals: three traces
    {
      const [x, y, w, h] = SCREEN.vitals;
      g.fillStyle = '#04100a';
      g.fillRect(x, y, w, h);
      text('SUBJECT 07 · VITALS', x + 16, y + 20, 'bold 18px monospace', '#7dffa0');
      const traces = [['#5dff7a', 70, (t) => (t % 60 < 6 ? -30 * Math.sin(((t % 60) / 6) * Math.PI) : Math.sin(t * 0.3) * 2)], ['#ffd34d', 140, (t) => Math.sin(t * 0.08) * 14], ['#52d8ff', 205, (t) => Math.sin(t * 0.045) * 10 + Math.sin(t * 0.21) * 4]];
      for (const [col, cy, f] of traces) {
        g.strokeStyle = col;
        g.lineWidth = 2;
        g.beginPath();
        for (let t = 0; t < 380; t += 2) g.lineTo(x + 16 + t, y + cy + f(t));
        g.stroke();
      }
      text('HR 38', x + 420, y + 70, 'bold 26px monospace', '#5dff7a');
      text('SpO2 71', x + 408, y + 140, 'bold 22px monospace', '#ffd34d');
      text('T 31.2', x + 414, y + 205, 'bold 22px monospace', '#52d8ff');
    }
    // DNA helix
    {
      const [x, y, w, h] = SCREEN.helix;
      g.fillStyle = '#030a14';
      g.fillRect(x, y, w, h);
      for (let i = 0; i < 44; i++) {
        const px = x + 40 + i * 10;
        const a = i * 0.42;
        const y1 = y + 128 + Math.sin(a) * 70, y2 = y + 128 - Math.sin(a) * 70;
        g.strokeStyle = 'rgba(90,200,255,0.5)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(px, y1);
        g.lineTo(px, y2);
        g.stroke();
        g.fillStyle = '#5ac8ff';
        g.beginPath();
        g.arc(px, y1, 4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ff6ad5';
        g.beginPath();
        g.arc(px, y2, 4, 0, Math.PI * 2);
        g.fill();
      }
      text('GENOME MAP · STRAIN K-7', x + 16, y + 22, 'bold 18px monospace', '#9ad8ff');
      text('MUTATION 0.34 %', x + 16, y + 236, 'bold 16px monospace', '#ff6ad5');
    }
    // sequencing table
    {
      const [x, y, w, h] = SCREEN.seq;
      g.fillStyle = '#0a0f16';
      g.fillRect(x, y, w, h);
      text('SEQUENCING  RUN 0412', x + 16, y + 22, 'bold 18px monospace', '#d6e4f0');
      for (let r = 0; r < 7; r++) {
        let s = '';
        for (let k = 0; k < 30; k++) s += 'ACGT'[Math.floor(rnd() * 4)];
        text(s, x + 16, y + 56 + r * 22, '15px monospace', r === 3 ? '#ff5a3c' : '#7fa7c9');
      }
      g.fillStyle = '#1f2c3a';
      g.fillRect(x + 16, y + 220, w - 32, 16);
      g.fillStyle = '#3ddc84';
      g.fillRect(x + 16, y + 220, (w - 32) * 0.73, 16);
      text('73 %', x + w - 20, y + 206, 'bold 16px monospace', '#3ddc84', 'right');
    }
    // spectrum bars
    {
      const [x, y, w, h] = SCREEN.spectrum;
      g.fillStyle = '#0d0a14';
      g.fillRect(x, y, w, h);
      text('MASS SPEC · SAMPLE 12', x + 16, y + 22, 'bold 18px monospace', '#e0c8ff');
      for (let i = 0; i < 60; i++) {
        const v = Math.pow(rnd(), 3) * 160 + (i % 13 === 5 ? 40 : 0);
        g.fillStyle = i % 13 === 5 ? '#ff6ad5' : '#8f7bff';
        g.fillRect(x + 20 + i * 7.8, y + 236 - v, 5, v);
      }
      g.fillStyle = '#6a5a8a';
      g.fillRect(x + 16, y + 237, w - 32, 2);
    }
  });
}

// ---------------------------------------------------------------- materials
const bakeShader = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec3 bake;\nvarying vec3 vBake;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = bake;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vBake;')
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vBake;');
};
/** standard material that adds the baked light (vertex attribute `bake`) as emission */
function bakeMat(params, cast = false) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = bakeShader;
  m.customProgramCacheKey = () => 'labBake';
  m.userData.bake = true;
  m.userData.cast = cast;
  return m;
}
function glow(color, k = 1) {
  const c = new THREE.Color(color);
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k, roughness: 0.15 });
}

// ---------------------------------------------------------------- geometry kit
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const FACE = {
  // origin corner, u edge, v edge (u × v = normal), uv from world position
  px: (b) => [[b[3], b[1], b[5]], [0, 0, -1], [0, 1, 0], (p) => [-p[2], p[1]]],
  nx: (b) => [[b[0], b[1], b[2]], [0, 0, 1], [0, 1, 0], (p) => [p[2], p[1]]],
  py: (b) => [[b[0], b[4], b[5]], [1, 0, 0], [0, 0, -1], (p) => [p[0], -p[2]]],
  ny: (b) => [[b[0], b[1], b[2]], [1, 0, 0], [0, 0, 1], (p) => [p[0], p[2]]],
  pz: (b) => [[b[0], b[1], b[5]], [1, 0, 0], [0, 1, 0], (p) => [p[0], p[1]]],
  nz: (b) => [[b[3], b[1], b[2]], [-1, 0, 0], [0, 1, 0], (p) => [-p[0], p[1]]],
};
const NORMAL = { px: [1, 0, 0], nx: [-1, 0, 0], py: [0, 1, 0], ny: [0, -1, 0], pz: [0, 0, 1], nz: [0, 0, -1] };
const EXT = { px: (b) => [b[5] - b[2], b[4] - b[1]], nx: (b) => [b[5] - b[2], b[4] - b[1]], py: (b) => [b[3] - b[0], b[5] - b[2]], ny: (b) => [b[3] - b[0], b[5] - b[2]], pz: (b) => [b[3] - b[0], b[4] - b[1]], nz: (b) => [b[3] - b[0], b[4] - b[1]] };

/** axis-aligned box in world space with world-scaled UVs; faces subdivided every `seg` m (smooth bake) */
function boxGeometry(x0, y0, z0, x1, y1, z1, { faces = Object.keys(FACE), seg = 0, mpr = 1 } = {}) {
  const b = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1), Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
  const pos = [], nor = [], uv = [], idx = [];
  for (const f of faces) {
    const [o, eu, ev, uvOf] = FACE[f](b);
    const [lu, lv] = EXT[f](b);
    const n = NORMAL[f];
    const nu = seg ? Math.max(1, Math.ceil(lu / seg)) : 1, nv = seg ? Math.max(1, Math.ceil(lv / seg)) : 1;
    const base = pos.length / 3;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        const p = [0, 1, 2].map((k) => o[k] + eu[k] * lu * (i / nu) + ev[k] * lv * (j / nv));
        pos.push(...p);
        nor.push(...n);
        const [u, v] = uvOf(p);
        uv.push(u / mpr, v / mpr);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i, c = a + nu + 2;
        idx.push(a, a + 1, c, a, c, a + nu + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Collects world-space geometry per material and merges it (one mesh per material). */
class Kit {
  constructor() {
    this.parts = new Map();
  }
  put(mat, g) {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    let a = this.parts.get(mat);
    if (!a) this.parts.set(mat, (a = []));
    a.push(g);
    return g;
  }
  /** a primitive placed at (x, y, z) with Euler rotation r = [rx, ry, rz] and scale s */
  add(mat, geo, x, y, z, r = null, s = null) {
    _e.set(r?.[0] ?? 0, r?.[1] ?? 0, r?.[2] ?? 0, r?.[3] ?? 'XYZ');
    _q.setFromEuler(_e);
    _m.compose(_p.set(x, y, z), _q, s ? _s.set(s[0], s[1], s[2]) : _s.set(1, 1, 1));
    return this.put(mat, geo.clone().applyMatrix4(_m));
  }
  addMatrix(mat, geo, m) {
    return this.put(mat, geo.clone().applyMatrix4(m));
  }
  box(mat, x0, y0, z0, x1, y1, z1, opts) {
    return this.put(mat, boxGeometry(x0, y0, z0, x1, y1, z1, opts));
  }
  /** centered box (local UVs), rotated about y */
  cube(mat, x, y, z, sx, sy, sz, ry = 0) {
    return this.add(mat, new THREE.BoxGeometry(sx, sy, sz), x, y, z, [0, ry, 0]);
  }
  /** vertical cylinder standing on y (bottom), or rotated by r */
  cyl(mat, x, y, z, r0, r1, h, seg = 16, r = null, open = false) {
    const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open);
    g.translate(0, h / 2, 0);
    return this.add(mat, g, x, y, z, r);
  }
  /** cylinder between two world points */
  rod(mat, a, b, r, seg = 10) {
    const d = _p.subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    _m.compose(a.clone().addScaledVector(d, 0.5), _q, _s.set(1, 1, 1));
    return this.put(mat, g.applyMatrix4(_m));
  }
  /** plane (normal +z before rotation) whose UVs map to atlas region `rect` of a W x H canvas */
  plane(mat, w, h, x, y, z, r, rect = null, W = 1024, H = 1024) {
    return this.add(mat, rect ? atlasPlane(w, h, rect, W, H) : new THREE.PlaneGeometry(w, h), x, y, z, r);
  }
  /** merge into meshes under `group`; baked materials get their light from `bake` */
  build(group, bake) {
    for (const [mat, geos] of this.parts) {
      const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!g) continue;
      if (mat.userData.bake) bake(g);
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = !!mat.userData.cast;
      mesh.receiveShadow = !mat.transparent;
      if (mat.transparent) mesh.renderOrder = -1; // before the armored window (drawn over the lab)
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    this.parts.clear();
  }
}

// ---------------------------------------------------------------- baked light
/** does the segment a → b cross the box [x0, y0, z0, x1, y1, z1]? */
function segHitsBox(ax, ay, az, bx, by, bz, bb) {
  let t0 = 0, t1 = 1;
  const a = [ax, ay, az], d = [bx - ax, by - ay, bz - az];
  for (let k = 0; k < 3; k++) {
    const lo = bb[k], hi = bb[k + 3];
    if (Math.abs(d[k]) < 1e-9) {
      if (a[k] < lo || a[k] > hi) return false;
      continue;
    }
    let ta = (lo - a[k]) / d[k], tb = (hi - a[k]) / d[k];
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1) return false;
  }
  return true;
}
/**
 * Per-vertex light from the virtual light list: Lambertian panels (cosine emission along `dir`) with a
 * soft wrap on the receiving side, a 1 / (1 + d²/r²) falloff and box occluders (the gallery floor),
 * plus a hemispherical ambient (ceilings pick up the floor's bounce).
 */
function makeBaker(lights, occluders) {
  return (geo) => {
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    const n = P.length / 3;
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
      const nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2];
      const up = ny > 0 ? ny : 0, down = ny < 0 ? -ny : 0;
      let r = 0.055 + 0.03 * up + 0.1 * down, g = r * 1.02, b = r * 1.06;
      for (const L of lights) {
        const dx = L.x - px, dy = L.y - py, dz = L.z - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        const d = Math.sqrt(d2) + 1e-6;
        const ndl = (nx * dx + ny * dy + nz * dz) / d;
        if (ndl <= -0.2) continue;
        const emit = L.dir ? -(L.dir[0] * dx + L.dir[1] * dy + L.dir[2] * dz) / d : 1;
        if (emit <= 0) continue;
        const k = (L.i * (L.dir ? 0.25 + 0.75 * emit : 1) * Math.min(1, (ndl + 0.2) / 1.2)) / (1 + d2 / (L.r * L.r));
        if (k < 0.003) continue;
        let hidden = false;
        for (const o of occluders) if (segHitsBox(px + nx * 0.03, py + ny * 0.03, pz + nz * 0.03, L.x, L.y, L.z, o)) hidden = true;
        if (hidden) continue;
        r += k * L.c[0];
        g += k * L.c[1];
        b += k * L.c[2];
      }
      out[i * 3] = r;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = b;
    }
    geo.setAttribute('bake', new THREE.BufferAttribute(out, 3));
  };
}

// ---------------------------------------------------------------- shared shapes
function erlenmeyer() {
  const pts = [[0, 0], [0.043, 0], [0.048, 0.006], [0.046, 0.02], [0.02, 0.1], [0.013, 0.112], [0.013, 0.148], [0.016, 0.152], [0.0125, 0.153]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 20);
}
function erlenLiquid() {
  // closed: bottom, walls up to y 0.07 (scaled for the level), top cap
  const pts = [[0, 0.003], [0.042, 0.003], [0.044, 0.02], [0.028, 0.07], [0, 0.07]];
  const g = new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 18);
  return g;
}
function testTube() {
  const pts = [[0, 0], [0.005, 0.001], [0.0078, 0.005], [0.008, 0.012], [0.008, 0.1], [0.0088, 0.102]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 10);
}
function bottleShape(r, h) {
  const pts = [[0, 0], [r, 0], [r, h * 0.72], [r * 0.45, h * 0.86], [r * 0.4, h], [0, h]];
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 14);
}

// ---------------------------------------------------------------- build
/**
 * B: LevelBuilder (the basement-side door / window go into its static batch), world: CollisionWorld,
 * lamps: the level's lamp list (the counter spot is appended). Returns the lab runtime.
 */
export function buildLab(B, world, lamps) {
  const group = new THREE.Group();
  group.name = 'lab';
  const dyn = new THREE.Group(); // moving props (Nadja's glassware, pipette, clipboard, bubbles...)
  dyn.name = 'labDynamic';
  group.add(dyn);
  const rnd = mulberry(4242);
  const K = new Kit();

  const signTex = texOf(signCanvas());
  const screenTex = texOf(screenCanvas());
  const M = {
    wall: bakeMat({ map: panelTex(), roughness: 0.6 }, true),
    floor: bakeMat({ map: floorTex(), roughness: 0.32, envMapIntensity: 0.8 }),
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
    hazard: bakeMat({ map: texOf(hazardCanvas(0.3, 31), true), roughness: 0.6 }),
    signs: bakeMat({ map: signTex, roughness: 0.55 }),
  };
  const U = {
    glass: new THREE.MeshPhysicalMaterial({ color: 0xe6f3ff, roughness: 0.05, transparent: true, opacity: 0.22, depthWrite: false, envMapIntensity: 1.8, side: THREE.DoubleSide }),
    blue: glow(0x2aa8ff, 1.1),
    green: glow(0x52ff6a, 1.0),
    amber: glow(0xffa22a, 1.0),
    magenta: glow(0xff3ad2, 1.0),
    cyan: glow(0x3affe2, 0.9),
    red: glow(0xff3024, 1.0),
    panel: new THREE.MeshBasicMaterial({ color: new THREE.Color(4.4, 4.6, 5.0) }),
    screen: new THREE.MeshBasicMaterial({ map: screenTex, color: new THREE.Color(1.5, 1.5, 1.5) }),
    murk: new THREE.MeshStandardMaterial({ color: 0x3f7a2a, emissive: 0x2c7a1c, emissiveIntensity: 1.1, transparent: true, opacity: 0.6, depthWrite: false, roughness: 0.2 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x27332a, roughness: 0.65, emissive: 0x0c1f0e, emissiveIntensity: 1 }),
  };
  const liquids = [U.blue, U.green, U.amber, U.magenta, U.cyan];

  // ------------------------------------------------ virtual lights for the bake
  const lights = [];
  const DOWN = [0, -1, 0];
  const cool = [0.93, 0.97, 1.0];
  // hall: 3 x 3 panels (1.8 m strips along z), two bake points each
  const hallPanels = [];
  for (const x of [-9.3, -4.8, -0.3]) for (const z of [8.9, 12.3, 15.7]) hallPanels.push([x, z]);
  for (const [x, z] of hallPanels) for (const dz of [-0.55, 0.55]) lights.push({ x, y: HC - 0.12, z: z + dz, i: 0.8, r: 3.8, c: cool, dir: DOWN });
  // gallery: three strips along x
  const galPanels = [-9.2, -4.6, -0.6];
  for (const x of galPanels) for (const dx of [-0.45, 0.45]) lights.push({ x: x + dx, y: GC - 0.1, z: 5.3, i: 0.42, r: 2.5, c: cool, dir: DOWN });
  const occluders = [[X0, FB - 0.25, WZ, X1, FB, GZ]];

  // ------------------------------------------------ shell (only faces seen from the basement or needed for the moon's shadow)
  K.box(M.floor, X0, FB - 0.25, WZ, X1, FB, GZ, { faces: ['py'], seg: 0.6, mpr: 2 });
  K.box(M.yellow, X0, FB, GZ - 0.07, X1, FB + 0.004, GZ, { faces: ['py'] }); // edge nosing
  K.box(M.floor, X0, HF - 0.2, GZ, X1, HF, HZ, { faces: ['py'], seg: 0.8, mpr: 2 });
  K.box(M.ceil, X0, HC, WZ, X1, HC + 0.1, HZ, { faces: ['ny'], seg: 0.8, mpr: 2.4 });
  K.box(M.wall, X0 - 0.3, HF, GZ, X0, HC, HZ, { faces: ['px'], seg: 0.8, mpr: 2.4 });
  K.box(M.wall, X1, HF, GZ, X1 + 0.3, HC, HZ, { faces: ['nx'], seg: 0.8, mpr: 2.4 });
  K.box(M.wall, X0, HF, HZ, X1, HC, HZ + 0.3, { faces: ['nz'], seg: 0.8, mpr: 2.4 });
  K.box(M.wall, X0 - 0.3, FB, WZ, X0, GC, GZ, { faces: ['px'], seg: 0.6, mpr: 2.4 });
  K.box(M.wall, X1, FB, WZ, X1 + 0.3, GC, GZ, { faces: ['nx'], seg: 0.6, mpr: 2.4 });
  // skirting along the hall walls
  K.box(M.dark, X0, HF, GZ, X0 + 0.02, HF + 0.12, HZ, { faces: ['px', 'py'] });
  K.box(M.dark, X1 - 0.02, HF, GZ, X1, HF + 0.12, HZ, { faces: ['nx', 'py'] });
  K.box(M.dark, X0, HF, HZ - 0.02, X1, HF + 0.12, HZ, { faces: ['nz', 'py'] });

  // ceiling light panels
  for (const [x, z] of hallPanels) {
    K.cube(M.dark, x, HC - 0.02, z, 0.46, 0.04, 1.9);
    K.cube(U.panel, x, HC - 0.045, z, 0.36, 0.012, 1.8);
  }
  for (const x of galPanels) {
    K.cube(M.dark, x, GC - 0.02, 5.3, 1.9, 0.04, 0.46);
    K.cube(U.panel, x, GC - 0.045, 5.3, 1.8, 0.012, 0.36);
  }

  // ------------------------------------------------ gallery: railing, stairs, walls
  {
    const rail = (x0, x1) => {
      const z = GZ - 0.05;
      K.rod(M.steel, V(x0, FB + 1.05, z), V(x1, FB + 1.05, z), 0.024);
      K.rod(M.steel, V(x0, FB + 0.55, z), V(x1, FB + 0.55, z), 0.014);
      K.box(M.yellow, x0, FB, z - 0.005, x1, FB + 0.1, z + 0.005, { faces: ['nz', 'pz', 'py'] });
      const n = Math.max(1, Math.round((x1 - x0) / 1.25));
      for (let i = 0; i <= n; i++) K.cyl(M.steel, x0 + ((x1 - x0) * i) / n, FB, z, 0.02, 0.02, 1.05, 8);
    };
    rail(X0 + 0.05, 1.05);
    // stairs down to the hall along the east wall: 16 steps, x 1.15..2.25, z 6.6 → 11.4
    const sx0 = 1.15, sx1 = 2.25, n = 16, run = 0.3, rise = (FB - HF) / n;
    for (let i = 0; i < n; i++) {
      const y = FB - (i + 1) * rise, z = GZ + i * run;
      K.box(M.dark, sx0, y - 0.03, z, sx1, y, z + run + 0.02, { faces: ['py', 'nz', 'px', 'nx'] });
      K.box(M.yellow, sx0, y, z, sx1, y + 0.003, z + 0.04, { faces: ['py'] });
    }
    const len = Math.hypot(n * run, FB - HF), ang = Math.atan2(FB - HF, n * run);
    for (const x of [sx0 - 0.02, sx1 + 0.02]) K.add(M.dark, new THREE.BoxGeometry(0.03, 0.26, len), x, (FB + HF) / 2 - 0.12, GZ + (n * run) / 2, [ang, 0, 0]);
    // handrail on the open side
    K.rod(M.steel, V(sx0 - 0.04, FB + 1.0, GZ), V(sx0 - 0.04, HF + 1.0, GZ + n * run), 0.022);
    for (let i = 0; i <= 4; i++) {
      const z = GZ + (i / 4) * n * run, y = FB - (i / 4) * (FB - HF);
      K.cyl(M.steel, sx0 - 0.04, y, z, 0.018, 0.018, 1.0, 8);
    }
  }
  // gas cylinders at the gallery's west end, chained to the wall
  [[0x2e6e40, 4.5], [0x2f5da8, 4.82], [0x55595e, 5.14]].forEach(([c, z], i) => {
    const m = [M.green, M.blue, M.dark][i];
    K.cyl(m, -11.62, FB, z, 0.12, 0.12, 1.3, 16);
    K.add(m, new THREE.SphereGeometry(0.12, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), -11.62, FB + 1.3, z);
    K.cyl(M.steel, -11.62, FB + 1.38, z, 0.03, 0.03, 0.12, 8);
    K.cyl(M.black, -11.62, FB + 0.95, z, 0.125, 0.125, 0.04, 16);
  });
  K.box(M.dark, X0, FB + 0.93, 4.3, X0 + 0.05, FB + 0.99, 5.4, { faces: ['px', 'py', 'ny'] });
  // tall shelf at the gallery's west end
  {
    const x0 = X0, x1 = X0 + 0.45, z0 = 5.45, z1 = 6.45;
    for (const [x, z] of [[x1 - 0.02, z0 + 0.02], [x1 - 0.02, z1 - 0.02]]) K.cyl(M.steel, x, FB, z, 0.015, 0.015, 2.0, 8);
    for (const y of [0.4, 0.85, 1.3, 1.75]) {
      K.box(M.steel, x0, FB + y - 0.02, z0, x1, FB + y, z1, { faces: ['py', 'ny', 'px'] });
      for (let k = 0; k < 5; k++) {
        const z = z0 + 0.12 + k * 0.19 + (rnd() - 0.5) * 0.04, x = x0 + 0.12 + rnd() * 0.18;
        const h = 0.12 + rnd() * 0.12, r = 0.03 + rnd() * 0.025;
        if (rnd() < 0.35) K.cube(rnd() < 0.5 ? M.white : M.card, x, FB + y + 0.07, z, 0.16, 0.14, 0.16, rnd());
        else {
          K.add(rnd() < 0.5 ? M.amber : M.white, bottleShape(r, h), x, FB + y, z);
          K.cyl(M.black, x, FB + y + h, z, r * 0.42, r * 0.42, 0.02, 10);
        }
      }
    }
  }
  // lockers + bench at the gallery's east end (the airlock side of the vault door)
  for (let i = 0; i < 3; i++) {
    const z = 4.35 + i * 0.46;
    K.box(M.white, 1.82, FB + 0.08, z, X1, FB + 1.9, z + 0.44, { faces: ['nx', 'py', 'nz', 'pz'] });
    K.box(M.dark, 1.815, FB + 1.55, z + 0.1, 1.82, FB + 1.75, z + 0.34, { faces: ['nx'] });
    K.cube(M.steel, 1.8, FB + 1.05, z + 0.36, 0.02, 0.14, 0.02);
  }
  K.box(M.dark, 1.82, FB, 4.35, X1, FB + 0.08, 5.73, { faces: ['nx', 'py'] });
  K.box(M.steel, 0.2, FB + 0.42, 5.9, 1.4, FB + 0.46, 6.25);
  for (const x of [0.28, 1.32]) K.cube(M.dark, x, FB + 0.21, 6.07, 0.05, 0.42, 0.3);
  // biohazard bin behind the counter
  {
    const x = -7.3, z = 6.18;
    K.cube(M.red, x, FB + 0.3, z, 0.42, 0.6, 0.36);
    K.cube(M.dark, x, FB + 0.62, z, 0.44, 0.05, 0.38);
    K.plane(M.signs, 0.22, 0.22, x, FB + 0.36, z - 0.182, [0, Math.PI, 0], SIGN.bio);
  }
  // monitors hanging from the ceiling over the railing, facing the glass
  for (const [x, scr] of [[-7.6, SCREEN.vitals], [-1.7, SCREEN.seq]]) {
    const y = -1.45, z = GZ - 0.2;
    K.box(M.black, x - 0.44, y - 0.25, z - 0.03, x + 0.44, y + 0.25, z + 0.03);
    K.plane(U.screen, 0.82, 0.44, x, y, z - 0.032, [0, Math.PI, 0], scr, 1024, 512);
    for (const dx of [-0.25, 0.25]) K.rod(M.steel, V(x + dx, y + 0.25, z), V(x + dx, HC, z), 0.012, 6);
  }
  // pipes along the gallery ceiling toward the hall
  for (const [y, r, m] of [[GC - 0.12, 0.035, M.blue], [GC - 0.2, 0.03, M.green]]) K.rod(m, V(X0, y, 6.35), V(X1, y, 6.35), r, 10);

  // ------------------------------------------------ Nadja's counter
  const cx0 = -6.3, cx1 = -2.9;
  K.box(M.white, cx0, FB + 0.1, 4.25, cx1, FB + 0.86, 4.88, { faces: ['pz', 'nx', 'px'] });
  K.box(M.dark, cx0 + 0.02, FB, 4.3, cx1 - 0.02, FB + 0.1, 4.82, { faces: ['pz'] });
  K.box(M.top, cx0 - 0.02, FB + 0.86, 4.2, cx1 + 0.02, T, 4.92);
  for (let i = 0; i < 4; i++) {
    const x = cx0 + 0.43 + i * 0.85;
    K.box(M.dark, x - 0.4, FB + 0.12, 4.881, x + 0.4, FB + 0.84, 4.884, { faces: ['pz'] });
    K.cube(M.steel, x, FB + 0.74, 4.9, 0.28, 0.02, 0.02);
  }
  // microscope (station L: she leans over it)
  const scope = { x: -5.35, z: 4.74 };
  {
    const { x, z } = scope;
    K.cube(M.white, x, T + 0.018, z, 0.2, 0.036, 0.25);
    K.cube(M.white, x, T + 0.19, z - 0.09, 0.07, 0.32, 0.07);
    K.cube(M.white, x, T + 0.33, z - 0.02, 0.085, 0.08, 0.2);
    K.cube(M.black, x, T + 0.15, z + 0.03, 0.15, 0.012, 0.13); // stage
    K.cyl(U.cyan, x, T + 0.037, z + 0.03, 0.012, 0.012, 0.01, 12);
    K.cube(U.glass, x, T + 0.158, z + 0.03, 0.075, 0.003, 0.026);
    K.cyl(U.magenta, x, T + 0.1595, z + 0.03, 0.006, 0.006, 0.002, 10);
    K.cyl(M.black, x, T + 0.24, z + 0.03, 0.035, 0.03, 0.035, 14);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      K.cyl(M.steel, x + Math.cos(a) * 0.018, T + 0.19, z + 0.03 + Math.sin(a) * 0.018, 0.007, 0.009, 0.05, 8);
    }
    for (const s of [-1, 1]) {
      // eyepieces tilted toward her (+z) and up
      K.cyl(M.black, x + s * 0.028, T + 0.35, z + 0.04, 0.013, 0.013, 0.1, 12, [0.8, 0, 0]);
      K.cyl(M.black, x + s * 0.045, T + 0.1, z - 0.09, 0.028, 0.028, 0.03, 16, [0, 0, Math.PI / 2]); // focus knobs
    }
  }
  // centrifuge, bottles and gloves at the counter's ends
  {
    const x = -6.0, z = 4.5;
    K.cyl(M.white, x, T, z, 0.17, 0.16, 0.2, 24);
    K.add(M.dark, new THREE.SphereGeometry(0.15, 20, 8, 0, Math.PI * 2, 0, Math.PI / 2), x, T + 0.2, z, null, [1, 0.35, 1]);
    K.plane(U.screen, 0.09, 0.04, x, T + 0.12, z - 0.168, [0, Math.PI, 0.0], [0, 256, 180, 60], 1024, 512);
    K.cyl(U.green, x + 0.07, T + 0.16, z - 0.15, 0.006, 0.006, 0.004, 8, [Math.PI / 2, 0, 0]);
  }
  for (let i = 0; i < 5; i++) {
    const x = -6.22 + i * 0.075, z = 4.3 + (i % 2) * 0.05, h = 0.13 + (i % 3) * 0.03;
    K.add(i === 2 ? U.glass : M.amber, bottleShape(0.03, h), x, T, z);
    K.cyl(i % 2 ? M.black : M.blue, x, T + h, z, 0.013, 0.013, 0.025, 10);
    K.plane(M.signs, 0.045, 0.04, x, T + h * 0.45, z - 0.031, [0, Math.PI, 0], SIGN.label);
    if (i === 2) K.add(U.green, bottleShape(0.027, h * 0.55), x, T + 0.002, z);
  }
  K.cube(M.blue, -5.8, T + 0.05, 4.84, 0.24, 0.1, 0.13, 0.1);
  K.cube(M.white, -5.8, T + 0.101, 4.84, 0.1, 0.002, 0.04, 0.1);
  K.cyl(M.white, -6.15, T, 4.82, 0.032, 0.03, 0.15, 14);
  K.rod(M.white, V(-6.15, T + 0.15, 4.82), V(-6.15, T + 0.2, 4.76), 0.004, 6);
  K.cube(M.yellow, -3.0, T + 0.07, 4.82, 0.12, 0.14, 0.1);
  // test tube rack (station C)
  const rack = { x: -4.6, z: 4.61, tubes: [] };
  {
    const { x, z } = rack;
    K.cube(M.white, x, T + 0.02, z, 0.27, 0.01, 0.07);
    K.cube(M.white, x, T + 0.075, z, 0.27, 0.01, 0.07);
    for (const s of [-1, 1]) K.cube(M.white, x + s * 0.13, T + 0.04, z, 0.01, 0.08, 0.07);
    for (let i = 0; i < 8; i++) {
      const tx = x - 0.105 + i * 0.03;
      K.add(U.glass, testTube(), tx, T + 0.01, z);
      const lvl = 0.025 + ((i * 37) % 5) * 0.008;
      K.cyl(liquids[i % 4], tx, T + 0.013, z, 0.0068, 0.0068, lvl, 8);
      rack.tubes.push(V(tx, T + 0.112, z));
    }
  }
  // monitor + keyboard (station R), gas turret with a handwheel and a gauge
  const mon = { x: -3.2, z: 4.46, yaw: -0.87 };
  {
    const { x, z, yaw } = mon;
    K.cube(M.dark, x, T + 0.008, z, 0.2, 0.016, 0.16, yaw);
    K.cube(M.dark, x, T + 0.12, z - 0.02, 0.04, 0.22, 0.03, yaw);
    const sc = V(x, T + 0.27, z);
    K.cube(M.black, sc.x, sc.y, sc.z, 0.44, 0.27, 0.03, yaw);
    K.plane(U.screen, 0.4, 0.23, sc.x + Math.sin(yaw) * 0.016, sc.y, sc.z + Math.cos(yaw) * 0.016, [0, yaw, 0], SCREEN.spectrum, 1024, 512);
    mon.screen = sc;
  }
  K.cube(M.black, -3.88, T + 0.01, 4.82, 0.38, 0.02, 0.13, 0.05);
  K.cube(M.dark, -3.88, T + 0.021, 4.82, 0.35, 0.003, 0.1, 0.05);
  K.cube(M.black, -3.62, T + 0.012, 4.82, 0.05, 0.024, 0.08);
  const turret = { x: -3.5, z: 4.72 };
  {
    const { x, z } = turret;
    K.cyl(M.steel, x, T, z, 0.022, 0.022, 0.02, 12);
    K.cyl(M.steel, x, T, z, 0.012, 0.012, 0.24, 10);
    K.rod(M.steel, V(x, T + 0.16, z), V(x, T + 0.16, z + 0.07), 0.006, 8);
    K.cyl(M.dark, x, T + 0.12, z - 0.02, 0.036, 0.036, 0.02, 20, [Math.PI / 2, 0, 0]);
    K.plane(M.signs, 0.062, 0.062, x, T + 0.12, z - 0.0305, [0, Math.PI, 0], SIGN.gauge);
    K.plane(M.signs, 0.062, 0.062, x, T + 0.12, z - 0.0095, [0, 0, 0], SIGN.gauge);
  }

  // ------------------------------------------------ hall: vats along the far wall
  const vatZ = 16.9;
  [-8.6, -4.9, -1.2].forEach((x, i) => {
    const R = 1.05;
    const prof = [[0, 0.6], [0.35, 0.63], [0.7, 0.72], [0.95, 0.84], [R, 0.98], [R, 4.05], [0.99, 4.2], [0.87, 4.35], [0.63, 4.47], [0.3, 4.53], [0, 4.55]];
    K.add(M.steel, new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 40), x, HF, vatZ);
    for (const y of [1.8, 3.1]) K.add(M.dark, new THREE.TorusGeometry(R + 0.004, 0.014, 6, 48), x, HF + y, vatZ, [Math.PI / 2, 0, 0]);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      K.cyl(M.steel, x + Math.cos(a) * 0.82, HF, vatZ + Math.sin(a) * 0.82, 0.055, 0.055, 0.85, 10);
    }
    // manway hatch with a bolt ring
    const fz = vatZ - R;
    K.cyl(M.steel, x, HF + 1.45, fz - 0.02, 0.29, 0.29, 0.05, 28, [-Math.PI / 2, 0, 0]);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      K.cyl(M.dark, x + Math.cos(a) * 0.25, HF + 1.45 + Math.sin(a) * 0.25, fz - 0.07, 0.014, 0.014, 0.02, 6, [-Math.PI / 2, 0, 0]);
    }
    K.rod(M.dark, V(x - 0.12, HF + 1.45, fz - 0.1), V(x + 0.12, HF + 1.45, fz - 0.1), 0.012, 8);
    // sight glass with the glowing level
    const sx = x - 0.45, sz = vatZ - Math.sqrt(R * R - 0.45 * 0.45) - 0.02;
    K.cube(M.dark, sx, HF + 2.5, sz, 0.09, 2.2, 0.04, -0.45);
    const lvl = [1.6, 1.1, 1.8][i];
    const liq = [U.green, U.amber, U.cyan][i];
    K.cube(liq, sx - 0.005, HF + 1.45 + lvl / 2, sz - 0.015, 0.04, lvl, 0.02, -0.45);
    // name plate on the curve
    const px = x + 0.4, pz = vatZ - Math.sqrt(R * R - 0.16) - 0.012;
    K.plane(M.signs, 0.6, 0.23, px, HF + 2.9, pz, [0, Math.PI - Math.asin(0.4 / R), 0], SIGN['vat' + i]);
    // top nozzle and pipe up into the ceiling, bottom outlet with a valve wheel
    K.cyl(M.steel, x, HF + 4.5, vatZ, 0.09, 0.09, HC - HF - 4.5, 12);
    K.cyl(M.dark, x, HF + 4.53, vatZ, 0.13, 0.13, 0.05, 16);
    K.cyl(M.steel, x, HF + 0.28, vatZ, 0.06, 0.06, 0.3, 10);
    K.rod(M.steel, V(x, HF + 0.3, vatZ), V(x, HF + 0.3, vatZ - 1.35), 0.06, 10);
    K.add(M.steel, new THREE.SphereGeometry(0.07, 10, 8), x, HF + 0.3, vatZ);
    K.add(M.red, new THREE.TorusGeometry(0.12, 0.012, 6, 20), x, HF + 0.3, vatZ - 1.15);
    for (const a of [0, Math.PI / 2]) K.add(M.red, new THREE.BoxGeometry(0.24, 0.012, 0.012), x, HF + 0.3, vatZ - 1.15, [0, 0, a]);
  });
  K.rod(M.steel, V(X0, HC - 0.3, vatZ), V(X1, HC - 0.3, vatZ), 0.07, 12); // header
  // sign and clock on the far wall between the vats
  K.plane(M.signs, 1.1, 0.21, -3.05, -2.0, HZ - 0.005, [0, Math.PI, 0], SIGN.level);
  K.cyl(M.dark, -6.75, -2.0, HZ, 0.17, 0.17, 0.04, 24, [-Math.PI / 2, 0, 0]);
  K.plane(M.signs, 0.3, 0.3, -6.75, -2.0, HZ - 0.042, [0, Math.PI, 0], SIGN.clock);
  // safety lines on the floor
  const line = (x0, z0, x1, z1) => K.box(M.yellow, x0, HF, z0, x1, HF + 0.003, z1, { faces: ['py'] });
  line(X0 + 0.9, 15.55, 0.9, 15.63);
  line(-10.25, GZ + 0.3, -10.17, 15.55);
  line(0.82, GZ + 0.3, 0.9, 15.55);

  // ------------------------------------------------ specimen tank
  const tank = { x: -8.3, z: 10.8 };
  {
    const { x, z } = tank;
    K.cyl(M.dark, x, HF, z, 0.78, 0.8, 0.45, 32);
    K.add(U.green, new THREE.TorusGeometry(0.7, 0.012, 6, 40), x, HF + 0.46, z, [Math.PI / 2, 0, 0]);
    K.cyl(U.glass, x, HF + 0.45, z, 0.62, 0.62, 2.55, 32, null, true);
    K.cyl(U.murk, x, HF + 0.47, z, 0.6, 0.6, 2.3, 32);
    K.cyl(M.steel, x, HF + 3.0, z, 0.78, 0.74, 0.32, 32);
    K.cyl(M.dark, x, HF + 3.32, z, 0.5, 0.4, 0.12, 24);
    for (const dx of [-0.25, 0.2]) K.cyl(M.black, x + dx, HF + 3.4, z + 0.1, 0.05, 0.05, HC - HF - 3.4, 10);
    K.add(U.amber, new THREE.SphereGeometry(0.05, 12, 8), x + 0.5, HF + 3.36, z - 0.3);
    K.plane(M.signs, 0.62, 0.23, x, HF + 3.16, z - 0.765, [0, Math.PI, 0], SIGN.subject);
    // control console
    K.cube(M.dark, x + 1.05, HF + 0.55, z - 0.35, 0.5, 1.1, 0.35, -0.5);
    K.plane(U.screen, 0.36, 0.2, x + 1.05 - 0.09, HF + 1.0, z - 0.52, [0, Math.PI - 0.5, 0], SCREEN.vitals, 1024, 512);
  }
  // the thing inside (bobs slowly), with feeding tubes to the lid
  const specimen = new THREE.Group();
  {
    // body parts and feeding tubes, each merged into one mesh
    const cap = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 10);
    const parts = [], tubes = [];
    const add = (geo, x, y, z, rx = 0, rz = 0) => {
      _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, 0, rz)), _s.set(1, 1, 1));
      parts.push(geo.applyMatrix4(_m));
    };
    add(cap(0.15, 0.36), 0, 0.2, 0, 0.12);
    add(new THREE.SphereGeometry(0.11, 14, 10), 0, 0.62, 0.05);
    add(cap(0.05, 0.42), 0.21, 0.12, 0.05, 0.4, 0.3);
    add(cap(0.05, 0.42), -0.21, 0.1, 0.02, 0.25, -0.25);
    add(cap(0.07, 0.45), 0.1, -0.38, 0.12, -0.5, 0.08);
    add(cap(0.065, 0.45), -0.1, -0.4, 0.05, -0.2, -0.06);
    add(cap(0.06, 0.4), 0.11, -0.8, 0.05, 0.6);
    add(cap(0.055, 0.4), -0.12, -0.84, -0.02, 0.3);
    for (const [x, z] of [[0.06, -0.12], [-0.05, -0.1], [0, 0.02]]) tubes.push(new THREE.CylinderGeometry(0.008, 0.008, 1.9, 6).translate(x, 1.4, z));
    const strip = (g) => (g.deleteAttribute('uv'), g);
    specimen.add(new THREE.Mesh(mergeGeometries(parts.map(strip)), U.skin));
    specimen.add(new THREE.Mesh(mergeGeometries(tubes.map(strip)), new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.5 })));
    specimen.position.set(tank.x, HF + 1.62, tank.z);
    specimen.rotation.y = 0.5;
    specimen.traverse((o) => (o.castShadow = false));
    dyn.add(specimen);
  }
  const bubbleN = 26;
  const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xc8ffb8, transparent: true, opacity: 0.5, depthWrite: false }), bubbleN);
  bubbles.renderOrder = -1;
  bubbles.frustumCulled = false;
  const bub = Array.from({ length: bubbleN }, () => ({ a: rnd() * Math.PI * 2, r: rnd() * 0.5, y: rnd() * 2.2, v: 0.25 + rnd() * 0.4, s: 0.008 + rnd() * 0.018 }));
  dyn.add(bubbles);

  // ------------------------------------------------ hall benches
  const bench = (x0, x1, z0, z1, shelf) => {
    K.box(M.white, x0, HF + 0.1, z0, x1, HF + 0.86, z1, { faces: ['nz', 'pz', 'px', 'nx'] });
    K.box(M.dark, x0 + 0.03, HF, z0 + 0.05, x1 - 0.03, HF + 0.1, z1 - 0.05, { faces: ['nz', 'pz'] });
    K.box(M.top, x0 - 0.02, HF + 0.86, z0 - 0.02, x1 + 0.02, HF + 0.92, z1 + 0.02);
    if (shelf) {
      const zc = (z0 + z1) / 2;
      for (const x of [x0 + 0.05, x1 - 0.05]) K.cyl(M.steel, x, HF + 0.92, zc, 0.02, 0.02, 1.1, 8);
      for (const y of [1.4, 1.8]) {
        K.box(M.white, x0, HF + y - 0.025, zc - 0.15, x1, HF + y, zc + 0.15);
        for (let x = x0 + 0.15; x < x1 - 0.1; x += 0.13 + rnd() * 0.1) {
          const h = 0.1 + rnd() * 0.1, r = 0.025 + rnd() * 0.02, z = zc + (rnd() - 0.5) * 0.12;
          K.add(rnd() < 0.3 ? M.amber : U.glass, bottleShape(r, h), x, HF + y, z);
          if (rnd() < 0.7) K.add(liquids[Math.floor(rnd() * liquids.length)], bottleShape(r * 0.9, h * (0.3 + rnd() * 0.4)), x, HF + y + 0.002, z);
          K.cyl(M.black, x, HF + y + h, z, r * 0.4, r * 0.4, 0.02, 8);
        }
      }
    }
    // glassware on the top
    for (let x = x0 + 0.25; x < x1 - 0.2; x += 0.35 + rnd() * 0.4) {
      const z = z0 + 0.2 + rnd() * (z1 - z0 - 0.4);
      const kind = rnd();
      const liq = liquids[Math.floor(rnd() * liquids.length)];
      if (kind < 0.4) {
        K.add(U.glass, erlenmeyer(), x, HF + 0.92, z);
        K.add(liq, erlenLiquid(), x, HF + 0.92, z, null, [1, 0.6 + rnd() * 0.5, 1]);
      } else if (kind < 0.7) {
        const r = 0.035 + rnd() * 0.02, h = 0.08 + rnd() * 0.05;
        K.cyl(U.glass, x, HF + 0.92, z, r, r, h, 16, null, true);
        K.cyl(liq, x, HF + 0.922, z, r * 0.94, r * 0.94, h * (0.3 + rnd() * 0.5), 14);
      } else {
        K.cube(M.white, x, HF + 0.95, z, 0.2, 0.06, 0.06);
        for (let k = 0; k < 6; k++) {
          K.add(U.glass, testTube(), x - 0.075 + k * 0.03, HF + 0.93, z);
          K.cyl(liquids[(k + 1) % liquids.length], x - 0.075 + k * 0.03, HF + 0.933, z, 0.0068, 0.0068, 0.03 + (k % 3) * 0.01, 8);
        }
      }
    }
  };
  bench(-6.9, -2.7, 12.9, 13.8, true);
  bench(-1.9, 0.8, 13.3, 14.2, false);
  // monitors on the benches, facing the gallery
  for (const [x, z, scr] of [[-6.2, 13.55, SCREEN.seq], [-3.4, 13.55, SCREEN.helix], [-0.6, 13.95, SCREEN.spectrum]]) {
    K.cube(M.dark, x, HF + 0.93, z, 0.18, 0.02, 0.14);
    K.cube(M.dark, x, HF + 1.05, z + 0.02, 0.04, 0.22, 0.03);
    K.cube(M.black, x, HF + 1.24, z, 0.54, 0.33, 0.03);
    K.plane(U.screen, 0.5, 0.29, x, HF + 1.24, z - 0.016, [0, Math.PI, 0], scr, 1024, 512);
  }
  // hot plate with a round-bottom flask on bench 2
  K.cube(M.white, 0.2, HF + 0.96, 13.6, 0.2, 0.08, 0.22);
  K.cyl(U.red, 0.2, HF + 1.0, 13.6, 0.07, 0.07, 0.004, 16);
  K.add(U.glass, new THREE.SphereGeometry(0.07, 16, 12), 0.2, HF + 1.08, 13.6);
  K.add(U.amber, new THREE.SphereGeometry(0.062, 14, 10, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), 0.2, HF + 1.08, 13.6);
  K.cyl(U.glass, 0.2, HF + 1.14, 13.6, 0.016, 0.016, 0.12, 10, null, true);

  // fume hoods on the west wall
  for (const z0 of [12.3, 13.8]) {
    const z1 = z0 + 1.4, x0 = X0, x1 = X0 + 0.85, zc = (z0 + z1) / 2;
    K.box(M.white, x0, HF + 0.1, z0, x1, HF + 0.86, z1, { faces: ['px', 'nz', 'pz'] });
    K.box(M.top, x0, HF + 0.86, z0, x1 + 0.02, HF + 0.92, z1);
    K.box(M.white, x0, HF + 0.92, z0 - 0.04, x1, HF + 2.45, z0, { faces: ['px', 'nz', 'pz'] });
    K.box(M.white, x0, HF + 0.92, z1, x1, HF + 2.45, z1 + 0.04, { faces: ['px', 'nz', 'pz'] });
    K.box(M.white, x0, HF + 2.05, z0, x1, HF + 2.45, z1, { faces: ['px', 'ny', 'py'] });
    K.box(M.white, x0, HF + 0.92, z0, x0 + 0.05, HF + 2.05, z1, { faces: ['px'] });
    K.box(U.panel, x0 + 0.1, HF + 2.03, z0 + 0.1, x1 - 0.1, HF + 2.05, z1 - 0.1, { faces: ['ny'] });
    K.box(U.glass, x1 - 0.02, HF + 1.2, z0, x1, HF + 2.05, z1, { faces: ['px'] });
    K.box(M.steel, x1 - 0.03, HF + 1.18, z0, x1 + 0.01, HF + 1.22, z1);
    K.cyl(M.steel, x0 + 0.4, HF + 2.45, zc, 0.14, 0.14, HC - HF - 2.45, 16);
    K.add(U.glass, erlenmeyer(), x0 + 0.4, HF + 0.92, zc - 0.3);
    K.add(U.magenta, erlenLiquid(), x0 + 0.4, HF + 0.92, zc - 0.3);
    K.cyl(U.glass, x0 + 0.45, HF + 0.92, zc + 0.25, 0.05, 0.05, 0.12, 16, null, true);
    K.cyl(U.green, x0 + 0.45, HF + 0.922, zc + 0.25, 0.047, 0.047, 0.06, 14);
    lights.push({ x: x0 + 0.45, y: HF + 1.95, z: zc, i: 0.35, r: 0.8, c: cool, dir: DOWN });
  }
  // ULT freezers on the east wall
  for (const z0 of [11.9, 12.75]) {
    K.box(M.white, X1 - 0.8, HF, z0, X1, HF + 1.95, z0 + 0.8, { faces: ['nx', 'py', 'nz', 'pz'] });
    K.cube(M.black, X1 - 0.805, HF + 1.72, z0 + 0.4, 0.01, 0.16, 0.3);
    K.plane(M.signs, 0.14, 0.07, X1 - 0.812, HF + 1.72, z0 + 0.4, [0, -Math.PI / 2, 0], SIGN.freezer);
    K.cube(M.steel, X1 - 0.83, HF + 1.1, z0 + 0.12, 0.03, 0.5, 0.03);
  }
  // shelving on the east wall
  for (const z0 of [14.3, 16.55]) {
    const z1 = z0 + 2.15, x0 = X1 - 0.5, x1 = X1;
    for (const z of [z0, z1]) for (const x of [x0 + 0.02, x1 - 0.03]) K.cyl(M.steel, x, HF, z, 0.015, 0.015, 2.1, 8);
    for (const y of [0.15, 0.6, 1.05, 1.5, 1.95]) {
      K.box(M.steel, x0, HF + y - 0.02, z0, x1, HF + y, z1, { faces: ['py', 'ny', 'nx'] });
      for (let z = z0 + 0.12; z < z1 - 0.1; z += 0.12 + rnd() * 0.14) {
        const x = x0 + 0.1 + rnd() * 0.25, kind = rnd();
        if (kind < 0.3) K.cube(rnd() < 0.5 ? M.white : M.card, x, HF + y + 0.09, z + 0.05, 0.22, 0.18, 0.2, rnd() * 0.3);
        else if (kind < 0.45) K.cyl(rnd() < 0.5 ? M.yellow : M.blue, x, HF + y, z, 0.07, 0.07, 0.25, 14);
        else {
          const h = 0.12 + rnd() * 0.14, r = 0.03 + rnd() * 0.025;
          K.add(rnd() < 0.5 ? M.amber : M.white, bottleShape(r, h), x, HF + y, z);
          K.cyl(rnd() < 0.5 ? M.red : M.black, x, HF + y + h, z, r * 0.42, r * 0.42, 0.022, 8);
        }
      }
    }
  }
  // big wall markings
  K.plane(M.signs, 3.2, 0.5, X0 + 0.005, -2.3, 9.4, [0, Math.PI / 2, 0], SIGN.stencil);
  K.plane(M.signs, 1.4, 0.875, X1 - 0.005, -2.3, 17.6, [0, -Math.PI / 2, 0], SIGN.b2);
  K.plane(M.signs, 0.42, 0.42, X0 + 0.005, -3.4, 7.7, [0, Math.PI / 2, 0], SIGN.bio);
  // far door on the west wall with a lit corridor behind its windows
  {
    const z0 = 16.6, z1 = 18.2, zc = (z0 + z1) / 2;
    K.box(M.steel, X0, HF, z0 - 0.08, X0 + 0.06, HF + 2.48, z1 + 0.08, { faces: ['px'] });
    for (const [a, b] of [[z0, zc - 0.01], [zc + 0.01, z1]]) {
      K.box(M.white, X0 + 0.06, HF, a, X0 + 0.08, HF + 2.4, b, { faces: ['px'] });
      K.box(U.panel, X0 + 0.081, HF + 1.5, (a + b) / 2 - 0.13, X0 + 0.082, HF + 1.95, (a + b) / 2 + 0.13, { faces: ['px'] });
      K.cube(M.steel, X0 + 0.11, HF + 1.05, zc + (a < zc ? -0.12 : 0.12), 0.03, 0.03, 0.2);
    }
    K.plane(M.signs, 0.9, 0.225, X0 + 0.01, HF + 2.72, zc, [0, Math.PI / 2, 0], SIGN.corridor);
    K.add(U.red, new THREE.SphereGeometry(0.06, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), X0 + 0.1, HF + 3.0, z1 + 0.25);
  }
  // emergency shower + eyewash at the foot of the stairs
  {
    const x = 0.45, z = 11.9;
    K.cyl(M.green, x, HF, z, 0.035, 0.035, 2.3, 10);
    K.rod(M.green, V(x, HF + 2.3, z), V(x - 0.4, HF + 2.3, z), 0.03);
    K.add(M.steel, new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), x - 0.4, HF + 2.2, z, [Math.PI, 0, 0]);
    K.rod(M.steel, V(x - 0.4, HF + 2.2, z), V(x - 0.4, HF + 1.6, z), 0.006, 6);
    K.add(M.green, new THREE.TorusGeometry(0.05, 0.008, 6, 3), x - 0.4, HF + 1.55, z);
    K.add(M.steel, new THREE.SphereGeometry(0.14, 16, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), x, HF + 1.0, z - 0.12);
  }
  // cable trays, a duct and pipes under the hall ceiling
  for (const x of [-7.0, -2.6]) {
    const y = HC - 0.25;
    K.box(M.steel, x - 0.15, y, GZ + 0.3, x + 0.15, y + 0.015, HZ - 0.3, { faces: ['py', 'ny'] });
    for (const s of [-1, 1]) K.box(M.steel, x + s * 0.15 - 0.005, y, GZ + 0.3, x + s * 0.15 + 0.005, y + 0.07, HZ - 0.3, { faces: ['px', 'nx'] });
    for (const [dx, m] of [[-0.08, M.black], [0.0, M.blue], [0.07, M.black]]) K.rod(m, V(x + dx, y + 0.035, GZ + 0.3), V(x + dx, y + 0.035, HZ - 0.3), 0.018, 6);
    for (let z = GZ + 1; z < HZ - 0.5; z += 2.2) for (const s of [-1, 1]) K.rod(M.dark, V(x + s * 0.16, y, z), V(x + s * 0.16, HC, z), 0.006, 4);
  }
  K.box(M.steel, -10.95, HC - 0.4, GZ + 0.2, -10.45, HC, HZ - 0.2, { faces: ['ny', 'px', 'nx'], seg: 1.5 });
  for (let z = GZ + 1.5; z < HZ - 1; z += 3) K.box(M.black, -10.85, HC - 0.405, z, -10.55, HC - 0.4, z + 0.4, { faces: ['ny'] });
  for (const [y, r, m] of [[HC - 0.12, 0.05, M.blue], [HC - 0.24, 0.04, M.green], [HC - 0.36, 0.06, M.steel]]) {
    K.rod(m, V(X0, y, 7.25), V(X1, y, 7.25), r, 12);
  }
  // bins in the hall
  for (const [x, z] of [[-2.2, 12.6], [1.2, 14.8]]) {
    K.cube(M.red, x, HF + 0.3, z, 0.42, 0.6, 0.36);
    K.cube(M.dark, x, HF + 0.62, z, 0.44, 0.05, 0.38);
    K.plane(M.signs, 0.22, 0.22, x, HF + 0.36, z - 0.182, [0, Math.PI, 0], SIGN.bio);
  }

  // ------------------------------------------------ Nadja's moving props
  const plastic = new THREE.MeshStandardMaterial({ color: 0xdcdfe2, roughness: 0.45 });
  const darkPlastic = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.5 });
  const mk = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    if (mat.transparent) m.renderOrder = -1;
    parent.add(m);
    return m;
  };
  const vessel = (kind, x, z) => {
    const o = new THREE.Group();
    o.position.set(x, T, z);
    let liquid, lip;
    if (kind === 'flask') {
      mk(erlenmeyer(), U.glass, o).castShadow = false;
      liquid = mk(erlenLiquid(), U.blue, o);
      lip = V(0, 0.153, 0);
    } else {
      const g = new THREE.CylinderGeometry(0.036, 0.034, 0.1, 18, 1, true);
      g.translate(0, 0.05, 0);
      mk(g, U.glass, o).castShadow = false;
      mk(new THREE.CircleGeometry(0.034, 18).rotateX(-Math.PI / 2).translate(0, 0.001, 0), U.glass, o);
      const lg = new THREE.CylinderGeometry(0.033, 0.033, 0.07, 16);
      lg.translate(0, 0.035, 0);
      liquid = mk(lg, U.blue, o);
      liquid.position.y = 0.002;
      lip = V(0, 0.1, 0);
    }
    liquid.castShadow = false;
    dyn.add(o);
    return { obj: o, liquid, lip, level: 0.5 };
  };
  const flask = vessel('flask', -4.44, 4.78);
  flask.level = 0.8;
  const beaker = vessel('beaker', -4.7, 4.79);
  beaker.level = 0.3;
  // micropipette hanging in its stand (origin = the grip, axis +y)
  const pipette = new THREE.Group();
  {
    mk(new THREE.CylinderGeometry(0.012, 0.01, 0.13, 12), plastic, pipette);
    mk(new THREE.CylinderGeometry(0.005, 0.005, 0.035, 8), darkPlastic, pipette, 0, 0.08, 0);
    mk(new THREE.SphereGeometry(0.009, 10, 6), U.blue, pipette, 0, 0.1, 0).castShadow = false;
    mk(new THREE.BoxGeometry(0.012, 0.03, 0.02), plastic, pipette, 0, 0.045, 0.015);
    mk(new THREE.CylinderGeometry(0.004, 0.0012, 0.05, 8).translate(0, -0.09, 0), new THREE.MeshStandardMaterial({ color: 0xf2e9c8, roughness: 0.3 }), pipette);
    pipette.position.set(-4.26, T + 0.15, 4.72);
    dyn.add(pipette);
    K.cube(M.white, -4.26, T + 0.005, 4.7, 0.08, 0.01, 0.08);
    K.cube(M.white, -4.26, T + 0.12, 4.67, 0.02, 0.24, 0.02);
    K.cube(M.white, -4.26, T + 0.215, 4.695, 0.03, 0.01, 0.05);
  }
  const tip = V(0, -0.115, 0); // pipette tip in its own frame
  // clipboard with a paper and a pen (origin = board center, +y = paper normal, +z = the clip end)
  const clipboard = new THREE.Group();
  const pen = new THREE.Group();
  {
    mk(new THREE.BoxGeometry(0.23, 0.006, 0.31), new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.8 }), clipboard);
    const paper = atlasPlane(0.21, 0.27, SIGN.paper);
    paper.rotateX(-Math.PI / 2);
    paper.rotateY(Math.PI); // text reads from the clip end toward her
    mk(paper, new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }), clipboard, 0, 0.0035, -0.01);
    mk(new THREE.BoxGeometry(0.1, 0.012, 0.035), new THREE.MeshStandardMaterial({ color: 0xb0b6bb, metalness: 0.8, roughness: 0.3 }), clipboard, 0, 0.007, 0.135);
    clipboard.position.set(-4.87, T + 0.003, 4.72);
    clipboard.rotation.y = Math.PI + 0.12;
    dyn.add(clipboard);
    mk(new THREE.CylinderGeometry(0.0045, 0.0045, 0.13, 8), darkPlastic, pen);
    mk(new THREE.ConeGeometry(0.0045, 0.012, 8).rotateX(Math.PI).translate(0, -0.071, 0), new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.9, roughness: 0.3 }), pen);
    mk(new THREE.CylinderGeometry(0.0052, 0.0052, 0.02, 8), U.blue, pen, 0, 0.055, 0);
    pen.position.set(0.075, 0.012, -0.02);
    pen.rotation.set(Math.PI / 2, 0, 0.2);
    clipboard.add(pen);
  }
  // gas turret handwheel (turns while she works it)
  const wheel = new THREE.Group();
  {
    const red = new THREE.MeshStandardMaterial({ color: 0xa11d19, roughness: 0.5 });
    const g = [new THREE.TorusGeometry(0.03, 0.005, 6, 18).rotateX(Math.PI / 2)];
    for (const a of [0, Math.PI / 3, (2 * Math.PI) / 3]) g.push(new THREE.BoxGeometry(0.06, 0.004, 0.005).rotateY(a));
    mk(mergeGeometries(g.map((x) => (x.deleteAttribute('uv'), x))), red, wheel);
    wheel.position.set(turret.x, T + 0.245, turret.z);
    dyn.add(wheel);
  }
  const stream = mk(new THREE.CylinderGeometry(0.0035, 0.0025, 1, 6).translate(0, -0.5, 0), U.blue, dyn);
  stream.visible = false;
  stream.castShadow = false;

  K.build(group, makeBaker(lights, occluders));

  // ------------------------------------------------ the yard over the hall: a mud cap over the slab's hole
  // Same material / bucket, UVs, surface and collider top as the slab; `shade` cancels the box's hashed
  // tint so it matches the slab row it replaces ([-75, 75] x [4, 75]). Under the house (z < 7.9) the
  // floor covers the hole.
  {
    const [x0, x1, , z1] = LAB.mudHole, z0 = 7.9;
    const tint = (x, y, z) => 0.9 + 0.12 * hash3(x, y, z);
    B.box(x0, -0.8, z0, x1, -0.5, z1, { mat: 'mud', surface: SURF.mud, grime: 0, skip: ['ny'], castShadow: false, shade: tint(-75, -1.5, 4) / tint(x0, -0.8, z0) });
  }

  // ------------------------------------------------ basement side: vault door, armored window, keypad
  const S = B.staticGroup;
  const add = (geo, mat, x, y, z, r = null, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = true;
    if (opts.noBatch) m.userData.noBatch = true;
    if (opts.order != null) m.renderOrder = opts.order;
    S.add(m);
    return m;
  };
  const boxAt = (mat, x0, y0, z0, x1, y1, z1, opts) => add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, null, opts);
  // world-UV boxes for the textured parts (stripes / paint continue across pieces)
  const wbox = (mat, x0, y0, z0, x1, y1, z1, mpr) => {
    const m = new THREE.Mesh(boxGeometry(x0, y0, z0, x1, y1, z1, { mpr }), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    S.add(m);
    return m;
  };
  const paint = new THREE.MeshStandardMaterial({ map: doorPaintTex(), color: 0xffffff, metalness: 0.35, roughness: 0.55 });
  const frameMat = new THREE.MeshStandardMaterial({ map: texOf(hazardCanvas(1, 32), true), roughness: 0.6, metalness: 0.2 });
  const steelB = new THREE.MeshStandardMaterial({ color: 0x8f979d, metalness: 0.85, roughness: 0.38 });
  const darkB = new THREE.MeshStandardMaterial({ color: 0x33393e, metalness: 0.6, roughness: 0.45 });
  const redB = new THREE.MeshStandardMaterial({ color: 0x8a1712, metalness: 0.3, roughness: 0.5 });
  const signB = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.6 });
  const d = LAB.door, w = LAB.window;

  // door frame: heavy hazard-striped steel, 0.32 wide, standing 0.19 off the wall
  const fz0 = 3.66;
  wbox(frameMat, d.x0 - 0.32, FB, fz0, d.x0, d.y1 + 0.32, BZ, 0.5);
  wbox(frameMat, d.x1, FB, fz0, d.x1 + 0.32, d.y1 + 0.32, BZ, 0.5);
  wbox(frameMat, d.x0, d.y1, fz0, d.x1, d.y1 + 0.32, BZ, 0.5);
  for (const [a, b] of [[d.x0, d.x0 + 0.02], [d.x1 - 0.02, d.x1]]) boxAt(darkB, a, FB, fz0, b, d.y1, WZ);
  boxAt(darkB, d.x0, d.y1 - 0.02, fz0, d.x1, d.y1, WZ);
  // leaf, recessed 10 cm behind the frame face
  const lz = 3.76;
  wbox(paint, d.x0 + 0.02, FB + 0.01, lz, d.x1 - 0.02, d.y1 - 0.02, 4.1, 1.5);
  const lx0 = d.x0 + 0.02, lx1 = d.x1 - 0.02, ly0 = FB + 0.01, ly1 = d.y1 - 0.02;
  const lcx = (lx0 + lx1) / 2;
  // perimeter flat bar and stiffeners
  wbox(paint, lx0, ly0, lz - 0.035, lx0 + 0.08, ly1, lz, 1.5);
  wbox(paint, lx1 - 0.08, ly0, lz - 0.035, lx1, ly1, lz, 1.5);
  wbox(paint, lx0 + 0.08, ly1 - 0.08, lz - 0.035, lx1 - 0.08, ly1, lz, 1.5);
  wbox(paint, lx0 + 0.08, ly0, lz - 0.035, lx1 - 0.08, ly0 + 0.1, lz, 1.5);
  for (const y of [FB + 0.5, FB + 1.52]) wbox(paint, lx0 + 0.08, y - 0.05, lz - 0.04, lx1 - 0.08, y + 0.05, lz, 1.5);
  // rivets along the bars
  const rivet = new THREE.SphereGeometry(0.011, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
  const rivets = [];
  for (let y = ly0 + 0.1; y < ly1 - 0.05; y += 0.16) for (const x of [lx0 + 0.04, lx1 - 0.04]) rivets.push([x, y, lz - 0.035]);
  for (let x = lx0 + 0.16; x < lx1 - 0.1; x += 0.16) for (const y of [ly1 - 0.04, ly0 + 0.05, FB + 0.5, FB + 1.52]) rivets.push([x, y, lz - 0.04]);
  for (let y = FB + 0.12; y < d.y1 + 0.25; y += 0.2) for (const x of [d.x0 - 0.27, d.x1 + 0.27]) rivets.push([x, y, fz0]);
  for (const [x, y, z] of rivets) add(rivet, steelB, x, y, z, [-Math.PI / 2, 0, 0], { cast: false });
  // hinges on the left, bolts on the right
  for (const y of [FB + 0.35, FB + 1.1, FB + 1.85]) {
    add(new THREE.CylinderGeometry(0.065, 0.065, 0.32, 16), steelB, d.x0 - 0.08, y, fz0 - 0.07);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 16), darkB, d.x0 - 0.08, y + 0.175, fz0 - 0.07);
    boxAt(steelB, d.x0 - 0.08, y - 0.1, lz - 0.075, d.x0 + 0.3, y + 0.1, lz - 0.035);
    for (const x of [d.x0 + 0.08, d.x0 + 0.22]) add(new THREE.CylinderGeometry(0.014, 0.014, 0.012, 6), darkB, x, y, lz - 0.08, [Math.PI / 2, 0, 0], { cast: false });
  }
  for (const y of [FB + 0.4, FB + 1.1, FB + 1.8]) {
    add(new THREE.CylinderGeometry(0.038, 0.038, 0.34, 14), steelB, lx1 - 0.08, y, lz - 0.075, [0, 0, Math.PI / 2]);
    boxAt(darkB, lx1 - 0.22, y - 0.06, lz - 0.05, lx1 - 0.19, y + 0.06, lz - 0.035);
  }
  // locking wheel: hub plate, rim, spokes, grips
  const wy = FB + 1.05;
  add(new THREE.CylinderGeometry(0.24, 0.24, 0.035, 32), paint, lcx, wy, lz - 0.055, [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.075, 0.09, 0.14, 20), steelB, lcx, wy, lz - 0.1, [Math.PI / 2, 0, 0]);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), redB, lcx, wy, lz - 0.18, [Math.PI / 2, 0, 0]);
  add(new THREE.TorusGeometry(0.27, 0.024, 10, 40), steelB, lcx, wy, lz - 0.16);
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + Math.PI / 4;
    add(new THREE.CylinderGeometry(0.014, 0.014, 0.27, 8), steelB, lcx + Math.cos(a) * 0.135, wy + Math.sin(a) * 0.135, lz - 0.16, [0, 0, a - Math.PI / 2]);
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10), redB, lcx + Math.cos(a) * 0.27, wy + Math.sin(a) * 0.27, lz - 0.2, [Math.PI / 2, 0, 0]);
  }
  // signs: restricted-area plate on the leaf, a biohazard triangle beside the door
  add(atlasPlane(0.64, 0.45, SIGN.door), signB, lcx, FB + 1.9, lz - 0.042, [0, Math.PI, 0], { cast: false });
  add(atlasPlane(0.34, 0.34, SIGN.bio), signB, d.x1 + 0.72, FB + 1.75, BZ - 0.004, [0, Math.PI, 0], { cast: false });
  // floor stripes in front of the door
  const floorPaint = new THREE.MeshStandardMaterial({ map: texOf(hazardCanvas(1, 33, true), true), transparent: true, roughness: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  {
    const g = boxGeometry(d.x0 - 0.32, FB, 3.1, d.x1 + 0.32, FB + 0.001, fz0, { faces: ['py'], mpr: 0.5 });
    const m = new THREE.Mesh(g, floorPaint);
    m.receiveShadow = true;
    m.renderOrder = 1;
    m.userData.noBatch = true;
    S.add(m);
  }
  // keypad between the window and the door, with its conduit to the ceiling
  const kx = (w.x1 + 0.25 + d.x0 - 0.32) / 2, ky = FB + 1.28;
  boxAt(darkB, kx - 0.075, ky - 0.12, BZ - 0.045, kx + 0.075, ky + 0.12, BZ);
  add(atlasPlane(0.13, 0.2, SIGN.keypad), signB, kx, ky, BZ - 0.0465, [0, Math.PI, 0], { cast: false });
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.35, 0.2) });
  add(new THREE.SphereGeometry(0.008, 8, 6), ledMat, kx + 0.05, ky + 0.1, BZ - 0.047, null, { cast: false, noBatch: true });
  add(new THREE.CylinderGeometry(0.012, 0.012, -0.25 - (ky + 0.12), 8), steelB, kx, (ky + 0.12 - 0.25) / 2, BZ - 0.02, null, { cast: false });

  // window: steel frame 0.25 wide standing 0.13 off the wall, glass stops, bolts; one 4 x 1.5 m pane
  const wf = 0.25, wz0 = 3.72, gz0 = 3.93, gz1 = 4.07;
  const frameW = new THREE.MeshStandardMaterial({ color: 0x3b4247, metalness: 0.55, roughness: 0.5 });
  boxAt(frameW, w.x0 - wf, w.y1, wz0, w.x1 + wf, w.y1 + wf - 0.02, BZ);
  boxAt(frameW, w.x0 - wf, w.y0 - wf + 0.02, wz0, w.x1 + wf, w.y0, BZ);
  boxAt(frameW, w.x0 - wf, w.y0, wz0, w.x0, w.y1, BZ);
  boxAt(frameW, w.x1, w.y0, wz0, w.x1 + wf, w.y1, BZ);
  const panes = [[w.x0, w.x1]];
  for (const [a, b] of panes) {
    for (const [z0, z1] of [[BZ, gz0], [gz1, WZ]]) {
      boxAt(frameW, a, w.y0, z0, b, w.y0 + 0.03, z1, { cast: false });
      boxAt(frameW, a, w.y1 - 0.03, z0, b, w.y1, z1, { cast: false });
      boxAt(frameW, a, w.y0 + 0.03, z0, a + 0.03, w.y1 - 0.03, z1, { cast: false });
      boxAt(frameW, b - 0.03, w.y0 + 0.03, z0, b, w.y1 - 0.03, z1, { cast: false });
    }
  }
  const bolt = new THREE.CylinderGeometry(0.017, 0.017, 0.014, 6);
  const bolts = [];
  for (let x = w.x0 - wf / 2; x <= w.x1 + wf / 2 + 0.01; x += (w.x1 - w.x0 + wf) / 14) for (const y of [w.y1 + wf / 2 - 0.01, w.y0 - wf / 2 + 0.01]) bolts.push([x, y]);
  for (let y = w.y0 + 0.15; y < w.y1 - 0.1; y += 0.3) for (const x of [w.x0 - wf / 2, w.x1 + wf / 2]) bolts.push([x, y]);
  for (const [x, y] of bolts) add(bolt, steelB, x, y, wz0 - 0.006, [Math.PI / 2, 0, 0], { cast: false });
  // the glass: 14 cm thick panes (green edges), a warning sticker, an additive reflection layer
  const glassFaces = panes.map((_, i) => new THREE.MeshPhysicalMaterial({ map: texOf(glassCanvas(51 + i, 1024, 384)), color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.6 }));
  const glassEdge = new THREE.MeshStandardMaterial({ color: 0x1f4a3c, roughness: 0.08, metalness: 0.1 });
  const reflect = new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 1, roughness: 0.14, envMapIntensity: 0.45, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  panes.forEach(([a, b], i) => {
    const pw = b - a, ph = w.y1 - w.y0;
    add(new THREE.BoxGeometry(pw, ph, gz1 - gz0), [glassEdge, glassEdge, glassEdge, glassEdge, glassFaces[i], glassFaces[i]], (a + b) / 2, (w.y0 + w.y1) / 2, (gz0 + gz1) / 2, null, { cast: false, noBatch: true, order: 0.2 });
    add(new THREE.PlaneGeometry(pw, ph), reflect, (a + b) / 2, (w.y0 + w.y1) / 2, gz0 - 0.002, [0, Math.PI, 0], { cast: false, noBatch: true, order: 0.4 });
  });
  add(atlasPlane(0.27, 0.101, SIGN.glass), signB, w.x0 + 0.2, w.y0 + 0.1, gz0 - 0.003, [0, Math.PI, 0], { cast: false });

  // colliders: panes (glass: bullets chip it), frames and door (metal)
  const NI = FLAG_NAVIGNORE;
  for (const [a, b] of panes) world.add(a, w.y0, gz0, b, w.y1, WZ, SURF.glass, NI, 'labGlass');
  world.add(w.x0 - wf, w.y1, wz0, w.x1 + wf, w.y1 + wf, WZ, SURF.metal, NI, 'labFrame');
  world.add(w.x0 - wf, w.y0 - wf, wz0, w.x1 + wf, w.y0, WZ, SURF.metal, NI, 'labFrame');
  world.add(w.x0 - wf, w.y0, wz0, w.x0 + 0.03, w.y1, gz0, SURF.metal, NI, 'labFrame');
  world.add(w.x1 - 0.03, w.y0, wz0, w.x1 + wf, w.y1, gz0, SURF.metal, NI, 'labFrame');
  for (const [a, b] of panes) {
    world.add(a, w.y0, BZ, b, w.y0 + 0.03, gz0, SURF.metal, NI, 'labFrame');
    world.add(a, w.y1 - 0.03, BZ, b, w.y1, gz0, SURF.metal, NI, 'labFrame');
  }
  world.add(d.x0 - 0.32, FB, fz0, d.x1 + 0.32, d.y1 + 0.32, WZ, SURF.metal, 0, 'labDoor');

  // ------------------------------------------------ lamps: one real spot over the counter
  // Pooled like the house lamps (lighting.js); aimed 40° away from the glass so its cone never reaches
  // the basement floor through the wall, and without the hanging-lamp glow / cone / motes.
  const aimA = 0.7;
  const spot = { pos: V(-4.6, GC - 0.15, 4.72), aim: V(0, -Math.cos(aimA), Math.sin(aimA)).multiplyScalar(3), level: 0, color: 0xe6f0ff, intensity: 5, angle: 0.72, distance: 7, flicker: 0, spot: true, fx: false, mains: false }; // own emergency power (the generator doesn't cut it)
  lamps.push(spot);

  // ------------------------------------------------ runtime
  const work = {
    top: T,
    floor: FB,
    edge: 4.92, // z of the counter top's near (her) edge
    stations: { C: V(-4.6, FB, 5.06), L: V(-5.35, FB, 5.06), R: V(-3.85, FB, 5.06) },
    flask,
    beaker,
    pipette: { obj: pipette, tip },
    clipboard: { obj: clipboard },
    pen: { obj: pen },
    rack: rack.tubes,
    scope: { eye: V(scope.x, T + 0.43, scope.z + 0.1), knobL: V(scope.x - 0.062, T + 0.1, scope.z - 0.09), knobR: V(scope.x + 0.062, T + 0.1, scope.z - 0.09), slide: V(scope.x, T + 0.16, scope.z + 0.03) },
    monitor: { screen: mon.screen, keys: V(-3.88, T + 0.02, 4.82), mouse: V(-3.62, T + 0.02, 4.82) },
    valve: { wheel, top: V(turret.x, T + 0.245, turret.z), gauge: V(turret.x, T + 0.12, turret.z - 0.03) },
    light: V(-4.6, GC - 0.05, 5.3),
    glass: V((w.x0 + w.x1) / 2, -1.55, BZ),
    stream,
  };
  let tech = null;
  let active = true; // drawn at load so the shaders compile; update() decides from then on
  let t = 0, blinkT = 0;
  const _m4 = new THREE.Matrix4(), _pp = new THREE.Vector3(), _ss = new THREE.Vector3(), _qq = new THREE.Quaternion();
  const _cam = new THREE.Vector3();
  /** the camera is down in the basement (or low in the cellar stairwell) */
  const camInBasement = (c) => c.y < -0.2 && c.x > -17.5 && c.x < 2.6 && c.z > -8.3 && c.z < 3.9;
  const lab = {
    group,
    work,
    get tech() {
      return tech;
    },
    /** create Nadja once the GLBs are loaded: create = actors/labTech.js createLabTech (passed in by
     * game.js, so the level doesn't import the actor modules) */
    spawnTech(create) {
      if (!tech) tech = create(dyn, work);
      return tech;
    },
    /** a bullet chipped the glass at world point p */
    onGlassHit(p) {
      tech?.startle(p);
    },
    update(dt, game) {
      const cam = game?.camera?.position;
      const on = !!cam && camInBasement(cam);
      if (on !== active) {
        active = on;
        group.visible = on;
        spot.hidden = !on; // gives up its lamp slot (lighting.js) while nobody can see the lab
      }
      // the keypad LED: slow blink, a double flash now and then
      blinkT += dt;
      const ph = blinkT % 3.2;
      ledMat.color.setRGB(ph < 0.12 || (ph > 0.3 && ph < 0.42) ? 7 : 1.1, 0.12, 0.08);
      if (!on) return;
      t += dt;
      // bubbles rise through the murk
      for (let i = 0; i < bubbleN; i++) {
        const b = bub[i];
        b.y += b.v * dt;
        if (b.y > 2.25) {
          b.y = 0;
          b.a = rnd() * Math.PI * 2;
          b.r = rnd() * 0.5;
        }
        const wob = Math.sin(t * 3 + i) * 0.02;
        _pp.set(tank.x + Math.cos(b.a) * b.r + wob, HF + 0.5 + b.y, tank.z + Math.sin(b.a) * b.r);
        _ss.setScalar(b.s);
        bubbles.setMatrixAt(i, _m4.compose(_pp, _qq, _ss));
      }
      bubbles.instanceMatrix.needsUpdate = true;
      specimen.position.y = HF + 1.62 + Math.sin(t * 0.45) * 0.035;
      specimen.rotation.y = 0.5 + Math.sin(t * 0.13) * 0.12;
      specimen.rotation.z = Math.sin(t * 0.31) * 0.03;
      if (tech) {
        _cam.copy(cam);
        tech.update(dt, { cam: _cam });
      }
    },
  };
  group.visible = true;
  return lab;
}

/** plane geometry (normal +z) whose UVs cover atlas region `rect` ([x, y, w, h] px) of a W x H canvas */
function atlasPlane(w, h, rect, W = 1024, H = 1024) {
  const g = new THREE.PlaneGeometry(w, h);
  const [rx, ry, rw, rh] = rect;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (rx + uv.getX(i) * rw) / W, 1 - (ry + rh) / H + (uv.getY(i) * rh) / H);
  return g;
}
