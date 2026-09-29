// Cabin Fever game mode: waves of infected, the story (game/mission.js: cutscenes, the hacking mission),
// rare random events (game/events.js), unlocks, special weapons, scoring/combos, damage routing (hitscan,
// melee, explosions, acid, gas), team & spectating.
import * as THREE from 'three';
import { levelOf } from '../world/level.js';
import { buildMap, MAPS } from '../world/maps.js';
import { Lighting } from '../world/lighting.js';
import { Weather } from '../world/weather.js';
import { NavGrid } from '../nav/navgrid.js';
import { Horde } from '../nav/horde.js';
import { ZombieManager, ZOMBIE_TYPES, PART_MULT } from '../actors/zombie.js';
import '../actors/biter.js'; // registers the Biter class with the zombie manager
import { StalkerDirector } from '../actors/stalker.js'; // (also registers the Stalker class)
import '../actors/crusher.js'; // registers the Crusher class (slam, charge, rage)
import { LatchView } from '../fx/latchView.js';
import { Teammate } from '../actors/teammate.js';
import { FIRETEAM, LEGACY_LINEUPS, PLAYER_CHARACTER, normalizeFireteam } from '../actors/fireteam.js';
import { prebuildCharacters } from '../actors/rig.js';
import { Effects } from '../fx/effects.js';
import { Player } from '../player/player.js';
import { WeaponSystem } from '../player/weapons.js';
import { Viewmodel } from '../player/viewmodel.js';
import { WEAPONS, SPECIAL_SPAWNS } from '../player/weaponDefs.js';
import { Projectiles } from './projectiles.js';
import { Pickups } from './pickups.js';
import { Economy, killReward, roundBonus } from './economy.js';
import { MODES } from './modes.js';
import { GAS_MASK, maskCapacity, setPriceScale } from './shop.js';
import { Cinema } from './cinema.js';
import { Mission, STORY } from './mission.js';
import { RandomEvents } from './events.js';
import { Chopper } from '../world/helicopter.js';
import { StoryUI } from '../ui/story.js';
import { Gear, SHOCKWAVE } from './gear.js';
import { FLAG_NOBULLET, SURF } from '../world/collision.js';
import { Shake, clamp, rand, pick, damp } from '../core/utils.js';
import { QUALITY } from '../core/renderer.js';
import { preloadGLBs } from '../core/assets.js';
import { GLB_URLS } from '../core/assetList.js';
import { addLandmarks } from '../world/landmarks.js';
import { buildGunShop } from '../world/gunshop.js';
import { createLabTech } from '../actors/labTech.js';
import { Barricades } from '../world/barricades.js';
import { Breach } from '../world/breach.js';
import { installShadowProxies } from '../world/shadowProxy.js';
import { Shaft } from '../world/shaft.js';
import { MercSquad } from '../actors/merc.js';
import * as Progress from './progress.js';
import { Rogue } from './rogue.js';
import { Ladders } from '../actors/ladders.js';
import { BarnFire } from '../world/barnFire.js';
import { Power } from '../world/power.js';
import { Revives } from './revive.js';

// Every difficulty plays the story's STORY.rounds rounds in STORY.minutes; they differ in the numbers:
// hp: infected health, dmg: damage the fireteam takes, count: wave size, speed: infected speed, biters: share
// of Biter packs, pack: largest Biter pack, price: store prices, cash: starting money, hack: seconds of hacking.
const DIFF = {
  easy: { label: 'EASY', hp: 0.72, dmg: 0.6, count: 0.8, speed: 0.95, biters: 0.6, pack: 4, price: 0.75, cash: 800, hack: 150 },
  hard: { label: 'HARD', hp: 1.0, dmg: 1.0, count: 1.0, speed: 1.0, biters: 1, pack: 5, price: 1, cash: 500, hack: 180 },
  extreme: { label: 'EXTREME', hp: 1.2, dmg: 1.22, count: 1.15, speed: 1.05, biters: 1.2, pack: 5, price: 1.15, cash: 400, hack: 210 },
};

const _hit = {};
const bulletFilter = (b) => (b.flags & FLAG_NOBULLET) === 0;
const _p = new THREE.Vector3();
const _n = new THREE.Vector3();
const _dawnFog = new THREE.Color(0.42, 0.36, 0.36);
const _dawnSun = new THREE.Color(1.0, 0.72, 0.52);
const _wp = new THREE.Vector3();
const LOOT_GUNS = ['p90', 'r201', 'spas12', 'devotion', 'sigma', 'g36c', 'ak47']; // the Survivalist's stash (one you don't carry)
// ...and from round LAUNCHER_LOOT.round on, now and then the Softball grenade launcher (a special: no
// store sells it, one load and no reloads, marked on the map)
const LAUNCHER_LOOT = { round: 7, chance: 0.22 };
const NAV_SLICE = 9000; // a big map: nav cells relaxed a frame for the infected's field (about 2 ms)
const F_TAP = 0.25; // F released faster than this is a tap (flashlight / open the gun shop)
const READY_HOLD = 1.2; // hold F this long in the buy phase to ready up
// weapon mastery (game/progress.js) counts the real weapons only (not a Boomer's blast, not a barrel)
const masteryWeapon = (id) => (id && WEAPONS[id] && WEAPONS[id].slot >= 0 ? id : null);
// the fireteam's ranks (fireteam.js, 0-5) on the career ladder, for the scoreboard's insignia
const BOT_GRADE = [1, 2, 3, 5, 8, 10];
// who a pipe bomb's beeping draws in (game.lureStart)
const LURED = new Set(['mauler', 'worker', 'survivor', 'dog', 'charger', 'striker']);
// the upstairs (level.upperSpawns, once its stairs are open): this share of the wave climbs in at a window up there
// while nobody is upstairs, at most `max` of them up there at once, and comes down the stairs (_upperSpawn)
const UPPER = { share: 0.12, max: 3, types: new Set(['mauler', 'worker', 'survivor', 'striker', 'charger']) };
const _look = new THREE.Vector3();

// Main-menu camera shots: a / b = [camX, camY, camZ, lookX, lookY, lookZ], eased over `period` s.
const MENU_SHOTS = {
  title: { fov: 58, period: 90, a: [-0.5, 1.8, 23, -5.5, 2.6, 8], b: [4, 2.3, 21.5, -4.2, 2.7, 8] }, // the yard: trees left, lit porch right
  porch: { fov: 58, period: 70, a: [-4.6, 1.25, 14.2, -7.0, 1.7, 6.5], b: [-5.6, 1.35, 12.4, -6.8, 1.6, 6.0] }, // pushing in on the front door
  interior: { fov: 62, period: 80, a: [-2.4, 1.55, -0.2, -7.4, 1.25, 8.5], b: [-4.6, 1.6, 1.4, -6.2, 1.25, 8.5] }, // lamp-lit living room
  // the PLAY screen (ui/lobbyStage.js): out in the yard, south of the sandbags, the camera looks over the squad
  // into the dark and the rain. cast.spots = [x, z, yaw] of the four seats (yaw 0 faces +z, PI faces -z, toward
  // the camera; looking toward +z screen left is +x, so the first seat has the largest x); the stage pans and
  // zooms the shot to fit them. fog / hemi / moon / torch: how dark it is (the mist's density; the sky light,
  // the moon and the torch beam as shares of the game's own)
  lobby: {
    fov: 40,
    period: 60,
    fog: 0.06,
    hemi: 2.4,
    moon: 1.4,
    torch: 1.4,
    a: [-6.6, 1.5, 17.6, -6.6, 1.25, 25.6],
    b: [-6.9, 1.55, 17.1, -6.6, 1.25, 25.6],
    cast: { spots: [[-5.25, 21.6, Math.PI + 0.22], [-6.15, 21.6, Math.PI + 0.08], [-7.05, 21.6, Math.PI - 0.08], [-7.95, 21.6, Math.PI - 0.22]] },
  },
};

export class Game {
  constructor({ gr, audio, hud, input, settings, map }) {
    this.map = map ?? MAPS.farm; // world/maps.js: fixed for the page (a new pick reloads it)
    this.gr = gr;
    this.scene = gr.scene;
    this.camera = gr.camera;
    this.audio = audio;
    this.hud = hud;
    this.input = input;
    this.settings = settings;
    this.shake = new Shake();
    this.time = 0;
    this.running = false;
    this.paused = false;
    this.state = 'menu';
    this.fovScale = 1;
    this.corpseTime = 7;
    // money: one wallet per fireteam member, every payout goes to all of them
    this.economy = new Economy();
    this.economy.onPay = (amount) => !this.rogue?.on && this.hud?.popCash?.(amount); // (the Gauntlet has no cash)
    this.shopOpen = false;
    this.onShopOpen = null; // set by main.js: show the store, release the pointer
    this.gear = new Gear(this); // store gear worn on body slots (game/gear.js), incl. the gas mask
    this.fHold = null; // seconds F has been held in the buy phase
    this.story = new StoryUI(hud); // cinema overlay, objective panel, radio messages (ui/story.js)
  }

  // ------------------------------------------------------------------ loading
  async load(progress) {
    const step = async (f, label) => {
      progress?.(f, label);
      await new Promise((r) => setTimeout(r, 0));
    };
    const scene = this.scene;
    scene.background = new THREE.Color(0x07090b);
    this.fog = new THREE.Fog(0x141c1a, 0, 0.055);
    scene.fog = this.fog;

    await step(0.55, this.map.loading);
    this.level = await buildMap(this.map, (f, label) => progress?.(0.55 + f * 0.09, label ?? this.map.loading));
    this.world = this.level.world;
    scene.add(this.level.group);
    // the static level casts through a few merged depth meshes: far fewer shadow-map draws (world/shadowProxy.js)
    this.shadowProxies = installShadowProxies(this.gr.renderer, this.level.group);
    this.breach = new Breach(this, scene); // the rare wall breach (world/breach.js): its wall patches collide from the start
    this.shaft = new Shaft(this); // the coal tunnel the infected come up once the basement is open (world/shaft.js)

    await step(0.64, 'Wiring the lights');
    this.quality = QUALITY[this.settings.quality] || QUALITY.high;
    this.lighting = new Lighting(scene, this.level.lamps, this.quality, this.level.indoor ?? null);
    this.lighting.world = this.world; // flashlight auto-dim raycast
    this.lighting.moonFollow = !!this.level.bigMap; // (the moon's shadow box slides with the camera)
    this.lighting.onThunder = (intensity, delay) => {
      this.audio.thunder(intensity, delay);
      if (intensity > 0.8) this.weather?.strike();
    };
    scene.environment = makeEnvMap(this.gr.renderer);
    scene.environmentIntensity = 0.35;

    await step(0.7, 'Summoning the storm');
    this.weather = new Weather(scene, this.level);
    this.audio.underground = !!this.level.indoor; // (core/audio.js startAmbience: the air handlers instead of the weather)

    await step(0.76, 'Computing navigation');
    this.nav = new NavGrid(this.world, this.level.portals, this.level.navBlocks, this.level.navOpts ?? {});
    this.postFields = new Map();
    this.horde = new Horde(this); // entrance routes + crowd bookkeeping for the infected (nav/horde.js)

    await step(0.78, 'Loading models');
    await preloadGLBs(GLB_URLS, (f) => progress?.(0.78 + f * 0.04, 'Loading models'));
    if (this.level.landmarks !== false) addLandmarks(scene); // (the farm's chapel on the horizon)
    // the map's own shop (level.shop.custom: Appenweier's garage), else the farm's cellar shop
    this.gunshop = this.level.shop?.custom ? this.level.shop.custom(scene, this) : buildGunShop(scene, this.level, this.world);
    this.lab = this.level.lab; // behind the basement's armored glass (world/lab.js): Nadja at her counter
    this.lab?.spawnTech(createLabTech);
    this.barricades = new Barricades(this, scene);
    this.power = new Power(this, scene); // the basement generator: fuel, faults, the lights (world/power.js)
    this.revives = new Revives(this, scene); // downed teammates, revive channels, bots running to the rescue (game/revive.js)

    await step(0.82, 'Infecting soldiers');
    prebuildCharacters();
    this.fx = new Effects(scene, this.world, this.lighting, this.audio);
    this.zombies = new ZombieManager(this, scene);
    this.zombies.prewarm();
    this.ladders = new Ladders(this); // the barn's hayloft ladder: player + infected climbing
    this.barnFire = new BarnFire(this); // the rare lightning strike that burns the barn (world/barnFire.js)
    this.latchView = new LatchView(this); // first person with a Biter on your back
    this.stalker = new StalkerDirector(this); // when and where the Stalker haunts the player (actors/stalker.js)
    this.weather.onDripSplash = (p) => this.fx.dripSplash(p);

    await step(0.88, 'Cleaning weapons');
    this.player = new Player(this, this.camera);
    this.viewmodel = new Viewmodel(scene);
    this.viewmodel.prewarm(['m4a1', 'm4super90', 'm9', 'knife', 'm67', 'barricade']);
    this.weapons = new WeaponSystem(this, this.player, this.viewmodel);
    this.projectiles = new Projectiles(this, scene);
    this.pickups = new Pickups(this, scene);
    this.bots = []; // one per fireteam.js character (fixed body + signature gun); start() spawns the picked ones
    for (let i = 0; i < FIRETEAM.length; i++) {
      const b = new Teammate(this, i);
      b.hide();
      scene.add(b.root);
      this.bots.push(b);
    }
    // your own character (fireteam.js PLAYER_CHARACTER): the body the cutscenes show for you, never a bot
    this.playerBody = new Teammate(this, FIRETEAM.length, PLAYER_CHARACTER);
    this.playerBody.spawn(new THREE.Vector3(0, -50, 0), 0); // (fills in its animation state: the scenes only pose it)
    this.playerBody.hide();
    this.mercs = new MercSquad(this); // the NOX cleanup squad (actors/merc.js; the event: game/events.js)
    this.progress = Progress; // the career: xp, rank, weapon mastery, skins (game/progress.js)
    this.rogue = new Rogue(this); // the Gauntlet's cards, perks and curses (game/rogue.js)
    scene.add(this.playerBody.root);

    this.cinema = new Cinema(this); // cutscenes (game/cutscenes.js)
    this.mission = new Mission(this); // the story: intro, Nadja, the hacking mission, the finale
    this.events = new RandomEvents(this); // rare: airstrike, blood moon, a helicopter crash, a blackout

    await step(0.92, 'Spilling blood');
    this._decorate();
    this.hud?.setMapOutline(this.level.radarSegments);

    await step(0.96, 'Compiling shaders');
    // place camera for the menu shot and compile
    this._menuCam(0);
    // make pooled/hidden things visible for one compile so their programs exist up front
    const hidden = [];
    const reveal = (o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    };
    for (const list of Object.values(this.zombies.pool)) for (const z of list) reveal(z.root);
    for (const b of this.bots) reveal(b.root);
    reveal(this.playerBody.root);
    for (const m of Object.values(this.viewmodel.models)) reveal(m.root);
    try {
      this.gr.renderer.compile(scene, this.camera);
      this.gr.renderer.compile(scene, this.gr.vmCamera);
      // one real frame renders the shadow depth variants too
      this.gr.render(0.016);
    } catch (e) {
      console.warn('precompile failed', e);
    }
    for (const o of hidden) o.visible = false;
    await step(1, 'Ready');
  }

