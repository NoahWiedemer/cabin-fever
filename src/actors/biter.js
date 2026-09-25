// The Biter: a small feral kid (UniRig GLB, ~1.1 m) that hunts in packs, pounces and latches onto a survivor.
//   chase      skittering crouched run (zigzags, twitches), claws when cornered, hops back to pouncing range;
//              a survivor who already carries a Biter is circled by the rest of the pack, who wait their turn
//   telegraph  3-6 m from a target it can see: a short crouch + shriek (0.35 s), then
//   leap       a ballistic arc at the target. Shot in the air → knocked down (stunned ~1 s); lands without a
//              grab → tumbles on its face
//   latched    clings to the host's upper back and bites (BITER.bite.dps x difficulty, through kevlar); the
//              host moves at 60 % and can't sprint or aim down sights (player.js / weapons.js / teammate.js read
//              host.latchedBy). The player mashes V to shake it off (fx/latchView.js draws the prompt, the
//              vignette and the claws in first person), a bot throws it off after 2.5-3.5 s, and teammates can
//              shoot it off: rays from the host's own eye pass through it, everyone else's hit only the Biter
//   thrown / knocked → stunned on the ground (~1 s, an easy kill) → getup → chase
// Death, round restarts and a host going down free the host at once; the Biter drops from a spot that was
// kept clear of the walls behind the host, and moveBody settles it on valid ground.
import * as THREE from 'three';
import { Zombie, ZOMBIE_CLASSES } from './zombie.js';
import { clamp, damp, dampAngle, lerp, rand, smoothstep } from '../core/utils.js';
import { levelOf } from '../world/level.js';

export const BITER = {
  pounce: { min: 3, max: 6, telegraph: 0.35, speed: 8.5, maxT: 0.75, cd: [2.4, 3.8], first: [0.6, 1.6] },
  bite: { dps: 8, every: 0.42 }, // hp/s on hard: x game.difficultyDamage (easy 0.65, extreme 1.25)
  // player: each V press fills `per` of the meter; it only drains after `hold` s without a press, so ~5 quick
  // presses throw the Biter off. Bots throw it after `bot` s
  shake: { per: 0.205, hold: 0.35, drain: 0.9, bot: [2.5, 3.5] },
  knockOff: { hit: 0.35, total: 0.5 }, // teammates' shots pry it off: one hit / all hits while latched (x max hp)
  stun: 1.0,
  tumble: 0.9,
  getup: 0.4,
  circle: 2.6, // m: the ring the rest of the pack prowls around a host
  grace: 1.5, // s after a Biter lets go before the next one may pounce on the same survivor
  latch: { back: 0.25, up: 0.62, side: 0.14 }, // root on the host: m behind its center, above its feet, to its right
};

const HIP = 0.98; // proxy hip height the pose code writes around (gltfCharacter.js HIP_Y)
const _v = new THREE.Vector3();
const _ray = {};
const _w = { x: 0, z: 0 };
const _av = { x: 0, z: 0, lx: 0, lz: 0, slow: 1 };

export class Biter extends Zombie {
  spawn(pos, round, hpMult, speedMult) {
    // biter state first: Zombie.spawn poses the body once
    this.bstate = 'chase';
    this.bT = 0;
    this.latchHost = null;
    this.leapTarget = null;
    this.pounceCd = rand(BITER.pounce.first[0], BITER.pounce.first[1]);
    this.backoffT = -2;
    this.zig = 0;
    this.zigT = 0;
    this.circleA = Math.random() * Math.PI * 2;
    this.latchFrom = (this.latchFrom ?? new THREE.Vector3()).copy(pos);
    this.latchDmg = 0;
    this.shakeMeter = 0;
    this.lastPress = -9;
    this.biteT = 0;
    this.bite = 0;
    this.jolt = 0;
    this.stunT = 0;
    this.stunKind = 'back';
    this.spin = 0;
    super.spawn(pos, round, hpMult, speedMult);
    this.groanT = rand(0.5, 3);
  }

  // ---------------------------------------------------------------- overrides
  _alert(delay = 0) {
    if (this.alerted) return;
    this.alerted = true;
    this.alertDelay = delay;
    this.state = 'chase';
    if (Math.random() < 0.6) this.game.audio.play('biter_snarl', { position: this.pos, volume: 0.9 });
  }

  damage(amount, part, dir, source = null, opts = {}) {
    const latched = this.bstate === 'latched';
    const res = super.damage(amount, part, dir, source, opts);
    if (!this.alive || res.killed) return res;
    if (this.bstate === 'leap') this._knock(dir, 'shot'); // shot out of the air
    else if (latched) {
      this.latchDmg += res.dealt ?? 0;
      if (res.dealt >= this.maxHp * BITER.knockOff.hit || this.latchDmg >= this.maxHp * BITER.knockOff.total) this._release('shot', dir);
    }
    return res;
  }

  _die(dir, source, opts = {}) {
    if (this.latchHost) this._release('dead', dir); // the host is free the moment it dies
    this.bstate = 'dead';
    super._die(dir, source, opts); // a ragdoll (ragdoll.js) starts from the pose as it is, tilt included
    if (!this.ragdoll) {
      // the canned fall pivots an upright body
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this.mesh.position.set(0, 0, 0);
    }
  }

  deactivate() {
    if (this.latchHost) this._release('gone');
    super.deactivate();
  }

