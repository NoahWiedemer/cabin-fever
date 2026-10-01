// The Sand Hog militia (Desert Thunder: game/desertMission.js): the mission's enemies, people with guns instead of the
// infected. Teammate bodies (procedural, actors/rig.js 'hog*': shemaghs, caps and goggles, the royal guard's black
// armour) with brains and weapons of their own, by role:
//   rifle   the scouts' AKs: they hold 9-20 m off, fire bursts, sidestep now and then, close in when they lose you
//   rpg     a patrol's RPG-7: from 12-42 m a rocket you can see coming (a blast where it lands), then a long reload
//   sniper  a bolt rifle from a window or a roof it never leaves: a red laser settles on you before it fires
//   guard   the royal guard: black armour (the body takes less, the head doesn't), an Uzi, pushes in to 5-10 m
//   rusher  no gun: sprints at you and hits you
//   mg      a machine gun behind sandbags it never leaves: long bursts
// Most start unaware (`idle`: standing about, turned somewhere) until they see one of you, are shot at, or a squad
// mate calls it out; `post` ones (the snipers, the MG, riflemen on the roofs) stay where they are put. They drop
// rifle ammo and now and then a first aid kit (Combat Arms' rule: enemy ammo never fits a sniper rifle or an LMG).
// InsurgentForce (game.insurgents): the pool, spawning, their field toward the fireteam, their bullets and rockets, the
// fireteam's raycasts against them (the NOX squad's contract: actors/merc.js, so hits, the knife, mines and blasts
// treat them alike), the radar, the kills.
import * as THREE from 'three';
import { Teammate, reach } from './teammate.js';
import { SURF, FLAG_NOBULLET } from '../world/collision.js';
import { clamp, damp, dampAngle, lerp, rand, coneDirection, rayCapsule, raySphere, smoothstep, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { WEAPONS } from '../player/weaponDefs.js';

// x difficulty (hp: diff.hp, damage: diff.dmg)
export const HOG = {
  hp: { rifle: 140, rpg: 140, sniper: 120, guard: 300, rusher: 100, mg: 200 },
  part: { head: 3.2, torso: 1, leg: 0.7 },
  armor: { guard: 0.55 }, // the royal guard's plates: the body takes this share (the head all of it)
  run: 3.5, // m/s closing in
  walk: 1.5, // pushing in, sidestepping
  range: { rifle: 34, rpg: 44, sniper: 75, guard: 26, rusher: 2, mg: 48 }, // they fire within this (a clear line)
  stop: { rifle: [9, 20], rpg: [12, 30], sniper: [0, 999], guard: [5, 10], rusher: [0, 0], mg: [0, 999] },
  view: 42, // m they notice you at (in front; a shot or a squad mate's call wakes them at any range)
  acquire: [0.5, 1.0], // s before the first shot at someone just seen
  rifle: { dmg: 5, burst: [2, 5], rpm: 600, pause: [0.9, 1.7], spread: 3.8, mag: 30, reload: 2.6, sound: 'ak_fire', vol: 0.85, pitch: 0.95, tracer: [4.5, 2.6, 0.9] },
  guard: { dmg: 4.2, burst: [5, 10], rpm: 900, pause: [0.7, 1.3], spread: 4.6, mag: 32, reload: 2.2, sound: 'smg_fire', vol: 0.8, pitch: 0.9, tracer: [4.5, 2.4, 0.8] },
  mg: { dmg: 4.4, burst: [10, 20], rpm: 720, pause: [1.2, 2.2], spread: 4.4, mag: 80, reload: 4.6, sound: 'lmg_fire', vol: 0.95, pitch: 0.9, tracer: [4.8, 2.2, 0.7] },
  sniper: { dmg: 42, aim: 1.7, pause: [2.4, 3.8], spread: 0.45, mag: 5, reload: 3.4, sound: 'sniper_fire', vol: 1, pitch: 1.05, tracer: [4.5, 3.2, 1.6] },
  rpg: { dmg: 78, radius: 4.2, speed: 30, pause: [4.8, 6.5], windup: 0.8, spread: 2.2 },
  rusher: { dmg: 16, run: 5.3, reach: 1.55, swing: 0.55, hitAt: 0.28, cooldown: [0.9, 1.3] },
  score: { rifle: 150, rpg: 200, sniper: 250, guard: 300, rusher: 120, mg: 250 },
  drop: { ammo: 0.42, aid: 0.1 }, // chances a body leaves rifle ammo / a first aid kit
  corpse: 30, // s a body lies there
  names: { rifle: 'Sand Hog Scout', rpg: 'Sand Hog Patrol', sniper: 'Sand Hog Sniper', guard: 'Royal Guard', rusher: 'Sand Hog Fanatic', mg: 'Sand Hog Gunner' },
};

// the pool: how many of each the mission can have up at once
const POOL = { rifle: 16, rpg: 3, sniper: 6, guard: 7, rusher: 5, mg: 1 };
// the looks (actors/rig.js BODY_SPECS) and weapons (the bot gun: WEAPONS id, GLB model where there is one)
const LOOKS = {
  rifle: (i) => ({ body: ['hogScout', 'hogScout2', 'hogPatrol'][i % 3], weapon: 'ak47' }),
  rpg: () => ({ body: 'hogPatrol', weapon: 'ak47', custom: 'rpg' }),
  sniper: (i) => ({ body: i % 2 ? 'hogScout2' : 'hogPatrol', weapon: 'awm' }),
  guard: () => ({ body: 'hogGuard', weapon: 'ak47', custom: 'uzi' }),
  rusher: () => ({ body: 'hogRusher', weapon: 'ak47', custom: 'none' }),
  mg: () => ({ body: 'hogScout2', weapon: 'mg42' }),
};

const BULLETS = (b) => (b.flags & FLAG_NOBULLET) === 0;
const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _n = new THREE.Vector3();
const _o = new THREE.Vector3();
const _hit = {};
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _G = new THREE.Vector3();
const _T = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _al = new THREE.Vector3();
const _pl = new THREE.Vector3();

// ---------------------------------------------------------------- their own guns
let GUN_MATS = null;
function gunMats() {
  GUN_MATS ??= {
    steel: new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.7, roughness: 0.45 }),
    worn: new THREE.MeshStandardMaterial({ color: 0x3a3b36, metalness: 0.6, roughness: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.7 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4a5130, roughness: 0.6, metalness: 0.2 }),
    tan: new THREE.MeshStandardMaterial({ color: 0x8a7a55, roughness: 0.6, metalness: 0.15 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0c1418, metalness: 0.4, roughness: 0.1 }),
  };
  return GUN_MATS;
}
const box = (w, h, d, m, x, y, z, rx = 0) => {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y, z);
  o.rotation.x = rx;
  return o;
};
const tube = (r0, r1, len, m, x, y, z, seg = 14) => {
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), m);
  o.rotation.x = Math.PI / 2; // (along z: r0 at +z, r1 at -z)
  o.position.set(x, y, z);
  return o;
};
/**
 * The Royal Guard's Uzi (gun space as the bot guns: the root at the grip web, muzzle toward -Z): a stubby receiver
 * over the grip (the magazine goes up through it), a short barrel, a folded wire stock.
 */
