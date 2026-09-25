// Distant set dressing from GLBs: the ruined chapel on the horizon south-west of the farmhouse.
// It stands outside the playable area (world boundary is at ±40 m) and has no collision; its
// materials take a fraction of the toxic fog so the silhouette still reads from the house.
import * as THREE from 'three';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { CHURCH_POS, FLOOR } from './level.js';

// fog density multiplier for far landmarks (1 = like everything else)
const LANDMARK_FOG = 0.22;

function thinFog(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <fog_fragment>',
      THREE.ShaderChunk.fog_fragment.replace('exp(-cfDens)', `exp(-cfDens * ${LANDMARK_FOG.toFixed(2)})`)
    );
  };
  material.customProgramCacheKey = () => 'landmarkFog';
}

export function addLandmarks(scene) {
  const gltf = getGLB(MODELS.church);
  if (!gltf) return null;
  const church = gltf.scene.clone(true);
  church.name = 'church';
  // the model is normalized to ~1.9 units long with its door facing +Z: scale to a ~21 m chapel
  // (tower ~17 m), stand it on the yard, and turn the door toward the house
  const S = 11;
  church.scale.setScalar(S);
  const pos = new THREE.Vector3(CHURCH_POS[0], 0, CHURCH_POS[1]);
  church.rotation.y = Math.atan2(-pos.x, -pos.z);
  church.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(church);
  pos.y = FLOOR.outside - box.min.y - 0.35; // rubble sinks into the mud a little
  church.position.copy(pos);
  const seen = new Set();
  church.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const m = o.material;
    if (seen.has(m)) return;
    seen.add(m);
    // faint moonlit fill so the stone doesn't drop to pure black at night
    if (m.map && 'emissive' in m) {
      m.emissive = new THREE.Color(0x3a4450);
      m.emissiveMap = m.map;
      m.emissiveIntensity = 0.16;
    }
    m.envMapIntensity = 0.6;
    thinFog(m);
  });
  church.updateMatrixWorld(true);
  church.matrixAutoUpdate = false;
  church.traverse((o) => (o.matrixAutoUpdate = false));
  scene.add(church);
  return church;
}
