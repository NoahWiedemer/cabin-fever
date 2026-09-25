// Revives. A fireteam member who goes down (the player or a bot) stays revivable for REVIVE.window s
// (a pulsing marker over the body, a HUD waypoint and a radar blip for the player). Each character
// can be revived once per round; a second death that round (or an expired window) means waiting for
// the round end, as before.
//   * the player revives a bot: hold F within REVIVE.reach m of the body for reviveTime() s (a kneel,
//     both hands pressing down on the body). Letting go, moving away or taking damage cancels it.
//   * bots revive the player and each other: when someone is down and the body isn't swarmed, the
//     nearest free bot runs over, kneels and channels. Getting hit hard or infected closing in makes it
//     give up (it tries again a bit later). One bot revives at a time; the rest keep defending.
//   * revived: up with reviveHp() HP (armor as it was when they fell), REVIVE.invuln s invulnerable,
//     a kill-feed line. The player keeps the weapons, ammo and gear they had.
// reviveTime / reviveHp are the tuning hooks (the store defibrillator, game/gear.js, plugs in there).
import * as THREE from 'three';
import { levelOf } from '../world/level.js';
import { damp, dampAngle } from '../core/utils.js';
import { DEFIB, defibFor } from './gear.js';

export const REVIVE = {
  window: 15, // s a body stays revivable
  channel: 3.0, // s of kneeling
  hp: 20, // HP after a revive
  invuln: 1.5, // s invulnerable after getting up
  reach: 1.5, // m (player) from the body to start
  keep: 2.1, // m (player) moving further than this cancels
  botReach: 0.95, // m a bot kneels from the body
  botSpeed: 4.6, // m/s a bot runs to the body
  safeR: 4.5, // a bot only goes if at most `safeMax` infected are within safeR m of the body...
  safeMax: 1,
  dangerR: 2.2, // ...and none within dangerR m (of the body or the bot: gives up when that happens)
  botHit: 18, // HP a kneeling bot can lose before it gives up
  retry: 2.5, // s before a bot tries the same body again
};

/** Channel seconds for `reviver` bringing `target` back. */
export function reviveTime(game, reviver, target) {
  let t = REVIVE.channel;
  if (defibFor(game, reviver, target)) t *= DEFIB.channel;
  return t;
}

/** HP `target` gets up with. */
export function reviveHp(game, target, reviver) {
  return defibFor(game, reviver, target) ? DEFIB.hp : REVIVE.hp;
}

