// The Stalker: a gaunt mutant (UniRig GLB, ~1.95 m) that haunts the fireteam from round 3 (round 4 on easy)
// instead of fighting in the wave. It isn't part of a wave (the round's end, the enemy count and the radar
// ignore it) and it only ever goes for the player. StalkerDirector (game.stalker) decides when it shows up and
// plans every appearance on the nav grid: it knows each way into and through the farmhouse and the barn (only
// the hayloft ladder is out of its reach). The Stalker plays the appearance out:
//   watch   it stands where you'll see it once you turn round (in your line of sight, outside your view) and
//           stares. Once you've looked at it (or come close) it backs out of sight, or bolts
//   dash    it sprints across your view (9-11 m/s): out of cover, through a spot you can see, into cover again
//   attack  now and then (never before two scares, never two within 70 s): it bursts out of cover in front of
//           you, charges, lunges at your face and either holds you for a moment (no moving; you can shoot)
//           and claws you, or slashes you in passing. Then it runs. It always comes at you from the front and
//           circles round if you turn away. It holds you at most once an attack: no stun lock
//   flee    shot at any other time it flinches, hisses and runs, out of your sight
// Only while it attacks (and for a moment after) can it be hurt, and then it dies quickly. It appears and
// vanishes only where you can't see it: no line of sight from the camera to its head or middle, or outside
// your view. Killed, it stays away for the rest of that round and the next.
// Debug: game.stalker.force('watch' | 'dash' | 'attack') brings it now (in a fight round).
import * as THREE from 'three';
import { Zombie, ZOMBIE_CLASSES } from './zombie.js';
import { clamp, damp, dampAngle, lerp, rand, smoothstep, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { inHouse } from '../nav/horde.js';
import { inBarn } from '../world/ranchLayout.js';

export const STALKER = {
  firstRound: { easy: 4, hard: 3, extreme: 3 },
  chance: { base: 0.6, per: 0.08, max: 0.9 }, // that a round has it in it (it comes by its second round anyway)
  firstAt: [15, 35], // s into the round: its first appearance
  gap: [35, 75], // s between appearances (counted while it's away)
  retry: [3, 6], // s: nowhere to put it right now, try again
  skip: 0.2, // an appearance slot passes with nothing happening
  perRound: 4,
  // an attack: after `scares` watch / dash appearances in a row, then with chance[n] (n = scares past that)
  attack: { scares: 2, chance: [0.45, 0.75, 1], minGap: 70, grab: 0.6, spawn: [7, 16] },
  speed: { dash: [9, 11], charge: 9.4, flee: 9.5, slip: 1.15 },
  watch: { dist: [7, 24], look: [0.45, 1.0], near: 6.5, wait: 30, bolt: 0.45 },
  dash: { cross: [4, 15], leg: [4, 13] }, // m: the spot it crosses, each leg's run (path)
  lunge: { range: 2.7, speed: 12.5, t: 0.3, tries: 3 },
  grab: { t: 1.0, hitAt: 0.55, dmg: 26, stand: 0.72, shove: 4.2 }, // x difficulty damage
  strike: { t: 0.42, hitAt: 0.5, dmg: 22 },
  exposedAfter: 1.3, // s it can still be hurt once the attack is over
  hide: 0.15, // s out of sight before it vanishes
  wander: 12, // s: a run that takes longer ends as soon as it is out of view
  giveUp: 12, // s: an attack that hasn't landed by then turns into a retreat
};

const HIP = 0.98; // proxy hip height the pose code writes around (gltfCharacter.js HIP_Y)
// how far (nav cells: 0.5 m each, plus clearance costs) its distance fields spread: plans around the player, the
// charge, a watcher's way out, a dash's legs, an escape
const REACH = { plan: 80, chase: 140, exit: 30, leg: 45, escape: 70 };
const ATTACK = new Set(['stalk', 'lunge', 'grab', 'strike', 'recover']);
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _w = { x: 0, z: 0 };
const _o = { x: 0, z: 0 };
const _av = { x: 0, y: 0, z: 0 };
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };
const _sopts = { cost: null, need: 1 };
const _c = { x: 0, z: 0, level: 0, y: 0 };
const _src = [{ level: 1, x: 0, z: 0 }];
const _vw = { ex: 0, ey: 0, ez: 0, fx: 0, fz: 1, half: 0.8 };

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class Stalker extends Zombie {
  spawn(pos, round, hpMult, speedMult) {
    // stalker state first: Zombie.spawn poses the body once
    this.sstate = 'idle';
    this.sT = 0;
    this.huntT = 0; // s into the current attack
    this.dir = null; // the StalkerDirector running this appearance
    this.plan = null;
    this.exposed = false; // can be hurt (attacking, and a moment after)
    this.exposedT = 0;
    this.field = null; // the distance field it runs down (Float32Array, see StalkerDirector)
    this.fieldT = 0;
    this.leg = 0;
    this.fd = Infinity; // that field's value where it stands (cells)
    this.lost = false;
    this.lookAcc = 1;
    this.seen = false; // in view, in line of sight of the camera
    this.los = false; // in line of sight (in view or not)
    this.everSeen = false;
    this.hiddenT = 0;
    this.centerT = 0; // s looked at (near the middle of the screen)
    this.stung = false;
    this.tries = 0;
    this.grabbed = null;
    this.hitDone = false;
    this.voiceT = rand(0.5, 2);
    this.hissAt = -9;
    this.nearest = Infinity;
    this.rushed = false;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.fwd = 0;
    this.speed = STALKER.speed.flee;
    this.gx = 0;
    this.gz = 1;
    super.spawn(pos, round, hpMult, speedMult);
    this.alerted = true; // noise never wakes it (game.alertNoise): the director runs it
    this.sizeVar = 1;
    this.root.scale.setScalar(this.scale);
    this.speedMult = 1;
    this.target = null;
  }

  /** start an appearance planned by the director: { kind: 'watch' | 'dash' | 'attack', ... } */
  begin(plan, dir) {
    this.dir = dir;
    this.plan = plan;
    const P = this.game.player.pos;
    this.yaw = Math.atan2(P.x - this.pos.x, P.z - this.pos.z);
    if (plan.kind === 'watch') this._set('watch');
    else if (plan.kind === 'dash') {
      this._set('dash');
      this.field = plan.fC;
      this.leg = 0;
      this.speed = rand(STALKER.speed.dash[0], STALKER.speed.dash[1]);
      this.yaw = Math.atan2(plan.C[0] - this.pos.x, plan.C[1] - this.pos.z);
    } else this._startAttack();
    this.root.rotation.y = this.yaw;
    this.animate(0);
  }

  /** the round is over / the player is down: off it goes (at once, if nobody sees it) */
  leave() {
    if (!this.active || !this.alive || this.sstate === 'flee') return;
    if (!this.seen) this._vanish();
    else this._flee();
  }

  /** its face (world): the held player's view is dragged onto it (player.js) */
  faceAt(out) {
    this.bones.head.getWorldPosition(out);
    out.y += 0.06 * this.scale;
    return out;
  }

  _head(out) {
    return this.bones.head.getWorldPosition(out);
  }

  _set(state) {
    this.sstate = state;
    this.sT = 0;
    this.wpT = 0;
    this.portal = null;
    this.fd = Infinity;
    this.lost = false;
  }

  // ---------------------------------------------------------------- overrides
  _alert() {
    this.alerted = true;
  }

  damage(amount, part, dir, source = null, opts = {}) {
    if (!this.alive) return { killed: false, dealt: 0 };
    if (!this.exposed) {
      // out of reach: a flinch, a hiss, and it's off
      this._spook(dir);
      return { killed: false, dealt: 0, immune: true };
    }
    return super.damage(amount, part, dir, source, opts);
  }

  _spook(dir) {
    if (dir) {
      const localYaw = Math.atan2(dir.x, dir.z) - this.yaw;
      this.flinchVel.x += Math.cos(localYaw) * 3;
      this.flinchVel.z += -Math.sin(localYaw) * 2;
      this.flinchVel.y += 2;
    }
    if (this.game.time - this.hissAt > 0.6) {
      this.hissAt = this.game.time;
      this.game.audio.play('stalker_hiss', { position: this._head(_v), volume: 1 });
    }
    if (this.sstate === 'watch' || this.sstate === 'slip') this._flee();
  }

  _die(dir, source, opts = {}) {
    this._release();
    this.sstate = 'dead';
    super._die(dir, source, opts); // a ragdoll (ragdoll.js) starts from the pose as it is
    if (!this.ragdoll) {
      // the canned fall pivots an upright body
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this.mesh.position.set(0, 0, 0);
    }
  }

  deactivate() {
    this._release();
    super.deactivate();
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    if (!this.active) return;
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }
    this.level = levelOf(this.pos.y + 0.3);
    this.sT += dt;
    this._sense(dt);
    if (ATTACK.has(this.sstate)) this.huntT += dt;
    else if (this.exposed && (this.exposedT -= dt) <= 0) this.exposed = false;
    if (!this.game.player.alive && this.sstate !== 'flee') this._flee();
    switch (this.sstate) {
      case 'watch':
        this._watch(dt, ctx);
        break;
      case 'slip':
        this._slip(dt, ctx);
        break;
      case 'dash':
        this._dash(dt, ctx);
        break;
      case 'stalk':
        this._stalk(dt, ctx);
        break;
      case 'lunge':
        this._lunge(dt, ctx);
        break;
      case 'grab':
        this._grab(dt);
        break;
      case 'strike':
        this._strike(dt, ctx);
        break;
      case 'recover':
        this._recover(dt, ctx);
        break;
      default:
        this._fleeing(dt, ctx);
    }
    if (this.active && this.pos.y < -20) this._vanish(); // fell out of the world (shouldn't happen)
  }

  /** throttled: can the player see it (in view + line of sight to its head, middle or knees)? */
  _sense(dt) {
    this.lookAcc += dt;
    if (this.lookAcc < 0.08) return;
    const step = Math.min(this.lookAcc, 0.1); // (the first look, right after it appears, counts as one)
    this.lookAcc = 0;
    const g = this.game, cam = g.camera, pos = this.pos, e = cam.position;
    let seen = false, center = false, los = false;
    if (g.player.alive) {
      for (const h of [1.75, 1.2, 0.5]) {
        const y = pos.y + h * this.scale;
        if (!g.world.lineOfSight(e.x, e.y, e.z, pos.x, y, pos.z)) continue;
        los = true;
        _v.set(pos.x, y, pos.z).project(cam);
        if (_v.z < 1 && Math.abs(_v.x) < 1.02 && Math.abs(_v.y) < 1.02) {
          seen = true;
          if (Math.abs(_v.x) < 0.55 && Math.abs(_v.y) < 0.75) center = true;
        }
        if (center) break;
      }
    }
    this.los = los;
    this.seen = seen;
    if (seen) {
      this.hiddenT = 0;
      this.everSeen = true;
    } else this.hiddenT += step;
    this.centerT = center ? this.centerT + step : Math.max(0, this.centerT - step * 0.5);
  }

  // ---------------------------------------------------------------- scares
  _watch(dt, ctx) {
    const g = this.game, P = g.player.pos, W = STALKER.watch;
    const dist = Math.hypot(P.x - this.pos.x, P.z - this.pos.z);
    this._stand(dt, ctx, Math.atan2(P.x - this.pos.x, P.z - this.pos.z), 2.5);
    this._voice(dt, dist);
    const noticed = this.centerT >= (this.plan.look ??= rand(W.look[0], W.look[1]));
    if (noticed || (dist < W.near && this.los)) {
      if (noticed && !this.stung) {
        this.stung = true;
        g.audio.play('stalker_sting', { volume: 0.45 });
      }
      if (this.plan.canAttack) this._startAttack();
      else if (dist < W.near || Math.random() < W.bolt) this._flee();
      else this._slipAway();
      return;
    }
    if (this.sT > W.wait && this.hiddenT > 0.6) this._vanish();
    else if (this.sT > W.wait + 12) this._slipAway();
  }

  /** watching: rasping breaths, now and then the throat clicks */
  _voice(dt, dist) {
    if ((this.voiceT -= dt) > 0) return;
    this.voiceT = rand(2.6, 4.5);
    if (dist < 22) this.game.audio.play(Math.random() < 0.3 ? 'stalker_click' : 'stalker_breath', { position: this._head(_v), volume: 0.6 });
  }

  _slipAway() {
    if (!this.plan.exit) {
      this._flee();
      return;
    }
    this._set('slip');
    this.field = this.plan.exit;
  }

  /** backing out of sight, its eyes on you */
  _slip(dt, ctx) {
    const P = this.game.player.pos;
    if (this.hiddenT >= STALKER.hide) return this._vanish();
    if (Math.hypot(P.x - this.pos.x, P.z - this.pos.z) < STALKER.watch.near * 0.8 && this.los) return this._flee();
    const w = this._follow(dt, this.field);
    if (this.lost || this.fd < 1.2 || this.sT > 9) return this._flee();
    this._drive(dt, ctx, w.x, w.z, STALKER.speed.slip, Math.atan2(P.x - this.pos.x, P.z - this.pos.z), 3);
  }

  /** the dash: to the spot in view (leg 0), then on into cover (leg 1) and gone */
  _dash(dt, ctx) {
    const g = this.game, P = g.player.pos, pos = this.pos;
    const w = this._follow(dt, this.field);
    if (this.leg === 0) {
      if (this.lost) return this._flee();
      if (this.fd < 2) {
        this.leg = 1;
        this.field = this.plan.fB;
        this.wpT = 0;
        this.portal = null;
        this.fd = Infinity;
      } else if (!this.everSeen && this.sT > 7 && this.hiddenT > 1) return this._vanish(); // held up somewhere, never shown
    } else {
      if (this.everSeen && this.hiddenT >= STALKER.hide) return this._vanish();
      if (this.fd < 1.5 || this.lost) return this.hiddenT >= STALKER.hide ? this._vanish() : this._flee();
    }
    if (this.sT > STALKER.wander + 6) return this._flee();
    // first sight: now and then a sting; the closest pass: a rush of air
    if (this.seen && !this.stung) {
      this.stung = true;
      if (Math.random() < 0.5) g.audio.play('stalker_sting', { volume: 0.35 });
    }
    const dP = Math.hypot(P.x - pos.x, P.z - pos.z);
    if (dP < this.nearest) this.nearest = dP;
    else if (!this.rushed && this.nearest < 9 && dP > this.nearest + 0.3) {
      this.rushed = true;
      g.audio.play('stalker_rush', { position: pos, volume: 1 });
      if (this.nearest < 2.2) g.shake.add(0.3);
    }
    this._drive(dt, ctx, w.x, w.z, this.speed);
  }

  // ---------------------------------------------------------------- attack
  _startAttack() {
    this._set('stalk');
    this.exposed = true;
    this.huntT = 0;
    this.tries = 0;
    this.fieldT = 0;
    this.stung = false;
    this.speed = STALKER.speed.charge;
    this.dir?.onAttack();
    this.game.audio.play('stalker_click', { position: this._head(_v), volume: 0.9 });
  }

  /** the charge: at the player (by the nav grid, or straight when it can), always ending up in front of them */
  _stalk(dt, ctx) {
    const g = this.game, P = g.player, nav = g.nav, pos = this.pos, pp = P.pos;
    if (this.huntT > STALKER.giveUp) return this._flee(true);
    if (this.seen && !this.stung) {
      // bursting out of cover
      this.stung = true;
      g.audio.play('stalker_sting', { volume: 0.8 });
      g.audio.play('stalker_scream', { position: this._head(_v), volume: 1 });
    }
    if ((this.fieldT -= dt) <= 0) {
      this.fieldT = 0.3;
      this.field = this.dir?.playerField(REACH.chase) ?? null;
    }
    const dx = pp.x - pos.x, dz = pp.z - pos.z, dist = Math.hypot(dx, dz);
    const same = Math.abs(pp.y - pos.y) < 1.2 && levelOf(pp.y + 0.3) === this.level;
    // where the player looks, and where it is in that (1: straight ahead of them)
    const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw);
    const front = dist > 1e-3 ? (-dx * fx - dz * fz) / dist : 1;
    if (same && dist < STALKER.lunge.range && this.los && (front > 0.2 || this.huntT > 5)) return this._lungeAt(P);
    let wx, wz;
    if (same && dist < 16 && this.field && nav.lineClear(this.level, pos.x, pos.z, pp.x, pp.z, 1, this.field, nav.fieldCost)) {
      this.portal = null;
      let tx = pp.x, tz = pp.z;
      // behind or beside them: round to a spot ahead of where they look
      if (dist < 6 && front < 0.35) {
        const ax = pp.x + fx * 2.4, az = pp.z + fz * 2.4;
        if (nav.lineClear(this.level, pos.x, pos.z, ax, az, 1, this.field, nav.fieldCost)) (tx = ax), (tz = az);
      }
      wx = tx - pos.x;
      wz = tz - pos.z;
    } else {
      const w = this._follow(dt, this.field);
      wx = this.lost ? dx : w.x;
      wz = this.lost ? dz : w.z;
    }
    let speed = this.speed;
    if (this.stagger > 0) {
      this.stagger -= dt; // a hard hit (a headshot) checks it for a moment
      speed *= 0.35;
    }
    this._drive(dt, ctx, wx, wz, speed);
  }

  _lungeAt(P) {
    this._set('lunge');
    const pos = this.pos, tv = P.body.vel;
    const dx = P.pos.x + tv.x * 0.12 - pos.x, dz = P.pos.z + tv.z * 0.12 - pos.z;
    const d = Math.hypot(dx, dz) || 1;
    this.body.vel.set((dx / d) * STALKER.lunge.speed, 2.2, (dz / d) * STALKER.lunge.speed);
    this.body.onGround = false;
    this.yaw = Math.atan2(dx, dz);
    this.root.rotation.y = this.yaw;
    this.game.audio.play('stalker_scream', { position: this._head(_v), volume: 1, pitch: rand(1.05, 1.15) });
  }

  _lunge(dt, ctx) {
    const P = this.game.player, pos = this.pos;
    this._move(dt, ctx);
    const dx = P.pos.x - pos.x, dz = P.pos.z - pos.z;
    if (P.alive && Math.hypot(dx, dz) < 1.05 + (P.radius ?? 0.3) * 0.5 && Math.abs(P.pos.y - pos.y) < 1.1) {
      this.body.vel.set(0, Math.min(0, this.body.vel.y), 0);
      if (Math.random() < STALKER.attack.grab && !P.climbing && !P.heldBy) this._grabHold(P);
      else {
        this._set('strike');
        this.hitDone = false;
        this.game.audio.play('zombie_attack', { position: pos, volume: 0.9, pitch: 0.75 });
      }
    } else if (this.sT > STALKER.lunge.t && this.body.onGround) this._set('recover');
    else if (this.body.blocked && this.sT > 0.05) {
      this.body.vel.x *= 0.2;
      this.body.vel.z *= 0.2;
    }
    this.animate(dt);
  }

  _recover(dt, ctx) {
    const P = this.game.player.pos;
    this._stand(dt, ctx, Math.atan2(P.x - this.pos.x, P.z - this.pos.z), 10);
    if (this.sT < 0.4) return;
    if (++this.tries >= STALKER.lunge.tries) this._flee(true);
    else this._set('stalk');
  }

  _grabHold(P) {
    this._set('grab');
    this.hitDone = false;
    this.grabbed = P;
    P.heldBy = this;
    const dx = this.pos.x - P.pos.x, dz = this.pos.z - P.pos.z, d = Math.hypot(dx, dz) || 1;
    this.gx = dx / d;
    this.gz = dz / d;
    P.body.vel.set(0, Math.min(0, P.body.vel.y), 0);
    const g = this.game;
    g.audio.play('stalker_grab', { position: P.pos, volume: 1 });
    g.audio.play('stalker_scream', { position: this._head(_v), volume: 1, pitch: 0.95 });
    g.shake.add(0.7);
  }

  /** holding the player at arm's length right in front of their face, then the claws, then the shove */
  _grab(dt) {
    const g = this.game, P = this.grabbed, G = STALKER.grab;
    if (!P || !P.alive || P.heldBy !== this) return this._flee(true);
    const pos = this.pos;
    pos.x = damp(pos.x, P.pos.x + this.gx * G.stand, 18, dt);
    pos.z = damp(pos.z, P.pos.z + this.gz * G.stand, 18, dt);
    pos.y = damp(pos.y, P.pos.y, 18, dt);
    this.body.vel.set(0, 0, 0);
    this.body.onGround = true;
    this.moveSpeed = 0;
    this.yaw = dampAngle(this.yaw, Math.atan2(-this.gx, -this.gz), 20, dt);
    this.root.rotation.y = this.yaw;
    g.shake.trauma = Math.max(g.shake.trauma, 0.35);
    if (!this.hitDone && this.sT >= G.hitAt) {
      this.hitDone = true;
      this._claw(P, G.dmg);
    }
    if (this.sT >= G.t) {
      // lets go: the player stumbles back, it springs away
      this._release();
      P.knockback(-this.gx * G.shove, 1.6, -this.gz * G.shove);
      this.body.vel.set(this.gx * 4.5, 2.4, this.gz * 4.5);
      this.body.onGround = false;
      this._flee(true);
      return;
    }
    this.animate(dt);
  }

  _strike(dt, ctx) {
    const P = this.game.player, S = STALKER.strike;
    this._stand(dt, ctx, Math.atan2(P.pos.x - this.pos.x, P.pos.z - this.pos.z), 14);
    if (!this.hitDone && this.sT >= S.t * S.hitAt) {
      this.hitDone = true;
      if (P.alive && Math.hypot(P.pos.x - this.pos.x, P.pos.z - this.pos.z) < this.type.reach + 0.8) this._claw(P, S.dmg);
    }
    if (this.sT >= S.t) this._flee(true);
  }

  _claw(P, dmg) {
    const g = this.game;
    P.takeDamage(dmg * (g.difficultyDamage ?? 1), this.pos, this);
    const dx = P.pos.x - this.pos.x, dz = P.pos.z - this.pos.z, d = Math.hypot(dx, dz) || 1;
    _v.set(P.pos.x - (dx / d) * 0.25, P.pos.y + 1.3, P.pos.z - (dz / d) * 0.25);
    g.fx.bloodHit(_v, _d.set(dx / d, 0.3, dz / d).normalize(), { amount: 0.7, decals: false });
    g.audio.play('impact_flesh', { position: _v, volume: 1 });
    g.shake.add(0.5);
  }

  _release() {
    const P = this.grabbed;
    this.grabbed = null;
    if (P && P.heldBy === this) P.heldBy = null;
  }

  // ---------------------------------------------------------------- retreat
  /** run for cover (exposed: it can still be hurt for a moment, after an attack) */
  _flee(exposed = false) {
    this._release();
    this._set('flee');
    if (exposed) {
      this.exposed = true;
      this.exposedT = STALKER.exposedAfter;
    } else this.exposed = false;
    this.speed = STALKER.speed.flee;
    this.field = this.dir?.planEscape(this) ?? null;
    this.fleeT = 0.8;
    this.fleeStuck = 0;
  }

  _fleeing(dt, ctx) {
    const P = this.game.player.pos, pos = this.pos;
    if ((this.sT > 0.25 && this.hiddenT >= STALKER.hide) || !this.game.player.alive) return this._vanish();
    if (this.sT > STALKER.wander && !this.seen) return this._vanish();
    // there, or stuck, and still in plain sight: another way out
    this.fleeStuck = this.moveSpeed < 0.8 && this.sT > 0.4 ? this.fleeStuck + dt : 0;
    if ((this.fleeT -= dt) <= 0 && (this.fleeStuck > 0.3 || !this.field || this.lost || this.fd <= 1.2)) {
      this.fleeT = 0.8;
      this.field = this.dir?.planEscape(this) ?? null;
      this.wpT = 0;
      this.portal = null;
      this.fd = Infinity;
      this.lost = false;
    }
    // cornered in plain view with nowhere to go (shouldn't happen): gone the moment you look off it
    if (this.sT > 5 && (this.centerT === 0 || this.sT > 8)) return this._vanish();
    let wx = pos.x - P.x, wz = pos.z - P.z; // no way out found: straight away from the player
    if (this.field && !this.lost && this.fd > 1.2) {
      const w = this._follow(dt, this.field);
      if (!this.lost) (wx = w.x), (wz = w.z);
    }
    this._drive(dt, ctx, wx, wz, this.speed);
  }

  _vanish() {
    this._release();
    this.sstate = 'gone';
    this.alive = false;
    this.removed = true;
    this.deactivate();
  }

  // ---------------------------------------------------------------- movement
  /** the waypoint down distance field `arr` (string-pulled by the nav grid; stairs walked straight) */
  _follow(dt, arr) {
    const pos = this.pos, nav = this.game.nav;
    if (!arr) {
      this.lost = true;
      _o.x = _o.z = 0;
      return _o;
    }
    if (this.portal) {
      const t = this.portalTo;
      _o.x = t.x - pos.x;
      _o.z = t.z - pos.z;
      this.portalT += dt;
      if ((Math.hypot(_o.x, _o.z) < 0.45 && levelOf(pos.y + 0.3) === t.level) || this.portalT > 6) {
        this.portal = null;
        this.wpT = 0;
      }
      return _o;
    }
    this.wpT -= dt;
    if (this.wpT <= 0 || Math.hypot(this.wpx - pos.x, this.wpz - pos.z) < 0.35) {
      this.wpT = 0.08;
      const st = nav.steer(this.level, pos.x, pos.z, _steer, arr, _sopts);
      if (!st) {
        this.lost = true;
        this.wpx = pos.x;
        this.wpz = pos.z;
      } else {
        this.lost = false;
        this.fd = st.dist;
        if (st.portal) {
          this.portal = st.portal;
          this.portalTo = st.portalTo;
          this.portalT = 0;
        }
        this.wpx = st.wx;
        this.wpz = st.wz;
      }
    }
    _o.x = this.wpx - pos.x;
    _o.z = this.wpz - pos.z;
    return _o;
  }

  /** head along (wx, wz) at `speed`, facing `face` (else the way it goes); steers clear of walls and the player */
  _drive(dt, ctx, wx, wz, speed, face = null, turn = null) {
    const P = this.game.player, pos = this.pos;
    let len = Math.hypot(wx, wz);
    _w.x = len > 1e-4 ? wx / len : 0;
    _w.z = len > 1e-4 ? wz / len : 0;
    // only an attack comes this close: a dash / retreat swerves round the player
    if (!ATTACK.has(this.sstate) && P.alive && Math.abs(P.pos.y - pos.y) < 1.5) {
      const dx = pos.x - P.pos.x, dz = pos.z - P.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.8 && d > 1e-3) {
        const k = ((1.8 - d) / 1.8) * 1.5;
        _w.x += (dx / d) * k;
        _w.z += (dz / d) * k;
        len = Math.hypot(_w.x, _w.z) || 1;
        _w.x /= len;
        _w.z /= len;
      }
    }
    if (speed > 0.5) this._wallAvoid(dt, ctx, _w);
    const av = ctx.separation(this, _av);
    const fy = face ?? (Math.hypot(_w.x, _w.z) > 0.1 ? Math.atan2(_w.x, _w.z) : this.yaw);
    this.yaw = dampAngle(this.yaw, fy, turn ?? this.type.turn, dt);
    this.root.rotation.y = this.yaw;
    const vel = this.body.vel, k = this.body.onGround ? 14 : 3;
    vel.x = damp(vel.x, _w.x * speed + av.x * 1.2, k, dt);
    vel.z = damp(vel.z, _w.z * speed + av.z * 1.2, k, dt);
    this._move(dt, ctx);
    this.fwd = vel.x * Math.sin(this.yaw) + vel.z * Math.cos(this.yaw); // < 0: backing off
    const prev = this.phase;
    this.animate(dt);
    if (this.moveSpeed > 3 && Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      this.game.audio.play('stalker_step', { position: pos, volume: 0.6 });
    }
  }

  /** stand still (it still falls, and gets pushed), turning to `faceYaw` */
  _stand(dt, ctx, faceYaw, turn = 6) {
    const v = this.body.vel;
    v.x = damp(v.x, 0, 10, dt);
    v.z = damp(v.z, 0, 10, dt);
    this.yaw = dampAngle(this.yaw, faceYaw, turn, dt);
    this.root.rotation.y = this.yaw;
    this._move(dt, ctx);
    this.animate(dt);
  }

  _move(dt, ctx) {
    const pos = this.pos, bx = pos.x, bz = pos.z;
    ctx.world.moveBody(this.body, dt);
    this.moveSpeed = damp(this.moveSpeed, Math.hypot(pos.x - bx, pos.z - bz) / Math.max(dt, 1e-4), 10, dt);
  }

  // ---------------------------------------------------------------- animation
  _pose(dt) {
    const b = this.bones;
    const t = (this.phase2 = (this.phase2 ?? 0) + dt);
    this.flinchVel.addScaledVector(this.flinch, -120 * dt);
    this.flinchVel.multiplyScalar(Math.exp(-10 * dt));
    this.flinch.addScaledVector(this.flinchVel, dt);
    // twitches: sudden snaps, never eased
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = rand(0.25, 2.2);
      this.twitch.set(rand(-0.3, 0.3), rand(-0.6, 0.6), rand(-0.45, 0.45));
    }
    if (!this.alive) {
      this._animateDeath(dt);
      return;
    }
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    switch (this.sstate) {
      case 'watch':
      case 'recover':
        this._poseStand(b, t);
        break;
      case 'lunge':
        this._poseLunge(b, t);
        break;
      case 'grab':
        this._poseGrab(b, t);
        break;
      case 'strike':
        this._poseStand(b, t);
        this._poseSwipe(b);
        break;
      default:
        this._poseMove(b, t, dt);
    }
    this._lookAt(b, dt);
    const f = this.flinch;
    b.spine.rotation.x += f.x * 0.5;
    b.neck.rotation.x += f.y * 0.3;
    b.head.rotation.x -= f.y * 0.6;
    b.upperArmL.rotation.x += f.x * 0.3;
    b.upperArmR.rotation.x += f.x * 0.3;
  }

  /** its head stays on the player's eye (not while it runs for it or away) */
  _lookAt(b, dt) {
    let yawT = 0, pitchT = 0;
    if (this.game.player.alive && this.sstate !== 'dash' && this.sstate !== 'flee') {
      const cam = this.game.camera.position, pos = this.pos;
      const dx = cam.x - pos.x, dz = cam.z - pos.z;
      yawT = clamp(wrapAngle(Math.atan2(dx, dz) - this.yaw), -1.2, 1.2);
      // from where the head is now (last frame's pose: bent over, it's well below its standing height)
      const hy = this.bones.head.matrixWorld.elements[13];
      pitchT = clamp(Math.atan2(cam.y - hy, Math.hypot(dx, dz)), -0.7, 0.7);
    }
    this.lookYaw = damp(this.lookYaw, yawT, 8, dt);
    this.lookPitch = damp(this.lookPitch, pitchT, 8, dt);
    b.neck.rotation.y += this.lookYaw * 0.45;
    b.head.rotation.y += this.lookYaw * 0.55;
    b.head.rotation.x -= this.lookPitch * 0.7;
  }

  /** standing, hunched and tall: weight on one leg, head pushed forward and tilted, long arms hanging */
  _poseStand(b, t) {
    const tw = this.twitch;
    const br = Math.sin(t * 1.7); // slow, deep breaths
    const low = this.sstate === 'recover' ? 1 : 0;
    b.hips.position.y = HIP - 0.03 - low * 0.12;
    b.hips.rotation.set(0, 0, 0.05 + tw.z * 0.05);
    b.thighL.rotation.set(-0.05 - low * 0.5, 0, 0.06);
    b.thighR.rotation.set(-0.14 - low * 0.5, 0, -0.1);
    b.shinL.rotation.set(0.08 + low * 0.9, 0, 0);
    b.shinR.rotation.set(0.28 + low * 0.9, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x), 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x), 0, 0);
    b.spine.rotation.set(0.22 + low * 0.2 + br * 0.015, 0, 0);
    b.chest.rotation.set(0.14 + br * 0.03, 0, 0);
    b.neck.rotation.set(0.35 + tw.x * 0.2, tw.y * 0.25, 0);
    b.head.rotation.set(-0.3 + tw.x * 0.25, tw.y * 0.3, this.headTilt * 1.4 + tw.z * 0.3);
    b.upperArmL.rotation.set(-0.12 + Math.sin(t * 0.9) * 0.03, 0, 0.1);
    b.upperArmR.rotation.set(-0.18 + Math.sin(t * 1.1 + 1) * 0.03, 0, -0.1);
    b.foreArmL.rotation.set(-0.25 + Math.sin(t * 3.1) * 0.04, 0, 0);
    b.foreArmR.rotation.set(-0.35 + Math.sin(t * 2.7) * 0.04, 0, 0);
    // the fingers flex now and then
    const flex = Math.sin(t * 0.7 + this.id) > 0.4 ? 1 : 0;
    b.handL.rotation.set(0.35 + Math.sin(t * 7 + 1) * 0.1 * flex, 0, 0);
    b.handR.rotation.set(0.35 + Math.sin(t * 6 + 2) * 0.1 * flex, 0, 0);
  }

  /**
   * On the move: a slow walk (backwards while it slips away), a long-striding sprint bent far forward with the
   * arms flung back, and when it charges, the arms out in front, clawing.
   */
  _poseMove(b, t, dt) {
    const sp = this.moveSpeed;
    const back = this.fwd < -0.3;
    const run = clamp((sp - 2) / 6, 0, 1);
    const moving = clamp(sp / 0.7, 0, 1);
    this.phase += dt * (sp / lerp(0.75, 2.3, run)) * Math.PI * (back ? -1 : 1);
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = lerp(0.3, 0.95, run) * moving * (back ? 0.6 : 1);
    const tw = this.twitch;
    const lean = back ? 0.2 : lerp(0.2, 0.62, run);
    b.hips.position.y = HIP - 0.02 - run * 0.1 + Math.abs(c) * (0.02 + run * 0.07) * moving;
    b.hips.rotation.set(0, s * (0.1 + run * 0.12) * moving, c * 0.05 * moving);
    b.thighL.rotation.set(-s * amp - run * 0.3, 0, 0.05);
    b.thighR.rotation.set(s * amp - run * 0.3, 0, -0.05);
    b.shinL.rotation.set(Math.max(0, -c) * amp * 1.9 + 0.1 + run * 0.45, 0, 0);
    b.shinR.rotation.set(Math.max(0, c) * amp * 1.9 + 0.1 + run * 0.45, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.55, 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.55, 0, 0);
    b.spine.rotation.set(lean, -s * 0.14 * moving, 0);
    b.chest.rotation.set(0.1 + run * 0.12, -s * 0.1 * moving, 0);
    // head low and pushed out, eyes up on the way ahead
    b.neck.rotation.set(0.3 - run * 0.2 + tw.x * 0.1, 0, 0);
    b.head.rotation.set(-0.3 - run * 0.45, tw.y * 0.15, this.headTilt * 0.6);
    if (this.sstate === 'stalk') {
      // arms out in front, clawing the air in turn
      const claw = s * 0.4 * moving;
      b.upperArmL.rotation.set(lerp(-0.7, -1.15, run) + claw, 0, 0.25);
      b.upperArmR.rotation.set(lerp(-0.7, -1.15, run) - claw, 0, -0.25);
      b.foreArmL.rotation.set(-0.35 - Math.max(0, s) * 0.5, 0, 0);
      b.foreArmR.rotation.set(-0.35 - Math.max(0, -s) * 0.5, 0, 0);
      b.handL.rotation.set(0.7, 0, 0);
      b.handR.rotation.set(0.7, 0, 0);
      return;
    }
    const sw = s * lerp(0.35, 0.25, run) * moving;
    const trail = lerp(-0.15, 1.05, run);
    b.upperArmL.rotation.set(trail + sw + Math.sin(t * 13) * 0.08 * run, 0, 0.12 + run * 0.25);
    b.upperArmR.rotation.set(trail - sw + Math.sin(t * 12 + 1) * 0.08 * run, 0, -0.12 - run * 0.25);
    b.foreArmL.rotation.set(-0.3 - run * 0.1, 0, 0);
    b.foreArmR.rotation.set(-0.35 - run * 0.1, 0, 0);
    b.handL.rotation.set(0.4, 0, 0);
    b.handR.rotation.set(0.4, 0, 0);
  }

  /** in the air at the player: pitched forward, arms thrown wide to seize */
  _poseLunge(b, t) {
    const u = smoothstep(0, 1, clamp(this.sT / 0.12, 0, 1));
    this.root.rotation.x = 0.25 * u;
    b.hips.position.y = HIP - 0.05;
    b.hips.rotation.set(0, 0, 0);
    b.thighL.rotation.set(lerp(-0.4, -1.0, u), 0, 0.1);
    b.thighR.rotation.set(lerp(-0.4, 0.5, u), 0, -0.1);
    b.shinL.rotation.set(lerp(0.6, 0.9, u), 0, 0);
    b.shinR.rotation.set(lerp(0.6, 0.4, u), 0, 0);
    b.footL.rotation.set(0.2, 0, 0);
    b.footR.rotation.set(0.4, 0, 0);
    b.spine.rotation.set(lerp(0.4, 0.15, u), 0, 0);
    b.chest.rotation.set(-0.05, 0, 0);
    b.neck.rotation.set(0.15, 0, 0);
    b.head.rotation.set(-0.35, 0, Math.sin(t * 30) * 0.08);
    b.upperArmL.rotation.set(lerp(-0.5, -1.55, u), 0, lerp(0.2, 0.55, u));
    b.upperArmR.rotation.set(lerp(-0.5, -1.55, u), 0, -lerp(0.2, 0.55, u));
    b.foreArmL.rotation.set(-0.3, 0, 0);
    b.foreArmR.rotation.set(-0.3, 0, 0);
    b.handL.rotation.set(0.7, 0, 0);
    b.handR.rotation.set(0.7, 0, 0);
  }

  /** hands on the player's shoulders, bent down to their eye level, face to face, the head thrashing as it screams */
  _poseGrab(b, t) {
    const G = STALKER.grab;
    const k = smoothstep(0, 1, clamp(this.sT / 0.12, 0, 1));
    const hk = this.sT >= G.hitAt ? Math.exp(-(this.sT - G.hitAt) * 8) : 0; // the lunge in with the claws
    b.hips.position.y = HIP - 0.08;
    b.hips.rotation.set(0, 0, 0);
    b.thighL.rotation.set(-0.35, 0, 0.08);
    b.thighR.rotation.set(0.2, 0, -0.08);
    b.shinL.rotation.set(0.5, 0, 0);
    b.shinR.rotation.set(0.35, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x), 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x), 0, 0);
    b.spine.rotation.set(0.3 + hk * 0.2, 0, 0);
    b.chest.rotation.set(0.12, Math.sin(t * 9) * 0.05, 0);
    b.neck.rotation.set(0.12 + hk * 0.1, 0, 0);
    // the bend taken back out of the head, so the face stays on the player's (_lookAt adds the last bit)
    b.head.rotation.set(-0.5 - hk * 0.3 + Math.sin(t * 23) * 0.1, Math.sin(t * 17) * 0.22, Math.sin(t * 13) * 0.15);
    b.upperArmL.rotation.set(-1.25 + hk * 0.3, 0, lerp(0.5, 0.15, k));
    b.upperArmR.rotation.set(-1.25 + hk * 0.3, 0, -lerp(0.5, 0.15, k));
    b.foreArmL.rotation.set(-0.55, 0, 0);
    b.foreArmR.rotation.set(-0.55, 0, 0);
    b.handL.rotation.set(0.9, 0, 0);
    b.handR.rotation.set(0.9, 0, 0);
  }

  /** one big claw swipe (over the standing pose) */
  _poseSwipe(b) {
    const a = clamp(this.sT / STALKER.strike.t, 0, 1);
    const wind = a < 0.4 ? a / 0.4 : 0;
    const swing = a >= 0.4 ? Math.min(1, (a - 0.4) / 0.2) : 0;
    const side = this.id % 2 ? 'L' : 'R';
    const sx = side === 'L' ? 1 : -1;
    b['upperArm' + side].rotation.set(lerp(-1.2, -2.7, wind) + swing * 2.4, 0, sx * (0.35 * wind - 0.7 * swing));
    b['foreArm' + side].rotation.set(-0.9 * wind - 0.2, 0, 0);
    b.chest.rotation.y = sx * (-0.4 * wind + 0.6 * swing);
    b.spine.rotation.x = 0.3 + 0.25 * swing;
  }
}

