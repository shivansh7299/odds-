import { NextResponse } from "next/server";
import { z } from "zod";
import { MetricType } from "@/generated/prisma/enums";
import { withErrors } from "@/lib/errors";
import { bucketFor } from "@/lib/range";
import { requireApiUser } from "@/server/auth/session";
import { rangeFromRequest } from "@/server/http/range-params";
import { getSeries } from "@/server/metrics/queries";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  type: z.enum(MetricType),
  bucket: z.coerce
    .number()
    .refine((b) => [60, 300, 900, 3600, 86400].includes(b), "unsupported bucket")
    .optional(),
});

/** GET /api/metrics?type=HEART_RATE&range=7d[&bucket=3600] */
export const GET = withErrors(async (request: Request) => {
  const user = await requireApiUser(request);
  const sp = new URL(request.url).searchParams;
  const q = querySchema.parse({ type: sp.get("type"), bucket: sp.get("bucket") ?? undefined });
  const range = rangeFromRequest(request, user.timezone);
  const series = await getSeries(user.id, q.type, range, q.bucket ?? bucketFor(range.days));
  return NextResponse.json({ type: q.type, from: range.from, to: range.to, ...series });
});
