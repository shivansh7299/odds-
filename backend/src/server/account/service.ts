import "server-only";
import type { SourceType } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { recomputeDailySummaries } from "@/server/ingest/rollups";
import { realtimeBus } from "@/server/realtime/pg-bus";

/** Disconnect a source and delete everything it stored (cascades through all data tables). */
export async function removeSource(userId: string, source: SourceType) {
  const { count } = await db.sourceConnection.deleteMany({ where: { userId, source } });
  if (count === 0) throw new AppError(404, "not_found", "That source isn't connected");
  await realtimeBus.publish(userId, { kind: "source", source });
}

export async function setSourcePaused(userId: string, source: SourceType, paused: boolean) {
  const { count } = await db.sourceConnection.updateMany({
    where: { userId, source },
    data: { status: paused ? "PAUSED" : "ACTIVE" },
  });
  if (count === 0) throw new AppError(404, "not_found", "That source isn't connected");
  await realtimeBus.publish(userId, { kind: "source", source });
}

/**
 * Daily summaries are bucketed by the user's local calendar day, so a timezone
 * change rebuilds them for every date that has data.
 */
export async function changeTimezone(userId: string, timezone: string) {
  await db.user.update({ where: { id: userId }, data: { timezone } });
  const conns = await db.sourceConnection.findMany({ where: { userId }, select: { id: true } });
  for (const c of conns) {
    const dates = await db.$queryRaw<{ d: string }[]>`
      SELECT DISTINCT to_char((ts AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD') AS d
      FROM metric_sample WHERE "connectionId" = ${c.id}
      UNION
      SELECT DISTINCT to_char(("endAt" AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD')
      FROM sleep_session WHERE "connectionId" = ${c.id}`;
    await db.dailySummary.deleteMany({ where: { connectionId: c.id } });
    const all = dates.map((r) => r.d).sort();
    for (let i = 0; i < all.length; i += 400) {
      await recomputeDailySummaries({ id: c.id, userId, timezone }, all.slice(i, i + 400));
    }
  }
  await realtimeBus.publish(userId, { kind: "source", source: "MOCK" }); // refresh every view
}

/**
 * Full data export as a JSON document, streamed so large histories don't need to
 * fit in memory. Tokens and password hashes are never included.
 */
export function exportStream(userId: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const write = (s: string) => controller.enqueue(enc.encode(s));
      try {
        const user = await db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { id: true, name: true, email: true, timezone: true, createdAt: true },
        });
        const connections = await db.sourceConnection.findMany({
          where: { userId },
          select: { id: true, source: true, status: true, createdAt: true, lastDataAt: true },
        });
        write(`{"exportedAt":${JSON.stringify(new Date())},"user":${JSON.stringify(user)}`);
        write(`,"sources":${JSON.stringify(connections)}`);
        write(
          `,"dailySummaries":${JSON.stringify(await db.dailySummary.findMany({ where: { userId }, orderBy: { date: "asc" }, omit: { userId: true } }))}`,
        );
        write(
          `,"sleepSessions":${JSON.stringify(
            await db.sleepSession.findMany({
              where: { userId },
              orderBy: { startAt: "asc" },
              omit: { userId: true },
              include: { stages: { select: { stage: true, startAt: true, seconds: true } } },
            }),
          )}`,
        );
        write(
          `,"workouts":${JSON.stringify(await db.workout.findMany({ where: { userId }, orderBy: { startAt: "asc" }, omit: { userId: true } }))}`,
        );

        write(`,"samples":[`);
        let cursor: bigint | undefined;
        let first = true;
        for (;;) {
          const page = await db.metricSample.findMany({
            where: { userId, ...(cursor && { id: { gt: cursor } }) },
            orderBy: { id: "asc" },
            take: 5_000,
            select: { id: true, connectionId: true, type: true, ts: true, value: true, resolutionSec: true },
          });
          if (page.length === 0) break;
          for (const s of page) {
            write(`${first ? "" : ","}${JSON.stringify({ ...s, id: undefined })}`);
            first = false;
          }
          cursor = page.at(-1)!.id;
        }
        write("]}");
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
