// Procedural ranch props (same PB toolkit and conventions as props.js: origin = footprint centre on the
// floor, front +Z, meters, one merged mesh per material). Registered into props.js' builder table on import.
//   barnDoor · barnWindow · ladder · postRailFence · fenceGate · tractor · roundBale · stockTank · windmill ·
//   windmillWheel · hayWagon · scarecrow · chickenCoop · feedSacks · toolRack · pitchfork · hayPile · milkCans ·
//   floodLamp · feedTrough · pulley
import * as THREE from 'three';
import { PropKit, registerProp } from './props.js';

const { M, PI, TAU, HP, lerp, clamp, fbm, vnoise, plank, boxBetween, tireProfile, dentDeform, smoothPts } = PropKit;

const STRAW = 'straw';
const TRIM = 'barnTrim';
const RED = M('rustyMetal', { color: 0xb4523a }); // faded red tractor paint over rust
const GALV = M('metalDark', { color: 0x9a9d9e });
const IRON = 'metalDark';
const RUST = 'rustyMetal';

/** straw strands poking out of a surface point (thin 3-sided cones) */
function strands(b, n, at, spread, len = [0.06, 0.16], mat = STRAW) {
  const r = b.r;
  for (let i = 0; i < n; i++) {
    const p = at(i);
    b.cyl(mat, 0.0015, 0.0028, r.range(len[0], len[1]), 3, p, [r.jit(1.3), r.range(0, TAU), r.jit(spread)]);
  }
}

// ---------------------------------------------------------------- barnDoor (bottom centre, leaf in XY, front +Z)
// red board leaf with the white frame + X bracing; opts.w, opts.h, opts.slider (roller hangers on top)
registerProp('barnDoor', (b, o) => {
  const w = o.w ?? 2.0, h = o.h ?? 3.0, t = 0.05;
  const s = 0.13, ft = 0.032, zf = t / 2 + ft / 2;
  // opts.mats: the barn's own (charrable) materials, see barnFire.js
  const SID = o.mats?.siding ?? 'barnSiding', TRIM = o.mats?.trim ?? 'barnTrim', PLK = o.mats?.planks ?? 'barnPlanks';
  b.box(SID, w, h, t, [0, h / 2, 0], null, { grain: 2, c: 0.006 });
  // frame
  for (const x of [-w / 2 + s / 2, w / 2 - s / 2]) b.box(TRIM, s, h, ft, [x, h / 2, zf], null, { c: 0.006, grain: 1 });
  const rails = o.rails ?? (h > 2.4 ? [s / 2, h / 2, h - s / 2] : [s / 2, h - s / 2]);
  for (const y of rails) b.box(TRIM, w - 2 * s, s, ft, [0, y, zf], null, { c: 0.006 });
  // X braces in each panel
  for (let k = 0; k < rails.length - 1; k++) {
    const y0 = rails[k] + s / 2, y1 = rails[k + 1] - s / 2, x0 = -w / 2 + s, x1 = w / 2 - s;
    const q = 0.05;
    boxBetween(b, TRIM, [x0 + q, y0 + q, zf], [x1 - q, y1 - q, zf], ft, s * 0.85, { c: 0.004 });
    if (!o.single) boxBetween(b, TRIM, [x1 - q, y0 + q, zf + 0.012], [x0 + q, y1 - q, zf + 0.012], ft * 0.8, s * 0.85, { c: 0.004 });
  }
  // back face battens
  for (const y of rails) b.box(PLK, w - 0.1, s * 0.8, 0.03, [0, y, -t / 2 - 0.015], null, { c: 0.004 });
  if (o.slider) {
    for (const x of [-w / 2 + 0.3, w / 2 - 0.3]) {
      b.box(IRON, 0.07, 0.3, 0.012, [x, h + 0.08, zf + 0.01], null, { c: 0.002 });
      b.cyl(IRON, 0.055, 0.055, 0.035, 12, [x, h + 0.2, zf + 0.03], [HP, 0, 0]);
    }
    b.box(IRON, 0.05, 0.12, 0.03, [w / 2 - 0.35, h * 0.42, zf + 0.03], null, { c: 0.004 });
  } else {
    // strap hinges on the hinge side (-x)
    for (const y of [h * 0.18, h * 0.82]) b.box(IRON, w * 0.45, 0.05, 0.008, [-w / 2 + w * 0.225, y, zf + 0.02], null, { c: 0.001 });
  }
  b.col([-w / 2, 0, -0.05], [w / 2, h, 0.06]);
});

// ---------------------------------------------------------------- barnWindow (opening centre, XY plane, front +Z)
// white frame, 2x2 muntins, some panes broken; opts.boards: a couple of planks nailed across
registerProp('barnWindow', (b, o) => {
  const r = b.r;
  const TRIM = o.trim ?? 'barnTrim';
  const w = o.w ?? 0.9, h = o.h ?? 0.9, d = o.depth ?? 0.22, f = 0.07;
  for (const s of [-1, 1]) b.box(TRIM, f, h + 2 * f, 0.035, [s * (w / 2 + f / 2), 0, d / 2 + 0.015], null, { c: 0.005, grain: 1 });
  for (const s of [-1, 1]) b.box(TRIM, w, f, 0.035, [0, s * (h / 2 + f / 2), d / 2 + 0.015], null, { c: 0.005 });
  b.box(TRIM, w + 0.2, 0.04, 0.09, [0, -h / 2 - f - 0.01, d / 2 + 0.03], null, { c: 0.005 });
  const m = 0.028;
  b.box(TRIM, m, h, 0.03, [0, 0, 0], null, { c: 0.003 });
  b.box(TRIM, w, m, 0.03, [0, 0, 0], null, { c: 0.003 });
  for (const s of [-1, 1]) b.box(TRIM, 0.03, h, d, [s * (w / 2 - 0.015), 0, 0], null, { c: 0.003, grain: 1 });
  const pw = (w - m) / 2, ph = (h - m) / 2;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const k = r.next();
      if (k < 0.35) continue;
      const g = new THREE.PlaneGeometry(pw, ph);
      if (k < 0.6) {
        // shard: bottom sliver only
        g.scale(1, r.range(0.2, 0.45), 1);
        g.translate(0, -ph * 0.3, 0);
      }
      b.add('glass', g, [sx * (pw / 2 + m / 2), sy * (ph / 2 + m / 2), 0.005]);
    }
  }
  if (o.boards) {
    for (let i = 0; i < 2; i++) plank(b, 'woodFloor', w + 0.3, 0.14, 0.024, [r.jit(0.04), r.range(-h * 0.3, h * 0.3), d / 2 + 0.05], [0, 0, r.jit(0.3)], { breakR: r.chance(0.3) });
  }
});

