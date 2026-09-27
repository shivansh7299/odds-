# Demo script (about 10 minutes)

## Before the demo

```bash
brew services start postgresql@17
```

```bash
pnpm dev:all
```

- Chrome on the Mac, signed in to VitalSync, with simulated data enabled (Sources).
- Forerunner 265 charged. Broadcast Heart Rate is in the heart-rate glance menu.
- Optional, for the watch app: `ngrok http 3000`, then set the URL in the app settings in Garmin
  Connect.
- A FIT file or small export zip ready to drag in (copy one from `GARMIN/Activity` with OpenMTP).

## 1. Architecture (1 min)

Open `docs/ARCHITECTURE.md` §3: four ways data arrives, one ingest pipeline, Postgres,
`LISTEN/NOTIFY`, and SSE to the dashboard. Be upfront about the constraints: no browser access to
sensors, no Garmin Health API without partner approval, and no Web Bluetooth on iPhone.

## 2. Dashboard (2 min)

- **Dashboard → 7D:** summary tiles with deltas vs the previous 7 days; the heart-rate band;
  steps against goal.
- Point at the **Live** dot in the header, and at "Includes simulated data" (simulated data is
  always labeled).
- Click **Resting heart rate**: the 7-day average, "usual range" = 28-day baseline, highlighted
  unusual days.
- Toggle **Table** on any chart (accessibility; nothing depends on hover).
- **Sleep:** hypnogram, then step back through nights.

## 3. Live heart rate from the watch (2 min)

1. Watch: heart-rate glance → hold MENU → **Broadcast Heart Rate**.
2. **Live → Connect watch** → pick the Forerunner.
3. Walk around or do squats: bpm updates about once a second.
4. Open the dashboard on your **iPhone**: the heart-rate chart there updates within seconds (SSE),
   even though the phone can't do Bluetooth itself.

## 4. History import (1 min)

**Sources → FIT file import → Import files**, then drag in the file. Watch the progress, then
show the new workout under **Workouts**. Drop the same file again to show "Already imported".

## 5. Watch app (2 min, optional)

On the watch, open VitalSync and press START; it shows a code. On the dashboard: **Sources →
Pair a watch**, enter the code. The watch switches to streaming. Without the physical app, run
`pnpm simulate:watch` and do the same with the code it prints.

## 6. Quality (1 min)

```bash
pnpm test && pnpm test:integration && pnpm test:e2e
```

Mention: per-user data isolation tests, idempotent imports, the timezone bug caught by a test,
CSRF/origin checks, rate limits, CSP, and the full data export plus account deletion in
**Settings**.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Header says **Offline** | Is the web server running? Check `/api/health` |
| Simulated data not updating | The worker isn't running. Use `pnpm dev:all`, not `pnpm dev` |
| "Connect watch" does nothing | Use Chrome or Edge on desktop; turn on Broadcast Heart Rate first |
| Dev server errors about "module factory" | Stop it, `rm -rf .next`, start again |
