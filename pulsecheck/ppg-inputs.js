/*
 * ppg-inputs.js — signal sources for PPGProcessor.
 *   startCamera(video, onFrame)   fingertip-over-camera PPG (needs HTTPS or localhost)
 *   startFaceCamera(video, overlay, onFrame)
 *                                 front camera, no contact: tracks the face and averages forehead + cheek skin
 *   startMic(onAudio)             microphone for heart sounds, raw (no echo cancelling / noise suppression / auto gain)
 *   startMotion(onSample)         phone accelerometer, gravity removed (call from a button tap on iPhone)
 *   connectHeartRate(onBpm)       any Bluetooth heart-rate broadcaster: Garmin "Broadcast Heart Rate",
 *                                 chest straps, or an Apple Watch via a broadcast app (Chrome/Edge, not iOS)
 *   Simulator                     synthetic PPG + motion with injectable artifacts (laptop testing, stage backup)
 *   FaceSimulator                 synthetic face-skin RGB + head motion, same artifact names
 */
const now = () => performance.now() / 1000;

// ---------------- camera ----------------
export async function startCamera(video, onFrame, { torch = true } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  const track = stream.getVideoTracks()[0];
  let torchOn = false;
  if (torch) {
    try { await track.applyConstraints({ advanced: [{ torch: true }] }); torchOn = true; } catch { /* no flash control (iPhone Safari, laptops) */ }
  }
  const cv = document.createElement("canvas"); cv.width = 40; cv.height = 30;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  let running = true, lastTime = -1;

  const grab = (t) => {
    ctx.drawImage(video, 0, 0, cv.width, cv.height);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let r = 0, g = 0, b = 0, clip = 0, n = 0, r2 = 0;
    // central 60% of the frame
    for (let y = 6; y < 24; y++) for (let x = 8; x < 32; x++) {
      const i = (y * cv.width + x) * 4, R = d[i];
      r += R; g += d[i + 1]; b += d[i + 2]; r2 += R * R; if (R >= 250) clip++; n++;
    }
    r /= n; g /= n; b /= n;
    const spatialStd = Math.sqrt(Math.max(0, r2 / n - r * r));
    // A fingertip over the lens glows red: red dominates and the image is nearly uniform.
    const finger = r > 60 && r > 1.6 * g && r > 1.6 * b && spatialStd < 35;
    onFrame({ t, r, g, b, clip: clip / n, finger, torch: torchOn });
  };

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const cb = (nowMs, meta) => {
      if (!running) return;
      grab((meta.captureTime ?? nowMs) / 1000);
      video.requestVideoFrameCallback(cb);
    };
    video.requestVideoFrameCallback(cb);
  } else {
    const loop = () => {
      if (!running) return;
      if (video.currentTime !== lastTime) { lastTime = video.currentTime; grab(now()); }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  return {
    torch: torchOn,
    stop() { running = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; },
  };
}

// ---------------- face camera (remote PPG) ----------------
// No face-detection library: skin pixels (YCbCr rule) inside an oval that follows the skin's centre.
// The forehead and cheeks are sampled; eyes, eyebrows and mouth are skipped because they move and aren't skin.
const isSkin = (R, G, B) => {
  const Y = 0.299 * R + 0.587 * G + 0.114 * B, Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B, Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
  return Y > 35 && Cr >= 133 && Cr <= 178 && Cb >= 75 && Cb <= 130;
};
/** Where to sample, in oval coordinates (dx, dy in -1..1): forehead band and both cheeks. */
export function faceRegion(dx, dy) {
  if (dx * dx + dy * dy > 1) return 0;
  if (dy >= -0.8 && dy <= -0.35 && Math.abs(dx) <= 0.6) return 1;                       // forehead
  if (dy >= 0.05 && dy <= 0.5 && Math.abs(dx) >= 0.25 && Math.abs(dx) <= 0.75) return 2; // cheeks
  return 0;
}

export async function startFaceCamera(video, overlay, onFrame) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "user" }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream; video.muted = true; video.playsInline = true;
  await video.play();
  const track = stream.getVideoTracks()[0];
  try { await track.applyConstraints({ advanced: [{ exposureMode: "continuous", whiteBalanceMode: "continuous" }] }); } catch { /* optional */ }
  // analysis grid keeps the camera's aspect ratio (front cameras deliver 4:3 or 16:9)
  const W = 80, H = Math.max(30, Math.round((80 * (video.videoHeight || 480)) / (video.videoWidth || 640)));
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  // oval in canvas pixels; starts centred, then follows the skin
  const roi = { cx: W / 2, cy: H * 0.47, rx: W * 0.2, ry: H * 0.34 };
  let running = true, lastTime = -1, prev = null;

  const grab = (t) => {
    ctx.drawImage(video, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    // 1) find the skin blob near the current oval (search 1.6x wider)
    let sx = 0, sy = 0, sxx = 0, n = 0, inOval = 0, ovalN = 0;
    const x0 = Math.max(0, Math.floor(roi.cx - roi.rx * 1.6)), x1 = Math.min(W, Math.ceil(roi.cx + roi.rx * 1.6));
    const y0 = Math.max(0, Math.floor(roi.cy - roi.ry * 1.4)), y1 = Math.min(H, Math.ceil(roi.cy + roi.ry * 1.4));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4, skin = isSkin(d[i], d[i + 1], d[i + 2]);
      const dx = (x - roi.cx) / roi.rx, dy = (y - roi.cy) / roi.ry, inside = dx * dx + dy * dy <= 1;
      if (inside) { ovalN++; if (skin) inOval++; }
      if (skin) { sx += x; sy += y; sxx += x * x; n++; }
    }
    let move = 0;
    if (n > 30) {
      const mx = sx / n, my = sy / n, sd = Math.sqrt(Math.max(1, sxx / n - mx * mx));
      if (prev) move = (100 * Math.hypot(mx - prev[0], my - prev[1])) / (2 * roi.rx);   // % of face width
      prev = [mx, my];
      roi.cx += 0.35 * (mx - roi.cx); roi.cy += 0.35 * (my + roi.ry * 0.05 - roi.cy);
      const rx = Math.min(W * 0.42, Math.max(W * 0.1, sd * 1.9));
      roi.rx += 0.1 * (rx - roi.rx); roi.ry = roi.rx * 1.35;
    } else prev = null;
    // 2) average skin in forehead + cheeks
    let r = 0, g = 0, b = 0, m = 0, clip = 0, lum = 0;
    for (let y = Math.max(0, Math.floor(roi.cy - roi.ry)); y < Math.min(H, roi.cy + roi.ry); y++)
      for (let x = Math.max(0, Math.floor(roi.cx - roi.rx)); x < Math.min(W, roi.cx + roi.rx); x++) {
        if (!faceRegion((x - roi.cx) / roi.rx, (y - roi.cy) / roi.ry)) continue;
        const i = (y * W + x) * 4, R = d[i], G = d[i + 1], B = d[i + 2];
        if (!isSkin(R, G, B)) continue;
        r += R; g += G; b += B; m++; lum += 0.299 * R + 0.587 * G + 0.114 * B;
        if (R >= 250 || G >= 250 || B >= 250) clip++;
      }
    const present = m >= 25 && ovalN > 0 && inOval / ovalN >= 0.35;
    if (m) { r /= m; g /= m; b /= m; lum /= m; clip /= m; }
    const dark = present && lum < 50;
    const note = !present ? "Face not found: center your face in the oval, in even light" : dark ? "Too dark: face a window or a lamp" : "";
    const frame = { t, r, g, b, clip, present, dark, note, motion: move, roi: { ...roi }, w: W, h: H };
    if (overlay) drawFaceOverlay(overlay, frame);
    onFrame(frame);
  };

  if ("requestVideoFrameCallback" in HTMLVideoElement.prototype) {
    const cb = (nowMs, meta) => { if (!running) return; grab((meta.captureTime ?? nowMs) / 1000); video.requestVideoFrameCallback(cb); };
    video.requestVideoFrameCallback(cb);
  } else {
    const loop = () => { if (!running) return; if (video.currentTime !== lastTime) { lastTime = video.currentTime; grab(now()); } requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  return {
    stop() { running = false; stream.getTracks().forEach((t) => t.stop()); video.srcObject = null; if (overlay) overlay.getContext("2d").clearRect(0, 0, overlay.width, overlay.height); },
  };
}

/** Draw the tracking oval and the sampled skin regions (overlay sits on the mirrored video, same aspect). */
export function drawFaceOverlay(cv, f) {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1), w = cv.clientWidth || 320, h = cv.clientHeight || 240;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const sx = w / f.w, sy = h / f.h, { cx, cy, rx, ry } = f.roi;
  const col = !f.present ? "rgba(240,138,99,0.95)" : f.dark ? "rgba(227,164,58,0.95)" : "rgba(92,203,131,0.95)";
  ctx.lineWidth = 2.5; ctx.strokeStyle = col; ctx.setLineDash(f.present ? [] : [8, 6]);
  ctx.beginPath(); ctx.ellipse(cx * sx, cy * sy, rx * sx, ry * sy, 0, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  if (!f.present) return;
  ctx.fillStyle = "rgba(92,203,131,0.22)";
  const box = (ax, ay, bx, by) => ctx.fillRect((cx + ax * rx) * sx, (cy + ay * ry) * sy, (bx - ax) * rx * sx, (by - ay) * ry * sy);
  box(-0.55, -0.78, 0.55, -0.37); box(-0.72, 0.07, -0.27, 0.48); box(0.27, 0.07, 0.72, 0.48);
}

// ---------------- microphone (heart sounds) ----------------
// A tiny AudioWorklet hands raw samples to the page in ~2048-sample chunks, time-stamped on the same clock as the
// camera frames (performance.now), so heart sounds can be lined up with the fingertip pulse.
const TAP = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.b = new Float32Array(8192); this.n = 0; this.t0 = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      if (this.n === 0) this.t0 = currentTime;
      this.b.set(ch, this.n); this.n += ch.length;
      if (this.n >= 2048) { this.port.postMessage({ t0: this.t0, s: this.b.slice(0, this.n) }); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("pc-tap", Tap);`;

export async function startMic(onAudio, { listen = false } = {}) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error("This browser has no Web Audio support");
  const ctx = new Ctx();                        // created inside the button tap, as iPhones require
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: false,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } });
  } catch (e) { ctx.close(); throw e; }
  if (ctx.state === "suspended") await ctx.resume().catch(() => {});
  const src = ctx.createMediaStreamSource(stream);
  const toPerf = (ctxTime) => {
    const ts = ctx.getOutputTimestamp?.();
    return ts && ts.performanceTime ? ts.performanceTime / 1000 - (ts.contextTime - ctxTime) : now() - (ctx.currentTime - ctxTime);
  };
  const sink = ctx.createGain(); sink.gain.value = 0; sink.connect(ctx.destination);   // keeps the tap running, silently
  let node;
  if (ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
    const url = URL.createObjectURL(new Blob([TAP], { type: "application/javascript" }));
    try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
    node = new AudioWorkletNode(ctx, "pc-tap");
    node.port.onmessage = (e) => onAudio({ t0: toPerf(e.data.t0), samples: e.data.s, sampleRate: ctx.sampleRate });
  } else {                                      // older browsers
    node = ctx.createScriptProcessor(2048, 1, 1);
    node.onaudioprocess = (e) => { const s = e.inputBuffer.getChannelData(0).slice(); onAudio({ t0: toPerf(ctx.currentTime - s.length / ctx.sampleRate), samples: s, sampleRate: ctx.sampleRate }); };
  }
  src.connect(node); node.connect(sink);
  // "Listen": the heart band (25-300 Hz), boosted, to headphones. Through the speaker it would feed back.
  let mon = null;
  const setListen = (on) => {
    if (on && !mon) {
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 25;
      const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 300;
      const g = ctx.createGain(); g.gain.value = 6;
      src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ctx.destination); mon = { hp, g };
    } else if (!on && mon) { src.disconnect(mon.hp); mon.g.disconnect(); mon = null; }
  };
  setListen(listen);
  return {
    sampleRate: ctx.sampleRate, setListen,
    stop() { setListen(false); stream.getTracks().forEach((t) => t.stop()); try { node.disconnect(); src.disconnect(); } catch { /* already */ } ctx.close(); },
  };
}

// ---------------- motion ----------------
export async function startMotion(onSample) {
  if (typeof DeviceMotionEvent === "undefined") return { available: false, stop() {} };
  if (typeof DeviceMotionEvent.requestPermission === "function") {
    const p = await DeviceMotionEvent.requestPermission().catch(() => "denied");
    if (p !== "granted") return { available: false, stop() {} };
  }
  let gx = 0, gy = 0, gz = 0, seen = false;
  const h = (e) => {
    let x, y, z;
    if (e.acceleration && e.acceleration.x != null) ({ x, y, z } = e.acceleration);
    else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x != null) {
      const a = e.accelerationIncludingGravity; const k = 0.9; // remove gravity with a slow low-pass
      gx = k * gx + (1 - k) * a.x; gy = k * gy + (1 - k) * a.y; gz = k * gz + (1 - k) * a.z;
      x = a.x - gx; y = a.y - gy; z = a.z - gz;
    } else return;
    seen = true;
    onSample({ t: now(), mag: Math.hypot(x, y, z) });
  };
  window.addEventListener("devicemotion", h);
  return { get available() { return seen; }, stop() { window.removeEventListener("devicemotion", h); } };
}

// ---------------- Bluetooth heart rate (standard GATT Heart Rate Service) ----------------
export async function connectHeartRate(onBpm) {
  if (!navigator.bluetooth) throw new Error("Web Bluetooth isn't available in this browser. Use Chrome or Edge on a laptop or Android.");
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] });
  const server = await device.gatt.connect();
  const ch = await (await server.getPrimaryService("heart_rate")).getCharacteristic("heart_rate_measurement");
  ch.addEventListener("characteristicvaluechanged", (e) => {
    const v = e.target.value, flags = v.getUint8(0);
    const wide = flags & 0x01;
    const bpm = wide ? v.getUint16(1, true) : v.getUint8(1);
    let off = wide ? 3 : 2;
    if (flags & 0x08) off += 2;             // energy expended present
    const rr = [];
    if (flags & 0x10) for (; off + 1 < v.byteLength; off += 2) rr.push(v.getUint16(off, true) / 1024); // RR in s
    onBpm({ t: now(), bpm, rr, name: device.name || "Watch" });
  });
  await ch.startNotifications();
  return { name: device.name || "Watch", disconnect() { device.gatt.disconnect(); } };
}

// ---------------- simulator ----------------
/** Synthetic fingertip PPG with realistic morphology, breathing-linked HR variability, and artifacts. */
export class Simulator {
  constructor({ hr = 72, fs = 30, seed = 1 } = {}) {
    this.hr = hr; this.fs = fs; this.t = 0; this.phase = 0;
    this.artifact = "none";      // none | motion | weak | press | nofinger
    this.s = seed; this.drift = 0; this.mv = 0;
  }
  rand() { this.s = (this.s * 16807) % 2147483647; return this.s / 2147483647; }
  gauss() { return Math.sqrt(-2 * Math.log(this.rand() + 1e-12)) * Math.cos(2 * Math.PI * this.rand()); }
  /** Advance one frame; returns { ppg: {t,r,clip,finger}, motion: {t,mag} } */
  step() {
    const dt = 1 / this.fs; this.t += dt;
    const resp = Math.sin(2 * Math.PI * 0.25 * this.t);                 // 15 breaths/min
    const inst = this.hr * (1 + 0.04 * resp);                            // respiratory sinus arrhythmia
    this.phase = (this.phase + (inst / 60) * dt) % 1;
    const p = this.phase;
    const pulse = Math.exp(-(((p - 0.15) / 0.07) ** 2)) + 0.35 * Math.exp(-(((p - 0.45) / 0.09) ** 2));
    let amp = 1.6, dc = 200, noise = 0.15, mag = Math.abs(0.05 * this.gauss()), clip = 0, finger = true;
    this.drift += 0.02 * this.gauss(); this.drift *= 0.995;
    switch (this.artifact) {
      case "motion": {
        // irregular hand movement: random jolts that land inside the heart-rate band
        this.mv += 2.5 * this.gauss(); this.mv *= 0.8;
        if (this.rand() < 0.04) this.jolt = (this.rand() - 0.5) * 30;
        this.jolt = (this.jolt || 0) * 0.9;
        dc += 3 * this.mv + this.jolt;
        mag = 0.8 + Math.abs(0.8 * this.mv) + Math.abs(0.3 * this.jolt);
        break;
      }
      case "weak": amp = 0.06; noise = 0.12; dc = 150; break;
      case "press": amp = 0.12; dc = 252; clip = 0.8; noise = 0.05; break;
      case "nofinger": finger = false; dc = 60; amp = 0; break;
    }
    const r = dc + this.drift + 1.2 * resp - amp * pulse + noise * this.gauss();
    return { ppg: { t: this.t, r, clip, finger }, motion: { t: this.t, mag } };
  }
}

/**
 * Synthetic face video, reduced to what startFaceCamera reports: mean skin RGB, face present/dark/clip, head motion.
 * Skin colour follows a simple optical model: light intensity x (skin tone - pulse x blood absorption signature).
 * Artifacts reuse the fingertip names so the same buttons work:
 *   motion = head movement (lighting on the skin changes, the oval jitters), weak = dim room,
 *   press = glare on the skin, nofinger = face out of view.
 */
export class FaceSimulator extends Simulator {
  step() {
    const dt = 1 / this.fs; this.t += dt;
    const resp = Math.sin(2 * Math.PI * 0.25 * this.t);
    const inst = this.hr * (1 + 0.04 * resp);
    this.phase = (this.phase + (inst / 60) * dt) % 1;
    const p = this.phase;
    const pulse = Math.exp(-(((p - 0.15) / 0.07) ** 2)) + 0.35 * Math.exp(-(((p - 0.45) / 0.09) ** 2));
    const skin = [182, 132, 112], sig = [0.33, 0.77, 0.53];   // skin tone (RGB), blood absorption signature
    let light = 1, amp = 0.004, noise = 0.06, glare = 0, present = true, dark = false, clip = 0, mag = Math.abs(0.15 * this.gauss());
    this.drift += 0.0015 * this.gauss(); this.drift *= 0.995;
    switch (this.artifact) {
      case "motion": {
        this.mv += 0.03 * this.gauss(); this.mv *= 0.85;
        if (this.rand() < 0.05) this.jolt = (this.rand() - 0.5) * 0.25;
        this.jolt = (this.jolt || 0) * 0.85;
        light += this.mv + this.jolt; glare = 25 * Math.abs(this.jolt);   // shading and shine change as the head turns
        mag = 1.5 + 25 * Math.abs(this.mv) + 20 * Math.abs(this.jolt); noise = 0.2;
        break;
      }
      case "weak": light = 0.28; noise = 0.3; dark = true; break;
      case "press": glare = 70; clip = 0.45; break;
      case "nofinger": present = false; amp = 0; break;
    }
    light *= 1 + this.drift + 0.004 * resp;
    const [r, g, b] = skin.map((c, k) => Math.min(255, light * c * (1 - amp * pulse * sig[k]) + glare + noise * this.gauss()));
    return { face: { t: this.t, r, g, b, clip, present, dark, note: !present ? "Face not found: center your face in the oval, in even light" : dark ? "Too dark: face a window or a lamp" : "" },
      motion: { t: this.t, mag } };
  }
}
