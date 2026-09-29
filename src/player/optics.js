// Weapon optics, bought per gun in the store (game/shop.js OPTICS row) and mounted on its top rail:
//   reddot: a tube sight: you aim through it at a lit dot on the sight line, a little more zoom than the irons
//   acog:   a 3x prism scope; aiming all the way goes to a full-screen scope view (ui/hud.js setScope 'acog')
// A gun takes optics if its model says where its rail is: `rail` = { z0, z1 } (model root space: the rail's
// extent along -Z; the rail top is found under it), optional `x` (a side-mounted rail's centre), `sightY` (the
// iron sight line: the optic's axis sits a little above it, lower-third co-witness), `irons` (objects hidden while
// an optic is on, e.g. a flip-up rear sight). opticDef() adds the optic's handling to a weapon def.
import * as THREE from 'three';
import { gunKit } from './gunModels.js';

const K = gunKit;
const PI = Math.PI;
const V3 = THREE.Vector3;

export const OPTICS = {
  reddot: { name: 'RED DOT', price: 450, zoom: 1.6, adsTime: 0.02, spreadAds: 0.85, eyeBack: 0.1, minH: 0.028, len: 0.07 },
  acog: { name: '3× SCOPE', price: 950, zoom: 3.2, adsTime: 0.07, spreadAds: 0.6, eyeBack: 0.06, minH: 0.032, len: 0.155, scope: 'acog', moveMul: 0.96 },
};
export const OPTIC_KEYS = Object.keys(OPTICS);

// ------------------------------------------------------------------ handling
const _defs = new WeakMap(); // base def -> { kind: def }

/** A weapon def with optic `kind` on it (cached per def object, so the same def comes back every frame). */
export function opticDef(def, kind) {
  const O = kind && OPTICS[kind];
  if (!def || !O) return def;
  let c = _defs.get(def);
  if (!c) _defs.set(def, (c = {}));
  return (c[kind] ??= {
    ...def,
    optic: kind,
    adsZoom: Math.max(def.adsZoom ?? 1, O.zoom),
    adsTime: (def.adsTime ?? 0.18) + O.adsTime,
    spreadAds: (def.spreadAds ?? 0.2) * O.spreadAds,
    moveMul: (def.moveMul ?? 1) * (O.moveMul ?? 1),
    scope: O.scope ?? def.scope,
  });
}

/** The optics each gun with a rail takes (the store offers these; its model defines the rail itself). */
export const RAILED = new Map([
  ['m4a1', ['reddot', 'acog']],
  ['r201', ['reddot', 'acog']],
  ['devotion', ['reddot', 'acog']],
  ['g36c', ['reddot', 'acog']],
  ['ak47', ['reddot', 'acog']],
  ['m4super90', ['reddot']], // (a 3x scope on a shotgun: no)
]);

// ------------------------------------------------------------------ models
// Optic space: the mount's foot on the rail top at the origin, the optical axis along -Z at height h, centred on x.

function dotMaterial() {
  // HDR red (not tone mapped): the bloom pass gives it the glow of a lit LED
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 0.35, 0.15), toneMapped: false, fog: false });
}

// the red dot's objective: a faint blue-grey coating, hardly there (the kit's clear glass tints it green)
let _tint = null;
const tintMaterial = () =>
  (_tint ??= new THREE.MeshBasicMaterial({ color: 0x9cc6e8, transparent: true, opacity: 0.07, depthWrite: false, fog: false, name: 'gm_opticLens' }));

/** a picatinny clamp + riser from the rail top (y = 0) up to `top`, `len` long, centred on z = zc */
function mountBlock(B, top, len, zc, w = 0.024) {
  const foot = 0.0075;
  B.add('anod', K.cbox(w, foot, len, 0.0012, [0, foot / 2, zc]));
  const rh = top - foot;
  if (rh > 0.002) B.add('anod', K.cbox(w * 0.72, rh + 0.001, len * 0.82, 0.0015, [0, foot + rh / 2, zc]));
  // the cross-bolt that clamps it to the rail, its knurled nut on the right
  B.add('steel', K.xf(K.cyl(0.0022, w + 0.008, 12, 0.0004), [0, 0.0038, zc - len * 0.18], [0, PI / 2, 0]), new THREE.Color(0x6c6f74));
  B.add('park', K.xf(K.cyl(0.0052, 0.004, 14, 0.0008), [w / 2 + 0.005, 0.0038, zc - len * 0.18], [0, PI / 2, 0]));
}

function buildRedDot(h) {
  const g = K.grp('optic_reddot');
  const B = new K.PB();
  const R = 0.0168, RI = 0.0126, L = 0.058;
  mountBlock(B, h - R + 0.002, 0.04, 0.004);
  // the tube: body, a sunshade hood at the front, the eyepiece ring at the back
  B.add('anod', K.xf(K.tube(R, RI, L, 32, 0.0012), [0, h, 0]));
  B.add('anod', K.xf(K.tube(R + 0.0005, RI + 0.0008, 0.012, 32, 0.001), [0, h, -L / 2 - 0.005]));
  B.add('park', K.xf(K.tube(R - 0.0006, RI + 0.0004, 0.005, 32, 0.0008), [0, h, L / 2 + 0.0025]));
  // turrets: elevation on top, windage on the right, the battery cap on the left
  B.add('park', K.xf(K.cyl(0.0074, 0.012, 20, 0.0012), [0, h + R + 0.004, 0.006], [PI / 2, 0, 0]));
  B.add('park', K.xf(K.cyl(0.0074, 0.012, 20, 0.0012), [R + 0.004, h, 0.006], [0, PI / 2, 0]));
  B.add('park', K.xf(K.cyl(0.0069, 0.013, 20, 0.0012), [-R - 0.0045, h, 0.006], [0, PI / 2, 0]));
  B.add('park', K.xf(K.torus(0.0062, 0.0009, 6, 20), [-R - 0.0105, h, 0.006], [0, PI / 2, 0]));
  B.build(g, 'optic_reddot');
  // the objective (a faint coating) and the dot, just behind it on the axis, facing the eye
  const lens = new THREE.Mesh(new THREE.CircleGeometry(RI + 0.0002, 32), tintMaterial());
  lens.name = 'optic_reddot_lens';
  lens.position.set(0, h, -L / 2 + 0.002);
  lens.renderOrder = 2;
  g.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.00062, 16), dotMaterial());
  dot.name = 'optic_reddot_dot';
  dot.position.set(0, h, -L / 2 + 0.0035);
  g.add(dot);
  return { group: g, eyeZ: L / 2 + 0.005 };
}

