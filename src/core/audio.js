/**
 * src/core/audio.js — Cabin Fever procedural audio engine.
 *
 * Everything is synthesized; there are no audio files. At init() every sound
 * definition is rendered (several random variations each) into AudioBuffers
 * with OfflineAudioContext graphs plus a small JS DSP toolkit (modal
 * resonators, grain/crackle trains, chirps, stick-slip creak trains, formant
 * voices). At runtime a voice is only a buffer source, a gain stage, an
 * optional air-absorption lowpass and PannerNode, and a send into one shared
 * convolution reverb. That reverb has two generated IRs (a small wooden room
 * and open night air) and setIndoor() crossfades between them.
 *
 * Bus: voices / ambience / reverb → global lowpass (gas, low health) → master
 * gain → gentle compressor → safety limiter → destination.
 */

const TAU = Math.PI * 2;
const MAX_VOICES = 48;
const HRTF_NEAR = 15;
const REF_DIST = 2;
const ROLLOFF = 1.2;
const MAX_DIST = 80;
const PEAK = 0.891; // -1 dBFS

const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const chance = (p) => Math.random() < p;
const expRand = (rate) => -Math.log(1 - Math.random()) / Math.max(1e-6, rate);
const expLerp = (a, b, t) => a * Math.pow(b / a, t);

function lerpPts(pts, x) {
  if (typeof pts === 'number') return pts;
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      return y0 + (y1 - y0) * ((x - x0) / Math.max(1e-9, x1 - x0));
    }
  }
  return pts[pts.length - 1][1];
}

const CURVES = new Map();
function driveCurve(k) {
  const key = Math.max(1, Math.round(k * 10));
  let c = CURVES.get(key);
  if (!c) {
    const n = 2048;
    const kk = key / 10;
    const norm = Math.tanh(kk);
    c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(kk * x) / norm;
    }
    CURVES.set(key, c);
  }
  return c;
}

/** Jittery envelope used for friction/scrape/gurgle textures. */
function grainCurve(dur, rate, rough) {
  const n = Math.max(4, Math.floor(dur * rate));
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    c[i] = Math.pow(Math.sin(Math.PI * x), 0.6) * (1 - rough + rough * Math.random());
  }
  c[0] = 0;
  c[n - 1] = 0;
  return c;
}

/** Voice amplitude envelope with smooth attack/release and organic wobble. */
function envCurve(dur, attack, release, wobble) {
  const n = Math.max(16, Math.ceil(dur * 40));
  const a = new Float32Array(n);
  const af = clamp(attack / dur, 0.01, 0.9);
  const rf = clamp(release / dur, 0.01, 0.95);
  let w = 0;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let e = x < af ? x / af : 1;
    if (x > 1 - rf) e = Math.min(e, (1 - x) / rf);
    e = clamp(e, 0, 1);
    w = w * 0.7 + (Math.random() * 2 - 1) * 0.3;
    a[i] = Math.max(0, e * e * (3 - 2 * e) * (1 + wobble * w));
  }
  a[0] = 0;
  a[n - 1] = 0;
  return a;
}

// Vowel formants: [freq, Q, gain]
const VOW = {
  a: [[800, 5, 1], [1200, 6, 0.7], [2600, 8, 0.3], [3500, 9, 0.15]],
  o: [[450, 5, 1], [800, 6, 0.6], [2500, 8, 0.2], [3400, 9, 0.1]],
  u: [[330, 5, 1], [700, 6, 0.4], [2400, 8, 0.15], [3300, 9, 0.08]],
  e: [[500, 5, 1], [1800, 7, 0.5], [2600, 8, 0.3], [3400, 9, 0.15]],
  ae: [[680, 5, 1], [1650, 7, 0.55], [2500, 8, 0.3], [3400, 9, 0.15]],
  uh: [[600, 5, 1], [1050, 6, 0.6], [2450, 8, 0.25], [3350, 9, 0.12]],
};
const vowel = (k, scale = 1, qs = 1) =>
  VOW[k].map(([f, q, g]) => [f * scale * rnd(0.94, 1.06), q * qs, g]);

// ---------------------------------------------------------------------------
// Shared noise + impulse responses (plain JS, generated once)
// ---------------------------------------------------------------------------

function makeNoise(ctx, seconds) {
  const sr = ctx.sampleRate;
  const n = Math.floor(seconds * sr);
  const X = 2048; // crossfade so looped playback has no seam
  const w = new Float32Array(n + X);
  const p = new Float32Array(n + X);
  const br = new Float32Array(n + X);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < n + X; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    b0 = 0.99886 * b0 + x * 0.0555179;
    b1 = 0.99332 * b1 + x * 0.0750759;
    b2 = 0.969 * b2 + x * 0.153852;
    b3 = 0.8665 * b3 + x * 0.3104856;
    b4 = 0.55 * b4 + x * 0.5329522;
    b5 = -0.7616 * b5 - x * 0.016898;
    p[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + x * 0.5362;
    b6 = x * 0.115926;
    last = (last + 0.02 * x) / 1.02;
    br[i] = last;
  }
  const finish = (src) => {
    for (let k = 0; k < X; k++) {
      const a = k / X;
      src[k] = src[k] * a + src[n + k] * (1 - a);
    }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += src[i];
    mean /= n;
    let peak = 1e-9;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(src[i] - mean));
    const buf = ctx.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const s = 0.95 / peak;
    for (let i = 0; i < n; i++) d[i] = (src[i] - mean) * s;
    return buf;
  };
  return { white: finish(w), pink: finish(p), brown: finish(br) };
}

function makeIR(ctx, o) {
  const sr = ctx.sampleRate;
  const len = Math.floor(o.len * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const tau = o.rt60 / 6.91;
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let k = 0; k < o.er; k++) {
      const tt = o.pre + Math.pow(Math.random(), 1.3) * o.erSpan;
      const idx = Math.floor(tt * sr);
      if (idx + 1 >= len) continue;
      const amp = o.erGain * Math.exp(-tt / (tau * 0.7)) * rnd(0.4, 1) * (chance(0.5) ? -1 : 1);
      d[idx] += amp;
      d[idx + 1] += amp * 0.45;
    }
    const start = Math.floor(o.pre * sr);
    let lp = 0;
    let a = 0;
    for (let i = start; i < len; i++) {
      if (((i - start) & 63) === 0) {
        const x = (i - start) / (len - start);
        const fc = o.lp0 * Math.pow(o.lp1 / o.lp0, x);
        a = 1 - Math.exp((-TAU * fc) / sr);
      }
      const tt = (i - start) / sr;
      const env = Math.exp(-tt / tau) * Math.min(1, tt / o.fade);
      lp += a * (Math.random() * 2 - 1 - lp);
      d[i] += lp * env * o.tail;
    }
    const fo = Math.floor(sr * 0.05);
    for (let k = 0; k < fo; k++) d[len - 1 - k] *= k / fo;
  }
  return buf;
}

// ---------------------------------------------------------------------------
// Offline render builder: node factories + synthesis layers
// ---------------------------------------------------------------------------

class Builder {
  constructor(noise, sr, dur, ch, loopLen) {
    const OAC = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
    this.sr = sr;
    this.dur = dur;
    this.L = loopLen || dur;
    this.len = Math.max(256, Math.ceil(dur * sr));
    this.c = new OAC(ch, this.len, sr);
    this.N = noise;
    this.nyq = sr * 0.45;
    this.out = this.c.createGain();
    this.out.connect(this.c.destination);
    this._tapes = new Map();
  }

  // ---- node factories ------------------------------------------------------
  hz(f) {
    return clamp(f, 10, this.nyq);
  }
  g(v = 1, dest) {
    const n = this.c.createGain();
    n.gain.value = v;
    if (dest) n.connect(dest);
    return n;
  }
  f(type, freq, q, dest) {
    const n = this.c.createBiquadFilter();
    n.type = type;
    n.frequency.value = this.hz(freq);
    if (q != null) n.Q.value = q;
    else if (type === 'lowpass' || type === 'highpass') n.Q.value = 0;
    if (dest) n.connect(dest);
    return n;
  }
  /** Filtered input bus: returns the input node. */
  fbus(type, freq, q, g = 1, dest = this.out) {
    const inp = this.g(1);
    const fl = this.f(type, freq, q);
    inp.connect(fl);
    fl.connect(this.g(g, dest));
    return inp;
  }
  pan(p, dest = this.out) {
    const n = this.c.createStereoPanner();
    n.pan.value = p;
    n.connect(dest);
    return n;
  }
  shaper(k, dest) {
    const s = this.c.createWaveShaper();
    s.curve = driveCurve(k);
    if (dest) s.connect(dest);
    return s;
  }
  noise(kind, t, dur, dest) {
    const s = this.c.createBufferSource();
    const buf = this.N[kind] || this.N.white;
    s.buffer = buf;
    s.loop = true;
    const t0 = Math.max(0, t);
    s.start(t0, Math.random() * buf.duration * 0.9);
    s.stop(t0 + Math.max(0.01, dur));
    if (dest) s.connect(dest);
    return s;
  }
  osc(type, freq, t, dur, dest) {
    const o = this.c.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start(Math.max(0, t));
    o.stop(Math.max(0, t) + Math.max(0.01, dur));
    if (dest) o.connect(dest);
    return o;
  }
  /** Attack / hold / exponential decay (d = time to about -40 dB). */
  ahd(p, t, a, h, d, peak = 1) {
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(peak, t + Math.max(0.0003, a));
    if (h > 0) p.setValueAtTime(peak, t + a + h);
    p.setTargetAtTime(0, t + a + h, Math.max(0.0005, d) / 4.6);
  }
  tape(dest = this.out) {
    let t = this._tapes.get(dest);
    if (!t) {
      t = new Float32Array(this.len);
      this._tapes.set(dest, t);
    }
    return t;
  }
  render() {
    for (const [dest, arr] of this._tapes) {
      const buf = this.c.createBuffer(1, this.len, this.sr);
      buf.getChannelData(0).set(arr);
      const s = this.c.createBufferSource();
      s.buffer = buf;
      s.connect(dest);
      s.start(0);
    }
    this._tapes.clear();
    const c = this.c;
    return new Promise((resolve, reject) => {
      c.oncomplete = (e) => resolve(e.renderedBuffer);
      try {
        const p = c.startRendering();
        if (p && typeof p.then === 'function') p.then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  // ---- node-graph layers ---------------------------------------------------
  /** Filtered noise burst. */
  nb(t, o = {}) {
    const { kind = 'white', type = 'bandpass', f = 1000, q, f2, ft, a = 0.001, h = 0, d = 0.1, g = 1, drive = 0, dest = this.out } = o;
    const total = a + h + d * 1.25 + 0.01;
    const src = this.noise(kind, t, total);
    const flt = this.f(type, f, q);
    if (f2) {
      flt.frequency.setValueAtTime(this.hz(f), t);
      flt.frequency.exponentialRampToValueAtTime(this.hz(f2), t + (ft ?? a + h + d * 0.6));
    }
    const env = this.g(0);
    src.connect(flt);
    flt.connect(env);
    const out = this.g(g, dest);
    if (drive > 0) env.connect(this.shaper(drive, out));
    else env.connect(out);
    this.ahd(env.gain, t, a, h, d, 1);
    return flt;
  }
  /** Pitch-swept oscillator thump. */
  thump(t, o = {}) {
    const { f0 = 150, f1 = 45, sweep = 0.08, a = 0.002, h = 0, d = 0.15, g = 1, type = 'sine', drive = 0, dest = this.out } = o;
    const total = a + h + d * 1.25 + 0.01;
    const os = this.osc(type, f0, t, total);
    os.frequency.setValueAtTime(this.hz(f0), t);
    os.frequency.exponentialRampToValueAtTime(this.hz(Math.max(12, f1)), t + sweep);
    const env = this.g(0);
    os.connect(env);
    const out = this.g(g, dest);
    if (drive > 0) env.connect(this.shaper(drive, out));
    else env.connect(out);
    this.ahd(env.gain, t, a, h, d, 1);
    return os;
  }
  tone(t, freq, o = {}) {
    const { type = 'sine', a = 0.002, h = 0, d = 0.1, g = 1, f2, ft, dest = this.out } = o;
    const os = this.osc(type, this.hz(freq), t, a + h + d * 1.25 + 0.01);
    if (f2) {
      os.frequency.setValueAtTime(this.hz(freq), t);
      os.frequency.exponentialRampToValueAtTime(this.hz(f2), t + (ft ?? a + h + d));
    }
    const env = this.g(0, dest);
    os.connect(env);
    this.ahd(env.gain, t, a, h, d, g);
    return os;
  }
  /** Feedback delay echo tapped from `input`. */
  echo(input, o = {}) {
    const { time = 0.1, fb = 0.25, lp = 2500, wet = 0.25, hp = 120, dest = this.out } = o;
    const d = this.c.createDelay(Math.max(1, time + 0.1));
    d.delayTime.value = time;
    const lpf = this.f('lowpass', lp);
    const hpf = this.f('highpass', hp);
    const fbg = this.g(fb);
    input.connect(d);
    d.connect(lpf);
    lpf.connect(hpf);
    hpf.connect(fbg);
    fbg.connect(d);
    hpf.connect(this.g(wet, dest));
  }
  scrape(t, dur, o = {}) {
    const { f0 = 1800, f1 = 1200, q = 2.5, g = 1, kind = 'white', dest = this.out } = o;
    const src = this.noise(kind, t, dur + 0.02);
    const bp = this.f('bandpass', f0, q);
    bp.frequency.setValueAtTime(this.hz(f0), t);
    bp.frequency.exponentialRampToValueAtTime(this.hz(f1), t + dur);
    const am = this.g(0);
    src.connect(bp);
    bp.connect(am);
    am.connect(this.g(g, dest));
    am.gain.setValueCurveAtTime(grainCurve(dur, 260, 0.55), t, dur);
  }
  cloth(t, dur, o = {}) {
    const { g = 1, f = 1500, q = 0.7, rough = 0.75, dest = this.out } = o;
    const src = this.noise('pink', t, dur + 0.02);
    const hp = this.f('highpass', 350);
    const bp = this.f('bandpass', f, q);
    const am = this.g(0);
    src.connect(hp);
    hp.connect(bp);
    bp.connect(am);
    am.connect(this.g(g, dest));
    const n = Math.max(6, Math.floor(dur * 70));
    const c = new Float32Array(n);
    let w = Math.random();
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      w = w * 0.5 + Math.random() * 0.5;
      c[i] = Math.pow(Math.sin(Math.PI * x), 0.8) * (1 - rough + rough * w * w * 1.6);
    }
    c[0] = 0;
    c[n - 1] = 0;
    am.gain.setValueCurveAtTime(c, t, dur);
  }
  whoosh(t, dur, o = {}) {
    const { f0 = 500, fm = 2500, f1 = 800, q = 2, g = 1, kind = 'white', peak = 0.45, dest = this.out } = o;
    const src = this.noise(kind, t, dur + 0.02);
    const bp = this.f('bandpass', f0, q);
    bp.frequency.setValueAtTime(this.hz(f0), t);
    bp.frequency.exponentialRampToValueAtTime(this.hz(fm), t + dur * peak);
    bp.frequency.exponentialRampToValueAtTime(this.hz(f1), t + dur);
    const env = this.g(0);
    src.connect(bp);
    bp.connect(env);
    env.connect(this.g(g, dest));
    const n = 32;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const e = x < peak ? x / peak : (1 - x) / (1 - peak);
      c[i] = e * e * (3 - 2 * e);
    }
    c[n - 1] = 0;
    env.gain.setValueCurveAtTime(c, t, dur);
  }
  /** Stick-slip friction train into wood-mode resonators. */
  creak(t, dur, o = {}) {
    const { f = 700, g = 1, r0 = 40, r1 = 90, q = 12, dest = this.out } = o;
    const inp = this.g(1);
    const out = this.g(g, dest);
    const modes = [[f, q, 1], [f * 2.31, q * 1.2, 0.55], [f * 3.73, q, 0.3], [f * 0.53, q * 0.8, 0.45]];
    for (const [mf, mq, mg] of modes) {
      if (mf >= this.nyq) continue;
      const bp = this.f('bandpass', mf, mq);
      inp.connect(bp);
      bp.connect(this.g(mg, out));
    }
    const lp = this.f('lowpass', 2200);
    inp.connect(lp);
    lp.connect(this.g(0.12, out));
    const T = this.tape(inp);
    const sr = this.sr;
    let time = t;
    let drift = 0;
    while (time < t + dur) {
      const x = (time - t) / dur;
      drift = drift * 0.85 + (Math.random() * 2 - 1) * 0.15;
      const rate = Math.max(6, (r0 + (r1 - r0) * x) * (1 + drift * 0.8));
      const env = Math.pow(Math.sin(Math.PI * x), 0.6);
      const n = Math.floor(time * sr);
      if (n + 2 >= T.length) break;
      const a = env * (0.55 + 0.45 * Math.random());
      T[n] += a;
      T[n + 1] -= a * 0.6;
      time += 1 / rate;
    }
  }
  /** Wet throat bubbling. */
  gurgle(t, dur, o = {}) {
    const { rate = 30, f0 = 160, f1 = 520, g = 1, dest = this.out } = o;
    const bus = this.fbus('lowpass', 1500, 0, g, dest);
    let time = t;
    while (time < t + dur) {
      const x = (time - t) / dur;
      const e = Math.sin(Math.PI * x);
      const f = rnd(f0, f1);
      this.chirp(time, f, f * rnd(1.3, 2.1), rnd(0.012, 0.045), e * rnd(0.3, 1), bus);
      time += expRand(rate);
    }
    const ns = this.noise('brown', t, dur);
    const bp = this.f('bandpass', rnd(250, 400), 3);
    const am = this.g(0);
    ns.connect(bp);
    bp.connect(am);
    am.connect(this.g(g * 0.8, dest));
    am.gain.setValueCurveAtTime(grainCurve(dur, 30, 0.8), t, dur);
  }
  /**
   * Formant voice: detuned saws (+ optional sub) with jittered pitch, breath
   * noise, vocal-fry AM, drive, a parallel formant bank that can morph,
   * optional ring modulation, and an organic amplitude envelope.
   */
  voice(t, dur, o = {}, dest = this.out) {
    const c = this.c;
    const f0 = o.f0 ?? [[0, 100], [1, 80]];
    const jit = o.jit ?? 0.04;
    const jitRate = o.jitRate ?? 12;
    const end = t + dur;
    const n = Math.max(6, Math.ceil(dur * jitRate)) + 1;
    const cur = new Float32Array(n);
    let w = 0;
    for (let i = 0; i < n; i++) {
      w = w * 0.55 + (Math.random() * 2 - 1) * 0.45;
      cur[i] = Math.max(20, lerpPts(f0, i / (n - 1)) * (1 + jit * w));
    }
    const pre = this.g(1);
    const mk = (type, curve, gain, det) => {
      const os = c.createOscillator();
      os.type = type;
      os.frequency.value = curve[0];
      os.frequency.setValueCurveAtTime(curve, t, dur);
      if (det) os.detune.value = det;
      os.connect(this.g(gain, pre));
      os.start(t);
      os.stop(end + 0.02);
      return os;
    };
    const oscs = [mk(o.wave || 'sawtooth', cur, 0.55, 0), mk('sawtooth', cur, 0.45, o.detune ?? 14)];
    if (o.sub) oscs.push(mk('triangle', cur.map((v) => v * 0.5), o.sub, 0));
    if (o.vib) {
      const [rate, depth] = o.vib;
      const lfo = this.osc('sine', rate, t, dur + 0.02);
      const lg = this.g(lerpPts(f0, 0.5) * depth);
      lfo.connect(lg);
      for (const os of oscs) lg.connect(os.frequency);
    }
    if (o.breath) this.noise('pink', t, dur + 0.02, this.g(o.breath * 2.2, pre));
    let node = pre;
    if (o.fry) {
      const [rate, depth] = o.fry;
      const am = this.g(1 - depth * 0.5);
      node.connect(am);
      const lfo = this.osc('square', rate, t, dur + 0.02);
      const fc = new Float32Array(Math.max(4, Math.ceil(dur * 20)));
      for (let i = 0; i < fc.length; i++) fc[i] = rate * rnd(0.75, 1.3);
      lfo.frequency.setValueCurveAtTime(fc, t, dur);
      lfo.connect(this.g(depth * 0.5)).connect(am.gain);
      node = am;
    }
    if (o.drive) {
      const sh = this.shaper(o.drive);
      node.connect(sh);
      node = sh;
    }
    const sum = this.g(1);
    const F = o.formants || VOW.uh;
    const F2 = o.formants2;
    F.forEach((fm, i) => {
      const bp = this.f('bandpass', fm[0], fm[1]);
      if (F2 && F2[i]) {
        bp.frequency.setValueAtTime(this.hz(fm[0]), t);
        bp.frequency.linearRampToValueAtTime(this.hz(F2[i][0]), end);
      }
      node.connect(bp);
      bp.connect(this.g(fm[2], sum));
    });
    let post = sum;
    if (o.ring) {
      const [rhz, mix] = o.ring;
      const mixOut = this.g(1);
      sum.connect(this.g(1 - mix, mixOut));
      const rm = this.g(0);
      sum.connect(rm);
      this.osc('sine', rhz, t, dur + 0.02).connect(rm.gain);
      rm.connect(this.g(mix * 1.4, mixOut));
      post = mixOut;
    }
    const env = this.g(0);
    post.connect(env);
    env.gain.setValueCurveAtTime(envCurve(dur, o.attack ?? 0.08, o.release ?? 0.25, o.wobble ?? 0.25), t, dur);
    const lp = this.f('lowpass', o.lp ?? 4000);
    const hp = this.f('highpass', o.hp ?? 70);
    env.connect(lp);
    lp.connect(hp);
    hp.connect(this.g(o.g ?? 1, dest));
  }
  /** Brass-like synth note (detuned saws + square, "blat" filter env). */
  brass(t, freq, dur, o = {}) {
    const { g = 1, pan = 0, bright = 1, att = 0.035, rel = 0.25, vib = true, dest = this.out } = o;
    const d0 = pan ? this.pan(pan, dest) : dest;
    const out = this.g(g, d0);
    const env = this.g(0, out);
    const flt = this.f('lowpass', freq, 3, env);
    const stopT = t + dur + rel * 2 + 0.05;
    const oscs = [];
    for (const det of [-6, 5, 0]) {
      const os = this.osc(det === 0 ? 'square' : 'sawtooth', freq, t, stopT - t);
      os.detune.value = det;
      os.connect(this.g(det === 0 ? 0.25 : 0.5, flt));
      oscs.push(os);
    }
    const fp = flt.frequency;
    fp.setValueAtTime(this.hz(freq * 1.1), t);
    fp.linearRampToValueAtTime(this.hz(Math.min(freq * 8 * bright, 9000)), t + att * 1.4);
    fp.setTargetAtTime(this.hz(freq * 4 * bright), t + att * 1.4, 0.12);
    fp.setTargetAtTime(this.hz(freq), t + dur, rel / 3);
    const gp = env.gain;
    gp.setValueAtTime(0, t);
    gp.linearRampToValueAtTime(1, t + att);
    gp.setTargetAtTime(0.78, t + att, 0.1);
    gp.setTargetAtTime(0, t + dur, rel / 4);
    if (vib && dur > 0.35) {
      const lfo = this.osc('sine', 5.3, t + 0.2, stopT - t - 0.2);
      const lg = this.g(0);
      lfo.connect(lg);
      lg.gain.setValueAtTime(0, t + 0.2);
      lg.gain.linearRampToValueAtTime(9, t + 0.6);
      for (const os of oscs) lg.connect(os.detune);
    }
  }
  timp(t, freq, g = 1, dest = this.out) {
    this.thump(t, { f0: freq * 1.15, f1: freq, sweep: 0.06, a: 0.003, d: 1.3, g, dest });
    this.thump(t, { f0: freq * 1.6, f1: freq * 1.5, sweep: 0.05, a: 0.003, d: 0.7, g: g * 0.35, dest });
    this.nb(t, { kind: 'pink', type: 'lowpass', f: 1200, a: 0.001, d: 0.12, g: g * 0.6, dest });
  }

  // ---- JS "tape" layers (written straight into sample arrays) ---------------
  /** Differentiated noise impulse: the sharp transient of every hit. */
  click(t, g = 1, len = 0.0015, dest = this.out) {
    const T = this.tape(dest);
    const n0 = Math.floor(t * this.sr);
    const N = Math.max(3, Math.floor(len * this.sr));
    let prev = 0;
    for (let i = 0; i < N && n0 + i < T.length; i++) {
      const e = 1 - i / N;
      const x = (Math.random() * 2 - 1) * e * e;
      T[n0 + i] += (x - prev) * g;
      prev = x;
    }
  }
  /** Damped sinusoid partials [[freq, amp, T60], ...] (metal, glass, bells). */
  modal(t, partials, g = 1, dest = this.out) {
    const T = this.tape(dest);
    const sr = this.sr;
    const n0 = Math.floor(t * sr);
    if (n0 >= T.length - 2 || n0 < 0) return;
    for (const [fr, amp, dec] of partials) {
      if (fr >= this.nyq || fr <= 0) continue;
      const w = (TAU * fr) / sr;
      const r = Math.exp(-6.9078 / (Math.max(0.002, dec) * sr));
      const k = 2 * r * Math.cos(w);
      const r2 = r * r;
      const A = amp * g;
      const N = Math.min(T.length - n0, Math.ceil(dec * sr));
      let y2 = 0;
      let y1 = A * r * Math.sin(w);
      if (N > 1) T[n0 + 1] += y1;
      for (let i = 2; i < N; i++) {
        const y = k * y1 - r2 * y2;
        T[n0 + i] += y;
        y2 = y1;
        y1 = y;
      }
    }
  }
  /** Exponential sine sweep with decay (drips, bubbles, splats). */
  chirp(t, f0, f1, dur, g = 1, dest = this.out) {
    const T = this.tape(dest);
    const sr = this.sr;
    const n0 = Math.floor(t * sr);
    const N = Math.min(T.length - n0, Math.floor(dur * sr));
    if (N <= 2 || n0 < 0) return;
    let f = Math.min(f0, this.nyq);
    const fm = Math.pow(Math.min(f1, this.nyq) / f, 1 / N);
    const dk = Math.exp(-5 / N);
    const att = Math.max(1, Math.floor(0.0015 * sr));
    let ph = 0;
    let env = g;
    for (let i = 0; i < N; i++) {
      ph += (TAU * f) / sr;
      f *= fm;
      T[n0 + i] += Math.sin(ph) * env * (i < att ? i / att : 1);
      env *= dk;
    }
  }
  /** Poisson impulse train (debris, patter, sparks, bone crunch). */
  crackle(t, dur, rate, g = 1, dest = this.out, o = {}) {
    const T = this.tape(dest);
    const sr = this.sr;
    const w = o.w ?? 2;
    let time = t + expRand(rate);
    while (time < t + dur) {
      const x = (time - t) / dur;
      const env = o.flat ? 1 : Math.pow(1 - x, o.pow ?? 2);
      const n = Math.floor(time * sr);
      if (n >= T.length - w) break;
      const amp = g * env * Math.pow(Math.random(), o.skew ?? 2);
      for (let i = 0; i < w; i++) T[n + i] += amp * (Math.random() * 2 - 1);
      time += expRand(rate * (o.flat ? 1 : 0.3 + 0.7 * env));
    }
  }
  /** Small metallic gear rattle. */
  rattle(t, dur, n, o = {}) {
    const { f = 3000, g = 0.3, dest = this.out } = o;
    for (let k = 0; k < n; k++) {
      const ff = f * rnd(0.7, 1.5);
      this.modal(t + Math.random() * dur, [[ff, 1, rnd(0.015, 0.04)], [ff * rnd(1.4, 2.2), 0.5, 0.02]], g * rnd(0.3, 1), dest);
    }
  }
}

// ---------------------------------------------------------------------------
// Shared mechanical / weapon components
// ---------------------------------------------------------------------------

function clack(b, t, o = {}) {
  const g = o.g ?? 1;
  const f = o.f ?? 1;
  const dec = o.dec ?? 0.05;
  const dest = o.dest || b.out;
  const j = () => rnd(0.96, 1.04);
  b.click(t, 0.6 * g, 0.001, dest);
  b.nb(t, { type: 'bandpass', f: 2600 * f, q: 1.4, a: 0.0004, d: 0.03, g: 0.7 * g, dest });
  b.modal(t, [
    [1650 * f * j(), 0.35, dec],
    [2870 * f * j(), 0.3, dec * 0.8],
    [4330 * f * j(), 0.22, dec * 0.6],
    [6150 * f * j(), 0.14, dec * 0.45],
    [8200 * f * j(), 0.08, dec * 0.3],
  ], g, dest);
  if (o.low !== false) b.thump(t, { f0: 380 * f, f1: 220 * f, sweep: 0.02, a: 0.0008, d: 0.035, g: 0.35 * g, dest });
}

function magOut(b, t, f = 1) {
  b.modal(t, [[2650 * f, 0.3, 0.02], [4150 * f, 0.22, 0.015]], 1);
  b.click(t, 0.35, 0.0008);
  b.scrape(t + 0.018, 0.1, { f0: 1900 * f, f1: 1200 * f, q: 2, g: 0.55 });
  b.thump(t + 0.1, { f0: 320 * f, f1: 210 * f, sweep: 0.02, d: 0.05, g: 0.25 });
  clack(b, t + 0.1, { g: 0.35, f: 0.9 * f, dec: 0.04 });
}

function magIn(b, t, f = 1) {
  b.scrape(t, 0.09, { f0: 1300 * f, f1: 2100 * f, q: 2, g: 0.5 });
  clack(b, t + 0.1, { g: 1, f: 0.85 * f, dec: 0.06 });
  b.thump(t + 0.1, { f0: 190 * f, f1: 110 * f, sweep: 0.03, d: 0.08, g: 0.6 });
  b.modal(t + 0.13, [[3300 * f, 0.25, 0.025], [5200 * f, 0.15, 0.02]], 1);
}

function chargingHandle(b, t, f = 1) {
  clack(b, t, { g: 0.55, f: 1.05 * f, dec: 0.04, low: false });
  b.scrape(t + 0.01, 0.085, { f0: 2100 * f, f1: 2900 * f, q: 3, g: 0.45 });
  clack(b, t + 0.1, { g: 0.55, f: 0.95 * f, dec: 0.05 });
  b.modal(t + 0.1, [[880 * f, 0.08, 0.12]], 1);
  const r = t + rnd(0.22, 0.26);
  b.scrape(r - 0.03, 0.03, { f0: 2600 * f, f1: 1800 * f, q: 2, g: 0.35 });
  clack(b, r, { g: 1.2, f: 0.9 * f, dec: 0.08 });
  b.thump(r, { f0: 260 * f, f1: 140 * f, sweep: 0.03, d: 0.07, g: 0.6 });
  b.modal(r, [[1900 * f, 0.25, 0.1], [4700 * f, 0.15, 0.07]], 1);
}

/** Layered gunshot: click + crack + air + thump (+sub) + driven body + tail + echo + action. */
function gunshot(b, o) {
  const t = 0.002;
  const bus = b.g(1, b.out);
  b.click(t, o.click ?? 1, 0.0018, bus);
  b.nb(t, { type: 'bandpass', f: o.crackF, f2: o.crackF * 0.55, ft: o.crackD, q: o.crackQ ?? 0.8, a: 0.0006, d: o.crackD, g: o.crackG ?? 1, dest: bus });
  b.nb(t, { type: 'highpass', f: o.airF ?? 6000, a: 0.0004, d: o.airD ?? 0.02, g: o.airG ?? 0.4, dest: bus });
  b.thump(t, { f0: o.thF0, f1: o.thF1, sweep: o.thSweep, a: 0.0015, d: o.thD, g: o.thG, drive: o.thDrive ?? 1.5, dest: bus });
  if (o.sub) b.thump(t, { f0: o.sub * 1.4, f1: o.sub * 0.6, sweep: o.thSweep * 2, a: 0.004, d: o.thD * 1.6, g: o.subG ?? 0.6, dest: bus });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: o.bodyF, f2: o.bodyF * 0.6, q: o.bodyQ ?? 0.9, a: 0.001, d: o.bodyD, g: o.bodyG, drive: o.drive ?? 4, dest: bus });
  b.nb(t + 0.004, { kind: 'pink', type: 'lowpass', f: o.tailF, f2: o.tailF * 0.4, ft: o.tailD, a: 0.01, d: o.tailD, g: o.tailG, dest: bus });
  b.echo(bus, { time: o.echoT, fb: o.echoFb ?? 0.25, lp: o.echoLP ?? 2200, wet: o.echoWet ?? 0.25 });
  if (o.echo2) b.echo(bus, o.echo2);
  if (o.mech) clack(b, t + o.mech.t, { ...o.mech, dest: bus });
}

