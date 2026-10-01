// The armoured car at the top of the ramp (Desert Thunder, sector 3: game/desertMission.js): an eight-wheeled BTR with
// a small turret, a cannon and a machine gun beside it. Bullets and blasts only scratch its hull; its weak spot is the
// engine deck at the back, its cover propped open (the crew's been working on it): a grenade in there, or enough rounds
// into the engine, and it burns. While it lives it holds the ramp: the turret turns on whoever it sees (not fast), aims
// for a moment (the barrel settles, a clank from the breech) and fires a shell that bursts where it lands; the machine
// gun rakes anyone closer. game.apc; the mission wakes it (activate) when the fireteam reaches the back street.
import * as THREE from 'three';
import { SURF, FLAG_NOBULLET } from './collision.js';
import { clamp, rand, wrapAngle, coneDirection, rayCapsule } from '../core/utils.js';

export const APC = {
  engineHp: 120, // rifle rounds do their damage x 0.35 through the open cover; a grenade in the bay ends it
  turn: 0.62, // rad/s the turret turns
  aim: 1.15, // s it holds still on you before the shell
  reload: [3.6, 4.6], // s between shells
  shell: { speed: 95, dmg: 80, radius: 3.8 }, // x difficulty damage
  mg: { dmg: 4.5, burst: [6, 12], rpm: 620, pause: [1.0, 1.8], spread: 2.6, range: 55 },
  view: 110, // m it sees you at
  bay: 1.35, // m from the bay's middle a blast has to be to kill it
};

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _hit = {};
const BULLETS = (b) => (b.flags & FLAG_NOBULLET) === 0;

