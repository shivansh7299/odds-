import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";
import type { SleepStage } from "@/generated/prisma/enums";
import type {
  NormalizedBatch,
  NormalizedSample,
  NormalizedSleep,
  NormalizedWorkout,
} from "@/server/sources/types";

/**
 * Deterministic synthetic wearable data. Every value is a pure function of
 * (user seed, timestamp), so regenerating a range yields identical rows and the
 * idempotent upsert makes backfills and ticks safe to repeat.
 */

const MINUTE = 60_000;

// ─── Seeded randomness ──────────────────────────────────────────────────────

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Uniform [0, 1) from a key. */
function rand(key: string): number {
  let t = (hash(key) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const between = (key: string, lo: number, hi: number) => lo + rand(key) * (hi - lo);
/** Roughly normal noise in [-1, 1]. */
const noise = (key: string) => (rand(`${key}a`) + rand(`${key}b`) + rand(`${key}c`)) / 1.5 - 1;
const round1 = (v: number) => Math.round(v * 10) / 10;

// ─── Profile & daily schedule ───────────────────────────────────────────────

export type MockProfile = { seed: string; restingHr: number; hrvBase: number };

export function profileFor(userId: string): MockProfile {
  return {
    seed: userId,
    restingHr: Math.round(between(`${userId}:rhr`, 52, 63)),
    hrvBase: Math.round(between(`${userId}:hrv`, 38, 62)),
  };
}

const WORKOUT_TYPES = [
  { type: "running", hrBoost: 85, stepsPerMin: 165, kcalPerMin: 11 },
  { type: "cycling", hrBoost: 70, stepsPerMin: 0, kcalPerMin: 9 },
  { type: "strength_training", hrBoost: 45, stepsPerMin: 8, kcalPerMin: 6 },
  { type: "walking", hrBoost: 30, stepsPerMin: 115, kcalPerMin: 4.5 },
] as const;

type DayPlan = {
  date: string; // local YYYY-MM-DD
  wakeAt: number; // ms, morning of `date`
  sleepAt: number; // ms, evening of `date` (night ending the next day)
  workout: { startAt: number; endAt: number; kind: (typeof WORKOUT_TYPES)[number] } | null;
};

/** Local wall-clock time on a date → epoch ms. */
function localTime(date: string, tz: string, hours: number): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const h = Math.floor(hours);
  const min = Math.round((hours - h) * 60);
  return new TZDate(y, m - 1, d, h, min, 0, tz).getTime();
}

export function planDay(p: MockProfile, date: string, tz: string): DayPlan {
  const k = `${p.seed}:${date}`;
  const hasWorkout = rand(`${k}:wo`) < 0.6;
  const kind = WORKOUT_TYPES[Math.floor(rand(`${k}:wotype`) * WORKOUT_TYPES.length)]!;
  const woStart = localTime(date, tz, between(`${k}:wostart`, 17.25, 19));
  const woDur = Math.round(between(`${k}:wodur`, 30, 60)) * MINUTE;
  return {
    date,
    wakeAt: localTime(date, tz, between(`${k}:wake`, 6.25, 7.25)),
    sleepAt: localTime(date, tz, between(`${k}:sleep`, 22.75, 23.75)),
    workout: hasWorkout ? { startAt: woStart, endAt: woStart + woDur, kind } : null,
  };
}

const dateOf = (ts: number, tz: string) => format(new TZDate(ts, tz), "yyyy-MM-dd");
const shiftDate = (date: string, days: number) =>
  format(addDays(new Date(`${date}T12:00:00Z`), days), "yyyy-MM-dd");
const localHour = (ts: number, tz: string) => {
  const d = new TZDate(ts, tz);
  return d.getHours() + d.getMinutes() / 60;
};

// ─── Per-minute physiology ──────────────────────────────────────────────────

type Minute = { hr: number; steps: number; kcal: number; asleep: boolean };

function simulateMinute(p: MockProfile, ts: number, tz: string, plans: (d: string) => DayPlan): Minute {
  const date = dateOf(ts, tz);
  const today = plans(date);
  const asleep = ts < today.wakeAt || ts >= today.sleepAt;
  const minuteKey = `${p.seed}:${Math.floor(ts / MINUTE)}`;

  if (asleep) {
    // Slow drift through the night with small REM-like bumps.
    const hr = p.restingHr - 5 + 2.5 * Math.sin(ts / (90 * MINUTE)) + 1.5 * noise(minuteKey);
    return { hr: Math.round(hr), steps: 0, kcal: 0, asleep: true };
  }

  const wo = today.workout;
  if (wo && ts >= wo.startAt && ts < wo.endAt) {
    const t = (ts - wo.startAt) / (wo.endAt - wo.startAt);
    const ramp = Math.min(1, t * 6) * Math.min(1, (1 - t) * 8); // warm-up and cool-down
    const hr = p.restingHr + 15 + wo.kind.hrBoost * ramp + 4 * noise(minuteKey);
    const steps = wo.kind.stepsPerMin * (0.85 + 0.15 * ramp) * (1 + 0.05 * noise(`${minuteKey}s`));
    return {
      hr: Math.round(hr),
      steps: Math.round(steps),
      kcal: round1(wo.kind.kcalPerMin * (0.5 + 0.5 * ramp)),
      asleep: false,
    };
  }

  // Awake baseline: circadian rise, plus walking bursts in 10-minute blocks.
  const hour = localHour(ts, tz);
  const circadian = 6 * Math.sin(((hour - 9) / 24) * 2 * Math.PI);
  const block = `${p.seed}:${Math.floor(ts / (10 * MINUTE))}`;
  const busyHour = (hour >= 7.5 && hour < 9) || (hour >= 12 && hour < 13.5) || (hour >= 17 && hour < 20);
  const walking = rand(`${block}:walk`) < (busyHour ? 0.28 : 0.05);
  const steps = walking
    ? between(`${minuteKey}:st`, 85, 120)
    : Math.max(0, 10 * noise(`${minuteKey}:st`) - 4);
  const hr = p.restingHr + 12 + circadian + (walking ? 22 : 0) + 3 * noise(minuteKey);
  return { hr: Math.round(hr), steps: Math.round(steps), kcal: round1(steps * 0.045), asleep: false };
}

// ─── Sleep architecture ─────────────────────────────────────────────────────

function buildSleep(p: MockProfile, startAt: number, endAt: number, date: string): NormalizedSleep {
  const k = `${p.seed}:${date}:sleep`;
  const stages: NormalizedSleep["stages"] = [];
  let t = startAt;
  let cycle = 0;
  const push = (stage: SleepStage, minutes: number) => {
    const seconds = Math.round(Math.min(minutes * 60, (endAt - t) / 1000));
    if (seconds <= 0) return;
    stages.push({ stage, startAt: new Date(t), seconds });
    t += seconds * 1000;
  };
  push("AWAKE", between(`${k}:lat`, 4, 14)); // sleep latency
  while (t < endAt - MINUTE) {
    const early = cycle < 2;
    push("LIGHT", between(`${k}:${cycle}:l1`, 20, 35));
    push("DEEP", early ? between(`${k}:${cycle}:d`, 25, 45) : between(`${k}:${cycle}:d`, 0, 12));
    push("LIGHT", between(`${k}:${cycle}:l2`, 8, 15));
    push("REM", early ? between(`${k}:${cycle}:r`, 8, 18) : between(`${k}:${cycle}:r`, 20, 35));
    if (rand(`${k}:${cycle}:wake`) < 0.35) push("AWAKE", between(`${k}:${cycle}:w`, 1, 5));
    cycle++;
  }
  const asleepSec = stages.filter((s) => s.stage !== "AWAKE").reduce((a, s) => a + s.seconds, 0);
  const deepSec = stages.filter((s) => s.stage === "DEEP").reduce((a, s) => a + s.seconds, 0);
  const score = Math.round(
    Math.min(100, 22 + (asleepSec / 3600) * 5 + (deepSec / asleepSec) * 70 + 6 * noise(`${k}:score`)),
  );
  return {
    externalId: `mock-sleep-${date}`,
    startAt: new Date(startAt),
    endAt: new Date(endAt),
    score: Math.max(0, score),
    isMainSleep: true,
    stages,
  };
}

// ─── Range generation ───────────────────────────────────────────────────────

/**
 * Everything whose timestamp falls in [from, to): per-minute HR/steps/calories,
 * overnight HRV (5 min) and SpO₂ (15 min), plus sleep sessions, resting HR and
 * workouts, each emitted when the event *ends* inside the range.
 */
export function generateRange(p: MockProfile, tz: string, from: Date, to: Date): Required<NormalizedBatch> {
  const cache = new Map<string, DayPlan>();
  const plans = (d: string) => {
    let plan = cache.get(d);
    if (!plan) cache.set(d, (plan = planDay(p, d, tz)));
    return plan;
  };

  const samples: NormalizedSample[] = [];
  const sample = (type: NormalizedSample["type"], ts: number, value: number, resolutionSec: number) =>
    samples.push({ type, ts: new Date(ts), value, resolutionSec });

  const start = Math.ceil(from.getTime() / MINUTE) * MINUTE;
  for (let ts = start; ts < to.getTime(); ts += MINUTE) {
    const m = simulateMinute(p, ts, tz, plans);
    sample("HEART_RATE", ts, m.hr, 60);
    if (m.steps > 0) sample("STEPS", ts, m.steps, 60);
    if (m.kcal > 0) sample("CALORIES", ts, m.kcal, 60);
    if (m.asleep && ts % (5 * MINUTE) === 0) {
      const nightKey = `${p.seed}:${dateOf(ts + 12 * 3600_000, tz)}`; // same key for the whole night
      const hrv = p.hrvBase + 8 * noise(`${nightKey}:hrv`) + 6 * noise(`${p.seed}:${ts}:hrv`);
      sample("HRV_RMSSD", ts, Math.max(5, Math.round(hrv)), 300);
    }
    if (m.asleep && ts % (15 * MINUTE) === 0) {
      sample("SPO2", ts, Math.min(100, Math.round(96.5 + 1.5 * noise(`${p.seed}:${ts}:spo2`))), 900);
    }
  }

  const sleepSessions: NormalizedSleep[] = [];
  const workouts: NormalizedWorkout[] = [];
  const firstDate = shiftDate(dateOf(from.getTime(), tz), -1);
  const lastDate = shiftDate(dateOf(to.getTime(), tz), 1);
  for (let d = firstDate; d <= lastDate; d = shiftDate(d, 1)) {
    const plan = plans(d);
    const inRange = (ts: number) => ts >= from.getTime() && ts < to.getTime();

    if (inRange(plan.wakeAt)) {
      const prev = plans(shiftDate(d, -1));
      sleepSessions.push(buildSleep(p, prev.sleepAt, plan.wakeAt, d));
      const rhr = p.restingHr + 2 * noise(`${p.seed}:${d}:rhr`);
      sample("RESTING_HEART_RATE", plan.wakeAt, Math.round(rhr), 86_400);
    }

    const wo = plan.workout;
    if (wo && inRange(wo.endAt)) {
      let hrSum = 0;
      let hrMax = 0;
      let steps = 0;
      let kcal = 0;
      let n = 0;
      for (let ts = wo.startAt; ts < wo.endAt; ts += MINUTE, n++) {
        const m = simulateMinute(p, ts, tz, plans);
        hrSum += m.hr;
        hrMax = Math.max(hrMax, m.hr);
        steps += m.steps;
        kcal += m.kcal;
      }
      const durationSec = Math.round((wo.endAt - wo.startAt) / 1000);
      workouts.push({
        externalId: `mock-workout-${d}`,
        activityType: wo.kind.type,
        startAt: new Date(wo.startAt),
        durationSec,
        avgHr: Math.round(hrSum / n),
        maxHr: hrMax,
        calories: Math.round(kcal),
        steps: steps || undefined,
        distanceM:
          wo.kind.type === "running"
            ? Math.round(durationSec * 2.9)
            : wo.kind.type === "cycling"
              ? Math.round(durationSec * 7)
              : wo.kind.type === "walking"
                ? Math.round(durationSec * 1.4)
                : undefined,
      });
    }
  }

  return { samples, sleepSessions, workouts };
}
