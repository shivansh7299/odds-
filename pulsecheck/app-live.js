/*
 * app-live.js — ties the pieces together:
 *   - mounts the Plethscape 3D body (vendor/body3d.js) into the body map, with the SVG as fallback
 *   - decides what drives the 3D heart: a Bluetooth watch, your fingertip camera, or the teaching simulator
 *   - runs the "Live pulse check" tab (camera PPG + quality score, artifact log, watch comparison)
 *     in two modes: fingertip over the rear camera, or a contactless face scan with the front camera
 * The teaching scope (classic script in index.html) shares state through window.BIO.
 */
import { PPGProcessor, CONFIG, FACE_CONFIG, POS } from "./ppg-core.js";
import { startCamera, startFaceCamera, startMotion, connectHeartRate, Simulator, FaceSimulator } from "./ppg-inputs.js";

const $ = (id) => document.getElementById(id);
const BIO = (window.BIO ||= {});
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// ---------------- what drives the body ----------------
const LIVE = { cam: null, watch: null };   // { bpm, t } in performance.now() seconds
const nowS = () => performance.now() / 1000;
function driver() {
  const t = nowS();
  if (LIVE.watch && t - LIVE.watch.t < 5) return { hr: LIVE.watch.bpm, label: LIVE.watch.name, live: true };
  if (LIVE.cam && t - LIVE.cam.t < 5) return { hr: LIVE.cam.bpm, label: LIVE.cam.label, live: true };
  return { hr: BIO.hrBpm, label: "the simulator", live: false };
}
BIO.driver = driver;
setInterval(() => {
  const d = driver(), el = $("driveChip");
  if (!el) return;
  el.dataset.live = String(d.live);
  el.querySelector("b").textContent = d.label + (d.hr ? ` · ${Math.round(d.hr)} bpm` : "");
}, 500);

// ---------------- 3D body ----------------
async function mount3D() {
  const wrap = document.querySelector("#bodyMap .avatarWrap"), stage = $("b3d"), load = $("b3dLoad");
  const probe = document.createElement("canvas");
  if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) { load.textContent = "3D needs WebGL · showing 2D"; return; }
  let mod;
  try { mod = await import("./vendor/body3d.js"); }
  catch { load.textContent = "3D unavailable · showing 2D"; return; }
  const body = mod.mountBody(stage, {
    state: () => ({
      hr: driver().hr,
      breath: BIO.resp != null ? clamp(BIO.resp / 2.8, 0, 1) : null,
      brain: BIO.alpha != null ? clamp((BIO.alpha - 6) / 30, 0, 1) : 0,
    }),
    onPick: (organ) => BIO.selectOrgan?.(organ),
    onStatus: (s) => {
      if (s.progress != null && !s.ready) load.textContent = `Loading 3D anatomy… ${Math.round(s.progress * 100)}%`;
      if (s.ready) { wrap.classList.add("is3d"); load.hidden = true; body.focus(BIO.organ || "body"); body.setWearables($("showDev").checked); }
      if (s.error) { load.textContent = s.error + " Showing 2D."; wrap.classList.remove("is3d"); }
    },
  });
  if (!body) return;
  BIO.body = body;
}
mount3D();

// ---------------- live pulse check ----------------
// Everything that differs between the fingertip and the face scan.
const MODES = {
  finger: {
    title: "Fingertip pulse", start: "Start camera", camName: "Fingertip camera", organ: "finger",
    label: "your fingertip camera", simLabel: "the simulated fingertip", absent: "No finger",
    idle: `Put a fingertip over the phone's rear camera and flash, then press <b style="color:inherit">Start camera</b>. On a laptop, try the simulated signal.`,
    clean: "Clean signal. Every peak is a heartbeat, and the 3D heart is beating at your rate.",
    comps: { template: "Beat shape", clarity: "Pulse clarity", rhythm: "Rhythm", perfusion: "Pulse strength", motion: "Stillness" },
    arts: { none: "Clean", motion: "Hand motion", weak: "Weak contact", press: "Pressing too hard", nofinger: "Finger off" },
  },
  face: {
    title: "Face scan", start: "Start face scan", camName: "Face camera", organ: "heart",
    label: "your face camera", simLabel: "the simulated face", absent: "No face",
    idle: `Sit facing a window or lamp, hold the phone at arm's length, and press <b style="color:inherit">Start face scan</b>. It takes 30 seconds of stillness. Nothing leaves this device.`,
    clean: "Clean signal. Each peak is a heartbeat, read from tiny colour changes in your skin as blood arrives. The 3D heart beats at your rate.",
    comps: { template: "Beat shape", clarity: "Pulse clarity", rhythm: "Rhythm", perfusion: "Skin signal", motion: "Head stillness" },
    arts: { none: "Clean", motion: "Head motion", weak: "Dim room", press: "Glare", nofinger: "Face away" },
  },
};
const SCAN_SECONDS = 30;
let mode = "finger", M = MODES.finger, COMP_LABELS = M.comps;
const STATUS_TEXT = { good: "Good signal", fair: "Fair signal", poor: "Unreliable", nofinger: "No finger", warming: "Settling…", idle: "Not started" };
let proc = new PPGProcessor(), pos = new POS(), cam = null, motion = null, simTimer = null, sim = null, timer = null, watchDev = null, scan = null;
const history = [];
const watchRR = [];                // [t, rr seconds] from straps that send RR intervals

