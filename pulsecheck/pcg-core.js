/*
 * pcg-core.js — heart sounds from the phone's microphone (phonocardiogram, PCG), with the same transparent
 * quality score and result shape as PPGProcessor, so the Live tab, artifact log, watch comparison and
 * "Compare" ranking all work unchanged. No dependencies; runs in the browser and in Node (for tests).
 *
 *   const p = new PCGProcessor();
 *   p.pushAudio(t0Seconds, float32Samples, sampleRate);   // every microphone chunk
 *   const r = p.compute(tNow);                             // ~2x per second: r.hr, r.status, r.components, r.s1 …
 *
 * Each heartbeat makes two sounds: S1 ("lub", mitral and tricuspid valves closing as the ventricles contract)
 * and S2 ("dub", aortic and pulmonary valves closing as they relax). Most of their energy sits at 25–150 Hz.
 * Heart rate comes from S1-to-S1 intervals. This finds beats; it can't and doesn't judge murmurs or valve health.
 */
import { PPGProcessor } from "./ppg-core.js";

export const PCG_CONFIG = {
  mode: "sound",
  fs: 2000,              // Hz after decimation
  envFs: 100,            // Hz, energy envelope
  window: 8,             // s analysed
  bandLow: 25, bandHigh: 400,   // heart-sound band (Hz)
  minCycle: 0.35, maxCycle: 1.6, // s  (37–170 bpm)
  minIBI: 0.35, maxIBI: 1.6,
  contactLow: 1.6, contactGood: 4,   // envelope peak / baseline ratio
  hrMinClarity: 0,
  hrv: true,
  weights: { clarity: 0.35, rhythm: 0.3, contact: 0.25, steady: 0.1 },
};

const TEXT = {
  source: "microphone heart sounds (phonocardiogram)",
  absent: "No heart sounds stand out: press the microphone (bottom edge of the phone) firmly on bare skin just left of the breastbone, and stay quiet",
  contact: "Heart sounds barely stand out: press firmly on bare skin, and keep quiet (no talking, music or fans)",
  rubbing: "Rubbing or tapping: hold the phone still against the chest",
  clarity: "Beats aren't clear: try a spot slightly lower, between the ribs left of the breastbone",
  rhythm: "Irregular or missed beats (noise, or a genuinely irregular rhythm)",
};

function biquad(type, f0, fs, Q = Math.SQRT1_2) {
  const w0 = (2 * Math.PI * f0) / fs, c = Math.cos(w0), al = Math.sin(w0) / (2 * Q), a0 = 1 + al;
  const b = type === "low" ? [(1 - c) / 2, 1 - c, (1 - c) / 2] : [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  const k = { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * c) / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
  k.step = (x) => { const y = k.b0 * x + k.b1 * k.x1 + k.b2 * k.x2 - k.a1 * k.y1 - k.a2 * k.y2; k.x2 = k.x1; k.x1 = x; k.y2 = k.y1; k.y1 = y; return y; };
  return k;
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1);
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))]; };

export class PCGProcessor extends PPGProcessor {
  constructor(cfg = {}) {
    super({ ...PCG_CONFIG, ...cfg });
    this.text = TEXT;
    const c = this.cfg;
    this.chain = [biquad("high", c.bandLow, c.fs), biquad("high", c.bandLow, c.fs), biquad("low", c.bandHigh, c.fs), biquad("low", c.bandHigh, c.fs)];
    this.acc = { s: 0, n: 0, clip: 0, pos: 0 };      // decimation accumulator
    this.blk = { e: 0, clip: 0, n: 0 };              // envelope block accumulator
    this.env = { t: [], e: [], clip: [] };           // 100 Hz: heart-band RMS, clipped share
    this.pcm = new Float32Array(c.fs * 4); this.pcmI = 0; this.pcmT = 0;   // last 4 s of filtered sound, for drawing
    this.sampleRate = null; this.tAudio = null;
  }

