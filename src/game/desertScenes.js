// Desert Thunder's cutscenes (game/desertMission.js starts them, game/cinema.js plays them):
//   insert   the fireteam in the helicopter over Mogadishu while Colonel Coleman briefs them, in low over the
//            rooftops, fast-roping into the lot at the town's south edge, first person
//   hostage  the room on the temple's gallery, a moment too late: the operative dead in his chair, the coded memo on
//            the table; down in the hall the back door bursts open and the royal guard comes in
//   extract  the gate is down, the crash site clear: two helicopters come in over the rooftops for the pick-up, an
//            RPG from a roof takes the first one down in front of you, the second one gets you out
// Every scene can be skipped (end(..., skipped) puts the world where the scene would have left it).
import * as THREE from 'three';
import { HELI } from '../world/helicopter.js';
import { rocketProto } from '../actors/insurgent.js';
import { ease, easeIn, easeOut, span } from './cinema.js';
import { cam, floorAt, castOf } from './cutscenes.js';
import { lerp } from '../core/utils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _p = V(), _l = V(), _a = V(), _b = V(), _c = V(), _d = V();
const U = 3.4; // (world/desert.js: the terrace, the temple's gallery)
const yawTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);
const turn = (from, to, k) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * Math.min(1, k);

/** a cast member walks to `to` (on the floor) at `speed` m/s, then turns to `face` (a yaw) and stands; true once there */
function walkTo(g, b, to, dt, speed = 2.4, face = null, ready = 0.3) {
  const d = Math.hypot(to.x - b.pos.x, to.z - b.pos.z);
  if (d > 0.2) {
    b.yaw = turn(b.yaw, yawTo(b.pos, to), dt * 10);
    const step = Math.min(d, speed * dt);
    b.pos.x += Math.sin(b.yaw) * step;
    b.pos.z += Math.cos(b.yaw) * step;
    b.pos.y = floorAt(g, b.pos.x, b.pos.z, b.pos.y);
    b.cine(dt, { mode: 'walk', speed, ready });
    return false;
  }
  if (face != null) b.yaw = turn(b.yaw, face, dt * 4);
  b.cine(dt, { mode: 'stand', ready: 0.75 });
  return true;
}

/** rotor wash: dust kicked off the ground round (x, z) */
function washDust(g, x, y, z, dt, rate = 40) {
  if (Math.random() > dt * rate) return;
  const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 6;
  g.fx.smoke.emit(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r, Math.cos(a) * 3, 0.4 + Math.random() * 0.6, Math.sin(a) * 3, { life: 1.4 + Math.random(), size: 0.8 + Math.random() * 0.8, grow: 1.8, drag: 1.4, gravity: -0.1, color: [0.62, 0.55, 0.44], alpha: 0.35 });
}

