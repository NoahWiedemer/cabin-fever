// First-person viewmodel: weapon + IK arms rendered on the viewmodel layer with procedural
// animation (sway, bob, recoil, draw, reloads, bolt cycling, melee, grenades, muzzle flash).
import * as THREE from 'three';
import { buildWeaponModel, buildArms } from './gunSafe.js';
import { buildGasCanViewmodel, buildRepairTool } from './gasCan.js';
import { buildReviveHands } from './reviveHands.js';
import { AkimboRig } from './akimboRig.js';
import { macheteSwing } from './machete.js';
import { VIEWMODEL_LAYER } from '../core/renderer.js';
import { tex } from '../world/textures.js';
import { clamp, damp, lerp, smoothstep } from '../core/utils.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
// full-sprint offsets [x, y, z, rx, ry, rz]: the gun drops and cants across the body (a def may bring its own)
const SPRINT_POSE = [-0.035, -0.03, 0.015, -0.22, 0.45, 0.3];

// smooth pulse: 0 before a, ramps to 1 between a..b, holds, ramps back between c..d
function pulse(f, a, b, c, d) {
  if (f <= a || f >= d) return 0;
  if (f < b) return smoothstep(a, b, f);
  if (f <= c) return 1;
  return 1 - smoothstep(c, d, f);
}

function setLayer(obj) {
  obj.traverse((o) => {
    o.layers.set(VIEWMODEL_LAYER);
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = true;
      o.frustumCulled = false;
    }
  });
}

export class Viewmodel {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'viewmodel';
    scene.add(this.root);
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.holder = new THREE.Group();
    this.pivot.add(this.holder);
    this.models = {};
    this.cur = null;
    this.def = null;
    this.ads = 0;
    this.visible = true;
    // springs
    this.recoilPos = new THREE.Vector3();
    this.recoilVel = new THREE.Vector3();
    this.recoilRot = new THREE.Vector3();
    this.recoilRotVel = new THREE.Vector3();
    this.sway = new THREE.Vector2();
    this.swayVel = new THREE.Vector2();
    this.bobPhase = 0;
    this.time = 0;
    this.drawT = 1;
    this.anim = null; // { kind, t, dur, ... }
    this.flashT = 0;
    this.flashDur = 0.045;
    this.flashS = 1;
    this.landDip = 0;
    this.spinAngle = 0;
    this.cylAngle = 0;
    this.cylTarget = 0;
    this.slideT = 1;
    this.akimbo = null; // an akimbo pair's left gun (akimboRig.js), made on first use
    this._drops = []; // [mag part, weapon id] pairs that fell out this frame (fx/magDrops.js)

    try {
      this.arms = buildArms();
      // shoulders slightly forward so the support hand can reach the forend with a bent elbow
      if (this.arms.config?.shoulders) {
        this.arms.config.shoulders.right.set(0.2, -0.3, 0.06);
        this.arms.config.shoulders.left.set(-0.14, -0.34, 0.05);
      }
      setLayer(this.arms.root);
      this.root.add(this.arms.root);
    } catch (e) {
      console.warn('arms failed', e);
      this.arms = null;
    }
    this.rightProxy = new THREE.Object3D();
    this.leftProxy = new THREE.Object3D();

    // viewmodel-only fill + rim lights (layer 1 only: they never touch the world)
    this.fill = new THREE.DirectionalLight(0xffe2c4, 0.45);
    this.fill.position.set(-0.6, 0.8, 0.4);
    this.fill.target.position.set(0.1, -0.2, -0.5);
    this.rim = new THREE.DirectionalLight(0x9fb8ff, 0.55);
    this.rim.position.set(0.8, 0.3, -1.2);
    this.rim.target.position.set(0.1, -0.2, -0.3);
    for (const l of [this.fill, this.rim]) {
      l.layers.set(VIEWMODEL_LAYER);
      this.root.add(l, l.target);
    }

    // muzzle flash quads
    let flashMap = null;
    try {
      flashMap = tex('muzzleFlash').map;
    } catch (e) {
      /* optional */
    }
    this.flashGroup = new THREE.Group();
    this.flashMats = [];
    const makeQuad = (w, h, rotY, frame) => {
      const g = new THREE.PlaneGeometry(w, h);
      const uv = g.attributes.uv;
      const fo = [(frame % 2) * 0.5, Math.floor(frame / 2) * 0.5];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + fo[0], uv.getY(i) * 0.5 + fo[1]);
      const m = new THREE.MeshBasicMaterial({
        map: flashMap,
        color: new THREE.Color(4, 2.8, 1.6),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.flashMats.push(m);
      const mesh = new THREE.Mesh(g, m);
      mesh.rotation.y = rotY;
      return mesh;
    };
    // front-facing star + two side petals
    const front = makeQuad(0.16, 0.16, 0, 0);
    this.flashGroup.add(front);
    const side1 = makeQuad(0.28, 0.1, Math.PI / 2, 1);
    side1.position.z = -0.1;
    this.flashGroup.add(side1);
    const side2 = side1.clone();
    side2.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.flashGroup.add(side2);
    this.flashGroup.visible = false;
    setLayer(this.flashGroup);
    this.shellProxy = null;

    // burning rag on the Molotov: two crossed flame quads (fire atlas cell 0 = upright flame)
    let fireMap = null;
    try {
      fireMap = tex('fire').map;
    } catch (e) {
      /* optional */
    }
    this.ragFlame = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const g = new THREE.PlaneGeometry(0.05, 0.085);
      g.translate(0, 0.036, 0);
      const uv = g.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * 0.5, uv.getY(j) * 0.5);
      const mat = new THREE.MeshBasicMaterial({
        map: fireMap,
        color: new THREE.Color(3.2, 1.9, 0.9),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const q = new THREE.Mesh(g, mat);
      q.rotation.y = (i * Math.PI) / 2;
      this.ragFlame.add(q);
    }
    this.ragFlame.visible = false;
    setLayer(this.ragFlame);
  }