  /** A chunk of raw microphone samples; t0 = time of the first sample (s, same clock as compute). */
  pushAudio(t0, samples, sampleRate) {
    const c = this.cfg, step = sampleRate / c.fs, blockN = c.fs / c.envFs;
    this.sampleRate = sampleRate;
    const A = this.acc, B = this.blk;
    for (let i = 0; i < samples.length; i++) {
      const x = Number.isFinite(samples[i]) ? samples[i] : 0;   // one bad sample would poison the filters for good
      A.s += x; A.n++; if (x > 0.98 || x < -0.98) A.clip++;
      A.pos += 1;
      if (A.pos < step) continue;
      A.pos -= step;
      const d = A.s / A.n, clipped = A.clip > 0; A.s = 0; A.n = 0; A.clip = 0;
      let y = d; for (const f of this.chain) y = f.step(y);
      this.pcm[this.pcmI] = y; this.pcmI = (this.pcmI + 1) % this.pcm.length;
      B.e += y * y; B.clip += clipped ? 1 : 0; B.n++;
      if (B.n >= blockN) {
        const t = t0 + (i + 1) / sampleRate;
        this.env.t.push(t); this.env.e.push(Math.sqrt(B.e / B.n)); this.env.clip.push(B.clip / B.n);
        B.e = B.clip = B.n = 0; this.pcmT = t;
      }
    }
    this.tAudio = t0 + samples.length / sampleRate;
    this._trim(this.env, this.tAudio, c.window + 4);
  }

  /** Last `seconds` of filtered heart sound (for the waveform), oldest first, with the time of its last sample. */
  recentSound(seconds = 3) {
    const n = Math.min(this.pcm.length, Math.round(seconds * this.cfg.fs)), out = new Float32Array(n);
    for (let k = 0; k < n; k++) out[k] = this.pcm[(this.pcmI - n + k + this.pcm.length) % this.pcm.length];
    return { samples: out, fs: this.cfg.fs, tEnd: this.pcmT };
  }

