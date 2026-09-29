// The PLAY screen's squad: your operator and the bots you brought stand out in the map itself, in the rain and
// the haze, shoulder to shoulder in the beam of a torch, and look at the camera: this is the team that goes out
// there. They breathe, shift their weight, look round, lift the rifle to the eye and lower it again.
//
// The bodies are the game's own Teammate objects (the fireteam bots and game.playerBody) and the world is the
// game's own scene: while the stage runs, the bodies are only made visible and posed at the seats of the map's
// 'lobby' menu shot (game.menuShotSpec('lobby').cast.spots: [x, z, yaw] each), so the operator you pick in the
// loadout, the guns and their camos are exactly what you deploy with, and the rain, fog and lamps are the
// game's. stop() hides them again, where game.start() finds them as before.
//
// The menu's DOM overlays (name labels, the plus on an empty seat, LOADOUT, the click targets) hang on anchor
// elements, one per seat, that this moves over each body's feet every frame. The camera shot is panned and
// zoomed (view offset) so the squad fills the left of the screen, whatever the window's shape, and the panel
// stays clear on the right.
import * as THREE from 'three';
import { applyWeaponSkin } from '../player/skins.js';

const BODY_H = 1.85; // metres, head to feet
const CHEST = 1.2; // metres above the feet: the point the squad is centred on
const FIT = 0.86; // the squad's share of the stage's width
const FEET_ROOM = 0.2; // the stage's share, under the feet, kept for the name labels

