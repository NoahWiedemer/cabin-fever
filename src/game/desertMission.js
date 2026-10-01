// Operation Desert Thunder (world/desert.js): the mission that runs instead of waves. Combat Arms' first Fireteam map,
// its story and its beats: a fireteam goes into Mogadishu for an Intelligence Bureau operative the Sand Hog militia
// have caught, and for the proof he found of their weapons trade. Four sectors, a checkpoint at the start of each
// (the fireteam healed and restocked, the fallen back on their feet):
//   1 the insertion route  down the ropes into the lot (game/desertScenes.js insert), north up the main street, east
//                          along the cross street past the burnt bus and the machine gun at its end, to the plaza;
//                          Colonel Coleman briefs you on the way
//   2 the temple           five minutes before they execute him. The front door is barred, one of the wings' gates is
//                          chained (which one changes every run), the wings are booby-trapped, the royal guard holds
//                          the gallery. You're too late: the hostage scene, the coded memo, the back door
//   3 the road             out the back; the armoured car at the top of the ramp shells the street. Round through the
//                          alley and the yard, up the stairs onto the terrace: a grenade into its open engine deck
//   4 the town             the ambush in the square, the intel in the office (the GPS mark), a charge on the compound
//                          gate, the crash site behind it: the extraction (game/desertScenes.js extract)
// Everyone down fails the mission, and so does the clock running out in the temple. Down yourself while the others
// fight on: revived, or back at the checkpoint a little later (Combat Arms' respawn token).
// The militia come in squads (GROUPS) as you reach their part of the town; the ones left far behind are cleared away.
import * as THREE from 'three';
import { Teammate } from '../actors/teammate.js';
import { Chopper } from '../world/helicopter.js';
import { levelOf } from '../world/level.js';
import { rocketProto } from '../actors/insurgent.js';
import { insertScene, hostageScene, extractScene } from './desertScenes.js';
import * as Progress from './progress.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const G = 0, U = 3.4; // (world/desert.js: the lower town, the terrace / the temple's gallery)
const _a = V(), _b = V();
const PI = Math.PI;

export const DT = {
  hostageTime: 300, // s to reach him (sector 2)
  respawn: 8, // s down (past the revive window) before you're back at the checkpoint
  intel: 2.4, // s holding E at the desk
  plant: 3.0, // s holding E at the gate
  fuse: 6, // s the charge burns
  reach: 1.8, // m from the desk / the gate
  trap: { radius: 6, damage: 200, delay: 0.45 },
  charge: { radius: 7.5, damage: 320 },
  far: 45, // m: a militia man of an earlier sector this far from all of you is cleared away
};

const NAMES = { 1: 'THE INSERTION ROUTE', 2: 'THE TEMPLE', 3: 'THE ROAD', 4: 'THE TOWN' };
// the checkpoints (the sector starts): x, y, z, the player's yaw (0 faces north, -z)
const CHECKPOINTS = {
  1: [-32, G, 82, 0],
  2: [17.5, G, 30, -PI / 2], // the plaza, facing the temple
  3: [44, U, -17.2, PI], // the temple's gallery, outside the room
  4: [24, U, -82, PI / 2], // the armoured car's square, facing the town
};