  compute(tNow) {
    const c = this.cfg, E = this.env;
    const dt = this.lastT == null ? 0 : Math.min(1, tNow - this.lastT); this.lastT = tNow;
    const res = { t: tNow, hr: null, hrStale: false, status: "warming", score: 0, components: {}, reasons: [], signal: null, peaks: [], s1: [], s2: [],
      fps: null, rmssd: null, perfusion: null, motion: null, agreement: [] };
    const i0 = E.t.findIndex((t) => t >= tNow - c.window);
    const n = i0 < 0 ? 0 : E.t.length - i0;
    if (n < c.envFs * c.window * 0.75) { res.reasons = ["Listening… hold the phone still on the chest"]; return this._finish(res, dt); }
    const e = E.e.slice(i0), clipFrac = mean(E.clip.slice(i0));
    // smooth the envelope (~50 ms) and scale it between its baseline and its peaks
    const sm = e.map((_, k) => { let s = 0, m = 0; for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < e.length) { s += e[j]; m++; } return s / m; });
    const base = median(sm), top = pct(sm, 98), ratio = base > 0 ? pct(sm, 95) / base : 0;
    const loud = top - base;
    // Loose contact and background noise (talking, music) look the same here: the heart sounds stop standing out
    // from the level between them. So they share one check and one message.
    if (!(top > 1e-4) || ratio < 1.25) {
      res.status = "nofinger"; res.reasons = [TEXT.absent];
      res.signal = Float64Array.from(sm.map(() => 0));
      return this._finish(res, dt);
    }
    const x = Float64Array.from(sm, (v) => Math.min(1.5, Math.max(0, (v - base) / (loud || 1))));
    res.signal = x;
    // cardiac cycle from autocorrelation: S1 and S2 overlap themselves one full cycle later, so the cycle
    // peak is about twice as tall as the S1-to-S2 or S2-to-S1 cross-peaks
    const mx = mean(Array.from(x)), xc = x.map((v) => v - mx);
    let ac0 = 0; for (let k = 0; k < xc.length; k++) ac0 += xc[k] * xc[k];
    const lo = Math.round(c.minCycle * c.envFs), hi = Math.round(c.maxCycle * c.envFs), ac = [];
    for (let L = lo - 1; L <= hi + 1; L++) { let s = 0; for (let k = 0; k + L < xc.length; k++) s += xc[k] * xc[k + L]; ac.push([L, s / (xc.length - L)]); }
    let best = null;
    for (let k = 1; k < ac.length - 1; k++) if (ac[k][1] > ac[k - 1][1] && ac[k][1] >= ac[k + 1][1] && ac[k][0] >= lo && ac[k][0] <= hi && (!best || ac[k][1] > best[1])) best = ac[k];
    const acNorm = best && ac0 ? best[1] / (ac0 / xc.length) : 0;
    let cycle = null;
    if (best) {   // sub-sample peak position: one envelope sample is 10 ms, about 4 bpm at 150 bpm
      const k = ac.indexOf(best), y0 = ac[k - 1][1], y1 = best[1], y2 = ac[k + 1][1], d = y0 - 2 * y1 + y2;
      cycle = (best[0] + (d ? (0.5 * (y0 - y2)) / d : 0)) / c.envFs;
    }
    // sound events: envelope peaks at least 0.18 s apart, then label S1/S2 by the gaps around them
    // (systole, S1 to S2, is shorter than diastole, S2 to the next S1, at resting and moderate heart rates)
    const thr = 0.3, minD = Math.round(0.18 * c.envFs), cand = [];
    for (let k = 1; k < x.length - 1; k++) if (x[k] > thr && x[k] > x[k - 1] && x[k] >= x[k + 1]) cand.push(k);
    cand.sort((a, b) => x[b] - x[a]);
    const kept = []; for (const k of cand) if (kept.every((q) => Math.abs(q - k) >= minD)) kept.push(k);
    kept.sort((a, b) => a - b);
    const ev = kept.map((k) => { const y0 = x[k - 1], y1 = x[k], y2 = x[k + 1], d = y0 - 2 * y1 + y2; return k + (d ? (0.5 * (y0 - y2)) / d : 0); });
    // S1 or S2? Two clues: S1 is followed by the shorter gap (systole), and at the usual listening spot it's the
    // louder sound. When the gaps are nearly equal (fast heart rates) loudness decides.
    const s1 = [], s2 = [], amps = ev.map((q) => x[Math.round(q)]), aMid = median(amps);
    for (let k = 0; k < ev.length; k++) {
      const gp = k > 0 ? ev[k] - ev[k - 1] : null, gn = k < ev.length - 1 ? ev[k + 1] - ev[k] : null;
      let vote = 0;
      if (gp != null && gn != null) vote += Math.max(-1, Math.min(1, (gp - gn) / (0.15 * (gp + gn))));
      else if (gn != null && cycle) vote += gn < 0.5 * cycle * c.envFs ? 0.6 : -0.6;
      else if (gp != null && cycle) vote += gp > 0.5 * cycle * c.envFs ? 0.6 : -0.6;
      vote += amps[k] > aMid ? 0.5 : -0.5;
      (vote >= 0 ? s1 : s2).push(ev[k]);
    }
    res.s1 = s1; res.s2 = s2; res.peaks = s1;
    const ibis = []; for (let k = 1; k < s1.length; k++) ibis.push((s1[k] - s1[k - 1]) / c.envFs);
    const good = ibis.filter((v) => v >= c.minIBI && v <= c.maxIBI);
    // S1 labels are trusted (for heart rate detail and HRV) only when they're consistent: about one per cycle,
    // every interval close to the cycle length. Otherwise heart rate comes from the autocorrelation alone.
    const expected = cycle ? c.window / cycle : 0;
    const labelsOk = cycle && Math.abs(s1.length - expected) <= 1.2 && ibis.length >= 3 && ibis.every((v) => Math.abs(v - cycle) / cycle < 0.2);
    const mIBI = labelsOk ? median(good) : cycle;
    res.labelsOk = !!labelsOk;

