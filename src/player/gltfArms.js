// First-person arms from the Blender rig (tools/blender/arms.py): a skinned, gloved right arm; the
// left arm is the same model mirrored across X. Same interface as gunModels.buildArms():
// { root, update(rightTarget, leftTarget, weaponRoot), setFingerCurl, config }.
//
// Everything is solved in the (unmirrored) arm space: bind pose = arm along -Z from the shoulder,
// palm -X, index side +Y — the frame the weapons' hand empties are authored in, so a target's
// rotation is directly the hand's rotation away from bind. Rotation spreads down the forearm:
// the elbow is placed to keep the wrist straight, the distal forearm (twist bone) takes the
// hand's roll, the proximal forearm only part of it.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { adoptBakedGeometry, BAKED_MATERIALS, gunMaterial } from './gunModels.js';

const V3 = THREE.Vector3;
const Q = THREE.Quaternion;
const DEG = Math.PI / 180;
const FINGER_BONES = [0, 1, 2, 3].map((f) => [0, 1, 2].map((s) => `f${f}_${s}`));
const THUMB_BONES = ['t_0', 't_1', 't_2'];
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);

const _m = new THREE.Matrix4(), _inv = new THREE.Matrix4();
const _tp = new V3(), _tq = new Q(), _ts = new V3();
const _G = new V3(), _W = new V3(), _S = new V3(), _E = new V3(), _u = new V3(), _v = new V3(), _tmp = new V3(), _h = new V3(), _h2 = new V3();
const _q = new Q(), _q2 = new Q(), _fq = new Q();
const _bx = new V3(), _by = new V3(), _bz = new V3(), _bm = new THREE.Matrix4();
const REST_DIR = new V3(0, 0, -1), REST_HINT = new V3(1, 0, 0);
const _X = new V3(1, 0, 0);

// rotation taking the bind frame (arm along -Z, back of the hand +X) to (dir, hint)
function frameRot(dir, hint, out) {
  _bz.copy(dir).negate().normalize();
  _bx.copy(hint).addScaledVector(_bz, -hint.dot(_bz));
  if (_bx.lengthSq() < 1e-10) _bx.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
  _bx.normalize();
  _by.crossVectors(_bz, _bx);
  _bm.makeBasis(_bx, _by, _bz);
  return out.setFromRotationMatrix(_bm);
}

const _geoCache = new Map();
function adopt(mesh) {
  const src = mesh.geometry;
  let g = _geoCache.get(src);
  if (!g) {
    const [key, tint] = BAKED_MATERIALS[mesh.material.name] ?? ['glove'];
    g = adoptBakedGeometry(src, key, tint);
    g.setAttribute('skinIndex', src.attributes.skinIndex);
    g.setAttribute('skinWeight', src.attributes.skinWeight);
    g.userData.matKey = key;
    _geoCache.set(src, g);
  }
  mesh.geometry = g;
  mesh.material = gunMaterial(g.userData.matKey);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
}

function makeArm(gltf, isLeft) {
  const group = new THREE.Group();
  group.name = isLeft ? 'leftArm' : 'rightArm';
  const inst = SkeletonUtils.clone(gltf.scene);
  group.add(inst);
  if (isLeft) group.scale.x = -1;
  inst.traverse((o) => {
    if (o.isSkinnedMesh) adopt(o);
  });
  const bone = (n) => {
    const b = inst.getObjectByName(n);
    if (!b) throw new Error('gltfArms: missing bone ' + n);
    return b;
  };
  const upper = bone('upper'), fore = bone('fore'), twist = bone('twist'), hand = bone('hand');
  const fingers = FINGER_BONES.map((names) => names.map(bone));
  const thumb = THUMB_BONES.map(bone);
  // rest data in arm space (inst's parent chain inside `group`, without the mirror)
  group.updateMatrixWorld(true);
  const toArm = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const rest = new Map();
  const all = [upper, fore, twist, hand, ...fingers.flat(), ...thumb];
  for (const b of all) {
    _m.multiplyMatrices(toArm, b.matrixWorld).decompose(_tp, _tq, _ts);
    rest.set(b, { pos: _tp.clone(), q: _tq.clone(), local: b.quaternion.clone(), localPos: b.position.clone() });
  }
  _m.multiplyMatrices(toArm, upper.parent.matrixWorld).decompose(_tp, _tq, _ts);
  const base = { pos: _tp.clone(), q: _tq.clone(), scale: _ts.x };
  const L1 = rest.get(fore).pos.distanceTo(rest.get(upper).pos);
  const L2 = rest.get(hand).pos.distanceTo(rest.get(fore).pos);
  // curl axes (arm space, bind): fingers roll toward the palm (-X) about their side axis
  const fingerAxes = fingers.map((ch) => {
    const d = rest.get(ch[1]).pos.clone().sub(rest.get(ch[0]).pos).normalize();
    const axis = new V3().crossVectors(d, new V3(-1, 0, 0)).normalize();
    const splay = Math.atan2(d.y, -d.z); // bind spread toward the index side (+Y)
    return { axis, splay };
  });
  const td = rest.get(thumb[1]).pos.clone().sub(rest.get(thumb[0]).pos).normalize();
  const toward = new V3(-0.75, -0.25, -0.6).normalize(); // into the palm, toward the fingers
  const thumbAxis = new V3().crossVectors(td, toward).normalize();
  return { group, inst, isLeft, upper, fore, twist, hand, fingers, thumb, rest, base, L1, L2, fingerAxes, thumbAxis, curlOverride: null };
}

