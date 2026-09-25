// Ranch layout (pure data + small helpers, no three.js). The barn stands north-east of the farmhouse, turned
// 35° so its big doors face the house's east side across a shared farmyard (the courtyard between the
// kitchen wall hole, the back door and the barn doors).
//
//   Farmhouse x -12..12, z -8..8 (kitchen wall hole on the east wall x = 12, back door on the north wall).
//   The barn is built in its own LOCAL frame (the old axis-aligned layout: x 21..35, z -8..4, ridge along x,
//   big doors in the west gable at local x = 21) and placed by BARN_XF: local pivot (28, -2) (the barn's
//   centre) -> world (26.5, -11.5), rotated by 35° (three.js rotation.y). World footprint corners ≈
//   (17.3, -12.4) (24.2, -2.6) (35.7, -10.6) (28.8, -20.4); the main doors sit at ≈ (20.8, -7.5), facing
//   the house (outward ≈ (-0.82, 0.57)).
//   Floor y -0.38, hayloft (level 2, y 3.1) over local x 21.2..26.6, a vertical ladder on its edge.
//   Collision: the barn's boxes become oriented boxes (collision.js addOBB).
//   Paddock south-east of the barn (world x 23..34, z 2..12), windmill + stock tank and the chicken coop
//   behind the house (north), tractor and hay wagon in the farmyard.

export const BARN = { x0: 21, x1: 35, z0: -8, z1: 4, floor: -0.38, eave: 5.0, knee: 7.55, ridge: 9.0, knee_in: 1.8, t: 0.2 };
BARN.zc = (BARN.z0 + BARN.z1) / 2; // ridge line (local z = -2)

export const LOFT = { x0: 21.2, x1: 26.6, z0: BARN.z0 + 0.2, z1: BARN.z1 - 0.2, y: 3.1, under: 2.88 };

// local -> world placement of the barn
export const BARN_XF = { yaw: (35 * Math.PI) / 180, px: (BARN.x0 + BARN.x1) / 2, pz: BARN.zc, wx: 26.5, wz: -11.5 };
const COS = Math.cos(BARN_XF.yaw), SIN = Math.sin(BARN_XF.yaw);
BARN_XF.cos = COS;
BARN_XF.sin = SIN;
BARN_XF.hx = (BARN.x1 - BARN.x0) / 2; // half extents about the pivot
BARN_XF.hz = (BARN.z1 - BARN.z0) / 2;

/** barn-local (x, z) -> world [x, z] */
export function barnToWorld(lx, lz, out = [0, 0]) {
  const dx = lx - BARN_XF.px, dz = lz - BARN_XF.pz;
  out[0] = BARN_XF.wx + dx * COS + dz * SIN;
  out[1] = BARN_XF.wz - dx * SIN + dz * COS;
  return out;
}
/** world (x, z) -> barn-local [x, z] */
export function worldToBarn(x, z, out = [0, 0]) {
  const dx = x - BARN_XF.wx, dz = z - BARN_XF.wz;
  out[0] = BARN_XF.px + dx * COS - dz * SIN;
  out[1] = BARN_XF.pz + dx * SIN + dz * COS;
  return out;
}
/** a barn-local direction -> world [x, z] */
export function barnDir(lx, lz, out = [0, 0]) {
  out[0] = lx * COS + lz * SIN;
  out[1] = -lx * SIN + lz * COS;
  return out;
}
const _l = [0, 0];
/** inside the barn's footprint (grown by pad) */
export function inBarn(x, z, pad = 0) {
  worldToBarn(x, z, _l);
  return _l[0] > BARN.x0 - pad && _l[0] < BARN.x1 + pad && _l[1] > BARN.z0 - pad && _l[1] < BARN.z1 + pad;
}

// the vertical ladder on the loft edge, local frame: climbed from the +x side (the open floor), loft behind
export const LADDER_LOCAL = { x: 26.68, z: -5.5, nx: 1, nz: 0, gap: [-6.12, -4.88] };
const lw = barnToWorld(LADDER_LOCAL.x, LADDER_LOCAL.z), ln = barnDir(1, 0);
// world definition (actors/ladders.js): rungs in the plane through (x, z), climbers hang `stand` m out along n
export const LADDER = { id: 'barnLadder', x: lw[0], z: lw[1], nx: ln[0], nz: ln[1], width: 0.56, yBottom: BARN.floor, yTop: LOFT.y, stand: 0.4 };
const la = barnToWorld(LADDER_LOCAL.x + 0.95, LADDER_LOCAL.z), lb = barnToWorld(LADDER_LOCAL.x - 0.8, LADDER_LOCAL.z);
export const LADDER_A = { level: 1, x: la[0], z: la[1] }; // floor, in front of the ladder
export const LADDER_B = { level: 2, x: lb[0], z: lb[1] }; // loft, behind its top

// oriented rects { x, z (centre), cos, sin (the barn's rotation), hx, hz }: fog "inside", rain roof
export const BARN_INSIDE = { x: BARN_XF.wx, z: BARN_XF.wz, cos: COS, sin: SIN, hx: BARN_XF.hx + 0.1, hz: BARN_XF.hz + 0.1 };
export const BARN_ROOF = { x: BARN_XF.wx, z: BARN_XF.wz, cos: COS, sin: SIN, hx: BARN_XF.hx + 0.45, hz: BARN_XF.hz + 0.45 };
export const HOUSE_FOG_RECT = [-12.3, -8.3, 12.3, 8.3];

// world rects [x0, x1, z0, z1]: zombie spawn points are pushed out of these (and the barn), no trees in TREE_CLEAR
export const PADDOCK = { x0: 23, x1: 34, z0: 2, z1: 12 };
export const RANCH_BLOCKS = [
  [PADDOCK.x0 - 0.6, PADDOCK.x1 + 0.6, PADDOCK.z0 - 0.6, PADDOCK.z1 + 0.6],
  [6.0, 12.5, -21.5, -15.5], // windmill + stock tank
  [1.5, 5.5, -16.8, -12.6], // chicken coop
];
export const TREE_CLEAR = [
  [12.5, 24.5, -20.0, 9.0], // the farmyard between house and barn, the track to the windmill
  [21.0, 36.0, 0.0, 14.0], // paddock
  [0.0, 13.5, -23.0, -8.8], // back yard: coop, windmill, the path from the back door
];
export const BARN_CLEAR_PAD = 3.0; // no trees this close to the barn walls

export function inRect(r, x, z, pad = 0) {
  return x > r[0] - pad && x < r[1] + pad && z > r[2] - pad && z < r[3] + pad;
}
