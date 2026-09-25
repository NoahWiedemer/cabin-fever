// Nadja, the lab tech behind the basement's armored glass (world/lab.js). A UniRig GLB character driven
// procedurally like the gun shop clerk (actors/shopkeeper.js: the same leg IK and forearm twist split,
// arm IK via teammate.js reach, crossfades from a pose snapshot). Not an actor in the fight: the glass
// stops every bullet, nothing targets her, and she only animates while the camera is in the basement.
//
// Behaviour: tasks at three spots along her counter (C: flasks, pipette, clipboard; L: microscope;
// R: monitor and the gas valve), short idles between them (hands on the counter, a hand at the chin, a
// stretch) and sidesteps from spot to spot (one foot, then the other). What she handles is parented to
// her hand while held (Object3D.attach keeps the grip), so flasks, the pipette, the clipboard and the pen
// move with her hands; the gas valve's wheel turns under her hand. On top: breathing, a slow weight
// shift, now and then a look at whoever stands at the glass, and a flinch when a bullet chips the glass.
import * as THREE from 'three';
import { createGLBCharacter } from './gltfCharacter.js';
import { reach, frameQuat } from './teammate.js';
import { legIK, spreadTwist } from './shopkeeper.js';
import { clamp, damp, rand } from '../core/utils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const ease = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
/** 0 → 1 → 0 over [a, b] */
const bump = (t, a, b) => (t <= a || t >= b ? 0 : Math.sin(Math.PI * ((t - a) / (b - a))) ** 2);
/** 0 → 1 over [a, a + r], held, 1 → 0 over [b - r, b] */
const hold = (t, a, b, r) => ease((t - a) / r) * ease((b - t) / r);
/** 0 → 1 over [a, b] */
const ramp = (t, a, b) => ease((t - a) / (b - a));

const _a = V(), _b = V(), _c = V(), _u = V(), _T = V(), _P = V(), _A = V(), _N = V();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qr = new THREE.Quaternion(), _qt = new THREE.Quaternion();
const _e = new THREE.Euler();
const Y = V(0, 1, 0);

// torso channels (her frame: +z forward, +x her left, +y up; radians, hips offset in meters)
const CH = ['hx', 'hy', 'hz', 'hrx', 'hry', 'hrz', 'sx', 'sy', 'sz', 'cx', 'cy', 'cz', 'nx', 'ny', 'nz', 'ex', 'ey', 'ez', 'look'];
const ARM_BONES = ['upperArm', 'foreArm', 'hand'];
const SIDES = ['L', 'R'];

const arm = () => ({ rel: 'root', t: V(), along: V(), palm: V(), pole: V() });
function makePose() {
  return { L: arm(), R: arm(), lookAt: null, lookAtV: V(), glance: false };
}
function hang(a, s) {
  const k = s === 'L' ? 1 : -1;
  a.rel = 'shoulder';
  a.t.set(k * 0.05, -0.42, 0.06);
  a.along.set(k * 0.05, -1, 0.14);
  a.palm.set(-k, 0, 0.12);
  a.pole.set(k * 0.3, 0, -1);
}
function copyArm(o, a) {
  o.rel = a.rel;
  o.t.copy(a.t);
  o.along.copy(a.along);
  o.palm.copy(a.palm);
  o.pole.copy(a.pole);
}
/** o = mix(o, b, k) for two root-space arm specs */
function mixArm(o, b, k) {
  if (k <= 0) return;
  if (k >= 1) return copyArm(o, b);
  o.t.lerp(b.t, k);
  o.along.lerp(b.along, k);
  o.palm.lerp(b.palm, k);
  o.pole.lerp(b.pole, k);
}

// ---------------------------------------------------------------- grips
// The hand's frame relative to a held object, in the object's frame: `a` fingers (wrist → knuckles),
// `n` palm normal, `p` wrist. Objects rest oriented like her (+z toward the glass), so these read in
// her frame: e.g. the flask's neck is held from its right side, fingers forward, thumb up.
function grip(point, along, palm, radius, reachA = 0.066, gap = 0.012) {
  const a = V(...along).normalize(), n = V(...palm).normalize();
  n.addScaledVector(a, -n.dot(a)).normalize();
  return { p: V(...point).addScaledVector(a, -reachA).addScaledVector(n, -(radius + gap)), a, n };
}
const GRIP = {
  flask: { R: grip([0, 0.118, 0], [0.1, 0, 1], [1, 0, 0], 0.014), L: grip([0, 0.118, 0], [-0.1, 0, 1], [-1, 0, 0], 0.014) },
  beaker: { L: grip([0, 0.045, 0], [-0.1, 0, 1], [-1, 0, 0], 0.036), R: grip([0, 0.045, 0], [0.1, 0, 1], [1, 0, 0], 0.036) },
  pipette: { R: grip([0, 0.012, 0], [0.1, 0, 1], [1, 0, 0], 0.012) },
  // clipboard: fingers under the near (bottom) edge, palm up, thumb over the paper
  clipboard: { L: grip([0.03, -0.004, -0.15], [0, 0, 1], [0, 1, 0], 0, 0.055, 0.016) },
  // pen: tripod grip near the tip, fingers pointing down along the pen
  pen: { R: grip([0, -0.035, 0], [0.3, -1, 0], [1, 0.3, 0], 0.004, 0.07, 0.01) },
};
// fixed hand frames (her frame) for things she touches without picking up
const TOUCH = {
  wheel: grip([0, 0.012, 0], [0.35, 0, 1], [0, -1, 0], 0, 0.058, 0.018),
  keys: grip([0, 0, 0], [0, -0.35, 1], [0, -1, 0], 0, 0.07, 0.03),
  mouse: grip([0, 0.018, 0], [0.05, -0.25, 1], [0, -1, 0], 0, 0.06, 0.025),
  knobL: grip([0, 0, 0], [0, -0.45, 1], [-1, 0, 0], 0.028, 0.055, 0.008),
  knobR: grip([0, 0, 0], [0, -0.45, 1], [1, 0, 0], 0.028, 0.055, 0.008),
};

