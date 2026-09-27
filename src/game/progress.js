// The career, kept across runs (localStorage): experience and a rank on Combat Arms' ladder (Trainee up to General
// of the Army), weapon mastery (every weapon levels up with the kills made with it), the skins those unlock (weapon
// camos by mastery level, the player characters by rank and wins) and the wins per mode and difficulty (a Cabin
// Fever win on Extreme opens the Gauntlet). None of it changes the fight: it shows what you've done.
//   xp        kills (by type), headshots, rounds survived and the win, times the difficulty (XP_RULES)
//   rank      RANKS[i] by total xp
//   mastery   per weapon id: xp -> level 0..10 (MASTERY)
// A run: game.js calls runStart(), kill() / round() / win() as things happen (each returns what just went up, for
// the HUD), runEnd() for the after-action report. ui/career.js shows it; ui/insignia.js draws the ranks.
// Debug: __game.progress.grant(xp) · __game.progress.unlockAll().

const LS_KEY = 'cabinfever.career.v1';

export const RANKS = [
  { name: 'Trainee', short: 'TRN', xp: 0 },
  { name: 'Private', short: 'PVT', xp: 600 },
  { name: 'Private First Class', short: 'PFC', xp: 1800 },
  { name: 'Specialist', short: 'SPC', xp: 3600 },
  { name: 'Corporal', short: 'CPL', xp: 6000 },
  { name: 'Sergeant', short: 'SGT', xp: 9500 },
  { name: 'Staff Sergeant', short: 'SSG', xp: 14000 },
  { name: 'Sergeant First Class', short: 'SFC', xp: 20000 },
  { name: 'Master Sergeant', short: 'MSG', xp: 28000 },
  { name: 'First Sergeant', short: '1SG', xp: 38000 },
  { name: 'Sergeant Major', short: 'SGM', xp: 50000 },
  { name: 'Command Sergeant Major', short: 'CSM', xp: 65000 },
  { name: 'Second Lieutenant', short: '2LT', xp: 82000 },
  { name: 'First Lieutenant', short: '1LT', xp: 102000 },
  { name: 'Captain', short: 'CPT', xp: 125000 },
  { name: 'Major', short: 'MAJ', xp: 152000 },
  { name: 'Lieutenant Colonel', short: 'LTC', xp: 183000 },
  { name: 'Colonel', short: 'COL', xp: 220000 },
  { name: 'Brigadier General', short: 'BG', xp: 265000 },
  { name: 'Major General', short: 'MG', xp: 318000 },
  { name: 'Lieutenant General', short: 'LTG', xp: 380000 },
  { name: 'General', short: 'GEN', xp: 450000 },
  { name: 'General of the Army', short: 'GA', xp: 540000 },
];

// what earns xp: kills by type, headshots, each round survived (+ per round number), the win; `mult` by difficulty
// (the Gauntlet counts as its own, harder one)
export const XP_RULES = {
  kill: { mauler: 10, worker: 11, survivor: 25, charger: 14, striker: 16, crusher: 120, dog: 12, biter: 12, stalker: 150, merc: 60 },
  head: 5,
  round: [40, 5],
  win: 1500,
  mult: { easy: 0.8, hard: 1, extreme: 1.3, gauntlet: 1.5 },
};

// weapon mastery: xp per kill / headshot with it, the xp each level needs (level 10 is the top)
export const MASTERY = { kill: 10, head: 4, xp: [0, 300, 800, 1600, 2800, 4400, 6600, 9600, 13600, 19000, 26000] };

// weapon camos (player/skins.js paints them): unlocked for a weapon at its mastery `level`
export const WEAPON_SKINS = [
  { id: 'factory', name: 'FACTORY', level: 0 },
  { id: 'woodland', name: 'WOODLAND', level: 2 },
  { id: 'urban', name: 'URBAN DIGITAL', level: 4 },
  { id: 'tiger', name: 'DESERT TIGER', level: 6 },
  { id: 'crimson', name: 'CRIMSON', level: 8 },
  { id: 'gold', name: 'GOLD', level: 10 },
];

// who you are (the cutscenes, the store paperdoll): your own operator, or one of the fireteam once unlocked. body:
// gltfCharacter.js kind; bot: the fireteam character it takes the place of (that one can't be picked alongside)
export const CHARACTER_SKINS = [
  { id: 'emosquad', name: 'EMO SQUAD', body: 'emosquad', bot: null, unlock: null, how: 'Your own operator' },
  { id: 'scorpion', name: 'SCORPION', body: 'meshy', bot: 'meshy', unlock: { rank: 5 }, how: 'Reach the rank of Sergeant' },
  { id: 'viper', name: 'VIPER', body: 'viper', bot: 'viper', unlock: { win: ['hard', 'extreme'] }, how: 'Win Cabin Fever on Hard or Extreme' },
];

