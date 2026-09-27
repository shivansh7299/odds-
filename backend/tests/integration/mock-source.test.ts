import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runMockBackfill, runMockTick } from "@/server/sources/mock/service";
import { createUser } from "./helpers";

describe("mock source", () => {
  it("backfills history, records a sync run, and ticks forward idempotently", async () => {
    const { user } = await createUser({ timezone: "Europe/Berlin" });
    const conn = await db.sourceConnection.create({ data: { userId: user.id, source: "MOCK" } });

    await runMockBackfill({ connectionId: conn.id, days: 3 });
    const run = await db.syncRun.findFirstOrThrow({ where: { connectionId: conn.id } });
    expect(run).toMatchObject({ status: "SUCCEEDED", trigger: "BACKFILL" });
    expect(run.recordsUpserted).toBeGreaterThan(4000);
    expect(await db.dailySummary.count({ where: { connectionId: conn.id } })).toBeGreaterThanOrEqual(3);

    const before = await db.metricSample.count({ where: { connectionId: conn.id } });
    await runMockTick();
    await runMockTick();
    const after = await db.metricSample.count({ where: { connectionId: conn.id } });
    expect(after - before).toBeLessThan(10); // only the last minute or so, never duplicates

    const fresh = await db.sourceConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(Date.now() - fresh.lastDataAt!.getTime()).toBeLessThan(2 * 60_000);
  });

  it("does not tick paused sources", async () => {
    const { user } = await createUser();
    const conn = await db.sourceConnection.create({
      data: {
        userId: user.id,
        source: "MOCK",
        status: "PAUSED",
        lastDataAt: new Date(Date.now() - 3_600_000),
      },
    });
    await runMockTick();
    expect(await db.metricSample.count({ where: { connectionId: conn.id } })).toBe(0);
  });
});