function renderComps() {
  $("pcComps").innerHTML = Object.entries(COMP_LABELS).map(([k, l]) =>
    `<div class="comp"><span>${l}</span><span class="bar"><i id="pcB-${k}"></i></span><span class="n mono" id="pcN-${k}">--</span></div>`).join("");
}
renderComps();

function reset() {
  proc = new PPGProcessor(mode === "face" ? FACE_CONFIG : {}); pos = new POS(); history.length = 0; scan = null;
  $("pcLog").innerHTML = `<li><span class="note">No artifacts yet.</span></li>`;
  $("pcScan").hidden = true;
}
function setBadge(s) { $("pcBadge").dataset.s = s; $("pcBadgeT").textContent = s === "nofinger" ? M.absent : STATUS_TEXT[s] || s; }
function stopAll() {
  cam?.stop(); cam = null; motion?.stop(); motion = null;
  clearInterval(simTimer); simTimer = null; clearInterval(timer); timer = null; sim = null;
  LIVE.cam = null;
  $("pcSimCard").hidden = true; $("pcSim").setAttribute("aria-pressed", "false");
  $("pcStop").disabled = true; $("pcCam").disabled = false;
  $("pcFaceHint").hidden = false; $("pcFaceHint").textContent = "Camera off";
  setBadge("idle");
}
function setMode(m) {
  if (m === mode) return;
  stopAll(); mode = m; M = MODES[m]; COMP_LABELS = M.comps;
  reset(); renderComps();
  document.querySelectorAll("#pcMode [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
  $("pcTitle").textContent = M.title; $("pcCam").textContent = M.start; $("pcCamName").textContent = M.camName;
  $("pcReason").innerHTML = M.idle;
  const face = m === "face";
  $("pcFaceView").hidden = !face; $("pcFaceNote").hidden = !face; $("pcFingerCam").hidden = face;
  document.querySelectorAll("#pcSimCard [data-art]").forEach((b) => (b.textContent = M.arts[b.dataset.art]));
  ["pcHr", "pcRmssd", "pcScore", "pcFps"].forEach((id) => ($(id).textContent = "—"));
  $("pcRmssd").title = face ? "HRV needs a fingertip reading or a chest strap: beat timing from face video is too coarse." : "";
  drawWave(null);
}
document.querySelectorAll("#pcMode [data-mode]").forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));

/** One face frame (camera or simulator) into the processor: skin colour -> POS pulse -> quality score. */
function feedFace(f, headMotion) {
  proc.pushMotion(f.t, headMotion);
  if (!f.present || f.dark) { pos = new POS(); proc.pushPPG(f.t, 1, { clip: f.clip, finger: false, note: f.note }); return; }
  const h = pos.push(f.t, f.r, f.g, f.b);
  if (h != null) proc.pushPPG(f.t, 1 - h, { clip: f.clip, finger: true });
}
const clockNow = () => (sim ? sim.t : nowS());
function startLoop() { clearInterval(timer); timer = setInterval(() => update(proc.compute(clockNow())), 400); }

