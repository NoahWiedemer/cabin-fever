// AI fireteam members: pick defensive posts near the player, engage visible infected with
// rifles (real hitscan, tracers, muzzle flashes), reload, retreat when hurt, die and respawn.
import * as THREE from 'three';
import { createCharacter } from './rig.js';
import { buildThirdPersonWeapon } from '../player/gunSafe.js';
import { clamp, damp, dampAngle, rand, coneDirection, lerp, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { WEAPONS } from '../player/weaponDefs.js';

const NAMES = ['NightOwl', 'Kr4ken', 'Hollow_Point', 'BlackMamba', 'Vortex7', 'Sgt.Rusty'];
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };

const BOT_WEAPON = { ...WEAPONS.m4a1, damage: 19, penetration: 0, falloff: [25, 70, 0.55] };
// GLB bodies (procedural soldiers if missing), picked by team size so every model gets a slot and a
// full team always has Viper: 3 bots Coach, Ellis, Viper · 2 bots Viper, Meshy · 1 bot Viper
const LINEUPS = { 1: ['viper'], 2: ['viper', 'meshy'], 3: ['coach', 'ellis', 'viper'] };

// rifle hold, in gun space (x right, y up, -z muzzle): stock pocket → grip, wrist targets and hand frames
const GRIP_FWD = 0.25; // grip ahead of the shoulder pocket (≈ butt-to-grip length)
const WRIST_R = new THREE.Vector3(0.025, -0.075, 0.09);
const WRIST_L = new THREE.Vector3(-0.035, -0.07, -0.21);
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
  constructor(game, index) {
    this.game = game;
    this.index = index;
    this.name = NAMES[index % NAMES.length];
    this.rank = [3, 4, 2, 5][index % 4];
    this.chars = new Map(); // kind -> character, each body built once
    this._wear(LINEUPS[3][index % 3]);
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
    // rifle in the right hand
    try {
      this.gun = buildThirdPersonWeapon('m4a1');
    } catch (e) {
      this.gun = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.08, 0.7), new THREE.MeshStandardMaterial({ color: 0x111111 }));
    }
    this.gun.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // the rifle is posed in character space along the aim (muzzle = -Z); both hands are IK'd onto it
    this.gunHolder = new THREE.Group();
    this.gunHolder.add(this.gun);
    this.mesh.add(this.gunHolder);
    this.muzzleLocal = new THREE.Vector3(0, 0.03, -0.62);
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
    this._wear(LINEUPS[clamp(this.game.config?.teammates ?? 3, 1, 3)][this.index] ?? LINEUPS[3][this.index % 3]);
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
    this.mag = 30;
    this.reloadT = 0;
    this.cooldown = 0;
    this.burst = 0;
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
    this.stuck = 0;
    this.hurtT = 0;
    this.lastPos = pos.clone();
    this.fireFlash = 0;
    if (this.jiggle) this.jiggle.reset();
  }

  takeDamage(amount, fromPos, source) {
    if (!this.alive) return;
    let dmg = amount;
    if (this.ap > 0) {
      const ab = Math.min(this.ap, dmg * 0.5);
      this.ap -= ab;
      dmg -= ab;
    }
    this.hp -= dmg;
    this.hurtT = 1.5;
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
    const posts = game.level.defensePosts.filter((p) => !game.team.some((t) => t !== this && t.post === p));
    const ref = player.alive ? player.pos : this.pos;
    posts.sort((a, b) => a.pos.distanceToSquared(ref) - b.pos.distanceToSquared(ref));
    const pick = posts[Math.min(posts.length - 1, Math.floor(Math.random() * Math.min(3, posts.length)))];
    this.post = pick || null;
    this.postT = rand(10, 18);
    this.field = null;
  }

  update(dt) {
    const game = this.game;
    if (!this.alive) {
      this._animateDead(dt);
      return;
    }
    const pos = this.pos;
    this.level = levelOf(pos.y + 0.3);
    this.hurtT -= dt;

    // ---- target selection
    this.targetT -= dt;
    if (this.targetT <= 0) {
      this.targetT = rand(0.25, 0.45);
      let best = null, bd = Infinity;
      for (const z of game.zombies.list) {
        if (!z.alive) continue;
        const d = z.pos.distanceTo(pos);
        if (d > 26 || d >= bd) continue;
        if (Math.abs(z.pos.y - pos.y) > 2.5) continue;
        const cy = z.hipsWorld ? z.hipsWorld.y : z.pos.y + 1.2;
        if (!game.world.lineOfSight(pos.x, pos.y + 1.5, pos.z, z.pos.x, cy, z.pos.z)) continue;
        // prefer Boomers (they must die before they get close), then the fast dogs
        const score = d * (z.typeName === 'charger' ? 0.5 : z.typeName === 'dog' ? 0.75 : 1);
        if (score < bd) {
          bd = score;
          best = z;
        }
      }
      this.target = best;
    }
    if (this.target && !this.target.alive) this.target = null;

    // ---- post selection & movement
    this.postT -= dt;
    if (!this.post || this.postT <= 0) this._choosePost();
    let wantX = 0, wantZ = 0, speed = 0;
    if (this.post) {
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
    } else if (this.post && Math.hypot(this.post.pos.x - pos.x, this.post.pos.z - pos.z) < 1) {
      faceYaw = this.post.face + Math.sin(game.time * 0.3 + this.index) * 0.6;
    } else if (Math.hypot(wantX, wantZ) > 0.1) {
      faceYaw = Math.atan2(wantX, wantZ);
    }
    this.yaw = dampAngle(this.yaw, faceYaw, 8, dt);
    this.aimPitch = damp(this.aimPitch, wantPitch, 8, dt);
    this.root.rotation.y = this.yaw;

    this.cooldown -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = 30;
    } else if (this.target && this.cooldown <= 0) {
      const aimErr = Math.abs(wrapAngle(faceYaw - this.yaw));
      if (aimErr < 0.15) {
        if (this.burst <= 0) this.burst = Math.floor(rand(3, 7));
        this._shoot();
        this.burst--;
        this.cooldown = this.burst > 0 ? 60 / 650 : rand(0.5, 1.0);
        if (this.mag <= 0) {
          this.reloadT = 2.4;
          game.audio.play('m4_reload', { position: pos, volume: 0.5 });
        }
      }
    }
    this.crouch = damp(this.crouch, this.target && this.moveSpeed < 0.5 && this.index % 2 === 0 ? 1 : 0, 4, dt);
    this.recoil = damp(this.recoil, 0, 14, dt);
    this._animate(dt);
  }

  _shoot() {
    const game = this.game;
    this.mag--;
    this.recoil = 1;
    this.root.updateMatrixWorld(true);
    const muzzle = this.gun.localToWorld(this.muzzleLocal.clone());
    const tp = this.target.hipsWorld || this.target.pos;
    const eye = _v.set(this.pos.x, this.pos.y + 1.5, this.pos.z);
    const aim = new THREE.Vector3(tp.x, (this.target.hipsWorld ? tp.y : tp.y + 1.2) + rand(-0.1, 0.35), tp.z);
    if (Math.random() < 0.18) aim.y += 0.4; // occasional headshot attempt
    _d.copy(aim).sub(eye).normalize();
    const dist = aim.distanceTo(eye);
    const err = (2.2 + dist * 0.09) * (Math.PI / 180);
    const dir = coneDirection(_d, err, new THREE.Vector3());
    game.hitscan(eye.clone(), dir, BOT_WEAPON, this, { tracerFrom: Math.random() < 0.55 ? muzzle : null, bot: true });
    game.fx.muzzleWorld(muzzle, dir, 0.9);
    game.audio.play('m4_fire', { position: muzzle, volume: 0.75 });
    if (this.jiggle) this.jiggle.kick(-dir.x * 0.24, 0.28, -dir.z * 0.24); // recoil
    if (Math.random() < 0.3) game.fx.shell('rifle', muzzle.clone().add(new THREE.Vector3(0, 0, 0)), new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)));
    game.alertNoise(this.pos, 25);
  }

  _animate(dt) {
    const b = this.bones;
    const sp = this.moveSpeed;
    const run = clamp((sp - 1.5) / 2.5, 0, 1);
    this.phase += dt * (sp / lerp(1.0, 1.7, run)) * Math.PI;
    const s = Math.sin(this.phase), c = Math.cos(this.phase);
    const moving = clamp(sp / 0.8, 0, 1);
    const amp = lerp(0.35, 0.7, run) * moving;
    const cr = this.crouch;
    b.hips.position.y = 0.98 - cr * 0.38 + Math.abs(c) * 0.03 * moving;
    b.hips.rotation.set(0, 0.35, 0);
    b.thighL.rotation.set(-s * amp - cr * 1.3, -0.3, 0.05);
    b.thighR.rotation.set(s * amp - cr * 0.2, -0.3, -0.05);
    b.shinL.rotation.set(Math.max(0, -c) * amp * 1.4 + 0.08 + cr * 1.6, 0, 0);
    b.shinR.rotation.set(Math.max(0, c) * amp * 1.4 + 0.08 + cr * 1.9, 0, 0);
    b.footL.rotation.set(-(b.thighL.rotation.x + b.shinL.rotation.x) * 0.7, 0, 0);
    b.footR.rotation.set(-(b.thighR.rotation.x + b.shinR.rotation.x) * 0.7 + cr * 0.3, 0, 0);
    b.spine.rotation.set(0.08 + run * 0.1 + cr * 0.15, -0.3, 0);
    b.chest.rotation.set(-this.aimPitch * 0.4 - this.recoil * 0.04, -0.05, 0);
    b.neck.rotation.set(-this.aimPitch * 0.3, 0.2, 0);
    b.head.rotation.set(-this.aimPitch * 0.3 - cr * 0.1, 0.15, 0);
    this._holdRifle(dt);
    if (this.rig) this.rig.sync();
    if (this.jiggle) this.jiggle.update(dt);
  }

  /** rifle along yaw + aim pitch with the stock in the right shoulder (low ready when idle), hands IK'd on */
  _holdRifle(dt) {
    const b = this.bones;
    this.ready = damp(this.ready, this.target && this.reloadT <= 0 ? 1 : 0, 5, dt);
    const pitch = this.aimPitch + this.recoil * 0.05 - (1 - this.ready) * 0.5;
    _gq.copy(this.root.quaternion).multiply(_qa.setFromEuler(_eu.set(-pitch, Math.PI, 0)));
    // stock pocket: just inside the right shoulder joint
    b.upperArmR.getWorldPosition(_G);
    _G.add(_T.set(-0.06, 0.04, this.recoil * 0.035 - GRIP_FWD).applyQuaternion(_gq));
    this.gunHolder.position.copy(this.mesh.worldToLocal(_T.copy(_G)));
    this.gunHolder.quaternion.copy(this.mesh.getWorldQuaternion(_qb).invert().multiply(_gq));
    const h = this.hands;
    // right hand on the pistol grip, elbow out and down
    _T.copy(WRIST_R).applyQuaternion(_gq).add(_G);
    _pole.set(-0.7, -1, -0.3).applyQuaternion(this.root.quaternion);
    reach(b.upperArmR, b.foreArmR, b.handR, _T, _pole, _aw.copy(ALONG_R).applyQuaternion(_gq), _pw.copy(PALM_R).applyQuaternion(_gq), h.R);
    // left hand under the handguard
    _T.copy(WRIST_L).applyQuaternion(_gq).add(_G);
    _pole.set(0.3, -1, -0.1).applyQuaternion(this.root.quaternion);
    reach(b.upperArmL, b.foreArmL, b.handL, _T, _pole, _aw.copy(ALONG_L).applyQuaternion(_gq), _pw.copy(PALM_L).applyQuaternion(_gq), h.L);
  }

  _animateDead(dt) {
    this.deadT += dt;
    const k = Math.min(1, this.deadT / 0.7);
    const e = k * k;
    this.root.rotation.x = this.fallDir * (Math.PI / 2) * e;
    const a = this.root.rotation.x;
    this.mesh.position.set(0, 0.12 * Math.cos(a) * e, -0.12 * Math.sin(a) * e);
    const b = this.bones;
    b.upperArmL.rotation.x = lerp(b.upperArmL.rotation.x, -2.5, 0.08);
    b.upperArmR.rotation.x = lerp(b.upperArmR.rotation.x, -0.5, 0.08);
    if (this.rig) this.rig.sync();
    if (this.jiggle) this.jiggle.update(dt);
  }

  hide() {
    this.alive = false;
    this.root.visible = false;
  }
}