function load() {
  let p = null;
  try {
    p = JSON.parse(window.localStorage.getItem(LS_KEY) || 'null');
  } catch (_) {
    p = null;
  }
  const o = { xp: 0, kills: 0, headshots: 0, runs: 0, wins: {}, mastery: {}, skins: {}, character: 'emosquad', best: {} };
  if (p && typeof p === 'object') {
    const n = (v) => (typeof v === 'number' && isFinite(v) && v > 0 ? v : 0);
    o.xp = n(p.xp);
    o.kills = n(p.kills);
    o.headshots = n(p.headshots);
    o.runs = n(p.runs);
    if (p.wins && typeof p.wins === 'object') for (const [k, v] of Object.entries(p.wins)) o.wins[k] = n(v);
    if (p.mastery && typeof p.mastery === 'object') for (const [k, v] of Object.entries(p.mastery)) o.mastery[k] = n(v);
    if (p.skins && typeof p.skins === 'object') for (const [k, v] of Object.entries(p.skins)) if (WEAPON_SKINS.some((s) => s.id === v)) o.skins[k] = v;
    if (CHARACTER_SKINS.some((c) => c.id === p.character)) o.character = p.character;
    if (p.best && typeof p.best === 'object') o.best = { ...p.best };
    o.unlockAll = !!p.unlockAll;
  }
  return o;
}

let P = null;
const prof = () => (P ??= load());

function save() {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(prof()));
  } catch (_) {
    /* storage unavailable: the career lives for this session only */
  }
}

/** { index, rank, next (or null at the top), into (xp past this rank), span (xp to the next) } */
export function rankOf(xp = prof().xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
  const next = RANKS[i + 1] ?? null;
  return { index: i, rank: RANKS[i], next, into: xp - RANKS[i].xp, span: next ? next.xp - RANKS[i].xp : 1 };
}

/** a weapon's mastery: { level 0..10, xp, into, span (0 at the top) } */
export function masteryOf(id, xp = prof().mastery[id] ?? 0) {
  const T = MASTERY.xp;
  let lv = 0;
  while (lv + 1 < T.length && xp >= T[lv + 1]) lv++;
  const top = lv >= T.length - 1;
  return { level: lv, xp, into: xp - T[lv], span: top ? 0 : T[lv + 1] - T[lv] };
}

export function skinUnlocked(id, skin) {
  const s = WEAPON_SKINS.find((k) => k.id === skin);
  return !!s && (prof().unlockAll || masteryOf(id).level >= s.level);
}

/** the camo a weapon wears ('factory' unless another one is picked and unlocked) */
export function skinOf(id) {
  const s = prof().skins[id];
  return s && skinUnlocked(id, s) ? s : 'factory';
}

export function setSkin(id, skin) {
  if (!skinUnlocked(id, skin)) return false;
  prof().skins[id] = skin;
  save();
  return true;
}

export function characterUnlocked(id) {
  const c = CHARACTER_SKINS.find((k) => k.id === id);
  if (!c) return false;
  const p = prof();
  if (!c.unlock || p.unlockAll) return true;
  if (c.unlock.rank != null && rankOf().index >= c.unlock.rank) return true;
  if (c.unlock.win && c.unlock.win.some((d) => p.wins['cabinfever:' + d] > 0)) return true;
  return false;
}

/** the player's character skin (CHARACTER_SKINS entry) */
export function character() {
  const id = prof().character;
  return CHARACTER_SKINS.find((c) => c.id === id && characterUnlocked(id)) ?? CHARACTER_SKINS[0];
}

export function setCharacter(id) {
  if (!characterUnlocked(id)) return false;
  prof().character = id;
  save();
  return true;
}

/** the character skin a promotion to rank `index` unlocks (or null) */
export const characterForRank = (index) => CHARACTER_SKINS.find((c) => c.unlock?.rank === index) ?? null;

/** the Gauntlet opens with a Cabin Fever win on Extreme */
export function gauntletUnlocked() {
  const p = prof();
  return p.unlockAll || (p.wins['cabinfever:extreme'] ?? 0) > 0;
}

export const career = () => prof();

// ------------------------------------------------------------------ a run
let RUN = null;

/** a run begins: { mode, difficulty } */
export function runStart({ mode, difficulty }) {
  RUN = { mode, difficulty, key: mode === 'gauntlet' ? 'gauntlet' : difficulty, xp: 0, parts: { kills: 0, heads: 0, rounds: 0, win: 0 }, rank0: rankOf().index, mastery0: {}, weapons: {}, won: false };
}

const mult = () => XP_RULES.mult[RUN?.key] ?? 1;