const _v = new THREE.Vector3();
const _steer = { dirX: 0, dirZ: 0, portal: null, portalTo: null, dist: 0 };
const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function markerTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,0.8)';
  g.shadowBlur = 8;
  g.strokeStyle = '#7dffa0';
  g.lineWidth = 9;
  g.beginPath();
  g.arc(64, 64, 48, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#e8fff0';
  g.fillRect(52, 30, 24, 68);
  g.fillRect(30, 52, 68, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Revives {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.downed = []; // { m, t, pos, level, ap, marker, ch: { by } | null, retryT }
    this.task = null; // the one bot revive run: { bot, rec, phase 'go'|'kneel', t, dur, hp0, best, stuckT, field }
    this.player = null; // the player's own channel on a bot: { rec, t, dur, hp0 }
    this.prompt = null;
    this.hold = null;
    this.holdLabel = null;
    this.tex = markerTexture();
    this.markers = [];
  }

  reset() {
    for (const r of this.downed) this._freeMarker(r.marker);
    this.downed = [];
    this.task = null;
    this._endPlayer();
    for (const m of this.game.team ?? []) {
      m.revivedThisRound = false;
      m.invulnT = 0;
    }
  }

  /** A new round: everyone may be revived once again. */
  onRoundStart() {
    for (const m of this.game.team ?? []) m.revivedThisRound = false;
  }

  /** Round over: the dead get back up anyway (game._endRound). */
  onRoundEnd() {
    for (const r of this.downed) this._freeMarker(r.marker);
    this.downed = [];
    this.task = null;
    this._endPlayer();
  }

  /** Someone fell. Returns true if they can be revived. */
  onDeath(m) {
    const g = this.game;
    if (!g.running || g.state === 'victory' || g.state === 'defeat') return false;
    this._drop(this.downed.findIndex((r) => r.m === m));
    if (this.player && this.player.rec.m === m) this._endPlayer();
    if (m.revivedThisRound) return false; // once per round
    const rec = { m, t: 0, pos: m.pos.clone(), level: levelOf(m.pos.y + 0.3), ap: Math.max(0, m.ap ?? 0), marker: this._marker(), ch: null, retryT: 0 };
    this.downed.push(rec);
    return true;
  }

  recordOf(m) {
    return this.downed.find((r) => r.m === m) ?? null;
  }

  /** In reach of a downed teammate: F is the revive (held), never the flashlight. */
  fOwned(player) {
    return !!this.player || !!this._nearFor(player);
  }

  _nearFor(p) {
    if (!p?.alive || p.climbing) return null;
    let best = null, bd = REVIVE.reach;
    for (const r of this.downed) {
      if (r.m === p || r.ch || Math.abs(r.pos.y - p.pos.y) > 1.2) continue;
      const d = hdist(r.pos, p.pos);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- markers
  _marker() {
    let s = this.markers.find((m) => !m.userData.used);
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex, color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, fog: false }));
      s.renderOrder = 30;
      this.scene.add(s);
      this.markers.push(s);
    }
    s.userData.used = true;
    s.visible = true;
    return s;
  }

  _freeMarker(s) {
    if (!s) return;
    s.userData.used = false;
    s.visible = false;
  }

  _drop(i) {
    if (i < 0) return;
    const r = this.downed[i];
    this._freeMarker(r.marker);
    this.downed.splice(i, 1);
    if (this.task?.rec === r) this.task = null;
    if (this.player?.rec === r) this._endPlayer();
  }

  // ---------------------------------------------------------------- update
  update(dt, input) {
    const g = this.game;
    this.prompt = null;
    this.hold = null;
    this.holdLabel = null;
    for (const m of g.team) if (m.invulnT > 0) m.invulnT = Math.max(0, m.invulnT - dt);
    if (g.state === 'victory' || g.state === 'defeat') {
      if (this.downed.length || this.player) this.onRoundEnd(); // it's over: no markers on the end screen
      return;
    }
    const time = g.time;
    for (let i = this.downed.length - 1; i >= 0; i--) {
      const r = this.downed[i];
      if (r.m.alive || !g.team.includes(r.m)) {
        this._drop(i);
        continue;
      }
      r.t += dt;
      r.retryT -= dt;
      r.pos.copy(r.m.pos);
      if (r.t >= REVIVE.window) {
        if (r.m.isPlayer) g.hud?.banner('NO REVIVE', 'You will respawn at the end of the round', 2.5, 'danger');
        this._drop(i);
        continue;
      }
      // marker over the body: pulses, blinks through the last 5 s, steady while someone is on it
      const s = r.marker;
      const left = REVIVE.window - r.t;
      const pulse = 0.5 + 0.5 * Math.sin(time * 6);
      s.position.set(r.pos.x, r.pos.y + (r.m.isPlayer ? 0.75 : 0.95), r.pos.z);
      s.scale.setScalar(r.ch ? 0.42 : 0.36 + pulse * 0.07);
      s.material.opacity = r.ch ? 1 : left < 5 ? (Math.sin(time * 14) > 0 ? 0.95 : 0.25) : 0.7 + pulse * 0.3;
      s.material.color.setRGB(r.ch ? 0.75 : 1, 1, r.ch ? 0.8 : 1);
      // not over your own body (you're watching from it) nor right under your hands
      s.visible = !r.m.isPlayer && !r.ch?.by?.isPlayer;
    }
    if (this.task && (!this.task.bot.alive || !this.downed.includes(this.task.rec))) this._endTask();
    this._playerRevive(dt, input);
    if (!this.task) this._assign();
  }

  // ---------------------------------------------------------------- the player reviving a bot
  _playerRevive(dt, input) {
    const g = this.game, p = g.player, w = g.weapons;
    let ch = this.player;
    if (ch) {
      const r = ch.rec;
      const cancel = !p.alive || !this.downed.includes(r) || !input?.down('KeyF') || hdist(p.pos, r.pos) > REVIVE.keep || p.hp < ch.hp0 - 0.01;
      if (cancel) {
        this._endPlayer();
        ch = null;
      }
    }
    if (!ch) {
      const near = this._nearFor(p);
      if (!near) return;
      const name = near.m.name.toUpperCase();
      this.prompt = `Hold [F] to revive ${name}`;
      if (!input?.down('KeyF') || w.tool) return;
      ch = this.player = { rec: near, t: 0, dur: reviveTime(g, p, near.m), hp0: p.hp };
      near.ch = { by: p };
      w.beginTool('hands');
      g.audio.play('revive_start', { position: near.pos, volume: 0.7 });
    }
    const r = ch.rec;
    ch.t += dt;
    w.toolT = ch.t;
    p.kneel = true;
    p.noSprint = true;
    this.hold = Math.min(1, ch.t / ch.dur);
    this.holdLabel = `REVIVING ${r.m.name.toUpperCase()}`;
    this.prompt = `Hold [F] to revive ${r.m.name.toUpperCase()}`;
    if (ch.t >= ch.dur) {
      this._endPlayer();
      this._revive(r, p);
    }
  }

  _endPlayer() {
    const ch = this.player;
    if (!ch) return;
    this.player = null;
    if (ch.rec.ch?.by === this.game.player) ch.rec.ch = null;
    const p = this.game.player;
    if (p) p.kneel = false;
    if (this.game.weapons?.tool === 'hands') this.game.weapons.endTool();
  }

  // ---------------------------------------------------------------- bots
  _danger(pos, r = REVIVE.dangerR) {
    for (const z of this.game.zombies?.list ?? []) {
      if (!z.alive || Math.abs(z.pos.y - pos.y) > 1.6) continue;
      if (hdist(z.pos, pos) < r) return true;
    }
    return false;
  }

  _safe(pos) {
    let n = 0;
    for (const z of this.game.zombies?.list ?? []) {
      if (!z.alive || Math.abs(z.pos.y - pos.y) > 1.6) continue;
      const d = hdist(z.pos, pos);
      if (d < REVIVE.dangerR) return false;
      if (d < REVIVE.safeR && ++n > REVIVE.safeMax) return false;
    }
    return true;
  }

  /** Send the nearest free bot to the most urgent body (the player's first). */
  _assign() {
    const g = this.game;
    const recs = this.downed.filter((r) => !r.ch && r.retryT <= 0 && r.t < REVIVE.window - 1.5).sort((a, b) => (b.m.isPlayer ? 1 : 0) - (a.m.isPlayer ? 1 : 0) || a.t - b.t);
    for (const r of recs) {
      if (!this._safe(r.pos)) continue;
      let best = null, bd = Infinity;
      for (const b of g.team) {
        if (b.isPlayer || !b.alive || b === r.m || b.latchedBy || b.hp < 20) continue;
        if (Math.abs(b.pos.y - r.pos.y) > 1.5 && levelOf(b.pos.y + 0.3) !== r.level) {
          // other floor: the path goes round by the stairs, count it long
          const d = hdist(b.pos, r.pos) * 1.5 + 8;
          if (d < bd) {
            bd = d;
            best = b;
          }
          continue;
        }
        const d = hdist(b.pos, r.pos) * 1.3;
        if (d < bd) {
          bd = d;
          best = b;
        }
      }
      if (!best) continue;
      // can it get there and finish in time?
      if (bd / REVIVE.botSpeed + reviveTime(g, best, r.m) > REVIVE.window - r.t - 0.3) continue;
      this.task = { bot: best, rec: r, phase: 'go', t: 0, dur: 0, hp0: best.hp, best: Infinity, stuckT: 0, field: g.navFieldFor?.({ pos: r.pos.clone(), level: r.level }) ?? null };
      best.target = null;
      return;
    }
  }

  _endTask(retry = 0) {
    const tk = this.task;
    if (!tk) return;
    this.task = null;
    if (tk.rec.ch?.by === tk.bot) tk.rec.ch = null;
    if (retry) tk.rec.retryT = retry;
    tk.bot.crouch = 0;
  }

  /**
   * Teammate.update hook: drives the bot on a revive run (true), else leaves it to its own AI (false).
   */
  botUpdate(bot, dt) {
    const tk = this.task;
    if (!tk || tk.bot !== bot) return false;
    const g = this.game, r = tk.rec;
    if (!this.downed.includes(r) || !bot.alive || bot.latchedBy || (r.ch && r.ch.by !== bot)) {
      this._endTask(); // gone, or someone else (you) is already on it
      return false;
    }
    if (this._danger(r.pos) || this._danger(bot.pos)) {
      this._endTask(REVIVE.retry);
      return false;
    }
    const pos = bot.pos, b = bot.body;
    bot.level = levelOf(pos.y + 0.3);
    bot.target = null;
    bot.hurtT -= dt;
    const d = hdist(pos, r.pos);
    let wantX = 0, wantZ = 0, speed = 0, faceYaw = bot.yaw;
    if (tk.phase === 'go') {
      if (d <= REVIVE.botReach && bot.level === r.level) {
        tk.phase = 'kneel';
        tk.t = 0;
        tk.dur = reviveTime(g, bot, r.m);
        tk.hp0 = bot.hp;
        r.ch = { by: bot };
        if (r.m.isPlayer) g.spectate = bot; // watch your rescuer
        g.audio.play('revive_start', { position: r.pos, volume: 0.6 });
      } else {
        const st = tk.field?.steer(bot.level, pos.x, pos.z, _steer);
        if (st && Math.abs(st.dirX) + Math.abs(st.dirZ) > 1e-3 && !(d < 1.6 && bot.level === r.level)) {
          wantX = st.dirX;
          wantZ = st.dirZ;
        } else {
          wantX = r.pos.x - pos.x;
          wantZ = r.pos.z - pos.z;
        }
        const l = Math.hypot(wantX, wantZ) || 1;
        wantX /= l;
        wantZ /= l;
        speed = d < 1.6 ? 2.2 : REVIVE.botSpeed;
        faceYaw = Math.atan2(wantX, wantZ);
        // no headway for a while (blocked): give up for now
        if (d < tk.best - 0.25) {
          tk.best = d;
          tk.stuckT = 0;
        } else if ((tk.stuckT += dt) > 3) {
          this._endTask(REVIVE.retry * 2);
          return false;
        }
      }
    }
    if (tk.phase === 'kneel') {
      faceYaw = Math.atan2(r.pos.x - pos.x, r.pos.z - pos.z);
      tk.t += dt;
      if (bot.hp < tk.hp0 - REVIVE.botHit) {
        this._endTask(REVIVE.retry);
        return false;
      }
      if (tk.t >= tk.dur) {
        this.task = null;
        r.ch = null;
        this._revive(r, bot);
      }
    }
    b.vel.x = damp(b.vel.x, wantX * speed, 10, dt);
    b.vel.z = damp(b.vel.z, wantZ * speed, 10, dt);
    _v.copy(pos);
    g.world.moveBody(b, dt);
    const mv = Math.hypot(pos.x - _v.x, pos.z - _v.z) / Math.max(dt, 1e-4);
    bot.moveSpeed = damp(bot.moveSpeed ?? 0, mv, 10, dt);
    bot.yaw = dampAngle(bot.yaw, faceYaw, 8, dt);
    bot.root.rotation.y = bot.yaw;
    const kneel = tk.phase === 'kneel' && this.task === tk;
    bot.crouch = damp(bot.crouch ?? 0, kneel ? 1 : 0, 6, dt);
    bot.aimPitch = damp(bot.aimPitch ?? 0, kneel ? -0.55 : 0, 6, dt);
    bot.recoil = damp(bot.recoil ?? 0, 0, 14, dt);
    bot._animate(dt);
    return true;
  }

  // ---------------------------------------------------------------- back up
  _revive(r, by) {
    const g = this.game, m = r.m;
    const i = this.downed.indexOf(r);
    if (i >= 0) {
      this._freeMarker(r.marker);
      this.downed.splice(i, 1);
    }
    const hp = reviveHp(g, m, by);
    m.spawn(m.pos.clone(), m.yaw);
    m.hp = hp;
    m.ap = r.ap; // armor as it was when they fell
    m.revivedThisRound = true;
    m.invulnT = REVIVE.invuln;
    if (by?.stats) by.stats.revives = (by.stats.revives ?? 0) + 1;
    const byName = by?.isPlayer ? 'You' : by?.name ?? '';
    if (m.isPlayer) {
      // the weapons, ammo and gear you had; back to a slot that still has something in it
      const w = g.weapons;
      const c = w.cur;
      const empty = (c === 3 && w.grenades + w.molotovs <= 0) || (c === 4 && !(w.barricades > 0)) || (c === 5 && !(w.gascans > 0)) || !w.slots[c];
      w.switchTo(empty ? 0 : c, true);
      g.spectate = null;
      g.hud?.banner('REVIVED', `${by?.name ?? 'A teammate'} got you back up · ${hp} HP`, 2.4, 'success');
    } else if (by?.isPlayer) {
      g.hud?.popScore?.(0, `REVIVED ${m.name.toUpperCase()}`);
    }
    g.hud?.addKill?.({ killer: byName, victim: m.isPlayer ? 'You' : m.name, revive: true });
    g.audio.play('revive_done', { position: m.pos, volume: 0.85 });
  }

  // ---------------------------------------------------------------- HUD
  /** The dead player's line: { text, frac } or null. */
  hudInfo() {
    const p = this.game.player;
    if (p.alive) return null;
    const r = this.recordOf(p);
    if (!r) return null;
    if (r.ch?.by && this.task?.rec === r && this.task.phase === 'kneel') {
      return { text: `${r.ch.by.name.toUpperCase()} IS REVIVING YOU`, frac: Math.min(1, this.task.t / this.task.dur), urgent: false };
    }
    const left = Math.max(0, Math.ceil(REVIVE.window - r.t));
    return { text: `WAITING FOR REVIVE ${left}s`, frac: null, urgent: left <= 5 };
  }

  /** A downed teammate to run to: { pos, label } or null. */
  waypoint(player) {
    if (!player?.alive || this.player) return null;
    let best = null, bd = Infinity;
    for (const r of this.downed) {
      if (r.m.isPlayer || r.ch) continue;
      const d = r.pos.distanceTo(player.pos);
      if (d < bd) {
        bd = d;
        best = r;
      }
    }
    if (!best || hdist(best.pos, player.pos) < 2.5) return null;
    return { pos: best.pos, label: `REVIVE ${best.m.name.toUpperCase()} ${Math.ceil(REVIVE.window - best.t)}s` };
  }

  radarList() {
    return this.downed.filter((r) => !r.m.isPlayer).map((r) => ({ x: r.pos.x, z: r.pos.z, kind: 'revive' }));
  }
}