ZOMBIE_CLASSES.stalker = Stalker;

// ---------------------------------------------------------------- director
/**
 * When and where the Stalker appears (game.stalker). Plans run on distance fields of the nav grid (the
 * bots' costs: a barricade is a wall to it; the hayloft ladder is switched off while they're built) and on
 * lines of sight from the player's camera.
 */
export class StalkerDirector {
  constructor(game) {
    this.game = game;
    const n = game.nav.N;
    // one field per purpose (only one Stalker at a time): a dash's two legs, a watcher's way out, the chase, the escape
    this.buf = { a: new Float32Array(n), b: new Float32Array(n), exit: new Float32Array(n), hunt: new Float32Array(n), escape: new Float32Array(n) };
    this.forceNext = null;
    this.reset();
  }

  /** a new game */
  reset() {
    this.z = null;
    this.on = false; // it haunts this round
    this.nextT = Infinity;
    this.count = 0;
    this.dread = 0; // appearances since its last attack
    this.lastAttack = -Infinity;
    this.killedRound = -99;
    this.met = false;
  }

  /** debug: bring it now ('watch' | 'dash' | 'attack'), in a fight round */
  force(kind = 'attack') {
    this.forceNext = kind;
    if (this.game.state === 'combat') {
      this.on = true;
      this.nextT = 0;
    }
    return kind;
  }