// ---------------------------------------------------------------------------
// Sound definitions
//   d: seconds, v: variations, gain: post-normalize level, rev: reverb send,
//   max: per-name voice cap, jit: random pitch spread, ch: channels,
//   sr: render rate cap, loop/xf: seamless loop crossfade length
// ---------------------------------------------------------------------------

const DEFS = Object.create(null);
function def(name, cfg, fn) {
  DEFS[name] = Object.assign(
    { d: 0.5, v: 4, gain: 0.5, rev: 0.2, max: 6, jit: 0.04, ch: 1, sr: 0, loop: false, xf: 0, xfLinear: false, trim: true, ref: REF_DIST },
    cfg,
    { fn, name },
  );
}

// ===== Weapons ==============================================================

def('m4_fire', { d: 0.6, v: 5, gain: 0.72, rev: 0.3, max: 8, jit: 0.03, ref: 3 }, (b) => gunshot(b, {
  crackF: rnd(2600, 3400), crackQ: 0.8, crackD: 0.045, crackG: 0.9, airG: 0.35, airD: 0.025,
  thF0: rnd(140, 165), thF1: 48, thSweep: 0.07, thD: 0.14, thG: 0.9,
  bodyF: rnd(800, 1000), bodyD: 0.09, bodyG: 0.55, drive: 4,
  tailF: 1400, tailD: 0.35, tailG: 0.22,
  echoT: rnd(0.07, 0.1), echoFb: 0.25, echoLP: 2500, echoWet: 0.25,
  mech: { t: 0.012, g: 0.25, f: rnd(0.95, 1.08), dec: 0.04 },
}));

// full-power LMG: deeper thump and a heavier body than the carbine, short enough for 750 rpm
def('lmg_fire', { d: 0.7, v: 5, gain: 0.8, rev: 0.32, max: 9, jit: 0.03, ref: 3.5 }, (b) => gunshot(b, {
  crackF: rnd(2100, 2700), crackQ: 0.7, crackD: 0.05, crackG: 0.95, airG: 0.4, airD: 0.028,
  thF0: rnd(118, 135), thF1: 40, thSweep: 0.08, thD: 0.18, thG: 1.05, thDrive: 2.2, sub: 58, subG: 0.45,
  bodyF: rnd(620, 780), bodyD: 0.11, bodyG: 0.7, drive: 5,
  tailF: 1150, tailD: 0.45, tailG: 0.25,
  echoT: rnd(0.08, 0.11), echoFb: 0.28, echoLP: 2000, echoWet: 0.27,
  mech: { t: 0.014, g: 0.3, f: rnd(0.8, 0.9), dec: 0.05 },
}));

def('m4_mag_out', { d: 0.35, v: 3, gain: 0.45, rev: 0.1 }, (b) => magOut(b, 0.01, rnd(0.97, 1.03)));
def('m4_mag_in', { d: 0.4, v: 3, gain: 0.48, rev: 0.1 }, (b) => magIn(b, 0.01, rnd(0.97, 1.03)));
def('m4_bolt', { d: 0.5, v: 3, gain: 0.48, rev: 0.1 }, (b) => chargingHandle(b, 0.01, rnd(0.97, 1.03)));
def('m4_reload', { d: 1.85, v: 2, gain: 0.5, rev: 0.1, max: 2 }, (b) => {
  magOut(b, 0.06);
  b.cloth(0.3, 0.3, { g: 0.25, f: 1400 });
  magIn(b, 0.72);
  chargingHandle(b, 1.3);
});

def('shotgun_fire', { d: 1.0, v: 5, gain: 0.85, rev: 0.32, max: 6, jit: 0.03, ref: 4 }, (b) => gunshot(b, {
  crackF: rnd(1600, 2000), crackQ: 0.5, crackD: 0.07, crackG: 1, airG: 0.45, airD: 0.03,
  thF0: rnd(110, 125), thF1: 36, thSweep: 0.12, thD: 0.28, thG: 1.15, thDrive: 2.5, sub: 55, subG: 0.7,
  bodyF: rnd(550, 700), bodyQ: 0.6, bodyD: 0.16, bodyG: 0.85, drive: 6,
  tailF: 1000, tailD: 0.6, tailG: 0.3,
  echoT: rnd(0.1, 0.13), echoFb: 0.3, echoLP: 1600, echoWet: 0.3,
}));

def('shotgun_insert', { d: 0.3, v: 4, gain: 0.45, rev: 0.08 }, (b) => {
  const t = 0.005;
  b.scrape(t, 0.05, { f0: 1100, f1: 800, q: 1.5, g: 0.4, kind: 'pink' });
  const s = t + rnd(0.05, 0.065);
  b.thump(s, { f0: 360, f1: 220, sweep: 0.02, d: 0.05, g: 0.5 });
  clack(b, s, { g: 0.7, f: 0.75, dec: 0.035 });
  b.modal(s + 0.02, [[5200, 0.12, 0.02]], 1);
});

def('shotgun_pump', { d: 0.55, v: 3, gain: 0.52, rev: 0.12, max: 3 }, (b) => {
  const f = rnd(0.95, 1.05);
  clack(b, 0.01, { g: 0.7, f: 0.7 * f, dec: 0.05 });
  b.scrape(0.015, 0.1, { f0: 850 * f, f1: 1300 * f, q: 1.6, g: 0.55 });
  clack(b, 0.12, { g: 0.8, f: 0.62 * f, dec: 0.06 });
  b.thump(0.12, { f0: 210, f1: 140, sweep: 0.03, d: 0.07, g: 0.55 });
  const fw = rnd(0.2, 0.24);
  b.scrape(fw, 0.08, { f0: 1300 * f, f1: 900 * f, q: 1.6, g: 0.5 });
  clack(b, fw + 0.085, { g: 1.1, f: 0.66 * f, dec: 0.08 });
  b.thump(fw + 0.085, { f0: 230, f1: 130, sweep: 0.03, d: 0.08, g: 0.75 });
});

def('sniper_fire', { d: 2.4, v: 3, gain: 1.0, rev: 0.25, max: 3, jit: 0.02, ref: 6 }, (b) => gunshot(b, {
  crackF: rnd(3800, 4600), crackQ: 0.6, crackD: 0.035, crackG: 1.2, airF: 5000, airG: 0.6, airD: 0.03,
  thF0: rnd(125, 140), thF1: 30, thSweep: 0.12, thD: 0.3, thG: 1.2, thDrive: 2, sub: 50, subG: 0.6,
  bodyF: rnd(650, 800), bodyD: 0.12, bodyG: 0.7, drive: 7,
  tailF: 900, tailD: 1.6, tailG: 0.3,
  echoT: rnd(0.3, 0.36), echoFb: 0.38, echoLP: 1100, echoWet: 0.38,
  echo2: { time: rnd(0.5, 0.58), fb: 0.2, lp: 700, wet: 0.22 },
}));

def('sniper_bolt', { d: 1.0, v: 2, gain: 0.55, rev: 0.1, max: 2 }, (b) => {
  const f = rnd(0.95, 1.05);
  clack(b, 0.02, { g: 0.55, f: 1.1 * f, dec: 0.04 });
  b.scrape(0.1, 0.17, { f0: 1500 * f, f1: 2300 * f, q: 2.2, g: 0.5 });
  clack(b, 0.28, { g: 0.7, f: 0.9 * f, dec: 0.06 });
  b.scrape(0.44, 0.14, { f0: 2300 * f, f1: 1500 * f, q: 2.2, g: 0.5 });
  clack(b, 0.59, { g: 0.8, f: 0.85 * f, dec: 0.06 });
  b.thump(0.59, { f0: 230, f1: 140, sweep: 0.03, d: 0.06, g: 0.4 });
  clack(b, 0.74, { g: 1, f: f, dec: 0.09 });
  b.modal(0.74, [[2100 * f, 0.25, 0.12], [5100 * f, 0.12, 0.08]], 1);
});

def('pistol_fire', { d: 0.5, v: 5, gain: 0.6, rev: 0.28, max: 6, jit: 0.035, ref: 2.5 }, (b) => gunshot(b, {
  crackF: rnd(3000, 3600), crackQ: 0.9, crackD: 0.03, crackG: 0.9, airG: 0.35, airD: 0.018,
  thF0: rnd(170, 200), thF1: 60, thSweep: 0.05, thD: 0.09, thG: 0.7,
  bodyF: rnd(1150, 1400), bodyD: 0.06, bodyG: 0.5, drive: 3,
  tailF: 1800, tailD: 0.25, tailG: 0.16,
  echoT: rnd(0.06, 0.085), echoFb: 0.22, echoWet: 0.22,
  mech: { t: 0.014, g: 0.35, f: rnd(1.1, 1.2), dec: 0.04 },
}));

def('pistol_reload', { d: 1.3, v: 2, gain: 0.5, rev: 0.1, max: 2 }, (b) => {
  const f = 1.12;
  magOut(b, 0.06, f);
  b.cloth(0.25, 0.2, { g: 0.25, f: 1500 });
  magIn(b, 0.58, f);
  const r = rnd(0.98, 1.05);
  b.modal(r - 0.02, [[3000, 0.2, 0.015]], 1);
  clack(b, r, { g: 1.2, f: 1.05, dec: 0.08 });
  b.thump(r, { f0: 270, f1: 150, sweep: 0.03, d: 0.06, g: 0.55 });
  b.modal(r, [[2100, 0.2, 0.1], [5200, 0.12, 0.06]], 1);
});

