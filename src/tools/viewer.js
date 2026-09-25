// Standalone weapon viewer (/viewer.html): the real Viewmodel (arms, sway, ADS, reload / fire
// animations) plus an orbit mode, rendered with the game's post stack. Independent of the game
// modules so it keeps working while gameplay code changes. Automation: window.__viewer.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GameRenderer } from '../core/renderer.js';
import { Viewmodel } from '../player/viewmodel.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { preloadGLBs } from '../core/assets.js';
import { GLB_URLS } from '../core/assetList.js';
import { generateAllTextures } from '../world/textures.js';

const view = document.getElementById('view');
const panel = document.getElementById('panel');
const info = document.getElementById('info');

const gr = new GameRenderer(view, 'high');
const scene = gr.scene;
scene.background = new THREE.Color(0x15171a);
const pmrem = new THREE.PMREMGenerator(gr.renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
gr.grade.set?.('uVignette', 0.3);

// backdrop room + lights (lights reach both the world and the viewmodel layer)
const room = new THREE.Mesh(new THREE.BoxGeometry(10, 5, 10), new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.9, side: THREE.BackSide }));
room.position.set(0, 2.5, 0);
room.receiveShadow = true;
scene.add(room);
const hemi = new THREE.HemisphereLight(0xc4ccd6, 0x2a241e, 0.7);
const key = new THREE.DirectionalLight(0xffe6c8, 2.2);
key.position.set(-2, 4, 1.5);
const rimL = new THREE.DirectionalLight(0x9fb8ff, 0.8);
rimL.position.set(3, 1.5, -3);
for (const l of [hemi, key, rimL]) {
  l.layers.enableAll();
  scene.add(l);
}

const cam = gr.camera;
cam.fov = 80;
cam.position.set(0, 1.6, 2);
cam.lookAt(0, 1.6, 0);
const controls = new OrbitControls(cam, gr.renderer.domElement);
controls.target.set(0, 1.2, 0);
controls.enabled = false;

info.textContent = 'loading…';
await generateAllTextures();
await preloadGLBs(GLB_URLS);
const vm = new Viewmodel(scene);
const player = { horizontalSpeed: 0, onGround: true, crouching: false, localVelX: 0 };
const weapons = { state: 'idle', stateT: 0, spin: 0 };
let def = null;
let orbitModel = null;
let mode = 'fp';
let ads = 0;
let adsTarget = 0;
let queue = [];

function select(id) {
  def = WEAPONS[id];
  vm.equip(def, 'draw');
  weapons.state = 'draw';
  weapons.stateT = 0;
  queue = [{ state: 'idle', at: def.drawTime ?? 0.4 }];
  if (orbitModel) scene.remove(orbitModel);
  orbitModel = buildWeaponModel(def.model).root;
  orbitModel.position.set(0, 1.2, 0);
  orbitModel.visible = mode === 'orbit';
  scene.add(orbitModel);
  const r = gr.renderer.info;
  let tris = 0, meshes = 0;
  vm.cur.root.traverse((o) => {
    if (o.isMesh) {
      meshes++;
      tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    }
  });
  info.textContent = `${def.name}  ·  ${meshes} meshes  ·  ${Math.round(tris).toLocaleString()} tris  ·  mode ${def.mode}`;
  void r;
}

function setMode(m) {
  // 'freeze': keep the first-person pose as it is and orbit the camera around the arms
  if (m === 'freeze') {
    mode = m;
    controls.enabled = true;
    const p = vm.cur.root.getWorldPosition(new THREE.Vector3());
    controls.target.copy(p);
    controls.update();
    return;
  }
  mode = m;
  controls.enabled = m === 'orbit';
  vm.setVisible(m === 'fp');
  if (orbitModel) orbitModel.visible = m === 'orbit';
  if (m === 'fp') {
    cam.position.set(0, 1.6, 2);
    cam.quaternion.identity();
  } else {
    cam.position.set(-0.55, 1.45, 0.35);
    controls.target.set(0, 1.2, -0.2);
    controls.update();
  }
}

