// The Gauntlet's card drafts (game/rogue.js deals them, main.js opens this): three cards in a row, one to take
// (a click, or 1 / 2 / 3; the arrows and Enter work too). The picked card flares, the others fall away, and the
// next step (the curse after the reward) is dealt in its place. The footer shows the run so far: the perks
// and the curses. Styles in draft.css; the pointer is free while it's open (like the gun shop's store).
import './draft.css';
import { esc, weaponSvg, weaponKind } from './hud.js';
import { cardIcon } from './cardIcons.js';

const TYPE = { weapon: 'WEAPON', perk: 'PERK', supply: 'SUPPLY', curse: 'CURSE' };
const RARITY = { common: 'COMMON', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', curse: '' };
const KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Numpad1: 0, Numpad2: 1, Numpad3: 2 };

export class Draft {
  /** cb: { thumb(key) -> image URL | null (the store's baked item pictures), onSfx(name), onDone() } */
  constructor(host, cb = {}) {
    this.cb = cb;
    this.isOpen = false;
    this.spec = null;
    this.busy = false;
    const root = (this.root = document.createElement('div'));
    root.className = 'cf-menu cf-draft';
    root.innerHTML = `
      <div class="cf-dr-bg"><div class="cf-dr-dim"></div><div class="cf-dr-glow"></div><div class="cf-bg-noise"></div></div>
      <div class="cf-dr-wrap">
        <header class="cf-dr-head">
          <div class="cf-dr-k"></div>
          <h2 class="cf-dr-t"></h2>
          <div class="cf-dr-sub"></div>
          <div class="cf-dr-steps"></div>
        </header>
        <div class="cf-dr-cards"></div>
        <footer class="cf-dr-foot"></footer>
      </div>`;
    (host || document.body).appendChild(root);
    const q = (s) => root.querySelector(s);
    this.$ = { k: q('.cf-dr-k'), t: q('.cf-dr-t'), sub: q('.cf-dr-sub'), steps: q('.cf-dr-steps'), cards: q('.cf-dr-cards'), foot: q('.cf-dr-foot') };
    this.$.cards.addEventListener('click', (e) => {
      const c = e.target.closest('.cf-dr-card');
      if (c) this._pick(Number(c.dataset.i));
    });
    let last = null;
    this.$.cards.addEventListener('mouseover', (e) => {
      const c = e.target.closest('.cf-dr-card');
      if (c && c !== last && !this.busy) this._sfx('ui_hover');
      last = c;
    });
    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  /** spec (game/rogue.js draft): { kind, kicker, title, sub, steps, step, cards, have, pick(i) -> next spec | null } */
  open(spec) {
    this.isOpen = true;
    this.root.classList.add('on');
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
    this._render(spec);
  }

  close() {
    this.isOpen = false;
    this.busy = false;
    this.spec = null;
    this.root.classList.remove('on');
  }

  _render(spec) {
    this.spec = spec;
    this.busy = false;
    const $ = this.$;
    this.root.dataset.kind = spec.kind;
    $.k.textContent = spec.kicker ?? '';
    $.t.textContent = spec.title ?? '';
    $.sub.textContent = spec.sub ?? '';
    $.steps.innerHTML =
      spec.steps?.length > 1
        ? spec.steps.map((s, i) => `<span class="${i < spec.step ? 'done' : i === spec.step ? 'on' : ''}"><b>${i + 1}</b>${esc(s)}</span>`).join('<i></i>')
        : '';
    $.cards.innerHTML = spec.cards.map((c, i) => this._card(c, i)).join('');
    $.foot.innerHTML = this._have(spec.have);
    // deal them in (the animation restarts for the second step)
    $.cards.classList.remove('deal');
    void $.cards.offsetWidth;
    $.cards.classList.add('deal');
    this._sfx('card_deal');
  }

  _art(c) {
    const url = c.thumb ? this.cb.thumb?.(c.thumb) : null;
    if (url) return `<img src="${url}" alt="" draggable="false">`;
    if (c.kind === 'weapon') return `<span class="cf-dr-sil">${weaponSvg(weaponKind(c.name))}</span>`;
    return cardIcon(c.icon);
  }

  _card(c, i) {
    const type = c.kind === 'supply' && c.gear ? 'GEAR' : c.kind === 'curse' ? (c.next ? 'CURSE · ONCE' : 'CURSE') : TYPE[c.kind];
    const r = c.rarity ?? 'common';
    return `<button class="cf-dr-card r-${r} k-${c.kind}${c.next ? ' next' : ''}" data-sfx data-i="${i}" style="--i:${i}">
        <span class="cf-dr-face">
          <span class="cf-dr-top"><span class="cf-kc">${i + 1}</span><span class="cf-dr-type">${type}</span></span>
          <span class="cf-dr-art">${this._art(c)}</span>
          <span class="cf-dr-name">${esc(c.name)}</span>
          <span class="cf-dr-tag">${esc(c.tag ?? '')}</span>
          <span class="cf-dr-rule"></span>
          <span class="cf-dr-text">${esc(c.text ?? '')}</span>
          <span class="cf-dr-rar">${RARITY[r] ?? ''}</span>
        </span>
      </button>`;
  }

  _have(h) {
    if (!h) return '';
    const chip = (x, curse) =>
      `<span class="cf-dr-chip${curse ? ' curse' : ''}${x.next ? ' next' : ''}" title="${esc(x.name)}${x.next ? ' · next round' : ''}">${cardIcon(x.icon)}<b>${esc(x.name)}</b>${x.n > 1 ? `<em>×${x.n}</em>` : ''}</span>`;
    const perks = h.perks?.length ? h.perks.map((x) => chip(x)).join('') : '<small>NONE YET</small>';
    const curses = h.curses?.length ? h.curses.map((x) => chip(x, true)).join('') : '<small>NONE YET</small>';
    return `<div class="cf-dr-have"><span class="cf-dr-have-h">PERKS</span>${perks}</div><div class="cf-dr-have curse"><span class="cf-dr-have-h">CURSES</span>${curses}</div>`;
  }

  _pick(i) {
    const spec = this.spec;
    if (!this.isOpen || this.busy || !spec?.cards[i]) return;
    this.busy = true;
    [...this.$.cards.children].forEach((el, k) => el.classList.add(k === i ? 'picked' : 'gone'));
    this._sfx(spec.cards[i].kind === 'curse' ? 'card_curse' : 'card_pick');
    setTimeout(() => {
      if (this.spec !== spec) return;
      const next = spec.pick(i);
      if (next && this.isOpen) this._render(next);
      else this.cb.onDone?.();
    }, 560);
  }

  _onKey(e) {
    if (!this.isOpen) return;
    const n = KEYS[e.code];
    if (n != null) {
      e.preventDefault();
      if (!e.repeat) this._pick(n);
      return;
    }
    const cards = [...this.$.cards.children];
    const at = cards.indexOf(document.activeElement);
    if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      e.preventDefault();
      const next = cards[Math.max(0, Math.min(cards.length - 1, at < 0 ? 0 : at + (e.code === 'ArrowRight' ? 1 : -1)))];
      if (next && next !== document.activeElement) {
        next.focus();
        this._sfx('ui_hover');
      }
    } else if ((e.code === 'Enter' || e.code === 'Space') && at >= 0) {
      e.preventDefault();
      if (!e.repeat) this._pick(at);
    }
  }

  _sfx(name) {
    try {
      this.cb.onSfx?.(name);
    } catch (_) {
      /* no sound */
    }
  }
}