// ---------------------------------------------------------------- ladder (bottom centre, rails along Y, rungs along X, front +Z)
// opts.h total height, opts.w width, opts.top: height of the highest rung
registerProp('ladder', (b, o) => {
  const r = b.r;
  const h = o.h ?? 4.5, w = o.w ?? 0.56, top = o.top ?? h - 1.0;
  for (const s of [-1, 1]) {
    b.box('woodBeam', 0.065, h, 0.095, [s * w / 2, h / 2, 0], [0, 0, r.jit(0.004)], { c: 0.01, grain: 1 });
    b.box(IRON, 0.075, 0.035, 0.105, [s * w / 2, h - 0.2, 0], null, { c: 0.003 }); // iron straps where it's bolted to the loft
    b.box(IRON, 0.075, 0.035, 0.105, [s * w / 2, top + 0.1, 0], null, { c: 0.003 });
  }
  for (let y = 0.3; y <= top + 1e-3; y += 0.3) {
    b.cyl('woodBeam', 0.021, 0.021, w + 0.02, 7, [0, y + r.jit(0.006), 0.005], [0, 0, HP]);
  }
});

// ---------------------------------------------------------------- postRailFence (along +X from the origin; opts.length)
// weathered posts every ~2.4 m, three rails on the +Z face; opts.broken: chance a rail has dropped
registerProp('postRailFence', (b, o) => {
  const r = b.r;
  const L = o.length ?? 7.2;
  const nSeg = Math.max(1, Math.round(L / 2.4));
  const posts = [];
  for (let k = 0; k <= nSeg; k++) posts.push((k * L) / nSeg);
  const wood = 'woodBeam', rail = M('woodBeam', { color: 0xb8ac9c });
  const skip = new Set(o.skipPosts ?? []);
  posts.forEach((x, k) => {
    if (skip.has(k)) return;
    const ph = r.range(1.3, 1.42);
    b.box(wood, 0.13, ph + 0.3, 0.13, [x, (ph + 0.3) / 2 - 0.3, 0], [r.jit(0.04), r.jit(0.25), r.jit(0.04)], { c: 0.018, grain: 1 });
    b.box(wood, 0.15, 0.02, 0.15, [x, ph, 0], [r.jit(0.05), 0, r.jit(0.05)], { c: 0.004 });
  });
  const ys = [0.36, 0.74, 1.1];
  for (let s = 0; s < nSeg; s++) {
    const xa = posts[s], xb = posts[s + 1];
    for (const y of ys) {
      const q = r.next();
      if (q < (o.broken ?? 0.12) * 0.4) continue;
      const len = xb - xa + 0.14;
      if (q < (o.broken ?? 0.12)) {
        const fromA = r.chance(0.5);
        const px = fromA ? xa : xb, d = fromA ? 1 : -1;
        const drop = Math.asin(clamp((y - 0.04) / (len - 0.1), 0, 0.99));
        b.grp([px, y, 0.085], [0, 0, -d * drop], () => plank(b, rail, len, 0.14, 0.045, [d * (len / 2 - 0.07), 0, 0], null, {}));
      } else {
        plank(b, rail, len, 0.14, 0.045, [(xa + xb) / 2, y + r.jit(0.015), 0.09], [0, r.jit(0.01), r.jit(0.012)], {});
      }
    }
  }
  b.col([0, 0, -0.08], [L, 1.2, 0.13]);
});

// ---------------------------------------------------------------- fenceGate (hinge post at the origin, gate along +X, opts.open rad)
registerProp('fenceGate', (b, o) => {
  const r = b.r;
  const W = o.w ?? 3.0, open = o.open ?? 0;
  const wood = 'woodBeam', rail = M('woodBeam', { color: 0xc0b4a4 });
  b.box(wood, 0.18, 1.8, 0.18, [0, 0.75, 0], null, { c: 0.02, grain: 1 });
  if (o.latchPost !== false) b.box(wood, 0.16, 1.7, 0.16, [W + 0.12, 0.7, 0], null, { c: 0.02, grain: 1 });
  b.grp([0.12, 0, 0], [0, open, 0], () => {
    const L = W - 0.08;
    for (const x of [0.05, L - 0.05]) b.box(rail, 0.09, 1.25, 0.05, [x, 0.72, 0], null, { c: 0.008, grain: 1 });
    for (const y of [0.25, 0.5, 0.75, 1.0, 1.25]) plank(b, rail, L, 0.12, 0.035, [L / 2, y, 0.04], [0, 0, r.jit(0.006)]);
    const len = Math.hypot(L - 0.1, 1.0), a = Math.atan2(1.0, L - 0.1);
    plank(b, rail, len, 0.12, 0.035, [L / 2, 0.75, -0.035], [0, 0, a]);
    for (const y of [0.3, 1.2]) b.box(IRON, 0.35, 0.04, 0.01, [0.14, y, 0.065], null, { c: 0.001 });
  });
  b.col([-0.09, 0, -0.09], [0.09, 1.8, 0.09]);
  if (o.latchPost !== false) b.col([W + 0.04, 0, -0.08], [W + 0.2, 1.7, 0.08]);
  const c = Math.cos(open), s = Math.sin(open);
  // gate leaf AABB (open 0 or ±90° keeps it tight)
  const x1 = 0.12 + W * c, z1 = -W * s;
  b.col([Math.min(0.12, x1) - 0.05, 0, Math.min(0, z1) - 0.05], [Math.max(0.12, x1) + 0.05, 1.35, Math.max(0, z1) + 0.05]);
});

