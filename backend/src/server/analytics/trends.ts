/**
 * Trend analytics over daily values (pure; unit-tested).
 *
 * - rolling7: mean of the last ≤7 days with data (needs ≥3)
 * - baseline: mean ± SD of the 28 days *before* each day (needs ≥7), so a day is
 *   never compared against itself
 * - anomaly: |value − baseline mean| > 2 SD
 */
export type DailyValue = { date: string; value: number | null };

export type TrendPoint = {
  date: string;
  value: number | null;
  rolling7: number | null;
  baselineMean: number | null;
  baselineLow: number | null;
  baselineHigh: number | null;
  anomaly: "high" | "low" | null;
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[], m: number) => Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));

export const BASELINE_DAYS = 28;
const MIN_BASELINE = 7;
const Z = 2;

/**
 * `series` must be sorted by date, contiguous, and include BASELINE_DAYS of
 * history before `fromDate`; only points from `fromDate` on are returned.
 */
export function computeTrend(series: DailyValue[], fromDate: string): TrendPoint[] {
  const out: TrendPoint[] = [];
  series.forEach((p, i) => {
    if (p.date < fromDate) return;
    const window7 = series
      .slice(Math.max(0, i - 6), i + 1)
      .flatMap((x) => (x.value == null ? [] : [x.value]));
    const history = series
      .slice(Math.max(0, i - BASELINE_DAYS), i)
      .flatMap((x) => (x.value == null ? [] : [x.value]));

    let baselineMean: number | null = null;
    let spread: number | null = null;
    if (history.length >= MIN_BASELINE) {
      baselineMean = mean(history);
      spread = sd(history, baselineMean);
    }
    let anomaly: TrendPoint["anomaly"] = null;
    if (p.value != null && baselineMean != null && spread != null && spread > 0) {
      const z = (p.value - baselineMean) / spread;
      if (z > Z) anomaly = "high";
      else if (z < -Z) anomaly = "low";
    }
    out.push({
      date: p.date,
      value: p.value,
      rolling7: window7.length >= 3 ? mean(window7) : null,
      baselineMean,
      baselineLow: baselineMean != null && spread != null ? baselineMean - spread : null,
      baselineHigh: baselineMean != null && spread != null ? baselineMean + spread : null,
      anomaly,
    });
  });
  return out;
}

/** Mean of non-null values, or null. */
export function averageOf(values: (number | null | undefined)[]): number | null {
  const xs = values.filter((v): v is number => v != null);
  return xs.length ? mean(xs) : null;
}

/** Relative change a→b as a fraction (0.05 = +5%), or null. */
export function relativeChange(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}
