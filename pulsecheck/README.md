# Biosignal Teaching Scope + Pulse Check

A neuroscience teaching app built around a 3D body. It merges three things:

- **Body & scope**: the teaching scope (synthetic EEG from a Muse headband's four sensors, TP9 / AF7 / AF8 / TP10, finger pleth, respiration, EDA, skin
  temperature, events, filters, spectrum, quizzes). The body map is now the **Plethscape 3D anatomy**
  (BodyParts3D): tap the brain, eyes, jaw, heart, lungs, fingertip or wrist and the camera flies there
  while the scope dims every channel except the ones that organ drives. The heart beats at the live heart
  rate, the lungs follow the breathing trace, and the brain glows with alpha.
- **Live pulse check**: fingertip-over-camera PPG, or a contactless 30-second face scan with the front camera,
  with a transparent 5-part quality score, artifact log,
  HRV, and a live Bluetooth heart-rate connection (Garmin Broadcast Heart Rate, chest straps, Apple Watch
  via a broadcast app). Whatever is live drives the 3D heart: watch first, then a clean camera reading (fingertip or face),
  otherwise the simulator. The chip on the body map says which.
- **My wearables**: load Apple Health, Garmin, Oura, Muse (Mind Monitor) or any tracker CSV/JSON export for
  trends against your usual range, heart rate by hour, EEG band power, and automatic insights. Each insight
  links back to the organ on the 3D body.

## Files

| Path | What |
|---|---|
| `index.html` | the app (teaching scope UI + tabs + 3D body stage) |
| `app-live.js` | mounts the 3D body, picks the heart-rate source, runs the live pulse tab, registers the service worker |
| `ppg-core.js` | PPG processing and quality score; `FACE_CONFIG` and the `POS` filter for face scans |
| `ppg-inputs.js` | camera, face camera, accelerometer, Bluetooth heart rate, fingertip and face simulators |
| `gemini-wear.js` | live Gemini analysis card on the *My wearables* tab (bring-your-own API key) |
| `pcg-core.js` | heart sounds from the microphone: processing, quality score, heart-to-fingertip timing, simulator |
| `vitalsync.js` | connects to the VitalSync backend (`../backend`): loads your watch data into *My wearables*, and live heart rate into the 3D heart |
| `vendor/body3d.js` | **generated**: three.js + Plethscape anatomy + `tools/body3d/viewer.js`, one ES module |
| `models/` | **generated**: BodyParts3D atlas, neutral skin, Draco decoder, Plethscape attribution/license |
| `tools/build-body3d.mjs` | rebuilds `vendor/` and `models/` from Plethscape at a pinned commit |
| `sw.js`, `manifest.webmanifest`, `icon*` | installable PWA; models are cached after the first load |
| `test.mjs` | `node test.mjs`: heart-rate accuracy and artifact detection on synthetic signals (fingertip and face) |

## Muse montage, headband and "reading the scope"

The Body & scope simulator uses the Muse headband's layout instead of lab positions: **AF7/AF8** on the forehead and
**TP9/TP10** behind the ears, each measured against the reference at **Fpz** (centre of the forehead). The model follows
what those sites really pick up:

- AF7/AF8: every blink (both move the same way), sideways eye movements (**Look sideways**: they swing in opposite
  directions) and frontal theta.
- TP9/TP10: alpha when the eyes close (weaker than at the back of the head, where Muse has no sensor) and heavy
  jaw-muscle noise, since the temporalis sits right under them. Blinks appear small and upside-down here, because the
  forehead reference sees the blink too.
- **Loose TP9 contact** mimics the most common Muse problem: hair or a glasses arm lifting the pad behind the ear.

The 3D body shows a Muse headband fitted to the head (added in `tools/body3d/viewer.js`: rays from outside find the
skin, the band sits just above it). It appears when you zoom to the brain, eyes or jaw, or turn on **Show wearables**,
and each electrode pad glows with its channel's live activity (`state().muse`). Rebuild with
`node tools/build-body3d.mjs` after changing the viewer.

Under the scope, **On screen now** narrates what's visible in plain words (a blink, jaw noise, alpha with eyes closed,
a skin-conductance rise, smaller pulses from vasoconstriction), and **About this trace** explains any trace you tap:
what it is, where it's measured, its units and what to look for.

## Run it

It's a static folder, no build step. Camera and Bluetooth need **https** (or localhost).

```sh
cd pulsecheck && python3 -m http.server 8000     # http://localhost:8000
```

Deploy the folder to GitHub Pages, Vercel, Netlify or DigitalOcean App Platform and open the https URL on
your phone. "Add to Home screen" installs it. The first load downloads ~11 MB of anatomy; after that it
works offline.

Rebuild the 3D bundle (only if you change `tools/body3d/viewer.js` or update Plethscape):

```sh
node tools/build-body3d.mjs              # clones Plethscape at the pinned commit into tools/.plethscape
node tools/build-body3d.mjs ../plethscape  # or use an existing checkout
```

