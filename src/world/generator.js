// THE generator's moving parts (the body is the 'generator' prop, built { live: true } by level.js):
// front fuel gauge, panel voltmeter + status lamp, the pull-start T-handle on its cord, the warning
// labels, the cables across the floor to the fuse panel on the west wall (main breaker lever that
// trips when the power dies) and the conduit feeding the house. Engine shake and exhaust smoke too.
// world/power.js owns the state and drives update().
import * as THREE from 'three';
import { getMaterial } from './materials.js';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function dialTex(label, red) {
  return canvasTex(128, 128, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#e9e2cf';
    g.beginPath();
    g.arc(c, c, 62, 0, Math.PI * 2);
    g.fill();
    // scale: -135° (left) .. +135° (right), 0 = up
    const arc = (a0, a1, col, lw, r = 48) => {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      g.arc(c, c, r, a0 - Math.PI / 2, a1 - Math.PI / 2);
      g.stroke();
    };
    const A = (k) => (-135 + 270 * k) * (Math.PI / 180);
    arc(A(0), A(1), '#1b1b1b', 3);
    if (red) arc(A(0), A(0.18), '#c0261a', 9);
    else arc(A(0.72), A(1), '#2f8a3a', 9);
    g.strokeStyle = '#1b1b1b';
    for (let i = 0; i <= 8; i++) {
      const a = A(i / 8) - Math.PI / 2;
      const r0 = i % 2 ? 42 : 38;
      g.lineWidth = i % 2 ? 2 : 3;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
      g.lineTo(c + Math.cos(a) * 52, c + Math.sin(a) * 52);
      g.stroke();
    }
    g.fillStyle = '#1b1b1b';
    g.font = 'bold 20px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (red) {
      g.fillText('E', c + Math.cos(A(0) - Math.PI / 2) * 28, c + Math.sin(A(0) - Math.PI / 2) * 28);
      g.fillText('F', c + Math.cos(A(1) - Math.PI / 2) * 28, c + Math.sin(A(1) - Math.PI / 2) * 28);
      g.fillText('½', c, c - 28);
    }
    g.font = 'bold 15px Arial, sans-serif';
    g.fillText(label, c, c + 34);
    g.strokeStyle = '#555';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(c, c, 61, 0, Math.PI * 2);
    g.stroke();
  });
}

function labelTex(lines, { bg = '#f2c21b', fg = '#111', w = 512, h = 200, hazard = true, stripes = false } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    if (stripes) {
      g.save();
      g.beginPath();
      g.rect(0, 0, w, 26);
      g.rect(0, h - 26, w, 26);
      g.clip();
      for (let x = -h; x < w + h; x += 40) {
        g.fillStyle = '#111';
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + 20, 0);
        g.lineTo(x + 20 - h, h);
        g.lineTo(x - h, h);
        g.fill();
      }
      g.restore();
    }
    g.strokeStyle = fg;
    g.lineWidth = 8;
    g.strokeRect(6, 6, w - 12, h - 12);
    let x0 = 24;
    if (hazard) {
      // warning triangle
      const s = h * 0.52, tx = 26, ty = (h - s) / 2 + s;
      g.fillStyle = fg;
      g.beginPath();
      g.moveTo(tx, ty);
      g.lineTo(tx + s * 1.1, ty);
      g.lineTo(tx + s * 0.55, ty - s);
      g.closePath();
      g.fill();
      g.fillStyle = bg;
      g.font = `bold ${Math.round(s * 0.7)}px Arial, sans-serif`;
      g.textAlign = 'center';
      g.fillText('!', tx + s * 0.55, ty - s * 0.12);
      x0 = tx + s * 1.1 + 18;
    }
    g.fillStyle = fg;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach(([text, size], i) => {
      g.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
      g.fillText(text, x0, h / 2 + (i - (n - 1) / 2) * (size * 1.12), w - x0 - 20);
    });
  });
}

const plane = (w, h, map, parent, pos, rotY = 0, rotX = 0) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0 }));
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rotX, rotY, 0);
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

const box = (w, h, d, mat, parent, pos, rot) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

const cyl = (rt, rb, h, seg, mat, parent, pos, rot) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
};

/**
 * info: level.generator { object, anchors, x, y, z, rot, panel }. Returns the rig:
 * { center, exhaust (world), footprint (local half extents), update(dt, s) } where
 * s = { run 0..1 (engine turning), level 0..1 (mains), fuel 0..1, status 'on'|'warn'|'off', pull 0..1, cough 0..1 }.
 */
