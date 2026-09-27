import "server-only";
import { db } from "@/lib/db";

/**
 * Recomputes DailySummary rows for the given local dates of one connection,
 * straight from the raw data (idempotent; safe to call repeatedly).
 *
 * - steps / calories: sum of intraday samples
 * - restingHr: average of RESTING_HEART_RATE samples that day
 * - hrvRmssd, spo2Avg/Min: average/min of samples that day
 * - activeMinutes: 1-minute buckets with ≥ 60 steps (brisk walking or faster)
 * - sleepMinutes: non-awake sleep attributed to the local date the sleep ended
 */
export async function recomputeDailySummaries(
  conn: { id: string; userId: string; timezone: string },
  dates: string[],
): Promise<number> {
  if (dates.length === 0) return 0;
  const tz = conn.timezone;

  return db.$executeRaw`
    WITH d AS (
      SELECT unnest(${dates}::date[]) AS date
    ),
    bounds AS (
      SELECT (min(date)::timestamp AT TIME ZONE ${tz}) - interval '1 day' AS lo,
             (max(date)::timestamp AT TIME ZONE ${tz}) + interval '2 day' AS hi
      FROM d
    ),
    m AS (
      SELECT (s.ts AT TIME ZONE ${tz})::date AS date, s.type, s.value, s."resolutionSec", s.ts
      FROM metric_sample s, bounds b
      WHERE s."connectionId" = ${conn.id} AND s.ts >= b.lo AND s.ts < b.hi
    ),
    steps_per_minute AS (
      SELECT date, date_trunc('minute', ts) AS minute, sum(value) AS steps
      FROM m WHERE type = 'STEPS' AND "resolutionSec" <= 60
      GROUP BY 1, 2
    ),
    active AS (
      SELECT date, count(*) FILTER (WHERE steps >= 60)::int AS minutes FROM steps_per_minute GROUP BY 1
    ),
    agg AS (
      SELECT d.date,
        round(sum(m.value) FILTER (WHERE m.type = 'STEPS'))::int AS steps,
        round(sum(m.value) FILTER (WHERE m.type = 'CALORIES'))::int AS calories,
        round(avg(m.value) FILTER (WHERE m.type = 'RESTING_HEART_RATE'))::int AS resting_hr,
        avg(m.value) FILTER (WHERE m.type = 'HRV_RMSSD') AS hrv,
        avg(m.value) FILTER (WHERE m.type = 'SPO2') AS spo2_avg,
        min(m.value) FILTER (WHERE m.type = 'SPO2') AS spo2_min
      FROM d LEFT JOIN m ON m.date = d.date
      GROUP BY d.date
    ),
    sl AS (
      SELECT (ss."endAt" AT TIME ZONE ${tz})::date AS date,
             (sum(seg.seconds) FILTER (WHERE seg.stage <> 'AWAKE') / 60)::int AS minutes
      FROM sleep_session ss
      JOIN sleep_segment seg ON seg."sessionId" = ss.id
      WHERE ss."connectionId" = ${conn.id} AND ss."isMainSleep"
      GROUP BY 1
    ),
    rows AS (
      SELECT agg.*, active.minutes AS active_minutes, sl.minutes AS sleep_minutes
      FROM agg
      LEFT JOIN active ON active.date = agg.date
      LEFT JOIN sl ON sl.date = agg.date
    ),
    deleted AS (
      DELETE FROM daily_summary ds
      USING rows r
      WHERE ds."connectionId" = ${conn.id} AND ds.date = r.date
        AND r.steps IS NULL AND r.calories IS NULL AND r.resting_hr IS NULL AND r.hrv IS NULL
        AND r.spo2_avg IS NULL AND r.sleep_minutes IS NULL
    )
    INSERT INTO daily_summary ("connectionId", date, "userId", steps, calories, "restingHr", "hrvRmssd",
                               "spo2Avg", "spo2Min", "activeMinutes", "sleepMinutes", "updatedAt")
    SELECT ${conn.id}, date, ${conn.userId}, steps, calories, resting_hr, hrv, spo2_avg, spo2_min,
           active_minutes, sleep_minutes, now()
    FROM rows
    WHERE steps IS NOT NULL OR calories IS NOT NULL OR resting_hr IS NOT NULL OR hrv IS NOT NULL
       OR spo2_avg IS NOT NULL OR sleep_minutes IS NOT NULL
    ON CONFLICT ("connectionId", date) DO UPDATE SET
      steps = EXCLUDED.steps, calories = EXCLUDED.calories, "restingHr" = EXCLUDED."restingHr",
      "hrvRmssd" = EXCLUDED."hrvRmssd", "spo2Avg" = EXCLUDED."spo2Avg", "spo2Min" = EXCLUDED."spo2Min",
      "activeMinutes" = EXCLUDED."activeMinutes", "sleepMinutes" = EXCLUDED."sleepMinutes",
      "updatedAt" = now()
  `;
}
