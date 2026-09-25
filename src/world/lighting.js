// Scene lighting: moonlight (shadowed), hemisphere ambience, a pooled set of lamp lights
// (nearest lamps get the shadow-casting slots), volumetric light cones, dust motes,
// flicker, lightning flashes, and pooled dynamic lights (muzzle flash / explosions).
import * as THREE from 'three';
import { VIEWMODEL_LAYER } from '../core/renderer.js';
import { tex } from './textures.js';

const coneVert = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorld;
uniform float uLen;
void main() {
  vH = clamp(-position.y / uLen, 0.0, 1.0);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const coneFrag = /* glsl */ `
varying float vH;
varying vec3 vN;
varying vec3 vView;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
float h1(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n3(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h1(i), h1(i + vec3(1,0,0)), f.x), mix(h1(i + vec3(0,1,0)), h1(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h1(i + vec3(0,0,1)), h1(i + vec3(1,0,1)), f.x), mix(h1(i + vec3(0,1,1)), h1(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  float facing = abs(dot(normalize(vN), normalize(vView)));
  float edge = pow(facing, 1.6);
  float fall = pow(1.0 - vH, 1.7) * smoothstep(0.0, 0.08, vH);
  float dust = 0.65 + 0.35 * n3(vWorld * 2.2 + vec3(0.0, -uTime * 0.12, uTime * 0.05));
  float a = edge * fall * dust * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

const moteVert = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform float uSize;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * 0.08;
  p.x += sin(t * (1.0 + aSeed.x) + aSeed.y * 6.28) * 0.35;
  p.y += fract(aSeed.z + t * 0.12 * (0.5 + aSeed.x)) * 1.6 - 0.8;
  p.z += cos(t * (1.0 + aSeed.y) + aSeed.x * 6.28) * 0.35;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.5 + aSeed.y) / max(-mv.z, 0.1);
  vA = (0.4 + 0.6 * aSeed.x) * smoothstep(0.8, 2.5, -mv.z);
}
`;
const moteFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
varying float vA;
void main() {
  vec4 t = texture2D(uMap, gl_PointCoord);
  gl_FragColor = vec4(uColor * t.a * vA, 1.0);
}
`;

export class Lighting {
  constructor(scene, lamps, quality) {
    this.scene = scene;
    this.lamps = lamps;
    this.q = quality;
    this.time = 0;
    this.lightning = 0;
    this.lightningQueue = [];
    this.nextLightning = 8 + Math.random() * 10;
    this.onThunder = null;

    const enableVM = (l) => {
      l.layers.enable(VIEWMODEL_LAYER);
      return l;
    };

    // Ambient: cold sky / dark ground
    this.hemi = enableVM(new THREE.HemisphereLight(0x5a6e8c, 0x1c140e, 0.55));
    this.hemiOutSky = new THREE.Color(0x5a6e8c);
    this.hemiOutGround = new THREE.Color(0x1c140e);
    this.hemiInSky = new THREE.Color(0x3a3a40);
    this.hemiInGround = new THREE.Color(0xa47c58);
    // indoors with the generator down: no warm lamp bounce, only cold moonlight through the boards
    this.hemiDarkSky = new THREE.Color(0x2c3442);
    this.hemiDarkGround = new THREE.Color(0x3a3c44);
    this.indoor = 1;
    // generator mains 0..1 (world/power.js): scales every lamp on the circuit (not `fire` or `mains: false`)
    this.mains = 1;
    this._c = new THREE.Color();
    scene.add(this.hemi);

    // Moon
    this.moonDir = new THREE.Vector3(-0.55, 0.75, 0.35).normalize();
    this.moon = enableVM(new THREE.DirectionalLight(0x9db3de, 0.55));
    this.moon.position.copy(this.moonDir).multiplyScalar(60);
    this.moon.target.position.set(0, 0, 0);
    this.moon.castShadow = true;
    const ms = this.moon.shadow;
    ms.mapSize.set(quality.moonShadow, quality.moonShadow);
    ms.camera.left = -32;
    ms.camera.right = 32;
    ms.camera.top = 32;
    ms.camera.bottom = -32;
    ms.camera.near = 10;
    ms.camera.far = 130;
    ms.bias = -0.0006;
    ms.normalBias = 0.04;
    ms.radius = 2;
    ms.autoUpdate = false;
    ms.needsUpdate = true;
    scene.add(this.moon, this.moon.target);
    this.frame = 0;
    this.moonBase = 0.55;

    // Lamp light pool
    this.shadowSlots = [];
    this.plainSlots = [];
    const makeSpot = (shadow) => {
      const s = enableVM(new THREE.SpotLight(0xffb46b, 0, 16, 1.4, 0.95, 2));
      s.castShadow = shadow;
      if (shadow) {
        s.shadow.autoUpdate = false;
        s.shadow.needsUpdate = true;
        s.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
        s.shadow.bias = -0.0009;
        s.shadow.normalBias = 0.025;
        s.shadow.radius = 3;
        s.shadow.camera.near = 0.12;
        s.shadow.camera.far = 16;
      }
      scene.add(s, s.target);
      s.userData.lamp = null;
      return s;
    };
    for (let i = 0; i < quality.spotShadows; i++) this.shadowSlots.push(makeSpot(true));
    for (let i = 0; i < 7; i++) this.plainSlots.push(makeSpot(false));
    // fire / point lamp (single dedicated)
    this.firePoint = enableVM(new THREE.PointLight(0xff7a2a, 0, 14, 2));
    scene.add(this.firePoint);

    // per-lamp state
    for (const L of lamps) {
      L.weight = 0;
      L.cur = 0;
      L.flickerT = Math.random() * 100;
      L.off = 0;
      L.seed = Math.random() * 1000;
    }

    // visuals: glow sprites + light cones
    this.cones = [];
    const glowTex = safeTex('glow');
    for (const L of lamps) {
      // fx: false = a bare light (the lab's ceiling panels are their own visuals): no glow, cone or motes
      if (glowTex && L.fx !== false) {
        const sm = new THREE.SpriteMaterial({
          map: glowTex,
          color: new THREE.Color(L.color).multiplyScalar(3),
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          fog: false,
        });
        const sp = new THREE.Sprite(sm);
        sp.scale.setScalar(L.fire ? 2.2 : 0.9);
        sp.position.copy(L.pos);
        sp.renderOrder = 5;
        scene.add(sp);
        L.glow = sp;
      }
      if (L.spot && !L.porch && L.fx !== false) {
        const floorY = L.level === 0 ? -3.2 : L.level === 1 ? 0 : 3.45;
        const len = Math.max(0.5, L.pos.y - floorY - 0.02);
        const rad = Math.tan(L.angle * 0.62) * len;
        const geo = new THREE.ConeGeometry(rad, len, 28, 1, true);
        geo.translate(0, -len / 2, 0);
        const mat = new THREE.ShaderMaterial({
          vertexShader: coneVert,
          fragmentShader: coneFrag,
          uniforms: {
            uLen: { value: len },
            uColor: { value: new THREE.Color(L.color) },
            uIntensity: { value: 0 },
            uTime: { value: 0 },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        });
        const cone = new THREE.Mesh(geo, mat);
        cone.position.copy(L.pos);
        cone.position.y -= 0.04;
        cone.renderOrder = 4;
        cone.frustumCulled = true;
        scene.add(cone);
        L.cone = cone;
        this.cones.push(cone);
      }
    }

    // dust motes floating in lamp light
    const dustTex = safeTex('dust') || glowTex;
    if (dustTex) {
      const per = 36;
      const pos = [];
      const seed = [];
      for (const L of lamps) {
        if (!L.spot || L.porch || L.fx === false) continue;
        const floorY = L.level === 0 ? -3.2 : L.level === 1 ? 0 : 3.45;
        for (let i = 0; i < per; i++) {
          const r = Math.sqrt(Math.random()) * 1.6;
          const a = Math.random() * Math.PI * 2;
          pos.push(L.pos.x + Math.cos(a) * r, floorY + 0.3 + Math.random() * (L.pos.y - floorY - 0.4), L.pos.z + Math.sin(a) * r);
          seed.push(Math.random(), Math.random(), Math.random());
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 3));
      this.motes = new THREE.Points(
        g,
        new THREE.ShaderMaterial({
          vertexShader: moteVert,
          fragmentShader: moteFrag,
          uniforms: {
            uTime: { value: 0 },
            uSize: { value: 12 },
            uMap: { value: dustTex },
            uColor: { value: new THREE.Color(0xffd9a8).multiplyScalar(0.32) },
          },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        })
      );
      this.motes.frustumCulled = false;
      this.moteColor = this.motes.material.uniforms.uColor.value.clone();
      scene.add(this.motes);
    }

    // Dynamic pooled point lights (muzzle flashes, explosions)
    this.dyn = [];
    for (let i = 0; i < 3; i++) {
      const p = enableVM(new THREE.PointLight(0xffc27a, 0, 10, 2));
      scene.add(p);
      this.dyn.push({ light: p, life: 0, max: 1, peak: 0 });
    }
    this.muzzle = enableVM(new THREE.PointLight(0xffc88a, 0, 9, 2));
    scene.add(this.muzzle);
    this.muzzleT = 0;

    // player flashlight (world only: it sits right at the gun, which it would blow out to white)
    this.flashlight = new THREE.SpotLight(0xe8f0ff, 0, 30, 0.42, 0.55, 1.6);
    scene.add(this.flashlight, this.flashlight.target);
    this.flashlightOn = false;
    this.flashNear = 1; // auto-dim factor for close surfaces (needs .world, set by the game)
    this.world = null;

    this.assignTimer = 0;
  }

  muzzleFlash(pos, intensity = 1) {
    this.muzzle.position.copy(pos);
    this.muzzle.intensity = 16 * intensity;
    this.muzzleT = 0.05;
  }

  flashAt(pos, color = 0xffa048, peak = 120, duration = 0.5, distance = 16) {
    let best = this.dyn[0];
    for (const d of this.dyn) if (d.life <= 0 || d.life < best.life) best = d;
    best.light.position.copy(pos);
    best.light.color.set(color);
    best.light.distance = distance;
    best.life = duration;
    best.max = duration;
    best.peak = peak;
  }

  triggerLightning(intensity = 1) {
    const n = 2 + Math.floor(Math.random() * 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      this.lightningQueue.push({ at: t, dur: 0.05 + Math.random() * 0.08, amp: intensity * (0.5 + Math.random() * 0.8) });
      t += 0.06 + Math.random() * 0.14;
    }
    this.onThunder?.(intensity, 0.4 + Math.random() * 2.2);
  }

  update(dt, camPos, camQuat, playerLevel) {
    this.time += dt;
    const t = this.time;

    // lightning scheduling
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 14 + Math.random() * 26;
      this.triggerLightning(0.6 + Math.random() * 0.6);
    }
    let flash = 0;
    for (let i = this.lightningQueue.length - 1; i >= 0; i--) {
      const q = this.lightningQueue[i];
      q.at -= dt;
      if (q.at <= 0) {
        flash = Math.max(flash, q.amp);
        q.dur -= dt;
        if (q.dur <= 0) this.lightningQueue.splice(i, 1);
      }
    }
    this.lightning = Math.max(flash, this.lightning - dt * 6);
    this.moon.intensity = this.moonBase + this.lightning * 9;
    this.moon.color.setRGB(0.62 + this.lightning * 0.3, 0.7 + this.lightning * 0.25, 0.87 + this.lightning * 0.1);
    const ind = this.indoor;
    const pw = this.mains;
    this.hemi.color.copy(this.hemiOutSky).lerp(this._c.copy(this.hemiDarkSky).lerp(this.hemiInSky, pw), ind);
    this.hemi.groundColor.copy(this.hemiOutGround).lerp(this._c.copy(this.hemiDarkGround).lerp(this.hemiInGround, pw), ind);
    this.hemi.intensity = 0.8 + ind * (0.12 + 1.18 * pw) + this.lightning * 2.2;

    // lamp flicker + weights
    for (const L of this.lamps) {
      let f = 1;
      if (L.flicker > 0) {
        L.flickerT += dt;
        const n = Math.sin(L.flickerT * 23.0 + L.seed) * Math.sin(L.flickerT * 7.3 + L.seed * 2.1);
        f = 1 - L.flicker * 0.18 * (0.5 + 0.5 * n);
        if (L.off > 0) {
          L.off -= dt;
          f *= 0.05;
        } else if (Math.random() < dt * 0.25 * L.flicker) {
          L.off = 0.04 + Math.random() * 0.25;
        }
        if (L.fire) f = 0.75 + 0.25 * Math.sin(t * 11 + L.seed) * Math.sin(t * 4.3 + L.seed * 0.7) + Math.random() * 0.1;
      }
      if (!L.fire && L.mains !== false) f *= this.mains;
      L.cur = f;
      if (L.glow) L.glow.material.opacity = f;
      if (L.cone) {
        L.cone.material.uniforms.uIntensity.value = 0.055 * f * (L.level === playerLevel ? 1 : 0.6);
        L.cone.material.uniforms.uTime.value = t;
      }
    }
    if (this.motes) {
      const u = this.motes.material.uniforms;
      u.uTime.value = t;
      u.uColor.value.copy(this.moteColor).multiplyScalar(this.mains); // dust only shows in lamp light
    }

    // assign lamp lights to pool slots
    this.assignTimer -= dt;
    if (this.assignTimer <= 0) {
      this.assignTimer = 0.2;
      const scored = [];
      for (const L of this.lamps) {
        if (L.fire || L.hidden) continue; // hidden: the lab's spot while the lab isn't drawn (world/lab.js)
        let d = L.pos.distanceTo(camPos);
        if (L.level !== playerLevel) d += 10;
        if (L.slot && L.slot.castShadow) d -= 2.5; // hysteresis
        if (this.mains < 0.02 && L.mains !== false) d += 100; // blackout: the emergency lamps get the slots
        scored.push([d, L]);
      }
      scored.sort((a, b) => a[0] - b[0]);
      for (const L of this.lamps) L.nextSlot = null;
      let si = 0, pi = 0;
      for (const [, L] of scored) {
        // shadow: false = never a shadow slot (wide outdoor floods: their shadow frustum would cover the yard)
        if (si < this.shadowSlots.length && L.shadow !== false) L.nextSlot = this.shadowSlots[si++];
        else if (pi < this.plainSlots.length) L.nextSlot = this.plainSlots[pi++];
      }
      for (const s of [...this.shadowSlots, ...this.plainSlots]) s.userData.lamp = null;
      for (const L of this.lamps) {
        if (L.nextSlot) {
          const s = L.nextSlot;
          if (L.slot !== s) {
            s.position.copy(L.pos);
            if (L.aim) s.target.position.copy(L.pos).add(L.aim); // aimed spot (lab)
            else s.target.position.set(L.pos.x, L.pos.y - 3, L.pos.z + (L.porch ? 1.2 : 0));
            s.target.updateMatrixWorld();
            s.color.set(L.color);
            s.angle = Math.min(1.48, L.angle + 0.25);
            s.distance = L.distance;
            if (s.castShadow) {
              s.shadow.camera.far = L.distance;
              s.shadow.needsUpdate = true;
            }
          }
          s.userData.lamp = L;
        } else {
          L.weight = 0;
        }
        L.slot = L.nextSlot;
      }
    }
    for (const s of [...this.shadowSlots, ...this.plainSlots]) {
      const L = s.userData.lamp;
      if (!L) {
        s.intensity = 0;
        continue;
      }
      L.weight = Math.min(1, L.weight + dt * 4);
      s.intensity = L.intensity * L.cur * L.weight;
    }
    // throttled shadow updates: half of the lamp shadow maps per frame, moon every 3rd frame
    this.frame++;
    for (let i = 0; i < this.shadowSlots.length; i++) {
      if ((i + this.frame) % 2 === 0) this.shadowSlots[i].shadow.needsUpdate = true;
    }
    if (this.frame % 3 === 0 || this.lightning > 0.05) this.moon.shadow.needsUpdate = true;
    const fire = this.lamps.find((L) => L.fire);
    if (fire) {
      this.firePoint.position.copy(fire.pos);
      this.firePoint.intensity = fire.intensity * fire.cur;
    }

    // dynamic lights
    for (const d of this.dyn) {
      if (d.life > 0) {
        d.life -= dt;
        const k = Math.max(0, d.life / d.max);
        d.light.intensity = d.peak * k * k;
      } else d.light.intensity = 0;
    }
    if (this.muzzleT > 0) {
      this.muzzleT -= dt;
      if (this.muzzleT <= 0) this.muzzle.intensity = 0;
    }

    // flashlight follows the camera
    if (camQuat) {
      this.flashlight.position.copy(camPos);
      const fwd = _flFwd.set(0, 0, -1).applyQuaternion(camQuat);
      const right = _flRight.set(1, 0, 0).applyQuaternion(camQuat);
      this.flashlight.position.addScaledVector(right, 0.18).addScaledVector(fwd, 0.2).y -= 0.12;
      this.flashlight.target.position.copy(camPos).addScaledVector(fwd, 10);
      this.flashlight.target.updateMatrixWorld();
      // auto-dim up close: the beam's falloff blows nearby surfaces out to white, so the lamp eases
      // down (to 20 %) as the surface in the middle of the view comes within ~3.5 m
      let near = 1;
      if (this.flashlightOn && this.world) {
        const hit = this.world.raycast(camPos.x, camPos.y, camPos.z, fwd.x, fwd.y, fwd.z, 3.5, null, _flHit);
        if (hit) near = Math.max(0.2, Math.pow(hit.t / 3.5, 1.4));
      }
      this.flashNear += (near - this.flashNear) * Math.min(1, dt * 10);
      this.flashlight.intensity = this.flashlightOn ? 55 * this.flashNear : 0;
    }
  }
}

const _flFwd = new THREE.Vector3(), _flRight = new THREE.Vector3(), _flHit = {};

function safeTex(name) {
  try {
    return tex(name).map;
  } catch (e) {
    return null;
  }
}
