// Cabin Fever — entry point: loading, menus, pointer lock, main loop.
import './ui/ui.css';
import { installFogShader } from './core/fogShader.js';
import { GameRenderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { AudioSystem } from './core/audio.js';
import { HUD } from './ui/hud.js';
import { Menu, CROSSHAIRS } from './ui/menu.js';
import { Store } from './ui/store.js';
import { Draft } from './ui/draft.js';
import { MenuMusic } from './ui/music.js';
import { generateAllTextures } from './world/textures.js';
import { Game } from './game/game.js';
import { renderPortraits } from './actors/portraits.js';
import { fullscreen } from './core/fullscreen.js';
import { currentMap, storeMapId, MAPS } from './world/maps.js';
import { WEAPONS } from './player/weaponDefs.js';

// the map this page plays (world/maps.js): picking another one in the menu reloads the page
const MAP = currentMap();
installFogShader(MAP.fogRects, MAP.labRect, MAP.fogBase);
const LS_PENDING = 'cabinfever.pendingDeploy'; // (sessionStorage) a deploy that switched maps: resumed after the reload

const container = document.getElementById('game');
const hud = new HUD(document.getElementById('hud'));
hud.setVisible(false);

let game = null;
let started = false;
let inMenu = true;
let gameOverShown = false;
const audio = new AudioSystem();
// main-menu theme (HTMLAudioElement, separate from the synthesized game mix)
const music = new MenuMusic(`${import.meta.env.BASE_URL}audio/abandoned-farmhouse.mp3`);

const menu = new Menu(document.getElementById('menu'), {
  map: MAP,
  onDeploy: async (config) => {
    // another map than the one loaded: remember the deploy, switch, reload (it resumes after loading)
    if (config.map && config.map !== MAP.id && MAPS[config.map]) {
      try {
        sessionStorage.setItem(LS_PENDING, JSON.stringify(config));
      } catch (_) {
        /* no session storage: the menu comes back with the new map */
      }
      storeMapId(config.map);
      const url = new URL(location.href);
      url.searchParams.delete('map');
      location.replace(url.href);
      return;
    }
    await audio.init();
    audio.setMasterVolume(settings.volume ?? 0.8);
    if (!game) return;
    inMenu = false;
    gameOverShown = false;
    closeStore();
    hud.setVisible(true);
    game.start(config);
    started = true;
    input.lock();
    wantFullscreen();
  },
  onResume: () => resumeGame(),
  onQuit: () => {
    closeStore();
    draft.close();
    // a run abandoned after round 1 still goes on the local leaderboard
    const run = game?.quitStats?.();
    game?.quit();
    if (run) menu.recordRun(run);
    if (game) game.paused = false; // the menu camera keeps rolling
    started = false;
    inMenu = true;
    hud.setVisible(false);
    input.unlock();
    // the main menu shows the farm: back from another map, load it again (the map is fixed for a page)
    if (MAP.id !== 'farm') {
      const url = new URL(location.href);
      url.searchParams.delete('map');
      location.replace(url.href);
    }
  },
  onPlayAgain: () => {
    if (!game || !game.config) return;
    gameOverShown = false;
    closeStore();
    draft.close();
    hud.setVisible(true);
    game.start(game.config);
    started = true;
    inMenu = false;
    input.lock();
    wantFullscreen();
  },
  onSettingsChange: (s) => {
    const fsChanged = s.fullscreen !== settings.fullscreen;
    Object.assign(settings, s);
    audio.setMasterVolume(settings.volume ?? 0.8);
    music.setVolume(settings.volume ?? 0.8, settings.music ?? 0.9);
    if (gr.qualityName !== settings.quality) gr.setQuality(settings.quality);
    hud.setFps(settings.showFps ? 0 : null);
    hud.root.style.setProperty('--xc', CROSSHAIRS[settings.crosshair] ?? '#fff'); // (the crosshair colour)
    // the switch is a click, so fullscreen can follow right away; refused, the switch goes back off
    if (fsChanged && settings.fullscreen) fullscreen.enter().catch(() => menu.setSetting('fullscreen', false));
    else if (fsChanged) fullscreen.exit();
  },
  onUiSound: (name) => audio.play(name, { volume: 0.5 }),
  // music loops on the main menu, fades out on deploy / pause / end screens
  // menu music is for the main menu only (the in-game soundtrack comes later): quick fade out
  onMainMenu: (on) => (on ? music.play(1.5) : music.stop(0.5)),
  onShot: (name) => game?.setMenuShot(name),
  // the PLAY screen's squad: the game's own bodies stand out in the map (ui/lobbyStage.js)
  getLobbyCast: () => (game?.playerBody ? { game, bots: game.bots, player: game.playerBody } : null),
});

// Gun shop overlay: opened with F at the cellar counter during the buy phase. The pointer is
// released without pausing; CLOSE (Esc / F / Enter) re-locks it. Ready-up is hold-F in the world.
const store = new Store(document.getElementById('menu'), {
  onClose: (key) => closeShop(key),
});
let shopClosedAt = -Infinity; // (performance.now) onLockChange: a lock lost right after the store closed is no pause

// The Gauntlet's card drafts (game/rogue.js -> game.onDraft): like the store, the pointer is free while the
// cards are on the table; the last pick puts you back in the game.
const draft = new Draft(document.getElementById('menu'), {
  thumb: (k) => store.thumbOf(k),
  onSfx: (name) => audio.play(name, { volume: 0.55 }),
  onDone: () => closeDraft(),
});
const overlayOpen = () => store.isOpen || draft.isOpen;

function openDraft(spec) {
  input.enabled = false;
  input.keys.clear();
  hud.setVisible(false);
  draft.open(spec);
  input.unlock();
}

function closeDraft() {
  if (!draft.isOpen) return;
  draft.close();
  hud.setVisible(true);
  setTimeout(() => {
    if (!overlayOpen()) input.enabled = true;
  }, 0);
  input.lock();
  wantFullscreen();
}

function openStore() {
  input.enabled = false; // no walking / firing while shopping
  input.keys.clear();
  hud.setVisible(false);
  store.open(game);
  input.unlock();
}

function closeStore() {
  if (game) game.shopOpen = false;
  if (!store.isOpen) return;
  store.close();
  // next tick, so the key that closed the store (Enter / F) doesn't reach the game
  setTimeout(() => {
    if (!store.isOpen) input.enabled = true;
  }, 0);
}

function closeShop(key) {
  if (!store.isOpen) return;
  closeStore();
  hud.setVisible(true);
  shopClosedAt = performance.now();
  if (key === 'Escape') lockOnEscUp();
  else input.lock();
  wantFullscreen();
  game?.onShopClosed(); // (very rarely the Stalker is waiting right there)
}

// Esc is no user gesture, and it's the browser's own "leave the pointer lock" key: a lock asked for while it's
// down can be refused or taken back at once (then the pause menu came up). So after Esc closed the store, the
// pointer is asked for on its release (allowed without a gesture where the store let go of it by script); if
// the browser still says no, the next click or key press takes it (grabPointer).
function lockOnEscUp() {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    removeEventListener('keyup', up, true);
    grabPointer();
  };
  const up = (e) => {
    if (e.code === 'Escape') go();
  };
  addEventListener('keyup', up, true);
  setTimeout(go, 500); // (a key-up that never comes: the page lost focus)
}

