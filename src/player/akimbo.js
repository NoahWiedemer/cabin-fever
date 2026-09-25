// Akimbo: a one-time premium store upgrade for the secondary pistols (prices in game/shop.js). The
// pistol slot then carries two guns, CoD style:
//   - Mouse1 fires the right gun, Mouse2 the left one, each on its own semi-auto trigger, cooldown and
//     magazine (`ammo.mag` right, `ammo.mag2` left; the reserve is shared). No aiming down sights.
//   - A wider hip cone (the crosshair follows it), a little less aim kick per round.
//   - One reload for both, 1.35x as long: both empties drop, then each gun dips onto a fresh mag in turn.
// Damage per shot is unchanged: the gain is fire rate and capacity. The akimbo def is derived from the
// (upgraded) single def, so store upgrades carry over. The second gun in the viewmodel is
// player/akimboRig.js.

export const AKIMBO = {
  spread: 1.3, // hip cone
  move: 1.15, // moving / airborne cone
  recoil: 0.85, // aim kick per round (two guns fire twice as often)
  reload: 1.35, // both mags, seated one after the other
  draw: 1.25, // two guns out of two holsters
};

// reload timeline (fraction of the reload): [right, left]
export const AKIMBO_RELOAD = {
  drop: [0.1, 0.125], // the empties fall free
  seat: [0.37, 0.69], // each gun dips out of view onto a fresh mag and comes back up loaded
  slide: [0.58, 0.9], // an empty gun's slide goes home once it's back up
};

// hands spread wide, guns canted in a little and toed in on the crosshair; the sprint drops both
// muzzles and tucks them in by the hips (right-gun values: the left one is its mirror image)
const HIP = { m9: [0.14, -0.135, -0.36], mozambique: [0.15, -0.15, -0.35] };
const HIP_ROT = [0.02, 0.06, 0.14];
const SPRINT = [0, -0.02, 0.03, -0.5, -0.18, -0.12];

const _defs = new WeakMap();

/** The akimbo version of an (upgraded) pistol def; cached per def object, like effectiveDef. */
export function akimboDef(d) {
  if (!d) return d;
  let a = _defs.get(d);
  if (!a) {
    a = {
      ...d,
      akimbo: true,
      name: `${d.name} ×2`,
      spreadHip: d.spreadHip * AKIMBO.spread,
      spreadMove: d.spreadMove * AKIMBO.move,
      spreadAir: d.spreadAir * AKIMBO.move,
      recoilV: d.recoilV * AKIMBO.recoil,
      reload: d.reload * AKIMBO.reload,
      reloadEmpty: (d.reloadEmpty ?? d.reload) * AKIMBO.reload,
      drawTime: (d.drawTime ?? 0.3) * AKIMBO.draw,
      hip: HIP[d.id] ?? [d.hip[0] + 0.03, d.hip[1] - 0.015, d.hip[2] - 0.01],
      hipRot: HIP_ROT,
      sprintPose: SPRINT,
    };
    _defs.set(d, a);
  }
  return a;
}

export const hasAkimbo = (ws, id) => !!ws.akimbo?.has(id);

/** Store purchase: the second gun comes loaded; a drawn pistol is redrawn as a pair. */
export function giveAkimbo(ws, id) {
  (ws.akimbo ??= new Set()).add(id);
  const d = ws.defOf(id);
  const a = ws.ammo[id];
  if (a && d?.mag) a.mag2 = d.mag;
  if (ws.slots[1] === id && ws.cur === 1 && !ws.tool) ws.switchTo(1, true);
}

/**
 * Both triggers (from WeaponSystem.update in place of the single-gun firing). A click is buffered
 * briefly per gun like the single trigger, so a shot pressed during the sprint-out still goes off.
 */
export function akimboTriggers(ws, dt, pressedR, pressedL) {
  const d = ws.def;
  const a = ws.curAmmo;
  if (!a) return;
  a.mag2 ??= 0;
  const S = (ws.duo ??= { cd: [0, 0], buf: [0, 0] });
  S.cd[0] -= dt;
  S.cd[1] -= dt;
  S.buf[0] = pressedR ? 0.14 : Math.max(0, S.buf[0] - dt);
  S.buf[1] = pressedL ? 0.14 : Math.max(0, S.buf[1] - dt);
  const ready = ws.state === 'idle' || (ws.state === 'draw' && ws.stateT > (d.drawTime ?? 0.4) * 0.75);
  if (!ready || ws.sprintK >= 0.35) return;
  for (let side = 0; side < 2; side++) {
    if (S.cd[side] > 0 || S.buf[side] <= 0) continue;
    S.buf[side] = 0;
    if ((side ? a.mag2 : a.mag) <= 0) {
      // an empty gun clicks; pulling it reloads both (when there's a reserve to load from)
      ws.game.audio.play('dryfire', { volume: 0.6 });
      S.cd[side] = 0.2;
      ws.tryReload();
      if (ws.state !== 'idle' && ws.state !== 'draw') return;
      continue;
    }
    ws._fire(dt, side);
    S.cd[side] = 60 / d.rpm;
  }
}

/** R (or an empty trigger): reload both guns if either is short. */
export function akimboTryReload(ws) {
  const d = ws.def;
  const a = ws.curAmmo;
  if (!a || ws.state !== 'idle') return;
  a.mag2 ??= 0;
  if ((a.mag >= d.mag && a.mag2 >= d.mag) || a.reserve <= 0) return;
  ws._stopLoops();
  const empty = [a.mag === 0, a.mag2 === 0];
  ws.reloadEmpty = empty[0] || empty[1];
  ws.reloadDur = ws.reloadEmpty ? d.reloadEmpty : d.reload;
  (ws.duo ??= { cd: [0, 0], buf: [0, 0] }).empty = empty;
  ws._setState('reload');
  ws.vm.onReload(d, 'akimbo', ws.reloadDur, empty);
}

/** Reload progress (WeaponSystem 'reload' state): sounds, and each mag filled from the shared reserve as it seats. */
export function akimboReloadTick(ws) {
  const d = ws.def;
  const a = ws.curAmmo;
  const P = ws.phaseDone;
  const audio = ws.game.audio;
  const R = AKIMBO_RELOAD;
  const f = ws.stateT / ws.reloadDur;
  const empty = ws.duo?.empty ?? [false, false];
  for (let side = 0; side < 2; side++) {
    if (!P['out' + side] && f > R.drop[side]) {
      P['out' + side] = true;
      audio.play('m4_mag_out', { volume: 0.65, pitch: side ? 1.2 : 1.12 });
    }
    if (!P['in' + side] && f > R.seat[side]) {
      P['in' + side] = true;
      audio.play('m4_mag_in', { volume: 0.85, pitch: 1.12 });
      const k = side ? 'mag2' : 'mag';
      const take = Math.min(d.mag - (a[k] ?? 0), a.reserve);
      if (take > 0) {
        a[k] = (a[k] ?? 0) + take;
        a.reserve -= take;
      }
    }
    if (empty[side] && !P['sl' + side] && f > R.slide[side]) {
      P['sl' + side] = true;
      audio.play('pistol_slide', { volume: 0.7 });
    }
  }
  if (f >= 1) ws._setState('idle');
}

/** Rounds left in both guns (auto-reload once both are dry). */
export const akimboRounds = (a) => (a ? a.mag + (a.mag2 ?? 0) : 0);