  _getModel(id) {
    if (this.models[id]) return this.models[id];
    let m;
    try {
      // generator gear (world/power.js) isn't in the gun library
      m = id === 'gascan' ? buildGasCanViewmodel() : id === 'wrench' ? buildRepairTool() : id === 'hands' ? buildReviveHands() : buildWeaponModel(id);
    } catch (e) {
      console.error('weapon model failed', id, e);
      m = { root: new THREE.Group(), muzzle: new THREE.Object3D(), ejectPort: null, rightHand: new THREE.Object3D(), leftHand: null, sight: { eye: new THREE.Vector3(0, 0.08, 0.1) }, parts: {} };
      m.root.add(m.muzzle);
    }
    setLayer(m.root);
    m.root.visible = false;
    this.holder.add(m.root);
    // remember rest transforms of parts
    m.rest = {};
    for (const [k, p] of Object.entries(m.parts || {})) {
      if (p) m.rest[k] = { pos: p.position.clone(), rot: p.rotation.clone(), vis: p.visible };
    }
    if (m.magazineModel) {
      try {
        m.spareMag = m.magazineModel();
        setLayer(m.spareMag);
        m.spareMag.visible = false;
        m.root.add(m.spareMag);
      } catch (e) {
        m.spareMag = null;
      }
    }
    m.root.add(this.rightProxy);
    this.models[id] = m;
    return m;
  }

  prewarm(ids) {
    for (const id of ids) this._getModel(id);
  }

  equip(def, state) {
    const m = this._getModel(def.model);
    if (this.cur && this.cur !== m) this.cur.root.visible = false;
    this.cur = m;
    this.def = def;
    m.root.visible = true;
    this.drawT = state === 'quick' ? 0.6 : 0;
    this.anim = null;
    this._resetParts(m);
    if (this.arms?.config?.straighten) {
      const c = this.arms.config, pistol = def.slot === 1;
      // long guns: move the elbows until forearm and hand line up (no kinked wrists); pistols are held
      // close to the face, where a straight forearm would lift the elbow into view
      c.alignWrist = pistol ? 0.5 : { right: 0.9, left: 0.8 };
      // pistols: the support arm comes up steeply from below, so only the cupping hand shows
      c.shoulders.left.set(...(pistol ? [-0.06, -0.62, 0.02] : [-0.14, -0.34, 0.05]));
      c.poles.left.set(...(pistol ? [-0.2, -1, 0.15] : [-1, -0.55, 0]));
      // akimbo: the left arm mirrors the right one, closing on its own gun with the same firing grip
      c._straightenL ??= c.straighten.left;
      c.straighten.left = def.akimbo ? c.straighten.right : c._straightenL;
      if (def.akimbo) {
        c.shoulders.left.set(-0.2, -0.3, 0.06);
        c.poles.left.set(-1, -0.45, 0);
      }
    }
    if (def.akimbo) (this.akimbo ??= new AkimboRig(this)).equip(def);
    else this.akimbo?.hide();
    // attach flash & proxies
    if (m.muzzle) m.muzzle.add(this.flashGroup);
    if (m.rag) m.rag.add(this.ragFlame);
    this.ragFlame.visible = !!m.rag;
    m.root.add(this.rightProxy);
    m.root.add(this.leftProxy);
    this.flashGroup.visible = false;
    if (state === 'quick') this.anim = { kind: 'grenade', t: 0 };
  }

  _resetParts(m) {
    for (const [k, r] of Object.entries(m.rest)) {
      const p = m.parts[k];
      p.position.copy(r.pos);
      p.rotation.copy(r.rot);
      p.visible = r.vis;
    }
    if (m.spareMag) m.spareMag.visible = false;
  }

  setAds(a) {
    this.ads = a;
  }

