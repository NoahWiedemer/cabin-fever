// Game modes and difficulties as plain data, shared by the menu (briefing text) and the game
// (rules). Numbers that tune the fight (hp, damage, counts) stay in game.js DIFF.

export const MODES = {
  cabinfever: {
    id: 'cabinfever',
    name: 'CABIN FEVER',
    kicker: 'FIRETEAM',
    tagline: 'Hold the farmhouse until extraction arrives at dawn.',
    desc: 'The original Fireteam mode. Survive a fixed number of waves (10 / 15 / 20 by difficulty), then the chopper comes at first light.',
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
};

export const MODE_LIST = [MODES.cabinfever, MODES.endless];

// Unlock rounds: the upstairs (bedrooms, the Golden Punisher, the balcony over the yard) after round 6 on
// every difficulty, the basement from round 10 on hard+. Endless opens both on the same rounds.
export const UPSTAIRS_ROUND = 7;
export const BASEMENT_ROUND = 10;
// rounds / minutes mirror game.js DIFF (Cabin Fever only; endless has neither).
export const DIFFICULTIES = [
  { id: 'easy', name: 'EASY', rounds: 10, minutes: 30, skulls: 1, desc: 'Fewer, weaker Infected. Upstairs opens at round 7.', edesc: 'Fewer, weaker Infected.' },
  { id: 'hard', name: 'HARD', rounds: 15, minutes: 45, skulls: 2, desc: 'The real thing. Upstairs at 7, basement at 10.', edesc: 'The horde at full strength.' },
  { id: 'extreme', name: 'EXTREME', rounds: 20, minutes: 60, skulls: 3, desc: 'Tougher, faster horde. Upstairs at 7, basement at 10.', edesc: 'Tougher, faster, hungrier Infected.' },
];

/** Floors that open during a run: [{ round, name }]. */
export function unlocksFor(modeId, diffId) {
  const endless = MODES[modeId]?.endless;
  const rounds = DIFFICULTIES.find((d) => d.id === diffId)?.rounds ?? 15;
  const out = [];
  if (endless || rounds >= UPSTAIRS_ROUND) out.push({ round: UPSTAIRS_ROUND, name: 'UPSTAIRS' });
  if (endless || rounds >= 15) out.push({ round: BASEMENT_ROUND, name: 'BASEMENT' });
  return out;
}

// Wave timeline for the briefing ("round: what happens").
export const THREATS = [
  { round: 1, name: 'MAULERS', text: 'The standard Infected' },
  { round: 2, name: 'BOOMERS', text: 'Strapped with dynamite: shoot the charge' },
  { round: 3, name: 'MUTANT DOGS', text: 'Fast, low and in packs' },
  { round: 4, name: 'BITERS', text: 'Packs that pounce onto your back: mash V' },
  { round: 5, name: 'STRIKERS', text: 'Leaping, and they drop live shells' },
  { round: 11, name: 'CRUSHERS', text: 'Armored tanks that leave acid behind' },
];