// ---------------------------------------------------------------- tractor (vintage row-crop tractor, rusted; front +Z)
registerProp('tractor', (b) => {
  const r = b.r;
  const rub = 'rubber', dk = IRON, chrome = 'chrome';
  // rear wheels: big lugged tyres on steel discs
  const RR = 0.72, RW = 0.34, rearZ = -0.9, rearX = 0.86;
  const tprof = tireProfile(RR, 0.44, RW);
  for (const sx of [-1, 1]) {
    b.grp([sx * rearX, RR - 0.015, rearZ], [0, 0, -sx * HP, 'XZY'], () => {
      b.lathe(rub, tprof, 24);
      b.lathe(RED, [[0, -0.02], [0.3, -0.06], [0.43, -0.12], [0.45, -0.1], [0.45, 0.1], [0.43, 0.12], [0.3, 0.02], [0.1, 0.05], [0, 0.06]], 20);
      b.cyl(dk, 0.1, 0.12, 0.16, 10, [0, 0.08, 0]);
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * TAU;
        b.cyl(dk, 0.013, 0.013, 0.03, 6, [Math.cos(a) * 0.2, 0.06, Math.sin(a) * 0.2]);
      }
      // chevron lugs
      const n = 20;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU;
        for (const side of [-1, 1]) {
          b.grp([Math.cos(a) * (RR - 0.005), side * RW * 0.22, Math.sin(a) * (RR - 0.005)], [0, -a, 0], () => b.box(rub, 0.05, RW * 0.46, 0.045, [0, 0, 0], [0.55 * side, 0, 0], { c: 0 }));
        }
      }
    });
  }
  // twin front wheels under the nose
  const FR = 0.36, frontZ = 1.5;
  const fprof = tireProfile(FR, 0.2, 0.13);
  for (const sx of [-1, 1]) {
    b.grp([sx * 0.15, FR, frontZ], [0, 0, -sx * HP, 'XZY'], () => {
      b.lathe(rub, fprof, 18);
      b.lathe(RED, [[0, 0], [0.2, -0.04], [0.21, 0.04], [0.1, 0.06], [0, 0.07]], 14);
    });
  }
  b.box(dk, 0.1, 0.5, 0.14, [0, 0.62, frontZ], null, { c: 0.01 }); // front pedestal
  b.cyl(dk, 0.03, 0.03, 0.42, 8, [0, FR, frontZ], [0, 0, HP]);
  // frame, engine, transmission
  b.box(dk, 0.44, 0.34, 2.3, [0, 0.72, 0.25], null, { c: 0.02 });
  b.box(dk, 0.56, 0.5, 0.7, [0, 0.72, rearZ + 0.05], null, { c: 0.03 }); // differential housing
  b.cyl(dk, 0.1, 0.1, 1.5, 10, [0, RR, rearZ], [0, 0, HP]); // rear axle
  for (let k = 0; k < 4; k++) b.cyl(dk, 0.055, 0.055, 0.34, 8, [r.jit(0.02) + (k % 2 ? 0.2 : -0.2), 1.0, 0.25 + k * 0.22], [0, 0, HP]); // cylinder head bolts / manifold
  b.cyl(RUST, 0.035, 0.035, 0.9, 7, [0.25, 0.98, 0.55], [HP, 0, 0]); // manifold
  // hood (rounded) + grille shell + fuel tank
  b.soft(RED, 0.5, 0.36, 1.5, 0.12, [4, 3, 6], [0, 1.2, 0.55], null, { deform: dentDeform(r, 2, 0.02) });
  b.soft(RED, 0.58, 0.8, 0.16, 0.06, [4, 6, 2], [0, 1.02, 1.36], null, {});
  for (let k = 0; k < 7; k++) b.box(dk, 0.025, 0.6, 0.03, [-0.21 + k * 0.07, 1.0, 1.45], null, { c: 0 });
  b.box(dk, 0.46, 0.64, 0.02, [0, 1.0, 1.43], null, { c: 0 });
  b.cyl(RED, 0.2, 0.2, 0.6, 12, [0, 1.42, 0.02], [HP, 0, 0]);
  b.cyl(chrome, 0.05, 0.05, 0.05, 10, [0.1, 1.64, 0.05]);
  // exhaust + air intake stacks
  b.cyl(RUST, 0.045, 0.05, 1.05, 10, [0.14, 1.85, 0.95]);
  b.grp([0.14, 2.39, 0.95], [0.5, 0, 0], () => b.cyl(RUST, 0.06, 0.06, 0.012, 10, [0, 0, 0.05]));
  b.cyl(dk, 0.045, 0.045, 0.55, 10, [-0.14, 1.62, 0.9]);
  b.lathe(dk, [[0, 0], [0.07, 0], [0.09, 0.08], [0.09, 0.14], [0, 0.14]], 12, [-0.14, 1.89, 0.9]);
  // headlights on brackets
  for (const sx of [-1, 1]) {
    b.box(dk, 0.03, 0.2, 0.03, [sx * 0.3, 1.2, 1.25], null, { c: 0 });
    b.grp([sx * 0.33, 1.34, 1.27], [0, sx * 0.15, 0], () => {
      b.lathe(dk, [[0, -0.1], [0.07, -0.08], [0.085, -0.02], [0.085, 0], [0, 0]], 12, [0, 0, 0], [HP, 0, 0]);
      b.add('glass', new THREE.CircleGeometry(0.08, 12), [0, 0, 0.002]);
    });
  }
  // steering column + wheel
  boxBetween(b, dk, [0, 1.35, -0.05], [0, 1.78, -0.6], 0.05, 0.05, { c: 0 });
  b.grp([0, 1.8, -0.62], [-0.9, 0, 0], () => {
    b.add(rub, new THREE.TorusGeometry(0.2, 0.017, 6, 22), [0, 0, 0], [HP, 0, 0]);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * TAU + 0.3;
      boxBetween(b, dk, [0, 0, 0], [Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19], 0.015, 0.015, { c: 0 });
    }
  });
  // dash + levers
  b.box(dk, 0.5, 0.3, 0.12, [0, 1.25, -0.12], null, { c: 0.01 });
  for (const [x, a] of [[0.18, 0.4], [-0.2, -0.3]]) boxBetween(b, chrome, [x, 1.0, -0.6], [x + r.jit(0.05), 1.5, -0.6 - a * 0.4], 0.02, 0.02, { c: 0 });
  // seat on a spring bar
  boxBetween(b, dk, [0, 0.85, -1.1], [0, 1.25, -1.35], 0.07, 0.02, { c: 0 });
  b.lathe(RUST, [[0, 0.02], [0.18, 0], [0.22, 0.05], [0.23, 0.12], [0.2, 0.1], [0, 0.06]], 14, [0, 1.26, -1.37], null, { deform: dentDeform(r, 1, 0.01) });
  // rear fenders
  for (const sx of [-1, 1]) {
    b.cyl(RED, 0.83, 0.83, 0.38, 14, [sx * rearX, RR, rearZ], [0, 0, HP], { open: true, ts: 0.35, tl: 2.55, deform: dentDeform(r, 2, 0.03) });
    b.cyl(IRON, 0.82, 0.82, 0.38, 14, [sx * rearX, RR, rearZ], [0, 0, HP], { open: true, ts: 0.35, tl: 2.55, invert: true });
    b.box(RED, 0.05, 0.35, 0.8, [sx * (rearX - 0.2), 1.12, rearZ + 0.25], null, { c: 0.01 });
  }
  // platform + drawbar + three-point stub
  for (const sx of [-1, 1]) b.box(dk, 0.3, 0.03, 0.5, [sx * 0.42, 0.82, -0.35], null, { c: 0 });
  b.box(dk, 0.1, 0.06, 0.7, [0, 0.45, rearZ - 0.55], null, { c: 0.005 });
  b.cyl(dk, 0.02, 0.02, 0.12, 6, [0, 0.52, rearZ - 0.8]);
  b.col([-rearX - 0.2, 0, rearZ - 0.8], [rearX + 0.2, 1.5, rearZ + 0.8]);
  b.col([-0.34, 0, rearZ + 0.8], [0.34, 1.55, frontZ + 0.35]);
});