export function hasGltfArms() {
  return !!getGLB(MODELS.arms);
}

export function buildGltfArms() {
  const gltf = getGLB(MODELS.arms);
  if (!gltf) throw new Error('gltfArms: arms.glb not loaded');
  const root = new THREE.Group();
  root.name = 'fpArms';
  const R = makeArm(gltf, false), L = makeArm(gltf, true);
  root.add(R.group, L.group);
  const cfg = {
    // viewmodel space; the left shoulder is mirrored into arm space when solving
    shoulders: { right: new V3(0.2, -0.28, 0.25), left: new V3(-0.22, -0.3, 0.25) },
    poles: { right: new V3(1.0, -0.45, 0.0), left: new V3(-1.0, -0.55, 0.0) },
    alignWrist: 0.5, // how much the elbow moves to line the forearm up with the hand
    foreRoll: 0.35, // share of the hand's roll the upper forearm takes (the rest goes to the twist bone)
    palmOffset: 0.016,
    // share of the sideways wrist bend taken out by angling the hand on the grip (the firing hand
    // stays put: its grip angle lines the index finger up with the trigger)
    straighten: { right: 0, left: 0.75 },
    maxStraighten: 38 * DEG,
  };

  // world-space targets for every bone, converted to locals down the chain
  const wq = new Map();
  function setWorld(arm, b, q) {
    const pq = b.parent === arm.upper.parent ? arm.base.q : wq.get(b.parent);
    b.quaternion.copy(_q2.copy(pq).invert().multiply(q));
    wq.set(b, q.clone());
  }

  function poseFingers(arm, ud, handQ) {
    const c = arm.curlOverride ?? (ud.curl ?? 1);
    const base = [66, 86, 50], trig = [20, 40, 42];
    arm.fingers.forEach((chain, fi) => {
      let k = c;
      if (fi === 0 && ud.index !== undefined) k = ud.index;
      const extra = fi === 3 ? 1.06 : fi === 2 ? 1.03 : 1;
      const { axis, splay } = arm.fingerAxes[fi];
      let parentQ = handQ;
      for (let s = 0; s < 3; s++) {
        const b = chain[s];
        const r = arm.rest.get(b);
        const ang = (fi === 0 && ud.trigger ? trig[s] : base[s] * k * extra) * DEG;
        // bind-relative rotation (in the hand's frame): pull the spread fingers together as they curl, then flex
        _q.setFromAxisAngle(axis, ang);
        if (s === 0) _q.premultiply(_fq.setFromAxisAngle(REST_HINT, -splay * Math.min(1, k) * 0.65));
        // finger world = hand delta * flex chain (bind-space axes) * bind rotation
        const q = new Q().copy(parentQ).multiply(_q).multiply(r.q);
        setWorld(arm, b, q);
        parentQ = new Q().copy(parentQ).multiply(_q);
      }
    });
    // this thumb binds more open than the grip data assumes: bias the curl up so it rests on the weapon
    const th = 0.35 + 0.65 * (ud.thumb ?? 0.5), tb = [18, 30, 26];
    let parentQ = handQ;
    for (let s = 0; s < 3; s++) {
      const b = arm.thumb[s];
      _q.setFromAxisAngle(arm.thumbAxis, tb[s] * DEG * th);
      const q = new Q().copy(parentQ).multiply(_q).multiply(arm.rest.get(b).q);
      setWorld(arm, b, q);
      parentQ = new Q().copy(parentQ).multiply(_q);
    }
  }

  const _refCache = new WeakMap();
  function gripData(target, weaponRoot, key) {
    const ud = target.userData || {};
    if (ud.rx !== undefined || !weaponRoot) return ud;
    let refs = _refCache.get(weaponRoot);
    if (!refs) {
      refs = { right: weaponRoot.getObjectByName('rightHand'), left: weaponRoot.getObjectByName('leftHand') };
      _refCache.set(weaponRoot, refs);
    }
    return (refs[key] && refs[key].userData) || ud;
  }

  function solve(arm, target, key, weaponRoot) {
    if (!target) {
      arm.group.visible = false;
      return;
    }
    arm.group.visible = true;
    // target in arm space (the left arm's group mirrors, which turns a left-hand frame into a right-hand one)
    arm.group.updateWorldMatrix(true, false);
    _inv.copy(arm.group.matrixWorld).invert();
    _m.multiplyMatrices(_inv, target.matrixWorld).decompose(_tp, _tq, _ts);
    const ud = gripData(target, weaponRoot, key);
    _G.set(-(cfg.palmOffset + (ud.rx ?? 0.015)), ud.gy ?? 0.022, -(0.042 + (ud.rz ?? 0.02)));
    const a = arm.L1, b = arm.L2;
    let pole;
    // two-bone IK for the current hand frame: wrist _W, shoulder _S, elbow _E
    const ik = () => {
      _W.copy(_G).applyQuaternion(_tq).negate().add(_tp);
      _S.copy(cfg.shoulders[key]);
      if (arm.isLeft) _S.x = -_S.x;
      _u.subVectors(_W, _S);
      let d = _u.length();
      const maxR = (a + b) * 0.985, minR = Math.abs(a - b) + 0.05;
      if (d > maxR) {
        _S.addScaledVector(_u.normalize(), d - maxR);
        _u.subVectors(_W, _S);
        d = maxR;
      }
      if (d < minR) d = minR;
      _u.normalize();
      const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
      const sinA = Math.sqrt(1 - cosA * cosA);
      // elbow: blend the default pole with the elbow that lines the forearm up with the hand
      pole = _v.copy(cfg.poles[key]);
      if (arm.isLeft) pole.x = -pole.x;
      pole.addScaledVector(_u, -pole.dot(_u));
      if (pole.lengthSq() < 1e-8) pole.set(0, -1, 0).addScaledVector(_u, _u.y);
      pole.normalize();
      _tmp.set(0, 0, 1).applyQuaternion(_tq).multiplyScalar(b).add(_W).sub(_S);
      _tmp.addScaledVector(_u, -_tmp.dot(_u));
      const aw = typeof cfg.alignWrist === 'number' ? cfg.alignWrist : cfg.alignWrist[key];
      if (_tmp.lengthSq() > 1e-8) pole.multiplyScalar(1 - aw).addScaledVector(_tmp.normalize(), aw).normalize();
      _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(pole, a * sinA);
    };
    ik();
    // A wrist can't bend far sideways: turn the hand about its palm normal (local x, through the
    // grip axis, so the palm stays on the handguard) toward the forearm, then solve again.
    const k = cfg.straighten[key];
    if (k > 0) {
      const wristBend = () => _tmp.subVectors(_E, _W).applyQuaternion(_q.copy(_tq).invert()).normalize(); // wrist -> elbow, hand frame (+Z = straight)
      const before = wristBend().z;
      const bend = Math.atan2(_tmp.y, _tmp.z); // sideways part of the bend
      const turn = Math.max(-cfg.maxStraighten, Math.min(cfg.maxStraighten, -bend * k));
      _q2.copy(_tq);
      _tq.multiply(_q.setFromAxisAngle(_X, turn));
      ik();
      // a support hand cupping a pistol grip bends mostly the other way: keep the grip as authored then
      if (wristBend().z < before) {
        _tq.copy(_q2);
        ik();
      }
    }

    // roll: back of the hand direction, shared out down the forearm
    _h.set(1, 0, 0).applyQuaternion(_tq);
    const foreDir = _tmp.subVectors(_W, _E).normalize();
    // the roll the forearm would have if it didn't follow the hand: back of the forearm faces the pole side
    _h2.copy(pole).negate().cross(foreDir).cross(foreDir).negate();
    if (_h2.dot(_h) < 0) _h2.negate();
    const foreHint = new V3().copy(_h2).lerp(_h, cfg.foreRoll);
    const upperDir = new V3().subVectors(_E, _S).normalize();

    const qUpper = frameRot(upperDir, foreHint, new Q()).multiply(arm.rest.get(arm.upper).q);
    const qFore = frameRot(foreDir, foreHint, new Q()).multiply(arm.rest.get(arm.fore).q);
    const qTwist = frameRot(foreDir, _h, new Q()).multiply(arm.rest.get(arm.twist).q);
    const qHand = new Q().copy(_tq).multiply(arm.rest.get(arm.hand).q);

    // shoulder position in the armature's frame
    _v.copy(_S).sub(arm.base.pos).applyQuaternion(_q.copy(arm.base.q).invert()).divideScalar(arm.base.scale);
    arm.upper.position.copy(_v);
    setWorld(arm, arm.upper, qUpper);
    setWorld(arm, arm.fore, qFore);
    setWorld(arm, arm.twist, qTwist);
    setWorld(arm, arm.hand, qHand);
    poseFingers(arm, ud, _tq);
  }

  function update(rightTarget, leftTarget, weaponRoot) {
    if (weaponRoot) weaponRoot.updateWorldMatrix(true, true);
    else {
      rightTarget?.updateWorldMatrix(true, false);
      leftTarget?.updateWorldMatrix(true, false);
    }
    solve(R, rightTarget, 'right', weaponRoot);
    solve(L, leftTarget, 'left', weaponRoot);
    root.updateMatrixWorld(true);
  }
  function setFingerCurl(r, l) {
    R.curlOverride = r === undefined || r === null ? null : r;
    L.curlOverride = l === undefined || l === null ? null : l;
  }
  R.group.visible = false;
  L.group.visible = false;
  return { root, update, setFingerCurl, config: cfg, right: R, left: L };
}
