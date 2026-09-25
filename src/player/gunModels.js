// src/player/gunModels.js
// Procedural, high-detail first-person weapon viewmodels, first-person arms rig,
// ejected shell casings and cheap third-person weapon models for "Cabin Fever".
//
// Conventions: meters, forward = -Z, up = +Y, right = +X. Every weapon root has its
// origin at the web of the right hand on the grip. Static sub-parts are merged per
// material (one mesh per material); animated parts are separate Object3Ds.
//
// Geometry pipeline: every primitive helper returns a NON-indexed BufferGeometry with
// `position`, `normal` and optional `wear`/`shade` attributes. When a part is built,
// geometries are merged per material and receive box-projected `uv`s plus a `color`
// attribute (vertex colors) that encodes edge wear (chamfers / bevels get a lighter,
// worn tint), per-piece tint and cavity shading. Materials are shared singletons
// (clone before tinting one weapon individually).
//
// Animation notes (all parts and empties are direct children of `root`; positions are root space):
//   m4a1      mag: translate local -Y (~0.13 to clear)  | bolt: +Z 0.075 | chargingHandle: +Z 0.07
//             trigger: rotation.x -0.3 = pulled
//   m4super90 bolt (carrier + handle): +Z 0.07          | trigger: rotation.x -0.3
//             parts.loadPort = empty at the loading port (shell insertion point)
//   l96a1     boltHandle (child of bolt, pivot on bore axis): rotation.z +PI/2 = lifted
//             bolt: then +Z 0.09 (handle travels with it)  | mag: local -Y | trigger: rotation.x -0.3
//   m9        slide: +Z 0.045 (recoil / lock back)   | mag: local -Y (group is raked with the grip)
//             trigger: rotation.x -0.3
//   knife     blade: the blade group (hide/swap)      | muzzle = blade tip
//   m67       pin: translate -X ~0.04 (ring side)     | spoon: rotation.z +1.2 swings it off (pivot at hinge)
//             magazineModel() = grenade body for the thrown projectile
//   m32       cylinder: rotation.z += PI/3 per shot (pivot on cylinder axis) | trigger: rotation.x
//   goldenPunisher cylinder (drum): rotation.z += PI/6 per shot | ejector: +Z 0.1 | trigger: rotation.x
//   chaingun  barrels: spin rotation.z (pivot on rotation axis) | trigger (thumb paddle): rotation.x -0.3
// Hand empties carry userData { rx, rz, curl, thumb, trigger, gy } describing the gripped object
// (half sizes across / along the fingers, finger curl 0..1, thumb curl, index finger on trigger);
// buildArms().update() reads them to place and curl the hands.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

const V3 = THREE.Vector3;
const DEG = Math.PI / 180;
const PI = Math.PI;
const TAU = Math.PI * 2;
const HAS_DOM = typeof document !== 'undefined' && typeof document.createElement === 'function';

export const WEAPON_MODEL_IDS = ['m4a1', 'm4super90', 'l96a1', 'm9', 'knife', 'm67', 'm32', 'goldenPunisher', 'chaingun'];

/* ============================================================================
 * Deterministic RNG
 * ========================================================================== */
function mulberry32(a) {
	return function () {
		a |= 0; a = (a + 0x6D2B79F5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
let rnd = mulberry32(90210);

/* ============================================================================
 * Procedural textures (browser only; node falls back to plain materials)
 * ========================================================================== */
const TEX_SIZE = 256;
const _texCache = {};

function valueNoise(cells, rng) {
	const g = new Float32Array(cells * cells);
	for (let i = 0; i < g.length; i++) g[i] = rng();
	return (u, v) => { // u,v in [0,1) tileable
		const fx = u * cells, fy = v * cells;
		const ix = Math.floor(fx), iy = Math.floor(fy);
		let tx = fx - ix, ty = fy - iy;
		tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
		const x0 = ((ix % cells) + cells) % cells, y0 = ((iy % cells) + cells) % cells;
		const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
		const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
		return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
	};
}

function fbmField(size, octaves, seed) {
	const rng = mulberry32(seed);
	const fns = octaves.map(([cells, amp]) => [valueNoise(cells, rng), amp]);
	let tot = 0; for (const [, a] of fns) tot += a;
	const out = new Float32Array(size * size);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		let s = 0; for (const [f, a] of fns) s += f(x / size, y / size) * a;
		out[y * size + x] = s / tot;
	}
	return out;
}

function canvasFromField(size, fn) {
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const ctx = c.getContext('2d');
	const img = ctx.createImageData(size, size);
	for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
		const [r, g, b] = fn(x, y);
		const i = (y * size + x) * 4;
		img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
	}
	ctx.putImageData(img, 0, 0);
	return c;
}

function heightToNormalCanvas(H, size, strength) {
	return canvasFromField(size, (x, y) => {
		const xl = (x - 1 + size) % size, xr = (x + 1) % size, yu = (y - 1 + size) % size, yd = (y + 1) % size;
		const dx = (H[y * size + xr] - H[y * size + xl]) * strength;
		const dy = (H[yu * size + x] - H[yd * size + x]) * strength;
		const l = Math.hypot(dx, dy, 1);
		return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
	});
}

function finishTex(canvas, srgb) {
	const t = new THREE.CanvasTexture(canvas);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.anisotropy = 4;
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.needsUpdate = true;
	return t;
}

const TEX_GEN = {
	// roughness variation for metals: fbm mottling + fine scratches (green channel used)
	metalRough() {
		const S = TEX_SIZE, H = fbmField(S, [[4, 1], [8, 0.8], [16, 0.6], [48, 0.35], [128, 0.25]], 11);
		const c = canvasFromField(S, (x, y) => { const v = (0.74 + 0.26 * H[y * S + x]) * 255; return [v, v, v]; });
		const ctx = c.getContext('2d'); const rng = mulberry32(12);
		for (let i = 0; i < 90; i++) { // scratches (drawn with wrap so the tile stays seamless)
			const x = rng() * S, y = rng() * S, a = rng() * TAU, l = 8 + rng() * 40;
			const g = rng() < 0.6 ? 150 + rng() * 60 : 255;
			ctx.strokeStyle = `rgba(${g | 0},${g | 0},${g | 0},${0.25 + rng() * 0.35})`;
			ctx.lineWidth = 0.6 + rng() * 0.8;
			for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
				ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.lineTo(x + ox + Math.cos(a) * l, y + oy + Math.sin(a) * l); ctx.stroke();
			}
		}
		return finishTex(c, false);
	},
	// subtle albedo mottling (parkerizing / anodizing variation)
	mottle() {
		const S = TEX_SIZE, H = fbmField(S, [[3, 1], [6, 0.7], [12, 0.5], [40, 0.3], [96, 0.2]], 21);
		return finishTex(canvasFromField(S, (x, y) => { const v = (0.80 + 0.2 * H[y * S + x]) * 255; return [v, v, v]; }), true);
	},
	// fine polymer stipple
	stipple() {
		const S = TEX_SIZE, H = fbmField(S, [[32, 0.4], [64, 0.6], [128, 1]], 31);
		const rng = mulberry32(32);
		for (let i = 0; i < 2600; i++) {
			const cx = rng() * S, cy = rng() * S, r = 1.2 + rng() * 2.2, h = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5);
			for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
				const d = Math.hypot(x - cx, y - cy) / r; if (d >= 1) continue;
				const xi = ((x % S) + S) % S, yi = ((y % S) + S) % S;
				H[yi * S + xi] += h * (1 - d * d) * 0.6;
			}
		}
		return finishTex(heightToNormalCanvas(H, S, 2.2), false);
	},
	// diamond checkering (grips)
	checker() {
		const S = TEX_SIZE, p = S / 16, H = new Float32Array(S * S), N = fbmField(S, [[64, 1], [128, 1]], 41);
		for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
			const a = (x + y) / p, b = (x - y) / p;
			const fa = Math.abs(a - Math.floor(a) - 0.5), fb = Math.abs(b - Math.floor(b) - 0.5);
			H[y * S + x] = Math.min(0.5 - fa, 0.5 - fb) * 2 + N[y * S + x] * 0.15;
		}
		return finishTex(heightToNormalCanvas(H, S, 3.0), false);
	},
	// plain weave fabric (sleeves)
	fabric() {
		const S = TEX_SIZE, p = 8, H = new Float32Array(S * S), N = fbmField(S, [[16, 0.6], [64, 0.4], [128, 0.5]], 51);
		for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
			const u = x / p, v = y / p, iu = Math.floor(u), iv = Math.floor(v), fu = u - iu, fv = v - iv;
			const warp = Math.sqrt(Math.sin(PI * fu)) * (0.55 + 0.45 * Math.cos(PI * (v + iu)));
			const weft = Math.sqrt(Math.sin(PI * fv)) * (0.55 + 0.45 * Math.cos(PI * (u + iv + 1)));
			H[y * S + x] = Math.max(warp, weft) + N[y * S + x] * 0.35;
		}
		return finishTex(heightToNormalCanvas(H, S, 1.6), false);
	},
	// pebbled synthetic leather (gloves)
	leather() {
		const S = TEX_SIZE, C = 24, cell = S / C, rng = mulberry32(61);
		const px = new Float32Array(C * C), py = new Float32Array(C * C);
		for (let i = 0; i < C * C; i++) { px[i] = rng(); py[i] = rng(); }
		const H = new Float32Array(S * S), N = fbmField(S, [[32, 0.5], [128, 0.5]], 62);
		for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
			const cx = Math.floor(x / cell), cy = Math.floor(y / cell); let d1 = 9, d2 = 9;
			for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
				const gx = (cx + ox + C) % C, gy = (cy + oy + C) % C, k = gy * C + gx;
				const fx = (cx + ox + px[k]) * cell, fy = (cy + oy + py[k]) * cell;
				const d = Math.hypot(x - fx, y - fy) / cell;
				if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
			}
			H[y * S + x] = Math.min(1, (d2 - d1) * 2.2) + N[y * S + x] * 0.25;
		}
		return finishTex(heightToNormalCanvas(H, S, 1.4), false);
	},
};

function tex(name) {
	if (!HAS_DOM) return null;
	if (name in _texCache) return _texCache[name];
	let t = null;
	try { t = TEX_GEN[name](); } catch (e) { t = null; }
	_texCache[name] = t;
	return t;
}

/* ============================================================================
 * Materials (shared singletons)
 * ========================================================================== */
// wear: sRGB color the chamfered edges drift towards; uv: texture tiles per meter
const MAT_DEFS = {
	anod: { color: 0x1d1e21, metalness: 0.7, roughness: 0.5, wear: 0x4a4b4f, rough: 'metalRough', map: 'mottle', uv: 7 },
	park: { color: 0x232426, metalness: 0.78, roughness: 0.66, wear: 0x55565a, rough: 'metalRough', map: 'mottle', uv: 8 },
	steel: { color: 0x9a9da3, metalness: 1.0, roughness: 0.34, wear: 0xc8cbd0, rough: 'metalRough', uv: 6 },
	blued: { color: 0x2b2d31, metalness: 0.9, roughness: 0.4, wear: 0x6a6d72, rough: 'metalRough', map: 'mottle', uv: 6 },
	poly: { color: 0x18191b, metalness: 0.0, roughness: 0.68, wear: 0x2e2f31, rough: 'metalRough', normal: 'stipple', ns: 0.35, uv: 12 },
	grip: { color: 0x151617, metalness: 0.0, roughness: 0.8, wear: 0x252628, normal: 'checker', ns: 0.85, uv: 38 },
	rubber: { color: 0x101011, metalness: 0.0, roughness: 0.92, wear: 0x1c1c1d, normal: 'stipple', ns: 0.6, uv: 20 },
	greyAl: { color: 0x9c9fa4, metalness: 0.88, roughness: 0.4, wear: 0xd0d3d8, rough: 'metalRough', map: 'mottle', uv: 5 },
	gold: { phys: true, color: 0xf0bd55, metalness: 1.0, roughness: 0.22, wear: 0xffe6a0, rough: 'metalRough', clearcoat: 0.8, clearcoatRoughness: 0.12, uv: 5 },
	brass: { color: 0xffffff, metalness: 1.0, roughness: 0.3, rough: 'metalRough', uv: 30 }, // color comes from vertex tint
	glass: { phys: true, color: 0x0b1715, metalness: 0.15, roughness: 0.04, clearcoat: 1.0, clearcoatRoughness: 0.02, iridescence: 0.7, iridescenceIOR: 1.4, emissive: 0x03100c, envMapIntensity: 2.2, vc: false },
	glassClear: { phys: true, color: 0x9edccb, metalness: 0.0, roughness: 0.03, transparent: true, opacity: 0.16, depthWrite: false, iridescence: 0.5, iridescenceIOR: 1.35, envMapIntensity: 1.6, vc: false },
	reticle: { basic: true, color: 0xff2a14 },
	tritium: { basic: true, color: 0x8dff6e },
	white: { color: 0xd8d8d0, metalness: 0.0, roughness: 0.55 },
	od: { color: 0x4b5436, metalness: 0.2, roughness: 0.62, wear: 0x6f715e, rough: 'metalRough', map: 'mottle', uv: 20 },
	yellow: { color: 0xc49a1f, metalness: 0.1, roughness: 0.55 },
	zinc: { color: 0x8e908c, metalness: 0.9, roughness: 0.46, wear: 0xb8bab5, rough: 'metalRough', uv: 25 },
	blade: { color: 0x1f2022, metalness: 0.62, roughness: 0.46, wear: 0x5d6064, rough: 'metalRough', map: 'mottle', uv: 9 },
	edge: { color: 0xc6cad0, metalness: 1.0, roughness: 0.16, rough: 'metalRough', uv: 12 },
	leather: { color: 0x5e3d24, metalness: 0.0, roughness: 0.66, wear: 0x8a6444, normal: 'leather', ns: 0.7, uv: 30 },
	hull: { color: 0xa51d17, metalness: 0.0, roughness: 0.42, normal: 'stipple', ns: 0.15, uv: 20 },
	hole: { color: 0x050505, metalness: 0.0, roughness: 1.0 },
	greenTip: { color: 0x2f7a2a, metalness: 0.0, roughness: 0.5 },
	// arms
	sleeve: { color: 0x363b30, metalness: 0.0, roughness: 0.95, normal: 'fabric', ns: 0.9, uv: 40, sheen: true, side: 'double' }, // ranger green
	glove: { color: 0x221e1b, metalness: 0.0, roughness: 0.58, normal: 'leather', ns: 0.8, uv: 34, wear: 0x3a332d }, // leather palm
	gloveArmor: { color: 0x19191a, metalness: 0.0, roughness: 0.4, wear: 0x46474a, normal: 'stipple', ns: 0.25, uv: 18 }, // molded knuckles
	gloveFabric: { color: 0x584833, metalness: 0.0, roughness: 0.9, normal: 'fabric', ns: 0.7, uv: 60 }, // coyote back
	skin: { color: 0xb68467, metalness: 0.0, roughness: 0.58, uv: 20 },
	// third person (vertex colored)
	tpMetal: { color: 0xffffff, metalness: 0.65, roughness: 0.45 },
	tpPoly: { color: 0xffffff, metalness: 0.0, roughness: 0.75 },
};

const _matCache = {};
function getMat(key) {
	if (_matCache[key]) return _matCache[key];
	const d = MAT_DEFS[key];
	if (!d) throw new Error('gunModels: unknown material ' + key);
	let m;
	if (d.basic) {
		m = new THREE.MeshBasicMaterial({ color: d.color, toneMapped: false, fog: false });
	} else {
		const params = {
			color: d.color, metalness: d.metalness ?? 0, roughness: d.roughness ?? 0.6,
			vertexColors: d.vc !== false,
		};
		if (d.transparent) { params.transparent = true; params.opacity = d.opacity; params.depthWrite = d.depthWrite ?? false; }
		if (d.emissive) params.emissive = d.emissive;
		if (d.side === 'double') params.side = THREE.DoubleSide;
		if (d.envMapIntensity) params.envMapIntensity = d.envMapIntensity;
		if (d.phys) {
			if (d.clearcoat) { params.clearcoat = d.clearcoat; params.clearcoatRoughness = d.clearcoatRoughness ?? 0.1; }
			if (d.iridescence) { params.iridescence = d.iridescence; params.iridescenceIOR = d.iridescenceIOR ?? 1.3; params.iridescenceThicknessRange = [260, 420]; }
			m = new THREE.MeshPhysicalMaterial(params);
		} else if (d.sheen) {
			params.sheen = 0.22; params.sheenRoughness = 0.85; params.sheenColor = new THREE.Color(0x2c302e);
			m = new THREE.MeshPhysicalMaterial(params);
		} else {
			m = new THREE.MeshStandardMaterial(params);
		}
		if (d.rough) { const t = tex(d.rough); if (t) m.roughnessMap = t; }
		if (d.map) { const t = tex(d.map); if (t) m.map = t; }
		if (d.normal) { const t = tex(d.normal); if (t) { m.normalMap = t; m.normalScale = new THREE.Vector2(d.ns ?? 0.5, d.ns ?? 0.5); } }
	}
	m.name = 'gm_' + key;
	const base = new THREE.Color(d.color);
	const wear = d.wear !== undefined ? new THREE.Color(d.wear) : null;
	m.userData.wearK = wear ? [wear.r / Math.max(base.r, 1e-4), wear.g / Math.max(base.g, 1e-4), wear.b / Math.max(base.b, 1e-4)] : [1, 1, 1];
	m.userData.uvScale = d.uv ?? 10;
	_matCache[key] = m;
	return m;
}

/* ============================================================================
 * Geometry primitives
 * ========================================================================== */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new V3(), _s = new V3();

// transform geometry in place: position, euler rotation [x,y,z] (XYZ), scale
function xf(g, p, r, s) {
	_e.set(r ? r[0] : 0, r ? r[1] : 0, r ? r[2] : 0, r && r[3] ? r[3] : 'XYZ');
	_q.setFromEuler(_e);
	_p.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
	if (typeof s === 'number') _s.set(s, s, s); else if (s) _s.set(s[0], s[1], s[2]); else _s.set(1, 1, 1);
	_m4.compose(_p, _q, _s);
	g.applyMatrix4(_m4);
	return g;
}
const cl = (g) => g.clone();

// normals with crease angle (own implementation: fine position quantization for mm-scale parts)
function smoothNormals(g, creaseDeg) {
	const pos = g.attributes.position.array;
	const vc = pos.length / 3, fc = (vc / 3) | 0;
	const fa = new Float64Array(fc * 3), fu = new Float64Array(fc * 3);
	for (let f = 0; f < fc; f++) {
		const o = f * 9;
		const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2];
		const vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		const l = Math.hypot(nx, ny, nz);
		fa[f * 3] = nx; fa[f * 3 + 1] = ny; fa[f * 3 + 2] = nz;
		if (l > 0) { fu[f * 3] = nx / l; fu[f * 3 + 1] = ny / l; fu[f * 3 + 2] = nz / l; }
	}
	const out = new Float32Array(vc * 3);
	if (!(creaseDeg > 0)) {
		for (let i = 0; i < vc; i++) { const f = (i / 3) | 0; out[i * 3] = fu[f * 3]; out[i * 3 + 1] = fu[f * 3 + 1]; out[i * 3 + 2] = fu[f * 3 + 2]; }
	} else {
		const cosT = Math.cos(creaseDeg * DEG);
		const map = new Map();
		for (let i = 0; i < vc; i++) {
			const k = Math.round(pos[i * 3] * 2e4) + ',' + Math.round(pos[i * 3 + 1] * 2e4) + ',' + Math.round(pos[i * 3 + 2] * 2e4);
			let a = map.get(k); if (!a) map.set(k, a = []); a.push(i);
		}
		for (const arr of map.values()) {
			for (const i of arr) {
				const fi = (i / 3) | 0;
				let sx = 0, sy = 0, sz = 0;
				for (const j of arr) {
					const fj = (j / 3) | 0;
					if (fu[fi * 3] * fu[fj * 3] + fu[fi * 3 + 1] * fu[fj * 3 + 1] + fu[fi * 3 + 2] * fu[fj * 3 + 2] >= cosT) {
						sx += fa[fj * 3]; sy += fa[fj * 3 + 1]; sz += fa[fj * 3 + 2];
					}
				}
				let l = Math.hypot(sx, sy, sz);
				if (l < 1e-20) { sx = fu[fi * 3]; sy = fu[fi * 3 + 1]; sz = fu[fi * 3 + 2]; l = Math.hypot(sx, sy, sz) || 1; if (l === 1 && sx === 0 && sy === 0 && sz === 0) { sy = 1; } }
				out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
			}
		}
	}
	g.setAttribute('normal', new THREE.BufferAttribute(out, 3));
	return g;
}

// triangle accumulator
class Acc {
	constructor() { this.p = []; this.w = []; this.s = []; }
	tri(a, b, c, w = 0, s = 1) {
		const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		if (nx * nx + ny * ny + nz * nz < 1e-24) return;
		this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
		this.w.push(w, w, w); this.s.push(s, s, s);
	}
	otri(a, b, c, want, w, s) {
		const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
		const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
		if (nx * want[0] + ny * want[1] + nz * want[2] < 0) this.tri(a, c, b, w, s); else this.tri(a, b, c, w, s);
	}
	oquad(a, b, c, d, want, w, s) { this.otri(a, b, c, want, w, s); this.otri(a, c, d, want, w, s); }
	geo(crease = 0) {
		const g = new THREE.BufferGeometry();
		g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
		g.setAttribute('wear', new THREE.Float32BufferAttribute(this.w, 1));
		g.setAttribute('shade', new THREE.Float32BufferAttribute(this.s, 1));
		return smoothNormals(g, crease);
	}
}

function setConst(g, name, v) {
	const n = g.attributes.position.count;
	g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n).fill(v), 1));
	return g;
}
const shade = (g, v) => setConst(g, 'shade', v);
const worn = (g, v = 1) => setConst(g, 'wear', v);

/**
 * Lathe around the Z axis. prof: [[r, z], ...] traversed from back (+z) to front (-z)
 * along the outer surface (the normal side is (-dz, dr) in (r,z)).
 * opts: segs, t0, t1 (partial sweep, caps added), crease, wear[] / shade[] per band.
 */
function lathe(prof, o = {}) {
	const segs = o.segs ?? 24, t0 = o.t0 ?? 0, t1 = o.t1 ?? TAU;
	const full = Math.abs(t1 - t0 - TAU) < 1e-6;
	const A = new Acc();
	const pt = (r, z, t) => [r * Math.cos(t), r * Math.sin(t), z];
	// orientation: standard traversal (back -> front along the outside) has negative signed area
	const closedLoop = prof.length > 2 && Math.abs(prof[0][0] - prof[prof.length - 1][0]) < 1e-9 && Math.abs(prof[0][1] - prof[prof.length - 1][1]) < 1e-9;
	const poly = closedLoop ? prof : [...prof, [0, prof[prof.length - 1][1]], [0, prof[0][1]]];
	let area = 0;
	for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
	const flip = o.orient === 'keep' ? 1 : o.orient === 'flip' ? -1 : (area > 0 ? -1 : 1);
	for (let i = 0; i < prof.length - 1; i++) {
		const r0 = prof[i][0], z0 = prof[i][1], r1 = prof[i + 1][0], z1 = prof[i + 1][1];
		if (r0 < 1e-7 && r1 < 1e-7) continue;
		const dr = r1 - r0, dz = z1 - z0, L = Math.hypot(dr, dz); if (L < 1e-7) continue;
		const nr = -dz / L * flip, nz = dr / L * flip;
		let w = (Math.abs(nz) > 0.28 && Math.abs(nz) < 0.96) ? 1 : 0;
		if (o.wear && o.wear[i] !== undefined) w = o.wear[i];
		const sh = o.shade && o.shade[i] !== undefined ? o.shade[i] : 1;
		for (let k = 0; k < segs; k++) {
			const ta = t0 + (t1 - t0) * k / segs, tb = t0 + (t1 - t0) * (k + 1) / segs, tm = (ta + tb) / 2;
			const want = [nr * Math.cos(tm), nr * Math.sin(tm), nz];
			A.oquad(pt(r0, z0, ta), pt(r1, z1, ta), pt(r1, z1, tb), pt(r0, z0, tb), want, w, sh);
		}
	}
	if (!full) {
		const contour = prof.map(([r, z]) => new THREE.Vector2(r, z));
		// drop duplicated closing point
		if (contour.length > 2 && contour[0].distanceTo(contour[contour.length - 1]) < 1e-7) contour.pop();
		const tris = THREE.ShapeUtils.triangulateShape(contour, []);
		for (const [t, sgn] of [[t0, -1], [t1, 1]]) {
			const want = [-Math.sin(t) * sgn, Math.cos(t) * sgn, 0];
			for (const [a, b, c] of tris) A.otri(pt(contour[a].x, contour[a].y, t), pt(contour[b].x, contour[b].y, t), pt(contour[c].x, contour[c].y, t), want, 0.6, 1);
		}
	}
	return A.geo(o.crease ?? 40);
}

// simple capped cylinder / cone along Z centred at z=0 (length L), with optional chamfer
function cyl(r, L, segs = 20, ch = 0, r2 = null) {
	const ra = r, rb = r2 ?? r, h = L / 2;
	const c = Math.min(ch, ra * 0.5, rb * 0.5, h * 0.5);
	const prof = c > 0
		? [[0, h], [ra - c, h], [ra, h - c], [rb, -h + c], [rb - c, -h], [0, -h]]
		: [[0, h], [ra, h], [rb, -h], [0, -h]];
	return lathe(prof, { segs });
}
// tube (hollow cylinder) along Z centred at z=0
function tube(ro, ri, L, segs = 24, ch = 0) {
	const h = L / 2, c = Math.min(ch, (ro - ri) * 0.45);
	const prof = [[ri, h], [ro - c, h], [ro, h - c], [ro, -h + c], [ro - c, -h], [ri, -h], [ri, h]];
	return lathe(prof, { segs });
}

// convex hull of points, chamfer faces (non axis-aligned) flagged as wear
function hull(pts, wearThresh = 0.985) {
	const g = new ConvexGeometry(pts.map(p => new V3(p[0], p[1], p[2])));
	const n = g.attributes.normal.array, cnt = n.length / 3;
	const w = new Float32Array(cnt);
	for (let i = 0; i < cnt; i++) {
		const m = Math.max(Math.abs(n[i * 3]), Math.abs(n[i * 3 + 1]), Math.abs(n[i * 3 + 2]));
		w[i] = m < wearThresh ? 1 : 0;
	}
	g.setAttribute('wear', new THREE.BufferAttribute(w, 1));
	return g;
}

// chamfered box (w along X, h along Y, d along Z)
function cbox(w, h, d, c = 0.001, p = null, r = null) {
	const a = w / 2, b = h / 2, e = d / 2;
	c = Math.min(c, a * 0.9, b * 0.9, e * 0.9);
	const pts = [];
	for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
		if (c < 1e-6) pts.push([sx * a, sy * b, sz * e]);
		else pts.push([sx * a, sy * (b - c), sz * (e - c)], [sx * (a - c), sy * b, sz * (e - c)], [sx * (a - c), sy * (b - c), sz * e]);
	}
	return xf(hull(pts), p, r);
}