/** the model: hull (the side profile extruded across), eight wheels, the turret with its guns, the open engine deck */
function buildModel() {
  const paint = new THREE.MeshStandardMaterial({ color: 0x8c7c58, roughness: 0.78, metalness: 0.25 });
  const paintDark = new THREE.MeshStandardMaterial({ color: 0x6a5d42, roughness: 0.8, metalness: 0.25 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3c3a, roughness: 0.5, metalness: 0.7 });
  const engine = new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.6, metalness: 0.6, emissive: new THREE.Color(0.35, 0.12, 0.03), emissiveIntensity: 1 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.1, metalness: 0.5 });
  const root = new THREE.Group();
  root.name = 'apc';
  // the hull: its side silhouette (z along, y up) extruded 2.8 m across
  const s = new THREE.Shape();
  const P = [[-3.8, 0.75], [-3.5, 0.5], [3.3, 0.5], [3.85, 0.95], [3.55, 1.45], [2.5, 2.0], [-3.0, 2.0], [-3.8, 1.55]];
  s.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) s.lineTo(P[i][0], P[i][1]);
  s.closePath();
  const hullG = new THREE.ExtrudeGeometry(s, { depth: 2.8, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 1 });
  hullG.translate(0, 0, -1.4);
  hullG.rotateY(-Math.PI / 2); // (the shape's x becomes the length along z)
  const hull = new THREE.Mesh(hullG, paint);
  root.add(hull);
  // sloped upper side plates (a lip along the deck), the wheel arches' fenders
  for (const sx of [-1, 1]) {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 6.0), paintDark);
    lip.position.set(sx * 1.46, 1.55, -0.2);
    lip.rotation.z = sx * 0.35;
    root.add(lip);
  }
  // eight wheels in four axles
  const wheelG = new THREE.CylinderGeometry(0.56, 0.56, 0.42, 18);
  wheelG.rotateZ(Math.PI / 2);
  const hubG = new THREE.CylinderGeometry(0.22, 0.22, 0.44, 10);
  hubG.rotateZ(Math.PI / 2);
  for (const z of [-2.6, -1.25, 0.85, 2.2]) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wheelG, rubber);
      w.position.set(sx * 1.5, 0.56, z);
      root.add(w);
      const h = new THREE.Mesh(hubG, steel);
      h.position.set(sx * 1.52, 0.56, z);
      root.add(h);
    }
  }
  // the driver's vision blocks up front, headlights, tow hooks
  for (const sx of [-0.45, 0.45]) {
    const vb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.06), glass);
    vb.position.set(sx, 1.72, 3.1);
    vb.rotation.x = -0.9;
    root.add(vb);
    const hl = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 10), steel);
    hl.rotation.x = Math.PI / 2;
    hl.position.set(sx * 2.4, 1.0, 3.72);
    root.add(hl);
  }
  // hatches on the deck
  for (const [x, z] of [[-0.7, 1.6], [0.7, 1.6], [0, -0.6]]) {
    const hx = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.08, 14), paintDark);
    hx.position.set(x, 2.04, z);
    root.add(hx);
  }
  // the turret (it turns: `turret`), the cannon and the machine gun in its mantlet (it elevates: `gun`)
  const turret = new THREE.Group();
  turret.position.set(0, 2.0, 0.7);
  root.add(turret);
  const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.85, 0.55, 18), paint);
  tb.position.y = 0.28;
  turret.add(tb);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.3, 0.16, 12), paintDark);
  cup.position.set(-0.25, 0.62, -0.25);
  turret.add(cup);
  const gun = new THREE.Group();
  gun.position.set(0, 0.32, 0.55);
  turret.add(gun);
  const mant = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.36, 0.35), paintDark);
  mant.position.z = 0.1;
  gun.add(mant);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 2.6, 12), steel);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 1.4;
  gun.add(barrel);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.28, 12), steel);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = 2.72;
  gun.add(brake);
  const coax = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8), steel);
  coax.rotation.x = Math.PI / 2;
  coax.position.set(0.18, 0.05, 0.7);
  gun.add(coax);
  // the engine deck at the back: the bay open (the engine's hot iron in it), its cover propped up
  const bay = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.55, 1.5), engine);
  bay.position.set(0, 1.72, -2.1);
  root.add(bay);
  const rimM = new THREE.MeshStandardMaterial({ color: 0x151412, roughness: 0.9 });
  for (const [w, d, x, z] of [[1.6, 0.1, 0, -1.3], [1.6, 0.1, 0, -2.9], [0.1, 1.7, -0.78, -2.1], [0.1, 1.7, 0.78, -2.1]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), rimM);
    r.position.set(x, 2.02, z);
    root.add(r);
  }
  const coverPivot = new THREE.Group();
  coverPivot.position.set(0, 2.04, -1.3);
  root.add(coverPivot);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.06, 1.6), paint);
  cover.position.set(0, 0, -0.8);
  coverPivot.add(cover);
  coverPivot.rotation.x = -1.15; // (propped open, hinged at its front edge)
  const prop = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6), steel);
  prop.position.set(0.6, 2.4, -1.8);
  prop.rotation.x = 0.6;
  root.add(prop);
  // exhausts, a spare wheel, a jerrycan, a tarp roll on the back
  const ex = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 0.9), steel);
  ex.position.set(1.2, 1.7, -3.1);
  root.add(ex);
  const tarp = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.8, 10), new THREE.MeshStandardMaterial({ color: 0x5a5a3a, roughness: 0.95 }));
  tarp.rotation.z = Math.PI / 2;
  tarp.position.set(0, 2.2, -3.2);
  root.add(tarp);
  root.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
  return { root, turret, gun, bay, coverPivot, engineMat: engine, muzzleZ: 2.9 };
}