// The squads: [role, x, y, z, face, opts] (face: the body's yaw, 0 facing south (+z); 'player': turned toward you) or
// [role, nest] (a balcony or roof in world/desert.js: the snipers, the machine gun). opts.hold: keeps to its spot.
// `alert`: awake from the start (the ambushes).
const GROUPS = {
  // ---- sector 1: the main street, the back yard off it, the cross street (the bus, the MG), the plaza
  main: { sector: 1, units: [['rifle', -30.2, G, 57.5, PI], ['rifle', -33.6, G, 55.2, PI - 0.5], ['rifle', -28.4, G, 48.6, 0.6], ['sniper', 'mainW2']] }, // (turned up the street: they don't see you land)
  yard: { sector: 1, units: [['rifle', -4.5, G, 51.5, -PI / 2], ['rifle', -6.5, G, 43.5, -1.2], ['rusher', 0.5, G, 40.5, -PI / 2], ['sniper', 'yardN']] },
  cross: { sector: 1, units: [['rifle', -24.5, G, 30.6, -PI / 2], ['rifle', -18.6, G, 34.9, -PI / 2], ['rifle', -8.5, G, 30.2, -PI / 2], ['rpg', -2.6, G, 35.6, -PI / 2], ['rusher', -38.4, G, 29.2, PI / 2], ['mg', 'mgCross'], ['sniper', 'crossN1'], ['sniper', 'crossN2']] },
  plaza: { sector: 1, units: [['rifle', 13.8, G, 27.2, -PI / 2], ['rifle', 18.6, G, 17.2, -PI / 2], ['rpg', 16.4, G, 11.2, -0.8], ['sniper', 'plazaN'], ['sniper', 'plazaS']] },
  // ---- sector 2: the anteroom, the courtyard, the open wing, the hall and its gallery
  ante: { sector: 2, units: [['rifle', 26.6, G, 26.4, -PI / 2], ['rifle', 29.4, G, 20.6, -1.0], ['sniper', 'templeRoof']] },
  court: { sector: 2, units: [['rifle', 38.2, G, 11.6, -PI / 2], ['rifle', 50.4, G, 21.4, -PI / 2], ['rifle', 40.6, G, 26.4, -2.2], ['guard', 44, G, 3.6, 0, { hold: true }], ['rusher', 52.4, G, 8.6, -PI / 2]] },
  wingW: { sector: 2, units: [['rifle', 27.6, G, -2.6, PI / 2], ['guard', 27, U, -27, 0, { hold: true }]] },
  wingE: { sector: 2, units: [['rifle', 59, G, -3, -PI / 2], ['guard', 59, U, -27, 0, { hold: true }]] },
  hall: { sector: 2, units: [['guard', 40, U, -17, 'player'], ['guard', 48.6, U, -16.4, 'player'], ['rifle', 40, G, -8, 'player'], ['rifle', 48, G, -11, 'player']] },
  // ---- sector 3: the back street, the east alley, the yard under the terrace wall, the terrace round the armour
  back: { sector: 3, units: [['rifle', 21.6, G, -35, PI / 2], ['rifle', 36.6, G, -37.6, 0], ['rpg', 40.6, G, -38.6, 0], ['sniper', 'rampE']] },
  alley: { sector: 3, units: [['rifle', 50, G, -49, 0], ['rusher', 50.2, G, -56.5, 0]] },
  yardS: { sector: 3, units: [['rifle', 58, G, -60.5, -PI / 2], ['rifle', 67, G, -62, -PI / 2], ['rpg', 54, U, -65.2, 0, { hold: true }], ['sniper', 'yardS']] },
  terrace: { sector: 3, units: [['rifle', 46, U, -69.5, PI / 2], ['rifle', 39, U, -78, PI / 2], ['sniper', 'apcE'], ['sniper', 'apcN']] },
  // ---- sector 4: the street into town, the office's guards, the crash site's (behind the gate), the ambushes
  street: { sector: 4, units: [['rifle', 15, U, -85.6, PI / 2], ['rifle', 13, U, -90.4, PI / 2]] },
  office: { sector: 4, units: [['guard', -55.5, U, -100, PI / 2, { hold: true }], ['guard', -46, U, -89.5, PI / 2, { hold: true }]] },
  crash: { sector: 4, units: [['rifle', -26, U, -121, 0], ['rifle', -3, U, -125.5, 0], ['guard', -17, U, -129.5, 0], ['guard', -31, U, -128, 0], ['sniper', 'crashW']] },
  ambush: { sector: 4, alert: true, units: [['sniper', 'sqS'], ['sniper', 'sqE'], ['rifle', -36, U, -88, PI / 2], ['rifle', -33, U, -106, PI / 2], ['rifle', -18, U, -109.5, 0], ['rifle', -2, U, -109, 0], ['rpg', -9, U, -110.5, 0], ['rusher', -38.5, U, -97, PI / 2], ['rusher', -28, U, -111, 0]] },
  ambush2: { sector: 4, alert: true, units: [['rifle', -38.5, U, -81, PI / 2], ['rifle', -37, U, -92.5, PI / 2], ['rusher', -38, U, -104, PI / 2], ['rifle', -24, U, -110.5, 0]] },
  counter: { sector: 4, alert: true, units: [['rifle', 16, U, -84, PI / 2], ['rifle', 12, U, -91, PI / 2], ['rusher', 15, U, -80, PI / 2], ['rpg', 6, U, -81, PI / 2]] },
};

export class DesertMission {
  constructor(refs) {
    this.refs = refs;
    this.game = null;
    this.level = null;
    this.clock = null; // the HUD's clock (s) while a timer runs, else null
    this.prompt = null; // (game.js: the E prompt and the hold ring)
    this.hold = null;
    this.holdLabel = null;
    this.captive = null;
    this.chB = null;
    this.traps = [];
    this.phase = 'off';
  }

  // ---------------------------------------------------------------- setup
  attach(game, level) {
    this.game = game;
    this.level = level;
    const r = this.refs;
    r.apc.attach(game);
    game.apc = r.apc;
    r.apc.onDestroyed = () => this._apcDown();
    r.wreck.show(false, game);
    this._buildTraps();
    this._buildProps();
    // (a rocket for the loading screen's shader warm-up: game.js reveals it once)
    this.warmRocket = rocketProto().clone();
    this.warmRocket.visible = false;
    game.scene.add(this.warmRocket);
  }

  /** hidden things whose shaders should be ready before they first show (game.js precompile) */
  prewarmList() {
    return [this.refs.wreck.heli.root, this.c4, this.warmRocket];
  }

  /** a new run (game.start): the world back as it was, then the insertion */
  start(game) {
    game.state = 'combat';
    game.round = 1;
    game.maxRounds = 4;
    game.timed = false;
    game.timeLeft = Infinity; // (the mission's own clocks: this.clock)
    this._resetWorld();
    this.phase = 'insert';
    game.cinema.play(insertScene(game));
  }

  /** back to the menu (game.quit) */
  reset() {
    if (!this.game) return;
    this._resetWorld();
    this.phase = 'off';
  }