// chamfered rectangle outline points at a given z (for lofted hulls)
function crect(x0, x1, y0, y1, c, z) {
	c = Math.min(c, (x1 - x0) * 0.45, (y1 - y0) * 0.45);
	return [[x0 + c, y0, z], [x1 - c, y0, z], [x1, y0 + c, z], [x1, y1 - c, z], [x1 - c, y1, z], [x0 + c, y1, z], [x0, y1 - c, z], [x0, y0 + c, z]];
}
// lofted hull through sections [z, x0, x1, y0, y1, c]
function loft(secs) {
	const pts = [];
	for (const [z, x0, x1, y0, y1, c] of secs) pts.push(...crect(x0, x1, y0, y1, c ?? 0.0008, z));
	return hull(pts);
}

// convex prism from a 2D convex profile in the (a,b) plane of `plane` ('xy': extrude along z)
function prism(prof, a0, a1, cham = 0.0006, plane = 'xy') {
	let cx = 0, cy = 0; for (const [x, y] of prof) { cx += x; cy += y; } cx /= prof.length; cy /= prof.length;
	const inset = (p, d) => { const dx = p[0] - cx, dy = p[1] - cy, l = Math.hypot(dx, dy) || 1; const k = Math.max(0, 1 - d / l); return [cx + dx * k, cy + dy * k]; };
	const pts = [];
	const put = (x, y, z) => {
		if (plane === 'xy') pts.push([x, y, z]);
		else if (plane === 'zy') pts.push([z, y, x]); // profile (z,y) extruded along x
		else pts.push([x, z, y]); // 'xz' profile (x,z) extruded along y
	};
	const lo = Math.min(a0, a1), hi = Math.max(a0, a1), c = Math.min(cham, (hi - lo) * 0.45);
	for (const p of prof) {
		const q = inset(p, c);
		put(p[0], p[1], lo + c); put(p[0], p[1], hi - c);
		put(q[0], q[1], lo); put(q[0], q[1], hi);
	}
	return hull(pts);
}

// rounded polygon: pts [[x,y,r?]...], returns [[x,y]...]
function rounded(pts, defR = 0, segs = 4) {
	const n = pts.length, out = [];
	for (let i = 0; i < n; i++) {
		const p = pts[i], r = p[2] ?? defR;
		if (!(r > 0)) { out.push([p[0], p[1]]); continue; }
		const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
		const d1x = a[0] - p[0], d1y = a[1] - p[1], l1 = Math.hypot(d1x, d1y);
		const d2x = b[0] - p[0], d2y = b[1] - p[1], l2 = Math.hypot(d2x, d2y);
		const t = Math.min(r, l1 * 0.48, l2 * 0.48);
		const s = [p[0] + d1x / l1 * t, p[1] + d1y / l1 * t], e = [p[0] + d2x / l2 * t, p[1] + d2y / l2 * t];
		for (let k = 0; k <= segs; k++) {
			const u = k / segs, iu = 1 - u;
			out.push([iu * iu * s[0] + 2 * iu * u * p[0] + u * u * e[0], iu * iu * s[1] + 2 * iu * u * p[1] + u * u * e[1]]);
		}
	}
	return out;
}
const toShape = (pts) => new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
const toPath = (pts) => new THREE.Path(pts.map(p => new THREE.Vector2(p[0], p[1])));
// rounded rectangle outline
function rrect(x0, y0, x1, y1, r, segs = 3) { return rounded([[x0, y0, r], [x1, y0, r], [x1, y1, r], [x0, y1, r]], r, segs); }
// circle outline
function circlePts(cx, cy, r, n = 16, a0 = 0) { const o = []; for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; }

/**
 * Extrude a 2D outline. plane 'zy': outline in (z,y) -> extruded along X (side profiles);
 * 'xy': outline in (x,y) -> along Z (cross sections); 'xz': outline in (x,z) -> along Y.
 * width = total thickness incl. bevel. Result is centred on the extrusion axis.
 */
function extrude(outline, width, o = {}) {
	const bevel = Math.min(o.bevel ?? 0.0008, width * 0.45);
	const shape = outline instanceof THREE.Shape ? outline : toShape(outline);
	if (o.holes) for (const h of o.holes) shape.holes.push(h instanceof THREE.Path ? h : toPath(h));
	const depth = Math.max(width - 2 * bevel, 1e-5);
	let g = new THREE.ExtrudeGeometry(shape, {
		depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel,
		bevelSegments: o.bevelSegs ?? 1, curveSegments: o.curveSegs ?? 6, steps: 1,
	});
	if (g.index) g = g.toNonIndexed();
	g.deleteAttribute('uv');
	g.translate(0, 0, -depth / 2);
	const plane = o.plane ?? 'zy';
	if (plane === 'zy') g.rotateY(-PI / 2);
	else if (plane === 'xz') g.rotateX(PI / 2);
	smoothNormals(g, 0);
	// wear on bevel faces
	const ax = plane === 'zy' ? 0 : plane === 'xy' ? 2 : 1;
	const n = g.attributes.normal.array, cnt = n.length / 3, w = new Float32Array(cnt);
	for (let i = 0; i < cnt; i++) { const c = Math.abs(n[i * 3 + ax]); w[i] = c > 0.12 && c < 0.94 ? 1 : 0; }
	g.setAttribute('wear', new THREE.BufferAttribute(w, 1));
	smoothNormals(g, o.crease ?? 32);
	if (o.pos || o.rot) xf(g, o.pos, o.rot);
	return g;
}

// sweep a 2D profile (closed loop [[u,v]...]) along a curve (THREE.Curve or array of points)
function sweep(path, prof, o = {}) {
	const curve = Array.isArray(path) ? new THREE.CatmullRomCurve3(path.map(p => new V3(p[0], p[1], p[2])), !!o.closed, 'centripetal') : path;
	const segs = o.segs ?? 24, closed = !!o.closed;
	const fr = curve.computeFrenetFrames(segs, closed);
	const rings = [];
	for (let i = 0; i <= segs; i++) {
		const c = curve.getPointAt(closed ? (i % segs) / segs : i / segs), N = fr.normals[i % (closed ? segs : segs + 1)], Bn = fr.binormals[i % (closed ? segs : segs + 1)];
		const sc = o.scale ? o.scale(i / segs) : 1;
		rings.push({ c, ring: prof.map(([u, v]) => [c.x + (N.x * u + Bn.x * v) * sc, c.y + (N.y * u + Bn.y * v) * sc, c.z + (N.z * u + Bn.z * v) * sc]) });
	}
	const A = new Acc(), m = prof.length;
	for (let i = 0; i < segs; i++) {
		const r0 = rings[i], r1 = rings[i + 1];
		for (let k = 0; k < m; k++) {
			const a = r0.ring[k], b = r0.ring[(k + 1) % m], c = r1.ring[(k + 1) % m], d = r1.ring[k];
			const mx = (a[0] + b[0] + c[0] + d[0]) / 4, my = (a[1] + b[1] + c[1] + d[1]) / 4, mz = (a[2] + b[2] + c[2] + d[2]) / 4;
			const cc = r0.c.clone().add(r1.c).multiplyScalar(0.5);
			A.oquad(a, b, c, d, [mx - cc.x, my - cc.y, mz - cc.z], o.wear ?? 0, 1);
		}
	}
	if (!closed && o.caps !== false) {
		for (const [idx, sgn] of [[0, -1], [segs, 1]]) {
			const R = rings[idx], t = curve.getTangentAt(idx / segs);
			const want = [t.x * sgn, t.y * sgn, t.z * sgn];
			const ctr = R.ring.reduce((s, p) => [s[0] + p[0] / m, s[1] + p[1] / m, s[2] + p[2] / m], [0, 0, 0]);
			for (let k = 0; k < m; k++) A.otri(ctr, R.ring[k], R.ring[(k + 1) % m], want, 0.5, 1);
		}
	}
	return A.geo(o.crease ?? 50);
}

// wrap a built-in THREE geometry into the pipeline
function fromThree(g, crease = null) {
	let r = g.index ? g.toNonIndexed() : g;
	if (r.attributes.uv) r.deleteAttribute('uv');
	if (crease !== null) smoothNormals(r, crease);
	return r;
}
const sphere = (rad, ws = 20, hs = 14) => fromThree(new THREE.SphereGeometry(rad, ws, hs));
const torus = (R, r, rs = 10, ts = 32, arc = TAU) => fromThree(new THREE.TorusGeometry(R, r, rs, ts, arc));

/* ============================================================================
 * Part builder: collects geometry per material, merges, creates meshes
 * ========================================================================== */
const _tmpC = new THREE.Color();
function prepGeo(g, mat, tint) {
	if (g.index) g = g.toNonIndexed();
	if (!g.attributes.normal) g.computeVertexNormals();
	const pos = g.attributes.position.array, nor = g.attributes.normal.array;
	const n = g.attributes.position.count;
	const wear = g.attributes.wear ? g.attributes.wear.array : null;
	const sh = g.attributes.shade ? g.attributes.shade.array : null;
	const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
	const S = mat.userData.uvScale ?? 10, k = mat.userData.wearK ?? [1, 1, 1];
	const ou = rnd() * 7.3, ov = rnd() * 5.1;
	let tr = 1, tg = 1, tb = 1;
	if (tint !== undefined && tint !== null) {
		if (typeof tint === 'number') { tr = tg = tb = tint; } else { tr = tint.r; tg = tint.g; tb = tint.b; }
	}
	for (let i = 0; i < n; i++) {
		const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
		const ax = Math.abs(nor[i * 3]), ay = Math.abs(nor[i * 3 + 1]), az = Math.abs(nor[i * 3 + 2]);
		let u, v;
		if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
		uv[i * 2] = u * S + ou; uv[i * 2 + 1] = v * S + ov;
		const w = wear ? wear[i] : 0, s = sh ? sh[i] : 1;
		col[i * 3] = tr * s * (1 + (k[0] - 1) * w);
		col[i * 3 + 1] = tg * s * (1 + (k[1] - 1) * w);
		col[i * 3 + 2] = tb * s * (1 + (k[2] - 1) * w);
	}
	const out = new THREE.BufferGeometry();
	out.setAttribute('position', new THREE.BufferAttribute(pos instanceof Float32Array ? pos : new Float32Array(pos), 3));
	out.setAttribute('normal', new THREE.BufferAttribute(nor instanceof Float32Array ? nor : new Float32Array(nor), 3));
	out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	out.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return out;
}

/**
 * Adapt an (indexed) GLB geometry from the Blender pipeline (tools/blender/gunkit.py) to these
 * materials: `color` from the baked COLOR_0 (r = edge wear, g = ambient occlusion) and box-projected
 * `uv`s, like prepGeo does for the procedural parts. Returns a new geometry.
 */
export function adoptBakedGeometry(src, matKey, tint) {
	const mat = getMat(matKey);
	const g = new THREE.BufferGeometry();
	g.setAttribute('position', src.attributes.position.clone());
	if (src.attributes.normal) g.setAttribute('normal', src.attributes.normal.clone());
	else g.computeVertexNormals();
	if (src.index) g.setIndex(src.index.clone());
	const pos = g.attributes.position, nor = g.attributes.normal, n = pos.count;
	const baked = src.attributes.color || null;
	const uv = new Float32Array(n * 2), col = new Float32Array(n * 3);
	const S = mat.userData.uvScale ?? 10, k = mat.userData.wearK ?? [1, 1, 1];
	const ou = rnd() * 7.3, ov = rnd() * 5.1;
	let tr = 1, tg = 1, tb = 1;
	if (typeof tint === 'number') tr = tg = tb = tint;
	else if (tint) { tr = tint.r; tg = tint.g; tb = tint.b; }
	for (let i = 0; i < n; i++) {
		const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
		const ax = Math.abs(nor.getX(i)), ay = Math.abs(nor.getY(i)), az = Math.abs(nor.getZ(i));
		let u, v;
		if (ax >= ay && ax >= az) { u = z; v = y; } else if (ay >= az) { u = x; v = z; } else { u = x; v = y; }
		uv[i * 2] = u * S + ou; uv[i * 2 + 1] = v * S + ov;
		const w = baked ? baked.getX(i) : 0;
		const ao = baked ? baked.getY(i) : 1;
		const s = 0.22 + 0.78 * Math.pow(Math.min(1, ao), 0.85);
		col[i * 3] = tr * s * (1 + (k[0] - 1) * w);
		col[i * 3 + 1] = tg * s * (1 + (k[1] - 1) * w);
		col[i * 3 + 2] = tb * s * (1 + (k[2] - 1) * w);
	}
	g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	g.setAttribute('color', new THREE.BufferAttribute(col, 3));
	return g;
}

// Blender material name -> [game material, vertex tint]
export const BAKED_MATERIALS = {
	anod: ['anod'], park: ['park'], poly: ['poly'], grip: ['grip'], steel: ['steel'], blued: ['blued'], greyAl: ['greyAl'],
	steelDark: ['steel', new THREE.Color(0x6c6f74)], brass: ['brass', new THREE.Color(0xd4a24c)], copper: ['brass', new THREE.Color(0xc47a4e)],
	greenTip: ['greenTip'], engrave: ['greyAl', 0.62], hole: ['hole'], rubber: ['rubber'], gold: ['gold'], white: ['white'],
	glove: ['glove'], gloveFabric: ['gloveFabric'], gloveArmor: ['gloveArmor'], sleeve: ['sleeve'],
};
export { getMat as gunMaterial };

class PB {
	constructor() { this.m = new Map(); }
	add(key, g, tint) {
		if (!g) return g;
		if (!this.m.has(key)) this.m.set(key, []);
		this.m.get(key).push([g, tint]);
		return g;
	}
	// merge per material and attach to parent. returns array of meshes
	build(parent, name = 'part') {
		const meshes = [];
		for (const [key, list] of this.m) {
			const mat = getMat(key);
			const geos = list.map(([g, t]) => prepGeo(g, mat, t));
			const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
			if (!merged) throw new Error(`gunModels: merge failed for ${name}/${key}`);
			merged.computeBoundingSphere(); merged.computeBoundingBox();
			const mesh = new THREE.Mesh(merged, mat);
			mesh.name = name + '_' + key;
			mesh.castShadow = !mat.transparent && !(mat.isMeshBasicMaterial);
			mesh.receiveShadow = true;
			if (mat.transparent) mesh.renderOrder = 2;
			parent.add(mesh);
			meshes.push(mesh);
		}
		this.m.clear();
		return meshes;
	}
}

function grp(name, parent, p, r) {
	const g = new THREE.Group(); g.name = name;
	if (p) g.position.set(p[0], p[1], p[2]);
	if (r) g.rotation.set(r[0], r[1], r[2]);
	if (parent) parent.add(g);
	return g;
}
function empty(name, parent, p, r) { const o = new THREE.Object3D(); o.name = name; if (p) o.position.set(p[0], p[1], p[2]); if (r) o.rotation.set(r[0], r[1], r[2]); if (parent) parent.add(o); return o; }

const col = (hex) => new THREE.Color(hex);
const TINT = {
	brass: col(0xd4a24c), copper: col(0xc47a4e), nickel: col(0xc8c8c4), steelDark: col(0x6c6f74),
	black: col(0x1a1a1a), odPaint: col(0x4d5634), yellow: col(0xd4a520), alu: col(0xb8bbbe), redHull: col(0xa51d17),
};

/* ============================================================================
 * Shared sub-assemblies
 * ========================================================================== */

// Picatinny rail along -Z from z0 to z1 (z0 > z1), base plane at y=0, centred x=0, in local space.
const RAIL_H = 0.0094;
function picRail(B, key, z0, z1, xfm = null, opts = {}) {
	const geos = [];
	// base with dovetail flanks
	geos.push(prism([[-0.0078, 0], [0.0078, 0], [0.0078, 0.0044], [0.0098, 0.0064], [-0.0098, 0.0064], [-0.0078, 0.0044]], z1, z0, 0.0005));
	// teeth
	const pitch = 0.01, tl = 0.0048;
	const len = z0 - z1, count = Math.max(1, Math.floor((len - 0.002) / pitch));
	const start = z0 - (len - (count - 1) * pitch - tl) / 2;
	for (let i = 0; i < count; i++) {
		const zc = start - tl / 2 - i * pitch;
		geos.push(prism([[-0.0098, 0.0064], [0.0098, 0.0064], [0.0106, 0.0071], [0.0106, 0.0086], [0.0099, RAIL_H], [-0.0099, RAIL_H], [-0.0106, 0.0086], [-0.0106, 0.0071]], zc - tl / 2, zc + tl / 2, 0.0005));
	}
	for (const g of geos) { if (xfm) xf(g, xfm.p, xfm.r); B.add(key, g, opts.tint); }
}

// small screw head facing +X (use rot to orient), radius r
function screwHead(r = 0.0022, h = 0.0008, slot = true) {
	const g = lathe([[0, h], [r * 0.75, h], [r, h * 0.35], [r, 0], [0, 0]], { segs: 12 });
	xf(g, null, [0, PI / 2, 0]); // axis Z -> X
	return g;
}

// round knurled knob (lathe with ridges) along Z
function knurledKnob(r, L, ridges = 18) {
	const h = L / 2, prof = [[0, h], [r * 0.85, h], [r, h - r * 0.15]];
	const g = lathe([...prof, [r, -h + r * 0.15], [r * 0.85, -h], [0, -h]], { segs: ridges * 2 });
	// ridges: displace every other ring vertex radially is costly; use thin bars instead
	const out = [g];
	for (let i = 0; i < ridges; i++) {
		const a = i / ridges * TAU;
		out.push(xf(cbox(r * 0.16, r * 0.12, L * 0.8, 0.0002), [Math.cos(a) * r, Math.sin(a) * r, 0], [0, 0, a]));
	}
	return out;
}

// cartridge along -Z (tip toward -Z), origin at the case head. dims in meters
// caseL, caseR (body radius), neckR, shoulderZ (distance from head to shoulder, null = straight),
// bulletL (exposed + seated length), bulletR
function cartridgeGeos(caseL, caseR, neckR, shoulderZ, bulletL, bulletR, opts = {}) {
	const rim = opts.rim ?? caseR, groove = opts.groove ?? Math.min(0.0012, caseL * 0.06), segs = opts.segs ?? 14;
	const cp = [[0, 0], [rim * 0.96, 0], [rim, -0.0003], [rim, -0.0010], [caseR * 0.84, -0.0013], [caseR * 0.84, -0.0013 - groove], [caseR, -0.0017 - groove]];
	const shades = [0.55, 1, 1, 1, 1, 1];
	if (shoulderZ) { cp.push([caseR * 0.975, -shoulderZ], [neckR, -shoulderZ - (caseR - neckR) * 1.4]); shades.push(1, 1); }
	cp.push([neckR, -caseL]); shades.push(1);
	if (opts.open) { cp.push([neckR * 0.86, -caseL], [neckR * 0.86, -caseL + 0.005], [0, -caseL + 0.005]); shades.push(1, 0.3, 0.15); }
	else cp.push([0, -caseL]);
	const caseG = lathe(cp, { segs, crease: 35, shade: shades });
	let bulletG = null;
	if (bulletL > 0) {
		const seat = bulletL * 0.28, zb = -caseL + seat, zbear = zb - bulletL * 0.42, zt = zb - bulletL;
		const bp = [[0, zb], [bulletR * 0.97, zb], [bulletR, zb - 0.0005], [bulletR, zbear]];
		for (let i = 1; i <= 6; i++) { const t = i / 6; bp.push([bulletR * Math.pow(Math.max(0, 1 - Math.pow(t, 1.7)), 0.62) + (i === 6 ? 0 : 0), zbear + (zt - zbear) * t]); }
		bp[bp.length - 1][0] = Math.min(bulletR * 0.12, 0.0004);
		bp.push([0, zt]);
		bulletG = lathe(bp, { segs, crease: 55 });
	}
	return { caseG, bulletG };
}

/* ============================================================================
 * Hand target helpers
 * ========================================================================== */
const _hx = new V3(), _hy = new V3(), _hz = new V3(), _hm = new THREE.Matrix4();
// orientation for a hand empty. palm = direction the palm faces, index = direction from the
// pinky side towards the index/thumb side (knuckle line). Right hand: local -X = palm,
// local +Y = index side, local -Z = fingers. Left hand: local +X = palm (mirror).
function handQuat(palm, index, isLeft = false) {
	_hx.set(palm[0], palm[1], palm[2]).normalize();
	if (!isLeft) _hx.negate();
	_hy.set(index[0], index[1], index[2]);
	_hy.addScaledVector(_hx, -_hy.dot(_hx)).normalize();
	_hz.crossVectors(_hx, _hy).normalize();
	_hm.makeBasis(_hx, _hy, _hz);
	return new THREE.Quaternion().setFromRotationMatrix(_hm);
}
export function handTarget(name, parent, pos, palm, index, isLeft, data) {
	const o = empty(name, parent, pos);
	o.quaternion.copy(handQuat(palm, index, isLeft));
	Object.assign(o.userData, { rx: 0.015, rz: 0.02, curl: 1, thumb: 0.6, trigger: false, isLeft: !!isLeft }, data || {});
	return o;
}

// Builders author everything inside a translated `body` group (gun coordinates); flatten it so
// every part / empty is a direct child of root and its .position is expressed in root space.
function flattenBody(root) {
	const body = root.children.find(c => c.name === 'body');
	if (!body) return;
	if (body.rotation.x || body.rotation.y || body.rotation.z || body.scale.x !== 1 || body.scale.y !== 1 || body.scale.z !== 1) return;
	const off = body.position.clone();
	for (const c of [...body.children]) {
		body.remove(c);
		if (c.isMesh) { c.geometry.translate(off.x, off.y, off.z); c.geometry.computeBoundingSphere(); c.geometry.computeBoundingBox(); }
		else c.position.add(off);
		root.add(c);
	}
	root.remove(body);
}
function finishWeapon(res) {
	flattenBody(res.root);
	res.root.traverse(o => { if (o.isMesh) o.frustumCulled = true; });
	res.root.updateMatrixWorld(true);
	return res;
}

/* ============================================================================
 * M4A1 carbine (RIS, iron sights: flip-up rear aperture + A2 front post, 30rd STANAG)
 * gun coords: bore y=0, upper receiver rear face z=0
 * ========================================================================== */
const M4_SIGHT_Y = 0.064; // sight line above the bore: rear aperture centre = flat top of the front post
const M4_AP_Z = -0.0105; // rear aperture plane (flip-up sight at the back of the rail)
const M4_AP_R = 0.0027; // peep hole radius (large aperture)
const M4_EYE_BACK = 0.07; // aiming: the eye sits this far behind the aperture

function m4MagInner() {
	const g = grp('m4MagModel');
	const B = new PB();
	// curved body: centreline straight to y=-0.015 then curving forward
	const dz = (y) => (y >= -0.015 ? 0 : -0.035 * Math.pow((-0.015 - y) / 0.095, 1.5));
	const dzd = (y) => (y >= -0.015 ? 0 : 0.5526 * Math.sqrt((-0.015 - y) / 0.095));
	const front = [], rear = [], frontP = [], rearP = [];
	const half = 0.0315, halfP = [0.0225, 0.025];
	for (let i = 0; i <= 16; i++) {
		const y = 0.056 - (0.056 + 0.110) * i / 16;
		const d = dzd(y), l = Math.hypot(1, d), nz = 1 / l, ny = -d / l;
		const c = [dz(y), y];
		front.push([c[0] - half * nz, c[1] - half * ny]);
		rear.push([c[0] + half * nz, c[1] + half * ny]);
		if (y <= 0.042 && y >= -0.098) {
			frontP.push([c[0] - halfP[0] * nz, c[1] - halfP[0] * ny]);
			rearP.push([c[0] + halfP[1] * nz, c[1] + halfP[1] * ny]);
		}
	}
	const outline = [...front, ...rear.reverse()];
	B.add('anod', extrude(outline, 0.0224, { bevel: 0.0011, crease: 25 }), 0.95);
	B.add('anod', extrude([...frontP, ...rearP.reverse()], 0.0238, { bevel: 0.0006, crease: 25 }), 1.08);
	// front spine rib
	const spine = front.slice(1, 15).map(p => [p[0] + 0.0012, p[1]]);
	const spine2 = spine.map(p => [p[0] - 0.0028, p[1]]).reverse();
	B.add('anod', extrude([...spine, ...spine2], 0.012, { bevel: 0.0008, crease: 25 }), 1.1);
	// stamped stiffening ribs along the curve, both sides (band a..b off the centreline)
	const band = (a, b, y0, y1, n = 12) => {
		const A = [], Z = [];
		for (let i = 0; i <= n; i++) {
			const y = y0 + (y1 - y0) * i / n, d = dzd(y), l = Math.hypot(1, d), nz = 1 / l, ny = -d / l, cz = dz(y);
			A.push([cz + a * nz, y + a * ny]); Z.push([cz + b * nz, y + b * ny]);
		}
		return [...A, ...Z.reverse()];
	};
	for (const [a, b] of [[-0.0172, -0.0146], [0.0158, 0.0184]]) B.add('anod', extrude(band(a, b, 0.034, -0.092), 0.0254, { bevel: 0.0007, crease: 25 }), 1.18);
	// floor plate
	const yb = -0.110, ang = Math.atan(dzd(yb));
	const fp = [0, yb - 0.0006 * Math.cos(ang), dz(yb) - 0.0015];
	B.add('anod', cbox(0.0262, 0.0052, 0.0695, 0.0016, fp, [ang, 0, 0]), 0.8);
	// floor plate retaining tab (pressed boss at the rear), placed in the plate's tilted frame
	const ly = -0.0030, lz = 0.02;
	B.add('anod', cbox(0.011, 0.0014, 0.012, 0.0005, [0, fp[1] + ly * Math.cos(ang) - lz * Math.sin(ang), fp[2] + ly * Math.sin(ang) + lz * Math.cos(ang)], [ang, 0, 0]), 0.95);
	// feed lips
	for (const s of [-1, 1]) {
		B.add('anod', loft([[0.026, s > 0 ? 0.0078 : -0.0112, s > 0 ? 0.0112 : -0.0078, 0.054, 0.0605, 0.0008], [-0.026, s > 0 ? 0.0078 : -0.0112, s > 0 ? 0.0112 : -0.0078, 0.054, 0.0605, 0.0008]]));
	}
	// double stack of 5.56: the top round staggered right, the next one left and lower, bullets forward
	for (const [x, y] of [[0.0028, 0.0612], [-0.0030, 0.0548]]) {
		const { caseG, bulletG } = cartridgeGeos(0.0449, 0.00475, 0.00315, 0.036, 0.019, 0.00285, { segs: 12 });
		xf(caseG, [x, y, 0.027]); xf(bulletG, [x, y, 0.027]);
		B.add('brass', caseG, TINT.brass); B.add('brass', bulletG, TINT.copper);
	}
	B.build(g, 'm4mag');
	return g;
}