// ============================================================================ insert
export function insertScene(g) {
  const ch = g.chopper();
  const heli = ch.heli, fl = ch.flight;
  const { bots, double, all } = castOf(g);
  // it hangs over the lot nose north, up the main street: the doors (and the ropes) face east and west. It comes in
  // along the town's south edge from the east, the rooftops below its left door
  const H = V(-32, 9.6, 85.5), HYAW = Math.PI;
  const approach = [V(62, 36, 126), V(30, 29, 112), V(2, 22, 101), V(-20, 15.5, 94), H.clone()];
  const depart = [H.clone(), V(-33, 13, 97), V(-40, 24, 130), V(-30, 36, 190), V(-10, 48, 260)];
  const T_APP = 12.6, T_ROPE = 12.9, T_GO = 13.5, STEP = 1.05, SLIDE = 2.3;
  const n = all.length;
  // the stand-in (or the player's own descent) goes last
  const lastT0 = T_GO + Math.max(0, n - (double ? 1 : 0)) * STEP;
  const tLand = lastT0 + SLIDE;
  const T_DEPART = tLand + 0.6;
  const dur = tLand + 3.4;
  // where they go after the ropes: a loose line north of the helicopter, facing up the street
  const spots = [V(-33.8, 0, 79.6), V(-30.2, 0, 79.6), V(-35.4, 0, 80.8), V(-28.6, 0, 80.8), V(-32, 0, 78.4)];
  const first = bots[0];
  const lines = [
    [0.8, 'COLEMAN', "Fireteam, this is Colonel Coleman. The Sand Hog are holding one of the Intelligence Bureau's field operatives.", 3.7, true],
    [4.7, 'COLEMAN', "Word is they'll execute him any minute now. Get into the target area fast. Details will follow on the way.", 3.8, true],
    [8.8, 'PILOT', "Drop zone ahead. Too hot to set her down, you're going down the ropes.", 2.6, true],
  ];
  if (first) lines.push([11.1, first.name.toUpperCase(), 'Noon in Mogadishu. Could be worse.', 1.7]);
  lines.push([T_ROPE + 0.2, 'PILOT', 'Ropes out! Go, go, go!', 2.2, true]);
  lines.push([tLand + 0.4, 'COLEMAN', "You're on the ground. Push north up the main street.", 2.8, true]);

  return {
    id: 'dtInsert',
    dur,
    fadeIn: 1.4,
    title: [1.2, 6.6, 'OPERATION DESERT THUNDER · 12:40', 'MOGADISHU'],
    lines,
    begin(g, S) {
      ch.show(true);
      ch.sound(true, 1);
      heli.rotor = 1;
      heli.lights = true;
      heli.searchOn = false;
      heli.setRopes(0);
      heli.cargo.visible = false; // (no reagent on this one)
      fl.setPath(approach);
      fl.yaw = Math.atan2(approach[1].x - approach[0].x, approach[1].z - approach[0].z);
      fl.at(0, 0);
      g.lighting.spotOverride = null;
      S.plan = all.map((b, i) => {
        const last = double ? b === double : false;
        const k = last ? n - 1 : i;
        return { b, seat: i % heli.seats.length, side: last ? 1 : k % 2 ? -1 : 1, t0: last ? lastT0 : T_GO + k * STEP, spot: spots[i % spots.length].clone(), land: null, last };
      });
      for (const p of S.plan) {
        p.b.root.visible = true;
        p.b.alive = true;
      }
      g.player.alive = true;
      S.handover = null;
      S.look = V();
    },
    tick(g, S, t, dt) {
      // ---- the helicopter: along the rooftops, the hover, away
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
      ch.update(dt);
      if (t > T_APP - 1.5 && t < T_DEPART + 1.5) washDust(g, heli.root.position.x, 0, heli.root.position.z, dt);

      // ---- the cast: seated, on the rope, landed, into the line
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
          const gy = floorAt(g, top.x, top.z, 0);
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
        p.spot.y = floorAt(g, p.spot.x, p.spot.z, 0);
        walkTo(g, b, p.spot, dt, 2.7, Math.PI);
      }

      // ---- the camera
      const S4 = lastT0 - (double ? 0.6 : 0.3);
      if (t < 3.8) {
        // in the cabin: the faces on the benches
        const k = ease(span(t, 0.2, 3.8));
        const c0 = heli.toWorld(_a.set(0.3, 1.35, 1.2)), c1 = heli.toWorld(_b.set(0.2, 1.55, 1.35));
        const l0 = heli.toWorld(_c.set(-0.1, 1.15, -0.95)), l1 = heli.toWorld(V(-0.05, 1.3, -0.9));
        cam(g, _p.lerpVectors(c0, c1, k), _l.lerpVectors(l0, l1, k), 62, 0.012);
      } else if (t < 7.2) {
        // out of the open door: the town's rooftops sliding past below
        const k = ease(span(t, 3.8, 7.2));
        const c0 = heli.toWorld(_a.set(-0.25, 1.45, 0.3));
        const l0 = heli.toWorld(_c.set(lerp(-6, -7, k), lerp(-3.4, -4.6, k), lerp(-1.2, 1.2, k)));
        cam(g, c0, l0, 58, 0.015);
      } else if (t < T_APP) {
        // from the lot: it comes in low over the rooftops
        const hp = heli.root.position;
        if (!S.lookSet) {
          S.lookSet = true;
          S.look.copy(hp);
        }
        S.look.lerp(hp, Math.min(1, dt * 6));
        cam(g, _p.set(-38, 1.5, 74), _l.copy(S.look).add(_a.set(0, 1.0, 0)), lerp(48, 40, span(t, 7.2, T_APP)), 0.008);
      } else if (t < S4) {
        // from the lot's north side: the ropes coming down, the first of them on them
        const k = ease(span(t, T_GO, S4));
        cam(g, _p.set(lerp(-26.8, -27.8, k), lerp(1.25, 1.05, k), lerp(77.2, 78.2, k)), _l.set(-32, lerp(8.6, 5.6, k), 85.3), 62, 0.008);
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
            const street = V(p.land.x, p.land.y + 1.55, p.land.z - 6); // (north, up the main street)
            cam(g, _p.lerpVectors(track, eye, k), _l.lerpVectors(lookAt, street, k), lerp(50, 58, k));
            if (k > 0.55 && !S.handover?.hidden) {
              S.handover = { hidden: true, pos: p.land.clone() };
              b.hide();
            }
          }
        } else {
          // no stand-in: the player's own descent in first person, then the street
          const top = heli.ropeTop(1, _a);
          const u = span(t, lastT0, lastT0 + SLIDE);
          const gy = floorAt(g, top.x, top.z, 0);
          const y = lerp(top.y - 0.3, gy + 1.62, ease(u));
          const pos = _p.set(top.x + lx.x * 0.3, y, top.z + lx.z * 0.3);
          const look = u < 1 ? _l.set(pos.x - lx.x * 3, gy + 0.5, pos.z - lx.z * 3 - 2) : _l.set(pos.x, y - 0.05, pos.z - 6);
          cam(g, pos, look, 58);
          if (u >= 1 && !S.handover) S.handover = { hidden: true, pos: V(pos.x, gy, pos.z) };
        }
      }
    },
    end(g, S, skipped) {
      ch.show(false);
      for (const p of S.plan) {
        const b = p.b;
        if (p.last) {
          b.hide();
          continue;
        }
        if (skipped || !p.land) {
          b.pos.copy(p.spot);
          b.pos.y = floorAt(g, p.spot.x, p.spot.z, 0);
          b.yaw = Math.PI;
        }
        b.cine(0, { mode: 'stand', ready: 0.6 });
        b.endCine();
      }
      // the player: where the stand-in landed, facing up the street
      const land = S.handover?.pos ?? V(-32, 0, 83.5);
      g.player.spawn(land, 0);
      g.player.pitch = 0;
    },
  };
}