// ---------------------------------------------------------------- roundBale (lying on its side, axis along X)
registerProp('roundBale', (b, o) => {
  const r = b.r;
  const R = o.r ?? 0.72, L = o.l ?? 1.2, sd = r.range(0, 50), SW = o.straw ?? STRAW;
  // local cylinder space: axis along Y, radial in XZ; local +X becomes world up after the roll below
  const wob = (v) => {
    const n = 0.02 * fbm(v.x * 5 + sd, v.y * 5, v.z * 5);
    const rad = Math.hypot(v.x, v.z);
    if (rad > 0.05) {
      const k = 1 + n / rad;
      v.x *= k;
      v.z *= k;
    }
    v.x = Math.max(v.x, -R + 0.03); // settled flat on the ground
  };
  b.grp([0, R, 0], [0, 0, HP], () => {
    b.cyl(SW, R, R, L, 22, null, null, { hs: 3, open: true, deform: wob });
    // end faces: a shallow dome with the rolled layers as rings
    for (const s of [-1, 1]) {
      const prof = [];
      for (let i = 0; i <= 8; i++) {
        const rr = (R * i) / 8;
        prof.push([rr, (L / 2 + 0.02 * (1 - (i / 8) ** 2) + (i % 2 ? -0.008 : 0.004)) * s]);
      }
      // lathe convention: bottom axis -> out -> up -> top axis (outward normals)
      b.lathe(SW, s > 0 ? prof.slice().reverse() : prof, 22, null, null, { deform: wob });
    }
    // twine / net wraps
    for (const y of [-0.42, -0.14, 0.14, 0.42]) b.add(M('cloth', { color: 0x8a8068 }), new THREE.TorusGeometry(R + 0.006, 0.004, 3, 30), [0, y * L, 0], [HP, 0, 0]);
  });
  strands(b, 24, () => {
    const a = r.range(0, PI);
    return [r.jit(L / 2), R + Math.cos(a) * R, Math.sin(a) * R * (r.chance(0.5) ? 1 : -1)];
  }, 1.2, undefined, SW);
  b.col([-L / 2, 0, -R * 0.95], [L / 2, 2 * R - 0.05, R * 0.95]);
});

// ---------------------------------------------------------------- stockTank (round galvanised water tank)
registerProp('stockTank', (b, o) => {
  const r = b.r;
  const R = o.r ?? 1.05, H = o.h ?? 0.62;
  const prof = [[0, 0.01], [R - 0.02, 0.01]];
  for (let i = 0; i <= 10; i++) prof.push([R + (i % 2 ? 0.012 : 0), 0.02 + (i / 10) * (H - 0.05)]);
  prof.push([R + 0.03, H - 0.02], [R + 0.03, H], [R - 0.01, H], [R - 0.012, 0.05], [0, 0.05]);
  b.lathe(GALV, prof, 28, null, null, { deform: dentDeform(r, 2, 0.025), weld: false });
  b.add(M('metalDark', { color: 0x0a0e0f, roughness: 0.06, metalness: 0.3 }), new THREE.CircleGeometry(R - 0.015, 28), [0, H - 0.1, 0], [-HP, 0, 0]);
  // green scum at the waterline
  b.add(M('cloth', { color: 0x2f3a22 }), new THREE.RingGeometry(R - 0.12, R - 0.015, 28), [0, H - 0.098, 0], [-HP, 0, 0]);
  b.cyl(RUST, 0.035, 0.035, 0.35, 8, [R - 0.2, H + 0.1, 0.3], [0.25, 0, 0]); // float valve pipe
  b.col([-R, 0, -R], [R, H, R]);
});

// ---------------------------------------------------------------- windmill (steel lattice tower + head, the wheel is 'windmillWheel')
// anchors.hub = wheel centre; the wheel faces +Z
registerProp('windmill', (b) => {
  const r = b.r;
  const H = 9.0, base = 1.25, topw = 0.3;
  const leg = (sx, sz, y) => {
    const t = y / H;
    return [sx * lerp(base, topw, t), y, sz * lerp(base, topw, t)];
  };
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of corners) {
    boxBetween(b, GALV, leg(sx, sz, -0.3), leg(sx, sz, H), 0.075, 0.075, { c: 0.004 });
    b.box('concrete', 0.4, 0.3, 0.4, [sx * base, 0.05, sz * base], null, { c: 0.03 });
  }
  const girts = [1.4, 3.0, 4.5, 5.9, 7.1, 8.2, H];
  let prev = 0.1;
  for (const y of girts) {
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      boxBetween(b, GALV, leg(ax, az, y), leg(bx, bz, y), 0.05, 0.05, { c: 0.003 });
      // X bracing rods between girts
      b.tube(GALV, [leg(ax, az, prev), leg(bx, bz, y)], 0.009, 4, { capEnd: false });
      b.tube(GALV, [leg(bx, bz, prev), leg(ax, az, y)], 0.009, 4, { capEnd: false });
    }
    prev = y;
  }
  // platform ring + head
  b.box('woodBeam', 1.3, 0.05, 1.3, [0, H - 0.6, 0], null, { c: 0.01 });
  b.cyl(IRON, 0.12, 0.14, 0.3, 10, [0, H + 0.15, 0]);
  b.soft(M('rustyMetal', { color: 0x8c8f8e }), 0.36, 0.34, 0.6, 0.08, [3, 3, 4], [0, H + 0.45, 0.05], null, {});
  b.cyl(IRON, 0.035, 0.035, 0.55, 8, [0, H + 0.48, 0.45], [HP, 0, 0]);
  // tail boom + vane
  boxBetween(b, GALV, [0, H + 0.45, -0.25], [0, H + 0.62, -2.3], 0.05, 0.05, { c: 0 });
  boxBetween(b, GALV, [0, H + 0.3, -0.2], [0, H + 0.6, -1.6], 0.03, 0.03, { c: 0 });
  b.box(M('rustyMetal', { color: 0x9aa09a }), 0.02, 0.85, 1.35, [0, H + 0.72, -2.85], [0, 0, 0], { c: 0.002, deform: dentDeform(r, 1, 0.02) });
  // pump rod down the middle + pump head at the base, spout toward +X (the tank)
  b.cyl(IRON, 0.012, 0.012, H - 0.2, 5, [0, (H + 0.2) / 2, 0.02]);
  b.lathe(IRON, [[0, 0], [0.12, 0], [0.12, 0.08], [0.07, 0.12], [0.07, 0.75], [0.09, 0.8], [0.09, 0.9], [0, 0.9]], 12, [0, 0, 0]);
  b.tube(IRON, [[0.07, 0.6, 0], [0.4, 0.62, 0], [0.62, 0.5, 0]], 0.03, 8, { capEnd: true });
  b.anchor('hub', [0, H + 0.48, 0.74]);
  for (const [sx, sz] of corners) b.col([sx * base - 0.2, 0, sz * base - 0.2], [sx * base + 0.2, 2.2, sz * base + 0.2]);
  b.col([-0.14, 0, -0.14], [0.14, 0.9, 0.14]);
});