  onRoundStart(round) {
    const S = STALKER;
    const since = round - (S.firstRound[this.game.config?.difficulty] ?? 3);
    let on = since >= 0 && Math.random() < Math.min(S.chance.max, S.chance.base + S.chance.per * since);
    if (since >= 1 && !this.met) on = true; // no later than its second round
    if (round - this.killedRound <= 1) on = false; // killed last round: it keeps away for one
    this.count = 0;
    this.nextT = rand(S.firstAt[0], S.firstAt[1]);
    if (this.forceNext) {
      on = true;
      this.nextT = 2;
    }
    this.on = on;
  }

  onRoundEnd() {
    this.on = false;
    this.z?.leave();
  }

  onAttack() {
    this.dread = 0;
    this.lastAttack = this.game.time;
  }

  onKilled(z) {
    const g = this.game;
    this.killedRound = g.round;
    this.on = false;
    this.z = null;
    g.pickups.spawnSupply('red', z.pos);
    g.hud.banner('STALKER DOWN', 'It will not stay dead', 2.8, 'success');
  }

  update(dt) {
    const g = this.game;
    if (this.z && (!this.z.active || !this.z.alive)) this.z = null;
    const live = g.state === 'combat' && g.player.alive;
    if (this.z) {
      if (!live) this.z.leave();
      return;
    }
    if (!live || !this.on) return;
    if ((this.nextT -= dt) > 0) return;
    this._appear();
  }

