// Store GEAR tab: the character paperdoll (ui/store.js). Your figure stands in the middle with the eight
// body slots of game/gear.js around it, each box tied to its body part by a thin leader line: head, neck,
// torso and hands down the left column, back, belt, pocket and feet down the right one. A box shows the
// item worn there (its store thumbnail and name) or a dashed EMPTY outline; the selected item's slot
// lights up, and a box flashes when an item goes on. The store owns the state and the clicks
// (.cf-st-ds[data-slot]); this only draws.
//
// The figure is a teammate body (FIG_BODY: the masked Scorpion operator), rendered ONCE by
// actors/portraits.js (the fireteam portraits' throwaway renderer and three-point light) standing at
// ease without a gun; the leader-line anchors are projected with the same camera. About 0.1 s of
// work, done in idle time after boot (Store.warmup) or when GEAR first opens, then cached for the
// session; without WebGL an SVG silhouette stands in.
import * as THREE from 'three';
import { GEAR_SLOTS, SLOT_LABEL } from '../game/gear.js';
import { renderPortraits } from '../actors/portraits.js';
import { createCharacter } from '../actors/rig.js';
import { slotIcon } from './storeGear.js';
import { esc } from './hud.js';

// box columns, top to bottom (the layout keeps this order)
const COLUMNS = [
  ['l', ['head', 'neck', 'torso', 'hands']],
  ['r', ['back', 'belt', 'pocket', 'feet']],
];
const SIDE = Object.fromEntries(COLUMNS.flatMap(([side, slots]) => slots.map((s) => [s, side])));

// leader-line anchors: bone + offset in the body's frame (it faces +Z, +X is its left = the picture's
// right), so left-column lines end on the picture's left of the body part and right-column ones on its right
const ANCHOR_PTS = {
  head: ['head', -0.07, 0.11, 0.06],
  neck: ['neck', -0.04, -0.02, 0.07],
  torso: ['chest', -0.1, 0.08, 0.17],
  hands: ['handR', -0.01, -0.08, 0.01],
  back: ['chest', 0.19, 0.2, -0.12],
  belt: ['hips', 0.165, 0.08, 0.07],
  pocket: ['thighL', 0.1, -0.21, 0.01],
  feet: ['footL', 0.03, -0.04, 0.13],
};

// the body: the masked Scorpion operator (actors/gltfCharacter.js 'meshy'; the procedural soldier if its
// GLB is missing), a faceless stand-in for you
const FIG_BODY = 'meshy';
// the render: a tall, slightly turned full-body shot, top of the head to below the boots
const FIG_W = 320;
const FIG_H = 704;
const FIG_OPTS = { width: FIG_W, height: FIG_H, span: 2.1, azimuth: 0.32, headroom: 0.35, lift: 0.12, exposure: 1.3 };
const BODY_W = 0.8; // share of the image width the body (arms included) takes

/** Relaxed stance: arms hanging a little away from the body, elbows soft, palms in, feet apart. */
function atEase(b) {
  b.upperArmL.rotation.set(0.05, 0, 0.1);
  b.upperArmR.rotation.set(0.05, 0, -0.1);
  b.foreArmL.rotation.set(-0.25, 0, 0);
  b.foreArmR.rotation.set(-0.25, 0, 0);
  b.handL.rotation.set(0, -1.2, 0.05);
  b.handR.rotation.set(0, 1.2, -0.05);
  b.thighL.rotation.set(0, 0, 0.05);
  b.thighR.rotation.set(0, 0, -0.05);
  b.footL.rotation.set(0, 0.14, -0.05);
  b.footR.rotation.set(0, -0.14, 0.05);
  b.head.rotation.set(0.03, 0, 0);
}

let FIG = null; // { url, aspect, anchors: { slot: [x, y] 0..1 of the image } } | false (failed)

/** Render a body at ease (portraits.js takes it like a bot) and project the slot anchors. */
function shoot(kind, opts) {
  const c = createCharacter(kind, 1);
  const body = {
    id: 'you',
    root: c.root,
    bones: c.bones,
    posePortrait() {
      atEase(c.bones);
      c.root.updateMatrixWorld(true);
      c.rig?.sync();
      c.root.updateMatrixWorld(true);
    },
  };
  let anchors = null;
  const v = new THREE.Vector3();
  const shots = renderPortraits([body], {
    ...opts,
    onRender: (_, cam) => {
      anchors = {};
      for (const [slot, [bone, x, y, z]] of Object.entries(ANCHOR_PTS)) {
        c.bones[bone].getWorldPosition(v);
        v.set(v.x + x, v.y + y, v.z + z).project(cam);
        anchors[slot] = [(v.x + 1) / 2, (1 - v.y) / 2];
      }
    },
  });
  return shots.you && anchors ? { url: shots.you, aspect: opts.width / opts.height, anchors } : null;
}

