// Small procedural gear models shared by the cellar gun shop (shelf props) and the store UI
// (3D thumbnails + live preview): a full-face gas mask and a kevlar plate carrier, plus the wearable
// store gear (game/gear.js) further down. Each is built around its own center, front facing +Z,
// sized like the real thing (mask ~0.2 m, vest ~0.5 m).
import * as THREE from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const matCache = {};
const mat = (key, params) => (matCache[key] ??= new THREE.MeshStandardMaterial(params));

// fine woven-fabric bump map (one shared tile)
let _weave = null;
function weaveTex() {
  if (_weave || typeof document === 'undefined') return _weave;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#808080';
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) {
    for (let x = 0; x < 64; x += 4) {
      const odd = ((x + y) / 4) % 2;
      g.fillStyle = odd ? '#9a9a9a' : '#6a6a6a';
      g.fillRect(x, y, 4, 2);
      g.fillStyle = odd ? '#707070' : '#a4a4a4';
      g.fillRect(x, y + 2, 4, 2);
    }
  }
  _weave = new THREE.CanvasTexture(c);
  _weave.wrapS = _weave.wrapT = THREE.RepeatWrapping;
  _weave.repeat.set(10, 10);
  return _weave;
}

const add = (parent, geo, material, pos, rot, scl) => {
  const m = new THREE.Mesh(geo, material);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (scl) m.scale.set(scl[0], scl[1], scl[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

/** Rounded slab (ExtrudeGeometry with a soft bevel) centered on the origin, depth along Z. */
function slab(w, h, d, r = 0.02, bevel = 0.008) {
  const s = new THREE.Shape();
  const x = w / 2 - bevel, y = h / 2 - bevel, rr = Math.min(r, x, y);
  s.moveTo(-x + rr, -y);
  s.lineTo(x - rr, -y);
  s.quadraticCurveTo(x, -y, x, -y + rr);
  s.lineTo(x, y - rr);
  s.quadraticCurveTo(x, y, x - rr, y);
  s.lineTo(-x + rr, y);
  s.quadraticCurveTo(-x, y, -x, y - rr);
  s.lineTo(-x, -y + rr);
  s.quadraticCurveTo(-x, -y, -x + rr, -y);
  const depth = Math.max(0.001, d - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Full-face respirator: rubber face piece, two lenses in steel rims, chin filter can, straps. */
export function gasMask() {
  const g = new THREE.Group();
  g.name = 'gasMask';
  const rubber = mat('maskRubber', { color: 0x23261f, roughness: 0.78, metalness: 0 });
  const seal = mat('maskSeal', { color: 0x151713, roughness: 0.9, metalness: 0 });
  const glass = mat('maskGlass', { color: 0x1c2a2a, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.6 });
  const ring = mat('maskRing', { color: 0x4a4d52, metalness: 0.85, roughness: 0.38 });
  const can = mat('maskFilter', { color: 0x4b5436, roughness: 0.55, metalness: 0.25 });
  const canRib = mat('maskFilterRib', { color: 0x3a4129, roughness: 0.5, metalness: 0.3 });
  const strap = mat('maskStrap', { color: 0x1a1c18, roughness: 0.92 });

  // face piece and its sealing rim
  add(g, new THREE.SphereGeometry(0.1, 28, 20), rubber, [0, 0, 0], null, [0.95, 1.15, 0.7]);
  add(g, new THREE.TorusGeometry(0.094, 0.011, 10, 36), seal, [0, 0.004, -0.02], [0, 0, 0], [0.98, 1.2, 1]);
  // brow ridge over the eyes
  add(g, new THREE.CapsuleGeometry(0.014, 0.1, 4, 10), rubber, [0, 0.066, 0.045], [0, 0, Math.PI / 2], [1, 1, 0.8]);
  for (const s of [-1, 1]) {
    const lens = add(g, new THREE.CylinderGeometry(0.036, 0.036, 0.02, 28), glass, [s * 0.043, 0.03, 0.062], [Math.PI / 2, 0, 0]);
    lens.rotation.z = s * 0.12;
    const r = add(g, new THREE.TorusGeometry(0.038, 0.0075, 10, 28), ring, [s * 0.043, 0.03, 0.071]);
    r.rotation.y = s * 0.12;
    // side strap anchors and straps running back
    add(g, new THREE.BoxGeometry(0.012, 0.026, 0.02), ring, [s * 0.09, 0.03, 0.0]);
    add(g, new THREE.BoxGeometry(0.008, 0.02, 0.12), strap, [s * 0.094, 0.03, -0.066], [0, s * 0.1, 0]);
    add(g, new THREE.BoxGeometry(0.008, 0.02, 0.1), strap, [s * 0.088, -0.05, -0.05], [0.25, s * 0.12, 0]);
    // exhale valves on the cheeks
    add(g, new THREE.CylinderGeometry(0.016, 0.018, 0.018, 18), seal, [s * 0.062, -0.058, 0.05], [Math.PI / 2 - 0.3, 0, s * 0.6]);
  }
  // chin: ribbed filter canister screwed onto the port
  const f = new THREE.Group();
  f.position.set(0, -0.075, 0.07);
  f.rotation.x = Math.PI / 2 - 0.5;
  g.add(f);
  add(f, new THREE.CylinderGeometry(0.03, 0.034, 0.02, 24), seal, [0, -0.012, 0]);
  add(f, new THREE.CylinderGeometry(0.047, 0.05, 0.062, 30), can, [0, 0.03, 0]);
  for (const y of [0.012, 0.03, 0.048]) add(f, new THREE.TorusGeometry(0.049, 0.003, 6, 30), canRib, [0, y, 0], [Math.PI / 2, 0, 0]);
  add(f, new THREE.CylinderGeometry(0.04, 0.047, 0.006, 30), canRib, [0, 0.064, 0]);
  add(f, new THREE.CylinderGeometry(0.012, 0.012, 0.004, 16), seal, [0, 0.068, 0]);
  return g;
}

/** Plate carrier: padded front plate bag with MOLLE rows, three mag pouches, shoulder straps. */
export function kevlarVest() {
  const g = new THREE.Group();
  g.name = 'kevlarVest';
  const weave = weaveTex();
  const fab = mat('vestFabric', { color: 0x40462f, roughness: 0.95, bumpMap: weave, bumpScale: 0.6 });
  const dark = mat('vestPouch', { color: 0x333826, roughness: 0.95, bumpMap: weave, bumpScale: 0.6 });
  const web = mat('vestWebbing', { color: 0x2e3222, roughness: 0.9 });
  const buckle = mat('vestBuckle', { color: 0x141414, roughness: 0.55, metalness: 0.1 });
  const patch = mat('vestPatch', { color: 0x6b6f5a, roughness: 0.98 });

  // plate bag and the back panel peeking out behind it
  add(g, slab(0.42, 0.5, 0.1, 0.06, 0.018), fab, [0, 0, 0.005]);
  add(g, slab(0.4, 0.46, 0.04, 0.05, 0.01), dark, [0, 0.01, -0.045]);
  // shoulder straps with padding
  for (const s of [-1, 1]) {
    add(g, slab(0.085, 0.16, 0.05, 0.03, 0.012), fab, [s * 0.13, 0.3, -0.005]);
    add(g, new THREE.BoxGeometry(0.06, 0.1, 0.012), web, [s * 0.13, 0.31, 0.024]);
    add(g, new THREE.BoxGeometry(0.03, 0.02, 0.01), buckle, [s * 0.13, 0.25, 0.034]);
    // cummerbund wings
    add(g, slab(0.07, 0.2, 0.05, 0.025, 0.01), dark, [s * 0.225, -0.1, -0.015], [0, s * 0.35, 0]);
  }
  // MOLLE rows above the pouches
  for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(0.34, 0.016, 0.008), web, [0, 0.16 - i * 0.045, 0.061]);
  // velcro ID patch
  add(g, new THREE.BoxGeometry(0.12, 0.05, 0.006), patch, [0, 0.19, 0.066]);
  // three rifle-mag pouches with flaps
  for (let i = -1; i <= 1; i++) {
    const x = i * 0.12;
    add(g, slab(0.1, 0.14, 0.055, 0.015, 0.008), dark, [x, -0.12, 0.08]);
    add(g, slab(0.104, 0.045, 0.064, 0.012, 0.006), fab, [x, -0.058, 0.084], [-0.12, 0, 0]);
    add(g, new THREE.BoxGeometry(0.02, 0.03, 0.008), buckle, [x, -0.072, 0.118]);
  }
  return g;
}

/* ================================================================== store gear (game/gear.js) */
// The wearable gear items' product models for the store (thumbnails + the live turntable). Same
// conventions: built around their own center, front toward +Z, real-world sizes.

const TAU = Math.PI * 2;

/** Capsule between two points (radius r). */
function capsuleAt(parent, material, a, b, r, seg = 10) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = add(parent, new THREE.CapsuleGeometry(r, Math.max(0.0001, len), 4, seg), material);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

/** Tube along a smooth curve through `pts`. */
function tubeAlong(parent, material, pts, r, seg = 48, closed = false) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return add(parent, new THREE.TubeGeometry(curve, seg, r, 8, closed), material);
}

/** Extruded 2D outline [[x, y], ...] in the XY plane, `depth` along Z (centered), soft bevel. */
function plate(outline, depth, bevel = 0.002) {
  const s = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const d = Math.max(0.0005, depth - bevel * 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -d / 2);
  return g;
}

/**
 * Shoulder strap: a flat band (w wide, t thick) arching from the top of a chest panel up over the
 * shoulder and down the back, at x (the curve runs in the YZ plane).
 */
function strapArch(parent, material, x, y0, z0, w = 0.06, t = 0.012) {
  const pts = [
    [x, y0 - 0.02, z0],
    [x, y0 + 0.05, z0 - 0.01],
    [x, y0 + 0.09, z0 - 0.06],
    [x, y0 + 0.095, z0 - 0.14],
    [x, y0 + 0.06, z0 - 0.22],
    [x, y0 - 0.01, z0 - 0.26],
  ].map((p) => new THREE.Vector3(...p));
  const shape = new THREE.Shape([
    new THREE.Vector2(-t / 2, -w / 2),
    new THREE.Vector2(t / 2, -w / 2),
    new THREE.Vector2(t / 2, w / 2),
    new THREE.Vector2(-t / 2, w / 2),
  ]);
  const path = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return add(parent, new THREE.ExtrudeGeometry(shape, { steps: 36, bevelEnabled: false, extrudePath: path }), material);
}

/** Stylized M67: OD sphere, fuze body, spoon along the side, pin ring. Origin at the body center. */
function fragGrenade() {
  const g = new THREE.Group();
  const body = mat('gFragBody', { color: 0x4d5636, roughness: 0.55, metalness: 0.2 });
  const fuze = mat('gFragFuze', { color: 0x6d7063, roughness: 0.4, metalness: 0.8 });
  const band = mat('gFragBand', { color: 0xc4a02a, roughness: 0.5, metalness: 0.1 });
  add(g, new THREE.SphereGeometry(0.031, 22, 16), body, [0, 0, 0], null, [1, 1.08, 1]);
  add(g, new THREE.TorusGeometry(0.0205, 0.0022, 6, 22), band, [0, 0.026, 0], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.0105, 0.0125, 0.024, 16), fuze, [0, 0.042, 0]);
  add(g, new THREE.CylinderGeometry(0.008, 0.0095, 0.008, 14), fuze, [0, 0.057, 0]);
  const spoon = add(g, new THREE.BoxGeometry(0.012, 0.062, 0.0022), fuze, [0.0, 0.028, 0.03], [-0.32, 0, 0]);
  spoon.rotation.z = 0;
  add(g, new THREE.TorusGeometry(0.009, 0.0014, 6, 18), fuze, [-0.016, 0.05, 0.004], [0, Math.PI / 2 - 0.3, 0]);
  return g;
}

/** GRENADIER VEST: coyote chest rig with a row of frag pouches and a Molotov bottle pouch. */
export function grenadierVest() {
  const g = new THREE.Group();
  g.name = 'grenadierVest';
  const weave = weaveTex();
  const fab = mat('gvFabric', { color: 0x6f5d40, roughness: 0.94, bumpMap: weave, bumpScale: 0.6 });
  const dark = mat('gvPouch', { color: 0x5c4c33, roughness: 0.95, bumpMap: weave, bumpScale: 0.6 });
  const web = mat('gvWeb', { color: 0x4d402b, roughness: 0.9 });
  const buckle = mat('vestBuckle', { color: 0x141414, roughness: 0.55, metalness: 0.1 });
  const glass = mat('gvGlass', { color: 0x4a3a18, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.82, envMapIntensity: 1.4 });
  const rag = mat('gvRag', { color: 0x8c7d62, roughness: 1 });

  // chest panel, back panel edge, H-harness shoulder straps and cummerbund wings
  add(g, slab(0.44, 0.24, 0.05, 0.045, 0.014), fab, [0, 0, 0]);
  add(g, slab(0.42, 0.2, 0.03, 0.04, 0.008), dark, [0, 0.01, -0.035]);
  for (const s of [-1, 1]) {
    strapArch(g, fab, s * 0.13, 0.12, 0.0, 0.07, 0.016);
    strapArch(g, web, s * 0.13, 0.12, 0.01, 0.045, 0.02);
    add(g, new THREE.BoxGeometry(0.034, 0.022, 0.012), buckle, [s * 0.13, 0.15, 0.012]);
    add(g, slab(0.1, 0.17, 0.03, 0.028, 0.008), dark, [s * 0.255, -0.01, -0.05], [0, s * 0.55, 0]);
  }
  // MOLLE across the top of the panel
  for (let i = 0; i < 2; i++) add(g, new THREE.BoxGeometry(0.4, 0.014, 0.008), web, [0, 0.095 - i * 0.036, 0.029]);
  // five open-top frag pouches, each holding a grenade, with a snap strap over the fuze
  for (let i = -2; i <= 2; i++) {
    const x = i * 0.082;
    add(g, new THREE.CylinderGeometry(0.036, 0.034, 0.078, 22), dark, [x, -0.045, 0.058]);
    add(g, new THREE.TorusGeometry(0.035, 0.0035, 6, 24), web, [x, -0.007, 0.058], [Math.PI / 2, 0, 0]);
    const f = fragGrenade();
    f.position.set(x, -0.004, 0.058);
    f.rotation.y = 0.6 + i * 0.4;
    g.add(f);
    add(g, new THREE.BoxGeometry(0.014, 0.07, 0.006), web, [x, 0.0, 0.094], [-0.28, 0, 0]);
    add(g, new THREE.BoxGeometry(0.018, 0.012, 0.008), buckle, [x, -0.03, 0.098]);
  }
  // Molotov bottle riding in a sleeve on the right wing, rag stuffed in its neck
  const bottle = new THREE.Group();
  bottle.position.set(0.255, 0.02, 0.0);
  bottle.rotation.set(0, 0.55, -0.08);
  g.add(bottle);
  const prof = [
    [0, -0.1], [0.028, -0.1], [0.031, -0.094], [0.031, 0.02], [0.026, 0.04], [0.012, 0.058], [0.011, 0.09], [0.013, 0.094], [0.0, 0.094],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  add(bottle, new THREE.LatheGeometry(prof, 24), glass);
  add(bottle, new THREE.ConeGeometry(0.014, 0.045, 7, 1), rag, [0.002, 0.11, 0], [0.1, 0, 0.35]);
  add(bottle, new THREE.SphereGeometry(0.012, 8, 6), rag, [0.004, 0.098, 0.002], null, [1, 0.8, 1]);
  add(bottle, new THREE.CylinderGeometry(0.036, 0.036, 0.1, 20, 1, true), dark, [0, -0.05, 0.0]).material.side = THREE.DoubleSide;
  return g;
}

/** MAG-POUCH VEST: black chest rig with four open rifle-mag pouches (mags in, base up) and pistol mags. */
export function magPouchVest() {
  const g = new THREE.Group();
  g.name = 'magPouchVest';
  const weave = weaveTex();
  const fab = mat('mvFabric', { color: 0x3a4133, roughness: 0.93, bumpMap: weave, bumpScale: 0.6 });
  const dark = mat('mvPouch', { color: 0x2f3529, roughness: 0.95, bumpMap: weave, bumpScale: 0.6 });
  const web = mat('mvWeb', { color: 0x1b1d19, roughness: 0.9 });
  const mag = mat('mvMag', { color: 0x1a1a1b, roughness: 0.62, metalness: 0.05 });
  const tab = mat('mvTab', { color: 0x6a5a3a, roughness: 0.9 });
  const cord = mat('mvCord', { color: 0x111111, roughness: 0.7 });
  const patch = mat('vestPatch', { color: 0x6b6f5a, roughness: 0.98 });

  add(g, slab(0.46, 0.2, 0.05, 0.04, 0.014), fab, [0, 0, 0]);
  add(g, slab(0.44, 0.17, 0.03, 0.035, 0.008), dark, [0, 0.005, -0.035]);
  for (const s of [-1, 1]) {
    strapArch(g, fab, s * 0.16, 0.1, 0.0, 0.06, 0.016);
    strapArch(g, web, s * 0.16, 0.1, 0.01, 0.038, 0.02);
    add(g, slab(0.09, 0.15, 0.03, 0.026, 0.008), dark, [s * 0.265, -0.01, -0.05], [0, s * 0.55, 0]);
  }
  // four rifle-mag pouches: the mags sit base up, pull tabs on the baseplates, bungee over the top
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.094;
    add(g, slab(0.084, 0.11, 0.05, 0.012, 0.007), dark, [x, -0.03, 0.05]);
    add(g, new THREE.BoxGeometry(0.086, 0.012, 0.052), web, [x, -0.0, 0.05]);
    const m = new THREE.Group();
    m.position.set(x, 0.05, 0.05);
    m.rotation.z = (i - 1.5) * 0.03;
    g.add(m);
    add(m, slab(0.066, 0.075, 0.026, 0.004, 0.002), mag, [0, -0.012, 0]);
    for (let k = 0; k < 4; k++) add(m, new THREE.BoxGeometry(0.068, 0.003, 0.028), mag, [0, -0.036 + k * 0.012, 0]);
    add(m, slab(0.072, 0.012, 0.03, 0.004, 0.002), mag, [0, 0.03, 0]); // baseplate
    add(m, new THREE.BoxGeometry(0.03, 0.006, 0.01), tab, [0, 0.04, 0.0]);
    add(m, new THREE.TorusGeometry(0.012, 0.0025, 6, 16, Math.PI), tab, [0, 0.043, 0], [0, 0, 0]);
    // bungee retention across the mag
    add(g, new THREE.CylinderGeometry(0.0025, 0.0025, 0.08, 6), cord, [x, 0.04, 0.066], [0, 0, Math.PI / 2]);
  }
  // two pistol-mag pouches and an ID patch up top between the straps
  for (const s of [-1, 1]) {
    add(g, slab(0.04, 0.06, 0.03, 0.008, 0.005), dark, [s * 0.045, 0.1, 0.03]);
    add(g, slab(0.028, 0.02, 0.018, 0.004, 0.002), mag, [s * 0.045, 0.138, 0.03]);
  }
  add(g, new THREE.BoxGeometry(0.1, 0.034, 0.006), patch, [0, 0.07, 0.03]);
  return g;
}

/** WEAPON BACKPACK: an assault pack with a rifle strapped across its front. `rifle()`: the gun model. */
export function weaponBackpack({ rifle } = {}) {
  const g = new THREE.Group();
  g.name = 'weaponBackpack';
  const weave = weaveTex();
  const fab = mat('bpFabric', { color: 0x4c4b39, roughness: 0.93, bumpMap: weave, bumpScale: 0.7 });
  const dark = mat('bpPouch', { color: 0x3c3b2c, roughness: 0.95, bumpMap: weave, bumpScale: 0.7 });
  const web = mat('bpWeb', { color: 0x2c2b21, roughness: 0.9 });
  const buckle = mat('vestBuckle', { color: 0x141414, roughness: 0.55, metalness: 0.1 });
  const zip = mat('bpZip', { color: 0x1c1c1c, roughness: 0.5, metalness: 0.3 });

  // main bag, lid, front pocket, side pockets
  add(g, slab(0.3, 0.46, 0.17, 0.07, 0.02), fab, [0, 0, 0]);
  add(g, slab(0.31, 0.08, 0.18, 0.04, 0.016), dark, [0, 0.22, 0.004], [0.06, 0, 0]);
  add(g, slab(0.24, 0.22, 0.06, 0.05, 0.014), dark, [0, -0.09, 0.1]);
  add(g, new THREE.BoxGeometry(0.2, 0.006, 0.006), zip, [0, 0.02, 0.131]);
  for (const s of [-1, 1]) {
    add(g, slab(0.05, 0.2, 0.12, 0.02, 0.01), dark, [s * 0.165, -0.08, 0.0]);
    // compression straps round the sides
    for (const y of [0.1, -0.12]) {
      add(g, new THREE.BoxGeometry(0.018, 0.022, 0.16), web, [s * 0.152, y, 0.0]);
      add(g, new THREE.BoxGeometry(0.026, 0.03, 0.012), buckle, [s * 0.12, y, 0.09]);
    }
    // shoulder straps on the back
    add(g, slab(0.06, 0.36, 0.03, 0.025, 0.01), dark, [s * 0.085, 0.02, -0.1], [0.05, 0, 0]);
  }
  // grab handle on top
  add(g, new THREE.TorusGeometry(0.03, 0.007, 8, 18, Math.PI), web, [0, 0.262, -0.03]);
  // MOLLE rows on the front pocket
  for (let i = 0; i < 3; i++) add(g, new THREE.BoxGeometry(0.2, 0.012, 0.006), web, [0, -0.04 - i * 0.045, 0.132]);
  // the rifle, muzzle up and canted, its right side to the front, held on by two straps
  if (rifle) {
    const gun = rifle();
    const holder = new THREE.Group();
    holder.position.set(0.0, 0.0, 0.17);
    holder.rotation.z = -0.95;
    g.add(holder);
    gun.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, -1, 0)));
    gun.position.set(0, -0.18, 0);
    holder.add(gun);
    for (const y of [0.1, -0.16]) {
      add(holder, new THREE.BoxGeometry(0.1, 0.024, 0.012), web, [0, y, 0.034]);
      add(holder, new THREE.BoxGeometry(0.03, 0.03, 0.014), buckle, [0.03, y, 0.042]);
    }
  }
  return g;
}

