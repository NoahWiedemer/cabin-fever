// Store (ui/store.js) pieces for the wearable GEAR (game/gear.js): the product models and their
// camera poses, the no-WebGL icons, the body-slot icons (GEAR tab cards, group headers and the
// paperdoll, ui/storeDoll.js), the compact detail HTML (body slot, effect lines, owned alternatives)
// and the weapon backpack's primary-slot picker (WEAPONS tab).
import { esc } from './hud.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { buildMachete } from '../player/machete.js';
import { grenadierVest, magPouchVest, weaponBackpack, defibrillator, combatBoots, tacticalGloves } from '../world/gearModels.js';
import { PACK_SLOT, SLOT_LABEL } from '../game/gear.js';

/* ------------------------------------------------------------------ body-slot icons */

// monochrome 24x24 glyphs (currentColor, evenodd cut-outs): helmet, collar + dog tag, plate carrier,
// backpack, belt buckle, glove, boot, cargo pocket
const SLOT_PATHS = {
  head:
    '<path fill-rule="evenodd" d="M12 3.2c-5 0-8.7 4-8.9 9.5L3 15h18l-.1-2.3C20.7 7.2 17 3.2 12 3.2ZM10.1 4.9h3.8v2.8h-3.8Z"/>' +
    '<path d="M1.6 15.9h20.8a.9.9 0 0 1 .9.9v.8a.9.9 0 0 1-.9.9H1.6a.9.9 0 0 1-.9-.9v-.8a.9.9 0 0 1 .9-.9Z"/>' +
    '<path d="M6.3 18.6l1.7 2.6h8l1.7-2.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  neck:
    '<path d="M7.4 2.8Q12 6.2 16.6 2.8l4.2 2.1-1.6 6.1-4.8-2.2L12 13.2 9.6 8.8 4.8 11 3.2 4.9Z"/>' +
    '<path fill-rule="evenodd" d="M10.2 15h3.6a1.1 1.1 0 0 1 1.1 1.1v4.3a1.1 1.1 0 0 1-1.1 1.1h-3.6a1.1 1.1 0 0 1-1.1-1.1v-4.3a1.1 1.1 0 0 1 1.1-1.1ZM11.2 16.3h1.6v1h-1.6Z"/>',
  torso:
    '<path fill-rule="evenodd" d="M6.4 2.4h3.1l.8 2.3c.5 1.2 1 1.6 1.7 1.6s1.2-.4 1.7-1.6l.8-2.3h3.1l1 5 2 1.3V21a1 1 0 0 1-1 1H4.4a1 1 0 0 1-1-1V8.7l2-1.3ZM6.4 13.4h3.1v5.2H6.4ZM10.45 13.4h3.1v5.2h-3.1ZM14.5 13.4h3.1v5.2h-3.1ZM6.4 10.6h11.2v1.2H6.4Z"/>',
  back:
    '<path fill-rule="evenodd" d="M9 4.2v-.7a3 3 0 0 1 6 0v.7h1.3A3.7 3.7 0 0 1 20 7.9V19a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7.9a3.7 3.7 0 0 1 3.7-3.7ZM10.6 4.2h2.8v-.7a1.4 1.4 0 0 0-2.8 0ZM7.3 13h9.4v6.6H7.3ZM8.6 14.3v4h6.8v-4ZM7.3 10.4h9.4v1.3H7.3Z"/>',
  belt:
    '<path fill-rule="evenodd" d="M1.2 9.6h6.6v4.8H1.2ZM16.2 9.6h6.6v4.8h-6.6ZM17.6 11.4h1.2v1.2h-1.2ZM20.2 11.4h1.2v1.2h-1.2Z"/>' +
    '<path fill-rule="evenodd" d="M8.3 6.6h7.4v10.8H8.3ZM10 8.3v7.4h4V8.3Z"/><path d="M10.6 11.3h3.4v1.4h-3.4Z"/>',
  hands:
    '<path fill-rule="evenodd" d="M8 21.6v-3.3l-3.4-4.4a1.5 1.5 0 0 1 2.2-2l1.6 1.6V5.6a1.2 1.2 0 0 1 2.4 0V11h.8V4.2a1.2 1.2 0 0 1 2.4 0V11h.8V5.2a1.2 1.2 0 0 1 2.4 0v6.4h.8V8a1.1 1.1 0 0 1 2.2 0v8.2c0 2-.8 3.4-1.8 4.4v1ZM8 18.7h10.5v1.1H8Z"/>',
  feet:
    '<path fill-rule="evenodd" d="M5.5 2.5H13v9.2l4.6 1.7c2.3.8 3.9 2.4 3.9 4.6v1.2h-17V3.5a1 1 0 0 1 1-1ZM8.4 5.4h3.2v1.1H8.4ZM8.4 7.9h3.2V9H8.4ZM8.4 10.4h3.2v1.1H8.4Z"/>' +
    '<path d="M4.5 20h17v1.4a.9.9 0 0 1-.9.9H5.4a.9.9 0 0 1-.9-.9Z"/>',
  pocket:
    '<path fill-rule="evenodd" d="M4 3.4h16a1 1 0 0 1 1 1V9l-9 2.8L3 9V4.4a1 1 0 0 1 1-1ZM11 8.1a1 1 0 1 0 2 0a1 1 0 1 0-2 0Z"/>' +
    '<path d="M4 11.3l8 2.5 8-2.5V19a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 19Z"/>',
};

