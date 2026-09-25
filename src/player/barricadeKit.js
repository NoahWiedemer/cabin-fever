// Barricade kit (store equipment, see world/barricades.js): a claw hammer in the right hand and a
// twine-tied bundle of planks in the left. Same contract as the gun builders in gunModels.js: root at
// the right hand's grip, forward -Z, hand empties for the IK arms, animatable `parts` (the viewmodel
// swings `hammer` about its pivot and pushes `bundle` forward while nailing). Also home of the plank
// geometry shared with the world barricades.
import * as THREE from 'three';
import { handTarget } from './gunModels.js';
import { getMaterial } from '../world/materials.js';

/**
 * Board along X (length), width along Y, thickness along Z, with UVs in world meters so a world
 * wood texture shows one board without seams. grain 'u' = boards run along U (woodFloor: V picks
 * one of its 11 boards), 'v' = grain along V (woodBeam).
 */
export function plankGeo(len, w, t, { mpr = 1.5, grain = 'v', seed = 0 } = {}) {
  const g = new THREE.BoxGeometry(len, w, t);
  const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
  const r = (k) => {
    const x = Math.sin(seed * 127.1 + k * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const uo = r(1) * 4, board = Math.floor(r(2) * 11);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    // along the grain / across it, in meters
    const along = nx > 0.5 ? z * 0.3 : x;
    const across = ny > 0.5 ? (y > 0 ? w / 2 - 0.004 : -w / 2 + 0.004) + z * 0.3 : y;
    if (grain === 'u') {
      const v = (board + 0.1 + 0.8 * (across / w + 0.5)) / 11;
      uv.setXY(i, along / mpr + uo, v);
    } else {
      uv.setXY(i, across / mpr + uo * 0.37, along / mpr + uo);
    }
  }
  return g;
}

let _mats = null;
function mats() {
  if (_mats) return _mats;
  const wood = getMaterial('woodFloor');
  _mats = {
    planks: [wood, getMaterial('woodFloor', { color: 0xe6dccd }), getMaterial('woodFloor', { color: 0xd2c6b6 })],
    mpr: wood.userData.metersPerRepeat || 2,
    handle: new THREE.MeshStandardMaterial({ color: 0x9a6a3c, roughness: 0.55, metalness: 0 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x1e1c1b, roughness: 0.85, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x5d6168, roughness: 0.42, metalness: 0.9 }),
    face: new THREE.MeshStandardMaterial({ color: 0xb4b8be, roughness: 0.25, metalness: 1 }),
    twine: new THREE.MeshStandardMaterial({ color: 0x8c7650, roughness: 0.95, metalness: 0 }),
    nail: new THREE.MeshStandardMaterial({ color: 0x8b8d90, roughness: 0.4, metalness: 0.9 }),
  };
  return _mats;
}

const mesh = (geo, mat, parent, pos, rot) => {
  const m = new THREE.Mesh(geo, mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

function nail(parent, pos, rot, M) {
  const g = new THREE.Group();
  g.position.set(pos[0], pos[1], pos[2]);
  g.rotation.set(rot[0], rot[1], rot[2]);
  mesh(new THREE.CylinderGeometry(0.0021, 0.0019, 0.062, 6), M.nail, g, [0, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.0018, 10), M.nail, g, [0, 0.031, 0]);
  mesh(new THREE.ConeGeometry(0.0021, 0.006, 6), M.nail, g, [0, -0.034, 0], [Math.PI, 0, 0]);
  parent.add(g);
  return g;
}

export function buildBarricadeKit() {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'barricadeKit';

  // ---- claw hammer: `hammer` pivots at the grip (the viewmodel cocks it back and lifts the hand)
  const HA = 0.4; // handle rake: head forward of the hand
  const HR = 0.3; // and leaning out to the right
  const hammer = new THREE.Group();
  hammer.name = 'hammer';
  root.add(hammer);
  const hk = new THREE.Group(); // grip at the root origin
  hammer.add(hk);
  const shaft = new THREE.Group(); // local +Y = handle axis toward the head, grip at the origin
  shaft.rotation.set(-HA, 0, -HR);
  hk.add(shaft);
  mesh(new THREE.CylinderGeometry(0.0125, 0.0145, 0.31, 14), M.handle, shaft, [0, 0.085, 0]);
  mesh(new THREE.CylinderGeometry(0.0165, 0.0165, 0.12, 14), M.grip, shaft, [0, -0.005, 0]);
  mesh(new THREE.CylinderGeometry(0.0155, 0.0165, 0.008, 14), M.grip, shaft, [0, -0.068, 0]);
  // head: face toward -Z (strikes forward), claw toward +Z curling down
  const head = new THREE.Group();
  head.position.set(0, 0.245, 0);
  shaft.add(head);
  mesh(new THREE.BoxGeometry(0.026, 0.034, 0.04), M.steel, head, [0, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.012, 0.0135, 0.04, 16), M.steel, head, [0, 0, -0.038], [Math.PI / 2, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.007, 16), M.face, head, [0, 0, -0.061], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) {
    // split claw: two tapering prongs swept back and down
    mesh(new THREE.BoxGeometry(0.009, 0.011, 0.06), M.steel, head, [s * 0.0065, -0.008, 0.045], [0.45, 0, 0]);
    mesh(new THREE.BoxGeometry(0.008, 0.008, 0.028), M.steel, head, [s * 0.0065, -0.028, 0.076], [0.95, 0, 0]);
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.set(0, 0, -0.065);
  head.add(muzzle);
  const rightHand = handTarget('rightHand', shaft, [0, 0, 0], [-1, 0, 0], [0, 1, 0], false, { rx: 0.0165, rz: 0.021, curl: 1.02, thumb: 0.85 });

  // ---- bundle of planks gripped upright in the left fist (bundle -Z = up, leaning forward and out),
  // tied with twine, nails tucked under it
  const bundle = new THREE.Group();
  bundle.name = 'bundle';
  bundle.position.set(-0.36, 0.06, -0.2);
  bundle.rotation.set(1.05, 0.3, 0.45);
  root.add(bundle);
  const T = 0.022, W = 0.1, L = 0.42;
  const planks = [
    [0.004, 0, 0.0, 0.0],
    [-0.006, T + 0.002, -0.03, 0.03],
    [0.008, 2 * T + 0.004, 0.02, -0.025],
  ];
  // plank geometry runs along X: turn it so the boards point forward (-Z), broad face up
  const lay = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
  planks.forEach(([x, y, z, yaw], i) => {
    const g = plankGeo(L + (i === 1 ? 0.04 : 0), W, T, { mpr: M.mpr, grain: 'u', seed: 11 + i });
    const m = mesh(g, M.planks[i % M.planks.length], bundle, [x, y, z]);
    m.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw).multiply(lay);
  });
  const H = 3 * T + 0.004;
  for (const z of [-0.13, 0.155]) {
    mesh(new THREE.BoxGeometry(W + 0.012, H + 0.01, 0.012), M.twine, bundle, [0.001, H / 2 - T / 2, z]);
  }
  for (const [x, z, yaw] of [[-0.02, -0.1, 0.2], [0.012, -0.06, -0.15], [0.03, -0.12, 0.05]]) {
    nail(bundle, [x, H - T / 2 + 0.003, z], [Math.PI / 2, 0, yaw], M);
  }
  // the fist wraps the bundle from the front: palm on the near broad face, knuckles along the planks
  const leftHand = handTarget('leftHand', bundle, [0.0, T, 0.07], [0, -1, 0], [0, 0, -1], true, { rx: 0.04, rz: 0.05, curl: 0.95, thumb: 0.6 });

  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });
  root.updateMatrixWorld(true);
  return {
    root,
    muzzle,
    ejectPort: null,
    rightHand,
    leftHand,
    sight: { eye: new THREE.Vector3(0, 0.06, 0.1) },
    parts: { hammer, bundle },
    shellType: null,
  };
}
