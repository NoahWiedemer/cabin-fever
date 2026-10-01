// The Hive's specimen tanks: the big one in the atrium (a Crusher hangs in it) and the smaller tubes of the specimen hall.
// The glass, the liquid and the bubbles are custom shaders, each merged over ALL tanks (the tank's centre, radius and
// height ride along as vertex attributes), so every tank on the level costs three draw calls together plus its zombie.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createCharacter } from '../actors/rig.js';
import { MODELS } from '../core/assetList.js';
import { canvas, texOf, mulberry, speckle, SIGN } from './lab.js';
import { SURF } from './collision.js';

/** the zombies that hang in the tanks (preloaded before the map is built: maps.js) */
export const SPECIMEN_URLS = ['tank', 'normal', 'woman', 'worker', 'smoker', 'gasmask', 'survivor', 'stalker'].map((k) => MODELS[k]);

const NOISE = /* glsl */ `
float hash31(vec3 p){ p = fract(p*0.3183099+vec3(0.71,0.113,0.419)); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x), f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i), hash31(i+vec3(1,0,0)), f.x), mix(hash31(i+vec3(0,1,0)), hash31(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash31(i+vec3(0,0,1)), hash31(i+vec3(1,0,1)), f.x), mix(hash31(i+vec3(0,1,1)), hash31(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ return 0.55*vnoise(p) + 0.3*vnoise(p*2.03+3.1) + 0.15*vnoise(p*4.1+7.7); }
`;

const uTime = { value: 0 };

// ---------------------------------------------------------------- the liquid
// The tank's side: a front-face-only cylinder whose opacity follows the length of the chord the view ray runs through
// the liquid (thin at the middle, dense at the rim), slow drifting wisps, a light gradient.
function liquidMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aTank; // cx, cz, R, yTop
      varying vec3 vW; varying vec4 vT;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vT = aTank; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vW; varying vec4 vT;
      ${NOISE}
      void main(){
        vec3 dir = vW - cameraPosition;
        float dl = max(length(dir.xz), 1e-4);
        vec2 d = dir.xz/dl, o = cameraPosition.xz - vT.xy;
        vec2 cp = o + d*(-dot(o,d));
        float chord = 2.0*sqrt(max(vT.z*vT.z - dot(cp,cp), 0.0)) * length(dir)/dl;
        float dens = 1.0 - exp(-chord*0.3);
        float hy = clamp(vW.y/max(vT.w,0.1), 0.0, 1.0);
        float n = fbm(vec3(vW.x*1.1, vW.y*0.7 - uTime*0.06, vW.z*1.1) + vec3(0.0, 0.0, uTime*0.03));
        vec3 deep = vec3(0.004, 0.075, 0.05), lit = vec3(0.05, 0.5, 0.29), hot = vec3(0.3, 1.0, 0.7);
        vec3 col = mix(deep, lit, 0.5 + 0.5*n) * (0.65 + 0.55*(1.0 - hy)) ;
        col += hot * pow(1.0 - dens, 2.0) * 0.05 * (0.5 + n);           // the thin middle glows: the light behind
        col += hot * smoothstep(0.9, 1.0, hy) * 0.1;                     // the surface layer
        gl_FragColor = vec4(col, clamp(dens*0.55 + 0.03, 0.0, 0.9)*0.8);
      }`,
  });
}

// The liquid's surface seen from below (total reflection: bright, rippling) and its floor.
function surfaceMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vW;
      ${NOISE}
      void main(){
        vec2 q = vW.xz*2.6;
        float r1 = vnoise(vec3(q, uTime*0.35)), r2 = vnoise(vec3(q*1.9+5.0, uTime*0.5));
        float rip = smoothstep(0.55, 0.85, 0.5*r1 + 0.5*r2);
        vec3 col = mix(vec3(0.02, 0.26, 0.16), vec3(0.45, 1.0, 0.78), rip);
        gl_FragColor = vec4(col, 0.08 + 0.22*rip);
      }`,
  });
}

