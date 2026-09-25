// The Infected: Mauler (standard; some wear the L4D2 Smoker model), Boomer (type id 'charger':
// explodes, weak spot on the gut), Striker (female, fast), Crusher (tank), Mutant Dog (quadruped
// GLB, packs, pounce + bite; animated by dogAnim.js).
// AI (alert → chase via flow field / direct LOS → attack), procedural animation, hitboxes.
import * as THREE from 'three';
import { createCharacter } from './rig.js';
import { poseDog, resetDog } from './dogAnim.js';
import { clamp, lerp, damp, dampAngle, rand, rayCapsule, raySphere, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';

// walk/run of the original four are 90 % of their first tuning; the dog is 110 % of the old mauler.
// Optional: leap {min, max distance, vy, t, cd: [min, max], snd, pitch}, turn (yaw rate), height
// (collision), eye (LOS height), pitch (voice), lunge (move factor while attacking), hitAt.
export const ZOMBIE_TYPES = {
  // body kinds cycle per instance (2 of 5 maulers use the Smoker GLB)
  mauler: { name: 'Mauler', body: ['mauler', 'smoker', 'mauler2', 'mauler', 'smoker'], hp: 150, walk: 1.125, run: 3.87, dmg: 11, reach: 1.25, attackTime: 1.0, radius: 0.32, scale: 1.0, score: 100, mass: 1 },
  charger: { name: 'Boomer', body: ['boomer'], hp: 110, walk: 1.35, run: 4.5, dmg: 0, reach: 1.9, attackTime: 0.9, radius: 0.32, scale: 1.0, score: 150, mass: 1, explodes: true },
  striker: { name: 'Striker', body: ['striker'], hp: 170, walk: 1.53, run: 5.31, dmg: 13, reach: 1.25, attackTime: 0.7, radius: 0.3, scale: 0.97, score: 200, mass: 0.8, leap: { min: 2.5, max: 6.5, vy: 5.2, t: 0.6, cd: [3, 5], snd: 'striker_shriek', pitch: 1.1 } },
  crusher: { name: 'Crusher', body: ['crusher'], hp: 1500, walk: 1.35, run: 2.52, dmg: 34, reach: 1.9, attackTime: 1.5, radius: 0.55, scale: 1.4, score: 500, mass: 4, turn: 4 },
  dog: { name: 'Mutant Dog', body: ['dog'], hp: 90, walk: 1.375, run: 4.73, dmg: 8, reach: 1.1, attackTime: 0.55, radius: 0.36, scale: 1.0, score: 120, mass: 0.7, turn: 14, height: 1.0, eye: 0.75, pitch: 1.55, lunge: 0.6, hitAt: 0.5, leap: { min: 1.8, max: 4.5, vy: 3.4, t: 0.45, cd: [2.2, 3.8], snd: 'zombie_attack', pitch: 1.6 } },
};

export const PART_MULT = { head: 4.0, torso: 1.0, pelvis: 0.9, arm: 0.7, leg: 0.7, dynamite: 1.0, belly: 1.0 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };
const _ray = {};

let ZID = 1;
const bodyCount = {};

export class Zombie {
  constructor(typeName, game) {
    this.id = ZID++;
    this.typeName = typeName;
    this.type = ZOMBIE_TYPES[typeName];
    this.game = game;
    const bodies = this.type.body;
    const n = (bodyCount[typeName] = (bodyCount[typeName] ?? 0) + 1);
    const char = createCharacter(bodies[n % bodies.length], this.type.scale);
    this.root = char.root;
    this.root.rotation.order = 'YXZ';
    this.mesh = char.mesh;
    this.bones = char.bones;
    this.led = char.led || null;
    this.rig = char.rig || null; // GLB body: retarget after posing the proxy bones
    this.glow = char.glow || null;
    this.quad = !!char.quad; // quadruped proxies (dogAnim.js); a dog without its GLB runs as a humanoid
    this.rest = char.rest || null;
    this.extent = char.extent || null; // quadruped nose / tail reach past the collision circle
    this.scale = this.type.scale;
    this.body = {
      pos: this.root.position,
      vel: new THREE.Vector3(),
      radius: this.type.radius,
      height: this.type.height ?? Math.min(1.6 * this.scale, 1.95), // capped so the Crusher fits through doorways
      stepHeight: 0.52,
      onGround: true,
      gravity: 18,
    };
    this.hitParts = this._buildHitParts(char.hit);
    this.active = false;
  }

  /** H: volumes measured from a GLB body (gltfCharacter.js), else the procedural proportions */
  _buildHitParts(H) {
    const b = this.bones;
    const s = this.scale;
    const g = this.typeName === 'crusher' ? 1.25 : this.typeName === 'striker' ? 0.88 : 1;
    const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const head = H?.head ?? { off: V(0, 0.1, 0.01), r: 0.125 };
    const torso = H?.torso ?? { off: V(0, 0.02, 0), off2: V(0, 0.24, 0), r: 0.17 * g };
    const pelvis = H?.pelvis ?? { off: V(0, -0.02, 0), r: 0.16 * g };
    const ua = H?.upperArm ?? 0.065 * g, fa = H?.foreArm ?? 0.06 * g;
    const th = H?.thigh ?? 0.09 * g, sh = H?.shin ?? 0.07 * g;
    const parts = H?.parts
      ? H.parts.map((p) => ({ name: p.name, kind: p.kind, bone: b[p.key], off: p.off.clone(), bone2: p.key2 ? b[p.key2] : null, off2: p.off2 ? p.off2.clone() : null, r: p.r }))
      : [
          { name: 'head', kind: 'sphere', bone: b.head, off: head.off.clone(), r: head.r },
          { name: 'torso', kind: 'capsule', bone: b.spine, off: torso.off.clone(), bone2: b.chest, off2: torso.off2.clone(), r: torso.r },
          { name: 'pelvis', kind: 'sphere', bone: b.hips, off: pelvis.off.clone(), r: pelvis.r },
          { name: 'arm', kind: 'capsule', bone: b.upperArmL, off: V(), bone2: b.foreArmL, off2: V(), r: ua },
          { name: 'arm', kind: 'capsule', bone: b.foreArmL, off: V(), bone2: b.handL, off2: V(0, -0.1, 0), r: fa },
          { name: 'arm', kind: 'capsule', bone: b.upperArmR, off: V(), bone2: b.foreArmR, off2: V(), r: ua },
          { name: 'arm', kind: 'capsule', bone: b.foreArmR, off: V(), bone2: b.handR, off2: V(0, -0.1, 0), r: fa },
          { name: 'leg', kind: 'capsule', bone: b.thighL, off: V(), bone2: b.shinL, off2: V(), r: th },
          { name: 'leg', kind: 'capsule', bone: b.shinL, off: V(), bone2: b.footL, off2: V(), r: sh },
          { name: 'leg', kind: 'capsule', bone: b.thighR, off: V(), bone2: b.shinR, off2: V(), r: th },
          { name: 'leg', kind: 'capsule', bone: b.shinR, off: V(), bone2: b.footR, off2: V(), r: sh },
        ];
    if (this.type.explodes) {
      // weak spot that sets it off: the Boomer's gut, or the procedural fallback's dynamite bundles
      if (H?.belly) parts.unshift({ name: 'belly', kind: 'sphere', bone: b.spine, off: H.belly.off.clone(), r: H.belly.r });
      else {
        parts.unshift({ name: 'dynamite', kind: 'sphere', bone: b.chest, off: V(0, 0.08, 0.16), r: 0.11 });
        parts.unshift({ name: 'dynamite', kind: 'sphere', bone: b.chest, off: V(0, 0.08, -0.16), r: 0.11 });
      }
    }
    for (const p of parts) {
      p.r *= s;
      p.a = new THREE.Vector3();
      p.b = new THREE.Vector3();
    }
    return parts;
  }

  spawn(pos, round, hpMult = 1, speedMult = 1) {
    this.active = true;
    this.alive = true;
    this.removed = false;
    this.root.visible = true;
    this.root.position.copy(pos);
    this.root.rotation.set(0, Math.atan2(-pos.x, -pos.z), 0);
    this.sizeVar = this.typeName === 'crusher' ? 1 : rand(0.94, 1.06);
    this.root.scale.setScalar(this.scale * this.sizeVar);
    this.mesh.position.set(0, 0, 0);
    this.deathLift = 0;
    this.phase2 = 0;
    this.body.vel.set(0, 0, 0);
    this.body.onGround = true;
    this.maxHp = Math.round(this.type.hp * hpMult);
    this.hp = this.maxHp;
    this.speedMult = speedMult * rand(0.92, 1.08);
    this.state = 'approach';
    this.alerted = false;
    this.alertDelay = 0;
    this.target = null;
    this.attackT = -1;
    this.attackHit = false;
    this.attackCooldown = 0;
    this.phase = Math.random() * 10;
    this.moveSpeed = 0;
    this.yaw = this.root.rotation.y;
    this.flinch = new THREE.Vector3();
    this.flinchVel = new THREE.Vector3();
    this.deathT = 0;
    this.corpseT = 0;
    this.stagger = 0;
    this.losT = Math.random() * 0.3;
    this.hasLOS = false;
    this.portal = null;
    this.portalT = 0;
    this.stuckT = 0;
    this.sideStep = 0;
    this.lastPos = pos.clone();
    this.groanT = rand(1, 6);
    this.fuse = -1;
    this.leapT = -1;
    this.leapCooldown = rand(2, 4);
    this.headTilt = rand(-0.35, 0.35);
    this.twitchT = 0;
    this.twitch = new THREE.Vector3();
    this.lastHitBy = null;
    this.level = levelOf(pos.y);
    this.hitSlow = 0;
    this.burnT = 0;
    this.explodedOnDeath = false;
    if (this.glow) for (const m of this.glow) m.emissiveIntensity = 0;
    if (this.quad) resetDog(this);
    this.wallT = 0;
    this.wallShift = 0;
    this.animate(0.016);
    this.root.updateMatrixWorld(true);
  }

  get pos() {
    return this.root.position;
  }

  // ---------------------------------------------------------------- damage
  damage(amount, part, dir, source = null, opts = {}) {
    if (!this.alive) return { killed: false, dealt: 0 };
    if ((part === 'dynamite' || part === 'belly') && this.type.explodes) {
      this.lastHitBy = source;
      this.hp = 0;
      this._die(dir, source, { ...opts, dynamiteShot: true });
      return { killed: true, dealt: amount, dynamite: true };
    }
    const dealt = Math.min(this.hp, amount);
    this.hp -= amount;
    this.lastHitBy = source;
    if (!this.alerted) this._alert(0.05);
    // flinch impulse (in local space)
    const k = clamp(amount / (this.maxHp * 0.25), 0.2, 1.5) / (this.type.mass ?? 1);
    if (dir) {
      const localYaw = Math.atan2(dir.x, dir.z) - this.yaw;
      this.flinchVel.x += Math.cos(localYaw) * 5 * k;
      this.flinchVel.z += -Math.sin(localYaw) * 3 * k;
    }
    if (part === 'head') this.flinchVel.y += 6 * k;
    if (amount > this.maxHp * 0.35 && this.typeName !== 'crusher') this.stagger = Math.max(this.stagger, 0.35);
    this.hitSlow = 0.25;
    if (this.hp <= 0) {
      this._die(dir, source, opts);
      return { killed: true, dealt };
    }
    if (Math.random() < 0.35) this.game.audio.play(this.typeName === 'striker' ? 'striker_shriek' : 'zombie_hurt', { position: this.pos, volume: 0.6, pitch: this.typeName === 'crusher' ? 0.6 : this.type.pitch ?? 1 });
    return { killed: false, dealt };
  }

  _die(dir, source, opts = {}) {
    this.alive = false;
    this.state = 'dead';
    this.deathT = 0;
    this.corpseT = 0;
    this.fallDir = 1;
    if (dir) {
      // fall away from the shot
      const localYaw = wrapAngle(Math.atan2(dir.x, dir.z) - this.yaw);
      this.fallDir = Math.abs(localYaw) < Math.PI / 2 ? 1 : -1; // shot from behind → fall forward
    } else this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.fallSide = rand(-0.4, 0.4);
    this.deathArms = rand(0.6, 1.4);
    if (this.led) this.led.material.emissiveIntensity = 0;
    if (this.glow) for (const m of this.glow) m.emissiveIntensity = 0;
    this.game.onZombieKilled(this, { source, ...opts });
  }

  _alert(delay = 0) {
    if (this.alerted) return;
    this.alerted = true;
    this.alertDelay = delay;
    this.state = 'chase';
    const snd = this.typeName === 'striker' ? 'striker_shriek' : this.typeName === 'crusher' ? 'crusher_roar' : 'zombie_alert';
    if (Math.random() < 0.6) this.game.audio.play(snd, { position: this.pos, volume: 0.9, pitch: this.type.pitch ?? 1 });
  }

  // ---------------------------------------------------------------- update
  update(dt, ctx) {
    if (!this.active) return;
    if (!this.alive) {
      this._updateDead(dt);
      return;
    }
    const game = this.game;
    const pos = this.pos;
    this.level = levelOf(pos.y + 0.3);

    // pick target: nearest living team member (prefer same level)
    let best = null, bd = Infinity;
    for (const m of ctx.team) {
      if (!m.alive) continue;
      let d = m.pos.distanceToSquared(pos);
      if (m.level !== this.level) d += 400;
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    this.target = best;
    const tgt = best;
    const dist = tgt ? Math.sqrt(tgt.pos.distanceToSquared(pos)) : Infinity;
    const sameLevel = tgt && tgt.level === this.level;

    // LOS checks (throttled)
    this.losT -= dt;
    if (this.losT <= 0 && tgt) {
      this.losT = 0.25 + Math.random() * 0.15;
      this.hasLOS = sameLevel && dist < 28 && ctx.world.lineOfSight(pos.x, pos.y + (this.type.eye ?? 1.5) * this.scale, pos.z, tgt.pos.x, tgt.pos.y + 1.3, tgt.pos.z);
      if (!this.alerted && (this.hasLOS && dist < 24)) this._alert(rand(0.1, 0.6));
    }
    if (!this.alerted && (dist < 9 || ctx.roundTime > 22)) this._alert(rand(0, 0.8));
    if (this.alertDelay > 0) this.alertDelay -= dt;

    // groans
    this.groanT -= dt;
    if (this.groanT <= 0) {
      this.groanT = rand(3.5, 9);
      const snd = this.typeName === 'crusher' ? 'crusher_roar' : 'zombie_groan';
      if (this.typeName !== 'crusher' || Math.random() < 0.35) game.audio.play(snd, { position: pos, volume: this.typeName === 'crusher' ? 0.7 : 0.55, pitch: this.typeName === 'striker' ? 1.3 : this.type.pitch ?? 1 });
    }

    // boomer fuse
    if (this.fuse >= 0) {
      this.fuse += dt;
      if (this.led) this.led.material.emissiveIntensity = Math.sin(this.fuse * 40) > 0 ? 30 : 0;
      if (this.glow) {
        // GLB Boomer: flashes hot and swells before it pops
        const k = Math.sin(this.fuse * 40) > 0 ? 1.3 : 0.2;
        for (const m of this.glow) m.emissiveIntensity = k;
        this.root.scale.setScalar(this.scale * this.sizeVar * (1 + this.fuse * 0.07 + Math.sin(this.fuse * 40) * 0.012));
      }
      if (this.fuse > 0.85) {
        this.hp = 0;
        this.alive = false;
        this.explodedOnDeath = true;
        this.game.onZombieKilled(this, { source: null, selfDestruct: true });
        this.state = 'dead';
        this.deathT = 0;
        this.fallDir = 1;
        this.fallSide = 0;
        this.deathArms = 1;
        return;
      }
    } else if (this.led) {
      this.led.material.emissiveIntensity = Math.sin(ctx.time * 6 + this.id) > 0.7 ? 8 : 0.3;
    }

    // ---------------- decide desired movement
    let wantX = 0, wantZ = 0, speed = 0;
    this.stagger -= dt;
    this.hitSlow -= dt;
    this.attackCooldown -= dt;

    if (this.attackT >= 0) {
      this._updateAttack(dt, tgt, dist);
    } else if (tgt && this.stagger <= 0) {
      const reach = this.type.reach * (this.typeName === 'crusher' ? 1 : 1) + (tgt.radius ?? 0.3);
      if (dist < reach && sameLevel && this.attackCooldown <= 0 && Math.abs(tgt.pos.y - pos.y) < 1.2) {
        if (this.typeName === 'charger') {
          if (this.fuse < 0) {
            this.fuse = 0;
            game.audio.play('charger_fuse', { position: pos, volume: 1 });
          }
        } else {
          this.attackT = 0;
          this.attackHit = false;
          game.audio.play('zombie_attack', { position: pos, volume: 0.8, pitch: this.typeName === 'crusher' ? 0.6 : this.typeName === 'striker' ? 1.3 : this.type.pitch ?? 1 });
        }
      }
      // movement
      const alertedNow = this.alerted && this.alertDelay <= 0;
      speed = alertedNow ? this.type.run : this.type.walk;
      if (this.fuse >= 0) speed = this.type.run * 1.1;
      speed *= this.speedMult;
      if (this.hitSlow > 0) speed *= 0.55;

      if (this.portal) {
        // traversing stairs between levels
        const to = this.portalTo;
        wantX = to.x - pos.x;
        wantZ = to.z - pos.z;
        this.portalT += dt;
        const hd = Math.hypot(wantX, wantZ);
        if ((hd < 0.45 && levelOf(pos.y + 0.3) === to.level) || this.portalT > 8) this.portal = null;
      } else if (sameLevel && this.hasLOS && dist < 12) {
        wantX = tgt.pos.x - pos.x;
        wantZ = tgt.pos.z - pos.z;
      } else {
        const st = ctx.nav.steer(this.level, pos.x, pos.z, _steer);
        if (st) {
          if (st.portal) {
            this.portal = st.portal;
            this.portalTo = st.portalTo;
            this.portalT = 0;
          }
          wantX = st.dirX;
          wantZ = st.dirZ;
        } else if (tgt) {
          wantX = tgt.pos.x - pos.x;
          wantZ = tgt.pos.z - pos.z;
        }
      }
      if (dist < reach * 0.8 && sameLevel) speed *= 0.2;
      // leap (Striker) / pounce (dog)
      const lp = this.type.leap;
      if (lp && alertedNow) {
        this.leapCooldown -= dt;
        if (this.leapCooldown <= 0 && dist < lp.max && dist > lp.min && this.hasLOS && this.body.onGround && sameLevel) {
          this.leapCooldown = rand(lp.cd[0], lp.cd[1]);
          this.body.vel.y = lp.vy;
          this.leapT = lp.t;
          game.audio.play(lp.snd, { position: pos, volume: 1, pitch: lp.pitch });
        }
      }
    }

    // stuck detection → side-step
    this.stuckT += dt;
    if (this.stuckT > 1.2) {
      const moved = _v1.copy(pos).sub(this.lastPos).setY(0).length();
      if (moved < 0.35 && speed > 1 && this.attackT < 0) this.sideStep = 0.6;
      this.lastPos.copy(pos);
      this.stuckT = 0;
    }
    let len = Math.hypot(wantX, wantZ);
    if (len > 1e-4) {
      wantX /= len;
      wantZ /= len;
    }
    if (this.sideStep > 0) {
      this.sideStep -= dt;
      const sx = -wantZ, sz = wantX;
      const s = (this.id % 2 ? 1 : -1);
      wantX = wantX * 0.3 + sx * s;
      wantZ = wantZ * 0.3 + sz * s;
      len = Math.hypot(wantX, wantZ) || 1;
      wantX /= len;
      wantZ /= len;
    }

    // separation from neighbors
    const sep = ctx.separation(this, _v2);
    wantX += sep.x * 1.4;
    wantZ += sep.z * 1.4;

    // face movement / target
    let faceYaw = this.yaw;
    if (this.attackT >= 0 && tgt) faceYaw = Math.atan2(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
    else if (Math.hypot(wantX, wantZ) > 0.1) faceYaw = Math.atan2(wantX, wantZ);
    this.yaw = dampAngle(this.yaw, faceYaw, this.type.turn ?? 9, dt);
    this.root.rotation.y = this.yaw;

    // accelerate toward desired velocity
    const vel = this.body.vel;
    const moveMul = this.attackT >= 0 ? this.type.lunge ?? 0.15 : 1;
    const dvx = wantX * speed * moveMul, dvz = wantZ * speed * moveMul;
    const air = this.body.onGround ? 1 : 0.25;
    const accel = (this.typeName === 'crusher' ? 6 : 12) * air;
    if (this.leapT > 0) {
      this.leapT -= dt;
      vel.x = damp(vel.x, dvx * 1.7, 4, dt);
      vel.z = damp(vel.z, dvz * 1.7, 4, dt);
    } else {
      vel.x = damp(vel.x, dvx, accel, dt);
      vel.z = damp(vel.z, dvz, accel, dt);
    }
    const before = _v3.copy(pos);
    ctx.world.moveBody(this.body, dt);
    // fell out of the world? (shouldn't happen) → respawn guard
    if (pos.y < -20) {
      this.hp = 0;
      this.alive = false;
      this.active = false;
      this.removed = true;
      this.root.visible = false;
      return;
    }
    const mv = Math.hypot(pos.x - before.x, pos.z - before.z) / Math.max(dt, 1e-4);
    this.moveSpeed = damp(this.moveSpeed, mv, 10, dt);
    if (this.extent) this._keepOutOfWalls(dt, ctx.world);

    // footsteps
    const prevPhase = this.phase;
    this.animate(dt);
    if (Math.floor(prevPhase / Math.PI) !== Math.floor(this.phase / Math.PI) && this.moveSpeed > 0.8) {
      if (this.typeName === 'crusher') game.audio.play('crusher_step', { position: pos, volume: 0.8 });
      else if (this.quad) {
        if (Math.random() < 0.3) game.audio.play('zombie_footstep', { position: pos, volume: 0.2, pitch: 1.7 });
      } else if (Math.random() < 0.4) game.audio.play('zombie_footstep', { position: pos, volume: 0.35 });
    }
  }

  /** a long body sticks out of the collision circle: slide the model back / forward off nearby walls */
  _keepOutOfWalls(dt, world) {
    const p = this.pos;
    this.wallT -= dt;
    if (this.wallT <= 0) {
      this.wallT = 0.1;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw), y = p.y + 0.5 * this.scale;
      const { front, rear } = this.extent;
      const f = world.raycast(p.x, y, p.z, s, 0, c, front * this.scale, null, _ray);
      const fr = f ? f.t : front * this.scale;
      const b = world.raycast(p.x, y, p.z, -s, 0, -c, rear * this.scale, null, _ray);
      const br = b ? b.t : rear * this.scale;
      this.wallShift = (Math.min(0, fr - front * this.scale) + Math.max(0, rear * this.scale - br)) / this.scale;
    }
    this.mesh.position.z = damp(this.mesh.position.z, this.wallShift, 12, dt);
  }

  _updateAttack(dt, tgt, dist) {
    const T = this.type.attackTime;
    this.attackT += dt / T;
    const hitAt = this.type.hitAt ?? (this.typeName === 'crusher' ? 0.55 : 0.45);
    if (!this.attackHit && this.attackT >= hitAt) {
      this.attackHit = true;
      if (tgt && tgt.alive && dist < this.type.reach + (tgt.radius ?? 0.3) + 0.45 && Math.abs(tgt.pos.y - this.pos.y) < 1.4) {
        const dmg = this.type.dmg * (this.game.difficultyDamage ?? 1);
        tgt.takeDamage(dmg, this.pos, this);
        this.game.audio.play('impact_flesh', { position: tgt.pos, volume: 0.7 });
        if (this.typeName === 'crusher' && tgt.knockback) {
          _v1.copy(tgt.pos).sub(this.pos).setY(0).normalize().multiplyScalar(7);
          tgt.knockback(_v1.x, 3.5, _v1.z);
        }
      }
    }
    if (this.attackT >= 1) {
      this.attackT = -1;
      this.attackCooldown = this.typeName === 'striker' ? 0.15 : this.quad ? 0.25 : 0.35;
    }
  }

  _updateDead(dt) {
    this.deathT += dt;
    this.corpseT += dt;
    this.body.vel.x = damp(this.body.vel.x, 0, 5, dt);
    this.body.vel.z = damp(this.body.vel.z, 0, 5, dt);
    if (this.deathT < 1.2) this.game.world.moveBody(this.body, dt);
    this.animate(dt);
    const life = this.game.corpseTime ?? 7;
    if (this.corpseT > life) {
      const k = (this.corpseT - life) / 1.5;
      this.root.position.y -= dt * 0.35;
      if (k >= 1) {
        this.active = false;
        this.removed = true;
        this.root.visible = false;
      }
    }
  }

  // ---------------------------------------------------------------- animation
  animate(dt) {
    this._pose(dt);
    if (this.rig) this.rig.sync();
  }

  _pose(dt) {
    const b = this.bones;
    const t = (this.phase2 = (this.phase2 ?? 0) + dt);
    // flinch spring
    this.flinchVel.addScaledVector(this.flinch, -120 * dt);
    this.flinchVel.multiplyScalar(Math.exp(-10 * dt));
    this.flinch.addScaledVector(this.flinchVel, dt);
    // twitches
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchT = rand(0.3, 1.8);
      this.twitch.set(rand(-0.3, 0.3), rand(-0.5, 0.5), rand(-0.3, 0.3));
    }

    if (this.quad) {
      poseDog(this, dt);
      return;
    }
    if (!this.alive) {
      this._animateDeath(dt);
      return;
    }

    const sp = this.moveSpeed;
    const tn = this.typeName;
    const run = clamp((sp - 1.6) / 2.4, 0, 1);
    const strideLen = tn === 'crusher' ? lerp(1.2, 1.7, run) : lerp(0.9, 1.7, run);
    this.phase += dt * (sp / strideLen) * Math.PI;
    const ph = this.phase;
    const s = Math.sin(ph), c = Math.cos(ph);
    const moving = clamp(sp / 0.8, 0, 1);
    const amp = lerp(0.3, 0.75, run) * moving;
    const f = this.flinch;

    // hips
    const bob = Math.abs(c) * (0.02 + run * 0.05) * moving;
    b.hips.position.y = 0.98 - 0.02 - run * 0.07 + bob - (tn === 'crusher' ? 0.03 : 0);
    b.hips.rotation.set(0, s * 0.12 * moving + f.z * 0.2, c * 0.05 * moving + (tn === 'mauler' ? 0.04 : 0));

    // legs
    const limp = tn === 'mauler' && this.id % 3 === 0 ? 0.6 : 1;
    b.thighL.rotation.set(-s * amp - run * 0.15, 0, 0.03);
    b.thighR.rotation.set(s * amp * limp - run * 0.15, 0, -0.03);
    b.shinL.rotation.set(Math.max(0, -c) * amp * 1.5 + 0.08 + run * 0.25, 0, 0);
    b.shinR.rotation.set(Math.max(0, c) * amp * 1.5 * limp + 0.08 + run * 0.25, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.6, 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.6, 0, 0);

    // torso
    const lean = tn === 'striker' ? lerp(0.2, 0.45, run) : tn === 'crusher' ? 0.25 : lerp(0.12, 0.35, run);
    b.spine.rotation.set(lean + f.x * 0.5, -s * 0.12 * moving + f.z * 0.4, 0.04 * Math.sin(t * 0.7));
    b.chest.rotation.set(0.05 + run * 0.08 + f.x * 0.4, -s * 0.08 * moving, 0);
    b.neck.rotation.set(0.15 + (tn === 'striker' ? -0.15 : 0) + f.y * 0.3, this.twitch.y * 0.3, 0);
    b.head.rotation.set(-0.12 + this.twitch.x * 0.3 - f.y * 0.5, this.twitch.y * 0.4, this.headTilt + Math.sin(t * 1.3 + this.id) * 0.08);

    // arms
    if (tn === 'striker') {
      // sprinter-like arm pumping, clawed hands
      const pump = s * lerp(0.4, 1.0, run) * moving;
      b.upperArmL.rotation.set(-0.3 + pump - run * 0.3, 0, -0.18);
      b.upperArmR.rotation.set(-0.3 - pump - run * 0.3, 0, 0.18);
      b.foreArmL.rotation.set(-1.0 - run * 0.4, 0, 0);
      b.foreArmR.rotation.set(-1.0 - run * 0.4, 0, 0);
    } else if (tn === 'crusher') {
      const sw = s * 0.35 * moving;
      b.upperArmL.rotation.set(-0.35 + sw, 0, 0.35);
      b.upperArmR.rotation.set(-0.35 - sw, 0, -0.35);
      b.foreArmL.rotation.set(-0.5, 0, 0);
      b.foreArmR.rotation.set(-0.5, 0, 0);
    } else {
      // classic zombie reach
      const reach = lerp(-1.3, -1.05, run);
      const sw = s * lerp(0.08, 0.3, run) * moving;
      b.upperArmL.rotation.set(reach + sw + Math.sin(t * 2.1 + this.id) * 0.05, 0, -0.12);
      b.upperArmR.rotation.set(reach - sw + Math.sin(t * 1.9 + this.id * 2) * 0.05, 0, 0.12);
      b.foreArmL.rotation.set(-0.25 - Math.sin(t * 1.7) * 0.08, 0, 0);
      b.foreArmR.rotation.set(-0.3 - Math.sin(t * 1.5 + 1) * 0.08, 0, 0);
    }
    b.handL.rotation.set(0.3, 0, 0);
    b.handR.rotation.set(0.3, 0, 0);
    b.shoulderL.rotation.set(0, 0, 0);
    b.shoulderR.rotation.set(0, 0, 0);

    // attack overrides
    if (this.attackT >= 0) {
      const a = this.attackT;
      if (tn === 'crusher') {
        // overhead double-fist slam
        const up = a < 0.5 ? a / 0.5 : 1 - (a - 0.5) / 0.5;
        const slam = a < 0.5 ? 0 : Math.min(1, (a - 0.5) / 0.15);
        const armX = lerp(-0.4, -2.9, up) + slam * 1.2;
        b.upperArmL.rotation.set(armX, 0, 0.2);
        b.upperArmR.rotation.set(armX, 0, -0.2);
        b.foreArmL.rotation.set(-0.6 * up, 0, 0);
        b.foreArmR.rotation.set(-0.6 * up, 0, 0);
        b.spine.rotation.x = lean - 0.25 * up + 0.5 * slam * (1 - up);
      } else {
        // alternating claw swipe
        const wind = a < 0.35 ? a / 0.35 : 0;
        const swing = a >= 0.35 ? Math.min(1, (a - 0.35) / 0.25) : 0;
        const armSide = this.id % 2 ? 'L' : 'R';
        const ua = b['upperArm' + armSide];
        const sx = armSide === 'L' ? 1 : -1;
        ua.rotation.set(lerp(-1.2, -2.6, wind) + swing * 2.1, 0, sx * (0.3 * wind - 0.6 * swing));
        b['foreArm' + armSide].rotation.set(-0.8 * wind - 0.2, 0, 0);
        b.chest.rotation.y = sx * (-0.3 * wind + 0.5 * swing);
        b.spine.rotation.x = lean + 0.2 * swing;
      }
    }
    // hit flinch on arms
    b.upperArmL.rotation.x += f.x * 0.3;
    b.upperArmR.rotation.x += f.x * 0.3;
  }

  _animateDeath(dt) {
    const b = this.bones;
    const T = 0.75;
    const k = Math.min(1, this.deathT / T);
    const e = k * k; // accelerate like falling
    let bounce = 0;
    if (this.deathT > T) {
      const bt = this.deathT - T;
      bounce = Math.exp(-bt * 9) * Math.sin(bt * 22) * 0.08;
    }
    const tilt = (Math.PI / 2) * e - bounce;
    // root pivots around the feet
    this.root.rotation.x = this.fallDir * tilt;
    this.root.rotation.z = this.fallSide * e;
    // lift slightly so the torso rests on the floor instead of intersecting it
    this.deathLift = lerp(this.deathLift ?? 0, 0.13 * this.scale * e, 0.5);
    b.hips.position.y = 0.98;
    // limbs go limp
    const arms = this.deathArms;
    b.spine.rotation.set(-this.fallDir * 0.25 * e, 0, 0);
    b.chest.rotation.set(-this.fallDir * 0.15 * e, 0, 0);
    b.neck.rotation.set(-this.fallDir * 0.4 * e, 0, 0);
    b.head.rotation.set(-this.fallDir * 0.3 * e, 0.5 * e * (this.id % 2 ? 1 : -1), 0.3 * e);
    const armUp = this.fallDir > 0 ? -2.6 : -0.6;
    b.upperArmL.rotation.set(lerp(b.upperArmL.rotation.x, armUp * arms, 0.1), 0, lerp(0, 0.9, e));
    b.upperArmR.rotation.set(lerp(b.upperArmR.rotation.x, armUp * arms * 0.8, 0.1), 0, lerp(0, -1.1, e));
    b.foreArmL.rotation.set(-0.3 * e, 0, 0);
    b.foreArmR.rotation.set(-0.6 * e, 0, 0);
    b.thighL.rotation.set(-0.2 * e, 0, 0.15 * e);
    b.thighR.rotation.set(0.1 * e, 0, -0.2 * e);
    b.shinL.rotation.set(0.5 * e, 0, 0);
    b.shinR.rotation.set(0.2 * e, 0, 0);
    // lift along WORLD up, expressed in the pitched root's local frame
    const a = this.root.rotation.x;
    const L = this.deathLift / this.scale;
    this.mesh.position.set(0, L * Math.cos(a), -L * Math.sin(a));
  }

  // ---------------------------------------------------------------- hit testing
  updateHitParts() {
    for (const p of this.hitParts) {
      p.a.copy(p.off).applyMatrix4(p.bone.matrixWorld);
      if (p.kind === 'capsule') p.b.copy(p.off2).applyMatrix4(p.bone2.matrixWorld);
    }
    this.hipsWorld = this.hipsWorld || new THREE.Vector3();
    this.hipsWorld.setFromMatrixPosition(this.bones.chest.matrixWorld);
  }

  /** Ray test against hit parts. Returns { t, part } or null. */
  raycast(o, d, maxT) {
    if (!this.alive || !this.hipsWorld) return null;
    const h = this.hipsWorld;
    const R = 1.3 * this.scale;
    if (raySphere(o.x, o.y, o.z, d.x, d.y, d.z, h.x, h.y, h.z, R) < 0) return null;
    let bestT = maxT, best = null;
    for (const p of this.hitParts) {
      let t;
      if (p.kind === 'sphere') t = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.a.x, p.a.y, p.a.z, p.r);
      else t = rayCapsule(o, d, p.a, p.b, p.r);
      if (t >= 0 && t < bestT) {
        // head and dynamite take priority when hit nearly at the same depth
        bestT = t;
        best = p;
      }
    }
    return best ? { t: bestT, part: best.name } : null;
  }

  sphereOverlap(c, r) {
    if (!this.hipsWorld) return false;
    return this.hipsWorld.distanceTo(c) < r + 0.6 * this.scale;
  }

  deactivate() {
    this.active = false;
    this.root.visible = false;
  }
}

