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
const filter = (b) => (b.flags & FLAG_NOBULLET) === 0;

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
    this.shellGeo = new THREE.SphereGeometry(0.05, 10, 8);
    this.shellMat = new THREE.MeshStandardMaterial({ color: 0x552222, emissive: 0xff2a10, emissiveIntensity: 3, roughness: 0.4 });
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
      const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
      this._add(mesh, {
        kind: 'shell',
        pos: pos.clone().add(new THREE.Vector3(0, 1.1, 0)),
        vel: v,
        fuse: 1.4 + i * 0.25,
        owner: null,
        def: { damage: 55, radius: 3.6 },
        bounces: 0,
        radius: 0.05,
        spin: new THREE.Vector3(),
      });
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
        if (p.kind === 'shell') p.mesh.material.emissiveIntensity = Math.sin(p.fuse * 30) > 0 ? 6 : 1;
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
