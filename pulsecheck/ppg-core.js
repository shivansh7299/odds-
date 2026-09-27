/*
 * ppg-core.js — camera/wearable PPG processing with a transparent signal-quality score.
 * No dependencies; runs in the browser and in Node (for tests).
 *
 *   const p = new PPGProcessor();
 *   p.pushPPG(tSeconds, redMean, { clip, finger });   // every camera frame
 *   p.pushMotion(tSeconds, accelMagnitude);            // phone accelerometer (m/s², gravity removed)
 *   p.setReference("Garmin", bpm, tSeconds);           // optional watch HR for agreement
 *   const r = p.compute(tNow);                         // ~2x per second
 *   r.hr, r.status ("good"|"fair"|"poor"|"nofinger"|"warming"), r.score, r.components, r.reasons
 */

// Every threshold in one place so the team can tune on real phones.
export const CONFIG = {
  fs: 30,               // resample rate (Hz)
  window: 8,            // analysis window (s)
  bandLow: 0.7,         // Hz  (42 bpm)
  bandHigh: 3.5,        // Hz  (210 bpm)
  minIBI: 0.28,         // s   (214 bpm)
  maxIBI: 1.5,          // s   (40 bpm)
  motionOk: 0.35,       // m/s² RMS: below this counts as still
  motionBad: 1.5,       // m/s² RMS: above this the window is unusable
  piLow: 0.03,          // perfusion index % where the score hits 0
  piGood: 0.25,         // perfusion index % where the score reaches 1
  clipBad: 0.35,        // fraction of saturated red pixels that means "pressing too hard / too bright"
  minFps: 15,
  weights: { template: 0.3, clarity: 0.2, rhythm: 0.2, perfusion: 0.1, motion: 0.2 },
};

// ---------------- signal helpers ----------------
function biquad(type, f0, fs, Q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * f0) / fs, c = Math.cos(w0), al = Math.sin(w0) / (2 * Q);
  const a0 = 1 + al;
  const b = type === "low" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0 };
}
function runBiquad(x, k) {
  const y = new Float64Array(x.length);
  let x1 = x[0], x2 = x[0], y1 = x[0] * (k.b0 + k.b1 + k.b2) / (1 + k.a1 + k.a2), y2 = y1;
  if (!isFinite(y1)) y1 = y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = k.b0 * x[i] + k.b1 * x1 + k.b2 * x2 - k.a1 * y1 - k.a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
const reverse = (a) => Float64Array.from(a).reverse();

/** Zero-phase band-pass (2nd-order high-pass + low-pass, run forward and backward). */
export function bandpass(x, fs = CONFIG.fs, lo = CONFIG.bandLow, hi = CONFIG.bandHigh) {
  const pad = Math.min(x.length - 1, Math.round(fs * 1.5));
  // reflect-pad to tame edge transients
  const n = x.length, ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) { ext[i] = 2 * x[0] - x[pad - i]; ext[n + pad + i] = 2 * x[n - 1] - x[n - 2 - i]; }
  ext.set(x, pad);
  const hp = biquad("high", lo, fs), lp = biquad("low", hi, fs);
  let y = runBiquad(runBiquad(ext, hp), lp);
  y = reverse(runBiquad(runBiquad(reverse(y), hp), lp));
  return y.slice(pad, pad + n);
}

/** Linear-interpolate irregular samples (t ascending) onto a uniform grid ending at tEnd. */
export function resample(ts, vs, tEnd, seconds = CONFIG.window, fs = CONFIG.fs) {
  const n = Math.floor(seconds * fs), out = new Float64Array(n), t0 = tEnd - seconds;
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / fs;
    while (j < ts.length - 2 && ts[j + 1] < t) j++;
    const ta = ts[j], tb = ts[j + 1] ?? ta, va = vs[j], vb = vs[j + 1] ?? va;
    out[i] = tb > ta ? va + ((vb - va) * Math.min(1, Math.max(0, (t - ta) / (tb - ta)))) : va;
  }
  return out;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };
const clamp01 = (v) => Math.max(0, Math.min(1, v));
function pearson(a, b) {
  const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : 0;
}

/** Systolic peaks: local maxima above an adaptive threshold, at least minIBI apart, sub-sample refined. */
/** Dominant beat period (samples) from autocorrelation; prefers the shortest lag near the maximum. */
export function beatPeriod(x, fs = CONFIG.fs) {
  const lo = Math.floor(0.28 * fs), hi = Math.ceil(CONFIG.maxIBI * fs), n = x.length;
  const ac = [];
  for (let L = lo; L <= hi && L < n - 1; L++) { let s = 0; for (let i = 0; i + L < n; i++) s += x[i] * x[i + L]; ac.push([L, s / (n - L)]); }
  const peaks = ac.filter((v, i) => i > 0 && i < ac.length - 1 && v[1] > ac[i - 1][1] && v[1] >= ac[i + 1][1] && v[1] > 0);
  if (!peaks.length) return null;
  const best = Math.max(...peaks.map((p) => p[1]));
  return peaks.find((p) => p[1] >= 0.85 * best)[0];
}

