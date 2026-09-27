# Biosignal Teaching Scope + Pulse Check

A neuroscience teaching app built around a 3D body. It merges three things:

- **Body & scope**: the teaching scope (synthetic EEG at Fz/Oz, finger pleth, respiration, EDA, skin
  temperature, events, filters, spectrum, quizzes). The body map is now the **Plethscape 3D anatomy**
  (BodyParts3D): tap the brain, eyes, jaw, heart, lungs, fingertip or wrist and the camera flies there
  while the scope dims every channel except the ones that organ drives. The heart beats at the live heart
  rate, the lungs follow the breathing trace, and the brain glows with occipital alpha.
- **Live pulse check**: fingertip-over-camera PPG with a transparent 5-part quality score, artifact log,
  HRV, and a live Bluetooth heart-rate connection (Garmin Broadcast Heart Rate, chest straps, Apple Watch
  via a broadcast app). Whatever is live drives the 3D heart: watch first, then a clean camera reading,
  otherwise the simulator. The chip on the body map says which.
- **My wearables**: load Apple Health, Garmin, Oura, Muse (Mind Monitor) or any tracker CSV/JSON export for
  trends against your usual range, heart rate by hour, EEG band power, and automatic insights. Each insight
  links back to the organ on the 3D body.

## Files

| Path | What |
|---|---|
| `index.html` | the app (teaching scope UI + tabs + 3D body stage) |
| `app-live.js` | mounts the 3D body, picks the heart-rate source, runs the live pulse tab, registers the service worker |
| `ppg-core.js` | PPG processing and quality score (unchanged from Pulse Check) |
| `ppg-inputs.js` | camera, accelerometer, Bluetooth heart rate, simulator (unchanged) |
| `vendor/body3d.js` | **generated**: three.js + Plethscape anatomy + `tools/body3d/viewer.js`, one ES module |
| `models/` | **generated**: BodyParts3D atlas, neutral skin, Draco decoder, Plethscape attribution/license |
| `tools/build-body3d.mjs` | rebuilds `vendor/` and `models/` from Plethscape at a pinned commit |
| `sw.js`, `manifest.webmanifest`, `icon*` | installable PWA; models are cached after the first load |
| `test.mjs` | `node test.mjs`: heart-rate accuracy and artifact detection on synthetic signals |

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

## Hooks

```js
window.addEventListener("ppg:update",   (e) => e.detail.hr);          // every camera analysis
window.addEventListener("ppg:artifact", (e) => e.detail.reason);      // start of an artifact episode
window.BIO.body.focus("brain");                                        // fly the 3D camera to an organ
```

"Ask Claude" boxes appear only when the page runs as a Claude artifact; on your own hosting they stay hidden.
To use another model, send the "Copy summary for AI" JSON with a prompt like: *"Explain this fingertip PPG
session to a non-expert in 4 sentences. Say which readings to trust and why. Do not diagnose."*

## Credits and licenses

- 3D anatomy and viewer code: [Plethscape](https://github.com/sontakey/plethscape) by Sameer Sontakey (MIT).
- Anatomy: BodyParts3D, © The Database Center for Life Science, CC BY 4.0; lung geometry from the Human
  Reference Atlas (HuBMAP), CC BY 4.0. Details in `models/PLETHSCAPE-ATTRIBUTION.md`.
- Draco decoder: Google, Apache 2.0. three.js: MIT.

Educational tool, not a medical device.
