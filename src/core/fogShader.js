// Global fog override: distance haze + thick, animated, ground-hugging toxic fog
// that only accumulates along the part of the view ray that lies OUTSIDE the buildings (the house and
// the barn: a short list of xz "inside" rects, one cheap slab test each).
//
// A THREE.Fog instance is used as a uniform carrier (refreshed by three.js for every material):
//   fog.color -> fog color, fog.near -> time (seconds), fog.far -> outside fog density.
// labRect (minX, minZ, maxX, maxZ): the lab behind the basement's south wall (src/world/lab.js) reaches
// under the front yard; a point in it seen from below ground gets no yard fog.
import * as THREE from 'three';
import { HOUSE_FOG_RECT, BARN_INSIDE } from '../world/ranchLayout.js';

let installed = false;

/**
 * insideRects (must not overlap): axis-aligned [minX, minZ, maxX, maxZ], or oriented { x, z, cos, sin, hx, hz }
 * (centre, rotation, half extents: the turned barn) - both ends of the view ray go into its frame first
 * (the xz length inside is rotation invariant). A single rect is fine too.
 */
export function installFogShader(insideRects = [HOUSE_FOG_RECT, BARN_INSIDE], labRect = [-12.5, 3.8, 2.9, 19.6]) {
  if (installed) return;
  installed = true;
  const rects = typeof insideRects[0] === 'number' ? [insideRects] : insideRects;
  const f = (v) => v.toFixed(4);
  const insideSum = rects
    .map((r) => {
      if (Array.isArray(r)) return `cfInsideLen(cfC.xz, cfP.xz, vec4(${r.map(f).join(', ')}))`;
      const to = (p) => `cfFrame(${p}, vec2(${f(r.x)}, ${f(r.z)}), vec2(${f(r.cos)}, ${f(r.sin)}))`;
      return `cfInsideLen(${to('cfC.xz')}, ${to('cfP.xz')}, vec4(${f(-r.hx)}, ${f(-r.hz)}, ${f(r.hx)}, ${f(r.hz)}))`;
    })
    .join(' + ');
  const U = labRect.map((v) => v.toFixed(2));

  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif
`;

  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);
#endif
`;

  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float cfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float cfNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(cfHash(i), cfHash(i + vec2(1.0, 0.0)), f.x),
               mix(cfHash(i + vec2(0.0, 1.0)), cfHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // a point in an oriented rect's frame (c = centre, cs = (cos, sin) of its rotation.y)
  vec2 cfFrame(vec2 p, vec2 c, vec2 cs) {
    vec2 d = p - c;
    return vec2(cs.x * d.x - cs.y * d.y, cs.y * d.x + cs.x * d.y);
  }
  // length (in xz) of segment a->b that lies inside rect r = (minX, minZ, maxX, maxZ)
  float cfInsideLen(vec2 a, vec2 b, vec4 r) {
    vec2 d = b - a;
    vec2 inv = 1.0 / max(abs(d), vec2(1e-5)) * sign(d + 1e-9);
    vec2 t0 = (r.xy - a) * inv;
    vec2 t1 = (r.zw - a) * inv;
    vec2 tmin = min(t0, t1);
    vec2 tmax = max(t0, t1);
    float tn = max(max(tmin.x, tmin.y), 0.0);
    float tf = min(min(tmax.x, tmax.y), 1.0);
    return max(tf - tn, 0.0) * length(d);
  }
#endif
`;

  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  {
    vec3 cfP = vFogWorldPos;
    vec3 cfC = cameraPosition;
    float cfDist = length(cfP - cfC);
    #ifdef FOG_EXP2
      float cfDens = fogDensity * cfDist;
    #else
      float cfTime = fogNear;
      float cfOut = fogFar;
      float lenXZ = max(length(cfP.xz - cfC.xz), 1e-4);
      float insideXZ = ${insideSum};
      float outsideFrac = clamp(1.0 - insideXZ / lenXZ, 0.0, 1.0);
      // underground lab: camera and point both below ground, the point inside the lab rect
      if (cfC.y < -0.8 && cfP.y < -0.8 && cfP.x > ${U[0]} && cfP.x < ${U[2]} && cfP.z > ${U[1]} && cfP.z < ${U[3]}) outsideFrac = 0.0;
      float outsideDist = cfDist * outsideFrac;
      // fog hugs the ground (yard at y = -0.5)
      float hA = max(cfP.y + 0.5, 0.0);
      float hB = max(clamp(cfC.y, -0.5, 8.0) + 0.5, 0.0);
      float hf = mix(exp(-hA * 0.22), exp(-hB * 0.22), 0.35);
      vec2 q = cfP.xz * 0.07 + vec2(cfTime * 0.035, cfTime * 0.012);
      float n = cfNoise(q) * 0.55 + cfNoise(q * 3.1 - cfTime * 0.05) * 0.3 + cfNoise(q * 8.3 + cfTime * 0.08) * 0.15;
      float cfDens = 0.006 * cfDist + cfOut * outsideDist * (0.45 + 0.9 * n) * (0.3 + 0.7 * hf);
    #endif
    float fogFactor = 1.0 - exp(-cfDens);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  }
#endif
`;
}