  onFire(def, side = 0) {
    if (side && this.akimbo) return this.akimbo.onFire(def); // an akimbo pair's left gun
    const k = def.kick ?? 1;
    const a = 1 - this.ads * 0.55; // ADS keeps the sights on target
    // sharp punch straight back and muzzle-up: an instant offset (m / rad) plus a small shove,
    // then the stiff springs snap it home in ~0.15 s; capped so full-auto can't stack it
    this.recoilPos.z = Math.min(0.06, this.recoilPos.z + 0.012 * k * a);
    this.recoilPos.y += 0.002 * k * a;
    this.recoilVel.z += 0.15 * k * a;
    this.recoilRot.x = Math.min(0.14, this.recoilRot.x + 0.02 * k * a);
    this.recoilRotVel.x += 0.25 * k * a;
    this.recoilRotVel.z += (Math.random() - 0.5) * 0.6 * k;
    this.recoilRotVel.y += (Math.random() - 0.5) * 0.3 * k;
    this.flashT = this.flashDur = def.pellets > 1 ? 0.06 : 0.045;
    this.flashGroup.visible = true;
    this.flashGroup.rotation.z = Math.random() * Math.PI * 2;
    const s = def.pellets > 1 ? 1.5 : def.id === 'l96a1' ? 1.8 : def.id === 'm9' ? 0.75 : def.id === 'chaingun' ? 1.2 : 1;
    this.flashS = s * (0.8 + Math.random() * 0.4);
    this.flashGroup.scale.setScalar(this.flashS);
    this.slideT = 0;
    if (def.id === 'm32') this.cylTarget += Math.PI / 3;
    if (def.id === 'goldenPunisher') this.cylTarget += Math.PI / 6;
    if (def.cylStep) this.cylTarget += def.cylStep;
    if (def.mode === 'bolt') this.anim = { kind: 'bolt', t: 0, dur: def.boltTime };
    if (def.mode === 'pump') this.anim = { kind: 'pump', t: 0, dur: def.boltTime };
  }

  onReload(def, phase, duration, empty) {
    if (phase === 'mag') this.anim = { kind: 'mag', t: 0, dur: duration, empty };
    else if (phase === 'shellStart') this.anim = { kind: 'shell', sub: 'start', t: 0, dur: def.reloadStart, tilt: 0 };
    else if (phase === 'shellInsert') this.anim = { kind: 'shell', sub: 'insert', t: 0, dur: duration, tilt: 1 };
    else if (phase === 'shellEnd') this.anim = { kind: 'shell', sub: 'end', t: 0, dur: duration, tilt: 1, empty };
    else if (phase === 'akimbo') this.anim = { kind: 'akimbo', t: 0, dur: duration, empty, dropped: [false, false] }; // empty: [right, left]
  }

  /** Pump-action rack: forend + bolt slide back and return, the support hand rides the forend. */
  _rack(m, k) {
    const P = m.parts;
    const off = k * (m.pumpStroke ?? 0.07);
    if (P.pump && m.rest.pump) P.pump.position.z = m.rest.pump.pos.z + off;
    if (P.bolt && m.rest.bolt) P.bolt.position.z = m.rest.bolt.pos.z + off;
    if (m.leftHand) {
      this.leftProxy.position.copy(m.leftHand.position);
      this.leftProxy.position.z += off;
      this.leftProxy.quaternion.copy(m.leftHand.quaternion);
    }
  }

  getMuzzleWorld(out, side = 0) {
    // project the viewmodel muzzle into the world camera (side 1: an akimbo pair's left gun)
    const muzzle = side ? this.akimbo?.muzzle : this.cur?.muzzle;
    if (!muzzle || !this.vmCamera || !this.worldCamera) {
      return out.copy(this.worldCamera ? this.worldCamera.position : _v.set(0, 0, 0));
    }
    muzzle.getWorldPosition(out);
    // out is in world coordinates but relative to the vm camera's projection; re-project
    out.project(this.vmCamera);
    const ndcZ = new THREE.Vector3(0, 0, -0.7).applyMatrix4(this.worldCamera.projectionMatrix).z;
    out.z = ndcZ;
    out.unproject(this.worldCamera);
    return out;
  }

  getEjectWorld(out, side = 0) {
    const obj = side ? this.akimbo?.ejectPort : this.cur?.ejectPort || this.cur?.muzzle;
    if (!obj || !this.vmCamera || !this.worldCamera) return out.copy(this.worldCamera?.position ?? _v.set(0, 0, 0));
    obj.getWorldPosition(out);
    out.project(this.vmCamera);
    const ndcZ = new THREE.Vector3(0, 0, -0.45).applyMatrix4(this.worldCamera.projectionMatrix).z;
    out.z = ndcZ;
    out.unproject(this.worldCamera);
    return out;
  }

  setVisible(v) {
    this.visible = v;
    this.root.visible = v;
  }

  /** A reload lets the mag part `obj` of weapon `id` fall out: it becomes a world magazine this frame. */
  dropMag(obj, id) {
    this._drops.push(obj, id);
  }

  _flushDrops(weapons, player) {
    const mags = weapons?.game?.fx?.mags; // none in the weapon viewer
    const q = this._drops;
    for (let i = 0; i < q.length; i += 2) mags?.drop(q[i], q[i + 1], this.worldCamera, this.vmCamera, player?.body?.vel);
    q.length = 0;
  }

