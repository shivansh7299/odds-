import { TZDate } from "@date-fns/tz";
import { addDays, differenceInCalendarDays, format, isValid, parse } from "date-fns";
import { z } from "zod";

/** Date-range handling shared by server and client. Dates are local calendar days in the user's timezone. */

export const RANGE_PRESETS = [
  { key: "today", label: "Today", days: 1 },
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";
export const MAX_RANGE_DAYS = 366;

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type DateRange = {
  key: RangeKey;
  /** Inclusive local dates, YYYY-MM-DD. */
  fromDate: string;
  toDate: string;
  days: number;
  /** Instants: start of fromDate, and min(now, end of toDate). */
  from: Date;
  to: Date;
  tz: string;
};

export const todayIn = (tz: string, now = new Date()) => format(new TZDate(now, tz), "yyyy-MM-dd");

export const shiftDays = (date: string, n: number) =>
  format(addDays(parse(date, "yyyy-MM-dd", new Date(2000, 0, 1)), n), "yyyy-MM-dd");

/** Local midnight at the start of `date`, as an instant. */
export function startOfLocalDay(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(new TZDate(y, m - 1, d, 0, 0, 0, tz).getTime());
}

export function makeRange(
  key: RangeKey,
  fromDate: string,
  toDate: string,
  tz: string,
  now = new Date(),
): DateRange {
  const end = startOfLocalDay(shiftDays(toDate, 1), tz);
  return {
    key,
    fromDate,
    toDate,
    days: differenceInCalendarDays(parse(toDate, "yyyy-MM-dd", now), parse(fromDate, "yyyy-MM-dd", now)) + 1,
    from: startOfLocalDay(fromDate, tz),
    to: end > now ? now : end,
    tz,
  };
}

/** Parses `?range=7d` or `?range=custom&from=…&to=…`; falls back to the last 7 days. */
export function parseRange(
  params: { range?: string | null; from?: string | null; to?: string | null },
  tz: string,
  now = new Date(),
): DateRange {
  const today = todayIn(tz, now);
  const preset = RANGE_PRESETS.find((p) => p.key === params.range);
  if (preset) return makeRange(preset.key, shiftDays(today, 1 - preset.days), today, tz, now);

  if (params.range === "custom") {
    const from = ymd.safeParse(params.from);
    const to = ymd.safeParse(params.to);
    if (from.success && to.success) {
      const f = parse(from.data, "yyyy-MM-dd", now);
      const t = parse(to.data, "yyyy-MM-dd", now);
      if (isValid(f) && isValid(t)) {
        let [a, b] = f <= t ? [from.data, to.data] : [to.data, from.data];
        if (b > today) b = today;
        if (a > b) a = b;
        if (
          differenceInCalendarDays(parse(b, "yyyy-MM-dd", now), parse(a, "yyyy-MM-dd", now)) >= MAX_RANGE_DAYS
        ) {
          a = shiftDays(b, 1 - MAX_RANGE_DAYS);
        }
        return makeRange("custom", a, b, tz, now);
      }
    }
  }
  return makeRange("7d", shiftDays(today, -6), today, tz, now);
}

/** The equally long period immediately before `r`. */
export function previousPeriod(r: DateRange): { fromDate: string; toDate: string } {
  return { fromDate: shiftDays(r.fromDate, -r.days), toDate: shiftDays(r.fromDate, -1) };
}

/** Time-bucket size (seconds) that keeps charts at a few hundred points. */
export function bucketFor(days: number): 60 | 300 | 900 | 3600 | 86400 {
  if (days <= 1) return 60;
  if (days <= 3) return 300;
  if (days <= 8) return 900;
  if (days <= 31) return 3600;
  return 86400;
}

export function eachDate(fromDate: string, toDate: string): string[] {
  const out: string[] = [];
  for (let d = fromDate; d <= toDate; d = shiftDays(d, 1)) out.push(d);
  return out;
}

export function rangeSearchParams(r: Pick<DateRange, "key" | "fromDate" | "toDate">): string {
  return r.key === "custom" ? `range=custom&from=${r.fromDate}&to=${r.toDate}` : `range=${r.key}`;
}