  _appear() {
    const g = this.game, S = STALKER, A = S.attack;
    const forced = this.forceNext;
    this.forceNext = null;
    if (!forced && this.count >= S.perRound) {
      this.on = false;
      return;
    }
    this.nextT = rand(S.gap[0], S.gap[1]);
    if (!forced && this.count > 0 && Math.random() < S.skip) return; // this time, nothing
    const due = forced === 'attack' || (!forced && this.dread >= A.scares && g.time - this.lastAttack > A.minGap && Math.random() < A.chance[Math.min(this.dread - A.scares, A.chance.length - 1)]);
    const P = g.player.pos;
    let order;
    if (forced) order = forced === 'attack' ? ['attack', 'watch', 'dash'] : [forced];
    // due: mostly straight at you, else a watcher that charges once you've seen it
    else if (due) order = Math.random() < 0.7 ? ['attack', 'watch', 'dash'] : ['watch', 'attack', 'dash'];
    else order = Math.random() < (inHouse(P) || inBarn(P.x, P.z) ? 0.6 : 0.45) ? ['dash', 'watch'] : ['watch', 'dash'];
    for (const kind of order) {
      const plan = kind === 'attack' ? this._planAttack() : kind === 'dash' ? this._planDash() : this._planWatch();
      if (!plan) continue;
      if (kind === 'watch' && due) plan.canAttack = true;
      this._spawn(plan);
      return;
    }
    this.nextT = rand(S.retry[0], S.retry[1]); // no spot for it right now
    if (forced) this.forceNext = forced;
  }

