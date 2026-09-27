/*
 * vitalsync.js — connects this site to a VitalSync server (the Garmin backend in ../backend).
 *   - "Load my data": fetches /api/v1/export and hands it to the existing My wearables importer as a
 *     vitalsync.json file (same path as dropping a file), so parsing, charts, insights and Gemini
 *     all work unchanged.
 *   - "Live heart rate": polls /api/v1/live every 5 s and offers it to app-live.js through
 *     BIO.externalHr, so the 3D heart follows the watch (Connect IQ app, Bluetooth or FIT history).
 * The server URL and a read-only API key (VitalSync → Settings → API keys) stay in this browser's
 * localStorage, like the Gemini key. Nothing here changes the existing UI; it adds one entry to the
 * device list on the My wearables tab.
 */
const $ = (id) => document.getElementById(id);
const BIO = (window.BIO ||= {});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const store = {
  get(k) { try { return localStorage.getItem("vitalsync." + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem("vitalsync." + k) : localStorage.setItem("vitalsync." + k, v); } catch { /* private mode */ } },
};
const LIVE_EVERY_MS = 5000;
const LIVE_FRESH_SEC = 30; // older readings don't drive the heart

// ---------------- UI (one <details> entry in the existing device grid) ----------------
const grid = document.querySelector("#paneWear .devGrid");
const box = document.createElement("details");
box.id = "vsBox";
box.style.gridColumn = "1 / -1"; // own row, so the other device entries keep their size
box.innerHTML = `<summary>VitalSync (your Garmin server)</summary>
  <ol><li>In VitalSync, open <b>Settings → API keys for other apps</b> and create a key.</li>
  <li>Paste your VitalSync address (e.g. your ngrok https URL) and the key below.</li>
  <li><b>Load my data</b> for trends; <b>Live heart rate</b> drives the 3D heart.</li></ol>
  <div class="gSet" style="margin:8px 0">
    <input id="vsUrl" type="url" placeholder="https://your-vitalsync-server" autocomplete="off" spellcheck="false" aria-label="VitalSync server address" style="flex:1 1 100%">
    <input id="vsKey" type="password" placeholder="VitalSync API key (vsk_…)" autocomplete="off" spellcheck="false" aria-label="VitalSync API key" style="flex:1 1 100%">
    <button class="btn primary" id="vsLoad" type="button">Load my data</button>
    <button class="btn" id="vsLive" type="button" aria-pressed="false">Live heart rate</button>
    <button class="btn" id="vsForget" type="button" hidden>Forget</button>
  </div>
  <p id="vsState" aria-live="polite">Reads resting HR, HRV, steps, sleep, sleep score, SpO₂ and heart rate from your watch through VitalSync.</p>`;
grid?.prepend(box);

const els = { url: $("vsUrl"), key: $("vsKey"), load: $("vsLoad"), live: $("vsLive"), forget: $("vsForget"), state: $("vsState") };
if (!grid || !els.url) throw new Error("vitalsync.js: My wearables device grid not found");
els.url.value = store.get("url") || "";
els.key.value = store.get("key") || "";

function setState(html, err = false) { els.state.innerHTML = html; els.state.style.color = err ? "var(--bad, #c0392b)" : ""; }
function configured() { return !!(els.url.value.trim() && els.key.value.trim()); }
function syncButtons() { const ok = configured(); els.load.disabled = !ok; els.live.disabled = !ok; els.forget.hidden = !ok; }

// ---------------- API ----------------
function baseUrl() { return els.url.value.trim().replace(/\/+$/, ""); }
async function api(path) {
  let res;
  try {
    res = await fetch(baseUrl() + path, {
      headers: {
        Authorization: `Bearer ${els.key.value.trim()}`,
        "ngrok-skip-browser-warning": "1", // free ngrok tunnels otherwise answer with an HTML page
      },
      cache: "no-store",
    });
  } catch {
    throw new Error("Couldn't reach the server. Check the address, that it's https, and that VitalSync (and ngrok) are running.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(res.status === 401 ? "The API key wasn't accepted. Create a new one in VitalSync → Settings."
      : res.status === 429 ? "Too many requests. Wait a moment."
      : body?.error?.message || `Server error (${res.status}).`);
  }
  if (!body) throw new Error("The server didn't answer with JSON. Is the address the VitalSync root URL?");
  return body;
}

// ---------------- Load my data → existing importer ----------------
async function loadData() {
  els.load.disabled = true; setState("Loading from VitalSync…");
  try {
    const data = await api("/api/v1/export?days=60&hrDays=14");
    if (!data.daily?.length && !data.heartRate?.length) { setState("Connected, but there's no data yet. Pair a watch or import FIT files in VitalSync first."); return; }
    const file = new File([JSON.stringify(data)], "vitalsync.json", { type: "application/json" });
    const dt = new DataTransfer(); dt.items.add(file);
    // Same path as dropping a file on the import area: the page's own importer does the rest.
    $("drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    setState(`Loaded ${data.daily.length} days and ${data.heartRate.length.toLocaleString()} heart-rate samples (${esc(data.range.from)} to ${esc(data.range.to)}). See the charts below.`);
  } catch (e) {
    setState(esc(e.message), true);
  } finally { syncButtons(); }
}

// ---------------- Live heart rate → 3D heart ----------------
let live = null, liveTimer = null;           // live = { bpm, source, at (ms) }
const SOURCE_NAME = { GARMIN_CONNECTIQ: "watch app", GARMIN_BLE: "Bluetooth", GARMIN_FIT: "FIT import", MOCK: "simulated" };
BIO.externalHr = () => {
  if (!live || Date.now() - live.at > LIVE_FRESH_SEC * 1000) return null;
  return { hr: live.bpm, label: `VitalSync (${SOURCE_NAME[live.source] || "watch"})`, live: true };
};

async function pollLive() {
  try {
    const { heartRate } = await api("/api/v1/live");
    if (heartRate && heartRate.ageSec <= LIVE_FRESH_SEC) {
      live = { bpm: heartRate.bpm, source: heartRate.source, at: Date.now() - heartRate.ageSec * 1000 };
      setState(`Live: <b>${heartRate.bpm} bpm</b> from ${esc(SOURCE_NAME[heartRate.source] || heartRate.source)}, ${heartRate.ageSec}s ago. The 3D heart follows it.`);
    } else {
      setState(heartRate
        ? `Last reading ${heartRate.bpm} bpm was ${Math.round(heartRate.ageSec / 60)} min ago. Open the VitalSync app on the watch for live heart rate.`
        : "Waiting for heart rate. Open the VitalSync app on the watch (or start Broadcast in VitalSync's Live page).");
    }
  } catch (e) { setState(esc(e.message), true); }
}
function setLive(on) {
  clearInterval(liveTimer); liveTimer = null; live = on ? live : null;
  els.live.setAttribute("aria-pressed", String(on)); store.set("live", on ? "1" : null);
  if (on) { pollLive(); liveTimer = setInterval(pollLive, LIVE_EVERY_MS); BIO.selectOrgan?.("heart"); }
}

// ---------------- wiring ----------------
els.load.onclick = loadData;
els.live.onclick = () => setLive(els.live.getAttribute("aria-pressed") !== "true");
els.url.onchange = () => { store.set("url", baseUrl() || null); syncButtons(); };
els.key.onchange = () => { store.set("key", els.key.value.trim() || null); syncButtons(); };
els.url.oninput = els.key.oninput = syncButtons;
els.forget.onclick = () => {
  setLive(false); els.url.value = ""; els.key.value = ""; store.set("url", null); store.set("key", null);
  setState("Server address and key removed from this browser."); syncButtons();
};
syncButtons();
if (configured()) box.open = true;
if (configured() && store.get("live") === "1") setLive(true);
