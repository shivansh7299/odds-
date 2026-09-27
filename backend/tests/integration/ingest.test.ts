import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ingestBatch, type IngestTarget } from "@/server/ingest/ingest";
import { createUser } from "./helpers";

async function mockTarget(timezone = "America/New_York"): Promise<IngestTarget> {
  const { user } = await createUser({ timezone });
  const conn = await db.sourceConnection.create({ data: { userId: user.id, source: "MOCK" } });
  return { id: conn.id, userId: user.id, source: "MOCK", timezone };
}

const at = (iso: string) => new Date(iso);

describe("ingestBatch", () => {
  it("stores instants exactly (no session-timezone shift)", async () => {
    const t = await mockTarget();
    const ts = at("2026-03-10T12:34:00.000Z");
    await ingestBatch(
      t,
      { samples: [{ type: "HEART_RATE", ts, value: 61, resolutionSec: 60 }] },
      { publish: false },
    );

    const row = await db.metricSample.findFirstOrThrow({ where: { connectionId: t.id } });
    expect(row.ts.toISOString()).toBe(ts.toISOString());
    const conn = await db.sourceConnection.findUniqueOrThrow({ where: { id: t.id } });
    expect(conn.lastDataAt?.toISOString()).toBe(ts.toISOString());
  });

  it("is idempotent and updates values on re-ingest", async () => {
    const t = await mockTarget();
    const ts = at("2026-03-10T12:00:00Z");
    const batch = (v: number) => ({
      samples: [{ type: "HEART_RATE" as const, ts, value: v, resolutionSec: 60 }],
    });
    await ingestBatch(t, batch(60), { publish: false });
    await ingestBatch(t, batch(64), { publish: false });

    const rows = await db.metricSample.findMany({ where: { connectionId: t.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe(64);
  });

  it("rejects physiologically impossible values", async () => {
    const t = await mockTarget();
    await expect(
      ingestBatch(t, { samples: [{ type: "HEART_RATE", ts: new Date(), value: 900, resolutionSec: 60 }] }),
    ).rejects.toThrow();
  });

  it("rolls samples up into the user's local calendar day", async () => {
    const t = await mockTarget("America/New_York");
    await ingestBatch(
      t,
      {
        samples: [
          // 23:30 local on Mar 9 (04:30Z Mar 10) → belongs to Mar 9
          { type: "STEPS", ts: at("2026-03-10T03:30:00Z"), value: 100, resolutionSec: 60 },
          // 00:30 local on Mar 10
          { type: "STEPS", ts: at("2026-03-10T05:30:00Z"), value: 40, resolutionSec: 60 },
          { type: "STEPS", ts: at("2026-03-10T05:31:00Z"), value: 70, resolutionSec: 60 },
          { type: "SPO2", ts: at("2026-03-10T06:00:00Z"), value: 95, resolutionSec: 900 },
          { type: "SPO2", ts: at("2026-03-10T06:15:00Z"), value: 97, resolutionSec: 900 },
        ],
      },
      { publish: false },
    );

    const days = await db.dailySummary.findMany({ where: { connectionId: t.id }, orderBy: { date: "asc" } });
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-03-09", "2026-03-10"]);
    expect(days[0]).toMatchObject({ steps: 100, activeMinutes: 1 });
    expect(days[1]).toMatchObject({ steps: 110, spo2Avg: 96, spo2Min: 95, activeMinutes: 1 });
  });

  it("attributes sleep to the day it ended and replaces stages on re-ingest", async () => {
    const t = await mockTarget("UTC");
    const sleep = (deepMinutes: number) => ({
      sleepSessions: [
        {
          externalId: "night-1",
          startAt: at("2026-03-09T23:00:00Z"),
          endAt: at("2026-03-10T07:00:00Z"),
          stages: [
            { stage: "AWAKE" as const, startAt: at("2026-03-09T23:00:00Z"), seconds: 600 },
            { stage: "DEEP" as const, startAt: at("2026-03-09T23:10:00Z"), seconds: deepMinutes * 60 },
          ],
        },
      ],
    });
    await ingestBatch(t, sleep(60), { publish: false });
    await ingestBatch(t, sleep(90), { publish: false });

    expect(await db.sleepSegment.count()).toBe(2);
    const day = await db.dailySummary.findFirstOrThrow({ where: { connectionId: t.id } });
    expect(day.date.toISOString().slice(0, 10)).toBe("2026-03-10");
    expect(day.sleepMinutes).toBe(90);
  });

  it("never moves lastDataAt backwards when importing older data", async () => {
    const t = await mockTarget();
    const recent = at("2026-03-10T12:00:00Z");
    await ingestBatch(
      t,
      { samples: [{ type: "HEART_RATE", ts: recent, value: 60, resolutionSec: 60 }] },
      { publish: false },
    );
    await ingestBatch(
      t,
      { samples: [{ type: "HEART_RATE", ts: at("2026-01-01T00:00:00Z"), value: 60, resolutionSec: 60 }] },
      { publish: false },
    );
    const conn = await db.sourceConnection.findUniqueOrThrow({ where: { id: t.id } });
    expect(conn.lastDataAt?.toISOString()).toBe(recent.toISOString());
  });
});
