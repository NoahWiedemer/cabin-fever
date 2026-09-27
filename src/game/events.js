// Rare random events (besides the barn fire, world/barnFire.js, and the wall breach, world/breach.js).
// At most one a round and each at most once a run, EVENTS.chance each round from its first round:
//   airstrike   Command shells the fields round the farm: whistles, then a walk of shells through the yard
//               that shreds the infected out there (and anyone else caught outside)
//   bloodmoon   the storm tears open on a red moon: the round's infected come faster and in greater number,
//               every kill pays double
//   crash       another helicopter is struck by lightning and comes down in the fields: a fireball, a burning
//               wreck, and its cargo (a special weapon, supplies) for whoever dares to fetch it
//   blackout    lightning hits the power line: the lights stutter out for most of a minute
// Debug: game.events.force('airstrike' | 'bloodmoon' | 'crash' | 'blackout').
import * as THREE from 'three';
import { Chopper } from '../world/helicopter.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { rand, pick, clamp } from '../core/utils.js';

export const EVENTS = {
  chance: 0.022, // per round, per event
  from: { blackout: 3, bloodmoon: 4, airstrike: 5, crash: 6 },
  airstrike: { shells: 16, span: 13, delay: 7, radius: 5.2, damage: 260 },
  bloodmoon: { speed: 1.18, extra: 0.3, pay: 2 },
  blackout: [42, 58],
};

const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V();
const RED = new THREE.Color(0.95, 0.18, 0.12);
const RED_FOG = new THREE.Color(0.2, 0.035, 0.03);

export class RandomEvents {
  constructor(game) {
    this.game = game;
    this.wreck = null;
    this.reset();
  }

  reset() {
    this.done = new Set();
    this.shells = [];
    this.blood = 0; // blood moon strength 0..1 (eases in and out)
    this.bloodOn = false;
    this.crash = null;
    this.speedMul = 1;
    this.payMul = 1;
    if (this.wreck) this.wreck.show(false);
    this.wreckFireT = 0;
    const g = this.game;
    if (g.lighting) g.lighting.moonTint = null;
    if (g.weather) g.weather.blood = 0;
  }

  /** a new round: maybe an event */
  onRoundStart(round) {
    const g = this.game;
    if (round >= g.maxRounds && !g.endless) return; // the story's final wave stays as it is
    const names = Object.keys(EVENTS.from).filter((n) => !this.done.has(n) && round >= EVENTS.from[n]);
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    for (const n of names) {
      if (n === 'crash' && g.chopperIfBuilt?.()?.visible) continue;
      if (Math.random() < EVENTS.chance) {
        this.start(n);
        break;
      }
    }
  }

  onRoundEnd() {
    if (this.bloodOn) {
      this.bloodOn = false;
      this.speedMul = 1;
      this.payMul = 1;
    }
  }

  force(name) {
    this.done.delete(name);
    this.start(name);
  }

  start(name) {
    const g = this.game;
    this.done.add(name);
    if (name === 'airstrike') {
      g.story?.radioMsg('COMMAND', 'Fireteam, artillery is shelling the fields around the farm. Get inside and stay down!');
      g.hud.banner('ARTILLERY INBOUND', 'Get inside and stay away from the windows', 3, 'danger');
      const A = EVENTS.airstrike;
      for (let i = 0; i < A.shells; i++) this.shells.push({ t: A.delay + (i / A.shells) * A.span + rand(-0.3, 0.3), pos: null, whistle: false });
    } else if (name === 'bloodmoon') {
      this.bloodOn = true;
      this.speedMul = EVENTS.bloodmoon.speed;
      this.payMul = EVENTS.bloodmoon.pay;
      // more of them this round
      const extra = Math.round(g.toSpawn.length * EVENTS.bloodmoon.extra);
      for (let i = 0; i < extra; i++) g.toSpawn.splice(Math.floor(Math.random() * (g.toSpawn.length + 1)), 0, pick(['mauler', 'mauler', 'worker', 'dog']));
      g.roundTotal = g.toSpawn.length;
      g.audio.play('blood_moon', { volume: 0.9 });
      setTimeout(() => g.hud.banner('BLOOD MOON', 'The infected are frenzied · every kill pays double', 3.4, 'danger'), 2600);
    } else if (name === 'crash') this._startCrash();
    else if (name === 'blackout') {
      const pole = V(-14, 3.2, 14.5);
      g.lighting.triggerLightning(1.4);
      setTimeout(() => {
        if (!g.running) return;
        g.audio.play('power_zap', { position: pole, volume: 1 });
        for (let i = 0; i < 40; i++) {
          _a.set(rand(-1, 1), rand(0.2, 1.4), rand(-1, 1)).normalize().multiplyScalar(rand(2, 7));
          g.fx.sparks.emit(pole.x, pole.y, pole.z, _a.x, _a.y, _a.z, { life: rand(0.3, 0.9), length: 0.04, color: [5, 3.8, 2.2], width: 0.012, gravity: 9.8, drag: 0.6 });
        }
        g.lighting.flashAt(pole, 0xbfd8ff, 200, 0.4, 20);
        g.power?.blackout(rand(EVENTS.blackout[0], EVENTS.blackout[1]));
        g.hud.banner('BLACKOUT', 'Lightning hit the power line · use your flashlight [F]', 3, 'danger');
      }, 450);
    }
  }