// ============================================================================ hostage
/**
 * M: the mission (its captive, spawning the guards). The room on the gallery: x 38..50, z -30..-20 at U, its door
 * at x 43..45 on the south side; the chair in the middle, the table with the memo against the west side.
 */
export function hostageScene(g, refs, M) {
  const T = refs.temple;
  const { bots, double } = castOf(g);
  const cast = [double, ...bots].filter(Boolean).slice(0, 4);
  const lead = cast[0] ?? null;
  const second = cast[1] ?? lead;
  const reader = cast[2] ?? cast[1] ?? lead;
  const name = (b) => b?.name?.toUpperCase() ?? 'YOU';
  const memo = T.memoAt; // (41, U + 0.8, -27.5)
  // in through the door, round the chair; the reader to the table
  const start = [V(43.7, U, -17.6), V(44.5, U, -16.8), V(43.4, U, -15.9), V(44.4, U, -15.1)];
  const spots = [V(42.3, U, -22.6), V(46.0, U, -22.3), V(41.3, U, -26.4), V(44.6, U, -20.9)];
  const faces = [yawTo(spots[0], T.hostageAt), yawTo(spots[1], T.hostageAt), Math.PI, 0.3];
  const goAt = [0.2, 0.8, 1.5, 2.1];
  const read = [10.2, 12.4]; // the reader's hand on the memo
  // the royal guard: in through the back door below, into the hall
  const guardFrom = [V(43.3, 0, -32.2), V(44.8, 0, -32.8), V(44.0, 0, -34.0)];
  const guardTo = [V(41.6, 0, -25.5), V(46.4, 0, -24.8), V(44.0, 0, -22.4)];
  const BANG = 14.8;
  const dur = 18.6;
  const lines = [
    [0.9, name(lead), 'Clear!', 1.0],
    [2.3, name(second), "There he is... He's not moving.", 2.1],
    [5.0, name(lead), 'No pulse. They shot him minutes ago. We were that close.', 3.0],
    [8.5, 'EVANS', 'Search the room. He had something on him. Find it.', 2.6, true],
    [11.6, name(reader), 'Got something. A note, all in code.', 2.0],
    [13.5, 'EVANS', 'Send it up. Wait... Movement at the back door, down in the hall!', 3.2, true],
  ];
  const spawnGuards = (S, at) => {
    S.guards = [];
    for (let i = 0; i < guardFrom.length; i++) {
      const p = (at ?? guardFrom)[i];
      const m = g.insurgents?.spawn('guard', V(p.x, floorAt(g, p.x, p.z, 0), p.z), 0, { alert: true, squad: 'backdoor' });
      if (m) {
        m.sector = 3;
        m.group = 'backdoor';
        S.guards.push({ m, to: guardTo[i], at: BANG + 0.25 + i * 0.35 });
      }
    }
  };
  return {
    id: 'dtHostage',
    dur,
    fadeIn: 0.5,
    lines,
    begin(g, S) {
      S.plan = cast.map((b, i) => ({ b, from: start[i], to: spots[i], face: faces[i], go: goAt[i] }));
      for (const p of S.plan) {
        p.b.root.visible = true;
        p.b.alive = true;
        p.b.pos.copy(p.from);
        p.b.yaw = Math.PI; // (facing into the room, north)
        p.b.cine(0, { mode: 'stand', ready: 0.8 });
      }
      g.player.alive = true;
      for (const m of g.insurgents?.list ?? []) if (m.laser) m.laser.visible = false; // (a sniper's aim, frozen: gone)
      M.poseCaptive();
      S.guards = null;
      S.banged = false;
    },
    tick(g, S, t, dt) {
      // ---- the team: in, round the chair; the reader to the memo
      for (const p of S.plan) {
        const b = p.b;
        if (t < p.go) {
          b.cine(dt, { mode: 'stand', ready: 0.8 });
          continue;
        }
        if (b === reader && b !== lead && t > 8.8) {
          // (the reader leaves the chair for the table once Evans asks)
          const to = _a.set(41.2, U, -26.5);
          if (walkTo(g, b, to, dt, 1.4, Math.PI, 0.2)) {
            const touch = t > read[0] && t < read[1] ? _b.set(memo.x + 0.05, memo.y + 0.03, memo.z + 0.12) : null;
            b.cine(dt, { mode: 'stand', ready: 0, sling: !!touch, touch, look: memo });
          }
          continue;
        }
        walkTo(g, b, p.to, dt, 1.6, p.face, 0.8);
      }
      // ---- the back door bursts in, the guards come through it
      if (t >= BANG && !S.banged) {
        S.banged = true;
        T.doors.back.open(g, -1);
        const at = V(44, 1.8, -29.7);
        g.audio.play('wood_bash', { position: at, volume: 1 });
        g.audio.play('plank_break', { position: at, volume: 0.9 });
        g.shake.add(0.25);
        for (let i = 0; i < 14; i++) g.fx.smoke.emit(at.x + (Math.random() - 0.5) * 3, at.y - 1 + Math.random() * 2, at.z + 0.3, (Math.random() - 0.5) * 2, Math.random(), 1 + Math.random() * 2, { life: 1 + Math.random(), size: 0.6 + Math.random() * 0.6, grow: 1.6, drag: 2, gravity: -0.2, color: [0.5, 0.45, 0.38], alpha: 0.4 });
        spawnGuards(S);
      }
      for (const q of S.guards ?? []) {
        const m = q.m;
        if (t < q.at) {
          m.cine(dt, { mode: 'stand', ready: 0.9 });
          continue;
        }
        walkTo(g, m, q.to, dt, 3.4, 0, 0.95);
      }
      // ---- the camera
      if (t < 4.6) {
        // from inside, by the west wall: the team comes through the door, the figure in the chair
        const k = ease(span(t, 0, 4.6));
        cam(g, _p.set(lerp(39.9, 40.3, k), U + 1.55, lerp(-21.2, -21.8, k)), _l.set(lerp(43.2, 44, k), U + lerp(1.2, 1.0, k), lerp(-23.2, -25, k)), 58, 0.006);
      } else if (t < 8.6) {
        // close on him: the blindfold, the blood
        const k = ease(span(t, 4.6, 8.6));
        cam(g, _p.set(lerp(43.2, 43.5, k), U + lerp(0.95, 0.85, k), lerp(-23.4, -23.8, k)), _l.set(44, U + 1.08, -25.1), lerp(44, 38, k), 0.004);
      } else if (t < 13.2) {
        // the table: the note in his things
        const k = ease(span(t, 8.6, 13.2));
        cam(g, _p.set(lerp(39.2, 39.5, k), U + 1.5, lerp(-24.9, -25.3, k)), _l.set(41, U + 0.95, -27.2), lerp(50, 44, k), 0.005);
      } else {
        // meanwhile, down in the hall: the back door
        const k = ease(span(t, 13.2, dur));
        cam(g, _p.set(45.4, 1.5, lerp(-15.2, -16.4, k)), _l.set(44, 1.6, -28.5), 54, 0.01);
      }
    },
    end(g, S, skipped) {
      if (!T.doors.back.isOpen) T.doors.back.open(g, -1);
      if (!S.guards) spawnGuards(S, guardTo);
      for (const q of S.guards) {
        if (skipped) {
          q.m.pos.set(q.to.x, floorAt(g, q.to.x, q.to.z, 0), q.to.z);
          q.m.yaw = 0;
        }
        q.m.cine(0, { mode: 'stand', ready: 0.9 });
        q.m.endCine();
      }
      for (const p of S.plan) {
        const b = p.b;
        if (b === double) {
          b.hide();
          continue;
        }
        if (skipped) {
          b.pos.copy(p.to);
          b.yaw = p.face;
        }
        b.cine(0, { mode: 'stand', ready: 0.6 });
        b.endCine();
      }
      // the player: just inside the door, turned to go (back out onto the gallery)
      g.player.spawn(V(44, U, -21.3), Math.PI);
      g.player.pitch = -0.1;
    },
  };
}

