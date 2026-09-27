/*
 * resp-core.js — breathing rate from the same camera signals the pulse check already reads. No dependencies.
 *
 *   const r = new RespEstimator();
 *   r.push(t, { intensity, position }, present, moving);   // every camera frame
 *   const b = r.compute(tNow);                     // { rate, status: "good"|"fair"|"poor"|"warming", source, quality, reason }
 *
 * Why it works: breathing changes what the camera sees about 10–20 times a minute.
 *  - Fingertip: each breath shifts blood volume in the finger, so the light level (the slow "baseline" under the
 *    pulse) rises and falls with breathing (respiratory-induced intensity variation).
 *  - Face: the head rises and falls slightly with each breath (tracked face position). The face's brightness is not
 *    used: camera exposure drift looks too much like breathing and gave confident wrong rates in testing.
 * Each channel is band-limited to 6–36 breaths/min; the rate is the strongest peak in that band, and quality is
 * how much of the band's power that peak holds. Educational estimate, not a medical measurement.
 */
export const RESP_CONFIG = {
  window: 32,          // s analysed (about 5–15 breaths at rest)
  minSpan: 20,         // s of data needed before a first estimate
  fs: 4,               // Hz, resampled
  fLow: 0.1,           // Hz  (6 breaths/min)
  fHigh: 0.6,          // Hz  (36 breaths/min)
  good: 0.5,           // share of band power at the peak for "good"
  fair: 0.4,
  minPresent: 0.9,     // share of the window with a finger/face in view
  maxMoving: 0.1,      // share of the window with hand/head movement before the estimate is withheld
  fingerMoving: 0.5,   // m/s² phone acceleration (gravity removed) that counts as a moving hand
  faceMoving: 1.2,     // % of face width per frame that counts as a moving head
};

const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);

/** Share of in-band power at the strongest frequency, and that frequency (Hz). x: uniform samples at fs. */
export function breathingPeak(x, fs = RESP_CONFIG.fs, lo = RESP_CONFIG.fLow, hi = RESP_CONFIG.fHigh) {
  const n = x.length; if (n < 8) return null;
  // remove the straight-line trend, then taper the ends (Hann) so the window edges don't leak power
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), a = (sy - b * sx) / n;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) y[i] = (x[i] - a - b * i) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const step = 0.005, P = [];
  for (let f = lo; f <= hi + 1e-9; f += step) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const ph = (2 * Math.PI * f * i) / fs; re += y[i] * Math.cos(ph); im -= y[i] * Math.sin(ph); }
    P.push([f, re * re + im * im]);
  }
  let k = 0; for (let i = 1; i < P.length; i++) if (P[i][1] > P[k][1]) k = i;
  const tot = P.reduce((s, p) => s + p[1], 0);
  if (!(tot > 0)) return null;
  // a breath rate slightly off-grid spreads over neighbouring bins: count ±0.03 Hz around the peak
  let hit = 0; for (const [f, p] of P) if (Math.abs(f - P[k][0]) <= 0.03) hit += p;
  let f0 = P[k][0];
  if (k > 0 && k < P.length - 1) { const y0 = P[k - 1][1], y1 = P[k][1], y2 = P[k + 1][1], d = y0 - 2 * y1 + y2; if (d) f0 += (0.5 * (y0 - y2) / d) * step; }
  const edge = k === 0 || k === P.length - 1;   // peak at the band edge is usually drift or motion, not breathing
  return { f: f0, share: hit / tot, edge };
}

