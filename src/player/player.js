// First-person player controller: mouse look, run/sprint/crouch/jump, step-up smoothing,
// footsteps by surface, recoil, damage (HP + AP), knockback, death camera.
import * as THREE from 'three';
import { clamp, damp } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { SURF } from '../world/collision.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();

export class Player {
  constructor(game, camera) {
    this.game = game;
    this.camera = camera;
    this.camera.rotation.order = 'YXZ';
    this.name = 'You';
    this.isPlayer = true;
    this.body = {
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      radius: 0.32,
      height: 1.75,
      stepHeight: 0.52,
      onGround: true,
      gravity: 18,
    };
    this.radius = 0.32;
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0; // recoil offset on top of the aim (rad), springs back once the gun rests
    this.recoilYaw = 0;
    this.recoilT = 1; // seconds since the last shot
    this.punchFov = 0; // aim-neutral camera punch: FOV widen fraction + roll (rad)
    this.punchRoll = 0;
    this.noSprint = false; // set by the weapons: firing / ADS breaks the sprint
    this.bobAmt = 0;
    this.eye = 1.62;
    this.eyeOffset = 0;
    this.crouching = false;
    this.hp = 100;
    this.ap = 100;
    this.maxHp = 100;
    this.alive = true;
    this.level = 1;
    this.stepDist = 0;
    this.bob = 0;
    this.deadT = 0;
    this.horizontalSpeed = 0;
    this.localVelX = 0;
    this.damageFlash = 0;
    this.gasT = 0;
    this.inGas = 0;
    this.stats = { kills: 0, deaths: 0, headshots: 0, score: 0 };
    this.lastY = 0;
    this.flashlight = false;
    this.latchedBy = null; // a Biter clinging to your back (biter.js): slower, no sprint, no ADS
    this.climbing = null; // on a ladder (actors/ladders.js)
    this.ladderCd = 0;
  }

  get pos() {
    return this.body.pos;
  }

  spawn(pos, yaw = Math.PI) {
    this.body.pos.copy(pos);
    this.body.vel.set(0, 0, 0);
    this.body.onGround = true;
    this.yaw = yaw;
    this.pitch = 0;
    this.hp = 100;
    this.ap = 100;
    this.alive = true;
    this.deadT = 0;
    this.crouching = false;
    this.eye = 1.62;
    this.eyeOffset = 0;
    this.lastY = pos.y;
    this.gasT = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.punchFov = 0;
    this.punchRoll = 0;
    this.latchedBy = null;
    this.climbing = null;
    this.ladderCd = 0;
  }

  /**
   * One shot: the aim kicks instantly (vDeg up, hDeg sideways) and the camera gets a punch that
   * leaves the crosshair where it is (FOV widen + roll). Applied to the camera right away, so the
   * kick lands on the same frame as the shot.
   */
  addRecoil(vDeg, hDeg, kick = 1) {
    this.recoilPitch += vDeg * DEG;
    this.recoilYaw += hDeg * DEG;
    this.recoilT = 0;
    this.punchFov = Math.min(0.045, this.punchFov + 0.007 * kick);
    this.punchRoll += (Math.random() * 2 - 1) * 0.005 * kick;
    this._applyCamera();
  }

  knockback(x, y, z) {
    this.body.vel.x += x;
    this.body.vel.y = Math.max(this.body.vel.y, y);
    this.body.vel.z += z;
    this.body.onGround = false;
  }