  update(dt, { camera, vmCamera, player, weapons, mouseDX, mouseDY }) {
    this.worldCamera = camera;
    this.vmCamera = vmCamera;
    this.time += dt;
    const m = this.cur;
    const def = this.def;
    if (!m || !def) return;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);
    vmCamera.position.copy(camera.position);
    vmCamera.quaternion.copy(camera.quaternion);
    vmCamera.updateMatrixWorld(true);

    const ads = this.ads;
    const adsE = ads; // WeaponSystem already eases ADS (fast start, soft landing)

    // ---- springs (substepped: stiff enough to snap back fast, stable on long frames)
    const stiff = 420, dampK = 26;
    const steps = Math.ceil(dt * 120);
    const h = steps > 0 ? dt / steps : 0;
    for (let i = 0; i < steps; i++) {
      this.recoilVel.addScaledVector(this.recoilPos, -stiff * h);
      this.recoilVel.multiplyScalar(Math.exp(-dampK * h));
      this.recoilPos.addScaledVector(this.recoilVel, h);
      this.recoilRotVel.addScaledVector(this.recoilRot, -stiff * h);
      this.recoilRotVel.multiplyScalar(Math.exp(-dampK * h));
      this.recoilRot.addScaledVector(this.recoilRotVel, h);
    }
    // sway from mouse movement
    const swayAmt = 1 - adsE * 0.85;
    this.swayVel.x += -mouseDX * 0.0009 * swayAmt;
    this.swayVel.y += -mouseDY * 0.0009 * swayAmt;
    this.swayVel.addScaledVector(this.sway, -90 * dt);
    this.swayVel.multiplyScalar(Math.exp(-11 * dt));
    this.sway.addScaledVector(this.swayVel, dt);
    this.sway.x = clamp(this.sway.x, -0.08, 0.08);
    this.sway.y = clamp(this.sway.y, -0.08, 0.08);

    // ---- bob
    const spd = player.horizontalSpeed;
    const moving = clamp(spd / 5, 0, 1.2) * (player.onGround ? 1 : 0.2);
    this.bobPhase += dt * (spd * 1.9 + 0.001);
    const bobAmt = moving * (1 - adsE * 0.9) * (def.id === 'chaingun' ? 1.5 : 1);
    const bx = Math.sin(this.bobPhase) * 0.011 * bobAmt;
    const by = -Math.abs(Math.cos(this.bobPhase)) * 0.012 * bobAmt;
    const idleBreath = Math.sin(this.time * 1.6) * 0.0022 * (1 - adsE * 0.7);
    this.landDip = damp(this.landDip, 0, 8, dt);
    const strafeRoll = clamp(player.localVelX / 5, -1, 1) * -0.05 * (1 - adsE * 0.8);

    // ---- base placement: hip ↔ ADS
    const hip = _v.fromArray(def.hip || [0.13, -0.15, -0.3]);
    const eye = m.sight?.eye ?? new THREE.Vector3(0, 0.08, 0.1);
    const adsPos = new THREE.Vector3(-eye.x, -eye.y, -eye.z - 0.0);
    const pos = new THREE.Vector3().lerpVectors(hip, adsPos, adsE);
    const hr = def.hipRot || [0, 0.06, 0.03];
    let rx = hr[0] * (1 - adsE), ry = hr[1] * (1 - adsE), rz = hr[2] * (1 - adsE);
    if (player.crouching) pos.y -= 0.01 * (1 - adsE);

    // sprint: gun drops and cants across the body (weapons.sprintK; the sprint-out gates firing)
    const spr = (weapons.sprintK ?? 0) * (1 - adsE);
    if (spr > 0.001) {
      const S = def.sprintPose ?? SPRINT_POSE;
      pos.x += S[0] * spr;
      pos.y += S[1] * spr;
      pos.z += S[2] * spr;
      rx += S[3] * spr;
      ry += S[4] * spr;
      rz += S[5] * spr;
    }
    if (def.akimbo) this.akimbo?.setBase(pos, rx, ry, rz); // the left gun shares the hip + sprint pose

    // draw animation
    if (this.drawT < 1) {
      this.drawT = Math.min(1, this.drawT + dt / Math.max(0.2, def.drawTime ?? 0.4));
      const e = 1 - Math.pow(1 - this.drawT, 3);
      pos.y -= (1 - e) * 0.22;
      pos.x += (1 - e) * 0.05;
      rx -= (1 - e) * 0.9;
      rz += (1 - e) * 0.3;
    }

    // reset animatable parts each frame to rest
    this._resetParts(m);
    let rightTarget = m.rightHand;
    let leftTarget = m.leftHand;
    let leftBlend = 0; // 0 = on weapon, 1 = on proxy
    const P = m.parts || {};