export function findPeaks(x, fs = CONFIG.fs) {
  const period = beatPeriod(x, fs);
  const hi = pct(Array.from(x), 95), thr = 0.35 * hi;
  const minD = period ? Math.max(Math.round(0.28 * fs), Math.round(0.6 * period)) : Math.round(CONFIG.minIBI * fs);
  const cand = [];
  for (let i = 1; i < x.length - 1; i++) if (x[i] > thr && x[i] > x[i - 1] && x[i] >= x[i + 1]) cand.push(i);
  cand.sort((a, b) => x[b] - x[a]);
  const kept = [];
  for (const c of cand) if (kept.every((k) => Math.abs(k - c) >= minD)) kept.push(c);
  kept.sort((a, b) => a - b);
  return kept.map((i) => {
    const y0 = x[i - 1], y1 = x[i], y2 = x[i + 1], d = y0 - 2 * y1 + y2;
    return i + (d ? (0.5 * (y0 - y2)) / d : 0); // parabolic interpolation (sample units)
  });
}

// ---------------- processor ----------------
export class PPGProcessor {
  constructor(cfg = {}) {
    this.cfg = { ...CONFIG, ...cfg };
    this.ppg = { t: [], v: [], clip: [], finger: [] };
    this.motion = { t: [], v: [] };
    this.refs = {};              // name -> { bpm, t }
    this.beats = [];             // accepted beat times (s) from good windows, for HRV
    this.events = [];            // artifact episodes
    this.open = null;
    this.lastGoodHR = null;
    this.goodTime = 0; this.totalTime = 0; this.lastT = null;
    this.hrLog = [];
  }

  pushPPG(t, v, { clip = 0, finger = true } = {}) {
    const P = this.ppg;
    if (P.t.length && t <= P.t[P.t.length - 1]) return;
    P.t.push(t); P.v.push(v); P.clip.push(clip); P.finger.push(finger ? 1 : 0);
    this._trim(P, t, this.cfg.window + 4);
  }
  pushMotion(t, mag) { const M = this.motion; M.t.push(t); M.v.push(mag); this._trim(M, t, this.cfg.window + 4); }
  setReference(name, bpm, t) { this.refs[name] = { bpm, t }; }
  _trim(buf, t, keep) {
    let k = 0; while (k < buf.t.length && buf.t[k] < t - keep) k++;
    if (k) for (const key of Object.keys(buf)) buf[key].splice(0, k);
  }

