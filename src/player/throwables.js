// Models for the store's special throwables and the pocket gadget (weaponDefs.js mine / pipebomb, game/gear.js
// shockwave), built with gunModels.js' kit so they share the arsenal's materials and wear:
//   M16A1 bounding mine   an olive drab steel can like Combat Arms' "M16A1 Mine": a domed top, a yellow band and
//                         stencil, the M605 fuze with its three prongs, a safety pin with a pull ring (the
//                         viewmodel's pin part: pulled before the throw) and an arming LED (game/projectiles.js)
//   pipe bomb             the taped steel pipe (hex caps, a timer box with a red LED, leads, a fuse): the lure
//                         grenade
//   shockwave emitter     a rugged belt box with a ringed emitter dish and a blue core (the store's product shot)
// buildMineModel() / buildCharge() are world models (projectiles); build*Viewmodel() follow the first-person
// weapon contract ({ root, muzzle, rightHand, leftHand, sight, parts, magazineModel }).
import * as THREE from 'three';
import { gunKit } from './gunModels.js';

const PI = Math.PI;
const DEG = PI / 180;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// a soft round halo (the LEDs; bloom picks it up)
let GLOW = null;
function glowTexture() {
  return (GLOW ??= canvasTexture(64, 64, (c, w) => {
    const r = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = r;
    c.fillRect(0, 0, w, w);
  }));
}

function led(parent, pos, color, name = 'led') {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 10, 8), new THREE.MeshStandardMaterial({ color: 0x300000, emissive: color, emissiveIntensity: 0.4 }));
  m.name = name;
  m.position.set(pos[0], pos[1], pos[2]);
  parent.add(m);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.name = 'glow';
  glow.position.set(pos[0], pos[1], pos[2] + 0.004);
  glow.scale.setScalar(0.001);
  parent.add(glow);
  return m;
}

/* ------------------------------------------------------------------ M16A1 bounding mine */

// the stencil around the can: "MINE APERS M16A1" in yellow, Combat Arms style
let STENCIL = null;
function stencilMaterial() {
  if (STENCIL) return STENCIL;
  const tex = canvasTexture(512, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    c.fillStyle = '#d8b224';
    c.font = 'bold 34px "Black Ops One", Impact, "Arial Black", sans-serif';
    c.textBaseline = 'middle';
    const txt = 'MINE APERS M16A1  ▲  LOT 64-A  ▲  ';
    c.fillText(txt, 6, h / 2 + 2);
    c.fillText(txt, 6 + c.measureText(txt).width, h / 2 + 2);
  });
  STENCIL = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.7, metalness: 0.1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  return STENCIL;
}

/**
 * The mine, standing on its base (y = 0 is the ground, +Y up, 17 cm tall). Children: 'pin' (the safety pin and
 * its pull ring, on the -X side of the fuze), 'led' + 'glow' (the arming light).
 */
