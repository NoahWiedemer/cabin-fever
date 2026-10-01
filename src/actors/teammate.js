// AI fireteam members: pick defensive posts near the player, engage visible infected with their
// signature guns (real hitscan, pellets, bursts, tracers, muzzle flashes), reload, retreat when hurt,
// die and respawn. One Teammate per fireteam.js character, each with a fixed body and gun.
import * as THREE from 'three';
import { createCharacter } from './rig.js';
import { buildBotWeapon } from '../player/gunSafe.js';
import { clamp, damp, dampAngle, rand, coneDirection, lerp, smoothstep, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { FIRETEAM } from './fireteam.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };
const _fw = { x: 0, z: 0, speed: 0 };
const DEG = Math.PI / 180;

// Signature guns: rpm, burst size, wind-up, pellets, mags and reloads come from weaponDefs.js; damage
// is about half the player's and tuned so each gun sustains roughly the old M4 bot's ~60 DPS (all
// hits, reloads included) in its own way. shots: rounds per trigger pull [min, max] (burst guns:
// bursts per volley), pause: s between trigger pulls, aim: aim error scale, head: headshot attempt
// chance, spread: pellet cone (deg), range: engagement distance (m), vol / pitch: fire sound.
const BOT_GUNS = {
  // Soldier · the old bot rifle: bursts of 3-6
  m4a1: { damage: 18, falloff: [25, 70, 0.55], shots: [3, 6], pause: [0.5, 1.0], aim: 1, tracer: 0.55, flash: 0.9, sound: 'm4_fire', vol: 0.75, pitch: 1 },
  // Ellis · 3-round bursts, one or two per volley: the most accurate, best at range
  m16a2: { damage: 19, falloff: [35, 100, 0.65], shots: [1, 2], burstGap: 0.3, pause: [0.55, 1.0], aim: 0.8, head: 0.26, tracer: 0.6, flash: 0.9, sound: 'm4_fire', vol: 0.75, pitch: 0.93 },
  // Scorpion · fast carbine, longer bursts of lighter rounds
  r201: { damage: 16, falloff: [30, 90, 0.6], shots: [4, 7], pause: [0.5, 0.95], aim: 0.9, tracer: 0.55, flash: 0.85, sound: 'm4_fire', vol: 0.7, pitch: 1.08 },
  // Viper · LMG: long strings that wind up from 480 to 960 rpm, light rounds that punch through one body
  devotion: { damage: 10, penetration: 1, falloff: [35, 100, 0.65], shots: [10, 20], pause: [0.35, 0.7], aim: 1.15, tracer: 0.5, flash: 1.0, sound: 'lmg_fire', vol: 0.62, pitch: 1 },
  // Raven · P90: quick strings of light rounds from a 50-round top magazine, best up close and at mid range
  p90: { damage: 12, falloff: [16, 45, 0.55], shots: [5, 9], pause: [0.45, 0.85], aim: 0.95, tracer: 0.5, flash: 0.8, sound: 'smg_fire', vol: 0.7, pitch: 1 },
  // Coach · pump shotgun: 9 pellets, slow pump cadence, shell-by-shell reloads, only engages up close
  spas12: { damage: 14, falloff: [10, 34, 0.4], shots: [1, 1], pause: [0.75, 0.95], aim: 0.85, spread: 2.0, range: 22, flash: 1.35, sound: 'shotgun_fire', vol: 0.8, pitch: 1 },
};

/** weaponDefs entry with the bot damage model on top (what game.hitscan reads) + the bot tuning in .bot */
function botGun(id) {
  const def = WEAPONS[id] ?? WEAPONS.m4a1;
  const g = BOT_GUNS[def.id] ?? BOT_GUNS.m4a1;
  return { ...def, damage: g.damage, penetration: g.penetration ?? 0, falloff: g.falloff, bot: g };
}

// fire sounds of all bots share a rate limit per sound, so a full team firing doesn't flood the mixer
const _sfxAt = new Map();

// rifle hold, in gun space (x right, y up, -z muzzle): stock pocket → grip, wrist targets and hand frames.
// Tuned on the M4A1; other guns shift the wrists by how far their grip markers sit from the M4's (REF_*).
const GRIP_FWD = 0.25; // grip ahead of the shoulder pocket (≈ butt-to-grip length)
const WRIST_R = new THREE.Vector3(0.025, -0.075, 0.09);
const WRIST_L = new THREE.Vector3(-0.035, -0.07, -0.21);
const REF_R = new THREE.Vector3(0, -0.005, -0.018);
const REF_L = new THREE.Vector3(0, 0.049, -0.331);
const ALONG_R = new THREE.Vector3(-0.1, 0.35, -0.93).normalize();
const PALM_R = new THREE.Vector3(-1, 0, 0);
const ALONG_L = new THREE.Vector3(0.2, 0.2, -0.96).normalize();
const PALM_L = new THREE.Vector3(0.55, 0.83, 0).normalize();
// procedural hands: fingers along -Y, palms forward (GLB bodies report their own)
const PROC_HANDS = { L: { along: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(0, 0, 1) }, R: { along: new THREE.Vector3(0, -1, 0), palm: new THREE.Vector3(0, 0, 1) } };
const X = new THREE.Vector3(1, 0, 0);
const _gq = new THREE.Quaternion();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _G = new THREE.Vector3();
const _S = new THREE.Vector3();
const _T = new THREE.Vector3();
const _E = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Vector3();
const _u = new THREE.Vector3();
const _f = new THREE.Vector3();
const _x = new THREE.Vector3();
const _r = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _low = new THREE.Vector3();
// eye relative to the head bone in gun space (x right, y up, -z forward): the right eye, just ahead
const EYE_FROM_HEAD = new THREE.Vector3(0.032, 0.075, -0.085);
// reloading (_reloadHand): the support wrist at the magwell / loading port, gun space from the firing wrist;
// the mag pouch on the left hip, character space (+x its left, +z ahead)
const MAGWELL = new THREE.Vector3(-0.05, -0.08, -0.17);
const POUCH = new THREE.Vector3(0.17, 0.98, 0.12);
const _rw = new THREE.Vector3();
const _rp = new THREE.Vector3();
const _rg = new THREE.Vector3();
const _aw = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _e3 = new THREE.Vector3();
const _ma = new THREE.Matrix4();
const _mb = new THREE.Matrix4();

function basis(a, b, m) {
  _e1.copy(a).normalize();
  _e2.copy(b).addScaledVector(_e1, -b.dot(_e1)).normalize();
  _e3.crossVectors(_e1, _e2);
  return m.makeBasis(_e1, _e2, _e3);
}
/** rotation taking the local frame (al, bl) onto (aw, bw); a matches exactly, b as close as possible */
export function frameQuat(al, bl, aw, bw, out) {
  basis(al, bl, _ma);
  basis(aw, bw, _mb);
  return out.setFromRotationMatrix(_mb.multiply(_ma.transpose()));
}

/**
 * Two-bone arm IK on rig.js-style bones (rest pose hangs along the child offset, elbow hinge = local X):
 * put the wrist on `target` (world), bend the elbow toward `pole`, orient the hand to (along, palm) world
 * using the hand's rest frame `h` ({along, palm} in hand space).
 */
export function reach(upper, fore, hand, target, pole, along, palm, h) {
  const a = fore.position.length(), c = hand.position.length();
  upper.getWorldPosition(_S);
  _n.copy(target).sub(_S);
  const d = clamp(_n.length(), Math.abs(a - c) + 0.02, (a + c) * 0.999);
  _n.normalize();
  const cosA = clamp((a * a + d * d - c * c) / (2 * a * d), -1, 1);
  _m.copy(pole).addScaledVector(_n, -pole.dot(_n)).normalize();
  _u.copy(_n).multiplyScalar(cosA).addScaledVector(_m, Math.sqrt(1 - cosA * cosA));
  _E.copy(_S).addScaledVector(_u, a);
  _f.copy(_S).addScaledVector(_n, d).sub(_E).normalize();
  // upper arm: rest bone direction → u, hinge axis → n × m (∝ f × u, also defined for a straight arm),
  // so flexing about local X bends the forearm toward the target
  _x.crossVectors(_n, _m);
  _r.copy(fore.position).normalize().negate();
  frameQuat(_r, X, _aw.copy(_u).negate(), _x, _qa);
  upper.parent.getWorldQuaternion(_qb);
  upper.quaternion.copy(_qb.invert().multiply(_qa));
  // forearm: pure hinge flex
  _x.copy(X).addScaledVector(_r, -X.dot(_r)).normalize();
  fore.quaternion.setFromAxisAngle(_x, -Math.acos(clamp(_u.dot(_f), -1, 1)));
  // hand
  _qa.multiply(fore.quaternion).invert();
  hand.quaternion.copy(_qa.multiply(frameQuat(h.along, h.palm, along, palm, _qb)));
}

export class Teammate {
  /** character: a roster entry of its own (fireteam.js PLAYER_CHARACTER: your body in the cutscenes), else FIRETEAM[index] */
  constructor(game, index, character = null) {
    this.game = game;
    this.index = index;
    const c = (this.character = character ?? FIRETEAM[index % FIRETEAM.length]);
    this.id = c.id;
    this.name = c.name;
    this.rank = c.rank;
    this.chars = new Map(); // kind -> character, each body built once
    this._wear(c.body);
    this.body = {
      pos: this.root.position,
      vel: new THREE.Vector3(),
      radius: 0.3,
      height: 1.75,
      stepHeight: 0.52,
      onGround: true,
      gravity: 18,
    };
    this.radius = 0.3;
    // signature gun in the right hand
    this.weapon = botGun(c.weapon);
    this.weaponName = c.gun;
    let w;
    try {
      w = buildBotWeapon(this.weapon.id, this.weapon.model);
    } catch (e) {
      const root = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.7), new THREE.MeshStandardMaterial({ color: 0x111111 }));
      root.position.z = -0.25;
      w = { root, muzzle: new THREE.Vector3(0, 0.03, -0.6), rightHand: REF_R.clone(), leftHand: REF_L.clone(), stock: 0.1 };
    }
    this.gun = w.root;
    // dense GLB guns (tens of thousands of triangles) skip the shadow pass: a gun's shadow is barely visible
    let tris = 0;
    this.gun.traverse((o) => {
      if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    });
    this.gun.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = tris < 20000;
        o.receiveShadow = true;
      }
    });
    // hold: the M4-tuned wrists shifted onto this gun's grip markers; long stocks push the grip forward
    this.hold = {
      gripFwd: Math.max(GRIP_FWD, Math.min(0.3, w.stock)),
      wristR: WRIST_R.clone().add(w.rightHand).sub(REF_R),
      wristL: WRIST_L.clone().add(w.leftHand).sub(REF_L),
      eye: (w.eye ?? new THREE.Vector3(0, 0.11, 0.13)).clone(), // aiming: this point of the gun sits at the eye
    };
    // the gun is posed in character space along the aim (muzzle = -Z); both hands are IK'd onto it
    this.gunHolder = new THREE.Group();
    this.gunHolder.add(this.gun);
    this.mesh.add(this.gunHolder);
    this.muzzleLocal = w.muzzle.clone();
    this.ejectLocal = new THREE.Vector3(0.02, 0.05, Math.max(-0.25, w.muzzle.z * 0.2));
    this.stats = { kills: 0, deaths: 0, headshots: 0, score: 0 };
    this.alive = false;
  }

  get pos() {
    return this.body.pos;
  }

  /** switch bodies, keeping scene membership, position, visibility and the rifle */
  _wear(kind) {
    let char = this.chars.get(kind);
    if (!char) {
      char = createCharacter(kind, 1);
      char.root.rotation.order = 'YXZ';
      this.chars.set(kind, char);
    }
    if (this.char === char) return;
    const old = this.root;
    this.char = char;
    this.root = char.root;
    this.mesh = char.mesh;
    this.bones = char.bones;
    this.rig = char.rig || null; // GLB body: retarget after posing the proxy bones
    this.hands = char.hands || PROC_HANDS;
    this.jiggle = char.jiggle || null; // bust springs (Viper)
    if (old) {
      this.root.position.copy(old.position);
      this.root.visible = old.visible;
      const parent = old.parent;
      if (parent) {
        parent.remove(old);
        parent.add(this.root);
      }
      this.body.pos = this.root.position;
    }
    if (this.gunHolder) this.mesh.add(this.gunHolder);
  }

  spawn(pos, yaw = 0) {
    this.alive = true;
    this.root.visible = true;
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.root.rotation.set(0, yaw, 0);
    this.mesh.position.set(0, 0, 0);
    if (this.gunHolder.parent !== this.mesh) this.mesh.add(this.gunHolder);
    this.yaw = yaw;
    this.aimPitch = 0;
    this.ready = 0;
    this.hp = 100;
    this.ap = 60;
    this.mag = this.weapon.mag;
    this.reloadT = 0;
    this.cooldown = 0;
    this.burst = 0;
    this.volley = 0;
    this.spin = 0; // wind-up (LMG): rounds of the current string
    this.lastShotT = -9;
    this.pumpT = 0;
    this.target = null;
    this.targetT = 0;
    this.post = null;
    this.postT = 0;
    this.deadT = 0;
    this.level = levelOf(pos.y + 0.3);
    this.moveSpeed = 0;
    this.phase = 0;
    this.recoil = 0;
    this.crouch = 0;
    this.field = null;
    this.portalTo = null;
    this.stuck = 0;
    this.hurtT = 0;
    this.lastPos = pos.clone();
    this.fireFlash = 0;
    // animation state (_animate): the way it moves relative to its facing, the turn shuffle, the idle look-round,
    // the hit flinch spring, the reload's length (for the hands)
    this.moveDir = 0;
    this.prevYaw = yaw;
    this.turnStep = 0;
    this.look = 0;
    this.lookP = 0;
    this.lookT = rand(1, 3);
    this.flinch = 0;
    this.flinchV = 0;
    this.reloadDur = 0;
    if (this.jiggle) this.jiggle.reset();
  }

  takeDamage(amount, fromPos, source) {
    if (!this.alive || this.invulnT > 0) return; // invulnT: just revived (game/revive.js)
    let dmg = amount;
    if (this.ap > 0) {
      const ab = Math.min(this.ap, dmg * 0.5);
      this.ap -= ab;
      dmg -= ab;
    }
    this.hp -= dmg;
    this.hurtT = 1.5;
    this.flinchV = (this.flinchV ?? 0) + clamp(amount / 25, 0.25, 1) * 6; // the torso and head jolt back
    if (this.jiggle) this.jiggle.kick(rand(-0.3, 0.3), 0.35, rand(-0.3, 0.3));
    if (fromPos && !this.target) this.targetT = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deadT = 0;
      this.stats.deaths++;
      this.fallDir = Math.random() < 0.5 ? 1 : -1;
      this.bones.handR.attach(this.gunHolder); // the rifle drops with the right hand
      this.game.onTeammateDied(this, source);
    }
  }

  knockback(x, y, z) {
    this.body.vel.x += x;
    this.body.vel.y = Math.max(this.body.vel.y, y);
    this.body.vel.z += z;
  }

  _choosePost() {
    const game = this.game;
    const player = game.player;
    // (a post can wait for an unlock: `requires`, e.g. Appenweier's fire station hall)
    const posts = game.level.defensePosts.filter((p) => (!p.requires || game.unlocked?.[p.requires]) && !game.team.some((t) => t !== this && t.post === p));
    const ref = player.alive ? player.pos : this.pos;
    posts.sort((a, b) => a.pos.distanceToSquared(ref) - b.pos.distanceToSquared(ref));
    const pick = posts[Math.min(posts.length - 1, Math.floor(Math.random() * Math.min(3, posts.length)))];
    this.post = pick || null;
    this.postT = rand(10, 18);
    this.field = null;
    this.portalTo = null;
  }

  update(dt) {
    const game = this.game;
    if (!this.alive) {
      this._animateDead(dt);
      return;
    }
    if (game.revives?.botUpdate(this, dt)) return; // a revive run (game/revive.js) drives this bot
    const pos = this.pos;
    this.level = levelOf(pos.y + 0.3);
    this.hurtT -= dt;

    // ---- target selection
    this.targetT -= dt;
    if (this.targetT <= 0) {
      this.targetT = rand(0.25, 0.45);
      let best = null, bd = Infinity;
      const range = this.weapon.bot.range ?? 26;
      for (const z of game.zombies.list) {
        if (!z.alive || z.latchHost === this) continue; // a Biter on its own back gets shaken off, not shot
        if (z.type.haunt && !z.exposed) continue; // the Stalker is the player's to see, until it attacks (stalker.js)
        const d = z.pos.distanceTo(pos);
        if (d > range) continue;
        // a Biter latched onto anyone comes first (shots on it never hurt its host), then an attacking Stalker and
        // Boomers (they must die before they get close), then the fast dogs and Biters
        const score = d * (z.latchHost ? 0.15 : z.type.haunt ? 0.4 : z.typeName === 'charger' ? 0.5 : z.typeName === 'dog' || z.typeName === 'biter' ? 0.75 : 1);
        if (score >= bd) continue;
        if (Math.abs(z.pos.y - pos.y) > 2.5) continue;
        const cy = z.hipsWorld ? z.hipsWorld.y : z.pos.y + 1.2;
        if (!game.world.lineOfSight(pos.x, pos.y + 1.5, pos.z, z.pos.x, cy, z.pos.z)) continue;
        bd = score;
        best = z;
      }
      // the NOX squad and the militia (actors/merc.js, actors/insurgent.js) shoot back: they come first
      for (const m of game.hostiles ?? game.mercs?.list ?? []) {
        if (m === this || !m.alive || !m.inPlay) continue;
        const d = m.pos.distanceTo(pos);
        // (the militia's snipers and gunners up on balconies and roofs are fair game from the street)
        if (d > range + 6 || d * 0.55 >= bd || Math.abs(m.pos.y - pos.y) > (m.post ? 9 : 2.5)) continue;
        if (!game.world.lineOfSight(pos.x, pos.y + 1.5, pos.z, m.pos.x, m.pos.y + 1.2, m.pos.z)) continue;
        bd = d * 0.55;
        best = m;
      }
      this.target = best;
    }
    if (this.target && !this.target.alive) this.target = null;

    // ---- movement: holding a post near you (the default), or following you round (key T: game.botOrders)
    let wantX = 0, wantZ = 0, speed = 0;
    const follow = game.botOrders === 'follow' && game.player.alive;
    if (follow) {
      const fw = this._follow(dt);
      wantX = fw.x;
      wantZ = fw.z;
      speed = fw.speed;
    } else {
      this.postT -= dt;
      if (!this.post || this.postT <= 0) this._choosePost();
      this.settled = false;
    }
    if (this.post && !follow) {
      const dx = this.post.pos.x - pos.x, dz = this.post.pos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      const tooClose = this.target && this.target.pos.distanceTo(pos) < 3.2;
      if (tooClose) {
        // back away from the threat
        _v.copy(pos).sub(this.target.pos).setY(0).normalize();
        wantX = _v.x;
        wantZ = _v.z;
        speed = 3.0;
      } else if (dist > 0.6) {
        if (!this.field) this.field = game.navFieldFor(this.post);
        const st = this.field ? this.field.steer(this.level, pos.x, pos.z, _steer) : null;
        if (st && (Math.abs(st.dirX) + Math.abs(st.dirZ) > 1e-3)) {
          wantX = st.dirX;
          wantZ = st.dirZ;
        } else {
          wantX = dx;
          wantZ = dz;
        }
        // stairs / the barn ladder: keep heading for the portal's far end until on its level (a bot up on the
        // hayloft walks out of the railing gap and drops to the floor; actors/ladders.js)
        if (st?.portal && !this.portalTo) {
          this.portalTo = st.portalTo;
          this.portalT = 0;
        }
        if (this.portalTo) {
          this.portalT += dt;
          if (this._portalDone() || this.portalT > 8) this.portalTo = null;
          else {
            wantX = this.portalTo.x - pos.x;
            wantZ = this.portalTo.z - pos.z;
          }
        }
        const l = Math.hypot(wantX, wantZ) || 1;
        wantX /= l;
        wantZ /= l;
        speed = this.target ? 2.4 : 4.2;
      }
    }
    // separation from player & other bots
    for (const m of game.team) {
      if (m === this || !m.alive) continue;
      const ox = pos.x - m.pos.x, oz = pos.z - m.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 0.8 && d2 > 1e-5) {
        const d = Math.sqrt(d2);
        wantX += (ox / d) * 0.8;
        wantZ += (oz / d) * 0.8;
        speed = Math.max(speed, 1.5);
      }
    }
    const b = this.body;
    if (this.latchedBy) speed *= 0.6; // a Biter on the back (biter.js)
    b.vel.x = damp(b.vel.x, wantX * speed, 10, dt);
    b.vel.z = damp(b.vel.z, wantZ * speed, 10, dt);
    const before = _v.copy(pos);
    game.world.moveBody(b, dt);
    const mv = Math.hypot(pos.x - before.x, pos.z - before.z) / Math.max(dt, 1e-4);
    this.moveSpeed = damp(this.moveSpeed, mv, 10, dt);

    // ---- aim & shoot
    let faceYaw = this.yaw;
    let wantPitch = 0;
    if (this.target) {
      const tp = this.target.hipsWorld || this.target.pos;
      const aimY = (this.target.hipsWorld ? tp.y : tp.y + 1.2) + 0.1;
      faceYaw = Math.atan2(tp.x - pos.x, tp.z - pos.z);
      const hd = Math.hypot(tp.x - pos.x, tp.z - pos.z);
      wantPitch = Math.atan2(aimY - (pos.y + 1.45), hd);
    } else if (follow && this.settled && this.slotYaw != null) {
      faceYaw = this.slotYaw + Math.sin(game.time * 0.3 + this.index) * 0.5; // (watching its side, away from you)
    } else if (!follow && this.post && Math.hypot(this.post.pos.x - pos.x, this.post.pos.z - pos.z) < 1) {
      faceYaw = this.post.face + Math.sin(game.time * 0.3 + this.index) * 0.6;
    } else if (Math.hypot(wantX, wantZ) > 0.1) {
      faceYaw = Math.atan2(wantX, wantZ);
    }
    this.yaw = dampAngle(this.yaw, faceYaw, 8, dt);
    this.aimPitch = damp(this.aimPitch, wantPitch, 8, dt);
    this.root.rotation.y = this.yaw;

    this.cooldown -= dt;
    const w = this.weapon;
    const g = w.bot;
    if (this.pumpT > 0 && (this.pumpT -= dt) <= 0) this._cycle();
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this._reloadStep();
    } else if (this.target && this.cooldown <= 0) {
      const aimErr = Math.abs(wrapAngle(faceYaw - this.yaw));
      if (aimErr < 0.15) {
        // a trigger pull: shots[] rounds (burst guns: shots[] bursts of def.burst)
        if (this.burst <= 0) {
          this.burst = Math.floor(rand(g.shots[0], g.shots[1] + 1)) * (w.mode === 'burst' ? w.burst || 3 : 1);
          this.volley = 0;
        }
        this._shoot();
        this.burst--;
        this.volley++;
        // inside a trigger pull the frame overshoot carries over, so the rate matches the rpm at any frame rate
        this.cooldown = this.burst > 0 ? Math.max(this.cooldown, -dt) + this._interval() : rand(g.pause[0], g.pause[1]);
        if (this.mag <= 0) this._startReload();
      }
    } else if (!this.target && this.mag < w.mag * 0.5 && game.time - this.lastShotT > 1.5) {
      this._startReload(); // top up during a lull
    }
    this.crouch = damp(this.crouch, this.target && this.moveSpeed < 0.5 && this.index % 2 === 0 ? 1 : 0, 4, dt);
    this.recoil = damp(this.recoil, 0, 14, dt);
    this._animate(dt);
  }

  /**
   * Following you (game.botOrders 'follow'): each bot keeps to a ring round you, 2.2 to 7 m off, on its own side
   * (it walks toward the ring point on its side of you, not onto you). In a clear line on your floor it walks
   * there straight; otherwise it takes the follow field toward you (game.js _updateFollow; stairs too), and
   * never into a place the nav keeps it out of (it waits at the nearest spot). In the ring it stands and covers
   * its side, until you've walked on. Something in its face: it backs off first. Returns { x, z (unit), speed }.
   */
  _follow(dt) {
    const game = this.game, nav = game.nav, pos = this.pos, P = game.player.pos;
    const out = _fw;
    out.x = out.z = out.speed = 0;
    if (this.target && this.target.pos.distanceTo(pos) < 3.2) {
      _v.copy(pos).sub(this.target.pos).setY(0).normalize();
      out.x = _v.x;
      out.z = _v.z;
      out.speed = 3.0;
      this.settled = false;
      return out;
    }
    const same = this.level === levelOf(P.y + 0.3);
    const dx = pos.x - P.x, dz = pos.z - P.z;
    const d = Math.hypot(dx, dz);
    // (a clear line to you, checked every ~0.3 s)
    if ((this.clearT = (this.clearT ?? 0) - dt) <= 0) {
      this.clearT = 0.3;
      this.clearToYou = same && d < 16 && nav.lineClear(this.level, pos.x, pos.z, P.x, P.z, 1);
    }
    if (this.clearToYou && d > 1e-3) {
      this.portalTo = null;
      this.slotYaw = Math.atan2(dx, dz); // (in the ring: it faces away from you, covering its side)
      if (d >= 2.2 && d <= (this.settled ? 7 : 4.6)) {
        this.settled = true;
        return out;
      }
      this.settled = false;
      // too close: a step back out; too far: to the ring point on its side of you
      const want = d < 2.2 ? 3.2 : 3.8;
      const tx = P.x + (dx / d) * want - pos.x, tz = P.z + (dz / d) * want - pos.z;
      const l = Math.hypot(tx, tz) || 1;
      out.x = tx / l;
      out.z = tz / l;
      out.speed = d < 2.2 ? 1.8 : this.target ? 2.4 : l > 4 ? 4.2 : 2.8;
      return out;
    }
    const st = game.followField?.ready ? game.followField.steer(this.level, pos.x, pos.z, _steer) : null;
    // near you round a corner or a desk (a short way on your floor): that's close enough, stand
    if (same && d < (this.settled ? 4.5 : 3.6) && st && st.dist < 12) {
      this.settled = true;
      this.slotYaw = Math.atan2(dx, dz);
      return out;
    }
    this.settled = false;
    // (on a flight of stairs the field has no value under it: a bot already on its way up or down keeps going for
    // the far end, else it would stop on the steps)
    if (!st && !this.portalTo) return out; // (no way from here yet, or the field isn't in: wait)
    if (st?.portal?.ladder) return out; // (bots don't climb: it waits at the ladder for you to come back)
    if (st?.portal && !this.portalTo) {
      this.portalTo = st.portalTo;
      this.portalT = 0;
    }
    let x = st?.dirX ?? 0, z = st?.dirZ ?? 0;
    if (this.portalTo) {
      this.portalT += dt;
      if (this._portalDone() || this.portalT > 8) this.portalTo = null;
      else {
        x = this.portalTo.x - pos.x;
        z = this.portalTo.z - pos.z;
      }
    }
    const l = Math.hypot(x, z);
    if (l < 1e-3) return out; // (as close to you as the nav goes: e.g. you're in the Hive's lab)
    out.x = x / l;
    out.z = z / l;
    out.speed = this.target ? 2.6 : 4.4;
    return out;
  }

  /** a flight taken (stairs, the ladder): on its far end's floor and close to it (mid-flight the floor below can read as either) */
  _portalDone() {
    const t = this.portalTo, p = this.pos;
    return this.level === t.level && Math.hypot(t.x - p.x, t.z - p.z) < 1.1;
  }

  /** delay to the next round of a trigger pull: burst gap, wound-up LMG rate or the plain rpm */
  _interval() {
    const w = this.weapon;
    if (w.mode === 'burst' && this.volley % (w.burst || 3) === 0) return w.bot.burstGap ?? 0.3;
    const wind = w.rampRpm ? Math.min(1, this.spin / (w.rampShots ?? 12)) : 0;
    return 60 / (w.rpm + ((w.rampRpm ?? w.rpm) - w.rpm) * wind);
  }

  _startReload() {
    const w = this.weapon;
    this.burst = 0;
    if (w.reloadType === 'shell') {
      this.reloadT = this.reloadDur = (w.reloadStart ?? 0.3) + (w.shellTime ?? 0.45);
      return;
    }
    this.reloadT = this.reloadDur = this.mag > 0 ? w.reload ?? 2.4 : w.reloadEmpty ?? w.reload ?? 2.4;
    this.game.audio.play('m4_reload', { position: this.pos, volume: 0.5, pitch: w.mag > 60 ? 0.85 : 1 });
  }

  /** a mag reload completes; a shotgun loads one shell and goes on unless it has enough to fight */
  _reloadStep() {
    const w = this.weapon;
    if (w.reloadType !== 'shell') {
      this.mag = w.mag;
      return;
    }
    this.mag = Math.min(w.mag, this.mag + 1);
    this.game.audio.play('shotgun_insert', { position: this.pos, volume: 0.35 });
    // keep loading unless something is in its face and there are a few shells to meet it with
    const close = this.target && this.target.alive && this.target.pos.distanceTo(this.pos) < 6;
    if (this.mag < w.mag && !(close && this.mag >= 3)) this.reloadT = this.reloadDur = w.shellTime ?? 0.45;
    else {
      this.cooldown = Math.max(this.cooldown, w.reloadEnd ?? 0.4);
      this.pumpT = (w.reloadEnd ?? 0.4) * 0.5;
      this.pumpShell = false;
    }
  }

  /** pump-action cycle after a shot: rack sound + the spent shell */
  _cycle() {
    const game = this.game;
    game.audio.play('shotgun_pump', { position: this.pos, volume: 0.42 });
    if (this.pumpShell !== false) {
      this.root.updateMatrixWorld(true);
      game.fx.shell('shotgun', this.gun.localToWorld(_v.copy(this.ejectLocal)), new THREE.Vector3(rand(-1, 1), 2.2, rand(-1, 1)));
    }
    this.pumpShell = true;
  }

  /** positional fire sound, rate-limited across the whole fireteam per sound */
  _fireSound(pos) {
    const g = this.weapon.bot;
    const now = this.game.time;
    const last = _sfxAt.get(g.sound) ?? -Infinity;
    if (now - last < 0.055 && now >= last) return;
    _sfxAt.set(g.sound, now);
    this.game.audio.play(g.sound, { position: pos, volume: g.vol ?? 0.75, pitch: (g.pitch ?? 1) * (1 + rand(-0.025, 0.025)) });
  }

  _shoot() {
    const game = this.game;
    const w = this.weapon;
    const g = w.bot;
    const pellets = w.pellets > 1 ? w.pellets : 1;
    this.mag--;
    this.recoil = pellets > 1 ? 1.8 : w.rampRpm ? 0.7 : 1;
    if (game.time - this.lastShotT > 0.6) this.spin = 0; // the LMG spins down between strings
    this.spin++;
    this.lastShotT = game.time;
    this.root.updateMatrixWorld(true);
    const muzzle = this.gun.localToWorld(this.muzzleLocal.clone());
    const tp = this.target.hipsWorld || this.target.pos;
    const eye = _v.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const aim = new THREE.Vector3(tp.x, (this.target.hipsWorld ? tp.y : tp.y + 1.2) + rand(-0.1, 0.35), tp.z);
    if (Math.random() < (g.head ?? 0.18)) aim.y += 0.4; // occasional headshot attempt
    _d.copy(aim).sub(eye).normalize();
    const dist = aim.distanceTo(eye);
    const err = (2.2 + dist * 0.09) * (g.aim ?? 1) * DEG;
    const dir = coneDirection(_d, err, new THREE.Vector3());
    const origin = eye.clone();
    if (pellets > 1) {
      // buckshot: pellets spread around the aim point, two of them draw tracers
      const pd = new THREE.Vector3();
      game.beginVolley();
      for (let i = 0; i < pellets; i++) {
        coneDirection(dir, (g.spread ?? 2) * DEG, pd);
        game.hitscan(origin, pd, w, this, { tracerFrom: i < 2 ? muzzle : null, bot: true, pellet: i });
      }
      game.endVolley(dir);
    } else {
      game.hitscan(origin, dir, w, this, { tracerFrom: Math.random() < (g.tracer ?? 0.55) ? muzzle : null, bot: true });
    }
    game.fx.muzzleWorld(muzzle, dir, g.flash ?? 0.9);
    this._fireSound(muzzle);
    if (this.jiggle) this.jiggle.kick(-dir.x * 0.24, 0.28, -dir.z * 0.24); // recoil
    if (w.mode === 'pump') this.pumpT = 0.26;
    else if (Math.random() < 0.3) game.fx.shell(w.shell ?? 'rifle', this.gun.localToWorld(_v.copy(this.ejectLocal)), new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)));
    game.alertNoise(this.pos, 25);
  }

  /**
   * Body animation on the proxy bones (the rifle and both arms are _holdRifle's):
   *   legs     step the way it actually moves relative to where it faces: forward, backpedalling (shorter steps)
   *            or sideways (the legs never cross); turning on the spot shuffles the feet round
   *   stance   feet apart, knees soft; lower and more braced when it aims; the crouch / kneel (this.crouch)
   *   idle     slow breathing, the weight drifting from foot to foot, and with nothing to shoot the head looks
   *            round now and then
   *   run      leaning into it, the torso counter-rotating with the stride, the head kept steady
   *   hit      a flinch spring (takeDamage kicks it): torso and head jolt back
   */
  _animate(dt) {
    const b = this.bones;
    const t = this.game.time;
    // how it moves relative to its facing (0: forward, ±π/2: sideways to its left / right, π: back)
    const v = this.body.vel;
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const vf = v.x * sy + v.z * cy, vs = v.x * cy - v.z * sy;
    if (Math.hypot(vf, vs) > 0.3) this.moveDir = dampAngle(this.moveDir ?? 0, Math.atan2(vs, vf), 10, dt);
    const sp = this.moveSpeed;
    const run = clamp((sp - 1.8) / 2.2, 0, 1);
    const moving = clamp(sp / 0.7, 0, 1);
    // turning on the spot: the feet shuffle round
    const turn = dt > 0 ? Math.abs(wrapAngle(this.yaw - (this.prevYaw ?? this.yaw))) / dt : 0;
    this.prevYaw = this.yaw;
    this.turnStep = damp(this.turnStep ?? 0, clamp(turn / 2.5, 0, 1) * (1 - moving), 8, dt);
    this.phase += dt * ((sp / lerp(1.0, 1.75, run)) * Math.PI + this.turnStep * 7);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const cf = Math.cos(this.moveDir ?? 0), sf = Math.sin(this.moveDir ?? 0);
    const amp = (lerp(0.32, 0.62, run) * moving + this.turnStep * 0.16) * (cf < 0 ? 1 + 0.3 * cf : 1);
    const cr = this.crouch;
    const idle = (1 - moving) * (1 - cr);
    const brace = this.ready ?? 0; // aiming: a lower, braced stance
    const breath = Math.sin(t * 1.45 + this.index * 2.1);
    const sway = Math.sin(t * 0.33 + this.index * 1.7);
    // hit flinch: a stiff, quickly damped spring
    if (dt > 0) {
      this.flinchV = ((this.flinchV ?? 0) - (this.flinch ?? 0) * 160 * dt) * Math.exp(-12 * dt);
      this.flinch = (this.flinch ?? 0) + this.flinchV * dt;
    }
    const fl = this.flinch ?? 0;

    // legs: each swings along the way it goes (its forward swing sL / sR, split into forward and sideways)
    const sL = s * amp, sR = -s * amp;
    const bend = lerp(0.08, 0.2, brace) * (1 - moving * 0.5); // a soft knee in the stance, more when braced
    const lean = run * 0.18 * Math.max(0, cf);
    b.hips.position.y = 0.98 - cr * 0.38 - bend * 0.1 + Math.abs(c) * (0.025 + run * 0.045) * moving + breath * 0.003 * idle;
    b.hips.rotation.set(0, 0.35 + s * 0.1 * moving * cf, c * 0.05 * moving + sway * 0.035 * idle);
    b.thighL.rotation.set(-sL * cf - bend - cr * 1.3, -0.3, Math.max(0.02, 0.07 + 0.02 * idle + sL * sf * 0.6));
    b.thighR.rotation.set(-sR * cf - bend - cr * 0.2, -0.3, Math.min(-0.02, -0.07 - 0.02 * idle + sR * sf * 0.6));
    // (each knee bends while its foot swings the way it goes: sL rising, cos > 0 for the left)
    b.shinL.rotation.set(Math.max(0, c) * amp * 1.45 + 0.08 + bend * 2 + cr * 1.6 + run * 0.1, 0, 0);
    b.shinR.rotation.set(Math.max(0, -c) * amp * 1.45 + 0.08 + bend * 2 + cr * 1.9 + run * 0.1, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.75, 0, -b.thighL.rotation.z * 0.8);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.75 + cr * 0.3, 0, -b.thighR.rotation.z * 0.8);

    // torso: lean into a run and into a sidestep, counter-rotate with the stride, breathe, flinch
    b.spine.rotation.set(0.08 + lean + cr * 0.15 + brace * 0.06 + breath * 0.01 * idle - fl * 0.4, -0.3 - s * 0.07 * moving, -sf * 0.07 * moving);
    b.chest.rotation.set(-this.aimPitch * 0.4 - this.recoil * 0.04 + breath * 0.018 * idle - fl * 0.2, -0.05 + s * 0.05 * moving, 0);
    // head: steady on the move; nothing to shoot and standing: it looks round now and then
    if ((this.lookT = (this.lookT ?? 0) - dt) <= 0) {
      this.lookT = rand(2.2, 5.5);
      const free = !this.target && sp < 0.5;
      this.lookTo = free ? rand(-0.7, 0.7) : 0;
      this.lookUp = free ? rand(-0.15, 0.1) : 0;
    }
    this.look = damp(this.look ?? 0, this.target ? 0 : this.lookTo ?? 0, 4, dt);
    this.lookP = damp(this.lookP ?? 0, this.target ? 0 : this.lookUp ?? 0, 4, dt);
    b.neck.rotation.set(-this.aimPitch * 0.3 + this.lookP * 0.5, 0.2 + this.look * 0.4 + s * 0.035 * moving, 0);
    b.head.rotation.set(-this.aimPitch * 0.3 - cr * 0.1 + this.lookP * 0.5 - fl * 0.35, 0.15 + this.look * 0.6 + s * 0.035 * moving, 0);
    this._holdRifle(dt);
    if (this.rig) this.rig.sync();
    if (this.jiggle) this.jiggle.update(dt);
  }

  /**
   * Rifle along yaw + aim pitch, hands IK'd on. Aiming: the gun's sight sits at the right eye (cheek on
   * the stock, the butt falls into the shoulder). Idle: low ready from the shoulder pocket, muzzle down.
   */
  _holdRifle(dt) {
    const b = this.bones;
    this.ready = damp(this.ready, this.cineReady ?? (this.target && this.reloadT <= 0 ? 1 : 0), 5, dt);
    // reloading: the gun cants over toward the support hand (mag reloads: magwell up; shells: port up)
    const rl = this.reloadT > 0 && this.reloadDur > 0 ? 1 - this.reloadT / this.reloadDur : -1;
    const shell = this.weapon.reloadType === 'shell';
    const cant = rl >= 0 ? (shell ? 1 : smoothstep(0, 0.12, rl) * (1 - smoothstep(0.85, 1, rl))) : 0;
    this.cant = damp(this.cant ?? 0, cant, 10, dt);
    // at a run, at low ready: carried across the chest, muzzle low and to the left
    const carry = clamp((this.moveSpeed - 2.2) / 2, 0, 1) * (1 - this.ready);
    this.carry = damp(this.carry ?? 0, carry, 6, dt);
    const pitch = this.aimPitch + this.recoil * 0.05 - (1 - this.ready) * 0.5 + this.cant * 0.2;
    const hold = this.hold;
    const cg = this.cineGun;
    if (cg) {
      // a cutscene pose places the gun itself (character space: pos, yaw / pitch / roll off its facing)
      _gq.copy(this.root.quaternion).multiply(_qa.setFromEuler(_eu.set(-cg.pitch, Math.PI + cg.yaw, cg.roll ?? 0)));
      _G.copy(cg.pos).applyQuaternion(this.root.quaternion).add(this.root.position);
    } else {
      _gq.copy(this.root.quaternion).multiply(_qa.setFromEuler(_eu.set(-pitch, Math.PI + this.carry * 0.35, this.carry * 0.3 + this.cant * 0.5)));
      // low ready: stock pocket just inside the right shoulder joint
      b.upperArmR.getWorldPosition(_low);
      _low.add(_T.set(-0.06, 0.04, -hold.gripFwd).applyQuaternion(_gq));
      // aimed: gun origin = eye - (the gun's sight eye point)
      b.head.getWorldPosition(_eye);
      _eye.add(_T.copy(EYE_FROM_HEAD).applyQuaternion(_gq)).sub(_T.copy(hold.eye).applyQuaternion(_gq));
      const k = this.ready * this.ready * (3 - 2 * this.ready);
      _G.lerpVectors(_low, _eye, k).add(_T.set(0, 0, this.recoil * 0.035).applyQuaternion(_gq));
    }
    this.gunHolder.position.copy(this.mesh.worldToLocal(_T.copy(_G)));
    this.gunHolder.quaternion.copy(this.mesh.getWorldQuaternion(_qb).invert().multiply(_gq));
    if (cg?.free) return; // slung: the hands are busy elsewhere (the cutscene IKs them)
    const h = this.hands;
    // right hand on the pistol grip, elbow out and down
    _T.copy(hold.wristR).applyQuaternion(_gq).add(_G);
    _pole.set(-0.7, -1, -0.3).applyQuaternion(this.root.quaternion);
    reach(b.upperArmR, b.foreArmR, b.handR, _T, _pole, _aw.copy(ALONG_R).applyQuaternion(_gq), _pw.copy(PALM_R).applyQuaternion(_gq), h.R);
    // left hand under the handguard (on the pump / LMG shroud: wherever the gun's leftHand marker says)
    _T.copy(hold.wristL).applyQuaternion(_gq).add(_G);
    if (rl >= 0) this._reloadHand(rl, shell, _T);
    _pole.set(0.3, -1, -0.1).applyQuaternion(this.root.quaternion);
    reach(b.upperArmL, b.foreArmL, b.handL, _T, _pole, _aw.copy(ALONG_L).applyQuaternion(_gq), _pw.copy(PALM_L).applyQuaternion(_gq), h.L);
  }

  /**
   * The support hand while reloading (rl 0..1 of the reload, or of the current shell), moving the wrist target
   * `out` (world; on the handguard coming in): a mag reload goes handguard → magwell (the old mag out) → the
   * belt pouch on the left hip → magwell (the new one in) → handguard; a shell reload shuttles pouch ↔ port.
   */
  _reloadHand(rl, shell, out) {
    const guard = _rg.copy(out);
    const well = _rw.copy(this.hold.wristR).add(MAGWELL).applyQuaternion(_gq).add(_G);
    const pouch = this.mesh.localToWorld(_rp.copy(POUCH));
    if (shell) {
      out.copy(pouch).lerp(well, 0.5 - 0.5 * Math.cos(rl * Math.PI * 2));
      return;
    }
    const ss = smoothstep;
    if (rl < 0.2) out.copy(guard).lerp(well, ss(0, 0.2, rl));
    else if (rl < 0.45) out.copy(well).lerp(pouch, ss(0.2, 0.45, rl));
    else if (rl < 0.7) out.copy(pouch).lerp(well, ss(0.45, 0.7, rl));
    else if (rl < 0.85) out.copy(well);
    else out.copy(well).lerp(guard, ss(0.85, 1, rl));
  }

  /** knees buckle and the head drops (0.25 s), then the body topples and settles with a small bounce */
  _animateDead(dt) {
    this.deadT += dt;
    const buckle = smoothstep(0, 0.25, this.deadT);
    const k = clamp((this.deadT - 0.15) / 0.65, 0, 1);
    const e = k * k;
    const bounce = k >= 1 ? Math.exp(-(this.deadT - 0.8) * 9) * Math.sin((this.deadT - 0.8) * 22) * 0.05 : 0;
    this.root.rotation.x = this.fallDir * ((Math.PI / 2) * e - bounce);
    const a = this.root.rotation.x;
    this.mesh.position.set(0, 0.12 * Math.cos(a) * e, -0.12 * Math.sin(a) * e);
    const b = this.bones;
    // the knees give first (straightening again as it lands), the torso curls, the head lolls
    const kn = buckle * (1 - 0.6 * e);
    b.hips.position.y = 0.98 - 0.2 * kn;
    b.thighL.rotation.x = lerp(b.thighL.rotation.x, -0.7 * kn, 0.25);
    b.thighR.rotation.x = lerp(b.thighR.rotation.x, -0.5 * kn, 0.25);
    b.shinL.rotation.x = lerp(b.shinL.rotation.x, 1.2 * kn, 0.25);
    b.shinR.rotation.x = lerp(b.shinR.rotation.x, 0.9 * kn, 0.25);
    b.spine.rotation.x = lerp(b.spine.rotation.x, 0.25 * buckle * this.fallDir, 0.2);
    b.neck.rotation.x = lerp(b.neck.rotation.x, 0.45 * buckle, 0.2);
    b.head.rotation.z = lerp(b.head.rotation.z, 0.35 * buckle, 0.15);
    b.upperArmL.rotation.x = lerp(b.upperArmL.rotation.x, -2.5, 0.08);
    b.upperArmR.rotation.x = lerp(b.upperArmR.rotation.x, -0.5, 0.08);
    if (this.rig) this.rig.sync();
    if (this.jiggle) this.jiggle.update(dt);
  }

  hide() {
    this.alive = false;
    this.root.visible = false;
  }

  /**
   * Cutscene control (game/cutscenes.js): out of the fight, posed by the script instead of update(). The
   * script sets pos (root) and yaw; c = {
   *   mode: 'stand' | 'walk' | 'crouch' | 'sit' | 'rope',
   *   speed:  walk speed (m/s, along yaw), ready: 0 low ready .. 1 aimed,
   *   look:   world point to turn the head to (optional),
   *   seatH:  sit: hips above the root (the root on the floor under the seat),
   *   rope:   rope: { x, z } the rope line (world), slide 0..1 how fast it slides (hands looser, legs tighter)
   * }
   */
  cine(dt, c) {
    const b = this.bones;
    this.alive = true;
    this.target = null;
    this.reloadT = 0;
    this.recoil = 0;
    this.cant = 0;
    this.carry = 0;
    this.root.rotation.set(c.tilt ? c.tilt[0] : 0, this.yaw, c.tilt ? c.tilt[1] : 0); // tilt: riding in a banking helicopter
    this.mesh.position.set(0, 0, 0);
    if (this.gunHolder.parent !== this.mesh) this.mesh.add(this.gunHolder);
    this.cineGun = null;
    this.cineReady = c.ready ?? 0;
    const mode = c.mode;
    if (mode === 'stand' || mode === 'walk' || mode === 'crouch') {
      const sp = mode === 'walk' ? c.speed ?? 1.4 : 0;
      this.moveSpeed = dt > 0 ? damp(this.moveSpeed, sp, 8, dt) : sp;
      this.body.vel.set(Math.sin(this.yaw) * sp, 0, Math.cos(this.yaw) * sp);
      this.crouch = dt > 0 ? damp(this.crouch, mode === 'crouch' ? 1 : 0, 6, dt) : mode === 'crouch' ? 1 : 0;
      this.aimPitch = c.pitch ?? 0;
      // sling: the rifle on the back, the hands free (at the sides, or the right one on c.touch)
      if (c.sling) this.cineGun = { pos: (this._cgPos ??= new THREE.Vector3()).set(0.05, 1.28, -0.24), yaw: Math.PI - 0.1, pitch: 1.1, roll: 0.5, free: true };
      this._animate(dt);
      if (c.sling) {
        const h = this.hands, rq = this.root.quaternion, sw = Math.sin(this.phase) * 0.12 * clamp(this.moveSpeed / 1.5, 0, 1);
        if (c.touch) _T.copy(c.touch);
        else this.root.localToWorld(_T.set(-0.24, 0.86, 0.06 - sw));
        _pole.set(-0.6, -0.4, -1).applyQuaternion(rq);
        _aw.copy(_T).sub(b.upperArmR.getWorldPosition(_E)).normalize();
        if (!c.touch) _aw.set(0, -1, 0.1).applyQuaternion(rq);
        reach(b.upperArmR, b.foreArmR, b.handR, _T, _pole, _aw, _pw.set(-1, 0, 0).applyQuaternion(rq), h.R);
        this.root.localToWorld(_T.set(0.24, 0.86, 0.06 + sw));
        _pole.set(0.6, -0.4, -1).applyQuaternion(rq);
        reach(b.upperArmL, b.foreArmL, b.handL, _T, _pole, _aw.set(0, -1, 0.1).applyQuaternion(rq), _pw.set(1, 0, 0).applyQuaternion(rq), h.L);
      }
    } else {
      this.moveSpeed = 0;
      this.body.vel.set(0, 0, 0);
      this.crouch = 0;
      const t = this.game.time;
      const breath = Math.sin(t * 1.45 + this.index * 2.1);
      if (mode === 'sit') {
        // on the bench: thighs forward, shins down, a little slumped, the rifle across the lap
        const hy = c.seatH ?? 0.52;
        b.hips.position.y = hy;
        b.hips.rotation.set(-0.05, 0, 0);
        b.thighL.rotation.set(-1.42, 0.05, 0.14);
        b.thighR.rotation.set(-1.42, -0.05, -0.14);
        b.shinL.rotation.set(1.5, 0, 0);
        b.shinR.rotation.set(1.38, 0, 0);
        b.footL.rotation.set(-0.05, 0, -0.1);
        b.footR.rotation.set(0.05, 0, 0.1);
        b.spine.rotation.set(0.16 + breath * 0.012, 0, 0);
        b.chest.rotation.set(0.06 + breath * 0.015, 0, 0);
        b.neck.rotation.set(0.12, 0, 0);
        b.head.rotation.set(0.08, 0, 0);
        this.cineGun = { pos: (this._cgPos ??= new THREE.Vector3()).set(0.08, hy + 0.2, 0.34), yaw: 1.05, pitch: -0.18, roll: 0.25 };
      } else if (mode === 'rope') {
        // fast-roping: both hands high on the rope, knees up a little, feet crossed, looking down
        const sl = c.slide ?? 1;
        b.hips.position.y = 0.95;
        b.hips.rotation.set(0.08, 0, 0);
        b.thighL.rotation.set(-0.35 - 0.15 * sl, 0, 0.02);
        b.thighR.rotation.set(-0.25 - 0.1 * sl, 0, -0.08);
        b.shinL.rotation.set(0.55 + 0.2 * sl, 0, 0);
        b.shinR.rotation.set(0.4 + 0.2 * sl, 0, 0);
        b.footL.rotation.set(0.35, 0, 0);
        b.footR.rotation.set(0.35, 0, 0);
        b.spine.rotation.set(-0.06, 0, 0);
        b.chest.rotation.set(0.02, 0, 0);
        b.neck.rotation.set(0.25, 0, 0);
        b.head.rotation.set(0.25, 0, 0);
        // the rifle slung across the back, muzzle down to the left
        this.cineGun = { pos: (this._cgPos ??= new THREE.Vector3()).set(0.05, 1.28, -0.24), yaw: Math.PI - 0.1, pitch: 1.1, roll: 0.5, free: true };
      }
      this._holdRifle(dt);
      if (mode === 'rope' && c.rope) {
        const h = this.hands, rq = this.root.quaternion, p = this.root.position;
        const up = 0.02 * (1 - (c.slide ?? 1));
        _T.set(c.rope.x, p.y + 1.82 + up, c.rope.z);
        _pole.set(-1, -0.6, -0.2).applyQuaternion(rq);
        reach(b.upperArmR, b.foreArmR, b.handR, _T, _pole, _aw.set(1, 0.15, 0).applyQuaternion(rq).normalize(), _pw.set(0, 0, 1).applyQuaternion(rq), h.R);
        _T.set(c.rope.x, p.y + 1.5 - up, c.rope.z);
        _pole.set(1, -0.6, -0.2).applyQuaternion(rq);
        reach(b.upperArmL, b.foreArmL, b.handL, _T, _pole, _aw.set(-1, 0.15, 0).applyQuaternion(rq).normalize(), _pw.set(0, 0, 1).applyQuaternion(rq), h.L);
      }
    }
    // turn the head (and a little of the chest) toward a look point
    if (c.look) {
      this.root.updateMatrixWorld(true);
      b.head.getWorldPosition(_E);
      const a = wrapAngle(Math.atan2(c.look.x - _E.x, c.look.z - _E.z) - this.yaw);
      const yaw = clamp(a, -1.2, 1.2);
      const pitch = clamp(Math.atan2(c.look.y - _E.y, Math.hypot(c.look.x - _E.x, c.look.z - _E.z)), -0.7, 0.6);
      b.chest.rotation.y += yaw * 0.2;
      b.neck.rotation.y += yaw * 0.35;
      b.head.rotation.y += yaw * 0.45;
      b.neck.rotation.x -= pitch * 0.4;
      b.head.rotation.x -= pitch * 0.5;
    }
    if (this.rig) this.rig.sync();
    if (this.jiggle && dt > 0) this.jiggle.update(dt);
    this.root.updateMatrixWorld(true);
  }

  /** back to the fight after a cutscene */
  endCine() {
    this.cineGun = null;
    this.cineReady = undefined;
    this.moveSpeed = 0;
    this.body.vel.set(0, 0, 0);
    this.post = null;
    this.postT = 0;
    this.field = null;
    this.portalTo = null;
    this.lastPos.copy(this.pos);
  }

  /**
   * Standing pose for the menu portrait (actors/portraits.js): at the origin facing +Z, gun at a relaxed
   * low ready. Only valid while the bot is out of play (it leaves the fight state untouched otherwise).
   */
  posePortrait(ready = 0.55) {
    this.target = null;
    this.reloadT = 0;
    this.moveSpeed = 0;
    this.phase = 0;
    this.crouch = 0;
    this.recoil = 0;
    this.aimPitch = 0;
    this.ready = ready;
    this.yaw = 0;
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.mesh.position.set(0, 0, 0);
    if (this.gunHolder.parent !== this.mesh) this.mesh.add(this.gunHolder);
    this.root.updateMatrixWorld(true);
    this._animate(0);
    this.root.updateMatrixWorld(true);
  }
}
