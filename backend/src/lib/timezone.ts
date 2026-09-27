/** True if `tz` is an IANA timezone this runtime understands. */
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function normalizeTimezone(tz: unknown): string {
  return isValidTimezone(tz) ? tz : "UTC";
}
