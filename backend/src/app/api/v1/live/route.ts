import { NextResponse } from "next/server";
import { authenticateApiToken } from "@/server/api-access/tokens";
import { latestHeartRate } from "@/server/api-access/export";
import { corsPreflight, withCors } from "@/server/http/cors";

export const dynamic = "force-dynamic";

/** GET /api/v1/live: latest heart rate (≤ 10 min old) from any source, for live displays. */
export const GET = withCors(async (request) => {
  const user = await authenticateApiToken(request);
  return NextResponse.json({ heartRate: await latestHeartRate(user.id) });
});

export const OPTIONS = corsPreflight;
