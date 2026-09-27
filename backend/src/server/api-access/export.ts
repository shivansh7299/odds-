import "server-only";
import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { db } from "@/lib/db";
import { makeRange, shiftDays, todayIn } from "@/lib/range";
import { getDailySummaries, getLatestSample, getSeries } from "@/server/metrics/queries";

/**
 * Export in a generic "tracker JSON" shape: one object per day with plainly
 * named fields, plus timestamped heart-rate samples. Field names are chosen so
 * that apps with generic JSON importers (like Pulse Check's "My wearables")
 * recognize them: date, restingHeartRate, hrvRmssd, steps, sleepHours,
 * sleepScore, spo2; timestamp + heartRate.
 */
const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

export async function buildExport(user: { id: string; timezone: string }, days: number, hrDays: number) {
  const tz = user.timezone;
  const toDate = todayIn(tz);
  const fromDate = shiftDays(toDate, 1 - days);

  const summaries = await getDailySummaries(user.id, fromDate, toDate);

  const range = makeRange("custom", fromDate, toDate, tz);
  const sleeps = await db.sleepSession.findMany({
    where: { userId: user.id, isMainSleep: true, endAt: { gte: range.from, lte: range.to } },
    select: { endAt: true, score: true },
  });
  const scoreByDay = new Map(
    sleeps
      .filter((s) => s.score != null)
      .map((s) => [format(new TZDate(s.endAt.getTime(), tz), "yyyy-MM-dd"), s.score!]),
  );

  const daily = summaries
    .map((d) => {
      const row: Record<string, string | number> = { date: d.date };
      if (d.restingHr != null) row.restingHeartRate = d.restingHr;
      if (d.hrvRmssd != null) row.hrvRmssd = round(d.hrvRmssd);
      if (d.steps != null) row.steps = d.steps;
      if (d.sleepMinutes != null) row.sleepHours = round(d.sleepMinutes / 60, 2);
      if (scoreByDay.has(d.date)) row.sleepScore = scoreByDay.get(d.date)!;
      if (d.spo2Avg != null) row.spo2 = round(d.spo2Avg);
      return row;
    })
    .filter((r) => Object.keys(r).length > 1);

  const hrRange = makeRange("custom", shiftDays(toDate, 1 - hrDays), toDate, tz);
  const series = await getSeries(user.id, "HEART_RATE", hrRange, 300);
  const heartRate = series.points.map((p) => ({
    timestamp: format(new TZDate(new Date(p.t).getTime(), tz), "yyyy-MM-dd'T'HH:mm:ssxxx"),
    heartRate: Math.round(p.v),
  }));

  return {
    source: "VitalSync",
    generatedAt: new Date().toISOString(),
    timezone: tz,
    range: { from: fromDate, to: toDate },
    daily,
    heartRate,
  };
}

/** Latest heart rate for live displays; null when nothing arrived in the last 10 minutes. */
export async function latestHeartRate(userId: string) {
  const s = await getLatestSample(userId, "HEART_RATE", new Date());
  if (!s) return null;
  const ageSec = Math.round((Date.now() - new Date(s.ts).getTime()) / 1000);
  return ageSec <= 600 ? { bpm: Math.round(s.value), ts: s.ts, ageSec, source: s.source } : null;
}