  _spawn(plan) {
    const g = this.game, r = g.round;
    const z = g.zombies.spawn('stalker', plan.start, r, g.diff.hp * (1 + 0.05 * Math.max(0, r - 3)), 1);
    this.z = z;
    this.count++;
    this.met = true;
    if (plan.kind !== 'attack') this.dread++; // an attack resets it (onAttack)
    z.begin(plan, this);
  }

  // ---------------------------------------------------------------- planning
  /** the camera's eye, its horizontal view direction and half the horizontal field of view */
  _view() {
    const cam = this.game.camera;
    cam.getWorldDirection(_d);
    const l = Math.hypot(_d.x, _d.z) || 1;
    _vw.ex = cam.position.x;
    _vw.ey = cam.position.y;
    _vw.ez = cam.position.z;
    _vw.fx = _d.x / l;
    _vw.fz = _d.z / l;
    _vw.half = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
    return _vw;
  }

  /** (x, z) lies within the view's horizontal field (grown by margin rad; negative: well inside it) */
  _inView(x, z, v, margin) {
    const dx = x - v.ex, dz = z - v.ez, d = Math.hypot(dx, dz);
    return d < 1e-3 || (dx * v.fx + dz * v.fz) / d > Math.cos(Math.max(0, v.half + margin));
  }