/** DEFIBRILLATOR: a rugged yellow AED case with a screen, the shock button and two paddles on coiled leads. */
export function defibrillator() {
  const g = new THREE.Group();
  g.name = 'defibrillator';
  const shell = mat('dfShell', { color: 0xd9a51c, roughness: 0.45, metalness: 0.05 });
  const face = mat('dfFace', { color: 0x26282b, roughness: 0.6 });
  const rubber = mat('dfRubber', { color: 0x151617, roughness: 0.85 });
  const screen = mat('dfScreen', { color: 0x0d1a12, roughness: 0.12, metalness: 0.1, emissive: 0x1d6a38, emissiveIntensity: 0.6 });
  const trace = mat('dfTrace', { color: 0x7dffae, emissive: 0x6dff9e, emissiveIntensity: 1.6, roughness: 0.4 });
  const red = mat('dfRed', { color: 0xc8231b, roughness: 0.35, emissive: 0x3a0503, emissiveIntensity: 0.5 });
  const white = mat('dfWhite', { color: 0xeeeae0, roughness: 0.5 });
  const steel = mat('dfSteel', { color: 0x9a9da3, metalness: 1, roughness: 0.3 });
  const orange = mat('dfPaddle', { color: 0xe06a1c, roughness: 0.5 });

  // case, bumpers, front panel
  add(g, slab(0.27, 0.2, 0.1, 0.035, 0.012), shell, [0, 0, 0]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(g, new THREE.SphereGeometry(0.019, 14, 10), rubber, [sx * 0.124, sy * 0.089, 0], null, [1, 1, 2.6]);
  add(g, slab(0.21, 0.14, 0.01, 0.02, 0.003), face, [0, -0.006, 0.05]);
  // screen with a heart trace
  add(g, slab(0.086, 0.056, 0.006, 0.006, 0.002), screen, [-0.052, 0.018, 0.056]);
  const ecg = [[-0.088, 0.018], [-0.07, 0.018], [-0.064, 0.03], [-0.058, 0.004], [-0.052, 0.036], [-0.046, 0.014], [-0.04, 0.018], [-0.016, 0.018]];
  for (let i = 0; i < ecg.length - 1; i++) {
    const [x0, y0] = ecg[i];
    const [x1, y1] = ecg[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    add(g, new THREE.BoxGeometry(len, 0.0024, 0.002), trace, [(x0 + x1) / 2, (y0 + y1) / 2, 0.0602], [0, 0, Math.atan2(y1 - y0, x1 - x0)]);
  }
  // shock button: red, ringed, a lightning bolt on it
  add(g, new THREE.CylinderGeometry(0.03, 0.032, 0.008, 28), rubber, [0.052, 0.012, 0.056], [Math.PI / 2, 0, 0]);
  add(g, new THREE.CylinderGeometry(0.024, 0.026, 0.012, 28), red, [0.052, 0.012, 0.06], [Math.PI / 2, 0, 0]);
  add(g, plate([[-0.004, 0.014], [0.008, 0.014], [0.002, 0.002], [0.009, 0.002], [-0.006, -0.016], [-0.001, -0.003], [-0.008, -0.003]], 0.002, 0.0004), white, [0.052, 0.012, 0.0665]);
  // status LEDs and a red cross label
  for (let i = 0; i < 3; i++) add(g, new THREE.SphereGeometry(0.004, 8, 6), i ? white : trace, [-0.085 + i * 0.014, -0.036, 0.056]);
  add(g, new THREE.BoxGeometry(0.03, 0.009, 0.003), red, [0.052, -0.048, 0.056]);
  add(g, new THREE.BoxGeometry(0.009, 0.03, 0.003), red, [0.052, -0.048, 0.056]);
  // carry handle
  add(g, new THREE.TorusGeometry(0.06, 0.011, 10, 24, Math.PI), rubber, [0, 0.1, 0], null, [1, 0.62, 1]);
  for (const s of [-1, 1]) add(g, new THREE.BoxGeometry(0.03, 0.02, 0.05), shell, [s * 0.06, 0.103, 0]);
  // two paddles clipped to the sides, leads coiling down to the front
  for (const s of [-1, 1]) {
    const p = new THREE.Group();
    p.position.set(s * 0.17, -0.01, 0.01);
    p.rotation.set(0, s * 0.35, s * -0.12);
    g.add(p);
    add(p, new THREE.CylinderGeometry(0.038, 0.04, 0.012, 28), steel, [s * 0.012, 0, 0], [0, 0, Math.PI / 2]);
    add(p, new THREE.CylinderGeometry(0.041, 0.041, 0.016, 28), rubber, [s * 0.0, 0, 0], [0, 0, Math.PI / 2]);
    add(p, slab(0.03, 0.08, 0.03, 0.012, 0.006), orange, [-s * 0.024, 0.02, 0], [0, 0, 0]);
    add(p, new THREE.CylinderGeometry(0.008, 0.008, 0.012, 12), red, [-s * 0.024, 0.066, 0]);
    const coil = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = t * TAU * 3.5;
      coil.push([s * (0.17 - 0.03 * t) + Math.cos(a) * 0.012, -0.03 - 0.07 * t, 0.03 + 0.02 * t + Math.sin(a) * 0.012]);
    }
    coil.push([s * 0.1, -0.1, 0.04]);
    tubeAlong(g, rubber, coil, 0.0032, 160);
  }
  return g;
}

/** One combat boot (right foot): lugged sole, suede upper, leather toe cap + heel, laced tongue, hooks. Toe +X. */
function boot() {
  const g = new THREE.Group();
  const sole = mat('btSole', { color: 0x19181a, roughness: 0.9 });
  const mid = mat('btMid', { color: 0x75664f, roughness: 0.85 });
  const upper = mat('btUpper', { color: 0x8c7654, roughness: 0.95, bumpMap: weaveTex(), bumpScale: 0.35 });
  const leather = mat('btLeather', { color: 0x5b4631, roughness: 0.55 });
  const lace = mat('btLace', { color: 0x2e2820, roughness: 0.9 });
  const hook = mat('btHook', { color: 0x2c2c2a, metalness: 0.8, roughness: 0.4 });
  const B = 0.03; // top of the midsole

  // footprint (x along the foot, y across it): round heel, narrow waist, wide ball, round toe
  const foot = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * TAU;
    const x = Math.cos(a);
    const w = x > 0.35 ? 0.052 : x > -0.2 ? 0.046 + 0.006 * x : 0.043;
    foot.push([0.02 + x * 0.152, Math.sin(a) * w * (x > 0.75 ? 0.4 + 0.6 * Math.sqrt((1 - x) / 0.25) : 1)]);
  }
  add(g, plate(foot, 0.024, 0.005), sole, [0, 0.012, 0], [-Math.PI / 2, 0, 0]);
  add(g, plate(foot.map(([x, y]) => [x * 0.99, y * 0.97]), 0.012, 0.003), mid, [0, 0.026, 0], [-Math.PI / 2, 0, 0]);
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    add(g, new THREE.BoxGeometry(0.014, 0.012, 0.01), sole, [0.02 + Math.cos(a) * 0.15, 0.005, Math.sin(a) * 0.046], [0, -a, 0]);
  }
  // upper: a convex shell over the foot, stations [x, half width, height]
  const hullOf = (stations, grow = 0) => {
    const pts = [];
    for (const [x, hw, h] of stations) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 13) * Math.PI;
        pts.push(new THREE.Vector3(x, B + Math.sin(a) * (h + grow), Math.cos(a) * (hw + grow)));
      }
    }
    return new ConvexGeometry(pts);
  };
  add(g, hullOf([[0.172, 0.034, 0.03], [0.15, 0.046, 0.05], [0.11, 0.05, 0.066], [0.06, 0.049, 0.086], [0.0, 0.047, 0.11], [-0.06, 0.046, 0.1], [-0.12, 0.042, 0.08], [-0.136, 0.034, 0.066]]), upper);
  // leather toe cap and heel counter over it
  add(g, hullOf([[0.175, 0.034, 0.03], [0.15, 0.046, 0.045], [0.112, 0.05, 0.048]], 0.003), leather);
  add(g, hullOf([[-0.085, 0.045, 0.06], [-0.12, 0.042, 0.062], [-0.139, 0.034, 0.058]], 0.003), leather);
  // shaft (leaning a touch forward), padded collar, pull loop
  add(g, new THREE.CylinderGeometry(0.052, 0.058, 0.17, 26), upper, [-0.058, 0.165, 0], [0, 0, -0.1], [1, 1, 0.86]);
  add(g, new THREE.TorusGeometry(0.052, 0.012, 8, 26), leather, [-0.049, 0.25, 0], [Math.PI / 2, 0.1, 0], [1, 0.86, 1]);
  add(g, new THREE.TorusGeometry(0.012, 0.0035, 6, 12, Math.PI), lace, [-0.108, 0.262, 0], [0, Math.PI / 2, 0.1]);
  // tongue under the laces, poking out above the collar
  add(g, slab(0.046, 0.19, 0.012, 0.016, 0.004), leather, [0.0, 0.18, 0], [0, Math.PI / 2, 0.1]);
  // lacing line: eyelets low on the instep, speed hooks up the shaft, laces crossing between
  const line = [[0.085, 0.104], [0.06, 0.118], [0.035, 0.132], [0.012, 0.147], [0.004, 0.172], [0.007, 0.198], [0.01, 0.224], [0.013, 0.25]];
  const side = 0.021;
  for (let i = 0; i < line.length; i++) {
    const [x, y] = line[i];
    for (const s of [-1, 1]) {
      const eye = add(g, i > 3 ? new THREE.TorusGeometry(0.0052, 0.0016, 6, 12, Math.PI * 1.4) : new THREE.TorusGeometry(0.0042, 0.0014, 6, 12), hook, [x + 0.004, y, s * side]);
      eye.rotation.set(0, s > 0 ? 0 : Math.PI, 0.9);
      if (i < line.length - 1) {
        const [x1, y1] = line[i + 1];
        capsuleAt(g, lace, [x + 0.006, y, s * side], [x1 + 0.006, y1, -s * side], 0.0021, 6);
      }
    }
  }
  // eyelet stays: leather strips along both sides of the lacing
  for (const s of [-1, 1]) capsuleAt(g, leather, [0.09, 0.1, s * 0.028], [0.0, 0.16, s * 0.03], 0.006, 6);
  return g;
}

