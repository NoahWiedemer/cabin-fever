// Generator gear (world/power.js): the red jerry can (a pickup upstairs, slot 6 in the hands) and the
// repair tools the viewmodel shows while you fix the generator (a pipe wrench, then the pull-start
// T-handle). Same contract as the gun builders in gunModels.js / barricadeKit.js: root at the right
// hand's grip, forward -Z, hand empties for the IK arms, animatable `parts`.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { handTarget } from './gunModels.js';

// NATO jerry can, 20 l: W across the broad faces (x), H tall, L long (z); the spout sits at the -z end
export const CAN = { W: 0.165, H: 0.47, L: 0.345 };

let _m = null;
function mats() {
  if (_m) return _m;
  // worn red paint: speckled, with scuffed-through edges baked in as darker blotches
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#9a1f14';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.55 ? `rgba(60,10,6,${0.08 + Math.random() * 0.12})` : v < 0.9 ? `rgba(190,70,50,${0.05 + Math.random() * 0.08})` : `rgba(40,34,30,${0.25 + Math.random() * 0.3})`;
    const s = 1 + Math.random() * (v > 0.9 ? 4 : 2);
    g.fillRect(Math.random() * 128, Math.random() * 128, s, s * (0.4 + Math.random()));
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  _m = {
    paint: new THREE.MeshStandardMaterial({ map, color: 0xffffff, roughness: 0.52, metalness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.45, metalness: 0.85 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x8c9096, roughness: 0.32, metalness: 1 }),
    wrench: new THREE.MeshStandardMaterial({ color: 0x1f3f8a, roughness: 0.5, metalness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9, metalness: 0 }),
    cord: new THREE.MeshStandardMaterial({ color: 0xc9c2ae, roughness: 0.95, metalness: 0 }),
    // the fuel stream while pouring (the viewmodel shows it)
    fuel: new THREE.MeshStandardMaterial({ color: 0xc8a050, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false, emissive: 0x3a2a08, emissiveIntensity: 0.6 }),
  };
  return _m;
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

/** The can alone: origin at the bottom centre, spout at -z. Returns { group, grip, rear, spout } (local points). */
export function buildJerryCan() {
  const M = mats();
  const { W, H, L } = CAN;
  const group = new THREE.Group();
  group.name = 'jerryCan';
  // body + the welded seam round its middle
  const paint = [];
  paint.push(new RoundedBoxGeometry(W, H, L, 3, 0.022).translate(0, H / 2, 0));
  paint.push(new RoundedBoxGeometry(0.014, H + 0.01, L + 0.01, 2, 0.01).translate(0, H / 2, 0));
  // the embossed X on both broad faces
  const ang = Math.atan2(H - 0.1, L - 0.1);
  const diag = Math.hypot(H - 0.1, L - 0.1);
  for (const s of [-1, 1]) {
    for (const k of [-1, 1]) {
      const b = new THREE.BoxGeometry(0.008, 0.03, diag);
      b.rotateX(k * ang);
      b.translate(s * (W / 2 + 0.001), H / 2, 0);
      paint.push(b);
    }
    // raised frame just inside the edges
    for (const [w, h, y, z] of [[0.02, H - 0.06, H / 2, L / 2 - 0.035], [0.02, H - 0.06, H / 2, -L / 2 + 0.035], [L - 0.07, 0.02, H - 0.035, 0], [L - 0.07, 0.02, 0.035, 0]]) {
      const b = new THREE.BoxGeometry(0.006, h, w);
      b.translate(s * (W / 2 + 0.0015), y, z);
      paint.push(b);
    }
  }
  // triple carry handle on top: a strip in the length plane with three grip openings
  const sh = new THREE.Shape();
  const hz = 0.125, hy = 0.056;
  sh.moveTo(-hz, 0);
  sh.lineTo(hz, 0);
  sh.lineTo(hz, hy - 0.01);
  sh.quadraticCurveTo(hz, hy, hz - 0.01, hy);
  sh.lineTo(-hz + 0.01, hy);
  sh.quadraticCurveTo(-hz, hy, -hz, hy - 0.01);
  sh.lineTo(-hz, 0);
  for (let i = 0; i < 3; i++) {
    const c = -0.083 + i * 0.083;
    const hole = new THREE.Path();
    hole.moveTo(c - 0.031, 0.008);
    hole.lineTo(c + 0.031, 0.008);
    hole.lineTo(c + 0.031, 0.034);
    hole.quadraticCurveTo(c + 0.031, 0.038, c + 0.027, 0.038);
    hole.lineTo(c - 0.027, 0.038);
    hole.quadraticCurveTo(c - 0.031, 0.038, c - 0.031, 0.034);
    hole.lineTo(c - 0.031, 0.008);
    sh.holes.push(hole);
  }
  const hg = new THREE.ExtrudeGeometry(sh, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 1, curveSegments: 4 });
  hg.translate(0, 0, -0.008);
  hg.rotateY(-Math.PI / 2);
  hg.translate(0, H - 0.004, 0.012);
  // ExtrudeGeometry is indexed with groups; merge wants matching attributes
  const clean = (g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    n.clearGroups();
    return n;
  };
  const body = mesh(mergeGeometries(paint.map(clean).concat([clean(hg)]), false), M.paint, group);
  body.name = 'canBody';
  // spout neck + cap + lever clamp at the front top corner
  const spout = new THREE.Group();
  spout.position.set(0, H - 0.006, -L / 2 + 0.052);
  spout.rotation.x = -0.42; // leaning out over the front
  group.add(spout);
  mesh(new THREE.CylinderGeometry(0.024, 0.027, 0.045, 16), M.paint, spout, [0, 0.022, 0]);
  mesh(new THREE.CylinderGeometry(0.031, 0.031, 0.024, 16), M.dark, spout, [0, 0.055, 0]);
  mesh(new THREE.TorusGeometry(0.031, 0.004, 5, 16), M.dark, spout, [0, 0.046, 0], [Math.PI / 2, 0, 0]);
  mesh(new THREE.BoxGeometry(0.012, 0.01, 0.1), M.dark, spout, [0, 0.07, 0.05], [0.3, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.03, 8), M.steel, spout, [0, 0.062, 0.1], [0, 0, Math.PI / 2]);
  // breather cap at the rear
  mesh(new THREE.CylinderGeometry(0.011, 0.012, 0.012, 10), M.dark, group, [0, H + 0.003, L / 2 - 0.04]);
  return {
    group,
    grip: new THREE.Vector3(0, H + 0.043, 0.012),
    rear: new THREE.Vector3(0, H + 0.043, 0.012 + 0.083),
    spout: new THREE.Vector3(0, H + 0.06, -L / 2 + 0.02),
  };
}