/** The figure image + anchors, rendered on the first call and cached. */
export function renderFigure() {
  if (FIG !== null) return FIG;
  FIG = false;
  try {
    FIG = shoot(FIG_BODY, FIG_OPTS) || false;
  } catch (e) {
    console.warn('[store] paperdoll figure failed', e);
  }
  return FIG;
}

// no WebGL: a plain silhouette (120 x 264) with hand-placed anchors
const FALLBACK = {
  url:
    'data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 264"><g fill="#3b4046">' +
        '<circle cx="60" cy="24" r="15"/><path d="M54 38h12v10H54z"/>' +
        '<path d="M36 50Q60 44 84 50L88 116Q60 122 32 116Z"/>' +
        '<path d="M35 52L27 56L16 142L25 145L38 82Z"/><path d="M85 52L93 56L104 142L95 145L82 82Z"/>' +
        '<circle cx="20" cy="150" r="7"/><circle cx="100" cy="150" r="7"/>' +
        '<path d="M33 118Q60 124 87 118L88 138H32Z"/>' +
        '<path d="M33 136H58L56 246H40Z"/><path d="M62 136H87L80 246H64Z"/>' +
        '<path d="M38 244H57V256H33Q33 248 38 244Z"/><path d="M63 244H82Q87 248 87 256H63Z"/>' +
        '</g></svg>'
    ),
  aspect: 120 / 264,
  anchors: {
    head: [0.4, 0.07],
    neck: [0.46, 0.17],
    torso: [0.38, 0.3],
    hands: [0.14, 0.57],
    back: [0.72, 0.22],
    belt: [0.72, 0.46],
    pocket: [0.7, 0.6],
    feet: [0.66, 0.95],
  },
};

/** Stack a column of `n` boxes (height h, min gap) as close to their wanted centers as they fit in 0..H. */
function stack(wants, h, H, gap) {
  const n = wants.length;
  const tops = wants.map((w) => w - h / 2);
  let lo = 0;
  for (let i = 0; i < n; i++) {
    tops[i] = Math.max(tops[i], lo);
    lo = tops[i] + h + gap;
  }
  let hi = H - h;
  for (let i = n - 1; i >= 0; i--) {
    tops[i] = Math.min(tops[i], hi);
    hi = tops[i] - h - gap;
  }
  if (tops[0] < 0) for (let i = 0; i < n; i++) tops[i] = n > 1 ? (i * (H - h)) / (n - 1) : 0; // too tight: evenly
  return tops;
}