/** COMBAT BOOTS: a pair, one a step ahead of the other. */
export function combatBoots() {
  const g = new THREE.Group();
  g.name = 'combatBoots';
  const r = boot();
  r.position.set(0.02, -0.12, -0.065);
  r.rotation.y = -0.12;
  g.add(r);
  const l = boot();
  l.scale.z = -1; // the left foot mirrors the right one
  l.position.set(-0.02, -0.12, 0.07);
  l.rotation.y = 0.1;
  g.add(l);
  return g;
}

/** One tactical glove (right hand, palm down, fingers toward +Z, thumb +X): coyote back, knuckle armor, velcro cuff. */
function glove() {
  const g = new THREE.Group();
  const weave = weaveTex();
  const back = mat('glBack', { color: 0x7a6547, roughness: 0.92, bumpMap: weave, bumpScale: 0.5 });
  const palm = mat('glPalm', { color: 0x1f1d1b, roughness: 0.62 });
  const armor = mat('glArmor', { color: 0x1b1b1c, roughness: 0.32, metalness: 0.05 });
  const strap = mat('glStrap', { color: 0x1a1a1a, roughness: 0.8 });
  const tag = mat('glTag', { color: 0x9a8a60, roughness: 0.9 });

  // hand: coyote back over a black palm
  add(g, slab(0.086, 0.098, 0.022, 0.03, 0.009), back, [0, 0.004, 0], [-Math.PI / 2, 0, 0]);
  add(g, slab(0.088, 0.1, 0.012, 0.03, 0.004), palm, [0, -0.008, 0.002], [-Math.PI / 2, 0, 0]);
  // cuff: an open sleeve with a velcro strap and pull tab
  const cuff = add(g, new THREE.CylinderGeometry(0.042, 0.044, 0.05, 22, 1, true), back, [0, -0.002, -0.07], [Math.PI / 2, 0, 0], [1, 1, 0.55]);
  cuff.material.side = THREE.DoubleSide;
  add(g, slab(0.094, 0.03, 0.01, 0.01, 0.003), strap, [0.004, 0.02, -0.074], [-Math.PI / 2 + 0.06, 0, 0]);
  add(g, new THREE.BoxGeometry(0.022, 0.004, 0.026), tag, [0.046, 0.024, -0.074]);
  // fingers: two segments each, relaxed; black leather tips, padded plates on the backs
  const fingers = [
    [0.03, 0.07, 0.0086],
    [0.01, 0.079, 0.0088],
    [-0.01, 0.074, 0.0084],
    [-0.029, 0.06, 0.0078],
  ];
  fingers.forEach(([x, len, r], i) => {
    const spread = (1.5 - i) * 0.05;
    const a = [x, 0.001, 0.046];
    const m = [x + Math.sin(spread) * len * 0.55, -0.002, 0.046 + Math.cos(spread) * len * 0.55];
    const b = [m[0] + Math.sin(spread) * len * 0.42, -0.014, m[2] + Math.cos(spread) * len * 0.4];
    capsuleAt(g, back, a, m, r);
    capsuleAt(g, palm, m, b, r * 0.96);
    add(g, slab(0.014, 0.02, 0.005, 0.005, 0.0018), armor, [(a[0] + m[0]) / 2, r + 0.0015, (a[2] + m[2]) / 2 + 0.004], [-Math.PI / 2 - 0.05, spread, 0]);
  });
  // thumb, out along the +X side
  capsuleAt(g, back, [0.036, -0.004, -0.012], [0.058, -0.008, 0.02], 0.0098);
  capsuleAt(g, palm, [0.058, -0.008, 0.02], [0.07, -0.014, 0.046], 0.0092);
  // molded knuckle guard
  add(g, slab(0.078, 0.026, 0.012, 0.012, 0.005), armor, [0, 0.017, 0.038], [-Math.PI / 2 + 0.15, 0, 0]);
  for (let i = 0; i < 4; i++) add(g, new THREE.SphereGeometry(0.0085, 12, 8), armor, [0.03 - i * 0.02, 0.022, 0.04], null, [1, 0.55, 0.9]);
  return g;
}

/** TACTICAL GLOVES: a pair, one lying on the other. */
export function tacticalGloves() {
  const g = new THREE.Group();
  g.name = 'tacticalGloves';
  // side by side, palms down, thumbs toward each other, the right one tucked half under the left
  const r = glove();
  r.position.set(-0.05, 0.0, -0.01);
  r.rotation.set(0, -0.42, 0.06);
  g.add(r);
  const l = glove();
  l.scale.x = -1; // the left hand mirrors the right one
  l.position.set(0.05, 0.012, 0.012);
  l.rotation.set(0, 0.36, -0.1);
  g.add(l);
  return g;
}