  /** the host's own shots (rays from its eye) pass through the Biter on its back */
  raycast(o, d, maxT) {
    const h = this.latchHost;
    if (h && Math.hypot(o.x - h.pos.x, o.z - h.pos.z) < 0.6 && o.y > h.pos.y + 0.6 && o.y < h.pos.y + 2.2) return null;
    return super.raycast(o, d, maxT);
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    if (!this.active) return;
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }
    this.level = levelOf(this.pos.y + 0.3);
    this.bT += dt;
    this.pounceCd -= dt;
    switch (this.bstate) {
      case 'latched':
        this._latched(dt, ctx);
        break;
      case 'telegraph':
        this._telegraph(dt, ctx);
        break;
      case 'leap':
        this._leap(dt, ctx);
        break;
      case 'knocked':
      case 'thrown':
        this._airborne(dt, ctx);
        break;
      case 'stunned':
      case 'getup':
        this._down(dt, ctx);
        break;
      default:
        this._chase(dt, ctx);
    }
    if (this.pos.y < -20) {
      // fell out of the world (shouldn't happen)
      if (this.latchHost) this._release('gone');
      this.hp = 0;
      this.alive = false;
      this.active = false;
      this.removed = true;
      this.root.visible = false;
    }
  }

  _chase(dt, ctx) {
    const game = this.game;
    const pos = this.pos;
    // target: the nearest survivor (own floor first) who isn't carrying another Biter. When that one is far
    // off and a carrier is close, circle the carrier and wait for a turn
    let free = null, fd = Infinity, busy = null, bd = Infinity;
    for (const m of ctx.team) {
      if (!m.alive) continue;
      let d = m.pos.distanceToSquared(pos);
      if (m.level !== this.level) d += 400;
      if (m.latchedBy && m.latchedBy !== this) {
        if (d < bd) (bd = d), (busy = m);
      } else if (d < fd) (fd = d), (free = m);
    }
    const circling = !!busy && (!free || Math.sqrt(fd) > Math.sqrt(bd) + 8);
    const tgt = (this.target = circling ? busy : free);
    const dist = tgt ? tgt.pos.distanceTo(pos) : Infinity;
    const sameLevel = !!tgt && tgt.level === this.level;

    // eye-level LOS + a walkable straight line on the nav grid (Zombie._senses)
    if (this._senses(dt, ctx, tgt, dist, sameLevel, 1.2) && !this.alerted && this.hasLOS && dist < 24) this._alert(rand(0.05, 0.4));
    if (!this.alerted && (dist < 9 || ctx.roundTime > 20)) this._alert(rand(0, 0.5));
    if (this.alertDelay > 0) this.alertDelay -= dt;
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = rand(2.2, 5.5);
      game.audio.play('biter_snarl', { position: pos, volume: 0.45 });
    }

    let wantX = 0, wantZ = 0, speed = 0, direct = false;
    this.stagger -= dt;
    this.hitSlow -= dt;
    this.attackCooldown -= dt;
    this.backoffT -= dt;
    const alertedNow = this.alerted && this.alertDelay <= 0;
    if (this.attackT >= 0) {
      this._updateAttack(dt, tgt, dist);
    } else if (tgt && this.stagger <= 0) {
      const reach = this.type.reach + (tgt.radius ?? 0.3);
      const dy = Math.abs(tgt.pos.y - pos.y);
      const graced = (tgt.latchFreeAt ?? 0) > ctx.time; // just got one off its back
      if (!circling && !graced && alertedNow && this.pounceCd <= 0 && this.hasLOS && this.canDirect && !this.portal && sameLevel && this.body.onGround && dist > BITER.pounce.min && dist < BITER.pounce.max && !tgt.latchedBy && dy < 1) {
        this._startTelegraph(tgt);
        this.animate(dt);
        return;
      }
      if (!circling && dist < reach && sameLevel && this.attackCooldown <= 0 && dy < 1.2) {
        this.attackT = 0;
        this.attackHit = false;
        game.audio.play('biter_snarl', { position: pos, volume: 0.8 });
      }
      // right in its target's face with a pounce ready: skitter back out to leaping range
      if (!circling && alertedNow && this.pounceCd <= 0 && dist < 2.2 && this.backoffT < -1.5 && Math.random() < dt * 2) this.backoffT = rand(0.4, 0.65);
      speed = (alertedNow ? this.type.run : this.type.walk) * this.speedMult;
      if (this.hitSlow > 0) speed *= 0.55;
      this.direct = false;
      this.noDirectT -= dt;
      this.rawT -= dt;
      if (this.portal) {
        this._portalMove(dt, ctx, tgt, dist, _w);
        wantX = _w.x;
        wantZ = _w.z;
      } else if (sameLevel && this.canDirect && this.noDirectT <= 0 && dist < 12) {
        this.route = null;
        direct = true;
        if (circling) {
          // prowl a ring around the carrier
          this.circleA += dt * 0.9 * (this.id % 2 ? 1 : -1);
          const R = BITER.circle + Math.sin(ctx.time * 1.7 + this.id) * 0.4;
          wantX = tgt.pos.x + Math.cos(this.circleA) * R - pos.x;
          wantZ = tgt.pos.z + Math.sin(this.circleA) * R - pos.z;
          speed *= clamp(Math.hypot(wantX, wantZ) / 1.5, 0.25, 0.75);
        } else if (this.backoffT > 0) {
          wantX = pos.x - tgt.pos.x;
          wantZ = pos.z - tgt.pos.z;
        } else {
          wantX = tgt.pos.x - pos.x;
          wantZ = tgt.pos.z - pos.z;
        }
      } else {
        this._fieldWant(dt, ctx, _w);
        wantX = this.steerOk ? _w.x : tgt.pos.x - pos.x;
        wantZ = this.steerOk ? _w.z : tgt.pos.z - pos.z;
      }
      this.direct = direct;
      if (!circling && this.backoffT <= 0 && dist < reach * 0.8 && sameLevel) speed *= 0.2;
    }

    let len = Math.hypot(wantX, wantZ);
    if (len > 1e-4) {
      wantX /= len;
      wantZ /= len;
    }
    // skitter: jinks left and right on the way in (less when following the flow field around corners)
    this.zigT -= dt;
    if (this.zigT <= 0) {
      this.zigT = rand(0.16, 0.42);
      this.zig = rand(-0.8, 0.8);
    }
    const zig = speed > 2.5 && dist > 2.5 && this.attackT < 0 ? this.zig * (direct ? 1 : 0.4) : 0;
    const sx = -wantZ, sz = wantX;
    wantX += sx * zig;
    wantZ += sz * zig;
    len = Math.hypot(wantX, wantZ);
    _w.x = len > 1e-4 ? wantX / len : 0;
    _w.z = len > 1e-4 ? wantZ / len : 0;
    // stuck → side-step to the roomier side, grid-only steering (Zombie._unstick)
    const near = !circling && sameLevel && dist < this.type.reach + (tgt?.radius ?? 0.3) + 0.4;
    this._unstick(dt, ctx, speed, _w, near);
    if (speed > 0.5 && this.attackT < 0) this._wallAvoid(dt, ctx, _w);
    wantX = _w.x;
    wantZ = _w.z;
    // crowd: separation, stepping round the one in front (it's small: it slips past the big ones)
    const av = ctx.avoid ? ctx.avoid(this, wantX, wantZ, _av) : ctx.separation(this, _av);
    wantX += av.x * 1.4 + (av.lx ?? 0);
    wantZ += av.z * 1.4 + (av.lz ?? 0);

    let faceYaw = this.yaw;
    if ((this.attackT >= 0 || circling || this.backoffT > 0) && tgt) faceYaw = Math.atan2(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
    else if (Math.hypot(wantX, wantZ) > 0.1) faceYaw = Math.atan2(wantX, wantZ);
    this.yaw = dampAngle(this.yaw, faceYaw, this.type.turn, dt);
    this.root.rotation.y = this.yaw + Math.sin(ctx.time * 21 + this.id) * 0.06 * clamp(this.moveSpeed / 4, 0, 1);

    const vel = this.body.vel;
    const moveMul = this.attackT >= 0 ? this.type.lunge : 1;
    const accel = 16 * (this.body.onGround ? 1 : 0.25);
    vel.x = damp(vel.x, wantX * speed * moveMul, accel, dt);
    vel.z = damp(vel.z, wantZ * speed * moveMul, accel, dt);
    this._move(dt, ctx);
    const prev = this.phase;
    this.animate(dt);
    if (Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI) && this.moveSpeed > 1 && Math.random() < 0.35) {
      game.audio.play('zombie_footstep', { position: pos, volume: 0.18, pitch: 1.8 });
    }
  }

  /** moveBody + moveSpeed (horizontal m/s actually covered) */
  _move(dt, ctx) {
    const pos = this.pos;
    const bx = pos.x, bz = pos.z;
    ctx.world.moveBody(this.body, dt);
    this.moveSpeed = damp(this.moveSpeed, Math.hypot(pos.x - bx, pos.z - bz) / Math.max(dt, 1e-4), 10, dt);
  }

  // ---------------------------------------------------------------- pounce
  _startTelegraph(tgt) {
    this.bstate = 'telegraph';
    this.bT = 0;
    this.leapTarget = tgt;
    this.attackT = -1;
    this.game.audio.play('biter_shriek', { position: this.pos, volume: 1 });
  }

  _telegraph(dt, ctx) {
    const tgt = this.leapTarget;
    if (!tgt || !tgt.alive || (tgt.latchedBy && tgt.latchedBy !== this)) {
      this.bstate = 'chase';
      this.pounceCd = rand(0.5, 1);
      this.animate(dt);
      return;
    }
    this.yaw = dampAngle(this.yaw, Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z), 22, dt);
    this.root.rotation.y = this.yaw;
    this.body.vel.x = damp(this.body.vel.x, 0, 14, dt);
    this.body.vel.z = damp(this.body.vel.z, 0, 14, dt);
    this._move(dt, ctx);
    if (this.bT >= BITER.pounce.telegraph) this._launch(tgt);
    this.animate(dt);
  }

  _launch(tgt) {
    const p = this.pos, v = this.body.vel;
    const g = this.body.gravity;
    const T = clamp(Math.hypot(tgt.pos.x - p.x, tgt.pos.z - p.z) / BITER.pounce.speed, 0.3, BITER.pounce.maxT);
    // at the target's middle, leading it by half of where it's heading (a sidestep still dodges)
    const tv = tgt.body?.vel;
    const ax = tgt.pos.x + (tv ? tv.x * T * 0.5 : 0);
    const az = tgt.pos.z + (tv ? tv.z * T * 0.5 : 0);
    const dx = ax - p.x, dz = az - p.z, dy = tgt.pos.y + 0.5 - p.y;
    v.set(dx / T, (dy + 0.5 * g * T * T) / T, dz / T);
    this.body.onGround = false;
    this.bstate = 'leap';
    this.bT = 0;
    this.yaw = Math.atan2(dx, dz);
    this.root.rotation.y = this.yaw;
  }

  _leap(dt, ctx) {
    const pos = this.pos;
    this._move(dt, ctx);
    // grabbing whoever it hits on the way (the target, usually)
    for (const m of ctx.team) {
      if (!m.alive) continue;
      const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z, dy = pos.y - m.pos.y;
      const rr = (m.radius ?? 0.3) + this.type.radius + 0.12;
      if (dx * dx + dz * dz > rr * rr || dy < -0.35 || dy > 1.5) continue;
      if (m.latchedBy) this._knock(null, 'bounce'); // someone beat it to that back
      else this._latch(m);
      this.animate(dt);
      return;
    }
    if (this.body.blocked && this.bT > 0.05) this._knock(null, 'bounce');
    else if (this.body.onGround && this.bT > 0.08) this._stun('tumble'); // missed: lands on its face
    else if (this.bT > 1.4) this._knock(null, 'bounce');
    this.animate(dt);
  }

  _knock(dir, why) {
    const v = this.body.vel;
    if (why === 'shot') {
      v.x *= -0.25;
      v.z *= -0.25;
      if (dir) {
        v.x += dir.x * 1.5;
        v.z += dir.z * 1.5;
      }
      v.y = Math.min(v.y, 1.5);
      this.spin = -7;
    } else {
      v.x *= -0.35;
      v.z *= -0.35;
      v.y = Math.min(v.y, 1);
      this.spin = -5;
    }
    this.bstate = 'knocked';
    this.bT = 0;
    this.body.onGround = false;
  }

  _airborne(dt, ctx) {
    const v = this.body.vel;
    const drag = Math.exp(-0.6 * dt);
    v.x *= drag;
    v.z *= drag;
    this._move(dt, ctx);
    if ((this.body.onGround && this.bT > 0.05) || this.bT > 2) {
      this.game.audio.play(this.bstate === 'thrown' ? 'biter_shake' : 'bodyfall', { position: this.pos, volume: 0.8, pitch: this.bstate === 'thrown' ? 1 : 1.5 });
      this._stun('back');
    }
    this.animate(dt);
  }

  _stun(kind) {
    this.bstate = 'stunned';
    this.stunKind = kind;
    this.bT = 0;
    this.stunT = kind === 'tumble' ? BITER.tumble : BITER.stun;
    this.lie0 = this.root.rotation.x;
    this.attackT = -1;
  }

  _down(dt, ctx) {
    const v = this.body.vel;
    v.x = damp(v.x, 0, this.bT < 0.2 ? 3 : 10, dt); // skid a little, then lie still
    v.z = damp(v.z, 0, this.bT < 0.2 ? 3 : 10, dt);
    this._move(dt, ctx);
    if (this.bstate === 'stunned' && this.bT >= this.stunT) {
      this.bstate = 'getup';
      this.bT = 0;
      this.lie0 = this.root.rotation.x;
    } else if (this.bstate === 'getup' && this.bT >= BITER.getup) {
      this.bstate = 'chase';
      this.bT = 0;
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this.mesh.position.set(0, 0, 0);
      this.pounceCd = Math.max(this.pounceCd, rand(BITER.pounce.cd[0], BITER.pounce.cd[1]) * 0.6);
      this.game.audio.play('biter_snarl', { position: this.pos, volume: 0.7 });
    }
    this.animate(dt);
  }

  // ---------------------------------------------------------------- latch
  _latch(host) {
    const game = this.game;
    this.bstate = 'latched';
    this.bT = 0;
    this.latchHost = host;
    host.latchedBy = this;
    this.latchFrom.copy(this.pos);
    this.latchDmg = 0;
    this.shakeMeter = 0;
    this.lastPress = -9;
    this.biteT = 0.18;
    this.bite = 0;
    this.botShakeAt = rand(BITER.shake.bot[0], BITER.shake.bot[1]);
    this.attackT = -1;
    this.alerted = true;
    this.body.vel.set(0, 0, 0);
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.mesh.position.set(0, 0, 0);
    game.audio.play('biter_snarl', { position: this.pos, volume: 1 });
    if (host.isPlayer) {
      // first person: the body is drawn by fx/latchView.js instead (the world one would clip the camera)
      this.root.visible = false;
      game.shake.add(0.55);
      const f = _v.set(-Math.sin(host.yaw), 0, -Math.cos(host.yaw));
      host.knockback?.(f.x * 1.6, 0, f.z * 1.6); // shoved forward by the impact
    }
  }

  _latched(dt, ctx) {
    const game = this.game;
    const h = this.latchHost;
    if (!h || !h.alive || h.latchedBy !== this || !ctx.team.includes(h)) {
      this._release('host');
      this.animate(dt);
      return;
    }
    // on the host's back, facing where it faces (the player's yaw points down -Z, the bots' down +Z)
    const yaw = h.isPlayer ? h.yaw + Math.PI : h.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let back = BITER.latch.back;
    const hit = ctx.world.raycast(h.pos.x, h.pos.y + 1.1, h.pos.z, -fx, 0, -fz, back + 0.3, null, _ray);
    if (hit) back = Math.max(-0.05, hit.t - 0.3); // never pushed into a wall behind the host
    const k = smoothstep(0, 1, clamp(this.bT / 0.18, 0, 1)); // scramble round onto the back
    const f = this.latchFrom;
    const side = BITER.latch.side; // over the host's right shoulder (the host's right is (-fz, fx))
    const tx = h.pos.x - fx * back - fz * side, tz = h.pos.z - fz * back + fx * side;
    this.pos.set(lerp(f.x, tx, k), lerp(f.y, h.pos.y + BITER.latch.up, k), lerp(f.z, tz, k));
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.body.vel.copy(h.body.vel);
    this.body.onGround = false;
    this.moveSpeed = 0;

    // bites
    this.biteT -= dt;
    if (this.biteT <= 0) {
      const every = BITER.bite.every * rand(0.85, 1.15);
      this.biteT = every;
      this.bite = 1;
      h.takeDamage(BITER.bite.dps * every * (game.difficultyDamage ?? 1), this.pos, this, { ignoreArmor: true, quiet: true });
      const neck = _v.set(h.pos.x - fx * 0.08, h.pos.y + 1.45, h.pos.z - fz * 0.08);
      game.audio.play('biter_bite', { position: neck, volume: h.isPlayer ? 1 : 0.75 });
      if (h.isPlayer) game.shake.add(0.3);
      else game.fx.bloodHit(neck, _v.set(fx, 0.4, fz).normalize(), { amount: 0.3, decals: false });
      if (!h.alive) return; // that bite finished the host; next frame lets go
    }
    this.bite = Math.max(0, this.bite - dt * 3.2);
    this.jolt = Math.max(0, this.jolt - dt * 5);

    // shaking it off
    if (h.isPlayer) {
      const input = game.input;
      if (input.locked && input.hit('KeyV')) {
        this.shakeMeter += BITER.shake.per;
        this.lastPress = this.bT;
        this.jolt = 1;
        game.shake.add(0.22);
        game.audio.play('knife_swing', { volume: 0.35, pitch: 0.6 });
      } else if (this.bT - this.lastPress > BITER.shake.hold) this.shakeMeter = Math.max(0, this.shakeMeter - BITER.shake.drain * dt);
      game.shake.trauma = Math.max(game.shake.trauma, 0.3); // it keeps thrashing on your back
      if (this.shakeMeter >= 1) {
        this._release('shaken');
        this.animate(dt);
        return;
      }
    } else if (this.bT >= this.botShakeAt) {
      this._release('shaken');
      this.animate(dt);
      return;
    }
    this.animate(dt);
  }

  /** let go of the host: 'shaken' | 'shot' (thrown off, lands stunned), 'dead', 'host' (host down), 'gone' */
  _release(why, dir = null) {
    const h = this.latchHost;
    this.latchHost = null;
    if (h && h.latchedBy === this) h.latchedBy = null;
    if (h) h.latchFreeAt = this.game.time + BITER.grace;
    this.root.visible = this.active;
    if (h?.isPlayer) this.game.latchView?.onRelease?.(why);
    if (why === 'gone') return;
    // it drops from where it clung (kept clear of the walls behind the host); moveBody resolves the rest
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const v = this.body.vel;
    if (why === 'shaken') {
      const s = rand(-0.8, 0.8);
      v.set(-fx * 3.4 + fz * s, 2.6, -fz * 3.4 - fx * s);
      this.spin = -9;
      this.game.audio.play('biter_snarl', { position: this.pos, volume: 0.9, pitch: 1.2 });
      if (h?.isPlayer) this.game.shake.add(0.4);
    } else if (why === 'shot') {
      v.set(-fx * 1.2 + (dir?.x ?? 0) * 2.2, 1.4, -fz * 1.2 + (dir?.z ?? 0) * 2.2);
      this.spin = -6;
    } else v.set(-fx * 1.2, 0.4, -fz * 1.2); // 'dead' / 'host': just drops off
    if (h) v.add(_v.copy(h.body.vel).setY(0));
    this.body.onGround = false;
    this.bT = 0;
    this.pounceCd = rand(BITER.pounce.cd[0], BITER.pounce.cd[1]);
    if (why === 'shaken') this.bstate = 'thrown';
    else if (why !== 'dead') this.bstate = 'knocked';
    this.root.updateMatrixWorld(true);
  }

  /** the latch as the first-person view needs it (fx/latchView.js), or null */
  get latchInfo() {
    if (this.bstate !== 'latched') return null;
    const i = (this._info ??= {});
    i.t = this.bT;
    i.bite = this.bite;
    i.jolt = this.jolt;
    i.meter = this.shakeMeter;
    return i;
  }

  // ---------------------------------------------------------------- animation
  _pose(dt) {
    const b = this.bones;
    const t = (this.phase2 = (this.phase2 ?? 0) + dt);
    this.flinchVel.addScaledVector(this.flinch, -120 * dt);
    this.flinchVel.multiplyScalar(Math.exp(-10 * dt));
    this.flinch.addScaledVector(this.flinchVel, dt);
    // feral twitches: quicker and sharper than a Mauler's
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = rand(0.12, 0.6);
      this.twitch.set(rand(-0.35, 0.35), rand(-0.7, 0.7), rand(-0.35, 0.35));
    }
    if (!this.alive) {
      this._animateDeath(dt);
      return;
    }
    switch (this.bstate) {
      case 'telegraph':
        this._poseCrouch(b, t);
        break;
      case 'leap':
        this._poseLeap(b, t);
        break;
      case 'knocked':
      case 'thrown':
        this._poseFlail(b, t, dt);
        break;
      case 'stunned':
      case 'getup':
        this._poseDown(b, t);
        break;
      case 'latched':
        poseClinging(b, t, this.bite, this.jolt, this.id);
        this.root.rotation.x = this.jolt * 0.12;
        this.root.rotation.z = Math.sin(t * 9 + this.id) * 0.05 + this.jolt * Math.sin(t * 40) * 0.1;
        break;
      default:
        this._poseRun(b, t, dt);
    }
    // hit flinch
    b.spine.rotation.x += this.flinch.x * 0.4;
    b.upperArmL.rotation.x += this.flinch.x * 0.3;
    b.upperArmR.rotation.x += this.flinch.x * 0.3;
  }

  _poseRun(b, t, dt) {
    const sp = this.moveSpeed;
    const run = clamp((sp - 1.4) / 3, 0, 1);
    const moving = clamp(sp / 0.6, 0, 1);
    this.phase += dt * (sp / lerp(0.55, 1.05, run)) * Math.PI; // short, quick steps
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = lerp(0.3, 0.7, run) * moving;
    const f = this.flinch, tw = this.twitch;
    const crouch = 0.4 + 0.12 * run; // knees always bent: low and springy
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    b.hips.position.y = HIP - (0.04 + 0.03 * run) + Math.abs(c) * 0.03 * moving;
    b.hips.rotation.set(0.05, s * 0.22 * moving + f.z * 0.2, c * 0.1 * moving + tw.z * 0.12);
    b.thighL.rotation.set(-crouch - s * amp, 0, 0.12);
    b.thighR.rotation.set(-crouch + s * amp, 0, -0.12);
    b.shinL.rotation.set(crouch * 1.3 + Math.max(0, -c) * amp * 1.1, 0, 0);
    b.shinR.rotation.set(crouch * 1.3 + Math.max(0, c) * amp * 1.1, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.8, 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.8, 0, 0);
    // the model is hunched already: a bit further at a sprint, the head tipped up to see ahead
    b.spine.rotation.set(0.05 + 0.12 * run, -s * 0.15 * moving + f.z * 0.4, tw.z * 0.1);
    b.chest.rotation.set(0.05 + f.x * 0.3, -s * 0.1 * moving, 0);
    b.neck.rotation.set(-0.2 + f.y * 0.3, tw.y * 0.45, 0);
    b.head.rotation.set(-0.25 + tw.x * 0.4 - f.y * 0.5, tw.y * 0.6, this.headTilt + Math.sin(t * 2.3 + this.id) * 0.1);
    // arms forward and low, claws out, scrabbling with the stride
    const scr = s * lerp(0.25, 0.7, run) * moving;
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    b.upperArmL.rotation.set(-0.75 + scr + Math.sin(t * 7 + this.id) * 0.08, 0, 0.25);
    b.upperArmR.rotation.set(-0.75 - scr + Math.sin(t * 6.3 + this.id * 2) * 0.08, 0, -0.25);
    b.foreArmL.rotation.set(-0.7 - Math.max(0, s) * 0.4 * moving, 0, 0);
    b.foreArmR.rotation.set(-0.7 - Math.max(0, -s) * 0.4 * moving, 0, 0);
    b.handL.rotation.set(0.5, 0, 0);
    b.handR.rotation.set(0.5, 0, 0);
    if (this.attackT >= 0) {
      // one-armed claw swipe
      const a = this.attackT;
      const wind = a < 0.35 ? a / 0.35 : 0;
      const swing = a >= 0.35 ? Math.min(1, (a - 0.35) / 0.25) : 0;
      const side = this.id % 2 ? 'L' : 'R';
      const sx = side === 'L' ? 1 : -1;
      b['upperArm' + side].rotation.set(lerp(-0.8, -2.4, wind) + swing * 2.0, 0, sx * (0.3 * wind - 0.5 * swing));
      b['foreArm' + side].rotation.set(-0.8 * wind - 0.3, 0, 0);
      b.chest.rotation.y = sx * (-0.3 * wind + 0.5 * swing);
      b.head.rotation.x -= 0.3 * wind;
    }
  }

  /** the pounce wind-up: sinks low, arms drawn back, head up shrieking, trembling */
  _poseCrouch(b, t) {
    const k = smoothstep(0, 1, clamp(this.bT / 0.2, 0, 1));
    const tr = Math.sin(t * 70) * 0.03 * k;
    b.hips.position.y = HIP - 0.07 - 0.14 * k;
    b.hips.rotation.set(0.05 + 0.1 * k, 0, tr);
    b.thighL.rotation.set(-0.55 - 0.75 * k, 0, 0.12 + 0.15 * k);
    b.thighR.rotation.set(-0.55 - 0.75 * k, 0, -0.12 - 0.15 * k);
    b.shinL.rotation.set(0.85 + 1.15 * k, 0, 0);
    b.shinR.rotation.set(0.85 + 1.15 * k, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.85, 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.85, 0, 0);
    b.spine.rotation.set(0.05 + 0.3 * k + tr, 0, 0);
    b.chest.rotation.set(0.05 + 0.1 * k, 0, 0);
    b.neck.rotation.set(-0.2 - 0.35 * k, 0, 0);
    b.head.rotation.set(-0.25 - 0.4 * k + tr * 2, 0, tr);
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    b.upperArmL.rotation.set(-0.75 + 1.0 * k, 0, 0.25 + 0.3 * k);
    b.upperArmR.rotation.set(-0.75 + 1.0 * k, 0, -0.25 - 0.3 * k);
    b.foreArmL.rotation.set(-0.7 - 0.6 * k, 0, 0);
    b.foreArmR.rotation.set(-0.7 - 0.6 * k, 0, 0);
    b.handL.rotation.set(0.6, 0, 0);
    b.handR.rotation.set(0.6, 0, 0);
  }

  /** in the air: stretched out flat at the target, claws first, legs trailing */
  _poseLeap(b, t) {
    const u = smoothstep(0, 1, clamp(this.bT / 0.15, 0, 1));
    this.root.rotation.x = lerp(0, 0.78, u) - (this.body.vel.y < 0 ? 0.12 : 0);
    this.root.rotation.z = 0;
    b.hips.position.y = HIP - 0.05;
    b.hips.rotation.set(-0.1 * u, 0, 0);
    b.thighL.rotation.set(lerp(-1.3, 0.3, u), 0, 0.2);
    b.thighR.rotation.set(lerp(-1.3, 0.1, u), 0, -0.2);
    b.shinL.rotation.set(lerp(2.0, 1.0, u), 0, 0);
    b.shinR.rotation.set(lerp(2.0, 1.3, u), 0, 0);
    b.footL.rotation.set(0.6, 0, 0);
    b.footR.rotation.set(0.6, 0, 0);
    b.spine.rotation.set(lerp(0.35, -0.25, u), 0, 0);
    b.chest.rotation.set(-0.1 * u, 0, 0);
    b.neck.rotation.set(-0.35 * u, 0, 0);
    b.head.rotation.set(-0.35 * u, 0, Math.sin(t * 20) * 0.05);
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    b.upperArmL.rotation.set(lerp(0.25, -1.9, u), 0, 0.45);
    b.upperArmR.rotation.set(lerp(0.25, -1.9, u), 0, -0.45);
    b.foreArmL.rotation.set(-0.45, 0, 0);
    b.foreArmR.rotation.set(-0.45, 0, 0);
    b.handL.rotation.set(0.8, 0, 0);
    b.handR.rotation.set(0.8, 0, 0);
  }

  /** knocked out of the air / thrown off: tumbling backwards, limbs everywhere */
  _poseFlail(b, t, dt) {
    // tumbles backwards, but no further than flat on its back (the root pivots at the feet: past that the
    // head would swing under the floor)
    this.root.rotation.x = clamp(this.root.rotation.x + this.spin * dt, -1.4, 1.4);
    this.root.rotation.z = damp(this.root.rotation.z, 0, 6, dt);
    b.hips.position.y = HIP - 0.05;
    b.hips.rotation.set(0, 0, 0);
    b.thighL.rotation.set(-0.9 + Math.sin(t * 15) * 0.6, 0, 0.3);
    b.thighR.rotation.set(-0.9 - Math.sin(t * 15) * 0.6, 0, -0.3);
    b.shinL.rotation.set(1.0 + Math.sin(t * 13) * 0.4, 0, 0);
    b.shinR.rotation.set(1.0 - Math.sin(t * 13) * 0.4, 0, 0);
    b.footL.rotation.set(0.3, 0, 0);
    b.footR.rotation.set(0.3, 0, 0);
    b.spine.rotation.set(-0.3, 0, 0);
    b.chest.rotation.set(-0.1, 0, 0);
    b.neck.rotation.set(-0.3, Math.sin(t * 11) * 0.3, 0);
    b.head.rotation.set(-0.3, 0, 0);
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    b.upperArmL.rotation.set(-2.2 + Math.sin(t * 17) * 0.8, 0, 0.8 + Math.sin(t * 13) * 0.4);
    b.upperArmR.rotation.set(-2.2 - Math.sin(t * 16) * 0.8, 0, -0.8 - Math.sin(t * 12) * 0.4);
    b.foreArmL.rotation.set(-0.6 + Math.sin(t * 19) * 0.4, 0, 0);
    b.foreArmR.rotation.set(-0.6 - Math.sin(t * 18) * 0.4, 0, 0);
    b.handL.rotation.set(0.4, 0, 0);
    b.handR.rotation.set(0.4, 0, 0);
  }

  /** stunned on its back (knocked / thrown) or face (a missed pounce), then scrambling up */
  _poseDown(b, t) {
    const face = this.stunKind === 'tumble';
    const lieX = face ? 1.42 : -1.42;
    let k; // 0 upright .. 1 lying
    if (this.bstate === 'stunned') {
      const e = smoothstep(0, 1, clamp(this.bT / 0.25, 0, 1));
      // from however it landed to flat on the floor (+ a small bounce)
      const bounce = this.bT > 0.25 ? Math.exp(-(this.bT - 0.25) * 12) * Math.sin((this.bT - 0.25) * 30) * 0.06 : 0;
      this.root.rotation.x = lerp(this.lie0 ?? 0, lieX, e) - bounce * Math.sign(lieX);
      k = 1;
    } else {
      const e = smoothstep(0, 1, clamp(this.bT / BITER.getup, 0, 1));
      this.root.rotation.x = lerp(this.lie0 ?? lieX, 0, e);
      k = 1 - e;
    }
    this.root.rotation.z = 0;
    // lift along world up so the body rests on the floor instead of sinking into it (as in the death fall)
    const a = this.root.rotation.x;
    const L = 0.1 * clamp(Math.abs(a) / 1.4, 0, 1);
    this.mesh.position.set(0, L * Math.cos(a), -L * Math.sin(a));
    const spas = this.bstate === 'stunned' ? Math.sin(t * 23) * 0.12 * (Math.sin(t * 3.1 + this.id) > 0.3 ? 1 : 0) : 0;
    const tw = this.twitch;
    b.hips.position.y = HIP - 0.05 - (1 - k) * 0.12;
    b.hips.rotation.set(0, tw.y * 0.2 * k, 0);
    b.thighL.rotation.set(lerp(-1.2, face ? 0.1 : -0.6, k) + spas, 0, 0.25 * k + 0.1);
    b.thighR.rotation.set(lerp(-1.2, face ? 0.2 : -0.4, k) - spas, 0, -0.3 * k - 0.1);
    b.shinL.rotation.set(lerp(1.9, face ? 0.3 : 1.1, k), 0, 0);
    b.shinR.rotation.set(lerp(1.9, face ? 0.4 : 0.8, k), 0, 0);
    b.footL.rotation.set(0.3, 0, 0);
    b.footR.rotation.set(0.3, 0, 0);
    b.spine.rotation.set(lerp(0.4, face ? 0 : -0.25, k), 0, 0);
    b.chest.rotation.set(0, 0, 0);
    b.neck.rotation.set(face ? -0.5 * k : 0.2 * k, (tw.y * 0.6 + Math.sin(t * 1.7) * 0.4) * k, 0);
    b.head.rotation.set(-0.2 * k, tw.y * 0.4 * k, 0.3 * k);
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    b.upperArmL.rotation.set(lerp(-0.5, face ? -2.6 : -0.6, k) + spas, 0, lerp(0.3, 1.1, k));
    b.upperArmR.rotation.set(lerp(-0.5, face ? -2.6 : -0.9, k) - spas, 0, lerp(-0.3, -1.2, k));
    b.foreArmL.rotation.set(-0.8 + tw.x * k, 0, 0);
    b.foreArmR.rotation.set(-0.5 - tw.z * k, 0, 0);
    b.handL.rotation.set(0.6, 0, 0);
    b.handR.rotation.set(0.6, 0, 0);
  }
}

