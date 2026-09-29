// Shadow proxies for the static level. The shadow maps (the lamps' every other frame, the moon's every third) redraw
// the level each time, and LevelBuilder's output is one mesh per material and 10 m chunk: a few hundred draw calls
// of plain depth per map. For depth the material hardly matters, so the static, opaque casters of the level are
// merged here into one position-only mesh per shadow side and 20 m chunk. The proxies stay hidden except while
// renderer.shadowMap renders (it's wrapped), and the originals stop casting: the same shadows, far fewer draws.
//
// Only meshes LevelBuilder.finish() / batchStatic() made are taken (matrixAutoUpdate off, straight under a 'level'
// or 'batched' group), never the dynamic ones (doors, barricades: 'dynamicLevel'), and none whose depth needs the
// material (alpha test, displacement, clipping). Should one of them ever be hidden, its chunk goes back to the
// original meshes for good.
import * as THREE from 'three';

const CHUNK = 20; // m: the proxies are still culled per shadow camera
const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
const STATIC_GROUPS = new Set(['level', 'batched']);

function depthOnly(m, root) {
  if (!m.isMesh || m.isSkinnedMesh || m.isInstancedMesh || !m.castShadow || m.matrixAutoUpdate) return false;
  if (m.customDepthMaterial || m.morphTargetInfluences || Array.isArray(m.material)) return false;
  for (let p = m.parent; p && p !== root.parent; p = p.parent) if (!STATIC_GROUPS.has(p.name) || !p.visible) return false;
  const mat = m.material;
  if (!mat || !mat.visible || !m.visible || mat.transparent || mat.alphaTest > 0 || mat.alphaToCoverage) return false;
  if (mat.displacementMap || mat.clippingPlanes?.length) return false;
  return !!m.geometry?.attributes?.position;
}

function visibleInScene(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

/** Merge the sources' positions (world space) into one indexed, position-only geometry. */
function mergePositions(sources) {
  let nv = 0;
  let ni = 0;
  for (const m of sources) {
    const g = m.geometry;
    nv += g.attributes.position.count;
    ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3();
  let vo = 0;
  let io = 0;
  for (const m of sources) {
    const g = m.geometry;
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld);
      pos[(vo + i) * 3] = v.x;
      pos[(vo + i) * 3 + 1] = v.y;
      pos[(vo + i) * 3 + 2] = v.z;
    }
    const flip = m.matrixWorld.determinant() < 0; // a mirrored transform turns the winding round
    const n = g.index ? g.index.count : P.count;
    const start = Math.max(0, g.drawRange.start);
    const end = Math.min(n, start + g.drawRange.count);
    for (let i = start; i + 2 < end; i += 3) {
      const a = g.index ? g.index.getX(i) : i;
      const b = g.index ? g.index.getX(i + 1) : i + 1;
      const c = g.index ? g.index.getX(i + 2) : i + 2;
      idx[io++] = vo + a;
      idx[io++] = vo + (flip ? c : b);
      idx[io++] = vo + (flip ? b : c);
    }
    vo += P.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(io === idx.length ? idx : idx.slice(0, io), 1));
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/**
 * Build the proxies for a level group (already in the scene) and hook them into the renderer's shadow pass.
 * Returns { chunks: [{ proxy, sources, dead }], merged: the number of meshes they stand in for } (debugging).
 */
export function installShadowProxies(renderer, root) {
  root.updateWorldMatrix(true, true);
  const buckets = new Map();
  const c = new THREE.Vector3();
  root.traverse((m) => {
    if (!depthOnly(m, root)) return;
    const side = m.material.shadowSide ?? SHADOW_SIDE[m.material.side];
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    c.copy(m.geometry.boundingSphere.center).applyMatrix4(m.matrixWorld);
    const key = `${side}|${Math.floor(c.x / CHUNK)},${Math.floor(c.z / CHUNK)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { side, sources: [] }));
    b.sources.push(m);
  });
  const mats = {};
  const chunks = [];
  let merged = 0;
  for (const b of buckets.values()) {
    const mat = (mats[b.side] ??= new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
    mat.shadowSide = b.side;
    const proxy = new THREE.Mesh(mergePositions(b.sources), mat);
    proxy.name = 'shadowProxy';
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.visible = false; // only inside the shadow pass
    proxy.matrixAutoUpdate = false;
    proxy.raycast = () => {}; // never a hit for bullets, decals or picking
    root.add(proxy);
    proxy.updateMatrixWorld(true);
    for (const m of b.sources) m.castShadow = false;
    merged += b.sources.length;
    chunks.push({ proxy, sources: b.sources, dead: false });
  }
  if (!chunks.length) return { chunks, merged };

  const sm = renderer.shadowMap;
  const render = sm.render;
  const redraws = (l) => l.castShadow && (l.shadow.autoUpdate || l.shadow.needsUpdate);
  sm.render = function (lights, scene, camera) {
    // (most passes redraw no shadow map at all: nothing to do then)
    if (!sm.enabled || (!sm.autoUpdate && !sm.needsUpdate) || !lights.some(redraws)) return render.call(this, lights, scene, camera);
    for (const ch of chunks) {
      if (ch.dead) continue;
      // a source hidden after all: that chunk casts with its own meshes again
      if (!ch.sources.every(visibleInScene)) {
        ch.dead = true;
        ch.proxy.removeFromParent();
        ch.proxy.geometry.dispose();
        for (const m of ch.sources) m.castShadow = true;
        continue;
      }
      ch.proxy.visible = true;
    }
    try {
      render.call(this, lights, scene, camera);
    } finally {
      for (const ch of chunks) ch.proxy.visible = false;
    }
  };
  return { chunks, merged };
}