function addXp(n, part) {
  if (!RUN || !(n > 0)) return null;
  const p = prof();
  const before = rankOf(p.xp).index;
  const v = Math.round(n * mult());
  p.xp += v;
  RUN.xp += v;
  RUN.parts[part] = (RUN.parts[part] ?? 0) + v;
  const after = rankOf(p.xp).index;
  return after > before ? RANKS[after] : null;
}

/**
 * a kill by the player: { type (zombie type or 'merc'), weapon (id), headshot }. Returns { rank (the new rank, if
 * promoted), mastery ({ weapon, level } if that weapon went up a level) }.
 */
export function kill({ type, weapon, headshot = false }) {
  if (!RUN) return {};
  const p = prof();
  p.kills++;
  if (headshot) p.headshots++;
  let rank = addXp(XP_RULES.kill[type] ?? 10, 'kills');
  if (headshot) rank = addXp(XP_RULES.head, 'heads') ?? rank;
  let mastery = null;
  if (weapon && weapon !== 'explosion' && weapon !== 'suicide') {
    const before = masteryOf(weapon).level;
    if (!(weapon in RUN.mastery0)) RUN.mastery0[weapon] = before;
    p.mastery[weapon] = (p.mastery[weapon] ?? 0) + MASTERY.kill + (headshot ? MASTERY.head : 0);
    RUN.weapons[weapon] = (RUN.weapons[weapon] ?? 0) + 1;
    const after = masteryOf(weapon).level;
    if (after > before) mastery = { weapon, level: after };
  }
  return { rank, mastery };
}

/** a round survived (its number) */
export function round(n) {
  const rank = addXp(XP_RULES.round[0] + XP_RULES.round[1] * n, 'rounds');
  if (RUN) save(); // (what the run has earned so far survives a closed tab)
  return { rank };
}

/** the run won */
export function win() {
  if (!RUN || RUN.won) return {};
  RUN.won = true;
  const p = prof();
  const k = RUN.mode + ':' + RUN.difficulty;
  p.wins[k] = (p.wins[k] ?? 0) + 1;
  return { rank: addXp(RUN.mode === 'gauntlet' ? XP_RULES.win * 2.5 : XP_RULES.win, 'win') };
}

/**
 * the run is over: the after-action report { xp, parts, rank, rankBefore, promoted, progress (0..1 to the next),
 * mastery: [{ weapon, kills, level, before, into, span }], unlocks: [{ kind: 'character' | 'mode' | 'camo', name,
 * weapon? }] } (null without a run)
 */
export function runEnd() {
  if (!RUN) return null;
  const p = prof();
  p.runs++;
  const r = rankOf(p.xp);
  const unlocks = [];
  for (const c of CHARACTER_SKINS) {
    if (c.unlock?.rank != null && r.index >= c.unlock.rank && RUN.rank0 < c.unlock.rank) unlocks.push({ kind: 'character', name: c.name });
    if (c.unlock?.win && RUN.won && RUN.mode === 'cabinfever' && c.unlock.win.includes(RUN.difficulty) && c.unlock.win.reduce((n, d) => n + (p.wins['cabinfever:' + d] ?? 0), 0) === 1) unlocks.push({ kind: 'character', name: c.name });
  }
  if (RUN.won && RUN.mode === 'cabinfever' && RUN.difficulty === 'extreme' && p.wins['cabinfever:extreme'] === 1) unlocks.push({ kind: 'mode', name: 'THE GAUNTLET' });
  const mastery = Object.entries(RUN.weapons)
    .sort((a, b) => b[1] - a[1])
    .map(([weapon, kills]) => {
      const m = masteryOf(weapon);
      const before = RUN.mastery0[weapon] ?? m.level;
      for (const s of WEAPON_SKINS) if (s.level > before && s.level <= m.level) unlocks.push({ kind: 'camo', id: s.id, name: s.name, weapon });
      return { weapon, kills, level: m.level, before, into: m.into, span: m.span };
    });
  const out = { xp: RUN.xp, parts: { ...RUN.parts }, rank: r.rank, rankIndex: r.index, rankBefore: RUN.rank0, promoted: r.index > RUN.rank0, progress: r.next ? r.into / r.span : 1, next: r.next, into: r.into, span: r.span, mastery, unlocks: unlocks.filter((u, i) => unlocks.findIndex((v) => v.kind === u.kind && v.name === u.name && v.weapon === u.weapon) === i) };
  RUN = null;
  save();
  return out;
}

export const inRun = () => !!RUN;

// ------------------------------------------------------------------ debug
export function grant(xp) {
  prof().xp += Math.max(0, xp | 0);
  save();
  return rankOf();
}

export function unlockAll(on = true) {
  prof().unlockAll = !!on;
  save();
  return on;
}
