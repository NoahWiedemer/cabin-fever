// Menu portraits of the fireteam: each bot (its real body and signature gun, posed at a low ready) is
// rendered ONCE by a small throwaway WebGL renderer, three-point lit at a 3/4 angle, into a transparent
// image for the menu's character cards. Returns { [characterId]: dataURL }; empty if WebGL fails.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const FOV = 21;

/**
 * span: meters of body in frame (top of the head down to about mid-thigh), azimuth: camera around the
 * character (rad, 0 = straight on; negative = its right, the gun side), ready: how far the gun is raised.
 */
export function renderPortraits(bots, { width = 300, height = 380, span = 1.12, azimuth = -0.62, ready = 0.55, exposure = 1.25, headroom = 0.27, lift = 0.05, L = {} } = {}) {
  const SPAN = span;
  const AZIMUTH = azimuth;
  const out = {};
  if (!bots?.length) return out;
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  } catch (e) {
    console.warn('[portraits] no WebGL for portraits', e);
    return out;
  }
  const canvas = renderer.domElement;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;
  scene.environment = env;
  scene.environmentIntensity = L.env ?? 0.4;
  // three-point lighting in character space (the character faces +Z, its right hand is at -X)
  const key = new THREE.DirectionalLight(0xffe2c0, L.key ?? 3.6); // warm key, high on the camera side
  key.position.set(-2.6, 3.4, 2.4);
  const fill = new THREE.DirectionalLight(0x9fb8d8, L.fill ?? 1.0); // cool, soft fill from the other side
  fill.position.set(2.8, 1.2, 2.2);
  const rim = new THREE.DirectionalLight(0xffb040, L.rim ?? 6); // amber rim / back light, separates from the card
  rim.position.set(1.8, 2.6, -2.8);
  const rim2 = new THREE.DirectionalLight(0xc8dcff, L.rim2 ?? 3); // cool kicker on the far edge
  rim2.position.set(-2.4, 1.8, -2.2);
  scene.add(key, fill, rim, rim2, new THREE.HemisphereLight(0x3a4250, 0x120d0a, L.hemi ?? 0.7));
  const cam = new THREE.PerspectiveCamera(FOV, width / height, 0.1, 30);
  const head = new THREE.Vector3();

  for (const bot of bots) {
    const root = bot.root;
    const parent = root.parent;
    const visible = root.visible;
    const pos = root.position.clone();
    const rot = root.rotation.clone();
    try {
      scene.add(root);
      root.visible = true;
      bot.posePortrait(ready);
      bot.bones.head.getWorldPosition(head);
      const top = head.y + headroom;
      const lookY = top - SPAN * 0.5;
      const d = SPAN / (2 * Math.tan((FOV * Math.PI) / 360));
      cam.position.set(Math.sin(AZIMUTH) * d, lookY + lift, Math.cos(AZIMUTH) * d);
      cam.lookAt(0.02, lookY, 0);
      cam.updateMatrixWorld(true);
      renderer.render(scene, cam);
      const url = canvas.toDataURL('image/webp', 0.9);
      out[bot.id] = url.startsWith('data:image/webp') ? url : canvas.toDataURL('image/png');
    } catch (e) {
      console.warn('[portraits] failed for', bot.id, e);
    } finally {
      if (parent) parent.add(root);
      else scene.remove(root);
      root.visible = visible;
      root.position.copy(pos);
      root.rotation.copy(rot);
    }
  }

  env.dispose();
  pmrem.dispose();
  room.dispose?.();
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