/**
 * First-person gas can: carried by the middle handle (right hand), broadside to you with the spout on
 * the left. To pour, the left hand comes up under the spout end and the can rolls over to the left.
 */
export function buildGasCanViewmodel() {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'gascan';
  const can = buildJerryCan();
  const canG = new THREE.Group(); // pivots at the grip; the viewmodel rolls `can` to pour
  canG.name = 'can';
  root.add(canG);
  const turn = new THREE.Group(); // broadside: the can's length runs across the view, spout left
  turn.rotation.y = Math.PI / 2;
  canG.add(turn);
  can.group.position.copy(can.grip).negate();
  turn.add(can.group);
  const local = (p) => p.clone().sub(can.grip);
  const grip = { rx: 0.012, rz: 0.018, curl: 1.05, thumb: 0.9 };
  const rightHand = handTarget('rightHand', turn, local(can.grip).toArray(), [0, -1, 0], [0, 0, -1], false, grip);
  // left hand: flat under the spout end's corner, palm against the can (can-local +z)
  const front = local(new THREE.Vector3(0, CAN.H * 0.62, -CAN.L / 2 - 0.012));
  const cup = { rx: 0.02, rz: 0.03, curl: 0.55, thumb: 0.4 };
  const leftHand = handTarget('leftHand', turn, front.toArray(), [0, 0.15, 1], [0, 1, 0], true, cup);
  const leftAnim = handTarget('leftAnim', turn, front.toArray(), [0, 0.15, 1], [0, 1, 0], true, cup);
  const leftFrom = front.clone().add(new THREE.Vector3(0.06, -0.3, -0.1));
  // fuel stream from the spout: a thin tapering column, pointed straight down by animate()
  const stream = new THREE.Group();
  stream.name = 'stream';
  stream.position.copy(local(can.spout));
  turn.add(stream);
  const sg = new THREE.CylinderGeometry(0.009, 0.006, 0.9, 8, 1, true);
  sg.translate(0, -0.45, 0);
  const sm = new THREE.Mesh(sg, M.fuel);
  sm.renderOrder = 3;
  stream.add(sm);
  stream.visible = false;
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.copy(local(can.spout));
  turn.add(muzzle);
  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });
  root.updateMatrixWorld(true);
  const _q = new THREE.Quaternion();
  const _d = new THREE.Vector3();
  const DOWN = new THREE.Vector3(0, -1, 0);
  return {
    root,
    muzzle,
    ejectPort: null,
    rightHand,
    leftHand,
    sight: { eye: new THREE.Vector3(0, 0.08, 0.1) },
    parts: { can: canG, stream },
    shellType: null,
    /** Left hand target partway (k 0..1) from below the can up to the spout end. */
    leftAt(k) {
      leftAnim.position.lerpVectors(leftFrom, leftHand.position, k);
      return leftAnim;
    },
    /** called by the viewmodel after the pose is set: the fuel falls straight down in the world */
    animate() {
      if (!stream.visible) return;
      stream.parent.getWorldQuaternion(_q).invert();
      _d.copy(DOWN).applyQuaternion(_q);
      stream.quaternion.setFromUnitVectors(DOWN, _d);
      const s = 0.85 + Math.random() * 0.3;
      stream.scale.set(s, 1, s);
    },
  };
}

