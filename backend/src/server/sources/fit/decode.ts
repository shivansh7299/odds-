import { Decoder, Stream } from "@garmin/fitsdk";
import type { SleepStage } from "@/generated/prisma/enums";
import type { NormalizedSample, NormalizedSleep, NormalizedWorkout } from "@/server/sources/types";

/**
 * FIT → NormalizedBatch. Pure (no I/O) so it's unit-testable with encoded fixtures.
 *
 * Handled (Forerunner 265 files):
 *  - activity:    session → Workout; record.heartRate → HEART_RATE (1 s)
 *  - monitoring:  heartRate → HEART_RATE (60 s); cumulative cycles/activeCalories per
 *                 activity type → STEPS / CALORIES deltas; monitoringHrData → RESTING_HEART_RATE
 *  - sleep:       sleepLevel → SleepSession stages; sleepAssessment → score
 *  - HRV status:  hrvValue (5 min) → HRV_RMSSD, else hrvStatusSummary.lastNightAverage
 *  - SpO₂:        spo2Data.readingSpo2 → SPO2
 * Unrecognized messages are ignored; one file can contain several of these.
 */

export type FitResult = {
  kind: string;
  samples: NormalizedSample[];
  sleepSessions: NormalizedSleep[];
  workouts: NormalizedWorkout[];
  warnings: string[];
};

type Mesg = Record<string, unknown>;
const FIT_EPOCH_S = 631_065_600; // 1989-12-31T00:00:00Z

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);
const inRange = (v: number | null, lo: number, hi: number): v is number => v != null && v >= lo && v <= hi;

export function isFit(bytes: Uint8Array): boolean {
  try {
    return Decoder.isFIT(Stream.fromByteArray(bytes));
  } catch {
    return false;
  }
}