function buildUzi() {
  const M = gunMats();
  const g = new THREE.Group();
  g.add(box(0.046, 0.075, 0.25, M.steel, 0, 0.045, -0.085));
  g.add(box(0.03, 0.02, 0.2, M.worn, 0, 0.09, -0.08)); // the top cover
  g.add(tube(0.012, 0.012, 0.07, M.steel, 0, 0.05, -0.24, 10));
  g.add(box(0.034, 0.12, 0.045, M.worn, 0, -0.045, -0.01, 0.12)); // the grip, the magazine in it
  g.add(box(0.03, 0.06, 0.035, M.steel, 0, -0.13, -0.02, 0.12)); // the magazine's foot below it
  g.add(box(0.03, 0.02, 0.06, M.steel, 0, -0.005, -0.06)); // the trigger guard
  for (const sx of [-1, 1]) g.add(box(0.006, 0.012, 0.22, M.steel, sx * 0.022, 0.03, 0.1)); // the folded stock's arms
  g.add(box(0.05, 0.05, 0.01, M.steel, 0, 0.02, 0.21));
  g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  return { root: g, muzzle: V(0, 0.05, -0.28), rightHand: V(0, -0.005, -0.018), leftHand: V(0, 0.03, -0.15), eye: V(0, 0.11, 0.13), stock: 0.12, shellType: 'pistol' };
}
/**
 * An RPG-7: the tube over the grip, its wooden heat guard, the flared blast cone at the back, the sight on the left
 * and the warhead in front (`warhead`: hidden once it's fired, until the reload).
 */
function buildRpg() {
  const M = gunMats();
  const g = new THREE.Group();
  const y = 0.085; // the tube's axis over the grip
  g.add(tube(0.038, 0.038, 0.95, M.worn, 0, y, -0.12));
  g.add(tube(0.047, 0.047, 0.3, M.wood, 0, y, -0.05)); // the heat guard
  g.add(tube(0.075, 0.042, 0.2, M.worn, 0, y, 0.42)); // the blast cone (wide end back)
  g.add(box(0.03, 0.11, 0.045, M.wood, 0, -0.04, 0, 0.15)); // the trigger grip
  g.add(box(0.03, 0.09, 0.04, M.wood, 0, 0.0, -0.22, 0.1)); // the front grip
  g.add(box(0.03, 0.045, 0.07, M.steel, -0.055, y + 0.04, -0.02)); // the sight
  g.add(box(0.012, 0.012, 0.02, M.glass, -0.055, y + 0.05, 0.02));
  const war = new THREE.Group();
  war.add(tube(0.04, 0.04, 0.2, M.olive, 0, y, -0.68));
  war.add(tube(0.042, 0.078, 0.14, M.olive, 0, y, -0.85));
  war.add(tube(0.078, 0.004, 0.2, M.olive, 0, y, -1.02, 16));
  g.add(war);
  g.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  const V = (x, yy, z) => new THREE.Vector3(x, yy, z);
  return { root: g, muzzle: V(0, y, -1.1), rightHand: V(0, -0.005, -0.018), leftHand: V(0, 0.01, -0.22), eye: V(-0.055, y + 0.05, 0.16), stock: 0.3, warhead: war, shellType: 'none' };
}

let ROCKET_PROTO = null;
/** an RPG round in flight (its nose toward -Z, the motor's flame behind): clone it (game/desertScenes.js flies one too) */
export function rocketProto() {
  if (ROCKET_PROTO) return ROCKET_PROTO;
  const M = gunMats();
  const g = new THREE.Group();
  g.add(tube(0.04, 0.04, 0.22, M.olive, 0, 0, 0.05));
  g.add(tube(0.042, 0.078, 0.14, M.olive, 0, 0, -0.12));
  g.add(tube(0.078, 0.004, 0.2, M.olive, 0, 0, -0.29, 16));
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 3.2, 1.1) }));
  flame.position.z = 0.2;
  flame.scale.set(1, 1, 2.2);
  g.add(flame);
  ROCKET_PROTO = g;
  return g;
}

/** One of the militia: a Teammate body with its own brain and weapon. */
export class Insurgent extends Teammate {
  constructor(game, index, role, k) {
    const look = LOOKS[role](k);
    super(game, 200 + index, { id: 'hog' + index, name: HOG.names[role], body: look.body, weapon: look.weapon, gun: '', rank: 0 });
    this.role = role;
    this.isHostile = true;
    this.cfg = HOG[role];
    if (look.custom === 'uzi') this._setGun(buildUzi());
    else if (look.custom === 'rpg') this._setGun(buildRpg());
    else if (look.custom === 'none') this.gunHolder.visible = false;
    this.inPlay = false;
    this.stats = { kills: 0, deaths: 0, headshots: 0, score: 0 };
    this.hide();
  }

