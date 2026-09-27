import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrors } from "@/lib/errors";
import { requireApiUser } from "@/server/auth/session";
import { rangeFromRequest } from "@/server/http/range-params";
import { getWorkouts } from "@/server/metrics/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(64).optional(),
});

/** GET /api/workouts?range=30d&limit=20&cursor=… */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  const sp = new URL(request.url).searchParams;
  const q = querySchema.parse({ limit: sp.get("limit") ?? undefined, cursor: sp.get("cursor") ?? undefined });
  const range = rangeFromRequest(request, user.timezone);
  return NextResponse.json(await getWorkouts(user.id, range.from, range.to, q.limit, q.cursor));
});