    // quality parts
    const clarity = clamp01((acNorm - 0.15) / (0.5 - 0.15));
    // rhythm without relying on the S1/S2 labels: each sound should recur one cycle later, and the count of
    // sounds should fit one or two per cycle (S2 is sometimes too faint to catch)
    let rhythm = 0;
    if (cycle && ev.length >= 4) {
      const C = cycle * c.envFs; let ok = 0, tested = 0;
      for (const q of ev) { if (q + C * 1.15 > x.length) continue; tested++; if (ev.some((r) => Math.abs(r - q - C) < 0.12 * C)) ok++; }
      const perCycle = ev.length / (c.window / cycle);
      rhythm = (tested ? ok / tested : 0) * (perCycle >= 0.8 && perCycle <= 2.3 ? 1 : 0.4);
    }
    const contact = clamp01((ratio - c.contactLow) / (c.contactGood - c.contactLow));
    const steady = clamp01(1 - clipFrac * 25);
    const comps = { clarity, rhythm, contact, steady };
    res.components = comps;
    let score = 0, wsum = 0; for (const [k, v] of Object.entries(comps)) { score += c.weights[k] * v; wsum += c.weights[k]; }
    res.score = score = score / wsum;
    const lowest = Math.min(...Object.values(comps));
    res.status = score >= 0.8 && lowest >= 0.5 ? "good" : score >= 0.6 && lowest >= 0.3 ? "fair" : "poor";
    const why = [];
    if (steady < 0.6) why.push([-2, TEXT.rubbing]);
    if (contact < 0.6) why.push([contact, TEXT.contact]);
    if (clarity < 0.6) why.push([clarity, TEXT.clarity]);
    if (rhythm < 0.6) why.push([rhythm, TEXT.rhythm]);
    res.reasons = why.sort((a, b) => a[0] - b[0]).map((w) => w[1]);

    if (res.status !== "poor" && mIBI) {
      res.hr = 60 / mIBI; this.lastGoodHR = { bpm: res.hr, t: tNow };
      this.hrLog.push([tNow, res.hr]); if (this.hrLog.length > 2000) this.hrLog.shift();
      if (res.status === "good" && labelsOk) {
        const tStart = E.t[i0];
        for (const p of s1) { const tb = tStart + p / c.envFs; if (!this.beats.length || tb - this.beats[this.beats.length - 1] > c.minIBI * 0.9) this.beats.push(tb); }
      }
    } else if (this.lastGoodHR && tNow - this.lastGoodHR.t < 15) { res.hr = this.lastGoodHR.bpm; res.hrStale = true; }
    res.s1Times = s1.map((p) => E.t[i0] + p / c.envFs);    // absolute S1 times, for heart-to-finger timing
    res.s2Times = s2.map((p) => E.t[i0] + p / c.envFs);

    this.beats = this.beats.filter((t) => t > tNow - 90);
    const bb = this.beats.filter((t) => t > tNow - 60), ib = [];
    for (let k = 1; k < bb.length; k++) { const d = bb[k] - bb[k - 1]; if (d >= c.minIBI && d <= c.maxIBI) ib.push(d); }
    if (ib.length >= 10) { const sd = []; for (let k = 1; k < ib.length; k++) if (Math.abs(ib[k] - ib[k - 1]) < 0.25) sd.push((ib[k] - ib[k - 1]) ** 2); if (sd.length >= 8) res.rmssd = Math.sqrt(mean(sd)) * 1000; }
    for (const [name, r] of Object.entries(this.refs)) { if (tNow - r.t > 10) continue; res.agreement.push({ name, bpm: r.bpm, diff: res.hr != null && !res.hrStale ? r.bpm - res.hr : null }); }
    return this._finish(res, dt);
  }
}

