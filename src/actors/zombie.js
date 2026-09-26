// The Infected: Mauler (standard; some wear the L4D2 Smoker model), Boomer (type id 'charger':
// explodes, weak spot on the gut), Striker (female, fast), Crusher (tank), Mutant Dog (quadruped
// GLB, packs, pounce + bite; animated by dogAnim.js), Biter (small kid in packs that pounces and latches
// onto your back; a Zombie subclass in biter.js), Stalker (a mutant that haunts the player outside the waves;
// a Zombie subclass in stalker.js). The Crusher's boss moves (ground slam, charge, rage) are in crusher.js.
// AI (alert → chase → attack), procedural animation, hitboxes. The chase:
//   * target: the survivor nearest by PATH (the flow field labels each cell with it), sticky (a new one has
//     to win twice in a row) and spread (a survivor already mobbed sheds zombies to others in the open)
//   * direct chase (leading a moving target a little) only along a walkable straight line on the nav grid
//     (not into window boards, furniture, grilles or barricades), else the string-pulled flow field; from
//     outside the house through the entrance nav/horde.js picked for it (the wave spreads over the doors)
//   * crowd: separation, stepping round the one in front (light ones yield to heavy ones), queueing in
//     doorways; stuck (< 0.3 m in 1 s while trying) → side-step to the roomier side, grid-only steering,
//     then a different route
//   * stairs / portals (_portalMove): turn round when the target goes back, go straight for a target on
//     the flight; `portalWait` (ladders.js) queues at portalTo
import * as THREE from 'three';
import { createCharacter } from './rig.js';
import { poseDog, resetDog } from './dogAnim.js';
import { RagdollSystem } from './ragdoll.js';
import { clamp, lerp, damp, dampAngle, rand, rayCapsule, raySphere, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';

// walk/run of the original four are 90 % of their first tuning; the dog is 110 % of the old mauler.
// Optional: leap {min, max distance, vy, t, cd: [min, max], snd, pitch}, turn (yaw rate), height
// (collision), eye (LOS height), pitch (voice), lunge (move factor while attacking), hitAt.
export const ZOMBIE_TYPES = {
  // body kinds cycle per instance: 3 of 9 maulers are the zombie woman, 2 the Smoker GLB, 2 the gas-mask GLB, 2 the plain zombie
  mauler: { name: 'Mauler', body: ['woman', 'smoker', 'normal', 'gasmask', 'woman', 'normal', 'smoker', 'woman', 'gasmask'], hp: 150, walk: 1.125, run: 3.87, dmg: 11, reach: 1.25, attackTime: 1.0, radius: 0.32, scale: 1.0, score: 100, mass: 1 },
  // a Mauler in a hard hat, a step slower; helmet: the share of headshots that glance off it (game.hitscan)
  worker: { name: 'Worker', body: ['worker'], hp: 150, walk: 0.96, run: 3.3, dmg: 11, reach: 1.25, attackTime: 1.0, radius: 0.32, scale: 1.0, score: 110, mass: 1.05, helmet: 0.45 },
  // rare: a survivalist who didn't make it, a little tougher; loot: it drops something useful (game.onZombieKilled)
  survivor: { name: 'Survivalist', body: ['survivor'], hp: 190, walk: 1.1, run: 3.7, dmg: 12, reach: 1.25, attackTime: 1.0, radius: 0.34, scale: 1.0, score: 250, mass: 1.1, loot: true },
  charger: { name: 'Boomer', body: ['boomer'], hp: 110, walk: 1.35, run: 4.5, dmg: 0, reach: 1.9, attackTime: 0.9, radius: 0.32, scale: 1.0, score: 150, mass: 1, explodes: true },
  striker: { name: 'Striker', body: ['bomber'], hp: 170, walk: 1.53, run: 5.31, dmg: 13, reach: 1.25, attackTime: 0.7, radius: 0.3, scale: 0.97, score: 200, mass: 0.8, leap: { min: 2.5, max: 6.5, vy: 5.2, t: 0.6, cd: [3, 5], snd: 'striker_shriek', pitch: 1.1 } },
  // the boss (crusher.js: the Crusher class with its slam, charge and rage). partMult: its armoured skull takes
  // headshots x1.5 instead of PART_MULT's x4; blast: share of explosion damage (game.explode); more hp per
  // fireteam member (CRUSHER.team)
  crusher: { name: 'Crusher', body: ['tank'], hp: 2800, walk: 1.35, run: 2.52, dmg: 34, reach: 1.9, attackTime: 1.5, radius: 0.55, scale: 1.4, score: 800, mass: 4, turn: 4, partMult: { head: 1.5 }, blast: 0.6 },
  dog: { name: 'Mutant Dog', body: ['dog'], hp: 90, walk: 1.375, run: 4.73, dmg: 8, reach: 1.1, attackTime: 0.55, radius: 0.36, scale: 1.0, score: 120, mass: 0.7, turn: 14, height: 1.0, eye: 0.75, pitch: 1.55, lunge: 0.6, hitAt: 0.5, leap: { min: 1.8, max: 4.5, vy: 3.4, t: 0.45, cd: [2.2, 3.8], snd: 'zombie_attack', pitch: 1.6 } },
  // small feral kid in packs: ~42 % of a Mauler's hp, 1.3x its run; pounces and latches on (biter.js: the
  // Biter class, its AI, pose and the latch). dmg / reach are its claw swipe when it can't pounce.
  // claws: false — it doesn't claw at barricades (nav/horde.js routes it round them)
  biter: { name: 'Biter', claws: false, body: ['biter'], hp: 62, walk: 1.7, run: 5.0, dmg: 6, reach: 0.85, attackTime: 0.5, radius: 0.24, scale: 1.0, score: 150, mass: 0.45, turn: 16, height: 1.0, eye: 0.8, pitch: 1.75, lunge: 0.5, hitAt: 0.45 },
  // the gaunt mutant that haunts the fireteam (stalker.js: the Stalker class, its director and its poses; speeds
  // and damage live in STALKER there). haunt: no part of a wave, so the round's end, the enemy count and the
  // radar skip it
  stalker: { name: 'Stalker', claws: false, haunt: true, body: ['stalker'], hp: 220, walk: 1.2, run: 9.4, dmg: 26, reach: 1.1, attackTime: 0.6, radius: 0.3, scale: 1.0, score: 600, mass: 1.6, turn: 12, height: 1.9, eye: 1.75, pitch: 0.8 },
};
// type name -> Zombie subclass (a module that defines one registers it here, e.g. biter.js)
export const ZOMBIE_CLASSES = {};

export const PART_MULT = { head: 4.0, torso: 1.0, pelvis: 0.9, arm: 0.7, leg: 0.7, dynamite: 1.0, belly: 1.0 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };
const _ray = {};
const _want = { x: 0, z: 0 };
const _av = { x: 0, z: 0, lx: 0, lz: 0, slow: 1 };
const _sopts = { need: 1 };
const LIVID = new THREE.Color(0x6e2233); // engorged skin, bruised purple-red

/** Per-instance GLB skin (GLB_BODIES glow): k = how livid (the Boomer's swell), glow = emissive intensity. */
function flushSkin(mats, k, glow) {
  for (const m of mats) {
    const base = (m.userData.baseColor ??= m.color.clone());
    m.color.copy(base).lerp(LIVID, k);
    m.emissiveIntensity = glow;
  }
}
export const DIRECT_MAX = 18; // m: straight chase along a clear walkable line up to this far

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
    this.bodyName = bodies[n % bodies.length];
    const char = createCharacter(this.bodyName, this.type.scale);
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
    this.ragdoll = null; // ragdoll.js: set while the corpse is (or was) thrown as a ragdoll
    this.lastPart = null;
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
    this.barricade = null; // the barricade this attack claws at (world/barricades.js)
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
    this.sideDir = this.id % 2 ? 1 : -1;
    this.lastPos = pos.clone();
    // pathing (see the header)
    this.need = this.type.radius > 0.4 ? 2 : 1; // grid clearance a straight line needs (the Crusher: 2 cells)
    this.canDirect = false;
    this.direct = false;
    this.leadK = 0;
    this.tgtT = 0;
    this.nextTgt = null;
    this.route = null;
    this.goal = null; // a spot to reach instead of a survivor (the wall-breaching Boomer, world/breach.js)
    this.routeT = Math.random() * 0.5;
    this.routeBias = null;
    this.routePenalty = null;
    this.wpT = 0;
    this.wpx = pos.x;
    this.wpz = pos.z;
    this.steerOk = false;
    this.portalFrom = null;
    this.portalWait = false;
    this.portalChk = 0;
    this.portalDist = null;
    this.stuck = 0;
    this.noDirectT = 0;
    this.rawT = 0;
    this.crowd = 0;
    this.feelT = 0;
    this.feelX = 0;
    this.feelZ = 0;
    this.trail = (this.trail ?? new Float32Array(8)).fill(0);
    this.trailI = 0;
    this.trailN = 0;
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
    if (this.glow) flushSkin(this.glow, 0, 0);
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
    this.lastPart = part;
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
    if (this.glow) flushSkin(this.glow, 0, 0);
    // some kills (most blasts) throw the body as a ragdoll instead of the fall below; it's dead either way.
    // Shot off a ladder (actors/ladders.js): always a ragdoll fall
    const fell = this.climb && this.game.ladders?.drop(this);
    this.game.zombies?.ragdolls?.[fell ? 'start' : 'tryStart'](this, dir, source, opts);
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

    // target: the survivor nearest by path, sticky and spread over the team
    const tgt = this._pickTarget(dt, ctx);
    const dist = tgt ? Math.sqrt(tgt.pos.distanceToSquared(pos)) : Infinity;
    const sameLevel = tgt && tgt.level === this.level;

    // senses (throttled): eye-level LOS (alert, leaps) and a walkable straight line (direct chase)
    if (this._senses(dt, ctx, tgt, dist, sameLevel, 1.3) && !this.alerted && this.hasLOS && dist < 24) this._alert(rand(0.1, 0.6));
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
        // GLB Boomer: the skin goes livid and throbs with the blood showing through, it swells up to burst
        // and dribbles bile and blood
        const u = Math.min(1, this.fuse / 0.85), throb = Math.sin(this.fuse * 26);
        flushSkin(this.glow, u * (0.65 + 0.2 * throb), u * (0.12 + 0.1 * throb));
        this.root.scale.setScalar(this.scale * this.sizeVar * (1 + u * u * 0.16 + throb * 0.02 * u));
        if (Math.random() < 0.6) {
          const h = this.bones.head.getWorldPosition(_v1);
          const fx = Math.sin(this.yaw) * 0.12, fz = Math.cos(this.yaw) * 0.12;
          this.game.fx.blood.emit(h.x + fx, h.y - 0.1, h.z + fz, fx * 4 + rand(-0.3, 0.3), rand(-0.4, 0.5), fz * 4 + rand(-0.3, 0.3), {
            life: rand(0.4, 0.7), size: rand(0.02, 0.045), gravity: 9.8, drag: 1, color: Math.random() < 0.5 ? [0.09, 0.1, 0.018] : [0.16, 0.01, 0.008], alpha: 1,
          });
        }
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
            game.audio.play(this.glow ? 'boomer_swell' : 'charger_fuse', { position: pos, volume: 1 }); // (the dynamite fallback beeps)
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

      const w = this._moveWant(dt, ctx, tgt, dist, sameLevel);
      wantX = w.x;
      wantZ = w.z;
      if (dist < reach * 0.8 && sameLevel) speed *= 0.2;
      // an intact barricade in the way (world/barricades.js) gets clawed down first
      if (this.attackT < 0 && this.attackCooldown <= 0) game.barricades?.engage(this, wantX, wantZ);
      // leap (Striker) / pounce (dog)
      const lp = this.type.leap;
      if (lp && alertedNow) {
        this.leapCooldown -= dt;
        if (this.leapCooldown <= 0 && dist < lp.max && dist > lp.min && this.hasLOS && this.canDirect && !this.portal && this.body.onGround && sameLevel) {
          this.leapCooldown = rand(lp.cd[0], lp.cd[1]);
          this.body.vel.y = lp.vy;
          this.leapT = lp.t;
          game.audio.play(lp.snd, { position: pos, volume: 1, pitch: lp.pitch });
        }
      }
    }

    // stuck → recovery (side-step to the roomier side, grid-only steering, another route)
    const len = Math.hypot(wantX, wantZ);
    _want.x = len > 1e-4 ? wantX / len : 0;
    _want.z = len > 1e-4 ? wantZ / len : 0;
    const near = !!tgt && sameLevel && dist < this.type.reach + (tgt.radius ?? 0.3) + 0.4;
    this._unstick(dt, ctx, speed, _want, near);
    if (speed > 0.5 && this.attackT < 0) this._wallAvoid(dt, ctx, _want);
    wantX = _want.x;
    wantZ = _want.z;

    // crowd: separation, stepping round the one in front, queueing behind slower ones
    const av = ctx.avoid ? ctx.avoid(this, wantX, wantZ, _av) : ctx.separation(this, _av);
    wantX += av.x * 1.4 + (av.lx ?? 0);
    wantZ += av.z * 1.4 + (av.lz ?? 0);
    if (!near) speed *= av.slow ?? 1;

    // face movement / target
    let faceYaw = this.yaw;
    if (this.attackT >= 0 && this.barricade) faceYaw = game.barricades.faceYaw(this.barricade, pos);
    else if (this.attackT >= 0 && tgt) faceYaw = Math.atan2(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
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

  // ---------------------------------------------------------------- pathing
  /** the survivor to go for: nearest by path, sticky (a new one wins two looks in a row), spread */
  _pickTarget(dt, ctx) {
    const pos = this.pos;
    if (this.goal) {
      if (!this.goal.spot?.broken) return (this.target = this.goal);
      this.goal = null;
    }
    let cur = this.target;
    if (cur?.isGoal) cur = this.target = null;
    if (cur && (!cur.alive || !ctx.team.includes(cur))) cur = this.target = null;
    if ((this.tgtT -= dt) > 0 && cur) return cur;
    this.tgtT = 0.3 + Math.random() * 0.2;
    // nearest by path: the flow field labels every cell with the survivor it leads to
    let best = ctx.nav.ownerAt?.(this.level, pos.x, pos.z) ?? null;
    if (!best || !best.alive || !ctx.team.includes(best)) {
      // off the grid: nearest in a straight line, another floor counts 20 m extra
      best = null;
      let bd = Infinity;
      for (const m of ctx.team) {
        if (!m.alive) continue;
        let d = m.pos.distanceToSquared(pos);
        if (m.level !== this.level) d += 400;
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
    }
    if (best && ctx.horde) best = ctx.horde.balance(this, best, ctx.team);
    // sticky: keep clawing the one in reach; otherwise a new target has to win twice in a row, unless
    // the old one left this floor for another
    let pick = best;
    if (cur && best && best !== cur) {
      const inReach = cur.level === this.level && Math.hypot(cur.pos.x - pos.x, cur.pos.z - pos.z) < this.type.reach + 0.9;
      const leftFloor = cur.level !== this.level && best.level === this.level;
      if (inReach || (!leftFloor && this.nextTgt !== best)) {
        this.nextTgt = inReach ? null : best;
        pick = cur;
      } else this.nextTgt = null;
    } else this.nextTgt = null;
    this.target = pick;
    return pick;
  }

  /**
   * Throttled senses: eye-level line of sight (alerting, leaps) and whether a straight walkable line on
   * the grid reaches the target (the direct chase), plus how far to lead it. True on the frames it looked.
   */
  _senses(dt, ctx, tgt, dist, sameLevel, eyeTo = 1.3) {
    this.losT -= dt;
    if (this.losT > 0 || !tgt) return false;
    this.losT = 0.2 + Math.random() * 0.12;
    const pos = this.pos, nav = ctx.nav, tp = tgt.pos;
    this.hasLOS = sameLevel && dist < 28 && ctx.world.lineOfSight(pos.x, pos.y + (this.type.eye ?? 1.5) * this.scale, pos.z, tp.x, tp.y + eyeTo, tp.z);
    this.canDirect = !!sameLevel && dist < DIRECT_MAX && (!nav.lineClear || nav.lineClear(this.level, pos.x, pos.z, tp.x, tp.z, this.need, nav.dist, nav.cost));
    // intercept: aim a little ahead of a moving target (only where that point is in the clear too)
    this.leadK = 0;
    const tv = tgt.body?.vel;
    if (this.canDirect && tv && dist > 1.8 && Math.abs(tv.x) + Math.abs(tv.z) > 0.6) {
      const k = Math.min(0.9, dist / Math.max(2.5, this.type.run * (this.speedMult ?? 1))) * 0.55;
      if (nav.lineClear(this.level, pos.x, pos.z, tp.x + tv.x * k, tp.z + tv.z * k, this.need, nav.dist, nav.cost)) this.leadK = k;
    }
    return true;
  }

  /** where to head this frame (unnormalized): a portal, the target itself, or the flow field */
  _moveWant(dt, ctx, tgt, dist, sameLevel) {
    const w = _want, pos = this.pos;
    w.x = 0;
    w.z = 0;
    this.direct = false;
    this.noDirectT -= dt;
    this.rawT -= dt;
    if (this.portal) {
      this._portalMove(dt, ctx, tgt, dist, w);
      return w;
    }
    if (tgt && sameLevel && this.canDirect && dist < DIRECT_MAX && this.noDirectT <= 0) {
      this.direct = true;
      this.route = null;
      const tv = tgt.body?.vel;
      const k = tv ? this.leadK : 0;
      w.x = tgt.pos.x + (k ? tv.x * k : 0) - pos.x;
      w.z = tgt.pos.z + (k ? tv.z * k : 0) - pos.z;
      return w;
    }
    this._fieldWant(dt, ctx, w);
    if (!this.steerOk && tgt) {
      // off the grid / no path: head straight for it
      w.x = tgt.pos.x - pos.x;
      w.z = tgt.pos.z - pos.z;
    }
    return w;
  }

  /** follow the flow field (the entrance route while outside, else the main field) via a cached waypoint */
  _fieldWant(dt, ctx, w) {
    const pos = this.pos, nav = ctx.nav, horde = ctx.horde;
    if (horde && this.alerted && !this.goal) {
      if (this.route && horde.arrived(this)) {
        this.route = null;
        this.wpT = 0;
      }
      if ((this.routeT -= dt) <= 0) {
        this.routeT = rand(2, 3);
        const r = horde.pickRoute(this);
        if (r !== this.route) {
          this.route = r;
          this.wpT = 0;
        }
      }
    }
    // waypoint: the farthest cell of the route ahead in a clear straight line, refreshed every ~0.12 s
    this.wpT -= dt;
    const dw = Math.hypot(this.wpx - pos.x, this.wpz - pos.z);
    if (this.wpT <= 0 || (dw < 0.35 && this.wpT < 0.07)) {
      this.wpT = 0.1 + Math.random() * 0.05;
      _sopts.need = this.need;
      // a goal's own field, else the entrance route's (null right after a reset), else the main field
      const field = this.goal?.field ?? (this.route ? horde.fieldFor(this.route) : null);
      const st = field ? field.steer(this.level, pos.x, pos.z, _steer, _sopts) : nav.steer(this.level, pos.x, pos.z, _steer, null, _sopts);
      this.steerOk = !!st;
      if (st) {
        if (st.portal) {
          const p = st.portal;
          this.portal = p;
          this.portalTo = st.portalTo;
          this.portalFrom = st.portalTo === p.a ? p.b : p.a;
          this.portalT = 0;
          this.portalChk = 0.5;
          this.portalDist = field ? field.dist : null;
        }
        const raw = this.rawT > 0 && !st.portal;
        this.wpx = raw ? st.fx : st.wx;
        this.wpz = raw ? st.fz : st.wz;
      } else {
        this.wpx = pos.x;
        this.wpz = pos.z;
      }
    }
    w.x = this.wpx - pos.x;
    w.z = this.wpz - pos.z;
  }

  /**
   * Walking a portal (stairs) from portalFrom to portalTo. Goes straight for a target on the flight,
   * turns round when the far end stopped being the way. `portalWait` (ladders.js): walk to portalTo and
   * wait there (never cleared on arrival, no timeout; cleared here too when the portal isn't the way).
   */
  _portalMove(dt, ctx, tgt, dist, w) {
    const pos = this.pos, p = this.portal, to = this.portalTo;
    this.portalT += dt;
    if (tgt && !this.portalWait) {
      // someone right here, or on this flight: go for them
      let on = dist < 2.2 && Math.abs(tgt.pos.y - pos.y) < 1.1;
      if (!on && p.a && p.b) {
        const vx = p.b.x - p.a.x, vz = p.b.z - p.a.z, L2 = vx * vx + vz * vz;
        const t = L2 > 1e-6 ? ((tgt.pos.x - p.a.x) * vx + (tgt.pos.z - p.a.z) * vz) / L2 : -1;
        on = t > 0.02 && t < 0.98 && Math.hypot(p.a.x + vx * t - tgt.pos.x, p.a.z + vz * t - tgt.pos.z) < 0.9;
      }
      if (on) {
        w.x = tgt.pos.x - pos.x;
        w.z = tgt.pos.z - pos.z;
        return;
      }
    }
    // the far end no longer the way (the target came back)? turn round / leave the queue
    if ((this.portalChk -= dt) <= 0 && this.portalFrom) {
      this.portalChk = 0.5;
      const D = this.portalDist ?? ctx.nav.dist;
      const fromA = this.portalFrom === p.a;
      const dFrom = D[fromA ? p.ia : p.ib], dTo = D[fromA ? p.ib : p.ia];
      if (dFrom + 2 < dTo) {
        this.wpT = 0;
        if (this.portalWait) {
          this.portal = null;
          this.portalWait = false;
          return;
        }
        const back = this.portalFrom;
        this.portalFrom = fromA ? p.b : p.a;
        this.portalTo = back;
        this.portalT = 0;
      }
    }
    const t2 = this.portalTo;
    w.x = t2.x - pos.x;
    w.z = t2.z - pos.z;
    const hd = Math.hypot(w.x, w.z);
    if (this.portalWait) {
      if (hd < 0.3) w.x = w.z = 0;
      return;
    }
    if ((hd < 0.45 && levelOf(pos.y + 0.3) === t2.level) || this.portalT > 8) {
      this.portal = null;
      this.wpT = 0;
    }
  }

  /**
   * Stuck detection (< 0.3 m in the last second while trying to move, not just queueing in a crowd) and
   * recovery; applies an active side-step to the unit direction `w`.
   */
  _unstick(dt, ctx, speed, w, near) {
    const pos = this.pos;
    if ((this.stuckT += dt) >= 0.25) {
      this.stuckT = 0;
      const tr = this.trail, k = this.trailI * 2;
      const moved = Math.hypot(pos.x - tr[k], pos.z - tr[k + 1]); // vs 1 s ago
      tr[k] = pos.x;
      tr[k + 1] = pos.z;
      this.trailI = (this.trailI + 1) % 4;
      this.trailN++;
      const trying = speed > 1 && this.attackT < 0 && !near && !this.portalWait && this.trailN > 4 && (w.x !== 0 || w.z !== 0) && this.sideStep <= 0;
      if (trying && moved < 0.3 && !(this.crowd > 0 && !this.body.blocked)) this._recover(ctx, w);
      else if (moved > 0.9) this.stuck = 0;
    }
    if (this.sideStep > 0) {
      this.sideStep -= dt;
      const s = this.sideDir;
      let x = w.x * 0.3 - w.z * s, z = w.z * 0.3 + w.x * s;
      const l = Math.hypot(x, z) || 1;
      w.x = x / l;
      w.z = z / l;
    }
  }

  /**
   * Keep a hand's breadth off walls, jambs and furniture while passing them: a push away from any
   * collider within radius + FEEL (sampled every ~0.1 s), with the part against the heading dropped so
   * it only ever steers sideways, never stops it.
   */
  _wallAvoid(dt, ctx, w) {
    const FEEL = 0.24;
    if ((this.feelT = (this.feelT ?? 0) - dt) <= 0) {
      this.feelT = 0.08 + Math.random() * 0.04;
      const p = this.pos, b = this.body;
      const r = b.radius + FEEL;
      const lo = p.y + b.stepHeight, hi = p.y + b.height;
      let fx = 0, fz = 0;
      ctx.world.query(p.x - r, p.z - r, p.x + r, p.z + r, (bx) => {
        if (bx.maxY <= lo || bx.minY >= hi) return;
        const cx = p.x < bx.minX ? bx.minX : p.x > bx.maxX ? bx.maxX : p.x;
        const cz = p.z < bx.minZ ? bx.minZ : p.z > bx.maxZ ? bx.maxZ : p.z;
        const dx = p.x - cx, dz = p.z - cz;
        const d = Math.hypot(dx, dz);
        if (d >= r || d < 1e-4) return;
        const k = Math.min(1, (r - d) / FEEL);
        fx += (dx / d) * k;
        fz += (dz / d) * k;
      });
      this.feelX = fx;
      this.feelZ = fz;
    }
    let fx = this.feelX, fz = this.feelZ;
    if (!fx && !fz) return;
    const along = fx * w.x + fz * w.z;
    fx -= w.x * along;
    fz -= w.z * along;
    const x = w.x + fx * 0.7, z = w.z + fz * 0.7;
    const l = Math.hypot(x, z) || 1;
    w.x = x / l;
    w.z = z / l;
  }

  _recover(ctx, w) {
    const nav = ctx.nav, pos = this.pos;
    this.stuck++;
    this.stuckEvents = (this.stuckEvents ?? 0) + 1;
    this.noDirectT = 1.5; // back to the grid for a bit
    this.wpT = 0;
    // side-step toward the side with more room (first time), then the other way
    const room = (s) => {
      const i = nav.index(this.level, pos.x - w.z * s * 0.8, pos.z + w.x * s * 0.8);
      return i >= 0 && nav.walk[i] ? nav.clear[i] : 0;
    };
    this.sideDir = this.stuck % 2 === 1 ? (room(1) >= room(-1) ? 1 : -1) : -this.sideDir;
    this.sideStep = 0.3 + 0.12 * Math.min(this.stuck, 3);
    if (this.stuck >= 2) this.rawT = 1.5; // step cell by cell, no smoothing
    if (this.stuck >= 3 && this.route) {
      // this way in is jammed: try another one
      (this.routePenalty ??= {})[this.route.id] = (this.routePenalty[this.route.id] ?? 0) + 20;
      this.route = null;
      this.routeT = 0;
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
      if (this.barricade) this.game.barricades?.hit(this.barricade, this);
      else if (tgt && tgt.alive && dist < this.type.reach + (tgt.radius ?? 0.3) + 0.45 && Math.abs(tgt.pos.y - this.pos.y) < 1.4) {
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
      this.barricade = null;
      this.attackCooldown = this.typeName === 'striker' ? 0.15 : this.quad ? 0.25 : 0.35;
    }
  }

  _updateDead(dt) {
    this.deathT += dt;
    this.corpseT += dt;
    if (!this.ragdoll) {
      // canned fall (a ragdoll poses the skeleton itself, see ZombieManager.update)
      this.body.vel.x = damp(this.body.vel.x, 0, 5, dt);
      this.body.vel.z = damp(this.body.vel.z, 0, 5, dt);
      if (this.deathT < 1.2) this.game.world.moveBody(this.body, dt);
      this.animate(dt);
    }
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
    const plain = tn === 'mauler' || tn === 'worker' || tn === 'survivor'; // the shambling rank and file
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
    b.hips.rotation.set(0, s * 0.12 * moving + f.z * 0.2, c * 0.05 * moving + (plain ? 0.04 : 0));

    // legs
    const limp = plain && this.id % 3 === 0 ? 0.6 : 1;
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
    this.pool = { mauler: [], worker: [], survivor: [], charger: [], striker: [], crusher: [], dog: [], biter: [], stalker: [] };
    this.list = [];
    this.hash = new Map();
    this.cell = 1.5;
    this.ragdolls = new RagdollSystem(game);
  }

  _make(type) {
    return new (ZOMBIE_CLASSES[type] ?? Zombie)(type, this.game);
  }

  prewarm(counts = { mauler: 14, worker: 4, survivor: 1, charger: 5, striker: 6, crusher: 3, dog: 7, biter: 8, stalker: 1 }) {
    for (const [type, n] of Object.entries(counts)) {
      for (let i = 0; i < n; i++) {
        const z = this._make(type);
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
      z = this._make(type);
      this.scene.add(z.root);
      this.pool[type].push(z);
    }
    z.spawn(pos, round, hpMult, speedMult);
    if (!this.list.includes(z)) this.list.push(z);
    return z;
  }

  /** the wave still on its feet (the haunting Stalker doesn't count) */
  get aliveCount() {
    let n = 0;
    for (const z of this.list) if (z.alive && !z.type.haunt) n++;
    return n;
  }

  clear() {
    for (const z of this.list) z.deactivate();
    this.list.length = 0;
    this.ragdolls.clear();
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
    out.x = 0;
    out.y = 0;
    out.z = 0;
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

  /**
   * Crowd steering for `zb` heading along (wx, wz): out.x/z = separation (and a hard positional fix of
   * overlaps, heavier bodies shove lighter ones), out.lx/lz = a side-step round the ones in front (light
   * ones yield to heavy ones, smaller in tight spots), out.slow = queueing behind a slower one going our
   * way. Sets zb.crowd (how many it is queueing behind).
   */
  avoid(zb, wx, wz, out, nav) {
    this.separation(zb, out);
    out.lx = 0;
    out.lz = 0;
    out.slow = 1;
    let crowd = 0;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) {
      const ux = wx / wl, uz = wz / wl;
      const p = zb.pos, rz = zb.type.radius, mz = zb.type.mass ?? 1;
      const my = Math.max(0.5, zb.moveSpeed);
      const ci = nav ? nav.index(zb.level, p.x, p.z) : -1;
      const room = ci >= 0 ? nav.clear[ci] : 3; // 1: next to a wall / in a doorway
      const cx = Math.floor(p.x / this.cell), cz = Math.floor(p.z / this.cell);
      let lx = 0, lz = 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const arr = this.hash.get((cx + dx + 1000) * 4096 + (cz + dz + 1000));
          if (!arr) continue;
          for (const o of arr) {
            if (o === zb || !o.alive || Math.abs(p.y - o.pos.y) > 1.2) continue;
            const rx = o.pos.x - p.x, rzz = o.pos.z - p.z; // me → o
            const ro = o.type.radius;
            const d = Math.hypot(rx, rzz);
            if (d < 1e-3 || d > rz + ro + 1.1) continue;
            const ahead = (rx * ux + rzz * uz) / d;
            if (ahead < 0.3) continue;
            const close = 1 - Math.min(1, Math.max(0, d - rz - ro) / 1.1);
            const mo = o.type.mass ?? 1;
            // step round it on the side it isn't on (light ones step aside for heavy ones)
            const s = ux * rzz - uz * rx > 0 ? -1 : 1;
            const k = close * ahead * (2 * mo) / (mo + mz);
            lx += -uz * s * k;
            lz += ux * s * k;
            // someone (nearly) stopped right in front of us, going nowhere our way: wait behind it, don't
            // shove (a door, a barricade being clawed at, the ring round a survivor). In the open a
            // walker is overtaken instead; the light, nimble ones (dogs, Biters) weave past anything
            const along = o.body.vel.x * ux + o.body.vel.z * uz;
            if (close > 0.3 && along < Math.min(1.2, my * 0.8)) {
              if (close > 0.5 && ahead > 0.5) crowd++;
              if (mz >= 0.8 && ro >= rz * 0.8) out.slow = Math.min(out.slow, 1 - (room >= 3 ? 0.3 : 0.65) * close * ahead);
            }
          }
        }
      }
      if (lx || lz) {
        // tight spot (a doorway): barely sideways, or it steers into the frame
        const f = room >= 3 ? 1 : room === 2 ? 0.55 : 0.2;
        out.lx = lx * f;
        out.lz = lz * f;
      }
    }
    zb.crowd = crowd;
    return out;
  }

  update(dt, ctx) {
    this._rebuildHash();
    ctx.separation = (this._sepFn ??= (z, out) => this.separation(z, out));
    ctx.avoid = (this._avoidFn ??= (z, wx, wz, out) => this.avoid(z, wx, wz, out, this.game.nav));
    ctx.horde?.update(this.list);
    const ladders = this.game.ladders; // actors/ladders.js: climbing zombies are driven by it
    for (const z of this.list) {
      if (z.climb && ladders?.updateZombie(z, dt, ctx)) continue;
      z.update(dt, ctx);
      if (z.portal?.ladder && !z.climb && z.alive) ladders?.tryMount(z, ctx);
    }
    this.ragdolls.update(dt, ctx.world);
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
