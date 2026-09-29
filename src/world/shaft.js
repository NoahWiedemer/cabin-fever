// The coal tunnel ("the shaft"): an old tunnel that runs east from the basement under the farmhouse,
// long walled off behind the basement's east wall, a few steps from the lab's vault door. The infected
// have broken it open: once the basement opens, part of every wave crawls out of it (more while the
// hacking module works on the vault door), so nobody holds the lab corner facing one way. Only the
// infected get past its mouth: a stop there (FLAG_ZPASS) keeps the fireteam out, and the tunnel runs
// down into the dark behind it (black veils fake the depth, so they come out of nowhere).
//   buildShaft(B): the geometry, called by world/level.js (which also opens the east wall and holes the
//     yard's mud slab over it, SHAFT.hole)
//   Shaft: the spawns (game._spawnOne asks spawnPoint), rubble scraping in the mouth when one comes, the
//     warning the first time. Debug: game.shaft.force(n) sends n infected out of it now.
import * as THREE from 'three';
import { SURF, FLAG_NAVIGNORE, FLAG_NOBULLET, FLAG_ZPASS } from './collision.js';
import { getMaterial } from './materials.js';
import { rand } from '../core/utils.js';

const FB = -3.2; // basement floor

export const SHAFT = {
  x: 2.4, // the basement's east wall (0.3 thick)
  z0: 2.3, // the opening / tunnel: z0..z1 wide, up to `top`
  z1: 3.6,
  top: FB + 2.05,
  end: 6.55, // the far wall, in the dark
  // the hole in the yard's mud slab over it (level.js): its far edge 6.7 keeps that slab row's per-box
  // shade (LevelBuilder hash3) within 0.02 %, so the yard shows no new seam
  hole: [2.4, 6.7, 1, 4],
  stop: 3.05, // x of the stop that keeps the fireteam out
  spawn: { x: 5.7, y: FB - 0.45 }, // (in the dark past the veils, on a nav cell clear of the far wall)
  share: 0.14, // of the wave's spawns once the basement is open
  hackShare: 0.3, // ... while the hacking module works on the vault door (the story)
  types: ['mauler', 'worker', 'survivor', 'charger', 'striker'], // no packs (dogs, Biters), no Crusher
  scrapeGap: 3.5, // s: at most one rubble scrape per this long
  // no camping the mouth: in the tunnel and for `t` s after it steps out past the wall, one takes only `mul` of
  // any damage (the tunnel is there to keep the fireteam away from that corner, not to feed it kills)
  guard: { t: 3, mul: 0.15 },
};

