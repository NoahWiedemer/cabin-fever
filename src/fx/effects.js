// High-level visual effects: impacts, blood, explosions, acid clouds, muzzle flashes,
// shell casings and tracers. Owns the particle systems and decals.
import * as THREE from 'three';
import { SpriteParticles, StreakParticles } from './particles.js';
import { Decals } from './decals.js';
import { tex } from '../world/textures.js';
import { buildShellCasing } from '../player/gunSafe.js';
import { MagDrops } from './magDrops.js';
import { SURF } from '../world/collision.js';
import { rand } from '../core/utils.js';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);

function safeMap(name) {
  try {
    return tex(name).map;
  } catch (e) {
    return null;
  }
}

function fallbackTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene, world, lighting, audio) {
    this.scene = scene;
    this.world = world;
    this.lighting = lighting;
    this.audio = audio;
    const fb = fallbackTex();
    const smoke = safeMap('smoke') || fb;
    const fire = safeMap('fire') || fb;
    const glow = safeMap('glow') || fb;
    const flash = safeMap('muzzleFlash') || fb;
    const acid = safeMap('acidPuff') || smoke;
    const dust = safeMap('dust') || fb;

    this.smoke = new SpriteParticles(scene, smoke, { max: 900, additive: false, atlas: 2, renderOrder: 9 });
    this.blood = new SpriteParticles(scene, dust, { max: 1400, additive: false, atlas: 1, renderOrder: 9 });
    this.fire = new SpriteParticles(scene, fire, { max: 500, additive: true, atlas: 2, renderOrder: 12 });
    this.glow = new SpriteParticles(scene, glow, { max: 300, additive: true, atlas: 1, renderOrder: 12 });
    this.flashes = new SpriteParticles(scene, flash, { max: 64, additive: true, atlas: 2, renderOrder: 13 });
    this.acid = new SpriteParticles(scene, acid, { max: 400, additive: false, atlas: 1, renderOrder: 9 });
    this.sparks = new StreakParticles(scene, { max: 900 });
    this.systems = [this.smoke, this.blood, this.fire, this.glow, this.flashes, this.acid];
    this.decals = new Decals(scene);

    // shell casings (instanced per type)
    this.shells = [];
    this.shellMeshes = {};
    for (const type of ['rifle', 'pistol', 'shotgun', 'sniper', 'grenade40']) {
      try {
        const m = buildShellCasing(type);
        let geo = null, mat = null;
        m.traverse((o) => {
          if (o.isMesh && !geo) {
            geo = o.geometry;
            mat = o.material;
          }
        });
        if (!geo) continue;
        const inst = new THREE.InstancedMesh(geo, mat, 60);
        inst.count = 0;
        inst.frustumCulled = false;
        inst.castShadow = false;
        inst.receiveShadow = true;
        scene.add(inst);
        this.shellMeshes[type] = { mesh: inst, items: [], idx: 0 };
      } catch (e) {
        console.warn('shell casing build failed', type, e);
      }
    }
    this.mags = new MagDrops(scene, world, audio); // the player's empty magazines on the floor
    this.acidClouds = [];
    this.fireZones = [];
    this.time = 0;
  }

  setViewport(h, fov) {
    for (const s of this.systems) s.setViewportHeight(h, fov);
  }

  // ------------------------------------------------------------------ impacts
  impact(p, n, surface, opts = {}) {
    const loud = opts.silent ? 0 : 1;
    const sparkCol = [4.5, 3.0, 1.4];
    if (surface === SURF.glass) {
      // armored glass: it chips, it doesn't break. Sparks, glittering splinters, a puff of glass dust
      for (let i = 0; i < 7; i++) {
        _v.copy(n).multiplyScalar(rand(1.5, 5)).add(new THREE.Vector3(rand(-2.5, 2.5), rand(-0.5, 3), rand(-2.5, 2.5)));
        this.sparks.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.08, 0.25), length: 0.015, color: [3.2, 3.6, 3.8], width: 0.006 });
      }
      for (let i = 0; i < 9; i++) {
        _v.copy(n).multiplyScalar(rand(1, 3.5)).add(new THREE.Vector3(rand(-1.2, 1.2), rand(0, 2), rand(-1.2, 1.2)));
        this.glow.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.35, 0.8), size: rand(0.012, 0.025), gravity: 9.8, drag: 0.4, color: [1.4, 1.7, 1.7] });
      }
      for (let i = 0; i < 2; i++) {
        _v.copy(n).multiplyScalar(rand(0.3, 0.9));
        this.smoke.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.4, 0.8), size: rand(0.08, 0.14), grow: 0.5, drag: 3, gravity: -0.05, color: [0.75, 0.8, 0.8], alpha: 0.35 });
      }
      this.glow.emit(p.x + n.x * 0.01, p.y + n.y * 0.01, p.z + n.z * 0.01, 0, 0, 0, { life: 0.05, size: 0.3, color: [2.4, 2.6, 2.8] });
      if (loud) this.audio.play('impact_glass', { position: p, volume: 0.65 });
      if (!opts.noDecal) this.decals.glassChip(p, n, rand(0.1, 0.15));
      return;
    }
    if (surface === SURF.metal) {
      for (let i = 0; i < 10; i++) {
        _v.copy(n).multiplyScalar(rand(2, 7)).add(new THREE.Vector3(rand(-3, 3), rand(-1, 4), rand(-3, 3)));
        this.sparks.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.15, 0.45), length: 0.02, color: sparkCol, width: 0.008 });
      }
      this.glow.emit(p.x + n.x * 0.02, p.y + n.y * 0.02, p.z + n.z * 0.02, 0, 0, 0, { life: 0.06, size: 0.35, color: [3, 2, 1] });
      if (loud) this.audio.play('impact_metal', { position: p, volume: 0.6 });
    } else {
      // dust / splinters
      const dustCol = surface === SURF.wood ? [0.34, 0.27, 0.2] : surface === SURF.mud ? [0.22, 0.18, 0.14] : [0.45, 0.43, 0.4];
      for (let i = 0; i < 4; i++) {
        _v.copy(n).multiplyScalar(rand(0.4, 1.4)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.1, 0.5), rand(-0.3, 0.3)));
        this.smoke.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.5, 1.1), size: rand(0.12, 0.2), grow: 0.55, drag: 3, gravity: -0.05, color: dustCol, alpha: 0.55 });
      }
      const chips = surface === SURF.mud ? 6 : 5;
      for (let i = 0; i < chips; i++) {
        _v.copy(n).multiplyScalar(rand(1.5, 4.5)).add(new THREE.Vector3(rand(-1.5, 1.5), rand(0, 2.5), rand(-1.5, 1.5)));
        this.blood.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.3, 0.7), size: rand(0.012, 0.03), gravity: 9.8, drag: 0.5, color: dustCol.map((c) => c * 0.6), alpha: 1 });
      }
      if (surface !== SURF.mud) {
        for (let i = 0; i < 3; i++) {
          _v.copy(n).multiplyScalar(rand(1, 5)).add(new THREE.Vector3(rand(-2, 2), rand(0, 3), rand(-2, 2)));
          this.sparks.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.06, 0.16), length: 0.015, color: sparkCol, width: 0.006, alpha: 0.7 });
        }
      }
      if (loud) {
        const snd = surface === SURF.wood ? 'impact_wood' : surface === SURF.mud ? 'impact_mud' : 'impact_concrete';
        this.audio.play(snd, { position: p, volume: 0.5 });
      }
    }
    if (surface !== SURF.mud && !opts.noDecal) this.decals.bulletHole(p, n, surface === SURF.metal ? 0.06 : 0.085);
  }

  // ------------------------------------------------------------------ blood
  bloodHit(p, dir, { amount = 1, headshot = false, color = null, decals = true } = {}) {
    const n = Math.round((headshot ? 26 : 12) * amount);
    const base = color ?? [0.32, 0.012, 0.01];
    for (let i = 0; i < n; i++) {
      _v.copy(dir).multiplyScalar(rand(1.5, headshot ? 6 : 4)).add(new THREE.Vector3(rand(-1.4, 1.4), rand(-0.5, 2.2), rand(-1.4, 1.4)));
      this.blood.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.35, 0.8), size: rand(0.018, 0.045), gravity: 9.8, drag: 1.2, color: base, alpha: 1 });
    }
    // mist
    const mists = headshot ? 5 : 2;
    for (let i = 0; i < mists; i++) {
      _v.copy(dir).multiplyScalar(rand(0.3, 1.2)).add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.1, 0.3), rand(-0.3, 0.3)));
      this.smoke.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.35, 0.7), size: headshot ? rand(0.35, 0.55) : rand(0.2, 0.35), grow: 0.9, drag: 4, color: [base[0] * 1.2, base[1], base[2]], alpha: 0.75 });
    }
    if (!decals) return;
    // decal: behind the target (wall) or on the floor below
    const hit = this.world.raycast(p.x, p.y, p.z, dir.x, dir.y, dir.z, 3.0, null, {});
    if (hit) {
      _n.set(hit.nx, hit.ny, hit.nz);
      _v.set(p.x + dir.x * hit.t, p.y + dir.y * hit.t, p.z + dir.z * hit.t);
      this.decals.bloodSplat(_v, _n, rand(0.4, 0.9) * (headshot ? 1.4 : 1), _n.y > 0.5 ? 1 : rand(1, 1.8));
    }
    if (Math.random() < 0.7) {
      const down = this.world.raycast(p.x + rand(-0.4, 0.4) + dir.x * 0.5, p.y, p.z + rand(-0.4, 0.4) + dir.z * 0.5, 0, -1, 0, 3, null, {});
      if (down) {
        _v.set(p.x + dir.x * 0.5, p.y - down.t, p.z + dir.z * 0.5);
        this.decals.bloodSplat(_v, UP, rand(0.35, 0.8));
      }
    }
  }

  bloodPoolAt(pos) {
    const down = this.world.raycast(pos.x, pos.y + 0.5, pos.z, 0, -1, 0, 2, null, {});
    if (down) {
      _v.set(pos.x, pos.y + 0.5 - down.t, pos.z);
      this.decals.bloodPool(_v, rand(1.0, 1.7));
    }
  }

  gore(p, scale = 1, color = null) {
    const base = color ?? [0.3, 0.01, 0.01];
    for (let i = 0; i < 60 * scale; i++) {
      _v.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(2, 9));
      this.blood.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.4, 1.1), size: rand(0.03, 0.08), gravity: 9.8, drag: 0.8, color: base, alpha: 1 });
    }
    for (let i = 0; i < 8; i++) {
      _v.set(rand(-1, 1), rand(0, 1), rand(-1, 1)).multiplyScalar(rand(0.5, 2));
      this.smoke.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.6, 1.2), size: rand(0.5, 0.9), grow: 1.2, drag: 3, color: [base[0], base[1], base[2]], alpha: 0.7 });
    }
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2, r = rand(0.3, 2.4);
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      const down = this.world.raycast(x, p.y + 0.5, z, 0, -1, 0, 3, null, {});
      if (down) this.decals.bloodSplat(_v.set(x, p.y + 0.5 - down.t, z), UP, rand(0.5, 1.1));
    }
    this.audio.play('gore_explode', { position: p, volume: 0.9 });
  }

  // ------------------------------------------------------------------ explosions
  explosion(p, scale = 1) {
    // flash + fireball
    this.glow.emit(p.x, p.y + 0.3, p.z, 0, 0, 0, { life: 0.18, size: 6 * scale, color: [6, 4, 2.2] });
    for (let i = 0; i < 22 * scale; i++) {
      _v.set(rand(-1, 1), rand(-0.1, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(1, 5) * scale);
      this.fire.emit(p.x, p.y + 0.4, p.z, _v.x, _v.y, _v.z, { life: rand(0.35, 0.8), size: rand(0.9, 1.8) * scale, grow: 2.5 * scale, drag: 4, gravity: -1.5, color: [5, 2.8, 1.2], endColor: [1.2, 0.3, 0.08], rotV: rand(-2, 2) });
    }
    // smoke column
    for (let i = 0; i < 12 * scale; i++) {
      _v.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).multiplyScalar(rand(0.6, 3) * scale);
      this.smoke.emit(p.x + rand(-0.5, 0.5), p.y + rand(0, 1), p.z + rand(-0.5, 0.5), _v.x, _v.y, _v.z, {
        life: rand(1.2, 2.4), size: rand(0.8, 1.5) * scale, grow: 1.0 * scale, drag: 1.8, gravity: -0.6,
        color: [0.06, 0.055, 0.05], endColor: [0.12, 0.12, 0.12], alpha: 0.55, fadeIn: 0.08, rotV: rand(-0.6, 0.6),
      });
    }
    // sparks / debris
    for (let i = 0; i < 50 * scale; i++) {
      _v.set(rand(-1, 1), rand(-0.1, 1.3), rand(-1, 1)).normalize().multiplyScalar(rand(5, 17));
      this.sparks.emit(p.x, p.y + 0.3, p.z, _v.x, _v.y, _v.z, { life: rand(0.3, 1.0), length: 0.03, color: [5, 3, 1.2], width: 0.012, gravity: 9.8, drag: 0.8 });
    }
    for (let i = 0; i < 16; i++) {
      _v.set(rand(-1, 1), rand(0.3, 1.5), rand(-1, 1)).multiplyScalar(rand(3, 9));
      this.blood.emit(p.x, p.y + 0.2, p.z, _v.x, _v.y, _v.z, { life: rand(0.6, 1.4), size: rand(0.03, 0.07), gravity: 9.8, drag: 0.4, color: [0.05, 0.04, 0.035], alpha: 1 });
    }
    this.lighting.flashAt(_v.set(p.x, p.y + 0.8, p.z), 0xff9a40, 260 * scale, 0.6, 18 * scale);
    const down = this.world.raycast(p.x, p.y + 0.4, p.z, 0, -1, 0, 3, null, {});
    if (down) this.decals.scorchMark(_v.set(p.x, p.y + 0.4 - down.t, p.z), UP, rand(2.8, 3.8) * scale);
    this.audio.play('explosion', { position: p, volume: 1 });
    this.audio.duck?.(0.5, 1.2);
  }

  /** Burning fuel pool (Molotov): ground flames, smoke and a flickering light. Visual only. */
  fireZone(p, radius = 3, duration = 7) {
    this.fireZones.push({ p: p.clone(), radius, life: duration, max: duration, emitT: 0, lightT: 0 });
    for (let i = 0; i < 18; i++) {
      _v.set(rand(-1, 1), rand(0.2, 1.1), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4));
      this.fire.emit(p.x, p.y + 0.2, p.z, _v.x, _v.y, _v.z, { life: rand(0.3, 0.6), size: rand(0.6, 1.3), grow: 1.8, drag: 4, gravity: -1.5, color: [5, 2.6, 1.0], endColor: [1.2, 0.3, 0.06], rotV: rand(-2, 2) });
    }
    this.lighting?.flashAt(_v.set(p.x, p.y + 0.6, p.z), 0xff7a2a, 160, 0.6, 14);
    this.decals.scorchMark(_v.set(p.x, p.y + 0.02, p.z), UP, radius * 1.5);
  }

  /** A few licks of flame on a burning body. */
  flameAt(p, height = 1.2) {
    const y = p.y + rand(0.1, height);
    this.fire.emit(p.x + rand(-0.2, 0.2), y, p.z + rand(-0.2, 0.2), rand(-0.2, 0.2), rand(0.8, 1.6), rand(-0.2, 0.2), {
      life: rand(0.25, 0.5), size: rand(0.25, 0.5), grow: 0.8, drag: 2, gravity: -2, color: [5, 2.5, 0.9], endColor: [1.0, 0.25, 0.05], rotV: rand(-2, 2),
    });
  }

  acidCloud(p, radius = 3, duration = 8) {
    this.acidClouds.push({ p: p.clone(), radius, life: duration, max: duration, emitT: 0 });
    this.audio.play('acid_hiss', { position: p, volume: 0.8 });
  }

  // ------------------------------------------------------------------ weapons
  muzzleWorld(p, dir, scale = 1) {
    this.flashes.emit(p.x, p.y, p.z, 0, 0, 0, { life: 0.05, size: 0.45 * scale, color: [5, 3.6, 2.2], rot: Math.random() * 6.28 });
    this.glow.emit(p.x, p.y, p.z, 0, 0, 0, { life: 0.05, size: 1.0 * scale, color: [2.5, 1.6, 0.8] });
    this.muzzleSmoke(p, dir, 0.5);
  }

  muzzleSmoke(p, dir, amount = 1) {
    for (let i = 0; i < 2 * amount + 0.5; i++) {
      _v.copy(dir).multiplyScalar(rand(0.3, 1.2)).add(new THREE.Vector3(rand(-0.15, 0.15), rand(0.05, 0.3), rand(-0.15, 0.15)));
      this.smoke.emit(p.x, p.y, p.z, _v.x, _v.y, _v.z, { life: rand(0.6, 1.3), size: rand(0.08, 0.16), grow: 0.5, drag: 2.5, gravity: -0.25, color: [0.55, 0.55, 0.55], alpha: 0.28 });
    }
  }

  tracer(a, b, opts) {
    this.sparks.tracerLine(a, b, opts);
  }

  shell(type, p, vel, spin = 1) {
    const sm = this.shellMeshes[type] || this.shellMeshes.rifle;
    if (!sm) return;
    const item = {
      p: p.clone(),
      v: vel.clone(),
      rot: new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6)),
      av: new THREE.Vector3(rand(-20, 20), rand(-20, 20), rand(-20, 20)).multiplyScalar(spin),
      life: 6,
      bounces: 0,
      rest: false,
      slot: sm.idx,
      type,
    };
    sm.items[sm.idx] = item;
    sm.idx = (sm.idx + 1) % 60;
    sm.mesh.count = Math.max(sm.mesh.count, Math.min(60, sm.items.length));
  }

  dripSplash(p) {
    for (let i = 0; i < 5; i++) {
      this.blood.emit(p.x, p.y + 0.02, p.z, rand(-0.6, 0.6), rand(0.6, 1.4), rand(-0.6, 0.6), { life: 0.35, size: 0.012, gravity: 9.8, color: [0.5, 0.56, 0.62], alpha: 0.7 });
    }
  }

  // ------------------------------------------------------------------ update
  update(dt, damageAcid) {
    this.time += dt;
    for (const s of this.systems) s.update(dt);
    this.sparks.update(dt);
    this.mags.update(dt);
    // acid clouds
    for (let i = this.acidClouds.length - 1; i >= 0; i--) {
      const c = this.acidClouds[i];
      c.life -= dt;
      c.emitT -= dt;
      if (c.emitT <= 0 && c.life > 1) {
        c.emitT = 0.07;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * c.radius;
        this.acid.emit(c.p.x + Math.cos(a) * r, c.p.y + rand(0.1, 0.8), c.p.z + Math.sin(a) * r, rand(-0.2, 0.2), rand(0.2, 0.6), rand(-0.2, 0.2), {
          life: rand(1.2, 2.2), size: rand(0.8, 1.6), grow: 0.6, drag: 1, color: [0.35, 0.75, 0.95], alpha: 0.5, fadeIn: 0.25, rotV: rand(-0.5, 0.5),
        });
        if (Math.random() < 0.3) this.glow.emit(c.p.x + Math.cos(a) * r, c.p.y + 0.1, c.p.z + Math.sin(a) * r, 0, 0.3, 0, { life: 0.8, size: 0.6, color: [0.1, 0.5, 0.9] });
      }
      damageAcid?.(c, dt);
      if (c.life <= 0) this.acidClouds.splice(i, 1);
    }
    // fire zones: denser in the middle, dying down over the last two seconds
    for (let i = this.fireZones.length - 1; i >= 0; i--) {
      const f = this.fireZones[i];
      f.life -= dt;
      f.emitT -= dt;
      f.lightT -= dt;
      const k = Math.min(1, f.life / 2);
      while (f.emitT <= 0 && f.life > 0) {
        f.emitT += (0.009 * 3) / Math.max(0.2, k) / Math.max(1, f.radius);
        const a = Math.random() * Math.PI * 2, r = Math.pow(Math.random(), 0.7) * f.radius;
        const x = f.p.x + Math.cos(a) * r, z = f.p.z + Math.sin(a) * r;
        const h = 1 - (r / f.radius) * 0.6;
        this.fire.emit(x, f.p.y + 0.05, z, rand(-0.15, 0.15), rand(0.8, 1.8) * h, rand(-0.15, 0.15), {
          life: rand(0.35, 0.8) * h, size: rand(0.45, 0.95) * (0.5 + 0.5 * k), grow: 1.1, drag: 1.5, gravity: -1.8, color: [5, 2.6, 1.0], endColor: [1.1, 0.25, 0.05], rotV: rand(-1.5, 1.5),
        });
        if (Math.random() < 0.12) {
          this.smoke.emit(x, f.p.y + 0.8, z, rand(-0.2, 0.2), rand(0.6, 1.2), rand(-0.2, 0.2), { life: rand(1.5, 2.8), size: rand(0.5, 0.9), grow: 0.8, drag: 1.2, gravity: -0.3, color: [0.08, 0.075, 0.07], alpha: 0.45 });
        }
      }
      if (f.lightT <= 0 && f.life > 0) {
        f.lightT = rand(0.18, 0.3);
        this.lighting?.flashAt(_v.set(f.p.x + rand(-0.3, 0.3), f.p.y + 0.7, f.p.z + rand(-0.3, 0.3)), 0xff8a36, rand(28, 44) * k, 0.45, 11);
      }
      if (f.life <= 0) this.fireZones.splice(i, 1);
    }
    // shells
    for (const sm of Object.values(this.shellMeshes)) {
      let changed = false;
      for (let i = 0; i < sm.items.length; i++) {
        const it = sm.items[i];
        if (!it) continue;
        if (!it.rest) {
          it.v.y -= 9.8 * dt;
          it.p.addScaledVector(it.v, dt);
          it.rot.x += it.av.x * dt;
          it.rot.y += it.av.y * dt;
          it.rot.z += it.av.z * dt;
          const g = this.world.groundHeight(it.p.x, it.p.z, 0.01, it.p.y + 0.05);
          if (it.p.y < g + 0.01) {
            it.p.y = g + 0.01;
            if (it.bounces === 0 && it.type !== 'grenade40') this.audio.play(it.type === 'shotgun' ? 'shotgun_shell_drop' : 'shell_casing', { position: it.p, volume: 0.35 });
            it.bounces++;
            it.v.y = -it.v.y * 0.35;
            it.v.x *= 0.5;
            it.v.z *= 0.5;
            it.av.multiplyScalar(0.4);
            if (it.bounces > 2 || Math.abs(it.v.y) < 0.4) {
              it.rest = true;
              it.rot.x = Math.PI / 2;
              it.rot.z = 0;
            }
          }
          changed = true;
        }
        it.life -= dt;
        _q.setFromEuler(it.rot);
        const s = it.life < 0.5 ? Math.max(0.001, it.life / 0.5) : 1;
        _s.set(s, s, s);
        _m.compose(it.p, _q, _s);
        sm.mesh.setMatrixAt(i, _m);
        if (it.life <= 0) sm.items[i] = null;
        changed = true;
      }
      if (changed) sm.mesh.instanceMatrix.needsUpdate = true;
      // hide dead slots
      for (let i = 0; i < sm.items.length; i++) {
        if (!sm.items[i]) {
          _m.makeScale(0, 0, 0);
          sm.mesh.setMatrixAt(i, _m);
        }
      }
    }
  }
}
