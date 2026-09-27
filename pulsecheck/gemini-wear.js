/*
 * gemini-wear.js — live Gemini analysis on the "My wearables" tab only.
 *   - listens for "wear:update" (fired by renderWear in index.html whenever the loaded data is re-rendered)
 *   - sends the same numeric digest the "Ask Claude" box uses (never the raw files) to the Gemini API
 *   - streams the answer into #gAns; re-runs automatically only when the digest actually changes
 * The page is static, so there is no server to hide a key: each visitor pastes their own Gemini API key,
 * which stays in this browser's localStorage.
 */
const $ = (id) => document.getElementById(id);
const BIO = (window.BIO ||= {});
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const API = "https://generativelanguage.googleapis.com/v1beta/models/";
const DEFAULT_MODEL = "gemini-2.5-flash";
const store = {
  get(k) { try { return localStorage.getItem("gemini." + k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem("gemini." + k) : localStorage.setItem("gemini." + k, v); } catch { /* private mode */ } },
};

const els = { key: $("gKey"), model: $("gModel"), auto: $("gAuto"), run: $("gRun"), stop: $("gStop"), forget: $("gForget"), ans: $("gAns"), state: $("gState") };
els.key.value = store.get("key") || "";
els.model.value = store.get("model") || DEFAULT_MODEL;
els.auto.checked = store.get("auto") !== "0";

let ctl = null, lastDigest = "", pending = null;

function setState(text, kind = "") { els.state.textContent = text; els.state.dataset.k = kind; }
function syncButtons() { const has = !!els.key.value.trim(); els.run.disabled = !has; els.forget.hidden = !has; }

function prompt(digest, example) {
  return {
    system: `You are a friendly physiology tutor inside a neuroscience teaching app. You analyze consumer wearable data a student loaded (${example ? "EXAMPLE, simulated" : "their own devices"}). Use only the data given. Tie each pattern to the physiology behind it (autonomic nervous system, vagal tone, circadian rhythm, sleep stages, respiration, EEG rhythms) and cite specific numbers and dates. Never diagnose or give medical advice; if something might merit a check-up, say so gently in one sentence.`,
    user: `Analyze this wearable data. Format, no headings:
**One-line summary** first, then 3–5 "- " bullets with the most notable patterns (numbers and dates), then one "- Try:" bullet with a simple experiment the student could do with the Body & scope tab. Under 250 words.

Data (dates are MM-DD):
${digest}`,
  };
}

async function analyze({ force = false } = {}) {
  const key = els.key.value.trim(), wear = BIO.wear;
  if (!key || !wear) return;
  const digest = wear.digest();
  if (!digest.trim()) { els.ans.innerHTML = ""; setState("Load data to analyze."); lastDigest = ""; return; }
  if (!force && digest === lastDigest) return;          // tab switches re-render too; don't re-bill for the same data
  lastDigest = digest;
  ctl?.abort(); ctl = new AbortController();
  const model = els.model.value.trim() || DEFAULT_MODEL, p = prompt(digest, wear.isExample());
  els.run.disabled = true; els.stop.hidden = false; setState(`Analyzing with ${model}…`, "busy");
  els.ans.innerHTML = '<p class="note">Thinking…</p>';
  let text = "", finish = "";
  try {
    const res = await fetch(`${API}${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: p.system }] },
        contents: [{ role: "user", parts: [{ text: p.user }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(err.error?.message || res.statusText), { status: res.status });
    }
    // Server-sent events: each "data: {...}" line carries the next slice of text.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      const lines = buf.split(/\r?\n/); buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const chunk = JSON.parse(line.slice(5));
        const c = chunk.candidates?.[0];
        text += (c?.content?.parts || []).map((x) => x.text || "").join("");
        if (c?.finishReason) finish = c.finishReason;
        if (chunk.promptFeedback?.blockReason) finish = "BLOCKED";
        els.ans.innerHTML = BIO.wear.md(text);
      }
    }
    if (!text) throw new Error(finish === "BLOCKED" || finish === "SAFETY" ? "Gemini declined to answer this one." : "No answer came back.");
    if (finish === "MAX_TOKENS") els.ans.insertAdjacentHTML("beforeend", '<p class="note">The answer was cut short.</p>');
    setState(`Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${model}`, "ok");
  } catch (e) {
    if (e.name === "AbortError") { setState("Stopped."); lastDigest = ""; return; }
    lastDigest = "";                                       // let the next change or click retry
    const msg = e.status === 400 && /API key/i.test(e.message) ? "That API key wasn't accepted. Check it and try again."
      : e.status === 403 ? "This key isn't allowed here. If you restricted it by website, add this site's address."
      : e.status === 404 ? `Model "${model}" wasn't found. Try ${DEFAULT_MODEL}.`
      : e.status === 429 ? "Rate limit or quota reached. Wait a minute and try again."
      : e.message || "Couldn't reach Gemini.";
    if (!text) els.ans.innerHTML = "";
    els.ans.insertAdjacentHTML("beforeend", `<p class="note err">${esc(msg)}</p>`);
    setState("Error", "err");
  } finally {
    els.stop.hidden = true; syncButtons();
  }
}

// Live: re-analyze when the wearable data changes, debounced, and only while this tab is open.
window.addEventListener("wear:update", () => {
  if (!els.auto.checked || !els.key.value.trim() || $("paneWear").hidden) return;
  clearTimeout(pending); pending = setTimeout(() => analyze(), 800);
});

els.run.onclick = () => analyze({ force: true });
els.stop.onclick = () => ctl?.abort();
els.key.onchange = () => { store.set("key", els.key.value.trim() || null); syncButtons(); if (els.auto.checked) analyze({ force: true }); };
els.key.oninput = syncButtons;
els.model.onchange = () => store.set("model", els.model.value.trim() || null);
els.auto.onchange = () => { store.set("auto", els.auto.checked ? "1" : "0"); if (els.auto.checked) analyze(); };
els.forget.onclick = () => { ctl?.abort(); els.key.value = ""; store.set("key", null); els.ans.innerHTML = ""; lastDigest = ""; setState("Key removed from this browser."); syncButtons(); };
syncButtons();
setState(els.key.value ? "Ready." : "Paste a Gemini API key to turn this on.");
if (!$("paneWear").hidden && els.auto.checked) analyze();  // opened straight on #wearables
