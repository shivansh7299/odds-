/*
 * ppg-inputs.js — signal sources for PPGProcessor.
 *   startCamera(video, onFrame)   fingertip-over-camera PPG (needs HTTPS or localhost)
 *   startMotion(onSample)         phone accelerometer, gravity removed (call from a button tap on iPhone)
 *   connectHeartRate(onBpm)       any Bluetooth heart-rate broadcaster: Garmin "Broadcast Heart Rate",
 *                                 chest straps, or an Apple Watch via a broadcast app (Chrome/Edge, not iOS)
 *   Simulator                     synthetic PPG + motion with injectable artifacts (laptop testing, stage backup)
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
