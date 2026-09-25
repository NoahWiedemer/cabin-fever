// Main-menu music: one looping HTMLAudioElement, kept apart from the synthesized WebAudio game
// mix. Browsers block playback until a user gesture, so a refused play() retries on the next
// click / key press. Volume = master × music setting, with smooth fades.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class MenuMusic {
  constructor(src) {
    this.src = src;
    this.el = null;
    this.want = false; // should be audible
    this.level = 0; // fade level 0..1
    this.target = 0;
    this.rate = 1;
    this.master = 0.8;
    this.music = 0.7;
    this._timer = 0;
    this._last = 0;
    this._armed = false;
    this._retry = () => {
      this._armed = false;
      removeEventListener('pointerdown', this._retry, true);
      removeEventListener('keydown', this._retry, true);
      if (this.want) this._play();
    };
  }

  setVolume(master, music) {
    this.master = clamp01(Number(master) || 0);
    this.music = clamp01(Number(music) || 0);
    this._apply();
  }

  /** Fade in (starts playback; waits for a gesture if the browser still blocks audio). */
  play(fadeSec = 1.5) {
    this.want = true;
    this._fade(1, fadeSec);
    this._play();
  }

  /** Fade out, then pause. */
  stop(fadeSec = 1.5) {
    this.want = false;
    this._fade(0, fadeSec);
  }

  _el() {
    if (!this.el) {
      const a = new Audio(this.src);
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      this.el = a;
    }
    return this.el;
  }

  _play() {
    const a = this._el();
    if (!a.paused) return;
    const p = a.play();
    if (p && p.catch) {
      p.catch(() => {
        // autoplay blocked: try again on the next user gesture
        if (this._armed) return;
        this._armed = true;
        addEventListener('pointerdown', this._retry, true);
        addEventListener('keydown', this._retry, true);
      });
    }
  }

  _fade(to, sec) {
    this.target = to;
    this.rate = sec > 0 ? 1 / sec : Infinity;
    if (this._timer) return;
    this._last = performance.now();
    // a timer, not rAF: keeps fading while the render loop is busy or the tab is hidden
    this._timer = setInterval(() => this._tick(), 30);
    this._tick();
  }

  _tick() {
    const now = performance.now();
    const dt = (now - this._last) / 1000;
    this._last = now;
    const d = this.target - this.level;
    const step = this.rate * dt;
    this.level = Math.abs(d) <= step ? this.target : this.level + Math.sign(d) * step;
    this._apply();
    if (this.level !== this.target) return;
    clearInterval(this._timer);
    this._timer = 0;
    if (this.level === 0 && !this.want && this.el && !this.el.paused) this.el.pause();
  }

  _apply() {
    // squared fade level reads as an even fade to the ear
    if (this.el) this.el.volume = clamp01(this.level * this.level * this.master * this.music);
  }
}
