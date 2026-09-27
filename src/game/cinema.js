// Cutscene runner: plays one scripted scene at a time (game/cutscenes.js). While a scene runs the game only
// ticks the world (game.update → _updateCinema): no player input, no AI, no timers; the scene poses its
// cast and flies the camera. Letterbox, subtitles, fades and the hold-to-skip hint go through ui/story.js.
//
// A scene: { id, dur, fadeIn?, fadeOut?, skippable?, title?: [t0, t1, kicker, text],
//   lines: [[t, speaker, text, dur, radio?]], begin(g, S), tick(g, S, t, dt), end(g, S, skipped) }
// S is the scene's own state for one run.

export const SKIP_HOLD = 0.9; // s holding Space to skip

export const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const easeOut = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - (1 - x) * (1 - x));
export const easeIn = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x);
/** 0..1 over [a, b] */
export const span = (t, a, b) => (t <= a ? 0 : t >= b ? 1 : (t - a) / (b - a));

export class Cinema {
  constructor(game) {
    this.game = game;
    this.scene = null;
    this.t = 0;
    this.skipT = 0;
    this.S = null;
    this.line = null;
  }

  get active() {
    return !!this.scene;
  }

  get id() {
    return this.scene?.id ?? null;
  }

  play(scene) {
    const g = this.game;
    if (this.scene) this.stop(true);
    this.scene = scene;
    this.t = 0;
    this.skipT = 0;
    this.line = null;
    this.S = {};
    g.hud.setVisible(false);
    g.hud.setPickupPrompt?.(null);
    g.story.setCinema(true);
    g.story.setFade(scene.fadeIn ? 1 : 0);
    g.story.clearRadio();
    g.viewmodel.setVisible(false);
    g.weapons._stopLoops?.();
    g.input.keys.clear();
    scene.begin?.(g, this.S);
  }

  update(dt, input) {
    const s = this.scene;
    if (!s) return;
    const g = this.game;
    this.t += dt;
    const t = this.t;
    // hold Space (or Enter) to skip
    if (s.skippable !== false && t > 0.6) {
      const held = !!input && (input.down('Space') || input.down('Enter') || input.down('NumpadEnter'));
      this.skipT = held ? this.skipT + dt : Math.max(0, this.skipT - dt * 2);
      g.story.setSkip(this.skipT / SKIP_HOLD);
      if (this.skipT >= SKIP_HOLD) {
        this.stop(true);
        return;
      }
    } else g.story.setSkip(null);
    // subtitles: the line whose window we're in (radio lines key the radio in and out)
    let cur = null;
    for (const L of s.lines ?? []) if (t >= L[0] && t < L[0] + L[3]) cur = L;
    if (cur !== this.line) {
      if (this.line?.[4] && !(cur?.[4])) g.audio.play('radio_off', { volume: 0.55 });
      if (cur?.[4] && !this.line?.[4]) g.audio.play('radio_on', { volume: 0.6 });
      this.line = cur;
      g.story.subtitle(cur ? cur[1] : null, cur ? cur[2] : '', !!cur?.[4]);
    }
    if (s.title) g.story.title(t >= s.title[0] && t < s.title[1] ? s.title[2] : null, s.title[3]);
    // fades to / from black
    let f = 0;
    if (s.fadeIn && t < s.fadeIn) f = 1 - t / s.fadeIn;
    if (s.fadeOut && t > s.dur - s.fadeOut) f = Math.max(f, (t - (s.dur - s.fadeOut)) / s.fadeOut);
    g.story.setFade(f);
    s.tick(g, this.S, t, dt);
    if (t >= s.dur) this.stop(false);
  }

  /** end the scene now (skipped: the scene jumps its world to where the scene would have left it) */
  stop(skipped) {
    const s = this.scene;
    if (!s) return;
    const g = this.game;
    this.scene = null;
    if (this.line?.[4]) g.audio.play('radio_off', { volume: 0.55 });
    this.line = null;
    g.story.setCinema(false);
    g.story.setFade(0);
    g.story.clearRadio(); // anything queued before or during the scene is stale now
    g.input.keys.clear();
    s.end?.(g, this.S, skipped);
    if (!s.keepHud) g.hud.setVisible(true);
    g.onCinemaEnd?.(s.id, skipped);
  }
}