const settings = { ...menu.getSettings() };
music.setVolume(settings.volume ?? 0.8, settings.music ?? 0.9);
hud.root.style.setProperty('--xc', CROSSHAIRS[settings.crosshair] ?? '#fff');

// FULLSCREEN setting: a browser only goes fullscreen on a user gesture, so with the setting on it's
// (re-)entered on the next one: the first click after loading, deploy, resume, a click back into the
// game. Where Esc is locked to the page (core/fullscreen.js), a tap still pauses, and leaving
// fullscreen by other means (holding Esc, F11) switches the setting off.
function wantFullscreen() {
  if (settings.fullscreen && fullscreen.supported && !fullscreen.active) fullscreen.enter().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  if (fullscreen.active) {
    if (!settings.fullscreen) fullscreen.exit(); // a request still under way when the setting went off
    return;
  }
  const held = fullscreen.escLocked;
  fullscreen.escLocked = false;
  if (held && settings.fullscreen) menu.setSetting('fullscreen', false);
});
addEventListener('keydown', (e) => {
  if (e.code !== 'Escape' || e.repeat || e.defaultPrevented) return; // (the store or the pause menu had it)
  // Esc no longer releases the pointer by itself while it's locked to the page: pause like it would
  if (fullscreen.escLocked && input.locked && !overlayOpen()) input.unlock();
  // running without the pointer (it comes back with the next click / key): Esc pauses all the same
  else if (started && !inMenu && !input.locked && !game?.paused && !overlayOpen() && game.state !== 'victory' && game.state !== 'defeat') pauseGame();
});

