// The gun shop clerk behind the cellar counter: a GLB character (UniRig skeleton, mapped by topology
// in gltfCharacter.js) driven procedurally like the bots. Not an actor in the fight: nothing targets
// her, she never moves and only animates while the camera is in the cellar.
//
// Animation: a small idle state machine picks base poses (standing, leaning on the counter, crossed
// arms, hands on hips) and gestures (scratching the head, rubbing the neck, checking the watch, wiping
// the counter, stretching, a neck stretch). A switch crossfades from a snapshot of the current pose
// with a smoothstep, so nothing pops however often it changes. On top run breathing, a slow weight
// shift, idle glances and the look toward a customer at the counter (head first, body following).
// Hands are IK'd (teammate.js reach) with the forearm taking half of the wrist twist; the feet stay
// planted with a two-bone leg IK, so hip sway, the lean and the weight shift bend the knees.
import * as THREE from 'three';
import { createGLBCharacter } from './gltfCharacter.js';
import { reach, frameQuat } from './teammate.js';
import { clamp, damp, rand } from '../core/utils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const X = V(1, 0, 0);
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** 0 → 1 → 0 over [a, b] (smooth ends), for one-shot moves inside a gesture */
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * ((t - a) / (b - a))) ** 2);
/** 0 → 1 over [a, a + r], held, 1 → 0 over [b - r, b] */
const hold = (t, a, b, r) => ease((t - a) / r) * ease((b - t) / r);

const _a = V(), _b = V(), _c = V(), _S = V(), _n = V(), _m = V(), _u = V(), _f = V(), _x = V(), _T = V(), _P = V(), _A = V(), _N = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qw = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _qt = new THREE.Quaternion();

// torso channels (character space: +z forward, +x her left, +y up; radians, hips offset in meters)
const CH = ['hx', 'hy', 'hz', 'hrx', 'hry', 'hrz', 'sx', 'sy', 'sz', 'cx', 'cy', 'cz', 'nx', 'ny', 'nz', 'ex', 'ey', 'ez', 'look'];
const ARM_BONES = ['upperArm', 'foreArm', 'hand'];

/** reusable pose output: torso channels + one IK spec per arm + optional look target */
function makePose() {
  const arm = () => ({ rel: 'shoulder', t: V(), along: V(), palm: V(), pole: V() });
  return { L: arm(), R: arm(), lookAt: null, lookAtV: V() };
}

/**
 * Two-bone leg IK on the proxy bones (hinge = local X, the knee bends toward `pole`), foot set to the
 * world orientation `footQ`. Mirror of teammate.js reach() for a joint that flexes the other way.
 */
function legIK(thigh, shin, foot, target, pole, footQ) {
  const a = shin.position.length(), c = foot.position.length();
  thigh.getWorldPosition(_S);
  _n.copy(target).sub(_S);
  const d = clamp(_n.length(), Math.abs(a - c) + 0.02, (a + c) * 0.9995);
  _n.normalize();
  const cosA = clamp((a * a + d * d - c * c) / (2 * a * d), -1, 1);
  _m.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
  _u.copy(_n).multiplyScalar(cosA).addScaledVector(_m, Math.sqrt(1 - cosA * cosA)); // hip → knee
  _f.copy(_S).addScaledVector(_n, d).sub(_T.copy(_S).addScaledVector(_u, a)).normalize(); // knee → ankle
  _x.crossVectors(_m, _n).normalize(); // hinge: her left for a forward knee
  _A.copy(shin.position).normalize();
  frameQuat(_A, X, _u, _x, _qw);
  thigh.parent.getWorldQuaternion(_qp);
  thigh.quaternion.copy(_qp.invert().multiply(_qw));
  _N.copy(X).addScaledVector(_A, -X.dot(_A)).normalize();
  shin.quaternion.setFromAxisAngle(_N, Math.acos(clamp(_u.dot(_f), -1, 1)));
  _qw.multiply(shin.quaternion).invert();
  foot.quaternion.copy(_qw.multiply(footQ));
}

/** move a share `k` of the hand's twist about the forearm axis into the forearm (no candy-wrapper wrist) */
function spreadTwist(fore, hand, k) {
  _a.copy(hand.position).normalize();
  const q = hand.quaternion;
  const d = q.x * _a.x + q.y * _a.y + q.z * _a.z;
  _q.set(_a.x * d, _a.y * d, _a.z * d, q.w);
  if (_q.lengthSq() < 1e-8) return;
  _q.normalize();
  _q2.identity().slerp(_q, k);
  fore.quaternion.multiply(_q2);
  hand.quaternion.premultiply(_q2.invert());
}

