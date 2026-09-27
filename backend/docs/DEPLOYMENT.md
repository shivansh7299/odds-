# Deploying VitalSync

VitalSync needs three long-running pieces: the **web** app (Next.js, holds SSE connections), the
**worker** (pg-boss jobs and cron), and **PostgreSQL**. Web and worker also share a small
**uploads volume** for FIT imports. Hosts with long-lived Node processes fit best (Railway, Fly.io,
Render, a VM with Docker). Serverless hosts like Vercel would need Pusher/Ably for realtime and
a separately hosted worker.

## Environment variables

| Variable | Web | Worker | Notes |
|---|---|---|---|
| `DATABASE_URL` | ✓ | ✓ | Managed Postgres 15+ (17 recommended) |
| `BETTER_AUTH_URL` | ✓ | ✓ | Public `https://` URL. Also a **build arg** (bakes HSTS into headers) |
| `BETTER_AUTH_SECRET` | ✓ | ✓ | `openssl rand -base64 32` |
| `TOKEN_ENC_KEY` / `TOKEN_ENC_KEY_VERSION` | ✓ | ✓ | `openssl rand -base64 32` / `1` |
| `ENABLE_MOCK_SOURCE` | ✓ | ✓ | `true` for demos, `false` for real use |
| `UPLOAD_DIR` | ✓ | ✓ | Same shared volume path on both (image default `/data/uploads`) |

## Option A: Railway (recommended for the class demo)

1. Push the repo to GitHub. CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit,
   integration and e2e tests on every push.
2. In Railway: **New Project → Deploy PostgreSQL**.
3. **New → GitHub Repo → VitalSync** for the **web** service:
   - Builder: Dockerfile. Build arg `BETTER_AUTH_URL` = the service's public URL.
   - Variables: the table above, with `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
   - Pre-deploy command: `node_modules/.bin/prisma migrate deploy`
   - Health check path: `/api/health`
   - Attach a volume at `/data/uploads`.
   - Generate a domain (Settings → Networking). HTTPS is automatic.
4. Add a second service from the same repo for the **worker**:
   - Start command: `node_modules/.bin/tsx --conditions=react-server worker/index.ts`
   - Same variables. Attach the **same** volume at `/data/uploads`. If the platform can't share
     volumes, run web and worker in one service with `pnpm start:all`.
5. Open the domain, sign up, and check **Sources**.

## Option B: any Docker host

```bash
cp .env.example .env.production   # fill in secrets; DATABASE_URL is set by compose
```

```bash
POSTGRES_PASSWORD=change-me BETTER_AUTH_URL=https://vitalsync.example.com docker compose -f docker-compose.prod.yml up -d --build
```

This starts Postgres, runs migrations once, then starts web on :3000 and the worker. Put a
TLS-terminating reverse proxy (Caddy, Traefik, nginx) in front of port 3000, and make sure it
doesn't buffer `text/event-stream` responses (the app sends `X-Accel-Buffering: no`).

## Pointing the watch at production

In Garmin Connect on the iPhone: VitalSync app settings → **Server URL** = your production
`https://` domain. Pair again from the watch (tokens are per server).

## Operations

- **Health:** `GET /api/health` returns `{"status":"ok","db":"ok"}` (503 if the database is down).
- **Logs:** JSON lines in production (`level`, `msg`, `err`, timings). Health values and tokens are
  never logged.
- **Backups:** enable your provider's automated Postgres backups (daily, 7+ days retention).
- **Housekeeping:** the worker runs `maintenance` hourly (expired pairing codes, stuck imports,
  orphaned upload files) and pg-boss archives its own completed jobs.
- **Scaling web replicas:** realtime already works across instances (Postgres `LISTEN/NOTIFY`).
  The in-memory rate limiters are per instance, so move them to Postgres/Redis before running
  many replicas.
- **Key rotation:** set `TOKEN_ENC_KEY_PREVIOUS` to the old key, a new `TOKEN_ENC_KEY`, and bump
  `TOKEN_ENC_KEY_VERSION`.

## Not verified in this environment

The Dockerfile, compose file and CI workflow were written for this project but not executed
here, because this machine has no Docker and the repo isn't on GitHub yet. The same commands
(`pnpm build`, the worker, `prisma migrate deploy`, the full test suite) all pass locally.