// floor steps down into the dark: [x0, x1, height over the basement floor]
const FLOOR = [[2.4, 3.3, 0], [3.3, 3.75, -0.1], [3.75, 4.2, -0.2], [4.2, 4.65, -0.3], [4.65, 5.1, -0.4], [5.1, 6.7, -0.45]];
// the plank ceiling steps down with it: [x0, x1, height under SHAFT.top]
const CEIL = [[2.55, 3.75, 0], [3.75, 4.95, -0.14], [4.95, 6.7, -0.28]];
const at = (list, x) => (list.find(([a, b]) => x >= a && x < b) ?? list[list.length - 1])[2];
export const shaftFloor = (x) => FB + at(FLOOR, x);
const ceilAt = (x) => SHAFT.top + at(CEIL, x);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The tunnel behind the east wall's opening, into B (the level's builder; loose bits go to its props). */
export function buildShaft(B, world) {
  const { z0, z1, top, end } = SHAFT;
  const r = mulberry(0x5a4f7);
  const R = (a, b) => a + (b - a) * r();
  const W0 = z0 - 0.15, W1 = z1 + 0.15; // the lining's outer faces
  // floor: coal grit over packed earth, stepping down
  for (const [x0, x1, dy] of FLOOR) {
    B.box(x0, FB - 0.6, W0, x1, FB + dy, W1, { mat: 'mud', mats: { py: 'gravel' }, shade: 0.55, surface: SURF.mud, grime: 0.3 });
  }
  // brick lining on both sides, the plank ceiling on joists, the caved-in far end
  for (const [a, b] of [[W0, z0], [z1, W1]]) {
    B.box(2.55, FB - 0.6, a, 6.7, top + 0.25, b, { mat: 'brick', floorY: FB, ceilY: top, shade: 0.62, surface: SURF.concrete, grime: 0.9 });
  }
  for (const [x0, x1, dy] of CEIL) {
    B.box(x0, top + dy, W0, x1, top + 0.3, W1, { mat: 'woodBeam', mats: { ny: 'ceilingBoards' }, shade: 0.5, surface: SURF.wood, grime: 0 });
  }
  B.box(end, FB - 0.6, W0, 6.7, top + 0.25, W1, { mat: 'mud', shade: 0.45, surface: SURF.mud, grime: 0.5 });
  // pit-props: two posts and a cap every 1.15 m (look only: the infected brush past them)
  for (const fx of [3.45, 4.6, 5.75]) {
    const y0 = shaftFloor(fx), y1 = ceilAt(fx);
    const o = { mat: 'woodBeam', collide: false, shade: R(0.55, 0.7), grime: 0.5, floorY: y0, ceilY: y1 };
    B.box(fx - 0.07, y0, z0, fx + 0.07, y1, z0 + 0.11, o);
    B.box(fx - 0.07, y0, z1 - 0.11, fx + 0.07, y1, z1, o);
    B.box(fx - 0.08, y1 - 0.1, z0, fx + 0.08, y1, z1, o);
  }
  // the broken mouth: ragged concrete sticking into the opening (thin: the way stays as wide as the
  // colliders say), the lintel hanging down unevenly
  const X0 = SHAFT.x - 0.15, X1 = SHAFT.x + 0.15;
  const chunk = (za, zb, y0, y1) => B.box(X0 + R(0, 0.05), y0, za, X1 - R(0, 0.03), y1, zb, { mat: 'concrete', collide: false, shade: R(0.55, 0.75), grime: 0.7, floorY: FB, ceilY: -0.25 });
  for (const side of [0, 1]) {
    let y = FB;
    while (y < top - 0.05) {
      const y1 = Math.min(top, y + R(0.2, 0.5));
      const p = R(0.02, y < FB + 0.6 ? 0.05 : 0.1);
      if (side === 0) chunk(z0, z0 + p, y, y1);
      else chunk(z1 - p, z1, y, y1);
      y = y1;
    }
  }
  let za = z0;
  while (za < z1 - 0.05) {
    const zb = Math.min(z1, za + R(0.15, 0.4));
    chunk(za, zb, top - R(0.03, 0.12), top);
    za = zb;
  }

  // loose stuff (batched with the level's props): rubble spilled out into the basement and down the
  // tunnel, bent rebar in the broken edges, the grate that closed the tunnel torn off and thrown down
  const loose = B.staticGroup;
  const mats = { concrete: getMaterial('concrete'), brick: getMaterial('brick'), rust: getMaterial('rustyMetal'), wood: getMaterial('woodBeam') };
  const piece = (x, z, sx, sy, sz, mat, tilt = 0.3) => {
    const geo = new THREE.BoxGeometry(sx, sy, sz);
    const mpr = mat.userData?.metersPerRepeat || 1;
    const uv = geo.attributes.uv;
    const sc = Math.max(sx, sz) / mpr;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sc, uv.getY(i) * sc * 0.6);
    const m = new THREE.Mesh(geo, mat);
    const floor = x > SHAFT.x ? shaftFloor(x) : FB;
    m.position.set(x, floor + sy / 2 - 0.01, z);
    m.rotation.set(R(-tilt, tilt), R(0, Math.PI * 2), R(-tilt, tilt));
    m.castShadow = true;
    m.receiveShadow = true;
    loose.add(m);
    return m;
  };
  const mid = (z0 + z1) / 2;
  for (let k = 0; k < 22; k++) {
    const inside = k < 9;
    const x = inside ? R(2.6, 5.4) : SHAFT.x - 0.15 - R(0.05, 1.3) * (0.4 + 0.6 * r());
    const z = mid + R(-0.62, 0.62) * (inside ? 0.85 : 1.3);
    const s = R(0.07, 0.2);
    if (r() < 0.7) piece(x, z, s * R(1, 1.8), s * R(0.5, 0.9), s, mats.concrete);
    else piece(x, z, R(0.18, 0.24), R(0.06, 0.08), R(0.09, 0.11), mats.brick);
  }
  for (let k = 0; k < 5; k++) {
    // rebar: thin rods bent out of the jambs and the lintel
    const g = new THREE.CylinderGeometry(0.008, 0.008, R(0.25, 0.45), 5);
    const m = new THREE.Mesh(g, mats.rust);
    const onTop = k >= 3;
    m.position.set(SHAFT.x + R(-0.1, 0.08), onTop ? top - 0.04 : R(FB + 0.5, top - 0.3), onTop ? R(z0 + 0.2, z1 - 0.2) : k % 2 ? z1 - 0.02 : z0 + 0.02);
    m.rotation.set(onTop ? R(-0.5, 0.5) : Math.PI / 2 + R(-0.4, 0.4), R(-0.6, 0.6), onTop ? R(-0.3, 0.3) : 0);
    m.castShadow = true;
    loose.add(m);
  }
  {
    // the grate: a frame and bars, lying buckled in front of the hole
    const grate = new THREE.Group();
    const bar = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats.rust);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      grate.add(m);
    };
    const GW = 1.25, GL = 1.85;
    for (const s of [-1, 1]) {
      bar(0.04, 0.03, GL, (s * GW) / 2, 0, 0);
      bar(GW, 0.03, 0.04, 0, 0, (s * GL) / 2);
    }
    for (let i = 1; i < 7; i++) bar(0.018, 0.018, GL, -GW / 2 + (i * GW) / 7, 0, 0);
    for (let i = 1; i < 4; i++) bar(GW, 0.018, 0.018, 0, 0.005, -GL / 2 + (i * GL) / 4);
    grate.position.set(1.05, FB + 0.05, 3.05);
    grate.rotation.set(0.05, 0.42, -0.06);
    loose.add(grate);
  }
  // black veils down the tunnel: whatever is deeper in fades into the dark
  for (const vx of [4.0, 4.65, 5.3]) {
    const y0 = shaftFloor(vx), y1 = ceilAt(vx);
    const veil = new THREE.Mesh(
      new THREE.PlaneGeometry(z1 - z0, y1 - y0),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.58, depthWrite: false, fog: false })
    );
    veil.rotation.y = -Math.PI / 2; // facing the basement
    veil.position.set(vx, (y0 + y1) / 2, (z0 + z1) / 2);
    veil.userData.noBatch = true;
    veil.castShadow = false;
    veil.receiveShadow = false;
    veil.renderOrder = 2;
    loose.add(veil);
  }
  // the stop: the fireteam gets as far as the mouth, the infected walk on through
  world.add(SHAFT.stop, FB - 0.2, z0, SHAFT.stop + 0.1, top + 0.2, z1, SURF.mud, FLAG_NAVIGNORE | FLAG_NOBULLET | FLAG_ZPASS, 'shaftStop');
  return { mouth: new THREE.Vector3(SHAFT.x, FB + 0.9, mid) };
}

