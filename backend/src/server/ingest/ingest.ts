import "server-only";
import type { SourceType, SyncTrigger } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { touchedDates } from "@/server/ingest/local-dates";
import { recomputeDailySummaries } from "@/server/ingest/rollups";
import { realtimeBus } from "@/server/realtime/pg-bus";
import { normalizedBatchSchema, type NormalizedBatch } from "@/server/sources/types";

const CHUNK = 5_000;

export type IngestTarget = { id: string; userId: string; source: SourceType; timezone: string };

export type IngestResult = { samples: number; sleepSessions: number; workouts: number; dates: string[] };

// Raw SQL note: always bind instants as ISO-8601 strings. node-postgres serializes a JS Date
// without an offset, which Postgres would read in the session's timezone.

/**
 * The single write path for health data from every source:
 * validate → idempotent upsert → daily rollups → connection freshness → realtime event.
 */
export async function ingestBatch(
  target: IngestTarget,
  input: NormalizedBatch,
  opts: { publish?: boolean } = {},
): Promise<IngestResult> {
  const batch = normalizedBatchSchema.parse(input);
  const { samples, sleepSessions, workouts } = batch;

  for (let i = 0; i < samples.length; i += CHUNK) {
    const chunk = samples.slice(i, i + CHUNK);
    await db.$executeRaw`
      INSERT INTO metric_sample ("userId", "connectionId", type, ts, value, "resolutionSec")
      SELECT ${target.userId}, ${target.id}, t.type::"MetricType", t.ts, t.value, t.res
      FROM unnest(
        ${chunk.map((s) => s.type)}::text[],
        ${chunk.map((s) => s.ts.toISOString())}::timestamptz[],
        ${chunk.map((s) => s.value)}::float8[],
        ${chunk.map((s) => s.resolutionSec)}::int[]
      ) AS t(type, ts, value, res)
      ON CONFLICT ("connectionId", type, ts, "resolutionSec") DO UPDATE SET value = EXCLUDED.value`;
  }

  for (const s of sleepSessions) {
    await db.$transaction(async (tx) => {
      const session = await tx.sleepSession.upsert({
        where: { connectionId_externalId: { connectionId: target.id, externalId: s.externalId } },
        create: {
          userId: target.userId,
          connectionId: target.id,
          externalId: s.externalId,
          startAt: s.startAt,
          endAt: s.endAt,
          score: s.score,
          isMainSleep: s.isMainSleep,
        },
        update: { startAt: s.startAt, endAt: s.endAt, score: s.score ?? null, isMainSleep: s.isMainSleep },
      });
      await tx.sleepSegment.deleteMany({ where: { sessionId: session.id } });
      await tx.sleepSegment.createMany({
        data: s.stages.map((st) => ({ sessionId: session.id, ...st })),
      });
    });
  }

  for (const w of workouts) {
    const data = { ...w, userId: target.userId, connectionId: target.id };
    await db.workout.upsert({
      where: { connectionId_externalId: { connectionId: target.id, externalId: w.externalId } },
      create: data,
      update: data,
    });
  }

  const instants = [
    ...samples.map((s) => s.ts),
    ...sleepSessions.map((s) => s.endAt),
    ...workouts.map((w) => w.startAt),
  ];
  const dates = touchedDates(instants, target.timezone);
  await recomputeDailySummaries(target, dates);

  const newest = instants.reduce<Date | null>((max, t) => (!max || t > max ? t : max), null);
  // GREATEST ignores NULLs, and never moves lastDataAt backwards (e.g. importing old history).
  await db.$executeRaw`
    UPDATE source_connection
    SET "lastSyncedAt" = now(), "lastError" = NULL,
        "lastDataAt" = GREATEST("lastDataAt", ${newest?.toISOString() ?? null}::timestamptz)
    WHERE id = ${target.id}`;

  if (opts.publish !== false) await publishBatchEvents(target, batch);

  return { samples: samples.length, sleepSessions: sleepSessions.length, workouts: workouts.length, dates };
}

async function publishBatchEvents(
  target: IngestTarget,
  batch: ReturnType<typeof normalizedBatchSchema.parse>,
) {
  const { samples } = batch;
  if (samples.length) {
    let from = samples[0]!.ts;
    let to = from;
    const types = new Set<(typeof samples)[number]["type"]>();
    for (const s of samples) {
      if (s.ts < from) from = s.ts;
      if (s.ts > to) to = s.ts;
      types.add(s.type);
    }
    await realtimeBus.publish(target.userId, {
      kind: "metrics",
      source: target.source,
      types: [...types],
      from: from.toISOString(),
      to: to.toISOString(),
    });
  }
  if (batch.sleepSessions.length)
    await realtimeBus.publish(target.userId, { kind: "sleep", source: target.source });
  if (batch.workouts.length)
    await realtimeBus.publish(target.userId, { kind: "workouts", source: target.source });
}

/** Records a SyncRun around `fn`, marking it SUCCEEDED/FAILED. */
export async function withSyncRun<T extends { records: number }>(
  connectionId: string,
  trigger: SyncTrigger,
  fn: () => Promise<T>,
): Promise<T> {
  const run = await db.syncRun.create({ data: { connectionId, trigger, status: "RUNNING" } });
  try {
    const result = await fn();
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", finishedAt: new Date(), recordsUpserted: result.records },
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.syncRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: message.slice(0, 1_000) },
    });
    await db.sourceConnection.update({
      where: { id: connectionId },
      data: { lastError: message.slice(0, 500) },
    });
    throw err;
  }
}
