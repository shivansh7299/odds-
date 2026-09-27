import { NextResponse } from "next/server";
import { z } from "zod";
import { withErrors } from "@/lib/errors";
import { isValidTimezone } from "@/lib/timezone";
import { changeTimezone } from "@/server/account/service";
import { requireApiUser } from "@/server/auth/session";
import { readJson } from "@/server/http/body";
import { rateLimit } from "@/server/http/rate-limit";

export const dynamic = "force-dynamic";

const patchSchema = z.object({ timezone: z.string().refine(isValidTimezone, "Unknown timezone") });

/** PATCH /api/account { timezone }: also rebuilds daily summaries in the new timezone. */
export const PATCH = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  rateLimit(`account:${user.id}`, { perMinute: 5 });
  const { timezone } = patchSchema.parse(await readJson(request, 1024));
  if (timezone !== user.timezone) await changeTimezone(user.id, timezone);
  return NextResponse.json({ timezone });
});
