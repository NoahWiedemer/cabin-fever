// The Crusher: the blue tank (UniRig GLB at x1.4), from round 11. A Zombie subclass that makes it a boss fight:
//   armour  its skull is armoured (headshots count x1.5, not x4: ZOMBIE_TYPES.crusher.partMult), blasts hurt it
//           less (type.blast) and it has more hp the bigger the fireteam (CRUSHER.team per member past the first)
//   slam    the overhead double-fist slam hits the ground: everyone within CRUSHER.slam.r of where the fists
//           land takes the blow (less at the edge) and is thrown back, and the floor shakes
//   charge  a target 5-15 m off along a clear, walkable line: it roars, stamps and lowers its head (0.8 s), then
//           charges (8.5 m/s, up to 15 m, steering only a little). Anyone in its way is flattened and thrown
//           aside; sidestep it and it runs on. A wall (or a barricade, which it smashes) stops it dead: dazed for
//           a moment, when it takes more damage
//   rage    below 40 % hp: a roar, its skin glows blue, it moves faster, slams quicker and charges more often
// The walk, the chase and the clawing at barricades are Zombie's (zombie.js); its slam pose too.
import * as THREE from 'three';
import { Zombie, ZOMBIE_CLASSES } from './zombie.js';
import { clamp, damp, dampAngle, lerp, rand, smoothstep, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { SURF } from '../world/collision.js';

export const CRUSHER = {
  team: 0.1, // extra hp per fireteam member past the first (the bots add less fire than that takes)
  slam: { r: 2.8, dmg: 34, edge: 0.4, knock: 7, lift: 3.5 }, // dmg x difficulty; edge: share of it at the rim
  charge: { min: 5, max: 15, windup: 0.8, speed: 8.5, dist: 15, t: 1.9, dmg: 42, knock: 11, lift: 4.5, turn: 1.1, hitR: 1.25, cd: [7, 11] },
  dazed: { t: 1.3, vuln: 1.4 }, // s stunned after running into a wall; damage taken x vuln meanwhile
  rage: { at: 0.4, speed: 1.3, attack: 0.72, charge: 1.12, cd: [3.5, 6] },
};

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _UP = new THREE.Vector3(0, 1, 0);
const _ray = {};

export class Crusher extends Zombie {
  spawn(pos, round, hpMult = 1, speedMult = 1) {
    // crusher state first: Zombie.spawn poses the body once
    this.cstate = 'walk'; // walk (Zombie's chase) | windup | charge | recover | dazed
    this.cT = 0;
    this.chargeCd = rand(1, 2.5); // it may open with a charge
    this.checkT = 0;
    this.chargeTarget = null;
    this.chargeYaw = 0;
    this.chargeRun = 0;
    this.hitSet = new Set();
    this.stomps = 0;
    this.rage = false;
    const team = this.game.team?.length ?? 1;
    super.spawn(pos, round, hpMult * (1 + CRUSHER.team * Math.max(0, team - 1)), speedMult);
  }

  _set(state) {
    this.cstate = state;
    this.cT = 0;
  }

  damage(amount, part, dir, source = null, opts = {}) {
    const res = super.damage(amount * (this.cstate === 'dazed' ? CRUSHER.dazed.vuln : 1), part, dir, source, opts);
    if (this.alive && !this.rage && this.hp < this.maxHp * CRUSHER.rage.at) this._enrage();
    return res;
  }

  _enrage() {
    const g = this.game;
    this.rage = true;
    this.speedMult *= CRUSHER.rage.speed;
    this.chargeCd = Math.min(this.chargeCd, 1.5);
    g.audio.play('crusher_roar', { position: this.pos, volume: 1, pitch: 0.85 });
    if (g.player?.alive) g.shake.add(clamp(0.6 - g.player.pos.distanceTo(this.pos) / 30, 0, 0.5));
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    if (!this.active) return;
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }
    this.chargeCd -= dt;
    this._glowRage();
    if (this.cstate === 'walk') {
      super.update(dt, ctx);
      if (this.alive && this.active && this.cstate === 'walk') this._tryCharge(dt, ctx);
      return;
    }
    this.level = levelOf(this.pos.y + 0.3);
    this.cT += dt;
    if (this.cstate === 'windup') this._windup(dt, ctx);
    else if (this.cstate === 'charge') this._charge(dt, ctx);
    else this._settle(dt, ctx);
  }

  /** its skin glows blue while it rages (per-instance materials: GLB_BODIES.tank.glow) */
  _glowRage() {
    if (!this.glow) return;
    const k = this.rage ? lerp(0.25, 0.6, 0.5 + 0.5 * Math.sin(this.game.time * 4 + this.id)) : 0;
    for (const m of this.glow) m.emissiveIntensity = k;
  }

  /** now and then, with a target in charging range along a clear walkable line: the wind-up */
  _tryCharge(dt, ctx) {
    if ((this.checkT -= dt) > 0 || this.chargeCd > 0) return;
    this.checkT = 0.3;
    const C = CRUSHER.charge, tgt = this.target;
    if (!tgt || tgt.isGoal || !tgt.alive || tgt.level !== this.level) return;
    if (this.attackT >= 0 || this.barricade || this.portal || this.climb || !this.body.onGround) return;
    if (!this.alerted || this.alertDelay > 0 || !this.hasLOS) return;
    const d = Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
    if (d < C.min || d > C.max || Math.random() > (this.rage ? 0.8 : 0.5)) return;
    // a walkable line with no barricade on it (narrower than its own path: it may clip a corner, and crash)
    const nav = ctx.nav;
    if (!nav.lineClear(this.level, this.pos.x, this.pos.z, tgt.pos.x, tgt.pos.z, 1, nav.dist, nav.cost)) return;
    this.chargeTarget = tgt;
    this.stomps = 0;
    this._set('windup');
    this.attackT = -1;
    this.game.audio.play('crusher_roar', { position: this.pos, volume: 1, pitch: rand(0.95, 1.1) });
  }

  /** roaring, stamping, head down, turning onto the target; then off it goes */
  _windup(dt, ctx) {
    const C = CRUSHER.charge, g = this.game, t = this.chargeTarget, pos = this.pos;
    if (!t || !t.alive) {
      this.chargeCd = 2;
      this._set('walk');
      return;
    }
    this.yaw = dampAngle(this.yaw, Math.atan2(t.pos.x - pos.x, t.pos.z - pos.z), 8, dt);
    this.root.rotation.y = this.yaw;
    const v = this.body.vel;
    v.x = damp(v.x, 0, 10, dt);
    v.z = damp(v.z, 0, 10, dt);
    ctx.world.moveBody(this.body, dt);
    this.moveSpeed = damp(this.moveSpeed, 0, 10, dt);
    // two stamps of the right foot
    const stamp = [0.3, 0.6][this.stomps];
    if (stamp !== undefined && this.cT >= stamp) {
      this.stomps++;
      g.audio.play('crusher_step', { position: pos, volume: 1, pitch: 0.9 });
      if (g.player?.alive) g.shake.add(clamp(0.35 - g.player.pos.distanceTo(pos) / 40, 0, 0.3));
    }
    if (this.cT >= C.windup) {
      // straight at where the target is heading (a little ahead of it)
      const tv = t.body?.vel;
      this.chargeYaw = Math.atan2(t.pos.x + (tv ? tv.x * 0.25 : 0) - pos.x, t.pos.z + (tv ? tv.z * 0.25 : 0) - pos.z);
      this.chargeRun = 0;
      this.hitSet.clear();
      this._set('charge');
    }
    this.animate(dt);
  }

  _charge(dt, ctx) {
    const C = CRUSHER.charge, g = this.game, t = this.chargeTarget, pos = this.pos;
    // it steers only a little: a sidestep dodges it
    let fx = Math.sin(this.chargeYaw), fz = Math.cos(this.chargeYaw);
    if (t?.alive) {
      const dx = t.pos.x - pos.x, dz = t.pos.z - pos.z;
      if (dx * fx + dz * fz > 0.5) {
        const turn = clamp(wrapAngle(Math.atan2(dx, dz) - this.chargeYaw), -C.turn * dt, C.turn * dt);
        this.chargeYaw += turn;
        fx = Math.sin(this.chargeYaw);
        fz = Math.cos(this.chargeYaw);
      }
    }
    this.yaw = this.chargeYaw;
    this.root.rotation.y = this.yaw;
    const speed = C.speed * (this.rage ? CRUSHER.rage.charge : 1);
    const v = this.body.vel;
    v.x = damp(v.x, fx * speed, 9, dt);
    v.z = damp(v.z, fz * speed, 9, dt);
    const bx = pos.x, bz = pos.z;
    ctx.world.moveBody(this.body, dt);
    const moved = Math.hypot(pos.x - bx, pos.z - bz);
    this.chargeRun += moved;
    this.moveSpeed = damp(this.moveSpeed, moved / Math.max(dt, 1e-4), 12, dt);
    // survivors in its way: flattened and thrown aside (each once)
    for (const m of ctx.team) {
      if (!m.alive || this.hitSet.has(m) || Math.abs(m.pos.y - pos.y) > 1.3) continue;
      const dx = m.pos.x - pos.x, dz = m.pos.z - pos.z;
      if (Math.hypot(dx, dz) > C.hitR + (m.radius ?? 0.3) || dx * fx + dz * fz < -0.4) continue;
      this.hitSet.add(m);
      m.takeDamage(C.dmg * (g.difficultyDamage ?? 1), pos, this);
      const side = dx * fz - dz * fx >= 0 ? 1 : -1; // thrown off to the side it stood on
      m.knockback?.((fx + fz * side * 0.8) * C.knock, C.lift, (fz - fx * side * 0.8) * C.knock);
      g.audio.play('crusher_slam', { position: m.pos, volume: 0.9, pitch: 1.2 });
      g.audio.play('impact_flesh', { position: m.pos, volume: 1 });
      if (m.isPlayer) g.shake.add(0.8);
    }
    // the horde in its way is shoved aside too
    for (const { zombie: o } of g.zombies.inRadius(pos, 1.4)) {
      if (o === this || o.type.mass >= this.type.mass) continue;
      const dx = o.pos.x - pos.x, dz = o.pos.z - pos.z, s = dx * fz - dz * fx >= 0 ? 1 : -1;
      o.body.vel.x += (fx * 0.5 + fz * s) * 6 * dt * 10;
      o.body.vel.z += (fz * 0.5 - fx * s) * 6 * dt * 10;
    }
    if (this.body.blocked && this.cT > 0.12) return this._crash(fx, fz);
    const passed = t?.alive && (t.pos.x - pos.x) * fx + (t.pos.z - pos.z) * fz < -3;
    if (this.chargeRun > C.dist || this.cT > C.t || passed) this._set('recover');
    const prev = this.phase;
    this.animate(dt);
    if (Math.floor(prev / Math.PI) !== Math.floor(this.phase / Math.PI)) {
      g.audio.play('crusher_step', { position: pos, volume: 1 });
      if (g.player?.alive) g.shake.add(clamp(0.3 - g.player.pos.distanceTo(pos) / 35, 0, 0.25));
    }
  }

  /** ran into a wall (or a barricade, which gives): a crash, dust, and it's dazed */
  _crash(fx, fz) {
    const g = this.game, pos = this.pos;
    this.body.vel.set(-fx * 1.5, this.body.vel.y, -fz * 1.5);
    _v.set(pos.x + fx * 0.9, pos.y + 1.2, pos.z + fz * 0.9);
    g.barricades?.explosion(_v, 1.6, 1200, null, { weapon: 'crusher' });
    const hit = g.world.raycast(pos.x, pos.y + 1.2, pos.z, fx, 0, fz, 2.2, null, _ray);
    _n.set(-fx, 0, -fz);
    for (let i = 0; i < 3; i++) g.fx.impact(_v.set(pos.x + fx * 0.9 + rand(-0.4, 0.4), pos.y + rand(0.6, 2), pos.z + fz * 0.9 + rand(-0.4, 0.4)), _n, hit?.box.surface ?? SURF.wood, { silent: i > 0, noDecal: true });
    g.audio.play('crusher_slam', { position: pos, volume: 1, pitch: 0.85 });
    if (g.player?.alive) g.shake.add(clamp(0.8 - g.player.pos.distanceTo(pos) / 25, 0, 0.7));
    this._set('dazed');
  }

  /** after a charge: slowing down (recover), or stunned from a crash (dazed); then back to the chase */
  _settle(dt, ctx) {
    const v = this.body.vel;
    v.x = damp(v.x, 0, this.cstate === 'dazed' ? 6 : 4, dt);
    v.z = damp(v.z, 0, this.cstate === 'dazed' ? 6 : 4, dt);
    const bx = this.pos.x, bz = this.pos.z;
    ctx.world.moveBody(this.body, dt);
    this.moveSpeed = damp(this.moveSpeed, Math.hypot(this.pos.x - bx, this.pos.z - bz) / Math.max(dt, 1e-4), 10, dt);
    if (this.cT >= (this.cstate === 'dazed' ? CRUSHER.dazed.t : 0.5)) {
      const cd = this.rage ? CRUSHER.rage.cd : CRUSHER.charge.cd;
      this.chargeCd = rand(cd[0], cd[1]);
      this.wpT = 0;
      this.noDirectT = 0;
      this._set('walk');
    }
    this.animate(dt);
  }

  // ---------------------------------------------------------------- the slam
  _updateAttack(dt, tgt, dist) {
    if (this.barricade) return super._updateAttack(dt, tgt, dist); // clawing at planks: Zombie's
    this.attackT += dt / (this.type.attackTime * (this.rage ? CRUSHER.rage.attack : 1));
    if (!this.attackHit && this.attackT >= (this.type.hitAt ?? 0.55)) {
      this.attackHit = true;
      this._slam();
    }
    if (this.attackT >= 1) {
      this.attackT = -1;
      this.attackCooldown = this.rage ? 0.15 : 0.35;
    }
  }

  /** the fists hit the ground ~1.3 m ahead: everyone around there takes it (less at the edge) and is thrown back */
  _slam() {
    const g = this.game, S = CRUSHER.slam, pos = this.pos;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const px = pos.x + fx * 1.3, pz = pos.z + fz * 1.3;
    for (const m of g.team) {
      if (!m.alive || Math.abs(m.pos.y - pos.y) > 1.4) continue;
      const dx = m.pos.x - px, dz = m.pos.z - pz, d = Math.hypot(dx, dz);
      if (d > S.r + (m.radius ?? 0.3)) continue;
      const k = lerp(1, S.edge, clamp(d / S.r, 0, 1));
      m.takeDamage(S.dmg * k * (g.difficultyDamage ?? 1), pos, this);
      const ux = d > 0.1 ? dx / d : fx, uz = d > 0.1 ? dz / d : fz;
      m.knockback?.(ux * S.knock * k, S.lift * k, uz * S.knock * k);
      g.audio.play('impact_flesh', { position: m.pos, volume: 0.7 });
    }
    // dust where the fists land, and the floor shakes
    const down = g.world.raycast(px, pos.y + 1, pz, 0, -1, 0, 2.5, null, _ray);
    const fy = down ? pos.y + 1 - down.t : pos.y;
    for (let i = 0; i < 3; i++) g.fx.impact(_v.set(px + rand(-0.5, 0.5), fy + 0.02, pz + rand(-0.5, 0.5)), _UP, down?.box.surface ?? SURF.mud, { silent: true, noDecal: true });
    g.audio.play('crusher_slam', { position: _v.set(px, fy, pz), volume: 1 });
    if (g.player?.alive) g.shake.add(clamp(0.9 - g.player.pos.distanceTo(pos) / 14, 0, 0.8));
  }

  // ---------------------------------------------------------------- animation
  _pose(dt) {
    if (!this.alive || this.cstate === 'walk') return super._pose(dt);
    const b = this.bones;
    const t = (this.phase2 = (this.phase2 ?? 0) + dt);
    this.flinchVel.addScaledVector(this.flinch, -120 * dt);
    this.flinchVel.multiplyScalar(Math.exp(-10 * dt));
    this.flinch.addScaledVector(this.flinchVel, dt);
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);
    b.handL.rotation.set(0.5, 0, 0);
    b.handR.rotation.set(0.5, 0, 0);
    if (this.cstate === 'windup') this._poseWindup(b, t);
    else if (this.cstate === 'charge') this._poseCharge(b, t, dt);
    else this._poseDazed(b, t);
    b.spine.rotation.x += this.flinch.x * 0.3;
  }

  /** the wind-up: sinking into a crouch, arms flung wide and back, head down, the right foot stamping, trembling */
  _poseWindup(b, t) {
    const k = smoothstep(0, 1, clamp(this.cT / 0.3, 0, 1));
    const st = this.cT < 0.72 ? Math.max(0, Math.sin(this.cT * Math.PI * 2 * 1.65 - 0.4)) : 0; // stamps
    const tr = Math.sin(t * 60) * 0.02 * k;
    b.hips.position.y = 0.98 - 0.03 - 0.08 * k;
    b.hips.rotation.set(0, 0, tr);
    b.thighL.rotation.set(-0.35 * k, 0, 0.12 * k);
    b.shinL.rotation.set(0.55 * k, 0, 0);
    b.thighR.rotation.set(0.1 * k - 0.7 * st, 0, -0.12 * k);
    b.shinR.rotation.set(0.35 * k + 0.9 * st, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x), 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.6, 0, 0);
    b.spine.rotation.set(0.25 + 0.35 * k + tr, 0, tr);
    b.chest.rotation.set(0.1 * k, 0, 0);
    b.neck.rotation.set(0.3 * k, Math.sin(t * 22) * 0.04 * k, 0);
    b.head.rotation.set(-0.5 * k, Math.sin(t * 26) * 0.05 * k, 0);
    b.upperArmL.rotation.set(0.3 * k, 0, 0.35 + 0.55 * k);
    b.upperArmR.rotation.set(0.3 * k, 0, -0.35 - 0.55 * k);
    b.foreArmL.rotation.set(-0.8 * k, 0, 0);
    b.foreArmR.rotation.set(-0.8 * k, 0, 0);
  }

  /** the charge: a heavy sprint bent low like a bull, head down, arms out in front like a ram */
  _poseCharge(b, t, dt) {
    const sp = this.moveSpeed;
    this.phase += dt * (sp / 1.9) * Math.PI;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const amp = 0.85 * clamp(sp / 4, 0, 1);
    b.hips.position.y = 0.98 - 0.08 + Math.abs(c) * 0.06;
    b.hips.rotation.set(0, s * 0.18, c * 0.06);
    b.thighL.rotation.set(-s * amp - 0.25, 0, 0.06);
    b.thighR.rotation.set(s * amp - 0.25, 0, -0.06);
    b.shinL.rotation.set(Math.max(0, -c) * amp * 1.6 + 0.25, 0, 0);
    b.shinR.rotation.set(Math.max(0, c) * amp * 1.6 + 0.25, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.5, 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.5, 0, 0);
    b.spine.rotation.set(0.6, -s * 0.12, 0);
    b.chest.rotation.set(0.15, -s * 0.08, 0);
    b.neck.rotation.set(0.35, 0, 0);
    b.head.rotation.set(-0.6, 0, 0);
    b.upperArmL.rotation.set(-0.6 + s * 0.3, 0, 0.45);
    b.upperArmR.rotation.set(-0.6 - s * 0.3, 0, -0.45);
    b.foreArmL.rotation.set(-0.9, 0, 0);
    b.foreArmR.rotation.set(-0.9, 0, 0);
  }

  /** slowing down after a charge (recover) or dazed after a crash: swaying, head wobbling, arms hanging */
  _poseDazed(b, t) {
    const dz = this.cstate === 'dazed' ? 1 - smoothstep(0.7, 1, this.cT / CRUSHER.dazed.t) : 0;
    const sw = Math.sin(t * 2.2) * 0.08 * dz;
    b.hips.position.y = 0.98 - 0.03 - 0.05 * dz;
    b.hips.rotation.set(0, 0, sw);
    b.thighL.rotation.set(-0.15 * dz, 0, 0.05);
    b.thighR.rotation.set(-0.1 * dz, 0, -0.05);
    b.shinL.rotation.set(0.1 + 0.3 * dz, 0, 0);
    b.shinR.rotation.set(0.1 + 0.25 * dz, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x), 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x), 0, 0);
    b.spine.rotation.set(0.25 + 0.1 * dz, 0, sw);
    b.chest.rotation.set(0.05, 0, 0);
    b.neck.rotation.set(0.15 + 0.2 * dz, Math.sin(t * 3.1) * 0.4 * dz, 0);
    b.head.rotation.set(-0.12, Math.sin(t * 2.3) * 0.2 * dz, Math.sin(t * 4.2) * 0.25 * dz);
    b.upperArmL.rotation.set(-0.35 + 0.35 * dz, 0, 0.35 - 0.1 * dz);
    b.upperArmR.rotation.set(-0.35 + 0.35 * dz, 0, -0.35 + 0.1 * dz);
    b.foreArmL.rotation.set(-0.5 + 0.3 * dz, 0, 0);
    b.foreArmR.rotation.set(-0.5 + 0.3 * dz, 0, 0);
  }
}

ZOMBIE_CLASSES.crusher = Crusher;
