// WebGL renderer + post-processing stack (N8AO, bloom, AgX, color grade, SMAA)
// with a separate depth-cleared pass for the first-person viewmodel (layer 1).
import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  Effect,
  BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export const VIEWMODEL_LAYER = 1;

const gradeFrag = /* glsl */ `
uniform float uTime;
uniform float uDamage;
uniform float uGas;
uniform float uLowHp;
uniform float uFlash;
uniform float uVignette;
uniform float uGrain;
uniform float uSaturation;
uniform float uContrast;
uniform float uExposure;
uniform float uDead;

float gHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = inputColor.rgb * uExposure;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sat = uSaturation * (1.0 - 0.65 * uLowHp) * (1.0 - uDead);
  c = mix(vec3(l), c, sat);
  // split toning: cold teal shadows, warm highlights
  vec3 shadowTint = vec3(0.90, 1.0, 1.08);
  vec3 highTint = vec3(1.07, 1.0, 0.90);
  c *= mix(shadowTint, highTint, smoothstep(0.04, 0.55, l));
  c = max(vec3(0.0), (c - 0.18) * uContrast + 0.18);
  vec2 d = uv - 0.5;
  d.x *= 1.25;
  float r2 = dot(d, d);
  c *= 1.0 - uVignette * smoothstep(0.06, 0.62, r2 * 1.6);
  // damage & low health edges
  float edge = smoothstep(0.08, 0.55, r2 * 2.0);
  float pulse = 0.75 + 0.25 * sin(uTime * 7.0);
  c = mix(c, vec3(0.32, 0.0, 0.0), clamp(edge * (uDamage + uLowHp * 0.55 * pulse), 0.0, 0.92));
  // toxic gas: sickly green tint and haze toward the edges
  vec3 gasCol = c * vec3(0.72, 1.0, 0.66) + vec3(0.015, 0.05, 0.02);
  c = mix(c, gasCol, uGas);
  c = mix(c, vec3(0.05, 0.1, 0.05), uGas * edge * 0.6);
  // screen flash (explosions / lightning)
  c += vec3(1.0, 0.95, 0.9) * uFlash;
  // film grain
  float g = gHash(uv * 1733.0 + fract(uTime * 13.7)) - 0.5;
  c += g * uGrain * (0.6 + 0.4 * (1.0 - l));
  outputColor = vec4(c, inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeFrag, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map([
        ['uTime', new THREE.Uniform(0)],
        ['uDamage', new THREE.Uniform(0)],
        ['uGas', new THREE.Uniform(0)],
        ['uLowHp', new THREE.Uniform(0)],
        ['uFlash', new THREE.Uniform(0)],
        ['uVignette', new THREE.Uniform(0.55)],
        ['uGrain', new THREE.Uniform(0.016)],
        ['uSaturation', new THREE.Uniform(0.92)],
        ['uContrast', new THREE.Uniform(1.08)],
        ['uExposure', new THREE.Uniform(1.4)],
        ['uDead', new THREE.Uniform(0)],
      ]),
    });
  }
  set(name, v) {
    this.uniforms.get(name).value = v;
  }
}

export const QUALITY = {
  low: { pixelRatio: 0.75, ao: false, aoHalf: true, shadowSize: 512, moonShadow: 1024, spotShadows: 2, bloom: true, smaa: false, maxZombies: 18 },
  medium: { pixelRatio: 1.0, ao: true, aoHalf: true, shadowSize: 1024, moonShadow: 2048, spotShadows: 3, bloom: true, smaa: true, maxZombies: 24 },
  high: { pixelRatio: 1.0, ao: true, aoHalf: false, shadowSize: 1024, moonShadow: 2048, spotShadows: 4, bloom: true, smaa: true, maxZombies: 28 },
  ultra: { pixelRatio: 1.5, ao: true, aoHalf: false, shadowSize: 2048, moonShadow: 4096, spotShadows: 4, bloom: true, smaa: true, maxZombies: 32 },
};

export class GameRenderer {
  constructor(container, qualityName = 'high') {
    this.container = container;
    this.qualityName = qualityName;
    this.q = QUALITY[qualityName] || QUALITY.high;
    const r = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;
    this.renderer = r;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.05, 300);
    this.vmCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.vmCamera.layers.set(VIEWMODEL_LAYER);
    this.worldFov = 80;
    this.vmFov = 58;

    this.composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);

    this.aoPass = new N8AOPostPass(this.scene, this.camera, 1, 1);
    const c = this.aoPass.configuration;
    c.aoRadius = 0.9;
    c.distanceFalloff = 1.0;
    c.intensity = 1.35;
    c.aoSamples = 16;
    c.denoiseSamples = 8;
    c.denoiseRadius = 10;
    c.halfRes = this.q.aoHalf;
    c.depthAwareUpsampling = true;
    c.gammaCorrection = false;
    this.aoPass.enabled = this.q.ao;
    this.composer.addPass(this.aoPass);

    this.vmPass = new RenderPass(this.scene, this.vmCamera);
    this.vmPass.clearPass.setClearFlags(false, true, false);
    this.vmPass.ignoreBackground = true;
    this.vmPass.skipShadowMapUpdate = true;
    this.composer.addPass(this.vmPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.9,
      luminanceSmoothing: 0.35,
      intensity: 1.35,
      radius: 0.72,
      levels: 7,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new GradeEffect();
    this.effectPass = new EffectPass(this.camera, this.bloom, this.tone, this.grade);
    this.composer.addPass(this.effectPass);
    this.smaaPass = new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH }));
    this.smaaPass.enabled = this.q.smaa;
    this.composer.addPass(this.smaaPass);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name] || QUALITY.high;
    this.aoPass.enabled = this.q.ao;
    this.aoPass.configuration.halfRes = this.q.aoHalf;
    this.smaaPass.enabled = this.q.smaa;
    this.resize();
  }

  setFov(fov) {
    this.worldFov = fov;
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  syncViewmodelCamera() {
    this.vmCamera.position.copy(this.camera.position);
    this.vmCamera.quaternion.copy(this.camera.quaternion);
    this.vmCamera.updateMatrixWorld(true);
  }

  render(dt) {
    this.renderer.info.reset();
    this.syncViewmodelCamera();
    this.composer.render(dt);
  }
}