  /** where the rare events (game/events.js: crash, shells) and the NOX drop centre on: the farmhouse, or on a
   * big map (level.eventCenter: 'team') the living fireteam's middle */
  eventCenter() {
    if (this.level?.eventCenter !== 'team') return { x: 0, z: 0 };
    let x = 0, z = 0, n = 0;
    for (const m of this.team ?? []) {
      if (!m.alive) continue;
      x += m.pos.x;
      z += m.pos.z;
      n++;
    }
    return n ? { x: x / n, z: z / n } : { x: this.level.playerSpawn.x, z: this.level.playerSpawn.z };
  }

  /** the story's helicopter (world/helicopter.js), built on first use */
  chopper() {
    return (this._chopper ??= new Chopper(this.scene, this.audio));
  }

  chopperIfBuilt() {
    return this._chopper ?? null;
  }

  /** game/cinema.js: a cutscene ended */
  onCinemaEnd(id, skipped) {
    if (!this.running) return;
    this.mission?.onCinemaEnd(id, skipped);
  }

  navFieldFor(post) {
    const key = post.pos.x + ',' + post.pos.z + ',' + this.level.portals.map((p) => (p.enabled ? 1 : 0)).join('');
    let f = this.postFields.get(key);
    if (!f) {
      f = this.nav.makeField([{ level: post.level ?? 1, x: post.pos.x, z: post.pos.z }]);
      this.postFields.set(key, f);
    }
    return f;
  }