function buildM4A1() {
	const root = grp('m4a1');
	const WEB = [0, -0.047, 0.031];
	const body = grp('body', root, [0, -WEB[1], -WEB[2]]);
	const B = new PB();
	const UP_T = 0.0235, UP_B = -0.0165; // upper receiver top / seam

	/* ---- upper receiver (split so the ejection port is a real pocket) ---- */
	// flat sides up to UP_M, then the roof's angled flats narrow to the rail
	const UP_M = 0.011;
	const upProf = rounded([[0.0, UP_M, 0.001], [-0.176, UP_M, 0.001], [-0.176, UP_B, 0.0015], [0.0, UP_B, 0.0015]], 0, 2);
	B.add('anod', extrude(upProf, 0.0185, { bevel: 0.0009, pos: [-0.00525, 0, 0] }), 1.06);
	B.add('anod', extrude(upProf, 0.0105, { bevel: 0.0009, holes: [rrect(-0.106, -0.0088, -0.047, 0.0098, 0.0018)], pos: [0.00925, 0, 0] }), 1.06);
	B.add('anod', prism([[-0.01455, 0.0098], [0.01455, 0.0098], [0.01455, 0.0128], [0.0106, UP_T], [-0.0106, UP_T], [-0.01455, 0.0128]], -0.176, 0.0, 0.0006, 'xy'), 1.06);
	// receiver front ring (barrel nut region) + delta ring
	B.add('park', lathe([[0.0165, -0.172], [0.0175, -0.1735], [0.0175, -0.1775], [0.0205, -0.178], [0.0232, -0.1805], [0.0248, -0.1875], [0.0248, -0.1935], [0.0222, -0.1965], [0.0105, -0.1965]], { segs: 32 }));
	// forward assist housing + plunger
	B.add('anod', xf(cyl(0.0064, 0.02, 18, 0.0012), [0.0118, 0.0085, -0.019], [0, 30 * DEG, 0]));
	B.add('park', xf(lathe([[0, -0.0055], [0.0046, -0.0055], [0.0049, -0.0035], [0.0049, 0.0035], [0.0044, 0.0052], [0.0025, 0.0058], [0, 0.0058]], { segs: 18 }), [0.0178, 0.0085, -0.0085], [0, 30 * DEG, 0]));
	for (let i = 0; i < 4; i++) B.add('park', xf(tube(0.0052, 0.0042, 0.0006, 18), [0.0178 + 0.5 * (i * 0.0021 - 0.003), 0.0085, -0.0085 + 0.866 * (i * 0.0021 - 0.003)], [0, 30 * DEG, 0]), 0.6);
	// brass deflector
	B.add('anod', loft([[-0.047, 0.012, 0.0152, -0.006, 0.0125, 0.001], [-0.038, 0.012, 0.0215, -0.005, 0.0125, 0.0015], [-0.029, 0.012, 0.0192, -0.003, 0.0105, 0.0015]]));
	// dust cover (open, hanging)
	B.add('park', cbox(0.0012, 0.019, 0.060, 0.0004, [0.0152 + 0.0026, -0.0110 - 0.0092, -0.0765], [0, 0, 16 * DEG]));
	// its stiffening lip along the free edge + the latch nub, and the hinge rod (steel)
	B.add('park', cbox(0.0026, 0.0024, 0.056, 0.0004, [0.0205, -0.0290, -0.0765], [0, 0, 16 * DEG]), 1.1);
	B.add('park', cbox(0.0022, 0.0034, 0.006, 0.0005, [0.0199, -0.0262, -0.1005], [0, 0, 16 * DEG]), 1.1);
	B.add('steel', xf(cyl(0.0012, 0.068, 8, 0.0003), [0.0153, -0.0105, -0.0765]), TINT.steelDark);
	// ejection port inner shadow (back wall darkening)
	B.add('anod', cbox(0.0006, 0.0182, 0.0585, 0.0002, [0.0043, 0.0005, -0.0765]), 0.35);
	// top rail; dark slot floors between the cross-slots read as recesses
	picRail(B, 'anod', -0.001, -0.175, { p: [0, UP_T, 0] });
	const railFloor = (z0, z1, p, r) => B.add('anod', xf(cbox(0.0194, 0.0006, z0 - z1 - 0.002, 0.0001, [0, 0.0066, (z0 + z1) / 2]), p, r), 0.4);
	railFloor(-0.001, -0.175, [0, UP_T, 0]);
	/* ---- lower receiver ---- */
	const lowProf = rounded([
		[0.016, UP_B, 0.001], [-0.1695, UP_B, 0.001], [-0.1695, -0.026, 0.002], [-0.1665, -0.030, 0.001],
		[-0.1665, -0.060, 0.002], [-0.1705, -0.0705, 0.002], [-0.1695, -0.0765, 0.0012], [-0.0965, -0.0765, 0.0012],
		[-0.0955, -0.060, 0.002], [-0.090, -0.050, 0.003], [-0.083, -0.046, 0.002], [0.024, -0.046, 0.002],
		[0.030, -0.040, 0.004], [0.030, -0.026, 0.004], [0.022, -0.0195, 0.002],
	], 0, 3);
	B.add('anod', extrude(lowProf, 0.0285, { bevel: 0.0011 }), 0.94); // lower: a shade off the upper, like mismatched anodizing
	// magwell flare (wider)
	B.add('anod', extrude(rounded([[-0.1665, -0.031, 0.001], [-0.0962, -0.031, 0.001], [-0.0962, -0.0765, 0.0012], [-0.1695, -0.0765, 0.0012], [-0.1705, -0.0705, 0.002], [-0.1665, -0.060, 0.002]], 0, 2), 0.0328, { bevel: 0.0011 }), 0.94);
	// magwell opening (dark)
	B.add('poly', cbox(0.0236, 0.0006, 0.0665, 0.0001, [0, -0.0767, -0.1330]), 0.12);
	// mag release fence + button (right)
	B.add('anod', loft([[-0.080, 0.0142, 0.0170, -0.043, -0.024, 0.001], [-0.0985, 0.0142, 0.0170, -0.043, -0.024, 0.001]]));
	B.add('park', xf(cyl(0.0046, 0.004, 16, 0.0008), [0.0178, -0.0335, -0.0893], [0, PI / 2, 0]));
	// bolt catch (left)
	B.add('park', loft([[-0.079, -0.0170, -0.0142, -0.027, -0.015, 0.0008], [-0.093, -0.0172, -0.0142, -0.026, -0.018, 0.0008]]));
	// receiver extension ring
	B.add('anod', lathe([[0.0145, 0.0095], [0.0158, 0.0095], [0.0165, 0.0088], [0.0165, 0.0008], [0.0158, 0.0], [0.0145, 0.0]], { segs: 28 }));
	// trigger guard
	B.add('anod', extrude(rounded([[-0.0935, -0.044, 0.001], [-0.0865, -0.044, 0.001], [-0.0865, -0.0635, 0.003], [-0.026, -0.0635, 0.004], [-0.0145, -0.050, 0.003], [-0.0125, -0.0445, 0.001], [-0.0065, -0.0445, 0.001], [-0.0085, -0.052, 0.004], [-0.0215, -0.0705, 0.005], [-0.0885, -0.0705, 0.003], [-0.0935, -0.066, 0.002]], 0, 3), 0.0125, { bevel: 0.0012 }));
	// pins (both sides)
	for (const s of [-1, 1]) {
		for (const [z, y, r] of [[0.009, -0.0105, 0.0028], [-0.1635, -0.0115, 0.0028], [-0.0505, -0.0355, 0.0022], [-0.0285, -0.0290, 0.0022]]) {
			B.add('park', xf(screwHead(r, 0.0007), [s * 0.0142, y, z], [0, s > 0 ? 0 : PI, 0]));
		}
	}
	// selector (left) at safe, detent end (right)
	B.add('park', xf(lathe([[0, 0.0012], [0.0056, 0.0012], [0.0058, 0], [0, 0]], { segs: 18 }), [-0.0143, -0.030, -0.0105], [0, -PI / 2, 0]));
	B.add('park', loft([[-0.0085, -0.0172, -0.0155, -0.0335, -0.0265, 0.0008], [-0.0245, -0.0170, -0.0155, -0.0325, -0.0275, 0.0008]]));
	B.add('park', xf(cyl(0.0033, 0.0012, 12), [0.0145, -0.030, -0.0105], [0, PI / 2, 0]));
	/* ---- pistol grip (A2) ---- */
	const ga = 20 * DEG;
	const gp = (u, v) => [0.011 + v * Math.cos(ga) + u * Math.sin(ga), -0.046 - u * Math.cos(ga) + v * Math.sin(ga)];
	const gFront = [[-0.006, -0.020], [0.012, -0.0195], [0.028, -0.0225], [0.041, -0.0185], [0.057, -0.0205], [0.083, -0.019], [0.099, -0.0165, 0.006]];
	const gRear = [[0.099, 0.0158, 0.006], [0.082, 0.0185], [0.045, 0.0182], [0.018, 0.0205], [0.002, 0.0245], [-0.006, 0.024]];
	const gOut = rounded([...gFront, ...gRear].map(([u, v, r]) => [...gp(u, v), r ?? 0.002]), 0, 3);
	B.add('poly', extrude(gOut, 0.0282, { bevel: 0.0048, bevelSegs: 3, crease: 40 }));
	// checkered side panels standing proud of the stippled shell, and the open bottom of the grip
	B.add('grip', extrude(rrect(0.014, -0.0115, 0.086, 0.0105, 0.004, 3).map(([u, v]) => gp(u, v)), 0.0292, { bevel: 0.0004, crease: 40 }));
	B.add('hole', xf(cbox(0.016, 0.0012, 0.022, 0.0005), [0, gp(0.0985, 0)[1], gp(0.0985, 0)[0]], [-ga, 0, 0]));
	/* ---- buffer tube, castle nut, end plate, stock ---- */
	B.add('anod', lathe([[0, 0.192], [0.0126, 0.192], [0.0146, 0.190], [0.0146, 0.0095]], { segs: 28 }));
	B.add('park', lathe([[0.0146, 0.0215], [0.0172, 0.0215], [0.0184, 0.0205], [0.0184, 0.0125], [0.0172, 0.0118], [0.0146, 0.0118]], { segs: 28 }));
	for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * TAU; B.add('poly', xf(cbox(0.0028, 0.0012, 0.0036, 0.0002), [Math.cos(a) * 0.0181, Math.sin(a) * 0.0181, 0.019], [0, 0, a + PI / 2]), 0.15); }
	B.add('park', extrude(rounded([[-0.0182, -0.0195, 0.004], [0.0182, -0.0195, 0.004], [0.0182, 0.0175, 0.006], [-0.0182, 0.0175, 0.006]], 0, 3), 0.0016, { plane: 'xy', bevel: 0.0004, pos: [0, 0, 0.0108], holes: [circlePts(0, 0, 0.0146, 20)] }));
	B.add('park', xf(torus(0.0055, 0.0011, 6, 16), [-0.0205, -0.0015, 0.0135], [0, PI / 2, 0]));
	// strip under tube with detent holes
	B.add('anod', cbox(0.0065, 0.0028, 0.168, 0.0006, [0, -0.0152, 0.108]));
	for (let i = 0; i < 6; i++) B.add('hole', xf(cyl(0.0015, 0.0006, 10), [0, -0.0167, 0.032 + i * 0.0145], [PI / 2, 0, 0]));
	// M4 collapsible stock: tube sleeve + slimmer web + wide butt
	B.add('poly', extrude(rounded([[0.118, 0.0186, 0.004], [0.246, 0.0205, 0.004], [0.246, -0.0225, 0.004], [0.128, -0.0235, 0.006], [0.118, -0.012, 0.004]], 0, 3), 0.0355, { bevel: 0.0045, bevelSegs: 2, crease: 38 }));
	B.add('poly', extrude(rounded([[0.150, -0.018, 0.004], [0.250, -0.018, 0.004], [0.250, -0.090, 0.006], [0.240, -0.0925, 0.006], [0.165, -0.040, 0.012]], 0, 3), 0.0245, { bevel: 0.003, bevelSegs: 2, crease: 38 }));
	B.add('poly', extrude(rounded([[0.238, 0.0215, 0.004], [0.262, 0.0285, 0.003], [0.262, -0.0925, 0.005], [0.249, -0.0945, 0.006], [0.238, -0.080, 0.006]], 0, 3), 0.0385, { bevel: 0.0035, bevelSegs: 2, crease: 38 }));
	// waffle ribs on the web
	for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) B.add('poly', cbox(0.0016, 0.0035, 0.052 - i * 0.012, 0.0006, [sx * 0.0125, -0.030 - i * 0.017, 0.212 + i * 0.006]), 0.8);
	B.add('poly', cbox(0.0362, 0.0055, 0.019, 0.001, [0, -0.074, 0.236]), 0.15);
	// adjustment latch lever under the sleeve: finger pad ridges + pivot pin
	B.add('poly', loft([[0.120, -0.0055, 0.0055, -0.0275, -0.018, 0.0012], [0.176, -0.0055, 0.0055, -0.0268, -0.018, 0.0012]]), 0.9);
	for (let i = 0; i < 4; i++) B.add('poly', cbox(0.0106, 0.0012, 0.0016, 0.0004, [0, -0.0279, 0.124 + i * 0.0042]), 1.1);
	B.add('steel', xf(cyl(0.0016, 0.0126, 10, 0.0003), [0, -0.0215, 0.169], [0, PI / 2, 0]), TINT.steelDark);
	// rubber butt pad with grip ribs round its edge
	B.add('rubber', extrude(rounded([[0.2605, 0.0295, 0.004], [0.2795, 0.0295, 0.004], [0.2795, -0.0955, 0.006], [0.2605, -0.0955, 0.004]], 0, 3), 0.0395, { bevel: 0.0035, bevelSegs: 2 }));
	for (let i = 0; i < 9; i++) B.add('rubber', cbox(0.0404, 0.0014, 0.013, 0.0005, [0, 0.0195 - i * 0.0126, 0.2715]), 1.25);
	/* ---- RIS handguard ---- */
	const HC = 0.002, HS = 0.0215, HCH = 0.0085; // centre y, half size, corner chamfer
	B.add('anod', prism([[-HS + HCH, -HS + HC], [HS - HCH, -HS + HC], [HS, -HS + HCH + HC], [HS, HS - HCH + HC], [HS - HCH, HS + HC], [-HS + HCH, HS + HC], [-HS, HS - HCH + HC], [-HS, -HS + HCH + HC]], -0.1965, -0.3645, 0.0012));
	picRail(B, 'anod', -0.198, -0.3625, { p: [0, HC + HS, 0] });
	picRail(B, 'anod', -0.198, -0.3625, { p: [0, HC - HS, 0], r: [0, 0, PI] });
	picRail(B, 'anod', -0.198, -0.3625, { p: [HS, HC, 0], r: [0, 0, -PI / 2] });
	picRail(B, 'anod', -0.198, -0.3625, { p: [-HS, HC, 0], r: [0, 0, PI / 2] });
	railFloor(-0.198, -0.3625, [0, HC + HS, 0]);
	railFloor(-0.198, -0.3625, [0, HC - HS, 0], [0, 0, PI]);
	railFloor(-0.198, -0.3625, [HS, HC, 0], [0, 0, -PI / 2]);
	railFloor(-0.198, -0.3625, [-HS, HC, 0], [0, 0, PI / 2]);
	for (const phi of [45, 135, 225, 315]) {
		const a = phi * DEG, d = HS - HCH / 2 + 0.00005;
		for (let i = 0; i < 6; i++) {
			B.add('poly', cbox(0.0038, 0.0005, 0.011, 0.0002, [Math.cos(a) * d, HC + Math.sin(a) * d, -0.215 - i * 0.0255], [0, 0, a - PI / 2]), 0.12);
		}
	}
	// handguard end cap
	B.add('park', lathe([[0.0105, -0.3645], [0.0225, -0.3645], [0.0235, -0.3655], [0.0235, -0.3695], [0.0225, -0.3705], [0.0105, -0.3705]], { segs: 32 }));
	/* ---- barrel ---- */
	B.add('park', lathe([[0.0098, -0.19], [0.0098, -0.3995], [0.0081, -0.401], [0.0081, -0.5036], [0.0072, -0.5042], [0.0072, -0.506], [0, -0.506]], { segs: 24 }));
	// A2 birdcage flash hider
	B.add('park', lathe([[0.0072, -0.5035], [0.0104, -0.5035], [0.0112, -0.5045], [0.0112, -0.5170], [0.0031, -0.5170], [0.0031, -0.5080], [0, -0.508]], { segs: 24, shade: [1, 1, 1, 0.45, 0.08, 0.05] }));
	const prongs = [[270, 66], [198, 34], [126, 34], [54, 34], [342, 34]];
	for (const [c, w] of prongs) {
		B.add('park', lathe([[0.0078, -0.517], [0.0112, -0.517], [0.0112, -0.5475], [0.0078, -0.5475], [0.0078, -0.517]], { segs: 5, t0: (c - w / 2) * DEG, t1: (c + w / 2) * DEG, shade: [1, 1, 1, 0.35] }));
	}
	B.add('park', lathe([[0.0078, -0.5475], [0.0112, -0.5475], [0.0112, -0.5537], [0.0105, -0.555], [0.0078, -0.555], [0.0078, -0.5475]], { segs: 24, shade: [1, 1, 1, 1, 0.3] }));
	/* ---- A2 front sight base ---- */
	B.add('park', lathe([[0.0081, -0.371], [0.0122, -0.371], [0.0129, -0.3722], [0.0129, -0.4008], [0.0122, -0.402], [0.0081, -0.402]], { segs: 24 }));
	B.add('park', loft([[-0.3725, -0.0096, 0.0096, 0.0, 0.0182, 0.0016], [-0.4005, -0.0096, 0.0096, 0.0, 0.0182, 0.0016]]));
	// A-frame tower and protective wings: their raked faces are flat stock, not worn edges (they face
	// the eye when aiming and would read as bright bars either side of the post)
	B.add('park', worn(prism([[-0.3718, 0.0175], [-0.4012, 0.0175], [-0.3978, 0.0305], [-0.3752, 0.0305]], -0.0094, 0.0094, 0.0008, 'zy'), 0.1));
	for (const s of [-1, 1]) B.add('park', worn(prism([[-0.3735, 0.028], [-0.3995, 0.028], [-0.3897, 0.0655], [-0.3848, 0.0655]], s * 0.0049, s * 0.0093, 0.0006, 'zy'), 0.1));
	// square post on its round detent shank; its flat top is the sight line (M4_SIGHT_Y)
	const FPZ = -0.38725;
	B.add('park', cbox(0.0024, M4_SIGHT_Y - 0.031, 0.0022, 0.00025, [0, (M4_SIGHT_Y + 0.031) / 2, FPZ]), 0.9);
	B.add('park', xf(cyl(0.0026, 0.0046, 14, 0.0005), [0, 0.0323, FPZ], [PI / 2, 0, 0]), 1.1);
	B.add('park', loft([[-0.377, -0.0042, 0.0042, -0.027, -0.010, 0.001], [-0.3995, -0.0042, 0.0042, -0.027, -0.010, 0.001]]));
	B.add('park', xf(torus(0.0068, 0.0012, 6, 18), [0, -0.0335, -0.3962], [0, PI / 2, 0]));
	for (const s of [-1, 1]) for (const z of [-0.3775, -0.3955]) B.add('park', xf(screwHead(0.0014, 0.0003), [s * 0.0096, 0.009, z], [0, s > 0 ? 0 : PI, 0]), 0.8);
	/* ---- flip-up rear sight (BUIS), deployed: rail clamp, protective ears, aperture leaf ---- */
	const RT = UP_T + RAIL_H; // rail top
	const SY = M4_SIGHT_Y, AZ = M4_AP_Z;
	// base: deck on the rail with a sloped nose, clamp jaws down the rail flanks, knurled cross-bolt nut
	B.add('anod', loft([[-0.0035, -0.0118, 0.0118, RT - 0.0004, RT + 0.0048, 0.0012], [-0.0335, -0.0118, 0.0118, RT - 0.0004, RT + 0.0048, 0.0012], [-0.0385, -0.0118, 0.0118, RT - 0.0004, RT + 0.0016, 0.0008]]));
	for (const s of [-1, 1]) B.add('anod', cbox(0.0026, 0.0078, 0.030, 0.0006, [s * 0.0112, RT - 0.0042, -0.0205]));
	for (const g of knurledKnob(0.0046, 0.0048, 14)) B.add('park', xf(g, [0.0149, RT - 0.0045, -0.0205], [0, PI / 2, 0]));
	B.add('steel', xf(screwHead(0.0019, 0.0006), [-0.0125, RT - 0.0045, -0.0205], [0, PI, 0]), TINT.steelDark);
	// protective ears either side of the leaf, a little taller than it
	for (const s of [-1, 1]) B.add('anod', prism([[-0.0045, RT + 0.004], [-0.0335, RT + 0.004], [AZ - 0.0078, SY + 0.0062], [AZ + 0.0042, SY + 0.0062]], s * 0.0068, s * 0.0104, 0.0007, 'zy'));
	// aperture leaf standing on its hinge (round top around the peep, lightening window below it),
	// peep ring boss on the eye side
	const LW = 0.0056, leaf = [[-LW, RT + 0.0028], [LW, RT + 0.0028]];
	for (let i = 0; i <= 12; i++) { const a = i / 12 * PI; leaf.push([Math.cos(a) * LW, SY + Math.sin(a) * LW]); }
	const holes = [circlePts(0, SY, M4_AP_R, 28), rrect(-0.0028, RT + 0.0085, 0.0028, SY - 0.0088, 0.0014, 2)];
	B.add('anod', extrude(leaf, 0.0028, { plane: 'xy', bevel: 0.0005, holes, pos: [0, 0, AZ] }), 1.1);
	B.add('anod', xf(tube(0.0043, M4_AP_R, 0.0026, 28, 0.0006), [0, SY, AZ + 0.0026]), 1.1);
	// hinge knuckle + pin heads on the ears, knurled windage drum on the right ear
	B.add('anod', xf(cyl(0.0022, 0.0132, 14, 0.0004), [0, RT + 0.0042, AZ], [0, PI / 2, 0]));
	for (const s of [-1, 1]) B.add('steel', xf(screwHead(0.0014, 0.0004), [s * 0.0104, RT + 0.0042, AZ], [0, s > 0 ? 0 : PI, 0]), TINT.steelDark);
	for (const g of knurledKnob(0.0040, 0.0036, 14)) B.add('park', xf(g, [0.0122, RT + 0.0125, AZ - 0.0045], [0, PI / 2, 0]));
	B.build(body, 'm4a1');

	/* ---- moving parts ---- */
	const parts = {};
	// charging handle (pulls back +Z ~0.07)
	const ch = grp('chargingHandle', body, [0, 0.0202, 0]);
	// T-handle (top-view outline x/z, finger hooks either side) on the shaft that runs into the upper
	const chOut = rounded([[-0.0068, 0.0005, 0.0005], [0.0068, 0.0005, 0.0005], [0.0068, 0.0042, 0.0012], [0.0212, 0.0042, 0.002], [0.0246, 0.0078, 0.0025], [0.0240, 0.0155, 0.003],
		[-0.0240, 0.0155, 0.003], [-0.0246, 0.0078, 0.0025], [-0.0212, 0.0042, 0.002], [-0.0068, 0.0042, 0.0012]], 0, 2);
	B.add('anod', extrude(chOut, 0.0062, { plane: 'xz', bevel: 0.0008 }));
	B.add('anod', cbox(0.009, 0.004, 0.05, 0.0006, [0, 0.0, -0.024]));
	// latch on the left arm: lever with a serrated thumb pad on its pivot pin
	B.add('park', extrude(rounded([[-0.0250, 0.0060, 0.0015], [-0.0112, 0.0060, 0.0008], [-0.0100, 0.0150, 0.0015], [-0.0244, 0.0150, 0.0025]], 0, 2), 0.0024, { plane: 'xz', bevel: 0.0005, pos: [0, 0.0034, 0] }));
	for (let i = 0; i < 4; i++) B.add('park', cbox(0.0007, 0.0008, 0.0080, 0.0002, [-0.0236 + i * 0.0015, 0.0048, 0.0105]), 1.2);
	B.add('steel', xf(cyl(0.0011, 0.0074, 10, 0.0002), [-0.0118, 0.0006, 0.0128], [PI / 2, 0, 0]), TINT.steelDark);
	B.build(ch, 'm4ch');
	parts.chargingHandle = ch;
	// bolt carrier group (visible in the port; travels back +Z ~0.075)
	const bolt = grp('bolt', body, [0, 0, 0]);
	B.add('steel', lathe([[0.0122, -0.012], [0.0122, -0.1075], [0.0108, -0.1095], [0.0094, -0.1095], [0.0094, -0.1245], [0.0086, -0.1262], [0, -0.1262]], { segs: 24 }), TINT.steelDark);
	for (let i = 0; i < 10; i++) B.add('steel', cbox(0.0012, 0.0036, 0.0016, 0.0002, [0.0117, 0.0025, -0.056 - i * 0.004], [0, 0, 0]), 0.25);
	B.add('steel', cbox(0.0035, 0.0028, 0.012, 0.0005, [0.0086, 0.004, -0.119]), 0.6);
	B.build(bolt, 'm4bolt');
	parts.bolt = bolt;
	// trigger (pivot on trigger pin; pull = rotation.x negative)
	const trig = grp('trigger', body, [0, -0.0355, -0.0505]);
	B.add('park', extrude(rounded([[0.0042, 0.0035, 0.001], [-0.0035, 0.0035, 0.001], [-0.0052, -0.009, 0], [-0.0078, -0.0185, 0], [-0.0098, -0.0245, 0.001], [-0.0086, -0.0268, 0.001], [-0.0056, -0.0238, 0], [-0.0022, -0.0155, 0], [0.0022, -0.006, 0]], 0, 2), 0.0062, { bevel: 0.0009 }));
	B.build(trig, 'm4trigger');
	parts.trigger = trig;
	// magazine (pivot at the magwell mouth; drop along local -Y)
	const mag = grp('mag', body, [0, -0.0765, -0.1325]);
	const magProto = m4MagInner();
	mag.add(magProto);
	parts.mag = mag;

	/* ---- empties ---- */
	const muzzle = empty('muzzle', body, [0, 0, -0.556]);
	const ejectPort = empty('ejectPort', body, [0.016, 0.001, -0.076]);
	const rightHand = handTarget('rightHand', body, [0, gp(0.006, 0)[1], gp(0.006, 0)[0]], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.0145, rz: 0.021, curl: 1, trigger: true, thumb: 0.75 });
	const leftHand = handTarget('leftHand', body, [0, HC, -0.300], [0.32, 1, 0], [0, 0, -1], true, { rx: 0.031, rz: 0.030, curl: 0.8, thumb: 0.15 });
	// aiming: the eye on the sight line behind the peep, so the aperture and the post meet at screen centre
	const eye = new V3(0, M4_SIGHT_Y, M4_AP_Z + M4_EYE_BACK).add(body.position);
	return finishWeapon({
		root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts,
		magazineModel: () => magProto.clone(true), shellType: 'rifle',
	});
}

/* ============================================================================
 * 12 gauge shells (shared by Benelli, Striker and ejected hulls)
 * along -Z, head at z=0
 * ========================================================================== */
