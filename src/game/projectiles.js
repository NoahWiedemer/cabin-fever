// Physical projectiles: frag grenades (bounce, fuse), 40mm rounds (impact), Molotovs (shatter on
// impact into a fire pool), Striker death shells.
import * as THREE from 'three';
import { buildThirdPersonWeapon } from '../player/gunSafe.js';
import { rand } from '../core/utils.js';
import { FLAG_NOBULLET } from '../world/collision.js';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';

const _hit = {};
const _rag = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _UP = new THREE.Vector3(0, 1, 0), _Z = new THREE.Vector3(0, 0, 1);
const filter = (b) => (b.flags & FLAG_NOBULLET) === 0;
const CHARGE_SCALE = 1.5; // chunky enough to read at combat distance (~26 cm pipe)

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * The Striker's death charge: a taped steel pipe bomb (hex end caps, hazard band, timer box with a
 * red LED, red / yellow leads, a burning fuse). Pipe axis = local Y. Named parts: led, glow, fuseTip.
 */
function buildCharge() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x4a4d50, metalness: 0.85, roughness: 0.42 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x6d7072, metalness: 0.9, roughness: 0.32 });
  const tapeMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.85 });
  const hazard = canvasTexture(128, 32, (c, w, h) => {
    c.fillStyle = '#e8b400';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#111';
    for (let x = -h; x < w + h; x += 24) {
      c.beginPath();
      c.moveTo(x, h);
      c.lineTo(x + 12, h);
      c.lineTo(x + 12 + h, 0);
      c.lineTo(x + h, 0);
      c.fill();
    }
  });
  hazard.wrapS = THREE.RepeatWrapping;
  hazard.repeat.set(2, 1);
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.65 });
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x2c3324, roughness: 0.6 });
  const add = (geo, mat, x, y, z, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (name) m.name = name;
    g.add(m);
    return m;
  };
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 16), metal, 0, 0, 0);
  add(new THREE.CylinderGeometry(0.038, 0.038, 0.024, 6), capMat, 0, 0.087, 0);
  add(new THREE.CylinderGeometry(0.038, 0.038, 0.024, 6), capMat, 0, -0.087, 0);
  add(new THREE.CylinderGeometry(0.0318, 0.0318, 0.046, 16), tapeMat, 0, 0.022, 0);
  add(new THREE.CylinderGeometry(0.0315, 0.0315, 0.028, 16, 1, true), hazardMat, 0, -0.045, 0);
  add(new THREE.BoxGeometry(0.036, 0.036, 0.016), boxMat, 0, 0.022, 0.037);
  add(new THREE.PlaneGeometry(0.022, 0.01), new THREE.MeshBasicMaterial({ color: 0x3a0a06 }), -0.004, 0.012, 0.0455); // dead LCD
  add(new THREE.SphereGeometry(0.0055, 10, 8), new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1a08, emissiveIntensity: 0.4 }), 0.009, 0.03, 0.045, 'led');
  // leads from the timer to both caps
  const lead = (pts, color) => {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.0022, 5), new THREE.MeshStandardMaterial({ color, roughness: 0.5 })));
  };
  lead([[0.012, 0.04, 0.042], [0.02, 0.06, 0.04], [0.018, 0.08, 0.036]], 0xb81a12);
  lead([[-0.012, 0.004, 0.042], [-0.02, -0.03, 0.04], [-0.016, -0.074, 0.037]], 0xd8b010);
  // fuse out of the top cap
  add(new THREE.CylinderGeometry(0.0028, 0.0028, 0.03, 6), tapeMat, 0, 0.113, 0);
  const tip = new THREE.Object3D();
  tip.name = 'fuseTip';
  tip.position.set(0, 0.128, 0);
  g.add(tip);
  // halo around the LED (bloom picks it up)
  const glowTex = canvasTexture(64, 64, (c, w) => {
    const r = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = r;
    c.fillRect(0, 0, w, w);
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff2a10, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.name = 'glow';
  glow.position.set(0.009, 0.03, 0.05);
  glow.scale.setScalar(0.001);
  g.add(glow);
  return g;
}

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
        game.audio.play('charge_beep', { position: p.pos, volume: 0.5, pitch: 1 + (1.5 - Math.min(1.5, p.fuse)) * 0.3 });
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
                if (p.kind === 'shell' && n.y > 0.5) {
                  p.grounded = true; // from here on it lies flat and rolls (see _charge)
                  p.spin = null;
                }
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
        if (p.kind === 'shell') this._charge(p, dt);
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
        const scale = p.kind === 'shell' ? 0.55 : p.kind === 'round40' ? 0.9 : 1;
        game.explode(p.pos, p.def.radius, p.def.damage, p.owner, { scale, weapon: p.kind === 'frag' ? 'm67' : p.kind === 'round40' ? 'm32' : 'striker' });
      }
    }
  }
}
