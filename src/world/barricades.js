// Barricades: store kits nailed across the farmhouse doorways (level.barricadeSpots). With the kit
// equipped (slot 5) the player aims at a doorway within reach and holds fire: ~1.2 s of hammering,
// then six planks go up (or a damaged barricade is patched back to full). One kit per job.
// An intact barricade
//   * blocks the infected and the fireteam (collider) but not bullets or grenades (FLAG_NOBULLET):
//     you shoot through the gaps;
//   * stays passable in the flow field the infected follow, at an extra cost (some take another
//     entrance), while the bots' post fields treat it as closed (navgrid cost / fieldCost);
//   * is clawed at by every infected that runs into it (Zombie.update → engage, _updateAttack → hit),
//     blown in by Boomers (and, less, by explosives), hacked apart by the knife. Every 1/6 of its HP
//     a plank tears off and clatters to the floor; at 0 the doorway is open again.
// Barricades persist between rounds (Endless too); a new game starts with bare doorways. A wall breach
// (world/breach.js) adds its hole as a spot for the rest of that game (addSpot / removeSpot).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SURF, FLAG_NOBULLET, FLAG_NAVIGNORE } from './collision.js';
import { getMaterial } from './materials.js';
import { levelOf } from './level.js';
import { plankGeo } from '../player/barricadeKit.js';
import { clamp, rand, smoothstep } from '../core/utils.js';

export const BARRICADE = {
  hp: 600,
  planks: 6,
  buildTime: 1.2, // s of holding fire
  strike: 0.3, // s per hammer blow (4 blows per job)
  range: 2.5, // m from the doorway
  navCost: 12, // extra flow-field cost (cells ≈ 6 m of detour) through an intact barricade
  portalCost: 6, // extra m on a stair portal whose doorway is barricaded
  debrisMax: 40,
};

// damage of one claw swipe on the planks (× difficulty damage); unlisted types: 2.5 × their hit damage
const CLAW = { mauler: 30, striker: 28, dog: 16, crusher: 170 };
const PLANK_T = 0.03;
const solid = (b) => (b.flags & FLAG_NOBULLET) === 0;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _hit = {};

function rng(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashStr = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;

/** Ray (o, unit d) vs axis-aligned box: entry distance or -1. */
function rayBox(o, d, b) {
  let t0 = 0, t1 = Infinity;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]]) {
    if (Math.abs(dd) < 1e-8) {
      if (oo < lo || oo > hi) return -1;
      continue;
    }
    let a = (lo - oo) / dd, c = (hi - oo) / dd;
    if (a > c) [a, c] = [c, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, c);
    if (t0 > t1) return -1;
  }
  return t0;
}

