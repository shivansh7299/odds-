import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticateApiToken } from "@/server/api-access/tokens";
import { buildExport } from "@/server/api-access/export";
import { corsPreflight, withCors } from "@/server/http/cors";
import { normalizeTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(60),
  hrDays: z.coerce.number().int().min(0).max(31).default(14),
});

/** GET /api/v1/export?days=60&hrDays=14 (Authorization: Bearer vsk_…) */
export const GET = withCors(async (request) => {
  const user = await authenticateApiToken(request);
  const sp = new URL(request.url).searchParams;
  const q = querySchema.parse({ days: sp.get("days") ?? undefined, hrDays: sp.get("hrDays") ?? undefined });
  return NextResponse.json(
    await buildExport({ id: user.id, timezone: normalizeTimezone(user.timezone) }, q.days, q.hrDays),
  );
});

export const OPTIONS = corsPreflight;
