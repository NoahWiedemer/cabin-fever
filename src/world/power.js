// Generator power. The gasoline generator in the basement (world/generator.js animates it) feeds every
// electric light: all level.lamps entries (house, basement, stairs, porch, gun shop, barn floodlights)
// unless marked `mains: false` (the lab's emergency circuit) or `fire: true`, the shared bulb material
// and anything else put on the circuit with registerPowered(). Moonlight, lightning, fire, muzzle flashes
// and the flashlight are not on it.
//
// Until the basement opens it simply runs. From then on (hard / extreme round 10+, endless too):
//   * fuel burns during combat only (the buy phase / countdowns don't count): a full tank lasts
//     POWER.tankSecs of fighting (8 min, about 3-4 rounds);
//   * random faults: exponential with a mean of POWER.failEvery s of combat, never within
//     POWER.failCooldown s of the last (re)start nor in the first POWER.roundGrace s of a round. It
//     sputters (lights brown out and flicker) for POWER.sputter s, then dies;
//   * fixing a fault: hold F within POWER.reach m of it for POWER.repairTime s (wrench, then the pull-start),
//     then it catches, unless the tank is dry;
//   * out of fuel: it sputters and dies; pour a jerry can in (slot 6, hold LMB for POWER.refuelTime s,
//     +POWER.refuel of the tank) and it starts again (a fault still needs the repair first).
// Two cans wait upstairs (world/gasCans.js); a used can returns to its spot POWER.canRespawn rounds later.
import * as THREE from 'three';
import { getMaterial } from './materials.js';
import { buildGeneratorRig } from './generator.js';
import { GasCans } from './gasCans.js';

export const POWER = {
  tankSecs: 480, // a full tank: 8 min of combat
  failEvery: 240, // mean s of (eligible) combat between random faults
  failCooldown: 60, // no fault within this long of a (re)start
  roundGrace: 12, // nor in the first seconds of a round
  sputter: 3.2, // s of sputtering before it dies
  repairTime: 2.5, // s holding F
  yankAt: 1.85, // into the repair: the wrench goes, the hand yanks the pull-start
  catchDelay: 0.55, // pull-start → the engine catches
  refuelTime: 2.0, // s holding LMB with the can
  refuel: 0.65, // one can = 65 % of the tank
  lowFuel: 0.2, // HUD warning / banner below this
  reach: 1.2, // m from the generator's footprint
  canMax: 2,
  canRespawn: 2, // rounds until a used can's spot has a new one
};

// ---------------------------------------------------------------- the circuit (module level: other
// modules register at build time, before the game exists)
const registry = [];
let mains = 1;

/**
 * Put something on the generator circuit. target:
 *   Material with emissive (Standard/Physical) → emissiveIntensity × level
 *   MeshBasic / Sprite material                → color × level
 *   Light                                      → intensity × level
 *   function                                   → fn(level) every frame the level changes
 * The base value is captured now (or pass opts.base).
 */
export function registerPowered(target, opts = {}) {
  if (!target || registry.some((e) => e.target === target)) return;
  const e = { target, kind: 'fn', base: opts.base };
  if (typeof target === 'function') e.kind = 'fn';
  else if (target.isLight) {
    e.kind = 'light';
    e.base ??= target.intensity;
  } else if (target.isMaterial && target.emissive && !target.isMeshBasicMaterial) {
    e.kind = 'emissive';
    e.base ??= target.emissiveIntensity;
  } else if (target.isMaterial && target.color) {
    e.kind = 'color';
    e.base = (e.base ?? target.color).clone?.() ?? new THREE.Color(e.base);
  } else return;
  registry.push(e);
  apply(e, mains);
}

/** Current mains level 0..1 (flickers during brown-outs). */
export function powerLevel() {
  return mains;
}

function apply(e, k) {
  const t = e.target;
  if (e.kind === 'emissive') t.emissiveIntensity = e.base * k;
  else if (e.kind === 'light') t.intensity = e.base * k;
  else if (e.kind === 'color') t.color.copy(e.base).multiplyScalar(k);
  else t(k);
}

