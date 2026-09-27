# VitalSync Architecture

Approved 2026-09-26. Target hardware: **Garmin Forerunner 265** + **iPhone 15**.

## 1. Constraints that shape the design

- **No browser access to watch sensors.** Data reaches us only through channels the watch or Garmin exposes.
- **Garmin Health API needs partner approval**, so it is reserved as a future adapter (`GARMIN_HEALTH_API`), not a dependency.
- **iOS has no Web Bluetooth** (every iOS browser is WebKit). Live BLE streaming runs in desktop Chrome/Edge; the iPhone acts only as the Connect IQ relay.
- **"Real-time" is honest.** BLE heart rate is ~1 Hz live. Connect IQ is seconds while the watch app is open, ≥5 min in the background. FIT import is batch. The UI always shows data freshness.

## 2. Data sources

| Source (`SourceType`) | Kind | Metrics | Latency |
|---|---|---|---|
| `GARMIN_BLE` | push (browser) | Heart rate | ~1 s |
| `GARMIN_CONNECTIQ` | push (watch → Garmin Connect iOS app → HTTPS) | HR, RR intervals → HRV (RMSSD), steps, calories, SpO₂ | seconds / ≥5 min |
| `GARMIN_FIT` | file | Everything incl. sleep stages, workouts, overnight HRV | batch |
| `MOCK` | internal | All (simulated, badged in UI) | 30–60 s |
| `GARMIN_HEALTH_API` | pull + webhook | All | reserved |

## 3. System diagram

```
Watch ──BLE HR broadcast──▶ Desktop Chrome (Web Bluetooth) ──batch POST──┐
Watch ──Connect IQ app──▶ iPhone (Garmin Connect) ──HTTPS──▶ /api/ingest/connectiq ──┤
FIT / export zip ──upload──▶ /api/import/fit ──▶ worker job ──────────────┤
Mock generator (worker) ───────────────────────────────────────────────────┤
Garmin Health API webhook (future) ──▶ /api/webhooks/[source] ─────────────┘
                                   │
                                   ▼
        Zod validate → normalize → idempotent upsert (PostgreSQL) → NOTIFY user:<id>
                                   │
                                   ▼
               /api/stream (SSE) ◀── LISTEN ── RealtimeBus ──▶ Dashboard (TanStack Query cache merge)
```

## 4. Key decisions

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router, TypeScript strict (+`noUncheckedIndexedAccess`) | Required stack |
| DB / ORM | PostgreSQL 17, Prisma 7 with `@prisma/adapter-pg` | Required stack; driver adapter is Prisma 7's default |
| Auth | Better Auth, email + password, DB sessions (httpOnly cookies) | Approved |
| Jobs | pg-boss (Postgres-backed queue) in a separate worker process | No Redis; retries, singleton keys |
| Realtime | SSE + Postgres `LISTEN/NOTIFY` behind a `RealtimeBus` interface | One-way server→client; multi-instance safe; swappable for Pusher/Ably |
| Secrets at rest | AES-256-GCM with versioned keys (`src/lib/crypto.ts`) | Key rotation without bulk re-encryption |
| Device auth | Pairing code → random bearer token; only SHA-256 hashes stored | Leaked DB rows can't impersonate devices |
| Charts | shadcn/ui Chart (Recharts) | Required stack |
| Validation | Zod at every boundary (env, API input, device payloads, FIT output) | Required |
| Tests | Vitest (unit), Testcontainers Postgres (integration), Playwright (e2e) | |
| Hosting | Docker / Railway / Fly (long-lived Node for SSE + worker) | Vercel would need Pusher/Ably + external worker |

## 5. Source abstraction

```ts
type SourceKind = "push" | "file" | "pull";

interface SourceAdapter {
  type: SourceType;
  kind: SourceKind;
  capabilities: { metrics: MetricType[]; sleep: boolean; workouts: boolean };
  /** push: validate a device/browser payload into normalized records */
  parseIngest?(payload: unknown): NormalizedBatch;
  /** file: parse an uploaded FIT/zip */
  parseFile?(file: Uint8Array, filename: string): Promise<NormalizedBatch>;
  /** pull: OAuth + fetch (Garmin Health API, future) */
  oauth?: OAuthAdapter;
  fetch?(ctx: SourceContext, req: FetchRequest): Promise<NormalizedBatch>;
}

type NormalizedBatch = {
  samples: { type: MetricType; ts: Date; value: number; resolutionSec: number }[];
  sleepSessions: NormalizedSleep[];
  workouts: NormalizedWorkout[];
};
```

