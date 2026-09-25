// Machete (store gear, game/gear.js): replaces the knife in slot 3 while it's worn. A procedural
// first-person model built with gunModels.js' kit (same materials, wear and hand-target contract as
// the knife), plus its own slash pose for the viewmodel. Stats live in weaponDefs.js (`machete`).
//
// Blade space (like the knife): the guard at z = 0, the blade toward -Z, the spine +Y, the edge -Y.
// A 33 cm bolo-bellied blade, black coated, with a bright ground edge and a short saw run on the spine;
// an olive drab polymer handle with black checkered inlays, a finger guard, three rivets and a hooked
// pommel with a steel lanyard eyelet and a paracord loop.
import * as THREE from 'three';
import { gunKit } from './gunModels.js';
import { clamp, lerp, smoothstep } from '../core/utils.js';

const V3 = THREE.Vector3;
const PI = Math.PI;

const BLADE_L = 0.335;
const T = 0.0017; // half blade thickness
const TE = 0.00028; // half thickness at the edge

// the hold: blade forward and up out of the fist, a little across to the left (see the knife)
const DIR = new V3(-0.2, 0.62, -0.76).normalize();
const PALM = [-1, -0.3, 0.12];

const spineAt = (t) => (t < 0.74 ? 0.0112 : 0.0112 - 0.0154 * Math.pow((t - 0.74) / 0.26, 1.5));
function edgeAt(t) {
  if (t < 0.045) return -0.0255; // unsharpened ricasso
  const k = Math.min(1, (t - 0.045) / 0.74);
  const belly = -0.0255 - 0.0205 * Math.pow(Math.sin((PI / 2) * k), 1.25);
  if (t <= 0.785) return belly;
  return -0.046 + 0.0418 * Math.pow((t - 0.785) / 0.215, 1.65); // sweeps up to the tip
}