def('knife_swing', { d: 0.38, v: 4, gain: 0.35, rev: 0.08, max: 3, jit: 0.06 }, (b) => {
  const t = 0.005;
  const dur = rnd(0.22, 0.3);
  b.whoosh(t, dur, { f0: rnd(500, 700), fm: rnd(2600, 3400), f1: 900, q: 2.2, g: 1 });
  b.whoosh(t + 0.01, dur * 0.9, { f0: 900, fm: 4500, f1: 1400, q: 7, g: 0.35 });
  b.cloth(t, 0.1, { g: 0.25, f: 1500 });
});

def('knife_hit', { d: 0.4, v: 4, gain: 0.5, rev: 0.12, max: 4 }, (b) => {
  const t = 0.003;
  b.click(t, 0.5, 0.001);
  b.thump(t, { f0: 210, f1: 80, sweep: 0.04, d: 0.09, g: 0.9 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 900, f2: 500, ft: 0.12, q: 1.2, a: 0.001, d: 0.13, g: 0.75, drive: 2 });
  b.nb(t, { type: 'bandpass', f: 2600, q: 0.9, a: 0.0005, d: 0.03, g: 0.45, drive: 4 });
  const w = b.fbus('lowpass', 2000, 0, 0.5);
  for (let k = 0; k < 3; k++) {
    const f = rnd(300, 800);
    b.chirp(t + rnd(0.01, 0.09), f, f * rnd(1.3, 1.9), rnd(0.012, 0.03), rnd(0.4, 1), w);
  }
  b.scrape(t + 0.02, 0.08, { f0: 3000, f1: 1800, q: 1.2, g: 0.2 });
});

// machete (store gear, game/gear.js): a long blade cutting air, deeper than the knife, with a thin
// steel ring as it comes round; the hit is a heavy wet chop with a bone crack and the blade ringing
def('machete_swing', { d: 0.5, v: 4, gain: 0.42, rev: 0.1, max: 3, jit: 0.05 }, (b) => {
  const t = 0.004;
  const dur = rnd(0.26, 0.33);
  b.whoosh(t, dur, { f0: rnd(280, 360), fm: rnd(1500, 1900), f1: 520, q: 1.6, g: 1, kind: 'pink', peak: 0.5 });
  b.whoosh(t + 0.02, dur * 0.85, { f0: 700, fm: rnd(3200, 3800), f1: 1100, q: 5, g: 0.45, peak: 0.55 });
  b.modal(t + dur * 0.35, [[rnd(2350, 2550), 0.05, 0.22], [rnd(3900, 4200), 0.035, 0.16], [rnd(6100, 6500), 0.02, 0.1]], 1);
  b.cloth(t, 0.12, { g: 0.3, f: 1200 });
});

def('machete_hit', { d: 0.55, v: 4, gain: 0.6, rev: 0.14, max: 4 }, (b) => {
  const t = 0.003;
  b.click(t, 0.7, 0.0012);
  b.thump(t, { f0: 170, f1: 60, sweep: 0.05, d: 0.12, g: 1.1, drive: 2 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 750, f2: 380, ft: 0.14, q: 1.1, a: 0.001, d: 0.16, g: 0.9, drive: 2.5 });
  b.nb(t, { type: 'bandpass', f: 2200, q: 0.8, a: 0.0004, d: 0.035, g: 0.55, drive: 4 });
  b.crackle(t + 0.004, 0.05, 0.0025, 0.5, b.out, { w: 3 }); // bone
  const w = b.fbus('lowpass', 1800, 0, 0.55);
  for (let k = 0; k < 4; k++) {
    const f = rnd(250, 700);
    b.chirp(t + rnd(0.01, 0.1), f, f * rnd(1.3, 2), rnd(0.015, 0.035), rnd(0.4, 1), w);
  }
  b.modal(t + 0.01, [[rnd(1750, 1900), 0.06, 0.2], [rnd(2900, 3100), 0.045, 0.14], [rnd(4700, 5000), 0.025, 0.08]], 1); // the blade rings
});

def('dryfire', { d: 0.15, v: 3, gain: 0.45, rev: 0.05, max: 3 }, (b) => {
  const t = 0.002;
  b.click(t, 0.5, 0.0008);
  b.modal(t, [[rnd(3000, 3400), 0.5, 0.02], [rnd(5200, 5700), 0.35, 0.015], [rnd(7600, 8200), 0.2, 0.01]], 1);
  b.thump(t, { f0: 800, f1: 500, sweep: 0.01, d: 0.02, g: 0.2 });
  b.modal(t + rnd(0.02, 0.03), [[4200, 0.2, 0.012], [6600, 0.1, 0.008]], 1);
});

def('weapon_switch', { d: 0.6, v: 3, gain: 0.4, rev: 0.06, max: 2 }, (b) => {
  const t = 0.005;
  b.cloth(t, rnd(0.25, 0.35), { g: 0.7, f: rnd(1300, 2000) });
  clack(b, t + rnd(0.16, 0.24), { g: 0.6, f: rnd(0.85, 1.1), dec: 0.06 });
  b.rattle(t + 0.25, 0.15, 3, { f: 3200, g: 0.15 });
  b.thump(t + 0.2, { f0: 180, f1: 120, sweep: 0.03, d: 0.06, g: 0.3 });
});

def('aim_in', { d: 0.3, v: 3, gain: 0.25, rev: 0.03, max: 2 }, (b) => {
  const t = 0.004;
  b.cloth(t, rnd(0.14, 0.2), { g: 0.6, f: rnd(1800, 2600) });
  b.modal(t + rnd(0.06, 0.1), [[rnd(3800, 4600), 0.18, 0.025], [7000, 0.08, 0.015]], 1);
  b.thump(t + 0.08, { f0: 160, f1: 110, sweep: 0.03, d: 0.05, g: 0.2 });
});

def('grenade_pin', { d: 0.5, v: 2, gain: 0.38, rev: 0.08, max: 2 }, (b) => {
  const t = 0.005;
  b.scrape(t, 0.05, { f0: 4500, f1: 5500, q: 3, g: 0.35 });
  const f = rnd(4300, 4900);
  b.modal(t + 0.045, [[f, 0.5, 0.28], [f * 1.37, 0.3, 0.2], [f * 2.05, 0.15, 0.12]], 1);
  b.click(t + 0.045, 0.4, 0.001);
  b.rattle(t + 0.08, 0.12, 3, { f: 5000, g: 0.12 });
});

def('grenade_throw', { d: 0.42, v: 3, gain: 0.3, rev: 0.08, max: 2 }, (b) => {
  const t = 0.004;
  b.cloth(t, 0.12, { g: 0.4, f: 1200 });
  b.whoosh(t + 0.05, rnd(0.22, 0.3), { f0: 300, fm: 1300, f1: 450, q: 1.3, g: 0.9, kind: 'pink' });
  b.modal(t + 0.08, [[rnd(2500, 2700), 0.2, 0.08], [3900, 0.12, 0.05]], 1); // spoon flies off
});

def('grenade_bounce', { d: 0.35, v: 4, gain: 0.5, rev: 0.2, max: 6 }, (b) => {
  const hit = (t, a) => {
    b.nb(t, { type: 'bandpass', f: rnd(600, 800), q: 3, a: 0.0005, d: 0.05, g: 0.6 * a });
    b.thump(t, { f0: 270, f1: 170, sweep: 0.02, d: 0.06, g: 0.7 * a });
    const f = rnd(1000, 1200);
    b.modal(t, [[f, 0.5, 0.07], [f * 2.14, 0.4, 0.06], [f * 3.35, 0.3, 0.045], [f * 4.8, 0.18, 0.03]], a);
    b.click(t, 0.4 * a, 0.0008);
  };
  hit(0.003, 1);
  if (chance(0.7)) hit(0.003 + rnd(0.1, 0.16), rnd(0.3, 0.45));
});

def('explosion', { d: 2.6, v: 3, gain: 1.0, rev: 0.45, max: 6, jit: 0.05, ref: 10 }, (b) => {
  const t = 0.003;
  const bus = b.g(1, b.out);
  b.click(t, 1, 0.004, bus);
  b.nb(t, { type: 'bandpass', f: 2200, q: 0.5, a: 0.0008, d: 0.14, g: 1, drive: 3, dest: bus });
  b.nb(t, { type: 'highpass', f: 5000, a: 0.0005, d: 0.06, g: 0.5, dest: bus });
  b.thump(t, { f0: rnd(85, 100), f1: 28, sweep: 0.45, a: 0.004, d: 1.1, g: 1.3, drive: 2, dest: bus });
  b.thump(t, { f0: 55, f1: 22, sweep: 0.8, a: 0.01, d: 1.6, g: 0.8, dest: bus });
  b.nb(t, { kind: 'pink', type: 'lowpass', f: 2500, f2: 250, ft: 0.8, a: 0.003, h: 0.04, d: 0.8, g: 1, drive: 7, dest: bus });
  b.nb(t + 0.015, { kind: 'brown', type: 'lowpass', f: 260, a: 0.04, d: 2.0, g: 0.9, dest: bus });
  b.crackle(t + 0.1, 2.0, 110, 0.7, b.fbus('bandpass', 2600, 0.6, 0.55, bus), { pow: 1.6 });
  const chunk = b.fbus('lowpass', 1500, 0, 0.6, bus);
  for (let k = 0; k < 10; k++) {
    const tt = t + rnd(0.25, 1.6);
    const f = rnd(180, 520);
    b.chirp(tt, f, f * 0.6, rnd(0.03, 0.07), rnd(0.2, 0.6) * (1 - (tt - t) / 2), chunk);
  }
  b.nb(t + 0.15, { kind: 'pink', type: 'highpass', f: 2200, a: 0.15, d: 1.1, g: 0.18, dest: bus });
  b.echo(bus, { time: rnd(0.13, 0.18), fb: 0.3, lp: 900, wet: 0.3 });
});

def('m32_fire', { d: 0.7, v: 4, gain: 0.65, rev: 0.28, max: 4, jit: 0.03, ref: 3 }, (b) => {
  const t = 0.002;
  const bus = b.g(1, b.out);
  b.click(t, 0.5, 0.0015, bus);
  b.thump(t, { f0: rnd(240, 280), f1: 85, sweep: 0.06, a: 0.002, d: 0.18, g: 1.2, drive: 1.5, dest: bus });
  b.tone(t, 520, { type: 'triangle', f2: 170, ft: 0.06, a: 0.002, d: 0.1, g: 0.25, dest: bus });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 340, q: 4, a: 0.001, d: 0.14, g: 0.7, dest: bus });
  b.nb(t, { kind: 'pink', type: 'lowpass', f: 450, a: 0.001, d: 0.15, g: 0.6, drive: 2, dest: bus });
  b.nb(t, { type: 'bandpass', f: 1300, q: 0.7, a: 0.0008, d: 0.07, g: 0.4, dest: bus });
  clack(b, t + 0.02, { g: 0.3, f: 0.7, dest: bus });
  b.echo(bus, { time: rnd(0.08, 0.1), fb: 0.22, lp: 1500, wet: 0.2 });
});

def('m32_reload', { d: 2.25, v: 1, gain: 0.5, rev: 0.1, max: 1 }, (b) => {
  clack(b, 0.05, { g: 0.8, f: 0.6, dec: 0.08 });
  b.modal(0.05, [[1150, 0.25, 0.15], [2300, 0.12, 0.1]], 1);
  for (let k = 0; k < 6; k++) {
    const tt = 0.25 + rnd(0, 0.25);
    const f = rnd(1400, 1800);
    b.modal(tt, [[f, 0.25, 0.08], [f * 2.6, 0.15, 0.05]], rnd(0.4, 1));
    b.thump(tt, { f0: 400, f1: 300, sweep: 0.01, d: 0.03, g: 0.1 });
  }
  for (let k = 0; k < 6; k++) {
    const tt = 0.75 + k * 0.14 + rnd(-0.015, 0.015);
    b.scrape(tt - 0.04, 0.04, { f0: 1100, f1: 1500, q: 2, g: 0.25 });
    b.thump(tt, { f0: 300, f1: 200, sweep: 0.02, d: 0.04, g: 0.35 });
    clack(b, tt, { g: 0.35, f: 0.7, dec: 0.03, low: false });
  }
  for (let k = 0; k < 7; k++) {
    const tt = 1.66 + k * 0.028;
    b.modal(tt, [[3100, 0.18, 0.012], [5200, 0.1, 0.008]], 1);
    b.click(tt, 0.15, 0.0005);
  }
  clack(b, 1.98, { g: 1.1, f: 0.55, dec: 0.09 });
  b.thump(1.98, { f0: 190, f1: 100, sweep: 0.03, d: 0.09, g: 0.7 });
});

def('minigun_spinup', { d: 0.72, v: 2, gain: 0.45, rev: 0.15, max: 2, jit: 0.02, ref: 3 }, (b) => {
  const t = 0.005;
  const dur = 0.62;
  const w = b.osc('sawtooth', 180, t, dur + 0.06);
  w.frequency.setValueAtTime(180, t);
  w.frequency.exponentialRampToValueAtTime(1150, t + dur);
  const bp = b.f('bandpass', 400, 2.5);
  bp.frequency.setValueAtTime(400, t);
  bp.frequency.exponentialRampToValueAtTime(2300, t + dur);
  const env = b.g(0, b.out);
  w.connect(bp);
  bp.connect(env);
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(0.25, t + 0.1);
  env.gain.linearRampToValueAtTime(0.5, t + dur);
  env.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  const m = b.osc('square', 45, t, dur + 0.06);
  m.frequency.setValueAtTime(45, t);
  m.frequency.exponentialRampToValueAtTime(125, t + dur);
  const mlp = b.f('lowpass', 600);
  const menv = b.g(0, b.out);
  m.connect(mlp);
  mlp.connect(menv);
  menv.gain.setValueAtTime(0, t);
  menv.gain.linearRampToValueAtTime(0.35, t + dur);
  menv.gain.linearRampToValueAtTime(0, t + dur + 0.05);
  const rb = b.fbus('bandpass', 3000, 0.9, 0.8);
  let tt = t;
  while (tt < t + dur) {
    const x = (tt - t) / dur;
    b.click(tt, 0.3 + 0.7 * x, 0.002, rb);
    tt += 1 / (8 + 60 * x * x);
  }
  clack(b, t, { g: 0.5, f: 0.8 });
});

def('minigun_spindown', { d: 1.1, v: 2, gain: 0.45, rev: 0.15, max: 2, jit: 0.02, ref: 3 }, (b) => {
  const t = 0.003;
  const dur = 1.0;
  const w = b.osc('sawtooth', 1150, t, dur + 0.02);
  w.frequency.setValueAtTime(1150, t);
  w.frequency.exponentialRampToValueAtTime(120, t + dur);
  const bp = b.f('bandpass', 2300, 2.5);
  bp.frequency.setValueAtTime(2300, t);
  bp.frequency.exponentialRampToValueAtTime(300, t + dur);
  const env = b.g(0, b.out);
  w.connect(bp);
  bp.connect(env);
  env.gain.setValueAtTime(0.5, t);
  env.gain.setTargetAtTime(0, t, dur / 3.5);
  const m = b.osc('square', 125, t, dur + 0.02);
  m.frequency.setValueAtTime(125, t);
  m.frequency.exponentialRampToValueAtTime(30, t + dur);
  const mlp = b.f('lowpass', 600);
  const menv = b.g(0, b.out);
  m.connect(mlp);
  mlp.connect(menv);
  menv.gain.setValueAtTime(0.35, t);
  menv.gain.setTargetAtTime(0, t, dur / 3);
  const rb = b.fbus('bandpass', 3000, 0.9, 0.8);
  let tt = t;
  while (tt < t + dur) {
    const x = (tt - t) / dur;
    b.click(tt, Math.pow(1 - x, 1.5), 0.002, rb);
    tt += 1 / (68 * Math.pow(1 - x, 2) + 5);
  }
});

def('minigun_fire', { d: 0.96, xf: 0.08, xfLinear: true, loop: true, v: 1, gain: 0.65, rev: 0.3, max: 2, jit: 0, ref: 4 }, (b) => {
  const T = b.dur;
  const L = b.L;
  const per = L / 48; // 20 ms = 3000 rpm
  const jit = Array.from({ length: 48 }, () => rnd(-0.0015, 0.0015));
  const amps = Array.from({ length: 48 }, () => rnd(0.75, 1));
  const ex = b.g(1);
  const low = b.g(1, b.out);
  for (let k = 0; ; k++) {
    const t = 0.002 + k * per + jit[k % 48];
    if (t >= T - 0.01) break;
    const a = amps[k % 48];
    b.click(t, a, 0.0025, ex);
    b.chirp(t, 150, 55, 0.018, 0.9 * a, low);
  }
  ex.connect(b.f('bandpass', 2600, 0.8, b.g(1.3, b.out)));
  const pre = b.g(6);
  ex.connect(b.f('lowpass', 900, 0, pre));
  pre.connect(b.shaper(4, b.g(0.5, b.out)));
  ex.connect(b.g(0.35, b.out));
  b.echo(ex, { time: 0.013, fb: 0.3, lp: 1800, wet: 0.35 });
  const wf = Math.round(1150 * L) / L;
  b.osc('sawtooth', wf, 0, T).connect(b.f('bandpass', 2300, 3, b.g(0.05, b.out)));
  const mf = Math.round(125 * L) / L;
  b.osc('square', mf, 0, T).connect(b.f('lowpass', 500, 0, b.g(0.1, b.out)));
  b.nb(0, { type: 'bandpass', f: 5000, q: 0.8, a: 0.001, h: T, d: 0.01, g: 0.12 });
});

def('shell_casing', { d: 0.6, v: 6, gain: 0.2, rev: 0.1, max: 8, jit: 0.05 }, (b) => {
  const f = rnd(2900, 3700);
  const ratios = [1, 2.76, 5.4, 8.93];
  const amps = [0.5, 0.35, 0.2, 0.12];
  const decs = [0.14, 0.09, 0.05, 0.03];
  let t = 0.003;
  let dt = rnd(0.08, 0.13);
  let a = 1;
  for (let k = 0; k < 5 && t < 0.5; k++) {
    b.modal(t, ratios.map((r, j) => [f * r * rnd(0.99, 1.01), amps[j], decs[j] * (k === 0 ? 1 : 0.8)]), a);
    b.nb(t, { type: 'bandpass', f: 900, q: 3, a: 0.0005, d: 0.015, g: 0.25 * a });
    t += dt;
    dt *= rnd(0.5, 0.7);
    a *= rnd(0.4, 0.6);
  }
});

def('shotgun_shell_drop', { d: 0.45, v: 4, gain: 0.22, rev: 0.1, max: 6, jit: 0.05 }, (b) => {
  let t = 0.003;
  let a = 1;
  for (let k = 0; k < 3; k++) {
    b.thump(t, { f0: 330, f1: 210, sweep: 0.015, d: 0.05, g: 0.8 * a });
    b.nb(t, { kind: 'pink', type: 'bandpass', f: 950, q: 2, a: 0.0005, d: 0.04, g: 0.5 * a });
    b.modal(t, [[2400 * rnd(0.95, 1.05), 0.18, 0.03], [5100, 0.1, 0.02]], a);
    t += rnd(0.08, 0.13) * (k === 0 ? 1 : 0.6);
    a *= rnd(0.35, 0.5);
  }
});

// an empty magazine hitting the floor (fx/magDrops.js): a hollow steel-and-polymer clack, a skip, a rattle
def('mag_drop', { d: 0.5, v: 4, gain: 0.3, rev: 0.12, max: 4, jit: 0.06 }, (b) => {
  let t = 0.003;
  let a = 1;
  for (let k = 0; k < 3; k++) {
    b.thump(t, { f0: 250, f1: 140, sweep: 0.02, d: 0.05, g: 0.9 * a });
    clack(b, t, { g: 0.7 * a, f: rnd(0.72, 0.86), dec: 0.035, low: false });
    b.modal(t, [[1500 * rnd(0.94, 1.06), 0.22, 0.06], [3700 * rnd(0.95, 1.05), 0.12, 0.035]], a);
    t += rnd(0.07, 0.11) * (k === 0 ? 1 : 0.55);
    a *= rnd(0.3, 0.45);
  }
});

// pistol slide slamming home off the slide stop (akimbo reloads, player/akimbo.js)
def('pistol_slide', { d: 0.3, v: 3, gain: 0.45, rev: 0.1, max: 3 }, (b) => {
  const r = 0.02;
  b.modal(r - 0.012, [[3000, 0.2, 0.015]], 1);
  clack(b, r, { g: 1.2, f: rnd(1.02, 1.08), dec: 0.08 });
  b.thump(r, { f0: 270, f1: 150, sweep: 0.03, d: 0.06, g: 0.55 });
  b.modal(r, [[2100, 0.2, 0.1], [5200, 0.12, 0.06]], 1);
});

// ===== Impacts ==============================================================

def('impact_wood', { d: 0.4, v: 4, gain: 0.5, rev: 0.2, max: 8, jit: 0.06 }, (b) => {
  const t = 0.002;
  b.click(t, 0.7, 0.0015);
  b.nb(t, { type: 'bandpass', f: rnd(1800, 2500), q: 0.9, a: 0.0005, d: 0.03, g: 0.6 });
  b.nb(t, { type: 'bandpass', f: rnd(420, 650), q: 8, a: 0.0008, d: 0.09, g: 0.9 });
  b.nb(t, { type: 'bandpass', f: rnd(1100, 1500), q: 10, a: 0.0008, d: 0.05, g: 0.45 });
  b.thump(t, { f0: 230, f1: 120, sweep: 0.02, d: 0.05, g: 0.5 });
  b.crackle(t + 0.003, 0.12, 400, 0.5, b.fbus('highpass', 2500, 0, 0.5));
  for (let k = 0; k < 3; k++) b.nb(t + rnd(0.05, 0.2), { type: 'bandpass', f: rnd(1500, 3000), q: 4, a: 0.0005, d: 0.015, g: 0.15 });
});

