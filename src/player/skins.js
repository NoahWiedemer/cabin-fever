// Weapon camos (game/progress.js WEAPON_SKINS, unlocked by weapon mastery): a pattern painted over the gun's own
// materials. The camo is projected triplanar in the model's own space (no UVs needed, so the GLB guns and the
// procedural ones take it alike) and multiplied by the original's brightness, so edges, wear and detail still
// read through it; gold turns the metal to polished gold. Glass, sights, lights, brass and the arms keep theirs.
// applyWeaponSkin(root, skinId): the viewmodel calls it on equip (player/viewmodel.js).
import * as THREE from 'three';

const PALETTES = {
  woodland: { kind: 'blotch', base: '#4a5232', spots: ['#2a2a1c', '#6e6a44', '#1c1a12', '#3c4a28'], mix: 0.86, metal: 0.25, rough: 0.7 },
  urban: { kind: 'digital', base: '#6c7075', spots: ['#393c40', '#9a9ea3', '#23262a', '#80858a'], mix: 0.86, metal: 0.3, rough: 0.62 },
  tiger: { kind: 'stripes', base: '#bca479', spots: ['#5a4428', '#8a6c40', '#2e2216'], mix: 0.86, metal: 0.2, rough: 0.66 },
  crimson: { kind: 'blotch', base: '#6a0f0e', spots: ['#240505', '#a3201a', '#3b0808', '#140303'], mix: 0.9, metal: 0.35, rough: 0.5 },
  gold: { kind: 'gold', base: '#f0c060', spots: [], mix: 0.95, metal: 0.6, rough: 0.3 },
};

// materials a camo never touches (by name), besides transparent / unlit / glowing ones
const KEEP = /glass|lens|scope|sight|optic|reticle|holo|tritium|dot|laser|light|lamp|brass|shell|hole|edge|blade|steel|sleeve|glove|skin|arm|hand|white|yellow|gold|flame|fire/i;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TEX = {};
function camoTexture(id) {
  if (TEX[id]) return TEX[id];
  const P = PALETTES[id];
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(id.length * 977 + 13);
  g.fillStyle = P.base;
  g.fillRect(0, 0, S, S);
  // everything is drawn wrapped (at x/y and one tile over) so the pattern tiles seamlessly
  const wrap = (fn) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(ox, oy);
  };
  if (P.kind === 'blotch') {
    for (const col of P.spots) {
      g.fillStyle = col;
      for (let k = 0; k < 11; k++) {
        const x = r() * S, y = r() * S, R = 14 + r() * 26;
        const lobes = Array.from({ length: 5 }, () => [r() * 1.6 - 0.8, r() * 1.6 - 0.8, 0.45 + r() * 0.6, 0.6 + r() * 0.5, r() * Math.PI]);
        wrap((ox, oy) => {
          for (const [dx, dy, s, sy, rot] of lobes) {
            g.beginPath();
            g.ellipse(x + ox + dx * R, y + oy + dy * R, R * s, R * s * sy, rot, 0, Math.PI * 2);
            g.fill();
          }
        });
      }
    }
  } else if (P.kind === 'digital') {
    const px = 8;
    for (const col of P.spots) {
      g.fillStyle = col;
      for (let k = 0; k < 26; k++) {
        let x = Math.floor((r() * S) / px), y = Math.floor((r() * S) / px);
        const n = 6 + Math.floor(r() * 14);
        for (let j = 0; j < n; j++) {
          wrap((ox, oy) => g.fillRect(x * px + ox, y * px + oy, px, px));
          if (r() < 0.5) x += r() < 0.5 ? 1 : -1;
          else y += r() < 0.5 ? 1 : -1;
        }
      }
    }
  } else if (P.kind === 'stripes') {
    for (const col of P.spots) {
      g.fillStyle = col;
      for (let k = 0; k < 9; k++) {
        const y = r() * S, th = 5 + r() * 9, len = 60 + r() * 120, x0 = r() * S;
        wrap((ox, oy) => {
          g.beginPath();
          g.moveTo(x0 + ox, y + oy);
          for (let t = 0; t <= 1.001; t += 0.1) g.lineTo(x0 + ox + t * len, y + oy + Math.sin(t * 5 + k) * 10 - th * Math.sin(Math.PI * t));
          for (let t = 1; t >= -0.001; t -= 0.1) g.lineTo(x0 + ox + t * len, y + oy + Math.sin(t * 5 + k) * 10 + th * Math.sin(Math.PI * t));
          g.closePath();
          g.fill();
        });
      }
    }
  } else {
    // gold: a faint brushed grain
    for (let k = 0; k < 1400; k++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,240,180,0.08)' : 'rgba(120,70,10,0.08)';
      g.fillRect(r() * S, r() * S, 12 + r() * 40, 1);
    }
  }
  // a little wear and grime over the top
  for (let k = 0; k < 600; k++) {
    g.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.05)';
    g.fillRect(r() * S, r() * S, 1 + r() * 3, 1 + r() * 3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return (TEX[id] = t);
}

const MATS = new Map(); // base material uuid + skin -> the skinned clone

function skinned(base, id) {
  const key = base.uuid + '|' + id;
  let m = MATS.get(key);
  if (m) return m;
  const P = PALETTES[id];
  m = base.clone();
  m.name = (base.name || 'mat') + '|' + id;
  m.metalness = P.metal;
  m.roughness = P.rough;
  const tex = camoTexture(id);
  const mix = P.mix;
  const scale = 7.5; // pattern repeats per model unit (metres)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uCamo = { value: tex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCamoP;\nvarying vec3 vCamoN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamoP = position;\nvCamoN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uCamo;\nvarying vec3 vCamoP;\nvarying vec3 vCamoN;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 cw = abs(normalize(vCamoN));
          cw = pow(cw, vec3(4.0));
          cw /= (cw.x + cw.y + cw.z + 1e-4);
          vec3 cp = vCamoP * ${scale.toFixed(2)};
          vec3 cc = texture2D(uCamo, cp.zy).rgb * cw.x + texture2D(uCamo, cp.xz).rgb * cw.y + texture2D(uCamo, cp.xy).rgb * cw.z;
          float cl = clamp(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)) * 3.2, 0.25, 1.35);
          diffuseColor.rgb = mix(diffuseColor.rgb, cc * cl, ${mix.toFixed(2)});
        }`
      );
  };
  m.customProgramCacheKey = () => 'camo-' + id;
  MATS.set(key, m);
  return m;
}

function eligible(mat) {
  if (!mat || mat.isMeshBasicMaterial || mat.transparent || !mat.isMeshStandardMaterial) return false;
  if (mat.emissive && mat.emissive.r + mat.emissive.g + mat.emissive.b > 0.3 && (mat.emissiveIntensity ?? 1) > 0.2) return false;
  return !KEEP.test(mat.name || '');
}

/** put camo `id` ('factory' = the gun's own finish) on the weapon model under `root` */
export function applyWeaponSkin(root, id = 'factory') {
  if (!root || root.userData.skin === id) return;
  root.userData.skin = id;
  const on = id !== 'factory' && PALETTES[id];
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const base = (o.userData.baseMat ??= o.material);
    if (Array.isArray(base)) {
      o.material = on ? base.map((b) => (eligible(b) ? skinned(b, id) : b)) : base;
      return;
    }
    o.material = on && eligible(base) ? skinned(base, id) : base;
  });
}

/** a little swatch of camo `id` (a canvas data URL) for the career screen */
export function skinSwatch(id) {
  if (!PALETTES[id]) return null;
  return camoTexture(id).image.toDataURL();
}