    // continuous part animation: slide / bolt kick after firing
    this.slideT = Math.min(1, this.slideT + dt / 0.07);
    const slideK = Math.sin(Math.min(1, this.slideT) * Math.PI);
    if (P.slide && m.rest.slide) P.slide.position.z = m.rest.slide.pos.z + slideK * 0.035;
    if (P.bolt && m.rest.bolt && def.mode !== 'bolt' && def.mode !== 'pump') P.bolt.position.z = m.rest.bolt.pos.z + slideK * 0.05;
    // cylinders / drums
    this.cylAngle = damp(this.cylAngle, this.cylTarget, 18, dt);
    if (P.cylinder && m.rest.cylinder) P.cylinder.rotation.z = m.rest.cylinder.rot.z + this.cylAngle;
    // chaingun barrels
    if (P.barrels && m.rest.barrels) {
      this.spinAngle += dt * weapons.spin * 45;
      P.barrels.rotation.z = m.rest.barrels.rot.z + this.spinAngle;
      if (weapons.spin > 0.2) {
        pos.x += (Math.random() - 0.5) * 0.002 * weapons.spin;
        pos.y += (Math.random() - 0.5) * 0.002 * weapons.spin;
      }
    }

    // ---- state animations
    const st = weapons.state;
    const a = this.anim;
    if (a) a.t += dt;
    if (a && a.kind === 'akimbo' && st === 'reload' && this.akimbo) {
      // the right gun's half of the pair reload (the rig does the left one in akimbo.update below)
      const o = this.akimbo.reloadPose(clamp(a.t / a.dur, 0, 1), 0, a, m, def.model);
      pos.x += o.x;
      pos.y += o.y;
      pos.z += o.z;
      rx += o.rx;
      ry += o.ry;
      rz += o.rz;
    } else if (a && a.kind === 'mag' && st === 'reload') {
      const f = clamp(a.t / a.dur, 0, 1);
      const tilt = pulse(f, 0.0, 0.15, 0.82, 1.0);
      if (m.magTop) {
        rz += tilt * 0.3; // roll left: the magazine on top turns toward the support hand
        rx += tilt * 0.12;
      } else {
        rz -= tilt * 0.38; // roll right: magwell turns toward the support hand
        rx += tilt * 0.22; // muzzle up
      }
      ry += tilt * 0.12;
      pos.x -= tilt * 0.05;
      pos.y += tilt * 0.03;
      const isPistol = def.id === 'm9';
      if (P.mag && m.rest.mag && m.magTop) {
        // top-loaded (P90): slide the magazine back out from under the rail, swing it away down to the
        // left and let it fall; the fresh one comes back the same way and slides home
        const t = f < 0.34 ? smoothstep(0.1, 0.3, f) : 1 - smoothstep(0.34, 0.55, f);
        const slide = smoothstep(0, 0.5, t);
        const carry = smoothstep(0.5, 1, t);
        const r = m.rest.mag.pos;
        P.mag.position.set(r.x - 0.15 * carry, r.y + 0.012 * slide - 0.2 * carry, r.z + 0.17 * slide);
        if (f < 0.34 && t >= 0.6 && !a.dropped) {
          a.dropped = true;
          this.dropMag(P.mag, def.model);
        }
        P.mag.visible = f >= 0.34 || !a.dropped;
        leftBlend = pulse(f, 0.06, 0.12, 0.56, 0.66);
        this.leftProxy.position.copy(P.mag.position);
        this.leftProxy.position.x -= 0.025; // palm on the magazine's left flank
        this.leftProxy.quaternion.copy(m.leftHand ? m.leftHand.quaternion : _q.identity());
        if (f > 0.26 && f < 0.36) this.leftProxy.position.y -= 0.12; // grab a fresh one off-screen
      } else if (P.mag && m.rest.mag) {
        const out = smoothstep(0.1, 0.28, f);
        const back = smoothstep(0.34, 0.55, f);
        if (f < 0.34) {
          P.mag.position.y = m.rest.mag.pos.y - out * 0.3;
          // the empty falls free as it clears the well (fx/magDrops.js); the hand goes on down for a fresh one
          if (f >= 0.13 && !a.dropped) {
            a.dropped = true;
            this.dropMag(P.mag, def.model);
          }
          P.mag.visible = !a.dropped && out < 0.95;
        } else {
          P.mag.position.y = m.rest.mag.pos.y - (1 - back) * 0.25;
          P.mag.visible = true;
        }
        // left hand follows the magazine
        leftBlend = pulse(f, 0.08, 0.16, 0.56, 0.68);
        this.leftProxy.position.copy(P.mag.position);
        this.leftProxy.position.y -= 0.05;
        this.leftProxy.quaternion.copy(m.leftHand ? m.leftHand.quaternion : _q.identity());
        if (f > 0.26 && f < 0.36) this.leftProxy.position.y -= 0.12; // grab a fresh one off-screen
      }
      // seat jolt
      const jolt = pulse(f, 0.52, 0.56, 0.56, 0.62);
      pos.y += jolt * 0.012;
      rx += jolt * 0.05;
      // charging handle / slide release when empty
      if (a.empty) {
        const ch = pulse(f, 0.68, 0.74, 0.76, 0.82);
        if (P.chargingHandle && m.rest.chargingHandle) P.chargingHandle.position.z = m.rest.chargingHandle.pos.z + ch * 0.07;
        if (P.slide && m.rest.slide && isPistol) P.slide.position.z = m.rest.slide.pos.z + ch * 0.035;
        if (P.bolt && m.rest.bolt && def.mode !== 'bolt') P.bolt.position.z = m.rest.bolt.pos.z + ch * 0.06;
        if (P.boltHandle && m.rest.boltHandle) {
          P.boltHandle.rotation.z = m.rest.boltHandle.rot.z + pulse(f, 0.66, 0.7, 0.8, 0.84) * 1.1;
        }
        rz -= ch * 0.15;
        if (!isPistol && P.chargingHandle) {
          leftBlend = Math.max(leftBlend, pulse(f, 0.62, 0.68, 0.8, 0.86));
          if (leftBlend > 0 && f > 0.6) {
            this.leftProxy.position.copy(P.chargingHandle.position);
            this.leftProxy.position.y += 0.02;
          }
        }
      }
    } else if (a && a.kind === 'shell' && st === 'shellReload') {
      const f = clamp(a.t / Math.max(0.01, a.dur), 0, 1);
      let tilt = 1;
      if (a.sub === 'start') tilt = smoothstep(0, 1, f);
      if (a.sub === 'end') tilt = 1 - smoothstep(0.2, 1, f);
      rz += tilt * 0.4; // roll left so the loading port faces down-left toward the support hand
      rx += tilt * 0.25;
      pos.x -= tilt * 0.06;
      pos.y += tilt * 0.035;
      if (a.sub === 'insert') {
        // left hand brings a shell from below into the loading port
        leftBlend = 1;
        const push = pulse(f, 0.0, 0.45, 0.6, 1.0);
        const port = new THREE.Vector3(0, -0.035, -0.1);
        if (def.id === 'm32') port.set(0, 0.0, -0.12);
        if (m.loadPort) port.copy(m.loadPort);
        this.leftProxy.position.set(port.x - 0.02, port.y - 0.16 * (1 - push), port.z + 0.02);
        this.leftProxy.rotation.set(0.6, 0, 0.3);
        if (m.spareMag) {
          m.spareMag.visible = push < 0.9;
          m.spareMag.position.copy(this.leftProxy.position).add(new THREE.Vector3(0, 0.05, 0));
          m.spareMag.rotation.set(0, 0, 0);
        }
        pos.y += Math.sin(f * Math.PI) * 0.004;
        if (def.id === 'm32' && P.cylinder && m.rest.cylinder) P.cylinder.rotation.z += f * (Math.PI / 3);
      }
      if (a.sub === 'end' && P.pump && a.empty) {
        // rack the pump to chamber the first shell
        const k = pulse(f, 0.15, 0.35, 0.45, 0.7);
        this._rack(m, k);
        leftBlend = 1;
      } else if (a.sub === 'end' && P.bolt && m.rest.bolt) {
        P.bolt.position.z = m.rest.bolt.pos.z + pulse(f, 0.2, 0.35, 0.45, 0.6) * 0.06;
      }
    } else if (a && a.kind === 'pump' && st === 'bolt') {
      const f = clamp(a.t / a.dur, 0, 1);
      const k = pulse(f, 0.12, 0.34, 0.44, 0.72);
      this._rack(m, k);
      leftBlend = 1;
      rx += k * 0.05;
      rz += k * 0.06;
      pos.z += k * 0.012;
    } else if (a && a.kind === 'bolt' && st === 'bolt') {
      const f = clamp(a.t / a.dur, 0, 1);
      const up = pulse(f, 0.08, 0.2, 0.62, 0.74);
      const back = pulse(f, 0.2, 0.36, 0.42, 0.58);
      if (P.boltHandle && m.rest.boltHandle) P.boltHandle.rotation.z = m.rest.boltHandle.rot.z + up * 1.15;
      if (P.bolt && m.rest.bolt) P.bolt.position.z = m.rest.bolt.pos.z + back * 0.085;
      if (P.boltHandle && m.rest.boltHandle && !P.bolt) P.boltHandle.position.z = m.rest.boltHandle.pos.z + back * 0.1;
      const g = pulse(f, 0.05, 0.2, 0.7, 0.9);
      rz += g * 0.3;
      rx += g * 0.08;
      pos.y -= g * 0.01;
      // right hand leaves the grip to work the bolt
      if (P.boltHandle) {
        const rb = pulse(f, 0.02, 0.12, 0.76, 0.9);
        if (rb > 0) {
          P.boltHandle.updateMatrixWorld(true);
          m.root.updateMatrixWorld(true);
          this.rightProxy.position.copy(P.boltHandle.getWorldPosition(_v));
          m.root.worldToLocal(this.rightProxy.position);
          this.rightProxy.position.lerpVectors(m.rightHand.position, this.rightProxy.position, rb);
          this.rightProxy.quaternion.copy(m.rightHand.quaternion);
          rightTarget = this.rightProxy;
        }
      }
    } else if (st === 'melee' || st === 'heavy') {
      const heavy = st === 'heavy';
      const T = heavy ? def.heavyTime : def.swingTime;
      const f = clamp(weapons.stateT / T, 0, 1);
      if (def.id === 'machete') {
        // store gear: a diagonal chop / an overhead hack (player/machete.js)
        const o = macheteSwing(f, heavy, Object.assign((this._mo ??= {}), { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }));
        pos.x += o.x;
        pos.y += o.y;
        pos.z += o.z;
        rx += o.rx;
        ry += o.ry;
        rz += o.rz;
      } else if (heavy) {
        const wind = pulse(f, 0, 0.3, 0.32, 0.4);
        const thrust = pulse(f, 0.32, 0.42, 0.55, 0.9);
        pos.z += wind * 0.08 - thrust * 0.28;
        pos.x -= thrust * 0.1;
        pos.y += wind * 0.03 + thrust * 0.04;
        rx += -wind * 0.4 + thrust * 0.25;
        ry += thrust * 0.4;
      } else {
        const sw = pulse(f, 0, 0.25, 0.35, 1.0);
        const prog = smoothstep(0.02, 0.32, f);
        pos.x += lerp(0.12, -0.25, prog) * sw;
        pos.y += lerp(0.06, -0.06, prog) * sw;
        pos.z -= 0.12 * sw;
        ry += lerp(-0.9, 1.0, prog) * sw;
        rz += lerp(0.9, -0.6, prog) * sw;
        rx += 0.3 * sw;
      }
    } else if (st === 'pinpull' || st === 'throw') {
      const f = weapons.stateT;
      if (st === 'pinpull') {
        const k = smoothstep(0, 0.3, f);
        pos.x -= 0.05 * k;
        pos.y += 0.02 * k;
        rz += 0.3 * k;
        if (P.pin && m.rest.pin) {
          P.pin.position.x = m.rest.pin.pos.x - k * 0.12;
          P.pin.position.y = m.rest.pin.pos.y - k * 0.06;
          P.pin.visible = k < 0.9;
        }
        leftBlend = k;
        if (P.pin) {
          this.leftProxy.position.copy(P.pin.position);
          this.leftProxy.rotation.set(0, 0, 1.2);
        }
      } else {
        const back = pulse(f, 0, 0.1, 0.1, 0.2);
        const fwd = smoothstep(0.08, 0.25, f);
        pos.z += back * 0.12 - fwd * 0.25;
        pos.y += back * 0.1 - fwd * 0.15;
        rx += -back * 0.8 + fwd * 0.9;
        if (P.pin) P.pin.visible = false;
        if (f > 0.14) m.root.visible = f > 0.45; // grenade leaves the hand
        pos.y -= smoothstep(0.25, 0.45, f) * 0.3;
      }
    } else if (def.mode === 'build' && weapons.buildT != null) {
      // nailing a barricade (world/barricades.js): the planks are pressed to the doorway and the
      // hammer winds up, strikes at 72 % of each beat (the nail sound) and recoils
      const t = weapons.buildT;
      const k = smoothstep(0, 0.15, t);
      pos.x -= 0.03 * k;
      pos.y += 0.035 * k;
      pos.z -= 0.07 * k;
      rx += 0.14 * k;
      const S = weapons.buildStrike ?? 0.3;
      const f = (t % S) / S;
      const swing = f < 0.62 ? smoothstep(0, 0.62, f) : f < 0.74 ? 1 - 1.25 * smoothstep(0.62, 0.74, f) : -0.25 * (1 - smoothstep(0.74, 1, f));
      if (P.hammer && m.rest.hammer) {
        P.hammer.rotation.x = m.rest.hammer.rot.x + swing * 0.6 * k;
        P.hammer.position.y = m.rest.hammer.pos.y + swing * 0.04 * k;
        P.hammer.position.z = m.rest.hammer.pos.z + swing * 0.02 * k;
      }
      if (P.bundle && m.rest.bundle) P.bundle.position.z = m.rest.bundle.pos.z - 0.05 * k;
      pos.y -= pulse(f, 0.72, 0.75, 0.75, 0.86) * 0.006 * k; // the blow jolts the hands
      m.root.visible = true;
    } else if (def.mode === 'tool') {
      // generator repair (world/power.js): a pipe wrench cranks a seized nut in short strokes about its
      // jaw, then the wrench goes and the right hand rips the pull-start cord
      const t = weapons.toolT ?? 0;
      const Y = weapons.toolYank ?? 1.85;
      const k = smoothstep(0, 0.25, t);
      if (t < Y) {
        const S = 0.62;
        const f = (t % S) / S;
        const push = f < 0.5 ? smoothstep(0.02, 0.5, f) : 1 - smoothstep(0.58, 1, f);
        if (P.wrench) P.wrench.rotateY(push * 0.42 * k);
        pos.y -= (0.015 + push * 0.012) * k;
        pos.z -= 0.02 * k;
        rx -= 0.1 * k;
        rz -= push * 0.04 * k;
      } else {
        const u = t - Y;
        if (P.wrench) P.wrench.visible = false;
        if (P.pull && m.rest.pull) {
          P.pull.visible = true;
          const yank = smoothstep(0.08, 0.24, u) * (1 - smoothstep(0.45, 0.85, u));
          const r = m.rest.pull.pos;
          P.pull.position.set(r.x + yank * 0.14, r.y + yank * 0.18, r.z + yank * 0.25);
          P.pull.rotation.x = m.rest.pull.rot.x + yank * 0.5;
          rz += yank * 0.12;
          ry -= yank * 0.1;
          pos.y += yank * 0.02;
        }
        rightTarget = m.pullHand ?? rightTarget;
        leftTarget = null;
        pos.y -= 0.02 * (1 - smoothstep(0, 0.1, u));
      }
      m.root.visible = true;
    } else if (def.mode === 'revive') {
      // reviving a teammate (game/revive.js): both hands reach down onto the body and press in rhythm
      const t = weapons.toolT ?? 0;
      const k = smoothstep(0, 0.35, t);
      const f = (t * 1.7) % 1;
      const push = f < 0.3 ? smoothstep(0, 0.3, f) : 1 - smoothstep(0.3, 1, f);
      pos.y -= (0.04 + push * 0.035) * k;
      pos.z -= 0.05 * k;
      rx -= 0.15 * k + push * 0.05 * k;
      m.root.visible = true;
    } else if (def.mode === 'pour') {
      // gas can: carried one-handed by the middle grip; to pour, the left hand comes up onto the rear
      // grip and the can tips forward over the filler, fuel running from the spout
      leftTarget = null;
      const t = weapons.pourT;
      if (t != null) {
        const k = smoothstep(0.05, 0.45, t);
        const glug = Math.sin(t * 11) * k;
        // lifted a little, out in front, rolled over to the left until the spout points down
        if (P.can && m.rest.can) {
          P.can.rotation.z = m.rest.can.rot.z + 1.05 * k + glug * 0.02;
          P.can.rotation.x = m.rest.can.rot.x - 0.15 * k;
        }
        if (P.stream) P.stream.visible = k > 0.8;
        pos.x -= 0.03 * k;
        pos.y += 0.07 * k + glug * 0.003;
        pos.z -= 0.12 * k;
        leftTarget = m.leftAt ? m.leftAt(smoothstep(0, 0.3, t)) : m.leftHand;
      }
      m.root.visible = true;
    } else if (st === 'idle') {
      m.root.visible = true;
    }