function shotshellGeos(loaded = true) {
	const head = lathe([[0, 0], [0.0110, 0], [0.0113, -0.0004], [0.0113, -0.0011], [0.0104, -0.0015], [0.0104, -0.0158], [0.0101, -0.0164]], { segs: 20 });
	const primer = xf(cyl(0.0029, 0.0006, 12), [0, 0, 0.0001]);
	const hull = [];
	if (loaded) {
		hull.push(lathe([[0.0101, -0.0155], [0.01025, -0.0175], [0.01025, -0.0605], [0.0099, -0.0622], [0.0088, -0.0632], [0.0045, -0.0636], [0.0012, -0.0628], [0, -0.0628]], { segs: 20, shade: [1, 1, 1, 0.8, 0.7, 0.55, 0.5] }));
		// folded crimp creases
		for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; hull.push(shade(xf(cbox(0.0006, 0.0072, 0.0005, 0.0001), [Math.cos(a) * 0.005, Math.sin(a) * 0.005, -0.0633], [0, 0, a + PI / 2]), 0.5)); }
	} else {
		hull.push(lathe([[0.0101, -0.0155], [0.01025, -0.0175], [0.01025, -0.066], [0.0106, -0.0695], [0.0099, -0.0698], [0.0096, -0.066], [0.0096, -0.022], [0, -0.022]], { segs: 20, shade: [1, 1, 1, 1, 0.8, 0.35, 0.15] }));
	}
	return { head, primer, hull };
}
function shotshellModel(loaded = true) {
	const g = grp('shell12');
	const B = new PB();
	const s = shotshellGeos(loaded);
	B.add('brass', s.head, TINT.brass); B.add('brass', s.primer, TINT.nickel);
	for (const h of s.hull) B.add('hull', h);
	B.build(g, 'shell12');
	return g;
}

/* ============================================================================
 * Benelli M4 Super 90 (M1014)
 * gun coords: bore y=0, receiver rear face z=0
 * ========================================================================== */
function buildM4Super90() {
	const root = grp('m4super90');
	const WEB = [0, -0.050, 0.034];
	const body = grp('body', root, [0, -WEB[1], -WEB[2]]);
	const B = new PB();
	const RT = 0.024, RB = -0.036, RF = -0.235;
	/* ---- receiver (light grey alloy) ---- */
	const recProf = rounded([[0.0, RT, 0.003], [RF, RT, 0.003], [RF, -0.012, 0.002], [RF + 0.013, RB, 0.003], [0.0, RB, 0.002]], 0, 3);
	B.add('greyAl', extrude(recProf, 0.021, { bevel: 0.0022, bevelSegs: 2, pos: [-0.0065, 0, 0] }));
	B.add('greyAl', extrude(recProf, 0.013, { bevel: 0.0022, bevelSegs: 2, holes: [rrect(-0.170, -0.0125, -0.085, 0.0125, 0.002)], pos: [0.0105, 0, 0] }));
	B.add('greyAl', cbox(0.0006, 0.024, 0.084, 0.0002, [0.0043, 0, -0.1275]), 0.3);
	// recessed side panels
	for (const s of [-1, 1]) B.add('greyAl', cbox(0.0008, 0.018, 0.06, 0.0004, [s * 0.0172, -0.018, -0.045]), 0.82);
	// loading port (bottom) with carrier/lifter
	B.add('greyAl', cbox(0.0225, 0.0006, 0.085, 0.0002, [0, RB - 0.0002, -0.163]), 0.12);
	B.add('steel', cbox(0.016, 0.0012, 0.068, 0.0005, [0, RB - 0.0006, -0.160]), 0.55);
	// pins, bolt release
	for (const s of [-1, 1]) for (const z of [-0.018, -0.114]) B.add('park', xf(screwHead(0.0026, 0.0006), [s * 0.0171, -0.028, z], [0, s > 0 ? 0 : PI, 0]));
	B.add('park', xf(cyl(0.0028, 0.012, 12, 0.001), [0.0176, -0.025, -0.183], [PI / 2, 0, 0]));
	B.add('park', cbox(0.003, 0.009, 0.016, 0.0012, [0.0178, -0.025, -0.183]));
	// top rail
	picRail(B, 'anod', -0.004, -0.205, { p: [0, RT, 0] });
	const RAILT = RT + RAIL_H;
	/* ---- trigger group + guard ---- */
	B.add('anod', loft([[-0.002, -0.0155, 0.0155, RB - 0.016, RB + 0.002, 0.002], [-0.122, -0.0155, 0.0155, RB - 0.012, RB + 0.002, 0.002]]));
	B.add('poly', extrude(rounded([[-0.1215, -0.049, 0.001], [-0.1125, -0.049, 0.001], [-0.1085, -0.078, 0.004], [-0.042, -0.078, 0.006], [-0.028, -0.061, 0.004], [-0.025, -0.049, 0.001], [-0.016, -0.049, 0.001], [-0.019, -0.063, 0.006], [-0.036, -0.087, 0.008], [-0.112, -0.087, 0.006], [-0.1215, -0.075, 0.004]], 0, 3), 0.0135, { bevel: 0.0018, bevelSegs: 2 }));
	B.add('park', xf(cyl(0.0034, 0.037, 14, 0.0008), [0, -0.0455, -0.030], [0, PI / 2, 0]));
	/* ---- pistol grip ---- */
	const ga = 18 * DEG;
	const gp = (u, v) => [0.012 + v * Math.cos(ga) + u * Math.sin(ga), -0.052 - u * Math.cos(ga) + v * Math.sin(ga)];
	const gF = [[-0.008, -0.021], [0.018, -0.0215], [0.034, -0.0235], [0.047, -0.0205], [0.062, -0.0225], [0.086, -0.0205], [0.104, -0.017, 0.007]];
	const gR = [[0.104, 0.0175, 0.007], [0.085, 0.0205], [0.045, 0.0215], [0.014, 0.0245], [-0.008, 0.026]];
	B.add('grip', extrude(rounded([...gF, ...gR].map(([u, v, r]) => [...gp(u, v), r ?? 0.002]), 0, 3), 0.031, { bevel: 0.0055, bevelSegs: 3, crease: 40 }));
	/* ---- buttstock ---- */
	const st = rounded([[0.0, 0.0215, 0.002], [0.289, 0.0175, 0.004], [0.289, -0.118, 0.006], [0.27, -0.1195, 0.008], [0.105, -0.061, 0.03], [0.045, -0.052, 0.006], [0.0, RB, 0.002]], 0, 4);
	B.add('poly', extrude(st, 0.036, { bevel: 0.0042, bevelSegs: 2, crease: 38 }));
	B.add('poly', extrude(rounded([[0.14, -0.035, 0.008], [0.255, -0.035, 0.008], [0.255, -0.085, 0.012], [0.20, -0.075, 0.02]], 0, 3), 0.0368, { bevel: 0.0004 }), 0.35);
	B.add('rubber', extrude(rounded([[0.085, 0.0155, 0.004], [0.255, 0.0120, 0.004], [0.255, 0.0215, 0.003], [0.085, 0.0245, 0.003]], 0, 2), 0.031, { bevel: 0.002, bevelSegs: 2 }));
	B.add('rubber', extrude(rounded([[0.287, 0.021, 0.004], [0.305, 0.021, 0.004], [0.305, -0.121, 0.006], [0.287, -0.121, 0.004]], 0, 3), 0.041, { bevel: 0.0035, bevelSegs: 2 }));
	B.add('park', xf(torus(0.0075, 0.0013, 6, 18), [0, -0.123, 0.262], [0, PI / 2, 0]));
	/* ---- barrel, magazine tube, clamp ---- */
	B.add('park', lathe([[0.0162, RF + 0.004], [0.0162, RF - 0.012], [0.0146, RF - 0.016], [0.0142, -0.32], [0.0122, -0.345], [0.0116, -0.7035], [0.0109, -0.705], [0.0094, -0.705], [0.0094, -0.690], [0, -0.690]], { segs: 28, shade: [1, 1, 1, 1, 1, 1, 1, 0.12, 0.06] }));
	B.add('park', xf(lathe([[0.0126, RF], [0.0126, -0.5835], [0.0135, -0.585], [0.0135, -0.6035], [0.0126, -0.6055], [0.004, -0.606], [0, -0.606]], { segs: 24 }), [0, -0.030, 0]));
	for (let i = 0; i < 6; i++) B.add('park', xf(tube(0.0137, 0.0128, 0.0012, 24), [0, -0.030, -0.5875 - i * 0.003]), 0.8);
	B.add('park', xf(torus(0.0068, 0.0014, 6, 16), [0, -0.030 - 0.0165, -0.595], [0, PI / 2, 0]));
	{
		const pts = [];
		for (const z of [-0.553, -0.568]) for (const [cy, r] of [[0, 0.0138], [-0.030, 0.0141]]) for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; pts.push([Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
		B.add('park', hull(pts));
		B.add('park', xf(screwHead(0.002, 0.0006), [0.0139, -0.015, -0.5605]));
	}
	/* ---- forend (U-channel around barrel) ---- */
	const fo = [[0.0135, 0.004], [0.0238, 0.004], [0.0246, -0.028, 0.004], [0.021, -0.0495, 0.012], [-0.021, -0.0495, 0.012], [-0.0246, -0.028, 0.004], [-0.0238, 0.004], [-0.0135, 0.004]];
	const foOut = rounded(fo, 0, 3);
	for (let i = 0; i <= 12; i++) { const a = PI + i / 12 * PI; foOut.push([Math.cos(a) * 0.0135, Math.sin(a) * 0.0135]); }
	B.add('poly', extrude(foOut, 0.226, { plane: 'xy', bevel: 0.003, bevelSegs: 2, pos: [0, 0, -0.353] }));
	B.add('poly', loft([[-0.465, -0.024, 0.024, -0.049, -0.006, 0.006], [-0.485, -0.019, 0.019, -0.045, -0.012, 0.007]]));
	for (const s of [-1, 1]) for (let i = 0; i < 4; i++) B.add('poly', cbox(0.0012, 0.0026, 0.17, 0.0004, [s * 0.0243, -0.008 - i * 0.0085, -0.352]), 0.4);
	/* ---- ghost ring sights ---- */
	B.add('anod', loft([[-0.006, -0.0118, 0.0118, RAILT - 0.006, RAILT + 0.0045, 0.0012], [-0.047, -0.0118, 0.0118, RAILT - 0.006, RAILT + 0.0045, 0.0012]]));
	for (const s of [-1, 1]) B.add('anod', prism([[-0.010, RAILT + 0.003], [-0.043, RAILT + 0.003], [-0.035, 0.0655], [-0.020, 0.0655]], s * 0.0082, s * 0.0122, 0.0007, 'zy'));
	B.add('anod', loft([[-0.0245, -0.0045, 0.0045, RAILT + 0.003, 0.046, 0.0008], [-0.0315, -0.0045, 0.0045, RAILT + 0.003, 0.046, 0.0008]]));
	B.add('anod', xf(lathe([[0.0032, 0.0028], [0.0068, 0.0028], [0.0072, 0.0015], [0.0072, -0.0015], [0.0068, -0.0028], [0.0032, -0.0028], [0.0032, 0.0028]], { segs: 24 }), [0, 0.052, -0.028]));
	B.add('park', xf(cyl(0.0022, 0.03, 10, 0.0005), [0, RAILT + 0.0005, -0.028], [0, PI / 2, 0]));
	B.add('park', loft([[-0.652, -0.0082, 0.0082, 0.006, 0.0158, 0.0015], [-0.679, -0.0082, 0.0082, 0.006, 0.0158, 0.0015]]));
	B.add('park', prism([[-0.656, 0.015], [-0.676, 0.015], [-0.6685, 0.0525], [-0.6635, 0.0525]], -0.0016, 0.0016, 0.0004, 'zy'));
	for (const s of [-1, 1]) B.add('park', prism([[-0.654, 0.012], [-0.678, 0.012], [-0.6705, 0.0565], [-0.6615, 0.0565]], s * 0.0062, s * 0.0092, 0.0006, 'zy'));
	B.add('tritium', xf(cyl(0.0011, 0.0006, 10), [0, 0.0488, -0.6632]));
	B.build(body, 'm4super90');

	/* ---- moving parts ---- */
	const parts = {};
	const bolt = grp('bolt', body, [0, 0, 0]);
	B.add('steel', lathe([[0.0118, -0.080], [0.0118, -0.1655], [0.0104, -0.1675], [0.0104, -0.1715], [0, -0.1715]], { segs: 24 }), 1.0);
	B.add('steel', cbox(0.003, 0.004, 0.02, 0.0006, [0.0112, 0.004, -0.160]), 0.7);
	B.add('steel', xf(cyl(0.0043, 0.03, 14, 0.0006), [0.026, 0.0, -0.158], [0, PI / 2, 0]));
	B.add('steel', xf(lathe([[0, 0.0095], [0.0055, 0.0095], [0.0078, 0.0078], [0.0081, 0.004], [0.0081, -0.0075], [0.0072, -0.0092], [0.0042, -0.0095], [0, -0.0095]], { segs: 20 }), [0.0455, 0.0, -0.158], [0, PI / 2, 0]));
	for (let i = 0; i < 4; i++) B.add('steel', xf(tube(0.0083, 0.0074, 0.0009, 20), [0.042 + i * 0.0026, 0, -0.158], [0, PI / 2, 0]), 0.5);
	B.build(bolt, 'm4s90bolt');
	parts.bolt = bolt;
	const trig = grp('trigger', body, [0, -0.046, -0.071]);
	B.add('park', extrude(rounded([[0.0045, 0.004, 0.001], [-0.004, 0.004, 0.001], [-0.0058, -0.011, 0], [-0.0085, -0.022, 0], [-0.0105, -0.0285, 0.001], [-0.0092, -0.031, 0.001], [-0.006, -0.0275, 0], [-0.0025, -0.018, 0], [0.0025, -0.006, 0]], 0, 2), 0.0068, { bevel: 0.001 }));
	B.build(trig, 'm4s90trigger');
	parts.trigger = trig;
	// loading port reference (shell insertion point) exposed as `pump`-free anchor
	const loadPort = empty('loadPort', body, [0, RB - 0.004, -0.150]);
	parts.loadPort = loadPort;

	const muzzle = empty('muzzle', body, [0, 0, -0.706]);
	const ejectPort = empty('ejectPort', body, [0.018, 0.0, -0.128]);
	const g0 = gp(0.006, 0);
	const rightHand = handTarget('rightHand', body, [0, g0[1], g0[0]], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.0155, rz: 0.022, curl: 1, trigger: true, thumb: 0.75 });
	const leftHand = handTarget('leftHand', body, [0, -0.022, -0.372], [0.3, 1, 0], [0, 0, -1], true, { rx: 0.028, rz: 0.026, curl: 0.85, thumb: 0.2 });
	const eye = new V3(0, 0.052, -0.028 + 0.10).add(body.position);
	const shellProto = shotshellModel(true);
	return finishWeapon({
		root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts,
		magazineModel: () => shellProto.clone(true), shellType: 'shotgun',
	});
}

/* ============================================================================
 * Accuracy International L96A1 "Black Magnum"
 * gun coords: bore y=0, rear of the action z=0 (bolt shroud behind)
 * ========================================================================== */
function l96MagInner() {
	const g = grp('l96MagModel');
	const B = new PB();
	B.add('park', loft([[0.0445, -0.0118, 0.0118, -0.022, 0.056, 0.0014], [-0.0445, -0.0118, 0.0118, -0.022, 0.056, 0.0014]]));
	for (const s of [-1, 1]) B.add('park', loft([[0.034, s > 0 ? 0.0112 : -0.0125, s > 0 ? 0.0125 : -0.0112, -0.012, 0.042, 0.0004], [-0.034, s > 0 ? 0.0112 : -0.0125, s > 0 ? 0.0125 : -0.0112, -0.012, 0.042, 0.0004]]), 0.8);
	B.add('park', cbox(0.0272, 0.0055, 0.0935, 0.0016, [0, -0.0245, 0]), 1.15);
	B.add('park', cbox(0.014, 0.004, 0.006, 0.001, [0, 0.030, -0.0462]));
	for (const s of [-1, 1]) { const x0 = s > 0 ? 0.0104 : -0.0123, x1 = s > 0 ? 0.0123 : -0.0104; B.add('park', loft([[0.036, x0, x1, 0.054, 0.0605, 0.0006], [-0.036, x0, x1, 0.054, 0.0605, 0.0006]])); }
	// two staggered .308 rounds
	for (const [x, y] of [[0.0045, 0.0605], [-0.0045, 0.0545]]) {
		const { caseG, bulletG } = cartridgeGeos(0.0512, 0.00598, 0.0043, 0.0395, 0.0285, 0.0039, { segs: 12, rim: 0.006 });
		xf(caseG, [x, y, 0.036]); xf(bulletG, [x, y, 0.036]);
		B.add('brass', caseG, TINT.brass); B.add('brass', bulletG, TINT.copper);
	}
	B.build(g, 'l96mag');
	return g;
}

function buildL96A1() {
	const root = grp('l96a1');
	const WEB = [0, -0.047, 0.034];
	const body = grp('body', root, [0, -WEB[1], -WEB[2]]);
	const B = new PB();
	const AR = 0.0185, AF = -0.215; // action radius / front
	/* ---- action with ejection port ---- */
	const wall = (z0, z1) => [[0.0105, z0], [AR, z0], [AR, z1], [0.0105, z1], [0.0105, z0]];
	B.add('park', lathe([[0.0105, -0.012], [AR - 0.0015, -0.012], [AR, -0.0135], [AR, -0.066], [0.0105, -0.066], [0.0105, -0.012]], { segs: 32 }));
	B.add('park', lathe(wall(-0.066, -0.146), { segs: 26, t0: 42 * DEG, t1: 342 * DEG }));
	B.add('park', lathe([[0.0105, -0.146], [AR, -0.146], [AR, AF + 0.002], [AR - 0.0015, AF], [0.012, AF], [0.0105, -0.146]], { segs: 32 }));
	B.add('park', loft([[-0.02, -0.0105, 0.0105, -0.026, -0.012, 0.001], [AF + 0.01, -0.0105, 0.0105, -0.026, -0.012, 0.001]])); // recoil lug / flat bottom
	B.add('park', cbox(0.0006, 0.013, 0.077, 0.0002, [0.0087, 0.004, -0.106]), 0.3);
	// scope base rail
	B.add('park', loft([[0.008, -0.0095, 0.0095, AR - 0.005, AR - 0.0005, 0.001], [AF + 0.01, -0.0095, 0.0095, AR - 0.005, AR - 0.0005, 0.001]]));
	picRail(B, 'anod', 0.008, AF + 0.01, { p: [0, AR - 0.0005, 0] });
	const RAILT = AR - 0.0005 + RAIL_H;
	/* ---- barrel + muzzle brake ---- */
	B.add('park', lathe([[0.0152, AF + 0.004], [0.0152, AF - 0.02], [0.0146, AF - 0.03], [0.0118, -0.785], [0.0112, -0.790], [0.0080, -0.790]], { segs: 28 }));
	{
		const bz = -0.790;
		B.add('park', lathe([[0.0080, bz], [0.0148, bz], [0.0156, bz - 0.001], [0.0156, bz - 0.010], [0.0085, bz - 0.010], [0.0080, bz]], { segs: 28 }));
		const ports = [[-0.010, -0.024], [-0.029, -0.043], [-0.048, -0.062]];
		ports.forEach(([a, b], i) => {
			for (const [t0, t1] of [[30, 150], [210, 330]]) B.add('park', lathe(wall(bz + a, bz + b).map(([r, z]) => [r === AR ? 0.0156 : 0.0086, z]), { segs: 10, t0: t0 * DEG, t1: t1 * DEG }));
			if (i < 2) B.add('park', lathe([[0.0086, bz + b], [0.0156, bz + b], [0.0156, bz + ports[i + 1][0]], [0.0086, bz + ports[i + 1][0]], [0.0086, bz + b]], { segs: 28 }));
			B.add('park', xf(lathe([[0.0086, 0], [0.0058, 0], [0.0058, -0.0015], [0.0086, -0.0015], [0.0086, 0]], { segs: 20, shade: [0.4, 0.4, 0.4, 0.4] }), [0, 0, bz + b]));
		});
		B.add('park', lathe([[0.0086, bz - 0.062], [0.0156, bz - 0.062], [0.0156, bz - 0.0735], [0.0146, bz - 0.075], [0.0070, bz - 0.075], [0.0070, bz - 0.068], [0.0086, bz - 0.062]], { segs: 28, shade: [1, 1, 1, 1, 0.5, 0.3] }));
		B.add('park', xf(cyl(0.0086, 0.07, 16), [0, 0, bz - 0.036]), 0.12); // dark core seen through ports
	}
	/* ---- stock body (thumbhole), grip, forend, guard ---- */
	const stock = rounded([
		[AF - 0.002, -0.004, 0.002], [AF - 0.002, -0.070, 0.002], [-0.118, -0.070, 0.002], [-0.030, -0.066, 0.004], [0.036, -0.047, 0.006],
		[0.052, -0.040, 0.008], [0.135, -0.034, 0.012], [0.160, -0.046, 0.012], [0.170, -0.098, 0.012], [0.205, -0.110, 0.012],
		[0.29, -0.124, 0.005], [0.29, 0.031, 0.005], [0.20, 0.031, 0.02], [0.155, 0.022, 0.03], [0.105, -0.012, 0.02], [0.055, -0.0155, 0.01], [0.012, -0.004, 0.004],
	], 0, 4);
	B.add('poly', extrude(stock, 0.048, { bevel: 0.0055, bevelSegs: 2, crease: 38 }));
	const grip = rounded([
		[-0.026, -0.060, 0.004], [-0.014, -0.098, 0.01], [-0.006, -0.150, 0.01], [0.042, -0.156, 0.012], [0.072, -0.141, 0.02], [0.20, -0.124, 0.01],
		[0.205, -0.104, 0.008], [0.08, -0.119, 0.012], [0.052, -0.109, 0.01], [0.040, -0.062, 0.008], [0.036, -0.046, 0.004],
	], 0, 4);
	B.add('poly', extrude(grip, 0.034, { bevel: 0.0065, bevelSegs: 3, crease: 38 }));
	B.add('poly', extrude(rounded([[-0.116, -0.066, 0.002], [-0.112, -0.093, 0.006], [-0.099, -0.1015, 0.008], [-0.036, -0.1015, 0.008], [-0.021, -0.088, 0.006], [-0.018, -0.066, 0.002], [-0.027, -0.066, 0.002], [-0.033, -0.089, 0.005], [-0.098, -0.091, 0.005], [-0.104, -0.066, 0.002]], 0, 3), 0.016, { bevel: 0.002, bevelSegs: 2 }));
	B.add('poly', extrude(rounded([[AF + 0.004, -0.004, 0.003], [-0.528, -0.004, 0.006], [-0.546, -0.016, 0.012], [-0.546, -0.050, 0.012], [-0.528, -0.0625, 0.012], [AF + 0.004, -0.0685, 0.003]], 0, 4), 0.060, { bevel: 0.007, bevelSegs: 3, crease: 38 }));
	for (const s of [-1, 1]) for (let i = 0; i < 5; i++) B.add('poly', cbox(0.0008, 0.0085, 0.034, 0.0003, [s * 0.0302, -0.031, -0.265 - i * 0.052]), 0.18);
	// magwell mouth
	B.add('poly', cbox(0.0262, 0.0006, 0.0915, 0.0001, [0, -0.0704, -0.1665]), 0.1);
	// cheekpiece + adjuster posts
	B.add('poly', extrude(rounded([[0.165, 0.0345, 0.006], [0.262, 0.0345, 0.006], [0.262, 0.045, 0.006], [0.18, 0.046, 0.01]], 0, 3), 0.042, { bevel: 0.005, bevelSegs: 2 }), 1.05);
	for (const z of [0.19, 0.245]) B.add('park', xf(cyl(0.0042, 0.012, 14, 0.0006), [0, 0.030, z], [PI / 2, 0, 0]), 1.6);
	for (const g of knurledKnob(0.009, 0.006, 18)) B.add('park', xf(g, [-0.0265, 0.030, 0.218], [0, PI / 2, 0]));
	// butt spacers + pad
	B.add('anod', extrude(rounded([[0.2885, 0.031, 0.005], [0.2945, 0.031, 0.005], [0.2945, -0.124, 0.005], [0.2885, -0.124, 0.005]], 0, 2), 0.049, { bevel: 0.0015 }));
	B.add('rubber', extrude(rounded([[0.2945, 0.031, 0.006], [0.309, 0.031, 0.006], [0.309, -0.124, 0.008], [0.2945, -0.124, 0.006]], 0, 3), 0.051, { bevel: 0.004, bevelSegs: 2 }));
	// chassis bolts, swivels, mag release
	for (const s of [-1, 1]) for (const [z, y] of [[-0.195, -0.030], [-0.135, -0.040], [-0.035, -0.040], [0.022, -0.014]]) B.add('park', xf(screwHead(0.0034, 0.0012), [s * 0.024, y, z], [0, s > 0 ? 0 : PI, 0]));
	B.add('park', xf(torus(0.008, 0.0015, 6, 18), [0, -0.075, -0.505], [0, PI / 2, 0]));
	B.add('park', loft([[-0.495, -0.006, 0.006, -0.068, -0.062, 0.001], [-0.515, -0.006, 0.006, -0.068, -0.062, 0.001]]));
	B.add('park', xf(torus(0.008, 0.0015, 6, 18), [0, -0.131, 0.255], [0, PI / 2, 0]));
	B.add('park', loft([[-0.117, -0.006, 0.006, -0.082, -0.068, 0.001], [-0.124, -0.006, 0.006, -0.08, -0.068, 0.001]]));
	/* ---- folded bipod ---- */
	B.add('park', loft([[-0.47, -0.014, 0.014, -0.074, -0.062, 0.002], [-0.505, -0.014, 0.014, -0.074, -0.062, 0.002]]));
	for (const s of [-1, 1]) {
		B.add('park', xf(cyl(0.0048, 0.19, 12, 0.001), [s * 0.0105, -0.0785, -0.585]));
		B.add('park', xf(cyl(0.0038, 0.07, 12, 0.001), [s * 0.0105, -0.0785, -0.700]), 1.4);
		B.add('rubber', xf(lathe([[0, 0], [0.0068, -0.002], [0.0072, -0.012], [0.0045, -0.018], [0, -0.018]], { segs: 12 }), [s * 0.0105, -0.0785, -0.733]));
	}
	/* ---- scope (6x42) ---- */
	const SY = 0.062;
	const scopeProf = [
		[0.0158, 0.0855], [0.0170, 0.0885], [0.0205, 0.0900], [0.0213, 0.0885], [0.0213, 0.079], [0.0222, 0.078], [0.0222, 0.064], [0.0213, 0.063], [0.0213, 0.052],
		[0.0195, 0.047], [0.0160, 0.036], [0.0152, 0.032], [0.0152, -0.048], [0.0185, -0.051], [0.0192, -0.054], [0.0192, -0.097], [0.0185, -0.100], [0.0152, -0.103],
		[0.0152, -0.150], [0.0175, -0.162], [0.0232, -0.185], [0.0256, -0.192], [0.0256, -0.2435], [0.0246, -0.2455], [0.0236, -0.2455], [0.0236, -0.2405], [0.0226, -0.2385],
	];
	B.add('anod', xf(lathe(scopeProf, { segs: 40 }), [0, SY, 0]));
	for (let i = 0; i < 9; i++) B.add('anod', xf(tube(0.0226, 0.0218, 0.0008, 40), [0, SY, 0.0655 + i * 0.0015]), 0.7);
	// turrets
	const turret = (h) => {
		const out = [lathe([[0, 0], [0.0125, 0], [0.0125, -h * 0.55], [0.0132, -h * 0.58], [0.0132, -h], [0.012, -h - 0.0012], [0, -h - 0.0012]], { segs: 28 })];
		for (let i = 0; i < 24; i++) { const a = i / 24 * TAU; out.push(xf(cbox(0.0012, 0.0012, h * 0.38, 0.0002), [Math.cos(a) * 0.0133, Math.sin(a) * 0.0133, -h * 0.79], [0, 0, a])); }
		return out;
	};
	for (const g of turret(0.022)) B.add('anod', xf(g, [0, SY + 0.016, -0.075], [PI / 2, 0, 0]));
	for (const g of turret(0.019)) B.add('anod', xf(g, [0.016, SY, -0.075], [0, -PI / 2, 0]));
	B.add('anod', xf(cyl(0.0105, 0.012, 20, 0.001), [-0.018, SY, -0.075], [0, PI / 2, 0]));
	B.add('anod', cbox(0.0012, 0.0006, 0.005, 0.0001, [0, SY + 0.0385, -0.0685]), 6);
	// rings + bases
	for (const z of [-0.004, -0.126]) {
		B.add('anod', xf(lathe([[0.0152, 0.0065], [0.0182, 0.0065], [0.0188, 0.0055], [0.0188, -0.0055], [0.0182, -0.0065], [0.0152, -0.0065]], { segs: 32 }), [0, SY, z]));
		B.add('anod', loft([[z + 0.0065, -0.011, 0.011, RAILT - 0.005, SY - 0.012, 0.0015], [z - 0.0065, -0.011, 0.011, RAILT - 0.005, SY - 0.012, 0.0015]]));
		B.add('park', xf(cyl(0.0042, 0.007, 6, 0.0006), [0.0142, RAILT - 0.0015, z], [0, PI / 2, 0]));
		for (const s of [-1, 1]) B.add('park', xf(screwHead(0.0018, 0.0006), [0, SY + 0.0182, z + s * 0.004], [0, 0, PI / 2]));
	}
	// lenses
	B.add('glass', xf(lathe([[0, -0.2380], [0.0226, -0.2385], [0.0226, -0.2400], [0, -0.2392]], { segs: 32 }), [0, SY, 0]));
	B.add('glass', xf(lathe([[0, 0.0862], [0.0159, 0.0855], [0.0159, 0.0845], [0, 0.0849]], { segs: 28 }), [0, SY, 0]));
	B.build(body, 'l96a1');

	/* ---- moving parts ---- */
	const parts = {};
	// bolt: slides back (+Z) ~0.105 after the handle is lifted
	const bolt = grp('bolt', body, [0, 0, 0]);
	B.add('steel', lathe([[0.0100, 0.012], [0.0100, -0.160], [0.0092, -0.163], [0, -0.163]], { segs: 22 }), 0.85);
	for (const a of [0, PI]) B.add('steel', xf(cbox(0.004, 0.0035, 0.018, 0.0008), [0, 0, -0.152], [0, 0, a + PI / 2]).translate(0, 0, 0), 0.8);
	B.add('steel', lathe([[0.0, 0.052], [0.0105, 0.052], [0.0135, 0.049], [0.0145, 0.042], [0.0145, 0.012], [0.0165, 0.010], [0.0165, 0.004], [0.0105, 0.002], [0.0105, -0.004]], { segs: 28 }), 0.22);
	B.add('steel', xf(cyl(0.0022, 0.006, 10), [0, 0, 0.0545]), 0.5);
	B.build(bolt, 'l96bolt');
	parts.bolt = bolt;
	// bolt handle (child of bolt): pivots on the bore axis; lift = rotation.z +PI/2
	const bh = grp('boltHandle', bolt, [0, 0, -0.012]);
	const hDir = new V3(Math.cos(-32 * DEG), Math.sin(-32 * DEG), 0.12).normalize();
	B.add('park', lathe([[0.0116, 0.008], [0.0116, -0.008], [0.0, -0.008]], { segs: 22 }));
	{
		const tip = hDir.clone().multiplyScalar(0.050);
		B.add('park', sweep([[0.008, 0, 0], [hDir.x * 0.026, hDir.y * 0.026, hDir.z * 0.026 + 0.002], [tip.x, tip.y, tip.z]], circlePts(0, 0, 0.0038, 10), { segs: 10 }));
		const knob = sphere(0.0105, 18, 12); knob.scale(1, 1, 1.05);
		B.add('park', xf(knob, [tip.x + hDir.x * 0.008, tip.y + hDir.y * 0.008, tip.z]), 0.9);
	}
	B.build(bh, 'l96handle');
	parts.boltHandle = bh;
	const trig = grp('trigger', body, [0, -0.058, -0.062]);
	B.add('park', extrude(rounded([[0.0045, 0.004, 0.001], [-0.004, 0.004, 0.001], [-0.0056, -0.010, 0], [-0.0082, -0.020, 0], [-0.0098, -0.0265, 0.001], [-0.0086, -0.0288, 0.001], [-0.0056, -0.0258, 0], [-0.0022, -0.017, 0], [0.0025, -0.006, 0]], 0, 2), 0.0065, { bevel: 0.001 }));
	B.build(trig, 'l96trigger');
	parts.trigger = trig;
	const mag = grp('mag', body, [0, -0.0705, -0.1665]);
	const magProto = l96MagInner();
	magProto.position.y = -0.0005;
	mag.add(magProto);
	parts.mag = mag;

	const muzzle = empty('muzzle', body, [0, 0, -0.866]);
	const ejectPort = empty('ejectPort', body, [0.02, 0.004, -0.106]);
	const ga = 8 * DEG;
	const rightHand = handTarget('rightHand', body, [0, -0.052, 0.013], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.0175, rz: 0.023, curl: 1, trigger: true, thumb: 0.8 });
	const leftHand = handTarget('leftHand', body, [0, -0.033, -0.40], [0.25, 1, 0], [0, 0, -1], true, { rx: 0.030, rz: 0.030, curl: 0.72, thumb: 0.2 });
	const eye = new V3(0, SY, 0.090 + 0.022).add(body.position);
	return finishWeapon({
		root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts,
		magazineModel: () => { const m = magProto.clone(true); m.position.set(0, 0, 0); return m; }, shellType: 'sniper',
	});
}