// ---------------------------------------------------------------- windmillWheel (hub at the origin, wheel in XY facing +Z)
registerProp('windmillWheel', (b) => {
  const r = b.r;
  const n = 18, R0 = 0.5, R1 = 1.55;
  const blade = M('rustyMetal', { color: 0x9ea3a2 });
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU;
    if (r.chance(0.08)) continue; // a blade or two torn off
    b.grp([0, 0, 0], [0, 0, a], () => {
      b.box(blade, 0.26, R1 - R0, 0.012, [0, (R0 + R1) / 2, 0.02], [0, 0.45, 0], { c: 0, deform: (v) => (v.z += 0.02 * (v.x / 0.1) ** 2) });
    });
  }
  for (const R of [R0, (R0 + R1) / 2, R1]) b.add(GALV, new THREE.TorusGeometry(R, 0.012, 4, 36), [0, 0, 0.02]);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU;
    boxBetween(b, GALV, [0, 0, 0.05], [Math.cos(a) * R1, Math.sin(a) * R1, 0.02], 0.025, 0.012, { c: 0 });
  }
  b.cyl(IRON, 0.1, 0.12, 0.2, 10, [0, 0, 0], [HP, 0, 0]);
});

// ---------------------------------------------------------------- hayWagon (flatbed with stake sides, spoked wheels, bales; along Z)
registerProp('hayWagon', (b, o) => {
  const r = b.r;
  const W = 2.0, L = 3.8, deckY = 0.95;
  const wood = 'woodFloor', frame = 'woodBeam';
  // deck boards across
  for (let z = -L / 2 + 0.1; z < L / 2; z += 0.2) plank(b, wood, W, 0.19, 0.04, [r.jit(0.01), deckY, z], [HP, 0, 0], { breakR: r.chance(0.05) });
  for (const sx of [-1, 1]) b.box(frame, 0.12, 0.14, L, [sx * (W / 2 - 0.1), deckY - 0.09, 0], null, { c: 0.01, grain: 2 });
  // stake sides
  for (const sx of [-1, 1]) {
    for (let z = -L / 2 + 0.15; z <= L / 2 - 0.1; z += 0.9) b.box(frame, 0.06, 0.55, 0.07, [sx * (W / 2 - 0.03), deckY + 0.29, z], [0, 0, sx * 0.05], { c: 0.006, grain: 1 });
    b.box(frame, 0.06, 0.1, L, [sx * (W / 2 - 0.02), deckY + 0.5, 0], null, { c: 0.006, grain: 2 });
  }
  // spoked wheels
  const wheel = (x, z, R) => {
    b.grp([x, R, z], [0, 0, HP], () => {
      b.add('woodBeam', new THREE.TorusGeometry(R - 0.03, 0.035, 5, 22), [0, 0, 0], [HP, 0, 0]);
      b.add(IRON, new THREE.TorusGeometry(R - 0.005, 0.012, 4, 22), [0, 0, 0], [HP, 0, 0]);
      b.cyl('woodBeam', 0.08, 0.08, 0.16, 10);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU;
        boxBetween(b, 'woodBeam', [0, 0, 0], [Math.cos(a) * (R - 0.04), 0, Math.sin(a) * (R - 0.04)], 0.03, 0.03, { c: 0 });
      }
    });
  };
  for (const sx of [-1, 1]) {
    wheel(sx * (W / 2 + 0.12), -L / 2 + 0.6, 0.5);
    wheel(sx * (W / 2 + 0.12), L / 2 - 0.55, 0.42);
  }
  b.cyl(IRON, 0.035, 0.035, W + 0.3, 8, [0, 0.5, -L / 2 + 0.6], [0, 0, HP]);
  b.cyl(IRON, 0.035, 0.035, W + 0.3, 8, [0, 0.42, L / 2 - 0.55], [0, 0, HP]);
  for (const zz of [-L / 2 + 0.6, L / 2 - 0.55]) b.box(frame, 0.2, deckY - 0.5, 0.2, [0, (deckY + 0.42) / 2, zz], null, { c: 0.01 });
  // tongue resting on the ground
  boxBetween(b, frame, [0, 0.42, L / 2 - 0.4], [0, 0.04, L / 2 + 1.7], 0.09, 0.09, { c: 0.008 });
  b.add(IRON, new THREE.TorusGeometry(0.06, 0.015, 4, 12), [0, 0.05, L / 2 + 1.72], [HP, 0, 0]);
  // bales
  const bale = (x, y, z, rot) => {
    b.grp([x, y, z], [0, rot, r.jit(0.03)], () => {
      b.soft(STRAW, 1.0, 0.4, 0.48, 0.06, [6, 3, 3], [0, 0.2, 0], null, { deform: (v) => (v.y += 0.01 * vnoise(v.x * 9, v.y * 9, v.z * 9)) });
      for (const x2 of [-0.25, 0.25]) b.add(M('cloth', { color: 0x6e6040 }), new THREE.TorusGeometry(0.25, 0.004, 3, 16), [x2, 0.2, 0], [0, HP, 0], { scl: [1, 0.9, 1.05] });
    });
  };
  const nb = o.bales ?? 5;
  const slots = [[-0.5, 0, -1.2, HP], [0.5, 0, -1.2, HP], [-0.5, 0, 0, HP], [0.5, 0, 0.2, HP + 0.1], [0, 0.4, -0.7, HP + 0.2], [-0.5, 0, 1.2, HP]];
  for (let i = 0; i < Math.min(nb, slots.length); i++) {
    const [x, y, z, rt] = slots[i];
    bale(x + r.jit(0.04), deckY + 0.02 + y, z + r.jit(0.05), rt + r.jit(0.08));
  }
  b.col([-W / 2 - 0.25, 0, -L / 2], [W / 2 + 0.25, deckY + 0.55, L / 2]);
});

