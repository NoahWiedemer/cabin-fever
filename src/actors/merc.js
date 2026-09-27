// The NOX cleanup squad (game/events.js 'squad'): black-ops troops of the company behind the outbreak. Dosed with
// an antigen and masked, the infected don't even smell them (and they leave the infected alone): they are here for
// the witnesses, the fireteam. A black helicopter comes in low over the fields, hovers over the yard and four of
// them fast-rope down (they can be shot on the ropes), then it leaves and they hunt you:
//   rifles (3)  carbines in bursts; they stop where they see you at 9-17 m and shoot, sidestep now and then, and
//               close in along the nav grid when they lose you
//   shield (1)  a ballistic riot shield from shin to crown and a pistol past its edge. It keeps the shield turned
//               to the one it shoots at and pushes in close: hit it from the side or the back, or blast it
// They are enemies of the round (it ends only once they're down too), show on the radar at any range, pay well,
// and every bullet of theirs draws a red tracer.
// MercSquad (game.mercs) owns the four, the helicopter and the drop, their raycasts for game.hitscan, blasts,
// the knife and the radar. Debug: game.mercs.deploy() (or game.events.force('squad')).
import * as THREE from 'three';
import { Teammate, reach } from './teammate.js';
import { Chopper, HELI } from '../world/helicopter.js';
import { SURF, FLAG_NOBULLET } from '../world/collision.js';
import { clamp, damp, dampAngle, lerp, rand, coneDirection, rayCapsule, raySphere, smoothstep, wrapAngle } from '../core/utils.js';
import { levelOf } from '../world/level.js';
import { WEAPONS } from '../player/weaponDefs.js';

export const MERC = {
  hp: { rifle: 170, shield: 220 }, // x difficulty
  part: { head: 2.5, torso: 1, leg: 0.75 },
  run: 3.4, // m/s closing in
  walk: 1.5, // m/s pushing in / sidestepping while shooting
  shieldRun: 2.4,
  range: { rifle: 28, shield: 17 }, // they shoot within this, with a line of sight
  stop: { rifle: [9, 17], shield: [3.5, 6] }, // m: they hold between these while they shoot
  // x difficulty damage. spread: aim error (deg) + 0.08 a metre; acquire: s before it fires at someone it just saw
  rifle: { dmg: 6, burst: [2, 4], rpm: 650, pause: [0.85, 1.6], spread: 3.4, mag: 30, reload: 2.3 },
  pistol: { dmg: 8, rpm: 170, pause: [0.45, 0.85], spread: 2.8, mag: 15, reload: 1.9 },
  acquire: [0.45, 0.85],
  reward: 250, // $ to every wallet
  score: 350,
  corpse: 22, // s a body lies there
};

// the drop, s after deploy(): in over the fields, hover, ropes, the four down in pairs, ropes up, away
const DROP = { arrive: 10, rope: 11, slide: 2.1, starts: [11.8, 12.1, 14.4, 14.7], up: 17.6, leave: 18.2, gone: 27, hover: 13.5 };

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
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _eu = new THREE.Euler();
const _G = new THREE.Vector3();
const _T = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _al = new THREE.Vector3();
const _pl = new THREE.Vector3();

// the lenses of their masks, and the shield's strip light
const LENS = new THREE.MeshStandardMaterial({ color: 0x1a0000, emissive: 0xff2410, emissiveIntensity: 2.6, roughness: 0.25 });

// the shield in the body's frame (+z ahead, +x its left): held a little left of centre, shin to crown
const SHIELD = { x: 0.07, y: 1.07, z: 0.43, hw: 0.31, hh: 0.77, hd: 0.035 };

function shieldTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 632;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 256, 0);
  gr.addColorStop(0, '#0d0e10');
  gr.addColorStop(0.5, '#1c1e21');
  gr.addColorStop(1, '#0d0e10');
  g.fillStyle = gr;
  g.fillRect(0, 0, 256, 632);
  // scuffs and grit
  let seed = 3;
  const r = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 900; i++) {
    g.fillStyle = r() < 0.5 ? `rgba(90,94,100,${r() * 0.12})` : `rgba(0,0,0,${r() * 0.2})`;
    g.fillRect(r() * 256, r() * 632, 1 + r() * 7, 1 + r() * 1.5);
  }
  // the viewport near the top
  g.fillStyle = '#05070a';
  g.fillRect(58, 70, 140, 42);
  g.strokeStyle = '#3b3f45';
  g.lineWidth = 4;
  g.strokeRect(58, 70, 140, 42);
  // a red band and the lettering
  g.fillStyle = '#7e110c';
  g.fillRect(0, 200, 256, 34);
  g.fillStyle = '#e9e4da';
  g.font = 'bold 76px "Black Ops One", Impact, sans-serif';
  g.textAlign = 'center';
  g.fillText('N.C.S.', 128, 330);
  g.font = 'bold 30px "Share Tech Mono", monospace';
  g.fillText('NOX CONTAINMENT', 128, 380);
  // hazard stripes along the bottom
  g.save();
  g.beginPath();
  g.rect(0, 540, 256, 52);
  g.clip();
  for (let x = -60; x < 300; x += 36) {
    g.fillStyle = '#b8a01c';
    g.beginPath();
    g.moveTo(x, 592);
    g.lineTo(x + 18, 592);
    g.lineTo(x + 70, 540);
    g.lineTo(x + 52, 540);
    g.closePath();
    g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
let SHIELD_MATS = null;

/** One of the squad: a Teammate body with its own brain (the fight) and its own weapons. */
export class Merc extends Teammate {
  constructor(game, index, role) {
    super(game, 100 + index, { id: 'nox' + index, name: 'NOX Operative', body: 'merc', weapon: role === 'shield' ? 'm9' : 'm4a1', gun: '', rank: 0 });
    this.role = role;
    this.isMerc = true;
    const mats = this.mesh.material;
    if (Array.isArray(mats)) this.mesh.material = [mats[0], mats[1], LENS];
    this.gunDef = role === 'shield' ? MERC.pistol : MERC.rifle;
    if (role === 'shield') this._buildShield();
    this.inPlay = false; // on the ground and fighting (not on the rope, not waiting in the helicopter)
    this.stats = { kills: 0, deaths: 0, headshots: 0, score: 0 };
    this.hide();
  }

  _buildShield() {
    SHIELD_MATS ??= {
      face: new THREE.MeshStandardMaterial({ map: shieldTexture(), roughness: 0.5, metalness: 0.08, envMapIntensity: 0.35 }),
      edge: new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.6, metalness: 0.5 }),
      glass: new THREE.MeshStandardMaterial({ color: 0x0a0d10, roughness: 0.08, metalness: 0.6 }),
    };
    const M = SHIELD_MATS;
    const g = new THREE.Group();
    const S = SHIELD;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(S.hw * 2, S.hh * 2, S.hd * 2), [M.edge, M.edge, M.edge, M.edge, M.face, M.edge]);
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);
    // a rim round the edge, the handle and the arm strap behind, a strip light on the top
    for (const [w, h, x, y] of [[S.hw * 2 + 0.02, 0.03, 0, S.hh], [S.hw * 2 + 0.02, 0.03, 0, -S.hh], [0.03, S.hh * 2, S.hw, 0], [0.03, S.hh * 2, -S.hw, 0]]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(w, h, S.hd * 2 + 0.02), M.edge);
      e.position.set(x, y, 0);
      g.add(e);
    }
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.05), M.edge);
    handle.position.set(0.02, 0.05, -S.hd - 0.03);
    g.add(handle);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), M.edge);
    strap.position.set(0.02, -0.18, -S.hd - 0.02);
    g.add(strap);
    const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.025, 0.02), LENS);
    light.position.set(-0.16, S.hh - 0.04, S.hd + 0.004);
    g.add(light);
    g.position.set(S.x, S.y, S.z);
    this.mesh.add(g);
    this.shield = g;
    this.handleLocal = new THREE.Vector3(S.x + 0.02, S.y + 0.05, S.z - S.hd - 0.06);
  }

  /** out of the helicopter onto the rope: hp and the rest set up, posed by the drop until it lands */
  board(pos, yaw) {
    this.spawn(pos, yaw);
    const diff = this.game.diff ?? { hp: 1 };
    this.hp = this.maxHp = Math.round(MERC.hp[this.role] * (diff.hp ?? 1));
    this.ap = 0;
    this.mag = this.gunDef.mag;
    this.inPlay = false;
    this.lastHitBy = null;
    this.strafeT = rand(1, 2.5);
    this.strafe = 0;
    this.pushT = 0;
    this.targetT = 0;
    this.los = false;
  }

  /** landed: the fight is on */
  land() {
    this.endCine();
    this.inPlay = true;
    this.body.vel.set(0, 0, 0);
  }

  get armed() {
    return this.alive && this.root.visible;
  }

  // ------------------------------------------------------------------ being hit
  /**
   * A bullet (or pellet) on the ray o + t d: its nearest hit on this one, { t, part } ('shield': stopped by it),
   * or null. The shield only counts while it stands.
   */
  raycast(o, d, maxT) {
    if (!this.armed) return null;
    const p = this.pos;
    const near = raySphere(o.x, o.y, o.z, d.x, d.y, d.z, p.x, p.y + 1.0, p.z, 1.3);
    if (near < 0 || near > maxT + 1.3) return null; // (the ray passes it by)
    this.root.updateMatrixWorld(true);
    let best = null;
    const b = this.bones;
    // the shield first: an oriented box in its own frame
    if (this.shield) {
      const inv = _m4.copy(this.shield.matrixWorld).invert();
      const lo = _o.copy(o).applyMatrix4(inv);
      const ld = _n.copy(d).transformDirection(inv);
      const S = SHIELD;
      let t0 = 0, t1 = maxT;
      for (const [p, v, h] of [[lo.x, ld.x, S.hw], [lo.y, ld.y, S.hh], [lo.z, ld.z, S.hd]]) {
        if (Math.abs(v) < 1e-8) {
          if (p < -h || p > h) {
            t0 = Infinity;
            break;
          }
          continue;
        }
        let ta = (-h - p) / v, tb = (h - p) / v;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          t0 = Infinity;
          break;
        }
      }
      if (t0 < maxT) best = { t: t0, part: 'shield', merc: this };
    }
    const lim = best ? best.t : maxT;
    const test = (t, part) => {
      if (t >= 0 && t < lim && (!best || t < best.t)) best = { t, part, merc: this };
    };
    b.head.getWorldPosition(_a);
    test(raySphere(o.x, o.y, o.z, d.x, d.y, d.z, _a.x, _a.y + 0.1, _a.z, 0.13), 'head');
    b.hips.getWorldPosition(_a);
    b.neck.getWorldPosition(_b);
    test(rayCapsule(o, d, _a, _b, 0.2), 'torso');
    for (const s of ['L', 'R']) {
      b['thigh' + s].getWorldPosition(_a);
      b['shin' + s].getWorldPosition(_b);
      test(rayCapsule(o, d, _a, _b, 0.085), 'leg');
      b['foot' + s].getWorldPosition(_c);
      test(rayCapsule(o, d, _b, _c, 0.07), 'leg');
    }
    return best;
  }

  /** damage (amount before the part multiplier); returns { killed, dealt } */
  hurt(amount, part, dir, source, opts = {}) {
    if (!this.alive) return { killed: false, dealt: 0 };
    const dmg = amount * (MERC.part[part] ?? 1);
    this.hp -= dmg;
    this.lastHitBy = source ?? this.lastHitBy;
    this.flinchV = (this.flinchV ?? 0) + clamp(dmg / 30, 0.25, 1) * 6;
    // shot by someone it doesn't see yet: it turns on them
    if (source && source !== this.target && (source.isPlayer || source.stats) && Math.random() < 0.5) {
      this.target = source;
      this.targetT = 1.2;
    }
    if (this.hp > 0) return { killed: false, dealt: dmg };
    this.hp = 0;
    this.alive = false;
    this.inPlay = false;
    this.deadT = 0;
    this.fallDir = dir && dir.dot(_v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))) > 0 ? 1 : -1;
    this.bones.handR.attach(this.gunHolder);
    this.game.mercs.onKilled(this, source, part === 'head', opts);
    return { killed: true, dealt: dmg };
  }

  /** Teammate API (blasts, the knife through game code that treats it like one of the team) */
  takeDamage(amount, fromPos, source) {
    const dir = fromPos ? _d.copy(this.pos).sub(fromPos).setY(0).normalize() : null;
    this.hurt(amount, 'torso', dir, source);
  }

  // ------------------------------------------------------------------ the fight
  update(dt) {
    const game = this.game, M = MERC;
    if (!this.alive) {
      // (shot off the rope it drops to the ground first)
      this.body.vel.x = damp(this.body.vel.x, 0, 4, dt);
      this.body.vel.z = damp(this.body.vel.z, 0, 4, dt);
      game.world.moveBody(this.body, dt);
      this._animateDead(dt);
      if (this.deadT > M.corpse) this.hide();
      return;
    }
    if (!this.inPlay) return; // the drop poses it
    const pos = this.pos;
    this.level = levelOf(pos.y + 0.3);
    const shield = this.role === 'shield';

    // ---- whom to shoot: the nearest of the fireteam it can see (else the nearest), rechecked a few times a second
    if ((this.targetT -= dt) <= 0 || !this.target?.alive) {
      this.targetT = rand(0.3, 0.5);
      let best = null, bs = Infinity, bestLos = false;
      for (const t of game.team) {
        if (!t.alive) continue;
        const d = t.pos.distanceTo(pos);
        const los = d < M.range[this.role] + 8 && game.world.lineOfSight(pos.x, pos.y + 1.55, pos.z, t.pos.x, t.pos.y + 1.3, t.pos.z);
        const s = d - (los ? 8 : 0) + (t.isPlayer ? -2 : 0); // the player a little first: it's you they came for
        if (s < bs) {
          bs = s;
          best = t;
          bestLos = los;
        }
      }
      if (best !== this.target || (bestLos && !this.los)) this.acquire = rand(MERC.acquire[0], MERC.acquire[1]); // it has to find them first
      this.target = best;
      this.los = bestLos;
    }
    this.acquire = (this.acquire ?? 0) - dt;
    const tgt = this.target;
    let wantX = 0, wantZ = 0, speed = 0;
    let dist = Infinity;
    if (tgt) {
      dist = Math.hypot(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
      const range = M.range[this.role];
      const [near, far] = M.stop[this.role];
      if (!this.los || dist > range) {
        // close in along the squad's field (it leads to the one they hunt)
        const st = game.mercs.steer(this.level, pos.x, pos.z);
        if (st && Math.abs(st.dirX) + Math.abs(st.dirZ) > 1e-3) {
          wantX = st.dirX;
          wantZ = st.dirZ;
          if (st.portal && !this.portalTo) {
            this.portalTo = st.portalTo;
            this.portalT = 0;
          }
        } else {
          wantX = tgt.pos.x - pos.x;
          wantZ = tgt.pos.z - pos.z;
        }
        if (this.portalTo) {
          this.portalT += dt;
          if (this.level === this.portalTo.level || this.portalT > 8) this.portalTo = null;
          else {
            wantX = this.portalTo.x - pos.x;
            wantZ = this.portalTo.z - pos.z;
          }
        }
        speed = shield ? M.shieldRun : M.run;
      } else if (dist > far) {
        // in sight but far: push in, shooting
        const st = game.mercs.steer(this.level, pos.x, pos.z);
        wantX = st ? st.dirX : tgt.pos.x - pos.x;
        wantZ = st ? st.dirZ : tgt.pos.z - pos.z;
        speed = M.walk * (shield ? 1.2 : 1);
      } else if (dist < near && !shield) {
        // too close: give ground
        wantX = pos.x - tgt.pos.x;
        wantZ = pos.z - tgt.pos.z;
        speed = M.walk;
      } else if (!shield) {
        // holding: a sidestep now and then
        if ((this.strafeT -= dt) <= 0) {
          this.strafeT = rand(1.4, 3.2);
          this.strafe = Math.random() < 0.55 ? (Math.random() < 0.5 ? -1 : 1) : 0;
          this.strafeLeft = rand(0.5, 0.9);
        }
        if (this.strafe && (this.strafeLeft -= dt) > 0) {
          const ax = tgt.pos.x - pos.x, az = tgt.pos.z - pos.z;
          wantX = -az * this.strafe;
          wantZ = ax * this.strafe;
          speed = M.walk;
        }
      }
      const l = Math.hypot(wantX, wantZ);
      if (l > 1e-4) {
        wantX /= l;
        wantZ /= l;
      }
    }
    // keep apart from each other
    for (const o of game.mercs.list) {
      if (o === this || !o.inPlay) continue;
      const ox = pos.x - o.pos.x, oz = pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < 1.2 && d2 > 1e-5) {
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

    // ---- aim: at whom it shoots (the shield always turned to them), else the way it goes
    let faceYaw = this.yaw, wantPitch = 0;
    if (tgt && (this.los || shield)) {
      faceYaw = Math.atan2(tgt.pos.x - pos.x, tgt.pos.z - pos.z);
      wantPitch = Math.atan2(tgt.pos.y + 1.25 - (pos.y + 1.5), Math.max(0.5, dist));
    } else if (Math.hypot(wantX, wantZ) > 0.1) faceYaw = Math.atan2(wantX, wantZ);
    this.yaw = dampAngle(this.yaw, faceYaw, shield ? 9 : 7, dt);
    this.aimPitch = damp(this.aimPitch, wantPitch, 8, dt);
    this.root.rotation.y = this.yaw;

    // ---- fire
    const G = this.gunDef;
    this.cooldown -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) this.mag = G.mag;
    } else if (tgt && this.los && this.acquire <= 0 && dist < M.range[this.role] && this.cooldown <= 0 && Math.abs(wrapAngle(faceYaw - this.yaw)) < 0.2) {
      if (this.burst <= 0) this.burst = shield ? 1 : Math.floor(rand(G.burst[0], G.burst[1] + 1));
      this._fire(tgt, dist);
      this.burst--;
      this.cooldown = this.burst > 0 ? 60 / G.rpm : rand(G.pause[0], G.pause[1]);
      if (--this.mag <= 0) {
        this.reloadT = this.reloadDur = G.reload;
        this.burst = 0;
        game.audio.play(shield ? 'pistol_reload' : 'm4_reload', { position: pos, volume: 0.45 });
      }
    }
    this.crouch = damp(this.crouch, shield ? 0.25 : this.los && speed < 0.5 && this.index % 2 === 1 ? 0.9 : 0, 4, dt);
    this.recoil = damp(this.recoil, 0, 14, dt);
    this._animate(dt);
  }

  /** one round at the target: a red tracer from the muzzle, the hit on whoever of the fireteam is in the way */
  _fire(tgt, dist) {
    const game = this.game, G = this.gunDef;
    this.recoil = 1;
    this.lastShotT = game.time;
    this.root.updateMatrixWorld(true);
    const muzzle = this.gun.localToWorld(_c.copy(this.muzzleLocal));
    const eye = _o.set(this.pos.x, this.pos.y + 1.52, this.pos.z);
    // aim at the chest; a moving target is harder, a crouching one smaller
    const moving = tgt.body ? Math.hypot(tgt.body.vel.x, tgt.body.vel.z) : 0;
    _a.set(tgt.pos.x, tgt.pos.y + (tgt.isPlayer && tgt.crouching ? 0.85 : 1.2) + rand(-0.15, 0.25), tgt.pos.z);
    _d.copy(_a).sub(eye).normalize();
    const err = (G.spread + dist * 0.08 + Math.min(2.5, moving * 0.4)) * DEG;
    const dir = coneDirection(_d, err, _n);
    game.mercs.shot(this, eye, dir, G.dmg * (game.diff?.dmg ?? 1), muzzle);
    game.fx.muzzleWorld(muzzle, dir, this.role === 'shield' ? 0.7 : 0.9);
    const now = game.time;
    if (now - (game.mercs.sfxAt ?? -1) > 0.05) {
      game.mercs.sfxAt = now;
      game.audio.play(this.role === 'shield' ? 'pistol_fire' : 'm4_fire', { position: muzzle, volume: 0.8, pitch: this.role === 'shield' ? 0.95 : 0.9 + rand(-0.02, 0.02) });
    }
    if (Math.random() < 0.3) game.fx.shell(this.role === 'shield' ? 'pistol' : 'rifle', this.gun.localToWorld(_v.copy(this.ejectLocal)), new THREE.Vector3(rand(-1, 1), 2, rand(-1, 1)));
  }

  /** the shield: held by its handle in the left hand; the pistol out past its right edge (else the rifle hold) */
  _holdRifle(dt) {
    if (!this.shield || this.cineGun) return super._holdRifle(dt);
    const b = this.bones;
    this.ready = damp(this.ready ?? 0, this.target && this.los ? 1 : 0.35, 5, dt);
    const rq = this.root.quaternion;
    // the gun along the aim, the wrist ahead of the right shoulder past the shield's edge
    _q.copy(rq).multiply(_qb.setFromEuler(_eu.set(-(this.aimPitch * this.ready) + this.recoil * 0.08 + (1 - this.ready) * 0.5, Math.PI, 0)));
    b.upperArmR.getWorldPosition(_G);
    _G.add(_T.set(-0.16, 0.16 * this.ready - 0.05, 0.5 * this.ready + 0.25).applyQuaternion(rq));
    this.gunHolder.position.copy(this.mesh.worldToLocal(_T.copy(_G)));
    this.gunHolder.quaternion.copy(this.mesh.getWorldQuaternion(_qb).invert().multiply(_q));
    const h = this.hands;
    _T.copy(this.hold.wristR).applyQuaternion(_q).add(_G);
    _pole.set(-0.8, -1, -0.2).applyQuaternion(rq);
    reach(b.upperArmR, b.foreArmR, b.handR, _T, _pole, _al.set(-0.1, 0.35, -0.93).normalize().applyQuaternion(_q), _pl.set(-1, 0, 0).applyQuaternion(_q), h.R);
    // left hand on the shield's handle, knuckles forward
    this.mesh.localToWorld(_T.copy(this.handleLocal));
    _pole.set(0.8, -0.6, -0.4).applyQuaternion(rq);
    reach(b.upperArmL, b.foreArmL, b.handL, _T, _pole, _al.set(0, 1, 0.2).normalize().applyQuaternion(rq), _pl.set(-1, 0, 0).applyQuaternion(rq), h.L);
  }
}