/* ============================================================================
 * Beretta M9 (92FS)
 * gun coords: bore y=0, slide rear face z=0
 * ========================================================================== */
const M9_RAKE = 17 * DEG;
function m9MagInner() {
	// local frame: origin at the magwell mouth, magazine axis = local -Y (grip rake applied by parent)
	const g = grp('m9MagModel');
	const B = new PB();
	B.add('blued', loft([[0.0165, -0.0098, 0.0098, 0.004, 0.104, 0.0035], [-0.0165, -0.0098, 0.0098, 0.004, 0.104, 0.0035]]));
	B.add('blued', cbox(0.0205, 0.004, 0.012, 0.0012, [0, 0.100, 0.0115]), 0.9);
	for (let i = 0; i < 3; i++) B.add('blued', xf(cyl(0.0014, 0.0008, 10), [0.0099, 0.03 + i * 0.02, 0.008], [0, PI / 2, 0]), 0.2);
	B.add('poly', extrude(rounded([[0.0185, -0.0045, 0.002], [-0.0175, -0.0045, 0.004], [-0.0185, 0.0045, 0.002], [0.0185, 0.0045, 0.002]], 0, 3), 0.0225, { bevel: 0.0014, bevelSegs: 2 }));
	const { caseG, bulletG } = cartridgeGeos(0.0192, 0.00493, 0.00482, null, 0.0152, 0.00452, { segs: 12, rim: 0.00496 });
	xf(caseG, [0, 0.1085, 0.0125]); xf(bulletG, [0, 0.1085, 0.0125]);
	B.add('brass', caseG, TINT.brass); B.add('brass', bulletG, TINT.copper);
	B.build(g, 'm9mag');
	return g;
}

function buildM9() {
	const root = grp('m9');
	const WEB = [0, -0.0255, 0.0115];
	const body = grp('body', root, [0, -WEB[1], -WEB[2]]);
	const B = new PB();
	/* ---- frame ---- */
	const fr = rounded([
		[0.013, -0.0085, 0.001], [-0.184, -0.0085, 0.002], [-0.1875, -0.0125, 0.003], [-0.181, -0.0205, 0.003], [-0.104, -0.0205, 0.002],
		[-0.099, -0.026, 0.004], [-0.097, -0.043, 0.008], [-0.088, -0.0545, 0.01], [-0.060, -0.058, 0.01], [-0.041, -0.052, 0.008], [-0.031, -0.041, 0.003],
		[-0.0215, -0.086, 0.006], [-0.0105, -0.1175, 0.004], [0.0240, -0.1185, 0.004], [0.0262, -0.111, 0.004], [0.0145, -0.060, 0.004], [0.0095, -0.034, 0.005], [0.0165, -0.020, 0.004], [0.0185, -0.0125, 0.002],
	], 0, 3);
	B.add('anod', extrude(fr, 0.0292, { bevel: 0.0014, bevelSegs: 2, holes: [rounded([[-0.0925, -0.0245, 0.004], [-0.0915, -0.041, 0.006], [-0.083, -0.049, 0.007], [-0.061, -0.0515, 0.007], [-0.045, -0.047, 0.006], [-0.0365, -0.038, 0.003], [-0.036, -0.0245, 0.002]], 0, 3)] }));
	// grip panels (checkered)
	const gp = rounded([[-0.0265, -0.041, 0.004], [-0.0185, -0.086, 0.008], [-0.0095, -0.1145, 0.004], [0.0222, -0.1155, 0.004], [0.0232, -0.1095, 0.004], [0.0118, -0.060, 0.006], [0.0062, -0.0355, 0.005], [-0.012, -0.030, 0.006]], 0, 3);
	B.add('grip', extrude(gp, 0.0375, { bevel: 0.003, bevelSegs: 3, crease: 40 }));
	for (const s of [-1, 1]) B.add('park', xf(screwHead(0.0024, 0.0006), [s * 0.0188, -0.052, -0.004], [0, s > 0 ? 0 : PI, 0]));
	// takedown lever, slide stop (left), mag release (left, behind guard), lanyard loop
	B.add('park', loft([[-0.069, -0.0158, -0.0142, -0.0165, -0.0095, 0.0006], [-0.083, -0.0158, -0.0142, -0.0165, -0.0095, 0.0006]]));
	B.add('park', xf(cyl(0.0032, 0.0022, 14, 0.0006), [-0.0156, -0.013, -0.076], [0, PI / 2, 0]));
	B.add('park', loft([[-0.045, -0.0162, -0.0142, -0.0135, -0.0092, 0.0006], [-0.064, -0.0158, -0.0142, -0.0125, -0.0095, 0.0006]]));
	B.add('park', loft([[-0.028, -0.0162, 0.0162, -0.046, -0.038, 0.0012], [-0.034, -0.0162, 0.0162, -0.046, -0.038, 0.0012]]));
	B.add('park', xf(torus(0.0042, 0.0011, 6, 14), [0, -0.121, 0.0225], [0, PI / 2, 0]));
	// magwell mouth
	B.add('anod', xf(cbox(0.0205, 0.0006, 0.034, 0.0001), [0, -0.1188, 0.0072], [-M9_RAKE, 0, 0]), 0.12);
	/* ---- barrel (exposed through open slide) ---- */
	B.add('blued', lathe([[0.0068, -0.084], [0.0068, -0.1975], [0.0062, -0.1985], [0.0045, -0.1985], [0.0045, -0.19], [0, -0.19]], { segs: 24, shade: [1, 1, 1, 0.1, 0.05] }));
	B.add('blued', loft([[-0.056, -0.0072, 0.0072, -0.006, 0.0090, 0.0012], [-0.086, -0.0072, 0.0072, -0.006, 0.0090, 0.0012]]));
	/* ---- hammer ---- */
	B.add('park', extrude(rounded([[0.0045, -0.0045, 0.002], [0.0125, -0.0035, 0.002], [0.0195, 0.0035, 0.002], [0.0185, 0.0075, 0.002], [0.0125, 0.0035, 0.002], [0.0035, 0.0012, 0.002], [0.0005, -0.004, 0.002], [0.002, -0.014, 0.003], [0.009, -0.0145, 0.003]], 0, 2), 0.0078, { bevel: 0.0008 }));
	B.add('park', xf(screwHead(0.0025, 0.0005), [0.0147, -0.0095, 0.0055]));
	B.build(body, 'm9');

	const parts = {};
	/* ---- slide (recoils +Z ~0.045) ---- */
	const slide = grp('slide', body, [0, 0, 0]);
	const sl = rounded([[0.0, 0.0138, 0.002], [-0.073, 0.0138, 0.004], [-0.081, 0.0008, 0.004], [-0.1685, 0.0008, 0.004], [-0.1745, 0.0105, 0.004], [-0.1985, 0.0105, 0.004], [-0.1985, -0.0085, 0.002], [-0.001, -0.0085, 0.001], [0.0022, 0.004, 0.002]], 0, 3);
	B.add('park', extrude(sl, 0.0255, { bevel: 0.0016, bevelSegs: 2, crease: 35 }));
	// nose ring around barrel + bore opening
	B.add('park', lathe([[0.0105, -0.1988], [0.0071, -0.1988], [0.0071, -0.170]], { segs: 24, shade: [1, 0.5], orient: 'keep' }));
	// rear serrations
	for (const s of [-1, 1]) for (let i = 0; i < 9; i++) B.add('park', cbox(0.0008, 0.016, 0.0012, 0.0002, [s * 0.0124, 0.0005, -0.009 - i * 0.0029]), 0.45);
	// safety / decocker levers
	for (const s of [-1, 1]) B.add('park', hull([[s * 0.0125, 0.0035, -0.004], [s * 0.0125, 0.0035, -0.021], [s * 0.0158, 0.0045, -0.006], [s * 0.0158, 0.0045, -0.019], [s * 0.0125, 0.0105, -0.005], [s * 0.0158, 0.0098, -0.008], [s * 0.0125, 0.0105, -0.016], [s * 0.0158, 0.0098, -0.015]]), 1.2);
	// extractor (right)
	B.add('park', cbox(0.0012, 0.0035, 0.016, 0.0004, [0.0128, 0.0085, -0.052]), 1.2);
	// sights (3-dot)
	B.add('park', loft([[-0.004, -0.0062, 0.0062, 0.0128, 0.0165, 0.0008], [-0.0125, -0.0062, 0.0062, 0.0128, 0.0165, 0.0008]]));
	for (const s of [-1, 1]) B.add('park', loft([[-0.004, s > 0 ? 0.0015 : -0.0062, s > 0 ? 0.0062 : -0.0015, 0.016, 0.0198, 0.0006], [-0.0125, s > 0 ? 0.0015 : -0.0062, s > 0 ? 0.0062 : -0.0015, 0.016, 0.0198, 0.0006]]));
	B.add('park', prism([[-0.187, 0.0095], [-0.1965, 0.0095], [-0.1955, 0.0192], [-0.1905, 0.0192]], -0.0014, 0.0014, 0.0004, 'zy'));
	for (const s of [-1, 1]) B.add('white', xf(cyl(0.00085, 0.0004, 10), [s * 0.0038, 0.0178, -0.0038]));
	B.add('white', xf(cyl(0.00085, 0.0004, 10), [0, 0.0170, -0.1893]));
	B.build(slide, 'm9slide');
	parts.slide = slide;
	/* ---- trigger ---- */
	const trig = grp('trigger', body, [0, -0.021, -0.071]);
	B.add('park', extrude(rounded([[0.0035, 0.003, 0.001], [-0.0035, 0.003, 0.001], [-0.0035, -0.008, 0], [-0.0065, -0.018, 0], [-0.0078, -0.0245, 0.001], [-0.0064, -0.0268, 0.001], [-0.0035, -0.0232, 0], [-0.0005, -0.0145, 0], [0.0025, -0.005, 0]], 0, 2), 0.0062, { bevel: 0.0009 }));
	B.build(trig, 'm9trigger');
	parts.trigger = trig;
	/* ---- magazine: pivot at magwell, axis along local -Y (raked) ---- */
	const mag = grp('mag', body, [0, -0.1185, 0.0072]);
	mag.rotation.x = -M9_RAKE;
	const magProto = m9MagInner();
	mag.add(magProto);
	parts.mag = mag;

	const muzzle = empty('muzzle', body, [0, 0, -0.199]);
	const ejectPort = empty('ejectPort', body, [0.011, 0.009, -0.092]);
	const idx = [0, Math.cos(M9_RAKE), -Math.sin(M9_RAKE)];
	const rightHand = handTarget('rightHand', body, [0, -0.034, -0.0085], [-1, 0, 0], idx, false, { rx: 0.0185, rz: 0.021, curl: 1, trigger: true, thumb: 0.55 });
	const leftHand = handTarget('leftHand', body, [-0.004, -0.058, -0.004], [1, 0, 0.12], idx, true, { rx: 0.031, rz: 0.035, curl: 0.95, thumb: 0.3, gy: 0.03 });
	const eye = new V3(0, 0.0178, -0.008 + 0.10).add(body.position);
	return finishWeapon({
		root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts,
		magazineModel: () => magProto.clone(true), shellType: 'pistol',
	});
}

/* ============================================================================
 * Combat knife (Ka-Bar style) - blade points forward/up out of the fist
 * knife space: guard at z=0, blade toward -Z, spine +Y, edge -Y
 * ========================================================================== */
function buildKnife() {
	const root = grp('knife');
	const B = new PB();
	// hand + knife orientation (natural first-person hold: blade forward-up, slightly left)
	const d = new V3(-0.14, 0.78, -0.61).normalize();
	const KPALM = [-1, -0.35, 0.1];
	const hq = handQuat(KPALM, d.toArray(), false);
	const Xh = new V3(1, 0, 0).applyQuaternion(hq), Yh = new V3(0, 1, 0).applyQuaternion(hq), Zh = new V3(0, 0, 1).applyQuaternion(hq);
	const km = new THREE.Matrix4().makeBasis(Xh, Zh, Yh.clone().negate());
	const knife = grp('knifeBody', root);
	knife.quaternion.setFromRotationMatrix(km);
	knife.position.copy(new V3(0, 0, 0.016).applyQuaternion(knife.quaternion).negate());
	/* ---- handle (stacked leather washers), guard, pommel ---- */
	const hp = [[0.0, 0.0048]];
	for (let i = 0; i <= 17; i++) {
		const z = 0.0055 + i * 0.0062, t = i / 17, r = 0.0118 + 0.0016 * Math.sin(PI * t);
		hp.push([r - 0.0006, z + 0.0004], [r, z + 0.0013], [r, z + 0.0048], [r - 0.0006, z + 0.0058]);
	}
	hp.push([0.0, 0.1125]);
	const handle = lathe(hp.map(([r, z]) => [r, z]).reverse().map(([r, z]) => [r, z]), { segs: 24, crease: 50 });
	handle.scale(0.8, 1, 1);
	B.add('leather', handle);
	B.add('park', extrude(rounded([[-0.0088, -0.034, 0.008], [0.0088, -0.034, 0.008], [0.0088, 0.030, 0.008], [-0.0088, 0.030, 0.008]], 0, 4), 0.0052, { plane: 'xy', bevel: 0.0012, pos: [0, -0.002, 0.0026] }));
	const pom = lathe([[0, 0.127], [0.0055, 0.1268], [0.0105, 0.1245], [0.0132, 0.120], [0.0136, 0.1155], [0.0128, 0.1125], [0.0, 0.1125]], { segs: 24 });
	pom.scale(0.82, 1, 1);
	B.add('park', pom);
	B.build(knife, 'knife');
	/* ---- blade (parts.blade) ---- */
	const blade = grp('blade', knife);
	const spineY = 0.0115, gY = -0.0105; // spine height / grind line
	const tipY = 0.0012;
	const spineAt = (t) => (t < 0.663 ? spineY : spineY - (t - 0.663) / 0.337 * (spineY - tipY));
	const edgeAt = (t) => -0.0195 - 0.0045 * Math.sin(PI * Math.min(1, t * 1.15)) + (tipY + 0.0195) * Math.pow(Math.max(0, t - 0.62) / 0.38, 1.8);
	const N = 28, T = 0.0021, TE = 0.00035;
	const up = [], grind = [], edge = [];
	for (let i = 0; i <= N; i++) {
		const t = i / N, z = -0.178 * t;
		const s = spineAt(t), e = Math.min(edgeAt(t), s);
		const g = Math.min(s - 0.0012 * (1 - t), Math.max(e + 0.004 * (1 - t), gY + 0.004 * t));
		up.push([z, s]); grind.push([z, g]); edge.push([z, e]);
	}
	// flat body: spine -> grind line (extrusion)
	const bodyOut = [...up.map(p => [p[0], p[1]]), ...grind.slice(0, N).reverse().map(p => [p[0], p[1]])];
	B.add('blade', extrude(bodyOut, 2 * T, { bevel: 0.0005, crease: 30 }));
	// edge bevel (bright ground steel) from grind line down to edge
	{
		const A = new Acc();
		for (let i = 0; i < N; i++) {
			const g0 = grind[i], g1 = grind[i + 1], e0 = edge[i], e1 = edge[i + 1];
			for (const sx of [-1, 1]) {
				const a = [sx * T, g0[1], g0[0]], b = [sx * T, g1[1], g1[0]], c = [sx * TE, e1[1], e1[0]], dd = [sx * TE, e0[1], e0[0]];
				A.oquad(a, b, c, dd, [sx, -0.3, 0], 0.4, 1);
			}
			A.oquad([-TE, e0[1], e0[0]], [TE, e0[1], e0[0]], [TE, e1[1], e1[0]], [-TE, e1[1], e1[0]], [0, -1, 0], 1, 1);
		}
		A.oquad([-T, grind[0][1], 0], [T, grind[0][1], 0], [TE, edge[0][1], 0], [-TE, edge[0][1], 0], [0, 0, 1], 0, 1);
		B.add('edge', A.geo(25));
	}
	// fuller (blood groove) both sides + clip swedge highlight
	for (const sx of [-1, 1]) {
		B.add('blade', xf(prism([[-0.012, 0.0055], [-0.105, 0.0055], [-0.107, 0.0028], [-0.012, 0.0022]], sx * T - 0.00005, sx * (T + 0.00012), 0.0001, 'zy')), 0.45);
		B.add('edge', hull([[sx * 0.0004, spineY - 0.0002, -0.118], [sx * 0.0004, 0.0012, -0.178], [sx * T * 0.9, spineY - 0.0022, -0.118], [sx * 0.0008, 0.0016, -0.17], [0, spineY, -0.118], [0, 0.0014, -0.177]]), 0.8);
	}
	B.build(blade, 'knifeBlade');
	const muzzle = empty('muzzle', knife, [0, 0.001, -0.178]);
	const rightHand = handTarget('rightHand', root, [0, 0, 0], KPALM, d.toArray(), false, { rx: 0.0105, rz: 0.0135, curl: 1.05, thumb: 0.95, gy: 0.024 });
	const eye = new V3(0, 0.07, 0.12);
	return finishWeapon({ root, muzzle, ejectPort: null, rightHand, leftHand: null, sight: { eye }, parts: { blade }, shellType: null });
}

/* ============================================================================
 * M67 fragmentation grenade (fuze up, spoon on the palm side +X, ring on -X)
 * ========================================================================== */
function m67Body(B) {
	// sphere body (2.5") with threaded neck, yellow band
	const prof = [];
	for (let i = 0; i <= 16; i++) { const a = -PI / 2 + i / 16 * PI * 0.9; prof.push([Math.cos(a) * 0.0318, Math.sin(a) * 0.0318]); }
	prof[0][0] = 0;
	const top = prof[prof.length - 1];
	prof.push([0.0096, top[1] + 0.0008], [0.0096, 0.0325]);
	const g = lathe(prof, { segs: 32, crease: 45 });
	xf(g, null, [-PI / 2, 0, 0]);
	B.add('od', g);
	B.add('yellow', xf(tube(0.0297, 0.0286, 0.0024, 32), [0, 0.0122, 0], [PI / 2, 0, 0]));
	// fuze (M213)
	B.add('zinc', xf(lathe([[0.0098, 0.0325], [0.0101, 0.0335], [0.0101, 0.0395], [0.0085, 0.041], [0.0085, 0.0475], [0.0078, 0.0482], [0.0, 0.0482]], { segs: 24 }), null, [-PI / 2, 0, 0]));
	B.add('zinc', cbox(0.012, 0.0085, 0.008, 0.0008, [0.0062, 0.0445, 0]));
	for (let i = 0; i < 10; i++) { const a = i / 10 * TAU; B.add('zinc', xf(cbox(0.0014, 0.005, 0.0012, 0.0002), [Math.cos(a) * 0.0102, 0.0365, Math.sin(a) * 0.0102], [0, -a, 0]), 0.8); }
}
function buildM67() {
	const root = grp('m67');
	const C = [0, -0.028, -0.030]; // grenade centre in root space
	const body = grp('body', root, C);
	const B = new PB();
	m67Body(B);
	B.build(body, 'm67');
	// spoon: hinged at fuze head (+X side), swings out around Z
	const spoon = grp('spoon', body, [0.0112, 0.0462, 0]);
	{
		const bp = [[0.0112, 0.0462], [0.0152, 0.0405], [0.0182, 0.0345]];
		for (const a of [52, 30, 8, -14, -32]) bp.push([0.0347 * Math.cos(a * DEG), 0.0347 * Math.sin(a * DEG)]);
		const path = new THREE.CatmullRomCurve3(bp.map(p => new V3(p[0] - 0.0112, p[1] - 0.0462, 0)));
		B.add('od', sweep(path, [[-0.0007, -0.0062], [0.0007, -0.0062], [0.0007, 0.0062], [-0.0007, 0.0062]], { segs: 22, crease: 40 }), 1.05);
		B.add('od', cbox(0.0062, 0.0015, 0.0142, 0.0004, [-0.0026, 0.0006, 0]), 1.05);
	}
	B.build(spoon, 'm67spoon');
	// safety pin + pull ring (pull out along -X)
	const pin = grp('pin', body, [0.0, 0.0438, 0.0]);
	B.add('steel', xf(cyl(0.0009, 0.028, 8), [0.003, 0, 0], [0, PI / 2, 0]));
	B.add('steel', xf(torus(0.0035, 0.0009, 6, 14), [-0.0125, 0, 0.0], [0, 0, 0]));
	B.add('steel', xf(torus(0.0118, 0.0011, 6, 28), [-0.0235, -0.0095, 0.0015], [0, 0.35, 0.5]));
	B.build(pin, 'm67pin');
	const muzzle = empty('muzzle', body, [0, 0, 0]);
	const ga = 12 * DEG;
	const rightHand = handTarget('rightHand', body, [0.0, 0.010, 0.0], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.030, rz: 0.030, curl: 0.72, thumb: 0.55, gy: 0.022 });
	const eye = new V3(0, 0.06, 0.1);
	const proto = grp('m67Model');
	{ const B2 = new PB(); m67Body(B2); B2.build(proto, 'm67model'); }
	return finishWeapon({
		root, muzzle, ejectPort: null, rightHand, leftHand: null, sight: { eye }, parts: { spoon, pin },
		magazineModel: () => proto.clone(true), shellType: null,
	});
}