/** A body slot's icon (<svg>, currentColor). */
export function slotIcon(slot, cls = 'cf-st-si') {
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">${SLOT_PATHS[slot] || ''}</svg>`;
}

/* ------------------------------------------------------------------ 3D models */

// see store.js GEAR_POSE: rot (model), roll (picture plane), az / el (camera), fill, env (image light)
export const GEAR_POSES = {
  grenadier: { rot: [0, 0, 0], az: 0.42, el: 0.5, fill: 0.84, env: 0.45 },
  magvest: { rot: [0, 0, 0], az: -0.42, el: 0.5, fill: 0.84, env: 0.45 },
  backpack: { rot: [0, 0, 0], az: 0.5, el: 0.14, fill: 0.9, env: 0.5 },
  defib: { rot: [0, 0, 0], az: 0.42, el: 0.26, fill: 0.82, env: 0.6 },
  boots: { rot: [0, -0.35, 0], az: 0.62, el: 0.32, fill: 0.86, env: 0.4 },
  gloves: { rot: [0, 0, 0], az: 0.25, el: 0.95, fill: 0.84, env: 0.4 },
  machete: { rot: [0, -Math.PI / 2, 0], roll: 0.18, az: 0.3, el: 0.3, fill: 0.95, env: 1.5 },
};

/** Product-model builder of a gear item (null: not a gear item with its own model). */
export function gearModelBuilder(key) {
  switch (key) {
    case 'grenadier':
      return grenadierVest;
    case 'magvest':
      return magPouchVest;
    case 'backpack':
      return () => weaponBackpack({ rifle: () => buildWeaponModel('m4a1').root });
    case 'defib':
      return defibrillator;
    case 'boots':
      return combatBoots;
    case 'gloves':
      return tacticalGloves;
    case 'machete':
      return () => {
        // a product shot: the blade laid out straight (blade -Z, spine up), not the in-hand angle
        const m = buildMachete();
        const body = m.parts?.body;
        if (body) {
          body.quaternion.identity();
          body.position.set(0, 0, 0.1);
        }
        return m.root;
      };
  }
  return null;
}

/* ------------------------------------------------------------------ fallback icons (no WebGL) */

