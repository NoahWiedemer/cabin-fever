// The story of Cabin Fever mode (the endless mode has none). The fireteam brings a reagent to Dr. Nadja,
// a scientist sealed in the lab under the farmhouse:
//   intro    cutscene: dropped at the farm by helicopter (game/cutscenes.js)
//   hold     rounds 1-9: hold the house while Command traces her (radio now and then)
//   find     after round 9: "found her" over the radio, the basement opens; reach the lab's glass
//   (nadja)  cutscene: she wants the reagent, the vault door's keypad is dead: it has to be hacked
//   wait     until the next buy phase: then Reaper 1-1 flies over and drops the hacking module
//   drop     the helicopter, the crate on its parachute
//   fetch    the crate on the ground (a flare burns next to it): hold E at it to take the module
//   carry    hold E at the keypad by the vault door to clamp the module on
//   hack     it cracks the lock while the infected attack (buy phases pause it) and stalls now and then
//            (Payday's drill): hold E at it to restart
//   hacked   the lock is open; Nadja opens the door once the last wave is beaten
//   outro    cutscene: the door swings open, the reagent is delivered → mission complete
// Victory needs both: the final round cleared and the hack done. Should the last wave fall first, the
// infected keep coming (overtime) until the hack is through.
import * as THREE from 'three';
import { introScene, nadjaScene, outroScene } from './cutscenes.js';
import { buildDropCrate, buildHackModule } from '../world/hackDevice.js';
import { clamp, rand, pick } from '../core/utils.js';

export const STORY = {
  rounds: 15, // every difficulty
  minutes: 60,
  foundAfter: 9, // Command finds the lab in the buy phase after this round; the basement opens with the next
  jamEvery: [24, 42], // s of hacking between stalls
  restart: 1.2, // s holding E to restart a stalled hack
  plant: 2.0, // s holding E to clamp the module on
  take: 0.6, // s holding E to take it from the crate
  reach: 1.7, // m from the crate / keypad / module
  contact: 3.4, // m from the lab's glass that starts the Nadja scene
  dropR: [12, 24], // the crate lands this far from the house's middle
  dropFly: 16, // s the drop helicopter takes over the map
  sink: 3.2, // m/s under the parachute
};

const FB = -3.2;
const TAU = Math.PI * 2;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _a = V(), _b = V();

// radio beats in the buy phase after round n (hold phase)
const BEATS = {
  3: ['COMMAND', "Nadja's beacon is weak, but it's close. Somewhere under that farm. Keep them off you."],
  6: ['COMMAND', "We're getting warmer. The signal comes from below the house. There has to be a way down."],
};

export class Mission {
  constructor(game) {
    this.game = game;
    this.crate = null;
    this.module = null;
    this.reset();
  }

  /** a new match: the story runs in Cabin Fever mode only */
  reset() {
    const g = this.game;
    this.story = !!g.mode && !g.endless;
    this.phase = this.story ? 'intro' : 'off';
    this.progress = 0;
    this.hackTotal = g.diff?.hack ?? 180;
    this.jammed = false;
    this.jamT = 0;
    this.alarmT = 0;
    this.carrying = false;
    this.overtime = false;
    this.otSpawnT = 0;
    this.dropT = 0;
    this.dropAt = null;
    this.dropPending = -1; // s until the drop flies in (-1: not scheduled)
    this.holdT = 0;
    this.hold = null;
    this.holdLabel = null;
    this.prompt = null;
    this.milestone = 0;
    this.saidOvertime = false;
    this._hideProps();
    g.story?.clearRadio();
    g.story?.setObjective(null);
  }

  get hackDone() {
    return this.phase === 'hacked' || this.phase === 'outro' || this.phase === 'done';
  }

  /** after game.start(): the intro (story) or nothing */
  begin() {
    if (!this.story) return;
    this.game.cinema.play(introScene(this.game));
  }

  radio(who, text, dur) {
    if (this.game.cinema.active || !this.game.running) return; // the scene has its own lines
    this.game.story.radioMsg(who, text, dur);
  }