/**
 * Clinging to a back (proxy bones, facing where the host faces): legs wrapped round the waist, arms hooked
 * over the shoulders, head buried in the neck. bite 1 → 0 after each bite (head worries the neck), jolt 1 → 0
 * after the host bucks (V). Shared by the world body and the first-person one (fx/latchView.js).
 */
export function poseClinging(b, t, bite = 0, jolt = 0, id = 0) {
  const w = Math.sin(t * 9 + id) * 0.06 + jolt * Math.sin(t * 38) * 0.25;
  b.hips.position.y = HIP;
  b.hips.rotation.set(0, 0, w * 0.5);
  // piggyback: knees forward round the host's waist, shins hanging and kicking
  b.thighL.rotation.set(-1.5, 0, 0.35);
  b.thighR.rotation.set(-1.5, 0, -0.35);
  b.shinL.rotation.set(1.7 + Math.sin(t * 5 + id) * 0.12, 0, 0);
  b.shinR.rotation.set(1.7 + Math.sin(t * 5.7 + id) * 0.12, 0, 0);
  b.footL.rotation.set(0.4, 0, 0);
  b.footR.rotation.set(0.4, 0, 0);
  // upright against the back (the model is modeled hunched), pulling in with each bite
  b.spine.rotation.set(-0.25 + jolt * 0.2, w, 0);
  b.chest.rotation.set(bite * 0.12, -w, 0);
  // head turned in to the host's neck (it hangs over the right shoulder), worrying at it after a bite
  b.neck.rotation.set(0.1 + bite * 0.35, 0.5 + Math.sin(t * 24) * 0.3 * bite, 0);
  b.head.rotation.set(0.2 + bite * 0.3, 0.3 + Math.sin(t * 26) * 0.25 * bite, 0.2);
  // arms hooked up over the shoulders, claws raking
  b.shoulderL.rotation.set(0, 0, 0);
  b.shoulderR.rotation.set(0, 0, 0);
  b.upperArmL.rotation.set(-1.95 + jolt * 0.3 + Math.sin(t * 7 + id) * 0.06, 0, -0.3);
  b.upperArmR.rotation.set(-1.95 + jolt * 0.3 + Math.sin(t * 6.4 + id) * 0.06, 0, 0.3);
  b.foreArmL.rotation.set(-1.85 + Math.sin(t * 11 + id) * 0.15, 0, 0);
  b.foreArmR.rotation.set(-1.85 + Math.sin(t * 10 + id) * 0.15, 0, 0);
  b.handL.rotation.set(0.7, 0, 0);
  b.handR.rotation.set(0.7, 0, 0);
}

ZOMBIE_CLASSES.biter = Biter;