  _decorate() {
    // Pre-existing carnage: blood splats on floors, smears on walls, bullet holes.
    const decals = this.fx.decals;
    const rooms = this.level.decor?.rooms ?? [
      [-11.5, -1.3, -0.8, 7.5, 0],
      [-11.5, -1.3, -7.5, -1.3, 0],
      [-0.8, 2.2, -7.5, 7.5, 0],
      [2.7, 11.5, 1.3, 7.5, 0],
      [2.7, 11.5, -7.5, 0.7, 0],
      [-11.5, 2.1, -5.8, 3.7, -3.2],
      [-11.5, 11.5, -7.5, 7.5, 3.45],
    ];
    const up = new THREE.Vector3(0, 1, 0);
    // (fx.splat / fx.decalRay: only on solid level geometry, and only where the whole splat fits: splats over a
    // floor's edge or on the rough boxes round props and in open windows used to hang in the air)
    for (const [x0, x1, z0, z1, y] of rooms) {
      const n = y === 3.45 ? 28 : Math.round((x1 - x0) * (z1 - z0) * 0.55);
      for (let i = 0; i < n; i++) {
        const x = rand(x0, x1), z = rand(z0, z1);
        const down = this.fx.decalRay(x, y + 0.3, z, 0, -1, 0, 0.4);
        if (!down || Math.abs(down.t - 0.3) > 0.05) continue; // (the room's own floor, not a step or a table)
        this.fx.splat(_p.set(x, y + 0.3 - down.t, z), up, rand(0.3, 0.75), 1, down.box);
      }
    }
    // wall smears & bullet holes via random horizontal rays from room centers
    for (const [x0, x1, z0, z1, y] of rooms) {
      for (let i = 0; i < 26; i++) {
        const o = _p.set(rand(x0, x1), y + rand(0.25, 1.9), rand(z0, z1));
        const a = Math.random() * Math.PI * 2;
        const hit = this.fx.decalRay(o.x, o.y, o.z, Math.cos(a), 0, Math.sin(a), 8);
        if (!hit || hit.box.tag?.startsWith('lab') || hit.box.tag === 'generator' || hit.box.tag === 'clean') continue; // ('clean': walls kept free of it, e.g. Appenweier's murals) // the lab's door, window frame and glass stay clean; the generator's bounding box would float smears in mid-air
        const pt = new THREE.Vector3(o.x + Math.cos(a) * hit.t, o.y, o.z + Math.sin(a) * hit.t);
        _n.set(hit.nx, hit.ny, hit.nz);
        if (Math.random() < 0.45) this.fx.splat(pt, _n, rand(0.4, 1.0), rand(1, 2.2), hit.box);
        else if (this.fx.fitDecal(pt, _n, 0.7) > 0) for (let k = 0; k < 4; k++) decals.bulletHole(pt.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)).projectOnPlane(_n)), _n, 0.09, hit.box);
      }
    }
    for (const [x0, x1, z0, z1, y, n] of this.level.decor?.pools ?? [[-11, 11, -7, 7, 0.2, 8]]) for (let i = 0; i < n; i++) this.fx.bloodPoolAt(new THREE.Vector3(rand(x0, x1), y, rand(z0, z1)));
    decals.permanent = {};
    for (const k of ['blood', 'holes', 'pools', 'scorch']) {
      decals.permanent[k] = decals[k]?.count ?? 0;
      if (decals[k]) decals[k].reserved = Math.min(decals.permanent[k], decals[k].max - 60);
    }
  }

  /** the main-menu shot `name` of the loaded map (its camera and, for 'lobby', where the squad stands) */
  menuShotSpec(name) {
    return (this.level?.menuShots ?? MENU_SHOTS)[name];
  }

  /** Main-menu camera shot ('title' | 'porch' | 'interior' | 'lobby'); the menu dips to black on a cut. */
  setMenuShot(name) {
    if (!(this.level?.menuShots ?? MENU_SHOTS)[name] || name === this.menuShot) return;
    this.menuShot = name;
    this._shotT0 = this.time;
  }

  _menuCam(t) {
    // slow eased dolly A → B → A with a faint handheld sway
    const shots = this.level?.menuShots ?? MENU_SHOTS;
    const s = shots[this.menuShot] || shots.title;
    const k = (1 - Math.cos(((t - (this._shotT0 ?? 0)) / s.period) * Math.PI * 2)) / 2;
    const { a, b } = s;
    const L = (i) => a[i] + (b[i] - a[i]) * k;
    const cam = this.camera;
    cam.position.set(L(0) + Math.sin(t * 0.37) * 0.03, L(1) + Math.sin(t * 0.21) * 0.04, L(2) + Math.sin(t * 0.29) * 0.03);
    cam.lookAt(L(3) + Math.sin(t * 0.13) * 0.15, L(4) + Math.sin(t * 0.17) * 0.05, L(5));
    if (cam.fov !== s.fov) {
      cam.fov = s.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------------ session
  start(config) {
    this.running = false;
    this.cinema?.stop(true);
    this.story?.setFade(0);
    this.config = config;
    this.mode = MODES[config.mode] || MODES.cabinfever;
    this.diff = DIFF[this.mode.difficulty ?? config.difficulty] || DIFF.hard; // (the Gauntlet: always Extreme)
    this.endless = !!this.mode.endless; // no round cap, no timer, no victory
    this.difficultyDamage = this.diff.dmg;
    this.state = 'intermission';
    this.round = 0;
    this.maxRounds = this.endless ? Infinity : STORY.rounds;
    this.timed = !this.endless && this.mode.timer !== false; // the Gauntlet has no clock
    this.timeLeft = this.timed ? STORY.minutes * 60 : Infinity;
    this.rogue.reset(); // on in the Gauntlet only
    this.player.maxHp = this.rogue.maxHp;
    setPriceScale(this.diff.price);
    this.elapsed = 0;
    this.score = 0;
    this.combo = 0;
    this.comboT = 0;
    this.roundTime = 0;
    this.toSpawn = [];
    this.spawnT = 0;
    for (const z of [...(this.healZones ?? [])]) this._endHeal(z);
    this.healZones = []; // heal grenade clouds (healCloud)
    this._upperWarned = false; // (_climbedIn: the first one upstairs gets a banner)
    this.intermissionT = 6;
    this.running = true;
    this.paused = false;
    this.spectate = null;
    this.hitAccum = 0;
    this.hitAccumHead = false;
    this.maxAlive = Math.min(this.quality.maxZombies, 30);
    this.navT = 0;
    this.gameOverT = 0;
    this.pendingExplosions = [];
    this.lures = []; // pipe bombs pulling the horde (lureStart)
    this.pulseReady = true; // the shockwave emitter's charge (once a round)
    this.unlocked = Object.fromEntries((this.level.unlocks ?? []).map((u) => [u.id, false])); // (the farm: basement, upstairs)
    this.dawn = 0;
    this.lighting.moonBase = this.level.indoor ? 0 : 0.55;
    for (const p of this.level.portals) p.enabled = !!p.always; // `always`: open from round 1 (e.g. a ladder)
    this.level.resetDoors?.(this); // (a map whose unlocks open doors: shut again for a new run, world/hive.js)
    this.postFields.clear();
    this.horde?.reset();

    this.zombies.clear();
    this.stalker?.reset();
    this.mercs?.reset();
    this.projectiles.clear();
    this.pickups.clear();
    this.fires = [];
    this.fx.fireZones.length = 0;
    // restore the pre-seeded carnage, drop everything from the previous match
    const dc = this.fx.decals;
    for (const k of ['blood', 'holes', 'pools', 'scorch']) {
      const pool = dc[k];
      if (!pool) continue;
      const n = dc.permanent?.[k] ?? 0;
      pool.count = n;
      pool.index = n;
      pool.mesh.count = n;
    }

    this.player.spawn(this.level.playerSpawn, this.level.playerYaw ?? Math.PI);
    this.player.stats = { kills: 0, deaths: 0, headshots: 0, score: 0, shots: 0, hits: 0 };
    if (Progress.inRun()) Progress.runEnd(); // (a run restarted before its end)
    Progress.runStart({ mode: this.mode.id, difficulty: Object.keys(DIFF).find((k) => DIFF[k] === this.diff) ?? 'hard' });
    this.weapons.reset(config.primary || 'm4a1');
    this.team = [this.player];
    // exactly the picked characters; old saves / debug configs may still give a count. The one whose body you
    // wear yourself (game/progress.js character skins: Scorpion, Viper) sits this run out.
    const me = Progress.character();
    const picked = (normalizeFireteam(config.fireteam) ?? LEGACY_LINEUPS[clamp(Math.round(config.teammates ?? 3), 0, 3)]).filter((id) => id !== me.bot);
    if (this.playerBody.char !== this.playerBody.chars.get(me.body)) {
      this.playerBody._wear(me.body);
      this.playerBody.spawn(new THREE.Vector3(0, -50, 0), 0); // (its animation state, for the new body)
      this.playerBody.hide();
    }
    let k = 0;
    for (const b of this.bots) {
      if (picked.includes(b.id)) {
        b.spawn(this._botSpawn(k++), Math.PI);
        b.stats = { kills: 0, deaths: 0, headshots: 0, score: 0 };
        this.team.push(b);
      } else b.hide();
    }
    this.economy.reset(this.team, this.diff.cash);
    this.shopOpen = false;
    this.botBuys = [];
    this.gear.reset();
    this.fHold = null;
    this.maskActive = false;
    this.maskBreathT = 0;
    this.gunshop?.setOpen(false);
    this.breach?.reset(); // whole walls again (before the barricades: it drops its barricade spot)
    this.shaft?.reset();
    this.barnFire?.reset(); // an unburnt barn
    this.barricades?.reset();
    this.power?.start();
    this.revives?.reset();
    this.audio.startAmbience();
    this._updateNav(true);
    // the story (Cabin Fever mode): the intro cutscene first; endless: straight in
    this._chopper?.show(false);
    this.lighting.spotOverride = null;
    if (this.lab) this.lab.forceVisible = false;
    this.events.reset();
    this.mission.reset();
    if (this.endless) this.hud.banner(`ENDLESS · ${this.map.id === 'farm' ? 'CABIN FEVER' : this.map.name}`, 'No extraction is coming. Hold out as long as you can', 3.2, 'normal');
    if (this.rogue.on) this.intermissionT = 8; // the Gauntlet: the opening pick, then the countdown
    this.mission.begin();
  }

  /** k-th bot's start spot: the defense posts after the player's; past those, a clear spot next to one */
  _botSpawn(k) {
    const posts = this.level.defensePosts;
    const n = Math.max(1, posts.length - 1);
    const p = posts[1 + (k % n)]?.pos.clone() ?? this.level.playerSpawn.clone();
    if (k < n) return p;
    for (let i = 0; i < 8; i++) {
      const a = k * 2.4 + (i * Math.PI) / 4;
      const x = p.x + Math.cos(a) * 0.9, z = p.z + Math.sin(a) * 0.9;
      const g = this.world.groundHeight(x, z, 0.3, p.y + 0.3);
      if (Math.abs(g - p.y) < 0.1 && this.world.lineOfSight(p.x, p.y + 1, p.z, x, g + 1, z)) return new THREE.Vector3(x, g, z);
    }
    return p;
  }

  /** Stats of a run abandoned mid-way (null before round 1 or once it is over): the leaderboard keeps those too. */
  quitStats() {
    if (!this.running || !(this.round >= 1) || this.state === 'victory' || this.state === 'defeat') return null;
    return this.runStats('quit');
  }

  /** What the end screen and the local leaderboard record about the current run. */
  runStats(outcome) {
    const ps = this.player.stats;
    const shots = ps.shots ?? 0;
    return {
      outcome, // 'victory' | 'overrun' | 'timeout' | 'quit'
      victory: outcome === 'victory',
      mode: this.mode.id,
      map: this.map.id,
      endless: this.endless,
      difficulty: Object.keys(DIFF).find((k) => DIFF[k] === this.diff) ?? 'hard',
      score: this.score,
      kills: ps.kills,
      headshots: ps.headshots,
      shots,
      hits: ps.hits ?? 0,
      revives: ps.revives ?? 0, // teammates you got back up (game/revive.js)
      accuracy: shots > 0 ? Math.min(1, (ps.hits ?? 0) / shots) : null,
      rounds: outcome === 'victory' ? this.round : Math.max(0, this.round - 1),
      roundReached: this.round,
      maxRounds: this.endless ? null : this.maxRounds,
      timeSeconds: Math.round(this.elapsed),
      fireteam: this.team.filter((m) => !m.isPlayer).map((m) => m.id),
      rogue: this.rogue.on ? this.rogue.summary() : null, // the Gauntlet: the perks and curses of the run
      team: this.team.filter((m) => !m.isPlayer).map((m) => ({ id: m.id, name: m.name, kills: m.stats.kills, deaths: m.stats.deaths, revives: m.stats.revives ?? 0 })),
    };
  }

  quit() {
    if (Progress.inRun()) Progress.runEnd(); // what the run earned is kept
    this.running = false;
    this.cinema?.stop(true);
    this._chopper?.show(false);
    this.lighting.spotOverride = null;
    this.events?.reset();
    this.mission?.reset();
    this.story?.setObjective(null);
    this.story?.setFade(0);
    this.state = 'menu';
    this.zombies.clear();
    this.stalker?.reset();
    this.mercs?.reset();
    this.projectiles.clear();
    this.pickups.clear();
    for (const b of this.bots) b.hide();
    this.playerBody?.hide();
    this.weapons._stopLoops?.();
    this.power?.stop();
    this.revives?.onRoundEnd();
  }

  // ------------------------------------------------------------------ rounds
  _composition(r) {
    const d = this.diff;
    const teamBonus = (this.team.length - 1) * 2;
    // past round 20 (endless) the head count grows slower and the mix stays capped; hp keeps climbing
    const rc = r <= 20 ? r : 20 + (r - 20) * 0.5;
    let total = Math.round((8 + rc * 3.2 + teamBonus) * d.count * this.rogue.zCount); // (zCount: the Gauntlet's SWARM curse)
    const list = [];
    const crushers = r >= 11 ? Math.min(8, 1 + Math.floor((r - 11) / 2)) : 0;
    for (let i = 0; i < crushers; i++) list.push('crusher');
    const strikers = r >= 5 ? Math.round(total * Math.min(0.32, 0.12 + (r - 5) * 0.012)) : 0;
    for (let i = 0; i < strikers; i++) list.push('striker');
    const chargers = r >= 2 ? Math.max(1, Math.round(total * 0.11)) : 0;
    for (let i = 0; i < chargers; i++) list.push('charger');
    const dogs = r >= 3 ? Math.max(2, Math.round(total * 0.18)) : 0;
    // Biters from round 4, in packs of 3-5 (rarer and at most 4 to a pack on easy)
    const biters = r >= 4 ? Math.max(3, Math.round(total * Math.min(0.16, 0.08 + (r - 4) * 0.01) * (d.biters ?? 1))) : 0;
    // a Survivalist (it drops a stash) turns up in about every other round from round 2
    if (r >= 2 && Math.random() < (r < 8 ? 0.4 : 0.55)) list.push('survivor');
    // Workers (slower, hard hats) take a fifth of the plain infected from round 2
    const workers = r >= 2 ? Math.round((total - dogs - biters - list.length) * 0.2) : 0;
    for (let i = 0; i < workers; i++) list.push('worker');
    while (list.length < total - dogs - biters) list.push('mauler');
    // shuffle, but keep crushers in the second half of the wave
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    // dogs hunt in packs of 2-3: back-to-back entries (_spawnOne releases a pack together)
    for (let left = dogs; left > 0; ) {
      const n = left <= 3 ? left : 2 + (Math.random() < 0.5 ? 1 : 0);
      list.splice(Math.floor(Math.random() * (list.length + 1)), 0, ...Array(n).fill('dog'));
      left -= n;
    }
    const maxPack = d.pack ?? 5;
    for (let left = biters; left > 0; ) {
      let n = Math.min(left, 3 + Math.floor(Math.random() * (maxPack - 2)));
      if (left - n > 0 && left - n < 3) n = left - 3 >= 3 ? left - 3 : left; // no stragglers under 3
      let i = 0; // not inside a dog pack, not touching another Biter pack (_spawnOne releases a whole run)
      for (let k = 0; k < 12; k++) {
        i = Math.floor(Math.random() * (list.length + 1));
        const nb = (t) => t === 'biter' || t === 'crusher'; // crushers are sorted out below: they can't separate packs
        if (!nb(list[i - 1]) && !nb(list[i]) && !(list[i - 1] === 'dog' && list[i] === 'dog')) break;
      }
      list.splice(i, 0, ...Array(n).fill('biter'));
      left -= n;
    }
    list.sort((a, b) => (a === 'crusher' ? 1 : 0) - (b === 'crusher' ? 1 : 0));
    return list;
  }

  _startRound() {
    this.round++;
    this.state = 'combat';
    this.economy.beginRound();
    // the gun shop closes for the fight; anyone still in the cellar is sent upstairs
    this.shopOpen = false;
    this.gunshop?.setOpen(false);
    this.gunshop?.evacuate(this.player);
    for (const b of this.bots) if (b.alive) this.gunshop?.evacuate(b);
    this.roundTime = 0;
    this.toSpawn = this._composition(this.round);
    this.breach?.onRoundStart(this.toSpawn); // rarely: a Boomer blows a hole in the wall this round
    this.barnFire?.onRoundStart(); // rarely: lightning sets the barn on fire this round
    this.stalker?.onRoundStart(this.round); // every round from round 3 (4 on easy): the Stalker haunts it
    this.roundTotal = this.toSpawn.length;
    this.events?.onRoundStart(this.round); // very rarely: an airstrike, a blood moon, a crash, a blackout
    this.rogue.onRoundStart(this.round); // the Gauntlet: the curses for this round come due
    this.mission?.onRoundStart(this.round);
    this.spawnT = 1.5;
    this.hud.setCountdown(null);
    let sub = this.round === 2 ? 'Boomers and hard-hatted Workers join the horde' : this.round === 3 ? 'Mutant dogs are hunting in packs' : this.round === 4 ? 'Biters hunt in packs · mash V to shake one off your back' : this.round === 5 ? 'Strikers have joined the horde' : this.round === 11 ? 'Crushers incoming — watch for the acid' : this.round === this.maxRounds ? 'Final wave — beat them back' : 'The infected are coming';
    const milestone = this.endless && this.round > 20 && this.round % 5 === 0;
    if (milestone) sub = 'The horde grows stronger';
    this.hud.banner(`ROUND ${this.round}`, sub, 3, this.round === this.maxRounds || milestone ? 'danger' : 'normal');
    this.audio.play('round_start', { volume: 0.9 });
    this.power?.onRoundStart(this.round); // used gas cans come back upstairs
    this.revives?.onRoundStart(); // everyone can be revived once again
    this.pulseReady = true; // the shockwave emitter recharges
    // special weapons
    for (const s of SPECIAL_SPAWNS) {
      if (s.round === this.round && this.round <= this.maxRounds) {
        // the map's spot: a position (the farm: the basement / upstairs ones wait for their floor) or
        // { pos, where, requires: the unlock it waits for }
        const spot = this.level.specialSpots?.[s.spot];
        if (!spot) continue;
        const pos = spot.isVector3 ? spot : spot.pos;
        const requires = spot.isVector3 ? { l96a1: 'basement', goldenPunisher: 'upstairs' }[s.spot] : spot.requires;
        if (requires && !this.unlocked[requires]) continue;
        const where = (!spot.isVector3 && spot.where) || s.where;
        this.pickups.spawnWeapon(s.weapon, pos, { permanent: true, mark: true }); // (marked on the map)
        setTimeout(() => this.hud.banner(s.banner, `has appeared ${where}`, 3, 'success'), 3400);
      }
    }
  }

  _endRound() {
    // the story's last wave: over only once the hack is through too (until then the infected keep coming)
    if (this.round >= this.maxRounds && !this.mission.finalWaveCleared()) return;
    this._career(Progress.round(this.round));
    this.state = this.round >= this.maxRounds ? 'victory' : 'shop';
    this.breach?.onRoundEnd();
    this.stalker?.onRoundEnd(); // not part of the wave: an attack breaks off, the scares go on into the buy phase
    this.revives?.onRoundEnd(); // the fallen get up anyway (below)
    this.events?.onRoundEnd();
    this.rogue.onRoundEnd(this.round, this.state === 'victory'); // the Gauntlet: the next draft
    if (this.state === 'victory') {
      if (this.mission.story) {
        // the finale: the vault door opens (game/cutscenes.js), then the end screen
        this.state = 'outro';
        this.mission.playOutro();
        return;
      }
      this._finish(true);
      return;
    }
    // buy phase: the gun shop in the cellar opens; the next round waits until the player holds F
    this.shopOpen = false;
    this.shopNews = [];
    this.fHold = null;
    const rogue = this.rogue.on; // the Gauntlet: no shop, the cards instead
    this.gunshop?.setOpen(!rogue);
    if (!rogue) {
      setTimeout(() => {
        if (this.state === 'shop') this.hud.banner('BUY PHASE', this.gunshop ? `The gun shop ${this.map.shopWhere ?? 'in the cellar'} is open · hold F when ready` : 'Tap F for the gun shop · hold F when ready', 3, 'normal');
      }, 3200);
    }
    this.audio.play('round_end', { volume: 0.9 });
    this.hud.banner('ROUND CLEAR', rogue ? 'Fallen teammates return · draw your cards' : '+ Ammo restocked · HP restored · Fallen teammates return', 3, 'success');
    // heal & restock, respawn the dead
    for (const m of this.team) {
      if (m.isPlayer) {
        if (!m.alive) {
          m.spawn(this._safeSpawn(), m.yaw);
          this.weapons.switchTo(0, true);
        }
        m.hp = Math.max(m.hp, Math.round(m.maxHp * this.rogue.healTo)); // (the Gauntlet's OPEN WOUNDS: 70% only)
        m.ap = Math.max(m.ap, 100); // store kevlar above 100 stays until shot off
      } else if (!m.alive) {
        m.spawn(this._safeSpawn(), 0);
      } else {
        m.hp = 100;
        m.ap = 60;
      }
    }
    this.spectate = null;
    this.weapons.restock();
    const mask = this.gear.mask;
    if (mask.owned) mask.filter = maskCapacity(mask.level); // fresh filter every round
    this.economy.payAll(roundBonus(this.round), 'round');
    this.botBuys = this.economy.botsShop();
    // unlocks (level.unlocks): the farm opens the upstairs with round 4, the basement with round 10 (the story:
    // Command has found Nadja's lab); Appenweier the fire station, then the drugstore
    const next = this.round + 1;
    this.mission?.onRoundEnd(this.round);
    for (const u of this.level.unlocks ?? []) {
      if (next < u.round || this.unlocked[u.id]) continue;
      this.unlocked[u.id] = true;
      for (const name of u.open ?? []) this.level.unlock(name, this); // (a map's doors re-rasterize their nav cells)
      for (const p of this.level.portals) if (u.portals?.includes(p.id)) p.enabled = true;
      this.postFields.clear();
      this.horde?.reset();
      this.shopNews.push(u.news);
      if (u.power) this.power?.activate(); // (the farm's basement) from now on the generator burns fuel and can fail
      for (const [title, sub, kind, at, dur] of u.banners ?? []) setTimeout(() => this.hud.banner(title, sub, dur ?? 3, kind), at);
      if (u.sound) setTimeout(() => this.audio.play(u.sound, { volume: 1 }), 3300);
    }
  }

  /** Ready up (hold F in the buy phase): short countdown, then the next round. Bots are always ready. */
  ready() {
    if (this.state !== 'shop' || this.rogue.drafting || this.rogue.draftT > 0) return; // (the Gauntlet: cards first)
    this.shopOpen = false;
    this.fHold = null;
    this.state = 'intermission';
    this.intermissionT = 3;
    this.audio.play('round_start', { volume: 0.35, pitch: 1.4 });
  }

  /** In the cellar at the counter during the buy phase (anywhere, if there's no physical shop). */
  canShop() {
    if (this.state !== 'shop' || this.shopOpen || !this.player.alive || this.rogue.on) return false;
    return this.gunshop ? !!this.gunshop.canInteract(this.player) : true;
  }

  _openShop() {
    if (!this.onShopOpen || this.shopOpen) return;
    this.shopOpen = true;
    this.fHold = null;
    this.onShopOpen();
  }

  /** main.js: the player closed the store. Very rarely the Stalker's face is right there (actors/stalker.js). */
  onShopClosed() {
    this.stalker?.shopScare();
  }

  _toggleFlashlight() {
    this.lighting.flashlightOn = !this.lighting.flashlightOn;
    this.audio.play('flashlight', { volume: 0.5 });
  }

  // F is the flashlight. In the buy phase it is read on release: a tap opens the gun shop at the
  // counter (the flashlight anywhere else) and holding it READY_HOLD s readies up.
  _updateF(dt, input) {
    // at a downed teammate F is the revive (game/revive.js), at the broken generator the repair
    // (world/power.js): both held, never the flashlight
    if (this.revives?.fOwned(this.player) || this.power?.fOwned(this.player)) {
      this.fHold = null;
      return;
    }
    if (this.state !== 'shop' || this.shopOpen) {
      this.fHold = null;
      if (input.hit('KeyF')) this._toggleFlashlight();
      return;
    }
    if (input.hit('KeyF')) this.fHold = 0;
    if (this.fHold == null) return;
    if (input.down('KeyF')) {
      this.fHold += dt;
      if (this.fHold >= READY_HOLD) this.ready();
      return;
    }
    const tap = this.fHold < F_TAP;
    this.fHold = null;
    if (!tap) return; // let go early: cancelled
    if (this.canShop()) this._openShop();
    else this._toggleFlashlight();
  }

  _safeSpawn() {
    const alive = this.team.find((m) => m.alive);
    if (alive) return alive.pos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0.05, rand(-0.8, 0.8)));
    return this.level.playerSpawn.clone();
  }

  _finish(victory) {
    this.state = victory ? 'victory' : 'defeat';
    this.gameOverT = 0;
    this.audio.play(victory ? 'victory' : 'defeat', { volume: 1 });
    const rogue = this.rogue.on;
    const sub = victory ? (rogue ? 'Fifteen waves, and you are still standing' : this.mission.story ? 'The reagent reached Nadja' : `Fifteen waves, and ${this.map.id === 'appenweier' ? 'Appenweier' : 'the farm'} still stands`) : this.endless || rogue ? `Your fireteam fell in round ${this.round}` : 'Your fireteam was overrun';
    this.hud.banner(victory ? (rogue ? 'GAUNTLET CLEARED' : 'MISSION COMPLETE') : 'MISSION FAILED', sub, 4, victory ? 'success' : 'danger');
    if (victory) this._career(Progress.win());
    const career = Progress.runEnd(); // the after-action report: xp, rank, mastery, unlocks
    this.onGameOver?.({ ...this.runStats(victory ? 'victory' : !this.endless && this.timeLeft <= 0 ? 'timeout' : 'overrun'), career });
  }

  _spawnOne(type) {
    const r = this.round;
    const hpMult = this.diff.hp * (1 + 0.065 * (r - 1)) * this.rogue.zHp; // (zHp / zSpeed: the Gauntlet's curses)
    const spd = this.diff.speed * (1 + 0.01 * Math.min(r - 1, 30)) * (this.events?.speedMul ?? 1) * this.rogue.zSpeed;
    // once the basement is open, some come up the coal tunnel by the lab (world/shaft.js)
    const up = this.shaft?.spawnPoint(type);
    if (up) {
      const z = this.zombies.spawn(type, up, r, hpMult, spd);
      this.breach?.onSpawn(z);
      if (z) this.shaft.onSpawn(z);
      return;
    }
    const top = this._upperSpawn(type);
    if (top) {
      const z = this.zombies.spawn(type, top, r, hpMult, spd);
      if (z) this._climbedIn(z);
      return;
    }
    // choose a spawn point far from the player, in the fog
    // (level.spawnBand [near, far] m from the nearest survivor, closer or farther counts against it; only where
    // there is a way to you, and rather not where the player is looking)
    const pts = this.level.spawnPoints;
    const band = this.level.spawnBand;
    const cam = this.camera;
    cam.getWorldDirection(_look);
    const fl = Math.hypot(_look.x, _look.z) || 1, fx = _look.x / fl, fz = _look.z / fl;
    const cosHalf = Math.cos(Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect) + 0.2); // (half the view, wider)
    let best = null, bs = -Infinity;
    for (let i = 0; i < (band ? 14 : 5); i++) {
      const p = pick(pts);
      if (band && !(this.nav.distanceAt(1, p.x, p.z) < 1e6)) continue;
      let d = Infinity;
      for (const m of this.team) if (m.alive) d = Math.min(d, p.distanceTo(m.pos));
      let s = band ? (d < band[0] ? d - band[0] * 3 : d > band[1] ? band[1] - (d - band[1]) * 2 : band[1]) + Math.random() * 14 : Math.min(d, 40) + Math.random() * 6;
      if (band) {
        const dx = p.x - cam.position.x, dz = p.z - cam.position.z, dl = Math.hypot(dx, dz) || 1;
        if ((dx * fx + dz * fz) / dl > cosHalf && this.world.lineOfSight(cam.position.x, cam.position.y, cam.position.z, p.x, p.y + 1.4, p.z)) s -= 30;
      }
      if (s > bs) {
        bs = s;
        best = p;
      }
    }
    best = this.breach?.spawnPoint(pts) ?? best ?? pick(pts); // a breached wall: part of the horde comes from that side
    let pos = best.clone().add(new THREE.Vector3(rand(-2.5, 2.5), 0.05, rand(-2.5, 2.5)));
    // a big map: the scatter must not land behind a fence or in a wall (else the point itself)
    if (band && !(this.nav.distanceAt(1, pos.x, pos.z) < 1e6)) pos = best.clone().add(new THREE.Vector3(0, 0.05, 0));
    this.breach?.onSpawn(this.zombies.spawn(type, pos, r, hpMult, spd)); // (the round's wall-breaching Boomer)
    // the rest of a dog / Biter pack queued right behind comes in with its leader
    while ((type === 'dog' || type === 'biter') && this.toSpawn[0] === type && this.zombies.aliveCount < this.maxAlive) {
      this.toSpawn.shift();
      this.zombies.spawn(type, best.clone().add(new THREE.Vector3(rand(-2, 2), 0.05, rand(-2, 2))), r, hpMult, spd);
    }
  }

  /** _spawnOne: a spot upstairs for this one (UPPER), if nobody is up there and the stairs are open, else null */
  _upperSpawn(type) {
    const L = this.level;
    if (!L.upperSpawns?.length || !this.unlocked?.upstairs || !UPPER.types.has(type) || Math.random() > UPPER.share) return null;
    if (this.team.some((m) => m.alive && L.isUpstairs(m.pos))) return null;
    let n = 0;
    for (const z of this.zombies.list) if (z.active && z.alive && L.isUpstairs(z.pos)) n++;
    if (n >= UPPER.max) return null;
    const ok = L.upperSpawns.filter((p) => this.nav.distanceAt(2, p.x, p.z) < 1e6); // (a way down to you)
    return ok.length ? pick(ok).clone() : null;
  }

  /** one climbed in upstairs: a creak and a groan overhead, and it comes straight down (the first time, a warning) */
  _climbedIn(z) {
    z._alert(0);
    this.audio.play('wood_creak', { position: z.pos, volume: 0.9 });
    if (Math.random() < 0.7) this.audio.play('zombie_groan', { position: z.pos, volume: 1.2 });
    if (this._upperWarned) return;
    this._upperWarned = true;
    this.hud.banner('UPSTAIRS', 'Something climbed in up there · watch the stairs', 3, 'danger');
  }

  // ------------------------------------------------------------------ damage routing
  hitscan(origin, dir, def, shooter, opts = {}) {
    const maxT = 160;
    const wall = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxT, bulletFilter, _hit);
    let wallT = wall ? wall.t : maxT;
    // the shop clerk stops a bullet like a wall would, but flinches and ducks instead of taking damage
    const keeper = this.gunshop?.keeper;
    const kHit = keeper && origin.y < -0.5 ? keeper.raycast(origin, dir, wallT) : null;
    if (kHit) wallT = kHit.t;
    const wallBox = wall ? wall.box : null;
    const wn = wall ? _n.set(wall.nx, wall.ny, wall.nz).clone() : null;
    // the NOX squad (actors/merc.js): the nearest of them on the ray; infected behind them are out of reach
    const mh = this.mercs?.raycast(origin, dir, wallT) ?? null;
    const hits = this.zombies.raycastAll(origin, dir, mh ? mh.t : wallT);
    let pen = def.penetration ?? 0;
    let mul = shooter?.dmgMul ?? 1; // bots' store-bought damage upgrades
    const headMul = shooter?.isPlayer ? this.rogue.headMul : 1; // the Gauntlet's HEADHUNTER
    let endT = wallT;
    let stoppedByZombie = false;
    const isPlayer = shooter && shooter.isPlayer;
    for (const h of hits) {
      const [f0, f1, fmin] = def.falloff || [30, 80, 0.6];
      const fall = h.t <= f0 ? 1 : h.t >= f1 ? fmin : 1 - (1 - fmin) * ((h.t - f0) / (f1 - f0));
      // (the Crusher's skull is armoured; buckshot: a type's `buckshot` share, the Crusher's hide tears under it)
      const dmg = def.damage * fall * (h.zombie.type.partMult?.[h.part] ?? PART_MULT[h.part] ?? 1) * mul * (h.part === 'head' ? headMul : 1) * (def.pellets > 1 ? h.zombie.type.buckshot ?? 1 : 1);
      const pt = new THREE.Vector3().copy(origin).addScaledVector(dir, h.t);
      // a hard hat (the Worker): some headshots glance off it with a spark and a ping, and the round is spent
      if (h.part === 'head' && h.zombie.type.helmet && Math.random() < h.zombie.type.helmet) {
        this.fx.impact(pt, _n.copy(dir).negate(), SURF.metal, { noDecal: true, silent: opts.pellet > 1 });
        h.zombie.flinchVel.y += 3; // the head snaps back
        endT = h.t;
        stoppedByZombie = true;
        break;
      }
      const res = h.zombie.damage(dmg, h.part, dir, shooter, { weapon: def.id, headshot: h.part === 'head' });
      const bloodCol = h.zombie.typeName === 'crusher' ? [0.05, 0.12, 0.3] : null;
      this.fx.bloodHit(pt, dir, { amount: (def.pellets > 1 ? 0.45 : 1) * (res.guarded ? 0.35 : 1), headshot: h.part === 'head', color: bloodCol });
      // fresh up the coal tunnel (world/shaft.js): the round mostly slaps coal dust off it
      if (res.guarded) this.fx.impact(pt, _n.copy(dir).negate(), SURF.mud, { noDecal: true, silent: true });
      if (this._volleyOn && !res.killed) this._volleyOn.set(h.zombie, (this._volleyOn.get(h.zombie) ?? 0) + (res.dealt ?? dmg));
      if (h.part === 'head' && !opts.bot) this.audio.play('headshot', { position: pt, volume: 0.7 });
      else this.audio.play('impact_flesh', { position: pt, volume: 0.5 });
      if (isPlayer) {
        this.hitAccum += res.dealt ?? dmg;
        this.hitAccumHead = this.hitAccumHead || h.part === 'head';
        // res.immune: the Stalker outside an attack shrugs it off (no hit marker; it flees)
        if (!res.immune) this.hud.hitMarker(res.killed, h.part === 'head');
        if (!res.killed && !res.immune) this._hitTick(h.part === 'head');
      } else if (shooter && shooter.stats) {
        shooter.stats.score += Math.round((res.dealt ?? dmg) * 0.5);
      }
      if (pen <= 0) {
        endT = h.t;
        stoppedByZombie = true;
        break;
      }
      pen--;
      mul *= 0.65;
    }
    if (!stoppedByZombie && mh) {
      stoppedByZombie = true;
      endT = mh.t;
      this._hitMerc(mh, origin, dir, def, shooter, mul, opts);
    }
    const end = new THREE.Vector3().copy(origin).addScaledVector(dir, endT);
    if (!stoppedByZombie && kHit) {
      keeper.hit(kHit.part, dir);
      // no decals: they'd be static in the world while she moves (and she isn't wounded)
      this.fx.bloodHit(end, dir, { amount: 0.3, decals: false });
      this.audio.play('impact_flesh', { position: end, volume: 0.55 });
    } else if (!stoppedByZombie && wall) {
      this.fx.impact(end, wn, wallBox.surface, { silent: opts.pellet > 1 || opts.bot && Math.random() < 0.6, box: wallBox });
      if (wallBox.tag === 'labGlass') this.lab?.onGlassHit(end);
    }
    if (opts.tracerFrom) {
      const snipe = def.ammoKind === 'sniper';
      this.fx.tracer(opts.tracerFrom, end, { speed: snipe ? 600 : 360, length: snipe ? 8 : 3.5, width: snipe ? 0.03 : 0.016 });
    }
    return { endT, stoppedByZombie };
  }

  /**
   * A shot of several pellets (weapons.js, teammate.js) is fired as beginVolley(), a hitscan per pellet, endVolley():
   * the pellets' damage adds up per infected, and whatever took a real share of its health at once reels and is
   * shoved back along the shot. (One pellet alone is too little to stagger anything, see Zombie.damage.)
   */
  beginVolley() {
    (this._volley ??= new Map()).clear();
    this._volleyOn = this._volley;
  }

  endVolley(dir) {
    const v = this._volleyOn;
    this._volleyOn = null;
    if (!v) return;
    const len = Math.hypot(dir.x, dir.z) || 1;
    for (const [z, dealt] of v) {
      if (!z.alive || z.typeName === 'crusher' || z.type.haunt) continue; // (the boss doesn't budge, the Stalker has its own)
      const k = dealt / z.maxHp; // share of its health this one blast took
      if (k < 0.15) continue;
      z.stagger = Math.max(z.stagger, 0.3 + 0.45 * Math.min(1, k));
      const push = Math.min(5, 2 + 9 * k) / (z.type.mass ?? 1);
      z.knock((dir.x / len) * push, (dir.z / len) * push, 0.35);
    }
    v.clear();
  }

  /**
   * A heal grenade popped (game/projectiles.js): a cloud of green medical mist on the floor under it. `L` = its
   * level's { radius, hps, aps, dur, revive } (weaponDefs.js healnade.levels): the fireteam in it heals, and the
   * top level gets the downed in it back up (game/revive.js reviveIn).
   */
  healCloud(pos, L, by) {
    const p = pos.clone();
    const down = this.world.raycast(p.x, p.y + 0.3, p.z, 0, -1, 0, 3, bulletFilter, _hit);
    if (down) p.y += 0.3 - down.t;
    this.healZones ??= [];
    // its reach on the floor: a glowing ring and a faint disc (pulsing, fading out with the cloud)
    const ring = new THREE.Group();
    const mat = (o) => new THREE.MeshBasicMaterial({ color: 0x49ff8c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const edge = new THREE.Mesh(new THREE.RingGeometry(L.radius * 0.95, L.radius, 64), mat(0.5));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(L.radius * 0.95, 64), mat(0.07));
    for (const m of [edge, disc]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 8;
      ring.add(m);
    }
    ring.position.copy(p).setY(p.y + 0.03);
    this.scene.add(ring);
    this.healZones.push({ pos: p, L, by, t: 0, emitT: 0, tickT: 0, ring, edge, disc, hiss: this.audio.play('heal_hiss', { position: p, volume: 0.85, loop: true }) });
    this.audio.play('heal_pop', { position: p, volume: 1 });
    this.lighting.flashAt(_wp.copy(p).setY(p.y + 0.6), 0x5cff8a, 70, 0.7, L.radius * 2);
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, s = rand(1.5, 4.5);
      this.fx.smoke.emit(p.x, p.y + 0.15, p.z, Math.cos(a) * s, rand(0.1, 0.6), Math.sin(a) * s, { life: rand(0.8, 1.4), size: rand(0.5, 0.9), grow: 1.5, drag: 3, gravity: 0, color: [0.55, 1.0, 0.7], alpha: 0.32 });
    }
  }

  _updateHeal(dt) {
    const zones = this.healZones;
    if (!zones?.length) return;
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i], L = z.L;
      z.t += dt;
      const fade = 1 - Math.max(0, (z.t - (L.dur - 1.5)) / 1.5); // the last 1.5 s it thins out
      z.hiss?.setVolume?.(0.85 * fade);
      const pulse = 0.75 + 0.25 * Math.sin(z.t * 4);
      z.edge.material.opacity = 0.5 * pulse * fade * Math.min(1, z.t * 4);
      z.disc.material.opacity = 0.07 * fade;
      // the mist: green billows that hug the floor (standing in it, you still see over it), a few rising motes
      z.emitT -= dt;
      if (z.emitT <= 0) {
        z.emitT = 0.06;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * L.radius * 0.85;
          this.fx.smoke.emit(z.pos.x + Math.cos(a) * r, z.pos.y + rand(0.02, 0.3), z.pos.z + Math.sin(a) * r, rand(-0.25, 0.25), rand(0, 0.08), rand(-0.25, 0.25), {
            life: rand(1.6, 2.6), size: rand(0.8, 1.3), grow: 1.15, drag: 1.5, gravity: 0, color: [0.3, 1.0, 0.48], alpha: 0.22 * fade,
          });
        }
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2, r = Math.random() * L.radius * 0.7;
          this.fx.sparks.emit(z.pos.x + Math.cos(a) * r, z.pos.y + rand(0.1, 0.8), z.pos.z + Math.sin(a) * r, 0, rand(0.5, 1.2), 0, { life: rand(0.5, 1), length: 0.02, color: [0.8, 3.2, 1.4], width: 0.012, gravity: -0.4, drag: 1 });
        }
      }
      // heal four times a second: everyone of the fireteam standing in it (the upper floor of a house doesn't count)
      z.tickT -= dt;
      if (z.tickT <= 0 && fade > 0) {
        z.tickT = 0.25;
        for (const m of this.team) {
          if (!m.alive || Math.hypot(m.pos.x - z.pos.x, m.pos.z - z.pos.z) > L.radius || Math.abs(m.pos.y - z.pos.y) > 2) continue;
          const hp0 = m.hp;
          m.hp = Math.min(m.maxHp ?? 100, m.hp + L.hps * 0.25);
          if (L.aps && (m.ap ?? 0) < 100) m.ap = Math.min(100, (m.ap ?? 0) + L.aps * 0.25); // (plates beyond 100 stay theirs)
          if (m.isPlayer && m.hp > hp0) this.hud.healFx?.();
        }
        if (L.revive) this.revives?.reviveIn(z.pos, L.radius, z.by);
      }
      if (z.t >= L.dur) this._endHeal(z);
    }
  }

  _endHeal(z) {
    z.hiss?.stop?.();
    this.scene.remove(z.ring);
    for (const m of [z.edge, z.disc]) {
      m.geometry.dispose();
      m.material.dispose();
    }
    this.healZones.splice(this.healZones.indexOf(z), 1);
  }

  /** a round on one of the NOX squad (hitscan): the shield rings and stops it, flesh takes the damage */
  _hitMerc(mh, origin, dir, def, shooter, mul, opts) {
    const pt = new THREE.Vector3().copy(origin).addScaledVector(dir, mh.t);
    if (mh.part === 'shield') {
      this.fx.impact(pt, _n.copy(dir).negate(), SURF.metal, { noDecal: true, silent: opts.pellet > 1 });
      if (!opts.pellet) this.audio.play('impact_metal', { position: pt, volume: 0.7 });
      mh.merc.flinchV = (mh.merc.flinchV ?? 0) + 1.5;
      return;
    }
    const [f0, f1, fmin] = def.falloff || [30, 80, 0.6];
    const fall = mh.t <= f0 ? 1 : mh.t >= f1 ? fmin : 1 - (1 - fmin) * ((mh.t - f0) / (f1 - f0));
    const head = mh.part === 'head' && shooter?.isPlayer ? this.rogue.headMul : 1;
    const res = mh.merc.hurt(def.damage * fall * mul * head, mh.part, dir, shooter, { weapon: def.id });
    this.fx.bloodHit(pt, dir, { amount: def.pellets > 1 ? 0.45 : 1, headshot: mh.part === 'head' });
    if (mh.part === 'head' && !opts.bot) this.audio.play('headshot', { position: pt, volume: 0.7 });
    else this.audio.play('impact_flesh', { position: pt, volume: 0.5 });
    if (shooter?.isPlayer) {
      this.hitAccum += res.dealt ?? 0;
      this.hitAccumHead = this.hitAccumHead || mh.part === 'head';
      this.hud.hitMarker(res.killed, mh.part === 'head');
      if (!res.killed) this._hitTick(mh.part === 'head');
    } else if (shooter?.stats) shooter.stats.score += Math.round((res.dealt ?? 0) * 0.5);
  }

  /** One crisp hit tick per shot: pellets / penetrations / blast victims in the same frame don't stack. */
  _hitTick(head = false) {
    if (this.time - (this._tickAt ?? -1) < 0.03) return;
    this._tickAt = this.time;
    this.audio.play('hitmarker', { volume: 0.5, pitch: head ? 1.2 : 1 });
  }

  /**
   * `def`: the melee weapon (knife / machete / tomahawk / bat: its hit sound, `oneHit` infected types; `cleave`: a
   * light swing takes up to this many in its arc, nearest first, the others at 70 %; `knock` / `heavyKnock`:
   * [shove m/s, stagger s] for whatever survives the blow).
   */
  meleeAttack(player, damage, range, heavy, def = null) {
    const cam = player.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const eye = cam.position;
    const inArc = [];
    for (const z of this.zombies.list) {
      if (!z.alive || !z.hipsWorld) continue;
      const to = z.hipsWorld.clone().sub(eye);
      const d = to.length();
      if (d > range + z.type.radius + 0.3) continue;
      to.normalize();
      if (to.dot(fwd) < (def?.cleave && !heavy ? 0.4 : 0.55)) continue; // (a wide swing sweeps a wider arc)
      inArc.push({ z, d });
    }
    inArc.sort((a, b) => a.d - b.d);
    const best = inArc[0]?.z ?? null, bd = inArc[0]?.d ?? Infinity;
    // one of the NOX squad nearer than any infected: the blade is for it (a shield from the front turns it)
    const mt = this.mercs?.meleeTarget(eye, fwd, range);
    if (mt && mt.dist < bd) {
      const pt = mt.merc.pos.clone().add(new THREE.Vector3(0, 1.15, 0)).addScaledVector(fwd, -0.25);
      if (mt.blocked) {
        this.fx.impact(pt, fwd.clone().negate(), SURF.metal, { noDecal: true });
        this.audio.play('impact_metal', { position: pt, volume: 0.9 });
        this.shake.add(0.1);
        return;
      }
      const back = new THREE.Vector3(Math.sin(mt.merc.yaw), 0, Math.cos(mt.merc.yaw));
      const res = mt.merc.hurt(damage * (back.dot(fwd) > 0.5 ? 2 : 1), 'torso', fwd, player, { weapon: 'knife', tool: def?.id ?? 'knife' });
      this.hitAccum += res.dealt ?? 0;
      this.fx.bloodHit(pt, fwd, { amount: heavy ? 1.3 : 0.8 });
      this.audio.play(def?.hitSound ?? 'knife_hit', { position: pt, volume: 0.9 });
      this.hud.hitMarker(res.killed, false);
      this.shake.add(0.12);
      return;
    }
    if (best) {
      const n = heavy ? 1 : def?.cleave ?? 1;
      const knock = heavy ? def?.heavyKnock : def?.knock;
      for (let i = 0; i < Math.min(n, inArc.length); i++) {
        const z = inArc[i].z;
        const back = new THREE.Vector3(Math.sin(z.yaw), 0, Math.cos(z.yaw));
        const fromBehind = back.dot(fwd) > 0.5;
        let dmg = damage * (fromBehind ? 2 : 1) * (i ? 0.7 : 1);
        if (def?.oneHit?.includes(z.typeName)) dmg = Math.max(dmg, z.hp + 1); // the machete vs a Biter
        const res = z.damage(dmg, 'torso', fwd, player, { weapon: 'knife', tool: def?.id ?? 'knife' }); // (tool: whose mastery)
        this.hitAccum += res.dealt ?? dmg;
        const pt = z.hipsWorld.clone().addScaledVector(fwd, -0.2);
        this.fx.bloodHit(pt, fwd, { amount: heavy ? 1.3 : 0.8 });
        if (i < 2) this.audio.play(def?.hitSound ?? 'knife_hit', { position: pt, volume: 0.9 });
        if (!res.immune && i === 0) this.hud.hitMarker(res.killed, false);
        // a heavy blunt blow sends it reeling back (the bat); the boss and the Stalker don't budge
        if (knock && z.alive && z.typeName !== 'crusher' && !z.type.haunt) {
          const l = Math.hypot(fwd.x, fwd.z) || 1, push = knock[0] / (z.type.mass ?? 1);
          z.stagger = Math.max(z.stagger, knock[1]);
          z.knock((fwd.x / l) * push, (fwd.z / l) * push, 0.4);
        }
      }
      this.shake.add(knock ? 0.18 : 0.12);
      return;
    }
    if (this.barricades?.melee(eye, fwd, range, damage)) return; // hacking at a barricade
    const hit = this.world.raycast(eye.x, eye.y, eye.z, fwd.x, fwd.y, fwd.z, range, bulletFilter, _hit);
    if (hit) {
      const pt = eye.clone().addScaledVector(fwd, hit.t);
      this.fx.impact(pt, new THREE.Vector3(hit.nx, hit.ny, hit.nz), hit.box.surface, { noDecal: true });
    }
  }

  throwGrenade(player, def) {
    const cam = player.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const pos = cam.position.clone().addScaledVector(fwd, 0.45).add(new THREE.Vector3(0, -0.1, 0));
    const vel = fwd.multiplyScalar(def.throwSpeed).add(new THREE.Vector3(0, 2.2, 0)).add(player.body.vel.clone().multiplyScalar(0.6));
    if (def.id === 'molotov') this.projectiles.throwMolotov(pos, vel, player, def);
    else if (def.id === 'mine') this.projectiles.throwMine(pos, vel, player, def);
    else if (def.id === 'pipebomb') this.projectiles.throwPipeBomb(pos, vel, player, def);
    else if (def.id === 'healnade') this.projectiles.throwHeal(pos, vel, player, def, this.weapons.healLevel);
    else this.projectiles.throwFrag(pos, vel, player, def);
  }

  /**
   * A pipe bomb (game/projectiles.js) starts beeping: every infected within its def.lure metres, bar the
   * Crushers, the Biters and the Stalker, drops what it was doing and makes for it (zombie.js goal: the flow
   * field to it, never clawed); latecomers in range join it every half second. lureEnd lets them go.
   */
  lureStart(p) {
    const level = levelOf(p.pos.y + 0.3);
    const L = { pos: p.pos, level, alive: true, radius: 0.35, isGoal: true, isLure: true, spot: { broken: false }, field: null };
    L.field = this.nav.makeField([{ level, x: p.pos.x, z: p.pos.z }], { infected: true });
    const e = { L, r: p.def.lure, t: 0 };
    this.lures.push(e);
    p.lure = L;
    this._lurePull(e);
  }

  lureEnd(L) {
    if (!L) return;
    L.spot.broken = true; // (zombie.js drops the goal)
    L.alive = false;
    this.lures = this.lures.filter((e) => e.L !== L);
  }

  _lurePull(e) {
    for (const z of this.zombies.list) {
      if (!z.alive || !z.active || z.goal || !LURED.has(z.typeName)) continue;
      if (z.pos.distanceTo(e.L.pos) > e.r) continue;
      z.goal = e.L;
      z.route = null;
      z.tgtT = 0;
      if (!z.alerted) z._alert(rand(0, 0.4));
    }
  }

  /** the shockwave emitter (pocket gear, key X): once a round a blast of force around you (SHOCKWAVE) */
  shockwave() {
    const p = this.player;
    if (!p.alive || !this.gear.has('shockwave') || this.cinema?.active) return false;
    if (!this.pulseReady) {
      this.audio.play('dryfire', { volume: 0.5 });
      this.hud.popScore?.(0, 'SHOCKWAVE · NEXT ROUND');
      return false;
    }
    this.pulseReady = false;
    const S = SHOCKWAVE;
    const c = p.pos;
    const dir = new THREE.Vector3();
    for (const { zombie: z, d } of this.zombies.inRadius(c, S.radius)) {
      if (!z.alive || Math.abs(z.pos.y - c.y) > 2.2) continue;
      const k = 1 - d / S.radius;
      dir.set(z.pos.x - c.x, 0, z.pos.z - c.z);
      if (dir.lengthSq() < 1e-4) dir.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      dir.normalize();
      const mass = z.type.mass ?? 1;
      const push = (S.push * (0.45 + 0.55 * k)) / mass;
      z.body.vel.x += dir.x * push;
      z.body.vel.z += dir.z * push;
      z.body.vel.y = Math.max(z.body.vel.y, (S.lift * (0.3 + 0.7 * k)) / Math.sqrt(mass));
      z.body.onGround = false;
      z.stagger = Math.max(z.stagger ?? 0, (S.stun * (0.5 + 0.5 * k)) / Math.max(1, mass));
      if (z.attackT >= 0) z.attackT = -1; // an attack in progress is broken off
      z.damage(S.damage * (0.5 + 0.5 * k), 'torso', dir.clone().setY(0.3), p, { weapon: 'shockwave', explosion: true, blast: 0.5 * k });
    }
    // a Biter clinging to your back is torn off (actors/biter.js)
    for (const z of this.zombies.list) if (z.alive && z.latchHost === p) z._release?.('shaken', dir.set(Math.sin(p.yaw + Math.PI), 0.4, Math.cos(p.yaw + Math.PI)));
    // the NOX squad: thrown back, off their aim for a moment (actors/merc.js)
    for (const m of this.mercs?.list ?? []) {
      if (!m.alive || !m.inPlay || !m.root.visible) continue;
      const d = m.pos.distanceTo(c);
      if (d > S.radius) continue;
      const k = 1 - d / S.radius;
      dir.set(m.pos.x - c.x, 0, m.pos.z - c.z).normalize();
      m.body.vel.x += dir.x * S.push * 0.6 * (0.45 + 0.55 * k);
      m.body.vel.z += dir.z * S.push * 0.6 * (0.45 + 0.55 * k);
      m.flinchV = (m.flinchV ?? 0) + 6;
      m.acquire = Math.max(m.acquire ?? 0, S.stun);
    }
    // the look: a ring of force over the floor, a flash, sparks, the camera jolts
    this._ring(c);
    this.lighting.flashAt?.(c.clone().setY(c.y + 1), 0x7fd8ff, 140, 0.25, 12);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      this.fx.sparks?.emit(c.x + Math.cos(a) * 0.5, c.y + 0.3, c.z + Math.sin(a) * 0.5, Math.cos(a) * rand(6, 10), rand(0.5, 2), Math.sin(a) * rand(6, 10), { life: rand(0.2, 0.45), length: 0.05, color: [1.4, 3.6, 6], width: 0.012, gravity: 2, drag: 2.5 });
    }
    this.shake.add(0.4);
    this.audio.play('shockwave', { volume: 1 });
    this.alertNoise(c, 20);
    return true;
  }

  /** a ring of force spreading over the floor (the shockwave) */
  _ring(c) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    const m = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 64), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(c.x, c.y + 0.06, c.z);
    this.scene.add(m);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat.clone());
    dome.material.opacity = 0.35;
    dome.position.copy(m.position);
    this.scene.add(dome);
    (this._rings ??= []).push({ m, dome, t: 0 });
  }

  _updateRings(dt) {
    const R = SHOCKWAVE.radius;
    for (let i = (this._rings?.length ?? 0) - 1; i >= 0; i--) {
      const r = this._rings[i];
      r.t += dt;
      const k = Math.min(1, r.t / 0.45);
      const e = 1 - Math.pow(1 - k, 3);
      r.m.scale.setScalar(1 + e * (R / 0.5 - 1));
      r.m.material.opacity = 0.9 * (1 - k) * (1 - k);
      r.dome.scale.set(1 + e * (R / 0.5 - 1) * 0.8, 1 + e * 4, 1 + e * (R / 0.5 - 1) * 0.8);
      r.dome.material.opacity = 0.35 * (1 - k);
      if (k >= 1) {
        for (const o of [r.m, r.dome]) {
          this.scene.remove(o);
          o.geometry.dispose();
          o.material.dispose();
        }
        this._rings.splice(i, 1);
      }
    }
  }

  /** Molotov shatters: a burning pool on the floor below the impact that ignites the infected. */
  igniteMolotov(pos, owner, def) {
    const g = this.world.groundHeight(pos.x, pos.z, 0.05, pos.y + 0.4);
    const p = new THREE.Vector3(pos.x, g > -Infinity && pos.y - g < 3 ? g : pos.y, pos.z);
    this.audio.play('glass_break', { position: p, volume: 1 });
    this.audio.play('explosion', { position: p, volume: 0.3, pitch: 1.7 });
    this.fx.fireZone(p, def.radius, def.fireTime);
    this.fires.push({ p, radius: def.radius, t: def.fireTime, owner, def });
    this.alertNoise(p, 18);
  }

  // burn damage is applied in chunks so hit reactions and hurt sounds don't fire every frame
  _burn(z, dmg, owner) {
    z.burnAcc = (z.burnAcc ?? 0) + dmg;
    if (z.burnAcc < 12 && z.hp > z.burnAcc) return;
    const amount = z.burnAcc;
    z.burnAcc = 0;
    const res = z.damage(amount, 'torso', null, owner, { weapon: 'molotov', burn: true });
    if (owner?.isPlayer) this.hitAccum += res?.dealt ?? 0;
  }

  _updateFires(dt) {
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t -= dt;
      if (f.t <= 0) {
        this.fires.splice(i, 1);
        continue;
      }
      const k = Math.min(1, f.t / 2);
      for (const { zombie } of this.zombies.inRadius(f.p, f.radius)) {
        if (Math.abs(zombie.pos.y - f.p.y) > 1.2) continue;
        zombie.burnT = 3;
        zombie.burnOwner = f.owner;
        zombie.burnDps = f.def.damage / 3;
        this._burn(zombie, f.def.damage * k * dt, f.owner);
      }
      for (const m of this.team) {
        if (!m.alive || Math.abs(m.pos.y - f.p.y) > 1.2) continue;
        if (Math.hypot(m.pos.x - f.p.x, m.pos.z - f.p.z) < f.radius * 0.8) m.takeDamage(14 * k * dt, f.p, null);
      }
    }
    for (const z of this.zombies.list) {
      if (!(z.burnT > 0)) continue;
      if (!z.alive) {
        z.burnT = 0;
        continue;
      }
      z.burnT -= dt;
      this._burn(z, z.burnDps * dt, z.burnOwner);
      if (Math.random() < dt * 28) this.fx.flameAt(z.pos, 1.5 * (z.scale ?? 1));
    }
  }

  launchProjectile(def, pos, dir, owner) {
    this.projectiles.launch40(pos, dir, owner, def);
  }

  /** opts.burst: a Boomer bursting (flesh and bile, no fire and no flash; the blast itself is the same) */
  explode(pos, radius, damage, source, opts = {}) {
    if (source?.isPlayer && this.rogue.on) {
      radius *= this.rogue.blastRadius; // the Gauntlet's DEMOLITION
      damage *= this.rogue.blastMul;
    }
    if (opts.burst) this.fx.fleshBurst(pos, opts.scale ?? 1);
    else this.fx.explosion(pos, opts.scale ?? 1);
    this.barricades?.explosion(pos, radius, damage, source, opts);
    this.breach?.explosion(pos, radius, damage, source, opts);
    this.mercs?.explosion(pos, radius, damage, source, opts);
    // camera shake by distance
    const dp = this.player.pos.distanceTo(pos);
    this.shake.add(clamp(1.2 - dp / 22, 0, 1) * (opts.scale ?? 1));
    if (dp < 8 && !opts.burst) this.gr.grade.set('uFlash', 0.25 * (1 - dp / 8));
    if (opts.burst && dp < 4.5 && this.player.alive) this.hud.screenBlood?.(1 - dp / 6); // a Boomer bursting in your face
    this.alertNoise(pos, 30);
    const center = pos.clone().add(new THREE.Vector3(0, 0.6, 0));
    // zombies
    for (const { zombie, d } of this.zombies.inRadius(pos, radius)) {
      const cy = zombie.hipsWorld ? zombie.hipsWorld : zombie.pos;
      const los = this.world.lineOfSight(center.x, center.y, center.z, cy.x, cy.y, cy.z);
      const k = Math.max(0, 1 - d / radius);
      const dmg = damage * (0.25 + 0.75 * k) * (los ? 1 : 0.3) * (zombie.type.blast ?? 1.25); // (the Crusher shrugs most of it off)
      const dir = zombie.pos.clone().sub(pos).setY(0.3).normalize();
      const res = zombie.damage(dmg, 'torso', dir, source, { weapon: opts.weapon ?? 'explosion', explosion: true, blast: k });
      zombie.body.vel.addScaledVector(dir, 6 * k / (zombie.type.mass ?? 1));
      if (source && source.isPlayer) {
        this.hitAccum += res.dealt ?? 0;
        if (res.dealt > 0) this.hud.hitMarker(res.killed, false);
        if (res.dealt > 0 && !res.killed) this._hitTick();
      }
      else if (source && source.stats) source.stats.score += Math.round((res.dealt ?? 0) * 0.5);
    }
    // team damage (reduced friendly fire; none from a mine)
    for (const m of opts.friendly === 0 ? [] : this.team) {
      if (!m.alive) continue;
      const d = m.pos.distanceTo(pos);
      if (d > radius) continue;
      const los = this.world.lineOfSight(center.x, center.y, center.z, m.pos.x, m.pos.y + 1.0, m.pos.z);
      if (!los) continue;
      const k = 1 - d / radius;
      const ff = m.isPlayer ? (source && source.isPlayer ? 0.55 : opts.weapon === 'charger' ? 1 : 0.8) : 0.3;
      m.takeDamage(damage * 0.45 * k * ff, pos, source);
      if (m.knockback) {
        const dir = m.pos.clone().sub(pos).setY(0).normalize();
        m.knockback(dir.x * 5 * k, 3 * k, dir.z * 5 * k);
      }
    }
  }

  alertNoise(pos, radius) {
    for (const z of this.zombies.list) {
      if (!z.alive || z.alerted) continue;
      if (z.pos.distanceTo(pos) < radius) z._alert(rand(0.2, 1.2));
    }
  }

  // ------------------------------------------------------------------ events
  onZombieKilled(z, info) {
    const src = info.source;
    const headshot = !!info.headshot;
    // special deaths
    if (z.typeName === 'charger') {
      const immediate = info.dynamiteShot || info.selfDestruct || info.explosion;
      const pos = z.pos.clone();
      const boom = () => {
        z.ragdoll?.anchor(pos); // a thrown Boomer pops where its body is now
        // the GLB Boomer bursts like a sack of rotten flesh; the procedural fallback (dynamite) still explodes
        this.explode(pos, 4.8, 170, info.selfDestruct ? null : src, { scale: 1.1, weapon: 'charger', burst: !!z.glow });
        if (!z.glow) this.fx.gore(pos.clone().add(new THREE.Vector3(0, 1.0, 0)), 1);
        z.deactivate();
        z.removed = true;
      };
      if (immediate) this.pendingExplosions.push({ t: 0.02, fn: boom });
      else this.pendingExplosions.push({ t: 0.45, fn: boom });
    } else if (z.typeName === 'striker') {
      const pos = z.pos.clone();
      setTimeout(() => this.projectiles.strikerPods(pos), 150);
    } else if (z.typeName === 'stalker') {
      this.stalker?.onKilled(z); // a banner and an ammo box; it stays away for a round
    } else if (z.typeName === 'crusher') {
      const pos = z.pos.clone();
      this.fx.acidCloud(pos, 3.2, 8);
      this.fx.gore(pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 1.3, [0.08, 0.2, 0.45]);
      setTimeout(() => {
        z.deactivate();
        z.removed = true;
      }, 300);
    }
    if (z.typeName !== 'charger' && !z.ragdoll) this.fx.bloodPoolAt(z.pos); // ragdolls pool where they land
    this.audio.play(z.typeName === 'crusher' ? 'crusher_roar' : 'zombie_death', { position: z.pos, volume: 0.8, pitch: z.typeName === 'crusher' ? 0.7 : 1 });
    if (!info.selfDestruct && !z.ragdoll) setTimeout(() => this.audio.play('bodyfall', { position: z.pos, volume: 0.7 }), 650);

    // drops
    const r = Math.random() / this.rogue.dropMul; // (the Gauntlet: SCAVENGER, SCARCITY, a DRY SPELL)
    if (z.type.loot) this._dropLoot(z);
    else if (!info.selfDestruct) {
      if (r < 0.045) this.pickups.spawnSupply('green', z.pos);
      else if (r < 0.075) this.pickups.spawnSupply('red', z.pos);
      else if (r < 0.14) this.pickups.spawnSupply('white', z.pos);
    }

    // scoring
    const mult = this.round >= 11 ? 1.5 : 1;
    const weapon = info.weapon || (info.explosion ? 'explosion' : info.selfDestruct ? 'suicide' : 'rifle');
    const victim = 'Infected ' + z.type.name;
    if (src && src.isPlayer) {
      this.player.stats.kills++;
      if (headshot) this.player.stats.headshots++;
      // a kill at arm's length (the knife, a shotgun blast): it spatters the lens
      const near = z.pos.distanceTo(this.player.pos);
      if (near < 2.2 && z.typeName !== 'charger') this.hud.screenBlood?.(headshot ? 0.7 : 0.45);
      this.comboT <= 0 ? (this.combo = 1) : this.combo++;
      this.comboT = 3;
      const pts = Math.round((z.type.score * (headshot ? 1.5 : 1) + (this.combo > 1 ? 40 * this.combo : 0)) * mult);
      this.score += pts;
      this.player.stats.score = this.score;
      const label = headshot ? 'HEADSHOT' : this.combo > 1 ? `COMBO x${this.combo}` : '';
      this.hud.popScore(pts, label);
      this.audio.play('killconfirm', { volume: 0.6, pitch: headshot ? 1.06 : 1 });
      this._tickAt = this.time; // the confirm replaces this frame's hit tick
      this.hud.addKill({ killer: 'You', victim, weapon: WEAPONS[weapon]?.name ?? weapon.toUpperCase(), headshot });
      this._career(Progress.kill({ type: z.typeName, weapon: masteryWeapon(info.tool ?? weapon), headshot }));
      this._rogueKill(!!info.tool);
    } else if (src && src.stats) {
      src.stats.kills++;
      if (headshot) src.stats.headshots++;
      src.stats.score += Math.round(z.type.score * mult);
      this.hud.addKill({ killer: src.name, victim, weapon: src.weaponName ?? 'M4A1', headshot });
    } else if (info.selfDestruct) {
      this.hud.addKill({ killer: victim, victim: 'Self', weapon: 'EXPLOSION', headshot: false });
    }
    // money: any fireteam kill pays every wallet the same amount
    if (src && (src.isPlayer || src.stats)) this.economy.payAll(killReward(z.typeName, headshot) * (this.events?.payMul ?? 1), 'kill');
  }

  /** actors/merc.js: the player took one of the NOX squad down */
  onMercKilledByPlayer(m, headshot, opts = {}) {
    this._career(Progress.kill({ type: 'merc', weapon: masteryWeapon(opts.tool ?? opts.weapon), headshot }));
    this._rogueKill(!!opts.tool);
  }

  /** the Gauntlet's BLOODTHIRST (and EXECUTIONER for a melee kill): a kill by the player heals */
  _rogueKill(melee) {
    const R = this.rogue;
    if (!R.on || !this.player.alive) return;
    const h = R.killHeal + (melee && R.stacks('executioner') ? 12 : 0);
    if (h > 0) this.player.heal(h);
  }

  /** game/progress.js reports what just went up (a kill, a round, the win): a promotion, a weapon's mastery level */
  _career(up) {
    if (!up) return;
    if (up.mastery) {
      const { weapon, level } = up.mastery;
      const camo = Progress.WEAPON_SKINS.find((k) => k.level === level && k.level > 0);
      this.hud.masteryUp?.(WEAPONS[weapon]?.name ?? weapon.toUpperCase(), level, camo ? camo.name + ' CAMO' : null);
      if (!up.rank) this.audio.play('mastery_up', { volume: 0.75 });
    }
    if (up.rank) {
      const index = Progress.RANKS.indexOf(up.rank);
      const ch = Progress.characterForRank(index);
      this.hud.promotion?.(up.rank, index, ch ? ch.name + ' CHARACTER' : null);
      this.audio.play('rank_up', { volume: 0.85 });
    }
  }

  /** The Survivalist's stash: sometimes a good primary you don't carry yet, else a survival pack. */
  _dropLoot(z) {
    const carried = this.weapons._carried();
    if (this.round >= LAUNCHER_LOOT.round && WEAPONS.softball && !carried.includes('softball') && Math.random() < LAUNCHER_LOOT.chance) {
      this.pickups.spawnWeapon('softball', z.pos, { mark: true, life: 150 });
      this.hud.banner('SURVIVALIST DOWN', `It dropped a ${WEAPONS.softball.name} grenade launcher · press E to take it`, 3, 'success');
      return;
    }
    const guns = LOOT_GUNS.filter((id) => WEAPONS[id] && !carried.includes(id));
    if (guns.length && Math.random() < 0.45) {
      const id = pick(guns);
      this.pickups.spawnWeapon(id, z.pos);
      this.hud.banner('SURVIVALIST DOWN', `It dropped a ${WEAPONS[id].name} · press E to take it`, 2.8, 'success');
    } else {
      this.pickups.spawnSupply('pack', z.pos);
      this.hud.banner('SURVIVALIST DOWN', 'It dropped a survival pack · HP, armor, ammo and throwables', 2.8, 'success');
    }
  }

  onPlayerDied(player, source) {
    this.mission?.onPlayerDied(player);
    const revivable = this.revives?.onDeath(player);
    this.weapons._stopLoops?.();
    const others = this.team.some((m) => m !== player && m.alive);
    this.hud.banner('YOU ARE DOWN', others ? (revivable ? 'A teammate can revive you for 15 s' : 'You will respawn at the end of the round') : '', 3, 'danger');
    this.hud.addKill({ killer: source?.type?.name ? 'Infected ' + source.type.name : 'Toxic Gas', victim: 'You', weapon: '', headshot: false });
  }

  onTeammateDied(bot, source) {
    this.revives?.onDeath(bot);
    this.hud.addKill({ killer: source?.type?.name ? 'Infected ' + source.type.name : '—', victim: bot.name, weapon: '', headshot: false });
    this.audio.play('player_hurt', { position: bot.pos, volume: 0.8, pitch: 0.8 });
  }

  // ------------------------------------------------------------------ update
  /** The infected's flow field toward every living team member (labels each cell with the nearest one). */
  _updateNav(sync = false) {
    const sources = [];
    let sig = '';
    for (const m of this.team) {
      if (!m.alive) continue;
      const level = levelOf(m.pos.y + 0.3);
      sources.push({ level, x: m.pos.x, z: m.pos.z, ref: m });
      sig += level;
    }
    if (!sources.length) sources.push({ level: 1, x: this.level.playerSpawn.x, z: this.level.playerSpawn.z, ref: null });
    this._navSig = sig;
    // a big map: built a slice a frame in the background (nav/navgrid.js beginCompute), the last one in use meanwhile
    if (this.level.bigMap) {
      this.nav.beginCompute(sources);
      if (sync) this.nav.stepCompute();
    } else this.nav.compute(sources);
  }

  /** re-flow early when someone changes floor, dies or respawns (else every 0.2 s) */
  _navStale() {
    let sig = '';
    for (const m of this.team) if (m.alive) sig += levelOf(m.pos.y + 0.3);
    return sig !== this._navSig;
  }

  update(dt) {
    this.time += dt;
    const input = this.input;
    const player = this.player;
    const settings = this.settings;

    if (this.running && this.cinema.active) {
      this._updateCinema(dt);
      return;
    }

    if (!this.running) {
      // menu attract camera
      this._menuCam(this.time);
      this.lighting.update(dt, this.camera.position, this.camera.quaternion, 1);
      this.weather.update(dt, this.camera.position, this.lighting.lightning, this.fog.color);
      this.fog.near = this.time;
      this.fog.far = this.menuShotSpec(this.menuShot)?.fog ?? 0.05;
      this.lighting.indoor = 1;
      this.audio.setIndoor?.(1);
      this.viewmodel.setVisible(false);
      this.fx.update(dt);
      this.lab?.update(dt, this); // hides the lab while the menu camera is above ground
      return;
    }

    const gameOver = this.state === 'victory' || this.state === 'defeat';
    // the clock stops while shopping
    if (!gameOver && this.state !== 'shop') {
      this.timeLeft -= dt;
      this.elapsed += dt;
    }
    if (this.timeLeft <= 0 && !gameOver) {
      this.timeLeft = 0;
      this._finish(false);
    }

    // round flow
    if (this.state === 'intermission') {
      if (!this.rogue.drafting && !(this.rogue.draftT > 0)) this.intermissionT -= dt; // (the Gauntlet's opening pick first)
      this.hud.setCountdown(Math.ceil(this.intermissionT));
      if (Math.ceil(this.intermissionT) !== Math.ceil(this.intermissionT + dt) && this.intermissionT < 5 && this.intermissionT > 0) this.audio.play('countdown_tick', { volume: 0.5 });
      if (this.intermissionT <= 0) this._startRound();
    } else if (this.state === 'shop') {
      this.hud.setCountdown(null);
    } else if (this.state === 'combat') {
      this.roundTime += dt;
      this.spawnT -= dt;
      if (this.toSpawn.length && this.spawnT <= 0 && this.zombies.aliveCount < this.maxAlive) {
        this._spawnOne(this.toSpawn.shift());
        this.spawnT = rand(0.45, 1.1) * (this.round < 3 ? 1.6 : 1);
      }
      if (!this.toSpawn.length && this.zombies.aliveCount === 0 && !this.pendingExplosions.length && !this.mercs?.active) this._endRound();
    }

    // player & weapons
    player.update(dt, input, settings, this.weapons);
    if (player.alive) {
      this.weapons.update(dt, input.locked ? input : null);
      this._updateF(dt, input);
      if (input.locked && input.hit('KeyX')) this.shockwave(); // the shockwave emitter (pocket gear)
    }
    // pipe bombs: the horde in range keeps coming (see lureStart)
    for (const e of this.lures) if ((e.t -= dt) <= 0) {
      e.t = 0.5;
      this._lurePull(e);
    }
    if (this._rings?.length) this._updateRings(dt);

    // gas (a store gas mask filters it until the filter runs dry)
    const mask = this.gear.mask;
    const inGas = player.alive && this.level.inGasZone(player.pos.x, player.pos.y, player.pos.z);
    const masked = inGas && mask.owned && mask.filter > 0;
    player.inGas = damp(player.inGas, inGas ? 1 : 0, 2.5, dt);
    if (masked) {
      mask.filter = Math.max(0, mask.filter - dt);
      player.gasT = 0;
      if ((this.maskBreathT -= dt) <= 0) {
        this.maskBreathT = 2.4;
        this.audio.play('breath_heavy', { volume: 0.45 });
      }
    } else if (inGas) {
      player.gasT += dt;
      if (player.gasT > 1.2) {
        player.takeDamage(6 * dt, null, null, { ignoreArmor: true });
        if (Math.random() < dt * 0.6) this.audio.play('gas_cough', { volume: 0.7 });
      }
    } else {
      player.gasT = Math.max(0, player.gasT - dt * 2);
      if (mask.owned) mask.filter = Math.min(maskCapacity(mask.level), mask.filter + dt * GAS_MASK.recharge);
    }
    this.maskActive = masked;
    this.maskFx = damp(this.maskFx ?? 0, masked ? 1 : 0, 6, dt);
    this.audio.setGasLevel(player.inGas);

    // teammates
    for (const b of this.bots) if (b.root.visible) b.update(dt);
    this.mercs?.update(dt); // the NOX squad: its drop and its fight
    this.rogue.update(dt); // the Gauntlet: drafts, the Stalker's MARKED curse

    // nav field
    this.navT -= dt;
    if (this.level.bigMap) {
      // (a new field once the last one is in: every 0.2 s at most, at once when someone changes floor)
      if (!this.nav.computing && (this.navT <= 0 || this._navStale())) {
        this.navT = 0.2;
        this._updateNav();
      }
      this.nav.stepCompute(NAV_SLICE);
    } else if (this.navT <= 0 || this._navStale()) {
      this.navT = 0.2;
      this._updateNav();
    }

    // zombies
    this.zombies.update(dt, { team: this.team, world: this.world, nav: this.nav, horde: this.horde, time: this.time, roundTime: this.roundTime });
    this.shaft?.update();
    this.stalker?.update(dt);
    for (let i = this.pendingExplosions.length - 1; i >= 0; i--) {
      const e = this.pendingExplosions[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.pendingExplosions.splice(i, 1);
        e.fn();
      }
    }
    this.projectiles.update(dt);
    this._updateHeal(dt);
    this.pickups.update(dt, player, input.locked ? input : null);
    this.level.update(dt);
    this.barnFire?.update(dt);
    this.barricades?.update(dt, player.alive && input.locked ? input : null);
    this.power?.update(dt, player.alive && input.locked ? input : null);
    this.revives?.update(dt, input.locked ? input : null);
    this.gunshop?.update(dt, this);
    this.lab?.update(dt, this);
    this.mission?.update(dt, player.alive && input.locked ? input : null);
    this.events?.update(dt);
    if (this.cinema.active) return; // the mission just started a cutscene

    // defeat check: entire team down
    if (!gameOver && this.state !== 'menu' && !this.team.some((m) => m.alive)) {
      this.gameOverT += dt;
      if (this.gameOverT > 1.5) this._finish(false);
    }

    // spectate a living teammate while dead
    if (!player.alive && player.deadT > 2.5) {
      const alive = this.bots.filter((b) => b.alive && this.team.includes(b));
      if (alive.length) {
        if (!this.spectate || !this.spectate.alive) this.spectate = alive[0];
        if (input.mouseHit(0)) this.spectate = alive[(alive.indexOf(this.spectate) + 1) % alive.length];
        const s = this.spectate;
        const back = new THREE.Vector3(-Math.sin(s.yaw) * 2.6, 1.9, -Math.cos(s.yaw) * 2.6);
        const target = s.pos.clone().add(back);
        // keep the camera out of walls
        const hit = this.world.raycast(s.pos.x, s.pos.y + 1.6, s.pos.z, back.x / 3.2, (back.y - 1.6) / 3.2, back.z / 3.2, 3.3, bulletFilter, _hit);
        if (hit) target.copy(s.pos).add(new THREE.Vector3(0, 1.6, 0)).addScaledVector(back.clone().setY(back.y - 1.6).normalize(), Math.max(0.3, hit.t - 0.3));
        this.camera.position.lerp(target, 1 - Math.exp(-6 * dt));
        this.camera.lookAt(s.pos.x + Math.sin(s.yaw) * 4, s.pos.y + 1.3, s.pos.z + Math.cos(s.yaw) * 4);
        this.camera.updateMatrixWorld(true);
      }
    }

    // FOV / ADS / scope
    const d = this.weapons.def;
    // settings.fov is horizontal; convert to three.js vertical fov
    const hf = ((settings.fov ?? 90) * Math.PI) / 180;
    const baseFov = (2 * Math.atan(Math.tan(hf / 2) / this.camera.aspect) * 180) / Math.PI;
    const zoom = 1 + ((d.adsZoom ?? 1) - 1) * this.weapons.ads;
    const scoped = d.scope && this.weapons.ads > 0.92 && player.alive;
    const fov = baseFov / zoom;
    this.camera.fov = damp(this.camera.fov, fov, 25, dt);
    this.camera.updateProjectionMatrix();
    this.fovScale = this.camera.fov / baseFov;
    this.hud.setScope(scoped ? (d.scope === true ? 'sniper' : d.scope) : false); // (d.scope 'acog': a 3x optic, player/optics.js)
    this.viewmodel.setVisible(player.alive && !scoped);
    if (player.alive) {
      this.viewmodel.update(dt, { camera: this.camera, vmCamera: this.gr.vmCamera, player, weapons: this.weapons, mouseDX: input.dx, mouseDY: input.dy });
    }
    this.latchView?.update(dt);

    // combo timer & score popups for hits
    this.comboT -= dt;
    if (this.hitAccum > 0) {
      const mult = this.round >= 11 ? 1.5 : 1;
      const pts = Math.max(1, Math.round(this.hitAccum * 0.5 * mult));
      this.score += pts;
      this.player.stats.score = this.score;
      this.hud.popScore(pts, '');
      this.hitAccum = 0;
      this.hitAccumHead = false;
    }

    this._updateWorld(dt);
    this._updateHud(dt);
  }

  /** A cutscene runs (game/cinema.js): the script moves the camera and its cast; the world goes on around it. */
  _updateCinema(dt) {
    this.cinema.update(dt, this.input);
    this.viewmodel.setVisible(false);
    this.hud.setScope(false);
    this.level.update(dt);
    this.lab?.update(dt, this);
    this.power?.update(dt, null);
    this._updateWorld(dt, true);
  }

  /** lighting, fog, weather, particles, indoor audio, the post stack, the listener (cine: in a cutscene) */
  _updateWorld(dt, cine = false) {
    const player = this.player;
    this.shake.update(dt);
    const playerLevel = levelOf(this.camera.position.y - 1.0);
    this.lighting.update(dt, this.camera.position, this.camera.quaternion, playerLevel);
    const fogCol = this.fog.color;
    // extraction at dawn after the final round
    this.dawn = this.state === 'victory' ? Math.min(1, (this.dawn ?? 0) + dt / 7) : 0;
    const dw = this.dawn;
    fogCol.setRGB(0.07 + this.lighting.lightning * 0.35, 0.095 + this.lighting.lightning * 0.38, 0.09 + this.lighting.lightning * 0.45);
    if (dw > 0 && !this.level.indoor) {
      fogCol.lerp(_dawnFog, dw);
      this.lighting.moonBase = 0.55 + dw * 2.2;
      this.lighting.moon.color.lerp(_dawnSun, dw);
    }
    this.events?.tintFog(fogCol);
    this.fog.near = this.time;
    this.fog.far = (0.05 + (cine ? 0 : player.inGas) * 0.12) * (1 - dw * 0.5) * (cine ? 0.6 : 1);
    this.weather.update(dt, this.camera.position, this.lighting.lightning, fogCol, dw);
    if (this.fires && !cine) this._updateFires(dt);
    this.fx.update(dt, cine ? null : (cloud, cdt) => {
      for (const m of this.team) {
        if (!m.alive) continue;
        if (m.pos.distanceTo(cloud.p) < cloud.radius) m.takeDamage(13 * cdt, null, null, { ignoreArmor: true });
      }
    });
    const sheltered = this.level.isSheltered(this.camera.position.x, this.camera.position.y, this.camera.position.z);
    this.indoor = damp(this.indoor ?? 1, sheltered, 3, dt);
    this.lighting.indoor = this.indoor;
    this.audio.setIndoor(this.indoor);
    this.audio.setRain?.(this.level.indoor ? 0 : this.weather.rainK); // the showers come and go (world/weather.js)
    this.audio.setLowHealth(player.alive ? clamp(1 - player.hp / 35, 0, 1) : 0);

    // post fx
    const g = this.gr.grade;
    g.set('uTime', this.time);
    g.set('uDamage', cine ? 0 : player.damageFlash * 0.85);
    g.set('uGas', cine ? 0 : player.inGas * (0.85 - 0.55 * (this.maskFx ?? 0))); // the mask keeps your eyes clear
    g.set('uLowHp', !cine && player.alive ? clamp(1 - player.hp / 30, 0, 1) : 0);
    g.set('uDead', cine || player.alive ? 0 : clamp(player.deadT / 1.5, 0, 0.85));
    const fl = this.gr.grade.uniforms.get('uFlash').value;
    g.set('uFlash', Math.max(this.lighting.lightning * (this.indoor > 0.5 ? 0.02 : 0.06), fl * Math.exp(-dt * 10)));

    // audio listener
    const fwd = this.camera.getWorldDirection(_p);
    this.audio.setListener(this.camera.position, fwd, this.camera.up);
  }

  /**
   * A world point `lift` m above `pos` on screen for a HUD marker: { x, y (px), edge, angle }; off screen
   * (or behind you: the bottom edge) it's pinned to the edge at `rim` (NDC) and `angle` points toward it.
   */
  _screenMark(pos, lift, rim) {
    _wp.copy(pos).setY(pos.y + lift).project(this.camera);
    let x = _wp.x, y = _wp.y;
    const behind = _wp.z > 1;
    if (behind) {
      x = -x;
      y = -y - 1; // behind you: pin it to the bottom edge
    }
    const m = Math.max(Math.abs(x), Math.abs(y));
    const edge = behind || m > rim;
    if (edge && m > 0) {
      x *= rim / m;
      y *= rim / m;
    }
    return { x: (x * 0.5 + 0.5) * window.innerWidth, y: (-y * 0.5 + 0.5) * window.innerHeight, edge, angle: Math.atan2(-y, x) };
  }

  _updateHud(dt) {
    const hud = this.hud;
    const player = this.player;
    const w = this.weapons;
    const info = w.hudInfo();
    const enemies = [];
    for (const z of this.zombies.list) if (z.alive && !z.type.haunt) enemies.push({ x: z.pos.x, z: z.pos.z, level: z.level }); // (the Stalker never shows up on the radar)
    const allies = [];
    for (const b of this.bots) if (b.alive && this.team.includes(b)) allies.push({ x: b.pos.x, z: b.pos.z });
    hud.update(
      {
        difficulty: this.diff.label,
        modeLabel: this.endless ? 'ENDLESS' : this.rogue.on ? 'GAUNTLET' : 'FIRETEAM',
        score: this.score,
        timeLeft: this.timed ? Math.max(0, this.timeLeft) : null,
        round: Math.max(this.round, 1),
        maxRounds: this.endless ? null : this.maxRounds,
        enemiesLeft: this.toSpawn.length + this.zombies.aliveCount + (this.mercs?.aliveCount ?? 0),
        hp: Math.ceil(player.hp),
        maxHp: player.maxHp ?? 100,
        ap: Math.ceil(player.ap),
        crouching: player.crouching,
        inGas: player.inGas * (1 - 0.7 * (this.maskFx ?? 0)),
        lowHealth: clamp(1 - player.hp / 30, 0, 1),
        weaponName: info.name,
        altPrimary: w.altPrimary?.() ?? null, // weapon backpack: the other primary (key 1)
        ammo: w.def.mode === 'grenade' ? w.throwCount(w.def.id) : info.ammo,
        magSize: info.magSize,
        reserve: info.reserve,
        noReload: info.noReload, // one load (chain gun, grenade launchers)
        dual: info.dual, // akimbo pistols: both mags
        grenades: w.grenades,
        mines: w.mines,
        pipebombs: w.pipebombs,
        gadget: this.gear.has('shockwave') ? { ready: this.pulseReady } : null, // the shockwave emitter (key X)
        molotovs: w.molotovs,
        barricades: w.barricades,
        gascans: w.gascans,
        generator: this.power?.hudInfo() ?? null,
        cash: this.rogue.on ? null : this.economy.cash(player),
        showAmmo: info.showAmmo && w.def.mode !== 'grenade',
        reloading: info.reloading,
        crosshair: w.crosshair(this.camera),
        radar: { x: player.pos.x, z: player.pos.z, yaw: player.yaw, enemies, allies, pickups: this.pickups.radarList().concat(this.power?.radarList() ?? [], this.revives?.radarList() ?? [], this.mission?.radarList() ?? []), threats: this.mercs?.radarList() ?? [], level: player.level },
      },
      dt
    );
    // nameplates
    const plates = [];
    const v = new THREE.Vector3();
    for (const b of this.bots) {
      if (!this.team.includes(b)) continue;
      v.set(b.pos.x, b.pos.y + 2.05, b.pos.z);
      const d = v.distanceTo(this.camera.position);
      v.project(this.camera);
      const visible = b.alive && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && d < 35;
      plates.push({ id: b.index, name: b.name, rank: b.rank, x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, visible, hp01: b.hp / 100 });
    }
    hud.setNameplates(plates);

    // buy phase: panel, hold-to-ready ring, shop prompt and a waypoint to the cellar stairs
    const buy = this.state === 'shop';
    hud.setBuyPhase?.(buy && !this.shopOpen ? { next: this.round + 1, gunshop: !!this.gunshop, where: this.map.shopWhere, rogue: this.rogue.on } : null);
    const readyHold = buy && this.fHold != null && this.fHold > 0.15;
    const pw = this.power, rv = this.revives, ms = this.mission;
    const hold = rv?.hold != null ? rv : pw?.hold != null ? pw : ms?.hold != null ? ms : this.barricades;
    hud.setHold?.(readyHold ? this.fHold / READY_HOLD : hold?.hold ?? null, readyHold ? null : hold?.holdLabel);
    const canShop = this.canShop();
    hud.setInteract?.(canShop && this.gunshop ? 'Press [F] to open the GUN SHOP' : rv?.prompt ?? pw?.prompt ?? ms?.prompt ?? this.barricades?.prompt ?? null);
    hud.setRevive?.(rv?.hudInfo() ?? null);
    let wp = null;
    // a downed teammate first, then the story's objective, then the gun shop in the buy phase, else the
    // generator / a gas can while the power is out
    let ent = null, wpLabel = null;
    const rw = rv?.waypoint(player), mw = ms?.waypoint(player);
    if (rw || mw) {
      ent = (rw ?? mw).pos;
      wpLabel = (rw ?? mw).label;
    } else if (buy && !this.shopOpen && !this.rogue.on && this.gunshop?.entrance && !canShop && this.gunshop.entrance.distanceTo(player.pos) > 2.5) {
      ent = this.gunshop.entrance;
      wpLabel = 'GUN SHOP';
    } else {
      const g = pw?.waypoint(player);
      ent = g?.pos ?? null;
      wpLabel = g?.label;
    }
    if (ent && player.alive && !this.shopOpen) {
      wp = this._screenMark(ent, 0.8, 0.9);
      wp.dist = Math.round(ent.distanceTo(player.pos));
      wp.label = wpLabel;
    }
    hud.setWaypoint?.(wp);
    // special weapons lying around (an event's cargo, the special spawns): marked with name + distance
    const marks = [];
    if (player.alive && !this.shopOpen) {
      for (const p of this.pickups.list) {
        if (!p.mark) continue;
        const d = p.obj.position.distanceTo(player.pos);
        if (d < 2.5) continue; // close enough for the pickup prompt
        const m = this._screenMark(p.obj.position, 0.55, 0.86);
        m.dist = Math.round(d);
        m.label = WEAPONS[p.id]?.name ?? 'WEAPON';
        marks.push(m);
      }
    }
    hud.setMarks?.(marks);

    // gas mask filter
    const mask = this.gear.mask;
    const cap = maskCapacity(mask.level);
    hud.setMask?.(mask.owned && (player.inGas > 0.05 || mask.filter < cap - 0.05) ? { frac: mask.filter / cap, secs: mask.filter, active: this.maskActive } : null);
    hud.setMaskFx?.(this.maskFx ?? 0);
    const tab = this.input.down('Tab');
    if (tab || this._tabShown) {
      this._tabShown = tab;
      const rows = [{ name: 'You', score: this.score, kills: player.stats.kills, deaths: player.stats.deaths, headshots: player.stats.headshots, isPlayer: true, rank: 3, insignia: Progress.rankOf().index }];
      for (const b of this.bots) if (this.team.includes(b)) rows.push({ name: b.name, score: b.stats.score, kills: b.stats.kills, deaths: b.stats.deaths, headshots: b.stats.headshots, isPlayer: false, rank: b.rank, insignia: BOT_GRADE[b.rank] ?? 3 });
      rows.sort((a, b) => b.score - a.score);
      hud.setScoreboard(tab, rows);
      hud.setBoardRun?.(tab && this.rogue.on ? this.rogue.summary() : null);
    }
  }
}

// Dim environment map for PBR reflections: dark sky, faint warm lamp blobs.
function makeEnvMap(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x0b0e12);
  const geo = new THREE.SphereGeometry(1, 16, 8);
  const addBlob = (color, x, y, z, sc) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color }));
    m.position.set(x, y, z);
    m.scale.setScalar(sc);
    s.add(m);
  };
  addBlob(new THREE.Color(3.5, 2.2, 1.2), 0, 6, 2, 1.6);
  addBlob(new THREE.Color(2.2, 1.4, 0.8), -6, 4, -3, 1.2);
  addBlob(new THREE.Color(0.35, 0.45, 0.6), 4, 8, -6, 3.5);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: 0x0d0b09 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3;
  s.add(floor);
  const rt = pm.fromScene(s, 0.04);
  pm.dispose();
  return rt.texture;
}
