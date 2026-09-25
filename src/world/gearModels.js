// Small procedural gear models shared by the cellar gun shop (shelf props) and the store UI
// (3D thumbnails + live preview): a full-face gas mask and a kevlar plate carrier. Both are built
// around their own center, front facing +Z, sized like the real thing (mask ~0.2 m, vest ~0.5 m).
import * as THREE from 'three';

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
