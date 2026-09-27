import { describe, expect, it } from "vitest";
import { generateRange, planDay, profileFor } from "@/server/sources/mock/generator";
import { normalizedBatchSchema } from "@/server/sources/types";

const tz = "America/New_York";
const p = profileFor("user-123");
const from = new Date("2026-09-01T04:00:00Z"); // local midnight
const to = new Date("2026-09-04T04:00:00Z"); // 3 days later

describe("mock generator", () => {
  const batch = generateRange(p, tz, from, to);

  it("is deterministic", () => {
    const again = generateRange(p, tz, from, to);
    expect(again.samples.length).toBe(batch.samples.length);
    expect(again.samples.slice(0, 500)).toEqual(batch.samples.slice(0, 500));
    expect(again.sleepSessions).toEqual(batch.sleepSessions);
  });

  it("produces records that pass normalized validation", () => {
    expect(() => normalizedBatchSchema.parse(batch)).not.toThrow();
  });

  it("emits one HR sample per minute", () => {
    expect(batch.samples.filter((s) => s.type === "HEART_RATE")).toHaveLength(3 * 1440);
  });

  it("emits one sleep session and resting HR per night", () => {
    expect(batch.sleepSessions).toHaveLength(3);
    expect(batch.samples.filter((s) => s.type === "RESTING_HEART_RATE")).toHaveLength(3);
    for (const s of batch.sleepSessions) {
      const hours = (s.endAt.getTime() - s.startAt.getTime()) / 3_600_000;
      expect(hours).toBeGreaterThan(6);
      expect(hours).toBeLessThan(9);
      const staged = s.stages.reduce((a, st) => a + st.seconds, 0) * 1000;
      expect(staged).toBeLessThanOrEqual(s.endAt.getTime() - s.startAt.getTime());
    }
  });

  it("keeps sleeping HR below awake HR", () => {
    const night = batch.samples.filter((s) => s.type === "HEART_RATE" && s.ts.getUTCHours() === 8); // 04:00 local
    const noon = batch.samples.filter((s) => s.type === "HEART_RATE" && s.ts.getUTCHours() === 16); // 12:00 local
    const avg = (xs: typeof night) => xs.reduce((a, s) => a + s.value, 0) / xs.length;
    expect(avg(night)).toBeLessThan(avg(noon));
  });

  it("only emits overnight HRV and SpO₂", () => {
    for (const s of batch.samples.filter((s) => s.type === "HRV_RMSSD" || s.type === "SPO2")) {
      const localHour = (s.ts.getUTCHours() + 24 - 4) % 24;
      expect(localHour < 8 || localHour >= 22).toBe(true);
    }
  });

  it("splitting a range yields the same data as generating it at once", () => {
    const mid = new Date("2026-09-02T15:37:00Z");
    const a = generateRange(p, tz, from, mid);
    const b = generateRange(p, tz, mid, to);
    expect(a.samples.length + b.samples.length).toBe(batch.samples.length);
    expect(a.sleepSessions.length + b.sleepSessions.length).toBe(batch.sleepSessions.length);
    expect(a.workouts.length + b.workouts.length).toBe(batch.workouts.length);
  });

  it("plans workouts in the evening", () => {
    const plan = planDay(p, "2026-09-02", tz);
    if (plan.workout) {
      const h = (new Date(plan.workout.startAt).getUTCHours() + 24 - 4) % 24;
      expect(h).toBeGreaterThanOrEqual(17);
    }
  });
});
