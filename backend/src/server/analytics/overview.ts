import "server-only";
import { previousPeriod, shiftDays, todayIn, type DateRange } from "@/lib/range";
import { averageOf, BASELINE_DAYS, computeTrend, relativeChange } from "@/server/analytics/trends";
import { getDailySummaries, getLatestSample, type DaySummary } from "@/server/metrics/queries";

export const TREND_FIELDS = [
  "restingHr",
  "hrvRmssd",
  "sleepMinutes",
  "steps",
  "calories",
  "spo2Avg",
] as const;
export type TrendField = (typeof TREND_FIELDS)[number];

/**
 * KPI tiles. For "today" the tile shows today's value vs the trailing 7-day
 * average; for longer ranges, the per-day average vs the previous period.
 */
export async function getOverview(userId: string, range: DateRange) {
  const isToday = range.days === 1;
  const compare = isToday
    ? { fromDate: shiftDays(range.fromDate, -7), toDate: shiftDays(range.fromDate, -1) }
    : previousPeriod(range);

  const [current, previous, latestHr] = await Promise.all([
    getDailySummaries(userId, range.fromDate, range.toDate),
    getDailySummaries(userId, compare.fromDate, compare.toDate),
    getLatestSample(userId, "HEART_RATE", range.to),
  ]);

  const avg = (rows: DaySummary[], f: keyof Omit<DaySummary, "date">) => averageOf(rows.map((r) => r[f]));
  const isLive = range.toDate === todayIn(range.tz);
  const tile = (f: keyof Omit<DaySummary, "date">, cumulative = false) => {
    const value = avg(current, f);
    const prev = avg(previous, f);
    // A day in progress can't be compared with whole days for running totals.
    const partial = cumulative && isToday && isLive;
    return { value, previous: prev, change: partial ? null : relativeChange(value, prev), partial };
  };

  return {
    comparedTo: isToday ? "7-day average" : `previous ${range.days} days`,
    perDay: !isToday,
    heartRate: isLive ? latestHr : null,
    steps: tile("steps", true),
    calories: tile("calories", true),
    restingHr: tile("restingHr"),
    hrvRmssd: tile("hrvRmssd"),
    spo2Avg: tile("spo2Avg"),
    sleepMinutes: tile("sleepMinutes"),
    activeMinutes: tile("activeMinutes", true),
  };
}

export type Overview = Awaited<ReturnType<typeof getOverview>>;

/** Daily trend with 7-day rolling mean, 28-day personal baseline and anomalies. */
export async function getTrend(userId: string, field: TrendField, range: DateRange) {
  const rows = await getDailySummaries(userId, shiftDays(range.fromDate, -BASELINE_DAYS), range.toDate);
  return computeTrend(
    rows.map((r) => ({ date: r.date, value: r[field] })),
    range.fromDate,
  );
}
