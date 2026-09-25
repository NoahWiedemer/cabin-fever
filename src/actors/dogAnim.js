// Procedural quadruped animation for the Mutant Dog. Writes the proxy bones of a quadruped GLB body
// (gltfCharacter.js makeQuadTemplate); rig.sync() then retargets them onto the real joints.
// Proxy frame = character frame: +Z forward, +Y up, +X left. Rotating about +X by a positive angle
// swings a down-pointing limb backward and tips a forward-pointing one (head, snout) down.
// Gait: diagonal trot blending into a rotary gallop, stance/swing per leg, spine flex, head
// stabilization, tail sway; plus snarling idle, bite lunge, pounce, hit flinch and a death roll.
import { clamp, lerp, rand } from '../core/utils.js';

const TAU = Math.PI * 2;
const frac = (x) => x - Math.floor(x);

function rot(b, k, x, y = 0, z = 0) {
  const o = b[k];
  if (o) o.rotation.set(x, y, z);
}

/** stance: paw sweeps front → back on the ground; swing: lifts and returns. swing +1 = paw forward */
function legPhase(p, duty, out) {
  if (p < duty) {
    out.swing = 1 - 2 * (p / duty);
    out.lift = 0;
  } else {
    const k = (p - duty) / (1 - duty);
    out.swing = -Math.cos(Math.PI * k);
    out.lift = Math.sin(Math.PI * k);
  }
  return out;
}
const _lp = { swing: 0, lift: 0 };

export function poseDog(z, dt) {
  const b = z.bones;
  if (!z.alive) {
    poseDogDeath(z);
    return;
  }
  const rest = z.rest;
  const t = z.phase2;
  const f = z.flinch;
  if (z.legLen == null) z.legLen = b.fMidL.position.length() + b.fLowL.position.length() + b.fPawL.position.length();

  // ---- gait clock: cadence from speed so planted paws don't slide (stance length = 2 L sin A)
  const sp = z.moveSpeed;
  const run = clamp((sp - 2.0) / 2.2, 0, 1);
  const moving = clamp(sp / 0.5, 0, 1);
  const A = lerp(0.28, 0.42, run) * moving;
  const duty = lerp(0.55, 0.38, run);
  const hz = clamp((sp * duty) / (2 * z.legLen * Math.max(0.12, Math.sin(A))), 0.8, 4.2);
  z.phase += dt * TAU * hz * Math.min(1, moving * 3);
  const cyc = z.phase / TAU;
  const s1 = Math.sin(TAU * cyc);

  // ---- body
  const air = (z.airT = lerp(z.airT ?? 0, z.body.onGround ? 0 : 1, Math.min(1, dt * 12)));
  const snarl = (1 - moving) * (z.alerted ? 1 : 0.4);
  let rootY = -moving * lerp(0.015, 0.03, run) * (0.5 + 0.5 * Math.cos(TAU * cyc * 2)) - 0.05 * snarl;
  let rootZ = 0;
  let pitch = run * 0.07 * Math.sin(TAU * cyc + 1.0) + 0.06 * snarl + f.x * 0.25;
  const yaw = moving * (1 - run) * 0.05 * s1 + f.z * 0.3;
  const roll = moving * (1 - run) * 0.035 * s1 - f.z * 0.2;
  let spineX = run * 0.14 * Math.sin(TAU * cyc + 2.2) + f.x * 0.35;
  let chestX = -run * 0.08 * Math.sin(TAU * cyc + 2.6) + f.x * 0.25;
  // head: steady against the body's rocking, lower and trembling when snarling
  let neckX = -(pitch + spineX + chestX) * 0.8 - 0.12 * run + 0.06 * moving * Math.sin(TAU * cyc * 2 + 0.5) + 0.18 * snarl - f.y * 0.4;
  let headX = 0.04 * Math.sin(t * 1.3 + z.id) * (1 - moving) + z.twitch.x * 0.15;
  let jawX = snarl * (0.03 * Math.sin(t * 23) + 0.04) + moving * 0.03 * Math.sin(t * 9);
  const headY = z.twitch.y * 0.25 * (1 - run);

  // ---- legs (front pair on the chest, hind pair on the root)
  let fReach = 0, hPush = 0, fTuck = 0;
  // bite: crouch back, then lunge and snap
  if (z.attackT >= 0) {
    const a = z.attackT;
    const wind = a < 0.35 ? a / 0.35 : Math.max(0, 1 - (a - 0.35) / 0.15);
    const strike = a < 0.35 ? 0 : a < 0.6 ? (a - 0.35) / 0.25 : Math.max(0, 1 - (a - 0.6) / 0.4);
    rootY -= 0.06 * wind;
    rootZ += -0.07 * wind + 0.18 * strike;
    pitch += 0.08 * wind - 0.14 * strike;
    neckX += 0.22 * wind - 0.5 * strike;
    jawX -= 0.3 * Math.sin(Math.min(1, strike * 1.4) * Math.PI);
    fReach += 0.45 * strike;
    hPush += 0.3 * strike;
  }
  // pounce / airborne: forelegs reach, hind legs trail, nose up on the way up
  if (air > 0.01) {
    const up = clamp(z.body.vel.y / 4, -1, 1);
    pitch = lerp(pitch, -0.12 * up, air);
    fReach = lerp(fReach, 0.8, air);
    hPush = lerp(hPush, 0.7, air);
    fTuck = air * 0.5;
    neckX = lerp(neckX, -0.25, air);
    jawX -= air * 0.15;
  }
  const bodyPitch = pitch + spineX + chestX;
  for (const [pre, s, o] of [
    ['f', 'L', lerp(0, 0.55, run)],
    ['f', 'R', lerp(0.5, 0.65, run)],
    ['h', 'L', lerp(0.5, 0, run)],
    ['h', 'R', lerp(0, 0.12, run)],
  ]) {
    const lp = legPhase(frac(cyc + o), duty, _lp);
    const lift = lp.lift * moving * (1 - air);
    const k = (n) => pre + n + s;
    if (pre === 'f') {
      const up = -lp.swing * A * (1 - air) - fReach - bodyPitch;
      const mid = -lerp(0.35, 0.6, run) * lift - 0.2 * fTuck;
      const low = lerp(1.0, 1.5, run) * lift + 0.3 * fTuck;
      rot(b, k('Upper'), up, 0, 0);
      rot(b, k('Mid'), mid, 0, 0);
      rot(b, k('Low'), low, 0, 0);
      rot(b, k('Paw'), -(up + mid + low + bodyPitch) * 0.8 + 0.2 * lift);
    } else {
      const up = -lp.swing * A * (1 - air) + hPush - pitch;
      const mid = lerp(0.5, 0.8, run) * lift + 0.3 * hPush;
      const low = -lerp(0.7, 1.0, run) * lift - 0.2 * hPush;
      rot(b, k('Upper'), up, 0, 0);
      rot(b, k('Mid'), mid, 0, 0);
      rot(b, k('Low'), low, 0, 0);
      rot(b, k('Paw'), -(up + mid + low + pitch) * 0.8);
    }
  }

  // ---- trunk, head, tail, dangling extras
  b.root.position.set(rest.root.x, rest.root.y + rootY, rest.root.z + rootZ);
  b.root.rotation.set(pitch, yaw, roll);
  rot(b, 'spine', spineX, -yaw * 0.6, 0.04 * Math.sin(t * 0.9));
  rot(b, 'chest', chestX, -yaw * 0.6 + f.z * 0.2, -roll * 0.5);
  rot(b, 'neck', neckX, headY, 0);
  rot(b, 'head', headX, headY * 0.5, 0.05 * Math.sin(t * 0.7 + z.id));
  rot(b, 'jaw', jawX);
  const wag = (lag) => (moving > 0.3 ? 0.35 * Math.sin(TAU * cyc - lag) : 0.25 * Math.sin(t * 2.1 + z.id - lag));
  rot(b, 'tail0', 0.2 + 0.3 * run + 0.25 * snarl, wag(0), 0);
  rot(b, 'tail1', 0.1, wag(0.7), 0);
  rot(b, 'tail2', 0.1, wag(1.4), 0);
  for (let i = 0; i < 4; i++) rot(b, 'extra' + i, 0.2 * Math.sin(TAU * cyc + i) * moving + 0.08 * Math.sin(t * 1.7 + i), 0, 0.1 * Math.sin(t * 1.3 + i * 2));
}

