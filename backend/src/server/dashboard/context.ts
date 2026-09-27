import "server-only";
import { db } from "@/lib/db";
import { parseRange, rangeSearchParams, todayIn } from "@/lib/range";
import type { RangeCtx } from "@/components/dashboard/panels";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Resolves the URL's range in the user's timezone into the serializable context panels use. */
export function rangeContext(searchParams: SearchParams, tz: string) {
  const range = parseRange(
    { range: one(searchParams.range), from: one(searchParams.from), to: one(searchParams.to) },
    tz,
  );
  const ctx: RangeCtx = {
    qs: rangeSearchParams(range),
    tz,
    days: range.days,
    from: range.from.getTime(),
    to: range.to.getTime(),
    toDate: range.toDate,
    today: todayIn(tz),
  };
  return { range, ctx };
}

export async function connectionState(userId: string) {
  const conns = await db.sourceConnection.findMany({ where: { userId }, select: { source: true } });
  return { hasAny: conns.length > 0, simulated: conns.some((c) => c.source === "MOCK") };
}
