import { describe, expect, it } from "vitest";
import { MIN_BEATS, rmssd, rmssdWindows } from "@/server/analytics/hrv";

/** Alternating 1000/1040 ms → every successive difference is 40 ms → RMSSD = 40. */
const alternating = (n: number) => Array.from({ length: n }, (_, i) => (i % 2 ? 1040 : 1000));

describe("rmssd", () => {
  it("computes the root mean square of successive differences", () => {
    expect(rmssd(alternating(40))).toBeCloseTo(40, 6);
    // 30 beats with successive differences alternating +10 / −20:
    // 29 diffs → 15 of 10² and 14 of 20² → sqrt((15·100 + 14·400) / 29)
    const beats = [1000];
    for (let i = 1; i < 30; i++) beats.push(beats[i - 1]! + (i % 2 ? 10 : -20));
    expect(rmssd(beats)).toBeCloseTo(Math.sqrt((15 * 100 + 14 * 400) / 29), 9);
  });

  it("needs enough clean beats", () => {
    expect(rmssd(alternating(MIN_BEATS - 1))).toBeNull();
    expect(rmssd(alternating(MIN_BEATS))).toBeCloseTo(40, 6);
  });

  it("drops out-of-range and ectopic beats without bridging across them", () => {
    const clean = alternating(40);
    const withArtifacts = [...clean.slice(0, 20), 250, 3000, 1600, ...clean.slice(20)];
    // The artifacts are removed and differences are never taken across the gap,
    // so RMSSD is unchanged.
    expect(rmssd(withArtifacts)).toBeCloseTo(40, 6);
  });
});

describe("rmssdWindows", () => {
  it("assigns beats to aligned 5-minute windows by cumulative time", () => {
    const start = 1_790_000_100; // 100 s into a 300 s window
    const beats = alternating(400); // ~408 s of beats → spans two windows
    const out = rmssdWindows([{ t: start, ms: beats }]);
    expect(out).toHaveLength(2);
    expect(out[0]!.ts.getTime() / 1000).toBe(Math.floor(start / 300) * 300);
    expect(out.every((w) => Math.abs(w.value - 40) < 0.01)).toBe(true);
  });

  it("skips windows without enough beats", () => {
    expect(rmssdWindows([{ t: 1_790_000_000, ms: alternating(10) }])).toEqual([]);
  });
});
