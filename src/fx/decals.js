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
    // chips in armored glass (the lab window): a white spall with radial cracks
    this.chips = new DecalPool(scene, { map: glassChipTexture() }, { max: 60, atlas: false, roughness: 0.3, order: 3, envMapIntensity: 1.2 });
    // the fractured glass catches the light: a little self-lighting keeps it white against the bright lab
    this.chips.mesh.material.emissive.set(0xffffff);
    this.chips.mesh.material.emissiveMap = this.chips.mesh.material.map;
    this.chips.mesh.material.emissiveIntensity = 0.35;
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
  glassChip(pos, normal, size = 0.09) {
    this.chips.add(pos, normal, size);
  }
}

function glassChipTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const R = 64;
  g.translate(R, R);
  // radial cracks, dark-edged so they read against the bright lab behind the glass
  const n = 7 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + Math.random() * 0.5;
    let x = 0, y = 0;
    const len = 30 + Math.random() * 30;
    g.beginPath();
    g.moveTo(0, 0);
    for (let s = 0; s < len; s += 6) {
      a += (Math.random() - 0.5) * 0.35;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(12,20,18,0.85)';
    g.lineWidth = 3.2;
    g.stroke();
    g.strokeStyle = 'rgba(245,252,252,1)';
    g.lineWidth = 1.3;
    g.stroke();
  }
  // the laminate's ring and the crushed center
  const ring = 14 + Math.random() * 4;
  g.strokeStyle = 'rgba(12,20,18,0.6)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, ring, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(240,248,248,0.8)';
  g.lineWidth = 1.4;
  g.stroke();
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 12);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.55, 'rgba(228,240,238,0.95)');
  gr.addColorStop(1, 'rgba(200,215,212,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 12, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(30,40,38,0.7)'; // the crater
  g.beginPath();
  g.arc(0, 0, 2.5, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const _up = new THREE.Vector3(0, 1, 0);