// ---------------------------------------------------------------- scarecrow (post + crossbar, burlap head, old coat; faces +Z)
registerProp('scarecrow', (b) => {
  const r = b.r;
  const coat = M('fabric', { color: 0x4a3a2c }), shirt = M('cloth', { color: 0x6a4a38 }), jeans = M('fabric', { color: 0x2f3440 });
  const sack = M('cloth', { color: 0x9a845c }), hatM = M('fabric', { color: 0x2e261e }), rope = M('cloth', { color: 0x7a6a48 });
  b.box('woodBeam', 0.09, 2.6, 0.09, [0, 1.0, -0.06], [r.jit(0.04), 0, r.jit(0.04)], { c: 0.01, grain: 1 });
  b.box('woodBeam', 1.55, 0.07, 0.07, [0, 1.62, -0.06], [0, 0, r.jit(0.05)], { c: 0.008 });
  // torso (coat) + shirt collar
  b.soft(coat, 0.46, 0.62, 0.24, 0.08, [3, 4, 2], [0, 1.4, 0], [0, 0, r.jit(0.06)], { deform: (v) => (v.x *= 1 + (v.y < -0.2 ? 0.12 : 0)) });
  b.soft(shirt, 0.22, 0.12, 0.2, 0.05, [2, 2, 2], [0, 1.72, 0.01], null, {});
  // sleeves along the crossbar, drooping cuffs with straw
  for (const s of [-1, 1]) {
    const p0 = [s * 0.2, 1.6, 0], p1 = [s * 0.55, 1.58, 0.02], p2 = [s * 0.72, 1.5, 0.03];
    b.tube(coat, smoothPts([p0, p1, p2], 6), 0.075, 8);
    strands(b, 8, () => [s * r.range(0.74, 0.8), r.range(1.42, 1.52), r.jit(0.05)], 1.2, [0.08, 0.18]);
  }
  // pants hanging from the waist
  for (const s of [-1, 1]) {
    b.tube(jeans, smoothPts([[s * 0.1, 1.12, 0], [s * 0.12, 0.85, 0.02], [s * 0.1 + r.jit(0.03), 0.62, 0.03]], 5), 0.07, 8);
    strands(b, 6, () => [s * 0.1 + r.jit(0.04), r.range(0.52, 0.6), r.jit(0.05)], 0.4, [0.08, 0.2]);
  }
  // burlap head, rope at the neck, stitched face, hat
  b.sph(sack, 0.16, [0, 1.95, 0.02], [0, 0, r.jit(0.15)], { ws: 12, hs: 9, scl: [1, 1.12, 0.95], deform: (v) => (v.x += 0.012 * vnoise(v.x * 20, v.y * 20, v.z * 20)) });
  b.add(rope, new THREE.TorusGeometry(0.09, 0.012, 4, 14), [0, 1.8, 0.02], [HP, 0, 0]);
  for (const s of [-1, 1]) {
    for (const d of [-1, 1]) b.box(IRON, 0.05, 0.008, 0.008, [s * 0.06, 1.99, 0.165], [0, 0, d * 0.8], { c: 0 });
  }
  for (let k = 0; k < 6; k++) b.box(IRON, 0.006, 0.03, 0.006, [-0.06 + k * 0.024, 1.895 + (k % 2 ? 0.006 : -0.004), 0.16], null, { c: 0 });
  b.lathe(hatM, [[0, 0.2], [0.11, 0.2], [0.13, 0.16], [0.14, 0.03], [0.3, 0.02], [0.31, 0.0], [0.28, -0.01], [0.13, 0.0], [0, 0.0]], 16, [0, 2.1, 0.01], [r.jit(0.2), 0, r.jit(0.25)], { deform: dentDeform(r, 2, 0.02) });
  strands(b, 10, () => [r.jit(0.14), r.range(1.82, 1.88), r.jit(0.1)], 1.0);
  b.col([-0.12, 0, -0.16], [0.12, 2.0, 0.08]);
});

// ---------------------------------------------------------------- chickenCoop (raised hen house, ramp, nest box, tin roof; front +Z)
registerProp('chickenCoop', (b) => {
  const r = b.r;
  const W = 1.7, D = 1.2, H = 1.1, y0 = 0.55;
  const tin = 'tinRoof';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('woodBeam', 0.09, y0 + H + (sz < 0 ? 0.35 : 0), 0.09, [sx * (W / 2 - 0.05), (y0 + H + (sz < 0 ? 0.35 : 0)) / 2, sz * (D / 2 - 0.05)], null, { c: 0.01, grain: 1 });
  b.box('barnPlanks', W, 0.05, D, [0, y0, 0], null, { c: 0.005 });
  // walls (front has the pop hole, back is taller for the pent roof)
  b.box('barnSiding', W - 0.02, H, 0.04, [0, y0 + H / 2, D / 2 - 0.02], null, { grain: 2, c: 0.004 });
  b.box('barnSiding', W - 0.02, H + 0.35, 0.04, [0, y0 + (H + 0.35) / 2, -D / 2 + 0.02], null, { grain: 2, c: 0.004 });
  for (const sx of [-1, 1]) b.box('barnSiding', 0.04, H + 0.18, D - 0.06, [sx * (W / 2 - 0.02), y0 + (H + 0.18) / 2, 0], null, { grain: 2, c: 0.004 });
  b.box(M('metalDark', { color: 0x060606 }), 0.32, 0.36, 0.01, [0.4, y0 + 0.22, D / 2 + 0.002], null, { c: 0 });
  for (const s of [-1, 1]) b.box(TRIM, 0.04, 0.42, 0.02, [0.4 + s * 0.18, y0 + 0.24, D / 2 + 0.01], null, { c: 0.002 });
  b.box(TRIM, 0.4, 0.04, 0.02, [0.4, y0 + 0.44, D / 2 + 0.01], null, { c: 0.002 });
  // pent roof
  const rl = Math.hypot(D + 0.4, 0.38), ra = Math.atan2(0.38, D + 0.4);
  b.box(tin, W + 0.3, 0.03, rl, [0, y0 + H + 0.2, 0], [ra, 0, 0], { c: 0.002 });
  // ramp with cleats
  const rp0 = [0.4, y0, D / 2 + 0.02], rp1 = [0.4, 0.0, D / 2 + 1.1];
  boxBetween(b, 'woodFloor', rp0, rp1, 0.32, 0.03, { c: 0.004 });
  for (let k = 1; k < 6; k++) {
    const t = k / 6;
    b.box('woodBeam', 0.3, 0.02, 0.025, [0.4, lerp(rp0[1], rp1[1], t) + 0.03, lerp(rp0[2], rp1[2], t)], null, { c: 0 });
  }
  // nest box on the side
  b.box('barnPlanks', 0.45, 0.4, 0.9, [W / 2 + 0.22, y0 + 0.35, 0], null, { c: 0.004 });
  b.box(tin, 0.55, 0.025, 1.0, [W / 2 + 0.24, y0 + 0.6, 0], [0, 0, -0.35], { c: 0.002 });
  // feed pan + some scattered straw
  b.lathe(GALV, [[0, 0], [0.18, 0], [0.2, 0.06], [0.19, 0.065], [0, 0.02]], 14, [-0.5, 0, D / 2 + 0.55]);
  strands(b, 14, () => [r.jit(0.9), 0.01, D / 2 + r.range(0.1, 1.2)], 0.2, [0.1, 0.2]);
  b.col([-W / 2, 0, -D / 2], [W / 2 + 0.45, y0 + H + 0.3, D / 2]);
});