  /** swap the bot gun for one of the militia's own (the hold follows its markers, as the Teammate constructor does) */
  _setGun(w) {
    this.gunHolder.remove(this.gun);
    this.gun = w.root;
    this.gunHolder.add(this.gun);
    const GRIP_FWD = 0.25;
    const WRIST_R = new THREE.Vector3(0.025, -0.075, 0.09), WRIST_L = new THREE.Vector3(-0.035, -0.07, -0.21);
    const REF_R = new THREE.Vector3(0, -0.005, -0.018), REF_L = new THREE.Vector3(0, 0.049, -0.331);
    this.hold = {
      gripFwd: Math.max(GRIP_FWD, Math.min(0.3, w.stock)),
      wristR: WRIST_R.clone().add(w.rightHand).sub(REF_R),
      wristL: WRIST_L.clone().add(w.leftHand).sub(REF_L),
      eye: w.eye.clone(),
    };
    this.muzzleLocal = w.muzzle.clone();
    this.ejectLocal = new THREE.Vector3(0.02, 0.05, Math.max(-0.25, w.muzzle.z * 0.2));
    this.warhead = w.warhead ?? null;
  }

  /**
   * Into the fight at `pos`: o = { post (stays put: a window, the roof, the MG nest; no gravity), alert (awake from the
   * start), squad (they wake each other), hold ([x, z] a spot it keeps to instead of hunting), look (yaw it faces idle) }.
   */
  deploy(pos, yaw, o = {}) {
    this.spawn(pos, yaw);
    const diff = this.game.diff ?? { hp: 1 };
    this.hp = this.maxHp = Math.round(HOG.hp[this.role] * (diff.hp ?? 1));
    this.ap = 0;
    this.mag = this.cfg.mag ?? 1;
    this.inPlay = true;
    this.post = !!o.post;
    this.holdAt = o.hold ? new THREE.Vector3(o.hold[0], pos.y, o.hold[1]) : null;
    this.squad = o.squad ?? null;
    this.alerted = !!o.alert;
    this.lastHitBy = null;
    this.strafeT = rand(1, 2.5);
    this.strafe = 0;
    this.targetT = rand(0, 0.3);
    this.los = false;
    this.aimT = 0; // (the sniper's laser settling)
    this.swingT = -1; // (the rusher's blow)
    this.hitDone = false;
    this.windupT = -1; // (the RPG raised, about to fire)
    this.idleYaw = yaw;
    this.corpseT = 0;
    if (this.warhead) this.warhead.visible = true;
    this.gunHolder.visible = this.role !== 'rusher';
    if (this.laser) this.laser.visible = false;
  }

  get armed() {
    return this.alive && this.inPlay && this.root.visible;
  }