def('impact_concrete', { d: 0.35, v: 4, gain: 0.5, rev: 0.2, max: 8, jit: 0.06 }, (b) => {
  const t = 0.002;
  b.click(t, 0.8, 0.0012);
  b.nb(t, { type: 'highpass', f: 1800, a: 0.0005, d: 0.025, g: 0.9 });
  b.nb(t, { type: 'bandpass', f: 3500, q: 0.7, a: 0.0005, d: 0.05, g: 0.5, drive: 3 });
  b.thump(t, { f0: 160, f1: 80, sweep: 0.02, d: 0.05, g: 0.5 });
  b.crackle(t + 0.01, 0.28, 200, 0.5, b.fbus('bandpass', 4000, 0.5, 0.45));
  b.nb(t + 0.01, { kind: 'pink', type: 'highpass', f: 3000, a: 0.01, d: 0.2, g: 0.15 });
});

def('impact_metal', { d: 0.8, v: 4, gain: 0.45, rev: 0.22, max: 6, jit: 0.05 }, (b, i) => {
  const t = 0.002;
  b.click(t, 0.9, 0.0012);
  const f = rnd(1300, 1900);
  b.modal(t, [[f, 0.5, 0.35], [f * 2.32, 0.4, 0.25], [f * 3.87, 0.3, 0.18], [f * 5.3, 0.2, 0.12], [f * 6.9, 0.12, 0.08]], 1);
  b.nb(t, { type: 'bandpass', f: 3500, q: 1, a: 0.0005, d: 0.04, g: 0.6 });
  if (i !== 3) {
    const t2 = t + rnd(0.01, 0.04);
    const dur = rnd(0.28, 0.45);
    const f0 = rnd(3000, 4200);
    const f1 = f0 * rnd(0.45, 0.6);
    const os = b.osc('sine', f0, t2, dur + 0.05);
    os.frequency.setValueAtTime(f0, t2);
    os.frequency.exponentialRampToValueAtTime(f1, t2 + dur);
    const lfo = b.osc('sine', rnd(18, 30), t2, dur + 0.05);
    lfo.connect(b.g(f0 * 0.015)).connect(os.frequency);
    const env = b.g(0, b.out);
    os.connect(env);
    env.gain.setValueAtTime(0, t2);
    env.gain.linearRampToValueAtTime(0.45, t2 + 0.012);
    env.gain.setTargetAtTime(0, t2 + 0.03, dur / 3.5);
    b.nb(t2, { type: 'bandpass', f: f0, f2: f1, ft: dur, q: 8, a: 0.01, d: dur, g: 0.35 });
  }
});

// armored glass taking a round: a hard tick, a short high ring, glittering splinters (it doesn't shatter)
def('impact_glass', { d: 0.6, v: 4, gain: 0.5, rev: 0.25, max: 6, jit: 0.05 }, (b) => {
  const t = 0.002;
  b.click(t, 1, 0.001);
  b.nb(t, { type: 'highpass', f: 3000, a: 0.0004, d: 0.03, g: 0.8 });
  b.thump(t, { f0: 420, f1: 260, sweep: 0.015, d: 0.05, g: 0.35 });
  const f = rnd(2300, 2900);
  b.modal(t, [[f, 0.35, 0.22], [f * 1.63, 0.3, 0.16], [f * 2.71, 0.22, 0.1], [f * 4.1, 0.14, 0.06]], 1);
  let tt = t + 0.01;
  while (tt < 0.32) {
    const fr = rnd(4500, 9500);
    b.modal(tt, [[fr, 0.5, rnd(0.02, 0.06)]], rnd(0.1, 0.35) * (1 - tt / 0.35));
    tt += expRand(45);
  }
});

def('impact_flesh', { d: 0.35, v: 5, gain: 0.45, rev: 0.1, max: 8, jit: 0.06 }, (b) => {
  const t = 0.002;
  b.click(t, 0.3, 0.001);
  b.thump(t, { f0: rnd(160, 200), f1: 60, sweep: 0.035, d: 0.08, g: 1 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: rnd(600, 800), q: 1, a: 0.001, d: 0.09, g: 0.8, drive: 2.5 });
  b.nb(t + 0.004, { type: 'bandpass', f: 1500, f2: 550, ft: 0.1, q: 3, a: 0.002, d: 0.12, g: 0.35 });
  const w = b.fbus('lowpass', 2200, 0, 0.5);
  for (let k = 0; k < 3; k++) {
    const f = rnd(280, 800);
    b.chirp(t + rnd(0.005, 0.07), f, f * rnd(1.3, 2), rnd(0.01, 0.03), rnd(0.4, 1), w);
  }
});

def('impact_mud', { d: 0.4, v: 4, gain: 0.35, rev: 0.12, max: 8, jit: 0.06 }, (b) => {
  const t = 0.002;
  b.nb(t, { kind: 'pink', type: 'lowpass', f: 600, a: 0.002, d: 0.12, g: 0.9 });
  b.nb(t, { type: 'bandpass', f: 280, f2: 800, ft: 0.12, q: 6, a: 0.005, d: 0.15, g: 0.5 });
  b.thump(t, { f0: 120, f1: 60, sweep: 0.04, d: 0.07, g: 0.5 });
  b.nb(t, { type: 'bandpass', f: 1800, q: 0.8, a: 0.0006, d: 0.02, g: 0.3 });
  const w = b.fbus('lowpass', 3000, 0, 0.4);
  for (let k = 0; k < 5; k++) {
    const f = rnd(600, 1400);
    b.chirp(t + rnd(0.03, 0.25), f, f * rnd(1.2, 1.7), rnd(0.008, 0.02), rnd(0.2, 0.7), w);
  }
});

def('headshot', { d: 0.5, v: 4, gain: 0.6, rev: 0.12, max: 4, jit: 0.03 }, (b) => {
  const t = 0.002;
  b.click(t, 0.8, 0.0015);
  b.nb(t, { type: 'bandpass', f: rnd(1900, 2500), q: 0.8, a: 0.0005, d: 0.04, g: 0.8, drive: 5 });
  b.crackle(t, 0.035, 2500, 0.7, b.fbus('highpass', 1800, 0, 0.6));
  b.thump(t, { f0: 230, f1: 70, sweep: 0.03, d: 0.08, g: 0.9 });
  b.nb(t + 0.003, { kind: 'pink', type: 'bandpass', f: 800, q: 1.2, a: 0.001, d: 0.12, g: 0.7, drive: 2 });
  const w = b.fbus('lowpass', 2500, 0, 0.45);
  for (let k = 0; k < 4; k++) {
    const f = rnd(300, 900);
    b.chirp(t + rnd(0.005, 0.08), f, f * rnd(1.3, 2), rnd(0.01, 0.03), rnd(0.3, 1), w);
  }
  const f = rnd(3900, 4400);
  b.modal(t + 0.006, [[f, 0.9, 0.38], [f * 2.02, 0.3, 0.25], [f * 2.76, 0.18, 0.16], [f * 0.5, 0.15, 0.2]], 1);
});

// crisp, dry hit tick: hard transient, short bright ping, a tiny wooden "tock" under it
def('hitmarker', { d: 0.08, v: 3, gain: 0.55, rev: 0, max: 4, jit: 0.015 }, (b) => {
  const t = 0.001;
  const f = rnd(3050, 3350);
  b.click(t, 0.7, 0.0007);
  b.modal(t, [[f, 0.7, 0.026], [f * 1.97, 0.22, 0.014], [f * 0.53, 0.3, 0.02]], 1);
  b.thump(t, { f0: 540, f1: 300, sweep: 0.012, a: 0.0005, d: 0.018, g: 0.35 });
  b.nb(t, { type: 'highpass', f: 5500, a: 0.0003, d: 0.008, g: 0.25 });
});

// meaty kill confirm: a punchy low thwack and crunch under a bright two-note ping
def('killconfirm', { d: 0.3, v: 3, gain: 0.5, rev: 0.03, max: 3, jit: 0.012 }, (b) => {
  const t = 0.001;
  b.click(t, 0.7, 0.0012);
  b.thump(t, { f0: 210, f1: 62, sweep: 0.05, a: 0.001, d: 0.11, g: 1, drive: 1.5 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: rnd(900, 1150), q: 1.1, a: 0.0008, d: 0.045, g: 0.55, drive: 3 });
  b.modal(t + 0.002, [[1850, 0.55, 0.085], [2780, 0.42, 0.1], [5550, 0.18, 0.05]], 1);
  b.modal(t + 0.042, [[3700, 0.5, 0.1], [5560, 0.22, 0.06]], 1);
});

// ===== Player ===============================================================

def('footstep_wood', { d: 0.55, v: 6, gain: 0.26, rev: 0.15, max: 4, jit: 0.05 }, (b, i) => {
  const t = 0.004;
  const bf = rnd(0.9, 1.15);
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 1400, q: 0.8, a: 0.006, d: 0.05, g: 0.25 });
  b.thump(t + 0.006, { f0: 115 * bf, f1: 68 * bf, sweep: 0.04, a: 0.002, d: 0.09, g: 0.8 });
  b.nb(t + 0.006, { type: 'bandpass', f: rnd(170, 230), q: 6, a: 0.001, d: 0.14, g: 0.8 });
  b.nb(t + 0.006, { type: 'bandpass', f: rnd(380, 520), q: 9, a: 0.001, d: 0.08, g: 0.45 });
  b.nb(t + 0.006, { type: 'bandpass', f: rnd(1800, 2600), q: 1.2, a: 0.0006, d: 0.02, g: 0.42 });
  const toe = t + rnd(0.045, 0.07);
  b.thump(toe, { f0: 150 * bf, f1: 90 * bf, sweep: 0.03, d: 0.06, g: 0.35 });
  b.nb(toe, { type: 'bandpass', f: rnd(250, 330), q: 7, a: 0.001, d: 0.06, g: 0.3 });
  if (i % 2 === 0 || chance(0.25)) {
    b.creak(t + rnd(0.03, 0.09), rnd(0.14, 0.3), { f: rnd(650, 1150), g: rnd(0.25, 0.45), r0: rnd(35, 60), r1: rnd(60, 120) });
  }
});

def('footstep_mud', { d: 0.45, v: 5, gain: 0.24, rev: 0.08, max: 4, jit: 0.05 }, (b) => {
  const t = 0.004;
  b.thump(t, { f0: 95, f1: 55, sweep: 0.05, d: 0.08, g: 0.6 });
  b.nb(t, { kind: 'pink', type: 'lowpass', f: 550, a: 0.006, d: 0.13, g: 0.8 });
  b.nb(t + 0.01, { type: 'bandpass', f: rnd(260, 340), f2: rnd(600, 800), ft: 0.12, q: 5, a: 0.02, d: 0.14, g: 0.5 });
  const pop = t + rnd(0.12, 0.2);
  b.chirp(pop, rnd(220, 300), rnd(550, 800), 0.035, 0.35);
  for (let k = 0; k < 3; k++) {
    const f = rnd(500, 1100);
    b.chirp(t + rnd(0.02, 0.18), f, f * 1.5, rnd(0.01, 0.025), rnd(0.08, 0.2));
  }
});

def('footstep_concrete', { d: 0.3, v: 6, gain: 0.3, rev: 0.12, max: 4, jit: 0.05 }, (b) => {
  const t = 0.003;
  b.nb(t, { type: 'bandpass', f: rnd(2000, 2800), q: 1.3, a: 0.0005, d: 0.03, g: 0.7 });
  b.nb(t, { type: 'highpass', f: 4500, a: 0.002, d: 0.05, g: 0.3 });
  b.thump(t, { f0: 120, f1: 75, sweep: 0.03, d: 0.055, g: 0.5 });
  b.crackle(t, 0.06, 450, 0.5, b.fbus('highpass', 2500, 0, 0.5));
  const toe = t + rnd(0.035, 0.055);
  b.nb(toe, { type: 'bandpass', f: rnd(1500, 2200), q: 1.5, a: 0.0005, d: 0.025, g: 0.35 });
});

def('jump', { d: 0.4, v: 3, gain: 0.25, rev: 0.06, max: 2 }, (b) => {
  const t = 0.004;
  b.nb(t, { kind: 'pink', type: 'bandpass', f: rnd(800, 1100), q: 1, a: 0.01, d: 0.06, g: 0.3 });
  b.thump(t, { f0: 110, f1: 70, sweep: 0.03, d: 0.05, g: 0.4 });
  b.cloth(t + 0.01, rnd(0.2, 0.28), { g: 0.6, f: 1200 });
  b.rattle(t + 0.03, 0.15, 4, { f: 2600, g: 0.15 });
  b.nb(t + 0.02, { kind: 'pink', type: 'bandpass', f: 1150, q: 2.2, a: 0.02, d: 0.16, g: 0.22 });
});

def('land', { d: 0.45, v: 3, gain: 0.35, rev: 0.1, max: 2 }, (b) => {
  const t = 0.004;
  b.thump(t, { f0: 105, f1: 45, sweep: 0.06, a: 0.002, d: 0.16, g: 1, drive: 1.5 });
  b.nb(t, { kind: 'brown', type: 'lowpass', f: 450, a: 0.002, d: 0.15, g: 0.8 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 1300, q: 0.9, a: 0.002, d: 0.08, g: 0.35 });
  b.rattle(t + 0.01, 0.12, 6, { f: 2800, g: 0.2 });
  b.cloth(t, 0.15, { g: 0.35, f: 1100 });
});

// a hand / boot on a wooden ladder rung (src/actors/ladders.js): dull knock, a creak now and then, cloth
def('ladder_step', { d: 0.45, v: 6, gain: 0.3, rev: 0.12, max: 4, jit: 0.06 }, (b, i) => {
  const t = 0.004;
  b.thump(t, { f0: rnd(170, 230), f1: 105, sweep: 0.03, a: 0.001, d: 0.06, g: 0.75 });
  b.nb(t, { type: 'bandpass', f: rnd(650, 950), q: 5, a: 0.0008, d: 0.05, g: 0.5 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 2200, q: 1, a: 0.001, d: 0.02, g: 0.25 });
  if (i % 2 === 0 || chance(0.4)) b.creak(t + rnd(0.02, 0.06), rnd(0.12, 0.25), { f: rnd(500, 900), g: rnd(0.2, 0.35), r0: rnd(30, 50), r1: rnd(50, 90) });
  b.cloth(t + 0.01, 0.12, { g: 0.25, f: 1200 });
});

def('player_hurt', { d: 0.65, v: 4, gain: 0.5, rev: 0.08, max: 2 }, (b) => {
  const t = 0.004;
  b.thump(t, { f0: 130, f1: 55, sweep: 0.05, d: 0.12, g: 0.9, drive: 2 });
  b.nb(t, { kind: 'pink', type: 'lowpass', f: 600, a: 0.002, d: 0.1, g: 0.6 });
  b.nb(t, { type: 'bandpass', f: 1800, q: 0.8, a: 0.0008, d: 0.03, g: 0.35 });
  const f = rnd(115, 150);
  const vt = t + rnd(0.01, 0.03);
  const vd = rnd(0.2, 0.32);
  b.voice(vt, vd, {
    f0: [[0, f * 1.15], [0.3, f * 1.05], [1, f * 0.78]], jit: 0.06, jitRate: 30,
    formants: vowel(chance(0.5) ? 'uh' : 'ae'), formants2: vowel('uh', 0.95),
    breath: 0.5, fry: [rnd(60, 80), 0.35], drive: 3, attack: 0.015, release: 0.12, lp: 2600, g: 0.8,
  });
  b.nb(vt + vd, { kind: 'pink', type: 'bandpass', f: 1200, q: 1.8, a: 0.03, d: 0.18, g: 0.22 });
});

def('heartbeat', { d: 0.86, v: 1, gain: 0.55, rev: 0, max: 2, jit: 0, loop: true, sr: 24000 }, (b) => {
  const beat = (t, f, g) => {
    b.thump(t, { f0: f * 1.25, f1: f * 0.8, sweep: 0.06, a: 0.008, d: 0.16, g });
    b.nb(t, { kind: 'brown', type: 'lowpass', f: 140, a: 0.01, d: 0.12, g: g * 0.6 });
    b.tone(t, f * 2.1, { a: 0.006, d: 0.06, g: g * 0.12 });
  };
  beat(0.01, 55, 1);
  beat(0.29, 64, 0.7);
});

def('gas_cough', { d: 1.25, v: 3, gain: 0.45, rev: 0.12, max: 2, jit: 0.04 }, (b) => {
  let t = 0.01;
  const n = chance(0.5) ? 3 : 2;
  for (let k = 0; k < n; k++) {
    const a = k === 0 ? 1 : rnd(0.55, 0.8);
    const f = rnd(160, 210);
    b.thump(t, { f0: 160, f1: 90, sweep: 0.03, d: 0.05, g: 0.35 * a });
    b.nb(t, { type: 'bandpass', f: rnd(900, 1300), f2: 700, q: 1.1, a: 0.006, d: rnd(0.14, 0.2), g: 0.7 * a, drive: 3 });
    b.nb(t, { kind: 'pink', type: 'lowpass', f: 800, a: 0.004, d: 0.12, g: 0.5 * a });
    b.voice(t + 0.004, rnd(0.09, 0.14), {
      f0: [[0, f * 1.1], [1, f * 0.85]], jit: 0.15, jitRate: 60, formants: vowel('uh', 1.05),
      breath: 1.2, fry: [rnd(60, 90), 0.6], drive: 6, attack: 0.008, release: 0.06, lp: 4000, g: 0.45 * a, wobble: 0.5,
    });
    t += rnd(0.2, 0.3);
  }
  b.nb(t + 0.05, { kind: 'pink', type: 'bandpass', f: 1900, f2: 2400, q: 3, a: 0.12, d: 0.12, g: 0.22 });
});

def('breath_heavy', { d: 1.8, v: 2, gain: 0.3, rev: 0.05, max: 2, jit: 0.03, trim: false }, (b) => {
  const i0 = 0.02;
  b.nb(i0, { kind: 'pink', type: 'bandpass', f: 1500, f2: 2100, ft: 0.5, q: 1.6, a: 0.42, d: 0.16, g: 0.55 });
  b.nb(i0, { type: 'bandpass', f: 3600, q: 1.2, a: 0.4, d: 0.14, g: 0.16 });
  const e0 = rnd(0.72, 0.8);
  b.nb(e0, { kind: 'pink', type: 'bandpass', f: 1100, f2: 750, ft: 0.6, q: 1.4, a: 0.07, h: 0.1, d: 0.55, g: 0.7 });
  b.nb(e0, { kind: 'pink', type: 'lowpass', f: 450, a: 0.06, d: 0.45, g: 0.3 });
});

def('flashlight', { d: 0.12, v: 2, gain: 0.4, rev: 0.02, max: 2, jit: 0.02 }, (b) => {
  const t = 0.002;
  b.click(t, 0.6, 0.0006);
  b.modal(t, [[rnd(3300, 3700), 0.5, 0.014], [rnd(5800, 6400), 0.3, 0.01]], 1);
  b.thump(t, { f0: 950, f1: 600, sweep: 0.008, d: 0.012, g: 0.25 });
  b.modal(t + 0.03, [[2900, 0.2, 0.01]], 1);
});

// ===== Zombies ==============================================================

def('zombie_groan', { d: 2.8, v: 6, gain: 0.55, rev: 0.3, max: 6, jit: 0.05 }, (b, i) => {
  const t = 0.02;
  const dur = rnd(1.1, 2.4);
  const base = rnd(62, 108);
  const scale = rnd(0.82, 0.95);
  const va = ['o', 'u', 'uh', 'a'][i % 4];
  const vb = ['a', 'uh', 'o', 'u'][(i + 1) % 4];
  const shape = i % 3;
  const f0 = shape === 0
    ? [[0, base * 0.85], [0.25, base * 1.2], [0.6, base * 1.05], [1, base * 0.7]]
    : shape === 1
      ? [[0, base], [0.4, base * 0.9], [0.7, base * 1.25], [1, base * 0.75]]
      : [[0, base * 1.1], [0.5, base * 0.95], [1, base * 0.6]];
  b.voice(t, dur, {
    f0, jit: 0.07, jitRate: 14, vib: [rnd(3, 6), 0.025],
    formants: vowel(va, scale), formants2: vowel(vb, scale),
    breath: rnd(0.25, 0.45), fry: [rnd(22, 38), rnd(0.6, 0.85)], drive: rnd(3, 6),
    attack: rnd(0.12, 0.3), release: rnd(0.25, 0.45), lp: 3000, sub: rnd(0.2, 0.4),
    ring: chance(0.5) ? [rnd(30, 55), 0.25] : null, g: 1,
  });
  b.gurgle(t + dur * 0.2, dur * 0.7, { rate: 18, f0: 150, f1: 450, g: 0.25 });
  if (i % 2 === 0) b.nb(t + dur + 0.05, { kind: 'pink', type: 'bandpass', f: 1300, q: 2, a: 0.15, d: 0.15, g: 0.25 });
});