Everything downstream of `NormalizedBatch` (upsert, daily rollups, NOTIFY, analytics) is source-agnostic. When several sources report the same metric, the dashboard prefers the most granular (BLE > Connect IQ > FIT).

## 6. Data model

See `prisma/schema.prisma`. Highlights:

- `SourceConnection` — one per (user, source); holds encrypted OAuth tokens only for pull sources; `lastDataAt` drives freshness UI.
- `IngestDevice` — paired Connect IQ watches (hashed token + hashed pairing code).
- `MetricSample` — time series; unique on `(connectionId, type, ts, resolutionSec)` so re-imports are idempotent; indexed `(userId, type, ts DESC)`. ~1,440 rows/user/day at 1-min resolution; long ranges downsample with `date_bin`.
- `DailySummary` — per-day rollups in the user's timezone.
- `SleepSession` / `SleepSegment`, `Workout` — unique on `(connectionId, externalId)`.
- `ImportJob` (deduped by file SHA-256), `SyncRun`, `WebhookEvent`, `OAuthState` — audit/jobs, the last two reserved for pull sources.

## 7. Data flows

**Live BLE:** user clicks *Connect watch (live)* → `navigator.bluetooth.requestDevice({ filters: [{ services: ["heart_rate"] }] })` → `heart_rate_measurement` notifications → chart updates locally → every ~10 s batch `POST /api/ingest/ble` (session-authenticated) → upsert → NOTIFY (so other open tabs/devices update).

**Connect IQ (device-code flow, approved change):** watch `POST /api/devices/pair/start` → shows an 8-char user code → signed-in user enters it on Sources (`/api/devices/pair/approve`) → watch polls `/api/devices/pair/poll` and receives its bearer token once → posts `{ live:{hr,rr}, hr, spo2, steps }` to `/api/ingest/connectiq` → server computes RMSSD per 5-min window from RR intervals, turns the daily step total into a delta → upsert → NOTIFY. See `connectiq/README.md`.

**FIT import:** upload → SHA-256 dedupe → `ImportJob` → pg-boss job → `@garmin/fitsdk` decode → normalize → upsert → daily rollups → NOTIFY progress.

**Failure handling:** Zod errors → 400 with details; unknown/revoked device token → 401; oversized payload → 413; rate limit → 429; worker jobs retry with backoff and record `SyncRun.error`.

## 8. Project structure

```
prisma/                 schema.prisma, migrations/
connectiq/              Monkey C watch app (Milestone 7)
docs/                   ARCHITECTURE.md
src/
  app/
    (auth)/             sign-in, sign-up
    (app)/              dashboard, dashboard/[metric], sleep, workouts, settings/sources
    api/                auth, health, ingest/[source], devices/pair, import/fit, metrics, analytics, stream
  components/           ui/ (shadcn), charts/, dashboard/, sources/
  hooks/                use-live-metrics, use-ble-heart-rate
  lib/                  env, db, crypto, keyring, errors, auth, validation/
  server/
    sources/            types.ts, registry.ts, mock/, ble/, connectiq/, fit/
    ingest/             normalize, upsert, rollups
    realtime/           bus.ts, pg-bus.ts
    analytics/          trends, baselines, hrv
worker/                 pg-boss consumers + cron
tests/                  unit/, integration/, e2e/
```

## 9. Milestones

1. ✅ Scaffold — Next.js, strict TS, Tailwind, shadcn, Prisma schema, Docker Postgres, env validation, crypto, Vitest
2. ✅ Auth (Better Auth email/password), first migration, app shell
3. ✅ Source abstraction, mock source, ingest pipeline, worker, SSE realtime
4. ✅ Dashboard — KPI tiles, charts, date filtering, trends
5. ✅ Web Bluetooth live heart rate
6. ✅ FIT import
7. ✅ Connect IQ watch app + device pairing (device-code flow) + ingest endpoint
8. ✅ Hardening — integration/e2e tests, security review, Docker/CI, deployment docs

