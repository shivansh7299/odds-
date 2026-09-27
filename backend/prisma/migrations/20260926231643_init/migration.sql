-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('MOCK', 'GARMIN_BLE', 'GARMIN_CONNECTIQ', 'GARMIN_FIT', 'GARMIN_HEALTH_API');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'NEEDS_REAUTH', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "MetricType" AS ENUM ('HEART_RATE', 'RESTING_HEART_RATE', 'HRV_RMSSD', 'STEPS', 'CALORIES', 'SPO2');

-- CreateEnum
CREATE TYPE "SleepStage" AS ENUM ('AWAKE', 'LIGHT', 'DEEP', 'REM');

-- CreateEnum
CREATE TYPE "SyncTrigger" AS ENUM ('LIVE', 'INGEST', 'IMPORT', 'WEBHOOK', 'POLL', 'BACKFILL', 'MANUAL');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "status" "ConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "externalUserId" TEXT,
    "accessTokenEnc" BYTEA,
    "refreshTokenEnc" BYTEA,
    "encKeyVersion" INTEGER,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "lastSyncedAt" TIMESTAMP(3),
    "lastDataAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "tokenHash" TEXT,
    "tokenPrefix" TEXT,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingest_device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "metric_sample" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "type" "MetricType" NOT NULL,
    "ts" TIMESTAMPTZ(3) NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "resolutionSec" INTEGER NOT NULL,

    CONSTRAINT "metric_sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_summary" (
    "connectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "userId" TEXT NOT NULL,
    "steps" INTEGER,
    "calories" INTEGER,
    "restingHr" INTEGER,
    "hrvRmssd" DOUBLE PRECISION,
    "spo2Avg" DOUBLE PRECISION,
    "spo2Min" DOUBLE PRECISION,
    "activeMinutes" INTEGER,
    "sleepMinutes" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_summary_pkey" PRIMARY KEY ("connectionId","date")
);

-- CreateTable
CREATE TABLE "sleep_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "score" INTEGER,
    "isMainSleep" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "sleep_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sleep_segment" (
    "id" BIGSERIAL NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stage" "SleepStage" NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "seconds" INTEGER NOT NULL,

    CONSTRAINT "sleep_segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "activityType" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "calories" INTEGER,
    "avgHr" INTEGER,
    "maxHr" INTEGER,
    "distanceM" DOUBLE PRECISION,
    "steps" INTEGER,

    CONSTRAINT "workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_run" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "recordsUpserted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_state" (
    "state" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "SourceType" NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_state_pkey" PRIMARY KEY ("state")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "source_connection_userId_source_key" ON "source_connection"("userId", "source");

-- CreateIndex
CREATE UNIQUE INDEX "source_connection_source_externalUserId_key" ON "source_connection"("source", "externalUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_device_tokenHash_key" ON "ingest_device"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_device_pairingCodeHash_key" ON "ingest_device"("pairingCodeHash");

-- CreateIndex
CREATE INDEX "ingest_device_userId_idx" ON "ingest_device"("userId");

-- CreateIndex
CREATE INDEX "metric_sample_userId_type_ts_idx" ON "metric_sample"("userId", "type", "ts" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "metric_sample_connectionId_type_ts_resolutionSec_key" ON "metric_sample"("connectionId", "type", "ts", "resolutionSec");

-- CreateIndex
CREATE INDEX "daily_summary_userId_date_idx" ON "daily_summary"("userId", "date");

-- CreateIndex
CREATE INDEX "sleep_session_userId_startAt_idx" ON "sleep_session"("userId", "startAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sleep_session_connectionId_externalId_key" ON "sleep_session"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "sleep_segment_sessionId_startAt_idx" ON "sleep_segment"("sessionId", "startAt");

-- CreateIndex
CREATE INDEX "workout_userId_startAt_idx" ON "workout"("userId", "startAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "workout_connectionId_externalId_key" ON "workout"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "import_job_userId_createdAt_idx" ON "import_job"("userId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "import_job_userId_sha256_key" ON "import_job"("userId", "sha256");

-- CreateIndex
CREATE INDEX "sync_run_connectionId_startedAt_idx" ON "sync_run"("connectionId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_dedupeKey_key" ON "webhook_event"("dedupeKey");

-- CreateIndex
CREATE INDEX "oauth_state_expiresAt_idx" ON "oauth_state"("expiresAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_connection" ADD CONSTRAINT "source_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_device" ADD CONSTRAINT "ingest_device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_device" ADD CONSTRAINT "ingest_device_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "metric_sample" ADD CONSTRAINT "metric_sample_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_summary" ADD CONSTRAINT "daily_summary_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_session" ADD CONSTRAINT "sleep_session_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sleep_segment" ADD CONSTRAINT "sleep_segment_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sleep_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workout" ADD CONSTRAINT "workout_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "source_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
