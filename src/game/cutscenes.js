// The story's cutscenes (Cabin Fever mode, game/mission.js starts them, game/cinema.js plays them):
//   intro   the fireteam (the picked bots, plus a stand-in for the player when a character is free) in the
//           helicopter with the reagent, the approach over the farm, fast-roping into the yard, first person
//   nadja   first contact through the lab's glass: she wants the reagent, the vault door's keypad is dead,
//           Command promises a hacking module
//   outro   the hacked lock opens, the vault door swings out, the team walks in and hands Nadja the case
// Every scene can be skipped (end(..., skipped) puts the world where the scene would have left it).
import * as THREE from 'three';
import { HELI, buildReagentCase } from '../world/helicopter.js';
import { ease, easeIn, easeOut, span } from './cinema.js';
import { clamp, lerp } from '../core/utils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _p = V(), _l = V(), _a = V(), _b = V(), _c = V(), _d = V(), _s = V();
const FB = -3.2; // basement floor

/** set the cutscene camera: position, look-at point, vertical fov, a faint handheld drift */
function cam(g, pos, look, fov = 50, drift = 0) {
  const c = g.camera;
  c.position.copy(pos);
  if (drift) c.position.add(_s.set(Math.sin(g.time * 1.3) * drift, Math.sin(g.time * 1.9 + 1) * drift * 0.7, Math.cos(g.time * 1.1) * drift));
  c.up.set(0, 1, 0);
  c.lookAt(look);
  if (Math.abs(c.fov - fov) > 0.01) {
    c.fov = fov;
    c.updateProjectionMatrix();
  }
  c.updateMatrixWorld(true);
}

/** floor under (x, z) near height y (the yard, the porch deck, the basement) */
function floorAt(g, x, z, y) {
  const h = g.world.groundHeight(x, z, 0.2, y + 0.7);
  return h > -50 && h > y - 1.5 ? h : y;
}

/**
 * Who is in a scene: the fireteam's bots in team order, and `double`, a stand-in for the player: a
 * character nobody picked (Scorpion first: the store's paperdoll wears that body), else none.
 */
export function castOf(g) {
  const bots = g.team.filter((m) => !m.isPlayer);
  let double = null;
  for (const id of ['meshy', 'soldier', 'viper', 'ellis', 'coach']) {
    const b = g.bots.find((x) => x.id === id && !g.team.includes(x));
    if (b) {
      double = b;
      break;
    }
  }
  return { bots, double, all: double ? [...bots, double] : bots.slice() };
}

const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

