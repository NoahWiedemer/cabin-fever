// Night sky with animated storm clouds, GPU rain (hidden under the roof), ground splashes,
// drifting toxic fog banks, lightning bolts, and interior ceiling drips.
import * as THREE from 'three';
import { tex } from './textures.js';
import { BARN, BARN_ROOF } from './ranchLayout.js';

// the barn is turned: its roof test runs in its own frame (constants baked into the shaders)
const BR = BARN_ROOF, f4 = (v) => v.toFixed(4);
const IN_BARN = (p) =>
  `(abs(${f4(BR.cos)} * (${p}.x - ${f4(BR.x)}) - ${f4(BR.sin)} * (${p}.y - ${f4(BR.z)})) < ${f4(BR.hx)} && ` +
  `abs(${f4(BR.sin)} * (${p}.x - ${f4(BR.x)}) + ${f4(BR.cos)} * (${p}.y - ${f4(BR.z)})) < ${f4(BR.hz)})`;

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;
const skyFrag = /* glsl */ `
varying vec3 vDir;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFogColor;
uniform vec3 uMoonDir;
uniform float uDawn;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  vec3 d = normalize(vDir);
  float y = max(d.y, 0.0);
  vec2 uv = d.xz / (d.y + 0.25) * 1.6;
  float c = fbm(uv + vec2(uTime * 0.012, uTime * 0.006));
  float c2 = fbm(uv * 2.3 - vec2(uTime * 0.02, 0.0));
  float clouds = smoothstep(0.35, 0.85, c * 0.7 + c2 * 0.4);
  vec3 top = vec3(0.010, 0.013, 0.022);
  vec3 cloudCol = vec3(0.030, 0.036, 0.050);
  vec3 col = mix(top, cloudCol, clouds);
  // moon glow behind clouds
  float m = max(dot(d, normalize(uMoonDir)), 0.0);
  col += vec3(0.35, 0.42, 0.55) * pow(m, 180.0) * (1.0 - clouds * 0.85) * 3.0;
  col += vec3(0.05, 0.06, 0.09) * pow(m, 8.0) * (0.4 + 0.6 * clouds);
  // lightning lights up the clouds from inside
  col += vec3(0.55, 0.6, 0.75) * uFlash * (0.25 + clouds * 1.4) * (0.6 + 0.4 * c2);
  // dawn: warm horizon glow, lighter clouds
  vec3 dawnTop = vec3(0.16, 0.2, 0.3);
  vec3 dawnHor = vec3(0.85, 0.45, 0.3);
  vec3 dawnCol = mix(dawnHor, dawnTop, smoothstep(0.0, 0.5, y)) * (0.75 + 0.25 * (1.0 - clouds));
  col = mix(col, dawnCol, uDawn);
  // fade to fog near the horizon
  float hz = smoothstep(0.0, 0.32, y);
  col = mix(uFogColor * (1.0 + uFlash * 2.0), col, hz);
  gl_FragColor = vec4(col, 1.0);
}
`;

const rainVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec4 uRoofA;
uniform vec4 uRoofB;
uniform vec4 uRoofC;
varying float vA;
varying float vV;
bool inRect(vec2 p, vec4 r) { return p.x > r.x && p.x < r.z && p.y > r.y && p.y < r.w; }
void main() {
  const vec3 box = vec3(36.0, 22.0, 36.0);
  float speed = 13.0 + aSeed.w * 5.0;
  vec3 p = aSeed.xyz * box;
  p.y -= uTime * speed;
  p.xz += vec2(0.9, 0.35) * uTime * speed * 0.08;
  // wrap around the camera
  vec3 base = uCam - box * 0.5;
  p = base + mod(p - base, box);
  // streak: position.y in [0,1] selects the top/bottom of the drop
  float len = 0.45 + aSeed.w * 0.35;
  vec3 dir = normalize(vec3(0.9 * 0.08, -1.0, 0.35 * 0.08));
  vec3 wp = p - dir * len * position.y;
  // camera-facing width, never thinner than ~1 px (far drops would alias away), dimmed to match
  vec3 toCam = normalize(uCam - wp);
  vec3 side = normalize(cross(dir, toCam));
  float camDist = length(uCam - wp);
  float w = max(0.012, camDist * 0.0012);
  wp += side * position.x * w;
  vA = 0.012 / w;
  if (inRect(p.xz, uRoofA) && p.y < 9.5) vA = 0.0;
  if (inRect(p.xz, uRoofB) && p.y < 3.2) vA = 0.0;
  if (inRect(p.xz, uRoofC) && p.y < 3.3) vA = 0.0;
  if (p.y < ${BARN.ridge.toFixed(2)} && ${IN_BARN('p.xz')}) vA = 0.0; // barn (ranchLayout.js)
  if (p.y < -0.6) vA = 0.0;
  float dist = length(wp - uCam);
  vA *= smoothstep(1.5, 4.5, dist) * (1.0 - smoothstep(16.0, 26.0, dist)); // no fat streaks right at the lens
  vV = position.y;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const rainFrag = /* glsl */ `
varying float vA;
varying float vV;
uniform float uFlash;
uniform float uBright;
void main() {
  if (vA < 0.01) discard;
  float a = vA * (1.0 - vV) * vV * 4.0;
  gl_FragColor = vec4(vec3(0.55, 0.62, 0.72) * a * (uBright + uFlash * 0.45), 1.0);
}
`;

const splashVert = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uCam;
uniform vec4 uRoofA;
uniform float uSize;
varying float vA;
void main() {
  float period = 0.55 + aSeed.z * 0.4;
  float ph = fract(uTime / period + aSeed.z * 13.1);
  float cycle = floor(uTime / period + aSeed.z * 13.1);
  vec2 jitter = fract(vec2(sin(cycle * 12.9 + aSeed.x * 91.0), sin(cycle * 78.2 + aSeed.y * 47.0)) * 43758.5);
  vec2 box = vec2(26.0);
  vec2 p = (aSeed.xy + jitter * 0.2) * box;
  vec2 base = uCam.xz - box * 0.5;
  p = base + mod(p - base, box);
  vec3 wp = vec3(p.x, -0.48, p.y);
  vA = (1.0 - ph) * step(ph, 0.35) * 2.5;
  if (p.x > uRoofA.x && p.x < uRoofA.z && p.y > uRoofA.y && p.y < uRoofA.w) vA = 0.0;
  if (${IN_BARN('p')}) vA = 0.0;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = -mv.z;
  vA *= 1.0 - smoothstep(9.0, 14.0, length(wp - uCam));
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * (0.4 + ph) / max(dist, 0.3);
}
`;
const splashFrag = /* glsl */ `
varying float vA;
uniform float uFlash;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  // flattened ring (splashes lie on the ground plane)
  vec2 q = vec2(c.x, c.y * 2.2);
  float rr = length(q);
  float ring = smoothstep(0.5, 0.38, rr) * smoothstep(0.18, 0.34, rr);
  float a = ring * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(0.5, 0.56, 0.65) * a * (0.12 + uFlash * 0.6), 1.0);
}
`;

const fogVert = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vA;
varying float vFrame;
void main() {
  vUv = uv;
  vec3 center = aSeed.xyz;
  center.x += sin(uTime * 0.03 + aSeed.w * 6.28) * 3.0 + uTime * 0.25;
  center.z += cos(uTime * 0.025 + aSeed.w * 3.0) * 3.0;
  center.x = mod(center.x + 45.0, 90.0) - 45.0;
  float size = 7.0 + aSeed.w * 7.0;
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(0.0, 1.0, 0.0);
  vec3 wp = center + camRight * position.x * size + camUp * position.y * size * 0.45;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float dist = -mv.z;
  // hide when inside the house region or too close to the camera
  float inHouse = max(step(abs(center.x), 13.0) * step(abs(center.z), 9.0), ${IN_BARN('center.xz')} ? 1.0 : 0.0);
  vA = (1.0 - inHouse) * smoothstep(2.0, 8.0, dist) * (1.0 - smoothstep(38.0, 55.0, dist));
  vFrame = floor(aSeed.w * 3.99);
  gl_Position = projectionMatrix * mv;
}
`;
const fogFrag = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
uniform float uFlash;
varying vec2 vUv;
varying float vA;
varying float vFrame;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * (1.0 + uFlash * 4.0), a);
}
`;

const shaftVert = /* glsl */ `
attribute vec3 aUVT;
varying vec3 vUVT;
varying vec3 vWorld;
void main() {
  vUVT = aUVT;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const shaftFrag = /* glsl */ `
varying vec3 vUVT;
varying vec3 vWorld;
uniform float uIntensity;
uniform float uTime;
uniform vec3 uColor;
float sh(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float sn(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1, 0)), f.x), mix(sh(i + vec2(0, 1)), sh(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float u = vUVT.x, v = vUVT.y, t = vUVT.z;
  float edge = smoothstep(0.0, 0.18, u) * smoothstep(1.0, 0.82, u) * smoothstep(0.0, 0.12, v) * smoothstep(1.0, 0.88, v);
  // plank gaps: light only passes between boards
  float boards = smoothstep(0.35, 0.55, fract(v * 4.3 + 0.2)) * (1.0 - smoothstep(0.75, 0.95, fract(v * 4.3 + 0.2)));
  boards = max(boards, 0.12);
  float fall = pow(1.0 - t, 1.6) * smoothstep(0.0, 0.25, t);
  float dust = 0.6 + 0.4 * sn(vWorld.xz * 3.0 + vec2(uTime * 0.07, -uTime * 0.05) + vWorld.y * 2.0);
  float a = edge * boards * fall * dust * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}
`;

function buildWindowShafts(windows, moonDir) {
  const L = moonDir.clone().negate().normalize(); // direction light travels
  const pos = [], uvt = [], idx = [];
  let base = 0;
  const len = 6.0;
  for (const w of windows) {
    // w.n / w.along / w.center: explicit world vectors (the turned barn's windows, world/barn.js)
    const n = w.n ?? (w.axis === 'x' ? new THREE.Vector3(0, 0, w.outward) : new THREE.Vector3(w.outward, 0, 0));
    if (n.dot(moonDir) <= 0.05) continue;
    const along = w.along ?? (w.axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1));
    const cx = (w.a + w.b) / 2;
    const center = w.center ? w.center.clone() : w.axis === 'x' ? new THREE.Vector3(cx, (w.y0 + w.y1) / 2, w.c) : new THREE.Vector3(w.c, (w.y0 + w.y1) / 2, cx);
    center.addScaledVector(n, -0.16);
    const halfW = (w.b - w.a) / 2, halfH = (w.y1 - w.y0) / 2;
    const corner = (u, v) => center.clone().addScaledVector(along, (u - 0.5) * 2 * halfW).add(new THREE.Vector3(0, (v - 0.5) * 2 * halfH, 0));
    const quad = (p0, p1, p2, p3, a0, a1, a2, a3) => {
      pos.push(...p0.toArray(), ...p1.toArray(), ...p2.toArray(), ...p3.toArray());
      uvt.push(...a0, ...a1, ...a2, ...a3);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      base += 4;
    };
    const S = 5;
    for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S;
      const a = corner(u, 0), b = corner(u, 1);
      quad(a, b, b.clone().addScaledVector(L, len), a.clone().addScaledVector(L, len), [u, 0, 0], [u, 1, 0], [u, 1, 1], [u, 0, 1]);
    }
    for (let i = 0; i < 4; i++) {
      const v = (i + 0.5) / 4;
      const a = corner(0, v), b = corner(1, v);
      quad(a, b, b.clone().addScaledVector(L, len), a.clone().addScaledVector(L, len), [0, v, 0], [1, v, 0], [1, v, 1], [0, v, 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aUVT', new THREE.Float32BufferAttribute(uvt, 3));
  g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    vertexShader: shaftVert,
    fragmentShader: shaftFrag,
    uniforms: { uIntensity: { value: 0.03 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(0.55, 0.68, 1.0) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 4;
  return mesh;
}

export class Weather {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.time = 0;

    // Sky dome
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uTime: { value: 0 },
        uFlash: { value: 0 },
        uFogColor: { value: new THREE.Color(0x0e1413) },
        uMoonDir: { value: new THREE.Vector3(-0.55, 0.75, 0.35) },
        uDawn: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(200, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    scene.add(this.sky);

    // Rain streaks
    const N = 9000;
    const quad = [
      [-1, 0], [1, 0], [1, 1],
      [-1, 0], [1, 1], [-1, 1],
    ];
    const pos = new Float32Array(N * 6 * 3);
    const seed = new Float32Array(N * 6 * 4);
    for (let i = 0; i < N; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      for (let k = 0; k < 6; k++) {
        const o = (i * 6 + k);
        pos[o * 3] = quad[k][0];
        pos[o * 3 + 1] = quad[k][1];
        pos[o * 3 + 2] = 0;
        seed.set(s, o * 4);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.rainMat = new THREE.ShaderMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uRoofA: { value: new THREE.Vector4(-12.8, -8.8, 12.8, 8.8) },
        uRoofB: { value: new THREE.Vector4(-9.8, 8.0, -3.2, 10.8) },
        uRoofC: { value: new THREE.Vector4(3.8, 8.0, 11.2, 9.7) },
        uFlash: { value: 0 },
        uBright: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, // the streak quads wind away from the camera: single-sided they were all culled
    });
    this.rain = new THREE.Mesh(rg, this.rainMat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 6;
    scene.add(this.rain);

    // Ground splashes
    const S = 1800;
    const sp = new Float32Array(S * 3);
    const ss = new Float32Array(S * 3);
    for (let i = 0; i < S; i++) {
      ss[i * 3] = Math.random();
      ss[i * 3 + 1] = Math.random();
      ss[i * 3 + 2] = Math.random();
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 3));
    this.splashMat = new THREE.ShaderMaterial({
      vertexShader: splashVert,
      fragmentShader: splashFrag,
      uniforms: {
        uTime: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uRoofA: { value: new THREE.Vector4(-12.2, -8.2, 12.2, 8.2) },
        uSize: { value: 60 },
        uFlash: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.splashes = new THREE.Points(sg, this.splashMat);
    this.splashes.frustumCulled = false;
    scene.add(this.splashes);

    // Toxic fog banks (billboards)
    let fogTex = null;
    try {
      fogTex = tex('fogPuff').map;
    } catch (e) {
      /* optional */
    }
    if (fogTex) {
      const F = 90;
      const fp = [];
      const fu = [];
      const fs = [];
      const fi = [];
      for (let i = 0; i < F; i++) {
        let x, z;
        do {
          x = (Math.random() * 2 - 1) * 42;
          z = (Math.random() * 2 - 1) * 42;
        } while (Math.abs(x) < 14 && Math.abs(z) < 10);
        const y = -0.5 + 0.6 + Math.random() * 1.6;
        const w = Math.random();
        const b = i * 4;
        fp.push(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0);
        fu.push(0, 0, 1, 0, 1, 1, 0, 1);
        for (let k = 0; k < 4; k++) fs.push(x, y, z, w);
        fi.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
      fg.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
      fg.setAttribute('aSeed', new THREE.Float32BufferAttribute(fs, 4));
      fg.setIndex(fi);
      this.fogMat = new THREE.ShaderMaterial({
        vertexShader: fogVert,
        fragmentShader: fogFrag,
        uniforms: {
          uTime: { value: 0 },
          uMap: { value: fogTex },
          uColor: { value: new THREE.Color(0x1d2a22) },
          uOpacity: { value: 0.32 },
          uFlash: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
      });
      this.fogBanks = new THREE.Mesh(fg, this.fogMat);
      this.fogBanks.frustumCulled = false;
      this.fogBanks.renderOrder = 3;
      scene.add(this.fogBanks);
    }

    // Lightning bolt (shown during flashes, somewhere in the distance)
    this.bolt = this._makeBolt();
    scene.add(this.bolt);
    this.boltT = 0;

    // Ceiling drips inside (leaky roof)
    this.drips = [];
    const dripSpots = [
      [-5.2, 3.15, 6.6, 0],
      [8.8, 3.15, -6.2, 0],
      [-9.6, -0.3, -1.2, -3.2],
      [5.5, 6.15, 5.2, 3.45],
    ];
    const dripMat = new THREE.MeshBasicMaterial({ color: 0x9fb4c8, transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    const dripGeo = new THREE.SphereGeometry(0.012, 6, 4);
    dripGeo.scale(1, 2.2, 1);
    for (const [x, top, z, floor] of dripSpots) {
      const m = new THREE.Mesh(dripGeo, dripMat);
      m.position.set(x, top, z);
      scene.add(m);
      this.drips.push({ mesh: m, top, floor: floor || 0, y: top, v: 0, wait: Math.random() * 2, x, z });
    }
    this.onDripSplash = null;

    // moonlight shafts through the boarded windows
    if (level.windows) {
      this.shafts = buildWindowShafts(level.windows, new THREE.Vector3(-0.55, 0.75, 0.35).normalize());
      scene.add(this.shafts);
    }
  }

  _makeBolt() {
    const pts = [];
    let p = new THREE.Vector3(0, 60, 0);
    pts.push(p.clone());
    for (let i = 0; i < 18; i++) {
      p = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 7, -3.6, (Math.random() - 0.5) * 7));
      pts.push(p.clone());
    }
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: new THREE.Color(2.5, 2.7, 4.0), transparent: true, opacity: 1, fog: false, depthWrite: false });
    const l = new THREE.Line(g, m);
    l.visible = false;
    return l;
  }

  /** A bolt that comes down right onto `target` (the barn, world/barnFire.js): jagged, converging, a branch or two. */
  strikeAt(target) {
    const pts = [];
    const n = 22, top = 70;
    let x = target.x + (Math.random() - 0.5) * 18, z = target.z + (Math.random() - 0.5) * 18;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const y = top + (target.y - top) * k;
      // wander, pulled onto the target as it comes down
      x += (Math.random() - 0.5) * 3.2 * (1 - k);
      z += (Math.random() - 0.5) * 3.2 * (1 - k);
      pts.push(new THREE.Vector3(x + (target.x - x) * k * k, y, z + (target.z - z) * k * k));
      if (i === 9 || i === 15) {
        // a short fork
        const f = pts[pts.length - 1];
        pts.push(f.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, -4 - Math.random() * 4, (Math.random() - 0.5) * 6)), f.clone());
      }
    }
    pts[pts.length - 1].copy(target);
    this._boltGeo0 ??= this.bolt.geometry; // the distant bolts keep their own shape
    this._targetBolt?.dispose();
    this._targetBolt = new THREE.BufferGeometry().setFromPoints(pts);
    this.bolt.geometry = this._targetBolt;
    this.bolt.position.set(0, 0, 0);
    this.bolt.rotation.y = 0;
    this.bolt.visible = true;
    this.boltT = 0.45;
    // a 1 px line is lost at this range: a glowing channel of tubes around it (the drip material's program)
    if (!this.boltTube) {
      const mat = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, ...o });
      this.boltTube = new THREE.Group();
      this.boltTube.add(new THREE.Mesh(undefined, mat({ color: new THREE.Color(2.6, 2.8, 4.0) })));
      this.boltTube.add(new THREE.Mesh(undefined, mat({ color: new THREE.Color(0.35, 0.45, 0.9), opacity: 0.5 })));
      this.boltTube.renderOrder = 7;
      this.scene.add(this.boltTube);
    }
    const path = new THREE.CurvePath();
    for (let i = 1; i < pts.length; i++) path.add(new THREE.LineCurve3(pts[i - 1], pts[i]));
    const [core, halo] = this.boltTube.children;
    core.geometry?.dispose();
    halo.geometry?.dispose();
    core.geometry = new THREE.TubeGeometry(path, pts.length * 2, 0.07, 4, false);
    halo.geometry = new THREE.TubeGeometry(path, pts.length * 2, 0.32, 5, false);
    core.frustumCulled = halo.frustumCulled = false;
    this.boltTube.visible = true;
  }

  strike() {
    if (this._boltGeo0) this.bolt.geometry = this._boltGeo0;
    const a = Math.random() * Math.PI * 2;
    const r = 70 + Math.random() * 50;
    this.bolt.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.bolt.rotation.y = Math.random() * Math.PI;
    this.bolt.visible = true;
    this.boltT = 0.22;
  }

  update(dt, camPos, lightning, fogColor, dawn = 0) {
    this.time += dt;
    this.skyMat.uniforms.uDawn.value = dawn;
    // additive streaks go through bloom + AgX: a little goes a long way
    this.rainMat.uniforms.uBright.value = 0.065 * (1 - dawn * 0.7);
    const t = this.time;
    this.skyMat.uniforms.uTime.value = t;
    this.skyMat.uniforms.uFlash.value = lightning;
    if (fogColor) this.skyMat.uniforms.uFogColor.value.copy(fogColor);
    this.sky.position.copy(camPos);
    this.rainMat.uniforms.uTime.value = t;
    this.rainMat.uniforms.uCam.value.copy(camPos);
    this.rainMat.uniforms.uFlash.value = lightning;
    this.splashMat.uniforms.uTime.value = t;
    this.splashMat.uniforms.uCam.value.copy(camPos);
    this.splashMat.uniforms.uFlash.value = lightning;
    if (this.fogMat) {
      this.fogMat.uniforms.uTime.value = t;
      this.fogMat.uniforms.uFlash.value = lightning;
    }
    if (this.shafts) {
      this.shafts.material.uniforms.uTime.value = t;
      this.shafts.material.uniforms.uIntensity.value = 0.022 + lightning * 0.45;
    }
    if (this.boltT > 0) {
      this.boltT -= dt;
      this.bolt.material.opacity = Math.random() < 0.3 ? 0.2 : 1;
      if (this.boltTube?.visible) this.boltTube.children[0].material.opacity = this.bolt.material.opacity;
      if (this.boltT <= 0) {
        this.bolt.visible = false;
        if (this.boltTube) this.boltTube.visible = false;
      }
    }
    for (const d of this.drips) {
      if (d.wait > 0) {
        d.wait -= dt;
        d.mesh.visible = d.wait < 0.6;
        d.mesh.position.y = d.top - 0.02 * (1 - d.wait / 0.6);
        continue;
      }
      d.v += 9.8 * dt;
      d.y -= d.v * dt;
      d.mesh.position.y = d.y;
      if (d.y <= d.floor) {
        this.onDripSplash?.(new THREE.Vector3(d.x, d.floor, d.z));
        d.y = d.top;
        d.v = 0;
        d.wait = 0.8 + Math.random() * 2.2;
      }
    }
  }
}