// scripted weapon states, mirroring WeaponSystem's timings
function act(kind) {
  if (!def) return;
  weapons.stateT = 0;
  if (kind === 'fire') {
    vm.onFire(def);
    if (def.mode === 'bolt' || def.mode === 'pump') {
      weapons.state = 'bolt';
      queue = [{ state: 'idle', at: def.boltTime }];
    }
  } else if (kind === 'reload' || kind === 'reloadEmpty') {
    const empty = kind === 'reloadEmpty';
    if (def.reloadType === 'shell') {
      weapons.state = 'shellReload';
      vm.onReload(def, 'shellStart');
      let t = def.reloadStart;
      queue = [];
      for (let i = 0; i < 2; i++, t += def.shellTime) queue.push({ at: t, fn: () => vm.onReload(def, 'shellInsert', def.shellTime) });
      queue.push({ at: t, fn: () => vm.onReload(def, 'shellEnd', def.reloadEnd, empty) });
      queue.push({ at: t + def.reloadEnd, state: 'idle' });
    } else {
      const dur = empty ? def.reloadEmpty : def.reload;
      weapons.state = 'reload';
      vm.onReload(def, 'mag', dur, empty);
      queue = [{ state: 'idle', at: dur }];
    }
  } else if (kind === 'draw') {
    vm.equip(def, 'draw');
    weapons.state = 'draw';
    queue = [{ state: 'idle', at: def.drawTime ?? 0.4 }];
  }
}

// ---- UI
const sel = document.createElement('select');
for (const [id, d] of Object.entries(WEAPONS)) sel.add(new Option(d.name, id));
sel.onchange = () => select(sel.value);
panel.append(sel);
for (const [label, fn] of [
  ['First person', () => setMode('fp')],
  ['Orbit', () => setMode('orbit')],
  ['Freeze + orbit', () => setMode('freeze')],
  ['Fire', () => act('fire')],
  ['Reload', () => act('reload')],
  ['Reload empty', () => act('reloadEmpty')],
  ['Draw', () => act('draw')],
]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  panel.append(b);
}
const adsBox = document.createElement('label');
adsBox.innerHTML = '<input type="checkbox"> ADS';
adsBox.querySelector('input').onchange = (e) => (adsTarget = e.target.checked ? 1 : 0);
panel.append(adsBox);
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyF') act('fire');
  if (e.code === 'KeyR') act(e.shiftKey ? 'reloadEmpty' : 'reload');
  if (e.code === 'KeyA') adsTarget = 1 - adsTarget;
});

// ---- loop
let last = performance.now();
function frame(dt) {
  weapons.stateT += dt;
  for (let i = 0; i < queue.length; i++) {
    const q = queue[i];
    if (weapons.stateT >= q.at) {
      q.fn?.();
      if (q.state) weapons.state = q.state;
      queue.splice(i--, 1);
    }
  }
  ads += Math.sign(adsTarget - ads) * Math.min(Math.abs(adsTarget - ads), dt / (def?.adsTime ?? 0.2));
  vm.setAds(ads);
  if (mode === 'fp') vm.update(dt, { camera: cam, vmCamera: gr.vmCamera, player, weapons, mouseDX: 0, mouseDY: 0 });
  else controls.update();
  gr.render(dt);
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  frame(dt);
}

vm.prewarm(Object.values(WEAPONS).map((d) => d.model));
const start = new URLSearchParams(location.search).get('w') || 'm16a2';
sel.value = WEAPONS[start] ? start : 'm4a1';
select(sel.value);
setMode(new URLSearchParams(location.search).get('mode') || 'fp');
requestAnimationFrame(loop);

window.__viewer = {
  vm, gr, cam, controls, select, setMode, act,
  ads: (v) => (adsTarget = ads = v),
  step: (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) frame(dt);
  },
  orbit: (pos, target) => {
    setMode('orbit');
    cam.position.set(...pos);
    controls.target.set(...target);
    controls.update();
  },
};