// ---------------------------------------------------------------- poses
// fn(o, t, K): write torso channels / arm specs for time t in the state. Arms default to hanging.
// K.side(s) helpers live on the keeper (counter height, rag, ...). s = +1 left, -1 right.
function hang(a, s, lift = 0) {
  a.rel = 'shoulder';
  a.t.set(s * 0.05, -0.4 + lift, 0.07);
  a.along.set(s * 0.05, -1, 0.14);
  a.palm.set(-s, 0, 0.12);
  a.pole.set(s * 0.3, 0, -1);
}

const POSES = {
  stand: {
    base: true,
    dur: [3, 6],
    w: [2, 1.6],
    fn(o) {
      o.sx = 0.03;
      o.ex = 0.03;
    },
  },
  // both hands on the counter, hinged at the hips: the default "can I help you" pose
  lean: {
    base: true,
    dur: [5, 10],
    w: [3, 6],
    fn(o, t, K) {
      o.hrx = 0.24;
      o.hz = -0.045;
      o.hy = -0.035;
      o.sx = 0.05;
      o.cx = 0.02;
      o.nx = -0.1;
      o.ex = -0.1;
      K.onCounter(o.L, 1, 0.2, 0);
      K.onCounter(o.R, -1, 0.2, 0);
    },
  },
  crossed: {
    base: true,
    dur: [4, 8],
    w: [2, 1.4],
    fn(o, t) {
      o.hx = 0.03;
      o.hrz = 0.06;
      o.sz = -0.04;
      o.sx = -0.03;
      o.ex = 0.02;
      const L = o.L, R = o.R;
      // forearms stacked under the chest (right under, left over), wrists just past the middle and
      // the fingers wrapping round the other side: the rig's short reach (clavicle pivot) can't put
      // the hands at the opposite elbows without driving the elbows into the ribs
      R.rel = L.rel = 'chest';
      R.t.set(0.015, -0.155, 0.095);
      R.along.set(1, 0.05, -0.3);
      R.palm.set(0.25, 0.2, -1);
      R.pole.set(-1, -0.7, 0);
      L.t.set(-0.045, -0.125, 0.125);
      L.along.set(-1, -0.05, -0.3);
      L.palm.set(-0.25, -0.3, -1);
      L.pole.set(1, -0.7, 0);
      // a slow tap of the fingers of the top hand
      L.t.y += Math.sin(t * 2.1) * 0.004;
    },
  },
  hips: {
    base: true,
    dur: [3, 6],
    w: [1, 1],
    fn(o) {
      o.hx = -0.025;
      o.hrz = -0.05;
      o.sx = -0.02;
      for (const [a, s] of [[o.L, 1], [o.R, -1]]) {
        a.rel = 'root';
        a.t.set(s * 0.19, 1.02, -0.01);
        a.along.set(-s * 0.35, -0.6, 0.45);
        a.palm.set(-s, 0.2, 0);
        a.pole.set(s, 0.3, -0.5);
      }
    },
  },
  scratchHead: {
    dur: [2.6, 3.4],
    w: [1, 0.35],
    fn(o, t) {
      o.ex = 0.14;
      o.ez = -0.12;
      o.nx = 0.05;
      o.look = 0.4;
      const R = o.R;
      R.rel = 'head';
      R.t.set(-0.05, 0.13, -0.05);
      R.along.set(0.3, 0.6, 0.6);
      R.palm.set(0.5, -0.6, 0);
      R.pole.set(-1, 0.4, 0.2);
      const k = ease((t - 0.5) / 0.3);
      R.t.x += Math.sin(t * 24) * 0.012 * k;
      R.t.z += Math.cos(t * 24) * 0.01 * k;
    },
  },
  rubNeck: {
    dur: [2.8, 3.6],
    w: [1, 0.3],
    fn(o, t) {
      o.ex = 0.2 + Math.sin(t * 1.7) * 0.05;
      o.nx = 0.12;
      o.ez = Math.sin(t * 1.3) * 0.12;
      o.look = 0.3;
      const R = o.R;
      R.rel = 'neck';
      R.t.set(-0.02, 0.02, -0.1);
      R.along.set(0.9, 0.3, 0.1);
      R.palm.set(0, 0, 1);
      R.pole.set(-1, 0.2, 0.6);
      R.t.y += Math.sin(t * 5.5) * 0.02 * ease((t - 0.5) / 0.3);
    },
  },
  watch: {
    dur: [2.2, 2.8],
    w: [1, 0.4],
    fn(o, t, K) {
      // left forearm raised in front, back of the wrist up
      const L = o.L;
      L.rel = 'root';
      L.t.set(0.11, 1.23, 0.27);
      L.along.set(-0.6, 0.1, 1);
      L.palm.set(0, -1, 0);
      L.pole.set(1, -1, -0.3);
      // a shake of the wrist halfway through (is it still running?)
      L.t.x += Math.sin(t * 30) * 0.008 * bump(t, 1.1, 1.5);
      o.ex = 0.1;
      o.look = 1;
      o.lookAt = K.boneWorld('handL', o.lookAtV);
    },
  },
  wipe: {
    dur: [4.5, 6.5],
    w: [1.2, 0.5],
    fn(o, t, K) {
      o.hrx = 0.27;
      o.hz = -0.05;
      o.hy = -0.035;
      o.sx = 0.08;
      o.ex = 0.08;
      K.onCounter(o.L, 1, 0.22, 0);
      K.wipeHand(o.R, t);
      o.look = 1;
      o.lookAt = K.ragWorld(o.lookAtV);
    },
    enter: (K) => K.grabRag(),
    exit: (K) => K.dropRag(),
  },
  // hands on the lower back, arching back and looking up
  stretch: {
    dur: [3, 3.6],
    w: [0.7, 0.2],
    fn(o, t) {
      const k = hold(t, 0.3, 3.1, 0.7);
      o.hz = 0.015 * k;
      o.sx = -0.07 * k;
      o.cx = -0.04 * k;
      o.nx = -0.08 * k;
      o.ex = -0.22 * k;
      o.look = 1 - k;
      for (const [a, s] of [[o.L, 1], [o.R, -1]]) {
        a.rel = 'root';
        a.t.set(s * 0.12, 1.02, -0.17);
        a.along.set(-s * 0.4, -0.75, -0.2);
        a.palm.set(0, 0.1, 1);
        a.pole.set(s, 0, -0.6);
      }
    },
  },
  // neck stretch: tilt to one side, the other, roll forward; the shoulders drop with a sigh
  neckRoll: {
    dur: [3, 3.4],
    w: [0.8, 0.25],
    fn(o, t) {
      o.ez = 0.3 * bump(t, 0.2, 1.3) - 0.3 * bump(t, 1.1, 2.2);
      o.nz = o.ez * 0.5;
      o.ex = 0.25 * bump(t, 1.9, 3.1);
      o.nx = o.ex * 0.4;
      o.look = 0.2;
      const sigh = bump(t, 0.1, 1.2);
      hang(o.L, 1, 0.03 * sigh);
      hang(o.R, -1, 0.03 * sigh);
    },
  },
  // triggered when the store opens: a raised hand and a nod
  greet: {
    dur: [1.9, 1.9],
    w: [0, 0],
    blend: 0.4,
    fn(o, t, K) {
      o.sx = -0.02;
      o.look = 1;
      const R = o.R;
      R.rel = 'shoulder';
      R.t.set(-0.12, 0.08, 0.2);
      R.along.set(-0.15, 1, 0.25);
      R.palm.set(0, -0.1, 1);
      R.pole.set(-1, -0.8, 0);
      R.t.x += Math.sin(t * 10) * 0.035 * hold(t, 0.3, 1.5, 0.2);
      K.onCounter(o.L, 1, 0.19, 0);
      o.hrx = 0.08;
    },
  },
  // shot at: duck, hunch and cover the face with both forearms, peek out at the end
  cower: {
    dur: [1.7, 2.1],
    w: [0, 0],
    blend: 0.16,
    fn(o, t) {
      const k = hold(t, 0, 1.9, 0.12);
      const peek = bump(t, 1.2, 1.9);
      o.hy = -0.13 * k;
      o.hz = -0.04 * k;
      o.hrx = 0.28 * k;
      o.sx = 0.16 * k;
      o.cx = 0.12 * k;
      o.nx = 0.1 * k;
      o.ex = (0.3 - 0.35 * peek) * k;
      o.look = peek;
      for (const [a, s] of [[o.L, 1], [o.R, -1]]) {
        a.rel = 'head';
        a.t.set(s * 0.07, 0.02 - 0.05 * peek, 0.16);
        a.along.set(-s * 0.55, 0.8, 0.1);
        a.palm.set(0, 0, -1);
        a.pole.set(s, -0.6, 0.2);
      }
    },
  },
};
for (const k in POSES) POSES[k].name = k;
const BASES = Object.values(POSES).filter((p) => p.base);