// ---------------------------------------------------------------- the glass
function glassMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec4 aTank;
      varying vec3 vW; varying vec3 vN; varying vec4 vT;
      void main(){
        vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vT = aTank;
        vN = normalize(mat3(modelMatrix)*normal);
        gl_Position = projectionMatrix*viewMatrix*w;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vW; varying vec3 vN; varying vec4 vT;
      ${NOISE}
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 3.0);
        vec3 R = reflect(-V, N);
        // two soft boxes (the ceiling panels) as vertical streaks, fading toward the ends
        float hy = clamp((vW.y - 0.6)/max(vT.w - 0.6, 0.1), 0.0, 1.0);
        float ends = smoothstep(0.02, 0.2, hy)*(1.0 - smoothstep(0.8, 0.99, hy));
        float a1 = pow(max(dot(normalize(R.xz + 1e-4), normalize(vec2(0.62, 0.78))), 0.0), 26.0);
        float a2 = pow(max(dot(normalize(R.xz + 1e-4), normalize(vec2(-0.85, 0.5))), 0.0), 60.0);
        float streak = (a1*0.34 + a2*0.24)*ends;
        float smudge = smoothstep(0.62, 0.9, fbm(vec3(vW.x*4.0 + vW.z*3.0, vW.y*3.2, vW.z*4.0 - vW.x*3.0)));
        float alpha = 0.035 + fres*0.42 + streak + smudge*0.06;
        vec3 col = vec3(0.62, 0.86, 0.92)*(0.35 + fres) + vec3(1.0)*streak*1.4;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.85));
      }`,
  });
}

// ---------------------------------------------------------------- bubbles and motes
function bubbleMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime, uPx: { value: 700 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aTank;  // cx, cz, rise, R
      attribute vec4 aP;     // phase, speed, size (m), kind (0 bubble, 1 mote)
      attribute float aW;    // wobble (m)
      uniform float uTime, uPx;
      varying float vA; varying float vK; varying float vS;
      void main(){
        float t = fract(uTime*aP.y + aP.x);
        vec3 p = position;
        p.y += t*aTank.z;
        float w = uTime*(1.1 + aP.y*5.0) + aP.x*6.2831;
        p.x += sin(w)*aW*(0.3 + t); p.z += cos(w*0.83)*aW*(0.3 + t);
        vec2 rel = p.xz - aTank.xy; float rl = length(rel), lim = aTank.w - 0.06;
        if (rl > lim) p.xz = aTank.xy + rel*(lim/rl);
        vec4 mv = viewMatrix*vec4(p, 1.0);
        float sz = aP.z*(0.75 + 0.6*t);
        float px = sz*uPx/max(-mv.z, 0.1);
        gl_PointSize = clamp(px, 1.0, 90.0);
        vA = smoothstep(0.0, 0.06, t)*(1.0 - smoothstep(0.93, 1.0, t))*clamp(px*0.55, 0.25, 1.0);
        vK = aP.w; vS = px;
        gl_Position = projectionMatrix*mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vA; varying float vK; varying float vS;
      void main(){
        vec2 uv = gl_PointCoord*2.0 - 1.0;
        float r2 = dot(uv, uv);
        if (r2 > 1.0) discard;
        float r = sqrt(r2);
        if (vK > 0.5) {
          float a = pow(1.0 - r, 2.0)*0.42*vA;
          gl_FragColor = vec4(vec3(0.55, 1.0, 0.72), a);
          return;
        }
        float rim = smoothstep(0.55, 0.92, r)*(1.0 - smoothstep(0.94, 1.0, r));
        float hi = smoothstep(0.42, 0.0, length(uv - vec2(-0.38, 0.42)));
        float hi2 = smoothstep(0.3, 0.0, length(uv - vec2(0.42, -0.4)))*0.4;
        float a = (rim*0.7 + 0.07 + hi*0.95 + hi2)*vA;
        vec3 col = mix(vec3(0.55, 1.0, 0.85), vec3(1.6, 1.8, 1.7), clamp(hi + hi2, 0.0, 1.0));
        gl_FragColor = vec4(col, a);
      }`,
  });
  return m;
}