## 10. External setup

| Needed for | What |
|---|---|
| All | PostgreSQL 17 (Docker Desktop, or Homebrew `postgresql@17`) |
| M5 | Chrome/Edge on the Mac; watch: *Heart rate widget → Broadcast Heart Rate* |
| M7 | Connect IQ SDK + VS Code Monkey C extension, developer key, OpenMTP (USB sideload on macOS), public HTTPS URL (Cloudflare Tunnel in dev) |
| Future | Garmin Health API partner approval (`GARMIN_HEALTH_API` adapter) |

## 11. Implementation notes (Milestones 1–4)

- **Timestamps:** every `DateTime` column is `timestamptz`, and the Prisma pg adapter runs with
  `-c timezone=UTC` (`src/lib/db.ts`). adapter-pg converts values using the *session* timezone, so without
  this a Postgres server in America/New_York shifts every instant by 4–5 h. Raw SQL binds instants as ISO
  strings (`src/server/ingest/ingest.ts`). Covered by `tests/integration/ingest.test.ts`.
- **Single write path:** `ingestBatch()` validates → upserts (idempotent, `unnest` bulk insert) →
  recomputes `DailySummary` for touched local dates → bumps `lastDataAt` (never backwards) → publishes.
- **Daily rollups:** calendar days in the user's timezone; sleep counts toward the day it ended;
  active minutes = 1-min buckets with ≥ 60 steps.
- **Source precedence:** series use the most precise connection with data in the window; daily
  summaries take each field from the highest-priority source that has it (`SOURCE_CATALOG.priority`).
- **Realtime:** one `LISTEN` connection per process (`PgRealtimeBus`), events routed by userId; clients
  invalidate TanStack Query caches (150 ms batching — not rAF, which stalls in background tabs).
- **Worker:** `pnpm worker` (pg-boss). Queues: `mock-backfill` (stately, per connection), `mock-tick`
  (cron every minute, singleton). Runs with `--conditions=react-server` so `server-only` imports resolve.
- **Mock data:** deterministic per (user, minute), so regenerating any range is idempotent.
- **Analytics:** 7-day rolling mean; baseline = mean ± SD of the 28 days *before* each day (≥ 7 values);
  anomaly = |z| > 2. For "today", cumulative KPIs (steps, calories, active minutes) show no delta.
- **Charts:** validated palette (dataviz reference: slot-1 blue, ordinal blue ramp for sleep stages,
  reserved status colors with labels); every chart has a Table view.

## 12. Implementation notes (Milestones 5–8)

- **Per-bucket source precedence:** series pick the most precise source *per time bucket*
  (`DISTINCT ON (t) … ORDER BY array_position(priority, connectionId)`), so 10 minutes of live BLE
  refine the chart without hiding the rest of the day.
- **BLE:** `useBleHeartRate` parses GATT 0x2A37 (`src/lib/ble/heart-rate.ts`, unit-tested with byte
  fixtures), reconnects with backoff, uploads every 10 s (1 s resolution), and keeps up to 1 h queued
  while offline.
- **FIT:** `@garmin/fitsdk` decoding; monitoring `timestamp16` is rebuilt from the last full timestamp;
  cumulative steps/active calories per activity type become deltas (first reading of a file is a
  baseline, so nothing double-counts); sleep epochs merge into stages; nested export zips are handled
  with size limits. Tests use FIT files produced by Garmin's own `Encoder`.
- **pg-boss v12** refuses to send to missing queues, so web and worker both call `ensureQueues()`.
- **Watch app:** `connectiq/` (Monkey C, API 3.2+). Not compiled here (no SDK); `pnpm simulate:watch`
  exercises the identical protocol end to end.
- **Hardening:** see `docs/SECURITY.md`; deployment in `docs/DEPLOYMENT.md`; demo in `docs/DEMO.md`.
