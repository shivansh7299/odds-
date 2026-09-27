import "server-only";
import { db } from "@/lib/db";
import { log } from "@/lib/log";
import { AppError } from "@/lib/errors";
import { getBoss } from "@/server/jobs/boss";
import { QUEUES, type MockBackfillJob } from "@/server/jobs/queues";
import { ingestBatch, withSyncRun, type IngestTarget } from "@/server/ingest/ingest";
import { realtimeBus } from "@/server/realtime/pg-bus";
import type { RealtimeEvent } from "@/server/realtime/events";
import { METRIC_TYPES } from "@/lib/metrics/definitions";
import { generateRange, profileFor } from "@/server/sources/mock/generator";
import { SOURCES } from "@/server/sources/registry";

const DAY = 86_400_000;
const BACKFILL_DAYS = 30;
/** A tick never regenerates more than this; longer gaps are simply skipped. */
const MAX_TICK_GAP = DAY;

export async function enableMock(userId: string) {
  if (!SOURCES.MOCK.isAvailable()) {
    throw new AppError(403, "source_unavailable", "Simulated data is disabled on this server");
  }
  const conn = await db.sourceConnection.upsert({
    where: { userId_source: { userId, source: "MOCK" } },
    create: { userId, source: "MOCK", status: "ACTIVE" },
    update: { status: "ACTIVE", lastError: null },
  });
  if (!conn.lastDataAt) {
    const boss = await getBoss();
    await boss.send(QUEUES.mockBackfill, { connectionId: conn.id } satisfies MockBackfillJob, {
      singletonKey: conn.id,
      retryLimit: 2,
      retryBackoff: true,
    });
  }
  await realtimeBus.publish(userId, { kind: "source", source: "MOCK" });
  return conn;
}

async function loadTarget(connectionId: string): Promise<IngestTarget | null> {
  const conn = await db.sourceConnection.findUnique({
    where: { id: connectionId },
    include: { user: { select: { timezone: true } } },
  });
  if (!conn || conn.source !== "MOCK") return null;
  return { id: conn.id, userId: conn.userId, source: conn.source, timezone: conn.user.timezone };
}

/** Worker: fill history, one day at a time, reporting progress over the realtime bus. */
export async function runMockBackfill({ connectionId, days = BACKFILL_DAYS }: MockBackfillJob) {
  const target = await loadTarget(connectionId);
  if (!target) return; // disconnected meanwhile

  const profile = profileFor(target.userId);
  const end = new Date(Math.floor(Date.now() / 60_000) * 60_000);
  const start = new Date(end.getTime() - days * DAY);

  await withSyncRun(connectionId, "BACKFILL", async () => {
    let records = 0;
    for (let i = 0; i < days; i++) {
      const from = new Date(start.getTime() + i * DAY);
      const to = i === days - 1 ? end : new Date(from.getTime() + DAY);
      const r = await ingestBatch(target, generateRange(profile, target.timezone, from, to), {
        publish: false,
      });
      records += r.samples + r.sleepSessions + r.workouts;
      await realtimeBus.publish(target.userId, {
        kind: "sync",
        source: "MOCK",
        status: "RUNNING",
        progress: (i + 1) / days,
        message: `Generated day ${i + 1} of ${days}`,
      });
    }
    return { records };
  });

  const events: RealtimeEvent[] = [
    { kind: "sync", source: "MOCK", status: "SUCCEEDED" },
    {
      kind: "metrics",
      source: "MOCK",
      types: METRIC_TYPES,
      from: start.toISOString(),
      to: end.toISOString(),
    },
    { kind: "sleep", source: "MOCK" },
    { kind: "workouts", source: "MOCK" },
  ];
  for (const event of events) await realtimeBus.publish(target.userId, event);
}

/** Worker cron (every minute): extend each active simulated source up to now. */
export async function runMockTick() {
  const conns = await db.sourceConnection.findMany({
    where: { source: "MOCK", status: "ACTIVE", lastDataAt: { not: null } },
    include: { user: { select: { timezone: true } } },
  });
  const now = Date.now();
  for (const conn of conns) {
    const target = { id: conn.id, userId: conn.userId, source: conn.source, timezone: conn.user.timezone };
    const from = new Date(Math.max(conn.lastDataAt!.getTime() + 1, now - MAX_TICK_GAP));
    const to = new Date(now);
    try {
      await ingestBatch(target, generateRange(profileFor(conn.userId), target.timezone, from, to));
    } catch (err) {
      log.error("mock tick failed", { connectionId: conn.id, err });
      await db.sourceConnection.update({
        where: { id: conn.id },
        data: { lastError: err instanceof Error ? err.message.slice(0, 500) : "tick failed" },
      });
    }
  }
  return conns.length;
}