def('zombie_alert', { d: 1.5, v: 4, gain: 0.7, rev: 0.35, max: 4, jit: 0.05, ref: 3 }, (b) => {
  const t = 0.01;
  const dur = rnd(0.9, 1.3);
  const base = rnd(130, 185);
  const f0 = [[0, base * 0.7], [0.12, base * 1.5], [0.45, base * rnd(1.6, 1.9)], [0.8, base * 1.3], [1, base * 0.8]];
  b.voice(t, dur, {
    f0, jit: 0.06, jitRate: 20, vib: [rnd(5, 8), 0.04],
    formants: vowel('a', rnd(0.95, 1.08), 0.8), formants2: vowel('ae', 1, 0.8),
    breath: 0.7, fry: [rnd(45, 75), 0.5], drive: 10, attack: 0.04, release: 0.35,
    lp: 5500, sub: 0.25, ring: [rnd(60, 110), 0.3], g: 1,
  });
  b.voice(t + 0.03, dur * 0.85, {
    f0: f0.map(([x, y]) => [x, y * 2.02]), jit: 0.05, jitRate: 20,
    formants: [[1800, 6, 1], [2900, 8, 0.6], [3800, 10, 0.3]],
    breath: 0.5, drive: 6, attack: 0.06, release: 0.3, lp: 7000, g: 0.35,
  });
  b.nb(t, { kind: 'brown', type: 'lowpass', f: 300, a: 0.05, h: dur * 0.4, d: dur * 0.5, g: 0.4 });
});

def('zombie_attack', { d: 0.9, v: 4, gain: 0.6, rev: 0.25, max: 5, jit: 0.05 }, (b) => {
  const t = 0.01;
  const dur = rnd(0.35, 0.5);
  const base = rnd(105, 150);
  b.voice(t, dur, {
    f0: [[0, base * 0.9], [0.3, base * 1.35], [1, base * 0.8]], jit: 0.1, jitRate: 25,
    formants: vowel('e', 0.9), formants2: vowel('a', 0.9),
    breath: 0.6, fry: [rnd(50, 70), 0.75], drive: 12, attack: 0.02, release: 0.12, lp: 4500, sub: 0.3, g: 1,
  });
  b.click(t + dur * 0.9, 0.4, 0.001);
  b.whoosh(t + rnd(0.18, 0.28), rnd(0.22, 0.3), { f0: 350, fm: 1500, f1: 500, q: 1.4, g: 0.8, kind: 'pink' });
});

def('zombie_hurt', { d: 0.55, v: 5, gain: 0.55, rev: 0.25, max: 5, jit: 0.05 }, (b) => {
  const t = 0.005;
  const dur = rnd(0.2, 0.34);
  const base = rnd(120, 175);
  b.voice(t, dur, {
    f0: [[0, base * 1.2], [0.25, base * 1.5], [1, base * 0.75]], jit: 0.08, jitRate: 30,
    formants: vowel(chance(0.5) ? 'ae' : 'a', 0.95), formants2: vowel('uh', 0.95),
    breath: 0.45, fry: [rnd(55, 80), 0.45], drive: 8, attack: 0.012, release: 0.1, lp: 5000, sub: 0.2, g: 1,
  });
  b.nb(t + dur * 0.8, { kind: 'pink', type: 'bandpass', f: 1000, q: 1.5, a: 0.02, d: 0.12, g: 0.2 });
});

def('zombie_death', { d: 2.0, v: 4, gain: 0.6, rev: 0.3, max: 4, jit: 0.05 }, (b) => {
  const t = 0.01;
  const dur = rnd(1.0, 1.35);
  const base = rnd(95, 135);
  b.voice(t, dur, {
    f0: [[0, base * 1.15], [0.18, base * 1.35], [0.55, base * 0.95], [1, base * 0.45]], jit: 0.09, jitRate: 16,
    vib: [rnd(4, 7), 0.05], formants: vowel('a', 0.9), formants2: vowel('u', 0.85),
    breath: 0.55, fry: [rnd(24, 34), 0.9], drive: 7, attack: 0.03, release: 0.45, lp: 3500, sub: 0.35,
    ring: [rnd(35, 55), 0.3], g: 1,
  });
  b.gurgle(t + dur * 0.35, dur * 0.75, { rate: 45, f0: 140, f1: 500, g: 0.6 });
  const tf = t + dur + rnd(0.05, 0.2);
  b.thump(tf, { f0: 95, f1: 42, sweep: 0.08, d: 0.25, g: 0.7 });
  b.nb(tf, { kind: 'brown', type: 'lowpass', f: 320, a: 0.002, d: 0.2, g: 0.6 });
  b.nb(tf, { type: 'bandpass', f: 210, q: 5, a: 0.001, d: 0.15, g: 0.4 });
});

def('zombie_footstep', { d: 0.45, v: 6, gain: 0.38, rev: 0.15, max: 8, jit: 0.06 }, (b) => {
  const t = 0.004;
  b.nb(t, { kind: 'pink', type: 'bandpass', f: rnd(800, 1200), q: 0.9, a: 0.06, d: 0.08, g: 0.35 });
  const hit = t + rnd(0.06, 0.09);
  b.thump(hit, { f0: rnd(85, 100), f1: 48, sweep: 0.05, d: 0.13, g: 1 });
  b.nb(hit, { kind: 'brown', type: 'lowpass', f: 380, a: 0.002, d: 0.1, g: 0.7 });
  b.nb(hit, { type: 'bandpass', f: rnd(180, 240), q: 5, a: 0.001, d: 0.11, g: 0.45 });
  b.nb(hit + 0.02, { kind: 'pink', type: 'bandpass', f: 1100, q: 0.8, a: 0.03, d: 0.12, g: 0.25 });
});

def('bodyfall', { d: 0.9, v: 3, gain: 0.4, rev: 0.22, max: 4, jit: 0.05 }, (b) => {
  const t = 0.006;
  b.cloth(t, 0.12, { g: 0.4, f: 1100 });
  const hit = t + 0.05;
  b.thump(hit, { f0: 90, f1: 38, sweep: 0.08, a: 0.003, d: 0.28, g: 1.1, drive: 1.5 });
  b.nb(hit, { kind: 'brown', type: 'lowpass', f: 420, a: 0.002, d: 0.25, g: 0.9 });
  b.nb(hit, { type: 'bandpass', f: rnd(160, 190), q: 6, a: 0.001, d: 0.2, g: 0.6 });
  b.nb(hit, { type: 'bandpass', f: rnd(320, 380), q: 7, a: 0.001, d: 0.12, g: 0.35 });
  b.nb(hit, { type: 'bandpass', f: 1600, q: 1, a: 0.0008, d: 0.03, g: 0.3 });
  for (let k = 0; k < 2; k++) {
    const tt = hit + rnd(0.08, 0.22);
    b.thump(tt, { f0: 130, f1: 75, sweep: 0.03, d: 0.07, g: rnd(0.3, 0.5) });
    b.nb(tt, { type: 'bandpass', f: 260, q: 5, a: 0.001, d: 0.06, g: 0.25 });
  }
  b.rattle(hit + 0.01, 0.2, 5, { f: 2800, g: 0.12 });
  if (chance(0.5)) b.creak(hit + 0.1, rnd(0.2, 0.35), { f: rnd(600, 900), g: 0.25 });
});

def('striker_shriek', { d: 1.4, v: 4, gain: 0.65, rev: 0.35, max: 3, jit: 0.04, ref: 4 }, (b) => {
  const t = 0.01;
  const dur = rnd(0.85, 1.2);
  const base = rnd(420, 560);
  const f0 = [[0, base * 0.7], [0.08, base * 1.15], [0.45, base * rnd(1.25, 1.45)], [0.8, base * 1.05], [1, base * 0.75]];
  b.voice(t, dur, {
    f0, jit: 0.04, jitRate: 22, vib: [rnd(6.5, 9), 0.035],
    formants: vowel('ae', 1.25, 1.2), formants2: vowel('a', 1.3, 1.2),
    breath: 0.75, fry: [rnd(90, 130), 0.25], drive: 5, attack: 0.03, release: 0.25,
    lp: 8000, hp: 200, ring: [rnd(180, 280), 0.18], g: 1,
  });
  b.voice(t + 0.02, dur * 0.9, {
    f0: f0.map(([x, y]) => [x, y * 3.01]), jit: 0.03, vib: [7, 0.03], wave: 'triangle',
    formants: [[3200, 3, 1], [4600, 4, 0.5]], breath: 0.3, drive: 1.5, attack: 0.05, release: 0.3, lp: 9000, g: 0.25,
  });
});

// ----- Biter (small feral kid): a short vocal tract (formants ~1.4x up), a high thin voice with grit

// the pounce telegraph: a rising, ring-modulated child's screech that cuts off at the leap
def('biter_shriek', { d: 0.8, v: 4, gain: 0.7, rev: 0.3, max: 3, jit: 0.05, ref: 4 }, (b) => {
  const t = 0.005;
  const dur = rnd(0.42, 0.55);
  const base = rnd(620, 820);
  const f0 = [[0, base * 0.55], [0.35, base * 1.05], [0.75, base * rnd(1.3, 1.5)], [1, base * 1.2]];
  b.voice(t, dur, {
    f0, jit: 0.06, jitRate: 34, vib: [rnd(11, 15), 0.05],
    formants: vowel('e', 1.45, 1.3), formants2: vowel('ae', 1.5, 1.3),
    breath: 0.9, fry: [rnd(70, 110), 0.35], drive: 7, attack: 0.05, release: 0.06,
    lp: 9500, hp: 300, ring: [rnd(210, 320), 0.3], g: 1,
  });
  b.voice(t + 0.01, dur * 0.9, {
    f0: f0.map(([x, y]) => [x, y * 2.01]), jit: 0.05, wave: 'triangle',
    formants: [[3600, 3, 1], [5200, 4, 0.5]], breath: 0.4, drive: 2, attack: 0.08, release: 0.05, lp: 11000, g: 0.3,
  });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 2600, f2: 4200, q: 1.2, a: 0.03, h: dur * 0.6, d: dur * 0.3, g: 0.25 });
});

// alert / chase chatter: a wet, gargled snarl through clenched teeth
def('biter_snarl', { d: 0.9, v: 5, gain: 0.55, rev: 0.25, max: 4, jit: 0.06 }, (b) => {
  const t = 0.005;
  const dur = rnd(0.35, 0.6);
  const base = rnd(210, 300);
  b.voice(t, dur, {
    f0: [[0, base * 0.9], [0.3, base * 1.25], [0.7, base * 1.05], [1, base * 0.8]], jit: 0.12, jitRate: 40,
    formants: vowel('e', 1.35, 1.1), formants2: vowel('uh', 1.35, 1.1),
    breath: 0.8, fry: [rnd(35, 55), 0.85], drive: 12, attack: 0.02, release: 0.12, lp: 6500, hp: 150, sub: 0.15, g: 1,
  });
  b.gurgle(t + dur * 0.2, dur * 0.8, { rate: 55, f0: 260, f1: 900, g: 0.45 });
  b.nb(t, { type: 'bandpass', f: rnd(3000, 4200), q: 2, a: 0.01, h: dur * 0.5, d: dur * 0.4, g: 0.18 }); // hiss through the teeth
});

// one bite while latched on: teeth into cloth and flesh (crunch + tear) under a muffled snarl
def('biter_bite', { d: 0.55, v: 6, gain: 0.62, rev: 0.08, max: 4, jit: 0.05 }, (b) => {
  const t = 0.004;
  b.click(t, 0.5, 0.0012);
  b.thump(t, { f0: 180, f1: 70, sweep: 0.03, d: 0.07, g: 0.6, drive: 2 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: rnd(1100, 1600), q: 1.2, a: 0.002, d: 0.08, g: 0.8, drive: 3 });
  b.crackle(t + 0.005, rnd(0.08, 0.12), 900, 0.7, b.fbus('bandpass', 2400, 0.9, 1));
  b.scrape(t + 0.05, rnd(0.1, 0.16), { f0: rnd(1500, 2000), f1: rnd(700, 900), q: 1.5, g: 0.5, kind: 'pink' }); // tearing
  b.gurgle(t + 0.04, rnd(0.15, 0.22), { rate: 70, f0: 300, f1: 1100, g: 0.5 });
  const base = rnd(230, 300);
  b.voice(t + 0.02, rnd(0.25, 0.34), {
    f0: [[0, base * 1.1], [0.4, base * 0.95], [1, base * 0.7]], jit: 0.15, jitRate: 45,
    formants: vowel('uh', 1.3, 1.1), breath: 0.9, fry: [rnd(40, 60), 0.9], drive: 10,
    attack: 0.015, release: 0.1, lp: 3200, hp: 160, g: 0.55,
  });
});

// shaken off: the kid slammed onto the floor (body thud, cloth, a winded yelp)
def('biter_shake', { d: 0.8, v: 3, gain: 0.7, rev: 0.22, max: 3, jit: 0.04, ref: 3 }, (b) => {
  const t = 0.006;
  b.cloth(t, 0.1, { g: 0.5, f: 1300 });
  const hit = t + 0.06;
  b.thump(hit, { f0: 120, f1: 45, sweep: 0.07, a: 0.002, d: 0.24, g: 1.2, drive: 1.6 });
  b.nb(hit, { kind: 'brown', type: 'lowpass', f: 500, a: 0.002, d: 0.2, g: 0.9 });
  b.nb(hit, { type: 'bandpass', f: rnd(220, 280), q: 5, a: 0.001, d: 0.14, g: 0.5 });
  b.nb(hit, { type: 'bandpass', f: 1800, q: 1, a: 0.0008, d: 0.03, g: 0.35 });
  const base = rnd(520, 680);
  b.voice(hit + 0.01, rnd(0.16, 0.22), {
    f0: [[0, base * 1.2], [1, base * 0.7]], jit: 0.08, jitRate: 30,
    formants: vowel('a', 1.4, 1.2), breath: 0.9, fry: [rnd(60, 90), 0.4], drive: 6,
    attack: 0.006, release: 0.08, lp: 7000, hp: 250, g: 0.45,
  });
  b.rattle(hit + 0.02, 0.15, 3, { f: 2600, g: 0.1 });
});

def('crusher_roar', { d: 2.5, v: 3, gain: 0.9, rev: 0.4, max: 2, jit: 0.04, ref: 6 }, (b) => {
  const t = 0.02;
  const dur = rnd(1.6, 2.1);
  const base = rnd(40, 52);
  const f0 = [[0, base * 0.8], [0.2, base * 1.35], [0.6, base * 1.2], [1, base * 0.7]];
  b.voice(t, dur, {
    f0, jit: 0.08, jitRate: 12, vib: [rnd(3, 5), 0.03],
    formants: vowel('o', 0.75, 0.8), formants2: vowel('a', 0.72, 0.8),
    breath: 0.6, fry: [rnd(16, 24), 0.9], drive: 14, attack: 0.18, release: 0.55,
    lp: 2600, sub: 0.7, ring: [rnd(28, 40), 0.35], g: 1,
  });
  b.voice(t + 0.04, dur * 0.95, {
    f0: f0.map(([x, y]) => [x, y * 1.49]), jit: 0.06, formants: vowel('uh', 0.8),
    breath: 0.4, fry: [rnd(20, 30), 0.7], drive: 9, attack: 0.2, release: 0.5, lp: 3000, g: 0.45,
  });
  b.tone(t, base, { type: 'sine', a: 0.25, h: dur * 0.5, d: dur * 0.5, g: 0.8 });
  b.nb(t, { kind: 'brown', type: 'lowpass', f: 220, a: 0.25, h: dur * 0.4, d: dur * 0.6, g: 0.7 });
});

def('crusher_step', { d: 0.7, v: 4, gain: 0.65, rev: 0.25, max: 4, jit: 0.05, ref: 5 }, (b) => {
  const t = 0.005;
  b.click(t, 0.5, 0.003);
  b.thump(t, { f0: rnd(55, 68), f1: 26, sweep: 0.12, a: 0.003, d: 0.5, g: 1.3, drive: 2 });
  b.nb(t, { kind: 'brown', type: 'lowpass', f: 260, a: 0.002, d: 0.45, g: 1 });
  b.nb(t, { type: 'bandpass', f: rnd(1200, 1600), q: 1, a: 0.0008, d: 0.06, g: 0.5, drive: 3 });
  b.nb(t, { type: 'bandpass', f: rnd(130, 160), q: 6, a: 0.002, d: 0.35, g: 0.6 });
  b.crackle(t + 0.03, 0.4, 120, 0.4, b.fbus('bandpass', 3000, 0.7, 1));
});

def('charger_fuse', { d: 1.0, xf: 0.06, xfLinear: true, loop: true, v: 1, gain: 0.45, rev: 0.15, max: 4, jit: 0 }, (b) => {
  const T = b.dur;
  const L = b.L;
  const s = b.noise('white', 0, T);
  s.connect(b.f('highpass', 2800)).connect(b.f('lowpass', 9000)).connect(b.g(0.3, b.out));
  b.crackle(0, T, 180, 0.9, b.fbus('bandpass', 5500, 0.8, 0.9), { flat: true, skew: 2.5, w: 3 });
  const gate = b.g(0, b.out);
  const bf = Math.round(2400 * L) / L;
  b.osc('sine', bf, 0, T, gate);
  b.osc('triangle', bf / 2, 0, T, b.g(0.3, gate));
  const per = L / 8;
  for (let k = 0; k * per < T; k++) {
    const t0 = k * per + 0.004;
    gate.gain.setValueAtTime(0, t0);
    gate.gain.linearRampToValueAtTime(0.55, t0 + 0.002);
    gate.gain.setValueAtTime(0.55, t0 + 0.04);
    gate.gain.linearRampToValueAtTime(0, t0 + 0.046);
  }
});

def('acid_hiss', { d: 2.0, xf: 0.15, loop: true, v: 1, gain: 0.35, rev: 0.12, max: 4, jit: 0 }, (b) => {
  const T = b.dur;
  b.noise('white', 0, T).connect(b.f('highpass', 3500)).connect(b.g(0.18, b.out));
  const bub = b.fbus('lowpass', 3500, 0, 0.8);
  let t = 0;
  while (t < T) {
    const f = rnd(250, 950);
    b.chirp(t, f, f * rnd(1.3, 1.9), rnd(0.012, 0.04), Math.pow(rnd(0.2, 1), 1.5), bub);
    t += expRand(28);
  }
  const big = b.fbus('lowpass', 1200, 0, 0.6);
  t = 0;
  while (t < T) {
    const f = rnd(120, 260);
    b.chirp(t, f, f * rnd(1.4, 2.2), rnd(0.03, 0.06), rnd(0.4, 1), big);
    t += expRand(4);
  }
  b.crackle(0, T, 350, 0.5, b.fbus('highpass', 2500, 0, 0.4), { flat: true, skew: 2 });
});

def('gore_explode', { d: 0.95, v: 3, gain: 0.7, rev: 0.2, max: 4, jit: 0.05, ref: 3 }, (b) => {
  const t = 0.004;
  b.click(t, 0.6, 0.002);
  b.thump(t, { f0: 170, f1: 45, sweep: 0.06, d: 0.18, g: 1.1, drive: 2 });
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 850, q: 0.7, a: 0.001, d: 0.2, g: 1, drive: 4 });
  b.nb(t + 0.005, { type: 'bandpass', f: 1700, f2: 600, ft: 0.3, q: 1.2, a: 0.002, d: 0.35, g: 0.5 });
  b.crackle(t, 0.05, 1500, 0.8, b.fbus('bandpass', 2400, 0.8, 0.6));
  const sp = b.fbus('lowpass', 3500, 0, 0.6);
  let tt = t + 0.04;
  while (tt < 0.85) {
    const x = (tt - t) / 0.8;
    const f = rnd(400, 1800);
    b.chirp(tt, f, f * rnd(0.7, 1.6), rnd(0.008, 0.03), rnd(0.2, 1) * Math.pow(1 - x, 1.5), sp);
    tt += expRand(60 * (1 - x) + 8);
  }
});

// ===== Game / UI ============================================================

def('pickup_health', { d: 0.7, v: 2, gain: 0.4, rev: 0.12, max: 3, jit: 0.01 }, (b) => {
  const t = 0.005;
  [659.25, 987.77, 1318.5].forEach((f, k) => {
    b.tone(t + k * 0.06, f, { a: 0.004, d: 0.4, g: 0.5 });
    b.tone(t + k * 0.06, f * 2, { a: 0.004, d: 0.15, g: 0.12 });
  });
  b.cloth(t, 0.15, { g: 0.35, f: 2500 });
  b.nb(t + 0.02, { type: 'highpass', f: 7000, a: 0.05, d: 0.25, g: 0.08 });
});

def('pickup_ammo', { d: 0.5, v: 2, gain: 0.4, rev: 0.1, max: 3 }, (b) => {
  const t = 0.004;
  b.cloth(t, 0.12, { g: 0.4, f: 1300 });
  b.thump(t + 0.03, { f0: 210, f1: 140, sweep: 0.03, d: 0.07, g: 0.6 });
  const f = rnd(560, 680);
  b.modal(t + 0.03, [[f, 0.45, 0.12], [f * 2.37, 0.35, 0.09], [f * 3.9, 0.25, 0.06], [f * 5.6, 0.15, 0.04]], 1);
  b.rattle(t + 0.05, 0.18, 10, { f: 3600, g: 0.22 });
  clack(b, t + 0.26, { g: 0.5, f: 1.15 });
});

