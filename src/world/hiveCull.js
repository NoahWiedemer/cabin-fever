// Plan-level visibility for the Hive's static meshes. The level is ~100 chunk x material meshes of world-space
// geometry; the view frustum culls those behind the camera, but not the ones in the next room, behind a wall. Every few
// tenths of a second the plan is ray-cast from the camera on a coarse grid (1 m cells): a mesh is drawn when any coarse
// cell of its bounding box can be seen (an unobstructed line over the plan's open cells to the cell's middle or to one of
// its corners, or the cell is close by). It errs on the side of drawing.
import * as THREE from 'three';

/**
 * makeCuller(group, plan): plan = { open (Uint8Array, 0 = wall / solid), NX, NZ, PX0, PZ0, C } (the hive's 0.25 m grid)
 * Returns { update(camPosition), setEnabled(on) }; only the kit's chunk meshes (userData.chunk) are managed, huge ones never hidden.
 */
export function makeCuller(group, { open, NX, NZ, PX0, PZ0, C }) {
  const CELL = 1; // coarse grid (m)
  const GX = Math.ceil((NX * C) / CELL), GZ = Math.ceil((NZ * C) / CELL);
  const cellsOf = new Map(); // mesh → Int32Array of coarse cells
  const meshes = [];
  const box = new THREE.Box3();
  group.updateMatrixWorld(true);
  group.traverse((o) => {
    if (!o.isMesh || !o.userData.chunk || !o.geometry) return; // (the kit's chunks: lab.js Kit.build)
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    const x0 = Math.max(0, Math.floor((box.min.x - PX0) / CELL)), x1 = Math.min(GX - 1, Math.floor((box.max.x - PX0) / CELL));
    const z0 = Math.max(0, Math.floor((box.min.z - PZ0) / CELL)), z1 = Math.min(GZ - 1, Math.floor((box.max.z - PZ0) / CELL));
    const n = (x1 - x0 + 1) * (z1 - z0 + 1);
    if (x1 < x0 || z1 < z0 || n > 600) return; // huge (the whole floor): always drawn
    const a = new Int32Array(n);
    let k = 0;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) a[k++] = z * GX + x;
    cellsOf.set(o, a);
    meshes.push(o);
  });
  const seen = new Uint8Array(GX * GZ);
  // coarse cells with any open floor in them (a cell that is all wall has nothing to test)
  const hasOpen = new Uint8Array(GX * GZ);
  const per = Math.round(CELL / C);
  for (let gz = 0; gz < GZ; gz++) {
    for (let gx = 0; gx < GX; gx++) {
      let o = 0;
      for (let j = gz * per; j < Math.min(NZ, (gz + 1) * per) && !o; j++) for (let i = gx * per; i < Math.min(NX, (gx + 1) * per); i++) if (open[j * NX + i]) { o = 1; break; }
      hasOpen[gz * GX + gx] = o;
    }
  }
  const invC = 1 / C;
  /** grid walk from (ax, az) to (bx, bz): true when every cell before the last is open */
  const los = (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len < 0.3) return true;
    const steps = Math.ceil(len * invC * 1.1);
    const sx = dx / steps, sz = dz / steps;
    let x = (ax - PX0) * invC, z = (az - PZ0) * invC;
    const stx = sx * invC, stz = sz * invC;
    for (let s = 1; s < steps; s++) {
      x += stx;
      z += stz;
      const i = x | 0, j = z | 0;
      if (i < 0 || j < 0 || i >= NX || j >= NZ || open[j * NX + i] === 0) return false;
    }
    return true;
  };
  let enabled = !/[?&]cull=0/.test(location.search);
  let lastX = 1e9, lastZ = 1e9, lastT = 0, lastSlice = 0;
  const RADIUS = 80, NEAR = 5, FAR = 30, BUDGET = 1.2; // ms of ray casting per slice
  let seenN = new Uint8Array(GX * GZ); // the pass being built
  let pass = null; // { cx, cz, gz, gz1, gx0, gx1 }
  const inset = 0.3;
  const row = (P, gz) => {
    const { cx, cz, gx0, gx1 } = P;
    const test = (px, pz) => {
      if (los(cx, cz, px, pz)) return true;
      const h = CELL / 2 - inset;
      return los(cx, cz, px - h, pz - h) || los(cx, cz, px + h, pz - h) || los(cx, cz, px - h, pz + h) || los(cx, cz, px + h, pz + h);
    };
    for (let gx = gx0; gx <= gx1; gx++) {
      const k = gz * GX + gx;
      if (!hasOpen[k]) continue;
      const px = PX0 + (gx + 0.5) * CELL, pz = PZ0 + (gz + 0.5) * CELL;
      const dx = px - cx, dz = pz - cz;
      const d2 = dx * dx + dz * dz;
      let v = d2 < NEAR * NEAR;
      // far cells whose 2 x 2 block's anchor is seen are taken as seen (a long ray saved)
      if (!v && d2 > FAR * FAR && (gx & 1 || gz & 1) && seenN[(gz & ~1) * GX + (gx & ~1)] === 1) v = true;
      if (!v) v = test(px, pz);
      if (v) seenN[k] = 1;
    }
  };
  const apply = () => {
    for (const m of meshes) {
      const a = cellsOf.get(m);
      let vis = false;
      for (let i = 0; i < a.length; i++) {
        if (seenN[a[i]]) {
          vis = true;
          break;
        }
      }
      m.visible = vis;
    }
  };
  /** starts a pass when the camera has moved (or 250 ms passed), then casts a slice of rows each call; force: all at once */
  const update = (cam, force = false) => {
    if (!enabled) return;
    const now = performance.now();
    // a cut (menu shots, a respawn): the view is somewhere else, so the old answer is wrong everywhere: all at once
    if (Math.hypot(cam.x - lastX, cam.z - lastZ) > 6) {
      force = true;
      pass = null;
    }
    if (!pass) {
      if (!force && now - lastT < 250 && Math.hypot(cam.x - lastX, cam.z - lastZ) < 0.6) return;
      lastT = now;
      lastX = cam.x;
      lastZ = cam.z;
      seenN.fill(0);
      pass = {
        cx: cam.x,
        cz: cam.z,
        gx0: Math.max(0, Math.floor((cam.x - RADIUS - PX0) / CELL)),
        gx1: Math.min(GX - 1, Math.floor((cam.x + RADIUS - PX0) / CELL)),
        gz: Math.max(0, Math.floor((cam.z - RADIUS - PZ0) / CELL)),
        gz1: Math.min(GZ - 1, Math.floor((cam.z + RADIUS - PZ0) / CELL)),
      };
    }
    if (!force && now - lastSlice < 6) return; // (one slice per ~frame: the passes of a frame call this several times)
    lastSlice = now;
    while (pass.gz <= pass.gz1 && (force || performance.now() - now < BUDGET)) row(pass, pass.gz++);
    if (pass.gz > pass.gz1) {
      apply();
      seen.set(seenN);
      pass = null;
    }
  };
  return {
    update,
    setEnabled(on) {
      enabled = on;
      if (!on) for (const m of meshes) m.visible = true;
    },
  };
}
