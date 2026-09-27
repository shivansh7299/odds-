import { describe, expect, it } from "vitest";
import { GET as getMetrics } from "@/app/api/metrics/route";
import { GET as getOverview } from "@/app/api/overview/route";
import { GET as getSummary } from "@/app/api/summary/route";
import { GET as getTrends } from "@/app/api/analytics/trends/route";
import { GET as getSleep } from "@/app/api/sleep/route";
import { GET as getWorkouts } from "@/app/api/workouts/route";
import { GET as getStream } from "@/app/api/stream/route";
import { db } from "@/lib/db";
import { ingestBatch } from "@/server/ingest/ingest";
import { generateRange, profileFor } from "@/server/sources/mock/generator";
import { authedRequest, createUser } from "./helpers";

const DAY = 86_400_000;

async function userWithMockData(days = 10) {
  const u = await createUser({ timezone: "America/New_York" });
  const conn = await db.sourceConnection.create({ data: { userId: u.user.id, source: "MOCK" } });
  const to = new Date();
  const from = new Date(to.getTime() - days * DAY);
  const target = { id: conn.id, userId: u.user.id, source: "MOCK" as const, timezone: "America/New_York" };
  await ingestBatch(target, generateRange(profileFor(u.user.id), target.timezone, from, to), {
    publish: false,
  });
  return { ...u, conn, target };
}

const json = async (res: Response) => ({ status: res.status, body: await res.json() });

describe("dashboard APIs", () => {
  it("require authentication", async () => {
    for (const handler of [
      getMetrics,
      getOverview,
      getSummary,
      getTrends,
      getSleep,
      getWorkouts,
      getStream,
    ]) {
      const res = await handler(new Request("http://localhost:3000/api/x?type=HEART_RATE&field=steps"));
      expect(res.status).toBe(401);
    }
  });

  it("return bucketed series, summaries, trends, sleep and workouts for the owner", async () => {
    const { headers } = await userWithMockData();

    const metrics = await json(
      await getMetrics(authedRequest("/api/metrics?type=HEART_RATE&range=7d", headers)),
    );
    expect(metrics.status).toBe(200);
    expect(metrics.body.bucketSec).toBe(900);
    expect(metrics.body.source).toBe("MOCK");
    expect(metrics.body.points.length).toBeGreaterThan(500);

    const steps = await json(
      await getMetrics(authedRequest("/api/metrics?type=STEPS&range=today&bucket=3600", headers)),
    );
    expect(steps.body.points.every((p: { v: number }) => p.v >= 0)).toBe(true);

    const summary = await json(await getSummary(authedRequest("/api/summary?range=7d", headers)));
    expect(summary.body.days).toHaveLength(7);
    expect(summary.body.days.some((d: { steps: number | null }) => d.steps && d.steps > 1000)).toBe(true);

    const overview = await json(await getOverview(authedRequest("/api/overview?range=7d", headers)));
    expect(overview.body.heartRate.value).toBeGreaterThan(30);
    expect(overview.body.restingHr.value).toBeGreaterThan(40);

    const trend = await json(
      await getTrends(authedRequest("/api/analytics/trends?field=restingHr&range=7d", headers)),
    );
    expect(trend.body.points).toHaveLength(7);

    const sleep = await json(await getSleep(authedRequest("/api/sleep", headers)));
    expect(sleep.body.night.asleepMinutes).toBeGreaterThan(300);

    const workouts = await json(await getWorkouts(authedRequest("/api/workouts?range=30d&limit=2", headers)));
    expect(workouts.body.workouts.length).toBeLessThanOrEqual(2);
  });

  it("never leaks another user's data", async () => {
    await userWithMockData(3);
    const other = await createUser();

    const metrics = await json(
      await getMetrics(authedRequest("/api/metrics?type=HEART_RATE&range=7d", other.headers)),
    );
    expect(metrics.body.points).toEqual([]);
    const summary = await json(await getSummary(authedRequest("/api/summary?range=7d", other.headers)));
    expect(summary.body.days.every((d: { steps: number | null }) => d.steps === null)).toBe(true);
    const sleep = await json(await getSleep(authedRequest("/api/sleep", other.headers)));
    expect(sleep.body.night).toBeNull();
    const workouts = await json(await getWorkouts(authedRequest("/api/workouts?range=30d", other.headers)));
    expect(workouts.body.workouts).toEqual([]);
  });

  it("prefers the more precise source per bucket, keeping other buckets", async () => {
    const { user, headers, target } = await userWithMockData(1);
    const fit = await db.sourceConnection.create({ data: { userId: user.id, source: "GARMIN_FIT" } });
    const ts = new Date(Math.floor((Date.now() - 3_600_000) / 60_000) * 60_000);
    await ingestBatch(
      { ...target, id: fit.id, source: "GARMIN_FIT" },
      { samples: [{ type: "HEART_RATE", ts, value: 123, resolutionSec: 60 }] },
      { publish: false },
    );
    const res = await json(
      await getMetrics(authedRequest("/api/metrics?type=HEART_RATE&range=today&bucket=60", headers)),
    );
    type P = { t: string; v: number; source: string };
    const overlap = res.body.points.find((p: P) => p.t === ts.toISOString());
    expect(overlap).toMatchObject({ v: 123, source: "GARMIN_FIT" });
    expect(res.body.points.filter((p: P) => p.source === "MOCK").length).toBeGreaterThan(10);
    expect(res.body.source).toBe("GARMIN_FIT");
    expect(new Set(res.body.points.map((p: P) => p.t)).size).toBe(res.body.points.length); // one row per bucket
  });

  it("validates query parameters", async () => {
    const { headers } = await createUser();
    expect((await getMetrics(authedRequest("/api/metrics?type=NOPE", headers))).status).toBe(400);
    expect((await getMetrics(authedRequest("/api/metrics?type=STEPS&bucket=7", headers))).status).toBe(400);
    expect((await getTrends(authedRequest("/api/analytics/trends?field=password", headers))).status).toBe(
      400,
    );
  });
});