  _los(x, y, z) {
    const e = this.game.camera.position;
    return this.game.world.lineOfSight(e.x, e.y, e.z, x, y, z);
  }

  /** nobody sees a body standing on (x, fy, z): no line of sight to its head or its middle */
  _hidden(x, fy, z) {
    return !this._los(x, fy + 1.75, z) && !this._los(x, fy + 1.0, z);
  }

  /** walkable cells (any floor within reach of y0) r0..r1 m around (cx, cz): fn(i, x, floorY, z, d) */
  _scan(cx, cz, y0, r0, r1, fn) {
    const nav = this.game.nav, c = nav.cell;
    const ix0 = Math.max(1, Math.floor((cx - r1 - nav.minX) / c)), ix1 = Math.min(nav.nx - 2, Math.floor((cx + r1 - nav.minX) / c));
    const iz0 = Math.max(1, Math.floor((cz - r1 - nav.minZ) / c)), iz1 = Math.min(nav.nz - 2, Math.floor((cz + r1 - nav.minZ) / c));
    for (let l = 0; l < nav.levels; l++) {
      for (let iz = iz0; iz <= iz1; iz++) {
        const z = nav.minZ + (iz + 0.5) * c;
        for (let ix = ix0; ix <= ix1; ix++) {
          const i = l * nav.per + iz * nav.nx + ix;
          if (!nav.walk[i]) continue;
          const fy = nav.floorY[i];
          if (Math.abs(fy - y0) > 4.2) continue;
          const x = nav.minX + (ix + 0.5) * c;
          const d = Math.hypot(x - cx, z - cz);
          if (d >= r0 && d <= r1) fn(i, x, fy, z, d);
        }
      }
    }
  }

