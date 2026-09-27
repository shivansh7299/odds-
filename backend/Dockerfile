# syntax=docker/dockerfile:1
# One image, three roles: web (default CMD), worker, and one-off migrations (see docker-compose.prod.yml).
# Build:  docker build --build-arg BETTER_AUTH_URL=https://vitalsync.example.com -t vitalsync .

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
RUN corepack enable
WORKDIR /app
# Placeholders so build-time imports can validate env; real values come at runtime.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    BETTER_AUTH_SECRET="build-time-placeholder-secret-not-used-at-runtime" \
    TOKEN_ENC_KEY="AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" \
    NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Baked into security headers (HSTS/upgrade-insecure-requests only for https URLs).
ARG BETTER_AUTH_URL=http://localhost:3000
ENV BETTER_AUTH_URL=${BETTER_AUTH_URL}
COPY . .
# Dev dependencies stay: the worker runs through tsx and migrations use the Prisma CLI.
RUN pnpm prisma generate && pnpm build

FROM node:${NODE_VERSION}-alpine AS runner
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 UPLOAD_DIR=/data/uploads
COPY --from=build --chown=app:app /app ./
RUN mkdir -p /data/uploads && chown -R app:app /data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Binaries are called directly (no pnpm/corepack download at runtime).
CMD ["node_modules/.bin/next", "start"]