  _resetWorld() {
    const g = this.game, r = this.refs, T = r.temple;
    this.sector = 0;
    this.sectorT = 0;
    this.clock = null;
    this.prompt = this.hold = this.holdLabel = null;
    this.holdT = 0;
    this.spawned = new Set(); // the groups that have come
    this.queue = []; // units that found the pool empty: they come when there's room (and you're not looking)
    this.timers = [];
    this.said = new Set();
    this.failReason = null;
    this.respawnT = DT.respawn;
    this.respawnSaid = false;
    this.fuseT = 0;
    this.beepT = 0;
    this.intelTaken = false;
    this.gps = false;
    this.engineHint = false;
    this.apcAwake = false;
    this.ambushT = -1;
    this.cleanT = 0;
    this.wreckBurning = false;
    this.cp = null;
    T.doors.front.close(g);
    T.doors.back.close(g);
    T.doors.gateW.lock(g);
    T.doors.gateE.lock(g);
    r.gate.reset(g);
    r.wreck.show(false, g);
    r.apc.reset();
    for (const t of this.traps) {
      t.armed = true;
      t.group.visible = true;
      t.wire.visible = true;
      t.nade.visible = true;
    }
    this.folder.visible = true;
    this.c4.visible = false;
    this.chB?.show(false);
    g.chopperIfBuilt?.()?.show(false);
    this.poseCaptive();
    g.story?.setObjective(null);
  }