export class Barricades {
  constructor(game, scene) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'barricades';
    scene.add(this.group);
    this.debris = new THREE.Group();
    this.debris.name = 'barricadeDebris';
    scene.add(this.debris);
    // the same weathered boards as the boarded-up windows (woodFloor: one board per plank, no seams)
    const wood = getMaterial('woodFloor');
    this.mpr = wood.userData.metersPerRepeat || 2;
    this.mats = [wood, getMaterial('woodFloor', { color: 0xe6dccd }), getMaterial('woodFloor', { color: 0xd2c6b6 })];
    this.nailMat = new THREE.MeshStandardMaterial({ color: 0x4a4b4e, roughness: 0.45, metalness: 0.85 });
    const ghost = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });
    this.ghostOk = ghost(0x8fe0a0, 0.2);
    this.ghostBad = ghost(0xff4a38, 0.24);
    this.ghostHint = ghost(0xb8d4e8, 0.07);
    this.pieces = []; // loose planks on the floor
    this.popping = []; // freshly nailed planks sliding into place
    this.fieldQueue = []; // bot post fields waiting to be re-flowed
    this.building = null; // { spot, side, t, strikes }
    this.prompt = null; // HUD interact line
    this.hold = null; // HUD hold ring 0..1
    this.holdLabel = null; // and its caption
    this.intact = 0;
    this.time = 0;
    const nav = game.nav;
    if (nav) {
      nav.cost = new Float32Array(nav.N);
      nav.fieldCost = new Float32Array(nav.N);
    }
    this.spots = (game.level.barricadeSpots ?? []).map((d, i) => this._initSpot(d, i));
  }

  // ------------------------------------------------------------------ setup
  _initSpot(def, index) {
    const s = { ...def, index, w: def.b - def.a, h: def.y1 - def.y0, mid: (def.a + def.b) / 2 };
    s.half = def.t / 2 + 0.12; // collider half depth: the wall plus planks on either face
    s.forced = def.side ?? 0; // planks always on this face (0: the builder's side)
    s.hp = 0;
    s.maxHp = BARRICADE.hp;
    s.side = 0; // face the planks are on
    s.left = 0;
    s.order = [];
    s.sides = {};
    const w = this.game.world;
    const flags = FLAG_NOBULLET | FLAG_NAVIGNORE;
    s.collider =
      def.axis === 'x'
        ? w.add(def.a, def.y0, def.c - s.half, def.b, def.y1, def.c + s.half, SURF.wood, flags, 'barricade')
        : w.add(def.c - s.half, def.y0, def.a, def.c + s.half, def.y1, def.b, SURF.wood, flags, 'barricade');
    s.collider.enabled = false;
    s.portalRef = def.portal ? this.game.level.portals?.find((p) => p.id === def.portal) ?? null : null;
    if (s.portalRef) s.portalRef.baseCost ??= s.portalRef.cost;
    s.cells = def.portal ? [] : this._cells(s);
    return s;
  }

  /** Walkable nav cells in the doorway band (the doorway itself plus a cell or so either side). */
  _cells(s) {
    const nav = this.game.nav;
    if (!nav) return [];
    const out = [];
    const rows = new Set();
    const a0 = s.a - 0.3, a1 = s.b + 0.3, c0 = s.c - s.t / 2 - 0.3, c1 = s.c + s.t / 2 + 0.3;
    const st = nav.cell / 2;
    for (let c = c0; c <= c1 + 1e-6; c += st) {
      for (let a = a0; a <= a1 + 1e-6; a += st) {
        const x = s.axis === 'x' ? a : c, z = s.axis === 'x' ? c : a;
        const i = nav.index(s.level, x, z);
        if (i < 0 || !nav.walk[i] || out.includes(i)) continue;
        out.push(i);
        rows.add(Math.floor(((s.axis === 'x' ? z - nav.minZ : x - nav.minX)) / nav.cell));
      }
    }
    s.cellCost = BARRICADE.navCost / Math.max(1, rows.size);
    return out;
  }

  /** Planks of one face: `side` = which face of the wall (+1: +normal). Built lazily, kept. */
  _side(s, side) {
    if (s.sides[side]) return s.sides[side];
    // origin on the wall face at the opening's bottom centre; local +Z out of the wall, +X along it
    const o = s.axis === 'x' ? new THREE.Vector3(s.mid, s.y0, s.c + (side * s.t) / 2) : new THREE.Vector3(s.c + (side * s.t) / 2, s.y0, s.mid);
    const yaw = s.axis === 'x' ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
    const group = new THREE.Group();
    const ghost = new THREE.Group();
    for (const g of [group, ghost]) {
      g.position.copy(o);
      g.rotation.y = yaw;
      g.visible = false;
      this.group.add(g);
    }
    const planks = [], ghosts = [];
    this._layout(s, side).forEach((L, i) => {
      const geo = plankGeo(L.len, L.w, PLANK_T, { mpr: this.mpr, grain: 'u', seed: s.index * 17 + i * 3 + (side > 0 ? 0 : 101) });
      const pl = new THREE.Group();
      pl.position.set(L.x, L.y, L.z);
      pl.rotation.z = L.ang;
      const pm = new THREE.Mesh(geo, this.mats[(i + s.index) % this.mats.length]);
      pm.castShadow = true;
      pm.receiveShadow = true;
      pl.add(pm);
      pl.add(new THREE.Mesh(this._nailGeo(L), this.nailMat));
      pl.userData = { rest: pl.position.clone(), len: L.len, w: L.w };
      pl.visible = false;
      group.add(pl);
      planks.push(pl);
      const gm = new THREE.Mesh(geo, this.ghostOk);
      gm.position.copy(pl.position);
      gm.rotation.copy(pl.rotation);
      gm.renderOrder = 8;
      ghost.add(gm);
      ghosts.push(gm);
    });
    return (s.sides[side] = { group, ghost, planks, ghosts });
  }

  /** Four rough horizontal boards against the wall, two cross braces nailed over them. */
  _layout(s, side) {
    const r = rng(hashStr(s.id) + (side > 0 ? 0 : 7919));
    const W = s.w, H = s.h, T = PLANK_T;
    const out = [];
    [0.17, 0.4, 0.63, 0.86].forEach((f, i) => {
      out.push({ len: W + 0.3 + r() * 0.14, w: 0.14 + r() * 0.05, x: (r() - 0.5) * 0.1, y: H * f + (r() - 0.5) * 0.08, ang: (r() - 0.5) * 0.14, z: T / 2 + 0.004 + (i % 2) * 0.002, diag: false });
    });
    const dx = W + 0.12;
    for (let k = 0; k < 2; k++) {
      const lo = H * (0.22 + r() * 0.07), hi = H * (0.72 + r() * 0.07);
      const ang = Math.atan2(hi - lo, dx) * (k ? -1 : 1);
      out.push({ len: Math.hypot(dx, hi - lo) + 0.1, w: 0.15 + r() * 0.03, x: 0, y: (lo + hi) / 2, ang, z: T * (1.5 + k) + 0.008 + k * 0.004, diag: true });
    }
    return out;
  }

  _nailGeo(L) {
    const heads = [];
    const at = (x, y) => {
      const g = new THREE.CylinderGeometry(0.0065, 0.006, 0.004, 8);
      g.rotateX(Math.PI / 2);
      g.translate(x + rand(-0.006, 0.006), y + rand(-0.006, 0.006), PLANK_T / 2 + 0.0015);
      heads.push(g);
    };
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) at(sx * (L.len / 2 - 0.07), (sy * L.w) / 4);
    if (L.diag) at(0, 0);
    return mergeGeometries(heads);
  }

  // ------------------------------------------------------------------ state
  _unlocked(s) {
    return !s.requires || !!this.game.unlocked?.[s.requires];
  }

  /** Forced face, else the face toward `pos`. */
  _sideFor(s, pos) {
    if (s.forced) return s.forced;
    if (s.side !== 0 && s.hp > 0) return s.side;
    return s.axis === 'x' ? (pos.z >= s.c ? 1 : -1) : pos.x >= s.c ? 1 : -1;
  }

  /** Is a body (feet `p`, radius r) standing in the doorway? */
  _inDoor(s, p, r) {
    if (Math.abs(p.y - s.y0) > 1.2) return false;
    const al = s.axis === 'x' ? p.x : p.z, ac = s.axis === 'x' ? p.z : p.x;
    return al > s.a - r && al < s.b + r && Math.abs(ac - s.c) < s.half + r;
  }

  _status(s) {
    if (s.hp >= s.maxHp) return 'full';
    if (s.hp > 0) return 'repair';
    const g = this.game;
    if (this._inDoor(s, g.player.pos, 0.35)) return 'inside';
    for (const m of g.team ?? []) if (m !== g.player && m.alive && this._inDoor(s, m.pos, 0.35)) return 'blocked';
    for (const z of g.zombies?.list ?? []) if (z.alive && this._inDoor(s, z.pos, z.type.radius)) return 'blocked';
    return 'new';
  }

  /** The doorway the crosshair is on (within reach, nothing solid in between), or null. */
  _aim() {
    const g = this.game, p = g.player, cam = g.camera;
    const o = cam.position;
    cam.getWorldDirection(_d);
    const lvl = levelOf(p.pos.y + 0.3);
    let best = null, bt = Infinity;
    for (const s of this.spots) {
      if (s.level !== lvl || !this._unlocked(s)) continue;
      const al = s.axis === 'x' ? p.pos.x : p.pos.z, ac = s.axis === 'x' ? p.pos.z : p.pos.x;
      if (Math.hypot(al - clamp(al, s.a, s.b), ac - s.c) > BARRICADE.range + 0.2) continue;
      if (this._inDoor(s, p.pos, 0.2)) return s; // standing in it: tell them to step out
      const dn = s.axis === 'x' ? _d.z : _d.x, on = s.axis === 'x' ? o.z : o.x;
      if (Math.abs(dn) < 1e-3) continue;
      const t = (s.c - on) / dn;
      if (t < 0.05 || t > BARRICADE.range + 1.2 || t >= bt) continue;
      const ha = s.axis === 'x' ? o.x + _d.x * t : o.z + _d.z * t;
      const hy = o.y + _d.y * t;
      if (ha < s.a - 0.35 || ha > s.b + 0.35 || hy < s.y0 - 0.4 || hy > s.y1 + 0.35) continue;
      // nothing solid before the wall face (the face itself is fine: aiming at the jamb counts)
      const tf = Math.max(0.02, t - (s.t / 2 + 0.05) / Math.abs(dn));
      if (g.world.raycast(o.x, o.y, o.z, _d.x, _d.y, _d.z, tf, solid, _hit)) continue;
      bt = t;
      best = s;
    }
    return best;
  }

  _showGhost(s, side, mat, onlyMissing) {
    const S = this._side(s, side);
    S.ghost.visible = true;
    const own = s.side === side && s.hp > 0;
    S.ghosts.forEach((gm, i) => {
      gm.material = mat;
      gm.visible = !onlyMissing || !own || !S.planks[i].visible;
    });
  }

  // ------------------------------------------------------------------ update
  update(dt, input) {
    const g = this.game;
    this.time += dt;
    if (this._state === 'combat' && g.state !== 'combat') for (const p of this.pieces) p.fade = true; // round over: the debris goes
    this._state = g.state;
    this._updateBuild(dt, input);
    this._updatePop(dt);
    this._updatePieces(dt);
    if (this.fieldQueue.length) this.fieldQueue.pop().recompute();
    else if (this.intact && (this._botT = (this._botT ?? 0) - dt) <= 0) {
      this._botT = 1;
      this._rehomeBots();
    }
  }

  /** A bot whose defense post is sealed off by barricades picks the nearest post it can still reach. */
  _rehomeBots() {
    const g = this.game, nav = g.nav;
    if (!nav || !g.navFieldFor) return;
    for (const b of g.team ?? []) {
      if (b.isPlayer || !b.alive || !b.post || !b.field) continue;
      const i = nav.nearestWalkable(b.level ?? levelOf(b.pos.y + 0.3), b.pos.x, b.pos.z, 2);
      if (i < 0 || b.field.dist[i] < Infinity) continue;
      let best = null, bd = Infinity;
      for (const post of g.level.defensePosts) {
        if (g.team.some((t) => t !== b && t.post === post)) continue;
        const d = g.navFieldFor(post).dist[i];
        if (d < bd) {
          bd = d;
          best = post;
        }
      }
      if (!best) continue;
      b.post = best;
      b.field = g.navFieldFor(best);
      b.postT = rand(10, 18);
    }
  }

  _updateBuild(dt, input) {
    const g = this.game, w = g.weapons, p = g.player;
    this.prompt = null;
    this.hold = null;
    w.buildT = null;
    w.buildStrike = BARRICADE.strike;
    for (const s of this.spots) for (const k in s.sides) s.sides[k].ghost.visible = false;
    const st = g.state;
    const equipped = g.running && p.alive && w.def?.mode === 'build' && (st === 'combat' || st === 'shop' || st === 'intermission');
    if (!equipped) {
      this.building = null;
      return;
    }
    // faint hints on the free / damaged doorways around you
    const lvl = levelOf(p.pos.y + 0.3);
    for (const s of this.spots) {
      if (s.level !== lvl || !this._unlocked(s) || s.hp >= s.maxHp) continue;
      const al = s.axis === 'x' ? p.pos.x : p.pos.z, ac = s.axis === 'x' ? p.pos.z : p.pos.x;
      if (Math.hypot(al - s.mid, ac - s.c) > 16) continue;
      this._showGhost(s, this._sideFor(s, p.pos), this.ghostHint, true);
    }
    const s = this._aim();
    if (!s) {
      this.building = null;
      this.prompt = 'Aim at a DOORWAY to barricade it';
      return;
    }
    const status = this._status(s);
    const side = this._sideFor(s, p.pos);
    if (status === 'full') {
      this.building = null;
      this.prompt = `${s.name} barricade intact`;
      return;
    }
    if (status === 'inside' || status === 'blocked') {
      this.building = null;
      this._showGhost(s, side, this.ghostBad, true);
      this.prompt = status === 'inside' ? 'Step out of the DOORWAY to barricade it' : `The ${s.name} is blocked`;
      return;
    }
    this._showGhost(s, side, this.ghostOk, true);
    this.prompt = status === 'repair' ? `Hold [LMB] to repair the ${s.name} barricade (${Math.round((s.hp / s.maxHp) * 100)}%)` : `Hold [LMB] to barricade the ${s.name}`;
    if (!(input && input.mouse(0) && w.state === 'idle' && w.barricades > 0)) {
      this.building = null;
      return;
    }
    if (!this.building || this.building.spot !== s || this.building.side !== side) this.building = { spot: s, side, t: 0, strikes: 0 };
    const b = this.building;
    b.t += dt;
    w.buildT = b.t;
    this.hold = Math.min(1, b.t / BARRICADE.buildTime);
    this.holdLabel = status === 'repair' ? 'REPAIRING THE BARRICADE' : 'NAILING UP THE PLANKS';
    p.noSprint = true;
    const n = Math.floor(b.t / BARRICADE.strike + 0.28); // blows land at 72 % of each beat (viewmodel.js)
    while (b.strikes < n) {
      b.strikes++;
      this._strike(s, side);
    }
    if (b.t >= BARRICADE.buildTime) {
      this.building = null;
      this._complete(s, side);
    }
  }

  _strike(s, side) {
    const g = this.game;
    const S = this._side(s, side);
    _v.set(rand(-0.35, 0.35) * s.w, rand(0.9, 1.4), 0.05).applyEuler(_e.set(0, S.group.rotation.y, 0)).add(S.group.position);
    g.audio.play('hammer_nail', { position: _v, volume: 0.85 });
    g.shake?.add(0.012);
    _d.set(0, 0.3, 1).applyEuler(_e);
    this._splinters(_v, _d, 0.35);
  }

  _complete(s, side) {
    const g = this.game, w = g.weapons;
    w.barricades = Math.max(0, (w.barricades ?? 0) - 1);
    if (!(s.hp > 0) || s.side !== side) {
      for (const k in s.sides) {
        s.sides[k].group.visible = false;
        for (const pl of s.sides[k].planks) pl.visible = false;
      }
      s.side = side;
    }
    s.hp = s.maxHp;
    s.left = BARRICADE.planks;
    const S = this._side(s, side);
    S.group.visible = true;
    let k = 0;
    for (const pl of S.planks) {
      if (pl.visible) continue;
      pl.userData.pop = -k++ * 0.05;
      pl.position.z = pl.userData.rest.z + 0.15;
      this.popping.push(pl);
    }
    // planks come off in a random order
    s.order = [...Array(BARRICADE.planks).keys()].sort(() => Math.random() - 0.5);
    s.collider.enabled = true;
    _v.copy(S.group.position).setY(s.y0 + 1.1);
    g.audio.play('hammer_nail', { position: _v, volume: 1, pitch: 0.9 });
    g.audio.play('wood_creak', { position: _v, volume: 0.35 });
    this._syncNav();
    if (w.barricades <= 0 && w.cur === 4) {
      // out of kits: back to the last weapon (a gun if that was an empty throwable slot)
      const back = w.prev === 4 || (w.prev === 3 && w.grenades + w.molotovs <= 0) ? 0 : w.prev;
      w.switchTo(back, true);
    }
  }

  _updatePop(dt) {
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const pl = this.popping[i];
      const u = pl.userData;
      u.pop += dt;
      pl.visible = u.pop >= 0;
      const k = smoothstep(0, 0.12, u.pop);
      pl.position.z = u.rest.z + (1 - k) * 0.15;
      if (k >= 1) this.popping.splice(i, 1);
    }
  }

  // ------------------------------------------------------------------ the infected vs. the planks
  /**
   * Called by a zombie that is free to attack while it moves (wantX/Z = where it wants to go): if an
   * intact barricade is right in front of it and in its way, it starts clawing at it (a Boomer lights
   * its fuse). Returns true if it engaged.
   */
  engage(z, wx, wz) {
    if (!this.intact) return false;
    const len = Math.hypot(wx, wz);
    if (len < 1e-3) return false;
    wx /= len;
    wz /= len;
    const p = z.pos, r = z.type.radius;
    for (const s of this.spots) {
      if (!(s.hp > 0) || Math.abs(p.y - s.y0) > 1.2) continue;
      const al = s.axis === 'x' ? p.x : p.z, off = (s.axis === 'x' ? p.z : p.x) - s.c;
      if ((al < s.a ? s.a - al : al > s.b ? al - s.b : 0) > r * 0.9) continue;
      if (Math.abs(off) - s.half > r + 0.45) continue;
      if ((s.axis === 'x' ? wz : wx) * -Math.sign(off) < 0.25) continue; // not heading into it
      const audio = this.game.audio;
      if (z.type.explodes) {
        if (z.fuse < 0) {
          z.fuse = 0;
          audio.play('charger_fuse', { position: p, volume: 1 });
        }
        return true;
      }
      z.attackT = 0;
      z.attackHit = false;
      z.barricade = s;
      if (Math.random() < 0.6) audio.play('zombie_attack', { position: p, volume: 0.7, pitch: z.typeName === 'crusher' ? 0.6 : z.typeName === 'striker' ? 1.3 : z.type.pitch ?? 1 });
      return true;
    }
    return false;
  }

  /** The yaw that faces zombie position `p` at the barricade. */
  faceYaw(s, p) {
    const off = (s.axis === 'x' ? p.z : p.x) - s.c;
    const sg = off >= 0 ? -1 : 1;
    return s.axis === 'x' ? (sg > 0 ? 0 : Math.PI) : sg > 0 ? Math.PI / 2 : -Math.PI / 2;
  }

  /** A claw swipe of zombie `z` lands on barricade `s`. */
  hit(s, z) {
    if (!(s.hp > 0)) return;
    const g = this.game;
    const crusher = z.typeName === 'crusher';
    const dmg = (CLAW[z.typeName] ?? (z.type.dmg || 10) * 2.5) * (g.difficultyDamage ?? 1);
    const p = z.pos;
    const sg = Math.sign((s.axis === 'x' ? p.z : p.x) - s.c) || 1;
    const al = clamp(s.axis === 'x' ? p.x : p.z, s.a + 0.15, s.b - 0.15);
    const y = Math.min(s.y1 - 0.2, p.y + (z.quad ? 0.55 : 1.25 * (z.scale ?? 1)));
    const face = s.c + sg * (s.t / 2 + 0.05);
    const pt = s.axis === 'x' ? _v2.set(al, y, face) : _v2.set(face, y, al);
    _d.set(s.axis === 'x' ? 0 : -sg, 0.25, s.axis === 'x' ? -sg : 0);
    this._splinters(pt, _d, crusher ? 2.2 : 1);
    g.audio.play('wood_bash', { position: pt, volume: crusher ? 1 : 0.85, pitch: crusher ? 0.72 : rand(0.95, 1.1) });
    if (crusher && g.player?.alive) g.shake?.add(clamp(0.3 - g.player.pos.distanceTo(pt) / 30, 0, 0.25));
    this._damage(s, dmg, p, false);
  }

  /** game.explode: Boomers blow barricades in, the fireteam's own explosives only chip them. */
  explosion(pos, radius, damage, source, opts = {}) {
    if (!this.intact) return;
    const boomer = opts.weapon === 'charger';
    const mult = boomer ? 3.2 : source && (source.isPlayer || source.stats) ? 0.5 : 1.5;
    const world = this.game.world;
    for (const s of this.spots) {
      if (!(s.hp > 0)) continue;
      const b = s.collider;
      _v.set(clamp(pos.x, b.minX, b.maxX), clamp(pos.y, b.minY, b.maxY), clamp(pos.z, b.minZ, b.maxZ));
      const d = _v.distanceTo(pos);
      if (d > radius) continue;
      const los = world.lineOfSight(pos.x, pos.y + 0.5, pos.z, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      const k = 1 - d / radius;
      _d.subVectors(_v, pos).setY(0.3).normalize();
      this._splinters(_v.setY(clamp(pos.y + 0.8, b.minY + 0.3, b.maxY - 0.3)), _d, 2.5);
      this._damage(s, damage * mult * (0.3 + 0.7 * k) * (los ? 1 : 0.25), pos, true);
    }
  }

  /** game.meleeAttack with no infected in reach: the knife hacks at a barricade. True if it hit one. */
  melee(eye, fwd, range, damage) {
    if (!this.intact) return false;
    let best = null, bt = range + 0.25;
    for (const s of this.spots) {
      if (!(s.hp > 0)) continue;
      const t = rayBox(eye, fwd, s.collider);
      if (t >= 0 && t < bt) {
        bt = t;
        best = s;
      }
    }
    if (!best || this.game.world.raycast(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, bt, solid, _hit)) return false;
    const pt = _v2.copy(eye).addScaledVector(fwd, bt);
    _d.copy(fwd).negate().setY(0.4);
    this._splinters(pt, _d, 1);
    this.game.audio.play('wood_bash', { position: pt, volume: 0.75, pitch: 1.15 });
    this._damage(best, damage, eye, false);
    return true;
  }

  _damage(s, amount, from, blast) {
    if (!(s.hp > 0) || !(amount > 0)) return;
    s.hp = Math.max(0, s.hp - amount);
    const keep = s.hp <= 0 ? 0 : Math.ceil((s.hp / s.maxHp) * BARRICADE.planks - 1e-6);
    while (s.left > keep) this._dropPlank(s, from, blast);
    if (s.hp <= 0) this._break(s);
  }

  _break(s) {
    const g = this.game;
    s.hp = 0;
    s.left = 0;
    s.collider.enabled = false;
    _v.set(s.axis === 'x' ? s.mid : s.c, s.y0 + 1.1, s.axis === 'x' ? s.c : s.mid);
    g.audio.play('plank_break', { position: _v, volume: 1, pitch: 0.85 });
    g.audio.play('wood_creak', { position: _v, volume: 0.6 });
    this._syncNav();
  }

  /** Tear the next plank off and throw it: into the room (away from the claws) or off a blast. */
  _dropPlank(s, from, blast) {
    const S = s.sides[s.side];
    const idx = s.order[BARRICADE.planks - s.left];
    s.left--;
    const pl = S?.planks[idx];
    if (!pl || !pl.visible) return;
    const pi = this.popping.indexOf(pl);
    if (pi >= 0) this.popping.splice(pi, 1);
    pl.position.copy(pl.userData.rest);
    pl.updateWorldMatrix(true, false);
    pl.visible = false;
    const o = pl.clone();
    o.visible = true;
    pl.matrixWorld.decompose(o.position, o.quaternion, o.scale);
    this.debris.add(o);
    const n = s.axis === 'x' ? _v.set(0, 0, s.side) : _v.set(s.side, 0, 0);
    const vel = new THREE.Vector3();
    if (blast && from) {
      vel.subVectors(o.position, from).setY(0).normalize().multiplyScalar(rand(2.5, 4)).add(n.multiplyScalar(0.8));
      vel.y = rand(1.5, 3);
    } else {
      vel.copy(n).multiplyScalar(rand(0.7, 1.7));
      vel.y = rand(0.2, 1.1);
      const along = s.axis === 'x' ? _v2.set(1, 0, 0) : _v2.set(0, 0, 1);
      vel.addScaledVector(along, rand(-0.5, 0.5));
    }
    const u = pl.userData;
    this.pieces.push({ obj: o, vel, spin: new THREE.Vector3(rand(-3, 3), rand(-2, 2), rand(-5, 5)), len: u.len, w: u.w, rest: false, landed: false, bounced: false, fade: false, sink: 0, floor: 0, flat: null });
    this.game.audio.play('plank_break', { position: o.position, volume: 0.85 });
    this._splinters(o.position, _d.copy(vel).normalize(), 1.2);
    // too many boards on the floor: the oldest resting ones sink away
    let extra = this.pieces.length - BARRICADE.debrisMax;
    for (const p of this.pieces) {
      if (extra <= 0) break;
      if (!p.fade) {
        p.fade = true;
        extra--;
      }
    }
  }

  /** Half height of a loose plank's box in world space (its lowest point is centre.y minus this). */
  _extentY(p) {
    const q = p.obj.quaternion;
    return Math.abs(_v.set(1, 0, 0).applyQuaternion(q).y) * (p.len / 2) + Math.abs(_v.set(0, 1, 0).applyQuaternion(q).y) * (p.w / 2) + Math.abs(_v.set(0, 0, 1).applyQuaternion(q).y) * (PLANK_T / 2);
  }

  _updatePieces(dt) {
    const world = this.game.world;
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      const o = p.obj;
      if (p.rest && p.fade) {
        // resting and done: sink through the floor, then gone
        p.sink += dt;
        o.position.y -= dt * 0.05;
        if (p.sink > 1.4) {
          this.debris.remove(o);
          this.pieces.splice(i, 1);
        }
        continue;
      }
      if (!p.rest) {
        p.vel.y -= 9.8 * dt;
        o.position.addScaledVector(p.vel, dt);
        o.quaternion.multiply(_q.setFromEuler(_e.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt)));
        const ext = this._extentY(p);
        const gy = world.groundHeight(o.position.x, o.position.z, 0.05, o.position.y + 0.3);
        if (gy === -Infinity) {
          if (o.position.y < -20) p.rest = p.fade = true;
          continue;
        }
        if (o.position.y - ext <= gy) {
          o.position.y = gy + ext;
          if (!p.landed) {
            p.landed = true;
            this.game.audio.play('plank_drop', { position: o.position, volume: clamp(0.35 - p.vel.y * 0.12, 0.35, 0.9) });
          }
          if (p.vel.y < -2.2 && !p.bounced) {
            p.bounced = true;
            p.vel.set(p.vel.x * 0.45, -p.vel.y * 0.25, p.vel.z * 0.45);
            p.spin.multiplyScalar(0.35);
          } else {
            p.rest = true;
            p.floor = gy;
            p.vel.y = 0;
            p.flat = this._flat(o.quaternion);
          }
        }
      } else if (p.flat) {
        // tip over flat onto the floor, sliding to a stop
        o.quaternion.slerp(p.flat, 1 - Math.exp(-10 * dt));
        p.vel.x *= Math.exp(-8 * dt);
        p.vel.z *= Math.exp(-8 * dt);
        o.position.x += p.vel.x * dt;
        o.position.z += p.vel.z * dt;
        o.position.y = p.floor + this._extentY(p);
        if (o.quaternion.angleTo(p.flat) < 0.002) {
          o.quaternion.copy(p.flat);
          p.flat = null;
        }
      }
    }
  }

  /** The orientation lying flat on the floor closest to `q` (length horizontal, broad face up/down). */
  _flat(q) {
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q).setY(0);
    if (x.lengthSq() < 1e-4) x.set(1, 0, 0);
    x.normalize();
    const z = new THREE.Vector3(0, new THREE.Vector3(0, 0, 1).applyQuaternion(q).y >= 0 ? 1 : -1, 0);
    const y = new THREE.Vector3().crossVectors(z, x);
    return new THREE.Quaternion().setFromRotationMatrix(_m.makeBasis(x, y, z));
  }

  /** Wood chips and dust from `pt`, thrown along `dir` (own temporaries: pt / dir may be shared ones). */
  _splinters(pt, dir, n = 1) {
    const fx = this.game.fx;
    if (!fx) return;
    const x = pt.x, y = pt.y, z = pt.z, dx = dir.x, dy = dir.y, dz = dir.z;
    for (let i = 0, c = Math.round(7 * n); i < c; i++) {
      const k = rand(1.2, 3.4), sh = rand(0.75, 1.15);
      fx.blood.emit(x, y, z, dx * k + rand(-1.3, 1.3), dy * k + rand(-0.2, 2), dz * k + rand(-1.3, 1.3), { life: rand(0.4, 0.9), size: rand(0.014, 0.04), gravity: 9.8, drag: 0.5, color: [0.36 * sh, 0.26 * sh, 0.16 * sh], alpha: 1 });
    }
    for (let i = 0, c = Math.round(3 * n); i < c; i++) {
      const k = rand(0.3, 0.9);
      fx.smoke.emit(x, y, z, dx * k + rand(-0.3, 0.3), dy * k + rand(0, 0.4), dz * k + rand(-0.3, 0.3), { life: rand(0.6, 1.2), size: rand(0.14, 0.26), grow: 0.6, drag: 3, gravity: -0.04, color: [0.34, 0.28, 0.22], alpha: 0.5 });
    }
  }

  // ------------------------------------------------------------------ nav
  _syncNav() {
    const g = this.game, nav = g.nav;
    this.intact = this.spots.reduce((n, s) => n + (s.hp > 0 ? 1 : 0), 0);
    if (!nav?.cost) return;
    nav.cost.fill(0);
    nav.fieldCost.fill(0);
    for (const s of this.spots) {
      const on = s.hp > 0;
      if (s.portalRef) s.portalRef.cost = s.portalRef.baseCost + (on ? BARRICADE.portalCost : 0);
      if (!on) continue;
      for (const i of s.cells) {
        nav.cost[i] = s.cellCost;
        nav.fieldCost[i] = Infinity;
      }
    }
    g.navT = 0; // the infected re-flow next frame
    this.fieldQueue = [...(g.postFields?.values() ?? []), ...(g.horde?.fields.values() ?? [])]; // bots' post fields + the infected's entrance routes, one per frame
  }

  // ------------------------------------------------------------------ session
  /** New game: bare doorways, no debris. */
  reset() {
    for (const s of this.spots) {
      s.hp = 0;
      s.left = 0;
      s.side = 0;
      s.collider.enabled = false;
      for (const k in s.sides) {
        s.sides[k].group.visible = false;
        s.sides[k].ghost.visible = false;
        for (const pl of s.sides[k].planks) pl.visible = false;
      }
    }
    for (const p of this.pieces) this.debris.remove(p.obj);
    this.pieces.length = 0;
    this.popping.length = 0;
    this.building = null;
    this.prompt = null;
    this.hold = null;
    this._syncNav();
  }

  spot(id) {
    return this.spots.find((s) => s.id === id) ?? null;
  }

  /** A doorway that appeared mid-game (a wall breach, world/breach.js): boardable from now on. */
  addSpot(def) {
    if (this.spot(def.id)) return this.spot(def.id);
    let s = this._spare?.get(def.id);
    if (s) {
      s.cells = this._cells(s); // the nav round it changed
    } else s = this._initSpot(def, this.spots.length);
    this.spots.push(s);
    return s;
  }

  /** ...and gone again (a new game): planks off, collider off, kept aside for reuse */
  removeSpot(id) {
    const i = this.spots.findIndex((s) => s.id === id);
    if (i < 0) return;
    const s = this.spots[i];
    s.hp = 0;
    s.left = 0;
    s.side = 0;
    s.collider.enabled = false;
    for (const k in s.sides) {
      s.sides[k].group.visible = false;
      s.sides[k].ghost.visible = false;
      for (const pl of s.sides[k].planks) pl.visible = false;
    }
    if (this.building?.spot === s) this.building = null;
    this.spots.splice(i, 1);
    (this._spare ??= new Map()).set(id, s);
    this._syncNav();
  }

  /** Debug / tests: nail up (or repair) a doorway without a kit. */
  place(id, side = 1) {
    const s = this.spot(id);
    if (!s) return false;
    const w = this.game.weapons;
    const had = w.barricades;
    w.barricades = 2; // _complete uses one (and switches weapons only when none are left)
    this._complete(s, s.forced || side);
    w.barricades = had;
    return true;
  }
}
