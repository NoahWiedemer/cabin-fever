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
  desc: 'NOX Biosystems, sublevels 4 and 5: the atrium with its giant specimen tank and gallery, long corridors, labs, offices, the cafeteria, the specimen hall, the flooded wing and the pump hall. Toxic gas comes and goes. Nadja works in her lab behind the vault door.',
  image: 'maps/hive.webp', // the atrium's specimen tank (1024 x 576)
  fogRects: [[-60, -60, 60, 72]], // (all inside: only the distance haze)
  labRect: null,
  story: false,
  loading: 'Descending into the Hive',
  unlocks: [{ round: 4, name: 'NORTH WING' }, { round: 7, name: 'SUBLEVEL 5' }, { round: 10, name: 'OUTER RING' }],
  modeDesc: { cabinfever: 'Part two: Nadja’s lab in the Hive, NOX Biosystems’ complex deep underground. Hold the atrium through 15 waves; the safe zone with Nadja and the armory opens between them. The story comes later.' },
  modeTagline: { cabinfever: 'Part two: hold the Hive for fifteen waves.' },
  shopWhere: 'in Nadja’s lab',
};
// Desert Thunder: Combat Arms' first Fireteam map, remade (world/desert.js). Mogadishu at noon: a hostage rescue that
// turns into a hunt for the intel, in four sectors, against the Sand Hog militia instead of the infected; its own mode,
// the mission (game/desertMission.js), not waves
MAPS.desert = {
  id: 'desert',
  name: 'DESERT THUNDER',
  place: 'MOGADISHU',
  desc: 'Mogadishu at noon: narrow streets, the temple, the road up to the old town, the square. The Sand Hog militia holds a captured intelligence officer.',
  image: 'maps/desert.webp', // the temple's courtyard at noon (1024 x 576)
  fogRects: [[9000, 9000, 9001, 9001]], // (nothing indoors keeps the haze out: one rect far away)
  fogBase: 0.0026, // the dusty noon haze (core/fogShader.js), far thinner than the farm's night
  labRect: null,
  story: false,
  loading: 'Flying into Mogadishu',
  modes: ['mission'], // (game/modes.js modeAllowed)
  unlocks: [{ round: 1, name: 'INSERTION ROUTE' }, { round: 2, name: 'THE TEMPLE' }, { round: 3, name: 'THE ROAD' }, { round: 4, name: 'THE TOWN' }],
  modeDesc: { mission: 'Operation Desert Thunder: fly into Mogadishu, fight through four sectors of the Sand Hog militia, reach the captured officer in the temple before they execute him and recover the intel he found. Riflemen, snipers in the windows, RPGs, the black-clad royal guard and an armoured car on the road.' },
  modeTagline: { mission: 'Four sectors, one hostage, no second chances.' },
};
export const MAP_LIST = [MAPS.farm, MAPS.appenweier, MAPS.hive, MAPS.desert];

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
    // the zombies that hang in the Hive's tanks have to be there before it is built
    const [{ buildHive }, { SPECIMEN_URLS }, { preloadGLBs }] = await Promise.all([import('./hive.js'), import('./hiveTank.js'), import('../core/assets.js')]);
    await preloadGLBs(SPECIMEN_URLS);
    return buildHive(progress);
  }
  if (map.id === 'desert') {
    const { buildDesert } = await import('./desert.js');
    return buildDesert(progress);
  }
  return buildLevel();
}
