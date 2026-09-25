// Ladders: climbing for the player and the infected (the barn's hayloft ladder, world/barn.js).
//
// A ladder def (ranchLayout.js LADDER): vertical, rungs in the plane through (x, z) with outward normal
// (nx, nz): climbers hang `stand` m out on that side; yBottom = floor, yTop = the loft floor behind it.
//
// Player: face the ladder and hold W (or press Space) near it to grab it. W climbs (2.5 m/s), S goes down;
//   looking steeply down turns W into "down", and facing away from the ladder W goes down (so walking off the
//   loft edge into the ladder gap grabs it and climbs down). C slides down fast, Space jumps off. You step off
//   onto the loft at the top and onto the floor at the bottom. Weapons are lowered while climbing
//   (Player.sprinting -> weapons.js sprint pose; weapons.update ignores input while player.climbing).
// Infected: the nav ladder portal (portal.ladder) brings them to the foot / top. tryMount() starts the climb
//   when the ladder is free (one at a time per 1.7 m, never against the traffic), otherwise parks them at a
//   wait spot via z.portalWait (zombie.js _portalMove). While z.climb is set, updateZombie() owns the zombie
//   (mount -> climb ~1.2 m/s, Biters ~2.1 -> dismount; hands and feet on the rungs on the proxy rig). A kill
//   mid-climb drops it as a ragdoll (drop(); zombie.js _die). Dogs and Crushers can't climb: they wait at the
//   foot. Someone on the ladder right above / below a climbing zombie gets clawed.
// Bots never climb: their posts are all in the house. One that respawns up on the loft (next to you) walks
//   out of the railing gap and drops to the floor.
import * as THREE from 'three';
import { levelOf } from '../world/level.js';
import { clamp, damp, dampAngle, lerp } from '../core/utils.js';

const PLAYER_SPEED = 2.5;
const RUNG = 0.3;
const CLIMB_SPEED = { biter: 2.1, striker: 1.45, charger: 1.0, mauler: 1.2 };
const NO_CLIMB = new Set(['dog', 'crusher']);
const SPACING = 1.7; // m between climbers going the same way

const _v = new THREE.Vector3();
const smooth = (t) => t * t * (3 - 2 * t);

class Ladder {
  constructor(def) {
    this.def = def;
    this.occ = []; // { actor, dir: +1 up / -1 down, kind: 'player' | 'zombie' }
    this.tx = -def.nz; // tangent (along the rungs)
    this.tz = def.nx;
    this.spot = { x: def.x + def.nx * def.stand, z: def.z + def.nz * def.stand };
    this.loft = { x: def.x - def.nx * 0.62, z: def.z - def.nz * 0.62 }; // step-off point on the loft
    this.foot = { x: def.x + def.nx * 1.05, z: def.z + def.nz * 1.05 }; // step-off point on the floor
    // facing the rungs: zombie yaw convention (forward = (sin, cos)) and the player's (forward = (-sin, -cos))
    this.zYaw = Math.atan2(-def.nx, -def.nz);
    this.pYaw = Math.atan2(def.nx, def.nz);
  }
  /** feet height of whoever is on the ladder */
  yOf(o) {
    return o.actor.pos.y;
  }
  prune() {
    for (let i = this.occ.length - 1; i >= 0; i--) {
      const o = this.occ[i];
      const a = o.actor;
      const gone = o.kind === 'player' ? !a.alive || a.climbing?.occ !== o : !a.active || !a.alive || a.climb?.occ !== o;
      if (gone) this.occ.splice(i, 1);
    }
  }
  add(actor, dir, kind) {
    const o = { actor, dir, kind };
    this.occ.push(o);
    return o;
  }
  remove(o) {
    const i = this.occ.indexOf(o);
    if (i >= 0) this.occ.splice(i, 1);
  }
  /** can a zombie start from this end (dir +1: bottom, -1: top)? */
  free(dir) {
    this.prune();
    const d = this.def;
    for (const o of this.occ) {
      const y = this.yOf(o);
      if (o.kind === 'player') {
        // follow a climbing player up (it claws at the legs), never climb down onto one
        if (dir < 0) return false;
        if (y < d.yBottom + SPACING + 0.2) return false;
        continue;
      }
      if (o.dir !== dir) return false; // no head-on traffic
      if (dir > 0 && y < d.yBottom + SPACING) return false;
      if (dir < 0 && y > d.yTop - SPACING - 0.6) return false;
    }
    return true;
  }
}