export function buildMineModel() {
  const K = gunKit;
  K.seed(0x16a1);
  const g = new THREE.Group();
  g.name = 'mineModel';
  const B = new K.PB();
  const up = [-PI / 2, 0, 0]; // lathes run along +Z: stand them up
  // the can: a flat base, straight sides, a rolled top rim and a shallow dome to the fuze well
  B.add('od', K.xf(K.lathe([[0, 0], [0.046, 0], [0.0495, 0.0035], [0.0495, 0.112], [0.051, 0.1135], [0.051, 0.1175], [0.0485, 0.121], [0.032, 0.1265], [0.0165, 0.129], [0.0165, 0.132], [0, 0.132]], { segs: 36, crease: 38 }), null, up));
  B.add('od', K.xf(K.cyl(0.0512, 0.004, 36, 0.0008), [0, 0.02, 0], [PI / 2, 0, 0]), 0.92); // a pressed rib low on the can
  B.add('yellow', K.xf(K.tube(0.0503, 0.0494, 0.007, 36), [0, 0.098, 0], [PI / 2, 0, 0]));
  // the M605 fuze: a collar, the body, the pressure ring and three prongs
  B.add('zinc', K.xf(K.cyl(0.0145, 0.008, 24, 0.001), [0, 0.136, 0], [PI / 2, 0, 0]));
  B.add('zinc', K.xf(K.cyl(0.0108, 0.03, 20, 0.0012), [0, 0.155, 0], [PI / 2, 0, 0]));
  B.add('steel', K.xf(K.cyl(0.0122, 0.004, 20, 0.0008), [0, 0.168, 0], [PI / 2, 0, 0]));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * 2 * PI + 0.4;
    const tilt = 24 * DEG;
    const len = 0.024;
    const dx = Math.cos(a) * Math.sin(tilt), dz = Math.sin(a) * Math.sin(tilt), dy = Math.cos(tilt);
    const base = [Math.cos(a) * 0.004, 0.17, Math.sin(a) * 0.004];
    const rod = K.cyl(0.0013, len, 8, 0.0003);
    // along +Z -> along (dx, dy, dz)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx, dy, dz));
    rod.applyQuaternion(q);
    rod.translate(base[0] + (dx * len) / 2, base[1] + (dy * len) / 2, base[2] + (dz * len) / 2);
    B.add('steel', rod);
    B.add('steel', K.xf(K.sphere(0.0019, 8, 6), [base[0] + dx * len, base[1] + dy * len, base[2] + dz * len]));
  }
  B.build(g, 'mine');
  // the stencil band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0507, 0.0507, 0.022, 36, 1, true), stencilMaterial());
  band.position.y = 0.07;
  band.name = 'mine_stencil';
  g.add(band);
  // the safety pin through the fuze and its pull ring (pulled off to -X)
  const pin = K.grp('pin', g, [0, 0.15, 0]);
  const P = new K.PB();
  P.add('steel', K.xf(K.cyl(0.0011, 0.03, 8), [-0.004, 0, 0], [0, PI / 2, 0]));
  P.add('steel', K.xf(K.torus(0.0125, 0.0013, 6, 26), [-0.031, -0.004, 0], [0, 0.3, 0.2]));
  P.build(pin, 'minepin');
  led(g, [0.0118, 0.137, 0.0095], 0xff2208);
  return g;
}

/** First-person: the mine in the right hand, fuze up (parts.pin: the viewmodel pulls it before the throw). */
export function buildMineViewmodel() {
  const K = gunKit;
  const root = K.grp('mine');
  const body = K.grp('body', root, [0.0, -0.105, -0.045]);
  const model = buildMineModel();
  const pin = model.getObjectByName('pin');
  body.add(model);
  model.remove(pin);
  pin.position.add(model.position);
  body.add(pin);
  const muzzle = K.empty('muzzle', body, [0, 0.1, 0]);
  const ga = 8 * DEG;
  const rightHand = K.handTarget('rightHand', body, [0.0, 0.07, 0.0], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.052, rz: 0.052, curl: 0.58, thumb: 0.4, gy: 0.03 });
  return K.finishWeapon({
    root,
    muzzle,
    ejectPort: null,
    rightHand,
    leftHand: null,
    sight: { eye: new THREE.Vector3(0, 0.06, 0.1) },
    parts: { pin },
    magazineModel: () => buildMineModel(),
    shellType: null,
  });
}

/* ------------------------------------------------------------------ the pipe bomb */

/**
 * A taped steel pipe bomb (hex end caps, hazard band, timer box with a red LED, red / yellow leads, a burning
 * fuse). Pipe axis = local Y. Named parts: led, glow, fuseTip. (The lure grenade.)
 */
export function buildCharge() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4d50, metalness: 0.85, roughness: 0.42 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x6d7072, metalness: 0.9, roughness: 0.32 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
  const hazard = canvasTexture(128, 32, (c, w, h) => {
    c.fillStyle = '#e8b400';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#111';
    for (let x = -h; x < w + h; x += 24) {
      c.beginPath();
      c.moveTo(x, h);
      c.lineTo(x + 12, h);
      c.lineTo(x + 12 + h, 0);
      c.lineTo(x + h, 0);
      c.fill();
    }
  });
  hazard.wrapS = THREE.RepeatWrapping;
  hazard.repeat.set(2, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.65 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x2c3324, roughness: 0.6 });
  const add = (geo, mat, x, y, z, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (name) m.name = name;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 16), metal, 0, 0, 0);
  add(new THREE.CylinderGeometry(0.038, 0.038, 0.024, 6), capMat, 0, 0.087, 0);
  add(new THREE.CylinderGeometry(0.038, 0.038, 0.024, 6), capMat, 0, -0.087, 0);
  add(new THREE.CylinderGeometry(0.0318, 0.0318, 0.046, 16), tapeMat, 0, 0.022, 0);
  add(new THREE.CylinderGeometry(0.0315, 0.0315, 0.028, 16, 1, true), hazardMat, 0, -0.045, 0);
  add(new THREE.BoxGeometry(0.036, 0.036, 0.016), boxMat, 0, 0.022, 0.037);
  add(new THREE.PlaneGeometry(0.022, 0.01), new THREE.MeshBasicMaterial({ color: 0x3a0a06 }), -0.004, 0.012, 0.0455); // dead LCD
  add(new THREE.SphereGeometry(0.0055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a08, emissiveIntensity: 0.4 }), 0.009, 0.03, 0.045, 'led');
  // leads from the timer to both caps
  const lead = (pts, color) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.0022, 5), new THREE.MeshStandardMaterial({ color, roughness: 0.5 })));
  };
  lead([[0.012, 0.04, 0.042], [0.02, 0.06, 0.04], [0.018, 0.08, 0.036]], 0xb81a12);
  lead([[-0.012, 0.004, 0.042], [-0.02, -0.03, 0.04], [-0.016, -0.074, 0.037]], 0xd8b010);
  // fuse out of the top cap
  add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.03, 6), tapeMat, 0, 0.113, 0);
  const tip = new THREE.Object3D();
  tip.name = 'fuseTip';
  tip.position.set(0, 0.128, 0);
  g.add(tip);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2a10, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.name = 'glow';
  glow.position.set(0.009, 0.03, 0.05);
  glow.scale.setScalar(0.001);
  g.add(glow);
  return g;
}