// Browsers keep audio locked until a user gesture: unlock the synth (menu sounds, thunder) on
// the first click / key anywhere. The menu music retries its own play() on the same gesture.
function unlockAudio() {
  removeEventListener('pointerdown', unlockAudio, true);
  removeEventListener('keydown', unlockAudio, true);
  audio.init().then(() => audio.setMasterVolume(settings.volume ?? 0.8));
  wantFullscreen();
}
addEventListener('pointerdown', unlockAudio, true);
addEventListener('keydown', unlockAudio, true);
const gr = new GameRenderer(container, settings.quality || 'high');
const input = new Input(gr.renderer.domElement);
input.enabled = true;

let lockedAt = -Infinity; // (performance.now) when the pointer was last taken
input.onLockChange = (locked) => {
  if (!started || !game) return;
  const now = performance.now();
  if (locked) {
    lockedAt = now;
    menu.hideAll();
    game.paused = false;
  } else if (overlayOpen()) {
    // released for the store or a draft: not a pause
  } else if (now - shopClosedAt < 1500 && now - lockedAt < 400) {
    // taken back at once right after the store closed (the browser's own Esc handling): no pause, the next click
    // or key press takes it again (grabPointer)
  } else if (game.state !== 'victory' && game.state !== 'defeat' && !inMenu) {
    pauseGame();
  }
};

function pauseGame() {
  game.paused = true;
  menu.showPause();
}

// Back from the pause menu (RESUME, or Esc again): the game goes on at once, and the pointer comes back now where
// the browser allows it, else with the next click or key press (grabPointer). (Resuming used to wait for the lock:
// refused, as it is for a moment after the player pressed Esc, it left the game paused behind a hidden menu.)
function resumeGame() {
  if (game) game.paused = false;
  if (overlayOpen()) return; // paused from the store / a draft: back to it, the pointer stays free
  menu.hideAll();
  grabPointer();
}

// The game wants the pointer whenever it runs with no menu or overlay up. Browsers hand it over only on a click or
// a key press (never on Esc, and not right after the player pressed Esc to leave it), so a refused request is asked
// again on the next click or key press anywhere: no "click to continue" screen in between. (A click that takes the
// pointer doesn't fire: the weapons only listen while it's locked.)
function grabPointer() {
  if (!started || inMenu || !game || game.paused || input.locked || overlayOpen()) return;
  input.lock();
  wantFullscreen();
}
addEventListener('pointerdown', grabPointer, true);
addEventListener(
  'keydown',
  (e) => {
    if (e.code !== 'Escape' && !e.repeat) grabPointer();
  },
  true
);