function buildAcog(h) {
  const g = K.grp('optic_acog');
  const B = new K.PB();
  const L = 0.15, RB = 0.0205;
  mountBlock(B, h - RB + 0.002, 0.075, 0.0, 0.03);
  // the housing: eyepiece, body, the objective bell with its hood (lathe, back to front)
  B.add('anod', K.xf(K.lathe([[0.0138, L / 2], [0.0172, L / 2 - 0.002], [0.0176, L / 2 - 0.026], [RB, L / 2 - 0.04], [RB, -L / 2 + 0.03], [0.0232, -L / 2 + 0.016], [0.0232, -L / 2], [0.0206, -L / 2]], { segs: 32 }), [0, h, 0]));
  // the forged top with its sight rail and the fibre that lights the reticle
  B.add('anod', K.cbox(0.027, 0.011, 0.085, 0.002, [0, h + RB + 0.001, -0.004]));
  B.add('park', K.cbox(0.006, 0.0025, 0.06, 0.0006, [0, h + RB + 0.0075, -0.004]));
  B.add('park', K.xf(K.cyl(0.0068, 0.009, 18, 0.001), [0, h + RB + 0.0105, 0.018], [PI / 2, 0, 0]));
  B.add('park', K.xf(K.cyl(0.0068, 0.009, 18, 0.001), [RB + 0.0035, h, 0.018], [0, PI / 2, 0]));
  B.build(g, 'optic_acog');
  const fibre = new K.PB();
  fibre.add('tritium', K.cbox(0.0022, 0.0016, 0.05, 0.0003, [0.0085, h + RB + 0.0067, -0.004]));
  fibre.build(g, 'optic_acog_fibre');
  // coated glass both ends (aimed all the way in, the scope view takes over: see ui/hud.js)
  const lens = new K.PB();
  lens.add('glass', K.xf(K.cyl(0.0198, 0.0012, 32), [0, h, -L / 2 + 0.004]));
  lens.add('glass', K.xf(K.cyl(0.0132, 0.0012, 32), [0, h, L / 2 - 0.003]));
  lens.build(g, 'optic_acog_lens');
  return { group: g, eyeZ: L / 2 };
}

const BUILD = { reddot: buildRedDot, acog: buildAcog };

// the rail top under [z0, z1] (root space): the highest point of the gun there, near the centre line
function railTop(root, z0, z1, x = 0) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4(), v = new V3();
  let top = -Infinity;
  const shown = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
    return true;
  };
  root.traverse((o) => {
    if (!o.isMesh || !shown(o) || /optic|flash|muzzle/i.test(o.name)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      if (v.z < Math.min(z0, z1) || v.z > Math.max(z0, z1) || Math.abs(v.x - x) > 0.011) continue;
      if (v.y > top) top = v.y;
    }
  });
  return top;
}

/**
 * Put optic `kind` (or none) on a viewmodel model `m` (with m.rail): builds the optic the first time, shows it,
 * hides the irons, and swaps m.sight for one on the optic's axis. Returns false if the model has no rail.
 */
export function mountOptic(m, kind, setLayer) {
  const rail = m?.rail;
  if (!rail) return false;
  m.sightIron ??= m.sight;
  m.optics ??= {};
  for (const o of Object.values(m.optics)) o.group.visible = false;
  for (const o of rail.irons ?? []) o.visible = !kind;
  if (!kind || !BUILD[kind]) {
    m.sight = m.sightIron;
    m.opticOn = null;
    return true;
  }
  let o = m.optics[kind];
  if (!o) {
    const O = OPTICS[kind];
    // centre it on the rail (the scope a little forward), its foot on the rail top
    const zc = (rail.z0 + rail.z1) / 2 + (kind === 'acog' ? -0.01 : 0);
    const foot = railTop(m.root, zc - O.len * 0.3, zc + O.len * 0.3, rail.x ?? 0);
    const base = new V3(rail.x ?? 0, Number.isFinite(foot) ? foot : rail.y ?? 0, zc);
    const axis = Math.max(base.y + O.minH, (rail.sightY ?? -Infinity) + 0.008);
    const built = BUILD[kind](axis - base.y);
    built.group.position.copy(base);
    m.root.add(built.group);
    setLayer?.(built.group);
    o = m.optics[kind] = { group: built.group, sight: { eye: new V3(base.x, axis, base.z + built.eyeZ + O.eyeBack) } };
  }
  o.group.visible = true;
  m.sight = o.sight;
  m.opticOn = kind;
  return true;
}