export class Apc {
  /** at (x, y, z) facing yaw (a vehicle facing +z has yaw 0); scene: where its model goes; game: attach() later */
  constructor(scene, world, x, y, z, yaw) {
    this.m = buildModel();
    this.root = this.m.root;
    this.root.position.set(x, y, z);
    this.root.rotation.y = yaw;
    scene.add(this.root);
    this.world = world;
    this.name = 'BTR-80'; // (the kill feed: a shell that downs you names it)
    this.isHostile = true;
    this.pos = new THREE.Vector3(x, y, z);
    this.yaw = yaw;
    // the hull and the turret block; the engine bay is its own box (a hit there counts: game.js hitscan)
    this.boxes = [
      world.addOBB(x, z, 1.45, 3.85, yaw, y + 0.35, y + 2.05, SURF.metal, 0, 'apc'),
      world.addOBB(x + Math.sin(yaw) * 0.7, z + Math.cos(yaw) * 0.7, 0.8, 0.8, yaw, y + 2.05, y + 2.6, SURF.metal, 0, 'apc'),
    ];
    const bz = -2.1;
    this.bayAt = new THREE.Vector3(x + Math.sin(yaw) * bz, y + 1.9, z + Math.cos(yaw) * bz);
    this.bayBox = world.add(this.bayAt.x - 0.7, y + 1.45, this.bayAt.z - 0.7, this.bayAt.x + 0.7, y + 2.05, this.bayAt.z + 0.7, SURF.metal, 0, 'apcEngine');
    this.game = null;
    this.reset();
  }

  attach(game) {
    this.game = game;
  }

  reset() {
    this.alive = true;
    this.active = false;
    this.hp = APC.engineHp;
    this.turretYaw = 0; // (relative to the hull)
    this.pitch = 0;
    this.target = null;
    this.targetT = 0;
    this.aimT = 0;
    this.cool = 2;
    this.mgCool = 1;
    this.burst = 0;
    this.shells = [];
    this.burnT = 0;
    this.m.turret.position.set(0, 2.0, 0.7);
    this.m.turret.rotation.set(0, 0, 0);
    this.m.gun.rotation.set(0, 0, 0);
    this.m.engineMat.emissive.setRGB(0.35, 0.12, 0.03);
    this.snd?.stop?.(0.3);
    this.snd = null;
  }

  /** the fireteam is on the back street: it starts looking (and the engine's rumble carries) */
  activate() {
    if (!this.alive || this.active) return;
    this.active = true;
    this.cool = 1.5;
    const g = this.game;
    this.snd = g?.audio?.play('apc_engine', { loop: true, position: this.pos, volume: 0.9 });
  }

  get muzzle() {
    this.root.updateMatrixWorld(true);
    return this.m.gun.localToWorld(_a.set(0, 0, this.m.muzzleZ));
  }

  // ------------------------------------------------------------------ being hit
  /** a round into the engine bay (game.js hitscan: the box tagged 'apcEngine') */
  hitEngine(dmg, p, source) {
    if (!this.alive) return;
    this.hp -= dmg * 0.35;
    this.game?.fx.impact(p, _n.set(0, 1, 0), SURF.metal, { noDecal: true });
    if (Math.random() < 0.3) this.game?.fx.smoke.emit(p.x, p.y + 0.2, p.z, rand(-0.3, 0.3), rand(0.5, 1.2), rand(-0.3, 0.3), { life: rand(0.8, 1.6), size: rand(0.3, 0.6), grow: 1.5, drag: 1.5, gravity: -0.4, color: [0.1, 0.09, 0.08], alpha: 0.5 });
    if (source?.isPlayer) this.game?.hud.hitMarker(this.hp <= 0, false);
    this.game?.audio.play('impact_metal', { position: p, volume: 0.7, pitch: 0.8 });
    if (this.hp <= 0) this._destroy(source);
    else if (this.hp < APC.engineHp * 0.5) this.m.engineMat.emissive.setRGB(0.9, 0.3, 0.06);
  }

  /** a blast (game.explode, the militia's rockets): in the bay, it's over; anywhere else only paint comes off */
  explosion(pos, radius, damage, source) {
    if (!this.alive) return;
    const d = pos.distanceTo(this.bayAt);
    if (d < APC.bay) this._destroy(source);
    else if (d < radius && damage > 0) this.hp -= damage * 0.15 * (1 - d / radius);
    if (this.hp <= 0 && this.alive) this._destroy(source);
  }

