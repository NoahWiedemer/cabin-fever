// Store item stage: ONE small WebGL renderer (created lazily, separate from the game's) that
//  - bakes every shop item ONCE into a transparent thumbnail image (object URL, cached), three-point
//    lit at a 3/4 angle like the fireteam portraits (actors/portraits.js), framed by the item's own
//    vertices so long rifles and round grenades both fill their card;
//  - drives the live turntable preview of the selected item (drag to rotate) while the store is open.
//
// Cost control: models are adopted into stage-owned clones (geometry, materials, textures sharing
// the image data), so the stage can free its GPU copies without touching the game's resources.
// Preparing a model never stalls the main thread (compileAsync, one texture upload per idle slice,
// async WebP encode); a model's GPU memory is released right after its thumbnail is baked, and
// everything is released when the store closes (only the compiled programs and the environment
// map stay). If WebGL is unavailable or lost, `ok` is false and the store shows its SVG icons.
import * as THREE from 'three';

const FOV = 20; // long lens: little perspective distortion on long guns
// thumbnails at about the device pixels of the widest card (~1/6 of the screen), 2:1
const THUMB_W = typeof screen === 'undefined' ? 512 : Math.min(1024, Math.max(512, Math.ceil((screen.width * (window.devicePixelRatio || 1)) / 6.2 / 64) * 64));
const THUMB_H = THUMB_W / 2;
const SPIN = 0.42; // auto-rotate speed (rad/s)
const MAX_PTS = 6000; // vertex samples per model for framing
const ENV = 0.75; // image-based light (reflections on the gunmetal); matte gear takes less
const KEEP_LIVE = 4; // prepared preview models kept while the store is open (LRU)

const V3 = THREE.Vector3;
const idle = (timeout) => new Promise((r) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(() => r(), { timeout }) : setTimeout(r, 16)));

/**
 * Product-shot environment for the reflections: a dark gradient dome with a warm key softbox, cool
 * strip fill, amber rim strip and a cool kicker (matching the direct lights). Unlit materials only,
 * so baking it into a PMREM costs little shader compilation.
 */
function studioScene() {
  const s = new THREE.Scene();
  const dome = new THREE.SphereGeometry(10, 24, 12);
  const col = [];
  const p = dome.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 10;
    const k = y > 0 ? 0.065 + 0.07 * y : 0.065 + 0.045 * y;
    col.push(k, k * 1.02, k * 1.1);
  }
  dome.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  s.add(new THREE.Mesh(dome, new THREE.MeshBasicMaterial({ side: THREE.BackSide, vertexColors: true })));
  const panel = (w, h, pos, rgb, k) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0] * k, rgb[1] * k, rgb[2] * k), side: THREE.DoubleSide }));
    m.position.set(pos[0], pos[1], pos[2]);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  panel(5, 3.5, [-4.5, 5.5, 5], [1, 0.93, 0.84], 5); // key softbox
  panel(1.4, 6.5, [7, 1, 3.5], [0.72, 0.82, 1], 2.4); // strip fill
  panel(7, 1.1, [2.5, 4.5, -7], [1, 0.72, 0.36], 3.2); // amber rim strip
  panel(1.1, 5.5, [-6.5, 1.5, -5], [0.8, 0.88, 1], 2); // cool kicker
  panel(6, 6, [0, 9.5, 0], [1, 1, 1], 0.5); // overhead bounce
  return s;
}

