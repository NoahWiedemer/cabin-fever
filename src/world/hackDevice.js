// Props of the story's hacking mission (game/mission.js): the drop crate that brings the hacking module
// (a hard case under a cargo parachute, a red flare burning next to it once it's down) and the module
// itself, clamped to the wall by the lab's keypad with a cable into it and a live screen (progress,
// STALLED, ACCESS GRANTED).
import * as THREE from 'three';
import { tex } from './textures.js';

const TAU = Math.PI * 2;

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

function glow(color, size) {
  let map = null;
  try {
    map = tex('glow').map;
  } catch (e) {
    /* optional */
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, color: new THREE.Color(color), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  s.scale.setScalar(size);
  s.renderOrder = 6;
  return s;
}

/** the drop crate: case (origin on its bottom), parachute above (collapsible), flare beside it */
export function buildDropCrate() {
  const root = new THREE.Group();
  root.name = 'dropCrate';
  const side = canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#4b5534';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '20,24,14' : '140,150,110'},${0.05 + Math.random() * 0.08})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
    g.fillStyle = '#e8e2c8';
    g.font = 'bold 30px "Black Ops One", Impact, sans-serif';
    g.fillText('HACK MOD', 16, 52);
    g.font = 'bold 18px "Share Tech Mono", monospace';
    g.fillText('HANDLE WITH CARE  ▲', 18, 88);
    g.fillStyle = '#d9a916';
    for (let x = -20; x < w; x += 28) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + 14, h);
      g.lineTo(x + 28, h - 14);
      g.lineTo(x + 14, h - 14);
      g.fill();
    }
  });
  const M = {
    side: new THREE.MeshStandardMaterial({ map: side, roughness: 0.75, metalness: 0.1 }),
    plain: new THREE.MeshStandardMaterial({ color: 0x4b5534, roughness: 0.75, metalness: 0.1 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a9095, roughness: 0.4, metalness: 0.8 }),
    strap: new THREE.MeshStandardMaterial({ color: 0x1d1f1a, roughness: 0.9 }),
    line: new THREE.MeshStandardMaterial({ color: 0xcfc8b0, roughness: 0.9 }),
  };
  const W = 0.9, H = 0.55, D = 0.62;
  const box = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), [M.side, M.side, M.plain, M.plain, M.side, M.side]);
  box.position.y = H / 2;
  box.castShadow = true;
  box.receiveShadow = true;
  root.add(box);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(0.08, H + 0.02, 0.08), M.metal);
    c.position.set(sx * (W / 2 - 0.02), H / 2, sz * (D / 2 - 0.02));
    root.add(c);
  }
  for (const x of [-0.22, 0.22]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.06, H + 0.01, D + 0.01), M.strap);
    s.position.set(x, H / 2, 0);
    root.add(s);
  }
  // parachute: a flattened dome of panels, eight lines down to the crate's corners
  const chute = new THREE.Group();
  chute.position.y = H;
  root.add(chute);
  const panels = canvasTex(256, 64, (g, w, h) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? '#5c6640' : '#8d8a6a';
      g.fillRect((i * w) / 8, 0, w / 8 + 1, h);
    }
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.35)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  });
  panels.wrapS = THREE.RepeatWrapping;
  const canopyMat = new THREE.MeshStandardMaterial({ map: panels, roughness: 0.95, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.9, 24, 8, 0, TAU, 0, Math.PI * 0.42), canopyMat);
  canopy.scale.set(1, 0.55, 1);
  canopy.position.y = 3.1;
  canopy.castShadow = true;
  chute.add(canopy);
  const rim = 1.9 * Math.sin(Math.PI * 0.42);
  const rimY = 3.1 + 1.9 * Math.cos(Math.PI * 0.42) * 0.55;
  const lines = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    const top = new THREE.Vector3(Math.cos(a) * rim, rimY, Math.sin(a) * rim);
    const bot = new THREE.Vector3((i % 4 < 2 ? 1 : -1) * 0.35, 0.02, (i % 2 ? 1 : -1) * 0.25);
    const d = top.clone().sub(bot);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, d.length(), 4), M.line);
    l.position.copy(bot).addScaledVector(d, 0.5);
    l.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    chute.add(l);
    lines.push(l);
  }
  // flare (lit on landing): a red stick with a burning tip
  const flare = new THREE.Group();
  flare.position.set(0.75, 0, 0.3);
  flare.visible = false;
  root.add(flare);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xa3261c, roughness: 0.6 }));
  stick.rotation.z = 1.2;
  stick.position.y = 0.05;
  flare.add(stick);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 1.2, 0.6) }));
  tip.position.set(-0.13, 0.1, 0);
  flare.add(tip);
  const fg = glow(0xff3a20, 2.6);
  fg.position.copy(tip.position);
  flare.add(fg);

  let chuteT = 0; // 0 open .. 1 collapsed and gone
  const crate = {
    root,
    flare,
    flareTip: tip,
    /** collapse the parachute after landing (0 open → 1 gone) */
    setChute(k) {
      chuteT = k;
      chute.visible = k < 1;
      const e = Math.min(1, k);
      canopy.scale.set(1 + e * 0.4, 0.55 * (1 - e * 0.85), 1 + e * 0.4);
      canopy.position.set(e * 1.6, 3.1 * (1 - e) + 0.15 * e, 0);
      canopy.rotation.z = -e * 0.9;
      canopyMat.opacity = e > 0.7 ? 1 - (e - 0.7) / 0.3 : 1;
      for (const l of lines) l.visible = e < 0.25;
    },
    update(dt, t) {
      if (flare.visible) {
        const f = 0.75 + 0.25 * Math.sin(t * 31) * Math.sin(t * 13.7) + Math.random() * 0.1;
        fg.material.opacity = f;
        fg.scale.setScalar(2.2 + f * 0.8);
      }
      if (chuteT === 0) canopy.rotation.y += dt * 0.25; // a slow spin on the way down
    },
  };
  crate.setChute(0);
  return crate;
}

