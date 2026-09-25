/*
 * Local leaderboard: every finished run (extraction, overrun, time out, a quit after round 1+, the end
 * of an Endless run) goes into localStorage under a versioned key, best 50 per mode × difficulty, plus
 * the player's callsign. Storage can be missing or blocked (private mode, disabled site data), so every
 * access is guarded and the game keeps working without it. Local only: nothing leaves the browser.
 */
import { MODES, DIFFICULTIES } from '../game/modes.js';
import { FIRETEAM_IDS } from '../actors/fireteam.js';

const LS_BOARD = 'cabinfever.leaderboard.v1';
const LS_PROFILE = 'cabinfever.profile.v1';
const VERSION = 1;
export const BOARD_SIZE = 50;
export const DEFAULT_NAME = 'Player';
export const NAME_MAX = 16;
export const OUTCOMES = { victory: 'EXTRACTED', overrun: 'OVERRUN', timeout: 'TIME UP', quit: 'QUIT' };

function read(key) {
  try {
    const s = window.localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

function write(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false; // unavailable or full: the run just isn't kept
  }
}

export const boardKey = (mode, difficulty) => `${mode}:${difficulty}`;

/** Printable callsign: no control characters or markup brackets, single spaces, at most NAME_MAX. */
export function sanitizeName(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

export function getPlayerName() {
  return sanitizeName(read(LS_PROFILE)?.name) || DEFAULT_NAME;
}

export function setPlayerName(name) {
  const n = sanitizeName(name) || DEFAULT_NAME;
  write(LS_PROFILE, { v: 1, name: n });
  return n;
}

const int = (v, lo, hi) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
};

function cleanRecord(r) {
  if (!r || typeof r !== 'object') return null;
  if (!MODES[r.mode] || !DIFFICULTIES.some((d) => d.id === r.difficulty)) return null;
  const date = Number(r.date);
  if (!Number.isFinite(date) || date <= 0) return null;
  const acc = r.accuracy == null ? null : Number(r.accuracy);
  const team = Array.isArray(r.team) ? r.team.filter((id) => FIRETEAM_IDS.includes(id)) : [];
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 24) : `r${date.toString(36)}`,
    name: sanitizeName(r.name) || DEFAULT_NAME,
    score: int(r.score, 0, 1e9),
    round: int(r.round, 0, 9999),
    kills: int(r.kills, 0, 1e7),
    headshots: int(r.headshots, 0, 1e7),
    accuracy: acc == null || !Number.isFinite(acc) ? null : Math.min(1, Math.max(0, acc)),
    time: int(r.time, 0, 1e7),
    mode: r.mode,
    difficulty: r.difficulty,
    team: [...new Set(team)],
    outcome: OUTCOMES[r.outcome] ? r.outcome : 'overrun',
    date,
  };
}

// best score first; ties go to the deeper round, then to whoever set it first
const byRank = (a, b) => b.score - a.score || b.round - a.round || a.date - b.date;

function load() {
  const data = { v: VERSION, boards: {}, last: null };
  const raw = read(LS_BOARD);
  if (!raw || typeof raw !== 'object' || raw.v !== VERSION || !raw.boards || typeof raw.boards !== 'object') return data;
  for (const [key, list] of Object.entries(raw.boards)) {
    if (!Array.isArray(list)) continue;
    const clean = list.map(cleanRecord).filter((r) => r && boardKey(r.mode, r.difficulty) === key);
    if (clean.length) data.boards[key] = clean.sort(byRank).slice(0, BOARD_SIZE);
  }
  if (typeof raw.last === 'string') data.last = raw.last;
  return data;
}

/** Ranked runs of one board (copies). */
export function topRuns(mode, difficulty) {
  return (load().boards[boardKey(mode, difficulty)] ?? []).map((r) => ({ ...r }));
}

/** { 'mode:difficulty': count } for the filter tabs, plus the id of the latest recorded run. */
export function summary() {
  const data = load();
  const counts = {};
  for (const [k, list] of Object.entries(data.boards)) counts[k] = list.length;
  return { counts, last: data.last };
}

/**
 * Store a finished run (game.js runStats()). Returns { record, key, rank (1-based, null when it
 * didn't make the top BOARD_SIZE), best (a new #1 with points on the board), saved } or null.
 */
export function recordRun(stats, name = getPlayerName()) {
  if (!stats || typeof stats !== 'object') return null;
  const now = Date.now();
  const record = cleanRecord({
    id: `${now.toString(36)}${Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')}`,
    name,
    score: stats.score,
    round: stats.roundReached ?? stats.rounds,
    kills: stats.kills,
    headshots: stats.headshots,
    accuracy: stats.accuracy,
    time: stats.timeSeconds,
    mode: stats.mode,
    difficulty: stats.difficulty,
    team: stats.fireteam,
    outcome: stats.outcome ?? (stats.victory ? 'victory' : 'overrun'),
    date: now,
  });
  if (!record) return null;
  const data = load();
  const key = boardKey(record.mode, record.difficulty);
  const list = data.boards[key] ?? [];
  list.push(record);
  list.sort(byRank);
  const at = list.indexOf(record) + 1;
  const rank = at <= BOARD_SIZE ? at : null;
  data.boards[key] = list.slice(0, BOARD_SIZE);
  if (rank) data.last = record.id;
  const saved = write(LS_BOARD, data);
  return { record, key, rank: saved ? rank : null, best: saved && rank === 1 && record.score > 0, saved };
}