export class Paperdoll {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'cf-st-dollwrap';
    const el = (this.area = document.createElement('div'));
    el.className = 'cf-st-doll';
    this.el.appendChild(el);
    el.innerHTML =
      '<div class="cf-st-doll-fig"><img alt="" draggable="false"></div>' +
      `<svg class="cf-st-doll-wires" aria-hidden="true">${GEAR_SLOTS.map((s) => `<g data-slot="${s}"><path/><circle r="2.5"/></g>`).join('')}</svg>` +
      GEAR_SLOTS.map(
        (s) => `<button class="cf-st-ds ${SIDE[s]} empty" data-sfx data-slot="${s}" title="${SLOT_LABEL[s]}" aria-label="${SLOT_LABEL[s]}: EMPTY">
          <span class="cf-st-ds-h">${slotIcon(s)}<em>${SLOT_LABEL[s]}</em><i class="cf-st-ds-alt"></i></span>
          <span class="cf-st-ds-pic"></span><span class="cf-st-ds-n"></span>
        </button>`
      ).join('');
    this.figEl = el.querySelector('.cf-st-doll-fig');
    this.img = this.figEl.querySelector('img');
    this.svg = el.querySelector('.cf-st-doll-wires');
    this.box = {};
    this.wire = {};
    for (const s of GEAR_SLOTS) {
      this.box[s] = el.querySelector(`.cf-st-ds[data-slot="${s}"]`);
      this.wire[s] = this.svg.querySelector(`g[data-slot="${s}"]`);
      this._fill(s, null);
    }
    this.fig = null;
    this._live = false; // false until the first update after reset(): no swap animation for the initial fill
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.layout()).observe(el);
    // one-shot effects end for good (the paperdoll is hidden on the other tabs: showing it again
    // would replay any animation class still set)
    el.addEventListener('animationend', (e) => {
      const n = e.animationName;
      if (n === 'cf-st-ds-flash') e.target.classList.remove('flash', 'swap');
      else if (n === 'cf-st-shake') e.target.classList.remove('nope');
      else if (n === 'cf-st-wire-flash') e.target.parentNode?.classList.remove('flash');
    });
  }

  /** The figure (rendered once per session on first use); the silhouette without WebGL. */
  ensureFigure() {
    if (this.fig) return;
    this.fig = renderFigure() || FALLBACK;
    this.img.src = this.fig.url;
    this.layout();
  }

  /** The store (re)opened: fill the boxes without the swap animation. */
  reset() {
    this._live = false;
  }

  /**
   * slots: { slot: { key, name, pic (html), tk (thumbnail key), alt (other owned items) } | null },
   * hl: the selected item's slot, focus: the slot picked on the doll, none: slots with nothing in stock.
   */
  update(slots, { hl = null, focus = null, none = [] } = {}) {
    for (const s of GEAR_SLOTS) {
      const d = slots[s] || null;
      const b = this.box[s];
      const sig = d ? `${d.key}|${d.tk}` : '';
      if (b.dataset.sig !== sig) {
        const swapped = this._live && !!d && d.key !== (b.dataset.key || '');
        this._fill(s, d);
        b.dataset.sig = sig;
        b.dataset.key = d?.key || '';
        if (swapped) this.flash(s, true);
      }
      const alt = d?.alt ? `+${d.alt}` : '';
      const ai = b.querySelector('.cf-st-ds-alt');
      if (ai.textContent !== alt) ai.textContent = alt;
      ai.title = alt ? `${d.alt} MORE OWNED` : '';
      b.classList.toggle('hl', s === hl);
      b.classList.toggle('focus', s === focus);
      b.classList.toggle('na', !d && none.includes(s));
      b.setAttribute('aria-pressed', s === focus);
      const w = this.wire[s];
      w.classList.toggle('on', !!d);
      w.classList.toggle('hl', s === hl || s === focus);
    }
    this._live = true;
  }

  _fill(s, d) {
    const b = this.box[s];
    b.classList.toggle('empty', !d);
    b.classList.toggle('full', !!d);
    b.querySelector('.cf-st-ds-pic').innerHTML = d ? d.pic : slotIcon(s, 'cf-st-ds-ph');
    b.querySelector('.cf-st-ds-n').innerHTML = d ? esc(d.name) : 'EMPTY';
    b.setAttribute('aria-label', `${SLOT_LABEL[s]}: ${d ? d.name : 'EMPTY'}`);
  }

  /** Flash a slot box and its leader line (something went on / was upgraded); `swap` slides the item in. */
  flash(s, swap = false) {
    const b = this.box[s];
    const w = this.wire[s];
    if (!b) return;
    b.classList.remove('flash', 'swap');
    w.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
    if (swap) b.classList.add('swap');
    w.classList.add('flash');
  }

  /** Denied (nothing in stock for that slot). */
  nope(s) {
    const b = this.box[s];
    if (!b) return;
    b.classList.remove('nope');
    void b.offsetWidth;
    b.classList.add('nope');
  }

  /** Place the figure, stack the boxes next to their body parts and draw the leader lines. */
  layout() {
    const f = this.fig;
    const el = this.area;
    const W = el.clientWidth;
    const H = el.clientHeight;
    if (!f || W < 40 || H < 40) return;
    // short panel: the boxes drop their pictures (name only) rather than overlap
    el.classList.remove('tight');
    const full = this.box.head.offsetHeight;
    const tight = H < 4.4 * full;
    el.classList.toggle('tight', tight);
    const bw = this.box.head.offsetWidth;
    const bh = tight ? this.box.head.offsetHeight : full;
    // the figure as tall as fits, its body (not the image's empty sides) between the two columns
    const gap = Math.max(6, bw * 0.06);
    const fh = Math.max(0, Math.min(H, (W - 2 * (bw + gap)) / (f.aspect * BODY_W)));
    const fw = fh * f.aspect;
    const fx = (W - fw) / 2;
    const fy = (H - fh) / 2;
    const st = this.figEl.style;
    st.left = `${fx}px`;
    st.top = `${fy}px`;
    st.width = `${fw}px`;
    st.height = `${fh}px`;
    const A = {};
    for (const s of GEAR_SLOTS) {
      const a = f.anchors[s] || [0.5, 0.5];
      A[s] = [fx + a[0] * fw, fy + a[1] * fh];
    }
    // each column in its order, every box pulled toward its body part and spread over the height
    const stub = Math.max(5, bw * 0.07);
    const r = Math.max(2.2, bw * 0.02).toFixed(1);
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    for (const [side, slots] of COLUMNS) {
      const n = slots.length;
      const wants = slots.map((s, i) => A[s][1] * 0.6 + ((i + 0.5) * H * 0.4) / n);
      const tops = stack(wants, bh, H, Math.max(4, bh * 0.1));
      slots.forEach((s, i) => {
        this.box[s].style.top = `${tops[i]}px`;
        const y = tops[i] + bh / 2;
        const x0 = side === 'l' ? bw : W - bw;
        const x1 = side === 'l' ? x0 + stub : x0 - stub;
        const [ax, ay] = A[s];
        const w = this.wire[s];
        w.firstChild.setAttribute('d', `M${x0.toFixed(1)} ${y.toFixed(1)}H${x1.toFixed(1)}L${ax.toFixed(1)} ${ay.toFixed(1)}`);
        w.lastChild.setAttribute('cx', ax.toFixed(1));
        w.lastChild.setAttribute('cy', ay.toFixed(1));
        w.lastChild.setAttribute('r', r);
      });
    }
  }
}
