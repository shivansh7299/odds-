import type { MetricType, SourceType } from "@/generated/prisma/enums";

/**
 * Static, client-safe description of every source. Server adapters in
 * `registry.ts` add behavior on top of this.
 */
export type SourceInfo = {
  type: SourceType;
  label: string;
  description: string;
  priority: number;
  metrics: MetricType[];
  milestone?: number; // set while not implemented yet
};

export const SOURCE_CATALOG: Record<SourceType, SourceInfo> = {
  GARMIN_BLE: {
    type: "GARMIN_BLE",
    label: "Live heart rate (Bluetooth)",
    description: "Broadcast Heart Rate from your Forerunner to desktop Chrome or Edge.",
    priority: 1,
    metrics: ["HEART_RATE"],
  },
  GARMIN_CONNECTIQ: {
    type: "GARMIN_CONNECTIQ",
    label: "Connect IQ watch app",
    description:
      "HR, HRV, steps and SpO₂ from the VitalSync watch app, relayed by Garmin Connect on your phone.",
    priority: 2,
    metrics: ["HEART_RATE", "HRV_RMSSD", "STEPS", "SPO2"],
  },
  GARMIN_FIT: {
    type: "GARMIN_FIT",
    label: "FIT file import",
    description: "Backfill sleep, workouts and history from FIT files or a Garmin Connect export.",
    priority: 3,
    metrics: ["HEART_RATE", "RESTING_HEART_RATE", "HRV_RMSSD", "STEPS", "CALORIES", "SPO2"],
  },
  GARMIN_HEALTH_API: {
    type: "GARMIN_HEALTH_API",
    label: "Garmin Health API",
    description: "Official cloud API. Requires Garmin partner approval.",
    priority: 4,
    metrics: ["HEART_RATE", "RESTING_HEART_RATE", "HRV_RMSSD", "STEPS", "CALORIES", "SPO2"],
    milestone: 99,
  },
  MOCK: {
    type: "MOCK",
    label: "Simulated data",
    description: "Realistic generated data for development and demos. Always labeled as simulated.",
    priority: 9,
    metrics: ["HEART_RATE", "RESTING_HEART_RATE", "HRV_RMSSD", "STEPS", "CALORIES", "SPO2"],
  },
};

export const sourcePriority = (t: SourceType) => SOURCE_CATALOG[t].priority;