  // ------------------------------------------------------------------ being hit
  /** a bullet on the ray o + t d: its nearest hit on this one { t, part, merc } (the NOX squad's contract), or null */
  raycast(o, d, maxT) {
    if (!this.armed) return null;
    const p = this.pos;
    const near = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.y + 1.0, p.z, 1.3);
    if (near < 0 || near > maxT + 1.3) return null;
    this.root.updateMatrixWorld(true);
    let best = null;
    const b = this.bones;
    const test = (t, part) => {
      if (t >= 0 && t < maxT && (!best || t < best.t)) best = { t, part, merc: this };
    };
    b.head.getWorldPosition(_a);
    test(raySphere(o.x, o.y, o.z, d.x, d.y, d.z, _a.x, _a.y + 0.1, _a.z, 0.13), 'head');
    b.hips.getWorldPosition(_a);
    b.neck.getWorldPosition(_b);
    test(rayCapsule(o, d, _a, _b, 0.21), 'torso');
    for (const s of ['L', 'R']) {
      b['thigh' + s].getWorldPosition(_a);
      b['shin' + s].getWorldPosition(_b);
      test(rayCapsule(o, d, _a, _b, 0.085), 'leg');
      b['foot' + s].getWorldPosition(_c);
      test(rayCapsule(o, d, _b, _c, 0.07), 'leg');
    }
    return best;
  }

  /** damage (before the part multiplier); returns { killed, dealt } */
  hurt(amount, part, dir, source, opts = {}) {
    if (!this.alive) return { killed: false, dealt: 0 };
    const armour = part !== 'head' ? (HOG.armor[this.role] ?? 1) : 1;
    const dmg = amount * (HOG.part[part] ?? 1) * armour;
    this.hp -= dmg;
    this.lastHitBy = source ?? this.lastHitBy;
    this.flinchV = (this.flinchV ?? 0) + clamp(dmg / 30, 0.25, 1) * 6;
    // shot: awake (and its squad with it), turned on whoever did it
    this.game.insurgents.wake(this);
    if (source && source !== this.target && (source.isPlayer || source.stats) && Math.random() < 0.6) {
      this.target = source;
      this.targetT = 1.2;
    }
    if (this.hp > 0) return { killed: false, dealt: dmg };
    this.hp = 0;
    this.alive = false;
    this.deadT = 0;
    this.fallDir = dir && dir.dot(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))) > 0 ? 1 : -1;
    this.bones.handR.attach(this.gunHolder);
    if (this.laser) this.laser.visible = false;
    this.game.insurgents.onKilled(this, source, part === 'head', opts);
    return { killed: true, dealt: dmg };
  }

  /** Teammate API (a blast, the knife, the shockwave: game code that treats it like one of the team) */
  takeDamage(amount, fromPos, source) {
    const dir = fromPos ? _d.copy(this.pos).sub(fromPos).setY(0).normalize() : null;
    this.hurt(amount, 'torso', dir, source);
  }

  // ------------------------------------------------------------------ the fight
  update(dt) {
    const game = this.game, F = game.insurgents;
    if (!this.alive) {
      if (!this.post) {
        this.body.vel.x = damp(this.body.vel.x, 0, 4, dt);
        this.body.vel.z = damp(this.body.vel.z, 0, 4, dt);
        game.world.moveBody(this.body, dt);
      }
      this._animateDead(dt);
      if (this.deadT > HOG.corpse) {
        this.hide();
        this.inPlay = false;
      }
      return;
    }
    const pos = this.pos;
    this.level = levelOf(pos.y + 0.3);
    const role = this.role;

    // ---- whom to go for: the nearest of the fireteam it can see (else the nearest), rechecked a few times a second
    if ((this.targetT -= dt) <= 0 || !this.target?.alive) {
      this.targetT = rand(0.3, 0.5);
      let best = null, bs = Infinity, bestLos = false;
      const reachM = HOG.range[role] + 10;
      for (const t of game.team) {
        if (!t.alive) continue;
        const d = t.pos.distanceTo(pos);
        if (d > 110) continue;
        const los = d < reachM && game.world.lineOfSight(pos.x, pos.y + 1.55, pos.z, t.pos.x, t.pos.y + 1.3, t.pos.z);
        const s = d - (los ? 12 : 0) + (t.isPlayer ? -2 : 0);
        if (s < bs) {
          bs = s;
          best = t;
          bestLos = los;
        }
      }
      if (best !== this.target || (bestLos && !this.los)) this.acquire = rand(HOG.acquire[0], HOG.acquire[1]);
      this.target = best;
      this.los = bestLos;
      // unaware: it notices one of you in front of it (or right beside it), in the open
      if (!this.alerted && best && bestLos) {
        const d = best.pos.distanceTo(pos);
        const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        const ahead = ((best.pos.x - pos.x) * fx + (best.pos.z - pos.z) * fz) / Math.max(d, 1e-3);
        if (d < 6 || (d < HOG.view && ahead > 0.2) || (d < HOG.view * 1.6 && ahead > 0.6)) F.wake(this);
      }
    }
    this.acquire = (this.acquire ?? 0) - dt;
    const tgt = this.alerted ? this.target : null;
    let wantX = 0, wantZ = 0, speed = 0;
    let dist = Infinity;
    if (tgt) {
      dist = Math.hypot(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
      const range = HOG.range[role];
      const [near, far] = HOG.stop[role];
      if (this.post) {
        // (stays put)
      } else if (role === 'rusher') {
        // straight at them where it can, along the field where it can't
        if (this.los && dist < 14) {
          wantX = tgt.pos.x - pos.x;
          wantZ = tgt.pos.z - pos.z;
        } else {
          const w = this._fieldWant(dt, tgt);
          wantX = w.x;
          wantZ = w.z;
        }
        if (dist > this.cfg.reach * 0.8) speed = this.cfg.run;
      } else if (this.holdAt) {
        // keeps to its spot: back there when it has drifted, a sidestep now and then
        const hx = this.holdAt.x - pos.x, hz = this.holdAt.z - pos.z;
        if (Math.hypot(hx, hz) > 1.2) {
          wantX = hx;
          wantZ = hz;
          speed = HOG.walk;
        } else this._strafeWant(dt, tgt, (x, z, s) => ((wantX = x), (wantZ = z), (speed = s)));
      } else if (!this.los || dist > range) {
        const w = this._fieldWant(dt, tgt);
        wantX = w.x;
        wantZ = w.z;
        speed = HOG.run;
      } else if (dist > far) {
        const st = F.steer(this.level, pos.x, pos.z);
        wantX = st ? st.dirX : tgt.pos.x - pos.x;
        wantZ = st ? st.dirZ : tgt.pos.z - pos.z;
        speed = HOG.walk * (role === 'guard' ? 1.4 : 1);
      } else if (dist < near) {
        wantX = pos.x - tgt.pos.x;
        wantZ = pos.z - tgt.pos.z;
        speed = HOG.walk;
      } else this._strafeWant(dt, tgt, (x, z, s) => ((wantX = x), (wantZ = z), (speed = s)));
      const l = Math.hypot(wantX, wantZ);
      if (l > 1e-4) {
        wantX /= l;
        wantZ /= l;
      }
    }
    // keep apart
    if (!this.post) {
      for (const o of F.list) {
        if (o === this || !o.armed) continue;
        const ox = pos.x - o.pos.x, oz = pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        if (d2 < 1.1 && d2 > 1e-5) {
          const d = Math.sqrt(d2);
          wantX += (ox / d) * 0.9;
          wantZ += (oz / d) * 0.9;
          speed = Math.max(speed, 1.2);
        }
      }
      const b = this.body;
      b.vel.x = damp(b.vel.x, wantX * speed, 8, dt);
      b.vel.z = damp(b.vel.z, wantZ * speed, 8, dt);
      const bx = pos.x, bz = pos.z;
      game.world.moveBody(b, dt);
      this.moveSpeed = damp(this.moveSpeed, Math.hypot(pos.x - bx, pos.z - bz) / Math.max(dt, 1e-4), 10, dt);
    } else this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);

    // ---- facing: whom it shoots at when it sees them, else the way it goes, else where it looks while idle
    let faceYaw = this.yaw, wantPitch = 0;
    if (tgt && this.los) {
      faceYaw = Math.atan2(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
      wantPitch = Math.atan2(tgt.pos.y + 1.2 - (pos.y + 1.5), Math.max(0.5, dist));
    } else if (Math.hypot(wantX, wantZ) > 0.1) faceYaw = Math.atan2(wantX, wantZ);
    else if (!this.alerted) faceYaw = this.idleYaw + Math.sin(game.time * 0.25 + this.index) * 0.5;
    this.yaw = dampAngle(this.yaw, faceYaw, role === 'mg' ? 4 : 7, dt);
    this.aimPitch = damp(this.aimPitch, wantPitch, 8, dt);
    this.root.rotation.y = this.yaw;
    const facing = Math.abs(wrapAngle(faceYaw - this.yaw)) < 0.25;

    // ---- the weapon
    this.cooldown -= dt;
    if (role === 'rusher') this._melee(dt, tgt, dist);
    else if (role === 'sniper') this._snipe(dt, tgt, dist, facing);
    else if (role === 'rpg') this._rocket(dt, tgt, dist, facing);
    else this._gun(dt, tgt, dist, facing);
    const crouchWant = this.post && role !== 'mg' ? 0 : this.los && speed < 0.5 && tgt && this.index % 3 === 1 ? 0.85 : role === 'mg' ? 0.7 : 0;
    this.crouch = damp(this.crouch, crouchWant, 4, dt);
    this.recoil = damp(this.recoil, 0, 14, dt);
    this._animate(dt);
  }

  /** along the force's field toward the fireteam (a stair on the way: its far end): { x, z } (reused) */
  _fieldWant(dt, tgt) {
    const pos = this.pos, F = this.game.insurgents;
    const w = (this._fw ??= { x: 0, z: 0 });
    const st = F.steer(this.level, pos.x, pos.z);
    if (st && Math.abs(st.dirX) + Math.abs(st.dirZ) > 1e-3) {
      w.x = st.dirX;
      w.z = st.dirZ;
      if (st.portal && !this.portalTo && !st.portal.ladder) {
        this.portalTo = st.portalTo;
        this.portalT = 0;
      }
    } else {
      w.x = tgt.pos.x - pos.x;
      w.z = tgt.pos.z - pos.z;
    }
    if (this.portalTo) {
      this.portalT += dt;
      if ((this.level === this.portalTo.level && Math.hypot(this.portalTo.x - pos.x, this.portalTo.z - pos.z) < 1.2) || this.portalT > 9) this.portalTo = null;
      else {
        w.x = this.portalTo.x - pos.x;
        w.z = this.portalTo.z - pos.z;
      }
    }
    return w;
  }

  /** holding a line of sight: a sidestep now and then */
  _strafeWant(dt, tgt, set) {
    if ((this.strafeT -= dt) <= 0) {
      this.strafeT = rand(1.4, 3.2);
      this.strafe = Math.random() < 0.55 ? (Math.random() < 0.5 ? -1 : 1) : 0;
      this.strafeLeft = rand(0.5, 0.9);
    }
    if (this.strafe && (this.strafeLeft -= dt) > 0) {
      const ax = tgt.pos.x - this.pos.x, az = tgt.pos.z - this.pos.z;
      set(-az * this.strafe, ax * this.strafe, HOG.walk);
    }
  }

  /** rifles, the Uzi, the MG: bursts at whom it sees */
  _gun(dt, tgt, dist, facing) {
    const G = this.cfg;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = G.mag;
      return;
    }
    if (!tgt || !this.los || this.acquire > 0 || dist > HOG.range[this.role] || this.cooldown > 0 || !facing) return;
    if (this.burst <= 0) this.burst = Math.floor(rand(G.burst[0], G.burst[1] + 1));
    this._fire(tgt, dist, G);
    this.burst--;
    this.cooldown = this.burst > 0 ? 60 / G.rpm : rand(G.pause[0], G.pause[1]);
    if (--this.mag <= 0) {
      this.reloadT = this.reloadDur = G.reload;
      this.burst = 0;
      this.game.audio.play(this.role === 'mg' ? 'mg_cover_open' : 'm4_reload', { position: this.pos, volume: 0.45, pitch: 0.9 });
    }
  }

  /** the sniper: the laser settles on you for `aim` s (a line you can see), then one heavy round */
  _snipe(dt, tgt, dist, facing) {
    const G = this.cfg, game = this.game;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = G.mag;
    }
    const ready = tgt && this.los && dist < HOG.range.sniper && this.cooldown <= 0 && this.reloadT <= 0;
    if (!ready) {
      this.aimT = Math.max(0, this.aimT - dt * 2);
    } else if (facing) {
      this.aimT += dt;
      if (this.aimT >= G.aim) {
        this.aimT = 0;
        this._fire(tgt, dist, G);
        this.cooldown = rand(G.pause[0], G.pause[1]);
        if (--this.mag <= 0) this.reloadT = this.reloadDur = G.reload;
        else setTimeout(() => this.alive && game.running && game.audio.play('sniper_bolt', { position: this.pos, volume: 0.5 }), 500);
      }
    }
    // the laser: from the muzzle to where it aims, brighter as it settles
    const L = this._laser();
    const on = this.aimT > 0.05 && tgt;
    L.visible = !!on;
    if (on) {
      this.root.updateMatrixWorld(true);
      const m = this.gun.localToWorld(_c.copy(this.muzzleLocal));
      const k = clamp(this.aimT / G.aim, 0, 1);
      // it wanders onto you: off to the side at first, dead on at the end
      const off = (1 - k) * 1.4;
      _a.set(tgt.pos.x + Math.sin(game.time * 3.1 + this.index) * off, tgt.pos.y + 1.2 + Math.sin(game.time * 2.3) * off * 0.5, tgt.pos.z + Math.cos(game.time * 2.7) * off);
      const len = m.distanceTo(_a);
      L.position.copy(m).lerp(_a, 0.5);
      L.lookAt(_a);
      L.scale.set(1, 1, len);
      L.material.opacity = 0.18 + 0.55 * k;
    }
  }

  _laser() {
    if (this.laser) return this.laser;
    const g = new THREE.BoxGeometry(0.012, 0.012, 1);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.15, 0.1), transparent: true, opacity: 0.4, depthWrite: false, fog: false });
    this.laser = new THREE.Mesh(g, m);
    this.laser.renderOrder = 7;
    this.laser.frustumCulled = false;
    this.game.scene.add(this.laser);
    return this.laser;
  }

  /** the RPG: raised for a moment (windup), a rocket at where you stand, then the long reload */
  _rocket(dt, tgt, dist, facing) {
    const G = this.cfg;
    if (this.windupT >= 0) {
      this.windupT += dt;
      if (this.windupT >= G.windup) {
        this.windupT = -1;
        if (tgt && this.los) {
          this.game.insurgents.fireRocket(this, tgt);
          if (this.warhead) this.warhead.visible = false;
          this.recoil = 1.4;
          this.reloadT = this.reloadDur = rand(G.pause[0], G.pause[1]);
        }
      }
      return;
    }
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && this.warhead) this.warhead.visible = true;
      return;
    }
    if (tgt && this.los && this.acquire <= 0 && dist < HOG.range.rpg && dist > 6 && facing && this.cooldown <= 0) {
      this.windupT = 0;
      this.cooldown = 1;
      this.game.audio.play('zombie_alert', { position: this.pos, volume: 0.25, pitch: 1.35 }); // (a shout)
    }
  }

  /** the rusher: at arm's length a swing; the blow lands partway through if you're still there */
  _melee(dt, tgt, dist) {
    const G = this.cfg, game = this.game;
    if (this.swingT >= 0) {
      this.swingT += dt;
      if (!this.hitDone && this.swingT >= G.hitAt) {
        this.hitDone = true;
        if (tgt && tgt.alive && tgt.pos.distanceTo(this.pos) < G.reach + 0.4) {
          tgt.takeDamage(G.dmg * (game.diff?.dmg ?? 1), this.pos, this);
          game.audio.play('bat_hit', { position: tgt.pos, volume: 0.7, pitch: 0.9 });
          if (tgt.knockback) {
            _v.copy(tgt.pos).sub(this.pos).setY(0).normalize();
            tgt.knockback(_v.x * 3, 1.2, _v.z * 3);
          }
          if (tgt.isPlayer) game.shake.add(0.35);
        }
      }
      if (this.swingT >= G.swing) {
        this.swingT = -1;
        this.cooldown = rand(G.cooldown[0], G.cooldown[1]);
      }
      return;
    }
    if (tgt && dist < G.reach && this.cooldown <= 0 && Math.abs(tgt.pos.y - this.pos.y) < 1.2) {
      this.swingT = 0;
      this.hitDone = false;
      game.audio.play('bat_swing', { position: this.pos, volume: 0.6, pitch: 0.8 });
    }
  }

  /** one round at the target: the tracer from the muzzle, the hit on whoever of the fireteam is in the way */
  _fire(tgt, dist, G) {
    const game = this.game, F = game.insurgents;
    this.recoil = 1;
    this.lastShotT = game.time;
    this.root.updateMatrixWorld(true);
    const muzzle = this.gun.localToWorld(_c.copy(this.muzzleLocal));
    const eye = _o.set(this.pos.x, this.pos.y + 1.52, this.pos.z);
    const moving = tgt.body ? Math.hypot(tgt.body.vel.x, tgt.body.vel.z) : 0;
    _a.set(tgt.pos.x, tgt.pos.y + (tgt.isPlayer && tgt.crouching ? 0.85 : 1.2) + rand(-0.15, 0.25), tgt.pos.z);
    _d.copy(_a).sub(eye).normalize();
    const err = (G.spread + dist * 0.06 + Math.min(2.5, moving * 0.4)) * DEG;
    const dir = coneDirection(_d, err, _n);
    F.shot(this, eye, dir, G.dmg * (game.diff?.dmg ?? 1), muzzle, G.tracer);
    game.fx.muzzleWorld(muzzle, dir, this.role === 'sniper' ? 1.2 : this.role === 'guard' ? 0.7 : 0.9);
    if (game.time - (F.sfxAt[this.role] ?? -1) > (this.role === 'mg' ? 0.06 : 0.05)) {
      F.sfxAt[this.role] = game.time;
      game.audio.play(G.sound, { position: muzzle, volume: G.vol, pitch: G.pitch + rand(-0.02, 0.02) });
    }
    if (Math.random() < 0.35 && this.role !== 'sniper') game.fx.shell(this.role === 'guard' ? 'pistol' : 'rifle', this.gun.localToWorld(_v.copy(this.ejectLocal)), new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)));
  }

  /** the rusher's arms: pumping as it runs, the right fist driven forward in the swing; the rest hold their guns */
  _holdRifle(dt) {
    if (this.role !== 'rusher' || this.cineGun) return super._holdRifle(dt);
    const b = this.bones, h = this.hands, rq = this.root.quaternion;
    const run = clamp(this.moveSpeed / 4, 0, 1);
    const s = Math.sin(this.phase);
    const swing = this.swingT >= 0 ? this.swingT / this.cfg.swing : -1;
    for (const [side, sg] of [['L', 1], ['R', -1]]) {
      const up = b['upperArm' + side], fo = b['foreArm' + side], ha = b['hand' + side];
      up.getWorldPosition(_G);
      let fwd = 0.18 + 0.2 * s * sg * run, lift = -0.28 + 0.05 * run;
      if (side === 'R' && swing >= 0) {
        const k = swing < 0.45 ? -smoothstep(0, 0.45, swing) * 0.2 : smoothstep(0.45, 0.62, swing) * 0.62 - 0.2;
        fwd = 0.25 + k;
        lift = -0.05;
      }
      _T.set(-sg * 0.08, lift, fwd).applyQuaternion(rq).add(_G);
      _pole.set(-sg * 0.6, -1, -0.4).applyQuaternion(rq);
      reach(up, fo, ha, _T, _pole, _al.set(0, 0.3, 1).normalize().applyQuaternion(rq), _pl.set(sg, 0, 0).applyQuaternion(rq), h[side]);
    }
  }
}