def('pickup_weapon', { d: 0.6, v: 2, gain: 0.4, rev: 0.1, max: 2 }, (b) => {
  const t = 0.004;
  b.cloth(t, 0.14, { g: 0.45, f: 1000 });
  clack(b, t + 0.05, { g: 0.8, f: 0.8, dec: 0.06 });
  b.thump(t + 0.05, { f0: 150, f1: 90, sweep: 0.04, d: 0.08, g: 0.5 });
  clack(b, t + rnd(0.24, 0.3), { g: 0.9, f: 1.0, dec: 0.07 });
  b.modal(t + 0.27, [[1700, 0.25, 0.12], [4300, 0.12, 0.07]], 1);
});

def('round_start', { d: 2.9, v: 1, ch: 2, gain: 0.6, rev: 0.15, max: 2, jit: 0 }, (b) => {
  const hit = 2.05;
  const lp = b.f('lowpass', 120, 8);
  const dg = b.g(0, b.out);
  lp.connect(dg);
  lp.frequency.setValueAtTime(120, 0);
  lp.frequency.exponentialRampToValueAtTime(2600, hit);
  lp.frequency.setTargetAtTime(200, hit, 0.3);
  dg.gain.setValueAtTime(0, 0);
  dg.gain.linearRampToValueAtTime(0.25, 0.4);
  dg.gain.exponentialRampToValueAtTime(1, hit - 0.02);
  dg.gain.setTargetAtTime(0, hit, 0.25);
  for (const [f, p, type] of [[55, -0.7, 'sawtooth'], [55.6, 0.7, 'sawtooth'], [82.4, 0, 'sawtooth'], [110.3, -0.3, 'square']]) {
    const os = b.osc(type, f, 0, 2.9);
    os.frequency.setValueAtTime(f, 0);
    os.frequency.exponentialRampToValueAtTime(f * 1.5, hit);
    const pn = b.c.createStereoPanner();
    pn.pan.value = p;
    os.connect(b.g(0.3, pn));
    pn.connect(lp);
  }
  b.nb(0.2, { type: 'bandpass', f: 800, f2: 6000, ft: hit - 0.2, q: 1.5, a: hit - 0.25, d: 0.05, g: 0.35 });
  b.click(hit, 1, 0.003);
  b.thump(hit, { f0: 75, f1: 32, sweep: 0.25, a: 0.002, d: 0.9, g: 1.3, drive: 2 });
  b.nb(hit, { kind: 'pink', type: 'lowpass', f: 3000, f2: 300, ft: 0.6, a: 0.002, d: 0.8, g: 0.9, drive: 5 });
  b.modal(hit, [[146, 0.5, 1.6], [347, 0.35, 1.2], [589, 0.25, 0.9], [893, 0.18, 0.7], [1270, 0.1, 0.5]], 1);
});

const NOTE = { C2: 65.41, C3: 130.81, Eb3: 155.56, G3: 196, C4: 261.63, Db4: 277.18, D4: 293.66, Eb4: 311.13, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, G2: 98 };

def('round_end', { d: 1.7, v: 1, ch: 2, gain: 0.55, rev: 0.2, max: 1, jit: 0 }, (b) => {
  const N = NOTE;
  b.brass(0.02, N.G4, 0.09, { g: 0.8, pan: -0.15, vib: false });
  b.brass(0.14, N.G4, 0.09, { g: 0.8, pan: 0.15, vib: false });
  for (const [f, p] of [[N.C4, -0.4], [N.E4, 0.35], [N.G4, -0.1], [N.C5, 0.3], [N.C3, 0]]) {
    b.brass(0.26, f, 0.75, { g: 0.5, pan: p, bright: 1.1 });
  }
  b.timp(0.26, N.C3, 0.9);
  b.nb(0.26, { type: 'highpass', f: 5000, a: 0.002, d: 0.9, g: 0.15 });
});

def('victory', { d: 3.4, v: 1, ch: 2, gain: 0.6, rev: 0.25, max: 1, jit: 0 }, (b) => {
  const N = NOTE;
  const note = (t, f, d, g = 0.5, p = 0) => b.brass(t, f, d, { g, pan: p, bright: 1.1 });
  note(0.02, N.G4, 0.1, 0.8, -0.2);
  note(0.15, N.G4, 0.1, 0.8, 0.2);
  note(0.28, N.G4, 0.1, 0.8, 0);
  for (const [f, p] of [[N.C4, -0.4], [N.E4, 0.3], [N.G4, -0.1], [N.C5, 0.4]]) note(0.42, f, 0.55, 0.45, p);
  b.timp(0.42, N.C3, 0.9);
  for (const [f, p] of [[N.F4, -0.3], [N.A4, 0.3], [N.C5, 0]]) note(1.05, f, 0.26, 0.45, p);
  for (const [f, p] of [[N.G4, -0.3], [N.B4, 0.3], [N.D5, 0]]) note(1.38, f, 0.26, 0.45, p);
  b.timp(1.38, N.G2, 0.7);
  for (const [f, p] of [[N.C4, -0.45], [N.E4, 0.35], [N.G4, -0.15], [N.C5, 0.45], [N.C3, 0]]) note(1.72, f, 1.1, 0.45, p);
  b.timp(1.72, N.C3, 1);
  b.nb(1.72, { type: 'highpass', f: 5000, a: 0.002, d: 1.4, g: 0.22 });
  b.modal(1.72, [[3150, 0.1, 1.2], [4420, 0.08, 1.0], [6100, 0.05, 0.8]], 1);
});

def('defeat', { d: 3.4, v: 1, ch: 2, gain: 0.5, rev: 0.25, max: 1, jit: 0 }, (b) => {
  const N = NOTE;
  const note = (t, f, d, g = 0.5, p = 0) => b.brass(t, f, d, { g, pan: p, bright: 0.6, att: 0.06, rel: 0.5 });
  note(0.05, N.Eb4, 0.45, 0.6, -0.2);
  note(0.6, N.D4, 0.45, 0.6, 0.2);
  note(1.15, N.Db4, 0.45, 0.6, 0);
  for (const [f, p] of [[N.C3, -0.3], [N.Eb3, 0.3], [N.G3, -0.1], [N.C4, 0.2]]) note(1.7, f, 1.2, 0.45, p);
  b.timp(1.7, N.C2, 1);
  b.modal(1.7, [[130, 0.6, 2.5], [310, 0.35, 1.8], [520, 0.25, 1.2], [780, 0.18, 0.9], [1090, 0.1, 0.6]], 1);
  const dr = b.osc('sawtooth', N.C2, 0, 3.4);
  const dlp = b.f('lowpass', 260, 2);
  const denv = b.g(0, b.out);
  dr.connect(dlp);
  dlp.connect(denv);
  denv.gain.setValueAtTime(0, 0);
  denv.gain.linearRampToValueAtTime(0.25, 1.0);
  denv.gain.linearRampToValueAtTime(0.35, 2.4);
  denv.gain.linearRampToValueAtTime(0, 3.35);
});

def('countdown_tick', { d: 0.15, v: 1, gain: 0.35, rev: 0.05, max: 2, jit: 0 }, (b) => {
  const t = 0.002;
  b.tone(t, 1320, { d: 0.08, g: 0.6 });
  b.tone(t, 2640, { d: 0.04, g: 0.2 });
  b.click(t, 0.4, 0.001);
  b.nb(t, { type: 'bandpass', f: 1800, q: 6, a: 0.0005, d: 0.03, g: 0.4 });
});

// Striker charge timer: a hard little piezo beep (played faster and higher as the fuse runs down)
def('charge_beep', { d: 0.09, v: 1, gain: 0.32, rev: 0.06, max: 6, jit: 0 }, (b) => {
  const t = 0.002;
  b.tone(t, 3150, { d: 0.055, g: 0.55 });
  b.tone(t, 6300, { d: 0.03, g: 0.12 });
  b.click(t, 0.25, 0.0008);
});

def('ui_click', { d: 0.08, v: 2, gain: 0.45, rev: 0, max: 3, jit: 0.02 }, (b) => {
  const t = 0.001;
  b.click(t, 0.5, 0.0008);
  b.modal(t, [[rnd(2000, 2300), 0.5, 0.015], [4400, 0.2, 0.01]], 1);
  b.thump(t, { f0: 700, f1: 420, sweep: 0.012, d: 0.02, g: 0.3 });
});

def('ui_hover', { d: 0.06, v: 1, gain: 0.22, rev: 0, max: 3, jit: 0.02 }, (b) => {
  const t = 0.001;
  b.tone(t, 3100, { a: 0.002, d: 0.025, g: 0.5 });
  b.modal(t, [[6200, 0.1, 0.01]], 1);
});

// a burning barn (world/barnFire.js): low roar, flapping flame noise, dense crackle and the odd sharp pop
def('fire_roar', { d: 4, xf: 0.4, loop: true, v: 1, gain: 0.7, rev: 0.25, max: 2, jit: 0, ref: 7 }, (b) => {
  const T = b.dur;
  b.noise('brown', 0, T).connect(b.f('lowpass', 320)).connect(b.g(0.9, b.out));
  const flutter = b.g(0, b.out);
  b.noise('pink', 0, T).connect(b.f('bandpass', 650, 0.6)).connect(flutter);
  for (let t = 0; t < T; t += rnd(0.04, 0.14)) flutter.gain.setValueAtTime(rnd(0.08, 0.45), t);
  b.crackle(0, T, 120, 0.7, b.fbus('bandpass', 2600, 0.8, 0.9), { flat: true, skew: 2.5, w: 3 });
  b.crackle(0, T, 10, 1, b.fbus('highpass', 1100, 0, 0.9), { flat: true, skew: 1.4, w: 5 });
});

def('lightning_crack', { d: 2.3, v: 3, gain: 1.0, rev: 0.4, max: 2, jit: 0.04, ref: 12 }, (b) => {
  const t = 0.003;
  const bus = b.g(1, b.out);
  b.click(t, 1, 0.003, bus);
  b.nb(t, { type: 'highpass', f: 1500, a: 0.0005, d: 0.07, g: 1, drive: 3, dest: bus });
  b.crackle(t, 0.22, 900, 1, b.fbus('highpass', 900, 0, 0.8, bus), { pow: 1.2, w: 3 });
  b.crackle(t + rnd(0.04, 0.09), 0.12, 600, 0.8, b.fbus('highpass', 1200, 0, 0.6, bus), { pow: 1.5, w: 3 });
  b.thump(t, { f0: 75, f1: 30, sweep: 0.3, a: 0.003, d: 1.0, g: 1.1, drive: 2, dest: bus });
  b.nb(t, { kind: 'pink', type: 'lowpass', f: 3500, f2: 400, ft: 0.6, a: 0.002, d: 0.6, g: 0.8, drive: 5, dest: bus });
  b.nb(t + 0.02, { kind: 'brown', type: 'lowpass', f: 320, a: 0.03, h: 0.3, d: 1.8, g: 0.9, dest: bus });
  b.echo(bus, { time: rnd(0.18, 0.26), fb: 0.35, lp: 700, wet: 0.3 });
});

def('wood_creak', { d: 1.5, v: 4, gain: 0.85, rev: 0.3, max: 3, jit: 0.06 }, (b) => {
  const t = 0.01;
  const f = rnd(450, 950);
  const dur = rnd(0.5, 1.0);
  b.creak(t, dur, { f, g: 1, r0: rnd(18, 40), r1: rnd(50, 140), q: rnd(10, 16) });
  if (chance(0.5)) b.creak(t + dur + rnd(0.02, 0.1), rnd(0.15, 0.3), { f: f * rnd(1.1, 1.3), g: 0.6, r0: 60, r1: 30 });
});

// ===== Barricades (world/barricades.js) ======================================

// hammer blow on a nail: steel tink over a knock through the board
def('hammer_nail', { d: 0.45, v: 5, gain: 0.55, rev: 0.18, max: 4, jit: 0.05 }, (b) => {
  const t = 0.002;
  b.click(t, 0.9, 0.0012);
  const f = rnd(2900, 3600);
  b.modal(t, [[f, 0.5, 0.09], [f * 1.53, 0.3, 0.06], [f * 2.41, 0.18, 0.04], [rnd(5200, 6400), 0.12, 0.03]], 0.55);
  b.nb(t, { type: 'bandpass', f: rnd(1400, 1900), q: 1.2, a: 0.0004, d: 0.025, g: 0.55 });
  b.nb(t, { type: 'bandpass', f: rnd(380, 520), q: 7, a: 0.0008, d: 0.08, g: 0.8 });
  b.thump(t, { f0: rnd(210, 250), f1: 120, sweep: 0.02, d: 0.06, g: 0.6 });
});

// a claw / fist slamming the planks: dull thud, the boards ring, a few splinters
def('wood_bash', { d: 0.8, v: 5, gain: 0.7, rev: 0.25, max: 6, jit: 0.06, ref: 3 }, (b) => {
  const t = 0.004;
  b.click(t, 0.5, 0.002);
  b.thump(t, { f0: rnd(120, 150), f1: 55, sweep: 0.05, d: 0.16, g: 1, drive: 1.5 });
  b.nb(t, { kind: 'brown', type: 'lowpass', f: 500, a: 0.002, d: 0.14, g: 0.8 });
  b.nb(t, { type: 'bandpass', f: rnd(260, 360), q: 7, a: 0.001, d: 0.16, g: 0.75 });
  b.nb(t, { type: 'bandpass', f: rnd(700, 950), q: 9, a: 0.001, d: 0.09, g: 0.4 });
  b.crackle(t + 0.005, 0.18, 300, 0.45, b.fbus('highpass', 2200, 0, 0.6));
  if (chance(0.45)) b.creak(t + rnd(0.05, 0.12), rnd(0.12, 0.25), { f: rnd(500, 800), g: 0.35, r0: 70, r1: 30 });
});

// a board tearing off its nails: splintering crack, the nails screech out, a creak
def('plank_break', { d: 1.1, v: 4, gain: 0.8, rev: 0.28, max: 4, jit: 0.05, ref: 4 }, (b) => {
  const t = 0.004;
  b.click(t, 0.9, 0.002);
  b.crackle(t, 0.3, 700, 0.9, b.fbus('highpass', 1500, 0, 0.8), { pow: 1.4, w: 3 });
  b.nb(t, { type: 'bandpass', f: rnd(1800, 2600), q: 1.1, a: 0.0006, d: 0.07, g: 0.7 });
  b.nb(t, { type: 'bandpass', f: rnd(320, 440), q: 6, a: 0.001, d: 0.14, g: 0.8 });
  b.thump(t, { f0: 170, f1: 70, sweep: 0.04, d: 0.12, g: 0.7 });
  b.creak(t + rnd(0.01, 0.04), rnd(0.18, 0.32), { f: rnd(900, 1400), g: 0.5, r0: 140, r1: 50, q: 14 });
  b.rattle(t + 0.02, 0.1, 2, { f: 3800, g: 0.15 });
});

// a loose board clattering onto the floor: one end, then the other, then a short rattle
def('plank_drop', { d: 0.9, v: 5, gain: 0.5, rev: 0.22, max: 5, jit: 0.06 }, (b) => {
  let t = 0.004;
  for (let k = 0; k < 2; k++) {
    b.click(t, 0.5, 0.0015);
    b.thump(t, { f0: rnd(190, 240), f1: 110, sweep: 0.02, d: 0.07, g: k ? 0.55 : 0.8 });
    b.nb(t, { type: 'bandpass', f: rnd(420, 620), q: 8, a: 0.0008, d: 0.1, g: k ? 0.5 : 0.75 });
    b.nb(t, { type: 'bandpass', f: rnd(1100, 1500), q: 9, a: 0.0006, d: 0.05, g: 0.3 });
    t += rnd(0.07, 0.16);
  }
  for (let k = 0; k < 3; k++) b.nb(t + rnd(0, 0.18), { type: 'bandpass', f: rnd(500, 900), q: 6, a: 0.0006, d: 0.04, g: rnd(0.1, 0.25) });
});

def('glass_break', { d: 1.3, v: 3, gain: 0.65, rev: 0.25, max: 3, jit: 0.04, ref: 3 }, (b) => {
  const t = 0.003;
  b.click(t, 1, 0.002);
  b.nb(t, { type: 'highpass', f: 2500, a: 0.0005, d: 0.06, g: 0.9 });
  b.nb(t, { type: 'bandpass', f: 4200, q: 0.8, a: 0.001, d: 0.15, g: 0.5 });
  b.modal(t, [[rnd(1600, 2000), 0.3, 0.35], [rnd(2900, 3300), 0.22, 0.25], [rnd(4800, 5400), 0.15, 0.18]], 1);
  let tt = t + 0.005;
  while (tt < 1.05) {
    const x = (tt - t) / 1.0;
    const f = rnd(2500, 9500);
    const a = rnd(0.15, 1) * Math.pow(1 - x, 1.6);
    b.modal(tt, [[f, 0.6, rnd(0.03, 0.14)], [f * rnd(1.9, 2.6), 0.3, rnd(0.02, 0.07)]], a * 0.6);
    tt += expRand(90 * (1 - x) + 6);
  }
  b.crackle(t + 0.1, 0.8, 90, 0.4, b.fbus('highpass', 3000, 0, 0.5), { pow: 1.5 });
});

// ===== Generator (world/power.js) =============================================

// single-cylinder gasoline engine at ~3600 rpm: 30 firings a second into a driven low end, exhaust
// bark pulsing with them, valve-train ticks and a faint alternator whine
def('gen_run', { d: 1.0, xf: 0.12, loop: true, v: 1, gain: 0.5, rev: 0.25, max: 2, jit: 0, ref: 1.6 }, (b) => {
  const T = b.dur;
  const L = b.L;
  const per = L / 30;
  const low = b.g(1);
  low.connect(b.f('lowpass', 420, 0.7)).connect(b.shaper(2.5, b.g(0.7, b.out)));
  const ex = b.fbus('bandpass', 280, 1.1, 0.9);
  for (let k = 0; ; k++) {
    const t = 0.002 + k * per + rnd(-0.0012, 0.0012);
    if (t >= T - 0.02) break;
    const a = rnd(0.8, 1);
    b.chirp(t, 95, 42, 0.03, a, low);
    b.click(t, 0.25 * a, 0.004, ex);
  }
  const am = b.g(0.4);
  b.noise('brown', 0, T).connect(b.f('bandpass', 220, 0.9)).connect(am);
  am.connect(b.g(0.9, b.out));
  b.osc('sine', Math.round(30 * L) / L, 0, T).connect(b.g(0.35)).connect(am.gain);
  b.crackle(0, T, 240, 0.12, b.fbus('highpass', 3500, 0, 0.5), { flat: true, skew: 2.5 });
  b.osc('sine', Math.round(180 * L) / L, 0, T, b.g(0.035, b.out));
  b.osc('triangle', Math.round(360 * L) / L, 0, T, b.g(0.012, b.out));
});

// a misfire: backfire bang through the muffler, then a few ragged half-firings
def('gen_cough', { d: 0.8, v: 4, gain: 0.7, rev: 0.3, max: 3, jit: 0.05, ref: 2.5 }, (b) => {
  const t = 0.003;
  b.click(t, 0.8, 0.003);
  b.thump(t, { f0: 120, f1: 40, sweep: 0.06, d: 0.18, g: 1, drive: 2.5 });
  b.nb(t, { kind: 'brown', type: 'bandpass', f: 300, q: 0.9, a: 0.002, d: 0.16, g: 1.2, drive: 3 });
  b.nb(t, { type: 'bandpass', f: 1500, q: 0.7, a: 0.001, d: 0.05, g: 0.5 });
  let tt = t + rnd(0.08, 0.14);
  for (let i = 0; i < 3 && tt < 0.7; i++) {
    b.thump(tt, { f0: 95, f1: 45, sweep: 0.03, d: 0.06, g: rnd(0.3, 0.6), drive: 1.5 });
    b.nb(tt, { kind: 'brown', type: 'bandpass', f: 260, q: 1, a: 0.002, d: 0.05, g: rnd(0.3, 0.5) });
    tt += rnd(0.05, 0.13);
  }
  b.rattle(t + 0.02, 0.2, 4, { f: 2600, g: 0.2 });
});

// running down: the firings slow and weaken, a last shudder, the hot metal ticks
def('gen_die', { d: 2.6, v: 2, gain: 0.7, rev: 0.3, max: 2, jit: 0.03, ref: 2.5 }, (b) => {
  const low = b.g(1);
  low.connect(b.f('lowpass', 380, 0.7)).connect(b.shaper(2, b.g(0.8, b.out)));
  let t = 0.002, per = 1 / 30, a = 1;
  while (per < 0.3 && t < 1.8) {
    b.chirp(t, 90, 40, 0.035, a, low);
    b.nb(t, { kind: 'brown', type: 'bandpass', f: 240, q: 1, a: 0.002, d: 0.04 + per * 0.3, g: 0.6 * a });
    t += per * rnd(0.9, 1.15);
    per *= 1.14;
    a *= 0.97;
  }
  b.thump(t, { f0: 70, f1: 35, sweep: 0.08, d: 0.25, g: 0.9, drive: 1.5 });
  clack(b, t + 0.02, { g: 0.5, f: 0.45, dec: 0.1 });
  b.rattle(t + 0.03, 0.35, 5, { f: 2200, g: 0.2 });
  for (let i = 0; i < 3; i++) b.modal(t + 0.35 + i * rnd(0.12, 0.2), [[rnd(3000, 4200), 0.15, 0.05]], 0.4);
});

