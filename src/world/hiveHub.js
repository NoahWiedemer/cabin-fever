// The atrium's architecture and dressing (world/hive.js calls atriumDress): concrete pilasters with steel bases and light
// strips, the observation gallery with lit / dark / blinded offices behind glass, roof beams and ducts, wayfinding lines
// and stencils on the floor, directory boards, waiting benches, planters and the marks of the outbreak.
import * as THREE from 'three';
import { SURF } from './collision.js';
import { windowViews } from './hiveTex.js';

/**
 * c: the build context; ctx: { SH (shell materials), F (fittings), H (ceiling height), P (props), sign (atlas sign fn) }
 */
export function atriumDress(c, { SH, F, H, P, sign }) {
  const { K, M, U, rnd } = c;
  const HALF = 10;
  const concrete = SH.paints.concrete, steel = SH.wains.steel;

  // ---- pilasters: 0.55 wide, 0.3 proud, floor to roof, a steel base and cap, a light strip up the middle
  const PIL = [-8, -4, 4, 8];
  const pilaster = (side, u) => {
    const d = 0.3, w = 0.55;
    const [x0, z0, x1, z1] = side === 'n' ? [u - w / 2, -HALF, u + w / 2, -HALF + d] : side === 's' ? [u - w / 2, HALF - d, u + w / 2, HALF] : side === 'w' ? [-HALF, u - w / 2, -HALF + d, u + w / 2] : [HALF - d, u - w / 2, HALF, u + w / 2];
    const faces = side === 'n' ? ['pz', 'px', 'nx'] : side === 's' ? ['nz', 'px', 'nx'] : side === 'w' ? ['px', 'pz', 'nz'] : ['nx', 'pz', 'nz'];
    K.box(concrete, x0, 0, z0, x1, H, z1, { faces, seg: 1.0, mpr: 2.4 });
    // base plate + cap band
    const g = 0.03;
    K.box(steel, x0 - g, 0, z0 - g, x1 + g, 0.9, z1 + g, { faces: ['px', 'nx', 'pz', 'nz', 'py'], seg: 0.9, mpr: 1.2 });
    K.box(M.dark, x0 - g, 0.9, z0 - g, x1 + g, 0.96, z1 + g);
    K.box(M.dark, x0 - g, 4.28, z0 - g, x1 + g, 4.4, z1 + g);
    // the light strip on the inner face
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (side === 'n') K.box(U.dimPanel, cx - 0.03, 1.4, z1 + 0.004, cx + 0.03, 3.9, z1 + 0.012);
    else if (side === 's') K.box(U.dimPanel, cx - 0.03, 1.4, z0 - 0.012, cx + 0.03, 3.9, z0 - 0.004);
    else if (side === 'w') K.box(U.dimPanel, x1 + 0.004, 1.4, cz - 0.03, x1 + 0.012, 3.9, cz + 0.03);
    else K.box(U.dimPanel, x0 - 0.012, 1.4, cz - 0.03, x0 - 0.004, 3.9, cz + 0.03);
    c.col(x0, 0, z0, x1, H, z1, SURF.concrete);
  };
  for (const side of ['n', 's', 'w', 'e']) for (const u of PIL) pilaster(side, u);

  // ---- the observation gallery: a steel ledge, a frame per window, the offices behind the glass
  const views = windowViews();
  const uView = new THREE.MeshBasicMaterial({ map: views.texture, color: new THREE.Color(0.9, 0.9, 0.9) });
  const g0 = 4.4;
  for (const [x0, z0, x1, z1] of [[-HALF, -HALF, HALF, -HALF + 0.42], [-HALF, HALF - 0.42, HALF, HALF], [-HALF, -HALF, -HALF + 0.42, HALF], [HALF - 0.42, -HALF, HALF, HALF]]) {
    K.box(M.steel, x0, g0 - 0.14, z0, x1, g0, z1);
    K.box(M.dark, x0, g0 - 0.02, z0, x1, g0, z1);
  }
  const window_ = (side, a0, a1) => {
    // a window spanning a0..a1 along the wall (between the pilasters), y 4.7..5.85
    const y0 = 4.72, y1 = 5.85, t = 0.03;
    const along = side === 'n' || side === 's';
    const mid = (a0 + a1) / 2, len = a1 - a0;
    const off = { n: -HALF + 0.012, s: HALF - 0.012, w: -HALF + 0.012, e: HALF - 0.012 }[side];
    const face = { n: 's', s: 'n', w: 'e', e: 'w' }[side];
    const yaw = P.FACE_YAW[face];
    const k = Math.floor(rnd() * 4);
    const r = [(k % 2) * 256, Math.floor(k / 2) * 128, 256, 128];
    const inn = { n: 1, s: -1, w: 1, e: -1 }[side];
    const px = along ? mid : off + inn * 0.004, pz = along ? off + inn * 0.004 : mid;
    K.plane(uView, len - 0.14, y1 - y0 - 0.14, px, (y0 + y1) / 2, pz, [0, yaw, 0], r, 512, 256);
    // glass over it and the steel frame
    const gx = along ? mid : off + inn * 0.03, gz = along ? off + inn * 0.03 : mid;
    K.plane(U.glass, len - 0.14, y1 - y0 - 0.14, gx, (y0 + y1) / 2, gz, [0, yaw, 0]);
    const fr = 0.08;
    const box = (a, b, ya, yb) => {
      if (along) K.box(M.steel, a, ya, off + inn * 0.004 - (inn > 0 ? 0 : t), b, yb, off + inn * 0.004 + (inn > 0 ? t : 0));
      else K.box(M.steel, off + inn * 0.004 - (inn > 0 ? 0 : t), ya, a, off + inn * 0.004 + (inn > 0 ? t : 0), yb, b);
    };
    box(a0, a1, y0, y0 + fr);
    box(a0, a1, y1 - fr, y1);
    box(a0, a0 + fr, y0, y1);
    box(a1 - fr, a1, y0, y1);
    box(mid - 0.03, mid + 0.03, y0, y1);
  };
  for (const side of ['n', 's', 'w', 'e']) {
    const cuts = [-HALF + 0.6, ...PIL.flatMap((u) => [u - 0.32, u + 0.32]), HALF - 0.6];
    for (let i = 0; i + 1 < cuts.length; i += 2) window_(side, cuts[i], cuts[i + 1]);
    // pilasters cut the gaps between: the outer two windows and the middle one
  }

  // ---- roof: beams both ways, two big spiral ducts and their hangers
  for (const x of [-9, -5, 5, 9]) K.box(M.dark, x - 0.16, H - 0.62, -HALF + 0.3, x + 0.16, H - 0.14, HALF - 0.3);
  for (const z of [-9, -5, 5, 9]) K.box(M.dark, -HALF + 0.3, H - 0.5, z - 0.14, HALF - 0.3, H - 0.14, z + 0.14);
  for (const z of [-7.5, 7.5]) {
    K.cyl(F.duct, -HALF + 0.4, H - 1.25, z, 0.42, 0.42, HALF * 2 - 0.8, 24, [0, 0, Math.PI / 2]);
    for (let i = 0; i <= 8; i++) {
      const x = -HALF + 0.4 + (i * (HALF * 2 - 0.8)) / 8;
      K.add(F.ductDark, new THREE.TorusGeometry(0.43, 0.025, 6, 24), x, H - 1.25, z, [0, Math.PI / 2, 0]);
      K.cyl(M.steel, x, H - 1.25 + 0.4, z - 0.4, 0.012, 0.012, 0.9, 5);
      K.cyl(M.steel, x, H - 1.25 + 0.4, z + 0.4, 0.012, 0.012, 0.9, 5);
    }
  }

  // ---- wayfinding: a coloured guide line from the tank's inlay to each way out, with a stencil
  const line = (x0, z0, x1, z1, mat, txt) => {
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const w = 0.22;
    if (alongX) K.box(mat, Math.min(x0, x1), 0.004, z0 - w / 2, Math.max(x0, x1), 0.009, z0 + w / 2);
    else K.box(mat, x0 - w / 2, 0.004, Math.min(z0, z1), x0 + w / 2, 0.009, Math.max(z0, z1));
    if (txt) c.label(txt, (x0 + x1) / 2, 0.011, (z0 + z1) / 2 + (alongX ? 0.9 : 0), 'up', 3.0, 0.7, { bg: '#22272c', fg: '#e8edf0', border: '#6f7a82', yaw: alongX ? (x1 < x0 ? Math.PI / 2 : -Math.PI / 2) : z1 < z0 ? 0 : Math.PI });
  };
  line(-6.4, 0, -9.7, 0, M.red, ['← LABORATORIES', 'CRYO · STORES']);
  line(6.4, 0, 9.7, 0, M.blue, ['OFFICES →', 'CAFETERIA']);
  line(0, -6.4, 0, -9.7, M.yellow, ['↑ NORTH WING', 'SPECIMEN · SERVERS']);
  line(0, 6.4, 0, 9.7, M.green, ['↓ SECURE LAB', 'ARMORY']);

  // ---- directory boards between the pilasters
  const dir = ['SECTOR 4 DIRECTORY', '', '← LABS · CRYO · DECON', '← SEQUENCING · INFIRMARY', '↑ SPECIMEN HALL · OPS', '→ OFFICES · CAFETERIA', '→ QUARTERS · DIRECTOR', '↓ VIROLOGY · ARMORY'];
  c.label(dir, -HALF, 1.85, -6, 'e', 1.9, 1.2, { bg: '#0f1a26', fg: '#bfe6ff', border: '#2f7ad0', align: 'left', size: 46 });
  c.label(dir, HALF, 1.85, 6, 'w', 1.9, 1.2, { bg: '#0f1a26', fg: '#bfe6ff', border: '#2f7ad0', align: 'left', size: 46 });
  c.label(['EVACUATION ROUTE', '→ SUBLEVEL 3 STAIRS', 'SEALED · LEVEL 4 LOCKDOWN'], -6, 1.9, HALF, 'n', 1.6, 0.8, { bg: '#0a5a28', fg: '#eaffef', border: '#eaffef', size: 40 });
  c.label(['LOCKDOWN', 'IN EFFECT'], 6, 1.9, -HALF, 's', 1.5, 0.7, { bg: '#7a1410', fg: '#fff0ee', border: '#ffd0c8' });

  // ---- planters in two corners
  P.plant(c, [-9.3, 8.5, -8.5, 9.3]);
  P.plant(c, [8.5, -9.3, 9.3, -8.5]);

  // ---- the outbreak: blood dragged from the tank's ring to the labs, papers, a shattered window's glass, shots
  c.decal('bloodDrag', -8.2, 0.4, 3.4, 0.08, { aspect: 0.5 });
  c.decal('bloodDrag', -5.6, 0.6, 3.0, 0.2, { aspect: 0.5 });
  c.decal('blood', -4.4, 1.3, 1.6, 1.0);
  c.decal('footprints', -7.0, 1.0, 2.4, 1.6, { aspect: 0.6 });
  c.decal('blood', 6.2, -5.4, 1.4, 0.4);
  c.decal('bloodDrag', 7.4, -5.2, 2.8, -2.4, { aspect: 0.5 });
  c.decal('paper', 3.4, 4.6, 1.5, 0.5);
  c.decal('paper', -4.5, -5.2, 1.4, 2.2);
  c.decal('paper', 0.6, 6.3, 1.2, 4.0);
  c.decal('glass', 2.4, -8.2, 1.6, 0.3);
  c.decal('oil', -1.2, 5.6, 1.8, 0.3);
  c.decal('scuff', 0, 7.5, 3.2, Math.PI / 2, { aspect: 0.7 });
  for (const [x, y, z, face] of [[-3.2, 1.4, HALF, 'n'], [3.8, 1.1, HALF, 'n'], [HALF, 1.6, -3, 'w'], [-HALF, 1.2, 3.4, 'e']]) c.wallDecal('bullet', x, y, z, face, 1.1, 1.1);
  c.wallDecal('blood', -HALF, 0.9, -1.8, 'e', 1.6, 1.6);
  c.wallDecal('blood', -HALF, 1.0, 1.4, 'e', 1.2, 1.2);
}