const rand = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => b + (a - b) * Math.exp(-k * dt);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** soft light pool + a thin ring, drawn flat on the ground under a seat */
function ringTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(128, 128, 20, 128, 128, 126);
  r.addColorStop(0, 'rgba(255,190,90,0.10)');
  r.addColorStop(0.62, 'rgba(255,170,60,0.22)');
  r.addColorStop(0.72, 'rgba(255,200,110,0.95)');
  r.addColorStop(0.78, 'rgba(255,170,60,0.25)');
  r.addColorStop(1, 'rgba(255,150,40,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class LobbyStage {
  /**
   * game: the loaded Game · host: the stage element (the area the squad fills) · seats: () => the four seat
   * anchor elements, in seat order (positioned by this)
   */
  constructor(game, host, seats) {
    this.game = game;
    this.host = host;
    this.seats = seats;
    this.running = false;
    this.entries = new Map(); // body -> { slot, visible, pos, rot, skin, applied, idle state }
    this.spots = null;
    this.rings = null;
    this._raf = 0;
    this._last = 0;
    this._t = 0;
    this._zoom = 1;
    this._off = [0, 0];
    this._snap = true;
  }

  _ground(x, z) {
    const w = this.game.world;
    const hit = {};
    const h = w?.raycast(x, 2.4, z, 0, -1, 0, 8, () => true, hit);
    return h ? 2.4 - h.t : 0;
  }

  _prepare() {
    const spec = this.game.menuShotSpec('lobby');
    if (!spec?.cast?.spots?.length) return false;
    this.spots = spec.cast.spots.map(([x, z, yaw]) => ({ pos: new THREE.Vector3(x, this._ground(x, z), z), yaw }));
    if (!this.rings) {
      const tex = ringTexture();
      this.rings = this.spots.map(() => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 2;
        m.visible = false;
        this.game.scene.add(m);
        return m;
      });
    }
    this.spots.forEach((s, i) => this.rings[i]?.position.set(s.pos.x, s.pos.y + 0.03, s.pos.z));
    return true;
  }

  start() {
    if (this.running) return true;
    if (!this._prepare()) return false;
    this.running = true;
    this._snap = true;
    this._settle = 0.45; // (the camera cuts to the shot just after the stage starts: fit at once until then)
    this._t = 0;
    this._last = performance.now();
    const L = this.game.lighting;
    this._flash = L.flashlightOn;
    L.flashlightOn = true; // the torch beam that finds them
    // the spot is darker than the rest of the menu: the map's shot dims the torch, the sky light and the moon
    const spec = this.game.menuShotSpec('lobby');
    this._moon = L.moonBase;
    L.flashScale = spec.torch ?? 1;
    L.hemiScale = spec.hemi ?? 1;
    L.moonBase = spec.moon ?? L.moonBase;
    const tick = (now) => {
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - this._last) / 1000);
      this._last = now;
      this._frame(dt);
    };
    this._raf = requestAnimationFrame(tick);
    return true;
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this._raf);
    for (const body of [...this.entries.keys()]) this._release(body);
    for (const r of this.rings ?? []) r.visible = false;
    this.game.lighting.flashlightOn = this._flash;
    this.game.lighting.flashScale = 1;
    this.game.lighting.hemiScale = 1;
    this.game.lighting.moonBase = this._moon;
    const cam = this.game.camera;
    cam.zoom = 1;
    cam.clearViewOffset();
    cam.updateProjectionMatrix();
    for (const el of this.seats()) el.hidden = true;
  }

  /**
   * Who stands where: [{ slot, body, skin? }], body a Teammate (skin: weapon camo for its gun). Bodies that
   * left the list are hidden again.
   */
  setCast(cast) {
    if (!this.running) return;
    const keep = new Set(cast.map((c) => c.body));
    for (const body of [...this.entries.keys()]) if (!keep.has(body)) this._release(body);
    for (const c of cast) {
      let e = this.entries.get(c.body);
      if (!e) e = this._capture(c.body, c.slot);
      e.slot = c.slot;
      if (c.skin != null && e.applied !== c.skin && c.body.gun) {
        if (e.skin === undefined) e.skin = c.body.gun.userData.skin ?? 'factory'; // (to put back)
        e.applied = c.skin;
        applyWeaponSkin(c.body.gun, c.skin);
      }
    }
    this.layout(0);
  }

  _capture(body, slot) {
    const r = body.root;
    const e = {
      slot,
      visible: r.visible,
      pos: r.position.clone(),
      rot: r.rotation.clone(),
      skin: undefined, // the gun's own camo before the stage touched it
      timer: rand(0.4, 2),
      yawOff: 0,
      yawGoal: 0,
      readyGoal: 0,
      pitchGoal: 0,
    };
    this.entries.set(body, e);
    r.visible = true;
    // the state posePortrait() sets (standing, gun at low ready), without moving it
    body.target = null;
    body.reloadT = 0;
    body.moveSpeed = 0;
    body.phase = 0;
    body.crouch = 0;
    body.recoil = 0;
    body.aimPitch = 0;
    body.ready = 0.2;
    body.cineReady = 0;
    body.body.vel.set(0, 0, 0);
    if (body.gunHolder.parent !== body.mesh) body.mesh.add(body.gunHolder);
    return e;
  }

  _release(body) {
    const e = this.entries.get(body);
    if (!e) return;
    this.entries.delete(body);
    const r = body.root; // (the current body: an operator switch may have swapped it)
    if (e.skin !== undefined && body.gun) applyWeaponSkin(body.gun, e.skin);
    body.cineReady = undefined;
    body.aimPitch = 0;
    r.visible = e.visible;
    r.position.copy(e.pos);
    r.rotation.copy(e.rot);
    body.yaw = 0;
  }

  /** pan and zoom the camera so the squad fills the stage, then hang the DOM overlays on the bodies' feet */
  layout(dt) {
    const game = this.game;
    const cam = game.camera;
    const el = game.gr.renderer.domElement;
    const W = el.clientWidth, H = el.clientHeight;
    const host = this.host.getBoundingClientRect();
    if (!W || !H || host.width < 2) return;
    cam.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const ndc = (p, dy = 0) => v.set(p.x, p.y + dy, p.z).project(cam).clone();
    // the base view (no zoom, no offset), recovered from the current one
    const z0 = this._zoom, [ox, oy] = this._off;
    const baseX = (n) => (n.x + (2 * ox) / W) / z0;
    const baseY = (n) => (n.y - (2 * oy) / H) / z0;
    const sp = this.spots;
    const xs = sp.map((s) => baseX(ndc(s.pos, CHEST)));
    const left = Math.min(...xs), right = Math.max(...xs);
    const feet = sp.reduce((a, s) => a + baseY(ndc(s.pos)), 0) / sp.length;
    // fit: the squad (spot to spot, plus about a seat's width for the bodies at both ends) fills FIT of the stage
    const havePx = ((right - left) * W) / 2;
    const padPx = (havePx / Math.max(1, sp.length - 1)) * 0.85;
    const zoom = clamp((host.width * FIT) / (havePx + padPx), 0.55, 2.2);
    const tx = ((host.left + host.width / 2) / W) * 2 - 1;
    const ty = 1 - ((host.top + host.height * (1 - FEET_ROOM)) / H) * 2;
    const cx = (left + right) / 2;
    const offX = ((zoom * cx - tx) * W) / 2;
    const offY = ((ty - zoom * feet) * H) / 2;
    const k = this._snap || this._settle > 0 || dt <= 0 ? 1 : 1 - Math.exp(-7 * dt);
    this._zoom += (zoom - this._zoom) * k;
    this._off[0] += (offX - this._off[0]) * k;
    this._off[1] += (offY - this._off[1]) * k;
    this._snap = false;
    cam.zoom = this._zoom;
    cam.setViewOffset(W, H, this._off[0], this._off[1], W, H);
    cam.updateMatrixWorld(true);
    // overlays: an anchor at each body's feet, --h / --w its height and width on screen
    const els = this.seats();
    sp.forEach((s, i) => {
      const a = els[i];
      if (!a) return;
      const f = ndc(s.pos);
      const t = ndc(s.pos, BODY_H);
      const fx = ((f.x + 1) / 2) * W - host.left;
      const fy = ((1 - f.y) / 2) * H - host.top;
      const ty2 = ((1 - t.y) / 2) * H - host.top;
      const h = Math.max(40, fy - ty2);
      a.hidden = f.z > 1;
      a.style.transform = `translate(${fx.toFixed(1)}px, ${fy.toFixed(1)}px)`;
      a.style.setProperty('--h', `${h.toFixed(1)}px`);
      a.style.setProperty('--w', `${(h * 0.5).toFixed(1)}px`);
    });
  }

  _frame(dt) {
    this._t += dt;
    this._settle -= dt;
    const spots = this.spots;
    for (const [body, e] of this.entries) {
      const sp = spots[e.slot];
      if (!sp) continue;
      // a little life: now and then the rifle comes up to the eye, or the body turns and looks round
      if ((e.timer -= dt) <= 0) {
        const r = Math.random();
        if (r < 0.34) {
          e.readyGoal = 1;
          e.pitchGoal = rand(-0.02, 0.12);
          e.yawGoal = rand(-0.15, 0.2);
          e.timer = rand(1.6, 2.8);
        } else if (r < 0.64) {
          e.readyGoal = 0;
          e.pitchGoal = 0;
          e.yawGoal = rand(-0.5, 0.45);
          e.timer = rand(2.2, 4.5);
        } else {
          e.readyGoal = 0;
          e.pitchGoal = 0;
          e.yawGoal = rand(-0.15, 0.15);
          e.timer = rand(2.5, 5);
        }
      }
      e.yawOff = damp(e.yawOff, e.yawGoal, 2.2, dt);
      const yaw = sp.yaw + e.yawOff;
      const root = body.root;
      root.position.copy(sp.pos);
      root.rotation.set(0, yaw, 0);
      body.yaw = yaw;
      body.cineReady = e.readyGoal;
      body.aimPitch = damp(body.aimPitch ?? 0, e.pitchGoal, 3, dt);
      root.updateMatrixWorld(true);
      body._animate(dt);
    }
    this.layout(dt);
    // the light pools under the seats: an empty one breathes, a hovered one lights up
    const els = this.seats();
    const taken = new Set([...this.entries.values()].map((e) => e.slot));
    this.rings.forEach((m, i) => {
      const hov = !!els[i] && (els[i].matches(':hover') || els[i].matches(':focus-within'));
      const goal = hov ? 0.85 : taken.has(i) ? 0 : 0.3 + 0.14 * Math.sin(this._t * 2.2 + i);
      m.material.opacity = damp(m.material.opacity, goal, 9, dt);
      m.visible = m.material.opacity > 0.01;
    });
  }
}