$("pcCam").onclick = async () => {
  stopAll(); reset();
  if (mode === "face") {
    try {
      cam = await startFaceCamera($("pcFaceVideo"), $("pcFaceOverlay"), (f) => feedFace(f, f.motion));
      const v = $("pcFaceVideo");
      if (v.videoWidth) $("pcFaceView").style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
      $("pcFaceHint").hidden = true;
      $("pcStop").disabled = false; $("pcCam").disabled = true;
      scan = { start: nowS(), done: false }; $("pcScan").hidden = false;
      BIO.selectOrgan?.("heart");
      startLoop();
    } catch (e) {
      $("pcReason").innerHTML = `<b>Camera unavailable:</b> ${esc(e.message)}. Open the page over https (or localhost) and allow camera access.`;
    }
    return;
  }
  try {
    motion = await startMotion(({ t, mag }) => proc.pushMotion(t, mag)); // ask first: iPhone needs the tap
    cam = await startCamera($("pcVideo"), (f) => proc.pushPPG(f.t, f.r, f));
    $("pcCamNote").textContent = cam.torch ? "Flash on. Cover the lens and flash completely and press lightly." : "Couldn't turn on the flash. Hold your finger toward a bright light.";
    $("pcStop").disabled = false; $("pcCam").disabled = true;
    BIO.selectOrgan?.("finger");
    startLoop();
  } catch (e) {
    $("pcReason").innerHTML = `<b>Camera unavailable:</b> ${esc(e.message)}. Open the page over https (or localhost) and allow camera access.`;
  }
};
$("pcSim").onclick = () => {
  stopAll(); reset();
  const face = mode === "face";
  sim = new (face ? FaceSimulator : Simulator)({ hr: +$("pcSimHr").value, seed: 7 });
  $("pcSimCard").hidden = false; $("pcSim").setAttribute("aria-pressed", "true"); $("pcStop").disabled = false;
  document.querySelectorAll("#pcSimCard [data-art]").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.art === "none")));
  simTimer = setInterval(() => {
    for (let i = 0; i < 3; i++) {
      const s = sim.step();
      if (face) feedFace(s.face, s.motion.mag);
      else { proc.pushPPG(s.ppg.t, s.ppg.r, s.ppg); proc.pushMotion(s.motion.t, s.motion.mag); }
    }
  }, 100);
  if (face) { $("pcFaceHint").hidden = false; $("pcFaceHint").textContent = "Simulated face: the camera is off"; scan = { start: sim.t, done: false }; $("pcScan").hidden = false; }
  startLoop();
};
$("pcStop").onclick = stopAll;
document.querySelectorAll("#pcSimCard [data-art]").forEach((b) => (b.onclick = () => {
  if (!sim) return; sim.artifact = b.dataset.art;
  document.querySelectorAll("#pcSimCard [data-art]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
$("pcSimHr").oninput = (e) => { $("pcSimHrV").textContent = e.target.value; if (sim) sim.hr = +e.target.value; };

// ---------------- watch over Bluetooth ----------------
function watchRmssd() {
  const t = nowS(); while (watchRR.length && watchRR[0][0] < t - 60) watchRR.shift();
  const rr = watchRR.map((r) => r[1]).filter((v) => v > 0.28 && v < 1.6);
  if (rr.length < 10) return null;
  const d = []; for (let i = 1; i < rr.length; i++) if (Math.abs(rr[i] - rr[i - 1]) < 0.25) d.push((rr[i] - rr[i - 1]) ** 2);
  return d.length >= 8 ? Math.sqrt(d.reduce((a, b) => a + b, 0) / d.length) * 1000 : null;
}
$("pcWatch").onclick = async () => {
  if (!navigator.bluetooth) {
    $("pcWatchNote").innerHTML = "<b>This browser has no Web Bluetooth.</b> Use Chrome or Edge on Android, Windows, macOS or ChromeOS. iPhone browsers can't connect to a watch from a web page.";
    return;
  }
  try {
    watchDev?.disconnect();
    watchDev = await connectHeartRate(({ bpm, rr, name }) => {
      const t = nowS();
      LIVE.watch = { bpm, t, name };
      for (const r of rr) watchRR.push([t, r]);
      proc.setReference(name, bpm, clockNow());
      $("pcWatchHr").textContent = bpm;
      const hrv = watchRmssd();
      $("pcWatchNote").textContent = `Connected to ${name}. ${rr.length || watchRR.length ? `Beat-to-beat intervals received${hrv ? ` · live HRV ${Math.round(hrv)} ms` : ""}.` : "Heart rate only (no beat-to-beat intervals from this device)."}`;
    });
    $("pcWatch").textContent = "Connect another";
    $("pcWatchNote").textContent = `Connected to ${watchDev.name}. Waiting for heart rate…`;
    BIO.selectOrgan?.("heart");
  } catch (e) {
    if (e.name !== "NotFoundError") $("pcWatchNote").innerHTML = `<b>Watch:</b> ${esc(e.message)}`;
  }
};

$("pcCopy").onclick = async () => {
  const s = proc.summary();
  if (scan?.result) s.face_scan_30s = scan.result;
  if (LIVE.watch) s.watch_live = { device: LIVE.watch.name, bpm: LIVE.watch.bpm, hrv_rmssd_ms: watchRmssd() && Math.round(watchRmssd()) };
  const text = JSON.stringify(s, null, 2);
  $("pcSummary").textContent = text; $("pcSummary").hidden = false;
  try { await navigator.clipboard.writeText(text); $("pcCopy").textContent = "Copied"; setTimeout(() => ($("pcCopy").textContent = "Copy summary for AI"), 1500); }
  catch { const r = document.createRange(); r.selectNodeContents($("pcSummary")); getSelection().removeAllRanges(); getSelection().addRange(r); }
};

// ---------------- render ----------------
function update(r) {
  setBadge(r.status);
  $("pcHr").innerHTML = r.hr ? `${Math.round(r.hr)}<small>bpm</small>` : "—";
  $("pcHr").classList.toggle("stale", !!r.hrStale);
  $("pcRmssd").innerHTML = r.rmssd ? `${Math.round(r.rmssd)}<small>ms</small>` : "—";
  $("pcScore").textContent = r.status === "warming" || r.status === "nofinger" ? "—" : Math.round(r.score * 100);
  $("pcFps").textContent = r.fps ? Math.round(r.fps) : "—";
  $("pcReason").innerHTML = r.reasons.length
    ? (r.status === "good" ? esc(r.reasons[0]) : `<b>${esc(r.reasons[0])}</b>${r.hrStale ? " · showing last reliable heart rate" : ""}`)
    : r.status === "good" ? M.clean : r.status === "fair" ? "Usable, but not perfect." : "";
  for (const k of Object.keys(COMP_LABELS)) {
    const v = r.components[k], bar = $("pcB-" + k);
    bar.style.width = v == null ? "0%" : Math.round(v * 100) + "%";
    bar.style.background = v == null ? "var(--idle)" : v >= 0.7 ? "var(--good)" : v >= 0.45 ? "var(--fair)" : "var(--poor)";
    $("pcN-" + k).textContent = v == null ? (k === "motion" ? "n/a" : "--") : Math.round(v * 100);
  }
  // camera heart rate drives the 3D heart only while it is trustworthy
  if (r.hr && !r.hrStale && (r.status === "good" || r.status === "fair")) LIVE.cam = { bpm: r.hr, t: nowS(), label: sim ? M.simLabel : M.label };
  if (scan && !scan.done) updateScan(r);

  $("pcCamHr").textContent = r.hr && !r.hrStale ? Math.round(r.hr) : "--";
  $("pcCamVerdict").textContent = STATUS_TEXT[r.status];
  const rows = r.agreement.map((a) => {
    const d = a.diff, v = d == null ? "Waiting for a clean camera reading" : Math.abs(d) <= 5 ? "Agrees" : Math.abs(d) <= 10 ? "Slightly off" : "Disagrees: trust the cleaner signal";
    return `<tr><td>${esc(a.name)}</td><td class="num mono">${Math.round(a.bpm)}</td><td class="num mono">${d == null ? "--" : (d > 0 ? "+" : "") + Math.round(d)}</td><td>${v}</td></tr>`;
  }).join("");
  const tb = $("pcAgree"); while (tb.rows.length > 1) tb.deleteRow(1); tb.insertAdjacentHTML("beforeend", rows);

  if (r.artifactStart) { BIO.body?.flash(M.organ); window.dispatchEvent(new CustomEvent("ppg:artifact", { detail: r.artifactStart })); }
  if (r.artifactEnd) {
    const e = r.artifactEnd, li = document.createElement("li");
    li.innerHTML = `<span class="ts mono">${(e.end - e.start).toFixed(1)} s</span><b>${esc(e.reason)}</b>`;
    const log = $("pcLog"); if (log.querySelector(".note")) log.innerHTML = "";
    log.prepend(li);
  }
  window.dispatchEvent(new CustomEvent("ppg:update", { detail: r }));
  history.push([r.t, r.status]); while (history.length && history[0][0] < r.t - 60) history.shift();
  drawWave(r); drawRibbon(r.t);
}
// 30-second face scan: progress while it runs, then a result that stays on screen while the live view continues
function updateScan(r) {
  const el = (s) => $("pcScanT").innerHTML = s;
  const done = Math.min(SCAN_SECONDS, r.t - scan.start);
  $("pcScanFill").style.width = `${(100 * done) / SCAN_SECONDS}%`;
  if (done < SCAN_SECONDS) { el(`Scanning… <b>${Math.floor(done)}</b> of ${SCAN_SECONDS} s. Keep still and don't talk.`); return; }
  scan.done = true;
  const hrs = proc.hrLog.filter(([t]) => t >= scan.start).map(([, v]) => v).sort((a, b) => a - b);
  const inScan = history.filter(([t]) => t >= scan.start), good = inScan.filter(([, s]) => s === "good").length;
  const pctGood = inScan.length ? Math.round((100 * good) / inScan.length) : 0;
  if (!hrs.length) {
    scan.result = { heart_rate_bpm: null, percent_good_signal: pctGood };
    el(`<b>No reliable reading in ${SCAN_SECONDS} s.</b> Try brighter, even light on your face, rest the phone on something, and keep still.`);
    return;
  }
  const med = hrs[hrs.length >> 1];
  scan.result = { heart_rate_bpm: Math.round(med), percent_good_signal: pctGood, hrv: "not measured from face video" };
  el(`<b>Scan result: ${Math.round(med)} bpm</b> · ${pctGood}% of the scan had a good signal. ` +
    (pctGood < 50 ? "Treat it as a rough estimate. " : "") + "The live reading continues below.");
}
function fit(cv) {
  const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return [ctx, w, h];
}
function drawWave(r) {
  const [ctx, w, h] = fit($("pcWave"));
  ctx.fillStyle = css("--screen"); ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(190,225,215,0.1)"; ctx.lineWidth = 1;
  for (let s = 0; s <= CONFIG.window; s++) { const x = (s / CONFIG.window) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
  ctx.fillStyle = "rgba(215,235,228,0.5)"; ctx.font = '10px "JetBrains Mono", monospace';
  for (let s = 0; s < CONFIG.window; s += 2) ctx.fillText(`-${CONFIG.window - s}s`, (s / CONFIG.window) * w + 4, h - 6);
  if (!r?.signal) return;
  const x = r.signal, n = x.length, lim = Math.max(2.5, ...Array.from(x).map(Math.abs)) * 1.1;
  const Y = (v) => h / 2 - (v / lim) * (h / 2 - 12);
  ctx.strokeStyle = r.status === "good" ? "#FF7A7A" : r.status === "fair" ? "#E3A43A" : "#F08A63";
  ctx.lineWidth = 1.8; ctx.lineJoin = "round"; ctx.beginPath();
  for (let i = 0; i < n; i++) { const px = (i / (n - 1)) * w, py = Y(x[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
  ctx.stroke();
  if (r.status !== "poor") {
    ctx.fillStyle = "#FFFFFF";
    for (const p of r.peaks) { const i = Math.round(p); if (i < 0 || i >= n) continue; ctx.beginPath(); ctx.arc((p / (n - 1)) * w, Y(x[i]), 3, 0, 7); ctx.fill(); }
  }
}
function drawRibbon(tNow) {
  const [ctx, w, h] = fit($("pcRibbon"));
  ctx.clearRect(0, 0, w, h);
  const col = { good: css("--good"), fair: css("--fair"), poor: css("--poor"), nofinger: css("--poor"), warming: css("--idle") };
  for (let i = 0; i < history.length; i++) {
    const [t, s] = history[i], tn = history[i + 1]?.[0] ?? tNow + 0.4;
    ctx.fillStyle = col[s] || css("--idle");
    ctx.fillRect(((t - (tNow - 60)) / 60) * w, 0, Math.max(1, ((tn - t) / 60) * w + 0.5), h);
  }
}
new ResizeObserver(() => { if (!$("paneLive").hidden) { drawWave(proc.last); proc.last && drawRibbon(proc.last.t); } }).observe($("paneLive"));
drawWave(null);

// ---------------- PWA ----------------
if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("./sw.js").catch(() => {});
