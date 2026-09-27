import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Formats an instant in the user's timezone (not the browser's). */
export const fmtIn = (t: string | number | Date, tz: string, pattern: string) =>
  format(new TZDate(new Date(t).getTime(), tz), pattern);

/** Axis tick format appropriate for a bucket size. */
export function tickFormat(bucketSec: number): string {
  if (bucketSec <= 300) return "HH:mm";
  if (bucketSec < 86_400) return "EEE HH:mm";
  return "MMM d";
}

/** Tooltip label format for a bucket size. */
export function labelFormat(bucketSec: number): string {
  if (bucketSec < 86_400) return "EEE MMM d, HH:mm";
  return "EEE, MMM d";
}

/** YYYY-MM-DD (a local date) → "Sep 26" without timezone drift. */
export const fmtDate = (ymd: string, pattern = "MMM d") => format(new Date(`${ymd}T12:00:00`), pattern);

/** Axis ticks aligned to local wall-clock boundaries (DST-safe): hours for short spans, midnights for longer. */
export function timeTicks(from: number, to: number, tz: string): { ticks: number[]; pattern: string } {
  const span = (to - from) / 3_600_000;
  const stepHours = span <= 30 ? 3 : 0;
  const stepDays = span <= 30 ? 0 : span <= 8 * 24 ? 1 : span <= 32 * 24 ? 7 : 14;
  const start = new TZDate(from, tz);
  const t = new TZDate(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, tz);
  const ticks: number[] = [];
  for (let guard = 0; guard < 500 && t.getTime() <= to; guard++) {
    if (t.getTime() >= from) ticks.push(t.getTime());
    if (stepHours) t.setHours(t.getHours() + stepHours);
    else t.setDate(t.getDate() + stepDays);
  }
  return { ticks, pattern: stepHours ? "HH:mm" : stepDays === 1 ? "EEE d" : "MMM d" };
}

/** 16500 → "16.5k" for axis ticks. */
export const compact = (v: number) =>
  Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k` : String(Math.round(v));
