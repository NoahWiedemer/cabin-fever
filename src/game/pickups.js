// Supply boxes dropped by the infected (green = health, red = full ammo + grenades,
// white = rifle ammo) and weapon pickups (special weapons / dropped primaries).
import * as THREE from 'three';
import { buildProp } from '../world/propsSafe.js';
import { buildThirdPersonWeapon } from '../player/gunSafe.js';
import { tex } from '../world/textures.js';
import { WEAPONS } from '../player/weaponDefs.js';

const COLORS = { green: 0x40ff70, red: 0xff4030, white: 0xdfe8ff };

export class Pickups {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.list = [];
    let glow = null;
    try {
      glow = tex('glow').map;
    } catch (e) {
      /* optional */
    }
    this.glowMap = glow;
    this.protos = {};
  }

  _glow(color, size) {
    if (!this.glowMap) return null;
    const s = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.glowMap, color: new THREE.Color(color).multiplyScalar(1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false })
    );
    s.scale.setScalar(size);
    return s;
  }

  _proto(kind) {
    if (this.protos[kind]) return this.protos[kind];
    const type = kind === 'green' ? 'supplyBoxGreen' : kind === 'red' ? 'supplyBoxRed' : 'supplyBoxWhite';
    let obj;
    try {
      obj = buildProp(type).object;
    } catch (e) {
      obj = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: COLORS[kind] }));
    }
    this.protos[kind] = obj;
    return obj;
  }

  spawnSupply(kind, pos) {
    const g = new THREE.Group();
    const box = this._proto(kind).clone();
    box.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    g.add(box);
    const gl = this._glow(COLORS[kind], 1.1);
    if (gl) {
      gl.position.y = 0.2;
      g.add(gl);
    }
    const ground = this.game.world.groundHeight(pos.x, pos.z, 0.2, pos.y + 1.2);
    g.position.set(pos.x, (ground > -50 ? ground : pos.y) + 0.02, pos.z);
    g.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(g);
    this.list.push({ type: 'supply', kind, obj: g, glow: gl, life: 35, t: Math.random() * 10, baseY: g.position.y });
  }

  spawnWeapon(id, pos, { permanent = false, announce = false } = {}) {
    const g = new THREE.Group();
    let w;
    try {
      w = buildThirdPersonWeapon(id);
    } catch (e) {
      w = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.8), new THREE.MeshStandardMaterial({ color: 0x222222 }));
    }
    w.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    w.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.08);
    g.add(w);
    const gl = this._glow(id === 'goldenPunisher' ? 0xffc040 : 0x9fd0ff, 1.6);
    if (gl) g.add(gl);
    g.position.copy(pos).add(new THREE.Vector3(0, 0.12, 0));
    this.scene.add(g);
    const item = { type: 'weapon', id, obj: g, glow: gl, life: permanent ? Infinity : 60, t: 0, baseY: g.position.y, weapon: w };
    this.list.push(item);
    return item;
  }

  clear() {
    for (const p of this.list) this.scene.remove(p.obj);
    this.list.length = 0;
  }

  /** returns the weapon pickup the player may interact with (for the prompt) */
  update(dt, player, input) {
    const game = this.game;
    let prompt = null;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.life -= dt;
      if (p.type === 'supply') {
        p.obj.rotation.y += dt * 0.8;
        p.obj.children[0].position.y = 0.06 + Math.sin(p.t * 2.5) * 0.04;
        if (p.glow) p.glow.material.opacity = 0.6 + Math.sin(p.t * 4) * 0.25;
        if (p.life < 5) p.obj.visible = Math.sin(p.t * 20) > -0.2;
      } else {
        p.obj.rotation.y += dt * 0.6;
        p.obj.position.y = p.baseY + 0.08 + Math.sin(p.t * 2) * 0.05;
        if (p.glow) p.glow.material.opacity = 0.5 + Math.sin(p.t * 3) * 0.3;
      }
      if (p.life <= 0) {
        this.scene.remove(p.obj);
        this.list.splice(i, 1);
        continue;
      }
      if (!player.alive) continue;
      const d = p.obj.position.distanceTo(player.pos.clone().setY(player.pos.y + 0.3));
      if (p.type === 'supply' && d < 1.1) {
        if (this._applySupply(p.kind, player)) {
          this.scene.remove(p.obj);
          this.list.splice(i, 1);
        }
      } else if (p.type === 'weapon' && d < 1.6) {
        prompt = p;
      }
    }
    if (prompt) {
      const def = WEAPONS[prompt.id];
      game.hud?.setPickupPrompt(`Press [E] to pick up ${def.name}`);
      if (input && input.hit('KeyE')) {
        const dropped = game.weapons.giveWeapon(prompt.id);
        this.scene.remove(prompt.obj);
        this.list.splice(this.list.indexOf(prompt), 1);
        game.audio.play('pickup_weapon', { volume: 0.9 });
        game.hud?.banner(def.name, 'Weapon acquired', 1.8, 'success');
        if (dropped && dropped !== prompt.id) {
          this.spawnWeapon(dropped, player.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), { permanent: false });
        }
      }
    } else {
      game.hud?.setPickupPrompt(null);
    }
  }

  _applySupply(kind, player) {
    const game = this.game;
    if (kind === 'green') {
      if (player.hp >= player.maxHp) return false;
      player.hp = player.maxHp;
      game.audio.play('pickup_health', { volume: 0.9 });
      game.hud?.popScore(0, 'HP RESTORED');
    } else if (kind === 'red') {
      game.weapons.refillFull();
      player.ap = Math.max(player.ap, 100); // keep store kevlar
      game.audio.play('pickup_ammo', { volume: 0.9 });
      game.hud?.popScore(0, 'FULL AMMO');
    } else {
      if (!game.weapons.addRifleAmmo()) return false;
      game.audio.play('pickup_ammo', { volume: 0.8 });
      game.hud?.popScore(0, 'AMMO');
    }
    return true;
  }

  radarList() {
    return this.list.map((p) => ({ x: p.obj.position.x, z: p.obj.position.z, kind: p.type === 'weapon' ? 'weapon' : p.kind }));
  }
}