  compute(tNow) {
    const c = this.cfg, P = this.ppg;
    const dt = this.lastT == null ? 0 : Math.min(1, tNow - this.lastT); this.lastT = tNow;
    const res = { t: tNow, hr: null, hrStale: false, status: "warming", score: 0, components: {}, reasons: [],
      signal: null, peaks: [], fps: 0, rmssd: null, perfusion: null, motion: null, agreement: [] };

    // recent-window stats
    const w0 = tNow - c.window;
    const idx = P.t.findIndex((t) => t >= w0);
    const span = P.t.length ? P.t[P.t.length - 1] - P.t[0] : 0;
    const recent = idx < 0 ? 0 : P.t.length - idx;
    res.fps = recent / c.window;
    const fingerFrac = idx < 0 ? 0 : mean(P.finger.slice(idx));
    if (P.t.length && fingerFrac < 0.7) {
      res.status = "nofinger"; res.reasons = ["Cover the camera and flash fully with your fingertip"];
      return this._finish(res, dt);
    }
    if (span < c.window * 0.75 || res.fps < c.minFps * 0.5) {
      res.reasons = [res.fps && res.fps < c.minFps * 0.5 ? "Camera frame rate too low" : "Hold still while the signal settles…"];
      return this._finish(res, dt);
    }

    const raw = resample(P.t, P.v, tNow, c.window, c.fs);
    const filt = bandpass(raw, c.fs);
    const x = filt.map((v) => -v);            // more blood absorbs more light: invert so systole points up
    const s = std(Array.from(x)) || 1;
    const xn = x.map((v) => v / s);
    const peaks = findPeaks(xn, c.fs);
    res.signal = xn; res.peaks = peaks;

    const ibis = [];
    for (let i = 1; i < peaks.length; i++) ibis.push((peaks[i] - peaks[i - 1]) / c.fs);
    const mIBI = median(ibis);

    // 1) template: do the beats look alike?
    let template = 0;
    if (ibis.length >= 3 && isFinite(mIBI)) {
      const L = 32, segs = [];
      const pre = Math.round(0.35 * mIBI * c.fs), post = Math.round(0.65 * mIBI * c.fs);
      for (const p of peaks) {
        const a = Math.round(p) - pre, b = Math.round(p) + post;
        if (a < 0 || b >= xn.length) continue;
        const seg = new Float64Array(L);
        for (let k = 0; k < L; k++) { const f = a + (k / (L - 1)) * (b - a), i0 = Math.floor(f), fr = f - i0; seg[k] = xn[i0] * (1 - fr) + (xn[i0 + 1] ?? xn[i0]) * fr; }
        segs.push(seg);
      }
      if (segs.length >= 3) {
        const tpl = new Float64Array(L);
        for (const g of segs) for (let k = 0; k < L; k++) tpl[k] += g[k] / segs.length;
        template = clamp01(mean(segs.map((g) => pearson(g, tpl))));
      }
    }

    // 1b) clarity: how much of the band's power sits at the heart rate and its harmonics
    let clarity = 0;
    if (isFinite(mIBI)) {
      const f0 = 1 / mIBI, arr = Array.from(xn);
      let tot = 0, hit = 0;
      for (let f = c.bandLow; f <= c.bandHigh * 1.6; f += 0.05) {
        let re = 0, im = 0;
        for (let i = 0; i < arr.length; i++) { const a = (2 * Math.PI * f * i) / c.fs; re += arr[i] * Math.cos(a); im -= arr[i] * Math.sin(a); }
        const pw = re * re + im * im; tot += pw;
        for (let k = 1; k <= 4; k++) if (Math.abs(f - k * f0) <= 0.12) { hit += pw; break; }
      }
      clarity = clamp01((hit / (tot || 1) - 0.3) / (0.7 - 0.3));
    }

    // 2) rhythm: plausible intervals, no impossible jumps (note: real arrhythmias also score low)
    let rhythm = 0;
    if (ibis.length >= 3) {
      let ok = 0;
      for (let i = 0; i < ibis.length; i++) {
        const plaus = ibis[i] >= c.minIBI && ibis[i] <= c.maxIBI;
        const smooth = Math.abs(ibis[i] - mIBI) / mIBI < 0.25;
        if (plaus && smooth) ok++;
      }
      rhythm = ok / ibis.length;
      // expected beat count vs detected (missed or extra peaks)
      const expected = c.window / mIBI, found = peaks.length;
      rhythm *= clamp01(1 - Math.abs(found - expected) / expected);
    }

    // 3) perfusion: pulsatile (AC) vs steady (DC) light, plus saturation
    const dc = mean(Array.from(raw));
    const ac = pct(Array.from(filt), 95) - pct(Array.from(filt), 5);
    const pi = dc > 0 ? (ac / dc) * 100 : 0;
    res.perfusion = pi;
    let perfusion = clamp01((pi - c.piLow) / (c.piGood - c.piLow));
    const clipFrac = mean(P.clip.slice(idx));
    const saturated = clipFrac > c.clipBad;
    if (saturated) perfusion = Math.min(perfusion, 0.2);

    // 4) motion: worst 2-s RMS acceleration inside the window (null when the device has no sensor)
    let motion = null;
    const M = this.motion, mi = M.t.findIndex((t) => t >= w0);
    if (mi >= 0 && M.t.length - mi > 10) {
      let worst = 0;
      for (let t = w0; t < tNow; t += 0.5) {
        const seg = []; for (let k = mi; k < M.t.length; k++) if (M.t[k] >= t && M.t[k] < t + 2) seg.push(M.v[k]);
        if (seg.length > 3) worst = Math.max(worst, Math.sqrt(mean(seg.map((v) => v * v))));
      }
      res.motion = worst;
      motion = clamp01(1 - (worst - c.motionOk) / (c.motionBad - c.motionOk));
    }

    const comps = { template, clarity, rhythm, perfusion, motion };
    res.components = comps;
    let wsum = 0, score = 0;
    for (const [k, v] of Object.entries(comps)) if (v != null) { score += c.weights[k] * v; wsum += c.weights[k]; }
    score = wsum ? score / wsum : 0;
    res.score = score;

    const lowest = Math.min(...Object.values(comps).filter((v) => v != null));
    res.status = score >= 0.8 && lowest >= 0.5 ? "good" : score >= 0.6 && lowest >= 0.3 ? "fair" : "poor";

    // human-readable reasons, worst first
    const why = [];
    if (motion != null && motion < 0.6) why.push([motion, "Motion detected: hold your hand still"]);
    if (saturated) why.push([0.1, "Too bright or pressing too hard: ease off the lens"]);
    else if (perfusion < 0.6) why.push([perfusion, "Weak pulse: cold finger or light contact, cover the lens fully"]);
    if (template < 0.7) why.push([template, "Beats don't match each other: noisy waveform"]);
    if (clarity < 0.6) why.push([clarity, "Pulse buried in noise: the rhythm isn't clear in the spectrum"]);
    if (rhythm < 0.6) why.push([rhythm, "Irregular or missed beats (noise, or a genuinely irregular rhythm)"]);
    res.reasons = why.sort((a, b) => a[0] - b[0]).map((w) => w[1]);

    // heart rate: report only when trustworthy, otherwise hold the last good value
    if (res.status !== "poor" && isFinite(mIBI)) {
      res.hr = 60 / mIBI; this.lastGoodHR = { bpm: res.hr, t: tNow };
      this.hrLog.push([tNow, res.hr]); if (this.hrLog.length > 2000) this.hrLog.shift();
      // accept beats for HRV only from good windows
      if (res.status === "good") {
        const tStart = tNow - c.window;
        for (const p of peaks) {
          const tb = tStart + p / c.fs;
          if (!this.beats.length || tb - this.beats[this.beats.length - 1] > c.minIBI * 0.9) this.beats.push(tb);
        }
      }
    } else if (this.lastGoodHR && tNow - this.lastGoodHR.t < 15) { res.hr = this.lastGoodHR.bpm; res.hrStale = true; }

    // HRV (RMSSD) over the last 60 s of accepted beats
    this.beats = this.beats.filter((t) => t > tNow - 90);
    const bb = this.beats.filter((t) => t > tNow - 60), ib = [];
    for (let i = 1; i < bb.length; i++) { const d = bb[i] - bb[i - 1]; if (d >= c.minIBI && d <= c.maxIBI) ib.push(d); }
    if (ib.length >= 10) {
      const sd = []; for (let i = 1; i < ib.length; i++) if (Math.abs(ib[i] - ib[i - 1]) < 0.25) sd.push((ib[i] - ib[i - 1]) ** 2);
      if (sd.length >= 8) res.rmssd = Math.sqrt(mean(sd)) * 1000;
    }

    // agreement with wearables
    for (const [name, r] of Object.entries(this.refs)) {
      if (tNow - r.t > 10) continue;
      res.agreement.push({ name, bpm: r.bpm, diff: res.hr != null && !res.hrStale ? r.bpm - res.hr : null });
    }
    return this._finish(res, dt);
  }

