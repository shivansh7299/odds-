import "server-only";
import type { MetricType, SourceType } from "@/generated/prisma/enums";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { METRICS } from "@/lib/metrics/definitions";
import { eachDate, type DateRange } from "@/lib/range";
import { sourcePriority } from "@/server/sources/catalog";

// All queries filter by userId first: a user can only ever read their own rows.
// Instants are bound as ISO strings (see ingest.ts).

type Conn = { id: string; source: SourceType };

async function userConnections(userId: string): Promise<Conn[]> {
  const conns = await db.sourceConnection.findMany({ where: { userId }, select: { id: true, source: true } });
  return conns.sort((a, b) => sourcePriority(a.source) - sourcePriority(b.source));
}

export type SeriesPoint = { t: string; v: number; min: number; max: number; source: SourceType };

/**
 * Bucketed time series: avg (with min/max) for rate metrics, sum for count metrics.
 * Each bucket comes from the most precise source that has data *in that bucket*
 * (BLE > Connect IQ > FIT > simulated), so a short live session refines the chart
 * without hiding the rest of the day, and overlapping sources never double-count.
 */
export async function getSeries(
  userId: string,
  type: MetricType,
  range: Pick<DateRange, "from" | "to" | "tz">,
  bucketSec: number,
): Promise<{ source: SourceType | null; sources: SourceType[]; bucketSec: number; points: SeriesPoint[] }> {
  const conns = await userConnections(userId);
  if (conns.length === 0) return { source: null, sources: [], bucketSec, points: [] };

  const priority = conns.map((c) => c.id); // already sorted best-first
  const agg = METRICS[type].agg;
  const from = range.from.toISOString();
  const to = range.to.toISOString();
  const bucketExpr =
    bucketSec >= 86_400
      ? Prisma.sql`((ts AT TIME ZONE ${range.tz})::date::timestamp AT TIME ZONE ${range.tz})`
      : Prisma.sql`date_bin(make_interval(secs => ${bucketSec}), ts, '2000-01-01T00:00:00Z'::timestamptz)`;

  const rows = await db.$queryRaw<{ t: Date; v: number; min: number; max: number; connectionId: string }[]>`
    WITH per_source AS (
      SELECT ${bucketExpr} AS t, "connectionId",
             CASE WHEN ${agg} = 'sum' THEN sum(value) ELSE avg(value) END AS v,
             min(value) AS min, max(value) AS max
      FROM metric_sample
      WHERE "userId" = ${userId} AND type = ${type}::"MetricType"
        AND ts >= ${from}::timestamptz AND ts < ${to}::timestamptz
      GROUP BY 1, 2
    )
    SELECT DISTINCT ON (t) t, v, min, max, "connectionId"
    FROM per_source
    ORDER BY t, array_position(${priority}::text[], "connectionId")`;

  const sourceOf = new Map(conns.map((c) => [c.id, c.source]));
  const points = rows.map((r) => ({
    t: new Date(r.t).toISOString(),
    v: Math.round(Number(r.v) * 10) / 10,
    min: Number(r.min),
    max: Number(r.max),
    source: sourceOf.get(r.connectionId)!,
  }));
  const sources = [...new Set(points.map((p) => p.source))];
  const best = conns.find((c) => sources.includes(c.source))?.source ?? null;
  return { source: best, sources, bucketSec, points };
}

export type DaySummary = {
  date: string;
  steps: number | null;
  calories: number | null;
  restingHr: number | null;
  hrvRmssd: number | null;
  spo2Avg: number | null;
  spo2Min: number | null;
  activeMinutes: number | null;
  sleepMinutes: number | null;
};
const FIELDS = [
  "steps",
  "calories",
  "restingHr",
  "hrvRmssd",
  "spo2Avg",
  "spo2Min",
  "activeMinutes",
  "sleepMinutes",
] as const;