  // ---------------------------------------------------------------- hooks from game.js
  onCinemaEnd(id, skipped) {
    const g = this.game;
    if (id === 'intro') {
      this.phase = 'hold';
      g.intermissionT = 10;
      this.radio('COMMAND', 'Get inside. The air out there is toxic. We are still tracing her signal.');
    } else if (id === 'nadja') {
      this.phase = 'wait';
      if (g.state === 'shop') this.dropPending = 3;
    } else if (id === 'outro') {
      this.phase = 'done';
      g._finish(true);
    }
  }

  /** the buy phase after round `round` has begun */
  onRoundEnd(round) {
    if (!this.story) return;
    const beat = this.phase === 'hold' && BEATS[round];
    if (beat) setTimeout(() => this.radio(beat[0], beat[1]), 2500);
    if (round === STORY.foundAfter && this.phase === 'hold') {
      this.phase = 'find';
      setTimeout(() => {
        this.radio('COMMAND', "Got her! Nadja's lab is right under the farmhouse, past the basement. We just popped the cellar locks.");
        this.radio('COMMAND', 'Get down there and make contact.');
      }, 1500);
    }
    if (this.phase === 'wait') this.dropPending = 4;
  }

  onRoundStart() {}

  /** the final wave is down: finish (true) or keep fighting until the hack is through (overtime) */
  finalWaveCleared() {
    if (!this.story) return true;
    if (this.hackDone) return true;
    if (!this.overtime) {
      this.overtime = true;
      this.otSpawnT = 2;
      this.radio('COMMAND', 'That was the last wave, but they keep coming. You need that door open. Finish the hack!');
    }
    return false;
  }

  playOutro() {
    this.phase = 'outro';
    this._hideModuleHUD();
    this.game.cinema.play(outroScene(this.game));
  }

  onPlayerDied(player) {
    if (!this.carrying) return;
    // the module drops where the player fell (the crate again, minus its parachute)
    this.carrying = false;
    this._crate();
    const c = this.crate;
    c.root.position.copy(player.pos);
    c.root.position.y = this._floor(player.pos.x, player.pos.z, player.pos.y);
    c.setChute(1);
    c.flare.visible = true;
    c.root.visible = true;
    this._flareSound(true);
    this.phase = 'fetch';
    this.radio('COMMAND', 'The module is down with you. Somebody pick it up!');
  }

  // ---------------------------------------------------------------- props
  _crate() {
    if (!this.crate) {
      this.crate = buildDropCrate();
      this.game.scene.add(this.crate.root);
    }
    return this.crate;
  }

  _module() {
    if (!this.module) {
      this.module = buildHackModule();
      const m = this.game.lab.hackMount;
      this.module.root.position.copy(m.pos);
      this.game.scene.add(this.module.root);
    }
    return this.module;
  }

  _hideProps() {
    if (this.crate) this.crate.root.visible = false;
    if (this.module) this.module.root.visible = false;
    this._flareSound(false);
    this.game.lab?.setLock('locked');
  }

  _hideModuleHUD() {
    this.hold = null;
    this.prompt = null;
  }

  _flareSound(on) {
    if (on && !this.flareSnd && this.crate) this.flareSnd = this.game.audio.play('flare_burn', { loop: true, position: this.crate.root.position, volume: 0.7 });
    else if (!on && this.flareSnd) {
      this.flareSnd.stop(0.4);
      this.flareSnd = null;
    }
  }

  _floor(x, z, y = 0) {
    const h = this.game.world.groundHeight(x, z, 0.4, y + 1.5);
    return h > -50 ? h : -0.5;
  }