  // ---------------------------------------------------------------- the crash
  _crashSite() {
    const g = this.game, nav = g.nav;
    for (let i = 0; i < 100; i++) {
      const a = Math.random() * TAU, r = rand(22, 34);
      const x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r;
      if (g.level.isSheltered(x, 0.5, z)) continue;
      if (Math.abs(x) < 16 && Math.abs(z) < 13) continue;
      const i0 = nav.index(1, x, z);
      if (i0 < 0 || !nav.walk[i0] || !(nav.distanceAt(1, x, z) < 1e6)) continue;
      const gy = g.world.groundHeight(x, z, 0.5, 2);
      if (gy > 0.5) continue;
      return V(x, gy > -50 ? gy : -0.5, z);
    }
    return V(24, -0.5, 22);
  }

  _startCrash() {
    const g = this.game;
    if (!this.wreck) this.wreck = new Chopper(g.scene, g.audio);
    const ch = this.wreck;
    const site = this._crashSite();
    const a = Math.atan2(site.z, site.x) + Math.PI * rand(0.7, 1.3); // it comes in from across the farm
    const from = V(site.x + Math.cos(a) * 120, 42, site.z + Math.sin(a) * 120);
    const hit = V(site.x + Math.cos(a) * 45, 32, site.z + Math.sin(a) * 45);
    ch.flight.setPath([from, V((from.x + hit.x) / 2, 38, (from.z + hit.z) / 2), hit]);
    ch.flight.yaw = Math.atan2(hit.x - from.x, hit.z - from.z);
    ch.show(true);
    ch.sound(true, 1.3);
    ch.heli.rotor = 1;
    ch.heli.lights = true;
    ch.heli.cargo.visible = false;
    ch.heli.body.rotation.set(0, 0, 0);
    this.crash = { t: 0, site, hit, from, phase: 'fly', spin: 0 };
    g.story?.radioMsg('PILOT', 'Reaper Two-Two passing over your position, heading north. Hang in there.');
  }

  _updateCrash(dt) {
    const g = this.game, c = this.crash, ch = this.wreck;
    c.t += dt;
    const fl = ch.flight, h = ch.heli;
    if (c.phase === 'fly') {
      fl.at(Math.min(1, c.t / 6), dt);
      if (c.t >= 6) {
        c.phase = 'hit';
        c.t = 0;
        c.start = ch.root.position.clone();
        g.lighting.triggerLightning(1.6);
        g.fx.explosion(_a.copy(ch.root.position).add(V(0, 2.5, 0)), 0.6);
        g.audio.play('explosion', { position: ch.root.position, volume: 0.8 });
        g.story?.radioMsg('PILOT', "Mayday, mayday! Reaper Two-Two is hit, we're going down!");
      }
    } else if (c.phase === 'hit') {
      // spinning down into the field, smoke pouring from the tail
      const u = Math.min(1, c.t / 5.2);
      c.spin += dt * (2 + u * 5);
      const p = ch.root.position;
      p.lerpVectors(c.start, c.site, u);
      p.y = c.start.y + (c.site.y + 1.2 - c.start.y) * (u * u);
      ch.root.rotation.set(0, fl.yaw + c.spin, 0);
      h.body.rotation.set(0.25 + u * 0.3, 0, Math.sin(c.t * 3) * 0.3 + u * 0.4);
      ch.snd?.setPitch(1 - u * 0.25 + Math.sin(c.t * 9) * 0.05);
      if (Math.random() < dt * 30) {
        const tail = h.toWorld(_a.set(0, 2.4, -3), V());
        g.fx.smoke.emit(tail.x, tail.y, tail.z, rand(-0.5, 0.5), rand(0.2, 1), rand(-0.5, 0.5), { life: rand(2.5, 4), size: rand(0.9, 1.6), grow: 1.8, drag: 0.6, gravity: -0.4, color: [0.05, 0.05, 0.05], alpha: 0.6 });
        if (Math.random() < 0.4) g.fx.fire.emit(tail.x, tail.y, tail.z, 0, 0.5, 0, { life: 0.3, size: 0.9, grow: 1.4, drag: 2, gravity: -1, color: [5, 2.4, 0.9], endColor: [1.1, 0.25, 0.05], rotV: rand(-2, 2) });
      }
      if (u >= 1) this._crashed();
    } else if (c.phase === 'down') {
      // the wreck burns
      this.wreckFireT -= dt;
      if (Math.random() < dt * 6) {
        const s = c.site;
        g.fx.smoke.emit(s.x + rand(-1.5, 1.5), s.y + rand(1, 2.5), s.z + rand(-1.5, 1.5), rand(-0.2, 0.2), rand(0.8, 1.6), rand(-0.2, 0.2), { life: rand(3, 5), size: rand(1.2, 2), grow: 1.6, drag: 0.5, gravity: -0.3, color: [0.05, 0.048, 0.045], alpha: 0.5 });
      }
    }
  }