// silhouettes in the 128x40 icon box
export const GEAR_ICON_PATHS = {
  grenadier:
    'M42 4L52 4L56 10L72 10L76 4L86 4L90 12L98 16L98 34L30 34L30 16L38 12Z' +
    'M38 20a6 6 0 1 0 12 0a6 6 0 1 0-12 0ZM52 20a6 6 0 1 0 12 0a6 6 0 1 0-12 0ZM66 20a6 6 0 1 0 12 0a6 6 0 1 0-12 0ZM80 20a6 6 0 1 0 12 0a6 6 0 1 0-12 0Z',
  magvest:
    'M42 4L50 4L54 12L74 12L78 4L86 4L90 14L100 18L100 34L28 34L28 18L38 14Z' +
    'M36 17h11v12h-11ZM50 17h11v12h-11ZM64 17h11v12h-11ZM78 17h11v12h-11Z',
  backpack:
    'M48 6Q64 0 80 6L84 12L84 36Q84 39 80 39L48 39Q44 39 44 36L44 12Z' +
    'M50 22h28v12h-28ZM58 2h12v4h-12ZM20 30L104 8L106 12L22 34Z',
  defib:
    'M36 12Q36 9 40 9L88 9Q92 9 92 12L92 35Q92 38 88 38L40 38Q36 38 36 35Z' +
    'M52 9L54 3L74 3L76 9L71 9L70 6L58 6L57 9ZM42 15h22v12h-22ZM78 21a7 7 0 1 0 0.01 0Z',
  boots:
    'M34 4L56 4L58 24L80 26Q92 28 94 34L94 38L32 38L32 30Z' + 'M70 6L90 6L92 24L110 26Q120 28 122 34L122 38L96 38L96 32Q94 26 86 24L70 22Z',
  gloves:
    'M40 38L40 24L34 16L37 13L44 18L44 6L48 6L48 17L51 4L55 4L54 17L58 5L62 5L60 18L64 9L68 9L64 24L62 38Z' +
    'M70 38L72 24L68 12L72 11L76 20L78 6L82 6L82 19L86 5L90 5L88 20L94 8L98 9L92 24L100 20L102 23L92 32L90 38Z',
  machete:
    'M4 22L30 18L30 26L4 26Q2 26 2 24Z' + 'M30 16L34 16L34 28L30 28Z' + 'M34 18L104 16Q118 16 126 24L112 28L34 26Z',
};

/* ------------------------------------------------------------------ detail panel */

/** Body slot + worn state chip of a gear item (detail head). `s` = equipmentState(): worn, owned. */
export function gearSlotTag(it, s) {
  const state = s.worn ? ' · WORN' : s.owned ? ' · OWNED' : '';
  return `<span class="cf-st-wslot${s.worn ? ' on' : s.owned ? ' own' : ''}" title="BODY SLOT">${slotIcon(it.slot)}${esc(SLOT_LABEL[it.slot] ?? '')}${state}</span>`;
}

/** Effect lines of a gear item. */
export function gearDetailHtml(it) {
  const lines = (it.desc || []).map((l) => `<li>${esc(l)}</li>`).join('');
  return lines ? `<ul class="cf-st-gear-fx">${lines}</ul>` : '';
}

/** The other items you own for a body slot (`alts`: [{ key, name }]), each a free one-click swap onto it. */
export function gearAltsHtml(slot, alts) {
  if (!alts.length) return '';
  const btns = alts.map((a) => `<button class="cf-st-alt" data-sfx data-act="wear" data-key="${a.key}" title="PUT IT ON · FREE"><span>${esc(a.name)}</span><i>EQUIP</i></button>`);
  return `<div class="cf-st-alts"><em>ALSO OWNED · ${esc(SLOT_LABEL[slot] ?? '')}</em>${btns.join('')}</div>`;
}

/**
 * The weapon backpack's primary picker (weapons tab, a primary selected, backpack worn): which of the
 * two primary slots the selected gun goes into. `w` = the WeaponSystem, `target` = 0 | PACK_SLOT.
 */
export function packPickerHtml(w, id, target) {
  const seg = (slot, label, key) => {
    const held = w.slots[slot];
    const name = held ? WEAPONS[held]?.name ?? held : 'EMPTY';
    return `<button class="cf-st-pk${slot === target ? ' on' : ''}${held === id ? ' has' : ''}" data-sfx data-act="pslot" data-slot="${slot}">
      <span class="cf-st-pk-l">${label}<span class="cf-kc">${key}</span></span><span class="cf-st-pk-n">${esc(name)}</span></button>`;
  };
  const other = target === 0 ? PACK_SLOT : 0;
  const inT = w.slots[target];
  let hint = '';
  if (inT !== id && w.slots[other] === id) hint = inT ? `SWAPS PLACES WITH YOUR ${esc(WEAPONS[inT]?.name ?? inT)}` : 'SLOT 1 CAN’T BE LEFT EMPTY';
  else if (inT && inT !== id) hint = `REPLACES YOUR ${esc(WEAPONS[inT]?.name ?? inT)}${w.owned?.has(inT) ? ' (KEPT)' : ' (LOST)'}`;
  return `<div class="cf-st-pick"><div class="cf-st-pick-segs">${seg(0, 'PRIMARY', '1')}${seg(PACK_SLOT, 'BACKPACK', '1×2')}</div>${hint ? `<div class="cf-st-pick-hint">${hint}</div>` : ''}</div>`;
}
