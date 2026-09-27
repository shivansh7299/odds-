import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrors } from "@/lib/errors";
import { todayIn } from "@/lib/range";
import { requireApiUser } from "@/server/auth/session";
import { getSleepNight } from "@/server/metrics/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** GET /api/sleep?date=YYYY-MM-DD → the night that ended on that local date (or the latest before it) */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  const { date } = querySchema.parse({ date: new URL(request.url).searchParams.get("date") ?? undefined });
  return NextResponse.json({
    night: await getSleepNight(user.id, user.timezone, date ?? todayIn(user.timezone)),
  });
});