/** One row per date in [fromDate, toDate]; each field from the highest-priority source that has it. */
export async function getDailySummaries(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<DaySummary[]> {
  const conns = await userConnections(userId);
  const rank = new Map(conns.map((c, i) => [c.id, i]));
  const rows = await db.dailySummary.findMany({
    where: { userId, date: { gte: new Date(`${fromDate}T00:00:00Z`), lte: new Date(`${toDate}T00:00:00Z`) } },
  });
  rows.sort((a, b) => (rank.get(a.connectionId) ?? 99) - (rank.get(b.connectionId) ?? 99));

  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const d = r.date.toISOString().slice(0, 10);
    byDate.set(d, [...(byDate.get(d) ?? []), r]);
  }
  return eachDate(fromDate, toDate).map((date) => {
    const candidates = byDate.get(date) ?? [];
    const out = { date } as DaySummary;
    for (const f of FIELDS) out[f] = candidates.find((c) => c[f] != null)?.[f] ?? null;
    return out;
  });
}

/** Most recent sample of a metric (any source), for "current" KPI values. */
export async function getLatestSample(userId: string, type: MetricType, before: Date) {
  const s = await db.metricSample.findFirst({
    where: { userId, type, ts: { lte: before } },
    orderBy: { ts: "desc" },
    select: { ts: true, value: true, connection: { select: { source: true } } },
  });
  return s ? { ts: s.ts.toISOString(), value: s.value, source: s.connection.source } : null;
}

export async function getSleepNight(userId: string, tz: string, date: string) {
  // The main sleep that ended on `date` (local), else the most recent one before it.
  const session = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM sleep_session
    WHERE "userId" = ${userId} AND "isMainSleep"
      AND ("endAt" AT TIME ZONE ${tz})::date <= ${date}::date
    ORDER BY "endAt" DESC LIMIT 1`;
  if (!session[0]) return null;
  const s = await db.sleepSession.findUniqueOrThrow({
    where: { id: session[0].id },
    include: {
      stages: { orderBy: { startAt: "asc" }, select: { stage: true, startAt: true, seconds: true } },
      connection: { select: { source: true } },
    },
  });
  const totals = { AWAKE: 0, LIGHT: 0, DEEP: 0, REM: 0 };
  for (const st of s.stages) totals[st.stage] += st.seconds;
  return {
    id: s.id,
    source: s.connection.source,
    startAt: s.startAt.toISOString(),
    endAt: s.endAt.toISOString(),
    score: s.score,
    asleepMinutes: Math.round((totals.LIGHT + totals.DEEP + totals.REM) / 60),
    stageMinutes: Object.fromEntries(
      Object.entries(totals).map(([k, v]) => [k, Math.round(v / 60)]),
    ) as Record<keyof typeof totals, number>,
    stages: s.stages.map((st) => ({
      stage: st.stage,
      startAt: st.startAt.toISOString(),
      seconds: st.seconds,
    })),
  };
}

export type SleepNight = NonNullable<Awaited<ReturnType<typeof getSleepNight>>>;

export async function getWorkouts(userId: string, from: Date, to: Date, limit: number, cursor?: string) {
  const rows = await db.workout.findMany({
    where: { userId, startAt: { gte: from, lt: to } },
    orderBy: [{ startAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    select: {
      id: true,
      externalId: true,
      activityType: true,
      startAt: true,
      durationSec: true,
      calories: true,
      avgHr: true,
      maxHr: true,
      distanceM: true,
      steps: true,
      connection: { select: { source: true } },
    },
  });
  const page = rows.slice(0, limit);
  return {
    workouts: page.map(({ connection, ...w }) => ({
      ...w,
      startAt: w.startAt.toISOString(),
      source: connection.source,
    })),
    nextCursor: rows.length > limit ? page.at(-1)!.id : null,
  };
}

export type WorkoutRow = Awaited<ReturnType<typeof getWorkouts>>["workouts"][number];
