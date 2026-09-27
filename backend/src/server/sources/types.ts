import { z } from "zod";
import { MetricType, SleepStage } from "@/generated/prisma/enums";
import type { SourceInfo } from "@/server/sources/catalog";
import { METRICS } from "@/lib/metrics/definitions";

// ─── Normalized records: the only shape that crosses from adapters into storage ──

export const normalizedSampleSchema = z
  .object({
    type: z.enum(MetricType),
    ts: z.date(),
    value: z.number().finite(),
    resolutionSec: z.number().int().min(1).max(86_400),
  })
  .refine((s) => s.value >= METRICS[s.type].min && s.value <= METRICS[s.type].max, {
    message: "value out of physiological range",
    path: ["value"],
  });

export const normalizedSleepSchema = z
  .object({
    externalId: z.string().min(1).max(128),
    startAt: z.date(),
    endAt: z.date(),
    score: z.number().int().min(0).max(100).optional(),
    isMainSleep: z.boolean().default(true),
    stages: z
      .array(z.object({ stage: z.enum(SleepStage), startAt: z.date(), seconds: z.number().int().positive() }))
      .max(2_000),
  })
  .refine((s) => s.endAt > s.startAt, { message: "endAt must be after startAt", path: ["endAt"] });

export const normalizedWorkoutSchema = z.object({
  externalId: z.string().min(1).max(128),
  activityType: z.string().min(1).max(64),
  startAt: z.date(),
  durationSec: z
    .number()
    .int()
    .positive()
    .max(7 * 86_400),
  calories: z.number().int().nonnegative().optional(),
  avgHr: z.number().int().min(25).max(250).optional(),
  maxHr: z.number().int().min(25).max(250).optional(),
  distanceM: z.number().nonnegative().optional(),
  steps: z.number().int().nonnegative().optional(),
});

export const normalizedBatchSchema = z.object({
  samples: z.array(normalizedSampleSchema).default([]),
  sleepSessions: z.array(normalizedSleepSchema).default([]),
  workouts: z.array(normalizedWorkoutSchema).default([]),
});

export type NormalizedSample = z.infer<typeof normalizedSampleSchema>;
export type NormalizedSleep = z.input<typeof normalizedSleepSchema>;
export type NormalizedWorkout = z.infer<typeof normalizedWorkoutSchema>;
export type NormalizedBatch = z.input<typeof normalizedBatchSchema>;

export const emptyBatch = (): Required<NormalizedBatch> => ({ samples: [], sleepSessions: [], workouts: [] });

// ─── Adapter contract ───────────────────────────────────────────────────────

export type SourceKind = "internal" | "push" | "file" | "pull";

/**
 * Server-side behavior of a source. Push/file/pull adapters (Milestones 5–7) add
 * `parseIngest`, `parseFile` or OAuth + `fetch` here; everything downstream of
 * NormalizedBatch is source-agnostic.
 */
export interface SourceAdapter {
  info: SourceInfo;
  kind: SourceKind;
  /** Whether users can connect this source in the current deployment. */
  isAvailable(): boolean;
}
