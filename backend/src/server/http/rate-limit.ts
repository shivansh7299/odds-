import "server-only";
import { AppError } from "@/lib/errors";

type Bucket = { tokens: number; updated: number };
const buckets = new Map<string, Bucket>();

/**
 * In-memory token bucket (per process). Good enough for a single instance;
 * swap for a Postgres/Redis-backed limiter when running several web replicas.
 */
export function rateLimit(
  key: string,
  { perMinute, burst = perMinute }: { perMinute: number; burst?: number },
) {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: burst, updated: now };
  b.tokens = Math.min(burst, b.tokens + ((now - b.updated) / 60_000) * perMinute);
  b.updated = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    throw new AppError(429, "rate_limited", "Too many requests. Slow down.");
  }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 10_000) {
    for (const [k, v] of buckets) if (now - v.updated > 10 * 60_000) buckets.delete(k);
  }
}

/** Best-effort client IP for rate-limit keys (trusts the first proxy hop). */
export function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}
