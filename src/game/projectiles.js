// Physical projectiles: frag grenades (bounce, fuse), 40mm rounds (impact), Molotovs (shatter on
// impact into a fire pool), Striker death shells, and the store's specials:
//   mine       the M16A1 bounding mine: it lands, stands up, arms (a click, a slow red blink), and when an
//              infected or a NOX operative steps within def.trigger it clicks, jumps to waist height and bursts
//              (no friendly fire)
//   pipebomb   the lure (L4D's pipe bomb): beeping faster and faster, it pulls the horde to it (game.js
//              lureStart / lureEnd), then blows
import * as THREE from 'three';
import { buildThirdPersonWeapon } from '../player/gunSafe.js';
import { rand } from '../core/utils.js';
import { FLAG_NOBULLET } from '../world/collision.js';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { buildCharge, buildMineModel } from '../player/throwables.js';

const _hit = {};
const _rag = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const filter = (b) => (b.flags & FLAG_NOBULLET) === 0;
const CHARGE_SCALE = 1.5; // chunky enough to read at combat distance (~26 cm pipe)
const MINES_MAX = 8; // planted at once: the oldest goes when a ninth lands

export class Projectiles {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.list = [];
    this.fragProto = null;
    try {
      this.fragProto = buildThirdPersonWeapon('m67');
    } catch (e) {
      this.fragProto = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), new THREE.MeshStandardMaterial({ color: 0x3a4028, roughness: 0.6 }));
    }
    this.roundGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.1, 10);
    this.roundGeo.rotateX(Math.PI / 2);
    this.roundMat = new THREE.MeshStandardMaterial({ color: 0x9a8a40, metalness: 0.7, roughness: 0.4 });
    this.chargeProto = buildCharge();
  }

  _add(mesh, p) {
    mesh.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    mesh.position.copy(p.pos);
    this.scene.add(mesh);
    p.mesh = mesh;
    this.list.push(p);
    return p;
  }

  throwFrag(pos, vel, owner, def) {
    const mesh = this.fragProto.clone();
    return this._add(mesh, { kind: 'frag', pos: pos.clone(), vel: vel.clone(), fuse: def.fuse, owner, def, spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), bounces: 0, radius: 0.05 });
  }

  _mineProto() {
    return (this.mine ??= buildMineModel());
  }

  /** an M16A1 mine: tossed a few metres, it stands up where it lands and arms (see _mine) */
  throwMine(pos, vel, owner, def) {
    const mines = this.list.filter((p) => p.kind === 'mine');
    if (mines.length >= MINES_MAX) {
      const old = mines[0];
      this.scene.remove(old.mesh);
      this.list.splice(this.list.indexOf(old), 1);
    }
    const mesh = this._mineProto().clone(true);
    const led = mesh.getObjectByName('led');
    led.material = led.material.clone();
    const glow = mesh.getObjectByName('glow');
    glow.material = glow.material.clone();
    return this._add(mesh, { kind: 'mine', state: 'flying', pos: pos.clone(), vel: vel.clone(), fuse: Infinity, owner, def, spin: new THREE.Vector3(rand(-5, 5), rand(-3, 3), rand(-5, 5)), bounces: 0, radius: 0.05, led, glow, pin: mesh.getObjectByName('pin'), blink: 0 });
  }

  /** the pipe bomb: bounces and rolls like the Striker's charge, beeps, lures, blows */
  throwPipeBomb(pos, vel, owner, def) {
    const mesh = this.chargeProto.clone(true);
    const led = mesh.getObjectByName('led');
    led.material = led.material.clone();
    const glow = mesh.getObjectByName('glow');
    glow.material = glow.material.clone();
    mesh.scale.setScalar(1.25);
    return this._add(mesh, {
      kind: 'pipebomb',
      pos: pos.clone(),
      vel: vel.clone(),
      fuse: def.fuse,
      owner,
      def,
      bounces: 0,
      radius: 0.05,
      spin: new THREE.Vector3(rand(-10, 10), rand(-4, 4), rand(-10, 10)),
      led,
      glow,
      tip: mesh.getObjectByName('fuseTip'),
      blink: 0,
      lure: null,
      lureT: 1.5,
    });
  }

  /** a mine on the ground: arming, the blink, the trigger, the jump (its flight and burst run in update) */
  _mine(p, dt) {
    const game = this.game;
    if (p.state === 'planted') {
      if ((p.armT -= dt) <= 0) {
        p.state = 'armed';
        p.blink = 0;
        game.audio.play('mine_arm', { position: p.pos, volume: 0.7 });
      }
    } else if (p.state === 'armed') {
      p.blink += dt;
      const on = p.blink % 1.6 < 0.13;
      p.led.material.emissiveIntensity = on ? 12 : 0.3;
      p.glow.material.opacity = on ? 0.9 : 0;
      p.glow.scale.setScalar(on ? 0.12 : 0.001);
      if ((p.scanT = (p.scanT ?? 0) - dt) <= 0) {
        p.scanT = 0.05;
        if (this._mineVictim(p)) {
          p.state = 'triggered';
          p.jumpT = 0.2;
          game.audio.play('mine_click', { position: p.pos, volume: 1 });
        }
      }
    } else if (p.state === 'triggered') {
      p.led.material.emissiveIntensity = 14;
      p.glow.material.opacity = 1;
      p.glow.scale.setScalar(0.16);
      if ((p.jumpT -= dt) <= 0) {
        // the propelling charge throws the can up to about waist height, where it bursts
        p.state = 'jumping';
        p.vel.set(0, 5.2, 0);
        p.fuse = 0.26;
        p.spin = new THREE.Vector3(rand(-7, 7), rand(-3, 3), rand(-7, 7));
        game.audio.play('mine_jump', { position: p.pos, volume: 1 });
        for (let k = 0; k < 14; k++) {
          const a = Math.random() * Math.PI * 2;
          game.fx.sparks?.emit(p.pos.x, p.pos.y + 0.05, p.pos.z, Math.cos(a) * rand(1, 3), rand(1, 3), Math.sin(a) * rand(1, 3), { life: rand(0.15, 0.35), length: 0.02, color: [5, 2.6, 1], width: 0.008, gravity: 9.8, drag: 1 });
        }
      }
    }
  }

  /** anything hostile standing on it: an infected (not the Stalker) or one of the NOX squad */
  _mineVictim(p) {
    const game = this.game;
    const r = p.def.trigger;
    for (const { zombie } of game.zombies.inRadius(p.pos, r)) {
      if (zombie.alive && zombie.typeName !== 'stalker' && Math.abs(zombie.pos.y - p.pos.y) < 1.2) return true;
    }
    for (const m of game.mercs?.list ?? []) {
      if (m.alive && m.inPlay && m.root.visible && Math.hypot(m.pos.x - p.pos.x, m.pos.z - p.pos.z) < r && Math.abs(m.pos.y - p.pos.y) < 1.2) return true;
    }
    return false;
  }

  /** the mine hits the ground: it stands up there (the safety pin long gone) and starts arming */
  _plant(p) {
    const world = this.game.world;
    const g = world.groundHeight(p.pos.x, p.pos.z, 0.06, p.pos.y + 0.3);
    if (g > -50) p.pos.y = g;
    p.state = 'planted';
    p.armT = p.def.arm;
    p.vel.set(0, 0, 0);
    p.spin = null;
    p.mesh.rotation.set(0, Math.random() * Math.PI * 2, 0);
    p.mesh.position.copy(p.pos);
    if (p.pin) p.pin.visible = false;
    this.game.audio.play('grenade_bounce', { position: p.pos, volume: 0.6, pitch: 0.7 });
  }

  _molotovProto() {
    if (this.molotov) return this.molotov;
    const gltf = getGLB(MODELS.molotov);
    const src = gltf?.scene.getObjectByName('MOLOTOV');
    let proto;
    if (src) {
      // the normalized model's root sits at the grip; keep only the meshes, rag tip for trailing flames
      proto = new THREE.Group();
      for (const c of src.children) if (c.isMesh || c.children.some((k) => k.isMesh)) proto.add(c.clone());
      const rag = src.getObjectByName('molotov_rag');
      proto.userData.rag = rag ? rag.position.clone().sub(src.getObjectByName('molotov_web')?.position ?? new THREE.Vector3()) : new THREE.Vector3(0, 0.25, 0);
    } else {
      proto = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.22, 12), new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.2, metalness: 0.1 }));
      proto.userData.rag = new THREE.Vector3(0, 0.14, 0);
    }
    this.molotov = proto;
    return proto;
  }

  throwMolotov(pos, vel, owner, def) {
    const proto = this._molotovProto();
    const mesh = proto.clone();
    mesh.userData.rag = proto.userData.rag;
    return this._add(mesh, { kind: 'molotov', pos: pos.clone(), vel: vel.clone(), fuse: 8, owner, def, spin: new THREE.Vector3(rand(-10, -5), rand(-3, 3), rand(-2, 2)), bounces: 0, radius: 0.05 });
  }

  launch40(pos, dir, owner, def) {
    const mesh = new THREE.Mesh(this.roundGeo, this.roundMat);
    const p = this._add(mesh, { kind: 'round40', pos: pos.clone(), vel: dir.clone().multiplyScalar(def.velocity), fuse: 8, owner, def, traveled: 0, radius: 0.03 });
    mesh.lookAt(pos.clone().add(dir));
    return p;
  }

  strikerShells(pos) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + rand(-0.4, 0.4);
      const v = new THREE.Vector3(Math.cos(a) * rand(2, 3.5), rand(2.5, 4), Math.sin(a) * rand(2, 3.5));
      const mesh = this.chargeProto.clone(true);
      // own LED / halo materials so the three timers blink independently
      const led = mesh.getObjectByName('led');
      led.material = led.material.clone();
      const glow = mesh.getObjectByName('glow');
      glow.material = glow.material.clone();
      mesh.rotation.set(rand(0, 6.3), rand(0, 6.3), rand(0, 6.3));
      mesh.scale.setScalar(CHARGE_SCALE);
      this._add(mesh, {
        kind: 'shell',
        pos: pos.clone().add(new THREE.Vector3(0, 1.1, 0)),
        vel: v,
        fuse: 1.4 + i * 0.25,
        owner: null,
        def: { damage: 55, radius: 3.6 },
        bounces: 0,
        radius: 0.04 * CHARGE_SCALE,
        spin: new THREE.Vector3(rand(-14, 14), rand(-6, 6), rand(-14, 14)),
        led,
        glow,
        tip: mesh.getObjectByName('fuseTip'),
        blink: 0,
      });
    }
  }

  /** Striker charge: roll when on the ground, timer LED + beep speeding up, fuse sparks. */
  _charge(p, dt) {
    const game = this.game;
    if (p.grounded) {
      // lying flat, axis across the roll direction, turning with the ground speed (cap radius 3.6 cm, scaled)
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (hs > 0.05) p.rollDir = Math.atan2(p.vel.x, p.vel.z);
      p.roll = (p.roll ?? 0) + (hs * dt) / (0.036 * CHARGE_SCALE);
      _qa.setFromAxisAngle(_UP, p.rollDir ?? 0);
      _qb.setFromAxisAngle(_Z, Math.PI / 2);
      _qc.setFromAxisAngle(_UP, p.roll);
      p.mesh.quaternion.copy(_qa).multiply(_qb).multiply(_qc);
    }
    // timer: the blink (and beep) interval shrinks with the fuse; solid red for the last 0.3 s
    let on = true;
    if (p.fuse > 0.3) {
      const period = Math.max(0.08, Math.min(0.5, p.fuse * 0.3));
      p.blink += dt;
      if (p.blink >= period) {
        p.blink = 0;
        game.audio.play('charge_beep', { position: p.pos, volume: p.kind === 'pipebomb' ? 0.85 : 0.5, pitch: 1 + (1.5 - Math.min(1.5, p.fuse)) * 0.3 });
      }
      on = p.blink < period * 0.45;
    }
    p.led.material.emissiveIntensity = on ? 10 : 0.3;
    p.glow.material.opacity = on ? 0.85 : 0;
    p.glow.scale.setScalar(on ? (p.fuse <= 0.3 ? 0.26 : 0.15) : 0.001);
    // burning fuse
    if (Math.random() < 0.6) {
      p.mesh.updateMatrixWorld();
      p.tip.getWorldPosition(_tip);
      game.fx.sparks.emit(_tip.x, _tip.y, _tip.z, rand(-1, 1), rand(0.4, 2), rand(-1, 1), { life: rand(0.08, 0.22), length: 0.012, color: [6, 3.2, 1.2], width: 0.006, gravity: 6, drag: 1.5 });
    }
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.mesh);
    this.list.length = 0;
  }

  update(dt) {
    const game = this.game;
    const world = game.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.kind === 'mine' && p.state !== 'flying' && p.state !== 'jumping') {
        this._mine(p, dt); // on the ground: no physics
        continue;
      }
      // the lure starts once it lies still (or after a while in the air): the field needs the floor it's on
      if (p.kind === 'pipebomb' && !p.lure && ((p.lureT -= dt) <= 0 || (p.grounded && p.vel.lengthSq() < 1))) game.lureStart?.(p);
      p.fuse -= dt;
      let explode = p.fuse <= 0;
      if (!explode) {
        p.vel.y -= (p.kind === 'round40' ? 6 : 9.8) * dt;
        const sp = p.vel.length();
        const step = sp * dt;
        if (step > 1e-5) {
          const dx = p.vel.x / sp, dy = p.vel.y / sp, dz = p.vel.z / sp;
          // zombies (impact rounds)
          if (p.kind === 'round40' || p.kind === 'molotov') {
            const zh = game.zombies.raycastAll(p.pos, new THREE.Vector3(dx, dy, dz), step + 0.05);
            if (zh.length && (p.kind === 'molotov' || (p.traveled ?? 0) > 2)) {
              p.pos.addScaledVector(p.vel, zh[0].t / sp);
              explode = true;
            }
          }
          if (!explode) {
            const hit = world.raycast(p.pos.x, p.pos.y, p.pos.z, dx, dy, dz, step + p.radius, filter, _hit);
            if (hit) {
              if (p.kind === 'molotov') {
                p.pos.set(p.pos.x + dx * (hit.t - 0.04), p.pos.y + dy * (hit.t - 0.04), p.pos.z + dz * (hit.t - 0.04));
                explode = true;
              } else if (p.kind === 'round40') {
                p.pos.set(p.pos.x + dx * (hit.t - 0.05), p.pos.y + dy * (hit.t - 0.05), p.pos.z + dz * (hit.t - 0.05));
                if ((p.traveled ?? 0) > 2) explode = true;
                else {
                  // too close: dud bounce
                  p.vel.multiplyScalar(-0.2);
                }
              } else {
                const t = Math.max(0, hit.t - p.radius);
                p.pos.set(p.pos.x + dx * t, p.pos.y + dy * t, p.pos.z + dz * t);
                // reflect
                const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
                const vn = p.vel.dot(n);
                p.vel.addScaledVector(n, -(1 + 0.38) * vn);
                p.vel.multiplyScalar(n.y > 0.5 ? 0.62 : 0.8);
                if (p.spin) p.spin.multiplyScalar(0.7);
                if ((p.kind === 'shell' || p.kind === 'pipebomb') && n.y > 0.5) {
                  p.grounded = true; // from here on it lies flat and rolls (see _charge)
                  p.spin = null;
                }
                if (p.kind === 'mine' && p.state === 'flying' && n.y > 0.5) this._plant(p);
                if (Math.abs(vn) > 1.5) game.audio.play(p.kind === 'shell' ? 'shell_casing' : 'grenade_bounce', { position: p.pos, volume: Math.min(1, Math.abs(vn) / 6) });
                p.bounces++;
              }
            } else {
              p.pos.addScaledVector(p.vel, dt);
              p.traveled = (p.traveled ?? 0) + step;
            }
          }
        }
        if (p.spin) {
          p.mesh.rotation.x += p.spin.x * dt;
          p.mesh.rotation.y += p.spin.y * dt;
          p.mesh.rotation.z += p.spin.z * dt;
        }
        if (p.kind === 'round40' && sp > 1) p.mesh.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
        if (p.kind === 'shell' || p.kind === 'pipebomb') this._charge(p, dt);
        if (p.kind === 'molotov' && Math.random() < 0.8) {
          const r = _rag.copy(p.mesh.userData.rag).applyQuaternion(p.mesh.quaternion).add(p.pos);
          game.fx.fire.emit(r.x, r.y, r.z, rand(-0.2, 0.2), rand(0.3, 0.8), rand(-0.2, 0.2), { life: rand(0.12, 0.25), size: rand(0.12, 0.22), grow: 0.6, drag: 2, gravity: -1, color: [5, 2.6, 1.0], endColor: [1.0, 0.25, 0.05], rotV: rand(-2, 2) });
        }
        p.mesh.position.copy(p.pos);
        if (p.pos.y < -30) p.fuse = 0;
      }
      if (explode) {
        this.scene.remove(p.mesh);
        this.list.splice(i, 1);
        if (p.kind === 'molotov') {
          game.igniteMolotov(p.pos, p.owner, p.def);
          continue;
        }
        if (p.kind === 'pipebomb') game.lureEnd?.(p.lure);
        const scale = p.kind === 'shell' ? 0.55 : p.kind === 'round40' ? 0.9 : p.kind === 'pipebomb' ? 1.25 : 1;
        const weapon = p.kind === 'frag' ? 'm67' : p.kind === 'round40' ? 'm32' : p.kind === 'mine' ? 'mine' : p.kind === 'pipebomb' ? 'pipebomb' : 'striker';
        game.explode(p.pos, p.def.radius, p.def.damage, p.owner, { scale, weapon, friendly: p.kind === 'mine' ? 0 : 1 });
      }
    }
  }
}