export function decodeFit(bytes: Uint8Array, name = "file.fit"): FitResult {
  const stream = Stream.fromByteArray(bytes);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error(`${name} is not a FIT file`);
  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  });
  const warnings = errors.map((e: Error) => `${name}: ${e.message}`);
  const m = messages as Record<string, Mesg[] | undefined>;
  const kind = String(m.fileIdMesgs?.[0]?.type ?? "unknown");

  const samples: NormalizedSample[] = [];
  const add = (
    type: NormalizedSample["type"],
    ts: Date | null,
    value: number | null,
    resolutionSec: number,
  ) => {
    if (ts && value != null) samples.push({ type, ts, value, resolutionSec });
  };

  // ── Activities ────────────────────────────────────────────────────────────
  const workouts: NormalizedWorkout[] = [];
  for (const s of m.sessionMesgs ?? []) {
    const start = date(s.startTime);
    const duration = num(s.totalTimerTime) ?? num(s.totalElapsedTime);
    if (!start || !duration || duration <= 0) continue;
    const sport = String(s.sport ?? "generic");
    const sub = String(s.subSport ?? "");
    const activityType =
      sub === "strengthTraining"
        ? "strength_training"
        : sport.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    const avgHr = num(s.avgHeartRate);
    const maxHr = num(s.maxHeartRate);
    const steps =
      num(s.totalStrides) ?? (sport === "running" || sport === "walking" ? num(s.totalCycles) : null);
    workouts.push({
      externalId: `fit-activity-${start.toISOString()}`,
      activityType,
      startAt: start,
      durationSec: Math.round(duration),
      calories: num(s.totalCalories) ?? undefined,
      avgHr: inRange(avgHr, 25, 250) ? avgHr : undefined,
      maxHr: inRange(maxHr, 25, 250) ? maxHr : undefined,
      distanceM: num(s.totalDistance) ?? undefined,
      // running cadence is per foot: strides × 2 = steps
      steps:
        steps != null
          ? Math.round(sport === "running" || sport === "walking" ? steps * 2 : steps)
          : undefined,
    });
  }
  for (const r of m.recordMesgs ?? []) {
    const hr = num(r.heartRate);
    if (inRange(hr, 25, 250)) add("HEART_RATE", date(r.timestamp), hr, 1);
  }

  // ── Monitoring (all-day wellness) ─────────────────────────────────────────
  let lastTs: number | null = null; // FIT-epoch seconds of the last full timestamp
  const lastSteps = new Map<string, number>();
  const lastKcal = new Map<string, number>();
  for (const mon of m.monitoringMesgs ?? []) {
    const full = date(mon.timestamp);
    let ts: Date | null = null;
    if (full) {
      lastTs = Math.floor(full.getTime() / 1000) - FIT_EPOCH_S;
      ts = full;
    } else {
      const t16 = num(mon.timestamp16);
      if (t16 != null && lastTs != null) {
        lastTs += (t16 - (lastTs & 0xffff)) & 0xffff; // 16-bit rollover-safe offset
        ts = new Date((lastTs + FIT_EPOCH_S) * 1000);
      }
    }
    if (!ts) continue;

    const hr = num(mon.heartRate);
    if (inRange(hr, 25, 250)) add("HEART_RATE", ts, hr, 60);

    const activity = String(mon.activityType ?? "generic");
    // `steps` is the subfield of `cycles` for walking/running (cycles has scale 2, steps scale 1).
    const cycles = num(mon.cycles);
    const steps =
      num(mon.steps) ??
      ((activity === "walking" || activity === "running") && cycles != null ? cycles * 2 : null);
    if (steps != null) {
      const prev = lastSteps.get(activity);
      const delta = prev == null || steps < prev ? (prev == null ? 0 : steps) : steps - prev; // counters reset daily
      lastSteps.set(activity, steps);
      if (delta > 0 && delta <= 100_000) add("STEPS", ts, delta, 60);
    }
    const kcal = num(mon.activeCalories);
    if (kcal != null) {
      const prev = lastKcal.get(activity);
      const delta = prev == null || kcal < prev ? (prev == null ? 0 : kcal) : kcal - prev;
      lastKcal.set(activity, kcal);
      if (delta > 0 && delta <= 10_000) add("CALORIES", ts, delta, 60);
    }
  }
  for (const h of m.monitoringHrDataMesgs ?? []) {
    const rhr = num(h.currentDayRestingHeartRate) ?? num(h.restingHeartRate);
    if (inRange(rhr, 25, 150)) add("RESTING_HEART_RATE", date(h.timestamp), rhr, 86_400);
  }

  // ── HRV & SpO₂ ────────────────────────────────────────────────────────────
  const hrvValues = (m.hrvValueMesgs ?? []).filter((h) => date(h.timestamp) && inRange(num(h.value), 1, 300));
  for (const h of hrvValues) add("HRV_RMSSD", date(h.timestamp), Math.round(num(h.value)!), 300);
  if (hrvValues.length === 0) {
    for (const h of m.hrvStatusSummaryMesgs ?? []) {
      const avg = num(h.lastNightAverage);
      if (inRange(avg, 1, 300)) add("HRV_RMSSD", date(h.timestamp), Math.round(avg), 86_400);
    }
  }
  for (const s of m.spo2DataMesgs ?? []) {
    const v = num(s.readingSpo2);
    if (inRange(v, 50, 100)) add("SPO2", date(s.timestamp), v, 60);
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────
  const sleepSessions: NormalizedSleep[] = [];
  const levels = (m.sleepLevelMesgs ?? [])
    .map((l) => ({ ts: date(l.timestamp), level: String(l.sleepLevel ?? "") }))
    .filter((l): l is { ts: Date; level: string } => l.ts != null)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  if (levels.length >= 2) {
    const STAGE: Record<string, SleepStage> = { awake: "AWAKE", light: "LIGHT", deep: "DEEP", rem: "REM" };
    const stages: NormalizedSleep["stages"] = [];
    const step = 60_000; // last reading lasts one epoch
    for (let i = 0; i < levels.length; i++) {
      const cur = levels[i]!;
      const stage = STAGE[cur.level];
      if (!stage) continue; // "unmeasurable" → gap
      const end = levels[i + 1]?.ts.getTime() ?? cur.ts.getTime() + step;
      const seconds = Math.round((end - cur.ts.getTime()) / 1000);
      if (seconds <= 0) continue;
      const last = stages.at(-1);
      if (last && last.stage === stage && last.startAt.getTime() + last.seconds * 1000 === cur.ts.getTime()) {
        last.seconds += seconds; // merge consecutive epochs of the same stage
      } else {
        stages.push({ stage, startAt: cur.ts, seconds });
      }
    }
    if (stages.length) {
      const startAt = stages[0]!.startAt;
      const lastStage = stages.at(-1)!;
      const endAt = new Date(lastStage.startAt.getTime() + lastStage.seconds * 1000);
      const score = num(m.sleepAssessmentMesgs?.[0]?.overallSleepScore);
      sleepSessions.push({
        externalId: `fit-sleep-${startAt.toISOString()}`,
        startAt,
        endAt,
        score: inRange(score, 0, 100) ? score : undefined,
        isMainSleep: endAt.getTime() - startAt.getTime() >= 3 * 3_600_000,
        stages,
      });
    }
  }

  return { kind, samples, sleepSessions, workouts, warnings };
}