/** roll onto the side, legs stiffen, head and tail go limp; body lifted so it rests on the floor */
function poseDogDeath(z) {
  const b = z.bones;
  const rest = z.rest;
  const T = 0.55;
  const k = Math.min(1, z.deathT / T);
  const e = k * k;
  let bounce = 0;
  if (z.deathT > T) {
    const bt = z.deathT - T;
    bounce = Math.exp(-bt * 9) * Math.sin(bt * 22) * 0.07;
  }
  const dir = z.fallSide >= 0 ? 1 : -1;
  const a = dir * ((Math.PI / 2) * e - bounce);
  z.root.rotation.x = 0;
  z.root.rotation.z = a;
  // lift along world up (in the rolled frame) by the torso's half thickness
  z.deathLift = lerp(z.deathLift ?? 0, 0.16 * z.scale * e, 0.5);
  const L = z.deathLift / z.scale;
  z.mesh.position.set(L * Math.sin(a), L * Math.cos(a), 0);
  b.root.position.set(rest.root.x, rest.root.y, rest.root.z);
  b.root.rotation.set(0, 0, 0);
  rot(b, 'spine', 0.15 * e, 0, 0);
  rot(b, 'chest', 0.1 * e, 0, 0);
  rot(b, 'neck', 0.35 * e, 0.3 * e * dir, 0);
  rot(b, 'head', 0.1 * e, 0, 0);
  rot(b, 'jaw', -0.25 * e);
  rot(b, 'tail0', -0.2 * e, 0.3 * e, 0);
  for (const s of ['L', 'R']) {
    rot(b, 'fUpper' + s, -0.45 * e, 0, 0);
    rot(b, 'fMid' + s, -0.1 * e, 0, 0);
    rot(b, 'fLow' + s, 0.3 * e, 0, 0);
    rot(b, 'hUpper' + s, 0.5 * e, 0, 0);
    rot(b, 'hMid' + s, 0.2 * e, 0, 0);
    rot(b, 'hLow' + s, -0.2 * e, 0, 0);
  }
}

/** fresh per-spawn state */
export function resetDog(z) {
  z.airT = 0;
  z.deathLift = 0;
  z.phase = rand(0, TAU);
}
