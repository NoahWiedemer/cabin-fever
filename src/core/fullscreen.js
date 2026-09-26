// Browser fullscreen for the FULLSCREEN setting (the whole page: game, HUD and menus).
// Entering needs a user gesture (the settings toggle, deploying, resuming, a click). Where the
// browser has Keyboard Lock (Chromium), Esc stays with the game while fullscreen: a tap pauses as
// usual, holding it leaves fullscreen. Elsewhere Esc leaves fullscreen and the pointer lock at once.
export const fullscreen = {
  /** document.fullscreenEnabled: false where the API is missing or the page may not go fullscreen */
  get supported() {
    return !!document.fullscreenEnabled;
  },
  get active() {
    return !!document.fullscreenElement;
  },
  /** true while Esc is locked to the page (a short press is a normal key, holding it exits) */
  escLocked: false,

  /** Resolves once fullscreen; rejects if the browser refuses (no gesture, not allowed). */
  async enter() {
    if (this.active) return;
    if (!this.supported) throw new Error('fullscreen not available');
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    try {
      await navigator.keyboard?.lock?.(['Escape']);
      this.escLocked = !!navigator.keyboard?.lock;
    } catch (_) {
      this.escLocked = false; // insecure context, iframe, ...: Esc exits as usual
    }
  },

  exit() {
    navigator.keyboard?.unlock?.();
    this.escLocked = false;
    if (this.active) document.exitFullscreen().catch(() => {});
  },
};