/**
 * The militia in play: game.insurgents. The mission (game/desertMission.js) deploys them in squads; they fight till
 * they drop.
 */
export class InsurgentForce {
  constructor(game) {
    this.game = game;
    this.list = [];
    let i = 0;
    for (const [role, n] of Object.entries(POOL)) {
      for (let k = 0; k < n; k++) {
        const m = new Insurgent(game, i++, role, k);
        game.scene.add(m.root);
        this.list.push(m);
      }
    }
    this.src = [{ level: 1, x: 0, z: 0 }];
    this.field = null;
    this.fieldAt = null;
    this.rockets = [];
    this.sfxAt = {};
    this.onKill = null; // the mission's hook (a kill counts toward an objective)
    this.reset();
  }

  reset() {
    for (const m of this.list) {
      m.hide();
      m.inPlay = false;
      if (m.laser) m.laser.visible = false;
    }
    for (const r of this.rockets) this.game.scene.remove(r.mesh);
    this.rockets.length = 0;
    this.fieldAt = null;
  }

  /** one of `role` into the fight (a free one from the pool; null if all are in play) */
  spawn(role, pos, yaw = 0, o = {}) {
    const m = this.list.find((x) => x.role === role && !x.inPlay && !x.root.visible);
    if (!m) return null;
    m.deploy(pos, yaw, o);
    return m;
  }