// ---------------------------------------------------------------- feedSacks (burlap sacks stacked; opts.n)
registerProp('feedSacks', (b, o) => {
  const r = b.r;
  const n = o.n ?? 6;
  const cols = [0x8f7b58, 0x9a8a68, 0x7e6c4c, 0xa89468];
  let i = 0, y = 0, maxY = 0;
  for (let layer = 0; layer < 3 && i < n; layer++) {
    for (let k = 0; k < 2 && i < n; k++, i++) {
      const x = (k - 0.5) * 0.44 + r.jit(0.03), z = r.jit(0.04);
      const mat = M('cloth', { color: r.pick(cols) });
      b.grp([x, y + 0.11, z], [0, HP + r.jit(0.2), r.jit(0.05)], () => {
        b.soft(mat, 0.68, 0.2, 0.42, 0.09, [4, 2, 3], null, null, { deform: (v) => { v.y *= 1 - 0.3 * (v.x / 0.34) ** 2; v.z *= 1 - 0.12 * (v.x / 0.34) ** 2; } });
        b.cyl(mat, 0.03, 0.06, 0.08, 6, [0.36, 0, 0], [0, 0, HP]);
      });
      maxY = y + 0.22;
    }
    y += 0.19;
  }
  b.col([-0.5, 0, -0.36], [0.5, maxY, 0.36]);
});

// ---------------------------------------------------------------- toolRack (wall board with tools; origin = wall point on the floor, board faces +Z)
registerProp('toolRack', (b) => {
  const r = b.r;
  const wood = 'woodBeam', handle = M('woodBeam', { color: 0xb09878 });
  b.box('barnPlanks', 1.7, 0.16, 0.03, [0, 1.95, 0.015], null, { c: 0.004 });
  b.box('barnPlanks', 1.7, 0.16, 0.03, [0, 1.1, 0.015], null, { c: 0.004 });
  const pegs = [-0.7, -0.35, 0.0, 0.35, 0.7];
  for (const x of pegs) b.cyl(wood, 0.015, 0.015, 0.12, 6, [x, 1.95, 0.08], [HP, 0, 0]);
  // pitchfork
  b.grp([-0.7, 1.95, 0.1], [0, 0, r.jit(0.05)], () => {
    b.cyl(handle, 0.017, 0.017, 1.3, 7, [0, -0.55, 0]);
    b.box(RUST, 0.2, 0.03, 0.02, [0, -1.2, 0], null, { c: 0 });
    for (let k = 0; k < 4; k++) b.cyl(RUST, 0.006, 0.004, 0.3, 5, [-0.09 + k * 0.06, -1.35, 0]);
  });
  // shovel
  b.grp([-0.35, 1.95, 0.1], [0, 0, r.jit(0.05)], () => {
    b.cyl(handle, 0.017, 0.017, 1.0, 7, [0, -0.45, 0]);
    b.box(RUST, 0.24, 0.3, 0.012, [0, -1.08, 0.01], [0.15, 0, 0], { c: 0.002, deform: (v) => (v.z += 0.03 * (v.x / 0.12) ** 2) });
  });
  // rake
  b.grp([0.0, 1.95, 0.1], [0, 0, PI + r.jit(0.04)], () => {
    b.cyl(handle, 0.016, 0.016, 1.4, 7, [0, -0.66, 0]);
    b.box(RUST, 0.38, 0.03, 0.03, [0, -1.37, 0], null, { c: 0 });
    for (let k = 0; k < 10; k++) b.cyl(RUST, 0.004, 0.004, 0.08, 4, [-0.17 + k * 0.038, -1.41, 0.02], [0.4, 0, 0]);
  });
  // scythe
  b.grp([0.4, 1.95, 0.1], [0, 0, 0.1], () => {
    b.tube(handle, smoothPts([[0, 0, 0], [0.03, -0.6, 0], [0.08, -1.25, 0.02]], 8), 0.017, 6);
    b.box(RUST, 0.02, 0.07, 0.62, [0.12, -1.28, 0.3], [0, 0, 0], { c: 0.001, deform: (v) => (v.x += 0.2 * (v.z / 0.31) ** 2) });
  });
  // coil of rope + horseshoes
  b.add(M('cloth', { color: 0x8a7a58 }), new THREE.TorusGeometry(0.16, 0.025, 6, 20), [0.72, 1.62, 0.07], [0, 0, 0]);
  for (let k = 0; k < 3; k++) b.add(RUST, new THREE.TorusGeometry(0.055, 0.009, 4, 12, PI * 1.4), [0.15 + k * 0.14, 1.05, 0.045], [0, 0, -HP + r.jit(0.2)]);
});

// ---------------------------------------------------------------- pitchfork (lying / leaning: tines at -Y end, stands along Y)
registerProp('pitchfork', (b) => {
  const handle = M('woodBeam', { color: 0xb09878 });
  b.cyl(handle, 0.017, 0.017, 1.3, 7, [0, 0.95, 0]);
  b.box(RUST, 0.2, 0.03, 0.02, [0, 0.3, 0], null, { c: 0 });
  for (let k = 0; k < 4; k++) b.cyl(RUST, 0.006, 0.003, 0.32, 5, [-0.09 + k * 0.06, 0.14, 0]);
});

// ---------------------------------------------------------------- hayPile (loose hay mound; opts.r radius, opts.h height)
registerProp('hayPile', (b, o) => {
  const r = b.r;
  const R = o.r ?? 0.9, Hh = o.h ?? 0.55, sd = r.range(0, 50), SW = o.straw ?? STRAW;
  const prof = [[0, 0.005]];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8; // 0: rim on the floor -> 1: top
    prof.push([R * Math.cos(t * HP), Hh * Math.sin(t * HP) + 0.005]);
  }
  b.lathe(SW, prof, 16, [0, 0, 0], null, {
    deform: (v) => {
      const n = fbm(v.x * 2.2 + sd, v.y * 2.2, v.z * 2.2);
      const k = 1 + n * 0.25;
      v.x *= k;
      v.z *= k * 1.15;
      v.y = Math.max(0, v.y * (1 + n * 0.35));
    },
  });
  strands(b, 30, () => {
    const a = r.range(0, TAU), d = r.range(0.2, 1.1) * R;
    return [Math.cos(a) * d, Math.max(0.01, Hh * (1 - (d / R) ** 2)), Math.sin(a) * d * 1.1];
  }, 1.4, [0.08, 0.2], SW);
  b.col([-R * 0.7, 0, -R * 0.75], [R * 0.7, Math.min(0.4, Hh), R * 0.75]);
});