  /** somewhere outside the buildings, open to the sky, reachable on foot */
  _pickDrop() {
    const g = this.game, nav = g.nav, L = g.level;
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * TAU, r = rand(STORY.dropR[0], STORY.dropR[1]);
      const x = Math.cos(a) * r * 1.2, z = Math.sin(a) * r;
      if (Math.abs(x) < 14.5 && Math.abs(z) < 11) continue;
      if (L.isSheltered(x, 0.5, z)) continue;
      const i0 = nav.index(1, x, z);
      if (i0 < 0 || !nav.walk[i0] || !(nav.distanceAt(1, x, z) < 1e6)) continue;
      const gy = this._floor(x, z, 0);
      if (gy > 0.5 || gy < -1.2) continue;
      if (g.world.raycast(x, gy + 0.8, z, 0, 1, 0, 30, null, {})) continue; // under a roof or a tree
      return V(x, gy, z);
    }
    return V(-6.5, -0.5, 17);
  }

  _startDrop() {
    const g = this.game;
    this.phase = 'drop';
    this.dropPending = -1;
    this.dropAt = this._pickDrop();
    const ch = g.chopper();
    const a = Math.random() * TAU;
    const d = V(Math.cos(a), 0, Math.sin(a));
    const P = this.dropAt;
    ch.flight.setPath([
      V(P.x + d.x * 110, 36, P.z + d.z * 110),
      V(P.x + d.x * 45, 30, P.z + d.z * 45),
      V(P.x, 27, P.z),
      V(P.x - d.x * 45, 31, P.z - d.z * 45),
      V(P.x - d.x * 120, 40, P.z - d.z * 120),
    ]);
    ch.flight.yaw = Math.atan2(-d.x, -d.z);
    ch.show(true);
    ch.sound(true, 1.3);
    ch.heli.rotor = 1;
    ch.heli.cargo.visible = false;
    ch.heli.setRopes(0);
    ch.heli.searchOn = true;
    this.dropT = 0;
    this.released = false;
    const c = this._crate();
    c.root.visible = false;
    c.flare.visible = false;
    this.radio('PILOT', 'Reaper One-One inbound with your hacking module. Watch for the flare!');
  }

  // ---------------------------------------------------------------- update
  update(dt, input) {
    const g = this.game;
    // radio: key-up / key-down sounds around each message
    const st = g.story;
    const was = this._radioOn;
    const started = st.update(dt);
    if (started) g.audio.play('radio_on', { volume: 0.55 });
    this._radioOn = st.radioBusy;
    if (was && !this._radioOn) g.audio.play('radio_off', { volume: 0.5 });
    if (!this.story || g.cinema.active) return;

    const p = g.player;
    const e = input?.down('KeyE') && p.alive;
    this.hold = null;
    this.holdLabel = null;
    this.prompt = null;
    const lab = g.lab;

    // the drop, scheduled for the buy phase
    if (this.dropPending >= 0 && (this.dropPending -= dt) <= 0) this._startDrop();
    if (this.phase === 'drop') this._updateDrop(dt);
    const ch = g.chopperIfBuilt?.();
    if (ch?.visible && this.phase !== 'drop') {
      // the drop helicopter flying on after the release
      this.dropT += dt;
      ch.flight.at(Math.min(1, this.dropT / STORY.dropFly), dt);
      ch.heli.searchTarget.set(ch.root.position.x, -0.5, ch.root.position.z + 6);
      if (this.dropT >= STORY.dropFly) ch.show(false);
    }
    ch?.update(dt);
    if (this.crate?.root.visible) this.crate.update(dt, g.time);
    if (this.phase === 'fetch' && this.crate?.root.visible) {
      // the parachute collapses beside the crate after landing
      this.landT = (this.landT ?? 0) + dt;
      this.crate.setChute(Math.min(1, this.landT / 2.5));
    }
    if (this.crate?.root.visible && this.crate.flare.visible && Math.random() < dt * 9) {
      const tp = this.crate.flareTip.getWorldPosition(_a);
      g.fx.smoke.emit(tp.x, tp.y + 0.05, tp.z, rand(-0.15, 0.15), rand(0.8, 1.4), rand(-0.15, 0.15), { life: rand(1.6, 2.6), size: rand(0.3, 0.55), grow: 1.4, drag: 0.8, gravity: -0.35, color: [0.42, 0.1, 0.08], alpha: 0.42 });
    }

    // find her: the lab's glass
    if (this.phase === 'find' && p.alive && !p.latchedBy && !p.heldBy && p.pos.y < -2.4) {
      if (Math.hypot(p.pos.x + 4.6, p.pos.z - 3.85) < STORY.contact && lab?.tech) {
        this.phase = 'contact';
        g.cinema.play(nadjaScene(g));
        return;
      }
    }

    // take the module from the crate
    if (this.phase === 'fetch' && this.crate?.root.visible && p.alive) {
      const c = this.crate.root.position;
      if (p.pos.distanceTo(_a.copy(c).setY(c.y + 0.3)) < STORY.reach + 0.3) {
        this.prompt = 'Hold [E] to take the HACKING MODULE';
        if (e) {
          this.holdT += dt;
          this.hold = this.holdT / STORY.take;
          this.holdLabel = 'TAKING THE MODULE';
          if (this.holdT >= STORY.take) {
            this.holdT = 0;
            this.carrying = true;
            this.phase = 'carry';
            this.crate.root.visible = false;
            this._flareSound(false);
            g.audio.play('pickup_weapon', { volume: 0.8 });
            this.radio('COMMAND', 'Got it? Clamp it onto the keypad by the vault door. It cracks the lock, but it takes time.');
          }
        } else this.holdT = 0;
      } else this.holdT = 0;
    }

    // clamp it on at the keypad
    const mount = lab?.hackMount;
    if (this.phase === 'carry' && p.alive && mount && p.pos.distanceTo(_a.copy(mount.keypad).setY(FB + 0.9)) < STORY.reach + 0.4) {
      this.prompt = 'Hold [E] to attach the HACKING MODULE';
      if (e) {
        this.holdT += dt;
        this.hold = this.holdT / STORY.plant;
        this.holdLabel = 'ATTACHING';
        if (this.holdT >= STORY.plant) {
          this.holdT = 0;
          this.carrying = false;
          this.phase = 'hack';
          this.progress = 0;
          this.jammed = false;
          this.jamT = rand(STORY.jamEvery[0], STORY.jamEvery[1]);
          const m = this._module();
          m.root.visible = true;
          g.audio.play('hack_beep', { position: mount.pos, volume: 1 });
          lab.setLock('hacking');
          this.radio('NADJA', 'It is working! Keep it running and keep those things off it!');
        }
      } else this.holdT = 0;
    } else if (this.phase === 'carry') this.holdT = 0;

    // the hack: runs while the infected attack, stalls now and then
    if (this.phase === 'hack') {
      const m = this._module();
      const run = g.state === 'combat' && !this.jammed;
      if (run) {
        this.progress = Math.min(1, this.progress + dt / this.hackTotal);
        this.jamT -= dt;
        if (this.jamT <= 0 && this.progress < 0.97) {
          this.jammed = true;
          this.alarmT = 0;
          lab.setLock('jammed');
          g.hud.banner('HACK STALLED', 'Restart it at the lab door · hold [E] at the module', 2.6, 'danger');
        }
        const ms = Math.floor(this.progress * 4);
        if (ms > this.milestone) {
          this.milestone = ms;
          if (ms === 1) this.radio('COMMAND', 'Twenty-five percent. Keep the infected off that module.');
          if (ms === 2) this.radio('NADJA', 'Halfway there! Do not let it stop now!');
          if (ms === 3) this.radio('NADJA', 'Almost... I can hear the bolts working!');
        }
        if (this.progress >= 1) this._hacked();
      }
      if (this.jammed) {
        this.alarmT -= dt;
        if (this.alarmT <= 0) {
          this.alarmT = 3;
          g.audio.play('hack_jam', { position: mount.pos, volume: 0.9 });
        }
        if (p.alive && p.pos.distanceTo(_a.copy(mount.pos).setY(FB + 0.9)) < STORY.reach + 0.4) {
          this.prompt = 'Hold [E] to restart the HACK';
          if (e) {
            this.holdT += dt;
            this.hold = this.holdT / STORY.restart;
            this.holdLabel = 'RESTARTING';
            if (this.holdT >= STORY.restart) {
              this.holdT = 0;
              this.jammed = false;
              this.jamT = rand(STORY.jamEvery[0], STORY.jamEvery[1]);
              lab.setLock('hacking');
              g.audio.play('hack_beep', { position: mount.pos, volume: 1 });
            }
          } else this.holdT = 0;
        } else this.holdT = 0;
      }
      if (this.phase === 'hack') m.update(dt, this.jammed ? 'jammed' : run ? 'running' : 'paused', this.progress);
    } else if (this.module?.root.visible) this.module.update(dt, this.hackDone ? 'done' : 'idle', this.progress);

    // overtime: the infected keep coming until the hack is through
    if (this.overtime && g.state === 'combat') {
      if (this.hackDone) this.overtime = false;
      else if ((this.otSpawnT -= dt) <= 0 && g.toSpawn.length < 2 && g.zombies.aliveCount < g.maxAlive) {
        this.otSpawnT = rand(2.2, 4);
        g.toSpawn.push(pick(['mauler', 'mauler', 'worker', 'striker', 'dog', 'mauler', 'biter']));
      }
    }
    this._objective();
  }

  _updateDrop(dt) {
    const g = this.game;
    const ch = g.chopper();
    this.dropT += dt;
    const u = Math.min(1, this.dropT / STORY.dropFly);
    ch.flight.at(u, dt);
    ch.heli.searchTarget.copy(this.dropAt);
    const c = this.crate;
    if (!this.released && u >= 0.5) {
      this.released = true;
      c.root.visible = true;
      c.root.position.copy(ch.root.position).y -= 0.4;
      c.setChute(1);
      this.fallV = 0;
      this.fallT = 0;
    }
    if (this.released) {
      const r = c.root.position;
      this.fallT += dt;
      if (this.fallT > 0.7) c.setChute(Math.max(0, 1 - (this.fallT - 0.7) * 3)); // the canopy blossoms
      this.fallV = this.fallT < 0.7 ? this.fallV + 9.8 * dt : Math.max(STORY.sink, this.fallV - 14 * dt);
      const toGround = Math.max(0.05, (r.y - this.dropAt.y) / Math.max(1, this.fallV));
      // drift onto the chosen spot (the wind would do it)
      r.x += ((this.dropAt.x - r.x) / toGround) * dt;
      r.z += ((this.dropAt.z - r.z) / toGround) * dt;
      r.y -= this.fallV * dt;
      c.root.rotation.z = Math.sin(this.fallT * 1.3) * 0.08 * (this.fallT > 1 ? 1 : 0);
      c.root.rotation.x = Math.cos(this.fallT * 1.1) * 0.06 * (this.fallT > 1 ? 1 : 0);
      if (r.y <= this.dropAt.y) {
        r.copy(this.dropAt);
        c.root.rotation.set(0, Math.random() * TAU, 0);
        this.landT = 0;
        this.phase = 'fetch';
        c.flare.visible = true;
        g.audio.play('crate_land', { position: r, volume: 1 });
        this._flareSound(true);
        for (let i = 0; i < 10; i++) g.fx.smoke.emit(r.x + rand(-0.5, 0.5), r.y + 0.15, r.z + rand(-0.5, 0.5), rand(-1.2, 1.2), rand(0.1, 0.5), rand(-1.2, 1.2), { life: rand(0.8, 1.4), size: rand(0.4, 0.8), grow: 1.2, drag: 2.5, color: [0.2, 0.18, 0.15], alpha: 0.5 });
        this.radio('COMMAND', 'Module is on the ground. Go get it, and watch the gas out there.');
      }
    }
    if (this.dropT >= STORY.dropFly) ch.show(false);
  }

  _hacked() {
    const g = this.game;
    this.phase = 'hacked';
    this.jammed = false;
    this.overtime = false;
    g.lab.setLock('open');
    g.audio.play('hack_done', { position: g.lab.hackMount.pos, volume: 1 });
    g.hud.banner('LOCK CRACKED', g.round >= g.maxRounds ? 'Clear the last of the infected' : 'Nadja opens the door once the horde is beaten back', 3, 'success');
    this.radio('NADJA', "The lock is open! But I'm not opening this door with those things out there. Clear them out, then come in!");
    g.economy.payAll(500, 'round'); // a bonus for the whole fireteam
  }

  /** the objective panel (ui/story.js) for the current phase */
  _objective() {
    const g = this.game;
    const st = g.story;
    let o = null;
    const left = Math.max(0, g.maxRounds - g.round + (g.state === 'combat' ? 1 : 0));
    switch (this.phase) {
      case 'hold':
        o = { text: 'Hold the farmhouse', sub: "Command is still tracing Nadja's signal" };
        break;
      case 'find':
        o = g.unlocked?.basement ? { text: "Find Nadja's lab in the basement", sub: 'Past the basement stairs, behind the glass' } : { text: 'Hold the farmhouse', sub: 'The basement opens with the next wave' };
        break;
      case 'wait':
        o = { text: 'Hold out', sub: 'A hacking module comes down between the waves' };
        break;
      case 'drop':
        o = { text: 'Watch for the supply drop', sub: 'Reaper 1-1 is inbound' };
        break;
      case 'fetch':
        o = { text: 'Collect the hacking module', sub: 'Marked on the radar · mind the gas' };
        break;
      case 'carry':
        o = { text: 'Attach the module to the lab door', sub: 'The keypad by the vault door in the basement' };
        break;
      case 'hack':
        if (this.jammed) o = { text: 'HACK STALLED: restart it!', sub: 'Hold [E] at the module by the lab door', progress: this.progress, alert: true };
        else o = { text: 'Keep the hack running', sub: `${Math.floor(this.progress * 100)}% · ${g.state === 'combat' ? 'cracking the lock' : 'paused until the next wave'}`, progress: this.progress };
        break;
      case 'hacked':
        o = { text: left > 1 ? 'Beat the horde back' : 'Clear the final wave', sub: left > 1 ? `${left} waves to go · then Nadja opens the door` : 'Then Nadja opens the door' };
        break;
    }
    if (this.overtime && !this.hackDone) o = { text: 'Finish the hack!', sub: 'No more waves, but they keep coming', progress: this.progress, alert: this.jammed };
    st.setObjective(o);
  }

  /** the HUD waypoint: { pos, label } or null */
  waypoint() {
    if (!this.story) return null;
    const g = this.game;
    const lab = g.lab;
    if (this.phase === 'find' && g.unlocked?.basement) return { pos: _b.set(-4.6, FB + 0.2, 3.4), label: 'NADJA' };
    if (this.phase === 'fetch' && this.crate?.root.visible) return { pos: _b.copy(this.crate.root.position), label: 'MODULE' };
    if (this.phase === 'carry' && lab) return { pos: _b.copy(lab.hackMount.keypad).setY(FB + 0.2), label: 'LAB DOOR' };
    if (this.phase === 'hack' && this.jammed && lab) return { pos: _b.copy(lab.hackMount.pos).setY(FB + 0.2), label: 'RESTART HACK' };
    return null;
  }

  radarList() {
    const out = [];
    if (!this.story) return out;
    if (this.crate?.root.visible) out.push({ x: this.crate.root.position.x, z: this.crate.root.position.z, kind: 'objective' });
    if ((this.phase === 'carry' || this.phase === 'hack') && this.game.lab) out.push({ x: this.game.lab.hackMount.pos.x, z: this.game.lab.hackMount.pos.z, kind: this.jammed ? 'objectiveAlert' : 'objective' });
    return out;
  }
}