// ---------------------------------------------------------------- poses (proxy bones, arms down = 0)
const POSES = {
  // a giant adrift: arms out and bent, legs trailing, head bowed
  float: (b) => {
    b.hips.rotation.set(-0.06, 0, 0.03);
    b.spine.rotation.set(0.05, 0, 0);
    b.chest.rotation.set(0.1, 0.04, 0);
    b.neck.rotation.set(0.22, 0, 0.05);
    b.head.rotation.set(0.18, -0.08, 0);
    b.upperArmL.rotation.set(-0.2, 0, 0.82);
    b.foreArmL.rotation.set(-0.55, 0, 0);
    b.handL.rotation.set(0.1, -0.4, 0);
    b.upperArmR.rotation.set(-0.35, 0, -0.66);
    b.foreArmR.rotation.set(-0.8, 0, 0);
    b.handR.rotation.set(0.1, 0.4, 0);
    b.thighL.rotation.set(-0.12, 0, 0.16);
    b.shinL.rotation.set(0.42, 0, 0);
    b.footL.rotation.set(0.55, 0, 0);
    b.thighR.rotation.set(0.14, 0, -0.1);
    b.shinR.rotation.set(0.6, 0, 0);
    b.footR.rotation.set(0.6, 0, 0);
  },
  // hanging limp, arms slack, chin on chest
  limp: (b) => {
    b.hips.rotation.set(0.03, 0, 0);
    b.spine.rotation.set(0.12, 0, 0);
    b.chest.rotation.set(0.16, 0, 0);
    b.neck.rotation.set(0.35, 0, 0);
    b.head.rotation.set(0.25, 0.1, 0);
    b.upperArmL.rotation.set(0.1, 0, 0.32);
    b.foreArmL.rotation.set(-0.3, 0, 0);
    b.handL.rotation.set(0, -0.6, 0.1);
    b.upperArmR.rotation.set(0.12, 0, -0.3);
    b.foreArmR.rotation.set(-0.25, 0, 0);
    b.handR.rotation.set(0, 0.6, -0.1);
    b.thighL.rotation.set(0.05, 0, 0.06);
    b.shinL.rotation.set(0.15, 0, 0);
    b.footL.rotation.set(0.7, 0, 0);
    b.thighR.rotation.set(0.02, 0, -0.06);
    b.shinR.rotation.set(0.2, 0, 0);
    b.footR.rotation.set(0.7, 0, 0);
  },
  // curled up: knees drawn to the chest, arms wrapped round them
  curl: (b) => {
    b.hips.rotation.set(0.35, 0, 0);
    b.spine.rotation.set(0.35, 0, 0);
    b.chest.rotation.set(0.3, 0, 0);
    b.neck.rotation.set(0.4, 0, 0);
    b.head.rotation.set(0.3, 0, 0);
    b.upperArmL.rotation.set(-0.8, 0, 0.1);
    b.foreArmL.rotation.set(-1.7, 0, 0);
    b.handL.rotation.set(0, -0.8, 0);
    b.upperArmR.rotation.set(-0.8, 0, -0.1);
    b.foreArmR.rotation.set(-1.7, 0, 0);
    b.handR.rotation.set(0, 0.8, 0);
    b.thighL.rotation.set(-1.35, 0, 0.12);
    b.shinL.rotation.set(1.9, 0, 0);
    b.footL.rotation.set(0.5, 0, 0);
    b.thighR.rotation.set(-1.3, 0, -0.1);
    b.shinR.rotation.set(1.95, 0, 0);
    b.footR.rotation.set(0.5, 0, 0);
  },
  // one hand flat on the glass, the other slack; leaning toward the viewer
  reach: (b) => {
    b.hips.rotation.set(0.06, 0, 0);
    b.chest.rotation.set(0.14, 0, 0);
    b.neck.rotation.set(0.1, 0, 0);
    b.head.rotation.set(-0.05, 0.1, 0);
    b.upperArmL.rotation.set(-1.35, 0, 0.2);
    b.foreArmL.rotation.set(-0.4, 0, 0);
    b.handL.rotation.set(0, -0.3, 0);
    b.upperArmR.rotation.set(0.1, 0, -0.4);
    b.foreArmR.rotation.set(-0.5, 0, 0);
    b.thighL.rotation.set(-0.3, 0, 0.1);
    b.shinL.rotation.set(0.5, 0, 0);
    b.footL.rotation.set(0.6, 0, 0);
    b.thighR.rotation.set(0.1, 0, -0.1);
    b.shinR.rotation.set(0.4, 0, 0);
    b.footR.rotation.set(0.6, 0, 0);
  },
  // arms up and open, head back: crucified in the fluid
  spread: (b) => {
    b.hips.rotation.set(-0.04, 0, 0);
    b.chest.rotation.set(-0.12, 0, 0);
    b.neck.rotation.set(-0.15, 0, 0);
    b.head.rotation.set(-0.3, 0, 0);
    b.upperArmL.rotation.set(0, 0, 1.75);
    b.foreArmL.rotation.set(-0.2, 0, 0);
    b.upperArmR.rotation.set(0, 0, -1.75);
    b.foreArmR.rotation.set(-0.2, 0, 0);
    b.thighL.rotation.set(0.04, 0, 0.22);
    b.shinL.rotation.set(0.3, 0, 0);
    b.footL.rotation.set(0.6, 0, 0);
    b.thighR.rotation.set(0.0, 0, -0.2);
    b.shinR.rotation.set(0.35, 0, 0);
    b.footR.rotation.set(0.6, 0, 0);
  },
};

const emissivize = (char, color, k) => {
  const mats = new Set();
  char.root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      list.forEach((m) => mats.add(m));
    }
  });
  for (const m of mats) {
    if (!m.emissive) continue;
    m.emissive.set(color);
    if (m.map && !m.emissiveMap) m.emissiveMap = m.map;
    m.emissiveIntensity = k;
    m.needsUpdate = true;
  }
};

// ---------------------------------------------------------------- the builder
/**
 * makeTanks({ group, updates, K, M, U, light }): tank({...}) builds the atrium's big tank, tube({...}) a specimen tube;
 * both draw the hardware into the kit and register the glass / liquid / bubbles / subject; finish() merges the shaders'
 * geometry into the group (call it once, before the level's kit is built).
 */