export function buildGeneratorRig(scene, info, fx) {
  const gen = info.object;
  const dk = getMaterial('metalDark');
  const rub = getMaterial('rubber');
  const steel = getMaterial('metalDark', { color: 0x9aa0a6 });
  const grey = getMaterial('paintGreen', { color: 0x6c7176 });

  // ---- front of the fuel tank (local +z face at 0.23): fuel gauge + warning labels
  const fuelDial = new THREE.Group();
  fuelDial.position.set(0.24, 0.875, 0.233);
  gen.add(fuelDial);
  cyl(0.052, 0.052, 0.012, 20, dk, fuelDial, [0, 0, 0.002], [Math.PI / 2, 0, 0]);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.044, 24), new THREE.MeshStandardMaterial({ map: dialTex('FUEL', true), roughness: 0.4 }));
  face.position.z = 0.0085;
  fuelDial.add(face);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.045, 24), getMaterial('glass'));
  glass.position.z = 0.011;
  fuelDial.add(glass);
  const fuelNeedle = new THREE.Group();
  fuelNeedle.position.z = 0.01;
  fuelDial.add(fuelNeedle);
  box(0.0035, 0.036, 0.0015, new THREE.MeshStandardMaterial({ color: 0xc41e14, roughness: 0.5 }), fuelNeedle, [0, 0.014, 0]);
  cyl(0.005, 0.005, 0.004, 8, dk, fuelNeedle, [0, 0, 0.001], [Math.PI / 2, 0, 0]);

  plane(0.3, 0.117, labelTex([['DANGER', 44], ['CARBON MONOXIDE · NEVER RUN INDOORS', 24], ['HOT EXHAUST · NO SMOKING NEAR FUEL', 24]], { stripes: false }), gen, [-0.24, 0.875, 0.2315]);
  plane(0.13, 0.05, labelTex([['UNLEADED', 60], ['GASOLINE ONLY', 40]], { bg: '#d7d2c4', hazard: false, w: 300, h: 120 }), gen, [-0.35, 0.974, 0.18], 0, -Math.PI / 2);

  // ---- control panel end (local +x face at 0.62): voltmeter needle, status lamp
  const volt = new THREE.Group();
  volt.position.set(0.629, 0.52, -0.1);
  volt.rotation.y = Math.PI / 2;
  gen.add(volt);
  const vface = new THREE.Mesh(new THREE.CircleGeometry(0.03, 20), new THREE.MeshStandardMaterial({ map: dialTex('VOLTS', false), roughness: 0.4 }));
  volt.add(vface);
  const voltNeedle = new THREE.Group();
  voltNeedle.position.z = 0.002;
  volt.add(voltNeedle);
  box(0.0025, 0.024, 0.001, new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.5 }), voltNeedle, [0, 0.009, 0]);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0x33ff55, emissiveIntensity: 3, roughness: 0.3 });
  // status lamps: one on the panel, one on the tank front beside the fuel gauge (seen from the room)
  for (const [p, r] of [[[0.628, 0.62, 0.08], [0, 0, -Math.PI / 2]], [[0.37, 0.9, 0.233], [Math.PI / 2, 0, 0]]]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), lampMat);
    lamp.rotation.set(r[0], r[1], r[2]);
    lamp.position.set(p[0], p[1], p[2]);
    gen.add(lamp);
    const bez = cyl(0.021, 0.021, 0.008, 12, dk, gen, p, [r[0], r[1], r[2] === 0 ? 0 : Math.PI / 2]);
    bez.position.addScaledVector(new THREE.Vector3(...(r[2] === 0 ? [0, 0, -1] : [-1, 0, 0])), 0.004);
  }

  // ---- recoil pull-start on the engine end (housing at local x -0.634, 0.36 high)
  const holeL = new THREE.Vector3(-0.642, 0.455, 0.05);
  const grip = getMaterial('blackPlastic');
  const pull = new THREE.Group();
  gen.add(pull);
  cyl(0.015, 0.015, 0.1, 12, grip, pull, [0, 0, 0], [Math.PI / 2, 0, 0]);
  for (const s of [-1, 1]) cyl(0.018, 0.018, 0.009, 12, grip, pull, [0, 0, s * 0.05], [Math.PI / 2, 0, 0]);
  cyl(0.009, 0.013, 0.025, 8, grip, pull, [0.014, 0, 0], [0, 0, Math.PI / 2]);
  cyl(0.02, 0.02, 0.012, 12, dk, gen, [-0.638, 0.455, 0.05], [0, 0, Math.PI / 2]); // cord guide on the housing
  const cordMat = new THREE.MeshStandardMaterial({ color: 0xc9c2ae, roughness: 0.95 });
  const cg = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 5, 1, true);
  cg.translate(0, 0.5, 0);
  const cord = new THREE.Mesh(cg, cordMat);
  gen.add(cord);
  const pullRest = new THREE.Vector3(-0.683, 0.455, 0.05);
  const pullOut = new THREE.Vector3(-1.2, 0.95, 0.12);

  // ---- fuse panel on the west wall (panel point = centre of its back on the wall), facing +x
  const P = info.panel;
  const fuse = new THREE.Group();
  fuse.position.copy(P);
  fuse.rotation.y = Math.PI / 2; // local +z = +x (out of the wall)
  scene.add(fuse);
  const PW = 0.44, PH = 0.6, PD = 0.13;
  box(PW, PH, PD, grey, fuse, [0, 0, PD / 2]);
  box(PW - 0.04, PH - 0.04, 0.01, getMaterial('paintGreen', { color: 0x8a9096 }), fuse, [0, 0, PD + 0.004]);
  for (const s of [-1, 1]) cyl(0.012, 0.012, 0.05, 8, dk, fuse, [-PW / 2 + 0.008, s * 0.2, PD], null);
  plane(0.2, 0.08, labelTex([['DANGER', 44], ['HIGH VOLTAGE', 36]], { stripes: false }), fuse, [0.06, 0.2, PD + 0.0105]);
  plane(0.16, 0.05, labelTex([['GENERATOR', 44], ['MAIN FEED', 30]], { bg: '#e8e4d8', hazard: false, w: 320, h: 120 }), fuse, [0.06, -0.21, PD + 0.0105]);
  // main breaker: a lever on the right side that throws down when the power dies
  const lever = new THREE.Group();
  lever.position.set(PW / 2 + 0.02, 0.02, PD * 0.55);
  fuse.add(lever);
  box(0.03, 0.1, 0.06, dk, fuse, [PW / 2 + 0.015, 0.02, PD * 0.55]);
  box(0.012, 0.16, 0.014, steel, lever, [0.02, 0.08, 0]);
  cyl(0.013, 0.013, 0.07, 8, getMaterial('paintRed'), lever, [0.02, 0.165, 0], [Math.PI / 2, 0, 0]);
  const fuseLampMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: 0x33ff55, emissiveIntensity: 3, roughness: 0.3 });
  const fuseLamp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 6), fuseLampMat);
  fuseLamp.position.set(-0.13, 0.2, PD + 0.012);
  fuse.add(fuseLamp);
  // conduit from the panel top up to the ceiling and along a joist toward the house
  const conduitMat = getMaterial('metalDark', { color: 0x80868c });
  const ceil = -0.64; // under the ceiling beams, along the wall
  const topY = P.y + PH / 2;
  const up = cyl(0.016, 0.016, ceil - topY, 8, conduitMat, scene, [P.x + 0.06, (ceil + topY) / 2, P.z + 0.1]);
  up.castShadow = false;
  const run = cyl(0.016, 0.016, 5.5, 8, conduitMat, scene, [P.x + 0.06, ceil, P.z + 0.1 - 2.75], [Math.PI / 2, 0, 0]);
  run.castShadow = false;
  for (let i = 0; i < 5; i++) box(0.05, 0.02, 0.03, dk, scene, [P.x + 0.06, ceil + 0.02, P.z - 0.4 - i * 1.2]);

  // cables: from the two outlets on the control panel down to the floor, across to the wall and up
  // into the bottom of the fuse panel
  gen.updateMatrixWorld(true);
  const floorY = info.y + 0.016;
  for (let k = 0; k < 2; k++) {
    const out = gen.localToWorld(new THREE.Vector3(0.64, 0.36, 0.1 + k * 0.06));
    const drop = gen.localToWorld(new THREE.Vector3(0.78, 0.1, 0.08 + k * 0.08));
    const f0 = gen.localToWorld(new THREE.Vector3(0.92, 0, 0.02 + k * 0.12)).setY(floorY);
    const wallX = P.x + 0.02 + k * 0.025;
    const pz = P.z - 0.08 + k * 0.12;
    const pts = [out, drop, f0, new THREE.Vector3((f0.x + wallX) / 2, floorY, (f0.z + pz) / 2 + 0.1 - k * 0.15), new THREE.Vector3(wallX + 0.06, floorY, pz), new THREE.Vector3(wallX, floorY + 0.05, pz), new THREE.Vector3(wallX, P.y - PH / 2 - 0.25, pz), new THREE.Vector3(wallX + 0.03, P.y - PH / 2 + 0.01, pz)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.3);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.012, 6, false), rub);
    tube.castShadow = true;
    tube.receiveShadow = true;
    scene.add(tube);
  }

  // ---- runtime
  const base = { x: gen.position.x, y: gen.position.y, z: gen.position.z, rx: gen.rotation.x, rz: gen.rotation.z };
  const exhaust = gen.localToWorld((info.anchors?.exhaust ?? new THREE.Vector3(-0.1, 1.1, -0.3)).clone());
  const center = gen.localToWorld(new THREE.Vector3(0, 0.55, 0));
  const COLORS = { on: new THREE.Color(0x33ff55), warn: new THREE.Color(0xffa020), off: new THREE.Color(0xff2a18) };
  let t = 0, smokeT = 0, fuelShown = 1, voltShown = 1, leverK = 1;

  function update(dt, s) {
    t += dt;
    // engine shake on its rubber mounts; coughs kick it
    const run = s.run ?? 0;
    const a = 0.0012 * run + 0.006 * (s.cough ?? 0);
    gen.position.set(base.x + (Math.random() - 0.5) * a, base.y + Math.abs(Math.sin(t * 95)) * a * 0.6, base.z + (Math.random() - 0.5) * a);
    gen.rotation.x = base.rx + (Math.random() - 0.5) * a * 0.6;
    gen.rotation.z = base.rz + (Math.random() - 0.5) * a * 0.6;
    // gauges
    fuelShown += (s.fuel - fuelShown) * Math.min(1, dt * 3);
    fuelNeedle.rotation.z = -(-135 + 270 * fuelShown) * (Math.PI / 180) + (run > 0.5 ? Math.sin(t * 40) * 0.01 : 0);
    voltShown += ((s.level ?? 0) * 0.82 - voltShown) * Math.min(1, dt * 8);
    voltNeedle.rotation.z = -(-135 + 270 * voltShown) * (Math.PI / 180);
    // status lamps: steady green, blinking amber (failing / low fuel), blinking red (dead)
    const st = s.status ?? 'on';
    const blink = st === 'on' ? 1 : Math.sin(t * (st === 'off' ? 5 : 9)) > 0 ? 1 : 0.06;
    lampMat.emissive.copy(COLORS[st]);
    lampMat.emissiveIntensity = 3.2 * blink;
    fuseLampMat.emissive.copy(COLORS[st === 'off' ? 'off' : 'on']);
    fuseLampMat.emissiveIntensity = st === 'off' ? 2.5 * blink : 2.2 * (s.level ?? 1);
    // main breaker: up while the mains carry power, thrown down when they die
    leverK += ((s.level ?? 0) > 0.05 || st !== 'off' ? 1 - leverK : -leverK) * Math.min(1, dt * 14);
    lever.rotation.x = (1 - leverK) * 2.3;
    // pull-start handle: flies out along the cord and snaps back
    const k = s.pull ?? 0;
    _v.lerpVectors(pullRest, pullOut, k);
    pull.position.copy(_v);
    pull.rotation.set(0, 0, k * 0.8);
    _w.subVectors(_v, holeL);
    const len = Math.max(0.001, _w.length());
    cord.position.copy(holeL);
    cord.scale.set(1, len, 1);
    cord.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _w.normalize());
    // exhaust: a light haze while it runs, black puffs when it coughs
    smokeT -= dt;
    if (fx?.smoke && smokeT <= 0 && (run > 0.2 || (s.cough ?? 0) > 0.3)) {
      const cough = (s.cough ?? 0) > 0.3;
      smokeT = cough ? 0.05 : 0.16;
      fx.smoke.emit(exhaust.x, exhaust.y + 0.02, exhaust.z, (Math.random() - 0.5) * 0.15, cough ? 1.2 : 0.55, (Math.random() - 0.5) * 0.15 - 0.1, {
        life: cough ? 1.4 : 1.1,
        size: cough ? 0.14 : 0.07,
        grow: cough ? 0.7 : 0.5,
        drag: 1.5,
        gravity: -0.35,
        color: cough ? [0.12, 0.12, 0.12] : [0.42, 0.42, 0.42],
        alpha: cough ? 0.55 : 0.16,
      });
    }
  }

  /** Distance (m, horizontal) from p to the generator's footprint. */
  function distTo(p) {
    gen.worldToLocal(_v.copy(p));
    const dx = Math.max(0, Math.abs(_v.x) - 0.7), dz = Math.max(0, Math.abs(_v.z) - 0.4);
    return Math.hypot(dx, dz);
  }

  update(0, { run: 1, level: 1, fuel: 1, status: 'on', pull: 0 });
  return { center, exhaust, fuse: P.clone(), update, distTo };
}