export class Ladders {
  constructor(game) {
    this.game = game;
    this.list = (game.level?.ladders ?? []).map((d) => new Ladder(d));
    this.byDef = new Map(this.list.map((l) => [l.def, l]));
  }

  reset() {
    for (const l of this.list) l.occ.length = 0;
  }

  // ================================================================== player
  /**
   * Called from Player.update with the move keys (fw: +1 W / -1 S). Returns true while the player is on
   * (or getting onto / off) a ladder: the body has been moved and the normal walk must be skipped.
   */
  updatePlayer(p, dt, input, fw) {
    const b = p.body;
    let c = p.climbing;
    if (!p.alive) {
      if (c) this._releasePlayer(p);
      return false;
    }
    if (!c) {
      p.ladderCd = Math.max(0, (p.ladderCd ?? 0) - dt);
      if (p.ladderCd > 0) return false;
      c = this._grab(p, input, fw);
      if (!c) return false;
    }
    const L = c.lad, d = L.def;
    c.t += dt;
    const pos = b.pos;
    b.vel.set(0, 0, 0);
    b.onGround = false;
    if (p.crouching) {
      p.crouching = false;
      b.height = 1.75;
    }

    if (c.phase === 'mountTop' || c.phase === 'dismountTop') {
      const T = c.phase === 'mountTop' ? 0.45 : 0.42;
      const k = smooth(Math.min(1, c.t / T));
      pos.x = lerp(c.from.x, c.to.x, k);
      pos.z = lerp(c.from.z, c.to.z, k);
      pos.y = lerp(c.from.y, c.to.y, k) + Math.sin(k * Math.PI) * (c.phase === 'dismountTop' ? 0.12 : 0.05);
      if (c.t >= T) {
        if (c.phase === 'mountTop') {
          c.phase = 'climb';
          c.t = 0;
        } else {
          pos.y = d.yTop;
          this._releasePlayer(p, 0.5);
          b.onGround = true;
          return true;
        }
      }
      this._playerSteps(p, c);
      return true;
    }

    // ---- climbing
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const facing = -sy * -d.nx + -cy * -d.nz; // forward · (toward the rungs)
    let up = 0;
    if (fw !== 0) {
      let goUp = fw > 0;
      if (facing > -0.2) {
        if (p.pitch < -0.62) goUp = !goUp; // looking down the ladder: W goes down
      } else if (!(p.pitch > 0.62)) goUp = !goUp; // facing away: W walks you down (unless looking up)
      up = goUp ? 1 : -1;
    }
    const slide = input && (input.down('KeyC') || input.down('ControlLeft') || input.down('ControlRight'));
    if (slide) up = -1;
    // jump off
    if (input && input.hit('Space') && c.t > 0.25) {
      this._releasePlayer(p, 0.6);
      b.vel.set(d.nx * 3.2, 3.2, d.nz * 3.2);
      this.game.audio.play('jump', { volume: 0.45 });
      return false;
    }
    let vy = up * PLAYER_SPEED * (slide ? 1.6 : 1);
    let y = pos.y + vy * dt;
    // others on the ladder block the way
    for (const o of L.occ) {
      if (o.actor === p) continue;
      const oy = L.yOf(o);
      if (oy > pos.y - 0.05 && y > oy - 1.8) y = Math.min(y, Math.max(pos.y, oy - 1.8));
      if (oy < pos.y + 0.05 && y < oy + 1.75) y = Math.max(y, Math.min(pos.y, oy + 1.75));
    }
    // steps: step off at the top onto the loft, at the bottom onto the floor
    if (y >= d.yTop - 0.04 && up > 0) {
      c.phase = 'dismountTop';
      c.t = 0;
      c.from = pos.clone();
      c.to = new THREE.Vector3(L.loft.x, d.yTop, L.loft.z);
      this.game.audio.play('ladder_step', { volume: 0.5 });
      return true;
    }
    if (y <= d.yBottom + 0.005 && up < 0) {
      pos.y = d.yBottom;
      this._releasePlayer(p, 0.35);
      b.onGround = true;
      b.vel.set(d.nx * 1.2, 0, d.nz * 1.2);
      this.game.audio.play('footstep_concrete', { volume: 0.4 });
      return false;
    }
    y = clamp(y, d.yBottom, d.yTop - 0.03);
    c.climbed += Math.abs(y - pos.y);
    pos.y = y;
    // hug the ladder
    pos.x = damp(pos.x, L.spot.x + L.tx * clamp(c.lat, -0.08, 0.08), 12, dt);
    pos.z = damp(pos.z, L.spot.z + L.tz * clamp(c.lat, -0.08, 0.08), 12, dt);
    c.lat = damp(c.lat, 0, 4, dt);
    this._playerSteps(p, c);
    return true;
  }

