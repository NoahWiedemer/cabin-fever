// Instanced PBR decals (blood splats from a 2x2 atlas, bullet holes, scorch marks)
// kept in ring buffers so they never grow unbounded.
import * as THREE from 'three';
import { tex } from '../world/textures.js';

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);

class DecalPool {
  constructor(scene, set, { max = 200, atlas = false, roughness = 0.5, color = 0xffffff, envMapIntensity = 1, metalness = 0, order = 1, normalScale = 1 } = {}) {
    this.max = max;
    this.index = 0;
    this.count = 0;
    const geo = new THREE.PlaneGeometry(1, 1);
    this.frames = new Float32Array(max);
    this.aFrame = new THREE.InstancedBufferAttribute(this.frames, 1);
    geo.setAttribute('aFrame', this.aFrame);
    const mat = new THREE.MeshStandardMaterial({
      map: set.map,
      normalMap: set.normalMap ?? null,
      normalScale: new THREE.Vector2(normalScale, normalScale),
      roughnessMap: set.roughnessMap ?? null,
      roughness,
      metalness,
      color,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2 - order,
      polygonOffsetUnits: -2 - order,
      envMapIntensity,
      alphaTest: 0.02,
    });
    if (atlas) {
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aFrame;')
          .replace(
            '#include <uv_vertex>',
            `#include <uv_vertex>
            vec2 dfo = vec2(mod(aFrame, 2.0), floor(aFrame / 2.0)) * 0.5;
            #ifdef USE_MAP
              vMapUv = vMapUv * 0.5 + dfo;
            #endif
            #ifdef USE_NORMALMAP
              vNormalMapUv = vNormalMapUv * 0.5 + dfo;
            #endif
            #ifdef USE_ROUGHNESSMAP
              vRoughnessMapUv = vRoughnessMapUv * 0.5 + dfo;
            #endif`
          );
      };
      mat.customProgramCacheKey = () => 'decal-atlas';
    }
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.renderOrder = order;
    this.atlas = atlas;
    scene.add(this.mesh);
  }

  add(pos, normal, size, rot = Math.random() * Math.PI * 2, frame = null, stretch = 1) {
    const i = this.index;
    this.index = this.index + 1;
    if (this.index >= this.max) this.index = this.reserved || 0; // never overwrite reserved (pre-seeded) decals
    this.count = Math.min(this.max, this.count + 1);
    _q.setFromUnitVectors(_z, normal);
    _q2.setFromAxisAngle(_z, rot);
    _q.multiply(_q2);
    _p.copy(pos).addScaledVector(normal, 0.004 + Math.random() * 0.003);
    _s.set(size, size * stretch, 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.frames[i] = frame ?? Math.floor(Math.random() * 4);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aFrame.needsUpdate = true;
    this.mesh.count = this.count;
  }

  clear() {
    this.count = 0;
    this.index = 0;
    this.mesh.count = 0;
  }
}

export class Decals {
  constructor(scene) {
    const get = (n) => {
      try {
        return tex(n);
      } catch (e) {
        return null;
      }
    };
    const blood = get('bloodDecals');
    const hole = get('bulletHole');
    const scorch = get('scorch');
    const pool = get('bloodPool');
    this.blood = blood ? new DecalPool(scene, blood, { max: 700, atlas: true, roughness: 0.25, order: 1, envMapIntensity: 1.4 }) : null;
    this.pools = pool ? new DecalPool(scene, pool, { max: 40, atlas: false, roughness: 0.15, order: 0, envMapIntensity: 1.6 }) : null;
    this.holes = hole ? new DecalPool(scene, hole, { max: 260, atlas: false, roughness: 0.9, order: 2 }) : null;
    this.scorch = scorch ? new DecalPool(scene, scorch, { max: 24, atlas: false, roughness: 1, order: 0, color: 0xffffff }) : null;
    this.permanentBlood = 0;
  }

  bloodSplat(pos, normal, size = 0.8, stretch = 1) {
    this.blood?.add(pos, normal, size, undefined, null, stretch);
  }
  bloodPool(pos, size = 1.3) {
    this.pools?.add(pos, _up, size);
  }
  bulletHole(pos, normal, size = 0.09) {
    this.holes?.add(pos, normal, size);
  }
  scorchMark(pos, normal = _up, size = 3.5) {
    this.scorch?.add(pos, normal, size);
  }
}

const _up = new THREE.Vector3(0, 1, 0);
