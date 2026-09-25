// Jerry cans for the generator (world/power.js): two spots upstairs. They appear when the basement
// opens (the generator burns fuel from then on). Walk over one to pick it up (carry up to POWER.canMax,
// slot 6). A can poured into the generator comes back at the spot it was taken from at the start of the
// round after next (POWER.canRespawn rounds later).
import * as THREE from 'three';
import { buildJerryCan } from '../player/gasCan.js';
import { tex } from './textures.js';

const UP = 3.45; // FLOOR.upper
// the back bedroom (north-west, by the window-less wall) and the junk room behind the south-east room
export const CAN_SPOTS = [
  { id: 'bedroom', where: 'the back bedroom', pos: [-6.75, UP, -7.38], rot: 0.35 },
  { id: 'junkRoom', where: 'the junk room', pos: [11.22, UP, -7.25], rot: -1.2 },
];

export class GasCans {
  constructor(game, scene, { max = 2, respawnRounds = 2 } = {}) {
    this.game = game;
    this.max = max;
    this.respawnRounds = respawnRounds;
    let glow = null;
    try {
      glow = tex('glow').map;
    } catch (e) {
      /* optional */
    }
    this.spots = CAN_SPOTS.map((d) => {
      const g = new THREE.Group();
      g.name = 'gasCan:' + d.id;
      const can = buildJerryCan();
      g.add(can.group);
      let sprite = null;
      if (glow) {
        sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(0xff7a2a).multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
        sprite.scale.setScalar(1.05);
        sprite.position.y = 0.3;
        g.add(sprite);
      }
      g.position.set(d.pos[0], d.pos[1], d.pos[2]);
      g.rotation.y = d.rot;
      g.visible = false;
      scene.add(g);
      return { ...d, obj: g, sprite, available: false, respawnRound: null, t: Math.random() * 10 };
    });
    this.carried = []; // spot of origin of each can in the hands / pack, oldest first
    this.full = false; // standing on a can with no room for it (power.js shows the prompt)
    this.hinted = false;
  }

  reset() {
    for (const s of this.spots) {
      s.available = false;
      s.respawnRound = null;
      s.obj.visible = false;
    }
    this.carried = [];
    this.full = false;
    this.hinted = false;
  }

  /** The basement opened: both cans are out. */
  spawnAll() {
    for (const s of this.spots) {
      if (this.carried.includes(s)) continue;
      s.available = true;
      s.respawnRound = null;
      s.obj.visible = true;
    }
  }

  /** A can went into the generator: its spot gets a new one at the start of the round after next. */
  consume() {
    const s = this.carried.shift();
    if (s) s.respawnRound = (this.game.round ?? 0) + this.respawnRounds;
  }

  onRoundStart(round) {
    for (const s of this.spots) {
      if (s.available || s.respawnRound == null || round < s.respawnRound || this.carried.includes(s)) continue;
      s.available = true;
      s.respawnRound = null;
      s.obj.visible = true;
    }
  }

  nearestAvailable(pos) {
    let best = null, bd = Infinity;
    for (const s of this.spots) {
      if (!s.available) continue;
      const d = s.obj.position.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    return best;
  }

  update(dt, player) {
    const g = this.game, w = g.weapons;
    this.full = false;
    for (const s of this.spots) {
      if (!s.available) continue;
      s.t += dt;
      if (s.sprite) s.sprite.material.opacity = 0.45 + Math.sin(s.t * 3) * 0.2;
      if (!player?.alive) continue;
      const p = s.obj.position;
      if (Math.abs(player.pos.y - p.y) > 1.0 || Math.hypot(player.pos.x - p.x, player.pos.z - p.z) > 0.85) continue;
      if ((w.gascans ?? 0) >= this.max) {
        this.full = true;
        continue;
      }
      s.available = false;
      s.obj.visible = false;
      this.carried.push(s);
      w.gascans = (w.gascans ?? 0) + 1;
      g.audio.play('can_pickup', { volume: 0.9 });
      g.hud?.popScore?.(0, 'GAS CAN');
      if (!this.hinted) {
        this.hinted = true;
        g.hud?.banner('GAS CAN', 'Press 6 to take it out · hold LMB at the generator to refuel it', 3, 'success');
      }
    }
  }

  radarList() {
    const out = [];
    for (const s of this.spots) if (s.available) out.push({ x: s.obj.position.x, z: s.obj.position.z, kind: 'gascan' });
    return out;
  }
}
