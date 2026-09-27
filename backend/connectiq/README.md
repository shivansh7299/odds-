# VitalSync Connect IQ app (Forerunner 265)

A small watch app that streams heart rate, beat-to-beat intervals (for HRV), steps and Pulse Ox to
VitalSync through the Garmin Connect app on your iPhone.

| Mode | When | Sends |
|---|---|---|
| Foreground | App open on the watch | 1 Hz heart rate + beat-to-beat intervals every 10 s, today's steps |
| Background | Every 5 min, app closed (Connect IQ minimum) | Last 10 min of HR history, last hour of Pulse Ox, today's steps |

The watch has no internet of its own. Every request goes watch → Bluetooth → **Garmin Connect on
the iPhone** → HTTPS, so the phone must be nearby with Garmin Connect running in the background.
Data is buffered on the watch (about 10 min) while the phone is out of range.

> **Status:** compiles cleanly with Connect IQ SDK 9.2.0 for `fr265` and `fr265s`, including the
> strictest type-check level (`-l 3`). Not yet run on a physical watch. `pnpm simulate:watch`
> exercises the same server protocol without a watch.

## 1. Install the tools (one time)

1. Install the **Connect IQ SDK Manager** from developer.garmin.com/connect-iq/sdk and use it to
   download the latest SDK and the **Forerunner 265** device.
2. In VS Code, install the **Monkey C** extension (Garmin).
3. Run **Monkey C: Generate a Developer Key** (Command Palette). Keep the key file safe.
4. Install **OpenMTP** (macOS can't browse the watch's MTP storage natively).

## 2. Give the watch a public HTTPS URL

Connect IQ only allows HTTPS. For development, tunnel your local server (ngrok is already installed
here):

```bash
ngrok http 3000
```

Copy the `https://….ngrok-free.app` URL. Also add it to `.env` as `BETTER_AUTH_URL` if you want to
sign in through the tunnel. The pairing screen shows `<BETTER_AUTH_URL>/sources`.

## 3. Build and run in the simulator

1. Open the `connectiq/` folder in VS Code.
2. **Monkey C: Build for Device** → choose `fr265`. The output is `bin/connectiq.prg`.
   From a terminal, the same build is:
   `"$SDK/bin/monkeyc" -f monkey.jungle -d fr265 -o bin/vitalsync.prg -y /path/to/developer_key.der`
3. Or **Run → Start Debugging** to launch the simulator. In the simulator: *Settings → Edit
   Persistent Storage / App Settings* to set **Server URL**, then *Simulation → Heart Rate* to feed
   data.

## 4. Sideload onto the watch

1. Plug the Forerunner 265 into your Mac and open it in OpenMTP.
2. Copy `bin/connectiq.prg` into `GARMIN/APPS/` on the watch.
3. Unplug. The app appears in the watch's app list as **VitalSync**.

## 5. Configure and pair

1. iPhone → **Garmin Connect** → Devices → Forerunner 265 → Activities & Apps → VitalSync →
   Settings → **Server URL** = your `https://` URL.
2. On the watch, open VitalSync and press **START**. It shows a code like `K7P4-QXMZ`.
3. On the dashboard: **Sources → Connect IQ watch app → Pair a watch**, enter the code, **Approve**.
4. Within 5 s the watch shows your heart rate and starts syncing. Background sync starts
   automatically every 5 minutes.

To disconnect: hold **UP** on the watch → *Unpair*, or remove it on the Sources page (the token is
revoked immediately and the watch forgets it on its next sync).

## Protocol (for reference)

| Call | Auth | Body → response |
|---|---|---|
| `POST /api/devices/pair/start` | none (rate-limited) | `{name, model}` → `201 {deviceCode, userCode, verificationUrl, interval, expiresIn}` |
| `POST /api/devices/pair/poll` | none (rate-limited) | `{deviceCode}` → `202 pending` · `429 slow_down` · `200 {token}` once · `410` expired/used |
| `POST /api/ingest/connectiq` | `Bearer vs_…` | `{live:{hr:[[t,bpm]], rr:[{t, ms:[…]}]}, hr:[[t,bpm]], spo2:[[t,%]], steps:{t,total}}` → `{accepted, rejected}` |

`t` is epoch seconds. Timestamps older than 7 days or more than 60 s in the future are rejected.
HRV (RMSSD) is computed server-side per 5-minute window from beat-to-beat intervals (≥ 30 clean
beats; artifacts outside 300–2000 ms or > 20 % jumps are dropped). Steps are sent as today's
running total and stored as a delta.

## Troubleshooting

- **"Phone not connected"**: Garmin Connect isn't running or Bluetooth is off on the iPhone.
- **Error -400/-402**: the server returned non-JSON or too much data. Check the URL is the app
  root, with no path.
- **401 on sync**: the watch was removed on the dashboard. Pair again.
- **No HRV**: the Forerunner only reports beat-to-beat intervals while the app is open. Keep it
  open for at least 5 minutes.
- **Compiler complains about a type**: the Monkey C type checker varies between SDK versions. Most
  fixes are adding or removing an `as Type` cast on the line it reports.
- **Manifest id rejected**: run **Monkey C: Edit Application** to generate a fresh app id.