  _crashed() {
    const g = this.game, c = this.crash, ch = this.wreck;
    c.phase = 'down';
    const s = c.site;
    ch.sound(false);
    ch.heli.rotor = 0;
    ch.heli.lights = false;
    ch.heli.searchOn = false;
    ch.root.position.set(s.x, s.y + 0.1, s.z);
    ch.root.rotation.set(0, rand(0, TAU), 0);
    ch.heli.body.rotation.set(0.12, 0, 1.15); // on its side
    g.explode(s.clone().add(V(0, 0.8, 0)), 7, 300, null, { scale: 1.6, weapon: 'explosion' });
    g.audio.play('metal_crash', { position: s, volume: 1 });
    g.fx.fireZone(s.clone().add(V(0, 0.1, 0)), 2.8, 55);
    g.alertNoise(s, 60);
    g.shake.add(0.6);
    // the cargo, thrown clear of the fire
    const away = Math.atan2(-s.z, -s.x);
    const drop = (k) => {
      const a = away + rand(-0.6, 0.6);
      const x = s.x + Math.cos(a) * (3.5 + k), z = s.z + Math.sin(a) * (3.5 + k);
      const y = g.world.groundHeight(x, z, 0.3, 2);
      return V(x, y > -50 ? y : -0.5, z);
    };
    // a special weapon (the two grenade launchers are found only like this and as rare loot) and an ammo
    // box; both wait there, the weapon marked on the map
    const gun = pick(['chaingun', 'm32', 'softball', 'l96a1'].filter((id) => WEAPONS[id] && !g.weapons._carried().includes(id))) ?? 'm32';
    if (WEAPONS[gun]) g.pickups.spawnWeapon(gun, drop(0), { permanent: true, mark: true });
    g.pickups.spawnSupply('red', drop(1.2), { life: 240 });
    setTimeout(() => {
      if (!g.running) return;
      g.story?.radioMsg('COMMAND', 'Reaper Two-Two is down near your position. Their cargo might still be intact, if you can reach it.');
      g.hud.banner('REAPER DOWN', `The wreck burns in the fields · its cargo: ${WEAPONS[gun]?.name ?? 'weapons'}`, 3.2, 'normal');
    }, 1800);
  }

  // ---------------------------------------------------------------- update
  update(dt) {
    const g = this.game;
    // the artillery walk: a whistle, then the shell lands somewhere outside (near the infected out there)
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t -= dt;
      if (!s.pos && s.t < 1.2) {
        s.pos = this._shellSpot();
        g.audio.play('shell_whistle', { position: s.pos.clone().add(V(0, 12, 0)), volume: 1 });
      }
      if (s.t <= 0) {
        this.shells.splice(i, 1);
        const p = s.pos ?? this._shellSpot();
        g.explode(p, EVENTS.airstrike.radius, EVENTS.airstrike.damage, null, { scale: 1.35, weapon: 'artillery' });
        g.shake.add(clamp(1 - p.distanceTo(g.player.pos) / 40, 0.1, 0.8));
        if (!this.shells.length) setTimeout(() => g.running && g.story?.radioMsg('COMMAND', 'Barrage complete. That should thin them out.'), 1200);
      }
    }
    // the blood moon eases in and out
    const want = this.bloodOn ? 1 : 0;
    this.blood += (want - this.blood) * Math.min(1, dt * 0.6);
    if (this.blood < 0.002) this.blood = 0;
    g.lighting.moonTint = this.blood > 0 ? RED : null;
    g.lighting.moonTintK = this.blood * 0.85;
    g.weather.blood = this.blood;
    if (this.crash) this._updateCrash(dt);
    this.wreck?.update(dt);
  }

  /** the fog color under the blood moon (game.update) */
  tintFog(col) {
    if (this.blood > 0) col.lerp(RED_FOG, this.blood * 0.7);
  }

  _shellSpot() {
    const g = this.game;
    // most shells fall where the infected are, outside the buildings
    const outside = g.zombies.list.filter((z) => z.alive && !g.level.isSheltered(z.pos.x, z.pos.y + 0.5, z.pos.z) && Math.hypot(z.pos.x, z.pos.z) > 12);
    if (outside.length && Math.random() < 0.65) {
      const z = pick(outside);
      return V(z.pos.x + rand(-2, 2), z.pos.y, z.pos.z + rand(-2, 2));
    }
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU, r = rand(15, 36);
      const x = Math.cos(a) * r * 1.15, z = Math.sin(a) * r;
      if (g.level.isSheltered(x, 0.5, z) || (Math.abs(x) < 14.5 && Math.abs(z) < 11.5)) continue;
      const y = g.world.groundHeight(x, z, 0.3, 3);
      return V(x, y > -50 ? y : -0.5, z);
    }
    return V(20, -0.5, 20);
  }
}