export function makeTanks({ group, updates, K, M, U, c }) {
  const liq = [], srf = [], gls = [], bub = [];
  const rnd = mulberry(9090);
  const subjects = [];
  const pulse = U.green.clone(); // the tank's own green: the inlay, the nozzles and the status ring breathe slowly
  pulse.emissiveIntensity = 1.1;

  const addCyl = (list, r, y0, y1, cx, cz, seg, open, tank) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, seg, 1, open);
    g.translate(cx, (y0 + y1) / 2, cz);
    tank(g);
    list.push(g);
  };
  const tankAttr = (cx, cz, R, top) => (g) => {
    const n = g.attributes.position.count;
    const a = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) a.set([cx, cz, R, top], i * 4);
    g.setAttribute('aTank', new THREE.BufferAttribute(a, 4));
  };
  const disc = (list, r, y, cx, cz, facing) => {
    const g = new THREE.CircleGeometry(r, 40);
    g.rotateX(facing === 'down' ? Math.PI / 2 : -Math.PI / 2);
    g.translate(cx, y, cz);
    list.push(g);
  };

  /** bubbles + motes + nozzle streams inside one tank */
  const bubbles = ({ x, z, r, y0, y1, n, nozzles = 0, mouth = null, big = 0.055 }) => {
    const rise = y1 - y0;
    const push = (px, py, pz, speed, size, kind, wob, R = r, rs = rise) => bub.push({ px, py, pz, cx: x, cz: z, rise: rs, R, ph: rnd(), speed, size, kind, wob });
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (r - 0.12);
      const big_ = rnd() < 0.14;
      push(x + Math.cos(a) * d, y0, z + Math.sin(a) * d, big_ ? 0.06 + rnd() * 0.05 : 0.09 + rnd() * 0.1, big_ ? big * (0.6 + rnd() * 0.7) : 0.008 + rnd() * 0.02, 0, big_ ? 0.05 : 0.025);
    }
    for (let i = 0; i < n * 0.4; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * (r - 0.1);
      push(x + Math.cos(a) * d, y0 + rnd() * rise * 0.3, z + Math.sin(a) * d, 0.006 + rnd() * 0.012, 0.012 + rnd() * 0.02, 1, 0.18);
    }
    // streams from the floor nozzles: a chain of bubbles each
    for (let k = 0; k < nozzles; k++) {
      const a = (k / nozzles) * Math.PI * 2 + 0.3, d = r * 0.62;
      const sx = x + Math.cos(a) * d, sz = z + Math.sin(a) * d;
      for (let i = 0; i < 12; i++) push(sx, y0 + 0.02, sz, 0.16 + rnd() * 0.05, 0.012 + rnd() * 0.014, 0, 0.012);
    }
    // a stream from the subject's mouth (its vertices follow the head: see the update)
    const from = bub.length;
    if (mouth) for (let i = 0; i < 16; i++) push(mouth[0] + (rnd() - 0.5) * 0.04, mouth[1], mouth[2] + (rnd() - 0.5) * 0.04, 0.1 + rnd() * 0.04, 0.012 + rnd() * 0.018, 0, 0.03, r, y1 - mouth[1]);
    return mouth ? [from, bub.length] : null;
  };

  /** a zombie hanging in the liquid */
  const subject = ({ kind, x, z, y, scale, pose, yaw = 0, tint = 0xb7dcc4, glow = 0x38ffb0, k = 0.32, drift = 1, spin = 0.03 }) => {
    const ch = createCharacter(kind, scale, { tint });
    if (!ch) return null;
    emissivize(ch, glow, k);
    POSES[pose](ch.bones);
    ch.root.position.set(x, y, z);
    ch.root.rotation.y = yaw;
    ch.root.frustumCulled = false;
    ch.root.traverse((o) => (o.frustumCulled = false));
    ch.rig?.sync();
    group.add(ch.root);
    const s = { ch, x, y, z, yaw, drift, spin, scale, ph: rnd() * 6, base: {}, stream: null };
    for (const [n, b] of Object.entries(ch.bones)) s.base[n] = b.rotation.clone();
    subjects.push(s);
    return s;
  };
  const _q = new THREE.Quaternion();
  const mouthOf = (s, out = []) => {
    s.ch.root.updateMatrixWorld(true);
    const v = new THREE.Vector3(0, 0.06 * s.scale, 0.11 * s.scale);
    s.ch.bones.head.getWorldQuaternion(_q);
    v.applyQuaternion(_q).add(s.ch.bones.head.getWorldPosition(new THREE.Vector3()));
    out[0] = v.x; out[1] = v.y; out[2] = v.z;
    return out;
  };

  // ---- the atrium's tank: 5.3 m of steel, glass and green murk
  const tank = ({ x = 0, z = 0, H, R = 1.6 } = {}) => {
    const y0 = 0.62, y1 = 4.62, yl = 4.42; // glass base / top, liquid surface
    // the hardware
    K.cyl(M.dark, x, 0, z, 3.15, 3.15, 0.08, 56);
    K.cyl(M.steel, x, 0.08, z, 2.75, 2.75, 0.22, 56);
    K.cyl(M.dark, x, 0.3, z, 2.45, 2.45, 0.1, 56);
    K.cyl(M.steel, x, 0.4, z, 2.2, 2.2, 0.16, 56);
    // an inlaid ring of light between the steps
    K.cyl(pulse, x, 0.3, z, 2.47, 2.47, 0.035, 64);
    // the base collar under the glass: two flanges with bolt heads
    K.cyl(M.dark, x, 0.56, z, R + 0.32, R + 0.32, 0.06, 48);
    K.cyl(M.steel, x, y0 - 0.06, z, R + 0.18, R + 0.18, 0.06, 48);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      K.cyl(M.dark, x + Math.cos(a) * (R + 0.25), 0.62, z + Math.sin(a) * (R + 0.25), 0.028, 0.028, 0.03, 6);
    }
    // service hatches with gauges round the plinth
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const px = x + Math.cos(a) * 2.2, pz = z + Math.sin(a) * 2.2;
      const yaw = -a + Math.PI / 2;
      K.add(M.dark, new THREE.BoxGeometry(0.62, 0.3, 0.05), x + Math.cos(a) * 2.21, 0.28, z + Math.sin(a) * 2.21, [0, yaw, 0]);
      K.add(M.steel, new THREE.BoxGeometry(0.5, 0.2, 0.02), x + Math.cos(a) * 2.235, 0.28, z + Math.sin(a) * 2.235, [0, yaw, 0]);
      K.add(M.yellow, new THREE.BoxGeometry(0.06, 0.02, 0.03), x + Math.cos(a) * 2.25, 0.34, z + Math.sin(a) * 2.25, [0, yaw, 0]);
      if (i % 2 === 0) K.plane(M.signs, 0.16, 0.16, x + Math.cos(a) * 2.235, 0.55, z + Math.sin(a) * 2.235, [0, -a + Math.PI / 2, 0], SIGN.gauge, 1024, 1024);
      void px; void pz;
    }
    // valve wheels on stubby feed pipes between the hatches
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const vx = x + Math.cos(a) * 2.78, vz = z + Math.sin(a) * 2.78;
      K.add(M.red, new THREE.TorusGeometry(0.12, 0.014, 6, 20), vx, 0.5, vz, [Math.PI / 2 * 0 + 0, -a + Math.PI / 2, 0]);
      K.add(M.steel, new THREE.CylinderGeometry(0.03, 0.03, 0.26, 8), vx, 0.42, vz);
      K.cyl(M.steel, vx, 0.08, vz, 0.075, 0.075, 0.26, 12);
    }
    // the glass, the murk, the floor of the tank (a grating with nozzles), the surface
    const attr = tankAttr(x, z, R - 0.02, yl);
    addCyl(gls, R, y0, y1, x, z, 64, true, tankAttr(x, z, R, y1));
    addCyl(liq, R - 0.04, y0 + 0.06, yl, x, z, 56, true, attr);
    disc(srf, R - 0.04, yl, x, z, 'down');
    disc(srf, R - 0.05, y0 + 0.06, x, z, 'up');
    K.cyl(M.black, x, y0 - 0.02, z, R - 0.03, R - 0.03, 0.08, 40);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      K.cyl(M.steel, x + Math.cos(a) * R * 0.62, y0 + 0.06, z + Math.sin(a) * R * 0.62, 0.07, 0.05, 0.05, 12);
      K.cyl(pulse, x + Math.cos(a) * R * 0.62, y0 + 0.11, z + Math.sin(a) * R * 0.62, 0.034, 0.034, 0.012, 10);
    }
    // steel bands round the glass and four struts
    for (const y of [1.55, 2.6, 3.65]) {
      K.add(M.steel, new THREE.TorusGeometry(R + 0.045, 0.045, 8, 64), x, y, z, [Math.PI / 2, 0, 0]);
      K.add(M.dark, new THREE.TorusGeometry(R + 0.03, 0.02, 6, 64), x, y + 0.1, z, [Math.PI / 2, 0, 0]);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const sx = x + Math.cos(a) * (R + 0.15), sz = z + Math.sin(a) * (R + 0.15);
      K.cyl(M.steel, sx, y0, sz, 0.04, 0.04, y1 - y0, 10);
      for (const y of [1.6, 2.65, 3.7]) K.rod(M.dark, new THREE.Vector3(sx, y + 0.03, sz), new THREE.Vector3(x + Math.cos(a) * (R + 0.03), y + 0.03, z + Math.sin(a) * (R + 0.03)), 0.014, 6);
    }
    // the cap: a flange with bolts, a domed head, the manifold and the feed pipes
    K.cyl(M.steel, x, y1, z, R + 0.24, R + 0.24, 0.1, 56);
    K.cyl(M.dark, x, y1 + 0.1, z, R + 0.14, R + 0.14, 0.05, 56);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      K.cyl(M.dark, x + Math.cos(a) * (R + 0.2), y1 + 0.1, z + Math.sin(a) * (R + 0.2), 0.03, 0.03, 0.035, 6);
    }
    K.cyl(M.steel, x, y1 + 0.15, z, R * 0.86, R * 0.7, 0.32, 40);
    K.add(M.steel, new THREE.SphereGeometry(R * 0.7, 32, 10, 0, Math.PI * 2, 0, Math.PI / 2.4), x, y1 + 0.47, z, null, [1, 0.5, 1]);
    K.cyl(M.dark, x, y1 + 0.7, z, 0.55, 0.62, 0.35, 28);
    K.cyl(M.steel, x, y1 + 1.05, z, 0.42, 0.5, 0.25, 24);
    // status ring on the head
    K.cyl(pulse, x, y1 + 0.32, z, R * 0.78, R * 0.78, 0.025, 48);
    // the feed pipes to the ceiling, alternating colours; two fat ones
    const Hc = H;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const px = x + Math.cos(a) * 0.62, pz = z + Math.sin(a) * 0.62;
      const r = k % 4 === 0 ? 0.11 : 0.07;
      K.cyl(k % 2 ? M.steel : M.blue, px, y1 + 1.2, pz, r, r, Hc - y1 - 1.2, 12);
      K.cyl(M.dark, px, y1 + 1.6, pz, r + 0.02, r + 0.02, 0.06, 12);
      K.cyl(M.dark, px, y1 + 2.05 + (k % 3) * 0.25, pz, r + 0.02, r + 0.02, 0.05, 12);
    }
    K.cyl(M.dark, x, Hc - 0.4, z, 1.05, 1.05, 0.4, 32);
    K.cyl(M.hazard, x, Hc - 0.5, z, 1.1, 1.1, 0.12, 32);
    // cables sagging from the head to the ceiling and out to the trays
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.7;
      const p0 = new THREE.Vector3(x + Math.cos(a) * 0.5, y1 + 1.05, z + Math.sin(a) * 0.5);
      const p1 = new THREE.Vector3(x + Math.cos(a + 0.5) * 1.6, y1 + 0.9 + k * 0.12, z + Math.sin(a + 0.5) * 1.6);
      const p2 = new THREE.Vector3(x + Math.cos(a + 0.7) * 2.6, Hc - 0.7, z + Math.sin(a + 0.7) * 2.6);
      const curve = new THREE.CatmullRomCurve3([p0, p1, p2]);
      K.put(M.black, new THREE.TubeGeometry(curve, 20, 0.035 + (k % 2) * 0.012, 6, false));
    }
    // fat stubs of pipe leaving the ceiling collar horizontally toward the walls: the plant behind this
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      K.rod(k % 2 ? M.steel : M.blue, new THREE.Vector3(x + Math.cos(a) * 1.0, Hc - 0.55, z + Math.sin(a) * 1.0), new THREE.Vector3(x + Math.cos(a) * 6.5, Hc - 0.55, z + Math.sin(a) * 6.5), 0.09, 10);
    }
    // the subject: a Crusher adrift in the murk
    const sc = 1.45;
    const yFeet = (y0 + yl) / 2 - 0.9 * sc + 0.02;
    const s = subject({ kind: 'tank', x, z, y: yFeet, scale: sc, pose: 'float', yaw: 0.6, tint: 0xb8dcc6, glow: 0x2dffa0, k: 1.0, drift: 1, spin: 0.045 });
    const st = bubbles({ x, z, r: R, y0: y0 + 0.1, y1: yl, n: 330, nozzles: 6, mouth: s ? mouthOf(s) : null, big: 0.07 });
    if (s) s.stream = st;
    // the plinth's octagon and the glass: solid
    for (const [a, b] of [[2.75, 1.13], [1.13, 2.75], [2.05, 2.05]]) c.col(x - a, 0, z - b, x + a, y1 + 0.2, z + b, SURF.glass);
    return s;
  };

  // ---- a specimen tube (the hall, the labs): a smaller glass cylinder with a zombie in it
  const tube = ({ x, z, r = 0.6, h = 2.7, kind = 'normal', pose = 'limp', yaw = 0, broken = false, ceil: ceilRel = null, sc = null, floor: B = 0 }) => {
    // (B: the floor it stands on, ceil: its height over that floor)
    const ceil = ceilRel == null ? null : ceilRel + B;
    const y0 = B + 0.4, y1 = y0 + h, yl = y1 - 0.3;
    K.cyl(M.steel, x, B, z, r + 0.14, r + 0.14, 0.18, 32);
    K.cyl(M.dark, x, B + 0.18, z, r + 0.1, r + 0.1, 0.1, 32);
    K.cyl(M.steel, x, B + 0.28, z, r + 0.05, r + 0.05, 0.1, 32);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      K.cyl(M.steel, x + Math.cos(a) * (r + 0.07), y0, z + Math.sin(a) * (r + 0.07), 0.022, 0.022, h, 8);
    }
    K.cyl(M.steel, x, y1, z, r + 0.09, r + 0.09, 0.06, 32);
    K.cyl(M.dark, x, y1 + 0.06, z, r + 0.13, r + 0.13, 0.16, 32);
    K.cyl(M.steel, x, y1 + 0.22, z, r * 0.6, r * 0.7, 0.2, 24);
    // a pressure gauge and a status light on the collar, cables and a pipe up to the ceiling
    K.plane(M.signs, 0.13, 0.13, x + r + 0.02, B + 0.16, z, [0, Math.PI / 2, 0], SIGN.gauge, 1024, 1024);
    K.cyl(pulse, x, B + 0.26, z + r + 0.052, 0.018, 0.018, 0.02, 8, [Math.PI / 2, 0, 0]);
    if (ceil) {
      K.cyl(M.steel, x, y1 + 0.4, z, 0.05, 0.05, ceil - y1 - 0.4, 10);
      K.cyl(M.blue, x + 0.14, y1 + 0.3, z + 0.05, 0.028, 0.028, ceil - y1 - 0.3, 8);
    } else {
      K.cyl(M.dark, x, y1 + 0.4, z, 0.045, 0.045, 0.7, 8);
    }
    if (!broken) {
      addCyl(gls, r, y0, y1, x, z, 40, true, tankAttr(x, z, r, y1));
      addCyl(liq, r - 0.03, y0 + 0.05, yl, x, z, 32, true, tankAttr(x, z, r - 0.02, yl));
      disc(srf, r - 0.03, yl, x, z, 'down');
      disc(srf, r - 0.04, y0 + 0.05, x, z, 'up');
      K.cyl(M.black, x, y0 - 0.02, z, r - 0.02, r - 0.02, 0.08, 24);
      const scale = sc ?? Math.min(1.0, (h * 0.66) / 1.85);
      const s = subject({ kind, x, z, y: y0 + h * 0.5 - 0.98 * scale - 0.1, scale, pose, yaw, tint: 0xb4d4be, glow: 0x30f59a, k: 0.34, drift: 0.7, spin: 0.02 });
      const st = bubbles({ x, z, r, y0: y0 + 0.08, y1: yl, n: 70, nozzles: 2, mouth: s ? mouthOf(s) : null, big: 0.03 });
      if (s) s.stream = st;
      c.light(x, y0 + h * 0.5, z, 0.55, 1.8, [0.3, 1.0, 0.5], null, 4.5);
      c.col(x - r - 0.14, B, z - r - 0.14, x + r + 0.14, y1 + 0.6, z + r + 0.14, SURF.glass);
    } else {
      // smashed: jagged shards leaning at the base, the murk drained across the floor, the body gone (or slumped)
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + rnd() * 0.3;
        K.add(U.glass, new THREE.ConeGeometry(0.05 + rnd() * 0.04, 0.3 + rnd() * 0.7, 3), x + Math.cos(a) * r, y0 + 0.2 + rnd() * 0.15, z + Math.sin(a) * r, [(rnd() - 0.5) * 0.4, a, (rnd() - 0.5) * 0.3]);
      }
      const g = new THREE.CircleGeometry(r * 3.0, 28);
      g.rotateX(-Math.PI / 2);
      g.translate(x + 0.5, B + 0.006, z + 0.35);
      K.put(U.murk, g);
      c.col(x - r - 0.14, B, z - r - 0.14, x + r + 0.14, B + 0.45, z + r + 0.14, SURF.metal);
    }
  };

  const finish = () => {
    let posAttr = null;
    const mk = (list, mat, order, extra) => {
      if (!list.length) return null;
      const g = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = order;
      mesh.frustumCulled = false;
      mesh.matrixAutoUpdate = false;
      if (extra) extra(mesh);
      group.add(mesh);
      return mesh;
    };
    for (const g of [...liq, ...gls]) if (!g.attributes.aTank) tankAttr(0, 0, 1, 1)(g);
    // the surfaces need no tank data
    mk(liq, liquidMaterial(), 4);
    mk(srf, surfaceMaterial(), 5);
    if (bub.length) {
      const n = bub.length;
      const pos = new Float32Array(n * 3), tk = new Float32Array(n * 4), p = new Float32Array(n * 4), w = new Float32Array(n);
      bub.forEach((b, i) => {
        pos.set([b.px, b.py, b.pz], i * 3);
        tk.set([b.cx, b.cz, b.rise, b.R], i * 4);
        p.set([b.ph, b.speed, b.size, b.kind], i * 4);
        w[i] = b.wob;
      });
      const g = new THREE.BufferGeometry();
      posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', posAttr);
      g.setAttribute('aTank', new THREE.BufferAttribute(tk, 4));
      g.setAttribute('aP', new THREE.BufferAttribute(p, 4));
      g.setAttribute('aW', new THREE.BufferAttribute(w, 1));
      const mat = bubbleMaterial();
      const pts = new THREE.Points(g, mat);
      pts.renderOrder = 6;
      pts.frustumCulled = false;
      pts.onBeforeRender = (renderer, scene, camera) => {
        const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
        mat.uniforms.uPx.value = h * 0.5 * camera.projectionMatrix.elements[5];
      };
      group.add(pts);
    }
    mk(gls, glassMaterial(), 7);
    // the animation: the subjects drift, the shaders run on time
    let t = 0;
    const mouthTmp = [];
    for (const s of subjects) if (s.stream) s.jit = Array.from({ length: (s.stream[1] - s.stream[0]) * 2 }, () => (rnd() - 0.5) * 0.04);
    updates.push((dt) => {
      t += dt;
      uTime.value = t;
      pulse.emissiveIntensity = 0.9 + 0.45 * Math.sin(t * 0.8);
      for (const s of subjects) {
        const { ch } = s;
        const w = t * 0.5 + s.ph;
        ch.root.position.y = s.y + Math.sin(w * 0.9) * 0.07 * s.drift;
        ch.root.rotation.y = s.yaw + t * s.spin;
        for (const n of ['upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'thighL', 'thighR', 'head', 'chest', 'hips']) {
          const b = ch.bones[n], base = s.base[n];
          if (!b || !base) continue;
          const k = (n.length + s.ph) * 1.3;
          b.rotation.set(base.x + Math.sin(w * 0.8 + k) * 0.05 * s.drift, base.y + Math.sin(w * 0.6 + k * 0.7) * 0.03 * s.drift, base.z + Math.sin(w * 0.7 + k * 1.3) * 0.06 * s.drift);
        }
        ch.rig?.sync();
        if (s.stream && posAttr) {
          const m = mouthOf(s, mouthTmp);
          for (let i = s.stream[0]; i < s.stream[1]; i++) posAttr.setXYZ(i, m[0] + s.jit[(i - s.stream[0]) * 2], m[1], m[2] + s.jit[(i - s.stream[0]) * 2 + 1]);
          posAttr.needsUpdate = true;
        }
      }
    });
  };

  return { tank, tube, finish };
}

