# VitalSync (backend)

> Part of the `odds-` repo: this is the server behind the Pulse Check site in `../pulsecheck/`. It
> collects data from a Garmin Forerunner 265 (Connect IQ watch app, Bluetooth broadcast, FIT import)
> into PostgreSQL and serves it to the site through a read-only API (see the end of this file).
> The site itself is static and unchanged; `pulsecheck/vitalsync.js` connects the two.

Near-real-time health analytics for a Garmin wearable: heart rate, HRV, steps, calories, SpO₂, sleep and workouts, stored in PostgreSQL and streamed to a live dashboard.

Stack: Next.js 16 (App Router) · TypeScript (strict) · PostgreSQL · Prisma 7 · Tailwind CSS 4 · shadcn/ui · Better Auth · Zod · Vitest.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and milestone plan.

## Getting started

Requirements: Node 22+, pnpm 10, and PostgreSQL 17 (Homebrew or Docker).

```bash
pnpm install
cp .env.example .env   # then fill in the secrets (see below)
```

Generate secrets:

```bash
openssl rand -base64 32   # use once for BETTER_AUTH_SECRET, once for TOKEN_ENC_KEY
```

Start PostgreSQL, either with Docker:

```bash
pnpm db:up
```

or with Homebrew (what this project's dev machine uses):

```bash
brew install postgresql@17 && brew services start postgresql@17
```

```bash
psql -d postgres -c "CREATE ROLE vitalsync LOGIN PASSWORD 'vitalsync' CREATEDB" -c "CREATE DATABASE vitalsync OWNER vitalsync" -c "CREATE DATABASE vitalsync_test OWNER vitalsync"
```

Apply migrations and run the web app **and** the background worker:

```bash
pnpm db:migrate
pnpm dev:all
```

Open http://localhost:3000, create an account, then go to **Sources → Enable simulated data** to fill
30 days of history; new data then arrives every minute over the live stream.

`GET /api/health` reports whether the database is reachable.

## Scripts

| Script | What it does |
|---|---|
| `pnpm dev` | Next.js dev server |
| `pnpm worker` | Background worker (jobs + minute tick) |
| `pnpm dev:all` | Web app and worker together |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm typecheck` | Generate route types and run `tsc` |
| `pnpm lint` / `pnpm format` | ESLint / Prettier |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:integration` | Integration tests against the `vitalsync_test` database |
| `pnpm test:e2e` | Playwright end-to-end tests (desktop + mobile) against a running app |
| `pnpm start:all` | Production web + worker (after `pnpm build`) |
| `pnpm simulate:watch` | Virtual Connect IQ watch: pairs and streams data (no watch or SDK needed) |
| `pnpm db:migrate` | Create/apply a development migration |
| `pnpm db:deploy` | Apply migrations in production |
| `pnpm db:studio` | Prisma Studio |

## Environment variables

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `BETTER_AUTH_SECRET` | Session signing secret (≥32 chars) |
| `BETTER_AUTH_URL` | Public base URL of the app |
| `TOKEN_ENC_KEY` / `TOKEN_ENC_KEY_VERSION` | AES-256-GCM key (32 bytes base64) for tokens at rest |
| `TOKEN_ENC_KEY_PREVIOUS` | Previous key, only while rotating |
| `ENABLE_MOCK_SOURCE` | Enables the simulated data source for development |
| `UPLOAD_DIR` | Temporary storage for uploads (shared by web and worker; default `.uploads`) |

Env is validated with Zod on first use (`src/lib/env.ts`); a missing or malformed value fails fast with a clear message.

## API

All routes require a session cookie and only return the caller's data. Range parameters are
`range=today|7d|30d|90d` or `range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` (in the user's timezone).

| Route | Purpose |
|---|---|
| `GET /api/overview` | KPI tiles with comparison to the previous period |
| `GET /api/metrics?type=HEART_RATE` | Bucketed series (`bucket` optional: 60, 300, 900, 3600, 86400) |
| `GET /api/summary` | One row per day |
| `GET /api/analytics/trends?field=restingHr` | Daily values + 7-day mean + 28-day baseline + anomalies |
| `GET /api/sleep?date=YYYY-MM-DD` | One night with stages |
| `GET /api/workouts` | Paginated workouts (`limit`, `cursor`) |
| `GET /api/sources` · `POST/PATCH/DELETE /api/sources/mock` | Sources and the simulated source |
| `GET /api/stream` | Server-Sent Events for live updates |
| `POST /api/ingest/ble` | Live heart rate batches from the browser (Web Bluetooth) |
| `GET/POST /api/import/fit` | Import history / upload `.fit` or `.zip` |
| `POST /api/devices/pair/{start,poll}` | Watch pairing (no session; rate-limited) |
| `POST /api/devices/pair/approve` · `GET /api/devices` · `DELETE /api/devices/:id` | Approve, list, revoke watches |
| `POST /api/ingest/connectiq` | Watch data (`Authorization: Bearer vs_…`) |
| `PATCH /api/account` · `GET /api/account/export` | Timezone (rebuilds summaries) · full JSON export |

## Data sources

| Source | How | Docs |
|---|---|---|
| Live heart rate | Watch *Broadcast Heart Rate* → **Live** page in desktop Chrome/Edge | `docs/DEMO.md` |
| FIT import | **Sources → Import files** (`.fit` or Garmin Connect export `.zip`) | Import page |
| Connect IQ app | Sideload `connectiq/`, pair with a code | `connectiq/README.md` |
| Simulated | **Sources → Enable simulated data** (`ENABLE_MOCK_SOURCE=true`) | |

More: [Deployment](docs/DEPLOYMENT.md) · [Demo script](docs/DEMO.md) · [Security review](docs/SECURITY.md)

## Read-only API for other apps (Pulse Check)

Other apps, like the Pulse Check site in this repo's `pulsecheck/` folder, read your data with a
personal API key instead of your password.

1. VitalSync → **Settings → API keys for other apps** → **Create key**. Copy it; it's shown once.
2. Allow the app's site in `.env` (browser origins, comma-separated):
   `VITALSYNC_CORS_ORIGINS="http://localhost:8000,https://shivansh7299.github.io"`
3. In the other app, enter your VitalSync address (e.g. the ngrok `https://` URL) and the key.

| Route (`Authorization: Bearer vsk_…`) | Returns |
|---|---|
| `GET /api/v1/me` | name, timezone, connected sources (connection test) |
| `GET /api/v1/export?days=60&hrDays=14` | `daily[]` (`date`, `restingHeartRate`, `hrvRmssd`, `steps`, `sleepHours`, `sleepScore`, `spo2`) and `heartRate[]` (`timestamp` in local time with offset, 5-min average `heartRate`) |
| `GET /api/v1/live` | latest heart rate (≤ 10 min old): `{ bpm, ts, ageSec, source }` or `null` |

Keys are read-only, rate-limited (120/min), stored only as SHA-256 hashes, and revocable instantly.
Responses carry CORS headers only for the configured origins; cookies are never accepted cross-origin.