/**
 * The squad: four Mercs (one with the shield), the black helicopter and the drop. game.mercs.
 */
export class MercSquad {
  constructor(game) {
    this.game = game;
    this.list = [];
    for (let i = 0; i < 4; i++) {
      const m = new Merc(game, i, i === 0 ? 'shield' : 'rifle');
      game.scene.add(m.root);
      this.list.push(m);
    }
    this.chopper = null; // the black helicopter, built on the first drop
    this.src = [{ level: 1, x: 0, z: 0 }]; // the squad's field leads to the one they hunt
    this.field = null;
    this.fieldT = 0;
    this.reset();
  }

  reset() {
    for (const m of this.list) {
      m.hide();
      m.inPlay = false;
    }
    this.phase = 'idle';
    this.t = 0;
    this.site = null;
    this.squadDown = false;
    if (this.chopper) this.chopper.show(false);
  }

  /** the drop is under way or any of them still stands: the round isn't over */
  get active() {
    if (this.list.some((m) => m.alive && m.root.visible)) return true;
    return this.phase === 'inbound' && (this.slots?.some((s) => !s.boarded) ?? true); // (its helicopter leaving doesn't count)
  }

  get aliveCount() {
    let n = 0;
    for (const m of this.list) if (m.alive && m.root.visible) n++;
    if (this.phase === 'inbound') n += this.list.filter((m) => !m.root.visible).length;
    return n;
  }

