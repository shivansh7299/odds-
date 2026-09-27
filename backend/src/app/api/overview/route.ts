import { NextResponse } from "next/server";
import { withErrors } from "@/lib/errors";
import { getOverview } from "@/server/analytics/overview";
import { requireApiUser } from "@/server/auth/session";
import { rangeFromRequest } from "@/server/http/range-params";

export const dynamic = "force-dynamic";

/** GET /api/overview?range=today → KPI tiles with comparison */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  return NextResponse.json(await getOverview(user.id, rangeFromRequest(request, user.timezone)));
});
