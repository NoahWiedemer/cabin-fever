// Cabin Fever — entry point: loading, menus, pointer lock, main loop.
import './ui/ui.css';
import { installFogShader } from './core/fogShader.js';
import { GameRenderer } from './core/renderer.js';
import { Input } from './core/input.js';
import { AudioSystem } from './core/audio.js';
import { HUD } from './ui/hud.js';
import { Menu } from './ui/menu.js';
import { Store } from './ui/store.js';
import { MenuMusic } from './ui/music.js';
import { generateAllTextures } from './world/textures.js';
import { Game } from './game/game.js';
import { renderPortraits } from './actors/portraits.js';
import { fullscreen } from './core/fullscreen.js';

installFogShader();

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
  onDeploy: async (config) => {
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
    setTimeout(() => {
      if (started && !input.locked && !game.paused && !store.isOpen) menu.showClickToPlay(true);
    }, 1200);
  },
  onResume: () => {
    // paused from the store: back to shopping, the pointer stays free
    if (store.isOpen) {
      if (game) game.paused = false;
      menu.showClickToPlay(false);
      return;
    }
    input.lock();
    wantFullscreen();
  },
  onQuit: () => {
    closeStore();
    // a run abandoned after round 1 still goes on the local leaderboard
    const run = game?.quitStats?.();
    game?.quit();
    if (run) menu.recordRun(run);
    if (game) game.paused = false; // the menu camera keeps rolling
    started = false;
    inMenu = true;
    hud.setVisible(false);
    input.unlock();
  },
  onPlayAgain: () => {
    if (!game || !game.config) return;
    gameOverShown = false;
    closeStore();
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
    // the switch is a click, so fullscreen can follow right away; refused, the switch goes back off
    if (fsChanged && settings.fullscreen) fullscreen.enter().catch(() => menu.setSetting('fullscreen', false));
    else if (fsChanged) fullscreen.exit();
  },
  onUiSound: (name) => audio.play(name, { volume: 0.5 }),
  // music loops on the main menu, fades out on deploy / pause / end screens
  // menu music is for the main menu only (the in-game soundtrack comes later): quick fade out
  onMainMenu: (on) => (on ? music.play(1.5) : music.stop(0.5)),
  onShot: (name) => game?.setMenuShot(name),
});

// Gun shop overlay: opened with F at the cellar counter during the buy phase. The pointer is
// released without pausing; CLOSE (Esc / F / Enter) re-locks it. Ready-up is hold-F in the world.
const store = new Store(document.getElementById('menu'), {
  onClose: () => closeShop(),
});

function openStore() {
  input.enabled = false; // no walking / firing while shopping
  input.keys.clear();
  hud.setVisible(false);
  menu.showClickToPlay(false);
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

function closeShop() {
  if (!store.isOpen) return;
  closeStore();
  hud.setVisible(true);
  input.lock();
  wantFullscreen();
  setTimeout(() => {
    if (started && !input.locked && !game?.paused && !store.isOpen) menu.showClickToPlay(true);
  }, 1200);
}

const settings = { ...menu.getSettings() };
music.setVolume(settings.volume ?? 0.8, settings.music ?? 0.9);

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
  // Esc no longer releases the pointer by itself while it's locked to the page: pause like it would
  if (e.code === 'Escape' && fullscreen.escLocked && input.locked && !store.isOpen) input.unlock();
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

input.onLockChange = (locked) => {
  if (!started || !game) return;
  if (locked) {
    menu.showClickToPlay(false);
    menu.hideAll();
    game.paused = false;
  } else if (store.isOpen) {
    // released for the store: not a pause
  } else if (game.state !== 'victory' && game.state !== 'defeat' && !inMenu) {
    game.paused = true;
    menu.showPause();
  }
};
// clicking the canvas during play re-locks the pointer
gr.renderer.domElement.addEventListener('click', () => {
  if (!started || input.locked || game?.paused || store.isOpen) return;
  input.lock();
  wantFullscreen();
});

async function boot() {
  menu.setLoading(0, 'Preparing');
  try {
    await generateAllTextures((f, label) => menu.setLoading(f * 0.5, 'Generating textures · ' + (label || '')));
  } catch (e) {
    console.error('texture generation failed', e);
  }
  game = new Game({ gr, audio, hud, input, settings });
  await game.load((f, label) => menu.setLoading(f, label));
  game.onShopOpen = openStore;
  // fireteam picker portraits: every character rendered once, off screen
  menu.setLoading(1, 'Briefing the fireteam');
  await new Promise((r) => setTimeout(r, 0));
  try {
    menu.setPortraits(renderPortraits(game.bots));
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
  menu.showMain();
  store.warmup(); // bakes the gun store's 3D item thumbnails in idle time
  // debug handles (used for automated testing when rAF is throttled)
  window.__game = game;
  window.__store = store;
  window.__music = music;  window.__step = (n = 1, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      game.update(dt);
      input.endFrame();
    }
    gr.render(dt);
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
