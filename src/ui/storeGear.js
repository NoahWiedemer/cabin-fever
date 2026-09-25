// Store (ui/store.js) pieces for the wearable GEAR (game/gear.js): the product models and their
// camera poses, the no-WebGL icons, and the detail-panel HTML (body slot, effect lines, the
// "replaces <X>" hint and the weapon backpack's primary-slot picker).
import { esc } from './hud.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { buildWeaponModel } from '../player/gunSafe.js';
import { buildMachete } from '../player/machete.js';
import { grenadierVest, magPouchVest, weaponBackpack, defibrillator, combatBoots, tacticalGloves } from '../world/gearModels.js';
import { PACK_SLOT } from '../game/gear.js';

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

/** Body-slot + effect block for a gear item's detail panel. `s` = equipmentState(): slotLabel, worn, owned. */
export function gearDetailHtml(it, s) {
  const state = s.worn ? '<b class="on">WORN</b>' : s.owned ? '<b>OWNED · NOT WORN</b>' : '';
  const lines = (it.desc || []).map((l) => `<li>${esc(l)}</li>`).join('');
  return (
    `<div class="cf-st-gear-slot"><em>BODY SLOT</em><span class="cf-st-slot">${esc(s.slotLabel)}</span>${state}</div>` +
    (lines ? `<ul class="cf-st-gear-fx">${lines}</ul>` : '')
  );
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
