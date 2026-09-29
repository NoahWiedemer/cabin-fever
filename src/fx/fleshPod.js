// The Striker's flesh pod (Combat Arms' Striker leaves these behind): a lumpy, veined sac of meat, lit from inside by
// whatever is about to go off. Three burst out of every Striker that dies (game/projectiles.js strikerPods): they
// slap down, stick, beat faster and faster, swell and blow. Procedural: a displaced sphere with painted skin, a bump
// map (raised veins, lumpy tissue: it breaks up the wet highlight) and veins that glow through it (emissive map;
// projectiles.js pulses the intensity). Named parts: sac (the mesh, own material per pod) and glow (a halo sprite,
// bloom picks it up).
import * as THREE from 'three';

export const POD_R = 0.075; // m: a fist-sized sac

function canvasTexture(w, h, draw, color = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

const rnd = (a, b) => a + Math.random() * (b - a);

/** a vein: a wandering path across the equirect map (h: its height), as points */
function veinPath(x, y, len, h) {
  let a = rnd(0, Math.PI * 2);
  const pts = [[x, y]];
  for (let s = 0; s < len; s += 4) {
    a += rnd(-0.5, 0.5);
    x += Math.cos(a) * 4;
    y = Math.min(h - 2, Math.max(2, y + Math.sin(a) * 4));
    pts.push([x, y]);
  }
  return pts;
}

/** stroke a path, again one map width to either side so it wraps round the seam */
function stroke(c, w, pts, width) {
  for (const off of [-w, 0, w]) {
    c.beginPath();
    pts.forEach(([px, py], i) => (i ? c.lineTo(px + off, py) : c.moveTo(px + off, py)));
    c.lineWidth = width;
    c.stroke();
  }
}

let SKIN = null, VEINS = null, BUMP = null, HALO = null;

/** soft round blobs, wrapped round the seam */
function blobs(c, w, h, n, rMin, rMax, color, aMin, aMax, yPad = 0) {
  for (let i = 0; i < n; i++) {
    const x = rnd(0, w), y = rnd(yPad, h - yPad), r = rnd(rMin, rMax), col = typeof color === 'function' ? color(i) : color;
    c.globalAlpha = rnd(aMin, aMax);
    for (const off of [-w, 0, w]) {
      const g = c.createRadialGradient(x + off, y, 0, x + off, y, r);
      g.addColorStop(0, col);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x + off - r, y - r, r * 2, r * 2);
    }
  }
  c.globalAlpha = 1;
}

function textures() {
  if (SKIN) return;
  // the veins: the same paths dark under the skin, raised in the bump map and burning in the glow map
  const veins = Array.from({ length: 22 }, () => ({ pts: veinPath(rnd(0, 256), rnd(12, 116), rnd(40, 110), 128), width: rnd(1, 2.4) }));
  // raw meat: dark red, blotches of fresher red, pink fat and bruise purple, dark veins under the skin
  SKIN = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#420b09';
    c.fillRect(0, 0, w, h);
    const tones = ['#7c1a13', '#5e120e', '#93302a', '#2e0506', '#a3483e', '#5a1428'];
    blobs(c, w, h, 170, 4, 20, (i) => tones[i % tones.length], 0.35, 0.7);
    blobs(c, w, h, 14, 3, 9, '#c77a6c', 0.35, 0.6, 10); // fat
    blobs(c, w, h, 10, 8, 18, '#3b0a2a', 0.4, 0.7, 10); // bruises
    c.strokeStyle = 'rgba(38,4,18,0.8)';
    c.lineCap = 'round';
    for (const v of veins) stroke(c, w, v.pts, v.width);
  });
  // the relief: lumpy tissue, fine pits and the veins standing out
  BUMP = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#707070';
    c.fillRect(0, 0, w, h);
    blobs(c, w, h, 90, 3, 12, '#b4b4b4', 0.4, 0.8);
    blobs(c, w, h, 60, 2, 7, '#2a2a2a', 0.3, 0.6);
    c.strokeStyle = '#e0e0e0';
    c.lineCap = 'round';
    for (const v of veins) stroke(c, w, v.pts, v.width * 1.4);
  }, false);
  // what glows through: the same veins burning orange, and a few hot patches where the skin is thin
  VEINS = canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, w, h);
    blobs(c, w, h, 12, 8, 22, 'rgba(255,120,40,0.55)', 1, 1, 20);
    c.lineCap = 'round';
    c.shadowColor = 'rgba(255,110,30,1)';
    c.shadowBlur = 5;
    c.strokeStyle = '#ffb04a';
    for (const v of veins) stroke(c, w, v.pts, v.width * 0.7);
  });
  HALO = canvasTexture(64, 64, (c, w) => {
    const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, w);
  });
}

/** One pod (clone it and give each clone its own `sac` / `glow` materials so they beat out of step). */
export function buildFleshPod() {
  textures();
  const geo = new THREE.SphereGeometry(1, 28, 20);
  // lumps: a few broad bulges and fine wrinkles, a little taller than wide
  const lobes = Array.from({ length: 7 }, () => new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize());
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let k = 1;
    for (const l of lobes) k += 0.2 * Math.pow(Math.max(0, v.dot(l)), 3);
    k += 0.035 * Math.sin(v.x * 11 + v.y * 7) * Math.sin(v.z * 9 - v.y * 5);
    v.multiplyScalar(k * POD_R);
    v.y *= 1.12;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  // the sphere's seam and poles are split vertices: average their normals, or the seam shows as a crease
  const nrm = geo.attributes.normal;
  const sum = new Map();
  const key = (i) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i);
    const s = sum.get(k) ?? sum.set(k, new THREE.Vector3()).get(k);
    s.x += nrm.getX(i);
    s.y += nrm.getY(i);
    s.z += nrm.getZ(i);
  }
  for (let i = 0; i < pos.count; i++) {
    const s = sum.get(key(i)).clone().normalize();
    nrm.setXYZ(i, s.x, s.y, s.z);
  }
  geo.computeBoundingSphere();
  const sac = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: SKIN, bumpMap: BUMP, bumpScale: 2, roughness: 0.45, metalness: 0, emissive: 0xff5a1a, emissiveMap: VEINS, emissiveIntensity: 0.3 })
  );
  sac.name = 'sac';
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: HALO, color: 0xff4a18, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.name = 'glow';
  glow.scale.setScalar(0.25);
  const g = new THREE.Group();
  g.add(sac, glow);
  return g;
}
