// Layout constants of the Appenweier map (src/world/appenweier.js), shared with what needs them before the
// level is built (the fog shader's "inside" rects at boot: world/maps.js). Coordinates are those of
// public/maps/appenweier.json (tools/appenweier-data.mjs): metres, turned so the fire station's walls run
// along x / z; Sander Straße runs roughly along +x at z ≈ 15..24, Sanderstraße 13 / 13a / 13c lie north of
// it (z < 0), the fire station south-west of it, the drugstore (Im See 18) north-east.
export const AW_GROUND = -0.5; // the yard / street level (like the farm's yard)
export const AW_FLOOR = -0.45; // floors inside (a threshold above the street)

// playable area (invisible walls just inside, the fog hides them) = the nav grid's extent
export const AW_BOUNDS = { minX: -96, maxX: 106, minZ: -72, maxZ: 88 };

// the fire station's vehicle hall (Sander Straße 22): walls' outer faces; doors on the north side (z0). Heights
// above the street: the ceiling, the tops of the three roller doors, the walls up to the eaves (the LoD2 walls
// above them stay: the gables)
export const HALL = { x0: -55.1, x1: -41.3, z0: 43.4, z1: 70.3, ceil: 3.75, doorTop: 3.4, wallTop: 3.91 };
// the double garage behind Sanderstraße 13a: the gun shop (its left door stands open between rounds)
const G_ROT = (4.95 * Math.PI) / 180; // edge angle (x -> z); rotation.y is -G_ROT
export const GARAGE = { x: -17.26, z: -38.34, hx: 4.52, hz: 2.95, ang: G_ROT, wall: 2.6, door: 2.1 };
// the drugstore's sales floor (Im See 18): corner A, long axis v (toward the store room), short axis u
const D_ANG = (17.07 * Math.PI) / 180;
export const DM = {
  ax: 62.02, az: -13.93, // south-west corner (A)
  u: [Math.cos(D_ANG), Math.sin(D_ANG)], w: 19.83, // along the shop front (A -> B)
  v: [Math.sin(D_ANG), -Math.cos(D_ANG)], d: 36.8, // into the store (A -> the north-west corner; an 8 m wide store room goes on 21 m past it on the east side)
  ang: D_ANG,
  ceil: 3.6,
};

/** oriented rect { x, z, cos, sin, hx, hz } (rotation.y convention) of a rect turned by edge angle `ang` */
export function orientedRect(cx, cz, hx, hz, ang, pad = 0) {
  return { x: cx, z: cz, cos: Math.cos(-ang), sin: Math.sin(-ang), hx: hx + pad, hz: hz + pad };
}
export const DM_CENTER = [
  DM.ax + DM.u[0] * DM.w * 0.5 + DM.v[0] * DM.d * 0.5,
  DM.az + DM.u[1] * DM.w * 0.5 + DM.v[1] * DM.d * 0.5,
];

// "inside" areas: no ground fog there (core/fogShader.js), rain stops at their roofs (world/weather.js)
export const AW_INSIDE = [
  [HALL.x0 - 0.1, HALL.z0 - 0.1, HALL.x1 + 0.1, HALL.z1 + 0.1],
  orientedRect(GARAGE.x, GARAGE.z, GARAGE.hx, GARAGE.hz, GARAGE.ang, 0.1),
  orientedRect(DM_CENTER[0], DM_CENTER[1], DM.w / 2, DM.d / 2, DM.ang, 0.1),
];