/* ============================================================================
 * 40mm grenade round (M433 HEDP) along -Z, case head at z=0
 * ========================================================================== */
function grenade40Geos(withCase = true) {
	const out = { alu: [], od: [], yellow: [], brass: [] };
	if (withCase) {
		out.alu.push(lathe([[0, 0.0], [0.0215, 0.0], [0.0221, -0.0006], [0.0221, -0.0030], [0.0205, -0.0040], [0.0205, -0.0435], [0.0198, -0.0445], [0.0, -0.0445]], { segs: 32, shade: [0.7, 1, 1, 1, 1, 1, 1] }));
		out.brass.push(xf(cyl(0.0048, 0.0008, 16, 0.0002), [0, 0, 0.0002]));
	}
	out.brass.push(lathe([[0.0202, -0.0440], [0.0206, -0.0446], [0.0206, -0.0488], [0.0200, -0.0494]], { segs: 32 })); // rotating band
	out.od.push(lathe([[0.0199, -0.0494], [0.0199, -0.0605], [0.0199, -0.0665], [0.0196, -0.0700], [0.0185, -0.0735]], { segs: 32 }));
	out.yellow.push(lathe([[0.02005, -0.0612], [0.02005, -0.0658]], { segs: 32 }));
	out.brass.push(lathe([[0.0185, -0.0735], [0.0165, -0.0800], [0.0132, -0.0875], [0.0092, -0.0940], [0.0052, -0.0990], [0.0028, -0.1015], [0.0, -0.1025]], { segs: 32, crease: 40 }));
	return out;
}
function grenade40Model() {
	const g = grp('grenade40');
	const B = new PB();
	const s = grenade40Geos(true);
	for (const x of s.alu) B.add('steel', x, TINT.alu);
	for (const x of s.brass) B.add('brass', x, TINT.brass);
	for (const x of s.od) B.add('od', x);
	for (const x of s.yellow) B.add('yellow', x);
	B.build(g, 'g40');
	return g;
}

/* ============================================================================
 * Milkor M32 MGL (6-shot 40mm revolver launcher)
 * gun coords: barrel bore y=0, z=0 at the recoil shield (cylinder rear)
 * ========================================================================== */
function buildM32() {
	const root = grp('m32');
	const WEB = [0, -0.103, 0.095];
	const body = grp('body', root, [0, -WEB[1], -WEB[2]]);
	const B = new PB();
	const CY = -0.047, CR = 0.0735; // cylinder axis y / outer radius
	/* ---- rear frame (recoil shield) + grip frame ---- */
	const rf = rounded([[0.0, 0.041, 0.004], [0.062, 0.041, 0.006], [0.074, 0.028, 0.006], [0.078, -0.010, 0.006], [0.094, -0.092, 0.006], [0.092, -0.106, 0.004], [0.046, -0.106, 0.004], [0.0, -0.126, 0.01]], 0, 3);
	B.add('park', extrude(rf, 0.050, { bevel: 0.003, bevelSegs: 2 }));
	for (const s of [-1, 1]) B.add('park', xf(extrude(rounded([[0.016, 0.0, 0.01], [0.060, 0.0, 0.01], [0.066, -0.072, 0.01], [0.020, -0.084, 0.01]], 0, 3), 0.002, { bevel: 0.0006 }), [s * 0.0245, 0, 0]), 0.75);
	B.add('park', xf(lathe([[0.004, 0.0], [CR + 0.004, 0.0], [CR + 0.006, 0.002], [CR + 0.006, 0.010], [0.004, 0.010]], { segs: 48 }), [0, CY, 0]), 0.9);
	for (const s of [-1, 1]) for (const [z, y] of [[0.012, 0.025], [0.052, 0.025], [0.052, -0.085], [0.012, -0.095]]) B.add('park', xf(screwHead(0.003, 0.0008), [s * 0.0258, y, z], [0, s > 0 ? 0 : PI, 0]), 1.4);
	// trigger guard + grip
	B.add('park', extrude(rounded([[0.006, -0.104, 0.002], [0.014, -0.104, 0.002], [0.016, -0.128, 0.004], [0.038, -0.131, 0.006], [0.050, -0.110, 0.003], [0.058, -0.104, 0.002], [0.060, -0.114, 0.004], [0.046, -0.140, 0.008], [0.012, -0.141, 0.008], [0.004, -0.126, 0.003]], 0, 3), 0.014, { bevel: 0.0018, bevelSegs: 2 }));
	const ga = 16 * DEG;
	const gpt = (u, v) => [0.074 + v * Math.cos(ga) + u * Math.sin(ga), -0.104 - u * Math.cos(ga) + v * Math.sin(ga)];
	const gF = [[-0.004, -0.019], [0.02, -0.0195], [0.034, -0.022], [0.047, -0.019], [0.062, -0.021], [0.086, -0.0195], [0.104, -0.016, 0.007]];
	const gR = [[0.104, 0.0165, 0.007], [0.085, 0.019], [0.045, 0.019], [0.015, 0.022], [-0.004, 0.024]];
	B.add('grip', extrude(rounded([...gF, ...gR].map(([u, v, r]) => [...gpt(u, v), r ?? 0.002]), 0, 3), 0.030, { bevel: 0.0055, bevelSegs: 3, crease: 40 }));
	/* ---- top strap + rail, front frame, axle ---- */
	B.add('park', loft([[0.004, -0.017, 0.017, 0.026, 0.041, 0.003], [-0.232, -0.017, 0.017, 0.026, 0.041, 0.003]]));
	picRail(B, 'anod', 0.050, -0.228, { p: [0, 0.041, 0] });
	{
		const pts = [];
		for (const z of [-0.210, -0.236]) for (const [cy, r] of [[0.0, 0.034], [CY, 0.024], [0.03, 0.017]]) for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; pts.push([Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
		B.add('park', hull(pts));
	}
	B.add('park', xf(lathe([[0.0, 0.004], [0.009, 0.004], [0.009, -0.24], [0.0075, -0.2425], [0, -0.2425]], { segs: 20 }), [0, CY, 0]), 1.3);
	B.add('park', xf(knurledKnob(0.0125, 0.012, 20)[0], [0, CY, -0.246]));
	/* ---- barrel (40mm) ---- */
	B.add('park', lathe([[0.0305, -0.236], [0.0305, -0.262], [0.0262, -0.268], [0.0262, -0.515], [0.0278, -0.517], [0.0278, -0.527], [0.0262, -0.529], [0.0206, -0.529], [0.0206, -0.49], [0.0, -0.49]], { segs: 40, shade: [1, 1, 1, 1, 1, 1, 1, 0.5, 0.15] }));
	for (let i = 0; i < 6; i++) { const a = i / 6 * TAU + 0.26; B.add('park', xf(cbox(0.0022, 0.0022, 0.035, 0.0004), [Math.cos(a) * 0.0199, Math.sin(a) * 0.0199, -0.511], [0, 0, a]), 0.3); }
	// heat shield rails on barrel sides
	for (const s of [-1, 1]) B.add('park', loft([[-0.275, s > 0 ? 0.024 : -0.0285, s > 0 ? 0.0285 : -0.024, -0.006, 0.006, 0.0012], [-0.47, s > 0 ? 0.024 : -0.0285, s > 0 ? 0.0285 : -0.024, -0.006, 0.006, 0.0012]]));
	/* ---- foregrip ---- */
	B.add('park', loft([[-0.305, -0.013, 0.013, -0.0325, -0.022, 0.002], [-0.365, -0.013, 0.013, -0.0325, -0.022, 0.002]]));
	picRail(B, 'anod', -0.308, -0.362, { p: [0, -0.024, 0], r: [0, 0, PI] });
	B.add('grip', loft([[-0.318, -0.0135, 0.0135, -0.046, -0.0335, 0.003], [-0.354, -0.0135, 0.0135, -0.046, -0.0335, 0.003]]), 0.9);
	const fg = lathe([[0, 0.0], [0.0145, 0.0], [0.0165, -0.006], [0.0165, -0.020], [0.0155, -0.032], [0.0168, -0.046], [0.0158, -0.060], [0.0170, -0.074], [0.0172, -0.090], [0.0155, -0.098], [0.0, -0.099]], { segs: 24, crease: 45 });
	B.add('grip', xf(fg, [0, -0.044, -0.336], [-(PI / 2 - 8 * DEG), 0, 0]));
	/* ---- telescoping stock ---- */
	B.add('anod', xf(lathe([[0, 0.232], [0.0126, 0.232], [0.0146, 0.230], [0.0146, 0.072]], { segs: 28 }), [0, -0.004, 0]));
	B.add('park', xf(lathe([[0.0146, 0.083], [0.0178, 0.083], [0.0178, 0.074], [0.0146, 0.074]], { segs: 28 }), [0, -0.004, 0]));
	const stock = rounded([[0.155, 0.0145, 0.004], [0.262, 0.017, 0.004], [0.272, 0.024, 0.003], [0.272, -0.100, 0.005], [0.259, -0.1025, 0.006], [0.19, -0.050, 0.014], [0.165, -0.028, 0.006], [0.155, -0.018, 0.004]], 0, 4);
	B.add('poly', xf(extrude(stock, 0.035, { bevel: 0.0035, bevelSegs: 2, crease: 38 }), [0, -0.004, 0]));
	B.add('poly', xf(extrude(rounded([[0.271, 0.025, 0.004], [0.287, 0.025, 0.004], [0.287, -0.103, 0.006], [0.271, -0.103, 0.004]], 0, 3), 0.039, { bevel: 0.0035, bevelSegs: 2 }), [0, -0.004, 0]), 0.7);
	/* ---- reflex sight on ranging mount ---- */
	const RT = 0.041 + RAIL_H, SY = 0.083;
	B.add('anod', loft([[-0.050, -0.0135, 0.0135, RT - 0.006, RT + 0.006, 0.0015], [-0.134, -0.0135, 0.0135, RT - 0.006, RT + 0.006, 0.0015]]));
	B.add('anod', loft([[-0.070, -0.009, 0.009, RT + 0.005, SY - 0.012, 0.0015], [-0.118, -0.009, 0.009, RT + 0.005, SY - 0.012, 0.0015]]));
	for (const g of knurledKnob(0.0105, 0.010, 20)) B.add('anod', xf(g, [0.020, RT + 0.012, -0.094], [0, PI / 2, 0]));
	B.add('anod', xf(lathe([[0.0150, -0.072], [0.0170, -0.071], [0.0192, -0.072], [0.0192, -0.124], [0.0172, -0.126], [0.0158, -0.123]], { segs: 36 }), [0, SY, 0]));
	B.add('anod', xf(cyl(0.0048, 0.012, 14, 0.001), [0.0205, SY, -0.098], [0, PI / 2, 0]));
	B.add('glassClear', xf(cyl(0.0158, 0.0008, 32), [0, SY, -0.0735]));
	B.add('glassClear', xf(cyl(0.0158, 0.0008, 32), [0, SY, -0.1215]));
	B.add('reticle', xf(fromThree(new THREE.CircleGeometry(0.00055, 14)), [0, SY, -0.1205]));
	B.add('reticle', xf(fromThree(new THREE.RingGeometry(0.0036, 0.0041, 36)), [0, SY, -0.1205]));
	B.build(body, 'm32');

	const parts = {};
	/* ---- revolving cylinder (rotates about local Z, 60 deg per shot) ---- */
	const cyln = grp('cylinder', body, [0, CY, 0]);
	const PR = 0.047;
	B.add('park', lathe([[0.010, -0.004], [CR - 0.002, -0.004], [CR, -0.006], [CR, -0.016], [CR - 0.002, -0.018], [0.010, -0.018]], { segs: 48 }));
	B.add('park', lathe([[0.010, -0.188], [CR - 0.002, -0.188], [CR, -0.190], [CR, -0.200], [CR - 0.002, -0.202], [0.010, -0.202]], { segs: 48 }));
	B.add('park', lathe([[0.0, -0.004], [0.0145, -0.004], [0.0145, -0.202], [0.0, -0.202]], { segs: 20 }));
	for (let i = 0; i < 6; i++) {
		const a = PI / 2 + i * PI / 3, cx = Math.cos(a) * PR, cy = Math.sin(a) * PR;
		B.add('park', xf(lathe([[0.0205, -0.012], [0.0252, -0.012], [0.0252, -0.203], [0.0240, -0.2045], [0.0205, -0.2045], [0.0205, -0.012]], { segs: 28, shade: [1, 1, 1, 1, 1, 0.3] }), [cx, cy, 0]));
		for (const z of [-0.07, -0.135]) B.add('park', xf(tube(0.0262, 0.0249, 0.006, 28, 0.0006), [cx, cy, z]), 0.8);
		const gg = grenade40Geos(false);
		for (const x of gg.brass) B.add('brass', xf(x, [cx, cy, -0.092]), TINT.brass);
		for (const x of gg.od) B.add('od', xf(x, [cx, cy, -0.092]));
		B.add('park', xf(cyl(0.0204, 0.004, 20), [cx, cy, -0.14]), 0.08);
	}
	B.build(cyln, 'm32cyl');
	parts.cylinder = cyln;
	const trig = grp('trigger', body, [0, -0.103, 0.032]);
	B.add('park', extrude(rounded([[0.004, 0.003, 0.001], [-0.004, 0.003, 0.001], [-0.0055, -0.009, 0], [-0.0078, -0.019, 0], [-0.0095, -0.0245, 0.001], [-0.0082, -0.0268, 0.001], [-0.0052, -0.0238, 0], [-0.002, -0.015, 0], [0.0025, -0.005, 0]], 0, 2), 0.0065, { bevel: 0.001 }));
	B.build(trig, 'm32trigger');
	parts.trigger = trig;

	const muzzle = empty('muzzle', body, [0, 0, -0.53]);
	const g0 = gpt(0.006, 0);
	const rightHand = handTarget('rightHand', body, [0, g0[1], g0[0]], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.015, rz: 0.0205, curl: 1, trigger: true, thumb: 0.75 });
	const fgA = 8 * DEG;
	const leftHand = handTarget('leftHand', body, [0, -0.052, -0.3375], [1, 0, 0], [0, Math.cos(fgA), Math.sin(fgA)], true, { rx: 0.0165, rz: 0.0165, curl: 1.05, thumb: 0.65 });
	const eye = new V3(0, SY, -0.072 + 0.10).add(body.position);
	const gProto = grenade40Model();
	return finishWeapon({
		root, muzzle, ejectPort: null, rightHand, leftHand, sight: { eye }, parts,
		magazineModel: () => gProto.clone(true), shellType: 'grenade40',
	});
}

/* ============================================================================
 * "Golden Punisher" - Armsel Striker style 12-round drum shotgun, gold plated
 * gun coords: bore y=0, z=0 at the rear face of the drum
 * ========================================================================== */
function buildGoldenPunisher() {
	const root = grp('goldenPunisher');
	const WEB = [0, -0.099, 0.097];
	const body = grp('body', root, [0, -WEB[1], -WEB[2]]);
	const B = new PB();
	const DY = -0.049, DR = 0.074, DL = 0.106; // drum axis / radius / length
	/* ---- receiver behind the drum ---- */
	const rec = rounded([[0.0, 0.030, 0.004], [0.070, 0.030, 0.008], [0.086, 0.018, 0.008], [0.088, -0.020, 0.008], [0.096, -0.090, 0.006], [0.094, -0.104, 0.004], [0.050, -0.104, 0.004], [0.0, -0.128, 0.012]], 0, 3);
	B.add('gold', extrude(rec, 0.052, { bevel: 0.0035, bevelSegs: 2, crease: 35 }));
	for (const s of [-1, 1]) B.add('gold', xf(extrude(rounded([[0.014, 0.018, 0.008], [0.070, 0.018, 0.01], [0.072, -0.060, 0.012], [0.018, -0.090, 0.02]], 0, 4), 0.0024, { bevel: 0.0008 }), [s * 0.0262, 0, 0]), 1.12);
	for (const s of [-1, 1]) for (const [z, y] of [[0.010, 0.022], [0.078, 0.020], [0.080, -0.075], [0.010, -0.105]]) B.add('park', xf(screwHead(0.0032, 0.0009), [s * 0.0266, y, z], [0, s > 0 ? 0 : PI, 0]), 1.2);
	// recoil shield ring
	B.add('gold', xf(lathe([[0.006, 0.0], [DR + 0.004, 0.0], [DR + 0.006, 0.002], [DR + 0.006, 0.012], [0.006, 0.012]], { segs: 56 }), [0, DY, 0]), 0.95);
	// rear notch sight
	B.add('gold', loft([[0.052, -0.009, 0.009, 0.029, 0.037, 0.0015], [0.066, -0.009, 0.009, 0.029, 0.037, 0.0015]]));
	for (const s of [-1, 1]) B.add('gold', loft([[0.054, s > 0 ? 0.0018 : -0.0075, s > 0 ? 0.0075 : -0.0018, 0.036, 0.0415, 0.0006], [0.064, s > 0 ? 0.0018 : -0.0075, s > 0 ? 0.0075 : -0.0018, 0.036, 0.0415, 0.0006]]));
	/* ---- trigger guard + grip ---- */
	B.add('gold', extrude(rounded([[0.006, -0.103, 0.002], [0.014, -0.103, 0.002], [0.016, -0.126, 0.004], [0.040, -0.129, 0.006], [0.052, -0.110, 0.003], [0.058, -0.103, 0.002], [0.061, -0.112, 0.004], [0.048, -0.139, 0.008], [0.012, -0.140, 0.008], [0.004, -0.125, 0.003]], 0, 3), 0.015, { bevel: 0.0018, bevelSegs: 2 }));
	const ga = 17 * DEG;
	const gpt = (u, v) => [0.074 + v * Math.cos(ga) + u * Math.sin(ga), -0.102 - u * Math.cos(ga) + v * Math.sin(ga)];
	const gF = [[-0.004, -0.019], [0.02, -0.0195], [0.034, -0.022], [0.047, -0.019], [0.062, -0.021], [0.086, -0.0195], [0.104, -0.016, 0.007]];
	const gR = [[0.104, 0.0165, 0.007], [0.085, 0.019], [0.045, 0.019], [0.015, 0.022], [-0.004, 0.024]];
	B.add('grip', extrude(rounded([...gF, ...gR].map(([u, v, r]) => [...gpt(u, v), r ?? 0.002]), 0, 3), 0.031, { bevel: 0.0055, bevelSegs: 3, crease: 40 }));
	/* ---- top strap, front frame, axle, winding key ---- */
	B.add('gold', loft([[0.004, -0.0145, 0.0145, 0.028, 0.040, 0.003], [-0.130, -0.0145, 0.0145, 0.028, 0.040, 0.003]]));
	{
		const pts = [];
		for (const z of [-0.114, -0.134]) for (const [cy, r] of [[0.0, 0.026], [DY, 0.026], [0.028, 0.0145]]) for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; pts.push([Math.cos(a) * r, cy + Math.sin(a) * r, z]); }
		B.add('gold', hull(pts));
	}
	/* ---- barrel + perforated shroud ---- */
	B.add('gold', lathe([[0.0126, -0.130], [0.0126, -0.4485], [0.0118, -0.450], [0.0094, -0.450], [0.0094, -0.44], [0, -0.44]], { segs: 28, shade: [1, 1, 1, 0.15, 0.05] }));
	B.add('gold', lathe([[0.0126, -0.134], [0.0190, -0.134], [0.0196, -0.136], [0.0196, -0.378], [0.0190, -0.380], [0.0126, -0.380]], { segs: 36 }), 1.02);
	for (let r = 0; r < 7; r++) for (let k = 0; k < 10; k++) {
		const a = k / 10 * TAU + (r % 2) * PI / 10, z = -0.152 - r * 0.031;
		if (Math.sin(a) < -0.6) continue;
		B.add('park', xf(cyl(0.0034, 0.0014, 12), [Math.cos(a) * 0.0193, Math.sin(a) * 0.0193, z], [0, PI / 2, a, 'ZYX']), 0.15);
	}
	/* ---- front sight + front grip ---- */
	B.add('gold', loft([[-0.366, -0.005, 0.005, 0.017, 0.022, 0.001], [-0.378, -0.005, 0.005, 0.017, 0.022, 0.001]]));
	B.add('gold', prism([[-0.368, 0.021], [-0.377, 0.021], [-0.3745, 0.0375], [-0.3705, 0.0375]], -0.0013, 0.0013, 0.0003, 'zy'));
	B.add('gold', loft([[-0.190, -0.012, 0.012, -0.034, -0.017, 0.003], [-0.228, -0.012, 0.012, -0.034, -0.017, 0.003]]));
	const fg = lathe([[0, 0.0], [0.0142, 0.0], [0.0162, -0.006], [0.0162, -0.022], [0.0152, -0.034], [0.0165, -0.048], [0.0155, -0.062], [0.0168, -0.076], [0.0170, -0.090], [0.0152, -0.098], [0.0, -0.099]], { segs: 24, crease: 45 });
	B.add('grip', xf(fg, [0, -0.032, -0.209], [-(PI / 2 - 10 * DEG), 0, 0]));
	/* ---- folding stock (extended): skeletal bars + butt plate ---- */
	B.add('gold', xf(cyl(0.0085, 0.022, 16, 0.0015), [0, 0.012, 0.094], [0, PI / 2, 0]));
	B.add('gold', sweep([[0, 0.012, 0.094], [0, 0.014, 0.20], [0, 0.016, 0.318]], circlePts(0, 0, 0.0062, 12), { segs: 12 }));
	B.add('gold', sweep([[0, -0.084, 0.094], [0, -0.07, 0.18], [0, -0.052, 0.318]], circlePts(0, 0, 0.0055, 12), { segs: 12 }));
	B.add('gold', extrude(rounded([[0.312, 0.026, 0.006], [0.326, 0.026, 0.006], [0.326, -0.108, 0.008], [0.312, -0.108, 0.006]], 0, 3), 0.036, { bevel: 0.003, bevelSegs: 2 }));
	B.add('rubber', extrude(rounded([[0.326, 0.025, 0.006], [0.336, 0.025, 0.006], [0.336, -0.107, 0.008], [0.326, -0.107, 0.006]], 0, 3), 0.037, { bevel: 0.003, bevelSegs: 2 }));
	B.add('gold', xf(cyl(0.007, 0.03, 16, 0.001), [0, 0.012, 0.094], [0, PI / 2, 0]), 0.9);
	B.build(body, 'goldenPunisher');

	const parts = {};
	/* ---- revolving 12-round drum (rotate about local Z, 30 deg per shot) ---- */
	const drum = grp('cylinder', body, [0, DY, 0]);
	B.add('gold', lathe([[0.012, -0.004], [DR - 0.004, -0.004], [DR, -0.008], [DR, -DL + 0.006], [DR - 0.004, -DL + 0.002], [0.030, -DL + 0.002]], { segs: 64 }));
	for (let i = 0; i < 12; i++) { const a = i / 12 * TAU + PI / 12; B.add('gold', xf(cbox(0.004, 0.0014, DL - 0.03, 0.0005), [Math.cos(a) * (DR - 0.0004), Math.sin(a) * (DR - 0.0004), -DL / 2], [0, 0, a + PI / 2]), 0.85); }
	for (const z of [-0.022, -DL + 0.022]) B.add('gold', xf(tube(DR + 0.0012, DR - 0.002, 0.004, 64, 0.0008), [0, 0, z]), 1.1);
	// front cover plate + clockwork winding key
	B.add('gold', lathe([[0.030, -DL + 0.002], [0.030, -DL - 0.004], [0.022, -DL - 0.006], [0.0, -DL - 0.006]], { segs: 40 }), 1.05);
	B.add('gold', xf(lathe([[0, 0], [0.012, 0], [0.012, -0.006], [0.009, -0.009], [0, -0.009]], { segs: 24 }), [0, 0, -DL - 0.006]));
	B.add('gold', extrude(rounded([[-0.030, -0.006, 0.006], [0.030, -0.006, 0.006], [0.030, 0.006, 0.006], [-0.030, 0.006, 0.006]], 0, 3), 0.004, { plane: 'xy', bevel: 0.001, pos: [0, 0, -DL - 0.017] }), 1.08);
	for (let i = 0; i < 12; i++) {
		const a = PI / 2 + i / 12 * TAU;
		B.add('gold', xf(lathe([[0.0, 0.0], [0.0085, 0.0], [0.0105, -0.002], [0.0, -0.002]], { segs: 18 }), [Math.cos(a) * 0.049, Math.sin(a) * 0.049, -DL + 0.0005]), 0.9);
	}
	B.build(drum, 'strikerDrum');
	parts.cylinder = drum;
	// ejector rod (right side)
	const ej = grp('ejector', body, [0.0735, -0.0145, 0]);
	B.add('gold', xf(cyl(0.004, 0.118, 14, 0.001), [0, 0, -0.062]));
	B.add('gold', xf(sphere(0.0065, 12, 8), [0, 0, -0.123]), 1.1);
	B.add('gold', loft([[-0.110, -0.012, 0.0, -0.004, 0.004, 0.001], [-0.118, -0.012, 0.0, -0.004, 0.004, 0.001]]));
	B.build(ej, 'strikerEjector');
	parts.ejector = ej;
	const trig = grp('trigger', body, [0, -0.101, 0.032]);
	B.add('gold', extrude(rounded([[0.004, 0.003, 0.001], [-0.004, 0.003, 0.001], [-0.0055, -0.009, 0], [-0.0078, -0.019, 0], [-0.0095, -0.0245, 0.001], [-0.0082, -0.0268, 0.001], [-0.0052, -0.0238, 0], [-0.002, -0.015, 0], [0.0025, -0.005, 0]], 0, 2), 0.0065, { bevel: 0.001 }), 1.05);
	B.build(trig, 'strikerTrigger');
	parts.trigger = trig;

	const muzzle = empty('muzzle', body, [0, 0, -0.451]);
	const ejectPort = empty('ejectPort', body, [DR * 0.72, DY + DR * 0.55, -0.05]);
	const g0 = gpt(0.006, 0);
	const rightHand = handTarget('rightHand', body, [0, g0[1], g0[0]], [-1, 0, 0], [0, Math.cos(ga), -Math.sin(ga)], false, { rx: 0.0155, rz: 0.021, curl: 1, trigger: true, thumb: 0.75 });
	const fgA = 10 * DEG;
	const leftHand = handTarget('leftHand', body, [0, -0.045, -0.211], [1, 0, 0], [0, Math.cos(fgA), Math.sin(fgA)], true, { rx: 0.0165, rz: 0.0165, curl: 1.05, thumb: 0.65 });
	const eye = new V3(0, 0.0385, 0.059 + 0.10).add(body.position);
	const shellProto = shotshellModel(true);
	return finishWeapon({
		root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts,
		magazineModel: () => shellProto.clone(true), shellType: 'shotgun',
	});
}

/* ============================================================================
 * Handheld M134-style minigun
 * gun coords: barrel rotation axis y=0, rear face of the gun housing z=0
 * ========================================================================== */
