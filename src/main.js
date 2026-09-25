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
  },
  onQuit: () => {
    closeStore();
    game?.quit();
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
  },
  onSettingsChange: (s) => {
    Object.assign(settings, s);
    audio.setMasterVolume(settings.volume ?? 0.8);
    music.setVolume(settings.volume ?? 0.8, settings.music ?? 0.6);
    if (gr.qualityName !== settings.quality) gr.setQuality(settings.quality);
    hud.setFps(settings.showFps ? 0 : null);
  },
  onUiSound: (name) => audio.play(name, { volume: 0.5 }),
  // music loops on the main menu, fades out on deploy / pause / end screens
  onMainMenu: (on) => (on ? music.play(1.5) : music.stop(1.5)),
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
  setTimeout(() => {
    if (started && !input.locked && !game?.paused && !store.isOpen) menu.showClickToPlay(true);
  }, 1200);
}

const settings = { ...menu.getSettings() };
music.setVolume(settings.volume ?? 0.8, settings.music ?? 0.6);

// Browsers keep audio locked until a user gesture: unlock the synth (menu sounds, thunder) on
// the first click / key anywhere. The menu music retries its own play() on the same gesture.
function unlockAudio() {
  removeEventListener('pointerdown', unlockAudio, true);
  removeEventListener('keydown', unlockAudio, true);
  audio.init().then(() => audio.setMasterVolume(settings.volume ?? 0.8));
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
  if (started && !input.locked && !game?.paused && !store.isOpen) input.lock();
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
  menu.setBots(game.bots.map((b) => b.name));
  game.onGameOver = (stats) => {
    setTimeout(() => {
      if (gameOverShown) return;
      gameOverShown = true;
      closeStore();
      started = false;
      input.unlock();
      hud.setVisible(false);
      game.running = false;
      menu.showEnd(stats);
    }, 3500);
  };
  const resize = () => {
    for (const s of game.fx.systems) s.setViewportHeight(gr.renderer.domElement.height, gr.camera.fov);
  };
  resize();
  window.addEventListener('resize', resize);
  menu.hideLoading();
  menu.showMain();
  // debug handles (used for automated testing when rAF is throttled)
  window.__game = game;
  window.__store = store;
  window.__music = music;
  window.__step = (n = 1, dt = 1 / 60) => {
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