/** First-person: the pipe bomb upright in the fist, the timer toward you (parts.pin: the fuse the other hand lights). */
export function buildPipeBombViewmodel() {
  const K = gunKit;
  const root = K.grp('pipebomb');
  const body = K.grp('body', root, [0.0, -0.05, -0.04]);
  const charge = buildCharge();
  charge.scale.setScalar(1.1);
  // leaning away and across, so the timer, its LED and the tape show
  const tilt = new THREE.Euler(-0.5, 0.35, 0.1);
  charge.rotation.copy(tilt);
  body.add(charge);
  const up = new THREE.Vector3(0, 1, 0).applyEuler(tilt);
  const pin = K.grp('pin', body, up.clone().multiplyScalar(0.145).toArray()); // (an empty part: the support hand goes to the fuse)
  const muzzle = K.empty('muzzle', body, up.clone().multiplyScalar(0.12).toArray());
  const rightHand = K.handTarget('rightHand', body, [0.0, 0.0, 0.0], [-1, 0, 0], up.toArray(), false, { rx: 0.034, rz: 0.034, curl: 0.82, thumb: 0.5, gy: 0.02 });
  return K.finishWeapon({
    root,
    muzzle,
    ejectPort: null,
    rightHand,
    leftHand: null,
    sight: { eye: new THREE.Vector3(0, 0.06, 0.1) },
    parts: { pin },
    magazineModel: () => buildCharge(),
    shellType: null,
  });
}

/* ------------------------------------------------------------------ the heal grenade */

/**
 * The heal grenade (store consumable, game.js healCloud): a smoke-grenade can in white with a green band and
 * white crosses, the fuse head, spoon and pull ring on top, vent holes underneath. Can axis = local Y. Named
 * part: ring (the pin's pull ring).
 */
export function buildHealCanister() {
  const K = gunKit;
  K.seed(0x4ea1);
  const g = new THREE.Group();
  g.name = 'healnade';
  const B = new K.PB();
  const up = [PI / 2, 0, 0]; // (the kit's cylinders run along Z: stood up)
  B.add('white', K.xf(K.cyl(0.03, 0.112, 28, 0.003), [0, 0, 0], up));
  B.add('greenTip', K.xf(K.tube(0.0312, 0.0296, 0.036, 28, 0.0008), [0, 0.004, 0], up));
  // white crosses on the band, front and back
  for (const s of [1, -1]) {
    B.add('white', K.cbox(0.018, 0.0055, 0.002, 0.0006, [0, 0.004, s * 0.0316]));
    B.add('white', K.cbox(0.0055, 0.018, 0.002, 0.0006, [0, 0.004, s * 0.0316]));
  }
  // the fuse on top: its cap, the head, the spoon down the side
  B.add('park', K.xf(K.cyl(0.023, 0.01, 22, 0.0015), [0, 0.061, 0], up));
  B.add('park', K.cbox(0.024, 0.02, 0.028, 0.003, [0, 0.075, 0]));
  B.add('steel', K.cbox(0.012, 0.07, 0.0028, 0.0008, [0, 0.05, 0.0325], [0.12, 0, 0]), new THREE.Color(0x8a8d90));
  B.add('steel', K.cbox(0.012, 0.004, 0.02, 0.0008, [0, 0.084, 0.024]), new THREE.Color(0x8a8d90));
  // vents underneath
  B.add('park', K.xf(K.cyl(0.022, 0.004, 22, 0.001), [0, -0.058, 0], up));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + 0.4;
    B.add('hole', K.xf(K.cyl(0.0035, 0.002, 10), [Math.cos(a) * 0.012, -0.06, Math.sin(a) * 0.012], up));
  }
  B.build(g, 'healnade');
  // the pin's pull ring on the fuse head's side (the viewmodel pulls it before the throw)
  const ring = K.grp('ring', g, [0.017, 0.078, 0]);
  const R = new K.PB();
  R.add('steel', K.xf(K.torus(0.0105, 0.0014, 8, 24), [0.009, 0, 0], [0, PI / 2, 0]), new THREE.Color(0xa6a9ad));
  R.add('steel', K.xf(K.cyl(0.0013, 0.02, 8), [-0.004, 0, 0], [0, PI / 2, 0]), new THREE.Color(0xa6a9ad));
  R.build(ring, 'healnadeRing');
  return g;
}