The build patches a temp copy of Plethscape so that (1) the Renderpeople scanned heads are never loaded or
copied, because their license forbids redistribution, and (2) the head's own anatomy (brain, skull, eyes),
which upstream hides under that scan, is shown instead.

## Real-time data from a Garmin Forerunner 265

Garmin Connect does not expose live data to other apps or web pages, so a PWA can't read it from Connect.
What works:

| Route | Real time? | What you get | Effort |
|---|---|---|---|
| **Broadcast Heart Rate** over Bluetooth (built into this app) | yes, ~1 Hz | heart rate | none: enable it on the watch, press *Connect a watch* in Chrome/Edge (Android, Windows, macOS, ChromeOS; not iPhone) |
| **Connect IQ app on the watch** (Monkey C) | yes | HR, beat-to-beat intervals, accelerometer, SpO2 snapshots; send to the phone with `Communications.transmit` or `makeWebRequest` to your server | a small watch app; free SDK |
| **Garmin Health SDK** (Companion SDK) | yes | streaming HR, RR, accelerometer, stress into your own iOS/Android app | apply to Garmin's developer program; native app, not a PWA |
| **Garmin Health API / Connect Developer Program** | no, minutes after sync | dailies, sleep, HRV status, stress, activities pushed to your server | apply for access; good for the *My wearables* view |
| **Data export** (already supported here) | no | full history | request the export from Garmin's website |

For a class demo the Bluetooth broadcast is the quickest. For beat-to-beat HRV in real time, pair a chest
strap (HRM-Pro, Polar H10): the same *Connect a watch* button reads its RR intervals and shows live HRV.

## How the pulse quality score works

Every 0.4 s the last 8 s of camera signal is scored on five things, 0–100:

| Part | What it measures | Catches |
|---|---|---|
| Beat shape | average correlation of each beat with the mean beat | noise, motion |
| Pulse clarity | share of band power at the heart rate and its harmonics | noise, weak contact |
| Rhythm | beat intervals plausible and consistent; expected vs found beats | missed/extra beats |
| Pulse strength | perfusion index and saturated pixels | cold finger, light touch, pressing too hard |
| Stillness | worst 2-s RMS of phone acceleration | hand motion |

Heart rate is shown only when fair or good; otherwise the last reliable value is held and the reason shown.
Thresholds live in `CONFIG` at the top of `ppg-core.js`. Synthetic results (`node test.mjs`): within ~1–2 bpm
from 45 to 180 bpm on clean signal; motion, weak contact, pressing too hard and finger-off are flagged.
Simulated signals, not a clinical validation.

## Face scan (contactless)

Switch the Live pulse check tab to **Face** and press **Start face scan**. The front camera tracks the face with a
skin-colour mask (no face-detection library, nothing downloaded), averages the forehead and both cheeks, and turns
the colour into a pulse wave with POS (Wang et al., *IEEE TBME* 2017). That wave goes through the same
`PPGProcessor`, configured with `FACE_CONFIG`:

| Part | Face version |
|---|---|
| Beat shape, Pulse clarity, Rhythm | unchanged |
| Skin signal | relative pulse amplitude in the skin, on its own scale (a face pulse is ~10x weaker than a lit fingertip); glare lowers it |
| Head stillness | how far the tracked face moves per frame, instead of the phone's accelerometer |

Extra safeguards in face mode:
- A heart rate is shown only when the spectrum clearly agrees with the beat rhythm (`hrMinClarity`).
- A guard catches the peak finder locking onto every second or third beat.
- HRV is not reported: at 30 fps the beat timing reads 2–3x too high. Use a fingertip reading or a chest strap for HRV.

After 30 s the tab shows a scan result (median heart rate and % good signal) while the live reading carries on.
The simulated signal button runs a face simulator in Face mode, as a stage backup.

Synthetic results (`node test.mjs`): within ~1–3 bpm from 50 to 150 bpm whenever a heart rate is shown; at
exercise rates (120+) it mostly declines to show one. Head motion, dim light, glare and no face are flagged.
Fingertip results are unchanged. Real faces vary with skin tone, lighting and camera processing, so tune
`FACE_CONFIG` on real phones against a chest strap before trusting it.