// rectangular chute along a planar (XY) path at depth z: profile halfN (in-plane) x halfZ
function chuteGeo(path, zc, halfN, halfZ, segs = 24) {
	const curve = new THREE.CatmullRomCurve3(path.map(p => new V3(p[0], p[1], zc)));
	const A = new Acc();
	const rings = [];
	for (let i = 0; i <= segs; i++) {
		const t = i / segs, c = curve.getPointAt(t), tg = curve.getTangentAt(t);
		const n = new V3(-tg.y, tg.x, 0).normalize();
		rings.push({ c, r: [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([a, b]) => [c.x + n.x * halfN * a, c.y + n.y * halfN * a, zc + halfZ * b]) });
	}
	for (let i = 0; i < segs; i++) for (let k = 0; k < 4; k++) {
		const a = rings[i].r[k], b = rings[i].r[(k + 1) % 4], c = rings[i + 1].r[(k + 1) % 4], d = rings[i + 1].r[k];
		const m = [(a[0] + b[0] + c[0] + d[0]) / 4 - (rings[i].c.x + rings[i + 1].c.x) / 2, (a[1] + b[1] + c[1] + d[1]) / 4 - (rings[i].c.y + rings[i + 1].c.y) / 2, (a[2] + b[2] + c[2] + d[2]) / 4 - zc];
		A.oquad(a, b, c, d, m, 0, 1);
	}
	for (const [idx, sg] of [[0, -1], [segs, 1]]) {
		const R = rings[idx], tg = curve.getTangentAt(idx / segs).multiplyScalar(sg);
		A.oquad(R.r[0], R.r[1], R.r[2], R.r[3], tg.toArray(), 0, 0.35);
	}
	return { geo: A.geo(30), curve };
}

function buildChaingun() {
	const root = grp('chaingun');
	const WEB = [0.062, 0.028, 0.076];
	const body = grp('body', root, [-WEB[0], -WEB[1], -WEB[2]]);
	const B = new PB();
	/* ---- gun housing ---- */
	B.add('park', loft([[0.0, -0.052, 0.052, -0.050, 0.056, 0.008], [-0.166, -0.052, 0.052, -0.050, 0.056, 0.008]]));
	B.add('park', loft([[0.008, -0.055, 0.055, -0.053, 0.059, 0.006], [0.0, -0.055, 0.055, -0.053, 0.059, 0.006]]), 1.15);
	for (const s of [-1, 1]) {
		B.add('park', loft([[-0.02, s > 0 ? 0.051 : -0.0535, s > 0 ? 0.0535 : -0.051, -0.035, 0.040, 0.002], [-0.15, s > 0 ? 0.051 : -0.0535, s > 0 ? 0.0535 : -0.051, -0.035, 0.040, 0.002]]), 0.85);
		for (const [z, y] of [[-0.012, 0.045], [-0.155, 0.045], [-0.012, -0.040], [-0.155, -0.040]]) B.add('park', xf(screwHead(0.0034, 0.001), [s * 0.0525, y, z], [0, s > 0 ? 0 : PI, 0]), 1.3);
	}
	B.add('park', lathe([[0.0, -0.160], [0.049, -0.160], [0.051, -0.162], [0.051, -0.238], [0.048, -0.242], [0.02, -0.242]], { segs: 40 }));
	for (let i = 0; i < 3; i++) B.add('park', xf(tube(0.0525, 0.049, 0.004, 40, 0.0006), [0, 0, -0.178 - i * 0.022]), 1.12);
	/* ---- drive motor (top right) ---- */
	B.add('anod', xf(lathe([[0.0, 0.0], [0.020, 0.0], [0.0245, -0.004], [0.0245, -0.105], [0.022, -0.110], [0.012, -0.112], [0.0, -0.112]], { segs: 32 }), [0.040, 0.066, -0.018]));
	for (let i = 0; i < 9; i++) B.add('anod', xf(tube(0.0272, 0.024, 0.0022, 32, 0.0004), [0.040, 0.066, -0.035 - i * 0.0085]), 0.85);
	B.add('park', loft([[-0.03, 0.022, 0.050, 0.040, 0.058, 0.003], [-0.11, 0.022, 0.050, 0.040, 0.058, 0.003]]));
	B.add('park', xf(cyl(0.006, 0.02, 12, 0.001), [0.060, 0.066, -0.003], [0, 0, 0]), 1.2);
	/* ---- feeder / delinker (left) ---- */
	B.add('park', loft([[-0.074, -0.098, -0.050, -0.036, 0.032, 0.004], [-0.178, -0.098, -0.050, -0.036, 0.032, 0.004]]), 0.95);
	B.add('park', loft([[-0.080, -0.101, -0.092, -0.030, 0.026, 0.002], [-0.172, -0.101, -0.092, -0.030, 0.026, 0.002]]), 1.1);
	B.add('park', loft([[-0.078, -0.098, -0.068, -0.052, -0.035, 0.002], [-0.172, -0.098, -0.068, -0.052, -0.035, 0.002]]), 0.9);
	B.add('park', cbox(0.026, 0.0008, 0.086, 0.0002, [-0.083, -0.0524, -0.125]), 0.1);
	/* ---- carry handle ---- */
	B.add('park', sweep([[0, 0.054, -0.022], [0, 0.098, -0.030], [0, 0.118, -0.078], [0, 0.098, -0.126], [0, 0.054, -0.134]], circlePts(0, 0, 0.0085, 12), { segs: 26 }));
	B.add('rubber', sweep([[0, 0.104, -0.045], [0, 0.118, -0.078], [0, 0.104, -0.111]], circlePts(0, 0, 0.0118, 14), { segs: 16 }));
	for (const z of [-0.022, -0.134]) B.add('park', loft([[z + 0.012, -0.012, 0.012, 0.054, 0.062, 0.002], [z - 0.012, -0.012, 0.012, 0.054, 0.062, 0.002]]));
	/* ---- rear spade grips ---- */
	for (const s of [-1, 1]) {
		B.add('park', loft([[0.004, s > 0 ? 0.040 : -0.074, s > 0 ? 0.074 : -0.040, 0.030, 0.044, 0.003], [0.070, s > 0 ? 0.052 : -0.074, s > 0 ? 0.074 : -0.052, 0.030, 0.044, 0.003]]));
		B.add('park', loft([[0.004, s > 0 ? 0.040 : -0.074, s > 0 ? 0.074 : -0.040, -0.098, -0.084, 0.003], [0.070, s > 0 ? 0.052 : -0.074, s > 0 ? 0.074 : -0.052, -0.098, -0.084, 0.003]]));
		const hp = [[0.0, 0.031], [0.0135, 0.031], [0.0155, 0.028], [0.0158, 0.02], [0.0150, 0.008], [0.0162, -0.006], [0.0152, -0.020], [0.0165, -0.034], [0.0156, -0.048], [0.0166, -0.062], [0.0162, -0.080], [0.0145, -0.084], [0.0, -0.084]];
		B.add('rubber', xf(lathe(hp, { segs: 24, crease: 45 }), [s * 0.062, 0, 0.076], [-PI / 2, 0, 0]));
	}
	B.add('park', loft([[0.070, -0.052, 0.052, 0.030, 0.040, 0.003], [0.082, -0.052, 0.052, 0.030, 0.040, 0.003]]));
	/* ---- front vertical handle ---- */
	B.add('park', loft([[-0.196, -0.012, 0.012, -0.068, -0.046, 0.003], [-0.232, -0.012, 0.012, -0.068, -0.046, 0.003]]));
	const fh = lathe([[0, 0.0], [0.0142, 0.0], [0.0162, -0.006], [0.0162, -0.022], [0.0152, -0.034], [0.0165, -0.048], [0.0155, -0.062], [0.0168, -0.076], [0.0170, -0.092], [0.0152, -0.100], [0.0, -0.101]], { segs: 24, crease: 45 });
	B.add('rubber', xf(fh, [0, -0.066, -0.214], [-(PI / 2 - 10 * DEG), 0, 0]));
	/* ---- belt feed chute + exposed linked rounds ---- */
	const CZ = -0.125;
	const ch = chuteGeo([[-0.084, -0.112], [-0.094, -0.16], [-0.112, -0.23], [-0.128, -0.31], [-0.132, -0.42]], CZ, 0.0145, 0.045, 30);
	B.add('od', ch.geo);
	for (let i = 1; i < 12; i++) {
		const t = i / 12, c = ch.curve.getPointAt(t), tg = ch.curve.getTangentAt(t);
		const ang = Math.atan2(tg.y, tg.x) + PI / 2;
		B.add('od', cbox(0.034, 0.005, 0.096, 0.0012, [c.x, c.y, CZ], [0, 0, ang]), 1.18);
	}
	B.add('od', cbox(0.034, 0.008, 0.098, 0.002, [-0.0842, -0.106, CZ], [0, 0, Math.atan2(-0.048, -0.01) + PI / 2]), 1.1);
	for (let i = 0; i < 5; i++) {
		const y = -0.044 - i * 0.0122, x = -0.0835 + i * 0.0002;
		const { caseG, bulletG } = cartridgeGeos(0.0512, 0.00598, 0.0043, 0.0395, 0.0285, 0.0039, { segs: 10, rim: 0.006 });
		xf(caseG, [x, y, CZ + 0.0355]); xf(bulletG, [x, y, CZ + 0.0355]);
		B.add('brass', caseG, TINT.brass); B.add('brass', bulletG, i === 2 ? col(0xa8342a) : TINT.copper);
		for (const dz of [0.004, 0.030]) B.add('park', xf(tube(0.0069, 0.0059, 0.0055, 14), [x, y, CZ + 0.0355 - dz]), 0.8);
		B.add('park', cbox(0.0018, 0.012, 0.028, 0.0004, [x - 0.0066, y - 0.006, CZ + 0.0355 - 0.017]), 0.8);
	}
	B.build(body, 'chaingun');

	const parts = {};
	/* ---- rotating barrel cluster (spins about local Z) ---- */
	const barrels = grp('barrels', body, [0, 0, 0]);
	B.add('blued', lathe([[0.02, -0.242], [0.046, -0.243], [0.047, -0.246], [0.047, -0.272], [0.044, -0.276], [0.010, -0.276]], { segs: 40 }));
	B.add('blued', xf(cyl(0.0085, 0.47, 16), [0, 0, -0.51]), 0.8);
	const PR = 0.0305;
	for (let i = 0; i < 6; i++) {
		const a = PI / 6 + i * PI / 3, cx = Math.cos(a) * PR, cy = Math.sin(a) * PR;
		B.add('blued', xf(lathe([[0.0112, -0.272], [0.0112, -0.335], [0.0098, -0.345], [0.0092, -0.795], [0.0086, -0.800], [0.0040, -0.800], [0.0040, -0.79], [0.0, -0.79]], { segs: 18, shade: [1, 1, 1, 1, 1, 0.15, 0.05] }), [cx, cy, 0]));
	}
	for (const [z, t, r] of [[-0.520, 0.012, 0.0435], [-0.748, 0.016, 0.0425]]) {
		B.add('park', xf(lathe([[0.012, t / 2], [r - 0.002, t / 2], [r, t / 2 - 0.002], [r, -t / 2 + 0.002], [r - 0.002, -t / 2], [0.012, -t / 2], [0.012, t / 2]], { segs: 40 }), [0, 0, z]));
		for (let i = 0; i < 6; i++) { const a = i * PI / 3; B.add('park', xf(screwHead(0.0028, 0.001), [Math.cos(a) * (r - 0.004), Math.sin(a) * (r - 0.004), z - t / 2], [0, -PI / 2, 0]), 1.3); }
	}
	B.build(barrels, 'chaingunBarrels');
	parts.barrels = barrels;
	/* ---- butterfly trigger (thumb paddle between the spade grips, pivot about X) ---- */
	const trig = grp('trigger', body, [0, 0.036, 0.074]);
	B.add('park', loft([[0.002, -0.034, 0.034, 0.002, 0.012, 0.002], [-0.004, -0.030, 0.030, 0.002, 0.014, 0.002]]), 1.2);
	B.add('park', xf(cyl(0.003, 0.08, 10), [0, 0.0, 0.0], [0, PI / 2, 0]));
	B.build(trig, 'chaingunTrigger');
	parts.trigger = trig;

	const muzzle = empty('muzzle', body, [0, 0, -0.801]);
	const ejectPort = empty('ejectPort', body, [0.035, -0.053, -0.13]);
	const rightHand = handTarget('rightHand', body, [0.062, 0.020, 0.076], [-1, 0, 0], [0, 1, 0], false, { rx: 0.016, rz: 0.016, curl: 1.05, thumb: 0.5 });
	const fa = 10 * DEG;
	const leftHand = handTarget('leftHand', body, [0, -0.083, -0.2145], [1, 0, 0], [0, Math.cos(fa), Math.sin(fa)], true, { rx: 0.0165, rz: 0.0165, curl: 1.05, thumb: 0.65 });
	const eye = new V3(0, 0.150, 0.14).add(body.position);
	return finishWeapon({ root, muzzle, ejectPort, rightHand, leftHand, sight: { eye }, parts, shellType: 'rifle' });
}

/* ============================================================================
 * First-person arms rig (rigidly skinned, 2-bone IK)
 * Bind pose: shoulder at origin, arm straight along -Z, hand in "handshake" pose
 * (right hand: palm -X, index side +Y, fingers -Z). Left arm is the X mirror.
 * ========================================================================== */
const ARM_L1 = 0.34, ARM_L2 = 0.32;
const FINGERS = [
	// knuckle pos (hand space), lengths [prox, mid, dist], radius, splay (deg about X)
	{ k: [0.0015, 0.0285, -0.0905], len: [0.046, 0.0275, 0.0225], r: 0.0099, splay: 5 },
	{ k: [0.0015, 0.0090, -0.0960], len: [0.051, 0.0315, 0.0245], r: 0.0102, splay: 0.5 },
	{ k: [0.0010, -0.0105, -0.0930], len: [0.048, 0.0295, 0.0235], r: 0.0097, splay: -3.5 },
	{ k: [0.0000, -0.0285, -0.0850], len: [0.037, 0.0225, 0.0210], r: 0.0087, splay: -8 },
];
const THUMB = { base: [-0.0075, 0.0245, -0.0200], dir: [-0.42, 0.62, -0.66], len: [0.044, 0.033, 0.028], r: [0.0132, 0.0112, 0.0102] };

// rounded box (subdivided box pushed onto a rounded shell)
function rblock(sx, sy, sz, r, segs = 5) {
	let g = new THREE.BoxGeometry(sx, sy, sz, segs, segs, segs);
	const p = g.attributes.position, hx = sx / 2 - r, hy = sy / 2 - r, hz = sz / 2 - r;
	const v = new V3(), q = new V3();
	for (let i = 0; i < p.count; i++) {
		v.fromBufferAttribute(p, i);
		q.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
		v.sub(q); const l = v.length();
		if (l > 1e-9) v.multiplyScalar(r / l);
		v.add(q); p.setXYZ(i, v.x, v.y, v.z);
	}
	g = fromThree(g);
	return smoothNormals(g, 70);
}
// capsule along -Z from z=0 to z=-len (radius r0 at start, r1 at end), flattened in X by fx
function capsuleZ(len, r0, r1, fx = 0.9, segs = 12) {
	const prof = [];
	for (let i = 0; i <= 4; i++) { const a = (i / 4) * PI / 2; prof.push([r0 * Math.sin(a), r0 * Math.cos(a)]); }
	for (let i = 0; i <= 4; i++) { const a = (i / 4) * PI / 2; prof.push([r1 * Math.cos(a), -len - r1 * Math.sin(a)]); }
	const g = lathe(prof, { segs, crease: 70 });
	g.scale(fx, 1, 1);
	return smoothNormals(g, 70);
}

// skinned accumulator: per material list of [geometry(bind space), weightFn|boneIndex]
class SkinPB {
	constructor() { this.m = new Map(); }
	add(key, g, bone, tint) { if (!this.m.has(key)) this.m.set(key, []); this.m.get(key).push([g, bone, tint]); }
	build(parent, skeleton, name, mirror) {
		const meshes = [];
		for (const [key, list] of this.m) {
			const mat = getMat(key);
			const geos = list.map(([g, bone, tint]) => {
				const pg = prepGeo(g, mat, tint);
				const n = pg.attributes.position.count, si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
				const pos = pg.attributes.position.array;
				for (let i = 0; i < n; i++) {
					if (typeof bone === 'number') { si[i * 4] = bone; sw[i * 4] = 1; }
					else {
						const ws = bone(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
						for (let k = 0; k < ws.length && k < 4; k++) { si[i * 4 + k] = ws[k][0]; sw[i * 4 + k] = ws[k][1]; }
					}
				}
				pg.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
				pg.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
				return pg;
			});
			let merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
			if (!merged) throw new Error('gunModels: arm merge failed ' + key);
			if (mirror) mirrorX(merged);
			merged.computeBoundingSphere();
			const mesh = new THREE.SkinnedMesh(merged, mat);
			mesh.name = name + '_' + key;
			mesh.frustumCulled = false;
			mesh.castShadow = true; mesh.receiveShadow = true;
			parent.add(mesh);
			mesh.bind(skeleton, new THREE.Matrix4());
			meshes.push(mesh);
		}
		return meshes;
	}
}
// mirror a non-indexed geometry across X (flips winding)
function mirrorX(g) {
	const attrs = Object.values(g.attributes);
	const pos = g.attributes.position.array, nor = g.attributes.normal.array;
	for (let i = 0; i < pos.length; i += 3) { pos[i] = -pos[i]; nor[i] = -nor[i]; }
	const n = g.attributes.position.count;
	for (const a of attrs) {
		const s = a.itemSize, arr = a.array;
		for (let t = 0; t < n; t += 3) for (let k = 0; k < s; k++) { const i1 = (t + 1) * s + k, i2 = (t + 2) * s + k; const tmp = arr[i1]; arr[i1] = arr[i2]; arr[i2] = tmp; }
		a.needsUpdate = true;
	}
	return g;
}

function makeArm(isLeft) {
	const group = new THREE.Group(); group.name = isLeft ? 'leftArm' : 'rightArm';
	const bones = [];
	const mk = (name, parent, p, q) => { const b = new THREE.Bone(); b.name = name; if (p) b.position.set(p[0], p[1], p[2]); if (q) b.quaternion.copy(q); (parent || group).add(b); bones.push(b); return b; };
	const WZ = -(ARM_L1 + ARM_L2);
	const upper = mk('upper', null, [0, 0, 0]);
	const fore = mk('fore', null, [0, 0, -ARM_L1]);
	const hand = mk('hand', null, [0, 0, WZ]);
	const UP = 0, FO = 1, HA = 2;
	const fingers = FINGERS.map((f, fi) => {
		const rest = new THREE.Quaternion().setFromAxisAngle(new V3(1, 0, 0), f.splay * DEG);
		const b0 = mk('f' + fi + '_0', hand, f.k, rest);
		const b1 = mk('f' + fi + '_1', b0, [0, 0, -f.len[0]]);
		const b2 = mk('f' + fi + '_2', b1, [0, 0, -f.len[1]]);
		return { bones: [b0, b1, b2], rest: [rest.clone(), new THREE.Quaternion(), new THREE.Quaternion()], def: f };
	});
	const tdir = new V3(...THUMB.dir).normalize();
	const tq0 = new THREE.Quaternion().setFromUnitVectors(new V3(0, 0, -1), tdir);
	// roll the thumb so its pad faces the fingers
	tq0.multiply(new THREE.Quaternion().setFromAxisAngle(new V3(0, 0, -1), -50 * DEG));
	const t0 = mk('t_0', hand, THUMB.base, tq0);
	const t1 = mk('t_1', t0, [0, 0, -THUMB.len[0]]);
	const t2 = mk('t_2', t1, [0, 0, -THUMB.len[1]]);
	// thumb flex axis in local frame: rotates the thumb towards the palm side (-X) and fingers
	const inv = tq0.clone().invert();
	const toward = new V3(-0.75, -0.25, -0.6).normalize().applyQuaternion(inv);
	const taxis = new V3().crossVectors(new V3(0, 0, -1), toward).normalize();
	const thumb = { bones: [t0, t1, t2], rest: [tq0.clone(), new THREE.Quaternion(), new THREE.Quaternion()], axis: taxis };
	group.updateMatrixWorld(true);
	const idx = (b) => bones.indexOf(b);

	// ---------- geometry (right-handed; mirrored for left) ----------
	const S = new SkinPB();
	const bindOf = (b) => b.matrixWorld.clone();
	const inBone = (g, b) => g.applyMatrix4(bindOf(b));
	const hs = (g) => xf(g, [0, 0, WZ]); // hand space -> bind space
	const blend = (z, zA, zB, bA, bB) => { // zA > zB ; above zA -> bA, below zB -> bB
		if (z >= zA) return [[bA, 1]]; if (z <= zB) return [[bB, 1]];
		let t = (zA - z) / (zA - zB); t = t * t * (3 - 2 * t); return [[bA, 1 - t], [bB, t]];
	};
	// sleeve: elliptical tube with fabric folds, rolled cuff near the wrist
	{
		const A = new Acc();
		const zStart = 0.18, zEnd = WZ + 0.082, rings = 52, seg = 22;
		const radius = (z) => {
			const t = (z - zStart) / (zEnd - zStart); // 0 shoulder .. 1 cuff
			let r = 0.050 - 0.010 * t - 0.007 * Math.max(0, t - 0.45) / 0.55;
			const ze = z + ARM_L1; r += 0.004 * Math.exp(-(ze * ze) / 0.0015); // elbow bunching
			return r;
		};
		const ringPts = [];
		for (let i = 0; i <= rings; i++) {
			const z = zStart + (zEnd - zStart) * i / rings, r = radius(z);
			const pts = [];
			for (let k = 0; k < seg; k++) {
				const a = k / seg * TAU;
				const fold = 0.035 * Math.sin(3 * a + z * 21) + 0.022 * Math.sin(5 * a - z * 33 + 1.3) + 0.014 * Math.sin(8 * a + z * 57 + 2.1)
					+ 0.03 * Math.exp(-Math.pow((z + ARM_L1) / 0.05, 2)) * Math.sin(z * 190 + a * 2);
				const rr2 = r * (1 + fold);
				pts.push([Math.cos(a) * rr2 * 0.93, Math.sin(a) * rr2 * 1.05, z]);
			}
			ringPts.push({ z, pts });
		}
		// rolled cuff: bulge + fold back inside
		const cuffRings = [[1.07, 0.003], [1.12, 0.009], [1.13, 0.016], [1.09, 0.022], [1.01, 0.024], [0.94, 0.020], [0.91, 0.011]];
		const last = ringPts[ringPts.length - 1];
		for (const [sc, dz] of cuffRings) {
			const z = last.z - dz * (dz > 0.024 ? 1 : 1);
			ringPts.push({ z: last.z - dz, pts: last.pts.map(([x, y]) => [x * sc, y * sc, last.z - dz]), inner: sc < 1 });
		}
		for (let i = 0; i < ringPts.length - 1; i++) {
			const A0 = ringPts[i], A1 = ringPts[i + 1];
			for (let k = 0; k < seg; k++) {
				const a = A0.pts[k], b = A0.pts[(k + 1) % seg], c = A1.pts[(k + 1) % seg], d = A1.pts[k];
				const mx = (a[0] + b[0] + c[0] + d[0]) / 4, my = (a[1] + b[1] + c[1] + d[1]) / 4;
				const want = A1.inner ? [-mx, -my, 0] : [mx, my, 0];
				A.oquad(a, b, c, d, want, i >= rings ? 0.6 : 0, A1.inner ? 0.45 : 1);
			}
		}
		const g = A.geo(60);
		S.add('sleeve', g, (x, y, z) => blend(z, -ARM_L1 + 0.05, -ARM_L1 - 0.05, UP, FO));
	}
	// wrist skin
	S.add('skin', hs(lathe([[0.0265, 0.098], [0.0282, 0.07], [0.0285, 0.05], [0.027, 0.03]], { segs: 18 })), (x, y, z) => blend(z, WZ + 0.09, WZ + 0.0, FO, HA));
	// glove cuff (elliptical), strap
	{
		const cuff = lathe([[0.0262, 0.0808], [0.0270, 0.0836], [0.0292, 0.0842], [0.0304, 0.081], [0.0305, 0.063], [0.0305, 0.058], [0.0298, 0.030], [0.0282, 0.008], [0.0275, -0.010]], { segs: 22 });
		cuff.scale(1, 1.2, 1);
		const cw = (x, y, z) => blend(z, WZ + 0.08, WZ + 0.0, FO, HA);
		S.add('glove', hs(cuff), cw);
		const strap = lathe([[0.0304, 0.045], [0.0326, 0.043], [0.0329, 0.024], [0.0306, 0.022], [0.0304, 0.045]], { segs: 22, t0: -1.4, t1: 1.9 });
		strap.scale(1, 1.2, 1);
		S.add('gloveArmor', hs(strap), cw);
		S.add('gloveArmor', hs(cbox(0.0035, 0.010, 0.020, 0.0015, [0.0262, -0.0262, 0.034], [0, 0, -0.75])), cw);
	}
	// palm block (tapered), thenar / hypothenar pads
	{
		const palm = rblock(0.030, 0.084, 0.098, 0.011, 6);
		const p = palm.attributes.position.array;
		for (let i = 0; i < p.length; i += 3) {
			const t = (p[i + 2] + 0.049) / 0.098; // 0 at knuckles .. 1 at wrist
			p[i + 1] *= 1 - 0.2 * t;
			p[i] *= 1 - 0.12 * t;
			if (p[i] > 0) p[i] *= 1 + 0.15 * Math.sin(Math.PI * (1 - t)); // back of hand arch
		}
		smoothNormals(palm, 70);
		S.add('glove', hs(xf(palm, [0.001, 0.0, -0.047])), HA);
		const thenar = sphere(0.018, 14, 10); thenar.scale(0.75, 1.0, 1.35);
		S.add('glove', hs(xf(thenar, [-0.0085, 0.019, -0.030])), HA);
		const hypo = sphere(0.014, 12, 8); hypo.scale(0.7, 0.9, 1.6);
		S.add('glove', hs(xf(hypo, [-0.008, -0.026, -0.040])), HA);
		// back panel + knuckle armor
		const back = sphere(1, 18, 12); back.scale(0.0045, 0.030, 0.026);
		S.add('gloveFabric', hs(xf(back, [0.0142, 0.0, -0.046])), HA);
		for (const y of [-0.016, 0.0, 0.016]) { const rib = sphere(1, 10, 6); rib.scale(0.0025, 0.0045, 0.020); S.add('gloveArmor', hs(xf(rib, [0.0172, y, -0.047])), HA, 0.9); }
		const kn = rblock(0.0085, 0.080, 0.021, 0.0038, 4);
		S.add('gloveArmor', hs(xf(kn, [0.0150, 0.0, -0.086])), HA);
		for (let i = 0; i < 4; i++) {
			const f = FINGERS[i], bump = sphere(0.0072, 10, 7); bump.scale(0.75, 1.0, 1.05);
			S.add('gloveArmor', hs(xf(bump, [0.0192, f.k[1], -0.087])), HA);
		}
		// palm leather reinforcement patch
		const patch = rblock(0.004, 0.060, 0.046, 0.0018, 3);
		S.add('gloveArmor', hs(xf(patch, [-0.0138, -0.004, -0.056])), HA, 0.85);
	}
	// fingers
	fingers.forEach((F) => {
		const f = F.def;
		for (let s = 0; s < 3; s++) {
			const r0 = f.r * (1 - s * 0.07), r1 = f.r * (1 - (s + 1) * 0.07);
			const g = capsuleZ(f.len[s], r0, s === 2 ? r1 * 0.95 : r1, 0.88, 12);
			S.add('glove', inBone(g, F.bones[s]), idx(F.bones[s]));
			if (s === 0) { const pad = rblock(0.0045, 0.012, 0.018, 0.002, 3); S.add('gloveArmor', inBone(xf(pad, [f.r * 0.86, 0, -f.len[0] * 0.5]), F.bones[s]), idx(F.bones[s])); }
			if (s === 2) { const tip = sphere(r1 * 0.9, 10, 6); tip.scale(0.7, 0.85, 0.9); S.add('gloveFabric', inBone(xf(tip, [-r1 * 0.32, 0, -f.len[2] * 0.62]), F.bones[s]), idx(F.bones[s]), 0.9); }
		}
	});
	for (let s = 0; s < 3; s++) {
		const g = capsuleZ(THUMB.len[s], THUMB.r[s], s === 2 ? THUMB.r[s] * 0.85 : THUMB.r[s + 1], 0.9, 12);
		S.add('glove', inBone(g, thumb.bones[s]), idx(thumb.bones[s]));
	}
	const pad = rblock(0.004, 0.012, 0.02, 0.0018, 3);
	S.add('gloveArmor', inBone(xf(pad, [0, THUMB.r[1] * 0.85, -THUMB.len[1] * 0.5]), thumb.bones[1]), idx(thumb.bones[1]));

	// mirror bones for the left arm (bind pose positions)
	if (isLeft) {
		for (const b of bones) {
			b.position.x = -b.position.x;
			b.quaternion.set(b.quaternion.x, -b.quaternion.y, -b.quaternion.z, b.quaternion.w);
		}
		for (const F of fingers) F.rest = F.rest.map(q => new THREE.Quaternion(q.x, -q.y, -q.z, q.w));
		thumb.rest = thumb.rest.map(q => new THREE.Quaternion(q.x, -q.y, -q.z, q.w));
		thumb.axis = new V3(-thumb.axis.x, thumb.axis.y, thumb.axis.z).negate();
		group.updateMatrixWorld(true);
	}
	const skeleton = new THREE.Skeleton(bones);
	S.build(group, skeleton, group.name, isLeft);
	return { group, isLeft, bones, upper, fore, hand, fingers, thumb, skeleton, curlOverride: null };
}

const _ikM = new THREE.Matrix4(), _ikInv = new THREE.Matrix4(), _tp = new V3(), _tq = new THREE.Quaternion(), _ts = new V3();
const _G = new V3(), _W = new V3(), _S = new V3(), _E = new V3(), _u = new V3(), _v = new V3(), _tmp = new V3(), _xh = new V3();
const _bx = new V3(), _by = new V3(), _bz = new V3(), _bm = new THREE.Matrix4(), _fq = new THREE.Quaternion(), _ax = new V3();

function boneLook(bone, from, to, xHint) {
	// bone local -Z points from `from` to `to`; local X as close as possible to xHint
	_bz.subVectors(from, to).normalize();
	_bx.copy(xHint).addScaledVector(_bz, -xHint.dot(_bz));
	if (_bx.lengthSq() < 1e-8) _bx.set(0, 1, 0).addScaledVector(_bz, -_bz.y);
	_bx.normalize();
	_by.crossVectors(_bz, _bx).normalize();
	_bm.makeBasis(_bx, _by, _bz);
	bone.position.copy(from);
	bone.quaternion.setFromRotationMatrix(_bm);
}

export function buildArms() {
	const root = new THREE.Group(); root.name = 'fpArms';
	const R = makeArm(false), L = makeArm(true);
	root.add(R.group, L.group);
	const cfg = {
		shoulders: { right: new V3(0.20, -0.28, 0.25), left: new V3(-0.22, -0.30, 0.25) },
		poles: { right: new V3(1.0, -0.42, 0.0), left: new V3(-1.0, -0.55, 0.0) },
		alignWrist: 0.4,
	};
	const hide = (arm) => { arm.group.visible = false; };

	function poseFingers(arm, ud) {
		const sgn = arm.isLeft ? -1 : 1;
		const c = arm.curlOverride ?? (ud.curl ?? 1);
		const base = [66, 86, 50], trig = [20, 40, 42];
		arm.fingers.forEach((F, fi) => {
			let k = c;
			if (fi === 0 && ud.index !== undefined) k = ud.index;
			const extra = fi === 3 ? 1.06 : fi === 2 ? 1.03 : 1;
			for (let s = 0; s < 3; s++) {
				const ang = (fi === 0 && ud.trigger) ? trig[s] : base[s] * k * extra;
				_fq.setFromAxisAngle(_ax.set(0, 1, 0), sgn * ang * DEG);
				F.bones[s].quaternion.copy(F.rest[s]).multiply(_fq);
			}
		});
		const th = ud.thumb ?? 0.5, tb = [18, 30, 26];
		for (let s = 0; s < 3; s++) {
			_fq.setFromAxisAngle(arm.thumb.axis, tb[s] * DEG * th);
			arm.thumb.bones[s].quaternion.copy(arm.thumb.rest[s]).multiply(_fq);
		}
	}

	const _refCache = new WeakMap();
	function gripData(target, weaponRoot, key) {
		// proxy targets (e.g. animation helpers) without grip metadata inherit it from the weapon's own hand empty
		const ud = target.userData || {};
		if (ud.rx !== undefined || !weaponRoot) return ud;
		let refs = _refCache.get(weaponRoot);
		if (!refs) { refs = { right: weaponRoot.getObjectByName('rightHand'), left: weaponRoot.getObjectByName('leftHand') }; _refCache.set(weaponRoot, refs); }
		return (refs[key] && refs[key].userData) || ud;
	}
	function solve(arm, target, key, weaponRoot) {
		if (!target) { hide(arm); return; }
		arm.group.visible = true;
		_ikM.multiplyMatrices(_ikInv, target.matrixWorld);
		_ikM.decompose(_tp, _tq, _ts);
		const ud = gripData(target, weaponRoot, key);
		const sx = arm.isLeft ? -1 : 1;
		_G.set(sx * -(0.013 + (ud.rx ?? 0.015)), ud.gy ?? 0.022, -(0.042 + (ud.rz ?? 0.02)));
		_W.copy(_G).applyQuaternion(_tq).negate().add(_tp); // wrist position
		_S.copy(cfg.shoulders[key]);
		const a = ARM_L1, b = ARM_L2;
		_u.subVectors(_W, _S);
		let d = _u.length();
		const maxR = (a + b) * 0.985, minR = Math.abs(a - b) + 0.05;
		if (d > maxR) { _S.addScaledVector(_u.normalize(), d - maxR); _u.subVectors(_W, _S); d = maxR; }
		if (d < minR) d = minR;
		_u.normalize();
		const cosA = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
		const sinA = Math.sqrt(1 - cosA * cosA);
		// elbow direction: blend of the default pole (elbow out/down) and the elbow position that
		// would line the forearm up with the hand (minimises wrist bending)
		_v.copy(cfg.poles[key]).addScaledVector(_u, -cfg.poles[key].dot(_u));
		if (_v.lengthSq() < 1e-8) _v.set(0, -1, 0).addScaledVector(_u, _u.y);
		_v.normalize();
		_tmp.set(0, 0, 1).applyQuaternion(_tq).multiplyScalar(b).add(_W).sub(_S);
		_tmp.addScaledVector(_u, -_tmp.dot(_u));
		if (_tmp.lengthSq() > 1e-8) { _tmp.normalize(); _v.multiplyScalar(1 - cfg.alignWrist).addScaledVector(_tmp, cfg.alignWrist).normalize(); }
		_E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_v, a * sinA);
		// forearm roll follows the hand, upper arm follows forearm
		_xh.set(1, 0, 0).applyQuaternion(_tq);
		boneLook(arm.fore, _E, _W, _xh);
		_tmp.set(1, 0, 0).applyQuaternion(arm.fore.quaternion);
		boneLook(arm.upper, _S, _E, _tmp);
		arm.hand.position.copy(_W);
		arm.hand.quaternion.copy(_tq);
		poseFingers(arm, ud);
	}