// ---------------------------------------------------------------- milkCans (a few old churns)
registerProp('milkCans', (b, o) => {
  const r = b.r;
  const prof = [[0, 0], [0.16, 0], [0.17, 0.02], [0.17, 0.44], [0.15, 0.5], [0.09, 0.58], [0.085, 0.64], [0.1, 0.66], [0.1, 0.7], [0, 0.72]];
  const n = o.n ?? 3;
  const spots = [[0, 0], [0.38, 0.1], [0.18, -0.34]];
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i];
    if (i === 2 && r.chance(0.5)) {
      // one tipped over
      b.grp([x, 0.17, z - 0.1], [0, r.range(0, TAU), HP], () => b.lathe(GALV, prof.map(([a, y]) => [a, y - 0.36]), 14, null, null, { deform: dentDeform(r, 2, 0.02) }));
      b.col([x - 0.36, 0, z - 0.46], [x + 0.36, 0.34, z + 0.26]);
      continue;
    }
    b.lathe(GALV, prof, 14, [x, 0, z], null, { deform: dentDeform(r, 2, 0.015) });
    for (const s of [-1, 1]) b.add(IRON, new THREE.TorusGeometry(0.04, 0.008, 4, 10, PI), [x + s * 0.14, 0.52, z], [0, HP, s * 0.9]);
    b.col([x - 0.17, 0, z - 0.17], [x + 0.17, 0.72, z + 0.17]);
  }
});

// ---------------------------------------------------------------- floodLamp (gooseneck barn light; origin = wall mount, reaches +Z; anchors.bulb)
registerProp('floodLamp', (b, o) => {
  b.noShadow = true;
  const reach = o.reach ?? 0.55;
  const enamel = M('paintGreen', { color: 0x2c3a30 }), white = M('porcelain', { color: 0xd8d4c8 });
  b.box(IRON, 0.16, 0.2, 0.03, [0, 0, 0.015], null, { c: 0.004 });
  const pts = smoothPts([[0, 0, 0.03], [0, 0.12, 0.2], [0, 0.1, reach * 0.8], [0, -0.02, reach]], 10);
  b.tube(IRON, pts, 0.018, 6);
  const sy = -0.06;
  b.grp([0, sy, reach], [0.25, 0, 0], () => {
    // outer shell runs bottom-outer -> top-inner (outward normals, like hangingLamp); the white inside reversed
    const prof = [[0.23, -0.13], [0.22, -0.12], [0.14, -0.04], [0.05, 0.03], [0.02, 0.05]];
    b.lathe(enamel, prof, 18);
    b.lathe(white, prof.slice().reverse().map(([rr, y]) => [Math.max(0, rr - 0.004), y - 0.004]), 18);
    b.lathe('bulb', [[0, -0.1], [0.03, -0.09], [0.035, -0.06], [0.02, -0.03], [0, -0.02]], 10);
  });
  b.anchor('bulb', [0, sy - 0.07, reach + 0.02]);
});

// ---------------------------------------------------------------- feedTrough (wooden trough on legs, along X)
registerProp('feedTrough', (b, o) => {
  const r = b.r;
  const L = o.length ?? 1.6;
  const wood = 'barnPlanks';
  b.box(wood, L, 0.03, 0.34, [0, 0.42, 0], null, { c: 0.004 });
  for (const s of [-1, 1]) b.box(wood, L, 0.26, 0.03, [0, 0.54, s * 0.2], [s * 0.18, 0, 0], { c: 0.004 });
  for (const s of [-1, 1]) b.box(wood, 0.03, 0.26, 0.4, [s * (L / 2 - 0.015), 0.54, 0], null, { c: 0.004 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('woodBeam', 0.06, 0.45, 0.06, [sx * (L / 2 - 0.12), 0.21, sz * 0.14], [sz * 0.1, 0, 0], { c: 0.006, grain: 1 });
  strands(b, 12, () => [r.jit(L / 2 - 0.1), 0.46, r.jit(0.1)], 0.3, [0.1, 0.2]);
  b.col([-L / 2, 0, -0.24], [L / 2, 0.68, 0.24]);
});

// ---------------------------------------------------------------- pulley (hay hoist block + rope + hook hanging from the origin)
registerProp('pulley', (b, o) => {
  const drop = o.drop ?? 1.6;
  const rope = M('cloth', { color: 0x7a6a48 });
  b.add(IRON, new THREE.TorusGeometry(0.035, 0.008, 4, 10), [0, -0.03, 0], [0, HP, 0]);
  b.box('woodBeam', 0.08, 0.26, 0.14, [0, -0.2, 0], null, { c: 0.01 });
  b.cyl(IRON, 0.1, 0.1, 0.03, 14, [0, -0.2, 0], [0, 0, HP]);
  for (const s of [-1, 1]) b.cyl(rope, 0.01, 0.01, drop, 5, [0, -0.2 - drop / 2, s * 0.1]);
  b.tube(IRON, smoothPts([[0, -0.3 - drop, 0.1], [0, -0.42 - drop, 0.1], [0, -0.48 - drop, 0.02], [0, -0.42 - drop, -0.05]], 8), 0.012, 5);
});

// ---------------------------------------------------------------- strawPatch (loose straw strewn on a floor; opts.r)
registerProp('strawPatch', (b, o) => {
  const r = b.r;
  const R = o.r ?? 0.8, sd = r.range(0, 50), SW = o.straw ?? STRAW;
  const g = new THREE.CircleGeometry(R, 18);
  const p = g.attributes.position;
  for (let i = 1; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const a = Math.atan2(y, x);
    const k = 0.65 + 0.5 * (0.5 + 0.5 * vnoise(Math.cos(a) * 1.7 + sd, Math.sin(a) * 1.7, sd));
    p.setXY(i, x * k * (1 + 0.25 * Math.cos(a * 2 + sd)), y * k);
  }
  b.add(SW, g, [0, 0.006, 0], [-HP, 0, 0], { uv: 'box', grain: 0 });
  strands(b, Math.round(14 * R), () => {
    const a = r.range(0, TAU), d = Math.sqrt(r.next()) * R;
    return [Math.cos(a) * d, 0.012, Math.sin(a) * d];
  }, 0.12, [0.12, 0.26], SW);
});
