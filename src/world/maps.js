// The maps a run can be played on. The map is fixed for the page's lifetime: the fog shader, the nav grid and
// the lights are all built for it at boot, so picking another one stores the choice for the reload that
// follows (main.js; the menu's MAP select). The main menu always shows the farm, the game's home: a plain visit
// loads it, the pick is only remembered for that one reload (sessionStorage) and can be forced with ?map=<id>.
import { HOUSE_FOG_RECT, BARN_INSIDE } from './ranchLayout.js';
import { AW_INSIDE } from './appenweierLayout.js';
import { buildLevel } from './level.js';

export const MAPS = {
  farm: {
    id: 'farm',
    name: 'CABIN FEVER',
    place: 'CABIN FEVER',
    desc: 'The farmhouse in the storm: basement, upstairs, the barn and Nadja’s lab.',
    image: 'maps/farm.webp', // the briefing's picture (public/maps; a night shot of the yard, 1024 x 576)
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
    image: 'maps/appenweier.webp', // the painted gable at night, the gun shop garage on the right
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
// the Hive: NOX Biosystems' complex, sublevel 4, all underground (world/hive.js): the story's part two plays here
// (for now its 15 waves; the story comes later)
MAPS.hive = {
  id: 'hive',
  name: 'THE HIVE',
  place: 'SUBLEVEL 4',
  desc: 'NOX Biosystems, sublevel 4: the atrium, long corridors, labs, offices, the specimen hall. Nadja works behind glass in her clean room.',
  image: 'maps/hive.webp', // the atrium's specimen column (1024 x 576)
  fogRects: [[-60, -60, 60, 60]], // (all inside: only the distance haze)
  labRect: null,
  story: false,
  loading: 'Descending into the Hive',
  unlocks: [{ round: 4, name: 'NORTH WING' }, { round: 10, name: 'OUTER RING' }],
  modeDesc: { cabinfever: 'Part two: Nadja’s lab in the Hive, NOX Biosystems’ complex deep underground. Hold the atrium through 15 waves; the safe zone with Nadja and the armory opens between them. The story comes later.' },
  modeTagline: { cabinfever: 'Part two: hold the Hive for fifteen waves.' },
  shopWhere: 'in the safe zone',
};
export const MAP_LIST = [MAPS.farm, MAPS.appenweier, MAPS.hive];

const SS_MAP = 'cabinfever.map.next'; // (sessionStorage) the map the reload after a switching deploy loads
const LS_OLD = 'cabinfever.map.v1'; // (localStorage, no longer used: the last pick used to stick, and the menu showed it)

function pending() {
  try {
    localStorage.removeItem(LS_OLD);
    return sessionStorage.getItem(SS_MAP);
  } catch (_) {
    return null;
  }
}

let _id = null;

/** the map this page plays: ?map=<id>, else the one a switching deploy asked for, else the farm (fixed at first call) */
export function currentMapId() {
  if (_id) return _id;
  let q = null;
  try {
    q = new URLSearchParams(location.search).get('map');
  } catch (_) {
    /* no location (tests) */
  }
  const s = pending();
  _id = q && MAPS[q] ? q : s && MAPS[s] ? s : 'farm';
  try {
    sessionStorage.removeItem(SS_MAP); // (one reload only: the next visit is the farm again)
  } catch (_) {
    /* private mode */
  }
  return _id;
}

export function currentMap() {
  return MAPS[currentMapId()];
}

/** ask for a map on the next page load (the menu reloads right after); the load after that is the farm again */
export function storeMapId(id) {
  if (!MAPS[id]) return;
  try {
    sessionStorage.setItem(SS_MAP, id);
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
  if (map.id === 'hive') {
    const { buildHive } = await import('./hive.js');
    return buildHive(progress);
  }
  return buildLevel();
}
