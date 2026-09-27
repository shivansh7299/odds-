import { z } from "zod";
import { JobStatus, MetricType, SourceType } from "@/generated/prisma/enums";

/**
 * Events pushed to a user's open dashboards. Kept small: they say *what changed*,
 * clients refetch the data. (Postgres NOTIFY payloads are capped at 8 KB.)
 */
export const realtimeEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("metrics"),
    source: z.enum(SourceType),
    types: z.array(z.enum(MetricType)),
    from: z.iso.datetime(),
    to: z.iso.datetime(),
  }),
  z.object({ kind: z.literal("sleep"), source: z.enum(SourceType) }),
  z.object({ kind: z.literal("workouts"), source: z.enum(SourceType) }),
  z.object({
    kind: z.literal("sync"),
    source: z.enum(SourceType),
    status: z.enum(JobStatus),
    progress: z.number().min(0).max(1).optional(),
    message: z.string().max(200).optional(),
  }),
  z.object({ kind: z.literal("source"), source: z.enum(SourceType) }),
]);

export type RealtimeEvent = z.infer<typeof realtimeEventSchema>;

export const envelopeSchema = z.object({ userId: z.string(), event: realtimeEventSchema });
export type Envelope = z.infer<typeof envelopeSchema>;