  /** the tripwires across the wings' corridors (world/desert.js TEMPLE traps): a wire, two stakes, the grenade */
  _buildTraps() {
    const g = this.game;
    const wireM = new THREE.MeshStandardMaterial({ color: 0x8a8a80, metalness: 0.8, roughness: 0.35 });
    const stakeM = new THREE.MeshStandardMaterial({ color: 0x3a3026, roughness: 0.8 });
    const nadeM = new THREE.MeshStandardMaterial({ color: 0x3e4a2a, roughness: 0.6, metalness: 0.2 });
    const spoonM = new THREE.MeshStandardMaterial({ color: 0x6a6a64, metalness: 0.8, roughness: 0.4 });
    this.traps = this.refs.temple.traps.map((d) => {
      const group = new THREE.Group();
      const len = d.x1 - d.x0;
      const wire = new THREE.Mesh(new THREE.BoxGeometry(len, 0.005, 0.005), wireM);
      wire.position.set((d.x0 + d.x1) / 2, G + d.y, d.z);
      group.add(wire);
      for (const x of [d.x0, d.x1]) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.03, d.y + 0.08, 0.03), stakeM);
        s.position.set(x, G + (d.y + 0.08) / 2, d.z);
        group.add(s);
      }
      const nade = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.042, 12, 10), nadeM);
      body.scale.set(1, 1.2, 1);
      nade.add(body);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.03, 8), spoonM);
      top.position.y = 0.056;
      nade.add(top);
      nade.position.set(d.x0 + len * 0.3, G + 0.05, d.z + 0.07); // (tied to the wire a third of the way across, in the dust)
      group.add(nade);
      group.traverse((o) => o.isMesh && (o.castShadow = true));
      g.scene.add(group);
      return { ...d, group, wire, nade, armed: true };
    });
  }

  /** the intel folder on the office desk, the charge for the gate (hidden until it's set) */
  _buildProps() {
    const g = this.game, r = this.refs;
    const folder = new THREE.Group();
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.03, 0.33), new THREE.MeshStandardMaterial({ color: 0x3a4a30, roughness: 0.8 }));
    folder.add(cover);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.252, 0.032, 0.05), new THREE.MeshStandardMaterial({ color: 0x8a1a14, roughness: 0.7 }));
    stripe.position.z = -0.09;
    folder.add(stripe);
    const sheets = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.02, 0.31), new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.9 }));
    sheets.position.set(0.012, 0.004, 0.006);
    folder.add(sheets);
    folder.position.copy(r.office.intelAt).setY(r.office.intelAt.y - 0.02);
    folder.rotation.y = 0.25;
    folder.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    g.scene.add(folder);
    this.folder = folder;
    const c4 = new THREE.Group();
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.07), new THREE.MeshStandardMaterial({ color: 0xb8a878, roughness: 0.85 }));
    c4.add(block);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.29, 0.03, 0.075), new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 }));
    c4.add(tape);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
    box.position.set(0.05, 0.05, 0.045);
    c4.add(box);
    this.led = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.2) }));
    this.led.position.set(0.07, 0.06, 0.062);
    c4.add(this.led);
    const p = r.gate.plantAt;
    c4.position.set(p.x, U + 1.15, -111.74);
    c4.rotation.y = PI; // (on the gate's south face)
    g.scene.add(c4);
    this.c4 = c4;
  }

  /** the operative, dead in his chair (a posed body: nothing moves it after this) */
  poseCaptive() {
    const g = this.game;
    if (!this.captive) {
      const c = new Teammate(g, 299, { id: 'captive', name: 'Operative', body: 'captive', weapon: 'ak47', gun: '', rank: 0 });
      g.scene.add(c.root);
      c.gunHolder.visible = false;
      this.captive = c;
    }
    const c = this.captive;
    c.spawn(this.refs.temple.hostageAt, 0);
    c.gunHolder.visible = false;
    c.cine(0, { mode: 'sit', seatH: 0.5 });
    // slumped forward in the ropes, the head hanging to one side
    const b = c.bones;
    b.spine.rotation.x += 0.22;
    b.chest.rotation.x += 0.16;
    b.neck.rotation.x += 0.5;
    b.head.rotation.x += 0.3;
    b.head.rotation.z += 0.28;
    if (c.rig) c.rig.sync();
    c.root.updateMatrixWorld(true);
    c.alive = false; // (nobody's target)
  }

  /** the second helicopter of the extraction (game/desertScenes.js), built on first use */
  secondChopper() {
    const g = this.game;
    return (this.chB ??= new Chopper(g.scene, g.audio, g.level.chopper ?? {}));
  }

  // ---------------------------------------------------------------- hooks
  onCinemaEnd(id, skipped) {
    const g = this.game;
    if (id === 'dtInsert') this._beginSector(1);
    else if (id === 'dtHostage') this._beginSector(3);
    else if (id === 'dtExtract') {
      this.phase = 'done';
      g._finish(true);
    }
  }

  finishText(victory) {
    return victory ? 'The intel is secured' : (this.failReason ?? 'Your fireteam was wiped out');
  }

  radio(who, text, dur) {
    const g = this.game;
    if (g.cinema.active || !g.running) return;
    g.story.radioMsg(who, text, dur);
  }

  /** a radio line once per run */
  say(key, who, text, dur) {
    if (this.said.has(key)) return;
    this.said.add(key);
    this.radio(who, text, dur);
  }

  /** fn after `s` seconds of mission time (paused with the game; dropped on a new run, or if the sector moves on first) */
  later(s, fn) {
    this.timers.push({ t: s, fn, sector: this.sector });
  }

  // ---------------------------------------------------------------- sectors
  _beginSector(n) {
    const g = this.game;
    this.sector = n;
    this.sectorT = 0;
    g.round = n;
    this._checkpoint(n);
    this._cleanup(true);
    if (n > 1) g._career?.(Progress.objective(120 + 30 * n));
    const T = this.refs.temple;
    if (n === 1) {
      this.phase = 'route';
      this._spawnGroup('main');
      this.later(2.5, () => this.radio('COLEMAN', "One more thing. The Sand Hog carry rifle ammo and first aid kits. If you run low, take what they drop."));
      this.later(11, () => this.radio('COLEMAN', "Their ammo won't fit a sniper rifle or a machine gun, though. Make every one of those rounds count."));
      this.later(28, () => this.radio('COLEMAN', 'The man you are after got inside Mogadishu to prove the Sand Hog are running guns over the border. They caught him before he got out.'));
      this.later(48, () => this.radio('COLEMAN', 'To get the Sand Hog on the expulsion list, Parliament wants hard evidence. Bring him out, and find out where he hid what he found.'));
    } else if (n === 2) {
      this.phase = 'temple';
      this.clock = DT.hostageTime;
      // one wing's gate opens for you, the other stays chained
      this.openWing = Math.random() < 0.5 ? 'W' : 'E';
      (this.openWing === 'W' ? T.doors.gateW : T.doors.gateE).open(g);
      (this.openWing === 'W' ? T.doors.gateE : T.doors.gateW).lock(g);
      this._spawnGroup('ante');
      this._spawnGroup('court');
      this._spawnGroup(this.openWing === 'W' ? 'wingW' : 'wingE');
      this.radio('COLEMAN', "They're getting ready to execute him! There's no time! Move, move! You have five minutes to get him out!");
      this.later(5, () => this.radio('EVANS', 'The UAV has eyes on the temple. It looks like they are holding him on the upper floor.'));
    } else if (n === 3) {
      this.phase = 'road';
      this._spawnGroup('back');
      this.radio('EVANS', "He's gone. But he held on to an encrypted memo. I'm sending it to headquarters.");
      this.later(6, () => this.radio('COLEMAN', "Hard luck for him. The memo gives the location of the evidence. Once you're in town, I'll send the target to your GPS."));
    } else if (n === 4) {
      this.phase = 'town';
      this._spawnGroup('street');
      this._spawnGroup('office');
      this._spawnGroup('crash');
      this.radio('COLEMAN', 'The Sand Hog will have an ambush waiting for you in town. Keep your eyes on the rooftops.');
      this.later(7, () => {
        this.gps = true;
        this.radio('COLEMAN', 'The memo points to the spot on your GPS. You know where it is. Move, now!');
        g.audio.play('hack_beep', { volume: 0.5 });
      });
    }
  }

  /** a checkpoint: the fireteam healed and restocked, the fallen back beside it */
  _checkpoint(n) {
    const g = this.game;
    const [x, y, z, yaw] = CHECKPOINTS[n];
    this.cp = { pos: V(x, y, z), yaw };
    g.revives?.onRoundEnd(); // (the downed markers go; everyone may be revived once again this sector)
    g.revives?.onRoundStart();
    let k = 0;
    const p = g.player;
    for (const m of g.team) {
      if (m.isPlayer) {
        if (!m.alive) {
          m.spawn(this._spot(0), yaw);
          g.weapons.switchTo(0, true);
        }
        m.hp = m.maxHp ?? 100;
        m.ap = Math.max(m.ap, 100);
      } else if (!m.alive) {
        m.spawn(this._spot(++k), yaw + PI);
        m.hp = 100;
        m.ap = 60;
      } else {
        m.hp = 100;
        m.ap = Math.max(m.ap ?? 0, 60);
        // (one left far behind rejoins here)
        if (p.alive && m.pos.distanceTo(p.pos) > 30 && n > 1) {
          m.pos.copy(this._spot(++k));
          m.body.vel.set(0, 0, 0);
          m.field = null;
          m.portalTo = null;
        }
      }
    }
    g.spectate = null;
    g.weapons.restock();
    this.respawnT = DT.respawn;
    if (n > 1) {
      g.audio.play('round_end', { volume: 0.7 });
      g.hud.banner(`SECTOR ${n} · ${NAMES[n]}`, 'Checkpoint · HP and ammo restored · the fallen are back', 3.4, 'success');
    } else g.hud.banner(`SECTOR 1 · ${NAMES[1]}`, 'Push north through the town', 3.2, 'normal');
  }

  /** a clear spot by the checkpoint for the k-th of you */
  _spot(k) {
    const g = this.game, c = this.cp.pos;
    if (k === 0) return c.clone();
    for (let i = 0; i < 8; i++) {
      const a = k * 2.3 + (i * PI) / 4, r = 1.1 + 0.2 * (k % 2);
      const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      const y = g.world.groundHeight(x, z, 0.3, c.y + 0.5);
      if (Math.abs(y - c.y) < 0.15 && g.world.lineOfSight(c.x, c.y + 1, c.z, x, y + 1, z)) return V(x, y, z);
    }
    return c.clone();
  }

  // ---------------------------------------------------------------- the militia
  _spawnGroup(id) {
    if (this.spawned.has(id)) return;
    this.spawned.add(id);
    const def = GROUPS[id];
    for (const u of def.units) this._spawnUnit(u, def, id);
  }

  _spawnUnit(u, def, id, fromQueue = false) {
    const g = this.game, F = g.insurgents;
    const role = u[0];
    let pos, yaw, post = false, hold = null;
    if (typeof u[1] === 'string') {
      const n = this.refs.nests[u[1]];
      if (!n) return true;
      pos = n.pos.clone();
      yaw = n.yaw;
      post = true;
    } else {
      const [, x, y, z, face, o = {}] = u;
      const gy = g.world.groundHeight(x, z, 0.3, y + 0.6);
      pos = V(x, gy > y - 1 ? gy : y, z);
      const p = g.player.pos;
      yaw = face === 'player' ? Math.atan2(p.x - x, p.z - z) : face;
      if (o.hold) hold = [x, z];
    }
    if (fromQueue) {
      // (not right beside you, not where you're looking)
      const p = g.player.pos;
      if (p.distanceTo(pos) < 18) return false;
      if (g.world.lineOfSight(p.x, p.y + 1.6, p.z, pos.x, pos.y + 1.5, pos.z)) return false;
    }
    // (the snipers and gunners up in their nests are a squad of their own: one of them seeing you wakes the others
    // up there, not the men in the street)
    const m = F.spawn(role, pos, yaw, { post, hold, alert: !!def.alert, squad: post ? id + ':posts' : id });
    if (!m) {
      if (!fromQueue) this.queue.push({ u, def, id });
      return false;
    }
    m.sector = def.sector;
    m.group = id;
    return true;
  }

  /** alive and in the fight, of group `id` */
  _alive(id) {
    let n = 0;
    for (const m of this.game.insurgents.list) if (m.armed && m.group === id) n++;
    return n;
  }

  /** the ones of earlier sectors far from all of you go (force: at a sector's start, else every few seconds) */
  _cleanup(force) {
    const g = this.game;
    for (const m of g.insurgents.list) {
      if (!m.armed || (m.sector ?? 0) >= this.sector) continue;
      let d = Infinity;
      for (const t of g.team) if (t.alive) d = Math.min(d, t.pos.distanceTo(m.pos));
      if (d < (force ? DT.far : DT.far + 15)) continue;
      m.hide();
      m.inPlay = false;
      if (m.laser) m.laser.visible = false;
    }
    this.queue = this.queue.filter((q) => q.def.sector >= this.sector);
  }

  // ---------------------------------------------------------------- each frame
  update(dt) {
    const g = this.game;
    if (this.phase === 'off' || this.phase === 'done' || g.cinema.active) return;
    const p = g.player, input = g.input;
    const lv = levelOf(p.pos.y + 0.3);
    const e = !!(input?.locked && input.down('KeyE') && p.alive);
    this.prompt = null;
    this.hold = null;
    this.holdLabel = null;
    this.sectorT += dt;
    this.refs.apc.update(dt);

    // timers, the queue, the cleanup
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      if (t.sector !== this.sector) this.timers.splice(i, 1);
      else if ((t.t -= dt) <= 0) {
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    if ((this.cleanT -= dt) <= 0) {
      this.cleanT = 1;
      this._cleanup(false);
      for (let i = this.queue.length - 1; i >= 0; i--) {
        const q = this.queue[i];
        if (this._spawnUnit(q.u, q.def, q.id, true)) this.queue.splice(i, 1);
      }
    }

    // down while the others fight on: revived, or back at the checkpoint after a while
    if (!p.alive && g.team.some((m) => m !== p && m.alive)) {
      if (!g.revives?.recordOf(p)) {
        if (!this.respawnSaid) {
          this.respawnSaid = true;
          g.hud.banner('BACK SOON', `You'll be back at the checkpoint in ${DT.respawn} s`, 2.6, 'normal');
        }
        if ((this.respawnT -= dt) <= 0) this._respawnPlayer();
      }
    } else {
      this.respawnT = DT.respawn;
      this.respawnSaid = false;
    }

    // the wreck burning (after the end: the crash)
    if (this.wreckBurning) this._burn(dt);
    this._regroup(dt);

    // the tripwires
    for (const t of this.traps) {
      if (!t.armed || !p.alive || lv !== 1) continue;
      if (Math.abs(p.pos.z - t.z) < 0.35 && p.pos.x > t.x0 - 0.1 && p.pos.x < t.x1 + 0.1 && p.pos.y < G + t.y + 0.12) this._springTrap(t);
    }

    switch (this.sector) {
      case 1:
        this._sector1(p, lv);
        break;
      case 2:
        this._sector2(dt, p, lv);
        break;
      case 3:
        this._sector3(p, lv);
        break;
      case 4:
        this._sector4(dt, p, lv, e);
        break;
    }
    this._objective();
  }

  _sector1(p, lv) {
    const g = this.game;
    if (lv === 1 && p.pos.z < 66) {
      this._spawnGroup('yard');
      this._spawnGroup('cross');
    }
    if (lv === 1 && p.pos.z < 40) this._spawnGroup('plaza');
    // the machine gun wakes: a warning
    for (const m of g.insurgents.list) {
      if (m.role === 'mg' && m.armed && m.alerted) this.say('mg', 'EVANS', 'Machine gun at the end of the street! Get behind the bus!');
    }
    // the plaza: the temple's in sight
    if (lv === 1 && p.pos.x > 7 && p.pos.z > 6 && p.pos.z < 42) this._beginSector(2);
  }

  _sector2(dt, p, lv) {
    const g = this.game, T = this.refs.temple;
    // the clock
    if (this.clock != null) {
      const before = this.clock;
      this.clock = Math.max(0, this.clock - dt);
      if (before > 60 && this.clock <= 60) this.radio('EVANS', 'One minute left! Hurry!');
      if (before > 120 && this.clock <= 120) this.radio('COLEMAN', 'Two minutes, Fireteam. Faster!');
      if (this.clock <= 0) {
        this.failReason = 'The hostage was executed';
        this.clock = 0;
        g._finish(false);
        return;
      }
    }
    const x = p.pos.x, z = p.pos.z;
    // the front door: barred
    if (lv === 1 && Math.hypot(x - 44, z - 0.5) < 4.5 && z > 0) this.say('door', 'EVANS', "The door's barred shut! Find another way up!");
    // the chained gate, the open one (and what's behind it)
    const lockedX = this.openWing === 'W' ? 55.5 : 32.5, openX = this.openWing === 'W' ? 32.5 : 55.5;
    if (lv === 1 && Math.hypot(x - lockedX, z - 5.5) < 3.2) this.say('chained', 'EVANS', "This gate's chained. Try the other wing!");
    if (lv === 1 && Math.hypot(x - openX, z - 5.5) < 6) this.say('traps', 'EVANS', 'There might be booby traps in there. Watch your step!');
    // inside the open wing, or up its stairs: the hall and the gallery wake up
    const inWing = this.openWing === 'W' ? x < 32 && x > 22 : x > 56 && x < 62;
    if (inWing && z < 8) this._spawnGroup('hall');
    // the royal guard in sight
    for (const m of g.insurgents.list) {
      if (m.role === 'guard' && m.armed && m.alerted && m.pos.distanceTo(p.pos) < 30) this.say('guards', 'COLEMAN', "Watch the ones in black! Those are the Sand Hog's royal guard, and they're extremely dangerous!");
    }
    // on the gallery: a shot in the room
    if (lv === 2 && x > 32.5 && x < 55.5 && z > -20.6 && z < -13.8 && !this.said.has('shot')) {
      this.said.add('shot');
      g.audio.play('pistol_fire', { position: _a.set(44, U + 1.2, -25), volume: 1, pitch: 0.95 });
      this.later(0.7, () => this.radio('EVANS', 'Was that a shot?! Get in there!'));
    }
    // the room: too late
    if (p.alive && lv === 2 && x > 38.3 && x < 49.7 && z > -29.7 && z < -20.25) {
      this.clock = null;
      this.phase = 'scene';
      g.fx.bloodPoolAt(_b.set(44.1, U + 0.2, -24.4));
      g.cinema.play(hostageScene(g, this.refs, this));
    }
  }

  _sector3(p, lv) {
    const g = this.game;
    const x = p.pos.x, z = p.pos.z;
    // out through the back door: the armour at the top of the ramp wakes
    if (lv === 1 && z < -30.4 && !this.apcAwake) {
      this.apcAwake = true;
      this.refs.apc.activate();
      this._spawnGroup('alley');
      this.radio('EVANS', 'Enemy armour at the top of the ramp! Watch out for that cannon!');
      this.later(4, () => this.radio('COLEMAN', "Nothing you carry will get through that hull. Stay off the ramp and go round, through the alley to the east."));
      this.later(22, () => this._engineHint());
    }
    if (lv === 1 && x > 44 && z < -38) this._spawnGroup('yardS');
    if ((lv === 1 && x > 51 && z < -52) || (lv === 2 && z < -64 && x > 20)) {
      this._spawnGroup('terrace');
      if (lv === 1) this._engineHint();
    }
  }

  _engineHint() {
    if (this.engineHint || !this.refs.apc.alive) return;
    this.engineHint = true;
    this.radio('EVANS', "UAV imagery shows the tank's engine cover propped open. You know what to do, right?");
  }

  _apcDown() {
    if (this.sector !== 3) return;
    this.phase = 'road';
    this.radio('EVANS', "The armour's burning! Nice work!");
    this.later(3, () => this._beginSector(4));
  }

  _sector4(dt, p, lv, e) {
    const g = this.game, r = this.refs;
    const x = p.pos.x, z = p.pos.z;
    // the square: the ambush
    if (lv === 2 && x < 11 && z < -76 && z > -112 && !this.spawned.has('ambush')) {
      this._spawnGroup('ambush');
      this.ambushT = 0;
      this.radio('EVANS', "Contact, rooftops! It's the ambush!");
    }
    if (this.ambushT >= 0 && !this.spawned.has('ambush2')) {
      this.ambushT += dt;
      if (this.ambushT > 24 || (this.ambushT > 6 && this._alive('ambush') <= 2)) this._spawnGroup('ambush2');
    }
    // the intel on the desk
    if (!this.intelTaken && p.alive && lv === 2) {
      const at = r.office.intelAt;
      if (Math.hypot(x - at.x, z - at.z) < DT.reach) {
        this.prompt = 'Hold [E] to take the INTEL';
        if (e) {
          this.holdT += dt;
          this.hold = this.holdT / DT.intel;
          this.holdLabel = 'TAKING THE INTEL';
          if (this.holdT >= DT.intel) {
            this.holdT = 0;
            this.intelTaken = true;
            this.folder.visible = false;
            g.audio.play('pickup_weapon', { volume: 0.8 });
            g.hud.banner('INTEL SECURED', 'The Sand Hog\'s shipping records · now get out', 3, 'success');
            g._career?.(Progress.objective(200));
            this._spawnGroup('counter');
            this.radio('COLEMAN', "That's it: shipments, buyers, the whole network. Good work. Your extraction point is past the compound gate to the north. Blow it open.");
          }
        } else this.holdT = 0;
      } else this.holdT = 0;
    }
    // the charge on the gate
    if (this.intelTaken && !this.c4.visible && !r.gate.blown && p.alive && lv === 2) {
      const at = r.gate.plantAt;
      if (Math.hypot(x - at.x, z - at.z) < DT.reach) {
        this.prompt = 'Hold [E] to plant the CHARGE';
        if (e) {
          this.holdT += dt;
          this.hold = this.holdT / DT.plant;
          this.holdLabel = 'PLANTING';
          if (this.holdT >= DT.plant) {
            this.holdT = 0;
            this.c4.visible = true;
            this.fuseT = DT.fuse;
            this.beepT = 0;
            g.audio.play('mine_arm', { position: this.c4.position, volume: 1 });
            g.hud.banner('CHARGE SET', `${DT.fuse} seconds · get clear of the gate!`, 2.4, 'danger');
            this.radio('EVANS', 'Charge is set! Get clear!', 2.2);
          }
        } else this.holdT = 0;
      } else this.holdT = 0;
    }
    // the fuse
    if (this.c4.visible && !r.gate.blown) {
      this.fuseT -= dt;
      this.beepT -= dt;
      const rate = this.fuseT > 2 ? 0.5 : 0.18;
      if (this.beepT <= 0) {
        this.beepT = rate;
        g.audio.play('charge_beep', { position: this.c4.position, volume: 1 });
        this.ledT = 0.08;
      }
      this.ledT = (this.ledT ?? 0) - dt;
      this.led.visible = this.ledT > 0;
      if (this.fuseT <= 0) this._blowGate();
    }
    // the extraction point: its guards down and you in it, nobody shooting at you from close by (or a while in there)
    if (r.gate.blown && p.alive && lv === 2 && z < -112.6 && this._alive('crash') === 0) {
      this.siteT = (this.siteT ?? 0) + dt;
      let near = false;
      for (const m of g.insurgents.list) {
        if (m.armed && m.pos.distanceTo(p.pos) < 20 && g.world.lineOfSight(m.pos.x, m.pos.y + 1.5, m.pos.z, x, p.pos.y + 1.4, z)) near = true;
      }
      if (!near || this.siteT > 25) {
        this.phase = 'outro';
        g.cinema.play(extractScene(g, this.refs, this));
      }
    }
  }

  _blowGate() {
    const g = this.game, r = this.refs;
    this.c4.visible = false;
    const at = _a.copy(r.gate.plantAt).setY(U + 1.2);
    r.gate.blow(g);
    g.explode(at.clone(), DT.charge.radius, DT.charge.damage, g.player, { scale: 1.8 });
    g.insurgents.hear(at, 70);
    this.queue.length = 0; // (no more stragglers: it's the crash site now)
    this.siteT = 0;
    g.hud.banner('GATE DOWN', 'Get to the extraction point', 2.8, 'success');
    this.radio('EVANS', "Gate's down! Get to the extraction point, go!");
    this.phase = 'extract';
  }

  _springTrap(t) {
    const g = this.game;
    t.armed = false;
    t.wire.visible = false;
    const at = t.nade.getWorldPosition(V());
    g.audio.play('mine_click', { position: at, volume: 1 });
    g.audio.play('grenade_pin', { position: at, volume: 0.9 });
    this.later(DT.trap.delay, () => {
      t.nade.visible = false;
      g.explode(at, DT.trap.radius, DT.trap.damage, null, { scale: 0.9 });
      this.say('trapped', 'EVANS', 'Booby trap! Watch the floor!');
    });
  }

  /**
   * A bot that has lost you (stuck somewhere, or left far behind) for a while comes back: put down a few metres
   * behind you, where you can't see it appear. The checkpoints gather everyone anyway.
   */
  _regroup(dt) {
    const g = this.game, p = g.player;
    if (!p.alive) return;
    for (const b of g.team) {
      if (b.isPlayer || !b.alive) continue;
      const far = b.pos.distanceTo(p.pos) > 40;
      b.lostT = far ? (b.lostT ?? 0) + dt : 0;
      if (b.lostT < 20) continue;
      const at = this._behind(p);
      if (!at) continue;
      b.lostT = 0;
      b.pos.copy(at);
      b.body.vel.set(0, 0, 0);
      b.lastPos?.copy(at);
      b.field = null;
      b.portalTo = null;
      b.post = null;
    }
  }

  /** a clear spot on your level 3-6 m behind you, out of your sight, or null */
  _behind(p) {
    const g = this.game;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    for (let i = 0; i < 10; i++) {
      const a = (i - 4.5) * 0.35, d = 3 + (i % 3);
      const x = p.pos.x - (fx * Math.cos(a) - fz * Math.sin(a)) * d, z = p.pos.z - (fz * Math.cos(a) + fx * Math.sin(a)) * d;
      const y = g.world.groundHeight(x, z, 0.3, p.pos.y + 0.5);
      if (Math.abs(y - p.pos.y) > 0.3) continue;
      if (!g.world.lineOfSight(p.pos.x, p.pos.y + 1, p.pos.z, x, y + 1, z)) continue; // (not through a wall)
      return V(x, y, z);
    }
    return null;
  }

  _respawnPlayer() {
    const g = this.game, p = g.player;
    this.respawnT = DT.respawn;
    this.respawnSaid = false;
    p.spawn(this._spot(0), this.cp.yaw);
    g.weapons.switchTo(0, true);
    p.hp = p.maxHp ?? 100;
    p.ap = Math.max(p.ap ?? 0, 50);
    g.weapons.restock();
    g.spectate = null;
    g.hud.banner('BACK IN THE FIGHT', "At the sector's checkpoint", 2.4, 'success');
  }

  _burn(dt) {
    const g = this.game, s = this.refs.wreck.smokeAt;
    if (Math.random() < dt * 24) g.fx.fire.emit(s.x + (Math.random() - 0.5) * 1.6, s.y - 0.6, s.z + (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.4, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 0.4, { life: 0.4 + Math.random() * 0.4, size: 0.7 + Math.random() * 0.6, grow: 1.8, drag: 2, gravity: -1.5, color: [5, 2.6, 1.0], endColor: [1.2, 0.3, 0.08] });
    if (Math.random() < dt * 10) g.fx.smoke.emit(s.x + (Math.random() - 0.5), s.y + 0.5, s.z + (Math.random() - 0.5), (Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.6, { life: 3 + Math.random() * 2, size: 1 + Math.random() * 0.8, grow: 1.6, drag: 0.6, gravity: -0.6, color: [0.06, 0.055, 0.05], endColor: [0.18, 0.17, 0.16], alpha: 0.6 });
  }

  // ---------------------------------------------------------------- the HUD
  /** the objective panel (ui/story.js) */
  _objective() {
    const g = this.game, r = this.refs;
    let o = null;
    switch (this.sector) {
      case 1:
        o = { text: 'Reach the temple', sub: 'North up the main street, then east along the cross street' };
        break;
      case 2:
        o = { text: 'Rescue the hostage', sub: 'The temple\'s upper floor · the front door is barred', alert: this.clock != null && this.clock < 60 };
        break;
      case 3:
        if (!this.apcAwake) o = { text: 'Get out of the temple', sub: 'Through the back door in the hall' };
        else if (r.apc.alive) o = this.engineHint ? { text: 'Destroy the armoured car', sub: 'Its engine cover is open at the back · a grenade in there' } : { text: 'Get past the armoured car', sub: 'Stay off the ramp · round through the alley to the east' };
        else o = { text: 'The armour is down', sub: 'On into the town' };
        break;
      case 4:
        if (!this.intelTaken) o = this.gps ? { text: 'Find the intel', sub: 'The spot marked on your GPS' } : { text: 'Move into the town', sub: 'Expect an ambush' };
        else if (!r.gate.blown && !this.c4.visible) o = { text: 'Blow the compound gate', sub: 'Plant the charge on the gate north of the square' };
        else if (!r.gate.blown) o = { text: 'Get clear of the gate!', sub: `${Math.max(0, Math.ceil(this.fuseT))} s`, progress: 1 - this.fuseT / DT.fuse, alert: true };
        else o = { text: 'Secure the extraction point', sub: this._alive('crash') > 0 ? 'Clear the crash site' : 'Get into the crash site' };
        break;
    }
    g.story.setObjective(o);
  }

  /** the HUD waypoint: { pos, label } or null */
  waypoint(player) {
    const r = this.refs;
    const lv = levelOf(player.pos.y + 0.3);
    switch (this.sector) {
      case 1:
        return { pos: _b.set(21.5, G, 25), label: 'TEMPLE' };
      case 2:
        return { pos: _b.set(44, U, -19.6), label: 'HOSTAGE' };
      case 3:
        if (!this.apcAwake) return { pos: _b.set(44, G, -30.2), label: 'BACK DOOR' };
        if (!r.apc.alive) return null;
        if (this.engineHint) return { pos: _b.copy(r.apc.bayAt), label: 'ENGINE' };
        return lv === 1 && player.pos.x < 49 ? { pos: _b.set(50, G, -42), label: 'DETOUR' } : null;
      case 4:
        if (!this.intelTaken) {
          if (!this.gps) return null;
          return r.office.inside(player.pos.x, player.pos.y + 0.5, player.pos.z) ? { pos: _b.copy(r.office.intelAt), label: 'INTEL' } : { pos: _b.copy(r.office.door), label: 'INTEL' };
        }
        if (!r.gate.blown && !this.c4.visible) return { pos: _b.copy(r.gate.plantAt), label: 'GATE' };
        if (r.gate.blown) return { pos: _b.set(-14, U, -121), label: 'EXTRACTION' };
        return null;
    }
    return null;
  }

  radarList() {
    const w = this.waypoint(this.game.player);
    return w ? [{ x: w.pos.x, z: w.pos.z, kind: 'objective' }] : [];
  }
}