// ============================================================================ intro
export function introScene(g) {
  const ch = g.chopper();
  const heli = ch.heli, fl = ch.flight;
  const { bots, double, all } = castOf(g);
  const H = V(-6.5, 9.2, 14.7), HYAW = Math.PI / 2; // hover over the front yard, nose east, the doors face the house
  const approach = [V(-78, 27, 54), V(-48, 20, 30), V(-24, 13.5, 17.8), V(-11.5, 10.3, 15.1), H.clone()];
  const depart = [H.clone(), V(-2.5, 12, 19), V(14, 21, 36), V(48, 32, 72), V(95, 42, 115)];
  const T_APP = 12.6, T_ROPE = 12.9, T_GO = 13.5, STEP = 1.05, SLIDE = 2.3;
  const n = all.length;
  // the stand-in (or the player's own descent) goes last, on the house-side rope
  const lastT0 = T_GO + Math.max(0, n - (double ? 1 : 0)) * STEP;
  const tLand = lastT0 + SLIDE;
  const T_DEPART = tLand + 0.6;
  const dur = tLand + 3.4;
  const porch = [V(-8.4, 0, 9.3), V(-4.6, 0, 9.3), V(-7.4, 0, 10.2), V(-5.6, 0, 10.2), V(-9.0, 0, 10.3)];
  const first = bots[0];
  const lines = [
    [0.8, 'COMMAND', 'Fireteam, listen up. That case holds the only batch of the reagent in existence.', 3.4, true],
    [4.4, 'COMMAND', 'Dr. Nadja is holed up somewhere under that farm. Get it to her. Whatever it takes.', 3.4, true],
    [7.7, 'PILOT', 'Farmhouse in sight. Visibility is garbage down there.', 2.6, true],
  ];
  if (first) lines.push([10.4, first.name.toUpperCase(), 'Great. Another farmhouse full of the dead.', 2.2]);
  lines.push([T_ROPE + 0.2, 'PILOT', 'Ropes out! Go, go, go!', 2.2, true]);
  lines.push([tLand + 0.4, 'COMMAND', 'Reaper, you are clear. Fireteam, hold that house until we find her.', 3.0, true]);

  return {
    id: 'intro',
    dur,
    fadeIn: 1.4,
    title: [1.2, 6.6, 'OPERATION CABIN FEVER · 03:40', 'THE FARMHOUSE'],
    lines,
    begin(g, S) {
      ch.show(true);
      ch.sound(true, 1);
      heli.rotor = 1;
      heli.lights = true;
      heli.setRopes(0);
      heli.cargo.visible = true;
      fl.setPath(approach);
      fl.yaw = Math.atan2(approach[1].x - approach[0].x, approach[1].z - approach[0].z);
      fl.at(0, 0);
      S.searchTarget = V();
      S.plan = all.map((b, i) => {
        const last = double ? b === double : false;
        const k = last ? n - 1 : i;
        return { b, seat: i % heli.seats.length, side: last ? 1 : k % 2 ? -1 : 1, t0: last ? lastT0 : T_GO + k * STEP, spot: porch[i % porch.length].clone(), land: null, last };
      });
      for (const p of S.plan) {
        p.b.root.visible = true;
        p.b.alive = true;
      }
      g.player.alive = true;
      S.handover = null;
    },
    tick(g, S, t, dt) {
      // ---- the helicopter: approach, hover, leave
      // far out over the fields while they talk in the cabin, then in low over the trees
      if (t < T_APP) fl.at(t < 7.2 ? 0.42 * (t / 7.2) : 0.42 + 0.58 * easeOut(span(t, 7.2, T_APP)), dt);
      else if (t < T_DEPART) fl.hover(H, HYAW, dt);
      else {
        if (!S.leaving) {
          S.leaving = true;
          fl.setPath(depart);
        }
        fl.at(easeIn(span(t, T_DEPART, T_DEPART + 7)), dt);
      }
      heli.root.updateMatrixWorld(true);
      const ropeLen = HELI.ropeY + heli.root.position.y - 0.08 + 0.5;
      heli.setRopes(t < T_ROPE ? 0 : t < T_DEPART ? Math.min(ropeLen, (t - T_ROPE) * 16) : 0);
      heli.searchOn = t > 7.4 && t < T_DEPART + 1.5;
      if (t < T_APP) {
        const hp = heli.root.position;
        S.searchTarget.set(hp.x + Math.sin(fl.yaw) * 12, -0.5, hp.z + Math.cos(fl.yaw) * 12);
      } else S.searchTarget.set(-6.5 + Math.sin(t * 0.7) * 1.5, -0.5, 12.6 + Math.cos(t * 0.5) * 1.2);
      heli.searchTarget.copy(S.searchTarget);
      g.lighting.spotOverride = heli.searchOn ? { pos: heli.searchWorld(_a).clone(), target: S.searchTarget, intensity: 160, angle: 0.26, distance: 60, decay: 1.3 } : null;
      // lightning over the approach
      if (t > 8.1 && !S.flash) {
        S.flash = true;
        g.lighting.triggerLightning(1.1);
      }
      ch.update(dt);

      // ---- the cast: seated, on the rope, landed, walking to the porch
      const yawH = heli.root.rotation.y;
      const lx = _d.set(Math.cos(yawH), 0, -Math.sin(yawH)); // the helicopter's local +x in the world
      for (const p of S.plan) {
        const b = p.b;
        if (p.last && S.handover?.hidden) continue;
        if (t < p.t0) {
          const s = heli.seats[p.seat];
          heli.seatWorld(p.seat, b.pos);
          b.pos.y -= 0.45;
          b.yaw = yawH + s.yaw;
          const back = s.yaw > 1 ? -1 : 1; // the front bench faces the tail
          b.cine(dt, { mode: 'sit', tilt: [fl.pitch * back, fl.bank * back] });
          continue;
        }
        if (t < p.t0 + SLIDE) {
          const top = heli.ropeTop(p.side, _a);
          const u = span(t, p.t0, p.t0 + SLIDE);
          const gy = floorAt(g, top.x, top.z, -0.5);
          if (!p.gy) p.gy = gy;
          const y = lerp(top.y - 1.9, gy, ease(u));
          b.pos.set(top.x + lx.x * p.side * 0.24, y, top.z + lx.z * p.side * 0.24);
          b.yaw = Math.atan2(-lx.x * p.side, -lx.z * p.side);
          b.cine(dt, { mode: 'rope', rope: { x: top.x, z: top.z }, slide: Math.sin(Math.PI * u) });
          continue;
        }
        if (!p.land) {
          p.land = b.pos.clone();
          p.landT = t;
          g.audio.play('land', { position: p.land, volume: 0.7 });
        }
        if (p.last) {
          b.cine(dt, { mode: t - p.landT < 0.4 ? 'crouch' : 'stand', ready: 0.2 });
          continue;
        }
        if (t - p.landT < 0.4) {
          b.cine(dt, { mode: 'crouch', ready: 0.4 });
          continue;
        }
        const to = p.spot;
        to.y = floorAt(g, to.x, to.z, 0);
        const d = Math.hypot(to.x - b.pos.x, to.z - b.pos.z);
        if (d > 0.25) {
          const yw = yawTo(b.pos, to);
          b.yaw = b.yaw + Math.atan2(Math.sin(yw - b.yaw), Math.cos(yw - b.yaw)) * Math.min(1, dt * 10);
          const step = Math.min(d, 2.7 * dt);
          b.pos.x += Math.sin(b.yaw) * step;
          b.pos.z += Math.cos(b.yaw) * step;
          b.pos.y = floorAt(g, b.pos.x, b.pos.z, b.pos.y);
          b.cine(dt, { mode: 'walk', speed: 2.7, ready: 0.3 });
        } else {
          b.yaw += Math.atan2(Math.sin(-b.yaw), Math.cos(-b.yaw)) * Math.min(1, dt * 4);
          b.cine(dt, { mode: 'stand', ready: 0.75 });
        }
      }

      // ---- the camera
      const S4 = lastT0 - (double ? 0.6 : 0.3);
      if (t < 7.2) {
        // inside the cabin: the glowing case, up to the faces on the bench
        const k = ease(span(t, 0.2, 6.9));
        const c0 = heli.toWorld(_a.set(0.5, 1.0, 0.95)), c1 = heli.toWorld(_b.set(0.28, 1.8, 1.4));
        const l0 = heli.toWorld(_c.set(0.12, 0.66, 0.12)), l1 = heli.toWorld(V(-0.05, 1.28, -0.95));
        cam(g, _p.lerpVectors(c0, c1, k), _l.lerpVectors(l0, l1, k), 64, 0.012);
        g.lighting.flashAt(heli.toWorld(_a.set(0, 2.0, 0.2)), 0xff4a30, 5.5, 0.3, 4.5);
        g.lighting.flashAt(heli.toWorld(_a.set(-1.4, 1.6, 0.1)), 0x8fa6d0, 3.5, 0.3, 4);
      } else if (t < T_APP) {
        // from the porch: the helicopter comes in low over the trees
        const hp = heli.root.position;
        cam(g, _p.set(-1.2, 1.3, 13.2), _l.copy(hp).add(_a.set(0, 1.0, 0)), lerp(50, 40, span(t, 7.2, T_APP)), 0.008);
      } else if (t < S4) {
        // from the yard, looking up the ropes as they come down
        const k = ease(span(t, T_GO, S4));
        cam(g, _p.set(lerp(3.4, 2.4, k), lerp(1.2, 1.0, k), lerp(9.4, 10.2, k)), _l.set(-6.5, lerp(8.6, 5.6, k), 14.3), 62, 0.008);
      } else {
        const p = S.plan.find((q) => q.last);
        if (p) {
          // alongside the stand-in on the rope, then into its eyes
          const b = p.b;
          const side = _a.copy(lx).multiplyScalar(p.side);
          const track = _b.copy(b.pos).addScaledVector(side, 2.1).add(_c.set(Math.sin(yawH) * 1.1, 1.0, Math.cos(yawH) * 1.1));
          const lookAt = _c.copy(b.pos).add(_l.set(0, 1.25, 0));
          if (!p.land) cam(g, track, lookAt, 50);
          else {
            const k = ease(span(t, p.landT + 0.3, p.landT + 1.5));
            const eye = V(p.land.x, p.land.y + 1.62, p.land.z);
            const houseLook = V(p.land.x, p.land.y + 1.55, p.land.z - 6);
            cam(g, _p.lerpVectors(track, eye, k), _l.lerpVectors(lookAt, houseLook, k), lerp(50, 58, k));
            if (k > 0.55 && !S.handover?.hidden) {
              S.handover = { hidden: true, pos: p.land.clone() };
              b.hide();
            }
          }
        } else {
          // no stand-in: the player's own descent in first person, then the house
          const top = heli.ropeTop(1, _a);
          const u = span(t, lastT0, lastT0 + SLIDE);
          const gy = floorAt(g, top.x, top.z, -0.5);
          const y = lerp(top.y - 0.3, gy + 1.62, ease(u));
          const pos = _p.set(top.x + lx.x * 0.3, y, top.z + lx.z * 0.3);
          const look = u < 1 ? _l.set(pos.x - lx.x * 3, gy + 0.5, pos.z - lx.z * 3 + 2) : _l.set(pos.x, y - 0.05, pos.z - 6);
          cam(g, pos, look, 58);
          if (u >= 1 && !S.handover) S.handover = { hidden: true, pos: V(pos.x, gy, pos.z) };
        }
      }
    },
    end(g, S, skipped) {
      const ch2 = g.chopper();
      ch2.show(false);
      g.lighting.spotOverride = null;
      for (const p of S.plan) {
        const b = p.b;
        if (p.last) {
          b.hide();
          continue;
        }
        if (skipped || !p.land) {
          b.pos.copy(p.spot);
          b.pos.y = floorAt(g, p.spot.x, p.spot.z, 0);
          b.yaw = 0;
        }
        b.cine(0, { mode: 'stand', ready: 0.6 });
        b.endCine();
      }
      // the player: where the stand-in landed, facing the house
      const land = S.handover?.pos ?? V(-6.5, floorAt(g, -6.5, 13.3, -0.5), 13.3);
      g.player.spawn(land, 0);
      g.player.pitch = 0;
    },
  };
}