  _destroy(source) {
    const g = this.game;
    this.alive = false;
    this.active = false;
    this.hp = 0;
    this.snd?.stop?.(0.5);
    this.snd = null;
    const at = this.bayAt.clone();
    g.fx.explosion(at, 2.4);
    setTimeout(() => g.running && g.fx.explosion(this.pos.clone().setY(this.pos.y + 1.8), 1.8), 350);
    g.shake.add(clamp(1.5 - g.player.pos.distanceTo(at) / 30, 0.2, 1));
    g.audio.play('explosion', { position: at, volume: 1, pitch: 0.7 });
    // the turret blown up and off to one side, the engine burning
    this.m.turret.position.y += 0.35;
    this.m.turret.rotation.set(0.35, this.turretYaw + 0.6, 0.25);
    this.m.engineMat.emissive.setRGB(2.2, 0.7, 0.1);
    this.burnT = 60;
    // the fireteam near it takes the blast
    for (const m of g.team) {
      if (!m.alive) continue;
      const dd = m.pos.distanceTo(at);
      if (dd < 5) m.takeDamage(45 * (1 - dd / 5), at, null);
    }
    if (source?.isPlayer) {
      g.score += 1500;
      g.hud.popScore(1500, 'ARMOURED CAR DESTROYED');
    }
    g.hud.addKill?.({ killer: source?.isPlayer ? 'You' : source?.name ?? '', victim: 'BTR-80', weapon: 'EXPLOSION', headshot: false });
    this.onDestroyed?.();
  }

