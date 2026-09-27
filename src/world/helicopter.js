// A procedural utility helicopter (Huey-like: skids, a two-blade main rotor, an open cabin with the
// sliding doors pushed back, a troop bench across the back and one facing it), for the story cutscenes
// (game/cutscenes.js), the hacking module drop (game/mission.js) and the crash event (game/events.js).
//
// Local frame: +z = nose, +y = up, skids on y = 0; the cabin floor is at FLOOR_Y. The fuselage is lofted
// from rounded-rectangle sections: a closed nose and cockpit (glass above the belt line), the cabin with
// both sides open between floor and roof, the rear fuselage and the tail boom. The owner moves `root`;
// update() spins the rotors, blinks the lights and sways the ropes.
import * as THREE from 'three';
import { tex } from './textures.js';

export const HELI = {
  floorY: 0.62, // cabin floor above the skids
  doorX: 1.2, // half width at the doors
  rotorY: 3.15,
  rotorR: 7.3,
  ropeX: 1.34, // fast-rope arms over the doors
  ropeY: 2.3,
  ropeZ: 0.15,
};

const TAU = Math.PI * 2;

/** superellipse ring point: θ around, half width hw, centre yc, half height hh, exponent n */
function ringPt(th, hw, yc, hh, n, out) {
  const c = Math.cos(th), s = Math.sin(th);
  out.x = hw * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  out.y = yc + hh * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
  return out;
}

/**
 * Loft through sections [{ z, hw, y0, y1, n }] (z ascending or descending), the ring over θ in `arc`
 * ([a, b], default the full turn). caps: close the first / last section (full rings only).
 */