/** Visible mesh vertices of `root` (world space, sampled), for tight framing. */
function samplePoints(root) {
  const meshes = [];
  let total = 0;
  root.traverseVisible((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    const m = o.material;
    if (m && !Array.isArray(m) && m.transparent && m.opacity < 0.05) return;
    meshes.push(o);
    total += o.geometry.attributes.position.count;
  });
  const step = Math.max(1, Math.ceil(total / MAX_PTS));
  const pts = [];
  for (const o of meshes) {
    const pos = o.geometry.attributes.position;
    const s = pos.count <= 96 ? 1 : step; // small parts (sights, muzzle devices) keep every vertex
    for (let i = 0; i < pos.count; i += s) pts.push(new V3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  }
  return pts;
}

export class ItemStage {
  /** `isPaused()`: skip preview frames (e.g. while the pause menu covers the store). */
  constructor({ isPaused } = {}) {
    this.isPaused = isPaused || (() => false);
    this.gl = null;
    this.failed = false;
    this.lost = false;
    this.gen = 0; // bumped by releaseAll(): in-flight preparations of an older generation abort
    this.models = new Map(); // key -> entry (prepared models; released after thumbs / on close)
    this.thumbs = new Map(); // key -> object URL (null: the model can't be built)
    this._prep = new Map(); // key -> Promise<entry>
    this._jobs = new Map(); // key -> Promise<url> (thumbnail bakes)
    this._mats = new Map(); // game material -> stage clone (kept: their programs stay compiled)
    this._texs = new Map(); // game texture -> stage clone (same image source)
    this._uploaded = new Set();
    this.cur = null;
    this.want = null;
    this.host = null;
    this.mode = null;
    this.running = false;
    this.raf = 0;
    this.spin = 0;
    this.spinVel = 0;
    this.tilt = 0;
    this.idle = 9;
    this.introT = 0;
    this.drag = null;
    this._loop = this._loop.bind(this);
  }

  get ok() {
    return !this.failed && !this.lost;
  }

  /* ------------------------------------------------------------ setup */

  _init() {
    if (this.gl) return this.ok;
    if (this.failed) return false;
    let gl;
    try {
      const canvas = document.createElement('canvas');
      canvas.className = 'cf-st-gl';
      gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch (e) {
      console.warn('[store] no WebGL for item previews', e);
      this.failed = true;
      return false;
    }
    this.gl = gl;
    gl.setClearColor(0x000000, 0);
    gl.outputColorSpace = THREE.SRGBColorSpace;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.28;

    const scene = (this.scene = new THREE.Scene());
    scene.environmentIntensity = ENV; // the environment itself is baked by _ensure()
    // three-point rig in view space terms (camera sits on +Z): warm key high left, cool fill low
    // right, amber rim + cool kicker from behind so dark gunmetal separates from the dark UI
    const key = new THREE.DirectionalLight(0xffe4c4, 3.2);
    key.position.set(-2.4, 3.4, 3.0);
    const fill = new THREE.DirectionalLight(0xa9c2e2, 1.1);
    fill.position.set(3.0, 0.8, 2.4);
    const rim = new THREE.DirectionalLight(0xffb048, 4.2);
    rim.position.set(2.2, 2.4, -3.0);
    const rim2 = new THREE.DirectionalLight(0xc8dcff, 2.4);
    rim2.position.set(-2.6, 1.2, -2.4);
    scene.add(key, fill, rim, rim2, new THREE.HemisphereLight(0x46505e, 0x16110c, 0.8));
    this.cam = new THREE.PerspectiveCamera(FOV, 2, 0.01, 50);

    const c = gl.domElement;
    c.addEventListener('webglcontextlost', () => {
      this.lost = true;
    });
    c.addEventListener('webglcontextrestored', () => {
      // three re-uploads what it needs; the baked environment (a render target) must be rebaked
      this.lost = false;
      this._uploaded.clear();
      this.scene.environment = null;
      this._envP = null;
    });
    // drag to rotate (with a little flick inertia), then it drifts back into the slow spin
    c.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.cur) return;
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), v: 0 };
      try {
        c.setPointerCapture(e.pointerId);
      } catch (_) {
        /* no active pointer (synthetic event): dragging still works while over the canvas */
      }
      c.classList.add('grab');
    });
    c.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const now = performance.now();
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const k = 5.5 / Math.max(160, c.clientWidth); // a drag across the canvas: ~7/8 of a turn
      this.spin += dx * k;
      this.tilt = THREE.MathUtils.clamp(this.tilt + dy * k * 0.6, -0.55, 0.7);
      d.v = (dx * k) / Math.max(0.008, (now - d.t) / 1000);
      d.x = e.clientX;
      d.y = e.clientY;
      d.t = now;
    });
    const end = (e) => {
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      this.spinVel = performance.now() - d.t < 90 ? THREE.MathUtils.clamp(d.v, -4, 4) : 0; // flick, unless it was held still
      this.idle = 0;
      this.drag = null;
      c.classList.remove('grab');
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    return true;
  }

  /** Context + environment map, compiled without blocking: resolves true when the stage can render. */
  _ensure() {
    if (this.scene?.environment) return Promise.resolve(this.ok);
    if (this._envP) return this._envP;
    this._envP = (async () => {
      if (!this._init()) return false;
      const gl = this.gl;
      const pm = new THREE.PMREMGenerator(gl);
      const studio = studioScene();
      try {
        // every shader the bake uses, compiled in parallel (KHR_parallel_shader_compile) first:
        // the studio's own materials and PMREM's blur / GGX prefilter materials (private, r18x).
        // Bound to a render target like the bake itself (no tone mapping, linear output), so the
        // programs match and fromScene() finds them in the cache.
        const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
        gl.setRenderTarget(rt);
        const warm = [gl.compileAsync(studio, this.cam)];
        if (typeof pm._allocateTargets === 'function' && typeof pm._setSize === 'function') {
          pm._setSize(256);
          pm._allocateTargets().dispose();
          const g = new THREE.Group();
          for (const m of [pm._blurMaterial, pm._ggxMaterial]) if (m) g.add(new THREE.Mesh(new THREE.BufferGeometry(), m));
          warm.push(gl.compileAsync(g, this.cam));
        }
        gl.setRenderTarget(null);
        rt.dispose();
        await Promise.all(warm);
        await idle(300);
        if (this.lost) return false;
        this.env = pm.fromScene(studio, 0.02).texture;
        this.scene.environment = this.env;
      } catch (e) {
        console.warn('[store] environment bake failed', e);
      } finally {
        pm.dispose();
        studio.traverse((o) => {
          if (o.isMesh) {
            o.geometry.dispose();
            o.material.dispose();
          }
        });
      }
      return this.ok;
    })();
    return this._envP;
  }

  /* ------------------------------------------------------------ models */

  _tex(t) {
    let c = this._texs.get(t);
    if (!c) {
      c = t.clone(); // shares the image source; its GPU copy belongs to this context only
      this._texs.set(t, c);
    }
    return c;
  }

  _mat(m, texs) {
    let c = this._mats.get(m);
    if (!c) {
      c = m.clone();
      for (const k of Object.keys(c)) if (c[k]?.isTexture) c[k] = this._tex(c[k]);
      this._mats.set(m, c);
    }
    for (const k of Object.keys(c)) if (c[k]?.isTexture) texs.add(c[k]);
    return c;
  }

  /** Build and measure an item (sync; cheap next to the GPU work). pose: { rot, roll, az, el, fill, env }. */
  _build(key, build, pose = {}) {
    let obj = null;
    try {
      obj = build();
    } catch (e) {
      console.warn('[store] model failed for', key, e);
    }
    if (!obj) return null;
    const geos = new Set();
    const texs = new Set();
    obj.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry = o.geometry.clone();
      geos.add(o.geometry);
      o.material = Array.isArray(o.material) ? o.material.map((m) => this._mat(m, texs)) : this._mat(o.material, texs);
      o.castShadow = o.receiveShadow = false;
    });
    const holder = new THREE.Group();
    holder.add(obj);
    const r = pose.rot || [0, 0, 0];
    holder.rotation.set(r[0], r[1], r[2]);
    if (pose.roll) holder.rotateOnWorldAxis(new V3(0, 0, 1), pose.roll); // tilt in the picture plane
    holder.updateMatrixWorld(true);
    const pts = samplePoints(holder);
    if (!pts.length) return null;
    const c = new THREE.Box3().setFromPoints(pts).getCenter(new V3());
    holder.position.copy(c).negate();
    let rxz = 0;
    let hy = 0;
    for (const p of pts) {
      p.sub(c);
      rxz = Math.max(rxz, Math.hypot(p.x, p.z));
      hy = Math.max(hy, Math.abs(p.y));
    }
    const pivot = new THREE.Group();
    pivot.add(holder);
    return {
      key,
      pivot,
      pts,
      rxz,
      hy,
      geos,
      texs,
      ready: false,
      used: 0,
      az: pose.az ?? 0.45,
      el: pose.el ?? 0.2,
      fill: pose.fill ?? 0.9,
      spinFill: pose.spinFill ?? 0.92,
      env: pose.env ?? ENV,
    };
  }

  /** Build + compile + upload an item without blocking a frame. Resolves to its entry, null if it
   * can't be built, or undefined if the stage was released meanwhile. */
  prepare(key, build, pose, slice = 400) {
    const have = this.models.get(key);
    if (have?.ready) return Promise.resolve(have);
    if (this._prep.has(key)) return this._prep.get(key);
    const gen = this.gen;
    const p = (async () => {
      if (!(await this._ensure())) return null;
      await idle(slice);
      if (gen !== this.gen || this.lost) return undefined;
      const e = this._build(key, build, pose);
      if (!e) return null;
      this.models.set(key, e);
      const ctx = this.gl.getContext();
      await this.gl.compileAsync(e.pivot, this.cam, this.scene);
      for (const t of e.texs) {
        if (this._uploaded.has(t)) continue;
        await idle(slice);
        if (gen !== this.gen || this.lost) return undefined;
        this.gl.initTexture(t);
        ctx.flush(); // hand the upload to the GPU now, not at the first draw / readback
        this._uploaded.add(t);
      }
      if (gen !== this.gen || this.lost) return undefined;
      e.ready = true;
      return e;
    })()
      .catch((err) => {
        console.warn('[store] preparing', key, 'failed', err);
        return null;
      })
      .finally(() => this._prep.delete(key));
    this._prep.set(key, p);
    return p;
  }

  /** Free an entry's GPU memory in this context (textures still used by the live model stay). */
  _release(e) {
    if (!e) return;
    const keep = this.cur && this.cur !== e ? this.cur.texs : null;
    for (const t of e.texs) {
      if (keep?.has(t)) continue;
      t.dispose();
      this._uploaded.delete(t);
    }
    for (const g of e.geos) g.dispose();
    if (e.pivot.parent) e.pivot.parent.remove(e.pivot);
    if (this.models.get(e.key) === e) this.models.delete(e.key);
  }

  /** Store closed: drop every prepared model and its GPU memory (programs + env map stay). */
  releaseAll() {
    this.gen++;
    this.want = null;
    const cur = this.cur;
    this.cur = null;
    for (const e of this.models.values()) this._release(e);
    if (cur) this._release(cur);
    this.models.clear();
  }

  /* ------------------------------------------------------------ framing */

  _camDir(e) {
    return new V3(Math.sin(e.az) * Math.cos(e.el), Math.sin(e.el), Math.cos(e.az) * Math.cos(e.el));
  }

  /** Tight static 3/4 framing (thumbnails): every sampled vertex inside `fill` of the frame. */
  _frameStatic(e, aspect) {
    const cam = this.cam;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const tanV = Math.tan((FOV * Math.PI) / 360);
    const tanH = tanV * aspect;
    const dir = this._camDir(e);
    const right = new V3().crossVectors(new V3(0, 1, 0), dir).normalize();
    const up = new V3().crossVectors(dir, right).normalize();
    const n = e.pts.length;
    const X = new Float32Array(n), Y = new Float32Array(n), Z = new Float32Array(n);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n; i++) {
      const p = e.pts[i];
      X[i] = p.dot(right);
      Y[i] = p.dot(up);
      Z[i] = p.dot(dir);
      x0 = Math.min(x0, X[i]);
      x1 = Math.max(x1, X[i]);
      y0 = Math.min(y0, Y[i]);
      y1 = Math.max(y1, Y[i]);
    }
    let cx = (x0 + x1) / 2;
    let cy = (y0 + y1) / 2;
    let D = 1;
    const need = () => {
      let d = 0;
      for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(X[i] - cx) / (tanH * e.fill) + Z[i], Math.abs(Y[i] - cy) / (tanV * e.fill) + Z[i]);
      return d;
    };
    for (let it = 0; it < 3; it++) {
      D = need();
      // re-center on the perspective-projected extents (the near end looks bigger)
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let i = 0; i < n; i++) {
        const w = D - Z[i];
        const sx = (X[i] - cx) / w;
        const sy = (Y[i] - cy) / w;
        a0 = Math.min(a0, sx);
        a1 = Math.max(a1, sx);
        b0 = Math.min(b0, sy);
        b1 = Math.max(b1, sy);
      }
      cx += ((a0 + a1) / 2) * D;
      cy += ((b0 + b1) / 2) * D;
    }
    D = need();
    const target = right.multiplyScalar(cx).add(up.multiplyScalar(cy));
    cam.position.copy(target).addScaledVector(dir, D);
    cam.lookAt(target);
    cam.updateMatrixWorld(true);
  }

  /** Turntable framing (live preview): fits the item at every spin angle. */
  _frameSpin(e, aspect) {
    const cam = this.cam;
    cam.aspect = aspect;
    cam.updateProjectionMatrix();
    const tanV = Math.tan((FOV * Math.PI) / 360);
    const tanH = tanV * aspect;
    const sinH = tanH / Math.sqrt(1 + tanH * tanH);
    const ce = Math.cos(e.el), se = Math.sin(e.el);
    const dh = e.rxz / sinH;
    const dv = (e.hy * ce + e.rxz * se) / tanV + e.rxz * ce * 0.5;
    const D = Math.max(dh, dv) / e.spinFill;
    cam.position.copy(this._camDir(e)).multiplyScalar(D);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld(true);
  }

  _setMode(m) {
    if (this.mode === m) return;
    this.mode = m;
    if (m === 'thumb') {
      this.gl.setPixelRatio(1);
      this.gl.setSize(THUMB_W, THUMB_H, false);
    } else {
      this._resize(true);
    }
  }

  /* ------------------------------------------------------------ thumbnails */

  hasThumb(key) {
    return this.thumbs.has(key);
  }

  thumb(key) {
    return this.thumbs.get(key) ?? null;
  }

  /** Bake an item's thumbnail once (async, non-blocking). Resolves to its URL, null if the model
   * can't be built, or undefined if interrupted by releaseAll() (try again later). */
  bake(key, build, pose) {
    if (this.thumbs.has(key)) return Promise.resolve(this.thumbs.get(key));
    if (this._jobs.has(key)) return this._jobs.get(key);
    const job = (async () => {
      const e = await this.prepare(key, build, pose, this.running ? 120 : 800);
      if (!e) return e;
      // let the GPU finish the uploads before the readback (which would otherwise wait for them)
      await new Promise((r) => setTimeout(r, 40));
      await idle(this.running ? 120 : 800);
      if (!this.models.has(key) || this.lost) return undefined;
      const blob = await this._snap(e);
      if (this.cur !== e) this._release(e);
      return blob ? URL.createObjectURL(blob) : null;
    })()
      .catch((err) => {
        console.warn('[store] thumbnail failed for', key, err);
        return null;
      })
      .then((url) => {
        this._jobs.delete(key);
        if (url !== undefined) this.thumbs.set(key, url);
        return url;
      });
    this._jobs.set(key, job);
    return job;
  }

  /** Render the entry at the 3/4 pose into the thumb-sized buffer; the preview comes back in the
   * same task, so an attached canvas never shows the thumbnail. */
  _snap(e) {
    const gl = this.gl;
    const cur = this.cur;
    if (cur) this.scene.remove(cur.pivot);
    this._setMode('thumb');
    e.pivot.rotation.set(0, 0, 0);
    e.pivot.scale.setScalar(1);
    this.scene.add(e.pivot);
    this.scene.environmentIntensity = e.env;
    this._frameStatic(e, THUMB_W / THUMB_H);
    gl.render(this.scene, this.cam);
    // the bitmap is snapshotted synchronously; only the encode is async
    const p = new Promise((res) => gl.domElement.toBlob((b) => res(b), 'image/webp', 0.92));
    this.scene.remove(e.pivot);
    if (cur) {
      this.scene.add(cur.pivot);
      this.scene.environmentIntensity = cur.env;
    }
    if (this.running) {
      this._setMode('preview');
      this._render();
    }
    return p;
  }

  /* ------------------------------------------------------------ live preview */

  /** Put the preview canvas into `host` (sized to it). */
  attach(host) {
    if (!this._init() || this.host === host) return;
    this.host = host;
    host.appendChild(this.gl.domElement);
    this._ro?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(host);
    }
  }

  _resize(force) {
    if (!this.gl || !this.host || this.mode === 'thumb') return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    if (w < 2 || h < 2) return;
    const pr = Math.min(2, window.devicePixelRatio || 1);
    if (!force && w === this._w && h === this._h && pr === this._pr) return;
    this._w = w;
    this._h = h;
    this._pr = pr;
    this.gl.setPixelRatio(pr);
    this.gl.setSize(w, h, false);
    if (this.cur) this._frameSpin(this.cur, w / h);
    if (this.running) this._render();
  }

  /** Is `key` ready to show without waiting? */
  isReady(key) {
    return !!this.models.get(key)?.ready;
  }

  /** Show an item in the live preview once it's prepared (it swings in from the side).
   * Resolves true when it's live, false if it can't be shown or another item was asked for meanwhile. */
  async show(key, build, pose) {
    if (!this._init()) return false;
    this.want = key;
    if (!(await this._ensure())) return false;
    if (this.cur?.key === key && this.cur.ready) return true;
    const e = await this.prepare(key, build, pose, 60);
    if (!e || this.want !== key || !this.running) {
      if (e && this.cur !== e && !this.running) this._release(e);
      return false;
    }
    this._display(e);
    return true;
  }

  _display(e) {
    if (this.cur === e) return;
    if (this.cur) this.scene.remove(this.cur.pivot);
    this.cur = e;
    e.used = performance.now();
    this.scene.add(e.pivot);
    this.scene.environmentIntensity = e.env;
    this.spin = -0.55;
    this.spinVel = 1.9;
    this.tilt = 0;
    this.idle = 9;
    this.introT = performance.now();
    this._setMode('preview');
    if (this._w) this._frameSpin(e, this._w / this._h);
    this._render();
    // keep the few most recent previews warm, free the rest
    const live = [...this.models.values()].filter((m) => m && m.ready && m !== e && !this._jobs.has(m.key)).sort((a, b) => b.used - a.used);
    for (const m of live.slice(KEEP_LIVE - 1)) this._release(m);
  }

  /** Brief scale pop on purchase. */
  pop() {
    this.introT = performance.now() - 200;
  }

  start() {
    if (this.running || !this._init()) return;
    this.running = true;
    this._last = performance.now();
    this._setMode('preview');
    this._resize(true);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this._loop);
  }

  /** Stop drawing and free the prepared models (the store is closing). */
  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.drag = null;
    this.gl?.domElement.classList.remove('grab');
    if (this.gl) this.releaseAll();
  }

  _loop(t) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this._loop);
    const dt = Math.min(0.05, Math.max(0, (t - this._last) / 1000));
    this._last = t;
    if (!this.cur || this.lost || this.isPaused() || document.hidden) return;
    if (!this.drag) {
      this.idle += dt;
      const want = this.idle > 1.4 ? SPIN : 0;
      this.spinVel += (want - this.spinVel) * Math.min(1, dt * (this.idle > 1.4 ? 1.2 : 3));
      this.spin += this.spinVel * dt;
      this.tilt += (0 - this.tilt) * Math.min(1, dt * 1.5);
    }
    this._render(t);
  }

  _render(t = performance.now()) {
    const e = this.cur;
    if (!e || !this.gl || this.mode === 'thumb') return;
    const k = Math.min(1, (t - this.introT) / 520);
    const ease = 1 - Math.pow(1 - k, 3);
    e.pivot.scale.setScalar(0.84 + 0.16 * ease);
    e.pivot.rotation.set(this.tilt, this.spin, 0);
    this.gl.render(this.scene, this.cam);
  }
}
