import { describe, expect, it } from "vitest";
import { decodeFit, isFit } from "@/server/sources/fit/decode";
import { activityFit, monitoringFit, sleepFit } from "../fixtures/fit";

describe("decodeFit", () => {
  it("recognizes FIT bytes", () => {
    expect(isFit(activityFit())).toBe(true);
    expect(isFit(new TextEncoder().encode("hello"))).toBe(false);
    expect(() => decodeFit(new TextEncoder().encode("not fit"))).toThrow(/not a FIT file/);
  });

  it("maps an activity to a workout plus 1 s heart rate", () => {
    const r = decodeFit(activityFit());
    expect(r.kind).toBe("activity");
    expect(r.workouts).toHaveLength(1);
    expect(r.workouts[0]).toMatchObject({
      activityType: "running",
      durationSec: 1750,
      distanceM: 5000,
      calories: 400,
      avgHr: 150,
      maxHr: 175,
      steps: 5000,
    });
    const hr = r.samples.filter((s) => s.type === "HEART_RATE");
    expect(hr).toHaveLength(30);
    expect(hr.every((s) => s.resolutionSec === 1)).toBe(true);
  });

  it("rebuilds timestamp16 and converts cumulative counters to deltas", () => {
    const base = new Date("2026-09-20T12:00:00Z");
    const r = decodeFit(monitoringFit(base));
    const at = (s: { ts: Date }) => (s.ts.getTime() - base.getTime()) / 1000;

    const hr = r.samples.filter((s) => s.type === "HEART_RATE");
    expect(hr.map((s) => [at(s), s.value])).toEqual([[60, 72]]); // 10 bpm dropped

    const steps = r.samples.filter((s) => s.type === "STEPS").map((s) => [at(s), s.value]);
    expect(steps).toEqual([
      [120, 100], // walking 1000 → 1100
      [240, 150], // running 300 → 450
    ]);
    expect(r.samples.filter((s) => s.type === "CALORIES").map((s) => s.value)).toEqual([5]);
    expect(r.samples.find((s) => s.type === "RESTING_HEART_RATE")).toMatchObject({
      value: 52,
      resolutionSec: 86_400,
    });
  });

  it("builds sleep sessions, merging epochs and skipping unmeasurable gaps", () => {
    const r = decodeFit(sleepFit());
    expect(r.sleepSessions).toHaveLength(1);
    const s = r.sleepSessions[0]!;
    expect(s.score).toBe(81);
    expect(s.stages.map((st) => [st.stage, st.seconds / 3600])).toEqual([
      ["AWAKE", 1],
      ["LIGHT", 2],
      ["DEEP", 1],
      ["REM", 1],
      ["LIGHT", 1 / 60],
    ]);
    expect(r.samples.filter((x) => x.type === "HRV_RMSSD").map((x) => x.value)).toEqual([45, 50]);
    expect(r.samples.find((x) => x.type === "SPO2")?.value).toBe(95);
  });
});

describe("extractFitFiles", async () => {
  const { zipSync } = await import("fflate");
  const { extractFitFiles } = await import("@/server/sources/fit/unzip");

  it("passes a bare .fit through", () => {
    const fit = activityFit();
    expect(extractFitFiles(fit, "a.fit").files).toEqual([{ name: "a.fit", bytes: fit }]);
  });

  it("finds .fit files in nested zips and ignores other files", () => {
    const inner = zipSync({ "Monitor/1.fit": monitoringFit(), "readme.txt": new Uint8Array([1]) });
    const outer = zipSync({
      "DI_CONNECT/UploadedFiles_Part1.zip": inner,
      "Sleep/2.FIT": sleepFit(),
      "__MACOSX/._junk.fit": new Uint8Array([0]),
    });
    const { files } = extractFitFiles(outer, "export.zip");
    expect(files.map((f) => f.name).sort()).toEqual([
      "DI_CONNECT/UploadedFiles_Part1.zip/Monitor/1.fit",
      "Sleep/2.FIT",
    ]);
  });
});
