// Wall breach: rarely (BREACH.chance per round with Boomers in it) one Boomer ignores the fireteam and
// runs for a weak spot on the farmhouse's ground-floor walls (level.breachSpots) and goes off against
// it. The wall caves in for the rest of the game: the patch that filled the spot hides, a jagged hole
// with brick / plaster / plank rubble inside and out appears in a cloud of dust, the collider opens,
// the nav grid gets a new passage and the horde a new (favoured) way in (nav/horde.js), part of the
// spawns come from that side, and a barricade kit can board it up (it becomes a barricade spot).
// A new game restores the wall. Debug: game.breach.force(id?) arms it now (spawning a Boomer if need
// be) or for the next round; game.breach.open(id) caves the wall in at once.
import * as THREE from 'three';
import { LevelBuilder, batchStatic } from './levelBuilder.js';
import { getMaterial } from './materials.js';
import { SURF } from './collision.js';
import { clamp, pick, rand } from '../core/utils.js';

export const BREACH = {
  chance: 0.01, // per round, if the wave has a Boomer
  radius: 3.2, // m from the spot's outside point: an exploding Boomer this close caves the wall in
  spawnBias: 0.35, // once open: share of the spawns that come from that side
  entranceBias: 0.35, // x the horde's random per-entrance preference (smaller: favoured)
};

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _v = new THREE.Vector3();