    // landing
    pos.y += this.landDip * -0.03;

    // compose holder transform (recoil springs are in metres / radians)
    this.holder.position.set(
      pos.x + bx * (1 - adsE * 0.7) + this.recoilPos.x,
      pos.y + by + idleBreath + this.recoilPos.y,
      pos.z + this.recoilPos.z
    );
    this.holder.rotation.set(
      rx + this.recoilRot.x + this.sway.y,
      ry + this.recoilRot.y + this.sway.x,
      rz + this.recoilRot.z + strafeRoll + this.sway.x * 0.5
    );

    // left hand proxy blend
    if (leftBlend > 0 && m.leftHand) {
      const lp = this.leftProxy;
      const tp = lp.position.clone();
      lp.position.lerpVectors(m.leftHand.position, tp, leftBlend);
      leftTarget = lp;
    }

    if (this.ragFlame.visible) {
      const f = 0.85 + Math.sin(this.time * 31) * 0.08 + Math.random() * 0.12;
      this.ragFlame.scale.set(f, 0.9 + Math.random() * 0.35, f);
      this.ragFlame.rotation.y = this.time * 3;
    }

    // muzzle flash: full size on the shot frame, collapses over its short life
    if (this.flashT > 0) {
      this.flashGroup.scale.setScalar(this.flashS * (0.55 + 0.45 * (this.flashT / this.flashDur)));
      this.flashT -= dt;
      if (this.flashT <= 0) this.flashGroup.visible = false;
    }

    // akimbo: the left gun (mirrored), moving with the right one; the left hand closes on it
    if (def.akimbo && this.akimbo) {
      const sh = (this._shared ??= {});
      sh.x = bx * (1 - adsE * 0.7);
      sh.y = by + idleBreath - this.landDip * 0.03;
      sh.pitch = this.sway.y;
      sh.yaw = this.sway.x;
      sh.roll = strafeRoll + this.sway.x * 0.5;
      leftTarget = this.akimbo.update(dt, def, st, a, this.drawT, sh) ?? leftTarget;
    }
    if (this._drops.length) this._flushDrops(weapons, player);

    this.root.updateMatrixWorld(true);
    m.animate?.(dt); // model extras that need the posed world matrices (the gas can's fuel stream)
    if (this.arms) {
      try {
        this.arms.update(rightTarget, leftTarget, m.root);
      } catch (e) {
        /* ignore IK failures */
      }
    }
  }

  land(v) {
    this.landDip = Math.min(1, v / 8);
  }
}
