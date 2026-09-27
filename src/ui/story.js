/*
 * CABIN FEVER — story UI (pure DOM, styles in ui.css):
 *   cinema overlay (outside the HUD, so it stays up while the HUD is hidden): letterbox bars, a black
 *   fade, subtitles (speaker + line, radio lines get the radio tag) and the hold-to-skip hint;
 *   in the HUD (hidden with it): the objective panel (text, an optional progress bar) and radio
 *   messages (speaker, line, a static crackle bar), queued and shown one at a time.
 */
import { esc } from './hud.js';

const SPEAKER_COLOR = {
  COMMAND: '#7fd4ff',
  PILOT: '#9ff0a8',
  NADJA: '#ff9fd6',
};

export class StoryUI {
  constructor(hud) {
    this.hud = hud;
    // cinema layer: a sibling of the HUD root
    const cine = (this.cine = document.createElement('div'));
    cine.className = 'cf-story cf-cine';
    cine.innerHTML = `
      <div class="cf-cine-fade"></div>
      <div class="cf-cine-bar top"></div>
      <div class="cf-cine-bar bot"></div>
      <div class="cf-cine-sub"><b class="cf-cine-who"></b><span class="cf-cine-line"></span></div>
      <div class="cf-cine-title"><em></em><span></span></div>
      <div class="cf-cine-skip"><i><s></s></i><span>HOLD <kbd>SPACE</kbd> TO SKIP</span></div>`;
    hud.host.appendChild(cine);
    const q = (s) => cine.querySelector(s);
    this.$c = { fade: q('.cf-cine-fade'), sub: q('.cf-cine-sub'), who: q('.cf-cine-who'), line: q('.cf-cine-line'), skip: q('.cf-cine-skip'), skipFill: q('.cf-cine-skip s'), title: q('.cf-cine-title'), tKick: q('.cf-cine-title em'), tText: q('.cf-cine-title span') };
    // HUD layer: objective + radio
    const obj = (this.obj = document.createElement('div'));
    obj.className = 'cf-obj cf-hide-empty';
    obj.innerHTML = `<div class="cf-obj-k">OBJECTIVE</div><div class="cf-obj-t"></div><div class="cf-obj-bar"><i></i></div><div class="cf-obj-s"></div>`;
    hud.root.appendChild(obj);
    const radio = (this.radio = document.createElement('div'));
    radio.className = 'cf-radio';
    radio.innerHTML = `<div class="cf-radio-ico"><i></i><i></i><i></i></div><div class="cf-radio-body"><b></b><span></span></div>`;
    hud.root.appendChild(radio);
    this.$o = { t: obj.querySelector('.cf-obj-t'), bar: obj.querySelector('.cf-obj-bar'), fill: obj.querySelector('.cf-obj-bar i'), s: obj.querySelector('.cf-obj-s') };
    this.$r = { who: radio.querySelector('b'), line: radio.querySelector('span') };
    this._radioQ = [];
    this._radioCur = null;
    this._radioT = 0;
    this._objKey = '';
    this._subKey = '';
  }

  /* ------------------------------------------------------------ cinema */

  /** letterbox on / off (bars slide in) */
  setCinema(on) {
    this.cine.classList.toggle('on', !!on);
    if (!on) {
      this.subtitle(null);
      this.setSkip(null);
      this.title(null);
    }
  }

  /** 0 clear .. 1 black */
  setFade(k) {
    this.$c.fade.style.opacity = String(Math.max(0, Math.min(1, k)));
  }

  /** a line under the picture; who null hides it; radio: the line comes over the radio */
  subtitle(who, text = '', radio = false) {
    const key = who ? who + '|' + text : '';
    if (key === this._subKey) return;
    this._subKey = key;
    const s = this.$c.sub;
    if (!who) {
      s.classList.remove('show');
      return;
    }
    this.$c.who.textContent = who;
    this.$c.who.style.color = SPEAKER_COLOR[who] ?? '#ffd27a';
    this.$c.line.textContent = text;
    s.classList.toggle('radio', !!radio);
    s.classList.remove('show');
    void s.offsetWidth; // restart the fade-in
    s.classList.add('show');
  }

  /** a location / chapter card (kicker, title) or null */
  title(kicker, text = '') {
    const t = this.$c.title;
    if (!kicker) {
      t.classList.remove('show');
      return;
    }
    this.$c.tKick.textContent = kicker;
    this.$c.tText.textContent = text;
    t.classList.add('show');
  }

  /** skip hint: null hidden, else the hold progress 0..1 */
  setSkip(p) {
    const s = this.$c.skip;
    s.classList.toggle('show', p != null);
    if (p != null) this.$c.skipFill.style.transform = `scaleX(${Math.max(0, Math.min(1, p))})`;
  }

  /* ------------------------------------------------------------ objective */

  /** { text, sub?, progress? (0..1), alert? } or null */
  setObjective(o) {
    const key = o ? `${o.text}|${o.sub ?? ''}|${o.progress != null ? Math.round(o.progress * 200) : ''}|${o.alert ? 1 : 0}` : '';
    if (key === this._objKey) return;
    const fresh = !this._objKey.startsWith((o?.text ?? '') + '|');
    this._objKey = key;
    const el = this.obj;
    if (!o) {
      el.classList.remove('show');
      return;
    }
    this.$o.t.textContent = o.text;
    this.$o.s.textContent = o.sub ?? '';
    this.$o.s.style.display = o.sub ? '' : 'none';
    this.$o.bar.style.display = o.progress != null ? '' : 'none';
    if (o.progress != null) this.$o.fill.style.transform = `scaleX(${Math.max(0, Math.min(1, o.progress))})`;
    el.classList.toggle('alert', !!o.alert);
    el.classList.add('show');
    if (fresh) {
      el.classList.remove('new');
      void el.offsetWidth;
      el.classList.add('new');
    }
  }

  /* ------------------------------------------------------------ radio */

  /** queue a radio message; dur in s (default by length) */
  radioMsg(who, text, dur) {
    this._radioQ.push({ who, text, dur: dur ?? Math.min(9, 2.6 + text.length * 0.055) });
  }

  clearRadio() {
    this._radioQ.length = 0;
    this._radioCur = null;
    this.radio.classList.remove('show');
  }

  /** returns the message that just started (for the radio sounds), else null */
  update(dt) {
    let started = null;
    if (this._radioCur) {
      this._radioT -= dt;
      if (this._radioT <= 0) {
        this._radioCur = null;
        this.radio.classList.remove('show');
        this._radioGap = 0.45;
      }
    } else if (this._radioQ.length && (this._radioGap = (this._radioGap ?? 0) - dt) <= 0) {
      const m = (this._radioCur = this._radioQ.shift());
      this._radioT = m.dur;
      this.$r.who.textContent = m.who;
      this.$r.who.style.color = SPEAKER_COLOR[m.who] ?? '#ffd27a';
      this.$r.line.innerHTML = esc(m.text);
      this.radio.classList.remove('show');
      void this.radio.offsetWidth;
      this.radio.classList.add('show');
      started = m;
    }
    return started;
  }

  get radioBusy() {
    return !!this._radioCur || this._radioQ.length > 0;
  }
}