/** keyframe track: frames [[t, pos, quat], ...] (her frame), smoothstep between, held at the ends */
function track(t, frames, outP, outQ) {
  let i = 0;
  while (i < frames.length - 1 && t >= frames[i + 1][0]) i++;
  const f0 = frames[i], f1 = frames[Math.min(i + 1, frames.length - 1)];
  const k = f1 === f0 || t <= f0[0] ? (t <= f0[0] ? 0 : 1) : ease((t - f0[0]) / (f1[0] - f0[0]));
  outP.copy(f0[1]).lerp(f1[1], k);
  outQ.copy(f0[2]).slerp(f1[2], k);
}
const qEuler = (x, y, z) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
const F = (t, p, q) => [t, p, q];

// ---------------------------------------------------------------- poses
// fn(o, t, K, d): write torso channels / arm specs for time t; d = per-run data from setup(K).
// Channels o.* default to 0 (plus a slight hip drop), arms default to hanging.
function counterLean(o, k = 1) {
  o.hrx = 0.14 * k;
  o.hz = -0.02 * k;
  o.hy = -0.012 - 0.01 * k;
  o.sx = 0.07 * k;
  o.nx = -0.03 * k;
}

const POSES = {
  // ---- idles
  rest: {
    base: true,
    dur: [2.5, 5],
    w: 3,
    glance: true,
    fn(o, t, K, d) {
      counterLean(o, 0.8);
      K.onCounter(o.L, 'L', 0.2, 0);
      K.onCounter(o.R, 'R', 0.2, 0);
      o.look = 0.8;
      o.lookAt = o.lookAtV.copy(d.look);
    },
    setup: (K) => ({ look: K.pick([K.at.rack, K.at.beaker, K.at.flask, K.at.glassLow]) }),
  },
  // thinking: knuckles under the chin, the other forearm across the waist under that elbow
  think: {
    base: true,
    dur: [3, 5],
    w: 1.2,
    glance: true,
    fn(o, t, K, d) {
      counterLean(o, 0.2);
      o.ez = 0.08;
      o.ex = 0.06;
      const R = o.R, L = o.L;
      R.rel = L.rel = 'root';
      R.t.set(-0.03, K.headY - 0.11, 0.2);
      R.along.set(0.15, 0.85, -0.5);
      R.palm.set(0.1, -0.5, -0.86);
      R.pole.set(-0.3, -1, 0.2);
      R.t.x += Math.sin(t * 1.6) * 0.005 * ease(t - 0.8); // tapping the chin
      L.t.set(-0.06, K.headY - 0.44, 0.16);
      L.along.set(-1, 0.15, 0.2);
      L.palm.set(0, 1, 0.1);
      L.pole.set(0.8, -0.6, 0.2);
      o.look = 0.7;
      o.lookAt = o.lookAtV.copy(d.look);
    },
    setup: (K) => ({ look: K.pick([K.at.rack, K.at.flask, K.at.hall]) }),
  },
  stretch: {
    base: true,
    dur: [3.2, 3.6],
    w: 0.5,
    fn(o, t) {
      const k = hold(t, 0.35, 3.1, 0.7);
      o.hz = 0.015 * k;
      o.sx = -0.08 * k;
      o.cx = -0.05 * k;
      o.nx = -0.08 * k;
      o.ex = -0.24 * k;
      o.look = 1 - k;
      for (const [a, s] of [[o.L, 1], [o.R, -1]]) {
        a.rel = 'root';
        a.t.set(s * 0.12, 1.0, -0.17);
        a.along.set(-s * 0.4, -0.75, -0.2);
        a.palm.set(0, 0.1, 1);
        a.pole.set(s, 0, -0.6);
      }
    },
  },

  // ---- sidestep to another spot (root motion in update())
  step: {
    dur: [1, 1],
    blend: 0.45,
    fn(o, t, K, d) {
      o.hrx = 0.04;
      hang(o.L, 'L');
      hang(o.R, 'R');
      o.look = 0.8;
      o.lookAt = o.lookAtV.copy(d.look);
    },
  },

  // ---- tasks
  // pour from the fuller vessel (in the hand on its side) into the other one, then look at the result
  pour: {
    station: 'C',
    dur: [9.4, 9.4],
    w: 1.3,
    setup(K) {
      const src = K.props.flask.level >= K.props.beaker.level ? 'flask' : 'beaker';
      const dst = src === 'flask' ? 'beaker' : 'flask';
      const m = src === 'flask' ? 1 : -1; // +1: pouring from her right hand into her left
      const sS = m > 0 ? 'R' : 'L', dS = m > 0 ? 'L' : 'R';
      const sH = K.homeCopy(src), dH = K.homeCopy(dst);
      const up = qEuler(0, 0, 0);
      const dUp = V(0.075 * m, 1.05, 0.3);
      const sUp = V(-0.11 * m, 1.16, 0.28);
      const tilt = -1.2 * m;
      const qPour = qEuler(0, 0, tilt), qPre = qEuler(0, 0, tilt * 0.55);
      const lip = K.props[src].lip, dLip = K.props[dst].lip.y;
      const mouth = dUp.clone().add(V(-0.012 * m, dLip + 0.035, 0));
      const pPour = mouth.clone().sub(lip.clone().applyQuaternion(qPour));
      const pPre = mouth.clone().add(V(0, 0.04, 0)).sub(lip.clone().applyQuaternion(qPre));
      const dLook = V(0.05 * m, 1.42, 0.33);
      return {
        src, dst, sS, dS,
        sT: [F(0.9, sH.p, sH.q), F(2.0, sUp, up), F(2.8, pPre, qPre), F(3.3, pPour, qPour), F(5.3, pPour.clone().add(V(0, 0.01, 0)), qPour), F(5.9, sUp, up), F(7.2, sH.p, sH.q)],
        dT: [F(0.9, dH.p, dH.q), F(2.0, dUp, up), F(6.0, dUp, up), F(6.7, dLook, qEuler(0.08, 0, 0.1 * m)), F(7.7, dLook, qEuler(-0.05, 0, -0.1 * m)), F(8.5, dH.p, dH.q)],
        moved: 0,
      };
    },
    events: [[0.9, 'grab', 'src'], [0.9, 'grab', 'dst'], [7.2, 'release', 'src'], [8.5, 'release', 'dst']],
    fn(o, t, K, d) {
      counterLean(o, 1.6 - 1.1 * hold(t, 1.4, 8.0, 0.6));
      const sP = K.tmpP[0], sQ = K.tmpQ[0], dP = K.tmpP[1], dQ = K.tmpQ[1];
      track(t, d.sT, sP, sQ);
      track(t, d.dT, dP, dQ);
      // a slight swirl of the receiving vessel while she looks at it
      const sw = bump(t, 6.7, 7.7);
      dP.x += Math.cos(t * 13) * 0.012 * sw;
      dP.z += Math.sin(t * 13) * 0.012 * sw;
      K.hold(o[d.sS], d.sS, d.src, sP, sQ);
      K.hold(o[d.dS], d.dS, d.dst, dP, dQ);
      if (t > 7.2) mixArm(o[d.sS], K.counterArm(d.sS, 0.2, 0), ramp(t, 7.25, 7.9));
      if (t > 8.5) mixArm(o[d.dS], K.counterArm(d.dS, 0.2, 0), ramp(t, 8.55, 9.2));
      // the stream and the levels
      const pouring = t > 3.25 && t < 5.4;
      K.stream(pouring ? d.src : null, d.dst);
      if (pouring) {
        const dl = Math.min(0.0035 * 60 * K.dt * 0.25, K.props[d.src].level - 0.1);
        if (dl > 0 && d.moved < 0.35) {
          K.props[d.src].level -= dl;
          K.props[d.dst].level = Math.min(0.95, K.props[d.dst].level + dl);
          d.moved += dl;
        }
      }
      o.look = 1;
      o.lookAt = K.world(t < 2 ? sP : t < 6.2 ? dP.clone().setY(dP.y + 0.08) : dP, o.lookAtV);
    },
    exit: (K) => K.stream(null),
  },
  // swirl the flask, then hold it up against the ceiling light
  swirl: {
    station: 'C',
    dur: [8.8, 8.8],
    w: 1.1,
    setup(K) {
      const h = K.homeCopy('flask');
      const up = V(-0.07, 1.12, 0.28);
      const high = V(-0.05, 1.62, 0.34);
      return {
        T: [F(0.9, h.p, h.q), F(1.9, up, qEuler(0, 0, 0)), F(4.2, up, qEuler(0, 0, 0)), F(5.1, high, qEuler(-0.2, -0.25, 0.12)), F(6.5, high, qEuler(-0.2, 0.45, 0.12)), F(7.4, up, qEuler(0, 0.2, 0)), F(8.2, h.p, h.q)],
      };
    },
    events: [[0.9, 'grab', 'flask', 'R'], [8.2, 'release', 'flask']],
    fn(o, t, K, d) {
      counterLean(o, 1.6 - 1.2 * hold(t, 1.4, 7.6, 0.6));
      const p = K.tmpP[0], q = K.tmpQ[0];
      track(t, d.T, p, q);
      const sw = hold(t, 1.9, 4.2, 0.35);
      if (sw > 0) {
        const a = t * 13.5;
        p.x += Math.cos(a) * 0.018 * sw;
        p.z += Math.sin(a) * 0.018 * sw;
        _q.setFromEuler(_e.set(Math.sin(a) * 0.1 * sw, 0, -Math.cos(a) * 0.1 * sw));
        q.multiply(_q);
      }
      K.hold(o.R, 'R', 'flask', p, q);
      if (t > 8.2) mixArm(o.R, K.counterArm('R', 0.2, 0), ramp(t, 8.25, 8.8));
      K.onCounter(o.L, 'L', 0.2, 0);
      o.look = 1;
      o.lookAt = K.world(_c.copy(p).setY(p.y + 0.06), o.lookAtV);
      // looking up at it: the chest opens up
      const up = bump(t, 4.6, 7.2);
      o.cx -= 0.08 * up;
      o.sx -= 0.04 * up;
    },
  },
  // micropipette: draw from the beaker, fill three tubes, back into the stand
  pipette: {
    station: 'C',
    dur: [11.4, 11.4],
    w: 1.3,
    setup(K) {
      const h = K.homeCopy('pipette');
      const tip = K.props.pipette.tip.y; // below the grip (negative)
      const q = qEuler(0.06, 0, 0.05);
      const above = (pt, dy) => pt.clone().add(V(0, dy - tip, 0));
      const beaker = K.local(K.props.beaker.obj.position, V()).add(V(0, 0.1, 0));
      const liquidY = K.local(K.props.beaker.obj.position, V()).y + 0.02 + 0.07 * K.props.beaker.level;
      const first = Math.floor(rand(0, 6));
      const tubes = [0, 1, 2].map((i) => K.local(K.at.tubes[first + i], V()));
      const lift = h.p.clone().add(V(0, 0.14, 0));
      const T = [F(0.9, h.p, h.q), F(1.5, lift, h.q), F(2.3, above(beaker, 0.05), q), F(2.8, above(beaker.clone().setY(liquidY), -0.005), q), F(3.4, above(beaker.clone().setY(liquidY), -0.005), q), F(3.8, above(beaker, 0.05), q)];
      let t0 = 3.8;
      for (const tb of tubes) {
        T.push(F(t0 + 0.8, above(tb, 0.035), q), F(t0 + 1.15, above(tb, -0.03), q), F(t0 + 1.6, above(tb, -0.03), q), F(t0 + 1.9, above(tb, 0.04), q));
        t0 += 1.9;
      }
      T.push(F(t0 + 0.9, lift, h.q), F(t0 + 1.5, h.p, h.q));
      return { T, release: t0 + 1.5, draw: 0 };
    },
    events: [[0.9, 'grab', 'pipette', 'R'], [-1, 'release', 'pipette']],
    fn(o, t, K, d) {
      counterLean(o, 1.3);
      const p = K.tmpP[0], q = K.tmpQ[0];
      track(t, d.T, p, q);
      K.hold(o.R, 'R', 'pipette', p, q);
      if (t > d.release) mixArm(o.R, K.counterArm('R', 0.2, 0), ramp(t, d.release + 0.05, d.release + 0.7));
      // the free hand steadies the beaker
      K.hold(o.L, 'L', 'beaker', K.home('beaker').p, K.home('beaker').q);
      if (t > 2.8 && d.draw === 0) {
        d.draw = 1;
        K.props.beaker.level = Math.max(0.12, K.props.beaker.level - 0.06);
      }
      o.look = 1;
      o.lookAt = K.pipetteTip(o.lookAtV);
    },
  },
  // clipboard: read, take the pen, write a few lines, glance at the rack, write, put it all back
  clipboard: {
    station: 'C',
    dur: [10.2, 10.2],
    w: 1.1,
    glance: true,
    setup(K) {
      const h = K.homeCopy('clipboard');
      const read = V(0.1, 1.16, 0.3);
      const qRead = qEuler(-0.95, 0.25, 0.08);
      return { T: [F(0.9, h.p, h.q), F(2.1, read, qRead), F(8.0, read, qRead), F(9.2, h.p, h.q)] };
    },
    events: [[0.9, 'grab', 'clipboard', 'L'], [2.95, 'grab', 'pen', 'R'], [7.55, 'release', 'pen'], [9.2, 'release', 'clipboard']],
    fn(o, t, K, d) {
      counterLean(o, 1.7 - 1.4 * hold(t, 1.5, 8.6, 0.6));
      const p = K.tmpP[0], q = K.tmpQ[0];
      track(t, d.T, p, q);
      p.y += Math.sin(t * 0.9) * 0.004;
      K.hold(o.L, 'L', 'clipboard', p, q);
      // the pen, from the board's pose (its home is on the board): lying there, then writing lines
      // from her left to her right with a pause to check the rack, then back
      const pen = K.props.pen;
      const pp = K.tmpP[1].copy(pen.homeP).applyQuaternion(q).add(p);
      const pq = K.tmpQ[1].copy(q).multiply(pen.homeQ);
      const k = ramp(t, 2.95, 3.3) * (1 - ramp(t, 7.1, 7.55));
      if (k > 0) {
        const w = Math.max(0, t - 3.25);
        const line = Math.floor(w / 1.25), f = (w / 1.25) % 1;
        const pause = bump(t, 5.0, 5.8);
        const u = 0.065 - 0.13 * f, v = 0.06 - (line % 6) * 0.022 + Math.sin(t * 41) * 0.0025;
        const lift = (f > 0.9 ? 0.012 : 0) + pause * 0.04 + 0.004 + 0.03 * (1 - ramp(t, 3.1, 3.4));
        _a.set(u, lift, v).applyQuaternion(q).add(p);
        _q.setFromUnitVectors(Y, _b.set(-0.35, 0.82, -0.45).normalize());
        _q2.copy(q).multiply(_q);
        pp.lerp(_a, k);
        pq.slerp(_q2, k);
      }
      K.hold(o.R, 'R', 'pen', pp, pq);
      mixArm(o.R, K.counterArm('R', 0.2, 0), 1 - ramp(t, 2.1, 2.9) + ramp(t, 7.6, 8.2));
      o.look = 1;
      const glance = bump(t, 5.0, 5.8);
      if (glance > 0.3) o.lookAt = o.lookAtV.copy(K.at.rack);
      else o.lookAt = K.world(_c.set(0, 0, 0.01).applyQuaternion(q).add(p), o.lookAtV);
    },
  },
  // microscope at the left spot: lean in, eyes on the eyepieces, both hands on the focus knobs
  scope: {
    station: 'L',
    dur: [9, 9],
    w: 1.1,
    setup: () => ({ lean: 0.3, drop: 0 }),
    fn(o, t, K, d) {
      const k = ramp(t, 0, 1.2);
      o.hrx = d.lean * k;
      o.hz = -0.07 * k;
      o.hy = -0.012 + d.drop * k;
      o.sx = 0.14 * k;
      o.cx = 0.05 * k;
      o.nx = 0.1 * k;
      const s = K.at.scope;
      for (const S of SIDES) {
        const knob = K.local(S === 'L' ? s.knobL : s.knobR, _c);
        // turning the fine focus: the hand rolls about the knob's axis, one side at a time
        const roll = Math.sin(t * (S === 'L' ? 1.7 : 1.3) + (S === 'L' ? 0 : 2)) * 0.25 * hold(t, 1.6, 8.4, 0.6);
        _q.setFromAxisAngle(_b.set(1, 0, 0), roll);
        K.touch(o[S], S, S === 'L' ? 'knobL' : 'knobR', knob, _q);
      }
      o.look = 1;
      // look down the eyepieces (a point below them along their tilt)
      o.lookAt = K.world(K.local(s.eye, _c).add(_b.set(0, -0.25, 0.22)), o.lookAtV);
      // head feedback: keep the eyes on the eyepieces by adjusting the lean and a knee bend
      if (t > 1.2 && t < 8.5) {
        const e = K.eyesLocal(_a).sub(K.local(s.eye, _b).add(_u.set(0, 0.04, -0.05)));
        d.lean = clamp(d.lean + e.z * -1.6 * K.dt, 0.12, 0.55);
        d.drop = clamp(d.drop - e.y * 0.8 * K.dt, -0.12, 0.02);
      }
    },
  },
  // monitor at the right spot: mouse, typing, mouse
  monitor: {
    station: 'R',
    dur: [8, 9],
    w: 1,
    glance: true,
    fn(o, t, K) {
      counterLean(o, 1.1);
      const keys = K.local(K.at.monitor.keys, _c);
      const typing = hold(t, 2.6, 6.4, 0.4);
      // left hand types on the left half; right hand: mouse, then keys, then mouse
      const tapL = Math.max(0, Math.sin(t * 17)) * 0.012 * typing;
      K.touch(o.L, 'L', 'keys', _a.copy(keys).add(_b.set(0.07, 0.012 + tapL, 0.01)), null);
      const onKeys = K.tmpArm[0];
      const tapR = Math.max(0, Math.sin(t * 15 + 1.3)) * 0.012 * typing;
      K.touch(onKeys, 'R', 'keys', _a.copy(keys).add(_b.set(-0.07, 0.012 + tapR, 0.005)), null);
      const mouse = K.local(K.at.monitor.mouse, _c);
      mouse.x += Math.sin(t * 1.3) * 0.015 * (1 - typing);
      mouse.z += Math.sin(t * 0.9) * 0.01 * (1 - typing);
      K.touch(o.R, 'R', 'mouse', mouse, null);
      mixArm(o.R, onKeys, typing);
      o.look = 1;
      o.lookAt = K.world(K.local(K.at.monitor.screen, _c).add(_b.set(Math.sin(t * 0.7) * 0.08, Math.sin(t * 0.43) * 0.04, 0)), o.lookAtV);
    },
  },
  // gas valve at the right spot: turn, check the gauge, trim, check again
  valve: {
    station: 'R',
    dur: [7, 7],
    w: 0.8,
    setup(K) {
      const a0 = K.at.valve.wheel.rotation.y;
      const dir = a0 > 0.4 ? -1 : a0 < -0.4 ? 1 : Math.random() < 0.5 ? -1 : 1;
      return { a0, turn: [a0, a0 + dir * 0.65, a0 + dir * 0.65, a0 + dir * 0.45] };
    },
    fn(o, t, K, d) {
      counterLean(o, 1.2);
      const [a0, a1, a2, a3] = d.turn;
      const ang = t < 2.6 ? a0 + (a1 - a0) * ramp(t, 1.1, 2.4) : a2 + (a3 - a2) * ramp(t, 3.8, 4.5);
      if (t > 1.0 && t < 5.6) K.at.valve.wheel.rotation.y = ang;
      _q.setFromAxisAngle(Y, ang - d.a0);
      K.touch(o.R, 'R', 'wheel', K.local(K.at.valve.top, _c), _q);
      if (t > 5.6) mixArm(o.R, K.counterArm('R', 0.2, 0), ramp(t, 5.6, 6.3));
      K.onCounter(o.L, 'L', 0.2, 0);
      o.look = 1;
      const g = t > 2.5 && t < 3.8 || t > 4.6 ? K.at.valve.gauge : K.at.valve.top;
      o.lookAt = K.world(K.local(g, _c), o.lookAtV);
    },
  },
};
for (const k in POSES) POSES[k].name = k;
const TASKS = ['pour', 'swirl', 'pipette', 'clipboard', 'scope', 'monitor', 'valve'].map((k) => POSES[k]);
const IDLES = ['rest', 'think', 'stretch'].map((k) => POSES[k]);

