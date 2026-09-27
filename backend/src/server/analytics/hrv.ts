/**
 * HRV (RMSSD) from beat-to-beat (RR) intervals.
 *
 * Artifact rejection: intervals outside 300–2000 ms (200–30 bpm) are dropped,
 * and so is any interval differing from the previous accepted one by > 20%
 * (ectopic beats / missed detections). Successive differences are only taken
 * between two accepted, *adjacent* beats, so a rejected beat breaks the chain.
 */
export type RrBlock = { t: number; ms: number[] }; // t = epoch seconds of the first beat

const MIN_RR = 300;
const MAX_RR = 2000;
const MAX_JUMP = 0.2;
export const MIN_BEATS = 30;

export function rmssd(intervals: number[]): number | null {
  let sumSq = 0;
  let n = 0;
  let prev: number | null = null;
  for (const rr of intervals) {
    const ok = rr >= MIN_RR && rr <= MAX_RR && (prev == null || Math.abs(rr - prev) <= prev * MAX_JUMP);
    if (!ok) {
      prev = null; // a rejected beat breaks the chain of adjacent differences
      continue;
    }
    if (prev != null) {
      sumSq += (rr - prev) ** 2;
      n++;
    }
    prev = rr;
  }
  return n + 1 >= MIN_BEATS ? Math.sqrt(sumSq / n) : null;
}

/** Groups beats into aligned 5-minute windows and returns one RMSSD per window with enough clean beats. */
export function rmssdWindows(blocks: RrBlock[], windowSec = 300): { ts: Date; value: number }[] {
  const windows = new Map<number, number[]>();
  for (const b of [...blocks].sort((x, y) => x.t - y.t)) {
    let tMs = b.t * 1000;
    for (const rr of b.ms) {
      const w = Math.floor(tMs / 1000 / windowSec) * windowSec;
      (windows.get(w) ?? windows.set(w, []).get(w)!).push(rr);
      tMs += rr;
    }
  }
  const out: { ts: Date; value: number }[] = [];
  for (const [w, rrs] of [...windows].sort((a, b) => a[0] - b[0])) {
    const v = rmssd(rrs);
    if (v != null && v >= 1 && v <= 300) out.push({ ts: new Date(w * 1000), value: Math.round(v * 10) / 10 });
  }
  return out;
}