// ---------------------------------------------------------------- manager
export class ZombieManager {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.pool = { mauler: [], charger: [], striker: [], crusher: [], dog: [] };
    this.list = [];
    this.hash = new Map();
    this.cell = 1.5;
  }

  prewarm(counts = { mauler: 14, charger: 5, striker: 6, crusher: 3, dog: 7 }) {
    for (const [type, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const z = new Zombie(type, this.game);
        z.root.visible = false;
        this.scene.add(z.root);
        this.pool[type].push(z);
      }
    }
  }

  spawn(type, pos, round, hpMult, speedMult) {
    // random free instance, so every body variant shows up even while only a few are alive
    const pool = this.pool[type];
    const start = Math.floor(Math.random() * pool.length);
    let z = null;
    for (let i = 0; i < pool.length && !z; i++) {
      const q = pool[(start + i) % pool.length];
      if (!q.active) z = q;
    }
    if (!z) {
      z = new Zombie(type, this.game);
      this.scene.add(z.root);
      this.pool[type].push(z);
    }
    z.spawn(pos, round, hpMult, speedMult);
    if (!this.list.includes(z)) this.list.push(z);
    return z;
  }

  get aliveCount() {
    let n = 0;
    for (const z of this.list) if (z.alive) n++;
    return n;
  }

  clear() {
    for (const z of this.list) z.deactivate();
    this.list.length = 0;
  }

  _hashKey(x, z) {
    return (Math.floor(x / this.cell) + 1000) * 4096 + (Math.floor(z / this.cell) + 1000);
  }

  _rebuildHash() {
    this.hash.clear();
    for (const z of this.list) {
      if (!z.alive) continue;
      const k = this._hashKey(z.pos.x, z.pos.z);
      let arr = this.hash.get(k);
      if (!arr) this.hash.set(k, (arr = []));
      arr.push(z);
    }
  }

  separation(zb, out) {
    out.set(0, 0, 0);
    const p = zb.pos;
    const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this.hash.get((cx + dx + 1000) * 4096 + (cz + dz + 1000));
        if (!arr) continue;
        for (const o of arr) {
          if (o === zb) continue;
          const ox = p.x - o.pos.x, oz = p.z - o.pos.z;
          if (Math.abs(p.y - o.pos.y) > 1.2) continue;
          const d2 = ox * ox + oz * oz;
          const rr = zb.type.radius + o.type.radius + 0.1;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (rr - d) / rr;
            out.x += (ox / d) * push;
            out.z += (oz / d) * push;
            // hard positional correction to avoid deep overlaps
            const m = (o.type.mass ?? 1) / ((zb.type.mass ?? 1) + (o.type.mass ?? 1));
            p.x += (ox / d) * (rr - d) * 0.5 * m;
            p.z += (oz / d) * (rr - d) * 0.5 * m;
          }
        }
      }
    }
    return out;
  }

  update(dt, ctx) {
    this._rebuildHash();
    ctx.separation = (z, out) => this.separation(z, out);
    for (const z of this.list) z.update(dt, ctx);
    // refresh bone matrices + hit volumes so hitscans this frame are accurate
    for (const z of this.list) {
      if (!z.active) continue;
      z.root.updateMatrixWorld(true);
      if (z.alive) z.updateHitParts();
    }
    // cleanup removed
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].removed) this.list.splice(i, 1);
  }

  /** after scene.updateMatrixWorld: refresh hit volumes */
  postUpdate() {
    for (const z of this.list) if (z.alive) z.updateHitParts();
  }

  /** returns sorted hits [{zombie, t, part}] along the ray up to maxT */
  raycastAll(o, d, maxT) {
    const hits = [];
    for (const z of this.list) {
      if (!z.alive) continue;
      const h = z.raycast(o, d, maxT);
      if (h) hits.push({ zombie: z, t: h.t, part: h.part });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits;
  }

  inRadius(c, r) {
    const out = [];
    for (const z of this.list) {
      if (!z.alive) continue;
      const d = z.pos.distanceTo(c);
      if (d < r + z.type.radius) out.push({ zombie: z, d });
    }
    return out;
  }
}