  _finish(res, dt) {
    const bad = res.status === "poor" || res.status === "nofinger";
    if (res.status !== "warming") { this.totalTime += dt; if (res.status === "good") this.goodTime += dt; }
    if (bad && !this.open) {
      this.open = { start: res.t, end: res.t, reason: res.reasons[0] || res.status, status: res.status };
      res.artifactStart = this.open;
    } else if (bad && this.open) { this.open.end = res.t; }
    else if (!bad && this.open) {
      this.open.end = res.t; this.events.push(this.open); if (this.events.length > 50) this.events.shift();
      res.artifactEnd = this.open; this.open = null;
    }
    this.last = res;
    return res;
  }

  /** Compact JSON for an LLM (e.g. Gemini) to explain in plain language. */
  summary() {
    const hrs = this.hrLog.map((h) => h[1]);
    const r = this.last || {};
    return {
      source: "fingertip camera PPG",
      seconds_analyzed: Math.round(this.totalTime),
      percent_good_signal: this.totalTime ? Math.round((100 * this.goodTime) / this.totalTime) : 0,
      heart_rate_bpm: hrs.length ? { median: Math.round(median(hrs)), min: Math.round(Math.min(...hrs)), max: Math.round(Math.max(...hrs)) } : null,
      hrv_rmssd_ms: r.rmssd ? Math.round(r.rmssd) : null,
      current_quality: r.status, current_reasons: r.reasons,
      artifact_episodes: [...this.events, ...(this.open ? [this.open] : [])].slice(-10).map((e) => ({
        seconds_ago: Math.round((r.t ?? e.end) - e.end), duration_s: +(e.end - e.start).toFixed(1), reason: e.reason })),
      wearable_comparison: (r.agreement || []).map((a) => ({ device: a.name, device_bpm: Math.round(a.bpm), difference_bpm: a.diff == null ? null : Math.round(a.diff) })),
      note: "Educational tool, not a medical device.",
    };
  }
}
