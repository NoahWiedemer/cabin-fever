// The gun shop cellar under the back room (geometry in level.js): real weapon models on a pegboard
// with price tags, a glass counter, equipment shelves, a neon sign and the stairwell gate that only
// opens between rounds. Built after the GLB preload because it uses the actual gun models.
//
// Runtime API (game.gunshop): canInteract(player), setOpen(open), evacuate(player), entrance, update(dt)
import * as THREE from 'three';
import { buildWeaponModel } from '../player/gunSafe.js';
import { WEAPONS } from '../player/weaponDefs.js';
import { SHOP_WEAPONS, SHOP_EQUIPMENT } from '../game/shop.js';
import { buildProp } from './propsSafe.js';
import { gasMask, kevlarVest } from './gearModels.js';
import { getMaterial } from './materials.js';
import { getGLB } from '../core/assets.js';
import { MODELS } from '../core/assetList.js';
import { SURF, FLAG_NOBULLET, FLAG_NAVIGNORE } from './collision.js';
import { createShopkeeper } from '../actors/shopkeeper.js';

const WALL_X = 2.56; // shop-side face of the wall shared with the old basement
const F = -3.2; // cellar floor (FLOOR.basement)
const _ray = new THREE.Raycaster();
const _o = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- canvas helpers
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function pegboardTex() {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#6b5236';
    g.fillRect(0, 0, w, h);
    // hardboard grain
    for (let i = 0; i < 1800; i++) {
      g.fillStyle = `rgba(${40 + Math.random() * 30},${28 + Math.random() * 20},${16},${0.05 + Math.random() * 0.07})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1);
    }
    g.fillStyle = '#1b130b';
    for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) {
      g.beginPath();
      g.arc(x, y, 4.2, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function tagTex(name, price) {
  return canvasTex(256, 96, (g, w, h) => {
    g.fillStyle = '#efe6cf';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#9b2a1c';
    g.lineWidth = 6;
    g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = '#1a1a1a';
    g.font = 'bold 30px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText(name, w / 2, 40, w - 20);
    g.fillStyle = '#9b2a1c';
    g.font = 'bold 34px Arial, sans-serif';
    g.fillText(price > 0 ? '$' + price.toLocaleString('en-US') : 'STANDARD', w / 2, 80);
  });
}

function neonTex(text, color) {
  return canvasTex(1024, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.font = 'bold 150px "Impact", "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const [blur, alpha] of [[40, 0.55], [18, 0.8], [4, 1]]) {
      g.shadowColor = color;
      g.shadowBlur = blur;
      g.strokeStyle = color;
      g.globalAlpha = alpha;
      g.lineWidth = 9;
      g.strokeText(text, w / 2, h / 2);
    }
    g.globalAlpha = 1;
    g.shadowBlur = 0;
    g.fillStyle = '#fff4e8';
    g.lineWidth = 3;
    g.strokeStyle = '#ffffff';
    g.strokeText(text, w / 2, h / 2);
  });
}

// ---------------------------------------------------------------- build
export function buildGunShop(scene, level, world) {
  const info = level.shop;
  if (!info) return null;
  const root = new THREE.Group();
  root.name = 'gunshop';
  const price = (id) => SHOP_WEAPONS.find((e) => e.id === id)?.price ?? 0;
  const place = (o, x, y, z, ry = 0) => {
    o.position.set(x, y, z);
    o.rotation.y = ry;
    root.add(o);
    return o;
  };
  const boxMesh = (w, h, d, material, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    root.add(m);
    return m;
  };

  // pegboard on the west wall with a wood frame
  const peg = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.0), new THREE.MeshStandardMaterial({ map: pegboardTex(), roughness: 0.9 }));
  peg.material.map.wrapS = peg.material.map.wrapT = THREE.RepeatWrapping;
  peg.material.map.repeat.set(6.4, 2.0);
  place(peg, WALL_X + 0.01, F + 1.9, -2.7, Math.PI / 2);
  peg.receiveShadow = true;
  const frameMat = getMaterial('woodBeam');
  boxMesh(0.06, 0.08, 6.5, frameMat, WALL_X + 0.03, F + 2.94, -2.7);
  boxMesh(0.06, 0.08, 6.5, frameMat, WALL_X + 0.03, F + 0.86, -2.7);

  // weapons on the pegboard: left side facing the room, muzzles toward +z
  const tagMatFor = (id) => new THREE.MeshStandardMaterial({ map: tagTex(WEAPONS[id]?.name ?? id, price(id)), roughness: 0.8 });
  const pegMat = getMaterial('metalDark');
  const rows = [
    { y: F + 2.42, ids: ['m16a2', 'devotion', 'sigma', 'r201'] },
    { y: F + 1.66, ids: ['m4a1', 'spas12', 'm4super90', 'softball'] },
  ];
  const displayed = [];
  for (const row of rows) {
    const models = row.ids.filter((id) => WEAPONS[id]).map((id) => {
      const m = buildWeaponModel(WEAPONS[id].model).root;
      m.rotation.y = Math.PI;
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m);
      return { id, m, box };
    });
    const gap = 0.22;
    const total = models.reduce((s, it) => s + (it.box.max.z - it.box.min.z), 0) + gap * (models.length - 1);
    let z = -2.7 - total / 2;
    for (const it of models) {
      const len = it.box.max.z - it.box.min.z;
      const cy = (it.box.max.y + it.box.min.y) / 2;
      it.m.position.set(WALL_X + 0.05 - it.box.min.x, row.y - cy, z - it.box.min.z);
      root.add(it.m);
      it.m.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = false;
          o.receiveShadow = true;
        }
      });
      // two pegs under the gun (at its real underside, so a drum doesn't leave them hanging in the
      // air) and a price tag below it
      const hh = (it.box.max.y - it.box.min.y) / 2;
      it.m.updateMatrixWorld(true);
      const cxGun = WALL_X + 0.05 + (it.box.max.x - it.box.min.x) / 2;
      for (const f of [0.28, 0.72]) {
        _ray.set(_o.set(cxGun, row.y - hh - 0.5, z + len * f), _up);
        const hit = _ray.intersectObject(it.m, true)[0];
        const pegRod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 8), pegMat);
        pegRod.rotation.z = Math.PI / 2;
        pegRod.position.set(WALL_X + 0.045, (hit ? hit.point.y : row.y - hh) - 0.004, z + len * f);
        root.add(pegRod);
      }
      const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.113), tagMatFor(it.id));
      place(tag, WALL_X + 0.02, row.y - Math.max(0.24, hh + 0.08), z + len / 2, Math.PI / 2);
      displayed.push(it.id);
      z += len + gap;
    }
  }

  // glass display counter in front of the pegboard, with the pistols and frags inside
  const counterX0 = 3.75, counterX1 = 4.55, counterZ0 = -5.0, counterZ1 = -0.45;
  const cx = (counterX0 + counterX1) / 2, cw = counterX1 - counterX0, cd = counterZ1 - counterZ0, cz = (counterZ0 + counterZ1) / 2;
  boxMesh(cw, 0.62, cd, getMaterial('woodPainted'), cx, F + 0.31, cz);
  boxMesh(cw + 0.04, 0.03, cd + 0.04, getMaterial('woodBeam'), cx, F + 0.635, cz);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xd8e8e4, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.18, depthWrite: false });
  const case_ = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.34, cd), glass);
  case_.position.set(cx, F + 0.82, cz);
  case_.renderOrder = 2;
  root.add(case_);
  boxMesh(cw + 0.02, 0.02, cd + 0.02, getMaterial('chrome'), cx, F + 0.995, cz);
  const felt = boxMesh(cw - 0.06, 0.01, cd - 0.06, new THREE.MeshStandardMaterial({ color: 0x3b0f10, roughness: 1 }), cx, F + 0.655, cz);
  felt.castShadow = false;
  const lying = [['m9', -3.9], ['mozambique', -2.9]];
  for (const [id, z] of lying) {
    if (!WEAPONS[id]) continue;
    const m = buildWeaponModel(WEAPONS[id].model).root;
    place(m, cx - 0.06, F + 0.69, z);
    m.rotation.set(0, 0, -Math.PI / 2); // lying on its right side, left side up, muzzle toward -z
    // flat tag, text readable from the customer side (+x): plane +Z -> up, +Y -> -x
    const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.083), tagMatFor(id));
    tag.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
    tag.position.set(cx + 0.24, F + 0.664, z - 0.08);
    root.add(tag);
  }
  for (let i = 0; i < 3; i++) {
    const nade = buildWeaponModel('m67').root;
    place(nade, cx - 0.12 + i * 0.12, F + 0.7, -1.6 + (i % 2) * 0.1, i);
  }
  // register + bell on top
  boxMesh(0.32, 0.18, 0.36, getMaterial('blackPlastic'), cx, F + 1.1, -4.45);
  boxMesh(0.26, 0.08, 0.3, getMaterial('metalDark'), cx - 0.02, F + 1.22, -4.45).rotation.z = 0.35;
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), getMaterial('brass'));
  place(bell, cx + 0.2, F + 1.005, -3.5);
  world.add(counterX0, F, counterZ0, counterX1, F + 1.0, counterZ1, SURF.wood);

  // equipment shelves on the east wall
  const shelfX = 11.45;
  const plank = getMaterial('crateWood');
  const bracket = getMaterial('metalDark');
  for (const sz of [-4.2, -1.9]) {
    for (const y of [0.45, 1.05, 1.65]) boxMesh(0.42, 0.04, 1.9, plank, shelfX, F + y, sz);
    for (const dz of [-0.9, 0.9]) boxMesh(0.04, 1.75, 0.04, bracket, shelfX + 0.19, F + 0.875, sz + dz);
  }
  world.add(shelfX - 0.22, F, -5.2, 11.85, F + 1.8, -0.9, SURF.wood);
  const shelfItem = (o, y, z, ry = -Math.PI / 2) => place(o, shelfX - 0.02, F + y, z, ry);
  // ammo cans (bottom), frags + molotovs (middle), gas masks + kevlar (top)
  for (const z of [-4.8, -3.6]) {
    const a = buildProp('ammoCrate', { seed: Math.round(z * 10) });
    if (a) shelfItem(a.object, 0.47, z, Math.PI / 2);
  }
  for (let i = 0; i < 4; i++) shelfItem(buildWeaponModel('m67').root, 1.1, -2.6 + i * 0.13, i);
  const molo = getGLB(MODELS.molotov)?.scene.getObjectByName('MOLOTOV');
  if (molo) {
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Group();
      for (const c of molo.children) if (c.isMesh || c.children.some((k) => k.isMesh)) m.add(c.clone());
      shelfItem(m, 1.15, -1.6 + i * 0.16, i * 0.7); // root sits at the grip, ~7.5 cm above the base
    }
  }
  for (let i = 0; i < 2; i++) {
    const mask = gasMask();
    shelfItem(mask, 1.8, -4.6 + i * 0.35, -Math.PI / 2);
  }
  const vest = kevlarVest();
  shelfItem(vest, 1.94, -2.0, -Math.PI / 2);
  vest.rotation.z = 0.04;
  const crate = buildProp('crate', { seed: 3 });
  if (crate) {
    place(crate.object, 10.6, F, -0.25, 0.3);
    world.add(10.1, F, -0.75, 11.1, F + 0.8, 0.25, SURF.wood);
  }

  // price list for the equipment
  {
    const lines = SHOP_EQUIPMENT.filter((e) => !e.requires || WEAPONS[e.requires]).map((e) => [e.name, e.price]);
    const tex = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = '#16140f';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#c9a15a';
      g.lineWidth = 8;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#e8d8b0';
      g.font = 'bold 44px Impact, sans-serif';
      g.textAlign = 'center';
      g.fillText('EQUIPMENT', w / 2, 76);
      g.font = 'bold 32px Arial, sans-serif';
      lines.forEach(([n, p], i) => {
        g.textAlign = 'left';
        g.fillStyle = '#e8d8b0';
        g.fillText(n, 40, 150 + i * 62);
        g.textAlign = 'right';
        g.fillStyle = '#e0513c';
        g.fillText('$' + p, w - 40, 150 + i * 62);
      });
    });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 }));
    place(board, 11.83, F + 2.25, -3.05, -Math.PI / 2);
  }

  // neon sign on the south wall, facing the stairs; its light comes from the room lamps
  const neonMat = new THREE.MeshBasicMaterial({ map: neonTex('GUN SHOP', '#ff3b1f'), transparent: true, color: new THREE.Color(2.4, 2.4, 2.4), depthWrite: false, toneMapped: true });
  const neon = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.6), neonMat);
  place(neon, 7.4, F + 2.35, 0.83, Math.PI);
  const openMat = new THREE.MeshBasicMaterial({ map: neonTex('OPEN', '#3dff8a'), transparent: true, color: new THREE.Color(2, 2, 2), depthWrite: false });
  const openSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.225), openMat);
  place(openSign, 11.83, F + 2.62, -5.2, -Math.PI / 2);

  // stairwell gate (hinged grate at the top of the stairs, swings over the stairs to open)
  const gate = new THREE.Group();
  gate.position.set(3.94, 0, -7.7);
  const bar = getMaterial('metalDark');
  for (let z = 0.05; z < 1.3; z += 0.11) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 2.2, 6), bar);
    b.position.set(0, 1.1, z);
    gate.add(b);
  }
  for (const y of [0.08, 1.1, 2.18]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.05, 1.3), bar);
    rail.position.set(0, y, 0.65);
    gate.add(rail);
  }
  const plateTex = canvasTex(256, 96, (g, w) => {
    g.fillStyle = '#b8231a';
    g.fillRect(0, 0, w, 96);
    g.fillStyle = '#fff';
    g.font = 'bold 40px Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText('GUN SHOP ↓', w / 2, 62);
  });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.22), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.8 }));
  plate.position.set(-0.03, 1.35, 0.65);
  plate.rotation.y = -Math.PI / 2;
  gate.add(plate);
  gate.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  root.add(gate);

  scene.add(root);
  // the clerk: behind the counter facing the customers (+x), close enough to lean on it
  const KEEPER = new THREE.Vector3(3.55, F, -2.7);
  const keeper = createShopkeeper(scene, {
    pos: KEEPER,
    yaw: Math.PI / 2,
    counter: { edge: counterX0, top: F + 1.005 },
    glances: [new THREE.Vector3(9.4, F + 1.2, -7.0), new THREE.Vector3(11.3, F + 1.4, -3.0), new THREE.Vector3(4.15, F + 1.1, -4.45), new THREE.Vector3(7.4, F + 2.3, 0.8)],
  });
  if (keeper) world.add(KEEPER.x - 0.22, F, KEEPER.z - 0.26, counterX0, F + 1.75, KEEPER.z + 0.26, SURF.flesh, FLAG_NOBULLET | FLAG_NAVIGNORE, 'shopkeeper');
  const _cam = new THREE.Vector3();

  // ---------------------------------------------------------------- runtime
  const [bx0, bx1, bz0, bz1] = info.bounds;
  let open = false;
  let openT = 0;
  const inside = (p) => p.x > bx0 && p.x < bx1 && p.z > bz0 && p.z < bz1 && p.y < -0.4;
  const onStairs = (p) => p.x > 3.9 && p.x < 9.5 && p.z < -6.3;
  const shop = {
    root,
    keeper,
    entrance: info.entrance.clone(),
    displayed,
    get isOpen() {
      return open;
    },
    /** In the cellar (off the stairs) while the shop is open. */
    canInteract(player) {
      return open && !!player?.alive && inside(player.pos) && !onStairs(player.pos) && player.pos.y < F + 0.6;
    },
    setOpen(v) {
      open = !!v;
      if (info.gate) info.gate.enabled = !open;
    },
    /** Anyone still below when a round starts is put back upstairs in the back room. */
    evacuate(player) {
      if (!player || !inside(player.pos)) return false;
      player.pos.copy(info.exit);
      player.body?.vel?.set(0, 0, 0);
      return true;
    },
    update(dt, game) {
      if (keeper) {
        // the clerk is only drawn / animated while the camera is down here (or low on the stairs):
        // from the ground floor the slab hides her anyway
        const cam = game?.camera?.position;
        const active = !!cam && cam.y < 0.5 && cam.x > 2.3 && cam.x < 12.2 && cam.z > -8.2 && cam.z < 1.2;
        keeper.root.visible = active;
        if (active) {
          const p = game.player;
          const buy = game.state === 'shop' && p?.alive;
          // a customer on the shop floor near the counter (or already shopping)
          const near = buy && p.pos.x > counterX1 - 0.2 && p.pos.distanceTo(KEEPER) < 6.5 && p.pos.y < F + 1;
          _cam.copy(cam);
          const engaged = !!buy && (!!game.shopOpen || (near && shop.canInteract(p)));
          keeper.update(dt, { cam: _cam, engaged, storeOpen: !!game.shopOpen });
        }
      }
      openT = THREE.MathUtils.clamp(openT + (open ? dt : -dt) * 1.6, 0, 1);
      const e = openT * openT * (3 - 2 * openT);
      gate.rotation.y = e * 1.45;
      const flick = Math.random() < 0.015 ? 0.35 : 1;
      neonMat.color.setScalar(2.4 * flick);
      openMat.opacity = open ? 1 : 0.15;
    },
  };
  shop.setOpen(false);
  return shop;
}