async function boot() {
  menu.setLoading(0, 'Preparing');
  try {
    await generateAllTextures((f, label) => menu.setLoading(f * 0.5, 'Generating textures · ' + (label || '')));
  } catch (e) {
    console.error('texture generation failed', e);
  }
  game = new Game({ gr, audio, hud, input, settings, map: MAP });
  await game.load((f, label) => menu.setLoading(f, label));
  game.onShopOpen = openStore;
  game.onDraft = openDraft; // the Gauntlet's cards
  // fireteam picker portraits: every character rendered once, off screen
  menu.setLoading(1, 'Briefing the fireteam');
  await new Promise((r) => setTimeout(r, 0));
  try {
    menu.setPortraits(renderPortraits([...game.bots, game.playerBody])); // (+ your own operator, the career screen)
  } catch (e) {
    console.warn('portraits failed', e);
  }
  game.onGameOver = (stats) => {
    // on the local leaderboard right away (even if the player quits before the end screen shows)
    const placed = menu.recordRun(stats);
    setTimeout(() => {
      if (gameOverShown) return;
      gameOverShown = true;
      closeStore();
      draft.close();
      started = false;
      input.unlock();
      hud.setVisible(false);
      game.running = false;
      menu.showEnd({ ...stats, placed });
    }, 3500);
  };
  const resize = () => {
    for (const s of game.fx.systems) s.setViewportHeight(gr.renderer.domElement.height, gr.camera.fov);
  };
  resize();
  window.addEventListener('resize', resize);
  menu.hideLoading();
  // a deploy that switched maps (onDeploy above): straight on into the game with the same setup
  let pending = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(LS_PENDING) || 'null');
    sessionStorage.removeItem(LS_PENDING);
  } catch (_) {
    pending = null;
  }
  if (pending && pending.map === MAP.id) menu.deploy(pending);
  else menu.showMain();
  store.warmup(); // bakes the gun store's 3D item thumbnails in idle time
  // every other gun's first-person model, built and compiled while the main menu shows (player/viewmodel.js):
  // otherwise its first buy / equip / pick-up stalls the game for up to a second
  game.viewmodel.prewarmIdle([...new Set(Object.values(WEAPONS).map((d) => d.model || d.id))], {
    renderer: gr.renderer,
    camera: gr.vmCamera,
    scene: gr.scene,
    rt: gr.composer.inputBuffer,
    canRun: () => inMenu,
  });
  // debug handles (used for automated testing when rAF is throttled)
  window.__game = game;
  window.__store = store;
  window.__draft = draft;
  window.__music = music;  window.__step = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      game.update(dt);
      input.endFrame();
    }
    gr.render(dt);
  };
  // debug camera: __look(px, py, pz, tx, ty, tz, fov, frames) parks the menu camera there (hides the menu) and renders
  window.__look = (px, py, pz, tx, ty, tz, fov = 70, frames = 3) => {
    const shots = game.level?.menuShots;
    if (!shots) return;
    shots.dbg = { fov, period: 1e9, a: [px, py, pz, tx, ty, tz], b: [px, py, pz, tx, ty, tz], fog: 0.05 };
    game.menuShot = null;
    game.setMenuShot('dbg');
    for (const id of ['menu', 'hud']) document.getElementById(id)?.style.setProperty('display', 'none');
    window.__step(frames);
  };
  requestAnimationFrame(loop);
}

let last = performance.now();
let fpsAcc = 0, fpsN = 0;
function loop(now) {
  requestAnimationFrame(loop);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (!game) return;
  // safety net: whatever path left the main menu (deploy, autoplay retry on the deploy click, ...)
  if (music.want && !menu.onMainScreen) music.stop(0.5);
  fpsAcc += dt;
  fpsN++;
  if (fpsAcc > 0.5) {
    if (settings.showFps) hud.setFps(Math.round(fpsN / fpsAcc));
    fpsAcc = 0;
    fpsN = 0;
  }
  if (game.paused) {
    input.endFrame();
    gr.render(0);
    return;
  }
  game.update(dt);
  if (inMenu) menu.setFlash(game.lighting.lightning);
  for (const s of game.fx.systems) s.material.uniforms.uScale.value = gr.renderer.domElement.height / (2 * Math.tan((gr.camera.fov * Math.PI) / 360));
  gr.render(dt);
  input.endFrame();
}

boot();