const _v = new THREE.Vector3();

export class Shaft {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.warned = false; // the first one out gets a warning
    this.scrapeT = 0;
    this.forced = 0;
    this.coming = []; // spawned in the tunnel, not out past the wall yet (their guard clock waits)
  }

  update() {
    const t = this.game.time;
    for (let i = this.coming.length - 1; i >= 0; i--) {
      const z = this.coming[i];
      // (a pooled zombie that died and came back elsewhere has its guard reset by Zombie.spawn)
      if (!z.alive || z.guardUntil !== Infinity) this.coming.splice(i, 1);
      else if (z.pos.x < SHAFT.x) {
        z.guardUntil = t + SHAFT.guard.t;
        this.coming.splice(i, 1);
      }
    }
  }

  /** open (spawns can come out of it): the basement is open */
  get open() {
    return !!this.game.unlocked?.basement && !!this.game.level?.shaft; // (the farm only)
  }

  /** game._spawnOne: where this one comes from, if it comes out of the tunnel (else null) */
  spawnPoint(type) {
    const g = this.game;
    if (!this.open || !SHAFT.types.includes(type)) return null;
    const hack = g.mission?.story && g.mission.phase === 'hack';
    if (this.forced > 0) this.forced--;
    else if (Math.random() > (hack ? SHAFT.hackShare : SHAFT.share)) return null;
    // not onto one that just came out of it
    const sx = SHAFT.spawn.x, sz = (SHAFT.z0 + SHAFT.z1) / 2;
    for (const z of g.zombies.list) {
      if (z.active && z.alive && Math.abs(z.pos.x - sx) < 0.9 && Math.abs(z.pos.z - sz) < 0.9) return null;
    }
    return _v.set(sx + rand(-0.2, 0.2), SHAFT.spawn.y + 0.05, sz + rand(-0.15, 0.15)).clone();
  }

  /** a zombie came out of the tunnel: rubble scrapes in the mouth; the first time, a warning */
  onSpawn(z) {
    const g = this.game;
    // guarded while it's in the tunnel; update() starts the clock once it's out
    z.guardUntil = Infinity;
    z.guardMul = SHAFT.guard.mul;
    this.coming.push(z);
    const mouth = g.level.shaft?.mouth;
    if (mouth && g.time > this.scrapeT) {
      this.scrapeT = g.time + SHAFT.scrapeGap;
      g.audio.play('shaft_rubble', { position: mouth, volume: 1 });
      if (Math.random() < 0.6) g.audio.play('zombie_groan', { position: _v.copy(mouth).setX(mouth.x + 1.5), volume: 1.4 });
    }
    if (this.warned) return;
    this.warned = true;
    setTimeout(() => {
      if (!g.running) return;
      g.hud.banner('THE COAL TUNNEL', 'The infected broke through the basement wall by the lab', 3.2, 'danger');
      if (g.mission?.story) g.story?.radioMsg('COMMAND', "There's an old coal tunnel under that house. Something's coming up it, right by the lab door. Watch that wall.");
    }, 600);
  }

  /** debug: the next n spawns come out of the tunnel (if their type can) */
  force(n = 3) {
    this.forced = n;
    return this.open ? `next ${n} spawns from the coal tunnel` : 'the basement is still closed';
  }
}