  /** alive and in the fight */
  get aliveCount() {
    let n = 0;
    for (const m of this.list) if (m.armed) n++;
    return n;
  }

  get active() {
    return this.aliveCount > 0;
  }

  /** `m` has seen you or been shot: awake, and its squad with it */
  wake(m) {
    if (m.alerted) return;
    m.alerted = true;
    if (m.alive && Math.random() < 0.5) this.game.audio.play('zombie_alert', { position: m.pos, volume: 0.3, pitch: 1.3 + rand(-0.05, 0.1) });
    if (m.squad == null) return;
    for (const o of this.list) if (o !== m && o.armed && o.squad === m.squad && !o.alerted) o.alerted = true;
  }

  /** the fireteam fired at `pos`: everyone within `r` wakes */
  hear(pos, r) {
    for (const m of this.list) if (m.armed && !m.alerted && m.pos.distanceTo(pos) < r) this.wake(m);
  }

  // ------------------------------------------------------------------ each frame
  update(dt) {
    const g = this.game;
    let any = false;
    for (const m of this.list) {
      if (!m.root.visible) continue;
      any = true;
      m.update(dt);
    }
    this._updateRockets(dt);
    if (!any) return;
    // their field toward the fireteam (the one nearest the militia in play), in the background as you move
    let best = null, bd = Infinity;
    const c = _v.set(0, 0, 0);
    let n = 0;
    for (const m of this.list) {
      if (!m.armed || m.post) continue;
      c.add(m.pos);
      n++;
    }
    if (!n) return;
    c.divideScalar(n);
    for (const t of g.team) {
      if (!t.alive) continue;
      const d = t.pos.distanceToSquared(c);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (!best) return;
    this.field ??= g.nav.makeBgField();
    const lv = levelOf(best.pos.y + 0.3), at = this.fieldAt;
    if (!this.field.computing && (!at || at.level !== lv || Math.hypot(at.x - best.pos.x, at.z - best.pos.z) > 2.5)) {
      this.fieldAt = { level: lv, x: best.pos.x, z: best.pos.z };
      this.field.begin([this.fieldAt]);
    }
    this.field.step(9000);
  }

  /** the way on toward the fireteam (null: no field yet) */
  steer(level, x, z) {
    return this.field?.ready ? this.field.steer(level, x, z, _steer) : null;
  }

  // ------------------------------------------------------------------ their bullets and rockets
  /** a round of theirs: the first of the fireteam on the ray before a wall takes it */
  shot(m, origin, dir, dmg, muzzle, color) {
    const g = this.game;
    const wall = g.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 120, BULLETS, _hit);
    let endT = wall ? wall.t : 120;
    let victim = null;
    for (const t of g.team) {
      if (!t.alive) continue;
      const top = t.isPlayer ? (t.crouching ? 1.1 : 1.6) : t.crouch > 0.5 ? 1.2 : 1.62;
      _a.set(t.pos.x, t.pos.y + 0.3, t.pos.z);
      _b.set(t.pos.x, t.pos.y + top - 0.14, t.pos.z);
      const ht = rayCapsule(origin, dir, _a, _b, 0.3);
      if (ht >= 0 && ht < endT) {
        endT = ht;
        victim = t;
      }
    }
    const end = _c.copy(origin).addScaledVector(dir, endT);
    if (victim) {
      victim.takeDamage(dmg, m.pos, m);
      if (!victim.isPlayer) g.fx.bloodHit(end, dir, { amount: 0.5, decals: false });
    } else if (wall) {
      g.fx.impact(end, _n.set(wall.nx, wall.ny, wall.nz), wall.box.surface, { silent: Math.random() < 0.6, box: wall.box });
    }
    // a near miss past your head cracks by
    const p = g.player;
    if (p.alive && victim !== p) {
      _a.set(p.pos.x, p.pos.y + 1.6, p.pos.z).sub(origin);
      const along = _a.dot(dir);
      if (along > 2 && along < endT) {
        const miss = _a.addScaledVector(dir, -along).length();
        if (miss < 1.4 && Math.random() < 0.5) g.audio.play('impact_concrete', { volume: 0.25 * (1.4 - miss), pitch: 1.6 });
      }
    }
    g.fx.tracer(muzzle, end, { speed: 280, length: 3, width: 0.018, color: color ?? [4.5, 2.6, 0.9] });
  }

