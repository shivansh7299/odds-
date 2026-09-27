import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { rmssdWindows } from "@/server/analytics/hrv";
import { localDate } from "@/server/ingest/local-dates";
import { startOfLocalDay } from "@/lib/range";
import type { NormalizedSample } from "@/server/sources/types";

const epochSec = z.number().int().min(1_600_000_000).max(4_000_000_000);
const pair = (lo: number, hi: number) => z.tuple([epochSec, z.number().min(lo).max(hi)]);

/**
 * Payload from the Connect IQ app. Timestamps are epoch seconds (Time.now().value()).
 *   live:    foreground 1 Hz heart rate + beat-to-beat intervals
 *   hr:      background heart-rate history (SensorHistory, ~1–2 min apart)
 *   steps:   today's cumulative step count from ActivityMonitor
 *   spo2:    background Pulse Ox history
 */
export const connectIqPayloadSchema = z.object({
  model: z.string().max(40).optional(),
  live: z
    .object({
      hr: z.array(pair(25, 250)).max(1_200).default([]),
      rr: z
        .array(z.object({ t: epochSec, ms: z.array(z.number().int().min(100).max(3_000)).max(600) }))
        .max(600)
        .default([]),
    })
    .optional(),
  hr: z.array(pair(25, 250)).max(1_000).default([]),
  steps: z.object({ t: epochSec, total: z.number().int().min(0).max(200_000) }).optional(),
  spo2: z.array(pair(50, 100)).max(300).default([]),
});

export type ConnectIqPayload = z.infer<typeof connectIqPayloadSchema>;

const MAX_AGE_SEC = 7 * 86_400;

/** Payload → normalized samples. Steps arrive as a daily running total and become a delta. */
export async function normalizeConnectIq(
  p: ConnectIqPayload,
  target: { id: string; timezone: string },
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ samples: NormalizedSample[]; rejected: number }> {
  let rejected = 0;
  const fresh = (t: number) => {
    const ok = t <= nowSec + 60 && t >= nowSec - MAX_AGE_SEC;
    if (!ok) rejected++;
    return ok;
  };
  const samples: NormalizedSample[] = [];
  const push = (type: NormalizedSample["type"], t: number, value: number, resolutionSec: number) =>
    samples.push({ type, ts: new Date(t * 1000), value, resolutionSec });

  for (const [t, bpm] of p.live?.hr ?? []) if (fresh(t)) push("HEART_RATE", t, Math.round(bpm), 1);
  for (const [t, bpm] of p.hr) if (fresh(t)) push("HEART_RATE", Math.floor(t / 60) * 60, Math.round(bpm), 60);
  for (const [t, pct] of p.spo2) if (fresh(t)) push("SPO2", Math.floor(t / 60) * 60, Math.round(pct), 60);

  const rr = (p.live?.rr ?? []).filter((b) => fresh(b.t));
  for (const w of rmssdWindows(rr)) push("HRV_RMSSD", w.ts.getTime() / 1000, w.value, 300);

  if (p.steps && fresh(p.steps.t)) {
    const at = new Date(p.steps.t * 1000);
    const dayStart = startOfLocalDay(localDate(at, target.timezone), target.timezone);
    const agg = await db.metricSample.aggregate({
      where: { connectionId: target.id, type: "STEPS", ts: { gte: dayStart, lte: at } },
      _sum: { value: true },
    });
    const delta = p.steps.total - (agg._sum.value ?? 0);
    if (delta > 0) push("STEPS", Math.floor(p.steps.t / 300) * 300, delta, 300);
  }

  // Duplicate timestamps within one payload: keep the last value.
  const dedup = new Map(samples.map((s) => [`${s.type}|${s.resolutionSec}|${s.ts.getTime()}`, s]));
  return { samples: [...dedup.values()], rejected };
}