Blood pressure and similar estimates from a face need licensed, validated models (for example Shen.ai, available
through Thryve's native mobile SDKs under a commercial contract); this app doesn't estimate them.

## Heart sounds (microphone stethoscope)

Pick **Heart sounds** in the Live pulse check tab. Press the bottom edge of the phone (the microphone) on bare skin just
left of the breastbone, stay quiet, and press **Start listening**. The microphone runs without echo cancelling, noise
suppression or auto gain. The sound is filtered to the heart band (25–400 Hz), turned into an energy envelope, and:

- the cardiac cycle comes from autocorrelation (both heart sounds repeat one cycle later, so that peak is about twice
  as tall as the S1-to-S2 cross-peaks), refined below one 10 ms sample;
- each sound is labelled S1 ("lub", valves closing as the ventricles contract) or S2 ("dub", valves closing as they
  relax) from the gaps around it (systole is shorter than diastole) and its loudness; the waveform shows the labels;
- HRV uses S1-to-S1 intervals only while the labels are consistent (one S1 per cycle); otherwise it's withheld.

| Part | What it measures |
|---|---|
| Beat clarity | height of the cycle peak in the autocorrelation |
| Rhythm | each sound recurring one cycle later, and one or two sounds per cycle |
| Stands out | heart-sound peaks versus the level between them (loose contact and talking both lower it, so they share one message) |
| No rubbing | clipped samples from rubbing or tapping the phone |

**Play through headphones** lets you hear it (band-limited; the speaker would feed back). **Also time the pulse to a
fingertip** runs the rear camera too and shows the time from S1 to the fingertip pulse peak, which shortens when arteries
stiffen or blood pressure rises. Phone audio and camera clocks can differ by tens of milliseconds, so compare it before
and after (a few squats, slow breathing) rather than trusting the absolute number.

Synthetic results (`node test.mjs`): within ~1.5 bpm from 50 to 150 bpm; HRV matches the fingertip where the labels are
consistent; talking, loose contact, rubbing and phone off the chest are flagged; heart-to-finger timing reads 190 ms
for a true 200 ms. It counts beats and shows the two sounds; it can't detect murmurs or valve problems, and it isn't a
medical device.

## Hooks

```js
window.addEventListener("ppg:update",   (e) => e.detail.hr);          // every camera analysis
window.addEventListener("ppg:artifact", (e) => e.detail.reason);      // start of an artifact episode
window.BIO.body.focus("brain");                                        // fly the 3D camera to an organ
```

## Gemini analysis (My wearables tab)

The *AI analysis · Gemini* card under Insights streams a short analysis of the loaded wearable data from the
Gemini API and re-runs by itself when the data changes (new file, example on/off, clear). How it works:

- `renderWear()` in `index.html` fires `wear:update`; `gemini-wear.js` listens, but only acts while the
  *My wearables* tab is open, waits 800 ms, and skips the call if the data summary hasn't changed.
- It sends `BIO.wear.digest()`, the same numeric summary "Ask Claude" uses (daily values, hourly heart rate,
  EEG band power), never the raw files, to `streamGenerateContent?alt=sse`.
- The site is static, so there is no server to hide a key. Each person pastes their own key from
  [Google AI Studio](https://aistudio.google.com/apikey); it stays in that browser's `localStorage`
  ("Forget key" removes it). Restrict the key to this site under *Website restrictions* in Google Cloud.
- Model defaults to `gemini-2.5-flash` and can be changed in the card. To use one shared key instead, put a
  small proxy (Cloudflare Worker, Vercel function) in front of the API and point `API` in `gemini-wear.js` at it.

"Ask Claude" boxes appear only when the page runs as a Claude artifact; on your own hosting they stay hidden.
To use another model, send the "Copy summary for AI" JSON with a prompt like: *"Explain this fingertip PPG
session to a non-expert in 4 sentences. Say which readings to trust and why. Do not diagnose."*

## VitalSync backend (Garmin watch data)

`../backend` is a Next.js + PostgreSQL server that collects Forerunner 265 data (a Connect IQ watch app,
Bluetooth broadcast, and FIT/Garmin-export import) and serves it read-only. `vitalsync.js` adds a
**VitalSync** entry to the device list on the *My wearables* tab:

- **Load my data** fetches `/api/v1/export` and hands it to the existing importer as `vitalsync.json`,
  exactly like dropping a file, so the KPIs, insights, charts and Gemini card work unchanged.
- **Live heart rate** polls `/api/v1/live` every 5 s. `app-live.js` asks `BIO.externalHr()` after a
  directly connected Bluetooth watch and before the camera, so the 3D heart and the source chip show
  *VitalSync (watch app)* while fresh data (≤ 30 s old) is arriving.
- The server address and a read-only API key (VitalSync → Settings → API keys) stay in this browser's
  `localStorage`, like the Gemini key. `sw.js` never caches requests that carry an API key.

The backend must be reachable over https from wherever the site runs (GitHub Pages needs https; use
the backend's ngrok address in development) and must list the site's origin in `VITALSYNC_CORS_ORIGINS`.
Setup: `../backend/README.md`.

## Credits and licenses

- 3D anatomy and viewer code: [Plethscape](https://github.com/sontakey/plethscape) by Sameer Sontakey (MIT).
- Anatomy: BodyParts3D, © The Database Center for Life Science, CC BY 4.0; lung geometry from the Human
  Reference Atlas (HuBMAP), CC BY 4.0. Details in `models/PLETHSCAPE-ATTRIBUTION.md`.
- Draco decoder: Google, Apache 2.0. three.js: MIT.

Educational tool, not a medical device.