// ---------------------------------------------------------------- keeper
/**
 * parent: scene node; opts: { pos (feet, world), yaw, counter: { edge (world x of the counter's back
 * edge), top (world y) }, glances: [world points to glance at] }. Returns null if the GLB is missing.
 */
export function createShopkeeper(parent, opts) {
  // her albedo is much lighter than the cellar's brick and wood: tone it down so she doesn't glow
  // under the counter lamp
  const c = createGLBCharacter('shopkeeper', 1, { tint: 0x9a948e });
  if (!c) return null;
  const { root, bones: b, rig } = c;
  root.position.copy(opts.pos);
  root.rotation.set(0, opts.yaw ?? 0, 0);
  parent.add(root);
  root.updateMatrixWorld(true);
  rig.sync();

  // rest measurements (root space)
  const rest = {};
  for (const k of ['footL', 'footR', 'upperArmL', 'upperArmR', 'head']) rest[k] = root.worldToLocal(b[k].getWorldPosition(V()));
  const hips0 = b.hips.position.clone();
  const feet = { L: rest.footL.clone().add(V(0.02, 0, 0.01)), R: rest.footR.clone().add(V(-0.02, 0, 0.01)) };
  const footTurn = { L: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.12, 0)), R: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.12, 0)) };
  const kneePole = { L: V(0.15, 0, 1).normalize(), R: V(-0.15, 0, 1).normalize() };
  const edgeZ = opts.counter.edge - opts.pos.x; // counter back edge along her forward axis (yaw = +x)
  const topY = opts.counter.top - opts.pos.y;

  // the rag lies on the counter; while wiping it slides along under her palm and stays where the
  // circles ended
  const rag = new THREE.Mesh(ragGeometry(), new THREE.MeshStandardMaterial({ color: 0x8a3a2c, roughness: 1, side: THREE.DoubleSide }));
  rag.castShadow = false;
  rag.receiveShadow = true;
  const ragHome = V(-0.2, topY + 0.004, edgeZ + 0.08);
  rag.position.copy(ragHome);
  rag.rotation.y = 0.3;
  root.add(rag);
  let ragGrab = 0; // 0 lying, 1 hand on its way, 2 under the palm
  const ragOff = V();

  // a plain wristwatch on the left wrist, so checking the time reads from across the counter
  const watch = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0035, 5, 18), new THREE.MeshStandardMaterial({ color: 0x1b1a18, roughness: 0.6 }));
  band.scale.set(1, 0.8, 2.2);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.007, 14), new THREE.MeshStandardMaterial({ color: 0xb8b2a0, roughness: 0.3, metalness: 0.8 }));
  face.rotation.x = Math.PI / 2;
  face.position.z = -0.03;
  watch.add(band, face);
  // forearm space: the band sits just above the wrist, its ring around the forearm axis
  const axis = b.handL.position.clone().normalize();
  watch.position.copy(b.handL.position).multiplyScalar(0.9);
  watch.quaternion.setFromUnitVectors(V(0, 0, 1), axis);
  b.foreArmL.add(watch);

  const cur = new Float32Array(CH.length);
  const from = new Float32Array(CH.length);
  const pose = makePose(); // target of the current state (torso channels are plain fields on it)
  const P = {}; // blended torso + overlays
  const snap = {}; // arm quaternions at the start of the blend
  for (const s of ['L', 'R']) for (const n of ARM_BONES) snap[n + s] = new THREE.Quaternion();

  const K = {
    /** hand flat on the counter top at lateral offset x (root space), fingers forward */
    onCounter(a, s, x, dz) {
      a.rel = 'root';
      a.t.set(s * x, topY + 0.05, edgeZ + 0.06 + dz);
      a.along.set(-s * 0.25, -0.45, 1);
      a.palm.set(0, -1, 0.15);
      a.pole.set(s * 0.9, -0.1, -1);
    },
    /** wrist over the rag (palm ~6 cm ahead of the wrist), then circles once the hand is down */
    wipeHand(a, t) {
      const k = ease((t - 0.7) / 0.5) * ease((st.dur - 0.4 - t) / 0.5);
      const ang = t * 5.2;
      a.rel = 'root';
      a.t.set(-0.17 + Math.cos(ang) * 0.07 * k, topY + 0.045, edgeZ + 0.02 + Math.sin(ang) * 0.03 * k);
      a.along.set(0.25, -0.45, 1);
      a.palm.set(0, -1, 0.15);
      a.pole.set(-0.9, -0.1, -1);
    },
    grabRag() {
      ragGrab = 1;
    },
    dropRag() {
      ragGrab = 0;
    },
    ragWorld(out) {
      return rag.getWorldPosition(out);
    },
    boneWorld(n, out) {
      return b[n].getWorldPosition(out);
    },
  };

  // ---- state machine
  const st = { pose: POSES.stand, t: 0, dur: 4, blendT: 1, blendDur: 0.8 };
  let engagedPrev = false, storePrev = false, nodT = 9, nodCd = 0;
  const ALL = Object.values(POSES);
  const pick = (engaged, basesOnly) => {
    const list = st.pose.base && !basesOnly ? ALL : BASES;
    let sum = 0;
    for (const p of list) if (p !== st.pose) sum += p.w[engaged ? 1 : 0];
    let r = Math.random() * sum;
    for (const p of list) {
      if (p === st.pose) continue;
      r -= p.w[engaged ? 1 : 0];
      if (r <= 0) return p;
    }
    return BASES[0];
  };
  const enter = (p) => {
    st.pose.exit?.(K);
    from.set(cur);
    for (const s of ['L', 'R']) for (const n of ARM_BONES) snap[n + s].copy(b[n + s].quaternion);
    st.pose = p;
    st.t = 0;
    st.dur = rand(p.dur[0], p.dur[1]);
    st.blendT = 0;
    st.blendDur = p.blend ?? (p.base ? 0.95 : 0.65);
    p.enter?.(K);
  };

  // ---- look: ambient glance target, smoothed head and body yaw / pitch
  const glances = [root.localToWorld(V(0, 1.55, 3)), root.localToWorld(V(0.6, 1.4, 3)), ...(opts.glances ?? [])];
  const lookPt = V();
  let glance = glances[0], glanceT = 0, headYaw = 0, headPitch = 0, bodyYaw = 0;
  let breathT = rand(0, 5), shiftT = rand(0, 10);
  // being shot: a sharp kick per body region (her frame) that springs back, on top of the cower pose
  const kick = { head: 0, chest: 0, hips: 0, side: 0, t: 9 };
  // hit volumes: [part, bone, second bone (segment midpoint) or null, radius, lift above the bone]
  const HIT = [
    ['head', 'head', null, 0.115, 0.075],
    ['chest', 'chest', null, 0.17, 0.08],
    ['belly', 'spine', null, 0.16, 0],
    ['hips', 'hips', null, 0.17, 0],
    ['armL', 'upperArmL', 'foreArmL', 0.065, 0],
    ['armR', 'upperArmR', 'foreArmR', 0.065, 0],
    ['foreL', 'foreArmL', 'handL', 0.055, 0],
    ['foreR', 'foreArmR', 'handR', 0.055, 0],
  ];

  function applyArm(a, s, w) {
    const upper = b['upperArm' + s], fore = b['foreArm' + s], hand = b['hand' + s];
    // target into world space
    if (a.rel === 'root') {
      root.localToWorld(_T.copy(a.t));
      root.getWorldQuaternion(_q);
    } else if (a.rel === 'shoulder') {
      upper.getWorldPosition(_T);
      root.getWorldQuaternion(_q);
      _T.add(_c.copy(a.t).applyQuaternion(_q));
    } else {
      const bone = b[a.rel];
      bone.localToWorld(_T.copy(a.t));
      bone.getWorldQuaternion(_q);
    }
    _P.copy(a.pole).normalize().applyQuaternion(_q);
    _A.copy(a.along).normalize().applyQuaternion(_q);
    _N.copy(a.palm).normalize().applyQuaternion(_q);
    reach(upper, fore, hand, _T, _P, _A, _N, c.hands[s]);
    spreadTwist(fore, hand, 0.5);
    if (w < 1) {
      // crossfade from the snapshot (copy the IK result first: slerpQuaternions writes `this` before reading qb)
      for (const n of ARM_BONES) {
        const q = b[n + s].quaternion;
        _qt.copy(q);
        q.copy(snap[n + s]).slerp(_qt, w);
      }
    }
  }

  const keeper = {
    root,
    char: c,
    get state() {
      return st.pose.name;
    },
    /** debug: force a pose (name) */
    force(name) {
      if (POSES[name]) enter(POSES[name]);
    },
    /** Nearest hit along a world ray within maxT: { t, part } or null. */
    raycast(origin, dir, maxT) {
      let best = null;
      for (const [part, n0, n1, r, lift] of HIT) {
        b[n0].getWorldPosition(_c);
        if (n1) _c.add(b[n1].getWorldPosition(_u)).multiplyScalar(0.5);
        _c.y += lift;
        _u.subVectors(_c, origin);
        const tca = _u.dot(dir);
        const d2 = _u.lengthSq() - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (t > 0 && t < maxT && (!best || t < best.t)) best = { t, part };
      }
      return best;
    },
    /** A bullet hit `part` travelling along world `dir`: flinch away from it and cower for a moment. */
    hit(part, dir) {
      root.getWorldQuaternion(_q).invert();
      _a.copy(dir).applyQuaternion(_q); // her frame: +z forward, +x her left
      const back = -_a.z; // + when shot from the front
      const A = 0.32;
      kick.t = 0;
      kick.head = part === 'head' ? A * 1.3 * back : 0;
      kick.chest = part === 'chest' ? A * back : 0;
      kick.hips = part === 'belly' || part === 'hips' ? A * 0.8 : 0;
      kick.side = (part.endsWith('L') ? 1 : part.endsWith('R') ? -1 : -_a.x) * A * 0.5;
      if (st.pose !== POSES.cower) enter(POSES.cower);
      else st.t = Math.min(st.t, 0.4); // keep her down while the shots keep coming
    },
    /**
     * ctx: { cam: world Vector3 (the customer's eyes), engaged: customer at the counter in the buy
     * phase, storeOpen: the store UI is up }
     */
    update(dt, ctx) {
      dt = Math.min(dt, 0.1);
      // ---- reactions
      if (ctx.storeOpen && !storePrev) enter(POSES.greet);
      else if (ctx.engaged && !engagedPrev && nodCd <= 0) {
        nodT = 0;
        nodCd = 20;
      }
      if (ctx.engaged !== engagedPrev) glanceT = 0; // look over right away / look elsewhere
      storePrev = ctx.storeOpen;
      engagedPrev = ctx.engaged;
      nodCd -= dt;
      nodT += dt;

      // ---- state machine
      st.t += dt;
      if (st.t >= st.dur) enter(pick(ctx.engaged, ctx.storeOpen));
      st.blendT = Math.min(1, st.blendT + dt / st.blendDur);
      const w = ease(st.blendT);

      // ---- target pose, blended from the snapshot
      for (const k of CH) pose[k] = 0;
      pose.hy = -0.012;
      pose.look = 1;
      pose.lookAt = null;
      hang(pose.L, 1);
      hang(pose.R, -1);
      st.pose.fn(pose, st.t, K);
      for (let i = 0; i < CH.length; i++) P[CH[i]] = cur[i] = from[i] + (pose[CH[i]] - from[i]) * w;

      // ---- overlays: breathing, weight shift, nod
      breathT += dt;
      shiftT += dt;
      const br = Math.sin((breathT * Math.PI * 2) / 4.3);
      const ws = Math.sin((shiftT * Math.PI * 2) / 11) + 0.35 * Math.sin((shiftT * Math.PI * 2) / 4.7 + 1.3);
      P.cx -= 0.022 * br;
      P.sx -= 0.008 * br;
      P.nx += 0.014 * br;
      P.hy += 0.002 * br;
      P.hx += 0.02 * ws;
      P.hrz += 0.04 * ws;
      P.hry += 0.03 * ws;
      P.sz -= 0.025 * ws;
      P.cz -= 0.012 * ws;
      // ---- flinch: t·e^(1 - t/τ) peaks at 1 after τ = 70 ms, then springs back
      kick.t += dt;
      const kf = kick.t < 1.2 ? (kick.t / 0.07) * Math.exp(1 - kick.t / 0.07) : 0;
      P.ex -= kick.head * kf;
      P.nx -= kick.head * 0.5 * kf;
      P.cx -= kick.chest * kf;
      P.sx -= kick.chest * 0.5 * kf;
      P.hrx += kick.hips * kf;
      P.cy += kick.side * kf;
      P.ez += kick.side * 0.5 * kf;
      const nod = 0.22 * bump(nodT, 0, 0.45) + 0.1 * bump(nodT, 0.4, 0.8) + (st.pose === POSES.greet ? 0.25 * bump(st.t, 0.15, 0.7) : 0);

      // ---- look target: the customer's eyes, else a glance around the shop
      glanceT -= dt;
      if (glanceT <= 0) {
        // engaged: mostly the customer, now and then a short look away; idle: around the shop
        const away = !ctx.engaged || (glance === ctx.cam && Math.random() < 0.3);
        glance = away ? glances[Math.floor(Math.random() * glances.length)] : ctx.cam;
        glanceT = ctx.engaged ? (away ? rand(0.6, 1.3) : rand(3, 7)) : rand(1.4, 4.2);
      }
      lookPt.copy(pose.lookAt ?? glance);
      root.worldToLocal(_a.copy(lookPt)).sub(rest.head);
      const yaw = clamp(Math.atan2(_a.x, _a.z), -1.35, 1.35) * P.look;
      const pitch = clamp(Math.atan2(_a.y, Math.hypot(_a.x, _a.z)), -0.5, 0.45) * P.look;
      headYaw = damp(headYaw, yaw, ctx.engaged ? 6 : 4.5, dt);
      headPitch = damp(headPitch, pitch, 5, dt);
      bodyYaw = damp(bodyYaw, yaw, 1.6, dt);
      const body = bodyYaw * (ctx.engaged ? 0.45 : 0.3);
      const neck = clamp(headYaw - body, -1.0, 1.0);

      // ---- torso
      b.hips.position.set(hips0.x + P.hx, hips0.y + P.hy, hips0.z + P.hz);
      b.hips.rotation.set(P.hrx, P.hry + body * 0.25, P.hrz);
      b.spine.rotation.set(P.sx, P.sy + body * 0.35, P.sz);
      b.chest.rotation.set(P.cx, P.cy + body * 0.4, P.cz);
      b.neck.rotation.set(P.nx - headPitch * 0.4 + nod * 0.4, P.ny + neck * 0.45, P.nz);
      b.head.rotation.set(P.ex - headPitch * 0.6 + nod * 0.6, P.ey + neck * 0.55, P.ez - neck * 0.06);
      root.updateMatrixWorld(true);

      // ---- legs: feet planted
      root.getWorldQuaternion(_qr);
      for (const s of ['L', 'R']) {
        const fq = _q2.copy(_qr).multiply(footTurn[s]);
        legIK(b['thigh' + s], b['shin' + s], b['foot' + s], root.localToWorld(_b.copy(feet[s])), _c.copy(kneePole[s]).applyQuaternion(_qr), fq);
      }

      // ---- arms
      applyArm(pose.L, 'L', w);
      applyArm(pose.R, 'R', w);
      if (ragGrab && w > 0.97) {
        // palm point: a little ahead of the wrist; the rag keeps its offset to it and stays flat
        root.worldToLocal(b.handR.getWorldPosition(_a));
        _a.z += 0.06;
        if (ragGrab === 1) {
          ragOff.copy(rag.position).sub(_a);
          ragGrab = 2;
        }
        rag.position.set(clamp(_a.x + ragOff.x, -0.55, 0.15), topY + 0.004, clamp(_a.z + ragOff.z, edgeZ + 0.05, edgeZ + 0.3));
      }
      rig.sync();
    },
  };
  return keeper;
}

/** a small crumpled cloth, ~16 x 12 cm */
function ragGeometry() {
  const g = new THREE.PlaneGeometry(0.16, 0.12, 6, 5);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, 0.006 * Math.sin(x * 55 + z * 30) + 0.004 * Math.cos(z * 70) + 0.003);
  }
  g.computeVertexNormals();
  return g;
}
