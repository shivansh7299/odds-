import { describe, expect, it } from "vitest";
import { bucketFor, eachDate, parseRange, previousPeriod, shiftDays } from "@/lib/range";
import { averageOf, computeTrend, relativeChange } from "@/server/analytics/trends";

const now = new Date("2026-09-26T15:00:00Z"); // 11:00 in New York
const tz = "America/New_York";

describe("parseRange", () => {
  it("resolves presets in the user's timezone", () => {
    const r = parseRange({ range: "7d" }, tz, now);
    expect(r).toMatchObject({ key: "7d", fromDate: "2026-09-20", toDate: "2026-09-26", days: 7 });
    expect(r.from.toISOString()).toBe("2026-09-20T04:00:00.000Z"); // local midnight (EDT)
    expect(r.to).toEqual(now); // capped at now
  });

  it("uses the local date, not the UTC date", () => {
    const lateNight = new Date("2026-09-27T02:30:00Z"); // still Sep 26 in New York
    expect(parseRange({ range: "today" }, tz, lateNight).fromDate).toBe("2026-09-26");
  });

  it("handles custom ranges: swaps, clamps to today, caps length", () => {
    expect(parseRange({ range: "custom", from: "2026-09-10", to: "2026-09-01" }, tz, now)).toMatchObject({
      fromDate: "2026-09-01",
      toDate: "2026-09-10",
      days: 10,
    });
    expect(parseRange({ range: "custom", from: "2026-09-20", to: "2030-01-01" }, tz, now).toDate).toBe(
      "2026-09-26",
    );
    expect(parseRange({ range: "custom", from: "2000-01-01", to: "2026-09-26" }, tz, now).days).toBe(366);
  });

  it("falls back to 7 days on garbage", () => {
    expect(parseRange({ range: "custom", from: "nope" }, tz, now).key).toBe("7d");
    expect(parseRange({}, tz, now).key).toBe("7d");
  });

  it("gives 23-hour days across DST correctly", () => {
    const r = parseRange(
      { range: "custom", from: "2026-11-01", to: "2026-11-01" },
      tz,
      new Date("2026-12-01T00:00:00Z"),
    );
    expect((r.to.getTime() - r.from.getTime()) / 3_600_000).toBe(25); // fall back: 25-hour day
  });

  it("computes the previous period and date lists", () => {
    const r = parseRange({ range: "7d" }, tz, now);
    expect(previousPeriod(r)).toEqual({ fromDate: "2026-09-13", toDate: "2026-09-19" });
    expect(eachDate("2026-02-27", "2026-03-02")).toEqual([
      "2026-02-27",
      "2026-02-28",
      "2026-03-01",
      "2026-03-02",
    ]);
    expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("chooses coarser buckets for longer ranges", () => {
    expect([1, 3, 7, 30, 90].map(bucketFor)).toEqual([60, 300, 900, 3600, 86400]);
  });
});

describe("computeTrend", () => {
  const dates = eachDate("2026-08-01", "2026-09-10");
  const series = dates.map((date, i) => ({ date, value: i === dates.length - 1 ? 90 : 60 + (i % 3) }));
  const trend = computeTrend(series, "2026-09-01");

  it("returns only points from fromDate", () => {
    expect(trend[0]?.date).toBe("2026-09-01");
    expect(trend).toHaveLength(10);
  });

  it("computes a trailing baseline that excludes the day itself", () => {
    const p = trend[0]!;
    expect(p.baselineMean).toBeCloseTo(61, 0);
    expect(p.baselineLow! < p.baselineMean! && p.baselineMean! < p.baselineHigh!).toBe(true);
  });

  it("flags a spike as a high anomaly and normal days as none", () => {
    expect(trend.at(-1)?.anomaly).toBe("high");
    expect(trend.slice(0, -1).every((p) => p.anomaly === null)).toBe(true);
  });

  it("needs enough history for a baseline and skips nulls", () => {
    const sparse = computeTrend(
      eachDate("2026-09-01", "2026-09-05").map((date) => ({
        date,
        value: date === "2026-09-03" ? null : 50,
      })),
      "2026-09-01",
    );
    expect(sparse.every((p) => p.baselineMean === null && p.anomaly === null)).toBe(true);
    expect(sparse.at(-1)?.rolling7).toBe(50);
  });
});

describe("helpers", () => {
  it("averageOf ignores nulls", () => {
    expect(averageOf([1, null, 3, undefined])).toBe(2);
    expect(averageOf([null])).toBeNull();
  });
  it("relativeChange", () => {
    expect(relativeChange(110, 100)).toBeCloseTo(0.1);
    expect(relativeChange(5, 0)).toBeNull();
  });
});