export class RespEstimator {
  constructor(cfg = {}) {
    this.cfg = { ...RESP_CONFIG, ...cfg };
    this.buf = { t: [], present: [], moving: [], ch: {} };
    this.last = null; this.lastGood = null;
  }
  /** channels: named numbers for this frame, e.g. { intensity, position }. present: finger/face in view.
   *  moving: the hand (phone accelerometer) or head (face tracking) moved noticeably this frame. */
  push(t, channels, present = true, moving = false) {
    const B = this.buf;
    if (B.t.length && t <= B.t[B.t.length - 1]) return;
    B.t.push(t); B.present.push(present ? 1 : 0); B.moving.push(moving ? 1 : 0);
    for (const [k, v] of Object.entries(channels)) {
      (B.ch[k] ||= new Array(B.t.length - 1).fill(NaN)).push(Number.isFinite(v) ? v : NaN);
    }
    for (const k of Object.keys(B.ch)) if (B.ch[k].length < B.t.length) B.ch[k].push(NaN);
    let cut = 0; while (cut < B.t.length && B.t[cut] < t - this.cfg.window - 2) cut++;
    if (cut) { B.t.splice(0, cut); B.present.splice(0, cut); B.moving.splice(0, cut); for (const k of Object.keys(B.ch)) B.ch[k].splice(0, cut); }
  }
  compute(tNow) {
    const c = this.cfg, B = this.buf;
    const res = { t: tNow, rate: null, status: "warming", quality: 0, source: null, reason: "Measuring breathing… hold still for about 20 seconds" };
    const i0 = B.t.findIndex((t) => t >= tNow - c.window);
    if (i0 < 0 || tNow - B.t[i0] < c.minSpan) return (this.last = res);
    if (mean(B.present.slice(i0)) < c.minPresent) { res.status = "poor"; res.reason = "Keep the finger or face in view for the whole window"; return (this.last = res); }
    // breathing moves things by a fraction of a millimetre, so any real hand or head movement swamps it
    if (mean(B.moving.slice(i0)) > c.maxMoving) { res.status = "poor"; res.reason = "Movement hides the breathing rhythm: hold still for 30 seconds"; return (this.last = res); }
    const t0 = Math.max(B.t[i0], tNow - c.window), n = Math.floor((tNow - t0) * c.fs);
    let best = null;
    for (const [name, vals] of Object.entries(B.ch)) {
      // average frames into 0.25 s bins (this also removes the pulse), then fill gaps from neighbours
      const s = new Float64Array(n).fill(0), m = new Float64Array(n).fill(0);
      for (let i = i0; i < B.t.length; i++) {
        const k = Math.floor((B.t[i] - t0) * c.fs), v = vals[i];
        if (k >= 0 && k < n && Number.isFinite(v) && B.present[i]) { s[k] += v; m[k]++; }
      }
      let filled = 0; const x = new Float64Array(n);
      for (let k = 0; k < n; k++) { if (m[k]) { x[k] = s[k] / m[k]; filled++; } else x[k] = NaN; }
      if (filled < 0.8 * n) continue;
      for (let k = 0; k < n; k++) if (!Number.isFinite(x[k])) x[k] = k ? x[k - 1] : x.find(Number.isFinite);
      const pk = breathingPeak(Array.from(x), c.fs);
      if (pk && !pk.edge && (!best || pk.share > best.share)) best = { ...pk, name };
    }
    if (!best) { res.status = "poor"; res.reason = "No clear breathing rhythm: hold still and breathe normally"; return (this.last = res); }
    res.quality = best.share; res.source = best.name;
    res.status = best.share >= c.good ? "good" : best.share >= c.fair ? "fair" : "poor";
    if (res.status === "poor") { res.reason = "Breathing rhythm unclear: movement or talking can hide it"; }
    else { res.rate = best.f * 60; res.reason = ""; this.lastGood = { rate: res.rate, t: tNow }; }
    return (this.last = res);
  }
}

/**
 * Where a live RMSSD (ms) sits between "aroused" and "relaxed". HRV varies a lot with age and fitness, so the
 * absolute bands are only a rough guide; with a personal baseline the change from it is what matters.
 * Returns { level 0..1 (0 = low HRV / aroused, 1 = high HRV / relaxed), label, vsBaseline (%, or null) }.
 */
export function hrvState(rmssd, baseline = null) {
  if (!(rmssd > 0)) return null;
  const level = Math.max(0, Math.min(1, Math.log(rmssd / 10) / Math.log(100 / 10)));   // log scale 10–100 ms
  const label = rmssd < 20 ? "Low HRV: aroused, stressed or active" : rmssd < 45 ? "Moderate HRV" : "High HRV: relaxed, strong vagal (rest-and-digest) activity";
  const vsBaseline = baseline > 0 ? Math.round((100 * (rmssd - baseline)) / baseline) : null;
  return { level, label, vsBaseline };
}