// the recoil starter: the cord rips off its drum, the engine turns over, the cord rewinds
def('gen_pull', { d: 1.1, v: 3, gain: 0.65, rev: 0.2, max: 2, jit: 0.04, ref: 2 }, (b) => {
  const t = 0.004;
  b.scrape(t, 0.26, { f0: 700, f1: 2400, q: 1.6, g: 0.9 });
  b.crackle(t, 0.26, 260, 0.35, b.fbus('bandpass', 3200, 1, 0.8), { flat: true });
  let tt = t + 0.05, per = 0.09;
  for (let i = 0; i < 6; i++) {
    b.thump(tt, { f0: 85, f1: 45, sweep: 0.03, d: 0.07, g: 0.7 - i * 0.05, drive: 1.2 });
    b.nb(tt, { kind: 'brown', type: 'bandpass', f: 220, q: 1, a: 0.003, d: 0.06, g: 0.35 });
    tt += per;
    per *= 0.85;
  }
  b.scrape(t + 0.34, 0.3, { f0: 1800, f1: 900, q: 2, g: 0.35 });
  clack(b, t + 0.66, { g: 0.5, f: 0.7, dec: 0.05 });
});

// it catches: a bang, ragged firings gathering speed (the gen_run loop takes over)
def('gen_catch', { d: 1.2, v: 2, gain: 0.7, rev: 0.25, max: 2, jit: 0.03, ref: 2.5 }, (b) => {
  const low = b.g(1);
  low.connect(b.f('lowpass', 450, 0.7)).connect(b.shaper(2.5, b.g(0.8, b.out)));
  b.thump(0.004, { f0: 130, f1: 40, sweep: 0.06, d: 0.2, g: 1, drive: 2.5 });
  b.nb(0.004, { kind: 'brown', type: 'bandpass', f: 320, q: 0.9, a: 0.002, d: 0.18, g: 1.1, drive: 3 });
  let t = 0.12, per = 0.11;
  while (t < 1.1) {
    const a = rnd(0.7, 1) * (1 - (t / 1.1) * 0.6);
    b.chirp(t, 95, 42, 0.03, a, low);
    b.nb(t, { kind: 'brown', type: 'bandpass', f: 280, q: 1, a: 0.002, d: 0.03, g: 0.5 * a });
    t += per * rnd(0.85, 1.2);
    per = Math.max(1 / 30, per * 0.82);
  }
});

// the house goes dead: a relay drops out with a clunk and the mains hum sinks away
def('power_out', { d: 1.3, v: 2, gain: 0.5, rev: 0.25, max: 1, jit: 0.02 }, (b) => {
  const t = 0.004;
  b.click(t, 0.6, 0.002);
  b.thump(t, { f0: 160, f1: 60, sweep: 0.04, d: 0.12, g: 0.8 });
  clack(b, t, { g: 0.5, f: 0.6, dec: 0.05 });
  b.tone(t, 120, { type: 'sawtooth', a: 0.002, h: 0.05, d: 0.9, g: 0.12, f2: 38, ft: 0.9, dest: b.fbus('lowpass', 600, 0, 1) });
  b.tone(t, 60, { type: 'sine', a: 0.002, h: 0.05, d: 0.9, g: 0.35, f2: 25, ft: 0.9 });
});

// the lights come back: relay clack, the hum rises, filaments tick
def('power_on', { d: 0.9, v: 2, gain: 0.45, rev: 0.25, max: 1, jit: 0.02 }, (b) => {
  const t = 0.004;
  clack(b, t, { g: 0.7, f: 0.7, dec: 0.05 });
  b.thump(t, { f0: 180, f1: 90, sweep: 0.03, d: 0.08, g: 0.5 });
  b.tone(t + 0.02, 40, { type: 'sawtooth', a: 0.15, h: 0.2, d: 0.4, g: 0.1, f2: 120, ft: 0.3, dest: b.fbus('lowpass', 700, 0, 1) });
  b.tone(t + 0.02, 30, { type: 'sine', a: 0.15, h: 0.2, d: 0.4, g: 0.25, f2: 60, ft: 0.3 });
  for (let i = 0; i < 3; i++) b.modal(t + 0.05 + i * rnd(0.04, 0.1), [[rnd(5000, 7000), 0.1, 0.03]], 0.3);
});

// pipe wrench on a seized nut: a burst of ratchet teeth, the nut gives with a dull clank
def('wrench_ratchet', { d: 0.4, v: 4, gain: 0.45, rev: 0.15, max: 3, jit: 0.05 }, (b) => {
  let t = 0.004;
  const n = 5 + Math.floor(rnd(0, 3));
  for (let i = 0; i < n; i++) {
    const f = rnd(3800, 4600);
    b.click(t, 0.4, 0.0008);
    b.modal(t, [[f, 0.4, 0.025], [f * 1.7, 0.2, 0.015], [rnd(1800, 2200), 0.2, 0.03]], 0.6);
    t += rnd(0.018, 0.028);
  }
  b.thump(t + 0.02, { f0: 240, f1: 130, sweep: 0.03, d: 0.08, g: 0.5 });
  clack(b, t + 0.02, { g: 0.6, f: 0.55, dec: 0.08 });
});

// one can's worth (POWER.refuelTime): fuel running into the filler neck, glugging as air bubbles back
// into the can (a one-shot, stopped early when you let go)
def('fuel_pour', { d: 2.2, v: 2, gain: 0.45, rev: 0.12, max: 1, jit: 0.02 }, (b) => {
  const T = 2.1;
  const bus = b.g(0, b.out);
  bus.gain.setValueAtTime(0, 0);
  bus.gain.linearRampToValueAtTime(1, 0.25);
  bus.gain.setValueAtTime(1, T - 0.25);
  bus.gain.linearRampToValueAtTime(0, T);
  b.noise('white', 0, T).connect(b.f('bandpass', 1400, 0.8)).connect(b.g(0.18, bus));
  b.noise('pink', 0, T).connect(b.f('bandpass', 600, 1.5)).connect(b.g(0.2, bus));
  b.gurgle(0.1, T * 0.55, { rate: 22, f0: 220, f1: 700, g: 0.8, dest: bus });
  b.gurgle(T * 0.42, T * 0.55, { rate: 22, f0: 220, f1: 700, g: 0.8, dest: bus });
  const big = b.fbus('lowpass', 900, 0, 0.9, bus);
  let t = 0.15;
  while (t < T - 0.15) {
    const f = rnd(140, 240);
    b.chirp(t, f, f * rnd(1.6, 2.2), rnd(0.05, 0.08), rnd(0.6, 1), big);
    t += rnd(0.14, 0.22);
  }
  b.noise('brown', 0, T).connect(b.f('bandpass', 320, 6)).connect(b.g(0.25, bus));
});

// picking up a full jerry can: the handle clanks, the steel booms, fuel sloshes
def('can_pickup', { d: 0.8, v: 3, gain: 0.5, rev: 0.12, max: 2, jit: 0.03 }, (b) => {
  const t = 0.004;
  b.cloth(t, 0.12, { g: 0.35, f: 1100 });
  clack(b, t + 0.04, { g: 0.6, f: 0.75, dec: 0.06 });
  const f = rnd(150, 190);
  b.modal(t + 0.05, [[f, 0.5, 0.35], [f * 2.3, 0.35, 0.22], [f * 4.1, 0.2, 0.12], [f * 6.7, 0.1, 0.07]], 0.8);
  b.gurgle(t + 0.08, 0.45, { rate: 26, f0: 200, f1: 650, g: 0.6 });
});

// the emptied can: hollow and light now
def('can_empty', { d: 0.6, v: 3, gain: 0.45, rev: 0.15, max: 2, jit: 0.04 }, (b) => {
  const t = 0.004;
  const f = rnd(210, 260);
  b.thump(t, { f0: 200, f1: 120, sweep: 0.03, d: 0.08, g: 0.5 });
  b.modal(t, [[f, 0.5, 0.4], [f * 2.4, 0.35, 0.25], [f * 4.3, 0.2, 0.14]], 0.8);
  clack(b, t + 0.1, { g: 0.5, f: 0.8, dec: 0.05 });
  b.chirp(t + 0.02, 180, 420, 0.06, 0.3);
});

// ===== Revives (game/revive.js) ===============================================

// kneeling down at a body: gear and cloth shift, a knee thumps onto the floor
def('revive_start', { d: 0.6, v: 3, gain: 0.45, rev: 0.12, max: 2, jit: 0.04 }, (b) => {
  const t = 0.004;
  b.cloth(t, 0.28, { g: 0.7, f: 1200 });
  b.thump(t + rnd(0.12, 0.18), { f0: 140, f1: 70, sweep: 0.04, d: 0.1, g: 0.7 });
  b.nb(t + 0.15, { kind: 'brown', type: 'lowpass', f: 400, a: 0.003, d: 0.08, g: 0.4 });
  b.rattle(t + 0.1, 0.15, 3, { f: 2600, g: 0.12 });
});

// back up: a sharp gasp of air, gear rattling as they get up, a soft rising two-note cue
def('revive_done', { d: 1.2, v: 2, gain: 0.5, rev: 0.15, max: 2, jit: 0.02 }, (b) => {
  const t = 0.004;
  b.nb(t, { kind: 'pink', type: 'bandpass', f: 900, f2: 2100, ft: 0.3, q: 1.2, a: 0.08, h: 0.12, d: 0.18, g: 0.9 });
  b.nb(t + 0.02, { type: 'bandpass', f: 3200, q: 0.9, a: 0.1, h: 0.08, d: 0.15, g: 0.25 });
  b.cloth(t + 0.35, 0.35, { g: 0.6, f: 1100 });
  b.rattle(t + 0.4, 0.25, 4, { f: 2400, g: 0.14 });
  [523.25, 783.99].forEach((f, k) => {
    b.tone(t + 0.12 + k * 0.1, f, { a: 0.01, d: 0.5, g: 0.22 });
    b.tone(t + 0.12 + k * 0.1, f * 2, { a: 0.01, d: 0.2, g: 0.05 });
  });
});

// ===== Ambience loops =======================================================

def('rain_loop', { d: 8, xf: 0.6, loop: true, v: 1, ch: 2, gain: 0.5, rev: 0, max: 2, jit: 0 }, (b) => {
  const T = b.dur;
  for (const side of [-1, 1]) {
    const p = b.pan(side * 0.85);
    b.noise('white', 0, T).connect(b.f('highpass', 600)).connect(b.f('lowpass', 8000)).connect(b.g(0.32, p));
    b.crackle(0, T, 1400, 1, b.fbus('bandpass', rnd(2600, 3200), 0.6, 0.9, p), { flat: true, skew: 3, w: 2 });
    const dr = b.g(0.5, p);
    let tt = rnd(0, 0.2);
    while (tt < T - 0.05) {
      const f = rnd(1200, 3800);
      b.chirp(tt, f, f * rnd(1.15, 1.6), rnd(0.012, 0.035), Math.pow(rnd(0.15, 1), 2), dr);
      tt += expRand(7);
    }
  }
  b.noise('pink', 0, T).connect(b.f('lowpass', 2200)).connect(b.g(0.45, b.out));
  b.noise('brown', 0, T).connect(b.f('lowpass', 200)).connect(b.g(0.5, b.out));
});

def('_rain_roof', { d: 6, xf: 0.5, loop: true, v: 1, ch: 2, sr: 24000, gain: 0.45, rev: 0, max: 1, jit: 0 }, (b) => {
  const T = b.dur;
  for (const side of [-0.6, 0.6]) {
    const p = b.pan(side);
    const drum = b.g(1);
    const pk = b.f('peaking', 260, 1.2);
    pk.gain.value = 8;
    drum.connect(b.f('lowpass', 1600)).connect(pk).connect(b.g(0.9, p));
    b.crackle(0, T, 600, 1, drum, { flat: true, skew: 2.2, w: 4 });
    const drops = b.g(0.6, p);
    let t = 0;
    while (t < T) {
      const f = rnd(250, 700);
      b.chirp(t, f, f * rnd(0.8, 1.1), rnd(0.01, 0.025), rnd(0.2, 1), drops);
      t += expRand(45);
    }
  }
  b.noise('brown', 0, T).connect(b.f('lowpass', 350)).connect(b.g(0.5, b.out));
});

def('wind_loop', { d: 8, xf: 0.6, loop: true, v: 1, ch: 2, sr: 24000, gain: 0.45, rev: 0, max: 2, jit: 0 }, (b) => {
  const T = b.dur;
  const L = b.L;
  const hz = (k) => k / L; // integer cycles per loop → seamless modulation
  for (const [pan, k1, k2] of [[-0.7, 1, 2], [0.7, 2, 3]]) {
    const p = b.pan(pan);
    const bp = b.f('bandpass', rnd(380, 460), 0.8);
    b.osc('sine', hz(k1), 0, T).connect(b.g(160)).connect(bp.frequency);
    b.osc('sine', hz(k2 + 2), 0, T).connect(b.g(80)).connect(bp.frequency);
    const am = b.g(0.55);
    b.osc('sine', hz(k1 + 1), 0, T).connect(b.g(0.3)).connect(am.gain);
    b.osc('sine', hz(k2 + 4), 0, T).connect(b.g(0.12)).connect(am.gain);
    b.noise('pink', 0, T).connect(bp);
    bp.connect(am);
    am.connect(b.g(1, p));
    const wbp = b.f('bandpass', rnd(700, 950), 16);
    b.osc('sine', hz(k2), 0, T).connect(b.g(140)).connect(wbp.frequency);
    const wam = b.g(0.25);
    b.osc('sine', hz(k1 + 2), 0, T).connect(b.g(0.25)).connect(wam.gain);
    b.noise('white', 0, T).connect(wbp);
    wbp.connect(wam);
    wam.connect(b.g(0.5, p));
  }
  b.noise('brown', 0, T).connect(b.f('lowpass', 160)).connect(b.g(0.4, b.out));
});

def('_thunder', { d: 7, v: 3, ch: 2, sr: 22050, gain: 0.75, rev: 0, max: 3, jit: 0 }, (b) => {
  const T = b.dur;
  const rolls = (n, decay) => {
    const c = new Float32Array(n);
    const bumps = [];
    const nb = 3 + Math.floor(Math.random() * 4);
    for (let k = 0; k < nb; k++) bumps.push([rnd(0, 4.5), rnd(0.35, 1), rnd(0.25, 0.9)]);
    for (let i = 0; i < n; i++) {
      const tt = (i / (n - 1)) * T;
      let v = 0.25 * Math.exp(-tt / decay);
      for (const [c0, a, w] of bumps) v += a * Math.exp(-Math.pow((tt - c0) / w, 2)) * Math.exp(-tt / (decay * 1.6));
      c[i] = v * Math.min(1, tt / 0.12);
    }
    c[n - 1] = 0;
    return c;
  };
  for (const side of [-0.85, 0.85]) {
    const p = b.pan(side);
    const am = b.g(0);
    b.noise('brown', 0, T).connect(b.f('lowpass', rnd(260, 420))).connect(am);
    am.connect(b.g(1, p));
    am.gain.setValueCurveAtTime(rolls(200, 2.2), 0, T);
    const mam = b.g(0);
    b.noise('pink', 0, T).connect(b.f('lowpass', rnd(700, 1100))).connect(mam);
    mam.connect(b.g(0.35, p));
    mam.gain.setValueCurveAtTime(rolls(200, 1.2), 0, T);
  }
  b.thump(0.02, { f0: 58, f1: 26, sweep: 0.6, a: 0.06, d: 2.2, g: 0.7 });
});

// ---------------------------------------------------------------------------
// Runtime helpers
// ---------------------------------------------------------------------------

const DUMMY_HANDLE = Object.freeze({
  stop() {},
  setPosition() {},
  setVolume() {},
  setPitch() {},
  playing: false,
});

/** Same curve as PannerNode 'inverse' distance model. */
function distGain(d, ref = REF_DIST) {
  const dd = clamp(d, ref, Math.max(ref, MAX_DIST));
  return ref / (ref + ROLLOFF * (dd - ref));
}

function setPannerPos(pn, p) {
  if (pn.positionX) {
    pn.positionX.value = p.x;
    pn.positionY.value = p.y;
    pn.positionZ.value = p.z;
  } else {
    pn.setPosition(p.x, p.y, p.z);
  }
}