/**
 * Heart-to-fingertip pulse timing: from each S1 (at its loudest point) to the next fingertip pulse peak 0.08–0.6 s later.
 * Returns { ms, n } (median over recent beats) or null. Phone clocks for audio and video can differ by tens of
 * milliseconds, so watch how it changes (after exercise, slow breathing) rather than the absolute number.
 */
export function heartToFinger(s1Times, pulseTimes, since = -Infinity) {
  const d = [];
  for (const s of s1Times) { if (s < since) continue; const p = pulseTimes.find((q) => q > s + 0.08 && q < s + 0.6); if (p != null) d.push(p - s); }
  return d.length >= 4 ? { ms: Math.round(median(d) * 1000), n: d.length } : null;
}

/** Synthetic chest-microphone sound with the fingertip simulators' artifact names:
 *  motion = talking, weak = loose contact, press = rubbing the phone, nofinger = phone off the chest. */
export class StethoscopeSimulator {
  constructor({ hr = 72, sampleRate = 4000, seed = 1 } = {}) {
    this.hr = hr; this.sr = sampleRate; this.t = 0; this.phase = 0; this.s = seed; this.artifact = "none";
    this.events = []; this.talk = 0; this.f0 = 150; this.rub = 0; this.lp = 0;
  }
  rand() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
  gauss() { return Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand()); }
  /** Next `seconds` of sound: { t0, samples, sampleRate }. S1 times so far are in this.s1Times. */
  chunk(seconds = 0.05) {
    const n = Math.round(seconds * this.sr), out = new Float32Array(n), t0 = this.t;
    this.s1Times ||= [];
    for (let i = 0; i < n; i++) {
      const t = this.t + i / this.sr, dt = 1 / this.sr;
      const resp = Math.sin(2 * Math.PI * 0.25 * t);
      const inst = this.hr * (1 + 0.04 * resp);
      const prev = this.phase; this.phase += (inst / 60) * dt;
      if (Math.floor(this.phase) !== Math.floor(prev)) {
        const ts = Math.max(0.24, 0.43 - 0.0017 * inst);            // systole shortens as heart rate rises
        this.events.push({ t, a: 1, f: [55, 110] }, { t: t + ts, a: 0.65, f: [80, 160] });
        this.s1Times.push(t + 0.03); if (this.s1Times.length > 400) this.s1Times.shift();   // S1 timed at its loudest point, as the detector does
      }
      let heart = 0;
      for (const e of this.events) { const u = t - e.t; if (u < 0 || u > 0.1) continue; const g = Math.exp(-(((u - 0.03) / 0.013) ** 2)); heart += e.a * g * (Math.sin(2 * Math.PI * e.f[0] * u) + 0.5 * Math.sin(2 * Math.PI * e.f[1] * u)); }
      let gain = 0.35, noise = 0.004 * this.gauss(), extra = 0;
      this.lp += 0.02 * (this.gauss() - this.lp); noise += 0.01 * this.lp * (1 + resp);   // breath rustle
      switch (this.artifact) {
        case "motion": {                                          // talking: voiced syllables, 120-220 Hz plus harmonics
          if (this.rand() < 0.0006) this.talk = 0.25 + 0.2 * this.rand(), this.f0 = 120 + 100 * this.rand();
          this.talk *= 0.99985;
          for (let k = 1; k <= 6; k++) extra += (this.talk / k) * Math.sin(2 * Math.PI * this.f0 * k * t);
          break;
        }
        case "weak": gain = 0.012; noise *= 1.5; break;
        case "press": if (this.rand() < 0.0008) this.rub = 1.4; this.rub *= 0.9993; extra += this.rub * this.gauss(); break;
        case "nofinger": gain = 0; noise = 0.003 * this.gauss(); break;
      }
      out[i] = Math.max(-1, Math.min(1, gain * heart + noise + extra));
    }
    this.t += n / this.sr;
    this.events = this.events.filter((e) => this.t - e.t < 0.2);
    return { t0, samples: out, sampleRate: this.sr };
  }
}