	function update(rightTarget, leftTarget, weaponRoot) {
		if (weaponRoot) weaponRoot.updateWorldMatrix(true, true);
		else { if (rightTarget) rightTarget.updateWorldMatrix(true, false); if (leftTarget) leftTarget.updateWorldMatrix(true, false); }
		root.updateWorldMatrix(true, false);
		_ikInv.copy(root.matrixWorld).invert();
		solve(R, rightTarget, 'right', weaponRoot);
		solve(L, leftTarget, 'left', weaponRoot);
		root.updateMatrixWorld(true);
	}
	function setFingerCurl(r, l) {
		R.curlOverride = (r === undefined || r === null) ? null : r;
		L.curlOverride = (l === undefined || l === null) ? null : l;
	}
	// start tucked away until the first update
	hide(R); hide(L);
	return { root, update, setFingerCurl, config: cfg, right: R, left: L };
}

/* ============================================================================
 * Ejected shell casings (shared geometry + materials, cached)
 * axis along Z, mouth toward -Z, origin at the casing centre
 * ========================================================================== */
const _shellCache = {};
function mergeGrouped(list) {
	// list of [geometry(prepped), material] -> one geometry with groups + material array
	const geos = list.map(l => l[0]);
	const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, true);
	if (!g) throw new Error('gunModels: shell merge failed');
	if (geos.length === 1) { g.clearGroups(); g.addGroup(0, g.attributes.position.count, 0); }
	g.computeBoundingSphere(); g.computeBoundingBox();
	return { geometry: g, material: list.length === 1 ? list[0][1] : list.map(l => l[1]) };
}
function shellEntry(type) {
	if (_shellCache[type]) return _shellCache[type];
	const brass = getMat('brass');
	let entry, L;
	const center = (g, len) => g.translate(0, 0, len / 2);
	if (type === 'shotgun') {
		const s = shotshellGeos(false); L = 0.0698;
		const headG = mergeGeometries([prepGeo(center(s.head, L), brass, TINT.brass), prepGeo(center(s.primer, L), brass, TINT.nickel)], false);
		const hullMat = getMat('hull');
		const hullG = mergeGeometries(s.hull.map(h => prepGeo(center(h, L), hullMat)), false) || prepGeo(center(s.hull[0], L), hullMat);
		entry = mergeGrouped([[headG, brass], [hullG, hullMat]]);
	} else if (type === 'grenade40') {
		L = 0.0445;
		const alu = getMat('steel');
		const caseG = lathe([[0, 0], [0.0215, 0], [0.0221, -0.0006], [0.0221, -0.003], [0.0205, -0.004], [0.0205, -0.0445], [0.0186, -0.0445], [0.0186, -0.008], [0, -0.008]], { segs: 24, shade: [0.8, 1, 1, 1, 1, 1, 0.4, 0.25] });
		const primer = xf(cyl(0.0048, 0.0008, 14), [0, 0, 0.0002]);
		entry = mergeGrouped([[prepGeo(center(caseG, L), alu, TINT.alu), alu], [prepGeo(center(primer, L), brass, TINT.brass), brass]]);
	} else {
		const dims = {
			rifle: [0.0449, 0.00475, 0.00315, 0.036, 0.0048],
			pistol: [0.0192, 0.00493, 0.00482, null, 0.00496],
			sniper: [0.0512, 0.00598, 0.0043, 0.0395, 0.006],
		}[type] || [0.0449, 0.00475, 0.00315, 0.036, 0.0048];
		L = dims[0];
		const { caseG } = cartridgeGeos(dims[0], dims[1], dims[2], dims[3], 0, 0, { segs: 12, rim: dims[4], open: true });
		const primer = xf(cyl(dims[1] * 0.36, 0.0003, 10), [0, 0, 0.00005]);
		entry = mergeGrouped([[mergeGeometries([prepGeo(center(caseG, L), brass, TINT.brass), prepGeo(center(primer, L), brass, TINT.nickel)], false), brass]]);
	}
	entry.length = L;
	_shellCache[type] = entry;
	return entry;
}

export function buildShellCasing(type = 'rifle') {
	const e = shellEntry(type);
	const m = new THREE.Mesh(e.geometry, e.material);
	m.name = 'shell_' + type;
	m.castShadow = true;
	m.userData.length = e.length;
	return m;
}

/* ============================================================================
 * Third-person / pickup models: 1-2 vertex coloured meshes, low poly
 * same conventions as the viewmodels (origin at grip web, forward -Z)
 * ========================================================================== */
const TPC = {
	black: col(0x1f2022), dark: col(0x2a2b2e), grey: col(0x8f9296), poly: col(0x1a1b1c), steel: col(0x55585d),
	gold: col(0xe8b44e), od: col(0x4b5436), brass: col(0xc9973f), leather: col(0x6a4428), edge: col(0xb8bcc2), red: col(0x9e1b16),
};
function tbox(x0, x1, y0, y1, z0, z1) { return cbox(x1 - x0, y1 - y0, z1 - z0, 0, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2]); }
function tcyl(r, z0, z1, segs = 8, x = 0, y = 0) { return xf(lathe([[0, z0], [r, z0], [r, z1], [0, z1]], { segs, crease: 50 }), [x, y, 0]); }
function tgrip(T, key, color, top, rake, len, depth, width) {
	// top = [z,y] of grip top centre
	const g = cbox(width, len, depth, 0.003);
	xf(g, [0, -len / 2, 0]);
	xf(g, [0, top[1], top[0]], [-rake, 0, 0]);
	T.add(key, g, color);
}

export function buildThirdPersonWeapon(id) {
	const root = new THREE.Group(); root.name = 'tp_' + id;
	const body = new THREE.Group(); root.add(body);
	const T = new PB();
	const M = 'tpMetal', P = 'tpPoly';
	switch (id) {
		case 'm4a1': {
			body.position.set(0, 0.047, -0.031);
			T.add(M, tbox(-0.0145, 0.0145, -0.0165, 0.0235, -0.176, 0), TPC.black);
			T.add(M, tbox(-0.0105, 0.0105, 0.0235, 0.033, -0.175, 0), TPC.black);
			T.add(M, tbox(-0.0142, 0.0142, -0.046, -0.0165, -0.17, 0.028), TPC.dark);
			T.add(M, tbox(-0.0162, 0.0162, -0.0765, -0.03, -0.17, -0.096), TPC.dark);
			T.add(M, xf(tbox(-0.011, 0.011, -0.07, 0.0, -0.032, 0.032), [0, -0.076, -0.133], [0.25, 0, 0]), TPC.dark);
			T.add(M, tcyl(0.0146, 0.19, 0.0), TPC.black);
			T.add(P, tbox(-0.0175, 0.0175, -0.092, 0.02, 0.12, 0.28), TPC.poly);
			T.add(M, tbox(-0.0215, 0.0215, -0.0195, 0.0235, -0.365, -0.19), TPC.black);
			T.add(M, tcyl(0.008, -0.365, -0.51, 6), TPC.dark);
			T.add(M, tcyl(0.011, -0.505, -0.556, 6), TPC.dark);
			// iron sights like the first-person gun: front sight base + wings + post, flip-up rear sight
			T.add(M, tbox(-0.009, 0.009, -0.012, 0.031, -0.402, -0.371), TPC.dark);
			for (const s of [-1, 1]) T.add(M, tbox(s > 0 ? 0.005 : -0.009, s > 0 ? 0.009 : -0.005, 0.031, 0.0655, -0.393, -0.381), TPC.dark);
			T.add(M, tbox(-0.001, 0.001, 0.031, 0.064, -0.3883, -0.3862), TPC.dark);
			T.add(M, tbox(-0.0118, 0.0118, 0.0325, 0.0375, -0.0385, -0.0035), TPC.black);
			T.add(M, tbox(-0.0104, 0.0104, 0.0375, 0.0702, -0.018, -0.007), TPC.black);
			tgrip(T, P, TPC.poly, [0.012, -0.044], 20 * DEG, 0.095, 0.04, 0.028);
			break;
		}
		case 'm4super90': {
			body.position.set(0, 0.05, -0.034);
			T.add(M, tbox(-0.017, 0.017, -0.036, 0.024, -0.235, 0), TPC.grey);
			T.add(M, tbox(-0.0105, 0.0105, 0.024, 0.0334, -0.205, -0.004), TPC.black);
			T.add(M, tbox(-0.0155, 0.0155, -0.052, -0.036, -0.122, 0), TPC.black);
			T.add(M, tcyl(0.0135, -0.235, -0.705), TPC.dark);
			T.add(M, tcyl(0.0126, -0.235, -0.605, 8, 0, -0.03), TPC.dark);
			T.add(P, tbox(-0.024, 0.024, -0.05, 0.004, -0.47, -0.238), TPC.poly);
			T.add(P, xf(tbox(-0.018, 0.018, -0.118, 0.02, 0.0, 0.305), null), TPC.poly);
			T.add(M, tbox(-0.0015, 0.0015, 0.0, 0.0525, -0.676, -0.656), TPC.dark);
			T.add(M, tbox(-0.012, 0.012, 0.03, 0.066, -0.045, -0.01), TPC.black);
			tgrip(T, P, TPC.poly, [0.012, -0.050], 18 * DEG, 0.1, 0.042, 0.03);
			break;
		}
		case 'l96a1': {
			body.position.set(0, 0.047, -0.034);
			T.add(P, tbox(-0.03, 0.03, -0.068, -0.004, -0.545, -0.215), TPC.poly);
			T.add(P, tbox(-0.024, 0.024, -0.07, -0.004, -0.215, 0.05), TPC.poly);
			T.add(P, tbox(-0.024, 0.024, -0.126, 0.031, 0.16, 0.309), TPC.poly);
			T.add(P, tbox(-0.024, 0.024, 0.0, 0.03, 0.05, 0.16), TPC.poly);
			T.add(P, tbox(-0.017, 0.017, -0.155, -0.06, -0.01, 0.045), TPC.poly);
			T.add(P, tbox(-0.017, 0.017, -0.13, -0.11, 0.045, 0.2), TPC.poly);
			T.add(M, tcyl(0.0185, 0.0, -0.215, 8), TPC.dark);
			T.add(M, tcyl(0.0135, -0.215, -0.79, 8), TPC.dark);
			T.add(M, tcyl(0.0156, -0.79, -0.866, 8), TPC.dark);
			T.add(M, tcyl(0.021, 0.09, 0.03, 10, 0, 0.062), TPC.black);
			T.add(M, tcyl(0.0152, 0.03, -0.16, 10, 0, 0.062), TPC.black);
			T.add(M, tcyl(0.0256, -0.16, -0.245, 10, 0, 0.062), TPC.black);
			T.add(M, tbox(-0.009, 0.009, 0.02, 0.05, -0.14, 0.0), TPC.black);
			T.add(M, tbox(-0.012, 0.012, -0.095, -0.07, -0.21, -0.122), TPC.dark);
			break;
		}
		case 'm9': {
			body.position.set(0, 0.0255, -0.0115);
			T.add(M, tbox(-0.0128, 0.0128, -0.0085, 0.0138, -0.1985, 0.002), TPC.black);
			T.add(M, tbox(-0.0146, 0.0146, -0.0205, -0.0085, -0.184, 0.018), TPC.dark);
			T.add(M, tbox(-0.004, 0.004, -0.058, -0.02, -0.1, -0.03), TPC.dark);
			T.add(M, tbox(-0.004, 0.004, -0.058, -0.052, -0.1, -0.035), TPC.dark);
			tgrip(T, P, TPC.poly, [-0.008, -0.02], 17 * DEG, 0.1, 0.04, 0.036);
			break;
		}
		case 'knife': {
			T.add(M, prism([[0, 0.0115], [-0.118, 0.0115], [-0.178, 0.0012], [-0.12, -0.024], [0, -0.0195]], -0.0021, 0.0021, 0.0004, 'zy'), TPC.black);
			T.add(M, prism([[0, -0.0105], [-0.12, -0.012], [-0.178, 0.0012], [-0.12, -0.024], [0, -0.0195]], -0.0014, 0.0014, 0.0002, 'zy'), TPC.edge);
			T.add(M, tbox(-0.0088, 0.0088, -0.036, 0.028, 0.0, 0.0052), TPC.dark);
			T.add(P, xf(tcyl(0.0125, 0.005, 0.113, 8), null, null, [0.8, 1, 1]), TPC.leather);
			T.add(M, xf(tcyl(0.0135, 0.113, 0.126, 8), null, null, [0.82, 1, 1]), TPC.dark);
			body.position.set(0, 0, -0.016);
			break;
		}
		case 'm67': {
			body.position.set(0, -0.028, -0.030);
			T.add(M, sphere(0.0318, 10, 8), TPC.od);
			T.add(M, xf(tcyl(0.01, 0.0, -0.016, 8), [0, 0.032, 0], [-PI / 2, 0, 0]), TPC.steel);
			T.add(M, xf(tbox(-0.0008, 0.0008, -0.07, 0.0, -0.006, 0.006), [0.033, 0.046, 0], [0, 0, 0.25]), TPC.od);
			T.add(M, xf(torus(0.011, 0.0012, 4, 10), [-0.03, 0.037, 0]), TPC.steel);
			break;
		}
		case 'm32': {
			body.position.set(0, 0.103, -0.095);
			T.add(M, tcyl(0.0735, -0.005, -0.205, 12, 0, -0.047), TPC.dark);
			T.add(M, tbox(-0.025, 0.025, -0.126, 0.041, 0.0, 0.09), TPC.black);
			T.add(M, tbox(-0.017, 0.017, 0.026, 0.05, -0.232, 0.004), TPC.black);
			T.add(M, tbox(-0.03, 0.03, -0.07, 0.034, -0.236, -0.21), TPC.black);
			T.add(M, tcyl(0.0262, -0.236, -0.53, 10), TPC.dark);
			T.add(M, tcyl(0.019, -0.072, -0.124, 8, 0, 0.083), TPC.black);
			T.add(P, xf(tcyl(0.0165, 0.0, -0.099, 8), [0, -0.044, -0.336], [-(PI / 2 - 8 * DEG), 0, 0]), TPC.poly);
			T.add(M, tcyl(0.0146, 0.07, 0.23, 8, 0, -0.004), TPC.black);
			T.add(P, tbox(-0.0175, 0.0175, -0.104, 0.02, 0.155, 0.287), TPC.poly);
			tgrip(T, P, TPC.poly, [0.074, -0.104], 16 * DEG, 0.1, 0.04, 0.03);
			break;
		}
		case 'goldenPunisher': {
			body.position.set(0, 0.099, -0.097);
			T.add(M, tcyl(0.074, 0.0, -0.112, 14, 0, -0.049), TPC.gold);
			T.add(M, tbox(-0.026, 0.026, -0.128, 0.03, 0.0, 0.09), TPC.gold);
			T.add(M, tbox(-0.0145, 0.0145, 0.028, 0.04, -0.13, 0.004), TPC.gold);
			T.add(M, tcyl(0.0196, -0.134, -0.38, 10), TPC.gold);
			T.add(M, tcyl(0.0126, -0.38, -0.45, 8), TPC.gold);
			T.add(M, tbox(-0.004, 0.004, 0.006, 0.018, 0.09, 0.32), TPC.gold);
			T.add(M, xf(tbox(-0.004, 0.004, -0.004, 0.004, 0.0, 0.23), [0, -0.084, 0.094], [-0.13, 0, 0]), TPC.gold);
			T.add(M, tbox(-0.018, 0.018, -0.108, 0.026, 0.312, 0.336), TPC.gold);
			T.add(P, xf(tcyl(0.0162, 0.0, -0.099, 8), [0, -0.032, -0.209], [-(PI / 2 - 10 * DEG), 0, 0]), TPC.poly);
			tgrip(T, P, TPC.poly, [0.074, -0.102], 17 * DEG, 0.1, 0.04, 0.031);
			break;
		}
		case 'chaingun': {
			body.position.set(-0.062, -0.028, -0.076);
			T.add(M, tbox(-0.052, 0.052, -0.05, 0.056, -0.166, 0.008), TPC.dark);
			T.add(M, tcyl(0.051, -0.16, -0.276, 12), TPC.dark);
			for (let i = 0; i < 6; i++) { const a = PI / 6 + i * PI / 3; T.add(M, tcyl(0.0095, -0.276, -0.8, 5, Math.cos(a) * 0.0305, Math.sin(a) * 0.0305), TPC.black); }
			T.add(M, tcyl(0.043, -0.514, -0.526, 12), TPC.dark);
			T.add(M, tcyl(0.0425, -0.74, -0.756, 12), TPC.dark);
			T.add(M, tcyl(0.0245, -0.018, -0.13, 8, 0.04, 0.066), TPC.black);
			T.add(M, tbox(-0.098, -0.05, -0.036, 0.032, -0.178, -0.074), TPC.dark);
			T.add(M, tbox(-0.074, 0.074, 0.03, 0.044, 0.004, 0.08), TPC.dark);
			T.add(P, tcyl(0.016, 0.0, -0.115, 8).rotateX(-PI / 2).translate(0.062, 0.031, 0.076), TPC.poly);
			T.add(P, tcyl(0.016, 0.0, -0.115, 8).rotateX(-PI / 2).translate(-0.062, 0.031, 0.076), TPC.poly);
			T.add(P, xf(tcyl(0.0165, 0.0, -0.1, 8), [0, -0.066, -0.214], [-(PI / 2 - 10 * DEG), 0, 0]), TPC.poly);
			T.add(P, tbox(-0.146, -0.117, -0.4, -0.11, -0.17, -0.08), TPC.od);
			break;
		}
		default: throw new Error('gunModels: unknown weapon id ' + id);
	}
	T.build(body, 'tp_' + id);
	root.updateMatrixWorld(true);
	return root;
}

/* ============================================================================
 * Public API
 * ========================================================================== */
const BUILDERS = {
	m4a1: () => buildM4A1(),
	m4super90: () => buildM4Super90(),
	l96a1: () => buildL96A1(),
	m9: () => buildM9(),
	knife: () => buildKnife(),
	m67: () => buildM67(),
	m32: () => buildM32(),
	goldenPunisher: () => buildGoldenPunisher(),
	chaingun: () => buildChaingun(),
};

export function buildWeaponModel(id) {
	const b = BUILDERS[id];
	if (!b) throw new Error('gunModels: unknown weapon id ' + id);
	rnd = mulberry32(0x5eed + WEAPON_MODEL_IDS.indexOf(id) * 977);
	return b();
}

// geometry kit for procedural weapons built outside this file (player/machete.js): the same builder,
// materials and helpers, so they match the rest of the arsenal. `seed(n)` reseeds the wear noise.
export const gunKit = {
	PB, Acc, lathe, cyl, tube, hull, cbox, loft, prism, rounded, extrude, sweep, sphere, torus, xf, worn, shade,
	handQuat, handTarget, grp, empty, finishWeapon,
	seed: (s) => { rnd = mulberry32(s); },
};