  /** the first of `cells` (in their order, up to n tested) where it stands unseen, or -1 */
  _firstHidden(cells, n) {
    const nav = this.game.nav;
    for (let k = 0; k < Math.min(cells.length, n); k++) {
      nav.cellCenter(cells[k], _c);
      if (this._hidden(_c.x, _c.y, _c.z)) return cells[k];
    }
    return -1;
  }

  /**
   * Distance field toward (level, x, z) into buf, out to maxD cells (all it needs is local): barricades
   * closed, the hayloft ladder switched off.
   */
  _fieldAt(buf, level, x, z, maxD) {
    const nav = this.game.nav;
    const off = [];
    for (const p of nav.portals) {
      if (p.ladder && p.enabled) {
        p.enabled = false;
        off.push(p);
      }
    }
    _src[0].level = level;
    _src[0].x = x;
    _src[0].z = z;
    nav.compute(_src, buf, nav.fieldCost, maxD);
    for (const p of off) p.enabled = true;
    return buf;
  }

  _field(buf, i, maxD) {
    this.game.nav.cellCenter(i, _c);
    return this._fieldAt(buf, _c.level, _c.x, _c.z, maxD);
  }

  /** nav cells within reach of a working lamp (built once): a watcher there is easier to make out */
  _litCells() {
    if (this.lit) return this.lit;
    const nav = this.game.nav, c = nav.cell;
    const lit = (this.lit = new Uint8Array(nav.N));
    for (const l of this.game.level.lamps) {
      if (l.broken) continue;
      const r = l.distance * 0.45;
      const ix0 = Math.max(0, Math.floor((l.pos.x - r - nav.minX) / c)), ix1 = Math.min(nav.nx - 1, Math.floor((l.pos.x + r - nav.minX) / c));
      const iz0 = Math.max(0, Math.floor((l.pos.z - r - nav.minZ) / c)), iz1 = Math.min(nav.nz - 1, Math.floor((l.pos.z + r - nav.minZ) / c));
      for (let lv = 0; lv < nav.levels; lv++) {
        for (let iz = iz0; iz <= iz1; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) {
            const i = lv * nav.per + iz * nav.nx + ix;
            const x = nav.minX + (ix + 0.5) * c, z = nav.minZ + (iz + 0.5) * c;
            if (nav.walk[i] && Math.abs(l.pos.y - nav.floorY[i]) < 4 && Math.hypot(l.pos.x - x, l.pos.z - z) < r) lit[i] = 1;
          }
        }
      }
    }
    return lit;
  }

  _spot(i) {
    this.game.nav.cellCenter(i, _c);
    return new THREE.Vector3(_c.x, _c.y + 0.05, _c.z);
  }

  /** the field toward the player: plans measure by it, the charging Stalker runs down it */
  playerField(maxD = REACH.plan) {
    const P = this.game.player;
    return this._fieldAt(this.buf.hunt, P.level, P.pos.x, P.pos.z, maxD);
  }

  /** watch: in the line of sight but out of view (you'll see it when you turn), with a way out of sight close by */
  _planWatch() {
    const g = this.game, nav = g.nav, P = g.player.pos, v = this._view(), W = STALKER.watch;
    const fP = this.playerField();
    const lamps = this._litCells();
    const lit = [], dark = [];
    this._scan(P.x, P.z, P.y, W.dist[0], W.dist[1], (i, x, fy, z) => {
      if (!(fP[i] < Infinity) || nav.clear[i] < 1 || this._inView(x, z, v, 0.2)) return;
      (lamps[i] ? lit : dark).push(i); // under a lamp it's easier to make out
    });
    const cells = shuffle(lit).concat(shuffle(dark));
    for (let k = 0, tested = 0; k < cells.length && tested < 50; k++, tested++) {
      nav.cellCenter(cells[k], _c);
      if (!this._los(_c.x, _c.y + 1.75, _c.z) || !this._los(_c.x, _c.y + 1.1, _c.z)) continue;
      const wx = _c.x, wy = _c.y, wz = _c.z;
      const start = new THREE.Vector3(wx, wy + 0.05, wz);
      // the way out: the nearest cell (by path) out of sight
      const fW = this._field(this.buf.a, cells[k], REACH.exit);
      const ex = [];
      this._scan(wx, wz, wy, 1, 8, (i) => {
        const f = fW[i] * nav.cell;
        if (f >= 1.2 && f <= 9) ex.push(i);
      });
      ex.sort((a, b) => fW[a] - fW[b]);
      const exit = this._firstHidden(ex.filter((_, n) => n % 2 === 0), 40);
      return { kind: 'watch', start, exit: exit >= 0 ? this._field(this.buf.exit, exit, REACH.exit) : null };
    }
    return null;
  }

  /** dash: a spot C in plain view, a hidden start to one side of the line of sight through it, a hidden end to the other */
  _planDash() {
    const g = this.game, nav = g.nav, P = g.player.pos, v = this._view(), D = STALKER.dash;
    const fP = this.playerField();
    const cs = [];
    this._scan(P.x, P.z, P.y, D.cross[0], D.cross[1], (i, x, fy, z, d) => {
      if (nav.clear[i] < 2 || !(fP[i] < Infinity) || !this._inView(x, z, v, -0.2)) return;
      cs.push({ i, s: Math.abs(d - 7) + Math.random() * 5 }); // close passes are the scary ones
    });
    cs.sort((a, b) => a.s - b.s);
    let C = -1;
    for (let k = 0; k < Math.min(cs.length, 40) && C < 0; k++) {
      nav.cellCenter(cs[k].i, _c);
      if (this._los(_c.x, _c.y + 1.0, _c.z) && this._los(_c.x, _c.y + 1.7, _c.z)) C = cs[k].i;
    }
    if (C < 0) return null;
    nav.cellCenter(C, _c);
    const cx = _c.x, cy = _c.y, cz = _c.z;
    const fC = this._field(this.buf.a, C, REACH.leg);
    const ul = Math.hypot(cx - v.ex, cz - v.ez) || 1;
    const px = -(cz - v.ez) / ul, pz = (cx - v.ex) / ul; // across the line of sight
    const side = [[], []];
    this._scan(cx, cz, cy, 2.5, D.leg[1], (i, x, fy, z, d) => {
      const f = fC[i] * nav.cell;
      if (!(f >= D.leg[0] && f <= D.leg[1] * 1.3) || Math.hypot(x - P.x, z - P.z) < 3.5) return;
      const lat = ((x - cx) * px + (z - cz) * pz) / d;
      if (Math.abs(lat) > 0.45) side[lat > 0 ? 0 : 1].push(i);
    });
    const s0 = Math.random() < 0.5 ? 0 : 1;
    const A = this._firstHidden(shuffle(side[s0]), 45);
    if (A < 0) return null;
    const B = this._firstHidden(shuffle(side[1 - s0]), 45);
    if (B < 0) return null;
    const fB = this._field(this.buf.b, B, REACH.leg);
    if (!(fB[C] < Infinity)) return null;
    return { kind: 'dash', start: this._spot(A), fC, fB, C: [cx, cz] };
  }

  /** attack: a hidden start 7-16 m (by path) from the player, in front of them if at all possible */
  _planAttack() {
    const g = this.game, nav = g.nav, P = g.player, v = this._view(), A = STALKER.attack;
    if (P.climbing) return null;
    const fP = this.playerField();
    const front = [], any = [];
    this._scan(P.pos.x, P.pos.z, P.pos.y, 3, A.spawn[1], (i, x, fy, z) => {
      const f = fP[i] * nav.cell;
      if (f >= A.spawn[0] && f <= A.spawn[1]) (this._inView(x, z, v, 0.35) ? front : any).push(i);
    });
    let S = this._firstHidden(shuffle(front), 60);
    if (S < 0) S = this._firstHidden(shuffle(any), 40);
    return S < 0 ? null : { kind: 'attack', start: this._spot(S) };
  }

  /**
   * A way out of sight for `z`: a spot 3-22 m away, out of the line of sight (else out of view and well off),
   * first looked for further from the player than it is and not back past them, then anywhere. Its distance
   * field, or null.
   */
  planEscape(z) {
    const g = this.game, nav = g.nav, P = g.player.pos, S = z.pos, v = this._view();
    const ax = S.x - P.x, az = S.z - P.z, dP = Math.hypot(ax, az) || 1;
    const away = [], rest = [];
    this._scan(S.x, S.z, S.y, 3, 22, (i, x, fy, zz, d) => {
      const far = Math.hypot(x - P.x, zz - P.z) >= dP + 2 && ((x - S.x) * ax + (zz - S.z) * az) / (dP * d) > -0.1;
      (far ? away : rest).push(i);
    });
    const unseen = (x, y, zz) => this._hidden(x, y, zz) || (!this._inView(x, zz, v, 0.25) && Math.hypot(x - v.ex, zz - v.ez) > 6);
    const si0 = nav.index(z.level, S.x, S.z);
    for (const cs of [shuffle(away), shuffle(rest)]) {
      let tries = 0;
      for (let k = 0; k < Math.min(cs.length, 70) && tries < 3; k++) {
        nav.cellCenter(cs[k], _c);
        if (!unseen(_c.x, _c.y, _c.z)) continue;
        tries++;
        const f = this._field(this.buf.escape, cs[k], REACH.escape);
        const si = si0 >= 0 && f[si0] < Infinity ? si0 : nav.nearestWalkable(z.level, S.x, S.z, 3, f);
        if (si >= 0 && f[si] * nav.cell < 32) return f;
      }
    }
    return null;
  }
}