// a caustics disc: light rippling on the floor round a lit tank (additive)
export function causticsDisc(x, z, R = 6, color = [0.16, 0.85, 0.5], y = 0.012) {
  const g = new THREE.CircleGeometry(R, 64);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime, uC: { value: new THREE.Vector3(...color) }, uR: { value: R }, uO: { value: new THREE.Vector2(x, z) } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
    vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uR; uniform vec3 uC; uniform vec2 uO; varying vec3 vW;
      float caustic(vec2 p, float t){
        vec2 i = p; float c = 1.0; float inten = 0.005;
        for (int n = 0; n < 4; n++) {
          float tt = t*(1.0 - 3.5/float(n+1));
          i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
          c += 1.0/length(vec2(p.x/(sin(i.x + tt)/inten), p.y/(cos(i.y + tt)/inten)));
        }
        c /= 4.0; c = clamp(1.17 - pow(max(c, 0.0), 1.4), 0.0, 1.2);
        return pow(c, 8.0);
      }
      void main(){
        vec2 q = vW.xz - uO;
        float r = length(q)/uR;
        float fall = pow(1.0 - clamp(r, 0.0, 1.0), 2.0)*smoothstep(0.32, 0.5, r);
        float c = caustic(q*0.9, uTime*0.55 + 23.0);
        gl_FragColor = vec4(uC*c*fall*0.9, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

// a floor inlay round the atrium tank: steel grating, hazard ring, guide marks (a CanvasTexture for a RingGeometry: planar uv)
export function tankFloorTexture() {
  const rnd = mulberry(77);
  return texOf(canvas(1024, 1024, (g, w, h) => {
    const cx = w / 2, cy = h / 2, S = w / 2; // radius 6.4 m == S px
    g.fillStyle = '#5b6368';
    g.fillRect(0, 0, w, h);
    speckle(g, w, h, rnd, 16000, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.14)'], 2);
    const ring = (r0, r1, fill) => {
      g.beginPath();
      g.arc(cx, cy, (r1 / 6.4) * S, 0, Math.PI * 2);
      g.arc(cx, cy, (r0 / 6.4) * S, 0, Math.PI * 2, true);
      g.fillStyle = fill;
      g.fill('evenodd');
    };
    ring(3.15, 4.7, '#2b3034');
    // the grating: a lattice inside the ring
    g.save();
    g.beginPath();
    g.arc(cx, cy, (4.7 / 6.4) * S, 0, Math.PI * 2);
    g.arc(cx, cy, (3.15 / 6.4) * S, 0, Math.PI * 2, true);
    g.clip('evenodd');
    g.fillStyle = '#0d1011';
    for (let y = 0; y < h; y += 14) for (let x = 0; x < w; x += 14) g.fillRect(x + 2, y + 2, 10, 10);
    g.restore();
    ring(3.1, 3.2, '#a9b0b6');
    ring(4.66, 4.76, '#a9b0b6');
    // hazard band
    g.save();
    g.beginPath();
    g.arc(cx, cy, (5.3 / 6.4) * S, 0, Math.PI * 2);
    g.arc(cx, cy, (5.0 / 6.4) * S, 0, Math.PI * 2, true);
    g.clip('evenodd');
    g.fillStyle = '#d6a31a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181a';
    for (let a = 0; a < 72; a++) {
      g.beginPath();
      const a0 = (a / 72) * Math.PI * 2, a1 = ((a + 0.5) / 72) * Math.PI * 2;
      g.moveTo(cx + Math.cos(a0) * S * 0.7, cy + Math.sin(a0) * S * 0.7);
      g.lineTo(cx + Math.cos(a0 + 0.05) * S, cy + Math.sin(a0 + 0.05) * S);
      g.lineTo(cx + Math.cos(a1 + 0.05) * S, cy + Math.sin(a1 + 0.05) * S);
      g.lineTo(cx + Math.cos(a1) * S * 0.7, cy + Math.sin(a1) * S * 0.7);
      g.fill();
    }
    g.restore();
    // wear: the yellow is scuffed, the whole thing is dirty
    for (let i = 0; i < 600; i++) {
      const a = rnd() * Math.PI * 2, r = (5.0 + rnd() * 0.3) / 6.4 * S;
      g.fillStyle = `rgba(30,32,30,${0.15 + rnd() * 0.3})`;
      g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2 + rnd() * 6, 2 + rnd() * 3);
    }
    // ticks
    g.strokeStyle = 'rgba(230,235,238,0.55)';
    g.lineWidth = 2;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const r0 = (5.5 / 6.4) * S, r1 = ((i % 4 ? 5.65 : 5.85) / 6.4) * S;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    // grime toward the outside
    const grd = g.createRadialGradient(cx, cy, S * 0.7, cx, cy, S);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(20,24,26,0.55)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  }), true);
}
