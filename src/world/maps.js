// The maps a run can be played on. The map is fixed for the page's lifetime: the fog shader, the nav grid and
// the lights are all built for it at boot, so picking another one stores the choice and reloads the page
// (main.js; the menu's MAP step). The pick lives in localStorage and can be forced with ?map=<id>.
import { HOUSE_FOG_RECT, BARN_INSIDE } from './ranchLayout.js';
import { AW_INSIDE } from './appenweierLayout.js';
import { buildLevel } from './level.js';

const LS_MAP = 'cabinfever.map.v1';

export const MAPS = {
  farm: {
    id: 'farm',
    name: 'THE FARM',
    place: 'CABIN FEVER',
    desc: 'The farmhouse in the storm: basement, upstairs, the barn and Nadja’s lab.',
    fogRects: [HOUSE_FOG_RECT, BARN_INSIDE],
    labRect: [-12.5, 3.8, 2.9, 19.6],
    story: true,
    loading: 'Building the farmhouse',
    // what opens during a run (the menu's briefing; the rules are the level's `unlocks`, game.js _endRound)
    unlocks: [{ round: 4, name: 'UPSTAIRS' }, { round: 10, name: 'BASEMENT', story: 'BASEMENT · LAB' }],
    shopWhere: 'in the cellar',
  },
  appenweier: {
    id: 'appenweier',
    name: 'APPENWEIER',
    place: 'SANDERSTRASSE',
    desc: 'Sanderstraße 13 in the Ortenau: the painted house, the fire station across the road, the corn field, the drugstore.',
    fogRects: AW_INSIDE,
    labRect: null,
    story: false,
    loading: 'Building Appenweier',
    unlocks: [{ round: 4, name: 'FIRE STATION' }, { round: 10, name: 'DRUGSTORE' }],
    // the Cabin Fever mode here: no story, the same 15 waves
    modeDesc: { cabinfever: 'Hold Sanderstraße 13 through 15 waves: the painted house, the garage gun shop, the fire station across the road. No story here, only the horde.' },
    modeTagline: { cabinfever: 'Hold Sanderstraße 13 for fifteen waves. No story, only the horde.' },
    shopWhere: 'in the garage',
  },
};
export const MAP_LIST = [MAPS.farm, MAPS.appenweier];

function stored() {
  try {
    return localStorage.getItem(LS_MAP);
  } catch (_) {
    return null;
  }
}

/** the map this page plays: ?map=<id>, else the last pick, else the farm */
export function currentMapId() {
  let q = null;
  try {
    q = new URLSearchParams(location.search).get('map');
  } catch (_) {
    /* no location (tests) */
  }
  if (q && MAPS[q]) return q;
  const s = stored();
  return s && MAPS[s] ? s : 'farm';
}

export function currentMap() {
  return MAPS[currentMapId()];
}

/** remember a map for the next page load (the menu reloads right after) */
export function storeMapId(id) {
  if (!MAPS[id]) return;
  try {
    localStorage.setItem(LS_MAP, id);
  } catch (_) {
    /* private mode: the ?map= parameter still works */
  }
}

/** build the level of `map` (the farm right away, Appenweier after fetching its data) */
export async function buildMap(map, progress) {
  if (map.id === 'appenweier') {
    const { buildAppenweier } = await import('./appenweier.js');
    return buildAppenweier(progress);
  }
  return buildLevel();
}