  // ------------------------------------------------------------------ the drop
  /** somewhere in the yard they can land and walk from: 17-28 m out, not under a roof */
  _site() {
    const g = this.game, nav = g.nav;
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(17, 28);
      const x = Math.cos(a) * r * 1.1, z = Math.sin(a) * r;
      if (g.level.isSheltered(x, 0.5, z)) continue;
      if (Math.abs(x) < 15 && Math.abs(z) < 12) continue;
      const i0 = nav.index(1, x, z);
      if (i0 < 0 || !nav.walk[i0] || !(nav.distanceAt(1, x, z) < 1e6)) continue;
      const gy = g.world.groundHeight(x, z, 0.5, 2);
      if (gy > 0.5) continue;
      return new THREE.Vector3(x, gy > -50 ? gy : -0.5, z);
    }
    return new THREE.Vector3(0, -0.5, 22);
  }

  /** send them in (game/events.js 'squad') */
  deploy() {
    const g = this.game;
    if (this.phase !== 'idle') return false;
    for (const m of this.list) {
      m.hide();
      m.inPlay = false;
    }
    if (!this.chopper) {
      this.chopper = new Chopper(g.scene, g.audio, { name: 'NOX 7', serial: 'CONTAINMENT', livery: { base: '#17191c', tint: 0xb4b8be, ink: 'rgba(214,40,28,0.9)' } });
      const cargo = this.chopper.heli.cargo;
      if (cargo) cargo.visible = false;
    }
    const ch = this.chopper, site = (this.site = this._site());
    // in over the fields from across the farm, down to a hover over the site, facing the house
    const a = Math.atan2(site.z, site.x) + rand(-0.5, 0.5);
    const from = new THREE.Vector3(site.x + Math.cos(a) * 150, 44, site.z + Math.sin(a) * 150);
    const mid = new THREE.Vector3(site.x + Math.cos(a) * 55, 26, site.z + Math.sin(a) * 55);
    this.hover = new THREE.Vector3(site.x, site.y + DROP.hover, site.z);
    this.hoverYaw = Math.atan2(-site.x, -site.z);
    ch.flight.setPath([from, mid, this.hover.clone().add(new THREE.Vector3(Math.cos(a) * 12, 3, Math.sin(a) * 12)), this.hover]);
    ch.flight.yaw = Math.atan2(site.x - from.x, site.z - from.z);
    ch.show(true);
    ch.sound(true, 1.25);
    ch.heli.rotor = 1;
    ch.heli.lights = true;
    ch.heli.searchOn = false;
    this.away = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    this.phase = 'inbound';
    this.t = 0;
    this.said = 0;
    this.squadDown = false;
    this.slots = this.list.map((m, i) => ({ m, side: i % 2 ? 1 : -1, t0: DROP.starts[i], landed: false }));
    return true;
  }

  _updateDrop(dt) {
    const g = this.game, ch = this.chopper, h = ch.heli, fl = ch.flight;
    this.t += dt;
    const t = this.t;
    if (t < DROP.arrive) fl.at(smoothstep(0, 1, t / DROP.arrive) * 0.35 + (t / DROP.arrive) * 0.65, dt);
    else if (t < DROP.leave) fl.hover(this.hover, this.hoverYaw, dt);
    else {
      if (!this.leaving) {
        this.leaving = true;
        const p = h.root.position;
        const out = Math.atan2(p.z, p.x);
        fl.setPath([p.clone(), new THREE.Vector3(p.x + Math.cos(out) * 30, p.y + 10, p.z + Math.sin(out) * 30), new THREE.Vector3(p.x + Math.cos(out) * 160, 50, p.z + Math.sin(out) * 160)]);
      }
      fl.at(clamp((t - DROP.leave) / (DROP.gone - DROP.leave), 0, 1) ** 1.6, dt);
    }
    h.root.updateMatrixWorld(true);
    // the searchlight's beam sweeps the yard on the way in and while they rope down
    h.searchOn = t > 4 && t < DROP.up;
    h.searchTarget.set(this.site.x + Math.sin(t * 0.9) * 4, this.site.y, this.site.z + Math.cos(t * 0.7) * 4);
    const ropeLen = HELI.ropeY + h.root.position.y - this.site.y - 0.08 + 0.5;
    h.setRopes(t < DROP.rope || t > DROP.up + 0.6 ? 0 : t < DROP.up ? Math.min(ropeLen, (t - DROP.rope) * 16) : Math.max(0, ropeLen - (t - DROP.up) * 20));
    ch.update(dt);
    // the radio: who they are
    if (this.said === 0 && t > 1.5) {
      this.said = 1;
      g.story?.radioMsg('COMMAND', 'Fireteam, unidentified helicopter inbound over the fields. No transponder. Stay sharp.');
    }
    if (this.said === 1 && t > DROP.rope + 0.4) {
      this.said = 2;
      const who = g.mission?.story ? "Nadja's cure, the reagent and every witness" : 'every witness';
      g.story?.radioMsg('COMMAND', `That's a NOX cleanup crew. NOX made this virus. Their people are dosed with an antigen, the infected won't touch them. They're here to bury it all: ${who}. That means you. Take them down!`);
      g.hud.banner('NOX CLEANUP SQUAD', 'Armed · the infected ignore them · the shield only goes down from the side', 3.6, 'danger');
      g.audio.play('stalker_sting', { volume: 0.35 });
    }
    // the four, in pairs down the two ropes
    const yawH = h.root.rotation.y;
    const lx = _d.set(Math.cos(yawH), 0, -Math.sin(yawH)); // the helicopter's local +x in the world
    for (const s of this.slots) {
      const m = s.m;
      if (s.landed || t < s.t0) continue;
      if (!m.root.visible && !s.boarded) {
        s.boarded = true;
        m.board(h.ropeTop(s.side, _a).clone(), yawH);
      }
      if (!m.alive) continue; // shot off the rope: it falls (Teammate death) and lies where it hits
      const top = h.ropeTop(s.side, _a);
      const u = clamp((t - s.t0) / DROP.slide, 0, 1);
      if (s.gy == null) {
        const gy = g.world.groundHeight(top.x, top.z, 0.3, top.y);
        s.gy = gy > -50 ? gy : this.site.y;
      }
      const y = lerp(top.y - 1.9, s.gy, u * u * (3 - 2 * u));
      m.pos.set(top.x + lx.x * s.side * 0.24, y, top.z + lx.z * s.side * 0.24);
      m.yaw = Math.atan2(-lx.x * s.side, -lx.z * s.side);
      m.cine(dt, { mode: 'rope', rope: { x: top.x, z: top.z }, slide: Math.sin(Math.PI * u) });
      if (u >= 1) {
        s.landed = true;
        m.pos.y = s.gy;
        m.land();
        g.audio.play('land', { position: m.pos, volume: 0.7 });
      }
    }
    if (t > DROP.gone) {
      ch.show(false);
      this.phase = 'idle';
      this.leaving = false;
    }
  }

  // ------------------------------------------------------------------ each frame
  update(dt) {
    const g = this.game;
    if (this.phase === 'inbound') this._updateDrop(dt);
    let any = false;
    for (const m of this.list) {
      if (!m.root.visible) continue;
      any = true;
      if (m.inPlay || !m.alive) m.update(dt);
    }
    if (!any) return;
    // their field toward the one they hunt: the nearest of the fireteam to the squad
    if ((this.fieldT -= dt) <= 0) {
      this.fieldT = 1.1;
      let best = null, bd = Infinity;
      const c = _v.set(0, 0, 0);
      let n = 0;
      for (const m of this.list) {
        if (!m.inPlay) continue;
        c.add(m.pos);
        n++;
      }
      if (n) c.divideScalar(n);
      for (const t of g.team) {
        if (!t.alive) continue;
        const d = t.pos.distanceToSquared(c);
        if (d < bd) {
          bd = d;
          best = t;
        }
      }
      if (best) {
        const s = this.src[0];
        s.level = levelOf(best.pos.y + 0.3);
        s.x = best.pos.x;
        s.z = best.pos.z;
        if (!this.field) this.field = g.nav.makeField(this.src);
        else this.field.recompute();
      }
    }
  }

  /** the way on toward the one they hunt (null: no field yet) */
  steer(level, x, z) {
    return this.field ? this.field.steer(level, x, z, _steer) : null;
  }

  // ------------------------------------------------------------------ their bullets
  /** a round of theirs: the first of the fireteam on the ray before a wall takes it */
  shot(m, origin, dir, dmg, muzzle) {
    const g = this.game;
    const wall = g.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 90, BULLETS, _hit);
    let endT = wall ? wall.t : 90;
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
      g.fx.impact(end, _n.set(wall.nx, wall.ny, wall.nz), wall.box.surface, { silent: Math.random() < 0.5 });
    }
    g.fx.tracer(muzzle, end, { speed: 300, length: 3, width: 0.02, color: [4.5, 0.55, 0.35] });
  }

  // ------------------------------------------------------------------ the fireteam's side
  /** game.hitscan: the nearest of them on the ray (a shield hit has part 'shield'), or null */
  raycast(o, d, maxT) {
    let best = null;
    for (const m of this.list) {
      const h = m.raycast(o, d, best ? best.t : maxT);
      if (h && (!best || h.t < best.t)) best = h;
    }
    return best;
  }

  /** a blast: damage by distance and cover; a shield turned toward it takes most of it */
  explosion(pos, radius, damage, source, opts = {}) {
    const g = this.game;
    for (const m of this.list) {
      if (!m.armed) continue;
      const d = m.pos.distanceTo(pos);
      if (d > radius) continue;
      const k = 1 - d / radius;
      const los = g.world.lineOfSight(pos.x, pos.y + 0.6, pos.z, m.pos.x, m.pos.y + 1.1, m.pos.z);
      let dmg = damage * (0.3 + 0.7 * k) * (los ? 1 : 0.35);
      if (m.shield) {
        const fx = Math.sin(m.yaw), fz = Math.cos(m.yaw);
        const tx = pos.x - m.pos.x, tz = pos.z - m.pos.z, tl = Math.hypot(tx, tz) || 1;
        if ((tx * fx + tz * fz) / tl > 0.45) dmg *= 0.45; // behind its shield
      }
      _v.copy(m.pos).sub(pos).setY(0).normalize();
      const res = m.hurt(dmg, 'torso', _v, source, { explosion: true, weapon: opts.weapon });
      m.knockback(_v.x * 4 * k, 2 * k, _v.z * 4 * k);
      if (source?.isPlayer && res.dealt > 0) {
        g.hitAccum += res.dealt;
        g.hud.hitMarker(res.killed, false);
      }
    }
  }

  /** the knife: the nearest one in the cone ahead (null if none); a shield from the front turns the blade */
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
    if (!best) return null;
    let blocked = false;
    if (best.shield) {
      const fx = Math.sin(best.yaw), fz = Math.cos(best.yaw);
      blocked = -(fwd.x * fx + fwd.z * fz) > 0.4; // coming at its face
    }
    return { merc: best, dist: bd, blocked };
  }

  /** the radar: where they are (and where the helicopter drops them) */
  radarList() {
    const out = [];
    for (const m of this.list) if (m.alive && m.root.visible) out.push({ x: m.pos.x, z: m.pos.z, yaw: m.yaw });
    if (this.phase === 'inbound' && this.site && this.t < DROP.starts[3] + DROP.slide) out.push({ x: this.site.x, z: this.site.z, drop: true });
    return out;
  }

  /** one of them down: pay the fireteam, the kill feed, and when the last falls, the all-clear */
  onKilled(m, source, headshot, opts = {}) {
    const g = this.game;
    g.economy.payAll(MERC.reward * (g.events?.payMul ?? 1), 'kill');
    g.audio.play('zombie_death', { position: m.pos, volume: 0.4, pitch: 0.7 });
    setTimeout(() => g.running && g.audio.play('bodyfall', { position: m.pos, volume: 0.8 }), 550);
    if (Math.random() < 0.45) g.pickups.spawnSupply(Math.random() < 0.6 ? 'red' : 'white', m.pos);
    const killer = source?.isPlayer ? 'You' : source?.name ?? '';
    g.hud.addKill?.({ killer, victim: 'NOX Operative', weapon: opts.explosion ? 'EXPLOSION' : (WEAPONS[opts.weapon]?.name ?? source?.weaponName ?? ''), headshot });
    if (source?.isPlayer) {
      const pts = Math.round(MERC.score * (headshot ? 1.5 : 1));
      g.score += pts;
      g.player.stats.kills++;
      if (headshot) g.player.stats.headshots++;
      g.player.stats.score = g.score;
      g.hud.popScore(pts, headshot ? 'HEADSHOT' : 'NOX DOWN');
      g.onMercKilledByPlayer?.(m, headshot, opts);
    } else if (source?.stats) {
      source.stats.kills++;
      source.stats.score += MERC.score;
    }
    if (!this.squadDown && this.list.every((x) => !x.alive || !x.root.visible)) {
      this.squadDown = true;
      setTimeout(() => {
        if (!g.running) return;
        g.hud.banner('SQUAD DOWN', 'The NOX cleanup crew is dead', 2.8, 'success');
        g.story?.radioMsg('COMMAND', "Cleanup crew is down. Good work, Fireteam. NOX won't stop at one.");
      }, 900);
    }
  }
}
