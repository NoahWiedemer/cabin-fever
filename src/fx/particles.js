// CPU-simulated particle systems rendered in a single draw call each:
//  - SpriteParticles: textured point sprites (atlas 2x2), rotation, color/alpha, soft size
//  - StreakParticles: velocity-aligned camera-facing quads (sparks, tracers)
import * as THREE from 'three';

const spriteVert = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
attribute float aRot;
attribute float aFrame;
uniform float uScale;
varying vec4 vColor;
varying float vRot;
varying float vFrame;
varying float vFog;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.05);
  vColor = aColor;
  vRot = aRot;
  vFrame = aFrame;
  // simple distance fog fade for additive/alpha sprites
  vFog = exp(-max(-mv.z - 6.0, 0.0) * 0.05);
}
`;
const spriteFrag = /* glsl */ `
uniform sampler2D uMap;
uniform float uAtlas;
uniform float uAdditive;
varying vec4 vColor;
varying float vRot;
varying float vFrame;
varying float vFog;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  vec2 uv = p;
  if (uAtlas > 1.5) {
    vec2 fo = vec2(mod(vFrame, 2.0), floor(vFrame / 2.0)) * 0.5;
    uv = uv * 0.5 + fo;
  }
  uv.y = 1.0 - uv.y;
  vec4 t = texture2D(uMap, uv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  if (uAdditive > 0.5) {
    gl_FragColor = vec4(vColor.rgb * t.rgb * a * vFog, 1.0);
  } else {
    gl_FragColor = vec4(vColor.rgb * t.rgb, a * vFog);
  }
}
`;

export class SpriteParticles {
  constructor(scene, map, { max = 2000, additive = false, atlas = 1, layer = 0, renderOrder = 10 } = {}) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.frame = new Float32Array(max);
    // sim data
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.rotV = new Float32Array(max);
    this.baseA = new Float32Array(max);
    this.fadeIn = new Float32Array(max);
    this.baseCol = new Float32Array(max * 3);
    this.endCol = new Float32Array(max * 3);

    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aRot = new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage);
    this.aFrame = new THREE.BufferAttribute(this.frame, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aRot', this.aRot);
    g.setAttribute('aFrame', this.aFrame);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: spriteVert,
      fragmentShader: spriteFrag,
      uniforms: {
        uMap: { value: map },
        uScale: { value: 600 },
        uAtlas: { value: atlas },
        uAdditive: { value: additive ? 1 : 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    this.points.layers.set(layer);
    scene.add(this.points);
  }

  setViewportHeight(h, fovDeg) {
    // pixels per world unit at distance 1
    this.material.uniforms.uScale.value = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  /**
   * p: {x,y,z}, v: {x,y,z}, opts: { life, size, grow, drag, gravity, color:[r,g,b], endColor, alpha, rot, rotV, frame, fadeIn }
   */
  emit(px, py, pz, vx, vy, vz, o) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.pos[i * 3] = px;
    this.pos[i * 3 + 1] = py;
    this.pos[i * 3 + 2] = pz;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.size[i] = o.size ?? 0.2;
    this.grow[i] = o.grow ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.grav[i] = o.gravity ?? 0;
    this.rot[i] = o.rot ?? Math.random() * Math.PI * 2;
    this.rotV[i] = o.rotV ?? 0;
    this.frame[i] = o.frame ?? Math.floor(Math.random() * 4);
    this.baseA[i] = o.alpha ?? 1;
    this.fadeIn[i] = o.fadeIn ?? 0;
    const c = o.color ?? [1, 1, 1];
    const e = o.endColor ?? c;
    this.baseCol[i * 3] = c[0];
    this.baseCol[i * 3 + 1] = c[1];
    this.baseCol[i * 3 + 2] = c[2];
    this.endCol[i * 3] = e[0];
    this.endCol[i * 3 + 1] = e[1];
    this.endCol[i * 3 + 2] = e[2];
    this.col[i * 4 + 3] = 0;
  }

  _swap(i, j) {
    const sw3 = (arr) => {
      for (let k = 0; k < 3; k++) {
        const t = arr[i * 3 + k];
        arr[i * 3 + k] = arr[j * 3 + k];
        arr[j * 3 + k] = t;
      }
    };
    const sw1 = (arr) => {
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    };
    sw3(this.pos); sw3(this.vel); sw3(this.baseCol); sw3(this.endCol);
    for (let k = 0; k < 4; k++) {
      const t = this.col[i * 4 + k];
      this.col[i * 4 + k] = this.col[j * 4 + k];
      this.col[j * 4 + k] = t;
    }
    sw1(this.life); sw1(this.maxLife); sw1(this.size); sw1(this.grow); sw1(this.drag); sw1(this.grav);
    sw1(this.rot); sw1(this.rotV); sw1(this.frame); sw1(this.baseA); sw1(this.fadeIn);
  }

  update(dt, floorFn = null) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) this._swap(i, n);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      let a = this.baseA[i] * (1 - t);
      if (this.fadeIn[i] > 0) a *= Math.min(1, t / this.fadeIn[i]);
      this.col[i * 4] = this.baseCol[i * 3] + (this.endCol[i * 3] - this.baseCol[i * 3]) * t;
      this.col[i * 4 + 1] = this.baseCol[i * 3 + 1] + (this.endCol[i * 3 + 1] - this.baseCol[i * 3 + 1]) * t;
      this.col[i * 4 + 2] = this.baseCol[i * 3 + 2] + (this.endCol[i * 3 + 2] - this.baseCol[i * 3 + 2]) * t;
      this.col[i * 4 + 3] = a;
    }
    this.count = n;
    this.geometry.setDrawRange(0, n);
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aRot.needsUpdate = true;
    this.aFrame.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- streaks
const streakVert = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec4 aColor;
attribute float aWidth;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec3 p = mix(aStart, aEnd, position.y);
  vec3 axis = aEnd - aStart;
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(axis, toCam) + vec3(1e-5));
  p += side * position.x * aWidth;
  vColor = aColor;
  vUv = position.xy;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;
const streakFrag = /* glsl */ `
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.x);
  float along = smoothstep(0.0, 0.25, vUv.y) * (0.35 + 0.65 * vUv.y);
  float a = across * across * along * vColor.a;
  gl_FragColor = vec4(vColor.rgb * a, 1.0);
}
`;

export class StreakParticles {
  constructor(scene, { max = 600, layer = 0 } = {}) {
    this.max = max;
    this.count = 0;
    const base = new THREE.InstancedBufferGeometry();
    base.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    base.setIndex([0, 1, 2, 0, 2, 3]);
    this.start = new Float32Array(max * 3);
    this.end = new Float32Array(max * 3);
    this.color = new Float32Array(max * 4);
    this.width = new Float32Array(max);
    this.aStart = new THREE.InstancedBufferAttribute(this.start, 3).setUsage(THREE.DynamicDrawUsage);
    this.aEnd = new THREE.InstancedBufferAttribute(this.end, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    this.aWidth = new THREE.InstancedBufferAttribute(this.width, 1).setUsage(THREE.DynamicDrawUsage);
    base.setAttribute('aStart', this.aStart);
    base.setAttribute('aEnd', this.aEnd);
    base.setAttribute('aColor', this.aColor);
    base.setAttribute('aWidth', this.aWidth);
    base.instanceCount = 0;
    this.geometry = base;
    // sim
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.len = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.rgb = new Float32Array(max * 3);
    this.w0 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.tracer = new Uint8Array(max);
    this.travel = new Float32Array(max); // for tracers: remaining distance
    this.mesh = new THREE.Mesh(
      base,
      new THREE.ShaderMaterial({
        vertexShader: streakVert,
        fragmentShader: streakFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
    this.mesh.layers.set(layer);
    scene.add(this.mesh);
  }

  emit(px, py, pz, vx, vy, vz, o = {}) {
    let i;
    if (this.count < this.max) i = this.count++;
    else i = Math.floor(Math.random() * this.max);
    this.p[i * 3] = px;
    this.p[i * 3 + 1] = py;
    this.p[i * 3 + 2] = pz;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.len[i] = o.length ?? 0.05; // seconds of velocity trailing
    this.life[i] = this.maxLife[i] = o.life ?? 0.4;
    this.grav[i] = o.gravity ?? 9.8;
    this.drag[i] = o.drag ?? 1;
    const c = o.color ?? [3, 2, 1];
    this.rgb[i * 3] = c[0];
    this.rgb[i * 3 + 1] = c[1];
    this.rgb[i * 3 + 2] = c[2];
    this.w0[i] = o.width ?? 0.012;
    this.a0[i] = o.alpha ?? 1;
    this.tracer[i] = o.tracer ? 1 : 0;
    this.travel[i] = o.travel ?? Infinity;
  }

  /** a tracer: travels from a to b at `speed` with a streak of `length` meters */
  tracerLine(a, b, { speed = 320, length = 4, width = 0.018, color = [4, 3.2, 1.8] } = {}) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1) return;
    const inv = 1 / d;
    this.emit(a.x, a.y, a.z, dx * inv * speed, dy * inv * speed, dz * inv * speed, {
      life: d / speed + 0.02,
      length: length / speed,
      gravity: 0,
      drag: 0,
      color,
      width,
      tracer: true,
      travel: d,
    });
  }

  _swap(i, j) {
    const s3 = (a) => { for (let k = 0; k < 3; k++) { const t = a[i * 3 + k]; a[i * 3 + k] = a[j * 3 + k]; a[j * 3 + k] = t; } };
    const s1 = (a) => { const t = a[i]; a[i] = a[j]; a[j] = t; };
    s3(this.p); s3(this.v); s3(this.rgb);
    s1(this.len); s1(this.life); s1(this.maxLife); s1(this.grav); s1(this.drag); s1(this.w0); s1(this.a0); s1(this.tracer); s1(this.travel);
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        n--;
        if (i !== n) this._swap(i, n);
        i--;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= d;
      this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt;
      this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      const L = this.tracer[i] ? Math.min(this.len[i], this.maxLife[i] - this.life[i]) : this.len[i];
      this.end[i * 3] = this.p[i * 3];
      this.end[i * 3 + 1] = this.p[i * 3 + 1];
      this.end[i * 3 + 2] = this.p[i * 3 + 2];
      this.start[i * 3] = this.p[i * 3] - this.v[i * 3] * L;
      this.start[i * 3 + 1] = this.p[i * 3 + 1] - this.v[i * 3 + 1] * L;
      this.start[i * 3 + 2] = this.p[i * 3 + 2] - this.v[i * 3 + 2] * L;
      const fade = this.tracer[i] ? 1 : 1 - t * t;
      this.color[i * 4] = this.rgb[i * 3];
      this.color[i * 4 + 1] = this.rgb[i * 3 + 1];
      this.color[i * 4 + 2] = this.rgb[i * 3 + 2];
      this.color[i * 4 + 3] = this.a0[i] * fade;
      this.width[i] = this.w0[i];
    }
    this.count = n;
    this.geometry.instanceCount = n;
    this.aStart.needsUpdate = true;
    this.aEnd.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aWidth.needsUpdate = true;
  }
}