// ============================================================================ nadja
export function nadjaScene(g) {
  const lab = g.lab, tech = lab.tech;
  const { bots, double } = castOf(g);
  const cast = [double, ...bots].filter(Boolean).slice(0, 3);
  const glassMid = V(-4.6, FB + 1.5, 3.85);
  const pp = g.player.pos;
  // the player (or the stand-in in their place) where they stand at the glass, the others beside them
  const p0 = V(clamp(pp.x, -6.2, -3.0), FB, clamp(pp.z, 1.6, 3.1));
  const spots = [p0, V(p0.x + 1.15, FB, p0.z - 0.25), V(p0.x - 1.15, FB, p0.z - 0.4)];
  const keypad = lab.hackMount.keypad;
  const keyBot = bots[0] ?? null;
  const keyName = (keyBot ?? double)?.name?.toUpperCase() ?? 'YOU';
  const keySpot = V(keypad.x - 0.1, FB, keypad.z - 0.62);
  const dur = 21.2;
  const lines = [
    [0.9, 'NADJA', 'You made it! Please tell me that case is the reagent.', 3.2],
    [4.3, 'NADJA', 'I need it in here, now. The door is right there!', 2.7],
    [7.5, keyName, 'Door is sealed tight. The keypad is dead.', 2.8],
    [10.6, 'NADJA', "The lockdown fried the lock. I can't open it from in here...", 3.1],
    [13.9, 'NADJA', "You'll have to hack it. It's the only way in.", 2.8],
    [17.0, 'COMMAND', 'Copy that, Fireteam. We will fly a hacking module in at the next lull. Hold on.', 3.9, true],
  ];
  return {
    id: 'nadja',
    dur,
    fadeIn: 0.6,
    lines,
    begin(g, S) {
      lab.forceVisible = true;
      S.cast = cast.map((b, i) => ({ b, spot: spots[i] }));
      for (const c of S.cast) {
        c.b.root.visible = true;
        c.b.alive = true;
        c.b.pos.copy(c.spot);
        c.b.yaw = yawTo(c.spot, glassMid);
      }
      S.key = keyBot ? S.cast.find((c) => c.b === keyBot) : null;
      tech?.perform('talk', _a.copy(spots[0]).setY(FB + 1.6));
      S.phase = 0;
    },
    tick(g, S, t, dt) {
      // Nadja: talks to the team, watches the keypad, points at the door, talks again
      const focus = _a.copy(spots[0]).setY(FB + 1.6);
      if (S.phase === 0 && t > 6.8) {
        S.phase = 1;
        tech?.perform('talk', _b.copy(keypad).setY(FB + 1.5));
      }
      if (S.phase === 1 && t > 10.4) {
        S.phase = 2;
        tech?.perform('point', focus);
      }
      if (S.phase === 2 && t > 13.7) {
        S.phase = 3;
        tech?.perform('talk', focus);
      }
      // the keypad: a teammate tries it (two dead beeps)
      if (S.key) {
        const b = S.key.b;
        if (t > 5.0 && t < 7.0) {
          const k = ease(span(t, 5.0, 6.8));
          b.pos.lerpVectors(S.key.spot, keySpot, k);
          b.yaw = yawTo(b.pos, t < 6.4 ? keySpot : keypad);
          b.cine(dt, { mode: k < 0.95 ? 'walk' : 'stand', speed: 1.4, sling: true });
        } else if (t >= 7.0 && t < 9.8) {
          b.pos.copy(keySpot);
          b.yaw = yawTo(keySpot, keypad);
          const press = (t > 7.1 && t < 7.4) || (t > 7.9 && t < 8.2);
          b.cine(dt, { mode: 'stand', sling: true, touch: press ? keypad : _c.copy(keypad).add(_d.set(-0.05, -0.25, -0.2)), look: keypad });
        } else if (t >= 9.8) {
          b.pos.copy(keySpot);
          b.yaw = yawTo(keySpot, glassMid);
          b.cine(dt, { mode: 'stand', ready: 0.1, look: _d.set(-4.6, FB + 1.6, 5.0) });
        } else b.cine(dt, { mode: 'stand', ready: 0.1, look: _d.set(-4.6, FB + 1.6, 5.0) });
        if ((t > 7.1 && !S.beep1) || (t > 7.9 && !S.beep2)) {
          if (!S.beep1) S.beep1 = true;
          else S.beep2 = true;
          g.audio.play('keypad_deny', { position: keypad, volume: 1 });
          lab.setLock('jammed');
        }
        if (t > 9.0 && S.beep2 && !S.lockBack) {
          S.lockBack = true;
          lab.setLock('locked');
        }
      } else if (t > 7.1 && !S.beep1) {
        S.beep1 = true;
        g.audio.play('keypad_deny', { position: keypad, volume: 1 });
      }
      for (const c of S.cast) {
        if (c === S.key) continue;
        c.b.cine(dt, { mode: 'stand', ready: 0.15, look: _d.set(-4.6, FB + 1.6, 5.0) });
      }
      // the camera
      if (t < 5.0) cam(g, _p.set(spots[0].x + 0.75, FB + 1.8, spots[0].z - 2.1), _l.set(-4.6, FB + 1.45, 5.0), 44, 0.006);
      else if (t < 10.3) cam(g, _p.set(keypad.x - 1.35, FB + 1.55, keypad.z - 1.9), _l.set(keypad.x + 0.05, FB + 1.25, keypad.z), 48, 0.006);
      else if (t < 16.8) cam(g, _p.set(-4.42, FB + 1.64, 3.3), _l.set(-4.62, FB + 1.52, 5.06), 38, 0.004);
      else {
        const k = ease(span(t, 16.8, dur));
        cam(g, _p.set(lerp(-6.9, -6.4, k), FB + 2.1, lerp(0.5, 0.9, k)), _l.set(-3.1, FB + 1.2, 3.8), 56, 0.006);
      }
    },
    end(g, S) {
      lab.forceVisible = false;
      lab.setLock('locked');
      tech?.release();
      for (const c of S.cast) {
        if (c.b === double) {
          c.b.hide();
          continue;
        }
        c.b.cine(0, { mode: 'stand' });
        c.b.endCine();
      }
      const p = g.player;
      p.pos.copy(spots[0]);
      p.yaw = Math.atan2(-(glassMid.x - spots[0].x), -(glassMid.z - spots[0].z));
      p.pitch = 0;
    },
  };
}

