// Crowd-level decisions for the infected, shared by every zombie (game.horde):
//   * routes: a zombie outside the house whose target is inside picks one of the house entrances
//     (level.entrances: front door, back door, kitchen hole, the cellar once open, a breach...). Each
//     entrance has its own flow field toward a point just inside it (infected costs, so a barricade
//     makes it dearer). Any entrance whose path is within a slack of the shortest one is fair game; the
//     pick weighs the path length, a personal bias per zombie and how many are already headed that way,
//     so a wave splits over the entrances and closes in from several sides instead of queueing at one.
//     A barricaded entrance (and the queue at it) counts extra: the first ones claw at it, the rest go
//     round if another way in isn't far off. Boomers make for barricades, Biters (no claws) avoid them.
//   * attackers: how many infected are on each survivor right now (zombie.js spreads the rest).
import { HOUSE } from '../world/level.js';

const SLACK = 10; // cells (x0.5 m) over the shortest entrance a route may cost, plus 20 % of it
const LOAD = 3.5; // cells of penalty per zombie already routed through an entrance
const BIAS = 9; // cells: max personal preference per entrance (fixed per zombie)
const KEEP = 6; // cells a new route must beat the current one by
const BARR = 30; // cells: an intact barricade across an entrance (on top of its nav cost), scaled by its hp

/** inside the house walls (any floor) */
export function inHouse(p) {
  return p.x > HOUSE.minX + 0.25 && p.x < HOUSE.maxX - 0.25 && p.z > HOUSE.minZ + 0.25 && p.z < HOUSE.maxZ - 0.25;
}

export class Horde {
  constructor(game) {
    this.game = game;
    this.fields = new Map(); // key (entrance + portal state) -> route field
    this.load = new Map(); // entrance -> zombies routed through it that are still outside
    this.attackers = new Map(); // survivor -> zombies on it within 2.6 m
  }

  get entrances() {
    return this.game.level?.entrances ?? [];
  }

  /** portals opened / closed, a breach: routes are rebuilt on demand */
  reset() {
    this.fields.clear();
  }

  _open(e) {
    if (e.portal) {
      const p = this.game.level.portals.find((q) => q.id === e.portal);
      if (!p?.enabled) return false;
    }
    return e.enabled !== false;
  }

  _key(e) {
    return e.id + ':' + (this._sig ?? '');
  }

  /**
   * The route field toward entrance `e` for the current portal state, or null while it isn't built yet
   * (update() builds one missing field per frame; barricades.js re-flows them when planks go up / down).
   */
  fieldFor(e) {
    return this.fields.get(this._key(e)) ?? null;
  }

  _inCell(e) {
    const nav = this.game.nav;
    if (e._cell === undefined || e._cellV !== nav.version) {
      e._cell = nav.nearestWalkable(e.level ?? 1, e.x, e.z, 3);
      e._cellV = nav.version;
    }
    return e._cell;
  }

  /** once per frame, before the zombies move */
  update(list) {
    const g = this.game;
    this._sig = g.level.portals.map((p) => (p.enabled ? 1 : 0)).join('');
    // build a missing route field (one per frame: a flow field is a few ms)
    for (const e of this.entrances) {
      if (!this._open(e) || this.fields.has(this._key(e))) continue;
      const f = g.nav.makeField([{ level: e.level ?? 1, x: e.x, z: e.z }], { infected: true });
      f.entrance = e;
      this.fields.set(this._key(e), f);
      break;
    }
    this.load.clear();
    this.attackers.clear();
    for (const z of list) {
      if (!z.alive) continue;
      if (z.route) this.load.set(z.route, (this.load.get(z.route) ?? 0) + 1);
      const t = z.target;
      if (t && Math.abs(t.pos.x - z.pos.x) < 2.6 && Math.abs(t.pos.z - z.pos.z) < 2.6 && Math.abs(t.pos.y - z.pos.y) < 1.2) this.attackers.set(t, (this.attackers.get(t) ?? 0) + 1);
    }
  }

  /**
   * The entrance zombie `z` should come in by, or null (follow the main field): only from outside the
   * house toward a target inside it.
   */
  pickRoute(z) {
    const g = this.game, nav = g.nav, tgt = z.target;
    if (!tgt || !inHouse(tgt.pos) || inHouse(z.pos) || z.level !== 1) return null;
    const zi = nav.index(1, z.pos.x, z.pos.z);
    if (zi < 0 || !(nav.dist[zi] < Infinity)) return z.route;
    const bias = (z.routeBias ??= {});
    const bar = g.barricades;
    let minEff = Infinity;
    const opts = [];
    for (const e of this.entrances) {
      if (!this._open(e)) continue;
      const ei = this._inCell(e);
      const f = this.fieldFor(e);
      if (ei < 0 || !f) continue;
      const d2 = nav.dist[ei];
      const d1 = f.dist[zi];
      if (!(d1 < Infinity && d2 < Infinity)) continue;
      const own = z.route === e ? 1 : 0; // don't count itself as traffic
      const spot = bar?.spot?.(e.barricade ?? e.id);
      // Boomers don't mind a barricade (they blow it in), Biters can't claw one down
      const barr = spot?.hp > 0 ? BARR * (0.4 + (0.6 * spot.hp) / spot.maxHp) * (z.type.explodes ? 0 : z.type.claws === false ? 3 : 1) : 0;
      const eff = d1 + d2 + barr + ((this.load.get(e) ?? 0) - own) * LOAD;
      minEff = Math.min(minEff, eff);
      bias[e.id] ??= Math.random() * BIAS * (e.bias ?? 1);
      opts.push({ e, eff, score: eff + bias[e.id] - own * KEEP + (z.routePenalty?.[e.id] ?? 0) });
    }
    let best = null, bs = Infinity;
    for (const o of opts) {
      if (o.eff > minEff + SLACK + minEff * 0.2) continue;
      if (o.score < bs) {
        bs = o.score;
        best = o.e;
      }
    }
    return best;
  }

  /** has `z` come far enough along its route to follow the main field? */
  arrived(z) {
    const e = z.route;
    if (!e) return true;
    if (!this._open(e)) return true;
    if (inHouse(z.pos)) return true;
    return z.level === (e.level ?? 1) && Math.hypot(z.pos.x - e.x, z.pos.z - e.z) < 1.2;
  }

  /**
   * Spread the swarm: a zombie not yet on its target (`best`, already mobbed by `crowd`+) switches to
   * another survivor in the open on its floor that is about as close and has fewer on it.
   */
  balance(z, best, team, crowd = 4) {
    const n = this.attackers.get(best) ?? 0;
    if (n < crowd) return best;
    const p = z.pos;
    const d0 = Math.hypot(best.pos.x - p.x, best.pos.z - p.z);
    if (d0 < 2.6) return best;
    const nav = this.game.nav;
    let pick = best, ps = d0 + n * 1.5;
    for (const m of team) {
      if (m === best || !m.alive || m.level !== z.level) continue;
      const d = Math.hypot(m.pos.x - p.x, m.pos.z - p.z);
      if (d > d0 * 1.5 + 3) continue;
      const s = d + (this.attackers.get(m) ?? 0) * 1.5;
      if (s + 1 < ps && nav.lineClear(z.level, p.x, p.z, m.pos.x, m.pos.z, 1, nav.dist, nav.cost)) {
        ps = s;
        pick = m;
      }
    }
    return pick;
  }
}