/**
 * Generator repair in first person: `wrench` (a pipe wrench cranking a nut, both hands on the handle,
 * pivoting about its jaw) and `pull` (the pull-start T-handle on its cord, right hand only).
 */
export function buildRepairTool() {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'wrench';
  // ---- pipe wrench: group origin at the jaw, handle running back along local +Z to the right hand (root origin)
  const J = new THREE.Vector3(-0.14, 0.01, -0.34);
  const dir = J.clone().negate();
  const HL = dir.length();
  dir.normalize();
  const wrench = new THREE.Group();
  wrench.name = 'wrench';
  wrench.position.copy(J);
  wrench.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  root.add(wrench);
  // I-beam handle (painted), grip sleeve at the end
  mesh(new THREE.BoxGeometry(0.014, 0.026, HL - 0.03), M.wrench, wrench, [0, 0, (HL + 0.03) / 2]);
  mesh(new THREE.BoxGeometry(0.024, 0.008, HL - 0.04), M.wrench, wrench, [0, 0.012, (HL + 0.04) / 2]);
  mesh(new THREE.BoxGeometry(0.024, 0.008, HL - 0.04), M.wrench, wrench, [0, -0.012, (HL + 0.04) / 2]);
  mesh(new THREE.CylinderGeometry(0.016, 0.017, 0.11, 10), M.rubber, wrench, [0, 0, HL - 0.03], [Math.PI / 2, 0, 0]);
  // head: fixed hook jaw, sliding jaw, knurled adjusting nut
  mesh(new THREE.BoxGeometry(0.03, 0.05, 0.07), M.steel, wrench, [0, 0.005, 0.04]);
  mesh(new THREE.BoxGeometry(0.028, 0.02, 0.05), M.steel, wrench, [0, 0.032, -0.005], [0.2, 0, 0]);
  mesh(new THREE.BoxGeometry(0.028, 0.018, 0.045), M.steel, wrench, [0, -0.03, -0.004], [-0.15, 0, 0]);
  mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.03, 12), M.dark, wrench, [0, 0.002, 0.06]);
  // the nut it's clamped on (turns with it)
  mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.022, 6), M.steel, wrench, [0, 0, -0.004]);
  mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 8), M.dark, wrench, [0, -0.02, -0.004]);
  const wr = handTarget('rightHand', wrench, [0, 0, HL], [0.35, -1, 0], [0, 0, -1], false, { rx: 0.016, rz: 0.02, curl: 1.05, thumb: 0.85 });
  const wl = handTarget('leftHand', wrench, [0, 0, HL * 0.58], [-0.35, -1, 0], [0, 0, -1], true, { rx: 0.014, rz: 0.02, curl: 1.0, thumb: 0.8 });
  // ---- pull-start: T-handle, the cord runs off forward-down to the engine
  const pull = new THREE.Group();
  pull.name = 'pull';
  pull.position.set(-0.12, -0.09, -0.15);
  root.add(pull);
  mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10), M.rubber, pull, [0, 0, 0], [0, 0, Math.PI / 2]);
  for (const s of [-1, 1]) mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 10), M.rubber, pull, [s * 0.052, 0, 0], [0, 0, Math.PI / 2]);
  mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.03, 8), M.rubber, pull, [0, -0.012, -0.012], [-1.0, 0, 0]);
  const cordDir = new THREE.Vector3(-0.15, -0.55, -0.82).normalize();
  const cg = new THREE.CylinderGeometry(0.0025, 0.0025, 1.4, 5, 1, true);
  cg.translate(0, 0.7, 0);
  const cord = new THREE.Mesh(cg, M.cord);
  cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), cordDir);
  cord.position.set(0, -0.02, -0.02);
  pull.add(cord);
  const pr = handTarget('pullHand', pull, [0, 0.004, 0.006], [0, -0.45, -0.9], [-1, 0, 0], false, { rx: 0.016, rz: 0.02, curl: 1.1, thumb: 0.7 });
  pull.visible = false;
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.copy(J);
  root.add(muzzle);
  root.traverse((o) => {
    if (o.isMesh) o.frustumCulled = true;
  });
  root.updateMatrixWorld(true);
  return {
    root,
    muzzle,
    ejectPort: null,
    rightHand: wr,
    leftHand: wl,
    pullHand: pr,
    sight: { eye: new THREE.Vector3(0, 0.08, 0.1) },
    parts: { wrench, pull },
    shellType: null,
  };
}