/** Build the machete viewmodel: { root, muzzle (blade tip), rightHand, leftHand: null, sight, parts: { body, blade } }. */
export function buildMachete() {
  const K = gunKit;
  K.seed(0x3ac4e7e);
  const root = K.grp('machete');
  const B = new K.PB();

  const hq = K.handQuat(PALM, DIR.toArray(), false);
  const Xh = new V3(1, 0, 0).applyQuaternion(hq);
  const Yh = new V3(0, 1, 0).applyQuaternion(hq);
  const Zh = new V3(0, 0, 1).applyQuaternion(hq);
  const body = K.grp('macheteBody', root);
  body.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(Xh, Zh, Yh.clone().negate()));
  // the web of the hand sits just behind the finger guard, centred on the grip's height
  body.position.copy(new V3(0, -0.004, 0.02).applyQuaternion(body.quaternion).negate());

  /* ---- handle: OD polymer body with a finger guard and a hooked pommel ---- */
  const outline = K.rounded(
    [
      [0.0, 0.0138, 0.002],
      [0.03, 0.0158, 0.02],
      [0.07, 0.0172, 0.03],
      [0.112, 0.0158, 0.02],
      [0.131, 0.0132, 0.008],
      [0.1405, 0.0015, 0.008],
      [0.137, -0.027, 0.006],
      [0.124, -0.0315, 0.006],
      [0.114, -0.0232, 0.008],
      [0.098, -0.0205, 0.012],
      [0.083, -0.0238, 0.01],
      [0.066, -0.0205, 0.012],
      [0.05, -0.0238, 0.01],
      [0.033, -0.0212, 0.012],
      [0.02, -0.0232, 0.008],
      [0.011, -0.0335, 0.006],
      [0.0035, -0.0415, 0.004],
      [-0.0025, -0.0392, 0.003],
      [-0.0005, -0.0265, 0.002],
    ],
    0,
    5
  );
  B.add('od', K.extrude(outline, 0.0262, { bevel: 0.0022, bevelSegs: 2, crease: 34 }));
  // black checkered inlays on both faces
  const inlay = K.rounded([[0.024, 0.0105, 0.006], [0.108, 0.0118, 0.008], [0.106, -0.0165, 0.008], [0.026, -0.0165, 0.006]], 0, 4);
  B.add('grip', K.extrude(inlay, 0.0282, { bevel: 0.0008, crease: 30 }));
  // exposed tang along the spine and the butt, between the scales
  B.add('blade', K.cbox(0.0036, 0.0022, 0.126, 0.0004, [0, 0.0159, 0.064]), 0.9);
  // rivets (steel, domed) through both scales
  for (const [z, y] of [[0.036, -0.003], [0.074, -0.0035], [0.106, -0.003]]) {
    for (const sx of [-1, 1]) {
      const head = K.lathe([[0, 0.0016], [0.0022, 0.0013], [0.0032, 0.0005], [0.0034, 0.0], [0, 0.0]], { segs: 18 });
      K.xf(head, [sx * 0.0141, y, z], [0, sx * PI / 2, 0]);
      B.add('steel', head, 0.8);
    }
  }
  // lanyard eyelet in the pommel and a paracord loop hanging from it
  B.add('steel', K.xf(K.tube(0.0041, 0.0027, 0.0292, 18, 0.0005), [0, -0.012, 0.13], [0, PI / 2, 0]), 0.85);
  const cordR = 0.0019;
  const prof = [];
  for (let i = 0; i < 8; i++) prof.push([Math.cos((i / 8) * PI * 2) * cordR, Math.sin((i / 8) * PI * 2) * cordR]);
  const loop = [
    [0.0, -0.012 + 0.0027, 0.13],
    [0.0165, -0.019, 0.137],
    [0.012, -0.045, 0.158],
    [0.0, -0.062, 0.168],
    [-0.012, -0.045, 0.158],
    [-0.0165, -0.019, 0.137],
  ];
  B.add('od', K.sweep(loop, prof, { closed: true, segs: 40, crease: 60 }), 0.55);
  B.build(body, 'macheteHandle');

  /* ---- blade (parts.blade) ---- */
  const blade = K.grp('blade', body);
  const N = 40;
  const up = [], grind = [], edge = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const z = -BLADE_L * t;
    const s = spineAt(t);
    const e = Math.min(edgeAt(t), s);
    // flat grind: ~1 cm of bright bevel along the edge, running out at the ricasso and the tip
    const bev = t < 0.045 ? 0.0006 : lerp(0.012, 0.0095, t);
    const g = Math.min(s - 0.0012 * (1 - t) - 0.0002, e + bev);
    up.push([z, s]);
    grind.push([z, g]);
    edge.push([z, e]);
  }
  // coated flat body: spine -> grind line
  const bodyOut = [...up.map((p) => [p[0], p[1]]), ...grind.slice(0, N).reverse().map((p) => [p[0], p[1]])];
  B.add('blade', K.extrude(bodyOut, 2 * T, { bevel: 0.00045, crease: 30 }), 1.45); // a worn, lighter coat than the knife's
  // the ground edge: grind line -> edge, both faces, plus the thin edge strip
  {
    const A = new K.Acc();
    for (let i = 0; i < N; i++) {
      const g0 = grind[i], g1 = grind[i + 1], e0 = edge[i], e1 = edge[i + 1];
      for (const sx of [-1, 1]) {
        const a = [sx * T, g0[1], g0[0]], b = [sx * T, g1[1], g1[0]], c = [sx * TE, e1[1], e1[0]], d = [sx * TE, e0[1], e0[0]];
        A.oquad(a, b, c, d, [sx, -0.3, 0], 0.4, 1);
      }
      A.oquad([-TE, e0[1], e0[0]], [TE, e0[1], e0[0]], [TE, e1[1], e1[0]], [-TE, e1[1], e1[0]], [0, -1, 0], 1, 1);
    }
    A.oquad([-T, grind[0][1], 0], [T, grind[0][1], 0], [TE, edge[0][1], 0], [-TE, edge[0][1], 0], [0, 0, 1], 0, 1);
    B.add('edge', A.geo(25));
  }
  // saw teeth on the spine behind the tip
  for (let i = 0; i < 11; i++) {
    const z0 = -0.058 - i * 0.0078;
    const s = spineAt(-z0 / BLADE_L) - 0.0003;
    B.add('blade', K.prism([[z0, s], [z0 - 0.0072, s], [z0 - 0.0052, s + 0.0042]], -T * 0.92, T * 0.92, 0.00018, 'zy'), 0.8);
    B.add('edge', K.prism([[z0 - 0.0046, s + 0.0034], [z0 - 0.0058, s + 0.0034], [z0 - 0.0052, s + 0.0042]], -T * 0.5, T * 0.5, 0.0001, 'zy'), 0.7);
  }
  // a worn, brighter strip where the coating rubbed off along the spine near the guard
  B.add('edge', K.cbox(2 * T + 0.0002, 0.0012, 0.05, 0.0002, [0, spineAt(0.1) - 0.0004, -0.035]), 0.55);
  B.build(blade, 'macheteBlade');

  const muzzle = K.empty('muzzle', body, [0, -0.004, -BLADE_L]);
  const rightHand = K.handTarget('rightHand', root, [0, 0, 0], PALM, DIR.toArray(), false, { rx: 0.0128, rz: 0.0178, curl: 1.0, thumb: 0.9, gy: 0.026 });
  const eye = new V3(0, 0.07, 0.12);
  return K.finishWeapon({ root, muzzle, ejectPort: null, rightHand, leftHand: null, sight: { eye }, parts: { body, blade }, shellType: null });
}

/**
 * The machete's viewmodel swing offsets (Viewmodel.update): a diagonal chop from high right down
 * across to the left (Mouse1), and a big overhead two-count hack (Mouse2). `f` = 0..1 through the
 * swing. Adds into `o` { x, y, z, rx, ry, rz }.
 */
export function macheteSwing(f, heavy, o) {
  if (heavy) {
    const wind = smoothstep(0, 0.34, f) * (1 - smoothstep(0.34, 0.46, f)); // blade raised back over the shoulder
    const chop = smoothstep(0.36, 0.5, f) * (1 - smoothstep(0.62, 1, f)); // and brought down hard
    o.x += 0.05 * wind - 0.14 * chop;
    o.y += 0.12 * wind - 0.1 * chop;
    o.z += 0.06 * wind - 0.2 * chop;
    o.rx += 0.95 * wind - 1.1 * chop;
    o.ry += 0.2 * wind + 0.35 * chop;
    o.rz += 0.25 * wind - 0.35 * chop;
    return o;
  }
  const up = smoothstep(0, 0.16, f) * (1 - smoothstep(0.16, 0.26, f)); // cock it back
  const sw = smoothstep(0.16, 0.36, f); // the cut: high right -> low left
  const out = 1 - smoothstep(0.55, 1, f); // recover
  const k = clamp(sw * out, 0, 1);
  o.x += 0.06 * up + lerp(0.1, -0.24, sw) * k;
  o.y += 0.07 * up + lerp(0.08, -0.12, sw) * k;
  o.z -= 0.14 * k;
  o.rx += 0.35 * up + lerp(0.45, -0.55, sw) * k;
  o.ry += lerp(-0.6, 0.9, sw) * k;
  o.rz += -0.25 * up + lerp(0.7, -0.5, sw) * k;
  return o;
}