  takeDamage(amount, fromPos, source, opts = {}) {
    if (!this.alive || this.game.godMode || this.invulnT > 0) return; // invulnT: just revived (game/revive.js)
    let dmg = amount;
    if (!opts.ignoreArmor && this.ap > 0) {
      const absorbed = Math.min(this.ap, dmg * 0.5);
      this.ap -= absorbed;
      dmg -= absorbed;
    }
    this.hp -= dmg;
    // opts.quiet: steady damage ticks (a Biter's bites) skip the grunt and flash only lightly
    this.damageFlash = Math.min(1, this.damageFlash + (opts.quiet ? 0.12 : 0.35) + amount / 60);
    if (fromPos) {
      const a = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
      // relative to view: 0 = in front
      let rel = a - (this.yaw + Math.PI);
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      this.game.hud?.damage(-rel, amount);
    }
    this.game.shake.add(Math.min(0.5, amount / 50));
    if (!opts.quiet && Math.random() < 0.7) this.game.audio.play('player_hurt', { volume: 0.8 });
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.deadT = 0;
      this.stats.deaths++;
      this.game.onPlayerDied(this, source);
    }
  }

  heal(hp, ap = 0) {
    this.hp = Math.min(this.maxHp, this.hp + hp);
    this.ap = Math.min(100, this.ap + ap);
  }

  update(dt, input, settings, weapons) {
    const cam = this.camera;
    const b = this.body;
    const world = this.game.world;
    this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6);

    if (!this.alive) {
      this.deadT += dt;
      if (!b.onGround) {
        // killed mid-air (jumping, on a ladder): the body still drops to the floor
        b.vel.x *= 0.9;
        b.vel.z *= 0.9;
        world.moveBody(b, dt);
      }
      // death cam: fall to the floor and roll
      const k = Math.min(1, this.deadT / 0.8);
      const e = k * k;
      cam.position.set(b.pos.x, b.pos.y + lerpN(this.eye, 0.25, e), b.pos.z);
      cam.rotation.set(this.pitch * (1 - e) - 0.2 * e, this.yaw, 0.9 * e);
      this.punchFov = 0;
      cam.zoom = 1;
      return;
    }

    // ---- look
    const fovScale = this.game.fovScale ?? 1;
    const sens = 0.0022 * (settings.sensitivity ?? 1) * fovScale;
    if (input.locked) {
      this.yaw -= input.dx * sens;
      this.pitch -= input.dy * sens;
    }
    // recoil (CoD style): each shot kicks recoilPitch/Yaw on top of the aim and nothing recovers while
    // the gun keeps firing. Pulling down against the climb eats the offset first (so the recovery
    // never drags you under the target); once the gun rests it springs back fast and a quarter
    // stays as real climb. recoilRecover x2.5 = recovery rate (1/s), ~0.15 s for the rifles.
    if (input.locked && input.dy > 0 && this.recoilPitch > 0) {
      const c = Math.min(this.recoilPitch, input.dy * sens);
      this.recoilPitch -= c;
      this.pitch += c;
    }
    this.pitch = clamp(this.pitch, -1.5, 1.5);
    const wd = weapons?.def;
    this.recoilT += dt;
    if (this.recoilT > Math.min(0.09, 60 / (wd?.rampRpm ?? wd?.rpm ?? 600) + 0.012)) {
      const rec = 1 - Math.exp(-(wd?.recoilRecover ?? 7) * 2.5 * dt);
      const rp = this.recoilPitch * rec;
      const ry = this.recoilYaw * rec;
      this.recoilPitch -= rp;
      this.recoilYaw -= ry;
      this.pitch += rp * 0.25;
      this.yaw += ry * 0.25;
    }
    this.punchFov *= Math.exp(-18 * dt);
    this.punchRoll *= Math.exp(-16 * dt);

    // ---- crouch
    // kneel: reviving a teammate (game/revive.js)
    const wantCrouch = input.down('ControlLeft') || input.down('KeyC') || input.down('ControlRight') || !!this.kneel;
    if (wantCrouch && !this.crouching) {
      this.crouching = true;
      b.height = 1.2;
    } else if (!wantCrouch && this.crouching) {
      const ceil = world.ceilingHeight(b.pos.x, b.pos.z, b.radius * 0.8, b.pos.y + 1.0);
      if (ceil > b.pos.y + 1.78) {
        this.crouching = false;
        b.height = 1.75;
      }
    }
    this.eye = damp(this.eye, this.crouching ? 1.05 : 1.62, 12, dt);

    // ---- move
    const fw = (input.down('KeyW') ? 1 : 0) - (input.down('KeyS') ? 1 : 0);
    const st = (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0);
    // on a ladder (actors/ladders.js) the climb moves the body; the gun stays lowered (sprint pose)
    if (this.game.ladders?.updatePlayer(this, dt, input, fw)) {
      this.sprinting = true;
      this.horizontalSpeed = 0;
      this.localVelX = 0;
      this.level = levelOf(b.pos.y + 0.3);
      this.bobAmt = 0;
      this.eyeOffset = damp(this.eyeOffset, 0, 14, dt);
      this._applyCamera();
      this.lastY = b.pos.y;
      return;
    }
    // Shift sprints (+40%, combat boots x1.15 on top: game/gear.js) while moving and standing
    const sprinting = (input.down('ShiftLeft') || input.down('ShiftRight')) && (fw !== 0 || st !== 0) && !this.crouching && !this.noSprint && !this.latchedBy;
    this.sprinting = sprinting;
    let speed = this.crouching ? 2.0 : 5.1 * (sprinting ? 1.4 * (this.game.gear?.sprintMul?.() ?? 1) : 1);
    if (this.latchedBy) speed *= 0.6;
    speed *= weapons?.def?.moveMul ?? 1;
    if (weapons && weapons.ads > 0.5) speed *= 0.72;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    // forward is -Z rotated by yaw
    let wx = -sin * fw + cos * st;
    let wz = -cos * fw - sin * st;
    const len = Math.hypot(wx, wz);
    if (len > 0) {
      wx /= len;
      wz /= len;
    }
    const accel = b.onGround ? 11 : 2.2;
    b.vel.x = damp(b.vel.x, wx * speed, accel, dt);
    b.vel.z = damp(b.vel.z, wz * speed, accel, dt);
    if (b.onGround && input.hit('Space') && !this.crouching) {
      b.vel.y = 5.2;
      b.onGround = false;
      this.game.audio.play('jump', { volume: 0.5 });
    }
    const prevY = b.pos.y;
    const landed = world.moveBody(b, dt);
    if (landed > 3) {
      this.game.audio.play('land', { volume: Math.min(1, landed / 9) });
      this.game.viewmodel?.land(landed);
      this.eyeOffset -= Math.min(0.12, landed * 0.012);
      if (landed > 11) this.takeDamage((landed - 11) * 9, null, null, { ignoreArmor: true });
    }
    // step smoothing
    const dy = b.pos.y - prevY;
    if (b.onGround && dy > 0.04 && dy < 0.5) this.eyeOffset -= dy;
    if (b.onGround && dy < -0.04 && dy > -0.5) this.eyeOffset -= dy * 0.6;
    this.eyeOffset = damp(this.eyeOffset, 0, 14, dt);
    this.eyeOffset = clamp(this.eyeOffset, -0.45, 0.3);

    this.horizontalSpeed = Math.hypot(b.vel.x, b.vel.z);
    this.localVelX = b.vel.x * cos - b.vel.z * sin;
    this.level = levelOf(b.pos.y + 0.3);

    // footsteps
    if (b.onGround) {
      this.stepDist += this.horizontalSpeed * dt;
      const stride = this.crouching ? 1.6 : sprinting ? 2.7 : 2.3;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        const hit = world.raycast(b.pos.x, b.pos.y + 0.2, b.pos.z, 0, -1, 0, 0.6, null, {});
        const s = hit ? hit.box.surface : SURF.wood;
        const name = s === SURF.mud ? 'footstep_mud' : s === SURF.concrete ? 'footstep_concrete' : 'footstep_wood';
        this.game.audio.play(name, { volume: this.crouching ? 0.25 : sprinting ? 0.62 : 0.5 });
      }
    }
    this.bob += dt * this.horizontalSpeed * 1.9;
    this.bobAmt = b.onGround ? clamp(this.horizontalSpeed / 5, 0, 1) : 0;

    this._applyCamera();
    this.lastY = b.pos.y;
  }

  // ---- camera: aim (pitch/yaw + recoil offset) plus shake, bob and the shot punch
  _applyCamera() {
    const cam = this.camera;
    const b = this.body;
    const bobAmt = this.bobAmt;
    const shakeX = this.game.shake.sample(1) * 0.04;
    const shakeY = this.game.shake.sample(2) * 0.04;
    cam.position.set(
      b.pos.x,
      b.pos.y + this.eye + this.eyeOffset + Math.abs(Math.sin(this.bob)) * 0.022 * bobAmt - 0.011 * bobAmt,
      b.pos.z
    );
    cam.rotation.set(
      this.pitch + this.recoilPitch + shakeX,
      this.yaw + this.recoilYaw + shakeY,
      Math.sin(this.bob * 0.5) * 0.004 * bobAmt + this.game.shake.sample(3) * 0.02 + this.punchRoll
    );
    cam.zoom = 1 / (1 + this.punchFov); // game.js applies it with the ADS FOV this frame
    cam.updateMatrixWorld(true);
  }
}

function lerpN(a, b, t) {
  return a + (b - a) * t;
}