/** status screen of the hacking module */
function screenCanvas() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 144;
  return c;
}

function drawScreen(g, st) {
  const w = 256, h = 144;
  g.fillStyle = '#031008';
  g.fillRect(0, 0, w, h);
  const col = st.mode === 'jammed' ? '#ff4630' : st.mode === 'done' ? '#62ff8a' : '#3cff9c';
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineWidth = 2;
  g.strokeRect(4, 4, w - 8, h - 8);
  g.font = 'bold 18px "Share Tech Mono", monospace';
  g.fillText('BREACH//OS  v2.3', 14, 28);
  g.font = 'bold 15px "Share Tech Mono", monospace';
  const status = st.mode === 'jammed' ? '!! SIGNAL LOST - RESTART' : st.mode === 'done' ? 'ACCESS GRANTED' : st.mode === 'paused' ? 'STANDBY' : st.mode === 'idle' ? 'READY' : 'CRACKING LOCK...';
  if (st.mode !== 'jammed' || st.blink) g.fillText(status, 14, 56);
  // progress bar
  g.strokeRect(14, 76, w - 28, 22);
  g.fillRect(17, 79, Math.max(0, (w - 34) * st.progress), 16);
  g.font = 'bold 26px "Share Tech Mono", monospace';
  g.fillText(`${Math.floor(st.progress * 100)}%`, 14, 128);
  // scrolling hex
  g.font = '11px "Share Tech Mono", monospace';
  g.globalAlpha = 0.6;
  for (let i = 0; i < 3; i++) g.fillText(((st.seed * 2654435761 + i * 977) >>> 0).toString(16).toUpperCase().padStart(8, '0'), 120, 114 + i * 11);
  g.globalAlpha = 1;
}

/** the hacking module: a rugged box with a screen, antenna and a cable (origin: its back, on the wall) */
export function buildHackModule() {
  const root = new THREE.Group();
  root.name = 'hackModule';
  const body = new THREE.MeshStandardMaterial({ color: 0x2d3326, roughness: 0.7, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.5 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.35, metalness: 0.85 });
  const cv = screenCanvas();
  const ctx = cv.getContext('2d');
  const scrTex = new THREE.CanvasTexture(cv);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  const scrMat = new THREE.MeshBasicMaterial({ map: scrTex, color: new THREE.Color(1.6, 1.6, 1.6) });
  const W = 0.34, H = 0.24, D = 0.1;
  const add = (geo, mat, x, y, z, r) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (r) m.rotation.set(r[0], r[1], r[2]);
    m.castShadow = true;
    root.add(m);
    return m;
  };
  // the case faces -z (out of the wall)
  add(new THREE.BoxGeometry(W, H, D), body, 0, 0, -D / 2);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.04, D + 0.01), dark, sx * (W / 2 - 0.015), sy * (H / 2 - 0.015), -D / 2);
  // wall clamps
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.05, H + 0.08, 0.02), metal, sx * (W / 2 + 0.02), 0, -0.01);
  const screen = add(new THREE.PlaneGeometry(0.22, 0.124), scrMat, -0.03, 0.01, -D - 0.002, [0, Math.PI, 0]);
  screen.castShadow = false;
  // keys + LEDs + antenna
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(0.025, 0.018, 0.012), dark, 0.13, 0.06 - i * 0.04, -D - 0.004);
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 4, 1) });
  const led = add(new THREE.SphereGeometry(0.009, 8, 6), ledMat, 0.13, -0.09, -D - 0.004);
  led.castShadow = false;
  add(new THREE.CylinderGeometry(0.006, 0.01, 0.28, 6), dark, -W / 2 + 0.03, H / 2 + 0.14, -D / 2, [0, 0, 0.12]);
  const ledGlow = glow(0x40ff90, 0.25);
  ledGlow.position.set(0.13, -0.09, -D - 0.02);
  root.add(ledGlow);
  let t = 0, drawT = 0;
  const st = { mode: 'idle', progress: 0, blink: true, seed: 1 };
  drawScreen(ctx, st);
  scrTex.needsUpdate = true;
  return {
    root,
    /** mode: 'idle' | 'running' | 'paused' | 'jammed' | 'done', progress 0..1 */
    update(dt, mode, progress) {
      t += dt;
      drawT -= dt;
      const changed = mode !== st.mode;
      st.mode = mode;
      st.progress = progress;
      if (drawT <= 0 || changed) {
        drawT = 0.2;
        st.blink = t % 0.8 < 0.45;
        st.seed = (st.seed + 1) | 0;
        drawScreen(ctx, st);
        scrTex.needsUpdate = true;
      }
      const on = mode === 'jammed' ? t % 0.35 < 0.18 : mode === 'running' ? t % 0.5 < 0.25 : true;
      const c = mode === 'jammed' ? [5, 0.3, 0.2] : mode === 'done' ? [0.3, 5, 0.8] : mode === 'running' ? [0.2, 4, 1] : [3, 2.2, 0.2];
      ledMat.color.setRGB(on ? c[0] : 0.05, on ? c[1] : 0.05, on ? c[2] : 0.05);
      ledGlow.visible = on;
      ledGlow.material.color.setRGB(c[0] * 0.3, c[1] * 0.3, c[2] * 0.3);
    },
  };
}