// ---------------------------------------------------------------- the tech
/**
 * parent: scene node (her root is added to it); work: world/lab.js runtime data (stations, props,
 * counter top, points of interest). Returns null if the GLB is missing.
 */
export function createLabTech(parent, work) {
  const c = createGLBCharacter('nadja', 1);
  if (!c) return null;
  const { root, bones: b, rig } = c;
  // a faint fill on her texture so she reads under the lab's baked light like the white walls around her
  const fill = new Map();
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    if (!fill.has(o.material)) {
      const m = o.material.clone();
      m.emissive = new THREE.Color(0x8a96a2);
      m.emissiveMap = m.map;
      m.emissiveIntensity = 0.22;
      fill.set(o.material, m);
    }
    o.material = fill.get(o.material);
  });
  const station = { key: 'C' };
  root.position.copy(work.stations.C);
  root.rotation.set(0, Math.PI, 0); // facing the glass (-z)
  parent.add(root);
  root.updateMatrixWorld(true);
  rig.sync();

  // rest measurements (root space)
  const rest = {};
  for (const k of ['footL', 'footR', 'head']) rest[k] = root.worldToLocal(b[k].getWorldPosition(V()));
  const hips0 = b.hips.position.clone();
  const feetLocal = { L: rest.footL.clone().add(V(0.02, 0, 0.01)), R: rest.footR.clone().add(V(-0.02, 0, 0.01)) };
  const footTurn = { L: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.1, 0)), R: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -0.1, 0)) };
  const kneePole = { L: V(0.15, 0, 1).normalize(), R: V(-0.15, 0, 1).normalize() };
  const feetW = { L: root.localToWorld(feetLocal.L.clone()), R: root.localToWorld(feetLocal.R.clone()) };
  const edgeZ = work.stations.C.z - work.edge; // counter's near edge ahead of her feet
  const topY = work.top - work.floor;

  // ---- props: homes (world), levels
  const P = {
    flask: work.flask,
    beaker: work.beaker,
    pipette: work.pipette,
    clipboard: work.clipboard,
    pen: work.pen,
  };
  // glassware and the pipette rest turned like her, so the grips read in her frame
  for (const k of ['flask', 'beaker', 'pipette']) P[k].obj.rotation.y = Math.PI;
  for (const k in P) {
    const o = P[k].obj;
    o.updateMatrixWorld(true);
    P[k].homeParent = o.parent;
    P[k].homeP = o.position.clone();
    P[k].homeQ = o.quaternion.clone();
  }
  P.flask.level ??= 0.8;
  P.beaker.level ??= 0.3;
  const held = { L: null, R: null };
  const setLevels = () => {
    P.flask.liquid.scale.y = Math.max(0.02, P.flask.level);
    P.beaker.liquid.scale.y = Math.max(0.02, P.beaker.level);
  };
  setLevels();

  const cur = new Float32Array(CH.length);
  const from = new Float32Array(CH.length);
  const pose = makePose();
  const Pc = {};
  const snap = {};
  for (const s of SIDES) for (const n of ARM_BONES) snap[n + s] = new THREE.Quaternion();
  const tmp = { p: [V(), V()], q: [new THREE.Quaternion(), new THREE.Quaternion()], arm: [arm(), arm()] };

  // ---- helpers for the poses
  const _homes = {};
  const rootQ = new THREE.Quaternion(), rootQi = new THREE.Quaternion();
  const K = {
    props: P,
    headY: 0, // her head joint's rest height (root space)
    at: {
      rack: work.rack[4],
      tubes: work.rack,
      flask: work.flask.obj.position.clone(), // (their homes: a held prop's position is hand-local)
      beaker: work.beaker.obj.position.clone(),
      scope: work.scope,
      monitor: work.monitor,
      valve: work.valve,
      glassLow: V(work.glass.x, work.top + 0.1, work.glass.z),
      hall: V(-4.6, -4.5, 14),
    },
    tmpP: tmp.p,
    tmpQ: tmp.q,
    tmpArm: tmp.arm,
    dt: 0,
    pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
    /** world point → her frame (out) */
    local: (w, out) => root.worldToLocal(out.copy(w)),
    /** her frame → world (out) */
    world: (l, out) => root.localToWorld(out.copy(l)),
    /** the object's rest transform in her frame ({p, q}, reused per key: copy it to keep it) */
    home(key) {
      const h = (_homes[key] ??= { p: V(), q: new THREE.Quaternion() });
      const pr = P[key];
      pr.homeParent.updateWorldMatrix(true, false);
      root.worldToLocal(h.p.copy(pr.homeP).applyMatrix4(pr.homeParent.matrixWorld));
      pr.homeParent.getWorldQuaternion(h.q).multiply(pr.homeQ).premultiply(rootQi);
      return h;
    },
    homeCopy(key) {
      const h = K.home(key);
      return { p: h.p.clone(), q: h.q.clone() };
    },
    /** arm holding (or reaching for) `key`, whose pose in her frame is (p, q) */
    hold(a, s, key, p, q) {
      const G = GRIP[key][s];
      a.rel = 'root';
      a.t.copy(G.p).applyQuaternion(q).add(p);
      a.along.copy(G.a).applyQuaternion(q);
      a.palm.copy(G.n).applyQuaternion(q);
      a.pole.set(s === 'L' ? 0.9 : -0.9, -0.5, -1);
    },
    /** arm on a fixed thing: grip frame `name` placed at point p (her frame), turned by q (optional) */
    touch(a, s, name, p, q) {
      const G = TOUCH[name];
      a.rel = 'root';
      a.t.copy(G.p);
      a.along.copy(G.a);
      a.palm.copy(G.n);
      if (q) {
        a.t.applyQuaternion(q);
        a.along.applyQuaternion(q);
        a.palm.applyQuaternion(q);
      }
      if (s === 'R' && name === 'keys') {
        a.along.x -= 0.2;
        a.along.normalize();
      } else if (s === 'L' && name === 'keys') {
        a.along.x += 0.2;
        a.along.normalize();
      }
      a.t.add(p);
      a.pole.set(s === 'L' ? 0.9 : -0.9, -0.6, -0.8);
    },
    /** hand flat on the counter near its edge, lateral offset x (her frame), dz further in */
    onCounter(a, s, x, dz) {
      const k = s === 'L' ? 1 : -1;
      a.rel = 'root';
      a.t.set(k * x, topY + 0.045, edgeZ + 0.06 + dz);
      a.along.set(-k * 0.25, -0.4, 1);
      a.palm.set(0, -1, 0.15);
      a.pole.set(k * 0.9, -0.2, -1);
    },
    counterArm(s, x, dz) {
      const a = tmp.arm[s === 'L' ? 1 : 0];
      K.onCounter(a, s, x, dz);
      return a;
    },
    pipetteTip(out) {
      P.pipette.obj.updateWorldMatrix(true, false);
      return out.copy(P.pipette.tip).applyMatrix4(P.pipette.obj.matrixWorld);
    },
    /** her eyes (between them) in her frame */
    eyesLocal(out) {
      b.head.updateWorldMatrix(true, false);
      return root.worldToLocal(out.copy(eyeOff).applyMatrix4(b.head.matrixWorld));
    },
    /** pouring stream from `src`'s lip down into `dst`, or hidden */
    stream(src, dst) {
      const s = work.stream;
      if (!src) {
        s.visible = false;
        return;
      }
      const o = P[src].obj;
      o.updateWorldMatrix(true, false);
      _a.copy(P[src].lip).applyMatrix4(o.matrixWorld);
      const d = P[dst].obj;
      d.updateWorldMatrix(true, false);
      const surf = d.localToWorld(_b.set(0, 0.02 + 0.06 * P[dst].level, 0)).y;
      s.visible = true;
      s.position.copy(_a);
      s.scale.set(1, Math.max(0.01, _a.y - surf), 1);
      s.material = P[src].liquid.material;
    },
  };
  const eyeOff = V(0, 0.075, 0.085); // eyes relative to the head joint (proxy frame, at rest = her frame)
  K.headY = rest.head.y;

  // ---- grabbing: parent a prop to the hand (world transform kept), then ease it into the exact grip
  // (the grip's hand frame inverted: where the prop sits in a hand posed by that grip), so a reach that
  // fell a little short can't leave it floating off the fingers
  const gripIn = {};
  function grab(key, s) {
    if (held[s] === key) return;
    root.updateMatrixWorld(true);
    b['hand' + s].attach(P[key].obj);
    held[s] = key;
    const G = GRIP[key][s], h = c.hands[s];
    const q = frameQuat(h.along, h.palm, G.a, G.n, new THREE.Quaternion()).invert();
    gripIn[key] = { q, p: G.p.clone().applyQuaternion(q).negate() };
  }
  function release(key) {
    for (const s of SIDES) if (held[s] === key) held[s] = null;
    const pr = P[key];
    pr.homeParent.attach(pr.obj);
    pr.obj.position.copy(pr.homeP);
    pr.obj.quaternion.copy(pr.homeQ);
  }
  const releaseAll = () => {
    for (const s of SIDES) if (held[s]) release(held[s]);
  };

  // ---- state machine
  const st = { pose: POSES.rest, t: 0, dur: 3, blendT: 1, blendDur: 0.8, w: 1, data: {}, events: [], fired: 0, last: null, pending: null };
  const move = { active: false, from: V(), to: V(), n: 1, lead: 'L' };
  const enter = (p) => {
    st.pose.exit?.(K, st.data);
    releaseAll();
    from.set(cur);
    for (const s of SIDES) for (const n of ARM_BONES) snap[n + s].copy(b[n + s].quaternion);
    st.pose = p;
    st.t = 0;
    st.dur = rand(p.dur[0], p.dur[1]);
    st.blendT = 0;
    st.blendDur = p.blend ?? (p.base ? 0.95 : 0.8);
    st.fired = 0;
    st.data = p.setup?.(K) ?? {};
    // resolve per-run event targets / times
    st.events = (p.events ?? []).map(([t, kind, key, side]) => {
      const k = key === 'src' || key === 'dst' ? st.data[key] : key;
      const sd = side ?? (key === 'src' ? st.data.sS : key === 'dst' ? st.data.dS : undefined);
      return [t < 0 ? st.data.release : t, kind, k, sd];
    });
  };
  const startMove = (to) => {
    const dst = work.stations[to];
    const dx = dst.x - root.position.x;
    move.active = true;
    move.from.copy(root.position);
    move.to.copy(dst);
    move.n = Math.max(1, Math.ceil(Math.abs(dx) / 0.8));
    move.key = to;
    // world -x is her left: lead with the foot on the side she moves to
    move.lead = dx < 0 ? 'L' : 'R';
    move.feet0 = { L: feetW.L.clone(), R: feetW.R.clone() };
    enter(POSES.step);
    st.dur = 0.95 * move.n;
    st.data.look = V(dst.x, work.top + 0.15, 4.6);
  };
  const next = () => {
    if (st.pose === POSES.step) {
      station.key = move.key;
      move.active = false;
      const p = st.pending;
      st.pending = null;
      return enter(p ?? POSES.rest);
    }
    const idleNow = !st.pose.base && Math.random() < 0.6;
    if (idleNow) {
      let sum = 0;
      for (const p of IDLES) sum += p.w;
      let r = Math.random() * sum;
      for (const p of IDLES) if ((r -= p.w) <= 0) return enter(p);
    }
    // a task, never the same one twice in a row
    let sum = 0;
    for (const p of TASKS) if (p !== st.last) sum += p.w * (p.station === station.key ? 1.4 : 1);
    let r = Math.random() * sum, pick = TASKS[0];
    for (const p of TASKS) {
      if (p === st.last) continue;
      r -= p.w * (p.station === station.key ? 1.4 : 1);
      if (r <= 0) {
        pick = p;
        break;
      }
    }
    st.last = pick;
    if (pick.station !== station.key) {
      st.pending = pick;
      startMove(pick.station);
    } else enter(pick);
  };

  // ---- look, overlays
  const lookPt = V();
  let headYaw = 0, headPitch = 0, bodyYaw = 0;
  let breathT = rand(0, 5), shiftT = rand(0, 10);
  let eyeT = rand(3, 6), eyeHold = 0, camSeen = false;
  const kick = { head: 0, chest: 0, side: 0, t: 9, cd: 0 };
  const startlePt = V();
  let startleLook = 0;

  function applyArm(a, s, w) {
    const upper = b['upperArm' + s], fore = b['foreArm' + s], hand = b['hand' + s];
    if (a.rel === 'root') {
      root.localToWorld(_T.copy(a.t));
      _q.copy(rootQ);
    } else if (a.rel === 'shoulder') {
      upper.getWorldPosition(_T);
      _q.copy(rootQ);
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
      for (const n of ARM_BONES) {
        const q = b[n + s].quaternion;
        _qt.copy(q);
        q.copy(snap[n + s]).slerp(_qt, w);
      }
    }
  }

  const tech = {
    root,
    char: c,
    get state() {
      return st.pose.name;
    },
    get station() {
      return station.key;
    },
    /** debug: run a pose now (walks to its spot first) */
    force(name) {
      const p = POSES[name];
      if (!p) return;
      if (p.station && p.station !== station.key) {
        st.pending = p;
        startMove(p.station);
      } else enter(p);
    },
    /** a bullet chipped the glass at world point p: flinch and look at it */
    startle(p) {
      if (kick.cd > 0) return;
      root.worldToLocal(_a.copy(p));
      if (_a.distanceTo(rest.head) > 3) return;
      kick.t = 0;
      kick.cd = 0.8;
      kick.head = 0.3;
      kick.chest = 0.22;
      kick.side = clamp(-_a.x, -1, 1) * 0.12;
      startlePt.copy(p);
      startleLook = 1.4;
    },
    /** ctx: { cam: world position of the viewer } */
    update(dt, ctx) {
      dt = Math.min(dt, 0.1);
      K.dt = dt;
      root.getWorldQuaternion(rootQ);
      rootQi.copy(rootQ).invert();

      // ---- state machine
      st.t += dt;
      if (st.t >= st.dur) next();
      st.blendT = Math.min(1, st.blendT + dt / st.blendDur);
      const w = (st.w = ease(st.blendT));
      for (; st.fired < st.events.length && st.t >= st.events[st.fired][0]; st.fired++) {
        const [, kind, key, side] = st.events[st.fired];
        if (kind === 'grab') grab(key, side);
        else release(key);
      }

      // ---- root motion (sidestep): the body glides, the feet step one after the other
      if (move.active) {
        const u = clamp(st.t / st.dur, 0, 1);
        root.position.lerpVectors(move.from, move.to, ease(u));
        const cyc = Math.min(move.n - 1e-6, u * move.n), i = Math.floor(cyc), f = cyc - i;
        for (const s of SIDES) {
          const lead = s === move.lead;
          const ph = lead ? ramp(f, 0.05, 0.55) : ramp(f, 0.45, 0.95);
          const k = (i + ph) / move.n;
          _a.copy(move.to).sub(move.from).multiplyScalar(k);
          feetW[s].copy(move.feet0[s]).add(_a);
          feetW[s].y += Math.sin(Math.PI * ph) * 0.05 * (ph > 0 && ph < 1 ? 1 : 0);
        }
      }
      root.updateMatrixWorld(true);

      // ---- target pose, blended from the snapshot
      for (const k of CH) pose[k] = 0;
      pose.hy = -0.012;
      pose.look = 1;
      pose.lookAt = null;
      hang(pose.L, 'L');
      hang(pose.R, 'R');
      st.pose.fn(pose, st.t, K, st.data);
      for (let i = 0; i < CH.length; i++) Pc[CH[i]] = cur[i] = from[i] + (pose[CH[i]] - from[i]) * w;

      // ---- overlays: breathing, weight shift, the step's sway, the flinch
      breathT += dt;
      shiftT += dt;
      const br = Math.sin((breathT * Math.PI * 2) / 4.1);
      const ws = Math.sin((shiftT * Math.PI * 2) / 10) + 0.35 * Math.sin((shiftT * Math.PI * 2) / 4.3 + 1.3);
      const still = move.active ? 0.2 : 1;
      Pc.cx -= 0.02 * br;
      Pc.sx -= 0.007 * br;
      Pc.nx += 0.012 * br;
      Pc.hy += 0.002 * br;
      Pc.hx += 0.018 * ws * still;
      Pc.hrz += 0.035 * ws * still;
      Pc.hry += 0.025 * ws * still;
      Pc.sz -= 0.022 * ws * still;
      Pc.cz -= 0.01 * ws * still;
      if (move.active) {
        const u = clamp(st.t / st.dur, 0, 1);
        const f = (u * move.n) % 1;
        const toL = move.lead === 'L' ? 1 : -1;
        // weight onto the planted foot while the other swings
        Pc.hx += toL * 0.035 * (bump(f, 0.5, 1) - bump(f, 0, 0.5));
        Pc.hy -= 0.012 * Math.abs(Math.sin(Math.PI * 2 * f));
      }
      kick.t += dt;
      kick.cd -= dt;
      const kf = kick.t < 1.2 ? (kick.t / 0.08) * Math.exp(1 - kick.t / 0.08) : 0;
      Pc.ex -= kick.head * kf;
      Pc.nx -= kick.head * 0.4 * kf;
      Pc.cx -= kick.chest * kf;
      Pc.hz -= 0.03 * kf;
      Pc.cy += kick.side * kf;

      // ---- look: task target, a look at the viewer at the glass now and then, the startle
      const cam = ctx.cam;
      root.worldToLocal(_a.copy(cam));
      const atGlass = _a.z > 0.9 && _a.z < 7 && Math.abs(_a.x) < 6;
      if (atGlass && !camSeen) {
        camSeen = true;
        eyeT = Math.min(eyeT, rand(1.5, 3.5)); // someone came up to the glass
      }
      if (!atGlass && _a.z > 9) camSeen = false;
      eyeT -= dt;
      eyeHold -= dt;
      if (eyeT <= 0) {
        eyeT = rand(9, 22);
        if (atGlass && (st.pose.glance || st.pose.base)) eyeHold = rand(1.2, 2.2);
      }
      startleLook -= dt;
      if (startleLook > 0) lookPt.copy(startlePt);
      else if (eyeHold > 0 && atGlass) lookPt.copy(cam);
      else if (pose.lookAt) lookPt.copy(pose.lookAt);
      else root.localToWorld(lookPt.set(0, 1.5, 3));
      root.worldToLocal(_a.copy(lookPt)).sub(rest.head);
      const lk = startleLook > 0 || eyeHold > 0 ? 1 : Pc.look;
      const yaw = clamp(Math.atan2(_a.x, _a.z), -1.3, 1.3) * lk;
      const pitch = clamp(Math.atan2(_a.y, Math.hypot(_a.x, _a.z)), -1.05, 0.5) * lk;
      headYaw = damp(headYaw, yaw, startleLook > 0 ? 10 : 5, dt);
      headPitch = damp(headPitch, pitch, startleLook > 0 ? 10 : 5, dt);
      bodyYaw = damp(bodyYaw, yaw, 1.6, dt);
      const body = bodyYaw * 0.3;
      const neck = clamp(headYaw - body, -1.0, 1.0);
      // looking far down: the upper back rounds too
      const down = Math.max(0, -headPitch - 0.55);

      // ---- torso
      b.hips.position.set(hips0.x + Pc.hx, hips0.y + Pc.hy, hips0.z + Pc.hz);
      b.hips.rotation.set(Pc.hrx, Pc.hry + body * 0.25, Pc.hrz);
      b.spine.rotation.set(Pc.sx + down * 0.15, Pc.sy + body * 0.35, Pc.sz);
      b.chest.rotation.set(Pc.cx + down * 0.2, Pc.cy + body * 0.4, Pc.cz);
      b.neck.rotation.set(Pc.nx - (headPitch + down * 0.35) * 0.4, Pc.ny + neck * 0.45, Pc.nz);
      b.head.rotation.set(Pc.ex - (headPitch + down * 0.35) * 0.6, Pc.ey + neck * 0.55, Pc.ez - neck * 0.06);
      root.updateMatrixWorld(true);

      // ---- legs: feet planted (in the world while she stands, stepping while she moves)
      if (!move.active) for (const s of SIDES) root.localToWorld(feetW[s].copy(feetLocal[s]));
      for (const s of SIDES) {
        const fq = _q2.copy(rootQ).multiply(footTurn[s]);
        legIK(b['thigh' + s], b['shin' + s], b['foot' + s], feetW[s], _c.copy(kneePole[s]).applyQuaternion(rootQ), fq);
      }

      // ---- arms
      applyArm(pose.L, 'L', w);
      applyArm(pose.R, 'R', w);
      const k = 1 - Math.exp(-12 * dt);
      for (const s of SIDES) {
        const g = held[s] && gripIn[held[s]];
        if (!g) continue;
        const o = P[held[s]].obj;
        o.position.lerp(g.p, k);
        o.quaternion.slerp(g.q, k);
      }
      setLevels();
      rig.sync();
    },
  };
  enter(POSES.rest);
  return tech;
}