// ---------------------------------------------------------------------------
// AudioSystem
// ---------------------------------------------------------------------------

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.initTimeMs = 0;
    this._ready = false;
    this._initPromise = null;
    this._sounds = new Map(); // name -> { cfg, buffers, last }
    this._voices = [];
    this._noise = null;
    this._masterVol = 0.8;
    this._indoor = 0;
    this._indoorSent = -1;
    this._gas = 0;
    this._lowHp = 0;
    this._lis = { x: 0, y: 0, z: 0 };
    this._lastDistUpdate = 0;
    this._maxCut = 20000;
    this._ambNodes = null;
    this._ambWanted = false;
    this._ambTimer = null;
    this._hb = null;
    this._gasNodes = null;
    this._thunders = 0;
  }

  get ready() {
    return this._ready;
  }

  /** Create the AudioContext (call from a user gesture) and render all sounds. Idempotent. */
  async init() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this._initPromise) {
      this._initPromise = this._init().catch((err) => {
        console.error('[audio] init failed:', err);
        this._initPromise = null;
      });
    }
    return this._initPromise;
  }

  async _init() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) throw new Error('Web Audio API not available');
    const t0 = performance.now();
    if (!this.ctx) {
      try {
        this.ctx = new AC({ latencyHint: 'interactive' });
      } catch {
        this.ctx = new AC();
      }
    }
    const ctx = this.ctx;
    this._installResume();
    this._maxCut = Math.min(20000, ctx.sampleRate * 0.45);
    if (!this._noise) this._noise = makeNoise(ctx, 4);
    if (!this._master) this._buildBus();
    await this._renderAll();
    this._ready = true;
    this.initTimeMs = performance.now() - t0;
    this._applyIndoor(0.01);
    if (this._gas > 0) this.setGasLevel(this._gas);
    if (this._lowHp > 0) this.setLowHealth(this._lowHp);
    this._updateGlobalLP();
    if (this._ambWanted) this.startAmbience();
  }

  _installResume() {
    if (this._resumeInstalled || typeof window === 'undefined') return;
    this._resumeInstalled = true;
    const resume = () => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    };
    for (const ev of ['pointerdown', 'keydown', 'touchstart', 'mousedown']) {
      window.addEventListener(ev, resume, { passive: true, capture: true });
    }
    if (this.ctx.state === 'suspended') resume();
  }

  _buildBus() {
    const c = this.ctx;
    const gain = (v, dest) => {
      const n = c.createGain();
      n.gain.value = v;
      if (dest) n.connect(dest);
      return n;
    };
    const filter = (type, f, dest) => {
      const n = c.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = 0;
      if (dest) n.connect(dest);
      return n;
    };
    // Safety limiter, then a gentle glue compressor before it.
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;
    limiter.connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(limiter);

    this._master = gain(this._masterVol, comp);
    this._post = gain(1, this._master); // unfiltered overlay (heartbeat, gas ringing)
    this._globalLP = filter('lowpass', this._maxCut, this._master);
    this._sfx = gain(1, this._globalLP);
    this._duck = gain(1, this._globalLP); // ambience duck
    this._weatherLP = filter('lowpass', this._maxCut, this._duck); // thunder (muffled indoors)

    // Shared reverb: two convolvers crossfaded by indoor factor.
    this._revIn = gain(1);
    const revHP = filter('highpass', 180);
    this._revIn.connect(revHP);
    const ret = gain(0.55, this._globalLP);
    const convIn = c.createConvolver();
    convIn.buffer = makeIR(c, { len: 0.9, rt60: 0.55, pre: 0.002, er: 18, erSpan: 0.035, erGain: 0.7, lp0: 7500, lp1: 1500, fade: 0.004, tail: 1.2 });
    const convOut = c.createConvolver();
    convOut.buffer = makeIR(c, { len: 2.2, rt60: 1.6, pre: 0.012, er: 6, erSpan: 0.25, erGain: 0.35, lp0: 4200, lp1: 600, fade: 0.05, tail: 1.0 });
    this._revInG = gain(0.15, ret);
    this._revOutG = gain(0.85, ret);
    revHP.connect(convIn);
    convIn.connect(this._revInG);
    revHP.connect(convOut);
    convOut.connect(this._revOutG);
  }

  async _renderAll() {
    const sr = this.ctx.sampleRate;
    this._sounds.clear();
    const jobs = [];
    for (const name of Object.keys(DEFS)) {
      const cfg = DEFS[name];
      const entry = { cfg, buffers: [], last: -1 };
      this._sounds.set(name, entry);
      for (let i = 0; i < cfg.v; i++) jobs.push({ name, entry, cfg, i });
    }
    const cost = (j) => j.cfg.d * j.cfg.ch * (j.cfg.sr ? j.cfg.sr / sr : 1);
    jobs.sort((a, b) => cost(b) - cost(a));
    let next = 0;
    const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
    const conc = clamp(hc, 4, 8);
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        try {
          const buf = await this._renderJob(j.cfg, j.i, sr);
          if (buf) j.entry.buffers.push(buf);
        } catch (err) {
          console.warn(`[audio] failed to render "${j.name}"`, err);
        }
      }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    for (const [name, e] of this._sounds) if (!e.buffers.length) this._sounds.delete(name);
  }

  async _renderJob(cfg, i, sr) {
    const rate = cfg.sr ? Math.min(cfg.sr, sr) : sr;
    const total = cfg.loop ? cfg.d + (cfg.xf || 0) : cfg.d;
    const b = new Builder(this._noise, rate, total, cfg.ch, cfg.d);
    cfg.fn(b, i);
    const buf = await b.render();
    return this._finalize(buf, cfg, rate);
  }

  /** Loop crossfade, trailing-silence trim, peak normalize to -1 dBFS, fade-out. */
  _finalize(buf, cfg, rate) {
    const ch = buf.numberOfChannels;
    let len = buf.length;
    const data = [];
    for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    if (cfg.loop && cfg.xf) {
      const L = Math.round(cfg.d * rate);
      const X = Math.min(len - L, L);
      if (X > 0) {
        for (const d of data) {
          for (let k = 0; k < X; k++) {
            const w = k / X;
            const a = cfg.xfLinear ? w : Math.sin((w * Math.PI) / 2);
            const bb = cfg.xfLinear ? 1 - w : Math.cos((w * Math.PI) / 2);
            d[k] = d[k] * a + d[L + k] * bb;
          }
        }
        len = L;
      }
    }
    let peak = 0;
    for (const d of data) for (let k = 0; k < len; k++) {
      const v = d[k] < 0 ? -d[k] : d[k];
      if (v > peak) peak = v;
    }
    if (!(peak > 1e-7)) return null;
    if (!cfg.loop && cfg.trim !== false) {
      const th = peak * 0.001; // -60 dB
      let last = 0;
      for (const d of data) {
        for (let k = len - 1; k > last; k--) {
          if ((d[k] < 0 ? -d[k] : d[k]) > th) {
            last = k;
            break;
          }
        }
      }
      len = Math.max(64, Math.min(len, last + Math.ceil(rate * 0.012)));
    }
    const out = this.ctx.createBuffer(ch, len, rate);
    const s = PEAK / peak;
    const fade = cfg.loop ? 0 : Math.min(len >> 2, Math.ceil(rate * 0.008));
    for (let c = 0; c < ch; c++) {
      const o = out.getChannelData(c);
      const d = data[c];
      for (let k = 0; k < len; k++) o[k] = d[k] * s;
      for (let k = 0; k < fade; k++) o[len - 1 - k] *= k / fade;
    }
    return out;
  }

  // ---- listener / voices -----------------------------------------------------

  setListener(position, forward, up) {
    if (!position) return;
    const L = this._lis;
    L.x = position.x;
    L.y = position.y;
    L.z = position.z;
    if (!this.ctx) return;
    const f = forward || { x: 0, y: 0, z: -1 };
    const u = up || { x: 0, y: 1, z: 0 };
    const li = this.ctx.listener;
    if (li.positionX) {
      li.positionX.value = L.x;
      li.positionY.value = L.y;
      li.positionZ.value = L.z;
      li.forwardX.value = f.x;
      li.forwardY.value = f.y;
      li.forwardZ.value = f.z;
      li.upX.value = u.x;
      li.upY.value = u.y;
      li.upZ.value = u.z;
    } else {
      li.setPosition(L.x, L.y, L.z);
      li.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
    const now = this.ctx.currentTime;
    if (now - this._lastDistUpdate > 0.1) {
      this._lastDistUpdate = now;
      for (const v of this._voices) if (v.spatial && !v.dead) this._applyDistance(v, this._dist(v.pos), false);
    }
  }

  _dist(p) {
    const L = this._lis;
    const dx = p.x - L.x;
    const dy = p.y - L.y;
    const dz = p.z - L.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _airCut(d) {
    return clamp(20000 / (1 + d * 0.09), 1800, this._maxCut);
  }

  _applyDistance(v, d, init) {
    const cut = this._airCut(d);
    const dg = distGain(d, v.ref);
    const send = v.rev * Math.pow(dg, 0.7);
    v.est = v.vol * v.gain * dg;
    if (init) {
      v.lp.frequency.value = cut;
      v.send.gain.value = send;
      v.cut = cut;
      return;
    }
    if (Math.abs(cut - v.cut) / v.cut > 0.03) {
      v.cut = cut;
      v.lp.frequency.setTargetAtTime(cut, this.ctx.currentTime, 0.05);
    }
    v.send.gain.setTargetAtTime(send, this.ctx.currentTime, 0.05);
  }

  /**
   * Play a sound. opts: { position?, volume?, pitch?, loop?, reverb? }.
   * Returns a handle { stop(fade), setPosition(p), setVolume(v), setPitch(p) }.
   */
  play(name, opts = {}) {
    if (!this._ready) return DUMMY_HANDLE;
    const e = this._sounds.get(name);
    if (!e) return DUMMY_HANDLE;
    const ctx = this.ctx;
    const loop = !!opts.loop;
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      if (!loop) return DUMMY_HANDLE; // don't queue one-shots while suspended
    }
    const cfg = e.cfg;
    const pos = opts.position;
    const spatial = !!pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) && Number.isFinite(pos.z);
    const vol = Math.max(0, opts.volume ?? 1);
    const dist = spatial ? this._dist(pos) : 0;
    if (spatial && !loop && dist > MAX_DIST * 1.25) return DUMMY_HANDLE;
    const est = vol * cfg.gain * (spatial ? distGain(dist, cfg.ref) : 1);
    const now = ctx.currentTime;
    if (!this._makeRoom(name, cfg, est, now)) return DUMMY_HANDLE;

    const n = e.buffers.length;
    let idx = 0;
    if (n > 1) {
      idx = Math.floor(Math.random() * (n - 1));
      if (idx >= e.last) idx++;
    }
    e.last = idx;
    const buf = e.buffers[idx];

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    const rate = opts.pitch != null ? Math.max(0.05, opts.pitch) : 1 + (Math.random() * 2 - 1) * cfg.jit;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = vol * cfg.gain;
    src.connect(g);
    const send = ctx.createGain();
    send.connect(this._revIn);
    const v = {
      name, src, g, send, lp: null, pn: null, pos: null, spatial, loop,
      start: now, dur: buf.duration / rate, vol, gain: cfg.gain, ref: cfg.ref,
      rev: opts.reverb != null ? clamp(+opts.reverb || 0, 0, 1) : cfg.rev,
      est, cut: 0, dead: false, cleaned: false,
    };
    if (spatial) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0;
      const pn = ctx.createPanner();
      pn.panningModel = dist < HRTF_NEAR ? 'HRTF' : 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = cfg.ref;
      pn.rolloffFactor = ROLLOFF;
      pn.maxDistance = MAX_DIST;
      g.connect(lp);
      lp.connect(pn);
      pn.connect(this._sfx);
      lp.connect(send);
      v.lp = lp;
      v.pn = pn;
      v.pos = { x: pos.x, y: pos.y, z: pos.z };
      setPannerPos(pn, pos);
      this._applyDistance(v, dist, true);
    } else {
      g.connect(this._sfx);
      g.connect(send);
      send.gain.value = v.rev;
    }
    src.onended = () => this._cleanup(v);
    src.start(now);
    this._voices.push(v);
    if (this._voices.length > 256) this._prune();
    return this._handle(v);
  }

  _makeRoom(name, cfg, est, now) {
    let active = 0;
    let same = 0;
    let oldest = null;
    for (const v of this._voices) {
      if (v.dead) continue;
      active++;
      if (v.name === name) {
        same++;
        if (!oldest || v.start < oldest.start) oldest = v;
      }
    }
    if (same >= cfg.max && oldest) {
      this._kill(oldest, 0.025);
      active--;
    }
    if (active >= MAX_VOICES) {
      let worst = null;
      let ws = Infinity;
      for (const v of this._voices) {
        if (v.dead || v.loop) continue;
        const remain = clamp(1 - (now - v.start) / v.dur, 0, 1);
        const score = v.est * (0.2 + remain);
        if (score < ws) {
          ws = score;
          worst = v;
        }
      }
      if (!worst || ws > est * 1.2) return false; // the new sound is the least important one
      this._kill(worst, 0.02);
    }
    return true;
  }

  _kill(v, fade) {
    if (v.dead) return;
    v.dead = true;
    const t = this.ctx.currentTime;
    const p = v.g.gain;
    try {
      p.cancelScheduledValues(t);
      p.setValueAtTime(p.value, t);
      p.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.01);
    } catch {
      this._cleanup(v);
    }
  }

  _cleanup(v) {
    if (v.cleaned) return;
    v.cleaned = true;
    v.dead = true;
    const i = this._voices.indexOf(v);
    if (i >= 0) this._voices.splice(i, 1);
    try {
      v.src.disconnect();
      v.g.disconnect();
      v.send.disconnect();
      if (v.lp) v.lp.disconnect();
      if (v.pn) v.pn.disconnect();
    } catch {
      /* already disconnected */
    }
  }

  _prune() {
    for (const v of this._voices.slice()) if (v.dead) this._cleanup(v);
  }

  _handle(v) {
    const self = this;
    return {
      stop(fade = 0.05) {
        self._kill(v, Math.max(0.005, +fade || 0.005));
      },
      setPosition(p) {
        if (!v.pn || v.dead || !p) return;
        v.pos.x = p.x;
        v.pos.y = p.y;
        v.pos.z = p.z;
        setPannerPos(v.pn, p);
        self._applyDistance(v, self._dist(p), false);
      },
      setVolume(x) {
        if (v.dead) return;
        v.vol = Math.max(0, +x || 0);
        v.g.gain.setTargetAtTime(v.vol * v.gain, self.ctx.currentTime, 0.015);
      },
      setPitch(p) {
        if (v.dead) return;
        v.src.playbackRate.setTargetAtTime(Math.max(0.05, +p || 1), self.ctx.currentTime, 0.015);
      },
      get playing() {
        return !v.dead;
      },
    };
  }

  // ---- global controls --------------------------------------------------------

  setMasterVolume(v) {
    this._masterVol = clamp(+v || 0, 0, 1);
    if (this._master) this._master.gain.setTargetAtTime(this._masterVol, this.ctx.currentTime, 0.03);
  }

  setIndoor(factor) {
    this._indoor = clamp(+factor || 0, 0, 1);
    if (this._ready && Math.abs(this._indoor - this._indoorSent) > 0.005) this._applyIndoor(0.12);
  }

  _applyIndoor(tc) {
    if (!this._ready) return;
    const f = this._indoor;
    this._indoorSent = f;
    const t = this.ctx.currentTime;
    const set = (p, v) => p.setTargetAtTime(v, t, tc);
    set(this._revInG.gain, 0.15 + 0.85 * f);
    set(this._revOutG.gain, 0.05 + 0.8 * (1 - f));
    set(this._weatherLP.frequency, expLerp(this._maxCut, 1100, f));
    const A = this._ambNodes;
    if (A) {
      set(A.rainOut.gain, (1 - f) * 0.45); // outdoors: present, but under the gunfight (~-7 dB)
      set(A.rainIn.gain, f * 1.4);
      set(A.roof.gain, 0.12 + 0.88 * f);
      set(A.windIn.gain, 1 - 0.55 * f);
      set(A.windLP.frequency, expLerp(Math.min(9000, this._maxCut), 650, f));
    }
  }

  setGasLevel(v) {
    this._gas = clamp(+v || 0, 0, 1);
    if (!this._ready) return;
    if (this._gas > 0 && !this._gasNodes) this._makeGas();
    if (this._gasNodes) this._gasNodes.level.gain.setTargetAtTime(this._gas, this.ctx.currentTime, 0.3);
    this._updateGlobalLP();
  }

  _makeGas() {
    const c = this.ctx;
    const level = c.createGain();
    level.gain.value = 0;
    level.connect(this._post);
    // Faint beating tinnitus-like ringing.
    const ring = c.createGain();
    ring.gain.value = 0.018;
    ring.connect(level);
    const oscs = [3150, 3163].map((f) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(ring);
      o.start();
      return o;
    });
    // Labored breathing layer.
    let src = null;
    const e = this._sounds.get('breath_heavy');
    if (e) {
      src = c.createBufferSource();
      src.buffer = e.buffers[0];
      src.loop = true;
      src.playbackRate.value = 0.92;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1500;
      const g = c.createGain();
      g.gain.value = e.cfg.gain * 0.9;
      src.connect(lp);
      lp.connect(g);
      g.connect(level);
      src.start();
    }
    this._gasNodes = { level, oscs, src };
  }

  setLowHealth(v) {
    this._lowHp = clamp(+v || 0, 0, 1);
    if (!this._ready) return;
    const c = this.ctx;
    if (this._lowHp > 0 && !this._hb) {
      const e = this._sounds.get('heartbeat');
      if (e) {
        const src = c.createBufferSource();
        src.buffer = e.buffers[0];
        src.loop = true;
        const g = c.createGain();
        g.gain.value = 0;
        src.connect(g);
        g.connect(this._post);
        src.start();
        this._hb = { src, g, gain: e.cfg.gain };
      }
    }
    if (this._hb) {
      const t = c.currentTime;
      this._hb.g.gain.setTargetAtTime(this._hb.gain * Math.sqrt(this._lowHp), t, 0.25);
      this._hb.src.playbackRate.setTargetAtTime(0.92 + 0.4 * this._lowHp, t, 0.5);
    }
    this._updateGlobalLP();
  }

  _updateGlobalLP() {
    if (!this._globalLP) return;
    const f = clamp(this._maxCut * Math.pow(0.3, this._gas) * Math.pow(0.2, this._lowHp), 700, this._maxCut);
    this._globalLP.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.25);
  }

  duck(amount = 0.5, seconds = 1) {
    if (!this._ready) return;
    const p = this._duck.gain;
    const t = this.ctx.currentTime;
    const target = clamp(1 - (+amount || 0), 0, 1);
    const s = Math.max(0.05, +seconds || 0);
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(target, t + 0.04);
    p.setValueAtTime(target, t + 0.04 + s * 0.3);
    p.linearRampToValueAtTime(1, t + 0.04 + s);
  }

  // ---- ambience ---------------------------------------------------------------

  startAmbience() {
    this._ambWanted = true;
    if (!this._ready || this._ambNodes) return;
    const c = this.ctx;
    const t = c.currentTime;
    const gain = (v, dest) => {
      const n = c.createGain();
      n.gain.value = v;
      if (dest) n.connect(dest);
      return n;
    };
    const lowpass = (f, dest) => {
      const n = c.createBiquadFilter();
      n.type = 'lowpass';
      n.frequency.value = f;
      n.Q.value = 0;
      if (dest) n.connect(dest);
      return n;
    };
    const loopSrc = (name) => {
      const e = this._sounds.get(name);
      if (!e) return null;
      const s = c.createBufferSource();
      s.buffer = e.buffers[Math.floor(Math.random() * e.buffers.length)];
      s.loop = true;
      return { s, gain: e.cfg.gain };
    };
    const A = { sources: [] };
    A.level = gain(0, this._duck);
    A.rainOut = gain(0, A.level);
    A.rainIn = gain(0, A.level);
    A.rainLP = lowpass(600, A.rainIn);
    A.rainGust = gain(1);
    A.rainGust.connect(A.rainOut);
    A.rainGust.connect(A.rainLP);
    A.roof = gain(0, A.level);
    A.windIn = gain(1, A.level);
    A.windLP = lowpass(9000, A.windIn);
    A.windGust = gain(1, A.windLP);

    const rain = loopSrc('rain_loop');
    if (rain) rain.s.connect(gain(rain.gain, A.rainGust));
    const roof = loopSrc('_rain_roof');
    if (roof) roof.s.connect(gain(roof.gain, A.roof));
    const wind = loopSrc('wind_loop');
    if (wind) wind.s.connect(gain(wind.gain, A.windGust));
    for (const x of [rain, roof, wind]) {
      if (!x) continue;
      x.s.start(t, Math.random() * x.s.buffer.duration);
      A.sources.push(x.s);
    }
    A.level.gain.setTargetAtTime(1, t, 0.6);
    this._ambNodes = A;
    this._applyIndoor(0.01);

    const now = c.currentTime;
    this._nextGust = now + rnd(3, 8);
    this._nextCreak = now + rnd(4, 10);
    this._nextMoan = now + rnd(5, 12);
    clearInterval(this._ambTimer);
    this._ambTimer = setInterval(() => this._ambTick(), 250);
  }

  stopAmbience() {
    this._ambWanted = false;
    clearInterval(this._ambTimer);
    this._ambTimer = null;
    const A = this._ambNodes;
    if (!A) return;
    this._ambNodes = null;
    const t = this.ctx.currentTime;
    A.level.gain.cancelScheduledValues(t);
    A.level.gain.setValueAtTime(A.level.gain.value, t);
    A.level.gain.linearRampToValueAtTime(0, t + 1.2);
    for (const s of A.sources) {
      try {
        s.stop(t + 1.3);
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => {
      try {
        A.level.disconnect();
      } catch {
        /* ignore */
      }
    }, 1600);
  }

  _around(dist, yOff) {
    const a = Math.random() * TAU;
    const L = this._lis;
    return { x: L.x + Math.cos(a) * dist, y: L.y + yOff, z: L.z + Math.sin(a) * dist };
  }

  _ambTick() {
    const A = this._ambNodes;
    if (!A || !this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    if (now >= this._nextGust) {
      this._nextGust = now + rnd(6, 16);
      const peak = rnd(1.6, 2.6);
      const up = rnd(0.8, 2.2);
      const hold = rnd(0.3, 1.5);
      const down = rnd(1.5, 3.5);
      const gust = (p, pk) => {
        p.cancelScheduledValues(now);
        p.setValueAtTime(p.value, now);
        p.linearRampToValueAtTime(pk, now + up);
        p.setValueAtTime(pk, now + up + hold);
        p.linearRampToValueAtTime(rnd(0.85, 1.05), now + up + hold + down);
      };
      gust(A.windGust.gain, peak);
      gust(A.rainGust.gain, 1 + (peak - 1) * 0.25);
    }
    if (now >= this._nextCreak) {
      this._nextCreak = now + rnd(7, 20);
      if (chance(0.35 + 0.65 * this._indoor)) {
        this.play('wood_creak', { position: this._around(rnd(4, 14), rnd(-1, 4)), volume: rnd(0.9, 1.6), reverb: 0.5 });
      }
    }
    if (now >= this._nextMoan) {
      this._nextMoan = now + rnd(9, 22);
      const r = Math.random();
      const name = r < 0.82 ? 'zombie_groan' : r < 0.93 ? 'striker_shriek' : 'crusher_roar';
      this.play(name, {
        position: this._around(rnd(28, 55), rnd(-1, 2)),
        volume: name === 'zombie_groan' ? rnd(2.2, 3.2) : rnd(1.2, 1.8),
        pitch: rnd(0.8, 1.02),
        reverb: 0.85,
      });
    }
  }

  /** Rolling thunder: crack (close strikes) + multi-second stereo rumble. Non-spatial. */
  thunder(intensity = 1, delaySec = 0) {
    if (!this._ready) return;
    const c = this.ctx;
    if (c.state !== 'running' || this._thunders >= 3) return;
    const I = clamp(+intensity || 0, 0, 1.5);
    const t = c.currentTime + Math.max(0, +delaySec || 0);
    const nodes = [];
    const finish = () => {
      this._thunders--;
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      }
    };
    const e = this._sounds.get('_thunder');
    if (!e) return;
    this._thunders++;
    const s = c.createBufferSource();
    s.buffer = e.buffers[Math.floor(Math.random() * e.buffers.length)];
    s.playbackRate.value = rnd(0.85, 1.1);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0;
    lp.frequency.value = Math.min(this._maxCut, 250 + 4500 * I * I);
    const g = c.createGain();
    g.gain.value = e.cfg.gain * (0.3 + 0.7 * Math.min(1, I));
    const send = c.createGain();
    send.gain.value = 0.12;
    s.connect(lp);
    lp.connect(g);
    g.connect(this._weatherLP);
    g.connect(send);
    send.connect(this._revIn);
    nodes.push(s, lp, g, send);
    s.onended = finish;
    s.start(t);
    if (I > 0.55) {
      const k = this._sounds.get('lightning_crack');
      if (k) {
        const cs = c.createBufferSource();
        cs.buffer = k.buffers[Math.floor(Math.random() * k.buffers.length)];
        cs.playbackRate.value = rnd(0.9, 1.05);
        const cg = c.createGain();
        cg.gain.value = k.cfg.gain * clamp((I - 0.45) * 1.2, 0, 1);
        cs.connect(cg);
        cg.connect(this._weatherLP);
        cs.onended = () => {
          try {
            cs.disconnect();
            cg.disconnect();
          } catch {
            /* ignore */
          }
        };
        cs.start(t);
      }
    }
  }

  /** True if a sound with this name was rendered. */
  has(name) {
    return this._sounds.has(name);
  }
}
