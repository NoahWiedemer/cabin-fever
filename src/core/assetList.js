// Every GLB the game needs, preloaded during Game.load (see core/assets.js).
// Sources live in assets/source; `node tools/optimize-assets.mjs` regenerates public/models.
export const MODELS = {
  // characters (fireteam bots)
  coach: '/models/characters/coach.glb',
  ellis: '/models/characters/ellis.glb',
  meshy: '/models/characters/meshy.glb',
  viper: '/models/characters/viper.glb',
  raven: '/models/characters/raven.glb',
  shopkeeper: '/models/characters/shopkeeper.glb', // gun shop clerk (not a bot)
  nadja: '/models/characters/nadja.glb', // lab tech behind the basement's armored glass (not a bot)
  emosquad: '/models/characters/emosquad.glb', // your own character (cutscenes, the store paperdoll; not a bot)
  // infected
  boomer: '/models/zombies/boomer.glb',
  smoker: '/models/zombies/smoker.glb',
  dog: '/models/zombies/dog.glb',
  tank: '/models/zombies/tank.glb', // Crusher boss
  woman: '/models/zombies/woman.glb', // Mauler variant (zombie woman)
  bomber: '/models/zombies/bomber.glb', // Striker (gas mask, explosives)
  gasmask: '/models/zombies/gasmask.glb', // Mauler body variant
  biter: '/models/zombies/biter.glb', // Biter (small, pounces and latches on)
  stalker: '/models/zombies/stalker.glb', // Stalker (haunts the fireteam, attacks now and then: actors/stalker.js)
  normal: '/models/zombies/normal.glb', // Mauler body variant (plain zombie)
  worker: '/models/zombies/worker.glb', // Worker (hard hat: some headshots glance off)
  survivor: '/models/zombies/survivor.glb', // Survivalist (rare, drops loot)
  // weapons
  m16a2: '/models/weapons/m16a2.glb',
  spas12: '/models/weapons/spas12.glb',
  r201: '/models/weapons/r201.glb',
  devotion: '/models/weapons/devotion.glb',
  sigma: '/models/weapons/sigma.glb',
  p90: '/models/weapons/p90.glb',
  mg42: '/models/weapons/mg42.glb', // its belt box built on (tools/blender/weapons_import.py mg42)
  mozambique: '/models/weapons/mozambique.glb',
  softball: '/models/weapons/softball.glb',
  molotov: '/models/weapons/molotov.glb',
  g36c: '/models/weapons/g36c.glb', // the user's AI models, normalized in tools/blender/weapons_import.py
  ak47: '/models/weapons/ak47.glb',
  awm: '/models/weapons/awm.glb',
  minigun: '/models/weapons/minigun.glb', // weaponDefs chaingun's model (the procedural chain gun stands in without it)
  axmc: '/models/weapons/axmc.glb',
  tomahawk: '/models/weapons/tomahawk.glb', // melee (tools/melee-import.mjs, player/meleeGlb.js)
  bat: '/models/weapons/bat.glb',
  arms: '/models/arms/arms.glb',
  // environment
  church: '/models/environment/church.glb',
};

export const GLB_URLS = Object.values(MODELS);