  /** start climbing if the player is at a ladder and asks for it */
  _grab(p, input, fw) {
    const b = p.body, pos = b.pos;
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const fx = -sy, fz = -cy; // view forward (xz)
    const st = input ? (input.down('KeyD') ? 1 : 0) - (input.down('KeyA') ? 1 : 0) : 0;
    let wx = fx * fw + cy * st, wz = fz * fw - sy * st;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) (wx /= wl), (wz /= wl);
    const space = input && (input.hit('Space') || input.down('Space'));
    for (const L of this.list) {
      const d = L.def;
      const rx = pos.x - d.x, rz = pos.z - d.z;
      const s = rx * d.nx + rz * d.nz; // out from the rungs
      const lat = rx * L.tx + rz * L.tz;
      if (Math.abs(lat) > 0.45) continue;
      const facing = fx * -d.nx + fz * -d.nz;
      // from the floor / mid air in front of it: face it and push W (or Space)
      if (s > 0.02 && s < 0.95 && pos.y > d.yBottom - 0.3 && pos.y < d.yTop - 0.5 && facing > 0.35 && (fw > 0 || space)) {
        const c = { lad: L, phase: 'climb', t: 0, lat, climbed: 0, stepAt: 0 };
        c.occ = L.add(p, 1, 'player');
        p.climbing = c;
        this.game.audio.play('ladder_step', { volume: 0.5 });
        return c;
      }
      // from the loft: walk out through the railing gap toward the ladder
      if (s > -0.75 && s < 0.2 && Math.abs(lat) < 0.36 && Math.abs(pos.y - d.yTop) < 0.3 && wl > 0 && wx * d.nx + wz * d.nz > 0.55) {
        const c = { lad: L, phase: 'mountTop', t: 0, lat: 0, climbed: 0, stepAt: 0 };
        c.from = pos.clone();
        c.to = new THREE.Vector3(L.spot.x, d.yTop - 0.55, L.spot.z);
        c.occ = L.add(p, -1, 'player');
        p.climbing = c;
        this.game.audio.play('ladder_step', { volume: 0.5 });
        return c;
      }
    }
    return null;
  }

  _playerSteps(p, c) {
    if (c.phase === 'climb' && c.climbed - c.stepAt >= RUNG * 1.5) {
      c.stepAt = c.climbed;
      this.game.audio.play('ladder_step', { volume: 0.42 });
    }
  }

  _releasePlayer(p, cd = 0.3) {
    const c = p.climbing;
    if (c) c.lad.remove(c.occ);
    p.climbing = null;
    p.ladderCd = cd;
  }

  // ================================================================== infected
  canClimb(z) {
    return !z.quad && !NO_CLIMB.has(z.typeName);
  }

  /** after Zombie.update: a zombie traversing a ladder portal starts climbing at the foot / top */
  tryMount(z) {
    const portal = z.portal;
    const L = this.byDef.get(portal?.ladder);
    if (!L || z.climb || !z.alive) return;
    const d = L.def;
    const lvl = levelOf(z.pos.y + 0.3);
    const up = lvl === portal.a.level;
    if (!this.canClimb(z)) {
      // dogs / Crushers: wait around the foot of the ladder (the field keeps them there until the target comes down)
      if (up) this._park(z, L, 0.6 + (z.id % 3) * 0.45);
      else z.portal = null;
      return;
    }
    let near;
    if (up) near = Math.hypot(z.pos.x - L.spot.x, z.pos.z - L.spot.z) < 1.3 && Math.abs(z.pos.y - d.yBottom) < 0.6;
    else near = Math.hypot(z.pos.x - (d.x - d.nx * 0.35), z.pos.z - (d.z - d.nz * 0.35)) < 1.15 && Math.abs(z.pos.y - d.yTop) < 0.5;
    const dir = up ? 1 : -1;
    if (!near) {
      // parked in the queue and the way is clear now: walk in (tryMount fires when it passes the rungs)
      if (z.portalWait && L.free(dir)) {
        z.portalWait = false;
        z.portalTo = up ? portal.b : portal.a;
      }
      return;
    }
    if (!L.free(dir)) {
      if (up) this._park(z, L, 0.55 + (z.id % 4) * 0.35);
      else this._parkTop(z, L);
      return;
    }
    // go
    z.portalWait = false;
    const c = { lad: L, dir, phase: up ? 'mount' : 'mountTop', t: 0, from: z.pos.clone(), cycle: z.id * 1.7, clawT: 0.6, groanT: 1 + Math.random() * 2 };
    c.occ = L.add(z, dir, 'zombie');
    z.climb = c;
    z.body.vel.set(0, 0, 0);
    z.attackT = -1;
    z.barricade = null;
    this.game.audio.play('ladder_step', { position: z.pos, volume: 0.45, pitch: 0.9 });
  }

  _park(z, L, out) {
    const d = L.def;
    const side = ((z.id * 7) % 5) / 2 - 1; // -1..1 along the rungs
    z.portalWait = true;
    z.portalTo = { level: z.portal.a.level, x: L.spot.x + d.nx * out + L.tx * side * 0.8, z: L.spot.z + d.nz * out + L.tz * side * 0.8 };
  }
  _parkTop(z, L) {
    const d = L.def;
    const side = ((z.id * 7) % 5) / 2 - 1;
    z.portalWait = true;
    z.portalTo = { level: z.portal.b.level, x: d.x - d.nx * 1.3 + L.tx * side * 0.5, z: d.z - d.nz * 1.3 + L.tz * side * 0.5 };
  }

  /** A zombie on a ladder: returns true while it owns the zombie's update (Zombie.update is skipped). */
  updateZombie(z, dt, ctx) {
    const c = z.climb;
    if (!c) return false;
    const L = c.lad, d = L.def;
    // stale (pooled + respawned, or the portal was dropped): let go
    if (!z.alive || !z.active || !z.portal || z.portal.ladder !== d) {
      this._releaseZombie(z);
      return false;
    }
    const pos = z.pos;
    c.t += dt;
    z.hitSlow -= dt;
    z.stagger -= dt;
    z.level = levelOf(pos.y + 0.3);
    // a blast knocks it off
    const hv = Math.hypot(z.body.vel.x, z.body.vel.z);
    if (hv > 3 && c.phase === 'climb') {
      this._releaseZombie(z);
      z.portal = null;
      z.body.onGround = false;
      return false;
    }
    z.body.vel.set(0, 0, 0);
    let dy = 0;
    if (c.phase === 'mount' || c.phase === 'mountTop') {
      const T = c.phase === 'mount' ? 0.35 : 0.7;
      const k = smooth(Math.min(1, c.t / T));
      if (c.phase === 'mount') {
        pos.x = lerp(c.from.x, L.spot.x, k);
        pos.z = lerp(c.from.z, L.spot.z, k);
        pos.y = lerp(c.from.y, d.yBottom, k);
      } else {
        // walk to the edge, swing round onto the rungs
        const ex = d.x - d.nx * 0.12, ez = d.z - d.nz * 0.12;
        const k1 = smooth(Math.min(1, k / 0.45)), k2 = smooth(clamp((k - 0.45) / 0.55, 0, 1));
        pos.x = lerp(lerp(c.from.x, ex, k1), L.spot.x, k2);
        pos.z = lerp(lerp(c.from.z, ez, k1), L.spot.z, k2);
        const y0 = pos.y;
        pos.y = lerp(d.yTop, d.yTop - 0.9, k2);
        dy = Math.abs(pos.y - y0);
      }
      z.yaw = dampAngle(z.yaw, L.zYaw, 12, dt);
      if (c.t >= T) {
        c.phase = 'climb';
        c.t = 0;
      }
    } else if (c.phase === 'climb') {
      let v = (z.type.climb ?? CLIMB_SPEED[z.typeName] ?? 1.2) * (z.speedMult ?? 1) * (z.hitSlow > 0 ? 0.45 : 1) * c.dir;
      if (z.stagger > 0) v *= 0.2;
      let y = pos.y + v * dt;
      L.prune();
      for (const o of L.occ) {
        if (o.actor === z) continue;
        const oy = L.yOf(o);
        const gap = o.kind === 'player' ? 1.75 : SPACING;
        if (c.dir > 0 && oy > pos.y && y > oy - gap) y = Math.max(pos.y, oy - gap);
        if (c.dir < 0 && oy < pos.y && y < oy + gap) y = Math.min(pos.y, oy + gap);
        // claw at a survivor on the ladder right above / below
        if (o.kind === 'player' && Math.abs(oy - pos.y) < 2.0) {
          c.clawT -= dt;
          if (c.clawT <= 0) {
            c.clawT = 1.1;
            o.actor.takeDamage(z.type.dmg * 0.6 * (this.game.difficultyDamage ?? 1), pos, z);
            this.game.audio.play('zombie_attack', { position: pos, volume: 0.7, pitch: z.type.pitch ?? 1 });
          }
        }
      }
      dy = Math.abs(y - pos.y);
      pos.y = y;
      pos.x = damp(pos.x, L.spot.x, 10, dt);
      pos.z = damp(pos.z, L.spot.z, 10, dt);
      z.yaw = dampAngle(z.yaw, L.zYaw, 10, dt);
      if (c.dir > 0 && pos.y >= d.yTop - 0.06) this._phase(c, 'dismount', pos);
      if (c.dir < 0 && pos.y <= d.yBottom + 0.01) this._phase(c, 'dismountFoot', pos);
    } else if (c.phase === 'dismount') {
      const T = 0.55;
      const k = smooth(Math.min(1, c.t / T));
      pos.x = lerp(c.from.x, L.loft.x - d.nx * 0.15, k);
      pos.z = lerp(c.from.z, L.loft.z - d.nz * 0.15, k);
      pos.y = lerp(c.from.y, d.yTop, k) + Math.sin(k * Math.PI) * 0.18;
      dy = dt * 1.2;
      if (c.t >= T) return this._finish(z, d.yTop);
    } else if (c.phase === 'dismountFoot') {
      const T = 0.3;
      const k = smooth(Math.min(1, c.t / T));
      pos.x = lerp(c.from.x, L.foot.x, k);
      pos.z = lerp(c.from.z, L.foot.z, k);
      pos.y = d.yBottom;
      z.yaw = dampAngle(z.yaw, L.zYaw + Math.PI, 6, dt);
      if (c.t >= T) return this._finish(z, d.yBottom);
    }
    c.cycle += (dy / (RUNG * 2)) * Math.PI * 2;
    // rung sounds + the odd groan
    const step = Math.floor(c.cycle / Math.PI);
    if (step !== c.lastStep) {
      c.lastStep = step;
      if (Math.random() < 0.55) this.game.audio.play('ladder_step', { position: pos, volume: 0.35, pitch: z.typeName === 'biter' ? 1.25 : 0.95 });
    }
    c.groanT -= dt;
    if (c.groanT <= 0) {
      c.groanT = 3 + Math.random() * 4;
      this.game.audio.play(z.typeName === 'biter' ? 'biter_snarl' : 'zombie_groan', { position: pos, volume: 0.5, pitch: z.type.pitch ?? 1 });
    }
    z.root.rotation.set(0, z.yaw, 0);
    z.mesh.position.set(0, 0, 0);
    z.moveSpeed = 0;
    this._pose(z, c, dt);
    return true;
  }

  _phase(c, phase, pos) {
    c.phase = phase;
    c.t = 0;
    c.from = pos.clone();
  }

  _finish(z, y) {
    z.pos.y = y;
    this._releaseZombie(z);
    z.portal = null;
    z.portalTo = null;
    z.portalWait = false;
    z.body.onGround = true;
    z.body.vel.set(0, 0, 0);
    z.level = levelOf(y + 0.3);
    z.lastPos?.copy(z.pos);
    z.stuckT = 0;
    return true;
  }

  _releaseZombie(z) {
    const c = z.climb;
    if (c) c.lad.remove(c.occ);
    z.climb = null;
  }

  /** Zombie._die hook: a zombie killed on the ladder falls off (the caller throws it as a ragdoll). */
  drop(z) {
    const c = z.climb;
    if (!c) return false;
    const d = c.lad.def;
    this._releaseZombie(z);
    z.portal = null;
    z.body.onGround = false;
    z.body.vel.set(d.nx * 1.5, 0, d.nz * 1.5); // pushed back off the rungs
    return true;
  }

  // ------------------------------------------------------------------ climbing pose (proxy bones)
  _pose(z, c, dt) {
    const b = z.bones;
    if (!b?.upperArmL) return;
    const u = 0.5 + 0.5 * Math.sin(c.cycle);
    const w = Math.cos(c.cycle);
    const hipsY = z.rest?.hips?.y ?? 0.98;
    b.hips.position.y = hipsY - 0.03;
    b.hips.rotation.set(0.06, 0, w * 0.05);
    b.spine.rotation.set(0.14, w * 0.07, 0);
    b.chest.rotation.set(0.06, -w * 0.06, 0);
    b.neck.rotation.set(-0.32, 0, 0);
    b.head.rotation.set(-0.28, (z.twitch?.y ?? 0) * 0.3, (z.headTilt ?? 0) * 0.5);
    b.shoulderL?.rotation.set(0, 0, 0);
    b.shoulderR?.rotation.set(0, 0, 0);
    // left hand + right foot reach for the next rung together, then the other pair
    b.upperArmL.rotation.set(lerp(-2.15, -2.85, u), 0, -0.22);
    b.upperArmR.rotation.set(lerp(-2.85, -2.15, u), 0, 0.22);
    b.foreArmL.rotation.set(lerp(-0.95, -0.3, u), 0, 0);
    b.foreArmR.rotation.set(lerp(-0.3, -0.95, u), 0, 0);
    b.handL.rotation.set(0.55, 0, 0);
    b.handR.rotation.set(0.55, 0, 0);
    b.thighR.rotation.set(lerp(-0.2, -1.1, u), 0, -0.06);
    b.thighL.rotation.set(lerp(-1.1, -0.2, u), 0, 0.06);
    b.shinR.rotation.set(lerp(0.3, 1.6, u), 0, 0);
    b.shinL.rotation.set(lerp(1.6, 0.3, u), 0, 0);
    b.footL.rotation.set(-0.25, 0, 0);
    b.footR.rotation.set(-0.25, 0, 0);
    z.rig?.sync();
  }
}