// ============================================================================ outro
export function outroScene(g) {
  const lab = g.lab, tech = lab.tech;
  const { bots, double } = castOf(g);
  const cast = [double, ...bots].filter(Boolean);
  const carrier = cast[0] ?? null;
  const door = lab.door.center; // (lcx, FB + 1.1, the frame's face)
  const mount = lab.hackMount;
  const outside = [V(-1.0, FB, 2.7), V(0.35, FB, 2.5), V(-2.15, FB, 2.35), V(-0.4, FB, 1.8), V(1.1, FB, 1.8), V(-1.7, FB, 1.5)];
  // inside: the carrier faces Nadja at the counter's end, the rest keep east of them (clear of the camera)
  const inside = [V(-2.0, FB, 4.95), V(-0.9, FB, 5.45), V(-0.3, FB, 4.75), V(0.4, FB, 5.55), V(-1.3, FB, 6.05), V(0.9, FB, 4.9)];
  const nadjaAt = V(-3.25, FB, 5.2);
  const dur = 22.5;
  const lines = [
    [1.2, 'NADJA', 'The lock is open! And the basement is quiet... Stand back.', 3.0],
    [8.4, 'NADJA', 'Get in here, quickly!', 2.2],
    [12.2, 'NADJA', 'The reagent... You actually brought it. With this I can finish the cure.', 3.9],
    [16.6, 'COMMAND', 'Good work, Fireteam. Package delivered. Extraction is on its way.', 3.6, true],
  ];
  return {
    id: 'outro',
    dur,
    fadeIn: 0.8,
    fadeOut: 2.4,
    keepHud: true,
    title: [18.8, 30, 'CABIN FEVER · PART ONE', 'MISSION COMPLETE'],
    lines,
    begin(g, S) {
      lab.setLock('open');
      S.cast = cast.map((b, i) => ({ b, out: outside[i % outside.length], in: inside[i % inside.length], t0: 9.6 + i * 0.55 }));
      for (const c of S.cast) {
        c.b.root.visible = true;
        c.b.alive = true;
        c.b.pos.copy(c.out);
        c.b.yaw = yawTo(c.out, door);
      }
      // the case in the carrier's right hand
      S.case = buildReagentCase(true);
      S.case.scale.setScalar(0.85);
      if (carrier) {
        carrier.bones.handR.add(S.case);
        S.case.position.set(0.02, -0.12, 0.05);
        S.case.rotation.set(0, 0, Math.PI);
      }
      S.nadjaMoved = false;
    },
    tick(g, S, t, dt) {
      g.mission.module?.update(dt, 'done', 1); // ACCESS GRANTED
      // the lock and the door
      // the bolts draw back (the wheel spins for 1.4 s), then the leaf swings out
      if (t > 3.3 && !S.unlock) {
        S.unlock = true;
        g.audio.play('vault_unlock', { position: door, volume: 1 });
        lab.openDoor(1);
      }
      if (t > 4.8 && !S.swing) {
        S.swing = true;
        g.audio.play('vault_open', { position: door, volume: 1 });
      }
      if (t > 4.9 && t < 8.8) {
        // air rushing out, the lab's light spilling into the basement
        if (Math.random() < dt * 14) g.fx.smoke.emit(door.x + (Math.random() - 0.5) * 1.2, FB + 0.4 + Math.random() * 1.8, 3.6, (Math.random() - 0.5) * 0.4, 0.2, -0.8 - Math.random() * 0.6, { life: 1.6, size: 0.8, grow: 1.5, drag: 1.2, color: [0.5, 0.55, 0.58], alpha: 0.35 });
        g.lighting.flashAt(_a.set(door.x, FB + 1.6, 4.5), 0xdfeaff, 18 * ease(span(t, 4.9, 6.5)), 0.3, 6);
      }
      if (t > 9.0) lab.forceVisible = true;
      // Nadja: from her counter to the door end of it, turned to the team, hands out for the case
      if (t > 9.2 && !S.nadjaMoved && tech) {
        S.nadjaMoved = true;
        tech.root.position.copy(nadjaAt);
        tech.root.rotation.y = Math.PI / 2 + 0.25;
        tech.perform('greet', _b.set(-1.4, FB + 1.6, 5.3));
      }
      // the team: ready at the door, then in, one after another
      for (const c of S.cast) {
        const b = c.b;
        const carry = b === carrier;
        if (t < c.t0) {
          b.yaw = yawTo(b.pos, door);
          b.cine(dt, { mode: 'stand', ready: carry ? 0 : 0.7, sling: carry, touch: null });
          continue;
        }
        // through the doorway (x -0.65, z 3.6 → 4.5), then to its spot inside
        const via = _c.set(-0.65, FB, 4.45);
        const target = c.via ? c.in : via;
        const d = Math.hypot(target.x - b.pos.x, target.z - b.pos.z);
        if (!c.via && d < 0.35) c.via = true;
        if (d > 0.2 || !c.via) {
          const yw = yawTo(b.pos, target);
          b.yaw += Math.atan2(Math.sin(yw - b.yaw), Math.cos(yw - b.yaw)) * Math.min(1, dt * 9);
          const step = Math.min(d, 1.5 * dt);
          b.pos.x += Math.sin(b.yaw) * step;
          b.pos.z += Math.cos(b.yaw) * step;
          b.cine(dt, { mode: 'walk', speed: 1.5, ready: 0.1, sling: carry });
        } else {
          b.yaw += Math.atan2(Math.sin(yawTo(b.pos, nadjaAt) - b.yaw), Math.cos(yawTo(b.pos, nadjaAt) - b.yaw)) * Math.min(1, dt * 4);
          const handing = carry && t > 12.6 && t < 14.2;
          b.cine(dt, { mode: 'stand', ready: 0, sling: carry, touch: handing ? _d.set(nadjaAt.x + 0.55, FB + 1.1, nadjaAt.z + 0.05) : null, look: _a.set(nadjaAt.x, FB + 1.6, nadjaAt.z) });
        }
      }
      // the handover: the case goes from the carrier's hand to hers
      if (t > 13.8 && !S.handed && tech) {
        S.handed = true;
        const hand = tech.char.bones.handR;
        hand.attach(S.case);
        S.case.position.set(0.03, -0.1, 0.06);
        S.case.rotation.set(0, Math.PI / 2, Math.PI);
      }
      // the camera
      if (t < 4.8) cam(g, _p.set(mount.pos.x - 1.25, FB + 1.45, mount.pos.z - 1.7), _l.set(mount.pos.x - 0.2, FB + 1.0, mount.pos.z), 44, 0.004);
      else if (t < 9.6) cam(g, _p.set(1.55, FB + 1.72, 1.05), _l.set(-0.95, FB + 1.15, 3.8), 54, 0.006); // from the east: clear of the pillars
      else if (t < 12.2) cam(g, _p.set(-3.35, FB + 1.72, 6.25), _l.set(-0.9, FB + 1.25, 4.3), 52, 0.005);
      else if (t < 16.4) cam(g, _p.set(-2.6, FB + 1.58, 6.38), _l.set(-2.62, FB + 1.28, 5.05), 50, 0.004); // Nadja and the case, side on
      else {
        const k = ease(span(t, 16.4, dur));
        cam(g, _p.set(lerp(-0.6, 1.0, k), FB + lerp(1.9, 2.3, k), lerp(6.3, 6.35, k)), _l.set(-2.5, FB + 1.3, 5.1), 50, 0.004);
      }
    },
    end(g, S) {
      // the run is over: stay black until the end screen (game.start clears it)
      g.story.setFade(1);
      if (S.case?.parent) S.case.parent.remove(S.case);
      for (const c of S.cast) if (c.b === double) c.b.hide();
      tech?.release();
    },
  };
}