function setMains(k, force = false) {
  if (!force && Math.abs(k - mains) < 0.002) return;
  mains = k;
  for (const e of registry) apply(e, k);
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// the lights stutter back on after the engine catches: [time, level] keyframes
const RESTORE = [[0, 0], [0.04, 1], [0.1, 0.12], [0.2, 0.08], [0.26, 0.85], [0.36, 0.3], [0.5, 0.55], [0.75, 0.9], [1.0, 1]];
function restoreCurve(t) {
  for (let i = 1; i < RESTORE.length; i++) {
    if (t <= RESTORE[i][0]) {
      const [t0, a] = RESTORE[i - 1], [t1, b] = RESTORE[i];
      return a + (b - a) * ((t - t0) / (t1 - t0));
    }
  }
  return 1;
}

export class Power {
  constructor(game, scene) {
    this.game = game;
    registerPowered(getMaterial('bulb'));
    const info = game.level.generator;
    this.rig = info ? buildGeneratorRig(scene, info, game.fx) : null;
    this.cans = new GasCans(game, scene, { max: POWER.canMax, respawnRounds: POWER.canRespawn });
    this.runHandle = null;
    this.reset();
  }

  /** New game: full tank, running, not yet burning fuel. */
  reset() {
    this.active = false; // basement open: fuel burns, faults happen
    this.state = 'running'; // running | sputter | down | dry | starting
    this.reason = null; // what the sputter ends in: 'fault' | 'fuel'
    this.fuel = 1;
    this.stateT = 0;
    this.sinceStart = 0;
    this.restoreT = 9; // s since the engine last caught (the lights' restore stutter)
    this.level = 1;
    this.surgeT = 0;
    this.coughT = 0;
    this.cough = 0;
    this.pull = 0;
    this.pullT = 9;
    this.repairT = 0;
    this.repairing = false;
    this.linger = 0;
    this.pourT = 0;
    this.pouring = false;
    this.lowWarned = false;
    this.prompt = null;
    this.hold = null;
    this.holdLabel = null;
    this._stopPour();
    this.cans.reset();
    setMains(1, true);
    if (this.game.lighting) this.game.lighting.mains = 1;
    this.rig?.update(0, { run: 0, level: 1, fuel: 1, status: 'on', pull: 0 });
  }

  /** A match starts: fresh state, the engine running. */
  start() {
    this.reset();
    this._engine(true);
  }

  /** Leaving the match: silence the engine, lights back on for the menu. */
  stop() {
    this.runHandle?.stop(0.2);
    this.runHandle = null;
    this._stopPour();
    setMains(1, true);
    if (this.game.lighting) this.game.lighting.mains = 1;
  }

  activate() {
    if (this.active) return;
    this.active = true;
    this.sinceStart = 0;
    this.cans.spawnAll();
  }

  onRoundStart(round) {
    if (this.active) this.cans.onRoundStart(round);
  }

  get running() {
    return this.state === 'running' || (this.state === 'sputter' && this.reason === 'fault');
  }

  /** At the generator while it waits for a repair: F is the repair (game._updateF skips the flashlight). */
  fOwned(player) {
    return this.state === 'down' && this._near(player);
  }

  _near(player) {
    if (!this.active || !this.rig || !player?.alive) return false;
    if (Math.abs(player.pos.y - this.game.level.generator.y) > 1.0) return false;
    return this.rig.distTo(player.pos) <= POWER.reach;
  }

  // ---------------------------------------------------------------- state
  _fail(reason) {
    if (this.state !== 'running') return;
    this.state = 'sputter';
    this.reason = reason;
    this.stateT = 0;
    this.coughT = 0;
  }

  _die() {
    const g = this.game;
    this.state = this.reason === 'fuel' || this.fuel <= 0 ? 'dry' : 'down';
    this.stateT = 0;
    this._engine(false);
    const at = this.rig?.exhaust;
    g.audio.play('gen_die', { position: at, volume: 1 });
    g.audio.play('power_out', { volume: 0.7 });
    g.shake?.add(0.04);
    if (this.state === 'dry') g.hud?.banner('OUT OF FUEL', 'The generator is dry · bring a gas can from upstairs', 3.4, 'danger');
    else g.hud?.banner('THE GENERATOR IS DOWN', 'Lights out · hold F at the generator in the basement to fix it', 3.4, 'danger');
  }

  /** Pull-start: the engine catches after a beat (if there's fuel). */
  _start() {
    this.state = 'starting';
    this.stateT = 0;
    this.pullT = 0;
    this.game.audio.play('gen_pull', { position: this.rig?.exhaust, volume: 1 });
  }

  _caught() {
    const g = this.game;
    if (this.fuel <= 0.001) {
      // cranks, coughs, nothing
      this.state = 'dry';
      this.stateT = 0;
      g.audio.play('gen_cough', { position: this.rig?.exhaust, volume: 0.8 });
      return;
    }
    this.state = 'running';
    this.reason = null;
    this.stateT = 0;
    this.sinceStart = 0;
    this.restoreT = 0;
    this.cough = 1;
    g.audio.play('gen_catch', { position: this.rig?.exhaust, volume: 1 });
    g.audio.play('power_on', { volume: 0.6 });
    this._engine(true);
    if (this.active) g.hud?.banner('POWER RESTORED', this.fuel < POWER.lowFuel ? 'The tank is almost dry · find a gas can' : 'The generator is running again', 2.2, 'success');
  }

  _engine(on) {
    if (!on) {
      this.runHandle?.stop(0.35);
      this.runHandle = null;
      return;
    }
    if (this.runHandle?.playing || !this.rig) return;
    this.runHandle = this.game.audio.play('gen_run', { position: this.rig.exhaust, loop: true, volume: 0.55 });
  }

  // ---------------------------------------------------------------- update
  update(dt, input) {
    const g = this.game;
    const combat = g.state === 'combat';
    this.stateT += dt;
    this.restoreT += dt;
    this.cough = Math.max(0, this.cough - dt * 3);

    if (this.state === 'running') {
      this.sinceStart += combat ? dt : 0;
      if (this.active && combat) {
        const before = this.fuel;
        this.fuel = Math.max(0, this.fuel - dt / POWER.tankSecs);
        if (before >= POWER.lowFuel && this.fuel < POWER.lowFuel && !this.lowWarned) {
          this.lowWarned = true;
          g.hud?.banner('GENERATOR LOW ON FUEL', 'Gas cans are upstairs · pour one in at the generator', 3, 'normal');
        }
        if (this.fuel <= 0) this._fail('fuel');
        else if (this.sinceStart > POWER.failCooldown && (g.roundTime ?? 0) > POWER.roundGrace && Math.random() < dt / POWER.failEvery) this._fail('fault');
      }
    } else if (this.state === 'sputter') {
      if (this.reason === 'fault' && combat) this.fuel = Math.max(0, this.fuel - dt / POWER.tankSecs);
      // misfires: a cough every so often, faster toward the end
      this.coughT -= dt;
      if (this.coughT <= 0) {
        this.coughT = 0.25 + Math.random() * (0.7 - 0.4 * (this.stateT / POWER.sputter));
        this.cough = 1;
        this.surgeT = 0.12 + Math.random() * 0.1;
        g.audio.play('gen_cough', { position: this.rig?.exhaust, volume: 0.9 });
      }
      if (this.stateT >= POWER.sputter) this._die();
    } else if (this.state === 'starting') {
      if (this.stateT >= POWER.catchDelay) this._caught();
    }
    if (this.fuel >= POWER.lowFuel + 0.05) this.lowWarned = false;

    this._interact(dt, input);
    this.cans.update(dt, g.player);
    this._lights(dt);

    // engine loop: pitch sags and wobbles while it sputters
    if (this.runHandle) {
      if (this.state === 'sputter') {
        const x = this.stateT / POWER.sputter;
        this.runHandle.setPitch(1 - 0.35 * x + (this.cough > 0.5 ? -0.12 : 0) + Math.sin(this.stateT * 13) * 0.04);
        this.runHandle.setVolume(0.55 * (1 - 0.4 * x) * (this.cough > 0.5 ? 0.5 : 1));
      } else {
        const catchUp = Math.min(1, this.restoreT / 0.8);
        this.runHandle.setPitch(0.8 + 0.2 * catchUp + (this.fuel < 0.05 && this.active ? Math.sin(this.stateT * 7) * 0.03 : 0));
        this.runHandle.setVolume(0.55);
      }
    }
    if (this.rig) {
      const st = this.state;
      this.rig.update(dt, {
        run: st === 'running' ? 1 : st === 'sputter' ? 0.7 : 0,
        level: this.level,
        fuel: this.fuel,
        status: st === 'running' ? (this.active && this.fuel < POWER.lowFuel ? 'warn' : 'on') : st === 'sputter' || st === 'starting' ? 'warn' : 'off',
        pull: this.pull,
        cough: this.cough,
      });
    }
  }

  /** Mains level: the flicker / brown-out patterns, a filament's lag, into lighting + the circuit. */
  _lights(dt) {
    let target = 1;
    const st = this.state;
    if (st === 'running') {
      if (this.restoreT < 1) target = restoreCurve(this.restoreT);
      // running on fumes: the odd surge
      if (this.active && this.fuel < 0.06 && this.surgeT <= 0 && Math.random() < dt * 0.6) this.surgeT = 0.08 + Math.random() * 0.12;
    } else if (st === 'sputter') {
      const x = this.stateT / POWER.sputter;
      target = (1 - 0.45 * x) * (0.85 + 0.15 * Math.sin(this.stateT * 31) * Math.sin(this.stateT * 7.7));
      if (x > 0.88) target *= Math.max(0, 1 - (x - 0.88) / 0.12);
    } else target = 0;
    if (this.surgeT > 0) {
      this.surgeT -= dt;
      target *= st === 'sputter' ? 0.12 : 0.55;
    }
    // incandescent filaments: quick but not instant
    this.level += (target - this.level) * (1 - Math.exp(-dt * 26));
    if (this.level < 0.003) this.level = 0;
    setMains(this.level);
    const L = this.game.lighting;
    if (L) L.mains = this.level;
    // the viewmodel's warm fill stands in for lamp light: it fades with the mains (a little flashlight
    // spill keeps the gun readable in a blackout)
    const vm = this.game.viewmodel;
    if (vm?.fill) vm.fill.intensity = 0.45 * (0.3 + 0.7 * this.level) + (L?.flashlightOn ? 0.3 * (1 - this.level) : 0);
  }

  // ---------------------------------------------------------------- the player at the generator
  _interact(dt, input) {
    const g = this.game, p = g.player, w = g.weapons;
    this.prompt = null;
    this.hold = null;
    this.holdLabel = null;
    // the pull-start handle on the engine: out along its cord in 0.12 s, reeled back in 0.5 s
    this.pullT += dt;
    this.pull = this.pullT < 0.12 ? this.pullT / 0.12 : Math.max(0, 1 - (this.pullT - 0.12) / 0.5);
    w.pourT = null;
    const near = this._near(p);

    // ---- repair: hold F (fOwned keeps the flashlight out of it)
    if (this.linger > 0) {
      // the hand finishes the yank after the repair completed
      this.linger -= dt;
      this.repairT += dt;
      w.toolT = this.repairT;
      if (this.linger <= 0) {
        this.repairT = 0;
        w.endTool();
      }
    } else if (this.state === 'down' && near) {
      this.prompt = 'Hold [F] to repair the GENERATOR';
      if (input && input.down('KeyF') && p.alive && (w.state === 'idle' || w.state === 'tool' || w.state === 'draw' || w.state === 'bolt')) {
        if (!this.repairing) {
          this.repairing = true;
          this.repairT = 0;
          w.beginTool('wrench');
          w.toolYank = POWER.yankAt;
        }
        const before = this.repairT;
        this.repairT += dt;
        w.toolT = this.repairT;
        p.noSprint = true;
        this.hold = Math.min(1, this.repairT / POWER.repairTime);
        this.holdLabel = 'REPAIRING THE GENERATOR';
        // ratchet strokes (viewmodel: one every 0.62 s, the click at the end of the push)
        const S = 0.62;
        if (this.repairT < POWER.yankAt && Math.floor((this.repairT + 0.33) / S) > Math.floor((before + 0.33) / S)) g.audio.play('wrench_ratchet', { position: this.rig?.center, volume: 0.8 });
        if (before < POWER.yankAt + 0.1 && this.repairT >= POWER.yankAt + 0.1) {
          this.pullT = 0;
          g.audio.play('gen_pull', { position: this.rig?.exhaust, volume: 1 });
        }
        if (this.repairT >= POWER.repairTime) {
          this.repairing = false;
          this.linger = 0.35;
          this.state = 'starting';
          this.stateT = 0;
        }
      } else this._cancelRepair();
    } else this._cancelRepair();

    // ---- refuel: the can in the hands, hold LMB
    const canOut = w.def?.mode === 'pour' && !w.tool && (w.gascans ?? 0) > 0;
    if (this.cans.full && !this.prompt) this.prompt = `You can carry ${POWER.canMax} GAS CANS`;
    if (!(input && input.mouse(0))) this.needRelease = false; // one click per can
    const needed = this.state === 'dry' || this.fuel < POWER.lowFuel;
    if (!canOut || !this.active || !near) {
      this._stopPour();
      if (canOut && this.active && needed && !this.prompt) this.prompt = 'Take the GAS CAN to the GENERATOR in the basement';
      return;
    }
    if (this.fuel > 0.97) {
      this._stopPour();
      if (!this.prompt) this.prompt = 'The GENERATOR is full';
      return;
    }
    if (!this.prompt) this.prompt = `Hold [LMB] to refuel the GENERATOR (${Math.round(this.fuel * 100)}%)`;
    if (!(input && input.mouse(0) && w.state === 'idle') || this.needRelease) {
      this._stopPour();
      return;
    }
    if (!this.pouring) {
      this.pouring = true;
      this.pourT = 0;
      this.pourHandle = g.audio.play('fuel_pour', { volume: 0.75 });
    }
    this.pourT += dt;
    w.pourT = this.pourT;
    p.noSprint = true;
    this.hold = Math.min(1, this.pourT / POWER.refuelTime);
    this.holdLabel = 'REFUELLING THE GENERATOR';
    if (this.pourT >= POWER.refuelTime) {
      this._stopPour();
      this.needRelease = true;
      this.fuel = Math.min(1, this.fuel + POWER.refuel);
      w.gascans = Math.max(0, w.gascans - 1);
      this.cans.consume();
      g.audio.play('can_empty', { volume: 0.8 });
      if (this.state === 'dry') this._start();
      else if (this.state === 'down') g.hud?.banner('TANK FILLED', 'It still needs fixing · hold F at the generator', 2.4, 'normal');
      if (w.gascans <= 0 && w.cur === 5) w.switchTo(w.fallbackSlot(), true);
    }
  }

  _cancelRepair() {
    if (!this.repairing) return;
    this.repairing = false;
    this.repairT = 0;
    this.game.weapons.endTool();
  }

  _stopPour() {
    this.pouring = false;
    this.pourT = 0;
    this.pourHandle?.stop(0.15);
    this.pourHandle = null;
  }

  // ---------------------------------------------------------------- HUD
  /** Generator indicator (only once the basement is open): { fuel, state 'on'|'warn'|'off' }. */
  hudInfo() {
    if (!this.active) return null;
    const st = this.state;
    return { fuel: this.fuel, state: st === 'running' ? (this.fuel < POWER.lowFuel ? 'warn' : 'on') : st === 'sputter' || st === 'starting' ? 'warn' : 'off' };
  }

  /** Where to send the player while the power is out: { pos, label } or null. */
  waypoint(player) {
    if (!this.active || !this.rig || !player?.alive || !(this.state === 'down' || this.state === 'dry')) return null;
    const w = this.game.weapons;
    if (this.state === 'dry' && !(w.gascans > 0)) {
      const can = this.cans.nearestAvailable(player.pos);
      if (can) return can.obj.position.distanceTo(player.pos) > 2.5 ? { pos: can.obj.position, label: 'GAS CAN' } : null;
    }
    return this.rig.center.distanceTo(player.pos) > 3.5 ? { pos: this.rig.center, label: 'GENERATOR' } : null;
  }

  radarList() {
    const out = this.cans.radarList();
    if (this.active && this.rig && (this.state === 'down' || this.state === 'dry')) out.push({ x: this.rig.center.x, z: this.rig.center.z, kind: 'generator' });
    return out;
  }

  // ---------------------------------------------------------------- debug (console: __game.power.*)
  debugFail(reason = 'fault') {
    this.activate();
    if (this.state !== 'running') this.state = 'running';
    this._fail(reason);
  }

  debugFuel(f) {
    this.activate();
    this.fuel = Math.max(0, Math.min(1, f));
  }
}