export class Breach {
  constructor(game, scene) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'breaches';
    scene.add(this.group);
    this.spots = (game.level.breachSpots ?? []).map((d, i) => this._build(d, i));
    this.armed = null; // the spot this round's sapper Boomer goes for
    this.sapper = null;
    this.opened = null; // the spot that caved in (one per game)
    this.forceNext = null;
  }

  // ------------------------------------------------------------------ geometry
  /** local frame of a spot: `along` the wall, `out` of it (world x/z from those) */
  _xz(s, along, out) {
    const n = out * s.n;
    return s.axis === 'x' ? [along, s.c + n] : [s.c + n, along];
  }

  _build(d, index) {
    const world = this.game.world;
    const s = { ...d, index, mid: (d.a + d.b) / 2, broken: false };
    const h = d.t / 2;
    // intact: the piece of wall the level left out, same faces / UVs / grime as the wall around it
    const PB = new LevelBuilder(world);
    const [x0, z0, x1, z1] = d.axis === 'x' ? [d.a, d.c - 1.6, d.b, d.c + 1.6] : [d.c - 1.6, d.a, d.c + 1.6, d.b];
    s.rect = [x0, x1, z0, z1]; // the wall, the rubble steps outside and a bit inside (re-rasterized on open)
    const px0 = d.axis === 'x' ? d.a : d.c - h, px1 = d.axis === 'x' ? d.b : d.c + h;
    const pz0 = d.axis === 'x' ? d.c - h : d.a, pz1 = d.axis === 'x' ? d.c + h : d.b;
    const mats = d.axis === 'x' ? { pz: d.sides.pos, nz: d.sides.neg } : { px: d.sides.pos, nx: d.sides.neg };
    const skip = d.axis === 'x' ? ['px', 'nx', 'py', 'ny'] : ['pz', 'nz', 'py', 'ny'];
    s.collider = PB.box(px0, d.y0, pz0, px1, d.y1, pz1, { mats, skip, floorY: 0, ceilY: d.ceil ?? 3.2, surface: SURF.plaster, tag: 'breach' });
    s.intact = PB.finish();
    s.intact.name = 'breach:' + d.id;
    this.group.add(s.intact);
    s.brokenGroup = this._buildBroken(s);
    s.brokenGroup.visible = false;
    this.group.add(s.brokenGroup);
    const gy = world.groundHeight(d.out[0], d.out[1], 0.2, 0.5);
    s.goal = { pos: new THREE.Vector3(d.out[0], gy > -10 ? gy : -0.5, d.out[1]), level: 1, alive: true, radius: 0.2, isGoal: true, field: null, spot: s };
    return s;
  }

  /** the caved-in look: broken masonry round the opening, the floor strip under it, rubble in and out */
  _buildBroken(s) {
    const r = mulberry(0x9e37 + s.index * 7919);
    const R = (a, b) => a + (b - a) * r();
    const B = new LevelBuilder(this.game.world);
    const h = s.t / 2;
    // the wall's own faces on its two sides, broken brick core everywhere else
    const faces = s.axis === 'x' ? { pz: s.sides.pos, nz: s.sides.neg } : { px: s.sides.pos, nx: s.sides.neg };
    const box = (a0, a1, y0, y1, lo, hi, opts) => (s.axis === 'x' ? B.box(a0, y0, lo, a1, y1, hi, opts) : B.box(lo, y0, a0, hi, y1, a1, opts));
    // a chunk of wall along [a0, a1], y [y0, y1], its two faces inset a little (broken off unevenly)
    const chunk = (a0, a1, y0, y1) => box(a0, a1, y0, y1, s.c - h + R(0, 0.07), s.c + h - R(0, 0.07), { mat: 'brick', mats: faces, floorY: 0, ceilY: s.ceil ?? 3.2, collide: false, grime: 0.6 });
    const w = s.b - s.a;
    // jambs: ragged steps sticking into the hole (thin: the passage stays as wide as the collider says)
    for (const side of [0, 1]) {
      let y = s.y0;
      while (y < s.y1 - 0.05) {
        const y1 = Math.min(s.y1, y + R(0.18, 0.5));
        const p = R(0.02, y < 0.5 ? 0.07 : 0.16);
        if (side === 0) chunk(s.a, s.a + p, y, y1);
        else chunk(s.b - p, s.b, y, y1);
        y = y1;
      }
    }
    // top: broken lintel hanging down unevenly
    let a = s.a;
    while (a < s.b - 0.05) {
      const a1 = Math.min(s.b, a + R(0.15, 0.4));
      chunk(a, a1, s.y1 - R(0.04, 0.3), s.y1);
      a = a1;
    }
    // plaster blasted off round the hole on both faces: ragged patches of bare brick, proud of the face
    for (const side of [1, -1]) {
      let layer = 0; // overlapping patches sit 4 mm apart (no z-fighting)
      const spall = (a0, a1, y0, y1) => {
        const f0 = s.c + side * (h + 0.001), f1 = s.c + side * (h + 0.004 + 0.004 * (layer++ % 5));
        box(a0, a1, Math.max(0.03, y0), y1, Math.min(f0, f1), Math.max(f0, f1), { mat: 'brick', floorY: 0, ceilY: s.ceil ?? 3.2, collide: false, grime: 0.9, shade: R(0.58, 0.78) });
      };
      const big = side === s.n ? 1 : 0.6; // more of it came off outside, where the blast was
      for (let k = 0; k < 3; k++) {
        const y0 = R(0.1, s.y1 - 0.4), y1 = Math.min(s.y1 + 0.2, y0 + R(0.2, 0.7));
        if (r() < 0.8) spall(s.a - R(0.06, 0.4) * big, s.a, y0, y1);
        const z0 = R(0.1, s.y1 - 0.4), z1 = Math.min(s.y1 + 0.2, z0 + R(0.2, 0.7));
        if (r() < 0.8) spall(s.b, s.b + R(0.06, 0.4) * big, z0, z1);
      }
      for (let k = 0; k < 2; k++) {
        const a0 = R(s.a - 0.25 * big, s.mid), a1 = Math.min(s.b + 0.25 * big, a0 + R(0.25, 0.8));
        spall(a0, a1, s.y1, s.y1 + R(0.08, 0.35) * big);
      }
    }
    // the floor strip under the old wall (the house floor stops at its inner face)
    box(s.a, s.b, -0.25, 0, s.c - h - 0.02, s.c + h + 0.02, { mat: 'concrete', collide: false, grime: 0.8 });
    // outside: a spill of rubble stepping down from the floor to the yard (the foundation stands 0.5 m
    // proud of the mud, like at the kitchen hole); colliders only while the wall is open
    s.ramp = [];
    for (let i = 0; i < 3; i++) {
      const o0 = h + i * 0.4, o1 = h + (i + 1) * 0.4 + (i === 2 ? R(0, 0.15) : 0);
      const lo = s.n > 0 ? s.c + o0 : s.c - o1, hi = s.n > 0 ? s.c + o1 : s.c - o0;
      const col = box(s.a - R(0.05, 0.25), s.b + R(0.05, 0.25), -0.5, -(i + 1) * 0.16 + R(-0.02, 0.02), lo, hi, { mat: 'brick', surface: SURF.concrete, grime: 0.4, shade: R(0.75, 0.95), tag: 'breachRubble' });
      if (col) {
        col.enabled = false;
        s.ramp.push(col);
      }
    }
    const group = B.finish();
    group.name = 'breachBroken:' + s.id;
    // rubble: bricks, plaster slabs and a few snapped studs, a fan outside (the blast came from there,
    // most of the wall fell in) and a spill inside
    const loose = new THREE.Group();
    const mats = { brick: getMaterial('brick'), plaster: getMaterial('plaster'), ext: getMaterial('plasterExterior'), wood: getMaterial('woodBeam') };
    const world = this.game.world;
    const piece = (inside, k) => {
      const kind = r();
      let sx, sy, sz, mat;
      if (kind < 0.55) {
        sx = R(0.18, 0.26);
        sy = R(0.06, 0.09);
        sz = R(0.09, 0.12);
        mat = mats.brick;
        if (r() < 0.35) {
          // a clump of mortared bricks
          sx *= R(1.5, 2.4);
          sy *= R(1.5, 2.2);
        }
      } else if (kind < 0.85) {
        sx = R(0.2, 0.5);
        sy = R(0.03, 0.06);
        sz = R(0.15, 0.35);
        mat = r() < 0.5 ? mats.plaster : mats.ext;
      } else {
        sx = R(0.7, 1.4);
        sy = R(0.04, 0.06);
        sz = R(0.08, 0.12);
        mat = mats.wood;
      }
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      // world-ish texture scale on the tiny boxes
      const mpr = mat.userData?.metersPerRepeat || 1;
      const uv = geo.attributes.uv;
      const sc = Math.max(sx, sz) / mpr;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sc, uv.getY(i) * sc * 0.6);
      const m = new THREE.Mesh(geo, mat);
      const along = s.mid + R(-0.5, 0.5) * (w + (inside ? 0.6 : 1.2));
      const dist = inside ? R(0.25, 1.6) * (0.6 + 0.4 * (k % 3)) * 0.8 : R(0.3, 2.2);
      const [x, z] = this._xz(s, along, (inside ? -1 : 1) * (h + dist));
      const floor = world.groundHeight(x, z, 0.05, inside ? 0.3 : -0.2);
      const y = (floor > -5 ? floor : inside ? 0 : -0.5) + sy / 2 - 0.01;
      m.position.set(x, y, z);
      m.rotation.set(R(-0.25, 0.25), R(0, Math.PI * 2), R(-0.25, 0.25));
      m.castShadow = true;
      m.receiveShadow = true;
      loose.add(m);
    };
    for (let k = 0; k < 16; k++) piece(false, k);
    for (let k = 0; k < 12; k++) piece(true, k);
    group.add(batchStatic(loose));
    return group;
  }

  // ------------------------------------------------------------------ rounds
  spot(id) {
    return this.spots.find((s) => s.id === id) ?? null;
  }

  /** round start: roll for a breach this round (the wave needs a Boomer to do it) */
  onRoundStart(toSpawn) {
    this.armed = null;
    this.sapper = null;
    const want = this.forceNext ?? (Math.random() < BREACH.chance ? '*' : null);
    this.forceNext = null;
    if (!want) return;
    if (!toSpawn.includes('charger')) {
      if (want === '*') return;
      toSpawn.splice(Math.floor(toSpawn.length * 0.3), 0, 'charger'); // forced: bring a Boomer for it
    }
    this._arm(want);
  }

  onRoundEnd() {
    this.armed = null;
    this.sapper = null;
  }

  _arm(id) {
    const free = this.spots.filter((s) => !s.broken);
    if (!free.length || this.opened) return null;
    const s = free.find((q) => q.id === id) ?? pick(free);
    const g = this.game;
    // the sapper's own flow field to the spot (built once per spot)
    s.goal.field ??= g.nav.makeField([{ level: 1, x: s.out[0], z: s.out[1] }], { infected: true });
    this.armed = s;
    return s;
  }

  /** every zombie spawned (game._spawnOne): the first Boomer of an armed round goes for the wall */
  onSpawn(z) {
    const s = this.armed;
    if (!s || s.broken || z.typeName !== 'charger' || this.sapper?.alive) return;
    this.sapper = z;
    z.goal = s.goal;
    z._alert(0);
  }

  /** game.explode: a Boomer going off at the armed spot caves the wall in */
  explosion(pos, radius, damage, source, opts = {}) {
    const s = this.armed;
    if (!s || s.broken || opts.weapon !== 'charger') return;
    if (Math.hypot(pos.x - s.goal.pos.x, pos.z - s.goal.pos.z) > BREACH.radius || Math.abs(pos.y - s.goal.pos.y) > 1.5) return;
    this.open(s.id, pos);
  }

  /** with a breach open, BREACH.spawnBias of the spawns come from the ring spawn point on its side */
  spawnPoint(points) {
    const s = this.opened;
    if (!s || Math.random() > BREACH.spawnBias) return null;
    const [ox, oz] = this._xz(s, s.mid, 30);
    let best = null, bd = Infinity;
    for (const p of points) {
      const d = Math.hypot(p.x - ox, p.z - oz);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ caving in
  /** cave the wall in at spot `id` (pos: where the blast was) */
  open(id, pos = null) {
    const s = typeof id === 'object' ? id : this.spot(id);
    if (!s || s.broken) return false;
    const g = this.game;
    s.broken = true;
    this.opened = s;
    this.armed = null;
    s.intact.visible = false;
    s.collider.enabled = false;
    for (const c of s.ramp) c.enabled = true;
    s.brokenGroup.visible = true;
    // nav: re-rasterize round the hole, every field re-flows; a new (favoured) way in for the horde
    const [x0, x1, z0, z1] = s.rect;
    g.nav?.refreshRect(x0 - 1, x1 + 1, z0 - 1, z1 + 1);
    const ent = (s.entrance = { id: 'breach', name: s.name, level: 1, x: s.in[0], z: s.in[1], bias: BREACH.entranceBias, breach: true });
    g.level.entrances?.push(ent);
    g.horde?.reset();
    g.barricades?.addSpot?.({ id: 'breach', name: 'WALL BREACH', level: 1, axis: s.axis, c: s.c, t: s.t, a: s.a, b: s.b, y0: s.y0, y1: s.y1 });
    if (g.barricades) g.barricades.fieldQueue = [...(g.postFields?.values() ?? [])];
    g.navT = 0;
    this._effects(s, pos);
    return true;
  }

  _effects(s, pos) {
    const g = this.game;
    const [cx, cz] = this._xz(s, s.mid, 0);
    const c = _v.set(cx, 1.1, cz);
    const fx = g.fx;
    if (fx) {
      // soot on the outside face either side of the hole (on the wall: a decal over the hole would float)
      const [nx, nz] = s.axis === 'x' ? [0, s.n] : [s.n, 0];
      for (const along of [s.a - 0.62, s.b + 0.62]) {
        const [ox, oz] = this._xz(s, along, s.t / 2 + 0.01);
        fx.decals?.scorchMark(new THREE.Vector3(ox, rand(0.7, 1.3), oz), new THREE.Vector3(nx, 0, nz), 1.1);
      }
      // dust bellowing out both sides, chips and brick bits flying in
      for (let i = 0; i < 70; i++) {
        const out = i % 3 === 0 ? 1 : -1;
        const [dx, dz] = s.axis === 'x' ? [rand(-1, 1), out * s.n * rand(0.5, 2.2)] : [out * s.n * rand(0.5, 2.2), rand(-1, 1)];
        const along = rand(s.a, s.b);
        const [px, pz] = this._xz(s, along, 0);
        fx.smoke.emit(px, rand(0.1, s.y1), pz, dx, rand(0.1, 0.9), dz, { life: rand(1.6, 3.4), size: rand(0.5, 1.1), grow: 1.3, drag: 1.6, gravity: -0.05, color: [0.52, 0.48, 0.43], alpha: 0.55 });
      }
      for (let i = 0; i < 60; i++) {
        const k = rand(2, 6.5);
        const [dx, dz] = s.axis === 'x' ? [rand(-0.8, 0.8), -s.n * k] : [-s.n * k, rand(-0.8, 0.8)];
        const [px, pz] = this._xz(s, rand(s.a, s.b), 0);
        const sh = rand(0.7, 1.1);
        fx.blood.emit(px, rand(0.2, 2), pz, dx, rand(0.5, 3.5), dz, { life: rand(0.6, 1.4), size: rand(0.03, 0.08), gravity: 9.8, drag: 0.4, color: r3(sh), alpha: 1 });
      }
    }
    const audio = g.audio;
    audio?.play('wood_bash', { position: c, volume: 1, pitch: 0.55 });
    audio?.play('plank_break', { position: c, volume: 1, pitch: 0.7 });
    audio?.play('impact_concrete', { position: c, volume: 1, pitch: 0.6 });
    setTimeout(() => {
      audio?.play('bodyfall', { position: c, volume: 1, pitch: 0.45 });
      audio?.play('plank_drop', { position: c, volume: 0.8, pitch: 0.8 });
    }, 260);
    setTimeout(() => audio?.play('wood_creak', { position: c, volume: 0.8, pitch: 0.8 }), 700);
    const p = g.player;
    if (p?.alive) g.shake?.add(clamp(1.0 - p.pos.distanceTo(c) / 26, 0.15, 0.8));
    g.hud?.banner('THE WALL IS BREACHED', `A Boomer blew open the ${s.name.toLowerCase()} wall · the infected are pouring in`, 3.2, 'danger');
    g.alertNoise?.(c, 30);
  }

  // ------------------------------------------------------------------ debug / session
  /**
   * Debug: arm a breach now (a live Boomer takes the job, else one is spawned) or, outside a fight, for
   * the next round. id: a breach spot id or null (any).
   */
  force(id = null) {
    const g = this.game;
    if (g.state !== 'combat') {
      this.forceNext = id ?? '*';
      return 'next round';
    }
    const s = this._arm(id ?? '*');
    if (!s) return 'no spot left';
    const boomer = g.zombies.list.find((z) => z.alive && z.typeName === 'charger');
    if (boomer) this.onSpawn(boomer);
    else g._spawnOne('charger');
    return s.id;
  }

  /** new game: every wall whole again */
  reset() {
    const g = this.game;
    for (const s of this.spots) {
      if (!s.broken) continue;
      s.broken = false;
      s.intact.visible = true;
      s.collider.enabled = true;
      for (const c of s.ramp) c.enabled = false;
      s.brokenGroup.visible = false;
      const [x0, x1, z0, z1] = s.rect;
      g.nav?.refreshRect(x0 - 1, x1 + 1, z0 - 1, z1 + 1);
      const list = g.level.entrances;
      if (list && s.entrance) {
        const i = list.indexOf(s.entrance);
        if (i >= 0) list.splice(i, 1);
      }
      s.entrance = null;
    }
    g.barricades?.removeSpot?.('breach');
    this.opened = null;
    this.armed = null;
    this.sapper = null;
    this.forceNext = null;
  }
}

function r3(k) {
  return [0.5 * k, 0.42 * k, 0.36 * k];
}
