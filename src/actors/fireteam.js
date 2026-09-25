// The AI fireteam roster as plain data, shared by the menu (character picker, briefing, leaderboard)
// and the game (one Teammate per entry, in this order). body: gltfCharacter.js GLB_BODIES kind or a
// procedural rig.js body; weapon: weaponDefs.js id of the signature gun (bot stats in teammate.js).
export const FIRETEAM = [
  { id: 'coach', name: 'Coach', body: 'coach', weapon: 'spas12', gun: 'SPAS-12', rank: 4 },
  { id: 'ellis', name: 'Ellis', body: 'ellis', weapon: 'm16a2', gun: 'M16A2', rank: 3 },
  { id: 'meshy', name: 'Scorpion', body: 'meshy', weapon: 'r201', gun: 'R-201', rank: 2 },
  { id: 'viper', name: 'Viper', body: 'viper', weapon: 'devotion', gun: 'DEVOTION', rank: 5 },
  { id: 'soldier', name: 'Soldier', body: 'soldier', weapon: 'm4a1', gun: 'M4A1', rank: 3 },
];

export const FIRETEAM_IDS = FIRETEAM.map((c) => c.id);
export const FIRETEAM_BY_ID = Object.fromEntries(FIRETEAM.map((c) => [c.id, c]));

// the pre-picker "fireteam size" (0-3) mapped to the bodies those team sizes used to get
export const LEGACY_LINEUPS = { 0: [], 1: ['viper'], 2: ['viper', 'meshy'], 3: ['coach', 'ellis', 'viper'] };

/** Valid, de-duplicated character ids in roster order. */
export function normalizeFireteam(ids) {
  if (!Array.isArray(ids)) return null;
  const set = new Set(ids.map(String));
  return FIRETEAM_IDS.filter((id) => set.has(id));
}