  // ------------------------------------------------------------------ each frame
  update(dt) {
    const g = this.game;
    if (!g) return;
    this._updateShells(dt);
    if (!this.alive) {
      // it burns for a while: flames from the bay, a column of black smoke
      if (this.burnT > 0) {
        this.burnT -= dt;
        const p = this.bayAt;
        if (Math.random() < dt * 30) g.fx.fire.emit(p.x + rand(-0.5, 0.5), p.y + 0.2, p.z + rand(-0.5, 0.5), rand(-0.3, 0.3), rand(1, 2.2), rand(-0.3, 0.3), { life: rand(0.4, 0.8), size: rand(0.6, 1.1), grow: 1.8, drag: 2, gravity: -1.5, color: [5, 2.6, 1.0], endColor: [1.2, 0.3, 0.08] });
        if (Math.random() < dt * 14) g.fx.smoke.emit(p.x + rand(-0.4, 0.4), p.y + 1, p.z + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), { life: rand(3, 5), size: rand(1, 1.8), grow: 1.6, drag: 0.6, gravity: -0.6, color: [0.06, 0.055, 0.05], endColor: [0.18, 0.17, 0.16], alpha: 0.6 });
      }
      return;
    }
    // the exhaust's haze (it idles all the time)
    if (Math.random() < dt * 6) {
      _v.set(1.2, 1.8, -3.5).applyAxisAngle(_n.set(0, 1, 0), this.yaw).add(this.pos);
      g.fx.smoke.emit(_v.x, _v.y, _v.z, rand(-0.2, 0.2), rand(0.4, 0.8), rand(-0.2, 0.2), { life: rand(1, 2), size: rand(0.3, 0.5), grow: 1.4, drag: 1, gravity: -0.3, color: [0.25, 0.24, 0.22], alpha: 0.25 });
    }
    if (!this.active) return;
    // (over the turret's own box: a sight line from inside it would stop right there)
    const turretAt = _a.set(this.pos.x + Math.sin(this.yaw) * 0.7, this.pos.y + 2.75, this.pos.z + Math.cos(this.yaw) * 0.7);
    // ---- whom to shoot: the nearest of the fireteam it can see (the player first)
    if ((this.targetT -= dt) <= 0) {
      this.targetT = 0.4;
      let best = null, bs = Infinity;
      for (const t of g.team) {
        if (!t.alive) continue;
        const d = t.pos.distanceTo(turretAt);
        if (d > APC.view) continue;
        if (!this.world.lineOfSight(turretAt.x, turretAt.y, turretAt.z, t.pos.x, t.pos.y + 1.2, t.pos.z)) continue;
        const s = d + (t.isPlayer ? -6 : 0);
        if (s < bs) {
          bs = s;
          best = t;
        }
      }
      if (best !== this.target) this.aimT = 0;
      this.target = best;
    }
    const tgt = this.target;
    if (!tgt) {
      this.aimT = 0;
      return;
    }
    // ---- turn the turret, raise the gun
    const want = wrapAngle(Math.atan2(tgt.pos.x - turretAt.x, tgt.pos.z - turretAt.z) - this.yaw);
    const dy = wrapAngle(want - this.turretYaw);
    const step = APC.turn * dt;
    const turning = Math.abs(dy) > 0.02;
    this.turretYaw = wrapAngle(this.turretYaw + clamp(dy, -step, step));
    const dist = Math.hypot(tgt.pos.x - turretAt.x, tgt.pos.z - turretAt.z);
    const wantPitch = clamp(Math.atan2(tgt.pos.y + 1.0 - turretAt.y, Math.max(1, dist)), -0.14, 0.35);
    this.pitch += (wantPitch - this.pitch) * Math.min(1, dt * 3);
    this.m.turret.rotation.y = this.turretYaw;
    this.m.gun.rotation.x = -this.pitch;
    if (turning && Math.abs(dy) > 0.12) {
      if ((this.whineT = (this.whineT ?? 0) - dt) <= 0) {
        this.whineT = 0.9;
        g.audio.play('turret_whine', { position: turretAt, volume: 0.5 });
      }
    }
    const onTarget = Math.abs(dy) < 0.05;
    // ---- the cannon: held still on you for a moment, then the shell
    this.cool -= dt;
    if (onTarget && this.cool <= 0) {
      if (this.aimT === 0) g.audio.play('apc_clank', { position: turretAt, volume: 0.8 });
      this.aimT += dt;
      if (this.aimT >= APC.aim) {
        this.aimT = 0;
        this.cool = rand(APC.reload[0], APC.reload[1]);
        this._fireShell(tgt);
      }
    } else if (!onTarget) this.aimT = Math.max(0, this.aimT - dt);
    // ---- the machine gun beside it: bursts at anyone it's turned on and near enough
    this.mgCool -= dt;
    const G = APC.mg;
    if (Math.abs(dy) < 0.12 && dist < G.range && this.mgCool <= 0) {
      if (this.burst <= 0) this.burst = Math.floor(rand(G.burst[0], G.burst[1] + 1));
      this._fireMg(tgt, dist);
      this.burst--;
      this.mgCool = this.burst > 0 ? 60 / G.rpm : rand(G.pause[0], G.pause[1]);
    }
  }

  _fireShell(tgt) {
    const g = this.game, S = APC.shell;
    const from = this.muzzle.clone();
    // where you stand (a little ahead if you run), the aim a little off
    const tv = tgt.body?.vel ?? _v.set(0, 0, 0);
    const lead = from.distanceTo(tgt.pos) / S.speed;
    _b.set(tgt.pos.x + tv.x * lead, tgt.pos.y + 0.8, tgt.pos.z + tv.z * lead);
    _d.copy(_b).sub(from).normalize();
    const dir = coneDirection(_d, 0.9 * (Math.PI / 180), new THREE.Vector3());
    if (!Number.isFinite(dir.x + dir.y + dir.z + from.x + from.y + from.z)) return;
    this.shells.push({ pos: from, vel: dir.multiplyScalar(S.speed), life: 2.5 });
    g.fx.muzzleWorld(from, dir.clone().normalize(), 2.8);
    for (let i = 0; i < 12; i++) g.fx.smoke.emit(from.x, from.y, from.z, dir.x * 0.05 + rand(-1.2, 1.2), rand(-0.2, 1), dir.z * 0.05 + rand(-1.2, 1.2), { life: rand(0.8, 1.8), size: rand(0.6, 1.1), grow: 1.6, drag: 2.5, gravity: -0.2, color: [0.5, 0.47, 0.42], alpha: 0.5 });
    g.audio.play('cannon_fire', { position: from, volume: 1 });
    const dp = g.player.pos.distanceTo(from);
    g.shake.add(clamp(0.8 - dp / 60, 0.05, 0.5));
    // the hull rocks back
    this.root.rotation.x = -0.04;
    setTimeout(() => (this.root.rotation.x = 0), 180);
  }

  _updateShells(dt) {
    const g = this.game;
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.life -= dt;
      const step = s.vel.length() * dt;
      _d.copy(s.vel).normalize();
      const wall = this.world.raycast(s.pos.x, s.pos.y, s.pos.z, _d.x, _d.y, _d.z, step + 0.05, (b) => BULLETS(b) && b.tag !== 'apc' && b.tag !== 'apcEngine', _hit);
      let hitAt = wall ? s.pos.clone().addScaledVector(_d, wall.t) : null;
      for (const t of g.team) {
        if (!t.alive) continue;
        _a.set(t.pos.x, t.pos.y + 0.3, t.pos.z);
        _b.set(t.pos.x, t.pos.y + 1.6, t.pos.z);
        const ht = rayCapsule(s.pos, _d, _a, _b, 0.45);
        if (ht >= 0 && ht < step && (!hitAt || ht < s.pos.distanceTo(hitAt))) hitAt = s.pos.clone().addScaledVector(_d, ht);
      }
      const from = s.pos.clone();
      if (hitAt || s.life <= 0) {
        this._burst(hitAt ?? s.pos, wall ? _n.set(wall.nx, wall.ny, wall.nz) : null);
        g.fx.tracer(from, hitAt ?? s.pos, { speed: 400, length: 6, width: 0.07, color: [6, 3.4, 1.4] });
        this.shells.splice(i, 1);
        continue;
      }
      s.pos.addScaledVector(s.vel, dt);
      g.fx.tracer(from, s.pos, { speed: 400, length: 6, width: 0.07, color: [6, 3.4, 1.4] });
    }
  }

  _burst(p, n) {
    const g = this.game, S = APC.shell;
    const pos = p.clone();
    if (n) pos.addScaledVector(n, 0.3);
    g.fx.explosion(pos, 1.3);
    const dp = g.player.pos.distanceTo(pos);
    g.shake.add(clamp(1.4 - dp / 22, 0, 1));
    if (dp < 10) g.gr.grade.set('uFlash', 0.3 * (1 - dp / 10));
    for (const m of g.team) {
      if (!m.alive) continue;
      const d = m.pos.distanceTo(pos);
      if (d > S.radius) continue;
      if (!this.world.lineOfSight(pos.x, pos.y + 0.4, pos.z, m.pos.x, m.pos.y + 1.0, m.pos.z)) continue;
      const k = 1 - d / S.radius;
      m.takeDamage(S.dmg * (0.3 + 0.7 * k) * (g.diff?.dmg ?? 1), pos, this);
      if (m.knockback) {
        _v.copy(m.pos).sub(pos).setY(0).normalize();
        m.knockback(_v.x * 6 * k, 3.5 * k, _v.z * 6 * k);
      }
    }
  }

  _fireMg(tgt, dist) {
    const g = this.game, G = APC.mg;
    this.root.updateMatrixWorld(true);
    const from = this.m.gun.localToWorld(_a.set(0.18, 0.05, 1.2)).clone();
    _b.set(tgt.pos.x, tgt.pos.y + (tgt.isPlayer && tgt.crouching ? 0.85 : 1.2), tgt.pos.z);
    _d.copy(_b).sub(from).normalize();
    const dir = coneDirection(_d, (G.spread + dist * 0.04) * (Math.PI / 180), new THREE.Vector3());
    // (the militia's bullet code: the first of the fireteam on the line before a wall takes it)
    g.insurgents?.shot({ pos: this.pos, name: 'BTR-80', isHostile: true }, from, dir, G.dmg * (g.diff?.dmg ?? 1), from, [4.8, 2.2, 0.7]);
    g.fx.muzzleWorld(from, dir, 0.8);
    if (g.time - (this.mgSfx ?? -1) > 0.06) {
      this.mgSfx = g.time;
      g.audio.play('lmg_fire', { position: from, volume: 0.9, pitch: 0.82 });
    }
  }
}