  /** an RPG round from `m` at `tgt`: slow enough to see (and to duck), a smoke trail, a blast where it hits */
  fireRocket(m, tgt) {
    const g = this.game, G = HOG.rpg;
    m.root.updateMatrixWorld(true);
    const from = m.gun.localToWorld(new THREE.Vector3().copy(m.muzzleLocal));
    // where you stand, a little ahead if you run; its aim errs a bit
    const tv = tgt.body?.vel ?? _v.set(0, 0, 0);
    const lead = from.distanceTo(tgt.pos) / G.speed;
    _a.set(tgt.pos.x + tv.x * lead * 0.6, tgt.pos.y + 0.9, tgt.pos.z + tv.z * lead * 0.6);
    _d.copy(_a).sub(from).normalize();
    const dir = coneDirection(_d, G.spread * DEG, new THREE.Vector3());
    if (!Number.isFinite(dir.x + dir.y + dir.z + from.x + from.y + from.z)) return; // (a target mid-teleport: no shot)
    const mesh = rocketProto().clone();
    mesh.position.copy(from);
    mesh.lookAt(_a.copy(from).sub(dir)); // (its -Z along the flight)
    g.scene.add(mesh);
    this.rockets.push({ pos: from.clone(), vel: dir.multiplyScalar(G.speed), mesh, life: 3.2, owner: m, trail: 0 });
    g.audio.play('rpg_fire', { position: from, volume: 1 });
    g.fx.muzzleWorld(from, dir.clone().normalize(), 1.6);
    // the back blast
    const back = _b.copy(from).addScaledVector(dir.clone().normalize(), -1.1);
    for (let i = 0; i < 10; i++) g.fx.smoke.emit(back.x, back.y, back.z, -dir.x * 0.1 + rand(-1, 1), rand(0, 1), -dir.z * 0.1 + rand(-1, 1), { life: rand(0.8, 1.6), size: rand(0.5, 0.9), grow: 1.4, drag: 2, gravity: -0.2, color: [0.62, 0.58, 0.52], alpha: 0.5 });
  }