function loft(sections, { seg = 28, arc = null, capA = false, capB = false } = {}) {
  const full = !arc;
  const [a, b] = arc ?? [0, TAU];
  const cols = full ? seg : seg + 1;
  const pos = [], uv = [], idx = [];
  const p = { x: 0, y: 0 };
  let v = 0;
  sections.forEach((S, i) => {
    if (i > 0) v += Math.abs(S.z - sections[i - 1].z) / 3;
    const yc = (S.y0 + S.y1) / 2, hh = (S.y1 - S.y0) / 2;
    for (let k = 0; k < cols; k++) {
      const th = a + ((b - a) * k) / seg;
      ringPt(th, S.hw, yc, hh, S.n ?? 3.2, p);
      pos.push(p.x, p.y, S.z);
      uv.push(k / seg, v);
    }
  });
  const rows = sections.length;
  // (i0, i2, i1) faces outward while z descends from row to row: swap for an ascending loft
  const asc = sections[rows - 1].z > sections[0].z;
  for (let r = 0; r < rows - 1; r++) {
    for (let k = 0; k < seg; k++) {
      const k1 = full ? (k + 1) % seg : k + 1;
      const i0 = r * cols + k, i1 = r * cols + k1, i2 = (r + 1) * cols + k, i3 = (r + 1) * cols + k1;
      if (asc) idx.push(i0, i1, i2, i1, i3, i2);
      else idx.push(i0, i2, i1, i1, i2, i3);
    }
  }
  // a cap fans from the section's centre; (c, i0, i1) faces +z
  const capAt = (r, other) => {
    const S = sections[r];
    const plusZ = S.z > sections[other].z;
    const c = pos.length / 3;
    pos.push(0, (S.y0 + S.y1) / 2, S.z);
    uv.push(0.5, 0.5);
    for (let k = 0; k < seg; k++) {
      const i0 = r * cols + k, i1 = r * cols + ((k + 1) % seg);
      if (plusZ) idx.push(c, i0, i1);
      else idx.push(c, i1, i0);
    }
  };
  if (full && capA) capAt(0, 1);
  if (full && capB) capAt(rows - 1, rows - 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** grimy olive paint: canvas noise, streaks and panel lines (512²) */
function paintTexture(base = '#3a4428') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 9000; i++) {
    const v = rnd();
    g.fillStyle = v < 0.5 ? `rgba(20,24,14,${0.05 + rnd() * 0.08})` : `rgba(120,126,96,${0.03 + rnd() * 0.05})`;
    g.fillRect(rnd() * 512, rnd() * 512, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  // rain / oil streaks running down (v is along the length, u around: streaks along v)
  for (let i = 0; i < 120; i++) {
    const x = rnd() * 512, y = rnd() * 512, l = 20 + rnd() * 90;
    const gr = g.createLinearGradient(x, y, x, y + l);
    gr.addColorStop(0, 'rgba(15,16,10,0.22)');
    gr.addColorStop(1, 'rgba(15,16,10,0)');
    g.fillStyle = gr;
    g.fillRect(x, y, 1 + rnd() * 2.5, l);
  }
  // panel lines and rivet rows
  g.strokeStyle = 'rgba(12,14,8,0.55)';
  g.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const y = 40 + i * 70 + rnd() * 10;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(512, y);
    g.stroke();
    g.fillStyle = 'rgba(160,160,130,0.25)';
    for (let x = 4; x < 512; x += 9) g.fillRect(x, y + 4, 1.5, 1.5);
  }
  for (let i = 0; i < 5; i++) {
    const x = 60 + i * 100 + rnd() * 20;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 512);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** tail boom decal: call sign and serial in faded stencil (transparent canvas) */
function markingTexture(text, sub, ink = 'rgba(20,22,16,0.85)') {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = ink;
  g.font = 'bold 64px "Black Ops One", Impact, sans-serif';
  g.textBaseline = 'middle';
  g.fillText(text, 12, 50);
  g.font = 'bold 30px "Share Tech Mono", monospace';
  g.fillText(sub, 16, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** motion blur disc of a spinning rotor: soft streaks, alpha fading to the rim */
function blurTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  gr.addColorStop(0, 'rgba(30,30,30,0.0)');
  gr.addColorStop(0.12, 'rgba(30,30,30,0.35)');
  gr.addColorStop(0.85, 'rgba(24,24,24,0.2)');
  gr.addColorStop(0.97, 'rgba(24,24,24,0.3)');
  gr.addColorStop(1, 'rgba(24,24,24,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'destination-out';
  for (let r = 20; r < 126; r += 3) {
    g.strokeStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.25})`;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(128, 128, r, 0, TAU);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowMap = null;
function glowSprite(color, size) {
  if (glowMap === null) {
    try {
      glowMap = tex('glow').map;
    } catch (e) {
      glowMap = undefined;
    }
  }
  const m = new THREE.SpriteMaterial({ map: glowMap || null, color: new THREE.Color(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
  const s = new THREE.Sprite(m);
  s.scale.setScalar(size);
  s.renderOrder = 6;
  return s;
}

const beamVert = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vView;
uniform float uLen;
void main() {
  vH = clamp(-position.y / uLen, 0.0, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const beamFrag = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vView;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  float facing = abs(dot(normalize(vN), normalize(vView)));
  // brightest at the lamp, gone well before the ground; soft at the edges
  float a = pow(facing, 2.2) * pow(1.0 - vH, 3.0) * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

/** The reagent: a small hard case, a glowing cyan vial in its foam (closed: lid shut, for carrying). Origin on the case's bottom. */
export function buildReagentCase(closed = false) {
  const g = new THREE.Group();
  g.name = 'reagentCase';
  const shell = new THREE.MeshStandardMaterial({ color: 0x2c3230, roughness: 0.55, metalness: 0.2 });
  const edge = new THREE.MeshStandardMaterial({ color: 0x9aa2a6, roughness: 0.35, metalness: 0.8 });
  const foam = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 1 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8f6ff, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false });
  const fluid = new THREE.MeshStandardMaterial({ color: 0x1ad6ff, emissive: 0x19d0ff, emissiveIntensity: 2.4, roughness: 0.2 });
  const W = 0.46, D = 0.3, H = 0.12;
  const box = (m, w, h, d, x, y, z) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    o.castShadow = true;
    g.add(o);
    return o;
  };
  box(shell, W, H, D, 0, H / 2, 0);
  box(foam, W - 0.04, 0.01, D - 0.04, 0, H + 0.001, 0);
  for (const s of [-1, 1]) box(edge, W + 0.01, 0.02, 0.02, 0, H - 0.01, s * (D / 2));
  // the lid, open and leaning back
  const lid = new THREE.Group();
  lid.position.set(0, H, -D / 2);
  lid.rotation.x = closed ? 0 : -1.95;
  g.add(lid);
  const lm = new THREE.Mesh(new THREE.BoxGeometry(W, 0.05, D), shell);
  lm.position.set(0, 0.025, D / 2);
  lid.add(lm);
  const lf = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.01, D - 0.04), foam);
  lf.position.set(0, -0.004, D / 2);
  lid.add(lf);
  // handle
  const hd = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 6, 12, Math.PI), edge);
  hd.position.set(0, H * 0.55, D / 2 + 0.012);
  g.add(hd);
  // vial lying in the foam, plus two empty slots
  const vial = new THREE.Group();
  vial.position.set(0, H + 0.02, 0);
  vial.rotation.z = Math.PI / 2;
  g.add(vial);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 14), glass);
  vial.add(tube);
  const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 12), fluid);
  vial.add(liquid);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.035, 12), edge);
  cap.position.y = 0.13;
  vial.add(cap);
  const glow = glowSprite(0x2fd8ff, 0.55);
  glow.position.set(0, H + 0.04, 0);
  glow.material.opacity = 0.8;
  glow.visible = !closed;
  g.add(glow);
  g.userData.glow = glow;
  return g;
}

/**
 * Build the helicopter. opts.name: call sign on the boom; opts.livery: { base (paint colour), tint, ink (the
 * markings) }, e.g. the NOX squad's black one (actors/merc.js). Returns the runtime object (see the header).
 */
export function buildHelicopter(opts = {}) {
  const root = new THREE.Group();
  root.name = 'helicopter';
  const body = new THREE.Group(); // tilts / banks inside root
  root.add(body);
  const liv = opts.livery ?? {};
  const paintMap = paintTexture(liv.base);
  const M = {
    paint: new THREE.MeshStandardMaterial({ map: paintMap, color: liv.tint ?? 0xc8d0b0, roughness: 0.7, metalness: 0.12, envMapIntensity: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x23272a, roughness: 0.55, metalness: 0.5 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x7c8286, roughness: 0.4, metalness: 0.85 }),
    floor: new THREE.MeshStandardMaterial({ color: 0x2b2e2c, roughness: 0.85, metalness: 0.3 }),
    inner: new THREE.MeshStandardMaterial({ color: 0x59604c, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide }),
    canvas: new THREE.MeshStandardMaterial({ color: 0x7a2c20, roughness: 0.95 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0f1a1e, roughness: 0.06, metalness: 0.2, transparent: true, opacity: 0.55, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false }),
    blade: new THREE.MeshStandardMaterial({ color: 0x141515, roughness: 0.6, metalness: 0.3 }),
    rope: new THREE.MeshStandardMaterial({ color: 0x3a3226, roughness: 0.95 }),
    pilot: new THREE.MeshStandardMaterial({ color: 0x3d4431, roughness: 0.9 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x51563f, roughness: 0.5, metalness: 0.1 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1, metalness: 0.6 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x0d0f10, emissive: 0x3aff9a, emissiveIntensity: 0.08, roughness: 0.5 }),
    redLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.15, 0.1) }),
    lens: new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.4) }),
  };
  const add = (geo, mat, parent = body, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (mat, w, h, d, x, y, z, parent = body, r = null) => {
    const m = add(new THREE.BoxGeometry(w, h, d), mat, parent);
    m.position.set(x, y, z);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    return m;
  };
  const cyl = (mat, r0, r1, h, x, y, z, rot = null, seg = 14, parent = body) => {
    const m = add(new THREE.CylinderGeometry(r0, r1, h, seg), mat, parent);
    m.position.set(x, y, z);
    if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
    return m;
  };
  const tubeAlong = (mat, a, b, r, seg = 8, parent = body) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = add(new THREE.CylinderGeometry(r, r, d.length(), seg), mat, parent);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return m;
  };

  // ---------------------------------------------------------------- fuselage
  const S = (z, hw, y0, y1, n = 3.2) => ({ z, hw, y0, y1, n });
  // nose + cockpit (z 1.5 → 4.3): lower half painted, upper half glass
  const nose = [S(1.5, 1.2, 0.55, 2.3), S(2.4, 1.18, 0.56, 2.28), S(3.2, 1.08, 0.6, 2.12, 3), S(3.8, 0.86, 0.7, 1.86, 2.8), S(4.15, 0.58, 0.86, 1.58, 2.6), S(4.34, 0.22, 1.05, 1.32, 2.4), S(4.38, 0.02, 1.17, 1.2, 2.2)];
  add(loft(nose, { arc: [Math.PI, TAU] }), M.paint);
  const canopy = add(loft(nose, { arc: [0, Math.PI] }), M.glass, body, false);
  canopy.renderOrder = 2;
  // canopy frame: center strip, a hoop at the doors, the eyebrow line
  const frameAt = (z) => {
    const s = nose.find((q) => q.z === z) ?? nose[0];
    const pts = [];
    const p = { x: 0, y: 0 };
    for (let k = 0; k <= 16; k++) {
      ringPt((Math.PI * k) / 16, s.hw + 0.012, (s.y0 + s.y1) / 2, (s.y1 - s.y0) / 2 + 0.012, s.n, p);
      pts.push(new THREE.Vector3(p.x, p.y, z));
    }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 6, false), M.dark);
  };
  frameAt(1.5);
  frameAt(3.2);
  {
    const pts = nose.map((s) => new THREE.Vector3(0, s.y1 + 0.012, s.z));
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.03, 6, false), M.dark);
  }
  // cabin (z -1.25 → 1.5): belly under the floor, roof above the doors, sides open
  const cab = [S(-1.25, 1.2, 0.55, 2.3), S(0.1, 1.21, 0.55, 2.31), S(1.5, 1.2, 0.55, 2.3)];
  add(loft(cab, { arc: [Math.PI + 0.98, TAU - 0.98] }), M.paint);
  add(loft(cab, { arc: [0.43, Math.PI - 0.43] }), M.paint);
  // inner roof lining (so the cabin reads from inside) and the rear bulkhead
  const lining = add(loft(cab.map((s) => ({ ...s, hw: s.hw - 0.04, y1: s.y1 - 0.04 })), { arc: [0.43, Math.PI - 0.43] }), M.inner, body, false);
  lining.material = M.inner;
  box(M.inner, 2.3, 1.62, 0.05, 0, 1.43, -1.23);
  box(M.floor, 2.36, 0.08, 2.78, 0, HELI.floorY - 0.04, 0.12);
  // door pillars and sills
  for (const s of [-1, 1]) {
    box(M.dark, 0.1, 1.5, 0.1, s * 1.16, 1.36, 1.46);
    box(M.dark, 0.1, 1.5, 0.12, s * 1.16, 1.36, -1.2);
    box(M.dark, 0.08, 0.06, 2.7, s * 1.19, HELI.floorY + 0.01, 0.12);
    box(M.dark, 0.08, 0.06, 2.7, s * 1.13, 2.02, 0.12);
    // the sliding door, pushed back along the rear fuselage
    const door = box(M.paint, 0.05, 1.38, 1.3, s * 1.24, 1.34, -1.85, body, [0, s * 0.06, 0]);
    door.name = 'door';
    box(M.glass, 0.055, 0.42, 0.5, s * 1.245, 1.62, -1.72, body, [0, s * 0.06, 0]).renderOrder = 2;
    // fast-rope arm over the door
    box(M.metal, 0.5, 0.06, 0.06, s * (HELI.ropeX - 0.12), HELI.ropeY, HELI.ropeZ);
    cyl(M.metal, 0.03, 0.03, 0.08, s * HELI.ropeX, HELI.ropeY - 0.05, HELI.ropeZ);
  }
  // rear fuselage (z -1.25 → -3.1) and the tail boom (→ -8.4)
  const rear = [S(-1.25, 1.2, 0.55, 2.3), S(-2.1, 1.0, 0.72, 2.28, 3), S(-2.8, 0.66, 1.18, 2.22, 2.8), S(-3.2, 0.44, 1.45, 2.14, 2.6)];
  add(loft(rear), M.paint);
  const boom = [S(-3.2, 0.44, 1.45, 2.14, 2.6), S(-5.5, 0.3, 1.66, 2.06, 2.4), S(-8.1, 0.2, 1.78, 2.02, 2.2), S(-8.45, 0.12, 1.84, 1.98, 2.2)];
  add(loft(boom, { capB: true }), M.paint);
  // vertical fin + the tail rotor gearbox, horizontal stabilizers
  {
    const sh = new THREE.Shape();
    sh.moveTo(-8.45, 1.84);
    sh.lineTo(-7.55, 1.92);
    sh.lineTo(-8.35, 3.35);
    sh.lineTo(-8.85, 3.4);
    sh.lineTo(-8.8, 1.84);
    const fin = add(new THREE.ExtrudeGeometry(sh, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1 }), M.paint);
    fin.rotation.y = -Math.PI / 2;
    fin.position.x = 0.05;
    for (const s of [-1, 1]) box(M.paint, 0.9, 0.05, 0.34, s * 0.62, 1.9, -6.4, body, [0, 0, s * -0.04]);
    cyl(M.dark, 0.12, 0.12, 0.3, -0.18, 3.0, -8.55, [0, 0, Math.PI / 2]);
  }
  // engine cowling, exhaust, mast
  {
    const cowl = [S(0.9, 0.5, 2.2, 2.62, 3), S(0.4, 0.58, 2.2, 2.9, 3.4), S(-1.6, 0.6, 2.2, 2.92, 3.4), S(-2.45, 0.42, 2.15, 2.62, 3)];
    add(loft(cowl, { capA: true, capB: true }), M.paint);
    cyl(M.dark, 0.2, 0.22, 0.5, 0, 2.5, -2.65, [Math.PI / 2 - 0.25, 0, 0]);
    for (const s of [-1, 1]) box(M.dark, 0.02, 0.18, 0.8, s * 0.6, 2.62, -0.7);
    cyl(M.metal, 0.09, 0.12, 0.34, 0, 3.0, 0.1);
  }
  // skids
  for (const s of [-1, 1]) {
    const x = s * 1.25;
    const pts = [new THREE.Vector3(x, 0.05, -2.3), new THREE.Vector3(x, 0.05, 2.4), new THREE.Vector3(x, 0.14, 2.85), new THREE.Vector3(x, 0.38, 3.05)];
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.2), 24, 0.05, 8, false), M.dark);
    for (const z of [-1.3, 1.55]) tubeAlong(M.dark, new THREE.Vector3(x, 0.07, z), new THREE.Vector3(s * 0.8, 0.6, z + 0.05), 0.045);
  }
  // cockpit: seats, two pilots (silhouettes), the glowing panel
  for (const s of [-1, 1]) {
    const x = s * 0.55;
    box(M.canvas, 0.52, 0.1, 0.5, x, 1.02, 2.45);
    box(M.canvas, 0.52, 0.7, 0.1, x, 1.4, 2.18);
    // pilot: torso, head in a helmet with the visor down, arms forward
    box(M.pilot, 0.42, 0.55, 0.3, x, 1.42, 2.4);
    const h = add(new THREE.SphereGeometry(0.15, 14, 10), M.helmet);
    h.position.set(x, 1.86, 2.45);
    const v = add(new THREE.SphereGeometry(0.152, 14, 8, -0.9, 1.8, 1.0, 0.9), M.visor);
    v.position.copy(h.position);
    v.rotation.y = 0;
    for (const a of [-1, 1]) tubeAlong(M.pilot, new THREE.Vector3(x + a * 0.19, 1.6, 2.45), new THREE.Vector3(x + a * 0.12, 1.2, 2.95), 0.05);
  }
  box(M.panel, 1.9, 0.34, 0.08, 0, 1.46, 3.45, body, [-0.5, 0, 0]);
  box(M.dark, 0.1, 0.5, 0.1, 0, 1.2, 3.1); // cyclic / console

  // ---------------------------------------------------------------- cabin interior
  const seats = [];
  const bench = (z, face) => {
    // tube frame + red canvas seat and back
    const zb = z - face * 0.22;
    box(M.canvas, 2.1, 0.06, 0.42, 0, HELI.floorY + 0.42, z);
    box(M.canvas, 2.1, 0.55, 0.05, 0, HELI.floorY + 0.8, zb);
    for (const x of [-1.0, 0, 1.0]) tubeAlong(M.metal, new THREE.Vector3(x, HELI.floorY, z + face * 0.15), new THREE.Vector3(x, HELI.floorY + 0.4, z + face * 0.15), 0.02);
    tubeAlong(M.metal, new THREE.Vector3(-1.05, HELI.floorY + 0.4, z + face * 0.2), new THREE.Vector3(1.05, HELI.floorY + 0.4, z + face * 0.2), 0.02);
    for (let i = 0; i < 4; i++) seats.push({ pos: new THREE.Vector3(-0.78 + i * 0.52, HELI.floorY + 0.45, z + face * 0.02), yaw: face > 0 ? 0 : Math.PI });
  };
  bench(-0.95, 1); // rear bench, facing forward
  bench(1.2, -1); // front bench, facing the rear
  // cargo net on the rear bulkhead, a first-aid box, a radio
  box(M.dark, 0.34, 0.26, 0.2, -1.0, 1.9, -1.1);
  box(new THREE.MeshStandardMaterial({ color: 0x7a1c16, roughness: 0.6 }), 0.3, 0.2, 0.12, 0.95, 1.95, -1.14);
  for (const z of [-0.6, 0.9]) {
    box(M.redLamp, 0.5, 0.03, 0.08, 0, 2.2, z);
    const gl = glowSprite(0xff2a18, 0.8);
    gl.position.set(0, 2.12, z);
    gl.material.opacity = 0.55;
    body.add(gl);
  }
  const cargo = buildReagentCase();
  cargo.position.set(0.12, HELI.floorY, 0.12);
  cargo.rotation.y = 0.35;
  body.add(cargo);

  // ---------------------------------------------------------------- rotors
  const mainRotor = new THREE.Group();
  mainRotor.position.set(0, HELI.rotorY, 0.1);
  body.add(mainRotor);
  cyl(M.dark, 0.2, 0.2, 0.16, 0, 0, 0, null, 16, mainRotor);
  cyl(M.metal, 0.05, 0.05, 1.2, 0, 0.1, 0, [0, 0, Math.PI / 2], 8, mainRotor);
  for (const s of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(HELI.rotorR, 0.045, 0.53), M.blade);
    bl.geometry.translate(HELI.rotorR / 2, 0, 0);
    bl.position.set(0, 0.02, 0);
    bl.rotation.set(s * 0.07, s > 0 ? 0 : Math.PI, -0.035); // pitch, the other blade, a droop
    bl.castShadow = true;
    mainRotor.add(bl);
  }
  const blurMat = new THREE.MeshBasicMaterial({ map: blurTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0 });
  const blur = new THREE.Mesh(new THREE.CircleGeometry(HELI.rotorR, 48), blurMat);
  blur.rotation.x = -Math.PI / 2;
  blur.position.set(0, HELI.rotorY + 0.03, 0.1);
  blur.renderOrder = 3;
  body.add(blur);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-0.36, 3.0, -8.55);
  body.add(tailRotor);
  for (const s of [-1, 1]) {
    const bl = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.2), M.blade);
    bl.position.y = s * 0.65;
    tailRotor.add(bl);
  }
  const tblur = new THREE.Mesh(new THREE.CircleGeometry(1.3, 32), blurMat);
  tblur.rotation.y = Math.PI / 2;
  tblur.position.set(-0.38, 3.0, -8.55);
  tblur.renderOrder = 3;
  body.add(tblur);

  // ---------------------------------------------------------------- lights
  const navL = glowSprite(0xff2a1a, 0.9), navR = glowSprite(0x2aff5a, 0.9);
  navL.position.set(1.22, 1.3, 1.9);
  navR.position.set(-1.22, 1.3, 1.9);
  const beacon = glowSprite(0xff3322, 1.6);
  beacon.position.set(0, 2.98, -1.9);
  const tailW = glowSprite(0xffffff, 0.7);
  tailW.position.set(0, 3.42, -8.8);
  body.add(navL, navR, beacon, tailW);
  // searchlight under the nose
  const search = new THREE.Group();
  search.position.set(0, 0.5, 3.4);
  body.add(search);
  cyl(M.dark, 0.14, 0.12, 0.26, 0, 0, 0, [Math.PI / 2, 0, 0], 16, search);
  const lens = add(new THREE.CircleGeometry(0.11, 16), M.lens, search, false);
  lens.position.z = 0.131;
  const beamLen = 22;
  const beamGeo = new THREE.ConeGeometry(Math.tan(0.2) * beamLen, beamLen, 24, 1, true);
  beamGeo.translate(0, -beamLen / 2, 0);
  const beamMat = new THREE.ShaderMaterial({
    vertexShader: beamVert,
    fragmentShader: beamFrag,
    uniforms: { uLen: { value: beamLen }, uColor: { value: new THREE.Color(0xdfe9ff) }, uIntensity: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.renderOrder = 4;
  beam.frustumCulled = false;
  root.add(beam); // world-aimed (in root space: the body's bank doesn't swing it)
  const lensGlow = glowSprite(0xe8f0ff, 1.4);
  lensGlow.position.set(0, 0, 0.2);
  search.add(lensGlow);

  // boom markings
  {
    const t = markingTexture(opts.name ?? 'REAPER 1-1', opts.serial ?? '71-20477', liv.ink);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), m);
      p.position.set(s * 0.37, 1.84, -4.3);
      p.rotation.y = s * Math.PI / 2;
      p.renderOrder = 1;
      body.add(p);
    }
  }

  // ---------------------------------------------------------------- ropes
  const ropes = [-1, 1].map((s) => {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1, 6), M.rope);
    r.geometry.translate(0, -0.5, 0);
    r.position.set(s * HELI.ropeX, HELI.ropeY - 0.08, HELI.ropeZ);
    r.visible = false;
    r.castShadow = true;
    body.add(r);
    return { mesh: r, len: 0, side: s, sway: Math.random() * 6 };
  });

  // ---------------------------------------------------------------- runtime
  const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion();
  const heli = {
    root,
    body,
    cargo,
    seats, // local seat spots on the benches: { pos, yaw }
    rotor: 0, // spin 0..1 (1 = flight rpm)
    rotorAngle: 0,
    lights: true,
    searchOn: false,
    searchTarget: new THREE.Vector3(),
    time: 0,
    /** world position of a local point (out) */
    toWorld(local, out = new THREE.Vector3()) {
      body.updateWorldMatrix(true, false);
      return out.copy(local).applyMatrix4(body.matrixWorld);
    },
    /** world transform of seat i: position + yaw (the heli's yaw added) */
    seatWorld(i, out = new THREE.Vector3()) {
      const s = seats[i % seats.length];
      return heli.toWorld(s.pos, out);
    },
    /** rope top (world) on side s (-1 / +1) */
    ropeTop(s, out = new THREE.Vector3()) {
      return heli.toWorld(_w.set(s * HELI.ropeX, HELI.ropeY - 0.08, HELI.ropeZ), out);
    },
    /** drop or reel in the ropes: length in m (0 hides) */
    setRopes(len) {
      for (const r of ropes) {
        r.len = len;
        r.mesh.visible = len > 0.05;
        r.mesh.scale.y = Math.max(0.05, len);
      }
    },
    searchWorld(out = new THREE.Vector3()) {
      return heli.toWorld(_w.set(0, 0.5, 3.52), out);
    },
    update(dt) {
      heli.time += dt;
      const t = heli.time;
      // rotors: the blades turn slowly enough to read, the blur disc takes over at speed
      const sp = heli.rotor;
      heli.rotorAngle += dt * sp * 17;
      mainRotor.rotation.y = heli.rotorAngle;
      tailRotor.rotation.x = heli.rotorAngle * 4.3;
      blurMat.opacity = Math.min(1, sp * 1.4) * 0.85;
      // lights
      const on = heli.lights;
      navL.visible = navR.visible = tailW.visible = on;
      beacon.visible = on && (t * 1.3) % 1 < 0.14;
      // ropes sway a little
      for (const r of ropes) {
        if (!r.mesh.visible) continue;
        r.mesh.rotation.z = Math.sin(t * 1.3 + r.sway) * 0.025 * (0.4 + r.len / 15);
        r.mesh.rotation.x = Math.sin(t * 0.9 + r.sway * 2) * 0.03 * (0.4 + r.len / 15);
      }
      // searchlight: the housing and the beam turn to the target
      const k = heli.searchOn ? 1 : 0;
      beamMat.uniforms.uIntensity.value += (k * 0.15 - beamMat.uniforms.uIntensity.value) * Math.min(1, dt * 6);
      lensGlow.visible = heli.searchOn;
      M.lens.color.setScalar(heli.searchOn ? 4 : 0.2);
      if (heli.searchOn) {
        root.updateWorldMatrix(true, true);
        const from = heli.searchWorld(_v);
        const dir = _w.copy(heli.searchTarget).sub(from).normalize();
        // beam: a cone hanging along -y, turned onto the aim (root space)
        const inv = _q.copy(root.quaternion).invert();
        beam.position.copy(from).sub(root.position).applyQuaternion(inv);
        beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().applyQuaternion(inv));
        search.lookAt(heli.searchTarget);
      }
      beam.visible = beamMat.uniforms.uIntensity.value > 0.01;
    },
  };
  root.traverse((o) => {
    if (o.isMesh && o.material === M.glass) o.castShadow = false;
  });
  return heli;
}

/**
 * Flying a helicopter along a path of world points: position at u 0..1 (Catmull-Rom), heading along the
 * path, bank into the turns and a nose-down pitch with speed. `hover`: bob and drift in place.
 */
export class HeliFlight {
  constructor(heli) {
    this.heli = heli;
    this.curve = null;
    this.yaw = 0;
    this.bank = 0;
    this.pitch = 0;
    this._prev = new THREE.Vector3();
    this._has = false;
  }

  setPath(points) {
    this.curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p.clone() : new THREE.Vector3(p[0], p[1], p[2]))), false, 'centripetal');
    this._has = false;
    return this.curve;
  }

  /** place at u along the path; dt for the smoothing of yaw / bank / pitch */
  at(u, dt, faceYaw = null) {
    const h = this.heli;
    const p = this.curve.getPointAt(Math.min(1, Math.max(0, u)));
    const r = h.root;
    const vel = this._has && dt > 0 ? p.clone().sub(this._prev).divideScalar(dt) : new THREE.Vector3();
    this._prev.copy(p);
    this._has = true;
    r.position.copy(p);
    const sp = Math.hypot(vel.x, vel.z);
    let wantYaw = faceYaw;
    if (wantYaw == null) wantYaw = sp > 0.5 ? Math.atan2(vel.x, vel.z) : this.yaw;
    const dy = Math.atan2(Math.sin(wantYaw - this.yaw), Math.cos(wantYaw - this.yaw));
    const k = 1 - Math.exp(-dt * 2.2);
    this.yaw += dy * k;
    this.bank += (Math.max(-0.45, Math.min(0.45, -dy * 1.6)) - this.bank) * (1 - Math.exp(-dt * 2));
    this.pitch += (Math.min(0.22, sp * 0.012) - this.pitch) * (1 - Math.exp(-dt * 1.5));
    r.rotation.set(0, this.yaw, 0);
    h.body.rotation.set(this.pitch, 0, this.bank);
    return p;
  }

  /** hovering at a spot: a slow bob and sway */
  hover(pos, yaw, dt) {
    const h = this.heli, t = h.time;
    this.yaw += Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw)) * (1 - Math.exp(-dt * 1.5));
    this.bank += (Math.sin(t * 0.7) * 0.03 - this.bank) * (1 - Math.exp(-dt * 2));
    this.pitch += (Math.sin(t * 0.5) * 0.02 - this.pitch) * (1 - Math.exp(-dt * 2));
    h.root.position.set(pos.x + Math.sin(t * 0.43) * 0.25, pos.y + Math.sin(t * 0.9) * 0.18, pos.z + Math.cos(t * 0.37) * 0.25);
    h.root.rotation.set(0, this.yaw, 0);
    h.body.rotation.set(this.pitch, 0, this.bank);
    this._prev.copy(h.root.position);
  }
}

/**
 * The shared helicopter of the story (built on first use): the model in the scene, its flight helper and
 * the rotor sound, which follows it. Hidden while nobody needs it.
 */
export class Chopper {
  constructor(scene, audio, opts = {}) {
    this.heli = buildHelicopter(opts);
    this.flight = new HeliFlight(this.heli);
    this.root = this.heli.root;
    this.root.visible = false;
    scene.add(this.root);
    this.audio = audio;
    this.snd = null;
    this.vol = 1;
  }

  get visible() {
    return this.root.visible;
  }

  show(on) {
    this.root.visible = on;
    if (!on) {
      this.sound(false);
      this.heli.searchOn = false;
      this.heli.setRopes(0);
    }
  }

  sound(on, vol = 1) {
    this.vol = vol;
    if (on && !this.snd) this.snd = this.audio.play('heli_rotor', { loop: true, position: this.root.position, volume: vol });
    else if (!on && this.snd) {
      this.snd.stop(1.2);
      this.snd = null;
    }
    this.snd?.setVolume(vol);
  }

  update(dt) {
    if (!this.root.visible) return;
    this.heli.update(dt);
    this.snd?.setPosition(this.root.position);
  }
}
