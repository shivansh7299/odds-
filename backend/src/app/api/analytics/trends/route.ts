import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrors } from "@/lib/errors";
import { getTrend, TREND_FIELDS } from "@/server/analytics/overview";
import { requireApiUser } from "@/server/auth/session";
import { rangeFromRequest } from "@/server/http/range-params";

export const dynamic = "force-dynamic";

const querySchema = z.object({ field: z.enum(TREND_FIELDS) });

/** GET /api/analytics/trends?field=restingHr&range=30d */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  const { field } = querySchema.parse({ field: new URL(request.url).searchParams.get("field") });
  const range = rangeFromRequest(request, user.timezone);
  return NextResponse.json({ field, points: await getTrend(user.id, field, range) });
});
