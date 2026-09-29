// Game modes and difficulties as plain data, shared by the menu (briefing text) and the game
// (rules). Numbers that tune the fight (hp, damage, counts) stay in game.js DIFF.

export const MODES = {
  cabinfever: {
    id: 'cabinfever',
    name: 'CABIN FEVER',
    kicker: 'FIRETEAM',
    tagline: 'Bring the reagent to Dr. Nadja, sealed in a lab somewhere under the farm.',
    desc: 'The story: dropped at the farm by helicopter, hold the house while Command traces Nadja, find her lab, hack its vault door open and deliver the reagent. 15 waves on every difficulty.',
    endless: false,
  },
  endless: {
    id: 'endless',
    name: 'ENDLESS',
    kicker: 'LAST STAND',
    tagline: 'No chopper is coming. See how long you last.',
    desc: 'The waves never stop: every round brings more, tougher and faster Infected. No time limit, no victory, only the round you reach.',
    endless: true,
  },
  // the roguelike run (game/rogue.js), open from the start
  gauntlet: {
    id: 'gauntlet',
    name: 'THE GAUNTLET',
    kicker: 'ROGUE RUN',
    tagline: 'No shop. Every round: draw a card, then take a curse.',
    desc: 'Fifteen waves at Extreme strength, no story and no gun shop. After every round pick a weapon, a perk or supplies, then choose the curse that makes the rest of the run harder.',
    endless: false,
    rogue: true, // cards instead of the store
    story: false, // no cutscenes, no hack: survive round 15 and it's won
    timer: false, // no time limit
    difficulty: 'extreme', // always
  },
};

export const MODE_LIST = [MODES.cabinfever, MODES.endless, MODES.gauntlet];

// Unlock rounds: the upstairs (bedrooms, the Golden Punisher, the balcony over the yard) with round 4, the
// basement (and in the story Nadja's lab behind it) with round 10, on every difficulty and in endless.
export const UPSTAIRS_ROUND = 4;
export const BASEMENT_ROUND = 10;
// rounds / minutes mirror game/mission.js STORY (Cabin Fever only; endless has neither); the numbers that
// make a difficulty easier or harder are game.js DIFF.
export const DIFFICULTIES = [
  { id: 'easy', name: 'EASY', rounds: 15, minutes: 60, skulls: 1, desc: 'Weaker Infected, you take less damage, cheaper store, more starting cash.', edesc: 'Fewer, weaker Infected. Cheaper store.' },
  { id: 'hard', name: 'HARD', rounds: 15, minutes: 60, skulls: 2, desc: 'The real thing: the horde at full strength.', edesc: 'The horde at full strength.' },
  { id: 'extreme', name: 'EXTREME', rounds: 15, minutes: 60, skulls: 3, desc: 'Tougher, faster horde that hits harder. Dearer store, a longer hack.', edesc: 'Tougher, faster, hungrier Infected.' },
];

/** What opens during a run: [{ round, name }]. map: world/maps.js (its `unlocks`); none: the farm's floors. */
export function unlocksFor(modeId, diffId, map = null) {
  const endless = MODES[modeId]?.endless;
  const story = !endless && MODES[modeId]?.story !== false && map?.story !== false;
  const rounds = DIFFICULTIES.find((d) => d.id === diffId)?.rounds ?? 15;
  const list = map?.unlocks ?? [{ round: UPSTAIRS_ROUND, name: 'UPSTAIRS' }, { round: BASEMENT_ROUND, name: 'BASEMENT', story: 'BASEMENT · LAB' }];
  return list.filter((u) => endless || rounds >= u.round).map((u) => ({ round: u.round, name: story && u.story ? u.story : u.name }));
}

// Wave timeline for the briefing ("round: what happens").
export const THREATS = [
  { round: 1, name: 'MAULERS', text: 'The standard Infected' },
  { round: 2, name: 'BOOMERS', text: 'Bloated, they burst: shoot them early' },
  { round: 3, name: 'MUTANT DOGS', text: 'Fast, low and in packs' },
  { round: 4, name: 'BITERS', text: 'Packs that pounce onto your back: mash V' },
  { round: 5, name: 'STRIKERS', text: 'Leaping, and they drop live shells' },
  { round: 11, name: 'CRUSHERS', text: 'Armored tanks that leave acid behind' },
];
