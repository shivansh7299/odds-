import "server-only";
import { z } from "zod";
import type { NormalizedSample } from "@/server/sources/types";

export const MAX_BLE_SAMPLES = 900; // 15 minutes at 1 Hz

/** Browser → server batch of Web Bluetooth heart-rate readings. */
export const bleBatchSchema = z.object({
  samples: z
    .array(
      z.object({
        ts: z.number().int(), // epoch ms
        bpm: z.number().int().min(25).max(250),
      }),
    )
    .min(1)
    .max(MAX_BLE_SAMPLES),
});

export type BleBatch = z.infer<typeof bleBatchSchema>;

/**
 * Normalizes readings to 1-second resolution: timestamps are floored to the
 * second (duplicates within a second keep the last), and anything more than
 * 1 min in the future or older than 24 h is rejected as clock skew / replay.
 */
export function normalizeBleBatch(
  batch: BleBatch,
  now = Date.now(),
): { samples: NormalizedSample[]; rejected: number } {
  const bySecond = new Map<number, number>();
  let rejected = 0;
  for (const s of batch.samples) {
    if (s.ts > now + 60_000 || s.ts < now - 86_400_000) {
      rejected++;
      continue;
    }
    bySecond.set(Math.floor(s.ts / 1000) * 1000, s.bpm);
  }
  const samples = [...bySecond].map(([ts, bpm]) => ({
    type: "HEART_RATE" as const,
    ts: new Date(ts),
    value: bpm,
    resolutionSec: 1,
  }));
  return { samples, rejected };
}
