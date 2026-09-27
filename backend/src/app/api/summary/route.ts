import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { rangeFromRequest } from "@/server/http/range-params";
import { getDailySummaries } from "@/server/metrics/queries";

export const dynamic = "force-dynamic";

/** GET /api/summary?range=30d → one row per local day */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  const range = rangeFromRequest(request, user.timezone);
  return NextResponse.json({ days: await getDailySummaries(user.id, range.fromDate, range.toDate) });
});