  _updateRockets(dt) {
    const g = this.game;
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.life -= dt;
      const step = r.vel.length() * dt;
      _d.copy(r.vel).normalize();
      const wall = g.world.raycast(r.pos.x, r.pos.y, r.pos.z, _d.x, _d.y, _d.z, step + 0.05, BULLETS, _hit);
      let hitAt = wall ? r.pos.clone().addScaledVector(_d, wall.t) : null;
      for (const t of g.team) {
        if (!t.alive) continue;
        _a.set(t.pos.x, t.pos.y + 0.3, t.pos.z);
        _b.set(t.pos.x, t.pos.y + 1.6, t.pos.z);
        const ht = rayCapsule(r.pos, _d, _a, _b, 0.45);
        if (ht >= 0 && ht < step && (!hitAt || ht < r.pos.distanceTo(hitAt))) hitAt = r.pos.clone().addScaledVector(_d, ht);
      }
      if (hitAt || r.life <= 0) {
        this._blast(hitAt ?? r.pos, r.owner, wall ? _n.set(wall.nx, wall.ny, wall.nz) : null);
        g.scene.remove(r.mesh);
        this.rockets.splice(i, 1);
        continue;
      }
      r.pos.addScaledVector(r.vel, dt);
      r.vel.y -= 0.8 * dt; // (it sags a little over a long shot)
      r.mesh.position.copy(r.pos);
      r.mesh.lookAt(_a.copy(r.pos).sub(r.vel));
      r.mesh.rotateZ(dt * 20);
      // the smoke trail
      r.trail += dt;
      while (r.trail > 0.012) {
        r.trail -= 0.012;
        g.fx.smoke.emit(r.pos.x, r.pos.y, r.pos.z, rand(-0.3, 0.3), rand(0, 0.3), rand(-0.3, 0.3), { life: rand(1.2, 2.2), size: rand(0.25, 0.4), grow: 1.8, drag: 1.5, gravity: -0.15, color: [0.72, 0.7, 0.66], alpha: 0.45, fadeIn: 0.03 });
      }
      if (Math.random() < 0.5) g.fx.glow.emit(r.pos.x, r.pos.y, r.pos.z, 0, 0, 0, { life: 0.06, size: 0.6, color: [5, 2.6, 0.9] });
    }
  }

  /** an RPG round goes off: the fireball, the team takes it by distance (in the open), the militia shrugs it off */
  _blast(p, owner, n) {
    const g = this.game, G = HOG.rpg;
    const pos = p.clone();
    if (n) pos.addScaledVector(n, 0.3);
    g.fx.explosion(pos, 1);
    const dp = g.player.pos.distanceTo(pos);
    g.shake.add(clamp(1.3 - dp / 20, 0, 1));
    if (dp < 9) g.gr.grade.set('uFlash', 0.25 * (1 - dp / 9));
    for (const m of g.team) {
      if (!m.alive) continue;
      const d = m.pos.distanceTo(pos);
      if (d > G.radius) continue;
      if (!g.world.lineOfSight(pos.x, pos.y + 0.4, pos.z, m.pos.x, m.pos.y + 1.0, m.pos.z)) continue;
      const k = 1 - d / G.radius;
      m.takeDamage(G.dmg * (0.3 + 0.7 * k) * (g.diff?.dmg ?? 1), pos, owner);
      if (m.knockback) {
        _v.copy(m.pos).sub(pos).setY(0).normalize();
        m.knockback(_v.x * 5 * k, 3 * k, _v.z * 5 * k);
      }
    }
    g.apc?.explosion?.(pos, G.radius, 0, owner);
  }

  // ------------------------------------------------------------------ the fireteam's side
  /** game.hitscan: the nearest of them on the ray, or null */
  raycast(o, d, maxT) {
    let best = null;
    for (const m of this.list) {
      if (!m.armed) continue;
      const h = m.raycast(o, d, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  /** a blast (a grenade, a launcher round): damage by distance and cover */
  explosion(pos, radius, damage, source, opts = {}) {
    const g = this.game;
    for (const m of this.list) {
      if (!m.armed) continue;
      const d = m.pos.distanceTo(pos);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const los = g.world.lineOfSight(pos.x, pos.y + 0.6, pos.z, m.pos.x, m.pos.y + 1.1, m.pos.z);
      const dmg = damage * (0.3 + 0.7 * k) * (los ? 1 : 0.35) * 1.2;
      _v.copy(m.pos).sub(pos).setY(0).normalize();
      const res = m.hurt(dmg, 'torso', _v, source, { explosion: true, weapon: opts.weapon });
      if (!m.post) m.knockback(_v.x * 4 * k, 2 * k, _v.z * 4 * k);
      if (source?.isPlayer && res.dealt > 0) {
        g.hitAccum += res.dealt;
        g.hud.hitMarker(res.killed, false);
      }
    }
  }

  /** the knife: the nearest one in the cone ahead (null if none) */
  meleeTarget(eye, fwd, range) {
    let best = null, bd = Infinity;
    for (const m of this.list) {
      if (!m.armed) continue;
      _a.set(m.pos.x, m.pos.y + 1.1, m.pos.z).sub(eye);
      const d = _a.length();
      if (d > range + 0.6) continue;
      if (_a.divideScalar(d).dot(fwd) < 0.55) continue;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best ? { merc: best, dist: bd, blocked: false } : null;
  }

  /** the radar: the ones awake (the ones still unaware of you don't give themselves away) */
  radarList() {
    const out = [];
    for (const m of this.list) if (m.armed && m.alerted) out.push({ x: m.pos.x, z: m.pos.z, yaw: m.yaw });
    return out;
  }

  /** one of them down: the kill feed, the score, what it drops */
  onKilled(m, source, headshot, opts = {}) {
    const g = this.game;
    g.audio.play('zombie_death', { position: m.pos, volume: 0.35, pitch: 0.75 });
    setTimeout(() => g.running && g.audio.play('bodyfall', { position: m.pos, volume: 0.8 }), 550);
    // the ammo it carried (rifle rounds), now and then a first aid kit (not from the ones up in windows)
    if (!m.post || m.role === 'mg') {
      const r = Math.random();
      if (r < HOG.drop.aid) g.pickups.spawnSupply('green', m.pos, { life: 60 });
      else if (r < HOG.drop.aid + HOG.drop.ammo) g.pickups.spawnSupply('white', m.pos, { life: 60 });
    }
    const killer = source?.isPlayer ? 'You' : source?.name ?? '';
    g.hud.addKill?.({ killer, victim: m.name, weapon: opts.explosion ? 'EXPLOSION' : (WEAPONS[opts.weapon]?.name ?? source?.weaponName ?? ''), headshot });
    if (source?.isPlayer) {
      const pts = Math.round(HOG.score[m.role] * (headshot ? 1.5 : 1));
      g.score += pts;
      g.player.stats.kills++;
      if (headshot) g.player.stats.headshots++;
      g.player.stats.score = g.score;
      g.hud.popScore(pts, headshot ? 'HEADSHOT' : m.role === 'guard' ? 'ROYAL GUARD DOWN' : 'ENEMY DOWN');
      g.onMercKilledByPlayer?.(m, headshot, opts);
    } else if (source?.stats) {
      source.stats.kills++;
      source.stats.score += HOG.score[m.role];
    }
    this.onKill?.(m);
  }
}