/** First-person: the heal grenade upright in the fist, a white cross toward you (parts.pin: the ring pulled). */
export function buildHealGrenadeViewmodel() {
  const K = gunKit;
  const root = K.grp('healnade');
  const body = K.grp('body', root, [0.0, -0.045, -0.04]);
  const can = buildHealCanister();
  const tilt = new THREE.Euler(-0.45, 0.3, 0.1);
  can.rotation.copy(tilt);
  body.add(can);
  const up = new THREE.Vector3(0, 1, 0).applyEuler(tilt);
  const pin = can.getObjectByName('ring');
  const muzzle = K.empty('muzzle', body, up.clone().multiplyScalar(0.09).toArray());
  const rightHand = K.handTarget('rightHand', body, [0.0, 0.0, 0.0], [-1, 0, 0], up.toArray(), false, { rx: 0.032, rz: 0.032, curl: 0.84, thumb: 0.5, gy: 0.02 });
  return K.finishWeapon({
    root,
    muzzle,
    ejectPort: null,
    rightHand,
    leftHand: null,
    sight: { eye: new THREE.Vector3(0, 0.06, 0.1) },
    parts: { pin },
    magazineModel: () => buildHealCanister(),
    shellType: null,
  });
}

/* ------------------------------------------------------------------ the shockwave emitter (pocket gear) */

/** The gadget: a rugged box with a ringed emitter dish, a blue core behind a grille, a battery and a belt clip. */
export function buildShockwaveDevice() {
  const K = gunKit;
  K.seed(0x5f0c4);
  const g = new THREE.Group();
  g.name = 'shockwave';
  const B = new K.PB();
  B.add('park', K.cbox(0.11, 0.07, 0.05, 0.006, [0, 0, 0]));
  B.add('rubber', K.cbox(0.118, 0.012, 0.056, 0.004, [0, 0.03, 0]));
  B.add('rubber', K.cbox(0.118, 0.012, 0.056, 0.004, [0, -0.03, 0]));
  // the emitter: a dish with three rings on the front face
  B.add('steel', K.xf(K.lathe([[0, 0], [0.028, 0], [0.03, 0.004], [0.026, 0.012], [0.012, 0.016], [0, 0.016]], { segs: 32 }), [0, 0, 0.025]));
  for (const r of [0.021, 0.015, 0.009]) B.add('anod', K.xf(K.torus(r, 0.0016, 6, 28), [0, 0, 0.037 + (0.021 - r) * 0.25]));
  // the battery on top and its lead
  B.add('anod', K.cbox(0.05, 0.022, 0.03, 0.003, [-0.02, 0.046, -0.004]));
  B.add('yellow', K.cbox(0.012, 0.022, 0.031, 0.002, [0.011, 0.046, -0.004]));
  B.add('park', K.cbox(0.03, 0.05, 0.008, 0.002, [0, 0, -0.03])); // the belt clip
  B.build(g, 'shockwave');
  // the core glowing through the rings
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 16, 12), new THREE.MeshStandardMaterial({ color: 0x0a1a24, emissive: 0x39c8ff, emissiveIntensity: 3.5 }));
  core.name = 'core';
  core.position.set(0, 0, 0.041);
  g.add(core);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0x39c8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
  glow.position.set(0, 0, 0.045);
  glow.scale.setScalar(0.05);
  g.add(glow);
  return g;
}