// ============================================================================ extract
/** M: the mission (the second helicopter, the wreck's fire). The fireteam stands in the south of the crash site. */
export function extractScene(g, refs, M) {
  const W = refs.wreck;
  const chA = g.chopper(); // the lead: it comes down
  const chB = M.secondChopper();
  const { bots, double, all } = castOf(g);
  const cast = all.slice(0, 4);
  const spots = [V(-15.8, U, -115.4), V(-12.2, U, -115.8), V(-18.6, U, -116.6), V(-9.6, U, -116.8)];
  // in from the north-west over the rooftops; the second higher and behind
  const pathA = [V(-74, 46, -300), V(-52, 37, -228), V(-32, 28, -172), V(-19, 21, -142), V(-15, 16, -128)];
  const pathB = [V(-100, 54, -330), V(-78, 45, -258), V(-56, 37, -205), V(-40, 29, -168), V(-30, 22, -146)];
  const holdB = V(-27, 13, -126);
  const ARRIVE = 9.6; // s A would take to the hover
  const LAUNCH = 5.8, HIT = 7.0, IMPACT = 10.4;
  const shooterAt = V(11.8, U + 6.8, -121.5); // on the roof over the site's east side
  const crash = V(W.pos.x, W.pos.y + 1.3, W.pos.z);
  const dur = 19.6;
  const b1 = bots[0] ?? double;
  const lines = [
    [0.9, 'COLEMAN', "Outstanding work. That's the evidence Parliament has been waiting for. Your ride is inbound.", 3.6, true],
    [4.4, 'PILOT', 'Sabre One on final. Keep your heads down, we are coming in.', 2.4, true],
    [6.1, b1?.name?.toUpperCase() ?? 'EVANS', 'RPG! On the roof!', 1.1, !b1],
    [7.3, 'PILOT', "We're hit, we're hit! Going down!", 2.2, true],
    [10.9, 'EVANS', 'Sabre One is down! Bird down in the extraction zone!', 2.6, true],
    [14.0, 'COLEMAN', "Copy... Fireteam, the intel comes first. Sabre Two is pulling you out. We'll come back for them.", 4.4, true],
  ];
  return {
    id: 'dtExtract',
    dur,
    fadeIn: 1.0,
    fadeOut: 1.8,
    lines,
    begin(g, S) {
      for (const [ch, path] of [[chA, pathA], [chB, pathB]]) {
        ch.show(true);
        ch.sound(true, ch === chA ? 1 : 0.8);
        ch.heli.rotor = 1;
        ch.heli.lights = true;
        ch.heli.searchOn = false;
        ch.heli.setRopes(0);
        ch.heli.cargo.visible = false;
        ch.flight.setPath(path);
        ch.flight.yaw = Math.atan2(path[1].x - path[0].x, path[1].z - path[0].z);
        ch.flight.at(0, 0);
      }
      W.show(false, g);
      // the militia left in town melt away (the end screen comes after this)
      for (const m of g.insurgents?.list ?? []) {
        if (!m.root.visible) continue;
        m.hide();
        m.inPlay = false;
        if (m.laser) m.laser.visible = false;
      }
      S.plan = cast.map((b, i) => ({ b, to: spots[i] }));
      for (const p of S.plan) {
        p.b.root.visible = true;
        p.b.alive = true;
        p.b.pos.copy(p.to);
        p.b.pos.y = floorAt(g, p.to.x, p.to.z, U);
        p.b.yaw = Math.PI;
      }
      g.player.alive = true;
      // the one on the roof with the launcher
      S.shooter = g.insurgents?.spawn('rpg', shooterAt.clone(), -Math.PI / 2, { post: true, alert: true }) ?? null;
      S.rocket = null;
      S.hit = false;
      S.down = false;
      S.look = V(-30, U + 14, -170);
      S.fallFrom = null;
    },
    tick(g, S, t, dt) {
      const hA = chA.heli, hB = chB.heli;
      // ---- A: in, hit, the spiral down
      if (!S.hit) chA.flight.at(Math.min(1, easeOut(Math.min(1, t / ARRIVE)) * 1.0), dt);
      else if (!S.down) {
        const k = span(t, HIT, IMPACT);
        const f = S.fallFrom;
        const r = hA.root;
        r.position.set(lerp(f.x, crash.x, easeOut(k)) + Math.sin(t * 5) * 0.6 * (1 - k), lerp(f.y, crash.y, easeIn(k)), lerp(f.z, crash.z, easeOut(k)) + Math.cos(t * 4) * 0.6 * (1 - k));
        const e = t - HIT;
        r.rotation.set(0, S.yawHit + 1.4 * e * e, 0);
        hA.body.rotation.set(0.18 * k, 0, Math.sin(t * 3) * 0.25 + 0.4 * k);
        // the tail burning, the smoke behind it
        const tail = hA.toWorld(_a.set(0, 1.5, -3.6));
        if (Math.random() < dt * 60) g.fx.smoke.emit(tail.x, tail.y, tail.z, (Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6, { life: 1.8 + Math.random(), size: 0.7 + Math.random() * 0.6, grow: 1.8, drag: 0.8, gravity: -0.3, color: [0.07, 0.065, 0.06], endColor: [0.2, 0.19, 0.18], alpha: 0.6 });
        if (Math.random() < dt * 40) g.fx.fire.emit(tail.x, tail.y, tail.z, (Math.random() - 0.5) * 0.8, 0.5, (Math.random() - 0.5) * 0.8, { life: 0.3 + Math.random() * 0.3, size: 0.6 + Math.random() * 0.5, grow: 1.6, drag: 2, gravity: -1, color: [5, 2.6, 1.0], endColor: [1.2, 0.3, 0.08] });
        if (t >= IMPACT) {
          S.down = true;
          chA.show(false);
          W.show(true, g);
          M.wreckBurning = true;
          g.fx.explosion(_a.copy(crash).setY(crash.y + 0.4), 2.4);
          g.audio.play('metal_crash', { position: crash, volume: 1 });
          g.shake.add(Math.max(0.2, 1.4 - g.player.pos.distanceTo(crash) / 30));
          for (let i = 0; i < 40; i++) {
            const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 6;
            g.fx.smoke.emit(crash.x, U + 0.3, crash.z, Math.cos(a) * s, 0.4 + Math.random(), Math.sin(a) * s, { life: 2 + Math.random() * 1.5, size: 1 + Math.random(), grow: 1.6, drag: 1.2, gravity: -0.1, color: [0.6, 0.53, 0.43], alpha: 0.45 });
          }
        }
      }
      if (!S.down) chA.update(dt);
      // ---- B: behind it, then over the site's west end
      if (t < 12) chB.flight.at(easeOut(t / 12), dt);
      else chB.flight.hover(_b.set(lerp(-30, holdB.x, span(t, 12, 16)), lerp(22, holdB.y, ease(span(t, 12, 17))), lerp(-146, holdB.z, ease(span(t, 12, 16)))), Math.PI * 0.85, dt);
      chB.update(dt);
      if (t > 14) washDust(g, hB.root.position.x, U, hB.root.position.z, dt, 25);
      // ---- the rocket
      const m = S.shooter;
      if (m) {
        const hp = hA.root.position;
        m.yaw = turn(m.yaw, yawTo(m.pos, hp), dt * 3);
        m.cine(dt, { mode: 'stand', ready: t < LAUNCH + 0.8 ? 1 : 0.5, pitch: Math.atan2(hp.y - (m.pos.y + 1.5), Math.hypot(hp.x - m.pos.x, hp.z - m.pos.z)) });
      }
      if (t >= LAUNCH && !S.rocket && !S.hit) {
        const from = m ? m.gun.localToWorld(V().copy(m.muzzleLocal)) : shooterAt.clone().setY(shooterAt.y + 1.6);
        if (m?.warhead) m.warhead.visible = false;
        // where A will be at HIT
        const aim = chA.flight.curve.getPointAt(Math.min(1, easeOut(HIT / ARRIVE)));
        const mesh = rocketProto().clone();
        g.scene.add(mesh);
        S.rocket = { from, aim: aim.add(_a.set(0, 1.2, 0)).clone(), mesh, trail: 0 };
        g.audio.play('rpg_fire', { position: from, volume: 1 });
        g.fx.muzzleWorld(from, _d.copy(S.rocket.aim).sub(from).normalize(), 1.6);
      }
      const R = S.rocket;
      if (R && !S.hit) {
        const u = span(t, LAUNCH, HIT);
        const pos = _a.lerpVectors(R.from, R.aim, u);
        pos.y += Math.sin(Math.PI * u) * 1.2;
        R.mesh.position.copy(pos);
        R.mesh.lookAt(_b.copy(pos).sub(_c.copy(R.aim).sub(R.from)));
        R.trail += dt;
        while (R.trail > 0.012) {
          R.trail -= 0.012;
          g.fx.smoke.emit(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 0.6, Math.random() * 0.3, (Math.random() - 0.5) * 0.6, { life: 1.4 + Math.random(), size: 0.3 + Math.random() * 0.15, grow: 1.8, drag: 1.5, gravity: -0.15, color: [0.72, 0.7, 0.66], alpha: 0.45, fadeIn: 0.03 });
        }
        if (u >= 1) {
          S.hit = true;
          g.scene.remove(R.mesh);
          S.fallFrom = hA.root.position.clone();
          S.yawHit = hA.root.rotation.y;
          const tail = hA.toWorld(V(0, 1.5, -3.2));
          g.fx.explosion(tail, 1.2);
          chA.sound(true, 1.2);
        }
      }
      // ---- the fireteam: watching the sky, flinching at the crash
      for (const p of S.plan) {
        const look = S.hit && !S.down ? hA.root.position : S.down ? crash : hA.root.position;
        p.b.cine(dt, { mode: t > IMPACT && t < IMPACT + 1.2 ? 'crouch' : 'stand', ready: 0.5, look });
      }
      // ---- the camera
      if (t < 4.4) {
        // behind the fireteam, looking north for the birds
        const k = ease(span(t, 0, 4.4));
        S.look.lerp(hA.root.position, Math.min(1, dt * 1.5));
        cam(g, _p.set(-11.4, U + 1.45, lerp(-113.2, -113.8, k)), _l.copy(S.look), 50, 0.006);
      } else if (t < 6.4) {
        // the roof to the east: the launcher comes up
        cam(g, _p.set(-4, U + 1.6, -119), _l.set(shooterAt.x, shooterAt.y + 1.3, shooterAt.z), 16, 0.003);
      } else if (t < IMPACT + 1.4) {
        // following it down
        S.look.lerp(S.hit ? hA.root.position : R?.mesh.position ?? hA.root.position, Math.min(1, dt * 5));
        cam(g, _p.set(-9.2, U + 1.6, -113.6), _l.copy(S.look), 50, t > IMPACT ? 0.03 * Math.max(0, 1 - (t - IMPACT)) : 0.008);
      } else {
        // the burning wreck, the second bird coming round behind it
        const k = ease(span(t, IMPACT + 1.4, dur));
        S.look.lerpVectors(_a.set(crash.x, crash.y + 0.6, crash.z), hB.root.position, 0.25 + 0.5 * k);
        cam(g, _p.set(lerp(-6.8, -7.8, k), U + 1.7, lerp(-113.4, -114.4, k)), _l.copy(S.look), 54, 0.006);
      }
    },
    end(g, S, skipped) {
      if (S.rocket?.mesh.parent) g.scene.remove(S.rocket.mesh);
      if (!W.shown) W.show(true, g);
      M.wreckBurning = true;
      chA.show(false);
      chB.show(false);
      if (S.shooter) {
        S.shooter.hide();
        S.shooter.inPlay = false;
      }
      for (const p of S.plan) {
        if (p.b === double) p.b.hide();
        else p.b.endCine();
      }
    },
  };
}
