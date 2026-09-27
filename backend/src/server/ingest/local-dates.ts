import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(ts: Date, tz: string): string {
  return format(new TZDate(ts, tz), "yyyy-MM-dd");
}

/** Distinct local dates touched by a set of instants, sorted. */
export function touchedDates(instants: Iterable<Date>, tz: string): string[] {
  const set = new Set<string>();
  for (const ts of instants) set.add(localDate(ts, tz));
  return [...set].sort();
}
