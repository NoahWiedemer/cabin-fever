// Global fog override: distance haze + thick, animated, ground-hugging toxic fog
// that only accumulates along the part of the view ray that lies OUTSIDE the house.
//
// A THREE.Fog instance is used as a uniform carrier (refreshed by three.js for every material):
//   fog.color -> fog color, fog.near -> time (seconds), fog.far -> outside fog density.
import * as THREE from 'three';

let installed = false;

export function installFogShader(houseRect = [-12.3, -8.3, 12.3, 8.3]) {
  if (installed) return;
  installed = true;
  const R = houseRect.map((v) => v.toFixed(2));

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
      float insideXZ = cfInsideLen(cfC.xz, cfP.xz, vec4(${R[0]}, ${R[1]}, ${R[2]}, ${R[3]}));
      float outsideFrac = clamp(1.0 - insideXZ / lenXZ, 0.0, 1.0);
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
