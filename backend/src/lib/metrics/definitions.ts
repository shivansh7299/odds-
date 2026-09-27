import type { MetricType } from "@/generated/prisma/enums";

/** Display + validation metadata for each metric. Safe to import on the client. */
export const METRICS = {
  HEART_RATE: { label: "Heart rate", unit: "bpm", min: 25, max: 250, agg: "avg", slug: "heart-rate" },
  RESTING_HEART_RATE: { label: "Resting HR", unit: "bpm", min: 25, max: 150, agg: "avg", slug: "resting-hr" },
  HRV_RMSSD: { label: "HRV", unit: "ms", min: 1, max: 300, agg: "avg", slug: "hrv" },
  STEPS: { label: "Steps", unit: "steps", min: 0, max: 100_000, agg: "sum", slug: "steps" },
  CALORIES: { label: "Active calories", unit: "kcal", min: 0, max: 10_000, agg: "sum", slug: "calories" },
  SPO2: { label: "SpO₂", unit: "%", min: 50, max: 100, agg: "avg", slug: "spo2" },
} as const satisfies Record<
  MetricType,
  { label: string; unit: string; min: number; max: number; agg: "avg" | "sum"; slug: string }
>;

export const METRIC_TYPES = Object.keys(METRICS) as MetricType[];

export function metricFromSlug(slug: string): MetricType | undefined {
  return METRIC_TYPES.find((t) => METRICS[t].slug === slug);
}
